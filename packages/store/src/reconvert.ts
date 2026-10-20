// Converting a hosted file again from its .fmp12, keeping what people changed
// since it was first converted. For stores made by an older converter (see
// CONVERTER_VERSION) that a fix changes the result of, such as container
// references to blobs past 127.
//
// A fresh conversion is made next to the store, then what happened since the
// first conversion is carried into it:
//   - records created since (not in the .fmp12) are copied whole;
//   - records deleted since are deleted;
//   - records edited since keep the fields their audit log says were changed
//     (all fields when the log has nothing for them);
//   - accounts, passwords, privilege sets, tokens, two-factor secrets, the
//     audit log and other settings are copied whole.
// Container files those records point at are copied with them. The store as it
// was is kept beside it (<store>.before-reconvert-<time>), so nothing is lost
// if something didn't come across.
//
// A dry run (preview) does all of that in a scratch folder and reports what
// would change, file by file: values the fixed converter reads differently,
// container files, records, accounts kept, edits carried over. Nothing in the
// hosted folder is touched.
//
// It refuses, unless forced, when carrying edits over isn't safe: the file's
// design was changed in Tabularius since (records may not fit the fresh
// design), or the .fmp12 changed since the first conversion (record ids may
// not mean the same records).

import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCOUNT_STATUS_META, CONVERTER_VERSION, DESIGN_LOG, applyFileAccountStatus, fileSha256, importFmp12, q, type ImportProgress, type ImportStat } from './import.ts';
import { refuseNewer } from './store-format.ts';

/** Tables a fresh conversion makes, or that are rebuilt on their own: never copied from the old store. */
const REGENERATED = new Set(['_fm_meta', '_fm_layouts', '_fm_containers', '_fm_container_chunks', '_fm_images', '_fm_import', DESIGN_LOG]);
const WORD_INDEX = '_fm_words_';
/** Why a native file is never converted again: its design and dates are its own, not a .fmp12's. */
export const NATIVE_REFUSAL = "a native file (made with tabularius new --native) has no .fmp12 source, so it can't be converted again";
/** Settings import writes; the old store's other settings (a password policy, ...) come across. */
const FRESH_META = new Set(['source', 'dateOrder', 'designVersion', 'repeating', 'converterVersion', 'schema', 'designs']);

export interface ReconvertCheck {
  /** The converter version that made the store (1 when it wasn't stamped). */
  version: number;
  current: number;
  /** Made by an older converter. */
  outdated: boolean;
  /** Why carrying edits over isn't safe, if it isn't. */
  unsafe?: string;
  /** A native file (tabularius new --native): made in Tabularius, with no .fmp12 to convert from. */
  native?: true;
  /**
   * Converted before conversions recorded the .fmp12's checksum, and the
   * .fmp12 is newer than the conversion (as a copy is): whether it changed
   * can't be told. Saying it is the same file (sameFile) carries edits over.
   */
  unverified?: boolean;
}

/** Checksums already worked out, by path, size and modification time, so a big file is read once. */
const sums = new Map<string, string>();
function sha256Of(path: string): string {
  const st = statSync(path);
  const key = `${path}\u0000${st.size}\u0000${st.mtimeMs}`;
  let sum = sums.get(key);
  if (!sum) sums.set(key, (sum = fileSha256(path)));
  return sum;
}

export interface ReconvertResult {
  stats: { tables: number; records: number };
  /** The store as it was. */
  backup: string;
  created: number;
  edited: number;
  deleted: number;
  /** A dry run's findings (nothing was changed). */
  preview?: ReconvertPreview;
}

/** What converting again would change, worked out in a scratch folder. */
export interface ReconvertPreview {
  /** Accounts before, and after (always the same: one would be lost, it refuses). */
  accounts: { before: number; after: number };
  /** Edits made since the first conversion: carried over, or dropped by a forced convert. */
  editsCarried: boolean;
  /** Design changes made in Tabularius that a forced convert drops. */
  designChangesLost: number;
  /** Container files stored in the file. */
  containers: { before: number; after: number };
  /** Per table: records before and after, and records whose values the fixed converter reads differently. */
  tables: { table: string; before: number; after: number; changed: number }[];
}

