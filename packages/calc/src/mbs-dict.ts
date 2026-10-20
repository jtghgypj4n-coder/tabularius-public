import { checkTextSize, joinText, jsonStringSize } from './text-budget.ts';
import { ENTRY_BYTES, MAX_PLUGIN_VARIABLES, MAX_RETAINED_BYTES, RetainedMap, retainedBudget, stringBytes, valueBytes, type RetainedBudget } from './retained-budget.ts';

// MBS ( "Dictionary.…" ) and ( "Variable.…" ): MonkeyBread's key/value maps and plug-in variables, following MBS's
// own function pages (mbsplugins.eu). Values keep their type (text, number, date, time, timestamp, container), as MBS
// says. Where a page leaves something out the comment says what Tabularius does and that it's inferred:
// - Keys and names come back newest-sorted-first: MBS calls the order "random", but every example on its pages lists
//   them in descending order ("person.456…" before "person.123…", "other" before "Hello"), so Tabularius does that.
// - MBS's variables are shared by everyone on a server; Tabularius keeps them for the person's session (as $$
//   variables are), so one person's or AI client's values never reach another's.
// Not here: Dictionary.ToXML (no description of its elements), AddSQL…, SetVariables, ToMatrix and FM.CF. They
// give an "isn't available" MBS error.

import { MbsError } from './mbs-text.ts';
import { compact, parseJson, pretty, type Json } from './mbs-json.ts';
import { quickListItems } from './mbs-quicklist.ts';
import { asNumber, num, text, type Value } from './values.ts';

/** What a function is given: each parameter as itself and as FileMaker's text of it. */
export interface DictArgs { values: Value[]; texts: string[] }
type MbsDict = (a: DictArgs, scope: object) => Value;

/** `owner` is the session once the dictionary is kept, so its keys count toward the session's total; `sorted` caches its keys in order. */
interface Dict { map: Map<string, Value>; tag: Value; owner?: Session; sorted?: string[]; bytes: number }
interface Session { next: number; dicts: Map<string, Dict>; vars: RetainedMap<string, Value>; total: number; budget: RetainedBudget }
const sessions = new WeakMap<object, Session>();
const MAX_LIVE = 10_000;
const MAX_ENTRIES = 1_000_000;
// All of a session's dictionaries together, so a loop of large clones can't take the server's memory (Tabularius's own limit).
const MAX_TOTAL = 2_000_000;
// As for JSON, numbers start at a random large place so a reference isn't mistaken for a value (MBS doesn't say how
// it numbers dictionaries).
const sessionOf = (scope: object): Session => {
  let s = sessions.get(scope);
  if (!s) sessions.set(scope, (s = { next: 100_000_000 + Math.floor(Math.random() * 800_000_000), dicts: new Map(), vars: new RetainedMap(retainedBudget(scope), (k, v) => ENTRY_BYTES + stringBytes(k) + valueBytes(v), MAX_PLUGIN_VARIABLES), total: 0, budget: retainedBudget(scope) }));
  return s;
};
const fail = (msg: string): never => {
  throw new MbsError(msg);
};
const OK = text('OK');
const EMPTY = text('');

