// Backups of a hosted folder, safe while the server runs.
//
// Each run writes a backup set: Backups/2026-10-11_174500/<name>.openhbam.sqlite
// for every hosted file, made with SQLite's online backup (so users keep
// working) and checked before the set is kept. Container files are inside the
// databases, except those FileMaker stored externally, which go into the set
// beside them (backup-external.ts). Older sets beyond `keep` are
// removed, oldest first, like FileMaker Server's backup schedules.
//
// Point-in-time backups (FileMaker Server's progressive backups): the server
// saves each file's changes into the newest set as it takes them (logs.ts),
// in log files under <set>/progressive/<name>/, a new one every few minutes,
// so a file can be put back as it was at any moment they were taken: the
// set's copy, then the logs in order. Each set records when each file's copy
// was finished (backup.json), since logs only follow a copy they postdate.
//
// With a passphrase (TABULARIUS_BACKUP_KEY), every copy and log is encrypted
// (AES-256-GCM): copies as <name>.openhbam.sqlite.enc once made, and each
// log as it is written (<time>.log.enc). Restoring needs the same passphrase.

import { cancellationScope } from '../../scripts/src/cancellation.ts';
import { crashPoint } from '../../store/src/crash-point.ts';
import { isDamageError } from '../../store/src/damage.ts';
import { refuseNewer, storedFormat } from '../../store/src/store-format.ts';
import { DatabaseSync, backup } from 'node:sqlite';
import { accessSync, constants, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { STORE_EXT } from './host.ts';
import type { Host } from './host.ts';
import { decryptFile, encryptFile, ENCRYPTED_EXT } from './encrypt.ts';
import { copyVerifiedDatabase, integrity, describeCheck, describeRestore, verifySet, recordChecksum, restoreTestDue, testRestore, verifyAfterBackup } from './backup-verify.ts';
import type { SetCheck } from './backup-verify.ts';
import { backupExternal, externalFiles, externalManifest, stageExternal } from './backup-external.ts';
import { freeBytes, sizeText } from './disk.ts';
import type { StatFs } from './disk.ts';
import { LogShipper, applyLog, logReader, logRecords, startLog, writeLog } from './logs.ts';
import type { LogFollower, LogWriter } from './logs.ts';
import { backupInventory, checkedBackupCopies } from './backup-inventory.ts';
import { readBackupInfo, updateBackupInfo, writeBackupInfo } from './backup-info.ts';
import { sweepStateTempsSync, writeDurable } from '../../store/src/durable.ts';
import { commitRestore, recoverRestore } from './restore-files.ts';

const SET = /^\d{4}-\d{2}-\d{2}_\d{6}$/;
const PID_FILE = '.openhbam.pid';
// Temporary pid file name while claiming; a template so the sweep pattern below derives from it.
const pidTmpName = (id: string): string => `.openhbam-pid-${id}.tmp`;
const PID_TMP_RE = new RegExp(`^${pidTmpName('[a-f0-9-]{36}').replaceAll('.', '\\.')}$`);
const restoringFolders = new Set<string>();
const localClaims = new Map<string, { count: number; purpose: 'server' | 'restore'; ino: number }>();

export interface BackupResult {
  dir: string;
  files: string[];
  removed: string[];
}

function stamp(d = new Date(), ms = false): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${ms ? '.' + String(d.getMilliseconds()).padStart(3, '0') : ''}`;
}

/** Advance the sortable folder label as a calendar value, even if the host clock moved backwards. */
function afterStamp(label: string): string {
  const y = Number(label.slice(0, 4));
  const mo = Number(label.slice(5, 7));
  const day = Number(label.slice(8, 10));
  const h = Number(label.slice(11, 13));
  const mi = Number(label.slice(13, 15));
  const s = Number(label.slice(15, 17));
  const milliseconds = label.includes('.') ? Number(label.slice(18, 21)) : undefined;
  const next = new Date(Date.UTC(y, mo - 1, day, h, mi, s, (milliseconds ?? 0) + (milliseconds === undefined ? 1000 : 1)));
  const iso = next.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${milliseconds === undefined ? '' : iso.slice(19, 23)}`;
}

/** Where backups of a hosted folder go unless told otherwise. */
export function defaultBackupDir(folder: string): string {
  return join(folder, 'Backups');
}

/** Backup sets in a backup folder, oldest first. */
export function backupSets(dest: string): string[] {
  if (!existsSync(dest)) return [];
  return readdirSync(dest).filter((n) => SET.test(n) && statSync(join(dest, n)).isDirectory()).sort();
}

/** The passphrase backups are encrypted with, if one is set. */
export function backupKey(): string | undefined {
  return process.env.TABULARIUS_BACKUP_KEY || undefined;
}

/** A backup file's name without the encrypted ending. */
const plain = (f: string) => f.endsWith(ENCRYPTED_EXT) ? f.slice(0, -ENCRYPTED_EXT.length) : f;

/** The file at `path`, or its encrypted copy, whichever the backup holds. */
function stored(path: string): string | undefined {
  return existsSync(path) ? path : existsSync(path + ENCRYPTED_EXT) ? path + ENCRYPTED_EXT : undefined;
}

/** Replaces a backup file with its encrypted copy. */
async function seal(path: string, passphrase: string): Promise<void> {
  crashPoint('backup:seal-before');
  await encryptFile(path, path + ENCRYPTED_EXT + '.partial', passphrase);
  crashPoint('backup:seal-after-encrypt');
  writeDurable(path + ENCRYPTED_EXT + '.partial', path + ENCRYPTED_EXT);
  crashPoint('backup:seal-after-publish');
  rmSync(path);
  crashPoint('backup:seal-after-remove');
}

/** Puts a backup file at `to`, decrypting it if it is encrypted. */
async function unseal(from: string, to: string, passphrase: string | undefined): Promise<void> {
  if (!from.endsWith(ENCRYPTED_EXT)) return copyFileSync(from, to);
  if (!passphrase) throw new Error(`${from} is encrypted: set TABULARIUS_BACKUP_KEY to its passphrase`);
  await decryptFile(from, to, passphrase);
}

/** "2026-10-11_174500" or "2026-10-11_174500.123" as a time. */
function parseStamp(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:\.(\d{3}))?/.exec(text);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +(m[7] ?? 0)).getTime();
}

/** When each file's copy in a set was finished (epoch ms); older sets without the record count from their name. */
function finishedTimes(setDir: string): Record<string, number> {
  const info = readBackupInfo<{ finished?: Record<string, string> }>(setDir, true);
  const at = parseStamp(basename(setDir));
  return Object.fromEntries(backupInventory(setDir, true).copies.map(plain).map((f) => [f, info.finished?.[f] ? Date.parse(info.finished[f]) : at]));
}

