// Fix for the layout linter's mechanical findings, which FileMaker doesn't
// have: what Check found that has one right answer, mended in one step.
// Nearly lined-up edges go to the edge most of them share, an object on top of
// another moves just below it, an object running past the layout's edge moves
// back inside, and the tab order gains the fields it skipped (in reading
// order) and loses the objects that are gone. A field with no label gets one
// (its name, styled as the layout's labels), a button with no text a tooltip
// naming its script or step, a field or button too small to tap on a phone
// grows, and a portal sorted on a field with indexing off gets automatic
// indexing (a change to the field, returned with the design). Missing fields,
// buttons with no action and the like need a person's judgment, so they are
// left alone.

import type { LayoutDesign, LayoutObject, LayoutPart, ObjectStyle, Schema } from '../../fmp12/src/index.ts';
import { lintLayout, isFixable, nearGroups, overlapArea, area, buttonName, chartName, colourShifts, OVERLAP_SHARE, type LintIssue } from './layout-lint.ts';
import type { PrivilegeDefinition } from './privileges.ts';
import type { DesignOp } from './design.ts';

/** Space left between an object and the one it moved off. */
const GAP = 4;

function walk(objs: LayoutObject[], fn: (o: LayoutObject) => void): void {
  for (const o of objs) {
    fn(o);
    if (o.children) walk(o.children, fn);
  }
}

/** Move an object and everything inside it. */
function shift(o: LayoutObject, dx: number, dy: number): void {
  walk([o], (x) => {
    x.bounds = { left: x.bounds.left + dx, right: x.bounds.right + dx, top: x.bounds.top + dy, bottom: x.bounds.bottom + dy };
  });
}

/** The list an object sits in (its siblings), the object, and the objects it sits inside (outermost first). */
function locate(objs: LayoutObject[], id: number, parents: LayoutObject[] = []): { list: LayoutObject[]; o: LayoutObject; parents: LayoutObject[] } | undefined {
  for (const o of objs) {
    if (o.id === id) return { list: objs, o, parents };
    const inner = o.children && locate(o.children, id, [...parents, o]);
    if (inner) return inner;
  }
  return undefined;
}

const inside = (inner: LayoutObject['bounds'], outer: LayoutObject['bounds']) =>
  inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;

/** A comfortable tap target on a phone, in points. */
const TAP = 44;

const same = (a: LintIssue, b: LintIssue) => a.rule === b.rule && a.objectIds.length === b.objectIds.length && a.objectIds.every((id, i) => id === b.objectIds[i]);

/**
 * The layout with Check's fixable findings mended: all of them, or only those
 * matching `only` (by rule and objects). Returns the new design, the findings
 * it fixed, and the design changes outside the layout that go with it (field
 * options); the design passed in is left as it was.
 */
export function fixLayout(design: LayoutDesign, schema: Schema, privilegeSets: PrivilegeDefinition[] = [], only?: Pick<LintIssue, 'rule' | 'objectIds'>[]): { design: LayoutDesign; fixed: LintIssue[]; changes: DesignOp[] } {
  const out = structuredClone(design);
  const wanted = lintLayout(out, schema, privilegeSets).filter((i) => isFixable(i) && (!only || only.some((w) => same(i as LintIssue, w as LintIssue))));
  const fixed: LintIssue[] = [];
  const changes: DesignOp[] = [];
  const touched = new Set<number>();
  // Grow and label first (they can land on something), line up, then move off each other, then back inside: each step can only help the next.
  const order: LintIssue['rule'][] = ['slow', 'small-target', 'unlabeled', 'color-only', 'slow-sort', 'misaligned', 'overlap', 'outside', 'tab-order'];
  for (const rule of order) {
    for (const issue of wanted.filter((i) => i.rule === rule)) {
      if (apply(out, issue, schema, changes, touched)) fixed.push(issue);
    }
  }
  // Growing can put things on top of each other or past the edge: those move off too (when only some findings are being fixed, just the ones the grown objects caused).
  if (touched.size) {
    const caused = (i: LintIssue) => !only || i.objectIds.some((id) => touched.has(id));
    for (const issue of lintLayout(out, schema, privilegeSets).filter((i) => (i.rule === 'overlap' || (i.rule === 'outside' && i.severity === 'info')) && caused(i))) {
      if (apply(out, issue, schema, changes, touched)) fixed.push(issue);
    }
  }
  return { design: out, fixed, changes };
}

