// The portable copy: a whole hosted file (every table, every container file, globals, serial counters, the design
// and the accounts, without their secrets) written to a folder anyone can read with standard tools: SQLite, CSV and
// JSON. It is built in `<folder>.partial` from a frozen snapshot of the live file, so a crash resumes where it
// stopped and a half copy is never published under the final name.
//
// A full copy is the most sensitive thing the server can write, so who may ask is strict (a Full Access account that
// signs in again here), every refusal and every success is a security event, and an unfinished stage can be discarded.

import { createHash } from 'node:crypto';
import { chmodSync, closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, writeFileSync, writeSync, type Stats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { designText, stableJson, writeDesignText } from './design-text.ts';
import { Store } from './store.ts';

/** A refusal or failure with the HTTP status a route should answer. */
export class ExitBundleError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ExitBundleError';
    this.status = status;
  }
}

export interface ExitBundleOptions {
  account: string;
  password: string;
  /** Where the request came from. The empty string is the command line on the computer that holds the file; a network request never passes it. */
  from?: string;
  /** Called after each committed batch of rows; a test throws from it to simulate a crash. */
  afterBatch?: (table: string, lastId: number) => void;
}

export interface ExitBundleReport {
  folder: string;
  tables: number;
  rows: number;
  containers: number;
}

const SNAPSHOT = '.source.openhbam.sqlite';
const WORK = '.work.openhbam.sqlite';
const STAGE_FILE = 'stage.json';
const MANIFEST = 'manifest.json';
const CONTAINER_TABLE = '_exit_containers';
const BATCH = 500;
const PIECE = 1024 * 1024;
const GENERIC_REFUSAL = 'this account and password cannot take a full copy of the file; use a Full Access account';

const running = new Map<string, true>();

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const transient = (rel: string) => rel === STAGE_FILE || rel === SNAPSHOT || rel === WORK || rel.endsWith('.pending') || rel === `${WORK}-wal` || rel === `${WORK}-shm` || rel === `${WORK}-journal`;

/** Who may take a copy: a Full Access account that signs in here, by the same rules as any sign-in. */
async function authorize(source: Store, account: unknown, password: unknown, from: string): Promise<string> {
  const name = typeof account === 'string' ? account : '';
  const refuse = (reason: string, message: string): never => {
    source.auditExitBundle(name, from, false, { reason });
    throw new ExitBundleError(message, 403);
  };
  if (typeof account !== 'string' || typeof password !== 'string' || !name || name.length > 256 || password.length > 1024) {
    return refuse('account and password missing or too long', 'give the name and password of a Full Access account');
  }
  const eligible = source.isFullAccessAccount(name);
  // Always checked, so an unknown name costs the same and counts toward the same lockout as a wrong password.
  if (!(await source.verifyAsync(name, password, from))) {
    source.auditSignIn(name, from, false);
    return refuse(eligible ? 'wrong password' : 'not an active Full Access account', GENERIC_REFUSAL);
  }
  if (!eligible) return refuse('not an active Full Access account', GENERIC_REFUSAL);
  if (!source.signInLocationAllowed(name, from)) return refuse('this account may not sign in from this address', 'this account may not sign in from this address');
  if (source.mustChangePassword(name)) return refuse('the password must be changed first', 'this account must change its password before it can take a copy; change it, then try again');
  if (from !== '' && (source.hasTotp(name) || source.accountRequires2fa(name) || source.requireTotpForFullAccess())) {
    return refuse('second factor in use', 'this account signs in with a second factor, which an export cannot ask for; use an account without one');
  }
  return name;
}

function sha256File(path: string): string {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  const buf = Buffer.allocUnsafe(PIECE);
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/** Writes a small file whole or not at all. */
function writeAtomic(path: string, text: string | Uint8Array): void {
  const pending = `${path}.pending`;
  writeFileSync(pending, text, { mode: 0o600 });
  renameSync(pending, path);
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'file';
}

/** The stage must be a plain folder this user owns and nobody else can open. */
function checkStage(stage: string, st: Stats): void {
  if (st.isSymbolicLink() || !st.isDirectory()) throw new ExitBundleError(`${stage} is not a plain folder; remove it or choose another name`, 409);
  const uid = process.getuid?.();
  if (uid !== undefined && st.uid !== uid) throw new ExitBundleError(`${stage} belongs to another user; it was not touched`, 409);
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) throw new ExitBundleError(`${stage} can be opened by other users; it was not touched (the copy holds everything in the file)`, 409);
}

