// Starter solutions: a small working app made through the same design operations the assistant uses, so a new
// database can open on something useful. Each one is plain data (starter-solutions.ts): tables, relationships,
// value lists, scripts, layouts (a list and a form for each table, a portal where a table has lines, buttons for
// the scripts, one report with a summary part), privilege sets and a few invented sample records.

import type { FieldSpec } from './design.ts';
import { draftArranged, draftLayout } from './layout-draft.ts';
import { STARTER_SOLUTIONS } from './starter-solutions.ts';
import type { Store } from './store.ts';

export interface StarterTable { name: string; fields: FieldSpec[] }

export interface StarterLayout {
  table: string;
  /** The list layout (named "<Table> list"). Fields default to the table's first eight. */
  list?: { fields?: string[] };
  /** The form layout (named after the table): portals of related rows and buttons that run scripts. */
  form?: {
    fields?: string[];
    portals?: { table: string; fields: string[]; rows?: number }[];
    buttons?: { text: string; script: string; parameter?: string }[];
  };
}

export interface StarterReport {
  name: string;
  table: string;
  fields?: string[];
  /** Fields to group by, outermost first; the report is meant to be sorted by them. */
  groups: string[];
  /** Summary fields of the table, totalled under each group and at the end. */
  totals: string[];
  summaryOnly?: boolean;
}

export interface Starter {
  name: string;
  title: string;
  summary: string;
  tables: StarterTable[];
  /** Pairs of "Table::Field" = "Table::Field". */
  relationships: { left: string; right: string; createRight?: boolean; deleteRight?: boolean }[];
  valueLists: { name: string; values: string[] }[];
  /** Field → value list: the form shows the field as a pop-up menu. */
  popups: Record<string, string>;
  scripts: { name: string; text: string }[];
  layouts: StarterLayout[];
  reports: StarterReport[];
  /** Privilege sets besides [Full Access]: who may change what. */
  privilegeSets: { name: string; comment: string; records: { view: boolean; create: boolean; edit: boolean; delete: boolean } }[];
  /** Invented records, in the order to add them: table → rows (a related row names its parent by its position, 1-based, in the `ID` the parent got). */
  sample: { table: string; rows: Record<string, string | number>[] }[];
}

export const STARTER_NAMES = Object.keys(STARTER_SOLUTIONS) as readonly string[];

export function starterSummaries(): { name: string; title: string; summary: string }[] {
  return STARTER_NAMES.map((n) => ({ name: n, title: STARTER_SOLUTIONS[n].title, summary: STARTER_SOLUTIONS[n].summary }));
}

export interface StarterResult {
  starter: string;
  tables: number;
  layouts: number;
  scripts: number;
  valueLists: number;
  privilegeSets: string[];
  sampleRecords: number;
}

/** Whether the file is still empty enough to start from (no tables, no scripts). */
export function starterTarget(store: Store): string | undefined {
  const s = store.schema;
  if (s.tables.length || s.scripts.length || s.valueLists.length) return 'This database already has tables, scripts or value lists. Start a new database for a starter solution.';
  return undefined;
}

/**
 * Builds the starter into an empty store. Everything goes through applyDesign, which checks every name and reference,
 * so a mistake in a starter fails here (and in its test) instead of leaving half an app.
 */
export function applyStarter(store: Store, name: string, opts: { sample?: boolean; account?: string } = {}): StarterResult {
  const starter = STARTER_SOLUTIONS[name];
  if (!starter) throw new Error(`There is no starter called "${name}". The starters are ${STARTER_NAMES.join(', ')}.`);
  const problem = starterTarget(store);
  if (problem) throw new Error(problem);
  const account = opts.account ?? 'Tabularius starter';

  store.applyDesign([
    ...starter.tables.map((t) => ({ op: 'createTable', name: t.name, fields: t.fields })),
    ...starter.relationships.map((r) => ({
      op: 'createRelationship', left: r.left.split('::')[0], right: r.right.split('::')[0],
      predicates: [{ left: r.left.split('::')[1], right: r.right.split('::')[1] }],
      ...(r.createRight ? { rightCreate: true } : {}), ...(r.deleteRight ? { rightDelete: true } : {}),
    })),
    ...starter.valueLists.map((v) => ({ op: 'createValueList', name: v.name, values: v.values })),
    ...starter.scripts.map((s) => ({ op: 'createScript', name: s.name, text: s.text })),
  ] as never, { account });

  const layouts = designLayouts(store, starter, account);
  for (const set of starter.privilegeSets) {
    store.savePrivilegeSet({
      name: set.name, comment: set.comment, records: set.records,
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
      extendedPrivileges: ['fmapp', 'fmwebdirect', 'fmrest'], printing: true, exporting: set.records.edit,
    });
  }

  let sampleRecords = 0;
  if (opts.sample !== false) {
    for (const group of starter.sample) {
      for (const row of group.rows) {
        store.create(group.table, row, { account, dateOrder: 'ISO' });
        sampleRecords++;
      }
    }
  }
  const s = store.schema;
  return {
    starter: name, tables: s.tables.length, layouts, scripts: s.scripts.length, valueLists: s.valueLists.length,
    privilegeSets: starter.privilegeSets.map((p) => p.name), sampleRecords,
  };
}

