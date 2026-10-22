// Foreign keys, native files only: a named declaration on a relationship whose one match is child field = parent
// field, with what deleting a parent does to its children (ON DELETE). The relationship stays what portals, related
// fields and layouts follow; the foreign key only adds a rule on writes, checked by the store (store.ts) on every
// create, edit, duplicate, delete and truncate, so imports and live sync (which write through those) obey it too.
//
// Matching is the relationship's own for a single value: text compares without regard to case, other types as
// stored. A child field holds one parent key, so a multi-line value (FileMaker's multi-key) is refused there.

import type { Field, ForeignKey, OnDelete, Relationship, Schema, Table, TableOccurrence } from '../../fmp12/src/index.ts';
import type { StatementSync } from 'node:sqlite';
import type { SqlValue } from './find.ts';
import { q } from './import.ts';

export const ON_DELETE: readonly OnDelete[] = ['restrict', 'cascade', 'set-null', 'no-action'];

/** A foreign key as design changes give it: the child and parent are base tables (by name or id) and their fields. */
export interface ForeignKeySpec {
  name?: string;
  child?: { table: string | number; field: string | number };
  parent?: { table: string | number; field: string | number };
  /** Default restrict. */
  onDelete?: OnDelete;
}

/** A foreign key with its tables, fields and occurrences looked up in the schema. */
export interface ResolvedForeignKey {
  name: string;
  relationship: number;
  onDelete: OnDelete;
  child: { occurrence: TableOccurrence; table: Table; field: Field };
  parent: { occurrence: TableOccurrence; table: Table; field: Field };
}

const lower = (s: string) => s.toLowerCase();
const byRef = <T extends { id: number; name: string }>(list: T[], ref: string | number | undefined) =>
  typeof ref === 'number' ? list.find((x) => x.id === ref) : typeof ref === 'string' ? list.find((x) => lower(x.name) === lower(ref)) : undefined;

/** Why a field can't be one end of a foreign key, if it can't. */
function fieldProblem(table: Table, f: Field): string | undefined {
  if (f.kind !== 'normal') return `${table.name}::${f.name} is a ${f.kind} field; a foreign key joins normal fields`;
  if (f.options?.global) return `${table.name}::${f.name} is global; a foreign key joins stored fields`;
  if (f.type === 'container') return `${table.name}::${f.name} is a container field`;
  if ((f.options?.repetitions ?? 1) > 1) return `${table.name}::${f.name} repeats`;
  return undefined;
}

/** The relationship's foreign key with its tables and fields, or why it no longer fits the relationship. */
export function resolveForeignKey(s: Schema, rel: Relationship, fk: ForeignKey | undefined = rel.foreignKey): ResolvedForeignKey | string {
  if (!fk) return 'the relationship has no foreign key';
  if (rel.predicates.length !== 1) return `a foreign key needs a relationship with exactly one match (child field = parent field); this one has ${rel.predicates.length}`;
  const p = rel.predicates[0];
  if (p.operator !== '=') return `a foreign key needs an equality match (=); this relationship uses ${p.operator}`;
  const side = (toId: number) => s.tableOccurrences.find((t) => t.id === toId);
  const [childTo, parentTo] = fk.child === 'left' ? [side(rel.leftTableOccurrenceId), side(rel.rightTableOccurrenceId)] : [side(rel.rightTableOccurrenceId), side(rel.leftTableOccurrenceId)];
  if (!childTo || !parentTo) return 'the relationship is missing a table occurrence';
  if (childTo.dataSourceId || parentTo.dataSourceId) return `a foreign key joins two tables of this file; ${(childTo.dataSourceId ? childTo : parentTo).name} shows a table in another file`;
  const childTable = s.tables.find((t) => t.id === childTo.baseTableId);
  const parentTable = s.tables.find((t) => t.id === parentTo.baseTableId);
  if (!childTable || !parentTable || childTable.id !== fk.childTableId || parentTable.id !== fk.parentTableId) return 'the relationship no longer joins the foreign key\'s tables';
  const [childFieldId, parentFieldId] = fk.child === 'left' ? [p.leftFieldId, p.rightFieldId] : [p.rightFieldId, p.leftFieldId];
  const childField = childTable.fields.find((f) => f.id === fk.childFieldId);
  const parentField = parentTable.fields.find((f) => f.id === fk.parentFieldId);
  if (!childField || !parentField) return 'a field of the foreign key is missing';
  if (childFieldId !== fk.childFieldId || parentFieldId !== fk.parentFieldId) {
    return `the relationship no longer matches ${childTable.name}::${childField.name} = ${parentTable.name}::${parentField.name}; change or drop the foreign key in the same change`;
  }
  if (childTable.id === parentTable.id && childField.id === parentField.id) return 'a foreign key joins two different fields';
  const problem = fieldProblem(childTable, childField) ?? fieldProblem(parentTable, parentField);
  if (problem) return problem;
  if (childField.type !== parentField.type) {
    return `${childTable.name}::${childField.name} is ${childField.type} and ${parentTable.name}::${parentField.name} is ${parentField.type}; a foreign key joins fields of the same type`;
  }
  return { name: fk.name, relationship: rel.id, onDelete: fk.onDelete, child: { occurrence: childTo, table: childTable, field: childField }, parent: { occurrence: parentTo, table: parentTable, field: parentField } };
}

