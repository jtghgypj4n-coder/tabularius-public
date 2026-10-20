// A readable difference between two designs written as text (design-text.ts): a script step by step, a table field
// by field, a layout object by object, relationships and occurrences by name. For a code review of a design change,
// where a diff of the files themselves is noise (ids move, JSON keys wrap) or too raw (a layout is a page of JSON).
// Nothing is applied or changed; objects are matched by the id in their file, so a rename reads as a rename.

import { parseFields, parseRelationships, type FieldBlock } from './design-apply.ts';

export interface DesignDiff {
  /** The report, one line each. */
  lines: string[];
  /** How many objects were added, removed or changed. */
  changes: number;
}

const PER_OBJECT = 40;
const SECTIONS: { prefix: string; title: string }[] = [
  { prefix: 'tables/', title: 'Tables' }, { prefix: 'relationships.txt', title: 'Relationships' },
  { prefix: 'value-lists/', title: 'Value lists' }, { prefix: 'custom-functions/', title: 'Custom functions' },
  { prefix: 'scripts/', title: 'Scripts' }, { prefix: 'layouts/', title: 'Layouts' },
  { prefix: 'privilege-sets/', title: 'Privilege sets' }, { prefix: 'accounts.txt', title: 'Accounts' },
  { prefix: 'file.json', title: 'File settings' },
];

const plain = (t: string) => t.replace(/\r\n?/g, '\n').replace(/\n$/, '');
const short = (s: string, n = 90) => { const one = s.replace(/\s*\n\s*/g, ' ⏎ '); return one.length > n ? one.slice(0, n - 1) + '…' : one; };

/** What an exported file is: the object it holds, by id where the file carries one, else by its path. */
function identity(path: string, text: string): { key: string; name: string } {
  const first = plain(text).split('\n', 1)[0];
  let m: RegExpExecArray | null;
  if ((m = /^(?:# Script|Table|Value list): (.*?) \(id (\d+)\)$/.exec(first))) return { key: `${path.split('/')[0]}:${m[2]}`, name: m[1] };
  if (path.startsWith('layouts/') || path.startsWith('privilege-sets/')) {
    try {
      const j = JSON.parse(text);
      if (typeof j?.id === 'number') return { key: `${path.split('/')[0]}:${j.id}`, name: String(j.name ?? path) };
    } catch { /* keyed by path below */ }
  }
  return { key: path, name: path.replace(/^[^/]*\//, '').replace(/\.(txt|json)$/, '') };
}

/** Line differences by longest common subsequence: removed and added lines in order, each with its line number. */
export function lineDiff(a: string[], b: string[]): { op: '-' | '+'; at: number; line: string }[] {
  const n = a.length, m = b.length;
  // Trim what both ends share first: most edits are small.
  let head = 0;
  while (head < n && head < m && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
  const x = a.slice(head, n - tail), y = b.slice(head, m - tail);
  const out: { op: '-' | '+'; at: number; line: string }[] = [];
  if (x.length * y.length > 4_000_000) { // too big to align: say everything between changed
    x.forEach((line, i) => out.push({ op: '-', at: head + i + 1, line }));
    y.forEach((line, i) => out.push({ op: '+', at: head + i + 1, line }));
    return out;
  }
  const l: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) l[i][j] = x[i] === y[j] ? l[i + 1][j + 1] + 1 : Math.max(l[i + 1][j], l[i][j + 1]);
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++; } else if (i < x.length && (j === y.length || l[i + 1][j] >= l[i][j + 1])) { out.push({ op: '-', at: head + i + 1, line: x[i] }); i++; } else { out.push({ op: '+', at: head + j + 1, line: y[j] }); j++; }
  }
  return out;
}

const textLines = (a: string, b: string): string[] => lineDiff(plain(a).split('\n'), plain(b).split('\n')).map((d) => `${d.op} ${String(d.at).padStart(3)}  ${short(d.line, 140)}`);

/** Changed paths between two JSON values; arrays of objects with an id are matched by it, so a moved object isn't a change. */
function jsonChanges(a: unknown, b: unknown, path: string, out: string[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in a)) out.push(`+ ${p} = ${short(JSON.stringify(b[k]), 70)}`);
      else if (!(k in b)) out.push(`- ${p} (was ${short(JSON.stringify(a[k]), 70)})`);
      else jsonChanges(a[k], b[k], p, out);
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    const label = (v: unknown, i: number) => isObj(v) && typeof v.id === 'number' ? `#${v.id}${typeof v.name === 'string' ? ` "${v.name}"` : ''}` : `[${i}]`;
    const keyed = (arr: unknown[]) => arr.length > 0 && arr.every((v) => isObj(v) && typeof v.id === 'number');
    if (keyed(a) && keyed(b)) {
      const am = new Map(a.map((v, i) => [(v as { id: number }).id, [v, i] as const]));
      const bm = new Map(b.map((v, i) => [(v as { id: number }).id, [v, i] as const]));
      for (const [id, [v, i]] of bm) {
        if (!am.has(id)) out.push(`+ ${path}${label(v, i)} added${isObj(v) && typeof v.kind === 'string' ? ` (${v.kind})` : ''}`);
        else jsonChanges(am.get(id)![0], v, `${path}${label(v, i)}`, out);
      }
      for (const [id, [v, i]] of am) if (!bm.has(id)) out.push(`- ${path}${label(v, i)} removed${isObj(v) && typeof v.kind === 'string' ? ` (${v.kind})` : ''}`);
    } else if (a.every((v) => typeof v !== 'object') && b.every((v) => typeof v !== 'object')) {
      out.push(`~ ${path}: ${short(JSON.stringify(a), 60)} → ${short(JSON.stringify(b), 60)}`);
    } else {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (i >= a.length) out.push(`+ ${path}[${i}] added`);
        else if (i >= b.length) out.push(`- ${path}[${i}] removed`);
        else jsonChanges(a[i], b[i], `${path}[${i}]`, out);
      }
    }
  } else {
    out.push(`~ ${path || 'value'}: ${short(JSON.stringify(a), 60)} → ${short(JSON.stringify(b), 60)}`);
  }
}