function lstatOrUndefined(path: string): Stats | undefined {
  try { return lstatSync(path); } catch { return undefined; }
}

function listFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, path));
    else if (entry.isFile() && !transient(path)) out.push(path);
    else if (!entry.isFile() && !entry.isDirectory()) throw new ExitBundleError(`${join(root, path)} is not a plain file; remove it and try again`, 409);
  }
  return out.sort();
}

function lockDown(root: string): void {
  chmodSync(root, 0o700);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) lockDown(path);
    else if (entry.isFile()) chmodSync(path, 0o600);
  }
}

interface Manifest {
  format: 1;
  tables: Record<string, number>;
  csv: Record<string, string>;
  containers: number;
  missingContainers: number[];
  files: Record<string, string>;
}

function verifyAgainstManifest(stage: string): Manifest {
  let manifest: Manifest;
  try { manifest = JSON.parse(readFileSync(join(stage, MANIFEST), 'utf8')) as Manifest; } catch { throw new ExitBundleError(`${join(stage, MANIFEST)} cannot be read; discard the unfinished copy and run again`, 409); }
  const listed = Object.keys(manifest.files ?? {}).sort();
  const present = listFiles(stage).filter((f) => f !== MANIFEST);
  if (listed.length !== present.length || listed.some((f, i) => f !== present[i])) {
    throw new ExitBundleError(`the files in ${stage} are not the ones its manifest lists; discard the unfinished copy and run again`, 409);
  }
  for (const rel of listed) {
    if (sha256File(join(stage, ...rel.split('/'))) !== manifest.files[rel]) throw new ExitBundleError(`${rel} in ${stage} does not match its manifest; discard the unfinished copy and run again`, 409);
  }
  return manifest;
}

function remove(path: string): void {
  rmSync(path, { force: true });
}

/**
 * Writes a full copy of `source` to `folder`. Refuses unless `account` is an active Full Access account that signs in
 * with `password` the way any sign-in does; a half-finished copy stays in `<folder>.partial` and the next run resumes it.
 */
export async function exitBundle(source: Store, folder: string, opts: ExitBundleOptions): Promise<ExitBundleReport> {
  const from = opts.from ?? '';
  const target = resolve(folder);
  if (running.has(target)) throw new ExitBundleError('an export to that folder is already running', 409);
  const account = await authorize(source, opts.account, opts.password, from);
  // Checked again: a second request may have been let in while this one signed in.
  if (running.has(target)) throw new ExitBundleError('an export to that folder is already running', 409);
  running.set(target, true);
  try {
    const report = await build(source, target, opts);
    source.auditExitBundle(account, from, true, { folder: target });
    return report;
  } finally {
    running.delete(target);
  }
}

/** Removes an unfinished copy (`<folder>.partial`), which holds a plaintext snapshot of the whole file. Same sign-in rules as the export. */
export async function discardExitBundle(source: Store, folder: string, opts: { account: string; password: string; from?: string }): Promise<void> {
  const from = opts.from ?? '';
  const account = await authorize(source, opts.account, opts.password, from);
  const target = resolve(folder);
  if (running.has(target)) throw new ExitBundleError('an export to that folder is running; wait for it to finish', 409);
  const stage = `${target}.partial`;
  const st = lstatOrUndefined(stage);
  if (!st) throw new ExitBundleError(`there is no unfinished copy at ${stage}`, 404);
  checkStage(stage, st);
  rmSync(stage, { recursive: true, force: true });
  source.auditExitBundle(account, from, true, { folder: target, discarded: true });
}

