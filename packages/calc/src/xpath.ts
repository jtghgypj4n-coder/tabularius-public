// XPath 1.0 over a small XML tree, for the BaseElements plug-in's BE_XPath and
// BE_XPathAll. The plug-in hands the work to libxml2, so the details follow it:
// whitespace-only text is kept, numbers turn into text the way
// xmlXPathCastNumberToString writes them, an unprefixed name test only matches
// elements in no namespace (a default namespace needs a prefix registered in the
// plug-in's namespace list), and number literals may carry an exponent.
// Processing instructions and the DOCTYPE are read past and not kept.

export class XPathError extends Error {}

export type XNodeKind = 'document' | 'element' | 'attribute' | 'text' | 'comment' | 'namespace' | 'processing-instruction';

export interface XNode {
  kind: XNodeKind;
  /** Qualified name as written for elements and attributes, the prefix for a namespace node, the target of a processing instruction, '' otherwise. */
  name: string;
  localName: string;
  prefix: string;
  namespaceURI: string;
  /** Attribute value, text, comment text, a processing instruction's data or a namespace node's URI; '' for elements and documents. */
  value: string;
  /** An attribute's or namespace node's parent is its element, as in the XPath data model. */
  parent: XNode | null;
  children: XNode[];
  attributes: XNode[];
  /** Namespace declarations made on this element, in order: [prefix ('' for the default), uri]. */
  nsDecls: [string, string][];
  /** Namespaces in scope on an element, prefix to URI ('' is the default namespace). */
  scope: Map<string, string> | null;
  /** Text that was a CDATA section, so it is written back as one. */
  cdata: boolean;
  /** Position in document order. */
  order: number;
}

export type XPathResult =
  | { type: 'nodeset'; nodes: XNode[] }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean };

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** A new, unattached node: for building result trees (XSLT). */
export function makeNode(kind: XNodeKind, parent: XNode | null, order: number): XNode {
  return { kind, name: '', localName: '', prefix: '', namespaceURI: '', value: '', parent, children: [], attributes: [], nsDecls: [], scope: null, cdata: false, order };
}

// ---- XML

const NAME = /[A-Za-z_:À-￿][\w.\-:·À-￿]*/y;
const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export interface ParseOptions {
  /** Keep processing instructions as nodes (XSLT wants them); by default they are read past. */
  processingInstructions?: boolean;
}

