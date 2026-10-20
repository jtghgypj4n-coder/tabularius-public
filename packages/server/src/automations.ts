// Automations: "when an invoice is marked paid, set the paid date and add a note to the customer". A trigger on a
// table's records (created, changed, or a field changed, with a condition on the record) runs a script on that
// record, on the server, whoever made the change: the web client, the Data API, MCP, ODBC or a script. FileMaker's
// own script triggers fire only in the window of the client that made the change; these fire for every change.
//
// Asked for in plain English, the assistant drafts the trigger and its script; before anyone turns it on it runs
// once on a throwaway copy of the file, offline, with the change that sets it off, and the person sees what it
// would change. Scripts run offline: Insert from URL reaches the network only when the server allows scripts the
// network and the automation does too, and Send Mail sends nothing unless the server's outbound settings say so
// (test mode's outbox). An automation's own changes don't set off automations, so one can't start a loop.
//
// A deleted record can set one off too: the record is gone, so the script runs from the layout with no record,
// and Get ( ScriptParameter ) is the record as it was, as JSON ({"recordId": 12, "fields": {"Name": "…"}}), with
// only the fields the run-as account can see. A capture-only file never has automations.
//
//   GET    /tabularius/automations/v1/databases/{db}            automations, with their recent runs
//   POST   /tabularius/automations/v1/databases/{db}            {automation, script?: {name, text}}: saves it (and the script)
//                                                             ?dryRun=1 tries it on a copy instead, changing nothing
//   PUT    /tabularius/automations/v1/databases/{db}/{id}       {enabled?, name?, ...}: changes it
//   DELETE /tabularius/automations/v1/databases/{db}/{id}
//
// [Full Access] only, as design changes are: an automation runs a script on every matching change.

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStoreFormula, NOT_LOGGED, Store, StoreError, writer, type Change, type DesignOp, type Privileges } from '../../store/src/index.ts';
import { asBoolean, asText } from '../../calc/src/index.ts';
import { captureOnly, runScript } from '../../scripts/src/index.ts';
import { ApiError, badPathError, readJson, sessionPrivileges, type DataApi } from './dataapi.ts';
import type { Host } from './host.ts';
import { checkScript } from './script-check.ts';
import { DRY_RUN_MAX_BYTES } from './dry-run.ts';
import { HIDDEN_VALUE, containsSecret, secretName, storedSecretValues } from './ai-output.ts';

export type AutomationEvent = 'create' | 'update' | 'createOrUpdate' | 'delete';

export interface Automation {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** Its records are watched, and the script runs from this layout, on the record. */
  layout: string;
  on: AutomationEvent;
  /** An update sets it off only when one of these fields changed ("when Status changes"). */
  fields?: string[];
  /** A formula on the record after the change; the script runs only when it is true (Status = "Paid"). */
  condition?: string;
  script: string;
  /** A formula on the record whose result is Get ( ScriptParameter ). */
  parameter?: string;
  /** The account the script runs as: its privilege set applies. */
  account: string;
  /** Insert from URL may reach the network: only when the server also allows scripts the network. */
  network?: boolean;
  created: string;
  updated: string;
  createdBy?: string;
}

export interface AutomationRun {
  at: string;
  recordId: number;
  outcome: 'ok' | 'warning' | 'error' | 'skipped';
  error?: number;
  steps?: number;
  ms?: number;
  message?: string;
}

export class AutomationError extends Error {}

/** How a finished run is logged: a step that found its record in use (an open window holds it) is a warning, not OK, though the script went on. */
export function runOutcome(r: { error: number; steps: number; recordInUse?: { line: string; message: string } }): Omit<AutomationRun, 'at' | 'recordId'> {
  if (r.error) return { outcome: 'error', error: r.error, steps: r.steps };
  if (r.recordInUse) {
    return { outcome: 'warning', error: 301, steps: r.steps, message: `${r.recordInUse.line} did not change the record: ${r.recordInUse.message}. Leave the record in that window, then change it again to run the automation again.` };
  }
  return { outcome: 'ok', steps: r.steps };
}

const EVENTS = new Set<AutomationEvent>(['create', 'update', 'createOrUpdate', 'delete']);
const RUNS_KEPT = 50;
/** How long a delete automation waits for the transaction that deleted the record to be kept or reverted. */
const SETTLE_MS = 60_000;
/** Changes made by an automation's script carry this as their writer, so they don't set off automations. */
const OWNER = 'automation:';

