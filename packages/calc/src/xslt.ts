// XSLT 1.0 on top of the XPath 1.0 engine in xpath.ts. The result tree is built from the same
// XNode records (so result tree fragments can be used as node-sets, like exsl:node-set) and
// serialized the way libxslt's xsltproc writes it: an XML declaration and a trailing newline for
// the xml method, libxml2's HTML formatting (and its Content-Type meta) for the html method, and
// the bare text for the text method. xsl:include and xsl:import are not supported; document()
// only knows document('') (the stylesheet itself); disable-output-escaping is ignored.

import { rethrowExecutionRefusal } from './execution-refusal.ts';
import {
  XPathError, bool, coreFunctionNames, compilePattern, compileXPath, evaluateCompiled, expandedName, formatNumber, inDocumentOrder,
  makeNode, matchPattern, num, parseXmlDocument, str, stringValue,
  type CompiledPattern, type CompiledXPath, type XNode, type XPathContext, type XPathEnv, type XPathFunction, type XValue,
} from './xpath.ts';

export class XsltError extends Error {}

export interface XsltOptions {
  /** Receives the text of each xsl:message (by default messages are dropped). */
  onMessage?: (text: string, terminate: boolean) => void;
  /** Values for top-level xsl:param, by name, each an XPath expression (as libxslt takes them: text needs quotes). */
  params?: Map<string, string>;
}

const XSL = 'http://www.w3.org/1999/XSL/Transform';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XSLT_FUNCTIONS = ['current', 'key', 'generate-id', 'document', 'format-number', 'system-property', 'element-available', 'function-available', 'unparsed-entity-uri'];
const INSTRUCTIONS = new Set([
  'apply-templates', 'call-template', 'apply-imports', 'for-each', 'value-of', 'copy', 'copy-of', 'number', 'choose', 'if', 'text',
  'element', 'attribute', 'comment', 'processing-instruction', 'variable', 'message', 'fallback',
]);

let order = 2 ** 40;
const node = (kind: XNode['kind'], parent: XNode | null): XNode => makeNode(kind, parent, order++);

const fail = (msg: string): never => {
  throw new XsltError(msg);
};

// ---- Small helpers on stylesheet elements

const isXsl = (n: XNode, local?: string): boolean => n.kind === 'element' && n.namespaceURI === XSL && (local === undefined || n.localName === local);
const attr = (el: XNode, name: string): string | undefined => el.attributes.find((a) => a.name === name && !a.namespaceURI)?.value;
const xslAttr = (el: XNode, local: string): string | undefined => el.attributes.find((a) => a.namespaceURI === XSL && a.localName === local)?.value;
const describe = (el: XNode): string => `<${el.name}>`;
const required = (el: XNode, name: string): string => attr(el, name) ?? fail(`${describe(el)} needs a "${name}" attribute`);
const elementChildren = (el: XNode): XNode[] => el.children.filter((c) => c.kind === 'element');

/** Splits a QName and resolves its prefix against an element's in-scope namespaces. */
function resolveQName(qname: string, scope: Map<string, string> | null, useDefault: boolean, where: string): { prefix: string; local: string; uri: string } {
  const q = qname.trim();
  if (!/^(?:[A-Za-z_À-￿][\w.\-·À-￿]*:)?[A-Za-z_À-￿][\w.\-·À-￿]*$/.test(q)) fail(`"${qname}" is not a valid QName in ${where}`);
  const colon = q.indexOf(':');
  if (colon < 0) return { prefix: '', local: q, uri: useDefault ? (scope?.get('') ?? '') : '' };
  const prefix = q.slice(0, colon);
  const uri = prefix === 'xml' ? XML_NS : scope?.get(prefix);
  if (!uri) fail(`Undeclared namespace prefix "${prefix}" in ${where}`);
  return { prefix, local: q.slice(colon + 1), uri: uri! };
}
const expandQName = (qname: string, scope: Map<string, string> | null, where: string): string => {
  const { uri, local } = resolveQName(qname, scope, false, where);
  return expandedName(uri, local);
};

/**
 * The namespace declarations to carry over when copying an element. Like libxslt, these are the
 * declarations made on the element itself; the serializer adds any its name and attributes need.
 */
const copiedNamespaces = (el: XNode): [string, string][] => el.nsDecls.map(([p, u]): [string, string] => [p, u]);

// ---- Result tree building

function addText(parent: XNode, text: string): void {
  if (!text) return;
  const last = parent.children.at(-1);
  if (last?.kind === 'text') last.value += text;
  else {
    const t = node('text', parent);
    t.value = text;
    parent.children.push(t);
  }
}
function addChild(parent: XNode, n: XNode): XNode {
  n.parent = parent;
  parent.children.push(n);
  return n;
}
function addAttribute(parent: XNode, name: string, prefix: string, local: string, uri: string, value: string): void {
  // Attributes after children, or outside an element, are a recoverable error: they are dropped.
  if (parent.kind !== 'element' || parent.children.length) return;
  const at = parent.attributes.findIndex((a) => a.localName === local && a.namespaceURI === uri);
  const a = node('attribute', parent);
  Object.assign(a, { name, prefix, localName: local, namespaceURI: uri, value });
  // A replaced attribute moves to the end, as in libxslt.
  if (at >= 0) parent.attributes.splice(at, 1);
  parent.attributes.push(a);
}
function newElement(parent: XNode, prefix: string, local: string, uri: string, nsDecls: [string, string][]): XNode {
  const el = node('element', parent);
  Object.assign(el, { name: prefix ? `${prefix}:${local}` : local, prefix, localName: local, namespaceURI: uri, nsDecls });
  parent.children.push(el);
  return el;
}