function recordFinished(setDir: string, file: string, at: number): void {
  updateBackupInfo<{ finished?: Record<string, string> }>(setDir, (info) => {
    info.finished = { ...info.finished, [file]: new Date(at).toISOString() };
  });
}

/**
 * Backs up every hosted database in `folder` into a new set under `dest`,
 * keeping the newest `keep` sets; encrypted when there is a passphrase.
 */
export function backupFolder(folder: string, dest = defaultBackupDir(folder), keep = 7, passphrase = backupKey(), options: { now?: () => number; stoppable?: boolean; signal?: AbortSignal; statfs?: StatFs } = {}): Promise<BackupResult> {
  // One at a time per destination (a scheduled backup and "Back up now" at once would pick the same name).
  const key = resolve(dest);
  // A backup the administrator may stop (the scheduled ones and Back up now; not the one taken before a restore).
  const stop = options.stoppable ? new AbortController() : undefined;
  if (stop) stoppable.add(stop);
  const scope = cancellationScope([stop?.signal, options.signal]);
  const run = (backingUp.get(key) ?? Promise.resolve()).then(() => backupOnce(folder, dest, keep, passphrase, options.now ?? Date.now, scope.signal, options.statfs)).finally(() => {
    scope.dispose();
    if (stop) stoppable.delete(stop);
  });
  const done: Promise<void> = run.then(() => {}, () => {}).then(() => {
    if (backingUp.get(key) === done) backingUp.delete(key);
  });
  backingUp.set(key, done);
  return run;
}

const backingUp = new Map<string, Promise<void>>();
const stoppable = new Set<AbortController>();

/** A backup the administrator stopped: its half-made set is removed and no old set is pruned. */
export class BackupStopped extends Error {
  constructor() {
    super('The backup was stopped');
  }
}

/** Stops the backups that are running or waiting; each ends after the file it is copying. How many were stopped. */
export function stopBackups(): number {
  const n = stoppable.size;
  for (const c of stoppable) c.abort();
  return n;
}

/** Whether a stoppable backup is running or waiting its turn. */
export function backupRunning(): boolean {
  return stoppable.size > 0;
}

async function backupOnce(folder: string, dest: string, keep: number, passphrase: string | undefined, now: () => number, signal?: AbortSignal, statfs?: StatFs): Promise<BackupResult> {
  const check = () => {
    if (signal?.aborted) throw new BackupStopped();
  };
  check();
  const names = readdirSync(folder).filter((f) => f.endsWith(STORE_EXT));
  const previous = backupSets(dest).at(-1);
  // Before anything is made: a backup that cannot fit would fill the disk the files themselves are on.
  checkRoom(folder, names, dest, previous && join(dest, previous), statfs);
  const latest = previous;
  let name = stamp(new Date(now()));
  if (latest && name <= latest) name = afterStamp(latest);
  while (existsSync(join(dest, name)) || existsSync(join(dest, `${name}.partial`))) name = afterStamp(name);
  const partial = join(dest, `${name}.partial`);
  mkdirSync(partial, { recursive: true });
  try {
    writeBackupInfo(partial, { finished: {}, sha256: {} });
    for (const f of names) {
      check();
      const src = new DatabaseSync(join(folder, f), { readOnly: true });
      try {
        await backup(src, join(partial, f), { rate: 100, progress: () => { check(); return 100; } });
        check();
      } finally {
        src.close();
      }
      crashPoint('backup:after-copy');
      recordFinished(partial, f, Date.now());
      const copy = new DatabaseSync(join(partial, f), { readOnly: true });
      try {
        const quick = copy.prepare('PRAGMA quick_check').get() as Record<string, string>;
        if (Object.values(quick)[0] !== 'ok') throw new Error(`backup of ${f} failed its check: ${Object.values(quick)[0]}`);
      } finally {
        copy.close();
        // Opening it to check leaves empty log files; the copy is complete without them.
        for (const ext of ['-wal', '-shm']) rmSync(join(partial, f + ext), { force: true });
      }
      crashPoint('backup:after-verify');
      if (passphrase) await seal(join(partial, f), passphrase);
      // What later checks compare the copy against.
      await recordChecksum(partial, f, stored(join(partial, f))!);
    }
    check();
    await backupExternal(folder, names.map((f) => f.slice(0, -STORE_EXT.length)), partial, previous && join(dest, previous), passphrase, signal);
    check();
    crashPoint('backup:after-external');
    const verified = await verifySet(partial, passphrase);
    if (!verified.ok) throw new Error(describeCheck(name, verified));
    check();
    // A set appears under its final name only once every file in it is good.
    renameSync(partial, join(dest, name));
    crashPoint('backup:after-publish');
  } catch (e) {
    rmSync(partial, { recursive: true, force: true });
    throw e;
  }
  const sets = backupSets(dest);
  const removed = keep > 0 ? sets.slice(0, Math.max(0, sets.length - keep)) : [];
  for (const old of removed) rmSync(join(dest, old), { recursive: true, force: true });
  crashPoint('backup:after-prune');
  return { dir: join(dest, name), files: names, removed };
}

/** Room a backup needs beyond the files' own size: the checks and the copies' own overhead. */
const ROOM_MARGIN = 1.1;

/**
 * About what a backup of these files adds to the disk: the stores (with their write-ahead logs) and the container
 * files that changed since the previous set (the others are linked to it).
 */
export function backupNeeds(folder: string, names: string[], previousSet?: string): number {
  const size = (f: string) => { try { return statSync(f).size; } catch { return 0; } };
  let bytes = 0;
  for (const f of names) bytes += size(join(folder, f)) + size(join(folder, f + '-wal'));
  const before = previousSet ? externalManifest(previousSet) : {};
  for (const rel of externalFiles(folder, names.map((f) => f.slice(0, -STORE_EXT.length)))) {
    const file = join(folder, ...rel.split('/'));
    try {
      const st = statSync(file);
      const old = before[rel];
      if (!(old && old.size === st.size && old.mtimeMs === st.mtimeMs)) bytes += st.size;
    } catch { /* gone meanwhile */ }
  }
  return bytes;
}

/** Refuses a backup the destination cannot hold, saying how much it needs and how much is free. */
function checkRoom(folder: string, names: string[], dest: string, previousSet: string | undefined, statfs?: StatFs): void {
  const free = freeBytes(dest, statfs);
  if (free === undefined) return;
  const needs = Math.ceil(backupNeeds(folder, names, previousSet) * ROOM_MARGIN);
  if (needs > free) throw new Error(`not enough free disk space for a backup in ${dest}: it needs about ${sizeText(needs)} free, ${sizeText(free)} available`);
}

