import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { crashPoint } from '../../store/src/crash-point.ts';
import { freeBytes } from './disk.ts';

export const COMPACTION_EVERY_MS = 86_400_000;
export const COMPACTION_WAL_BYTES = 64 * 1024 * 1024;
export const COMPACTION_START_DELAY_MS = 10 * 60_000;

/** One tick of the server's compaction timer: nothing runs before `notBefore`, neither the daily pass nor the WAL-size trigger. */
export function timedCompactionTick(tick: () => void, notBefore: number, now = Date.now()): boolean {
  if (now < notBefore) return false;
  tick();
  return true;
}

export interface CompactionReport {
  beforeBytes: number;
  afterBytes: number;
  walBeforeBytes: number;
  walAfterBytes: number;
  durationMs: number;
  writerWaitMs: number;
  convertedToIncremental: boolean;
  freePagesBefore: number;
  freePagesAfter: number;
}

export function fileBytes(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

export function compactionDue(now: number, last: number | undefined, everyMs = COMPACTION_EVERY_MS, walBytes = 0, triggerBytes = COMPACTION_WAL_BYTES): boolean {
  return walBytes >= triggerBytes || last === undefined || now - last >= everyMs;
}

/**
 * One pass on a separate connection. SQLite serializes the writers. A file that is not yet in incremental vacuum mode
 * is rewritten once (VACUUM holds the write lock for the whole rewrite, longer than a live connection waits), so that
 * happens only when `convert` is true, which is when someone asked for it; the timer passes false and does the bounded
 * part (statistics, checkpoint) alone on such a file. `checkpoint: false` leaves the write-ahead log for the caller to fold
 * away: a server whose files are followed ships the log first and does it on its own connection (see Host.compact), and
 * this connection must not fold it or let it restart in between, so it never checkpoints by itself then.
 */
export function compactStore(path: string, available?: number, busyTimeoutMs = 5000, convert = true, checkpoint = true): CompactionReport {
  const started = Date.now();
  const beforeBytes = statSync(path).size;
  const walBeforeBytes = fileBytes(path + '-wal');
  const required = 2 * (beforeBytes + walBeforeBytes);
  const space = arguments.length >= 2 ? available : freeBytes(path);
  if (space === undefined || !Number.isFinite(space) || space < required) {
    throw new Error(`compaction needs ${required} bytes free; ${space === undefined ? 'available space could not be read' : `${space} bytes available`}`);
  }
  crashPoint('compaction:after-space-check');
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);
    db.exec('PRAGMA wal_autocheckpoint = 0');
    const waiting = Date.now();
    try { db.exec('BEGIN IMMEDIATE; ROLLBACK'); }
    catch (e) { throw new Error(`compaction could not get a writer within ${busyTimeoutMs} ms; retry later: ${(e as Error).message}`); }
    const writerWaitMs = Date.now() - waiting;
    crashPoint('compaction:after-writer-wait');
    const freePagesBefore = Number((db.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count);
    const mode = Number((db.prepare('PRAGMA auto_vacuum').get() as { auto_vacuum: number }).auto_vacuum);
    let convertedToIncremental = false;
    if (mode === 0 && convert) {
      db.exec('PRAGMA auto_vacuum = INCREMENTAL');
      crashPoint('compaction:before-initial-vacuum');
      db.exec('VACUUM');
      convertedToIncremental = true;
      crashPoint('compaction:after-initial-vacuum');
    } else if (mode === 1) db.exec('PRAGMA auto_vacuum = INCREMENTAL');
    db.exec('PRAGMA incremental_vacuum(1000)');
    crashPoint('compaction:after-incremental-vacuum');
    db.exec('PRAGMA optimize(0x10002)');
    crashPoint('compaction:after-statistics');
    if (checkpoint) {
      const folded = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number };
      if (folded.busy) throw new Error('compaction could not truncate the WAL because a reader is active; retry later');
    }
    crashPoint('compaction:after-checkpoint');
    return {
      beforeBytes, afterBytes: statSync(path).size,
      walBeforeBytes, walAfterBytes: fileBytes(path + '-wal'),
      durationMs: Date.now() - started, writerWaitMs, convertedToIncremental,
      freePagesBefore, freePagesAfter: Number((db.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count),
    };
  } finally { db.close(); }
}

export function compactInWorker(path: string, convert = true, checkpoint = true): Promise<CompactionReport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./compaction-worker.ts', import.meta.url), { workerData: { path, convert, checkpoint } });
    let answered = false;
    worker.once('message', (answer: { report?: CompactionReport; error?: string }) => {
      answered = true;
      if (answer.report) resolve(answer.report);
      else reject(new Error(answer.error ?? 'compaction worker returned no report'));
    });
    worker.once('error', reject);
    worker.once('exit', () => { if (!answered) reject(new Error('compaction worker exited without an answer')); });
  });
}
