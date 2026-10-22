// Runs every script of a file offline to see what it does, the way a person
// would start it: on the layout of a button that runs it, with every record
// found and the first one current, and with "selection" globals (a global
// that a relationship matches on, like gSelectedCampaignID) set to a real
// record's key. Each script starts from the same data: its changes are
// thrown away afterwards (Store.trial). No network, no mail, no plug-ins:
// the engine's defaults, which this never relaxes.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LayoutObject, Script } from '../../fmp12/src/index.ts';
import { lintScript, type Store } from '../../store/src/index.ts';
import { asText, fromStored, text } from '../../calc/src/index.ts';
import { runScript, ScriptSession, type RunResult } from './engine.ts';
import { offlineScriptOptions } from './offline.ts';
import type { OutboundTest, OutsideCalls } from './outbound.ts';
import { maskSensitive, maskStepText, scriptsWithCredentials } from './credentials.ts';
import { getHeapStatistics } from 'node:v8';

export interface ScriptTestOptions {
  /** Only scripts with these names. */
  scripts?: string[];
  /** Never run scripts with these names (case-insensitive; a trailing * matches any ending). */
  skip?: string[];
  /** Time limit per script (default 10 s). A script still running then counts as stalled. */
  timeoutMs?: number;
  /** Step limit per script (default 100,000). */
  maxSteps?: number;
  /** Runaway-loop guard: stop a loop after this many times round (no limit by default beyond the step limit). */
  loopLimit?: number;
  /** Runaway-loop guard: stop a loop after it has added this many records (engine default 100,000). */
  loopRecordLimit?: number;
  /** Heap size, in bytes, at which a script is stopped and counted as stalled (default: half the heap limit). */
  memoryLimit?: number;
  /** Called before each script starts (to see which one was running if the process dies). */
  starting?: (script: string) => void;
  /** Other files the scripts may open (hosted next to this one); their changes are undone too. */
  others?: Store[];
  /** Called after each script, for progress. */
  progress?: (r: ScriptTestResult) => void;
  /** Outbound test mode (outbound.ts): mail captured in an outbox, requests only to allowlisted hosts. */
  outbound?: OutboundTest;
  /** $$variables set before each script, as the file's login script would set them ("$$UserName" → "tester"). */
  globals?: Record<string, string>;
}

export interface ScriptTestResult {
  script: string;
  /** The layout it started on, when a button or trigger names one. */
  layout?: string;
  /** The record it started on, when not the first: one with the related records the first run found missing. */
  recordId?: number;
  /** skipped: not run, because its steps have credentials written into them (see embeddedCredential). */
  outcome: 'ok' | 'error' | 'stalled' | 'crashed' | 'skipped';
  /** Get ( LastError ) at the end. */
  error: number;
  /** Skipped scripts it tried to call; they were not run. */
  skipped?: string[];
  steps: number;
  ms: number;
  /** The last step that set an error (or the last step run, when it stalled), and why. */
  step?: string;
  message?: string;
  /** Outbound test mode: outside services it tried to reach, and emails it wrote (see describeOutside). */
  outside?: OutsideCalls[];
  mail?: number;
  /** A stalled script: what the script linter finds in it and the script it stopped in (a loop that never ends, and the fix). */
  lint?: string[];
  /**
   * Something the run lacked that a person's session would have, rather than a fault in the script: a field that
   * fills in from a $$variable no step set (a login script usually does). Names only.
   */
  setup?: string[];
}

/** Where a person would start a script: a layout, and the parameter the button or trigger passes (a formula). */
export interface StartingPoint {
  layout: string;
  parameter?: string;
}

/**
 * Where a person would start each script: the layout of a button or layout
 * trigger that runs it, with its parameter. Of several, the first that has
 * every object the script goes to by a fixed name (Go to Object [ "name" ]).
 * A script no button runs starts where a script that performs it does, with
 * that Perform Script's parameter, else on the first layout with the objects
 * it goes to, else on a layout of the table occurrence whose fields it sets most.
 */