/** Parses XML (elements, attributes, text, CDATA, comments, processing instructions skipped, entities incl. numeric, xmlns namespace declarations). Throws XPathError on malformed XML. */
export function parseXmlDocument(xml: string, options?: ParseOptions): XNode {
  // Bound recursive parsing and namespace-scope copies before V8's stack or
  // heap becomes the limit. These are server limits, not XML/Claris semantics.
  if (xml.length > 8_000_000) throw new XPathError('XML input is too large');
  if (/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(xml)) {
    throw new XPathError('XML contains an invalid character');
  }
  const s = xml.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let i = 0;
  let order = 0;
  const doc = makeNode('document', null, order++);
  const fail = (msg: string): never => {
    const line = s.slice(0, i).split('\n').length;
    throw new XPathError(`XML parse error at line ${line}: ${msg}`);
  };

  const name = (): string => {
    NAME.lastIndex = i;
    const m = NAME.exec(s);
    if (!m) fail('expected a name');
    i += m![0].length;
    return m![0];
  };
  const skipWs = (): boolean => {
    const start = i;
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i++;
    return i > start;
  };
  const skipTo = (end: string, what: string): string => {
    const at = s.indexOf(end, i);
    if (at < 0) fail(`unterminated ${what}`);
    const body = s.slice(i, at);
    i = at + end.length;
    return body;
  };
  const decode = (t: string): string => {
    if (!t.includes('&')) return t;
    let out = '';
    let from = 0;
    for (let amp = t.indexOf('&'); amp >= 0; amp = t.indexOf('&', from)) {
      const semi = t.indexOf(';', amp);
      if (semi < 0) fail('"&" not starting an entity reference');
      const ent = t.slice(amp + 1, semi);
      let ch: string | undefined;
      if (/^#x[0-9a-fA-F]+$/.test(ent) || /^#[0-9]+$/.test(ent)) {
        const cp = ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        if (!(cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff))) {
          fail(`invalid character reference &${ent};`);
        }
        ch = String.fromCodePoint(cp);
      } else ch = PREDEFINED[ent];
      if (ch === undefined) fail(`unknown entity &${ent}; (only &lt; &gt; &amp; &quot; &apos; and numbered references are defined)`);
      out += t.slice(from, amp) + ch;
      from = semi + 1;
    }
    return out + t.slice(from);
  };
  const comment = (parent: XNode): void => {
    i += 4;
    const c = makeNode('comment', parent, order++);
    c.value = skipTo('-->', 'comment');
    if (c.value.includes('--') || c.value.endsWith('-')) fail('invalid comment');
    parent.children.push(c);
  };
  const pi = (parent: XNode): void => {
    i += 2;
    const body = skipTo('?>', 'processing instruction');
    if (!options?.processingInstructions) return;
    const m = /^([^ \t\r\n]+)[ \t\r\n]*([\s\S]*)$/.exec(body);
    if (!m || /^xml$/i.test(m[1])) return;
    const n = makeNode('processing-instruction', parent, order++);
    n.name = n.localName = m[1];
    n.value = m[2];
    parent.children.push(n);
  };
  const splitName = (qname: string): [string, string] => {
    const colon = qname.indexOf(':');
    return colon > 0 ? [qname.slice(0, colon), qname.slice(colon + 1)] : ['', qname];
  };

  const element = (parent: XNode, inherited: Map<string, string>, depth = 1): void => {
    if (depth > 256) fail('XML is nested too deeply');
    i++;
    const qname = name();
    const raw: [string, string][] = [];
    const attributeNames = new Set<string>();
    for (;;) {
      const spaced = skipWs();
      if (s.startsWith('/>', i) || s[i] === '>') break;
      if (i >= s.length) fail(`unterminated start tag <${qname}>`);
      if (!spaced) fail(`expected whitespace in <${qname}>`);
      const an = name();
      skipWs();
      if (s[i] !== '=') fail(`expected "=" after attribute ${an}`);
      i++;
      skipWs();
      const q = s[i];
      if (q !== '"' && q !== "'") fail(`expected a quoted value for attribute ${an}`);
      i++;
      const v = skipTo(q, 'attribute value');
      if (v.includes('<')) fail(`"<" in the value of attribute ${an}`);
      if (attributeNames.has(an)) fail(`attribute ${an} given twice`);
      attributeNames.add(an);
      // Attribute-value normalization: literal tabs and newlines become spaces, character references stay.
      raw.push([an, decode(v.replace(/[\t\n]/g, ' '))]);
    }
    const el = makeNode('element', parent, order++);
    let scope = inherited;
    for (const [an, v] of raw) {
      const decl = an === 'xmlns' ? '' : an.startsWith('xmlns:') ? an.slice(6) : undefined;
      if (decl === undefined) continue;
      if (decl && !v) fail(`empty namespace URI for prefix ${decl}`);
      if (scope === inherited) scope = new Map(inherited);
      scope.set(decl, v);
      el.nsDecls.push([decl, v]);
    }
    el.scope = scope;
    const resolve = (n: XNode, qn: string, isElement: boolean): void => {
      const [prefix, local] = splitName(qn);
      n.name = qn;
      const uri = prefix === 'xml' ? XML_NS : prefix ? scope.get(prefix) : isElement ? scope.get('') : '';
      if (prefix && !uri) {
        // libxml2 reports an unbound prefix but keeps the node, named by its whole QName and in no namespace.
        n.localName = qn;
        return;
      }
      n.prefix = prefix;
      n.localName = local;
      n.namespaceURI = uri ?? '';
    };
    resolve(el, qname, true);
    const expandedAttributes = new Set<string>();
    for (const [an, v] of raw) {
      if (an === 'xmlns' || an.startsWith('xmlns:')) continue;
      const a = makeNode('attribute', el, order++);
      resolve(a, an, false);
      const expanded = expandedName(a.namespaceURI, a.localName);
      if (expandedAttributes.has(expanded)) fail(`attribute ${an} given twice after namespace expansion`);
      expandedAttributes.add(expanded);
      a.value = v;
      el.attributes.push(a);
    }
    parent.children.push(el);
    if (s.startsWith('/>', i)) {
      i += 2;
      return;
    }
    i++;
    for (;;) {
      if (i >= s.length) fail(`<${qname}> is not closed`);
      if (s.startsWith('</', i)) {
        i += 2;
        const end = name();
        if (end !== qname) fail(`</${end}> closes <${qname}>`);
        skipWs();
        if (s[i] !== '>') fail(`expected ">" in </${end}>`);
        i++;
        return;
      }
      if (s.startsWith('<!--', i)) comment(el);
      else if (s.startsWith('<![CDATA[', i)) {
        i += 9;
        const t = makeNode('text', el, order++);
        t.value = skipTo(']]>', 'CDATA section');
        t.cdata = true;
        el.children.push(t);
      } else if (s.startsWith('<?', i)) pi(el);
      else if (s.startsWith('<!', i)) fail('unexpected markup declaration');
      else if (s[i] === '<') element(el, scope, depth + 1);
      else {
        const lt = s.indexOf('<', i);
        const end = lt < 0 ? s.length : lt;
        const t = makeNode('text', el, order++);
        t.value = decode(s.slice(i, end));
        i = end;
        el.children.push(t);
      }
    }
  };

  const rootScope = new Map<string, string>([['xml', XML_NS]]);
  let root = false;
  for (;;) {
    skipWs();
    if (i >= s.length) break;
    if (s.startsWith('<?', i)) pi(doc);
    else if (s.startsWith('<!--', i)) comment(doc);
    else if (s.startsWith('<!DOCTYPE', i)) {
      // Skip to the closing ">", past quoted strings and an internal subset in brackets.
      let depth = 0;
      for (i += 9; ; i++) {
        if (i >= s.length) fail('unterminated DOCTYPE');
        const c = s[i];
        if (c === '"' || c === "'") {
          const close = s.indexOf(c, i + 1);
          if (close < 0) fail('unterminated DOCTYPE');
          i = close;
        } else if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i++;
    } else if (s[i] === '<') {
      if (root) fail('content after the root element');
      element(doc, rootScope);
      root = true;
    } else fail(root ? 'content after the root element' : 'text before the root element');
  }
  if (!root) fail('no root element');
  return doc;
}

// ---- Node basics

/** The XPath string-value of a node. */
export function stringValue(n: XNode): string {
  if (n.kind !== 'element' && n.kind !== 'document') return n.value;
  let out = '';
  const walk = (m: XNode): void => {
    for (const c of m.children) {
      if (c.kind === 'text') out += c.value;
      else if (c.kind === 'element') walk(c);
    }
  };
  walk(n);
  return out;
}

const namespaceNodes = new WeakMap<XNode, XNode[]>();

