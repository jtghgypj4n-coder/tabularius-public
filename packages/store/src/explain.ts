// Why a field holds the value it does: its formula, the values it read, each
// step of the evaluation and the chain of calculations behind it. And a lint
// for formulas: the things FileMaker accepts without a word that still give a
// surprising result.

import { rethrowExecutionRefusal } from '../../calc/src/execution-refusal.ts';
import {
  compile, explainEvaluation, nodeText, asText, isEmpty, EMPTY, type CalcContext, type Compiled, type Node, type Step,
} from '../../calc/src/index.ts';
import type { Field, Table, TableOccurrence } from '../../fmp12/src/index.ts';
import { skipWhenEmpty, storedValue, valueType, type Rec } from './calc.ts';
import type { Privileges } from './privileges.ts';
import type { Store } from './store.ts';

const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + '…' : s);

export interface Reference {
  /** As the formula names it: Field or Occurrence::Field. */
  field: string;
  type?: string;
  kind?: string;
  /** The value it had for this evaluation (text, clipped). */
  value?: string;
  empty?: boolean;
  /** Not a field of the file (a typo, or a deleted field). */
  missing?: boolean;
  /** This field is `'none'` for the privileges explaining the formula: its value is withheld, not shown. */
  hidden?: boolean;
}

export interface Dependency {
  field: string;
  kind: string;
  storage: 'stored' | 'unstored' | 'global' | 'summary' | 'auto-enter';
  formula?: string;
  dependsOn?: Dependency[];
  /** This field is `'none'` for the privileges explaining the formula: its formula and further dependencies are withheld, not shown. */
  hidden?: boolean;
}

export interface LintWarning {
  code: 'empty-rule' | 'empty-rule-container' | 'type-mix' | 'date-text' | 'stored-global' | 'stored-related' | 'self-reference' | 'unused-let' | 'reference';
  message: string;
}

export interface FieldExplanation {
  table: string;
  field: string;
  type: string;
  kind: string;
  storage: Dependency['storage'] | 'data';
  /** The field's value in the record, as the record shows it. */
  value: string;
  formula?: string;
  /** The table occurrence the formula is evaluated from. */
  context?: string;
  /** Whether "Do not evaluate if all referenced fields are empty" is on (calculations and auto-enter calculations). */
  doNotEvaluateIfEmpty?: boolean;
  references?: Reference[];
  /** Why the formula wasn't evaluated, when it wasn't. */
  notEvaluated?: string;
  /** What the formula gives now, and whether that is what is stored. */
  result?: string;
  error?: { code: number; message: string };
  matchesStored?: boolean;
  steps?: Step;
  truncated?: boolean;
  dependencies?: Dependency[];
  warnings?: LintWarning[];
  notes?: string[];
}

const storageOf = (f: Field): Dependency['storage'] =>
  f.options?.global ? 'global' : f.kind === 'summary' ? 'summary' : f.kind === 'calculation' ? (f.options?.unstored ? 'unstored' : 'stored') : 'auto-enter';

/** The formula a field runs: its calculation, or its auto-enter calculation. */
const formulaField = (f: Field) => !!f.calculation && (f.kind === 'calculation' || !!f.options?.autoEnter?.calculation);

/**
 * Explain a field on one record (or on no record, where only globals have
 * values). The caller has already checked the account may read the record.
 * Pass `privileges` so the check doesn't depend only on the caller remembering
 * one: a field that privileges can't see refuses outright, and any field a
 * formula *references* has its value withheld the same way a direct read of
 * it would withhold it (see `fieldOf`'s `'none'` check below) — so asking to
 * explain a visible calculation never leaks a hidden field through it.
 */