function designLayouts(store: Store, starter: Starter, account: string): number {
  let made = 0;
  const ids = (table: string, names?: string[]) => {
    const schema = store.schema;
    const occurrence = schema.tableOccurrences.find((o) => o.name === table);
    const base = occurrence && schema.tables.find((t) => t.id === occurrence.baseTableId);
    if (!occurrence || !base) throw new Error(`Starter ${starter.name}: no table ${table}`);
    const field = (n: string) => {
      const f = base.fields.find((x) => x.name === n);
      if (!f) throw new Error(`Starter ${starter.name}: ${table} has no field ${n}`);
      return f.id;
    };
    return { occurrence, base, fields: names?.map(field), field };
  };
  const draft = (spec: Parameters<typeof draftLayout>[2]) => draftLayout(store.schema, store.designs(), spec);
  const valueListId = (listName: string) => store.schema.valueLists.find((v) => v.name === listName)!.id;
  const withPopups = (design: { objects?: { kind: string; field?: { field: string; display?: string; valueListId?: number; valueList?: string } }[] }, table: string) => {
    for (const o of design.objects ?? []) {
      const list = o.kind === 'field' && o.field ? starter.popups[`${table}::${o.field.field}`] : undefined;
      if (list && o.field) { o.field.display = 'popup'; o.field.valueListId = valueListId(list); o.field.valueList = list; }
    }
  };

  for (const def of starter.layouts) {
    const t = ids(def.table);
    // The form: replaces the layout createTable made.
    const portals = (def.form?.portals ?? []).map((p) => {
      const to = ids(p.table, p.fields);
      return { occurrence: to.occurrence.id, fields: to.fields!, rows: p.rows ?? 5 };
    });
    const formFields = def.form?.fields ? ids(def.table, def.form.fields).fields : undefined;
    const form = draft({ title: def.table, occurrence: t.occurrence.id, view: 'form', ...(formFields ? { fields: formFields } : {}), ...(portals.length ? { portals } : {}) });
    withPopups(form.design as never, def.table);
    const buttons = def.form?.buttons ?? [];
    if (buttons.length) addButtons(store, form.design as never, t.occurrence.id, buttons);
    store.applyDesign([{ op: 'updateLayout', layout: def.table, design: form.design }] as never, { account });
    made++;
    // The list.
    const listFields = def.list?.fields ? ids(def.table, def.list.fields).fields : undefined;
    const list = draft({ title: `${def.table} list`, occurrence: t.occurrence.id, view: 'list', ...(listFields ? { fields: listFields } : {}) });
    store.applyDesign([{ op: 'createLayout', name: `${def.table} list`, occurrence: t.occurrence.id, design: list.design }] as never, { account });
    made++;
  }
  for (const r of starter.reports) {
    const t = ids(r.table);
    const fields = r.fields ? ids(r.table, r.fields).fields : undefined;
    const report = draft({
      title: r.name, occurrence: t.occurrence.id, view: 'list', ...(fields ? { fields } : {}),
      groups: r.groups.map((g) => t.field(g)), totals: r.totals.map((g) => t.field(g)), ...(r.summaryOnly ? { summaryOnly: true } : {}),
    });
    store.applyDesign([{ op: 'createLayout', name: r.name, occurrence: t.occurrence.id, design: report.design }] as never, { account });
    made++;
  }
  return made;
}

/** Buttons along the top of a form that run scripts. */
function addButtons(store: Store, design: { width?: number; parts?: { kind: string; top: number; height: number }[]; objects?: Record<string, unknown>[] }, occurrence: number, buttons: NonNullable<NonNullable<StarterLayout['form']>['buttons']>): void {
  const schema = store.schema;
  // The look of a button in this file comes from the same drafting the assistant does for a button in a picture.
  const look = draftArranged(schema, store.designs(), {
    title: 'look', occurrence, view: 'form', width: 200, parts: [{ kind: 'body', height: 40 }],
    objects: [{ kind: 'button', part: 0, left: 0, top: 0, width: 100, height: 24, text: 'look' }],
  }).design.objects?.[0];
  const header = design.parts?.find((p) => p.kind === 'header');
  const objects = design.objects ?? (design.objects = []);
  let next = Math.max(0, ...objects.map((o) => Number(o.id) || 0)) + 1;
  const width = design.width ?? 600;
  const w = 120;
  const top = (header?.top ?? 0) + 4;
  buttons.forEach((b, i) => {
    const script = schema.scripts.find((s) => s.name === b.script);
    if (!script) throw new Error(`The button "${b.text}" runs ${b.script}, which the starter doesn't have`);
    const left = Math.max(0, width - (buttons.length - i) * (w + 8));
    objects.push({
      id: next++, kind: 'button', type: 10, bounds: { top, left, bottom: top + 24, right: left + w },
      anchors: { left: false, top: true, right: true, bottom: false }, style: JSON.parse(JSON.stringify(look?.style ?? {})), text: b.text,
      action: { stepId: 1, step: 'Perform Script', scriptId: script.id, script: script.name, ...(b.parameter !== undefined ? { parameter: b.parameter } : {}) },
    });
  });
}
