// Convert an fmp12 file into a Tabularius store (SQLite): one SQL table per
// FileMaker base table, plus metadata tables the server needs.

import { DatabaseSync } from 'node:sqlite';
import { ensureCacheVersions } from './cache-versions.ts';
import { basename } from 'node:path';
import { closeSync, existsSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FmpDatabase, containerBlobs, containerRefId, readImageLibrary, readLayoutDesigns, type FieldType, type LayoutDesigns, type Schema } from '../../fmp12/src/index.ts';
import { applyOp, emptySchema, type DesignOp } from './design.ts';
import { ensurePrivilegeTables } from './privileges.ts';
import { StoreFormatError, refuseNewer } from './store-format.ts';

// Numbers are REAL, not NUMERIC: NUMERIC turns whole numbers into 64-bit
// integers, and node:sqlite refuses to read one past 2^53 (long ids do that).
export const SQL_TYPES: Record<FieldType, string> = {
  text: 'TEXT', number: 'REAL', date: 'TEXT', time: 'TEXT', timestamp: 'TEXT', container: 'INTEGER', unknown: 'TEXT',
  boolean: 'BOOLEAN', integer: 'BIGINT', decimal: 'DECIMAL_TEXT', json: 'JSON_TEXT', uuid: 'UUID_TEXT',
};

export const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export interface ImportStat {
  table: string;
  records: number;
}

/** How far a conversion has got: tables finished of all, and records copied so far. */
export interface ImportProgress {
  table: string;
  tablesDone: number;
  tables: number;
  records: number;
  /** How far through the .fmp12 reading has got, from 0 to 1. */
  fraction?: number;
}

export interface LayoutTarget {
  name: string;
  id: number;
  occurrence: string;
  /** Base table in this file; null when the table lives in another file. */
  table: string | null;
  /** For a table in another file: that file's name (as FileMaker's data source names it) and its table id. */
  file?: string;
  fileTableId?: number;
}

/** File name a FileMaker data source points at ("file:Sales_Data" -> "Sales_Data"). */
export function dataSourceFile(paths: string[]): string | undefined {
  for (const p of paths) {
    const m = /^(?:file|filemac|filewin|fmnet):(?:.*\/)?([^/]+?)(?:\.fmp12)?$/i.exec(p.trim());
    if (m) return m[1];
  }
  return undefined;
}

/** Layouts a client can open: each maps to the base table behind its table occurrence. */
export function layoutTargets(schema: Schema): LayoutTarget[] {
  const out: LayoutTarget[] = [];
  const seen = new Set<string>();
  const occurrences = new Map(schema.tableOccurrences.map((to) => [to.id, to]));
  const tables = new Map(schema.tables.map((table) => [table.id, table]));
  const sources = new Map(schema.dataSources.map((source) => [source.id, source]));
  for (const l of schema.layouts) {
    const to = occurrences.get(l.tableOccurrenceId ?? -1);
    if (!to || seen.has(l.name)) continue;
    if (to.dataSourceId) {
      const file = dataSourceFile(sources.get(to.dataSourceId ?? -1)?.paths ?? []);
      if (!file || to.baseTableId === undefined) continue;
      seen.add(l.name);
      out.push({ name: l.name, id: l.id, occurrence: to.name, table: null, file, fileTableId: to.baseTableId });
      continue;
    }
    const table = tables.get(to.baseTableId ?? -1);
    if (!table) continue;
    seen.add(l.name);
    out.push({ name: l.name, id: l.id, table: table.name, occurrence: to.name });
  }
  return out;
}

