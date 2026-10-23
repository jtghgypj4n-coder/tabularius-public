// Out-of-date stored calculations: FileMaker recomputes a stored calculation
// when a field of its own record changes, but not when a record its formula
// reads some other way changes (ExecuteSQL, Evaluate, GetField). Those stored
// values drift. This finds them (counts per field, changing nothing) and, only
// when asked, brings chosen ones up to date as one batch that can be undone.
// A converted file keeps FileMaker's stored values until then.

import { rethrowExecutionRefusal } from '../../calc/src/execution-refusal.ts';
import { randomBytes } from 'node:crypto';
import { CalcError, type Node } from '../../calc/src/index.ts';
import type { Field, Table } from '../../fmp12/src/index.ts';
import { EXTERNAL, VOLATILE, sameStored } from './fidelity.ts';
import type { SqlValue } from './find.ts';
import { q } from './import.ts';
import type { Store, WriteOptions } from './store.ts';

/** Why a field's stored value can fall behind its formula. */
export type StaleCause =
  /** ExecuteSQL reads other records; FileMaker doesn't recompute when they change. */
  | 'other records (ExecuteSQL)'
  /** Evaluate, GetField and the like name fields at run time, so FileMaker can't see what they read. */
  | 'fields named at run time'
  /** Only this record's fields: FileMaker keeps these current, so a difference points at a formula Tabularius works out differently. */
  | 'this record only';

export interface StaleField {
  table: string;
  field: string;
  cause: StaleCause;
  /** Records in the table, and how many were looked at. */
  records: number;
  looked: number;
  /** Stored value differs from what the formula gives now. */
  stale: number;
  /** Of those: FileMaker stored nothing and the formula now gives a value, or the other way round. */
  wasEmpty: number;
  nowEmpty: number;
  /** The formula fails on these records here; they are never refreshed. */
  failing: number;
  /** Some of the stale records, by id. */
  recordIds: number[];
  /** With `examples: true`, a few of them with the value stored and the value the formula gives now (long text cut short), to show before refreshing. */
  examples?: { recordId: number; stored: SqlValue; now: SqlValue }[];
}

export interface StaleReport {
  fields: StaleField[];
  /** Stored calculations not checked, and why. */
  skipped: { table: string; field: string; reason: string }[];
  looked: number;
  stale: number;
  note: string;
}

export class StaleCalcError extends Error {}

const INDIRECT = new Set(['evaluate', 'getfield', 'getfieldname', 'getrepetition']);
const MAX_CHANGES = 100_000;

function causeOf(store: Store, table: Table, f: Field, node: Node): StaleCause {
  const own = store.schema.tableOccurrences.find((t) => t.id === (f.calculationContextId ?? store.calc.defaultOccurrence(table)))?.name.toLowerCase();
  let sql = false, indirect = false, related = false;
  const walk = (n: Node): void => {
    if (n.k === 'call') {
      const name = n.name.toLowerCase();
      if (name === 'executesql') sql = true;
      if (INDIRECT.has(name)) indirect = true;
      n.args.forEach(walk);
    } else if (n.k === 'field') {
      if (n.occurrence && n.occurrence.toLowerCase() !== own) related = true;
      if (n.rep) walk(n.rep);
    } else if (n.k === 'var') { if (n.rep) walk(n.rep); }
    else if (n.k === 'bin') { walk(n.a); walk(n.b); }
    else if (n.k === 'unary') walk(n.a);
    else if (n.k === 'let') { for (const [, v] of n.binds) walk(v); walk(n.body); }
  };
  walk(node);
  return sql ? 'other records (ExecuteSQL)' : indirect || related ? 'fields named at run time' : 'this record only';
}

