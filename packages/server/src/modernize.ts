import { assertAiPolicy } from './ai-policy.ts';
// Modernize interfaces: new layouts for each table of a file, made from templates with no AI, to sit beside the
// layouts the file already has (which are never changed or replaced). Each table gets a list, a record form and a list
// with the form beside it as modern layouts (HTML, CSS and JavaScript, see web/src/modernize.ts), and a list and a form
// in classic FileMaker style, drafted the way the file's own layouts look (store/layout-draft.ts). Shown as a preview
// first; applying it is one change in the design history that Undo takes back.

import type { Field, LayoutObject, Schema, Table, TableOccurrence } from '../../fmp12/src/index.ts';
import { relatedOccurrences, type DesignOp, type Store } from '../../store/src/index.ts';
import { FORMULA_LIMIT, modernDesign } from '../../web/src/page-source.ts';
import { interfacePage, planFromLayout, planInterface, samplesOf, whyNot, type InterfacePlan, type Mode, type View, type ModernField, type LayoutField, type ModernTable, type PlanButton, type PlanRelated, type Samples } from '../../web/src/modernize.ts';
import { draftLayoutChange, orderTree } from './design-preview.ts';

/** The kinds of layout that can be made, in the order they are listed. */
export const STYLES = ['modern-list', 'modern-detail', 'modern-split', 'classic-list', 'classic-form', 'modern-board', 'modern-calendar'] as const;
export type Style = (typeof STYLES)[number];
/** What is made when no styles are asked for: the board and calendar are for tables that have a status or a date to build them on, so they are asked for. */
export const DEFAULT_STYLES: readonly Style[] = ['modern-list', 'modern-detail', 'modern-split', 'classic-list', 'classic-form'];

export const STYLE_LABELS: Record<Style, string> = {
  'modern-list': 'Modern list', 'modern-detail': 'Modern detail', 'modern-split': 'Modern list and detail',
  'classic-list': 'Classic list', 'classic-form': 'Classic form', 'modern-board': 'Modern board', 'modern-calendar': 'Modern calendar',
};
/** What a layout is called: the table, then this. */
const SUFFIX: Record<Style, string> = {
  'modern-list': 'Modern list', 'modern-detail': 'Modern detail', 'modern-split': 'Modern list and detail',
  'classic-list': 'Classic list', 'classic-form': 'Classic form', 'modern-board': 'Modern board', 'modern-calendar': 'Modern calendar',
};
const MODE: Partial<Record<Style, Mode>> = { 'modern-list': 'list', 'modern-detail': 'detail', 'modern-split': 'split', 'modern-board': 'list', 'modern-calendar': 'list' };
/** The view a modern page opens on, where it is not the table. */
const VIEW: Partial<Record<Style, View>> = { 'modern-board': 'board', 'modern-calendar': 'calendar' };

/** The folder the new layouts go in, in the Layouts list. */
export const FOLDER = 'Modernized interfaces';

export interface ModernizeRequest {
  /** Tables to make layouts for (default: every table that has a use for them). */
  tables?: unknown;
  /** Kinds of layout to make (default: the modern list, detail and list and detail, and the classic list and form). */
  styles?: unknown;
  /** Keep the new layouts together in a folder of the Layouts list (default true). */
  folder?: unknown;
  /** Also make a modern list and detail for each of the file's own layouts, with the fields that layout shows in its order (default false). */
  fromLayouts?: unknown;
}

export interface ModernizedLayout {
  name: string;
  table: string;
  style: Style;
  notes: string[];
  /** Modern layouts: the fields they read, by layout name, so a preview can show the page on made-up records. */
  samples?: Samples;
}

export interface ModernizeResult {
  /** The layouts that would be made, in the order they are listed. */
  layouts: ModernizedLayout[];
  /** Tables given nothing, and why, and layouts that were already there and so left alone. */
  skipped: { table: string; style?: Style; why: string }[];
  /** The design changes that make them: what to apply, or show first. */
  changes: DesignOp[];
}