/** An element's namespace nodes, made when first asked for; they sit between the element and its attributes. */
function namespacesOf(el: XNode): XNode[] {
  if (el.kind !== 'element') return [];
  let list = namespaceNodes.get(el);
  if (!list) {
    const live = [...(el.scope ?? [])].filter(([, uri]) => uri);
    list = live.map(([prefix, uri], k) => {
      const n = makeNode('namespace', el, el.order + (k + 1) / (live.length + 1));
      n.name = n.localName = prefix;
      n.value = uri;
      return n;
    });
    namespaceNodes.set(el, list);
  }
  return list;
}

function rootOf(n: XNode): XNode {
  while (n.parent) n = n.parent;
  return n;
}

/** Distinct nodes sorted into document order. */
export function inDocumentOrder(nodes: Iterable<XNode>): XNode[] {
  return [...new Set(nodes)].sort((a, b) => a.order - b.order);
}

// ---- XPath tokens

type Tok = { t: 'op' | 'name' | 'num' | 'str' | 'func' | 'type' | 'axis' | 'var'; v: string; n?: number };

const NCNAME = /[A-Za-z_À-￿][\w.\-·À-￿]*/y;
const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const NODE_TYPES = new Set(['comment', 'text', 'processing-instruction', 'node']);
const OPERATOR_NAMES = new Set(['and', 'or', 'mod', 'div']);

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  // XPath's disambiguation rule: after an operand, "*" multiplies and a name is an operator.
  const afterOperand = (): boolean => {
    const p = toks.at(-1);
    if (!p) return false;
    if (p.t === 'op') return p.v === ')' || p.v === ']' || p.v === '.' || p.v === '..';
    return p.t === 'name' || p.t === 'num' || p.t === 'str' || p.t === 'var';
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === '$') {
      NCNAME.lastIndex = i + 1;
      const m = NCNAME.exec(src);
      if (!m) throw new XPathError('Expected a variable name after "$" in XPath');
      let name = m[0];
      i += 1 + name.length;
      if (src[i] === ':') {
        NCNAME.lastIndex = i + 1;
        const local = NCNAME.exec(src);
        if (!local) throw new XPathError(`Bad variable name "$${name}:" in XPath`);
        name += `:${local[0]}`;
        i += 1 + local[0].length;
      }
      toks.push({ t: 'var', v: name });
      continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new XPathError('Unterminated string literal in XPath');
      toks.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    NUMBER.lastIndex = i;
    const num = NUMBER.exec(src);
    if (num) {
      toks.push({ t: 'num', v: num[0], n: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '//' || two === '!=' || two === '<=' || two === '>=' || two === '::' || two === '..') {
      toks.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('()[],@|+-=<>/.'.includes(c)) {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '*') {
      toks.push({ t: afterOperand() ? 'op' : 'name', v: '*' });
      i++;
      continue;
    }
    NCNAME.lastIndex = i;
    const m = NCNAME.exec(src);
    if (!m) throw new XPathError(`Unexpected "${c}" in XPath`);
    let name = m[0];
    i += name.length;
    if (afterOperand() && OPERATOR_NAMES.has(name)) {
      toks.push({ t: 'op', v: name });
      continue;
    }
    if (src[i] === ':' && src[i + 1] === '*') {
      toks.push({ t: 'name', v: `${name}:*` });
      i += 2;
      continue;
    }
    if (src[i] === ':' && src[i + 1] !== ':') {
      NCNAME.lastIndex = i + 1;
      const local = NCNAME.exec(src);
      if (!local) throw new XPathError(`Bad name "${name}:" in XPath`);
      name += `:${local[0]}`;
      i += 1 + local[0].length;
    }
    let j = i;
    while (src[j] === ' ' || src[j] === '\t' || src[j] === '\r' || src[j] === '\n') j++;
    if (src[j] === '(') toks.push({ t: NODE_TYPES.has(name) ? 'type' : 'func', v: name });
    else if (src.startsWith('::', j) && !name.includes(':')) toks.push({ t: 'axis', v: name });
    else toks.push({ t: 'name', v: name });
  }
  return toks;
}

// ---- XPath syntax tree

type Axis =
  | 'child' | 'descendant' | 'descendant-or-self' | 'self' | 'parent' | 'ancestor' | 'ancestor-or-self'
  | 'following-sibling' | 'preceding-sibling' | 'following' | 'preceding' | 'attribute' | 'namespace';
const AXES = new Set<string>([
  'child', 'descendant', 'descendant-or-self', 'self', 'parent', 'ancestor', 'ancestor-or-self',
  'following-sibling', 'preceding-sibling', 'following', 'preceding', 'attribute', 'namespace',
]);
const REVERSE_AXES = new Set<Axis>(['parent', 'ancestor', 'ancestor-or-self', 'preceding-sibling', 'preceding']);

type Test =
  | { t: 'name'; uri: string; local: string }
  | { t: 'any' }
  | { t: 'nsany'; uri: string }
  | { t: 'node' }
  | { t: 'text' }
  | { t: 'comment' }
  | { t: 'pi'; target?: string };

interface Step { axis: Axis; test: Test; preds: Expr[] }

type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'neg'; a: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'var'; name: string }
  | { k: 'filter'; e: Expr; preds: Expr[] }
  | { k: 'path'; start: 'root' | 'context' | Expr; steps: Step[] };

/** Fewest and most arguments of each core function. */
const ARITY: Record<string, [number, number]> = {
  last: [0, 0], position: [0, 0], count: [1, 1], id: [1, 1], 'local-name': [0, 1], 'namespace-uri': [0, 1], name: [0, 1],
  string: [0, 1], concat: [2, Infinity], 'starts-with': [2, 2], contains: [2, 2], 'substring-before': [2, 2],
  'substring-after': [2, 2], substring: [2, 3], 'string-length': [0, 1], 'normalize-space': [0, 1], translate: [3, 3],
  boolean: [1, 1], not: [1, 1], true: [0, 0], false: [0, 0], lang: [1, 1],
  number: [0, 1], sum: [1, 1], floor: [1, 1], ceiling: [1, 1], round: [1, 1],
};

const DESCENDANT_OR_SELF: Step = { axis: 'descendant-or-self', test: { t: 'node' }, preds: [] };

/** What an expression may use beyond core XPath: variable references and extra functions (by name as written). */
export interface CompileOptions {
  variables?: boolean;
  functions?: Iterable<string>;
}

/** An expanded name as a single string: `{uri}local`, or just `local` in no namespace. */
export const expandedName = (uri: string, local: string): string => (uri ? `{${uri}}${local}` : local);

function compile(src: string, ns: Map<string, string>, opts: CompileOptions = {}): Expr {
  const extra = new Set(opts.functions ?? []);
  const toks = lex(src);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const isOp = (v: string): boolean => toks[p]?.t === 'op' && toks[p].v === v;
  const expect = (v: string): void => {
    if (!isOp(v)) throw new XPathError(`Expected "${v}" in XPath${toks[p] ? ` before "${toks[p].v}"` : ''}`);
    p++;
  };
  const uriOf = (prefix: string): string => {
    const uri = prefix === 'xml' ? XML_NS : ns.get(prefix);
    if (uri === undefined) throw new XPathError(`Undefined namespace prefix "${prefix}" in XPath`);
    return uri;
  };

  const binary = (ops: string[], sub: () => Expr) => (): Expr => {
    let a = sub();
    while (p < toks.length && toks[p].t === 'op' && ops.includes(toks[p].v)) {
      const op = toks[p++].v;
      a = { k: 'bin', op, a, b: sub() };
    }
    return a;
  };
  const unary = (): Expr => {
    if (isOp('-')) {
      p++;
      return { k: 'neg', a: unary() };
    }
    return union();
  };
  const multiplicative = binary(['*', 'div', 'mod'], unary);
  const additive = binary(['+', '-'], multiplicative);
  const relational = binary(['<', '<=', '>', '>='], additive);
  const equality = binary(['=', '!='], relational);
  const and = binary(['and'], equality);
  const or = binary(['or'], and);
  const expr = or;
  function union(): Expr {
    return binary(['|'], path)();
  }

  const predicates = (): Expr[] => {
    const preds: Expr[] = [];
    while (isOp('[')) {
      p++;
      preds.push(expr());
      expect(']');
    }
    return preds;
  };
  const startsStep = (t: Tok | undefined): boolean =>
    !!t && (t.t === 'name' || t.t === 'axis' || t.t === 'type' || (t.t === 'op' && (t.v === '.' || t.v === '..' || t.v === '@')));
  const step = (): Step => {
    const t = peek();
    if (t?.t === 'op' && (t.v === '.' || t.v === '..')) {
      p++;
      if (isOp('[')) throw new XPathError(`A predicate can't follow "${t.v}" in XPath 1.0`);
      return { axis: t.v === '.' ? 'self' : 'parent', test: { t: 'node' }, preds: [] };
    }
    let axis: Axis = 'child';
    if (t?.t === 'axis') {
      if (!AXES.has(t.v)) throw new XPathError(`Unknown axis "${t.v}" in XPath`);
      axis = t.v as Axis;
      p++;
      expect('::');
    } else if (t?.t === 'op' && t.v === '@') {
      axis = 'attribute';
      p++;
    }
    const n = toks[p++];
    let test: Test;
    if (n?.t === 'name') {
      if (n.v === '*') test = { t: 'any' };
      else if (n.v.endsWith(':*')) test = { t: 'nsany', uri: uriOf(n.v.slice(0, -2)) };
      else {
        const colon = n.v.indexOf(':');
        test = colon < 0 ? { t: 'name', uri: '', local: n.v } : { t: 'name', uri: uriOf(n.v.slice(0, colon)), local: n.v.slice(colon + 1) };
      }
    } else if (n?.t === 'type') {
      expect('(');
      let target: string | undefined;
      if (n.v === 'processing-instruction' && peek()?.t === 'str') target = toks[p++].v;
      expect(')');
      test = n.v === 'node' ? { t: 'node' } : n.v === 'text' ? { t: 'text' } : n.v === 'comment' ? { t: 'comment' } : { t: 'pi', target };
    } else throw new XPathError(`Expected a node test in XPath${n ? ` at "${n.v}"` : ''}`);
    return { axis, test, preds: predicates() };
  };
  const relative = (steps: Step[]): Step[] => {
    while (isOp('/') || isOp('//')) {
      if (toks[p++].v === '//') steps.push(DESCENDANT_OR_SELF);
      steps.push(step());
    }
    return steps;
  };
  function path(): Expr {
    const t = peek();
    if (!t) throw new XPathError('Unexpected end of XPath');
    if (t.t === 'num' || t.t === 'str' || t.t === 'func' || t.t === 'var' || (t.t === 'op' && t.v === '(')) {
      let e = primary();
      const preds = predicates();
      if (preds.length) e = { k: 'filter', e, preds };
      return isOp('/') || isOp('//') ? { k: 'path', start: e, steps: relative([]) } : e;
    }
    if (isOp('/')) {
      p++;
      return { k: 'path', start: 'root', steps: startsStep(peek()) ? relative([step()]) : [] };
    }
    if (isOp('//')) {
      p++;
      return { k: 'path', start: 'root', steps: relative([DESCENDANT_OR_SELF, step()]) };
    }
    return { k: 'path', start: 'context', steps: relative([step()]) };
  }
  function primary(): Expr {
    const t = toks[p++];
    if (t.t === 'num') return { k: 'num', v: t.n! };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'var') {
      if (!opts.variables) throw new XPathError('XPath variables are not supported');
      const colon = t.v.indexOf(':');
      return { k: 'var', name: colon < 0 ? t.v : expandedName(uriOf(t.v.slice(0, colon)), t.v.slice(colon + 1)) };
    }
    if (t.t === 'op') {
      const e = expr();
      expect(')');
      return e;
    }
    const arity = ARITY[t.v] ?? (extra.has(t.v) ? [0, Infinity] : undefined);
    if (!arity) throw new XPathError(`Unknown XPath function ${t.v}()`);
    expect('(');
    const args: Expr[] = [];
    if (!isOp(')')) {
      args.push(expr());
      while (isOp(',')) {
        p++;
        args.push(expr());
      }
    }
    expect(')');
    if (args.length < arity[0] || args.length > arity[1]) throw new XPathError(`Wrong number of arguments to ${t.v}()`);
    return { k: 'call', name: t.v, args };
  }

  if (!toks.length) throw new XPathError('Empty XPath expression');
  const e = expr();
  if (p < toks.length) throw new XPathError(`Unexpected "${toks[p].v}" in XPath`);
  return e;
}