function apply(d: LayoutDesign, issue: LintIssue, schema: Schema, changes: DesignOp[], touched: Set<number>): boolean {
  switch (issue.rule) {
    case 'misaligned': return align(d, issue);
    case 'overlap': return moveOff(d, issue);
    case 'outside': return moveInside(d, issue);
    case 'tab-order': return tidyTabOrder(d, issue);
    case 'unlabeled': return label(d, issue);
    case 'small-target': return grow(d, issue, touched);
    case 'slow-sort': return autoIndex(d, issue, schema, changes);
    case 'color-only': return embolden(d, issue);
    case 'slow': return toGrandSummary(d, issue, touched);
    default: return false;
  }
}

/** Parts in the order FileMaker stacks them. */
const PART_ORDER = ['top-navigation', 'title-header', 'header', 'leading-grand-summary', 'sub-summary-leading', 'body', 'sub-summary-trailing', 'trailing-grand-summary', 'footer', 'title-footer', 'bottom-navigation'];

/**
 * A summary field in a list's body shows the same total on every row: it
 * moves (with its label just left of it) to the trailing grand summary, made
 * below the body and any sub-summaries when the layout has none.
 */
function toGrandSummary(d: LayoutDesign, issue: LintIssue, touched: Set<number>): boolean {
  const o = d.objects.find((x) => x.id === issue.objectIds[0]);
  const body = d.parts.find((p) => p.kind === 'body');
  if (!o?.field || !body || o.bounds.top < body.top || o.bounds.top >= body.top + body.height) return false;
  const h = o.bounds.bottom - o.bounds.top;
  const labelOf = d.objects.find((t) => t.kind === 'text' && t.text?.trim() && t.bounds.top >= body.top && t.bounds.top < body.top + body.height &&
    t.bounds.right <= o.bounds.left + 4 && o.bounds.left - t.bounds.right <= 40 &&
    Math.min(t.bounds.bottom, o.bounds.bottom) - Math.max(t.bounds.top, o.bounds.top) >= 0.5 * Math.min(h, t.bounds.bottom - t.bounds.top));
  const moving = labelOf ? [o, labelOf] : [o];
  const top = Math.min(...moving.map((x) => x.bounds.top));
  const height = Math.max(...moving.map((x) => x.bounds.bottom)) - top;
  /** Everything from `at` down moves down by `by`: whole top-level objects (with what's inside them), and the parts there. */
  const pushDown = (at: number, by: number, keep?: LayoutPart) => {
    for (const p of d.parts) if (p.top >= at && p !== keep) p.top += by;
    for (const x of d.objects) if (x.bounds.top >= at && !moving.includes(x)) shift(x, 0, by);
  };
  let part = d.parts.find((p) => p.kind === 'trailing-grand-summary');
  if (!part) {
    const at = Math.max(0, ...d.parts.filter((p) => PART_ORDER.indexOf(p.kind) <= PART_ORDER.indexOf('trailing-grand-summary')).map((p) => p.top + p.height));
    part = { kind: 'trailing-grand-summary', kindId: 6, top: at, height: 0, style: {} };
    d.parts.push(part);
    d.parts.sort((a, b) => a.top - b.top);
  }
  // Below what the part already holds (an earlier total, a label), so nothing lands on anything.
  const g = part;
  const held = d.objects.filter((x) => !moving.includes(x) && x.bounds.top >= g.top && x.bounds.top < g.top + g.height);
  const at = Math.max(g.top + 4, ...held.map((x) => x.bounds.bottom + 4));
  const need = at + height + 4 - (g.top + g.height);
  if (need > 0) {
    pushDown(g.top + g.height, need, g);
    g.height += need;
  }
  for (const x of moving) {
    shift(x, 0, at - top);
    touched.add(x.id);
  }
  return true;
}

/** The style the layout's labels have most often (text objects beside or above fields), else its texts', else the theme's label element. */
function labelStyle(d: LayoutDesign): ObjectStyle {
  const counts = new Map<string, { style: ObjectStyle; n: number }>();
  walk(d.objects, (o) => {
    if (o.kind !== 'text' || !o.text?.trim() || o.text.includes('<<')) return;
    const k = JSON.stringify(o.style);
    const e = counts.get(k) ?? counts.set(k, { style: o.style, n: 0 }).get(k)!;
    e.n++;
  });
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return structuredClone(top?.style ?? { element: 70 });
}

/** Text as a FileMaker calculation's string literal (tooltips are calculations): backslashes, quotes and pilcrows escaped, control characters dropped. */
export function quote(text: string): string {
  // eslint-disable-next-line no-control-regex
  return `"${text.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\"¶]/g, (c) => `\\${c}`)}"`;
}