const lower = (s: string) => s.toLowerCase();

function modernField(schema: Schema, f: Field): ModernField {
  const auto = f.options?.autoEnter;
  const listId = f.options?.validation?.valueList;
  const list = listId !== undefined ? schema.valueLists.find((v) => v.id === listId) : undefined;
  const values = list?.values;
  const listName = list?.name;
  return {
    name: f.name, type: f.type, kind: f.kind, ...(f.options?.global ? { global: true } : {}), ...(f.options?.repetitions && f.options.repetitions > 1 ? { repetitions: f.options.repetitions } : {}),
    ...(auto?.serial || auto?.value ? { automatic: true } : {}), ...(values?.length ? { values } : {}), ...(listName ? { valueList: listName } : {}), ...(f.options?.validation?.notEmpty ? { required: true } : {}),
  };
}

const modernTable = (schema: Schema, t: Table): ModernTable => ({ name: t.name, fields: t.fields.map((f) => modernField(schema, f)) });

/** A table's table occurrence in this file: the one named like it, else its first. */
function occurrenceOf(schema: Schema, t: Table): TableOccurrence | undefined {
  const own = schema.tableOccurrences.filter((o) => !o.dataSourceId && o.baseTableId === t.id);
  return own.find((o) => o.name === t.name) ?? own[0];
}

const pick = <T>(x: unknown, all: readonly T[], what: string, fallback: readonly T[] = all): T[] => {
  if (x === undefined) return [...fallback];
  if (!Array.isArray(x) || !x.length) throw new Error(`${what} is a list of ${all.join(', ')}`);
  const bad = x.find((v) => !all.includes(v as T));
  if (bad !== undefined) throw new Error(`There is no ${what.replace(/s$/, '')} "${String(bad)}"; use ${all.join(', ')}`);
  return all.filter((a) => x.includes(a));
};

/** Related tables of an occurrence through a relationship that matches one field to another. */
function links(schema: Schema, to: TableOccurrence): { other: TableOccurrence; table: Table; local: string; remote: string }[] {
  const out: { other: TableOccurrence; table: Table; local: string; remote: string }[] = [];
  for (const r of schema.relationships) {
    const mine = r.leftTableOccurrenceId === to.id ? 'left' : r.rightTableOccurrenceId === to.id ? 'right' : undefined;
    if (!mine || r.leftTableOccurrenceId === r.rightTableOccurrenceId) continue;
    const p = r.predicates[0];
    if (!p || p.operator !== '=') continue;
    const other = schema.tableOccurrences.find((o) => o.id === (mine === 'left' ? r.rightTableOccurrenceId : r.leftTableOccurrenceId));
    const table = other && !other.dataSourceId ? schema.tables.find((t) => t.id === other.baseTableId) : undefined;
    const local = mine === 'left' ? p.leftField : p.rightField;
    const remote = mine === 'left' ? p.rightField : p.leftField;
    if (!other || !table || !local || !remote) continue;
    out.push({ other, table, local, remote });
  }
  return out;
}

/**
 * The fields a layout shows from its own table occurrence, top to bottom and left to right (a row is objects within a few
 * points of its top), with how the layout draws each: its control style, whether it is view only, the label beside it and
 * the value list it uses.
 */
function shownFields(objects: LayoutObject[], occurrenceId: number, table: Table, schema: Schema): LayoutField[] {
  const found: { field: LayoutField; top: number; left: number }[] = [];
  const walk = (list: LayoutObject[]) => {
    const labels = labelsOf(list);
    for (const o of list) {
      if (o.field && o.field.tableOccurrenceId === occurrenceId) {
        const f = table.fields.find((x) => x.id === o.field!.fieldId);
        if (f) {
          const vl = o.field.valueListId !== undefined ? schema.valueLists.find((v) => v.id === o.field!.valueListId) : o.field.valueList ? schema.valueLists.find((v) => v.name === o.field!.valueList) : undefined;
          const entry = o.field.behavior?.browse;
          const label = labels.get(o);
          found.push({ top: o.bounds.top, left: o.bounds.left, field: {
            name: f.name, display: o.field.display, ...(entry ? { viewOnly: true } : {}), ...(label ? { label } : {}),
            ...(vl ? { valueList: vl.name, ...(vl.values?.length ? { values: vl.values } : {}) } : {}),
          } });
        }
      }
      // A portal's fields belong to the related table.
      if (o.children?.length && !o.portal) walk(o.children);
    }
  };
  walk(objects);
  found.sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: typeof found[] = [];
  for (const f of found) {
    const row = rows[rows.length - 1];
    if (row && f.top - row[0].top <= ROW) row.push(f);
    else rows.push([f]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.left - b.left)).map((f) => f.field);
}

