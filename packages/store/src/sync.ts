// Tier 2 of the way-back-to-FileMaker plan: live DATA sync to a FileMaker
// Server, with Tabularius acting as a client of the server's Data API. See
// research/export/tier2-live-sync.md.
//
// THIS MODULE IS THE DRY-RUN PLANNER ONLY. It reads both sides and works out
// what WOULD move — records to push (local → FileMaker), records to pull
// (FileMaker → local), and conflicts — WITHOUT writing to either side. The
// push leg lives in sync-apply.ts; the pull leg and container payloads are
// later work. A remote source is an injectable
// interface here, so the planner and its conflict rules are fully testable
// against a fake server, with no network.
//
// Scope and safety (see the research doc and project memory):
//  - DATA only. Schema, layouts, scripts, value lists, calcs, accounts and
//    privileges never sync. A table whose schema diverges is paused, not
//    guessed at.
//  - Records are keyed on a stable shared UUID field, never FileMaker's
//    internal record id (which does not survive an import/convert).
//  - Change is detected incrementally: FileMaker's modification timestamp and
//    per-record modId on their side, our monotonic `_fm_mod_id` on ours.
//  - Conflicts (a record changed on both sides since the last sync) resolve by
//    a per-table policy that defaults to `flag` — never a silent overwrite.
//  - Sync is an outbound effect, so the apply leg is off by default and
//    per-file; a live run must target a throwaway test server or a
//    server its owner approved, never a capture-only file. This planner writes
//    nothing, but the same rule governs whatever drives it.
import { DatabaseSync } from 'node:sqlite';
import type { FieldType, Schema } from '../../fmp12/src/index.ts';
import type { SqlValue } from './find.ts';
import { q } from './import.ts';
import type { Store } from './store.ts';

/**
 * What the planner reads of a local file: its schema and its database. A Store
 * is one; `openForPlanning` gives one that can't write.
 */
export type SyncLocal = Pick<Store, 'schema' | 'sql'>;

/**
 * A hosted file opened read-only, for a dry run. Opening a Store would bring an
 * older file's own tables up to date, which is a write; this connection can't.
 */
export function openForPlanning(path: string): SyncLocal & { close(): void } {
  const sql = new DatabaseSync(path, { readOnly: true });
  const row = sql.prepare("SELECT json FROM _fm_meta WHERE key = 'schema'").get() as { json: string } | undefined;
  return { sql, schema: (row ? JSON.parse(row.json) : undefined) as Schema, close: () => sql.close() };
}

/**
 * Thrown by a RemoteSource when one table can't be read as configured (the
 * layout doesn't show the UUID field, say): that table is paused with this
 * message and the others are still planned.
 */
export class SyncPause extends Error {}

/** How a record changed on both sides since the last sync is resolved, per table. */
export type ConflictPolicy =
  | 'flag' // never overwrite; surface for human review (the safe default)
  | 'filemaker-wins' // the FileMaker value overwrites ours
  | 'tabularius-wins' // our value is pushed to FileMaker
  | 'newer-wins'; // later modification timestamp wins; ties/unparsable fall back to flag

export const DEFAULT_CONFLICT_POLICY: ConflictPolicy = 'flag';

/** One table's sync configuration: how a local table maps to a FileMaker layout. */
export interface TableSyncConfig {
  /** Local base-table name. */
  localTable: string;
  /** FileMaker Data API layout exposing the same table's records. */
  remoteLayout: string;
  /** Field holding the shared UUID on both sides (e.g. a Get(UUID) auto-enter field). */
  uuidField: string;
  /** Field holding the modification timestamp on the FileMaker side (auto-enter on modify). */
  modTimestampField: string;
  /** Conflict policy for this table (default `flag`). */
  policy?: ConflictPolicy;
}

/** A local record as the planner sees it. */
export interface LocalRecord {
  uuid: string;
  recordId: number;
  modId: number;
  fields: Record<string, SqlValue>;
}

/** A FileMaker record as the Data API returns it (recordId/modId are strings there). */
export interface RemoteRecord {
  uuid: string;
  recordId: string;
  modId: string;
  modTimestamp?: string;
  fields: Record<string, string>;
}

/** What Tabularius last knew about a record on both sides — the join between the two id spaces. */
export interface SyncMapEntry {
  uuid: string;
  localRecordId: number | null;
  lastLocalModId: number | null;
  remoteRecordId: string | null;
  lastRemoteModId: string | null;
  lastRemoteModTs: string | null;
}

