// Parser for FileMaker calculation text, as FileMaker shows it in the
// Specify Calculation dialog and the Database Design Report.
//
// Field and table occurrence names may contain spaces and operator
// characters, so the lexer matches them against the names it is given
// (longest match wins), the way FileMaker resolves them. Without names, a
// field is a single word.

import { CalcError, CalcNestingError, ERR, exactIntegerText } from './values.ts';
import { nodeChildren, unknownFunctionId } from './unknown.ts';

const MISSING = /^<(Field|Table|Function) Missing>/;
/** A name the file decoder could not resolve, preserved verbatim for reporting. */
const UNDECODED = /^⟨[^⟩\s]+⟩/;
const PLUGIN_ID_ONLY = /^<plugin:[\x21-\x7e]{4}:\d+>/i;

export interface CalcNames {
  /** Field names of the context table, as written unqualified. */
  fields?: Iterable<string>;
  /** Table occurrence name -> its field names, for TO::Field references. */
  occurrences?: Iterable<[string, Iterable<string>]>;
}

/** A Let name and its value; a $variable's repetition, when not a plain number, is an expression. */
export type Binding = [name: string, value: Node, repetition?: Node];

export type Node =
  | { k: 'num'; value: number; exact?: bigint; raw?: string }
  | { k: 'str'; value: string }
  | { k: 'field'; occurrence?: string; name: string; rep?: Node }
  | { k: 'var'; name: string; rep?: Node }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'get'; param: string }
  | { k: 'let'; binds: Binding[]; body: Node }
  | { k: 'unary'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node };

type Token =
  | { t: 'num'; v: number; at: number; exact?: bigint; raw?: string }
  | { t: 'str'; v: string; at: number }
  | { t: 'word'; v: string; at: number }
  | { t: 'field'; to?: string; v: string; at: number }
  | { t: 'op'; v: string; at: number }
  | { t: 'end'; v: ''; at: number };

const DELIMS = new Set([...' \t\r\n ()[];,"+-*/^&=≠<>≤≥¶:']);
const isWordChar = (c: string | undefined) => c !== undefined && !DELIMS.has(c);

/** Names sorted longest first, with a lower-cased copy for case-insensitive matching. */
class NameSet {
  readonly list: { name: string; lower: string }[];
  constructor(names: Iterable<string>) {
    this.list = [...new Set(names)].filter((n) => n.length).map((name) => ({ name, lower: name.toLowerCase() }))
      .sort((a, b) => b.name.length - a.name.length);
  }
  /** Longest name at src[at] that ends on a word boundary (or before `follow`, when given). */
  match(src: string, lowerSrc: string, at: number, follow?: string): string | undefined {
    for (const { name, lower } of this.list) {
      if (!lowerSrc.startsWith(lower, at)) continue;
      const end = at + lower.length;
      if (follow ? src.startsWith(follow, end) : !isWordChar(src[end]) || !isWordChar(src[end - 1])) return name;
    }
    return undefined;
  }
}

/** Name tables built once per schema context and reused across formulas. */
export class NameTable {
  readonly fields: NameSet;
  readonly occurrences: NameSet;
  private readonly toFields = new Map<string, NameSet>();
  constructor(names: CalcNames = {}) {
    this.fields = new NameSet(names.fields ?? []);
    const tos: string[] = [];
    for (const [to, fields] of names.occurrences ?? []) {
      tos.push(to);
      this.toFields.set(to.toLowerCase(), new NameSet(fields));
    }
    this.occurrences = new NameSet(tos);
  }
  fieldsOf(to: string): NameSet | undefined {
    return this.toFields.get(to.toLowerCase());
  }
}

/** src with text constants and comments blanked out, offsets kept. */
function code(src: string): string {
  return src.replace(/"(?:\\.|[^"\\])*"?|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*/g, (m) => m.replace(/[^\r\n]/g, ' '));
}

