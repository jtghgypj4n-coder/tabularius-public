// A subset of jq for BE_JSON_jq ( json ; filter {; options } ): the filters people write to pick, reshape and total up
// JSON. Written from jq's manual; anything outside the subset is an error (the call gives "?"), never a guess.
//
// Supported: . .. .foo ."foo" .[e] .[a:b] .[] and ? ; | , ( ) ; literals, [ ], { }, string escapes and @formats;
// + - * / % == != < <= > >= and or not // ; if/elif/else/end ; try/catch ; "as $x |" ; reduce ; foreach ; def ;
// = |= += -= *= /= %= //= ; and the builtins listed in BUILTINS below. Regular expressions go through the same guard as
// BE_RegularExpression. Evaluation has a step budget, so `range(1e12)` or a runaway recursion ends with an error.
import { rethrowExecutionRefusal } from './execution-refusal.ts';
import { ResourceLimitError, resourceError, withWorkBudget, workBudget, budgetDepth, budgetReplace } from './work-budget.ts';
import { assertPatternNesting, guardedReplace, guardedSplit, guardedTest } from './regex-guard.ts';

export class JqError extends Error {}

type J = null | boolean | number | string | J[] | { [k: string]: J };
type Obj = { [k: string]: J };

const MAX_STEPS = 2_000_000;
const MAX_DEPTH = 400;
const MAX_OUTPUTS = 100_000;
const MAX_FILTER = 20_000;

// ---- lexer

type Tok = { t: 'num' | 'str' | 'id' | 'field' | 'var' | 'fmt' | 'op' | 'end'; v: string; n?: number; parts?: (string | Tok[])[] };

const OPS = ['?//', '|=', '+=', '-=', '*=', '/=', '%=', '//=', '==', '!=', '<=', '>=', '//', '..', '|', ',', '(', ')', '[', ']', '{', '}', ':', ';', '.', '=', '<', '>', '+', '-', '*', '/', '%', '?', '$'];
OPS.sort((a, b) => b.length - a.length);

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const readString = (): { parts: (string | Tok[])[] } => {
    // src[i] is the opening quote. Text and \( interpolation \) parts.
    i++;
    const parts: (string | Tok[])[] = [];
    let cur = '';
    for (;;) {
      if (i >= src.length) throw new JqError('unterminated string');
      const c = src[i];
      if (c === '"') { i++; break; }
      if (c !== '\\') { cur += c; i++; continue; }
      const e = src[i + 1];
      i += 2;
      if (e === 'n') cur += '\n';
      else if (e === 't') cur += '\t';
      else if (e === 'r') cur += '\r';
      else if (e === 'b') cur += '\b';
      else if (e === 'f') cur += '\f';
      else if (e === '/' || e === '\\' || e === '"') cur += e;
      else if (e === 'u') {
        const hex = src.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new JqError('invalid \\u escape');
        cur += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else if (e === '(') {
        let depth = 1;
        const start = i;
        while (i < src.length && depth > 0) {
          if (src[i] === '"') { const keep = i; readString(); if (i <= keep) throw new JqError('bad string'); continue; }
          if (src[i] === '(') depth++;
          else if (src[i] === ')') depth--;
          i++;
        }
        if (depth) throw new JqError('unterminated interpolation');
        if (cur) parts.push(cur);
        cur = '';
        parts.push(lex(src.slice(start, i - 1)));
      } else throw new JqError('invalid escape in string');
    }
    if (cur || !parts.length) parts.push(cur);
    return { parts };
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"') { const { parts } = readString(); out.push({ t: 'str', v: '', parts }); continue; }
    let m: RegExpExecArray | null;
    const rest = src.slice(i, i + 64);
    if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) { out.push({ t: 'num', v: m[0], n: Number(m[0]) }); i += m[0].length; continue; }
    if (c === '.' && (m = /^\.([A-Za-z_][A-Za-z0-9_]*)/.exec(rest))) { out.push({ t: 'field', v: m[1] }); i += m[0].length; continue; }
    if (c === '$' && (m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(rest))) { out.push({ t: 'var', v: m[1] }); i += m[0].length; continue; }
    if (c === '@' && (m = /^@([A-Za-z0-9_]+)/.exec(rest))) { out.push({ t: 'fmt', v: m[1] }); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*/.exec(rest))) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op || op === '?//' || op === '$') throw new JqError(`unexpected character ${JSON.stringify(c)}`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  out.push({ t: 'end', v: '' });
  return out;
}

// ---- parser

type Ast =
  | { k: 'id' }
  | { k: 'recurse' }
  | { k: 'lit'; v: J }
  | { k: 'str'; parts: (string | Ast)[]; fmt?: string }
  | { k: 'field'; t: Ast; name: Ast; opt: boolean }
  | { k: 'index'; t: Ast; i: Ast; opt: boolean }
  | { k: 'slice'; t: Ast; from?: Ast; to?: Ast; opt: boolean }
  | { k: 'iter'; t: Ast; opt: boolean }
  | { k: 'pipe'; a: Ast; b: Ast }
  | { k: 'comma'; a: Ast; b: Ast }
  | { k: 'neg'; a: Ast }
  | { k: 'bin'; op: string; a: Ast; b: Ast }
  | { k: 'and' | 'or' | 'alt'; a: Ast; b: Ast }
  | { k: 'assign'; op: string; a: Ast; b: Ast }
  | { k: 'if'; c: Ast; t: Ast; e?: Ast }
  | { k: 'try'; body: Ast; handler?: Ast }
  | { k: 'array'; a?: Ast }
  | { k: 'object'; entries: { key: Ast; value?: Ast }[] }
  | { k: 'as'; src: Ast; name: string; body: Ast }
  | { k: 'reduce'; src: Ast; name: string; init: Ast; update: Ast }
  | { k: 'foreach'; src: Ast; name: string; init: Ast; update: Ast; extract?: Ast }
  | { k: 'def'; name: string; params: string[]; body: Ast; rest: Ast }
  | { k: 'var'; name: string }
  | { k: 'call'; name: string; args: Ast[] }
  | { k: 'format'; name: string };

