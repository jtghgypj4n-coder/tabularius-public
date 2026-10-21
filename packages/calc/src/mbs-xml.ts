// MBS ( "XML.…" ): MonkeyBread's XML functions, following MBS's own function pages (mbsplugins.eu), on Tabularius's
// own XML parser, XPath 1.0 and XSLT 1.0 engines. MBS uses libxml2, so where a page leaves something out Tabularius
// does what libxml2 does and the comment says it's inferred:
// - Output is libxml2's: an XML declaration naming UTF-8, a line feed after it, two spaces for each level when the
//   result is formatted (MBS's pages, shown as HTML, collapse them to one), and no line break at the end (MBS's
//   examples end right after the last tag).
// - An element holding text isn't indented inside (libxml2 doesn't); when formatting, whitespace-only text between
//   elements is dropped first.
// - Flag 1 (go on after XML errors) isn't honoured: XML Tabularius can't read is an error.
// Not here: XML.Colorize (styled text), XML.Validate (XML Schema), XML.ToJSON (MBS doesn't describe how mixed
// content and text beside attributes come out), XML.Tidy and XML.ToHTML (no description of their output), and the
// file, container, record and import functions. They give an "isn't available" MBS error.

import { rethrowExecutionRefusal } from './execution-refusal.ts';

import { withXmlWorkBudget, workBudget, budgetReplace, budgetDepth } from './work-budget.ts';
import { MbsError } from './mbs-text.ts';
import { canonicalXml } from './xmltools.ts';
import { XPathError, xpathValues, evaluateXPath, formatNumber, makeNode, parseXmlDocument, stringValue, type XNode } from './xpath.ts';
import { XsltError, applyXslt } from './xslt.ts';

type MbsXml = (t: string[], scope: object) => string | number;

// --- references ---------------------------------------------------------------------------------
// XML.Parse keeps a document for the session and gives back a number (MBS: "a reference number"). As for JSON,
// numbers start at a random large place so a reference isn't mistaken for a value in the data (inferred).

interface Session { next: number; refs: Map<number, XNode>; noEmptyTags: boolean }
const sessions = new WeakMap<object, Session>();
const MAX_LIVE = 10_000;
const sessionOf = (scope: object): Session => {
  let s = sessions.get(scope);
  if (!s) sessions.set(scope, (s = { next: 100_000_000 + Math.floor(Math.random() * 800_000_000), refs: new Map(), noEmptyTags: false }));
  return s;
};
function keep(scope: object, doc: XNode): number {
  const s = sessionOf(scope);
  if (s.refs.size >= MAX_LIVE) throw new MbsError(`Too many XML references are open (${MAX_LIVE}); release them with XML.Release`);
  const ref = s.next++;
  s.refs.set(ref, doc);
  return ref;
}

function parse(xml: string): XNode {
  let doc: XNode;
  try {
    doc = parseXmlDocument(xml, { processingInstructions: true });
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof XPathError) throw new MbsError(`Failed to parse XML: ${e.message}`);
    throw e;
  }
  if (!rootOf(doc)) throw new MbsError('Failed to parse XML: the document has no root element');
  return doc;
}
const rootOf = (doc: XNode): XNode | undefined => doc.children.find((c) => c.kind === 'element');
const root = (doc: XNode): XNode => rootOf(doc) ?? fail('The XML has no root element');
const fail = (msg: string): never => {
  throw new MbsError(msg);
};

interface Input { doc: XNode; ref?: number }
/** XML text, or a reference from XML.Parse. */
function input(scope: object, text: string): Input {
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    const doc = sessionOf(scope).refs.get(Number(t));
    if (doc) return { doc, ref: Number(t) };
  }
  return { doc: parse(text) };
}

