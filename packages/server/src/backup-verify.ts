// Backup verification, like FileMaker Server's "verify backup integrity":
// each set is checked after it is taken, and the sets already on disk are
// checked again, one per backup run (the longest unchecked first), so a copy
// damaged later on the disk is found while there are still good ones.
//
// A check reads each file's copy back as a restore would: it must match the
// checksum recorded when the copy was taken, decrypt with the passphrase when
// it is encrypted, and pass SQLite's full integrity check. The outcome is
// kept in the set's backup.json and shown in the admin console.
//
// Beyond that, a test restore (once a day, after a scheduled backup, or on
// demand) does what a restore would: copies the set to a scratch folder,
// opens every file there as the server opens a hosted file, and counts its
// records and accounts. A backup nobody has restored is a hope; this proves
// the copy comes back as a working file, then throws the scratch copy away.
//
//   POST /tabularius/admin/v1/backups/{set}/verify         check one set now
//   POST /tabularius/admin/v1/backups/{set}/test-restore   restore one set to a scratch folder as a test

import { readBackupInfo, updateBackupInfo } from './backup-info.ts';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { backupInventory, checkedBackupCopies } from './backup-inventory.ts';
import { pipeline } from 'node:stream/promises';
import { STORE_EXT } from './host.ts';
import { decryptFile, ENCRYPTED_EXT } from './encrypt.ts';
import { backupKey, backupSets } from './backup.ts';
import { verifyExternal } from './backup-external.ts';
import { Store, isDamageError } from '../../store/src/index.ts';


export interface SetCheck {
  /** When it was checked (ISO). */
  at: string;
  ok: boolean;
  /** Each file's outcome: "ok", or what is wrong with it. */
  files: Record<string, string>;
  ms: number;
}