// ---- Evaluation

type Val = XNode[] | string | number | boolean;
/** An XPath value: a node-set (in document order), string, number or boolean. */
export type XValue = Val;
/** An extra function: gets its arguments evaluated, and the context it was called in. */
export type XPathFunction = (args: XValue[], ctx: XPathContext) => XValue;
/** Variable bindings, extra functions, and anything else the caller wants its functions to see. */
export interface XPathEnv {
  /** Looks up a variable by expanded name (see expandedName); undefined means unbound. */
  variable?: (name: string) => XValue | undefined;
  functions?: Map<string, XPathFunction>;
  /** XSLT's current node, for current(). */
  current?: XNode;
  /** The namespaces in scope where the expression was written, for functions that take QNames. */
  namespaces?: Map<string, string>;
}
export interface XPathContext { node: XNode; pos: number; size: number; env?: XPathEnv }
type Ctx = XPathContext;

const isNodes = (v: Val): v is XNode[] => Array.isArray(v);
const XPATH_SPACE = /[ \t\r\n]+/g;

function toNumber(s: string): number {
  return /^[ \t\r\n]*-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t\r\n]*$/.test(s) ? Number(s.trim()) : NaN;
}
/** XPath string(): node-sets give their first node's string-value. */
export function str(v: Val): string {
  if (isNodes(v)) return v.length ? stringValue(v[0]) : '';
  if (typeof v === 'number') return formatNumber(v);
  return String(v);
}
/** XPath number(). */
export function num(v: Val): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return toNumber(str(v));
}
/** XPath boolean(). */
export function bool(v: Val): boolean {
  if (isNodes(v)) return v.length > 0;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return v;
}
function nodesArg(v: Val, fn: string): XNode[] {
  if (!isNodes(v)) throw new XPathError(`${fn}() needs a node-set`);
  return v;
}