// ---- Number formatting (xsl:number)

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function groupDigits(digits: string, sep: string, size: number): string {
  if (!sep || !(size > 0)) return digits;
  let out = '';
  for (let k = digits.length; k > 0; k -= size) out = digits.slice(Math.max(0, k - size), k) + (out ? sep + out : '');
  return out;
}
function formatOne(n: number, token: string, sep: string, size: number): string {
  if (!Number.isFinite(n)) return formatNumber(n);
  if (n >= 1 && (token === 'a' || token === 'A')) {
    let s = '';
    for (let m = n; m > 0; m = Math.floor((m - 1) / 26)) s = String.fromCharCode(97 + ((m - 1) % 26)) + s;
    return token === 'A' ? s.toUpperCase() : s;
  }
  if (n >= 1 && n < 5000 && (token === 'i' || token === 'I')) {
    let s = '';
    let m = n;
    for (const [v, r] of ROMAN) for (; m >= v; m -= v) s += r;
    return token === 'I' ? s.toUpperCase() : s;
  }
  const width = /^0*1$/.test(token) ? token.length : 1;
  const digits = String(Math.abs(n)).padStart(width, '0');
  return (n < 0 ? '-' : '') + groupDigits(digits, sep, size);
}
function formatNumberList(nums: number[], format: string, sep: string, size: number): string {
  const tokens: string[] = [];
  const seps: string[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let last = 0;
  let prefix = '';
  for (const m of format.matchAll(re)) {
    const between = format.slice(last, m.index);
    if (tokens.length) seps.push(between);
    else prefix = between;
    tokens.push(m[0]);
    last = m.index! + m[0].length;
  }
  const suffix = tokens.length ? format.slice(last) : '';
  if (!tokens.length) {
    prefix = format;
    tokens.push('1');
  }
  if (!nums.length) return '';
  let out = prefix;
  nums.forEach((n, k) => {
    if (k > 0) out += seps[Math.min(k, tokens.length) - 1] ?? seps.at(-1) ?? '.';
    out += formatOne(n, tokens[Math.min(k, tokens.length - 1)], sep, size);
  });
  return out + suffix;
}

// ---- format-number()

interface DecimalFormat {
  decimal: string; grouping: string; infinity: string; minus: string; nan: string; percent: string; perMille: string; zero: string; digit: string; pattern: string;
}
const DEFAULT_DECIMAL_FORMAT: DecimalFormat = {
  decimal: '.', grouping: ',', infinity: 'Infinity', minus: '-', nan: 'NaN', percent: '%', perMille: '‰', zero: '0', digit: '#', pattern: ';',
};

function formatDecimal(x: number, picture: string, f: DecimalFormat): string {
  const [posPic, negPic] = picture.split(f.pattern);
  const parse = (pic: string) => {
    const numeric = new Set([f.digit, f.zero, f.grouping, f.decimal]);
    let start = 0;
    while (start < pic.length && !numeric.has(pic[start])) start++;
    let end = start;
    while (end < pic.length && numeric.has(pic[end])) end++;
    const prefix = pic.slice(0, start).replace(/'/g, '');
    const suffix = pic.slice(end).replace(/'/g, '');
    const body = pic.slice(start, end);
    const dot = body.indexOf(f.decimal);
    const intPart = dot < 0 ? body : body.slice(0, dot);
    const fracPart = dot < 0 ? '' : body.slice(dot + 1);
    const lastGroup = intPart.lastIndexOf(f.grouping);
    const affix = prefix + suffix;
    return {
      prefix, suffix,
      minInt: [...intPart].filter((c) => c === f.zero).length,
      group: lastGroup < 0 ? 0 : intPart.length - lastGroup - 1,
      minFrac: [...fracPart].filter((c) => c === f.zero).length,
      maxFrac: [...fracPart].filter((c) => c === f.zero || c === f.digit).length,
      scale: affix.includes(f.percent) ? 100 : affix.includes(f.perMille) ? 1000 : 1,
    };
  };
  if (Number.isNaN(x)) return f.nan;
  const pos = parse(posPic);
  const neg = negPic !== undefined ? parse(negPic) : { ...pos, prefix: f.minus + pos.prefix };
  const p = x < 0 || Object.is(x, -0) ? neg : pos;
  const abs = Math.abs(x) * p.scale;
  if (!Number.isFinite(abs)) return p.prefix + f.infinity + p.suffix;
  let [ip, fp = ''] = (Math.round(abs * 10 ** p.maxFrac) / 10 ** p.maxFrac).toFixed(p.maxFrac).split('.');
  while (fp.length > p.minFrac && fp.endsWith('0')) fp = fp.slice(0, -1);
  if (ip === '0' && p.minInt === 0) ip = '';
  ip = groupDigits(ip.padStart(p.minInt, '0'), f.grouping, p.group);
  const useNeg = (x < 0 || Object.is(x, -0)) && /[1-9]/.test(ip + fp);
  const q = useNeg ? neg : pos;
  let out = ip + (fp ? f.decimal + fp : '');
  if (f.zero !== '0') out = out.replace(/[0-9]/g, (d) => String.fromCodePoint(f.zero.codePointAt(0)! + Number(d)));
  return q.prefix + (out || f.zero) + q.suffix;
}

// ---- The transformation

interface Template { match?: CompiledPattern[]; name?: string; mode: string; priority?: number; body: XNode; index: number }
interface Rule { pattern: CompiledPattern; priority: number; template: Template }
type Scope = { name: string; value: XValue; next: Scope } | null;
interface Ctx { node: XNode; pos: number; size: number; mode: string; scope: Scope }
interface OutputSettings {
  method?: string; version?: string; encoding?: string; omitXmlDeclaration?: boolean; standalone?: string;
  doctypePublic?: string; doctypeSystem?: string; indent?: boolean; cdata: Set<string>;
}
interface SpaceRule { uri?: string; local?: string; priority: number; strip: boolean; index: number }
interface Global { el: XNode; state: 'new' | 'busy' | 'done'; value?: XValue }
type AvtPart = string | CompiledXPath;

class Transformer {
  readonly templates: Template[] = [];
  readonly named = new Map<string, Template>();
  readonly rules = new Map<string, Rule[]>();
  readonly globals = new Map<string, Global>();
  readonly keys = new Map<string, { match: CompiledPattern[]; use: CompiledXPath; el: XNode }[]>();
  readonly keyIndex = new Map<string, Map<XNode, Map<string, XNode[]>>>();
  readonly attributeSets = new Map<string, XNode[]>();
  readonly decimalFormats = new Map<string, DecimalFormat>([['', DEFAULT_DECIMAL_FORMAT]]);
  readonly aliases = new Map<string, { prefix: string; uri: string }>();
  readonly space: SpaceRule[] = [];
  readonly output: OutputSettings = { cdata: new Set() };
  readonly functions: Map<string, XPathFunction>;
  readonly xpaths = new WeakMap<XNode, Map<string, CompiledXPath>>();
  readonly patterns = new WeakMap<XNode, Map<string, CompiledPattern[]>>();
  readonly avts = new WeakMap<XNode, Map<string, AvtPart[]>>();
  readonly excluded = new WeakMap<XNode, Set<string>>();
  readonly ids = new WeakMap<XNode, string>();
  forwards = false;
  idCount = 0;
  source!: XNode;
  depth = 0;

  readonly style: XNode;
  readonly options: XsltOptions;

  constructor(style: XNode, options: XsltOptions) {
    this.style = style;
    this.options = options;
    this.functions = this.makeFunctions();
    stripStylesheet(style);
    const root = elementChildren(style)[0];
    if (isXsl(root) && (root.localName === 'stylesheet' || root.localName === 'transform')) {
      if (attr(root, 'version') === undefined) fail('xsl:stylesheet needs a "version" attribute');
      this.forwards = attr(root, 'version') !== '1.0';
      this.topLevel(root);
    } else {
      const version = xslAttr(root, 'version');
      if (version === undefined) fail('The stylesheet\'s root element must be xsl:stylesheet, xsl:transform or a literal result element with xsl:version');
      this.forwards = version !== '1.0';
      const body = node('element', null);
      body.children = [root];
      this.addTemplate({ mode: '', body, index: 0, match: this.pattern(root, '/', '/') });
    }
  }

  private topLevel(sheet: XNode): void {
    let index = 0;
    for (const c of sheet.children) {
      if (c.kind === 'text') fail('Text is not allowed at the top level of a stylesheet');
      if (c.kind !== 'element') continue;
      if (c.namespaceURI !== XSL) {
        if (!c.namespaceURI) fail(`Top-level element ${describe(c)} must be in a namespace`);
        continue;
      }
      const where = `xsl:${c.localName}`;
      switch (c.localName) {
        case 'include':
        case 'import':
          fail(`${where} is not supported`);
          break;
        case 'template': {
          const match = attr(c, 'match');
          const name = attr(c, 'name');
          if (match === undefined && name === undefined) fail('xsl:template needs a "match" or "name" attribute');
          const prio = attr(c, 'priority');
          const priority = prio === undefined ? undefined : Number(prio);
          if (priority !== undefined && Number.isNaN(priority)) fail(`Bad priority "${prio}" on xsl:template`);
          const mode = attr(c, 'mode');
          if (mode !== undefined && match === undefined) fail('xsl:template with a mode needs a "match" attribute');
          const t: Template = {
            body: c, index: index++, priority,
            mode: mode === undefined ? '' : expandQName(mode, c.scope, where),
            match: match === undefined ? undefined : this.pattern(c, 'match', match),
            name: name === undefined ? undefined : expandQName(name, c.scope, where),
          };
          this.addTemplate(t);
          break;
        }
        case 'variable':
        case 'param': {
          const name = expandQName(required(c, 'name'), c.scope, where);
          this.globals.set(name, { el: c, state: 'new' });
          break;
        }
        case 'key': {
          const name = expandQName(required(c, 'name'), c.scope, where);
          const list = this.keys.get(name) ?? [];
          list.push({ el: c, match: this.pattern(c, 'match', required(c, 'match')), use: this.xpath(c, 'use') });
          this.keys.set(name, list);
          break;
        }
        case 'attribute-set': {
          const name = expandQName(required(c, 'name'), c.scope, where);
          this.attributeSets.set(name, [...(this.attributeSets.get(name) ?? []), c]);
          break;
        }
        case 'strip-space':
        case 'preserve-space':
          for (const t of required(c, 'elements').split(/\s+/).filter(Boolean)) {
            const strip = c.localName === 'strip-space';
            if (t === '*') this.space.push({ priority: -0.5, strip, index: this.space.length });
            else if (t.endsWith(':*')) this.space.push({ uri: resolveQName(`${t.slice(0, -2)}:x`, c.scope, false, where).uri, priority: -0.25, strip, index: this.space.length });
            else {
              const q = resolveQName(t, c.scope, false, where);
              this.space.push({ uri: q.uri, local: q.local, priority: 0, strip, index: this.space.length });
            }
          }
          break;
        case 'output': {
          const o = this.output;
          const get = (n: string) => attr(c, n);
          const method = get('method');
          if (method !== undefined) {
            if (!['xml', 'html', 'text'].includes(method) && !method.includes(':')) fail(`Unknown output method "${method}"`);
            o.method = method;
          }
          o.version = get('version') ?? o.version;
          o.encoding = get('encoding') ?? o.encoding;
          if (get('omit-xml-declaration') !== undefined) o.omitXmlDeclaration = get('omit-xml-declaration') === 'yes';
          o.standalone = get('standalone') ?? o.standalone;
          o.doctypePublic = get('doctype-public') ?? o.doctypePublic;
          o.doctypeSystem = get('doctype-system') ?? o.doctypeSystem;
          if (get('indent') !== undefined) o.indent = get('indent') === 'yes';
          for (const q of (get('cdata-section-elements') ?? '').split(/\s+/).filter(Boolean)) {
            const r = resolveQName(q, c.scope, true, where);
            o.cdata.add(expandedName(r.uri, r.local));
          }
          break;
        }
        case 'decimal-format': {
          const name = attr(c, 'name');
          const f = { ...DEFAULT_DECIMAL_FORMAT };
          const map: [keyof DecimalFormat, string][] = [
            ['decimal', 'decimal-separator'], ['grouping', 'grouping-separator'], ['infinity', 'infinity'], ['minus', 'minus-sign'], ['nan', 'NaN'],
            ['percent', 'percent'], ['perMille', 'per-mille'], ['zero', 'zero-digit'], ['digit', 'digit'], ['pattern', 'pattern-separator'],
          ];
          for (const [k, a] of map) f[k] = attr(c, a) ?? f[k];
          this.decimalFormats.set(name === undefined ? '' : expandQName(name, c.scope, where), f);
          break;
        }
        case 'namespace-alias': {
          const pref = (p: string) => (p === '#default' ? (c.scope?.get('') ?? '') : (c.scope?.get(p) ?? fail(`Undeclared prefix "${p}" in xsl:namespace-alias`)));
          const resultPrefix = required(c, 'result-prefix');
          this.aliases.set(pref(required(c, 'stylesheet-prefix')), { prefix: resultPrefix === '#default' ? '' : resultPrefix, uri: pref(resultPrefix) });
          break;
        }
        default:
          if (!this.forwards) fail(`Unknown top-level element xsl:${c.localName}`);
      }
    }
    for (const list of this.rules.values()) list.sort((a, b) => b.priority - a.priority || b.template.index - a.template.index);
  }

  private addTemplate(t: Template): void {
    this.templates.push(t);
    if (t.name !== undefined) this.named.set(t.name, t);
    for (const pattern of t.match ?? []) {
      const list = this.rules.get(t.mode) ?? [];
      list.push({ pattern, priority: t.priority ?? pattern.priority, template: t });
      this.rules.set(t.mode, list);
    }
  }

  // ---- Compiling, with caches

  private xpath(el: XNode, name: string, src?: string): CompiledXPath {
    let m = this.xpaths.get(el);
    if (!m) this.xpaths.set(el, (m = new Map()));
    let x = m.get(name);
    if (!x) {
      const text = src ?? required(el, name);
      try {
        x = compileXPath(text, el.scope ?? new Map(), { variables: true, functions: XSLT_FUNCTIONS });
      } catch (e) {
        throw this.wrap(e, el, `${name}="${text}"`);
      }
      m.set(name, x);
    }
    return x;
  }
  private pattern(el: XNode, name: string, src: string): CompiledPattern[] {
    let m = this.patterns.get(el);
    if (!m) this.patterns.set(el, (m = new Map()));
    let p = m.get(name);
    if (!p) {
      try {
        p = compilePattern(src, el.scope ?? new Map(), { functions: XSLT_FUNCTIONS, variables: true });
      } catch (e) {
        throw this.wrap(e, el, `${name}="${src}"`);
      }
      m.set(name, p);
    }
    return p;
  }
  private avt(el: XNode, name: string, value: string): AvtPart[] {
    let m = this.avts.get(el);
    if (!m) this.avts.set(el, (m = new Map()));
    let parts = m.get(name);
    if (!parts) {
      parts = [];
      let lit = '';
      for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '{' && value[i + 1] === '{') {
          lit += '{';
          i++;
        } else if (ch === '}' && value[i + 1] === '}') {
          lit += '}';
          i++;
        } else if (ch === '}') fail(`Unmatched "}" in attribute value template ${name}="${value}" on ${describe(el)}`);
        else if (ch === '{') {
          let j = i + 1;
          for (; j < value.length && value[j] !== '}'; j++) {
            if (value[j] === '"' || value[j] === "'") {
              const close = value.indexOf(value[j], j + 1);
              if (close < 0) break;
              j = close;
            }
          }
          if (j >= value.length) fail(`Unterminated "{" in attribute value template ${name}="${value}" on ${describe(el)}`);
          if (lit) parts.push(lit);
          lit = '';
          parts.push(this.xpath(el, `{${name}@${i}}`, value.slice(i + 1, j)));
          i = j;
        } else lit += ch;
      }
      if (lit) parts.push(lit);
      m.set(name, parts);
    }
    return parts;
  }

  private wrap(e: unknown, el: XNode, what: string): unknown {
    rethrowExecutionRefusal(e);
    if (e instanceof XPathError) return new XsltError(`${e.message} (in ${what} on ${describe(el)})`);
    return e;
  }

  // ---- Evaluating

  private env(el: XNode | null, c: Ctx): XPathEnv {
    return {
      variable: (name) => this.variable(c.scope, name),
      functions: this.functions,
      current: c.node,
      namespaces: el?.scope ?? undefined,
    };
  }
  private evaluate(el: XNode, name: string, c: Ctx, src?: string): XValue {
    const x = this.xpath(el, name, src);
    try {
      return evaluateCompiled(x, { node: c.node, pos: c.pos, size: c.size, env: this.env(el, c) });
    } catch (e) {
      throw this.wrap(e, el, `${name}="${x.src}"`);
    }
  }
  private nodes(el: XNode, name: string, c: Ctx): XNode[] {
    const v = this.evaluate(el, name, c);
    if (!Array.isArray(v)) fail(`${name}="${attr(el, name)}" on ${describe(el)} must select a node-set`);
    return v as XNode[];
  }
  private avtValue(el: XNode, name: string, c: Ctx): string | undefined {
    const raw = attr(el, name);
    if (raw === undefined) return undefined;
    return this.avtString(el, name, raw, c);
  }
  private avtString(el: XNode, name: string, raw: string, c: Ctx): string {
    const parts = this.avt(el, name, raw);
    let out = '';
    for (const p of parts) {
      if (typeof p === 'string') out += p;
      else {
        try {
          out += str(evaluateCompiled(p, { node: c.node, pos: c.pos, size: c.size, env: this.env(el, c) }));
        } catch (e) {
          throw this.wrap(e, el, `${name}="${raw}"`);
        }
      }
    }
    return out;
  }
  matches(patterns: CompiledPattern[], n: XNode): boolean {
    const env: XPathEnv = { functions: this.functions, current: n, variable: (name) => this.variable(null, name) };
    return patterns.some((p) => matchPattern(p, n, env));
  }

  private variable(scope: Scope, name: string): XValue | undefined {
    for (let s = scope; s; s = s.next) if (s.name === name) return s.value;
    const g = this.globals.get(name);
    if (!g) return undefined;
    if (g.state === 'done') return g.value;
    if (g.state === 'busy') fail(`Global variable $${name} is defined in terms of itself`);
    g.state = 'busy';
    const ctx: Ctx = { node: this.source, pos: 1, size: 1, mode: '', scope: null };
    const given = g.el.localName === 'param' ? (this.options.params?.get(name) ?? this.options.params?.get(attr(g.el, 'name') ?? '')) : undefined;
    g.value = given !== undefined ? this.evaluate(g.el, '#given', ctx, given) : this.bindingValue(g.el, ctx);
    g.state = 'done';
    return g.value;
  }
  /** The value of xsl:variable, xsl:param or xsl:with-param: its select, its content as a result tree fragment, or "". */
  private bindingValue(el: XNode, c: Ctx): XValue {
    if (attr(el, 'select') !== undefined) {
      if (el.children.length) fail(`${describe(el)} has both a "select" attribute and content`);
      return this.evaluate(el, 'select', c);
    }
    if (!el.children.length) return '';
    return [this.fragment(el, c)];
  }
  private fragment(el: XNode, c: Ctx): XNode {
    const doc = node('document', null);
    this.sequence(el, c, doc);
    return doc;
  }
  private contentString(el: XNode, c: Ctx): string {
    return stringValue(this.fragment(el, c));
  }

  // ---- Running templates

  run(source: XNode): XNode {
    this.source = source;
    this.stripSource(source);
    const result = node('document', null);
    try {
      this.applyTo([source], { node: source, pos: 1, size: 1, mode: '', scope: null }, '', new Map(), result);
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof RangeError && /call stack/i.test(e.message)) fail('XSLT recursion too deep (does a template call itself without end?)');
      throw e;
    }
    return result;
  }

  private stripSource(doc: XNode): void {
    if (!this.space.length) return;
    const walk = (el: XNode, preserve: boolean): void => {
      const xs = el.attributes.find((a) => a.namespaceURI === XML_NS && a.localName === 'space')?.value;
      if (xs === 'preserve') preserve = true;
      else if (xs === 'default') preserve = false;
      const strip = el.kind === 'element' && !preserve && this.stripsIn(el);
      if (strip) el.children = el.children.filter((ch) => ch.kind !== 'text' || /[^ \t\r\n]/.test(ch.value));
      for (const ch of el.children) if (ch.kind === 'element') walk(ch, preserve);
    };
    walk(doc, false);
  }
  private stripsIn(el: XNode): boolean {
    let best: SpaceRule | undefined;
    for (const r of this.space) {
      if (r.local !== undefined ? r.local !== el.localName || r.uri !== el.namespaceURI : r.uri !== undefined && r.uri !== el.namespaceURI) continue;
      if (!best || r.priority > best.priority || (r.priority === best.priority && r.index > best.index)) best = r;
    }
    return best?.strip ?? false;
  }

  private findRule(n: XNode, mode: string): Template | undefined {
    for (const r of this.rules.get(mode) ?? []) {
      if (r.pattern.localName !== undefined && r.pattern.localName !== n.localName) continue;
      if (this.matches([r.pattern], n)) return r.template;
    }
    return undefined;
  }

  private applyTo(list: XNode[], _outer: Ctx, mode: string, params: Map<string, XValue>, out: XNode): void {
    list.forEach((n, k) => {
      const c: Ctx = { node: n, pos: k + 1, size: list.length, mode, scope: null };
      const t = this.findRule(n, mode);
      if (t) this.invoke(t, c, params, out);
      else this.builtin(c, out);
    });
  }
  private builtin(c: Ctx, out: XNode): void {
    const n = c.node;
    if (n.kind === 'document' || n.kind === 'element') this.applyTo(n.children, c, c.mode, new Map(), out);
    else if (n.kind === 'text' || n.kind === 'attribute') addText(out, n.value);
  }
  private invoke(t: Template, c: Ctx, params: Map<string, XValue>, out: XNode): void {
    if (++this.depth > 3000) fail('XSLT recursion too deep (does a template call itself without end?)');
    try {
      this.sequence(t.body, { ...c, scope: null }, out, params);
    } finally {
      this.depth--;
    }
  }

  private withParams(el: XNode, c: Ctx): Map<string, XValue> {
    const params = new Map<string, XValue>();
    for (const p of elementChildren(el)) {
      if (!isXsl(p, 'with-param')) continue;
      params.set(expandQName(required(p, 'name'), p.scope, 'xsl:with-param'), this.bindingValue(p, c));
    }
    return params;
  }

  private sorted(el: XNode, list: XNode[], c: Ctx): XNode[] {
    const sorts = elementChildren(el).filter((s) => isXsl(s, 'sort'));
    if (!sorts.length) return list;
    const keys = sorts.map((s) => {
      const type = this.avtValue(s, 'data-type', c) ?? 'text';
      const desc = (this.avtValue(s, 'order', c) ?? 'ascending') === 'descending';
      const caseOrder = this.avtValue(s, 'case-order', c);
      const values = list.map((n, k) => {
        const kc: Ctx = { node: n, pos: k + 1, size: list.length, mode: c.mode, scope: c.scope };
        const v = attr(s, 'select') === undefined ? stringValue(n) : str(this.evaluate(s, 'select', kc));
        return type === 'number' ? num(v) : v;
      });
      return { type, desc, caseOrder, values };
    });
    const idx = list.map((_, k) => k);
    const cmpText = (a: string, b: string, caseOrder: string | undefined): number => {
      if (caseOrder === undefined) return a < b ? -1 : a > b ? 1 : 0;
      const la = a.toLowerCase();
      const lb = b.toLowerCase();
      if (la !== lb) return la < lb ? -1 : 1;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue;
        const upperA = a[i] !== a[i].toLowerCase();
        return (upperA ? -1 : 1) * (caseOrder === 'lower-first' ? -1 : 1);
      }
      return 0;
    };
    idx.sort((x, y) => {
      for (const k of keys) {
        const a = k.values[x];
        const b = k.values[y];
        let r: number;
        if (k.type === 'number') {
          const na = a as number;
          const nb = b as number;
          r = Number.isNaN(na) ? (Number.isNaN(nb) ? 0 : -1) : Number.isNaN(nb) ? 1 : na - nb;
        } else r = cmpText(a as string, b as string, k.caseOrder);
        if (r) return k.desc ? -r : r;
      }
      return x - y;
    });
    return idx.map((k) => list[k]);
  }

  /** Runs an element's children as a sequence constructor; xsl:param children take values from `params`. */
  sequence(parent: XNode, c: Ctx, out: XNode, params?: Map<string, XValue>): void {
    let ctx = c;
    for (const ch of parent.children) {
      if (ch.kind === 'text') addText(out, ch.value);
      else if (ch.kind !== 'element') continue;
      else if (isXsl(ch, 'variable') || isXsl(ch, 'param')) {
        const name = expandQName(required(ch, 'name'), ch.scope, `xsl:${ch.localName}`);
        const value = ch.localName === 'param' && params?.has(name) ? params.get(name)! : this.bindingValue(ch, ctx);
        ctx = { ...ctx, scope: { name, value, next: ctx.scope } };
      } else this.instruction(ch, ctx, out);
    }
  }

  private instruction(el: XNode, c: Ctx, out: XNode): void {
    if (el.namespaceURI !== XSL) {
      if (this.isExtension(el)) return this.fallback(el, c, out, `Unsupported extension element ${describe(el)}`);
      return this.literal(el, c, out);
    }
    switch (el.localName) {
      case 'apply-templates': {
        const list = attr(el, 'select') === undefined ? c.node.children : this.nodes(el, 'select', c);
        const mode = attr(el, 'mode');
        this.applyTo(this.sorted(el, list, c), c, mode === undefined ? '' : expandQName(mode, el.scope, 'xsl:apply-templates'), this.withParams(el, c), out);
        return;
      }
      case 'call-template': {
        const name = expandQName(required(el, 'name'), el.scope, 'xsl:call-template');
        const t = this.named.get(name) ?? fail(`No template named "${attr(el, 'name')}"`);
        this.invoke(t, c, this.withParams(el, c), out);
        return;
      }
      case 'apply-imports':
        this.builtin(c, out);
        return;
      case 'for-each': {
        const list = this.sorted(el, this.nodes(el, 'select', c), c);
        list.forEach((n, k) => this.sequence(el, { node: n, pos: k + 1, size: list.length, mode: c.mode, scope: c.scope }, out));
        return;
      }
      case 'sort':
      case 'with-param':
      case 'fallback':
        return;
      case 'value-of':
        addText(out, str(this.evaluate(el, 'select', c)));
        return;
      case 'text':
        addText(out, el.children.map((t) => (t.kind === 'text' ? t.value : '')).join(''));
        return;
      case 'copy-of': {
        const v = this.evaluate(el, 'select', c);
        if (Array.isArray(v)) for (const n of v) this.copy(n, out, true);
        else addText(out, str(v));
        return;
      }
      case 'copy': {
        const n = c.node;
        if (n.kind === 'element') {
          const e = newElement(out, n.prefix, n.localName, n.namespaceURI, copiedNamespaces(n));
          this.useAttributeSets(el, attr(el, 'use-attribute-sets'), c, e);
          this.sequence(el, c, e);
        } else if (n.kind === 'document') this.sequence(el, c, out);
        else this.copy(n, out, false);
        return;
      }
      case 'if':
        if (bool(this.evaluate(el, 'test', c))) this.sequence(el, c, out);
        return;
      case 'choose': {
        for (const w of elementChildren(el)) {
          if (isXsl(w, 'when')) {
            if (bool(this.evaluate(w, 'test', c))) return this.sequence(w, c, out);
          } else if (isXsl(w, 'otherwise')) return this.sequence(w, c, out);
          else fail(`${describe(w)} is not allowed in xsl:choose`);
        }
        return;
      }
      case 'element': {
        const qname = this.avtValue(el, 'name', c) ?? fail('xsl:element needs a "name" attribute');
        const ns = this.avtValue(el, 'namespace', c);
        let q: { prefix: string; local: string; uri: string };
        if (ns !== undefined) {
          const colon = qname.indexOf(':');
          q = { prefix: colon < 0 ? '' : qname.slice(0, colon), local: qname.slice(colon + 1), uri: ns };
          if (!q.local) fail(`"${qname}" is not a valid element name in xsl:element`);
        } else q = resolveQName(qname, el.scope, true, 'xsl:element');
        const e = newElement(out, q.uri ? q.prefix : '', q.local, q.uri, []);
        this.useAttributeSets(el, attr(el, 'use-attribute-sets'), c, e);
        this.sequence(el, c, e);
        return;
      }
      case 'attribute': {
        const qname = this.avtValue(el, 'name', c) ?? fail('xsl:attribute needs a "name" attribute');
        const ns = this.avtValue(el, 'namespace', c);
        let q: { prefix: string; local: string; uri: string };
        if (ns !== undefined) {
          const colon = qname.indexOf(':');
          q = { prefix: colon < 0 ? '' : qname.slice(0, colon), local: qname.slice(colon + 1), uri: ns };
        } else q = resolveQName(qname, el.scope, false, 'xsl:attribute');
        if (qname === 'xmlns' || !q.local) fail(`"${qname}" is not a valid attribute name in xsl:attribute`);
        const prefix = q.uri ? (q.prefix === 'xmlns' ? '' : q.prefix) : '';
        addAttribute(out, prefix ? `${prefix}:${q.local}` : q.local, prefix, q.local, q.uri, this.contentString(el, c));
        return;
      }
      case 'comment': {
        const n = addChild(out, node('comment', null));
        n.value = this.contentString(el, c).replace(/--/g, '- -').replace(/-$/, '- ');
        return;
      }
      case 'processing-instruction': {
        const name = (this.avtValue(el, 'name', c) ?? fail('xsl:processing-instruction needs a "name" attribute')).trim();
        if (!/^[A-Za-z_][\w.-]*$/.test(name) || /^xml$/i.test(name)) fail(`"${name}" is not a valid processing-instruction name`);
        const n = addChild(out, node('processing-instruction', null));
        n.name = n.localName = name;
        n.value = this.contentString(el, c).replace(/\?>/g, '? >').replace(/^[ \t\r\n]+/, '');
        return;
      }
      case 'number':
        addText(out, this.number(el, c));
        return;
      case 'message': {
        const text = this.contentString(el, c);
        const terminate = attr(el, 'terminate') === 'yes';
        this.options.onMessage?.(text, terminate);
        if (terminate) fail(`xsl:message terminated the transformation: ${text}`);
        return;
      }
      case 'variable':
      case 'param':
        return;
      default:
        return this.fallback(el, c, out, `Unknown XSLT instruction xsl:${el.localName}`);
    }
  }

  private isExtension(el: XNode): boolean {
    for (let a: XNode | null = el; a && a.kind === 'element'; a = a.parent) {
      const list = isXsl(a, 'stylesheet') || isXsl(a, 'transform') ? attr(a, 'extension-element-prefixes') : xslAttr(a, 'extension-element-prefixes');
      for (const p of (list ?? '').split(/\s+/).filter(Boolean)) if ((p === '#default' ? a.scope?.get('') : a.scope?.get(p)) === el.namespaceURI) return true;
    }
    return false;
  }
  private fallback(el: XNode, c: Ctx, out: XNode, msg: string): void {
    const fbs = elementChildren(el).filter((f) => isXsl(f, 'fallback'));
    if (!fbs.length) fail(msg);
    for (const f of fbs) this.sequence(f, c, out);
  }

  /** Namespace URIs not to copy from a literal result element: the XSLT namespace and those excluded on it or its ancestors. */
  private excludedFor(el: XNode): Set<string> {
    let set = this.excluded.get(el);
    if (set) return set;
    set = el.parent && el.parent.kind === 'element' ? new Set(this.excludedFor(el.parent)) : new Set([XSL]);
    const sheet = isXsl(el, 'stylesheet') || isXsl(el, 'transform');
    for (const a of ['exclude-result-prefixes', 'extension-element-prefixes']) {
      const list = sheet ? attr(el, a) : el.namespaceURI !== XSL ? xslAttr(el, a) : undefined;
      for (const p of (list ?? '').split(/\s+/).filter(Boolean)) {
        const uri = p === '#default' ? (el.scope?.get('') ?? '') : el.scope?.get(p);
        if (uri === undefined) fail(`Undeclared namespace prefix "${p}" in ${a}`);
        set.add(uri!);
      }
    }
    this.excluded.set(el, set);
    return set;
  }

  private literal(el: XNode, c: Ctx, out: XNode): void {
    const excluded = this.excludedFor(el);
    const alias = (uri: string, prefix: string) => this.aliases.get(uri) ?? { uri, prefix };
    const nsDecls: [string, string][] = [];
    // The element's own declarations first, then those it inherits (libxslt's order).
    const own = new Set(el.nsDecls.map(([p]) => p));
    for (const [p, u] of [...el.nsDecls, ...[...(el.scope ?? [])].filter(([q]) => !own.has(q))]) {
      if (p === 'xml' || !u || excluded.has(u) || this.aliases.has(u) || nsDecls.some(([q]) => q === p)) continue;
      nsDecls.push([p, u]);
    }
    for (const [from, to] of this.aliases) if ([...(el.scope ?? [])].some(([, u]) => u === from) && to.uri) nsDecls.push([to.prefix, to.uri]);
    const me = alias(el.namespaceURI, el.prefix);
    const e = newElement(out, me.uri ? me.prefix : '', el.localName, me.uri, nsDecls);
    this.useAttributeSets(el, xslAttr(el, 'use-attribute-sets'), c, e);
    for (const a of el.attributes) {
      if (a.namespaceURI === XSL) continue;
      const value = this.avtString(el, a.name, a.value, c);
      const at = alias(a.namespaceURI, a.prefix);
      addAttribute(e, at.prefix ? `${at.prefix}:${a.localName}` : a.localName, at.uri ? at.prefix : '', a.localName, at.uri, value);
    }
    this.sequence(el, c, e);
  }

  private useAttributeSets(el: XNode, names: string | undefined, c: Ctx, out: XNode): void {
    for (const qn of (names ?? '').split(/\s+/).filter(Boolean)) {
      for (const a of this.attributeSet(el, qn, c, [])) addAttribute(out, a.name, a.prefix, a.localName, a.namespaceURI, a.value);
    }
  }
  /** One attribute set's attributes: its own first, then those of the sets it uses that it doesn't override (libxslt's merge). */
  private attributeSet(el: XNode, qn: string, c: Ctx, stack: string[]): XNode[] {
    const name = expandQName(qn, el.scope, 'use-attribute-sets');
    const sets = this.attributeSets.get(name) ?? fail(`No attribute set named "${qn}"`);
    if (stack.includes(name)) fail(`Attribute set "${qn}" uses itself`);
    const tmp = node('element', null);
    for (const s of sets) {
      // Attribute sets see only global variables.
      for (const a of elementChildren(s)) if (isXsl(a, 'attribute')) this.instruction(a, { ...c, scope: null }, tmp);
    }
    const own = [...tmp.attributes];
    for (const s of sets) {
      for (const used of (attr(s, 'use-attribute-sets') ?? '').split(/\s+/).filter(Boolean)) {
        for (const a of this.attributeSet(s, used, c, [...stack, name])) {
          if (own.some((o) => o.localName === a.localName && o.namespaceURI === a.namespaceURI)) continue;
          const at = tmp.attributes.findIndex((o) => o.localName === a.localName && o.namespaceURI === a.namespaceURI);
          if (at >= 0) tmp.attributes.splice(at, 1);
          tmp.attributes.push(a);
        }
      }
    }
    return tmp.attributes;
  }

  private copy(n: XNode, out: XNode, deep: boolean): void {
    switch (n.kind) {
      case 'document':
        if (deep) for (const ch of n.children) this.copy(ch, out, true);
        return;
      case 'element': {
        const e = newElement(out, n.prefix, n.localName, n.namespaceURI, copiedNamespaces(n));
        if (!deep) return;
        for (const a of n.attributes) addAttribute(e, a.name, a.prefix, a.localName, a.namespaceURI, a.value);
        for (const ch of n.children) this.copy(ch, e, true);
        return;
      }
      case 'attribute':
        addAttribute(out, n.name, n.prefix, n.localName, n.namespaceURI, n.value);
        return;
      case 'text':
        addText(out, n.value);
        return;
      case 'namespace':
        if (out.kind === 'element' && !out.children.length && !out.nsDecls.some(([p]) => p === n.name)) out.nsDecls.push([n.name, n.value]);
        return;
      case 'comment':
      case 'processing-instruction': {
        const m = addChild(out, node(n.kind, null));
        m.name = m.localName = n.name;
        m.value = n.value;
        return;
      }
    }
  }

  // ---- xsl:number

  private number(el: XNode, c: Ctx): string {
    let nums: number[];
    if (attr(el, 'value') !== undefined) {
      const v = num(this.evaluate(el, 'value', c));
      nums = [Number.isFinite(v) ? Math.round(v) : v];
    } else {
      const n = c.node;
      const countSrc = attr(el, 'count');
      const count = countSrc === undefined ? null : this.pattern(el, 'count', countSrc);
      const fromSrc = attr(el, 'from');
      const from = fromSrc === undefined ? null : this.pattern(el, 'from', fromSrc);
      const counts = (m: XNode): boolean => {
        if (count) return this.matches(count, m);
        if (m.kind !== n.kind) return false;
        return n.kind === 'element' || n.kind === 'attribute' ? m.localName === n.localName && m.namespaceURI === n.namespaceURI : n.kind !== 'processing-instruction' || m.name === n.name;
      };
      const isFrom = (m: XNode): boolean => !!from && this.matches(from, m);
      const position = (m: XNode): number => {
        if (!m.parent || m.kind === 'attribute') return 1;
        const sibs = m.parent.children;
        let k = 1;
        for (let i = sibs.indexOf(m) - 1; i >= 0; i--) if (counts(sibs[i])) k++;
        return k;
      };
      const level = attr(el, 'level') ?? 'single';
      if (level === 'any') {
        let k = 0;
        for (let m: XNode | null = n; m && m.kind !== 'document'; m = previousInDocument(m)) {
          if (isFrom(m)) break;
          if (counts(m)) k++;
        }
        nums = [k];
      } else if (level === 'single' || level === 'multiple') {
        nums = [];
        for (let m: XNode | null = n; m && m.kind !== 'document'; m = m.parent) {
          if (isFrom(m)) break;
          if (counts(m)) {
            nums.unshift(position(m));
            if (level === 'single') break;
          }
        }
      } else return fail(`Bad level "${level}" on xsl:number`);
    }
    const format = this.avtValue(el, 'format', c) ?? '1';
    const sep = this.avtValue(el, 'grouping-separator', c);
    const size = Number(this.avtValue(el, 'grouping-size', c));
    return formatNumberList(nums, format, sep !== undefined && size > 0 ? sep : '', size);
  }

  // ---- XSLT functions

  private makeFunctions(): Map<string, XPathFunction> {
    const fns = new Map<string, XPathFunction>();
    const qname = (v: XValue, ctx: XPathContext, fn: string) => resolveQName(str(v), ctx.env?.namespaces ?? null, false, `${fn}()`);
    const arity = (fn: string, args: XValue[], min: number, max: number) => {
      if (args.length < min || args.length > max) throw new XPathError(`Wrong number of arguments to ${fn}()`);
    };
    fns.set('current', (args, ctx) => {
      arity('current', args, 0, 0);
      return ctx.env?.current ? [ctx.env.current] : [];
    });
    fns.set('key', (args, ctx) => {
      arity('key', args, 2, 2);
      const q = qname(args[0], ctx, 'key');
      const index = this.keyTable(expandedName(q.uri, q.local), ctx.node, str(args[0]));
      const values = Array.isArray(args[1]) ? args[1].map(stringValue) : [str(args[1])];
      const out: XNode[] = [];
      for (const v of values) out.push(...(index.get(v) ?? []));
      return values.length > 1 ? inDocumentOrder(out) : out;
    });
    fns.set('generate-id', (args, ctx) => {
      arity('generate-id', args, 0, 1);
      let n: XNode | undefined = ctx.node;
      if (args.length) {
        if (!Array.isArray(args[0])) throw new XPathError('generate-id() needs a node-set');
        n = args[0][0];
      }
      if (!n) return '';
      let id = this.ids.get(n);
      if (!id) this.ids.set(n, (id = `id${++this.idCount}`));
      return id;
    });
    fns.set('document', (args) => {
      arity('document', args, 1, 2);
      const uris = Array.isArray(args[0]) ? args[0].map(stringValue) : [str(args[0])];
      return uris.some((u) => u === '') ? [this.style] : [];
    });
    fns.set('format-number', (args, ctx) => {
      arity('format-number', args, 2, 3);
      let f = DEFAULT_DECIMAL_FORMAT;
      if (args.length > 2) {
        const q = qname(args[2], ctx, 'format-number');
        f = this.decimalFormats.get(expandedName(q.uri, q.local)) ?? fail(`No decimal format named "${str(args[2])}"`);
      } else f = this.decimalFormats.get('') ?? f;
      return formatDecimal(num(args[0]), str(args[1]), f);
    });
    fns.set('system-property', (args, ctx) => {
      arity('system-property', args, 1, 1);
      const q = qname(args[0], ctx, 'system-property');
      if (q.uri !== XSL) return '';
      return q.local === 'version' ? '1.0' : q.local === 'vendor' ? 'tabularius' : q.local === 'vendor-url' ? 'https://github.com/' : '';
    });
    fns.set('element-available', (args, ctx) => {
      arity('element-available', args, 1, 1);
      const q = resolveQName(str(args[0]), ctx.env?.namespaces ?? null, true, 'element-available()');
      return q.uri === XSL && INSTRUCTIONS.has(q.local);
    });
    fns.set('function-available', (args) => {
      arity('function-available', args, 1, 1);
      const name = str(args[0]);
      return coreFunctionNames().includes(name) || XSLT_FUNCTIONS.includes(name);
    });
    fns.set('unparsed-entity-uri', (args) => {
      arity('unparsed-entity-uri', args, 1, 1);
      return '';
    });
    return fns;
  }

  private keyTable(name: string, context: XNode, written: string): Map<string, XNode[]> {
    const defs = this.keys.get(name) ?? fail(`No xsl:key named "${written}"`);
    let docs = this.keyIndex.get(name);
    if (!docs) this.keyIndex.set(name, (docs = new Map()));
    let root = context;
    while (root.parent) root = root.parent;
    let table = docs.get(root);
    if (table) return table;
    table = new Map();
    docs.set(root, table);
    const all: XNode[] = [];
    const walk = (n: XNode): void => {
      all.push(n, ...n.attributes);
      for (const ch of n.children) walk(ch);
    };
    walk(root);
    for (const n of all) {
      for (const d of defs) {
        if (!this.matches(d.match, n)) continue;
        let v: XValue;
        try {
          v = evaluateCompiled(d.use, { node: n, pos: 1, size: 1, env: { functions: this.functions, current: n, namespaces: d.el.scope ?? undefined, variable: (x) => this.variable(null, x) } });
        } catch (e) {
          throw this.wrap(e, d.el, `use="${d.use.src}"`);
        }
        for (const s of Array.isArray(v) ? v.map(stringValue) : [str(v)]) {
          const list = table.get(s);
          if (!list) table.set(s, [n]);
          else if (list.at(-1) !== n) list.push(n);
        }
      }
    }
    return table;
  }
}

