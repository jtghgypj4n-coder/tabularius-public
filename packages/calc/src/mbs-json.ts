// MBS ( "JSON.…" ): MonkeyBread's JSON functions, following MBS's own function pages (mbsplugins.eu).
// Numbers keep the digits they were written with, so large numbers pass through without rounding, as MBS does.
// A JSON parameter is JSON text or a reference number from JSON.Parse, CreateObjectRef or CreateArrayRef; adding
// to or deleting from a reference changes it in place and gives the reference back.
// Not here: JSON.ReplaceEvaluate, Colorize's styled text, the record
// and import functions, conversions (CSV, HTML, XML, TOON), and the functions whose pages haven't been checked.
// They give an "isn't available" MBS error.

import { MbsError } from './mbs-text.ts';
import { jmesSearch } from './jmespath.ts';
import { jsonPathMatches, replaceAt } from './jsonpath.ts';
import { withRegexBudget } from './regex-guard.ts';
import { ENTRY_BYTES, retainedBudget, type RetainedBudget } from './retained-budget.ts';
import { MAX_TEXT_RESULT } from './text-budget.ts';

export type Json =
  | { t: 'null' }
  | { t: 'bool'; v: boolean }
  | { t: 'num'; raw: string }
  | { t: 'str'; v: string }
  | { t: 'arr'; items: Json[] }
  | { t: 'obj'; entries: [string, Json][]; /** Where each key is in entries, built when first needed. */ index?: Map<string, number> };

/** A parameter: its text, and whether FileMaker gave it as a number (AddValueTo… and CreateValue go by that). */
export interface Arg { text: string; number: boolean }

// --- reading -----------------------------------------------------------------------------

const MAX_DEPTH = 512;

/** JSON text as a tree. Leading zeros on numbers are accepted, as MBS has since 11.2. */
export function parseJson(s: string): Json {
  let i = 0;
  const fail = (what: string): never => {
    throw new MbsError(`JSON parse error: ${what} at offset ${i}`);
  };
  const ws = () => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
  };
  const value = (depth: number): Json => {
    if (depth > MAX_DEPTH) fail('too deeply nested');
    ws();
    const c = s[i];
    if (c === '{') {
      i++;
      const entries: [string, Json][] = [];
      ws();
      if (s[i] === '}') {
        i++;
        return { t: 'obj', entries };
      }
      for (;;) {
        ws();
        if (s[i] !== '"') fail('expected a key');
        const key = string();
        ws();
        if (s[i] !== ':') fail('expected ":"');
        i++;
        entries.push([key, value(depth + 1)]);
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === '}') {
          i++;
          return { t: 'obj', entries };
        }
        fail('expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const items: Json[] = [];
      ws();
      if (s[i] === ']') {
        i++;
        return { t: 'arr', items };
      }
      for (;;) {
        items.push(value(depth + 1));
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === ']') {
          i++;
          return { t: 'arr', items };
        }
        fail('expected "," or "]"');
      }
    }
    if (c === '"') return { t: 'str', v: string() };
    for (const [word, v] of [['true', { t: 'bool', v: true }], ['false', { t: 'bool', v: false }], ['null', { t: 'null' }]] as const) {
      if (s.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(i, i + 4096));
    if (!m) fail('unexpected character');
    i += m![0].length;
    return { t: 'num', raw: m![0] };
  };
  const string = (): string => {
    i++;
    let out = '';
    for (;;) {
      const start = i;
      // Control characters such as a return are taken as they are, as MBS's parser does.
      while (i < s.length && s[i] !== '"' && s[i] !== '\\') i++;
      out += s.slice(start, i);
      if (i >= s.length) fail('unterminated string');
      const c = s[i];
      if (c === '"') {
        i++;
        return out;
      }
      const e = s[i + 1];
      const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (e in simple) {
        out += simple[e];
        i += 2;
      } else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
        i += 6;
      } else fail('bad escape');
    }
  };
  const v = value(0);
  ws();
  if (i < s.length) fail('unexpected text after the JSON');
  return v;
}

// --- writing -----------------------------------------------------------------------------