export function startingPoints(store: Store): Map<number, StartingPoint> {
  const candidates = new Map<number, StartingPoint[]>();
  const names = new Map<string, Set<string>>();
  const add = (id: number, layout: string, parameter?: string) => {
    const list = candidates.get(id) ?? [];
    if (!list.some((x) => x.layout === layout && x.parameter === parameter)) list.push({ layout, ...(parameter ? { parameter } : {}) });
    candidates.set(id, list);
  };
  for (const l of store.designs().layouts) {
    const here = new Set<string>();
    const walk = (objects: LayoutObject[] | undefined) => {
      for (const o of objects ?? []) {
        if (o.name) here.add(o.name);
        const id = o.action?.scriptId;
        if (id !== undefined && !o.action?.file) add(id, l.name, o.action?.parameter);
        for (const t of o.triggers ?? []) add(t.scriptId, l.name, t.parameter);
        walk(o.children);
      }
    };
    walk(l.objects);
    for (const t of l.triggers ?? []) add(t.scriptId, l.name, t.parameter);
    names.set(l.name, here);
  }
  const where = new Map<number, StartingPoint>();
  const wantedObjects = (id: number) => (store.schema.scripts.find((s) => s.id === id)?.steps ?? [])
    .filter((s) => s.enabled && s.stepId === 145)
    .map((s) => /^\s*"([^"]*)"\s*$/.exec(s.params?.objectName ?? '')?.[1]).filter((x): x is string => !!x);
  const pick = (id: number, list: StartingPoint[]) => {
    const wanted = wantedObjects(id);
    where.set(id, list.find((l) => wanted.every((n) => names.get(l.layout)?.has(n))) ?? list[0]);
  };
  for (const [id, list] of candidates) pick(id, list);
  // Scripts only other scripts perform: where the caller starts, with the caller's parameter.
  for (let pass = 0; pass < 3; pass++) {
    for (const caller of store.schema.scripts) {
      const from = where.get(caller.id);
      if (!from) continue;
      for (const step of caller.steps ?? []) {
        const callee = step.enabled && step.stepId === 1 && !step.params?.script?.file ? step.params?.script?.id : undefined;
        if (callee === undefined || where.has(callee)) continue;
        where.set(callee, { layout: from.layout, ...(step.params?.parameter ? { parameter: step.params.parameter } : {}) });
      }
    }
  }
  // Scripts that go to objects by name: the first layout that has them all.
  for (const script of store.schema.scripts) {
    if (where.has(script.id)) continue;
    const wanted = wantedObjects(script.id);
    const layout = wanted.length ? [...names].find(([, here]) => wanted.every((n) => here.has(n)))?.[0] : undefined;
    if (layout) where.set(script.id, { layout });
  }
  // The rest: a layout of the table occurrence whose fields the script sets most (a "Field Map :: Set" subscript).
  let byOccurrence: Map<string, string> | undefined;
  for (const script of store.schema.scripts) {
    if (where.has(script.id) || !script.steps?.length) continue;
    const counts = new Map<string, number>();
    for (const step of script.steps) {
      const to = step.enabled ? step.params?.field?.tableOccurrence.name : undefined;
      if (to) counts.set(to.toLowerCase(), (counts.get(to.toLowerCase()) ?? 0) + 1);
    }
    if (!counts.size) continue;
    if (!byOccurrence) {
      byOccurrence = new Map();
      for (const l of store.layouts()) {
        try {
          const occurrence = store.layout(l.name).occurrence.toLowerCase();
          if (!byOccurrence.has(occurrence)) byOccurrence.set(occurrence, l.name);
        } catch {
          // a layout on a file that isn't hosted
        }
      }
    }
    const layout = [...counts].sort((a, b) => b[1] - a[1]).map(([to]) => byOccurrence!.get(to)).find((x) => x !== undefined);
    if (layout) where.set(script.id, { layout });
  }
  return where;
}

/** The layout each script starts on (see startingPoints). */
export function startingLayouts(store: Store): Map<number, string> {
  return new Map([...startingPoints(store)].map(([id, p]) => [id, p.layout]));
}

/**
 * Global fields that relationships match on, each set to the matching field
 * of the first record on the other side, so "Selected" relationships find a
 * record. Globals that already hold a value keep it.
 */
