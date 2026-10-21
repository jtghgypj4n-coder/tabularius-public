// The script debugger and Data Viewer for the web client, like FileMaker Pro's.
// Only accounts with full access may debug, as in FileMaker.
//
//   GET  /tabularius/debug/v1/databases/{db}/scripts            scripts and their steps (text)
//   POST /tabularius/debug/v1/databases/{db}/runs               start: { script, parameter, layout, foundSet,
//                                                               recordId, breakpoints: [{script, index}], pauseAtStart,
//                                                               pauseOnError }
//   GET  /tabularius/debug/v1/databases/{db}/runs               this session's runs (the Data Viewer follows a paused one)
//   GET  /tabularius/debug/v1/databases/{db}/runs/{id}          where it waits, or how it ended, and its profile so far
//   POST /tabularius/debug/v1/databases/{db}/runs/{id}/{into|over|out|continue|halt}
//   POST /tabularius/debug/v1/databases/{db}/runs/{id}/next     { index }: Set Next Step in the paused script
//   PUT  /tabularius/debug/v1/databases/{db}/runs/{id}/breakpoints   { breakpoints: [...] }
//   PUT  /tabularius/debug/v1/databases/{db}/runs/{id}/options  { pauseOnError }
//   POST /tabularius/debug/v1/databases/{db}/runs/{id}/evaluate      { formula } (the Data Viewer, while paused)
//   POST /tabularius/debug/v1/databases/{db}/evaluate   { formulas, layout, recordId?, window? }: the Data Viewer
//        without a script: each formula on the record the web client shows, with the session's $$variables
//   GET  /tabularius/debug/v1/databases/{db}/current?layout=&recordId=   the Data Viewer's Current tab: that
//        record's fields and the session's $$variables
//   POST /tabularius/debug/v1/databases/{db}/recordings   { script, parameter, layout, foundSet, recordId }: time
//        travel. Runs the script to the end on a scratch copy (always, offline) recording each step: where it stood,
//        its variables and found set, and what it did to records, for stepping back and forth afterwards.
//
// Starting and stepping answer when the script next pauses or finishes. By
// default a run works on a throwaway copy of the file (`scratch`, true unless
// sent false), offline (no network, no mail, no plug-ins), so stepping through a
// script that deletes or changes records leaves the hosted file as it was, which
// FileMaker's debugger can't do. With `"scratch": false` it runs on the hosted
// file as the session's scripts otherwise do. Either way it runs with the
// session's account and globals. A run nobody touches for 10 minutes is halted.

import { CredentialRedactor } from '../../scripts/src/redaction.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, StoreError, occurrence, type EvaluateOptions } from '../../store/src/index.ts';
import { q } from '../../store/src/import.ts';
import { asText, num, text } from '../../calc/src/index.ts';
import { OFFLINE_RUN_NOTICE, RunProfile, ScriptDebugger, ScriptSession, recordRun, type DebugCommand, type DebugState } from '../../scripts/src/index.ts';
import { ApiError, badPathError, readJson, sessionPrivileges, type DataApi, type Session } from './dataapi.ts';
import type { Host } from './host.ts';
import { said } from './said.ts';

const IDLE_MS = 10 * 60_000;
/** Files larger than this aren't copied for a scratch run (the copy takes a while and the disk). */
export const SCRATCH_MAX_BYTES = 1024 * 1024 * 1024;
const COMMANDS = new Set(['into', 'over', 'out', 'continue', 'halt']);

interface Run {
  id: string;
  db: string;
  token: string;
  script: string;
  debugger: ScriptDebugger;
  touched: number;
  /** The throwaway copy a scratch run works on, and its folder. */
  scratch?: { store: Store; dir: string };
  /** Where the run's time goes, step by step and script by script (time paused here not counted). */
  profile: RunProfile;
  stop: AbortController;
  ending?: Promise<void>;
}