function keep(scope: object, d: Dict, name?: string): Value {
  const s = sessionOf(scope);
  const old = name === undefined ? undefined : s.dicts.get(name);
  if (!old && s.dicts.size >= MAX_LIVE) fail(`Too many dictionaries are open (${MAX_LIVE}); release them with Dictionary.Release`);
  if (s.total - (old?.map.size ?? 0) + d.map.size > MAX_TOTAL) fail(`The open dictionaries hold at most ${MAX_TOTAL} keys together; release some with Dictionary.Release`);
  let next = s.next;
  if (name === undefined) while (s.dicts.has(String(next))) next++;
  const ref = name ?? String(next);
  s.budget.replace(old ? old.bytes + ENTRY_BYTES + stringBytes(ref) : 0, d.bytes + ENTRY_BYTES + stringBytes(ref));
  if (old) { s.total -= old.map.size; old.owner = undefined; }
  s.dicts.set(ref, d);
  if (name === undefined) s.next = next + 1;
  d.owner = s;
  s.total += d.map.size;
  return name === undefined ? num(Number(ref)) : text(ref);
}
/** Takes a dictionary out of its session's total, when it's released or replaced. */
function forget(s: Session, d: Dict, ref: string): void {
  s.budget.replace(d.bytes + ENTRY_BYTES + stringBytes(ref), 0);
  s.total -= d.map.size;
  d.owner = undefined;
}
const dictOf = (scope: object, ref: string): Dict => sessionOf(scope).dicts.get(ref.trim()) ?? fail(`"${ref}" is not a dictionary reference`);
const entryBytes = (key: string, v: Value) => ENTRY_BYTES + stringBytes(key) + valueBytes(v);
function setMany(d: Dict, changes: Map<string, Value>): void {
  let bytes = d.bytes, count = d.map.size;
  for (const [key, v] of changes) {
    const old = d.map.get(key);
    bytes += entryBytes(key, v) - (old ? entryBytes(key, old) : 0);
    if (!old) count++;
  }
  if (count > MAX_ENTRIES) fail(`A dictionary holds at most ${MAX_ENTRIES} keys`);
  if (d.owner && d.owner.total - d.map.size + count > MAX_TOTAL) fail(`The open dictionaries hold at most ${MAX_TOTAL} keys together; release some with Dictionary.Release`);
  if (bytes > MAX_RETAINED_BYTES) throw new RangeError('The session retained memory limit would be exceeded');
  if (d.owner) {
    d.owner.budget.replace(d.bytes, bytes);
    d.owner.total += count - d.map.size;
  }
  if (count !== d.map.size) d.sorted = undefined;
  for (const [key, v] of changes) d.map.set(key, v);
  d.bytes = bytes;
}
const set = (d: Dict, key: string, v: Value) => setMany(d, new Map([[key, v]]));
function emptyDict(): Dict { return { map: new Map(), tag: EMPTY, bytes: valueBytes(EMPTY) }; }
const descending = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
const keysOf = (m: Map<string, unknown>) => [...m.keys()].sort(descending);
/** A dictionary's keys in order, sorted once until they change (KeyAtIndex is called in loops). */
const keysOfDict = (d: Dict): string[] => (d.sorted ??= keysOf(d.map));
const lines = (s: string) => s.split(/\r\n|\r|\n/).filter((x) => x !== '');
const copy = (v: Value): Value => ({ ...v });

/** Key and value pairs from the parameters at `from`; a later key wins (inferred). */
function pairs(d: Dict, { values, texts }: DictArgs, from: number): void {
  if ((values.length - from) % 2) fail('Pass the keys and values in pairs');
  const changes = new Map<string, Value>();
  for (let i = from; i < values.length; i += 2) changes.set(texts[i], copy(values[i + 1]));
  setMany(d, changes);
}

// --- types and conversions -----------------------------------------------------------------------

const TYPE_NAMES: Record<Value['type'], string> = { text: 'Text', number: 'Number', date: 'Date', time: 'Time', timestamp: 'TimeStamp', container: 'Container' };

/** Dictionary.FromJSON: numbers and text as they are, booleans as 1 and 0, null as empty text, objects and arrays as their JSON. */
function fromJson(j: Json): Value {
  switch (j.t) {
    case 'num': return num(Number(j.raw));
    case 'str': return text(j.v);
    case 'bool': return num(j.v ? 1 : 0);
    case 'null': return EMPTY;
    default: return text(compact(j));
  }
}
/** A value in Dictionary.ToJSON: numbers as numbers, everything else as its text (inferred for dates, times and containers). */
const toJson = (v: Value, t: string): Extract<Json, { t: 'num' | 'str' }> => (v.type === 'number' && Number.isFinite(v.value) ? { t: 'num', raw: t } : { t: 'str', v: t });