const quote = (s: string) =>
  '"' + s.replace(/["\\\u0000-\u001f]/g, (c) => ({ '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c] ?? '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"';

const scalar = (j: Json): string =>
  j.t === 'null' ? 'null' : j.t === 'bool' ? String(j.v) : j.t === 'num' ? j.raw : j.t === 'str' ? quote(j.v) : '';

/** No white space at all (JSON.Compact). */
export function compact(j: Json): string {
  if (j.t === 'arr') return '[' + j.items.map(compact).join(',') + ']';
  if (j.t === 'obj') return '{' + j.entries.map(([k, v]) => quote(k) + ':' + compact(v)).join(',') + '}';
  return scalar(j);
}

export interface FormatOptions { indent: string; afterKey: string }
export const DEFAULT_FORMAT: FormatOptions = { indent: '\t', afterKey: ' ' };

/**
 * Pretty JSON, as JSON.Format writes it: one object member per line, indented, with the text after each key's
 * colon; an array of plain values stays on one line ("[2, 3, 4]"). An array holding objects or arrays puts each
 * on its own line (inferred: MBS's pages show only flattened renderings of that case).
 */
export function pretty(j: Json, o: FormatOptions = DEFAULT_FORMAT, level = 0, room: { left: number } = { left: MAX_TEXT_RESULT }): string {
  // Indent times depth makes the text far larger than the JSON: every line is charged before it is built, so a
  // text over the limit is refused after about that much work, not after it has been written out.
  const take = (n: number) => {
    if ((room.left -= n) < 0) throw new RangeError('The result is too large');
  };
  const pad = (n: number) => (take(o.indent.length * n), o.indent.repeat(n));
  if (j.t === 'arr') {
    if (!j.items.length) return '[]';
    if (j.items.every((x) => x.t !== 'arr' && x.t !== 'obj')) {
      const text = '[' + j.items.map(scalar).join(', ') + ']';
      take(text.length);
      return text;
    }
    return '[\n' + j.items.map((x) => pad(level + 1) + pretty(x, o, level + 1, room)).join(',\n') + '\n' + pad(level) + ']';
  }
  if (j.t === 'obj') {
    if (!j.entries.length) return '{}';
    return '{\n' + j.entries.map(([k, v]) => pad(level + 1) + quote(k) + ':' + o.afterKey + pretty(v, o, level + 1, room)).join(',\n') + '\n' + pad(level) + '}';
  }
  const text = scalar(j);
  take(text.length);
  return text;
}

/** A value as FileMaker text: a string without quotes, true and false as 1 and 0, null as empty, objects and arrays as JSON. */
function plain(j: Json, o: FormatOptions): string {
  if (j.t === 'str') return j.v;
  if (j.t === 'bool') return j.v ? '1' : '0';
  if (j.t === 'null') return '';
  if (j.t === 'num') return j.raw;
  return pretty(j, o);
}

// --- sessions and references --------------------------------------------------------------
// Parsed JSON is kept per session, like RegEx's compiled expressions. MBS doesn't say how it numbers its
// references. Tabularius starts each session's numbers at a large random place, so a reference is never mistaken
// for an ordinary number in the data (an ID of 1 passed to AddItemToObject is the number 1).

/** The session's open references; each tree is charged to the session's retained-memory budget until it is released. */
class RefMap extends Map<number, Json> {
  private sizes = new Map<number, number>();
  private budget: RetainedBudget;
  constructor(budget: RetainedBudget) { super(); this.budget = budget; }
  override set(ref: number, j: Json): this {
    const size = retainedBytes(j);
    this.budget.replace(this.sizes.get(ref) ?? 0, size);
    this.sizes.set(ref, size);
    return super.set(ref, j);
  }
  override delete(ref: number): boolean {
    if (!super.delete(ref)) return false;
    this.budget.replace(this.sizes.get(ref)!, 0);
    this.sizes.delete(ref);
    return true;
  }
  override clear(): void {
    for (const size of this.sizes.values()) this.budget.replace(size, 0);
    this.sizes.clear();
    super.clear();
  }
}
/** Logical bytes a tree holds: UTF-16 text plus a fixed amount per value, as the other plug-in stores count. */
function retainedBytes(root: Json): number {
  let bytes = 0;
  const stack: Json[] = [root];
  while (stack.length) {
    const j = stack.pop()!;
    bytes += ENTRY_BYTES;
    if (j.t === 'str') bytes += j.v.length * 2;
    else if (j.t === 'num') bytes += j.raw.length * 2;
    else if (j.t === 'arr') for (const x of j.items) stack.push(x);
    else if (j.t === 'obj') for (const [k, x] of j.entries) (bytes += k.length * 2), stack.push(x);
  }
  return bytes;
}
interface Session { next: number; refs: Map<number, Json>; format: FormatOptions }
const sessions = new WeakMap<object, Session>();
const MAX_LIVE = 10_000;
const sessionOf = (scope: object): Session => {
  let s = sessions.get(scope);
  if (!s) sessions.set(scope, (s = { next: 100_000_000 + Math.floor(Math.random() * 800_000_000), refs: new RefMap(retainedBudget(scope)), format: { ...DEFAULT_FORMAT } }));
  return s;
};
function keep(scope: object, j: Json): number {
  const s = sessionOf(scope);
  if (s.refs.size >= MAX_LIVE) throw new MbsError(`Too many JSON references are open (${MAX_LIVE}); release them with JSON.Release`);
  checkSize(j);
  const ref = s.next++;
  s.refs.set(ref, j);
  return ref;
}

// A formula can build JSON a step at a time, or double a reference into itself: what it builds is kept to a size
// and depth the server can hold and write out.
const MAX_NODES = 1_000_000;
function checkSize(root: Json): void {
  let nodes = 0;
  const stack: [Json, number][] = [[root, 1]];
  while (stack.length) {
    const [j, depth] = stack.pop()!;
    if (++nodes > MAX_NODES) throw new MbsError(`The JSON is too large (more than ${MAX_NODES} values)`);
    if (depth > MAX_DEPTH) throw new MbsError(`The JSON is nested too deeply (more than ${MAX_DEPTH} levels)`);
    if (j.t === 'arr') for (const x of j.items) stack.push([x, depth + 1]);
    else if (j.t === 'obj') for (const [, x] of j.entries) stack.push([x, depth + 1]);
  }
}

/** What `root` weighs: one for each value, and one more for every 64 characters of text; stops counting past `limit`. */
function weigh(root: Json, limit: number): number {
  let weight = 0;
  const stack: Json[] = [root];
  while (stack.length && weight <= limit) {
    const j = stack.pop()!;
    weight++;
    if (j.t === 'str') weight += j.v.length >> 6;
    else if (j.t === 'arr') for (const x of j.items) stack.push(x);
    else if (j.t === 'obj') for (const [k, x] of j.entries) {
      weight += k.length >> 6;
      stack.push(x);
    }
  }
  return weight;
}

/** A JSON parameter: a live reference of this session, or JSON text. */
interface Input { j: Json; ref?: number }
function input(scope: object, text: string): Input {
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    const j = sessionOf(scope).refs.get(Number(t));
    if (j) return { j, ref: Number(t) };
  }
  if (t === '') throw new MbsError('No JSON was given');
  return { j: parseJson(text) };
}
/** Mutations work on a private candidate; output publishes it after all checks pass. */
function mutableInput(scope: object, text: string): Input {
  const inp = input(scope, text);
  return { ...inp, j: clone(inp.j) };
}
/** After a change: the reference again, or the changed JSON as text. */
const output = (scope: object, inp: Input, j: Json): string | number => {
  checkSize(j);
  if (inp.ref !== undefined) {
    sessionOf(scope).refs.set(inp.ref, j);
    return inp.ref;
  }
  return pretty(j, sessionOf(scope).format);
};
const clone = (j: Json): Json =>
  j.t === 'arr' ? { t: 'arr', items: j.items.map(clone) } : j.t === 'obj' ? { t: 'obj', entries: j.entries.map(([k, v]) => [k, clone(v)]) } : j;

// --- values from FileMaker ------------------------------------------------------------------

// \d+(?:\.\d*)? and not \d+\.?\d*: with two ways to split a run of digits the match is quadratic on a long run that ends in a non-digit.
const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** A number parameter as a JSON number; FileMaker's ".5" is written 0.5. */
function number(text: string): Json {
  const t = text.trim();
  if (!NUMBER.test(t)) throw new MbsError(`"${text}" is not a number`);
  return { t: 'num', raw: t.replace(/^(-?)\./, '$10.').replace(/\.(?=$|[eE])/, '') };
}
const str = (v: string): Json => ({ t: 'str', v });
/** A FileMaker value: a number as a number, anything else as text. */
const valueOf = (a: Arg): Json => (a.number && NUMBER.test(a.text.trim()) ? number(a.text) : str(a.text));
/** JSON text for an item (AddItemTo…), or a reference, copied. */
const item = (scope: object, text: string): Json => clone(input(scope, text).j);
const truthy = (s: string | undefined) => s !== undefined && s.trim() !== '' && Number(s) !== 0 && !Number.isNaN(Number(s));
const int = (s: string | undefined, d = 0) => (s === undefined || !/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(s) ? d : Math.trunc(Number(s)));

function needArray(j: Json): Extract<Json, { t: 'arr' }> {
  if (j.t !== 'arr') throw new MbsError('The JSON is not an array');
  return j;
}
function needObject(j: Json): Extract<Json, { t: 'obj' }> {
  if (j.t !== 'obj') throw new MbsError('The JSON is not an object');
  return j;
}
type Obj = Extract<Json, { t: 'obj' }>;
/** Where a key is in an object, or -1. */
function keyAt(o: Obj, key: string): number {
  if (!o.index) {
    o.index = new Map();
    o.entries.forEach(([k], i) => o.index!.has(k) || o.index!.set(k, i));
  }
  return o.index.get(key) ?? -1;
}
/** Sets a key, replacing one already there (MBS has replaced rather than duplicated since 16.2). */
function setKey(o: Obj, key: string, v: Json): void {
  const at = keyAt(o, key);
  if (at >= 0) o.entries[at] = [key, v];
  else {
    o.index!.set(key, o.entries.length);
    o.entries.push([key, v]);
  }
}
const valueAt = (o: Obj, key: string): Json | undefined => o.entries[keyAt(o, key)]?.[1];

// --- paths ------------------------------------------------------------------------------------
// MBS's list paths ("people¶0¶last"), and since 12.4 FileMaker's own ("people[0]last", ".people.best.first",
// "['best.friend']"). A path with no return and no "." or "[" is a single key or index.

type Step = { key: string } | { index: number; text: string } | { append: true } | { count: true };

function pathOf(path: string): Step[] {
  if (/[\r\n]/.test(path) || !/[.[]/.test(path)) {
    const parts = path.split(/\r\n|\r|\n/);
    return parts.map((p, n): Step => {
      if (p === '#' && n === parts.length - 1) return { count: true };
      if (p === 'append' && n === parts.length - 1) return { append: true };
      return /^\d+$/.test(p) ? { index: Number(p), text: p } : { key: p };
    });
  }
  const steps: Step[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === '.') {
      i++;
      continue;
    }
    if (path[i] === '[') {
      const q = /^\[\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(\d+)|(\+))\s*\]/.exec(path.slice(i));
      if (!q) throw new MbsError(`Invalid path: ${path}`);
      if (q[3] !== undefined) steps.push({ index: Number(q[3]), text: q[3] });
      else if (q[4]) steps.push({ append: true });
      else steps.push({ key: (q[1] ?? q[2]).replace(/\\(.)/g, '$1') });
      i += q[0].length;
      continue;
    }
    const m = /^[^.[]+/.exec(path.slice(i))!;
    steps.push({ key: m[0] });
    i += m[0].length;
  }
  return steps;
}

function getPath(root: Json, steps: Step[]): Json | number {
  let j = root;
  for (const s of steps) {
    if ('count' in s) return needArray(j).items.length;
    if ('append' in s) throw new MbsError('"append" works only when setting');
    if (j.t === 'arr') {
      if (!('index' in s)) throw new MbsError(`"${(s as { key: string }).key}" is not an array index`);
      const next = j.items[s.index];
      if (next === undefined) throw new MbsError(`Index ${s.index} is out of range`);
      j = next;
    } else if (j.t === 'obj') {
      const key = 'key' in s ? s.key : s.text;
      const found = valueAt(j, key);
      if (!found) throw new MbsError(`No item named "${key}"`);
      j = found;
    } else throw new MbsError('The path goes past a value');
  }
  return j;
}

/** Sets the value at the path, making objects and arrays on the way (arrays padded with null). */
function setPath(root: Json, steps: Step[], v: Json, budget = { nulls: 100_000 }): Json {
  if (!steps.length) return v;
  if (steps.length > MAX_DEPTH) throw new MbsError(`The path is too long (more than ${MAX_DEPTH} steps)`);
  const [s, ...rest] = steps;
  if ('count' in s) throw new MbsError('"#" works only when reading');
  const fresh = (): Json => ('index' in s || 'append' in s ? { t: 'arr', items: [] } : { t: 'obj', entries: [] });
  const j = root.t === 'arr' || root.t === 'obj' ? root : root.t === 'null' ? fresh() : (() => {
    throw new MbsError('The path goes past a value');
  })();
  if (j.t === 'arr') {
    if ('key' in s) throw new MbsError(`"${s.key}" is not an array index`);
    const at = 'append' in s ? j.items.length : s.index;
    // Padding with null is kept to a total for the whole path.
    budget.nulls -= Math.max(0, at - j.items.length);
    if (budget.nulls < 0) throw new MbsError(`Index ${at} is too large`);
    while (j.items.length < at) j.items.push({ t: 'null' });
    j.items[at] = setPath(j.items[at] ?? { t: 'null' }, rest, v, budget);
    return j;
  }
  if ('append' in s) throw new MbsError('"append" needs an array');
  const key = 'key' in s ? s.key : s.text;
  const o = j as Obj;
  setKey(o, key, setPath(valueAt(o, key) ?? { t: 'null' }, rest, v, budget));
  return o;
}

// --- comparing -------------------------------------------------------------------------------

// MBS number equality is by numeric value; canonicalise decimal text without a lossy Number conversion.
function canonicalNumber(raw: string): string {
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw)!;
  const negative = m[1] === '-' ? '-' : '';
  const fraction = m[3] ?? '';
  let digits = (m[2] + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = BigInt(m[4] ?? '0') - BigInt(fraction.length);
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); exponent++; }
  return `${negative}${digits}e${exponent}`;
}
function equal(a: Json, b: Json, byContent: boolean): boolean {
  if (byContent && a.t !== 'arr' && a.t !== 'obj' && b.t !== 'arr' && b.t !== 'obj') {
    const text = (j: Json) => (j.t === 'str' ? j.v : j.t === 'num' ? String(Number(j.raw)) : scalar(j));
    if (a.t === 'num' || b.t === 'num') {
      const [x, y] = [a.t === 'num' ? Number(a.raw) : a.t === 'str' && a.v.trim() !== '' ? Number(a.v) : NaN, b.t === 'num' ? Number(b.raw) : b.t === 'str' && b.v.trim() !== '' ? Number(b.v) : NaN];
      return x === y;
    }
    return text(a) === text(b);
  }
  if (a.t !== b.t) return false;
  switch (a.t) {
    case 'null': return true;
    case 'bool': return a.v === (b as typeof a).v;
    case 'num': return canonicalNumber(a.raw) === canonicalNumber((b as typeof a).raw);
    case 'str': return a.v === (b as typeof a).v;
    case 'arr': {
      const bi = (b as typeof a).items;
      return a.items.length === bi.length && a.items.every((x, i) => equal(x, bi[i], byContent));
    }
    case 'obj': {
      const bo = b as typeof a;
      // Objects match whatever order their entries are in.
      return a.entries.length === bo.entries.length && a.entries.every(([k, v]) => {
        const other = valueAt(bo, k);
        return other !== undefined && equal(v, other, byContent);
      });
    }
  }
}

