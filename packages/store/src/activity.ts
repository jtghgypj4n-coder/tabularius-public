// Several people working in one hosted file: record locks and change events.
//
// FileMaker locks a record while someone edits it; anyone else who tries to
// change it gets error 301 "Record is in use by another user" until the
// editor commits or reverts. Locks here belong to a client session (its
// owner key, usually the Data API token) and lapse when not renewed, so a
// closed browser tab never leaves a record locked for long.
//
// Who is writing comes from the async context the request runs in (see
// `writer`), so scripts a session runs edit the records it holds, and the
// store's write methods keep their signatures.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseSync } from 'node:sqlite';
import type { Field, Table } from '../../fmp12/src/index.ts';
import type { SqlValue } from './find.ts';
import type { Value } from '../../calc/src/index.ts';
import type { Store } from './store.ts';
import { monotonicClock } from './monotonic.ts';
import { PendingApprovalError, StoreError } from './errors.ts';

/**
 * A session's own global field values. In FileMaker each user of a hosted
 * file gets their own copy of every global, starting from the file's stored
 * value; setting one changes it for that user only.
 */
export interface SessionGlobals {
  /** The session's value, or undefined when it hasn't set one (the file's value applies). */
  readGlobal(store: Store, table: Table, field: Field): SqlValue | undefined;
  writeGlobal(store: Store, table: Table, field: Field, value: SqlValue): void;
  /**
   * The session's $$variables, which FileMaker's field calculations see too (an auto-enter of $$UserName that a
   * login script set): undefined when the session hasn't set it.
   */
  readVariable?(name: string, repetition: number): Value | undefined;
  writeVariable?(name: string, repetition: number, value: Value): void;
}

/** The context a piece of work runs under, including a client's session when present. */
export interface Writer {
  /** A script boundary checks resolved files before their schema or data is read. */
  beforeFile?: (file: Store) => void;
  /** Lock owner key: the session token. */
  owner?: string;
  account?: string;
  /** Where the work came from, for the audit log: "web client", "data api", "odata", "sql", "mcp", "admin", "automation", ... */
  surface?: string;
  /** The script running, innermost first, for the audit log. */
  script?: string;
  /** The audit entry whose change this write puts back (a revert), for the audit log. */
  revertOf?: number;
  /** Global field values for this client; without it globals are file-wide. */
  globals?: SessionGlobals;
  /** Where a script run keeps its open transaction (Open Transaction), shared with its subscripts. */
  transaction?: { open?: Transaction };
  /** Told of each record change this writer makes (the file, and its audit entry), so a caller can tell its own changes from others'. */
  onAudit?: (file: object, seq: number) => void;
}

/**
 * A FileMaker transaction: every file it changed, each holding a savepoint
 * until Commit Transaction or Revert Transaction. Other sessions get 301 while
 * a file is held; a different window of this script can commit independently.
 */
export interface Transaction {
  files: Map<{ endTransaction(tx: Transaction, keep: boolean): void }, string>;
  /** Records held by the originating window, including when its session also owns another window. */
  windowRecords?: Map<object, Set<string>>;
  /** Release record leases only after every file has committed or rolled back. */
  releaseLocks?: Set<() => void>;
  /** A dry run, always rolled back: its writes tell no one (live clients, webhooks, automations, other workers). */
  quiet?: boolean;
}

/** Ends a transaction in every file it changed: keeps the changes, or undoes them. */
export function endTransaction(tx: Transaction, keep: boolean): void {
  // Every file's hold ends, even when one of them fails to (its error is passed on after).
  let failed: unknown;
  if (keep) {
    try { renewTransactionLocks(tx, true); }
    catch (e) { failed = e; keep = false; }
  }
  const leases = transactionLeases.get(tx);
  if (leases) clearInterval(leases.timer);
  transactionLeases.delete(tx);
  for (const file of [...tx.files.keys()]) {
    try {
      file.endTransaction(tx, keep);
    } catch (e) {
      failed ??= e;
    }
  }
  tx.files.clear();
  for (const release of tx.releaseLocks ?? []) {
    try { release(); } catch (e) { failed ??= e; }
  }
  tx.releaseLocks?.clear();
  if (failed !== undefined) throw failed;
}

