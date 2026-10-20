// Drafting a new layout the way the file's own layouts look: its most used
// theme (or another layout's), each kind of object styled as it most often is
// on the file's layouts, part by part, and the components the file puts in its
// headers and footers placed where they usually sit. For the assistant's "make
// a list layout of open invoices with totals"; the draft is what createLayout's
// `design` sets, shown to a person (with Check) before it's applied.

import type { Field, LayoutComponent, LayoutDesign, LayoutDesigns, LayoutObject, LayoutPart, ObjectStyle, Schema } from '../../fmp12/src/index.ts';
import { placeComponent } from './components.ts';
import { FIELD_STYLE, LABEL_STYLE, TITLE_STYLE } from './design.ts';

export interface DraftSpec {
  /** The layout's title. */
  title: string;
  occurrence: number;
  view: 'list' | 'form';
  /** Fields of the occurrence's table, in order; default the first eight that aren't containers or globals. */
  fields?: number[];
  /** Summary fields of the table, shown in a trailing grand summary under the column of the field each summarizes (list only). */
  totals?: number[];
  /** Take the theme and looks from this layout instead of the whole file. */
  like?: LayoutDesign;
  /** Form only: portals of related records below the fields (line items), each with its columns, and totals of them under it. */
  portals?: DraftPortal[];
  /**
   * List only, a report: fields to group the records by, outermost first. Each gets a sub-summary part above its group
   * showing its value and the totals for the group; they show when the records are sorted by these fields.
   */
  groups?: number[];
  /** A report of the groups' totals only, without a row for each record. */
  summaryOnly?: boolean;
  /** List only: a chart of the found set at the top, one bar (or slice, or point) per value of `category`, sized by `value` (a summary field). */
  chart?: { type: 'column' | 'bar' | 'line' | 'area' | 'pie'; category: number; value: number; title?: string };
}

export interface DraftPortal {
  /** A related table occurrence. */
  occurrence: number;
  /** Its table's fields, as columns. */
  fields: number[];
  /** Rows shown; default 5. */
  rows?: number;
  /** Fields of the layout's own table shown under the portal (a calculation summing a column), and the column each goes under. */
  totals?: { field: number; under?: number }[];
}

export interface Draft {
  design: Partial<LayoutDesign>;
  /** How it was made to match the file, a line each. */
  notes: string[];
}

type Area = 'header' | 'body' | 'summary' | 'footer';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const anchors = { left: true, top: true, right: false, bottom: false };

function areaOf(kind: LayoutPart['kind']): Area {
  if (kind === 'body') return 'body';
  if (kind.includes('summary')) return 'summary';
  if (kind.includes('footer') || kind === 'bottom-navigation') return 'footer';
  return 'header';
}

/** Tallies of whole styles (element included), most common wins. */
class Tally {
  private counts = new Map<string, Map<string, { value: unknown; n: number }>>();
  add(key: string, value: unknown): void {
    const byValue = this.counts.get(key) ?? this.counts.set(key, new Map()).get(key)!;
    const k = JSON.stringify(value);
    const e = byValue.get(k) ?? byValue.set(k, { value, n: 0 }).get(k)!;
    e.n++;
  }
  top<T>(key: string): { value: T; n: number } | undefined {
    const all = [...(this.counts.get(key)?.values() ?? [])].sort((a, b) => b.n - a.n);
    return all[0] as { value: T; n: number } | undefined;
  }
}

