// FileMaker's built-in calculation functions.
//
// Each takes its arguments unevaluated, so If, Case, Choose, Let and the
// aggregates can decide what to evaluate. Names are matched without regard
// to case.

import { charCount, charsBefore, unitAt } from './text.ts';
import { rethrowExecutionRefusal } from './execution-refusal.ts';
import { substituteText } from './text-budget.ts';
import { ComplexityError } from './complexity-error.ts';
import { constants as cryptoConstants, createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, pbkdf2Sync, privateDecrypt, publicEncrypt, randomBytes, sign, verify } from 'node:crypto';
import { gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { hostname } from 'node:os';
import type { Env } from './evaluate.ts';
import { compare } from './evaluate.ts';
import { knownJavaScript } from './bejs.ts';
import { mbsHashFunctions } from './mbs-hash.ts';
import { replayMbsCall } from './mbs-replay.ts';
import { evaluateXPath, parseXmlDocument, xpathText, xpathValues, xpathXml, type XNode } from './xpath.ts';
import { canonicalXml, stripInvalidUtf16, tidyXml } from './xmltools.ts';
import { applyXslt } from './xslt.ts';
import { pdfPageCount, pdfPageRange, pdfText } from './pdf-text.ts';
import { JqError, runJq } from './jq.ts';
import { isSortLanguageName, sortKey, sortLanguage } from './collation.ts';
import { DAYS_J, hiragana, kanaHankaku, kanaZenkaku, kanjiNumeral, katakana, romanHankaku, romanZenkaku } from './japanese.ts';
import { imageInfo, isImageHeader, type ImageInfo } from './image-info.ts';
import { unzip, zip, type ZipEntry } from './zip.ts';
import { MBS_TEXT, MbsError } from './mbs-text.ts';
import { MBS_REGEX } from './mbs-regex.ts';
import { assertPatternNesting, guardedExec, guardedMatches, guardedReplace, guardedSplit, RegexTimeout, withRegexBudget } from './regex-guard.ts';
import { MBS_JSON } from './mbs-json.ts';
import { MBS_MATH } from './mbs-math.ts';
import { MBS_XML } from './mbs-xml.ts';
import { MBS_DICT, withValueText } from './mbs-dict.ts';
import { MBS_LIST } from './mbs-list.ts';
import { MBS_QUICKLIST } from './mbs-quicklist.ts';
import { MBS_CURL } from './mbs-curl.ts';
import { MBS_JS } from './mbs-js.ts';
import {
  JSON_TYPES, jsonDeleteElement, jsonFormatElements, jsonGetElement, jsonGetElementType, jsonListKeys, jsonListValues,
  jsonMakeArray, jsonParse, jsonParsedState, jsonSetElement,
} from './json.ts';
import type { Node } from './parser.ts';
import { ALL_STYLES, STYLE_BITS, restyle, rgbHex, sliceRuns, toCss, type TextFormat } from './styled.ts';
import {
  CalcError, HostWait, ERR, EMPTY, asBoolean, asDate, asNumber, asNumberOrEmpty, asText, asTime, asTimestamp, bool, dayNumber,
  decimalSum, formatNumber, fromDayNumber, isEmpty, num, numberFromText, parseDateText, parseTimeText, parseTimestampText, text, type Value,
} from './values.ts';

export interface Fn {
  min: number;
  max?: number;
  run(args: Node[], env: Env, name: string): Value;
}

export const FUNCTIONS = new Map<string, Fn>();

function def(names: string | string[], min: number, max: number | undefined, run: Fn['run']): void {
  for (const n of Array.isArray(names) ? names : [names]) FUNCTIONS.set(n.toLowerCase(), { min, max, run });
}

/** A function of evaluated arguments. */
function eager(names: string | string[], min: number, max: number | undefined, f: (v: Value[], env: Env) => Value): void {
  def(names, min, max, (args, env) => f(args.map((a) => env.v(a)), env));
}

const T = (v: Value | undefined, env: Env) => (v === undefined ? '' : env.textOf(v));
const N = (v: Value | undefined) => (v === undefined ? 0 : asNumber(v));

/** Number result, or empty when an input number is empty (FileMaker propagates empty). */
function numeric(names: string | string[], min: number, max: number, f: (...n: number[]) => number): void {
  eager(names, min, max, (v) => {
    const ns = v.map(asNumberOrEmpty);
    if (ns[0] === undefined) return EMPTY;
    // A result that is not a number (Sqrt ( -1 ), anything of 1/0) shows as "?", as in FileMaker.
    return num(f(...ns.map((n) => n ?? 0)));
  });
}

// Troi Text's documented TrText_GetLine function. FileMaker paragraphs are carriage returns;
// preserve the delimiter belonging to the selected line, and optionally add one when absent.
def('TrText_GetLine', 2, 3, (args, env) => {
  const values = args.map((arg) => env.v(arg));
  const switches = args.length === 3 ? asText(values[0], env.order) : '';
  const rawLine = asText(values[args.length === 3 ? 1 : 0], env.order);
  const lineNumber = Number(rawLine);
  const source = asText(values[args.length === 3 ? 2 : 1], env.order);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return text('');
  const lines = source.split('\r');
  if (lineNumber > lines.length) return text('');
  let result = lines[lineNumber - 1];
  if (lineNumber < lines.length) result += '\r';
  else if (source.endsWith('\r')) result += '\r';
  if (result === '' && lineNumber <= lines.length) result = '\r';
  if (/(?:^|\s)-ReturnAtEnd(?:\s|$)/i.test(switches) && !result.endsWith('\r')) result += '\r';
  return text(result);
});

// Troi Dialog documents both a return-separated rectangle and four coordinate arguments.
def('Dial_CenterPointOfRect', 2, 5, (args, env) => {
  const values = args.map((arg) => env.v(arg));
  const fields = args.length === 2 ? splitValues(asText(values[1], env.order)) : values.slice(1).map((value) => asText(value, env.order));
  if (fields.length !== 4) return text('?');
  const coordinates = fields.map((field) => Number(field.trim()));
  if (coordinates.some((value) => !Number.isFinite(value))) return text('?');
  const [left, top, width, height] = coordinates;
  return text(`${formatNumber(left + width / 2)}\r${formatNumber(top + height / 2)}`);
});

// --- values (¶-separated lists) ----------------------------------------------

export function splitValues(t: string): string[] {
  if (t === '') return [];
  // Claris: line feed, carriage return, line separator (8232) and paragraph separator (8233) all end a value.
  const parts = t.split(/\r\n|[\r\n\u2028\u2029]/);
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

const joinValues = (vs: string[]) => (vs.length ? vs.join('\r') + '\r' : '');

// --- logical -------------------------------------------------------------------

def('If', 2, 3, (a, env) => (env.bool(a[0]) ? env.v(a[1]) : a[2] ? env.v(a[2]) : EMPTY));
def('Case', 2, undefined, (a, env) => {
  for (let i = 0; i + 1 < a.length; i += 2) if (env.bool(a[i])) return env.v(a[i + 1]);
  return a.length % 2 ? env.v(a[a.length - 1]) : EMPTY;
});
def('Choose', 2, undefined, (a, env) => {
  const i = Math.trunc(env.number(a[0]));
  return i >= 0 && i + 1 < a.length ? env.v(a[i + 1]) : EMPTY;
});
def('While', 2, 2, (a, env) => {
  const [init, loop] = a as [Node & { k: 'let' }, Node & { k: 'let' }];
  return env.withWhileBudget(() => env.withScope(() => {
    for (const [n, b, r] of init.binds) env.bind(n, env.v(b), r);
    let guard = 0;
    while (env.bool(init.body)) {
      env.checkWorkBudget();
      const limit = env.recursionLimit ?? 50000;
      if (++guard > limit) throw new CalcError(ERR.recursion, env.whileBudgetMessage());
      for (const [n, b, r] of loop.binds) env.bind(n, env.v(b), r);
    }
    return env.v(loop.body);
  }));
});
def('IsEmpty', 1, 1, (a, env) => {
  try {
    return bool(isEmpty(env.v(a[0])));
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof CalcError && e.code === ERR.fieldMissing) return bool(true);
    throw e;
  }
});
def('IsValid', 1, 1, (a, env) => {
  try {
    env.v(a[0]);
    return bool(true);
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof CalcError) return bool(false);
    throw e;
  }
});
def('EvaluationError', 1, 1, (a, env) => {
  try {
    env.v(a[0]);
    return num(0);
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof CalcError) return num(e.code);
    throw e;
  }
});
def('Evaluate', 1, 2, (a, env) => {
  const src = env.text(a[0]);
  if (src.trim() === '') return EMPTY;
  return env.v(env.parse(src));
});
def('IsValidExpression', 1, 1, (a, env) => {
  try {
    env.parse(env.text(a[0]));
    return bool(true);
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof CalcError) return bool(false);
    throw e;
  }
});
def('GetField', 1, 1, (a, env) => {
  const name = env.text(a[0]);
  // GetField ( "" ) is empty, not an error; solutions use it to make an
  // auto-enter calculation re-run whenever any field changes.
  if (name === '') return EMPTY;
  const m = /^(.*?)::(.*)$/.exec(name);
  const rm = /^(.*)\[(\d+)\]$/.exec(m ? m[2] : name);
  const field = rm ? rm[1] : m ? m[2] : name;
  return env.readField({ occurrence: m?.[1] || undefined, field, repetition: rm ? Number(rm[2]) : 1 });
});
def('GetFieldName', 1, 1, (a, env) => {
  const n = a[0];
  if (n.k === 'field') return text(env.fieldName(n.occurrence, n.name));
  if (n.k === 'var' && !n.name.startsWith('$')) {
    // A custom function parameter: the field it was given, or "?" for a value.
    const given = env.fieldNameOf(n.name);
    if (given !== undefined) return text(given ?? '?');
    return text(env.fieldName(undefined, n.name));
  }
  const v = env.v(n);
  return text(env.textOf(v));
});
// GetBaseTableName ( field ): the base table behind the field's occurrence; the host knows the graph.
def('GetBaseTableName', 1, 1, (a, env, name) => {
  const field = FUNCTIONS.get('getfieldname')!.run(a, env, 'GetFieldName');
  return env.ctx.design?.(name, [field]) ?? EMPTY;
});
// SetRecursion ( expression ; maxIterations ): the expression with its own limit on custom function recursion and
// While loops (50,000 otherwise), "?" when it is passed.
def('SetRecursion', 2, 2, (a, env) => {
  const limit = Math.trunc(env.number(a[1]));
  const was = env.recursionLimit;
  env.recursionLimit = Math.max(1, limit);
  try {
    return env.v(a[0]);
  } finally {
    env.recursionLimit = was;
  }
});
def('GetRepetition', 2, 2, (a, env) => {
  const ref = env.ref(a[0]);
  const rep = Math.trunc(env.number(a[1]));
  if (!ref) return rep === 1 ? env.v(a[0]) : EMPTY;
  return env.readField({ ...ref, repetition: rep });
});
def('Extend', 1, 2, (a, env) => {
  const ref = env.ref(a[0]);
  const one = ref && (env.ctx.repetitions?.(ref) ?? 1) === 1 && (env.ctx.calculationRepetition ?? 1) > 1
    ? env.readField({ ...ref, repetition: 1 }) : env.v(a[0]);
  return isEmpty(one) && a[1] ? env.v(a[1]) : one;
});
def('Lookup', 1, 2, (a, env) => {
  const v = env.v(a[0]);
  return isEmpty(v) && a[1] ? env.v(a[1]) : v;
});
// LookupNext ( sourceField ; Lower|Higher ): Lookup's value, or with no related record the one whose match value is
// the next lower or higher. Lower and Higher are keywords, so they aren't evaluated.
def('LookupNext', 2, 2, (a, env) => {
  const v = env.v(a[0]);
  if (!isEmpty(v)) return v;
  const ref = env.ref(a[0]);
  const flag = a[1];
  const word = flag.k === 'var' || flag.k === 'field' ? flag.name.toLowerCase() : env.text(flag).toLowerCase();
  if (!ref || (word !== 'lower' && word !== 'higher')) return EMPTY;
  return env.ctx.lookupNext?.(ref, word) ?? EMPTY;
});
def('Last', 1, 1, (a, env) => {
  const vs = env.values(a[0]).filter((v) => !isEmpty(v));
  return vs[vs.length - 1] ?? EMPTY;
});
def('GetNthRecord', 2, 2, (a, env) => {
  const n = Math.trunc(env.number(a[1]));
  const ref = env.ref(a[0]);
  if (ref?.occurrence !== undefined) return env.values(a[0])[n - 1] ?? EMPTY;
  const v = env.ctx.get?.(`GetNthRecord:${n}:${ref?.field ?? ''}`);
  return v ?? (n === 1 ? env.v(a[0]) : EMPTY);
});
def('GetSummary', 2, 2, (a, env) => {
  const ref = env.ref(a[0]);
  // The break field is a field, or (from GetFieldName) its name as text.
  let brk = env.ref(a[1]);
  if (!brk) {
    const m = /^(?:(.*?)::)?(.*)$/.exec(env.text(a[1]));
    // Text with a line break in it is not the name of a field.
    if (!m) return text('?');
    brk = { occurrence: m[1] && m[1].toLowerCase() !== env.ctx.occurrence?.toLowerCase() ? m[1] : undefined, field: m[2], repetition: 1 };
  }
  const v = ref && env.ctx.summary?.(ref, brk);
  return v ?? env.v(a[0]);
});
def('Self', 0, 0, (_a, env) => env.ctx.get?.('Self') ?? EMPTY);
def('Get', 1, 1, () => EMPTY); // parsed specially; this only catches Get with an expression
def('[]', 1, undefined, (a, env) => env.v(a[0]));

// --- text ----------------------------------------------------------------------