/** Each field's label among the objects beside each other: the plain words drawn just left of it on its row, or just above it. */
function labelsOf(list: LayoutObject[]): Map<LayoutObject, string> {
  const texts = list.flatMap((t) => {
    if (t.kind !== 'text' || !t.text) return [];
    // Plain words only: merge fields and symbols aren't a label, and neither is a paragraph.
    const words = t.text.replace(/<<[^<>]*>>|\{\{\w+\}\}/g, '').trim().replace(/\s*:$/, '');
    return words && words.length <= 60 && !/\n/.test(words) ? [{ b: t.bounds, words }] : [];
  });
  const out = new Map<LayoutObject, string>();
  for (const o of list) {
    if (o.kind !== 'field' || !texts.length) continue;
    const f = o.bounds;
    const middle = (b: typeof f) => (b.top + b.bottom) / 2;
    const left = texts.filter((t) => t.b.right <= f.left + 2 && f.left - t.b.right <= 60 && middle(t.b) >= f.top && middle(t.b) <= f.bottom).sort((a, b) => b.b.right - a.b.right)[0];
    const above = texts.filter((t) => t.b.bottom <= f.top + 2 && f.top - t.b.bottom <= 24 && Math.abs(t.b.left - f.left) <= 20).sort((a, b) => b.b.bottom - a.b.bottom)[0];
    const label = left ?? above;
    if (label) out.set(o, label.words);
  }
  return out;
}
const ROW = 8;

/**
 * The buttons of a layout that perform a script, top to bottom and left to right. A button's parameter is a formula; one
 * that is a fixed text or number is kept, and a button whose parameter needs working out is counted in `skipped` instead,
 * since the page could not give the script what the layout's button would.
 */
function buttonsOf(objects: LayoutObject[], schema: Schema): { buttons: PlanButton[]; skipped: number } {
  const found: { b: PlanButton; top: number; left: number }[] = [];
  let skipped = 0;
  const walk = (list: LayoutObject[]) => {
    for (const o of list) {
      const a = o.kind === 'button' && o.action?.stepId === 1 ? o.action : undefined;
      const script = a && (a.script ?? schema.scripts.find((x) => x.id === a.scriptId)?.name);
      if (a && script) {
        const literal = a.parameter?.trim();
        const text = literal === undefined || literal === '' ? '' : /^"((?:[^"\\]|\\.)*)"$/.exec(literal)?.[1].replace(/\\(.)/g, '$1') ?? (/^-?\d+(?:\.\d+)?$/.test(literal) ? literal : undefined);
        const label = (o.text ?? '').replace(/\s+/g, ' ').trim();
        if (text === undefined) skipped++;
        else if (!found.some((f) => f.b.script === script && f.b.parameter === (text || undefined))) {
          found.push({ b: { label: label && !label.includes('<<') ? label.slice(0, 40) : script, script, ...(text ? { parameter: text } : {}) }, top: o.bounds.top, left: o.bounds.left });
        }
      }
      if (o.children?.length && !o.portal) walk(o.children);
    }
  };
  walk(objects);
  found.sort((x, y) => x.top - y.top || x.left - y.left);
  return { buttons: found.slice(0, 6).map((f) => f.b), skipped: skipped + Math.max(0, found.length - 6) };
}