/** Text that is the same for two values exactly when equal(a, b, false) holds. */
function canonical(j: Json): string {
  switch (j.t) {
    case 'null': return 'z';
    case 'bool': return 'b' + j.v;
    case 'num': return 'n' + canonicalNumber(j.raw);
    case 'str': return 's' + JSON.stringify(j.v);
    case 'arr': return '[' + j.items.map(canonical).join(',') + ']';
    case 'obj': return '{' + j.entries.map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).sort().join(',') + '}';
  }
}

/** JSON.Merge: arrays gain the values they don't have yet; objects gain new keys, merge objects and arrays, and take other values from the later JSON. */
function merge(a: Json, b: Json): Json {
  if (a.t === 'arr' && b.t === 'arr') {
    const items = [...a.items];
    // Plain values are looked up by a key.
    const keyOf = (x: Json) => (x.t === 'num' ? 'n' + canonicalNumber(x.raw) : x.t === 'str' ? 's' + x.v : x.t === 'bool' ? 'b' + x.v : x.t === 'null' ? 'z' : undefined);
    // Objects and arrays are looked up by a canonical text (equal() ignores the order of an object's entries and
    // compares numbers by value), so merging two long arrays of objects is not N × M comparisons.
    const keyed = (x: Json) => keyOf(x) ?? 'c' + canonical(x);
    const seen = new Set(items.map(keyed));
    for (const x of b.items) {
      const k = keyed(x);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(clone(x));
    }
    return { t: 'arr', items };
  }
  if (a.t === 'obj' && b.t === 'obj') {
    const out: Obj = { t: 'obj', entries: a.entries.map(([k, v]) => [k, clone(v)]) };
    for (const [k, v] of b.entries) {
      const old = valueAt(out, k);
      setKey(out, k, old && ((old.t === 'arr' && v.t === 'arr') || (old.t === 'obj' && v.t === 'obj')) ? merge(old, v) : clone(v));
    }
    return out;
  }
  throw new MbsError('JSON.Merge needs objects or arrays of the same kind');
}