/** Comparison of two values that aren't node-sets. */
function compareAtoms(op: string, a: string | number | boolean, b: string | number | boolean): boolean {
  if (op === '=' || op === '!=') {
    let eq: boolean;
    if (typeof a === 'boolean' || typeof b === 'boolean') eq = bool(a) === bool(b);
    else if (typeof a === 'number' || typeof b === 'number') eq = num(a) === num(b);
    else eq = a === b;
    return op === '=' ? eq : !eq;
  }
  const x = num(a);
  const y = num(b);
  return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
}

function compare(op: string, a: Val, b: Val): boolean {
  if (isNodes(a) && isNodes(b)) {
    const as = a.map(stringValue);
    const bs = b.map(stringValue);
    if (op === '=') {
      const set = new Set(bs);
      return as.some((s) => set.has(s));
    }
    if (op === '!=') return as.length > 0 && bs.length > 0 && new Set([...as, ...bs]).size > 1;
    const an = as.map(toNumber);
    const bn = bs.map(toNumber);
    return an.some((x) => bn.some((y) => compareAtoms(op, x, y)));
  }
  if (isNodes(a) || isNodes(b)) {
    const left = isNodes(a);
    const set = (left ? a : b) as XNode[];
    const other = (left ? b : a) as string | number | boolean;
    if (typeof other === 'boolean') return left ? compareAtoms(op, set.length > 0, other) : compareAtoms(op, other, set.length > 0);
    // Against a number each node's value is a number, against a string a string (relational operators make numbers of both).
    return set.some((n) => {
      const s = stringValue(n);
      const v = typeof other === 'number' ? toNumber(s) : s;
      return left ? compareAtoms(op, v, other) : compareAtoms(op, other, v);
    });
  }
  return compareAtoms(op, a as string | number | boolean, b as string | number | boolean);
}

function descendants(n: XNode, out: XNode[]): XNode[] {
  for (const c of n.children) {
    out.push(c);
    descendants(c, out);
  }
  return out;
}
/** A subtree in reverse document order: each node after its descendants. */
function reverseSubtree(n: XNode, out: XNode[]): void {
  for (let k = n.children.length - 1; k >= 0; k--) reverseSubtree(n.children[k], out);
  out.push(n);
}
const isTreeChild = (n: XNode): boolean => n.kind !== 'attribute' && n.kind !== 'namespace';