export function explainField(store: Store, table: Table, field: Field, rec: Rec | undefined, opts: { account?: string; maxSteps?: number; privileges?: Privileges } = {}): FieldExplanation {
  if (opts.privileges && opts.privileges.field(table.name, field.name) === 'none') {
    throw new Error(`The "${opts.privileges.name}" privilege set can't see ${table.name}::${field.name}`);
  }
  const calc = store.calc;
  const out: FieldExplanation = {
    table: table.name, field: field.name, type: field.type, kind: field.kind,
    storage: formulaField(field) || field.kind === 'summary' || field.options?.global ? storageOf(field) : 'data',
    value: '',
  };
  const pass = calc.newPass(opts.account);
  try {
    out.value = clip(rec || field.options?.global ? asText(calc.value(rec ?? { store, table, row: {} }, field, 1, pass), store.dateOrder) : '');
  } catch (e) {
    rethrowExecutionRefusal(e);
    out.value = '?';
  }
  if (field.kind === 'summary') {
    const of = table.fields.find((f) => f.id === field.summary?.fieldId);
    out.notes = [`A summary field: ${field.summary?.type ?? 'summary'} of ${of?.name ?? 'a field'} over the found set (all records when there is none).`];
    if (of) out.dependencies = dependencies(store, calc.defaultOccurrence(table), [{ name: of.name }], new Set([`${table.id}/${field.id}`]), 0, opts.privileges);
    return out;
  }
  if (!formulaField(field)) {
    if (field.options?.autoEnter?.lookup) (out.notes ??= []).push('A looked-up value: copied from the related record when the match field changes.');
    return out;
  }
  out.formula = field.calculation;
  const toId = field.calculationContextId ?? calc.defaultOccurrence(table);
  const to = toId !== undefined ? store.schema.tableOccurrences.find((t) => t.id === toId) : undefined;
  out.context = to?.name;
  out.doNotEvaluateIfEmpty = field.kind === 'calculation' ? !field.options?.evaluateWhenEmpty : !field.options?.autoEnter?.evaluateWhenEmpty;
  out.warnings = lintFormula(store, field.calculation!, { occurrence: toId, field });
  const c = calc.formula(table, field);
  if (!c || toId === undefined) {
    out.error = { code: 1200, message: 'The formula could not be read in its context' };
    return out;
  }
  const ctx = calc.context(rec, toId, pass);
  out.references = c.fields.map((r) => {
    const name = r.occurrence ? `${r.occurrence}::${r.name}` : r.name;
    const resolved = fieldOf(store, toId, r);
    if (!resolved) return { field: name, missing: true };
    const { field: f, table: fTable, store: fStore } = resolved;
    // A reference to a field the privileges can't see: the formula still
    // reads its real value to compute `out.result` (as any calculation
    // does), but explaining it must not print that value out — otherwise a
    // visible calculation that merely references a hidden field would be a
    // back door around the field's own access level. A reference can cross
    // into another hosted file (a table occurrence with its own data
    // source), so the check is against privileges *in that file*, not the
    // formula's own file.
    if (opts.privileges?.in(fStore).field(fTable, f.name) === 'none') {
      return { field: name, type: f.type, kind: f.kind, hidden: true };
    }
    let v;
    try {
      v = ctx.field?.({ occurrence: r.occurrence, field: r.name, repetition: 1 });
    } catch (e) {
      rethrowExecutionRefusal(e);
      return { field: name, type: f.type, kind: f.kind, value: '?' };
    }
    return { field: name, type: f.type, kind: f.kind, value: clip(asText(v ?? EMPTY, store.dateOrder)), empty: v === undefined || isEmpty(v) };
  });
  if (rec && skipWhenEmpty(field, c, ctx, calc.containerRef(toId))) {
    out.notEvaluated = field.kind === 'calculation'
      ? 'Every field the formula reads is empty and "Do not evaluate if all referenced fields are empty" is on, so the field stays empty.'
      : 'Every field the formula reads is empty and "Do not evaluate if all referenced fields are empty" is on, so the auto-enter calculation doesn\'t run.';
  }
  const ex = explainEvaluation(c, ctx, { maxSteps: opts.maxSteps });
  if (ex.error) out.error = ex.error;
  else if (ex.value) out.result = clip(asText(ex.value, store.dateOrder));
  if (ex.step) out.steps = ex.step;
  if (ex.truncated) out.truncated = true;
  if (rec && field.kind === 'calculation' && !field.options?.unstored && !field.options?.global && !out.notEvaluated) {
    const stored = asText(storedValue(store, rec.row[field.name], field, 1), store.dateOrder);
    out.matchesStored = ex.error ? stored === '?' : clip(stored) === out.result;
    if (!out.matchesStored) (out.notes ??= []).push('The stored value differs from what the formula gives now: it was computed when the record last changed, and something it reads (a related record, a global, the clock) has changed since.');
  }
  out.dependencies = dependencies(store, toId, c.fields, new Set([`${table.id}/${field.id}`]), 0, opts.privileges);
  return out;
}

