import { checkTextSize, joinText, jsonStringArray, textLength } from './text-budget.ts';

// MBS ( "List.…" ): MonkeyBread's functions on FileMaker lists (values one per line), following MBS's own function
// pages (mbsplugins.eu). Where a page leaves something out the comment says what Tabularius does and that it's inferred:
// - A list is split at returns and line feeds; a return at the end doesn't make an empty last value.
// - Functions with a NoReturnEnding parameter end their list with a return unless it is 1 (MBS: "include one to
//   easily concat lists"); an empty result is empty. Those without it end without one, as MBS's examples show.
// - Values compare case-sensitively unless MBS's page says otherwise, and in the order of their character codes.
// - Where several values come back in "no set order" (CountValues), they come in descending order, as MBS's examples do.
// Not here: List.CSVSplit (MBS doesn't describe how rows are told apart), List.OrColumn and List.XOrColumn (MBS's
// example doesn't follow from its description), List.SortWithEvaluate. They give an "isn't available" MBS error.

import { MbsError, jaroWinkler, levenshtein } from './mbs-text.ts';
import { compileRegex, optionsOf, regexMatchesEach } from './mbs-regex.ts';

type MbsList = (t: string[]) => string | number;

const fail = (msg: string): never => {
  throw new MbsError(msg);
};
export const valuesOf = (s: string): string[] => {
  if (s === '') return [];
  const v = s.split(/\r\n|\r|\n/);
  if (v[v.length - 1] === '') v.pop();
  return v;
};
const flag = (s: string | undefined) => {
  const t = (s ?? '').trim();
  return t !== '' && Number(t) !== 0 && !Number.isNaN(Number(t));
};
const int = (s: string | undefined, what: string, d?: number): number => {
  const t = (s ?? '').trim();
  if (t === '' && d !== undefined) return d;
  const n = Number(t);
  if (t === '' || !Number.isFinite(n)) fail(`"${s ?? ''}" is not a number (${what})`);
  return Math.trunc(n);
};
/** A list as MBS writes it: a return at the end unless NoReturnEnding is 1. */
export const listOut = (v: string[], noReturnEnding?: string | boolean) =>
  joinText(v, '\r', !(typeof noReturnEnding === 'boolean' ? noReturnEnding : flag(noReturnEnding)));
const plain = (v: string[]) => joinText(v, '\r');
const lower = (s: string) => s.toLowerCase();
const codeOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// --- set operations ----------------------------------------------------------------------------------
// MBS: "made for lists without duplicate values". Results keep the first list's order, then the second's (inferred).

export const and = (a: string[], b: string[]) => {
  const in2 = new Set(b);
  return a.filter((x) => in2.has(x));
};
export const not = (a: string[], b: string[]) => {
  const in2 = new Set(b);
  return a.filter((x) => !in2.has(x));
};
export const or = (a: string[], b: string[]) => [...a, ...not(b, a)];
export const xor = (a: string[], b: string[]) => [...not(a, b), ...not(b, a)];

/** A line's column (0-based); a line without that column has "" there (inferred). */
const column = (line: string, sep: string, col: number) => (sep === '' ? line : line.split(sep)[col] ?? '');
/** AndColumn: the second list's lines whose column is in the first list's; NotColumn: the first list's lines whose column isn't in the second's. */
export function andColumn(a: string[], b: string[], sep: string, col: number): string[] {
  const keys = new Set(a.map((l) => column(l, sep, col)));
  return b.filter((l) => keys.has(column(l, sep, col)));
}
export function notColumn(a: string[], b: string[], sep: string, col: number): string[] {
  const keys = new Set(b.map((l) => column(l, sep, col)));
  return a.filter((l) => !keys.has(column(l, sep, col)));
}

// --- matching ----------------------------------------------------------------------------------------

const OPERATORS = ['=', '!=', '<', '>', '<=', '>=', '≤', '≥', '≠', 'prefix', 'postfix'];
/** CountValuesMatching and IndexOfFirstValueMatching: compare as text (mode 0, MBS's default) or as numbers (mode 1). */
export function matcher(operator: string, value: string, mode: string | undefined): (x: string) => boolean {
  const op = operator.trim().toLowerCase();
  if (!OPERATORS.includes(op)) fail(`Unknown operator "${operator}": use =, !=, <, >, <=, >=, Prefix or Postfix`);
  if (op === 'prefix') return (x) => x.startsWith(value);
  if (op === 'postfix') return (x) => x.endsWith(value);
  const numeric = int(mode, 'mode', 0) === 1;
  const cmp = numeric ? (x: string) => Number(x) - Number(value) : (x: string) => codeOrder(x, value);
  switch (op) {
    case '=': return (x) => cmp(x) === 0;
    case '!=': case '≠': return (x) => cmp(x) !== 0;
    case '<': return (x) => cmp(x) < 0;
    case '>': return (x) => cmp(x) > 0;
    case '<=': case '≤': return (x) => cmp(x) <= 0;
    default: return (x) => cmp(x) >= 0;
  }
}

