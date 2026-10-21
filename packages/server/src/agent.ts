// Agent mode: the assistant plans a task of several steps (find records, change a field across them, make or delete
// records, run a script) and the person carries it out. The plan is shown with what each step is for; a Dry run does
// every step on a throwaway copy of the file and shows what would change; then each step runs only when the person
// approves it, as their account (its privileges apply to every step), offline, and the whole run goes back with one
// Undo. The model plans from the file's design and never sees what a run changes.
//
//   POST /tabularius/agent/v1/databases/{db}/dry-run      {plan}                     every step on a copy
//   POST /tabularius/agent/v1/databases/{db}/step         {plan, step, state?, run?} one approved step, for real
//   POST /tabularius/agent/v1/databases/{db}/runs/{id}/undo                          the whole run back

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWritesAsync, Store, StoreError, writer, NOT_LOGGED, type FindRequest, type Privileges } from '../../store/src/index.ts';
import type { SqlValue } from '../../store/src/find.ts';
import { recordChanges, runScript, type RecordChanges } from '../../scripts/src/index.ts';
import { appendToBatch, cleanupBatchById, CleanupError, journalBatch, snapshotRows, undoCleanup, type UndoOp } from './cleanup.ts';
import { assertAiPolicy } from './ai-policy.ts';
import { aiBlocker } from './ai-access.ts';
import { ApiError, readBody, sessionPrivileges, type DataApi } from './dataapi.ts';
import { DRY_RUN_MAX_BYTES, fitChanges } from './dry-run.ts';
import { parseRequestJson } from './request-json.ts';
import type { Host } from './host.ts';
import { narrowPrivileges, type TokenScope } from './token-scope.ts';

export type AgentStep =
  | { kind: 'find'; layout: string; query?: FindRequest[]; why?: string }
  | { kind: 'set'; field: string; value: string; why?: string }
  | { kind: 'create'; fieldData: Record<string, string>; why?: string }
  | { kind: 'delete'; why?: string }
  | { kind: 'script'; script: string; parameter?: string; why?: string };

export interface AgentPlan {
  summary: string;
  /** The layout the run starts on. */
  layout: string;
  steps: AgentStep[];
}

/** Where a run is between steps: the layout and its found set, in order. */
export interface RunState { layout: string; foundSet: number[] }

export interface StepResult {
  step: number;
  outcome: 'ok' | 'error';
  message?: string;
  /** Records in the found set after the step. */
  found: number;
  created: number;
  changed: number;
  deleted: number;
  /** The records it made, changed or deleted, field by field (for the person, never the model). */
  records?: RecordChanges;
}

export const MAX_STEPS = 20;
/** Records a step may change a field in, or delete, at once. */
const MAX_SET = 5000;
const MAX_DELETE = 500;

export class AgentError extends Error {}

const lower = (s: unknown) => String(s).toLowerCase();