/** The nodes on an axis, in the axis' own order (reverse axes nearest first). */
function axisNodes(n: XNode, axis: Axis): XNode[] {
  switch (axis) {
    case 'child':
      return n.children;
    case 'descendant':
      return descendants(n, []);
    case 'descendant-or-self':
      return descendants(n, [n]);
    case 'self':
      return [n];
    case 'parent':
      return n.parent ? [n.parent] : [];
    case 'ancestor':
    case 'ancestor-or-self': {
      const out = axis === 'ancestor' ? [] : [n];
      for (let a = n.parent; a; a = a.parent) out.push(a);
      return out;
    }
    case 'following-sibling':
    case 'preceding-sibling': {
      if (!n.parent || !isTreeChild(n)) return [];
      const sibs = n.parent.children;
      const at = sibs.indexOf(n);
      return axis === 'following-sibling' ? sibs.slice(at + 1) : sibs.slice(0, at).reverse();
    }
    case 'following': {
      const out: XNode[] = [];
      let m = n;
      // After an attribute come its element's descendants.
      if (!isTreeChild(m)) {
        descendants(m.parent!, out);
        m = m.parent!;
      }
      for (; m.parent; m = m.parent) {
        const sibs = m.parent.children;
        for (let k = sibs.indexOf(m) + 1; k < sibs.length; k++) {
          out.push(sibs[k]);
          descendants(sibs[k], out);
        }
      }
      return out;
    }
    case 'preceding': {
      const out: XNode[] = [];
      let m = isTreeChild(n) ? n : n.parent!;
      for (; m.parent; m = m.parent) {
        const sibs = m.parent.children;
        for (let k = sibs.indexOf(m) - 1; k >= 0; k--) reverseSubtree(sibs[k], out);
      }
      return out;
    }
    case 'attribute':
      return n.attributes;
    case 'namespace':
      return namespacesOf(n);
  }
}

function matches(n: XNode, test: Test, axis: Axis): boolean {
  switch (test.t) {
    case 'node':
      return true;
    case 'text':
      return n.kind === 'text';
    case 'comment':
      return n.kind === 'comment';
    case 'pi':
      return n.kind === 'processing-instruction' && (test.target === undefined || n.name === test.target);
  }
  const principal = axis === 'attribute' ? 'attribute' : axis === 'namespace' ? 'namespace' : 'element';
  if (n.kind !== principal) return false;
  if (test.t === 'any') return true;
  if (test.t === 'nsany') return n.namespaceURI === test.uri;
  return n.localName === test.local && n.namespaceURI === test.uri;
}

function filterBy(nodes: XNode[], preds: Expr[], env: XPathEnv | undefined): XNode[] {
  for (const pred of preds) {
    const list = nodes;
    nodes = list.filter((node, k) => {
      const r = evaluate(pred, { node, pos: k + 1, size: list.length, env });
      return typeof r === 'number' ? r === k + 1 : bool(r);
    });
  }
  return nodes;
}

function evaluate(e: Expr, c: Ctx): Val {
  switch (e.k) {
    case 'num':
    case 'str':
      return e.v;
    case 'neg':
      return -num(evaluate(e.a, c));
    case 'bin': {
      if (e.op === 'or') return bool(evaluate(e.a, c)) || bool(evaluate(e.b, c));
      if (e.op === 'and') return bool(evaluate(e.a, c)) && bool(evaluate(e.b, c));
      const a = evaluate(e.a, c);
      const b = evaluate(e.b, c);
      switch (e.op) {
        case '|':
          if (!isNodes(a) || !isNodes(b)) throw new XPathError('"|" needs node-sets on both sides');
          return inDocumentOrder([...a, ...b]);
        case '+':
          return num(a) + num(b);
        case '-':
          return num(a) - num(b);
        case '*':
          return num(a) * num(b);
        case 'div':
          return num(a) / num(b);
        case 'mod':
          return num(a) % num(b);
        default:
          return compare(e.op, a, b);
      }
    }
    case 'call':
      return call(e.name, e.args, c);
    case 'var': {
      const v = c.env?.variable?.(e.name);
      if (v === undefined) throw new XPathError(`Undefined variable $${e.name}`);
      return v;
    }
    case 'filter': {
      const v = evaluate(e.e, c);
      if (!isNodes(v)) throw new XPathError('A predicate needs a node-set');
      return filterBy(v, e.preds, c.env);
    }
    case 'path': {
      let nodes: XNode[];
      if (e.start === 'root') nodes = [rootOf(c.node)];
      else if (e.start === 'context') nodes = [c.node];
      else {
        const v = evaluate(e.start, c);
        if (!isNodes(v)) throw new XPathError('"/" needs a node-set');
        nodes = v;
      }
      for (const s of e.steps) {
        const out: XNode[] = [];
        for (const n of nodes) {
          const onAxis = axisNodes(n, s.axis).filter((m) => matches(m, s.test, s.axis));
          for (const m of filterBy(onAxis, s.preds, c.env)) out.push(m);
        }
        nodes = nodes.length === 1 && !REVERSE_AXES.has(s.axis) ? out : inDocumentOrder(out);
      }
      return nodes;
    }
  }
}

