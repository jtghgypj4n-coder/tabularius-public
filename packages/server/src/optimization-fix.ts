// Fixes the optimization report can make to a file's design, each one change a person approves first and can undo:
// hiding or removing scripts, value lists and table occurrences nothing uses, and storing an unstored calculation
// that a sort or match depends on. A fix says exactly what it will do before it does it (preview), makes the whole
// change at once or not at all, and keeps what it takes to put everything back (undo). Nothing runs from the report
// by itself.
//
// Removing is undone from a patch: what the change took out of the design (the scripts, the value lists, the table
// occurrences, and the privilege sets' entries for them) and where it was, so undo puts back exactly that and leaves
// what was changed since alone. Storing a calculation is undone by making it unstored again (storing it works the
// values out for every record, so it is a change to the design's options, not only to what is listed).

import type { DesignOp, Store } from '../../store/src/index.ts';
import { diffDesign } from '../../store/src/patch.ts';
import { StoreError, type Privileges } from '../../store/src/index.ts';
import { storable, unusedFindings, type OptimizationAction, type UnusedNames } from './optimization.ts';

export type FixId = 'hide-scripts' | 'remove-scripts' | 'remove-value-lists' | 'remove-table-occurrences' | 'store-calculation';
export const FIXES: FixId[] = ['hide-scripts', 'remove-scripts', 'remove-value-lists', 'remove-table-occurrences', 'store-calculation'];

/** A fix that can't be made, with the HTTP status that tells the caller why. */
export class FixError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface FixPlan {
  fix: FixId;
  label: string;
  /** Everything it will do, one line each. */
  will: string[];
  count: number;
  ops: DesignOp[];
  /** What puts it back. */
  undo: DesignOp[];
}

export interface FixChange { id: number; at: string; label: string; will: string[]; undo: DesignOp[]; undone?: true }

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const lower = (s: string) => s.toLowerCase();
const META = 'optimizationFixes';
const KEPT = 20;
const PATH = (db: string) => `/tabularius/admin/v1/optimization/${encodeURIComponent(db)}/fix`;

/** The action a finding offers for a fix: the request that previews it and carries it out, and what it is called. */
export function fixAction(store: Store, fix: FixId, count: number, items?: string[]): OptimizationAction {
  const label = {
    'hide-scripts': `Hide ${plural(count, 'script')} from the Scripts menu`,
    'remove-scripts': `Remove ${plural(count, 'script')}`,
    'remove-value-lists': `Remove ${plural(count, 'value list')}`,
    'remove-table-occurrences': `Remove ${plural(count, 'table occurrence')}`,
    'store-calculation': `Make ${items?.[0] ?? 'the calculation'} a stored calculation`,
  }[fix];
  return { id: fix, label, available: true, undoable: true, request: { method: 'POST', path: PATH(store.name), body: { fix, count, ...(items ? { items } : {}) } } };
}

// --- what a fix would do ------------------------------------------------------------

function unusedNames(store: Store): UnusedNames {
  const names: UnusedNames = { scripts: [], valueLists: [], occurrences: [] };
  unusedFindings(store, [], names);
  return names;
}

/** The names a request asks for, which must still be among those nothing uses; all of them when it names none. */
function chosen(all: string[], asked: string[] | undefined, what: string): string[] {
  if (!asked?.length) return all;
  const have = new Set(all.map(lower));
  const missing = asked.find((n) => !have.has(lower(n)));
  if (missing !== undefined) throw new FixError(409, `${what} "${missing}" is used now, or gone: look at the report again`);
  const want = new Set(asked.map(lower));
  return all.filter((n) => want.has(lower(n)));
}

export function planFix(store: Store, fix: FixId, items?: string[]): FixPlan {
  const s = store.schema;
  let ops: DesignOp[] = [];
  let will: string[] = [];
  let reverse: DesignOp[] | undefined;
  let label: string;
  if (fix === 'store-calculation') {
    if (!items?.length) throw new FixError(400, 'Send items: the calculation, as Table::Field');
    label = `Store ${items.join(', ')}`;
    reverse = [];
    for (const item of items) {
      const at = item.indexOf('::');
      const t = s.tables.find((x) => lower(x.name) === lower(item.slice(0, Math.max(at, 0))));
      const f = t?.fields.find((x) => lower(x.name) === lower(item.slice(at + 2)));
      if (!t || !f || at < 0) throw new FixError(404, `No field ${item}`);
      if (f.kind !== 'calculation' || !f.options?.unstored) throw new FixError(409, `${item} is not an unstored calculation`);
      if (!storable(store, t, f)) throw new FixError(409, `${item} reads related records or something that changes by itself, so it can't simply be stored`);
      ops.push({ op: 'updateField', table: t.id, field: f.id, options: { unstored: false } });
      reverse.push({ op: 'updateField', table: t.id, field: f.id, options: { unstored: true } });
      will.push(`Store the calculation ${t.name}::${f.name}: its values are worked out for every record now and kept in the file, then kept up to date as the fields it reads change. Its formula stays as it is.`);
    }
  } else {
    const names = unusedNames(store);
    if (fix === 'hide-scripts') {
      const shown = (id: number) => !s.scriptOrder.find((o) => o.kind === 'item' && o.id === id)?.hidden;
      const list = chosen(names.scripts, items, 'Script').map((n) => s.scripts.find((x) => x.name === n)!).filter((x) => shown(x.id));
      label = `Hide ${plural(list.length, 'script')}`;
      ops = list.map((x) => ({ op: 'updateScript', script: x.id, includeInMenu: false }));
      will = list.map((x) => `Hide the script "${x.name}" from the Scripts menu. It stays in the file, and can still be run by name, by a button or on a schedule.`);
    } else if (fix === 'remove-scripts') {
      const list = chosen(names.scripts, items, 'Script').map((n) => s.scripts.find((x) => x.name === n)!);
      label = `Remove ${plural(list.length, 'script')}`;
      ops = list.map((x) => ({ op: 'deleteScript', script: x.id }));
      will = list.map((x) => `Remove the script "${x.name}" (${plural(x.steps.length, 'step')}), and its entry in each privilege set.`);
    } else if (fix === 'remove-value-lists') {
      const list = chosen(names.valueLists, items, 'Value list').map((n) => s.valueLists.find((x) => x.name === n)!);
      label = `Remove ${plural(list.length, 'value list')}`;
      ops = list.map((x) => ({ op: 'deleteValueList', valueList: x.id }));
      will = list.map((x) => `Remove the value list "${x.name}".`);
    } else {
      const list = chosen(names.occurrences, items, 'Table occurrence').map((n) => s.tableOccurrences.find((x) => x.name === n)!);
      label = `Remove ${plural(list.length, 'table occurrence')}`;
      ops = list.map((x) => ({ op: 'deleteOccurrence', occurrence: x.id }));
      will = list.map((x) => `Remove the table occurrence "${x.name}". The table, its fields and its records stay: other occurrences of it remain.`);
    }
  }
  if (!ops.length) throw new FixError(409, 'There is nothing left to do here: look at the report again');
  return { fix, label, will, count: ops.length, ops, undo: reverse ?? patchUndo(store, ops) };
}

