// "Ask about this record": one record as a person sees it, with what hangs off it (its orders, notes, line
// items), so a model can summarize it and answer questions about it and say which fields each fact came from.
// The record's fields come with their values (calculations worked out); each relationship one step away from the
// layout's table occurrence comes with how it matches, how many records it finds and the first few of them.
// Everything is read as the account: records it can't view are left out (and not counted), fields it has no
// access to are left out, and secret-looking values are hidden from the model.

import type { Field, Table } from '../../fmp12/src/index.ts';
import { keyValue, maskValue, occurrence, relatedRows, type Occurrence, type Privileges, type Store } from '../../store/src/index.ts';
import { secretName } from './ai-output.ts';

const HIDDEN = '‹hidden from AI tools›';
/** A related record's values are cut here; the record's own are cut at VALUE_CHARS. */
const RELATED_CHARS = 200;
const VALUE_CHARS = 2000;
/** Relationships listed, at most. */
const MAX_RELATIONS = 25;
const OPS_FLIP: Record<string, string> = { '<': '>', '≤': '≥', '>': '<', '≥': '≤' };

export interface RelatedGroup {
  /** The table occurrence, as formulas and citations name it (TO::Field). */
  occurrence: string;
  table: string;
  /** How it matches this record: "Customers::Id = Invoices::CustomerId". */
  match: string;
  /** Related records the account can view, in all. */
  count: number;
  records: { id?: string; recordId: number; fields: Record<string, unknown> }[];
  /** Records not listed (pass limit, or follow, to read more). */
  more?: number;
}

export interface RecordContext {
  id?: string;
  layout: string;
  occurrence: string;
  table: string;
  recordId: number;
  /** Field name -> value; empty fields are left out, and listed in empty. */
  fields: Record<string, unknown>;
  empty: string[];
  /** Fields whose values above are stand-ins (the account sees them masked), so a model doesn't take them for the values. */
  masked?: string[];
  related: RelatedGroup[];
  note: string;
}

function clip(v: unknown, max: number): unknown {
  if (typeof v !== 'string' || v.length <= max) return v;
  return `${v.slice(0, max)}… (${v.length - max} more characters cut)`;
}

function shown(f: Field, v: unknown, max: number): unknown {
  if (v === null || v === undefined || v === '') return undefined;
  if (secretName(f.name)) return HIDDEN;
  if (f.type === 'container') return '(a file)';
  return clip(v, max);
}

/** The fields of a table the account sees only as a stand-in. */
/** A repeating field is stored as a JSON list; like the record read, only its first repetition is shown (and masked). */
function firstRepetition(store: { isRepeating(table: string, field: string): boolean }, table: string, field: string, v: unknown): unknown {
  if (typeof v !== 'string' || !v.startsWith('[') || !store.isRepeating(table, field)) return v;
  try { return (JSON.parse(v) as unknown[])[0] ?? null; } catch { return v; }
}

function maskedFields(table: Table, p: Privileges | undefined): Field[] {
  return p ? table.fields.filter((f) => f.kind !== 'summary' && p.fieldAccess(table.name, f.name) === 'masked') : [];
}

/** The fields of a table the account may see; `cheap` leaves out those worked out per record (unstored, globals, summaries). */
function visibleFields(table: Table, p: Privileges | undefined, cheap: boolean): Field[] {
  return table.fields.filter((f) => {
    if (f.kind === 'summary') return false;
    if (cheap && (f.options?.global || (f.kind === 'calculation' && f.options?.unstored))) return false;
    return !p || p.field(table.name, f.name) !== 'none';
  });
}

function matchText(store: Store, fromId: number, toId: number, home: Occurrence, far: Occurrence): string {
  const rel = store.schema.relationships.find((r) =>
    (r.leftTableOccurrenceId === fromId && r.rightTableOccurrenceId === toId) || (r.rightTableOccurrenceId === fromId && r.leftTableOccurrenceId === toId))!;
  const forward = rel.leftTableOccurrenceId === fromId;
  return rel.predicates.map((pr) => {
    const [a, b] = forward ? [pr.leftFieldId, pr.rightFieldId] : [pr.rightFieldId, pr.leftFieldId];
    const op = forward ? pr.operator : OPS_FLIP[pr.operator] ?? pr.operator;
    const name = (o: Occurrence, id: number) => `${o.to.name}::${o.table.fields.find((f) => f.id === id)?.name ?? '?'}`;
    return op === '×' ? `${home.to.name} × ${far.to.name} (every record)` : `${name(home, a)} ${op} ${name(far, b)}`;
  }).join(' and ');
}

/**
 * A record and its related records, as `privileges` sees them. `follow` names occurrences to read instead of
 * the ones one relationship away (any distance along the graph: "Line items" from a customer, through invoices).
 */