/** The plan checked against the file and the account: every layout, field and script there, and allowed to it. Throws why not. */
export function checkPlan(store: Store, raw: unknown, p: Privileges | undefined): AgentPlan {
  assertAiPolicy(store, p, 'AI agent plan', { scripts: true });
  const plan = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const steps = Array.isArray(plan.steps) ? plan.steps as Record<string, unknown>[] : [];
  if (!steps.length) throw new AgentError('A plan needs at least one step');
  if (steps.length > MAX_STEPS) throw new AgentError(`A plan has at most ${MAX_STEPS} steps`);
  const layoutNamed = (name: unknown) => {
    const l = store.schema.layouts.find((x) => lower(x.name) === lower(name));
    if (!l || (p && p.layout(l.name).layout === 'none')) throw new AgentError(`No layout "${String(name)}"`);
    return l.name;
  };
  let layout = layoutNamed(plan.layout);
  const out: AgentStep[] = [];
  for (const [i, s] of steps.entries()) {
    const why = typeof s?.why === 'string' ? { why: s.why.slice(0, 300) } : {};
    const at = `Step ${i + 1}`;
    const fieldOn = (name: unknown) => {
      const info = store.layout(layout);
      const f = info.fields.find((x) => lower(x.name) === lower(name));
      if (!f || (p && p.field(info.table, f.name) === 'none')) throw new AgentError(`${at}: no field "${String(name)}" on layout ${layout}`);
      return f.name;
    };
    switch (s?.kind) {
      case 'find': {
        layout = layoutNamed(s.layout ?? layout);
        const query = Array.isArray(s.query) ? (s.query as Record<string, unknown>[]).filter((r) => r && typeof r === 'object' && Object.keys(r).length) : [];
        for (const r of query) for (const k of Object.keys(r)) if (k !== 'omit') fieldOn(k);
        out.push({ kind: 'find', layout, ...(query.length ? { query: query as FindRequest[] } : {}), ...why });
        break;
      }
      case 'set': {
        if (typeof s.value !== 'string' && typeof s.value !== 'number') throw new AgentError(`${at}: a value to set`);
        out.push({ kind: 'set', field: fieldOn(s.field), value: String(s.value), ...why });
        break;
      }
      case 'create': {
        const data = s.fieldData && typeof s.fieldData === 'object' ? s.fieldData as Record<string, unknown> : {};
        out.push({ kind: 'create', fieldData: Object.fromEntries(Object.entries(data).map(([k, v]) => [fieldOn(k), String(v ?? '')])), ...why });
        break;
      }
      case 'delete':
        out.push({ kind: 'delete', ...why });
        break;
      case 'script': {
        const script = store.schema.scripts.find((x) => lower(x.name) === lower(s.script));
        if (!script || (p && p.script(script.name) === 'none')) throw new AgentError(`${at}: no script "${String(s.script)}"`);
        out.push({ kind: 'script', script: script.name, ...(typeof s.parameter === 'string' ? { parameter: s.parameter } : {}), ...why });
        break;
      }
      default:
        throw new AgentError(`${at}: a step is find, set, create, delete or script`);
    }
  }
  return { summary: typeof plan.summary === 'string' && plan.summary ? plan.summary.slice(0, 300) : 'A task in several steps', layout: layoutNamed(plan.layout), steps: out };
}

/** One sentence for each step, for the plan card and the model. */
export function describeStep(s: AgentStep): string {
  switch (s.kind) {
    case 'find': return s.query?.length ? `Find records on ${s.layout}: ${s.query.map((r) => Object.entries(r).filter(([k]) => k !== 'omit').map(([k, v]) => `${k} ${String(v)}`).join(', ')).join('; or ')}` : `Show all records on ${s.layout}`;
    case 'set': return `Set ${s.field} to "${s.value}" in every record found`;
    case 'create': return `Make a record${Object.keys(s.fieldData).length ? ` with ${Object.entries(s.fieldData).map(([k, v]) => `${k} "${v}"`).join(', ')}` : ''}`;
    case 'delete': return 'Delete the records found';
    case 'script': return `Run the script "${s.script}"${s.parameter ? ` with "${s.parameter}"` : ''} on the records found`;
  }
}

/** Audit entries read at once while working out what a step did. */
const AUDIT_PAGE = 10_000;

/**
 * Runs one step as the account. Returns what it did, worked out from the audit entries its own writes made (not
 * anyone else's, nor the same account's in another window), with what takes it back, and where the run is after it.
 */
