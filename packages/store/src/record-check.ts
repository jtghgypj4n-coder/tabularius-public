// "Why does this record look wrong?": every calculation and validated field on one record, checked as it is now.
// A formula that fails, one whose stored value is no longer what it gives, one left empty by an empty input, a
// reference to a field that isn't there, a value its validation would refuse; each traced back through the
// calculations it reads to the field where the trouble starts.

import { rethrowExecutionRefusal } from '../../calc/src/execution-refusal.ts';
import type { Field, Table } from '../../fmp12/src/index.ts';
import type { Rec } from './calc.ts';
import { explainField, type Dependency, type FieldExplanation, type Reference } from './explain.ts';
import type { Privileges } from './privileges.ts';
import type { Store } from './store.ts';

export interface RecordProblem {
  field: string;
  kind: 'error' | 'missing-reference' | 'validation' | 'stale' | 'empty-input' | 'not-evaluated' | 'warning';
  /** What is wrong, in a sentence. */
  message: string;
  /** What the record shows. */
  value?: string;
  /** What the formula gives now, when that differs from what is shown. */
  now?: string;
  formula?: string;
  /** The values the formula read. */
  inputs?: Pick<Reference, 'field' | 'value' | 'empty' | 'missing' | 'hidden'>[];
  /** Fields on this record it reads (directly or through other calculations) that have a problem of their own: look there first. */
  causedBy?: string[];
  /** It reads a field the caller counts as secret (directly or through other calculations): its values and message may repeat it. */
  readsSecret?: boolean;
}

export interface RecordCheck {
  table: string;
  /** Fields checked. */
  checked: number;
  /** Root causes first, then what follows from them. */
  problems: RecordProblem[];
}

const ORDER: RecordProblem['kind'][] = ['error', 'missing-reference', 'validation', 'stale', 'empty-input', 'not-evaluated', 'warning'];
/** Lint warnings worth raising when a record looks wrong: the ones that change a result. */
const RESULT_WARNINGS = new Set(['type-mix', 'date-text', 'stored-related', 'stored-global', 'self-reference']);

const formulaField = (f: Field) => !!f.calculation && (f.kind === 'calculation' || !!f.options?.autoEnter?.calculation);
const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** Every field a formula reads, through the calculations behind it, as the formula names it. */
function touched(deps: Dependency[] | undefined, refs: Reference[] | undefined, out: string[] = []): string[] {
  for (const r of refs ?? []) out.push(r.field);
  const walk = (ds: Dependency[] | undefined) => {
    for (const d of ds ?? []) {
      out.push(d.field);
      walk(d.dependsOn);
    }
  };
  walk(deps);
  return out;
}

/** Problems ordered so each comes after the problems it is caused by, then by kind. */
function rootsFirst(problems: RecordProblem[]): RecordProblem[] {
  const byField = new Map<string, RecordProblem[]>();
  for (const p of problems) byField.set(p.field.toLowerCase(), [...(byField.get(p.field.toLowerCase()) ?? []), p]);
  const depth = new Map<string, number>();
  const depthOf = (field: string, seen: Set<string>): number => {
    const key = field.toLowerCase();
    if (depth.has(key)) return depth.get(key)!;
    if (seen.has(key)) return 0;
    seen.add(key);
    let d = 0;
    for (const p of byField.get(key) ?? []) for (const c of p.causedBy ?? []) d = Math.max(d, depthOf(c, seen) + 1);
    seen.delete(key);
    depth.set(key, d);
    return d;
  };
  return problems.map((p, i) => ({ p, i, d: depthOf(p.field, new Set()) }))
    .sort((a, b) => a.d - b.d || ORDER.indexOf(a.p.kind) - ORDER.indexOf(b.p.kind) || a.i - b.i)
    .map((x) => x.p);
}

/** The fields of this record a formula reads, through the calculations behind it, by name. */
function upstream(deps: Dependency[] | undefined, refs: Reference[] | undefined, own: string, out = new Set<string>()): Set<string> {
  for (const r of refs ?? []) if (!r.field.includes('::') || r.field.startsWith(`${own}::`)) out.add(r.field.replace(/^.*::/, '').toLowerCase());
  const walk = (ds: Dependency[] | undefined) => {
    for (const d of ds ?? []) {
      if (!d.field.includes('::') || d.field.startsWith(`${own}::`)) out.add(d.field.replace(/^.*::/, '').toLowerCase());
      walk(d.dependsOn);
    }
  };
  walk(deps);
  return out;
}

/**
 * Checks one record: `fields` limits it to those (the ones the account may see); the caller has already checked the
 * account may read the record.
 */