/** A file's SHA-256, read in pieces so a large copy doesn't fill memory. */
export async function checksum(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** Hash and decrypt the same private snapshot before any restore can use it. */
export async function copyVerifiedDatabase(source: string, target: string, passphrase?: string, afterCopy: () => void = () => {}): Promise<void> {
  const setDir = dirname(source);
  const stored = basename(source);
  const file = stored.endsWith(ENCRYPTED_EXT) ? stored.slice(0, -ENCRYPTED_EXT.length) : stored;
  if (!checkedBackupCopies(setDir).includes(stored)) throw new Error(`${file}: not listed in the database inventory`);
  const info = readInfo(setDir, true);
  const sum = info.sha256?.[file];
  const copy = stored.endsWith(ENCRYPTED_EXT) ? target + ENCRYPTED_EXT : target;
  try {
    copyFileSync(source, copy);
    afterCopy();
    if (sum && await checksum(copy) !== sum) throw new Error(`${file}: changed on disk since it was taken (checksum)`);
    if (copy !== target) {
      if (!passphrase) throw new Error(`${file} is encrypted: set TABULARIUS_BACKUP_KEY to its passphrase`);
      await decryptFile(copy, target, passphrase);
    }
  } finally {
    if (copy !== target) rmSync(copy, { force: true });
  }
}

/** What came back when a set was restored as a test. */
export interface RestoreTest {
  at: string;
  ok: boolean;
  /** Each file: what opened, or why it didn't. */
  files: Record<string, { tables: number; records: number; accounts: number } | string>;
  ms: number;
}

type SetInfo = { finished?: Record<string, string>; sha256?: Record<string, string>; verified?: SetCheck; restored?: RestoreTest };

function readInfo(setDir: string, allowMissing = false): SetInfo {
  return readBackupInfo<SetInfo>(setDir, allowMissing);
}

function updateInfo(setDir: string, change: (info: SetInfo) => void): void {
  updateBackupInfo<SetInfo>(setDir, change);
}

/** Records a copy's checksum as it is taken, for later checks to compare against. */
export async function recordChecksum(setDir: string, file: string, stored: string): Promise<void> {
  const sum = await checksum(stored);
  updateInfo(setDir, (info) => {
    info.sha256 = { ...info.sha256, [file]: sum };
  });
}

/** A set's last check, if it has had one. */
export function lastCheck(setDir: string): SetCheck | undefined {
  try { return readInfo(setDir).verified; } catch { return undefined; }
}

/** A set's last test restore, if it has had one. */
export function lastRestore(setDir: string): RestoreTest | undefined {
  try { return readInfo(setDir).restored; } catch { return undefined; }
}

/** How often a scheduled backup is also restored as a test. */
export const RESTORE_TEST_EVERY_MS = 24 * 60 * 60 * 1000;

/** Restores a set to a scratch folder, opens each file as the server would, and records what came back. */
export async function testRestore(setDir: string, passphrase = backupKey()): Promise<RestoreTest> {
  const started = Date.now();
  const files: RestoreTest['files'] = {};
  let copies: string[];
  try {
    const inventory = backupInventory(setDir);
    copies = inventory.copies;
    Object.assign(files, inventory.problems);
  } catch (e) {
    return { at: new Date().toISOString(), ok: false, files: { 'backup.json': (e as Error).message }, ms: Date.now() - started };
  }
  const scratch = mkdtempSync(join(tmpdir(), 'tabularius-restore-test-'));
  try {
    for (const stored of copies) {
      const file = stored.endsWith(ENCRYPTED_EXT) ? stored.slice(0, -ENCRYPTED_EXT.length) : stored;
      if (files[file]) continue;
      const restored = join(scratch, file);
      let store: Store | undefined;
      try {
        await copyVerifiedDatabase(join(setDir, stored), restored, passphrase);
        store = new Store(restored, file.slice(0, -STORE_EXT.length));
        const tables = store.schema?.tables ?? [];
        if (!tables.length) {
          files[file] = 'opened, but has no tables in it (expected for a file made with tabularius new before a design is applied; otherwise this backup is empty, so use the one before it)';
          continue;
        }
        let records = 0;
        for (const t of tables) records += store.recordCount(t.name);
        files[file] = { tables: tables.length, records, accounts: store.accounts().length };
      } catch (e) {
        files[file] = (e as Error).message;
      } finally {
        store?.close();
        for (const ext of ['', '-wal', '-shm']) rmSync(restored + ext, { force: true });
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const external = await verifyExternal(setDir, passphrase);
  for (const [file, problem] of Object.entries(external)) files[file] = problem;
  const result: RestoreTest = { at: new Date().toISOString(), ok: Object.values(files).every((v) => typeof v !== 'string'), files, ms: Date.now() - started };
  updateInfo(setDir, (i) => {
    i.restored = result;
  });
  return result;
}

/** What a test restore says, in one line. */
export function describeRestore(set: string, r: RestoreTest): string {
  const bad = Object.entries(r.files).filter(([, v]) => typeof v === 'string');
  if (bad.length) return `backup ${set} failed its test restore: ${bad.map(([f, v]) => `${f}: ${v}`).join('; ')}`;
  const opened = Object.values(r.files) as { records: number }[];
  return `backup ${set} restored as a test: ${opened.length} file${opened.length === 1 ? '' : 's'} opened, ${opened.reduce((n, f) => n + f.records, 0)} records`;
}

/** Whether no set in the folder has been restored as a test within `every`. */
export function restoreTestDue(dest: string, every = RESTORE_TEST_EVERY_MS, now = Date.now()): boolean {
  const newest = Math.max(0, ...backupSets(dest).map((s) => Date.parse(lastRestore(join(dest, s))?.at ?? '') || 0));
  return now - newest >= every;
}

/** Runs SQLite's full integrity check on a database file; "ok" or the first problems found. */
export function integrity(path: string, quick = false): string {
  const leftovers = ['-wal', '-shm'].filter((ext) => !existsSync(path + ext));
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare(quick ? 'PRAGMA quick_check' : 'PRAGMA integrity_check(5)').all() as Record<string, string>[];
    const problems = rows.map((r) => Object.values(r)[0]);
    if (problems.length === 1 && problems[0] === 'ok') {
      // A database Tabularius made, not just any SQLite file.
      const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number };
      return tables.n ? 'ok' : 'holds no tables';
    }
    return problems.join('; ');
  } catch (e) {
    return (e as Error).message;
  } finally {
    db.close();
    // Opening it may leave empty log files; the copy is complete without them.
    for (const ext of leftovers) rmSync(path + ext, { force: true });
  }
}

export type PageCheck = { state: 'ok' } | { state: 'damaged' | 'unreadable'; detail: string };

/**
 * Reads every page of a file that may be in use: `damaged` is SQLite (or the check) saying its pages are bad; `unreadable`
 * is the file not being checkable right now (locked, no permission, out of descriptors), which says nothing about it.
 * Unlike `integrity` it removes nothing: a server may have opened the file since the check began.
 */
export function pageCheck(path: string, quick = true): PageCheck {
  const clean = (e: unknown) => ((e as Error).message || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 120);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 2000');
    const rows = db.prepare(quick ? 'PRAGMA quick_check' : 'PRAGMA integrity_check(5)').all() as Record<string, string>[];
    const problems = rows.map((r) => Object.values(r)[0]);
    if (problems.length !== 1 || problems[0] !== 'ok') return { state: 'damaged', detail: problems.join('; ').slice(0, 120) };
    const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number };
    return tables.n ? { state: 'ok' } : { state: 'damaged', detail: 'holds no tables' };
  } catch (e) {
    return { state: isDamageError(e) ? 'damaged' : 'unreadable', detail: clean(e) };
  } finally {
    try { db?.close(); } catch { /* nothing more to do */ }
  }
}