/** The portals of a layout, with the fields each shows from its own table occurrence, left to right. */
function portalsOf(objects: LayoutObject[], schema: Schema): { occurrenceId: number; fields: string[] }[] {
  const out: { occurrenceId: number; fields: string[] }[] = [];
  const walk = (list: LayoutObject[]) => {
    for (const o of list) {
      if (o.portal && !out.some((p) => p.occurrenceId === o.portal!.tableOccurrenceId)) {
        const to = schema.tableOccurrences.find((x) => x.id === o.portal!.tableOccurrenceId);
        const table = to && !to.dataSourceId ? schema.tables.find((t) => t.id === to.baseTableId) : undefined;
        const found: { name: string; left: number }[] = [];
        const inside = (kids: LayoutObject[]) => {
          for (const k of kids) {
            const f = k.field && k.field.tableOccurrenceId === o.portal!.tableOccurrenceId ? table?.fields.find((x) => x.id === k.field!.fieldId) : undefined;
            if (f) found.push({ name: f.name, left: k.bounds.left });
            if (k.children?.length) inside(k.children);
          }
        };
        inside(o.children ?? []);
        if (found.length) out.push({ occurrenceId: o.portal.tableOccurrenceId, fields: [...new Set(found.sort((a, b) => a.left - b.left).map((f) => f.name))] });
      } else if (o.children?.length) walk(o.children);
    }
  };
  walk(objects);
  return out;
}

/**
 * The layouts for a file, drafted and checked but not saved: `changes` makes them (and the folder), for the person to
 * see first. Layouts of the same name that are already there are left alone, so asking again only adds what is missing.
 */
