// Slow finds and what would speed them up: the profiler's timings of finds (by table, the fields searched and the
// sort), with an index to add where a stored field has none, and plain-English hints where no index can help (a
// field worked out each time, a criterion that starts with a wildcard). FileMaker indexes fields for you and never
// says why a find is slow; here the person sees which finds cost time and adds an index with one click. Indexes
// are Tabularius's own SQLite indexes: the file's design doesn't change.

import type { Field, Table } from '../../fmp12/src/index.ts';
import type { Store } from '../../store/src/index.ts';
import type { Profiler } from './profiler.ts';

/** A find shape is worth a look from this average (or this longest run). */
const SLOW_AVERAGE_MS = 50;
const SLOW_MAX_MS = 250;

export interface IndexSuggestion {
  kind: 'index';
  table: string;
  field: string;
  why: string;
}
export interface FindHint {
  kind: 'hint';
  text: string;
}

export interface FindAdvice {
  file: string;
  table: string;
  layout: string;
  fields: string[];
  sort: string[];
  count: number;
  averageMs: number;
  maxMs: number;
  totalMs: number;
  records: number;
  /** One sentence on what is slow. */
  summary: string;
  suggestions: (IndexSuggestion | FindHint)[];
}

type Report = ReturnType<Profiler['findReport']>;

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function resolve(store: Store, table: string, name: string): { table: Table; field: Field } | undefined {
  if (name.includes('::')) {
    const [to, f] = [name.slice(0, name.indexOf('::')), name.slice(name.indexOf('::') + 2)];
    const occ = store.schema.tableOccurrences.find((o) => o.name.toLowerCase() === to.toLowerCase() && !o.dataSourceId);
    const t = occ && store.schema.tables.find((x) => x.id === occ.baseTableId);
    const field = t?.fields.find((x) => x.name.toLowerCase() === f.replace(/\(\d+\)$/, '').toLowerCase());
    return t && field ? { table: t, field } : undefined;
  }
  const t = store.schema.tables.find((x) => x.name === table);
  const field = t?.fields.find((x) => x.name.toLowerCase() === name.replace(/\(\d+\)$/, '').toLowerCase());
  return t && field ? { table: t, field } : undefined;
}

function notStored(f: Field): string | undefined {
  if (f.kind === 'summary') return 'a summary field, worked out over the found set';
  if (f.options?.global) return 'a global field';
  if (f.kind === 'calculation' && f.options?.unstored) return 'an unstored calculation, worked out on every record each time';
  if (f.type === 'container') return 'a container field';
  return undefined;
}

/** Advice for the slow finds of `report`, slowest in total first; `file` narrows it to one hosted file. */
export function findAdvice(getStore: (name: string) => Store | undefined, report: Report, opts: { file?: string; all?: boolean } = {}): FindAdvice[] {
  const out: FindAdvice[] = [];
  for (const r of report) {
    if (opts.file && r.file.toLowerCase() !== opts.file.toLowerCase()) continue;
    if (!opts.all && r.averageMs < SLOW_AVERAGE_MS && r.maxMs < SLOW_MAX_MS) continue;
    const store = getStore(r.file);
    if (!store) continue;
    const suggestions: (IndexSuggestion | FindHint)[] = [];
    const seen = new Set<string>();
    const indexed = new Map<string, Set<string>>();
    const has = (t: string, f: string) => {
      if (!indexed.has(t)) indexed.set(t, store.indexedFields(t));
      return indexed.get(t)!.has(f);
    };
    const what = [...r.fields.map((f) => ({ name: f, sort: false })), ...r.sort.map((f) => ({ name: f, sort: true }))];
    for (const w of what) {
      const hit = resolve(store, r.table, w.name);
      if (!hit) continue;
      const key = `${hit.table.name}::${hit.field.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const why = notStored(hit.field);
      if (why) {
        suggestions.push({ kind: 'hint', text: `${key} is ${why}, so ${w.sort ? 'sorting' : 'finding'} on it reads every record and no index can help. ` +
          (hit.field.kind === 'calculation' ? 'If it doesn\'t read related records or the current time, make it a stored calculation and it can be indexed.' : 'Find or sort on a stored field instead where you can.') });
        continue;
      }
      if (has(hit.table.name, hit.field.name)) continue;
      suggestions.push({
        kind: 'index', table: hit.table.name, field: hit.field.name,
        why: `An index on ${key} lets ${w.sort ? 'sorts' : 'finds'} on it skip reading all ${plural(store.recordCount(hit.table.name), 'record')}` +
          (hit.field.type === 'text' && !w.sort ? ' (it helps exact matches (==), ranges and "begins with"; word finds already use the word index)' : '') + '.',
      });
    }
    if (r.leadingWildcard) {
      suggestions.push({ kind: 'hint', text: `${plural(r.leadingWildcard, 'of these finds', 'of these finds')} started a criterion with *, which reads every record whatever the indexes. ` +
        'FileMaker-style finds already match the start of each word, so "smith" finds "John Smith" without the *.' });
    }
    const by = r.fields.length ? `by ${r.fields.join(', ')}` : '';
    const sorted = r.sort.length ? `${by ? ', ' : ''}sorted by ${r.sort.join(', ')}` : '';
    out.push({
      file: r.file, table: r.table, layout: r.layout, fields: r.fields, sort: r.sort, count: r.count,
      averageMs: r.averageMs, maxMs: r.maxMs, totalMs: r.totalMs, records: r.total,
      summary: `Finds in ${r.table} ${by}${sorted} took ${ms(r.averageMs)} on average (longest ${ms(r.maxMs)}) over ${plural(r.count, 'find')}, on ${plural(r.total, 'record')}.`,
      suggestions,
    });
  }
  return out;
}