/** "30m", "6h", "1d" or plain minutes, in milliseconds. */
export function parseInterval(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|d)?$/i.exec(text.trim());
  if (!m) throw new Error(`can't read interval "${text}": use 30m, 6h or 1d`);
  const unit = (m[2] ?? 'm').toLowerCase();
  const ms = Number(m[1]) * (unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000);
  if (ms < 60_000) throw new Error('backups can run at most once a minute');
  return ms;
}

/**
 * Runs backups every `every` ms. The first one is due an interval after the
 * newest existing set, so restarting the server doesn't skip or repeat one.
 */
export interface BackupSchedule {
  every: number;
  keep: number;
  dest: string;
  /** When the next backup is due (epoch ms). */
  nextAt(): number | undefined;
  /** The last scheduled run's outcome. */
  last?: { at: number; ok: boolean; message: string };
  /** The last scheduled set's check (backup-verify.ts). */
  check?: SetCheck;
  stop(): void;
}

export function scheduleBackups(folder: string, opts: { every: number; dest?: string; keep?: number; log?: (m: string) => void; onSet?: (dir: string) => void }): BackupSchedule {
  const log = opts.log ?? (() => {});
  let timer: NodeJS.Timeout | undefined;
  let due: number | undefined;
  let stopped = false;
  const keep = opts.keep ?? 7;
  // `dest` is read afresh each run, so the console can move it while the server runs.
  const schedule: BackupSchedule = {
    every: opts.every, keep, dest: opts.dest ?? defaultBackupDir(folder),
    nextAt: () => due,
    stop: () => {
      stopped = true;
      due = undefined;
      clearTimeout(timer);
    },
  };
  const run = async () => {
    due = undefined;
    const dest = schedule.dest;
    try {
      const r = await backupFolder(folder, dest, keep, undefined, { stoppable: true });
      const message = `${r.files.length} files to ${r.dir}${r.removed.length ? `, removed ${r.removed.length} old` : ''}`;
      log(`backup: ${message}`);
      opts.onSet?.(r.dir);
      // Read back before it counts as good, and one older set checked again.
      const check = await verifyAfterBackup(dest, basename(r.dir), log);
      schedule.check = check;
      // Once a day, a good set is also restored to a scratch folder and opened, as a test.
      if (check.ok && restoreTestDue(dest)) {
        const restored = await testRestore(r.dir);
        log(describeRestore(basename(r.dir), restored));
      }
      schedule.last = check.ok ? { at: Date.now(), ok: true, message } : { at: Date.now(), ok: false, message: `${message}, but it failed its check` };
    } catch (e) {
      schedule.last = { at: Date.now(), ok: false, message: (e as Error).message };
      log(`backup failed: ${(e as Error).message}`);
    }
    if (!stopped) next(opts.every);
  };
  const next = (ms: number) => {
    due = Date.now() + ms;
    timer = setTimeout(run, ms);
    timer.unref();
  };
  const newest = backupSets(schedule.dest).at(-1);
  const age = newest ? Date.now() - statSync(join(schedule.dest, newest)).mtimeMs : Infinity;
  next(Math.max(0, Math.min(opts.every, opts.every - age)));
  return schedule;
}

