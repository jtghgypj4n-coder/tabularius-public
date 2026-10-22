// Totals and breakdowns of a found set, as a sub-summary report shows them:
// "how many open invoices per customer, and their total". The find runs as the
// account (records it can't view are left out, fields it can't see are
// missing), then the numbers are worked out in the database, so a found set of
// 100,000 records answers as quickly as one of ten.

import { q } from '../../store/src/import.ts';
import { StoreError, type FindRequest, type Privileges, type Store } from '../../store/src/index.ts';
import type { SqlValue } from '../../store/src/find.ts';
import { asText } from '../../calc/src/index.ts';
import { unhostedFileOf } from './insight.ts';
import { containsSecret, HIDDEN_VALUE, secretName, secretValues } from './ai-output.ts';

export type Measure = 'count' | 'sum' | 'average' | 'min' | 'max' | 'distinct';

export interface SummaryRequest {
  layout: string;
  query?: FindRequest[];
  /** Fields to break the found set down by (up to 3). */
  groupBy?: string[];
  /** What to work out over each group; count of records is always given. */
  measures?: { field: string; fn: Measure }[];
  /** Groups to return, largest first (default 50). */
  limit?: number;
  /** Date and timestamp fields in groupBy are grouped by this period ("2026-07" for month), in date order. */
  by?: Period;
  /** Groups largest first by record count (the default), or by the first measure: "top 10 customers by revenue". */
  order?: 'count' | 'measure';
}

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** An ISO date or timestamp column as its period: 2026-07-03, 2026-W27, 2026-07, 2026-Q3, 2026. */
const PERIOD: Record<Period, (c: string) => string> = {
  day: (c) => `substr(${c}, 1, 10)`,
  week: (c) => `strftime('%Y-W%W', substr(${c}, 1, 10))`,
  month: (c) => `substr(${c}, 1, 7)`,
  quarter: (c) => `substr(${c}, 1, 4) || '-Q' || ((CAST(substr(${c}, 6, 2) AS INTEGER) + 2) / 3)`,
  year: (c) => `substr(${c}, 1, 4)`,
};

export interface SummaryResult {
  layout: string;
  foundCount: number;
  totals: Record<string, SqlValue>;
  groups?: { values: Record<string, SqlValue>; count: number; measures: Record<string, SqlValue> }[];
  /** How many groups there are when not all are returned. */
  groupCount?: number;
}

const SQL: Record<Measure, (col: string) => string> = {
  count: (c) => `count(${c})`,
  sum: (c) => `total(${c})`,
  average: (c) => `avg(${c})`,
  min: (c) => `min(${c})`,
  max: (c) => `max(${c})`,
  distinct: (c) => `count(DISTINCT ${c})`,
};

const secretQueries = new WeakSet<Store>();