/**
 * An approval-gated agent's write is refused with PendingApprovalError, but the proposal and its security event were
 * stored on purpose (the gate runs before any mutation), so ending the transaction must keep them.
 */
const keepsOnRefusal = (error: unknown): boolean => error instanceof PendingApprovalError;

/** Run related writes and their metadata in one transaction across every touched store. */
export function atomicWrites<T>(fn: () => T): T {
  if (writer.getStore()?.transaction?.open) return fn();
  const tx: Transaction = { files: new Map() };
  try {
    const result = writer.run({ ...(writer.getStore() ?? {}), transaction: { open: tx } }, fn);
    endTransaction(tx, true);
    return result;
  } catch (error) {
    endTransaction(tx, keepsOnRefusal(error));
    throw error;
  }
}

/** Async form for operations that compute their journal after awaited work. */
export async function atomicWritesAsync<T>(fn: () => Promise<T>): Promise<T> {
  if (writer.getStore()?.transaction?.open) return fn();
  const tx: Transaction = { files: new Map() };
  try {
    const result = await writer.run({ ...(writer.getStore() ?? {}), transaction: { open: tx } }, fn);
    endTransaction(tx, true);
    return result;
  } catch (error) {
    endTransaction(tx, keepsOnRefusal(error));
    throw error;
  }
}

/** Async context naming the current writer. The server runs each request in `writer.run({}, ...)` and fills it in on login. */
export const writer = new AsyncLocalStorage<Writer>();

export interface RecordLock {
  table: string;
  recordId: number;
  owner: string;
  account: string;
  /** Epoch expiry estimate for display; in-memory enforcement uses a separate monotonic deadline. */
  expires: number;
}

interface RecordLease {
  lock: RecordLock;
  until: number;
}

export type ChangeKind = 'create' | 'update' | 'delete' | 'truncate' | 'lock' | 'unlock' | 'view' | 'leave'
  /** Design mode: a design change was saved (ids: the layouts, scripts or tables it touched, by `table`), or someone in design mode moved or selected (recordId: their layout, script or table, 0 for none; ids: their selection). */
  | 'design' | 'designer';

/** The `table` of design-mode changes and presence, which no base table can be named (they start with a letter): layouts here, */
export const DESIGN_TABLE = '_design';
/** scripts (ids: script ids), */
export const DESIGN_SCRIPTS = '_design/scripts';
/** and tables with their fields (ids: table ids; a presence's selection: field ids). */
export const DESIGN_TABLES = '_design/tables';
/** A design-mode change or presence, of any kind. */
export const isDesignTable = (table: string) => table === DESIGN_TABLE || table.startsWith(`${DESIGN_TABLE}/`);

/** A change to a hosted file, as live clients see it. */
export interface Change {
  kind: ChangeKind;
  /** Hosted file (store) name. */
  file: string;
  /** Base table name. */
  table: string;
  /** Absent for truncate. */
  recordId?: number;
  modId?: number;
  /** Account that made the change, when known. */
  account?: string;
  /** Session that made the change (lock owner key); never sent to other clients. */
  owner?: string;
  /** An update: the fields whose values changed. */
  fields?: string[];
  /** Design mode: the layouts a design change touched, or the objects someone has selected. */
  ids?: number[];
  /** Made by another server process of a cluster (passed on here), not this one. */
  remote?: boolean;
}

/** How long a lock lasts without renewal. Clients renew while the user is still editing. */
export const LOCK_TTL_MS = 60_000;

/** Host resource guard, not a FileMaker limit. Per file/session, shared by cluster workers. */
export const MAX_SESSION_LOCKS = 100_000;
const LOCK_SWEEP_MS = 5000;