/** One key per folder however it is named: symlinks are followed and, on case-insensitive disks, case is folded. */
function folderKey(folder: string): string {
  try {
    return realpathSync.native(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolve(folder);
    throw error;
  }
}

/** The process hosting or restoring the folder that a restore must wait for, if any. */
function hostingProcess(folder: string): number | undefined {
  if (localClaims.has(folderKey(folder))) return process.pid;
  const pid = runningServer(folder);
  // As in claimFolder, a file naming our own pid with no claim of ours behind it is left from an earlier process.
  return pid === process.pid ? undefined : pid;
}

/** Exclusively claims a folder before recovery or opening any of its files. */
export function claimFolder(folder: string, purpose: 'server' | 'restore' = 'server'): () => void {
  const key = folderKey(folder);
  const existing = localClaims.get(key);
  if (existing) {
    if (existing.purpose === 'restore' || purpose === 'restore') {
      throw new Error(`${folder} is already hosted by process ${process.pid}`);
    }
    existing.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = localClaims.get(key);
      if (current && --current.count === 0) {
        localClaims.delete(key);
        releasePidFile(folder, current.ino);
      }
    };
  }
  const file = join(folder, PID_FILE);
  const pending = join(folder, pidTmpName(randomUUID()));
  let ino: number;
  try {
    // Publish a complete pid file atomically. An empty exclusive file would
    // look stale to another claimant until its write finished.
    try {
      writeFileSync(pending, String(process.pid), { flag: 'wx' });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') throw new Error(`${folder} can't be written by the user running Tabularius, so it can't be hosted. Give that user write access to the folder (a read-only disk must be mounted read-write).`);
      if (code === 'ENOSPC') throw new Error(`the disk holding ${folder} is full, so the server can't start. Free some space and start again.`);
      throw error;
    }
    ino = statSync(pending).ino;
    // Every claim is decided under one lock, so two claimants can't both judge
    // the folder free. It lives beside the pid file so CLI restores and server
    // startup use the same lock path; SQLite releases it if a claimant crashes.
    const lockPath = join(folder, '.openhbam-claim.sqlite');
    // A read-only lock db (created by root, say) opens without error but BEGIN EXCLUSIVE then excludes nobody.
    const notWritable = new Error(`${lockPath} must be writable by the user running Tabularius`);
    try {
      accessSync(lockPath, constants.W_OK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw notWritable;
    }
    const lock = new DatabaseSync(lockPath);
    try {
      lock.exec('PRAGMA busy_timeout = 10000');
      try {
        lock.exec('BEGIN EXCLUSIVE');
      } catch (error) {
        // SQLITE_BUSY after the wait: another claimant held the lock throughout.
        if ((error as { errcode?: number }).errcode === 5) throw new Error(`${folder} is already hosted or being restored by another process`);
        throw error;
      }
      try {
        // Fails on a read-only connection, where the lock above would not exclude anyone.
        lock.exec('PRAGMA user_version = 1');
      } catch {
        throw notWritable;
      }
      try {
        linkSync(pending, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const pid = runningServer(folder);
        // Our own pid is never a live rival: claims made by this process are
        // in localClaims, so a file naming it is left from an earlier process
        // with the same pid (a container's server is always pid 1).
        if (pid !== undefined && pid !== process.pid) throw new Error(`${folder} is already hosted by process ${pid}`);
        // Rename replaces the stale file in one step, so readers never see the folder unclaimed.
        renameSync(pending, file);
      }
      lock.exec('COMMIT');
    } catch (claimError) {
      if (lock.isOpen && lock.isTransaction) lock.exec('ROLLBACK');
      throw claimError;
    } finally {
      lock.close();
    }
  } finally {
    rmSync(pending, { force: true });
  }
  try {
    sweepCrashLeftovers(folder);
    if (purpose === 'restore') restoringFolders.add(key);
  } catch (error) {
    releasePidFile(folder, ino);
    throw error;
  }
  localClaims.set(key, { count: 1, purpose, ino });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = localClaims.get(key);
    if (!current || --current.count > 0) return;
    localClaims.delete(key);
    if (current.purpose === 'restore') restoringFolders.delete(key);
    releasePidFile(folder, current.ino);
  };
}

/** Removes the pid file only while it is still the one this claim published. */
function releasePidFile(folder: string, ino: number): void {
  const file = join(folder, PID_FILE);
  try {
    if (statSync(file).ino !== ino || readFileSync(file, 'utf8') !== String(process.pid)) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  rmSync(file, { force: true });
}

/** The process id of a server hosting the folder, if one is running. */
export function runningServer(folder: string): number | undefined {
  const file = join(folder, PID_FILE);
  if (!existsSync(file)) return undefined;
  const pid = Number(readFileSync(file, 'utf8'));
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' ? pid : undefined;
  }
}

/** Crash remnants are expendable only after a day and while no other server owns the folder. */
export const LEFTOVER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export function sweepCrashLeftovers(folder: string, dest = defaultBackupDir(folder), now = Date.now(), maxAge = LEFTOVER_MAX_AGE_MS): string[] {
  const pid = runningServer(folder);
  if ((pid !== undefined && pid !== process.pid) || restoringFolders.has(folderKey(folder))) return [];
  recoverRestore(folder);
  const removed = [...sweepStateTempsSync(folder, now), ...sweepStateTempsSync(dest, now)];
  const cutoff = now - maxAge;
  const old = (path: string): boolean => {
    try {
      const st = lstatSync(path);
      if (st.isSymbolicLink() || st.mtimeMs >= cutoff) return false;
      return !st.isDirectory() || readdirSync(path).every((name) => old(join(path, name)));
    } catch (error) {
      // Another claimant can remove its temporary pid file during the scan.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  };
  const sweep = (dir: string, match: (name: string) => boolean): void => {
    if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (match(name) && old(path)) {
        rmSync(path, { recursive: true, force: true });
        removed.push(path);
      }
    }
  };
  sweep(folder, (name) => PID_TMP_RE.test(name) || /^\.standby-copy-[a-f0-9]+\.tmp$/.test(name) ||
    name.endsWith(STORE_EXT + '.standby-partial') || /\.restoring(?:\.enc|-wal|-shm)?$/.test(name));
  for (const sub of ['RC_Data_FMS', 'Files']) sweep(join(folder, sub), (name) => name.endsWith('.restoring'));
  sweep(dest, (name) => name.endsWith('.partial') && SET.test(name.slice(0, -'.partial'.length)));
  return removed;
}

/** Copies databases from a backup set back into the hosted folder. The server must be stopped. */
export async function restoreBackup(folder: string, set: string, only?: string, passphrase = backupKey(), options: RestoreOptions = {}): Promise<string[]> {
  const { signal } = options;
  signal?.throwIfAborted();
  // What was asked for is checked first, so a mistyped set is named as that, not as "the server is running".
  const src = resolve(set);
  if (!existsSync(src)) throw new Error(`no backup set at ${set}`);
  const files = checkedBackupCopies(src).filter((f) => !only || plain(f).toLowerCase() === (only + STORE_EXT).toLowerCase());
  if (!files.length) throw new Error(only ? `${only} is not in ${set}` : `no databases in ${set}`);
  const pid = hostingProcess(folder);
  if (pid !== undefined) throw new Error(`stop the server first (process ${pid} is hosting ${folder})`);
  const release = claimFolder(folder, 'restore');
  let external: Awaited<ReturnType<typeof stageExternal>> | undefined;
  try {
    // Validate every staged copy and container before replacing any live data.
    for (const f of files) {
      signal?.throwIfAborted();
      const next = join(folder, plain(f) + '.restoring');
      for (const ext of ['', '-wal', '-shm', ENCRYPTED_EXT]) rmSync(next + ext, { force: true });
      await copyVerifiedDatabase(join(src, f), next, passphrase, () => crashPoint('restore:after-copy'));
      const result = integrity(next, true);
      if (result !== 'ok') throw new Error(`${f}: ${result}`);
      crashPoint('restore:after-verify');
    }
    external = await stageExternal(src, folder, files.map((f) => plain(f).slice(0, -STORE_EXT.length)), passphrase, signal);
    signal?.throwIfAborted();
    crashPoint('restore:after-external');
    // Reconcile every staged database before atomic publication, so a
    // failure leaves all hosted databases and external containers untouched.
    const differences: AccountDifference[] = [];
    for (const f of files) {
      signal?.throwIfAborted();
      const target = join(folder, plain(f));
      retainCurrentCredentials(target, target + '.restoring');
      differences.push(...accountDifferences(plain(f), target, target + '.restoring'));
    }
    options.differences?.push(...differences);
    if (differences.length && options.refuseAccountChanges) throw new AccountChangesError(differences);
    commitRestore(folder, [
      ...files.flatMap((f) => {
        const target = join(folder, plain(f));
        return [{ staged: target + '.restoring', target }, ...['-wal', '-shm'].map((ext) => ({ target: target + ext }))];
      }),
      ...external.files,
    ]);
    return files.map(plain);
  } finally {
    try {
      external?.cleanup();
      for (const f of files) for (const ext of ['', '-wal', '-shm', ENCRYPTED_EXT]) rmSync(join(folder, plain(f) + '.restoring' + ext), { force: true });
    } finally {
      release();
    }
  }
}

// --- point-in-time backups ------------------------------------------------

/** Logs as saved by earlier versions: one log per file, named by its time. */
const OLD_LOG = /^\d{4}-\d{2}-\d{2}_\d{6}\.\d{3}\.wal(?:\.enc)?$/;
/** Files of logs, one started every interval, named by when it was started. */
const LOGS = /^\d{4}-\d{2}-\d{2}_\d{6}\.\d{3}\.log(?:\.enc)?$/;

export interface ProgressiveSchedule {
  every: number;
  /** The set the logs go into. */
  set(): string | undefined;
  /** The last time changes were saved (epoch ms) and how it went. */
  last?: { at: number; ok: boolean; message: string; bytes: number };
  /** Logs go after this set's copies from now on (a full backup this server just made). */
  follow(setDir: string): void;
  /** Saves the changes now (also done on stop, so nothing since the last time is lost). */
  run(): void;
  stop(): void;
}

/**
 * Point-in-time backups of hosted files: makes a full backup set to start
 * from, then saves each file's changes into it as the server takes them
 * (every `every` ms, or more often when a standby follows too), starting a
 * new log file every `every` ms. Changes made by other processes (the CLI)
 * while the server runs are not covered.
 */
export async function scheduleProgressive(host: Host, opts: { every: number; dest?: string; keep?: number; log?: (m: string) => void; shipper?: LogShipper }): Promise<ProgressiveSchedule> {
  const dest = opts.dest ?? defaultBackupDir(host.dir);
  const log = opts.log ?? (() => {});
  const shipper = opts.shipper ?? new LogShipper(host, log);
  // From now on a file's log only empties once its changes are saved.
  for (const n of host.names()) shipper.follow(host.get(n)!);
  let base: Awaited<ReturnType<typeof backupFolder>>;
  try { base = await backupFolder(host.dir, dest, opts.keep ?? 7); }
  catch (e) { shipper.releaseIfIdle(); throw e; }
  let set = base.dir;
  log(`point-in-time backups every ${Math.round(opts.every / 60_000)} min, after ${set}`);
  /** Files whose copy is in the set, so their logs can follow it. */
  let inSet = new Set(Object.keys(finishedTimes(set)));
  const adding = new Set<string>();
  const current = new Map<string, LogWriter & { started: number }>();
  let bytes = 0;
  let failed: string | undefined;
  const addToSet = async (name: string) => {
    adding.add(name);
    try {
      const into = set;
      const file = name + STORE_EXT;
      await host.get(name)!.backup(join(into, file));
      recordFinished(into, file, Date.now());
      const key = backupKey();
      if (key) await seal(join(into, file), key);
      await recordChecksum(into, file, stored(join(into, file))!);
      if (into === set) inSet.add(file);
    } catch (e) {
      log(`point-in-time backup of ${name} failed: ${(e as Error).message}`);
    } finally {
      adding.delete(name);
    }
  };
  const follower: LogFollower = {
    every: opts.every,
    take: (store, data, at) => {
      const file = store.name + STORE_EXT;
      if (!existsSync(set)) {
        // Removed by a backup elsewhere keeping fewer sets: start it again with fresh copies.
        mkdirSync(set, { recursive: true });
        inSet = new Set();
        current.clear();
      }
      if (!inSet.has(file)) {
        // Hosted since this started (dropped into the folder): copy it into the set first, keeping its changes until then.
        if (!adding.has(store.name)) void addToSet(store.name);
        return false;
      }
      try {
        let cur = current.get(store.name);
        if (!cur || at - cur.started >= opts.every) {
          const dir = join(set, 'progressive', store.name);
          mkdirSync(dir, { recursive: true });
          const key = backupKey();
          // Encrypted as written, so no log is ever readable on disk.
          const latest = readdirSync(dir).filter((name) => LOGS.test(name)).sort().at(-1)?.slice(0, 21);
          let label = stamp(new Date(at), true);
          if (latest && label <= latest) label = afterStamp(latest);
          while (existsSync(join(dir, `${label}.log${key ? ENCRYPTED_EXT : ''}`))) label = afterStamp(label);
          cur = { ...startLog(join(dir, `${label}.log${key ? ENCRYPTED_EXT : ''}`), key), started: at };
          current.set(store.name, cur);
        }
        writeLog(cur, { at, seq: 0, data });
      } catch (e) {
        // Whatever part was written stays unread at the end of that file; the next changes start a new one.
        current.delete(store.name);
        failed = (e as Error).message;
        throw e;
      }
      bytes += data.length;
      return true;
    },
    shipped: () => {
      schedule.last = failed ? { at: Date.now(), ok: false, message: failed, bytes } : { at: Date.now(), ok: true, message: `${bytes} bytes of changes`, bytes };
      if (failed) log(`point-in-time backup failed: ${failed}`);
      bytes = 0;
      failed = undefined;
    },
  };
  const schedule: ProgressiveSchedule = {
    every: opts.every,
    set: () => set,
    follow: (dir) => {
      set = dir;
      inSet = new Set(Object.keys(finishedTimes(dir)));
      current.clear();
    },
    run: () => shipper.ship(),
    stop: () => {
      shipper.ship();
      shipper.remove(follower);
    },
  };
  shipper.add(follower);
  return schedule;
}

/** Local time as people type it: "2026-10-11 14:05", "2026-10-11T14:05:30", "2026-10-11" (its end), or "14:05" (today). */
export function parseTime(text: string): number {
  const t = text.trim();
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (clock) {
    const d = new Date();
    d.setHours(+clock[1], +clock[2], +(clock[3] ?? 0), 0);
    return d.getTime();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T_](\d{1,2}):?(\d{2})(?::?(\d{2}))?)?$/.exec(t);
  if (!m) throw new Error(`can't read time "${text}": use 2026-10-11 14:05`);
  // A day alone means its end.
  if (m[4] === undefined) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999).getTime();
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime();
}

