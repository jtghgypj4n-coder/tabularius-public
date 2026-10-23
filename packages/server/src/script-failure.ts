// "Why did this script fail?": the script runs again on a throwaway copy of the file, offline (no network, no
// mail, no plug-ins, whatever the server allows people), as the account, from where it ran, and stops being
// interesting at the step that set the error it ended with. What comes back is what a person would dig out of
// the Script Debugger and Data Viewer: that step and the scripts that called it, the error and what it means,
// the variables then, the fields the step names with their values (and, for a calculation, its formula and
// inputs), and hints from the error and those values (a field or layout name that is almost right, an empty
// found set). The live file is never touched.

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorMeaning, explainField, Store, type Privileges } from '../../store/src/index.ts';
import { runScript, scriptsWithCredentials, skipMatcher, startingPoints, offlineScriptOptions, type DebugPoint } from '../../scripts/src/index.ts';
import { DRY_RUN_MAX_BYTES } from './dry-run.ts';
import { redactSecrets, secretName } from './ai-output.ts';
import { narrowPrivileges, type TokenScope } from './token-scope.ts';

export interface FailureField {
  name: string;
  value: string;
  /** calculation or summary, when it is one. */
  kind?: string;
  /** A calculation or auto-enter formula behind it, and the values it read. */
  formula?: string;
  inputs?: { name: string; value: string }[];
}

export interface ScriptFailure {
  script: string;
  outcome: 'ok' | 'error' | 'stalled' | 'skipped';
  /** Get ( LastError ) at the end. */
  error: number;
  /** What the error code means, in FileMaker's words. */
  meaning?: string;
  /** What the engine said about it. */
  message?: string;
  /** The step that set that error, 1-based, and the scripts that called it (outermost first). */
  step?: { script: string; number: number; line: string };
  stack?: { script: string; step: number }[];
  /** The steps that ran just before it in that script, oldest first. */
  before?: { number: number; line: string; error?: number }[];
  layout?: string;
  recordId?: number;
  foundCount?: number;
  mode?: 'browse' | 'find';
  variables?: { locals: Record<string, string>; globals: Record<string, string> };
  fields?: FailureField[];
  hints: string[];
  /** Where it was run: always a copy, offline. */
  ranOn: string;
}


const VALUE_CHARS = 300;
const clip = (v: string) => (v.length > VALUE_CHARS ? `${v.slice(0, VALUE_CHARS)}… (${v.length - VALUE_CHARS} more characters)` : v);
const shown = (name: string, v: string) => (secretName(name) && v !== '' ? '‹hidden from AI tools›' : clip(v));

/** Edit distance, for "did you mean". */
function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

function closest(name: string, among: string[]): string | undefined {
  const n = name.toLowerCase();
  let best: { s: string; d: number } | undefined;
  for (const s of among) {
    const d = distance(n, s.toLowerCase());
    if (d > 0 && (!best || d < best.d)) best = { s, d };
  }
  return best && best.d <= Math.max(2, Math.floor(name.length / 4)) ? best.s : undefined;
}

