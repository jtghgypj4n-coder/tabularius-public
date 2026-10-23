// Running script test cases (store/src/script-tests.ts), which FileMaker doesn't have: each case sets up its
// inputs, runs the script offline (no network, no mail, stand-in AI answers instead of a model) on a trial
// whose changes are thrown away, and compares how it ended with what the case expects. The editor, the CLI
// (`tabularius script-tests`) and CI all run them this way.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep } from '../../fmp12/src/index.ts';
import type { AuditEntry, ScriptTest, ScriptTestExpect, ScriptTestGiven, Store } from '../../store/src/index.ts';
import { asText, text } from '../../calc/src/index.ts';
import { runScript, ScriptSession, type RunResult, type ScriptProfile } from './engine.ts';
import { offlineScriptOptions } from './offline.ts';
import { startingPoints } from './testrun.ts';
import type { ScriptAi } from './ai.ts';

export interface ScriptTestFailure {
  /** What differs: "result", "error", "found count", "layout", a variable ($$x) or a field. */
  what: string;
  expected: string;
  actual: string;
}

export interface ScriptTestOutcome {
  id: string;
  name: string;
  script: string;
  passed: boolean;
  failures: ScriptTestFailure[];
  /** Why the script stopped, when it ended with an error or the run itself failed. */
  message?: string;
  steps: number;
  ms: number;
}

export interface ScriptTestRunOptions {
  /** Time limit per case (default 10 s). */
  timeoutMs?: number;
  /** Step limit per case (default 100,000). */
  maxSteps?: number;
  /** Other files the scripts may open; their changes are thrown away too. */
  others?: Store[];
  /** Gets each step's timings (the script editor's "Profile a run"). */
  profile?: ScriptProfile;
  /** Reads what the run changed in each record before the trial is undone (a dry run). */
  diff?: boolean;
  /** Comparing two versions of a script: reads every global variable and global field, the client actions and the mode at the end, and every record changed. */
  compare?: boolean;
  /** Administrative cancellation signal for a run under test. */
  stop?: AbortSignal;
}

/** A text value as a formula: a quoted literal. */
const literal = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The full-access account a file's scripts run as, so creation account fields fill in as they would. */
function account(store: Store): string | undefined {
  const active = store.accounts().filter((a) => !a.inactive && !a.external);
  return (active.find((a) => a.privilegeSet === '[Full Access]') ?? active[0])?.name;
}

/** Answers for the AI steps, in order, in place of a model. Nothing leaves the machine. */
function cannedAi(answers: string[]): ScriptAi {
  const queue = [...answers];
  return {
    refusal: () => undefined,
    generate: async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('the test case has no more AI answers (add one to given.ai)');
      return next;
    },
  };
}

interface Ran {
  r?: RunResult;
  crash?: string;
  ended: ScriptTestExpect;
  /** With `diff`: what the run changed, read before the trial is undone. */
  changes?: RecordChanges;
  /** With `compare`: the rest of how it ended (global fields, mode, what it asked the client to do), by name. */
  state?: Record<string, string>;
}

/** One record a run created, changed or deleted, with each field's value before and after. */
export interface RecordChange {
  /** Source file when a run includes more than one file. */
  file?: string;
  table: string;
  recordId: number;
  kind: 'create' | 'update' | 'delete';
  fields: { field: string; before: string; after: string }[];
}

export interface RecordChanges {
  records: RecordChange[];
  /** More records changed than are listed. */
  more: number;
  /** Tables emptied all at once (Truncate Table), with how many records each had. */
  truncated: { file?: string; table: string; records: number }[];
  /** The run changed so much that its earliest changes alone were read: what's listed is not all of it. */
  incomplete?: boolean;
}

/** Records listed in a dry run, and audit entries read for one. */
const DIFF_RECORDS = 200;
const DIFF_ENTRIES = 10_000;

/** Characters of a value shown; a long text is cut there. */
const VALUE_CHARS = 2_000;
const shown = (v: unknown) => {
  const t = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return t.length > VALUE_CHARS ? `${t.slice(0, VALUE_CHARS)}…` : t;
};

