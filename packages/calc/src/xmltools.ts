// XML tools for the BaseElements XML functions, on the XPath engine's parser:
// canonical XML (C14N 1.1 with comments, as libxml2's xmlC14NDocDumpMemory
// writes it) and a pretty printer in the shape of Poco's DOMWriter.

import { parseXmlDocument, type XNode } from './xpath.ts';

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Namespace declarations an element needs that its parent's scope doesn't already give, sorted, default first. */
function declarations(el: XNode): [string, string][] {
  const mine = el.scope ?? new Map<string, string>();
  const parent = el.parent?.kind === 'element' ? el.parent.scope ?? new Map<string, string>() : new Map<string, string>();
  const out: [string, string][] = [];
  for (const [prefix, uri] of mine) {
    if (prefix === 'xml') continue;
    if ((parent.get(prefix) ?? '') === uri) continue;
    out.push([prefix, uri]);
  }
  // An undeclared default (xmlns="") shows only where the parent had one.
  if (!mine.has('') && (parent.get('') ?? '') !== '') out.push(['', '']);
  return out.sort(([a], [b]) => byCodePoint(a, b));
}

/** The document in canonical form: no declaration or DOCTYPE, attributes sorted, empty elements written in full. */
export function canonicalXml(xml: string, comments = true): string {
  const doc = parseXmlDocument(xml, { processingInstructions: true });
  const out: string[] = [];
  const write = (n: XNode): void => {
    if (n.kind === 'text') out.push(escText(n.value));
    else if (n.kind === 'comment') {
      if (comments) out.push(`<!--${n.value}-->`);
    }
    else if (n.kind === 'processing-instruction') out.push(`<?${n.name}${n.value ? ' ' + n.value.replace(/\r/g, '&#xD;') : ''}?>`);
    else if (n.kind === 'element') {
      out.push('<', n.name);
      for (const [prefix, uri] of declarations(n)) out.push(` xmlns${prefix ? ':' + prefix : ''}="${escAttr(uri)}"`);
      const attrs = [...n.attributes].sort((a, b) => byCodePoint(a.namespaceURI, b.namespaceURI) || byCodePoint(a.localName, b.localName));
      for (const a of attrs) out.push(` ${a.name}="${escAttr(a.value)}"`);
      out.push('>');
      for (const c of n.children) write(c);
      out.push(`</${n.name}>`);
    }
  };
  let seenRoot = false;
  for (const c of doc.children) {
    if (c.kind === 'element') {
      write(c);
      seenRoot = true;
    } else if (c.kind === 'processing-instruction' || (c.kind === 'comment' && comments)) {
      if (seenRoot) out.push('\n');
      write(c);
      if (!seenRoot) out.push('\n');
    }
  }
  return out.join('');
}

const escPretty = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escPrettyAttr = (s: string) => escPretty(s).replace(/"/g, '&quot;');

/** The document indented with tabs, one element per line and FileMaker's return between lines; an element with
 * more than one attribute has each on its own line. Text that is only whitespace between elements goes. */
export function tidyXml(xml: string, newline = '\r'): string {
  const doc = parseXmlDocument(xml);
  const lines: string[] = [];
  const tabs = (n: number) => '\t'.repeat(n);
  const open = (n: XNode, depth: number): string => {
    const attrs: string[] = [];
    for (const [prefix, uri] of n.nsDecls) attrs.push(`xmlns${prefix ? ':' + prefix : ''}="${escPrettyAttr(uri)}"`);
    for (const a of n.attributes) attrs.push(`${a.name}="${escPrettyAttr(a.value)}"`);
    if (attrs.length > 1) return `<${n.name}${attrs.map((a) => newline + tabs(depth + 1) + a).join('')}>`;
    return `<${n.name}${attrs.length ? ' ' + attrs[0] : ''}>`;
  };
  const write = (n: XNode, depth: number): void => {
    if (n.kind === 'comment') lines.push(tabs(depth) + `<!--${n.value}-->`);
    else if (n.kind === 'text') {
      if (n.value.trim()) lines.push(tabs(depth) + (n.cdata ? `<![CDATA[${n.value}]]>` : escPretty(n.value)));
    } else if (n.kind === 'element') {
      // Adjacent text (a CDATA section next to plain text) is one run of text.
      const merged: XNode[] = [];
      for (const c of n.children) {
        const last = merged[merged.length - 1];
        if (c.kind === 'text' && last?.kind === 'text') merged[merged.length - 1] = { ...last, value: last.value + c.value, cdata: last.cdata && c.cdata };
        else merged.push(c);
      }
      const kids = merged.filter((c) => c.kind !== 'text' || c.value.trim());
      if (kids.length === 0 || (kids.length === 1 && kids[0].kind === 'text')) {
        const body = kids.length ? (kids[0].cdata ? `<![CDATA[${kids[0].value}]]>` : escPretty(kids[0].value)) : '';
        lines.push(tabs(depth) + open(n, depth) + body + `</${n.name}>`);
        return;
      }
      lines.push(tabs(depth) + open(n, depth));
      for (const c of kids) write(c, depth + 1);
      lines.push(tabs(depth) + `</${n.name}>`);
    }
  };
  for (const c of doc.children) write(c, 0);
  return lines.join(newline) + newline;
}

/** BE_XMLStripInvalidCharacters' pass over UTF-16 text (big-endian unless it starts with a little-endian mark):
 * the bytes without control characters other than tab, line feed and return, and how many bytes went. */
export function stripInvalidUtf16(bytes: Uint8Array): { data: Uint8Array; skipped: number } {
  const big = !(bytes[0] === 0xff && bytes[1] === 0xfe);
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const unit = big ? (bytes[i] << 8) | bytes[i + 1] : (bytes[i + 1] << 8) | bytes[i];
    if (unit === 0x9 || unit === 0xa || unit === 0xd || unit >= 0x20) {
      out[n++] = bytes[i];
      out[n++] = bytes[i + 1];
    }
  }
  return { data: out.subarray(0, n), skipped: bytes.length - (bytes.length & 1) - n };
}