async function build(source: Store, target: string, opts: ExitBundleOptions): Promise<ExitBundleReport> {
  if (source.schema.tables.some((t) => t.name.toLowerCase() === CONTAINER_TABLE)) {
    throw new ExitBundleError(`a table is named ${CONTAINER_TABLE}, which the copy uses for its own list of container files; rename that table first`, 400);
  }
  if (lstatOrUndefined(target)) throw new ExitBundleError(`${target} already exists; choose another folder name`, 409);
  const parent = lstatOrUndefined(dirname(target));
  if (!parent?.isDirectory()) throw new ExitBundleError(`the folder ${dirname(target)} does not exist`, 400);

  const stage = `${target}.partial`;
  const staged = lstatOrUndefined(stage);
  if (!staged) {
    mkdirSync(stage, { mode: 0o700 });
    chmodSync(stage, 0o700);
  } else checkStage(stage, staged);

  // A stop between deleting the snapshot and the last rename leaves a finished copy: verify it, then publish it.
  if (existsSync(join(stage, MANIFEST))) {
    const manifest = verifyAgainstManifest(stage);
    for (const name of [SNAPSHOT, WORK, STAGE_FILE]) remove(join(stage, name));
    return publish(stage, target, manifest);
  }

  const snapshot = join(stage, SNAPSHOT);
  const data = join(stage, 'data.sqlite');
  const record = join(stage, STAGE_FILE);
  for (const name of [`${SNAPSHOT}.pending`, `${STAGE_FILE}.pending`, WORK, `${WORK}-wal`, `${WORK}-shm`, `${WORK}-journal`]) remove(join(stage, name));
  if (existsSync(snapshot) && !existsSync(record)) {
    // Stopped between the snapshot and its record: nothing was copied from it yet, so it can be taken again.
    if (existsSync(data)) throw new ExitBundleError(`the snapshot in ${stage} has no record of what it should hold; discard the unfinished copy and run again`, 409);
    remove(snapshot);
  }
  if (!existsSync(snapshot)) {
    const pending = `${snapshot}.pending`;
    await source.backup(pending);
    // One plain file, whatever mode the live file was in.
    const db = new DatabaseSync(pending);
    try { db.exec('PRAGMA journal_mode = DELETE'); } finally { db.close(); }
    chmodSync(pending, 0o600);
    renameSync(pending, snapshot);
    writeAtomic(record, JSON.stringify({ format: 1, snapshotSha256: sha256File(snapshot) }));
  } else {
    let kept: { snapshotSha256?: unknown } = {};
    try { kept = JSON.parse(readFileSync(record, 'utf8')) as typeof kept; } catch { /* compared below */ }
    if (kept.snapshotSha256 !== sha256File(snapshot)) {
      throw new ExitBundleError(`the snapshot in ${stage} is not the one that was recorded for it, so it was not used; discard the unfinished copy and run again`, 409);
    }
  }

  // Opening a Store on a file writes to it, so the pristine snapshot is only ever copied; the copy is what is read.
  const work = join(stage, WORK);
  copyFileSync(snapshot, work, constants.COPYFILE_FICLONE);
  chmodSync(work, 0o600);
  const snap = new Store(work, 'Snapshot');
  let out: DatabaseSync | undefined;
  let closed = false;
  const closeWork = () => {
    if (closed) return;
    closed = true;
    snap.close();
    for (const name of [WORK, `${WORK}-wal`, `${WORK}-shm`, `${WORK}-journal`]) remove(join(stage, name));
  };
  try {
    if (!existsSync(data)) closeSync(openSync(data, 'a', 0o600));
    out = new DatabaseSync(data);
    out.prepare('ATTACH DATABASE ? AS src').run(work);
    const copied = copyTables(snap, out, source, stage, opts);
    out.close();
    out = undefined;
    return finish(snap, closeWork, stage, target, copied);
  } finally {
    out?.close();
    closeWork();
  }
}

interface CopiedTable {
  name: string;
  columns: string[];
  containerColumns: { name: string; repeating: boolean }[];
  rows: number;
}