const lower = (s: string) => s.toLowerCase();

/** The automation as sent, checked against the file: layout, fields, formulas, script and account exist. */
export function cleanAutomation(store: Store, input: Record<string, unknown>, account: string, heldBack: readonly string[], scriptText?: { name: string; text: string }): Omit<Automation, 'id' | 'created' | 'updated'> {
  if (captureOnly(store.name, heldBack)) throw new AutomationError(`"${store.name}" is a capture-only file: it never runs automations`);
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '');
  const name = str('name').slice(0, 120);
  if (!name) throw new AutomationError('Give the automation a name');
  const layoutName = str('layout');
  let info;
  try {
    info = store.layout(layoutName);
  } catch {
    throw new AutomationError(`No layout "${layoutName}"`);
  }
  if (info.owner !== store) throw new AutomationError(`Layout "${layoutName}" shows a table of another file; set the automation up in that file`);
  const on = (EVENTS.has(input.on as AutomationEvent) ? input.on : 'update') as AutomationEvent;
  const fields = (Array.isArray(input.fields) ? input.fields : []).filter((f): f is string => typeof f === 'string' && f.trim() !== '').map((f) => {
    const hit = info.fields.find((x) => lower(x.name) === lower(f.trim()));
    if (!hit) throw new AutomationError(`Field "${f}" isn't in ${info.table}`);
    return hit.name;
  });
  const context = { occurrence: store.schema.tableOccurrences.find((t) => t.name === info.occurrence)?.id };
  const formula = (k: 'condition' | 'parameter') => {
    const f = str(k);
    if (!f) return undefined;
    const checked = checkStoreFormula(store, f, context);
    if (!checked.ok) throw new AutomationError(`The ${k} ${JSON.stringify(f)} has a problem: ${checked.message}`);
    return f;
  };
  if (on === 'delete') {
    // The record is gone by then: nothing to work a formula out on, or a changed field to name.
    if (fields.length || str('condition') || str('parameter')) {
      throw new AutomationError('An automation on deleted records has no fields, condition or parameter: the script gets the deleted record as JSON in Get ( ScriptParameter )');
    }
  }
  const condition = formula('condition');
  const parameter = formula('parameter');
  const script = scriptText?.name ?? str('script');
  if (!script) throw new AutomationError('Say which script it runs');
  if (!scriptText && !store.schema.scripts.some((s) => s.name === script)) throw new AutomationError(`No script "${script}"`);
  const runAs = str('account') || account;
  try { store.requireActiveAccount(runAs); } catch { throw new AutomationError(`The account "${runAs}" is inactive or missing`); }
  return {
    name, ...(str('description') ? { description: str('description').slice(0, 1000) } : {}), enabled: input.enabled !== false,
    layout: info.name, on, ...(fields.length ? { fields } : {}), ...(condition ? { condition } : {}), script, ...(parameter ? { parameter } : {}),
    account: runAs, ...(input.network === true ? { network: true } : {}),
  };
}

/** What sets it off, in words: "When a record in Invoices is changed, and the change is to Status, if Status = "Paid": run ...". */
export function describeTrigger(a: Pick<Automation, 'layout' | 'on' | 'fields' | 'condition' | 'script' | 'account'>, table: string): string {
  if (a.on === 'delete') return `When a record in ${table} is deleted: run "${a.script}" (from layout ${a.layout}, with the deleted record as JSON in Get ( ScriptParameter )) as ${a.account}`;
  const what = `a record in ${table} is ${a.on === 'create' ? 'created' : a.on === 'createOrUpdate' ? 'created or changed' : 'changed'}`;
  const fields = a.fields?.length ? `${a.on === 'create' ? ' with' : ', and the change is to'} ${a.fields.join(' or ')}` : '';
  return `When ${what}${fields}${a.condition ? `, if ${a.condition}` : ''}: run "${a.script}" on that record (from layout ${a.layout}) as ${a.account}`;
}

// --- saved automations -------------------------------------------------------------

/** Each file's enabled automations, read again at most every few seconds (a write checks them on every change). */
const cache = new WeakMap<Store, { at: number; list: Automation[] }>();
const CACHE_MS = 2_000;

