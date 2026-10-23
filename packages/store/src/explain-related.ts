// Explaining what a portal or related field shows: the relationship path that
// was followed, the match fields and their values on both sides, the portal's
// filter and sort, and why each related record is in or out. FileMaker has no
// answer to "why is this portal empty?" short of trial and error.

import { rethrowExecutionRefusal } from '../../calc/src/execution-refusal.ts';
import { asBoolean, asText, CalcError, compile, evaluate as evaluateFormula, explainEvaluation, type Step } from '../../calc/src/index.ts';
import type { Field, JoinPredicate } from '../../fmp12/src/index.ts';
import type { Rec, Row } from './calc.ts';
import type { SqlValue } from './find.ts';
import { q } from './import.ts';
import { condition, keyValue, keys, occurrence, occurrenceByName, relationPath, type Hop, type Occurrence } from './related.ts';
import type { Privileges } from './privileges.ts';
import type { LayoutInfo, LayoutPlan, Store } from './store.ts';

export interface MatchExplanation {
  /** "Orders::Id = Order lines::OrderId", as the relationship reads from this side. */
  match: string;
  /** The values on this side: the record's own, or (after the first hop) those of the records reached so far. */
  values: SqlValue[];
  /** More distinct values than listed. */
  moreValues?: number;
  /** Records on the far side this match field finds by itself (the first hop only). */
  matches?: number;
  /** Something about this pair that stops it matching. */
  problem?: string;
}

export interface HopExplanation {
  relationship: string;
  from: string;
  to: string;
  match: MatchExplanation[];
  /** Records reached through this hop. */
  records: number;
}

export interface RowExplanation {
  recordId: number;
  shown: boolean;
  /** Its place in the portal after the filter and sort (1 = first). */
  position?: number;
  /** The far side's match field values, by "TO::Field". */
  keys: Record<string, SqlValue>;
  /** What the portal filter gave for this row. */
  filter?: string;
  reason: string;
}

export interface CandidateExplanation {
  recordId: number;
  exists: boolean;
  related: boolean;
  shown: boolean;
  /** Each match on the last hop, checked against this record. */
  checks: { match: string; value: SqlValue; ok: boolean }[];
  /** The portal filter evaluated on it, step by step. */
  filter?: { value?: string; error?: string; steps?: Step };
  reason: string;
}

export interface RelatedExplanation {
  kind: 'portal' | 'related field';
  from: { occurrence: string; table: string; recordId: number };
  to: { occurrence: string; table: string; file?: string };
  path: HopExplanation[];
  /** Records the relationship finds, before any portal filter. */
  related: number;
  portal?: { name: string; filter?: string; sort?: string[]; shown: number; filteredOut: number };
  /** For a related field: the record whose value it shows, and the value. */
  field?: { name: string; recordId?: number; value?: string };
  rows: RowExplanation[];
  /** More related records than listed. */
  moreRows?: number;
  candidate?: CandidateExplanation;
  /** One plain sentence: why it shows what it shows. */
  verdict: string;
  notes: string[];
}

export class ExplainRelatedError extends Error {}

/** Most explanations stop following records here. */
const MAX_ROWS = 10000;
const show = (v: SqlValue) => (v === null || v === '' ? 'empty' : JSON.stringify(typeof v === 'string' ? v.replace(/\n/g, '¶') : v));

/**
 * Explain a portal (by name or table occurrence) or a related field
 * ("TO::Field") on one record of a layout. `store` is the layout's file: its
 * relationship graph applies. `candidate` names a record of the far table to
 * ask "why isn't it here?".
 */