function call(name: string, args: Expr[], c: Ctx): Val {
  const arg = (k: number): Val => evaluate(args[k], c);
  if (!(name in ARITY)) {
    const fn = c.env?.functions?.get(name);
    if (!fn) throw new XPathError(`Unknown XPath function ${name}()`);
    return fn(args.map((_, k) => arg(k)), c);
  }
  const s = (k: number): string => (k < args.length ? str(arg(k)) : stringValue(c.node));
  switch (name) {
    case 'last':
      return c.size;
    case 'position':
      return c.pos;
    case 'count':
      return nodesArg(arg(0), name).length;
    case 'id': {
      // Only xml:id makes IDs here: there are no DTDs to declare ID attributes.
      const v = arg(0);
      const wanted = new Set((isNodes(v) ? v.map(stringValue).join(' ') : str(v)).split(XPATH_SPACE).filter(Boolean));
      const all = descendants(rootOf(c.node), []);
      return all.filter((n) => n.kind === 'element' && n.attributes.some((a) => a.namespaceURI === XML_NS && a.localName === 'id' && wanted.has(a.value)));
    }
    case 'local-name':
    case 'namespace-uri':
    case 'name': {
      const n = args.length ? nodesArg(arg(0), name)[0] : c.node;
      if (!n) return '';
      if (name === 'namespace-uri') return n.namespaceURI;
      return name === 'name' ? n.name : n.localName;
    }
    case 'string':
      return s(0);
    case 'concat':
      return args.map((_, k) => s(k)).join('');
    case 'starts-with':
      return s(0).startsWith(s(1));
    case 'contains':
      return s(0).includes(s(1));
    case 'substring-before': {
      const a = s(0);
      const at = a.indexOf(s(1));
      return at < 0 ? '' : a.slice(0, at);
    }
    case 'substring-after': {
      const a = s(0);
      const b = s(1);
      const at = a.indexOf(b);
      return at < 0 ? '' : a.slice(at + b.length);
    }
    case 'substring': {
      const chars = Array.from(s(0));
      const from = Math.round(num(arg(1)));
      const end = args.length > 2 ? from + Math.round(num(arg(2))) : Infinity;
      return chars.filter((_, k) => k + 1 >= from && k + 1 < end).join('');
    }
    case 'string-length':
      return Array.from(s(0)).length;
    case 'normalize-space':
      return s(0).replace(XPATH_SPACE, ' ').replace(/^ | $/g, '');
    case 'translate': {
      const from = Array.from(s(1));
      const to = Array.from(s(2));
      return Array.from(s(0))
        .map((ch) => {
          const at = from.indexOf(ch);
          return at < 0 ? ch : (to[at] ?? '');
        })
        .join('');
    }
    case 'boolean':
      return bool(arg(0));
    case 'not':
      return !bool(arg(0));
    case 'true':
      return true;
    case 'false':
      return false;
    case 'lang': {
      const want = s(0).toLowerCase();
      for (let n: XNode | null = c.node; n; n = n.parent) {
        const a = n.attributes.find((x) => x.namespaceURI === XML_NS && x.localName === 'lang');
        if (a) {
          const have = a.value.toLowerCase();
          return have === want || have.startsWith(`${want}-`);
        }
      }
      return false;
    }
    case 'number':
      return args.length ? num(arg(0)) : toNumber(stringValue(c.node));
    case 'sum':
      return nodesArg(arg(0), name).reduce((t, n) => t + toNumber(stringValue(n)), 0);
    case 'floor':
      return Math.floor(num(arg(0)));
    case 'ceiling':
      return Math.ceil(num(arg(0)));
    case 'round':
      // Math.round already rounds halves up and keeps -0 for -0.5 ≤ x < 0, as XPath asks.
      return Math.round(num(arg(0)));
  }
  throw new XPathError(`Unknown XPath function ${name}()`);
}

/** The names of the XPath 1.0 core functions. */
export const coreFunctionNames = (): string[] => Object.keys(ARITY);

/** A compiled expression, for evaluating many times. */
export interface CompiledXPath { readonly expr: Expr; readonly src: string }

/** Compiles an expression; `ns` maps prefixes to URIs for prefixed names (unprefixed name tests are in no namespace). Throws XPathError. */
export function compileXPath(src: string, ns: Map<string, string>, opts?: CompileOptions): CompiledXPath {
  return { expr: compile(src, ns, opts), src };
}

/** Evaluates a compiled expression for a context node, position and size, with optional variables and functions. */
export function evaluateCompiled(x: CompiledXPath, ctx: XPathContext): XValue {
  return evaluate(x.expr, ctx);
}

// ---- XSLT patterns

/** One alternative of an XSLT pattern, with its default priority and, when the pattern ends in a name test, the local name it needs. */
export interface CompiledPattern { readonly expr: Expr; readonly src: string; readonly priority: number; readonly localName?: string }

const badPattern = (src: string): never => {
  throw new XPathError(`Invalid XSLT pattern "${src}"`);
};

/** Compiles an XSLT pattern into its "|" alternatives. Throws XPathError on a malformed pattern. */
export function compilePattern(src: string, ns: Map<string, string>, opts?: CompileOptions): CompiledPattern[] {
  const e = compile(src, ns, opts);
  const alts: Expr[] = [];
  const split = (x: Expr): void => {
    if (x.k === 'bin' && x.op === '|') {
      split(x.a);
      split(x.b);
    } else alts.push(x);
  };
  split(e);
  return alts.map((a): CompiledPattern => {
    if (a.k === 'call') {
      if (a.name !== 'id' && a.name !== 'key') badPattern(src);
      return { expr: a, src, priority: 0.5 };
    }
    if (a.k !== 'path') return badPattern(src);
    if (typeof a.start === 'object' && !(a.start.k === 'call' && (a.start.name === 'id' || a.start.name === 'key'))) badPattern(src);
    if (a.start === 'context' && !a.steps.length) badPattern(src);
    for (const s of a.steps) if (s !== DESCENDANT_OR_SELF && s.axis !== 'child' && s.axis !== 'attribute') badPattern(src);
    if (a.steps.at(-1) === DESCENDANT_OR_SELF) badPattern(src);
    const last = a.steps.at(-1);
    const localName = last?.test.t === 'name' ? last.test.local : undefined;
    let priority = 0.5;
    if (a.start === 'context' && a.steps.length === 1 && !last!.preds.length) {
      const t = last!.test;
      priority = t.t === 'name' || (t.t === 'pi' && t.target !== undefined) ? 0 : t.t === 'nsany' ? -0.25 : -0.5;
    }
    return { expr: a, src, priority, localName };
  });
}

