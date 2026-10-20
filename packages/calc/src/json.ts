// FileMaker's JSON functions. FileMaker writes objects with their keys in
// sorted order and without spaces, and reports bad input as text starting
// with "?".

import { asNumber, asText, CalcError, ERR, num, text, type Value } from './values.ts';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export const JSON_TYPES = { JSONRaw: 0, JSONString: 1, JSONNumber: 2, JSONObject: 3, JSONArray: 4, JSONBoolean: 5, JSONNull: 6 } as const;

class JsonError extends Error {}

// A script building JSON a key at a time ($json = JSONSetElement ( $json ; ... ) in a loop) hands back the text
// it was just given, so recent texts keep their parsed trees, and every object or array keeps the text it was
// written as. Nothing changes a tree in place (setting or deleting copies the path it changes), so sharing them
// is safe, and the parts a change leaves alone are not written out again.
const PARSED_MAX = 64;
/** Texts this long are not kept, and all kept texts together stay under PARSED_CHARS. */
const PARSED_TEXT_MAX = 256 * 1024;
const PARSED_CHARS = 4 * 1024 * 1024;
const parsed = new Map<string, Json>();
let parsedChars = 0;
const written = new WeakMap<object, string>();

function remember(s: string, v: Json): void {
  if (s.length > PARSED_TEXT_MAX || parsed.has(s)) return;
  while (parsed.size && (parsed.size >= PARSED_MAX || parsedChars + s.length > PARSED_CHARS)) {
    const oldest = parsed.keys().next().value!;
    parsed.delete(oldest);
    parsedChars -= oldest.length;
  }
  parsed.set(s, v);
  parsedChars += s.length;
}

function parseJson(s: string): Json {
  const known = parsed.get(s);
  if (known !== undefined) {
    // The most recently used last, so the oldest goes first.
    parsed.delete(s);
    parsed.set(s, known);
    return known;
  }
  if (s.trim() === '') return {};
  let v: Json;
  try {
    v = JSON.parse(s) as Json;
  } catch (e) {
    throw new JsonError((e as Error).message);
  }
  if (s.length >= 64) remember(s, v);
  return v;
}

/** Compact JSON with object keys sorted, the way FileMaker writes it. */
export function stringify(v: Json): string {
  if (v === null || typeof v !== 'object') return typeof v === 'number' ? formatJsonNumber(v) : JSON.stringify(v);
  let s = written.get(v);
  if (s === undefined) {
    // One pass writes the text and notes a number written other than it is held.
    let lossy = false;
    const one = (x: Json): string => {
      if (typeof x === 'number') {
        const t = formatJsonNumber(x);
        if (t !== String(x) || Object.is(x, -0)) lossy = true;
        return t;
      }
      const t = stringify(x);
      if (x !== null && typeof x === 'object' && rounded.has(x)) lossy = true;
      return t;
    };
    if (Array.isArray(v)) s = `[${v.map(one).join(',')}]`;
    else {
      const keys = Object.keys(v).sort();
      const out = new Array<string>(keys.length);
      for (let i = 0; i < keys.length; i++) out[i] = `${JSON.stringify(keys[i])}:${one(v[keys[i]])}`;
      s = `{${out.join(',')}}`;
    }
    written.set(v, s);
    if (lossy) rounded.add(v);
  }
  return s;
}

/** Trees with a number written differently from how it is held (0.1 + 0.2 written as 0.3, infinity as null). */
const rounded = new WeakSet<object>();

/** A tree's text, kept with the tree for the next function given that text, unless reading the text back would give other numbers. */
function writtenText(v: Json): Value {
  const s = stringify(v);
  if (s.length >= 64 && !(v !== null && typeof v === 'object' && rounded.has(v))) remember(s, v);
  return text(s);
}

function formatJsonNumber(n: number): string {
  if (!Number.isFinite(n)) return 'null';
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(16)));
}

function pretty(v: Json, indent = ''): string {
  if (v === null || typeof v !== 'object') return stringify(v);
  const inner = indent + '\t';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return `[\r${v.map((x) => inner + pretty(x, inner)).join(',\r')}\r${indent}]`;
  }
  const keys = Object.keys(v).sort();
  if (!keys.length) return '{}';
  return `{\r${keys.map((k) => `${inner}${JSON.stringify(k)} : ${pretty(v[k], inner)}`).join(',\r')}\r${indent}}`;
}

type PathPart = { key: string } | { index: number } | { append: true } | { last: true };