/** Checks every file's copy in a backup set and records the outcome in it. */
export async function verifySet(setDir: string, passphrase = backupKey()): Promise<SetCheck> {
  const started = Date.now();
  let info: SetInfo;
  try { info = readInfo(setDir); } catch (e) {
    return { at: new Date().toISOString(), ok: false, files: { 'backup.json': (e as Error).message }, ms: Date.now() - started };
  }
  const files: Record<string, string> = {};
  let copies: string[];
  try {
    const inventory = backupInventory(setDir);
    copies = inventory.copies;
    Object.assign(files, inventory.problems);
  } catch (e) {
    return { at: new Date().toISOString(), ok: false, files: { 'backup.json': (e as Error).message }, ms: Date.now() - started };
  }
  let scratch: string | undefined;
  try {
    for (const stored of copies) {
      const file = stored.endsWith(ENCRYPTED_EXT) ? stored.slice(0, -ENCRYPTED_EXT.length) : stored;
      if (files[file]) continue;
      const path = join(setDir, stored);
      try {
        const sum = info.sha256?.[file];
        if (sum && await checksum(path) !== sum) {
          files[file] = 'changed on disk since it was taken';
          continue;
        }
        if (stored.endsWith(ENCRYPTED_EXT)) {
          if (!passphrase) {
            files[file] = 'encrypted: set TABULARIUS_BACKUP_KEY to check it';
            continue;
          }
          scratch ??= mkdtempSync(join(tmpdir(), 'tabularius-verify-'));
          const plain = join(scratch, file);
          await decryptFile(path, plain, passphrase);
          files[file] = integrity(plain);
          rmSync(plain, { force: true });
        } else {
          files[file] = integrity(path);
        }
      } catch (e) {
        files[file] = (e as Error).message;
      }
    }
    // Externally stored container files: present and as they were taken.
    const external = await verifyExternal(setDir, passphrase);
    const bad = Object.keys(external);
    if (bad.length) files['external container files'] = `${bad.length} ${bad.length === 1 ? 'is' : 'are'} damaged or missing, e.g. ${bad[0]}: ${external[bad[0]]}`;
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
  // A set taken while nothing was hosted is complete with nothing in it.
  const check: SetCheck = { at: new Date().toISOString(), ok: Object.values(files).every((v) => v === 'ok'), files, ms: Date.now() - started };
  updateInfo(setDir, (i) => {
    i.verified = check;
  });
  return check;
}

/** What a failed check says, in one line. */
export function describeCheck(set: string, check: SetCheck): string {
  const bad = Object.entries(check.files).filter(([, v]) => v !== 'ok');
  return bad.length ? `backup ${set} failed its check: ${bad.map(([f, v]) => `${f}: ${v}`).join('; ')}` : `backup ${set} checked: ${Object.keys(check.files).length === 1 ? '1 file' : `${Object.keys(check.files).length} files`} ok`;
}

/**
 * After a backup: checks the new set, then one older set, the one checked
 * longest ago (or never). Returns the new set's check.
 */
export async function verifyAfterBackup(dest: string, newSet: string, log: (m: string) => void = () => {}, passphrase = backupKey()): Promise<SetCheck> {
  const check = await verifySet(join(dest, newSet), passphrase);
  log(describeCheck(newSet, check));
  const older = backupSets(dest).filter((s) => s !== newSet)
    .map((s) => ({ s, at: Date.parse(lastCheck(join(dest, s))?.at ?? '') || 0 }))
    .sort((a, b) => a.at - b.at)[0];
  if (older) {
    try {
      const again = await verifySet(join(dest, older.s), passphrase);
      log(describeCheck(older.s, again));
    } catch (e) {
      // Removed while it was checked (an older set past the limit): nothing to report.
      if (existsSync(join(dest, older.s))) log(`backup ${older.s} could not be checked: ${(e as Error).message}`);
    }
  }
  return check;
}
