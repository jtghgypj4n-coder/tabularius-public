import { sanitize } from './fmexport.ts';
import type { Field, FieldType, Table } from '../../fmp12/src/index.ts';
import type { Privileges } from './privileges.ts';
import { Store, StoreError } from './store.ts';

export type SqlDialect = 'postgres' | 'sqlite';

/** Where an export goes: the script's text, in order, and the container files next to it (paths relative to the script). */
export interface ExportSqlSink {
  write(text: string): void;
  file(path: string, data: Uint8Array): void;
}

export interface ExportSqlOptions {
  dialect?: SqlDialect;
  /** The account the export runs as; without it the operator is trusted with the whole file. */
  privileges?: Privileges;
  /** Folder (relative to the script) the container files are written into, e.g. "Invoices.files". */
  filesFolder?: string;
  /** Rows per INSERT statement. */
  batch?: number;
}

/** What an export carried and left behind: counts only, never names or values. */
export interface ExportSqlReport {
  dialect: SqlDialect;
  tables: number;
  fields: number;
  rows: number;
  containerFiles: number;
  valueLists: number;
  primaryKeys: number;
  uniqueConstraints: number;
  notNullConstraints: number;
  foreignKeys: number;
  indexes: number;
  sequences: number;
  /** Cells set to NULL because the text in them doesn't fit the column's type (a date field holding "soon"). */
  unfittingValues: number;
  /** Cells that held a NUL character, which SQL text can't, with it left out. */
  nulCharactersDropped: number;
  /** Objects left out, by reason. */
  skipped: Record<string, number>;
  /** Constraints the file declares but its data breaks, left out so the script still loads. */
  constraintsLeftOut: Record<string, number>;
  renamed: number;
}

const PG_NAME_BYTES = 63;

/** A name made safe for the target: unique ignoring case (SQLite folds it), and short enough for PostgreSQL. */
class Names {
  private readonly used = new Set<string>();
  renamed = 0;
  private readonly dialect: SqlDialect;

  constructor(dialect: SqlDialect) {
    this.dialect = dialect;
  }

  take(wanted: string, reserved = false): string {
    let base = wanted.replace(/\u0000/g, '');
    if (!base) base = '_';
    if (this.dialect === 'sqlite' && /^sqlite_/i.test(base)) base = `_${base}`;
    base = this.fit(base);
    let name = base;
    for (let n = 2; this.used.has(name.toLowerCase()); n++) name = this.fit(base, `_${n}`);
    this.used.add(name.toLowerCase());
    if (name !== wanted && !reserved) this.renamed++;
    return name;
  }

  private fit(base: string, suffix = ''): string {
    if (this.dialect !== 'postgres') return base + suffix;
    let chars = [...base];
    while (Buffer.byteLength(chars.join('') + suffix) > PG_NAME_BYTES) chars = chars.slice(0, -1);
    return chars.join('') + suffix;
  }
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const str = (s: string) => `'${s.replace(/'/g, "''")}'`;
const comment = (s: string) => s.replace(/\r\n?|\n/g, ' ⏎ ').replace(/\u0000/g, '');

type Norm = string | number | boolean | null;
type SqlKind = 'text' | 'number' | 'integer' | 'decimal' | 'boolean' | 'date' | 'time' | 'timestamp' | 'json' | 'uuid';

const KIND: Record<FieldType, SqlKind> = {
  text: 'text', number: 'number', date: 'date', time: 'time', timestamp: 'timestamp', container: 'text', unknown: 'text',
  boolean: 'boolean', integer: 'integer', decimal: 'decimal', json: 'json', uuid: 'uuid',
};

const SQL_TYPE: Record<SqlDialect, Record<SqlKind, string>> = {
  postgres: { text: 'TEXT', number: 'DOUBLE PRECISION', integer: 'BIGINT', decimal: 'NUMERIC', boolean: 'BOOLEAN', date: 'DATE', time: 'TIME', timestamp: 'TIMESTAMP', json: 'JSONB', uuid: 'UUID' },
  sqlite: { text: 'TEXT', number: 'REAL', integer: 'INTEGER', decimal: 'TEXT', boolean: 'INTEGER', date: 'TEXT', time: 'TEXT', timestamp: 'TEXT', json: 'TEXT', uuid: 'TEXT' },
};

const validDate = (y: number, m: number, d: number) => y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(2000 + (y % 400), m, 0)).getUTCDate();