/** The change that takes `ops` back: what they removed or changed in the design, as a patch. Checking them first changes nothing. */
function patchUndo(store: Store, ops: DesignOp[]): DesignOp[] {
  let after;
  try {
    after = store.checkDesign(ops);
  } catch (e) {
    if (e instanceof StoreError) throw new FixError(409, e.message);
    throw e;
  }
  const before = { schema: store.schema, designs: store.designs(), privileges: store.privilegeSets() };
  const patch = diffDesign(before, { schema: after.schema, designs: after.designs, privileges: after.privileges });
  return [{ op: 'restoreDeleted', deleted: 0, patch }];
}

// --- doing it, and undoing it -----------------------------------------------------------

export function previewFix(store: Store, fix: FixId, items?: string[]): Omit<FixPlan, 'ops' | 'undo'> & { undoable: true } {
  const { ops: _o, undo: _u, ...plan } = planFix(store, fix, items);
  return { ...plan, undoable: true };
}

function history(store: Store): { next: number; changes: FixChange[] } {
  const row = store.sql.prepare('SELECT json FROM _fm_meta WHERE key = ?').get(META) as { json: string } | undefined;
  return row ? JSON.parse(row.json) as { next: number; changes: FixChange[] } : { next: 1, changes: [] };
}
function keep(store: Store, h: { next: number; changes: FixChange[] }): void {
  store.sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(META, JSON.stringify(h));
}

/** Fixes made so far, newest first (what the report lists with an Undo button). */
export function fixChanges(store: Store): { id: number; at: string; label: string; undone?: true }[] {
  return history(store).changes.map(({ id, at, label, undone }) => ({ id, at, label, ...(undone ? { undone } : {}) })).reverse();
}

/** Makes the fix. `count` is how many the person was shown: if the file has changed since, nothing is done. */
export function applyFix(store: Store, fix: FixId, req: { items?: string[]; count?: number } = {}, account?: string, privileges?: Privileges): { fix: FixId; label: string; done: number; will: string[]; undo: number } {
  const plan = planFix(store, fix, req.items);
  if (req.count !== undefined && req.count !== plan.count) throw new FixError(409, `You were shown ${plural(req.count, 'change')} and the file has ${plan.count} now: look at the report again`);
  try {
    store.applyDesign(plan.ops, { account, ...(privileges ? { privileges } : {}) });
  } catch (e) {
    if (e instanceof StoreError) throw new FixError(409, e.message);
    throw e;
  }
  const h = history(store);
  const id = h.next++;
  h.changes.push({ id, at: new Date().toISOString(), label: plan.label, will: plan.will.slice(0, 200), undo: plan.undo });
  // Only the latest few keep what undoes them.
  for (const old of h.changes.slice(0, Math.max(0, h.changes.length - KEPT))) { old.undo = []; old.undone = true; }
  keep(store, h);
  return { fix, label: plan.label, done: plan.count, will: plan.will, undo: id };
}

/** Puts a fix back (the latest not yet undone when no id is given). What was changed since is left as it is. */
export function undoFix(store: Store, id?: number, account?: string, privileges?: Privileges): { undone: string } {
  const h = history(store);
  const change = id === undefined ? [...h.changes].reverse().find((c) => !c.undone) : h.changes.find((c) => c.id === id);
  if (!change) throw new FixError(404, id === undefined ? 'Nothing to undo' : `No change ${id}`);
  if (change.undone || !change.undo.length) throw new FixError(409, `"${change.label}" is already undone, or too old to undo`);
  try {
    store.applyDesign(change.undo, { account, recordedRestore: true, ...(privileges ? { privileges } : {}) });
  } catch (e) {
    if (e instanceof StoreError) throw new FixError(409, `Can't undo "${change.label}": ${e.message}`);
    throw e;
  }
  change.undone = true;
  keep(store, h);
  return { undone: change.label };
}
