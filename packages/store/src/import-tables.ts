// Moving in from other tools: Airtable and Notion CSV exports, Notion's Markdown export, Google Sheets and Excel files
// become new tables here. Each sheet is a table; the types of its columns are worked out from the data (and can be
// overridden); a column of linked records becomes a join table with relationships and a portal on the layout.
// Data only: formulas are not translated (the exports hold their values).

import { PrivilegeError, type Privileges } from './privileges.ts';
import { draftLayout } from './layout-draft.ts';
import { Store, StoreError } from './store.ts';

export type Cell = string | number;

/** A sheet to import: the first row holds the column names. */
export interface SheetInput { name: string; rows: Cell[][] }

export type ColumnKind = 'text' | 'number' | 'date' | 'time' | 'timestamp' | 'checkbox' | 'select' | 'multi' | 'link' | 'skip';
const KINDS: readonly ColumnKind[] = ['text', 'number', 'date', 'time', 'timestamp', 'checkbox', 'select', 'multi', 'link', 'skip'];

export interface PlannedColumn {
  column: number;
  /** The name the sheet gave it. */
  header: string;
  /** The field's name. */
  name: string;
  kind: ColumnKind;
  /** The kind was worked out from the data, not chosen. */
  inferred: boolean;
  /** link: the sheet whose first column the values name. */
  target?: string;
  /** select and multi: the values the list offers. */
  options?: string[];
  /** A date written 12/11/2026 is day first. */
  dayFirst?: boolean;
}

export interface PlannedSheet {
  sheet: string;
  table: string;
  /** The key field the links point at. */
  idField: string;
  columns: PlannedColumn[];
  rows: number;
  /** Rows shorter or longer than the header row. */
  ragged: number;
  notes: string[];
}

export interface ImportTablesPlan { sheets: PlannedSheet[]; notes: string[] }

/** Overrides by sheet name, then by the column's name in the sheet: a kind, or `link:<sheet>`. */
export type ColumnOverrides = Record<string, Record<string, ColumnKind | `link:${string}`>>;

export interface ImportTablesReport {
  tables: number;
  fields: number;
  rows: number;
  /** Join tables made for linked-record columns, and the links in them. */
  joinTables: number;
  links: number;
  valueLists: number;
  /** Link names that matched no row of the other sheet, and names several rows share (the first is used). */
  unmatchedLinks: number;
  ambiguousLinks: number;
  raggedRows: number;
  renamedColumns: number;
  skippedColumns: number;
  /** Values the chosen type could not hold, left empty. */
  unfittingValues: number;
  /** Times with a zone, kept as the clock time written. */
  zonesDropped: number;
  portals: number;
  notes: string[];
}

export const MAX_IMPORT_ROWS = 500_000;
export const MAX_IMPORT_COLUMNS = 500;

const FORMULA_NOTE = 'Formulas are not translated: a formula, rollup or lookup column arrives as the values the export holds, as plain data.';

const two = (n: number) => String(n).padStart(2, '0');
const text = (c: Cell | undefined): string => (c === undefined || c === null ? '' : typeof c === 'number' ? String(c) : c).replace(/^﻿/, '');

// --- names -------------------------------------------------------------------------------------------------------

/** A name the file accepts: no "::", no control characters, not one the file keeps for itself. */
function cleanName(raw: string, taken: Set<string>, fallback: string, reserved = /^(?:rowid|rowmodid|_fm_.*|filemaker_(?:tables|fields|indexes))$/i): string {
  let name = raw.replace(/^﻿/, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/:{2,}/g, ':').replace(/\s+/g, ' ').trim().slice(0, 100).trim();
  if (!name) name = fallback;
  if (reserved.test(name) || /\(\d+\)$/.test(name)) name += ' field';
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} ${n}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

// --- values ------------------------------------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const validDay = (y: number, m: number, d: number) => y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(2000 + (y % 400), m, 0)).getUTCDate();

/** A number as people write it in exports: a sign, a currency sign, thousands separators. Text codes with a leading zero are not numbers. */
export function parseNumber(s: string): number | undefined {
  const t = s.trim();
  if (!t || /^[+-]?0\d/.test(t) || /^[+-]?\d{16,}/.test(t)) return undefined;
  const m = /^([+-]?)\s*[$€£¥]?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.exec(t);
  if (!m) return undefined;
  const n = Number(`${m[1]}${m[2].replace(/,/g, '')}${/[eE][+-]?\d+$/.exec(t)?.[0] ?? ''}`);
  return Number.isFinite(n) ? n : undefined;
}