interface TransactionLeases {
  locks: Map<RecordLocks, Map<string, RecordLock>>;
  nextRenewal: number;
  timer: ReturnType<typeof setInterval>;
  failure?: unknown;
}
const transactionLeases = new WeakMap<Transaction, TransactionLeases>();

/** Renew at step/bulk-loop boundaries as well as during asynchronous waits. Never reclaim a lost lease. */
export function renewTransactionLocks(tx: Transaction, force = false): void {
  const leases = transactionLeases.get(tx);
  if (!leases) return;
  if (leases.failure !== undefined) throw leases.failure;
  const now = monotonicClock.now();
  if (!force && now < leases.nextRenewal) return;
  try {
    // Each lock table renews in its own clock: monotonic in memory, epoch in the shared file.
    for (const [locks, records] of leases.locks) locks.renew(records.values());
    leases.nextRenewal = now + LOCK_TTL_MS / 2;
  } catch (e) {
    leases.failure = e;
    clearInterval(leases.timer);
    throw e;
  }
}

function holdTransactionLock(locks: RecordLocks, lock: RecordLock): void {
  const tx = writer.getStore()?.transaction?.open;
  if (!tx) return;
  let leases = transactionLeases.get(tx);
  if (!leases) {
    const timer = setInterval(() => {
      // Surface failures at the next script step/commit, not as an uncaught timer exception.
      try { renewTransactionLocks(tx); } catch { /* retained by renewTransactionLocks */ }
    }, LOCK_TTL_MS / 2);
    timer.unref();
    leases = { locks: new Map(), nextRenewal: monotonicClock.now() + LOCK_TTL_MS / 2, timer };
    transactionLeases.set(tx, leases);
  }
  let records = leases.locks.get(locks);
  if (!records) leases.locks.set(locks, records = new Map());
  records.set(JSON.stringify([lock.table, lock.recordId]), lock);
}

/** How long someone counts as looking at a record without renewal. Clients renew while it is on screen. */
export const VIEW_TTL_MS = 45_000;

/**
 * Record locks, and presence: who is looking at which record. Presence is
 * not a lock (FileMaker has no such thing); it lets people see that someone
 * else has the same record open before they start typing.
 */
export class RecordLocks {
  private readonly locks = new Map<string, RecordLease>();
  private readonly viewing = new Map<string, RecordLease>();
  private readonly counts = new Map<string, number>();
  private nextSweep = 0;
  protected readonly maxLocksPerSession: number;

  constructor(maxLocksPerSession = Number(process.env.TABULARIUS_MAX_SESSION_LOCKS ?? MAX_SESSION_LOCKS)) {
    if (!Number.isSafeInteger(maxLocksPerSession) || maxLocksPerSession < 1) throw new RangeError('TABULARIUS_MAX_SESSION_LOCKS must be a positive safe integer');
    this.maxLocksPerSession = maxLocksPerSession;
  }

  private key(table: string, recordId: number): string {
    return `${table}\u0000${recordId}`;
  }

  protected count(owner: string): number { return this.counts.get(owner) ?? 0; }

  private remove(k: string, lock: RecordLock): void {
    this.locks.delete(k);
    const count = this.count(lock.owner) - 1;
    if (count) this.counts.set(lock.owner, count);
    else this.counts.delete(lock.owner);
  }

  protected sweep(now: number): void {
    for (const [k, lease] of this.locks) if (lease.until <= now) this.remove(k, lease.lock);
  }

  /** O(1) count lookup; sweep periodically, or before refusing capacity occupied by stale leases. */
  protected checkCapacity(owner: string, now: number): void {
    if (now >= this.nextSweep || this.count(owner) >= this.maxLocksPerSession) {
      this.sweep(now);
      this.nextSweep = now + LOCK_SWEEP_MS;
    }
    if (this.count(owner) >= this.maxLocksPerSession) throw new StoreError(812, `Exceeded host's capacity: a session may hold at most ${this.maxLocksPerSession} record locks per file (TABULARIUS_MAX_SESSION_LOCKS)`);
  }