// Serialize: MBS's own layout isn't described, so Tabularius's is its own, readable only by its Deserialize.
const MAGIC = 'openhbam-dictionary-1';
function serialize(d: Dict): string {
  // Count UTF-8 JSON bytes, including nested container base64, before allocating either encoding.
  let bytes = jsonStringSize(MAGIC, 'utf8') + 5 + Math.max(0, d.map.size - 1);
  checkTextSize(Math.ceil(bytes / 3) * 4);
  for (const [k, v] of d.map) {
    bytes += 5 + jsonStringSize(k, 'utf8') + jsonStringSize(v.type, 'utf8')
      + (typeof v.value === 'string' ? jsonStringSize(v.value, 'utf8') : JSON.stringify(v.value).length)
      + (v.type === 'container' && v.data ? 2 + Math.ceil(v.data.byteLength / 3) * 4 : 4);
    checkTextSize(Math.ceil(bytes / 3) * 4);
  }
  const entries = [...d.map].map(([k, v]) => [k, v.type, v.value, v.type === 'container' && v.data ? Buffer.from(v.data).toString('base64') : null]);
  return Buffer.from(JSON.stringify([MAGIC, entries])).toString('base64');
}
// Dates are day numbers and times and timestamps seconds, within FileMaker's 1/1/0001 to 12/31/4000.
const LAST_DAY = 1_460_970;
const inRange = (type: Value['type'], v: number) =>
  Number.isFinite(v) && (type === 'number' || (type === 'date' ? Number.isInteger(v) && v >= 1 && v <= LAST_DAY : Math.abs(v) <= LAST_DAY * 86_400));
function deserialize(s: string): Dict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(s.trim(), 'base64').toString('utf8'));
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed) || parsed[0] !== MAGIC || !Array.isArray(parsed[1])) fail('This is not a dictionary from Dictionary.Serialize');
  const d = emptyDict();
  for (const e of (parsed as [string, unknown[]])[1] as unknown[]) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || !Object.hasOwn(TYPE_NAMES, String(e[1]))) fail('This is not a dictionary from Dictionary.Serialize');
    const [key, type, value, data] = e as [string, Value['type'], unknown, unknown];
    if (type === 'text' || type === 'container') {
      if (typeof value !== 'string') fail('This is not a dictionary from Dictionary.Serialize');
      set(d, key, type === 'text' ? text(value as string) : { type, value: value as string, ...(typeof data === 'string' ? { data: new Uint8Array(Buffer.from(data, 'base64')) } : {}) });
    } else {
      if (typeof value !== 'number' || !inRange(type, value)) fail('This is not a dictionary from Dictionary.Serialize');
      set(d, key, { type, value: value as number });
    }
  }
  return d;
}

const listOf = (a: string[]) => text(joinText(a, '\r'));