/**
 * What a run did to records, from its audit entries in order: each record once, with each field's value
 * before the run and after it. A record created and then deleted in the same run left nothing, so it isn't listed.
 */
export function recordChanges(entries: AuditEntry[], limit = DIFF_RECORDS, redact?: (value: string, field: string) => string, clipValues = true): RecordChanges {
  // Keep full normalized values internally. Redaction and clipping belong to the report, not equality.
  const display = (value: unknown) => value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const byRecord = new Map<string, RecordChange & { values: Map<string, { before: string; after: string }> }>();
  const truncated: { table: string; records: number }[] = [];
  for (const e of entries) {
    if (e.security) continue;
    if (e.kind === 'truncate') {
      // Every record of the table is gone: those the run made don't count, and those it changed are among the ones emptied.
      let made = 0;
      for (const [k, rec] of byRecord) {
        if (rec.table !== e.table) continue;
        if (rec.kind === 'create') {
          byRecord.delete(k);
          made++;
        } else if (rec.kind === 'update') byRecord.delete(k);
      }
      truncated.push({ table: e.table, records: Math.max(0, Number((e.changes as { records?: unknown } | undefined)?.records ?? 0) - made) });
      continue;
    }
    if ((e.kind !== 'create' && e.kind !== 'update' && e.kind !== 'delete') || e.recordId === undefined) continue;
    const key = `${e.table}\u0000${e.recordId}`;
    let rec = byRecord.get(key);
    const changes = Object.entries(e.changes ?? {});
    if (e.kind === 'create') {
      // A deleted record's id can be given to a new one: both are listed.
      if (rec) byRecord.set(`${key}\u0000${e.seq}`, rec);
      rec = { table: e.table, recordId: e.recordId, kind: 'create', fields: [], values: new Map() };
      for (const [k, v] of changes) rec.values.set(k, { before: '', after: display(v) });
      byRecord.set(key, rec);
    } else if (e.kind === 'update') {
      if (!rec) {
        rec = { table: e.table, recordId: e.recordId, kind: 'update', fields: [], values: new Map() };
        byRecord.set(key, rec);
      }
      for (const [k, v] of changes) {
        const [was, now] = Array.isArray(v) ? v : [undefined, v];
        const had = rec.values.get(k);
        rec.values.set(k, { before: had ? had.before : display(was), after: display(now) });
      }
    } else {
      if (rec?.kind === 'create') {
        byRecord.delete(key);
        continue;
      }
      const values = rec?.values ?? new Map<string, { before: string; after: string }>();
      for (const [k, v] of changes) if (!values.has(k)) values.set(k, { before: display(v), after: '' });
      for (const x of values.values()) x.after = '';
      rec = { table: e.table, recordId: e.recordId, kind: 'delete', fields: [], values };
      byRecord.set(key, rec);
    }
  }
  const records = [...byRecord.values()].map(({ values, ...r }) => ({
    ...r,
    fields: [...values].filter(([, x]) => r.kind !== 'update' || x.before !== x.after).map(([field, x]) => ({
      field,
      before: clipValues ? shown(redact ? redact(x.before, field) : x.before) : redact ? redact(x.before, field) : x.before,
      after: clipValues ? shown(redact ? redact(x.after, field) : x.after) : redact ? redact(x.after, field) : x.after,
    })),
  })).filter((r) => r.kind !== 'update' || r.fields.length);
  return { records: records.slice(0, limit), more: Math.max(0, records.length - limit), truncated };
}