/** A number node's value, or a text node's when it reads as a number, a true as 1; 0 for anything else. */
const numeric = (j: Json): number => {
  const v = j.t === 'num' ? Number(j.raw) : j.t === 'str' && j.v.trim() !== '' ? Number(j.v) : j.t === 'bool' ? Number(j.v) : 0;
  return Number.isFinite(v) ? v : 0;
};

const typeName = (j: Json) =>
  j.t === 'bool' ? String(j.v) : ({ null: 'null', num: 'number', str: 'string', arr: 'array', obj: 'object' } as const)[j.t];

/** JSON.Sort: an array's numbers by value and text by text; an object's keys in order (inferred: MBS gives no examples' results). */
function sortJson(j: Json): Json {
  if (j.t === 'obj') return { t: 'obj', entries: [...j.entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) };
  if (j.t !== 'arr') return j;
  const rank = (x: Json) => ({ null: 0, bool: 1, num: 2, str: 3, arr: 4, obj: 5 })[x.t];
  return {
    t: 'arr',
    items: [...j.items].sort((x, y) => {
      if (rank(x) !== rank(y)) return rank(x) - rank(y);
      if (x.t === 'num' && y.t === 'num') return Number(x.raw) - Number(y.raw);
      if (x.t === 'str' && y.t === 'str') return x.v < y.v ? -1 : x.v > y.v ? 1 : 0;
      if (x.t === 'bool' && y.t === 'bool') return Number(x.v) - Number(y.v);
      return 0;
    }),
  };
}

