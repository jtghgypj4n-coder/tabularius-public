// "What changed on this record, and why?": a record's audit trail read the way a developer would piece it together.
// Changes made together (one account, within a couple of seconds) are one event, and each field change says how it
// came about where the file can tell: typed or set by someone, worked out by an auto-enter calculation from a field
// changed in the same event, stamped (modification time, account), looked up from a related record, set by an
// automation's script (its run log matches), or by a data cleanup batch (its journal names the record). Changes to
// other tables at the same moment by the same account are listed alongside (the invoice's line items). FileMaker
// keeps none of this. Read-only; secret-looking values are hidden.

import type { Field, Table } from '../../fmp12/src/index.ts';
import { NOT_LOGGED, type AuditEntry, type Store } from '../../store/src/index.ts';
import { automationRuns, listAutomations } from './automations.ts';
import { cleanupBatchById, cleanupHistory } from './cleanup.ts';
import { secretName } from './ai-output.ts';

const HIDDEN = '‹hidden from AI tools›';
/** Changes this close together, by one account, are one event. */
const TOGETHER_MS = 2000;
/** An automation run this close to a change is taken as its cause. */
const RUN_MS = 10_000;
const VALUE_CHARS = 200;

export interface FieldChange {
  field: string;
  from?: unknown;
  to?: unknown;
  /** How it came about, when the file can tell: "worked out from Status", "stamped with the modification time", ... */
  how?: string;
  /** The audit entry this change is in (what a revert names). */
  seq: number;
}

export interface HistoryEvent {
  at: string;
  account: string | null;
  kind: 'created' | 'changed' | 'deleted';
  /** What made it, when known: an automation, a data cleanup batch. */
  by?: string;
  /** Where it came from: web, rest (Data API), odata, mcp, admin, automation, ... (absent for older entries). */
  surface?: string;
  /** The script that made it, when one did. */
  script?: string;
  /** A duplicate: the record it copied. */
  copyOf?: number;
  /** A revert: the audit entry whose change it put back. */
  revertOf?: number;
  /** The audit entries behind this event, oldest first. */
  seqs: number[];
  changes: FieldChange[];
  /** Other tables changed at the same moment by the same account. */
  alongside?: { table: string; created: number; changed: number; deleted: number }[];
}

export interface RecordHistory {
  table: string;
  recordId: number;
  events: HistoryEvent[];
  /** Older changes not read (pass limit). */
  more?: number;
  note: string;
}

const clip = (v: unknown) => (typeof v === 'string' && v.length > VALUE_CHARS ? `${v.slice(0, VALUE_CHARS)}… (${v.length - VALUE_CHARS} more characters)` : v);
const ms = (iso: string) => Date.parse(iso);

const STAMPS: Record<string, string> = {
  modificationTimestamp: 'stamped with the modification time', modificationDate: 'stamped with the modification date',
  modificationTime: 'stamped with the modification time', modificationName: 'stamped with who changed it',
  modificationAccountName: 'stamped with the account that changed it', creationTimestamp: 'stamped with the creation time',
  creationDate: 'stamped with the creation date', creationTime: 'stamped with the creation time',
  creationName: 'stamped with who created it', creationAccountName: 'stamped with the account that created it',
};

