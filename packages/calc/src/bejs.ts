// BE_EvaluateJavaScript without running JavaScript. Solutions built on Todd
// Geist's json custom functions (jsonModify, jsonPrettyPrint, ...) hand the
// BaseElements plug-in small fixed programs: a few `var name = value ;` lines
// built from FileMaker text, a blank line, then the program body. The bodies
// those functions use are recognised here and computed natively; the values are
// read as JSON data, never evaluated. Anything else is not run.

/** The result BaseElements would give, or undefined for a program that isn't recognised. */
export function knownJavaScript(js: string): string | undefined {
  const parsed = header(js);
  if (!parsed) return undefined;
  const { vars, body } = parsed;
  const program = PROGRAMS.find((p) => p.match.every((m) => body.includes(m)));
  if (!program) return undefined;
  try {
    const values: Record<string, unknown> = Object.create(null);
    for (const [name, raw] of Object.entries(vars)) values[name] = raw.quoted ? raw.text : JSON.parse(raw.text, (_key, value) =>
      isObject(value) && !Array.isArray(value) ? Object.assign(Object.create(null), value) : value);
    return program.run(values);
  } catch (e) {
    // What the script engine reports for bad JSON; the custom functions look for the error's name.
    return `${e instanceof SyntaxError ? 'SyntaxError' : 'TypeError'}: ${(e as Error).message}`;
  }
}

interface Raw { text: string; quoted: boolean }

/** The `var name = value ;` lines before the body. Quoted values are FileMaker Quote ( ) text. */
function header(js: string): { vars: Record<string, Raw>; body: string } | undefined {
  const vars: Record<string, Raw> = Object.create(null);
  let at = 0;
  const re = /\s*var ([A-Za-z_$][\w$]*) = /y;
  const blank = /[ \t]*[\r\n][ \t]*[\r\n]/y; // the empty line (¶¶) that ends the header
  for (;;) {
    blank.lastIndex = at;
    if (blank.test(js)) break;
    re.lastIndex = at;
    const m = re.exec(js);
    if (!m) break;
    at = re.lastIndex;
    let raw: Raw;
    if (js[at] === '"') {
      // Quote ( ) escapes " and \ with a backslash and nothing else.
      let s = '';
      let i = at + 1;
      for (; i < js.length && js[i] !== '"'; i++) s += js[i] === '\\' && i + 1 < js.length ? js[++i] : js[i];
      if (i >= js.length) return undefined;
      raw = { text: s, quoted: true };
      at = i + 1;
    } else {
      const end = valueEnd(js, at);
      if (end < 0) return undefined;
      raw = { text: js.slice(at, end), quoted: false };
      at = end;
    }
    const semi = /\s*;/y;
    semi.lastIndex = at;
    if (!semi.exec(js)) return undefined;
    at = semi.lastIndex;
    vars[m[1]] = raw;
  }
  if (!Object.keys(vars).length) return undefined;
  return { vars, body: js.slice(at) };
}

