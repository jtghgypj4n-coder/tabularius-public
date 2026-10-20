// Layout performance advisor, which FileMaker doesn't have: what on a layout
// makes it slow to draw, with an estimate of the work. Check shows these with
// the linter's findings. The work is counted in record reads per screen: a
// row of a list or portal reads its record; an unstored calculation reads
// what its formula reads, each time it shows; a summary field reads the
// records it summarizes; a related total reads the related records; a portal
// filter is worked out for every related record; ExecuteSQL reads the tables
// it queries. Record counts come from the file when the caller has them
// (estimates: related records are taken as the related table's records
// shared out evenly), so the same layout can be fine on a test copy and slow
// on the real data.

import { NameTable, parse, type Node } from '../../calc/src/index.ts';
import type { Field, LayoutDesign, LayoutObject, Schema, Table } from '../../fmp12/src/index.ts';

/** Record counts, by base table id, when the caller has the data. */
export interface LayoutStats {
  records(tableId: number): number | undefined;
}

export type PerfKind = 'summary on every row' | 'related summary' | 'unstored calculation' | 'portal filter' | 'hide, tooltip or condition';

export interface PerfIssue {
  kind: PerfKind;
  objectIds: number[];
  message: string;
  /** Estimated record reads to draw it once (a screenful of rows); undefined without record counts. */
  cost?: number;
  /** Fix moves a summary field off the rows into a trailing grand summary. */
  fixable?: boolean;
}

/** This many record reads to draw a layout once is slow enough to say so. */
export const SLOW = 10_000;
/** A list or table shows about this many rows at a time. */
export const SCREEN_ROWS = 40;
/** Functions that read every related record (or every value of a repeating field). */
const AGGREGATES = new Set(['sum', 'count', 'average', 'max', 'min', 'list', 'stdev', 'stdevp', 'variance', 'variancep']);
/** How deep unstored calculations and custom functions are followed. */
const DEPTH = 6;

type Cost = { reads: number; why: Set<string> };

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * What on the layout is slow to draw, slowest first: unstored calculations,
 * summary fields and related totals on every row of a list or portal, portal
 * filters over many related records, ExecuteSQL in what shows, and
 * hide, tooltip and conditional formatting formulas that do the same.
 */