/** Runs one case and reads how it ended: everything a case can expect. Changes are thrown away. */
async function runCase(store: Store, script: Script, given: ScriptTestGiven, wanted: ScriptTestExpect, opts: ScriptTestRunOptions): Promise<Ran> {
  const trials = [store, ...(opts.others ?? [])].map((s) => s.trial());
  const documents = mkdtempSync(join(tmpdir(), 'tabularius-script-test-'));
  const session = new ScriptSession();
  try {
    const fields: [string, string][] = [];
    for (const [k, v] of Object.entries(given.globals ?? {})) {
      if (k.startsWith('$$')) session.variables.set(k.toLowerCase(), [text(v)]);
      else if (k.includes('::')) fields.push([k, v]);
    }
    const layout = given.layout ?? startingPoints(store).get(script.id)?.layout ?? store.designs().layouts[0]?.name;
    const who = account(store);
    const base = offlineScriptOptions({ session, documents, ...(who ? { account: who } : {}), timeoutMs: opts.timeoutMs ?? 10_000, maxSteps: opts.maxSteps ?? 100_000 });
    if (fields.length) {
      // Global fields are set the way a script would, in the same session.
      const steps: ScriptStep[] = fields.map(([k, v]) => {
        const at = k.indexOf('::');
        return {
          stepId: 76, name: 'Set Field', enabled: true,
          params: { field: { tableOccurrence: { id: 0, name: k.slice(0, at) }, field: { id: 0, name: k.slice(at + 2) } }, calculation: literal(v) },
        };
      });
      const setup = await runScript(store, { id: -1, name: 'test case setup', steps } as Script, { ...base, ...(layout ? { layout } : {}), trace: true });
      if (setup.error) {
        return { crash: `Could not set the case's global fields: ${setup.trace?.find((t) => t.message)?.message ?? `error ${setup.error}`}`, ended: {} };
      }
    }
    let foundSet: number[] | undefined;
    try {
      foundSet = layout ? store.findIds(layout, given.find ? { query: given.find } : {}) : undefined;
    } catch (e) {
      // A layout or field the case names that is gone now: this case fails, the others still run.
      return { crash: `Could not set up the case's found set: ${e instanceof Error ? e.message : String(e)}`, ended: {} };
    }
    const recordId = foundSet?.[Math.max(1, given.record ?? 1) - 1];
    // Audit entries after this one are the run's (each other file's are all the run's: they're on a trial too).
    const since = opts.diff ? store.auditLog({ limit: 1 })[0]?.seq ?? 0 : 0;
    const othersSince = opts.diff ? (opts.others ?? []).map((s) => s.auditLog({ limit: 1 })[0]?.seq ?? 0) : [];
    let r: RunResult;
    try {
      r = await runScript(store, script, {
        ...base,
        ...(layout ? { layout } : {}),
        ...(foundSet ? { foundSet, ...(recordId !== undefined ? { recordId } : {}) } : {}),
        ...(given.parameter !== undefined ? { parameter: given.parameter } : {}),
        ...(given.ai?.length ? { ai: cannedAi(given.ai) } : {}),
        ...(opts.profile ? { profile: opts.profile } : {}),
        previewDialogs: true,
        trace: true,
        ...(opts.stop ? { stop: opts.stop } : {}),
      });
    } catch (e) {
      return { crash: e instanceof Error ? e.message : String(e), ended: {} };
    }
    const ended: ScriptTestExpect = { result: r.result, error: r.error, foundCount: r.foundCount, ...(r.layout ? { layout: r.layout } : {}) };
    // Variables and fields: the ones the case asks about (read before the trial is undone).
    const variables = opts.compare ? [...session.variables.keys()].sort() : Object.keys(wanted.variables ?? {});
    if (variables.length) ended.variables = Object.fromEntries(variables.map((k) => [k, asText(session.variables.get(k.toLowerCase())?.[0] ?? text(''), store.dateOrder)]));
    const names = Object.keys(wanted.fields ?? {});
    if (names.length) {
      ended.fields = {};
      for (const k of names) {
        let v = '';
        try {
          v = r.layout && r.recordId !== undefined ? asText(store.evaluateEach(r.layout, [k], r.recordId)[0] ?? text(''), store.dateOrder) : '';
        } catch (e) {
          v = `? (${e instanceof Error ? e.message : String(e)})`;
        }
        ended.fields[k] = v;
      }
    }
    const state = opts.compare ? {
      ...Object.fromEntries([...session.globalFields].map(([k, v]) => [k, v.map((x) => asText(x, store.dateOrder)).join('\n')])),
      mode: r.mode ?? 'browse',
      preview: r.preview ? 'on' : 'off',
      // What the client is asked to do (dialogs, exports, mail, URLs, screen changes), in order; not which script asked.
      'asks the client': JSON.stringify(r.actions.map(({ script: _, ...rest }) => rest)),
    } : undefined;
    if (opts.diff) {
      // Every file the run could open: their changes are part of what it would do.
      const files = [store, ...(opts.others ?? [])];
      const read = files.map((s, i) => s.auditLog({ afterSeq: i ? othersSince[i - 1] : since, limit: DIFF_ENTRIES }));
      let changes: RecordChanges;
      if (files.length === 1) changes = recordChanges(read[0], opts.compare ? Infinity : undefined, undefined, !opts.compare);
      else {
        const perFile = read.map((entries, i) => {
          const result = recordChanges(entries, Infinity, undefined, !opts.compare);
          return {
            records: result.records.map((r) => ({ ...r, file: files[i].name })),
            truncated: result.truncated.map((t) => ({ ...t, file: files[i].name })),
          };
        });
        const records = perFile.flatMap((x) => x.records);
        const limit = opts.compare ? Infinity : DIFF_RECORDS;
        changes = { records: records.slice(0, limit), more: Math.max(0, records.length - limit), truncated: perFile.flatMap((x) => x.truncated) };
      }
      return { r, ended, ...(state ? { state } : {}), changes: read.some((x) => x.length >= DIFF_ENTRIES) ? { ...changes, incomplete: true } : changes };
    }
    return { r, ended, ...(state ? { state } : {}) };
  } finally {
    session.close();
    for (const t of trials.reverse()) t.undo();
    rmSync(documents, { recursive: true, force: true });
  }
}

