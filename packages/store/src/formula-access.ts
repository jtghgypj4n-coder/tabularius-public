// What an account may save in a formula that reads another hosted file. A stored calculation (and an auto-enter, a
// validation, a lookup) is worked out with full data and the result kept for everyone, so what it may read is settled
// when it is written, against the account that writes it: its rights in the other file (none without an account
// there, no table or field it cannot see, only some rows). An unstored calculation is worked out for each reader and
// needs nothing here. Design changes made without privileges (the owner's, the operator's) are not checked.
//
// The decision is made on the parsed formula, never on its text, so comments, spacing and case cannot hide a call: the
// calls are the parser's, the custom functions are followed into their bodies, and an unstored calculation a formula
// reads is followed into its own formula (a stored value reads it with full data). A change that does not touch a
// formula can still change what it reads (a custom function, a data source, an occurrence, a field it reads), so those
// changes check every formula that reaches what changed.

import { fieldRefs, parse, type Node } from '../../calc/src/index.ts';
import type { Field, Schema, Table } from '../../fmp12/src/index.ts';
import { checkStoreFormula } from './check.ts';
import { StoreError } from './errors.ts';
import type { Privileges } from './privileges.ts';
import type { Store } from './store.ts';
import { dataSourceFile } from './import.ts';

/** Functions that read fields, tables or records by a name or a query worked out as they run. */
const BY_NAME = new Set(['getfield', 'evaluate', 'executesql', 'executesqle', 'be_filemakersql']);

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

interface Read {
  home: Store;
  table: Table;
  field: Field;
}

/** What a formula reaches when it is worked out. */
interface Reach {
  /** A call that reads fields, tables or records by a name or a query worked out as it runs. */
  byName: boolean;
  /** ValueListItems: the values of a list, which may come from a field. */
  lists: boolean;
  /** Fields it reads, in whichever file, through unstored calculations as well. */
  reads: Read[];
  /** It names a table occurrence of a file the account has no Full Access in (whether the field is there or not). */
  outside: boolean;
  /** The fields (of any file) and the lower-case names of the custom functions and of this file's occurrences it reaches. */
  fields: Set<Field>;
  customs: Set<string>;
  occurrences: Set<string>;
}

/**
 * What `formula` reaches from occurrence `from` of `store`: the parser's own view of it, as the evaluator will run it. A
 * formula that does not parse reaches nothing (it cannot run).
 */
function reach(store: Store, formula: string, from: number, privileges: Privileges): Reach {
  const out: Reach = { byName: false, lists: false, reads: [], outside: false, fields: new Set(), customs: new Set(), occurrences: new Set() };
  const seen = new Set<string>();
  const follow = (home: Store, text: string, toId: number | undefined, depth: number): void => {
    const key = `${home.name}\0${toId}\0${text}`;
    if (toId === undefined || depth > 16 || seen.has(key)) return;
    seen.add(key);
    const names = home.calc.names(toId);
    const functions = new Set<string>();
    const reference = (r: { occurrence?: string; name: string }): void => {
      const to = r.occurrence ? home.calc.occurrence(r.occurrence) : home.schema.tableOccurrences.find((t) => t.id === toId);
      if (!to) return;
      if (home === store) out.occurrences.add(to.name.toLowerCase());
      const where = home.calc.occurrenceTable(to.id);
      if (!where) return;
      if (where.store !== store && !privileges.in(where.store).full) out.outside = true;
      const f = where.table.fields.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
      if (!f) return;
      out.reads.push({ home: where.store, table: where.table, field: f });
      out.fields.add(f);
      if (f.kind === 'summary') {
        const of = where.table.fields.find((x) => x.id === f.summary?.fieldId);
        if (of) out.reads.push({ home: where.store, table: where.table, field: of });
      }
      // An unstored calculation is worked out when it is read, and a stored value reads it with full data.
      if (f.kind === 'calculation' && f.options?.unstored && !f.options.global && f.calculation) {
        follow(where.store, f.calculation, f.calculationContextId ?? where.store.calc.defaultOccurrence(where.table), depth + 1);
      }
    };
    const custom = (name: string): void => {
      const lower = name.toLowerCase();
      const cf = home.schema.customFunctions.find((c) => c.name.toLowerCase() === lower);
      if (!cf || functions.has(lower)) return;
      functions.add(lower);
      out.customs.add(lower);
      if (cf.language !== 'javascript' && cf.formula !== undefined) visit(cf.formula, cf.parameters.map((p) => p.trim()));
    };
    const walk = (n: Node): void => {
      switch (n.k) {
        case 'field': if (n.rep) walk(n.rep); break;
        case 'var': if (!n.name.startsWith('$')) custom(n.name); if (n.rep) walk(n.rep); break;
        case 'call': {
          const lower = n.name.toLowerCase();
          if (BY_NAME.has(lower)) out.byName = true;
          if (lower === 'valuelistitems') out.lists = true;
          custom(n.name);
          n.args.forEach(walk);
          break;
        }
        case 'let':
          for (const [, value, rep] of n.binds) { walk(value); if (rep) walk(rep); }
          walk(n.body);
          break;
        case 'unary': walk(n.a); break;
        case 'bin': walk(n.a); walk(n.b); break;
      }
    };
    const visit = (body: string, parameters: string[]): void => {
      let node: Node;
      try {
        node = parse(home.externalFieldNames(body), names, parameters);
      } catch {
        return; // a body that is no formula here reads nothing
      }
      walk(node);
      fieldRefs(node).forEach(reference);
    };
    visit(text, []);
  };
  follow(store, formula, from, 0);
  return out;
}