  /** The live lock on a record, if any. Optional `now` is in this implementation's clock domain. */
  holder(table: string, recordId: number, now = monotonicClock.now()): RecordLock | undefined {
    const k = this.key(table, recordId);
    const lease = this.locks.get(k);
    if (lease && lease.until <= now) {
      this.remove(k, lease.lock);
      return undefined;
    }
    return lease?.lock;
  }

  /**
   * Takes or renews a lock. Returns the lock when the owner holds it now,
   * or the other owner's lock when the record is in use.
   */
  acquire(table: string, recordId: number, owner: string, account: string, now = monotonicClock.now()): { ok: boolean; lock: RecordLock; fresh: boolean } {
    const current = this.holder(table, recordId, now);
    if (current && current.owner !== owner) return { ok: false, lock: current, fresh: false };
    if (!current) this.checkCapacity(owner, now);
    const lock: RecordLock = { table, recordId, owner, account, expires: Date.now() + LOCK_TTL_MS };
    this.locks.set(this.key(table, recordId), { lock, until: now + LOCK_TTL_MS });
    if (!current) this.counts.set(owner, this.count(owner) + 1);
    holdTransactionLock(this, lock);
    return { ok: true, lock, fresh: !current };
  }

  /** Renew an entire transaction's leases without allowing an expired or stolen lock to be reacquired. */
  renew(records: Iterable<RecordLock>, now = monotonicClock.now()): void {
    for (const record of records) {
      const current = this.holder(record.table, record.recordId, now);
      const lease = this.locks.get(this.key(record.table, record.recordId));
      if (!current || !lease || current.owner !== record.owner) throw new StoreError(301, 'A transaction record lock expired or was released');
      lease.until = now + LOCK_TTL_MS;
      lease.lock.expires = Date.now() + LOCK_TTL_MS;
    }
  }

  /** Releases a lock the owner holds. Returns whether there was one. */
  release(table: string, recordId: number, owner: string): boolean {
    const k = this.key(table, recordId);
    const lease = this.locks.get(k);
    if (!lease || lease.lock.owner !== owner) return false;
    this.remove(k, lease.lock);
    return true;
  }

  /** Releases every lock an owner holds (logout, session expiry), returning them. */
  releaseOwner(owner: string): RecordLock[] {
    const out: RecordLock[] = [];
    for (const [k, { lock }] of this.locks) {
      if (lock.owner !== owner) continue;
      this.remove(k, lock);
      out.push(lock);
    }
    return out;
  }

  /** Live locks in a table held by someone other than `owner`. */
  othersIn(table: string, owner: string | undefined, now?: number): RecordLock[] {
    // Let all() choose its clock: SharedRecordLocks uses persisted epoch leases.
    return this.all(now).filter((l) => l.table === table && l.owner !== owner);
  }

  all(now = monotonicClock.now()): RecordLock[] {
    this.sweep(now);
    return [...this.locks.values()].map(({ lock }) => lock);
  }

  /** Marks a session as looking at a record, or renews it. Returns whether it is new. */
  view(table: string, recordId: number, owner: string, account: string, now = monotonicClock.now()): boolean {
    const k = `${owner}\u0000${this.key(table, recordId)}`;
    const fresh = !((this.viewing.get(k)?.until ?? -Infinity) > now);
    const lock: RecordLock = { table, recordId, owner, account, expires: Date.now() + VIEW_TTL_MS };
    this.viewing.set(k, { lock, until: now + VIEW_TTL_MS });
    return fresh;
  }

  /** A session stopped looking at a record. Returns whether it was. */
  leave(table: string, recordId: number, owner: string): boolean {
    return this.viewing.delete(`${owner}\u0000${this.key(table, recordId)}`);
  }

