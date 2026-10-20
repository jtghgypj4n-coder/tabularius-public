// OData $apply (the Data Aggregation extension), so Excel, Power BI and other
// clients can ask for totals and groups instead of reading every record:
//
//   $apply=filter(Total gt 100)/groupby((Customer,Status),aggregate(Total with sum as Sum,$count as Orders))
//   $apply=aggregate(Total with average as Mean)
//
// filter(...) steps come first (they narrow the records, like $filter), then
// one groupby or aggregate. Methods: sum, min, max, average, countdistinct,
// and "$count as Name" for the number of records. $filter, $orderby, $top,
// $skip and $count then apply to the rows $apply gives, as the spec has it.
// Only stored fields can be grouped or aggregated, as only they can be
// filtered on; records and fields the account can't see aren't counted.

import { ApiError } from './dataapi.ts';

export interface ApplyProp { name: string; field: string; type: string; queryable: boolean }

export type Method = 'sum' | 'min' | 'max' | 'average' | 'countdistinct' | 'count';

export interface Aggregate {
  alias: string;
  method: Method;
  /** The aggregated property; none for $count. */
  prop?: ApplyProp;
}

export interface Apply {
  /** filter(...) expressions, in order: all must hold. */
  filters: string[];
  groupBy: ApplyProp[];
  aggregates: Aggregate[];
}

const METHODS = new Set(['sum', 'min', 'max', 'average', 'countdistinct']);

const bad = (message: string) => new ApiError(8310, `$apply: ${message}`, 400);

/** Splits at `sep` outside parentheses and quoted strings. */
function split(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
    if (depth < 0) throw bad('a ")" has no "("');
  }
  if (quoted) throw bad('a string is not closed');
  if (depth !== 0) throw bad('a "(" is not closed');
  out.push(text.slice(start));
  return out.map((x) => x.trim());
}

/** "name(inner)" as [name, inner]. */
function callOf(text: string): [string, string] | undefined {
  const m = /^([A-Za-z]+)\s*\(([\s\S]*)\)$/.exec(text);
  return m ? [m[1].toLowerCase(), m[2]] : undefined;
}

export function parseApply(text: string, props: ApplyProp[]): Apply {
  if (!text.trim()) throw bad('it is empty');
  const out: Apply = { filters: [], groupBy: [], aggregates: [] };
  let shaped = false;
  const prop = (name: string, what: string) => {
    const p = props.find((x) => x.name === name) ?? props.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!p) throw bad(`there is no property "${name}"`);
    if (!p.queryable) throw bad(`${p.name} is not stored (a global, unstored calculation, repeating or container field), so it can't be ${what}`);
    return p;
  };
  const taken = new Set<string>();
  const aggregates = (inner: string) => {
    for (const part of split(inner, ',')) {
      const count = /^\$count\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(part);
      const m = count ? undefined : /^([\p{L}_][\p{L}\p{N}_]*)\s+with\s+([a-z]+)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/iu.exec(part);
      if (!count && !m) throw bad(`"${part}" is not "Property with method as Name" or "$count as Name"`);
      const alias = (count ?? m!)[count ? 1 : 3];
      if (taken.has(alias.toLowerCase())) throw bad(`"${alias}" is used twice`);
      taken.add(alias.toLowerCase());
      if (count) {
        out.aggregates.push({ alias, method: 'count' });
        continue;
      }
      const method = m![2].toLowerCase();
      if (!METHODS.has(method)) throw bad(`"${m![2]}" is not sum, min, max, average or countdistinct`);
      const p = prop(m![1], 'aggregated');
      if ((method === 'sum' || method === 'average') && p.type !== 'number' && p.type !== 'integer' && p.type !== 'decimal') throw bad(`${p.name} is not a number, so it has no ${method}`);
      out.aggregates.push({ alias, method: method as Method, prop: p });
    }
  };
  for (const step of split(text, '/')) {
    const call = callOf(step);
    if (!call) throw bad(`"${step}" is not filter(...), groupby(...) or aggregate(...)`);
    const [name, inner] = call;
    if (shaped) throw new ApiError(3, '$apply: only filter() steps before one groupby() or aggregate() are supported', 501);
    if (name === 'filter') {
      if (!inner.trim()) throw bad('filter() is empty');
      out.filters.push(inner);
    } else if (name === 'aggregate') {
      aggregates(inner);
      shaped = true;
    } else if (name === 'groupby') {
      const [list, ...rest] = split(inner, ',');
      const names = /^\(([\s\S]*)\)$/.exec(list ?? '');
      if (!names || !names[1].trim()) throw bad('groupby takes a list of properties in parentheses: groupby((A,B))');
      for (const n of split(names[1], ',')) {
        const p = prop(n, 'grouped');
        if (out.groupBy.includes(p)) throw bad(`${p.name} is grouped twice`);
        if (taken.has(p.name.toLowerCase())) throw bad(`"${p.name}" is used twice`);
        taken.add(p.name.toLowerCase());
        out.groupBy.push(p);
      }
      if (rest.length) {
        const agg = rest.length === 1 ? callOf(rest[0]) : undefined;
        if (!agg || agg[0] !== 'aggregate') throw bad('groupby takes its properties and, optionally, aggregate(...)');
        aggregates(agg[1]);
      }
      shaped = true;
    } else throw new ApiError(3, `$apply: ${name}() is not supported (filter, groupby and aggregate are)`, 501);
  }
  if (!shaped) throw bad('end it with groupby(...) or aggregate(...)');
  return out;
}

/** The type of an aggregate's value, as the property types go. */
export function aggregateType(a: Aggregate): string {
  return a.method === 'min' || a.method === 'max' || ((a.method === 'sum' || a.method === 'average') && a.prop?.type === 'decimal') ? a.prop!.type : 'number';
}

/** The SQL that works out an aggregate over the column `col` holds. */
export function aggregateSql(a: Aggregate, col: string): string {
  switch (a.method) {
    case 'count': return 'COUNT(*)';
    case 'sum': return `SUM(${col})`;
    case 'average': return `AVG(${col})`;
    case 'min':
    case 'max': {
      if (a.prop?.type !== 'decimal') return `${a.method.toUpperCase()}(${col})`;
      const pair = `${a.method.toUpperCase()}(fm_decimal_key(${col}) || '|' || ${col})`;
      return `SUBSTR(${pair}, INSTR(${pair}, '|') + 1)`;
    }
    case 'countdistinct': return `COUNT(DISTINCT ${col})`;
  }
}
