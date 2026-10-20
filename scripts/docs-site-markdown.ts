// The small Markdown renderer behind `npm run docs:build`. It covers what the guides use and nothing else:
// headings, paragraphs, bullet and numbered lists (nested, with continued paragraphs and fences), block quotes
// (with note/warning callouts), tables, fenced code, horizontal rules, `code`, emphasis, links and a short list of
// inline HTML tags. HTML comments are dropped. Anything else is shown as text, never as markup.

export interface Heading { level: number; text: string; id: string }
/** The text under one heading, for the search index. */
export interface Section { id: string; heading: string; level: number; text: string }
export interface Rendered { html: string; headings: Heading[]; sections: Section[]; title: string; summary: string }

/** What a link in the page turns into: an href to use, or undefined to show the link text without a link. */
export interface Linker {
  link(href: string): string | undefined;
}

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The id GitHub gives a heading (the docs-links test checks every #anchor against this). */
export function slug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[`*_~]/g, (c) => (c === '_' ? '_' : '')).replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
}

/** Heading text as it reads: links, code marks and emphasis taken out. */
export function plainText(markdown: string): string {
  return markdown.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1')
    .replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1$2').replace(/\*([^*\s][^*]*)\*/g, '$1').replace(/~~([^~]+)~~/g, '$1');
}

const decodeEntities = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** Visible text of rendered HTML. */
export const htmlText = (html: string): string => decodeEntities(html.replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/g, '').replace(/<button[\s\S]*?<\/button>/g, ' ').replace(/<br\s*\/?>|<\/(?:p|li|tr|td|th|h[1-6]|pre|blockquote|div|ul|ol|summary)>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// ---- inline ------------------------------------------------------------------------------------------------------

const ALLOWED_TAGS = new Set(['br', 'kbd', 'sub', 'sup', 'b', 'i', 'em', 'strong', 'code', 'details', 'summary', 'mark', 'wbr']);
const PUNCTUATION = /[\\`*_{}[\]()#+\-.!|<>~"'$%&,/:;=?@^]/;

function findClosingBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end >= 0) { i = end + run.length - 1; continue; }
    }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

/** `(destination "title")` starting at `s[at] === '('`: the destination, and the index after the closing parenthesis. */
function parseDestination(s: string, at: number): { href: string; end: number } | undefined {
  let i = at + 1;
  while (s[i] === ' ' || s[i] === '\n') i++;
  let href = '';
  if (s[i] === '<') {
    const close = s.indexOf('>', i);
    if (close < 0) return undefined;
    href = s.slice(i + 1, close);
    i = close + 1;
  } else {
    let depth = 0;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) { href += s[++i]; continue; }
      if (c === ' ' || c === '\n') break;
      if (c === '(') depth++;
      if (c === ')') { if (depth === 0) break; depth--; }
      href += c;
    }
  }
  while (s[i] === ' ' || s[i] === '\n') i++;
  if (s[i] === '"' || s[i] === "'") {
    const quote = s[i];
    const close = s.indexOf(quote, i + 1);
    if (close < 0) return undefined;
    i = close + 1;
    while (s[i] === ' ' || s[i] === '\n') i++;
  }
  return s[i] === ')' ? { href, end: i + 1 } : undefined;
}

