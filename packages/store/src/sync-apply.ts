// The write leg of tier-2 sync (store/src/sync.ts plans; this applies): it sends
// the records the plan says go to FileMaker Server, through a RemoteWriter (the
// Data API client in server/src/fms-sync.ts, or a fake in tests).
//
// What it does and doesn't do:
//  - `write` PUSHES (local -> FileMaker) and `pull` PULLS (FileMaker -> here); each
//    is its own opt-in, and whichever isn't asked for is counted and left alone.
//  - It plans first, from one snapshot, and writes from that same snapshot. If
//    the plan holds any conflict nothing at all is written; a resolution (a
//    table's own policy, or `resolve`) turns a conflict into a push or a pull
//    before this point, and conflicts the policies don't decide (a record
//    deleted on one side and changed on the other) always stop the run.
//  - Without `write` or `pull` it is a dry run: it opens no bookkeeping table and
//    sends nothing. The caller also decides, before ever passing `write`, whether
//    this file is allowed to sync out (see server/src/fms-sync.ts).
//  - Every write to FileMaker has a row in `_fm_sync_log` made BEFORE the request
//    goes out and finished with the outcome after, so a crash in between leaves a
//    row that says what was in flight.
//  - It is idempotent and resumable: each write updates the sync map in the same
//    step, so a rerun plans only what is left. A write that reached FileMaker but
//    wasn't recorded (a crash, a timeout) shows up next run as the same record on
//    both sides, which is adopted into the map rather than written again.
//  - Updates carry the record's modId so FileMaker itself refuses (error 306) one
//    that changed since it was read; deletes check it first. Deletes (either way)
//    are held unless `allowDeletes` is set. A pull writes through the Store's own
//    create, update and delete with auto-enter off (like an import), passing the
//    record's modId so a record edited here meanwhile is refused, not overwritten.
//    A pulled delete cascades by the file's relationships, as a delete here does, unless `keepRelated` is set;
//    the records that went with it are counted (`pulled.related`).
import { crashPoint } from './crash-point.ts';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { q } from './import.ts';
import type { FieldType } from '../../fmp12/src/index.ts';
import { StoreError, type Store } from './store.ts';
import { writer } from './activity.ts';
import {
  DEFAULT_CONFLICT_POLICY, ensureSyncTables, readLocalRecords, sameValue, settleClash, syncPlanDetailed, tableKey,
  type ConflictPolicy, type DetailedPlan, type FieldClash, type LocalRecord, type PlanItem, type SyncLocal, type PlanConflict, type RemoteFile, type RemoteRecord, type RemoteSource, type SyncMapEntry, type TablePlan, type TableSyncConfig,
} from './sync.ts';

/** A write FileMaker (or the writer) refused. `recordLevel` ones are this record's problem, so the run goes on to the next. */
export class SyncWriteError extends Error {
  code: string;
  recordLevel: boolean;
  constructor(message: string, code: string, recordLevel = false) {
    super(message);
    this.code = code;
    this.recordLevel = recordLevel;
  }
}

/**
 * The ways to change a FileMaker Server's records the apply step uses. All writes of this module go through it.
 * Writers must call beforeSend synchronously immediately before dispatch, after authentication and any other
 * awaits. If it throws, no request may be sent. It checks and consumes the review at the write boundary.
 */
export interface RemoteWriter {
  /** The fields on a layout a write may set: stored, not global, not repeating. */
  writableFields(layout: string): Promise<Set<string>>;
  create(layout: string, fieldData: Record<string, string | number>, beforeSend?: () => void): Promise<{ recordId: string; modId: string }>;
  /** Sets fields, refused by FileMaker (error 306) when the record's modId is no longer `modId`. */
  update(layout: string, recordId: string, fieldData: Record<string, string | number>, modId: string, beforeSend?: () => void): Promise<{ modId: string }>;
  /** One record as it is now; undefined when it's gone. */
  read(layout: string, recordId: string): Promise<RemoteRecord | undefined>;
  delete(layout: string, recordId: string, beforeSend?: () => void): Promise<void>;
  /** Puts a file in a container field of a record (repetition 1) and says the record's modId after. Optional: a writer without it sends no files. */
  uploadContainer?(layout: string, recordId: string, field: string, file: RemoteFile, beforeSend?: () => void): Promise<{ modId: string }>;
}

export interface ApplyOptions {
  /** Send the plan's pushes to FileMaker. */
  write: boolean;
  /** Bring the plan's pulls here: creates, updates and (with allowDeletes) deletes in this file. Without write or pull: a dry run. */
  pull?: boolean;
  /** Settles conflicts for tables whose own policy is the default `flag`. */
  resolve?: ConflictPolicy;
  /** Send deletions too (otherwise they're held and counted). */
  allowDeletes?: boolean;
  /** A deletion pulled from FileMaker leaves alone the records related to it through this file's "delete related records" relationships. */
  keepRelated?: boolean;
  /**
   * The owner's call on conflicts, one per record: keep `mine` (this file's version goes to FileMaker) or `theirs`
   * (FileMaker's comes here). A resolved conflict becomes an ordinary push or pull, so it needs `write` or `pull`
   * to take effect. Its reviewToken must match the setup and both record versions (including deletions)
   * returned by the check; a changed or missing token refuses the whole run. Local states are checked
   * again after awaits; a change during apply refuses further writes. Tokens expire on process restart.
   */
  resolutions?: Resolution[];
  /** Destination and setup identity, supplied by the connection owner. */
  reviewIdentity?: string;
  /** Refuse further local reads or writes after the hosted file is paused, closed or changed. Called after every await. */
  assertWritable?: () => void;
  /** Stop after this many records FileMaker refused (default 20). */
  maxFailures?: number;
  /**
   * Container files, up to `maxBytes` each. With `pull`: also bring the files of the records pulled (and of records
   * changed on FileMaker that differ only in a container). With `write`: also send the files of the records sent (and of
   * records changed here only in a container). In a dry run, count what would be fetched or sent. Off unless given.
   */
  containers?: { maxBytes: number };
  /** Who is writing, for the log: the FileMaker account and server. */
  actor?: string;
  now?: () => Date;
  runId?: string;
  /** Planned record steps processed so far; ETA is a measured-rate estimate and absent before two steps. */
  onProgress?: (progress: { completed: number; total: number; elapsedMs: number; etaMs: number | null }) => void;
}

export interface Resolution { table: string; uuid: string; keep: 'mine' | 'theirs'; reviewToken: string }

export interface FailedWrite { uuid: string; op: string; error: string }

/** What one table did (or, in a dry run, would do). */
export interface TableApply {
  localTable: string;
  layout: string;
  /** Why the table was skipped, when it was. */
  skipped?: string;
  created: number;
  updated: number;
  deleted: number;
  /** In sync already by the time its turn came (nothing to send), or only recorded in the map. */
  adopted: number;
  /** Deletions held because deletes weren't allowed. */
  heldDeletes: number;
  /** Records brought here (in a dry run, that would be). */
  pulled: { created: number; updated: number; deleted: number; /** Records deleted along with the deleted ones, by this file's relationships. */ related: number };
  /** Pulled deletions held because deletes weren't allowed. */
  heldPullDeletes: number;
  /** Records to bring here, left alone because `pull` wasn't asked for. */
  pendingPulls: number;
  /** Records to send, left alone because `write` wasn't asked for. */
  pendingPushes: number;
  /** Container files: fetched and compared (in a dry run, that would be), set or emptied here, and the ones left alone with why. */
  containers: { checked: number; pulled: number; cleared: number; unchanged: number; toSend: number; sent: number; skipped: { uuid: string; field: string; reason: string }[] };
  /** Fields left out of every write: they're not on the layout, or can't be set. */
  unsentFields: string[];
  failed: FailedWrite[];
}

export interface ApplyResult {
  runId: string;
  write: boolean;
  pull: boolean;
  plans: TablePlan[];
  /** Set when the plan or a changed review refused record writes; earlier completed writes remain recorded. */
  refused?: string;
  tables: TableApply[];
  /** Set when the run stopped early (and why); rerun to resume. */
  stopped?: string;
  /** Writes of an earlier run that never finished, now marked interrupted. */
  interrupted: number;
  /**
   * Only when container files were asked for: whether the plan compared them. False where the local file is opened
   * read-only (the command-line dry run), which can't read its files: records changed on both sides that differ only
   * in a file are then missing from the conflicts.
   */
  containersCompared?: boolean;
}

// Reviews are authenticated by this process; a restart requires a fresh check.
const reviewKey = randomBytes(32);