export type PlanDirection = 'push' | 'pull';
export type PlanOp = 'create' | 'update' | 'delete';

/** One record the plan would move, and why. */
export interface PlanItem {
  uuid: string;
  direction: PlanDirection;
  op: PlanOp;
  /** Which side's change drove this, for display. */
  reason: string;
}

/** One field's differing values in a conflict. */
export interface FieldClash {
  field: string;
  local: SqlValue;
  remote: string;
}

/** A record changed on both sides since the last sync. */
export interface PlanConflict {
  /** Opaque version token from applySync; return it with a reviewed resolution. */
  reviewToken?: string;
  uuid: string;
  localRecordId: number | null;
  remoteRecordId: string | null;
  /** Fields whose values differ between the two sides. */
  clashes: FieldClash[];
  /** The policy that applied; `flag` leaves it for a person to resolve. */
  policy: ConflictPolicy;
}

/** The dry-run plan for one table: what would move, and what is held for review. */
export interface TablePlan {
  tableKey: string;
  localTable: string;
  remoteLayout: string;
  pushes: PlanItem[];
  pulls: PlanItem[];
  conflicts: PlanConflict[];
  /** When set, the table is skipped this run (e.g. schema prerequisites missing or divergence). */
  paused?: string;
  /**
   * Records with an empty UUID field, on each side. They can't be matched, so
   * they are left out of the plan; the owner fills the field in to include them.
   */
  unkeyed?: { local: number; remote: number };
  /**
   * Records changed on both sides whose stored fields come out the same, so they are left alone. Container files aren't
   * compared by the planner (the two sides hold an id and an address), so a run that moves container files looks at these.
   */
  convergedBoth?: string[];
}

/** A source of FileMaker records for the planner — a real Data API client or a fake. */
export interface RemoteSource {
  /**
   * Records changed on a layout at or after `sinceTimestamp` (ISO); null means
   * every record (a first sync). The adapter implements this with a Data API
   * `_find` on the modification-timestamp field, or a full read on first sync.
   */
  changedSince(layout: string, sinceTimestamp: string | null): Promise<RemoteRecord[]>;
  /**
   * Optional: every UUID currently present on a layout, so the planner can tell
   * a record deleted on the FileMaker side from one merely unchanged. Without
   * it, remote deletions are not detected (a documented gap).
   */
  allUuids?(layout: string): Promise<Set<string>>;
  /**
   * Optional: the file a record's container field points to (the field's value in a RemoteRecord is its address).
   * Only called when a pull is asked to bring container files; a source that can't leaves them out.
   */
  fetchContainer?(layout: string, address: string, maxBytes: number): Promise<RemoteFile | { skipped: string }>;
}

/** A container file as it came from FileMaker. */
export interface RemoteFile { filename: string | null; mime: string; data: Uint8Array }

/** The internal `file::table` key a table's sync state is stored under. */
export const tableKey = (fileName: string, localTable: string): string => `${fileName}\u0000${localTable}`;

const tableExists = (store: SyncLocal, name: string): boolean =>
  !!store.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/**
 * Create the sync bookkeeping tables. Designed for two-way sync from the start.
 * This is the only function here that writes to the database, and the dry-run
 * planner never calls it — the apply leg (sync-apply.ts) or an explicit setup step
 * does. The read helpers tolerate the tables not existing yet.
 */
export function ensureSyncTables(store: SyncLocal): void {
  // The per-record join between the two id spaces, plus each side's last-seen version.
  store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_sync_map (
    table_key TEXT NOT NULL,
    uuid TEXT NOT NULL,
    local_record_id INTEGER,
    last_local_mod_id INTEGER,
    remote_record_id TEXT,
    last_remote_mod_id TEXT,
    last_remote_mod_ts TEXT,
    PRIMARY KEY (table_key, uuid)
  ) WITHOUT ROWID`);
  // Per-table sync state. `paused`/`paused_reason` hold a table back from the apply leg's
  // writes (set when a write finds the UUID field won't keep the key; `sync-apply --release`
  // clears it); the dry-run planner reads regardless. `enabled` is unused: the opt-in is
  // the configuration's allowWrites.
  store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_sync_state (
    table_key TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    last_pull_ts TEXT,
    last_push_local_mod_id INTEGER,
    paused INTEGER NOT NULL DEFAULT 0,
    paused_reason TEXT
  ) WITHOUT ROWID`);
  // Container uploads are independent of scalar record versions: keep each
  // unfinished field until its remote write has been confirmed.
  store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_sync_container_pending (
    table_key TEXT NOT NULL,
    uuid TEXT NOT NULL,
    field TEXT NOT NULL,
    PRIMARY KEY (table_key, uuid, field)
  ) WITHOUT ROWID`);
  // The audit log of the apply step: one row per write to FileMaker (written
  // before the request goes out, then finished with its outcome) and per run.
  store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    at TEXT NOT NULL,
    table_key TEXT,
    layout TEXT,
    uuid TEXT,
    op TEXT NOT NULL,
    status TEXT NOT NULL,
    remote_record_id TEXT,
    mod_id_before TEXT,
    mod_id_after TEXT,
    fields TEXT,
    detail TEXT
  )`);
}

