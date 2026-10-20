// Relationship graph helpers: a plain-English account of how the graph hangs
// together, the problems worth a look (occurrences nothing uses, relationships
// that repeat another, match fields that can't be indexed, missing tables or
// fields), and a tidy layout of the boxes that keeps anchor-buoy groups
// together, anchor on the left and buoys fanning out to the right.
//
// Everything here reads the schema and the solution index; nothing changes
// until the arrangement's updateOccurrence changes are applied.

import type { Field, Relationship, TableOccurrence } from '../../fmp12/src/index.ts';
import type { DesignOp, Store } from '../../store/src/index.ts';
import { solutionIndex } from './insight.ts';

export interface GraphIssue {
  rule: 'unused' | 'duplicate' | 'unindexed' | 'noAutoIndex' | 'missing';
  severity: 'warning' | 'info';
  message: string;
  occurrences: number[];
  relationship?: number;
}

export interface GraphGroup {
  /** The occurrence layouts are based on, or the busiest one. */
  anchor: number;
  occurrences: number[];
  /** Exactly one occurrence in the group has layouts, and the group is a tree: anchor-buoy. */
  anchorBuoy: boolean;
}

export interface GraphReview {
  /** Sentences describing the graph, for people and for an AI to build on. */
  summary: string[];
  groups: GraphGroup[];
  issues: GraphIssue[];
  /** updateOccurrence changes that tidy the graph (see arrangeGraph). */
  arrange: DesignOp[];
}