class Parser {
  private p = 0;
  private depth = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) { this.toks = toks; }
  private get cur(): Tok { return this.toks[this.p]; }
  private isOp(v: string): boolean { return this.cur.t === 'op' && this.cur.v === v; }
  private isKw(v: string): boolean { return this.cur.t === 'id' && this.cur.v === v; }
  private eatOp(v: string): boolean { if (this.isOp(v)) { this.p++; return true; } return false; }
  private expectOp(v: string): void { if (!this.eatOp(v)) throw new JqError(`expected ${v}`); }
  private expectKw(v: string): void { if (!this.isKw(v)) throw new JqError(`expected ${v}`); this.p++; }

  parseProgram(): Ast {
    const a = this.pipe();
    if (this.cur.t !== 'end') throw new JqError(`unexpected ${this.cur.v || 'end'}`);
    return a;
  }
  private nest<T>(f: () => T): T {
    if (++this.depth > 200) throw resourceError(new JqError('filter is nested too deeply'));
    try { return f(); } finally { this.depth--; }
  }
  private pipe(): Ast {
    return this.nest(() => {
      if (this.isKw('def')) {
        this.p++;
        if (this.cur.t !== 'id') throw new JqError('expected a function name');
        const name = this.cur.v;
        this.p++;
        const params: string[] = [];
        if (this.eatOp('(')) {
          do {
            const tok: Tok = this.cur;
            if (tok.t === 'var') params.push('$' + tok.v);
            else if (tok.t === 'id') params.push(tok.v);
            else throw new JqError('expected a parameter name');
            this.p++;
          } while (this.eatOp(';'));
          this.expectOp(')');
        }
        this.expectOp(':');
        const body = this.pipe();
        this.expectOp(';');
        return { k: 'def', name, params, body, rest: this.pipe() };
      }
      const a = this.comma();
      if (this.eatOp('|')) return { k: 'pipe', a, b: this.pipe() };
      return a;
    });
  }
  private comma(): Ast {
    let a = this.alt();
    while (this.eatOp(',')) a = { k: 'comma', a, b: this.alt() };
    return a;
  }
  private alt(): Ast {
    const a = this.assign();
    if (this.eatOp('//')) return { k: 'alt', a, b: this.alt() };
    return a;
  }
  private assign(): Ast {
    const a = this.or();
    for (const op of ['=', '|=', '+=', '-=', '*=', '/=', '%=', '//=']) {
      if (this.isOp(op)) { this.p++; return { k: 'assign', op, a, b: this.alt() }; }
    }
    return a;
  }
  private or(): Ast {
    let a = this.and();
    while (this.isKw('or')) { this.p++; a = { k: 'or', a, b: this.and() }; }
    return a;
  }
  private and(): Ast {
    let a = this.compare();
    while (this.isKw('and')) { this.p++; a = { k: 'and', a, b: this.compare() }; }
    return a;
  }
  private compare(): Ast {
    const a = this.additive();
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (this.isOp(op)) { this.p++; return { k: 'bin', op, a, b: this.additive() }; }
    }
    return a;
  }
  private additive(): Ast {
    let a = this.multiplicative();
    for (;;) {
      if (this.isOp('+')) { this.p++; a = { k: 'bin', op: '+', a, b: this.multiplicative() }; }
      else if (this.isOp('-')) { this.p++; a = { k: 'bin', op: '-', a, b: this.multiplicative() }; }
      else return a;
    }
  }
  private multiplicative(): Ast {
    let a = this.unary();
    for (;;) {
      const op = ['*', '/', '%'].find((o) => this.isOp(o));
      if (!op) return a;
      this.p++;
      a = { k: 'bin', op, a, b: this.unary() };
    }
  }
  private unary(): Ast {
    if (this.eatOp('-')) return { k: 'neg', a: this.unary() };
    return this.postfix();
  }
  private postfix(): Ast {
    let t = this.term();
    for (;;) {
      if (this.cur.t === 'field') { const name = this.cur.v; this.p++; t = { k: 'field', t, name: { k: 'lit', v: name }, opt: this.eatOp('?') }; continue; }
      if (this.isOp('.') && this.toks[this.p + 1].t === 'str') {
        this.p++;
        const s = this.stringTerm();
        t = { k: 'field', t, name: s, opt: this.eatOp('?') };
        continue;
      }
      if (this.isOp('.') && this.toks[this.p + 1].t === 'op' && this.toks[this.p + 1].v === '[') { this.p++; continue; }
      if (this.isOp('[')) { t = this.bracket(t); continue; }
      if (this.isOp('?')) { this.p++; t = { k: 'try', body: t }; continue; }
      if (this.isKw('as')) {
        this.p++;
        if (this.cur.t !== 'var') throw new JqError('only "as $name" bindings are supported');
        const name = this.cur.v;
        this.p++;
        this.expectOp('|');
        return { k: 'as', src: t, name, body: this.pipe() };
      }
      return t;
    }
  }
  private bracket(t: Ast): Ast {
    this.expectOp('[');
    if (this.eatOp(']')) return { k: 'iter', t, opt: this.eatOp('?') };
    if (this.eatOp(':')) {
      const to = this.pipe();
      this.expectOp(']');
      return { k: 'slice', t, to, opt: this.eatOp('?') };
    }
    const i = this.pipe();
    if (this.eatOp(':')) {
      const to = this.isOp(']') ? undefined : this.pipe();
      this.expectOp(']');
      return { k: 'slice', t, from: i, to, opt: this.eatOp('?') };
    }
    this.expectOp(']');
    return { k: 'index', t, i, opt: this.eatOp('?') };
  }
  private stringTerm(fmt?: string): Ast {
    const tok = this.cur;
    if (tok.t !== 'str') throw new JqError('expected a string');
    this.p++;
    const parts = tok.parts!.map((x) => (typeof x === 'string' ? x : new Parser(x).parseProgram()));
    if (parts.length === 1 && typeof parts[0] === 'string') return { k: 'lit', v: parts[0] };
    return { k: 'str', parts, fmt };
  }
  private term(): Ast {
    const tok = this.cur;
    switch (tok.t) {
      case 'num': this.p++; return { k: 'lit', v: tok.n! };
      case 'str': return this.stringTerm();
      case 'fmt': {
        this.p++;
        if (this.cur.t === 'str') return this.stringTerm(tok.v);
        return { k: 'format', name: tok.v };
      }
      case 'field': this.p++; return { k: 'field', t: { k: 'id' }, name: { k: 'lit', v: tok.v }, opt: this.eatOp('?') };
      case 'var': this.p++; return { k: 'var', name: tok.v };
      case 'id': return this.word(tok);
      case 'op': break;
      default: throw new JqError('unexpected end of filter');
    }
    switch (tok.v) {
      case '.':
        this.p++;
        if (this.cur.t === 'str') { const name = this.stringTerm(); return { k: 'field', t: { k: 'id' }, name, opt: this.eatOp('?') }; }
        if (this.isOp('[')) return this.bracket({ k: 'id' });
        return { k: 'id' };
      case '..': this.p++; return { k: 'recurse' };
      case '(': { this.p++; const a = this.pipe(); this.expectOp(')'); return a; }
      case '[': {
        this.p++;
        if (this.eatOp(']')) return { k: 'array' };
        const a = this.pipe();
        this.expectOp(']');
        return { k: 'array', a };
      }
      case '{': return this.object();
      case '-': this.p++; return { k: 'neg', a: this.postfix() };
      default: throw new JqError(`unexpected ${tok.v}`);
    }
  }
  private object(): Ast {
    this.expectOp('{');
    const entries: { key: Ast; value?: Ast }[] = [];
    if (this.eatOp('}')) return { k: 'object', entries };
    do {
      let key: Ast;
      const tok = this.cur;
      if (tok.t === 'id') { this.p++; key = { k: 'lit', v: tok.v }; }
      else if (tok.t === 'str') key = this.stringTerm();
      else if (tok.t === 'var') { this.p++; entries.push({ key: { k: 'lit', v: tok.v }, value: { k: 'var', name: tok.v } }); continue; }
      else if (tok.t === 'num') { this.p++; key = { k: 'lit', v: String(tok.n) }; }
      else if (this.eatOp('(')) { key = this.pipe(); this.expectOp(')'); }
      else throw new JqError('bad object key');
      if (this.eatOp(':')) {
        // The value is a term chain joined by | is not allowed unparenthesised; ExpD in jq: terms with | between them.
        let value = this.objectValue();
        while (this.isOp('|')) { this.p++; value = { k: 'pipe', a: value, b: this.objectValue() }; }
        entries.push({ key, value });
      } else entries.push({ key });
    } while (this.eatOp(','));
    this.expectOp('}');
    return { k: 'object', entries };
  }
  private objectValue(): Ast {
    return this.alt2();
  }
  private alt2(): Ast {
    // an object value stops at "," and "|", but allows the operators of lower binding
    const a = this.or();
    if (this.eatOp('//')) return { k: 'alt', a, b: this.alt2() };
    return a;
  }
  private word(tok: Tok): Ast {
    switch (tok.v) {
      case 'true': this.p++; return { k: 'lit', v: true };
      case 'false': this.p++; return { k: 'lit', v: false };
      case 'null': this.p++; return { k: 'lit', v: null };
      case 'if': {
        this.p++;
        const c = this.pipe();
        this.expectKw('then');
        const t = this.pipe();
        return this.ifRest(c, t);
      }
      case 'try': {
        this.p++;
        const body = this.postfixNoAs();
        let handler: Ast | undefined;
        if (this.isKw('catch')) { this.p++; handler = this.postfixNoAs(); }
        return { k: 'try', body, handler };
      }
      case 'reduce': case 'foreach': {
        this.p++;
        const src = this.postfixNoAs();
        this.expectKw('as');
        if (this.cur.t !== 'var') throw new JqError('only "as $name" bindings are supported');
        const name = this.cur.v;
        this.p++;
        this.expectOp('(');
        const init = this.pipe();
        this.expectOp(';');
        const update = this.pipe();
        let extract: Ast | undefined;
        if (tok.v === 'foreach' && this.eatOp(';')) extract = this.pipe();
        this.expectOp(')');
        return tok.v === 'reduce' ? { k: 'reduce', src, name, init, update } : { k: 'foreach', src, name, init, update, extract };
      }
      case 'def': return this.pipe();
      case 'then': case 'elif': case 'else': case 'end': case 'as': case 'catch': case 'and': case 'or':
        throw new JqError(`unexpected ${tok.v}`);
      default: {
        this.p++;
        const args: Ast[] = [];
        if (this.eatOp('(')) {
          do args.push(this.pipe()); while (this.eatOp(';'));
          this.expectOp(')');
        }
        return { k: 'call', name: tok.v, args };
      }
    }
  }
  private ifRest(c: Ast, t: Ast): Ast {
    if (this.isKw('elif')) {
      this.p++;
      const c2 = this.pipe();
      this.expectKw('then');
      const t2 = this.pipe();
      return { k: 'if', c, t, e: this.ifRest(c2, t2) };
    }
    let e: Ast | undefined;
    if (this.isKw('else')) { this.p++; e = this.pipe(); }
    this.expectKw('end');
    return { k: 'if', c, t, e };
  }
  /** A postfix term that does not take "as": the source of reduce/foreach and the body of try. */
  private postfixNoAs(): Ast {
    let t = this.term();
    for (;;) {
      if (this.cur.t === 'field') { const name = this.cur.v; this.p++; t = { k: 'field', t, name: { k: 'lit', v: name }, opt: this.eatOp('?') }; continue; }
      if (this.isOp('[')) { t = this.bracket(t); continue; }
      if (this.isOp('?')) { this.p++; t = { k: 'try', body: t }; continue; }
      return t;
    }
  }
}

// ---- values

const isObj = (v: J): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const newObj = (): Obj => { workBudget()?.nodes(); return Object.create(null) as Obj; };
const copyObj = (o: Obj): Obj => {
  const keys = Object.keys(o);
  workBudget()?.checkNodes(keys.length);
  // Shallow copies reuse keys and values. Charge the copy work in blocks,
  // not every retained entry as a new allocation on each reduce iteration.
  workBudget()?.work(Math.ceil(keys.length / 64));
  const copy = Object.assign(newObj(), o);
  workBudget()?.copyNodes(copy, keys.length);
  return copy;
};

function put(o: Obj, k: string, v: J): void {
  if (!has(o, k)) { workBudget()?.nodes(); workBudget()?.text(k.length); }
  workBudget()?.retainNodes(v);
  o[k] = v;
}
function push<T>(out: T[], ...values: T[]): number {
  workBudget()?.nodes(values.length);
  for (const v of values) workBudget()?.retainNodes(v);
  return out.push(...values);
}
function collect<T>(values: Iterable<T>): T[] {
  const out: T[] = [];
  for (const v of values) push(out, v);
  return out;
}
function concat(a: string, b: string): string {
  workBudget()?.checkText(a.length + b.length);
  // V8 concatenates ropes: the existing prefix is retained, not allocated anew.
  workBudget()?.text(b.length);
  return a + b;
}
function join(parts: string[], separator: string): string {
  let size = Math.max(0, parts.length - 1) * separator.length;
  for (const p of parts) { workBudget()?.work(); size += p.length; workBudget()?.checkText(size); }
  workBudget()?.text(size);
  return parts.join(separator);
}
// Count the serialized representation before JSON.stringify allocates it,
// including repeated references, escaped strings, and pretty-print indentation.
function jsonSize(v: J, pretty = false, depth = 0): number {
  return budgetDepth(() => {
    let size = 0;
    const add = (n: number): void => { size += n; workBudget()?.checkText(size); };
    if (typeof v === 'string') {
      add(2);
      for (let i = 0; i < v.length; i++) {
        const c = v.charCodeAt(i);
        if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c)) add(2);
        else if (c < 32) add(6);
        else if (c >= 0xd800 && c <= 0xdbff && v.charCodeAt(i + 1) >= 0xdc00 && v.charCodeAt(i + 1) <= 0xdfff) { add(2); i++; }
        else add(c >= 0xd800 && c <= 0xdfff ? 6 : 1);
      }
      workBudget()?.work(Math.ceil(v.length / 64));
    } else if (Array.isArray(v) || isObj(v)) {
      const keys = Array.isArray(v) ? null : Object.keys(v);
      const length = keys ? keys.length : (v as J[]).length;
      add(2);
      for (let i = 0; i < length; i++) {
        workBudget()?.work();
        if (i) add(1);
        if (pretty) add(1 + 2 * (depth + 1));
        if (keys) add(jsonSize(keys[i]) + (pretty ? 2 : 1));
        add(jsonSize(keys ? (v as Obj)[keys[i]] : (v as J[])[i], pretty, depth + 1));
      }
      if (pretty && length) add(1 + 2 * depth);
    } else add(typeof v === 'number' ? (Number.isFinite(v) ? String(v).length : Number.isNaN(v) ? 4 : v > 0 ? 23 : 24) : v === null ? 4 : v ? 4 : 5);
    return size;
  });
}
function parseJsonBounded(s: string): J {
  workBudget()?.text(s.length);
  // JSON punctuation is counted without treating punctuation inside strings as structure.
  let quoted = false, escaped = false, depth = 0, nodes = 0;
  for (const c of s) {
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') { quoted = true; nodes++; }
    else if (c === '[' || c === '{') { nodes++; if (++depth > 128) throw new ResourceLimitError('JSON nests too deeply'); }
    else if (c === ']' || c === '}') depth--;
    else if (c === ',' || c === ':') nodes++;
  }
  workBudget()?.nodes(nodes + 1);
  return JSON.parse(s) as J;
}