/** The file's layouts a draft should look like: real ones, not phone copies, on the chosen theme where any are. */
function models(designs: LayoutDesigns, like: LayoutDesign | undefined): { layouts: LayoutDesign[]; themeId?: number; themeNote: string } {
  const themeName = (id: number | undefined) => designs.themes.find((t) => t.id === id)?.name ?? 'no theme';
  if (like) return { layouts: [like], themeId: like.themeId, themeNote: `Theme ${themeName(like.themeId)}, as on ${like.name}.` };
  const real = designs.layouts.filter((d) => !d.phone && d.objects.length);
  const themes = new Tally();
  for (const d of real) if (d.themeId !== undefined) themes.add('t', d.themeId);
  const used = themes.top<number>('t');
  const themeId = used?.value ?? designs.themes[0]?.id;
  const layouts = real.filter((d) => d.themeId === themeId);
  const themeNote = used ? `Theme ${themeName(themeId)}, the one ${plural(used.n, 'layout')} in the file use${used.n === 1 ? 's' : ''}.`
    : themeId !== undefined ? `Theme ${themeName(themeId)}.` : 'No theme: the file has none.';
  return { layouts: layouts.length ? layouts : real, themeId, themeNote };
}

/** A style and how tall objects with it usually are, which follows from its font. */
interface Look { style: ObjectStyle; height: number }

interface Looks {
  look(role: string): Look | undefined;
  part(area: Area): ObjectStyle | undefined;
  layout?: ObjectStyle;
  /** The component most often placed in each area, where it sits from the part's top, and on how many layouts. */
  component(area: Area): { id: number; left: number; top: number; n: number } | undefined;
}

/** How the model layouts style each kind of object, part and the layout, and the components they place. */
function looksOf(layouts: LayoutDesign[]): Looks {
  const t = new Tally();
  const heights = new Map<string, number[]>();
  const add = (role: string, o: LayoutObject) => {
    t.add(role, o.style);
    const k = `${role}|${JSON.stringify(o.style)}`;
    (heights.get(k) ?? heights.set(k, []).get(k)!).push(o.bounds.bottom - o.bounds.top);
  };
  for (const d of layouts) {
    const parts = [...d.parts].sort((a, b) => a.top - b.top);
    const partAt = (top: number) => parts.filter((p) => top >= p.top).pop() ?? parts[0];
    for (const p of parts) t.add(`part:${areaOf(p.kind)}`, p.style);
    t.add('layout', d.style);
    // The title: the tallest text in the header.
    let title: LayoutObject | undefined;
    for (const o of d.objects) {
      const p = partAt(o.bounds.top);
      if (!p) continue;
      const area = areaOf(p.kind);
      if (o.component) {
        t.add(`component:${area}`, { id: o.component.id, left: o.bounds.left, top: o.bounds.top - p.top });
        continue;
      }
      if (o.kind === 'text' && area === 'header' && (!title || o.bounds.bottom - o.bounds.top > title.bounds.bottom - title.bounds.top)) title = o;
    }
    if (title) add('title', title);
    for (const o of d.objects) {
      const p = partAt(o.bounds.top);
      if (!p || o.component || o === title) continue;
      const area = areaOf(p.kind);
      if (o.kind === 'field') add(`field:${area}`, o);
      else if (o.kind === 'text') add(`label:${area}`, o);
      else if (o.kind === 'portal') {
        add('portal', o);
        for (const c of o.children ?? []) if (c.kind === 'field') add('field:portal', c);
      }
    }
  }
  return {
    look: (role) => {
      const style = t.top<ObjectStyle>(role)?.value;
      if (!style) return undefined;
      const hs = [...heights.get(`${role}|${JSON.stringify(style)}`)!].sort((a, b) => a - b);
      return { style, height: Math.round(Math.min(120, Math.max(12, hs[hs.length >> 1]))) };
    },
    part: (area) => t.top<ObjectStyle>(`part:${area}`)?.value,
    layout: t.top<ObjectStyle>('layout')?.value,
    component: (area) => {
      const top = t.top<{ id: number; left: number; top: number }>(`component:${area}`);
      return top && { ...top.value, n: top.n };
    },
  };
}

/** A column's width for a field's type. */
function columnWidth(f: Field): number {
  return f.type === 'number' ? 100 : f.type === 'date' || f.type === 'time' ? 100 : f.type === 'timestamp' ? 150 : 160;
}