const BARE_URL = /^https?:\/\/[^\s<>"]+/;

export function renderInline(s: string, linker: Linker): string {
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      if (s[i + 1] === '\n') { out += '<br>'; i += 2; continue; }
      if (PUNCTUATION.test(s[i + 1])) { out += escapeHtml(s[i + 1]); i += 2; continue; }
    }
    if (c === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end >= 0) {
        let code = s.slice(i + run.length, end).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        out += `<code>${escapeHtml(code)}</code>`;
        i = end + run.length;
        continue;
      }
      out += run; i += run.length; continue;
    }
    if (c === '!' && s[i + 1] === '[') {
      const close = findClosingBracket(s, i + 1);
      const dest = close > 0 && s[close + 1] === '(' ? parseDestination(s, close + 1) : undefined;
      if (dest) {
        // Pictures are not part of the site (it makes no outside requests and ships no pictures): the description stays.
        out += `<span class="picture">${escapeHtml(plainText(s.slice(i + 2, close)))}</span>`;
        i = dest.end;
        continue;
      }
    }
    if (c === '[') {
      const close = findClosingBracket(s, i);
      const dest = close > 0 && s[close + 1] === '(' ? parseDestination(s, close + 1) : undefined;
      if (dest) {
        const label = renderInline(s.slice(i + 1, close), linker);
        const href = /^[a-z][a-z0-9+.-]*:/i.test(dest.href) && !/^https?:|^mailto:/i.test(dest.href) ? undefined : linker.link(dest.href);
        out += href === undefined ? `<span class="not-a-link">${label}</span>` : `<a href="${escapeHtml(href)}"${/^https?:/i.test(href) ? ' rel="noopener noreferrer"' : ''}>${label}</a>`;
        i = dest.end;
        continue;
      }
    }
    if (c === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/.exec(s.slice(i));
      if (auto) {
        const href = linker.link(auto[1]);
        out += href === undefined ? escapeHtml(auto[1]) : `<a href="${escapeHtml(href)}"${/^https?:/i.test(href) ? ' rel="noopener noreferrer"' : ''}>${escapeHtml(auto[1])}</a>`;
        i += auto[0].length;
        continue;
      }
      const anchor = /^<a\s+(?:id|name)="([A-Za-z0-9_.:-]+)"\s*>\s*<\/a>/.exec(s.slice(i));
      if (anchor) { out += `<a id="${anchor[1]}"></a>`; i += anchor[0].length; continue; }
      const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\s*\/?>/.exec(s.slice(i));
      if (tag && ALLOWED_TAGS.has(tag[2].toLowerCase())) { out += `<${tag[1]}${tag[2].toLowerCase()}>`; i += tag[0].length; continue; }
      out += '&lt;'; i++; continue;
    }
    if (c === '*' || c === '_') {
      const double = s[i + 1] === c;
      const mark = double ? c + c : c;
      const before = s[i - 1];
      const after = s[i + mark.length];
      const opens = after !== undefined && !/\s/.test(after) && (c === '*' || !before || !/[\p{L}\p{N}]/u.test(before));
      if (opens) {
        let end = -1;
        for (let j = i + mark.length; j < s.length; j++) {
          if (s[j] === '\\') { j++; continue; }
          if (s[j] === '`') { const run = /^`+/.exec(s.slice(j))![0]; const e = s.indexOf(run, j + run.length); if (e >= 0) { j = e + run.length - 1; continue; } }
          if (s.startsWith(mark, j) && !/\s/.test(s[j - 1] ?? ' ') && j > i + mark.length && (c === '*' || !/[\p{L}\p{N}]/u.test(s[j + mark.length] ?? ' '))) {
            // `**` inside `*...*` and the like: take the first closer of exactly this length.
            if (!double && s[j + 1] === c) { j++; continue; }
            end = j; break;
          }
        }
        if (end > 0) {
          const inner = renderInline(s.slice(i + mark.length, end), linker);
          out += double ? `<strong>${inner}</strong>` : `<em>${inner}</em>`;
          i = end + mark.length;
          continue;
        }
      }
    }
    if (c === '~' && s[i + 1] === '~') {
      const end = s.indexOf('~~', i + 2);
      if (end > i + 2) { out += `<del>${renderInline(s.slice(i + 2, end), linker)}</del>`; i = end + 2; continue; }
    }
    if ((c === 'h') && (i === 0 || /[\s(]/.test(s[i - 1]))) {
      const m = BARE_URL.exec(s.slice(i));
      if (m) {
        const url = m[0].replace(/[.,;:!?)\]]+$/, '').replace(/&$/, '');
        const href = linker.link(url);
        out += href === undefined ? escapeHtml(url) : `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
        i += url.length;
        continue;
      }
    }
    if (c === ' ' && s[i + 1] === ' ' && /^ {2,}\n/.test(s.slice(i))) { out += '<br>'; i = s.indexOf('\n', i) + 1; continue; }
    out += c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c;
    i++;
  }
  return out;
}

// ---- blocks ------------------------------------------------------------------------------------------------------

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
/** A list item that can start in the middle of a paragraph: a bullet, or a numbered item that begins at 1. */
const interruptingItem = (line: string): boolean => { const m = ITEM.exec(line); return !!m && m[4].trim() !== '' && (!/\d/.test(m[2][0]) || parseInt(m[2], 10) === 1); };
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** The cells of a table row; `\|` is a pipe in the text. */
function cells(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const out: string[] = [];
  let cell = '';
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') { cell += '|'; i++; } else if (trimmed[i] === '|') { out.push(cell.trim()); cell = ''; } else cell += trimmed[i];
  }
  out.push(cell.trim());
  return out;
}

const CALLOUT = /^(?:\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]|\*\*(Note|Tip|Important|Warning|Caution)[:.]?\*\*[:.]?)\s*/i;