/** Where a JSON value starting at `at` ends: brackets balanced, strings skipped, up to the next ` ;`. */
function valueEnd(js: string, at: number): number {
  let depth = 0;
  for (let i = at; i < js.length; i++) {
    const c = js[i];
    if (c === '"') {
      for (i++; i < js.length && js[i] !== '"'; i++) if (js[i] === '\\') i++;
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return /\s/.test(js[i - 1]) ? i - 1 : i;
  }
  return -1;
}

const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object';
// An array index past this is refused, as json.ts does: JSON.stringify walks every hole of a sparse array, so one
// index of a hundred million holds the server's thread for seconds and builds a text of hundreds of megabytes.
const MAX_ARRAY_INDEX = 1_000_000;
const setData = (target: object, key: string | number, value: unknown): void => {
  if (Array.isArray(target)) {
    const n = /^\d+$/.test(String(key)) ? Number(key) : 0;
    if (n > MAX_ARRAY_INDEX) throw new RangeError(`Array index ${n.toLocaleString('en-US')} is past the ${MAX_ARRAY_INDEX.toLocaleString('en-US')} Tabularius allows`);
  }
  Object.defineProperty(target, key, Array.isArray(target) && key === 'length'
    ? { value } : { value, writable: true, enumerable: true, configurable: true });
};
const keysOf = (x: unknown): string[] => {
  if (!isObject(x)) throw new TypeError('Object.keys called on non-object');
  return Object.keys(x);
};

const PROGRAMS: { match: string[]; run: (v: Record<string, unknown>) => string }[] = [
  {
    // jsonPrettyPrint ( json ; whiteSpace )
    match: ['JSON.stringify(json, null , whiteSpace)'],
    run: (v) => JSON.stringify(v.json, null, v.whiteSpace === '' ? '  ' : String(v.whiteSpace)),
  },
  {
    // jsonGetValueList ( json ): values one per line, objects and arrays as JSON
    match: ['var keys = Object.keys(json);', 'outArray.push(value)'],
    run: (v) => keysOf(v.json).map((k) => {
      const x = (v.json as Record<string, unknown>)[k];
      return isObject(x) ? JSON.stringify(x) : x === null || x === undefined ? '' : String(x);
    }).join('\r'),
  },
  {
    // jsonGetKeyList ( json )
    match: ['var keys = Object.keys(json);', 'keys.join('],
    run: (v) => keysOf(v.json).join('\r'),
  },
  {
    // jsonDelete ( json ; keyOrIndex )
    match: ['json.splice(keyOrIndex,1)', 'delete json[keyOrIndex]'],
    run: (v) => {
      const json = v.json;
      if (Array.isArray(json)) {
        const i = parseInt(String(v.keyOrIndex), 10);
        if (!Number.isNaN(i)) json.splice(i, 1);
      } else if (isObject(json)) delete json[String(v.keyOrIndex)];
      else throw new TypeError('Cannot delete property of a non-object');
      return JSON.stringify(json);
    },
  },
  {
    // jsonMerge ( target ; source ): source's keys copied onto target
    match: ['Object.assign(target, source)'],
    run: (v) => {
      if (v.target === null || v.target === undefined) throw new TypeError('Cannot convert first argument to object');
      const to = v.target as Record<string, unknown>;
      if (isObject(v.source)) for (const k of Object.keys(v.source)) if (v.source[k] !== undefined) setData(to, k, v.source[k]);
      return JSON.stringify(to);
    },
  },
  {
    // jsonModify ( json ; keyOrIndexOrPath ; newValue )
    match: ['var r = modify(json, keyOrIndexOrPath, newValue);'],
    run: (v) => JSON.stringify(modify(v.json, String(v.keyOrIndexOrPath), v.newValue)),
  },
];

/**
 * jsonModify's modify(): walks a path like a.b[2].c, replacing any step that is
 * missing or of the wrong kind with {} or [] (falsy values count as missing),
 * then sets the value. An array at the top is wrapped as { theArray } first.
 */
function modify(json: unknown, path: string, value: unknown): unknown {
  let obj: Record<string, unknown>;
  if (Array.isArray(json)) {
    obj = Object.create(null);
    setData(obj, 'theArray', json);
    path = 'theArray' + path;
  } else if (isObject(json)) obj = json;
  else throw new TypeError('Cannot set property of a non-object');
  const segments: string[] = [];
  for (const prop of path.replace('][', '].[').split('.')) {
    if (prop.indexOf(']') > 0) {
      const [name, rest] = prop.split('[');
      segments.push(name, '[' + rest);
    } else segments.push(prop);
  }
  const index = (s: string) => {
    const inner = s.slice(1, s.indexOf(']')).trim();
    return /^\d+$/.test(inner) ? Number(inner) : inner.replace(/^["']|["']$/g, '');
  };
  // An empty segment ("a..b", or before a leading "[n]") names the same place again.
  const steps = segments.filter((x) => x !== '');
  if (!steps.length) return value;
  let parent: Record<string | number, unknown> = obj;
  for (const [i, segment] of steps.entries()) {
    const next = steps[i + 1];
    const kind = next === undefined ? '' : next.startsWith('[') ? 'array' : 'object';
    const key = segment.startsWith('[') ? index(segment) : segment;
    const current = Object.hasOwn(parent, key) ? parent[key] : undefined;
    const fresh = kind === '' ? value : kind === 'array' ? [] : Object.create(null);
    if (!current) setData(parent, key, fresh);
    else if (Array.isArray(current) && kind !== 'array') setData(parent, key, fresh);
    else if (typeof current !== kind && !Array.isArray(current)) setData(parent, key, fresh);
    if (next !== undefined) parent = parent[key] as Record<string | number, unknown>;
  }
  return Array.isArray(obj.theArray) && Array.isArray(json) ? obj.theArray : obj;
}