function fieldChanges(old: FieldBlock, now: FieldBlock): string[] {
  const out: string[] = [];
  const cmp = (label: string, x: string | undefined, y: string | undefined) => { if (x !== y) out.push(`~ ${label}: ${x === undefined ? '(none)' : short(x)} → ${y === undefined ? '(none)' : short(y)}`); };
  cmp('type', old.type && `${old.type}, ${old.kind}`, now.type && `${now.type}, ${now.kind}`);
  cmp('comment', old.comment, now.comment);
  cmp('formula', old.calculation, now.calculation);
  cmp('formula context', old.context, now.context);
  cmp('summary', old.summary && `${old.summary.type} of ${old.summary.field}`, now.summary && `${now.summary.type} of ${now.summary.field}`);
  cmp('options', old.options?.replace(/\s+/g, ' '), now.options?.replace(/\s+/g, ' '));
  return out;
}

function tableChanges(a: string, b: string): string[] {
  const old = new Map(parseFields('table', plain(a)).fields.map((f) => [f.name, f]));
  const now = parseFields('table', plain(b)).fields;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of now) {
    seen.add(f.name);
    const o = old.get(f.name);
    if (!o) out.push(`+ field ${f.name}${f.type ? ` (${f.type}, ${f.kind})` : ''}`);
    else for (const c of fieldChanges(o, f)) out.push(`field ${f.name}  ${c}`);
  }
  for (const n of old.keys()) if (!seen.has(n)) out.push(`- field ${n}`);
  return out;
}