/** Copies the stored columns of every table, 500 rows to a transaction, from where an earlier run stopped. */
function copyTables(snap: Store, out: DatabaseSync, source: Store, stage: string, opts: ExitBundleOptions): { tables: CopiedTable[]; containers: { missing: number[]; count: number } } {
  const tables: CopiedTable[] = [];
  out.exec(`CREATE TABLE IF NOT EXISTS main.${q(CONTAINER_TABLE)} (id INTEGER PRIMARY KEY, path TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, mime TEXT)`);
  for (const table of snap.schema.tables) {
    const present = new Map((out.prepare(`PRAGMA src.table_info(${q(table.name)})`).all() as { name: string; type: string }[]).map((c) => [c.name, c.type]));
    const fields = table.fields.filter((f) => !f.options?.global && f.kind !== 'summary' && present.has(f.name));
    const columns = ['_fm_record_id', ...fields.map((f) => f.name)];
    const declared = (name: string) => (present.get(name) ? ` ${present.get(name)}` : '');
    out.exec(`CREATE TABLE IF NOT EXISTS main.${q(table.name)} (${['"_fm_record_id" INTEGER PRIMARY KEY', ...fields.map((f) => `${q(f.name)}${declared(f.name)}`)].join(', ')})`);
    const list = columns.map(q).join(', ');
    const copy = out.prepare(`INSERT INTO main.${q(table.name)} (${list}) SELECT ${list} FROM src.${q(table.name)} WHERE _fm_record_id > ? ORDER BY _fm_record_id LIMIT ${BATCH}`);
    const last = out.prepare(`SELECT max(_fm_record_id) AS last FROM main.${q(table.name)}`);
    for (;;) {
      const after = Number((last.get() as { last: number | null }).last ?? 0);
      out.exec('BEGIN');
      let changes: number;
      try {
        changes = Number(copy.run(after).changes);
        out.exec('COMMIT');
      } catch (e) {
        out.exec('ROLLBACK');
        throw e;
      }
      if (!changes) break;
      opts.afterBatch?.(table.name, Number((last.get() as { last: number }).last));
    }
    const containerColumns = fields.filter((f) => f.type === 'container').map((f) => ({ name: f.name, repeating: snap.isRepeating(table.name, f.name) || (f.options?.repetitions ?? 1) > 1 }));
    tables.push({ name: table.name, columns, containerColumns, rows: Number((out.prepare(`SELECT count(*) AS n FROM main.${q(table.name)}`).get() as { n: number }).n) });
  }
  return { tables, containers: writeContainers(source, out, stage, tables) };
}

/** Every container file the records point at, written in 1 MiB pieces from the live file and checked against its size. */
function writeContainers(source: Store, out: DatabaseSync, stage: string, tables: CopiedTable[]): { missing: number[]; count: number } {
  const ids = new Set<number>();
  for (const t of tables) {
    for (const c of t.containerColumns) {
      for (const row of out.prepare(`SELECT DISTINCT ${q(c.name)} AS v FROM main.${q(t.name)} WHERE ${q(c.name)} IS NOT NULL`).all() as { v: unknown }[]) {
        if (typeof row.v === 'number' || typeof row.v === 'bigint') ids.add(Number(row.v));
        else if (typeof row.v === 'string' && c.repeating) {
          try {
            const list: unknown = JSON.parse(row.v);
            for (const x of Array.isArray(list) ? list : [list]) if (typeof x === 'number' && Number.isInteger(x)) ids.add(x);
          } catch { /* not a list of ids: kept as the text it is */ }
        }
      }
    }
  }
  mkdirSync(join(stage, 'containers'), { recursive: true, mode: 0o700 });
  const done = new Set((out.prepare(`SELECT id, path FROM main.${q(CONTAINER_TABLE)}`).all() as { id: number; path: string }[]).filter((r) => existsSync(join(stage, ...r.path.split('/')))).map((r) => Number(r.id)));
  const insert = out.prepare(`INSERT OR REPLACE INTO main.${q(CONTAINER_TABLE)} (id, path, size, sha256, mime) VALUES (?, ?, ?, ?, ?)`);
  const missing: number[] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    if (done.has(id)) continue;
    const info = source.containerInfo(id);
    if (!info) { missing.push(id); continue; }
    if (info.external && (info.external.missing || info.external.changed)) {
      throw new ExitBundleError(`the file for container ${id} is stored outside the database at ${info.external.path} and is ${info.external.missing ? 'missing' : 'not the size it was when stored'}; put it back and run again`, 409);
    }
    const path = `containers/${id}-${safeName(info.filename ?? 'container')}`;
    const file = join(stage, ...path.split('/'));
    const pending = `${file}.pending`;
    const hash = createHash('sha256');
    const fd = openSync(pending, 'w', 0o600);
    let written = 0;
    try {
      while (written < info.size) {
        const end = Math.min(written + PIECE, info.size) - 1;
        const piece = source.containerRange(id, written, end);
        if (piece.length !== end - written + 1) throw new ExitBundleError(`the file for container ${id} changed while it was being copied; run again`, 409);
        hash.update(piece);
        writeSync(fd, piece);
        written += piece.length;
      }
    } finally {
      closeSync(fd);
    }
    renameSync(pending, file);
    insert.run(id, path, info.size, hash.digest('hex'), info.mime ?? null);
  }
  return { missing, count: Number((out.prepare(`SELECT count(*) AS n FROM main.${q(CONTAINER_TABLE)}`).get() as { n: number }).n) };
}

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const text = v instanceof Uint8Array ? Buffer.from(v).toString('base64') : String(v);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function writeCsv(out: DatabaseSync, stage: string, table: CopiedTable, index: number): string {
  const path = `csv/${String(index + 1).padStart(3, '0')}-${safeName(table.name)}.csv`;
  const file = join(stage, ...path.split('/'));
  const pending = `${file}.pending`;
  const fd = openSync(pending, 'w', 0o600);
  try {
    writeSync(fd, `${table.columns.map(csvCell).join(',')}\r\n`);
    const read = out.prepare(`SELECT ${table.columns.map(q).join(', ')} FROM main.${q(table.name)} ORDER BY _fm_record_id`);
    read.setReadBigInts(true);
    let chunk: string[] = [];
    let size = 0;
    for (const row of read.iterate() as Iterable<Record<string, unknown>>) {
      const line = `${table.columns.map((c) => csvCell(row[c])).join(',')}\r\n`;
      chunk.push(line);
      size += line.length;
      if (size >= PIECE) { writeSync(fd, chunk.join('')); chunk = []; size = 0; }
    }
    if (chunk.length) writeSync(fd, chunk.join(''));
  } finally {
    closeSync(fd);
  }
  renameSync(pending, file);
  return path;
}