/** A throwaway copy of the file for a scratch run. */
export async function scratchCopy(store: Store, maxBytes: number): Promise<{ store: Store; dir: string }> {
  let size = 0;
  try {
    size = statSync(store.path).size;
  } catch {
    // a store without a file (in memory): copy it anyway
  }
  if (size > maxBytes) {
    throw new ApiError(960, `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, too large to copy for a scratch run. Send "scratch": false to debug on the hosted file.`, 400);
  }
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-debug-'));
  try {
    const file = join(dir, 'copy.sqlite');
    await store.backup(file);
    const copy = new Store(file, store.name);
    copy.readContainersLike(store); // its externally stored container files stay where they are
    return { store: copy, dir };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** A copy of a session's globals ($$variables, global fields) for a run that mustn't change them. */
function copySession(from: ScriptSession): ScriptSession {
  const to = new ScriptSession();
  for (const [k, v] of from.variables) to.variables.set(k, v.slice());
  for (const [k, v] of from.globalFields) to.globalFields.set(k, v.slice());
  return to;
}

/** Closes a scratch copy and deletes its folder. */
export function dropScratch(copy: { store: Store; dir: string }): void {
  try { copy.store.close(); }
  finally { rmSync(copy.dir, { recursive: true, force: true }); }
}

function discard(r: Run): void {
  if (r.scratch) dropScratch(r.scratch);
  r.scratch = undefined;
}

type Breakpoint = { script: string; index: number };

/** What a window knows that a formula may ask with Get ( ): sent by the web client for the window it shows. */
interface WindowState { mode?: string; view?: string; foundCount?: number; totalCount?: number; number?: number }

function windowState(v: unknown): WindowState {
  const w = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  return { mode: typeof w.mode === 'string' ? w.mode : undefined, view: typeof w.view === 'string' ? w.view : undefined, foundCount: n(w.foundCount), totalCount: n(w.totalCount), number: n(w.number) };
}

/** Formulas evaluate as they would in the web client's window: its Get ( ) values and the session's $$variables. */
function screen(session: Session, layout: string, w: WindowState): EvaluateOptions {
  return {
    account: session.account,
    get: (name) => {
      switch (name.toLowerCase()) {
        case 'windowmode': return num(w.mode === 'find' ? 1 : 0);
        case 'foundcount': return w.foundCount === undefined ? undefined : num(w.foundCount);
        case 'totalrecordcount': return w.totalCount === undefined ? undefined : num(w.totalCount);
        case 'recordnumber': return w.number === undefined ? undefined : num(w.number);
        case 'layoutname': return text(layout);
        case 'layoutviewstate': return num(w.view === 'list' ? 1 : w.view === 'table' ? 2 : 0);
      }
      return undefined;
    },
    variable: (name, rep) => session.scripts.variables.get(name.toLowerCase())?.[rep - 1],
    // Let ( $$name = ... ) sets the session's variable, as FileMaker's Data Viewer does.
    setVariable: (name, rep, value) => {
      const key = name.toLowerCase();
      const values = session.scripts.variables.get(key) ?? [];
      values[rep - 1] = value;
      session.scripts.variables.set(key, values);
    },
  };
}

/** The session's $$variables as text, repetitions after the first as $$name[2]. */
function globalsOf(store: Store, session: Session): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, values] of session.scripts.variables) {
    values.forEach((v, i) => {
      if (v !== undefined) out[i ? `${name}[${i + 1}]` : name] = asText(v, store.dateOrder);
    });
  }
  return out;
}

function diagnosticsOf(store: Store): CredentialRedactor {
  const fields = store.schema.tables.flatMap((t) => t.fields.map((f) => f.name));
  const redaction = new CredentialRedactor({ fields, occurrences: store.schema.tableOccurrences.map((to) => [to.name, fields]) });
  redaction.inspect(store.schema.scripts);
  return redaction;
}

type Field = Store['schema']['tables'][number]['fields'][number];
type LearnedCredential = [value: unknown, field: Field];

/** What the last scan of a file's credential columns found, kept while neither the data nor the columns change. */
const learnedCache = new WeakMap<Store, { token: string; columns: string; learned: LearnedCredential[] }>();

