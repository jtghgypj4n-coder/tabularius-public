// A file whose pages have been damaged (a bad disk, a half-finished copy, a sync tool): SQLite says so with
// SQLITE_CORRUPT or SQLITE_NOTADB the first time a query reads the bad page. Without this, that was one more
// "Unknown error" in a request's answer, while the file went on being read and written. The first such error takes the
// store out of use: every later query on it is refused with one clear message, and the host (host.ts) stops serving the file.

import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { StoreError } from './errors.ts';

const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;
const SQLITE_FULL = 13;
const SQLITE_IOERR = 10;
const SQLITE_READONLY = 8;
const SQLITE_READONLY_DBMOVED = 1032;
// Extended codes. A page that cannot be read is damage as far as this file is concerned; the word index (a virtual table,
// rebuilt from the data) is not, and the page check does not look at it, so taking the file offline for it would only bounce.
const SQLITE_IOERR_READ = 266;
const SQLITE_IOERR_SHORT_READ = 522;
const SQLITE_CORRUPT_VTAB = 267;

/** Whether an error is SQLite saying the file's pages are damaged (including the extended codes, such as a damaged index). */
export function isDamageError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const code = (e as { errcode?: unknown }).errcode;
  if (typeof code !== 'number' || code === SQLITE_CORRUPT_VTAB) return false;
  return [SQLITE_CORRUPT, SQLITE_NOTADB].includes(code & 0xff) || code === SQLITE_IOERR_READ || code === SQLITE_IOERR_SHORT_READ;
}

/** FileMaker's "Unable to open file"; the message names the file and what to do, never a path. */
export class FileDamaged extends StoreError {
  readonly detail: string;
  constructor(file: string, detail: string) {
    super(802, `${file} is damaged (${detail}) and is not being served. Restore it from a backup; "tabularius doctor" names the damage.`);
    this.detail = detail;
  }
}

/**
 * The disk holding the file is full or cannot be written. The file itself is sound (SQLite rolled the write back), so
 * it stays in use; the request that hit this is told what is wrong rather than "Unknown error".
 */
export class DiskTrouble extends StoreError {
  readonly detail: string;
  constructor(file: string, full: boolean, detail: string) {
    super(-1, `${full ? `${file} could not be written: the disk is full` : `${file} could not be written: the disk reported an error (${detail})`}. Nothing from this request was saved. Free some space or check the disk; the file itself is not damaged.`);
    this.detail = detail;
  }
}

/** The file cannot be written by the user running the server, or was moved or deleted while open. */
export class FileReadOnly extends StoreError {
  constructor(file: string, moved: boolean) {
    super(-1, moved
      ? `${file} was moved or deleted while the server had it open, so nothing can be saved to it. Put it back, or restart the server.`
      : `${file} is read-only for the user running the server, so nothing can be saved to it. Give that user write access to the file and to its folder.`);
  }
}

export interface DamageWatch {
  /** Set once a query has found damage. */
  damage?: FileDamaged;
  /** Called once, with the first damage found. */
  onDamage?: (damage: FileDamaged) => void;
  /** Called each time a write fails for want of disk (the host keeps the log from filling). */
  onDiskTrouble?: (trouble: DiskTrouble) => void;
}

/**
 * Watches a connection for damage. The connection's methods are replaced on the object itself, so nothing else about
 * it changes. After the first damage every call throws the same error without touching the file again.
 */
export function watchDatabase(db: DatabaseSync, file: string, watch: DamageWatch): DatabaseSync {
  const judge = (e: unknown): unknown => {
    if (watch.damage) return watch.damage;
    const code = (e as { errcode?: unknown }).errcode;
    if (e instanceof Error && typeof code === 'number' && !isDamageError(e) && [SQLITE_FULL, SQLITE_IOERR].includes(code & 0xff)) {
      const trouble = new DiskTrouble(file, (code & 0xff) === SQLITE_FULL, e.message.replace(/[\r\n]+/g, ' ').slice(0, 120));
      watch.onDiskTrouble?.(trouble);
      return trouble;
    }
    if (e instanceof Error && typeof code === 'number' && (code & 0xff) === SQLITE_READONLY) return new FileReadOnly(file, code === SQLITE_READONLY_DBMOVED);
    if (!isDamageError(e)) return e;
    watch.damage = new FileDamaged(file, ((e as Error).message || 'damaged pages').replace(/[\r\n]+/g, ' ').slice(0, 120));
    // Not inside the failing statement: the host closes this connection, which must not happen under a running query.
    const found = watch.damage;
    setImmediate(() => watch.onDamage?.(found));
    return watch.damage;
  };
  const guarded = <A extends unknown[], R>(self: object, fn: (...a: A) => R): ((...a: A) => R) => (...a) => {
    if (watch.damage) throw watch.damage;
    try { return fn.apply(self, a); } catch (e) { throw judge(e); }
  };
  const prepare = db.prepare.bind(db);
  const exec = db.exec.bind(db);
  (db as { exec: unknown }).exec = guarded(db, exec);
  (db as { prepare: unknown }).prepare = (sql: string): StatementSync => {
    if (watch.damage) throw watch.damage;
    let stmt: StatementSync;
    try { stmt = prepare(sql); } catch (e) { throw judge(e); }
    for (const m of ['all', 'get', 'run'] as const) {
      (stmt as unknown as Record<string, unknown>)[m] = guarded(stmt, (stmt[m] as (...a: unknown[]) => unknown).bind(stmt));
    }
    const iterate = stmt.iterate.bind(stmt);
    (stmt as { iterate: unknown }).iterate = function* (...a: unknown[]) {
      if (watch.damage) throw watch.damage;
      try { yield* iterate(...(a as [])); } catch (e) { throw judge(e); }
    };
    return stmt;
  };
  return db;
}