/** A field gets a label with its name to its left (above, when there's no room); a button with no text a tooltip naming its script or step. */
function label(d: LayoutDesign, issue: LintIssue): boolean {
  const found = locate(d.objects, issue.objectIds[0]);
  if (!found) return false;
  const { list, o, parents } = found;
  if (o.kind === 'button' || o.kind === 'popover-button') {
    const name = buttonName(o);
    if (!name || o.tooltip) return false;
    o.tooltip = quote(name);
    return true;
  }
  if (o.kind === 'chart') {
    // The same kind of formula as the title it lacks.
    const name = chartName(o);
    if (!name || o.tooltip) return false;
    o.tooltip = name;
    return true;
  }
  if (!o.field?.field || o.placeholder) return false;
  const ids = new Set<number>();
  walk(d.objects, (x) => ids.add(x.id));
  const id = Math.max(0, ...ids) + 1;
  const b = o.bounds;
  const height = Math.min(20, b.bottom - b.top);
  const room = b.left - 8;
  // In line with the labels already beside fields in this column, when there are some.
  const column = new Map<string, { left: number; right: number; n: number }>();
  for (const t of list) {
    if (t.kind !== 'text' || !t.text?.trim() || t.bounds.right > b.left || b.left - t.bounds.right > 40) continue;
    const k = `${t.bounds.left},${t.bounds.right}`;
    const e = column.get(k) ?? column.set(k, { left: t.bounds.left, right: t.bounds.right, n: 0 }).get(k)!;
    e.n++;
  }
  const usual = [...column.values()].sort((x, y) => y.n - x.n)[0];
  const middle = { top: b.top + (b.bottom - b.top - height) / 2, bottom: b.top + (b.bottom - b.top + height) / 2 };
  const beside = usual ? { left: usual.left, right: usual.right, ...middle } : room >= 60 ? { left: Math.max(0, room - 120), right: room, ...middle } : undefined;
  const above = { left: b.left, right: Math.max(b.right, b.left + 80), top: b.top - height - 2, bottom: b.top - 2 };
  // Where it covers nothing else on the layout (a background behind both the field and the label is fine), stays in the field's part and inside
  // whatever holds the field (a tab or slide panel): beside, else above; with no room for it, a person decides.
  const part = d.parts.find((p) => b.top >= p.top && b.top < p.top + p.height);
  const holder = parents[parents.length - 1];
  const others: LayoutObject[] = [];
  walk(d.objects, (x) => {
    if (x !== o && !parents.includes(x)) others.push(x);
  });
  const free = (x: LayoutObject['bounds']) => x.top >= 0 && x.left >= 0 && (d.width === undefined || x.right <= d.width) &&
    (!part || (x.top >= part.top && x.bottom <= part.top + part.height)) && (!holder || inside(x, holder.bounds)) &&
    !others.some((other) => overlapArea(other.bounds, x) > 0 && !(inside(x, other.bounds) && inside(b, other.bounds)));
  const bounds = [beside, above].find((x): x is LayoutObject['bounds'] => !!x && free(x));
  if (!bounds) return false;
  const style = labelStyle(d);
  list.splice(list.indexOf(o), 0, { id, kind: 'text', type: 2, bounds, anchors: { ...o.anchors, right: false, bottom: false }, style, text: o.field.field });
  return true;
}

/** Conditional formatting that only changes colour also makes the text bold, so it shows without the colour. */
function embolden(d: LayoutDesign, issue: LintIssue): boolean {
  const o = locate(d.objects, issue.objectIds[0])?.o;
  const shifts = o ? colourShifts(o) : [];
  // Only a single state can be told apart by bold (see lintLayout).
  if (shifts.length !== 1) return false;
  const rule = shifts[0].rules.find((r) => r.part === 1 && r.state === 1);
  if (rule) rule.css['font-weight'] = 'bold';
  else shifts[0].rules.push({ part: 1, state: 1, css: { 'font-weight': 'bold' } });
  return true;
}

/** A field or button too small to tap on a phone grows to a comfortable size, keeping its top left corner (only taller when the layout stacks). */
function grow(d: LayoutDesign, issue: LintIssue, touched: Set<number>): boolean {
  const o = locate(d.objects, issue.objectIds[0])?.o;
  if (!o) return false;
  const b = o.bounds;
  const tall = b.bottom - b.top < TAP;
  const wide = !d.responsive?.stackBelow && b.right - b.left < TAP;
  if (!tall && !wide) return false;
  o.bounds = { ...b, ...(tall ? { bottom: b.top + TAP } : {}), ...(wide ? { right: b.left + TAP } : {}) };
  touched.add(o.id);
  return true;
}

/** A portal sorted on a field with indexing off: the field gets "Automatically create indexes as needed" back. */
function autoIndex(d: LayoutDesign, issue: LintIssue, schema: Schema, changes: DesignOp[]): boolean {
  const o = locate(d.objects, issue.objectIds[0])?.o;
  let done = false;
  for (const key of o?.portal?.sort ?? []) {
    const to = schema.tableOccurrences.find((t) => t.id === key.field.tableOccurrenceId);
    const table = to && !to.dataSourceId ? schema.tables.find((t) => t.id === to.baseTableId) : undefined;
    const field = table?.fields.find((f) => f.id === key.field.fieldId);
    if (!table || !field?.options?.noAutoIndex || field.options.index) continue;
    if (changes.some((c) => c.op === 'updateField' && c.table === table.id && c.field === field.id)) continue;
    changes.push({ op: 'updateField', table: table.id, field: field.id, options: { noAutoIndex: null } } as unknown as DesignOp);
    done = true;
  }
  return done;
}