/** A stored value in the form its column holds (null when it doesn't fit), and whether it was lost doing so. */
function normalize(kind: SqlKind, v: unknown): { v: Norm; unfit?: boolean; nul?: boolean } {
  if (v === null || v === undefined) return { v: null };
  switch (kind) {
    case 'text': {
      const s = typeof v === 'string' ? v : String(v);
      return s.includes('\u0000') ? { v: s.replace(/\u0000/g, ''), nul: true } : { v: s };
    }
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(v) ? Number(v) : NaN;
      return Number.isFinite(n) ? { v: n } : { v: null, unfit: true };
    }
    case 'integer': {
      const s = String(v).trim();
      return /^[+-]?\d+$/.test(s) ? { v: s.replace(/^\+/, '') } : { v: null, unfit: true };
    }
    case 'decimal': {
      const s = String(v).trim();
      return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) ? { v: s.replace(/^\+/, '') } : { v: null, unfit: true };
    }
    case 'boolean': {
      const s = String(v).trim().toLowerCase();
      return s === '1' || s === 'true' ? { v: true } : s === '0' || s === 'false' ? { v: false } : { v: null, unfit: true };
    }
    case 'date': {
      const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(v));
      return m && validDate(+m[1], +m[2], +m[3]) ? { v: String(v) } : { v: null, unfit: true };
    }
    case 'time': {
      const m = /^(\d\d):(\d\d):(\d\d)(\.\d+)?$/.exec(String(v));
      return m && +m[1] < 24 && +m[2] < 60 && +m[3] < 60 ? { v: String(v) } : { v: null, unfit: true };
    }
    case 'timestamp': {
      const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(\.\d+)?$/.exec(String(v));
      return m && validDate(+m[1], +m[2], +m[3]) && +m[4] < 24 && +m[5] < 60 && +m[6] < 60 ? { v: String(v) } : { v: null, unfit: true };
    }
    case 'json':
      try {
        JSON.parse(String(v));
        return { v: String(v) };
      } catch {
        return { v: null, unfit: true };
      }
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v)) ? { v: String(v) } : { v: null, unfit: true };
  }
}

function render(kind: SqlKind, v: Norm, dialect: SqlDialect): string {
  if (v === null) return 'NULL';
  switch (kind) {
    case 'number': {
      const n = v as number;
      if (Object.is(n, -0)) return dialect === 'postgres' ? `'-0'::double precision` : '-0.0';
      return String(n);
    }
    case 'integer': return v as string;
    case 'decimal': return dialect === 'postgres' ? (v as string) : str(v as string);
    case 'boolean': return dialect === 'postgres' ? (v ? 'TRUE' : 'FALSE') : v ? '1' : '0';
    case 'timestamp': return str(dialect === 'postgres' ? (v as string).replace('T', ' ') : (v as string));
    default: return str(v as string);
  }
}

/** One cell of a repeating field: a PostgreSQL array, or a JSON list in SQLite. */
function renderRepeating(kind: SqlKind, items: Norm[], dialect: SqlDialect): string {
  if (dialect === 'postgres') return `ARRAY[${items.map((i) => render(kind, i, dialect)).join(', ')}]::${SQL_TYPE.postgres[kind]}[]`;
  return str(JSON.stringify(items.map((i) => (kind === 'number' && typeof i === 'number' && Object.is(i, -0) ? -0 : i))));
}