export function seedSelections(store: Store, session: ScriptSession): number {
  const schema = store.schema;
  const toName = (id: number) => schema.tableOccurrences.find((t) => t.id === id)?.name;
  let seeded = 0;
  for (const rel of schema.relationships) {
    for (const pred of rel.predicates) {
      if (pred.operator !== '=') continue;
      for (const [mine, theirs] of [
        [{ to: toName(rel.leftTableOccurrenceId), field: pred.leftField }, { to: toName(rel.rightTableOccurrenceId), field: pred.rightField }],
        [{ to: toName(rel.rightTableOccurrenceId), field: pred.rightField }, { to: toName(rel.leftTableOccurrenceId), field: pred.leftField }],
      ] as const) {
        if (!mine.to || !mine.field || !theirs.to || !theirs.field) continue;
        try {
          const g = store.occurrence(mine.to);
          if (g.owner !== store) continue;
          const table = store.schema.tables.find((t) => t.name === g.table);
          const field = table?.fields.find((f) => f.name === mine.field);
          if (!table || !field?.options?.global || field.type === 'container') continue;
          const key = `${store.name}::${table.name}::${field.name}`.toLowerCase();
          if (session.globalFields.has(key)) continue;
          const current = store.calc.globalValue(table, field);
          if (current !== null && current !== '') continue;
          const other = store.occurrence(theirs.to);
          const otherField = other.owner.schema.tables.find((t) => t.name === other.table)?.fields.find((f) => f.name === theirs.field);
          if (!otherField || otherField.options?.global) continue;
          const first = other.owner.find(other, { limit: 1 }).records[0];
          const value = first?.fieldData[theirs.field];
          if (value === undefined || value === '' || value === null) continue;
          session.globalFields.set(key, [fromStored(value as string | number, otherField.type === 'number' ? 'number' : 'text')]);
          seeded++;
        } catch {
          // an occurrence in a file that isn't here, or a table that can't be read: leave the global alone
        }
      }
    }
  }
  return seeded;
}

/** Whether a script name matches one of the --skip patterns (case-insensitive; * matches anything, anywhere). */
export function skipMatcher(names: string[]): (name: string) => boolean {
  const res = names.map(skipPattern);
  return (name) => res.some((re) => re.test(name));
}

