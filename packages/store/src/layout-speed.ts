// "Make this layout faster" (not in FileMaker): for each of Check's speed
// findings on a layout (layout-perf.ts), a redesign that removes the work, as
// design changes a person can look over before anything is saved, each with
// the layout's estimated cost before and after. Mechanical moves only:
//
// - a summary field on every row of a list moves into a trailing grand summary
//   (fixLayout's move), where it shows the same total once;
// - an unstored calculation, or a summary of related records, on every row
//   becomes a stored calculation shown in its place. A stored value is worked
//   out when its own record changes, not when the related records it reads do,
//   so each such move says so; Stale stored values (admin) brings them up to date.
//
// Portal filters and hide or condition formulas have no mechanical redesign:
// they are left for the assistant (assistant.ts speedIdeas) or a person.
// Nothing here reads records except to count them.

import { rethrowExecutionRefusal } from '../../calc/src/execution-refusal.ts';
import type { Field, LayoutDesign, LayoutObject, Schema, Table, TableOccurrence } from '../../fmp12/src/index.ts';
import type { DesignOp } from './design.ts';
import { fixLayout } from './layout-fix.ts';
import { layoutPerformance, storeStats, type PerfIssue, type PerfKind } from './layout-perf.ts';
import type { Store } from './store.ts';

export interface SpeedMove {
  kind: PerfKind;
  objectIds: number[];
  /** What the move does, in a line. */
  title: string;
  /** What changes for the people using the layout, when something does. */
  caveat?: string;
  changes: DesignOp[];
  /** The layout's estimated record reads per draw with this move alone. */
  after: number;
  /** Proposed by the assistant rather than worked out here. */
  ai?: boolean;
  /** For an assistant's idea: each change in plain words, worked out from the changes themselves (not the model's title). */
  details?: string[];
}

export interface SpeedPlan {
  layout: { id: number; name: string };
  /** Estimated record reads per draw now (sum of the findings). */
  before: number;
  moves: SpeedMove[];
  /** Findings with no move here: for the assistant or a person. */
  left: PerfIssue[];
}

/** A summary type as the aggregate function that works it out from the related records. */
const AGGREGATE: Partial<Record<string, string>> = { total: 'Sum', count: 'Count', average: 'Average', minimum: 'Min', maximum: 'Max' };

const quote = (name: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `$${JSON.stringify(name)}`);

/** The layout's estimated cost: the sum of its findings, under the schema and designs given. */
export function layoutCost(design: LayoutDesign, schema: Schema, store: Store): { cost: number; issues: PerfIssue[] } {
  const issues = layoutPerformance(design, schema, storeStats({ schema, recordCount: (t) => (store.schema.tables.some((x) => x.name === t) ? store.recordCount(t) : 0) }));
  return { cost: issues.reduce((n, i) => n + (i.cost ?? 0), 0), issues };
}

/** The cost of the layout after `changes`, or undefined when they wouldn't apply. */
export function costAfter(store: Store, layoutId: number, changes: DesignOp[]): number | undefined {
  try {
    const { schema, designs } = store.checkDesign(changes);
    const d = designs.layouts.find((x) => x.id === layoutId);
    return d ? layoutCost(d, schema, store).cost : undefined;
  } catch (e) {
    rethrowExecutionRefusal(e);
    return undefined;
  }
}

function find(objects: LayoutObject[], id: number): LayoutObject | undefined {
  for (const o of objects) {
    if (o.id === id) return o;
    const inner = o.children && find(o.children, id);
    if (inner) return inner;
  }
  return undefined;
}

/** The portal an object sits in, if any. */
function portalOf(objects: LayoutObject[], id: number, portal?: LayoutObject): LayoutObject | undefined {
  for (const o of objects) {
    if (o.id === id) return portal;
    const inner = o.children && portalOf(o.children, id, o.kind === 'portal' ? o : portal);
    if (inner) return inner;
  }
  return undefined;
}

/** The layout's objects with one field object pointing at another field (through another occurrence, when given). */
function swapField(objects: LayoutObject[], id: number, fieldId: number, field: string, via?: { id: number; name: string }): LayoutObject[] {
  return objects.map((o) => (o.id === id && o.field
    ? { ...o, field: { ...o.field, fieldId, field, ...(via ? { tableOccurrenceId: via.id, tableOccurrence: via.name } : {}) } }
    : o.children ? { ...o, children: swapField(o.children, id, fieldId, field, via) } : o));
}