interface Day { y: number; m: number; d: number; ambiguous?: boolean; slash?: [number, number] }

function parseDay(s: string): Day | undefined {
  const t = s.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) return validDay(+m[1], +m[2], +m[3]) ? { y: +m[1], m: +m[2], d: +m[3] } : undefined;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return { y: +m[3], m: 0, d: 0, slash: [+m[1], +m[2]] };
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(t);
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  if (m && month(m[1]) > 0) return validDay(+m[3], month(m[1]), +m[2]) ? { y: +m[3], m: month(m[1]), d: +m[2] } : undefined;
  m = /^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})$/.exec(t);
  if (m && month(m[2]) > 0) return validDay(+m[3], month(m[2]), +m[1]) ? { y: +m[3], m: month(m[2]), d: +m[1] } : undefined;
  return undefined;
}

/** A time of day, 12 or 24 hour, to HH:MM:SS (fractions kept). */
function parseClock(s: string): string | undefined {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*([AaPp][Mm])?$/.exec(s.trim());
  if (!m) return undefined;
  let h = +m[1];
  if (m[5]) {
    if (h < 1 || h > 12) return undefined;
    h = h % 12 + (/p/i.test(m[5]) ? 12 : 0);
  }
  if (h > 23 || +m[2] > 59 || +(m[3] ?? 0) > 59) return undefined;
  return `${two(h)}:${m[2]}:${m[3] ?? '00'}${m[4] ?? ''}`;
}

/** A timestamp's date part and clock part, and whether it carried a time zone (dropped). */
function splitTimestamp(s: string): { day: string; clock: string; zone: boolean } | undefined {
  let t = s.trim();
  let zone = false;
  t = t.replace(/\s*(?:Z|UTC|GMT|[+-]\d{2}:?\d{2})$/i, () => { zone = true; return ''; });
  const m = /^(.+?)(?:T|\s+(?:at\s+)?|\s*@\s*)(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[AaPp][Mm])?)$/.exec(t);
  return m ? { day: m[1], clock: m[2], zone } : undefined;
}

function isoDay(day: Day, dayFirst: boolean): string | undefined {
  if (day.slash) {
    const [a, b] = day.slash;
    const [mo, d] = dayFirst ? [b, a] : [a, b];
    return validDay(day.y, mo, d) ? `${String(day.y).padStart(4, '0')}-${two(mo)}-${two(d)}` : undefined;
  }
  return `${String(day.y).padStart(4, '0')}-${two(day.m)}-${two(day.d)}`;
}

const TRUE_WORDS = new Set(['checked', 'yes', 'true']);
const FALSE_WORDS = new Set(['unchecked', 'no', 'false']);

/** A value in the form the store takes (dates as ISO), or undefined when the kind can't hold it. Counts time zones dropped. */
function convert(kind: ColumnKind, raw: string, dayFirst: boolean, zones: { n: number }): string | undefined {
  const v = raw.trim();
  switch (kind) {
    case 'number': { const n = parseNumber(v); return n === undefined ? undefined : String(n); }
    case 'checkbox': return TRUE_WORDS.has(v.toLowerCase()) || v === '1' ? '1' : FALSE_WORDS.has(v.toLowerCase()) || v === '0' ? '0' : undefined;
    case 'date': { const d = parseDay(v); return d && isoDay(d, dayFirst); }
    case 'time': return parseClock(v);
    case 'timestamp': {
      const parts = splitTimestamp(v);
      const day = parts && parseDay(parts.day);
      const iso = day && isoDay(day, dayFirst);
      const clock = parts && parseClock(parts.clock);
      if (!parts || !iso || !clock) return undefined;
      if (parts.zone) zones.n++;
      return `${iso} ${clock}`;
    }
    case 'multi': return v.split(/\s*,\s*/).filter(Boolean).filter((x, i, all) => all.indexOf(x) === i).join('\n');
    default: return raw;
  }
}

// --- reading a sheet -------------------------------------------------------------------------------------------------

