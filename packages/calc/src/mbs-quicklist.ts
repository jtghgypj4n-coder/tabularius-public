import { checkTextSize, joinText, jsonStringArray, textLength } from './text-budget.ts';
import { ENTRY_BYTES, LIST_SLOT_BYTES, RetainedMap, retainedBudget, stringBytes } from './retained-budget.ts';

// MBS ( "QuickList.…" ): MonkeyBread's lists kept in memory by reference, following MBS's own function pages
// (mbsplugins.eu). They work as the List functions (mbs-list.ts) do, on a list that stays put between calls: most
// change the list they're given, or with ReturnNewList give a new one. References start at 12000 for each session
// (MBS: "Reference numbers start at 12000 and increase with each new list"), or take the name given to QuickList.New.
// Where a page leaves something out the comment says what Tabularius does and that it's inferred.
// Not here: QuickList.CSVSplit, OrColumn and XOrColumn (as for List), SortWithEvaluate and AddSQL. They give an
// "isn't available" MBS error.

import { MbsError } from './mbs-text.ts';
import { compileRegex, optionsOf, regexMatchesEach } from './mbs-regex.ts';
import { parseJson } from './mbs-json.ts';
import {
  and, andColumn, bestMatch, crossProduct, deCombine, deleteColumn, deserialize, duplicates, listOut, matcher,
  matchesPostfix, matchesPrefix, matchesSubString, not, notColumn, or, removeFix, serialize, shuffle, sortOrder, sortValues, subList,
  trimValue, unique, valuesOf, xor,
} from './mbs-list.ts';

type MbsQuickList = (t: string[], scope: object) => string | number;