// --- the functions --------------------------------------------------------------------------

type MbsJson = (a: Arg[], scope: object) => string | number;
const texts = (a: Arg[]) => a.map((x) => x.text);

/** Adds name/value pairs to an object (text or reference). */
const addToObject = (make: (a: Arg, scope: object) => Json): MbsJson => (a, scope) => {
  const inp = mutableInput(scope, a[0]?.text ?? '');
  const o = needObject(inp.j);
  for (let i = 1; i + 1 < a.length; i += 2) setKey(o, a[i].text, make(a[i + 1], scope));
  return output(scope, inp, o);
};
/** Adds names with one fixed value (AddTrueToObject and the like). */
const addFixedToObject = (v: Json): MbsJson => (a, scope) => {
  const inp = mutableInput(scope, a[0]?.text ?? '');
  const o = needObject(inp.j);
  for (const n of a.slice(1)) setKey(o, n.text, clone(v));
  return output(scope, inp, o);
};
/** Adds values to an array; empty parameters are skipped, as MBS has since 11.3. */
const addToArray = (make: (a: Arg, scope: object) => Json, skipEmpty = true): MbsJson => (a, scope) => {
  const inp = mutableInput(scope, a[0]?.text ?? '');
  const arr = needArray(inp.j);
  for (const x of a.slice(1)) if (!skipEmpty || x.text !== '') arr.items.push(make(x, scope));
  return output(scope, inp, arr);
};