/** The data rows of a sheet, padded or cut to the header's width, with those that needed it counted; whole empty rows are left out. */
function dataRows(sheet: SheetInput, width: number): { rows: string[][]; ragged: number } {
  const rows: string[][] = [];
  let ragged = 0;
  for (const r of sheet.rows.slice(1)) {
    const cells = r.map(text);
    if (cells.every((c) => !c.trim())) continue;
    if (cells.length !== width) {
      // A longer row is only ragged when what overflows holds something.
      if (cells.length < width || cells.slice(width).some((c) => c.trim())) ragged++;
    }
    rows.push(Array.from({ length: width }, (_, i) => cells[i] ?? ''));
  }
  return { rows, ragged };
}

const stripNotionLink = (s: string) => s.replace(/\s*\(https?:\/\/[^)\s]*\)\s*$/, '');

/** The linked names in a cell: the whole value if it names a row, otherwise its comma-separated parts. */
function linkNames(value: string, known: ReadonlySet<string>): string[] {
  const v = stripNotionLink(value.trim());
  if (!v) return [];
  if (known.has(v)) return [v];
  return value.split(/\s*,\s*(?![^()]*\))/).map((p) => stripNotionLink(p.trim())).filter(Boolean);
}

// --- the plan ------------------------------------------------------------------------------------------------------

function inferKind(values: string[]): { kind: ColumnKind; dayFirst?: boolean; options?: string[]; note?: string } {
  const vals = values.map((v) => v.trim()).filter(Boolean);
  if (!vals.length) return { kind: 'text' };
  if (vals.every((v) => TRUE_WORDS.has(v.toLowerCase()) || FALSE_WORDS.has(v.toLowerCase())) && vals.some((v) => /^[a-z]/i.test(v))) return { kind: 'checkbox' };
  if (vals.every((v) => parseNumber(v) !== undefined)) return { kind: 'number' };
  const kindOfDates = (kind: 'date' | 'timestamp') => {
    const days = vals.map((v) => (kind === 'date' ? parseDay(v) : (() => { const p = splitTimestamp(v); return p && parseDay(p.day); })()));
    if (days.some((d) => !d)) return undefined;
    const slashes = days.filter((d) => d!.slash).map((d) => d!.slash!);
    const dayFirst = slashes.some(([a]) => a > 12);
    const monthFirst = slashes.some(([, b]) => b > 12);
    if (dayFirst && monthFirst) return undefined;
    const order = dayFirst;
    if (!convertAll(kind, vals, order)) return undefined;
    const ambiguous = slashes.length > 0 && !dayFirst && !monthFirst && slashes.some(([a, b]) => a !== b);
    return { kind, dayFirst: order, note: ambiguous ? 'dates like 3/4/2026 could be day first; read month first' : undefined } as const;
  };
  const date = kindOfDates('date');
  if (date) return date;
  const stamp = kindOfDates('timestamp');
  if (stamp) return stamp;
  if (vals.every((v) => parseClock(v))) return { kind: 'time' };
  // Text: few distinct values in many rows is a choice list, comma-separated lists of few are multi-choice.
  if (vals.length >= 8) {
    const distinct = [...new Set(vals)];
    if (distinct.length <= 12 && distinct.length <= vals.length / 2 && distinct.every((d) => !d.includes('\n'))) {
      if (!vals.some((v) => v.includes(','))) return { kind: 'select', options: distinct };
    }
    const tokens = vals.flatMap((v) => v.split(/\s*,\s*/).filter(Boolean));
    const distinctTokens = [...new Set(tokens)];
    if (vals.some((v) => v.includes(',')) && distinctTokens.length <= 20 && distinctTokens.length <= vals.length / 2 && distinctTokens.every((t) => t.length <= 40)) return { kind: 'multi', options: distinctTokens };
  }
  return { kind: 'text' };
}

function convertAll(kind: ColumnKind, vals: string[], dayFirst: boolean): boolean {
  const zones = { n: 0 };
  return vals.every((v) => convert(kind, v, dayFirst, zones) !== undefined);
}

/**
 * What an import would make, to show before anything is written: each sheet's table and fields with the kind worked out
 * for every column, the columns that are links to another sheet, and counts of what needed fixing.
 */