async function runStep(store: Store, step: AgentStep, state: RunState, who: { account: string; via?: string; privileges?: Privileges; executionStore?: Store; signal?: AbortSignal }): Promise<{ state: RunState; result: Omit<StepResult, 'step'>; undo: UndoOp[] }> {
  who.signal?.throwIfAborted();
  const mine: number[] = [];
  let elsewhere = 0;
  const onAudit = (file: object, seq: number) => (file === store ? mine.push(seq) : elsewhere++);
  const write = { account: who.account, privileges: who.privileges };
  let next = { ...state };
  let message: string | undefined;
  let failed = false;
  assertAiPolicy(store, who.privileges ?? who.account, 'AI agent step', { scripts: true });
  const info = store.layout(state.layout);
  // Only records the account can see on the layout, whatever the client sent.
  const visible = () => {
    const ids = new Set(store.findIds(info, { privileges: who.privileges }));
    return state.foundSet.filter((id) => ids.has(id));
  };
  await writer.run({ ...writer.getStore(), onAudit }, async () => {
    try {
      who.signal?.throwIfAborted();
      switch (step.kind) {
        case 'find':
          next = { layout: step.layout, foundSet: store.findIds(step.layout, { ...(step.query?.length ? { query: step.query } : {}), privileges: who.privileges }) };
          break;
        case 'set': {
          const ids = visible();
          if (ids.length > MAX_SET) throw new AgentError(`${ids.length} records found; change at most ${MAX_SET} at once`);
          for (const id of ids) store.update(info, id, { [step.field]: step.value }, undefined, write);
          break;
        }
        case 'create': {
          const made = store.create(info, step.fieldData, write);
          next = { ...state, foundSet: [...visible(), made.recordId] };
          break;
        }
        case 'delete': {
          const ids = visible();
          if (ids.length > MAX_DELETE) throw new AgentError(`${ids.length} records found; delete at most ${MAX_DELETE} at once`);
          // Deleting records that take related records with them can't be undone whole, so it isn't done here.
          if (ids.length && !snapshotRows(store, info.name, ids)) throw new AgentError('Deleting these records also deletes related records, which Undo could not bring back; delete them in the file instead');
          for (const id of ids) store.delete(info, id, write);
          next = { ...state, foundSet: [] };
          break;
        }
        case 'script': {
          const dir = mkdtempSync(join(tmpdir(), 'tabularius-agent-'));
          try {
            // Offline: no network, no mail, no plug-ins, whatever the server allows its own scripts.
            const r = await runScript(store, step.script, {
              ...(step.parameter !== undefined ? { parameter: step.parameter } : {}), layout: state.layout, foundSet: visible(),
              account: who.account, executionAccount: who.privileges ? who.account : undefined, executionVia: who.via, executionStore: who.executionStore, ...(who.privileges ? { privileges: who.privileges } : {}), network: false, documents: join(dir, 'documents'),
              timeoutMs: 60_000, maxSteps: 200_000, stop: who.signal,
            });
            const found = r.foundSet ? [...r.foundSet] : undefined;
            next = { layout: r.layout ?? state.layout, foundSet: found ?? state.foundSet };
            if (r.error) {
              failed = true;
              message = `The script ended with error ${r.error}`;
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
          break;
        }
      }
    } catch (e) {
      // Whatever went wrong, what the step did before it is still worked out below and kept, so Undo takes it back.
      failed = true;
      if (e instanceof AgentError || e instanceof StoreError) message = e.message;
      else {
        console.error(e);
        message = 'The step stopped with an unexpected error';
      }
    }
  });
  // Commit callbacks have not fired for rows held by an approved step's outer transaction.
  // Read only this writer's staged rows, including sequence numbers remapped by independent window writes.
  const tx = writer.getStore()?.transaction?.open;
  if (tx) for (const file of tx.files.keys()) {
    if (!(file instanceof Store)) continue;
    const staged = file.pendingAuditSeqs(tx, onAudit);
    if (file === store) mine.push(...staged);
    else elsewhere += staged.length;
  }
  // What this step changed: its own audit entries that are still there (a script's reverted transaction takes its back).
  const wanted = new Set(mine);
  const entries: ReturnType<Store['auditLog']> = [];
  if (mine.length) {
    const last = Math.max(...mine);
    for (let after = Math.min(...mine) - 1; after < last;) {
      const page = store.auditLog({ afterSeq: after, limit: AUDIT_PAGE });
      if (!page.length) break;
      entries.push(...page.filter((e) => wanted.has(e.seq) && !e.security));
      after = page.at(-1)!.seq;
    }
  }
  const undo = undoOf(store, entries);
  if (elsewhere) message = `${message ? message + '. ' : ''}It changed ${elsewhere} record${elsewhere === 1 ? '' : 's'} in other files, which Undo can't take back`;
  // A deleted record's audit entry holds every field, so a field the account can't read (hidden or masked) is left out of what goes back.
  // A step that runs with full access can change records the account cannot view: those are not shown to it, nor counted.
  const pv = who.privileges && !who.privileges.full ? who.privileges : undefined;
  const shown = pv
    ? entries.filter((e) => e.recordId === undefined ? pv.table(e.table).view === true : (e.kind === 'delete' ? store.canViewRow(e.table, (e.changes ?? {}) as Record<string, unknown>, pv) : store.canViewRecord(e.table, e.recordId, pv)))
    : entries;
  const changes = recordChanges(shown, 50);
  if (pv) {
    for (const r of changes.records) r.fields = r.fields.filter((f) => pv.field(r.table, f.field.replace(/\(\d+\)$/, '')) !== 'none');
  }
  const count = (k: string) => new Set(shown.filter((e) => e.kind === k).map((e) => `${e.table}\u0000${e.recordId}`)).size;
  return {
    state: next,
    undo,
    result: {
      outcome: failed ? 'error' : 'ok', ...(message ? { message } : {}), found: next.foundSet.length,
      created: count('create'), changed: count('update'), deleted: count('delete'),
      ...(changes.records.length || changes.truncated.length ? { records: fitChanges(changes) } : {}),
    },
  };
}

/**
 * What takes audit entries back, in order: created records removed, changed fields set back, deleted records put back.
 * Only fields a person enters are set back or compared: calculations and auto-entered values follow by themselves.
 */
function undoOf(store: Store, entries: ReturnType<Store['auditLog']>): UndoOp[] {
  const occurrence = (table: string) => {
    const t = store.schema.tables.find((x) => x.name === table);
    return store.schema.tableOccurrences.find((o) => !o.dataSourceId && o.baseTableId === t?.id)?.name ?? table;
  };
  const entered = new Map<string, Set<string>>();
  const plain = (table: string) => {
    let names = entered.get(table);
    if (!names) {
      const t = store.schema.tables.find((x) => x.name === table);
      names = new Set((t?.fields ?? []).filter((f) => f.kind === 'normal' && !f.hasCalculation && !f.options?.global && !f.options?.autoEnter?.value && (f.options?.repetitions ?? 1) <= 1).map((f) => f.name));
      entered.set(table, names);
    }
    return names;
  };
  const undo: UndoOp[] = [];
  for (const e of entries) {
    if (e.recordId === undefined) continue;
    const changes = (e.changes ?? {}) as Record<string, unknown>;
    const names = plain(e.table);
    if (e.kind === 'create') {
      undo.push({ op: 'remove', occurrence: occurrence(e.table), table: e.table, recordId: e.recordId, values: Object.fromEntries(Object.entries(changes).filter(([k, v]) => names.has(k) && v !== NOT_LOGGED)) as Record<string, SqlValue> });
    // A value the audit log was told not to keep can't be put back (it comes back empty).
    } else if (e.kind === 'delete') undo.push({ op: 'restore', table: e.table, row: { ...(Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== NOT_LOGGED)) as Record<string, SqlValue>), _fm_record_id: e.recordId } });
    else if (e.kind === 'update') {
      for (const [field, pair] of Object.entries(changes)) {
        if (!Array.isArray(pair) || !names.has(field) || pair[0] === NOT_LOGGED || pair[1] === NOT_LOGGED) continue;
        undo.push({ op: 'set', occurrence: occurrence(e.table), table: e.table, recordId: e.recordId, field, before: pair[0] as SqlValue, after: pair[1] as SqlValue });
      }
    }
  }
  return undo;
}

