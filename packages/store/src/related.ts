// Related records: following FileMaker's relationship graph from a record in
// one table occurrence to the matching records in another, the way portals
// and related fields on a layout see them.
//
// The graph is a forest (FileMaker allows no cycles), so there is one path
// between two occurrences. Each hop matches the join predicates of one
// relationship; "=" also matches any line of a multi-line key, like
// FileMaker's multi-key relationships. Empty keys never match.

import { rethrowExecutionRefusal } from '../../calc/src/execution-refusal.ts';
import type { Field, Relationship, Schema, Table, TableOccurrence } from '../../fmp12/src/index.ts';
import { toStored } from '../../calc/src/index.ts';
import { calcFieldType, rowsById, type Row } from './calc.ts';
import type { SqlValue } from './find.ts';
import { dataSourceFile, q } from './import.ts';
import type { Store } from './store.ts';
import type { Privileges } from './privileges.ts';
import { checkMemory } from './errors.ts';

/** A table occurrence resolved to the store and table that hold its records. */
export interface Occurrence {
  to: TableOccurrence;
  store: Store;
  table: Table;
}

export interface Hop {
  rel: Relationship;
  /** True when walking from the relationship's left side to its right. */
  forward: boolean;
}

const SQL_OPS: Record<string, string> = { '=': '=', '≠': '<>', '<': '<', '≤': '<=', '>': '>', '≥': '>=' };

/** Most related lookups stop here; a portal over more rows pages through them. */
const MAX_ROWS = 10000;

export function occurrence(store: Store, toId: number): Occurrence | undefined {
  const to = store.schema.tableOccurrences.find((t) => t.id === toId);
  if (!to) return undefined;
  if (to.dataSourceId) {
    const file = dataSourceFile(store.schema.dataSources.find((d) => d.id === to.dataSourceId)?.paths ?? []);
    const other = file ? store.resolvedFile(file) : undefined;
    const table = other?.schema.tables.find((t) => t.id === to.baseTableId);
    return other && table ? { to, store: other, table } : undefined;
  }
  const table = store.schema.tables.find((t) => t.id === to.baseTableId);
  return table ? { to, store, table } : undefined;
}

export function occurrenceByName(store: Store, name: string): TableOccurrence | undefined {
  return store.schema.tableOccurrences.find((t) => t.name === name);
}

/** The relationships between two occurrences, in walking order. */
export function relationPath(schema: Schema, from: number, to: number): Hop[] | undefined {
  if (from === to) return [];
  const prev = new Map<number, { at: number; hop: Hop }>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const at = queue.shift()!;
    for (const rel of schema.relationships) {
      const next = rel.leftTableOccurrenceId === at ? rel.rightTableOccurrenceId
        : rel.rightTableOccurrenceId === at ? rel.leftTableOccurrenceId : undefined;
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { at, hop: { rel, forward: rel.leftTableOccurrenceId === at } });
      if (next === to) {
        const path: Hop[] = [];
        for (let n = to; n !== from; n = prev.get(n)!.at) path.unshift(prev.get(n)!.hop);
        return path;
      }
      queue.push(next);
    }
  }
  return undefined;
}

const fieldName = (t: Table, id: number) => t.fields.find((f) => f.id === id)?.name;

/** A schema-ordered projection. Unknown or runtime-selected fields require the full row. */
function projection(table: Table, names?: string[]): string {
  const wanted = new Set(names === undefined
    ? ['_fm_record_id', '_fm_mod_id', ...table.fields.map((f) => f.name)]
    : ['_fm_record_id', ...names]);
  return [...wanted]
    .filter((name) => name === '_fm_record_id' || name === '_fm_mod_id' || table.fields.some((f) => f.name === name))
    .map(q).join(', ');
}

/** The values a match field holds: each line of a multi-line key; none when empty. */
export function keys(v: SqlValue): SqlValue[] {
  if (v === null || v === '') return [];
  if (typeof v === 'string' && /[\r\n]/.test(v)) return v.split(/\r\n|[\r\n]/).filter((x) => x !== '');
  return [v];
}

/**
 * What a record's match field holds. Globals and unstored calculations have no
 * column of their own, so they are worked out; FileMaker allows both on the
 * side a relationship is followed from (a global filter key, a calculated key).
 */
export function keyValue(from: Occurrence, f: Field, row: Record<string, SqlValue>, privileges?: Privileges): SqlValue {
  if (!f.options?.global && !(f.kind === 'calculation' && f.options?.unstored)) return row[f.name] ?? null;
  try {
    const v = from.store.calc.value({ store: from.store, table: from.table, row: row as Row }, f, 1, from.store.calc.newPass(privileges?.account, privileges));
    return toStored(v, f.type === 'container' ? 'unknown' : calcFieldType(f.type) ?? 'unknown', from.store.dateOrder);
  } catch (e) {
    rethrowExecutionRefusal(e);
    return null;
  }
}