/** One saved log: when it was taken and how to read it. */
export interface SavedLog {
  at: number;
  read(passphrase: string | undefined): Promise<Buffer>;
}

function savedLogs(logDir: string): SavedLog[] {
  if (!existsSync(logDir)) return [];
  const out: SavedLog[] = [];
  for (const l of readdirSync(logDir)) {
    const path = join(logDir, l);
    if (OLD_LOG.test(l)) {
      out.push({
        at: parseStamp(l),
        read: async (passphrase) => {
          if (!l.endsWith(ENCRYPTED_EXT)) return readFileSync(path);
          const tmp = path + '.restoring';
          try {
            await unseal(path, tmp, passphrase);
            return readFileSync(tmp);
          } finally {
            rmSync(tmp, { force: true });
          }
        },
      });
    } else if (LOGS.test(l)) {
      let reader: Promise<(r: { n: number; offset: number; length: number }) => Buffer> | undefined;
      for (const r of logRecords(path)) out.push({ at: r.at, read: async (passphrase) => (await (reader ??= logReader(path, passphrase)))(r) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The latest moment at or before `at` a file can be put back to, from which set and logs. */
export function restorePoint(dest: string, file: string, at: number): { set: string; copy: string; logs: SavedLog[]; time: number } | undefined {
  let best: { set: string; copy: string; logs: SavedLog[]; time: number } | undefined;
  for (const name of backupSets(dest)) {
    const dir = join(dest, name);
    const finished = finishedTimes(dir)[file];
    const copy = stored(join(dir, file)) ?? join(dir, file);
    if (finished === undefined || finished > at) continue;
    const logs = savedLogs(join(dir, 'progressive', file.slice(0, -STORE_EXT.length))).filter((x) => x.at > finished && x.at <= at);
    const time = logs.length ? logs.at(-1)!.at : finished;
    if (!best || time >= best.time) best = { set: dir, copy, logs, time };
  }
  return best;
}

/** One account that is not the same in the file a restore replaces as in the backup that replaces it. */
export interface AccountDifference { file: string; name: string; change: string }

/** What a restore may be asked: `refuseAccountChanges` stops it, before anything is replaced, when accounts differ; `differences` is filled in either way. */
export interface RestoreOptions { refuseAccountChanges?: boolean; differences?: AccountDifference[]; signal?: AbortSignal }

/** Thrown when a restore found accounts that differ and was asked not to go on until someone has seen them. Nothing was replaced. */
export class AccountChangesError extends Error {
  readonly differences: AccountDifference[];
  constructor(differences: AccountDifference[]) {
    super(`the backup's accounts differ from the ones in place now (${differences.length}); nothing was restored`);
    this.name = 'AccountChangesError';
    this.differences = differences;
  }
}

/**
 * How the accounts of the file about to be replaced (`current`) differ from the staged copy that will replace it, after the
 * restrictions added since the backup were carried over: accounts that will disappear, accounts that will come back, accounts
 * whose on/off state changes, and accounts whose privilege set changes. Nothing when the current file has no readable accounts
 * (a new folder, or the damaged file the restore is for), since there is nothing to compare with.
 */
export function accountDifferences(file: string, current: string, staged: string): AccountDifference[] {
  if (!credentialsReadable(current)) return [];
  const read = (path: string): Map<string, { inactive: number; set: string | null }> | undefined => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const columns = (db.prepare('PRAGMA table_info("_fm_accounts")').all() as { name: string }[]).map((c) => c.name);
      if (!columns.includes('name')) return undefined;
      const rows = db.prepare(`SELECT name, ${columns.includes('inactive') ? 'inactive' : '0 AS inactive'}, ${columns.includes('privilege_set') ? 'privilege_set' : 'NULL AS privilege_set'} FROM _fm_accounts`).all() as { name: string; inactive: number; privilege_set: string | null }[];
      return new Map(rows.map((r) => [r.name.toLowerCase(), { inactive: r.inactive ? 1 : 0, set: r.privilege_set }]));
    } finally { db.close(); }
  };
  const now = read(current);
  const then = read(staged);
  if (!now || !then) return [];
  const names = new Map([...readNames(current), ...readNames(staged)]);
  const out: AccountDifference[] = [];
  for (const [key, a] of now) {
    const b = then.get(key);
    const name = names.get(key) ?? key;
    if (!b) out.push({ file, name, change: 'has been added since the backup, so it is gone after this restore' });
    else {
      if (a.inactive !== b.inactive) out.push({ file, name, change: a.inactive ? 'is switched off now but was on in the backup, so it is on again after this restore' : 'is on now but was switched off in the backup, so it is switched off after this restore' });
      if ((a.set ?? '') !== (b.set ?? '')) out.push({ file, name, change: `has the privilege set ${a.set ?? '(none)'} now but ${b.set ?? '(none)'} in the backup, so it has ${b.set ?? '(none)'} after this restore` });
    }
  }
  for (const [key] of then) if (!now.has(key)) out.push({ file, name: names.get(key) ?? key, change: 'was removed after the backup, so it is back after this restore' });
  return out;
}

function readNames(path: string): [string, string][] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare('SELECT name FROM _fm_accounts').all() as { name: string }[]).map((r) => [r.name.toLowerCase(), r.name]);
  } catch { return []; } finally { db.close(); }
}