/**
 * The foreign key a spec declares on `rel`, merged over the one it has (an edit may give only the name or onDelete),
 * or why it can't be declared. The spec's child and parent must be the two sides of the relationship's one match.
 */
export function buildForeignKey(s: Schema, rel: Relationship, spec: ForeignKeySpec): ForeignKey | string {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'foreignKey is an object: {name, child: {table, field}, parent: {table, field}, onDelete}';
  const old = rel.foreignKey;
  const name = spec.name ?? old?.name;
  if (typeof name !== 'string' || !name.trim()) return 'a foreign key needs a name';
  if (name.length > 100) return 'a foreign key\'s name is at most 100 characters';
  const onDelete = spec.onDelete ?? old?.onDelete ?? 'restrict';
  if (!ON_DELETE.includes(onDelete)) return `onDelete is one of ${ON_DELETE.join(', ')}`;
  const end = (given: ForeignKeySpec['child'], tableId: number | undefined, fieldId: number | undefined, what: string): { table: Table; field: Field } | string => {
    if (given !== undefined && (!given || typeof given !== 'object')) return `the ${what} is {table, field}`;
    const table = given ? byRef(s.tables, given.table) : s.tables.find((t) => t.id === tableId);
    if (!table) return given ? `the ${what} table "${given.table}" is missing` : `a foreign key needs a ${what}: {table, field}`;
    const field = given ? byRef(table.fields, given.field) : table.fields.find((f) => f.id === fieldId);
    if (!field) return `the ${what} field ${table.name}::${given?.field ?? fieldId} is missing`;
    return { table, field };
  };
  const child = end(spec.child, old?.childTableId, old?.childFieldId, 'child');
  if (typeof child === 'string') return child;
  const parent = end(spec.parent, old?.parentTableId, old?.parentFieldId, 'parent');
  if (typeof parent === 'string') return parent;
  if (rel.predicates.length !== 1 || rel.predicates[0].operator !== '=') {
    return `a foreign key needs a relationship with exactly one match, child field = parent field; ${rel.leftTableOccurrence ?? rel.leftTableOccurrenceId} ↔ ${rel.rightTableOccurrence ?? rel.rightTableOccurrenceId} has ${rel.predicates.length === 1 ? `a ${rel.predicates[0].operator} match` : `${rel.predicates.length} matches`}`;
  }
  const p = rel.predicates[0];
  const base = (toId: number) => s.tableOccurrences.find((t) => t.id === toId);
  const left = base(rel.leftTableOccurrenceId), right = base(rel.rightTableOccurrenceId);
  if (left?.dataSourceId || right?.dataSourceId) return `a foreign key joins two tables of this file; ${(left?.dataSourceId ? left : right)!.name} shows a table in another file`;
  const is = (to: TableOccurrence | undefined, fieldId: number, e: { table: Table; field: Field }) => to?.baseTableId === e.table.id && fieldId === e.field.id;
  const side = is(left, p.leftFieldId, child) && is(right, p.rightFieldId, parent) ? 'left'
    : is(right, p.rightFieldId, child) && is(left, p.leftFieldId, parent) ? 'right' : undefined;
  if (!side) {
    const names = (to: TableOccurrence | undefined, id: number) => `${to?.name ?? '?'}::${s.tables.find((t) => t.id === to?.baseTableId)?.fields.find((f) => f.id === id)?.name ?? id}`;
    return `the relationship matches ${names(left, p.leftFieldId)} = ${names(right, p.rightFieldId)}, not ${child.table.name}::${child.field.name} = ${parent.table.name}::${parent.field.name}`;
  }
  return { name: name.trim(), child: side, childTableId: child.table.id, childFieldId: child.field.id, parentTableId: parent.table.id, parentFieldId: parent.field.id, onDelete };
}

/** The spec a stored foreign key is logged as: tables and fields by id, so a replay doesn't depend on names. */
export function foreignKeySpec(fk: ForeignKey): Required<ForeignKeySpec> {
  return { name: fk.name, child: { table: fk.childTableId, field: fk.childFieldId }, parent: { table: fk.parentTableId, field: fk.parentFieldId }, onDelete: fk.onDelete };
}