class Saved {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  private table(): boolean {
    try {
      this.store.sql.exec('CREATE TABLE IF NOT EXISTS _fm_automations (id TEXT PRIMARY KEY, json TEXT NOT NULL)');
      this.store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_automation_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, automation TEXT NOT NULL, at TEXT NOT NULL,
        record_id INTEGER, outcome TEXT NOT NULL, error INTEGER, steps INTEGER, ms INTEGER, message TEXT)`);
      return true;
    } catch {
      return false; // a read-only copy: no automations
    }
  }

  list(): Automation[] {
    if (!this.table()) return [];
    return (this.store.sql.prepare('SELECT json FROM _fm_automations').all() as { json: string }[]).map((r) => JSON.parse(r.json) as Automation)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Automation | undefined {
    return this.list().find((a) => a.id === id);
  }

  save(a: Automation): void {
    if (!this.table()) throw new AutomationError('This file is read-only');
    this.store.sql.prepare('INSERT INTO _fm_automations (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(a.id, JSON.stringify(a));
    cache.delete(this.store);
  }

  delete(id: string): boolean {
    if (!this.table()) return false;
    this.store.sql.prepare('DELETE FROM _fm_automation_runs WHERE automation = ?').run(id);
    cache.delete(this.store);
    return this.store.sql.prepare('DELETE FROM _fm_automations WHERE id = ?').run(id).changes > 0;
  }

  logRun(id: string, run: AutomationRun): void {
    if (!this.table()) return;
    this.store.sql.prepare('INSERT INTO _fm_automation_runs (automation, at, record_id, outcome, error, steps, ms, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, run.at, run.recordId, run.outcome, run.error ?? null, run.steps ?? null, run.ms ?? null, run.message ?? null);
    this.store.sql.prepare(`DELETE FROM _fm_automation_runs WHERE automation = ? AND seq NOT IN (SELECT seq FROM _fm_automation_runs WHERE automation = ? ORDER BY seq DESC LIMIT ${RUNS_KEPT})`).run(id, id);
  }

  runs(id: string, limit = 20): AutomationRun[] {
    if (!this.table()) return [];
    return (this.store.sql.prepare('SELECT at, record_id, outcome, error, steps, ms, message FROM _fm_automation_runs WHERE automation = ? ORDER BY seq DESC LIMIT ?').all(id, limit) as
      { at: string; record_id: number; outcome: AutomationRun['outcome']; error: number | null; steps: number | null; ms: number | null; message: string | null }[])
      .map((r) => ({ at: r.at, recordId: r.record_id, outcome: r.outcome, ...(r.error !== null ? { error: r.error } : {}), ...(r.steps !== null ? { steps: r.steps } : {}), ...(r.ms !== null ? { ms: r.ms } : {}), ...(r.message ? { message: r.message } : {}) }));
  }
}

export const listAutomations = (store: Store) => new Saved(store).list();
export const deleteAutomation = (store: Store, id: string) => new Saved(store).delete(id);
export const automationRuns = (store: Store, id: string, limit?: number) => new Saved(store).runs(id, limit);

/** The design change that writes an automation's new or changed script. */
function scriptChange(store: Store, script: { name: string; text: string }): DesignOp {
  const existing = store.schema.scripts.find((s) => s.name === script.name);
  return (existing ? { op: 'updateScript', script: existing.id, text: script.text } : { op: 'createScript', name: script.name, text: script.text }) as DesignOp;
}

/** Saves an automation (writing its script first when one comes with it); returns it with what takes it back. */
/** `heldBack`: the files the server names as a capture-only, besides the built-in ones (outbound captureOnly). */
export function saveAutomation(store: Store, input: Record<string, unknown>, by: string, heldBack: readonly string[], script?: { name: string; text: string }, replace?: string): { automation: Automation; scriptChanged: boolean } {
  if (script) {
    const check = checkScript(store, script.text, String(input.layout ?? ''));
    if (!check.ok) throw new AutomationError(`The script has problems: ${check.problems.map((p) => `line ${p.line}: ${p.message}`).join('; ')}`);
  }
  const spec = cleanAutomation(store, input, by, heldBack, script);
  const saved = new Saved(store);
  const old = replace ? saved.get(replace) : saved.list().find((a) => lower(a.name) === lower(spec.name));
  if (old && !replace && input.replace !== true) throw new AutomationError(`There's already an automation named "${old.name}"`);
  if (script) store.applyDesign([scriptChange(store, script)], { account: by });
  const now = new Date().toISOString();
  const automation: Automation = { ...spec, id: old?.id ?? randomBytes(6).toString('hex'), created: old?.created ?? now, updated: now, createdBy: old?.createdBy ?? by };
  saved.save(automation);
  return { automation, scriptChanged: !!script };
}

// --- dry run --------------------------------------------------------------------------

export interface AutomationDryRun {
  /** The record it was tried on, in the copy. */
  recordId?: number;
  /** The change made to set it off ("Status: Open → Paid"). */
  setOff?: string[];
  /** Whether the condition was true after that change. */
  conditionTrue?: boolean;
  outcome: 'ok' | 'error' | 'stalled' | 'skipped';
  error?: number;
  message?: string;
  steps?: number;
  /** What the script changed in the copy, one line each. */
  changes: string[];
  /** Mail it would have sent, and web requests it would have made; none leave the server in a dry run. */
  outbound: string[];
}

const modelViews = new WeakMap<AutomationDryRun, AutomationDryRun>();

/**
 * A dry run as a model may read it: the person sees the real values in the card, but a value in a password, key or
 * token field, or a copy of one a script made elsewhere, is hidden here (the same rule the record tools follow).
 */
export function dryRunForModel(run: AutomationDryRun): AutomationDryRun {
  return modelViews.get(run) ?? run;
}

/**
 * The automation tried once on a throwaway copy of the file, offline: on a record (one where the condition is
 * false, when `test` gives the change that sets it off), the change made, the condition checked, the script run.
 * The live file is never touched.
 */
export async function dryRunAutomation(store: Store, spec: Omit<Automation, 'id' | 'created' | 'updated'>, script?: { name: string; text: string },
  test?: Record<string, string | number>, maxBytes = DRY_RUN_MAX_BYTES): Promise<AutomationDryRun> {
  let size = 0;
  try {
    size = statSync(store.path).size;
  } catch {
    // in memory: copy it anyway
  }
  if (size > maxBytes) return { outcome: 'skipped', message: `the file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, too large to copy for a dry run`, changes: [], outbound: [] };
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-automation-'));
  let copy: Store | undefined;
  try {
    const file = join(dir, 'copy.sqlite');
    await store.backup(file);
    copy = new Store(file, store.name);
    copy.readContainersLike(store);
    if (script) copy.applyDesign([scriptChange(copy, script)], { account: 'AI dry run' });
    const info = copy.layout(spec.layout);
    const truth = (id: number) => !spec.condition || asBoolean(copy!.evaluateEach(info, [spec.condition], id, { account: spec.account })[0] ?? { type: 'text', value: '' });
    // As the account it will run as, so the dry run shows what that account's privileges let it do, on a record it can see.
    const privileges = copy.privileges(spec.account);
    const ids = copy.findIds(info, {}).filter((id) => copy!.canViewRecord(info.table, id, privileges));
    let recordId: number | undefined;
    const setOff: string[] = [];
    const setOffModel: string[] = [];
    const secrets = storedSecretValues(copy);
    // Read again once the change that sets it off is made, and again after the script: either can bring a secret value in.
    // Added to, never replaced: a record the script deleted still handed its values to the script.
    const refreshSecrets = () => { for (const v of storedSecretValues(copy!)) if (!secrets.includes(v)) secrets.push(v); };
    const shown = (field: string, value: unknown): string => (secretName(field) || containsSecret(value, secrets) ? HIDDEN_VALUE : String(value ?? ''));
    let deletedParameter: string | undefined;
    if (spec.on === 'delete') {
      if (!ids.length) return { setOff, outcome: 'skipped', message: `there's no ${info.table} record ${spec.account} can see to delete`, changes: [], outbound: [] };
      // As when it runs: only for an account that can plainly see every record of the table.
      if (privileges.table(info.table).view !== true) return { setOff, outcome: 'skipped', message: `${spec.account} can't be shown to have seen a deleted record`, changes: [], outbound: [] };
      recordId = ids[0];
      copy.delete(info, recordId, { account: spec.account });
      const was = copy.auditLog({ table: info.table, recordId, kind: 'delete', limit: 1 })[0]?.changes ?? {};
      deletedParameter = JSON.stringify({ recordId, fields: deletedFields(was, info.table, privileges) });
      setOff.push(`${info.table} record ${recordId} deleted`);
      setOffModel.push(setOff.at(-1)!);
    } else if (spec.on === 'create' || !ids.length) {
      recordId = copy.create(info, test ?? {}, { account: spec.account }).recordId;
      const created = (hide: boolean) => `A new ${info.table} record${test ? ` with ${Object.entries(test).map(([k, v]) => `${k} ${JSON.stringify(hide ? shown(k, v) : String(v))}`).join(', ')}` : ''}`;
      setOff.push(created(false));
      setOffModel.push(created(true));
    } else {
      // A record the change would set off: one where the condition is false before it, when there's a change to make.
      recordId = (test ? ids.find((id) => !truth(id)) : ids.find((id) => truth(id))) ?? ids[0];
      if (test) {
        const before = copy.select(`SELECT ${Object.keys(test).map((k) => `"${k.replace(/"/g, '""')}"`).join(', ')} FROM "${info.table.replace(/"/g, '""')}" WHERE _fm_record_id = ?`, [recordId], 1).rows[0] ?? [];
        copy.update(info, recordId, test, undefined, { account: spec.account });
        Object.entries(test).forEach(([k, v], i) => {
          const was = asText({ type: 'text', value: String(before[i] ?? '') });
          setOff.push(`${k}: ${JSON.stringify(was)} → ${JSON.stringify(String(v))} on record ${recordId}`);
          setOffModel.push(`${k}: ${JSON.stringify(shown(k, was))} → ${JSON.stringify(shown(k, v))} on record ${recordId}`);
        });
      }
    }
    refreshSecrets();
    const conditionTrue = spec.on === 'delete' || truth(recordId);
    const early = (r: AutomationDryRun): AutomationDryRun => { modelViews.set(r, { ...r, setOff: setOffModel }); return r; };
    if (!conditionTrue) return early({ recordId, setOff, conditionTrue, outcome: 'skipped', message: 'the condition is false on the record it was tried on, so the script wouldn\'t run', changes: [], outbound: [] });
    const target = copy.schema.scripts.find((s) => s.name === spec.script);
    if (!target) return early({ recordId, setOff, conditionTrue, outcome: 'skipped', message: `no script "${spec.script}"`, changes: [], outbound: [] });
    const since = copy.auditLog({ limit: 1 })[0]?.seq ?? 0;
    const parameter = deletedParameter ?? (spec.parameter ? copy.evaluate(info, spec.parameter, recordId, { account: spec.account }).value : undefined);
    const r = await runScript(copy, target, {
      layout: info.name, ...(spec.on === 'delete' ? { foundSet: [] } : { foundSet: [recordId], recordId }), account: spec.account, executionAccount: spec.account, executionStore: store, privileges, ...(parameter !== undefined ? { parameter } : {}),
      network: false, documents: join(dir, 'documents'), timeoutMs: 5_000, maxSteps: 20_000, trace: true,
    });
    const stalled = r.actions.some((a) => a.step === 'Halt Script' && /limit reached/.test(String(a.reason)));
    refreshSecrets();
    const entries = copy.auditLog({ limit: 500 }).filter((e) => e.seq > since && !e.security);
    const changeLines = (hide: boolean): string[] => entries.map((e) => {
      const fields = e.changes && typeof e.changes === 'object' ? Object.entries(e.changes as Record<string, unknown>) : [];
      // A script can change a value (Substitute, Base64Encode) so that it no longer matches the secret it came from, so
      // while the file stores any secret the model is told which fields changed, never to what.
      const v = (k: string, value: unknown) => JSON.stringify(hide ? (secrets.length || secretName(k) ? HIDDEN_VALUE : String(value ?? '')) : String(value ?? ''));
      if (e.kind === 'update') return `Sets ${fields.map(([k, x]) => `${e.table}::${k} to ${v(k, (x as unknown[])[1])}`).join(', ')} on record ${e.recordId}`;
      if (e.kind === 'create') return `Creates a ${e.table} record${fields.length ? ` (${fields.map(([k, x]) => `${k} ${v(k, x)}`).join(', ')})` : ''}`;
      if (e.kind === 'delete') return `Deletes ${e.table} record ${e.recordId}`;
      return `${e.kind} ${e.table}`;
    }).slice(0, 50);
    const changes = changeLines(false);
    // Steps that would reach outside: in a dry run none do (Send Mail sends nothing, Insert from URL has no network).
    const outbound = (r.trace ?? []).filter((t) => /^(Send Mail|Insert from URL|Open URL|Send Event)\b/.test(t.line))
      .map((t) => `${t.line.slice(0, 160)}: not done in the dry run${t.error ? ` (error ${t.error})` : ''}`).slice(0, 20);
    const run: AutomationDryRun = { recordId, setOff, conditionTrue, outcome: stalled ? 'stalled' : r.error ? 'error' : 'ok', ...(r.error ? { error: r.error } : {}), steps: r.steps, changes, outbound };
    modelViews.set(run, { ...run, setOff: setOffModel, changes: changeLines(true) });
    return run;
  } catch (e) {
    return { outcome: 'error', error: e instanceof StoreError ? e.code : -1, message: (e as Error).message, changes: [], outbound: [] };
  } finally {
    copy?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- running -------------------------------------------------------------------------

/** Watches every hosted file's changes and runs the automations they set off, one at a time per file. */
export class AutomationRunner {
  private readonly host: Host;
  private readonly queues = new WeakMap<Store, Promise<void>>();
  /** Runs finished, for tests and the admin console: resolves when a file's queue is empty. */
  idle(store: Store): Promise<void> {
    return this.queues.get(store) ?? Promise.resolve();
  }

  constructor(host: Host) {
    this.host = host;
    for (const store of host.openStores()) this.watch(store);
    host.onAdd.push((s) => this.watch(s));
  }

  private watch(store: Store): void {
    store.listeners.add((c) => this.changed(store, c));
  }

  private changed(store: Store, c: Change): void {
    if ((c.kind !== 'create' && c.kind !== 'update' && c.kind !== 'delete') || c.recordId === undefined || c.remote || c.owner?.startsWith(OWNER)) return;
    let hit = cache.get(store);
    if (!hit || performance.now() - hit.at > CACHE_MS) {
      try {
        hit = { at: performance.now(), list: new Saved(store).list().filter((a) => a.enabled) };
      } catch {
        return;
      }
      cache.set(store, hit);
    }
    const list = hit.list;
    // A deleted record's audit entry, read now: by the time its automations run, a new record may have its id.
    let gone: { seq: number; values: Record<string, unknown> } | undefined;
    for (const a of list) {
      if ((a.on === 'delete') !== (c.kind === 'delete')) continue;
      if (a.on === 'create' && c.kind !== 'create') continue;
      if (a.on === 'update' && c.kind !== 'update') continue;
      if (c.kind === 'update' && a.fields?.length && !a.fields.some((f) => c.fields?.some((x) => lower(x) === lower(f)))) continue;
      let table: string;
      try {
        table = store.layout(a.layout).table;
      } catch {
        continue;
      }
      if (table !== c.table) continue;
      const recordId = c.recordId;
      if (c.kind === 'delete' && !gone) {
        const e = store.auditLog({ table, recordId, kind: 'delete', limit: 1 })[0];
        if (!e) continue;
        gone = { seq: e.seq, values: e.changes ?? {} };
      }
      const was = gone;
      // In the automation's own context, not the client whose change set it off: its condition, parameter and
      // record access never see (or set) that client's $$variables or global fields.
      // Refuse work at acceptance as well as when it reaches the server queue.
      try { store.requireActiveAccount(a.account); } catch { continue; }
      const next = (this.queues.get(store) ?? Promise.resolve()).then(() => writer.run({ owner: `${OWNER}${a.id}`, account: a.account, surface: 'automation' }, () => this.run(store, a, recordId, was)));
      this.queues.set(store, next);
    }
  }

  private async run(store: Store, a: Automation, recordId: number, deleted?: { seq: number; values: Record<string, unknown> }): Promise<void> {
    const started = Date.now();
    const saved = new Saved(store);
    const log = (run: Omit<AutomationRun, 'at' | 'recordId'>) => saved.logRun(a.id, { at: new Date(started).toISOString(), recordId, ms: Date.now() - started, ...run });
    try {
      const opts = this.host.scriptOptions();
      if (captureOnly(store.name, opts.outbound?.captureOnly)) return log({ outcome: 'skipped', message: `"${store.name}" is a capture-only file: it never runs automations` });
      store.requireActiveAccount(a.account);
      const info = store.layout(a.layout);
      if (deleted) return await this.runDeleted(store, a, info, recordId, deleted, log);
      if (!store.select(`SELECT 1 FROM "${info.table.replace(/"/g, '""')}" WHERE _fm_record_id = ?`, [recordId], 1).rows.length) {
        return log({ outcome: 'skipped', message: 'the record was deleted' });
      }
      let privileges: Privileges;
      try {
        privileges = store.privileges(a.account);
      } catch {
        return log({ outcome: 'error', error: 212, message: `no account "${a.account}"` });
      }
      // A record the account can't see doesn't set off its automations.
      if (!store.canViewRecord(info.table, recordId, privileges)) return log({ outcome: 'skipped', message: `${a.account} can't view this record` });
      if (a.condition) {
        const v = store.evaluateEach(info, [a.condition], recordId, { account: a.account })[0];
        if (!v || !asBoolean(v)) return; // not set off: nothing to log
      }
      const script = store.schema.scripts.find((s) => s.name === a.script);
      if (!script) return log({ outcome: 'error', error: 104, message: `no script "${a.script}"` });
      privileges.checkScript(script.name);
      const parameter = a.parameter ? store.evaluate(info, a.parameter, recordId, { account: a.account }).value : undefined;
      const r = await writer.run({ owner: `${OWNER}${a.id}`, account: a.account, surface: 'automation' }, () => opts.serverQueue.run((stop) => runScript(store, script, {
        ...(stop ? { stop } : {}),
        layout: info.name, foundSet: [recordId], recordId, account: a.account, executionAccount: a.account, privileges, ...(parameter !== undefined ? { parameter } : {}),
        documents: opts.documents, network: opts.network && a.network === true, ...(opts.networkAllow ? { networkAllow: opts.networkAllow } : {}),
        ...(opts.outbound ? { outbound: opts.outbound } : {}), ...(opts.profile ? { profile: opts.profile } : {}),
        // No AI steps: AI apps can save automations (MCP save_automation), and scripts AI apps start stay offline.
        timeoutMs: 60_000,
      }), { file: store.name, script: script.name, account: a.account, kind: 'automation' }));
      log(runOutcome(r));
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      log({ outcome: 'error', error: typeof code === 'number' ? code : -1, message: (e as Error).message });
    }
  }