/** Whether a node matches one pattern alternative. */
export function matchPattern(p: CompiledPattern, node: XNode, env?: XPathEnv): boolean {
  if (p.localName !== undefined && node.localName !== p.localName) return false;
  const c: Ctx = { node, pos: 1, size: 1, env };
  const e = p.expr;
  if (e.k !== 'path') return (evaluate(e, c) as XNode[]).includes(node);
  const steps = e.steps;
  const at = (i: number, n: XNode): boolean => {
    if (i < 0) {
      if (e.start === 'root') return n.kind === 'document';
      if (e.start === 'context') return true;
      const v = evaluate(e.start, { node: n, pos: 1, size: 1, env });
      return isNodes(v) && v.includes(n);
    }
    const s = steps[i];
    if (s === DESCENDANT_OR_SELF) {
      for (let a: XNode | null = n; a; a = a.parent) if (at(i - 1, a)) return true;
      return false;
    }
    if (s.axis === 'attribute' ? n.kind !== 'attribute' : !isTreeChild(n) || n.kind === 'document') return false;
    if (!matches(n, s.test, s.axis) || !n.parent) return false;
    if (s.preds.length) {
      const candidates = axisNodes(n.parent, s.axis).filter((m) => matches(m, s.test, s.axis));
      if (!filterBy(candidates, s.preds, env).includes(n)) return false;
    }
    return at(i - 1, n.parent);
  };
  return at(steps.length - 1, node);
}

/** The plug-in's namespace list: space-separated `prefix=uri` (or `xmlns:prefix=uri`), the URI optionally quoted. */
function namespaceList(list: string | undefined): Map<string, string> {
  const ns = new Map<string, string>();
  if (!list) return ns;
  for (const m of list.matchAll(/(?:xmlns:)?([^\s="']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S*))/g)) {
    if (m[1] === 'xmlns') continue;
    ns.set(m[1], m[2] ?? m[3] ?? m[4]);
  }
  return ns;
}

/** Evaluates an XPath 1.0 expression against a document. `namespaces` is BaseElements' ns list: space-separated `prefix=uri` pairs (also accept `xmlns:prefix=uri` and quoted uris). */
export function evaluateXPath(doc: XNode, expr: string, namespaces?: string): XPathResult {
  const v = evaluate(compile(expr, namespaceList(namespaces)), { node: doc, pos: 1, size: 1 });
  if (isNodes(v)) return { type: 'nodeset', nodes: v };
  if (typeof v === 'string') return { type: 'string', value: v };
  if (typeof v === 'number') return { type: 'number', value: v };
  return { type: 'boolean', value: v };
}

// ---- Results as text

const stripZeros = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

/** xmlXPathCastNumberToString: integers in int range plainly, very large or small magnitudes in C's %e, otherwise 15 significant digits. */
export function formatNumber(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  if (n > -2147483648 && n < 2147483647 && Number.isInteger(n)) return String(n === 0 ? 0 : n);
  const abs = Math.abs(n);
  if (abs > 1e9 || abs < 1e-5) {
    const [mantissa, exp] = n.toExponential(14).split('e');
    const e = Number(exp);
    return `${stripZeros(mantissa)}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  const whole = Math.trunc(Math.log10(abs));
  return stripZeros(n.toFixed(whole > 0 ? 14 - whole : 15 - whole));
}

/** libxml2's casts: string-value of the first node in document order ("" for empty set); numbers like xmlXPathCastNumberToString; booleans "true"/"false". */
export function xpathText(r: XPathResult): string {
  switch (r.type) {
    case 'nodeset':
      return r.nodes.length ? stringValue(r.nodes[0]) : '';
    case 'string':
      return r.value;
    case 'number':
      return formatNumber(r.value);
    case 'boolean':
      return r.value ? 'true' : 'false';
  }
}

/** Each node's string-value, in document order, one per line joined with "\r" (BE_XPathAll). Non-node-sets: xpathText. */
export function xpathValues(r: XPathResult): string {
  return r.type === 'nodeset' ? r.nodes.map(stringValue).join('\r') : xpathText(r);
}

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string =>
  escapeText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');

function serialize(n: XNode): string {
  switch (n.kind) {
    case 'document':
      return `<?xml version="1.0"?>\n${n.children.map((c) => `${serialize(c)}\n`).join('')}`;
    case 'element': {
      // Like xmlNodeDump, only the declarations made on the element itself are written.
      let out = `<${n.name}`;
      for (const [prefix, uri] of n.nsDecls) out += ` ${prefix ? `xmlns:${prefix}` : 'xmlns'}="${escapeAttr(uri)}"`;
      for (const a of n.attributes) out += serialize(a);
      if (!n.children.length) return `${out}/>`;
      return `${out}>${n.children.map(serialize).join('')}</${n.name}>`;
    }
    case 'attribute':
      return ` ${n.name}="${escapeAttr(n.value)}"`;
    case 'namespace':
      return ` ${n.name ? `xmlns:${n.name}` : 'xmlns'}="${escapeAttr(n.value)}"`;
    case 'text':
      return n.cdata ? `<![CDATA[${n.value}]]>` : escapeText(n.value);
    case 'comment':
      return `<!--${n.value}-->`;
    case 'processing-instruction':
      return `<?${n.name}${n.value ? ` ${n.value}` : ''}?>`;
  }
}

/** The first node serialized as XML (BE_XPath with asText false); "" for an empty node-set, xpathText for other results. */
export function xpathXml(r: XPathResult): string {
  if (r.type !== 'nodeset') return xpathText(r);
  return r.nodes.length ? serialize(r.nodes[0]) : '';
}