const BEST_MATCH_WORK = 100_000_000;
/** BestMatch: the closest value over 50% alike (Levenshtein, or Jaro-Winkler with flag 1); flag 2 gives the best five. Ties go to the earlier value (inferred). */
export function bestMatch(list: string[], search: string, flags: number): string {
  // The comparisons together, not just each one, are bounded so a long list can't hold the server (Tabularius's limit).
  let work = 0;
  for (const x of list) work += Math.max(1, x.length) * Math.max(1, search.length);
  if (work > BEST_MATCH_WORK) throw new MbsError(`BestMatch compares at most ${BEST_MATCH_WORK} character pairs in one call; use a shorter list or search text`);
  const score = (x: string) => {
    if (flags & 1) return jaroWinkler(x, search);
    const longest = Math.max(x.length, search.length);
    return longest ? 1 - levenshtein(x, search) / longest : 1;
  };
  const scored = list.map((x, i) => ({ x, i, s: score(x) })).filter((e) => e.s > 0.5);
  scored.sort((p, q) => q.s - p.s || p.i - q.i);
  return flags & 2 ? plain(scored.slice(0, 5).map((e) => e.x)) : (scored[0]?.x ?? '');
}

// --- sorting -----------------------------------------------------------------------------------------

/** A date as day count for sorting: day.month.year (flag 4) or month/day/year (flag 8), any separators; others first (inferred). */
const dateKey = (s: string, dmy: boolean) => {
  const m = /^\s*(\d{1,4})\D+(\d{1,2})\D+(\d{1,4})\s*$/.exec(s);
  if (!m) return -Infinity;
  const [d, mo] = dmy ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
  return Number(m[3]) * 10000 + mo * 100 + d;
};
/** Sort flags: 1 not case sensitive, 2 descending, 4 dates day first, 8 dates month first, 16 numbers. A stable sort (inferred). */
export const sortValues = (v: string[], flags: number): string[] => sortOrder(v, flags).map((i) => v[i]);
/** Where each value goes when sorted: the positions of the values, in sorted order. */
export function sortOrder(v: string[], flags: number): number[] {
  let cmp: (a: string, b: string) => number;
  if (flags & 16) {
    const key = (s: string) => {
      const n = Number(s.trim());
      return s.trim() === '' || Number.isNaN(n) ? -Infinity : n;
    };
    cmp = (a, b) => (key(a) === key(b) ? 0 : key(a) < key(b) ? -1 : 1);
  } else if (flags & 12) {
    const dmy = (flags & 4) !== 0;
    cmp = (a, b) => dateKey(a, dmy) - dateKey(b, dmy) || 0;
  } else if (flags & 1) cmp = (a, b) => codeOrder(lower(a), lower(b));
  else cmp = codeOrder;
  // Descending keeps equal values in their order too.
  const dir = flags & 2 ? -1 : 1;
  return v.map((_, i) => i).sort((p, q) => dir * cmp(v[p], v[q]) || p - q);
}

// --- duplicates --------------------------------------------------------------------------------------