/** A field name like `base` that the table doesn't have yet. */
function freeName(t: Table, base: string): string {
  const taken = new Set(t.fields.map((f) => f.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/**
 * A stored calculation in `t` holding what `o` shows (an unstored calculation's formula, or the related
 * summary as an aggregate), and the layout showing it instead. Undefined when there is no such formula.
 */
function storedMove(store: Store, design: LayoutDesign, o: LayoutObject): { changes: DesignOp[]; title: string; caveat: string } | undefined {
  const schema = store.schema;
  const occ = (id: number | undefined) => schema.tableOccurrences.find((x) => x.id === id);
  const shown = occ(o.field?.tableOccurrenceId);
  const source = shown?.baseTableId === undefined || shown.dataSourceId ? undefined : schema.tables.find((t) => t.id === shown.baseTableId);
  const f = source?.fields.find((x) => x.id === o.field?.fieldId);
  if (!shown || !source || !f) return undefined;
  // Where the stored value lives: in the table the object shows from, with that occurrence as its context.
  let formula: string | undefined, type: Field['type'] = f.type, table = source, context = f.calculationContextId ?? shown.id;
  if (f.kind === 'calculation' && f.options?.unstored && f.calculation) formula = f.calculation;
  else if (f.kind === 'summary' && f.summary) {
    // A summary of related records, shown through `shown`: the layout's own table keeps the aggregate.
    // In a portal row a summary through another occurrence than the portal's own differs from row to
    // row; one stored total on the layout's record would show the same number on every row.
    const portal = portalOf(design.objects, o.id);
    if (portal && portal.portal?.tableOccurrenceId !== shown.id) return undefined;
    const fn = AGGREGATE[f.summary.type];
    const summarized = source.fields.find((x) => x.id === f.summary!.fieldId);
    const home = occ(design.tableOccurrenceId);
    const homeTable = home?.baseTableId === undefined ? undefined : schema.tables.find((t) => t.id === home.baseTableId);
    if (!fn || !summarized || !homeTable || !home || home.dataSourceId) return undefined;
    formula = `${fn} ( ${quote(shown.name)}::${quote(summarized.name)} )`;
    type = f.summary.type === 'count' ? 'number' : summarized.type === 'text' ? 'number' : summarized.type;
    table = homeTable;
    context = home.id;
  }
  if (!formula) return undefined;
  const name = freeName(table, `${f.name} stored`);
  const create: DesignOp = { op: 'createField', table: table.id, name, kind: 'calculation', type, calculation: formula, calculationContext: context, comment: `Stored copy of ${f.name}, made to speed up the layout ${design.name}` } as DesignOp;
  // The new field's id, as the change will give it, so the layout can point at it.
  const made = store.checkDesign([create]).schema.tables.find((t) => t.id === table.id)?.fields.find((x) => x.name === name);
  if (!made) return undefined;
  const home = occ(design.tableOccurrenceId);
  const via = table === source ? o.field!.tableOccurrenceId : home!.id;
  const objects = swapField(design.objects, o.id, made.id, name, via === o.field!.tableOccurrenceId ? undefined : home);
  return {
    changes: [{ ...create, id: made.id } as DesignOp, { op: 'updateLayout', layout: design.id, design: { objects } } as DesignOp],
    title: `Show ${shown.name}::${f.name} from a new stored calculation, ${table.name}::${name}`,
    caveat: f.kind === 'summary' || /::/.test(formula)
      ? `${name} is worked out when its own record changes, not when the related records change, so it can fall behind them; Stale stored values in the admin console brings it up to date.`
      : `${name} is worked out when its record changes and kept, instead of each time it shows.`,
  };
}

/** The speed findings on a layout and the redesign for each that has a mechanical one. */
export function speedPlan(store: Store, layout: string | number): SpeedPlan {
  const design = store.design(layout);
  if (!design) throw new Error(`No layout "${layout}"`);
  const { cost: before, issues } = layoutCost(design, store.schema, store);
  const moves: SpeedMove[] = [];
  const left: PerfIssue[] = [];
  for (const issue of issues) {
    let move: Omit<SpeedMove, 'after'> | undefined;
    if (issue.kind === 'summary on every row' && issue.fixable) {
      const { fixed, changes, design: moved } = fixLayout(design, store.schema, store.privilegeSets(), [{ rule: 'slow', objectIds: issue.objectIds }]);
      if (fixed.length) {
        move = {
          kind: issue.kind, objectIds: issue.objectIds, title: 'Move the summary field into a trailing grand summary, where it shows once',
          changes: [...changes, { op: 'updateLayout', layout: design.id, design: { objects: moved.objects, parts: moved.parts, tabOrder: moved.tabOrder } } as DesignOp],
        };
      }
    } else if (issue.kind === 'unstored calculation' || issue.kind === 'related summary') {
      const o = find(design.objects, issue.objectIds[0]);
      const stored = o && storedMove(store, design, o);
      if (stored) move = { kind: issue.kind, objectIds: issue.objectIds, ...stored };
    }
    const after = move && costAfter(store, design.id, move.changes);
    if (move && after !== undefined) moves.push({ ...move, after });
    else left.push(issue);
  }
  return { layout: { id: design.id, name: design.name }, before, moves, left };
}

/**
 * A redesign the assistant proposes for a finding with no mechanical move, in a narrow form: new fields,
 * occurrences and relationships, then edits to this layout's objects. Nothing else can be changed this
 * way (no deleting, no changing existing fields or relationships), so a proposal can't break the rest of
 * the file; the person still sees each change before it is saved.
 */
export interface SpeedIdea {
  title: string;
  caveat?: string;
  objectIds: number[];
  add?: DesignOp[];
  edits?: SpeedEdit[];
}

export type SpeedEdit =
  /** Show a portal's rows from another occurrence (one whose relationship does the filtering), and its filter, if any, kept or dropped. */
  | { portal: number; occurrence: string; filter?: string | null }
  /** Show another field in a field object. */
  | { object: number; occurrence: string; field: string }
  /** A new hide, tooltip or condition formula on an object (null takes it off). */
  | { object: number; hide?: string | null; tooltip?: string | null; condition?: { index: number; formula: string } };

const OPERATORS = new Set(['=', '≠', '<', '≤', '>', '≥', '×']);
const isRef = (v: unknown): v is string | number => (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isInteger(v));

/**
 * An added change rebuilt from the parts a speed-up may set, so nothing else the model wrote reaches the
 * file: no ids, no other files, relationships that never create or delete records, and fields that are
 * plain or calculated (no auto-enter, validation, lookups or summaries).
 */
function safeAdd(op: unknown): DesignOp {
  const o = (op ?? {}) as Record<string, unknown>;
  const fail = (why: string): never => { throw new Error(`A new ${String(o.op ?? 'change')} ${why}`); };
  if (o.op === 'createField') {
    if (!isRef(o.table) || typeof o.name !== 'string' || !o.name) fail('needs a table and a name');
    const kind = o.kind ?? (typeof o.calculation === 'string' ? 'calculation' : 'normal');
    if (kind !== 'normal' && kind !== 'calculation') fail(`can only be a plain or calculated field, not ${String(kind)}`);
    if (kind === 'calculation' && (typeof o.calculation !== 'string' || !o.calculation)) fail('needs its formula');
    const opts = (o.options ?? {}) as Record<string, unknown>;
    const options = { ...(opts.global === true ? { global: true } : {}), ...(kind === 'calculation' && opts.unstored === true ? { unstored: true } : {}) };
    return {
      op: 'createField', table: o.table as string | number, name: o.name as string, kind,
      ...(typeof o.type === 'string' ? { type: o.type } : {}),
      ...(typeof o.comment === 'string' ? { comment: o.comment } : {}),
      ...(kind === 'calculation' ? { calculation: o.calculation as string } : {}),
      ...(kind === 'calculation' && isRef(o.calculationContext) ? { calculationContext: o.calculationContext } : {}),
      ...(Object.keys(options).length ? { options } : {}),
    } as DesignOp;
  }
  if (o.op === 'createOccurrence') {
    if (typeof o.name !== 'string' || !o.name || !isRef(o.table)) fail('needs a name and a table in this file');
    return { op: 'createOccurrence', name: o.name as string, table: o.table as string | number } as DesignOp;
  }
  if (o.op === 'createRelationship') {
    if (!isRef(o.left) || !isRef(o.right) || !Array.isArray(o.predicates) || !o.predicates.length) fail('needs two occurrences and the fields that match');
    const predicates = (o.predicates as Record<string, unknown>[]).map((p) => {
      if (!p || !isRef(p.left) || !isRef(p.right)) fail('has a match without two fields');
      if (p.operator !== undefined && !OPERATORS.has(p.operator as string)) fail(`has an unknown operator ${String(p.operator)}`);
      return { left: p.left, right: p.right, ...(p.operator !== undefined ? { operator: p.operator } : {}) };
    });
    // Never lets records be created or deleted through it, whatever the model asked for.
    return { op: 'createRelationship', left: o.left, right: o.right, predicates, leftCreate: false, rightCreate: false, leftDelete: false, rightDelete: false } as DesignOp;
  }
  return fail(`isn't something a speed-up adds: only new fields, occurrences and relationships`);
}

/** Each added change in plain words, from the change as it will be saved and the schema after it. */
function describeAdded(applied: DesignOp[], schema: Schema): string[] {
  const table = (r: unknown) => schema.tables.find((t) => t.id === r || t.name === r);
  const occ = (r: unknown) => schema.tableOccurrences.find((t) => t.id === r || t.name === r);
  const field = (o: TableOccurrence | undefined, r: unknown) => {
    const f = table(o?.baseTableId)?.fields.find((x) => x.id === r || x.name === r);
    return `${o?.name ?? '?'}::${f?.name ?? String(r)}`;
  };
  return applied.map((c) => {
    const o = c as Record<string, unknown>;
    if (o.op === 'createField') {
      const t = table(o.table)?.name ?? String(o.table);
      const opts = (o.options ?? {}) as Record<string, unknown>;
      return o.kind === 'calculation'
        ? `New ${opts.unstored ? 'unstored' : 'stored'} calculation ${t}::${String(o.name)} = ${String(o.calculation)}`
        : `New ${opts.global ? 'global ' : ''}field ${t}::${String(o.name)}`;
    }
    if (o.op === 'createOccurrence') return `New table occurrence ${String(o.name)}, of the table ${table(o.table)?.name ?? String(o.table)}`;
    if (o.op === 'createRelationship') {
      const l = occ(o.left), r = occ(o.right);
      const preds = ((o.predicates ?? []) as { left: unknown; right: unknown; operator?: string }[]).map((p) => `${field(l, p.left)} ${p.operator ?? '='} ${field(r, p.right)}`);
      return `New relationship ${l?.name ?? '?'} to ${r?.name ?? '?'} where ${preds.join(' and ')} (no records are created or deleted through it)`;
    }
    return String(o.op);
  });
}

/** The changes for an idea, checked, with the cost after; throws with a reason a person can read when they don't fit. */
export function speedMoveFromIdea(store: Store, layoutId: number, kind: PerfKind, idea: SpeedIdea): SpeedMove {
  const design = store.design(layoutId);
  if (!design) throw new Error(`No layout ${layoutId}`);
  const add = (Array.isArray(idea.add) ? idea.add : []).map(safeAdd);
  // The objects an idea answers for must be on this layout, so it can't hide other findings.
  const onLayout = new Set<number>();
  const collect = (list: LayoutObject[]) => { for (const o of list) { onLayout.add(o.id); if (o.children) collect(o.children); } };
  collect(design.objects);
  const ids = Array.isArray(idea.objectIds) ? idea.objectIds : [];
  if (!ids.length || ids.some((id) => !onLayout.has(id))) throw new Error(`It names objects that aren't on ${design.name}`);
  const details: string[] = [];
  // The new things with the ids they will get, so the layout's objects can point at them.
  // (An idea that only edits the layout adds nothing; checkDesign wants at least one change.)
  const { applied, schema } = add.length ? store.checkDesign(add) : { applied: [] as DesignOp[], schema: store.schema };
  details.push(...describeAdded(applied, schema));
  const label = (o: LayoutObject) => `${o.name ? `"${o.name}"` : o.field ? `${o.field.tableOccurrence}::${o.field.field}` : `${o.kind} ${o.id}`}`;
  const occurrence = (name: string) => {
    const o = schema.tableOccurrences.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!o) throw new Error(`No table occurrence "${name}"`);
    return o;
  };
  let objects = structuredClone(design.objects);
  const edit = (id: number, fn: (o: LayoutObject) => LayoutObject) => {
    let hit = false;
    const walk = (list: LayoutObject[]): LayoutObject[] => list.map((o) => {
      if (o.id === id) {
        hit = true;
        return fn(o);
      }
      return o.children ? { ...o, children: walk(o.children) } : o;
    });
    objects = walk(objects);
    if (!hit) throw new Error(`No object ${id} on ${design.name}`);
  };
  for (const e of idea.edits ?? []) {
    if ('portal' in e) {
      const to = occurrence(e.occurrence);
      edit(e.portal, (o) => {
        if (o.kind !== 'portal' || !o.portal) throw new Error(`Object ${e.portal} isn't a portal`);
        const was = o.portal.tableOccurrenceId;
        // Its rows' fields from the old occurrence come from the new one.
        const repoint = (list: LayoutObject[] = []): LayoutObject[] => list.map((c) => ({
          ...c, ...(c.field?.tableOccurrenceId === was ? { field: { ...c.field, tableOccurrenceId: to.id, tableOccurrence: to.name } } : {}), ...(c.children ? { children: repoint(c.children) } : {}),
        }));
        const portal = { ...o.portal, tableOccurrenceId: to.id };
        const from = schema.tableOccurrences.find((x) => x.id === was)?.name ?? '?';
        details.push(`The portal ${label(o)} shows rows from ${to.name} instead of ${from}`);
        if (e.filter === null) {
          if (portal.filter) details.push(`Its filter is taken off (was ${portal.filter})`);
          delete portal.filter;
        } else if (typeof e.filter === 'string') {
          details.push(`Its filter becomes ${e.filter}${portal.filter ? ` (was ${portal.filter})` : ''}`);
          portal.filter = e.filter;
        }
        return { ...o, portal, children: repoint(o.children) };
      });
    } else if ('field' in e) {
      const to = occurrence(e.occurrence);
      const table = schema.tables.find((t) => t.id === to.baseTableId);
      const f = table?.fields.find((x) => x.name.toLowerCase() === e.field.toLowerCase());
      if (!f) throw new Error(`No field ${e.occurrence}::${e.field}`);
      edit(e.object, (o) => {
        if (!o.field) throw new Error(`Object ${e.object} isn't a field`);
        details.push(`${label(o)} shows ${to.name}::${f.name} instead`);
        return { ...o, field: { ...o.field, tableOccurrenceId: to.id, tableOccurrence: to.name, fieldId: f.id, field: f.name } };
      });
    } else {
      edit(e.object, (o) => {
        const out = { ...o };
        if (e.hide === null) {
          if (o.hide) details.push(`${label(o)} is no longer hidden (its hide formula was ${o.hide.formula})`);
          delete out.hide;
        } else if (typeof e.hide === 'string') {
          details.push(`${label(o)} hides when ${e.hide}${o.hide ? ` (was ${o.hide.formula})` : ''}`);
          out.hide = { ...(o.hide ?? { inFind: false }), formula: e.hide };
        }
        if (e.tooltip === null) delete out.tooltip;
        else if (typeof e.tooltip === 'string') out.tooltip = e.tooltip;
        if (e.tooltip !== undefined) details.push(`${label(o)}'s tooltip ${e.tooltip === null ? 'is taken off' : `becomes ${e.tooltip}`}`);
        if (e.condition) {
          const { index, formula } = e.condition;
          const list = [...(o.conditions ?? [])];
          if (!Number.isInteger(index) || index < 0 || index >= list.length || typeof formula !== 'string') throw new Error(`Object ${e.object} has no condition ${String(index)}`);
          details.push(`${label(o)}'s condition ${index + 1} becomes ${formula} (was ${list[index].formula})`);
          list[index] = { ...list[index], formula };
          out.conditions = list;
        }
        return out;
      });
    }
  }
  const changes: DesignOp[] = [...applied, ...(idea.edits?.length ? [{ op: 'updateLayout', layout: design.id, design: { objects } } as DesignOp] : [])];
  if (!changes.length) throw new Error('The proposal changes nothing');
  const after = costAfter(store, design.id, changes);
  if (after === undefined) throw new Error('The proposal doesn\'t apply to this file');
  return { kind, objectIds: ids, title: idea.title, ...(idea.caveat ? { caveat: idea.caveat } : {}), changes, after, ai: true, details };
}

/**
 * What the assistant is shown to propose speed-ups: the layout's findings, its objects with the fields and
 * formulas they use, and the tables, occurrences and relationships around them. Design only: no record.
 */
export function speedContext(store: Store, layoutId: number, findings: PerfIssue[]): unknown {
  const design = store.design(layoutId);
  if (!design) throw new Error(`No layout ${layoutId}`);
  const s = store.schema;
  const occ = new Map(s.tableOccurrences.map((o) => [o.id, o]));
  const tableIds = new Set<number>();
  const fieldName = (r: LayoutObject['field']) => {
    const o = r && occ.get(r.tableOccurrenceId);
    if (o?.baseTableId !== undefined) tableIds.add(o.baseTableId);
    return o ? `${o.name}::${r!.field ?? r!.fieldId}` : undefined;
  };
  const objects: unknown[] = [];
  const walk = (list: LayoutObject[]) => {
    for (const o of list) {
      if (o.field || o.portal || o.hide || o.tooltip || o.conditions?.length) {
        const portal = o.portal && occ.get(o.portal.tableOccurrenceId);
        if (portal?.baseTableId !== undefined) tableIds.add(portal.baseTableId);
        objects.push({
          id: o.id, kind: o.kind, ...(o.field ? { field: fieldName(o.field) } : {}),
          ...(o.portal ? { portal: { occurrence: portal?.name, rows: o.portal.rows, ...(o.portal.filter ? { filter: o.portal.filter } : {}) } } : {}),
          ...(o.hide ? { hide: o.hide.formula } : {}), ...(o.tooltip ? { tooltip: o.tooltip } : {}),
          ...(o.conditions?.length ? { conditions: o.conditions.map((c) => c.formula) } : {}),
        });
      }
      if (o.children) walk(o.children);
    }
  };
  walk(design.objects);
  const home = occ.get(design.tableOccurrenceId ?? -1);
  if (home?.baseTableId !== undefined) tableIds.add(home.baseTableId);
  const nameOf = (toId: number, fieldId: number) => {
    const t = s.tables.find((x) => x.id === occ.get(toId)?.baseTableId);
    return t?.fields.find((f) => f.id === fieldId)?.name ?? String(fieldId);
  };
  return {
    layout: { id: design.id, name: design.name, view: design.view, occurrence: home?.name },
    findings: findings.map((f) => ({ kind: f.kind, objectIds: f.objectIds, message: f.message, ...(f.cost !== undefined ? { cost: f.cost } : {}) })),
    objects: objects.slice(0, 300),
    tables: s.tables.filter((t) => tableIds.has(t.id)).map((t) => ({
      name: t.name, records: store.recordCount(t.name),
      fields: t.fields.slice(0, 200).map((f) => ({
        name: f.name, kind: f.kind, type: f.type, ...(f.calculation ? { formula: f.calculation } : {}), ...(f.options?.unstored ? { unstored: true } : {}),
        ...(f.options?.global ? { global: true } : {}), ...(f.summary ? { summary: f.summary.type } : {}),
      })),
    })),
    occurrences: s.tableOccurrences.filter((o) => !o.dataSourceId && o.baseTableId !== undefined && tableIds.has(o.baseTableId)).map((o) => ({ name: o.name, table: s.tables.find((t) => t.id === o.baseTableId)?.name })),
    relationships: s.relationships.filter((r) => [r.leftTableOccurrenceId, r.rightTableOccurrenceId].some((id) => { const b = occ.get(id)?.baseTableId; return b !== undefined && tableIds.has(b); })).map((r) => ({
      left: occ.get(r.leftTableOccurrenceId)?.name, right: occ.get(r.rightTableOccurrenceId)?.name,
      match: r.predicates.map((p) => `${nameOf(r.leftTableOccurrenceId, p.leftFieldId)} ${p.operator} ${nameOf(r.rightTableOccurrenceId, p.rightFieldId)}`),
    })),
  };
}