const iso = (d: Date): string => d.toISOString();

const sqlText = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

/** One audit row in `_fm_sync_log`. */
function logRow(store: SyncLocal, runId: string, at: string, row: { key?: string; layout?: string; uuid?: string; op: string; status: string; remoteRecordId?: string | null; before?: string | null; after?: string | null; fields?: string[]; detail?: string }): number {
  const r = store.sql.prepare(
    'INSERT INTO _fm_sync_log (run_id, at, table_key, layout, uuid, op, status, remote_record_id, mod_id_before, mod_id_after, fields, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(runId, at, sqlText(row.key), sqlText(row.layout), sqlText(row.uuid), row.op, row.status, sqlText(row.remoteRecordId), sqlText(row.before), sqlText(row.after), row.fields ? JSON.stringify(row.fields) : null, sqlText(row.detail));
  return Number(r.lastInsertRowid);
}

const finishRow = (store: SyncLocal, id: number, status: string, f: { remoteRecordId?: string | null; after?: string | null; detail?: string } = {}): void => {
  store.sql.prepare('UPDATE _fm_sync_log SET status = ?, remote_record_id = coalesce(?, remote_record_id), mod_id_after = ?, detail = coalesce(?, detail) WHERE id = ?')
    .run(status, sqlText(f.remoteRecordId), sqlText(f.after), sqlText(f.detail), id);
};

/** Run `fn` as one unit in the local file (a savepoint, so it nests inside any transaction). */
function atomically<T>(store: SyncLocal, fn: () => T): T {
  const name = `sync_${randomUUID().replace(/-/g, '')}`;
  store.sql.exec(`SAVEPOINT ${name}`);
  try {
    const out = fn();
    store.sql.exec(`RELEASE ${name}`);
    return out;
  } catch (e) {
    store.sql.exec(`ROLLBACK TO ${name}`);
    store.sql.exec(`RELEASE ${name}`);
    throw e;
  }
}

const upsertMap = (store: SyncLocal, key: string, e: SyncMapEntry): void => {
  store.sql.prepare(
    `INSERT INTO _fm_sync_map (table_key, uuid, local_record_id, last_local_mod_id, remote_record_id, last_remote_mod_id, last_remote_mod_ts) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (table_key, uuid) DO UPDATE SET local_record_id = excluded.local_record_id, last_local_mod_id = excluded.last_local_mod_id,
       remote_record_id = excluded.remote_record_id, last_remote_mod_id = excluded.last_remote_mod_id, last_remote_mod_ts = excluded.last_remote_mod_ts`,
  ).run(key, e.uuid, e.localRecordId, e.lastLocalModId, e.remoteRecordId, e.lastRemoteModId, e.lastRemoteModTs);
};

const dropMap = (store: SyncLocal, key: string, uuid: string): void => {
  store.sql.prepare('DELETE FROM _fm_sync_map WHERE table_key = ? AND uuid = ?').run(key, uuid);
  store.sql.prepare('DELETE FROM _fm_sync_container_pending WHERE table_key = ? AND uuid = ?').run(key, uuid);
};

const markContainersPending = (store: SyncLocal, key: string, uuid: string, files: { field: string }[]): void => {
  const insert = store.sql.prepare('INSERT OR IGNORE INTO _fm_sync_container_pending (table_key, uuid, field) VALUES (?, ?, ?)');
  for (const f of files) insert.run(key, uuid, f.field);
};

const clearContainersPending = (store: SyncLocal, key: string, uuid: string, fields: string[]): void => {
  const remove = store.sql.prepare('DELETE FROM _fm_sync_container_pending WHERE table_key = ? AND uuid = ? AND field = ?');
  for (const field of fields) remove.run(key, uuid, field);
};

/**
 * The container fields an earlier run did not finish sending, by record uuid. The policy for them:
 * - A file owed is this side's until sent: no pull empties or replaces it, and it replaces a different file FileMaker holds for the field.
 * - It stays owed while FileMaker holds a change here that a pull has not brought (a field, or another container): the retry waits for that pull.
 * - A file that cannot be sent when the retry runs (missing on disk, too big, the field no longer on the layout or writable)
 *   is reported and forgotten: it is not sent when it comes back, only if a later comparison finds it different.
 */
function owedContainers(store: SyncLocal, key: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let rows: { uuid: string; field: string }[] = [];
  try {
    rows = store.sql.prepare('SELECT uuid, field FROM _fm_sync_container_pending WHERE table_key = ?').all(key) as typeof rows;
  } catch (e) {
    // A file that has never been written to by a sync has no such table yet: nothing is owed.
    if (!/no such table/.test((e as Error).message)) throw e;
  }
  for (const { uuid, field } of rows) out.set(uuid, (out.get(uuid) ?? new Set()).add(field));
  return out;
}

/** Why a table was held back from writing by an earlier run, or undefined. */
function heldReason(store: SyncLocal, key: string): string | undefined {
  const row = store.sql.prepare('SELECT paused, paused_reason FROM _fm_sync_state WHERE table_key = ?').get(key) as { paused: number; paused_reason: string | null } | undefined;
  return row?.paused ? row.paused_reason ?? 'paused by an earlier run' : undefined;
}

function holdTable(store: SyncLocal, key: string, reason: string): void {
  store.sql.prepare(
    'INSERT INTO _fm_sync_state (table_key, paused, paused_reason) VALUES (?, 1, ?) ON CONFLICT (table_key) DO UPDATE SET paused = 1, paused_reason = excluded.paused_reason',
  ).run(key, reason);
}

/** Lets tables an earlier run held back write again (after the cause was fixed). Returns how many were held. */
export function releaseHeldTables(store: SyncLocal, fileName: string, configs: TableSyncConfig[]): number {
  ensureSyncTables(store);
  let n = 0;
  for (const c of configs) {
    const key = tableKey(fileName, c.localTable);
    if (heldReason(store, key) !== undefined) n++;
    store.sql.prepare('UPDATE _fm_sync_state SET paused = 0, paused_reason = NULL WHERE table_key = ?').run(key);
  }
  return n;
}

/** The audit log, oldest first; one run's, or every run's. */
export interface SyncLogRow { id: number; runId: string; at: string; table: string | null; layout: string | null; uuid: string | null; op: string; status: string; remoteRecordId: string | null; modIdBefore: string | null; modIdAfter: string | null; fields: string[] | null; detail: string | null }

export function readSyncLog(store: Pick<Store, 'sql'>, opts: { runId?: string; limit?: number } = {}): SyncLogRow[] {
  if (!store.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_fm_sync_log'").get()) return [];
  const rows = (opts.runId
    ? store.sql.prepare(`SELECT * FROM _fm_sync_log WHERE run_id = ? ORDER BY id${opts.limit === undefined ? '' : ' LIMIT ?'}`).all(opts.runId, ...(opts.limit === undefined ? [] : [opts.limit]))
    : store.sql.prepare('SELECT * FROM (SELECT * FROM _fm_sync_log ORDER BY id DESC LIMIT ?) ORDER BY id').all(opts.limit ?? 200)) as Record<string, string | number | null>[];
  return rows.map((r) => ({
    id: Number(r.id), runId: String(r.run_id), at: String(r.at), table: (r.table_key as string | null)?.split('\u0000')[1] ?? null, layout: r.layout as string | null, uuid: r.uuid as string | null,
    op: String(r.op), status: String(r.status), remoteRecordId: r.remote_record_id as string | null, modIdBefore: r.mod_id_before as string | null, modIdAfter: r.mod_id_after as string | null,
    fields: r.fields ? JSON.parse(String(r.fields)) : null, detail: r.detail as string | null,
  }));
}

/** Turns reviewed conflicts into pushes and pulls in the plan; returns the ones that were no longer conflicts. */
function resolveConflicts(store: SyncLocal, details: DetailedPlan[], list: Resolution[]): string[] {
  const current = new Map(details.map((d) => [d, d.plan.paused ? [] : readLocalRecords(store, d.config)]));
  const stale: string[] = [];
  for (const r of list) {
    const d = details.find((x) => x.config.localTable === r.table);
    const i = d ? d.plan.conflicts.findIndex((c) => c.uuid === r.uuid) : -1;
    const reviewed = d?.locals.find((l) => l.uuid === r.uuid);
    const local = d && current.get(d)!.find((l) => l.uuid === r.uuid);
    if (!d || i < 0 || !r.reviewToken || r.reviewToken !== d.plan.conflicts[i].reviewToken
      || local?.recordId !== reviewed?.recordId || local?.modId !== reviewed?.modId) {
      stale.push(`${r.table} ${r.uuid}`);
      continue;
    }
    const [c] = d.plan.conflicts.splice(i, 1);
    const mine = r.keep === 'mine';
    // Deleted here and changed there: mine deletes there, theirs makes it here again. The other way round likewise.
    const [direction, op] = c.localRecordId === null ? (mine ? ['push', 'delete'] : ['pull', 'create'])
      : c.remoteRecordId === null ? (mine ? ['push', 'create'] : ['pull', 'delete'])
      : [mine ? 'push' : 'pull', 'update'];
    const item = { uuid: c.uuid, direction, op, reason: `conflict: kept ${mine ? 'mine' : 'FileMaker\'s'} (reviewed)` } as PlanItem;
    (direction === 'push' ? d.plan.pushes : d.plan.pulls).push(item);
  }
  const byUuid = (a: { uuid: string }, b: { uuid: string }) => (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0);
  for (const d of details) {
    d.plan.pushes.sort(byUuid);
    d.plan.pulls.sort(byUuid);
  }
  return stale;
}

/** Whether a delete in this file can take other records with it. */
const cascading = (store: Store) => store.schema.relationships.some((r) => r.leftDelete || r.rightDelete);
const recordsIn = (store: Store) => store.schema.tables.reduce((n, t) => n + (store.sql.prepare(`SELECT COUNT(*) AS n FROM ${q(t.name)}`).get() as { n: number }).n, 0);

const blank = (t: TableSyncConfig): TableApply => ({ localTable: t.localTable, layout: t.remoteLayout, created: 0, updated: 0, deleted: 0, adopted: 0, heldDeletes: 0, pulled: { created: 0, updated: 0, deleted: 0, related: 0 }, heldPullDeletes: 0, pendingPulls: 0, pendingPushes: 0, containers: { checked: 0, pulled: 0, cleared: 0, unchanged: 0, toSend: 0, sent: 0, skipped: [] }, unsentFields: [], failed: [] });

/** A conflict as one line for a refusal. */
const conflictLine = (c: PlanConflict, table: string): string =>
  `${table} ${c.uuid}: ${c.localRecordId === null ? 'deleted here, changed on FileMaker' : c.remoteRecordId === null ? 'changed here, deleted on FileMaker' : `changed on both sides (${c.clashes.map((f) => f.field).join(', ')})`}`;

/** A value as the Data API takes it: dates and timestamps in its US form, numbers as numbers. */
function sendable(store: { present?: Store['present'] }, value: unknown, type: FieldType | undefined): string | number | undefined {
  if (value === null || value === undefined) return '';
  if (value instanceof Uint8Array) return undefined;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number') return value;
  // (A dry run's read-only file has no `present`; it only counts what differs, so the form doesn't matter.)
  return store.present ? (store.present(String(value), type ?? 'text', 'us') as string | number) : String(value);
}

/**
 * Plan the sync, and, with `write`, send what it says goes to FileMaker.
 * `configs` must already have been cleared to write (server/src/fms-sync.ts).
 */
async function applySyncRun(store: SyncLocal & Partial<Pick<Store, 'present' | 'create' | 'update' | 'delete'>>, fileName: string, configs: TableSyncConfig[], remote: RemoteSource, writer: RemoteWriter | Pick<RemoteWriter, 'writableFields'>, opts: ApplyOptions): Promise<ApplyResult> {
  // A dry run is given only the read of a layout's fields; nothing here can send a write without a full writer.
  if (opts.write && !('create' in writer)) throw new Error('a write needs a writer');
  if (opts.pull && !('create' in store)) throw new Error('a pull needs a Store that can write');
  const w = writer as RemoteWriter;
  const ls = store as Store;
  const now = opts.now ?? (() => new Date());
  const runId = opts.runId ?? randomUUID();
  const maxFailures = opts.maxFailures ?? 20;
  // The resolution fills in only where the table says nothing: a table's own policy is the owner's word.
  const effective = configs.map((c) => (opts.resolve && (c.policy ?? DEFAULT_CONFLICT_POLICY) === 'flag' ? { ...c, policy: opts.resolve } : c));
  const assertWritable = () => { opts.assertWritable?.(); };
  const details = await syncPlanDetailed(store, fileName, effective, remote, assertWritable);
  assertWritable();
  // The planner doesn't compare container files (the two sides hold an id here and an address there). With containers on, a
  // record changed on both sides whose stored fields agree is compared by its files here, and a difference is a conflict
  // like any other: settled by the table's policy, or held for review. Only where this file's containers can be read.
  const fetched = new Map<string, number>();
  const comparing = !!opts.containers && typeof ls.container === 'function' && !!remote.fetchContainer;
  if (opts.containers && typeof ls.container === 'function' && remote.fetchContainer) {
    for (const d of details) {
      if (d.plan.paused || !d.plan.convergedBoth?.length) continue;
      const tableFields = store.schema?.tables.find((x) => x.name === d.config.localTable)?.fields ?? [];
      const fields = tableFields.filter((f) => f.kind === 'normal' && f.type === 'container' && (f.options?.repetitions ?? 1) <= 1).map((f) => f.name);
      const owedHere = owedContainers(store, d.plan.tableKey);
      for (const uuid of d.plan.convergedBoth) {
        const local = d.locals.find((r) => r.uuid === uuid);
        const rem = d.remotes.find((r) => r.uuid === uuid);
        if (!local || !rem) continue;
        const cl: FieldClash[] = [];
        for (const field of fields) {
          if (!(field in rem.fields)) continue;
          // A file this side still owes FileMaker is not a difference to settle: it is sent (a record whose run ended before its upload).
          if (owedHere.get(uuid)?.has(field) && Number(local.fields[field]) > 0) continue;
          const had = Number(local.fields[field]);
          const info = Number.isInteger(had) && had > 0 ? ls.containerInfo(had) : undefined;
          const mine = info ? `${info.filename ?? 'a file'} (${info.size} bytes)` : '';
          const address = rem.fields[field] ?? '';
          if (!info && address === '') continue;
          if (address === '') { cl.push({ field, local: mine, remote: '' }); continue; }
          fetched.set(d.config.localTable, (fetched.get(d.config.localTable) ?? 0) + 1);
          let theirs: string;
          let same = false;
          try {
            const got = await remote.fetchContainer(d.config.remoteLayout, address, opts.containers.maxBytes);
            assertWritable();
            if ('skipped' in got) theirs = `a file that was not fetched (${got.skipped})`;
            else {
              theirs = `${got.filename ?? 'a file'} (${got.data.length} bytes)`;
              const current = info ? ls.container(had) : undefined;
              same = !!current && Buffer.from(current.data.buffer, current.data.byteOffset, current.data.byteLength).equals(got.data);
            }
          } catch (e) {
            assertWritable();
            theirs = `a file that was not fetched (${(e as Error).message})`;
          }
          if (!same) cl.push({ field, local: mine, remote: theirs });
        }
        if (cl.length) settleClash(d.plan, d.config, local, rem, cl);
      }
      const byUuid = (a: { uuid: string }, b: { uuid: string }) => (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0);
      d.plan.pushes.sort(byUuid);
      d.plan.pulls.sort(byUuid);
      d.plan.conflicts.sort(byUuid);
    }
  }
  for (const d of details) {
    for (const c of d.plan.conflicts) {
      const local = d.locals.find((r) => r.uuid === c.uuid);
      const remote = d.remotes.find((r) => r.uuid === c.uuid);
      c.reviewToken = createHmac('sha256', reviewKey).update(JSON.stringify([
        fileName, opts.reviewIdentity ?? null, configs, d.config.localTable, c.uuid,
        local ? [local.recordId, local.modId] : null,
        remote ? [remote.recordId, remote.modId] : null,
      ])).digest('hex');
    }
  }
  const result = { runId, write: opts.write, pull: !!opts.pull, plans: details.map((d) => d.plan), tables: [], interrupted: 0, ...(opts.containers ? { containersCompared: comparing } : {}) } as ApplyResult;
  let progressTotal = details.reduce((n, d) => n + (opts.write ? d.plan.pushes.length : 0) + (opts.pull ? d.plan.pulls.length : 0), 0);
  const progressStarted = Date.now();
  let progressCompleted = 0;
  const progress = (final = false) => {
    const elapsedMs = Date.now() - progressStarted;
    opts.onProgress?.({ completed: progressCompleted, total: progressTotal, elapsedMs,
      etaMs: progressCompleted === progressTotal ? 0
        : final ? null
          : progressCompleted >= 2 ? Math.ceil(elapsedMs / progressCompleted * (progressTotal - progressCompleted)) : null });
  };
  function* progressItems(items: PlanItem[]): Generator<PlanItem> {
    for (const item of items) {
      try { yield item; }
      finally { progressCompleted++; progress(); }
    }
  }
  progress();

  const stale = opts.resolutions?.length ? resolveConflicts(store, details, opts.resolutions) : [];
  const conflicts = details.flatMap((d) => d.plan.conflicts.map((c) => conflictLine(c, d.config.localTable)));
  if (stale.length) {
    result.refused = `${stale.length === 1 ? 'a reviewed choice no longer matches a conflict' : `${stale.length} reviewed choices no longer match a conflict`} (${stale.slice(0, 5).join('; ')}): the record changed since it was reviewed, so nothing was written. Review again.`;
  } else if (conflicts.length) {
    result.refused = `${conflicts.length} ${conflicts.length === 1 ? 'conflict' : 'conflicts'} held for review, so nothing was written: ${conflicts.slice(0, 5).join('; ')}${conflicts.length > 5 ? `; and ${conflicts.length - 5} more` : ''}. ` +
      'Settle them (a table\'s "policy" in the configuration, --resolve, or the console\'s review) and run it again.';
  }
  // Only unexecuted choices still depend on their reviewed local state. A completed pull may itself
  // change that state; every remaining choice must survive each await before any further record write.
  const pendingReviews = new Set(stale.length ? [] : opts.resolutions ?? []);
  const reviewsMatch = (): boolean => {
    const changed: string[] = [];
    for (const d of details) {
      const pending = [...pendingReviews].filter((r) => r.table === d.config.localTable);
      if (!pending.length) continue;
      const current = readLocalRecords(store, d.config);
      for (const r of pending) {
        const reviewed = d.locals.find((l) => l.uuid === r.uuid);
        const local = current.find((l) => l.uuid === r.uuid);
        if (local?.recordId !== reviewed?.recordId || local?.modId !== reviewed?.modId) changed.push(`${r.table} ${r.uuid}`);
      }
    }
    if (!changed.length) return true;
    result.refused = `a record changed since it was reviewed (${changed.slice(0, 5).join('; ')}); no further records were written. Review again.`;
    return false;
  };
  const consumeReview = (table: string, uuid: string): void => {
    for (const r of pendingReviews) if (r.table === table && r.uuid === uuid) pendingReviews.delete(r);
  };
  const live = opts.write || !!opts.pull;
  const dry = !live;
  if (live) {
    ensureSyncTables(store);
    result.interrupted = Number(store.sql.prepare("UPDATE _fm_sync_log SET status = 'interrupted' WHERE status = 'attempt' AND run_id <> ?").run(runId).changes);
    logRow(store, runId, iso(now()), { op: 'run', status: 'started', detail: JSON.stringify({ actor: opts.actor ?? null, write: opts.write, pull: !!opts.pull, resolve: opts.resolve ?? null, allowDeletes: !!opts.allowDeletes }) });
  }
  const finish = (status: string): ApplyResult => {
    assertWritable();
    if (live) logRow(store, runId, iso(now()), { op: 'run', status, detail: result.refused ?? result.stopped ?? JSON.stringify(result.tables.map((t) => ({ table: t.localTable, created: t.created, updated: t.updated, deleted: t.deleted, pulled: t.pulled, adopted: t.adopted, failed: t.failed.length }))) });
    progress(true);
    return result;
  };
  // A dry run goes on to count what each table holds even when a write would be refused; nothing is written either way.
  if (result.refused && !dry) return finish('refused');

  const types = (table: string): Map<string, { type: FieldType; kind: string }> =>
    new Map((store.schema?.tables.find((t) => t.name === table)?.fields ?? []).map((f) => [f.name, { type: f.type, kind: f.kind }]));
  let failures = 0;
  // A failed write: logged, and counted against its table. True when the run must stop here.
  const fail = (e: unknown, uuid: string, op: string, rowId: number, table: string): boolean => {
    assertWritable();
    // The Store's own refusals (validation, a record changed or locked meanwhile) are one record's problem too.
    const err = e instanceof SyncWriteError ? e : e instanceof StoreError ? new SyncWriteError(e.message, String(e.code), true) : new SyncWriteError((e as Error).message, 'error');
    if (rowId > 0) {
      const row = store.sql.prepare('SELECT status FROM _fm_sync_log WHERE id = ?').get(rowId) as { status: string } | undefined;
      if (row?.status === 'attempt') finishRow(store, rowId, 'failed', { detail: err.message });
    }
    result.tables.find((x) => x.localTable === table)!.failed.push({ uuid, op, error: err.message });
    failures++;
    if (!err.recordLevel) {
      result.stopped = `stopped at ${table} ${uuid}: ${err.message}. What was done is recorded; run it again to carry on.`;
      return true;
    }
    if (failures >= maxFailures) {
      result.stopped = `stopped after ${failures} records were refused (see the log); fix them, then run it again to carry on.`;
      return true;
    }
    return false;
  };

  tables: for (const d of details) {
    const t = blank(d.config);
    t.containers.checked += fetched.get(d.config.localTable) ?? 0;
    result.tables.push(t);
    if (d.plan.paused) {
      t.skipped = d.plan.paused;
      continue;
    }
    const held = opts.write ? heldReason(store, d.plan.tableKey) : undefined;
    if (held) {
      t.skipped = `held by an earlier run: ${held}`;
      continue;
    }
    let writable: Set<string>;
    try {
      writable = await writer.writableFields(d.config.remoteLayout);
      assertWritable();
    } catch (e) {
      assertWritable();
      if (!reviewsMatch()) return finish('refused');
      t.skipped = `couldn't read the layout's fields: ${(e as Error).message}`;
      continue;
    }
    if (!reviewsMatch()) return finish('refused');
    const fieldTypes = types(d.config.localTable);
    const sendNames = [...fieldTypes].filter(([n, f]) => f.kind === 'normal' && f.type !== 'container' && n !== d.config.modTimestampField && writable.has(n)).map(([n]) => n);
    const sendFiles = !!opts.containers && (opts.write || dry) && ('containerInfo' in store || dry);
    const repeatingHere = (n: string) => ((store.schema?.tables.find((x) => x.name === d.config.localTable)?.fields ?? []).find((f) => f.name === n)?.options?.repetitions ?? 1) > 1;
    // Containers that go with the records when files are being sent: only those on the layout, one repetition.
    const sendFileFields = sendFiles ? [...fieldTypes].filter(([n, f]) => f.kind === 'normal' && f.type === 'container' && writable.has(n) && !repeatingHere(n)).map(([n]) => n) : [];
    t.unsentFields = [...fieldTypes.keys()].filter((n) => !sendNames.includes(n) && !sendFileFields.includes(n) && n !== d.config.modTimestampField && n !== d.config.uuidField);
    const localBy = new Map(d.locals.filter((r) => r.uuid.trim() !== '').map((r) => [r.uuid, r]));
    const remoteBy = new Map(d.remotes.filter((r) => r.uuid.trim() !== '').map((r) => [r.uuid, r]));
    const key = d.plan.tableKey;
    const data = (local: LocalRecord, remoteRec: RemoteRecord | undefined): Record<string, string | number> => {
      const out: Record<string, string | number> = {};
      for (const n of sendNames) {
        if (remoteRec && n === d.config.uuidField) continue;
        const v = local.fields[n];
        if (!remoteRec && (v === null || v === undefined || v === '')) continue; // let the file's own auto-enter options fill it
        if (remoteRec && sameValue(v ?? null, remoteRec.fields[n] ?? '', fieldTypes.get(n)?.type)) continue;
        const s = sendable(store, v, fieldTypes.get(n)?.type);
        if (s !== undefined) out[n] = s;
      }
      return out;
    };

    // What a pull sets here: FileMaker's stored fields, as text; on create, the ones that aren't empty (the file's
    // own defaults stay for the rest), on update, the ones that differ.
    const pullNames = [...fieldTypes].filter(([n, f]) => f.kind === 'normal' && f.type !== 'container' && n !== d.config.modTimestampField).map(([n]) => n);
    const pullData = (loc: LocalRecord | undefined, r: RemoteRecord): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const n of pullNames) {
        if (!(n in r.fields)) continue;
        const rv = r.fields[n];
        if (loc) {
          if (n === d.config.uuidField || sameValue(loc.fields[n] ?? null, rv, fieldTypes.get(n)?.type)) continue;
        } else if (rv === '') continue;
        out[n] = rv;
      }
      return out;
    };
    // Container files owed to FileMaker by an earlier run that did not finish them (see _fm_sync_container_pending). They are this
    // side's until sent: a pull never empties or replaces one, and the owed record is retried with files only.
    const owedBy = opts.containers ? owedContainers(store, key) : new Map<string, Set<string>>();
    // A record settled for FileMaker's side (a conflict policy or a review) takes its files too, where FileMaker holds one: a file
    // owed is replaced by it (and no longer owed, in the pull's own transaction); where FileMaker's field is empty the local file stays owed.
    const giveUp = new Set(opts.containers ? d.plan.pulls.filter((item) => item.op === 'update' && /^conflict:/.test(item.reason) && owedBy.has(item.uuid)).map((item) => item.uuid) : []);
    const settledOwed = new Map<string, string[]>();
    // Whether a pull of this record would change anything here besides the files owed: a field, or another container.
    const pullWouldChange = async (loc: LocalRecord, rem: RemoteRecord, owed: Set<string>): Promise<boolean> => {
      if (Object.keys(pullData(loc, rem)).length) return true;
      for (const [field, f] of fieldTypes) {
        if (f.kind !== 'normal' || f.type !== 'container' || !(field in rem.fields) || repeatingHere(field) || owed.has(field)) continue;
        const had = Number(loc.fields[field]);
        const address = rem.fields[field];
        if (address === '') { if (Number.isInteger(had) && had > 0) return true; continue; }
        if (!remote.fetchContainer || typeof ls.container !== 'function') return true;
        try {
          const got = await remote.fetchContainer(d.config.remoteLayout, address, opts.containers!.maxBytes);
          assertWritable();
          const current = Number.isInteger(had) && had > 0 ? ls.container(had) : undefined;
          if ('skipped' in got || !current || !Buffer.from(current.data.buffer, current.data.byteOffset, current.data.byteLength).equals(got.data)) return true;
        } catch (e) {
          assertWritable();
          return true;
        }
      }
      return false;
    };
    const retryOnly = new Set<string>();
    if (opts.write && opts.containers) {
      // A pending field that can no longer be sent (the field is not sent now, the record or its file is gone here) is dropped.
      const stale: { uuid: string; field: string }[] = [];
      for (const [uuid, fields] of owedBy) {
        const here = localBy.get(uuid);
        for (const field of fields) if (!here || !sendFileFields.includes(field) || !(Number(here.fields[field]) > 0)) stale.push({ uuid, field });
      }
      if (stale.length) atomically(store, () => { for (const x of stale) clearContainersPending(store, key, x.uuid, [x.field]); });
      for (const x of stale) { const left = owedBy.get(x.uuid)!; left.delete(x.field); if (!left.size) owedBy.delete(x.uuid); }
      // A record in conflict, or already planned, is settled by the plan. A record FileMaker changed is retried only when
      // pulling it would change nothing here but the files owed (a file just uploaded changes its modId, which is all a run
      // that ended after the upload will find); otherwise it is left as it is, with its map baseline, for the pull.
      const planned = new Set([...d.plan.pushes, ...d.plan.conflicts].map((item) => item.uuid));
      const pulled = new Set(d.plan.pulls.map((item) => item.uuid));
      for (const [uuid, owed] of owedBy) {
        const here = localBy.get(uuid);
        const there = remoteBy.get(uuid);
        if (planned.has(uuid) || !here || !there) continue;
        if (pulled.has(uuid)) {
          if (await pullWouldChange(here, there, owed)) continue;
          d.plan.pulls = d.plan.pulls.filter((item) => item.uuid !== uuid);
          if (opts.pull) progressTotal--;
        }
        d.plan.pushes.push({ uuid, direction: 'push', op: 'update', reason: 'pending container upload' });
        retryOnly.add(uuid);
        progressTotal++;
      }
    }

    // Records the same on both sides but not yet in the map (a first sync of a copy, or a write that reached
    // FileMaker without being recorded), and records gone from both: bookkeeping, and no write to FileMaker.
    const inPlan = new Set([...d.plan.pushes, ...d.plan.pulls].map((i) => i.uuid).concat(d.plan.conflicts.map((c) => c.uuid)));
    const mapBy = new Map(d.map.map((m) => [m.uuid, m]));
    for (const [uuid, l] of localBy) {
      const r = remoteBy.get(uuid);
      if (!r || inPlan.has(uuid)) continue;
      const m = mapBy.get(uuid);
      if (m && m.localRecordId === l.recordId && m.lastLocalModId === l.modId && m.remoteRecordId === r.recordId && m.lastRemoteModId === r.modId) continue;
      t.adopted++;
      if (!dry) {
        atomically(store, () => {
          upsertMap(store, key, { uuid, localRecordId: l.recordId, lastLocalModId: l.modId, remoteRecordId: r.recordId, lastRemoteModId: r.modId, lastRemoteModTs: r.modTimestamp ?? null });
          logRow(store, runId, iso(now()), { key, layout: d.config.remoteLayout, uuid, op: 'adopt', status: 'ok', remoteRecordId: r.recordId, after: r.modId, detail: 'the same on both sides; recorded, nothing sent' });
        });
      }
    }
    if (d.presentRemoteUuids) {
      for (const m of d.map) {
        if (localBy.has(m.uuid) || remoteBy.has(m.uuid) || inPlan.has(m.uuid) || d.presentRemoteUuids.has(m.uuid) || m.localRecordId === null || m.remoteRecordId === null) continue;
        t.adopted++;
        if (!dry) dropMap(store, key, m.uuid);
      }
    }

    // Container files come only with a pull that asks for them. A repeating container is left alone.
    const wantContainers = !!opts.containers && (!!opts.pull || dry);
    const tableFields = store.schema?.tables.find((x) => x.name === d.config.localTable)?.fields ?? [];
    const containerFields = wantContainers ? [...fieldTypes].filter(([, f]) => f.kind === 'normal' && f.type === 'container').map(([n]) => n) : [];
    const repeating = (n: string) => (tableFields.find((f) => f.name === n)?.options?.repetitions ?? 1) > 1;
    const skipContainer = (uuid: string, field: string, reason: string) => { if (t.containers.skipped.length < 20) t.containers.skipped.push({ uuid, field, reason }); };
    // What a pulled record's container fields need here: the file now on FileMaker where it differs from ours, or
    // emptying where FileMaker's is empty. Files are fetched before anything is written, so a failed fetch leaves the record as it was.
    const containerChanges = async (loc: LocalRecord | undefined, rem: RemoteRecord): Promise<{ field: string; file: RemoteFile | null }[]> => {
      const out: { field: string; file: RemoteFile | null }[] = [];
      for (const field of containerFields) {
        if (!(field in rem.fields)) continue; // not on the layout
        if (repeating(field)) { skipContainer(rem.uuid, field, 'a repeating container isn\'t brought'); continue; }
        const address = rem.fields[field];
        const had = loc ? Number(loc.fields[field]) : NaN;
        const owedHere = had > 0 && !!owedBy.get(rem.uuid)?.has(field);
        if (owedHere && !giveUp.has(rem.uuid)) { skipContainer(rem.uuid, field, 'the file here is still owed to FileMaker: it is sent first, not replaced'); continue; }
        if (owedHere && address === '') { skipContainer(rem.uuid, field, 'the file here is still owed to FileMaker, whose field is empty: it is kept and sent'); continue; }
        const settle = () => { if (owedHere) settledOwed.set(rem.uuid, [...(settledOwed.get(rem.uuid) ?? []), field]); };
        if (address === '') {
          if (Number.isInteger(had) && had > 0) out.push({ field, file: null });
          continue;
        }
        if (!remote.fetchContainer) { skipContainer(rem.uuid, field, 'this connection can\'t fetch container files'); continue; }
        t.containers.checked++;
        const got = await remote.fetchContainer(d.config.remoteLayout, address, opts.containers!.maxBytes);
        assertWritable();
        if ('skipped' in got) { skipContainer(rem.uuid, field, got.skipped); continue; }
        const current = Number.isInteger(had) && had > 0 ? ls.container(had) : undefined;
        if (current && Buffer.from(current.data.buffer, current.data.byteOffset, current.data.byteLength).equals(got.data)) { t.containers.unchanged++; settle(); continue; }
        if (owedHere) skipContainer(rem.uuid, field, `FileMaker's file (${got.data.length} bytes) replaced the file here that was owed to it, as this record is settled for FileMaker`);
        settle();
        out.push({ field, file: got });
      }
      return out;
    };
    // Sets or empties the container fields of a record here, under the caller's savepoint; returns the record's modId then.
    const setContainers = (table: string, recordId: number, changes: { field: string; file: RemoteFile | null }[], modId: number): number => {
      for (const c of changes) modId = ls.setContainer(table, recordId, c.field, 1, c.file).modId;
      return modId;
    };
    const countContainers = (changes: { file: RemoteFile | null }[]) => {
      t.containers.pulled += changes.filter((c) => c.file).length;
      t.containers.cleared += changes.filter((c) => !c.file).length;
    };
    const rank = { create: 0, update: 1, delete: 2 };
    for (const item of progressItems([...d.plan.pulls].sort((a, b) => rank[a.op] - rank[b.op] || (a.uuid < b.uuid ? -1 : 1)))) {
      const loc = localBy.get(item.uuid);
      const rem = remoteBy.get(item.uuid);
      if (!dry && !opts.pull) {
        t.pendingPulls++;
        continue;
      }
      if (item.op === 'delete' && !opts.allowDeletes) {
        t.heldPullDeletes++;
        continue;
      }
      if (dry) {
        if (item.op === 'create') t.pulled.created++;
        else if (item.op === 'update') (loc && rem && Object.keys(pullData(loc, rem)).length ? t.pulled.updated++ : t.adopted++);
        else if (loc) t.pulled.deleted++;
        // Container files are fetched and compared only in a real pull: here, how many would be.
        if (rem && item.op !== 'delete') t.containers.checked += containerFields.filter((f) => !repeating(f) && (rem.fields[f] ?? '') !== '').length;
        continue;
      }
      if (!reviewsMatch()) return finish('refused');
      const at = iso(now());
      const layout = d.config.remoteLayout;
      const table = d.config.localTable;
      let rowId = -1;
      try {
        if (item.op === 'create') {
          if (!rem) throw new SyncWriteError(`${item.uuid}: the FileMaker record isn't in the snapshot this plan was made from`, 'snapshot-missing', true);
          const fieldData = pullData(undefined, rem);
          const files = await containerChanges(undefined, rem);
          if (files.length) { assertWritable(); if (!reviewsMatch()) return finish('refused'); }
          rowId = logRow(store, runId, at, { key, layout, uuid: item.uuid, op: 'pull-create', status: 'attempt', remoteRecordId: rem.recordId, before: rem.modId, fields: [...Object.keys(fieldData), ...files.map((c) => c.field)] });
          crashPoint('sync-apply:after-attempt');
          consumeReview(table, item.uuid);
          // The record and its files go in together: a file that can't be stored leaves no half-made record to be adopted later.
          atomically(store, () => {
            const m = ls.create(table, fieldData, { performAutoEnter: false });
            const modId = setContainers(table, m.recordId, files, m.modId);
            crashPoint('sync-apply:after-data');
            upsertMap(store, key, { uuid: item.uuid, localRecordId: m.recordId, lastLocalModId: modId, remoteRecordId: rem.recordId, lastRemoteModId: rem.modId, lastRemoteModTs: rem.modTimestamp ?? null });
            finishRow(store, rowId, 'ok', { after: String(modId) });
            crashPoint('sync-apply:after-map');
          });
          crashPoint('sync-apply:after-commit');
          countContainers(files);
          t.pulled.created++;
        } else if (item.op === 'update') {
          if (!loc || !rem) throw new SyncWriteError(`${item.uuid}: the record isn't in the snapshot this plan was made from`, 'snapshot-missing', true);
          const fieldData = pullData(loc, rem);
          const files = await containerChanges(loc, rem);
          if (files.length) { assertWritable(); if (!reviewsMatch()) return finish('refused'); }
          if (!Object.keys(fieldData).length && !files.length) {
            consumeReview(d.config.localTable, item.uuid);
            atomically(store, () => {
              upsertMap(store, key, { uuid: item.uuid, localRecordId: loc.recordId, lastLocalModId: loc.modId, remoteRecordId: rem.recordId, lastRemoteModId: rem.modId, lastRemoteModTs: rem.modTimestamp ?? null });
              logRow(store, runId, at, { key, layout, uuid: item.uuid, op: 'pull-update', status: 'noop', remoteRecordId: rem.recordId, before: String(loc.modId), after: String(loc.modId), detail: 'no field differs; nothing changed here' });
            });
            t.adopted++;
            continue;
          }
          rowId = logRow(store, runId, at, { key, layout, uuid: item.uuid, op: 'pull-update', status: 'attempt', remoteRecordId: rem.recordId, before: String(loc.modId), fields: [...Object.keys(fieldData), ...files.map((c) => c.field)] });
          crashPoint('sync-apply:after-attempt');
          // The modId makes the Store refuse (306) a record edited here since it was read.
          consumeReview(table, item.uuid);
          atomically(store, () => {
            let modId = Object.keys(fieldData).length ? ls.update(table, loc.recordId, fieldData, loc.modId, { performAutoEnter: false }).modId : loc.modId;
            // Files only: the record must still be the version that was read.
            if (!Object.keys(fieldData).length) {
              const now_ = store.sql.prepare(`SELECT _fm_mod_id AS m FROM ${q(table)} WHERE _fm_record_id = ?`).get(loc.recordId) as { m: number } | undefined;
              if (!now_ || Number(now_.m) !== loc.modId) throw new SyncWriteError(`${item.uuid}: changed here since it was read (modId ${loc.modId}); its files were not changed`, '306', true);
            }
            modId = setContainers(table, loc.recordId, files, modId);
            clearContainersPending(store, key, item.uuid, settledOwed.get(item.uuid) ?? []);
            crashPoint('sync-apply:after-data');
            upsertMap(store, key, { uuid: item.uuid, localRecordId: loc.recordId, lastLocalModId: modId, remoteRecordId: rem.recordId, lastRemoteModId: rem.modId, lastRemoteModTs: rem.modTimestamp ?? null });
            finishRow(store, rowId, 'ok', { after: String(modId) });
            crashPoint('sync-apply:after-map');
          });
          crashPoint('sync-apply:after-commit');
          countContainers(files);
          t.pulled.updated++;
        } else {
          if (!loc) {
            consumeReview(table, item.uuid);
            atomically(store, () => {
              dropMap(store, key, item.uuid);
              logRow(store, runId, at, { key, layout, uuid: item.uuid, op: 'pull-delete', status: 'noop', detail: 'already gone here' });
            });
            continue;
          }
          rowId = logRow(store, runId, at, { key, layout, uuid: item.uuid, op: 'pull-delete', status: 'attempt', before: String(loc.modId) });
          crashPoint('sync-apply:after-attempt');
          const now_ = store.sql.prepare(`SELECT _fm_mod_id AS m FROM ${q(table)} WHERE _fm_record_id = ?`).get(loc.recordId) as { m: number } | undefined;
          if (now_ && Number(now_.m) !== loc.modId) throw new SyncWriteError(`${item.uuid}: changed here since it was read (modId ${loc.modId} -> ${now_.m}); not deleted`, '306', true);
          consumeReview(table, item.uuid);
          let related = 0;
          atomically(store, () => {
            if (now_) {
              const before = opts.keepRelated ? 0 : cascading(ls) ? recordsIn(ls) : 0;
              ls.delete(table, loc.recordId, opts.keepRelated ? { cascade: false } : {});
              if (before) related = Math.max(0, before - 1 - recordsIn(ls));
            }
            crashPoint('sync-apply:after-data');
            dropMap(store, key, item.uuid);
            finishRow(store, rowId, 'ok');
            crashPoint('sync-apply:after-map');
          });
          crashPoint('sync-apply:after-commit');
          t.pulled.related += related;
          t.pulled.deleted++;
        }
      } catch (e) {
        assertWritable();
        const stop = fail(e, item.uuid, `pull-${item.op}`, rowId, table);
        if (!reviewsMatch()) return finish('refused');
        if (stop) break tables;
      }
    }

    // The local container files a record being sent needs sent too: the ones FileMaker lacks or holds differently
    // (compared by fetching its file, for a record that exists there). A file that can't be sent is listed, not an error.
    const maxFile = opts.containers?.maxBytes ?? 0;
    // Whether a retried record leaves behind a file FileMaker holds that was neither found the same nor replaced by ours: its
    // version is then not the baseline, so that a pull brings the file (the uploads of this run move FileMaker's modId too).
    const leftDifferent = (uuid: string, rem: RemoteRecord, work: { agreed: string[] }, uploaded: string[]): boolean =>
      [...(owedBy.get(uuid) ?? [])].some((f) => !work.agreed.includes(f) && !uploaded.includes(f) && (rem.fields[f] ?? '') !== '');
    const filesToSend = async (local: LocalRecord, rem: RemoteRecord | undefined): Promise<{ files: { field: string; file: RemoteFile }[]; satisfied: string[]; agreed: string[] }> => {
      const out: { field: string; file: RemoteFile }[] = [];
      const satisfied: string[] = [];
      // The fields whose file on FileMaker was compared with ours and is the same: all that says the two sides agree.
      const agreed: string[] = [];
      const retrying = new Set((store.sql.prepare('SELECT field FROM _fm_sync_container_pending WHERE table_key = ? AND uuid = ?').all(key, local.uuid) as { field: string }[]).map((r) => r.field));
      for (const field of sendFileFields) {
        const had = Number(local.fields[field]);
        if (!Number.isInteger(had) || had <= 0) {
          // Nothing here. A container emptied here isn't emptied on FileMaker: the file there is left and the run says so.
          if ((rem?.fields[field] ?? '') !== '') skipContainer(local.uuid, field, 'no file here, but FileMaker has one: it is left as it is (the sync never empties a container on FileMaker)');
          continue;
        }
        if (!w.uploadContainer) { skipContainer(local.uuid, field, 'this connection can\'t send container files'); continue; }
        const info = ls.containerInfo(had);
        // A file that cannot be sent is listed (and found again by the next comparison); it is no longer owed.
        if (!info) { satisfied.push(field); continue; }
        if (info.external?.missing) { skipContainer(local.uuid, field, 'the file is missing here'); satisfied.push(field); continue; }
        if (info.size > maxFile) { skipContainer(local.uuid, field, `the file is ${info.size} bytes, over the ${maxFile}-byte limit`); satisfied.push(field); continue; }
        const mine = ls.container(had);
        if (!mine) continue;
        const address = rem?.fields[field] ?? '';
        if (rem && address !== '') {
          if (!remote.fetchContainer) {
            if (!retrying.has(field)) { skipContainer(local.uuid, field, 'FileMaker\'s file can\'t be fetched to compare'); continue; }
            skipContainer(local.uuid, field, 'the file owed was sent without comparing it with the one FileMaker holds: this connection can\'t fetch it');
          } else {
            t.containers.checked++;
            const got = await remote.fetchContainer(d.config.remoteLayout, address, maxFile);
            assertWritable();
            if ('skipped' in got) {
              if (!retrying.has(field)) { skipContainer(local.uuid, field, `not compared with FileMaker's file: ${got.skipped}`); continue; }
              skipContainer(local.uuid, field, `the file owed was sent without comparing it with the one FileMaker holds: ${got.skipped}`);
            } else if (Buffer.from(mine.data.buffer, mine.data.byteOffset, mine.data.byteLength).equals(got.data)) {
              t.containers.unchanged++;
              satisfied.push(field);
              agreed.push(field);
              continue;
            } else if (retrying.has(field)) {
              skipContainer(local.uuid, field, `the file owed replaced a different file FileMaker held (${got.data.length} bytes, ${got.filename ?? 'no name'})`);
            }
          }
        }
        out.push({ field, file: { filename: mine.filename, mime: mine.mime, data: mine.data } });
      }
      return { files: out, satisfied, agreed };
    };
    // Sends the files to a record on FileMaker. A refused file is listed and the rest go on; anything that isn't one
    // file's problem (the account, the network, a changed review) comes back as `fatal` for the caller to raise after
    // it has recorded the record.
    const sendFilesTo = async (uuid: string, layout: string, recordId: string, files: { field: string; file: RemoteFile }[], beforeSend: () => void): Promise<{ modId?: string; fatal?: unknown; completed: string[]; uploaded: string[] }> => {
      let modId: string | undefined;
      const completed: string[] = [];
      const uploaded: string[] = [];
      for (const f of files) {
        try {
          const up = await w.uploadContainer!(layout, recordId, f.field, f.file, beforeSend);
          assertWritable();
          reviewsMatch();
          modId = up.modId;
          t.containers.sent++;
          completed.push(f.field);
          uploaded.push(f.field);
        } catch (e) {
          assertWritable();
          if (e instanceof SyncWriteError && e.recordLevel && e.code !== 'stale-review') {
            skipContainer(uuid, f.field, e.message);
            // A record in use (301) is tried again by the next run, and counts as failed until it goes; any other refusal is final.
            if (e.code === '301') t.failed.push({ uuid, op: 'container', error: `${f.field}: ${e.message} (it is tried again by the next run)` });
            else completed.push(f.field);
          }
          else return { modId, fatal: e, completed, uploaded };
        }
      }
      return { modId, completed, uploaded };
    };
    const order = { create: 0, update: 1, delete: 2 };
    for (const item of progressItems([...d.plan.pushes].sort((a, b) => order[a.op] - order[b.op] || (a.uuid < b.uuid ? -1 : 1)))) {
      const local = localBy.get(item.uuid);
      const rem = remoteBy.get(item.uuid);
      if (!dry && !opts.write) {
        t.pendingPushes++;
        continue;
      }
      if (item.op === 'delete' && !opts.allowDeletes) {
        t.heldDeletes++;
        continue;
      }
      if (dry) {
        if (item.op === 'create') t.created++;
        else if (item.op === 'update') (rem && local && Object.keys(data(local, rem)).length ? t.updated++ : t.adopted++);
        else if (rem) t.deleted++;
        // Files are fetched, compared and sent only in a real run: here, how many local ones would go.
        if (local && item.op !== 'delete') t.containers.toSend += sendFileFields.filter((f) => Number(local.fields[f]) > 0).length;
        continue;
      }
      if (!reviewsMatch()) return finish('refused');
      const at = iso(now());
      const layout = d.config.remoteLayout;
      let rowId = -1;
      const beforeSend = (): void => {
        assertWritable();
        if (!reviewsMatch()) throw new SyncWriteError(result.refused!, 'stale-review', true);
        consumeReview(d.config.localTable, item.uuid);
      };
      try {
        if (item.op === 'create') {
          if (!local) throw new SyncWriteError(`${item.uuid}: the local record is gone`, 'local-missing', true);
          const fieldData = data(local, undefined);
          const fileWork = sendFileFields.length ? await filesToSend(local, undefined) : { files: [], satisfied: [], agreed: [] };
          const files = fileWork.files;
          if (files.length) { assertWritable(); if (!reviewsMatch()) return finish('refused'); }
          // The files owed are recorded with the attempt, before FileMaker is asked to make the record: an exit anywhere after
          // that point (or a readback that fails) still leaves the uploads to be made.
          atomically(store, () => {
            rowId = logRow(store, runId, at, { key, layout, uuid: item.uuid, op: 'create', status: 'attempt', fields: [...Object.keys(fieldData), ...files.map((f) => f.field)] });
            markContainersPending(store, key, item.uuid, files);
          });
          crashPoint('sync-push:after-attempt');
          const made = await w.create(layout, fieldData, beforeSend);
          crashPoint('sync-push:after-send');
          assertWritable();
          // Record the outcome of a request already sent, even when a later choice became stale.
          reviewsMatch();
          // The new record must come back with our UUID: if the file's field refuses a supplied value, the record is
          // on FileMaker under another key, and a rerun would only make another. Stop, and hold the table.
          let back: RemoteRecord | undefined;
          try {
            back = await w.read(layout, made.recordId);
          } catch (e) {
            assertWritable();
            // Creation was acknowledged. Preserve its identity even if verification failed, and hold
            // further writes until its UUID can be checked rather than risking another stray record.
            const why = `created record ${made.recordId} on FileMaker, but its UUID readback failed: ${(e as Error).message}; verify the record's UUID before running again with --release`;
            atomically(store, () => {
              upsertMap(store, key, { uuid: item.uuid, localRecordId: local.recordId, lastLocalModId: local.modId, remoteRecordId: made.recordId, lastRemoteModId: made.modId, lastRemoteModTs: null });
              finishRow(store, rowId, 'ok', { remoteRecordId: made.recordId, after: made.modId, detail: why });
              holdTable(store, key, why);
            });
            t.created++;
            throw new SyncWriteError((e as Error).message, e instanceof SyncWriteError ? e.code : 'error');
          }
          assertWritable();
          reviewsMatch();
          if (!back || back.uuid !== item.uuid) {
            const why = `created record ${made.recordId} on FileMaker reads back with UUID "${back?.uuid ?? ''}", not "${item.uuid}": the UUID field doesn't accept a supplied value; fix the field, remove that record, then run again with --release`;
            atomically(store, () => {
              finishRow(store, rowId, 'failed', { remoteRecordId: made.recordId, after: made.modId, detail: why });
              holdTable(store, key, why);
            });
            throw new SyncWriteError(why, 'uuid-not-kept');
          }
          // Acknowledge the scalar row before starting uploads; the files owed were recorded with the attempt.
          atomically(store, () => {
            upsertMap(store, key, { uuid: item.uuid, localRecordId: local.recordId, lastLocalModId: local.modId, remoteRecordId: made.recordId, lastRemoteModId: back!.modId, lastRemoteModTs: back!.modTimestamp ?? null });
          });
          // The files go to the record just made. Whatever happens to them, the record is recorded.
          const sent = files.length ? await sendFilesTo(item.uuid, layout, made.recordId, files, beforeSend) : { completed: [] as string[], uploaded: [] as string[] };
          const finalMod = sent.modId ?? back.modId;
          atomically(store, () => {
            clearContainersPending(store, key, item.uuid, [...fileWork.satisfied, ...sent.completed]);
            upsertMap(store, key, { uuid: item.uuid, localRecordId: local.recordId, lastLocalModId: local.modId, remoteRecordId: made.recordId, lastRemoteModId: finalMod, lastRemoteModTs: sent.modId ? null : back.modTimestamp ?? null });
            finishRow(store, rowId, 'ok', { remoteRecordId: made.recordId, after: finalMod });
            crashPoint('sync-push:after-map');
          });
          crashPoint('sync-push:after-commit');
          t.created++;
          if (sent.fatal) throw sent.fatal;
          if (result.refused) return finish('refused');
        } else if (item.op === 'update') {
          if (!local || !rem) throw new SyncWriteError(`${item.uuid}: the record isn't in the snapshot this plan was made from`, 'snapshot-missing', true);
          // A record owed only its files is sent nothing else: what FileMaker holds now is not compared field by field here.
          const fieldData = retryOnly.has(item.uuid) ? {} : data(local, rem);
          const fileWork = sendFileFields.length ? await filesToSend(local, rem) : { files: [], satisfied: [], agreed: [] };
          const files = fileWork.files;
          if (files.length) { assertWritable(); if (!reviewsMatch()) return finish('refused'); }
          if (retryOnly.has(item.uuid) && !files.length) {
            // Nothing is left to send for it: no request, no log row, and what can no longer be sent is forgotten. When every file
            // owed was found the same on FileMaker, FileMaker's version (moved by the upload that did land) is the baseline now; when
            // one was forgotten unsent (too big, missing here), FileMaker's record is left as a change for a pull to bring.
            const agreedAll = !leftDifferent(item.uuid, rem, fileWork, []);
            atomically(store, () => {
              clearContainersPending(store, key, item.uuid, fileWork.satisfied);
              if (agreedAll) upsertMap(store, key, { uuid: item.uuid, localRecordId: local.recordId, lastLocalModId: local.modId, remoteRecordId: rem.recordId, lastRemoteModId: rem.modId, lastRemoteModTs: rem.modTimestamp ?? null });
            });
            continue;
          }
          if (!Object.keys(fieldData).length && !files.length) {
            consumeReview(d.config.localTable, item.uuid);
            atomically(store, () => {
              clearContainersPending(store, key, item.uuid, fileWork.satisfied);
              upsertMap(store, key, { uuid: item.uuid, localRecordId: local.recordId, lastLocalModId: local.modId, remoteRecordId: rem.recordId, lastRemoteModId: rem.modId, lastRemoteModTs: rem.modTimestamp ?? null });
              logRow(store, runId, at, { key, layout, uuid: item.uuid, op: 'update', status: 'noop', remoteRecordId: rem.recordId, before: rem.modId, after: rem.modId, detail: 'no field differs (fields that can\'t be sent aside); nothing sent' });
            });
            t.adopted++;
            continue;
          }
          atomically(store, () => {
            rowId = logRow(store, runId, at, { key, layout, uuid: item.uuid, op: 'update', status: 'attempt', remoteRecordId: rem.recordId, before: rem.modId, fields: [...Object.keys(fieldData), ...files.map((f) => f.field)] });
            markContainersPending(store, key, item.uuid, files);
          });
          crashPoint('sync-push:after-attempt');
          let modId = rem.modId;
          if (Object.keys(fieldData).length) {
            modId = (await w.update(layout, rem.recordId, fieldData, rem.modId, beforeSend)).modId;
            crashPoint('sync-push:after-send');
            assertWritable();
            reviewsMatch();
          } else {
            // Files only: FileMaker's record must still be the version that was read, as an update's modId would make it.
            const now_ = await w.read(layout, rem.recordId);
            assertWritable();
            if (!reviewsMatch()) throw new SyncWriteError(result.refused!, 'stale-review', true);
            if (!now_ || now_.modId !== rem.modId) throw new SyncWriteError(`${item.uuid}: changed on FileMaker since it was read (modId ${rem.modId} -> ${now_?.modId ?? 'gone'}); its files were not sent`, '306', true);
          }
          // The scalar baseline is recorded before the uploads; the files owed were recorded with the attempt.
          atomically(store, () => {
            upsertMap(store, key, { uuid: item.uuid, localRecordId: local.recordId, lastLocalModId: local.modId, remoteRecordId: rem.recordId, lastRemoteModId: modId, lastRemoteModTs: null });
          });
          const sent = files.length ? await sendFilesTo(item.uuid, layout, rem.recordId, files, beforeSend) : { completed: [] as string[], uploaded: [] as string[] };
          modId = sent.modId ?? modId;
          // A retried record keeps the version it was read at when a file owed was left unsent and FileMaker's differs.
          const baseline = retryOnly.has(item.uuid) && leftDifferent(item.uuid, rem, fileWork, sent.uploaded) ? rem.modId : modId;
          atomically(store, () => {
            clearContainersPending(store, key, item.uuid, [...fileWork.satisfied, ...sent.completed]);
            upsertMap(store, key, { uuid: item.uuid, localRecordId: local.recordId, lastLocalModId: local.modId, remoteRecordId: rem.recordId, lastRemoteModId: baseline, lastRemoteModTs: null });
            finishRow(store, rowId, 'ok', { after: modId });
            crashPoint('sync-push:after-map');
          });
          crashPoint('sync-push:after-commit');
          t.updated++;
          if (sent.fatal) throw sent.fatal;
          if (result.refused) return finish('refused');
        } else {
          if (!rem) {
            consumeReview(d.config.localTable, item.uuid);
            // Gone from FileMaker as well: nothing to delete, only the map entry to drop.
            atomically(store, () => {
              dropMap(store, key, item.uuid);
              logRow(store, runId, at, { key, layout, uuid: item.uuid, op: 'delete', status: 'noop', detail: 'already gone from FileMaker' });
            });
            continue;
          }
          rowId = logRow(store, runId, at, { key, layout, uuid: item.uuid, op: 'delete', status: 'attempt', remoteRecordId: rem.recordId, before: rem.modId });
          crashPoint('sync-push:after-attempt');
          const now_ = await w.read(layout, rem.recordId);
          assertWritable();
          if (!reviewsMatch()) throw new SyncWriteError(result.refused!, 'stale-review', true);
          if (now_ && now_.modId !== rem.modId) throw new SyncWriteError(`${item.uuid}: changed on FileMaker since it was read (modId ${rem.modId} -> ${now_.modId}); not deleted`, '306', true);
          if (now_) await w.delete(layout, rem.recordId, beforeSend);
          else beforeSend();
          crashPoint('sync-push:after-send');
          assertWritable();
          reviewsMatch();
          atomically(store, () => {
            dropMap(store, key, item.uuid);
            finishRow(store, rowId, 'ok', { detail: now_ ? undefined : 'already gone from FileMaker' });
            crashPoint('sync-push:after-map');
          });
          crashPoint('sync-push:after-commit');
          t.deleted++;
          if (result.refused) return finish('refused');
        }
      } catch (e) {
        assertWritable();
        const stop = fail(e, item.uuid, item.op, rowId, d.config.localTable);
        if (!reviewsMatch() || result.refused) return finish('refused');
        if (stop) break tables;
      }
    }
  }
  return finish(result.stopped ? 'stopped' : 'finished');
}

/** Applies a sync run; the record changes it makes are logged as coming from "sync", whatever started it (the console, a schedule, a script). */
export function applySync(...args: Parameters<typeof applySyncRun>): ReturnType<typeof applySyncRun> {
  return writer.run({ ...writer.getStore(), surface: 'sync' }, () => applySyncRun(...args));
}