/** The stored calculations to look at, with their formula; the rest with a reason. */
function storedCalcs(store: Store, opts: { table?: string; fields?: string[] }, skipped: StaleReport['skipped']) {
  const out: { table: Table; field: Field; cause: StaleCause }[] = [];
  const wanted = opts.fields?.map((x) => x.toLowerCase());
  for (const table of store.schema.tables) {
    if (opts.table && table.name.toLowerCase() !== opts.table.toLowerCase()) continue;
    for (const f of table.fields) {
      if (f.kind !== 'calculation' || !f.calculation || f.options?.unstored || f.options?.global) continue;
      if (wanted && !wanted.includes(f.name.toLowerCase())) continue;
      const skip = (reason: string) => skipped.push({ table: table.name, field: f.name, reason });
      if (f.type === 'container') { skip('container'); continue; }
      if (VOLATILE.test(f.calculation)) { skip('depends on the time, the session or chance, so it differs every time'); continue; }
      if (EXTERNAL.test(f.calculation)) { skip('uses a plug-in or design function'); continue; }
      const c = store.calc.formula(table, f);
      if (!c) { skip("formula can't be worked out here"); continue; }
      out.push({ table, field: f, cause: causeOf(store, table, f, c.node) });
    }
  }
  return out;
}

const shown = (v: SqlValue): SqlValue => typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;

/** The formula's value for a record now, or 'failing' when it fails here. */
function current(store: Store, table: Table, f: Field, row: Record<string, SqlValue>): SqlValue | 'failing' {
  try {
    const v = store.calc.computeStored({ store, table, row }, f, true) as SqlValue;
    return v === '?' ? 'failing' : v;
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof CalcError) return 'failing';
    throw e;
  }
}

/**
 * Stored calculations whose saved value isn't what the formula gives now, per
 * field. Changes nothing: runs inside a transaction that is rolled back.
 * `limit` caps the records looked at per table (default 10,000). Record
 * values are only included with `examples: true`; without it the report is
 * counts and ids.
 */
export function findStaleCalcs(store: Store, opts: { table?: string; fields?: string[]; limit?: number; examples?: boolean } = {}): StaleReport {
  const limit = Math.max(1, Math.trunc(opts.limit ?? 10_000));
  const report: StaleReport = { fields: [], skipped: [], looked: 0, stale: 0, note: '' };
  const calcs = storedCalcs(store, opts, report.skipped);
  if (opts.table && !store.schema.tables.some((t) => t.name.toLowerCase() === opts.table!.toLowerCase())) throw new StaleCalcError(`Table "${opts.table}" is missing`);
  store.sql.exec('SAVEPOINT stale_calcs');
  try {
    const byTable = new Map<Table, typeof calcs>();
    for (const c of calcs) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]);
    for (const [table, list] of byTable) {
      const records = store.recordCount(table.name);
      const tallies = list.map(({ field, cause }): StaleField => ({ table: table.name, field: field.name, cause, records, looked: 0, stale: 0, wasEmpty: 0, nowEmpty: 0, failing: 0, recordIds: [], ...(opts.examples ? { examples: [] } : {}) }));
      const rows = store.sql.prepare(`SELECT * FROM ${q(table.name)} ORDER BY _fm_record_id LIMIT ?`).iterate(limit) as Iterable<Record<string, SqlValue>>;
      for (const row of rows) {
        list.forEach(({ field }, i) => {
          const t = tallies[i];
          t.looked++;
          const got = current(store, table, field, row);
          if (got === 'failing') { t.failing++; return; }
          const stored = row[field.name] ?? null;
          if (sameStored(stored, got, field)) return;
          t.stale++;
          if (String(stored ?? '') === '') t.wasEmpty++;
          else if (String(got ?? '') === '') t.nowEmpty++;
          if (t.recordIds.length < 20) t.recordIds.push(Number(row._fm_record_id));
          if (t.examples && t.examples.length < 5) t.examples.push({ recordId: Number(row._fm_record_id), stored: shown(stored), now: shown(got) });
        });
      }
      for (const t of tallies) {
        report.looked += t.looked;
        report.stale += t.stale;
        if (t.stale || t.failing) report.fields.push(t);
      }
    }
  } finally {
    store.sql.exec('ROLLBACK TO stale_calcs; RELEASE stale_calcs');
  }
  report.fields.sort((a, b) => b.stale - a.stale);
  report.note = report.stale
    ? 'Nothing was changed. "other records" and "fields named at run time" are expected to drift in FileMaker too; refresh_stale_calcs brings chosen ones up to date and can be undone. '
      + '"this record only" fields FileMaker keeps current, so a difference there more likely means Tabularius works the formula out differently: check before refreshing.'
    : 'Every stored calculation looked at matches its formula.';
  return report;
}