  /** Forgets every record a session was looking at (logout), returning them. */
  leaveOwner(owner: string): RecordLock[] {
    const out: RecordLock[] = [];
    for (const [k, { lock: v }] of this.viewing) {
      if (v.owner !== owner) continue;
      this.viewing.delete(k);
      out.push(v);
    }
    return out;
  }

  /** Who is looking at which record now. */
  viewers(now = monotonicClock.now()): RecordLock[] {
    for (const [k, v] of this.viewing) if (v.until <= now) this.viewing.delete(k);
    return [...this.viewing.values()].map(({ lock }) => lock);
  }
}

/**
 * Record locks kept in a SQLite file several server processes share, so a
 * record one of them is editing is locked for all (see the server's cluster).
 * Each acquire is one transaction, so two processes can't both take a lock.
 * Its optional `now` arguments remain epoch milliseconds, shared across processes.
 */
export class SharedRecordLocks extends RecordLocks {
  private readonly db: DatabaseSync;
  private readonly file: string;

  constructor(db: DatabaseSync, file: string, maxLocksPerSession?: number) {
    super(maxLocksPerSession);
    this.db = db;
    this.file = file.toLowerCase();
    db.exec(`CREATE TABLE IF NOT EXISTS locks (file TEXT NOT NULL, tbl TEXT NOT NULL, record_id INTEGER NOT NULL,
      owner TEXT NOT NULL, account TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY (file, tbl, record_id))`);
    db.exec(`CREATE TABLE IF NOT EXISTS viewing (file TEXT NOT NULL, tbl TEXT NOT NULL, record_id INTEGER NOT NULL,
      owner TEXT NOT NULL, account TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY (file, owner, tbl, record_id))`);
    // Bootstrap once, including leases left by an earlier version. Triggers keep counts exact across
    // workers, expiry, owner changes and rollback, without enumerating locks on each acquire.
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lock_counts'").get()) {
        db.exec(`
          CREATE TABLE lock_counts (file TEXT NOT NULL, owner TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (file, owner));
          INSERT INTO lock_counts SELECT file, owner, count(*) FROM locks GROUP BY file, owner;
          CREATE INDEX locks_expiry ON locks (file, expires);
          CREATE INDEX locks_owner ON locks (file, owner);
          CREATE TRIGGER locks_count_insert AFTER INSERT ON locks BEGIN
            INSERT INTO lock_counts (file, owner, n) VALUES (new.file, new.owner, 1)
              ON CONFLICT (file, owner) DO UPDATE SET n = n + 1;
          END;
          CREATE TRIGGER locks_count_delete AFTER DELETE ON locks BEGIN
            UPDATE lock_counts SET n = n - 1 WHERE file = old.file AND owner = old.owner;
            DELETE FROM lock_counts WHERE file = old.file AND owner = old.owner AND n = 0;
          END;
          CREATE TRIGGER locks_count_update AFTER UPDATE OF file, owner ON locks
            WHEN old.file != new.file OR old.owner != new.owner BEGIN
            UPDATE lock_counts SET n = n - 1 WHERE file = old.file AND owner = old.owner;
            DELETE FROM lock_counts WHERE file = old.file AND owner = old.owner AND n = 0;
            INSERT INTO lock_counts (file, owner, n) VALUES (new.file, new.owner, 1)
              ON CONFLICT (file, owner) DO UPDATE SET n = n + 1;
          END;
        `);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  protected override count(owner: string): number {
    return Number(this.db.prepare('SELECT n FROM lock_counts WHERE file = ? AND owner = ?').get(this.file, owner)?.n ?? 0);
  }

  protected override sweep(now: number): void {
    this.db.prepare('DELETE FROM locks WHERE file = ? AND expires <= ?').run(this.file, now);
  }

  private row(r: Record<string, unknown>): RecordLock {
    return { table: String(r.tbl), recordId: Number(r.record_id), owner: String(r.owner), account: String(r.account), expires: Number(r.expires) };
  }

  override holder(table: string, recordId: number, now = Date.now()): RecordLock | undefined {
    const r = this.db.prepare('SELECT * FROM locks WHERE file = ? AND tbl = ? AND record_id = ? AND expires > ?').get(this.file, table, recordId, now);
    return r ? this.row(r) : undefined;
  }

  override acquire(table: string, recordId: number, owner: string, account: string, now = Date.now()): { ok: boolean; lock: RecordLock; fresh: boolean } {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.holder(table, recordId, now);
      if (current && current.owner !== owner) {
        this.db.exec('COMMIT');
        return { ok: false, lock: current, fresh: false };
      }
      // Count and insert under the same write lock: separate workers cannot exceed the cap together.
      if (!current) this.checkCapacity(owner, now);
      const lock: RecordLock = { table, recordId, owner, account, expires: now + LOCK_TTL_MS };
      this.db.prepare(`INSERT INTO locks (file, tbl, record_id, owner, account, expires) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (file, tbl, record_id) DO UPDATE SET owner = excluded.owner, account = excluded.account, expires = excluded.expires`).run(this.file, table, recordId, owner, account, lock.expires);
      this.db.exec('COMMIT');
      holdTransactionLock(this, lock);
      return { ok: true, lock, fresh: !current };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  override renew(records: Iterable<RecordLock>, now = Date.now()): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const update = this.db.prepare('UPDATE locks SET expires = ? WHERE file = ? AND tbl = ? AND record_id = ? AND owner = ? AND expires > ?');
      for (const record of records) {
        if (!update.run(now + LOCK_TTL_MS, this.file, record.table, record.recordId, record.owner, now).changes) {
          throw new StoreError(301, 'A transaction record lock expired or was released');
        }
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  override release(table: string, recordId: number, owner: string): boolean {
    return Number(this.db.prepare('DELETE FROM locks WHERE file = ? AND tbl = ? AND record_id = ? AND owner = ?').run(this.file, table, recordId, owner).changes) > 0;
  }

  override releaseOwner(owner: string): RecordLock[] {
    const rows = this.db.prepare('DELETE FROM locks WHERE file = ? AND owner = ? RETURNING *').all(this.file, owner);
    return rows.map((r) => this.row(r));
  }

  override all(now = Date.now()): RecordLock[] {
    this.sweep(now);
    return this.db.prepare('SELECT * FROM locks WHERE file = ?').all(this.file).map((r) => this.row(r));
  }

  override view(table: string, recordId: number, owner: string, account: string, now = Date.now()): boolean {
    const was = this.db.prepare('SELECT expires FROM viewing WHERE file = ? AND owner = ? AND tbl = ? AND record_id = ?').get(this.file, owner, table, recordId);
    this.db.prepare('INSERT OR REPLACE INTO viewing (file, tbl, record_id, owner, account, expires) VALUES (?, ?, ?, ?, ?, ?)').run(this.file, table, recordId, owner, account, now + VIEW_TTL_MS);
    return !(Number(was?.expires ?? 0) > now);
  }

  override leave(table: string, recordId: number, owner: string): boolean {
    return Number(this.db.prepare('DELETE FROM viewing WHERE file = ? AND owner = ? AND tbl = ? AND record_id = ?').run(this.file, owner, table, recordId).changes) > 0;
  }

  override leaveOwner(owner: string): RecordLock[] {
    return this.db.prepare('DELETE FROM viewing WHERE file = ? AND owner = ? RETURNING *').all(this.file, owner).map((r) => this.row(r));
  }

  override viewers(now = Date.now()): RecordLock[] {
    this.db.prepare('DELETE FROM viewing WHERE file = ? AND expires <= ?').run(this.file, now);
    return this.db.prepare('SELECT * FROM viewing WHERE file = ?').all(this.file).map((r) => this.row(r));
  }
}