/** SQL and dynamic field reads can return credentials from any row, without a current record. */
function learnStoredCredentials(store: Store, redaction: CredentialRedactor): void {
  const scans: { table: typeof store.schema.tables[number]; fields: typeof store.schema.tables[number]['fields'] }[] = [];
  for (const table of store.schema.tables) {
    const fields = table.fields.filter((f) => f.kind !== 'summary' && redaction.sensitiveName(f.name));
    if (fields.length) scans.push({ table, fields });
  }
  const learn = (value: unknown, field: typeof scans[number]['fields'][number]) => {
    redaction.data(value, field.name);
    if (typeof value === 'string' && (field.options?.repetitions ?? 1) > 1 && value.startsWith('[')) {
      try { redaction.data(JSON.parse(value), field.name); } catch { /* Plain text starting with [. */ }
    }
  };
  // Globals belong to the session and cost nothing to read; stored columns cost a pass over every row.
  for (const { table, fields } of scans) for (const field of fields.filter((f) => f.options?.global)) learn(store.calc.globalValue(table, field), field);
  const columns = scans.flatMap(({ table, fields }) => fields.filter((f) => !f.options?.global).map((f) => ({ table, field: f })));
  if (!columns.length) return;
  // The write token follows every record write in any process, but a rolled-back write puts it back to an earlier value, so
  // while a script transaction or a trial is open nothing is kept or reused, and the scan also reads the committed file:
  // that is what a query through SQL returns while the transaction is open.
  const open = store.undoable || store.sql.isTransaction;
  const token = store.writeToken();
  const names = columns.map((c) => `${c.table.name}\u0000${c.field.name}\u0000${c.field.options?.repetitions ?? 1}`).join('\u0001');
  const kept = open ? undefined : learnedCache.get(store);
  if (kept && kept.token === token && kept.columns === names) {
    for (const [value, field] of kept.learned) learn(value, field);
    return;
  }
  const learned: LearnedCredential[] = [];
  const seen = new Set<string>();
  const sources = open ? [(text: string) => store.sql.prepare(text).iterate(), (text: string) => store.iterateCommitted(text)] : [(text: string) => store.sql.prepare(text).iterate()];
  for (const table of new Set(columns.map((c) => c.table))) {
    const own = columns.filter((c) => c.table === table);
    // Read only credential columns, one row at a time; ordinary data and internal
    // account tables never need to be loaded into this request's redactor.
    const text = `SELECT ${own.map((c) => q(c.field.name)).join(', ')} FROM ${q(table.name)}`;
    for (const rows of sources) for (const row of rows(text)) {
      for (const { field } of own) {
        const value = row[field.name];
        learn(value, field);
        if (value === null || value === undefined || value === '') continue;
        // Repeated values (a shared default password) are replayed once.
        const key = `${table.name}\u0000${field.name}\u0000${typeof value}\u0000${String(value)}`;
        if (!seen.has(key)) { seen.add(key); learned.push([value, field]); }
      }
    }
  }
  if (!open) learnedCache.set(store, { token, columns: names, learned });
}

function breakpoints(v: unknown): Breakpoint[] {
  if (!Array.isArray(v)) return [];
  return v.filter((b): b is Breakpoint => !!b && typeof b.script === 'string' && Number.isInteger(b.index)).map((b) => ({ script: b.script, index: b.index }));
}

