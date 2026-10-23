// Time-travel debugging: run a script to the end while recording, before each step, where it stood (the step, the
// call stack, the layout, the found set and record, the variables) and what each step did to records. Afterwards the
// debugger steps backwards and forwards through the recording, and jumps to the step where a chosen field changed,
// which FileMaker's debugger, only ever going forwards, can't do.
//
// The caller runs it on a throwaway copy of the file (the run is real), offline.

import type { Script } from '../../fmp12/src/index.ts';
import type { AuditEntry, Store } from '../../store/src/index.ts';
import { ScriptEngine, type DebugAnswer, type DebugPoint, type RunOptions, type RunResult } from './engine.ts';
import { recordChanges, type RecordChange } from './script-tests.ts';

/** The most steps recorded: a run that goes on longer stops there. */
export const RECORD_STEPS = 5_000;
/** Record ids of the found set kept for each step. */
const FOUND_IDS = 100;
/** Variables kept for each scope at each step, and characters of each value. */
const VARIABLES = 200;
const VALUE_CHARS = 500;
/** Full snapshot keys and values, in UTF-16 code units, before deferred redaction. */
const SNAPSHOT_CHARS = 64 * 1024 * 1024;

export interface RecordedStep {
  script: string;
  /** 0-based index of the step in its script. */
  index: number;
  line: string;
  /** Scripts in progress, outermost first. */
  stack: { script: string; index: number }[];
  /** Get ( LastError ) before this step. */
  lastError: number;
  layout?: string;
  mode: 'browse' | 'find';
  foundCount: number;
  /** The found set's first record ids, in order. */
  foundSet: number[];
  recordId?: number;
  /** Variables before this step; left out when they are the same as the step before's. */
  variables?: { locals: Record<string, string>; globals: Record<string, string> };
  /** What this step did to records. */
  changes?: RecordChange[];
  /** Field values this step set on the current record that weren't committed yet (Set Field and the like). */
  edits?: { table: string; recordId?: number; field: string; value: string }[];
  /** Tables this step emptied (Truncate Table), with how many records they had. */
  emptied?: { table: string; records: number }[];
}

export interface Recording {
  script: string;
  steps: RecordedStep[];
  /** How it ended: as the run ended, without its client actions or trace. */
  done: Omit<RunResult, 'actions' | 'trace' | 'foundSet'> & { foundSet: number[] };
  /** It was stopped by the step or retained variable snapshot limit. */
  stopped?: boolean;
  /** Record changes that couldn't all be listed (the audit had more than were read). */
  incomplete?: boolean;
}

const capture = (vars: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(vars).slice(0, VARIABLES));
const clip = (vars: Record<string, string>, redact: (value: string, name: string) => string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(vars)) {
    const v = redact(raw, k);
    out[k] = v.length > VALUE_CHARS ? `${v.slice(0, VALUE_CHARS)}…` : v;
  }
  return out;
};
const same = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
};

/** The newest audit entry's number (0 when there is none). */
const lastSeq = (store: Store) => store.auditLog({ limit: 1 }).at(-1)?.seq ?? 0;