/** Read one table's sync map. Empty when the bookkeeping tables don't exist yet. */
export function readSyncMap(store: SyncLocal, key: string): SyncMapEntry[] {
  if (!tableExists(store, '_fm_sync_map')) return [];
  const rows = store.sql.prepare('SELECT * FROM _fm_sync_map WHERE table_key = ?').all(key) as {
    uuid: string;
    local_record_id: number | null;
    last_local_mod_id: number | null;
    remote_record_id: string | null;
    last_remote_mod_id: string | null;
    last_remote_mod_ts: string | null;
  }[];
  return rows.map((r) => ({
    uuid: r.uuid,
    localRecordId: r.local_record_id === null ? null : Number(r.local_record_id),
    lastLocalModId: r.last_local_mod_id === null ? null : Number(r.last_local_mod_id),
    remoteRecordId: r.remote_record_id,
    lastRemoteModId: r.last_remote_mod_id,
    lastRemoteModTs: r.last_remote_mod_ts,
  }));
}

/** The timestamp of the last successful pull for a table, or null (first sync). */
export function lastPullTimestamp(store: SyncLocal, key: string): string | null {
  if (!tableExists(store, '_fm_sync_state')) return null;
  const row = store.sql.prepare('SELECT last_pull_ts FROM _fm_sync_state WHERE table_key = ?').get(key) as { last_pull_ts: string | null } | undefined;
  return row?.last_pull_ts ?? null;
}

/**
 * Schema prerequisites a table is missing for sync: the UUID and
 * modification-timestamp fields must exist on the local table. Returns the
 * names of the missing fields (empty when ready). Sync never adds these itself
 * — it reports them for the owner to add.
 */
export function missingPrereqs(store: SyncLocal, config: TableSyncConfig): string[] {
  const table = store.schema?.tables.find((t) => t.name === config.localTable);
  if (!table) return [config.uuidField, config.modTimestampField];
  const have = new Set(table.fields.map((f) => f.name));
  return [config.uuidField, config.modTimestampField].filter((f) => !have.has(f));
}

/** Read every local record of a table with its UUID (empty when it has none), ids and field values. */
export function readLocalRecords(store: SyncLocal, config: TableSyncConfig): LocalRecord[] {
  const rows = store.sql.prepare(`SELECT * FROM ${q(config.localTable)}`).all() as Record<string, SqlValue>[];
  const out: LocalRecord[] = [];
  for (const row of rows) {
    // A record with no UUID is kept with an empty key: the planner can't match it, but counts it.
    const uuid = row[config.uuidField] ?? '';
    const fields: Record<string, SqlValue> = {};
    for (const [k, v] of Object.entries(row)) if (k !== '_fm_record_id' && k !== '_fm_mod_id') fields[k] = v;
    out.push({ uuid: String(uuid), recordId: Number(row._fm_record_id ?? 0), modId: Number(row._fm_mod_id ?? 0), fields });
  }
  return out;
}

/**
 * Whether a local and a remote value are the same value written two ways: a
 * number (`5` here, `5.0` from the server), a timestamp field's value written
 * with a T or a space, or text whose line breaks are returns on FileMaker and
 * line feeds here. Anything else is compared exactly, so `007` and `7` in a
 * text field differ.
 */
export function sameValue(local: SqlValue, remote: string, type: FieldType | undefined): boolean {
  const l = String(local ?? '');
  const r = String(remote ?? '');
  if (l === r) return true;
  if (typeof local === 'number' || typeof local === 'bigint') return r.trim() !== '' && Number(r) === Number(local);
  if (type === 'timestamp') {
    const stamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;
    return stamp.test(l) && stamp.test(r) && l.replace('T', ' ') === r.replace('T', ' ');
  }
  const lines = (v: string) => v.replace(/\r\n?/g, '\n');
  return lines(l) === lines(r);
}