export class DebugApi {
  private readonly host: Host;
  private readonly api: DataApi;
  private readonly runs = new Map<string, Run>();
  private readonly sweep: NodeJS.Timeout;
  /** The largest file a scratch run copies. */
  scratchMaxBytes = SCRATCH_MAX_BYTES;

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
    this.sweep = setInterval(() => this.expire(), 60_000);
    this.sweep.unref();
  }

  stop(): Promise<void> {
    clearInterval(this.sweep);
    const ending = [...this.runs.values()].map((r) => this.end(r));
    this.runs.clear();
    return Promise.allSettled(ending).then(() => {});
  }

  private expire(): void {
    for (const [id, r] of this.runs) {
      if (performance.now() - r.touched < IDLE_MS && this.api.alive(r.token)) continue;
      this.end(r);
      this.runs.delete(id);
    }
  }

  /** Halts a run and throws its scratch copy away. */
  private end(r: Run): Promise<void> {
    if (r.ending) return r.ending;
    r.stop.abort();
    if (r.debugger.state().paused) {
      try { void r.debugger.resume('halt').catch(() => {}); }
      catch { /* The step may have resumed between the state check and the call. */ }
    }
    r.ending = r.debugger.whenFinished().then(() => discard(r), () => discard(r));
    return r.ending;
  }

  private view(r: Run, state: DebugState) {
    return { id: r.id, script: r.script, scratch: !!r.scratch, breakpoints: r.debugger.listBreakpoints(), pauseOnError: r.debugger.pauseOnError, ...state, profile: r.profile.report() };
  }

  /** Returns false when the request is not for the debugger. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/debug\/v1\/databases\/([^/]+)\/(scripts|runs|evaluate|current|recordings)(?:\/([0-9a-f]+)(?:\/(\w+))?)?$/.exec(url.pathname);
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
      const privileges = sessionPrivileges(store, session);
      if (!privileges.full) throw new ApiError(9, `Account "${session.account}" doesn't have full access, which the script debugger needs`, 403);
      const [, , kind, id, action] = m;

      if (kind === 'scripts') {
        if (req.method !== 'GET' || id) throw new ApiError(3, 'Command is unavailable', 405);
        const redaction = diagnosticsOf(store);
        return send(200, {
          scripts: store.schema.scripts.map((s) => ({
            id: s.id, name: s.name,
            steps: s.steps.map((st) => ({ line: redaction.line(st), enabled: st.enabled })),
          })),
          // Folders and separators, as the Scripts menu shows them.
          ...(store.schema.scriptOrder ? { order: store.schema.scriptOrder } : {}),
        }), true;
      }

      if (kind === 'evaluate' || kind === 'current') {
        if (id) throw new ApiError(3, 'Command is unavailable', 405);
        const body: Record<string, unknown> = kind === 'evaluate' && req.method === 'POST' ? await readJson(req)
          : kind === 'current' && req.method === 'GET' ? Object.fromEntries(url.searchParams) : (() => { throw new ApiError(3, 'Command is unavailable', 405); })();
        const layout = said(body.layout);
        if (!layout) throw new ApiError(105, 'Send the layout the formulas run from', 400);
        const info = store.layout(layout);
        const recordId = body.recordId === undefined || body.recordId === '' ? undefined : Number(body.recordId);
        if (recordId !== undefined && !Number.isInteger(recordId)) throw new ApiError(101, 'Record ID must be a whole number', 400);
        if (recordId !== undefined) store.row(info, recordId); // 101 when it's gone
        const redaction = diagnosticsOf(store);
        learnStoredCredentials(store, redaction);
        const to = store.calc.occurrence(info.occurrence);
        let fields: Record<string, unknown> = {};
        if (recordId !== undefined && to) {
          const occ = occurrence(store, to.id);
          if (occ) fields = store.get(store.occurrenceInfo(occ), recordId).fieldData;
        }
        const variables = globalsOf(store, session);
        // Seed both collections first so ordinary aliases of credentials are hidden
        // regardless of property order or dynamic field/variable access in formulas.
        redaction.data(fields);
        redaction.data(variables);
        if (kind === 'current') {
          return send(200, { layout, occurrence: info.occurrence, table: info.table, ...(recordId !== undefined ? { recordId } : {}), fields: redaction.data(fields), variables: redaction.data(variables) }), true;
        }
        if (!Array.isArray(body.formulas)) throw new ApiError(960, 'Send {"formulas": ["..."], "layout": "..."}', 400);
        // As the account: a field of another file it can't see there is missing, not read.
        const opts: EvaluateOptions = { ...screen(session, layout, windowState(body.window)), privileges, typed: true };
        const results = body.formulas.map((f) => {
          const formula = String(f);
          try {
            const result = store.evaluate(info, formula, recordId, opts);
            if (redaction.sensitiveExpression(formula)) redaction.remember(result.value);
            redaction.data(globalsOf(store, session));
            return { ...result, formula };
          } catch (e) {
            redaction.data(globalsOf(store, session));
            const message = (e as Error).message;
            const safe = redaction.sensitiveExpression(formula) || redaction.value(message) !== message ? 'Credential step failed' : message;
            if (!(e instanceof StoreError)) throw new ApiError(-1, safe);
            return { value: '?', error: e.code, message: safe, formula };
          }
        });
        return send(200, { results: results.map(({ formula, ...result }) => ({
          ...result,
          value: redaction.value(result.value, undefined, redaction.sensitiveExpression(formula)),
          ...(result.message !== undefined ? { message: redaction.value(result.message) !== result.message ? 'Credential step failed' : result.message } : {}),
        })) }), true;
      }

      if (kind === 'recordings') {
        if (req.method !== 'POST' || id) throw new ApiError(3, 'Command is unavailable', 405);
        const body = await readJson(req);
        const copy = await scratchCopy(store, this.scratchMaxBytes);
        const scripts = copySession(session.scripts);
        try {
          const ids = Array.isArray(body.foundSet) ? body.foundSet.map(Number).filter(Number.isInteger) : undefined;
          const recording = await recordRun(copy.store, said(body.script), {
            ...(body.parameter !== undefined ? { parameter: String(body.parameter) } : {}),
            ...(typeof body.layout === 'string' && body.layout ? { layout: body.layout } : {}),
            ...(ids ? { foundSet: ids } : {}),
            ...(Number.isInteger(body.recordId) ? { recordId: Number(body.recordId) } : {}),
            account: session.account, privileges: sessionPrivileges(copy.store, session),
            ...this.host.scriptOptions(store.name), executionAccount: session.account, executionVia: session.via, executionStore: store,
            // Always on the copy and offline; the session's globals are copied, not changed.
            network: false, networkFiles: undefined, networkOff: () => OFFLINE_RUN_NOTICE, outbound: undefined, mail: undefined, documents: join(copy.dir, 'Documents'), serverQueue: undefined,
            session: scripts,
          });
          return send(200, recording), true;
        } finally {
          scripts.close();
          dropScratch(copy);
        }
      }

      if (!id && req.method === 'GET') {
        const mine = [...this.runs.values()].filter((r) => r.token === session.token && r.db === store.name);
        return send(200, { runs: mine.map((r) => this.view(r, r.debugger.state())) }), true;
      }
      if (!id) {
        if (req.method !== 'POST') throw new ApiError(3, 'Command is unavailable', 405);
        const body = await readJson(req);
        const script = said(body.script);
        const run: Run = {
          id: randomBytes(8).toString('hex'), db: store.name, token: session.token, script,
          debugger: new ScriptDebugger({ pauseAtStart: body.pauseAtStart !== false, pauseOnError: body.pauseOnError === true, breakpoints: breakpoints(body.breakpoints) }),
          touched: performance.now(), profile: new RunProfile(), stop: new AbortController(),
        };
        if (body.scratch !== false) run.scratch = await scratchCopy(store, this.scratchMaxBytes);
        this.runs.set(run.id, run);
        const ids = Array.isArray(body.foundSet) ? body.foundSet.map(Number).filter(Number.isInteger) : undefined;
        const state = await run.debugger.start(run.scratch?.store ?? store, script, {
          ...(body.parameter !== undefined ? { parameter: String(body.parameter) } : {}),
          ...(typeof body.layout === 'string' ? { layout: body.layout } : {}),
          ...(ids ? { foundSet: ids } : {}),
          ...(Number.isInteger(body.recordId) ? { recordId: Number(body.recordId) } : {}),
          account: session.account, session: session.scripts, privileges: run.scratch ? sessionPrivileges(run.scratch.store, session) : privileges,
          ...this.host.scriptOptions(store.name), executionAccount: session.account, executionVia: session.via, executionStore: store,
          // A scratch run is always offline, and its files go in its own folder.
          ...(run.scratch ? { network: false, networkFiles: undefined, networkOff: () => OFFLINE_RUN_NOTICE, outbound: undefined, mail: undefined, documents: join(run.scratch.dir, 'Documents') } : {}),
          // Debugger runs stay out of the server's profile; the run has its own, counting each step's own time (never a pause here).
          profile: run.profile, stop: run.stop.signal,
        });
        return send(201, this.view(run, state)), true;
      }

      const run = this.runs.get(id);
      if (!run || run.token !== session.token || run.db !== store.name) throw new ApiError(101, 'No such debugging run', 404);
      run.touched = performance.now();
      if (!action && req.method === 'GET') return send(200, this.view(run, run.debugger.state())), true;
      if (action === 'current' && req.method === 'GET') {
        const state = run.debugger.state();
        if (!state.paused) throw new ApiError(3, 'The script is no longer paused', 409);
        const currentStore = run.scratch?.store ?? store;
        const layout = state.paused.layout;
        if (!layout) throw new ApiError(105, 'The paused script has no current layout', 400);
        const info = currentStore.layout(layout);
        const recordId = state.paused.mode === 'find' ? undefined : state.paused.recordId;
        if (recordId !== undefined) currentStore.row(info, recordId);
        const fields: Record<string, unknown> = {};
        const to = currentStore.calc.occurrence(info.occurrence);
        if (recordId !== undefined && to) {
          const occ = occurrence(currentStore, to.id);
          if (occ) Object.assign(fields, currentStore.get(currentStore.occurrenceInfo(occ), recordId).fieldData);
        }
        const variables = globalsOf(currentStore, session);
        const redaction = diagnosticsOf(currentStore);
        learnStoredCredentials(currentStore, redaction);
        redaction.data(fields);
        redaction.data(variables);
        return send(200, { layout, occurrence: info.occurrence, table: info.table, ...(recordId !== undefined ? { recordId } : {}), fields: redaction.data(fields), variables: redaction.data(variables) }), true;
      }
      if (action === 'breakpoints' && req.method === 'PUT') {
        run.debugger.setBreakpoints(breakpoints((await readJson(req)).breakpoints));
        return send(200, this.view(run, run.debugger.state())), true;
      }
      if (action === 'options' && req.method === 'PUT') {
        const body = await readJson(req);
        if (typeof body.pauseOnError === 'boolean') run.debugger.pauseOnError = body.pauseOnError;
        return send(200, this.view(run, run.debugger.state())), true;
      }
      if (action === 'next' && req.method === 'POST') {
        if (!run.debugger.state().paused) throw new ApiError(3, 'The script is not paused', 409);
        const index = Number((await readJson(req)).index);
        let state: DebugState;
        try {
          state = await run.debugger.setNextStep(index);
        } catch (e) {
          if (e instanceof RangeError) throw new ApiError(960, e.message, 400);
          throw e;
        }
        return send(200, this.view(run, state)), true;
      }
      if (action === 'evaluate' && req.method === 'POST') {
        if (!run.debugger.state().paused) throw new ApiError(3, 'The script is not paused', 409);
        return send(200, run.debugger.evaluate(String((await readJson(req)).formula ?? ''))), true;
      }
      if (action && COMMANDS.has(action) && req.method === 'POST') {
        if (!run.debugger.running) return send(200, this.view(run, run.debugger.state())), true;
        if (!run.debugger.state().paused) throw new ApiError(3, 'The script is running; wait for it to pause', 409);
        const state = await run.debugger.resume(action as DebugCommand);
        if (!run.debugger.running) run.touched = 0; // finished runs go at the next sweep
        return send(200, this.view(run, state)), true;
      }
      throw new ApiError(3, 'Command is unavailable', 405);
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof StoreError ? new ApiError(e.code, e.message, 400) : new ApiError(-1, (e as Error).message);
      if (!(e instanceof URIError) && !(e instanceof ApiError) && !(e instanceof StoreError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message } });
    }
    return true;
  }
}