// Copying, numbering and walking go by an explicit stack, so a deeply nested document can't overflow the call stack.
function clone(n: XNode, parent: XNode | null): XNode {
  const copy = (x: XNode, p: XNode | null): XNode => ({ ...x, parent: p, children: [], attributes: [], nsDecls: x.nsDecls.map(([a, b]) => [a, b]) });
  const top = copy(n, parent);
  const stack: [XNode, XNode][] = [[n, top]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    to.attributes = from.attributes.map((a) => copy(a, to));
    to.children = from.children.map((k) => {
      const c = copy(k, to);
      stack.push([k, c]);
      return c;
    });
  }
  return top;
}
/** Every node below `n` in document order (attributes aside). */
function* descendants(n: XNode): Generator<XNode> {
  const stack = [...n.children].reverse();
  while (stack.length) {
    const c = stack.pop()!;
    yield c;
    for (let k = c.children.length - 1; k >= 0; k--) stack.push(c.children[k]);
  }
}
/** Document order again after a change, as the parser numbers it: an element, its attributes, then its children. */
function renumber(doc: XNode): void {
  let order = 0;
  doc.order = order++;
  for (const n of descendants(doc)) {
    n.order = order++;
    for (const a of n.attributes) a.order = order++;
  }
}
/** Flag 8: every name without its namespace (MBS: "remove all namespaces before query to have queries easier"). */
function withoutNamespaces(doc: XNode): XNode {
  const c = clone(doc, null);
  for (const n of descendants(c)) {
    if (n.kind !== 'element') continue;
    Object.assign(n, { name: n.localName, prefix: '', namespaceURI: '', nsDecls: [], scope: new Map() });
    n.attributes = n.attributes.filter((a) => a.prefix !== 'xmlns' && a.name !== 'xmlns');
    const seen = new Set<string>();
    for (const a of n.attributes) {
      if (seen.has(a.localName)) fail(`Without namespaces, <${n.name}> would have the attribute "${a.localName}" twice`);
      seen.add(a.localName);
      Object.assign(a, { name: a.localName, prefix: '', namespaceURI: '' });
    }
  }
  return c;
}

/** A copy of an element to be the root of its own document, declaring the namespaces it uses that its ancestors
 * declared, so the copy means what it meant in place (as libxml2's xmlDocCopyNode does, inferred). */
function asRoot(n: XNode, parent: XNode | null): XNode {
  const c = clone(n, parent);
  const declared = new Set(c.nsDecls.map(([p]) => p));
  const add = (prefix: string, uri: string) => {
    if (declared.has(prefix) || prefix === 'xml') return;
    declared.add(prefix);
    c.nsDecls.push([prefix, uri]);
  };
  for (const x of [c, ...descendants(c)]) {
    if (x.kind !== 'element') continue;
    if (x.prefix || x.namespaceURI) add(x.prefix, x.namespaceURI);
    for (const a of x.attributes) if (a.prefix && a.prefix !== 'xmlns') add(a.prefix, a.namespaceURI);
  }
  return c;
}

// --- writing, as libxml2 does --------------------------------------------------------------------