/**
 * Fields that differ between a local and a remote record. The UUID is the same
 * by definition, and the modification timestamp differs whenever both sides
 * were edited, so neither counts: a record edited to the same values on both
 * sides is converged, not a conflict.
 */
function clashes(config: TableSyncConfig, local: LocalRecord, remote: RemoteRecord, types: Record<string, FieldType>): FieldClash[] {
  const out: FieldClash[] = [];
  for (const [field, rv] of Object.entries(remote.fields)) {
    if (field === config.uuidField || field === config.modTimestampField) continue;
    // Containers don't sync (yet), and the two sides hold different things for one anyway: an id here, a URL there.
    if (types[field] === 'container') continue;
    const lv = local.fields[field];
    if (lv === undefined) continue; // field not on our side (schema shape handled separately)
    if (!sameValue(lv, rv, types[field])) out.push({ field, local: lv, remote: rv });
  }
  return out;
}

/**
 * A sortable key for an ISO-8601 wall-clock timestamp — `YYYY-MM-DD` then a
 * space or `T`, then `HH:MM:SS` (fractional seconds ignored). Returns null for
 * anything else, including locale formats like `MM/DD/YYYY`, so a timestamp
 * that isn't in this shape is treated as unorderable rather than guessed at.
 * The fixed-width `YYYYMMDDHHMMSS` integer is monotonic in wall-clock order.
 */
function stampKey(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  return m ? Number(`${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`) : null;
}

/**
 * Order two timestamps as wall-clock: -1 if a is earlier, 1 if later, 0 if
 * equal, null if either can't be parsed. Not via Date.parse, which would read
 * both in this process's time zone. Each side stamps in its own host's local
 * time, so this ordering is only right when this server and FileMaker Server
 * use the same time zone (ADMIN.md says so for `newer-wins`). The remote
 * adapter supplies its timestamp in the ISO shape above; a stamp that isn't
 * makes the comparison null, which the caller resolves by flagging.
 */