/** "a.b[2].c", "[+]" appends, "[:]" is the last element; keys can be quoted with [""]. */
function parsePath(path: string): PathPart[] {
  const parts: PathPart[] = [];
  let i = 0;
  let key = '';
  const flush = () => {
    if (key !== '') parts.push({ key });
    key = '';
  };
  while (i < path.length) {
    const c = path[i];
    if (c === '.') {
      flush();
      i++;
    } else if (c === '[') {
      flush();
      // A quoted key can hold dots and brackets: ['product.name'] or ["a]b"].
      const quote = path[i + 1] === "'" || path[i + 1] === '"' ? path[i + 1] : '';
      let end = path.indexOf(']', i);
      if (quote) {
        const close = path.indexOf(quote, i + 2);
        if (close >= 0 && path[close + 1] === ']') end = close + 1;
      }
      if (end < 0) throw new JsonError(`Bad path ${path}`);
      const inside = path.slice(i + 1, end).trim();
      if (inside === '+') parts.push({ append: true });
      else if (inside === ':') parts.push({ last: true });
      else if (/^-?\d+$/.test(inside)) parts.push({ index: Number(inside) });
      else parts.push({ key: inside.replace(/^(["'])(.*)\1$/, '$2') });
      i = end + 1;
    } else {
      key += c;
      i++;
    }
  }
  flush();
  return parts;
}

function keyParts(v: Value): PathPart[] {
  return v.type === 'number' ? [{ index: v.value }] : parsePath(asText(v));
}

function step(node: Json, p: PathPart): Json | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    if ('index' in p) return node[p.index];
    if ('last' in p) return node[node.length - 1];
    if ('key' in p && /^\d+$/.test(p.key)) return node[Number(p.key)];
    return undefined;
  }
  // Own keys only: "toString" or "__proto__" in a path is a key, never something every object has.
  if ('key' in p) return Object.hasOwn(node, p.key) ? node[p.key] : undefined;
  if ('index' in p) return Object.hasOwn(node, String(p.index)) ? node[String(p.index)] : undefined;
  return undefined;
}

/** Text of a JSON element as JSONGetElement returns it: strings unquoted, containers as JSON. */
function elementText(v: Json | undefined): Value {
  if (v === undefined || v === null) return text('');
  if (typeof v === 'string') return text(v);
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return text(v ? 'true' : 'false');
  return text(stringify(v));
}

function guarded(fn: () => Value): Value {
  try {
    return fn();
  } catch (e) {
    if (e instanceof JsonError) return text(`? ${e.message}`);
    throw e;
  }
}

export function jsonGetElement(json: string, key: Value): Value {
  return guarded(() => {
    let node: Json | undefined = parseJson(json);
    for (const p of keyParts(key)) node = node === undefined ? undefined : step(node, p);
    // Claris returns a JSON boolean as 1 or 0 (its page: JSONGetElement ( "[ true, false, true ]" ; 1 ) is 0).
    return typeof node === 'boolean' ? num(node ? 1 : 0) : elementText(node);
  });
}

function typed(value: Value, type: number): Json {
  switch (type) {
    case 1: return asText(value);
    case 2: return asNumber(value);
    case 3: case 4: {
      const t = asText(value);
      const parsed = t.trim() === '' ? (type === 3 ? {} : []) : parseJson(t);
      return parsed;
    }
    case 5: return asNumber(value) !== 0 || /^true$/i.test(asText(value));
    case 6: return null;
    default: {
      const t = asText(value);
      try {
        return JSON.parse(t) as Json;
      } catch {
        return t;
      }
    }
  }
}

/** A shallow copy (a key-by-key copy is about twice as fast as spreading an object with hundreds of keys). */
function copyObject(o: { [k: string]: Json }): { [k: string]: Json } {
  const out: { [k: string]: Json } = {};
  for (const k of Object.keys(o)) setKey(out, k, o[k]);
  return out;
}

/** Sets a key; "__proto__" is a key like any other in JSON, not the object's prototype. */
function setKey(o: { [k: string]: Json }, k: string, v: Json): void {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  else o[k] = v;
}

/** The furthest array position JSONSetElement will reach by padding with nulls. */
const MAX_ARRAY_INDEX = 1_000_000;

function setAt(root: Json, parts: PathPart[], value: Json): Json {
  if (!parts.length) return value;
  const [p, ...rest] = parts;
  const wantArray = 'index' in p || 'append' in p || 'last' in p;
  let node: Json = root;
  if (node === null || typeof node !== 'object') node = wantArray ? [] : {};
  if (Array.isArray(node)) {
    const arr = [...node];
    const i = 'index' in p ? p.index : 'append' in p ? arr.length : 'last' in p ? Math.max(0, arr.length - 1) : Number((p as { key: string }).key);
    if (!Number.isInteger(i) || i < 0) throw new JsonError('Bad array index');
    // A far index would fill the gap with millions of nulls (or never finish): FileMaker's own limit is not known, this is ours.
    if (i > MAX_ARRAY_INDEX) throw new JsonError(`Array index ${i.toLocaleString('en-US')} is past the ${MAX_ARRAY_INDEX.toLocaleString('en-US')} Tabularius allows`);
    while (arr.length < i) arr.push(null);
    arr[i] = setAt(arr[i] ?? null, rest, value);
    return arr;
  }
  const obj = copyObject(node);
  const k = 'key' in p ? p.key : 'index' in p ? String(p.index) : String(Object.keys(obj).length);
  setKey(obj, k, setAt(Object.hasOwn(obj, k) ? obj[k] : null, rest, value));
  return obj;
}

export function jsonSetElement(json: string, triples: [Value, Value, number][]): Value {
  return guarded(() => {
    let root = parseJson(json);
    for (const [key, value, type] of triples) root = setAt(root, keyParts(key), typed(value, type));
    return parsedValue(writtenText(root), root);
  });
}

// FileMaker 2025 (22.0) keeps a parsed copy with the JSON that JSONParse and JSONSetElement return, and
// JSONParsedState tells whether a value has one: 0 for text that was never parsed, -1 for text parsed and found
// invalid, else its JSON type. The copy goes with that value (a variable holding it, a Let name); any new text
// made from it, or a field it is stored in, is plain text again.
const parsedStates = new WeakMap<Value, number>();

function typeOf(v: Json): number {
  return v === null ? 6 : Array.isArray(v) ? 4 : typeof v === 'object' ? 3 : typeof v === 'string' ? 1 : typeof v === 'number' ? 2 : 5;
}

function parsedValue(v: Value, root: Json): Value {
  parsedStates.set(v, typeOf(root));
  return v;
}

/**
 * JSONParse: the text unchanged when it is a JSON object or array, else "?" and why. Claris's examples count an
 * empty text and a bare number (JSONParse ( Pi )) as invalid.
 */
export function jsonParse(json: string): Value {
  let root: Json;
  try {
    if (json.trim() === '') throw new JsonError('The document is empty');
    root = parseJson(json);
    if (root === null || typeof root !== 'object') throw new JsonError('A JSON object or array is expected');
  } catch (e) {
    if (!(e instanceof JsonError)) throw e;
    const invalid = text(`? ${e.message}`);
    parsedStates.set(invalid, -1);
    return invalid;
  }
  return parsedValue(text(json), root);
}

export function jsonParsedState(v: Value): number {
  return parsedStates.get(v) ?? 0;
}

function deleteAt(root: Json, parts: PathPart[]): Json {
  if (!parts.length || root === null || typeof root !== 'object') return root;
  const [p, ...rest] = parts;
  if (Array.isArray(root)) {
    const i = 'index' in p ? p.index : 'last' in p ? root.length - 1 : -1;
    if (i < 0 || i >= root.length) return root;
    const arr = [...root];
    if (rest.length) arr[i] = deleteAt(arr[i], rest);
    else arr.splice(i, 1);
    return arr;
  }
  if (!('key' in p) || !Object.hasOwn(root, p.key)) return root;
  const obj = copyObject(root);
  if (rest.length) setKey(obj, p.key, deleteAt(obj[p.key], rest));
  else delete obj[p.key];
  return obj;
}

export function jsonDeleteElement(json: string, key: Value): Value {
  return guarded(() => writtenText(deleteAt(parseJson(json), keyParts(key))));
}

function at(json: string, key: Value): Json | undefined {
  let node: Json | undefined = parseJson(json);
  for (const p of keyParts(key)) node = node === undefined ? undefined : step(node, p);
  return node;
}

export function jsonListKeys(json: string, key: Value): Value {
  return guarded(() => {
    const node = at(json, key);
    if (Array.isArray(node)) return text(node.map((_, i) => String(i)).join('\r'));
    if (node && typeof node === 'object') return text(Object.keys(node).sort().join('\r'));
    throw new JsonError('Not an object or array');
  });
}

export function jsonListValues(json: string, key: Value): Value {
  return guarded(() => {
    const node = at(json, key);
    const list = Array.isArray(node) ? node : node && typeof node === 'object' ? Object.keys(node).sort().map((k) => node[k]) : undefined;
    if (!list) throw new JsonError('Not an object or array');
    // A JSON true or false is listed as 1 or 0, as JSONGetElement returns it.
    return text(list.map((v) => (typeof v === 'boolean' ? (v ? '1' : '0') : asText(elementText(v)))).join('\r'));
  });
}

export function jsonGetElementType(json: string, key: Value): Value {
  return guarded(() => {
    const node = at(json, key);
    if (node === undefined) return text('');
    const t = node === null ? 6 : Array.isArray(node) ? 4 : typeof node === 'object' ? 3 : typeof node === 'string' ? 1 : typeof node === 'number' ? 2 : 5;
    return num(t);
  });
}

export function jsonFormatElements(json: string): Value {
  return guarded(() => text(pretty(parseJson(json))));
}

export function jsonMakeArray(list: string, separator: string, type: number): Value {
  if (separator === '') throw new CalcError(ERR.calculation, 'JSONMakeArray needs a separator');
  const items = list === '' ? [] : list.split(separator);
  return guarded(() => text(stringify(items.map((s) => typed(text(s), type)))));
}