// --- refresh and undo --------------------------------------------------------------------

interface Change { table: string; field: string; recordId: number; before: SqlValue; after: SqlValue }

export interface RefreshBatch {
  id: string;
  at: string;
  account?: string;
  summary: string;
  changes: number;
  undone?: string;
}

/**
 * Brings the chosen stored calculations up to date: every record (or the ones
 * listed) whose stored value isn't what the formula gives now gets the new
 * value, all or none. Records where the formula fails are left alone. The
 * result's id undoes the batch with undoStaleRefresh.
 */
export function refreshStaleCalcs(store: Store, req: { fields: { table: string; field: string; recordIds?: number[] }[] }, opts: WriteOptions = {}): RefreshBatch & { perField: { table: string; field: string; refreshed: number; failing: number; skipped: number }[] } {
  return store.writeAtomically(() => refreshStaleCalcsBatch(store, req, opts));
}

function refreshStaleCalcsBatch(store: Store, req: { fields: { table: string; field: string; recordIds?: number[] }[] }, opts: WriteOptions): RefreshBatch & { perField: { table: string; field: string; refreshed: number; failing: number; skipped: number }[] } {
  if (!Array.isArray(req.fields) || !req.fields.length) throw new StaleCalcError('Nothing to refresh: pick fields');
  const skippedDesign: StaleReport['skipped'] = [];
  const all = storedCalcs(store, {}, skippedDesign);
  const picked = req.fields.map((r) => {
    const c = all.find((x) => x.table.name.toLowerCase() === String(r.table).toLowerCase() && x.field.name.toLowerCase() === String(r.field).toLowerCase());
    if (!c) {
      const why = skippedDesign.find((x) => x.table.toLowerCase() === String(r.table).toLowerCase() && x.field.toLowerCase() === String(r.field).toLowerCase());
      throw new StaleCalcError(why ? `${why.table}::${why.field} can't be refreshed: ${why.reason}` : `${r.table}::${r.field} is not a stored calculation`);
    }
    return { ...c, ids: Array.isArray(r.recordIds) && r.recordIds.length ? new Set(r.recordIds.map(Number)) : undefined };
  });
  const changes: Change[] = [];
  const perField: { table: string; field: string; refreshed: number; failing: number; skipped: number }[] = [];
  store.sql.exec('SAVEPOINT stale_refresh');
  try {
    for (const { table, field, ids } of picked) {
      const todo: { recordId: number; value: SqlValue; expect: SqlValue }[] = [];
      let failing = 0;
      for (const row of store.sql.prepare(`SELECT * FROM ${q(table.name)} ORDER BY _fm_record_id`).iterate() as Iterable<Record<string, SqlValue>>) {
        const id = Number(row._fm_record_id);
        if (ids && !ids.has(id)) continue;
        const got = current(store, table, field, row);
        if (got === 'failing') { failing++; continue; }
        const stored = row[field.name] ?? null;
        if (sameStored(stored, got, field)) continue;
        todo.push({ recordId: id, value: got, expect: stored });
        if (changes.length + todo.length > MAX_CHANGES) throw new StaleCalcError(`More than ${MAX_CHANGES.toLocaleString('en-US')} values at once; refresh fewer fields or records per batch`);
      }
      const { skipped } = store.setStoredCalcValues(table.name, field.name, todo, opts);
      const missed = new Set(skipped);
      for (const t of todo) if (!missed.has(t.recordId)) changes.push({ table: table.name, field: field.name, recordId: t.recordId, before: t.expect, after: t.value });
      perField.push({ table: table.name, field: field.name, refreshed: todo.length - skipped.length, failing, skipped: skipped.length });
    }
    const n = changes.length;
    const summary = `${n} stored value${n === 1 ? '' : 's'} brought up to date in ${perField.filter((p) => p.refreshed).map((p) => `${p.table}::${p.field}`).join(', ') || 'no field'}`;
    const batch = new RefreshJournal(store).add({ account: opts.account, summary, changes });
    store.sql.exec('RELEASE stale_refresh');
    return { ...batch, perField };
  } catch (e) {
    store.sql.exec('ROLLBACK TO stale_refresh; RELEASE stale_refresh');
    throw e;
  }
}