/** Runs test cases and says which pass, and for the others what differs. */
export async function runScriptTests(store: Store, tests: ScriptTest[], opts: ScriptTestRunOptions = {}): Promise<ScriptTestOutcome[]> {
  const out: ScriptTestOutcome[] = [];
  for (const t of tests) {
    const started = Date.now();
    const script = store.schema.scripts.find((x) => x.id === t.script);
    if (!script) {
      out.push({ id: t.id, name: t.name, script: `#${t.script}`, passed: false, failures: [], message: 'The script was deleted', steps: 0, ms: 0 });
      continue;
    }
    const ran = await runCase(store, script, t.given, t.expect, opts);
    const failures: ScriptTestFailure[] = [];
    const e = t.expect;
    const a = ran.ended;
    const check = (what: string, want: string | number | undefined, got: string | number | undefined) => {
      if (want !== undefined && String(want) !== String(got ?? '')) failures.push({ what, expected: String(want), actual: String(got ?? '') });
    };
    if (!ran.crash) {
      check('result', e.result, a.result);
      check('error', e.error, a.error);
      check('found count', e.foundCount, a.foundCount);
      check('layout', e.layout, a.layout);
      for (const [k, v] of Object.entries(e.variables ?? {})) check(k, v, a.variables?.[k]);
      for (const [k, v] of Object.entries(e.fields ?? {})) check(k, v, a.fields?.[k]);
    }
    const stopAction = ran.r?.actions.find((x) => x.step === 'Halt Script' && typeof x.reason === 'string' && /(?:limit|canceled|cancelled|runaway|memory)/i.test(x.reason));
    const termination = ran.r?.halted && (opts.stop?.aborted || stopAction)
      ? typeof stopAction?.reason === 'string' ? stopAction.reason : 'canceled from the admin console'
      : undefined;
    const stopped = ran.r?.error ? ran.r.trace?.slice().reverse().find((x) => x.error && x.message) : undefined;
    if (termination) failures.push({ what: 'completion', expected: 'completed normally', actual: 'incomplete' });
    out.push({
      id: t.id, name: t.name, script: script.name, passed: !ran.crash && !failures.length, failures,
      ...(ran.crash ? { message: ran.crash } : termination ? { message: `Script test incomplete: ${termination}` } : stopped ? { message: `Line ${stopped.index + 1}: ${stopped.message}` } : {}),
      steps: ran.r?.steps ?? 0, ms: Date.now() - started,
    });
  }
  return out;
}