const BOX_W = 180;
const GAP_X = 90;
const GAP_Y = 28;
const GROUP_GAP = 70;
/** The graph tab's box: title, table name, then a row per match field. */
const boxHeight = (keys: number) => 20 + 22 + keys * 16 + (keys ? 4 : 0);

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const list = (names: string[], max = 6) => {
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  const all = more > 0 ? [...shown, `${more} more`] : shown;
  return all.length < 2 ? all.join('') : `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
};

/** Neighbours of each occurrence on the graph. */
function edges(rels: Relationship[]): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  const add = (a: number, b: number) => (out.get(a) ?? out.set(a, new Set()).get(a)!).add(b);
  for (const r of rels) {
    add(r.leftTableOccurrenceId, r.rightTableOccurrenceId);
    add(r.rightTableOccurrenceId, r.leftTableOccurrenceId);
  }
  return out;
}

/** Connected groups of occurrences, with an anchor each, biggest group first. */
export function graphGroups(tos: TableOccurrence[], rels: Relationship[], layoutCount: Map<number, number>): GraphGroup[] {
  const near = edges(rels);
  const seen = new Set<number>();
  const groups: GraphGroup[] = [];
  const byId = new Map(tos.map((t) => [t.id, t]));
  for (const t of tos) {
    if (seen.has(t.id)) continue;
    const members: number[] = [];
    const queue = [t.id];
    seen.add(t.id);
    while (queue.length) {
      const id = queue.shift()!;
      members.push(id);
      for (const n of near.get(id) ?? []) if (!seen.has(n) && byId.has(n)) seen.add(n), queue.push(n);
    }
    const score = (id: number) => [layoutCount.get(id) ?? 0, near.get(id)?.size ?? 0, -id];
    const anchor = [...members].sort((a, b) => {
      const [x, y] = [score(a), score(b)];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    })[0];
    const set = new Set(members);
    const links = rels.filter((r) => set.has(r.leftTableOccurrenceId) && set.has(r.rightTableOccurrenceId)).length;
    const withLayouts = members.filter((id) => layoutCount.get(id)).length;
    groups.push({ anchor, occurrences: members, anchorBuoy: members.length > 1 && withLayouts === 1 && links === members.length - 1 });
  }
  const name = (g: GraphGroup) => byId.get(g.anchor)?.name ?? '';
  return groups.sort((a, b) => b.occurrences.length - a.occurrences.length || name(a).localeCompare(name(b)));
}

/**
 * Places for every box: each group laid out from its anchor, one column per
 * step away from it, buoys ordered under the box they hang from so lines
 * rarely cross; groups stacked top to bottom, lone occurrences in a grid last.
 */
export function arrangeGraph(tos: TableOccurrence[], rels: Relationship[], layoutCount: Map<number, number>): { occurrence: number; graph: NonNullable<TableOccurrence['graph']> }[] {
  const near = edges(rels);
  const byId = new Map(tos.map((t) => [t.id, t]));
  const keys = new Map<number, Set<number>>();
  const key = (to: number, f: number) => (keys.get(to) ?? keys.set(to, new Set()).get(to)!).add(f);
  for (const r of rels) for (const p of r.predicates) key(r.leftTableOccurrenceId, p.leftFieldId), key(r.rightTableOccurrenceId, p.rightFieldId);
  const height = (id: number) => boxHeight(keys.get(id)?.size ?? 0);
  const out: { occurrence: number; graph: NonNullable<TableOccurrence['graph']> }[] = [];
  const place = (id: number, left: number, top: number) => out.push({ occurrence: id, graph: { left, top, width: BOX_W, height: height(id) } });

  let top = 40;
  const lone: number[] = [];
  for (const g of graphGroups(tos, rels, layoutCount)) {
    if (g.occurrences.length === 1) {
      lone.push(g.anchor);
      continue;
    }
    // Columns by distance from the anchor; each box follows the order of the box it was reached from.
    const columns: number[][] = [[g.anchor]];
    const seen = new Set([g.anchor]);
    for (let c = 0; columns[c]?.length; c++) {
      const next: number[] = [];
      for (const id of columns[c]) {
        const kids = [...(near.get(id) ?? [])].filter((n) => !seen.has(n) && byId.has(n))
          .sort((a, b) => byId.get(a)!.name.localeCompare(byId.get(b)!.name));
        for (const k of kids) seen.add(k), next.push(k);
      }
      if (next.length) columns.push(next);
    }
    const heights = columns.map((col) => col.reduce((sum, id) => sum + height(id), 0) + GAP_Y * (col.length - 1));
    const tallest = Math.max(...heights);
    columns.forEach((col, c) => {
      // Shorter columns are centred on the tallest, so the anchor sits level with its buoys.
      let y = top + Math.round((tallest - heights[c]) / 2);
      for (const id of col) {
        place(id, 40 + c * (BOX_W + GAP_X), y);
        y += height(id) + GAP_Y;
      }
    });
    top += tallest + GROUP_GAP;
  }
  lone.sort((a, b) => byId.get(a)!.name.localeCompare(byId.get(b)!.name));
  let rowH = 0;
  lone.forEach((id, i) => {
    if (i && i % 6 === 0) top += rowH + GAP_Y, rowH = 0;
    place(id, 40 + (i % 6) * (BOX_W + 40), top);
    rowH = Math.max(rowH, height(id));
  });
  return out;
}

/** Why a field can't be indexed, if it can't. */
function unindexable(f: Field): string | undefined {
  if (f.options?.global) return 'a global field';
  if (f.kind === 'summary') return 'a summary field';
  if (f.type === 'container') return 'a container field';
  if (f.kind === 'calculation' && f.options?.unstored) return 'an unstored calculation';
  return undefined;
}

export function reviewGraph(store: Store): GraphReview {
  const s = store.schema;
  const tos = s.tableOccurrences;
  const byId = new Map(tos.map((t) => [t.id, t]));
  const name = (id: number) => byId.get(id)?.name ?? `occurrence ${id}`;
  const layoutCount = new Map<number, number>();
  for (const l of s.layouts) if (l.tableOccurrenceId !== undefined) layoutCount.set(l.tableOccurrenceId, (layoutCount.get(l.tableOccurrenceId) ?? 0) + 1);
  const tableOf = (to: TableOccurrence) => (to.dataSourceId === undefined ? s.tables.find((t) => t.id === to.baseTableId) : undefined);
  const fieldOf = (to: number, field: number) => { const t = byId.get(to); return t ? tableOf(t)?.fields.find((f) => f.id === field) : undefined; };
  const issues: GraphIssue[] = [];

  // Missing tables and match fields.
  for (const to of tos) {
    if (to.dataSourceId === undefined && !tableOf(to)) issues.push({ rule: 'missing', severity: 'warning', message: `${to.name} shows a table that no longer exists (<Table Missing>).`, occurrences: [to.id] });
  }
  for (const r of s.relationships) {
    for (const p of r.predicates) {
      for (const [to, f] of [[r.leftTableOccurrenceId, p.leftFieldId], [r.rightTableOccurrenceId, p.rightFieldId]]) {
        const t = byId.get(to);
        if (t && t.dataSourceId === undefined && tableOf(t) && !fieldOf(to, f)) {
          issues.push({ rule: 'missing', severity: 'warning', message: `The relationship ${name(r.leftTableOccurrenceId)} – ${name(r.rightTableOccurrenceId)} matches on a field of ${t.name} that no longer exists, so it finds no records.`, occurrences: [r.leftTableOccurrenceId, r.rightTableOccurrenceId], relationship: r.id });
        }
      }
    }
  }

  // Match fields that can't be indexed: records on that side are found by reading every one, and
  // FileMaker itself won't look across the relationship toward that side at all.
  for (const r of s.relationships) {
    const sides = [
      { to: r.leftTableOccurrenceId, other: r.rightTableOccurrenceId, field: (p: Relationship['predicates'][number]) => p.leftFieldId },
      { to: r.rightTableOccurrenceId, other: r.leftTableOccurrenceId, field: (p: Relationship['predicates'][number]) => p.rightFieldId },
    ];
    for (const side of sides) {
      for (const p of r.predicates) {
        if (p.operator === '×') continue;
        const f = fieldOf(side.to, side.field(p));
        if (!f) continue;
        const why = unindexable(f);
        if (why) {
          issues.push({ rule: 'unindexed', severity: 'info', message: `${name(side.to)}::${f.name} is ${why}, so it can't be indexed: the relationship works from ${name(side.to)} toward ${name(side.other)}, but FileMaker Pro won't find related ${name(side.to)} records from ${name(side.other)} (here that side reads every record, which is slow on big tables). Fine if it's only used one way; otherwise match on a stored field.`, occurrences: [side.to, side.other], relationship: r.id });
        } else if (f.options?.noAutoIndex && !f.options.index) {
          issues.push({ rule: 'noAutoIndex', severity: 'info', message: `${name(side.to)}::${f.name} has indexing off and "Automatically create indexes as needed" unchecked, so FileMaker Pro won't find related ${name(side.to)} records from ${name(side.other)}. Turn on automatic indexing in its field options.`, occurrences: [side.to, side.other], relationship: r.id });
        }
      }
    }
  }

  // Relationships that repeat another in the same group: the same two tables, matched the same way.
  // Across groups that's anchor-buoy at work (each group gets its own copy), so only one group's are flagged.
  const groups = graphGroups(tos, s.relationships, layoutCount);
  const groupOf = new Map(groups.flatMap((g, i) => g.occurrences.map((id) => [id, i] as [number, number])));
  const signature = (r: Relationship) => {
    const [a, b] = [byId.get(r.leftTableOccurrenceId), byId.get(r.rightTableOccurrenceId)];
    if (!a || !b || a.dataSourceId !== undefined || b.dataSourceId !== undefined) return undefined;
    const preds = r.predicates.map((p) => `${p.leftFieldId}${p.operator}${p.rightFieldId}`).sort().join('&');
    const flip = r.predicates.map((p) => `${p.rightFieldId}${FLIP[p.operator] ?? p.operator}${p.leftFieldId}`).sort().join('&');
    const fwd = `${a.baseTableId}|${b.baseTableId}|${preds}`;
    const back = `${b.baseTableId}|${a.baseTableId}|${flip}`;
    return fwd < back ? fwd : back;
  };
  const seen = new Map<string, Relationship[]>();
  for (const r of s.relationships) {
    let k = signature(r);
    if (k) k = `${groupOf.get(r.leftTableOccurrenceId)}|${k}`;
    if (k) (seen.get(k) ?? seen.set(k, []).get(k)!).push(r);
  }
  for (const same of seen.values()) {
    if (same.length < 2) continue;
    const pairs = same.map((r) => `${name(r.leftTableOccurrenceId)} – ${name(r.rightTableOccurrenceId)}`);
    const tables = [byId.get(same[0].leftTableOccurrenceId)!, byId.get(same[0].rightTableOccurrenceId)!].map((t) => tableOf(t)?.name ?? '?');
    issues.push({ rule: 'duplicate', severity: 'info', message: `${list(pairs)} ${same.length === 2 ? 'both' : 'all'} relate ${tables[0]} to ${tables[1]} the same way in one group, so the same records can be reached two ways; one of them is probably redundant.`, occurrences: [...new Set(same.flatMap((r) => [r.leftTableOccurrenceId, r.rightTableOccurrenceId]))], relationship: same[1].id });
  }

  // Occurrences nothing uses. One that only joins two used ones still matters, so only loose ends
  // are dropped: unused occurrences with one link or none, repeatedly, as a chain of them unwinds.
  const used = new Set<number>(layoutCount.keys());
  const lowerId = new Map(tos.map((t) => [t.name.toLowerCase(), t.id]));
  for (const site of solutionIndex(store).sites) {
    if (site.kind === 'relationship') continue;
    for (const o of site.refs.occurrences) { const id = lowerId.get(o); if (id !== undefined) used.add(id); }
  }
  for (const t of s.tables) for (const f of t.fields) if (f.calculationContextId !== undefined && f.calculation) used.add(f.calculationContextId);
  for (const vl of s.valueLists) if (vl.field) used.add(vl.field.occurrenceId), vl.field.relatedFromId !== undefined && used.add(vl.field.relatedFromId);
  const near = edges(s.relationships);
  const live = new Set(tos.map((t) => t.id));
  const loose: number[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const id of live) {
      if (used.has(id)) continue;
      const links = [...(near.get(id) ?? [])].filter((n) => live.has(n)).length;
      if (links <= 1) live.delete(id), loose.push(id), changed = true;
    }
  }
  for (const id of loose) {
    const links = near.get(id)?.size ?? 0;
    issues.push({ rule: 'unused', severity: 'info', message: `Nothing uses ${name(id)}: no layout, portal, field, script, value list or formula${links ? ', and nothing used reaches anything through it' : ', and it isn\'t related to anything'}. Deleting it would tidy the graph.`, occurrences: [id] });
  }

  const summary: string[] = [];
  const tables = new Set(tos.map((t) => (t.dataSourceId === undefined ? `t${t.baseTableId}` : `d${t.dataSourceId}:${t.baseTableId}`)));
  const real = groups.filter((g) => g.occurrences.length > 1);
  const lone = groups.length - real.length;
  if (!s.relationships.length) summary.push(`The graph has ${plural(tos.length, 'table occurrence')} of ${plural(tables.size, 'table')} and no relationships.`);
  else summary.push(`The graph has ${plural(tos.length, 'table occurrence')} of ${plural(tables.size, 'table')}, joined by ${plural(s.relationships.length, 'relationship')} into ${plural(real.length, 'group')}${lone ? `, plus ${plural(lone, 'occurrence')} on ${lone === 1 ? 'its' : 'their'} own` : ''}.`);
  const ab = real.filter((g) => g.anchorBuoy).length;
  if (real.length && ab === real.length) summary.push('It follows anchor-buoy: in every group, layouts are based on one occurrence (the anchor) and the others hang off it without loops.');
  else if (ab) summary.push(`${plural(ab, 'group')} of ${real.length} follow${ab === 1 ? 's' : ''} anchor-buoy (layouts on one occurrence, the others hanging off it); the rest have layouts on several occurrences or more than one path between them.`);
  for (const g of real.slice(0, 8)) {
    const n = layoutCount.get(g.anchor) ?? 0;
    const others = g.occurrences.filter((id) => id !== g.anchor).map(name);
    const onLayouts = g.occurrences.filter((id) => id !== g.anchor && layoutCount.get(id)).map(name);
    summary.push(`${name(g.anchor)}${n ? ` (${plural(n, 'layout')})` : ''} reaches ${list(others)}${onLayouts.length ? `; ${list(onLayouts)} also ${onLayouts.length === 1 ? 'has' : 'have'} layouts` : ''}.`);
  }
  if (real.length > 8) summary.push(`${plural(real.length - 8, 'smaller group')} not described here.`);
  const copies = new Map<string, string[]>();
  for (const t of tos) { const base = tableOf(t)?.name; if (base) (copies.get(base) ?? copies.set(base, []).get(base)!).push(t.name); }
  const busy = [...copies.entries()].filter(([, v]) => v.length > 2).sort((a, b) => b[1].length - a[1].length).slice(0, 4);
  if (busy.length) summary.push(`Most-used tables: ${busy.map(([t, v]) => `${t} appears ${v.length} times`).join('; ')}.`);
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  summary.push(issues.length ? `${plural(issues.length, 'thing')} worth a look${warnings ? `, ${plural(warnings, 'warning')}` : ''}.` : 'Nothing looks wrong.');

  const arrange = arrangeGraph(tos, s.relationships, layoutCount)
    .filter((a) => { const g = byId.get(a.occurrence)?.graph; return !g || g.left !== a.graph.left || g.top !== a.graph.top || g.width !== a.graph.width; })
    .map((a) => ({ op: 'updateOccurrence', occurrence: a.occurrence, graph: a.graph }) as unknown as DesignOp);
  return { summary, groups, issues, arrange };
}

const FLIP: Record<string, string> = { '<': '>', '>': '<', '≤': '≥', '≥': '≤' };