export function describeRecord(
  store: Store, layoutName: string, recordId: number,
  opts: { privileges?: Privileges; limit?: number; follow?: string[] } = {},
): RecordContext {
  const p = opts.privileges;
  const info = store.layout(layoutName);
  // Layout access and record access, as reading the record anywhere else checks them. An account that can't read
  // everything gets only the calculations and globals the layout shows it (a calculation can total related records
  // it can't view); stored fields it may see come from the record itself.
  const reads = !p || p.readsEverything;
  const worked = (f: Field) => !!f.options?.global || (f.kind === 'calculation' && !!f.options?.unstored);
  const onLayout = new Set(info.fields.filter((f) => !f.summary && !f.name.includes('::')).map((f) => f.name));
  const home = info.home ?? store;
  const fromTo = home.schema.tableOccurrences.find((t) => t.name === info.occurrence);
  const from = fromTo && occurrence(home, fromTo.id);
  if (!fromTo || !from) throw new Error(`Layout "${layoutName}" has no table occurrence`);
  const row = info.owner.row(info, recordId);
  const mine = p?.in(from.store);
  const own = mine?.full ? undefined : mine;
  // ...and none that read other occurrences: Sum ( Line Items::Price ) would total records it may not view (so would SQL).
  const reachesOut = (f: Field) => /\b(?:ExecuteSQL|Evaluate)\s*\(/i.test(f.calculation ?? '') || [...(f.calculation ?? '').matchAll(/([^\s;()\[\]"&+\-*\/=<>≠≤≥,¶]+(?: [^\s;()\[\]"&+\-*\/=<>≠≤≥,¶]+)*)\s*::/g)]
    .some((m) => m[1].toLowerCase() !== from.to.name.toLowerCase());
  const asked = reads ? [] : visibleFields(from.table, own, false).filter((f) => worked(f) && onLayout.has(f.name) && !reachesOut(f)).map((f) => f.name);
  // Masked fields are read through the store, which gives their stand-in, never from the row.
  const masked = maskedFields(from.table, own);
  const seen = store.get(info, recordId, 'iso', undefined, p, { summaries: false, fields: [...asked, ...masked.map((f) => f.name)] }).fieldData as Record<string, unknown>;

  const fields: Record<string, unknown> = {};
  const empty: string[] = [];
  for (const f of visibleFields(from.table, own, false)) {
    if (!reads && worked(f) && !asked.includes(f.name)) continue;
    const v = shown(f, reads || !worked(f) ? keyValue(from, f, row, p) : seen[f.name], VALUE_CHARS);
    if (v === undefined) empty.push(f.name);
    else fields[f.name] = v;
  }
  for (const f of masked) {
    const v = shown(f, seen[f.name], VALUE_CHARS);
    if (v === undefined) empty.push(f.name);
    else fields[f.name] = v;
  }

  const limit = Math.max(0, Math.min(opts.limit ?? 5, 50));
  const wanted = opts.follow?.length
    ? opts.follow.map((n) => {
      const to = home.schema.tableOccurrences.find((t) => t.name.toLowerCase() === n.replace(/::.*$/, '').toLowerCase());
      if (!to) throw new Error(`No table occurrence named "${n}" in ${home.name}`);
      return to.id;
    })
    : [...new Set(home.schema.relationships.flatMap((r) =>
      r.leftTableOccurrenceId === fromTo.id ? [r.rightTableOccurrenceId] : r.rightTableOccurrenceId === fromTo.id ? [r.leftTableOccurrenceId] : []))];

  const related: RelatedGroup[] = [];
  for (const toId of wanted.slice(0, MAX_RELATIONS)) {
    const far = occurrence(home, toId);
    if (!far) continue;
    const theirs = p?.in(far.store);
    const pv = theirs?.full ? undefined : theirs;
    if (pv && pv.table(far.table.name).view === false) continue;
    const viewable = far.store.viewableIds(far.table.name, pv);
    let rows: Record<string, unknown>[];
    let count: number;
    if (!viewable) {
      const r = relatedRows(home, fromTo.id, row, toId, { limit });
      if (!r) continue;
      rows = r.rows;
      count = r.count;
    } else {
      const r = relatedRows(home, fromTo.id, row, toId);
      if (!r) continue;
      const ok = new Set(viewable);
      const all = r.rows.filter((x) => ok.has(Number(x._fm_record_id)));
      rows = all.slice(0, limit);
      count = all.length;
    }
    const cols = visibleFields(far.table, pv, true);
    const standIns = maskedFields(far.table, pv).filter((f) => !(f.options?.global || (f.kind === 'calculation' && f.options?.unstored)));
    const path = home.schema.relationships.some((r) =>
      (r.leftTableOccurrenceId === fromTo.id && r.rightTableOccurrenceId === toId) || (r.rightTableOccurrenceId === fromTo.id && r.leftTableOccurrenceId === toId));
    related.push({
      occurrence: far.to.name,
      table: far.table.name,
      match: path ? matchText(home, fromTo.id, toId, from, far) : `through the relationship graph from ${from.to.name}`,
      count,
      records: rows.map((x) => {
        const out: Record<string, unknown> = {};
        for (const f of cols) {
          const v = shown(f, x[f.name], RELATED_CHARS);
          if (v !== undefined) out[f.name] = v;
        }
        for (const f of standIns) {
          const v = shown(f, maskValue(firstRepetition(far.store, far.table.name, f.name, x[f.name]), far.store.maskFor(f, pv!.mask(far.table.name, f.name)!)), RELATED_CHARS);
          if (v !== undefined) out[f.name] = v;
        }
        return { ...(far.store.fileMode === 'native' ? { id: String(x._fm_uuid) } : {}), recordId: Number(x._fm_record_id), fields: out };
      }),
      ...(count > rows.length ? { more: count - rows.length } : {}),
    });
  }

  return {
    ...(from.store.fileMode === 'native' ? { id: String(row._fm_uuid) } : {}),
    layout: info.name, occurrence: from.to.name, table: from.table.name, recordId, fields, empty, ...(masked.length ? { masked: masked.map((f) => f.name) } : {}), related,
    note: 'Cite each fact as [Occurrence::Field] for this record, or [Occurrence::Field #recordId] for a related record. ' +
      'Only records and fields this account can see are here; secret-looking values are hidden. ' +
      (wanted.length > MAX_RELATIONS ? `${wanted.length - MAX_RELATIONS} more relationships not read; pass follow to name them. ` : '') +
      'Related records list stored fields only.',
  };
}
