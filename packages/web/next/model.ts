// What the alternative client shows, worked out from the file: one collection per table, read through the
// layout that shows the most of it. Pure functions, so the guesses (which field names a record, which fields are
// keys) can be tested without a browser.

import type { FieldDisplay, FieldMeta, LayoutMeta, LayoutObject, MenuItem, Portal } from '../src/types.ts';

/** A field as the client shows it. `name` is the Data API's name for it on the source layout. */
export interface Column {
  name: string;
  label: string;
  type: string;
  /** Primary or foreign keys, serials and ids: kept out of lists, shown under Details. */
  key: boolean;
  calculated: boolean;
  readOnly: boolean;
  /** Values to pick from, when the source layout shows the field with a value list. */
  choices?: Choices;
}

/** A value list as a field shows it: `labels` are what a person sees when they differ from the stored values. */
export interface Choices {
  values: string[];
  labels?: string[];
  /** checkbox: several can be picked (stored one per line); popup/radio: one of them; dropdown/edit: typing is allowed too. */
  display: FieldDisplay;
  /** The value list's id, when its values are the ones related to each record (fetched per record). */
  perRecord?: number;
}

/** Records of another table shown on a record, from a portal on the source layout. */
export interface Related {
  name: string;
  label: string;
  occurrence: string;
  columns: Column[];
  /** The table its rows are records of (and its file, when another one), to open a row as a record. */
  table?: string;
  file?: string;
  /** Whether a new related record can be added from here (the relationship allows it). */
  create?: boolean;
}

export interface Collection {
  table: string;
  /** The file holding the table, when it isn't the one signed in to. */
  file?: string;
  label: string;
  /** The layout records are read and changed through. */
  layout: string;
  /** Every layout on this table, for "Open in classic". */
  layouts: string[];
  columns: Column[];
  /** The field that names a record (its title), when one does. */
  title?: string;
  /** A container field to show as a record's picture. */
  image?: string;
  related: Related[];
  /** Tables people rarely open (settings, globals, utility): listed apart. */
  quiet: boolean;
}

const KEY = /^(_*(id|pk|fk|uuid|guid|key|serial|recid|record ?id)\b|_*(k|kp|kf|pk|fk|id)_|.*(_id|_key|_pk|_fk|_uuid| id)$|.*\bid$|zz)/i;
const TITLE = /^(full ?name|name|title|subject|label|display ?name|company|organi[sz]ation|heading|summary)$/i;
const TITLEISH = /(name|title|subject|label)$/i;

export function isKey(name: string): boolean {
  return KEY.test(name.replace(/^.*::/, ''));
}