/** A --skip pattern as a regular expression: * matches anything (anywhere in the pattern), case doesn't matter, the rest is literal. */
function skipPattern(pattern: string): RegExp {
  return new RegExp(`^${pattern.trim().split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'is');
}

/** The --skip patterns that match none of these script names (a typo there would silently run what was meant to be skipped). */
export function unmatchedSkips(scriptNames: readonly string[], patterns: readonly string[]): string[] {
  return patterns.filter((p) => !scriptNames.some(skipMatcher([p])));
}

/** Runs each script (or the named ones) offline from a realistic starting point, undoing what each one changes. */
export async function testScripts(store: Store, opts: ScriptTestOptions = {}): Promise<ScriptTestResult[]> {
  const points = startingPoints(store);
  const named = skipMatcher(opts.skip ?? []);
  // Scripts with credentials written into them are never run, however they're reached, whatever --skip says.
  const secrets = scriptsWithCredentials(store.schema.scripts);
  const skipped = (name: string) => named(name) || secrets.has(name);
  const chosen = store.schema.scripts.filter((s) => s.steps?.length && (!opts.scripts || opts.scripts.includes(s.name)));
  const scripts = chosen.filter((s) => !skipped(s.name));
  const seeds = new ScriptSession();
  seedSelections(store, seeds);
  const out: ScriptTestResult[] = [];
  for (const s of chosen) {
    const what = secrets.get(s.name);
    if (!what || named(s.name)) continue;
    const r: ScriptTestResult = { script: s.name, outcome: 'skipped', error: 0, steps: 0, ms: 0, message: `contains embedded credentials (${what}); not run` };
    out.push(r);
    opts.progress?.(r);
  }
  // Half the heap: room for the run to be stopped and its memory given back.
  const limited = { ...opts, skipped, memoryLimit: opts.memoryLimit ?? Math.floor(getHeapStatistics().heap_size_limit / 2) };
  for (const s of scripts) {
    opts.starting?.(s.name);
    const r = await testScript(store, s, points.get(s.id), seeds, limited);
    out.push(r);
    opts.progress?.(r);
  }
  return out;
}

type TestOptions = ScriptTestOptions & { skipped?: (name: string) => boolean };

async function testScript(store: Store, script: Script, start: StartingPoint | undefined, seeds: ScriptSession, opts: TestOptions): Promise<ScriptTestResult> {
  let layout = start?.layout;
  let foundSet: number[] | undefined;
  try {
    foundSet = layout ? store.findIds(layout) : undefined;
  } catch {
    // a layout the file no longer has (a button on a deleted layout): start where a new window would
    layout = undefined;
  }
  // The first record, else one with the related records a run found missing ("No related record in X").
  const needs: string[] = [];
  let recordId = foundSet?.[0];
  let result = await testRun(store, script, layout, foundSet, recordId, start?.parameter, seeds, opts);
  for (let retry = 0; retry < 3 && layout && foundSet && foundSet.length > 1 && result.error === 101; retry++) {
    const missing = /No related records? in "([^"]+)"/.exec(result.message ?? '')?.[1];
    if (!missing || needs.includes(missing)) break;
    needs.push(missing);
    const better = recordWith(store, layout, foundSet, needs);
    if (better === undefined || better === recordId) break;
    recordId = better;
    result = await testRun(store, script, layout, foundSet, recordId, start?.parameter, seeds, opts);
  }
  return result;
}

/** The first of the records (up to 500) that has related records in every one of the table occurrences. */
function recordWith(store: Store, layout: string, ids: number[], occurrences: string[]): number | undefined {
  const formulas: string[] = [];
  for (const name of occurrences) {
    try {
      const to = store.occurrence(name);
      const field = to.owner.schema.tables.find((t) => t.name === to.table)?.fields.find((f) => !f.options?.global && f.kind === 'normal' && f.type !== 'container');
      if (!field) return undefined;
      formulas.push(`Count ( ${quoteName(name)}::${quoteName(field.name)} )`);
    } catch {
      return undefined;
    }
  }
  for (const id of ids.slice(0, 500)) {
    try {
      const values = store.evaluateEach(layout, formulas, id);
      if (values.every((v) => v !== undefined && Number(v.value) > 0)) return id;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The account a test run signs in as: an active local account with credentials, preferring [Full Access]. */
function account(store: Store): string | undefined {
  const active = store.accounts().filter((a) => !a.inactive && !a.external && a.hasPassword);
  return (active.find((a) => a.privilegeSet === '[Full Access]') ?? active[0])?.name;
}

/** A table occurrence or field name as a formula writes it: in ${ } when it isn't a plain name. */
function quoteName(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `\${${name}}`;
}

async function testRun(store: Store, script: Script, layout: string | undefined, foundSet: number[] | undefined, recordId: number | undefined,
  parameterFormula: string | undefined, seeds: ScriptSession, opts: TestOptions): Promise<ScriptTestResult> {
  const trials = [store, ...(opts.others ?? [])].map((s) => s.trial());
  const documents = mkdtempSync(join(tmpdir(), 'tabularius-test-'));
  const started = Date.now();
  const session = new ScriptSession();
  try {
    for (const [k, v] of seeds.globalFields) session.globalFields.set(k, [...v]);
    for (const [k, v] of Object.entries(opts.globals ?? {})) session.variables.set((k.startsWith('$$') ? k : `$$${k}`).toLowerCase(), [text(v)]);
    let parameter: string | undefined;
    if (parameterFormula && layout) {
      try {
        const [v] = store.evaluateEach(layout, [parameterFormula], recordId);
        if (v !== undefined) parameter = asText(v, store.dateOrder);
      } catch {
        // a parameter that can't be worked out here (it reads a variable, say): none
      }
    }
    const base = { script: script.name, ...(layout ? { layout } : {}), ...(recordId !== undefined && foundSet && recordId !== foundSet[0] ? { recordId } : {}) };
    let r: RunResult;
    try {
      r = await runScript(store, script, {
        ...(layout ? { layout } : {}),
        ...(foundSet ? { foundSet, ...(recordId !== undefined ? { recordId } : {}) } : {}),
        ...(parameter ? { parameter } : {}),
        session,
        documents,
        ...offlineScriptOptions(),
        previewDialogs: true,
        // Signed in as the file's own full-access account, so "creation account name" fields fill in as they would.
        ...(account(store) ? { account: account(store) } : {}),
        // CLI outbound tests may explicitly opt back into their capture configuration.
        ...(opts.outbound ? { outbound: opts.outbound } : {}),
        timeoutMs: opts.timeoutMs ?? 10_000,
        maxSteps: opts.maxSteps ?? 100_000,
        ...(opts.loopLimit ? { loopLimit: opts.loopLimit } : {}),
        ...(opts.loopRecordLimit ? { loopRecordLimit: opts.loopRecordLimit } : {}),
        ...(opts.memoryLimit ? { memoryLimit: opts.memoryLimit } : {}),
        // A skipped script stays unrun when another script calls it.
        ...(opts.skipped ? { skip: opts.skipped } : {}),
        trace: true,
      });
    } catch (e) {
      return { ...base, outcome: 'crashed', error: -1, steps: 0, ms: Date.now() - started, message: e instanceof Error ? e.message : String(e) };
    }
    const trace = r.trace ?? [];
    const halt = r.actions.find((a) => a.step === 'Halt Script' && /limit reached|^runaway loop/.test(String(a.reason)));
    const stalled = !!halt;
    // From the run's actions, and from steps' errors (a server-side run reports only its error).
    const skippedCalls = [...new Set([
      ...r.actions.filter((a) => a.step === 'Skip Script').map((a) => a.script),
      ...trace.flatMap((t) => /^Script "(.+)" is skipped and was not run$/.exec(t.message ?? '')?.[1] ?? []),
    ])];
    const failed = [...trace].reverse().find((t) => t.error);
    const last = stalled ? trace[trace.length - 1] : failed;
    return {
      ...base,
      outcome: stalled ? 'stalled' : r.error ? 'error' : 'ok',
      error: r.error,
      steps: r.steps,
      ms: Date.now() - started,
      // The line with what was typed into it masked: literals can be addresses or names (and secrets).
      ...(last ? { step: `${last.script}: ${maskStepText(last.line.replace(/\s+/g, ' ')).slice(0, 200)}` } : {}),
      ...(skippedCalls.length ? { skipped: skippedCalls } : {}),
      // A blocked service called over and over says so, whatever the last step's message was.
      ...(halt && /^refused-call/.test(String(halt.reason)) ? { message: `${String(halt.reason)} after ${r.steps} steps` }
        : last?.message ? { message: maskSensitive(last.message) } : halt ? { message: `${String(halt.reason)} after ${r.steps} steps` } : {}),
      ...(r.outside ? { outside: r.outside } : {}),
      ...(r.mail ? { mail: r.mail } : {}),
      ...(stalled ? stallHints(store, [script.name, ...(last ? [last.script] : [])]) : {}),
      ...setupHints([store, ...(opts.others ?? [])], trace, session),
    };
  } finally {
    // The run is over: its MBS JavaScript handles go now, not at the 60 s idle expiry (the server-wide cap is 32).
    session.close();
    for (const t of trials.reverse()) t.undo();
    rmSync(documents, { recursive: true, force: true });
  }
}

/**
 * Fields that refused a value ("requires a value") because their auto-enter reads only $$variables this run never
 * set: a login or startup script sets them in a person's session, so the cause is the test's setup, not the script.
 */
function setupHints(stores: Store[], trace: { message?: string }[], session: ScriptSession): { setup?: string[] } {
  const names = new Set(trace.flatMap((t) => /^Field "([^"]+)" requires a value/.exec(t.message ?? '')?.[1] ?? []).map((n) => n.toLowerCase()));
  if (!names.size) return {};
  const out = new Set<string>();
  for (const store of stores) {
    for (const table of store.schema.tables) {
      for (const field of table.fields) {
        if (!names.has(field.name.toLowerCase()) || !field.options?.autoEnter?.calculation || !field.calculation || !field.options.validation?.notEmpty) continue;
        const vars = [...new Set(field.calculation.match(/\$\$[\p{L}\p{N}_.|]+/gu) ?? [])];
        const unset = vars.filter((v) => !session.variables.get(v.toLowerCase())?.some((x) => asText(x) !== ''));
        if (!unset.length) continue;
        out.add(`${table.name}::${field.name} fills in from ${unset.join(', ')}, which nothing in this run set (a login or startup script usually does): ` +
          `run with ${unset.map((v) => `--global '${v}=…'`).join(' ')} to test the script itself`);
      }
    }
  }
  return out.size ? { setup: [...out] } : {};
}

/** Why a stalled script may never end, from the script linter, for the scripts named (each once). */
function stallHints(store: Store, names: string[]): { lint?: string[] } {
  const lint = [...new Set(names)].flatMap((name) => {
    const script = store.schema.scripts.find((x) => x.name === name);
    return script ? lintScript(script, store.schema).map((i) => maskStepText(`${name}, line ${i.line}: ${i.message} ${i.fix}`)) : [];
  });
  return lint.length ? { lint } : {};
}