export function planImportTables(sheets: SheetInput[], opts: { overrides?: ColumnOverrides; existing?: string[]; links?: boolean } = {}): ImportTablesPlan {
  if (!sheets.length) throw new StoreError(3, 'Nothing to import');
  const tables = new Set((opts.existing ?? []).map((n) => n.toLowerCase()));
  const planned: PlannedSheet[] = [];
  const parsed = sheets.map((s) => {
    const header = (s.rows[0] ?? []).map(text);
    if (header.length > MAX_IMPORT_COLUMNS) throw new StoreError(3, `"${s.name}" has ${header.length} columns; at most ${MAX_IMPORT_COLUMNS} are imported`);
    // The width is the header's, less empty columns on the right that no row uses.
    const { rows, ragged } = dataRows(s, header.length);
    if (rows.length > MAX_IMPORT_ROWS) throw new StoreError(3, `"${s.name}" has ${rows.length} rows; at most ${MAX_IMPORT_ROWS} are imported at once`);
    return { sheet: s, header, rows, ragged };
  });
  for (const p of parsed) {
    const table = cleanName(p.sheet.name, tables, 'Sheet');
    const names = new Set<string>();
    const idField = cleanName('ID', names, 'ID');
    // The key is named first; a sheet column called ID is renamed instead.
    const columns: PlannedColumn[] = p.header.map((h, i) => ({ column: i, header: h, name: '', kind: 'text', inferred: true }));
    for (const c of columns) c.name = cleanName(c.header, names, `Column ${c.column + 1}`);
    planned.push({ sheet: p.sheet.name, table, idField, columns, rows: p.rows.length, ragged: p.ragged, notes: [] });
  }
  // Which columns name rows of another sheet.
  const primary = new Map(parsed.map((p) => [p.sheet.name, new Set(p.rows.map((r) => stripNotionLink(r[0]?.trim() ?? '')).filter(Boolean))]));
  parsed.forEach((p, si) => {
    const plan = planned[si];
    // Sheets and columns can be named anything: only the choices that were made (own properties) count.
    const ownOf = <T>(o: Record<string, T> | undefined, key: string): T | undefined => (o && Object.hasOwn(o, key) ? o[key] : undefined);
    const override = ownOf(opts.overrides, p.sheet.name) ?? {};
    for (const c of plan.columns) {
      const forced = ownOf(override, c.header) ?? ownOf(override, c.name);
      if (forced !== undefined) {
        const link = /^link:(.+)$/.exec(forced);
        if (link) {
          if (!primary.has(link[1])) throw new StoreError(3, `"${p.sheet.name}"."${c.header}" is set to link to "${link[1]}", which is not among the sheets`);
          c.kind = 'link'; c.target = link[1]; c.inferred = false;
          continue;
        }
        if (!KINDS.includes(forced as ColumnKind) || forced === 'link') throw new StoreError(3, `"${forced}" is not a column kind (${KINDS.filter((k) => k !== 'link').join(', ')}, or link:<sheet>)`);
        c.kind = forced as ColumnKind; c.inferred = false;
        if (c.kind === 'select' || c.kind === 'multi') {
          const tokens = p.rows.flatMap((r) => (c.kind === 'multi' ? r[c.column].split(/\s*,\s*/) : [r[c.column].trim()])).filter(Boolean);
          c.options = [...new Set(tokens)].slice(0, 200);
        }
        continue;
      }
      const values = p.rows.map((r) => r[c.column]);
      // A column of linked records: most of what it holds names a row of another sheet's first column.
      if (opts.links !== false && c.column > 0) {
        const nonEmpty = values.filter((v) => v.trim());
        let best: { sheet: string; hit: number } | undefined;
        for (const [other, names] of primary) {
          if (other === p.sheet.name || !names.size || nonEmpty.length < 2) continue;
          const tokens = nonEmpty.flatMap((v) => linkNames(v, names));
          const hit = tokens.length ? tokens.filter((t) => names.has(t)).length / tokens.length : 0;
          if (hit >= 0.9 && (!best || hit > best.hit)) best = { sheet: other, hit };
        }
        if (best) { c.kind = 'link'; c.target = best.sheet; continue; }
      }
      const kind = inferKind(values);
      c.kind = kind.kind; c.dayFirst = kind.dayFirst; c.options = kind.options;
      if (kind.note) plan.notes.push(`${c.name}: ${kind.note}`);
    }
  });
  return { sheets: planned, notes: [FORMULA_NOTE] };
}

