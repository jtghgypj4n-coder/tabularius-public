// Change logs: every few seconds the server takes each hosted file's
// write-ahead log (SQLite's record of every change since it was last
// emptied) and hands it to whatever follows the file's changes: point-in-time
// backups (backup.ts) and standby servers (replication.ts). Only then is the
// log folded into the file and emptied, so a follower that could not keep the
// changes (a full disk) gets them again with the next ones, and nothing is
// ever skipped.
//
// A log holds whole pages as they were after each change, so applying logs in
// order to a copy of the file brings the copy to the same state, and applying
// one again, or one whose changes the copy already has, does no harm.

import { crashPoint } from '../../store/src/crash-point.ts';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, closeSync, fstatSync, openSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { deriveKey, deriveKeySync, openRecord, sealRecord } from './encrypt.ts';
import type { Store } from '../../store/src/index.ts';
import type { Host } from './host.ts';

export interface LogFollower {
  /** How often this follower wants the changes (ms). */
  every: number;
  /** The file's changes are followed from now on: its log was just emptied, and nothing earlier will come. */
  started?(store: Store): void;
  /** The changes since the last call; false keeps them in the log, to be offered again with later ones. */
  take(store: Store, log: Buffer, at: number): boolean;
  /** After each round over every file. */
  shipped?(): void;
}

export class LogShipper {
  private readonly host: Host;
  private readonly log: (m: string) => void;
  private readonly followers = new Set<LogFollower>();
  private readonly followed = new WeakSet<Store>();
  private timer?: NodeJS.Timeout;

  constructor(host: Host, log: (m: string) => void = () => {}) {
    this.host = host;
    this.log = log;
  }

  add(follower: LogFollower): void {
    this.followers.add(follower);
    for (const name of this.host.names()) {
      const store = this.host.get(name)!;
      if (this.followed.has(store)) follower.started?.(store);
    }
    this.restart();
  }

  remove(follower: LogFollower): void {
    this.followers.delete(follower);
    this.restart();
  }

  private restart(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!this.followers.size) return;
    this.timer = setInterval(() => this.ship(), Math.min(...[...this.followers].map((f) => f.every)));
    this.timer.unref();
  }

  /** Starts following a file: its log only empties when taken from now on. */
  follow(store: Store): void {
    if (this.followed.has(store)) return;
    store.sql.exec('PRAGMA wal_autocheckpoint = 0');
    store.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.followed.add(store);
    for (const f of this.followers) f.started?.(store);
  }

  /** Hands every file's changes to the followers now. */
  ship(): void {
    for (const name of this.host.names()) {
      const store = this.host.get(name)!;
      this.follow(store);
      store.shipWal((data) => {
        const at = Date.now();
        let ok = true;
        for (const f of this.followers) {
          try {
            if (!f.take(store, data, at)) ok = false;
          } catch (e) {
            ok = false;
            this.log(`keeping the changes to ${name}: ${(e as Error).message}`);
          }
        }
        return ok;
      });
    }
    for (const f of this.followers) f.shipped?.();
  }

  /** Hands over the last changes and stops. */
  stop(): void {
    if (this.followers.size) this.ship();
    clearInterval(this.timer);
    this.timer = undefined;
    this.followers.clear();
  }
}

// --- log files ---------------------------------------------------------------
//
// Logs are kept in files of records, each one log as taken: a header line,
// then per record its time (ms, 8 bytes), sequence number (4), length (4) and
// the log itself. Records are only appended, so a file cut short by a crash
// still reads up to its last whole record. With a passphrase, the header also
// holds a salt and nonce prefix, and each log is sealed on its own
// (AES-256-GCM, numbered by its place in the file).

const MAGIC = Buffer.from('openhbam-log 1\n');
const MAGIC_SEALED = Buffer.from('openhbam-log-sealed 1\n');
const SEALED_HEAD = MAGIC_SEALED.length + 24;

export interface LogRecord {
  at: number;
  seq: number;
  data: Buffer;
}

export function encodeRecord(r: LogRecord): Buffer {
  const head = Buffer.alloc(16);
  head.writeDoubleBE(r.at, 0);
  head.writeUInt32BE(r.seq >>> 0, 8);
  head.writeUInt32BE(r.data.length, 12);
  return Buffer.concat([head, r.data]);
}