export function draftLayout(schema: Schema, designs: LayoutDesigns, spec: DraftSpec): Draft {
  const to = schema.tableOccurrences.find((x) => x.id === spec.occurrence);
  const table = to && !to.dataSourceId ? schema.tables.find((x) => x.id === to.baseTableId) : undefined;
  if (!to || !table) throw new Error('A drafted layout needs an occurrence of a table in this file');
  const byId = new Map(table.fields.map((f) => [f.id, f]));
  const fields = spec.fields?.length
    ? spec.fields.map((id) => byId.get(id)!).filter(Boolean)
    : table.fields.filter((f) => f.type !== 'container' && f.type !== 'unknown' && !f.options?.global && f.kind !== 'summary').slice(0, 8);
  const totals = (spec.totals ?? []).map((id) => byId.get(id)!).filter((f) => f?.kind === 'summary');
  if (totals.length && spec.view !== 'list') throw new Error('Totals go on a list layout (a grand summary shows below the records there); on a form, total a portal\'s column instead');
  if (spec.portals?.length && spec.view !== 'form') throw new Error('Portals go on a form layout');
  const groups = (spec.groups ?? []).map((id) => byId.get(id)).filter((f): f is Field => !!f);
  if ((groups.length || spec.chart || spec.summaryOnly) && spec.view !== 'list') throw new Error('Groups, summary-only reports and charts go on a list layout');
  if (spec.summaryOnly && !groups.length) throw new Error('A summary-only report needs fields to group by');
  const chartValue = spec.chart && byId.get(spec.chart.value);
  const chartCategory = spec.chart && byId.get(spec.chart.category);
  if (spec.chart && (!chartValue || chartValue.kind !== 'summary' || !chartCategory)) throw new Error('A chart needs a field of the table for its categories and a summary field for its values');

  const { layouts, themeId, themeNote } = models(designs, spec.like);
  const looks = looksOf(layouts);
  const themed = themeId !== undefined;
  const fallback = { field: { style: themed ? { element: 61 } : FIELD_STYLE, height: 22 }, label: { style: themed ? { element: 70 } : LABEL_STYLE, height: 20 }, title: { style: TITLE_STYLE, height: 26 } };
  /** The look for a role, else the next role's, else the generated layouts' look. */
  const look = (...roles: (string | Look)[]): Look => {
    for (const r of roles) {
      const l = typeof r === 'string' ? looks.look(r) : r;
      if (l) return { style: clone(l.style), height: l.height };
    }
    return clone(fallback.field);
  };
  const notes = [themeNote];
  if (layouts.length) notes.push(spec.like ? `Fields, labels, title and parts styled as on ${spec.like.name}.` : `Fields, labels, title and parts styled as they most often are on the file's ${plural(layouts.length, 'layout')} with that theme.`);

  const components = designs.components ?? [];
  const usual = (area: Area): (ReturnType<Looks['component']> & { c: LayoutComponent }) | undefined => {
    const u = looks.component(area);
    const c = u && components.find((x) => x.id === u.id);
    return u && c ? { ...u, c } : undefined;
  };
  const headerComponent = usual('header');
  const footerComponent = usual('footer');

  const objects: LayoutObject[] = [];
  let next = 1;
  const text = (top: number, left: number, right: number, l: Look, value: string) =>
    objects.push({ id: next++, kind: 'text', type: 2, bounds: { top, left, bottom: top + l.height, right }, anchors, style: clone(l.style), text: value });
  const field = (top: number, left: number, right: number, f: Field, l: Look) => objects.push({
    id: next++, kind: 'field', type: 1, bounds: { top, left, bottom: top + l.height, right }, anchors, style: clone(l.style),
    field: { tableOccurrenceId: to.id, fieldId: f.id, tableOccurrence: to.name, field: f.name, display: 'edit', repetitions: 1 },
  });

  // The header: the usual header component, then the title (and a list's column labels) below it.
  const title = look('title', fallback.title);
  const titleAt = headerComponent ? Math.max(headerComponent.top + headerComponent.c.height + 8, 12) : 12;
  const y = titleAt + title.height + 8;
  let width = 560;
  const parts: LayoutPart[] = [];
  const fieldLook = look('field:body', fallback.field);
  if (spec.view === 'list') {
    const cols: { f: Field; left: number; right: number }[] = [];
    let left = 20;
    // A summary-only report's columns are what it groups by; its totals follow them.
    for (const f of spec.summaryOnly ? groups : fields) {
      cols.push({ f, left, right: left + columnWidth(f) - 10 });
      left += columnWidth(f);
    }
    // Totals of fields not shown as a column go after the last one.
    const extra = totals.filter((s) => !cols.some((c) => c.f.id === s.summary?.fieldId));
    const end = left + extra.length * 110;
    width = Math.max(width, end + 10, headerComponent ? headerComponent.left + headerComponent.c.width + 20 : 0);
    text(titleAt, 20, width - 20, title, spec.title);
    const label = look('label:header', 'label:body', fallback.label);
    for (const c of cols) text(y, c.left, c.right, label, c.f.name);
    const header = y + label.height + 6;
    parts.push({ kind: 'header', kindId: 1, top: 0, height: header, style: clone(looks.part('header') ?? {}) });
    if (spec.summaryOnly) for (const [i, s] of totals.filter((s) => !cols.some((c) => c.f.id === s.summary?.fieldId)).entries()) text(y, left + i * 110, left + i * 110 + 100, label, s.name);
    let top = header;
    const sum = look('field:summary', fieldLook);
    const sumLabel = look('label:summary', label);
    const sumHeight = Math.max(sum.height, sumLabel.height) + 12;
    /** The totals in a row under their columns (those not shown as one after the last), with `first` in the first column. */
    const totalsRow = (at: number, first: { label: string } | { field: Field } | undefined) => {
      const col0 = cols[0];
      if (col0 && first && !totals.some((s) => s.summary?.fieldId === col0.f.id)) {
        if ('label' in first) text(at + 6, col0.left, col0.right, sumLabel, first.label);
        else field(at + 6, (cols.find((c) => c.f.id === first.field.id) ?? col0).left, (cols.find((c) => c.f.id === first.field.id) ?? col0).right, first.field, sum);
      }
      let x = left;
      for (const s of totals) {
        const col = cols.find((c) => c.f.id === s.summary?.fieldId);
        const l = col?.left ?? x;
        const r = col?.right ?? x + 100;
        if (!col) x += 110;
        field(at + 6, l, r, s, sum);
      }
    };
    if (spec.chart && chartValue && chartCategory) {
      // A chart of the whole found set, one data point per group of records sorted by its category.
      const height = 260;
      const right = Math.max(500, Math.min(width - 20, 700));
      objects.push({
        id: next++, kind: 'chart', type: 13, external: 'CHRT', bounds: { top: top + 10, left: 20, bottom: top + height - 10, right }, anchors, style: {},
        chart: {
          type: spec.chart.type, source: 'found-set', grouped: true, title: JSON.stringify(spec.chart.title ?? `${chartValue.name} by ${chartCategory.name}`),
          categories: `${to.name}::${chartCategory.name}`, xTitle: JSON.stringify(chartCategory.name), yTitle: JSON.stringify(chartValue.name),
          series: [{ data: `${to.name}::${chartValue.name}`, name: JSON.stringify(chartValue.name) }],
        },
      });
      width = Math.max(width, right + 20);
      parts.push({ kind: 'leading-grand-summary', kindId: 2, top, height, style: clone(looks.part('summary') ?? looks.part('body') ?? {}) });
      top += height;
      notes.push(`A ${spec.chart.type} chart of ${chartValue.name} by ${chartCategory.name} at the top, one ${spec.chart.type === 'pie' ? 'slice' : 'point'} per ${chartCategory.name} when the records are sorted by it.`);
    }
    // A sub-summary part per group, outermost first, each with the group's value and its totals.
    for (const g of groups) {
      totalsRow(top, { field: g });
      parts.push({ kind: 'sub-summary-leading', kindId: 3, top, height: sumHeight, style: clone(looks.part('summary') ?? looks.part('body') ?? {}),
        breakField: { tableOccurrenceId: to.id, fieldId: g.id, tableOccurrence: to.name, field: g.name } });
      top += sumHeight;
    }
    if (groups.length) notes.push(`Grouped by ${groups.map((g) => g.name).join(', then ')}: a sub-summary for each, with ${totals.length ? totals.map((s) => s.name).join(', ') : 'its value'}. The groups show when the records are sorted by ${groups.map((g) => g.name).join(', ')}.`);
    if (spec.summaryOnly) {
      // No row per record: only the groups' totals show.
      parts.push({ kind: 'body', kindId: 4, top, height: 0, style: clone(looks.part('body') ?? {}) });
      notes.push('Totals only: no row for each record.');
    } else {
      for (const c of cols) field(top + 4, c.left, c.right, c.f, fieldLook);
      const row = fieldLook.height + 8;
      parts.push({ kind: 'body', kindId: 4, top, height: row, style: clone(looks.part('body') ?? {}) });
      top += row;
    }
    if (totals.length) {
      totalsRow(top, { label: 'Total' });
      parts.push({ kind: 'trailing-grand-summary', kindId: 6, top, height: sumHeight, style: clone(looks.part('summary') ?? looks.part('body') ?? {}) });
      top += sumHeight;
      notes.push(`${totals.map((s) => s.name).join(', ')} in a grand summary below the records.`);
    }
    parts.push({ kind: 'footer', kindId: 7, top, height: footerComponent ? Math.max(30, footerComponent.top + footerComponent.c.height + 8) : 30, style: clone(looks.part('footer') ?? {}) });
  } else {
    width = Math.max(width, headerComponent ? headerComponent.left + headerComponent.c.width + 20 : 0);
    text(titleAt, 20, width - 20, title, spec.title);
    const header = y;
    parts.push({ kind: 'header', kindId: 1, top: 0, height: header, style: clone(looks.part('header') ?? {}) });
    const label = look('label:body', 'label:header', fallback.label);
    const row = Math.max(fieldLook.height, label.height) + 8;
    fields.forEach((f, i) => {
      const top = header + 20 + i * row;
      text(top, 20, 150, label, f.name);
      field(top, 160, Math.min(width - 40, 520), f, fieldLook);
    });
    let bottom = header + 20 + fields.length * row;
    // Portals of related records, each under column headings, with its totals below it.
    const portalLook = look('portal', { style: { element: 83 }, height: 0 });
    const cellLook = look('field:portal', fieldLook);
    for (const p of spec.portals ?? []) {
      const rto = schema.tableOccurrences.find((x) => x.id === p.occurrence);
      const rtable = rto && !rto.dataSourceId ? schema.tables.find((x) => x.id === rto.baseTableId) : undefined;
      if (!rto || !rtable) throw new Error('A portal needs an occurrence of a table in this file');
      const rById = new Map(rtable.fields.map((f) => [f.id, f]));
      const cols: { f: Field; left: number; right: number }[] = [];
      let left = 24;
      for (const id of p.fields) {
        const f = rById.get(id);
        if (!f) continue;
        cols.push({ f, left, right: left + columnWidth(f) - 4 });
        left += columnWidth(f);
      }
      if (!cols.length) throw new Error(`A portal of ${rto.name} needs at least one of its fields`);
      const rows = Math.max(1, Math.min(50, Math.round(p.rows ?? 5)));
      const rowH = cellLook.height + 4;
      const headingTop = bottom + 12;
      for (const c of cols) text(headingTop, c.left, c.right, label, c.f.name);
      const top = headingTop + label.height + 4;
      const portal: LayoutObject = {
        id: next++, kind: 'portal', type: 9, bounds: { top, left: 20, bottom: top + rows * rowH + 4, right: left + 4 }, anchors, style: clone(portalLook.style),
        name: rto.name, portal: { tableOccurrenceId: rto.id, tableOccurrence: rto.name, rows, initialRow: 1, scrolling: true },
        children: cols.map((c) => ({
          id: next++, kind: 'field', type: 1, bounds: { top: top + 2, left: c.left, bottom: top + 2 + cellLook.height, right: c.right }, anchors, style: clone(cellLook.style),
          field: { tableOccurrenceId: rto.id, fieldId: c.f.id, tableOccurrence: rto.name, field: c.f.name, display: 'edit', repetitions: 1 },
        })),
      };
      objects.push(portal);
      width = Math.max(width, left + 24);
      bottom = portal.bounds.bottom;
      const sums = (p.totals ?? []).map((t) => ({ f: byId.get(t.field), under: cols.find((c) => c.f.id === t.under) })).filter((t): t is { f: Field; under: typeof cols[number] | undefined } => !!t.f);
      sums.forEach((t, i) => {
        const at = bottom + 6 + i * row;
        const col = t.under ?? cols[cols.length - 1];
        field(at, col.left, col.right, t.f, fieldLook);
        // Its name to its left, or to its right under the first column.
        if (col.left - 26 >= 60) text(at, Math.max(20, col.left - 136), col.left - 6, label, t.f.name);
        else {
          text(at, col.right + 6, col.right + 136, label, t.f.name);
          width = Math.max(width, col.right + 156);
        }
      });
      bottom += sums.length ? 6 + sums.length * row : 0;
      notes.push(`A portal of ${rto.name} (${plural(rows, 'row')}: ${cols.map((c) => c.f.name).join(', ')})${sums.length ? `, with ${sums.map((t) => t.f.name).join(', ')} under it` : ''}.`);
    }
    const body = Math.max(120, bottom - header + 20);
    parts.push({ kind: 'body', kindId: 4, top: header, height: body, style: clone(looks.part('body') ?? {}) });
    parts.push({ kind: 'footer', kindId: 7, top: header + body, height: footerComponent ? Math.max(40, footerComponent.top + footerComponent.c.height + 8) : 40, style: clone(looks.part('footer') ?? {}) });
  }

  // Components last, so their objects take ids after the draft's own.
  const taken = new Set(objects.map((o) => o.id));
  for (const [u, area] of [[headerComponent, 'header'], [footerComponent, 'footer']] as const) {
    if (!u) continue;
    const part = parts.find((p) => areaOf(p.kind) === area)!;
    objects.push(placeComponent(u.c, { top: part.top + u.top, left: u.left }, taken));
    notes.push(`The "${u.c.name}" component in the ${area}, where ${plural(u.n, 'layout')} ${u.n === 1 ? 'has' : 'have'} it.`);
  }

  const design: Partial<LayoutDesign> = {
    width, style: clone(looks.layout ?? {}), parts, objects, view: spec.view,
    ...(themeId !== undefined ? { themeId } : {}),
    tableView: fields.map((f) => ({ field: { tableOccurrenceId: to.id, fieldId: f.id, tableOccurrence: to.name, field: f.name }, width: 120 })),
  };
  return { design, notes };
}