// --- writing ------------------------------------------------------------------------------------------------------

interface Prepared { plan: PlannedSheet; rows: string[][]; fields: PlannedColumn[] }

/**
 * Makes the tables, records, value lists, join tables and relationships a plan describes. Needs full access (it
 * changes the file's design). Everything it made is removed again if it fails partway.
 */
export function importTables(store: Store, sheets: SheetInput[], plan: ImportTablesPlan, opts: { privileges?: Privileges; account?: string } = {}): ImportTablesReport {
  if (opts.privileges && !opts.privileges.in(store).full) throw new PrivilegeError(0, 'Importing as new tables changes the file\'s design and needs [Full Access]');
  const bySheet = new Map(sheets.map((s) => [s.name, s]));
  const prepared: Prepared[] = plan.sheets.map((p) => {
    const sheet = bySheet.get(p.sheet);
    if (!sheet) throw new StoreError(3, `The plan names the sheet "${p.sheet}", which is not among the sheets`);
    const { rows } = dataRows(sheet, p.columns.length);
    return { plan: p, rows, fields: p.columns.filter((c) => c.kind !== 'skip' && c.kind !== 'link') };
  });
  for (const t of plan.sheets) if (store.schema.tables.some((x) => x.name.toLowerCase() === t.table.toLowerCase())) throw new StoreError(3, `The file already has a table called "${t.table}"`);
  const report: ImportTablesReport = {
    tables: 0, fields: 0, rows: 0, joinTables: 0, links: 0, valueLists: 0, unmatchedLinks: 0, ambiguousLinks: 0, raggedRows: 0, renamedColumns: 0,
    skippedColumns: 0, unfittingValues: 0, zonesDropped: 0, portals: 0, notes: [...plan.notes],
  };
  const taken = new Set([...store.schema.tables.map((t) => t.name.toLowerCase()), ...plan.sheets.map((p) => p.table.toLowerCase())]);

  // The design: tables with their key, then value lists, join tables and relationships.
  const ops: Record<string, unknown>[] = [];
  const valueLists = new Set(store.schema.valueLists.map((v) => v.name.toLowerCase()));
  interface Join { name: string; from: Prepared; target: Prepared; column: PlannedColumn; fromKey: string; toKey: string; nameField: string }
  const joins: Join[] = [];
  for (const p of prepared) {
    report.raggedRows += p.plan.ragged;
    report.renamedColumns += p.plan.columns.filter((c) => c.name !== c.header.trim()).length;
    report.skippedColumns += p.plan.columns.filter((c) => c.kind === 'skip').length;
    const fields: Record<string, unknown>[] = [{ name: p.plan.idField, type: 'number', options: { autoEnter: { serial: { next: String(p.rows.length + 1), increment: 1 } } } }];
    for (const c of p.fields) {
      const type = c.kind === 'number' || c.kind === 'checkbox' ? 'number' : c.kind === 'date' || c.kind === 'time' || c.kind === 'timestamp' ? c.kind : 'text';
      fields.push({ name: c.name, type });
    }
    ops.push({ op: 'createTable', name: p.plan.table, fields });
    for (const c of p.fields.filter((x) => x.kind === 'select' || x.kind === 'multi')) {
      let name = `${p.plan.table} ${c.name}`.slice(0, 100);
      for (let n = 2; valueLists.has(name.toLowerCase()); n++) name = `${p.plan.table} ${c.name} ${n}`.slice(0, 100);
      valueLists.add(name.toLowerCase());
      ops.push({ op: 'createValueList', name, values: c.options ?? [] });
      report.valueLists++;
    }
  }
  for (const p of prepared) {
    for (const c of p.plan.columns.filter((x) => x.kind === 'link')) {
      const target = prepared.find((t) => t.plan.sheet === c.target)!;
      const base = cleanName(`${p.plan.table} ${c.name}`, taken, 'Links');
      const fromKey = cleanName(`${p.plan.table} ${p.plan.idField}`, new Set(), 'From');
      let toKey = cleanName(`${target.plan.table} ${target.plan.idField}`, new Set(), 'To');
      if (toKey.toLowerCase() === fromKey.toLowerCase()) toKey += ' 2';
      let nameField = cleanName(`${target.plan.table} name`, new Set([fromKey.toLowerCase(), toKey.toLowerCase()]), 'Name');
      if (nameField.toLowerCase() === toKey.toLowerCase()) nameField += ' text';
      joins.push({ name: base, from: p, target, column: c, fromKey, toKey, nameField });
      ops.push({ op: 'createTable', name: base, fields: [{ name: fromKey, type: 'number' }, { name: toKey, type: 'number' }, { name: nameField, type: 'text' }] });
      ops.push({ op: 'createRelationship', left: p.plan.table, right: base, predicates: [{ left: p.plan.idField, op: '=', right: fromKey }] });
      ops.push({ op: 'createRelationship', left: target.plan.table, right: base, predicates: [{ left: target.plan.idField, op: '=', right: toKey }] });
      report.joinTables++;
    }
  }
  try {
    store.applyDesign(ops as never);
    const zones = { n: 0 };
    // Records: the key is the row's place in the sheet, so a link can name it.
    const idOf = new Map<string, Map<string, number[]>>();
    for (const p of prepared) {
      const byName = new Map<string, number[]>();
      idOf.set(p.plan.sheet, byName);
      p.rows.forEach((row, i) => {
        const key = stripNotionLink(row[0]?.trim() ?? '');
        if (key) byName.set(key, [...(byName.get(key) ?? []), i + 1]);
      });
      p.rows.forEach((row, i) => {
        const data: Record<string, string | number> = { [p.plan.idField]: i + 1 };
        for (const c of p.fields) {
          const raw = row[c.column];
          if (!raw.trim()) {
            if (c.kind === 'checkbox') data[c.name] = '0';
            continue;
          }
          const value = convert(c.kind, raw, c.dayFirst ?? false, zones);
          if (value === undefined) report.unfittingValues++;
          else data[c.name] = value;
        }
        store.create(p.plan.table, data, { account: opts.account, dateOrder: 'ISO' });
        report.rows++;
      });
    }
    report.zonesDropped = zones.n;
    for (const j of joins) {
      const known = idOf.get(j.target.plan.sheet)!;
      const names = new Set(known.keys());
      j.from.rows.forEach((row, i) => {
        const seen = new Set<string>();
        for (const name of linkNames(row[j.column.column], names)) {
          const ids = known.get(name);
          if (!ids) { report.unmatchedLinks++; continue; }
          if (ids.length > 1) report.ambiguousLinks++;
          if (seen.has(name)) continue;
          seen.add(name);
          store.create(j.name, { [j.fromKey]: i + 1, [j.toKey]: ids[0], [j.nameField]: name }, { account: opts.account, dateOrder: 'ISO' });
          report.links++;
        }
      });
    }
    for (const p of prepared) report.notes.push(...p.plan.notes.map((n) => `${p.plan.table}: ${n}`));
    report.tables = prepared.length;
    report.fields = prepared.reduce((n, p) => n + 1 + p.fields.length, 0);
    for (const p of prepared) report.portals += portalFor(store, p.plan, joins.filter((j) => j.from === p), report.notes);
  } catch (e) {
    // Nothing half-made: the tables just added go again, with their layouts and value lists.
    const tables = ops.filter((o) => o.op === 'createTable').map((o) => String(o.name)).filter((n) => store.schema.tables.some((t) => t.name === n));
    const layouts = store.schema.layouts.filter((l) => tables.includes(l.name)).map((l) => l.name);
    const lists = ops.filter((o) => o.op === 'createValueList').map((o) => String(o.name)).filter((n) => store.schema.valueLists.some((v) => v.name === n));
    try {
      store.applyDesign([
        ...layouts.map((layout) => ({ op: 'deleteLayout', layout })),
        ...tables.reverse().map((table) => ({ op: 'deleteTable', table })),
        ...lists.map((valueList) => ({ op: 'deleteValueList', valueList })),
      ] as never);
    } catch { /* the original error is the one to report */ }
    throw e;
  }
  return report;
}