export const MBS_JSON: Record<string, MbsJson> = {
  'json.parse': ([j], scope) => keep(scope, parseJson(j?.text ?? '')),
  'json.createobjectref': (_, scope) => keep(scope, { t: 'obj', entries: [] }),
  'json.createarrayref': (_, scope) => keep(scope, { t: 'arr', items: [] }),
  'json.release': ([ref], scope) => {
    for (const r of (ref?.text ?? '').split(/[\r\n]+/).filter((x) => x.trim())) {
      if (!sessionOf(scope).refs.delete(Number(r))) throw new MbsError(`Invalid JSON reference: ${r}`);
    }
    return 'OK';
  },
  'json.releaseall': (_, scope) => (sessionOf(scope).refs.clear(), 'OK'),
  'json.list': (_, scope) => [...sessionOf(scope).refs.keys()].join('\r'),

  'json.format': ([j], scope) => pretty(input(scope, j?.text ?? '').j, sessionOf(scope).format),
  'json.compact': ([j], scope) => compact(input(scope, j?.text ?? '').j),
  'json.setformatoptions': ([indent, after], scope) => {
    const [i, a] = [indent?.text ?? DEFAULT_FORMAT.indent, after?.text ?? DEFAULT_FORMAT.afterKey];
    if (i.length > 16 || a.length > 16) throw new MbsError('The indent and the text after a key can be at most 16 characters');
    sessionOf(scope).format = { indent: i, afterKey: a };
    return 'OK';
  },
  'json.isvalid': ([j]) => {
    try {
      parseJson(j?.text ?? '');
      return 1;
    } catch {
      return 0;
    }
  },

  // Flags: 1 a plain value instead of JSON, +2 empty instead of an error (missing item, or since 14.3 bad JSON).
  'json.getpathitem': ([j, path, flags], scope) => {
    const f = int(flags?.text);
    try {
      const found = getPath(input(scope, j?.text ?? '').j, pathOf(path?.text ?? ''));
      if (typeof found === 'number') return found;
      return f & 1 ? plain(found, sessionOf(scope).format) : pretty(found, sessionOf(scope).format);
    } catch (e) {
      if (f & 2 && e instanceof MbsError) return '';
      throw e;
    }
  },
  // The value is JSON; one that isn't (since 14.3) is taken as text. An empty value changes nothing (since 13.0).
  'json.setpathitem': ([j, path, value], scope) => {
    const inp = mutableInput(scope, j?.text ?? '');
    const v = value?.text ?? '';
    if (v === '') return output(scope, inp, inp.j);
    let parsed: Json;
    try {
      parsed = input(scope, v).j;
      parsed = clone(parsed);
    } catch {
      parsed = str(v);
    }
    return output(scope, inp, setPath(inp.j, pathOf(path?.text ?? ''), parsed));
  },
  'json.getobjectitemtree': ([j, ...names], scope) => {
    let cur = input(scope, j?.text ?? '').j;
    for (const n of names) {
      if (n.text === '') continue;
      const found = getPath(cur, [cur.t === 'arr' && /^\d+$/.test(n.text) ? { index: Number(n.text), text: n.text } : { key: n.text }]);
      cur = found as Json;
    }
    return pretty(cur, sessionOf(scope).format);
  },
  'json.getobjectitemtreeref': ([j, ...names], scope) => {
    let cur = input(scope, j?.text ?? '').j;
    for (const n of names) {
      if (n.text === '') continue;
      cur = getPath(cur, [cur.t === 'arr' && /^\d+$/.test(n.text) ? { index: Number(n.text), text: n.text } : { key: n.text }]) as Json;
    }
    return keep(scope, clone(cur));
  },

  'json.createobject': () => '{}',
  'json.createarray': () => '[]',
  'json.createnull': () => 'null',
  'json.createtrue': () => 'true',
  'json.createfalse': () => 'false',
  'json.createboolean': ([v]) => (truthy(v?.text) ? 'true' : 'false'),
  'json.createnumber': ([v]) => compact(number(v?.text ?? '')),
  'json.createstring': ([v]) => quote(v?.text ?? ''),
  'json.createvalue': ([v]) => compact(v ? valueOf(v) : str('')),
  'json.createstringarray': (a, scope) => pretty({ t: 'arr', items: texts(a).map(str) }, sessionOf(scope).format),
  'json.createdoublearray': (a, scope) => pretty({ t: 'arr', items: texts(a).map(number) }, sessionOf(scope).format),

  'json.additemtoobject': addToObject((a, scope) => item(scope, a.text)),
  'json.addstringtoobject': addToObject((a) => str(a.text)),
  'json.addnumbertoobject': addToObject((a) => number(a.text)),
  'json.addvaluetoobject': addToObject(valueOf),
  'json.addbooleantoobject': addToObject((a) => ({ t: 'bool', v: truthy(a.text) })),
  'json.addtruetoobject': addFixedToObject({ t: 'bool', v: true }),
  'json.addfalsetoobject': addFixedToObject({ t: 'bool', v: false }),
  'json.addnulltoobject': addFixedToObject({ t: 'null' }),
  'json.additemtoarray': addToArray((a, scope) => item(scope, a.text)),
  'json.addstringtoarray': addToArray((a) => str(a.text), false),
  'json.addnumbertoarray': addToArray((a) => number(a.text)),
  'json.addvaluetoarray': addToArray(valueOf, false),
  // Arrays have their items added; any other JSON is added as one item.
  'json.addarraytoarray': (a, scope) => {
    const inp = mutableInput(scope, a[0]?.text ?? '');
    const arr = needArray(inp.j);
    for (const x of a.slice(1)) {
      if (x.text === '') continue;
      const other = item(scope, x.text);
      if (other.t === 'arr') arr.items.push(...other.items);
      else arr.items.push(other);
    }
    return output(scope, inp, arr);
  },

  'json.deleteitemfromarray': ([j, index], scope) => {
    const inp = mutableInput(scope, j?.text ?? '');
    const arr = needArray(inp.j);
    const i = int(index?.text, -1);
    if (i < 0 || i >= arr.items.length) throw new MbsError(`Index ${index?.text ?? ''} is out of range`);
    arr.items.splice(i, 1);
    return output(scope, inp, arr);
  },
  'json.deleteitemfromobject': ([j, name], scope) => {
    const inp = mutableInput(scope, j?.text ?? '');
    const o = needObject(inp.j);
    o.entries = o.entries.filter(([k]) => k !== (name?.text ?? ''));
    o.index = undefined;
    return output(scope, inp, o);
  },
  'json.replaceiteminobject': ([j, name, v], scope) => {
    const inp = mutableInput(scope, j?.text ?? '');
    const o = needObject(inp.j);
    if (keyAt(o, name?.text ?? '') < 0) throw new MbsError(`No item named "${name?.text ?? ''}"`);
    setKey(o, name?.text ?? '', item(scope, v?.text ?? ''));
    return output(scope, inp, o);
  },
  'json.replaceiteminarray': ([j, index, v], scope) => {
    const inp = mutableInput(scope, j?.text ?? '');
    const arr = needArray(inp.j);
    const i = int(index?.text, -1);
    if (i < 0 || i >= arr.items.length) throw new MbsError(`Index ${index?.text ?? ''} is out of range`);
    arr.items[i] = item(scope, v?.text ?? '');
    return output(scope, inp, arr);
  },

  'json.getarraysize': ([j], scope) => ((j?.text ?? '').trim() === '' ? 0 : needArray(input(scope, j!.text).j).items.length),
  'json.getobjectsize': ([j], scope) => needObject(input(scope, j?.text ?? '').j).entries.length,
  'json.gettype': ([j], scope) => typeName(input(scope, j?.text ?? '').j),
  // Flags: 0 JSON, 1 a new reference, 2 the plain value.
  'json.getarrayitem': ([j, index, flags], scope) => {
    const arr = needArray(input(scope, j?.text ?? '').j);
    const i = int(index?.text, -1);
    const found = arr.items[i];
    if (i < 0 || found === undefined) throw new MbsError(`Index ${index?.text ?? ''} is out of range`);
    const f = int(flags?.text);
    return f === 1 ? keep(scope, clone(found)) : f === 2 ? plain(found, sessionOf(scope).format) : pretty(found, sessionOf(scope).format);
  },
  // A missing key gives empty text (MBS's own error example tests for "").
  'json.getobjectitem': ([j, name, asRef], scope) => {
    const o = needObject(input(scope, j?.text ?? '').j);
    const found = valueAt(o, name?.text ?? '');
    if (!found) return '';
    return truthy(asRef?.text) ? keep(scope, clone(found)) : pretty(found, sessionOf(scope).format);
  },
  'json.getobjectnamelist': ([j], scope) => needObject(input(scope, j?.text ?? '').j).entries.map(([k]) => k).join('\r'),
  // One line per item: strings keep their quotes unless ReturnValues is 1.
  'json.getarrayitemsaslist': ([j, values], scope) => {
    if ((j?.text ?? '').trim() === '') return '';
    const arr = needArray(input(scope, j!.text).j);
    const fmt = sessionOf(scope).format;
    return arr.items.map((x) => (truthy(values?.text) ? plain(x, fmt) : x.t === 'arr' || x.t === 'obj' ? compact(x) : scalar(x))).join('\r');
  },
  // Empty input gives empty text, as MBS has since 13.4.
  'json.getstringvalue': ([j], scope) => {
    if ((j?.text ?? '').trim() === '') return '';
    const x = input(scope, j!.text).j;
    return x.t === 'str' ? x.v : plain(x, sessionOf(scope).format);
  },
  'json.getvalue': ([j], scope) => ((j?.text ?? '').trim() === '' ? '' : plain(input(scope, j!.text).j, sessionOf(scope).format)),

  // A new reference to a copy.
  'json.clone': ([j], scope) => keep(scope, clone(input(scope, j?.text ?? '').j)),
  // Start (default 0) and End (default the end, not included) count from the end when negative and stop at the array's
  // ends; AsReference 1 gives a reference to the new array. (The page's first example, 1 to 2, shows two items, but its
  // own rule and its -3 to -1 example leave the End item out: that is followed.)
  'json.arrayslice': ([j, start, end, asRef], scope) => {
    const arr = needArray(input(scope, j?.text ?? '').j);
    const n = arr.items.length;
    const at = (a: Arg | undefined, d: number) => {
      if (a === undefined || a.text.trim() === '') return d;
      const v = int(a.text, d);
      return Math.min(n, Math.max(0, v < 0 ? n + v : v));
    };
    const from = at(start, 0);
    const to = at(end, n);
    const sliced: Json = { t: 'arr', items: arr.items.slice(from, Math.max(from, to)).map(clone) };
    return truthy(asRef?.text) ? keep(scope, sliced) : pretty(sliced, sessionOf(scope).format);
  },
  'json.getobjectname': ([j, index], scope) => {
    const o = needObject(input(scope, j?.text ?? '').j);
    const i = int(index?.text, -1);
    if (i < 0 || i >= o.entries.length) throw new MbsError(`Index ${index?.text ?? ''} is out of range`);
    return o.entries[i][0];
  },
  // The page gives one example ({"test": "🍎"} is "test: 🍎"): a text or other plain value as itself, an object of plain
  // values as "name: value" lines (a return between them is assumed). Arrays and nested values are not built.
  'json.text': ([j], scope) => {
    const x = input(scope, j?.text ?? '').j;
    const fmt = sessionOf(scope).format;
    if (x.t !== 'obj') {
      if (x.t === 'arr') throw new MbsError('JSON.Text isn\'t available for arrays here');
      return plain(x, fmt);
    }
    if (x.entries.some(([, v]) => v.t === 'arr' || v.t === 'obj')) throw new MbsError('JSON.Text isn\'t available for nested values here');
    return x.entries.map(([k, v]) => `${k}: ${plain(v, fmt)}`).join('\r');
  },
  // 1 for true, a number that is not 0, and the texts "1" and "true"; anything else 0. Empty input gives empty text.
  'json.getbooleanvalue': ([j], scope) => {
    if ((j?.text ?? '').trim() === '') return '';
    const x = input(scope, j!.text).j;
    return Number(x.t === 'bool' ? x.v : x.t === 'num' ? Number(x.raw) !== 0 : x.t === 'str' && (x.v === '1' || x.v.toLowerCase() === 'true'));
  },
  // The number in a number node (or a text that reads as one); 0 for anything else. Empty input gives empty text.
  'json.getdoublevalue': ([j], scope) => {
    if ((j?.text ?? '').trim() === '') return '';
    return numeric(input(scope, j!.text).j);
  },
  // The same, cut to a whole number.
  'json.getintegervalue': ([j], scope) => {
    if ((j?.text ?? '').trim() === '') return '';
    return Math.trunc(numeric(input(scope, j!.text).j));
  },

  // JSONPath (jsonpath.ts): the matching values as an array; the page gives no Flags, so only 0 is taken.
  'json.query': ([j, path, flags], scope) => {
    if (flags && flags.text.trim() !== '' && Number(flags.text) !== 0) throw new MbsError('JSON.Query flags other than 0 aren\'t available');
    const doc = input(scope, j?.text ?? '').j;
    const found = withRegexBudget(() => jsonPathMatches(doc, path?.text ?? '', false));
    // Matches can hold one another (or the same value many times): all of them together are kept to the size of a document.
    let total = 0;
    for (const m of found) if ((total += weigh(m.node, MAX_NODES - total)) > MAX_NODES) throw new MbsError(`The JSON is too large (more than ${MAX_NODES} values)`);
    return pretty({ t: 'arr', items: found.map((m) => clone(m.node)) }, sessionOf(scope).format);
  },
  // Each match becomes the new value (JSON, or since 14.1 plain text or a number); a reference is changed in place.
  'json.replace': ([j, path, replacement], scope) => {
    const inp = input(scope, j?.text ?? '');
    let value: Json;
    try {
      value = parseJson(replacement?.text ?? '');
    } catch {
      value = replacement?.number && NUMBER.test(replacement.text.trim()) ? number(replacement.text) : str(replacement?.text ?? '');
    }
    const root = clone(inp.j);
    const found = withRegexBudget(() => jsonPathMatches(root, path?.text ?? ''));
    if (found.length * weigh(value, MAX_NODES) > MAX_NODES) throw new MbsError(`The JSON is too large (more than ${MAX_NODES} values)`);
    return output(scope, inp, replaceAt(root, found, () => clone(value)));
  },

  // JMESPath (jmespath.ts): the result as JSON, null when nothing matches.
  'json.search': ([j, path], scope) => {
    const doc = input(scope, j?.text ?? '').j;
    const found = jmesSearch(doc, path?.text ?? '', { parse: parseJson, compact });
    // What shares parts with itself can be far larger written out than it looks, and long text counts for its length.
    if (weigh(found, MAX_NODES) > MAX_NODES) throw new MbsError(`The JSON is too large (more than ${MAX_NODES} values)`);
    checkSize(found);
    return pretty(found, sessionOf(scope).format);
  },

  'json.equals': ([a, b], scope) => Number(equal(input(scope, a?.text ?? '').j, input(scope, b?.text ?? '').j, false)),
  'json.equalcontent': ([a, b], scope) => Number(equal(input(scope, a?.text ?? '').j, input(scope, b?.text ?? '').j, true)),
  // Flags: 1 by content, 2 every index (a list), 4 a string containing the text; -1 when there is none.
  'json.findvalueinarray': ([j, find, flags, start], scope) => {
    const arr = needArray(input(scope, j?.text ?? '').j);
    const f = int(flags?.text);
    const want = input(scope, find?.text ?? '').j;
    const hits: number[] = [];
    for (let i = Math.max(0, int(start?.text)); i < arr.items.length; i++) {
      const x = arr.items[i];
      const hit = f & 4 && x.t === 'str' && want.t === 'str' ? x.v.includes(want.v) : equal(x, want, (f & 1) !== 0);
      if (!hit) continue;
      hits.push(i);
      if (!(f & 2)) break;
    }
    return !hits.length ? -1 : f & 2 ? hits.join('\r') : hits[0];
  },
  'json.merge': ([first, ...rest], scope) => {
    let out = clone(input(scope, first?.text ?? '').j);
    for (const x of rest) if (x.text !== '') out = merge(out, input(scope, x.text).j);
    checkSize(out);
    return pretty(out, sessionOf(scope).format);
  },
  'json.sort': ([j], scope) => pretty(sortJson(input(scope, j?.text ?? '').j), sessionOf(scope).format),
};