/**
 * The field a formula's reference names, seen from occurrence toId, with the
 * base table (and, when the occurrence crosses into another hosted file, the
 * store it actually belongs to) — a privilege check on a reference must run
 * against its own table *and file*, never the formula's.
 */
function fieldOf(store: Store, toId: number, r: { occurrence?: string; name: string }): { field: Field; table: string; store: Store } | undefined {
  const to = r.occurrence ? store.calc.occurrence(r.occurrence) : store.schema.tableOccurrences.find((t) => t.id === toId);
  const t = to && store.calc.occurrenceTable(to.id);
  const f = t?.table.fields.find((f) => f.name.toLowerCase() === r.name.toLowerCase());
  return f && { field: f, table: t!.table.name, store: t!.store };
}

/**
 * The calculations (and summaries) behind a formula's references, four
 * levels deep. `privileges`, when given, withholds a dependency's formula
 * (and anything further behind it) once it reaches a field the privileges
 * can't see — the same rule `explainField`'s own references apply, carried
 * through the chain rather than stopping at the first hop.
 */
function dependencies(store: Store, toId: number | undefined, refs: { occurrence?: string; name: string }[], seen: Set<string>, depth: number, privileges?: Privileges): Dependency[] | undefined {
  if (toId === undefined || depth > 3) return undefined;
  const out: Dependency[] = [];
  for (const r of refs) {
    const to: TableOccurrence | undefined = r.occurrence ? store.calc.occurrence(r.occurrence) : store.schema.tableOccurrences.find((t) => t.id === toId);
    const where = to && store.calc.occurrenceTable(to.id);
    const f = where?.table.fields.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
    if (!to || !where || !f || !(formulaField(f) || f.kind === 'summary')) continue;
    const name = r.occurrence ? `${r.occurrence}::${f.name}` : f.name;
    if (privileges?.in(where.store).field(where.table.name, f.name) === 'none') {
      out.push({ field: name, kind: f.kind, storage: storageOf(f), hidden: true });
      continue;
    }
    const key = `${where.table.id}/${f.id}`;
    const dep: Dependency = { field: name, kind: f.kind, storage: storageOf(f) };
    if (f.calculation) dep.formula = f.calculation;
    if (!seen.has(key)) {
      seen.add(key);
      if (f.kind === 'summary') {
        const of = where.table.fields.find((x) => x.id === f.summary?.fieldId);
        if (of) dep.dependsOn = dependencies(where.store, where.store.calc.defaultOccurrence(where.table), [{ name: of.name }], seen, depth + 1, privileges);
      } else {
        const c = where.store.calc.formula(where.table, f);
        const ctxId = f.calculationContextId ?? where.store.calc.defaultOccurrence(where.table);
        if (c) dep.dependsOn = dependencies(where.store, ctxId, c.fields, seen, depth + 1, privileges);
      }
      if (!dep.dependsOn?.length) delete dep.dependsOn;
    }
    out.push(dep);
  }
  return out.length ? out : undefined;
}

