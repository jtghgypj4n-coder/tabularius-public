// JSONPath for MBS ( "JSON.Query" ), JSON.Replace and JSON.ReplaceEvaluate. MBS uses the JsonCons.Net engine, whose
// own notes are the grammar; MBS's pages show only part of it, so this is that part:
//   $  @           the document, and the node a filter is looking at
//   .name  .*  ..name  ..*  ..[ ... ]     children, all children, and the same through every descendant
//   [ 'name' ]  [ 0 ]  [ -1 ]  [ * ]  [ a:b:c ]  [ one , two ]     names, indexes, a slice, a union
//   [ ?( expr ) ]  filters: == != < <= > >=  =~ /regex/flags  &&  ||  !  ( )  and the functions contains and keys
//   [ @.path ]  [ $.path ]     the values that path finds are the selection (the MBS page's `$.store[@.book[...].title]`)
//   keys( ... )[*]     a function call as the start of a path
// Anything else is an MbsError, not a guess. Work is capped (nodes visited, matches, nesting) and regular expressions
// run under the time limit in regex-guard.ts, because the path comes from a formula.

import { MbsError } from './mbs-text.ts';
import { assertPatternNesting, guardedTest } from './regex-guard.ts';
import type { Json } from './mbs-json.ts';

export type Step = string | number;
/** A value found, and where it is in the document: null when it came out of a function (keys), not out of the document. */
export interface Match { path: Step[] | null; node: Json }

/** A found value while the query runs: each carries the one before it and the step taken, so a path is built only for the matches kept. */
interface Cur { node: Json; up?: Cur; step?: Step; free?: boolean }
const pathOf = (c: Cur): Step[] | null => {
  const out: Step[] = [];
  for (let x: Cur | undefined = c; x; x = x.up) {
    if (x.free) return null;
    if (x.step !== undefined) out.push(x.step);
  }
  return out.reverse();
};

const MAX_NODES = 2_000_000;
const MAX_MATCHES = 200_000;
const MAX_NEST = 64;
const MAX_LENGTH = 10_000;
/** The longest a query may run, however it spends the time. */
const MAX_MS = 3000;

type Selector =
  | { k: 'name'; name: string }
  | { k: 'index'; i: number }
  | { k: 'wild' }
  | { k: 'slice'; start?: number; end?: number; step?: number }
  | { k: 'filter'; e: Expr }
  | { k: 'path'; p: PathExpr };
interface Segment { desc: boolean; sels: Selector[] }
interface PathExpr { root: '$' | '@' | Call; segs: Segment[] }
interface Call { name: 'contains' | 'keys'; args: Operand[] }
type Operand = { k: 'lit'; v: Json } | { k: 'path'; p: PathExpr } | { k: 'regex'; re: RegExp };
type Expr =
  | { k: 'or' | 'and'; a: Expr; b: Expr }
  | { k: 'not'; a: Expr }
  | { k: 'cmp'; op: string; a: Operand; b: Operand }
  | { k: 'test'; a: Operand };

// --- reading the path -------------------------------------------------------------------------

const fail = (what: string): never => {
  throw new MbsError(`JSONPath: ${what}`);
};