/** The node before this one in document order (attributes count as before their element's children). */
function previousInDocument(n: XNode): XNode | null {
  if (n.kind === 'attribute' || n.kind === 'namespace') return n.parent;
  const p = n.parent;
  if (!p) return null;
  const k = p.children.indexOf(n);
  if (k <= 0) return p;
  let m = p.children[k - 1];
  while (m.children.length) m = m.children[m.children.length - 1];
  return m;
}

/** Drops whitespace-only text from the stylesheet, except in xsl:text and under xml:space="preserve". */
function stripStylesheet(doc: XNode): void {
  const walk = (el: XNode, preserve: boolean): void => {
    const xs = el.attributes.find((a) => a.namespaceURI === XML_NS && a.localName === 'space')?.value;
    if (xs === 'preserve') preserve = true;
    else if (xs === 'default') preserve = false;
    if (!preserve && !isXsl(el, 'text')) el.children = el.children.filter((c) => c.kind !== 'text' || /[^ \t\r\n]/.test(c.value));
    for (const c of el.children) if (c.kind === 'element') walk(c, preserve);
  };
  walk(doc, false);
}

// ---- Serialization

const escText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
const escAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');

/** Namespace fix-up for one element: the declarations it needs given what is in scope, and its attributes' written names. */
function namespaceFixup(el: XNode, inScope: Map<string, string>): { decls: [string, string][]; scope: Map<string, string>; attrs: [string, string][] } {
  const scope = new Map(inScope);
  const decls: [string, string][] = [];
  const declare = (p: string, u: string): void => {
    if (scope.get(p) === u || (!u && !p && !scope.get(''))) return;
    const at = decls.findIndex(([q]) => q === p);
    if (at >= 0) decls[at] = [p, u];
    else decls.push([p, u]);
    scope.set(p, u);
  };
  declare(el.namespaceURI ? el.prefix : '', el.namespaceURI);
  for (const [p, u] of el.nsDecls) {
    if (p === (el.namespaceURI ? el.prefix : '') || p === 'xml') {
      // An explicit xmlns="" copied from the source is kept, as libxslt does.
      if (!p && !u && !el.namespaceURI && !decls.some(([q]) => q === '')) decls.push(['', '']);
      continue;
    }
    declare(p, u);
  }
  let generated = 0;
  const attrs: [string, string][] = el.attributes.map((a) => {
    if (!a.namespaceURI) return [a.localName, a.value];
    if (a.namespaceURI === XML_NS) return [`xml:${a.localName}`, a.value];
    let p = a.prefix && scope.get(a.prefix) === a.namespaceURI ? a.prefix : [...scope].find(([q, u]) => q && u === a.namespaceURI)?.[0];
    if (!p) {
      p = a.prefix && !scope.has(a.prefix) ? a.prefix : '';
      while (!p || scope.has(p)) p = `ns_${++generated}`;
      declare(p, a.namespaceURI);
    }
    return [`${p}:${a.localName}`, a.value];
  });
  return { decls, scope, attrs };
}