/** Account columns that only take access away. */
/** `inactive` is not here: a point-in-time restore brings back the account's on/off state as it was (progressive.test.ts), so an account switched off since the backup is on again. */
const RESTRICTIONS = ['require_2fa', 'local_only', 'must_change', 'needs_approval'];
const REVOCATION_TABLES = ['_fm_api_tokens', '_fm_totp', '_fm_passkeys', '_fm_recovery_codes'];

/**
 * Carry forward current credential state so a point-in-time restore cannot resurrect revoked credentials. A current file that
 * is itself damaged (the reason for the restore) has no credentials that can be read, so it counts as absent: the restored
 * accounts have their passwords switched off and no token, second factor or passkey survives, as for a restore into a new folder.
 */
export function retainCurrentCredentials(source: string, restored: string): void {
  reconcileCredentials(credentialsReadable(source) ? source : undefined, restored);
}

/**
 * Whether the current file's credential tables can be read: decided from the current file alone, so damage in the restored
 * copy is never mistaken for damage in the file being replaced. A missing or empty file (a crash or a sync tool leaves
 * one) has none; any error that is not damage (a lock, a permission) still refuses the restore.
 */
function credentialsReadable(source: string): boolean {
  if (!existsSync(source) || statSync(source).size === 0) return false;
  let current: DatabaseSync | undefined;
  try {
    current = new DatabaseSync(source, { readOnly: true });
    current.exec('PRAGMA busy_timeout = 2000');
    for (const table of ['_fm_accounts', ...REVOCATION_TABLES]) {
      try { current.prepare(`SELECT * FROM "${table}"`).all(); } catch (e) {
        if (/no such table/i.test((e as Error).message)) continue;
        throw e;
      }
    }
    return true;
  } catch (e) {
    if (isDamageError(e)) return false;
    throw e;
  } finally {
    try { current?.close(); } catch { /* nothing more to do */ }
  }
}

interface ColumnInfo { name: string; type: string; notnull: number; dflt_value: string | null }

const columnInfo = (conn: DatabaseSync, table: string): ColumnInfo[] => conn.prepare(`PRAGMA table_info("${table}")`).all() as unknown as ColumnInfo[];

const formatOf = (conn: DatabaseSync): number | 'unreadable' => {
  try { return storedFormat(conn); } catch { return 0; /* no _fm_meta: a file no store has opened */ }
};

/**
 * Across file formats the two files' credential tables may not have the same columns, and copying by shared name would
 * drop what the current file holds in the others. A column only the current file has is added to the restored table so
 * its values are carried; a column only the backup has cannot be judged (what it means is not known), so the restore is refused.
 */