const ARITHMETIC = new Set(['+', '-', '*', '/', '^']);
const COMPARE = new Set(['=', '≠', '<>', '<', '>', '≤', '<=', '≥', '>=']);

/**
 * Things FileMaker accepts in a formula that still surprise: text fields in
 * arithmetic, dates compared with text, a "Do not evaluate if all referenced
 * fields are empty" setting that hides the result the formula was written
 * for (or that doesn't apply, for containers), stored calculations reading
 * globals or related records, Let variables never used. `field` is the field
 * the formula belongs to, when it has one.
 */
export function lintFormula(store: Store, formula: string, ctx: { occurrence?: number; field?: Field } = {}): LintWarning[] {
  const warnings: LintWarning[] = [];
  const toId = ctx.occurrence;
  if (toId === undefined) return warnings;
  let c: Compiled;
  try {
    c = compile(store.externalFieldNames(formula), store.calc.names(toId));
  } catch (e) {
    rethrowExecutionRefusal(e);
    return warnings; // syntax errors are check_calculation's
  }
  const say = (code: LintWarning['code'], message: string) => {
    if (!warnings.some((w) => w.message === message)) warnings.push({ code, message });
  };
  const refName = (r: { occurrence?: string; name: string }) => (r.occurrence ? `${r.occurrence}::${r.name}` : r.name);
  const typeOf = (n: Node) => (n.k === 'field' ? fieldOf(store, toId, { occurrence: n.occurrence, name: n.name })?.field.type : undefined);
  const own = store.schema.tableOccurrences.find((t) => t.id === toId);
  const emptyRuleCalls = new Set(['getfield', 'evaluate', 'getfieldname', 'executesql', 'lookup', 'lookupnext', 'getnthrecord']);
  let readsByName = false;
  const walk = (n: Node, letNames: Map<string, number>[]) => {
    switch (n.k) {
      case 'var':
        for (let i = letNames.length - 1; i >= 0; i--) {
          const m = letNames[i];
          if (m.has(n.name.toLowerCase())) { m.set(n.name.toLowerCase(), m.get(n.name.toLowerCase())! + 1); break; }
        }
        if (n.rep) walk(n.rep, letNames);
        return;
      case 'field':
        if (n.rep) walk(n.rep, letNames);
        return;
      case 'let': {
        const m = new Map<string, number>();
        letNames.push(m);
        for (const [name, v, rep] of n.binds) {
          walk(v, letNames);
          if (rep) walk(rep, letNames);
          if (!name.startsWith('$')) m.set(name.toLowerCase(), 0);
        }
        walk(n.body, letNames);
        letNames.pop();
        for (const [name, uses] of m) if (!uses) say('unused-let', `The Let variable "${n.binds.find(([b]) => b.toLowerCase() === name)?.[0] ?? name}" is never used (fine if it is there only for a side effect, such as GetField ( "" ) to make the field update).`);
        return;
      }
      case 'unary':
        if (n.op === '-' && typeOf(n.a) === 'text') say('type-mix', `-${nodeText(n.a)} negates a text field: FileMaker uses only the digits in it.`);
        walk(n.a, letNames);
        return;
      case 'bin': {
        const ta = typeOf(n.a), tb = typeOf(n.b);
        if (ARITHMETIC.has(n.op)) {
          for (const [side, t] of [[n.a, ta], [n.b, tb]] as const) {
            if (t === 'text') say('type-mix', `${nodeText(n)} does arithmetic on the text field ${nodeText(side)}: FileMaker uses only the digits in it, so "12 boxes" counts as 12 and "N/A" as nothing.`);
            if (t === 'container') say('type-mix', `${nodeText(n)} does arithmetic on the container field ${nodeText(side)}.`);
          }
        }
        if (COMPARE.has(n.op)) {
          const pairs = [[ta, n.b], [tb, n.a]] as const;
          for (const [t, other] of pairs) {
            if ((t === 'date' || t === 'timestamp' || t === 'time') && other.k === 'str')
              say('date-text', `${nodeText(n)} compares a ${t} field with the text ${nodeText(other)}: the text is read in the file's date order (${store.dateOrder}), so it means something else on a file set up another way. Use Date ( m ; d ; y ) or GetAsDate.`);
            if (t === 'number' && other.k === 'str' && other.value !== '' && !/^\s*-?[\d.,]+\s*$/.test(other.value))
              say('type-mix', `${nodeText(n)} compares a number field with the text ${nodeText(other)}, which holds no number.`);
          }
        }
        walk(n.a, letNames);
        walk(n.b, letNames);
        return;
      }
      case 'call':
        if (emptyRuleCalls.has(n.name.toLowerCase())) readsByName = true;
        n.args.forEach((a) => walk(a, letNames));
        return;
      default:
        return;
    }
  };
  walk(c.node, []);
  // Unknown names are check_calculation's; a field deleted since is easy to miss, as FileMaker keeps the formula.
  if (c.fields.some((r) => /Missing>/.test(r.name))) say('reference', 'The formula reads a field or table that was deleted (FileMaker shows <Field Missing>): it always reads as empty.');
  const f = ctx.field;
  if (!f) return warnings;
  if (c.fields.some((r) => r.name.toLowerCase() === f.name.toLowerCase() && (!r.occurrence || store.calc.occurrence(r.occurrence)?.baseTableId === own?.baseTableId)) && f.kind === 'calculation')
    say('self-reference', `The formula reads ${f.name}, the field it belongs to.`);
  if (f.kind === 'calculation' && !f.options?.unstored && !f.options?.global) {
    const globals = c.fields.filter((r) => fieldOf(store, toId, r)?.field.options?.global).map(refName);
    if (globals.length) say('stored-global', `A stored calculation reading the global ${globals.join(', ')}: FileMaker makes such calculations unstored, because a stored value won't follow changes to the global.`);
    const related = c.fields.filter((r) => r.occurrence && r.occurrence.toLowerCase() !== own?.name.toLowerCase()).map(refName);
    if (related.length) say('stored-related', `A stored calculation reading the related ${related.join(', ')}: FileMaker makes such calculations unstored, because a stored value won't follow changes in the related records.`);
  }
  const ruleOn = f.kind === 'calculation' ? !f.options?.evaluateWhenEmpty : !!f.options?.autoEnter?.calculation && !f.options?.autoEnter?.evaluateWhenEmpty;
  if (ruleOn && c.fields.length && !readsByName) {
    const containers = c.fields.filter((r) => fieldOf(store, toId, r)?.field.type === 'container').map(refName);
    if (containers.length) {
      say('empty-rule-container', `"Do not evaluate if all referenced fields are empty" is on, but it never applies here: FileMaker evaluates a formula that reads a container field (${containers.join(', ')}) even when the container is empty.`);
    } else {
      // What the formula gives when everything it reads is empty, which the setting hides.
      let v;
      try {
        v = c.evaluate({ ...store.calc.context(undefined, toId), field: () => EMPTY, related: () => [] } as CalcContext, valueType(f));
      } catch (e) {
        rethrowExecutionRefusal(e);
        v = undefined;
      }
      // A 0 from arithmetic on empty fields is what anyone expects either way.
      // Only a result with a letter or digit in it: " " or " ()" between empty parts is what anyone wants hidden.
      if (v && !isEmpty(v) && !(v.type === 'number' && v.value === 0) && /[\p{L}\p{N}]/u.test(asText(v, store.dateOrder))) {
        say('empty-rule', `When every field it reads is empty, the formula gives ${JSON.stringify(clip(asText(v, store.dateOrder), 60))}, but "Do not evaluate if all referenced fields are empty" is on, so the field stays empty instead. Turn the option off if that value is wanted (typical for IsEmpty, flags and defaults).`);
      }
    }
  }
  return warnings;
}