  /** A deleted record's automation: the script runs from the layout with no record, given the record as JSON. */
  private async runDeleted(store: Store, a: Automation, info: ReturnType<Store['layout']>, recordId: number, deleted: { seq: number; values: Record<string, unknown> },
    log: (run: Omit<AutomationRun, 'at' | 'recordId'>) => void): Promise<void> {
    // A delete inside a script's transaction can still be reverted: wait for it to be kept or undone, then run
    // only for a delete that was kept: its audit entry is still there (a reverted one is rolled back with it).
    // A new record may have the id by now, so that alone doesn't say.
    for (const until = performance.now() + SETTLE_MS; store.undoable && performance.now() < until;) await new Promise((r) => setTimeout(r, 50));
    if (store.undoable) return log({ outcome: 'skipped', message: 'the delete was still in an open transaction' });
    const kept = store.auditLog({ table: info.table, recordId, kind: 'delete', limit: 50 }).some((e) => e.seq === deleted.seq);
    if (!kept) return log({ outcome: 'skipped', message: 'the delete was undone' });
    const values = deleted.values;
    let privileges: Privileges;
    try {
      store.requireActiveAccount(a.account);
      privileges = store.privileges(a.account);
    } catch {
      return log({ outcome: 'error', error: 212, message: `no account "${a.account}"` });
    }
    // Only a record the account could plainly see: a record-level rule can't be worked out on a record that's gone.
    if (privileges.table(info.table).view !== true) return log({ outcome: 'skipped', message: `${a.account} can't be shown to have seen the deleted record` });
    const script = store.schema.scripts.find((s) => s.name === a.script);
    if (!script) return log({ outcome: 'error', error: 104, message: `no script "${a.script}"` });
    privileges.checkScript(script.name);
    const parameter = JSON.stringify({ recordId, fields: deletedFields(values, info.table, privileges) });
    const opts = this.host.scriptOptions();
    const r = await writer.run({ owner: `${OWNER}${a.id}`, account: a.account, surface: 'automation' }, () => opts.serverQueue.run((stop) => runScript(store, script, {
      ...(stop ? { stop } : {}),
      layout: info.name, foundSet: [], account: a.account, executionAccount: a.account, privileges, parameter,
      documents: opts.documents, network: opts.network && a.network === true, ...(opts.networkAllow ? { networkAllow: opts.networkAllow } : {}),
      ...(opts.outbound ? { outbound: opts.outbound } : {}), ...(opts.profile ? { profile: opts.profile } : {}),
      timeoutMs: 60_000,
    }), { file: store.name, script: script.name, account: a.account, kind: 'automation' }));
    log(runOutcome(r));
  }
}

