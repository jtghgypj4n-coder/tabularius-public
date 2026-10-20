// "Document this solution": the design (the same one the Database Design
// Report exports) written out as documentation a developer can read: what each
// table holds, how the tables relate, what each layout is for and which scripts
// it starts, and for each script what it says about itself, what calls it and
// what it calls. Markdown, or a single HTML page with a table of contents.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Field, Script, Table } from '../../fmp12/src/index.ts';
import type { LayoutObject, ScriptTrigger } from '../../fmp12/src/layouts.ts';
import { q } from '../../store/src/import.ts';
import type { Store } from '../../store/src/index.ts';
import { MARK, PRODUCT_NAME, tokenCss } from './pages.ts';
import { solutionIndex, solutionOverview } from './insight.ts';

export interface DocsOptions {
  /** An introduction to put first (one the assistant wrote, say), as Markdown. */
  introduction?: string;
}

const lower = (s: string) => s.toLowerCase();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
/** A name as a Markdown anchor. */
export const anchor = (kind: string, name: string) => `${kind}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const link = (kind: string, name: string) => `[${name.replace(/[[\]\\]/g, '\\$&')}](#${anchor(kind, name)})`;
const names = (items: string[], kind?: string) => items.map((n) => (kind ? link(kind, n) : n)).join(', ');

export function documentSolution(store: Store, opts: DocsOptions = {}): string {
  const s = store.schema;
  const index = solutionIndex(store);
  const out: string[] = [];
  const overview = solutionOverview(store).split('\n');
  out.push(overview[0], '', overview[1] ?? '');
  if (opts.introduction?.trim()) out.push('', '## Introduction', '', opts.introduction.trim());
  out.push('', '## Contents', '', '- [Tables](#tables)', '- [Relationships](#relationships)', '- [Layouts](#layouts)', '- [Scripts](#scripts)',
    ...(s.customFunctions.length ? ['- [Custom functions](#custom-functions)'] : []), ...(s.valueLists.length ? ['- [Value lists](#value-lists)'] : []));

  // ---- tables
  const designs = store.designs().layouts;
  const toTable = new Map<number, string>();
  for (const o of s.tableOccurrences) {
    const t = o.dataSourceId ? undefined : s.tables.find((x) => x.id === o.baseTableId);
    if (t) toTable.set(o.id, t.name);
  }
  const layoutsOf = (table: string) => designs.filter((d) => d.tableOccurrenceId !== undefined && toTable.get(d.tableOccurrenceId) === table).map((d) => d.name);
  out.push('', '## Tables');
  for (const t of s.tables) {
    out.push('', `### ${t.name}`, '', `<a id="${anchor('table', t.name)}"></a>`, '');
    const records = count(store, t);
    const tos = s.tableOccurrences.filter((o) => !o.dataSourceId && o.baseTableId === t.id).map((o) => o.name);
    out.push(`${records === undefined ? '' : `${records} record${records === 1 ? '' : 's'}, `}${t.fields.length} field${t.fields.length === 1 ? '' : 's'}.` +
      (tos.length ? ` Table occurrences: ${tos.join(', ')}.` : ''));
    const layouts = layoutsOf(t.name);
    if (layouts.length) out.push('', `Layouts: ${names(layouts, 'layout')}.`);
    out.push('', '| Field | Type | Details |', '| --- | --- | --- |');
    for (const f of t.fields) out.push(`| ${cell(f.name)} | ${fieldType(f)} | ${cell(fieldDetails(f))} |`);
  }

  // ---- relationships
  out.push('', '## Relationships', '');
  const rels = index.sites.filter((x) => x.kind === 'relationship');
  if (!rels.length) out.push('None.');
  for (const r of rels) out.push(`- ${r.where.replace(/^Relationship /, '')}: \`${r.text}\``);
  const external = s.dataSources.filter((d) => d.name);
  if (external.length) out.push('', `Tables from other files: ${external.map((d) => d.name).join(', ')}.`);

  // ---- layouts
  out.push('', '## Layouts');
  const fo = s.fileOptions;
  if (fo?.openLayout || fo?.onFirstWindowOpen?.script || fo?.onLastWindowClose?.script || fo?.onWindowOpen?.script || fo?.onWindowClose?.script) {
    out.push('', [fo.openLayout ? `The file opens on ${link('layout', fo.openLayout)}.` : '',
      fo.onFirstWindowOpen?.script ? `When it opens, it runs ${link('script', fo.onFirstWindowOpen.script)}.` : '',
      fo.onWindowOpen?.script ? `When a window opens, it runs ${link('script', fo.onWindowOpen.script)}.` : '',
      fo.onWindowClose?.script ? `When a window closes, it runs ${link('script', fo.onWindowClose.script)}.` : '',
      fo.onLastWindowClose?.script ? `When it closes, it runs ${link('script', fo.onLastWindowClose.script)}.` : ''].filter(Boolean).join(' '));
  }
  const runsFrom = new Map<string, string[]>();
  for (const [script, layouts] of index.buttons) for (const l of layouts) runsFrom.set(l, [...(runsFrom.get(l) ?? []), script]);
  const scriptName = (n: string) => s.scripts.find((x) => lower(x.name) === n)?.name ?? n;
  for (const d of designs) {
    out.push('', `### ${d.name}`, '', `<a id="${anchor('layout', d.name)}"></a>`, '');
    const table = d.tableOccurrenceId !== undefined ? s.tableOccurrences.find((o) => o.id === d.tableOccurrenceId) : undefined;
    const fields = new Set<string>();
    walk(d.objects, (o) => {
      if (o.field?.field) fields.add(o.field.tableOccurrence && o.field.tableOccurrence !== table?.name ? `${o.field.tableOccurrence}::${o.field.field}` : o.field.field);
    });
    out.push(table ? `Shows records from ${table.name}${toTable.get(table.id) && toTable.get(table.id) !== table.name ? ` (table ${link('table', toTable.get(table.id)!)})` : ''}.` : 'No table.');
    if (fields.size) out.push('', `Fields: ${clip([...fields].join(', '), 1500)}.`);
    const buttons = runsFrom.get(d.name)?.map(scriptName);
    if (buttons?.length) out.push('', `Buttons run: ${names(buttons, 'script')}.`);
    const triggers: string[] = (d.triggers ?? []).map((t) => trigger(t));
    walk(d.objects, (o) => {
      for (const t of o.triggers ?? []) triggers.push(`${trigger(t)} on ${o.name ? `object "${o.name}"` : o.field?.field ? `field ${o.field.field}` : `a ${o.kind}`}`);
    });
    if (triggers.length) out.push('', `Script triggers: ${triggers.join('; ')}.`);
  }

  // ---- scripts
  out.push('', '## Scripts');
  const folders = folderOf(s.scriptOrder);
  for (const sc of s.scripts) {
    const key = lower(sc.name);
    out.push('', `### ${sc.name}`, '', `<a id="${anchor('script', sc.name)}"></a>`, '');
    const about = header(sc);
    if (about) out.push(about, '');
    const facts = [`${sc.steps.length} step${sc.steps.length === 1 ? '' : 's'}`];
    if (folders.get(sc.id)) facts.push(`in folder ${folders.get(sc.id)}`);
    if (sc.fullAccess) facts.push('runs with full access privileges');
    out.push(`${facts.join(', ')}.`);
    const callers = [...(index.callers.get(key) ?? [])];
    const calls = [...(index.calls.get(key) ?? [])].map(scriptName);
    const buttons = [...(index.buttons.get(key) ?? [])];
    const triggers = triggeredBy(store, sc.name);
    const lines: string[] = [];
    if (buttons.length) lines.push(`- Started by buttons on: ${names(buttons, 'layout')}`);
    if (triggers.length) lines.push(`- Started by: ${triggers.join('; ')}`);
    if (callers.length) lines.push(`- Called by: ${names(callers, 'script')}`);
    if (calls.length) lines.push(`- Calls: ${names(calls, 'script')}`);
    const goesTo = new Set<string>();
    for (const step of sc.steps) if (step.enabled && /^Go to Layout$/i.test(step.name) && step.params?.layout?.name) goesTo.add(step.params.layout.name);
    if (goesTo.size) lines.push(`- Goes to layouts: ${names([...goesTo], 'layout')}`);
    const outbound = index.outbound.get(key);
    if (outbound?.size) lines.push(`- Reaches outside the solution: ${[...outbound].join(', ')}`);
    if (!buttons.length && !triggers.length && !callers.length) lines.push('- Not started by any button, trigger or script (a menu, a schedule, or unused)');
    out.push('', ...lines);
  }

  // ---- custom functions and value lists
  if (s.customFunctions.length) {
    out.push('', '## Custom functions');
    for (const c of s.customFunctions) {
      const uses = index.sites.filter((x) => x.refs.functions.has(lower(c.name))).length;
      out.push('', `### ${c.name} ( ${c.parameters.join(' ; ')} )`, '', `<a id="${anchor('function', c.name)}"></a>`, '', `Used in ${uses} place${uses === 1 ? '' : 's'}.`, '', '```', clip(c.formula ?? '', 4000), '```');
    }
  }
  if (s.valueLists.length) {
    out.push('', '## Value lists', '');
    for (const v of s.valueLists) {
      out.push(`- **${v.name}**: ${v.values?.length ? clip(v.values.join(', '), 300) : v.field ? `values from ${fieldName(store, v.field.occurrenceId, v.field.fieldId)}${v.field.relatedFromId !== undefined ? ' (related records only)' : ''}` : v.external ? 'from another file' : 'no values'}`);
    }
  }
  return out.join('\n') + '\n';
}

/** One "## " section of the documentation, by its heading (case ignored). */
export function docsSection(markdown: string, heading: string): string {
  const parts = markdown.split(/\n(?=## )/);
  const part = parts.find((p) => p.slice(3, p.indexOf('\n') < 0 ? undefined : p.indexOf('\n')).trim().toLowerCase() === heading.toLowerCase());
  return part ?? `No section "${heading}"; there are: ${parts.slice(1).map((p) => p.slice(3, p.indexOf('\n'))).join(', ')}`;
}

function count(store: Store, t: Table): number | undefined {
  try {
    return Number(store.query(`SELECT count(*) AS n FROM ${q(t.name)}`)[0]?.n ?? 0);
  } catch {
    return undefined;
  }
}

function fieldName(store: Store, toId: number, fieldId: number): string {
  const to = store.schema.tableOccurrences.find((o) => o.id === toId);
  const t = to && !to.dataSourceId ? store.schema.tables.find((x) => x.id === to.baseTableId) : undefined;
  return `${to?.name ?? `occurrence ${toId}`}::${t?.fields.find((f) => f.id === fieldId)?.name ?? `field ${fieldId}`}`;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

function fieldType(f: Field): string {
  if (f.kind === 'summary') return 'Summary';
  const type = f.type[0].toUpperCase() + f.type.slice(1);
  return f.kind === 'calculation' ? `Calculation (${type})` : type;
}

function fieldDetails(f: Field): string {
  const o = f.options;
  const parts: string[] = [];
  if (f.comment) parts.push(oneLine(f.comment));
  if (o?.global) parts.push('global');
  if (f.kind === 'calculation' && f.calculation) parts.push(`= \`${clip(oneLine(f.calculation), 300)}\`${o?.unstored ? ' (unstored)' : ''}`);
  if (f.kind === 'summary' && f.summary) parts.push(`${f.summary.type} of ${f.summary.field ?? `field ${f.summary.fieldId}`}`);
  const ae = o?.autoEnter;
  if (ae?.serial) parts.push('auto-enters a serial number');
  if (ae?.value) parts.push(`auto-enters ${ae.value.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
  if (f.kind !== 'calculation' && f.calculation) parts.push(`auto-enters \`${clip(oneLine(f.calculation), 200)}\``);
  if (o?.validation?.unique) parts.push('unique');
  if (o?.validation?.notEmpty) parts.push('required');
  return parts.join('; ');
}

function trigger(t: ScriptTrigger): string {
  return `${t.event} runs ${t.script ? link('script', t.script) : `script ${t.scriptId}`}`;
}

function walk(objects: LayoutObject[], fn: (o: LayoutObject) => void): void {
  for (const o of objects) {
    fn(o);
    if (o.children) walk(o.children, fn);
  }
}

/** Layout and object triggers, and File Options, that run a script. */
function triggeredBy(store: Store, script: string): string[] {
  const out: string[] = [];
  const fo = store.schema.fileOptions;
  if (fo?.onFirstWindowOpen?.script === script) out.push('opening the file');
  if (fo?.onLastWindowClose?.script === script) out.push('closing the file');
  if (fo?.onWindowOpen?.script === script) out.push('opening a window');
  if (fo?.onWindowClose?.script === script) out.push('closing a window');
  for (const d of store.designs().layouts) {
    for (const t of d.triggers ?? []) if (t.script === script) out.push(`${t.event} on layout ${link('layout', d.name)}`);
    walk(d.objects, (o) => {
      for (const t of o.triggers ?? []) if (t.script === script) out.push(`${t.event} on an object on layout ${link('layout', d.name)}`);
    });
  }
  return out;
}

/** The comment a script opens with: its own description, as FileMaker developers write one. */
function header(sc: Script): string {
  const lines: string[] = [];
  for (const step of sc.steps) {
    if (step.stepId !== 89) break;
    const text = (step.text ?? '').trim();
    if (/^[-=*_#~]{3,}$/.test(text)) continue;
    lines.push(text);
  }
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.length ? lines.map((l) => (l ? `> ${l}` : '>')).join('\n').slice(0, 2000) : '';
}

function folderOf(order: { id: number; name: string; kind: string; depth: number }[]): Map<number, string> {
  const out = new Map<number, string>();
  const path: string[] = [];
  for (const o of order) {
    if (o.kind === 'folder') {
      path.length = o.depth;
      path.push(o.name);
    } else if (o.kind === 'folder-end') {
      path.length = Math.max(0, o.depth);
    } else if (o.kind === 'item') {
      path.length = Math.min(path.length, o.depth);
      if (path.length) out.set(o.id, path.join(' / '));
    }
  }
  return out;
}

// ---- HTML -----------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `guide` is the folder of the guide being shown ('' for the top one); undefined for text that is not a guide. */
// Scan each candidate label once. A regex restarted at every unmatched '['
// takes quadratic time on a short, entirely literal Markdown line.
function links(s: string, hrefPattern: RegExp, render: (label: string, href: string) => string): string {
  const out: string[] = [];
  let from = 0;
  let close = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '[') continue;
    let end = i + 1;
    for (; end < s.length && s[end] !== ']'; end++) {
      if (s[end] === '\\') {
        if (end + 1 === s.length || /[\r\n\u2028\u2029]/.test(s[end + 1])) break;
        end++;
      }
    }
    if (end === s.length) break;
    if (s[end] !== ']') { i = end; continue; }
    if (end > i + 1 && s[end + 1] === '(') {
      if (close < end + 2) close = s.indexOf(')', end + 2);
      if (close < 0) break;
      if (close >= 0) {
        const href = s.slice(end + 2, close);
        if (hrefPattern.test(href)) {
          out.push(s.slice(from, i), render(s.slice(i + 1, end), href));
          from = close + 1;
          i = close;
          continue;
        }
      }
    }
    // Any nested opener shares this closing bracket and invalid destination.
    i = end;
  }
  out.push(s.slice(from));
  return out.join('');
}

function inline(s: string, guide?: string): string {
  const formatted = esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const out = links(formatted, /^(?:#[a-z0-9-]+|\/(?!\/)[\w\-./#]*)$/, (text, href) => `<a href="${href}">${text.replace(/\\(.)/g, '$1')}</a>`);
  if (guide === undefined) return out;
  // The project's own guides also link to each other (name.md#anchor), to the web (https) and to files that are
  // not served (shown as text). Solution documentation never gets these: its text comes from a file's design.
  const local = links(out, /^(?:\.\.\/|\.\/)?(?:reference\/)?[A-Za-z0-9_-]+\.md(?:#[a-z0-9-]+)?$/, (text, href) => {
    const [file, hash] = href.split('#');
    const to = posix.normalize(posix.join(guide, file));
    return to.startsWith('..') ? text.replace(/\\(.)/g, '$1') : `<a href="/docs/${to.replace(/\.md$/, '')}${hash ? '#' + hash : ''}">${text.replace(/\\(.)/g, '$1')}</a>`;
  });
  return links(local, /^https:\/\/[^\s)"&]+$/, (text, href) => `<a href="${href}" rel="noopener noreferrer">${text.replace(/\\(.)/g, '$1')}</a>`);
}

// The downloaded page carries its whole style: the shared tokens plus these.
const DOCS_CSS = `
body { margin: 0; background: var(--bg); color: var(--text); font: var(--t-md)/1.6 var(--sans); }
.skip { position: absolute; left: var(--s3); top: -48px; padding: var(--s2) var(--s4); background: var(--panel); color: var(--text); border-radius: var(--radius-sm); box-shadow: var(--shadow-raised); z-index: 1; }
.skip:focus { top: var(--s3); }
header { display: flex; align-items: center; justify-content: space-between; gap: var(--s4); max-width: 1040px; margin: 0 auto; padding: var(--s4) var(--s5); color: var(--muted); font-size: var(--t-sm); }
.brand-lockup { display: flex; align-items: center; gap: var(--s2); color: var(--text); font-size: var(--t-lg); font-weight: 650; letter-spacing: -0.01em; }
main { max-width: 1040px; margin: 0 auto var(--s7); padding: var(--s6) var(--s6) var(--s7); box-sizing: border-box; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
main:focus { outline: none; }
h1 { margin: 0 0 var(--s4); font-size: 28px; font-weight: 650; letter-spacing: -0.015em; text-wrap: balance; }
h2 { margin: var(--s7) 0 var(--s3); padding-bottom: var(--s2); border-bottom: 1px solid var(--line); font-size: var(--t-2xl); font-weight: 650; letter-spacing: -0.01em; scroll-margin-top: var(--s4); }
h3 { margin: var(--s5) 0 var(--s1); font-size: var(--t-lg); font-weight: 600; scroll-margin-top: var(--s4); }
p, ul, blockquote { max-width: 72ch; }
p { margin: 0 0 var(--s3); }
ul { margin: 0 0 var(--s3); padding-left: var(--s5); }
li { margin: 2px 0; }
a { color: var(--brand); text-underline-offset: 2px; }
a:hover { color: var(--brand-hover); }
a:focus-visible, .table-wrap:focus-visible, .skip:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 3px; }
.table-wrap { margin: var(--s2) 0 var(--s4); overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
table { border-collapse: collapse; width: 100%; font-size: var(--t-sm); font-variant-numeric: tabular-nums; }
th, td { padding: 6px var(--s3); border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { background: var(--sunken); color: var(--muted); font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
code, pre { font-family: var(--mono); font-size: .9em; background: var(--sunken); border: 1px solid var(--line); border-radius: 4px; }
code { padding: 1px 5px; overflow-wrap: anywhere; }
pre { padding: var(--s3); overflow-x: auto; line-height: 1.45; }
pre code { padding: 0; border: 0; background: none; }
blockquote { margin: var(--s3) 0; padding: var(--s2) var(--s4); border-left: 3px solid var(--brand); background: var(--brand-soft); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
@media (max-width: 640px) { main { padding: var(--s5) var(--s4); border-radius: 0; border-inline: 0; } header { padding: var(--s3) var(--s4); } }
@media (forced-colors: active) { a:focus-visible, .table-wrap:focus-visible, .skip:focus-visible { outline: 2px solid CanvasText; outline-offset: 2px; } }
@media print { body { background: none; } header, .skip { display: none; } main { border: 0; box-shadow: none; padding: 0; max-width: none; } .table-wrap { overflow: visible; } }
`;

/** The documentation as one HTML page; only the Markdown this file writes is understood. */
/** Nested bullet and numbered lists from `i`, with indented lines carrying on the item above: html and the next line. */
function guideList(lines: string[], i: number, folder: string): [string, number] {
  const item = /^(\s*)([-*]|\d+\.) (.*)$/;
  const stack: { indent: number; tag: 'ul' | 'ol' }[] = [];
  let html = '';
  for (; i < lines.length; i++) {
    const m = item.exec(lines[i]);
    if (!m) {
      // A line indented under an item belongs to it; anything else ends the list.
      if (stack.length && /^\s+\S/.test(lines[i]) && !lines[i].trimStart().startsWith('```')) { html += ' ' + inline(lines[i].trim(), folder); continue; }
      break;
    }
    const indent = m[1].length;
    const tag = /^\d/.test(m[2]) ? 'ol' : 'ul';
    while (stack.length && indent < stack[stack.length - 1].indent) html += `</li></${stack.pop()!.tag}>`;
    const top = stack[stack.length - 1];
    if (!top || indent > top.indent) {
      html += `<${tag}>`;
      stack.push({ indent, tag });
    } else {
      html += '</li>';
    }
    html += `<li>${inline(m[3], folder)}`;
  }
  while (stack.length) html += `</li></${stack.pop()!.tag}>`;
  return [html, i];
}

export function docsHtml(markdown: string, title: string, kind = 'Solution documentation', opts: { guide?: boolean; folder?: string } = {}): string {
  const guide = opts.guide === true;
  const inl = (t: string) => inline(t, guide ? (opts.folder ?? '') : undefined);
  const body: string[] = [];
  const lines = markdown.split('\n');
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      body.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (/^<a id="[a-z0-9-]+"><\/a>$/.test(line)) {
      body.push(line);
    } else if (guide && /^\s*([-*]|\d+\.) /.test(line)) {
      const [html, next] = guideList(lines, i, opts.folder ?? '');
      body.push(html);
      i = next - 1;
    } else if ((guide ? /^#{1,4} / : /^#{1,3} /).test(line)) {
      const level = line.indexOf(' ');
      const text = line.slice(level + 1);
      heading = text.replace(/\\(.)/g, '$1');
      body.push(`<h${level} id="${level === 2 || (guide && level > 2) ? anchor('', text).slice(1) : ''}">${inl(text)}</h${level}>`.replace(' id=""', ''));
    } else if (line.startsWith('| ')) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith('| '); i++) rows.push(lines[i].slice(2, -2).split(/ (?<!\\)\| /).map((c) => c.replace(/\\\|/g, '|')));
      i--;
      const [head, , ...rest] = rows;
      body.push(`<div class="table-wrap" role="region" tabindex="0" aria-label="${esc(heading || 'Table')}"><table><thead><tr>${head.map((c) => `<th>${inl(c)}</th>`).join('')}</tr></thead><tbody>` +
        rest.map((r) => `<tr>${r.map((c) => `<td>${inl(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>');
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      for (; i < lines.length && lines[i].startsWith('- '); i++) items.push(`<li>${inl(lines[i].slice(2))}</li>`);
      i--;
      body.push(`<ul>${items.join('')}</ul>`);
    } else if (line.startsWith('>')) {
      const quote: string[] = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++) quote.push(inl(lines[i].replace(/^>\s?/, '')));
      i--;
      body.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
    } else if (line.trim()) {
      body.push(`<p>${inl(line)}</p>`);
    }
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>${tokenCss()}${DOCS_CSS}</style></head><body>
<a class="skip" href="#doc">Skip to content</a>
<header><div class="brand-lockup">${MARK}<span>${PRODUCT_NAME}</span></div><span>${esc(kind)}</span></header>
<main id="doc" tabindex="-1">
${body.join('\n')}
</main>
</body></html>
`;
}

// ---- The project's own guides (docs/), served at /docs ---------------------------


/** Where the guides are: the repository's docs folder, which a packaged program carries beside its packages. */
const GUIDES = join(import.meta.dirname, '..', '..', '..', 'docs');
/** Guide markdown and rendered pages, refreshed only when a file's mtime changes. */
const rendered = new Map<string, { mtime: number; markdown: string; html: string }>();
const namesByDir = new Map<string, { mtime: number; names: string[] }>();
const indexes = new Map<string, { mtimes: string; html: string }>();

/** The guide's first heading, or its file name. */
const guideTitle = (md: string, name: string) => /^# (.+)$/m.exec(md)?.[1].replace(/`/g, '') ?? name;

/** The guides that can be served: docs/*.md and docs/reference/*.md, by path without the extension. */
export function guideNames(dir = GUIDES): string[] {
  let dirMtime = 0;
  try { dirMtime = statSync(dir).mtimeMs + statSync(join(dir, 'reference')).mtimeMs; } catch { /* Missing guide folders are empty. */ }
  const have = namesByDir.get(dir);
  if (have?.mtime === dirMtime) return have.names;
  const list = (sub: string) => {
    try {
      return readdirSync(join(dir, sub)).filter((f) => /^[A-Za-z0-9_-]+\.md$/.test(f)).map((f) => (sub ? `${sub}/` : '') + f.slice(0, -3));
    } catch {
      return [];
    }
  };
  const names = [...list(''), ...list('reference')].sort((a, b) => a.localeCompare(b));
  namesByDir.set(dir, { mtime: dirMtime, names });
  return names;
}

/** The page for a guide (`name` as guideNames gives it), or undefined when there is none. */
export function guidePage(name: string, dir = GUIDES): string | undefined {
  if (!guideNames(dir).includes(name)) return undefined;
  const file = join(dir, `${name}.md`);
  const mtime = statSync(file).mtimeMs;
  const have = rendered.get(file);
  if (have?.mtime === mtime && have.html) return have.html;
  const md = have?.mtime === mtime ? have.markdown : readFileSync(file, 'utf8');
  const html = docsHtml(md, guideTitle(md, name), 'Guide', { guide: true, folder: posix.dirname(name) === '.' ? '' : posix.dirname(name) });
  rendered.set(file, { mtime, markdown: md, html });
  return html;
}

/** The index of guides, each with its first line. */
export function guideIndex(dir = GUIDES): string {
  const names = guideNames(dir);
  const mtimesByName = new Map(names.map((name) => [name, statSync(join(dir, `${name}.md`)).mtimeMs]));
  const mtimes = names.map((name) => `${name}:${mtimesByName.get(name)}`).join('|');
  const have = indexes.get(dir);
  if (have?.mtimes === mtimes) return have.html;
  const rows = names.map((name) => {
    const file = join(dir, `${name}.md`);
    const mtime = mtimesByName.get(name)!;
    const cached = rendered.get(file);
    const md = cached?.mtime === mtime ? cached.markdown : readFileSync(file, 'utf8');
    if (!cached || cached.mtime !== mtime) rendered.set(file, { mtime, markdown: md, html: '' });
    const title = guideTitle(md, name);
    const intro = md.split('\n').find((l, i) => i > 0 && l.trim() && !/^[#<|>`-]/.test(l.trim()) && !l.startsWith('```'))?.trim() ?? '';
    return `- [${title.replace(/[[\]\\]/g, '\\$&')}](/docs/${name}): ${intro.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').slice(0, 160)}`;
  });
  const html = docsHtml(`# Tabularius guides\n\n${rows.join('\n')}\n`, 'Guides', 'Guides', { guide: true });
  indexes.set(dir, { mtimes, html });
  return html;
}