/** One object where a picture (a screenshot or a sketch) shows it, in layout points from its part's top left. */
export interface ArrangedObject {
  kind: 'field' | 'label' | 'title' | 'button' | 'portal' | 'rectangle' | 'line';
  /** Index into the arrangement's parts. */
  part: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** A field: its occurrence (the layout's, or one related to it) and field. */
  field?: { occurrence: number; field: number };
  /** A label, title or button's text. */
  text?: string;
  /** A portal: a related occurrence, its fields as columns, and rows shown. */
  portal?: { occurrence: number; fields: number[]; rows?: number };
}

export interface ArrangedSpec {
  title: string;
  occurrence: number;
  view: 'list' | 'form';
  like?: LayoutDesign;
  width: number;
  parts: { kind: 'header' | 'body' | 'trailing-grand-summary' | 'footer'; height: number }[];
  objects: ArrangedObject[];
}

const PART_IDS: Record<string, number> = { header: 1, body: 4, 'trailing-grand-summary': 6, footer: 7 };
const PART_STACK = ['header', 'body', 'trailing-grand-summary', 'footer'];
/** Positions from a picture land on this grid, so near-misses line up. */
const GRID = 2;
const snap = (n: number) => Math.round(n / GRID) * GRID;

/**
 * A layout arranged as a picture shows it (a screenshot of another app, a
 * sketch on paper), styled the way the file's own layouts are: its theme, and
 * each kind of object (fields, labels, the title, portals, buttons) styled as
 * it most often is there. Positions snap to a 2-point grid and stay inside
 * the layout and their part; parts stack in FileMaker's order.
 */
export function draftArranged(schema: Schema, designs: LayoutDesigns, spec: ArrangedSpec): Draft {
  const to = schema.tableOccurrences.find((x) => x.id === spec.occurrence);
  const table = to && !to.dataSourceId ? schema.tables.find((x) => x.id === to.baseTableId) : undefined;
  if (!to || !table) throw new Error('A drafted layout needs an occurrence of a table in this file');
  if (!spec.parts.length || !spec.parts.some((p) => p.kind === 'body')) throw new Error('An arrangement needs a body part');
  const { layouts, themeId, themeNote } = models(designs, spec.like);
  const looks = looksOf(layouts);
  const themed = themeId !== undefined;
  const fallback: Record<string, Look> = {
    field: { style: themed ? { element: 61 } : FIELD_STYLE, height: 22 }, label: { style: themed ? { element: 70 } : LABEL_STYLE, height: 20 },
    title: { style: TITLE_STYLE, height: 26 }, button: { style: themed ? { element: 80 } : {}, height: 24 }, portal: { style: { element: 83 }, height: 0 },
    rectangle: { style: themed ? { element: 51 } : {}, height: 0 }, line: { style: themed ? { element: 50 } : {}, height: 0 },
  };
  const style = (...roles: string[]): ObjectStyle => {
    for (const r of roles) {
      const l = looks.look(r);
      if (l) return clone(l.style);
    }
    return clone(fallback[roles[roles.length - 1]]?.style ?? {});
  };
  // Parts in FileMaker's order, at least a little tall, stacked from the top.
  const width = Math.max(200, Math.min(4000, snap(spec.width)));
  const order = spec.parts.map((p, i) => ({ ...p, i })).sort((a, b) => PART_STACK.indexOf(a.kind) - PART_STACK.indexOf(b.kind));
  const parts: LayoutPart[] = [];
  const partAt = new Map<number, LayoutPart>();
  let top = 0;
  for (const p of order) {
    if (parts.some((x) => x.kind === p.kind)) throw new Error(`An arrangement has one ${p.kind} part`);
    const part: LayoutPart = { kind: p.kind, kindId: PART_IDS[p.kind], top, height: Math.max(12, Math.min(2000, snap(p.height))), style: clone(looks.part(areaOf(p.kind)) ?? {}) };
    parts.push(part);
    partAt.set(p.i, part);
    top += part.height;
  }
  const occurrence = (id: number) => schema.tableOccurrences.find((x) => x.id === id)!;
  const fieldOf = (toId: number, id: number) => schema.tables.find((t) => t.id === occurrence(toId).baseTableId)!.fields.find((f) => f.id === id)!;
  const objects: LayoutObject[] = [];
  let next = 1;
  const counts = new Map<string, number>();
  for (const a of spec.objects) {
    const part = partAt.get(a.part);
    if (!part) throw new Error(`An object names part ${a.part}, which the arrangement doesn't have`);
    // Inside the layout's width and its part.
    const w = Math.max(4, Math.min(width, snap(a.width)));
    // A portal is tall enough for a row; a line can be a hairline.
    const h = Math.max(a.kind === 'line' ? 1 : a.kind === 'portal' ? Math.min(part.height, 16) : 4, Math.min(part.height, snap(a.height)));
    const left = Math.max(0, Math.min(width - w, snap(a.left)));
    const y = part.top + Math.max(0, Math.min(part.height - h, snap(a.top)));
    const bounds = { top: y, left, bottom: y + h, right: left + w };
    const area = areaOf(part.kind);
    const base = { id: next++, bounds, anchors };
    counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
    switch (a.kind) {
      case 'field': {
        const f = fieldOf(a.field!.occurrence, a.field!.field);
        objects.push({ ...base, kind: 'field', type: 1, style: style(`field:${area}`, 'field:body', 'field'),
          field: { tableOccurrenceId: a.field!.occurrence, fieldId: f.id, tableOccurrence: occurrence(a.field!.occurrence).name, field: f.name, display: 'edit', repetitions: 1 } });
        break;
      }
      case 'label': case 'title':
        objects.push({ ...base, kind: 'text', type: 2, style: a.kind === 'title' ? style('title', 'title') : style(`label:${area}`, 'label:body', 'label'), text: a.text?.trim() || ' ' });
        break;
      case 'button':
        objects.push({ ...base, kind: 'button', type: 10, style: style('button'), text: a.text?.trim() || 'Button' });
        break;
      case 'rectangle': case 'line':
        objects.push({ ...base, kind: a.kind, type: a.kind === 'line' ? 4 : 5, style: style(a.kind) });
        break;
      case 'portal': {
        const p = a.portal!;
        const rto = occurrence(p.occurrence);
        // At least a row of 12 points; no more rows than fit.
        const rows = Math.max(1, Math.min(50, Math.round(p.rows ?? 5), Math.floor((h - 4) / 12)));
        const rowH = Math.max(12, Math.floor((h - 4) / rows));
        const cell = style('field:portal', 'field:body', 'field');
        // Columns share the portal's width, in the order given.
        const colW = Math.max(1, Math.floor((w - 4) / Math.max(1, p.fields.length)));
        objects.push({ ...base, kind: 'portal', type: 9, style: style('portal', 'portal'), name: rto.name,
          portal: { tableOccurrenceId: rto.id, tableOccurrence: rto.name, rows, initialRow: 1, scrolling: true },
          children: p.fields.map((id, i) => {
            const f = fieldOf(rto.id, id);
            return { id: next++, kind: 'field', type: 1, bounds: { top: y + 2, left: left + 2 + i * colW, bottom: y + 2 + Math.min(rowH - 2, 22), right: left + 2 + (i + 1) * colW - Math.min(4, colW - 1) }, anchors, style: clone(cell),
              field: { tableOccurrenceId: rto.id, fieldId: f.id, tableOccurrence: rto.name, field: f.name, display: 'edit' as const, repetitions: 1 } };
          }) });
        break;
      }
    }
  }
  const notes = [themeNote, 'Arranged as the picture shows it, on a 2-point grid.'];
  if (layouts.length) notes.push(spec.like ? `Fields, labels, title and parts styled as on ${spec.like.name}.` : `Fields, labels, title and parts styled as they most often are on the file's ${plural(layouts.length, 'layout')} with that theme.`);
  const tally = ['field', 'label', 'button', 'portal'].filter((k) => counts.get(k)).map((k) => plural(counts.get(k)!, k));
  if (tally.length) notes.push(`From the picture: ${tally.join(', ')}.`);
  const shown = objects.filter((o) => o.kind === 'field' && o.field?.tableOccurrenceId === to.id);
  return {
    design: {
      width, style: clone(looks.layout ?? {}), parts, objects, view: spec.view, ...(themeId !== undefined ? { themeId } : {}),
      tableView: shown.map((o) => ({ field: { tableOccurrenceId: to.id, fieldId: o.field!.fieldId, tableOccurrence: to.name, field: o.field!.field }, width: 120 })),
    },
    notes,
  };
}