export function checkRecord(store: Store, table: Table, rec: Rec, opts: { account?: string; fields?: string[]; secret?: (field: string) => boolean; privileges?: Privileges } = {}): RecordCheck {
  const only = opts.fields && new Set(opts.fields.map((f) => f.toLowerCase()));
  const fields = table.fields.filter((f) => !only || only.has(f.name.toLowerCase()));
  const problems: RecordProblem[] = [];
  const reads = new Map<string, Set<string>>();
  const secret = (name: string) => !!opts.secret && (opts.secret(name) || opts.secret(name.replace(/^.*::/, '')));
  // Fields that read a secret field, through any number of calculations.
  const tainted = new Set(table.fields.filter((f) => secret(f.name)).map((f) => f.name.toLowerCase()));
  // A validation formula or calculated message naming a secret field may repeat its value.
  const secretNames = table.fields.filter((f) => secret(f.name)).map((f) => f.name.toLowerCase());
  const namesSecret = (text: string | undefined) => !!text && secretNames.some((n) => text.toLowerCase().includes(n));
  let checked = 0;
  for (const f of fields) {
    const validation = f.options?.validation;
    if (validation && f.kind === 'normal') {
      if (!formulaField(f)) checked++;
      try {
        const bad = store.calc.checkValidation(rec, f, opts.account);
        const hush = secret(f.name) || (validation.calculation && namesSecret(validation.calculation)) || (validation.messageCalculation && namesSecret(validation.message));
        if (bad) problems.push({ field: f.name, kind: 'validation', value: String(rec.row[f.name] ?? ''), message: `${f.name} wouldn't pass its validation now: ${bad.message}.`.replace(/\.\.$/, '.'), ...(hush ? { readsSecret: true } : {}) });
      } catch (err) {
        rethrowExecutionRefusal(err);
        problems.push({ field: f.name, kind: 'error', message: `${f.name}'s validation couldn't be checked: ${(err as Error).message}`, ...(secret(f.name) ? { readsSecret: true } : {}) });
      }
    }
    if (formulaField(f)) {
      // A field the privileges can't see is skipped, not reported: it isn't
      // checked at all, rather than checked and then its trouble (or even
      // its formula failing) surfaced as a problem the account can read.
      if (opts.privileges?.field(table.name, f.name) === 'none') continue;
      checked++;
      let e: FieldExplanation;
      try {
        e = explainField(store, table, f, rec, { account: opts.account, maxSteps: 1, privileges: opts.privileges });
      } catch (err) {
        rethrowExecutionRefusal(err);
        problems.push({ field: f.name, kind: 'error', message: `${f.name} couldn't be checked: ${(err as Error).message}` });
        continue;
      }
      const refs = (e.references ?? []).filter((r, i, all) => all.findIndex((x) => x.field === r.field) === i);
      const inputs = refs.map((r) => ({ field: r.field, ...(r.value !== undefined ? { value: r.value } : {}), ...(r.empty ? { empty: true } : {}), ...(r.missing ? { missing: true } : {}), ...(r.hidden ? { hidden: true } : {}) }));
      const base = { field: f.name, value: e.value, formula: e.formula, ...(inputs.length ? { inputs } : {}) };
      reads.set(f.name.toLowerCase(), upstream(e.dependencies, e.references, e.context ?? table.name));
      if (touched(e.dependencies, e.references).some(secret)) tainted.add(f.name.toLowerCase());
      const missing = refs.filter((r) => r.missing).map((r) => r.field);
      if (missing.length) {
        // The trouble is in the formula itself, whatever it reads.
        problems.push({ ...base, kind: 'missing-reference', message: `${f.name} reads ${list(missing)}, which ${missing.length === 1 ? 'isn\'t a field' : 'aren\'t fields'} of the file (renamed or deleted), so it can't give the right result.` });
        reads.delete(f.name.toLowerCase());
        continue;
      }
      if (e.error) {
        problems.push({ ...base, kind: 'error', message: `${f.name}'s formula fails on this record: ${e.error.message} (error ${e.error.code}).` });
        continue;
      }
      if (e.matchesStored === false) {
        problems.push({ ...base, now: e.result, kind: 'stale', message: `${f.name} shows a value its formula no longer gives: the stored value was worked out when the record last changed, and something it reads has changed since.` });
      }
      const empty = refs.filter((r) => r.empty).map((r) => r.field);
      if (e.notEvaluated && f.kind === 'calculation') {
        problems.push({ ...base, kind: 'not-evaluated', message: `${f.name} is empty because every field it reads (${list(empty)}) is empty and "Do not evaluate if all referenced fields are empty" is on.` });
      } else if (!e.notEvaluated && (e.result ?? '') === '' && empty.length && empty.length < refs.length) {
        problems.push({ ...base, kind: 'empty-input', message: `${f.name} is empty, and ${list(empty)} ${empty.length === 1 ? 'is' : 'are'} empty on this record: fill ${empty.length === 1 ? 'it' : 'them'} in or check the formula handles a blank.` });
      }
      for (const w of e.warnings ?? []) if (RESULT_WARNINGS.has(w.code)) problems.push({ ...base, kind: 'warning', message: `${f.name}: ${w.message}` });
    }
  }
  // Taint passes through calculations on this record that read a tainted one.
  for (let grew = true; grew;) {
    grew = false;
    for (const [field, from] of reads) if (!tainted.has(field) && [...from].some((n) => tainted.has(n))) tainted.add(field), (grew = true);
  }
  for (const p of problems) if (tainted.has(p.field.toLowerCase())) p.readsSecret = true;
  // What each problem reads that has a problem of its own: the place to look first.
  const troubled = new Set(problems.filter((p) => p.kind !== 'warning').map((p) => p.field.toLowerCase()));
  for (const p of problems) {
    const causes = [...(reads.get(p.field.toLowerCase()) ?? [])].filter((n) => n !== p.field.toLowerCase() && troubled.has(n));
    if (causes.length) p.causedBy = causes.map((n) => fields.find((f) => f.name.toLowerCase() === n)?.name ?? n);
  }
  return { table: table.name, checked, problems: rootsFirst(problems) };
}