export function summarizeRecords(store: Store, req: SummaryRequest, privileges?: Privileges, onRead?: (ids: number[]) => void, forModel = false): SummaryResult {
  const info = store.layout(req.layout);
  const groupBy = req.groupBy ?? [];
  const measures = req.measures ?? [];
  if (groupBy.length > 3) throw new StoreError(5, 'Group by at most 3 fields');
  if (measures.length > 10) throw new StoreError(5, 'At most 10 measures');
  // The find enforces the account's privileges: view rules, and fields it can't see.
  const ids = store.findIds(info, { query: req.query, privileges });
  const finish = (result: SummaryResult) => { onRead?.(ids); return result; };
  const owner = info.owner;
  const pv = privileges?.in(owner);
  const table = owner.schema.tables.find((t) => t.name === info.table)!;
  // A field of the layout's table that the database can group: stored, not a summary, container or global.
  const stored = (name: string) => {
    if (name.includes('::')) return undefined;
    const f = info.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const def = f && table.fields.find((x) => x.name === f.name);
    if (!def || def.kind === 'summary' || def.type === 'container' || def.options?.global || (def.kind === 'calculation' && def.options?.unstored)) return undefined;
    return def;
  };
  const column = (name: string, numeric: boolean) => {
    const f = info.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const def = f && table.fields.find((x) => x.name === f.name);
    if (!f || !def || (pv && pv.field(info.table, def.name) === 'none')) throw new StoreError(102, `Field "${name}" is missing`);
    if (def.kind === 'summary' || def.type === 'container' || def.options?.global || (def.kind === 'calculation' && def.options?.unstored)) {
      throw new StoreError(102, `Field "${def.name}" can't be summarized here (summary, container, global or unstored calculation fields aren't)`);
    }
    const dated = !numeric && req.by && (def.type === 'date' || def.type === 'timestamp');
    return {
      name: dated ? `${def.name} by ${req.by}` : def.name,
      sql: dated ? PERIOD[req.by!](q(def.name)) : numeric && def.type === 'number' ? asNumber(q(def.name)) : q(def.name),
      text: def.type === 'text',
      period: !!dated,
    };
  };
  // Related fields (Customers::Name) and unstored calculations are worked out record by record, as FileMaker does.
  if ([...groupBy, ...measures.map((m) => m.field)].some((n) => !stored(n))) {
    if (req.by) throw new StoreError(5, `Grouping by ${req.by} works on stored date and timestamp fields of the layout's own table`);
    return finish(summarizeByRecord(store, info, ids, req, privileges, forModel));
  }
  const keys = groupBy.map((g) => column(g, false));
  const secretColumns = forModel ? table.fields.filter((f) => secretName(f.name) && f.kind !== 'summary' && !f.options?.unstored && f.type !== 'container').map((f) => q(f.name)) : [];
  if (secretColumns.length && !secretQueries.has(owner)) {
    // SQLite lower/trim/length disagree with JS on non-ASCII case, whitespace
    // and UTF-16 lengths. Use the record-output policy for SQL summaries too.
    owner.defineQueryFunction('tabularius_contains_secret', (value, secret) => Number(containsSecret(value, [secret == null ? '' : String(secret)])));
    secretQueries.add(owner);
  }
  const copiedSecret = (value: string) => secretColumns.length
    ? secretColumns.map((secret) => `tabularius_contains_secret(${value}, ${secret})`).join(' OR ')
    : '0';
  // Min, max, sum and average of a secret field are the secret itself; of another field they are left out where the value is a copy.
  const hiddenMeasure = (m: { field: string; fn: Measure }) => forModel && secretName(m.field) && m.fn !== 'count' && m.fn !== 'distinct';
  const cols = measures.map((m) => {
    if (!SQL[m.fn]) throw new StoreError(5, `Unknown measure "${m.fn}"`);
    const c = column(m.field, m.fn !== 'distinct' && m.fn !== 'count');
    const copies = forModel && m.fn !== 'count' && m.fn !== 'distinct';
    return { label: `${m.fn}(${c.name})`, hidden: hiddenMeasure(m), sql: SQL[m.fn](copies ? `(CASE WHEN ${copiedSecret(c.sql)} THEN NULL ELSE ${c.sql} END)` : c.sql) };
  });
  const select = ['count(*) AS "n"', ...cols.map((c, i) => `${c.sql} AS "m${i}"`)];
  const from = `FROM ${q(info.table)} WHERE _fm_record_id IN (SELECT value FROM json_each(?))`;
  const params: SqlValue[] = [JSON.stringify(ids)];
  const read = (row: SqlValue[], at: number) => Object.fromEntries(cols.map((c, i) => [c.label, c.hidden && row[at + i] !== null ? HIDDEN_VALUE : round(row[at + i])]));

  const total = owner.select(`SELECT ${select.join(', ')} ${from}`, params, 1).rows[0];
  const result: SummaryResult = { layout: info.name, foundCount: ids.length, totals: read(total, 1) };
  if (!keys.length) return finish(result);
  const limit = Math.min(Math.max(req.limit ?? 50, 1), 500);
  // Text groups ignore case, as FileMaker's sort and sub-summaries do ("Waterloo" and "waterloo" are one group).
  const by = keys.map((k) => (k.text ? `${k.sql} COLLATE NOCASE` : k.sql)).join(', ');
  const hidden = forModel ? keys.map((k, i) => `max(CASE WHEN ${copiedSecret(k.sql)} THEN 1 ELSE 0 END) AS "h${i}"`) : [];
  const rows = owner.select(
    `SELECT ${keys.map((k, i) => `${k.sql} AS "g${i}"`).join(', ')}, ${select.join(', ')}${hidden.length ? `, ${hidden.join(', ')}` : ''} ${from} GROUP BY ${by} ORDER BY ${keys.some((k) => k.period) ? by : req.order === 'measure' && cols.length ? `"m0" DESC, ${by}` : `"n" DESC, ${by}`}`,
    params, limit + 1,
  ).rows;
  result.groups = rows.slice(0, limit).map((r) => ({
    values: Object.fromEntries(keys.map((k, i) => [k.name, forModel && r[i] !== '' && r[i] !== null && (secretName(k.name) || Number(r[keys.length + select.length + i]) > 0) ? HIDDEN_VALUE : r[i]])),
    count: Number(r[keys.length]),
    measures: read(r, keys.length + 1),
  }));
  if (rows.length > limit) {
    result.groupCount = Number(owner.select(`SELECT count(*) FROM (SELECT 1 ${from} GROUP BY ${by})`, params, 1).rows[0][0]);
  }
  return finish(result);
}

/** A number field's value as a number; text in it ("*", "n/a") is left out, "$3,750" counts as 3750. */
const asNumber = (c: string) =>
  `(CASE WHEN typeof(${c}) IN ('integer', 'real') THEN ${c} WHEN ${c} GLOB '*[0-9]*' THEN CAST(replace(replace(trim(${c}), '$', ''), ',', '') AS REAL) END)`;

const round = (v: SqlValue) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);

/** Records summarized this way at most: each one's fields are worked out one at a time. */
const BY_RECORD_LIMIT = 5000;