/** Bumped when the layout designs or schema a store keeps change shape; older stores are refreshed on open. */
export const DESIGN_VERSION = 48; // 6: relationship create and delete options; 7: GetSummary in formulas; 8: field data formats; 9: sub-summary break fields; 10: privilege set details; 11: portal sort and filter from files; 12: scripts run with full access; 13: Import Records sources and field mapping; 14: layout default view; 15: italic, underline and strikethrough; 16: button bar segment labels; 17: Truncate Table base tables, Insert File and FileMaker import sources; 18: button icon positions; 19: script triggers; 20: Export Records and data file step options; 21: value lists from other files; 22: script trigger modes; 23: button bar active segments; 24: Save Records as PDF options; 25: tab heights; 26: line spacing in lines; 27: charts; 28: custom menu items and menu sets; 29: file options (open and close scripts, open layout); 30: prohibit modification and strict data type; 31: Install Menu Set options; 32: web viewer addresses; 33: tab order and layout menu sets; 34: chart value axis bounds; 35: page setup and part options; 36: looked-up values and existing-value validation; 37: field behavior, drop-down lists and pop-up menus the right way round, portal setup options; 38: hide in Find mode, hide when printing, slide control dots; 39: popover titles; 40: slide control swipe; 41: Manage Containers base directories; 42: layouts and scripts left out of menus; 43: web viewer options, concealed edit boxes, scroll bars and Return/Enter keys; 44: container formats; 45: window step options, Enable Account the right way round, xor; 46: accounts switched off in FileMaker; 47: undecoded data-changing script option diagnostics; 48: privilege sets and accounts read failing closed

/** Design changes made in Tabularius (design mode), replayed when the design is re-read from the .fmp12. */
export const DESIGN_LOG = '_fm_design_log';

/** An externally stored file's size when it was stored (stores made before it was kept have no such column). */
export function addExternalSizeColumn(sql: DatabaseSync): void {
  if (!(sql.prepare('PRAGMA table_info(_fm_containers)').all() as { name: string }[]).some((c) => c.name === 'external_size')) {
    sql.exec('ALTER TABLE _fm_containers ADD COLUMN external_size INTEGER');
  }
}

function ensureDesignLog(sql: DatabaseSync): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS ${DESIGN_LOG} (seq INTEGER PRIMARY KEY, at TEXT NOT NULL, account TEXT, op TEXT NOT NULL)`);
}

/** Save a design: the schema, layout designs, and the layout list derived from them. */
export function writeDesign(sql: DatabaseSync, schema: Schema, designs: LayoutDesigns): void {
  ensureCacheVersions(sql);
  const put = sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json');
  put.run('schema', JSON.stringify(schema));
  put.run('designs', JSON.stringify(designs));
  sql.exec('DELETE FROM _fm_layouts');
  const addLayout = sql.prepare('INSERT INTO _fm_layouts VALUES (?, ?, ?, ?, ?, ?)');
  for (const l of layoutTargets(schema)) addLayout.run(l.name, l.id, l.table, l.occurrence, l.file ?? null, l.fileTableId ?? null);
}

/**
 * Layout designs, themes and the image library: what a client needs to draw
 * the solution's layouts. Re-run on an existing store to refresh them (the
 * schema and layout list are refreshed too; records are not touched). Design
 * changes made since the import are applied again on top.
 */
export function importDesigns(sql: DatabaseSync, db: FmpDatabase, log: (msg: string) => void = () => {}): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS _fm_images (id INTEGER PRIMARY KEY, filename TEXT, mime TEXT NOT NULL, data BLOB NOT NULL)`);
  ensureDesignLog(sql);
  const state = { schema: db.schema, designs: readLayoutDesigns(db.file, db.schema) };
  const ops = (sql.prepare(`SELECT seq, op FROM ${DESIGN_LOG} ORDER BY seq`).all() as { seq: number; op: string }[]);
  for (const row of ops) {
    try {
      const op = JSON.parse(row.op) as DesignOp;
      // Only persisted design history can replay a restore after its trash entry is gone.
      // Live design requests must resolve the deletion from the store, never from op.patch.
      const recorded = op.op === 'restoreDeleted' && op.patch ? { patch: op.patch } : undefined;
      applyOp(state, op, recorded ? () => recorded : undefined);
    } catch (e) {
      log(`design change ${row.seq} could not be applied again: ${(e as Error).message}`);
    }
  }
  sql.exec('BEGIN');
  writeDesign(sql, state.schema, state.designs);
  const off = applyFileAccountStatus(sql);
  if (off.length) log(`turned off ${off.length} account${off.length === 1 ? '' : 's'} that the FileMaker file has switched off: ${off.join(', ')}`);
  sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run('designVersion', JSON.stringify(DESIGN_VERSION));
  sql.exec('DELETE FROM _fm_images');
  const addImage = sql.prepare('INSERT INTO _fm_images VALUES (?, ?, ?, ?)');
  for (const [id, img] of readImageLibrary(db.file)) addImage.run(id, img.filename ?? null, img.mime, img.data);
  sql.exec('COMMIT');
}

