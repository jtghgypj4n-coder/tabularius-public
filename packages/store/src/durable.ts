import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { cleanupPath, openSync, renameSync, writeFileSync } from './fs-boundary.ts';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve, win32, posix } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { retryFileSync } from './file-ops.ts';

/** Injectable operations for testing the durability boundary and failure order. */
export interface DurableFs {
  statSync(path: string): { isDirectory(): boolean };
  openSync(path: string, flags: string): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
}
const disk: DurableFs = { statSync, openSync, fsyncSync, closeSync, renameSync };

export function syncPath(path: string, fs: DurableFs = disk, platform: NodeJS.Platform = process.platform): void {
  const directory = fs.statSync(path).isDirectory();
  if (directory && platform === 'win32') return;
  try {
    const fd = fs.openSync(directory && fs === disk ? realpathSync(path) : path, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch (error) {
    if (!directory || !['EPERM', 'EISDIR', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}

/** Publish a completed file only after flushing it, then persist its directory entry. */
export function writeDurable(staged: string, target: string, fs: DurableFs = disk, platform: NodeJS.Platform = process.platform, wait?: (ms: number) => void): void {
  const paths = platform === 'win32' ? win32 : posix;
  syncPath(staged, fs, platform);
  retryFileSync(() => fs.renameSync(staged, target), platform, wait);
  syncPath(paths.dirname(target), fs, platform);
  if (paths.dirname(staged) !== paths.dirname(target)) syncPath(paths.dirname(staged), fs, platform);
}

/** Same-directory, exclusive temporary file: readers see either complete version. */
export function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, 'wx', 0o600);
  const cleanup = cleanupPath(tmp);
  let failed = false;
  try {
    try { writeFileSync(fd, data); } finally { closeSync(fd); }
    writeDurable(tmp, path);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    cleanup({ throwOnError: !failed });
  }
}

const damagedStates = new Map<string, { hash: string; message: string; cause: unknown }>();

export interface StateWriteOptions {
  platform?: NodeJS.Platform;
  /** Redact parse diagnostics and keep recovery copies private for credential state. */
  sensitive?: boolean;
  mode?: number;
  /** How long to wait for another process's write to the same file; default 30 s. */
  lockWaitMs?: number;
}

const LOCK_WAIT_MS = 30_000;
const SQLITE_BUSY = 5;
const SQLITE_READONLY = 8;
const SQLITE_NOTADB = 26;
const held = new Map<string, number>();

/** The same lock reached through a symlink or another spelling must share one entry. */
function lockKey(lock: string): string {
  try { return realpathSync(lock); } catch { /* not made yet */ }
  try { return join(realpathSync(dirname(lock)), basename(lock)); } catch { return resolve(lock); }
}

/** Run a locked action, refusing one that would carry on after the lock is released. */
function runLocked<T>(action: () => T): T {
  const result = action();
  if (typeof (result as { then?: unknown } | null)?.then === 'function') {
    throw new Error('withStateLock needs a synchronous action: the lock is released when it returns, before a promise settles');
  }
  return result;
}

/** Explain a failure to open or take the lock, naming both files and what to do. */
function lockError(e: unknown, file: string, lock: string, waitMs: number): Error {
  const code = ((e as { errcode?: number }).errcode ?? 0) & 0xff;
  const dir = dirname(lock);
  if (code === SQLITE_BUSY) return Object.assign(new Error(`Timed out after ${waitMs} ms waiting to write ${file}: another tabularius process is writing it`, { cause: e }), { code: 'STATE_LOCK_TIMEOUT' });
  if (code === SQLITE_READONLY) {
    return new Error(`${lock} is read-only, so it can't lock ${file}: make it writable by the user Tabularius runs as (chown/chmod), or delete it while Tabularius is stopped`, { cause: e });
  }
  // A damaged lock file is never replaced automatically: another process may still have it open, and a new file would split the lock.
  if (code === SQLITE_NOTADB) return new Error(`${lock} is damaged, so it can't lock ${file}: delete it while Tabularius is stopped; it is made again on the next write`, { cause: e });
  if (!existsSync(dir)) return Object.assign(new Error(`couldn't lock ${file}: the folder ${dir} does not exist`, { cause: e }), { code: 'ENOENT' });
  return new Error(`couldn't open the lock file ${lock} for ${file} (${(e as Error).message}): ${dir} must be writable by the user Tabularius runs as, and ${lock} a file it can write (delete it while Tabularius is stopped)`, { cause: e });
}

/** Hold an exclusive cross-process lock while reading and replacing one JSON state file.
 *
 * The lock is a SQLite `BEGIN EXCLUSIVE` on a sidecar `<file>.lock.db` that is never written.
 * The OS drops SQLite's file lock when the holder exits or is killed, on every platform and
 * across containers, so there is nothing to reclaim. Nested calls for the same file in this
 * process run inside the outer lock. The action must be synchronous.
 */
/** A lock action's result: never a promise, because the lock is released when the action returns. */
export type Synchronous<T> = T extends PromiseLike<unknown> ? never : T;

export function withStateLock<T>(file: string, action: () => Synchronous<T>, waitMs = LOCK_WAIT_MS): T {
  const lock = `${file}.lock.db`;
  const key = lockKey(lock);
  const depth = held.get(key) ?? 0;
  if (depth > 0) {
    held.set(key, depth + 1);
    try { return runLocked(action); }
    finally { held.set(key, depth); }
  }
  const deadline = performance.now() + waitMs;
  let db: DatabaseSync | undefined;
  try {
    try {
      db = new DatabaseSync(lock);
      db.exec(`PRAGMA busy_timeout = ${waitMs}`);
      // Holding the lock never writes a page, so no journal file is needed.
      db.exec('PRAGMA journal_mode = MEMORY');
      db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.ceil(deadline - performance.now()))}`);
      db.exec('BEGIN EXCLUSIVE');
      // SQLite opens a file it can't write read-only, and then BEGIN EXCLUSIVE excludes nobody.
      // A write inside the transaction fails there; here it stays in memory and is rolled back on close.
      db.exec('PRAGMA user_version = 0');
    } catch (e) {
      throw lockError(e, file, lock, waitMs);
    }
    held.set(key, 1);
    try { return runLocked(action); }
    finally { held.delete(key); }
  } finally {
    db?.close();
  }
}

const activeStateTemps = new Set<string>();
const sweptStateDirs = new Set<string>();
export const STATE_TEMP_MAX_AGE_MS = 60 * 60 * 1000;

/** CLI stores and state outside the hosted root get the same startup cleanup on first use. */
function sweepStateDirectoryOnce(file: string): void {
  const dir = dirname(file), key = lockKey(dir);
  if (sweptStateDirs.has(key)) return;
  sweptStateDirs.add(key);
  try { sweepStateTempsSync(dir); }
  catch (e) { console.warn(`Could not sweep state directory ${dir}: ${(e as Error).message}`); }
}

/** Sweep only our exclusive staging names. Live foreign PIDs and active local writes are retained.
 * A matching own PID alone is not ownership: it can have been reused after a crash or container restart.
 */
export function sweepStateTempsSync(dir: string, now = Date.now(), maxAge = STATE_TEMP_MAX_AGE_MS): string[] {
  const removed: string[] = [];
  try {
    if (lstatSync(dir).isSymbolicLink()) return removed;
    for (const name of readdirSync(dir)) {
      const match = /^\..+\.([1-9][0-9]*)\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/.exec(name);
      if (!match) continue;
      const path = join(dir, name);
      if (activeStateTemps.has(lockKey(path))) continue;
      try {
        const st = lstatSync(path);
        if (!st.isFile() || st.mtimeMs >= now - maxAge) continue;
        const pid = Number(match[1]);
        if (!Number.isSafeInteger(pid)) continue;
        if (pid !== process.pid) {
          try { process.kill(pid, 0); continue; }
          catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
        }
        unlinkSync(path);
        removed.push(path);
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  return removed;
}

/** Replace a state file without exposing a partial document, and flush the file and (when supported) its directory. */
export function writeStateFileSync(file: string, data: string | Uint8Array, options: StateWriteOptions = {}): void {
  sweepStateDirectoryOnce(file);
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  let cleanup = () => {};
  const tempKey = lockKey(tmp);
  activeStateTemps.add(tempKey);
  try {
    fd = openSync(tmp, 'wx', options.mode ?? 0o600);
    cleanup = cleanupPath(tmp);
    writeFileSync(fd, data);
    fsyncSync(fd);
    const opened = fd;
    fd = undefined;
    closeSync(opened);
    retryFileSync(() => renameSync(tmp, file), options.platform);
    if ((options.platform ?? process.platform) !== 'win32') {
      let dirFd: number | undefined;
      try {
        dirFd = openSync(realpathSync(dirname(file)), 'r');
        fsyncSync(dirFd);
      } catch (e) {
        console.warn(`Could not sync state directory ${dirname(file)}: ${(e as Error).message}`);
      } finally {
        if (dirFd !== undefined) {
          try { closeSync(dirFd); }
          catch (e) { console.warn(`Could not close state directory ${dirname(file)}: ${(e as Error).message}`); }
        }
      }
    }
  } catch (e) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* preserve the original failure and still remove the temporary file */ }
    }
    try { cleanup(); } catch { /* preserve the original failure */ }
    throw e;
  } finally {
    activeStateTemps.delete(tempKey);
  }
}

/** Preserve malformed state once per distinct content before reporting it; never silently turn it into an empty value. */
export function readJsonStateSync<T>(file: string, options: Pick<StateWriteOptions, 'sensitive' | 'platform'> = {}): T {
  sweepStateDirectoryOnce(file);
  let bytes: string;
  try { bytes = readFileSync(file, 'utf8'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      damagedStates.delete(file);
      throw e;
    }
    throw new Error(`${file} could not be read: ${(e as Error).message}`, { cause: e });
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  const cached = damagedStates.get(file);
  const damaged = `${file}.damaged-${hash}`;
  const privateError = () => new Error(`${basename(file)} could not be read: not valid JSON`, { cause: new SyntaxError('Invalid JSON') });
  if (cached?.hash === hash) {
    if (options.sensitive) {
      if ((options.platform ?? process.platform) !== 'win32') {
        try { chmodSync(damaged, 0o600); }
        catch (e) {
          // The operator may have removed the recovery copy since the first read.
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
      }
      throw privateError();
    }
    throw new Error(cached.message, { cause: cached.cause });
  }
  try {
    const value = JSON.parse(bytes.replace(/^\uFEFF/, '')) as T;
    damagedStates.delete(file);
    return value;
  }
  catch (e) {
    const error = options.sensitive ? privateError() : new Error(`${file} could not be read: not valid JSON (${(e as Error).message})`, { cause: e });
    try { writeFileSync(damaged, bytes, { flag: 'wx', ...(options.sensitive ? { mode: 0o600 } : {}) }); }
    catch (copyError) {
      if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error(`${file} could not be read: ${(copyError as Error).message}`, { cause: error.cause });
    }
    if (options.sensitive && (options.platform ?? process.platform) !== 'win32') chmodSync(damaged, 0o600);
    damagedStates.set(file, { hash, message: error.message, cause: error.cause });
    throw error;
  }
}

export function writeJsonStateSync(file: string, value: unknown, options: StateWriteOptions = {}): void {
  writeStateFileSync(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

/** Synchronously read, transform, and atomically replace state under a cross-process lock. */
export function updateJsonStateSync<T>(file: string, fallback: T, update: (current: T) => T, options: StateWriteOptions = {}): T {
  return withStateLock<T>(file, () => {
    let current: T;
    try { current = readJsonStateSync<T>(file, options); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      current = fallback;
    }
    const next = update(current);
    writeJsonStateSync(file, next, options);
    return next as Synchronous<T>;
  }, options.lockWaitMs);
}