/** Drops `<!-- ... -->` outside fences, including comments that run over several lines. */
export function stripComments(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let fence: string | undefined;
  let comment = false;
  for (const line of lines) {
    if (!comment) {
      const f = FENCE.exec(line);
      if (fence === undefined && f) fence = f[2];
      else if (fence !== undefined && f && f[2][0] === fence[0] && f[2].length >= fence.length && !f[3]) fence = undefined;
    }
    if (fence !== undefined) { out.push(line); continue; }
    let text = line;
    let result = '';
    for (;;) {
      if (comment) {
        const end = text.indexOf('-->');
        if (end < 0) { text = ''; break; }
        text = text.slice(end + 3);
        comment = false;
      }
      const start = text.indexOf('<!--');
      if (start < 0) { result += text; break; }
      result += text.slice(0, start);
      text = text.slice(start + 4);
      comment = true;
    }
    // A line that held only a comment vanishes; blank text left behind keeps paragraphs apart.
    if (line.trim() && !result.trim()) out.push(''); else out.push(result);
  }
  return out.join('\n');
}

interface Context {
  linker: Linker;
  headings: Heading[];
  sections: Section[];
  used: Map<string, number>;
  /** Where each top-level section's heading sits among the top-level blocks. */
  marks: number[];
  /** The id of a heading that is nested inside a quote or list is not given: only top-level headings are anchors. */
  top: boolean;
}

const blocks = (lines: string[], cx: Context): string => blockList(lines, cx).join('\n');