export function layoutPerformance(design: LayoutDesign, schema: Schema, stats?: LayoutStats): PerfIssue[] {
  const occurrences = new Map(schema.tableOccurrences.map((t) => [t.id, t]));
  const byName = new Map(schema.tableOccurrences.map((t) => [t.name.toLowerCase(), t]));
  const tables = new Map(schema.tables.map((t) => [t.id, t]));
  const functions = new Map((schema.customFunctions ?? []).map((c) => [c.name.toLowerCase(), c]));
  const tableOf = (toId: number | undefined): Table | undefined => {
    const to = toId === undefined ? undefined : occurrences.get(toId);
    return to && !to.dataSourceId && to.baseTableId !== undefined ? tables.get(to.baseTableId) : undefined;
  };
  const home = tableOf(design.tableOccurrenceId);
  const records = (t: Table | undefined) => (t && stats?.records(t.id)) ?? 0;
  const homeRecords = records(home);
  /** Related records per record of `from` (the layout's table unless said): the related table's records shared out (at least one). */
  const related = (t: Table | undefined, from: Table | undefined = home) => (t ? Math.max(1, Math.round(records(t) / Math.max(1, from ? records(from) : homeRecords))) : 1);
  const largest = Math.max(0, ...schema.tables.map((t) => records(t)));
  const names = new NameTable({
    fields: home?.fields.map((f) => f.name) ?? [],
    occurrences: schema.tableOccurrences.map((to) => [to.name, tableOf(to.id)?.fields.map((f) => f.name) ?? []] as [string, string[]]),
  });
  const parsed = new Map<string, Node | null>();
  const parseOnce = (text: string): Node | undefined => {
    if (!parsed.has(text)) {
      try {
        parsed.set(text, parse(text, names));
      } catch {
        parsed.set(text, null);
      }
    }
    return parsed.get(text) ?? undefined;
  };

  /** A summary over `count` records: each record read, and its summarized field worked out when that is an unstored calculation. */
  const summaryCost = (t: Table, f: Field, count: number, depth: number): Cost => {
    const source = t.fields.find((x) => x.id === f.summary?.fieldId);
    const inner = source?.kind === 'calculation' && source.options?.unstored && source.calculation
      ? formulaCost(source.calculation, source.calculationContextId ?? schema.tableOccurrences.find((o) => o.baseTableId === t.id && !o.dataSourceId)?.id, depth + 1)
      : { reads: 0, why: new Set<string>() };
    return { reads: count * (1 + inner.reads), why: inner.why };
  };

  /** The work one evaluation of a formula does, with `toId` as its context. */
  // Worked out once each: a custom function that calls itself many times per level would otherwise multiply the work.
  const memo = new Map<string, Cost>();
  const formulaCost = (text: string | undefined, toId: number | undefined, depth = 0): Cost => {
    const key = `${toId}|${depth}|${text}`;
    const known = memo.get(key);
    if (known) return known;
    const out: Cost = { reads: 0, why: new Set() };
    memo.set(key, out);
    const node = text?.trim() && depth < DEPTH ? parseOnce(text) : undefined;
    if (!node) return out;
    const context = tableOf(toId);
    const visit = (n: Node, aggregate: boolean): void => {
      switch (n.k) {
        case 'field': case 'var': {
          if (n.k === 'var' && n.name.startsWith('$')) return;
          const occurrence = n.k === 'field' && n.occurrence ? byName.get(n.occurrence.toLowerCase()) : undefined;
          if (n.k === 'field' && n.occurrence && !occurrence) return;
          const t = occurrence ? tableOf(occurrence.id) : context;
          const f = t?.fields.find((x) => x.name.toLowerCase() === n.name.toLowerCase());
          if (!t || !f) return;
          const elsewhere = !!occurrence && t !== context;
          if (f.kind === 'summary') {
            const sc = summaryCost(t, f, elsewhere ? related(t, context) : records(t), depth);
            out.reads += sc.reads;
            for (const w of sc.why) out.why.add(w);
            out.why.add(elsewhere ? `the summary field ${occurrence!.name}::${f.name} (related records)` : `the summary field ${f.name}`);
          } else if (elsewhere && aggregate) {
            out.reads += related(t, context);
            out.why.add(`a total of related ${occurrence!.name} records`);
          } else if (elsewhere) out.reads += 1;
          if (f.kind === 'calculation' && f.options?.unstored && f.calculation) {
            const inner = formulaCost(f.calculation, occurrence?.id ?? f.calculationContextId ?? toId, depth + 1);
            out.reads += inner.reads * (elsewhere && aggregate ? related(t, context) : 1);
            for (const w of inner.why) out.why.add(w);
          }
          if (n.rep) visit(n.rep, aggregate);
          return;
        }
        case 'call': {
          const name = n.name.toLowerCase();
          if (name === 'executesql') {
            out.reads += largest;
            out.why.add('ExecuteSQL');
          }
          const cf = functions.get(name);
          if (cf?.formula && cf.language !== 'javascript') {
            const inner = formulaCost(cf.formula, toId, depth + 1);
            out.reads += inner.reads;
            for (const w of inner.why) out.why.add(w);
          }
          for (const a of n.args) visit(a, aggregate || AGGREGATES.has(name));
          return;
        }
        case 'let':
          for (const [, b, rep] of n.binds) {
            visit(b, aggregate);
            if (rep) visit(rep, aggregate);
          }
          visit(n.body, aggregate);
          return;
        case 'unary': visit(n.a, aggregate); return;
        case 'bin': visit(n.a, aggregate); visit(n.b, aggregate); return;
        default:
      }
    };
    visit(node, false);
    return out;
  };

  const fieldDef = (o: LayoutObject): { table: Table; field: Field } | undefined => {
    const t = tableOf(o.field?.tableOccurrenceId);
    const f = t?.fields.find((x) => x.id === o.field!.fieldId);
    return t && f ? { table: t, field: f } : undefined;
  };

  // Rows: the body repeats once per record in list and table view (a screenful at a time).
  const list = design.view === 'list' || design.view === 'table';
  const body = design.parts.find((p) => p.kind === 'body');
  const inBody = (o: LayoutObject) => !!body && o.bounds.top >= body.top && o.bounds.top < body.top + body.height;
  const rows = (o: LayoutObject) => (list && inBody(o) ? Math.max(1, Math.min(SCREEN_ROWS, homeRecords || SCREEN_ROWS)) : 1);

  const issues: PerfIssue[] = [];
  const say = (kind: PerfKind, o: LayoutObject, perDraw: number, what: string, fix: string, fixable?: boolean) =>
    issues.push({ kind, objectIds: [o.id], message: `${what}${stats ? ` (about ${fmt(perDraw)} record reads each time the layout draws)` : ''}. ${fix}`, ...(stats ? { cost: perDraw } : {}), ...(fixable ? { fixable } : {}) });
  const reasons = (c: Cost) => [...c.why].slice(0, 2).join(' and ');
  /** Formulas on an object (hide, tooltip, conditions): `times` is how often each is worked out per draw. */
  const formulas = (o: LayoutObject, toId: number | undefined, times: number, where: string) => {
    for (const [kind, text] of [['hide formula', o.hide?.formula], ['tooltip', o.tooltip], ...(o.conditions ?? []).map((c) => ['conditional formatting', c.formula] as const)] as const) {
      const c = formulaCost(text, toId);
      if (!c.why.size) continue;
      say('hide, tooltip or condition', o, c.reads * times, `${label(o)}'s ${kind} reads ${reasons(c)} ${where}`, 'Keep such formulas to the record\'s own fields, or show the result in a field people open when they need it.');
    }
  };

  const top = new Set(design.objects);
  const walk = (objs: LayoutObject[], portal?: { o: LayoutObject; rows: number; toId: number }) => {
    for (const o of objs) {
      const times = portal ? portal.rows * rows(portal.o) : rows(o);
      const where = portal ? 'on every portal row' : times > 1 ? 'on every row' : 'each time the record shows';
      const toId = portal?.toId ?? design.tableOccurrenceId;
      const def = o.field ? fieldDef(o) : undefined;
      if (def) {
        const { table: t, field: f } = def;
        const isHome = t === home && !portal;
        if (f.kind === 'summary' && times > 1 && isHome && f.summary?.type !== 'fractionOfTotal') {
          say('summary on every row', o, times * summaryCost(t, f, records(t), 0).reads, `${label(o)} is a summary field in the body, so it shows the same total on every row`, top.has(o) ? 'Show it once, in a trailing grand summary part (Fix moves it there).' : 'Show it once, in a trailing grand summary part.', top.has(o));
        } else if (f.kind === 'summary' && !isHome) {
          say('related summary', o, times * summaryCost(t, f, related(t), 0).reads, `${label(o)} is a summary of related records, worked out ${where}`, 'With many related records, show it on a form layout rather than on every row, or keep a stored total.');
        } else if (f.kind === 'calculation' && f.options?.unstored && f.calculation) {
          const c = formulaCost(f.calculation, o.field?.tableOccurrenceId, 0);
          if (c.why.size) say('unstored calculation', o, times * c.reads, `${label(o)} is an unstored calculation that reads ${reasons(c)}, ${where}`, 'With many records, keep a stored total updated by a script or trigger, or show it on a form layout only.');
        }
      }
      formulas(o, o.field?.tableOccurrenceId ?? toId, times, where);
      if (o.kind === 'portal' && o.portal) {
        const t = tableOf(o.portal.tableOccurrenceId);
        const n = related(t);
        if (o.portal.filter?.trim()) {
          const c = formulaCost(o.portal.filter, o.portal.tableOccurrenceId);
          say('portal filter', o, times * n * (1 + c.reads), `The portal's filter is worked out for every related ${occurrences.get(o.portal.tableOccurrenceId)?.name ?? ''} record${stats ? ` (about ${fmt(n)})` : ''}, ${where}`.replace('  ', ' '), 'Match the records in the relationship instead (another match field, or a global key), so the index does the filtering.');
        }
        walk(o.children ?? [], { o, rows: Math.max(1, o.portal.rows), toId: o.portal.tableOccurrenceId });
        continue;
      }
      if (o.children) walk(o.children, portal);
    }
  };
  walk(design.objects);
  // Without record counts nothing is slow yet: keep them as advice. With them, what costs little isn't worth a word.
  return (stats ? issues.filter((i) => (i.cost ?? 0) >= SLOW / 10 || i.fixable) : issues).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
}

function label(o: LayoutObject): string {
  if (o.name) return o.name;
  if (o.field) return `${o.field.tableOccurrence ?? '?'}::${o.field.field ?? '?'}`;
  return o.kind === 'portal' ? 'The portal' : `A ${o.kind.replace(/-/g, ' ')}`;
}

/** Record counts from a store, for layoutPerformance and lintLayout (counts are kept until records change). */
export function storeStats(store: { schema: Schema; recordCount(table: string): number }): LayoutStats {
  return {
    records: (id) => {
      const t = store.schema.tables.find((x) => x.id === id);
      return t ? store.recordCount(t.name) : undefined;
    },
  };
}