export function explainRelated(
  store: Store, info: LayoutInfo, recordId: number,
  target: { portal?: string; field?: string },
  opts: { candidate?: number; limit?: number; privileges?: Privileges } = {},
): RelatedExplanation {
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
  const fromTo = occurrenceByName(store, info.occurrence);
  if (!fromTo) throw new ExplainRelatedError(`Table occurrence "${info.occurrence}" is missing`);
  const home = occurrence(store, fromTo.id);
  if (!home) throw new ExplainRelatedError(`The table behind "${info.occurrence}" isn't available`);
  const row = info.owner.row(info, recordId) as Record<string, SqlValue>;

  // Which occurrence: the portal's, or the related field's.
  let portal: LayoutPlan['portals'][number] | undefined;
  let fieldName: string | undefined;
  let toName: string;
  if (target.field) {
    const i = target.field.indexOf('::');
    if (i < 0) throw new ExplainRelatedError('Name the related field as TableOccurrence::Field');
    toName = target.field.slice(0, i);
    fieldName = target.field.slice(i + 2);
  } else if (target.portal) {
    const want = target.portal.toLowerCase();
    portal = info.plan?.portals.find((p) => p.name.toLowerCase() === want) ?? info.plan?.portals.find((p) => p.occurrence.toLowerCase() === want);
    toName = portal?.occurrence ?? target.portal;
    if (!portal && info.plan?.portals.length) {
      // A table occurrence that isn't a portal here is still worth explaining, as a plain relationship.
      if (!occurrenceByName(store, toName)) throw new ExplainRelatedError(`"${info.name}" has no portal named "${target.portal}"; its portals are ${info.plan.portals.map((p) => `"${p.name}"`).join(', ')}`);
    }
  } else throw new ExplainRelatedError('Name a portal or a related field (TableOccurrence::Field)');
  const toTo = store.schema.tableOccurrences.find((t) => t.name.toLowerCase() === toName.toLowerCase());
  if (!toTo) throw new ExplainRelatedError(`There is no table occurrence named "${toName}"`);

  const notes: string[] = [];
  const out: RelatedExplanation = {
    kind: fieldName ? 'related field' : 'portal',
    from: { occurrence: fromTo.name, table: home.table.name, recordId },
    to: { occurrence: toTo.name, table: '' },
    path: [], related: 0, rows: [], verdict: '', notes,
  };
  // A table in another hosted file is explained only to an account that reads everything there: its rows, keys and counts are that file's.
  const hosted = (o: Occurrence | undefined) => (o && opts.privileges && o.store !== store && !opts.privileges.in(o.store).readsEverything ? undefined : o);
  const far = hosted(occurrence(store, toTo.id));
  if (!far) {
    const ds = toTo.dataSourceId !== undefined ? store.schema.dataSources.find((d) => d.id === toTo.dataSourceId) : undefined;
    out.verdict = ds
      ? `Empty: "${toTo.name}" is a table in another file (${ds.name}) that isn't hosted here, so there's nothing to show`
      : `Empty: the table behind "${toTo.name}" is missing`;
    return out;
  }
  out.to.table = far.table.name;
  if (far.store !== store) out.to.file = far.store.name;
  const path = relationPath(store.schema, fromTo.id, toTo.id);
  if (!path) {
    out.verdict = `Empty: "${fromTo.name}" and "${toTo.name}" aren't connected in the relationship graph, so FileMaker shows nothing (and a related field stays empty)`;
    return out;
  }
  if (fieldName && !far.table.fields.some((f) => f.name.toLowerCase() === fieldName!.toLowerCase())) {
    throw new ExplainRelatedError(`${far.table.name} has no field named "${fieldName}"`);
  }

  // Walk the path, explaining each hop.
  let from = home;
  let rows: Record<string, SqlValue>[] = [row];
  let stop: string | undefined;
  for (let h = 0; h < path.length; h++) {
    const hop = path[h];
    const next = hosted(occurrence(store, hop.forward ? hop.rel.rightTableOccurrenceId : hop.rel.leftTableOccurrenceId));
    if (!next) {
      stop = 'a table occurrence on the way is in a file that isn\'t hosted here';
      break;
    }
    const he = explainHop(hop, from, next, rows, h === 0, notes);
    out.path.push(he.explanation);
    rows = he.rows;
    if (!rows.length && !stop) stop = he.why;
    from = next;
  }
  out.related = rows.length;
  if (rows.length >= MAX_ROWS) notes.push(`Stopped counting at ${MAX_ROWS} related records`);
  const last = path.at(-1);
  if (last?.rel.sorted) notes.push('The relationship sorts its records; that order isn\'t decoded yet, so records here are in creation order (a related field shows the first one)');
  if (path.length > 1) notes.push(`The path goes through ${path.length} relationships; a record is related when it is reached from any record found by the hop before`);

  // The portal's filter and sort, and the order it shows rows in.
  const filterOf = portal?.filter;
  const formulaPass = store.calc.newPass(opts.privileges?.account, opts.privileges);
  const recOf = (r: Record<string, SqlValue>): Rec => ({ store: far.store, table: far.table, row: r as Row });
  const runFilter = (r: Record<string, SqlValue>): { shown: boolean; text: string } => {
    try {
      const v = evaluateFormula(filterOf!, store.calc.context(recOf(r), far.to.id, formulaPass));
      return { shown: asBoolean(v), text: asText(v, store.dateOrder) };
    } catch (e) {
      rethrowExecutionRefusal(e);
      return { shown: false, text: e instanceof CalcError ? `error ${e.code}: ${e.message}` : 'error' };
    }
  };
  let order: number[] | undefined;
  if (portal && rows.length) {
    try {
      const rec = store.get(info, recordId, 'iso', { [portal.name]: { offset: 1, limit: MAX_ROWS } }, undefined, { summaries: false });
      order = (rec.portalData?.[portal.name] ?? []).map((r) => Number(r.recordId));
    } catch (e) {
      rethrowExecutionRefusal(e);
      order = undefined;
    }
  }
  const filtered = filterOf ? rows.map((r) => runFilter(r)) : undefined;
  const shownCount = filtered ? filtered.filter((f) => f.shown).length : rows.length;
  if (portal) {
    out.portal = {
      name: portal.name, shown: shownCount, filteredOut: rows.length - shownCount,
      ...(filterOf ? { filter: filterOf } : {}),
      ...(portal.sort?.length ? { sort: portal.sort.map((s) => `${s.field} ${s.descending ? 'descending' : 'ascending'}${s.order ? ' (custom order)' : ''}`) } : {}),
    };
  }

  // The far side's match fields, to show on each row.
  const farKeys = last ? matchPairs(last, path.length > 1 ? undefined : home, far).map((m) => m.to).filter((f): f is Field => !!f) : [];
  const describe = (r: Record<string, SqlValue>, i: number): RowExplanation => {
    const id = Number(r._fm_record_id);
    const k: Record<string, SqlValue> = {};
    for (const f of farKeys) k[`${far.to.name}::${f.name}`] = r[f.name] ?? null;
    const f = filtered?.[i];
    const pos = order ? order.indexOf(id) : -1;
    const shown = f ? f.shown : true;
    const through = path.length > 1 ? 'reached through the relationships' : 'its match fields match this record';
    return {
      recordId: id, shown, ...(pos >= 0 ? { position: pos + 1 } : {}), keys: k,
      ...(f ? { filter: f.text } : {}),
      reason: !f ? `Shown: ${through}` : f.shown ? `Shown: ${through} and the portal filter gives ${JSON.stringify(f.text)}` : `Hidden by the portal filter, which gives ${JSON.stringify(f.text)}${/^error/.test(f.text) ? '' : ' (not true)'}`,
    };
  };
  let listed = rows.map((r, i) => [r, i] as const);
  if (order) listed.sort(([a], [b]) => rank(order!, a) - rank(order!, b));
  if (listed.length > limit) {
    out.moreRows = listed.length - limit;
    listed = listed.slice(0, limit);
  }
  out.rows = listed.map(([r, i]) => describe(r, i));

  // A related field shows the first related record's value.
  if (fieldName) {
    const f = far.table.fields.find((x) => x.name.toLowerCase() === fieldName!.toLowerCase())!;
    const first = rows[0];
    out.field = { name: `${far.to.name}::${f.name}` };
    if (first) {
      out.field.recordId = Number(first._fm_record_id);
      try {
        out.field.value = asText(far.store.calc.value(recOf(first), f), far.store.dateOrder);
      } catch (e) {
        rethrowExecutionRefusal(e);
        out.field.value = e instanceof CalcError ? '?' : '';
      }
    }
  }

  if (opts.candidate !== undefined) out.candidate = explainCandidate(store, far, path, home, row, opts.candidate, rows, filterOf, order, store.calc.context.bind(store.calc), opts.privileges);

  // The verdict.
  const where = portal ? `the portal "${portal.name}"` : fieldName ? out.field!.name : `"${toTo.name}"`;
  if (!rows.length) out.verdict = `${fieldName ? `${where} is empty` : `${capital(where)} is empty`}: ${stop ?? 'no record matches'}`;
  else if (fieldName) out.verdict = `${where} shows record ${out.field!.recordId}, the first of ${rows.length} related record${rows.length === 1 ? '' : 's'}${out.field!.value !== undefined ? `: ${JSON.stringify(out.field!.value)}` : ''}`;
  else if (filterOf && !shownCount) out.verdict = `${capital(where)} is empty: the relationship finds ${rows.length} record${rows.length === 1 ? '' : 's'}, and the portal filter hides every one`;
  else out.verdict = `${capital(where)} shows ${shownCount} of ${rows.length} related record${rows.length === 1 ? '' : 's'}${filterOf ? ` (the filter hides ${rows.length - shownCount})` : ''}`;
  return out;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rank = (order: number[], r: Record<string, SqlValue>) => {
  const i = order.indexOf(Number(r._fm_record_id));
  return i < 0 ? order.length + Number(r._fm_record_id) : i;
};

const OPS_FLIP: Record<string, string> = { '<': '>', '≤': '≥', '>': '<', '≥': '≤' };

interface Pair { p: JoinPredicate; from?: Field; to?: Field; op: string }

/** The hop's predicates as seen walking it: this side's field, the operator, the far side's field. */
function matchPairs(hop: Hop, from: Occurrence | undefined, to: Occurrence): Pair[] {
  return hop.rel.predicates.map((p) => {
    const [a, b] = hop.forward ? [p.leftFieldId, p.rightFieldId] : [p.rightFieldId, p.leftFieldId];
    const op = hop.forward ? p.operator : OPS_FLIP[p.operator] ?? p.operator;
    return { p, from: from?.table.fields.find((f) => f.id === a), to: to.table.fields.find((f) => f.id === b), op };
  });
}

const isUnstored = (f: Field) => f.kind === 'calculation' && !!f.options?.unstored;

function explainHop(hop: Hop, from: Occurrence, to: Occurrence, rows: Record<string, SqlValue>[], first: boolean, notes: string[]) {
  const pairs = matchPairs(hop, from, to);
  const text = (x: Pair) => `${from.to.name}::${x.from?.name ?? '?'} ${x.op} ${to.to.name}::${x.to?.name ?? '?'}`;
  const match: MatchExplanation[] = [];
  let why: string | undefined;
  for (const x of pairs) {
    const m: MatchExplanation = { match: text(x), values: [] };
    match.push(m);
    if (x.op === '×') {
      m.match = `${from.to.name} × ${to.to.name}`;
      notes.push(`${m.match} matches every record on both sides (a cartesian join)`);
      continue;
    }
    if (!x.from || !x.to) {
      m.problem = 'A field in this match is missing';
      why ??= `the relationship refers to a field that is missing (${m.match})`;
      continue;
    }
    const all = new Set<SqlValue>();
    for (const r of rows) for (const v of keys(keyValue(from, x.from, r))) {
      all.add(v);
      if (all.size > 50) break;
    }
    const vals = [...all];
    m.values = vals.slice(0, 10);
    if (vals.length > 10) m.moreValues = vals.length - 10;
    if (x.from.type === 'container') m.problem = 'Container fields can\'t be match fields';
    else if (x.to.options?.global) m.problem = `${to.to.name}::${x.to.name} is a global field on the side being matched: FileMaker can only use a global on the side a relationship starts from, so this relationship can't match`;
    else if (isUnstored(x.to)) m.problem = `${to.to.name}::${x.to.name} is an unstored calculation on the side being matched: it can't be indexed, so this relationship can't match`;
    else if (x.to.type === 'container') m.problem = 'Container fields can\'t be match fields';
    if (m.problem) why ??= m.problem.startsWith('Container') ? 'container fields can\'t be match fields' : m.problem;
    if (!vals.length) {
      const whose = first ? 'on this record' : `on all ${rows.length} ${from.to.name} record${rows.length === 1 ? '' : 's'} reached so far`;
      m.problem ??= `${from.to.name}::${x.from.name} is empty ${whose}; empty match fields never match`;
      why ??= `${from.to.name}::${x.from.name} is empty ${whose}, and empty match fields never match anything`;
      continue;
    }
    if (first && rows.length === 1 && !m.problem) {
      const c = condition({ rel: { ...hop.rel, predicates: [x.p] }, forward: hop.forward }, from, to, rows[0]);
      if (c) m.matches = (to.store.sql.prepare(`SELECT count(*) AS n FROM ${q(to.table.name)} WHERE ${c.where}`).get(...c.params) as { n: number }).n;
    }
    if (x.from.type !== x.to.type && x.op === '=' && x.from.type !== 'unknown' && x.to.type !== 'unknown') {
      notes.push(`${m.match} compares a ${x.from.type} field with a ${x.to.type} field; values match only when they read the same as ${x.to.type}s`);
    }
  }

  // The records the whole hop reaches (all its matches together).
  const found = new Map<number, Record<string, SqlValue>>();
  // A missing, global, unstored or container match field can't find anything.
  if (!match.some((m) => m.problem)) {
    for (const r of rows) {
      const c = condition(hop, from, to, r);
      if (!c) continue;
      for (const x of to.store.sql.prepare(`SELECT * FROM ${q(to.table.name)} WHERE ${c.where} ORDER BY _fm_record_id LIMIT ?`).all(...c.params, MAX_ROWS) as Record<string, SqlValue>[]) {
        found.set(Number(x._fm_record_id), x);
      }
      if (found.size >= MAX_ROWS) break;
    }
  }
  if (!found.size && !why) {
    const real = match.filter((m, i) => pairs[i].op !== '×');
    const none = real.find((m) => m.matches === 0);
    if (none) why = `no ${to.to.name} record matches ${none.match} with ${none.values.map(show).join(' or ')}`;
    else if (real.length > 1 && real.every((m) => m.matches !== undefined)) {
      why = `each match finds records on its own (${real.map((m) => `${m.match}: ${m.matches}`).join('; ')}), but no record matches all of them together`;
    } else why = `no ${to.to.name} record matches ${real.map((m) => `${m.match} (${m.values.map(show).join(' or ')})`).join(' and ')}`;
  }
  const relText = hop.rel.predicates.length
    ? pairs.map((x) => (x.op === '×' ? `${from.to.name} × ${to.to.name}` : text(x))).join(' and ')
    : `${from.to.name} – ${to.to.name}`;
  return {
    explanation: { relationship: relText, from: from.to.name, to: to.to.name, match, records: found.size },
    rows: [...found.values()].sort((a, b) => Number(a._fm_record_id) - Number(b._fm_record_id)),
    why,
  };
}

function explainCandidate(
  store: Store, far: Occurrence, path: Hop[], home: Occurrence, row: Record<string, SqlValue>, id: number,
  related: Record<string, SqlValue>[], filter: string | undefined, order: number[] | undefined,
  context: Store['calc']['context'], privileges?: Privileges,
): CandidateExplanation {
  const target = far.store.sql.prepare(`SELECT * FROM ${q(far.table.name)} WHERE _fm_record_id = ?`).get(id) as Record<string, SqlValue> | undefined;
  const out: CandidateExplanation = { recordId: id, exists: !!target, related: false, shown: false, checks: [], reason: '' };
  if (!target) {
    out.reason = `${far.table.name} has no record ${id}`;
    return out;
  }
  out.related = related.some((r) => Number(r._fm_record_id) === id);
  const last = path.at(-1);
  if (last && path.length === 1) {
    for (const x of matchPairs(last, home, far)) {
      if (x.op === '×') continue;
      const mine = x.from ? keys(keyValue(home, x.from, row)) : [];
      const theirs = x.to ? (target[x.to.name] ?? null) : null;
      const c = condition({ rel: { ...last.rel, predicates: [x.p] }, forward: last.forward }, home, far, row);
      const ok = !!c && !!(far.store.sql.prepare(`SELECT 1 FROM ${q(far.table.name)} WHERE _fm_record_id = ? AND (${c.where})`).get(id, ...c.params));
      out.checks.push({ match: `${home.to.name}::${x.from?.name ?? '?'} (${mine.length ? mine.map(show).join(' or ') : 'empty'}) ${x.op} ${far.to.name}::${x.to?.name ?? '?'} (${show(theirs)})`, value: theirs, ok });
    }
  }
  if (filter && out.related) {
    const ctx = context({ store: far.store, table: far.table, row: target as Row }, far.to.id, store.calc.newPass(privileges?.account, privileges));
    try {
      const e = explainEvaluation(compile(filter, store.calc.names(far.to.id)), ctx, { maxSteps: 60 });
      out.filter = e.error ? { error: `${e.error.code}: ${e.error.message}`, ...(e.step ? { steps: e.step } : {}) } : { value: asText(e.value!, store.dateOrder), ...(e.step ? { steps: e.step } : {}) };
      out.shown = !e.error && asBoolean(e.value!);
    } catch (e) {
      rethrowExecutionRefusal(e);
      out.filter = { error: e instanceof Error ? e.message : String(e) };
    }
  } else out.shown = out.related;
  const failed = out.checks.filter((c) => !c.ok);
  if (!out.related) {
    out.reason = failed.length
      ? `Not related: ${failed.map((c) => c.match).join('; ')} ${failed.length === 1 ? 'doesn\'t match' : 'don\'t match'}${failed.some((c) => c.value === null || c.value === '') ? ' (empty match fields never match)' : ''}`
      : path.length > 1 ? 'Not related: no record on the way leads to it' : 'Not related';
  } else if (!out.shown) out.reason = `Related, but the portal filter hides it: it gives ${out.filter?.error ? `an error (${out.filter.error})` : JSON.stringify(out.filter?.value ?? '')}`;
  else {
    const pos = order?.indexOf(id) ?? -1;
    out.reason = `Shown${pos >= 0 ? ` as row ${pos + 1}` : ''}: its match fields match${filter ? ' and the portal filter is true' : ''}`;
  }
  return out;
}