/** Records in a buffer of encoded records, up to the last whole one. */
export function decodeRecords(buf: Buffer): LogRecord[] {
  const out: LogRecord[] = [];
  let i = 0;
  while (i + 16 <= buf.length) {
    const len = buf.readUInt32BE(i + 12);
    if (i + 16 + len > buf.length) break;
    out.push({ at: buf.readDoubleBE(i), seq: buf.readUInt32BE(i + 8), data: buf.subarray(i + 16, i + 16 + len) });
    i += 16 + len;
  }
  return out;
}

/** A log file being written. */
export interface LogWriter {
  path: string;
  key?: Buffer;
  prefix?: Buffer;
  /** Records written so far. */
  n: number;
}

/** Starts a log file, sealed when given a passphrase. */
export function startLog(path: string, passphrase?: string): LogWriter {
  if (!passphrase) {
    writeFileSync(path, MAGIC);
    return { path, n: 0 };
  }
  const salt = randomBytes(16);
  const prefix = randomBytes(8);
  writeFileSync(path, Buffer.concat([MAGIC_SEALED, salt, prefix]));
  return { path, key: deriveKeySync(passphrase, salt), prefix, n: 0 };
}

/** Adds a record to a log file. */
export function writeLog(w: LogWriter, r: LogRecord): void {
  const data = w.key ? sealRecord(w.key, w.prefix!, w.n, r.data) : r.data;
  appendFileSync(w.path, encodeRecord({ ...r, data }));
  w.n++;
}

/** A log file's records' times and places, without reading the logs themselves. */
export function logRecords(path: string): { at: number; n: number; offset: number; length: number }[] {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(SEALED_HEAD);
    const got = readSync(fd, head, 0, head.length, 0);
    const start = head.subarray(0, MAGIC.length).equals(MAGIC) ? MAGIC.length
      : got === SEALED_HEAD && head.subarray(0, MAGIC_SEALED.length).equals(MAGIC_SEALED) ? SEALED_HEAD : undefined;
    if (start === undefined) return [];
    const out: { at: number; n: number; offset: number; length: number }[] = [];
    const rec = Buffer.alloc(16);
    for (let pos = start; pos + 16 <= size && readSync(fd, rec, 0, 16, pos) === 16; ) {
      const length = rec.readUInt32BE(12);
      const offset = pos + 16;
      if (offset + length > size) break; // cut short
      out.push({ at: rec.readDoubleBE(0), n: out.length, offset, length });
      pos = offset + length;
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

/** Reads records of a log file (see logRecords), opening sealed ones with the passphrase. */
export async function logReader(path: string, passphrase?: string): Promise<(r: { n: number; offset: number; length: number }) => Buffer> {
  const head = readPart(path, 0, Math.min(SEALED_HEAD, statSync(path).size));
  if (!head.subarray(0, MAGIC_SEALED.length).equals(MAGIC_SEALED)) return (r) => readPart(path, r.offset, r.length);
  if (!passphrase) throw new Error(`${path} is encrypted: set TABULARIUS_BACKUP_KEY to its passphrase`);
  const key = await deriveKey(passphrase, head.subarray(MAGIC_SEALED.length, MAGIC_SEALED.length + 16));
  const prefix = head.subarray(MAGIC_SEALED.length + 16, SEALED_HEAD);
  return (r) => {
    try {
      return openRecord(key, prefix, r.n, readPart(path, r.offset, r.length));
    } catch {
      throw new Error(r.n === 0 ? `can't decrypt ${path}: wrong passphrase, or the file is damaged` : `${path} is damaged`);
    }
  };
}

export function readPart(path: string, offset: number, length: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    if (readSync(fd, buf, 0, length, offset) !== length) throw new Error(`${path} is cut short`);
    return buf;
  } finally {
    closeSync(fd);
  }
}

/** Applies a log to a database file that nothing has open: SQLite reads it as the file's own log and folds it in. */
export function applyLog(dbPath: string, log: Buffer): void {
  rmSync(dbPath + '-shm', { force: true });
  writeFileSync(dbPath + '-wal', log);
  crashPoint('apply-log:mid-apply-log');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}