/** Occurrence::Field names in a step's text (string literals left out). */
export function fieldRefs(line: string): string[] {
  const text = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|[\s[(;&,=<>+\-*/¶])((?:[^\s:;[\]()"&,=<>+\-*/¶][^:;[\]()"&,=<>+\-*/¶]*?))::([^;[\]()"&,=<>+\-*/¶]+)/g)) {
    const operator = [...m[1].matchAll(/\b(?:and|or|not|xor)\s+/gi)].at(-1);
    const occurrence = m[1].slice(operator ? operator.index! + operator[0].length : 0).trim()
      .replace(/^(?:\$\S+|\d\S*)\s+/, '');
    const ref = `${occurrence}::${m[2].trim().replace(/\s*\[\d+\]$/, '')}`;
    if (!out.includes(ref)) out.push(ref);
  }
  return out.slice(0, 12);
}

/** Names quoted in a step that names a layout or script ("Go to Layout [ “Invoices” ]", Perform Script [ “Post” ]). */
function quotedName(line: string): string | undefined {
  return /[“"]([^”"]+)[”"]/.exec(line)?.[1];
}

/**
 * Runs `script` again on a copy, offline, as the account, from `layout` and `recordId` (else where a person would
 * start it), and reports the step that set the error it ended with. `privileges` limit what it sees, as in the run
 * that failed; they also limit what this reports.
 */
export async function explainScriptFailure(store: Store, req: { script: string; layout?: string; recordId?: number; parameter?: string },
  opts: { account: string; via?: string; privileges?: Privileges; scope?: TokenScope; maxBytes?: number; skip?: string[] }): Promise<ScriptFailure> {
  const ranOn = 'a throwaway copy of the file, offline (nothing was sent or changed)';
  const target = store.schema.scripts.find((s) => s.name.toLowerCase() === req.script.toLowerCase());
  if (!target) {
    const near = closest(req.script, store.schema.scripts.map((s) => s.name));
    throw new Error(`No script "${req.script}"${near ? ` (did you mean "${near}"?)` : ''}`);
  }
  // As test-scripts: scripts with credentials written into them are never run, however they're reached, nor --skip ones.
  const secrets = scriptsWithCredentials(store.schema.scripts);
  const named = skipMatcher(opts.skip ?? []);
  const skipped = (name: string) => secrets.has(name) || named(name);
  if (skipped(target.name)) {
    return { script: target.name, outcome: 'skipped', error: 0, hints: [secrets.has(target.name) ? `It has credentials written into it (${secrets.get(target.name)}), so it isn't run again here.` : 'It is one of the scripts to skip, so it isn\'t run again here.'], ranOn };
  }
  let size = 0;
  try {
    size = statSync(store.path).size;
  } catch {
    // in memory: copy it anyway
  }
  const maxBytes = opts.maxBytes ?? DRY_RUN_MAX_BYTES;
  if (size > maxBytes) {
    return { script: target.name, outcome: 'skipped', error: 0, hints: [`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, too large to copy and run again; use the Script Debugger with Pause on error.`], ranOn };
  }
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-why-'));
  let copy: Store | undefined;
  try {
    const file = join(dir, 'copy.sqlite');
    await store.backup(file);
    copy = new Store(file, store.name);
    copy.readContainersLike(store);
    const script = copy.schema.scripts.find((s) => s.id === target.id)!;
    const layout = req.layout ?? startingPoints(copy).get(script.id)?.layout;
    const privileges = opts.privileges ? narrowPrivileges(copy, copy.privileges(opts.account, opts.via), opts.scope) : undefined;
    // The state right after each step that set an error: the next step's debug point, or the last one seen.
    type Snapshot = { at: NonNullable<DebugPoint['previousError']>; point: DebugPoint; stack: DebugPoint['stack'] };
    let erred: Snapshot | undefined;
    let last: DebugPoint | undefined;
    let snapshot: { variables: ScriptFailure['variables']; fields: FailureField[]; layout?: string; recordId?: number; foundCount: number; mode: 'browse' | 'find' } | undefined;
    const take = (s: Snapshot) => {
      erred = s;
      snapshot = {
        variables: (() => {
          const v = s.point.variables();
          const keep = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).slice(0, 40).map(([k, x]) => [k, shown(k, x)]));
          return { locals: keep(v.locals), globals: keep(v.globals) };
        })(),
        fields: fieldRefs(s.at.line).map((name) => ({ name, value: shown(name, s.point.evaluate(name).value) })),
        layout: s.point.layout, recordId: s.point.recordId, foundCount: s.point.foundCount, mode: s.point.mode,
      };
    };
    const r = await runScript(copy, script, offlineScriptOptions({
      previewDialogs: true,
      ...(layout ? { layout } : {}), ...(req.recordId !== undefined ? { recordId: req.recordId } : {}),
      ...(req.parameter !== undefined ? { parameter: req.parameter } : {}),
      account: opts.account, executionAccount: opts.privileges ? opts.account : undefined, executionVia: opts.via, executionStore: store, ...(privileges ? { privileges } : {}),
      documents: join(dir, 'documents'), timeoutMs: 10_000, maxSteps: 50_000, trace: true, skip: skipped,
      debug: (point) => {
        last = point;
        if (point.previousError) take({ at: point.previousError, point, stack: point.stack });
      },
    }));
    const trace = r.trace ?? [];
    const stalled = r.actions.some((a) => a.step === 'Halt Script' && /limit reached/.test(String(a.reason)));
    const final = [...trace].reverse().find((t) => t.error);
    // An error on the last step run has no next step to stop at: read the state as the script left it.
    if (final && last && (!erred || erred.at.script !== final.script || erred.at.index !== final.index)) {
      take({ at: { script: final.script, index: final.index, line: final.line, code: final.error!, ...(final.message ? { message: final.message } : {}) }, point: last, stack: last.stack });
    }
    const error = r.error;
    if (!error && !stalled) return { script: script.name, outcome: 'ok', error: 0, ...(layout ? { layout } : {}), hints: ['It ran to the end with no error here. If it failed for someone, try their layout, record and account: the found set, the record and privileges change what a script does.'], ranOn };
    const at = erred?.at;
    const failure: ScriptFailure = {
      script: script.name,
      outcome: stalled ? 'stalled' : 'error',
      error,
      ...(errorMeaning(error) ? { meaning: errorMeaning(error) } : {}),
      ...(at?.message ? { message: redactSecrets(at.message) } : {}),
      ...(at ? { step: { script: at.script, number: at.index + 1, line: redactSecrets(at.line) } } : {}),
      ...(erred ? { stack: erred.stack.map((s) => ({ script: s.script, step: s.index + 1 })) } : {}),
      ...(at ? { before: stepsBefore(trace, at.script, at.index) } : {}),
      ...(snapshot ? { layout: snapshot.layout, recordId: snapshot.recordId, foundCount: snapshot.foundCount, mode: snapshot.mode, variables: snapshot.variables, fields: snapshot.fields } : layout ? { layout } : {}),
      hints: [],
      ranOn,
    };
    if (stalled) failure.hints.push(`It stopped after ${r.steps} steps, the limit for a run here: a loop whose Exit Loop If never comes true?`);
    // Calculations among the fields: their formulas and inputs, on the record it was on.
    for (const f of failure.fields ?? []) {
      const [occ, name] = f.name.split('::');
      try {
        const info = copy.occurrence(occ);
        if (privileges && privileges.in(info.owner).field(info.table, name) === 'none') continue;
        const table = info.owner.schema.tables.find((t) => t.name === info.table)!;
        const field = table.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!field) {
          const near = closest(name, table.fields.map((x) => x.name));
          failure.hints.push(`${occ} has no field "${name}"${near ? `; did you mean ${occ}::${near}?` : ''}`);
          continue;
        }
        if (field.kind === 'calculation' || field.kind === 'summary') f.kind = field.kind;
        if (field.kind !== 'calculation' && !field.options?.autoEnter) continue;
        // On the record the step was on, when it is a record of this occurrence's table.
        const here = failure.layout ? copy.layout(failure.layout) : undefined;
        const id = here && here.table === info.table && here.owner === info.owner ? failure.recordId : undefined;
        const e = explainField(info.owner, table, field, id !== undefined ? { store: info.owner, table, row: info.owner.row(info, id) } : undefined, { account: opts.account, maxSteps: 20, privileges: privileges?.in(info.owner) });
        if (!e.formula) continue;
        f.formula = redactSecrets(e.formula);
        if (e.references?.length) f.inputs = e.references.slice(0, 10).map((x) => ({ name: x.field, value: x.missing ? '(no such field)' : x.hidden ? '‹no access›' : shown(x.field, x.value ?? '') }));
      } catch {
        if (!copy.schema.tableOccurrences.some((t) => t.name.toLowerCase() === occ.toLowerCase())) {
          const near = closest(occ, copy.schema.tableOccurrences.map((t) => t.name));
          failure.hints.push(`There is no table occurrence "${occ}"${near ? `; did you mean ${near}?` : ''}`);
        }
      }
    }
    hint(copy, failure);
    return failure;
  } catch (e) {
    return { script: target.name, outcome: 'error', error: -1, message: (e as Error).message, hints: [], ranOn };
  } finally {
    copy?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Up to five steps the trace ran in `script` just before step `index` (the last time it ran). */
function stepsBefore(trace: { script: string; index: number; line: string; error?: number }[], script: string, index: number): { number: number; line: string; error?: number }[] {
  let at = trace.length - 1;
  while (at >= 0 && !(trace[at].script === script && trace[at].index === index)) at--;
  const out: { number: number; line: string; error?: number }[] = [];
  for (let i = at - 1; i >= 0 && out.length < 5; i--) {
    const t = trace[i];
    if (t.script !== script) continue;
    out.unshift({ number: t.index + 1, line: redactSecrets(t.line.replace(/\s+/g, ' ').slice(0, 200)), ...(t.error ? { error: t.error } : {}) });
  }
  return out;
}

/** Hints from the error and the state: the usual causes, checked against what was there. */
function hint(store: Store, f: ScriptFailure): void {
  const line = f.step?.line ?? '';
  const step = line.replace(/\s*\[.*$/s, '').trim();
  const name = quotedName(line);
  const add = (s: string) => f.hints.includes(s) || f.hints.push(s);
  switch (f.error) {
    case 101:
    case 401:
      if (f.foundCount === 0) add(`The found set was empty when "${step}" ran${f.layout ? ` on ${f.layout}` : ''}: check Get ( FoundCount ) after the find, or capture the error with Set Error Capture [ On ] and test Get ( LastError ).`);
      else if (/^(Perform Find|Constrain Found Set|Extend Found Set)/.test(step)) add(`The find matched no records${f.message && /\(by /.test(f.message) ? ` ${/\(by [^)]*\)/.exec(f.message)![0]}` : ''}. If that can happen, turn on Set Error Capture before it and check Get ( FoundCount ) after it, so the script handles no matches.`);
      else add(`"${step}" found no record to act on: the find criteria or the record it expected may be wrong for this data.`);
      break;
    case 102: {
      if (!f.hints.some((h) => /has no field|did you mean/.test(h))) add('The field isn\'t on the layout the script is on, was renamed, or the account can\'t see it. Go to a layout with the field first, or check its name.');
      break;
    }
    case 105:
      if (name) {
        const near = closest(name, store.schema.layouts.map((l) => l.name));
        add(`There is no layout "${name}"${near ? `; did you mean "${near}"?` : ''}`);
      }
      break;
    case 104:
      if (name) {
        const near = closest(name, store.schema.scripts.map((s) => s.name));
        add(`There is no script "${name}"${near ? `; did you mean "${near}"?` : ''}`);
      }
      break;
    case 201: {
      const computed = (f.fields ?? []).find((x) => x.kind && line.includes(x.name));
      add(computed ? `${computed.name} is a ${computed.kind} field, so a script can't set it: set the fields it is worked out from instead, or set a normal field.`
        : 'The field can\'t take a value here: it is a calculation or summary, it isn\'t modifiable for this account, or the layout is view-only.');
      break;
    }
    case 200:
    case 9:
      add('The account running it doesn\'t have the privileges for this step; a script can be set to run with full access privileges if that is intended.');
      break;
    case 301:
      add('Someone else had the record open. Capture the error and try again, or commit their record first.');
      break;
    case 400:
      add('Perform Find ran with no criteria: a Set Field in Find mode may have set an empty value, or the find was entered in the wrong mode.');
      break;
    case 3:
      add(`"${step}" can't run here (on the server or in this mode); FileMaker Server and the Data API skip steps a person's window needs.`);
      break;
    default:
      if (f.error >= 500 && f.error < 600) add('A value broke the field\'s validation: check the value the step sets against the field\'s validation options.');
      if (f.error >= 1200 && f.error < 1300) add('A formula in the step has an error: check its functions, parameters and field names.');
  }
}