/** "first_name" -> "First name", "DateCreated" -> "Date created": labels read as words, not identifiers. */
export function humanize(name: string): string {
  const bare = name.replace(/^.*::/, '').replace(/^[_\s]+|[_\s]+$/g, '');
  const words = bare
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return name;
  // A name in capitals ("INVOICE LINES") reads as words; short ones ("URL", "ID") stay as they are.
  if (/[a-z]/.test(words) === false && /[A-Z]{4,}/.test(words)) return words.charAt(0) + words.slice(1).toLowerCase();
  const lower = words.split(' ').map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function column(f: FieldMeta, name = f.name): Column {
  return { name, label: humanize(name), type: f.type, key: isKey(name), calculated: f.calculated, readOnly: !!f.readOnly || f.calculated || f.summary };
}

/** The field that names a record: a "name" or "title" field first, else the first plain text field. */
export function pickTitle(columns: Column[]): string | undefined {
  const text = columns.filter((c) => c.type === 'text' && !c.key);
  return (text.find((c) => TITLE.test(c.name)) ?? text.find((c) => TITLEISH.test(c.name)) ?? text[0])?.name;
}

/** The value lists the layout shows its own table's fields with, by field name (the first placement wins). */
export function fieldChoices(meta: LayoutMeta): Map<string, Choices> {
  const out = new Map<string, Choices>();
  const walk = (objects: LayoutObject[] | undefined) => {
    for (const o of objects ?? []) {
      const f = o.field;
      // A value list of related values depends on the record: its values are fetched when the field is edited.
      const perRecord = f?.valueListId !== undefined && meta.recordValueLists?.includes(f.valueListId);
      const values = f?.valueListId !== undefined ? meta.valueLists?.[f.valueListId] ?? (perRecord ? [] : undefined) : undefined;
      if (f?.field && values && (f.tableOccurrence === undefined || f.tableOccurrence === meta.layout.occurrence) && !out.has(f.field)) {
        const labels = meta.valueListLabels?.[f.valueListId!];
        // "-" is a divider line in a FileMaker value list, not a value.
        const keep = values.map((v, i) => [v, labels?.[i] ?? v] as const).filter(([v]) => v !== '-');
        out.set(f.field, { values: keep.map(([v]) => v), ...(labels ? { labels: keep.map(([, l]) => l) } : {}), display: f.display, ...(perRecord ? { perRecord: f.valueListId } : {}) });
      }
      walk(o.children);
    }
  };
  walk(meta.design?.objects);
  return out;
}

/** A layout's fields that belong to its own table, as the Data API names them on it, in layout order. */
function ownColumns(meta: LayoutMeta, placed?: string[]): Column[] {
  const choices = fieldChoices(meta);
  const defs = meta.fields[meta.layout.occurrence] ?? [];
  const byName = new Map(defs.map((f) => [f.name, f]));
  const names = placed ?? defs.map((f) => f.name);
  const out: Column[] = [];
  for (const n of names) {
    const f = byName.get(n);
    if (f && !f.global && !f.summary) out.push({ ...column(f), ...(choices.has(n) ? { choices: choices.get(n) } : {}) });
  }
  return out;
}

function related(meta: LayoutMeta, p: Portal): Related | undefined {
  if (p.foundSet || p.occurrence === meta.layout.occurrence) return undefined;
  const defs = new Map((meta.fields[p.occurrence] ?? []).map((f) => [f.name, f]));
  const columns = p.fields
    .map((n) => {
      const bare = n.replace(/^.*::/, '');
      const f = defs.get(bare);
      return f ? column(f, n.includes('::') ? n : `${p.occurrence}::${n}`) : undefined;
    })
    .filter((c): c is Column => !!c && !c.key);
  if (!columns.length) return undefined;
  return { name: p.name, label: humanize(p.occurrence.replace(/^[a-z_]+\./i, '')), occurrence: p.occurrence, columns, table: p.table, file: p.file, ...(p.create ? { create: true } : {}) };
}

/** Layout names a person would pick from the menu (not separators, folders or hidden ones). */
export function menuLayouts(items: MenuItem[]): { name: string; hidden: boolean }[] {
  return items.filter((i) => i.kind === 'item').map((i) => ({ name: i.name, hidden: !!i.hidden }));
}

/**
 * Groups layouts by table and picks, for each table, the layout that shows most of it (visible layouts first,
 * then the one with more of the table's fields placed, then more related lists). `placed` gives the fields each
 * layout really shows (the Data API's field metadata); without it every field of the table counts.
 */
export function collections(metas: { meta: LayoutMeta; hidden: boolean; placed?: string[] }[]): Collection[] {
  const byTable = new Map<string, { meta: LayoutMeta; hidden: boolean; placed?: string[] }[]>();
  for (const m of metas) {
    const key = `${m.meta.layout.file ?? ''}\u0000${m.meta.layout.table}`;
    byTable.set(key, [...(byTable.get(key) ?? []), m]);
  }
  const out: Collection[] = [];
  for (const group of byTable.values()) {
    const scored = group.map((m) => {
      const columns = ownColumns(m.meta, m.placed);
      const rel = m.meta.portals.map((p) => related(m.meta, p)).filter((r): r is Related => !!r);
      return { m, columns, rel, score: (m.hidden ? 0 : 1000) + columns.filter((c) => !c.key).length * 10 + rel.length };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best.columns.length) continue;
    const table = best.m.meta.layout.table;
    const image = best.columns.find((c) => c.type === 'container')?.name;
    const visible = best.columns.filter((c) => !c.key);
    const quiet = /^(_|zz|z_|sys|system|settings?|prefs?|preferences|globals?|interface|utility|util|dev|developer)\b/i.test(table)
      || group.every((m) => m.hidden)
      || visible.length === 0;
    out.push({
      table,
      ...(best.m.meta.layout.file && best.m.meta.layout.file !== best.m.meta.database ? { file: best.m.meta.layout.file } : {}),
      label: humanize(table),
      layout: best.m.meta.layout.name,
      layouts: group.map((m) => m.meta.layout.name),
      columns: best.columns,
      title: pickTitle(best.columns),
      image,
      related: best.rel,
      quiet,
    });
  }
  return out.sort((a, b) => Number(a.quiet) - Number(b.quiet) || a.label.localeCompare(b.label));
}

/** The columns a list shows: the title first, then up to `max` short, readable fields. */
export function listColumns(c: Collection, max = 4): Column[] {
  const title = c.columns.find((x) => x.name === c.title);
  const rest = c.columns.filter((x) => x !== title && !x.key && x.type !== 'container');
  return [...(title ? [title] : []), ...rest].slice(0, max + (title ? 1 : 0));
}

/** A modern layout: one web viewer filling the layout, showing a page written in HTML, CSS and JavaScript. */
export interface Page {
  /** The layout's name, which is the page's name. */
  layout: string;
  table: string;
  /** The web viewer's object id (the page's calls name it). */
  viewer: number;
  /** "Allow JavaScript to perform FileMaker scripts": the page gets window.tabularius and FileMaker.PerformScript. */
  bridge: boolean;
}

/**
 * The layouts that are pages rather than forms: their only object is a web viewer (labels and lines aside, nothing
 * that shows a field). In menu order; hidden layouts left out.
 */
export function pages(metas: { meta: LayoutMeta; hidden: boolean }[]): Page[] {
  const out: Page[] = [];
  for (const { meta, hidden } of metas) {
    const objects = meta.design?.objects ?? [];
    const viewers = objects.filter((o) => o.kind === 'web-viewer');
    if (hidden || viewers.length !== 1 || objects.some((o) => o.field || o.portal || o.kind === 'portal')) continue;
    out.push({ layout: meta.layout.name, table: meta.layout.table, viewer: viewers[0].id, bridge: viewers[0].webOptions?.jsBridge === true });
  }
  return out;
}