function serializeXml(doc: XNode, o: OutputSettings): string {
  let out = '';
  if (!o.omitXmlDeclaration) {
    out += `<?xml version="${o.version ?? '1.0'}"${o.encoding ? ` encoding="${o.encoding}"` : ''}${o.standalone ? ` standalone="${o.standalone}"` : ''}?>\n`;
  }
  const root = doc.children.find((c) => c.kind === 'element');
  if (o.doctypeSystem && root) {
    out += `<!DOCTYPE ${root.name}${o.doctypePublic ? ` PUBLIC "${o.doctypePublic}" "${o.doctypeSystem}"` : ` SYSTEM "${o.doctypeSystem}"`}>\n`;
  }
  const write = (n: XNode, scope: Map<string, string>, level: number, format: boolean): void => {
    switch (n.kind) {
      case 'text': {
        const p = n.parent;
        if (p && p.kind === 'element' && o.cdata.has(expandedName(p.namespaceURI, p.localName))) out += `<![CDATA[${n.value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
        else out += escText(n.value);
        return;
      }
      case 'comment':
        out += `<!--${n.value}-->`;
        return;
      case 'processing-instruction':
        out += `<?${n.name}${n.value ? ` ${n.value}` : ''}?>`;
        return;
      case 'element': {
        const fix = namespaceFixup(n, scope);
        out += `<${n.name}`;
        for (const [p, u] of fix.decls) out += ` ${p ? `xmlns:${p}` : 'xmlns'}="${escAttr(u)}"`;
        for (const [name, v] of fix.attrs) out += ` ${name}="${escAttr(v)}"`;
        if (!n.children.length) {
          out += '/>';
          return;
        }
        out += '>';
        const fmt = format && !n.children.some((c) => c.kind === 'text');
        if (fmt) out += '\n';
        for (const c of n.children) {
          if (fmt) out += '  '.repeat(level + 1);
          write(c, fix.scope, level + 1, fmt);
          if (fmt) out += '\n';
        }
        if (fmt) out += '  '.repeat(level);
        out += `</${n.name}>`;
        return;
      }
      default:
        return;
    }
  };
  const top = new Map([['xml', XML_NS]]);
  doc.children.forEach((c, k) => {
    write(c, top, 0, !!o.indent);
    if (c.kind === 'comment' && k < doc.children.length - 1) out += '\n';
  });
  if (doc.children.length) out += '\n';
  return out;
}

const HTML_ELEMENTS = new Set(
  ('a abbr acronym address applet area b base basefont bdo big blockquote body br button caption center cite code col colgroup dd del dfn dir div dl dt ' +
    'em embed fieldset font form frame frameset h1 h2 h3 h4 h5 h6 head hr html i iframe img input ins isindex kbd label legend li link map menu meta ' +
    'noframes noscript object ol optgroup option p param pre q s samp script select small span strike strong style sub sup table tbody td textarea ' +
    'tfoot th thead title tr tt u ul var').split(' '),
);
const HTML_INLINE = new Set(
  ('a abbr acronym applet b basefont bdo big br button cite code del dfn em font i iframe img input ins kbd label map object q s samp script select ' +
    'small span strike strong sub sup textarea tt u var').split(' '),
);
const HTML_VOID = new Set('area base basefont br col frame hr img input isindex link meta param embed'.split(' '));
const HTML_BOOLEAN = new Set('checked compact declare defer disabled ismap multiple nohref noresize noshade nowrap readonly selected'.split(' '));
const HTML_URI_ATTRS = new Set(['href', 'action', 'src']);

function serializeHtml(doc: XNode, o: OutputSettings): string {
  let out = '';
  const root = doc.children.find((c) => c.kind === 'element');
  if ((o.doctypePublic || o.doctypeSystem) && root) {
    out += `<!DOCTYPE ${root.name}${o.doctypePublic ? ` PUBLIC "${o.doctypePublic}"${o.doctypeSystem ? ` "${o.doctypeSystem}"` : ''}` : ` SYSTEM "${o.doctypeSystem}"`}>\n`;
  }
  // libxml2 puts a Content-Type meta at the start of the head, or fixes the charset of the one there.
  const head = root && root.localName.toLowerCase() === 'html' ? root.children.find((c) => c.kind === 'element' && c.localName.toLowerCase() === 'head' && !c.namespaceURI) : undefined;
  const contentType = `text/html; charset=${o.encoding ?? 'UTF-8'}`;
  const existing = head?.children.find((c) => c.kind === 'element' && c.localName.toLowerCase() === 'meta' && c.attributes.some((a) => a.localName.toLowerCase() === 'http-equiv' && a.value.toLowerCase() === 'content-type'));
  const content = existing?.attributes.find((a) => a.localName.toLowerCase() === 'content');
  if (content) content.value = contentType;
  if (head && !existing) {
    const meta = node('element', head);
    Object.assign(meta, { name: 'meta', localName: 'meta' });
    const a1 = node('attribute', meta);
    Object.assign(a1, { name: 'http-equiv', localName: 'http-equiv', value: 'Content-Type' });
    const a2 = node('attribute', meta);
    Object.assign(a2, { name: 'content', localName: 'content', value: contentType });
    meta.attributes = [a1, a2];
    head.children.unshift(meta);
  }
  const format = o.indent !== false;
  const escUri = (s: string): string =>
    Array.from(new TextEncoder().encode(s), (b) => (b > 0x20 && b < 0x7f && b !== 0x22 && b !== 0x60 && b !== 0x5c && b !== 0x5e && b !== 0x7c && b !== 0x7b && b !== 0x7d ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
  const write = (n: XNode, scope: Map<string, string>): void => {
    switch (n.kind) {
      case 'text': {
        const p = n.parent;
        const raw = p && p.kind === 'element' && /^(script|style)$/i.test(p.localName) && !p.namespaceURI;
        out += raw ? n.value : n.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return;
      }
      case 'comment':
        out += `<!--${n.value}-->`;
        return;
      case 'processing-instruction':
        out += `<?${n.name}${n.value ? ` ${n.value}` : ''}>`;
        return;
      case 'element': {
        const fix = namespaceFixup(n, scope);
        const lname = n.namespaceURI ? '' : n.localName.toLowerCase();
        const known = HTML_ELEMENTS.has(lname);
        const block = format && known && !HTML_INLINE.has(lname);
        out += `<${n.name}`;
        for (const [p, u] of fix.decls) out += ` ${p ? `xmlns:${p}` : 'xmlns'}="${escAttr(u)}"`;
        for (const [name, v] of fix.attrs) {
          const ln = name.toLowerCase();
          if (!n.namespaceURI && HTML_BOOLEAN.has(ln)) out += ` ${name}`;
          else if (!n.namespaceURI && (HTML_URI_ATTRS.has(ln) || (ln === 'name' && lname === 'a'))) out += ` ${name}="${escUri(v).replace(/&/g, '&amp;')}"`;
          else {
            const e = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            out += e.includes('"') && !e.includes("'") ? ` ${name}='${e}'` : ` ${name}="${e.replace(/"/g, '&quot;')}"`;
          }
        }
        out += '>';
        if (HTML_VOID.has(lname)) {
          // no content, no end tag
        } else if (!n.children.length) out += `</${n.name}>`;
        else {
          const kids = n.children;
          const nl = block && kids.length > 1 && lname[0] !== 'p';
          if (nl && kids[0].kind !== 'text') out += '\n';
          for (const c of kids) write(c, fix.scope);
          if (nl && kids[kids.length - 1].kind !== 'text') out += '\n';
          out += `</${n.name}>`;
        }
        const p = n.parent;
        const next = p ? p.children[p.children.indexOf(n) + 1] : undefined;
        if (block && next && next.kind !== 'text' && p && p.kind === 'element' && p.localName.toLowerCase()[0] !== 'p') out += '\n';
        return;
      }
      default:
        return;
    }
  };
  const top = new Map([['xml', XML_NS]]);
  for (const c of doc.children) write(c, top);
  if (doc.children.length) out += '\n';
  return out;
}