/** Puts back the values a refresh replaced, where they haven't changed again since. */
export function undoStaleRefresh(store: Store, id: string, opts: WriteOptions = {}): { undone: number; skipped: number } {
  return store.writeAtomically(() => undoStaleRefreshBatch(store, id, opts));
}

function undoStaleRefreshBatch(store: Store, id: string, opts: WriteOptions): { undone: number; skipped: number } {
  let undone = 0, skipped = 0;
  store.sql.exec('SAVEPOINT stale_undo');
  try {
    const journal = new RefreshJournal(store);
    const batch = journal.get(id);
    if (!batch) throw new StaleCalcError('No such refresh');
    if (batch.undone) throw new StaleCalcError('Already undone');
    const groups = new Map<string, Change[]>();
    for (const c of batch.changes) {
      const key = `${c.table}\u0000${c.field}`;
      const list = groups.get(key);
      if (list) list.push(c); else groups.set(key, [c]);
    }
    for (const list of groups.values()) {
      const r = store.setStoredCalcValues(list[0].table, list[0].field, list.map((c) => ({ recordId: c.recordId, value: c.before, expect: c.after })), { ...opts, restoring: true });
      undone += r.set;
      skipped += r.skipped.length;
    }
    journal.markUndone(id);
    store.sql.exec('RELEASE stale_undo');
  } catch (e) {
    store.sql.exec('ROLLBACK TO stale_undo; RELEASE stale_undo');
    throw e;
  }
  return { undone, skipped };
}

export const staleRefreshHistory = (store: Store): RefreshBatch[] => new RefreshJournal(store).list();

/** Refreshes made, with the values each replaced, kept in the file. */
class RefreshJournal {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
    store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_calc_refresh (id TEXT PRIMARY KEY, at TEXT NOT NULL, account TEXT, summary TEXT NOT NULL,
      changes INTEGER NOT NULL, undo TEXT NOT NULL, undone TEXT)`);
  }

  add(b: { account?: string; summary: string; changes: Change[] }): RefreshBatch {
    const batch: RefreshBatch = { id: randomBytes(6).toString('hex'), at: new Date().toISOString(), ...(b.account ? { account: b.account } : {}), summary: b.summary, changes: b.changes.length };
    this.store.sql.prepare('INSERT INTO _fm_calc_refresh (id, at, account, summary, changes, undo) VALUES (?, ?, ?, ?, ?, ?)')
      .run(batch.id, batch.at, batch.account ?? null, batch.summary, batch.changes, JSON.stringify(b.changes));
    return batch;
  }

  get(id: string): (RefreshBatch & { changes: Change[] }) | undefined {
    const r = this.store.sql.prepare('SELECT * FROM _fm_calc_refresh WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? { ...fromRow(r), changes: JSON.parse(r.undo) } : undefined;
  }

  list(limit = 50): RefreshBatch[] {
    return (this.store.sql.prepare('SELECT * FROM _fm_calc_refresh ORDER BY at DESC, rowid DESC LIMIT ?').all(limit) as unknown as Row[]).map(fromRow);
  }

  markUndone(id: string): void {
    this.store.sql.prepare('UPDATE _fm_calc_refresh SET undone = ? WHERE id = ?').run(new Date().toISOString(), id);
  }
}

interface Row { id: string; at: string; account: string | null; summary: string; changes: number; undo: string; undone: string | null }
const fromRow = (r: Row): RefreshBatch => ({ id: r.id, at: r.at, ...(r.account ? { account: r.account } : {}), summary: r.summary, changes: r.changes, ...(r.undone ? { undone: r.undone } : {}) });