/** Runs a script to the end, recording each step. Runs for real on `store`: give it a throwaway copy. */
export async function recordRun(store: Store, script: string | Script, opts: RunOptions = {}): Promise<Recording> {
  const steps: RecordedStep[] = [];
  /** The audit's last entry before each recorded step. */
  const seqs: number[] = [];
  /** The current record's uncommitted edits before each recorded step. */
  const pendings: ReturnType<DebugPoint['pending']>[] = [];
  const start = lastSeq(store);
  let previous: RecordedStep['variables'];
  let snapshotChars = 0;
  let snapshotLimit = false;
  const record = (p: DebugPoint): DebugAnswer => {
    const vars = p.variables();
    const variables = { locals: capture(vars.locals), globals: capture(vars.globals) };
    const changed = !previous || !same(previous.locals, variables.locals) || !same(previous.globals, variables.globals);
    if (changed) for (const scope of [variables.locals, variables.globals]) {
      for (const [name, value] of Object.entries(scope)) snapshotChars += name.length + value.length;
    }
    previous = variables;
    seqs.push(lastSeq(store));
    pendings.push(p.pending());
    steps.push({
      script: p.script, index: p.index, line: p.line, stack: p.stack, lastError: p.lastError,
      ...(p.layout ? { layout: p.layout } : {}), mode: p.mode, foundCount: p.foundCount, foundSet: p.foundSet(FOUND_IDS),
      ...(p.recordId !== undefined ? { recordId: p.recordId } : {}),
      ...(changed ? { variables } : {}),
    });
    // Checked between steps: one step can add a large value, so the budget may
    // be exceeded by one full snapshot. Keep it intact for the late-secret pass.
    // This is a Tabularius resource limit; FileMaker parity is unverified.
    if (snapshotChars > SNAPSHOT_CHARS) {
      snapshotLimit = true;
      return 'halt';
    }
  };
  const engine = new ScriptEngine({ ...opts, maxSteps: Math.min(opts.maxSteps ?? RECORD_STEPS, RECORD_STEPS), debug: record, profile: undefined, trace: false });
  const done = await engine.run(store, script);

  // Each step's record changes: the audit entries written between it and the next step.
  const entries: AuditEntry[] = [];
  let incomplete = false;
  for (let after = start; ;) {
    const page = store.auditLog({ afterSeq: after, limit: 10_000 });
    entries.push(...page);
    if (page.length < 10_000) break;
    after = page[page.length - 1].seq;
    if (entries.length >= 100_000) {
      incomplete = true;
      break;
    }
  }
  let at = 0;
  // Seed all credential before/after values before rendering any change, including
  // old values never read by the script and copies under ordinary field names.
  for (const entry of entries) for (const [field, value] of Object.entries(entry.changes ?? {})) {
    for (const v of entry.kind === 'update' && Array.isArray(value) ? value : [value]) {
      engine.redactDiagnosticValue(v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v), field);
    }
  }
  // Earlier snapshots may contain aliases of secrets learned only from later
  // audit entries. Keep their full values until this pass, then redact and clip.
  previous = undefined;
  for (const step of steps) {
    if (!step.variables) continue;
    const redact = (value: string, name: string) => engine.redactDiagnosticValue(value, name);
    const variables = { locals: clip(step.variables.locals, redact), globals: clip(step.variables.globals, redact) };
    if (previous && same(previous.locals, variables.locals) && same(previous.globals, variables.globals)) delete step.variables;
    else step.variables = variables;
    previous = variables;
  }
  for (let i = 0; i < steps.length; i++) {
    const until = i + 1 < seqs.length ? seqs[i + 1] : Infinity;
    const mine: AuditEntry[] = [];
    while (at < entries.length && entries[at].seq <= until) mine.push(entries[at++]);
    if (!mine.length) continue;
    const changes = recordChanges(mine, undefined, (value, field) => engine.redactDiagnosticValue(value, field));
    if (changes.records.length) steps[i].changes = changes.records;
    if (changes.truncated.length) steps[i].emptied = changes.truncated;
    if (changes.more) incomplete = true;
  }

  // Each step's uncommitted edits: what the current record's pending edits gained between it and the next step.
  for (let i = 0; i + 1 < pendings.length; i++) {
    const [was, now] = [pendings[i], pendings[i + 1]];
    if (now.table === undefined) continue;
    const sameRecord = was.table === now.table && was.recordId === now.recordId;
    const edits = Object.entries(now.fields)
      .filter(([k, v]) => !sameRecord || was.fields[k] !== v)
      .map(([field, raw]) => {
        const value = engine.redactDiagnosticValue(raw, field);
        return { table: now.table!, ...(now.recordId !== undefined ? { recordId: now.recordId } : {}), field, value: value.length > VALUE_CHARS ? `${value.slice(0, VALUE_CHARS)}…` : value };
      });
    if (edits.length) steps[i].edits = edits;
  }

  const { actions: _a, trace: _t, foundSet, ...ended } = done;
  return {
    script: typeof script === 'string' ? script : script.name,
    steps,
    done: { ...ended, foundSet: (foundSet ?? []).slice(0, FOUND_IDS) },
    ...(snapshotLimit || (done.halted && done.steps >= RECORD_STEPS) ? { stopped: true } : {}),
    ...(incomplete ? { incomplete: true } : {}),
  };
}