/** Nearly lined-up edges go to the value most of them have (ties: the first object's). */
function align(d: LayoutDesign, issue: LintIssue): boolean {
  const objs = issue.objectIds.map((id) => locate(d.objects, id)?.o).filter((o): o is LayoutObject => !!o);
  if (objs.length < 2) return false;
  // Which edge they nearly share, if they still do (an earlier fix may have moved some of them).
  const edge = (['left', 'top'] as const).find((e) => nearGroups(objs, e).some((g) => g.length === objs.length));
  if (!edge) return false;
  const counts = new Map<number, number>();
  for (const o of objs) counts.set(o.bounds[edge], (counts.get(o.bounds[edge]) ?? 0) + 1);
  const target = [...counts].reduce((best, c) => (c[1] > best[1] ? c : best))[0];
  for (const o of objs) shift(o, edge === 'left' ? target - o.bounds.left : 0, edge === 'top' ? target - o.bounds.top : 0);
  return true;
}

/** The object on top moves just below the one it covers, and further down past anything else clickable it would land on. */
function moveOff(d: LayoutDesign, issue: LintIssue): boolean {
  const [topId, underId] = issue.objectIds;
  const top = locate(d.objects, topId);
  const under = locate(d.objects, underId)?.o;
  if (!top || !under) return false;
  const covers = (a: LayoutObject, b: LayoutObject) => {
    const shared = overlapArea(a.bounds, b.bounds);
    return shared > 0 && shared >= OVERLAP_SHARE * Math.min(area(a.bounds), area(b.bounds));
  };
  if (!covers(top.o, under)) return false;
  shift(top.o, 0, under.bounds.bottom + GAP - top.o.bounds.top);
  const ACTIVE = new Set(['field', 'button', 'popover-button', 'button-bar', 'web-viewer', 'chart', 'portal']);
  for (let guard = 0; guard < 50; guard++) {
    const hit = top.list.find((o) => o !== top.o && ACTIVE.has(o.kind) && covers(top.o, o));
    if (!hit) break;
    shift(top.o, 0, hit.bounds.bottom + GAP - top.o.bounds.top);
  }
  return true;
}

/** An object running past the layout's right edge, last part or top/left moves back inside, when it fits. */
function moveInside(d: LayoutDesign, issue: LintIssue): boolean {
  const o = locate(d.objects, issue.objectIds[0])?.o;
  if (!o) return false;
  const right = d.width ?? Infinity;
  const bottom = d.parts.length ? d.parts.reduce((m, p) => Math.max(m, p.top + p.height), 0) : Infinity;
  const b = o.bounds;
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  if (w > right || h > bottom) return false; // too big to fit: a person decides what to do
  const dx = b.left < 0 ? -b.left : b.right > right ? right - b.right : 0;
  const dy = b.top < 0 ? -b.top : b.bottom > bottom ? bottom - b.bottom : 0;
  if (!dx && !dy) return false;
  shift(o, dx, dy);
  return true;
}

/** Fields the tab order skips go in where reading order puts them; ids no longer on the layout go. */
function tidyTabOrder(d: LayoutDesign, issue: LintIssue): boolean {
  if (!d.tabOrder?.length) return false;
  const ids = new Set<number>();
  const byId = new Map<number, LayoutObject>();
  walk(d.objects, (o) => {
    ids.add(o.id);
    byId.set(o.id, o);
  });
  if (!issue.objectIds.length) {
    const kept = d.tabOrder.filter((id) => ids.has(id));
    if (kept.length === d.tabOrder.length) return false;
    d.tabOrder = kept;
    return true;
  }
  const o = byId.get(issue.objectIds[0]);
  if (!o || d.tabOrder.includes(o.id)) return false;
  // Before the first object it reads ahead of: rows top to bottom (a few points' slack), each left to right.
  const before = (a: LayoutObject, b: LayoutObject) => (Math.abs(a.bounds.top - b.bounds.top) > 4 ? a.bounds.top < b.bounds.top : a.bounds.left < b.bounds.left);
  const at = d.tabOrder.findIndex((id) => {
    const other = byId.get(id);
    return other !== undefined && before(o, other);
  });
  d.tabOrder.splice(at === -1 ? d.tabOrder.length : at, 0, o.id);
  return true;
}