/** summarizeRecords for related fields and unstored calculations: each record's values worked out, then grouped here. */
function summarizeByRecord(store: Store, info: ReturnType<Store['layout']>, ids: number[], req: SummaryRequest, privileges?: Privileges, forModel = false): SummaryResult {
  const groupBy = req.groupBy ?? [];
  const measures = req.measures ?? [];
  if (ids.length > BY_RECORD_LIMIT) {
    throw new StoreError(5, `${ids.length} records: related fields and unstored calculations are summarized one record at a time, up to ${BY_RECORD_LIMIT}. ` +
      'Narrow the find, or group by a stored field of the layout\'s own table (a key field, say).');
  }
  // Each name as a formula: a field of the layout's table, or TO::Field through the relationship graph (first related record).
  const names = [...new Set([...groupBy, ...measures.map((m) => m.field)])];
  const pv = privileges;
  for (const name of names) {
    const [to, field] = name.includes('::') ? name.split('::') : [undefined, name];
    const own = !to && info.fields.find((x) => x.name.toLowerCase() === field.toLowerCase());
    if (!to && !own) throw new StoreError(102, `Field "${name}" is missing`);
    const target = to ? store.calc.occurrence(to) : undefined;
    if (to && !target) throw new StoreError(102, `Field "${name}" is missing: there is no table occurrence "${to}"`);
    const owner = target ? store.calc.occurrenceTable(target.id) : { store: info.owner, table: info.owner.schema.tables.find((t) => t.name === info.table)! };
    const elsewhere = to && !owner ? unhostedFileOf(store, to) : undefined;
    if (elsewhere) throw new StoreError(100, `${to} is a table of ${elsewhere}, which isn't hosted here, so "${name}" can't be read`);
    const def = owner?.table.fields.find((f) => f.name.toLowerCase() === field.toLowerCase());
    if (!owner || !def) throw new StoreError(102, `Field "${name}" is missing`);
    if (def.kind === 'summary' || def.type === 'container') throw new StoreError(102, `Field "${name}" can't be summarized (summary and container fields aren't)`);
    if (pv && pv.in(owner.store).field(owner.table.name, def.name) === 'none') throw new StoreError(102, `Field "${name}" is missing`);
  }
  const secretsByRow = new WeakMap<Map<string, string>, string[]>();
  const rows = ids.map((id) => {
    const vals = store.evaluateEach(info, names, id, { account: privileges?.account, privileges });
    const row = new Map(names.map((n, i) => [n, vals[i] === undefined ? '' : asText(vals[i]!)]));
    if (forModel) secretsByRow.set(row, secretValues({ ...info.owner.row(info, id), ...Object.fromEntries(row) }));
    return row;
  });
  const num = (v: string) => {
    const n = Number(v.replace(/[$,\s]/g, ''));
    return v.trim() !== '' && Number.isFinite(n) ? n : undefined;
  };
  const measure = (group: Map<string, string>[], m: { field: string; fn: Measure }): SqlValue => {
    const hide = forModel && secretName(m.field) && m.fn !== 'count' && m.fn !== 'distinct';
    const vs = group.filter((r) => !forModel || m.fn === 'count' || m.fn === 'distinct' || !containsSecret(r.get(m.field), secretsByRow.get(r) ?? []))
      .map((r) => r.get(m.field)!).filter((v) => v !== '');
    if (hide) return vs.length ? HIDDEN_VALUE : null;
    const ns = vs.map(num).filter((n): n is number => n !== undefined);
    switch (m.fn) {
      case 'count': return vs.length;
      case 'distinct': return new Set(vs.map((v) => v.toLowerCase())).size;
      case 'sum': return round(ns.reduce((a, b) => a + b, 0));
      case 'average': return ns.length ? round(ns.reduce((a, b) => a + b, 0) / ns.length) : null;
      case 'min': return ns.length ? Math.min(...ns) : vs.sort()[0] ?? null;
      case 'max': return ns.length ? Math.max(...ns) : vs.sort().at(-1) ?? null;
    }
  };
  const label = (m: { field: string; fn: Measure }) => `${m.fn}(${m.field})`;
  const totals = Object.fromEntries(measures.map((m) => [label(m), measure(rows, m)]));
  const result: SummaryResult = { layout: info.name, foundCount: ids.length, totals };
  if (!groupBy.length) return result;
  const groups = new Map<string, Map<string, string>[]>();
  for (const r of rows) {
    const key = groupBy.map((g) => r.get(g)!.toLowerCase()).join('\0');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const limit = Math.min(Math.max(req.limit ?? 50, 1), 500);
  const first = req.order === 'measure' && measures.length ? measures[0] : undefined;
  const size = (g: Map<string, string>[]) => {
    const v = first ? measure(g, first) : g.length;
    return typeof v === 'number' ? v : -Infinity;
  };
  const sorted = [...groups.values()].sort((a, b) => size(b) - size(a));
  result.groups = sorted.slice(0, limit).map((g) => ({
    values: Object.fromEntries(groupBy.map((n) => {
      const value = g[0].get(n) || null;
      return [n, forModel && value !== null && (secretName(n) || g.some((row) => containsSecret(value, secretsByRow.get(row) ?? []))) ? HIDDEN_VALUE : value];
    })),
    count: g.length,
    measures: Object.fromEntries(measures.map((m) => [label(m), measure(g, m)])),
  }));
  if (sorted.length > limit) result.groupCount = sorted.length;
  return result;
}
