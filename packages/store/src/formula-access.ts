// What an account may save in a formula that reads another hosted file. A stored calculation (and an auto-enter, a
// validation, a lookup) is worked out with full data and the result kept for everyone, so what it may read is settled
// when it is written, against the account that writes it: its rights in the other file (none without an account
// there, no table or field it cannot see, only some rows). An unstored calculation is worked out for each reader and
// needs nothing here. Design changes made without privileges (the owner's, the operator's) are not checked.

import { compile, type NameTable } from '../../calc/src/index.ts';
import type { Field, Schema, Table } from '../../fmp12/src/index.ts';
import { checkStoreFormula } from './check.ts';
import { StoreError } from './errors.ts';
import type { Privileges } from './privileges.ts';
import type { Store } from './store.ts';

/** Functions that read fields, tables or records by a name or a query worked out as they run. */
const BY_NAME = /\b(GetField|Evaluate|ExecuteSQL|BE_FileMakerSQL)\s*\(/i;

interface Carrier {
  /** The formula's text, and what it is in the error. */
  formula: string;
  what: string;
  /** The occurrence it is worked out from. */
  from: number;
}

/** The formulas of a field that are worked out with full data and kept (or checked at every write). */
function carriers(store: Store, table: Table, f: Field): Carrier[] {
  const from = f.calculationContextId ?? store.calc.defaultOccurrence(table);
  if (from === undefined) return [];
  const out: Carrier[] = [];
  const stored = !f.options?.global && ((f.kind === 'calculation' && !f.options?.unstored) || (f.kind === 'normal' && !!f.options?.autoEnter?.calculation));
  if (stored && f.calculation) out.push({ formula: f.calculation, what: 'calculation', from });
  const v = f.options?.validation;
  if (f.kind === 'normal' && v?.calculation) out.push({ formula: v.calculation, what: 'validation calculation', from });
  if (f.kind === 'normal' && v?.message && v.messageCalculation) out.push({ formula: v.message, what: 'validation message', from });
  return out;
}

/** The bodies of the custom functions a formula calls, and theirs in turn: what runs in the formula's place. */
function expansion(store: Store, formula: string): string[] {
  const out = [formula];
  const seen = new Set<string>();
  for (let i = 0; i < out.length && out.length < 64; i++) {
    for (const cf of store.schema.customFunctions) {
      if (cf.language === 'javascript' || seen.has(cf.name.toLowerCase())) continue;
      if (!new RegExp(`(^|[^\\p{L}\\p{N}_.])${cf.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'iu').test(out[i])) continue;
      seen.add(cf.name.toLowerCase());
      out.push(store.externalFieldNames(cf.formula ?? ''));
    }
  }
  return out;
}

/**
 * Refuses, with a StoreError, design changes (already applied in the open transaction, so the caller rolls back) that
 * let `privileges` save more of another hosted file than it may read: a relationship matching on a field it cannot see
 * there, or a stored formula reading what it cannot see (what it says is the same for a field that is hidden and one
 * that is not there), reading only some rows, or reading by name or query when it cannot read the whole file.
 * `was` is the schema before the changes: only what they added or changed is looked at.
 */
export function assertMayReadWhatItSaves(store: Store, was: Schema, privileges: Privileges): void {
  const s = store.schema;
  // The occurrences of other hosted files this account does not have Full Access in.
  const outside = new Map<number, { name: string; home: { store: Store; table: Table }; source: string }>();
  for (const to of s.tableOccurrences) {
    if (!to.dataSourceId) continue;
    const home = store.calc.occurrenceTable(to.id);
    if (!home || privileges.in(home.store).full) continue;
    outside.set(to.id, { name: to.name, home, source: s.dataSources.find((d) => d.id === to.dataSourceId)?.name ?? home.store.name });
  }
  if (!outside.size) return;

  // A relationship on another file's field: by id, so it is also refused when there is no such field.
  const earlier = new Map(was.relationships.map((r) => [r.id, JSON.stringify(r.predicates)]));
  for (const rel of s.relationships) {
    if (earlier.get(rel.id) === JSON.stringify(rel.predicates)) continue;
    for (const [toId, fieldIds] of [[rel.leftTableOccurrenceId, rel.predicates.map((p) => p.leftFieldId)], [rel.rightTableOccurrenceId, rel.predicates.map((p) => p.rightFieldId)]] as const) {
      const away = outside.get(toId);
      if (!away) continue;
      for (const id of fieldIds) {
        const field = away.home.table.fields.find((f) => f.id === id);
        if (!field || away.home.store.fieldHidden(away.home.table.name, field.name, privileges)) {
          throw new StoreError(102, `A relationship to ${away.name} matches on a field of ${away.source} that this account can't read there`);
        }
      }
    }
  }

  const before = new Map(was.tables.flatMap((t) => t.fields.map((f) => [`${t.id}/${f.id}`, JSON.stringify([f.calculation, f.calculationContextId, f.options?.unstored, f.options?.global, f.options?.autoEnter, f.options?.validation])] as const)));
  const names = (from: number) => ({ open: store.calc.names(from), seen: store.calc.names(from, privileges) });
  for (const table of s.tables) {
    for (const f of table.fields) {
      const now = JSON.stringify([f.calculation, f.calculationContextId, f.options?.unstored, f.options?.global, f.options?.autoEnter, f.options?.validation]);
      const lookup = f.options?.autoEnter?.lookup;
      const changed = before.get(`${table.id}/${f.id}`) !== now;
      if (!changed) continue;
      // A lookup copies from the related record when a record is made: the field it copies must be one the account sees.
      const away = lookup && outside.get(lookup.occurrenceId);
      if (away) {
        const source = away.home.table.fields.find((x) => x.id === lookup.fieldId);
        if (!source || away.home.store.fieldHidden(away.home.table.name, source.name, privileges)) throw new StoreError(102, `A lookup from ${away.name} copies a field of ${away.source} that this account can't read there`);
        if (away.home.store.limitsView(away.home.table.name, privileges)) throw new StoreError(200, rowsMessage(away.name, 'lookup'));
      }
      for (const c of carriers(store, table, f)) assertFormula(store, c, outside, privileges, names(c.from));
    }
  }
}

const rowsMessage = (occurrence: string, what: string) =>
  `A stored ${what} can't read ${occurrence}: this account sees only some of its records there, and a stored value is the same for everyone. Use an unstored calculation instead.`;

function assertFormula(store: Store, c: Carrier, outside: Map<number, { name: string; home: { store: Store; table: Table }; source: string }>, privileges: Privileges, names: { open: NameTable; seen: NameTable }): void {
  const texts = expansion(store, c.formula);
  const lower = texts.join('\n').toLowerCase();
  const mentioned = [...outside.entries()].filter(([, o]) => lower.includes(`${o.name.toLowerCase()}::`));
  // Naming a table of the file at all, or reading by name or query, is what is looked at.
  const byName = texts.some((t) => BY_NAME.test(t));
  if (!mentioned.length && !byName) return;

  // What the account itself can resolve: a field it cannot see is as missing as one that is not there.
  const seen = checkStoreFormula(store, c.formula, { occurrence: c.from }, privileges);
  if (!seen.ok && (seen.code === 102 || checkStoreFormula(store, c.formula, { occurrence: c.from }).ok)) throw new StoreError(seen.code, seen.message);
  // The same formula must mean the same with every name known: else its meaning depends on a name only the file knows.
  for (const text of texts) {
    let open: string;
    let narrowed: string;
    try {
      open = JSON.stringify(compile(text, names.open).fields);
      narrowed = JSON.stringify(compile(text, names.seen).fields);
    } catch {
      continue; // a body that is no formula here (a custom function's, with its parameters) reads nothing
    }
    if (open !== narrowed) throw new StoreError(102, `The ${c.what} names a field of another file that this account can't read there`);
    for (const ref of JSON.parse(open) as { occurrence?: string; name: string }[]) {
      const hit = ref.occurrence ? [...outside.values()].find((o) => o.name.toLowerCase() === ref.occurrence!.toLowerCase()) : undefined;
      if (hit && hit.home.store.limitsView(hit.home.table.name, privileges)) throw new StoreError(200, rowsMessage(hit.name, c.what));
    }
  }
  if (byName) {
    const partial = [...outside.values()].find((o) => !privileges.in(o.home.store).readsEverything);
    if (partial) throw new StoreError(200, `A stored ${c.what} that reads fields or records by name or query (GetField, Evaluate, ExecuteSQL) can't be saved by an account that can't read all of ${partial.source}. Name the fields directly, or use an unstored calculation.`);
  }
}