export const MBS_DICT: Record<string, MbsDict> = {
  'dictionary.create': (a, scope) => {
    const d = emptyDict();
    pairs(d, a, 0);
    return keep(scope, d);
  },
  // A name already in use gets a new, empty dictionary (inferred).
  'dictionary.createnamed': (a, scope) => {
    const name = (a.texts[0] ?? '').trim();
    if (!name) fail('Pass a name for the dictionary');
    const d = emptyDict();
    pairs(d, a, 1);
    return keep(scope, d, name);
  },
  // Keys in both take the other dictionary's value (inferred, as SetValueForKey replaces).
  'dictionary.adddictionary': ({ texts: [ref = '', other = ''] }, scope) => {
    const d = dictOf(scope, ref);
    setMany(d, new Map([...dictOf(scope, other).map].map(([k, v]) => [k, copy(v)])));
    return OK;
  },
  'dictionary.clear': ({ texts: [ref = ''] }, scope) => {
    const d = dictOf(scope, ref);
    if (d.owner) { d.owner.budget.replace(d.bytes, valueBytes(d.tag)); d.owner.total -= d.map.size; }
    d.bytes = valueBytes(d.tag);
    d.map.clear();
    d.sorted = undefined;
    return OK;
  },
  'dictionary.clone': ({ texts: [ref = ''] }, scope) => {
    const d = dictOf(scope, ref);
    return keep(scope, { map: new Map([...d.map].map(([k, v]) => [k, copy(v)])), tag: copy(d.tag), bytes: d.bytes });
  },
  'dictionary.count': ({ texts: [ref = ''] }, scope) => num(dictOf(scope, ref).map.size),
  'dictionary.serialize': ({ texts: [ref = ''] }, scope) => text(serialize(dictOf(scope, ref))),
  'dictionary.deserialize': ({ texts: [s = ''] }, scope) => keep(scope, deserialize(s)),
  'dictionary.fromjson': ({ texts: [json = ''] }, scope) => {
    let j: Json;
    try {
      j = parseJson(json);
    } catch (e) {
      throw new MbsError(`Failed to parse JSON: ${(e as Error).message}`);
    }
    if (j.t !== 'obj') fail('Dictionary.FromJSON needs a JSON object');
    const d = emptyDict();
    for (const [k, v] of (j as Extract<Json, { t: 'obj' }>).entries) set(d, k, fromJson(v));
    return keep(scope, d);
  },
  'dictionary.tojson': ({ texts: [ref = ''] }, scope) => {
    const d = dictOf(scope, ref);
    // The default pretty writer adds braces/newlines, comma/newline separators and tab/colon/space per entry.
    let size = d.map.size ? 4 + (d.map.size - 1) * 2 : 2;
    checkTextSize(size);
    const entries: [string, Json][] = keysOfDict(d).map((k) => {
      const v = d.map.get(k)!;
      const j = toJson(v, v.type === 'number' ? String(Number(v.value.toPrecision(16))) : String(valueText(v)));
      size += 3 + jsonStringSize(k, 'utf16', false) + (j.t === 'num' ? j.raw.length : jsonStringSize(j.v, 'utf16', false));
      checkTextSize(size);
      return [k, j];
    });
    return text(pretty({ t: 'obj', entries }));
  },
  'dictionary.gettag': ({ texts: [ref = ''] }, scope) => copy(dictOf(scope, ref).tag),
  'dictionary.settag': ({ values, texts: [ref = ''] }, scope) => {
    const d = dictOf(scope, ref);
    const tag = copy(values[1] ?? EMPTY);
    const bytes = d.bytes - valueBytes(d.tag) + valueBytes(tag);
    if (d.owner) d.owner.budget.replace(d.bytes, bytes);
    d.tag = tag;
    d.bytes = bytes;
    return OK;
  },
  'dictionary.haskey': ({ texts: [ref = '', key = ''] }, scope) => num(dictOf(scope, ref).map.has(key) ? 1 : 0),
  // The keys asked for that it has, in the order asked (inferred, as QuickList.HasValues).
  'dictionary.haskeys': ({ texts: [ref = '', keys = ''] }, scope) => {
    const d = dictOf(scope, ref);
    return listOf(lines(keys).filter((k) => d.map.has(k)));
  },
  'dictionary.keyatindex': ({ texts: [ref = '', index = ''] }, scope) => {
    const keys = keysOfDict(dictOf(scope, ref));
    const i = Number(index.trim());
    if (!Number.isInteger(i) || i < 0 || i >= keys.length) fail(`The index must be from 0 to ${keys.length - 1}`);
    return text(keys[i]);
  },
  'dictionary.keys': ({ texts: [ref = ''] }, scope) => listOf(keysOfDict(dictOf(scope, ref))),
  'dictionary.keyswithprefix': ({ texts: [ref = '', prefix = ''] }, scope) => listOf(keysOfDict(dictOf(scope, ref)).filter((k) => k.startsWith(prefix))),
  'dictionary.keyswithpostfix': ({ texts: [ref = '', postfix = ''] }, scope) => listOf(keysOfDict(dictOf(scope, ref)).filter((k) => k.endsWith(postfix))),
  'dictionary.list': (_, scope) => listOf([...sessionOf(scope).dicts.keys()]),
  'dictionary.lookup': ({ values, texts: [ref = '', key = ''] }, scope) => {
    const v = dictOf(scope, ref).map.get(key);
    return v ? copy(v) : copy(values[2] ?? EMPTY);
  },
  'dictionary.release': ({ texts: [ref = ''] }, scope) => {
    const s = sessionOf(scope);
    const d = s.dicts.get(ref.trim()) ?? fail(`"${ref}" is not a dictionary reference`);
    forget(s, d, ref.trim());
    s.dicts.delete(ref.trim());
    return OK;
  },
  'dictionary.releaseall': (_, scope) => {
    const s = sessionOf(scope);
    for (const [ref, d] of s.dicts) forget(s, d, ref);
    s.dicts.clear();
    s.total = 0;
    return OK;
  },
  // A key it doesn't have is no error (inferred).
  'dictionary.removekey': ({ texts: [ref = '', key = ''] }, scope) => {
    const d = dictOf(scope, ref);
    const old = d.map.get(key);
    if (old) {
      const bytes = entryBytes(key, old);
      if (d.owner) d.owner.budget.replace(bytes, 0);
      d.bytes -= bytes;
      d.map.delete(key);
      if (d.owner) d.owner.total--;
      d.sorted = undefined;
    }
    return OK;
  },
  'dictionary.setlist': ({ texts: [ref = '', list = '', delimiter] }, scope) => setLines(dictOf(scope, ref), lines(list), delimiter),
  'dictionary.setquicklist': ({ texts: [ref = '', list = '', delimiter] }, scope) => setLines(dictOf(scope, ref), quickListItems(scope, list), delimiter),
  'dictionary.setvalueforkey': ({ values, texts: [ref = '', key = ''] }, scope) => {
    set(dictOf(scope, ref), key, copy(values[2] ?? EMPTY));
    return OK;
  },
  // Rows in Keys order, no delimiter after the last (inferred).
  'dictionary.totext': ({ texts: [ref = '', column, row] }, scope) => {
    const d = dictOf(scope, ref);
    const col = column === undefined || column === '' ? '\t' : column;
    const sep = row === undefined || row === '' ? '\r' : row;
    return text(joinText(keysOfDict(d).map((k) => joinText([k, valueText(d.map.get(k)!)], col)), sep));
  },
  'dictionary.valueforkey': ({ texts: [ref = '', key = ''] }, scope) => copy(dictOf(scope, ref).map.get(key) ?? fail(`The dictionary has no key "${key}"`)),
  // A key it doesn't have is "Invalid" (inferred: the page lists Invalid among the answers).
  'dictionary.valuetypeforkey': ({ texts: [ref = '', key = ''] }, scope) => {
    const v = dictOf(scope, ref).map.get(key);
    return text(v ? TYPE_NAMES[v.type] : 'Invalid');
  },
  'dictionary.values': ({ texts: [ref = ''] }, scope) => {
    const d = dictOf(scope, ref);
    return listOf(keysOfDict(d).map((k) => valueText(d.map.get(k)!)));
  },

  // --- Variable.* --------------------------------------------------------------------------------
  'variable.set': ({ values, texts: [name = ''] }, scope) => {
    sessionOf(scope).vars.set(name, copy(values[1] ?? EMPTY));
    return OK;
  },
  'variable.get': ({ texts: [name = ''] }, scope) => copy(sessionOf(scope).vars.get(name) ?? fail('Variable not found.')),
  'variable.lookup': ({ values, texts: [name = ''] }, scope) => copy(sessionOf(scope).vars.get(name) ?? values[1] ?? EMPTY),
  'variable.exists': ({ texts: [name = ''] }, scope) => num(sessionOf(scope).vars.has(name) ? 1 : 0),
  'variable.add': ({ values, texts: [name = ''] }, scope) => {
    const vars = sessionOf(scope).vars;
    const old = vars.get(name);
    const v = num((old ? asNumber(old) : 0) + asNumber(values[1] ?? EMPTY));
    vars.set(name, v);
    return v;
  },
  'variable.append': ({ texts: [name = '', more = ''] }, scope) => {
    const vars = sessionOf(scope).vars;
    const v = text(joinText([valueText(vars.get(name) ?? EMPTY), more]));
    vars.set(name, v);
    return v;
  },
  // As a list value: a return goes between it and what's there (inferred: MBS's example gives "a¶b¶c").
  'variable.appendvalue': ({ texts: [name = '', more = ''] }, scope) => {
    const vars = sessionOf(scope).vars;
    const old = valueText(vars.get(name) ?? EMPTY);
    const v = text(joinText([old, more], old === '' || /[\r\n]$/.test(old) ? '' : '\r'));
    vars.set(name, v);
    return v;
  },
  'variable.popvalue': ({ texts: [name = ''] }, scope) => {
    const vars = sessionOf(scope).vars;
    const values = valueText(vars.get(name) ?? EMPTY).split(/\r\n|\r|\n/);
    while (values.length && values[values.length - 1] === '') values.pop();
    const last = values.pop() ?? '';
    if (vars.has(name)) vars.set(name, text(values.join('\r')));
    return text(last);
  },
  'variable.valuecount': ({ texts: [name = ''] }, scope) => num(lines(valueText(sessionOf(scope).vars.get(name) ?? EMPTY)).length),
  // A JSON array: the item goes on the end (an empty or missing variable starts one).
  'variable.appendjson': ({ texts: [name = '', json = ''] }, scope) => {
    const vars = sessionOf(scope).vars;
    const arr = jsonArray(valueText(vars.get(name) ?? EMPTY));
    arr.items.push(parseOrFail(json));
    const v = text(pretty(arr));
    vars.set(name, v);
    return v;
  },
  // The last item, taken off (inferred, as PopValue); "" for an empty array.
  'variable.popjson': ({ texts: [name = ''] }, scope) => {
    const vars = sessionOf(scope).vars;
    if (!vars.has(name)) return EMPTY;
    const arr = jsonArray(valueText(vars.get(name)!));
    const last = arr.items.pop();
    vars.set(name, text(pretty(arr)));
    return text(last ? (last.t === 'str' ? last.v : pretty(last)) : '');
  },
  'variable.clear': ({ texts: [name = ''] }, scope) => {
    sessionOf(scope).vars.delete(name);
    return OK;
  },
  'variable.clearall': (_, scope) => {
    sessionOf(scope).vars.clear();
    return OK;
  },
  'variable.reset': (_, scope) => {
    sessionOf(scope).vars.clear();
    return OK;
  },
  'variable.list': ({ texts: [delimiter] }, scope) => {
    const vars = sessionOf(scope).vars;
    const sep = delimiter === undefined || delimiter === '' ? '\t' : delimiter;
    return listOf(keysOf(vars).map((k) => k + sep + valueText(vars.get(k)!)));
  },
  'variable.names': (_, scope) => listOf(keysOf(sessionOf(scope).vars)),
};