/** Every foreign key of the schema that fits its relationship (one that doesn't was refused when it was made). */
export function foreignKeysOf(s: Schema): ResolvedForeignKey[] {
  const out: ResolvedForeignKey[] = [];
  for (const rel of s.relationships) {
    if (!rel.foreignKey) continue;
    const r = resolveForeignKey(s, rel);
    if (typeof r !== 'string') out.push(r);
  }
  return out;
}

/** What each foreign key checks, by relationship id: a key that is new or checks something else needs the data checked again. */
export function foreignKeyPrints(s: Schema): Map<number, string> {
  const out = new Map<number, string>();
  for (const rel of s.relationships) {
    if (!rel.foreignKey) continue;
    const r = resolveForeignKey(s, rel);
    out.set(rel.id, typeof r === 'string' ? `!${r}` : JSON.stringify([r.child.table.id, r.child.field.id, r.child.field.type, r.parent.table.id, r.parent.field.id, r.parent.field.type]));
  }
  return out;
}

export const emptyKey = (v: unknown) => v === null || v === undefined || v === '';

/** The comparison of a stored key column with a value: text without regard to case, as the relationship matches. */
const eq = (f: Field, column: string) => `${column}${f.type === 'text' ? ' COLLATE NOCASE' : ''} = ?`;

/** Same key, as the foreign key compares them. */
export function sameKey(f: Field, a: unknown, b: unknown): boolean {
  if (emptyKey(a) || emptyKey(b)) return emptyKey(a) && emptyKey(b);
  if (f.type === 'text' && typeof a === 'string' && typeof b === 'string') return a.replace(/[A-Z]/g, (c) => c.toLowerCase()) === b.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return a === b || String(a) === String(b);
}

/**
 * The store's statement cache. These are internal integrity reads (the read-gate inventory lists them as CORE): they
 * look at every record, whatever the account may see, because a key holds or not for all of them.
 */
type Prepare = (sql: string) => StatementSync;

/** Whether a parent record (other than `except`) holds the key. */
export function parentHas(prepare: Prepare, fk: ResolvedForeignKey, value: SqlValue, except?: number): boolean {
  const pf = fk.parent.field;
  return !!prepare(`SELECT 1 FROM ${q(fk.parent.table.name)} WHERE ${eq(pf, q(pf.name))}${except === undefined ? '' : ' AND _fm_record_id <> ?'} LIMIT 1`)
    .get(...(except === undefined ? [value] : [value, except]));
}

/** The child records (other than `except`) that use the key. */
export function childIds(prepare: Prepare, fk: ResolvedForeignKey, value: SqlValue, except?: number): number[] {
  const cf = fk.child.field;
  return (prepare(`SELECT _fm_record_id AS id FROM ${q(fk.child.table.name)} WHERE ${eq(cf, q(cf.name))}${except === undefined ? '' : ' AND _fm_record_id <> ?'} ORDER BY _fm_record_id`)
    .all(...(except === undefined ? [value] : [value, except])) as { id: number }[]).map((r) => Number(r.id));
}

/** Child records that use any key at all (a truncated parent table leaves every one of them without a parent). */
export function childrenWithKeys(prepare: Prepare, fk: ResolvedForeignKey): number[] {
  const c = q(fk.child.field.name);
  return (prepare(`SELECT _fm_record_id AS id FROM ${q(fk.child.table.name)} WHERE ${c} IS NOT NULL AND ${c} <> '' ORDER BY _fm_record_id`).all() as { id: number }[]).map((r) => Number(r.id));
}

/** How many child records have a key no parent holds (or a multi-line one), with the first few such keys. */
export function orphans(prepare: Prepare, fk: ResolvedForeignKey, sample = 5): { count: number; values: SqlValue[] } {
  const c = `c.${q(fk.child.field.name)}`;
  const pf = fk.parent.field;
  const where = `${c} IS NOT NULL AND ${c} <> '' AND ((typeof(${c}) = 'text' AND (instr(${c}, char(10)) OR instr(${c}, char(13)))) OR NOT EXISTS (SELECT 1 FROM ${q(fk.parent.table.name)} p WHERE ${eq(pf, `p.${q(pf.name)}`).replace(' = ?', ` = ${c}`)}))`;
  const from = `FROM ${q(fk.child.table.name)} c WHERE ${where}`;
  const count = Number((prepare(`SELECT count(*) AS n ${from}`).get() as { n: number }).n);
  const values = count ? (prepare(`SELECT DISTINCT ${c} AS v ${from} ORDER BY 1 LIMIT ${Math.max(1, Math.trunc(sample))}`).all() as { v: SqlValue }[]).map((r) => r.v) : [];
  return { count, values };
}

/** ON DELETE as SQL writes it: CASCADE, SET NULL, ... */
export function onDeleteSql(mode: OnDelete): string {
  return mode.replace('-', ' ').toUpperCase();
}