function checksSql(tables: CopiedTable[]): string {
  const lines = [
    '-- Checks on data.sqlite. Run:  sqlite3 data.sqlite < checks.sql',
    '-- Every "missing" below should be 0, "ok" should be ok, and foreign_key_check should print nothing.',
    '',
    ...tables.map((t) => `SELECT ${`'${t.name.replace(/'/g, "''")}'`} AS "table", count(*) AS rows FROM main.${q(t.name)};`),
    '',
  ];
  for (const t of tables) {
    for (const c of t.containerColumns.filter((x) => !x.repeating)) {
      lines.push(`SELECT '${(t.name + '::' + c.name).replace(/'/g, "''")}' AS field, count(*) AS missing FROM main.${q(t.name)} AS t LEFT JOIN main.${q(CONTAINER_TABLE)} AS c ON c.id = t.${q(c.name)} WHERE t.${q(c.name)} IS NOT NULL AND c.id IS NULL;`);
    }
  }
  lines.push('', 'PRAGMA integrity_check;', 'PRAGMA foreign_key_check;', '');
  return lines.join('\n');
}

function notes(missing: number[]): string {
  return [
    'A portable copy of a hosted file, written by Tabularius.',
    '',
    'PLAINTEXT. This folder holds every record and every container file of the file in the clear, even when the server',
    'encrypts files at rest. Keep it somewhere only the right people can open and delete it when you no longer need it.',
    'An unfinished copy (a folder ending in .partial) is just as sensitive and should not be left lying around.',
    '',
    'What is here',
    '  data.sqlite    one table per table of the file, with the stored columns and _fm_record_id as the key,',
    '                 plus _exit_containers (id, path, size, sha256, mime) listing every container file.',
    '  csv/           the same rows, one CSV file per table (header row; an empty cell for NULL; binary values as base64).',
    '  containers/    every container file, named <id>-<file name>.',
    '  schema.json    the schema (tables, fields, relationships, value lists, accounts) without password verifiers.',
    '  schema.sql     the CREATE TABLE statements of data.sqlite.',
    '  globals.json   the current value of every global field.',
    '  serials.json   the next value of every serial number.',
    '  design/        layouts, scripts, value lists, relationships and privilege sets as text; accounts are listed',
    '                 by name and privilege set only.',
    '  checks.sql     row counts and consistency checks: sqlite3 data.sqlite < checks.sql',
    '  manifest.json  row counts, and the SHA-256 of every other file.',
    '',
    'What is not here',
    '  Summary fields and unstored calculations have no stored value, so they have no column.',
    '  Layout themes, live sessions, schedules, plug-in binaries, account credentials (passwords, verifiers, second-factor',
    '  secrets, recovery codes) and API tokens are not included.',
    '  Files that a container field stores outside the stored schema are unverified beyond their size and SHA-256.',
    '  Global container fields keep their value in globals.json only as a container id; the file is not copied.',
    '  Container files no record points at are not copied.',
    '  Field values a file treats as sensitive ARE included, because a Full Access account can read them.',
    '',
    'Good to know',
    '  A repeating container field keeps its ids in data.sqlite, but checks.sql only checks the scalar ones.',
    '  CSV uses an empty cell for NULL and for empty text; data.sqlite keeps the difference.',
    '  Treat the CSV files as untrusted when you open them in a spreadsheet: text that looks like a formula is written',
    '  as it is stored, and a spreadsheet may run it.',
    ...(missing.length ? ['', `  ${missing.length} container id${missing.length === 1 ? '' : 's'} used by records had no file in the source (${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ', ...' : ''}); checks.sql reports them as missing.`] : []),
    '',
  ].join('\n');
}