/** A portal on the form layout of a table, for each join table made from it, showing the linked names. */
function portalFor(store: Store, plan: PlannedSheet, joins: { name: string; nameField: string }[], notes: string[]): number {
  if (!joins.length) return 0;
  try {
    const schema = store.schema;
    const own = schema.layouts.find((l) => l.name === plan.table);
    const occurrence = schema.tableOccurrences.find((o) => o.name === plan.table);
    if (!own || !occurrence) throw new Error('no layout');
    const portals = joins.map((j) => {
      const to = schema.tableOccurrences.find((o) => o.name === j.name)!;
      const table = schema.tables.find((t) => t.id === to.baseTableId)!;
      return { occurrence: to.id, fields: table.fields.filter((f) => f.name === j.nameField).map((f) => f.id), rows: 5 };
    });
    const draft = draftLayout(schema, store.designs(), { title: plan.table, occurrence: occurrence.id, view: 'form', portals });
    store.applyDesign([{ op: 'updateLayout', layout: own.name, design: draft.design }] as never);
    return joins.length;
  } catch (e) {
    notes.push(`The relationships for ${plan.table} were made, but its layout was left as it was (${e instanceof Error ? e.message : String(e)}).`);
    return 0;
  }
}

// --- Notion's Markdown export ------------------------------------------------------------------------------------------