/**
 * A dry run: runs a script once with these inputs, offline, and returns exactly which records and fields it
 * would change, each with its value before and after, then throws the changes away.
 */
export async function dryRunScript(store: Store, scriptId: number, given: ScriptTestGiven, opts: ScriptTestRunOptions = {}): Promise<{ ended: ScriptTestExpect; changes: RecordChanges; message?: string }> {
  const script = store.schema.scripts.find((x) => x.id === scriptId);
  if (!script) throw new Error(`No script with id ${scriptId}`);
  const ran = await runCase(store, script, given, {}, { ...opts, diff: true });
  if (ran.crash) throw new Error(ran.crash);
  const stopped = ran.r?.error ? ran.r.trace?.slice().reverse().find((x) => x.error && x.message) : undefined;
  return { ended: ran.ended, changes: ran.changes ?? { records: [], more: 0, truncated: [] }, ...(stopped ? { message: `Line ${stopped.index + 1}: ${stopped.message}` } : {}) };
}

/**
 * Runs a script once with these inputs and returns how it ended, as a case's expectations: "save this run
 * as a test case". The variables are the global variables the inputs name, so a case checks what it set up.
 */
export async function recordScriptTest(store: Store, scriptId: number, given: ScriptTestGiven, opts: ScriptTestRunOptions = {}): Promise<ScriptTestExpect & { message?: string }> {
  const script = store.schema.scripts.find((x) => x.id === scriptId);
  if (!script) throw new Error(`No script with id ${scriptId}`);
  const vars = Object.fromEntries(Object.keys(given.globals ?? {}).filter((k) => k.startsWith('$$')).map((k) => [k, '']));
  const ran = await runCase(store, script, given, Object.keys(vars).length ? { variables: vars } : {}, opts);
  if (ran.crash) throw new Error(ran.crash);
  return ran.ended;
}

export interface DraftCase {
  name: string;
  given: ScriptTestGiven;
}

export interface DraftComparison {
  /** Each run, the script and the draft side by side: the same end, the same records changed. */
  cases: { name: string; same: boolean; differences: ScriptTestFailure[] }[];
  /** The saved test cases, run against the draft. */
  tests: ScriptTestOutcome[];
  /** Every run ended the same and every saved test case that passed before passes with the draft. */
  equal: boolean;
}