function finish(snap: Store, closeWork: () => void, stage: string, target: string, copied: { tables: CopiedTable[]; containers: { missing: number[]; count: number } }): ExitBundleReport {
  const { tables, containers } = copied;
  const data = join(stage, 'data.sqlite');
  const db = new DatabaseSync(data);
  const csv: Record<string, string> = {};
  let schemaSql: string;
  try {
    mkdirSync(join(stage, 'csv'), { recursive: true, mode: 0o700 });
    tables.forEach((t, i) => { csv[t.name] = writeCsv(db, stage, t, i); });
    schemaSql = `${(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name").all() as { sql: string }[]).map((r) => `${r.sql};`).join('\n\n')}\n`;
  } finally {
    db.close();
  }

  const schema = snap.schema;
  const without = { ...schema, accounts: schema.accounts.map(({ passwordVerifier: _verifier, ...account }) => account) };
  const globals: Record<string, Record<string, unknown>> = {};
  const serials: Record<string, Record<string, unknown>> = {};
  for (const table of schema.tables) {
    for (const field of table.fields) {
      if (field.options?.global) (globals[table.name] ??= {})[field.name] = snap.calc.globalValue(table, field);
      if (field.options?.autoEnter?.serial) (serials[table.name] ??= {})[field.name] = snap.calc.peekSerial(table, field) ?? null;
    }
  }
  writeAtomic(join(stage, 'schema.json'), `${stableJson(without)}\n`);
  writeAtomic(join(stage, 'schema.sql'), schemaSql);
  writeAtomic(join(stage, 'globals.json'), `${stableJson(globals)}\n`);
  writeAtomic(join(stage, 'serials.json'), `${stableJson(serials)}\n`);
  writeDesignText(join(stage, 'design'), designText({ schema, layouts: snap.designs().layouts, accounts: snap.accounts(), privilegeSets: snap.privilegeSets() }));
  writeAtomic(join(stage, 'checks.sql'), checksSql(tables));
  writeAtomic(join(stage, 'NOTES.txt'), notes(containers.missing));
  closeWork();

  lockDown(stage);
  const files: Record<string, string> = {};
  for (const rel of listFiles(stage).filter((f) => f !== MANIFEST && f !== 'data.sqlite')) files[rel] = sha256File(join(stage, ...rel.split('/')));
  files['data.sqlite'] = sha256File(data);
  const manifest: Manifest = {
    format: 1,
    tables: Object.fromEntries(tables.map((t) => [t.name, t.rows])),
    csv,
    containers: containers.count,
    missingContainers: containers.missing,
    files,
  };
  writeAtomic(join(stage, MANIFEST), `${stableJson(manifest)}\n`);
  lockDown(stage);
  for (const name of [SNAPSHOT, WORK, STAGE_FILE]) remove(join(stage, name));
  return publish(stage, target, manifest);
}

function publish(stage: string, target: string, manifest: Manifest): ExitBundleReport {
  try {
    renameSync(stage, target);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') throw new ExitBundleError(`${target} appeared while the copy was being made; the finished copy is still in ${stage}`, 409);
    throw e;
  }
  return { folder: target, tables: Object.keys(manifest.tables).length, rows: Object.values(manifest.tables).reduce((a, b) => a + b, 0), containers: manifest.containers };
}