function compareTimestamps(a: string | undefined, b: string | undefined): number | null {
  const ka = stampKey(a);
  const kb = stampKey(b);
  if (ka === null || kb === null) return null;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Work out, for one table, what a sync WOULD move — purely, from the two sides'
 * records and the sync map. Writes nothing. `presentRemoteUuids` (every UUID
 * still on the server) enables remote-deletion detection; without it, remotes
 * are treated as changed-records-only and remote deletions are left undetected.
 * Records with an empty UUID are left out and counted in `unkeyed`. `types`
 * (the local table's field types) lets values be compared as their type.
 */
/** A record changed on both sides with `cl` differing: settled by the table's policy, or held for review. */
export function settleClash(plan: TablePlan, config: TableSyncConfig, local: LocalRecord, remote: RemoteRecord, cl: FieldClash[]): void {
  const policy = config.policy ?? DEFAULT_CONFLICT_POLICY;
  const uuid = local.uuid;
  const flag = () => plan.conflicts.push({ uuid, localRecordId: local.recordId, remoteRecordId: remote.recordId, clashes: cl, policy });
  if (policy === 'filemaker-wins') plan.pulls.push({ uuid, direction: 'pull', op: 'update', reason: 'conflict: filemaker-wins' });
  else if (policy === 'tabularius-wins') plan.pushes.push({ uuid, direction: 'push', op: 'update', reason: 'conflict: tabularius-wins' });
  else if (policy === 'newer-wins') {
    // Order the two edits by the synced modification-timestamp field,
    // which both sides carry. Any doubt (missing or unparsable stamp, or a
    // tie) falls back to flag — never a silent coin-flip overwrite.
    const localTs = local.fields[config.modTimestampField];
    const cmp = compareTimestamps(localTs == null ? undefined : String(localTs), remote.modTimestamp ?? remote.fields[config.modTimestampField]);
    if (cmp === -1) plan.pulls.push({ uuid, direction: 'pull', op: 'update', reason: 'conflict: newer-wins (FileMaker newer)' });
    else if (cmp === 1) plan.pushes.push({ uuid, direction: 'push', op: 'update', reason: 'conflict: newer-wins (local newer)' });
    else flag();
  } else flag();
}

export function planTable(
  config: TableSyncConfig,
  locals: LocalRecord[],
  remotes: RemoteRecord[],
  map: SyncMapEntry[],
  opts: { presentRemoteUuids?: Set<string>; types?: Record<string, FieldType> } = {},
): TablePlan {
  const policy = config.policy ?? DEFAULT_CONFLICT_POLICY;
  const keyed = (r: { uuid: string }) => r.uuid.trim() !== '';
  const unkeyed = { local: locals.filter((r) => !keyed(r)).length, remote: remotes.filter((r) => !keyed(r)).length };
  locals = locals.filter(keyed);
  remotes = remotes.filter(keyed);
  const localByUuid = new Map(locals.map((r) => [r.uuid, r]));
  const remoteByUuid = new Map(remotes.map((r) => [r.uuid, r]));
  const mapByUuid = new Map(map.map((m) => [m.uuid, m]));

  const plan: TablePlan = { tableKey: tableKey('', config.localTable), localTable: config.localTable, remoteLayout: config.remoteLayout, pushes: [], pulls: [], conflicts: [] };
  if (unkeyed.local || unkeyed.remote) plan.unkeyed = unkeyed;

  // The UUID must identify one record per side. If it doesn't, syncing would
  // silently pick one row and lose the rest, so the table is paused for the
  // owner to fix the duplicate keys rather than planned from.
  if (localByUuid.size !== locals.length || remoteByUuid.size !== remotes.length) {
    const side = localByUuid.size !== locals.length ? (remoteByUuid.size !== remotes.length ? 'both sides' : 'locally') : 'on FileMaker';
    plan.paused = `duplicate UUID key(s) ${side} — resolve before syncing`;
    return plan;
  }

  // Local modification ids can move backwards when a store is restored from an
  // earlier backup. Planning such rows against a newer saved baseline could
  // mistake restored data for an unchanged row or push the wrong version.
  for (const local of locals) {
    const seen = mapByUuid.get(local.uuid);
    if (seen?.lastLocalModId != null && local.modId < seen.lastLocalModId) {
      plan.paused = 'local modification ids went backwards; restored from backup?';
      return plan;
    }
  }

  const uuids = new Set<string>([...localByUuid.keys(), ...remoteByUuid.keys(), ...mapByUuid.keys()]);
  for (const uuid of uuids) {
    const local = localByUuid.get(uuid);
    const remote = remoteByUuid.get(uuid);
    const seen = mapByUuid.get(uuid);

    // Did each side change since we last synced this record?
    const localChanged = local ? seen?.lastLocalModId === undefined || seen?.lastLocalModId === null || local.modId > seen.lastLocalModId : false;
    // A different record id under the same UUID is a record deleted and made again, even if its modId happens to match.
    const remoteChanged = remote ? seen?.lastRemoteModId == null || remote.modId !== seen.lastRemoteModId || (seen.remoteRecordId != null && remote.recordId !== seen.remoteRecordId) : false;

    // Deletions: known to the map but gone from a side we can see now. A remote
    // deletion is only knowable when we were given the set of UUIDs still
    // present on the server (otherwise `remotes` is changed-records-only).
    const localDeleted = !local && seen?.localRecordId != null;
    const remoteDeleted = !remote && seen?.remoteRecordId != null && !!opts.presentRemoteUuids && !opts.presentRemoteUuids.has(uuid);

    if (local && remote) {
      if (localChanged && remoteChanged) {
        // Conflict: resolve by policy.
        const cl = clashes(config, local, remote, opts.types ?? {});
        if (cl.length === 0) { // same value on both sides: nothing to do
          (plan.convergedBoth ??= []).push(uuid);
          continue;
        }
        settleClash(plan, config, local, remote, cl);
      } else if (localChanged) {
        plan.pushes.push({ uuid, direction: 'push', op: 'update', reason: 'changed locally' });
      } else if (remoteChanged) {
        plan.pulls.push({ uuid, direction: 'pull', op: 'update', reason: 'changed on FileMaker' });
      }
    } else if (local && !remote) {
      if (remoteDeleted) {
        if (localChanged) plan.conflicts.push({ uuid, localRecordId: local.recordId, remoteRecordId: null, clashes: [], policy });
        else plan.pulls.push({ uuid, direction: 'pull', op: 'delete', reason: 'deleted on FileMaker' });
      } else if (seen?.remoteRecordId == null) {
        // Never on FileMaker (not in the map, or only ever here): it would be made there.
        plan.pushes.push({ uuid, direction: 'push', op: 'create', reason: 'new locally' });
      } else if (localChanged) {
        plan.pushes.push({ uuid, direction: 'push', op: 'update', reason: 'changed locally' });
      }
    } else if (remote && !local) {
      if (localDeleted) {
        if (remoteChanged) plan.conflicts.push({ uuid, localRecordId: null, remoteRecordId: remote.recordId, clashes: [], policy });
        else plan.pushes.push({ uuid, direction: 'push', op: 'delete', reason: 'deleted locally' });
      } else if (seen?.localRecordId == null) {
        // Never here: it would be made here.
        plan.pulls.push({ uuid, direction: 'pull', op: 'create', reason: 'new on FileMaker' });
      } else if (remoteChanged) {
        plan.pulls.push({ uuid, direction: 'pull', op: 'update', reason: 'changed on FileMaker' });
      }
    } else {
      // Neither side has it any more.
      if (localDeleted && remoteDeleted) continue; // both gone: converged
      if (localDeleted) plan.pushes.push({ uuid, direction: 'push', op: 'delete', reason: 'deleted locally' });
      else if (remoteDeleted) plan.pulls.push({ uuid, direction: 'pull', op: 'delete', reason: 'deleted on FileMaker' });
    }
  }
  // Deterministic order for display and tests.
  const byUuid = (a: { uuid: string }, b: { uuid: string }) => (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0);
  plan.pushes.sort(byUuid);
  plan.pulls.sort(byUuid);
  plan.conflicts.sort(byUuid);
  return plan;
}

/**
 * The dry-run plan across all configured tables. Reads both sides through the
 * injected `RemoteSource`; writes to NEITHER side. A table missing its schema
 * prerequisites is returned paused, with the missing fields named.
 */
export async function syncPlan(store: SyncLocal, fileName: string, configs: TableSyncConfig[], remote: RemoteSource): Promise<TablePlan[]> {
  return (await syncPlanDetailed(store, fileName, configs, remote)).map((d) => d.plan);
}

/** A table's plan with the records it was made from, so the apply step writes from the very snapshot it planned on. */
export interface DetailedPlan {
  config: TableSyncConfig;
  plan: TablePlan;
  locals: LocalRecord[];
  remotes: RemoteRecord[];
  map: SyncMapEntry[];
  presentRemoteUuids?: Set<string>;
  types: Record<string, FieldType>;
}

/** `syncPlan`, keeping what each table was planned from. Writes nothing.
 * `assertActive` checks the hosted file's lifetime before local reads and after remote awaits.
 */
export async function syncPlanDetailed(store: SyncLocal, fileName: string, configs: TableSyncConfig[], remote: RemoteSource, assertActive?: () => void): Promise<DetailedPlan[]> {
  // Read-only: the dry run never creates the bookkeeping tables. The read
  // helpers return empty/null when they don't exist yet.
  const plans: DetailedPlan[] = [];
  const paused = (config: TableSyncConfig, key: string, reason: string): DetailedPlan => ({
    config, locals: [], remotes: [], map: [], types: {},
    plan: { tableKey: key, localTable: config.localTable, remoteLayout: config.remoteLayout, pushes: [], pulls: [], conflicts: [], paused: reason },
  });
  for (const config of configs) {
    assertActive?.();
    const key = tableKey(fileName, config.localTable);
    const missing = missingPrereqs(store, config);
    if (missing.length) {
      plans.push(paused(config, key, `missing field(s): ${missing.join(', ')}`));
      continue;
    }
    const locals = readLocalRecords(store, config);
    const map = readSyncMap(store, key);
    const since = lastPullTimestamp(store, key);
    let remotes: RemoteRecord[];
    let presentRemoteUuids: Set<string> | undefined;
    try {
      remotes = await remote.changedSince(config.remoteLayout, since);
      assertActive?.();
      // The set of UUIDs still on the server, when the adapter can supply it, lets
      // the planner distinguish a FileMaker-side deletion from an unchanged record.
      presentRemoteUuids = remote.allUuids ? await remote.allUuids(config.remoteLayout) : undefined;
    } catch (e) {
      assertActive?.();
      if (!(e instanceof SyncPause)) throw e;
      plans.push(paused(config, key, e.message));
      continue;
    }
    // Even reading schema can query SQLite; a closed Store must not be touched.
    assertActive?.();
    const types = Object.fromEntries((store.schema?.tables.find((t) => t.name === config.localTable)?.fields ?? []).map((f) => [f.name, f.type]));
    const plan = planTable(config, locals, remotes, map, { presentRemoteUuids, types });
    plan.tableKey = key;
    plans.push({ config, plan, locals, remotes, map, presentRemoteUuids, types });
  }
  return plans;
}