const has = (o: Obj, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const typeOf = (v: J): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v);
const order = (v: J): number => ({ null: 0, boolean: v === true ? 2 : 1, number: 3, string: 4, array: 5, object: 6 }[typeOf(v)] ?? 0);
const keysOf = (o: Obj): string[] => Object.keys(o).sort(cmpStr);

function appendItems<T>(out: T[], values: Iterable<T>): void {
  for (const v of values) push(out, v);
}
function mapItems<T, U>(items: T[], fn: (v: T, i: number, a: T[]) => U): U[] {
  workBudget()?.nodes(items.length);
  return items.map(fn);
}
function filterItems<T>(items: T[], fn: (v: T, i: number, a: T[]) => unknown): T[] {
  workBudget()?.nodes(items.length);
  return items.filter(fn);
}
function chars(s: string): string[] { workBudget()?.nodes(s.length); return Array.from(s); }
function nativeInput(v: J): void {
  if (typeof v === 'string') { workBudget()?.checkText(v.length); workBudget()?.work(Math.ceil(v.length / 64)); }
  else if (Array.isArray(v)) workBudget()?.work(v.length);
  else if (isObj(v)) workBudget()?.work(Object.keys(v).length);
}

function cmpStr(a: string, b: string): number {
  // Compare code points directly; sorting must not allocate two character
  // arrays (and charge them) on every comparison.
  let i = 0, j = 0, compared = 0;
  while (i < a.length && j < b.length) {
    if (compared++ % 64 === 0) workBudget()?.work();
    const x = a.codePointAt(i)!, y = b.codePointAt(j)!;
    if (x !== y) return x - y;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return (i < a.length ? 1 : 0) - (j < b.length ? 1 : 0);
}
export function jqCompare(a: J, b: J): number {
  return withWorkBudget(() => budgetDepth(() => compareInner(a, b)));
}
function compareInner(a: J, b: J): number {
  const oa = order(a);
  const ob = order(b);
  if (oa !== ob) return oa - ob;
  switch (typeOf(a)) {
    case 'number': return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
    case 'string': return cmpStr(a as string, b as string);
    case 'array': {
      const x = a as J[];
      const y = b as J[];
      for (let i = 0; i < Math.min(x.length, y.length); i++) { const c = jqCompare(x[i], y[i]); if (c) return c; }
      return x.length - y.length;
    }
    case 'object': {
      const x = a as Obj;
      const y = b as Obj;
      const kx = keysOf(x);
      const ky = keysOf(y);
      const c = jqCompare(kx, ky);
      if (c) return c;
      for (const k of kx) { const d = jqCompare(x[k], y[k]); if (d) return d; }
      return 0;
    }
    default: return 0;
  }
}
const truthy = (v: J): boolean => v !== null && v !== false;
const show = (v: J): string => {
  const s = toJson(v);
  return s.length > 11 ? s.slice(0, 10) + '...' : s;
};
function toJson(v: J): string {
  workBudget()?.text(jsonSize(v));
  if (typeof v === 'number' && !Number.isFinite(v)) return Number.isNaN(v) ? 'null' : v > 0 ? '1.7976931348623157e+308' : '-1.7976931348623157e+308';
  return JSON.stringify(v, (_k, x: unknown) => (typeof x === 'number' && !Number.isFinite(x) ? (Number.isNaN(x) ? null : x > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE) : x))!;
}
const tostr = (v: J): string => (typeof v === 'string' ? v : toJson(v));

// ---- evaluation

interface Closure { ast: Ast; env: Env }
interface Func { params: string[]; body: Ast; env: Env }
class Env {
  readonly parent: Env | null;
  readonly vars: Map<string, J>;
  readonly funcs = new Map<string, Func>();
  readonly closures = new Map<string, Closure>();
  constructor(parent: Env | null, vars: Map<string, J> = new Map()) { this.parent = parent; this.vars = vars; }
  variable(n: string): J | undefined { for (let e: Env | null = this; e; e = e.parent) if (e.vars.has(n)) return e.vars.get(n); return undefined; }
  hasVar(n: string): boolean { for (let e: Env | null = this; e; e = e.parent) if (e.vars.has(n)) return true; return false; }
  func(key: string): Func | undefined { for (let e: Env | null = this; e; e = e.parent) { const f = e.funcs.get(key); if (f) return f; } return undefined; }
  closure(n: string): Closure | undefined { for (let e: Env | null = this; e; e = e.parent) { const c = e.closures.get(n); if (c) return c; } return undefined; }
}

type Path = (string | number)[];
type Gen<T> = Generator<T, void, undefined>;

class Run {
  steps = 0;
  depth = 0;
  tick(): void {
    workBudget()?.work();
    if (++this.steps > MAX_STEPS) throw resourceError(new JqError('the filter took too many steps'));
  }

  *ev(a: Ast, input: J, env: Env): Gen<J> {
    this.tick();
    switch (a.k) {
      case 'id': yield input; return;
      case 'recurse': yield* this.recurseAll(input); return;
      case 'lit': yield a.v; return;
      case 'var': {
        if (a.name === 'ENV') { yield newObj(); return; }
        if (a.name === '__loc__') throw new JqError('$__loc__ is not supported');
        if (!env.hasVar(a.name)) throw new JqError(`$${a.name} is not defined`);
        yield env.variable(a.name)!;
        return;
      }
      case 'str': yield* this.interpolate(a.parts, 0, '', input, env, a.fmt); return;
      case 'format': yield format(a.name, input); return;
      case 'field': case 'index': {
        for (const t of this.ev(a.t, input, env)) {
          for (const key of this.ev(a.k === 'field' ? a.name : a.i, input, env)) {
            try { yield indexValue(t, key); } catch (e) {
              rethrowExecutionRefusal(e); if (!(e instanceof JqError) || !a.opt) throw e; }
          }
        }
        return;
      }
      case 'slice': {
        for (const t of this.ev(a.t, input, env)) {
          const tos = a.to ? collect(this.ev(a.to, input, env)) : [null];
          const froms = a.from ? collect(this.ev(a.from, input, env)) : [null];
          for (const to of tos) for (const from of froms) {
            try { yield sliceValue(t, from, to); } catch (e) {
              rethrowExecutionRefusal(e); if (!(e instanceof JqError) || !a.opt) throw e; }
          }
        }
        return;
      }
      case 'iter': {
        for (const t of this.ev(a.t, input, env)) {
          if (Array.isArray(t)) yield* t;
          else if (isObj(t)) for (const k of Object.keys(t)) yield t[k];
          else if (!a.opt) throw new JqError(`Cannot iterate over ${typeOf(t)}${t === null ? '' : ` (${show(t)})`}`);
        }
        return;
      }
      case 'pipe': for (const x of this.ev(a.a, input, env)) yield* this.ev(a.b, x, env); return;
      case 'comma': yield* this.ev(a.a, input, env); yield* this.ev(a.b, input, env); return;
      case 'neg': for (const x of this.ev(a.a, input, env)) { if (typeof x !== 'number') throw new JqError(`${typeOf(x)} (${show(x)}) cannot be negated`); yield -x; } return;
      case 'bin': {
        for (const r of this.ev(a.b, input, env)) for (const l of this.ev(a.a, input, env)) yield binary(a.op, l, r);
        return;
      }
      case 'and': for (const l of this.ev(a.a, input, env)) { if (!truthy(l)) yield false; else for (const r of this.ev(a.b, input, env)) yield truthy(r); } return;
      case 'or': for (const l of this.ev(a.a, input, env)) { if (truthy(l)) yield true; else for (const r of this.ev(a.b, input, env)) yield truthy(r); } return;
      case 'alt': {
        let any = false;
        try {
          for (const x of this.ev(a.a, input, env)) if (truthy(x)) { any = true; yield x; }
        } catch (e) {
          rethrowExecutionRefusal(e); if (!(e instanceof JqError)) throw e; }
        if (!any) yield* this.ev(a.b, input, env);
        return;
      }
      case 'if': {
        for (const c of this.ev(a.c, input, env)) {
          if (truthy(c)) yield* this.ev(a.t, input, env);
          else if (a.e) yield* this.ev(a.e, input, env);
          else yield input;
        }
        return;
      }
      case 'try': {
        try {
          yield* this.ev(a.body, input, env);
        } catch (e) {
          rethrowExecutionRefusal(e);
          if (!(e instanceof JqError) || e instanceof BreakError) throw e;
          if (a.handler) yield* this.ev(a.handler, errorValue(e), env);
        }
        return;
      }
      case 'array': yield a.a ? collect(this.ev(a.a, input, env)) : []; return;
      case 'object': yield* this.object(a.entries, 0, newObj(), input, env); return;
      case 'as': {
        for (const v of this.ev(a.src, input, env)) yield* this.ev(a.body, input, new Env(env, new Map([[a.name, v]])));
        return;
      }
      case 'reduce': {
        for (const init of this.ev(a.init, input, env)) {
          let acc: J | undefined = init;
          for (const v of this.ev(a.src, input, env)) {
            const inner = new Env(env, new Map([[a.name, v]]));
            let last: J | undefined;
            for (const x of this.ev(a.update, acc as J, inner)) last = x;
            acc = last === undefined ? null : last;
          }
          yield acc as J;
        }
        return;
      }
      case 'foreach': {
        for (const init of this.ev(a.init, input, env)) {
          let acc: J = init;
          for (const v of this.ev(a.src, input, env)) {
            const inner = new Env(env, new Map([[a.name, v]]));
            for (const x of this.ev(a.update, acc, inner)) {
              acc = x;
              if (a.extract) yield* this.ev(a.extract, x, inner);
              else yield x;
            }
          }
        }
        return;
      }
      case 'def': {
        const inner = new Env(env);
        inner.funcs.set(`${a.name}/${a.params.length}`, { params: a.params, body: a.body, env: inner });
        yield* this.ev(a.rest, input, inner);
        return;
      }
      case 'assign': yield* this.assign(a, input, env); return;
      case 'call': yield* this.call(a, input, env); return;
    }
  }

  *recurseAll(v: J): Gen<J> {
    this.tick();
    yield v;
    if (Array.isArray(v)) for (const x of v) yield* this.recurseAll(x);
    else if (isObj(v)) for (const k of Object.keys(v)) yield* this.recurseAll(v[k]);
  }

  *interpolate(parts: (string | Ast)[], at: number, acc: string, input: J, env: Env, fmt?: string): Gen<J> {
    if (at === parts.length) { yield acc; return; }
    const p = parts[at];
    if (typeof p === 'string') { yield* this.interpolate(parts, at + 1, concat(acc, p), input, env, fmt); return; }
    for (const v of this.ev(p, input, env)) yield* this.interpolate(parts, at + 1, concat(acc, fmt ? formatText(fmt, v) : tostr(v)), input, env, fmt);
  }

  *object(entries: { key: Ast; value?: Ast }[], at: number, acc: Obj, input: J, env: Env): Gen<J> {
    if (at === entries.length) { yield copyObj(acc); return; }
    const e = entries[at];
    for (const k of this.ev(e.key, input, env)) {
      if (typeof k !== 'string') throw new JqError(`Object keys must be strings`);
      const values = e.value ? this.ev(e.value, input, env) : this.ev({ k: 'field', t: { k: 'id' }, name: { k: 'lit', v: k }, opt: false }, input, env);
      for (const v of values) {
        const next = copyObj(acc);
        put(next, k, v);
        yield* this.object(entries, at + 1, next, input, env);
      }
    }
  }

  // ---- paths (for assignment, del, paths)

  *paths(a: Ast, input: J, env: Env, base: Path = [], value: J = input): Gen<[Path, J]> {
    this.tick();
    switch (a.k) {
      case 'id': yield [base, value]; return;
      case 'recurse': yield* this.recursePaths(base, value); return;
      case 'field': case 'index': {
        for (const [p, v] of this.paths(a.t, input, env, base, value)) {
          for (const key of this.ev(a.k === 'field' ? a.name : a.i, input, env)) {
            if (typeof key !== 'string' && typeof key !== 'number') throw new JqError(`Invalid path component ${show(key)}`);
            let child: J;
            try { child = indexValue(v, key); } catch (e) {
              rethrowExecutionRefusal(e); if (e instanceof JqError && a.opt) continue; throw e; }
            yield [[...p, key], child];
          }
        }
        return;
      }
      case 'iter': {
        for (const [p, v] of this.paths(a.t, input, env, base, value)) {
          if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield [[...p, i], v[i]];
          else if (isObj(v)) for (const k of Object.keys(v)) yield [[...p, k], v[k]];
          else if (!a.opt && v !== null) throw new JqError(`Cannot iterate over ${typeOf(v)}`);
        }
        return;
      }
      case 'pipe': for (const [p, v] of this.paths(a.a, input, env, base, value)) yield* this.paths(a.b, v, env, p, v); return;
      case 'comma': yield* this.paths(a.a, input, env, base, value); yield* this.paths(a.b, input, env, base, value); return;
      case 'if': {
        for (const c of this.ev(a.c, value, env)) {
          if (truthy(c)) yield* this.paths(a.t, value, env, base, value);
          else if (a.e) yield* this.paths(a.e, value, env, base, value);
          else yield [base, value];
        }
        return;
      }
      case 'alt': {
        let any = false;
        try { for (const r of this.paths(a.a, input, env, base, value)) if (truthy(r[1])) { any = true; yield r; } } catch (e) {
          rethrowExecutionRefusal(e); if (!(e instanceof JqError)) throw e; }
        if (!any) yield* this.paths(a.b, input, env, base, value);
        return;
      }
      case 'try': {
        try { yield* this.paths(a.body, input, env, base, value); } catch (e) {
          rethrowExecutionRefusal(e); if (!(e instanceof JqError)) throw e; }
        return;
      }
      case 'as': {
        for (const v of this.ev(a.src, value, env)) yield* this.paths(a.body, input, new Env(env, new Map([[a.name, v]])), base, value);
        return;
      }
      case 'call': {
        if (a.args.length === 0 && (a.name === 'empty')) return;
        if (a.args.length === 1 && a.name === 'select') {
          for (const c of this.ev(a.args[0], value, env)) if (truthy(c)) yield [base, value];
          return;
        }
        if (a.args.length === 1 && (a.name === 'first' || a.name === 'limit')) {
          for (const r of this.paths(a.args[0], input, env, base, value)) { yield r; return; }
          return;
        }
        if (a.args.length === 0 && (a.name === 'recurse')) { yield* this.recursePaths(base, value); return; }
        if (a.args.length === 0 && a.name === 'values') { if (value !== null) yield [base, value]; return; }
        if (a.args.length === 0 && a.name === 'getpath') return;
        if (a.args.length === 1 && a.name === 'getpath') {
          for (const p of this.ev(a.args[0], value, env)) {
            if (!Array.isArray(p)) throw new JqError('Path must be specified as an array');
            let cur: J = value;
            for (const k of p) cur = cur === null ? null : indexValue(cur, k as string | number);
            yield [[...base, ...(p as Path)], cur];
          }
          return;
        }
        const f = env.func(`${a.name}/${a.args.length}`);
        if (f) {
          const inner = this.bindArgs(f, a, env);
          yield* this.paths(f.body, value, inner, base, value);
          return;
        }
        const c = a.args.length === 0 ? env.closure(a.name) : undefined;
        if (c) { yield* this.paths(c.ast, value, c.env, base, value); return; }
        throw new JqError(`${a.name}/${a.args.length} cannot be used as a path`);
      }
      default: throw new JqError('Invalid path expression');
    }
  }
  *recursePaths(base: Path, v: J): Gen<[Path, J]> {
    this.tick();
    yield [base, v];
    if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* this.recursePaths([...base, i], v[i]);
    else if (isObj(v)) for (const k of Object.keys(v)) yield* this.recursePaths([...base, k], v[k]);
  }

  *assign(a: Extract<Ast, { k: 'assign' }>, input: J, env: Env): Gen<J> {
    if (a.op === '|=') {
      let out = input;
      const targets = collect(this.paths(a.a, input, env));
      const deletes: Path[] = [];
      for (const [p] of targets) {
        const cur = getPath(out, p);
        let next: J | undefined;
        for (const x of this.ev(a.b, cur, env)) { next = x; break; }
        if (next === undefined) push(deletes, p);
        else out = setPath(out, p, next);
      }
      yield deletePaths(out, deletes);
      return;
    }
    if (a.op === '=') {
      for (const rhs of this.ev(a.b, input, env)) {
        let out = input;
        for (const [p] of this.paths(a.a, input, env)) out = setPath(out, p, rhs);
        yield out;
      }
      return;
    }
    const op = a.op.slice(0, -1);
    for (const rhs of this.ev(a.b, input, env)) {
      let out = input;
      for (const [p] of this.paths(a.a, input, env)) {
        const cur = getPath(out, p);
        out = setPath(out, p, op === '//' ? (truthy(cur) ? cur : rhs) : binary(op, cur, rhs));
      }
      yield out;
    }
  }

  bindArgs(f: Func, a: Extract<Ast, { k: 'call' }>, env: Env): Env {
    const inner = new Env(f.env);
    f.params.forEach((p, i) => {
      if (p.startsWith('$')) throw new JqError('internal');
      inner.closures.set(p, { ast: a.args[i], env });
    });
    return inner;
  }

  *call(a: Extract<Ast, { k: 'call' }>, input: J, env: Env): Gen<J> {
    const n = a.args.length;
    // User definitions and closure parameters first: they shadow builtins.
    const f = env.func(`${a.name}/${n}`);
    if (f) {
      if (++this.depth > MAX_DEPTH) { this.depth--; throw resourceError(new JqError('the filter recurses too deeply')); }
      try {
        const valueParams = filterItems(mapItems(f.params, (p, i) => [p, i] as const), ([p]) => p.startsWith('$'));
        if (valueParams.length) {
          yield* this.callWithValues(f, a, valueParams, 0, new Map(), input, env);
        } else {
          yield* this.ev(f.body, input, this.bindArgs(f, a, env));
        }
      } finally { this.depth--; }
      return;
    }
    if (n === 0) {
      const c = env.closure(a.name);
      if (c) { yield* this.ev(c.ast, input, c.env); return; }
    }
    const b = BUILTINS[`${a.name}/${n}`];
    if (b) { nativeInput(input); yield* b(this, a.args, input, env); return; }
    throw new JqError(`${a.name}/${n} is not defined`);
  }
  *callWithValues(f: Func, a: Extract<Ast, { k: 'call' }>, vp: (readonly [string, number])[], at: number, vals: Map<string, J>, input: J, env: Env): Gen<J> {
    if (at === vp.length) {
      const inner = new Env(f.env, new Map(vals));
      f.params.forEach((p, i) => { if (!p.startsWith('$')) inner.closures.set(p, { ast: a.args[i], env }); else inner.closures.set(p.slice(1), { ast: { k: 'lit', v: vals.get(p.slice(1)) as J }, env }); });
      yield* this.ev(f.body, input, inner);
      return;
    }
    const [p, i] = vp[at];
    for (const v of this.ev(a.args[i], input, env)) {
      const next = new Map(vals);
      next.set(p.slice(1), v);
      yield* this.callWithValues(f, a, vp, at + 1, next, input, env);
    }
  }
}

class BreakError extends JqError {}

function errorValue(e: JqError): J {
  const v = (e as JqError & { value?: J }).value;
  return v !== undefined ? v : e.message;
}

function indexValue(t: J, key: J): J {
  if (isObj(t) && typeof key === 'string') return has(t, key) ? t[key] : null;
  if (Array.isArray(t) && typeof key === 'number') {
    if (!Number.isFinite(key)) return null;
    const i = Math.floor(key);
    const at = i < 0 ? t.length + i : i;
    return at >= 0 && at < t.length ? t[at] : null;
  }
  if (t === null && (typeof key === 'string' || typeof key === 'number' || key === null)) return null;
  if (Array.isArray(t) && Array.isArray(key)) return indicesOf(t, key);
  if (isObj(key) && (Array.isArray(t) || typeof t === 'string' || t === null)) return sliceValue(t, (key as Obj).start ?? null, (key as Obj).end ?? null);
  if (typeof key === 'string') throw new JqError(`Cannot index ${typeOf(t)} with "${key}"`);
  throw new JqError(`Cannot index ${typeOf(t)} with ${typeOf(key)}`);
}
function indicesOf(t: J[], sub: J[]): J {
  const out: number[] = [];
  if (!sub.length) return null;
  for (let i = 0; i + sub.length <= t.length; i++) if (sub.every((x, j) => jqCompare(t[i + j], x) === 0)) push(out, i);
  return out;
}
function sliceValue(t: J, from: J, to: J): J {
  if (t === null) return null;
  if (typeof t !== 'string' && !Array.isArray(t)) throw new JqError(`Cannot index ${typeOf(t)} with object`);
  if ((from !== null && typeof from !== 'number') || (to !== null && typeof to !== 'number')) throw new JqError('Start and end indices of an array slice must be numbers');
  if (Array.isArray(t)) workBudget()?.nodes(t.length);
  const items = typeof t === 'string' ? chars(t) : t;
  const len = items.length;
  let s = from === null ? 0 : Math.floor(from);
  let e = to === null ? len : Math.ceil(to);
  if (s < 0) s = Math.max(0, len + s);
  if (e < 0) e = Math.max(0, len + e);
  s = Math.min(s, len);
  e = Math.min(Math.max(e, s), len);
  return typeof t === 'string' ? join((items as string[]).slice(s, e), '') : (items as J[]).slice(s, e);
}

function binary(op: string, l: J, r: J): J {
  workBudget()?.work();
  switch (op) {
    case '==': return jqCompare(l, r) === 0;
    case '!=': return jqCompare(l, r) !== 0;
    case '<': return jqCompare(l, r) < 0;
    case '<=': return jqCompare(l, r) <= 0;
    case '>': return jqCompare(l, r) > 0;
    case '>=': return jqCompare(l, r) >= 0;
    case '+':
      if (l === null) return r;
      if (r === null) return l;
      if (typeof l === 'number' && typeof r === 'number') return l + r;
      if (typeof l === 'string' && typeof r === 'string') return concat(l, r);
      if (Array.isArray(l) && Array.isArray(r)) {
        workBudget()?.checkNodes(l.length + r.length);
        workBudget()?.work(Math.ceil(l.length / 64));
        workBudget()?.nodes(r.length);
        const copy = [...l, ...r];
        workBudget()?.copyNodes(copy, l.length);
        return copy;
      }
      if (isObj(l) && isObj(r)) { const o = copyObj(l); for (const k of Object.keys(r)) put(o, k, r[k]); return o; }
      break;
    case '-':
      if (typeof l === 'number' && typeof r === 'number') return l - r;
      if (Array.isArray(l) && Array.isArray(r)) return filterItems(l, (x) => !r.some((y) => jqCompare(x, y) === 0));
      break;
    case '*':
      if (typeof l === 'number' && typeof r === 'number') return l * r;
      if ((typeof l === 'string' && typeof r === 'number') || (typeof l === 'number' && typeof r === 'string')) {
        const [s, n] = typeof l === 'string' ? [l, r as number] : [r as string, l];
        if (n <= 0) return null;
        const times = Math.max(1, Math.floor(n));
        workBudget()?.text(s.length * times);
        return s.repeat(times);
      }
      if (isObj(l) && isObj(r)) return deepMerge(l, r);
      break;
    case '/':
      if (typeof l === 'number' && typeof r === 'number') {
        if (r === 0) throw new JqError(`${typeOf(l)} (${show(l)}) and ${typeOf(r)} (${show(r)}) cannot be divided because the divisor is zero`);
        return l / r;
      }
      if (typeof l === 'string' && typeof r === 'string') return splitString(l, r);
      break;
    case '%':
      if (typeof l === 'number' && typeof r === 'number') {
        const a = Math.trunc(l);
        const b = Math.trunc(r);
        if (b === 0) throw new JqError(`${typeOf(l)} (${show(l)}) and ${typeOf(r)} (${show(r)}) cannot be divided because the divisor is zero`);
        return a % Math.abs(b);
      }
      break;
  }
  const verb = { '+': 'added', '-': 'subtracted', '*': 'multiplied', '/': 'divided', '%': 'divided' }[op] ?? 'combined';
  throw new JqError(`${typeOf(l)} (${show(l)}) and ${typeOf(r)} (${show(r)}) cannot be ${verb}`);
}
function deepMerge(l: Obj, r: Obj): Obj {
  return budgetDepth(() => {
    const o = copyObj(l);
    for (const k of Object.keys(r)) put(o, k, isObj(o[k]) && isObj(r[k]) ? deepMerge(o[k] as Obj, r[k] as Obj) : r[k]);
    return o;
  });
}
function splitString(s: string, sep: string): J {
  if (s === '') return [];
  let count = 0;
  if (!sep) count = s.length;
  else for (let at = s.indexOf(sep); at >= 0; at = s.indexOf(sep, at + sep.length)) { workBudget()?.work(); count++; }
  workBudget()?.nodes(count + 1); workBudget()?.text(s.length);
  return sep === '' ? chars(s) : s.split(sep);
}

function getPath(v: J, p: Path): J {
  let cur = v;
  for (const k of p) { if (cur === null) return null; cur = indexValue(cur, k); }
  return cur;
}
function setPath(v: J, p: Path, x: J): J {
  return budgetDepth(() => {
    if (!p.length) return x;
    const [k, ...rest] = p;
    if (typeof k === 'string') {
      if (v !== null && !isObj(v)) throw new JqError(`Cannot index ${typeOf(v)} with "${k}"`);
      const o = v === null ? newObj() : copyObj(v);
      put(o, k, setPath(has(o, k) ? o[k] : null, rest, x));
      return o;
    }
    if (v !== null && !Array.isArray(v)) throw new JqError(`Cannot index ${typeOf(v)} with number`);
    const arr = v === null ? [] : collect(v);
    const i = Math.floor(k);
    const at = i < 0 ? arr.length + i : i;
    if (at < 0) throw new JqError('Out of bounds negative array index');
    workBudget()?.nodes(Math.max(0, at + 1 - arr.length));
    while (arr.length < at) arr.push(null);
    arr[at] = setPath(at < arr.length ? arr[at] : null, rest, x);
    return arr;
  });
}
function deletePaths(v: J, paths: Path[]): J {
  const sorted = collect(paths).sort((a, b) => jqCompare(b as J[], a as J[]));
  let out = v;
  for (const p of sorted) out = deletePath(out, p);
  return out;
}
function deletePath(v: J, p: Path): J {
  if (!p.length) return null;
  if (v === null) return null;
  const [k, ...rest] = p;
  if (rest.length) {
    const child = indexValue(v, k);
    if (child === null) return v;
    return setPath(v, [k], deletePath(child, rest));
  }
  if (isObj(v) && typeof k === 'string') { const o = copyObj(v); delete o[k]; return o; }
  if (Array.isArray(v) && typeof k === 'number') {
    const i = Math.floor(k);
    const at = i < 0 ? v.length + i : i;
    return at >= 0 && at < v.length ? filterItems(v, (_x, j) => j !== at) : v;
  }
  throw new JqError(`Cannot delete field at ${typeof k === 'string' ? 'object' : 'array'} index of ${typeOf(v)}`);
}

// ---- @formats

function formatText(name: string, v: J): string {
  switch (name) {
    case 'text': return tostr(v);
    case 'json': return toJson(v);
    case 'html': return budgetReplace(tostr(v), /[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' })[c]!);
    case 'uri': workBudget()?.nodes(Buffer.byteLength(tostr(v), 'utf8')); return join(mapItems(Array.from(Buffer.from(tostr(v), 'utf8')), (b) => (/[A-Za-z0-9\-_.~]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : '%' + b.toString(16).toUpperCase().padStart(2, '0'))), '');
    case 'csv': case 'tsv': {
      if (!Array.isArray(v)) throw new JqError(`${typeOf(v)} (${show(v)}) cannot be ${name}-formatted, only an array can be`);
      return join(mapItems(v, (x) => {
        if (typeof x === 'number') return toJson(x);
        if (typeof x === 'boolean') return x ? 'true' : 'false';
        if (x === null) return '';
        if (typeof x === 'string') return name === 'csv' ? concat(concat('"', budgetReplace(x, /"/g, () => '""')), '"') : budgetReplace(x, /[\\\t\n\r]/g, (c) => ({ '\\': '\\\\', '\t': '\\t', '\n': '\\n', '\r': '\\r' })[c]!);
        throw new JqError(`${typeOf(x)} (${show(x)}) is not valid in a csv row`);
      }), name === 'csv' ? ',' : '\t');
    }
    case 'sh': {
      const one = (x: J): string => {
        if (typeof x === 'string') return concat(concat("'", budgetReplace(x, /'/g, () => `'\\''`)), "'");
        if (Array.isArray(x) || isObj(x)) throw new JqError(`${typeOf(x)} (${show(x)}) can not be escaped for shell`);
        return toJson(x);
      };
      return Array.isArray(v) ? join(mapItems(v, one), ' ') : one(v);
    }
    case 'base64': { const s = tostr(v); workBudget()?.text(Math.ceil(Buffer.byteLength(s, 'utf8') / 3) * 4); return Buffer.from(s, 'utf8').toString('base64'); }
    case 'base64d': { const s = tostr(v); workBudget()?.text(s.length); return Buffer.from(s, 'base64').toString('utf8'); }
    default: throw new JqError(`${name} is not a valid format`);
  }
}
const format = (name: string, v: J): J => formatText(name, v);

// ---- builtins

type Builtin = (r: Run, args: Ast[], input: J, env: Env) => Gen<J>;

const num = (v: J, what: string): number => {
  if (typeof v !== 'number') throw new JqError(`${typeOf(v)} (${show(v)}) number required${what ? ` for ${what}` : ''}`);
  return v;
};
const str = (v: J, what: string): string => {
  if (typeof v !== 'string') throw new JqError(`${typeOf(v)} (${show(v)}) ${what}`);
  return v;
};
const arr = (v: J, what: string): J[] => {
  if (!Array.isArray(v)) throw new JqError(`${typeOf(v)} (${show(v)}) ${what}`);
  return v;
};
const lengthOf = (v: J): number => {
  if (v === null) return 0;
  if (typeof v === 'boolean') throw new JqError(`boolean (${show(v)}) has no length`);
  if (typeof v === 'number') return Math.abs(v);
  if (typeof v === 'string') { let size = 0; workBudget()?.work(Math.ceil(v.length / 64)); for (const _ch of v) size++; return size; }
  if (Array.isArray(v)) return v.length;
  return Object.keys(v).length;
};
const containsInner = (a: J, b: J): boolean => budgetDepth(() => {
  workBudget()?.work();
  if (isObj(a) && isObj(b)) return Object.keys(b).every((k) => has(a, k) && containsInner(a[k], b[k]));
  if (Array.isArray(a) && Array.isArray(b)) return b.every((y) => a.some((x) => containsInner(x, y)));
  if (typeof a === 'string' && typeof b === 'string') return a.includes(b);
  return jqCompare(a, b) === 0;
});
const containsV = (a: J, b: J): boolean => {
  if (typeOf(a) !== typeOf(b)) throw new JqError(`${typeOf(a)} (${show(a)}) and ${typeOf(b)} (${show(b)}) cannot have their containment checked`);
  return containsInner(a, b);
};
function sortKeyed(items: J[], keys: J[]): J[] {
  return mapItems(mapItems(items, (x, i) => [x, keys[i]] as const).sort((p, q) => jqCompare(p[1], q[1])), (p) => p[0]);
}
function groupKeyed(items: J[], keys: J[]): J[][] {
  const sorted = mapItems(items, (x, i) => [x, keys[i]] as const).sort((p, q) => jqCompare(p[1], q[1]));
  const groups: J[][] = [];
  let last: J | undefined;
  for (const [x, k] of sorted) {
    if (groups.length && last !== undefined && jqCompare(last, k) === 0) push(groups[groups.length - 1], x);
    else { push(groups, [x]); last = k; }
  }
  return groups;
}
function flatten(a: J[], depth: number): J[] {
  if (depth < 0) throw new JqError('flatten depth must not be negative');
  const out: J[] = [];
  const visit = (items: J[], d: number): void => budgetDepth(() => {
    for (const x of items) { workBudget()?.work(); if (Array.isArray(x) && d > 0) visit(x, d - 1); else push(out, x); }
  });
  visit(a, depth);
  return out;
}
const toNumber = (v: J): J => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s !== '' && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
    throw new JqError(`Cannot parse '${v}' as number`);
  }
  throw new JqError(`${typeOf(v)} (${show(v)}) cannot be parsed as a number`);
};
function regexOf(re: J, flags: J): RegExp {
  const src = str(re, 'cannot be matched, as it is not a string');
  assertPatternNesting(src);
  let f = '';
  if (flags !== null && flags !== undefined) {
    for (const c of str(flags, 'is not a string')) {
      if (c === 'i' || c === 'm' || c === 's' || c === 'g') f += c;
      else if (c === 'x') { /* extended: not supported */ throw new JqError('the x regular expression flag is not supported'); }
      else if (c === 'n' || c === 'l' || c === 'p') { if (c === 'p') f += 's'; }
      else throw new JqError(`${flags} is not a valid modifier string`);
    }
  }
  try { return new RegExp(src, join(collect(new Set(f)), '')); } catch (e) { rethrowExecutionRefusal(e); throw new JqError(`${src} (at offset 0) is not a valid regex`); }
}
const gen = function* <T>(v: T): Gen<T> { yield v; };

const BUILTINS: Record<string, Builtin> = {};
const fn0 = (name: string, f: (v: J) => J): void => { BUILTINS[`${name}/0`] = (_r, _a, input) => gen(f(input)); };
const fn1 = (name: string, f: (v: J, a: J) => J): void => {
  BUILTINS[`${name}/1`] = function* (r, args, input, env) { for (const a of r.ev(args[0], input, env)) yield f(input, a); };
};
const fn2 = (name: string, f: (v: J, a: J, b: J) => J): void => {
  BUILTINS[`${name}/2`] = function* (r, args, input, env) {
    for (const b of r.ev(args[1], input, env)) for (const a of r.ev(args[0], input, env)) yield f(input, a, b);
  };
};

BUILTINS['empty/0'] = function* () { /* nothing */ };
BUILTINS['not/0'] = (_r, _a, i) => gen(!truthy(i));
BUILTINS['error/0'] = (_r, _a, i) => { throw Object.assign(new JqError(tostr(i)), { value: i }); };
BUILTINS['error/1'] = function* (r, args, input, env) { for (const m of r.ev(args[0], input, env)) throw Object.assign(new JqError(tostr(m)), { value: m }); };
BUILTINS['select/1'] = function* (r, args, input, env) { for (const c of r.ev(args[0], input, env)) if (truthy(c)) yield input; };
BUILTINS['recurse/0'] = (r, _a, input) => r.recurseAll(input);
BUILTINS['recurse/1'] = function* (r, args, input, env) {
  const walk = function* (v: J): Gen<J> { r.tick(); yield v; for (const n of r.ev(args[0], v, env)) yield* walk(n); };
  yield* walk(input);
};
BUILTINS['map/1'] = function* (r, args, input, env) {
  const out: J[] = [];
  if (Array.isArray(input)) for (const x of input) appendItems(out, r.ev(args[0], x, env));
  else if (isObj(input)) for (const k of Object.keys(input)) appendItems(out, r.ev(args[0], input[k], env));
  else throw new JqError(`Cannot iterate over ${typeOf(input)}${input === null ? '' : ` (${show(input)})`}`);
  yield out;
};
BUILTINS['map_values/1'] = function* (r, args, input, env) {
  if (Array.isArray(input)) { const out: J[] = []; for (const x of input) { for (const y of r.ev(args[0], x, env)) { push(out, y); break; } } yield out; return; }
  if (isObj(input)) { const o = newObj(); for (const k of Object.keys(input)) for (const y of r.ev(args[0], input[k], env)) { put(o, k, y); break; } yield o; return; }
  throw new JqError(`Cannot iterate over ${typeOf(input)}`);
};
BUILTINS['range/1'] = function* (r, args, input, env) { for (const n of r.ev(args[0], input, env)) { const to = num(n, 'range'); for (let i = 0; i < to; i++) { r.tick(); yield i; } } };
BUILTINS['range/2'] = function* (r, args, input, env) {
  for (const f of r.ev(args[0], input, env)) for (const t of r.ev(args[1], input, env)) { const to = num(t, 'range'); for (let i = num(f, 'range'); i < to; i++) { r.tick(); yield i; } }
};
BUILTINS['range/3'] = function* (r, args, input, env) {
  for (const f of r.ev(args[0], input, env)) for (const t of r.ev(args[1], input, env)) for (const s of r.ev(args[2], input, env)) {
    const from = num(f, 'range'); const to = num(t, 'range'); const by = num(s, 'range');
    if (by > 0) for (let i = from; i < to; i += by) { r.tick(); yield i; }
    else if (by < 0) for (let i = from; i > to; i += by) { r.tick(); yield i; }
    else if (from < to) for (;;) { r.tick(); yield from; }
  }
};
BUILTINS['first/1'] = function* (r, args, input, env) { for (const x of r.ev(args[0], input, env)) { yield x; return; } };
BUILTINS['last/1'] = function* (r, args, input, env) { let last: J | undefined; for (const x of r.ev(args[0], input, env)) last = x; if (last !== undefined) yield last; };
BUILTINS['nth/2'] = function* (r, args, input, env) {
  for (const n of r.ev(args[0], input, env)) {
    const k = num(n, 'nth');
    if (k < 0) throw new JqError('Out of bounds negative array index');
    let i = 0;
    for (const x of r.ev(args[1], input, env)) { if (i++ === k) { yield x; break; } }
  }
};
BUILTINS['limit/2'] = function* (r, args, input, env) {
  for (const n of r.ev(args[0], input, env)) {
    const k = num(n, 'limit');
    if (k <= 0) continue;
    let i = 0;
    for (const x of r.ev(args[1], input, env)) { yield x; if (++i >= k) break; }
  }
};
BUILTINS['until/2'] = function* (r, args, input, env) {
  let cur = input;
  for (;;) {
    r.tick();
    let done = false;
    for (const c of r.ev(args[0], cur, env)) { done = truthy(c); break; }
    if (done) { yield cur; return; }
    let next: J | undefined;
    for (const x of r.ev(args[1], cur, env)) { next = x; break; }
    if (next === undefined) return;
    cur = next;
  }
};
BUILTINS['while/2'] = function* (r, args, input, env) {
  let cur = input;
  for (;;) {
    r.tick();
    let go = false;
    for (const c of r.ev(args[0], cur, env)) { go = truthy(c); break; }
    if (!go) return;
    yield cur;
    let next: J | undefined;
    for (const x of r.ev(args[1], cur, env)) { next = x; break; }
    if (next === undefined) return;
    cur = next;
  }
};
BUILTINS['repeat/1'] = function* (r, args, input, env) {
  let cur = input;
  for (;;) {
    r.tick();
    yield cur;
    let next: J | undefined;
    for (const x of r.ev(args[0], cur, env)) { next = x; break; }
    if (next === undefined) return;
    cur = next;
  }
};
BUILTINS['any/0'] = (_r, _a, i) => gen(arr(i, 'cannot be iterated over').some(truthy));
BUILTINS['all/0'] = (_r, _a, i) => gen(arr(i, 'cannot be iterated over').every(truthy));
BUILTINS['any/1'] = function* (r, args, input, env) { yield arr(input, 'cannot be iterated over').some((x) => { for (const c of r.ev(args[0], x, env)) if (truthy(c)) return true; return false; }); };
BUILTINS['all/1'] = function* (r, args, input, env) { yield arr(input, 'cannot be iterated over').every((x) => { for (const c of r.ev(args[0], x, env)) if (!truthy(c)) return false; return true; }); };
BUILTINS['any/2'] = function* (r, args, input, env) { for (const x of r.ev(args[0], input, env)) for (const c of r.ev(args[1], x, env)) if (truthy(c)) { yield true; return; } yield false; };
BUILTINS['all/2'] = function* (r, args, input, env) { for (const x of r.ev(args[0], input, env)) for (const c of r.ev(args[1], x, env)) if (!truthy(c)) { yield false; return; } yield true; };
BUILTINS['add/0'] = (_r, _a, i) => {
  let acc: J = null;
  const items = Array.isArray(i) ? i : isObj(i) ? mapItems(Object.keys(i), (k) => i[k]) : (() => { throw new JqError(`Cannot iterate over ${typeOf(i)}`); })();
  for (const x of items) acc = binary('+', acc, x);
  return gen(acc);
};
BUILTINS['add/1'] = function* (r, args, input, env) { let acc: J = null; for (const x of r.ev(args[0], input, env)) acc = binary('+', acc, x); yield acc; };
BUILTINS['sort_by/1'] = function* (r, args, input, env) {
  const a = arr(input, 'cannot be sorted, as it is not an array');
  yield sortKeyed(a, mapItems(a, (x) => collect(r.ev(args[0], x, env))));
};
BUILTINS['group_by/1'] = function* (r, args, input, env) {
  const a = arr(input, 'cannot be grouped, as it is not an array');
  yield groupKeyed(a, mapItems(a, (x) => collect(r.ev(args[0], x, env))));
};
BUILTINS['unique_by/1'] = function* (r, args, input, env) {
  const a = arr(input, 'cannot be grouped, as it is not an array');
  yield mapItems(groupKeyed(a, mapItems(a, (x) => collect(r.ev(args[0], x, env)))), (g) => g[0]);
};
BUILTINS['min_by/1'] = function* (r, args, input, env) {
  const a = arr(input, 'cannot be iterated over');
  const keys = mapItems(a, (x) => collect(r.ev(args[0], x, env)) as J);
  let best = -1;
  a.forEach((_x, i) => { if (best < 0 || jqCompare(keys[i], keys[best]) < 0) best = i; });
  yield best < 0 ? null : a[best];
};
BUILTINS['max_by/1'] = function* (r, args, input, env) {
  const a = arr(input, 'cannot be iterated over');
  const keys = mapItems(a, (x) => collect(r.ev(args[0], x, env)) as J);
  let best = -1;
  a.forEach((_x, i) => { if (best < 0 || jqCompare(keys[i], keys[best]) >= 0) best = i; });
  yield best < 0 ? null : a[best];
};
BUILTINS['to_entries/0'] = (_r, _a, i) => {
  if (!isObj(i)) throw new JqError(`${typeOf(i)} (${show(i)}) has no keys`);
  return gen(mapItems(Object.keys(i).sort(cmpStr), (k) => { const e = newObj(); put(e, 'key', k); put(e, 'value', i[k]); return e; }));
};
BUILTINS['from_entries/0'] = (_r, _a, i) => {
  const o = newObj();
  for (const e of arr(i, 'cannot be iterated over')) {
    if (!isObj(e)) throw new JqError(`Cannot index ${typeOf(e)} with "key"`);
    const pick = (...names: string[]) => { for (const n of names) if (has(e, n) && e[n] !== null && e[n] !== false) return e[n]; for (const n of names) if (has(e, n)) return e[n]; return null; };
    const k = pick('key', 'k', 'name', 'Name', 'Key', 'K');
    const v = has(e, 'value') ? e.value : has(e, 'Value') ? e.Value : has(e, 'v') ? e.v : has(e, 'V') ? e.V : null;
    if (typeof k === 'string') put(o, k, v);
    else if (typeof k === 'number' || typeof k === 'boolean') put(o, String(k), v);
    else if (k === null) put(o, 'null', v);
    else throw new JqError(`Cannot use ${typeOf(k)} (${show(k)}) as object key`);
  }
  return gen(o);
};
BUILTINS['with_entries/1'] = function* (r, args, input, env) {
  const entries = collect(BUILTINS['to_entries/0'](r, [], input, env))[0] as J[];
  const out: J[] = [];
  for (const e of entries) appendItems(out, r.ev(args[0], e, env));
  yield* BUILTINS['from_entries/0'](r, [], out, env);
};
BUILTINS['paths/0'] = function* (r, _a, input) { for (const [p] of r.recursePaths([], input)) if (p.length) yield p; };
BUILTINS['paths/1'] = function* (r, args, input, env) { for (const [p, v] of r.recursePaths([], input)) if (p.length) for (const c of r.ev(args[0], v, env)) if (truthy(c)) { yield p; break; } };
BUILTINS['leaf_paths/0'] = function* (r, _a, input) { for (const [p, v] of r.recursePaths([], input)) if (p.length && typeof v !== 'object') yield p; else if (p.length && v === null) yield p; };
BUILTINS['path/1'] = function* (r, args, input, env) { for (const [p] of r.paths(args[0], input, env)) yield p; };
BUILTINS['del/1'] = function* (r, args, input, env) { yield deletePaths(input, mapItems(collect(r.paths(args[0], input, env)), ([p]) => p)); };
BUILTINS['delpaths/1'] = function* (r, args, input, env) { for (const ps of r.ev(args[0], input, env)) yield deletePaths(input, arr(ps, 'Paths must be specified as an array') as Path[]); };
BUILTINS['getpath/1'] = function* (r, args, input, env) {
  for (const p of r.ev(args[0], input, env)) { let cur = input; for (const k of arr(p, 'Path must be specified as an array')) { if (cur === null) break; cur = indexValue(cur, k); } yield cur; }
};
BUILTINS['setpath/2'] = function* (r, args, input, env) {
  for (const v of r.ev(args[1], input, env)) for (const p of r.ev(args[0], input, env)) yield setPath(input, arr(p, 'Path must be specified as an array') as Path, v);
};
BUILTINS['to_array/0'] = (_r, _a, i) => gen(Array.isArray(i) ? i : [i]);
BUILTINS['splits/1'] = function* (r, args, input, env) { for (const re of r.ev(args[0], input, env)) yield* guardedSplit(regexOf(re, null), str(input, 'cannot be matched, as it is not a string')); };
BUILTINS['splits/2'] = function* (r, args, input, env) { for (const re of r.ev(args[0], input, env)) for (const f of r.ev(args[1], input, env)) yield* guardedSplit(regexOf(re, f), str(input, 'cannot be matched, as it is not a string')); };
BUILTINS['tostream/0'] = function* (r, _a, input) {
  const walk = function* (v: J, p: Path, top: boolean): Gen<J> {
    r.tick();
    const kids = Array.isArray(v) ? mapItems(v, (x, i) => [i, x] as const) : isObj(v) ? mapItems(Object.keys(v), (k) => [k, v[k]] as const) : null;
    if (!kids || !kids.length) { yield [p, v]; }
    else {
      for (let i = 0; i < kids.length; i++) yield* walk(kids[i][1], [...p, kids[i][0]], false);
      yield [[...p, kids[kids.length - 1][0]]];
    }
    void top;
  };
  yield* walk(input, [], true);
};
BUILTINS['input/0'] = function* () { throw new JqError('No more inputs'); };
BUILTINS['debug/0'] = (_r, _a, i) => gen(i);
BUILTINS['env/0'] = () => gen(newObj());
BUILTINS['halt_error/0'] = (_r, _a, i) => { throw new JqError(tostr(i)); };
BUILTINS['walk/1'] = function* (r, args, input, env) {
  const walk = function* (v: J): Gen<J> {
    r.tick();
    let inner: J = v;
    if (Array.isArray(v)) { const out: J[] = []; for (const x of v) for (const y of walk(x)) push(out, y); inner = out; }
    else if (isObj(v)) { const o = newObj(); for (const k of Object.keys(v)) for (const y of walk(v[k])) { put(o, k, y); break; } inner = o; }
    yield* r.ev(args[0], inner, env);
  };
  yield* walk(input);
};
BUILTINS['ltrimstr/1'] = function* (r, args, input, env) { for (const p of r.ev(args[0], input, env)) yield typeof input === 'string' && typeof p === 'string' && input.startsWith(p) ? input.slice(p.length) : input; };
BUILTINS['rtrimstr/1'] = function* (r, args, input, env) { for (const p of r.ev(args[0], input, env)) yield typeof input === 'string' && typeof p === 'string' && p !== '' && input.endsWith(p) ? input.slice(0, input.length - p.length) : input; };
BUILTINS['ascii/0'] = (_r, _a, i) => gen(String.fromCharCode(num(i, 'ascii')));
BUILTINS['input_line_number/0'] = () => gen(0);

fn0('length', (v) => lengthOf(v));
fn0('utf8bytelength', (v) => Buffer.byteLength(str(v, 'only strings have UTF-8 byte length')));
fn0('keys', (v) => {
  if (isObj(v)) return keysOf(v);
  if (Array.isArray(v)) return mapItems(v, (_x, i) => i);
  throw new JqError(`${typeOf(v)} (${show(v)}) has no keys`);
});
fn0('keys_unsorted', (v) => {
  if (isObj(v)) return Object.keys(v);
  if (Array.isArray(v)) return mapItems(v, (_x, i) => i);
  throw new JqError(`${typeOf(v)} (${show(v)}) has no keys`);
});
BUILTINS['values/0'] = function* (_r, _a, input) { if (input !== null) yield input; };
BUILTINS['nulls/0'] = function* (_r, _a, input) { if (input === null) yield input; };
for (const [name, test] of Object.entries({
  booleans: (v: J) => typeof v === 'boolean', numbers: (v: J) => typeof v === 'number', strings: (v: J) => typeof v === 'string',
  arrays: (v: J) => Array.isArray(v), objects: (v: J) => isObj(v), iterables: (v: J) => typeof v === 'object' && v !== null,
  scalars: (v: J) => typeof v !== 'object' || v === null,
})) BUILTINS[`${name}/0`] = function* (_r, _a, input) { if (test(input)) yield input; };
fn0('type', (v) => typeOf(v));
fn0('reverse', (v) => (typeof v === 'string' ? join(chars(v).reverse(), '') : v === null ? [] : collect(arr(v, 'cannot be reversed, as it is not an array')).reverse()));
fn0('sort', (v) => collect(arr(v, 'cannot be sorted, as it is not an array')).sort(jqCompare));
fn0('unique', (v) => mapItems(groupKeyed(arr(v, 'cannot be sorted, as it is not an array'), v as J[]), (g) => g[0]));
fn0('min', (v) => { const a = arr(v, 'cannot be iterated over'); return a.length ? a.reduce((m, x) => (jqCompare(x, m) < 0 ? x : m)) : null; });
fn0('max', (v) => { const a = arr(v, 'cannot be iterated over'); return a.length ? a.reduce((m, x) => (jqCompare(x, m) >= 0 ? x : m)) : null; });
fn0('flatten', (v) => flatten(arr(v, 'cannot be flattened'), 1e9));
fn1('flatten', (v, d) => flatten(arr(v, 'cannot be flattened'), num(d, 'flatten')));
fn0('floor', (v) => Math.floor(num(v, 'floor')));
fn0('ceil', (v) => Math.ceil(num(v, 'ceil')));
fn0('round', (v) => { const n = num(v, 'round'); return n < 0 ? -Math.round(-n) : Math.round(n); });
fn0('sqrt', (v) => Math.sqrt(num(v, 'sqrt')));
fn0('fabs', (v) => Math.abs(num(v, 'fabs')));
fn0('abs', (v) => { const n = num(v, 'abs'); return n < 0 ? -n : n; });
fn0('log', (v) => Math.log(num(v, 'log')));
fn0('log2', (v) => Math.log2(num(v, 'log2')));
fn0('log10', (v) => Math.log10(num(v, 'log10')));
fn0('exp', (v) => Math.exp(num(v, 'exp')));
fn0('trunc', (v) => Math.trunc(num(v, 'trunc')));
fn2('pow', (_v, a, b) => Math.pow(num(a, 'pow'), num(b, 'pow')));
BUILTINS['pow/2'] = function* (r, args, input, env) { for (const b of r.ev(args[1], input, env)) for (const a of r.ev(args[0], input, env)) yield Math.pow(num(a, 'pow'), num(b, 'pow')); };
fn0('tostring', (v) => tostr(v));
fn0('tonumber', toNumber);
fn0('tojson', (v) => toJson(v));
fn0('fromjson', (v) => {
  const s = str(v, 'only strings can be parsed');
  try { return parseJsonBounded(s); } catch (e) {
    rethrowExecutionRefusal(e); throw new JqError(`${(e as Error).message} (while parsing '${s}')`); }
});
fn0('ascii_downcase', (v) => str(v, 'cannot be lowercased, as it is not a string').replace(/[A-Z]/g, (c) => c.toLowerCase()));
fn0('ascii_upcase', (v) => str(v, 'cannot be uppercased, as it is not a string').replace(/[a-z]/g, (c) => c.toUpperCase()));
fn0('explode', (v) => mapItems(chars(str(v, 'cannot be exploded')), (c) => c.codePointAt(0)!));
fn0('implode', (v) => join(mapItems(arr(v, 'cannot be imploded'), (c) => String.fromCodePoint(num(c, 'implode'))), ''));
fn0('trim', (v) => str(v, 'cannot be trimmed').trim());
fn0('ltrim', (v) => str(v, 'cannot be trimmed').trimStart());
fn0('rtrim', (v) => str(v, 'cannot be trimmed').trimEnd());
fn0('infinite', () => Number.MAX_VALUE * 2);
fn0('nan', () => NaN);
fn0('isinfinite', (v) => num(v, 'isinfinite') === Infinity || v === -Infinity);
fn0('isnan', (v) => Number.isNaN(num(v, 'isnan')));
fn0('isnormal', (v) => { const n = num(v, 'isnormal'); return Number.isFinite(n) && n !== 0 && Math.abs(n) >= 2.2250738585072014e-308; });
fn0('transpose', (v) => {
  const rows = arr(v, 'cannot be transposed');
  const width = rows.reduce((m: number, r) => Math.max(m, (Array.isArray(r) ? r : []).length), 0);
  workBudget()?.nodes(width * (rows.length + 1));
  return Array.from({ length: width }, (_x, i) => rows.map((r) => (Array.isArray(r) && i < r.length ? r[i] : null)));
});
fn0('input_filename', () => null);
fn0('now', () => Date.now() / 1000);
fn0('first', (v) => indexValue(v, 0));
fn0('last', (v) => indexValue(v, -1));
fn1('nth', (v, n) => indexValue(v, num(n, 'nth')));
fn1('has', (v, k) => {
  if (isObj(v) && typeof k === 'string') return has(v, k);
  if (Array.isArray(v) && typeof k === 'number') return k >= 0 && k < v.length;
  throw new JqError(`Cannot check whether ${typeOf(v)} has a ${typeof k === 'string' ? 'string' : typeOf(k)} key`);
});
fn1('in', (v, o) => {
  if (isObj(o) && typeof v === 'string') return has(o, v);
  if (Array.isArray(o) && typeof v === 'number') return v >= 0 && v < o.length;
  throw new JqError(`Cannot check whether ${typeOf(o)} has a ${typeOf(v)} key`);
});
fn1('contains', (v, b) => containsV(v, b));
fn1('inside', (v, b) => containsV(b, v));
fn1('startswith', (v, p) => { if (typeof v !== 'string' || typeof p !== 'string') throw new JqError('startswith() requires string inputs'); return v.startsWith(p); });
fn1('endswith', (v, p) => { if (typeof v !== 'string' || typeof p !== 'string') throw new JqError('endswith() requires string inputs'); return v.endsWith(p); });
fn1('split', (v, sep) => {
  if (typeof v !== 'string' || typeof sep !== 'string') throw new JqError('split input and separator must be strings');
  return splitString(v, sep);
});
fn2('split', (v, re, flags) => guardedSplit(regexOf(re, flags), str(v, 'cannot be matched, as it is not a string')));
fn1('join', (v, sep) => {
  const a = arr(v, 'cannot be iterated over');
  const s = str(sep, 'is not a valid separator');
  return join(mapItems(a, (x) => (x === null ? '' : typeof x === 'string' ? x : typeof x === 'number' || typeof x === 'boolean' ? toJson(x) : (() => { throw new JqError(`${typeOf(x)} (${show(x)}) and string cannot be added`); })())), s);
});
fn1('test', (v, re) => guardedTest(regexOf(Array.isArray(re) ? re[0] : re, Array.isArray(re) ? re[1] : null), str(v, 'cannot be matched, as it is not a string')));
fn2('test', (v, re, flags) => guardedTest(regexOf(re, flags), str(v, 'cannot be matched, as it is not a string')));
fn2('sub', (v, re, rep) => guardedReplace(regexOf(re, null), str(v, 'cannot be matched, as it is not a string'), str(rep, 'is not a string').replace(/\$/g, '$$$$')));
fn2('gsub', (v, re, rep) => guardedReplace(regexOf(re, 'g'), str(v, 'cannot be matched, as it is not a string'), str(rep, 'is not a string').replace(/\$/g, '$$$$')));
BUILTINS['sub/3'] = function* (r, args, input, env) {
  for (const f of r.ev(args[2], input, env)) for (const rep of r.ev(args[1], input, env)) for (const re of r.ev(args[0], input, env)) {
    yield guardedReplace(regexOf(re, f), str(input, 'cannot be matched, as it is not a string'), str(rep, 'is not a string').replace(/\$/g, '$$$$'));
  }
};
BUILTINS['gsub/3'] = function* (r, args, input, env) {
  for (const f of r.ev(args[2], input, env)) for (const rep of r.ev(args[1], input, env)) for (const re of r.ev(args[0], input, env)) {
    yield guardedReplace(regexOf(re, `${typeof f === 'string' ? f : ''}g`), str(input, 'cannot be matched, as it is not a string'), str(rep, 'is not a string').replace(/\$/g, '$$$$'));
  }
};
fn1('index', (v, s) => {
  if (v === null) return null;
  if (typeof v === 'string' && typeof s === 'string') { const i = v.indexOf(s); return i < 0 ? null : chars(v.slice(0, i)).length; }
  const r = indexValue(v, s);
  return Array.isArray(r) ? (r.length ? r[0] : null) : r;
});
fn1('rindex', (v, s) => {
  if (v === null) return null;
  if (typeof v === 'string' && typeof s === 'string') { const i = v.lastIndexOf(s); return i < 0 ? null : chars(v.slice(0, i)).length; }
  const r = indexValue(v, s);
  return Array.isArray(r) ? (r.length ? r[r.length - 1] : null) : r;
});
fn1('indices', (v, s) => {
  if (v === null) return null;
  if (typeof v === 'string' && typeof s === 'string') {
    if (s === '') return null;
    const out: number[] = [];
    for (let i = v.indexOf(s); i >= 0; i = v.indexOf(s, i + 1)) push(out, chars(v.slice(0, i)).length);
    return out;
  }
  if (Array.isArray(v)) return Array.isArray(s) ? indicesOf(v, s) : filterItems(mapItems(v, (x, i) => (jqCompare(x, s) === 0 ? i : -1)), (i) => i >= 0);
  throw new JqError(`Cannot determine indices of ${typeOf(s)} in ${typeOf(v)}`);
});
BUILTINS['todate/0'] = (_r, _a, i) => gen(new Date(num(i, 'todate') * 1000).toISOString().replace(/\.\d+Z$/, 'Z'));
BUILTINS['fromdate/0'] = (_r, _a, i) => {
  const s = str(i, 'cannot be parsed as a date');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s)) throw new JqError(`date "${s}" does not match format "%Y-%m-%dT%H:%M:%SZ"`);
  return gen(Date.parse(s) / 1000);
};
BUILTINS['fromdateiso8601/0'] = BUILTINS['fromdate/0'];
BUILTINS['todateiso8601/0'] = BUILTINS['todate/0'];
BUILTINS['combinations/0'] = function* (r, _a, input) {
  const rows = mapItems(arr(input, 'cannot be iterated over'), (x) => arr(x, 'cannot be iterated over'));
  const walk = function* (at: number, acc: J[]): Gen<J> {
    r.tick();
    if (at === rows.length) { yield acc; return; }
    for (const x of rows[at]) yield* walk(at + 1, [...acc, x]);
  };
  yield* walk(0, []);
};
BUILTINS['isempty/1'] = function* (r, args, input, env) { for (const _x of r.ev(args[0], input, env)) { yield false; return; } yield true; };
BUILTINS['halt/0'] = () => { throw new JqError('halt'); };

// ---- entry points

export interface JqOptions { compact?: boolean; raw?: boolean; join?: boolean }

/** Runs a filter over JSON text and gives each output as jq prints it, one per line, with no newline after the last (inferred: the BaseElements reference does not say). Throws JqError for anything it cannot do. */
export function runJq(jsonText: string, filter: string, options: JqOptions = {}): string {
  return withWorkBudget(() => {
    try {
      if (filter.length > MAX_FILTER) throw resourceError(new JqError('the filter is too long'));
      let input: J;
      try { input = parseJsonBounded(jsonText); } catch (e) {
        rethrowExecutionRefusal(e); throw new JqError(`${(e as Error).message} (while parsing the input)`); }
      const ast = new Parser(lex(filter)).parseProgram();
      const run = new Run();
      const outputs: string[] = [];
      let count = 0;
      try {
        for (const v of run.ev(ast, input, new Env(null))) {
          if (++count > MAX_OUTPUTS) throw resourceError(new JqError('the filter gave too many results'));
          const raw = options.raw && typeof v === 'string';
          workBudget()?.output((raw ? v.length : jsonSize(v, !options.compact)) + (count > 1 && !options.join ? 1 : 0));
          push(outputs, raw ? v : options.compact ? toJson(v) : prettyJson(v));
        }
      } catch (e) {
        rethrowExecutionRefusal(e);
        if (e instanceof RangeError) throw resourceError(new JqError('the filter nests too deeply'));
        throw e;
      }
      return join(outputs, options.join ? '' : '\n');
    } catch (e) {
      if (e instanceof ResourceLimitError) throw resourceError(new JqError(e.message));
      rethrowExecutionRefusal(e);
      throw e;
    }
  });
}
function prettyJson(v: J): string {
  workBudget()?.text(jsonSize(v, true));
  return JSON.stringify(v, (_k, x: unknown) => (typeof x === 'number' && !Number.isFinite(x) ? (Number.isNaN(x) ? null : x > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE) : x), 2)!;
}