function alignColumns(current: DatabaseSync, db: DatabaseSync, table: string, currentFormat: unknown, restoredFormat: unknown): void {
  const restoredNames = columnInfo(db, table).map((c) => c.name);
  const currentColumns = columnInfo(current, table);
  const extra = restoredNames.filter((n) => !currentColumns.some((c) => c.name === n));
  if (extra.length) throw new Error(`cannot restore across file formats: the backup (format ${restoredFormat}) has ${table} column ${extra.map((n) => `"${n}"`).join(', ')} that the current file (format ${currentFormat}) does not, and what it means is not known`);
  for (const c of currentColumns) {
    if (restoredNames.includes(c.name)) continue;
    const dflt = c.dflt_value !== null ? ` DEFAULT ${c.dflt_value}` : '';
    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${c.name}" ${c.type}${c.notnull && c.dflt_value !== null ? ' NOT NULL' : ''}${dflt}`);
  }
}

function reconcileCredentials(source: string | undefined, restored: string): void {
  const current = source ? new DatabaseSync(source, { readOnly: true }) : undefined;
  const db = new DatabaseSync(restored);
  try {
    db.exec('BEGIN');
    // A backup from a newer build than this one would be left closed once put in place.
    try { refuseNewer(db, 'the backup'); } catch (e) {
      if (!/no such table/i.test((e as Error).message)) throw e;
    }
    const currentFormat = current ? formatOf(current) : undefined;
    const restoredFormat = formatOf(db);
    const crossFormat = currentFormat !== undefined && currentFormat !== restoredFormat;
    const accountTable = db.prepare('PRAGMA table_info("_fm_accounts")').all();
    for (const table of REVOCATION_TABLES) {
      const quote = `"${table}"`;
      const has = (conn: DatabaseSync) => (conn.prepare(`PRAGMA table_info(${quote})`).all() as { name: string }[]).map((c) => c.name);
      let restoredColumns = has(db);
      // A file that was never opened by a store has none of these tables; a store creates them on open, so the current file's definition stands in.
      // Only a file that has the accounts table is one of ours; anything else is refused.
      if (!restoredColumns.length && accountTable.length) {
        const create = (current?.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined)?.sql;
        if (!create) continue;
        db.exec(create);
        restoredColumns = has(db);
      }
      if (!restoredColumns.length) throw new Error(`cannot reconcile credential table ${table}`);
      if (!current) { db.exec(`DELETE FROM ${quote}`); continue; }
      let currentColumns = has(current);
      // The current file never made this table, so it holds no credentials of the kind.
      if (!currentColumns.length) { db.exec(`DELETE FROM ${quote}`); continue; }
      if (crossFormat) { alignColumns(current, db, table, currentFormat, restoredFormat); restoredColumns = has(db); currentColumns = has(current); }
      const columns = currentColumns.filter((c) => restoredColumns.includes(c));
      if (!columns.length) throw new Error(`cannot reconcile credential table ${table}`);
      const names = columns.map((c) => `"${c}"`).join(', ');
      const rows = current.prepare(`SELECT ${names} FROM ${quote}`).all() as Record<string, unknown>[];
      db.exec(`DELETE FROM ${quote}`);
      const insert = db.prepare(`INSERT INTO ${quote} (${names}) VALUES (${columns.map(() => '?').join(', ')})`);
      for (const row of rows) insert.run(...columns.map((c) => row[c] as null | number | bigint | string | Uint8Array));
    }
    const accountColumns = (conn: DatabaseSync) => (conn.prepare('PRAGMA table_info("_fm_accounts")').all() as { name: string }[]).map((c) => c.name);
    const currentAccountColumns = current ? accountColumns(current) : [];
    const restoredAccountColumns = accountColumns(db);
    if (!restoredAccountColumns.includes('name') || !restoredAccountColumns.includes('password_hash') || (current && (!currentAccountColumns.includes('name') || !currentAccountColumns.includes('password_hash')))) throw new Error('cannot reconcile account password credentials');
    if (crossFormat && current) {
      const before = restoredAccountColumns.slice();
      alignColumns(current, db, '_fm_accounts', currentFormat, restoredFormat);
      const added = columnInfo(db, '_fm_accounts').map((c) => c.name).filter((n) => !before.includes(n));
      if (added.length) {
        // Columns added for the current file's accounts take its values, by account name.
        const rows = current.prepare('SELECT name, ' + added.map((n) => `"${n}"`).join(', ') + ' FROM _fm_accounts').all() as Record<string, never>[];
        const set = db.prepare(`UPDATE _fm_accounts SET ${added.map((n) => `"${n}" = ?`).join(', ')} WHERE name = ? COLLATE NOCASE`);
        for (const row of rows) set.run(...added.map((n) => row[n] as null | number | bigint | string), row.name as string);
        restoredAccountColumns.push(...added);
      }
    }
    if (!restoredAccountColumns.includes('password_disabled')) db.exec('ALTER TABLE _fm_accounts ADD COLUMN password_disabled INTEGER NOT NULL DEFAULT 0');
    const currentHasDisabled = currentAccountColumns.includes('password_disabled');
    db.prepare('UPDATE _fm_accounts SET password_hash = NULL, password_disabled = 1').run();
    if (current) {
      const passwords = current.prepare(`SELECT name, password_hash${currentHasDisabled ? ', password_disabled' : ''} FROM _fm_accounts`).all() as { name: string; password_hash: string | null; password_disabled?: number }[];
      const setPassword = db.prepare('UPDATE _fm_accounts SET password_hash = ?, password_disabled = ? WHERE name = ? COLLATE NOCASE');
      for (const row of passwords) setPassword.run(row.password_hash, row.password_disabled ?? 0, row.name);
      // A restriction added since the backup (a second factor or local sign-in required) stays: a restore never lifts one. One lifted since the backup comes back, since the backup's accounts are what is restored.
      for (const column of RESTRICTIONS) {
        if (!currentAccountColumns.includes(column) || !restoredAccountColumns.includes(column)) continue;
        const on = current.prepare(`SELECT name FROM _fm_accounts WHERE "${column}" = 1`).all() as { name: string }[];
        const restrict = db.prepare(`UPDATE _fm_accounts SET "${column}" = 1 WHERE name = ? COLLATE NOCASE`);
        for (const row of on) restrict.run(row.name);
      }
    }
    const scim = current?.prepare("SELECT json FROM _fm_meta WHERE key = 'scim'").get() as { json: string } | undefined;
    if (scim) db.prepare("INSERT INTO _fm_meta(key,json) VALUES ('scim',?) ON CONFLICT(key) DO UPDATE SET json=excluded.json").run(scim.json);
    else db.prepare("DELETE FROM _fm_meta WHERE key = 'scim'").run();
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already have ended */ }
    throw e;
  } finally {
    current?.close();
    db.close();
  }
}