const escText = (s: string) => budgetReplace(s, /[&<>\r\x00-\x08\x0b\x0c\x0e-\x1f]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? `&#${c.charCodeAt(0)};`);
const escAttr = (s: string) => budgetReplace(s, /[&<>"\n\r\t\x00-\x08\x0b\x0c\x0e-\x1f]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? `&#${c.charCodeAt(0)};`);
const blank = (n: XNode) => n.kind === 'text' && !n.cdata && !/[^ \t\r\n]/.test(n.value);
/** Without the whitespace-only text between elements, as libxml2 drops it: only where there are elements and the
 * element doesn't start or end with real text (then the spaces are part of the text). */
function withoutBlanks(children: XNode[]): XNode[] {
  if (!children.some((c) => c.kind === 'element')) return children;
  const real = (n: XNode | undefined) => n?.kind === 'text' && !blank(n);
  if (real(children[0]) || real(children[children.length - 1])) return children;
  return children.filter((c) => !blank(c));
}
// libxml2 indents at most 60 spaces.
const indentOf = (level: number) => '  '.repeat(Math.min(level, 30));

class XmlChunks {
  private readonly parts: string[] = [];
  private size = 0;
  push(...parts: string[]): void {
    const size = this.size + parts.reduce((n, s) => n + s.length, 0);
    workBudget()?.checkText(size);
    workBudget()?.text(size - this.size);
    workBudget()?.nodes(parts.length);
    this.size = size;
    this.parts.push(...parts);
  }
  join(): string { return this.parts.join(''); }
}
interface Write { format: boolean; noEmptyTags: boolean }
function dump(n: XNode, w: Write, level: number, out: XmlChunks): void {
  return budgetDepth(() => {
    switch (n.kind) {
      case 'document':
        for (const c of n.children) {
          dump(c, w, 0, out);
          out.push('\n');
        }
        return;
      case 'element': {
        out.push('<', n.name);
        for (const [prefix, uri] of n.nsDecls) out.push(` ${prefix ? `xmlns:${prefix}` : 'xmlns'}="${escAttr(uri)}"`);
        for (const a of n.attributes) out.push(` ${a.name}="${escAttr(a.value)}"`);
        let children = n.children;
        if (w.format) children = withoutBlanks(children);
        if (!children.length) {
          out.push(w.noEmptyTags ? `></${n.name}>` : '/>');
          return;
        }
        const indent = w.format && !children.some((c) => c.kind === 'text');
        out.push('>');
        if (indent) out.push('\n');
        for (const c of children) {
          if (indent) out.push(indentOf(level + 1));
          dump(c, { ...w, format: indent }, level + 1, out);
          if (indent) out.push('\n');
        }
        if (indent) out.push(indentOf(level));
        out.push(`</${n.name}>`);
        return;
      }
      case 'attribute':
        out.push(`${n.name}="${escAttr(n.value)}"`);
        return;
      case 'text':
        // A CDATA section can't hold "]]>", so it is split there.
        out.push(n.cdata ? `<![CDATA[${budgetReplace(n.value, /]]>/g, () => ']]]]><![CDATA[>')}]]>` : escText(n.value));
        return;
      case 'comment':
        out.push(`<!--${n.value}-->`);
        return;
      case 'processing-instruction':
        out.push(`<?${n.name}${n.value ? ` ${n.value}` : ''}?>`);
        return;
      case 'namespace':
        out.push(`${n.name ? `xmlns:${n.name}` : 'xmlns'}="${escAttr(n.value)}"`);
    }
  });
}
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';
/** A whole document, or a node written as one (with the declaration unless `bare`). */
function write(scope: object, n: XNode, format: boolean, bare = false): string {
  return withXmlWorkBudget(() => {
    try {
      const out = new XmlChunks();
      dump(n, { format, noEmptyTags: sessionOf(scope).noEmptyTags }, 0, out);
      const body = out.join().replace(/\n$/, '');
      workBudget()?.checkText(body.length + (bare ? 0 : DECLARATION.length));
      return bare ? body : DECLARATION + body;
    } catch (e) {
      rethrowExecutionRefusal(e);
      throw e;
    }
  });
}

// --- paths ------------------------------------------------------------------------------------
// MBS: node names joined by dots (or new lines), each with an optional 0-based index in brackets, and "#name" at
// the end for an attribute; "\." is a dot in a name. Empty brackets or an index past the end add a node when
// setting. A name without an index is its first node (inferred). The first name is the root element.

interface Step { name: string; index?: number | 'new' }
interface Path { steps: Step[]; attribute?: string }
function pathOf(path: string): Path {
  const raw: string[] = [''];
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (c === '\\' && path[i + 1] === '.') raw[raw.length - 1] += path[++i];
    else if (c === '.' || c === '\r' || c === '\n') raw.push('');
    else raw[raw.length - 1] += c;
  }
  let attribute: string | undefined;
  const last = raw[raw.length - 1];
  const hash = last.indexOf('#');
  if (hash >= 0) {
    attribute = last.slice(hash + 1);
    raw[raw.length - 1] = last.slice(0, hash);
    if (!attribute) fail(`No attribute name after # in "${path}"`);
    // An attribute name with spaces, quotes or = would write more than one attribute.
    if (/[\s"'<>=&\/]/.test(attribute)) fail(`"${attribute}" is not an attribute name`);
  }
  if (raw.length > 512) fail('The path has more than 512 steps');
  const steps = raw.map((r) => {
    const m = /^(.*?)(?:\[(\d*)\])?$/s.exec(r)!;
    if (!m[1]) fail(`The path "${path}" has an empty node name`);
    return { name: m[1], index: m[2] === undefined ? undefined : m[2] === '' ? ('new' as const) : Number(m[2]) };
  });
  return { steps, attribute };
}
const elementsNamed = (parent: XNode, name: string) => parent.children.filter((c) => c.kind === 'element' && c.name === name);

/** The element a path names; with `create`, missing nodes on the way are added. */
function walk(doc: XNode, p: Path, create: boolean, until = p.steps.length): XNode {
  const top = root(doc);
  const first = p.steps[0];
  if (first.name !== top.name || (typeof first.index === 'number' && first.index !== 0)) fail(`The root element is <${top.name}>, not <${first.name}>`);
  let at = top;
  for (const step of p.steps.slice(1, until)) {
    const found = elementsNamed(at, step.name);
    const i = step.index === undefined ? 0 : step.index;
    const hit = i === 'new' ? undefined : found[i];
    if (hit) at = hit;
    else if (create) at = append(at, element(at, step.name));
    else fail(`No node "${step.name}${step.index === undefined ? '' : `[${step.index === 'new' ? '' : step.index}]`}" in <${at.name}>`);
  }
  return at;
}
function element(parent: XNode, name: string): XNode {
  const el = makeNode('element', parent, 0);
  const colon = name.indexOf(':');
  el.name = name;
  el.prefix = colon > 0 ? name.slice(0, colon) : '';
  el.localName = colon > 0 ? name.slice(colon + 1) : name;
  el.scope = parent.scope;
  el.namespaceURI = parent.scope?.get(el.prefix) ?? '';
  return el;
}
const append = (parent: XNode, child: XNode): XNode => {
  child.parent = parent;
  parent.children.push(child);
  return child;
};
function textNode(parent: XNode, value: string, cdata: boolean): XNode {
  const t = makeNode('text', parent, 0);
  t.value = value;
  t.cdata = cdata;
  return t;
}

const FLAG = { format: 4, noNamespaces: 8, asXml: 32, noDeclaration: 64 };
const flagsOf = (s: string | undefined) => {
  const t = (s ?? '').trim();
  if (t === '') return 0;
  if (!/^\d+$/.test(t)) fail(`"${s}" is not a number (flags)`);
  return Number(t);
};

/** A change through a path: on a reference without flag 32 the reference itself changes and the result is OK. */
const change = (f: (doc: XNode, p: Path, arg: string) => void): MbsXml => ([xml = '', path = '', flags, arg = ''], scope) => {
  const inp = input(scope, xml);
  const fl = flagsOf(flags);
  const p = pathOf(path);
  // A reference changes only when the whole change works: the work is done on a copy that then takes its place.
  const doc = inp.ref !== undefined ? clone(inp.doc, null) : inp.doc;
  f(doc, p, arg);
  renumber(doc);
  if (inp.ref !== undefined && !(fl & FLAG.asXml)) {
    sessionOf(scope).refs.set(inp.ref, doc);
    return 'OK';
  }
  return write(scope, doc, !!(fl & FLAG.format));
};

function setValue(doc: XNode, p: Path, value: string, cdata: boolean): void {
  if (p.attribute !== undefined && cdata) fail('An attribute has no CDATA');
  const el = walk(doc, p, true);
  if (p.attribute !== undefined) {
    let a = el.attributes.find((x) => x.name === p.attribute);
    if (!a) {
      a = makeNode('attribute', el, 0);
      const colon = p.attribute.indexOf(':');
      a.name = p.attribute;
      a.prefix = colon > 0 ? p.attribute.slice(0, colon) : '';
      a.localName = colon > 0 ? p.attribute.slice(colon + 1) : p.attribute;
      a.namespaceURI = a.prefix ? (el.scope?.get(a.prefix) ?? '') : '';
      el.attributes.push(a);
    }
    a.value = value;
  } else el.children = [textNode(el, value, cdata)];
}

// --- queries -----------------------------------------------------------------------------------

/** XML.SubTree's steps: each the first element of that name below the last (at any depth, inferred); the last step's matches, in document order. */
function subTrees(doc: XNode, names: string[]): XNode[] {
  const below = (n: XNode, name: string, all: boolean): XNode[] => {
    const out: XNode[] = [];
    const stack = [...n.children].reverse();
    while (stack.length) {
      const c = stack.pop()!;
      if (c.kind !== 'element') continue;
      if (c.name === name) {
        out.push(c);
        if (!all) return out;
      }
      for (let k = c.children.length - 1; k >= 0; k--) stack.push(c.children[k]);
    }
    return out;
  };
  let at: XNode = doc;
  for (let i = 0; i < names.length - 1; i++) {
    const [next] = below(at, names[i], false);
    if (!next) return [];
    at = next;
  }
  return below(at, names[names.length - 1], true);
}
const lines = (s: string) => s.split(/\r\n|\r|\n/).filter((x) => x !== '');

function query(scope: object, doc: XNode, path: string, namespaces: string, fl: number): string {
  return withXmlWorkBudget(() => {
    let r;
    try {
      r = evaluateXPath(doc, path, namespaces);
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof XPathError) throw new MbsError(e.message);
      throw e;
    }
    if (r.type === 'string') return r.value;
    if (r.type === 'number') return formatNumber(r.value);
    if (r.type === 'boolean') return r.value ? 'true' : 'false';
    const nodes = fl & 16 ? r.nodes.slice(0, 1) : r.nodes;
    if (!nodes.length) return '';
    const format = !(fl & FLAG.format);
    // Flag 2, or text nodes only: their text, one per line (FileMaker's return between them, inferred).
    if (fl & 2 || nodes.every((n) => n.kind === 'text')) return xpathValues({ type: 'nodeset', nodes });
    const one = (n: XNode) => write(scope, n, format, true);
    if (fl & FLAG.asXml) {
      const parts: string[] = [];
      for (const n of nodes) { const s = one(n); workBudget()?.output(s.length + (parts.length ? 1 : 0)); parts.push(s); }
      return parts.join('\n');
    }
    if (nodes.length === 1) return write(scope, nodes[0], format);
    // Several nodes go in a <result> element (MBS's description); attributes are written as name="value" there.
    const result = makeNode('element', null, 0);
    result.name = result.localName = 'result';
    result.children = nodes;
    return write(scope, result, format);
  });
}

const xmlText = (scope: object, s: string): string => {
  const inp = input(scope, s);
  return inp.ref === undefined ? s : write(scope, inp.doc, false);
};
function xslt(scope: object, xml: string, style: string, params: Map<string, string>): string {
  try {
    return applyXslt(xmlText(scope, xml), xmlText(scope, style), { params }).replace(/\n$/, '');
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof XsltError || e instanceof XPathError) throw new MbsError(e.message);
    throw e;
  }
}

export const MBS_XML: Record<string, MbsXml> = {
  'xml.parse': ([xml = ''], scope) => keep(scope, parse(xml)),
  // One reference or a list of them (MBS's XML.ItemRefs example passes a list).
  'xml.release': ([refs = ''], scope) => {
    const s = sessionOf(scope);
    for (const r of lines(refs)) if (!s.refs.delete(Number(r.trim()))) fail(`"${r}" is not an XML reference`);
    return 'OK';
  },
  'xml.releaseall': (_, scope) => {
    sessionOf(scope).refs.clear();
    return 'OK';
  },
  'xml.list': (_, scope) => [...sessionOf(scope).refs.keys()].join('\r'),
  // A reference for each element under the root.
  'xml.itemrefs': ([xml = '', flags], scope) => {
    let doc = input(scope, xml).doc;
    if (flagsOf(flags) & FLAG.noNamespaces) doc = withoutNamespaces(doc);
    const s = sessionOf(scope);
    const children = root(doc).children.filter((c) => c.kind === 'element');
    if (s.refs.size + children.length > MAX_LIVE)
      throw new MbsError(`Too many XML references are open (${MAX_LIVE}); release them with XML.Release`);
    const docs = children.map((c) => {
      const d = makeNode('document', null, 0);
      d.children = [asRoot(c, d)];
      renumber(d);
      return d;
    });
    const first = s.next;
    try {
      for (const d of docs) s.refs.set(s.next++, d);
    } catch (e) {
      for (let ref = first; ref < s.next; ref++) s.refs.delete(ref);
      s.next = first;
      throw e;
    }
    return docs.map((_, i) => first + i).join('\r');
  },
  // MBS: one setting for all XML functions; Tabularius keeps it for the session (inferred).
  'xml.setsavenoemptytags': ([flag = ''], scope) => {
    sessionOf(scope).noEmptyTags = flagsOf(flag) === 1;
    return 'OK';
  },
  'xml.getsavenoemptytags': (_, scope) => (sessionOf(scope).noEmptyTags ? 1 : 0),

  'xml.getpathvalue': ([xml = '', path = '', flags], scope) => {
    const fl = flagsOf(flags);
    try {
      let doc = input(scope, xml).doc;
      if (fl & FLAG.noNamespaces) doc = withoutNamespaces(doc);
      const p = pathOf(path);
      const el = walk(doc, p, false);
      if (p.attribute !== undefined) {
        const a = el.attributes.find((x) => x.name === p.attribute);
        if (!a) fail(`<${el.name}> has no attribute "${p.attribute}"`);
        return a!.value;
      }
      // Flag 32: the node as XML "if it's more than just a text".
      if (fl & FLAG.asXml && el.children.some((c) => c.kind === 'element')) return write(scope, el, !!(fl & FLAG.format));
      return stringValue(el);
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (fl & 2 && e instanceof MbsError) return '';
      throw e;
    }
  },
  'xml.setpathvalue': change((doc, p, value) => setValue(doc, p, value, false)),
  'xml.setpathcdata': change((doc, p, value) => setValue(doc, p, value, true)),
  // The new XML takes the place of the node the path names, or is added when there's none (MBS's examples).
  'xml.setpathxml': change((doc, p, xml) => {
    if (p.attribute !== undefined) fail('XML.SetPathXML needs a path to a node, not an attribute');
    if (p.steps.length < 2) fail('XML.SetPathXML can\'t replace the root element');
    const fresh = root(parse(xml));
    const parent = walk(doc, p, true, p.steps.length - 1);
    const node = clone(fresh, parent);
    const last = p.steps[p.steps.length - 1];
    const found = elementsNamed(parent, last.name);
    const i = last.index === undefined ? 0 : last.index;
    const old = i === 'new' ? undefined : found[i];
    if (old) parent.children[parent.children.indexOf(old)] = node;
    else parent.children.push(node);
  }),
  'xml.deletepath': change((doc, p) => {
    const el = walk(doc, p, false);
    if (p.attribute !== undefined) {
      const at = el.attributes.findIndex((x) => x.name === p.attribute);
      if (at < 0) fail(`<${el.name}> has no attribute "${p.attribute}"`);
      el.attributes.splice(at, 1);
    } else {
      if (p.steps.length < 2) fail('XML.DeletePath can\'t delete the root element');
      el.parent!.children.splice(el.parent!.children.indexOf(el), 1);
    }
  }),

  'xml.format': ([xml = '', flags], scope) => {
    const fl = flagsOf(flags);
    let doc = input(scope, xml).doc;
    if (fl & FLAG.noNamespaces) doc = withoutNamespaces(doc);
    const out = write(scope, doc, true);
    return fl & FLAG.noDeclaration ? out.slice(DECLARATION.length) : out;
  },
  // Spaces and line breaks between elements go (inferred: text inside an element stays as it is).
  'xml.compact': ([xml = '', flags], scope) => {
    const fl = flagsOf(flags);
    let doc = clone(input(scope, xml).doc, null);
    if (fl & FLAG.noNamespaces) doc = withoutNamespaces(doc);
    for (const n of [doc, ...descendants(doc)]) n.children = withoutBlanks(n.children);
    const out = write(scope, doc, false);
    return fl & FLAG.noDeclaration ? out.slice(DECLARATION.length) : out;
  },
  'xml.query': ([xml = '', path = '', namespaces = '', flags], scope) => withXmlWorkBudget(() => {
    try {
      const fl = flagsOf(flags);
      let doc = input(scope, xml).doc;
      if (fl & FLAG.noNamespaces) doc = withoutNamespaces(doc);
      return query(scope, doc, path, namespaces, fl);
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof XPathError) throw new MbsError(e.message);
      throw e;
    }
  }),
  // Parameters as name=value lines; libxslt reads each value as an XPath expression, so text needs quotes (inferred
  // from XML.ApplyStylesheet2's "may be quoted with single quotes").
  'xml.applystylesheet': ([xml = '', style = '', params = ''], scope) => {
    const map = new Map<string, string>();
    for (const line of lines(params)) {
      const eq = line.indexOf('=');
      if (eq <= 0) fail(`"${line}" is not a name=value parameter`);
      map.set(line.slice(0, eq).trim(), line.slice(eq + 1));
    }
    return xslt(scope, xml, style, map);
  },
  'xml.applystylesheet2': ([xml = '', style = '', ...pairs], scope) => {
    if (pairs.length % 2) fail('Pass the parameters as name and value pairs');
    const map = new Map<string, string>();
    for (let i = 0; i < pairs.length; i += 2) map.set(pairs[i].trim(), pairs[i + 1]);
    return xslt(scope, xml, style, map);
  },
  // For a whole document, C14N 1.0 (mode 0, the default, inferred) and 1.1 (mode 2) give the same result.
  'xml.canonical': ([xml = '', flags, mode], scope) => {
    const m = flagsOf(mode);
    if (m === 1) fail('Exclusive canonicalization (mode 1) isn\'t available in Tabularius');
    if (m !== 0 && m !== 2) fail('The mode must be 0, 1 or 2');
    try {
      return canonicalXml(xmlText(scope, xml), !!(flagsOf(flags) & 2));
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof XPathError) throw new MbsError(`Failed to parse XML: ${e.message}`);
      throw e;
    }
  },
  // The node becomes the root of its own document; formatted unless flag 4. An index past the matches gives "".
  'xml.subtree': ([xml = '', names = '', flags, index], scope) => {
    const fl = flagsOf(flags);
    let doc = input(scope, xml).doc;
    if (fl & FLAG.noNamespaces) doc = withoutNamespaces(doc);
    const steps = lines(names);
    if (!steps.length) fail('Pass the name of the node');
    const hit = subTrees(doc, steps)[flagsOf(index)];
    return hit ? write(scope, asRoot(hit, null), !(fl & FLAG.format)) : '';
  },
  // The text of every node below, one per line; whitespace between elements is left out (inferred).
  'xml.extracttext': ([xml = ''], scope) =>
    [...descendants(input(scope, xml).doc)].filter((n) => n.kind === 'text' && !blank(n)).map((n) => n.value).join('\r'),
  // The root's children's names (with Recursive, every element below it), each once, in order. Flag 16 leaves out empty elements.
  'xml.nodenames': ([xml = '', recursive, flags], scope) => {
    const top = root(input(scope, xml).doc);
    const all = flagsOf(recursive) ? [...descendants(top)] : top.children;
    const skipEmpty = !!(flagsOf(flags) & 16);
    const names = new Set<string>();
    for (const n of all) if (n.kind === 'element' && !(skipEmpty && n.children.every(blank))) names.add(n.name);
    return [...names].join('\r');
  },
  // How many children of that name; a list of names steps down first (each the first of its name).
  'xml.nodecount': ([xml = '', names = ''], scope) => {
    const steps = lines(names);
    if (!steps.length) fail('Pass the name of the node');
    let at = root(input(scope, xml).doc);
    for (const step of steps.slice(0, -1)) at = elementsNamed(at, step)[0] ?? fail(`No node "${step}" in <${at.name}>`);
    return elementsNamed(at, steps[steps.length - 1]).length;
  },
  'xml.listattributes': ([xml = ''], scope) => root(input(scope, xml).doc).attributes.map((a) => a.name).join('\r'),
  'xml.getattribute': ([xml = '', name = ''], scope) => {
    const top = root(input(scope, xml).doc);
    return top.attributes.find((a) => a.name === name)?.value ?? fail(`<${top.name}> has no attribute "${name}"`);
  },
  'xml.hasattribute': ([xml = '', name = ''], scope) => (root(input(scope, xml).doc).attributes.some((a) => a.name === name) ? 1 : 0),
};
