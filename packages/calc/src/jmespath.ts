// JMESPath (jmespath.org) for MBS ( "JSON.Search" ): the language of the specification, including all its built-in
// functions, run over the tree of mbs-json.ts. The parser is a Pratt parser with the binding powers of the spec's
// grammar; a result of null is JSON null. The expression comes from a formula, so work is capped (values looked at,
// time, nesting) and a deep structure is never walked without counting it. The JSON reading and writing are passed
// in, which keeps this file free of mbs-json.ts.

import { MbsError } from './mbs-text.ts';
import type { Json } from './mbs-json.ts';

export interface JsonIo {
  /** JSON text to a value (for `literals`). */
  parse(text: string): Json;
  /** A value as compact JSON text (to_string). */
  compact(j: Json): string;
}

const MAX_LENGTH = 4000;
const MAX_DEPTH = 256;
const MAX_STEPS = 2_000_000;
const MAX_MS = 3000;

const fail = (what: string): never => {
  throw new MbsError(`JMESPath: ${what}`);
};

// --- reading the expression --------------------------------------------------------------------

type TokenType =
  | 'unquoted' | 'quoted' | 'literal' | 'number' | 'dot' | 'star' | 'lbracket' | 'rbracket' | 'lbrace' | 'rbrace' | 'lparen' | 'rparen'
  | 'comma' | 'colon' | 'pipe' | 'or' | 'and' | 'not' | 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'flatten' | 'filter' | 'current' | 'expref' | 'eof';
interface Token { type: TokenType; value?: string | number | Json; at: number }

const POWER: Record<TokenType, number> = {
  eof: 0, unquoted: 0, quoted: 0, literal: 0, rbracket: 0, rparen: 0, comma: 0, rbrace: 0, number: 0, current: 0, expref: 0, colon: 0,
  pipe: 1, or: 2, and: 3, eq: 5, gt: 5, lt: 5, gte: 5, lte: 5, ne: 5, flatten: 9, star: 20, filter: 21, dot: 40, not: 45, lbrace: 50, lbracket: 55, lparen: 60,
};