/** The value lists whose values come from a file the account has no Full Access in. */
function listsOutside(store: Store, outsideTables: Set<number>, outsideSources: Set<number>): boolean {
  return store.schema.valueLists.some((v) => (v.external && outsideSources.has(v.external.dataSourceId)) || (v.field && (outsideTables.has(v.field.occurrenceId) || (v.field.relatedFromId !== undefined && outsideTables.has(v.field.relatedFromId)))));
}

const rowsMessage = (occurrence: string, what: string) =>
  `A stored ${what} can't read ${occurrence}: this account sees only some of its records there, and a stored value is the same for everyone. Use an unstored calculation instead.`;

/**
 * Refuses, with a StoreError, design changes (already applied in the open transaction, so the caller rolls back) that
 * let `privileges` save more of another hosted file than it may read: a relationship matching on a field it cannot see
 * there, or a stored formula reading what it cannot see (what it says is the same for a field that is hidden and one
 * that is not there), reading only some rows, or reading by name or query when it cannot read the whole file. It looks
 * at what the changes added or changed, and at every stored formula that reaches something they changed.
 * `was` is the schema before the changes.
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

  // What changed in the structure a formula's meaning rests on.
  const json = JSON.stringify;
  const changedTo = new Set<number>();
  const changedNames = new Set<string>();
  const occurrenceKey = (t: { name: string; baseTableId?: number; dataSourceId?: number }) => json([t.name, t.baseTableId, t.dataSourceId]);
  const wasTo = new Map(was.tableOccurrences.map((t) => [t.id, t]));
  const wasSource = new Map(was.dataSources.map((d) => [d.id, json([d.name, d.paths])]));
  const sourceMoved = new Set(s.dataSources.filter((d) => wasSource.get(d.id) !== json([d.name, d.paths])).map((d) => d.id));
  for (const to of s.tableOccurrences) {
    const before = wasTo.get(to.id);
    if (before && occurrenceKey(before) === occurrenceKey(to) && !(to.dataSourceId && sourceMoved.has(to.dataSourceId))) continue;
    changedTo.add(to.id);
    changedNames.add(to.name.toLowerCase());
    if (before) changedNames.add(before.name.toLowerCase());
  }
  for (const to of was.tableOccurrences) if (!s.tableOccurrences.some((t) => t.id === to.id)) changedNames.add(to.name.toLowerCase());
  const changedFunctions = new Set<string>();
  const functionKey = (c: { name: string; parameters: string[]; formula?: string; language?: string }) => json([c.name, c.parameters, c.formula, c.language]);
  const wasFunction = new Map(was.customFunctions.map((c) => [c.id, c]));
  for (const cf of s.customFunctions) {
    const before = wasFunction.get(cf.id);
    if (before && functionKey(before) === functionKey(cf)) continue;
    changedFunctions.add(cf.name.toLowerCase());
    if (before) changedFunctions.add(before.name.toLowerCase());
  }
  for (const cf of was.customFunctions) if (!s.customFunctions.some((c) => c.id === cf.id)) changedFunctions.add(cf.name.toLowerCase());
  const listsChanged = json(was.valueLists) !== json(s.valueLists);
  const structural = changedTo.size > 0 || changedFunctions.size > 0 || listsChanged || sourceMoved.size > 0;
  // A formula that reads by name or query can read any file it can name: it is looked at again when the change brings a
  // file into reach that this account cannot read in full (not for one that was already there, which it passed).
  const filesOutside = (schema: Schema): Set<Store> => {
    const out = new Set<Store>();
    for (const to of schema.tableOccurrences) {
      if (!to.dataSourceId) continue;
      const file = dataSourceFile(schema.dataSources.find((d) => d.id === to.dataSourceId)?.paths ?? []);
      const home = file ? store.resolvedFile(file) : undefined;
      if (home && home !== store && !privileges.in(home).full) out.add(home);
    }
    return out;
  };
  const before0 = filesOutside(was);
  const newlyOutside = [...filesOutside(s)].some((f) => !before0.has(f));

  // A relationship on another file's field: by id, so it is also refused when there is no such field.
  const relationship = (r: { predicates: unknown; leftTableOccurrenceId: number; rightTableOccurrenceId: number }) => json([r.predicates, r.leftTableOccurrenceId, r.rightTableOccurrenceId]);
  const earlier = new Map(was.relationships.map((r) => [r.id, relationship(r)]));
  for (const rel of s.relationships) {
    if (earlier.get(rel.id) === relationship(rel) && !changedTo.has(rel.leftTableOccurrenceId) && !changedTo.has(rel.rightTableOccurrenceId)) continue;
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

  const outsideTables = new Set(outside.keys());
  const outsideSources = new Set([...outside.keys()].map((id) => s.tableOccurrences.find((t) => t.id === id)?.dataSourceId).filter((x): x is number => x !== undefined));
  const lists = listsOutside(store, outsideTables, outsideSources);

  const fieldKey = (f: Field) => json([f.kind, f.calculation, f.calculationContextId, f.options?.unstored, f.options?.global, f.options?.autoEnter, f.options?.validation]);
  const before = new Map(was.tables.flatMap((t) => t.fields.map((f) => [`${t.id}/${f.id}`, fieldKey(f)] as const)));
  const changedFields = new Set<Field>();
  for (const table of s.tables) for (const f of table.fields) if (before.get(`${table.id}/${f.id}`) !== fieldKey(f)) changedFields.add(f);
  // A formula reads an unstored calculation's own formula too: when one changed, the formulas that read it are looked at again.
  const calculationChanged = [...changedFields].some((f) => f.kind === 'calculation');

  for (const table of s.tables) {
    for (const f of table.fields) {
      const changed = changedFields.has(f);
      const lookup = f.options?.autoEnter?.lookup;
      const away = lookup && outside.get(lookup.occurrenceId);
      // A lookup copies from the related record when a record is made: the field it copies must be one the account sees.
      if (away && (changed || changedTo.has(lookup.occurrenceId))) {
        const source = away.home.table.fields.find((x) => x.id === lookup.fieldId);
        if (!source || away.home.store.fieldHidden(away.home.table.name, source.name, privileges)) throw new StoreError(102, `A lookup from ${away.name} copies a field of ${away.source} that this account can't read there`);
        if (away.home.store.limitsView(away.home.table.name, privileges)) throw new StoreError(200, rowsMessage(away.name, 'lookup'));
      }
      if (!changed && !structural && !calculationChanged) continue;
      for (const c of carriers(store, table, f)) {
        const r = reach(store, c.formula, c.from, privileges);
        // A formula nothing changed is looked at only when it reaches something that did.
        if (!changed
          && ![...r.customs].some((n) => changedFunctions.has(n)) && ![...r.occurrences].some((n) => changedNames.has(n))
          && ![...r.fields].some((x) => changedFields.has(x)) && !(r.byName && newlyOutside) && !(r.lists && lists && (newlyOutside || listsChanged))) continue;
        assertFormula(store, c, r, outside, privileges, lists);
      }
    }
  }
}

function assertFormula(store: Store, c: Carrier, r: Reach, outside: Map<number, { name: string; home: { store: Store; table: Table }; source: string }>, privileges: Privileges, lists: boolean): void {
  const byName = r.byName || (r.lists && lists);
  if (!r.outside && !byName) return;

  // What the account itself can resolve: a field it cannot see is as missing as one that is not there.
  const seen = checkStoreFormula(store, c.formula, { occurrence: c.from }, privileges);
  if (!seen.ok && (seen.code === 102 || checkStoreFormula(store, c.formula, { occurrence: c.from }).ok)) throw new StoreError(seen.code, seen.message);
  // What it reads, directly or through an unstored calculation or a custom function: a field the account cannot see there, or a table where it sees only some rows.
  for (const x of r.reads) {
    if (x.home === store || privileges.in(x.home).full) continue;
    const where = [...outside.values()].find((o) => o.home.store === x.home && o.home.table === x.table)?.name ?? x.home.name;
    if (x.home.fieldHidden(x.table.name, x.field.name, privileges)) throw new StoreError(102, `The ${c.what} reads a field of ${x.home.name} that this account can't read there`);
    if (x.home.limitsView(x.table.name, privileges)) throw new StoreError(200, rowsMessage(where, c.what));
  }
  if (byName) {
    const partial = [...outside.values()].find((o) => !privileges.in(o.home.store).readsEverything);
    if (partial) throw new StoreError(200, `A stored ${c.what} that reads fields or records by name or query (GetField, Evaluate, ExecuteSQL) can't be saved by an account that can't read all of ${partial.source}. Name the fields directly, or use an unstored calculation.`);
  }
}