const keyer = (insensitive: boolean) => (insensitive ? lower : (s: string) => s);
/** Values that come more than once, each once, in the order they first come. */
export function duplicates(v: string[], insensitive: boolean): string[] {
  const key = keyer(insensitive);
  const count = new Map<string, number>();
  for (const x of v) count.set(key(x), (count.get(key(x)) ?? 0) + 1);
  const seen = new Set<string>();
  return v.filter((x) => {
    const k = key(x);
    if (count.get(k)! < 2 || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
/** Each value once, where it first comes; with RemoveAll, values that come more than once go entirely. */
export function unique(v: string[], removeAll: boolean, insensitive: boolean): string[] {
  const key = keyer(insensitive);
  if (removeAll) {
    const count = new Map<string, number>();
    for (const x of v) count.set(key(x), (count.get(key(x)) ?? 0) + 1);
    return v.filter((x) => count.get(key(x)) === 1);
  }
  const seen = new Set<string>();
  return v.filter((x) => !seen.has(key(x)) && (seen.add(key(x)), true));
}

/** SubList: skip `index` values, then take `count`; a negative count takes the rest (inferred beyond MBS's -1 example). */
export function subList(v: string[], index: number, count: number): string[] {
  if (index < 0) fail('The index must be 0 or more');
  return count < 0 ? v.slice(index) : v.slice(index, index + count);
}

// Serialize: MBS's layout isn't described, so Tabularius's is its own, read by its List.Deserialize and QuickList.Deserialize.
const MAGIC = 'openhbam-list-1';
export const serialize = (v: string[]) => {
  const json = joinText(['[', JSON.stringify(MAGIC), ',', jsonStringArray(v), ']']);
  checkTextSize(Math.ceil(Buffer.byteLength(json) / 3) * 4);
  return Buffer.from(json).toString('base64');
};
export function deserialize(s: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(s.trim(), 'base64').toString('utf8'));
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed) || parsed[0] !== MAGIC || !Array.isArray(parsed[1]) || !parsed[1].every((x) => typeof x === 'string')) fail('This is not a list from List.Serialize');
  return (parsed as [string, string[]])[1];
}

export function shuffle<T>(v: T[]): T[] {
  const out = [...v];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const index = (v: string[], i: string | undefined, max: number) => {
  const n = int(i, 'index');
  if (n < 0 || n > max) fail(`The index must be from 0 to ${max}`);
  return n;
};
const matches = (f: (x: string, t: string) => boolean) => (v: string[], t: string, not = false) => v.filter((x) => f(lower(x), lower(t)) !== not);
export const matchesPrefix = matches((x, t) => x.startsWith(t));
export const matchesPostfix = matches((x, t) => x.endsWith(t));
export const matchesSubString = matches((x, t) => x.includes(t));
const columnMatches = (f: (x: string, t: string) => boolean): MbsList => ([list = '', sep = '', col, t = '', a, b]) => {
  const c = int(col, 'column');
  // ColumnMatchesSubString has Flags (4: NOT) before NoReturnEnding.
  const sub = f === sub0;
  const not = sub && (int(a, 'flags', 0) & 4) !== 0;
  return listOut(valuesOf(list).filter((l) => f(lower(column(l, sep, c)), lower(t)) !== not), sub ? b : a);
};
const sub0 = (x: string, t: string) => x.includes(t);
// Scans instead of an end-anchored pattern, which is quadratic on a long run of blanks followed by another character.
export const trimValue = (s: string) => {
  let start = 0;
  let end = s.length;
  while (start < end && (s[start] === ' ' || s[start] === '\t')) start++;
  while (end > start && (s[end - 1] === ' ' || s[end - 1] === '\t')) end--;
  return s.slice(start, end);
};
export function removeFix(v: string[], fix: string, post: boolean, sensitive: boolean): string[] {
  const has = (x: string) => (sensitive ? (post ? x.endsWith(fix) : x.startsWith(fix)) : post ? lower(x).endsWith(lower(fix)) : lower(x).startsWith(lower(fix)));
  return v.map((x) => (fix && has(x) ? (post ? x.slice(0, x.length - fix.length) : x.slice(fix.length)) : x));
}
export function crossProduct(a: string[], b: string[], pre: string, mid: string, post: string, diagonal: boolean, reserve?: (chars: number, count: number) => void): string[] {
  if (!a.length || !b.length) return [];
  const count = diagonal ? Math.min(a.length, b.length) : a.length * b.length;
  const chars = diagonal
    ? textLength(a.slice(0, count)) + textLength(b.slice(0, count))
    : textLength(a) * b.length + textLength(b) * a.length;
  checkTextSize(chars + count * (pre.length + mid.length + post.length) + Math.max(0, count - 1));
  reserve?.(chars + count * (pre.length + mid.length + post.length), count);
  if (diagonal) return a.slice(0, Math.min(a.length, b.length)).map((x, i) => pre + x + mid + b[i] + post);
  if (a.length * b.length > 1_000_000) fail('The cross product would have more than a million values');
  return a.flatMap((x) => b.map((y) => pre + x + mid + y + post));
}
export function deCombine(v: string[], sep: string, from: number, to: number): string[] {
  if (from < 0 || to < from) fail('The columns must be from StartColumn to EndColumn, counting from 0');
  return v.map((l) => l.split(sep).slice(from, to + 1).join(sep));
}
export function deleteColumn(v: string[], sep: string, col: number): string[] {
  return v.map((l) => {
    const parts = l.split(sep);
    if (col >= 0 && col < parts.length) parts.splice(col, 1);
    return parts.join(sep);
  });
}
export function countValues(v: string[]): string[] {
  const count = new Map<string, number>();
  for (const x of v) count.set(x, (count.get(x) ?? 0) + 1);
  return [...count.keys()].sort((a, b) => codeOrder(b, a)).map((k) => `${count.get(k)}\t${k}`);
}
/** MapEntries: for each selected key, the value at the first place that key is (keys missing are left out, inferred). */
export function mapEntries(keys: string[], selected: string[], values: string[]): string[] {
  const at = new Map<string, number>();
  keys.forEach((k, i) => at.has(k) || at.set(k, i));
  return selected.flatMap((k) => (at.has(k) && at.get(k)! < values.length ? [values[at.get(k)!]] : []));
}

export const MBS_LIST: Record<string, MbsList> = {
  'list.addpostfix': ([list = '', fix = '', nre]) => listOut(valuesOf(list).map((x) => x + fix), nre),
  'list.addprefix': ([list = '', fix = '', nre]) => listOut(valuesOf(list).map((x) => fix + x), nre),
  'list.addvalue': ([list = '', t = '']) => plain([...valuesOf(list), t]),
  'list.and': ([a = '', b = '', nre]) => listOut(and(valuesOf(a), valuesOf(b)), nre),
  'list.findequals': ([a = '', b = '', nre]) => listOut(and(valuesOf(a), valuesOf(b)), nre),
  'list.or': ([a = '', b = '', nre]) => listOut(or(valuesOf(a), valuesOf(b)), nre),
  'list.not': ([a = '', b = '', nre]) => listOut(not(valuesOf(a), valuesOf(b)), nre),
  'list.xor': ([a = '', b = '', nre]) => listOut(xor(valuesOf(a), valuesOf(b)), nre),
  'list.findunequals': ([a = '', b = '', nre, notFromSecond]) =>
    listOut(flag(notFromSecond) ? not(valuesOf(a), valuesOf(b)) : xor(valuesOf(a), valuesOf(b)), nre),
  'list.andcolumn': ([a = '', b = '', sep = '', col, nre]) => listOut(andColumn(valuesOf(a), valuesOf(b), sep, int(col, 'column')), nre),
  'list.notcolumn': ([a = '', b = '', sep = '', col, nre]) => listOut(notColumn(valuesOf(a), valuesOf(b), sep, int(col, 'column')), nre),
  'list.intersection': ([first = '', ...others]) => listOut(others.reduce((acc, o) => and(acc, valuesOf(o)), unique(valuesOf(first), false, false)), false),
  'list.bestmatch': ([list = '', search = '', flags]) => bestMatch(valuesOf(list), search, int(flags, 'flags', 0)),
  'list.columnmatchesprefix': columnMatches((x, t) => x.startsWith(t)),
  'list.columnmatchespostfix': columnMatches((x, t) => x.endsWith(t)),
  'list.columnmatchessubstring': columnMatches(sub0),
  'list.countvalues': ([list = '']) => plain(countValues(valuesOf(list))),
  'list.countvaluesmatching': ([list = '', op = '', value = '', mode]) => valuesOf(list).filter(matcher(op, value, mode)).length,
  'list.indexoffirstvaluematching': ([list = '', op = '', value = '', mode, start]) => {
    const v = valuesOf(list);
    const m = matcher(op, value, mode);
    for (let i = Math.max(0, int(start, 'start row', 0)); i < v.length; i++) if (m(v[i])) return i;
    return -1;
  },
  'list.crossproduct': ([a = '', b = '', pre = '', mid = '', post = '', flags]) => {
    const f = int(flags, 'flags', 0);
    return listOut(crossProduct(valuesOf(a), valuesOf(b), pre, mid, post, (f & 2) !== 0), (f & 1) !== 0);
  },
  'list.decombine': ([list = '', sep = '', from, to, nre]) => listOut(deCombine(valuesOf(list), sep, int(from, 'start column'), int(to, 'end column')), nre),
  'list.deletecolumn': ([list = '', sep = '', col, nre]) => listOut(deleteColumn(valuesOf(list), sep, int(col, 'column')), nre),
  'list.getcolumn': ([list = '', sep = '', col, nre]) => listOut(valuesOf(list).map((l) => column(l, sep, int(col, 'column'))), nre),
  'list.serialize': ([list = '']) => serialize(valuesOf(list)),
  'list.deserialize': ([s = '', nre]) => listOut(deserialize(s), nre),
  'list.find': ([list = '', value = '', ignoreCase]) => {
    const key = keyer(flag(ignoreCase));
    return valuesOf(list).findIndex((x) => key(x) === key(value));
  },
  'list.findduplicateitems': ([list = '', nre, insensitive]) => listOut(duplicates(valuesOf(list), flag(insensitive)), nre),
  'list.hasduplicateitems': ([list = '', insensitive]) => (duplicates(valuesOf(list), flag(insensitive)).length ? 1 : 0),
  'list.removeduplicateitems': ([list = '', nre, removeAll, insensitive]) => listOut(unique(valuesOf(list), flag(removeAll), flag(insensitive)), nre),
  'list.getvalue': ([list = '', i]) => {
    const v = valuesOf(list);
    return v[index(v, i, v.length - 1)];
  },
  'list.hasvalue': ([list = '', value = '']) => (valuesOf(list).includes(value) ? 1 : 0),
  'list.insertvalue': ([list = '', i, t = '']) => {
    const v = valuesOf(list);
    v.splice(index(v, i, v.length), 0, t);
    return plain(v);
  },
  'list.setvalue': ([list = '', i, t = '']) => {
    const v = valuesOf(list);
    v[index(v, i, v.length)] = t;
    return plain(v);
  },
  'list.remove': ([list = '', i]) => {
    const v = valuesOf(list);
    v.splice(index(v, i, v.length - 1), 1);
    return plain(v);
  },
  'list.mapentries': ([keys = '', selected = '', values = '', nre]) => listOut(mapEntries(valuesOf(keys), valuesOf(selected), valuesOf(values)), nre),
  'list.matchesprefix': ([list = '', t = '', nre]) => listOut(matchesPrefix(valuesOf(list), t), nre),
  'list.matchespostfix': ([list = '', t = '', nre]) => listOut(matchesPostfix(valuesOf(list), t), nre),
  'list.matchessubstring': ([list = '', t = '', flags, nre]) => listOut(matchesSubString(valuesOf(list), t, (int(flags, 'flags', 0) & 4) !== 0), nre),
  'list.regexmatch': ([list = '', pattern = '', compile, exec, nre]) => {
    const c = compileRegex(pattern, optionsOf(compile));
    const options = c.options | optionsOf(exec);
    const values = valuesOf(list);
    const matched = regexMatchesEach(c, values, options);
    return listOut(values.filter((_, i) => matched[i]), nre);
  },
  'list.removeemptyitems': ([list = '', nre]) => listOut(valuesOf(list).filter((x) => x !== ''), nre),
  'list.removeprefix': ([list = '', fix = '', nre, sensitive]) => listOut(removeFix(valuesOf(list), fix, false, flag(sensitive)), nre),
  'list.removepostfix': ([list = '', fix = '', nre, sensitive]) => listOut(removeFix(valuesOf(list), fix, true, flag(sensitive)), nre),
  // The first match, or every one with All; a value it doesn't have is no error (MBS 9.0).
  'list.removevalue': ([list = '', value = '', all]) => {
    const v = valuesOf(list);
    if (flag(all)) return plain(v.filter((x) => x !== value));
    const at = v.indexOf(value);
    if (at >= 0) v.splice(at, 1);
    return plain(v);
  },
  // Every place each of the values is (as MBS's example shows).
  'list.removevalues': ([list = '', values = '']) => {
    const drop = new Set(valuesOf(values));
    return plain(valuesOf(list).filter((x) => !drop.has(x)));
  },
  'list.reverse': ([list = '', nre]) => listOut(valuesOf(list).reverse(), nre),
  'list.shuffle': ([list = '']) => plain(shuffle(valuesOf(list))),
  'list.sort': ([list = '', flags, nre]) => listOut(sortValues(valuesOf(list), int(flags, 'flags', 0)), nre),
  'list.sublist': ([list = '', i, count, nre]) => listOut(subList(valuesOf(list), int(i, 'index'), int(count, 'count')), nre),
  // Spaces and tabs at either end of each value (inferred).
  'list.trim': ([list = '', nre]) => listOut(valuesOf(list).map(trimValue), nre),
  // Not case sensitive; "" when it isn't there.
  'list.valueindex': ([list = '', value = '']) => {
    const i = valuesOf(list).findIndex((x) => lower(x) === lower(value));
    return i < 0 ? '' : i;
  },
};