function serialize(doc: XNode, o: OutputSettings): string {
  let method = o.method;
  if (method === undefined) {
    const k = doc.children.findIndex((c) => c.kind === 'element');
    const first = doc.children[k];
    const textBefore = doc.children.slice(0, Math.max(k, 0)).some((c) => c.kind === 'text' && /[^ \t\r\n]/.test(c.value));
    method = first && !first.namespaceURI && first.localName.toLowerCase() === 'html' && !textBefore ? 'html' : 'xml';
  }
  if (method === 'text') return stringValue(doc);
  // libxslt writes nothing at all, not even the XML declaration, for an empty result.
  if (!doc.children.length) return '';
  if (method === 'html') return serializeHtml(doc, o);
  return serializeXml(doc, o);
}

/**
 * Runs an XSLT 1.0 stylesheet over an XML document and returns the serialized result
 * (per the stylesheet's xsl:output). Throws an Error (XsltError) for malformed XML or
 * stylesheets, XPath errors, unsupported features and xsl:message terminate="yes".
 */
export function applyXslt(xml: string, xslt: string, options: XsltOptions = {}): string {
  let style: XNode;
  try {
    style = parseXmlDocument(xslt, { processingInstructions: false });
  } catch (e) {
    throw new XsltError(`Bad stylesheet: ${(e as Error).message}`);
  }
  const t = new Transformer(style, options);
  let source: XNode;
  try {
    source = parseXmlDocument(xml, { processingInstructions: true });
  } catch (e) {
    throw new XsltError(`Bad source XML: ${(e as Error).message}`);
  }
  try {
    return serialize(t.run(source), t.output);
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof XsltError) throw e;
    if (e instanceof XPathError) throw new XsltError(e.message);
    throw e;
  }
}
