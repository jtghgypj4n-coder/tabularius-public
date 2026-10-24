// What a signed backup set says about its point-in-time logs.
//
// Each sealed log record is authenticated by AES-GCM (bound to its place in its file, its time and its database), so a
// record cannot be forged or moved without the passphrase. But nothing in a record says which others exist: a log file
// removed, or cut at a record boundary, leaves a valid set that restores to an earlier moment than it should. So the set's
// signed manifest holds, for each database, how many records were saved and a hash chain over them (each step takes the one
// before, the log file's name and the record as stored). A restore of a signed set walks the records it finds, compares the
// chain after the recorded count with the signed one, and replays only those records.
//
// Records after the recorded count are ignored: the server writes a record before it lists it, so a crash between the
// two leaves a genuine record the manifest does not know about yet.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { logRecords } from './logs.ts';

/** Files of logs, one started every interval: UTC names end in Z; older local names remain readable. */
export const LOGS = /^\d{4}-\d{2}-\d{2}_\d{6}\.\d{3}Z?\.log(?:\.enc)?$/;
/** Logs as saved by earlier versions: one log per file, named by its time. */
export const OLD_LOG = /^\d{4}-\d{2}-\d{2}_\d{6}\.\d{3}\.wal(?:\.enc)?$/;

export interface LogChain {
  /** Records saved so far. */
  n: number;
  /** Hash over all of them, in the order they were written. */
  head: string;
}

export const EMPTY_CHAIN: LogChain = { n: 0, head: '0'.repeat(64) };

/** The chain after one more record: `stored` is the record as written in the log file (header and sealed log). */
export function extendChain(chain: LogChain, file: string, stored: Buffer): LogChain {
  const head = createHash('sha256').update(Buffer.from(chain.head, 'hex')).update(file).update('\0').update(stored).digest('hex');
  return { n: chain.n + 1, head };
}

export interface ScannedLogs {
  /** Every whole record in the order written, and the chain after it. */
  records: { file: string; n: number; chain: LogChain }[];
  /** Log files in the format earlier versions saved, which a signed set never has. */
  legacy: string[];
  /** Log files that are not encrypted, which a signed set never has either. */
  plain: string[];
}

/** Reads a database's log files in the order they were written. */
export function scanLogs(logDir: string): ScannedLogs {
  const out: ScannedLogs = { records: [], legacy: [], plain: [] };
  if (!existsSync(logDir)) return out;
  const names = readdirSync(logDir);
  out.legacy = names.filter((f) => OLD_LOG.test(f)).sort();
  out.plain = names.filter((f) => LOGS.test(f) && !f.endsWith('.enc')).sort();
  let chain = EMPTY_CHAIN;
  for (const file of names.filter((f) => LOGS.test(f)).sort()) {
    const path = join(logDir, file);
    const bytes = readFileSync(path);
    for (const r of logRecords(path)) {
      chain = extendChain(chain, file, bytes.subarray(r.offset - 16, r.offset + r.length));
      out.records.push({ file, n: r.n, chain });
    }
  }
  return out;
}

/** The chain over every record in a database's log files. */
export function chainOf(logDir: string): LogChain {
  return scanLogs(logDir).records.at(-1)?.chain ?? EMPTY_CHAIN;
}

/** The chain of each database that has logs under a set's progressive folder, for signing a set that has none recorded. */
export function logInventory(setDir: string): Record<string, LogChain> {
  const root = join(setDir, 'progressive');
  const out: Record<string, LogChain> = {};
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    const chain = chainOf(join(root, name));
    if (chain.n) out[name] = chain;
  }
  return out;
}

/**
 * Checks a database's log files against what its signed manifest recorded, and returns the records that are vouched for
 * (as "file#n"). Throws when a record is missing, was changed or replaced, or a log in the old format is among them.
 */
export function verifyLogs(logDir: string, recorded: LogChain | undefined, database: string): Set<string> {
  const want = recorded ?? EMPTY_CHAIN;
  const found = scanLogs(logDir);
  if (found.legacy.length) throw new Error(`${join(logDir, found.legacy[0])} is a log in a format this backup does not save, so the set it is in was not made by it and ${database} is not restored from it`);
  if (found.plain.length) throw new Error(`${join(logDir, found.plain[0])} is not encrypted, but the backup it is in is: it was not made by this backup, so it is not restored`);
  if (found.records.length < want.n) {
    throw new Error(`the saved changes to ${database} are incomplete: the backup recorded ${want.n} saved ${want.n === 1 ? 'log' : 'logs'} and ${found.records.length} ${found.records.length === 1 ? 'is' : 'are'} there (a log file was removed or cut short), so it is not restored`);
  }
  const last = want.n ? found.records[want.n - 1].chain : EMPTY_CHAIN;
  if (last.head !== want.head) {
    throw new Error(`the saved changes to ${database} are not the ones the backup recorded (a log was changed, replaced or put among them), so it is not restored`);
  }
  return new Set(found.records.slice(0, want.n).map((r) => `${r.file}#${r.n}`));
}