function meta(sql: DatabaseSync, key: string): unknown {
  const row = sql.prepare('SELECT json FROM _fm_meta WHERE key = ?').get(key) as { json: string } | undefined;
  return row ? JSON.parse(row.json) : undefined;
}

function tableExists(sql: DatabaseSync, name: string, schema = 'main'): boolean {
  return !!sql.prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

function columns(sql: DatabaseSync, table: string, schema = 'main'): string[] {
  return (sql.prepare(`PRAGMA ${schema}.table_info(${q(table)})`).all() as { name: string }[]).map((c) => c.name);
}

/** Whether a store needs converting again, and whether its edits can be carried over. */
export function reconvertCheck(storePath: string, fmp12Path: string, opts: { sameFile?: boolean } = {}): ReconvertCheck {
  const sql = new DatabaseSync(storePath, { readOnly: true });
  try {
    // A store from a newer Tabularius is not converted again here: this build's importer would rebuild it with the
    // older layout and keep its newer format number.
    refuseNewer(sql, storePath);
    const version = Number(meta(sql, 'converterVersion') ?? 1);
    if (meta(sql, 'fileMode') === 'native') return { version, current: CONVERTER_VERSION, outdated: false, native: true };
    const out: ReconvertCheck = { version, current: CONVERTER_VERSION, outdated: version < CONVERTER_VERSION };
    const designChanges = tableExists(sql, DESIGN_LOG) ? (sql.prepare(`SELECT count(*) AS n FROM ${DESIGN_LOG}`).get() as { n: number }).n : 0;
    const source = meta(sql, 'source') as { importedAt?: string; size?: number; sha256?: string } | undefined;
    const importedAt = Date.parse(String(source?.importedAt ?? ''));
    if (!existsSync(fmp12Path)) out.unsafe = `${fmp12Path} isn't there to convert from`;
    else if (designChanges) out.unsafe = `the design was changed in Tabularius since it was converted (${designChanges} change${designChanges === 1 ? '' : 's'})`;
    else if (source?.sha256) {
      // By content: a copy (new modification time) is the same file; an edit in FileMaker is not.
      const st = statSync(fmp12Path);
      const changed = st.size !== source.size || (st.mtimeMs > importedAt && sha256Of(fmp12Path) !== source.sha256);
      if (changed) out.unsafe = 'the .fmp12 changed since it was converted, so its records may not match';
    } else if (importedAt && statSync(fmp12Path).mtimeMs > importedAt && !opts.sameFile) {
      out.unsafe = "the .fmp12 is newer than the conversion, and this conversion is too old to tell a copy from a changed file; if it is the same file (copied), say so to keep edits";
      out.unverified = true;
    }
    return out;
  } finally {
    sql.close();
  }
}

/**
 * Converts the store at `storePath` again from `fmp12Path`, carrying over what
 * changed since. The store must not be open elsewhere. `convert` makes the
 * fresh conversion (the host runs it on a worker thread); `passphrase` opens a
 * .fmp12 that uses Encryption at Rest, for this conversion only. With `force`, an
 * unsafe store is converted afresh without its edits (the old one is kept).
 */
export async function reconvert(
  storePath: string, fmp12Path: string,
  opts: { force?: boolean; dryRun?: boolean; sameFile?: boolean; passphrase?: string; onProgress?: (p: ImportProgress) => void; convert?: (src: string, dest: string, onProgress?: (p: ImportProgress) => void) => Promise<{ tables: number; records: number }> } = {},
): Promise<ReconvertResult> {
  const check = reconvertCheck(storePath, fmp12Path, { sameFile: opts.sameFile });
  if (check.native) throw new Error(NATIVE_REFUSAL);
  if (!existsSync(fmp12Path)) throw new Error(check.unsafe);
  if (check.unsafe && !opts.force) throw new Error(`can't carry edits over: ${check.unsafe}; convert afresh with force (the store as it is is kept)`);
  const carry = !check.unsafe;

  const scratch = opts.dryRun ? mkdtempSync(join(tmpdir(), 'tabularius-reconvert-preview-')) : undefined;
  try {
    return await build(storePath, fmp12Path, carry, scratch, opts);
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

async function build(
  storePath: string, fmp12Path: string, carry: boolean, scratch: string | undefined,
  opts: { passphrase?: string; onProgress?: (p: ImportProgress) => void; convert?: (src: string, dest: string, onProgress?: (p: ImportProgress) => void) => Promise<{ tables: number; records: number }> },
): Promise<ReconvertResult> {
  const fresh = scratch ? join(scratch, 'fresh') : storePath + '.reconverting';
  for (const ext of ['', '-wal', '-shm']) rmSync(fresh + ext, { force: true }); // one an earlier attempt left
  const convert = opts.convert ?? (async (src: string, dest: string, onProgress?: (p: ImportProgress) => void) => {
    const stats: ImportStat[] = importFmp12(src, dest, onProgress, { passphrase: opts.passphrase });
    return { tables: stats.length, records: stats.reduce((n, t) => n + t.records, 0) };
  });
  const stats = await convert(fmp12Path, fresh, opts.onProgress);

  // The store as it was, whole (its log folded in), kept beside it.
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const kept = scratch ? join(scratch, 'before') : `${storePath}.before-reconvert-${stamp}`;
  const old = new DatabaseSync(storePath);
  try {
    await backup(old, kept);
  } finally {
    old.close();
  }

  const counts = { created: 0, edited: 0, deleted: 0 };
  const sql = new DatabaseSync(fresh);
  try {
    sql.exec(`ATTACH DATABASE '${kept.replace(/'/g, "''")}' AS old`);
    sql.exec('BEGIN');
    if (carry) carryRecords(sql, counts);
    // Accounts come from the old store whole; one made before accounts carried
    // the file's on/off status gets it now, as a refresh would.
    const hadStatus = !!sql.prepare('SELECT 1 FROM old._fm_meta WHERE key = ?').get(ACCOUNT_STATUS_META);
    carrySettings(sql);
    if (!hadStatus) {
      sql.prepare('DELETE FROM main._fm_meta WHERE key = ?').run(ACCOUNT_STATUS_META);
      applyFileAccountStatus(sql);
    }
    // Accounts made here must never be lost: refuse, naming them, rather than swap in a store without them.
    if (tableExists(sql, '_fm_accounts', 'old')) {
      const lost = (sql.prepare('SELECT name FROM old._fm_accounts WHERE name NOT IN (SELECT name FROM main._fm_accounts)').all() as { name: string }[]).map((r) => r.name);
      if (lost.length) throw new Error(`converting again would lose ${lost.length} account${lost.length === 1 ? '' : 's'} (${lost.slice(0, 10).join(', ')}), so nothing was changed`);
    }
    sql.exec('COMMIT');
    if (scratch) {
      const preview = previewOf(sql, carry);
      sql.exec('DETACH DATABASE old');
      sql.close();
      return { stats, backup: '', ...counts, preview };
    }
    sql.exec('DETACH DATABASE old');
  } catch (e) {
    try { sql.exec('ROLLBACK'); } catch {}
    sql.close();
    rmSync(fresh, { force: true });
    throw e;
  }
  sql.close();
  for (const ext of ['-wal', '-shm']) rmSync(storePath + ext, { force: true });
  renameSync(fresh, storePath);
  for (const ext of ['-wal', '-shm']) rmSync(fresh + ext, { force: true });
  return { stats, backup: kept, ...counts };
}

/** Compares the fresh store (main) with the old one: what converting again changes. */
function previewOf(sql: DatabaseSync, carry: boolean): ReconvertPreview {
  const count = (table: string, schema: string) => tableExists(sql, table, schema)
    ? Number((sql.prepare(`SELECT count(*) AS n FROM ${schema}.${q(table)}`).get() as { n: number }).n) : 0;
  const schema = meta(sql, 'schema') as { tables: { name: string; fields: { name: string; type: string }[] }[] } | undefined;
  const tables: ReconvertPreview['tables'] = [];
  for (const t of schema?.tables ?? []) {
    const before = count(t.name, 'old');
    const after = count(t.name, 'main');
    let changed = 0;
    if (tableExists(sql, t.name, 'old') && tableExists(sql, t.name)) {
      // Container columns hold ids local to each store, and _fm_ columns are bookkeeping: compare the values.
      const containers = new Set(t.fields.filter((f) => f.type === 'container').map((f) => f.name));
      const old = new Set(columns(sql, t.name, 'old'));
      const shared = columns(sql, t.name).filter((c) => old.has(c) && !c.startsWith('_fm_') && !containers.has(c));
      if (shared.length) {
        changed = Number((sql.prepare(`SELECT count(*) AS n FROM main.${q(t.name)} f JOIN old.${q(t.name)} o ON o._fm_record_id = f._fm_record_id
          WHERE ${shared.map((c) => `f.${q(c)} IS NOT o.${q(c)}`).join(' OR ')}`).get() as { n: number }).n);
      }
    }
    tables.push({ table: t.name, before, after, changed });
  }
  return {
    accounts: { before: count('_fm_accounts', 'old'), after: count('_fm_accounts', 'main') },
    editsCarried: carry,
    designChangesLost: carry ? 0 : count(DESIGN_LOG, 'old'),
    containers: { before: count('_fm_containers', 'old'), after: count('_fm_containers', 'main') },
    tables,
  };
}

/** Copies a container file (and its pieces) from the old store; its id in the fresh one. */
function copyContainer(sql: DatabaseSync, id: number, done: Map<number, number>): number | null {
  const seen = done.get(id);
  if (seen !== undefined) return seen;
  const cols = columns(sql, '_fm_containers', 'old').filter((c) => c !== 'id' && columns(sql, '_fm_containers').includes(c));
  const row = sql.prepare(`SELECT ${cols.map(q).join(', ')} FROM old._fm_containers WHERE id = ?`).get(id) as Record<string, never> | undefined;
  if (!row) return null;
  const next = Number(sql.prepare(`INSERT INTO _fm_containers (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c])).lastInsertRowid);
  if (tableExists(sql, '_fm_container_chunks', 'old')) {
    if (!tableExists(sql, '_fm_container_chunks')) {
      sql.exec('CREATE TABLE _fm_container_chunks (id INTEGER NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, n)) WITHOUT ROWID');
    }
    sql.prepare('INSERT INTO _fm_container_chunks (id, n, data) SELECT ?, n, data FROM old._fm_container_chunks WHERE id = ?').run(next, id);
  }
  done.set(id, next);
  return next;
}

function carryRecords(sql: DatabaseSync, counts: { created: number; edited: number; deleted: number }): void {
  const schema = meta(sql, 'schema') as { tables: { name: string; fields: { name: string; type: string }[] }[] } | undefined;
  const containerCols = new Map<string, Set<string>>();
  for (const t of schema?.tables ?? []) containerCols.set(t.name, new Set(t.fields.filter((f) => f.type === 'container').map((f) => f.name)));
  const copied = new Map<number, number>();
  const audit = tableExists(sql, '_fm_audit', 'old');

  for (const t of schema?.tables ?? []) {
    if (!tableExists(sql, t.name) || !tableExists(sql, t.name, 'old')) continue;
    const mine = new Set(columns(sql, t.name));
    const shared = columns(sql, t.name, 'old').filter((c) => mine.has(c) && c !== '_fm_record_id');
    const containers = containerCols.get(t.name) ?? new Set();
    // A container column's value: an id, or a JSON list of them for repeating fields.
    const remap = (col: string, v: unknown): unknown => {
      if (!containers.has(col) || v === null || v === undefined) return v;
      if (typeof v === 'string' && v.startsWith('[')) {
        return JSON.stringify((JSON.parse(v) as (number | null)[]).map((x) => (x === null ? null : copyContainer(sql, x, copied))));
      }
      return copyContainer(sql, Number(v), copied);
    };
    const T = q(t.name);

    // Deleted since: in the .fmp12, gone from the store.
    counts.deleted += Number(sql.prepare(`DELETE FROM main.${T} WHERE _fm_record_id NOT IN (SELECT _fm_record_id FROM old.${T})`).run().changes);

    // Edited since: the fields the audit log says changed, or all of them.
    const edited = sql.prepare(`SELECT o._fm_record_id, ${shared.map((c) => `o.${q(c)}`).join(', ')} FROM old.${T} AS o JOIN main.${T} AS n ON n._fm_record_id = o._fm_record_id WHERE o._fm_mod_id > 0`).all() as Record<string, unknown>[];
    const changedFields = audit ? sql.prepare("SELECT changes FROM old._fm_audit WHERE security = 0 AND kind = 'update' AND tbl = ? AND record_id = ?") : undefined;
    for (const r of edited) {
      let cols = shared;
      const logged = changedFields?.all(t.name, r._fm_record_id as number) as { changes: string | null }[] | undefined;
      if (logged?.length) {
        const names = new Set<string>(['_fm_mod_id']);
        for (const l of logged) for (const k of Object.keys(l.changes ? JSON.parse(l.changes) as object : {})) names.add(k.replace(/\(\d+\)$/, ''));
        cols = shared.filter((c) => names.has(c));
      }
      if (!cols.length) continue;
      sql.prepare(`UPDATE main.${T} SET ${cols.map((c) => `${q(c)} = ?`).join(', ')} WHERE _fm_record_id = ?`)
        .run(...cols.map((c) => remap(c, r[c]) as never), r._fm_record_id as number);
      counts.edited++;
    }

    // Created since: copied whole (after the edits, which only look at records from the .fmp12).
    const created = sql.prepare(`SELECT _fm_record_id, ${shared.map(q).join(', ')} FROM old.${T} WHERE _fm_record_id NOT IN (SELECT _fm_record_id FROM main.${T})`).all() as Record<string, unknown>[];
    const insert = sql.prepare(`INSERT INTO main.${T} (_fm_record_id, ${shared.map(q).join(', ')}) VALUES (?${', ?'.repeat(shared.length)})`);
    for (const r of created) insert.run(r._fm_record_id as number, ...shared.map((c) => remap(c, r[c]) as never));
    counts.created += created.length;
  }
}

/** Accounts, privileges, tokens, the audit log and other settings, from the old store. */
function carrySettings(sql: DatabaseSync): void {
  const tables = (sql.prepare("SELECT name, sql FROM old.sqlite_master WHERE type = 'table' AND name LIKE '\\_fm\\_%' ESCAPE '\\'").all() as { name: string; sql: string }[])
    .filter((t) => !REGENERATED.has(t.name) && !t.name.startsWith(WORD_INDEX));
  // Each table as the old store had it (opening a store adds columns, such as
  // an account's privilege set), with its indexes.
  const indexes = sql.prepare("SELECT tbl_name, sql FROM old.sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all() as { tbl_name: string; sql: string }[];
  for (const t of tables) {
    sql.exec(`DROP TABLE IF EXISTS main.${q(t.name)}`); // unqualified, a name missing here would drop the backup's
    sql.exec(t.sql);
    for (const i of indexes) if (i.tbl_name === t.name) sql.exec(i.sql);
    sql.exec(`INSERT INTO main.${q(t.name)} SELECT * FROM old.${q(t.name)}`);
  }
  // Settings stored with the import's own (a password policy, ...), except what the conversion just wrote.
  const keep = (sql.prepare('SELECT key, json FROM old._fm_meta').all() as { key: string; json: string }[]).filter((m) => !FRESH_META.has(m.key));
  const put = sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json');
  for (const m of keep) put.run(m.key, m.json);
  // Fields that became repeating in Tabularius (a container's second repetition, ...) stay so.
  const was = meta(sql, 'repeating') as Record<string, string[]> | undefined;
  const before = (sql.prepare("SELECT json FROM old._fm_meta WHERE key = 'repeating'").get() as { json: string } | undefined);
  if (before) {
    const merged: Record<string, string[]> = { ...(was ?? {}) };
    for (const [t, fields] of Object.entries(JSON.parse(before.json) as Record<string, string[]>)) merged[t] = [...new Set([...(merged[t] ?? []), ...fields])];
    put.run('repeating', JSON.stringify(merged));
  }
}