/** key<delimiter>value lines (a tab by default), split at the first delimiter; a line without one is a key with an empty value (inferred). */
function setLines(d: Dict, items: readonly string[], delimiter: string | undefined): Value {
  const sep = delimiter === undefined || delimiter === '' ? '\t' : delimiter;
  const changes = new Map<string, Value>();
  for (const line of items) {
    const at = line.indexOf(sep);
    changes.set(at < 0 ? line : line.slice(0, at), text(at < 0 ? '' : line.slice(at + sep.length)));
  }
  setMany(d, changes);
  return OK;
}
function parseOrFail(json: string): Json {
  try {
    return parseJson(json);
  } catch (e) {
    throw new MbsError(`Failed to parse JSON: ${(e as Error).message}`);
  }
}
function jsonArray(s: string): Extract<Json, { t: 'arr' }> {
  if (s.trim() === '') return { t: 'arr', items: [] };
  const j = parseOrFail(s);
  if (j.t !== 'arr') fail('The variable holds JSON that is not an array');
  return j as Extract<Json, { t: 'arr' }>;
}

/** A stored value as text: FileMaker's own text of it, in the calculation's date format, which the caller gives for the call. */
let valueText: (v: Value) => string = (v) => String(v.value);
export function withValueText<T>(f: (v: Value) => string, run: () => T): T {
  const before = valueText;
  valueText = f;
  try {
    return run();
  } finally {
    valueText = before;
  }
}