/** Set once a store's accounts carry the file's Active/Inactive status (see applyFileAccountStatus). */
export const ACCOUNT_STATUS_META = 'accountStatus';

/**
 * Switches off the accounts the .fmp12 has switched off (Manage Security's
 * Active box), once per store. Before this, every imported account came across
 * switched on, so an account disabled in FileMaker could sign in here, or match
 * an external group. It runs once, when the store is made or first refreshed
 * by this version: after that, Enable Account and Manage Security here decide,
 * so an account turned back on here stays on. It only ever turns accounts off,
 * and only ones that came from the file.
 */
export function applyFileAccountStatus(sql: DatabaseSync): string[] {
  if (sql.prepare('SELECT 1 FROM _fm_meta WHERE key = ?').get(ACCOUNT_STATUS_META)) return [];
  ensurePrivilegeTables(sql);
  const row = sql.prepare(`SELECT json FROM _fm_meta WHERE key = 'schema'`).get() as { json: string } | undefined;
  const schema = row ? JSON.parse(row.json) as Schema : undefined;
  const off = sql.prepare(`UPDATE _fm_accounts SET inactive = 1 WHERE name = ? COLLATE NOCASE AND source IN ('fmp12', 'external') AND inactive = 0`);
  const changed: string[] = [];
  for (const a of schema?.accounts ?? []) if (a.inactive && Number(off.run(a.name).changes)) changed.push(a.name);
  sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(ACCOUNT_STATUS_META, JSON.stringify({ switchedOff: changed }));
  return changed;
}

const STORE_TABLES = `
    CREATE TABLE _fm_meta (key TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE _fm_layouts (name TEXT PRIMARY KEY, layout_id INTEGER, table_name TEXT, occurrence TEXT, file TEXT, file_table_id INTEGER);
    CREATE TABLE _fm_accounts (name TEXT PRIMARY KEY, password_hash TEXT, source TEXT NOT NULL);
    -- Container field contents; container columns hold an id from here.
    CREATE TABLE _fm_containers (id INTEGER PRIMARY KEY, filename TEXT, mime TEXT NOT NULL, kind TEXT, data BLOB NOT NULL, external TEXT, external_size INTEGER);
  `;

/** A new, empty solution: no FileMaker file needed. Build it with design mode. */
export function createStore(outPath: string, options: { mode?: 'native' | 'compat' } = {}): void {
  const sql = new DatabaseSync(outPath);
  try {
    sql.exec('PRAGMA journal_mode = WAL');
    sql.exec(STORE_TABLES);
    sql.exec(`CREATE TABLE IF NOT EXISTS _fm_images (id INTEGER PRIMARY KEY, filename TEXT, mime TEXT NOT NULL, data BLOB NOT NULL)`);
    ensureDesignLog(sql);
    const meta = sql.prepare('INSERT INTO _fm_meta VALUES (?, ?)');
    meta.run('source', JSON.stringify({ file: null, createdAt: new Date().toISOString() }));
    if (options.mode) meta.run('fileMode', JSON.stringify(options.mode));
    meta.run('aiPolicy', 'true');
    meta.run('dateOrder', JSON.stringify(options.mode === 'native' ? 'ISO' : 'MDY'));
    meta.run('designVersion', JSON.stringify(DESIGN_VERSION));
    meta.run('repeating', JSON.stringify({}));
    const schema = emptySchema();
    writeDesign(sql, schema, { layouts: [], themes: [] });
    // The default account must have mutable status, just like imported accounts.
    // No password is provisioned: this does not enable password authentication.
    const account = sql.prepare('INSERT INTO _fm_accounts VALUES (?, NULL, ?)');
    for (const a of schema.accounts) account.run(a.name, a.external ? 'external' : 'openhbam');
  } finally {
    sql.close();
  }
}