interface Session { next: number; lists: RetainedMap<string, string[]> }
const sessions = new WeakMap<object, Session>();
// Arrays are owned here; edits update this total before republishing them.
const characterCounts = new WeakMap<string[], number>();
function characters(items: string[]): number {
  let count = characterCounts.get(items);
  if (count === undefined) characterCounts.set(items, count = textLength(items));
  return count;
}
const MAX_LIVE = 10_000;
const MAX_ITEMS = 5_000_000;
// All of a session's lists together, so a loop of large lists can't take the server's memory (Tabularius's own limit).
const MAX_TOTAL = 10_000_000;
const sessionOf = (scope: object): Session => {
  let s = sessions.get(scope);
  if (!s) sessions.set(scope, (s = { next: 12000, lists: new RetainedMap(retainedBudget(scope), (key, items) => {
    checked(items);
    return ENTRY_BYTES + stringBytes(key) + characters(items) * 2 + items.length * LIST_SLOT_BYTES;
  }) }));
  return s;
};
const fail = (msg: string): never => {
  throw new MbsError(msg);
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
const checked = (items: string[]) => {
  if (items.length > MAX_ITEMS) fail(`A QuickList holds at most ${MAX_ITEMS} values`);
  checkTextSize(characters(items));
  return items;
};
/** Fails when `extra` more values would take the session's lists past MAX_TOTAL together. */
function room(s: Session, extra: number): void {
  if (extra <= 0) return;
  let total = extra;
  for (const l of s.lists.values()) total += l.length;
  if (total > MAX_TOTAL) fail(`The open QuickLists hold at most ${MAX_TOTAL} values together; release some with QuickList.Release`);
}
const canKeep = (s: Session, name?: string) => {
  if (s.lists.size >= MAX_LIVE && !(name !== undefined && s.lists.has(name))) fail(`Too many QuickLists are open (${MAX_LIVE}); release them with QuickList.Release`);
};

function keep(scope: object, items: string[], name?: string): string | number {
  const s = sessionOf(scope);
  canKeep(s, name);
  checked(items);
  room(s, items.length - (name !== undefined ? (s.lists.get(name)?.length ?? 0) : 0));
  if (name !== undefined) {
    s.lists.set(name, items);
    return name;
  }
  const ref = nextRef(s);
  s.lists.set(String(ref), items);
  s.next = ref + 1;
  return ref;
}
const listOf = (scope: object, ref: string | undefined): string[] =>
  sessionOf(scope).lists.get((ref ?? '').trim()) ?? fail(`"${ref ?? ''}" is not a QuickList reference`);
/** A QuickList's values, for Dictionary.SetQuickList. */
export const quickListItems = (scope: object, ref: string): readonly string[] => listOf(scope, ref);
/** The result of a change: the list itself changes and the answer is OK, or with ReturnNewList a new list's reference. */
function changed(scope: object, ref: string | undefined, items: string[], newList: boolean): string | number {
  if (newList) return keep(scope, items);
  const s = sessionOf(scope);
  const key = (ref ?? '').trim();
  checked(items);
  room(s, items.length - (s.lists.get(key)?.length ?? 0));
  s.lists.set(key, items);
  return 'OK';
}
/** QuickList.New's separator: a character code ("9" for tab) or the first character of the text; by default returns and line feeds. */
function split(text: string, sep: string | undefined): string[] {
  const t = sep ?? '';
  if (t === '' || t === '\r' || t === '\n' || t === '\r\n') return valuesOf(text);
  const c = /^\d+$/.test(t.trim()) ? String.fromCharCode(Number(t.trim())) : [...t][0];
  if (text === '') return [];
  const v = text.split(c);
  if (v[v.length - 1] === '') v.pop();
  return v;
}
const at = (items: string[], i: string | undefined, max: number) => {
  const n = int(i, 'index');
  if (n < 0 || n > max) fail(`The index must be from 0 to ${max}`);
  return n;
};
const setOp = (f: (a: string[], b: string[]) => string[]): MbsQuickList => ([a, b, nl], scope) => changed(scope, a, f(listOf(scope, a), listOf(scope, b)), flag(nl));
const columnOp = (f: typeof andColumn): MbsQuickList => ([a, b, sep = '', col, nl], scope) =>
  changed(scope, a, f(listOf(scope, a), listOf(scope, b), sep, int(col, 'column')), flag(nl));

/** MatchesPrefix and the rest: flag 1 a new list of the matches; 2 (with 1) moves the matches to it, leaving the others; 4 the ones that don't match. */
const matching = (f: (v: string[], t: string, not?: boolean) => string[]): MbsQuickList => ([ref, t = '', flags], scope) => {
  const items = listOf(scope, ref);
  const fl = int(flags, 'flags', 0);
  const hits = f(items, t, (fl & 4) !== 0);
  if (fl & 2) {
    // The new list must be keepable before the source loses its matches.
    canKeep(sessionOf(scope));
    const s = sessionOf(scope);
    const next = nextRef(s);
    s.lists.replaceMany(new Map([[(ref ?? '').trim(), f(items, t, (fl & 4) === 0)], [String(next), hits]]));
    s.next = next + 1;
    return next;
  }
  return changed(scope, ref, hits, (fl & 1) !== 0);
};

export const MBS_QUICKLIST: Record<string, MbsQuickList> = {
  'quicklist.new': ([t = '', sep, name], scope) => keep(scope, split(t, sep), name === undefined || name.trim() === '' ? undefined : name.trim()),
  'quicklist.addlist': ([ref, t = '', sep], scope) => changed(scope, ref, [...listOf(scope, ref), ...split(t, sep)], false),
  'quicklist.addmultivalue': ([ref, t = '', count, sep], scope) => {
    const items = listOf(scope, ref);
    const add = split(t, sep);
    const n = int(count, 'count');
    if (n < 0) fail('The count must be 0 or more');
    if (!add.length || n === 0) return 'OK';
    return editList(scope, ref, characters(items) + textLength(add) * n, items.length + add.length * n,
      () => { for (let i = 0; i < n; i++) for (const x of add) items.push(x); });
  },
  'quicklist.addprefix': ([ref, fix = '', nl], scope) => affix(scope, ref, fix, false, flag(nl)),
  'quicklist.addpostfix': ([ref, fix = '', nl], scope) => affix(scope, ref, fix, true, flag(nl)),
  'quicklist.addquicklist': ([ref, other], scope) => changed(scope, ref, [...listOf(scope, ref), ...listOf(scope, other)], false),
  // The text is one value, returns and all (inferred; AddList splits).
  'quicklist.addvalue': ([ref, t = ''], scope) => {
    const items = listOf(scope, ref);
    return editList(scope, ref, characters(items) + t.length, items.length + 1, () => { items.push(t); });
  },
  'quicklist.push': ([ref, t = ''], scope) => {
    const items = listOf(scope, ref);
    return editList(scope, ref, characters(items) + t.length, items.length + 1, () => { items.push(t); });
  },
  // An empty list gives "" (inferred).
  'quicklist.pop': ([ref], scope) => pop(scope, ref, false),
  'quicklist.popfirst': ([ref], scope) => pop(scope, ref, true),
  'quicklist.and': setOp(and),
  'quicklist.findequals': setOp(and),
  'quicklist.or': setOp(or),
  'quicklist.not': setOp(not),
  'quicklist.xor': setOp(xor),
  'quicklist.findunequals': ([a, b, nl, notFromSecond], scope) =>
    changed(scope, a, (flag(notFromSecond) ? not : xor)(listOf(scope, a), listOf(scope, b)), flag(nl)),
  'quicklist.andcolumn': columnOp(andColumn),
  'quicklist.notcolumn': columnOp(notColumn),
  'quicklist.bestmatch': ([ref, search = '', flags], scope) => bestMatch(listOf(scope, ref), search, int(flags, 'flags', 0)),
  'quicklist.clear': ([ref], scope) => changed(scope, ref, (listOf(scope, ref), []), false),
  'quicklist.clone': ([ref], scope) => keep(scope, [...listOf(scope, ref)]),
  'quicklist.count': ([ref], scope) => listOf(scope, ref).length,
  'quicklist.countvaluesmatching': ([ref, op = '', value = '', mode], scope) => listOf(scope, ref).filter(matcher(op, value, mode)).length,
  'quicklist.indexoffirstvaluematching': ([ref, op = '', value = '', mode, start], scope) => {
    const items = listOf(scope, ref);
    const m = matcher(op, value, mode);
    for (let i = Math.max(0, int(start, 'start row', 0)); i < items.length; i++) if (m(items[i])) return i;
    return -1;
  },
  // Flag 1: a new list; 2: pairs by position.
  'quicklist.crossproduct': ([a, b, pre = '', mid = '', post = '', flags], scope) => {
    const f = int(flags, 'flags', 0);
    return changed(scope, a, crossProduct(listOf(scope, a), listOf(scope, b), pre, mid, post, (f & 2) !== 0, (chars, count) => reserveList(scope, a, chars, count, (f & 1) !== 0)), (f & 1) !== 0);
  },
  // Without ReturnNewList these give text, as MBS says ("Can return new QuickList or normal list").
  'quicklist.decombine': ([ref, sep = '', from, to, nl, nre], scope) => {
    const v = deCombine(listOf(scope, ref), sep, int(from, 'start column'), int(to, 'end column'));
    return flag(nl) ? keep(scope, v) : listOut(v, nre);
  },
  'quicklist.sublist': ([ref, i, count, nl, nre], scope) => {
    const v = subList(listOf(scope, ref), int(i, 'index'), int(count, 'count'));
    return flag(nl) ? keep(scope, v) : listOut(v, nre);
  },
  'quicklist.deletecolumn': ([ref, sep = '', col, nl], scope) => changed(scope, ref, deleteColumn(listOf(scope, ref), sep, int(col, 'column')), flag(nl)),
  'quicklist.getcolumn': ([ref, sep = '', col, nl], scope) =>
    changed(scope, ref, listOf(scope, ref).map((l) => (sep === '' ? l : l.split(sep)[int(col, 'column')] ?? '')), flag(nl)),
  'quicklist.serialize': ([ref], scope) => serialize(listOf(scope, ref)),
  'quicklist.deserialize': ([s = ''], scope) => keep(scope, deserialize(s)),
  'quicklist.find': ([ref, value = '', ignoreCase], scope) => {
    const key = flag(ignoreCase) ? (s: string) => s.toLowerCase() : (s: string) => s;
    return listOf(scope, ref).findIndex((x) => key(x) === key(value));
  },
  'quicklist.findduplicateitems': ([ref, nl, insensitive], scope) => changed(scope, ref, duplicates(listOf(scope, ref), flag(insensitive)), flag(nl)),
  'quicklist.hasduplicateitems': ([ref, insensitive], scope) => (duplicates(listOf(scope, ref), flag(insensitive)).length ? 1 : 0),
  'quicklist.removeduplicateitems': ([ref, removeAll, nl, insensitive], scope) =>
    changed(scope, ref, unique(listOf(scope, ref), flag(removeAll), flag(insensitive)), flag(nl)),
  // A delimiter given joins the values (an empty one runs them together); one goes on the end unless NoReturnEnding (inferred for other delimiters).
  'quicklist.getlist': ([ref, nre, delimiter], scope) => {
    const items = listOf(scope, ref);
    if (delimiter === undefined) return listOut(items, nre);
    return joinText(items, delimiter, !flag(nre));
  },
  'quicklist.getvalue': ([ref, i], scope) => {
    const items = listOf(scope, ref);
    return items[at(items, i, items.length - 1)];
  },
  'quicklist.hasvalue': ([ref, value = ''], scope) => (listOf(scope, ref).includes(value) ? 1 : 0),
  // The values asked for that it has, in the order asked (inferred).
  'quicklist.hasvalues': ([ref, values = ''], scope) => {
    const has = new Set(listOf(scope, ref));
    return valuesOf(values).filter((v) => has.has(v)).join('\r');
  },
  'quicklist.insertvalue': ([ref, i, t = ''], scope) => {
    const items = listOf(scope, ref);
    const n = at(items, i, items.length);
    return editList(scope, ref, characters(items) + t.length, items.length + 1, () => { items.splice(n, 0, t); });
  },
  'quicklist.setvalue': ([ref, i, t = ''], scope) => {
    const items = listOf(scope, ref);
    const n = at(items, i, items.length);
    return editList(scope, ref, characters(items) + t.length - (items[n]?.length ?? 0), Math.max(items.length, n + 1), () => { items[n] = t; });
  },
  'quicklist.remove': ([ref, i], scope) => {
    const items = listOf(scope, ref);
    const index = at(items, i, items.length - 1);
    return editList(scope, ref, characters(items) - items[index].length, items.length - 1, () => { items.splice(index, 1); });
  },
  'quicklist.setlist': ([ref, t = '', sep], scope) => changed(scope, ref, (listOf(scope, ref), split(t, sep)), false),
  // ["Hello", "World"], as MBS's example shows it.
  'quicklist.jsonarray': ([ref], scope) => jsonStringArray(listOf(scope, ref), ', '),
  // Each value has to be JSON; they go in an array as written (inferred, laid out as JSONArray is).
  'quicklist.joinjson': ([ref], scope) => {
    const items = listOf(scope, ref).map((x) => x.trim());
    items.forEach((x, n) => {
      try {
        parseJson(x);
      } catch (e) {
        fail(`Value ${n} is not JSON: ${(e as Error).message}`);
      }
    });
    checkTextSize(characters(items) + Math.max(0, items.length - 1) * 2 + 2);
    return `[${items.join(', ')}]`;
  },
  'quicklist.list': (_, scope) => joinText([...sessionOf(scope).lists.keys()], '\r'),
  'quicklist.matchesprefix': matching(matchesPrefix),
  'quicklist.matchespostfix': matching(matchesPostfix),
  'quicklist.matchessubstring': matching(matchesSubString),
  'quicklist.regexmatch': ([ref, pattern = '', compile, exec, nl], scope) => {
    const c = compileRegex(pattern, optionsOf(compile));
    const options = c.options | optionsOf(exec);
    const values = listOf(scope, ref);
    const matched = regexMatchesEach(c, values, options);
    return changed(scope, ref, values.filter((_, i) => matched[i]), flag(nl));
  },
  'quicklist.release': ([ref], scope) => {
    if (!sessionOf(scope).lists.delete((ref ?? '').trim())) fail(`"${ref ?? ''}" is not a QuickList reference`);
    return 'OK';
  },
  'quicklist.removevalue': ([ref, value = '', all], scope) => {
    const items = listOf(scope, ref);
    if (flag(all)) return changed(scope, ref, items.filter((x) => x !== value), false);
    const i = items.indexOf(value);
    if (i < 0) return 'OK';
    return editList(scope, ref, characters(items) - items[i].length, items.length - 1, () => { items.splice(i, 1); });
  },
  // The values to take out are another QuickList (MBS: ValuesRef).
  'quicklist.removevalues': ([ref, values], scope) => {
    const drop = new Set(listOf(scope, values));
    return changed(scope, ref, listOf(scope, ref).filter((x) => !drop.has(x)), false);
  },
  'quicklist.removeemptyitems': ([ref], scope) => changed(scope, ref, listOf(scope, ref).filter((x) => x !== ''), false),
  'quicklist.removeprefix': ([ref, fix = '', nl, sensitive], scope) => changed(scope, ref, removeFix(listOf(scope, ref), fix, false, flag(sensitive)), flag(nl)),
  'quicklist.removepostfix': ([ref, fix = '', nl, sensitive], scope) => changed(scope, ref, removeFix(listOf(scope, ref), fix, true, flag(sensitive)), flag(nl)),
  // Only reserves memory in MBS; nothing to do here.
  'quicklist.reserve': ([ref], scope) => (listOf(scope, ref), 'OK'),
  'quicklist.reverse': ([ref], scope) => changed(scope, ref, [...listOf(scope, ref)].reverse(), false),
  'quicklist.shuffle': ([ref, nl], scope) => changed(scope, ref, shuffle(listOf(scope, ref)), flag(nl)),
  'quicklist.trim': ([ref], scope) => changed(scope, ref, listOf(scope, ref).map(trimValue), false),
  'quicklist.sort': ([ref, flags], scope) => changed(scope, ref, sortValues(listOf(scope, ref), int(flags, 'flags', 0)), false),
  // Sorts the list and puts the other lists in the same new order; they have to be as long (inferred).
  'quicklist.sortwith': ([ref, flags, ...others], scope) => {
    const items = listOf(scope, ref);
    const lists = others.map((o) => listOf(scope, o));
    if (lists.some((l) => l.length !== items.length)) fail('The lists to sort with have to have as many values as the list sorted');
    const perm = sortOrder(items, int(flags, 'flags', 0));
    const changes = new Map([[(ref ?? '').trim(), perm.map((i) => items[i])]]);
    others.forEach((o, k) => changes.set((o ?? '').trim(), perm.map((i) => lists[k][i])));
    sessionOf(scope).lists.replaceMany(changes);
    return 'OK';
  },
  // Not case sensitive; "" when it isn't there.
  'quicklist.valueindex': ([ref, value = ''], scope) => {
    const i = listOf(scope, ref).findIndex((x) => x.toLowerCase() === value.toLowerCase());
    return i < 0 ? '' : i;
  },
};
MBS_QUICKLIST['quicklist.free'] = MBS_QUICKLIST['quicklist.release'];

function affix(scope: object, ref: string | undefined, fix: string, post: boolean, newList: boolean): string | number {
  const items = listOf(scope, ref);
  const chars = characters(items) + items.length * fix.length;
  reserveList(scope, ref, chars, items.length, newList);
  return changed(scope, ref, items.map(x => post ? x + fix : fix + x), newList);
}
function pop(scope: object, ref: string | undefined, first: boolean): string {
  const items = listOf(scope, ref);
  const result = (first ? items[0] : items.at(-1)) ?? '';
  editList(scope, ref, characters(items) - result.length, Math.max(0, items.length - 1), () => { if (first) items.shift(); else items.pop(); });
  return result;
}

function nextRef(s: Session): number {
  let ref = s.next;
  while (s.lists.has(String(ref))) ref++;
  return ref;
}
function reserveList(scope: object, ref: string | undefined, chars: number, count: number, newList: boolean): void {
  const s = sessionOf(scope);
  const old = newList ? undefined : listOf(scope, ref);
  if (newList) canKeep(s);
  if (count > MAX_ITEMS) fail(`A QuickList holds at most ${MAX_ITEMS} values`);
  room(s, count - (old?.length ?? 0));
  checkTextSize(chars);
  const key = newList ? String(nextRef(s)) : (ref ?? '').trim();
  const bytes = ENTRY_BYTES + stringBytes(key) + chars * 2 + count * LIST_SLOT_BYTES;
  const oldBytes = old ? ENTRY_BYTES + stringBytes(key) + characters(old) * 2 + old.length * LIST_SLOT_BYTES : 0;
  retainedBudget(scope).check(oldBytes, bytes);
}

/** Preflight every refusal before a native array edit, then publish the matching accounting synchronously. */
function editList(scope: object, ref: string | undefined, chars: number, count: number, edit: () => void): string {
  reserveList(scope, ref, chars, count, false);
  const items = listOf(scope, ref);
  edit();
  characterCounts.set(items, chars);
  sessionOf(scope).lists.set((ref ?? '').trim(), items);
  return 'OK';
}