/**
 * Let and While names with spaces ("right word = ..."), which FileMaker
 * accepts: a name of several words directly before "=" at the start of a
 * binding.
 */
function spacedLetNames(src: string): string[] {
  const out: string[] = [];
  const source = code(src);
  // Scan each candidate once. A lazy unbounded regex backtracks through long
  // runs of spaces or blanked comments when there is no following "=".
  const first = /[^\s\[\]();"=+\-*/^&≠<>≤≥¶:$]/;
  const rest = /[^\[\]();"=+\-*/^&≠<>≤≥¶:\r\n]/;
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '[' && source[i] !== ';' && source[i] !== '(') continue;
    let start = i + 1;
    while (start < source.length && /\s/.test(source[start])) start++;
    if (!first.test(source[start] ?? '')) continue;
    let end = start + 1;
    while (end < source.length && rest.test(source[end])) end++;
    // The old grammar permits whitespace, including a newline, before "=".
    let equals = end;
    while (equals < source.length && /\s/.test(source[equals])) equals++;
    if (source[equals] !== '=') continue;
    const words = source.slice(start, end).trim().split(/[ \t]+/);
    if (words.length > 1 && !words.some((w) => /^(and|or|xor|not)$/i.test(w))) out.push(words.join(' '));
  }
  return out;
}