interface Col {
  field: Field;
  column: string;
  kind: SqlKind;
  repeating: boolean;
  container: boolean;
  sqlType: string;
  unique: boolean;
  notNull: boolean;
  seq?: { name: string; start: string; increment: number };
  /** Normalised values: how many are NULL or empty, how many didn't fit, the largest whole number. */
  nulls: number;
  empties: number;
  unfit: number;
  max?: bigint;
}

interface Tab {
  table: Table;
  name: string;
  idColumn: string;
  base: string;
  cols: Col[];
  rows: number;
  maxId: number;
  foreign: { column: string; parent: Tab; parentColumn: string; name: string }[];
  indexes: { name: string; column: string }[];
}

const bump = (counts: Record<string, number>, key: string, by = 1) => {
  counts[key] = (counts[key] ?? 0) + by;
};

/**
 * Writes a hosted file as a SQL script that creates its tables and loads its records, for PostgreSQL or SQLite,
 * and its container files beside it. Account privileges narrow it: the records and fields the account can view,
 * and nothing at all unless it may export. Scripts, layouts and privilege sets are not carried.
 */
export function exportSql(store: Store, sink: ExportSqlSink, opts: ExportSqlOptions = {}): ExportSqlReport {
  const dialect = opts.dialect ?? 'postgres';
  if (dialect !== 'postgres' && dialect !== 'sqlite') throw new StoreError(501, `Unknown SQL dialect "${String(dialect)}" (postgres or sqlite)`);
  const pv = store.local(opts.privileges);
  if (opts.privileges && !opts.privileges.in(store).canExport) throw new StoreError(9, `The account "${opts.privileges.account}" may not export records from this file`);
  const batch = Math.max(1, Math.min(opts.batch ?? 200, 1000));
  const names = new Names(dialect);
  const report: ExportSqlReport = {
    dialect, tables: 0, fields: 0, rows: 0, containerFiles: 0, valueLists: 0, primaryKeys: 0, uniqueConstraints: 0, notNullConstraints: 0,
    foreignKeys: 0, indexes: 0, sequences: 0, unfittingValues: 0, nulCharactersDropped: 0, skipped: {}, constraintsLeftOut: {}, renamed: 0,
  };
  const schema = store.schema;
  const readBatch = 500;

  // --- the tables and columns that will be written -------------------------
  const tabs: Tab[] = [];
  for (const table of schema.tables) {
    if (pv && pv.table(table.name).view === false) {
      bump(report.skipped, 'table the account may not view');
      continue;
    }
    // Straight from the table (main.), not the view that reads decimal numbers as floating point.
    const base = store.scopedTableSql(table.name, opts.privileges)?.replace(` FROM ${q(table.name)} WHERE `, ` FROM main.${q(table.name)} WHERE `) ?? `main.${q(table.name)}`;
    const present = new Set(store.select(`SELECT * FROM (${base}) LIMIT 1`, [], 1).names);
    const tabName = names.take(table.name);
    const used = new Names(dialect);
    const idColumn = used.take('record_id', true);
    const cols: Col[] = [];
    for (const field of table.fields) {
      if (field.options?.global) { bump(report.skipped, 'global field (one value for the file)'); continue; }
      if (field.kind === 'summary') { bump(report.skipped, 'summary field (worked out from other records)'); continue; }
      if (!present.has(field.name)) { bump(report.skipped, field.kind === 'calculation' ? 'unstored calculation (no value kept)' : 'field with no stored value'); continue; }
      if (store.fieldHidden(table.name, field.name, opts.privileges)) { bump(report.skipped, 'field the account may not read'); continue; }
      const repeating = store.isRepeating(table.name, field.name) || (field.options?.repetitions ?? 1) > 1;
      const container = field.type === 'container';
      if (container && repeating) { bump(report.skipped, 'repeating container field'); continue; }
      const kind = container ? 'text' : KIND[field.type] ?? 'text';
      const column = used.take(field.name);
      cols.push({
        field, column, kind, repeating, container, sqlType: SQL_TYPE[dialect][kind] + (repeating && dialect === 'postgres' ? '[]' : ''),
        unique: false, notNull: false, nulls: 0, empties: 0, unfit: 0,
      });
    }
    report.renamed += used.renamed;
    tabs.push({ table, name: tabName, idColumn, base, cols, rows: 0, maxId: 0, foreign: [], indexes: [] });
  }

  const columnList = (t: Tab) => ['_fm_record_id', ...t.cols.map((c) => q(c.field.name))].join(', ');
  const page = (t: Tab, after: number) => store.select(`SELECT ${columnList(t)} FROM (${t.base}) WHERE _fm_record_id > ? ORDER BY _fm_record_id LIMIT ${readBatch}`, [after], readBatch).rows;
  const cellOf = (c: Col, raw: unknown): { items?: Norm[]; one?: Norm; unfit: number; nul: number } => {
    if (!c.repeating) {
      const n = normalize(c.kind, raw);
      return { one: n.v, unfit: n.unfit ? 1 : 0, nul: n.nul ? 1 : 0 };
    }
    if (raw === null || raw === undefined) return { one: null, unfit: 0, nul: 0 };
    let list: unknown[];
    try {
      const parsed: unknown = JSON.parse(String(raw));
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      list = [raw];
    }
    let unfit = 0, nul = 0;
    const items = list.map((x) => {
      const n = normalize(c.kind, x);
      if (n.unfit) unfit++;
      if (n.nul) nul++;
      return n.v;
    });
    return { items, unfit, nul };
  };

  // --- first pass: what the data allows (constraints, sequences) ------------
  for (const t of tabs) {
    for (let last = 0; ;) {
      const rows = page(t, last);
      if (!rows.length) break;
      for (const row of rows) {
        t.rows++;
        last = t.maxId = Number(row[0]);
        t.cols.forEach((c, i) => {
          const cell = cellOf(c, row[i + 1]);
          c.unfit += cell.unfit;
          if (cell.one === null || cell.one === '' || (cell.items && !cell.items.length)) {
            if (cell.one === null) c.nulls++;
            else c.empties++;
          }
          if (!c.repeating && !c.container && (c.kind === 'integer' || c.kind === 'number') && cell.one !== null && cell.one !== undefined) {
            const whole = typeof cell.one === 'number' ? (Number.isInteger(cell.one) && Math.abs(cell.one) <= Number.MAX_SAFE_INTEGER ? BigInt(cell.one) : undefined) : /^-?\d+$/.test(String(cell.one)) ? BigInt(String(cell.one)) : undefined;
            if (whole !== undefined && (c.max === undefined || whole > c.max)) c.max = whole;
          }
        });
      }
    }
  }

  const duplicates = (t: Tab, c: Col): boolean => {
    const col = q(c.field.name);
    return Number(store.select(`SELECT COUNT(*) FROM (SELECT ${col} FROM (${t.base}) WHERE ${col} IS NOT NULL GROUP BY ${col} HAVING COUNT(*) > 1)`, [], 1).rows[0][0]) > 0;
  };
  const leaveOut = (why: string) => bump(report.constraintsLeftOut, why);

  for (const t of tabs) {
    for (const c of t.cols) {
      const v = c.field.options?.validation;
      if (c.repeating || c.container) continue;
      if (v?.unique) {
        if (c.unfit === 0 && !duplicates(t, c)) c.unique = true;
        else leaveOut('unique (the data repeats a value)');
      }
      if (v?.notEmpty) {
        if (c.nulls === 0 && c.empties === 0 && t.rows > 0) c.notNull = true;
        else if (t.rows > 0) leaveOut('not empty (the data has empty values)');
        else c.notNull = true;
      }
      const serial = c.field.options?.autoEnter?.serial;
      if (serial && dialect === 'postgres' && (c.kind === 'number' || c.kind === 'integer')) {
        const next = store.calc.peekSerial(t.table, c.field);
        const inc = serial.increment || 1;
        if (next !== undefined && /^\d+$/.test(next) && inc > 0 && inc <= Number.MAX_SAFE_INTEGER) {
          const past = c.max === undefined ? 0n : c.max + BigInt(inc);
          const start = BigInt(next) > past ? BigInt(next) : past;
          c.seq = { name: names.take(`${t.table.name}_${c.field.name}_seq`, true), start: start.toString(), increment: inc };
        } else leaveOut('serial number (not a plain counter)');
      }
    }
  }

  // --- relationships: foreign keys where the data agrees, indexes where not ---
  const byOccurrence = new Map(schema.tableOccurrences.map((o) => [o.id, o]));
  const tabOf = new Map(tabs.map((t) => [t.table.id, t]));
  const seen = new Set<string>();
  const colOf = (t: Tab, fieldId: number): Col | undefined => t.cols.find((c) => c.field.id === fieldId);
  const idx = (t: Tab, c: Col) => {
    if (t.indexes.some((i) => i.column === c.column)) return;
    t.indexes.push({ name: names.take(`${t.table.name}_${c.field.name}_idx`, true), column: c.column });
  };
  for (const r of schema.relationships) {
    const left = byOccurrence.get(r.leftTableOccurrenceId);
    const right = byOccurrence.get(r.rightTableOccurrenceId);
    if (!left || !right || left.dataSourceId || right.dataSourceId) { bump(report.skipped, 'relationship to another file'); continue; }
    if (r.predicates.length !== 1 || r.predicates[0].operator !== '=') { bump(report.skipped, 'relationship that is not a single equality'); continue; }
    const lt = tabOf.get(left.baseTableId ?? -1);
    const rt = tabOf.get(right.baseTableId ?? -1);
    const lc = lt && colOf(lt, r.predicates[0].leftFieldId);
    const rc = rt && colOf(rt, r.predicates[0].rightFieldId);
    if (!lt || !rt || !lc || !rc) { bump(report.skipped, 'relationship over a field that is not exported'); continue; }
    const key = `${lt.table.id}.${lc.field.id}>${rt.table.id}.${rc.field.id}`;
    const flip = `${rt.table.id}.${rc.field.id}>${lt.table.id}.${lc.field.id}`;
    if (seen.has(key) || seen.has(flip)) continue;
    seen.add(key);
    // The parent is the side whose field is unique; with both unique, the right side (where FileMaker's "many" usually is) points at the left.
    const [child, cc, parent, pc] = lc.unique && !rc.unique ? [rt, rc, lt, lc] : rc.unique && !lc.unique ? [lt, lc, rt, rc] : lc.unique && rc.unique ? [rt, rc, lt, lc] : [undefined, undefined, undefined, undefined];
    if (!child || !cc || !parent || !pc) { idx(lt, lc); idx(rt, rc); continue; }
    const compatible = cc.kind === pc.kind && !cc.repeating && !pc.repeating && !cc.container && !pc.container && cc.unfit === 0 && pc.unfit === 0;
    if (!compatible) { leaveOut('foreign key (field types differ)'); idx(child, cc); continue; }
    const orphans = Number(store.select(
      `SELECT COUNT(*) FROM (SELECT ${q(cc.field.name)} AS v FROM (${child.base})) c WHERE c.v IS NOT NULL AND NOT EXISTS (SELECT 1 FROM (${parent.base}) p WHERE p.${q(pc.field.name)} = c.v)`, [], 1).rows[0][0]);
    if (orphans > 0) { leaveOut('foreign key (the data has values with no match)'); idx(child, cc); continue; }
    child.foreign.push({ column: cc.column, parent, parentColumn: pc.column, name: names.take(`${child.table.name}_${cc.field.name}_fkey`, true) });
    idx(child, cc);
  }

  // --- the script ----------------------------------------------------------------
  const out = (s: string) => sink.write(s);
  out(`-- Written by tabularius export-sql (${dialect}). Records, fields, value lists, relationships and container files only:\n`);
  out('-- scripts, layouts, privilege sets and accounts are not carried. Values are those stored in the file.\n');
  out(dialect === 'postgres' ? 'BEGIN;\n\n' : 'PRAGMA foreign_keys = OFF;\nBEGIN;\n\n');

  for (const t of tabs) for (const c of t.cols) if (c.seq) {
    out(`CREATE SEQUENCE ${q(c.seq.name)} START WITH ${c.seq.start} INCREMENT BY ${c.seq.increment};\n`);
    report.sequences++;
  }
  for (const t of tabs) {
    report.tables++;
    report.primaryKeys++;
    const lines = [dialect === 'postgres' ? `  ${q(t.idColumn)} BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY` : `  ${q(t.idColumn)} INTEGER PRIMARY KEY`];
    for (const c of t.cols) {
      report.fields++;
      let line = `  ${q(c.column)} ${c.sqlType}`;
      if (c.notNull) { line += ' NOT NULL'; report.notNullConstraints++; }
      if (c.unique) { line += ' UNIQUE'; report.uniqueConstraints++; }
      if (c.seq) line += ` DEFAULT nextval(${str(q(c.seq.name))})`;
      lines.push(line);
    }
    if (dialect === 'sqlite') {
      for (const f of t.foreign) { lines.push(`  FOREIGN KEY (${q(f.column)}) REFERENCES ${q(f.parent.name)} (${q(f.parentColumn)})`); report.foreignKeys++; }
    }
    out(`CREATE TABLE ${q(t.name)} (\n${lines.join(',\n')}\n);\n`);
    for (const c of t.cols) {
      if (c.field.kind === 'calculation' && c.field.calculation) {
        if (dialect === 'postgres') out(`COMMENT ON COLUMN ${q(t.name)}.${q(c.column)} IS ${str(`Calculation, exported as the value stored in the file: ${comment(c.field.calculation)}`)};\n`);
        else out(`-- ${q(t.name)}.${q(c.column)} is a calculation, exported as the value stored in the file: ${comment(c.field.calculation)}\n`);
      }
      if (c.seq === undefined && c.field.options?.autoEnter?.serial) {
        const next = store.calc.peekSerial(t.table, c.field);
        out(`-- ${q(t.name)}.${q(c.column)} is a serial number; the next value in the file is ${comment(next ?? '')}\n`);
      }
    }
    out('\n');
  }

  // Records.
  const filesFolder = opts.filesFolder ?? 'files';
  const safe = sanitize;
  const folders = new Set<string>();
  for (const t of tabs) {
    if (!t.cols.length && !t.rows) continue;
    const baseFolder = safe(t.table.name);
    let tableFolder = baseFolder;
    for (let n = 2; folders.has(tableFolder.toLowerCase()); n++) tableFolder = `${baseFolder}-${n}`;
    folders.add(tableFolder.toLowerCase());
    const insert = `INSERT INTO ${q(t.name)} (${[q(t.idColumn), ...t.cols.map((c) => q(c.column))].join(', ')}) VALUES\n`;
    let pending: string[] = [];
    const flush = () => {
      if (pending.length) out(`${insert}${pending.join(',\n')};\n`);
      pending = [];
    };
    for (let last = 0; ;) {
      const rows = page(t, last);
      if (!rows.length) break;
      for (const row of rows) {
        last = Number(row[0]);
        const cells = t.cols.map((c, i) => {
          const raw = row[i + 1];
          if (c.container) {
            if (raw === null || raw === undefined || raw === '') return 'NULL';
            const file = store.container(Number(raw));
            if (!file) { report.unfittingValues++; return 'NULL'; }
            const path = `${filesFolder}/${tableFolder}/${last}-${c.field.id}-${safe(file.filename ?? 'container')}`;
            sink.file(path, file.data);
            report.containerFiles++;
            return str(path);
          }
          const cell = cellOf(c, raw);
          report.unfittingValues += cell.unfit;
          report.nulCharactersDropped += cell.nul;
          return cell.items ? renderRepeating(c.kind, cell.items, dialect) : render(c.kind, cell.one ?? null, dialect);
        });
        pending.push(`  (${[String(last), ...cells].join(', ')})`);
        report.rows++;
        if (pending.length >= batch) flush();
      }
    }
    flush();
    if (dialect === 'postgres' && t.rows) out(`SELECT setval(pg_get_serial_sequence(${str(q(t.name))}, ${str(t.idColumn)}), ${t.maxId});\n`);
    out('\n');
  }

  // Value lists the file holds as typed-in values.
  for (const list of schema.valueLists) {
    if (!list.values) { bump(report.skipped, 'value list drawn from a field or another file'); continue; }
    if (pv && pv.valueList(list.name) === 'none') { bump(report.skipped, 'value list the account may not use'); continue; }
    const name = names.take(`value_list_${list.name}`);
    const items = [...new Set(list.values.map((v) => {
      report.nulCharactersDropped += Number(v.includes('\u0000'));
      return v.replace(/\u0000/g, '');
    }))].filter((v) => v !== '');
    out(`CREATE TABLE ${q(name)} (\n  "value" TEXT NOT NULL PRIMARY KEY,\n  "position" INTEGER NOT NULL\n);\n`);
    for (let i = 0; i < items.length; i += batch) {
      out(`INSERT INTO ${q(name)} ("value", "position") VALUES\n${items.slice(i, i + batch).map((v, j) => `  (${str(v)}, ${i + j + 1})`).join(',\n')};\n`);
    }
    out('\n');
    report.valueLists++;
  }

  // Keys and indexes that need the data in place.
  for (const t of tabs) {
    if (dialect === 'postgres') {
      for (const f of t.foreign) {
        out(`ALTER TABLE ${q(t.name)} ADD CONSTRAINT ${q(f.name)} FOREIGN KEY (${q(f.column)}) REFERENCES ${q(f.parent.name)} (${q(f.parentColumn)});\n`);
        report.foreignKeys++;
      }
    }
    for (const i of t.indexes) {
      out(`CREATE INDEX ${q(i.name)} ON ${q(t.name)} (${q(i.column)});\n`);
      report.indexes++;
    }
  }
  out('\nCOMMIT;\n');
  report.renamed += names.renamed;
  return report;
}