/** SQL condition on `to`'s table, from a row or a reader that supplies its visible, calculated match values. */
export function condition(hop: Hop, from: Occurrence, to: Occurrence, row: Record<string, SqlValue>, privileges?: Privileges,
  readField?: (field: Field) => SqlValue): { where: string; params: SqlValue[] } | undefined {
  if (privileges && !from.store.canViewRecord(from.table.name, Number(row._fm_record_id), privileges)) return undefined;
  const parts: string[] = [];
  const params: SqlValue[] = [];
  for (const p of hop.rel.predicates) {
    const [fromId, toId] = hop.forward ? [p.leftFieldId, p.rightFieldId] : [p.rightFieldId, p.leftFieldId];
    let op = p.operator as string;
    // FileMaker reads "Left::a < Right::b" as left op right; the query compares the far side's field, so walking left to right flips it.
    if (hop.forward) op = ({ '<': '>', '≤': '≥', '>': '<', '≥': '≤' } as Record<string, string>)[op] ?? op;
    if (op === '×') continue;
    const a = from.table.fields.find((f) => f.id === fromId);
    const b = fieldName(to.table, toId);
    if (!a || !b) return undefined;
    if (privileges && (from.store.fieldHidden(from.table.name, a.name, privileges) || from.store.fieldMasked(from.table.name, a.name, privileges))) return undefined;
    const field = to.table.fields.find((f) => f.name === b);
    const type = field?.type;
    // Number columns have REAL affinity, so a number compares as a number and the match index is used
    // (as the calculation engine's lookups do): a number field holding text that isn't a number matches nothing.
    let values = keys(readField ? readField(a) : keyValue(from, a, row, privileges));
    if (type === 'number') values = op === '=' ? values.map(Number).filter((v) => !Number.isNaN(v)) : values.slice(0, 1).map(Number).filter((v) => !Number.isNaN(v));
    if (!values.length) return undefined;
    if (field) to.store.calc.ensureIndex(to.table, field);
    const col = q(b);
    const collate = type === 'text' ? ' COLLATE NOCASE' : '';
    if (op === '=') {
      parts.push(`${col}${collate} IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
    } else {
      // SQLite puts text above every number, so only numbers are compared with a number.
      const numeric = type === 'number' ? ` AND typeof(${col}) IN ('integer', 'real')` : '';
      parts.push(`(${q(b)} IS NOT NULL AND ${q(b)} <> ''${numeric} AND ${col}${collate} ${SQL_OPS[op]} ?)`);
      params.push(values[0]);
    }
  }
  return { where: parts.length ? parts.join(' AND ') : '1', params };
}

export interface RelatedResult {
  occurrence: Occurrence;
  rows: Record<string, SqlValue>[];
  /** Matching records in all. */
  count: number;
}

/**
 * Records of occurrence `toId` related to `row`, a record of occurrence
 * `fromId`. `store` is the file whose relationship graph applies (the
 * layout's file). Returns undefined when the occurrences are not connected.
 */
export function relatedRows(
  store: Store, fromId: number, row: Record<string, SqlValue>, toId: number, opts: { offset?: number; limit?: number; cols?: string[]; privileges?: Privileges } = {},
): RelatedResult | undefined {
  const path = relationPath(store.schema, fromId, toId);
  const target = occurrence(store, toId);
  if (!path || !target) return undefined;
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.max(0, opts.limit ?? MAX_ROWS);
  let from = occurrence(store, fromId);
  if (!from) return undefined;
  if (path.length > 1 && !opts.privileges) {
    // Further away: the related ids hop by hop (one query per hop where the match fields allow), then just the page's records.
    const ids = store.calc.relatedIds({ store: from.store, table: from.table, row: row as Row }, fromId, toId, store.calc.newPass());
    const page = [...rowsById(target.store, target.table, ids.slice(offset, offset + limit), opts.cols)].map((r) => r.row as Record<string, SqlValue>);
    return { occurrence: target, rows: page, count: ids.length };
  }
  let rows = [row];
  for (let i = 0; i < path.length; i++) {
    const hop = path[i];
    const nextId = hop.forward ? hop.rel.rightTableOccurrenceId : hop.rel.leftTableOccurrenceId;
    const next = occurrence(store, nextId);
    if (!next) return undefined;
    const t = q(next.table.name);
    const last = i === path.length - 1;
    if (rows.length === 1 && last) {
      // The common case (a portal one hop away): let SQL count and page.
      const c = condition(hop, from, next, rows[0], opts.privileges);
      if (!c) return { occurrence: target, rows: [], count: 0 };
      const count = (next.store.calc.statement(`SELECT count(*) AS n FROM ${t} WHERE ${c.where}`).get(...c.params) as { n: number }).n;
      // `cols`: just the columns the caller shows, so a wide record isn't read whole.
      const matchCols = hop.rel.predicates.map((p) => fieldName(next.table, hop.forward ? p.rightFieldId : p.leftFieldId)).filter((n): n is string => !!n);
      const select = projection(next.table, opts.cols ? [...opts.cols, ...matchCols] : undefined);
      const page = next.store.calc.statement(`SELECT ${select} FROM ${t} WHERE ${c.where} ORDER BY _fm_record_id LIMIT ? OFFSET ?`)
        .all(...c.params, limit, offset) as Record<string, SqlValue>[];
      return { occurrence: target, rows: page, count };
    }
    const found = new Map<number, Record<string, SqlValue>>();
    for (const r of rows) {
      const c = condition(hop, from, next, r, opts.privileges);
      if (!c) continue;
      const nextHop = path[i + 1];
      const nextMatchCols = nextHop ? nextHop.rel.predicates.map((p) => fieldName(next.table, nextHop.forward ? p.leftFieldId : p.rightFieldId)).filter((n): n is string => !!n) : [];
      for (const x of next.store.calc.statement(`SELECT ${projection(next.table, nextHop ? nextMatchCols : undefined)} FROM ${t} WHERE ${c.where} ORDER BY _fm_record_id LIMIT ?`)
        .iterate(...c.params, MAX_ROWS) as Iterable<Record<string, SqlValue>>) {
        checkMemory();
        found.set(Number(x._fm_record_id), x);
        if (found.size >= MAX_ROWS) break;
      }
      if (found.size >= MAX_ROWS) break;
    }
    rows = [...found.values()];
    from = next;
  }
  if (!path.length) return { occurrence: target, rows: rows.slice(offset, offset + limit), count: rows.length };
  return { occurrence: target, rows: rows.slice(offset, offset + limit), count: rows.length };
}

/**
 * Ids of every record of occurrence `toId` related to `row`, in creation
 * order, for a portal that filters or sorts: no rows are held, so a
 * relationship to a large table costs its ids, not its records. With
 * `limit`, a one-hop relationship reads at most that many ids.
 */
export function relatedIdList(store: Store, fromId: number, row: Record<string, SqlValue>, toId: number, limit?: number): { occurrence: Occurrence; ids: number[] } | undefined {
  const path = relationPath(store.schema, fromId, toId);
  const target = occurrence(store, toId);
  if (!path || !target) return undefined;
  if (!path.length) return { occurrence: target, ids: [Number(row._fm_record_id)] };
  const from = occurrence(store, fromId);
  if (!from) return undefined;
  if (path.length > 1) return { occurrence: target, ids: store.calc.relatedIds({ store: from.store, table: from.table, row: row as Row }, fromId, toId, store.calc.newPass()) };
  const c = condition(path[0], from, target, row);
  const ids: number[] = [];
  if (c) {
    const capped = limit === undefined ? '' : ` LIMIT ${Math.max(0, Math.trunc(limit))}`;
    for (const x of target.store.calc.statement(`SELECT _fm_record_id AS id FROM ${q(target.table.name)} WHERE ${c.where} ORDER BY _fm_record_id${capped}`).iterate(...c.params) as Iterable<{ id: number }>) {
      checkMemory();
      ids.push(Number(x.id));
    }
  }
  return { occurrence: target, ids };
}

/**
 * Whether records of `toId` can be created from `fromId` (a portal's empty last row): a one-hop relationship
 * allowing creation on that side, matched with "=" only. A record whose match field is empty still can't.
 */
export function canCreateRelated(store: Store, fromId: number, toId: number): boolean {
  const path = relationPath(store.schema, fromId, toId);
  if (!path || path.length !== 1) return false;
  const hop = path[0];
  return !!(hop.forward ? hop.rel.rightCreate : hop.rel.leftCreate) && hop.rel.predicates.every((p) => p.operator === '=');
}

/**
 * Key values a new record in `toId` needs so it relates to `row` (FileMaker's
 * "allow creation of records via this relationship"): only for one-hop "="
 * relationships.
 */
export function relatedKeys(store: Store, fromId: number, row: Record<string, SqlValue>, toId: number): Record<string, SqlValue> | undefined {
  const path = relationPath(store.schema, fromId, toId);
  const from = occurrence(store, fromId);
  const to = occurrence(store, toId);
  if (!path || path.length !== 1 || !from || !to) return undefined;
  const hop = path[0];
  // Only when the relationship allows creating records on that side.
  if (!(hop.forward ? hop.rel.rightCreate : hop.rel.leftCreate)) return undefined;
  const out: Record<string, SqlValue> = {};
  for (const p of hop.rel.predicates) {
    if (p.operator !== '=') return undefined;
    const [fromField, toField] = hop.forward ? [p.leftFieldId, p.rightFieldId] : [p.rightFieldId, p.leftFieldId];
    const a = from.table.fields.find((f) => f.id === fromField);
    const b = fieldName(to.table, toField);
    const v = a ? keyValue(from, a, row) : null;
    if (!a || !b || v === null || v === '') return undefined;
    out[b] = typeof v === 'string' ? v.split(/\r\n|[\r\n]/)[0] : v;
  }
  return out;
}

/**
 * The first record of occurrence `toId` related to each of `rows` (records of
 * occurrence `fromId`), in one query when the relationship is one hop of "="
 * predicates: a portal's rows each showing a related field ask once, not once
 * a row. Otherwise (further away, other operators) record by record.
 */
export function firstRelatedEach(
  store: Store, fromId: number, rows: Record<string, SqlValue>[], toId: number, cols?: string[],
): { occurrence: Occurrence; firsts: (Record<string, SqlValue> | undefined)[] } | undefined {
  const target = occurrence(store, toId);
  const from = occurrence(store, fromId);
  const path = relationPath(store.schema, fromId, toId);
  if (!path || !target || !from) return undefined;
  const oneByOne = () => ({ occurrence: target, firsts: rows.map((r) => relatedRows(store, fromId, r, toId, { limit: 1, cols })?.rows[0]) });
  if (path.length !== 1 || rows.length < 2) return oneByOne();
  const hop = path[0];
  const preds: { col: string; type: string | undefined; keys: SqlValue[][] }[] = [];
  for (const p of hop.rel.predicates) {
    if (p.operator === '×') continue;
    if (p.operator !== '=') return oneByOne();
    const [fromField, toField] = hop.forward ? [p.leftFieldId, p.rightFieldId] : [p.rightFieldId, p.leftFieldId];
    const a = from.table.fields.find((f) => f.id === fromField);
    const b = target.table.fields.find((f) => f.id === toField);
    if (!a || !b) return undefined;
    const keysOf = (r: Record<string, SqlValue>) => {
      const ks = keys(keyValue(from, a, r));
      return b.type === 'number' || b.type === 'integer' || b.type === 'boolean' ? ks.map(Number).filter((v) => !Number.isNaN(v)) : ks;
    };
    const perRow = rows.map(keysOf);
    // Only plain values compare the same here as in SQL: numbers for a number field, text otherwise.
    if (perRow.some((ks) => ks.some((k) => typeof k !== (b.type === 'number' || b.type === 'integer' || b.type === 'boolean' ? 'number' : 'string')))) return oneByOne();
    target.store.calc.ensureIndex(target.table, b);
    preds.push({ col: b.name, type: b.type, keys: perRow });
  }
  if (!preds.length) return oneByOne();
  // SQLite's NOCASE folds ASCII letters only.
  const fold = (v: SqlValue, type: string | undefined) => (type === 'number' ? String(Number(v)) : type === 'text' ? String(v).replace(/[A-Z]/g, (c) => c.toLowerCase()) : String(v));
  const where: string[] = [];
  const params: SqlValue[] = [];
  for (const p of preds) {
    const all = [...new Map(p.keys.flat().map((k) => [fold(k, p.type), k])).values()];
    if (!all.length) return { occurrence: target, firsts: rows.map(() => undefined) };
    where.push(`${q(p.col)}${p.type === 'text' ? ' COLLATE NOCASE' : ''} IN (${all.map(() => '?').join(', ')})`);
    params.push(...all);
  }
  if (params.length > 900) return oneByOne();
  const found = target.store.calc.statement(`SELECT ${projection(target.table, [...preds.map((p) => p.col), ...(cols ?? [])])} FROM ${q(target.table.name)} WHERE ${where.join(' AND ')} ORDER BY _fm_record_id LIMIT ?`)
    .all(...params, MAX_ROWS + 1) as Record<string, SqlValue>[];
  // Too many to sort out here (keys shared by many records): record by record, as before.
  if (found.length > MAX_ROWS) return oneByOne();
  const wanted = preds.map((p) => p.keys.map((ks) => new Set(ks.map((k) => fold(k, p.type)))));
  const firsts = rows.map((_, i) => found.find((x) => preds.every((p, j) => x[p.col] !== null && wanted[j][i].has(fold(x[p.col], p.type)))));
  return { occurrence: target, firsts };
}