function lex(src: string, io: JsonIo): Token[] {
  const out: Token[] = [];
  let i = 0;
  const upTo = (quote: string): string => {
    const start = i;
    i++;
    while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
    if (i >= src.length) fail(`a ${quote} is not closed (offset ${start})`);
    return src.slice(start + 1, i++);
  };
  while (i < src.length) {
    const c = src[i];
    const at = i;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
    else if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      out.push({ type: 'unquoted', value: src.slice(at, i), at });
    } else if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      i++;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
      const n = Number(src.slice(at, i));
      if (!Number.isSafeInteger(n)) fail('an index is too large');
      out.push({ type: 'number', value: n, at });
    } else if (c === '"') {
      let text: string;
      try {
        const v: unknown = JSON.parse('"' + upTo('"') + '"');
        text = String(v);
      } catch (e) {
        if (e instanceof MbsError) throw e;
        return fail(`a quoted name isn't valid at offset ${at}`);
      }
      out.push({ type: 'quoted', value: text, at });
    } else if (c === "'") out.push({ type: 'literal', value: { t: 'str', v: upTo("'").replace(/\\'/g, "'") } satisfies Json, at });
    else if (c === '`') {
      const text = upTo('`').replace(/\\`/g, '`');
      let v: Json;
      try {
        v = io.parse(text);
      } catch {
        try {
          // The older spelling: `foo` for the string "foo".
          v = io.parse(JSON.stringify(text.trim()));
        } catch {
          return fail(`a \`literal\` isn't valid JSON at offset ${at}`);
        }
      }
      out.push({ type: 'literal', value: v, at });
    } else {
      const two = src.slice(i, i + 2);
      const t2: Record<string, TokenType> = { '[?': 'filter', '[]': 'flatten', '||': 'or', '&&': 'and', '==': 'eq', '!=': 'ne', '<=': 'lte', '>=': 'gte' };
      const t1: Record<string, TokenType> = { '.': 'dot', '*': 'star', '[': 'lbracket', ']': 'rbracket', '{': 'lbrace', '}': 'rbrace', '(': 'lparen', ')': 'rparen', ',': 'comma', ':': 'colon', '|': 'pipe', '!': 'not', '<': 'lt', '>': 'gt', '@': 'current', '&': 'expref' };
      if (t2[two]) {
        out.push({ type: t2[two], at });
        i += 2;
      } else if (t1[c]) {
        out.push({ type: t1[c], at });
        i++;
      } else fail(`unexpected "${c}" at offset ${at}`);
    }
  }
  out.push({ type: 'eof', at: src.length });
  return out;
}

type Node = { d: number } & (
  | { k: 'id' }
  | { k: 'field'; name: string }
  | { k: 'lit'; v: Json }
  | { k: 'sub' | 'pipe' | 'or' | 'and'; a: Node; b: Node }
  | { k: 'not'; a: Node }
  | { k: 'cmp'; op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'; a: Node; b: Node }
  | { k: 'index'; i: number }
  | { k: 'slice'; start?: number; end?: number; step?: number }
  | { k: 'proj' | 'vproj'; a: Node; b: Node }
  | { k: 'flat'; a: Node }
  | { k: 'fproj'; a: Node; b: Node; cond: Node }
  | { k: 'mlist'; items: Node[] }
  | { k: 'mhash'; pairs: [string, Node][] }
  | { k: 'fn'; name: string; args: Node[] }
  | { k: 'ref'; e: Node }
);
type Shape<N> = N extends unknown ? Omit<N, 'd'> : never;

function parse(src: string, io: JsonIo): Node {
  if (src.length > MAX_LENGTH) fail('the expression is too long');
  const tokens = lex(src, io);
  let p = 0;
  const kind = (n = 0): TokenType => tokens[Math.min(p + n, tokens.length - 1)].type;
  const advance = () => void p++;
  const match = (t: TokenType) => {
    if (kind() !== t) return fail(`expected ${t} at offset ${tokens[p].at}`);
    advance();
  };
  const kids = (n: Shape<Node>): Node[] => {
    switch (n.k) {
      case 'sub': case 'pipe': case 'or': case 'and': case 'cmp': case 'proj': case 'vproj': return [n.a, n.b];
      case 'not': case 'flat': return [n.a];
      case 'fproj': return [n.a, n.b, n.cond];
      case 'mlist': return n.items;
      case 'mhash': return n.pairs.map(([, v]) => v);
      case 'fn': return n.args;
      case 'ref': return [n.e];
      default: return [];
    }
  };
  // Each node knows how deep it is, so the evaluator's recursion has a known bound.
  const mk = (n: Shape<Node>): Node => {
    let d = 1;
    for (const c of kids(n)) d = Math.max(d, c.d + 1);
    if (d > MAX_DEPTH) fail('the expression is nested too deeply');
    return { ...n, d } as Node;
  };
  const identity = mk({ k: 'id' });

  const expression = (power: number, depth: number): Node => {
    if (depth > MAX_DEPTH) fail('the expression is nested too deeply');
    const first = tokens[p];
    advance();
    let left = nud(first, depth);
    while (power < POWER[kind()]) {
      const t = tokens[p];
      advance();
      left = led(t, left, depth);
    }
    return left;
  };

  const projectionRhs = (power: number, depth: number): Node => {
    const t = kind();
    if (POWER[t] < 10) return identity;
    if (t === 'lbracket' || t === 'filter') return expression(power, depth + 1);
    if (t === 'dot') {
      advance();
      return dotRhs(power, depth + 1);
    }
    return fail(`unexpected ${t} at offset ${tokens[p].at}`);
  };
  const dotRhs = (power: number, depth: number): Node => {
    const t = kind();
    if (t === 'unquoted' || t === 'quoted' || t === 'star') return expression(power, depth + 1);
    if (t === 'lbracket') {
      advance();
      return multiList(depth + 1);
    }
    if (t === 'lbrace') {
      advance();
      return multiHash(depth + 1);
    }
    return fail(`unexpected ${t} after "." at offset ${tokens[p].at}`);
  };
  const multiList = (depth: number): Node => {
    const items: Node[] = [];
    for (;;) {
      items.push(expression(0, depth + 1));
      if (kind() === 'comma') advance();
      else {
        match('rbracket');
        return mk({ k: 'mlist', items });
      }
    }
  };
  const multiHash = (depth: number): Node => {
    const pairs: [string, Node][] = [];
    for (;;) {
      const key = tokens[p];
      if (key.type !== 'unquoted' && key.type !== 'quoted') return fail(`a name was expected at offset ${key.at}`);
      advance();
      match('colon');
      pairs.push([key.value as string, expression(0, depth + 1)]);
      if (kind() === 'comma') advance();
      else {
        match('rbrace');
        return mk({ k: 'mhash', pairs });
      }
    }
  };
  /** After "[" when a number or colon follows: an index or a slice. */
  const indexOrSlice = (): Node => {
    if (kind() === 'colon' || kind(1) === 'colon') {
      const parts: (number | undefined)[] = [undefined, undefined, undefined];
      let at = 0;
      while (kind() !== 'rbracket') {
        if (kind() === 'colon') {
          if (++at === 3) fail('a slice has at most three parts');
          advance();
        } else if (kind() === 'number') {
          parts[at] = tokens[p].value as number;
          advance();
          if (kind() !== 'colon' && kind() !== 'rbracket') fail(`unexpected ${kind()} in a slice at offset ${tokens[p].at}`);
        } else return fail(`unexpected ${kind()} in a slice at offset ${tokens[p].at}`);
      }
      match('rbracket');
      if (parts[2] === 0) fail('a slice step can\'t be 0');
      return mk({ k: 'slice', ...(parts[0] !== undefined ? { start: parts[0] } : {}), ...(parts[1] !== undefined ? { end: parts[1] } : {}), ...(parts[2] !== undefined ? { step: parts[2] } : {}) });
    }
    const n = tokens[p].value as number;
    advance();
    match('rbracket');
    return mk({ k: 'index', i: n });
  };

  const nud = (t: Token, depth: number): Node => {
    switch (t.type) {
      case 'literal': return mk({ k: 'lit', v: t.value as Json });
      case 'unquoted': return mk({ k: 'field', name: t.value as string });
      case 'quoted':
        if (kind() === 'lparen') return fail('a quoted name can\'t be a function');
        return mk({ k: 'field', name: t.value as string });
      case 'star': return mk({ k: 'vproj', a: identity, b: projectionRhs(POWER.star, depth + 1) });
      case 'filter': return filterLed(identity, depth);
      case 'lbrace': return multiHash(depth + 1);
      case 'flatten': return mk({ k: 'proj', a: mk({ k: 'flat', a: identity }), b: projectionRhs(POWER.flatten, depth + 1) });
      case 'lbracket':
        if (kind() === 'number' || kind() === 'colon') {
          const right = indexOrSlice();
          const index = mk({ k: 'sub', a: identity, b: right });
          return right.k === 'index' ? index : mk({ k: 'proj', a: index, b: projectionRhs(POWER.star, depth + 1) });
        }
        if (kind() === 'star' && kind(1) === 'rbracket') {
          advance();
          advance();
          return mk({ k: 'proj', a: identity, b: projectionRhs(POWER.star, depth + 1) });
        }
        return multiList(depth + 1);
      case 'current': return identity;
      case 'expref': return mk({ k: 'ref', e: expression(POWER.expref, depth + 1) });
      case 'not': return mk({ k: 'not', a: expression(POWER.not, depth + 1) });
      case 'lparen': {
        const e = expression(0, depth + 1);
        match('rparen');
        return e;
      }
      default: return fail(`unexpected ${t.type} at offset ${t.at}`);
    }
  };
  const filterLed = (left: Node, depth: number): Node => {
    const cond = expression(0, depth + 1);
    match('rbracket');
    return mk({ k: 'fproj', a: left, b: projectionRhs(POWER.filter, depth + 1), cond });
  };

  const led = (t: Token, left: Node, depth: number): Node => {
    switch (t.type) {
      case 'dot':
        if (kind() === 'star') {
          advance();
          return mk({ k: 'vproj', a: left, b: projectionRhs(POWER.star, depth + 1) });
        }
        return mk({ k: 'sub', a: left, b: dotRhs(POWER.dot, depth + 1) });
      case 'pipe': return mk({ k: 'pipe', a: left, b: expression(POWER.pipe, depth + 1) });
      case 'or': return mk({ k: 'or', a: left, b: expression(POWER.or, depth + 1) });
      case 'and': return mk({ k: 'and', a: left, b: expression(POWER.and, depth + 1) });
      case 'lparen': {
        if (left.k !== 'field') return fail(`only a name can be called, at offset ${t.at}`);
        const args: Node[] = [];
        if (kind() !== 'rparen') {
          for (;;) {
            args.push(expression(0, depth + 1));
            if (kind() === 'comma') advance();
            else break;
          }
        }
        match('rparen');
        return mk({ k: 'fn', name: left.name, args });
      }
      case 'filter': return filterLed(left, depth);
      case 'flatten': return mk({ k: 'proj', a: mk({ k: 'flat', a: left }), b: projectionRhs(POWER.flatten, depth + 1) });
      case 'eq': case 'ne': case 'lt': case 'lte': case 'gt': case 'gte':
        return mk({ k: 'cmp', op: t.type, a: left, b: expression(POWER[t.type], depth + 1) });
      case 'lbracket': {
        if (kind() === 'number' || kind() === 'colon') {
          const right = indexOrSlice();
          const index = mk({ k: 'sub', a: left, b: right });
          if (right.k === 'index') return index;
          return mk({ k: 'proj', a: index, b: projectionRhs(POWER.star, depth + 1) });
        }
        match('star');
        match('rbracket');
        return mk({ k: 'proj', a: left, b: projectionRhs(POWER.star, depth + 1) });
      }
      default: return fail(`unexpected ${t.type} at offset ${t.at}`);
    }
  };

  const tree = expression(0, 0);
  if (kind() !== 'eof') fail(`unexpected ${kind()} at offset ${tokens[p].at}`);
  return tree;
}

// --- running it --------------------------------------------------------------------------------

type Ref = { ref: Node };
type Value = Json | Ref;
const isRef = (v: Value): v is Ref => 'ref' in v;

const NULL: Json = { t: 'null' };
const num = (n: number): Json => {
  if (!Number.isFinite(n)) return fail('a number is out of range');
  return { t: 'num', raw: String(n) };
};
const truthy = (j: Json): boolean => !(j.t === 'null' || (j.t === 'bool' && !j.v) || (j.t === 'str' && j.v === '') || (j.t === 'arr' && !j.items.length) || (j.t === 'obj' && !j.entries.length));
const typeOf = (j: Json): string => (j.t === 'num' ? 'number' : j.t === 'str' ? 'string' : j.t === 'bool' ? 'boolean' : j.t === 'arr' ? 'array' : j.t === 'obj' ? 'object' : 'null');

/** How many steps a string costs to handle: one, and one more for every 64 characters. */
const text = (s: string): number => 1 + (s.length >> 6);
/** Longest string a function may build. */
const MAX_TEXT = 20_000_000;

/** Code point order, which is JMESPath's string order (UTF-16 order differs for characters outside the basic plane). */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a.length < b.length ? -1 : 1;
}
const codePoints = (s: string): number => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n++;
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
  }
  return n;
};

/** What a function parameter takes: type names, `array-number`/`array-string` for a list of one kind, `any`, or `expref`. */
type Param = string[];
interface Fn { params: Param[]; rest?: Param; run(this: Run, args: Value[]): Json }

class Run {
  steps = 0;
  private readonly stop = Date.now() + MAX_MS;
  private readonly io: JsonIo;
  constructor(io: JsonIo) {
    this.io = io;
  }

  /** Counts `n` more values looked at; all work in a search goes through here, so none outruns the limits. */
  tick(n = 1): void {
    const before = this.steps;
    this.steps += n;
    if (this.steps > MAX_STEPS) fail('the search is too large for this query');
    if (this.steps >> 12 !== before >> 12 && Date.now() > this.stop) fail('the search took too long');
  }

  equal(a: Json, b: Json): boolean {
    this.tick();
    if (a.t !== b.t) return false;
    switch (a.t) {
      case 'null': return true;
      case 'bool': return a.v === (b as typeof a).v;
      case 'num': return Number(a.raw) === Number((b as typeof a).raw);
      case 'str': this.tick(text(a.v)); return a.v === (b as typeof a).v;
      case 'arr': {
        const o = b as typeof a;
        return a.items.length === o.items.length && a.items.every((x, k) => this.equal(x, o.items[k]));
      }
      case 'obj': {
        const o = b as typeof a;
        if (a.entries.length !== o.entries.length) return false;
        this.tick(a.entries.length);
        const theirs = new Map(o.entries);
        return a.entries.every(([k, v]) => theirs.has(k) && this.equal(v, theirs.get(k)!));
      }
    }
  }

  eval(n: Node, v: Json): Json {
    this.tick();
    switch (n.k) {
      case 'id': return v;
      case 'field': {
        if (v.t !== 'obj') return NULL;
        this.tick(v.entries.length);
        return v.entries.find(([k]) => k === n.name)?.[1] ?? NULL;
      }
      case 'lit': return n.v;
      case 'sub': case 'pipe': return this.eval(n.b, this.eval(n.a, v));
      case 'or': {
        const l = this.eval(n.a, v);
        return truthy(l) ? l : this.eval(n.b, v);
      }
      case 'and': {
        const l = this.eval(n.a, v);
        return truthy(l) ? this.eval(n.b, v) : l;
      }
      case 'not': return { t: 'bool', v: !truthy(this.eval(n.a, v)) };
      case 'cmp': {
        const a = this.eval(n.a, v);
        const b = this.eval(n.b, v);
        if (n.op === 'eq') return { t: 'bool', v: this.equal(a, b) };
        if (n.op === 'ne') return { t: 'bool', v: !this.equal(a, b) };
        if (a.t !== 'num' || b.t !== 'num') return NULL;
        const x = Number(a.raw);
        const y = Number(b.raw);
        return { t: 'bool', v: n.op === 'lt' ? x < y : n.op === 'lte' ? x <= y : n.op === 'gt' ? x > y : x >= y };
      }
      case 'index': {
        if (v.t !== 'arr') return NULL;
        return v.items[n.i < 0 ? v.items.length + n.i : n.i] ?? NULL;
      }
      case 'slice': return v.t === 'arr' ? { t: 'arr', items: this.slice(v.items, n.start, n.end, n.step ?? 1) } : NULL;
      case 'proj': {
        const l = this.eval(n.a, v);
        if (l.t !== 'arr') return NULL;
        return { t: 'arr', items: this.each(l.items, n.b) };
      }
      case 'vproj': {
        const l = this.eval(n.a, v);
        if (l.t !== 'obj') return NULL;
        return { t: 'arr', items: this.each(l.entries.map(([, x]) => x), n.b) };
      }
      case 'flat': {
        const l = this.eval(n.a, v);
        if (l.t !== 'arr') return NULL;
        const items: Json[] = [];
        for (const x of l.items) {
          if (x.t === 'arr') {
            this.tick(x.items.length);
            items.push(...x.items);
          } else items.push(x);
        }
        return { t: 'arr', items };
      }
      case 'fproj': {
        const l = this.eval(n.a, v);
        if (l.t !== 'arr') return NULL;
        const items: Json[] = [];
        for (const x of l.items) {
          if (!truthy(this.eval(n.cond, x))) continue;
          const r = this.eval(n.b, x);
          if (r.t !== 'null') items.push(r);
        }
        return { t: 'arr', items };
      }
      case 'mlist': return v.t === 'null' ? NULL : { t: 'arr', items: n.items.map((e) => this.eval(e, v)) };
      case 'mhash': return v.t === 'null' ? NULL : { t: 'obj', entries: n.pairs.map(([k, e]): [string, Json] => [k, this.eval(e, v)]) };
      case 'fn': return this.call(n, v);
      case 'ref': return fail('an &expression can only be given to a function');
    }
  }

  private each(items: Json[], right: Node): Json[] {
    const out: Json[] = [];
    for (const x of items) {
      const r = this.eval(right, x);
      if (r.t !== 'null') out.push(r);
    }
    return out;
  }

  private slice(items: Json[], start: number | undefined, end: number | undefined, step: number): Json[] {
    const len = items.length;
    const out: Json[] = [];
    const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
    if (step > 0) {
      const from = start === undefined ? 0 : clamp(start < 0 ? len + start : start, 0, len);
      const to = end === undefined ? len : clamp(end < 0 ? len + end : end, 0, len);
      for (let k = from; k < to; k += step) out.push(items[k]);
    } else {
      const from = start === undefined ? len - 1 : clamp(start < 0 ? len + start : start, -1, len - 1);
      const to = end === undefined ? -1 : clamp(end < 0 ? len + end : end, -1, len - 1);
      for (let k = from; k > to; k += step) out.push(items[k]);
    }
    this.tick(out.length);
    return out;
  }

  private call(n: Node & { k: 'fn' }, v: Json): Json {
    const f = Object.hasOwn(FUNCTIONS, n.name) ? FUNCTIONS[n.name] : undefined;
    if (!f) return fail(`unknown function ${n.name}`);
    const args: Value[] = n.args.map((a) => (a.k === 'ref' ? { ref: a.e } : this.eval(a, v)));
    if (args.length < f.params.length || (!f.rest && args.length > f.params.length)) fail(`${n.name} was given the wrong number of parameters`);
    args.forEach((a, i) => {
      const want = f.params[i] ?? f.rest!;
      if (!this.fits(a, want)) fail(`${n.name}: parameter ${i + 1} is the wrong type`);
    });
    return f.run.call(this, args);
  }

  private fits(a: Value, want: Param): boolean {
    if (isRef(a)) return want.includes('expref');
    this.tick();
    return want.some((w) => {
      if (w === 'any') return true;
      if (w === 'array-number' || w === 'array-string') {
        const of = w === 'array-number' ? 'num' : 'str';
        if (a.t !== 'arr') return false;
        this.tick(a.items.length);
        return a.items.every((x) => x.t === of);
      }
      return typeOf(a) === w;
    });
  }

  /** The expression of an &expref evaluated on each item. */
  keys(items: Json[], ref: Ref, allowed: 'num' | 'str' | 'either'): Json[] {
    const out = items.map((x) => this.eval(ref.ref, x));
    for (const k of out) if (!(k.t === 'num' || k.t === 'str') || (allowed !== 'either' && k.t !== allowed)) fail('the expression must give numbers or strings');
    if (out.length && out.some((k) => k.t !== out[0].t)) fail('the expression must give all numbers or all strings');
    return out;
  }

  /** What comparing strings costs: the length of the longest, times the number of comparisons n log n, kept to a count. */
  textCost(items: Json[]): number {
    let longest = 0;
    for (const x of items) if (x.t === 'str' && x.v.length > longest) longest = x.v.length;
    return (longest >> 6) * Math.max(1, Math.ceil(Math.log2(items.length + 1))) * items.length;
  }

  /** The item whose &expression key is largest (sign 1) or smallest (-1); null for no items. */
  extreme(items: Json[], ref: Ref, sign: 1 | -1): Json {
    if (!items.length) return NULL;
    const keys = this.keys(items, ref, 'either');
    this.tick(items.length + this.textCost(keys));
    let best = 0;
    for (let i = 1; i < items.length; i++) {
      const x = keys[i];
      const y = keys[best];
      const c = x.t === 'num' ? Number(x.raw) - Number((y as Json & { t: 'num' }).raw) : compareText((x as Json & { t: 'str' }).v, (y as Json & { t: 'str' }).v);
      if (c * sign > 0) best = i;
    }
    return items[best];
  }

  /** The text of a value for to_string: counted first, so a value that shares parts with itself can't blow up. */
  text(j: Json): string {
    const stack: Json[] = [j];
    while (stack.length) {
      const x = stack.pop()!;
      this.tick();
      if (x.t === 'arr') stack.push(...x.items);
      else if (x.t === 'obj') for (const [, y] of x.entries) stack.push(y);
    }
    return this.io.compact(j);
  }
}

const N = ['number'], S = ['string'], A = ['array'], O = ['object'], ANY = ['any'], REF = ['expref'];
const asJson = (v: Value): Json => v as Json;
const bool = (v: boolean): Json => ({ t: 'bool', v });
const str = (v: string): Json => ({ t: 'str', v });
const nums = (a: Value): number[] => (asJson(a) as Json & { t: 'arr' }).items.map((x) => Number((x as Json & { t: 'num' }).raw));
const list = (a: Value): Json[] => (asJson(a) as Json & { t: 'arr' }).items;

const FUNCTIONS: Record<string, Fn> = {
  abs: { params: [N], run: ([a]) => num(Math.abs(Number((asJson(a) as Json & { t: 'num' }).raw))) },
  avg: { params: [['array-number']], run(this: Run, [a]) {
    const n = nums(a);
    this.tick(n.length);
    return n.length ? num(n.reduce((x, y) => x + y, 0) / n.length) : NULL;
  } },
  ceil: { params: [N], run: ([a]) => num(Math.ceil(Number((asJson(a) as Json & { t: 'num' }).raw))) },
  floor: { params: [N], run: ([a]) => num(Math.floor(Number((asJson(a) as Json & { t: 'num' }).raw))) },
  contains: { params: [['array', 'string'], ANY], run(this: Run, [s, x]) {
    const subject = asJson(s);
    const search = asJson(x);
    if (subject.t === 'str') {
      this.tick(text(subject.v));
      return bool(search.t === 'str' && subject.v.includes(search.v));
    }
    return bool((subject as Json & { t: 'arr' }).items.some((y) => this.equal(y, search)));
  } },
  ends_with: { params: [S, S], run(this: Run, [a, b]) { this.tick(text((asJson(a) as Json & { t: 'str' }).v)); return bool((asJson(a) as Json & { t: 'str' }).v.endsWith((asJson(b) as Json & { t: 'str' }).v)); } },
  starts_with: { params: [S, S], run(this: Run, [a, b]) { this.tick(text((asJson(a) as Json & { t: 'str' }).v)); return bool((asJson(a) as Json & { t: 'str' }).v.startsWith((asJson(b) as Json & { t: 'str' }).v)); } },
  join: { params: [S, ['array-string']], run(this: Run, [g, a]) {
    const items = list(a);
    const glue = (asJson(g) as Json & { t: 'str' }).v;
    let total = glue.length * Math.max(0, items.length - 1);
    for (const x of items) total += (x as Json & { t: 'str' }).v.length;
    if (total > MAX_TEXT) fail('the text would be too long');
    this.tick(items.length + (total >> 6));
    return str(items.map((x) => (x as Json & { t: 'str' }).v).join(glue));
  } },
  keys: { params: [O], run(this: Run, [a]) {
    const entries = (asJson(a) as Json & { t: 'obj' }).entries;
    this.tick(entries.length);
    return { t: 'arr', items: entries.map(([k]) => str(k)) };
  } },
  values: { params: [O], run(this: Run, [a]) {
    const entries = (asJson(a) as Json & { t: 'obj' }).entries;
    this.tick(entries.length);
    return { t: 'arr', items: entries.map(([, x]) => x) };
  } },
  length: { params: [['string', 'array', 'object']], run(this: Run, [a]) {
    const j = asJson(a);
    if (j.t === 'str') this.tick(text(j.v));
    return num(j.t === 'str' ? codePoints(j.v) : j.t === 'arr' ? j.items.length : (j as Json & { t: 'obj' }).entries.length);
  } },
  map: { params: [REF, A], run(this: Run, [r, a]) {
    return { t: 'arr', items: list(a).map((x) => this.eval((r as Ref).ref, x)) };
  } },
  max: { params: [['array-number', 'array-string']], run(this: Run, [a]) {
    const items = list(a);
    this.tick(items.length + this.textCost(items));
    if (!items.length) return NULL;
    if (items[0].t === 'num') return items.reduce((m, x) => (Number((x as Json & { t: 'num' }).raw) > Number((m as Json & { t: 'num' }).raw) ? x : m));
    return items.reduce((m, x) => (compareText((x as Json & { t: 'str' }).v, (m as Json & { t: 'str' }).v) > 0 ? x : m));
  } },
  min: { params: [['array-number', 'array-string']], run(this: Run, [a]) {
    const items = list(a);
    this.tick(items.length + this.textCost(items));
    if (!items.length) return NULL;
    if (items[0].t === 'num') return items.reduce((m, x) => (Number((x as Json & { t: 'num' }).raw) < Number((m as Json & { t: 'num' }).raw) ? x : m));
    return items.reduce((m, x) => (compareText((x as Json & { t: 'str' }).v, (m as Json & { t: 'str' }).v) < 0 ? x : m));
  } },
  max_by: { params: [A, REF], run(this: Run, [a, r]) { return this.extreme(list(a), r as Ref, 1); } },
  min_by: { params: [A, REF], run(this: Run, [a, r]) { return this.extreme(list(a), r as Ref, -1); } },
  merge: { params: [], rest: O, run(this: Run, args) {
    const merged = new Map<string, Json>();
    for (const a of args) {
      const entries = (asJson(a) as Json & { t: 'obj' }).entries;
      this.tick(entries.length);
      for (const [k, x] of entries) merged.set(k, x);
    }
    return { t: 'obj', entries: [...merged] };
  } },
  not_null: { params: [ANY], rest: ANY, run: (args) => args.map(asJson).find((x) => x.t !== 'null') ?? NULL },
  reverse: { params: [['array', 'string']], run(this: Run, [a]) {
    const j = asJson(a);
    this.tick(j.t === 'str' ? text(j.v) : j.t === 'arr' ? j.items.length : 1);
    return j.t === 'str' ? str([...j.v].reverse().join('')) : { t: 'arr', items: [...(j as Json & { t: 'arr' }).items].reverse() };
  } },
  sort: { params: [['array-number', 'array-string']], run(this: Run, [a]) {
    const items = [...list(a)];
    this.tick(items.length * Math.max(1, Math.ceil(Math.log2(items.length + 1))) + this.textCost(items));
    items.sort((x, y) => (x.t === 'num' ? Number(x.raw) - Number((y as Json & { t: 'num' }).raw) : compareText((x as Json & { t: 'str' }).v, (y as Json & { t: 'str' }).v)));
    return { t: 'arr', items };
  } },
  sort_by: { params: [A, REF], run(this: Run, [a, r]) {
    const items = list(a);
    const keys = this.keys(items, r as Ref, 'either');
    this.tick(items.length * Math.max(1, Math.ceil(Math.log2(items.length + 1))) + this.textCost(keys));
    const order = items.map((_, i) => i);
    order.sort((i, j) => {
      const x = keys[i];
      const y = keys[j];
      return x.t === 'num' ? Number(x.raw) - Number((y as Json & { t: 'num' }).raw) : compareText((x as Json & { t: 'str' }).v, (y as Json & { t: 'str' }).v);
    });
    return { t: 'arr', items: order.map((i) => items[i]) };
  } },
  sum: { params: [['array-number']], run(this: Run, [a]) {
    const n = nums(a);
    this.tick(n.length);
    return num(n.reduce((x, y) => x + y, 0));
  } },
  to_array: { params: [ANY], run: ([a]) => (asJson(a).t === 'arr' ? asJson(a) : { t: 'arr', items: [asJson(a)] }) },
  to_number: { params: [ANY], run([a]) {
    const j = asJson(a);
    if (j.t === 'num') return j;
    if (j.t === 'str' && /^\s*-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(j.v)) {
      const n = Number(j.v);
      return Number.isFinite(n) ? num(n) : NULL;
    }
    return NULL;
  } },
  to_string: { params: [ANY], run(this: Run, [a]) {
    const j = asJson(a);
    return j.t === 'str' ? j : str(this.text(j));
  } },
  type: { params: [ANY], run: ([a]) => str(typeOf(asJson(a))) },
};

/** The result of a JMESPath expression on a document; JSON null when it finds nothing. */
export function jmesSearch(doc: Json, expression: string, io: JsonIo): Json {
  const tree = parse(expression, io);
  return new Run(io).eval(tree, doc);
}