/** Every step on a throwaway copy of the file, as the account: what the run would do, nothing kept. */
export async function dryRunPlan(store: Store, plan: AgentPlan, who: { account: string; via?: string; scope?: TokenScope; signal?: AbortSignal }, maxBytes = DRY_RUN_MAX_BYTES): Promise<{ results: StepResult[]; skipped?: string }> {
  let size = 0;
  try {
    size = statSync(store.path).size;
  } catch {
    // in memory: copy it anyway
  }
  if (size > maxBytes) return { results: [], skipped: `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, too large to copy for a dry run` };
  who.signal?.throwIfAborted();
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-agent-dry-'));
  let copy: Store | undefined;
  try {
    await store.backup(join(dir, 'copy.sqlite'));
    who.signal?.throwIfAborted();
    copy = new Store(join(dir, 'copy.sqlite'), store.name);
    copy.readContainersLike(store);
    const privileges = narrowPrivileges(copy, copy.privileges(who.account, who.via), who.scope);
    let state: RunState = { layout: plan.layout, foundSet: copy.findIds(plan.layout, { privileges }) };
    const results: StepResult[] = [];
    for (const [i, step] of plan.steps.entries()) {
      who.signal?.throwIfAborted();
      const r = await runStep(copy, step, state, { signal: who.signal, account: who.account, via: who.via, privileges, executionStore: store });
      results.push({ step: i, ...r.result });
      state = r.state;
      if (r.result.outcome === 'error') break;
    }
    return { results };
  } finally {
    copy?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One approved step for real. The run's changes are kept as one batch (made by its first step) that Undo takes back. */
export async function runApprovedStep(store: Store, plan: AgentPlan, step: number, state: RunState | undefined, run: string | undefined, who: { account: string; via?: string; privileges?: Privileges; executionStore?: Store; signal?: AbortSignal }):
  Promise<{ result: StepResult; state: RunState; run?: string }> {
  if (!Number.isInteger(step) || step < 0 || step >= plan.steps.length) throw new AgentError('No such step');
  // Where the run is comes from the client between steps; runStep keeps to the records the account can see there.
  const start: RunState = step > 0 && state && typeof state.layout === 'string' && Array.isArray(state.foundSet)
    ? { layout: state.layout, foundSet: state.foundSet.map(Number).filter(Number.isInteger).slice(0, 100_000) }
    : { layout: plan.layout, foundSet: store.findIds(plan.layout, { privileges: who.privileges }) };
  if (!store.schema.layouts.some((l) => l.name === start.layout) || (who.privileges && who.privileges.layout(start.layout).layout === 'none')) throw new AgentError(`No layout "${start.layout}"`);
  if (run) {
    const batch = cleanupBatchById(store, run);
    if (!batch || batch.undone || (batch.account ?? '') !== who.account || !batch.summary.startsWith(plan.summary)) throw new AgentError('No such run to add to');
  }
  return atomicWritesAsync(async () => {
    const r = await runStep(store, plan.steps[step], start, who);
    const summary = (n: number) => `${plan.summary} (${n} of ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'} run)`;
    let id = run;
    if (r.undo.length) {
      if (id) appendToBatch(store, id, r.undo, summary(step + 1));
      else id = journalBatch(store, { account: who.account, layout: start.layout, summary: summary(step + 1), undo: r.undo }).id;
    }
    return { result: { step, ...r.result }, state: r.state, ...(id ? { run: id } : {}) };
  });
}

// --- HTTP --------------------------------------------------------------------------------

async function readJson(req: IncomingMessage, max: number): Promise<Record<string, unknown>> {
  const raw = (await readBody(req, max)).toString('utf8');
  try {
    const v = parseRequestJson(raw || '{}', 1_000_000);
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new ApiError(960, 'The request is not JSON', 400);
  }
}

export class AgentApi {
  private readonly host: Host;
  private readonly api: DataApi;

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/agent\/v1\/databases\/([^/]+)\/(dry-run|step|runs\/([0-9a-f]{12})\/undo)$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    try {
      if (req.method !== 'POST') throw new ApiError(3, 'Not supported', 405);
      const db = decodeURIComponent(m[1]);
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      // Plans come from the assistant, so they go when AI is off for the file (or a file it uses).
      const off = aiBlocker(store);
      if (off) throw new ApiError(960, `AI is turned off for ${off === store ? 'this file' : `the file ${off.name}`}`, 403);
      const privileges = sessionPrivileges(store, session);
      assertAiPolicy(store, privileges, 'AI agent API', { scripts: true });
      if (m[3]) {
        send(200, undoCleanup(store, m[3], { account: session.account, privileges }));
        return true;
      }
      const body = await readJson(req, 1_000_000);
      const plan = checkPlan(store, body.plan, privileges);
      const abort = new AbortController();
      const stop = () => abort.abort();
      res.once('close', stop);
      if (res.destroyed) stop();
      try {
        if (m[2] === 'dry-run') send(200, await dryRunPlan(store, plan, { signal: abort.signal, account: session.account, via: session.via, scope: { readOnly: session.readOnly, layouts: session.layoutScope } }));
        else send(200, await runApprovedStep(store, plan, Number(body.step), body.state as RunState | undefined, typeof body.run === 'string' ? body.run : undefined, { signal: abort.signal, account: session.account, via: session.via, privileges }));
      } finally { res.removeListener('close', stop); }
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof AgentError || e instanceof CleanupError ? new ApiError(960, e.message, 400)
        : e instanceof StoreError ? new ApiError(e.code, e.message, e.code === 200 || e.code === 201 ? 403 : 400) : new ApiError(-1, 'Unknown error');
      if (!(e instanceof ApiError) && !(e instanceof AgentError) && !(e instanceof CleanupError) && !(e instanceof StoreError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message } });
    }
    return true;
  }
}