/**
 * Pages exported from Notion as Markdown (a folder of .md files) as one sheet: the title from the first heading,
 * the "Property: value" lines under it as columns, and the rest of the page as Body.
 */
export function notionMarkdownSheet(name: string, pages: { file: string; text: string }[]): SheetInput {
  const rows: Record<string, string>[] = [];
  const columns = ['Title'];
  // A Set beside the list keeps a page of many distinct properties linear; past the column limit more are not kept, as the plan refuses the sheet anyway.
  const known = new Set(columns);
  const addColumn = (name: string) => {
    if (known.has(name) || columns.length > MAX_IMPORT_COLUMNS) return;
    known.add(name);
    columns.push(name);
  };
  for (const page of pages) {
    const lines = page.text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    const row: Record<string, string> = {};
    const heading = /^#\s+(.*)$/.exec(lines[i] ?? '');
    row.Title = heading ? heading[1].trim() : page.file.replace(/\.md$/i, '').replace(/\s[0-9a-f]{32}$/, '');
    if (heading) i++;
    while (i < lines.length && !lines[i].trim()) i++;
    for (; i < lines.length; i++) {
      const prop = /^([^:\n]{1,60}):\s?(.*)$/.exec(lines[i]);
      if (!prop || !lines[i].trim()) break;
      addColumn(prop[1]);
      row[prop[1]] = stripNotionLink(prop[2]).trim();
    }
    const body = lines.slice(i).join('\n').trim();
    if (body) { addColumn('Body'); row.Body = body; }
    rows.push(row);
  }
  return { name, rows: [columns, ...rows.map((r) => columns.map((c) => r[c] ?? ''))] };
}

/** The counts as lines for a terminal. */
export function importTablesSummary(r: ImportTablesReport): string[] {
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const lines = [`${n(r.tables, 'table')}, ${n(r.fields, 'field')}, ${n(r.rows, 'row')}, ${n(r.valueLists, 'value list')}, ${n(r.joinTables, 'join table')} holding ${n(r.links, 'link')}, ${n(r.portals, 'portal')}`];
  if (r.renamedColumns) lines.push(`${n(r.renamedColumns, 'column')} renamed to suit the file`);
  if (r.skippedColumns) lines.push(`${n(r.skippedColumns, 'column')} skipped`);
  if (r.raggedRows) lines.push(`${n(r.raggedRows, 'row')} shorter or longer than the header, padded or cut`);
  if (r.unfittingValues) lines.push(`${n(r.unfittingValues, 'value')} left empty because the chosen type could not hold it`);
  if (r.unmatchedLinks) lines.push(`${n(r.unmatchedLinks, 'link')} named a row that is not in the other sheet`);
  if (r.ambiguousLinks) lines.push(`${n(r.ambiguousLinks, 'link')} named a row that several rows share (the first was used)`);
  if (r.zonesDropped) lines.push(`${n(r.zonesDropped, 'time')} had a time zone, kept as the clock time written`);
  lines.push(...r.notes);
  return lines;
}