function relationshipChanges(a: string, b: string): string[] {
  const old = parseRelationships('relationships.txt', plain(a));
  const now = parseRelationships('relationships.txt', plain(b));
  const out: string[] = [];
  for (const [k, line] of now.occurrences) {
    const o = old.occurrences.get(k);
    if (!o) out.push(`+ occurrence ${line}`);
    else if (o !== line) out.push(`~ occurrence ${o} → ${line}`);
  }
  for (const [k, line] of old.occurrences) if (!now.occurrences.has(k)) out.push(`- occurrence ${line}`);
  const was = new Map(old.relationships.map((r) => [r.key, r]));
  for (const r of now.relationships) {
    const o = was.get(r.key);
    const head = `${r.left} ↔ ${r.right}`;
    if (!o) out.push(`+ relationship ${head}${r.predicates.map((p) => `\n      ${p}`).join('')}${r.options ? `\n      Options: ${r.options}` : ''}`);
    else if (o.raw !== r.raw) {
      for (const l of lineDiff(o.predicates, r.predicates)) out.push(`~ relationship ${head}  match ${l.op === '-' ? 'removed' : 'added'}: ${l.line}`);
      if (o.options !== r.options) out.push(`~ relationship ${head}  options: ${o.options || '(none)'} → ${r.options || '(none)'}`);
    }
  }
  for (const [k, o] of was) if (!now.relationships.some((r) => r.key === k)) out.push(`- relationship ${o.left} ↔ ${o.right}`);
  return out;
}

function changesOf(path: string, a: string, b: string): string[] {
  if (path.startsWith('tables/')) return tableChanges(a, b);
  if (path === 'relationships.txt') return relationshipChanges(a, b);
  if (path.endsWith('.json')) {
    try { const out: string[] = []; jsonChanges(JSON.parse(a), JSON.parse(b), '', out); return out; } catch { return textLines(a, b); }
  }
  // Scripts, value lists, custom functions and accounts read line by line (a script line is a step); the title line is the rename.
  const skipFirst = path.startsWith('scripts/') || path.startsWith('value-lists/');
  const x = plain(a).split('\n'), y = plain(b).split('\n');
  const diff = lineDiff(skipFirst ? x.slice(1) : x, skipFirst ? y.slice(1) : y);
  const offset = skipFirst ? 1 : 0;
  return diff.map((d) => `${d.op} ${String(d.at + offset).padStart(3)}  ${short(d.line, 140)}`);
}

/** The differences between two designs, each a map from path to text as designText() gives. */
export function diffDesigns(oldFiles: Map<string, string>, newFiles: Map<string, string>): DesignDiff {
  const index = (files: Map<string, string>) => {
    const m = new Map<string, { path: string; text: string; name: string }>();
    for (const [path, text] of files) { const id = identity(path, text); m.set(id.key, { path, text, name: id.name }); }
    return m;
  };
  const before = index(oldFiles), after = index(newFiles);
  const lines: string[] = [];
  let changes = 0;
  for (const { prefix, title } of SECTIONS) {
    const inSection = (p: string) => p === prefix || p.startsWith(prefix);
    const block: string[] = [];
    for (const [key, o] of [...after].sort(([, x], [, y]) => x.path.localeCompare(y.path))) {
      if (!inSection(o.path)) continue;
      const was = before.get(key);
      if (!was) { block.push(`+ ${o.name}  (${o.path})`); changes++; continue; }
      const renamed = was.name !== o.name;
      const detail = plain(was.text) === plain(o.text) ? [] : changesOf(o.path, was.text, o.text);
      if (!renamed && !detail.length) continue;
      changes++;
      block.push(`~ ${renamed ? `${was.name} → ${o.name}` : o.name}  (${o.path}${was.path !== o.path ? `, was ${was.path}` : ''})`);
      for (const d of detail.slice(0, PER_OBJECT)) block.push('    ' + d);
      if (detail.length > PER_OBJECT) block.push(`    … and ${detail.length - PER_OBJECT} more`);
    }
    for (const [key, was] of [...before].sort(([, x], [, y]) => x.path.localeCompare(y.path))) {
      if (inSection(was.path) && !after.has(key)) { block.push(`- ${was.name}  (${was.path})`); changes++; }
    }
    if (block.length) lines.push(title, ...block.map((l) => '  ' + l), '');
  }
  return { lines: lines.length ? lines.slice(0, -1) : ['No differences.'], changes };
}