function blockList(lines: string[], cx: Context): string[] {
  const out: string[] = [];
  const inline = (t: string) => renderInline(t, cx.linker);
  let i = 0;
  const startsBlock = (line: string, next?: string): boolean =>
    FENCE.test(line) || HEADING.test(line) || RULE.test(line) || /^ {0,3}>/.test(line) || interruptingItem(line) || (line.includes('|') && next !== undefined && TABLE_SEPARATOR.test(next) && next.includes('-') && next.includes('|'));
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const indent = fence[1].length;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = FENCE.exec(lines[i]);
        if (close && close[2][0] === fence[2][0] && close[2].length >= fence[2].length && !close[3]) break;
        body.push(lines[i].replace(new RegExp(`^ {0,${indent}}`), ''));
        i++;
      }
      i++;
      const lang = fence[3].replace(/[^A-Za-z0-9_+-]/g, '');
      out.push(`<div class="code-block"><pre${lang ? ` data-lang="${lang}"` : ''} tabindex="0"><code>${escapeHtml(body.join('\n'))}</code></pre><button type="button" class="copy" hidden>Copy</button></div>`);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = plainText(heading[2]);
      let id = slug(text);
      const seen = cx.used.get(id) ?? 0;
      cx.used.set(id, seen + 1);
      if (seen) id = `${id}-${seen}`;
      if (cx.top) { cx.headings.push({ level, text, id }); cx.sections.push({ id, heading: text, level, text: '' }); cx.marks.push(out.length); }
      out.push(`<h${level}${cx.top ? ` id="${id}"` : ''}>${inline(heading[2])}${cx.top ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : ''}</h${level}>`);
      i++;
      continue;
    }
    if (RULE.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (lines[i].trim() && quote.length && !startsBlock(lines[i], lines[i + 1])))) { quote.push(lines[i].replace(/^ {0,3}> ?/, '')); i++; }
      const callout = CALLOUT.exec(quote[0] ?? '');
      let inner = quote;
      let kind = '';
      if (callout) { kind = (callout[1] ?? callout[2]).toLowerCase(); inner = [quote[0].slice(callout[0].length), ...quote.slice(1)]; }
      const label = kind ? `<p class="callout-title">${kind[0].toUpperCase() + kind.slice(1)}</p>` : '';
      out.push(`<blockquote${kind ? ` class="callout callout-${kind}"` : ''}>${label}${blocks(inner, { ...cx, top: false })}</blockquote>`);
      continue;
    }
    if (line.includes('|') && lines[i + 1] !== undefined && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes('-') && lines[i + 1].includes('|')) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(cells(lines[i])); i++; }
      const cell = (tag: string, text: string, n: number) => `<${tag}${align[n] ? ` style="text-align:${align[n]}"` : ''}>${inline(text)}</${tag}>`;
      const label = cx.headings.length ? cx.headings[cx.headings.length - 1].text : 'Table';
      out.push(`<div class="table-wrap" role="region" tabindex="0" aria-label="${escapeHtml(label)}"><table><thead><tr>${head.map((c, n) => cell('th', c, n)).join('')}</tr></thead><tbody>` +
        rows.map((r) => `<tr>${head.map((_, n) => cell('td', r[n] ?? '', n)).join('')}</tr>`).join('') + '</tbody></table></div>');
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2][0]);
      const baseIndent = item[1].length;
      const start = ordered ? parseInt(item[2], 10) : 1;
      const bodies: string[][] = [];
      let loose = false;
      while (i < lines.length) {
        const m = ITEM.exec(lines[i]);
        if (!m || m[1].length !== baseIndent || /\d/.test(m[2][0]) !== ordered) break;
        const contentIndent = baseIndent + m[2].length + (m[3].length > 4 || !m[3].length ? 1 : m[3].length);
        const body: string[] = [m[4]];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) {
            // A blank line goes on with the item when what follows is indented under it.
            let j = i;
            while (j < lines.length && !lines[j].trim()) j++;
            if (j < lines.length && lines[j].search(/\S/) >= contentIndent) {
              for (; i < j; i++) body.push('');
              if (!/^ *(?:`{3,}|~{3,})/.test(body.slice(0, -1).filter((x) => x.trim()).pop() ?? '') && body.some((x) => !x.trim())) loose = loose || false;
              continue;
            }
            // Or when the next item of this list follows: a blank line between items makes the list loose.
            const next = j < lines.length ? ITEM.exec(lines[j]) : null;
            if (next && next[1].length === baseIndent && /\d/.test(next[2][0]) === ordered) { loose = true; i = j; }
            break;
          }
          const indent = l.search(/\S/);
          if (indent >= contentIndent) { body.push(l.slice(contentIndent)); i++; continue; }
          // Text that starts no other block carries on the paragraph above it.
          if (body[body.length - 1] !== '' && !startsBlock(l, lines[i + 1]) && ITEM.exec(l) === null) { body.push(l.trim()); i++; continue; }
          break;
        }
        bodies.push(body);
      }
      const tag = ordered ? 'ol' : 'ul';
      const items = bodies.map((body) => {
        const inner = blocks(body, { ...cx, top: false });
        // A tight item shows its first paragraph without the <p>.
        return `<li>${loose ? inner : inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1')}</li>`;
      });
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${items.join('')}</${tag}>`);
      continue;
    }
    // A paragraph runs until a blank line or the start of another block.
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) { para.push(lines[i]); i++; }
    out.push(`<p>${inline([...para.slice(0, -1), para[para.length - 1].trimEnd()].map((l) => l.trimStart()).join('\n')).replace(/\n/g, ' ')}</p>`);
  }
  return out;
}

export function renderMarkdown(source: string, linker: Linker): Rendered {
  const text = stripComments(source.replace(/\r\n?/g, '\n').replace(/\t/g, '    '));
  const cx: Context = { linker, headings: [], sections: [], used: new Map(), marks: [], top: true };
  // An id written by hand as <a id="x"></a> is taken before any heading's: the page never has one id twice.
  for (const m of text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').matchAll(/<a\s+(?:id|name)="([A-Za-z0-9_.:-]+)"\s*>\s*<\/a>/g)) cx.used.set(m[1], 1);
  const list = blockList(text.split('\n'), cx);
  const seenAnchors = new Set<string>();
  for (let n = 0; n < list.length; n++) {
    list[n] = list[n].replace(/<a id="([^"]+)"><\/a>/g, (all, id: string) => (seenAnchors.has(id) ? '' : (seenAnchors.add(id), all)));
  }
  // What sits under each heading is that section's text; what comes before the first heading is the page's own.
  const bounds = cx.marks.map((at, n) => [at, cx.marks[n + 1] ?? list.length] as const);
  const sectionText = (from: number, to: number) => htmlText(list.slice(from, to).join(' ').replace(/<a class="anchor"[^>]*>#<\/a>/g, ''));
  cx.sections.forEach((section, n) => { section.text = sectionText(bounds[n][0], bounds[n][1]); });
  const introEnd = cx.marks.length ? cx.marks[0] : list.length;
  const intro = sectionText(0, introEnd);
  if (intro) cx.sections.unshift({ id: '', heading: '', level: 0, text: intro });
  const html = list.join('\n');
  const title = cx.headings.find((h) => h.level === 1)?.text ?? cx.headings[0]?.text ?? '';
  // The first paragraph after the title, for the contents page.
  const first = /<\/h1>\s*<p>([\s\S]*?)<\/p>/.exec(html) ?? /<p>([\s\S]*?)<\/p>/.exec(html);
  const summary = first ? htmlText(first[1]) : '';
  return { html, headings: cx.headings, sections: cx.sections, title, summary };
}