export function modernizeChange(store: Store, req: ModernizeRequest = {}): ModernizeResult {
  assertAiPolicy(store, undefined, 'modernize interfaces');
  const schema = store.schema;
  // A native file's pages read and write ISO dates; a compat file's plan stays as it was.
  const native = store.fileMode === 'native' ? { native: true as const } : {};
  // No kinds at all is fine when the layouts of the file are what to follow.
  const styles = req.fromLayouts === true && Array.isArray(req.styles) && !req.styles.length ? [] : pick(req.styles, STYLES, 'styles', DEFAULT_STYLES);
  const wanted = req.tables === undefined ? undefined : Array.isArray(req.tables) && req.tables.every((t) => typeof t === 'string') ? (req.tables as string[]) : (() => { throw new Error('tables is a list of table names'); })();
  const all = schema.tables.filter((t) => occurrenceOf(schema, t));
  for (const n of wanted ?? []) if (!all.some((t) => lower(t.name) === lower(n))) throw new Error(`This file has no table "${n}"; its tables: ${all.map((t) => t.name).join(', ')}`);
  const chosen = all.filter((t) => !wanted || wanted.some((n) => lower(n) === lower(t.name)));

  const skipped: ModernizeResult['skipped'] = [];
  const planned: { table: Table; to: TableOccurrence; plan: ModernTable }[] = [];
  for (const t of chosen) {
    const m = modernTable(schema, t);
    const why = whyNot(m);
    if (why) skipped.push({ table: t.name, why });
    else planned.push({ table: t, to: occurrenceOf(schema, t)!, plan: m });
  }

  const taken = new Set(schema.layouts.map((l) => lower(l.name)));
  const layouts: ModernizedLayout[] = [];
  const changes: DesignOp[] = [];
  const names: string[] = [];
  const listName = (t: string) => `${t} - ${SUFFIX['modern-list']}`;
  // A list of a related table is where a form reads its related records, so only tables that get a modern list are linked to.
  const hasList = new Set(styles.includes('modern-list') ? planned.map((p) => p.table.id) : []);

  for (const { table, to, plan } of planned) {
    const related: PlanRelated[] = [];
    for (const l of links(schema, to)) {
      if (related.length >= 3 || !hasList.has(l.table.id) || l.table.id === table.id || related.some((r) => r.layout === listName(l.table.name))) continue;
      const other = planned.find((p) => p.table.id === l.table.id)!;
      // The related table's name reads better than its occurrence's ("project.EMBEDDING~create").
      related.push({ label: l.table.name, layout: listName(l.table.name), local: l.local, remote: l.remote, columns: planInterface(other.plan).columns.slice(0, 4).map((c) => c.name) });
    }
    const interfacePlan: InterfacePlan = { ...planInterface(plan, related), ...native };
    for (const style of styles) {
      const name = `${table.name} - ${SUFFIX[style]}`;
      if (taken.has(lower(name))) { skipped.push({ table: table.name, style, why: `There is already a layout "${name}"` }); continue; }
      const mode = MODE[style];
      const notes: string[] = [];
      const view = VIEW[style];
      const lacks = view === 'board' && !interfacePlan.board ? 'a status or stage field to make columns from' : view === 'calendar' && !interfacePlan.calendar ? 'a date field to place records on' : undefined;
      if (lacks) { skipped.push({ table: table.name, style, why: `There is no ${lacks}` }); continue; }
      let samples: Samples | undefined;
      if (mode) {
        const html = interfacePage(name, interfacePlan, mode, view);
        changes.push({ op: 'createLayout', name, occurrence: to.id, design: modernDesign(name, name, html) } as DesignOp);
        samples = samplesOf(name, interfacePlan, Object.fromEntries(related.map((r) => [r.layout, planInterface(planned.find((p) => listName(p.table.name) === r.layout)!.plan)])));
        notes.push(view === 'board' ? `Columns by ${interfacePlan.board!.label}${interfacePlan.board!.values ? `: ${interfacePlan.board!.values.join(', ')}` : ' (one for each value the records hold)'}.`
          : view === 'calendar' ? `Records placed by ${interfacePlan.calendar!.label}.` : `Columns: ${interfacePlan.columns.map((c) => c.label).join(', ')}.`);
        if (related.length && mode !== 'list') notes.push(`Related records under the form: ${related.map((r) => r.label).join(', ')}.`);
        const size = html.length;
        if (size > FORMULA_LIMIT - 4000) notes.push(`The page is ${size.toLocaleString()} characters; FileMaker Pro takes up to ${FORMULA_LIMIT.toLocaleString()} in a formula, so it may show only in Tabularius.`);
      } else {
        const body = interfacePlan.fields.filter((f) => !f.system && f.control !== 'container');
        const fields = (style === 'classic-list' ? interfacePlan.columns : body).map((f) => f.name);
        const reach = relatedOccurrences(schema, to.id);
        const portals = style === 'classic-form'
          ? links(schema, to).filter((l) => reach.has(l.other.id)).filter((l, i, a) => a.findIndex((x) => x.other.id === l.other.id) === i).slice(0, 2)
            .map((l) => ({ occurrence: l.other.name, fields: planInterface(modernTable(schema, l.table)).columns.slice(0, 4).map((c) => c.name), rows: 5 }))
          : [];
        const draft = draftLayoutChange(store, { name, occurrence: to.id, view: style === 'classic-list' ? 'list' : 'form', fields, ...(portals.length ? { portals } : {}) });
        changes.push(...draft.changes);
        notes.push(...draft.notes);
      }
      taken.add(lower(name));
      names.push(name);
      layouts.push({ name, table: table.name, style, notes, ...(samples ? { samples } : {}) });
    }
  }

  if (req.fromLayouts !== undefined && typeof req.fromLayouts !== 'boolean') throw new Error('fromLayouts is true or false');
  if (req.fromLayouts) {
    const chosenIds = new Set(chosen.map((t) => t.id));
    for (const layout of store.designs().layouts) {
      const to = schema.tableOccurrences.find((o) => o.id === layout.tableOccurrenceId && !o.dataSourceId);
      const table = to && schema.tables.find((t) => t.id === to.baseTableId);
      if (!to || !table || !chosenIds.has(table.id)) continue;
      const shown = shownFields(layout.objects, to.id, table, schema);
      // Layouts with no fields of their own (the modern ones, a menu) have nothing to follow.
      if (!shown.length) continue;
      const name = `${layout.name} - Modern`;
      if (taken.has(lower(name))) { skipped.push({ table: table.name, why: `There is already a layout "${name}"` }); continue; }
      const m = modernTable(schema, table);
      // A portal becomes a list of the related records under the form, read through the related table's modern list, else
      // through a layout the file already has on that table; with neither, there is nothing to read them by.
      const related: PlanRelated[] = [];
      const relatedPlans: Record<string, InterfacePlan> = {};
      for (const p of portalsOf(layout.objects, schema)) {
        const l = links(schema, to).find((x) => x.other.id === p.occurrenceId);
        if (!l || related.length >= 3 || related.some((r) => r.label === l.table.name)) continue;
        const own = `${l.table.name} - ${SUFFIX['modern-list']}`;
        const through = taken.has(lower(own)) ? own : store.designs().layouts.find((x) => schema.tableOccurrences.find((o) => o.id === x.tableOccurrenceId)?.baseTableId === l.table.id)?.name;
        if (!through) continue;
        related.push({ label: l.table.name, layout: through, local: l.local, remote: l.remote, columns: p.fields.slice(0, 4) });
        relatedPlans[through] = planInterface(modernTable(schema, l.table));
      }
      const { buttons, skipped: unbuttoned } = buttonsOf(layout.objects, schema);
      const interfacePlan = { ...planFromLayout(m, shown, layout.name, related, buttons), ...native };
      if (interfacePlan.columns.length < 2) { skipped.push({ table: table.name, why: `The layout "${layout.name}" shows fewer than two fields a list could use` }); continue; }
      const html = interfacePage(name, interfacePlan, 'split');
      changes.push({ op: 'createLayout', name, occurrence: to.id, design: modernDesign(name, name, html) } as DesignOp);
      const notes = [`Made from the layout "${layout.name}": ${interfacePlan.fields.length} field${interfacePlan.fields.length === 1 ? '' : 's'} in the order it shows them.`, `Columns: ${interfacePlan.columns.map((c) => c.label).join(', ')}.`];
      if (related.length) notes.push(`Related records under the form, from the layout's portals: ${related.map((r) => r.label).join(', ')}.`);
      if (buttons.length) notes.push(`Buttons from the layout that perform a script: ${buttons.map((b) => b.label).join(', ')}. They run in the window as it is, so on the record the window shows.`);
      if (unbuttoned) notes.push(`${unbuttoned} script button${unbuttoned === 1 ? '' : 's'} left out because the parameter is worked out by a formula (or there were more than 6).`);
      if (html.length > FORMULA_LIMIT - 4000) notes.push(`The page is ${html.length.toLocaleString()} characters; FileMaker Pro takes up to ${FORMULA_LIMIT.toLocaleString()} in a formula, so it may show only in Tabularius.`);
      taken.add(lower(name));
      names.push(name);
      layouts.push({ name, table: table.name, style: 'modern-split', notes, samples: samplesOf(name, interfacePlan, relatedPlans) });
    }
  }

  if (req.folder !== false && names.length) changes.push(folderChange(schema, names));
  return { layouts, skipped, changes };
}

/** The Layouts list with the new layouts at the end of a folder, everything else where it was. */
function folderChange(schema: Schema, names: string[]): DesignOp {
  type Spec = ReturnType<typeof orderTree>[number];
  const root = orderTree(schema.layoutOrder, schema.layouts);
  const find = (list: Spec[]): { children: Spec[] } | undefined => {
    for (const e of list) if ('folder' in e) { if (e.folder === FOLDER) return e; const x = find(e.children); if (x) return x; }
    return undefined;
  };
  let folder = find(root);
  if (!folder) { const made: Spec = { folder: FOLDER, children: [] }; root.push(made); folder = made as { children: Spec[] }; }
  folder.children.push(...names.map((n) => ({ item: n })));
  return { op: 'setOrder', list: 'layouts', order: root };
}