function lex(src: string, names: NameTable, localNames: Iterable<string> = []): Token[] {
  const out: Token[] = [];
  const lower = src.toLowerCase();
  // Names with spaces bound inside the formula, or a custom function's parameters.
  const locals = new NameSet([...spacedLetNames(src), ...localNames].filter((n) => /\s/.test(n)));
  let i = 0;
  const word = (at: number) => {
    let j = at;
    while (isWordChar(src[j])) j++;
    return src.slice(at, j);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ' ') {
      i++;
    } else if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\r' && src[i] !== '\n') i++;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new CalcError(ERR.unterminatedComment, 'The comment is not terminated with "*/"');
      // Block comments nest (FileMaker accepts "/* /* a */ b */" as one comment,
      // the usual way to comment out a formula that has comments); when the
      // nesting never closes, the first "*/" ends it.
      let depth = 0;
      let j = i;
      while (j < src.length) {
        if (src.startsWith('/*', j)) { depth++; j += 2; } else if (src.startsWith('*/', j)) {
          j += 2;
          if (--depth === 0) break;
        } else j++;
      }
      i = depth === 0 ? j : end + 2;
    } else if (c === '"') {
      let s = '';
      let j = i + 1;
      for (;;) {
        if (j >= src.length) throw new CalcError(ERR.unterminatedText, 'A text constant must end with a quotation mark');
        const ch = src[j];
        if (ch === '"') break;
        if (ch === '\\' && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
          continue;
        }
        s += ch === '¶' ? '\r' : ch === '\n' ? '\r' : ch;
        j++;
      }
      out.push({ t: 'str', v: s, at: i });
      i = j + 1;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      // A whole number of more than 15 digits keeps every digit (values.ts: exactIntegerText).
      const exact = exactIntegerText(m[0]);
      const value = Number(m[0]);
      out.push({ t: 'num', v: value, at: i, ...(m[0] !== String(value) ? { raw: m[0] } : {}), ...(exact !== undefined ? { exact } : {}) });
      i += m[0].length;
    } else if (PLUGIN_ID_ONLY.test(src.slice(i, i + 64)) || UNDECODED.test(src.slice(i, i + 40))) {
      const v = (PLUGIN_ID_ONLY.exec(src.slice(i, i + 64)) ?? UNDECODED.exec(src.slice(i, i + 40)))![0];
      out.push({ t: 'word', v, at: i });
      i += v.length;
    } else if (MISSING.test(src.slice(i, i + 40))) {
      // FileMaker's markers for a deleted field, table or function. They fail
      // only when evaluated, like in FileMaker, not when the formula is read.
      const m = MISSING.exec(src.slice(i, i + 40))!;
      if (m[1] === 'Function') out.push({ t: 'word', v: m[0], at: i });
      else if (src.startsWith('::', i + m[0].length)) {
        const at = i + m[0].length + 2;
        const f = MISSING.exec(src.slice(at, at + 40))?.[0] ?? word(at);
        out.push({ t: 'field', to: m[0], v: f, at: i });
        i = at + f.length;
        continue;
      } else out.push({ t: 'field', v: m[0], at: i });
      i += m[0].length;
    } else if (src.startsWith('::', i)) {
      throw new CalcError(ERR.nameMissing, `A table name is needed before "::" at ${i + 1}`);
    } else if ('()[];,+-*/^&=≠≤≥¶'.includes(c)) {
      out.push({ t: 'op', v: c === ',' ? ';' : c, at: i });
      i++;
    } else if (c === '<' || c === '>') {
      const two = src.slice(i, i + 2);
      const op = two === '<>' || two === '<=' || two === '>=' ? two : c;
      out.push({ t: 'op', v: op, at: i });
      i += op.length;
    } else {
      // TO::Field, a known field name, or a plain word.
      const to = names.occurrences.match(src, lower, i, '::');
      if (to !== undefined) {
        const at = i + to.length + 2;
        const field = names.fieldsOf(to)?.match(src, lower, at) ?? MISSING.exec(src.slice(at, at + 40))?.[0] ?? word(at);
        if (!field) throw new CalcError(ERR.nameMissing, `A field name is needed after "${to}::"`);
        out.push({ t: 'field', to, v: field, at: i });
        i = at + field.length;
        continue;
      }
      const w = word(i);
      if (src.startsWith('::', i + w.length) && w) {
        // Not a known occurrence: take one word each side.
        const after = i + w.length + 2;
        const field = MISSING.exec(src.slice(after, after + 40))?.[0] ?? word(after);
        out.push({ t: 'field', to: w, v: field, at: i });
        i += w.length + 2 + field.length;
        continue;
      }
      const f = names.fields.match(src, lower, i);
      const local = locals.match(src, lower, i);
      if (local !== undefined && (f === undefined || local.length > f.length)) {
        out.push({ t: 'word', v: local, at: i });
        i += local.length;
        continue;
      }
      // A one-word field named like a function yields to the function when called.
      if (f !== undefined && (f.length > w.length || !/^\s*\(/.test(src.slice(i + f.length)))) {
        out.push({ t: 'field', v: f, at: i });
        i += f.length;
        continue;
      }
      if (!w) throw new CalcError(ERR.operandExpected, `Unexpected "${c}" at ${i + 1}`);
      let v = w;
      // Variable names may hold spaces: "$SSL cURL Option".
      if (w.startsWith('$')) {
        for (;;) {
          const m = /^[ \t]+/.exec(src.slice(i + v.length));
          const next = m && word(i + v.length + m[0].length);
          if (!next || /^(and|or|xor|not)$/i.test(next)) break;
          v = src.slice(i, i + v.length + m[0].length + next.length);
        }
      }
      // Custom function names may hold spaces too: "Get Original Window Name ( x )".
      // Words run together before "(" can mean nothing else.
      const call = /^(?:[ \t]+[^\s()\[\];,"+\-*/^&=≠<>≤≥¶:]+)+(?=\s*\()/.exec(src.slice(i + v.length));
      if (!w.startsWith('$') && call && !/(^|\s)(and|or|xor|not)(?=\s|$)/i.test(w + call[0]) && !/^(and|or|xor|not)$/i.test(w)) v += call[0];
      out.push({ t: 'word', v, at: i });
      i += v.length;
    }
  }
  out.push({ t: 'end', v: '', at: src.length });
  return out;
}

const BINARY: Record<string, number> = {
  or: 1, xor: 1,
  and: 2,
  '=': 4, '≠': 4, '<>': 4, '<': 4, '>': 4, '≤': 4, '<=': 4, '≥': 4, '>=': 4,
  '&': 5,
  '+': 6, '-': 6,
  '*': 7, '/': 7,
  '^': 8,
};
const NOT_PRECEDENCE = 3;
const SIGN_PRECEDENCE = 9;

const CONSTANTS: Record<string, Node> = {
  true: { k: 'num', value: 1 },
  false: { k: 'num', value: 0 },
  pi: { k: 'num', value: Math.PI, raw: 'Pi' },
};

class Parser {
  private i = 0;
  private depth = 0;
  private readonly toks: Token[];
  /** Names bound by enclosing Let / While calls; they hide fields of the same name. */
  private readonly bound: Set<string>[] = [];
  constructor(toks: Token[]) {
    this.toks = toks;
  }

  private peek(): Token {
    return this.toks[this.i];
  }
  private next(): Token {
    return this.toks[this.i++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }
  private expect(v: string): void {
    const t = this.next();
    if (t.t !== 'op' || t.v !== v) {
      if (t.t === 'end') throw new CalcError(ERR.unexpectedEnd, `"${v}" expected at the end of the calculation`);
      throw new CalcError(v === ')' ? ERR.unbalanced : ERR.operandExpected, `"${v}" expected at ${t.at + 1}`);
    }
  }

  parse(): Node {
    const n = this.expr(0);
    const t = this.peek();
    if (t.t !== 'end') {
      throw new CalcError(t.t === 'op' && t.v === ')' ? ERR.unbalanced : ERR.unknownFunction, `Operator expected at ${t.at + 1}`);
    }
    return n;
  }

  private binaryOp(): string | undefined {
    const t = this.peek();
    if (t.t === 'op' && t.v in BINARY) return t.v;
    if (t.t === 'word') {
      const w = t.v.toLowerCase();
      if (w === 'and' || w === 'or' || w === 'xor') return w;
    }
    return undefined;
  }

  expr(min: number): Node {
    let left = this.prefix();
    // Binary right operands at the same syntactic level do not increase nesting.
    for (;;) {
      const op = this.binaryOp();
      if (op === undefined || BINARY[op] <= min) break;
      this.next();
      left = { k: 'bin', op, a: left, b: this.expr(BINARY[op]) };
    }
    return left;
  }

  private nestedExpr(min: number): Node {
    // Claris does not specify a calculation nesting limit. Count actual nested
    // expressions, excluding binary parsing at the same level.
    if (this.depth >= 1000) throw new CalcNestingError(ERR.calculation, 'Calculation is nested more than 1,000 levels deep');
    this.depth++;
    try { return this.expr(min); } finally { this.depth--; }
  }

  private prefix(): Node {
    const t = this.next();
    switch (t.t) {
      case 'num': return { k: 'num', value: t.v, ...(t.raw !== undefined ? { raw: t.raw } : {}), ...(t.exact !== undefined ? { exact: t.exact } : {}) };
      case 'str': return { k: 'str', value: t.v };
      case 'field':
        if (!t.to && this.bound.some((b) => b.has(t.v.toLowerCase()))) return this.postfix({ k: 'var', name: t.v });
        return this.postfix({ k: 'field', occurrence: t.to, name: t.v });
      case 'end': throw new CalcError(ERR.unexpectedEnd, 'The calculation ends too soon');
      case 'op': {
        if (t.v === '(') {
          const n = this.nestedExpr(0);
          this.expect(')');
          return n;
        }
        if (t.v === '-' || t.v === '+') return { k: 'unary', op: t.v, a: this.nestedExpr(SIGN_PRECEDENCE) };
        if (t.v === '[') {
          // A bracketed list, as in Substitute ( text ; [ "a" ; "b" ] ; [ "c" ; "d" ] ).
          const items: Node[] = [];
          do items.push(this.nestedExpr(0));
          while (this.isOp(';') && this.next());
          this.expect(']');
          return { k: 'call', name: '[]', args: items };
        }
        if (t.v === '¶') return { k: 'str', value: '\r' };
        throw new CalcError(ERR.operandExpected, `Number, text constant, field name or "(" expected at ${t.at + 1}`);
      }
      case 'word': return this.word(t.v, t.at);
    }
  }

  private postfix(n: Node & { rep?: Node }): Node {
    if (this.isOp('[')) {
      this.next();
      n.rep = this.nestedExpr(0);
      this.expect(']');
    }
    return n;
  }

  private word(w: string, at: number): Node {
    const lower = w.toLowerCase();
    if (lower === 'not') return { k: 'unary', op: 'not', a: this.nestedExpr(NOT_PRECEDENCE) };
    if (this.isOp('(')) {
      this.next();
      if (lower === 'let') return this.letCall();
      if (lower === 'get') {
        const p = this.next();
        // A Get parameter can share its name with a field of the table (Get ( FoundCount ) next to a FoundCount field).
        if (p.t !== 'word' && !(p.t === 'field' && !p.to)) throw new CalcError(ERR.nameMissing, `Get needs a parameter name at ${p.at + 1}`);
        this.expect(')');
        return { k: 'get', param: p.v };
      }
      if (lower === 'while') return this.whileCall();
      const args: Node[] = [];
      if (!this.isOp(')')) {
        do {
          // FileMaker accepts a stray ";" before the closing parenthesis.
          if (this.isOp(')') && args.length) break;
          args.push(this.nestedExpr(0));
        } while (this.isOp(';') && this.next());
      }
      this.expect(')');
      return { k: 'call', name: w, args };
    }
    if (unknownFunctionId(w)) return { k: 'call', name: w, args: [] };
    if (Object.hasOwn(CONSTANTS, lower)) return CONSTANTS[lower];
    if (lower === 'and' || lower === 'or' || lower === 'xor') {
      throw new CalcError(ERR.operandExpected, `Operand expected before "${w}" at ${at + 1}`);
    }
    // A variable ($local, $$global, Let name) or a one-word field; decided at evaluation.
    return this.postfix({ k: 'var', name: w });
  }

  private bindings(): Binding[] {
    const binds: Binding[] = [];
    const one = () => {
      const n = this.next();
      if (n.t !== 'word' && n.t !== 'field') throw new CalcError(ERR.nameMissing, `Variable name expected at ${n.at + 1}`);
      if (n.t === 'field' && n.to) throw new CalcError(ERR.nameMissing, `Variable name expected at ${n.at + 1}`);
      let name = n.v;
      // Repetition of a $variable: $x[2] = ..., or $x[i] = ... with a Let name.
      let rep: Node | undefined;
      if (this.isOp('[')) {
        this.next();
        const r = this.nestedExpr(0);
        this.expect(']');
        if (r.k === 'num') name = `${name}[${r.value}]`;
        else rep = r;
      }
      this.expect('=');
      binds.push(rep ? [name, this.nestedExpr(0), rep] : [name, this.nestedExpr(0)]);
      this.bound[this.bound.length - 1]?.add(n.v.toLowerCase());
    };
    if (this.isOp('[')) {
      this.next();
      if (!this.isOp(']')) {
        do one();
        while (this.isOp(';') && this.next());
      }
      this.expect(']');
    } else {
      one();
    }
    return binds;
  }

  private letCall(): Node {
    this.bound.push(new Set());
    const binds = this.bindings();
    this.expect(';');
    const body = this.nestedExpr(0);
    this.expect(')');
    this.bound.pop();
    return { k: 'let', binds, body };
  }

  /** While ( [ initial ] ; condition ; [ logic ] ; result ), kept as a call with a let-shaped payload. */
  private whileCall(): Node {
    this.bound.push(new Set());
    const init = this.bindings();
    this.expect(';');
    const cond = this.nestedExpr(0);
    this.expect(';');
    const logic = this.bindings();
    this.expect(';');
    const result = this.nestedExpr(0);
    this.expect(')');
    this.bound.pop();
    return {
      k: 'call',
      name: 'While',
      args: [{ k: 'let', binds: init, body: cond }, { k: 'let', binds: logic, body: result }],
    };
  }
}

/** `locals`: names bound outside the formula, such as a custom function's parameters. */
export function parse(src: string, names: NameTable | CalcNames = new NameTable(), locals?: Iterable<string>): Node {
  const table = names instanceof NameTable ? names : new NameTable(names);
  const tokens = lex(src, table, locals);
  // A formula that is only comments gives an empty result.
  if (tokens.length === 1) return { k: 'str', value: '' };
  return new Parser(tokens).parse();
}

/**
 * Where a formula names fields: each span covers "TO::Field" or an
 * unqualified field name, with offsets into the source. Used to rewrite
 * formulas when a field or table occurrence is renamed or deleted.
 */
export function fieldSpans(src: string, names: NameTable | CalcNames = new NameTable()): { at: number; end: number; occurrence?: string; name: string }[] {
  const table = names instanceof NameTable ? names : new NameTable(names);
  return lex(src, table).filter((t) => t.t === 'field').map((t) => {
    const f = t as Extract<Token, { t: 'field' }>;
    return { at: f.at, end: f.at + (f.to !== undefined ? f.to.length + 2 : 0) + f.v.length, ...(f.to !== undefined ? { occurrence: f.to } : {}), name: f.v };
  });
}

/**
 * Recursive consumers have a separate stack bound from the parser's syntactic nesting limit.
 * Calls and Let scopes use more stack frames than binary operators. Weight those
 * edges twice so generated 1,000-term chains fit without admitting 1,000 nested calls.
 */
export function assertTraversalDepth(root: Node): void {
  const pending: [Node, number][] = [[root, 0]];
  while (pending.length) {
    const [node, depth] = pending.pop()!;
    if (depth > 1024) throw new CalcNestingError(ERR.calculation, 'Calculation tree exceeds the supported weighted depth of 1,024');
    const cost = node.k === 'call' || node.k === 'let' ? 2 : 1;
    for (const child of nodeChildren(node)) pending.push([child, depth + cost]);
  }
}

/** Fields a parsed formula reads, for recomputing it when they change. */
/** Fields a formula reads: field nodes, and one-word names not bound by an enclosing Let or While. */
export function fieldRefs(n: Node, out: { occurrence?: string; name: string }[] = [], bound: Set<string> = new Set()): { occurrence?: string; name: string }[] {
  assertTraversalDepth(n);
  return collectFieldRefs(n, out, bound);
}

function collectFieldRefs(n: Node, out: { occurrence?: string; name: string }[] = [], bound: Set<string> = new Set()): { occurrence?: string; name: string }[] {
  switch (n.k) {
    case 'field': out.push({ occurrence: n.occurrence, name: n.name }); if (n.rep) collectFieldRefs(n.rep, out, bound); break;
    case 'var':
      if (!n.name.startsWith('$') && !bound.has(n.name.toLowerCase())) out.push({ name: n.name });
      if (n.rep) collectFieldRefs(n.rep, out, bound);
      break;
    case 'call': n.args.forEach((a) => collectFieldRefs(a, out, bound)); break;
    case 'let': {
      const inner = new Set(bound);
      for (const [name, b, rep] of n.binds) {
        collectFieldRefs(b, out, inner);
        if (rep) collectFieldRefs(rep, out, inner);
        inner.add(name.replace(/\[.*$/, '').toLowerCase());
      }
      collectFieldRefs(n.body, out, inner);
      break;
    }
    case 'unary': collectFieldRefs(n.a, out, bound); break;
    case 'bin': collectFieldRefs(n.a, out, bound); collectFieldRefs(n.b, out, bound); break;
  }
  return out;
}