/** Fields of the same table an auto-enter formula names (bare, or as Occurrence::Field). */
function namesFields(formula: string, table: Table): string[] {
  const code = formula.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return table.fields.filter((f) => new RegExp(`(^|[^\\w])${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i').test(code)).map((f) => f.name);
}

function how(f: Field | undefined, changedTogether: Set<string>, table: Table, hidden: (field: string) => boolean = () => false): string | undefined {
  const ae = f?.options?.autoEnter;
  if (!f || !ae) return undefined;
  if (ae.value && STAMPS[ae.value]) return STAMPS[ae.value];
  if (ae.lookup) return 'looked up from a related record when its match field changed';
  if (ae.calculation && f.calculation) {
    const from = namesFields(f.calculation, table).filter((n) => n !== f.name && changedTogether.has(n) && !hidden(n));
    return from.length ? `worked out by its auto-enter calculation from ${from.join(', ')}` : 'worked out by its auto-enter calculation';
  }
  return undefined;
}

/**
 * A record's history, newest event first. `hideField` leaves out fields the reader may not see, `hideTable` tables. The record may
 * be deleted: its history stays.
 */
export function recordHistory(store: Store, table: string, recordId: number, opts: { limit?: number; hideField?: (field: string) => boolean; hideTable?: (table: string) => boolean } = {}): RecordHistory {
  const t = store.schema.tables.find((x) => x.name.toLowerCase() === table.toLowerCase());
  if (!t) throw new Error(`No table named "${table}"`);
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 2000));
  const all = store.auditLog({ table: t.name, recordId, limit: 10_000 }).filter((e) => !e.security && e.kind !== 'read');
  const entries = all.slice(-limit);
  const hidden = (name: string) => opts.hideField?.(name) ?? false;
  const value = (field: string, v: unknown) => (secretName(field) && v !== '' && v !== null && v !== undefined ? HIDDEN : clip(v));

  // Who ran when: automation runs on this record, and cleanup batches that touched it.
  const runs = listAutomations(store).flatMap((a) => automationRuns(store, a.id, 50)
    .filter((r) => r.recordId === recordId && a.layout && tableOfLayout(store, a.layout) === t.name)
    .map((r) => ({ at: ms(r.at), label: `the automation "${a.name}" (script "${a.script}")` })));
  const cleanups = cleanupHistory(store).flatMap((b) => {
    const full = cleanupBatch(store, b.id);
    const touches = full?.undo.some((u) => (u.op === 'set' && u.table === t.name && u.recordId === recordId) ||
      (u.op === 'restore' && u.table === t.name && Number(u.row._fm_record_id) === recordId) ||
      (u.op === 'remove' && u.table === t.name && u.recordId === recordId));
    return touches ? [{ at: ms(b.at), label: `data cleanup "${b.summary}"` }] : [];
  });

  // Group: one account, entries within TOGETHER_MS of each other; a record's creation stands on its own.
  const groups: AuditEntry[][] = [];
  for (const e of entries) {
    const last = groups.at(-1);
    const prev = last?.at(-1);
    if (last && prev && prev.account === e.account && ms(e.at) - ms(prev.at) <= TOGETHER_MS && e.kind !== 'create' && last[0].kind !== 'create') last.push(e);
    else groups.push([e]);
  }

  const events: HistoryEvent[] = groups.map((g) => {
    const first = g[0];
    const kind: HistoryEvent['kind'] = g.some((e) => e.kind === 'delete') ? 'deleted' : g.some((e) => e.kind === 'create') ? 'created' : 'changed';
    const changed = new Set<string>();
    for (const e of g) for (const k of Object.keys(e.changes ?? {})) changed.add(k);
    const changes: FieldChange[] = [];
    for (const e of g) {
      for (const [field, v] of Object.entries(e.changes ?? {})) {
        if (hidden(field)) continue;
        const f = t.fields.find((x) => x.name === field);
        const h = how(f, changed, t, hidden);
        if (e.kind === 'update' && Array.isArray(v)) changes.push({ field, from: v[0] === NOT_LOGGED ? v[0] : value(field, v[0]), to: v[1] === NOT_LOGGED ? v[1] : value(field, v[1]), ...(h ? { how: h } : {}), seq: e.seq });
        else if (e.kind === 'create') {
          if (v === '' || v === null) continue;
          changes.push({ field, to: value(field, v), ...(h ? { how: h } : {}), seq: e.seq });
        } else if (e.kind === 'delete') {
          if (v === '' || v === null) continue;
          changes.push({ field, from: value(field, v), seq: e.seq });
        }
      }
    }
    const start = ms(first.at);
    const end = ms(g.at(-1)!.at);
    const run = runs.find((r) => r.at >= start - RUN_MS && r.at <= end + RUN_MS);
    const clean = cleanups.find((c) => Math.abs(c.at - start) <= RUN_MS);
    const by = clean?.label ?? run?.label;
    // Other tables, same account, same moment.
    const near = store.auditLog({ account: first.account ?? undefined, since: new Date(start - TOGETHER_MS).toISOString(), until: new Date(end + TOGETHER_MS).toISOString(), limit: 500 })
      .filter((e) => !e.security && e.table && !(e.table === t.name && e.recordId === recordId) && e.account === first.account && !opts.hideTable?.(e.table));
    const counts = new Map<string, { table: string; created: number; changed: number; deleted: number }>();
    for (const e of near) {
      const c = counts.get(e.table) ?? { table: e.table, created: 0, changed: 0, deleted: 0 };
      if (e.kind === 'create') c.created++;
      else if (e.kind === 'update') c.changed++;
      else if (e.kind === 'delete') c.deleted++;
      counts.set(e.table, c);
    }
    return {
      at: first.at, account: first.account, kind, ...(by ? { by } : {}), changes, seqs: g.map((e) => e.seq),
      ...(first.surface ? { surface: first.surface } : {}), ...(first.script ? { script: first.script } : {}),
      ...(first.copyOf !== undefined ? { copyOf: first.copyOf } : {}), ...(first.revertOf !== undefined ? { revertOf: first.revertOf } : {}),
      ...(counts.size ? { alongside: [...counts.values()] } : {}),
    };
  }).reverse();

  return {
    table: t.name, recordId, events,
    ...(all.length > entries.length ? { more: all.length - entries.length } : {}),
    note: 'Newest first. "how" says what the file\'s design shows about a change (auto-enter calculations, stamps, lookups); ' +
      '"by" names an automation or data cleanup that ran at that moment. A change with neither was typed, imported or set by a script or API call. ' +
      'The audit log reaches back only as far as it is kept.',
  };
}

function tableOfLayout(store: Store, layout: string): string | undefined {
  try {
    return store.layout(layout).table;
  } catch {
    return undefined;
  }
}

function cleanupBatch(store: Store, id: string) {
  try {
    return cleanupBatchById(store, id);
  } catch {
    return undefined;
  }
}