/** Writes a restore point's copy, with its logs replayed and checked, to `target` (replacing it). */
export async function restorePointTo(point: { copy: string; logs: SavedLog[] }, target: string, passphrase = backupKey(), securitySource = target): Promise<void> {
  let external: Awaited<ReturnType<typeof stageExternal>> | undefined;
  try {
    await stageRestorePoint(point, target, passphrase, securitySource);
    const name = plain(basename(point.copy)).slice(0, -STORE_EXT.length);
    const hasExternal = Object.keys(externalManifest(dirname(point.copy))).some((rel) => rel.split('/')[1] === name);
    if (hasExternal && basename(target) !== name + STORE_EXT) {
      throw new Error(`cannot restore external container files for ${name} under a different database name`);
    }
    external = await stageExternal(dirname(point.copy), dirname(target), [name], passphrase);
    // Keep the old database and its WAL together until the replacement commits.
    commitRestore(dirname(target), [...restorePointFiles(target), ...external.files]);
    crashPoint('restore-copy:after-publish');
  } finally { external?.cleanup(); cleanRestorePoint(target); }
}

function restorePointFiles(target: string): import('./restore-files.ts').RestoreFile[] {
  return [{ staged: target + '.restoring', target }, ...['-wal', '-shm'].map((ext) => ({ target: target + ext }))];
}

function cleanRestorePoint(target: string): void {
  for (const ext of ['', '-wal', '-shm', ENCRYPTED_EXT]) rmSync(target + '.restoring' + ext, { force: true });
}

/** Stage without touching any live database, so a folder restore can commit once. */
async function stageRestorePoint(point: { copy: string; logs: SavedLog[] }, target: string, passphrase: string | undefined, securitySource = target): Promise<void> {
  const work = target + '.restoring';
  const scratch = [work, work + '-wal', work + '-shm'];
  for (const x of scratch) rmSync(x, { force: true });
  try {
    await copyVerifiedDatabase(point.copy, work, passphrase, () => crashPoint('restore-copy:after-copy'));
    const name = plain(basename(point.copy)).slice(0, -STORE_EXT.length);
    if (point.logs.length && Object.keys(externalManifest(dirname(point.copy))).some((rel) => rel.split('/')[1] === name)) {
      throw new Error(`cannot restore external container files for ${name} after the base snapshot: progressive logs do not capture their versions`);
    }
    // Each log, laid next to the copy, is replayed into it by SQLite.
    for (const l of point.logs) applyLog(work, await l.read(passphrase));
    crashPoint('restore-copy:after-replay');
    const check = new DatabaseSync(work, { readOnly: true });
    try {
      const r = Object.values(check.prepare('PRAGMA quick_check').get() as Record<string, string>)[0];
      if (r !== 'ok') throw new Error(`restoring ${basename(target)} failed its check: ${r}`);
      if (point.logs.length && check.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_fm_containers'").get() &&
          check.prepare("SELECT 1 FROM _fm_containers WHERE external IS NOT NULL AND external != '' LIMIT 1").get()) {
        throw new Error(`cannot restore external container files for ${basename(target)} after the base snapshot: progressive logs do not capture their versions`);
      }
    } finally {
      check.close();
    }
  } catch (e) {
    for (const x of scratch) rmSync(x, { force: true });
    throw e;
  }
  retainCurrentCredentials(securitySource, work);
  crashPoint('restore-copy:after-verify');
  for (const x of [work + '-wal', work + '-shm']) rmSync(x, { force: true });
}

/** The span of time a file can be put back to: from its oldest backed-up copy to its newest saved change. */
export function restoreRange(dest: string, file: string): { from: number; to: number; sets: number } | undefined {
  let from: number | undefined;
  let to: number | undefined;
  let sets = 0;
  for (const name of backupSets(dest)) {
    const dir = join(dest, name);
    const finished = finishedTimes(dir)[file];
    if (finished === undefined || !stored(join(dir, file))) continue;
    sets++;
    const logs = savedLogs(join(dir, 'progressive', file.slice(0, -STORE_EXT.length))).filter((x) => x.at > finished);
    const last = logs.length ? logs.at(-1)!.at : finished;
    from = from === undefined ? finished : Math.min(from, finished);
    to = to === undefined ? last : Math.max(to, last);
  }
  return from === undefined ? undefined : { from, to: to!, sets };
}

/** Puts databases back as they were at a moment (the latest point backed up at or before it). The server must be stopped. */
export async function restoreAt(folder: string, dest: string, at: number, only?: string, passphrase = backupKey(), options: RestoreOptions = {}): Promise<{ file: string; time: number }[]> {
  const pid = hostingProcess(folder);
  if (pid !== undefined) throw new Error(`stop the server first (process ${pid} is hosting ${folder})`);
  const files = new Set<string>();
  for (const name of backupSets(dest)) {
    for (const f of backupInventory(join(dest, name), true).copies.map(plain)) files.add(f);
  }
  const wanted = [...files].filter((f) => !only || f.toLowerCase() === (only + STORE_EXT).toLowerCase());
  if (!wanted.length) throw new Error(only ? `no backups of ${only} in ${dest}` : `no backups in ${dest}`);
  const out: { file: string; time: number }[] = [];
  const external: Awaited<ReturnType<typeof stageExternal>>[] = [];
  // Held through staging and the batch commit, so no server opens a mixed folder.
  const release = claimFolder(folder, 'restore');
  try {
    for (const f of wanted) {
      const point = restorePoint(dest, f, at);
      if (!point) {
        if (only) throw new Error(`no backup of ${only} from before ${new Date(at).toLocaleString()}`);
        continue;
      }
      await stageRestorePoint(point, join(folder, f), passphrase);
      external.push(await stageExternal(point.set, folder, [f.slice(0, -STORE_EXT.length)], passphrase, options.signal));
      crashPoint('restore-at:after-file');
      out.push({ file: f, time: point.time });
    }
    const differences = out.flatMap(({ file }) => accountDifferences(file, join(folder, file), join(folder, file) + '.restoring'));
    options.differences?.push(...differences);
    if (differences.length && options.refuseAccountChanges) throw new AccountChangesError(differences);
    commitRestore(folder, [...out.flatMap(({ file }) => restorePointFiles(join(folder, file))), ...external.flatMap((stage) => stage.files)]);
    crashPoint('restore-at:after-commit');
  } finally {
    try {
      for (const stage of external) stage.cleanup();
      for (const file of wanted) cleanRestorePoint(join(folder, file));
    }
    finally { release(); }
  }
  return out;
}