/** A deleted record's values (from its audit entry) as text, leaving out fields the account can't see. */
export function deletedFields(values: Record<string, unknown>, table: string, privileges?: Privileges): Record<string, string> {
  return Object.fromEntries(Object.entries(values)
    .filter(([k, v]) => v !== NOT_LOGGED && (!privileges || privileges.field(table, k.replace(/\(\d+\)$/, '')) !== 'none'))
    .map(([k, v]) => [k, v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v)]));
}

// --- HTTP -----------------------------------------------------------------------------

export class AutomationApi {
  private readonly host: Host;
  private readonly api: DataApi;

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  /** Files the server names as a capture-only, besides the built-in ones. */
  private heldBack(): string[] {
    return this.host.scriptOptions().outbound?.captureOnly ?? [];
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/automations\/v1\/databases\/([^/]+)(?:\/([0-9a-f]{12}))?$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const db = decodeURIComponent(m[1]);
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      if (!sessionPrivileges(store, session).full) throw new ApiError(9, `Account "${session.account}" doesn't have full access, which automations need`, 403);
      const saved = new Saved(store);
      const shown = (a: Automation) => ({ ...a, trigger: describeTrigger(a, tableOf(store, a.layout)), runs: saved.runs(a.id, 10) });
      const id = m[2];
      if (!id && req.method === 'GET') send(200, { automations: saved.list().map(shown), network: this.host.scriptOptions().network, outbound: !!this.host.scriptOptions().outbound });
      else if (!id && req.method === 'POST') {
        const body = await readJson(req);
        const input = (body.automation && typeof body.automation === 'object' ? body.automation : {}) as Record<string, unknown>;
        const script = scriptOf(body.script);
        if (url.searchParams.get('dryRun') === '1') {
          if (script) {
            const check = checkScript(store, script.text, String(input.layout ?? ''));
            if (!check.ok) throw new AutomationError(`The script has problems: ${check.problems.map((p) => `line ${p.line}: ${p.message}`).join('; ')}`);
          }
          const spec = cleanAutomation(store, input, session.account, this.heldBack(), script);
          const test = body.test && typeof body.test === 'object' ? body.test as Record<string, string | number> : undefined;
          send(200, { automation: spec, trigger: describeTrigger(spec, tableOf(store, spec.layout)), dryRun: await dryRunAutomation(store, spec, script, test) });
        } else {
          const r = saveAutomation(store, input, session.account, this.heldBack(), script);
          send(201, { automation: shown(r.automation), scriptChanged: r.scriptChanged });
        }
      } else {
        const a = id ? saved.get(id) : undefined;
        if (!a) throw new ApiError(401, 'No such automation', 404);
        if (req.method === 'GET') send(200, { automation: { ...shown(a), runs: saved.runs(a.id, RUNS_KEPT) } });
        else if (req.method === 'PUT') {
          const body = await readJson(req);
          const r = saveAutomation(store, { ...a, ...body }, session.account, this.heldBack(), undefined, a.id);
          send(200, { automation: shown(r.automation) });
        } else if (req.method === 'DELETE') {
          saved.delete(a.id);
          send(200, { deleted: a.id });
        } else throw new ApiError(3, 'Not supported', 405);
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof AutomationError ? new ApiError(960, e.message, 400) : e instanceof StoreError ? new ApiError(e.code, e.message, 400) : new ApiError(-1, 'Unknown error');
      if (!(e instanceof URIError) && !(e instanceof ApiError) && !(e instanceof AutomationError) && !(e instanceof StoreError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message } });
    }
    return true;
  }
}

export function tableOf(store: Store, layout: string): string {
  try {
    return store.layout(layout).table;
  } catch {
    return layout;
  }
}

export function scriptOf(v: unknown): { name: string; text: string } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = v as Record<string, unknown>;
  const name = typeof s.name === 'string' ? s.name.trim() : '';
  const text = typeof s.text === 'string' ? s.text : '';
  if (!name || !text.trim()) throw new AutomationError('A script needs a name and its steps');
  return { name, text };
}