/** Whether a store predates the current layout designs. A store from a newer Tabularius never does: it is not written to. */
export function needsDesigns(storePath: string): boolean {
  const sql = new DatabaseSync(storePath, { readOnly: true });
  try {
    try { refuseNewer(sql, storePath); } catch (e) { if (e instanceof StoreFormatError) return false; throw e; }
    const row = sql.prepare(`SELECT json FROM _fm_meta WHERE key = 'designVersion'`).get() as { json: string } | undefined;
    return !row || JSON.parse(row.json) < DESIGN_VERSION;
  } finally {
    sql.close();
  }
}

/** Refreshes an existing store's designs from its source file. */
export function upgradeDesigns(storePath: string, fmp12Path: string, log?: (msg: string) => void): void {
  const sql = new DatabaseSync(storePath);
  let db: FmpDatabase | undefined;
  try {
    refuseNewer(sql, storePath);
    db = FmpDatabase.open(fmp12Path);
    importDesigns(sql, db, log);
  } finally {
    sql.close();
    db?.close();
  }
}

/**
 * The converter's version, stamped on each store it makes. Raise it when a fix
 * changes what a conversion produces, so stores made before can be found and
 * converted again (see reconvert.ts).
 *   1  before stamping
 *   2  container references read as path integers (blob ids past 127), and
 *      externally stored containers
 */
export const CONVERTER_VERSION = 2;

/** Rows or container bytes copied between commits: what an interrupted conversion can lose, and what it keeps. */
const COMMIT_ROWS = 5000;
const COMMIT_BYTES = 64 * 1024 * 1024;

/** Where a conversion stopped, kept in the store until it finishes (so it can pick up from there). */
interface ImportState {
  source: { size: number; mtimeMs: number; blockCount: number };
  stats: ImportStat[];
  repeating: Record<string, string[]>;
  /** The table being copied: its records after `after`, then its container files after `after`. */
  current?: { table: string; phase: 'records' | 'containers'; after: number; base: number; records: number };
}
const STATE = '_fm_import';