function parse(src: string): PathExpr {
  if (src.length > MAX_LENGTH) fail('the path is too long');
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const peek = (s: string) => src.startsWith(s, i);
  const eat = (s: string) => {
    ws();
    if (!peek(s)) fail(`expected "${s}" at offset ${i}`);
    i += s.length;
  };
  const nameChars = /[^\s.[\]()=<>!&|,?:'"*@$/+-]/;

  const stringLiteral = (): string => {
    const q = src[i++];
    let out = '';
    for (;;) {
      if (i >= src.length) fail('a string is not closed');
      const c = src[i++];
      if (c === q) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = src[i++];
      if (e === 'u') {
        const hex = src.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('a \\u escape needs four hex digits');
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[e] ?? e ?? '';
    }
  };

  const intAt = (): number | undefined => {
    const m = /^-?\d+/.exec(src.slice(i));
    if (!m) return undefined;
    i += m[0].length;
    const n = Number(m[0]);
    if (!Number.isSafeInteger(n)) fail('an index is too large');
    return n;
  };

  const path = (depth: number): PathExpr => {
    if (depth > MAX_NEST) fail('the path is nested too deeply');
    ws();
    let root: PathExpr['root'];
    if (src[i] === '$' || src[i] === '@') root = src[i++] as '$' | '@';
    else {
      const m = /^[A-Za-z_]+(?=\s*\()/.exec(src.slice(i));
      if (!m) return fail(`a path starts with $, @ or a function at offset ${i}`);
      root = call(depth);
    }
    const segs: Segment[] = [];
    for (;;) {
      if (peek('..')) {
        i += 2;
        if (src[i] === '[') segs.push({ desc: true, sels: bracket(depth) });
        else if (src[i] === '*') (i++, segs.push({ desc: true, sels: [{ k: 'wild' }] }));
        else segs.push({ desc: true, sels: [{ k: 'name', name: bare() }] });
      } else if (peek('.')) {
        i++;
        if (src[i] === '*') (i++, segs.push({ desc: false, sels: [{ k: 'wild' }] }));
        else segs.push({ desc: false, sels: [{ k: 'name', name: bare() }] });
      } else if (peek('[')) segs.push({ desc: false, sels: bracket(depth) });
      else return { root, segs };
    }
  };
  const bare = (): string => {
    const start = i;
    while (i < src.length && nameChars.test(src[i])) i++;
    if (i === start) fail(`a name was expected at offset ${i}`);
    return src.slice(start, i);
  };

  const call = (depth: number): Call => {
    const word = /^[A-Za-z_]+/.exec(src.slice(i))![0];
    i += word.length;
    if (word !== 'contains' && word !== 'keys') return fail(`the function ${word} isn't available`);
    const name: Call['name'] = word;
    eat('(');
    const args: Operand[] = [];
    ws();
    if (!peek(')')) {
      for (;;) {
        args.push(operand(depth + 1));
        ws();
        if (peek(',')) i++;
        else break;
      }
    }
    eat(')');
    if (args.length !== (name === 'contains' ? 2 : 1)) fail(`${name} takes ${name === 'contains' ? 2 : 1} parameter${name === 'contains' ? 's' : ''}`);
    return { name, args };
  };

  const bracket = (depth: number): Selector[] => {
    eat('[');
    const sels: Selector[] = [];
    for (;;) {
      ws();
      const c = src[i];
      if (c === '?') {
        i++;
        sels.push({ k: 'filter', e: expr(depth + 1) });
      } else if (c === "'" || c === '"') sels.push({ k: 'name', name: stringLiteral() });
      else if (c === '*') (i++, sels.push({ k: 'wild' }));
      else if (c === '@' || c === '$' || /[A-Za-z_]/.test(c ?? '')) sels.push({ k: 'path', p: path(depth + 1) });
      else if (c === ':' || c === '-' || /\d/.test(c ?? '')) {
        const first = intAt();
        ws();
        if (peek(':')) {
          i++;
          ws();
          const end = intAt();
          ws();
          let step: number | undefined;
          if (peek(':')) {
            i++;
            ws();
            step = intAt();
          }
          sels.push({ k: 'slice', ...(first !== undefined ? { start: first } : {}), ...(end !== undefined ? { end } : {}), ...(step !== undefined ? { step } : {}) });
        } else if (first === undefined) return fail(`an index was expected at offset ${i}`);
        else sels.push({ k: 'index', i: first });
      } else return fail(`unexpected "${c ?? 'end'}" in [ ] at offset ${i}`);
      ws();
      if (peek(',')) {
        i++;
        continue;
      }
      eat(']');
      return sels;
    }
  };

  // Filter expressions: || binds loosest, then &&, then !, then a comparison or a test.
  const expr = (depth: number): Expr => {
    if (depth > MAX_NEST) fail('the filter is nested too deeply');
    let left = and(depth);
    for (;;) {
      ws();
      if (!peek('||')) return left;
      i += 2;
      left = { k: 'or', a: left, b: and(depth) };
    }
  };
  const and = (depth: number): Expr => {
    let left = not(depth);
    for (;;) {
      ws();
      if (!peek('&&')) return left;
      i += 2;
      left = { k: 'and', a: left, b: not(depth) };
    }
  };
  const not = (depth: number): Expr => {
    if (depth > MAX_NEST) fail('the filter is nested too deeply');
    ws();
    if (src[i] === '!' && src[i + 1] !== '=') {
      i++;
      return { k: 'not', a: not(depth + 1) };
    }
    if (src[i] === '(') {
      // A parenthesised filter, unless it starts a comparison's left side (which only a literal or a path can).
      i++;
      const e = expr(depth + 1);
      eat(')');
      return e;
    }
    const a = operand(depth + 1);
    ws();
    const op = /^(==|!=|<=|>=|=~|<|>)/.exec(src.slice(i))?.[1];
    if (!op) return { k: 'test', a };
    i += op.length;
    ws();
    const b = op === '=~' ? regex() : operand(depth + 1);
    return { k: 'cmp', op, a, b };
  };
  const regex = (): Operand => {
    ws();
    if (src[i] !== '/') return fail(`a /regular expression/ was expected at offset ${i}`);
    i++;
    let pattern = '';
    for (;;) {
      if (i >= src.length) fail('a regular expression is not closed');
      const c = src[i++];
      if (c === '/') break;
      if (c === '\\' && i < src.length) pattern += c + src[i++];
      else pattern += c;
    }
    const flags = /^[ims]*/.exec(src.slice(i))![0];
    i += flags.length;
    try {
      assertPatternNesting(pattern);
      return { k: 'regex', re: new RegExp(pattern, flags) };
    } catch {
      return fail('the regular expression is not valid');
    }
  };
  const operand = (depth: number): Operand => {
    ws();
    const c = src[i];
    if (c === "'" || c === '"') return { k: 'lit', v: { t: 'str', v: stringLiteral() } };
    const num = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return { k: 'lit', v: { t: 'num', raw: num[0] } };
    }
    for (const [word, v] of [['true', { t: 'bool', v: true }], ['false', { t: 'bool', v: false }], ['null', { t: 'null' }]] as [string, Json][]) {
      if (peek(word) && !nameChars.test(src[i + word.length] ?? ' ')) {
        i += word.length;
        return { k: 'lit', v };
      }
    }
    return { k: 'path', p: path(depth) };
  };

  const result = path(0);
  ws();
  if (i < src.length) fail(`unexpected "${src[i]}" at offset ${i}`);
  return result;
}

// --- running it --------------------------------------------------------------------------------

class Run {
  visited = 0;
  matches = 0;
  readonly root: Json;
  private readonly stop = Date.now() + MAX_MS;
  constructor(root: Json) {
    this.root = root;
  }
  /** Counts `n` more values looked at; every piece of work in a query goes through here, so none outruns the limits. */
  tick(n = 1): void {
    const before = this.visited;
    this.visited += n;
    if (this.visited > MAX_NODES) fail('the document is too large for this query');
    if (this.visited >> 12 !== before >> 12 && Date.now() > this.stop) fail('the query took too long');
  }

  equal(a: Json, b: Json): boolean {
    this.tick();
    if (a.t !== b.t) return false;
    switch (a.t) {
      case 'null': return true;
      case 'bool': return a.v === (b as typeof a).v;
      case 'num': return Number(a.raw) === Number((b as typeof a).raw);
      case 'str': return a.v === (b as typeof a).v;
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

  children(m: Cur): Cur[] {
    const n = m.node;
    if (n.t === 'arr') {
      this.tick(n.items.length);
      return n.items.map((x, k) => ({ node: x, up: m, step: k }));
    }
    if (n.t === 'obj') {
      this.tick(n.entries.length);
      return n.entries.map(([k, x]) => ({ node: x, up: m, step: k }));
    }
    return [];
  }
  /** The node and everything below it, parents first. */
  descend(m: Cur): Cur[] {
    const out: Cur[] = [];
    const walk = (x: Cur) => {
      this.tick();
      out.push(x);
      for (const c of this.children(x)) walk(c);
    };
    walk(m);
    return out;
  }

  select(m: Cur, sel: Selector): Cur[] {
    this.tick();
    const n = m.node;
    switch (sel.k) {
      case 'name': {
        if (n.t !== 'obj') return [];
        this.tick(n.entries.length);
        const hit = n.entries.find(([k]) => k === sel.name);
        return hit ? [{ node: hit[1], up: m, step: sel.name }] : [];
      }
      case 'index': {
        if (n.t !== 'arr') return [];
        const at = sel.i < 0 ? n.items.length + sel.i : sel.i;
        return at >= 0 && at < n.items.length ? [{ node: n.items[at], up: m, step: at }] : [];
      }
      case 'wild': return this.children(m);
      case 'slice': {
        if (n.t !== 'arr') return [];
        const len = n.items.length;
        const step = sel.step ?? 1;
        if (step === 0) return [];
        const norm = (v: number) => (v < 0 ? len + v : v);
        const out: Cur[] = [];
        if (step > 0) {
          const from = Math.min(len, Math.max(0, norm(sel.start ?? 0)));
          const to = Math.min(len, Math.max(0, norm(sel.end ?? len)));
          for (let k = from; k < to; k += step) out.push({ node: n.items[k], up: m, step: k });
        } else {
          const from = Math.min(len - 1, Math.max(-1, sel.start === undefined ? len - 1 : norm(sel.start)));
          const to = Math.min(len - 1, Math.max(-1, sel.end === undefined ? -1 : norm(sel.end)));
          for (let k = from; k > to; k += step) out.push({ node: n.items[k], up: m, step: k });
        }
        return out;
      }
      case 'filter': return this.children(m).filter((c) => this.truth(sel.e, c));
      case 'path': return this.path(sel.p, m);
    }
  }

  /** A path's matches, `@` being `at` (the node a filter looks at, or the one a [ @… ] selection sits in). */
  path(p: PathExpr, at: Cur): Cur[] {
    let now: Cur[];
    if (p.root === '$') now = [{ node: this.root }];
    else if (p.root === '@') now = [at];
    else {
      const v = this.call(p.root, at);
      now = v ? [{ node: v, free: true }] : [];
    }
    for (const seg of p.segs) {
      const next: Cur[] = [];
      for (const m of now) {
        for (const base of seg.desc ? this.descend(m) : [m]) {
          for (const sel of seg.sels) {
            for (const hit of this.select(base, sel)) {
              if (++this.matches > MAX_MATCHES) fail('the query found too many values');
              next.push(hit);
            }
          }
        }
      }
      now = next;
    }
    return now;
  }

  /** An operand's single value, or nothing: a path that finds exactly one thing is that thing. */
  value(o: Operand, current: Cur): Json | undefined {
    if (o.k === 'lit') return o.v;
    if (o.k === 'regex') return undefined;
    const found = this.path(o.p, current);
    return found.length === 1 ? found[0].node : undefined;
  }

  call(c: Call, current: Cur): Json | undefined {
    const args = c.args.map((a) => this.value(a, current));
    if (c.name === 'keys') {
      const o = args[0];
      if (o?.t === 'obj') this.tick(o.entries.length);
      return o?.t === 'obj' ? { t: 'arr', items: o.entries.map(([k]) => ({ t: 'str', v: k }) as Json) } : undefined;
    }
    const [a, b] = args;
    if (!a || !b) return { t: 'bool', v: false };
    if (a.t === 'str' && b.t === 'str') return { t: 'bool', v: a.v.includes(b.v) };
    if (a.t === 'arr') return { t: 'bool', v: a.items.some((x) => this.equal(x, b)) };
    return { t: 'bool', v: false };
  }

  truth(e: Expr, current: Cur): boolean {
    switch (e.k) {
      case 'or': return this.truth(e.a, current) || this.truth(e.b, current);
      case 'and': return this.truth(e.a, current) && this.truth(e.b, current);
      case 'not': return !this.truth(e.a, current);
      case 'test': {
        // A path is true when it finds something; a function call alone (contains) is true when it gives true.
        if (e.a.k === 'path' && (typeof e.a.p.root === 'string' || e.a.p.segs.length)) return this.path(e.a.p, current).length > 0;
        const v = this.value(e.a, current);
        return v?.t === 'bool' ? v.v : v !== undefined && v.t !== 'null';
      }
      case 'cmp': {
        const a = this.value(e.a, current);
        if (e.op === '=~') {
          const re = e.b.k === 'regex' ? e.b.re : undefined;
          return !!re && a?.t === 'str' && guardedTest(re, a.v);
        }
        const b = this.value(e.b, current);
        if (e.op === '==') return a === undefined || b === undefined ? a === b : this.equal(a, b);
        if (e.op === '!=') return !(a === undefined || b === undefined ? a === b : this.equal(a, b));
        if (a?.t === 'num' && b?.t === 'num') return order(e.op, Number(a.raw), Number(b.raw));
        if (a?.t === 'str' && b?.t === 'str') return order(e.op, a.v < b.v ? -1 : a.v > b.v ? 1 : 0, 0);
        return false;
      }
    }
  }
}

const order = (op: string, a: number, b: number) => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b);

/** Everything a JSONPath finds in a document, in order, with where each was. */
export function jsonPathMatches(doc: Json, path: string, withPaths = true): Match[] {
  const p = parse(path);
  const run = new Run(doc);
  // A caller that only wants the values (Query) skips building every path, which costs a path's length per match.
  return run.path(p, { node: doc }).map((c) => ({ path: withPaths ? pathOf(c) : null, node: c.node }));
}

/**
 * The document with the node at each path replaced. A match with no place in the document (it came out of keys()) is
 * left alone, and so is one inside an earlier match: the value put there is not searched.
 */
export function replaceAt(doc: Json, matches: Match[], make: (m: Match) => Json | undefined): Json {
  let root = doc;
  // Paths already replaced, as a trie: a match is inside an earlier one when its walk down meets a replaced node.
  interface Trie { done?: boolean; next?: Map<Step, Trie> }
  const replaced: Trie = {};
  // Where each key of an object is, built once per object (replacing a value never moves a key).
  const keyAt = new WeakMap<object, Map<string, [string, Json]>>();
  const entryOf = (o: Json & { t: 'obj' }, key: string): [string, Json] | undefined => {
    let index = keyAt.get(o);
    if (!index) {
      index = new Map();
      for (const e of o.entries) if (!index.has(e[0])) index.set(e[0], e);
      keyAt.set(o, index);
    }
    return index.get(key);
  };
  for (const m of matches) {
    const where = m.path;
    if (!where) continue;
    let at = replaced;
    let inside = !!at.done;
    for (const step of where) {
      if (inside) break;
      at = at.next?.get(step) ?? {};
      inside = !!at.done;
    }
    if (inside) continue;
    const next = make(m);
    if (next === undefined) continue;
    let node = replaced;
    for (const step of where) {
      node.next ??= new Map();
      let child = node.next.get(step);
      if (!child) node.next.set(step, (child = {}));
      node = child;
    }
    node.done = true;
    if (!where.length) {
      root = next;
      continue;
    }
    let parent: Json | undefined = root;
    for (const step of where.slice(0, -1)) {
      parent = parent?.t === 'arr' && typeof step === 'number' ? parent.items[step] : parent?.t === 'obj' ? entryOf(parent, step as string)?.[1] : undefined;
    }
    const last = where[where.length - 1];
    if (parent?.t === 'arr' && typeof last === 'number' && last < parent.items.length) parent.items[last] = next;
    else if (parent?.t === 'obj') {
      const e = entryOf(parent, last as string);
      if (e) e[1] = next;
    }
  }
  return root;
}