/** The report as lines of counts for a terminal. */
export function exportSqlSummary(r: ExportSqlReport): string[] {
  const lines = [
    `${r.dialect}: ${r.tables} table${r.tables === 1 ? '' : 's'}, ${r.fields} field${r.fields === 1 ? '' : 's'}, ${r.rows} row${r.rows === 1 ? '' : 's'}, ${r.valueLists} value list${r.valueLists === 1 ? '' : 's'}, ${r.containerFiles} container file${r.containerFiles === 1 ? '' : 's'}`,
    `keys and constraints: ${r.primaryKeys} primary, ${r.uniqueConstraints} unique, ${r.notNullConstraints} not null, ${r.foreignKeys} foreign, ${r.indexes} indexes, ${r.sequences} sequences`,
  ];
  if (r.renamed) lines.push(`${r.renamed} name${r.renamed === 1 ? '' : 's'} changed to stay distinct or fit the target`);
  if (r.unfittingValues) lines.push(`${r.unfittingValues} value${r.unfittingValues === 1 ? '' : 's'} left empty because the text did not fit its column's type`);
  if (r.nulCharactersDropped) lines.push(`${r.nulCharactersDropped} value${r.nulCharactersDropped === 1 ? '' : 's'} had a NUL character removed`);
  for (const [why, n] of Object.entries(r.constraintsLeftOut)) lines.push(`left out (${n}): ${why}`);
  for (const [why, n] of Object.entries(r.skipped)) lines.push(`not carried (${n}): ${why}`);
  return lines;
}