function readState(sql: DatabaseSync): ImportState | undefined {
  try {
    const row = sql.prepare(`SELECT json FROM ${STATE} WHERE key = 'state'`).get() as { json: string } | undefined;
    return row ? JSON.parse(row.json) as ImportState : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A file's SHA-256, read in pieces. Stored with a conversion, so converting
 * again can tell the same .fmp12 (copied to another machine, with a new
 * modification time) from one changed since.
 */
export function fileSha256(path: string): string {
  const hash = createHash('sha256');
  const buf = Buffer.alloc(8 << 20);
  const fd = openSync(path, 'r');
  try {
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Converts an .fmp12 into a store at `outPath`. Memory stays bounded whatever
 * the file's size: records and container files are streamed from the file
 * and committed in batches. With `resume`, a store left by an interrupted
 * conversion of the same file carries on where it stopped; anything else at
 * `outPath` is replaced.
 */
export function importFmp12(src: string | FmpDatabase, outPath: string, onProgress?: (p: ImportProgress) => void, opts: { resume?: boolean; passphrase?: string } = {}): ImportStat[] {
  const db = typeof src === 'string' ? FmpDatabase.open(src, opts.passphrase) : src;
  const fileInfo = typeof src === 'string' ? statSync(src) : undefined;
  const source = { size: fileInfo?.size ?? db.file.source.size, mtimeMs: Math.trunc(fileInfo?.mtimeMs ?? 0), blockCount: db.file.blockCount };
  let sql = new DatabaseSync(outPath);
  let state = opts.resume ? readState(sql) : undefined;
  if (state && JSON.stringify(state.source) !== JSON.stringify(source)) state = undefined;
  if (!state && existsSync(outPath) && statSync(outPath).size > 0) {
    // Not a conversion of this file to pick up: start again from nothing.
    sql.close();
    for (const f of [outPath, outPath + '-wal', outPath + '-shm', outPath + '-journal']) rmSync(f, { force: true });
    sql = new DatabaseSync(outPath);
  }
  const tables = db.schema.tables;
  const progress = (table: string, records: number, extra: Partial<ImportProgress> = {}) =>
    onProgress?.({ table, tablesDone: state!.stats.length, tables: tables.length, records, fraction: db.file.readFraction(), ...extra });
  const save = () => sql.prepare(`INSERT INTO ${STATE} VALUES ('state', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(state));

  try {
    sql.exec('PRAGMA journal_mode = WAL');
    if (!state) {
      state = { source, stats: [], repeating: {} };
      sql.exec('BEGIN');
      sql.exec(STORE_TABLES);
      sql.exec(`CREATE TABLE ${STATE} (key TEXT PRIMARY KEY, json TEXT NOT NULL)`);
      const meta = sql.prepare('INSERT INTO _fm_meta VALUES (?, ?)');
      meta.run('source', JSON.stringify({
        file: typeof src === 'string' ? basename(src) : null,
        importedAt: new Date().toISOString(),
        header: db.file.header,
        ...(typeof src === 'string' ? { size: fileInfo!.size, sha256: fileSha256(src) } : {}),
      }));
      meta.run('dateOrder', JSON.stringify(db.dateStyle));
      // FileMaker password verifiers can't be checked yet, so imported accounts
      // start without a password; set one with `tabularius passwd`.
      const addAccount = sql.prepare('INSERT OR IGNORE INTO _fm_accounts VALUES (?, NULL, ?)');
      for (const a of db.schema.accounts) addAccount.run(a.name, a.external ? 'external' : 'fmp12');
      sql.exec('COMMIT');
      importDesigns(sql, db);
      // Only now can a later run pick up from here.
      save();
    } else if (!sql.prepare('SELECT 1 FROM _fm_meta WHERE key = ?').get(ACCOUNT_STATUS_META)) {
      // A store started by an older version, being resumed: re-read the design so
      // accounts switched off in the file are off before the store is hosted.
      importDesigns(sql, db);
    }
    // A store started by an older version, being resumed: externally stored files need their column.
    if (!(sql.prepare('PRAGMA table_info(_fm_containers)').all() as { name: string }[]).some((c) => c.name === 'external')) {
      sql.exec('ALTER TABLE _fm_containers ADD COLUMN external TEXT');
    }
    addExternalSizeColumn(sql);
    const addContainer = sql.prepare('INSERT INTO _fm_containers (id, filename, mime, kind, data, external, external_size) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let total = state.stats.reduce((n, x) => n + x.records, 0);
    const completedTables = new Set(state.stats.map((x) => x.table));

    for (const t of tables) {
      if (completedTables.has(t.name)) continue;
      // Summary fields are computed over found sets, so they are not stored.
      const fields = t.fields.filter((f) => f.kind !== 'summary');
      const containers = fields.filter((f) => f.type === 'container');
      if (state.current?.table !== t.name) {
        const cols = fields.map((f) => `${q(f.name)} ${SQL_TYPES[f.type]}`);
        sql.exec('BEGIN');
        sql.exec(`DROP TABLE IF EXISTS ${q(t.name)}`);
        sql.exec(`CREATE TABLE ${q(t.name)} (_fm_record_id INTEGER PRIMARY KEY, _fm_mod_id INTEGER NOT NULL DEFAULT 0${cols.map((c) => ', ' + c).join('')})`);
        // Container rows for this table get ids base + blob id, so records can point at them before they are copied.
        const max = (sql.prepare('SELECT coalesce(max(id), 0) AS n FROM _fm_containers').get() as { n: number }).n;
        state.current = { table: t.name, phase: 'records', after: 0, base: max, records: 0 };
        save();
        sql.exec('COMMIT');
      }
      const cur = state.current!;
      const repeating = (state.repeating[t.name] ??= []);
      const repeatingSet = new Set(repeating);

      if (cur.phase === 'records') {
        progress(t.name, total + cur.records);
        const insert = sql.prepare(
          `INSERT INTO ${q(t.name)} (_fm_record_id${fields.map((f) => ', ' + q(f.name)).join('')}) VALUES (?${', ?'.repeat(fields.length)})`,
        );
        const containerId = (ref: unknown): number | null => {
          const blobId = typeof ref === 'string' ? containerRefId(ref) : undefined;
          return blobId === undefined ? null : cur.base + blobId;
        };
        let batch = 0;
        sql.exec('BEGIN');
        for (const r of db.records(t.id)) {
          if (r.recordId <= cur.after) continue;
          const vals = fields.map((f) => {
            let v: unknown = r.fields[f.name];
            if (v === undefined) return null;
            if (f.type === 'container') v = Array.isArray(v) ? v.map(containerId) : containerId(v);
            if (!Array.isArray(v)) return v as string | number | null;
            // Repeating fields: keep every repetition, as a JSON array.
            if (!repeatingSet.has(f.name)) { repeatingSet.add(f.name); repeating.push(f.name); }
            return JSON.stringify(v);
          });
          insert.run(r.recordId, ...vals);
          cur.records++;
          cur.after = r.recordId;
          if (onProgress && cur.records % 100 === 0) progress(t.name, total + cur.records);
          if (++batch >= COMMIT_ROWS) {
            save();
            sql.exec('COMMIT; BEGIN');
            batch = 0;
            progress(t.name, total + cur.records);
          }
        }
        cur.phase = 'containers';
        cur.after = 0;
        save();
        sql.exec('COMMIT');
        progress(t.name, total + cur.records);
      }

      if (containers.length) {
        let bytes = 0;
        sql.exec('BEGIN');
        for (const b of containerBlobs(db.file, t.id, cur.after)) {
          addContainer.run(cur.base + b.id, b.filename ?? null, b.mime, b.kind ?? null, b.data, b.external ?? null, b.external ? b.externalSize ?? null : null);
          cur.after = b.id;
          bytes += b.data.length;
          if (bytes >= COMMIT_BYTES) {
            save();
            sql.exec('COMMIT; BEGIN');
            bytes = 0;
            progress(t.name, total + cur.records);
          }
        }
        // Keep only files a record points at (as before), and clear pointers to files the .fmp12 doesn't have.
        const used = containers.map((f) => repeatingSet.has(f.name)
          ? `SELECT j.value FROM ${q(t.name)} AS r, json_each(r.${q(f.name)}) AS j WHERE json_valid(r.${q(f.name)}) AND j.value IS NOT NULL`
          : `SELECT ${q(f.name)} FROM ${q(t.name)} WHERE ${q(f.name)} IS NOT NULL`).join(' UNION ');
        sql.exec(`DELETE FROM _fm_containers WHERE id > ${cur.base} AND id NOT IN (${used})`);
        for (const f of containers) {
          if (!repeatingSet.has(f.name)) sql.exec(`UPDATE ${q(t.name)} SET ${q(f.name)} = NULL WHERE ${q(f.name)} IS NOT NULL AND ${q(f.name)} NOT IN (SELECT id FROM _fm_containers)`);
        }
        save();
        sql.exec('COMMIT');
      }

      sql.exec('BEGIN');
      state.stats.push({ table: t.name, records: cur.records });
      completedTables.add(t.name);
      total += cur.records;
      if (!repeating.length) delete state.repeating[t.name];
      state.current = undefined;
      save();
      sql.exec('COMMIT');
      progress(t.name, total);
    }
    sql.exec('BEGIN');
    sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run('repeating', JSON.stringify(state.repeating));
    sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run('converterVersion', JSON.stringify(CONVERTER_VERSION));
    sql.exec(`DROP TABLE ${STATE}`);
    sql.exec('COMMIT');
    return state.stats;
  } finally {
    sql.close();
    if (typeof src === 'string') db.close();
  }
}