/** Cases worth comparing a script's two versions on: its saved test cases' inputs, then where buttons and triggers start it, then a plain run. */
export function draftCases(store: Store, scriptId: number, tests: ScriptTest[], max = 10): DraftCase[] {
  const out: DraftCase[] = [];
  const seen = new Set<string>();
  const add = (name: string, given: ScriptTestGiven) => {
    const key = JSON.stringify(given);
    if (seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push({ name, given });
  };
  for (const t of tests.filter((x) => x.script === scriptId)) add(t.name, t.given);
  const start = startingPoints(store).get(scriptId);
  if (start) add(`from layout "${start.layout}"`, { layout: start.layout, ...(start.parameter !== undefined ? { parameter: start.parameter } : {}) });
  add('a plain run', {});
  return out;
}

/** Auto-entered from the clock: two runs a moment apart differ there whatever the script does. */
const CLOCK = /^(creation|modification)(Date|Time|Timestamp)$/;

/** The records a run changed, as text to compare (in no particular order, and without the fields the clock fills in). */
const changeText = (store: Store, c: RecordChanges, others: Store[] = []) => {
  const files = [store, ...others];
  const clock = (file: string | undefined, table: string, field: string) => CLOCK.test(String((files.find((s) => s.name === file) ?? store).schema.tables.find((t) => t.name === table)?.fields.find((f) => f.name === field)?.options?.autoEnter?.value ?? ''));
  return JSON.stringify(c.records.map((r) => [...(r.file === undefined ? [] : [r.file]), r.table, r.recordId, r.kind, r.fields.filter((f) => !clock(r.file, r.table, f.field)).map((f) => [f.field, f.before, f.after])])
    .map((x) => JSON.stringify(x)).sort().concat(JSON.stringify([c.more, c.truncated])));
};

/**
 * Proves a drafted version of a script does what the script does: each case runs the script, then the draft, on
 * `store` (a throwaway copy: the draft replaces the script there), offline and each on a trial whose changes are
 * thrown away, and compares how they ended (result, error, found count, layout, mode, every global variable and
 * global field, what they asked the client to do) and every record they changed. The saved test cases then run
 * against the draft. A case that can't run, or changed more than can be read, proves nothing: it isn't the same.
 */
export async function compareScriptDraft(store: Store, scriptId: number, draft: string, cases: DraftCase[], tests: ScriptTest[], opts: ScriptTestRunOptions = {}): Promise<DraftComparison> {
  const run = async (given: ScriptTestGiven) => {
    const script = store.schema.scripts.find((x) => x.id === scriptId);
    if (!script) return { crash: `No script with id ${scriptId}` };
    const ran = await runCase(store, script, given, {}, { ...opts, diff: true, compare: true });
    if (ran.crash) return { crash: ran.crash };
    if (ran.changes?.incomplete) return { crash: 'It changed more records than can be compared' };
    return { ended: ran.ended, state: ran.state ?? {}, changes: changeText(store, ran.changes!, opts.others) };
  };
  const own = tests.filter((t) => t.script === scriptId);
  const was: Awaited<ReturnType<typeof run>>[] = [];
  for (const c of cases) was.push(await run(c.given));
  const passedBefore = new Set((await runScriptTests(store, own, opts)).filter((o) => o.passed).map((o) => o.id));
  store.applyDesign([{ op: 'updateScript', script: scriptId, text: draft }]);
  const out: DraftComparison['cases'] = [];
  for (const [i, c] of cases.entries()) {
    const a = was[i];
    const b = await run(c.given);
    const differences: ScriptTestFailure[] = [];
    const diff = (what: string, x: unknown, y: unknown) => {
      const [sx, sy] = [x === undefined ? '' : String(x), y === undefined ? '' : String(y)];
      if (sx !== sy) differences.push({ what, expected: sx, actual: sy });
    };
    // A run that couldn't be compared isn't the same, even when both versions fail alike.
    if ('crash' in a || 'crash' in b) differences.push({ what: 'run', expected: 'crash' in a ? `not compared: ${a.crash}` : 'ran', actual: 'crash' in b ? `not compared: ${b.crash}` : 'ran' });
    else {
      diff('result', a.ended.result, b.ended.result);
      diff('error', a.ended.error, b.ended.error);
      diff('found count', a.ended.foundCount, b.ended.foundCount);
      diff('layout', a.ended.layout, b.ended.layout);
      for (const k of new Set([...Object.keys(a.ended.variables ?? {}), ...Object.keys(b.ended.variables ?? {})])) diff(k, a.ended.variables?.[k], b.ended.variables?.[k]);
      for (const k of new Set([...Object.keys(a.state), ...Object.keys(b.state)])) {
        if (k === 'asks the client') {
          if (a.state[k] !== b.state[k]) differences.push({ what: 'dialogs, exports and other client steps', expected: 'as the script does them', actual: 'differently' });
        } else diff(k, a.state[k], b.state[k]);
      }
      if (a.changes !== b.changes) differences.push({ what: 'records changed', expected: 'as the script changes them', actual: 'differently' });
    }
    out.push({ name: c.name, same: !differences.length, differences });
  }
  const after = await runScriptTests(store, own, opts);
  const kept = after.every((o) => o.passed || !passedBefore.has(o.id));
  return { cases: out, tests: after, equal: out.length > 0 && out.every((c) => c.same) && kept };
}