// Left, Right and Middle keep the formatting of the characters they return, as in FileMaker.
const part = (v: Value, env: Env, start: number, end: number): Value => {
  const t = T(v, env);
  const from = unitAt(t, Math.max(0, start));
  const to = Math.max(from, unitAt(t, Math.max(0, end)));
  const runs = v.type === 'text' && v.runs?.length ? sliceRuns(v.runs, from, to) : [];
  return runs.length ? { type: 'text', value: t.slice(from, to), runs } : text(t.slice(from, to));
};
eager('Left', 2, 2, (v, env) => part(v[0], env, 0, Math.max(0, Math.trunc(N(v[1])))));
eager('Right', 2, 2, (v, env) => {
  const n = Math.max(0, Math.trunc(N(v[1])));
  const len = charCount(T(v[0], env));
  return n ? part(v[0], env, len - n, len) : EMPTY;
});
eager('Middle', 3, 3, (v, env) => {
  const start = Math.max(1, Math.trunc(N(v[1]))) - 1;
  return part(v[0], env, start, start + Math.max(0, Math.trunc(N(v[2]))));
});
eager('Length', 1, 1, (v, env) => (isEmpty(v[0]) ? num(0) : num(charCount(T(v[0], env)))));
eager('Upper', 1, 1, (v, env) => text(T(v[0], env).toUpperCase()));
eager('Lower', 1, 1, (v, env) => text(T(v[0], env).toLowerCase()));
eager('Proper', 1, 1, (v, env) => text(T(v[0], env).toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_m, p, c) => p + c.toUpperCase())));
eager('Trim', 1, 1, (v, env) => text(T(v[0], env).replace(/^ +| +$/g, '')));
eager('TrimAll', 1, 3, (v, env) => {
  const t = T(v[0], env);
  // trimSpaces includes full-width spaces; trimType 3 removes every space.
  const sp = v[1] !== undefined && N(v[1]) ? '[ \u3000]' : ' ';
  if (v[2] !== undefined && Math.trunc(N(v[2])) === 3) return text(t.replace(new RegExp(sp, 'g'), ''));
  return text(t.replace(new RegExp(`${sp}{2,}`, 'g'), ' ').replace(new RegExp(`^${sp}+|${sp}+$`, 'g'), ''));
});
eager('Exact', 2, 2, (v, env) => bool(T(v[0], env) === T(v[1], env)));
eager('Filter', 2, 2, (v, env) => {
  const keep = new Set(T(v[1], env));
  return text([...T(v[0], env)].filter((c) => keep.has(c)).join(''));
});
def('Substitute', 2, undefined, (a, env) => {
  let t = env.text(a[0]);
  const pairs: [string, string][] = [];
  const pair = (n: Node) => n.k === 'call' && n.name === '[]';
  if (a.length === 3 && !pair(a[1])) pairs.push([env.text(a[1]), env.text(a[2])]);
  else {
    for (const p of a.slice(1)) {
      if (p.k !== 'call' || p.name !== '[]' || p.args.length !== 2) throw new CalcError(ERR.calculation, 'Substitute needs [search ; replace] pairs');
      pairs.push([env.text(p.args[0]), env.text(p.args[1])]);
    }
  }
  try {
    for (const [s, r] of pairs) t = substituteText(t, s, r);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    throw new ComplexityError(e.message);
  }
  return text(t);
});
eager('Replace', 4, 4, (v, env) => {
  const t = T(v[0], env);
  const start = Math.max(1, Math.trunc(N(v[1]))) - 1;
  return text(t.slice(0, unitAt(t, start)) + T(v[3], env) + t.slice(unitAt(t, start + Math.max(0, Math.trunc(N(v[2]))))));
});
eager('Position', 4, 4, (v, env) => {
  const t = T(v[0], env).toLowerCase();
  const s = T(v[1], env).toLowerCase();
  let start = Math.trunc(N(v[2]));
  const occ = Math.trunc(N(v[3]));
  if (s === '' || occ === 0) return num(0);
  // Offsets inside t are UTF-16 units; start and the answer count characters.
  if (occ > 0) {
    let at = unitAt(t, Math.max(0, start - 1));
    for (let k = 0; k < occ; k++) {
      const found = t.indexOf(s, at);
      if (found < 0) return num(0);
      if (k === occ - 1) return num(charsBefore(t, found) + 1);
      at = found + 1;
    }
  } else {
    const chars = charCount(t);
    if (start > chars) start = chars;
    let at = unitAt(t, start - 1);
    for (let k = 0; k < -occ; k++) {
      const found = t.lastIndexOf(s, at);
      if (found < 0) return num(0);
      if (k === -occ - 1) return num(charsBefore(t, found) + 1);
      at = found - 1;
    }
  }
  return num(0);
});
eager('PatternCount', 2, 2, (v, env) => {
  const t = T(v[0], env).toLowerCase();
  const s = T(v[1], env).toLowerCase();
  if (!s) return num(0);
  let n = 0;
  // Claris: each non-overlapping occurrence counts, so "aaaa" holds "aa" twice.
  for (let at = t.indexOf(s); at >= 0; at = t.indexOf(s, at + s.length)) n++;
  return num(n);
});
eager('Quote', 1, 1, (v, env) => text('"' + T(v[0], env).replace(/[\\"]/g, '\\$&').replace(/\r/g, '\\\r') + '"'));
eager('Char', 1, 1, (v) => {
  const digits = String(Math.trunc(Math.abs(N(v[0]))));
  let out = '';
  for (let end = digits.length; end > 0; end -= 5) {
    const code = Number(digits.slice(Math.max(0, end - 5), end));
    if (code) out += String.fromCodePoint(code);
  }
  return text(out);
});
eager('Code', 1, 1, (v, env) => {
  const chars = [...T(v[0], env)];
  if (!chars.length) return EMPTY;
  // First character in the lowest five digits.
  return text(chars.map((c) => String(c.codePointAt(0)).padStart(5, '0')).reverse().join('').replace(/^0+/, '') || '0');
});
eager('SerialIncrement', 2, 2, (v, env) => {
  const t = T(v[0], env);
  const m = /^(.*?)(\d+)(\D*)$/.exec(t);
  if (!m) return text(t);
  const next = String(Number(m[2]) + Math.trunc(N(v[1])));
  return text(m[1] + next.padStart(m[2].length, '0') + m[3]);
});
// 1,000 is one word, as FileMaker counts it; a comma between letters splits.
const WORD = /[\p{L}\p{N}_]+(?:(?:['’.]|(?<=\p{N}),(?=\p{N}))[\p{L}\p{N}_]+)*/gu;
const words = (t: string) => t.match(WORD) ?? [];
eager('WordCount', 1, 1, (v, env) => num(words(T(v[0], env)).length));
eager('LeftWords', 2, 2, (v, env) => wordSlice(T(v[0], env), 0, Math.trunc(N(v[1]))));
eager('RightWords', 2, 2, (v, env) => {
  const n = Math.trunc(N(v[1]));
  const count = words(T(v[0], env)).length;
  return wordSlice(T(v[0], env), Math.max(0, count - n), n);
});
eager('MiddleWords', 3, 3, (v, env) => wordSlice(T(v[0], env), Math.max(0, Math.trunc(N(v[1])) - 1), Math.trunc(N(v[2]))));
/** Text from the start of word `from` to the end of word from+count-1, keeping what lies between. */
function wordSlice(t: string, from: number, count: number): Value {
  if (count <= 0) return EMPTY;
  const ms = [...t.matchAll(WORD)];
  const first = ms[from];
  const last = ms[Math.min(ms.length, from + count) - 1];
  if (!first || !last) return EMPTY;
  return text(t.slice(first.index!, last.index! + last[0].length));
}

// Values: ¶-separated lists.
eager('ValueCount', 1, 1, (v, env) => num(splitValues(T(v[0], env)).length));
eager('GetValue', 2, 2, (v, env) => text(splitValues(T(v[0], env))[Math.trunc(N(v[1])) - 1] ?? ''));
eager('LeftValues', 2, 2, (v, env) => text(joinValues(splitValues(T(v[0], env)).slice(0, Math.max(0, Math.trunc(N(v[1])))))));
eager('RightValues', 2, 2, (v, env) => {
  const n = Math.max(0, Math.trunc(N(v[1])));
  return text(joinValues(n ? splitValues(T(v[0], env)).slice(-n) : []));
});
eager('MiddleValues', 3, 3, (v, env) => {
  const start = Math.max(1, Math.trunc(N(v[1])));
  return text(joinValues(splitValues(T(v[0], env)).slice(start - 1, start - 1 + Math.max(0, Math.trunc(N(v[2]))))));
});
eager('FilterValues', 2, 2, (v, env) => {
  const keep = new Set(splitValues(T(v[1], env)).map((s) => s.toLowerCase()));
  return text(joinValues(splitValues(T(v[0], env)).filter((s) => keep.has(s.toLowerCase()))));
});
// SortValues and UniqueValues ( values {; datatype ; locale } ): datatype 1 text, 2 number, 3 date, 4 time, 5 timestamp
// (negative sorts descending), and a locale named in Claris Pro Help ("SortValues"); one that isn't answers "?". Values
// that don't read as the given type keep to text and sort after those that do. A locale sorts text in its language's order
// (collation.ts: ICU's order standing in for Claris's, unverified except English and Japanese); none, or a blank one, is English.
const validLocale = (v: Value[], env: Env): boolean => {
  if (v[2] === undefined) return true;
  const name = T(v[2], env).trim().toLowerCase();
  return name === '' || isSortLanguageName(name);
};
/** The number a value stands for under datatype 2 to 5, or undefined when it doesn't read as one. */
function typedNumber(s: string, kind: number, env: Env): number | undefined {
  switch (kind) {
    case 2: return numberFromText(s);
    case 3: return parseDateText(s, env.order);
    case 4: return parseTimeText(s);
    case 5: return parseTimestampText(s, env.order);
    default: return undefined;
  }
}
eager('UniqueValues', 1, 3, (v, env) => {
  if (!validLocale(v, env)) return text('?');
  const seen = new Set<string>();
  const out: string[] = [];
  const kind = v[1] === undefined ? 1 : Math.abs(Math.trunc(N(v[1])));
  for (const s of splitValues(T(v[0], env))) {
    // With a number, date, time or timestamp type, 18 and 18.0 (or 7/4/2026 and 07/04/2026) are one value.
    const n = typedNumber(s, kind, env);
    const k = n !== undefined ? `#${n}` : s.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return text(joinValues(out));
});
eager('SortValues', 1, 3, (v, env) => {
  if (!validLocale(v, env)) return text('?');
  const type = v[1] === undefined ? 1 : Math.trunc(N(v[1]));
  const vals = splitValues(T(v[0], env));
  const desc = type < 0;
  const kind = Math.abs(type);
  const language = sortLanguage(v[2] === undefined ? '' : T(v[2], env));
  // English keeps the evaluator's own text comparison; another language compares the keys its order gives.
  const compareText = (x: string, y: string): number => {
    if (language === 'en') return compare(text(x), text(y));
    const kx = sortKey(x, language);
    const ky = sortKey(y, language);
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  };
  if (kind < 2 || kind > 5) {
    vals.sort((x, y) => (desc ? -1 : 1) * compareText(x, y));
    return text(joinValues(vals));
  }
  const keyed = vals.map((s) => ({ s, n: typedNumber(s, kind, env) }));
  keyed.sort((x, y) => {
    if (x.n === undefined || y.n === undefined) return x.n === y.n ? compareText(x.s, y.s) : x.n === undefined ? 1 : -1;
    return (desc ? -1 : 1) * (x.n - y.n);
  });
  return text(joinValues(keyed.map((k) => k.s)));
});
def('List', 1, undefined, (a, env) => {
  const out: string[] = [];
  for (const arg of a) for (const v of env.values(arg)) if (!isEmpty(v)) out.push(env.textOf(v));
  return text(out.join('\r'));
});

// --- text formatting -----------------------------------------------------------
// The text keeps its characters; the formatting rides along as runs (styled.ts), shown in layouts and by GetAsCSS.

/** The text of `v` with each run's format changed by `f`. */
const formatted = (v: Value, env: Env, f: (format: TextFormat) => TextFormat): Value => {
  const t = T(v, env);
  const runs = restyle(v.type === 'text' ? v.runs : undefined, t.length, f);
  return runs.length ? { type: 'text', value: t, runs } : text(t);
};
const styleBits = (v: Value) => Math.max(0, Math.trunc(N(v))) & ALL_STYLES;
// Plain alone removes every style; mixed with others it is ignored.
eager('TextStyleAdd', 2, 2, (v, env) => {
  const bits = styleBits(v[1]);
  return formatted(v[0], env, (f) => ({ ...f, style: bits ? (f.style ?? 0) | bits : 0 }));
});
eager('TextStyleRemove', 2, 2, (v, env) => {
  const bits = styleBits(v[1]);
  return formatted(v[0], env, (f) => ({ ...f, style: (f.style ?? 0) & ~bits }));
});
eager('TextColor', 2, 2, (v, env) => {
  const color = rgbHex(N(v[1]));
  return formatted(v[0], env, (f) => ({ ...f, color }));
});
eager('TextColorRemove', 1, 2, (v, env) => {
  const only = v.length > 1 ? rgbHex(N(v[1])) : undefined;
  return formatted(v[0], env, (f) => (only === undefined || f.color === only ? { ...f, color: undefined } : f));
});
eager('TextFont', 2, 3, (v, env) => {
  const font = T(v[1], env);
  return formatted(v[0], env, (f) => ({ ...f, font: font || undefined }));
});
eager('TextFontRemove', 1, 3, (v, env) => {
  const only = v.length > 1 ? T(v[1], env).toLowerCase() : undefined;
  return formatted(v[0], env, (f) => (only === undefined || f.font?.toLowerCase() === only ? { ...f, font: undefined } : f));
});
eager('TextSize', 2, 2, (v, env) => {
  const size = Math.trunc(N(v[1]));
  return formatted(v[0], env, (f) => ({ ...f, size: size > 0 ? size : undefined }));
});
eager('TextSizeRemove', 1, 2, (v, env) => {
  const only = v.length > 1 ? Math.trunc(N(v[1])) : undefined;
  return formatted(v[0], env, (f) => (only === undefined || f.size === only ? { ...f, size: undefined } : f));
});
eager('TextFormatRemove', 1, 1, (v, env) => text(T(v[0], env)));
// Style names for TextStyleAdd / TextStyleRemove, as bits that + combines. (Extend is also a function
// name, so as a style it falls back to the function and is not listed.)
for (const style of ['Plain', 'Bold', 'Italic', 'Underline', 'HighlightYellow', 'Condense', 'Strikethrough', 'SmallCaps',
  'Superscript', 'Subscript', 'Uppercase', 'Lowercase', 'Titlecase', 'WordUnderline', 'DoubleUnderline', 'AllStyles']) {
  const bits = style === 'AllStyles' ? ALL_STYLES : STYLE_BITS[style.toLowerCase()];
  eager(style, 0, 0, () => num(bits));
}
eager('RGB', 3, 3, (v) => num(Math.trunc(N(v[0])) * 65536 + Math.trunc(N(v[1])) * 256 + Math.trunc(N(v[2]))));
eager('GetAsCSS', 1, 1, (v, env) => text(toCss(T(v[0], env), v[0].type === 'text' ? v[0].runs : undefined)));
eager('GetAsSVG', 1, 1, (v, env) => text(T(v[0], env)));
eager('GetAsURLEncoded', 1, 1, (v, env) => text(encodeURIComponent(T(v[0], env))));

// --- conversion ----------------------------------------------------------------

eager('GetAsText', 1, 1, (v, env) => text(T(v[0], env)));
eager('GetAsNumber', 1, 1, (v) => {
  const n = asNumberOrEmpty(v[0]);
  return n === undefined ? EMPTY : num(n);
});
eager('GetAsBoolean', 1, 1, (v) => bool(asBoolean(v[0])));
eager('GetAsDate', 1, 1, (v, env) => {
  const d = asDate(v[0], env.order);
  return d === undefined ? EMPTY : { type: 'date', value: d };
});
eager('GetAsTime', 1, 1, (v) => {
  const t = asTime(v[0]);
  return t === undefined ? EMPTY : { type: 'time', value: t };
});
eager('GetAsTimestamp', 1, 1, (v, env) => {
  const t = asTimestamp(v[0], env.order);
  return t === undefined ? EMPTY : { type: 'timestamp', value: t };
});

// --- numbers -------------------------------------------------------------------

const roundTo = (n: number, places: number, f: (x: number) => number) => {
  const p = Math.pow(10, places);
  // Round half away from zero; the small epsilon absorbs binary representation error.
  return f(Number((Math.abs(n) * p).toPrecision(15))) / p * Math.sign(n);
};
numeric('Abs', 1, 1, Math.abs);
numeric('Ceiling', 1, 1, Math.ceil);
numeric('Floor', 1, 1, Math.floor);
numeric('Int', 1, 1, Math.trunc);
numeric('Round', 2, 2, (n, p) => roundTo(n, Math.trunc(p), (x) => Math.floor(x + 0.5)));
numeric('Truncate', 2, 2, (n, p) => roundTo(n, Math.trunc(p), Math.floor));
numeric('SetPrecision', 2, 2, (n) => n);
// By zero these give "?", like the / operator.
numeric('Mod', 2, 2, (n, d) => (d === 0 ? NaN : n - d * Math.floor(n / d)));
numeric('Div', 2, 2, (n, d) => (d === 0 ? NaN : Math.floor(n / d)));
numeric('Sign', 1, 1, Math.sign);
numeric('Sqrt', 1, 1, Math.sqrt);
numeric('Exp', 1, 1, Math.exp);
numeric('Ln', 1, 1, Math.log);
numeric('Log', 1, 1, Math.log10);
numeric('Lg', 1, 1, Math.log2);
numeric('Sin', 1, 1, Math.sin);
numeric('Cos', 1, 1, Math.cos);
numeric('Tan', 1, 1, Math.tan);
numeric('Asin', 1, 1, Math.asin);
numeric('Acos', 1, 1, Math.acos);
numeric('Atan', 1, 1, Math.atan);
numeric('Degrees', 1, 1, (r) => (r * 180) / Math.PI);
numeric('Radians', 1, 1, (d) => (d * Math.PI) / 180);
numeric('Factorial', 1, 2, (n, k) => {
  let r = 1;
  const stop = k ? Math.max(0, n - k) : 0;
  for (let i = Math.trunc(n); i > stop; i--) r *= i;
  return r;
});
numeric('Combination', 2, 2, (n, k) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
});
numeric('PMT', 3, 3, (p, r, t) => (r === 0 ? p / t : (p * r) / (1 - Math.pow(1 + r, -t))));
numeric('FV', 3, 3, (pmt, r, n) => (r === 0 ? pmt * n : (pmt * (Math.pow(1 + r, n) - 1)) / r));
numeric('PV', 3, 3, (pmt, r, n) => (r === 0 ? pmt * n : (pmt * (1 - Math.pow(1 + r, -n))) / r));
eager('Random', 0, 0, () => num(Math.random()));
def('NPV', 2, 2, (a, env) => {
  const pays = env.values(a[0]).map(asNumber);
  const r = env.number(a[1]);
  return num(pays.reduce((s, p, i) => s + p / Math.pow(1 + r, i + 1), 0));
});

/** Numbers an aggregate sees: every argument's values, skipping empty ones. */
function aggregateNumbers(a: Node[], env: Env): number[] {
  const out: number[] = [];
  for (const arg of a) for (const v of env.values(arg)) {
    const n = asNumberOrEmpty(v);
    if (n !== undefined && !isEmpty(v)) out.push(n);
  }
  return out;
}
function aggregate(name: string, f: (ns: number[]) => number | undefined): void {
  def(name, 1, undefined, (a, env) => {
    const r = f(aggregateNumbers(a, env));
    return r === undefined ? EMPTY : num(r);
  });
}
aggregate('Sum', (ns) => decimalSum(ns));
aggregate('Average', (ns) => (ns.length ? decimalSum(ns) / ns.length : undefined));
const variance = (ns: number[], sample: boolean) => {
  if (ns.length === 0) return undefined;
  // Claris: the standard deviation of a single value is undefined, an error (the sample forms only).
  if (sample && ns.length === 1) return NaN;
  const mean = ns.reduce((s, n) => s + n, 0) / ns.length;
  return ns.reduce((s, n) => s + (n - mean) ** 2, 0) / (ns.length - (sample ? 1 : 0));
};
aggregate('Variance', (ns) => variance(ns, true));
aggregate('VarianceP', (ns) => variance(ns, false));
aggregate('StDev', (ns) => {
  const v = variance(ns, true);
  return v === undefined ? undefined : Math.sqrt(v);
});
aggregate('StDevP', (ns) => {
  const v = variance(ns, false);
  return v === undefined ? undefined : Math.sqrt(v);
});
def('Count', 1, undefined, (a, env) => {
  let n = 0;
  for (const arg of a) for (const v of env.values(arg)) if (!isEmpty(v)) n++;
  return num(n);
});
// Max and Min also compare dates, times and text.
for (const [name, sign] of [['Max', 1], ['Min', -1]] as const) {
  def(name, 1, undefined, (a, env) => {
    let best: Value | undefined;
    for (const arg of a) for (const v of env.values(arg)) {
      if (isEmpty(v)) continue;
      if (!best || sign * compare(v, best, env.order) > 0) best = v;
    }
    return best ?? EMPTY;
  });
}

// --- dates and times -------------------------------------------------------------

eager('Date', 3, 3, (v) => {
  if (v.every(isEmpty)) return EMPTY;
  return { type: 'date', value: dayNumber(Math.trunc(N(v[2])), Math.trunc(N(v[0])), Math.trunc(N(v[1]))) };
});
eager('Time', 3, 3, (v) => {
  if (v.every(isEmpty)) return EMPTY;
  return { type: 'time', value: N(v[0]) * 3600 + N(v[1]) * 60 + N(v[2]) };
});
eager('Timestamp', 2, 2, (v, env) => {
  const d = asDate(v[0], env.order);
  const t = asTime(v[1]);
  // A time without a date is an error ("?"), as FileMaker stored for Timestamp ( "" ; 0 ).
  if (d === undefined) return t === undefined ? EMPTY : text('?');
  return { type: 'timestamp', value: (d - 1) * 86400 + (t ?? 0) };
});
function dateFn(name: string, f: (d: ReturnType<typeof fromDayNumber>, day: number) => Value): void {
  eager(name, 1, 1, (v, env) => {
    const d = asDate(v[0], env.order);
    return d === undefined ? EMPTY : f(fromDayNumber(d), d);
  });
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
dateFn('Day', (d) => num(d.day));
dateFn('Month', (d) => num(d.month));
dateFn('Year', (d) => num(d.year));
dateFn('DayOfWeek', (d) => num(d.weekday));
dateFn('DayName', (d) => text(DAYS[d.weekday - 1]));
dateFn('MonthName', (d) => text(MONTHS[d.month - 1]));
dateFn('DayNameJ', (d) => text(DAYS_J[d.weekday - 1]));
// Inferred: Claris shows MonthNameJ's result only as a picture; Japanese writes the month number and 月.
dateFn('MonthNameJ', (d) => text(`${d.month}月`));
dateFn('DayOfYear', (d, day) => num(day - dayNumber(d.year, 1, 1) + 1));
// Week 1 holds January 1 and weeks start on Sunday, as FileMaker's WeekOfYear counts.
dateFn('WeekOfYear', (d, day) => {
  const jan1 = dayNumber(d.year, 1, 1);
  const offset = fromDayNumber(jan1).weekday - 1;
  return num(Math.floor((day - jan1 + offset) / 7) + 1);
});
eager('WeekOfYearFiscal', 2, 2, (v, env) => {
  const day = asDate(v[0], env.order);
  if (day === undefined) return EMPTY;
  const start = Math.trunc(N(v[1])) || 1;
  // ISO-like: the first week has at least four days of the new year, weeks start on `start`.
  const { year } = fromDayNumber(day);
  const firstWeekStart = (y: number) => {
    const jan1 = dayNumber(y, 1, 1);
    const wd = fromDayNumber(jan1).weekday;
    const back = (wd - start + 7) % 7;
    const s = jan1 - back;
    return back > 3 ? s + 7 : s;
  };
  let s = firstWeekStart(year);
  if (day < s) s = firstWeekStart(year - 1);
  else if (day >= firstWeekStart(year + 1)) s = firstWeekStart(year + 1);
  return num(Math.floor((day - s) / 7) + 1);
});
function timeFn(name: string, f: (seconds: number) => number): void {
  eager(name, 1, 1, (v) => {
    const t = asTime(v[0]);
    return t === undefined ? EMPTY : num(f(t));
  });
}
timeFn('Hour', (s) => Math.floor(s / 3600));
timeFn('Minute', (s) => Math.floor((s % 3600) / 60));
timeFn('Seconds', (s) => s % 60);

// --- JSON ----------------------------------------------------------------------

for (const [name, n] of Object.entries(JSON_TYPES)) def(name, 0, 0, () => num(n));
eager('JSONGetElement', 2, 2, (v, env) => jsonGetElement(T(v[0], env), v[1]));
eager('JSONDeleteElement', 2, 2, (v, env) => jsonDeleteElement(T(v[0], env), v[1]));
eager('JSONListKeys', 2, 2, (v, env) => jsonListKeys(T(v[0], env), v[1]));
eager('JSONListValues', 2, 2, (v, env) => jsonListValues(T(v[0], env), v[1]));
eager('JSONGetElementType', 2, 2, (v, env) => jsonGetElementType(T(v[0], env), v[1]));
eager('JSONFormatElements', 1, 1, (v, env) => jsonFormatElements(T(v[0], env)));
eager('JSONParse', 1, 1, (v, env) => jsonParse(T(v[0], env)));
eager('JSONParsedState', 1, 1, (v) => num(jsonParsedState(v[0])));
eager('JSONMakeArray', 2, 3, (v, env) => jsonMakeArray(T(v[0], env), T(v[1], env), v[2] ? N(v[2]) : 0));
def('JSONSetElement', 2, undefined, (a, env) => {
  const json = env.text(a[0]);
  const triples: [Value, Value, number][] = [];
  const isTriple = (x: Node) => x.k === 'call' && x.name === '[]';
  if (isTriple(a[1])) {
    for (const t of a.slice(1)) {
      if (t.k !== 'call' || t.name !== '[]' || t.args.length !== 3) throw new CalcError(ERR.calculation, 'JSONSetElement needs [key ; value ; type] triples');
      triples.push([env.v(t.args[0]), env.v(t.args[1]), env.number(t.args[2])]);
    }
  } else {
    if (a.length !== 4) throw new CalcError(a.length < 4 ? ERR.tooFewParameters : ERR.tooManyParameters, 'JSONSetElement needs json ; key ; value ; type');
    triples.push([env.v(a[1]), env.v(a[2]), env.number(a[3])]);
  }
  return jsonSetElement(json, triples);
});

// --- encoding and hashing --------------------------------------------------------

// A container's bytes; a file stored outside that is missing (changed, and no bytes) has none, rather than its name's.
const bytesOf = (v: Value, env: Env): Uint8Array =>
  v.type === 'container' && v.data ? v.data : v.type === 'container' && v.changed ? new Uint8Array(0) : new TextEncoder().encode(T(v, env));
const binary = (data: Uint8Array): Value => ({ type: 'container', value: '', data });

eager('Base64Encode', 1, 1, (v, env) => text(Buffer.from(bytesOf(v[0], env)).toString('base64').replace(/(.{76})(?=.)/g, '$1\r')));
// OpenPGP's 24-bit CRC (RFC 4880 section 6.1) of the data, as the four Base64 characters that follow "=".
function crc24(data: Uint8Array): string {
  let crc = 0xb704ce;
  for (const byte of data) {
    crc ^= byte << 16;
    for (let i = 0; i < 8; i++) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
  }
  return Buffer.from([(crc >> 16) & 255, (crc >> 8) & 255, crc & 255]).toString('base64');
}
// Claris (Base64EncodeRFC): 1421 wraps lines at 64 characters with CRLF; 2045 at 76; 3548 and 4648 add no line breaks;
// 4880 wraps at 76 and appends a 24-bit CRC; any other number is 4648.
eager('Base64EncodeRFC', 2, 2, (v, env) => {
  const rfc = Math.trunc(N(v[0]));
  const data = bytesOf(v[1], env);
  const s = Buffer.from(data).toString('base64');
  const wrap = (n: number) => s.replace(new RegExp(`(.{${n}})(?=.)`, 'g'), '$1\r\n');
  if (rfc === 1421) return text(wrap(64));
  if (rfc === 2045) return text(wrap(76));
  // The CRC goes on a line of its own after the data, as OpenPGP armor puts it.
  if (rfc === 4880) return text(`${wrap(76)}\r\n=${crc24(data)}`);
  return text(s);
});
eager('Base64Decode', 1, 2, (v, env) => {
  const data = Buffer.from(T(v[0], env).replace(/\s/g, ''), 'base64');
  return v[1] === undefined ? text(data.toString('utf8')) : { type: 'container', value: T(v[1], env), data };
});
eager('HexEncode', 1, 1, (v, env) => text(Buffer.from(bytesOf(v[0], env)).toString('hex').toUpperCase()));
eager('HexDecode', 1, 2, (v, env) => {
  const data = Buffer.from(T(v[0], env).replace(/\s/g, ''), 'hex');
  return v[1] === undefined ? text(data.toString('utf8')) : { type: 'container', value: T(v[1], env), data };
});
eager('CryptDigest', 2, 2, (v, env) => {
  const algo = T(v[1], env).toLowerCase().replace('-', '');
  if (!['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'].includes(algo)) return EMPTY;
  return binary(createHash(algo).update(bytesOf(v[0], env)).digest());
});
// CryptAuthCode and the RSA signature functions take the same algorithm names; an empty one is SHA512.
const CRYPT_ALGORITHMS = new Set(['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512']);
const cryptAlgorithm = (v: Value, env: Env): string | undefined => {
  const name = T(v, env).toLowerCase().replace('-', '') || 'sha512';
  return CRYPT_ALGORITHMS.has(name) ? name : undefined;
};
eager('CryptAuthCode', 3, 3, (v, env) => {
  const algo = cryptAlgorithm(v[1], env);
  if (!algo) return text('?');
  return binary(createHmac(algo, bytesOf(v[2], env)).update(bytesOf(v[0], env)).digest());
});
// RSA PKCS #1 v1.5 signatures of the data's digest. A key that can't be read, or isn't RSA, gives "?".
eager('CryptGenerateSignature', 4, 4, (v, env) => {
  const algo = cryptAlgorithm(v[1], env);
  if (!algo) return text('?');
  try {
    const key = createPrivateKey({ key: T(v[2], env), format: 'pem', passphrase: T(v[3], env) });
    if (key.asymmetricKeyType !== 'rsa') return text('?');
    return binary(sign(algo, bytesOf(v[0], env), key));
  } catch {
    return text('?');
  }
});
eager('CryptVerifySignature', 4, 4, (v, env) => {
  const algo = cryptAlgorithm(v[1], env);
  if (!algo) return text('?');
  try {
    // Only a public key: node would also take a private key here and work out its public half.
    const pem = T(v[2], env);
    if (!/-----BEGIN (RSA )?PUBLIC KEY-----/.test(pem)) return text('?');
    const key = createPublicKey({ key: pem, format: 'pem' });
    if (key.asymmetricKeyType !== 'rsa') return text('?');
    return num(verify(algo, bytesOf(v[0], env), key, bytesOf(v[3], env)) ? 1 : 0);
  } catch {
    return text('?');
  }
});
// CryptEncrypt and CryptDecrypt (and their Base64 forms). Claris documents AES-256 but not the byte format, so data
// encrypted by FileMaker doesn't decrypt here; what Tabularius encrypts, it decrypts. The format: "OHBC" 1, a type byte
// (0 text, 1 container), the container's file name (2-byte length, UTF-8), a 16-byte salt, a 12-byte IV, then
// AES-256-GCM of the data with its 16-byte tag; the key is PBKDF2-SHA256 of the key text and salt. Decrypting gives
// the data back as the type it was. A wrong key or data that isn't this format gives empty (inferred: Claris doesn't say).
const CRYPT_MAGIC = Buffer.from('OHBC\x01', 'latin1');
const cryptKey = (key: string, salt: Uint8Array) => pbkdf2Sync(key, salt, 10000, 32, 'sha256');
const cryptEncrypt = (v: Value[], env: Env): Buffer => {
  const container = v[0].type === 'container' && !!v[0].data;
  const name = Buffer.from(container ? String(v[0].value).replace(/^.*\//, '') : '', 'utf8');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cryptKey(T(v[1], env), salt), iv);
  const body = Buffer.concat([c.update(bytesOf(v[0], env)), c.final()]);
  const head = Buffer.alloc(3);
  head[0] = container ? 1 : 0;
  head.writeUInt16BE(Math.min(name.length, 0xffff), 1);
  return Buffer.concat([CRYPT_MAGIC, head, name.subarray(0, 0xffff), salt, iv, body, c.getAuthTag()]);
};
const cryptDecrypt = (data: Uint8Array, key: string): Value => {
  const b = Buffer.from(data);
  if (b.length < 8 || !b.subarray(0, 5).equals(CRYPT_MAGIC)) return EMPTY;
  const kind = b[5];
  const nameEnd = 8 + b.readUInt16BE(6);
  if (b.length < nameEnd + 44) return EMPTY;
  const salt = b.subarray(nameEnd, nameEnd + 16);
  const iv = b.subarray(nameEnd + 16, nameEnd + 28);
  try {
    const d = createDecipheriv('aes-256-gcm', cryptKey(key, salt), iv);
    d.setAuthTag(b.subarray(b.length - 16));
    const out = Buffer.concat([d.update(b.subarray(nameEnd + 28, b.length - 16)), d.final()]);
    return kind === 1
      ? { type: 'container', value: b.subarray(8, nameEnd).toString('utf8'), data: new Uint8Array(out) }
      : text(out.toString('utf8'));
  } catch {
    return EMPTY;
  }
};
eager('CryptEncrypt', 2, 2, (v, env) => ({ type: 'container', value: 'encrypted.data', data: new Uint8Array(cryptEncrypt(v, env)) }));
eager('CryptEncryptBase64', 2, 2, (v, env) => text(cryptEncrypt(v, env).toString('base64')));
eager('CryptDecrypt', 2, 2, (v, env) => (v[0].type === 'container' && v[0].data ? cryptDecrypt(v[0].data, T(v[1], env)) : EMPTY));
eager('CryptDecryptBase64', 2, 2, (v, env) => cryptDecrypt(Buffer.from(T(v[0], env).replace(/\s/g, ''), 'base64'), T(v[1], env)));
eager('TextEncode', 1, 3, (v, env) => ({ type: 'container', value: 'Untitled.txt', data: new TextEncoder().encode(T(v[0], env)) }));
eager('TextDecode', 1, 2, (v, env) => text(new TextDecoder().decode(bytesOf(v[0], env))));
// FileMaker 2025: "?" for an empty container, a file that isn't a PDF, an encrypted one, or one with no text.
eager('GetTextFromPDF', 1, 1, (v) => {
  const t = v[0].type === 'container' && v[0].data ? pdfText(v[0].data) : undefined;
  return text(t ?? '?');
});
// BE_PDFPageCount ( pdf ): the number of pages; "?" (error -1) for a container that is not a readable, unencrypted PDF.
eager('BE_PDFPageCount', 1, 1, (v, env) => {
  const n = v[0].type === 'container' && v[0].data ? pdfPageCount(v[0].data) : undefined;
  return n === undefined ? beResult(env, -1, text('?')) : beResult(env, 0, num(n));
});
// BE_PDFGetPages ( pdf ; newPath ; from {; to } ): writes pages from to to (default: the last page) of a PDF, given as a
// path or a container, to a new file. Empty when written; "?" (error -1) for a PDF that can't be read (or is encrypted)
// or a range outside it. What BaseElements gives on success, and when to is left out, is inferred.
eager('BE_PDFGetPages', 3, 4, (v, env) => {
  const files = env.ctx.files;
  const source = v[0].type === 'container' && v[0].data ? v[0].data : files?.read(T(v[0], env));
  if (!source) return beResult(env, BE_NO_FILE, text('?'));
  const range = pdfPageRange(source, Math.trunc(N(v[2])), v[3] && T(v[3], env) !== '' ? Math.trunc(N(v[3])) : undefined);
  if (!range) return beResult(env, -1, text('?'));
  return files?.write(T(v[1], env), range, false) ? beResult(env, 0, text('')) : beResult(env, BE_NO_FILE, text('?'));
});
// No image scaling on the server: the container itself stands in for its thumbnail.
eager('GetThumbnail', 3, 3, (v) => v[0]);
// 1 unless a file stored outside the database is missing or was changed there; "?" for a value that isn't a
// container. An empty field reads as empty text, so it counts as 1 (nothing stored has changed; inferred).
eager('VerifyContainer', 1, 1, (v) => {
  const c = v[0];
  if (c.type === 'container') return num(c.changed ? 0 : 1);
  return c.type === 'text' && c.value === '' ? num(1) : text('?');
});
eager('GetContainerAttribute', 2, 2, (v, env) => {
  const which = T(v[1], env).toLowerCase();
  if (v[0].type !== 'container') return EMPTY;
  if (which === 'filename') return text(v[0].value.replace(/^.*\//, ''));
  if (which === 'filesize') {
    const size = v[0].size ?? v[0].data?.length;
    return size === undefined ? EMPTY : num(size);
  }
  if (which === 'md5') return v[0].data ? text(createHash('md5').update(v[0].data).digest('hex').toUpperCase()) : EMPTY;
  const image = imageOf(v[0]);
  if (!image) return EMPTY;
  if (which === 'width') return num(image.width);
  if (which === 'height') return num(image.height);
  if (which === 'dpiwidth') return image.dpiWidth === undefined ? EMPTY : num(image.dpiWidth);
  if (which === 'dpiheight') return image.dpiHeight === undefined ? EMPTY : num(image.dpiHeight);
  if (which === 'transparency') return num(image.transparency ? 1 : 0);
  return EMPTY;
});
/** Bytes read first for an image's header: dimensions, resolution and transparency are near the start. */
const IMAGE_HEAD = 256 * 1024;
// The image's size in pixels; 0 for anything that isn't an image. A stored file is read from its first bytes: one that
// doesn't start like an image (a video) isn't read further, and a header past them (a TIFF's) reads the whole file.
function imageOf(v: Value): ImageInfo | undefined {
  if (v.type !== 'container') return undefined;
  if (v.head && v.size !== undefined && v.size > IMAGE_HEAD) {
    const head = v.head(IMAGE_HEAD);
    if (!isImageHeader(head)) return undefined;
    const info = imageInfo(head);
    if (info) return info;
  }
  return v.data ? imageInfo(v.data) : undefined;
}
eager('GetWidth', 1, 1, (v) => num(imageOf(v[0])?.width ?? 0));
eager('GetHeight', 1, 1, (v) => num(imageOf(v[0])?.height ?? 0));

// --- embeddings (FileMaker 2024 AI) -----------------------------------------------
// An embedding is text (a JSON array of numbers) or container data. FileMaker's
// container form, read off Beezwax's public semantic search demos ("emb_….fve"
// files): the 8 bytes "FVE.2100", then each value as a little-endian float64.
// These are pure arithmetic, so they run offline; GetEmbedding itself calls a
// model and is not here.

const FVE = new TextEncoder().encode('FVE.2100');

/** Whether bytes start like FileMaker's container embedding data. */
export function isEmbeddingData(d: Uint8Array): boolean {
  return d.length >= 8 && FVE.every((b, i) => d[i] === b);
}

export function embeddingOf(v: Value): number[] | undefined {
  if (v.type === 'container' && v.data) {
    const d = v.data;
    if (!isEmbeddingData(d) || (d.length - 8) % 8) return undefined;
    const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
    return Array.from({ length: (d.length - 8) / 8 }, (_, i) => view.getFloat64(8 + i * 8, true));
  }
  try {
    const a: unknown = JSON.parse(asText(v));
    return Array.isArray(a) && a.length && a.every((x) => typeof x === 'number') ? (a as number[]) : undefined;
  } catch {
    return undefined;
  }
}

// GetEmbedding asks the host (a script on a server with AI); anywhere else it is an error, as with no AI account.
def('GetEmbedding', 3, 3, (a, env) => {
  const [account, model, input] = a.map((x) => env.text(x));
  const v = env.ctx.embedding?.(account, model, input);
  if (!v) throw new CalcError(ERR.calculation, 'GetEmbedding runs only in scripts, on a server with AI');
  return v;
});

export function embeddingFile(vector: number[], filename = 'embedding.fve'): Value {
  const data = new Uint8Array(8 + vector.length * 8);
  data.set(FVE);
  const view = new DataView(data.buffer);
  vector.forEach((x, i) => view.setFloat64(8 + i * 8, x, true));
  return { type: 'container', value: filename, data };
}

const embeddingText = (vector: number[]) => text(`[${vector.join(',')}]`);

const lengthOf = (vector: number[]) => {
  let sum = 0;
  for (const x of vector) sum += x * x;
  return Math.sqrt(sum);
};

/** Unit length, or undefined for the zero vector (FileMaker gives "?"). */
function normalized(vector: number[]): number[] | undefined {
  const length = lengthOf(vector);
  return length ? vector.map((x) => x / length) : undefined;
}

/** A result in the first input's form: container data in, container data out. */
const sameForm = (like: Value, vector: number[] | undefined): Value =>
  !vector ? text('?') : like.type === 'container' ? embeddingFile(vector, like.value || undefined) : embeddingText(vector);

/** -1 to 1, or undefined when the vectors differ in length or one is all zeros. */
export function cosineSimilarity(a: number[], b: number[]): number | undefined {
  if (a.length !== b.length) return undefined;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  const lengths = lengthOf(a) * lengthOf(b);
  return lengths ? dot / lengths : undefined;
}

eager('CosineSimilarity', 2, 2, (v) => {
  const a = embeddingOf(v[0]);
  const b = embeddingOf(v[1]);
  const similarity = a && b ? cosineSimilarity(a, b) : undefined;
  return similarity === undefined ? text('?') : num(similarity);
});
for (const [name, sign] of [['AddEmbeddings', 1], ['SubtractEmbeddings', -1]] as const) {
  eager(name, 2, 2, (v, env) => {
    const a = embeddingOf(v[0]);
    const b = embeddingOf(v[1]);
    if (!a || !b || a.length !== b.length) return text('?');
    return sameForm(v[0], normalized(a.map((x, i) => x + sign * b[i])));
  });
}
// Claris: a dimension left out, over the vector's size, or 0 or less uses the whole vector.
eager('NormalizeEmbedding', 1, 2, (v) => {
  const a = embeddingOf(v[0]);
  if (!a) return text('?');
  const asked = v[1] === undefined || isEmpty(v[1]) ? 0 : Math.trunc(N(v[1]));
  const dims = asked > 0 && asked <= a.length ? asked : a.length;
  return sameForm(v[0], normalized(a.slice(0, dims)));
});
eager('GetEmbeddingAsText', 1, 1, (v, env) => {
  const a = v[0].type === 'container' ? embeddingOf(v[0]) : undefined;
  return a ? embeddingText(a) : text('?');
});
eager('GetEmbeddingAsFile', 1, 2, (v, env) => {
  const a = v[0].type === 'container' ? undefined : embeddingOf(v[0]);
  return a ? embeddingFile(a, v[1] === undefined ? undefined : T(v[1], env) || undefined) : text('?');
});

// GetTokenCount ( text ): an estimate, as Claris says its count is ("guidance only"): about four characters a token,
// which gives Claris's own example ("Claris FileMaker", 4).
eager('GetTokenCount', 1, 1, (v, env) => num(Math.ceil(T(v[0], env).length / 4)));

// --- data and environment --------------------------------------------------------

def(['ExecuteSQL', 'ExecuteSQLe'], 3, undefined, (a, env, name) => {
  const sql = env.text(a[0]);
  const fieldSep = a[1] ? env.text(a[1]) || ',' : ',';
  const rowSep = a[2] ? env.text(a[2]) || '\r' : '\r';
  if (!env.ctx.executeSQL) throw new CalcError(ERR.calculation, `${name} is not available here`);
  try {
    const rows = env.ctx.executeSQL(sql, a.slice(3).map((x) => env.v(x)));
    return text(rows.map((r) => r.map((c) => sqlText(c)).join(fieldSep)).join(rowSep));
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof HostWait || (e instanceof CalcError && e.code !== ERR.calculation)) throw e;
    if (e instanceof CalcError && name.toLowerCase() !== 'executesqle') throw e;
    return text(name.toLowerCase() === 'executesqle' ? sqlErrorText(sql, (e as Error).message) : '?');
  }
});

/**
 * ExecuteSQLe's error: "? ERROR: FQLxxxx/(line:offset): message", from Claris's FileMaker SQL error codes. Mapped from
 * the database's own message: a missing column, table or function and an ambiguous column get their codes, anything
 * else is FQL0001's syntax error. The position is where the name (or the text the error is near) first appears, with
 * the offset counted from 0 as Claris's example gives it; at the start when it can't be found.
 */
export function sqlErrorText(sql: string, message: string): string {
  const quote = (s: string) => s.replace(/^["'`]|["'`]$/g, '');
  let m: RegExpMatchArray | null;
  let code = 1;
  let at: string | undefined;
  let msg = 'There is an error in the syntax of the query.';
  if ((m = message.match(/no such column: (\S+)/i))) {
    const parts = quote(m[1]).split('.');
    const column = quote(parts[parts.length - 1]);
    at = column;
    if (parts.length > 1) {
      code = 9;
      msg = `The column named "${column}" does not exist in table "${quote(parts[0])}".`;
    } else {
      code = 7;
      msg = `The column named "${column}" does not exist in any table in the column reference's scope.`;
    }
  } else if ((m = message.match(/no such table: (\S+)/i))) {
    at = quote(m[1]);
    code = 2;
    msg = `The table named "${at}" does not exist.`;
  } else if ((m = message.match(/ambiguous column name: (\S+)/i))) {
    at = quote(m[1]).split('.').pop()!;
    code = 6;
    msg = `The column named "${at}" appears in more than one table in the column reference's scope.`;
  } else if ((m = message.match(/no such function: (\S+)/i))) {
    at = quote(m[1]);
    code = 30;
    msg = `"${at}" is an invalid function.`;
  } else if ((m = message.match(/near "([^"]*)"/))) {
    at = m[1];
  }
  let line = 1;
  let offset = 0;
  if (at) {
    const escaped = at.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hit = new RegExp(`(^|[^\\w])("?${escaped}"?)(?![\\w])`, 'i').exec(sql);
    if (hit) {
      const index = hit.index + hit[1].length;
      const before = sql.slice(0, index);
      line = before.split(/\r\n|\r|\n/).length;
      offset = index - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) - 1;
    }
  }
  return `? ERROR: FQL${String(code).padStart(4, '0')}/(${line}:${offset}): ${msg}`;
}
// Location ( accuracy ; timeout ): "latitude,longitude" of the person's device, as FileMaker Go gives; empty when
// it isn't known. LocationValues: latitude, longitude, altitude, horizontal and vertical accuracy (meters) and the
// fix's age in minutes, one per line (-1 for what the device doesn't know).
def('Location', 1, 2, (_a, env) => {
  const l = env.ctx.location?.();
  return l ? text(`${l.latitude},${l.longitude}`) : EMPTY;
});
def('LocationValues', 1, 2, (_a, env) => {
  const l = env.ctx.location?.();
  if (!l) return EMPTY;
  const age = Math.max(0, (env.ctx.now?.() ?? new Date()).getTime() - l.at) / 60_000;
  return text([l.latitude, l.longitude, l.altitude ?? -1, l.horizontalAccuracy, l.verticalAccuracy ?? -1, Math.round(age * 100) / 100].join('\r'));
});

// GetPersistentData ( name ; instanceID ): "?" when there is no such entry, as FileMaker gives.
// GetRAGSpaceInfo lists this file's RAG spaces, or one space's documents; an unknown RAG account gives "?".
def('GetRAGSpaceInfo', 1, 2, (a, env) => {
  const r = env.ctx.ragSpaceInfo?.(env.text(a[0]), a[1] ? env.text(a[1]) : undefined);
  return r === undefined ? text('?') : text(r);
});
def('GetPersistentData', 1, 2, (a, env) => env.ctx.persistentData?.(env.text(a[0]), a[1] ? env.text(a[1]) : '') ?? text('?'));
def('ListPersistentDataIDs', 1, 1, (a, env) => text((env.ctx.persistentDataIds?.(env.text(a[0])) ?? []).join('\r')));

/** ExecuteSQL writes dates and times in ISO order. */
function sqlText(v: Value): string {
  switch (v.type) {
    case 'number': return formatNumber(v.value);
    case 'date': {
      const d = fromDayNumber(v.value);
      return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    }
    case 'timestamp': {
      const day = Math.floor(v.value / 86400) + 1;
      const t = asText({ type: 'time', value: v.value - (day - 1) * 86400 });
      return `${sqlText({ type: 'date', value: day })} ${t.padStart(8, '0')}`;
    }
    default: return asText(v);
  }
}

// Design functions describe the file; the host answers them, otherwise they are empty.
// Layout objects and windows live in a client, so GetLayoutObjectAttribute is empty on a server.
def(['GetLayoutObjectAttribute', 'LayoutNames', 'LayoutIDs', 'ScriptNames', 'ScriptIDs', 'WindowNames', 'FieldNames',
  'TableNames', 'TableIDs', 'FieldIDs', 'FieldType', 'FieldStyle', 'FieldRepetitions', 'FieldBounds', 'FieldComment',
  'RelationInfo', 'ValueListItems', 'ValueListNames', 'ValueListIDs', 'DatabaseNames', 'LayoutObjectNames',
  'ScriptStepNames', 'BaseTableNames', 'BaseTableIDs', 'GetTableDDL', 'GetRecordIDsFromFoundSet', 'GetNextSerialValue', 'GetFieldsOnLayout'], 0, undefined, (a, env, name) => env.ctx.design?.(name, a.map((x) => env.v(x))) ?? EMPTY);


// --- paths ------------------------------------------------------------------------

// ConvertFromFileMakerPath formats.
eager('PosixPath', 0, 0, () => num(1));
eager('WinPath', 0, 0, () => num(2));
eager('URLPath', 0, 0, () => num(3));

/** "filemac:/Macintosh HD/a/b.txt" → "/Macintosh HD/a/b.txt" ("" when it is not a FileMaker path). */
function fileMakerPath(t: string): string {
  const m = /^(?:file|filemac|filewin|filelinux|image|imagemac|imagewin|imagelinux|movie|moviemac|moviewin):(.*)$/i.exec(t.trim());
  return m ? m[1] : t.trim().startsWith('/') ? t.trim() : '';
}

export function convertFromFileMakerPath(t: string, format: number): string {
  const p = fileMakerPath(t);
  if (!p) return '?';
  if (format === 2) {
    const w = p.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\');
    return w;
  }
  if (format === 3) return 'file://' + (p.startsWith('//') ? p.slice(1) : p).split('/').map(encodeURIComponent).join('/');
  return p.replace(/^\/([A-Za-z]:)/, '$1');
}
/** A native path or file URL (in the given format) as a FileMaker path: the reverse of convertFromFileMakerPath. */
export function convertToFileMakerPath(t: string, format: number): string {
  const p = t.trim();
  if (!p) return '';
  if (format === 3) {
    const fmnet = /^fmp:\/\/([^/?#]+)(\/[^?#]*)?(?:[?#].*)?$/i.exec(p);
    if (fmnet) {
      try {
        return `fmnet:/${fmnet[1]}${decodeURIComponent(fmnet[2] ?? '')}`;
      } catch {
        return '?';
      }
    }
    const m = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(p);
    if (!m) return '?';
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return '?';
    }
  }
  if (format === 2) {
    // C:\a\b.txt, or a network share \\server\share\a.txt; a relative path names no file.
    const w = p.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(w)) return '/' + w;
    return /^\/\/[^/]/.test(w) ? w : '?';
  }
  return p.startsWith('/') ? p : '?';
}
eager('ConvertToFileMakerPath', 2, 2, (v, env) => text(convertToFileMakerPath(T(v[0], env), Math.trunc(N(v[1])))));
eager('ConvertFromFileMakerPath', 2, 2, (v, env) => text(convertFromFileMakerPath(T(v[0], env), Math.trunc(N(v[1])))));

// --- Japanese text ---------------------------------------------------------------

eager('Hiragana', 1, 1, (v, env) => text(hiragana(T(v[0], env))));
eager('Katakana', 1, 1, (v, env) => text(katakana(T(v[0], env))));
eager('KanaHankaku', 1, 1, (v, env) => text(kanaHankaku(T(v[0], env))));
eager('KanaZenkaku', 1, 1, (v, env) => text(kanaZenkaku(T(v[0], env))));
eager('KanjiNumeral', 1, 1, (v, env) => text(kanjiNumeral(T(v[0], env))));
eager('RomanHankaku', 1, 1, (v, env) => text(romanHankaku(T(v[0], env))));
eager('RomanZenkaku', 1, 1, (v, env) => text(romanZenkaku(T(v[0], env))));

// --- Japanese numbers -------------------------------------------------------------

const JDIGITS = ['0123456789', '０１２３４５６７８９', '〇一二三四五六七八九', '〇壱弐参四五六七八九'];
eager('NumToJText', 3, 3, (v, env) => {
  const n = asNumberOrEmpty(v[0]);
  if (n === undefined) return EMPTY;
  const sep = Math.trunc(N(v[1])), kind = Math.min(3, Math.max(0, Math.trunc(N(v[2]))));
  const [int, frac] = T(num(Math.abs(n)), env).split('.');
  let out = int;
  if (sep === 1) out = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  else if (sep === 2 || sep === 3) {
    // Groups of four digits with 万, 億, 兆, 京 (3 also separates within groups).
    const units = ['', '万', '億', '兆', '京'];
    const groups: string[] = [];
    for (let i = int.length, u = 0; i > 0; i -= 4, u++) {
      const g = String(Number(int.slice(Math.max(0, i - 4), i)));
      if (g !== '0') groups.unshift((sep === 3 ? g.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : g) + units[u]);
    }
    out = groups.join('') || '0';
  }
  if (frac) out += '.' + frac;
  const digits = JDIGITS[kind];
  return text((n < 0 ? '-' : '') + out.replace(/\d/g, (d) => digits[Number(d)]));
});

// --- MBS plug-in -------------------------------------------------------------------
// Supported MonkeyBread MBS functions. CURL uses the script engine's guarded
// network bridge; functions without documented behavior return an MBS error.

const mbsErrors = new WeakMap<object, boolean>();
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', pdf: 'application/pdf', svg: 'image/svg+xml',
  txt: 'text/plain', html: 'text/html', json: 'application/json', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
};
const fileNameOf = (v: Value, env: Env) =>
  v.type === 'container' ? v.value.split(/\r|\n/).filter(Boolean).pop()?.replace(/^.*[/:]/, '') ?? '' : T(v, env).replace(/^.*[/\\:]/, '');
const extensionOf = (name: string) => (/\.([^./\\]+)$/.exec(name)?.[1] ?? '');

const MBS: Record<string, (v: Value[], env: Env) => Value> = {
  'version': () => text('tabularius'),
  'register': () => text('OK'),
  'isregistered': () => num(1),
  'path.lastpathcomponent': (v, env) => text(T(v[0], env).replace(/[/\\]+$/, '').replace(/^.*[/\\:]/, '')),
  'path.filemakerpathtonativepath': (v, env) => text(convertFromFileMakerPath(T(v[0], env), process.platform === 'win32' ? 2 : 1)),
  'files.fileextension': (v, env) => text(extensionOf(fileNameOf(v[0], env))),
  'container.getbase64': (v, env) => text(Buffer.from(bytesOf(v[0], env)).toString('base64')),
  'container.gettotalsize': (v, env) => num(bytesOf(v[0], env).length),
  'container.gettypes': (v, env) => {
    const ext = extensionOf(fileNameOf(v[0], env)).toUpperCase();
    return text(ext === 'JPG' ? 'JPEG' : ext || 'FILE');
  },
  'container.getdataurl': (v, env) => {
    const mime = MIME[extensionOf(fileNameOf(v[0], env)).toLowerCase()] ?? 'application/octet-stream';
    return text(`data:${mime};base64,` + Buffer.from(bytesOf(v[0], env)).toString('base64'));
  },
  'folders.systemtemporary': () => text('/tmp'),
};
// The Text functions (mbs-text.ts): each takes its parameters as text and gives text or a number.
for (const [name, f] of Object.entries(MBS_TEXT)) {
  MBS[name] = (v, env) => {
    const r = f(v.map((x) => T(x, env)));
    return typeof r === 'number' ? num(r) : text(r);
  };
}
// The RegEx functions (mbs-regex.ts): compiled expressions belong to the script session.
for (const [name, f] of Object.entries(MBS_REGEX)) {
  MBS[name] = (v, env) => {
    const r = f(v.map((x) => T(x, env)), env.ctx.pluginSession ?? env.ctx);
    return typeof r === 'number' ? num(r) : text(r);
  };
}
// The JSON functions (mbs-json.ts): references belong to the script session, and AddValueTo… and CreateValue
// need to know which parameters FileMaker gave as numbers.
for (const [name, f] of Object.entries(MBS_JSON)) {
  MBS[name] = (v, env) => {
    const r = f(v.map((x) => ({ text: T(x, env), number: x.type === 'number' })), env.ctx.pluginSession ?? env.ctx);
    return typeof r === 'number' ? num(r) : text(r);
  };
}
// The Math and Time functions (mbs-math.ts): dates and timestamps are passed as themselves, the clock is the calculation's.
for (const [name, f] of Object.entries(MBS_MATH)) {
  MBS[name] = (v, env) => f({ values: v, texts: v.map((x) => T(x, env)), now: () => env.ctx.now?.() ?? new Date() });
}
// The XML functions (mbs-xml.ts): references belong to the script session, as for JSON.
for (const [name, f] of Object.entries(MBS_XML)) {
  MBS[name] = (v, env) => {
    const r = f(v.map((x) => T(x, env)), env.ctx.pluginSession ?? env.ctx);
    return typeof r === 'number' ? num(r) : text(r);
  };
}
// Dictionaries and plug-in variables (mbs-dict.ts) keep values as they are, for the script session.
for (const [name, f] of Object.entries(MBS_DICT)) {
  MBS[name] = (v, env) => withValueText((x) => T(x, env), () => f({ values: v, texts: v.map((x) => T(x, env)) }, env.ctx.pluginSession ?? env.ctx));
}
// The List functions (mbs-list.ts) work on text.
for (const [name, f] of Object.entries(MBS_LIST)) {
  MBS[name] = (v, env) => {
    const r = f(v.map((x) => T(x, env)));
    return typeof r === 'number' ? num(r) : text(r);
  };
}
// QuickLists (mbs-quicklist.ts) belong to the script session.
for (const [name, f] of Object.entries(MBS_QUICKLIST)) {
  MBS[name] = (v, env) => {
    const r = f(v.map((x) => T(x, env)), env.ctx.pluginSession ?? env.ctx);
    return typeof r === 'number' ? num(r) : text(r);
  };
}
for (const [name, f] of Object.entries(MBS_CURL)) {
  MBS[name] = (v, env) => {
    const r = f(v.map((x) => T(x, env)), env.ctx.curlScope ?? env.ctx, env.ctx.curlFetch);
    return typeof r === 'number' ? num(r) : text(r);
  };
}
// Persistent JavaScript handles use the existing restricted sandbox, scoped to this script session. A calculation
// with no script session (a stored calculation, MCP evaluate_calculation, a formula preview) has nothing that ends
// when it does, so a handle made there would only be reclaimed by the 60 s idle expiry, and a few such calls could
// fill the server-wide handle cap for everyone: those get an MBS error instead.
for (const [name, f] of Object.entries(MBS_JS)) {
  MBS[name] = (v, env) => {
    const session = env.ctx.pluginSession;
    if (!session) throw new MbsError('JavaScript handles are only available in a script');
    return f({ values: v, texts: v.map(x => T(x, env)) }, session, env.ctx.pluginAccount);
  };
}
// Client-only progress windows have nothing to show on a server.
for (const n of ['Hide', 'Reset', 'SetBottomText', 'SetTitle', 'SetTopText', 'SetButtonCaption', 'SetProgress', 'Show'])
  MBS['progressdialog.' + n.toLowerCase()] = () => text('OK');
Object.assign(MBS, mbsHashFunctions((env, message) => {
  mbsErrors.set(env.ctx.pluginSession ?? env.ctx, true);
  return text(`[MBS] ERROR: ${message}`);
}));

/** The MBS function names Tabularius runs (lowercase), for the plug-in compatibility page. */
export const mbsFunctionNames = (): string[] => Object.keys(MBS).sort();

/** Whether Tabularius runs MBS ( name ; … ) itself; any other MBS function gives an MBS error. */
export const mbsSupports = (name: string) => name.toLowerCase() === 'iserror' || Object.hasOwn(MBS, name.toLowerCase());

/** Only explicitly registered MBS functions may dispatch; host capabilities are checked by their implementations. */
function mbsFunction(name: string, env: Env): (typeof MBS)[string] | undefined {
  const f = Object.hasOwn(MBS, name.toLowerCase()) ? MBS[name.toLowerCase()] : undefined;
  mbsErrors.set(env.ctx.pluginSession ?? env.ctx, !f);
  return f;
}

def('MBS', 1, undefined, (a, env) => {
  const name = env.text(a[0]);
  const scope = env.ctx.pluginSession ?? env.ctx;
  if (name.toLowerCase() === 'iserror')
    return replayMbsCall(scope, name, [], () => num(mbsErrors.get(scope) ? 1 : 0),
      () => !!mbsErrors.get(scope), (value) => mbsErrors.set(scope, value));
  const f = mbsFunction(name, env);
  // Arguments can themselves call MBS, so evaluate them before recording the outer call.
  const args = a.slice(1).map((x) => env.v(x));
  const unavailable = () => text(`[MBS] ERROR: ${name} is not available in Tabularius`);
  if (!f) {
    // A host-provided function (DynaPDF) is a plug-in call like any other: recorded, so a replay does not run it twice.
    return replayMbsCall(scope, name, args, () => {
      const provided = name.toLowerCase().startsWith('dynapdf.') && env.ctx.mbsCall ? env.ctx.mbsCall(name, args) : undefined;
      if (provided === undefined) return unavailable();
      mbsErrors.set(scope, provided.type === 'text' && provided.value.startsWith('[MBS] ERROR:'));
      return provided;
    }, () => !!mbsErrors.get(scope), (value) => mbsErrors.set(scope, value));
  }
  return replayMbsCall(scope, name, args, () => {
    try {
      // The regular expressions in one call share a time limit, so a pattern that backtracks without end can't hold the server.
      return withRegexBudget(() => f(args, env));
    } catch (e) {
      // Too large or too deep for JavaScript (a string past its length limit, a stack too deep) is an MBS error too.
      if (!(e instanceof MbsError) && !(e instanceof RangeError) && !(e instanceof RegexTimeout)) throw e;
      mbsErrors.set(scope, true);
      return text(`[MBS] ERROR: ${e instanceof RegexTimeout ? e.message : e instanceof MbsError ? e.message : 'the result is too large'}`);
    }
  }, () => !!mbsErrors.get(scope), (value) => mbsErrors.set(scope, value));
});


// --- Plug-ins Tabularius doesn't run -------------------------------------------------
// FileMaker gives "?" for a function whose plug-in isn't installed, and scripts test for
// that (GetAsNumber ( EmailVersion ) < 1.61, BE_Version = "?"). These are the decoder's
// plug-in functions (PLUGIN_FUNCTIONS in @tabularius/fmp12) with no tabularius version. They
// stay out of FUNCTIONS, so conversion reports still list them as not supported. Nothing
// is sent or called: 360Works Email's send and connect functions give "?" like the rest.

export const PLUGIN_NOT_INSTALLED: ReadonlySet<string> = new Set([
  'emailregister', 'emailversion', 'emaillasterror', 'emailconnectimap', 'emailreadmessages', 'emailgetnextmessage',
  'emailreadmessagevalue', 'emaillistmailboxes', 'emaildisconnect', 'isvalidemail', 'dataguard_postdelete',
]);

// Any other plug-in's functions behave the same way, whichever plug-in it is: a call the file
// reader couldn't name (⟨OWNR:12⟩, owner id and function index; FMDR owns FileMaker's design
// functions, which the evaluator handles separately), or a name in a plug-in family's own prefix that Tabularius
// has no version of (BE_HTTP_GET, TrFile_Exists, SMTPit_Send).
const PLUGIN_MARKER = /^⟨(?!FMDR:)[\x21-\x7e]{4}:\d+⟩$/;
const PLUGIN_ID_ONLY = /^<plugin:([\x21-\x7e]{4}):(\d+)>$/i;
export const PLUGIN_PREFIX = /^(be_|trfile_|trtext_|trurl_|turl_|trserial_|serial_|dlg_|dial_|actr_|smtpit_|dataguard_|pcqb_|pcol_|evaluategroovy|registergroovy)/;

/** True when FileMaker would give "?" because the function's plug-in isn't installed here. */
export function pluginNotInstalled(name: string): boolean {
  const lower = name.toLowerCase();
  if (FUNCTIONS.has(lower)) return false;
  return PLUGIN_NOT_INSTALLED.has(lower) || PLUGIN_MARKER.test(name) || PLUGIN_ID_ONLY.test(name) || PLUGIN_PREFIX.test(lower);
}

// --- BaseElements plug-in ---------------------------------------------------------
// Its JSON functions, run natively. BE_EvaluateJavaScript runs no JavaScript: the
// programs Todd Geist's json custom functions pass it are computed natively
// (bejs.ts); anything else gives "?", as BaseElements does for a script error.

const beErrors = new WeakMap<object, string>();
/** JSONPath as BaseElements reads it: $, .key, ['key'], [index]. */
function jsonPath(doc: unknown, path: string): { found: boolean; value?: unknown } {
  const p = path.trim();
  if (!p.startsWith('$')) return { found: false };
  let cur: unknown = doc;
  const re = /\.([^.[\]]+)|\[\s*(\d+)\s*\]|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]/y;
  re.lastIndex = 1;
  while (re.lastIndex < p.length) {
    const m = re.exec(p);
    if (!m) return { found: false };
    const key = m[2] !== undefined ? Number(m[2]) : (m[1] ?? m[3] ?? m[4]);
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) return { found: false };
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return { found: true, value: cur };
}
eager(['BE_Version', 'BE_VersionAutoUpdate', 'BE_VersionPro'], 0, 0, () => text('tabularius'));
// BE_GetMachineName: the computer's name (BaseElements: %COMPUTERNAME% on Windows, else the hardware identifier). BE_GetSystemDrive:
// "the same effect as Get ( SystemDrive )", which here is the server's root.
eager('BE_GetMachineName', 0, 0, () => text(hostname()));
eager('BE_GetSystemDrive', 0, 0, () => text('/'));
eager('BE_JSON_Error_Description', 0, 0, (_v, env) => text(beErrors.get(env.ctx) ?? ''));
eager('BE_JSONPath', 2, 2, (v, env) => {
  let doc: unknown;
  try {
    doc = JSON.parse(T(v[0], env));
  } catch (e) {
    if (e instanceof HostWait) throw e;
    beErrors.set(env.ctx, (e as Error).message);
    return text('?');
  }
  const r = jsonPath(doc, T(v[1], env));
  if (!r.found) {
    beErrors.set(env.ctx, `no match for ${T(v[1], env)}`);
    return text('?');
  }
  beErrors.set(env.ctx, '');
  const x = r.value;
  return text(typeof x === 'string' ? x : x === null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x));
});
eager('BE_JSON_Encode', 2, 3, (v, env) => {
  const value = v[1].type === 'number' ? JSON.stringify(N(v[1])) : JSON.stringify(T(v[1], env));
  const key = T(v[0], env);
  // Always a "key":value pair, even with an empty key: callers such as jsonAv take what follows the first colon.
  return text(`${JSON.stringify(key)}:${value}`);
});
// BE_FileMakerSQL ( sql ; columnSeparator ; rowSeparator ; fileName ): ExecuteSQL by another name.
def('BE_FileMakerSQL', 1, 4, (a, env) => {
  if (!env.ctx.executeSQL) throw new CalcError(ERR.calculation, 'BE_FileMakerSQL is not available here');
  const sep = (i: number, d: string) => (a[i] ? env.text(a[i]) || d : d);
  try {
    const rows = env.ctx.executeSQL(env.text(a[0]), []);
    beErrors.set(env.ctx, '');
    return text(rows.map((r) => r.map((c) => sqlText(c)).join(sep(1, '\t'))).join(sep(2, '\r')));
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof CalcError) throw e;
    if (e instanceof HostWait) throw e;
    beErrors.set(env.ctx, (e as Error).message);
    return text('?');
  }
});
// Text files, only in the folders the host allows (a script's documents and
// temporary folders); anywhere else reads as a missing file.
const beLastError = new WeakMap<object, number>();
const beResult = (env: Env, error: number, value: Value): Value => (beLastError.set(env.ctx, error), value);
/** BaseElements' error for a file it can't find (boost's "no such file or directory"). */
const BE_NO_FILE = 2;
eager(['BE_GetLastError', 'BE_GetLastDDLError'], 0, 0, (_v, env) => num(beLastError.get(env.ctx) ?? 0));
eager('BE_FileExists', 1, 1, (v, env) => beResult(env, 0, bool(env.ctx.files?.size(T(v[0], env)) !== undefined)));
eager('BE_FileSize', 1, 1, (v, env) => {
  const size = env.ctx.files?.size(T(v[0], env));
  return size === undefined ? beResult(env, BE_NO_FILE, text('')) : beResult(env, 0, num(size));
});
// BE_FileReadText ( path {; start ; end ; delimiter } ): the whole file, characters start to end (start 0: the last end
// characters), or with a delimiter (a regular expression) values start to end, ending with the delimiter as it does.
eager('BE_FileReadText', 1, 4, (v, env) => {
  const bytes = env.ctx.files?.read(T(v[0], env));
  if (!bytes) return beResult(env, BE_NO_FILE, text(''));
  const all = new TextDecoder().decode(bytes);
  const from = v[1] ? Math.trunc(N(v[1])) : 0;
  const to = v[2] ? Math.trunc(N(v[2])) : 0;
  if (from === 0 && to === 0) return beResult(env, 0, text(all));
  const delimiter = v[3] ? T(v[3], env) : '';
  if (delimiter) {
    let values: string[];
    try {
      values = withRegexBudget(() => {
        if (delimiter.length <= 32768) assertPatternNesting(delimiter);
        return guardedSplit(new RegExp(delimiter.length > 32768 ? '(' : delimiter), all);
      });
    } catch (e) {
      // A delimiter that backtracks without end, or isn't an expression, is refused as in BE_RegularExpression.
      if (!(e instanceof RegexTimeout) && !(e instanceof SyntaxError)) throw e;
      return beResult(env, -1, text('?'));
    }
    const popped = values.length > 1 && values[values.length - 1] === '';
    if (popped) values.pop();
    const count = values.length;
    let start = from;
    let end = Math.min(to, count);
    if (start < 1) { start = count - end; end = count; } else if (end < 1) { start -= 1; end = count; } else start -= 1;
    if (start > end) return beResult(env, 0, text(''));
    return beResult(env, 0, text(values.slice(start, end).join(delimiter) + (count > end || popped ? delimiter : '')));
  }
  const chars = [...all];
  if (from < 1) return beResult(env, 0, text(chars.slice(Math.max(0, chars.length - to)).join('')));
  return beResult(env, 0, text(chars.slice(from - 1, to < 1 ? from - 1 : to).join('')));
});
// BE_FileWriteText ( path ; text {; append } ): 0 when written.
eager('BE_FileWriteText', 2, 3, (v, env) => {
  const ok = env.ctx.files?.write(T(v[0], env), T(v[1], env), v[2] ? asBoolean(v[2]) : false) ?? false;
  return ok ? beResult(env, 0, num(0)) : beResult(env, BE_NO_FILE, text(''));
});
// Folder tools, in the same allowed folders: 0 when done, else the system error number (2 for a path that is missing
// or outside them), which BE_GetLastError gives too.
const beCode = (env: Env, code: number | undefined) => beResult(env, code ?? BE_NO_FILE, num(code ?? BE_NO_FILE));
eager('BE_FolderCreate', 1, 1, (v, env) => beCode(env, env.ctx.files?.makeFolder?.(T(v[0], env))));
eager('BE_FileDelete', 1, 1, (v, env) => beCode(env, env.ctx.files?.remove?.(T(v[0], env))));
eager('BE_FileMove', 2, 3, (v, env) => beCode(env, env.ctx.files?.move?.(T(v[0], env), T(v[1], env), beBool(v[2], true))));
eager('BE_FileCopy', 2, 3, (v, env) => beCode(env, env.ctx.files?.copy?.(T(v[0], env), T(v[1], env), beBool(v[2], false))));
// BE_FileListFolder ( path {; type ; subfolders ; fullPath ; hidden } ): files (BE_FileTypeFile, the default), folders
// or both, one per line. Without fullPath each is written after the folder's path as given, so "…/Documents/" lists
// names and "…/Documents" lists "/name", as BaseElements' remove_prefix does.
eager('BE_FileListFolder', 1, 5, (v, env) => {
  const dir = T(v[0], env);
  const type = v[1] === undefined ? 1 : Math.trunc(N(v[1]));
  const entries = env.ctx.files?.list?.(dir, beBool(v[2], false));
  if (!entries) return beResult(env, BE_NO_FILE, text(''));
  const hidden = beBool(v[4], true);
  const base = dir.endsWith('/') ? dir : dir + '/';
  const full = beBool(v[3], false);
  return beResult(env, 0, text(entries
    .filter((e) => (type === 0 || (type === 2) === e.folder) && (hidden || !e.path.split('/').pop()!.startsWith('.')))
    .map((e) => (full ? base + e.path : base.slice(dir.length) + e.path)).join('\r')));
});
// BE_FileModificationTimestamp ( path ): seconds since 0001-01-01 in local time, as a number.
eager('BE_FileModificationTimestamp', 1, 1, (v, env) => {
  const d = env.ctx.files?.modified?.(T(v[0], env));
  if (!d) return beResult(env, BE_NO_FILE, text(''));
  return beResult(env, 0, num(Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 1000) + FM_EPOCH_MS / 1000));
});
// BE_FilePatternCount ( files ; searches ): for each search, how often it occurs across the files, ignoring case.
eager('BE_FilePatternCount', 2, 2, (v, env) => {
  if (!T(v[1], env)) return text('0');
  const searches = beValues(T(v[1], env), true).map((x) => x.toLowerCase());
  const hay: string[] = [];
  for (const f of beValues(T(v[0], env), true)) {
    const bytes = env.ctx.files?.read(f);
    if (!bytes) return beResult(env, BE_NO_FILE, text('?'));
    hay.push(new TextDecoder().decode(bytes).toLowerCase());
  }
  return beResult(env, 0, text(searches.map((needle) => {
    if (!needle) return '0';
    let n = 0;
    for (const h of hay) for (let at = h.indexOf(needle); at !== -1; at = h.indexOf(needle, at + needle.length)) n++;
    return String(n);
  }).join('\r')));
});
// BE_Zip ( files | container {; archive } ): files (a list of paths; a folder goes in whole, under its own name) or
// container data, deflated into a zip at archive, by default the first file's path (or the container's name) plus
// ".zip". The result is 0, 2 when a file is missing, or 12 when two have the same name, ignoring case; then the
// last one goes in. Entries are in name order, as BaseElements' map keeps them.
const baseName = (path: string) => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';
const BE_NAME_EXISTS = 12;
const BE_ZIP_ERROR = 10200;
eager('BE_Zip', 1, 2, (v, env) => {
  const files = env.ctx.files;
  let archive = v[1] === undefined ? '' : T(v[1], env);
  const entries: ZipEntry[] = [];
  let error = 0;
  if (v[0].type === 'container' && v[0].data) {
    const name = fileNameOf(v[0], env) || 'Untitled';
    entries.push({ name, data: v[0].data });
    archive ||= name + '.zip';
  } else {
    const unique = new Map<string, string>();
    for (const path of beValues(T(v[0], env), false)) {
      const key = baseName(path).toLowerCase();
      if (unique.has(key)) { error = BE_NAME_EXISTS; unique.delete(key); }
      unique.set(key, path);
    }
    const paths = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, p]) => p);
    const exists = (p: string) => files?.size(p) !== undefined || files?.list?.(p, false) !== undefined;
    if (!paths.length || !exists(paths[0])) return beResult(env, BE_NO_FILE, num(BE_NO_FILE));
    archive ||= paths[0].replace(/[/\\]+$/, '') + '.zip';
    for (const path of paths) {
      const name = baseName(path);
      const folder = files?.list?.(path, true);
      if (folder) {
        entries.push({ name: name + '/', data: new Uint8Array(0) });
        const base = path.replace(/[/\\]+$/, '') + '/';
        for (const e of folder) {
          if (e.path.split('/').some((x) => x.startsWith('.'))) continue;
          const data = e.folder ? new Uint8Array(0) : files?.read(base + e.path);
          if (!data) continue;
          entries.push({ name: `${name}/${e.path}${e.folder ? '/' : ''}`, data });
        }
        continue;
      }
      const data = files?.read(path);
      if (!data) { error = BE_NO_FILE; break; }
      entries.push({ name, data });
    }
  }
  if (!files?.write(archive, zip(entries), false)) return beResult(env, BE_NO_FILE, num(BE_NO_FILE));
  return beResult(env, error, num(error));
});
// BE_Unzip ( archive | container {; folder } ): extracts every file, replacing any already there, into folder (by
// default the archive's own folder) and gives their paths, one per line in name order. BE_Unzip_Deprecated, the
// older function, gives 0 instead.
const beUnzip = (paths: boolean) => (v: Value[], env: Env): Value => {
  const files = env.ctx.files;
  const container = v[0].type === 'container' && v[0].data ? v[0].data : undefined;
  const archive = container ? '' : T(v[0], env);
  let folder = v[1] === undefined ? '' : T(v[1], env);
  if (!folder && archive) folder = archive.replace(/[^/\\]*$/, '');
  const bytes = container ?? files?.read(archive);
  if (!bytes || !folder) return beResult(env, BE_NO_FILE, text('?'));
  let entries: ZipEntry[];
  try {
    entries = unzip(bytes, { maxTotalBytes: 20 * 1024 * 1024 });
  } catch (e) {
    beErrors.set(env.ctx, (e as Error).message);
    return beResult(env, BE_ZIP_ERROR, text('?'));
  }
  // No entry may climb out of the folder.
  if (entries.some((e) => e.name.startsWith('/') || e.name.split(/[/\\]/).some((x) => x === '..'))) return beResult(env, BE_ZIP_ERROR, text('?'));
  const base = folder.replace(/[/\\]+$/, '') + '/';
  const done: string[] = [];
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const dir = e.name.endsWith('/') ? e.name : e.name.replace(/[^/]*$/, '');
    if (dir) {
      const code = files?.makeFolder?.(base + dir) ?? BE_NO_FILE;
      if (code !== 0 && code !== 17) return beResult(env, code, text('?'));
    }
    if (e.name.endsWith('/')) continue;
    if (!files?.write(base + e.name, e.data, false)) return beResult(env, BE_NO_FILE, text('?'));
    done.push(base + e.name);
  }
  return beResult(env, 0, paths ? text(done.join('\r')) : num(0));
};
eager('BE_Unzip', 1, 2, beUnzip(true));
eager('BE_Unzip_Deprecated', 1, 2, beUnzip(false));
// BE_RegularExpression ( text ; expression {; options ; replaceWith } ): the first match, every match (g) one
// per line, or the text with matches replaced; options i, m, s, x, g and v (each line of the text on its own).
/** BaseElements' regular expressions: the first match, every match (g) one per line, or the text with matches
 * replaced when replaceWith is given; undefined for an expression that doesn't compile. */
function beRegex(input: string, expression: string, opts: string, replaceWith?: string): string | undefined {
  // An expression this long is only an attack: compiling one can run for a minute, and compiling isn't interruptible.
  if (expression.length > 32768) return undefined;
  const options = opts.toLowerCase();
  let source = expression;
  // x: whitespace and # comments in the expression are ignored (JavaScript has no such flag).
  if (options.includes('x')) source = source.replace(/\\.|\[(?:\\.|[^\]\\])*\]|#[^\n]*|\s+/g, (m) => (m.startsWith('\\') || m.startsWith('[') ? m : ''));
  const flags = 'u' + (options.includes('i') ? 'i' : '') + (options.includes('m') ? 'm' : '') + (options.includes('s') ? 's' : '');
  let re: RegExp;
  try {
    assertPatternNesting(source);
    re = new RegExp(source, flags);
  } catch {
    return undefined;
  }
  const global = options.includes('g');
  // $0 is the whole match in BaseElements' replacement text, $& in JavaScript's.
  const replacement = replaceWith?.replace(/\$0/g, '$$&');
  const one = (s: string): string => {
    if (replacement !== undefined) return guardedReplace(global ? new RegExp(re.source, re.flags + 'g') : re, s, replacement);
    if (!global) return guardedExec(re, s)?.[0] ?? '';
    return guardedMatches(new RegExp(re.source, re.flags + 'g'), s).filter(Boolean).join('\r');
  };
  return options.includes('v') ? input.split('\r').map(one).filter(Boolean).join('\r') : one(input);
}
/** beRegex under a time limit, as MBS's expressions are: a pattern that backtracks without end, or a replacement
 * that would be too large, gives undefined (the caller's "?" and error -1) instead of holding up or stopping the server. */
function beRegexGuarded(input: string, expression: string, opts: string, replaceWith?: string): string | undefined {
  try {
    return withRegexBudget(() => beRegex(input, expression, opts, replaceWith));
  } catch (e) {
    if (e instanceof RegexTimeout || (e instanceof RangeError && /too large/.test(e.message))) return undefined;
    throw e;
  }
}
eager('BE_RegularExpression', 2, 4, (v, env) => {
  const out = beRegexGuarded(T(v[0], env), T(v[1], env), v[2] ? T(v[2], env) : '', v.length === 4 ? T(v[3], env) : undefined);
  return out === undefined ? beResult(env, -1, text('?')) : beResult(env, 0, text(out));
});
// BE_FileReplaceText ( path | container ; expression ; replaceWith {; options } ): replaces matches (options "gi"
// by default) in a text file, which is rewritten, or in container data, which comes back with the same name.
eager('BE_FileReplaceText', 3, 4, (v, env) => {
  const container = v[0].type === 'container' && v[0].data ? v[0] : undefined;
  const path = container ? '' : T(v[0], env);
  const bytes = container ? container.data : env.ctx.files?.read(path);
  if (!bytes) return beResult(env, BE_NO_FILE, text('?'));
  const out = beRegexGuarded(new TextDecoder().decode(bytes), T(v[1], env), v[3] === undefined ? 'gi' : T(v[3], env), T(v[2], env));
  if (out === undefined) return beResult(env, -1, text('?'));
  if (container) return beResult(env, 0, { type: 'container', value: container.value, data: new TextEncoder().encode(out) });
  return env.ctx.files?.write(path, out, false) ? beResult(env, 0, text('')) : beResult(env, BE_NO_FILE, text('?'));
});
// BE_StackPush ( name ; value ), BE_StackPop ( name ), BE_StackCount ( name ), BE_StackDelete ( name ): named stacks
// for the session (here, for one calculation context).
const beStacks = new WeakMap<object, Map<string, string[]>>();
const stack = (env: Env, name: string): string[] => {
  let all = beStacks.get(env.ctx);
  if (!all) beStacks.set(env.ctx, (all = new Map()));
  let s = all.get(name);
  if (!s) all.set(name, (s = []));
  return s;
};
eager('BE_StackPush', 2, 2, (v, env) => (stack(env, T(v[0], env)).push(T(v[1], env)), text('')));
eager('BE_StackPop', 1, 1, (v, env) => text(stack(env, T(v[0], env)).pop() ?? ''));
eager('BE_StackCount', 1, 1, (v, env) => num(stack(env, T(v[0], env)).length));
eager('BE_StackDelete', 1, 1, (v, env) => {
  const s = stack(env, T(v[0], env));
  const top = s.pop() ?? '';
  s.length = 0;
  return text(top);
});
// In outbound test mode, BaseElements' web and mail functions are recorded instead: requests get an
// empty reply and messages go to the outbox, never to their recipients. The arguments follow
// BaseElements' documentation (BE_HTTP_POST ( url ; parameters ), BE_SMTP_Send ( from ; to ; subject ;
// text {; cc ; bcc ; replyTo ; html ; attachments } )); success is "" with BE_GetLastError 0 (inferred).
const smtpAttachments = new WeakMap<object, string[]>();
// The names BaseElements registers today (its Localizable.strings) come first; the older spellings stay as aliases.
const HTTP_METHODS: Record<string, string> = {
  BE_HTTP_GET: 'GET', BE_HTTP_GETFile: 'GET', BE_HTTP_POST: 'POST', BE_HTTP_PUTFile: 'PUT', BE_HTTP_PUTData: 'PUT',
  BE_HTTP_PATCH: 'PATCH', BE_HTTP_DELETE: 'DELETE',
  BE_HTTP_GET_File: 'GET', BE_SaveURLToFile: 'GET', BE_HTTP_PUT_File: 'PUT', BE_HTTP_PUT_Data: 'PUT',
};
const SMTP_NAMES: Record<string, 'server' | 'attach' | 'send'> = {
  BE_SMTPServer: 'server', BE_SMTPAddAttachment: 'attach', BE_SMTPSend: 'send',
  BE_SMTP_Server: 'server', BE_SMTP_AddAttachment: 'attach', BE_SMTP_Send: 'send',
};
const recorded = (name: string, env: Env, v: Value[]): Value | undefined => {
  const out = env.ctx.outbound;
  if (!out) return undefined;
  if (HTTP_METHODS[name]) {
    const at = HTTP_BODY_AT[name];
    const sent = at?.read !== undefined ? env.ctx.files?.size(T(v[at.read], env)) ?? 0 : at?.save !== undefined || v.length < 2 ? 0 : Buffer.byteLength(T(v[1], env));
    out.request(name, HTTP_METHODS[name], T(v[0], env), sent);
    return beResult(env, 0, text(''));
  }
  if (SMTP_NAMES[name] === 'server') return beResult(env, 0, text('')); // the server and account are never used
  if (SMTP_NAMES[name] === 'attach') {
    const list = smtpAttachments.get(env.ctx) ?? [];
    if (v.length && T(v[0], env)) list.push(T(v[0], env));
    else list.length = 0;
    smtpAttachments.set(env.ctx, list);
    return beResult(env, 0, text(''));
  }
  if (SMTP_NAMES[name] === 'send') {
    const extra = T(v[8], env).split(/\r\n|[\r\n]/).filter(Boolean);
    out.mail(name, {
      from: T(v[0], env), to: T(v[1], env), subject: T(v[2], env), body: T(v[3], env) || T(v[7], env),
      cc: T(v[4], env), bcc: T(v[5], env), attachments: [...(smtpAttachments.get(env.ctx) ?? []), ...extra],
    });
    smtpAttachments.delete(env.ctx);
    return beResult(env, 0, text(''));
  }
  return undefined;
};
// Where scripts may reach the network (the file's Script network switch), BE_HTTP_GET, POST, PUTData, PATCH and DELETE make
// real requests through the same guarded transport as Insert from URL and answer with the body as text (BaseElements answers
// with a container); GET_File saves the answer to a path in the allowed folders (the Documents folder) and PUTFile sends a file
// from there; BE_SMTPSend sends through the server's mail account, where mail is set up. Only http and https addresses are
// built in: BaseElements also takes ftp, ftps and sftp ones, which give "?" and error 3 here. Argument order follows
// BaseElements' source; the error numbers a failed request sets are inferred (7 for a request that got no answer; 2 for a
// path that is missing or outside the allowed folders).
const HTTP_BODY_AT: Record<string, { body?: number; /** The argument holding the path of a file to send. */ read?: number; /** The argument holding the path to save the answer to. */ save?: number; user: number; password: number }> = {
  BE_HTTP_GET: { user: 2, password: 3 }, BE_HTTP_POST: { body: 1, user: 2, password: 3 }, BE_HTTP_PUTData: { body: 1, user: 2, password: 3 },
  BE_HTTP_PUT_Data: { body: 1, user: 2, password: 3 }, BE_HTTP_PATCH: { body: 1, user: 2, password: 3 }, BE_HTTP_DELETE: { user: 1, password: 2 },
  BE_HTTP_GET_File: { save: 1, user: 2, password: 3 }, BE_HTTP_GETFile: { save: 1, user: 2, password: 3 }, BE_SaveURLToFile: { save: 1, user: 2, password: 3 },
  BE_HTTP_PUTFile: { read: 1, user: 2, password: 3 }, BE_HTTP_PUT_File: { read: 1, user: 2, password: 3 },
};
const BE_MAX_UPLOAD = 10 * 1024 * 1024;
interface BeWebState { headers: Map<string, string>; code: number; responseHeaders: string }
const beWeb = new WeakMap<object, BeWebState>();
const beWebState = (env: Env): BeWebState => {
  const scope = env.ctx.curlScope ?? env.ctx;
  let state = beWeb.get(scope);
  if (!state) beWeb.set(scope, state = { headers: new Map(), code: 0, responseHeaders: '' });
  return state;
};
const beRequest = (name: string, v: Value[], env: Env): Value | undefined => {
  const at = HTTP_BODY_AT[name];
  const curl = env.ctx.curlFetch;
  if (!at || !curl) return undefined;
  const state = beWebState(env);
  const headers: Record<string, string> = Object.fromEntries(state.headers);
  const user = at.user < v.length ? T(v[at.user], env) : '';
  if (user) headers.authorization = `Basic ${Buffer.from(`${user}:${at.password < v.length ? T(v[at.password], env) : ''}`).toString('base64')}`;
  const method = HTTP_METHODS[name];
  const url = T(v[0], env);
  if (!/^https?:\/\//i.test(url)) {
    beErrors.set(env.ctx, `${name}: only http and https addresses are built in (FTP, FTPS and SFTP are not)`);
    return beResult(env, 3, text('?'));
  }
  const body = at.body !== undefined && at.body < v.length ? T(v[at.body], env) : undefined;
  const path = at.read ?? at.save;
  const file = path !== undefined && path < v.length ? T(v[path], env) : '';
  let bodyBytes: Uint8Array | undefined;
  if (path !== undefined) {
    if (!file) {
      beErrors.set(env.ctx, `${name} needs the path of a file`);
      return beResult(env, BE_NO_FILE, num(BE_NO_FILE));
    }
    if (at.read !== undefined) {
      // The size is asked first, so a file over the limit is never read into memory.
      const size = env.ctx.files?.size(file);
      if (size !== undefined && size > BE_MAX_UPLOAD) {
        beErrors.set(env.ctx, `${name}: ${file} is over ${BE_MAX_UPLOAD / 1024 / 1024} MB`);
        return beResult(env, 7, num(7));
      }
      bodyBytes = env.ctx.files?.read(file);
      if (!bodyBytes) {
        beErrors.set(env.ctx, `${name}: no file at ${file} (paths are inside the Documents folder)`);
        return beResult(env, BE_NO_FILE, num(BE_NO_FILE));
      }
      if (bodyBytes.length > BE_MAX_UPLOAD) { // grew since the size was asked
        beErrors.set(env.ctx, `${name}: ${file} is over ${BE_MAX_UPLOAD / 1024 / 1024} MB`);
        return beResult(env, 7, num(7));
      }
    }
  }
  if (method === 'POST' && body !== undefined && !('content-type' in headers)) headers['content-type'] = 'application/x-www-form-urlencoded';
  const r = curl({ method, url, headers, ...(body !== undefined ? { body } : {}), ...(bodyBytes ? { bodyBytes } : {}), ...(at.save !== undefined ? { wantBytes: true } : {}), follow: true, maxRedirs: 5, via: name });
  if (r.error || !r.status) {
    state.code = 0;
    state.responseHeaders = '';
    beErrors.set(env.ctx, `${name}: ${r.error ?? 'the request got no answer'}`);
    return beResult(env, 7, num(7));
  }
  state.code = r.status;
  state.responseHeaders = r.headerText ?? Object.entries(r.headers).map(([k, x]) => `${k}: ${x}`).join('\r');
  if (at.save !== undefined) {
    if (!env.ctx.files?.write(file, r.bytes ?? new Uint8Array(0), false)) {
      beErrors.set(env.ctx, `${name}: ${file} can't be written`);
      return beResult(env, BE_NO_FILE, num(BE_NO_FILE));
    }
    return beResult(env, 0, text(''));
  }
  return beResult(env, 0, text(r.body));
};
const beMail = (name: string, v: Value[], env: Env): Value | undefined => {
  const mailer = env.ctx.builtinMailer;
  if (!mailer || SMTP_NAMES[name] !== 'send') return undefined;
  const extra = T(v[8], env).split(/\r\n|[\r\n]/).filter(Boolean);
  mailer.send(name, {
    from: T(v[0], env), to: T(v[1], env), subject: T(v[2], env), body: T(v[3], env) || T(v[7], env),
    cc: T(v[4], env), bcc: T(v[5], env), attachments: [...(smtpAttachments.get(env.ctx) ?? []), ...extra],
  });
  smtpAttachments.delete(env.ctx);
  return beResult(env, 0, text(''));
};
const BE_OFF = (name: string, env: Env): Value => {
  beErrors.set(env.ctx, `${name} is not available in Tabularius${BE_HTTP_NAMES.has(name) || SMTP_NAMES[name] ? ': network access is off for this file\'s scripts (turn on Script network in the admin console)' : ''}`);
  return beResult(env, 3, text('?'));
};
const BE_HTTP_NAMES = new Set(Object.keys(HTTP_BODY_AT));
for (const name of [...Object.keys(HTTP_METHODS), ...Object.keys(SMTP_NAMES)]) {
  eager(name, 0, undefined, (v, env) => recorded(name, env, v) ?? beRequest(name, v, env) ?? beMail(name, v, env) ?? BE_OFF(name, env));
}
// BE_SMTPSetHeader ( {header ; value} ) is the same for mail: where mail is only captured it answers empty text and the header is not kept.
// BE_HTTP_SetCustomHeader ( header ; value ) prepares the next web call (an empty header clears them), BE_HTTP_SetProxy ( proxy {; port ;
// userName ; password } ) is not used (requests go through the server's own guarded transport), and BE_HTTP_ResponseCode and
// BE_HTTP_ResponseHeaders ( {header} ) read the previous call. Where web calls are only recorded (outbound test mode) nothing is
// sent, so there are no headers to keep and no response to read: they answer "" with error 0. Where scripts may not reach the
// network the web calls give "?", and so do these.
const BE_WEB_COMPANIONS = ['BE_HTTP_SetCustomHeader', 'BE_HTTP_SetProxy', 'BE_SMTPSetHeader', 'BE_HTTP_ResponseCode', 'BE_HTTP_ResponseHeaders'];
for (const name of BE_WEB_COMPANIONS) {
  eager(name, 0, 4, (v, env) => {
    if (env.ctx.outbound) return beResult(env, 0, text(''));
    if (env.ctx.curlFetch) {
      const state = beWebState(env);
      if (name === 'BE_HTTP_SetCustomHeader') {
        const header = v.length ? T(v[0], env).trim().toLowerCase() : '';
        if (!header) state.headers.clear();
        else state.headers.set(header, v.length > 1 ? T(v[1], env) : '');
        return beResult(env, 0, num(beLastError.get(env.ctx) ?? 0));
      }
      if (name === 'BE_HTTP_ResponseCode') return beResult(env, 0, num(state.code));
      if (name === 'BE_HTTP_ResponseHeaders') {
        if (!v.length || !T(v[0], env)) return beResult(env, 0, text(state.responseHeaders));
        const want = T(v[0], env).toLowerCase();
        return beResult(env, 0, num(state.responseHeaders.split(/\r\n|[\r\n]/).some((l) => l.toLowerCase().startsWith(`${want}:`)) ? 1 : 0));
      }
      if (name === 'BE_HTTP_SetProxy') return beResult(env, 0, text(''));
    }
    beErrors.set(env.ctx, `${name} is not available in Tabularius`);
    return beResult(env, 3, text('?'));
  });
}
// The clipboard, folder pickers and shell commands are never touched on the server, and nothing else reaches the
// network or sends mail: "?" with an error.
const BE_REFUSED = ['BE_ClipboardFormats', 'BE_ClipboardGetText', 'BE_ClipboardSetText', 'BE_SelectFolder', 'BE_SelectFile', 'BE_ExecuteSystemCommand',
  'BE_FolderSelectDialog', 'BE_FileSelectDialog', 'BE_FileOpen',
  'BE_OpenURL', 'BE_OpenFile',
  'BE_FTP_Upload', 'BE_FTP_UploadFile', 'BE_FTP_Delete'];
def(BE_REFUSED, 0, undefined, (_a, env, name) => {
  beErrors.set(env.ctx, `${name} is not available in Tabularius`);
  beLastError.set(env.ctx, 3);
  return text('?');
});

/**
 * What a call to a plug-in function does here, from the same tables the engine uses: it runs; it runs only in outbound
 * test mode, where the request or message goes to the Outbox (otherwise "?" and error 3); it is always refused ("?" and
 * error 3: the clipboard, file pickers, shell commands, FTP); it is not built and gives "?" as FileMaker does when
 * the plug-in is not installed; or the name is one nothing knows (typed by hand, say), which is an error, "The function
 * cannot be found", rather than "?". An MBS name is judged by mbsSupports instead.
 */
export type PluginBehaviour = 'runs' | 'outbox' | 'refused' | 'unavailable' | 'unrecognised';
const OUTBOX_ONLY = new Set([...Object.keys(HTTP_METHODS), ...Object.keys(SMTP_NAMES), ...BE_WEB_COMPANIONS].map((n) => n.toLowerCase()));
const ALWAYS_REFUSED = new Set(BE_REFUSED.map((n) => n.toLowerCase()));
export function pluginCallBehaviour(name: string): PluginBehaviour {
  const lower = name.toLowerCase();
  if (OUTBOX_ONLY.has(lower)) return 'outbox';
  if (ALWAYS_REFUSED.has(lower)) return 'refused';
  if (FUNCTIONS.has(lower)) return 'runs';
  return pluginNotInstalled(name) ? 'unavailable' : 'unrecognised';
}

// --- BaseElements, pure functions ---------------------------------------------------
// Ported from BaseElements' own source (GoyaPtyLtd/BaseElements-Plugin, BSD licence):
// BEPluginFunctions.cpp, BEValueList.h, Crypto/BEMessageDigest.cpp. Nothing here touches
// files, the network or the desktop.

// A parameter BaseElements reads as a boolean: missing gives its default.
const beBool = (v: Value | undefined, dflt: boolean) => (v === undefined ? dflt : asBoolean(v));
/** A value list as BEValueList splits it: on returns, empty values dropped unless kept. */
const beValues = (s: string, keepEmpty = false): string[] => {
  if (!s) return [];
  const all = s.split('\r');
  return keepEmpty ? all : all.filter((x) => x !== '');
};
/** std::sort on UTF-8 strings: byte order. */
const byteCompare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
/** istringstream >> long double: the leading number, or 0. */
const leadingNumber = (s: string) => {
  const m = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s);
  return m ? Number(m[0]) : 0;
};

// Numeric constants: each is its function id modulo 1000 (BE_NumericConstants).
const BE_CONSTANTS: Record<string, number> = {
  BE_ButtonOK: 1, BE_ButtonCancel: 2, BE_ButtonAlternate: 3,
  BE_MessageDigestAlgorithmMD5: 1, BE_MessageDigestAlgorithmSHA256: 2, BE_MessageDigestAlgorithmMDC2: 4,
  BE_MessageDigestAlgorithmSHA: 6, BE_MessageDigestAlgorithmSHA1: 7, BE_MessageDigestAlgorithmSHA224: 8,
  BE_MessageDigestAlgorithmSHA384: 9, BE_MessageDigestAlgorithmSHA512: 10,
  BE_FileTypeAll: 0, BE_FileTypeFile: 1, BE_FileTypeFolder: 2,
  BE_EncodingHex: 1, BE_EncodingBase64: 2,
  BE_ScriptControlHalt: 0, BE_ScriptControlExit: 1, BE_ScriptControlResume: 2, BE_ScriptControlPause: 3,
};
for (const [name, value] of Object.entries(BE_CONSTANTS)) eager(name, 0, 0, () => num(value));

// BE_ValuesUnique ( values {; caseSensitive } ): the first of each value, empty values kept.
eager('BE_ValuesUnique', 1, 2, (v, env) => {
  const cs = beBool(v[1], true);
  const seen = new Set<string>();
  const out = beValues(T(v[0], env), true).filter((x) => {
    const key = cs ? x : x.toLowerCase();
    return !seen.has(key) && (seen.add(key), true);
  });
  return text(out.join('\r'));
});
// BE_ValuesFilterOut ( values ; filterOut {; caseSensitive } ): values not in filterOut. As in BaseElements, a value
// that passes is let through again (it erases the value as written, not the lowercased key it added).
eager('BE_ValuesFilterOut', 2, 3, (v, env) => {
  const cs = beBool(v[2], true);
  const filter = new Set(beValues(T(v[1], env)).map((x) => (cs ? x : x.toLowerCase())));
  const out: string[] = [];
  for (const x of beValues(T(v[0], env))) {
    const key = cs ? x : x.toLowerCase();
    if (filter.has(key)) continue;
    filter.add(key);
    out.push(x);
    filter.delete(x);
  }
  return text(out.join('\r'));
});
eager('BE_ValuesContainsDuplicates', 1, 2, (v, env) => {
  const cs = beBool(v[1], true);
  const seen = new Set<string>();
  return bool(beValues(T(v[0], env)).some((x) => {
    const key = cs ? x : x.toLowerCase();
    return seen.has(key) || (seen.add(key), false);
  }));
});
// BE_ValuesSort ( values {; ascending ; type } ): type 1 (BE_DataType_Long) sorts by the leading number.
eager('BE_ValuesSort', 1, 3, (v, env) => {
  const ascending = beBool(v[1], true);
  const numeric = beBool(v[2], false);
  const sorted = beValues(T(v[0], env)).sort(numeric ? (a, b) => leadingNumber(a) - leadingNumber(b) : byteCompare);
  return text((ascending ? sorted : sorted.reverse()).join('\r'));
});
// BE_ValuesTimesDuplicated ( values ; numberOfTimes ): values occurring exactly that often, in byte order.
eager('BE_ValuesTimesDuplicated', 2, 2, (v, env) => {
  const counts = new Map<string, number>();
  for (const x of beValues(T(v[0], env))) counts.set(x, (counts.get(x) ?? 0) + 1);
  const n = Math.trunc(N(v[1]));
  return text([...counts].filter(([, c]) => c === n).map(([x]) => x).sort(byteCompare).join('\r'));
});
eager('BE_ValuesTrim', 1, 1, (v, env) => text(beValues(T(v[0], env), true).map((x) => x.trim()).join('\r')));

// Milliseconds since 0001-01-01, local and UTC; the time zone offset in minutes.
const FM_EPOCH_MS = 62135596800000;
eager('BE_TimeCurrentMilliseconds', 0, 0, (_v, env) => {
  const d = env.ctx.now?.() ?? new Date();
  return num(d.getTime() - d.getTimezoneOffset() * 60000 + FM_EPOCH_MS);
});
eager('BE_TimeUTCMilliseconds', 0, 0, (_v, env) => num((env.ctx.now?.() ?? new Date()).getTime() + FM_EPOCH_MS));
eager('BE_TimeZoneOffset', 0, 0, (_v, env) => num(-(env.ctx.now?.() ?? new Date()).getTimezoneOffset()));

// BE_MessageDigest ( text {; algorithm ; encoding } ): SHA256 and uppercase hex by default; BE_EncodingBase64 (2) for Base64.
const BE_DIGESTS: Record<number, string> = { 1: 'md5', 6: 'sha1', 7: 'sha1', 8: 'sha224', 2: 'sha256', 9: 'sha384', 10: 'sha512' };
eager('BE_MessageDigest', 1, 3, (v, env) => {
  const algorithm = BE_DIGESTS[v[1] === undefined ? 2 : Math.trunc(N(v[1]))];
  if (!algorithm) return beResult(env, -1, text('?')); // MDC2 or an unknown algorithm
  const digest = createHash(algorithm).update(T(v[0], env), 'utf8').digest();
  return beResult(env, 0, text(v[2] !== undefined && Math.trunc(N(v[2])) === 2 ? digest.toString('base64') : digest.toString('hex').toUpperCase()));
});
// BE_XOR ( text ; with ): each UTF-8 byte xored, as two hex digits.
eager('BE_XOR', 2, 2, (v, env) => {
  const k = Math.trunc(N(v[1])) & 0xff;
  return text([...Buffer.from(T(v[0], env))].map((b) => (b ^ k).toString(16).padStart(2, '0')).join(''));
});
// Vectors are value lists of numbers; extra values in the second are ignored.
const beVector = (s: string) => beValues(s).map(leadingNumber);
eager('BE_VectorDotProduct', 2, 2, (v, env) => {
  const a = beVector(T(v[0], env));
  const b = beVector(T(v[1], env));
  return num(a.slice(0, b.length).reduce((sum, x, i) => sum + x * b[i], 0));
});
eager(['BE_VectorEuclideanDistance', 'BE_Vector_EuclideanDistance'], 2, 2, (v, env) => {
  const a = beVector(T(v[0], env));
  const b = beVector(T(v[1], env));
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += (a[i] - b[i]) ** 2;
  return num(sum > 0 ? Math.sqrt(sum) : 0);
});
// BE_VariableSet ( name ; value ) and BE_VariableGet ( name ): named values for the session; setting "" removes one.
const beVariables = new WeakMap<object, Map<string, string>>();
const variables = (env: Env) => {
  let m = beVariables.get(env.ctx);
  if (!m) beVariables.set(env.ctx, (m = new Map()));
  return m;
};
eager('BE_VariableSet', 1, 2, (v, env) => {
  const name = T(v[0], env);
  const value = T(v[1], env);
  if (!name) return text('');
  if (value) variables(env).set(name, value);
  else variables(env).delete(name);
  return text(value);
});
eager('BE_VariableGet', 1, 1, (v, env) => text(variables(env).get(T(v[0], env)) ?? ''));
// Arrays: BE_ArraySetFromValueList gives the new array's number (1, 2, ...); deleting one renumbers those after it.
const beArrays = new WeakMap<object, string[][]>();
const arrays = (env: Env) => {
  let a = beArrays.get(env.ctx);
  if (!a) beArrays.set(env.ctx, (a = []));
  return a;
};
const index = (v: Value | undefined) => Math.trunc(N(v)) - 1;
eager('BE_ArraySetFromValueList', 1, 2, (v, env) => num(arrays(env).push(beValues(T(v[0], env), beBool(v[1], false)))));
eager('BE_ArrayGetSize', 1, 1, (v, env) => {
  const a = arrays(env)[index(v[0])];
  return a ? num(a.length) : text('');
});
eager('BE_ArrayGetValue', 2, 2, (v, env) => text(arrays(env)[index(v[0])]?.[index(v[1])] ?? ''));
eager('BE_ArrayDelete', 1, 1, (v, env) => {
  const i = index(v[0]);
  if (arrays(env)[i]) arrays(env).splice(i, 1);
  return text('');
});
// BE_ArrayFind ( array ; value ): the numbers of the values equal to it, ignoring case.
eager('BE_ArrayFind', 2, 2, (v, env) => {
  const a = arrays(env)[index(v[0])];
  if (!a) return text('');
  const want = T(v[1], env).toLowerCase();
  return text(a.flatMap((x, i) => (x.toLowerCase() === want ? [String(i + 1)] : [])).join('\r'));
});
eager('BE_ArrayChangeValue', 3, 3, (v, env) => {
  const a = arrays(env)[index(v[0])];
  if (!a) return text('');
  const i = index(v[1]);
  if (i < 0 || i >= a.length) return bool(false);
  a[i] = T(v[2], env);
  return bool(true);
});
// BE_TextExtractWords ( calculation {; prefix } ): the $variables (or words with another prefix) a calculation
// uses, skipping strings and comments, each once.
eager('BE_TextExtractWords', 1, 2, (v, env) => {
  const calc = T(v[0], env);
  const prefix = v[1] === undefined ? '$' : T(v[1], env);
  const starts = new Set([...prefix, '/', '"']);
  const ends = new Set([...' ;+-=*/&^<>\t\r[](),≠≤≥']);
  const words: string[] = [];
  const nextStart = (from: number) => {
    for (let j = from; j < calc.length; j++) if (starts.has(calc[j])) return j;
    return -1;
  };
  let i = nextStart(0);
  while (i !== -1) {
    // Only $ and @ start a word (BaseElements' switch); any other prefix character is stepped over.
    let end = 0;
    let from = i + 1;
    const c = calc[i];
    if (c === '/') {
      if (calc[from] === '/') { end = calc.indexOf('\r', from); from = end + 1; }
      else if (calc[from] === '*') { end = calc.indexOf('*/', from); from = end + 2; }
    } else if (c === '"') {
      end = calc.indexOf('"', from);
      while (end !== -1 && calc[end - 1] === '\\') end = calc.indexOf('"', end + 1);
      from = end + 1;
    } else if (c === '$' || c === '@') {
      end = from;
      while (end < calc.length && !ends.has(calc[end])) end++;
      words.push(calc.slice(i, end));
      from = end + 1;
    }
    i = end !== -1 && from < calc.length ? nextStart(from) : -1;
  }
  return text([...new Set(words)].join('\r'));
});
// BE_JSON_ArraySize ( json {; path } ): the length of the array at a path (Poco's Query: a.b[0]), else 0.
eager('BE_JSON_ArraySize', 1, 2, (v, env) => {
  let cur: unknown;
  try {
    cur = JSON.parse(T(v[0], env));
  } catch (e) {
    if (e instanceof HostWait) throw e;
    return num(0);
  }
  const path = T(v[1], env);
  for (const part of path ? path.split('.') : []) {
    const m = /^([^[]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) return num(0);
    if (m[1]) cur = cur && typeof cur === 'object' && !Array.isArray(cur) && Object.hasOwn(cur, m[1]) ? (cur as Record<string, unknown>)[m[1]] : undefined;
    for (const ix of m[2].match(/\d+/g) ?? []) cur = Array.isArray(cur) ? cur[Number(ix)] : undefined;
  }
  return num(Array.isArray(cur) ? cur.length : 0);
});

// BE_ContainerCompress ( data {; fileName } ), BE_ContainerUncompress and BE_ContainerIsCompressed. BaseElements
// keeps compressed data in a zlib stream that its own functions read back uncompressed, so compression never
// changes what a calculation sees; here the data stays as it is and only the mark that it was compressed is kept,
// for as long as the value lives (a field or variable holding it in this run).
const beCompressed = new WeakSet<Uint8Array>();
const BE_INVALID_FIELD_TYPE = 413;
const beRecontain = (v: Value[], env: Env, compressed: boolean): Value => {
  const data = v[0].type === 'container' && v[0].data ? v[0].data.slice() : new TextEncoder().encode(T(v[0], env));
  if (compressed) beCompressed.add(data);
  const name = (v[1] === undefined ? '' : T(v[1], env)) || (v[0].type === 'container' ? fileNameOf(v[0], env) : '');
  return beResult(env, 0, { type: 'container', value: name, data });
};
eager('BE_ContainerCompress', 1, 2, (v, env) => beRecontain(v, env, true));
eager('BE_ContainerUncompress', 1, 2, (v, env) => beRecontain(v, env, false));
eager('BE_ContainerIsCompressed', 1, 1, (v, env) => {
  if (v[0].type !== 'container') return beResult(env, BE_INVALID_FIELD_TYPE, text('?'));
  return beResult(env, 0, bool(v[0].data !== undefined && beCompressed.has(v[0].data)));
});
// BaseElements' RSA key functions follow the OpenSSL command line: PKCS #1 v1.5 padding, base64 for encrypted text.
// BE_CreateKeyPair gives a 2048 bit private key as "RSA PRIVATE KEY" PEM text; BE_GetPublicKey its "RSA PUBLIC KEY".
// Anything that can't be read or done gives "?" with error -1.
const beKeyFail = (env: Env): Value => beResult(env, -1, text('?'));
const rsaPrivate = (pem: string, password?: string) => {
  const key = createPrivateKey({ key: pem, format: 'pem', ...(password ? { passphrase: password } : {}) });
  if (key.asymmetricKeyType !== 'rsa') throw new Error('not an RSA key');
  return key;
};
const rsaPublic = (pem: string) => {
  // Only a public key: node would also take a private key here and work out its public half.
  if (!/-----BEGIN (RSA )?PUBLIC KEY-----/.test(pem)) throw new Error('not a public key');
  const key = createPublicKey({ key: pem, format: 'pem' });
  if (key.asymmetricKeyType !== 'rsa') throw new Error('not an RSA key');
  return key;
};
const pemLines = (s: string) => s.replace(/\r\n|\r/g, '\n');
// The digest algorithm is a BE_MessageDigestAlgorithm constant (BE_DIGESTS, below), or its name; empty is SHA256.
const beDigest = (v: Value | undefined, env: Env): string | undefined => {
  const raw = v === undefined ? '' : T(v, env).trim();
  if (!raw) return 'sha256';
  if (/^\d+$/.test(raw)) return BE_DIGESTS[Number(raw)];
  const name = raw.toLowerCase().replace('-', '');
  return CRYPT_ALGORITHMS.has(name) ? name : undefined;
};
eager('BE_CreateKeyPair', 0, 0, (_v, env) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return beResult(env, 0, text(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()));
});
eager('BE_GetPublicKey', 1, 1, (v, env) => {
  try {
    const pub = createPublicKey(rsaPrivate(pemLines(T(v[0], env))));
    return beResult(env, 0, text(pub.export({ type: 'pkcs1', format: 'pem' }).toString()));
  } catch {
    return beKeyFail(env);
  }
});
eager('BE_EncryptWithKey', 2, 2, (v, env) => {
  try {
    const out = publicEncrypt({ key: rsaPublic(pemLines(T(v[1], env))), padding: cryptoConstants.RSA_PKCS1_PADDING }, Buffer.from(T(v[0], env), 'utf8'));
    return beResult(env, 0, text(out.toString('base64')));
  } catch {
    return beKeyFail(env);
  }
});
eager('BE_DecryptWithKey', 2, 2, (v, env) => {
  try {
    const out = privateDecrypt({ key: rsaPrivate(pemLines(T(v[1], env))), padding: cryptoConstants.RSA_PKCS1_PADDING }, Buffer.from(T(v[0], env).replace(/\s/g, ''), 'base64'));
    return beResult(env, 0, text(out.toString('utf8')));
  } catch {
    return beKeyFail(env);
  }
});
// BE_SignatureGenerateRSA ( data ; privateKey {; privateKeyPassword ; algorithm ; fileNameWithExtension } ): the signature as a container.
eager('BE_SignatureGenerateRSA', 2, 5, (v, env) => {
  const algo = beDigest(v[3], env);
  if (!algo) return beKeyFail(env);
  try {
    const signature = sign(algo, bytesOf(v[0], env), rsaPrivate(pemLines(T(v[1], env)), v[2] ? T(v[2], env) : undefined));
    return beResult(env, 0, { type: 'container', value: (v[4] ? T(v[4], env) : '') || 'signature.sig', data: new Uint8Array(signature) });
  } catch {
    return beKeyFail(env);
  }
});
// BE_SignatureVerifyRSA ( data ; publicKey ; signature {; algorithm } ): 1 or 0; the signature is a container or base64 text.
eager('BE_SignatureVerifyRSA', 3, 4, (v, env) => {
  const algo = beDigest(v[3], env);
  if (!algo) return beKeyFail(env);
  try {
    const signature = v[2].type === 'container' ? bytesOf(v[2], env) : Buffer.from(T(v[2], env).replace(/\s/g, ''), 'base64');
    return beResult(env, 0, bool(verify(algo, bytesOf(v[0], env), rsaPublic(pemLines(T(v[1], env))), signature)));
  } catch {
    return beKeyFail(env);
  }
});

// BE_JSON_jq ( json ; filter {; options } ): a jq filter over JSON. The options are the letters c (compact), r (raw
// strings), j (raw, no newline between results) and V (version); see jq.ts for what the filter language covers. A filter
// outside that, or one that fails, gives "?" with the reason in BE_JSON_Error_Description.
eager('BE_JSON_jq', 2, 3, (v, env) => {
  const options = v[2] ? T(v[2], env) : '';
  if (options.includes('V')) return beResult(env, 0, text('jq-1.7 (Tabularius subset)'));
  try {
    const out = withRegexBudget(() => runJq(T(v[0], env), T(v[1], env), {
      compact: options.includes('c'), raw: options.includes('r') || options.includes('j'), join: options.includes('j'),
    }));
    beErrors.set(env.ctx, '');
    return beResult(env, 0, text(out));
  } catch (e) {
    if (e instanceof HostWait) throw e;
    if (!(e instanceof JqError) && !(e instanceof RegexTimeout)) throw e;
    beErrors.set(env.ctx, e instanceof RegexTimeout ? 'regular expression took too long' : e.message);
    return beResult(env, -1, text('?'));
  }
});

// BE_Gzip ( container {; fileName } ) and BE_UnGzip: gzip at the best compression (BEZlib.cpp); the name gains or
// loses .gz unless one is given. UnGzip also reads zlib streams, as inflateInit2 ( 15 + 32 ) does.
eager('BE_Gzip', 1, 2, (v, env) => {
  const data = bytesOf(v[0], env);
  if (!data.length) return text('');
  const name = (v[1] ? T(v[1], env) : '') || fileNameOf(v[0], env) + '.gz';
  return { type: 'container', value: name, data: new Uint8Array(gzipSync(data, { level: 9 })) };
});
// BE_UnGzip gives up ("?") past this many bytes, so a small file cannot fill the server's memory.
const MAX_UNZIPPED = 256 * 1024 * 1024;
eager('BE_UnGzip', 1, 2, (v, env) => {
  const data = bytesOf(v[0], env);
  if (!data.length) return text('');
  let out: Buffer;
  try {
    out = data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data, { maxOutputLength: MAX_UNZIPPED }) : inflateSync(data, { maxOutputLength: MAX_UNZIPPED });
  } catch {
    return beResult(env, -1, text('?'));
  }
  const name = (v[1] ? T(v[1], env) : '') || fileNameOf(v[0], env).replace(/\.gz$/, '');
  return beResult(env, 0, { type: 'container', value: name, data: new Uint8Array(out) });
});
// BE_EncryptAES ( password ; text ) and BE_DecryptAES ( password ; encrypted ): AES-256-CFB with the key and IV from
// EVP_BytesToKey ( aes-256-cbc, SHA1, no salt, 5 rounds ). The result is Base64 of the IV's 32-byte buffer (returns
// written as line feeds), a return, then the encrypted text; only the buffer's first 16 bytes are the IV (the rest is
// whatever BaseElements' stack held: zeros here).
const beKeyAndIV = (password: string) => {
  const pw = Buffer.from(password);
  const out: Buffer[] = [];
  let prev = Buffer.alloc(0);
  while (Buffer.concat(out).length < 48) {
    let d = createHash('sha1').update(Buffer.concat([prev, pw])).digest();
    for (let i = 1; i < 5; i++) d = createHash('sha1').update(d).digest();
    out.push(d);
    prev = d;
  }
  const all = Buffer.concat(out);
  return { key: all.subarray(0, 32), iv: Buffer.concat([all.subarray(32, 48), Buffer.alloc(16)]) };
};
eager('BE_EncryptAES', 2, 2, (v, env) => {
  const { key, iv } = beKeyAndIV(T(v[0], env));
  for (let i = 0; i < iv.length; i++) if (iv[i] === 0x0d) iv[i] = 0x0a;
  const c = createCipheriv('aes-256-cfb', key, iv.subarray(0, 16));
  const encrypted = Buffer.concat([c.update(T(v[1], env), 'utf8'), c.final()]);
  return text(Buffer.concat([iv, Buffer.from([0x0d]), encrypted]).toString('base64'));
});
eager('BE_DecryptAES', 2, 2, (v, env) => {
  const { key } = beKeyAndIV(T(v[0], env));
  const decoded = Buffer.from(T(v[1], env).replace(/\s/g, ''), 'base64');
  const at = decoded.indexOf(0x0d);
  if (at < 16) return text('');
  const d = createDecipheriv('aes-256-cfb', key, decoded.subarray(0, 16));
  return text(Buffer.concat([d.update(decoded.subarray(at + 1)), d.final()]).toString('utf8'));
});
// BE_CipherEncrypt ( cipher ; data ; key ; iv {; padding ; fileName } ) and BE_CipherDecrypt: any OpenSSL cipher by name
// (AES-256-CFB when empty). Data, key and IV are hex text or containers; the result is uppercase hex, or a container
// with that file name.
const hexOrContainer = (v: Value | undefined, env: Env) =>
  v === undefined ? Buffer.alloc(0) : v.type === 'container' && v.data ? Buffer.from(v.data) : Buffer.from(T(v, env), 'hex');
const beCipher = (decrypt: boolean) => (v: Value[], env: Env): Value => {
  const name = T(v[0], env) || 'aes-256-cfb';
  try {
    const key = hexOrContainer(v[2], env);
    const iv = hexOrContainer(v[3], env);
    const c = decrypt ? createDecipheriv(name, key, iv.length ? iv : null) : createCipheriv(name, key, iv.length ? iv : null);
    c.setAutoPadding(beBool(v[4], true));
    const out = Buffer.concat([c.update(hexOrContainer(v[1], env)), c.final()]);
    const file = T(v[5], env);
    return beResult(env, 0, file ? { type: 'container', value: file, data: new Uint8Array(out) } : text(out.toString('hex').toUpperCase()));
  } catch (e) {
    if (e instanceof HostWait) throw e;
    return beResult(env, -1, text('?'));
  }
};
eager('BE_CipherEncrypt', 3, 6, beCipher(false));
eager('BE_CipherDecrypt', 3, 6, beCipher(true));

// BE_XPath ( xml ; xpath {; namespaces ; asText } ) and BE_XPathAll ( xml ; xpath {; namespaces } ): XPath 1.0 as
// libxml2 runs it (xpath.ts). XPath gives the first node's text (or, with asText false, its XML); XPathAll every
// node's text, one per line. Namespaces: "prefix=uri" pairs. Malformed XML or an expression error gives "?".
const beXPath = (all: boolean) => (v: Value[], env: Env): Value => {
  try {
    const r = evaluateXPath(parseXmlDocument(T(v[0], env)), T(v[1], env), v[2] === undefined ? '' : T(v[2], env));
    beErrors.set(env.ctx, '');
    return beResult(env, 0, text(all ? xpathValues(r) : beBool(v[3], true) ? xpathText(r) : xpathXml(r)));
  } catch (e) {
    if (e instanceof HostWait) throw e;
    beErrors.set(env.ctx, (e as Error).message);
    return beResult(env, -1, text('?'));
  }
};
eager('BE_XPath', 2, 4, beXPath(false));
eager('BE_XPathAll', 2, 3, beXPath(true));
// BE_XSLT_ApplyInMemory ( xml ; xslt ): the transformed result, or what went wrong as text, as BaseElements reports
// libxslt's errors.
const beXslt = (env: Env, xml: string, xslt: string): { ok: boolean; out: string } => {
  try {
    return { ok: true, out: applyXslt(xml, xslt.replace(/\r\n?/g, '\n')) };
  } catch (e) {
    if (e instanceof HostWait) throw e;
    beErrors.set(env.ctx, (e as Error).message);
    return { ok: false, out: (e as Error).message + '\n' };
  }
};
eager('BE_XSLT_ApplyInMemory', 2, 2, (v, env) => beResult(env, 0, text(beXslt(env, T(v[0], env), T(v[1], env)).out)));
// BE_XSLT_Apply ( xmlPath | container ; xslt ; outputPath {; script ; file ; [xslt ; outputPath] ...} ): writes each
// stylesheet's result to its output path; empty when all went, else what went wrong. Here the work is done before
// the function returns, so the script BaseElements would call when it finished in the background isn't run.
eager('BE_XSLT_Apply', 3, undefined, (v, env) => {
  const files = env.ctx.files;
  const source = v[0].type === 'container' && v[0].data ? v[0].data : files?.read(T(v[0], env));
  if (!source) return beResult(env, BE_NO_FILE, text('?'));
  const xml = new TextDecoder().decode(source);
  const jobs: [string, string][] = [[T(v[1], env), T(v[2], env)]];
  for (let i = 5; i + 1 < v.length; i += 2) jobs.push([T(v[i], env), T(v[i + 1], env)]);
  for (const [xslt, out] of jobs) {
    const r = beXslt(env, xml, xslt);
    if (!r.ok) return beResult(env, 0, text(r.out));
    if (!files?.write(out, r.out, false)) return beResult(env, BE_NO_FILE, text('?'));
  }
  return beResult(env, 0, text(''));
});
// BE_XMLParse ( xml ): empty for well-formed XML, else what is wrong with it.
eager('BE_XMLParse', 1, 1, (v, env) => {
  try {
    parseXmlDocument(T(v[0], env));
    return beResult(env, 0, text(''));
  } catch (e) {
    if (e instanceof HostWait) throw e;
    return beResult(env, 0, text((e as Error).message + '\n'));
  }
});
// BE_XMLCanonical ( xml ): canonical XML 1.1 with comments; empty when the XML doesn't parse.
eager('BE_XMLCanonical', 1, 1, (v, env) => {
  try {
    return beResult(env, 0, text(canonicalXml(T(v[0], env))));
  } catch (e) {
    if (e instanceof HostWait) throw e;
    return beResult(env, 0, text(''));
  }
});
// BE_XMLTidy ( xml ): indented with tabs, one element per line; "?" (error 718) when it doesn't parse.
const BE_XML_PARSE_ERROR = 718;
eager('BE_XMLTidy', 1, 1, (v, env) => {
  try {
    return beResult(env, 0, text(tidyXml(T(v[0], env))));
  } catch (e) {
    if (e instanceof HostWait) throw e;
    beErrors.set(env.ctx, (e as Error).message);
    return beResult(env, BE_XML_PARSE_ERROR, text('?'));
  }
});
// BE_XMLStripInvalidCharacters ( path {; destination } ): drops control characters XML can't hold from a UTF-16
// file (FileMaker's DDR), in place by default, and gives how many bytes went. Nothing is written when none did.
eager('BE_XMLStripInvalidCharacters', 1, 2, (v, env) => {
  const files = env.ctx.files;
  const source = T(v[0], env);
  const bytes = files?.read(source);
  if (!bytes) return beResult(env, BE_NO_FILE, text('?'));
  const { data, skipped } = stripInvalidUtf16(bytes);
  if (skipped > 0 && !files?.write(v[1] === undefined ? source : T(v[1], env), data, false)) return beResult(env, BE_NO_FILE, text('?'));
  return beResult(env, 0, num(skipped));
});

// BE_XMLStripNodes ( inputFilePath ; outputFilePath ; nodeNames ): writes the XML file without the elements named in
// nodeNames (a space separated list; a name matches the element as written or by its local name) and everything inside
// them. Gives "" on success. The XML declaration is kept; other layout is the parser's.
eager('BE_XMLStripNodes', 3, 3, (v, env) => {
  const files = env.ctx.files;
  const bytes = files?.read(T(v[0], env));
  if (!bytes) return beResult(env, BE_NO_FILE, text('?'));
  const names = new Set(T(v[2], env).split(/\s+/).filter(Boolean));
  const source = new TextDecoder().decode(bytes);
  try {
    const doc = parseXmlDocument(source);
    const strip = (n: XNode): void => {
      n.children = n.children.filter((c) => c.kind !== 'element' || !(names.has(c.name) || names.has(c.localName)));
      for (const c of n.children) strip(c);
    };
    strip(doc);
    const root = doc.children.find((c) => c.kind === 'element');
    const declaration = /^\s*(<\?xml[^>]*\?>)/.exec(source)?.[1];
    const out = (declaration ? declaration + '\n' : '') + (root ? xpathXml({ type: 'nodeset', nodes: [root] }) : '');
    if (!files?.write(T(v[1], env), out, false)) return beResult(env, BE_NO_FILE, text('?'));
    return beResult(env, 0, text(''));
  } catch (e) {
    if (e instanceof HostWait) throw e;
    beErrors.set(env.ctx, (e as Error).message);
    return beResult(env, BE_XML_PARSE_ERROR, text('?'));
  }
});

eager('BE_EvaluateJavaScript', 1, 1, (v, env) => {
  // Only the json custom functions' fixed programs, computed natively; no JavaScript is run.
  const known = knownJavaScript(T(v[0], env));
  if (known !== undefined) return text(known);
  beErrors.set(env.ctx, 'JavaScript is not run in Tabularius');
  return text('?');
});
