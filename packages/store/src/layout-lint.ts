// Layout linter, which FileMaker doesn't have: what on a layout will look or
// behave wrong in Browse mode, found before anyone uses it. The web layout
// editor shows these (adding a contrast check it measures from the rendered
// layout), and AI assistants get them through the lint_layout MCP tool.

import type { Field, LayoutDesign, LayoutObject, Schema } from '../../fmp12/src/index.ts';
import { Privileges, isFullAccess, type PrivilegeDefinition } from './privileges.ts';
import { layoutPerformance, SLOW, type LayoutStats } from './layout-perf.ts';

export type LintRule = 'missing-field' | 'unrelated' | 'outside' | 'overlap' | 'misaligned' | 'no-action' | 'tab-order' | 'no-access' | 'unlabeled' | 'small-target' | 'slow-sort' | 'color-only' | 'slow';

export interface LintIssue {
  rule: LintRule;
  severity: 'error' | 'warning' | 'info';
  /** The objects it is about, first the one to select. */
  objectIds: number[];
  message: string;
  /** Fix can mend it in one step (layout-fix.ts); the rest need a person's judgment. */
  fixable?: boolean;
  /** Slow objects: estimated record reads to draw the layout once (layout-perf.ts), when record counts were given. */
  cost?: number;
}

/** Objects people click or type in: two of these on top of each other is a mistake. */
const ACTIVE = new Set(['field', 'button', 'popover-button', 'button-bar', 'web-viewer', 'chart', 'portal']);
/** Overlap of at least this share of the smaller object counts; a point or two of touching doesn't. */
export const OVERLAP_SHARE = 0.2;
/** Objects people line up: labels, fields and buttons. */
const ALIGNED = new Set(['field', 'text', 'button', 'popover-button', 'portal', 'button-bar']);
/** WCAG 2.2's minimum target size (2.5.8), in points: smaller is hard to tap on a phone. */
export const TARGET = 24;
/** A layout this narrow, or one that stacks for phones, is used on phones. */
const PHONE_WIDTH = 480;
/** Edges this close (in points) but not equal look like a slip of the mouse. */
export const NEAR = 2;

/** What the editor calls an object: its name, field, text or kind. */
export function objectLabel(o: LayoutObject): string {
  if (o.name) return o.name;
  if (o.field) return `${o.field.tableOccurrence ?? '?'}::${o.field.field ?? '?'}`;
  const text = o.text?.replace(/\s+/g, ' ').trim();
  if (text) return `"${text.length > 30 ? `${text.slice(0, 29)}…` : text}"`;
  if (o.action?.script) return `button "${o.action.script}"`;
  return o.kind.replace(/-/g, ' ');
}

export function area(b: LayoutObject['bounds']): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
}

export function overlapArea(a: LayoutObject['bounds'], b: LayoutObject['bounds']): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

/** Table occurrences reachable from `from` through relationships, in either direction. */
export function related(schema: Schema, from: number): Set<number> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift()!;
    for (const r of schema.relationships) {
      const other = r.leftTableOccurrenceId === at ? r.rightTableOccurrenceId : r.rightTableOccurrenceId === at ? r.leftTableOccurrenceId : undefined;
      if (other !== undefined && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen;
}

/**
 * The layout's problems, most serious first: fields that show `<Field Missing>`
 * or nothing (their occurrence isn't related to the layout's), objects partly or
 * wholly outside the layout, active objects on top of each other, buttons that do
 * nothing, enterable fields Tab never reaches, and fields some privilege sets
 * see as `<No Access>`. With record counts (`stats`), what makes the layout
 * slow to draw comes with an estimate of the work (layout-perf.ts).
 */
export function lintLayout(design: LayoutDesign, schema: Schema, privilegeSets: PrivilegeDefinition[] = [], stats?: LayoutStats): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (rule: LintRule, severity: LintIssue['severity'], objects: LayoutObject[], message: string, fixable?: boolean) =>
    issues.push({ rule, severity, objectIds: objects.map((o) => o.id), message, ...(fixable ? { fixable } : {}) });
  const occurrences = new Map(schema.tableOccurrences.map((t) => [t.id, t]));
  const tables = new Map(schema.tables.map((t) => [t.id, t]));
  const reachable = design.tableOccurrenceId !== undefined ? related(schema, design.tableOccurrenceId) : undefined;
  const all: LayoutObject[] = [];
  const walk = (objs: LayoutObject[]) => {
    for (const o of objs) {
      all.push(o);
      if (o.children) walk(o.children);
    }
  };
  walk(design.objects);

  // Fields: missing, unrelated, and who can't see them.
  const sets = privilegeSets.filter((p) => !isFullAccess(p)).map((p) => new Privileges('', p, undefined, () => { throw new Error('one file'); }));
  const noAccess = new Map<string, { objects: LayoutObject[]; sets: string[] }>();
  for (const o of all) {
    if (!o.field) continue;
    const to = occurrences.get(o.field.tableOccurrenceId);
    const label = objectLabel(o);
    if (!to) {
      add('missing-field', 'error', [o], `${label} shows <Field Missing>: its table occurrence is gone. Pick another field.`);
      continue;
    }
    if (to.dataSourceId) continue; // a field in another file: that file's schema decides
    const table = to.baseTableId !== undefined ? tables.get(to.baseTableId) : undefined;
    const field = table?.fields.find((f) => f.id === o.field!.fieldId);
    if (!table || !field) {
      add('missing-field', 'error', [o], `${label} shows <Field Missing>: the field was deleted. Pick another field.`);
      continue;
    }
    if (reachable && !reachable.has(to.id) && !field.options?.global) {
      const layoutTo = occurrences.get(design.tableOccurrenceId!)?.name ?? 'the layout\'s occurrence';
      add('unrelated', 'warning', [o], `${to.name}::${field.name} shows nothing: ${to.name} isn't related to ${layoutTo}. Relate them, or use a field from a related occurrence.`);
    }
    for (const p of sets) {
      if (p.layout(design.name).layout === 'none') continue;
      if (p.field(table.name, field.name) !== 'none') continue;
      const key = `${table.name}::${field.name}`;
      const entry = noAccess.get(key) ?? { objects: [], sets: [] };
      if (!entry.objects.includes(o)) entry.objects.push(o);
      if (!entry.sets.includes(p.name)) entry.sets.push(p.name);
      noAccess.set(key, entry);
    }
  }

  // Outside the layout: past its width (when set) or below its last part.
  const bottom = design.parts.reduce((m, p) => Math.max(m, p.top + p.height), 0);
  // Popovers and what's in them open on top of the layout, wherever they are drawn.
  const popovers = new Set<LayoutObject>();
  const inPopover = (objs: LayoutObject[]) => {
    for (const o of objs) {
      popovers.add(o);
      if (o.children) inPopover(o.children);
    }
  };
  inPopover(all.filter((o) => o.kind === 'popover'));
  for (const o of design.objects) {
    if (popovers.has(o)) continue;
    const b = o.bounds;
    const right = design.width ?? Infinity;
    const out = b.left >= right || b.top >= bottom || b.right <= 0 || b.bottom <= 0;
    const partly = !out && (b.left < 0 || b.top < 0 || b.right > right + 0.5 || (design.parts.length > 0 && b.bottom > bottom + 0.5));
    if (out) add('outside', 'warning', [o], `${objectLabel(o)} is outside the layout, so nobody sees it in Browse mode. Move it in or delete it.`);
    else if (partly) add('outside', 'info', [o], `${objectLabel(o)} runs past the layout's ${b.right > right + 0.5 ? 'right edge' : b.bottom > bottom + 0.5 ? 'last part' : 'edge'}, so part of it is cut off.`);
  }

  // Active objects on top of each other, among siblings (tab and slide panels share their space by design).
  const siblings = (objs: LayoutObject[]) => {
    const active = objs.filter((o) => ACTIVE.has(o.kind) && !popovers.has(o));
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const [a, b] = [active[i], active[j]];
        const shared = overlapArea(a.bounds, b.bounds);
        if (shared > 0 && shared >= OVERLAP_SHARE * Math.min(area(a.bounds), area(b.bounds))) {
          add('overlap', 'warning', [b, a], `${objectLabel(b)} covers ${objectLabel(a)}: people may click the wrong one. Move one of them.`);
        }
      }
    }
    for (const o of objs) {
      if (!o.children) continue;
      if (o.kind === 'tab-control' || o.kind === 'slide-control') for (const panel of o.children) siblings(panel.children ?? []);
      else siblings(o.children);
    }
  };
  siblings(design.objects);

  // Nearly lined up: edges a point or two apart in a column (left edges) or a row (top edges).
  const aligned = (objs: LayoutObject[]) => {
    const pool = objs.filter((o) => ALIGNED.has(o.kind) && !popovers.has(o));
    for (const edge of ['left', 'top'] as const) {
      for (const group of nearGroups(pool, edge)) {
        add('misaligned', 'info', group, `${group.length} objects are almost lined up on their ${edge} edges (up to ${spread(group, edge)} pt apart): ${group.map(objectLabel).slice(0, 3).join(', ')}${group.length > 3 ? '…' : ''}. Line them up.`);
      }
    }
    for (const o of objs) {
      if (!o.children) continue;
      if (o.kind === 'tab-control' || o.kind === 'slide-control') for (const panel of o.children) aligned(panel.children ?? []);
      else aligned(o.children);
    }
  };
  aligned(design.objects);

  // Buttons that do nothing when clicked.
  for (const o of all) {
    if (o.kind !== 'button' || o.action) continue;
    add('no-action', 'warning', [o], `${objectLabel(o)} does nothing when clicked: give it a script or a step in Button Setup.`);
  }

  // Tab order: enterable fields it leaves out, and objects it names that are gone.
  if (design.tabOrder?.length) {
    const ids = new Set(all.map((o) => o.id));
    const inOrder = new Set(design.tabOrder);
    const gone = design.tabOrder.filter((id) => !ids.has(id));
    for (const o of all) {
      if (o.kind !== 'field' || inOrder.has(o.id) || popovers.has(o)) continue;
      const entry = o.field?.behavior?.browse;
      if (entry === 'view' || entry === 'calculation' || o.field?.behavior?.noTab) continue;
      add('tab-order', 'info', [o], `Tab skips ${objectLabel(o)}: it isn't in the tab order (Set Tab Order).`);
    }
    if (gone.length) issues.push({ rule: 'tab-order', severity: 'info', objectIds: [], message: `The tab order lists ${gone.length === 1 ? 'an object' : `${gone.length} objects`} no longer on the layout; Set Tab Order and save to tidy it.` });
  }

  // Accessibility: fields and buttons with nothing saying what they are, and targets too small to tap on a phone.
  const texts = all.filter((o) => o.kind === 'text' && o.text?.trim());
  const partOf = (y: number) => design.parts.findIndex((p) => y >= p.top && y < p.top + p.height);
  const labelled = (o: LayoutObject) => texts.some((t) => {
    const a = o.bounds;
    const b = t.bounds;
    const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const side = vertical >= 0.5 * Math.min(a.bottom - a.top, b.bottom - b.top);
    if (side && b.right <= a.left + 4 && a.left - b.right <= 40) return true; // to the left
    if (side && b.left >= a.right - 4 && b.left - a.right <= 40 && (o.field?.display === 'checkbox' || o.field?.display === 'radio')) return true; // a checkbox's label on the right
    if (horizontal > 0 && b.bottom <= a.top + 4) {
      if (a.top - b.bottom <= 24) return true; // just above
      // A list layout's column heading in the header, over a field in the body.
      const [tp, fp] = [partOf(b.top), partOf(a.top)];
      if (tp !== -1 && fp !== -1 && tp < fp && horizontal >= 0.5 * Math.min(a.right - a.left, b.right - b.left)) return true;
    }
    return false;
  });
  const inPortal = new Set<LayoutObject>();
  function walkPortal(objs: LayoutObject[]) {
    for (const o of objs) {
      inPortal.add(o);
      if (o.children) walkPortal(o.children);
    }
  }
  for (const o of all) if (o.kind === 'portal') walkPortal(o.children ?? []);
  // Inside a group (a component copy is one), a button bar or a portal, an object's size and neighbours belong to that container: Fix leaves them to a person.
  const contained = new Set<LayoutObject>();
  const walkContained = (objs: LayoutObject[]) => {
    for (const o of objs) {
      contained.add(o);
      if (o.children) walkContained(o.children);
    }
  };
  for (const o of all) if (o.kind === 'group' || o.kind === 'button-bar' || o.kind === 'portal') walkContained(o.children ?? []);
  for (const o of all) {
    if (popovers.has(o) || o.placeholder || o.tooltip) continue;
    if (o.kind === 'field' && o.field && !inPortal.has(o)) {
      const entry = o.field.behavior?.browse;
      if (entry === 'view' || entry === 'calculation' || labelled(o)) continue;
      add('unlabeled', 'info', [o], `${objectLabel(o)} has no label beside or above it and no placeholder: people can't tell what goes in it, and screen readers can't say. Add a label (or placeholder text).`, !!o.field.field && !contained.has(o));
    } else if ((o.kind === 'button' || o.kind === 'popover-button') && !o.text?.trim() && !o.name && !o.children?.some((c) => c.text?.trim())) {
      add('unlabeled', 'info', [o], `${o.icon ? 'An icon-only button' : 'A button'} has no text, name or tooltip, so screen readers announce it as just "button". Give it a tooltip (Inspector) or a name.`, !!buttonName(o) && !contained.has(o));
    } else if (o.kind === 'chart' && !o.name && !o.chart?.title?.trim()) {
      add('unlabeled', 'info', [o], `A chart has no title, name or tooltip, so screen readers announce it as just "image". Give it a title (Chart Setup) or a tooltip.`, !!chartName(o) && !contained.has(o));
    } else if (o.kind === 'web-viewer' && !o.name) {
      add('unlabeled', 'info', [o], `A web viewer has no name or tooltip, so screen readers announce it as just "Web viewer". Give it a name or a tooltip (Inspector) saying what it shows.`);
    }
  }
  // Conditional formatting that only changes colours: people who can't tell the colours apart miss what it means (WCAG 1.4.1).
  for (const o of all) {
    if (!(o.kind === 'text' || o.kind === 'field' || o.kind === 'button' || o.kind === 'popover-button')) continue;
    if (o.kind === 'text' && !o.text?.trim()) continue; // nothing shows, so no meaning is lost
    const shifts = colourShifts(o);
    if (!shifts.length) continue;
    // Bold shows only on text: an icon-only button needs a person to pick another cue (a different icon, a frame).
    const text = o.kind !== 'button' && o.kind !== 'popover-button' ? true : !!(o.text?.trim() || o.children?.some((c) => c.text?.trim()));
    // Bold tells one state from the rest; with two or more (red when negative, green when positive), or a change to the icon alone, a person picks the cues.
    const fixable = text && shifts.length === 1 && shifts[0].rules.some((r) => r.part === 1 || r.part === 2) && !contained.has(o);
    add('color-only', 'info', [o], `${objectLabel(o)} has conditional formatting that only changes colour: people who can't tell the colours apart miss it. Change something else too, such as ${text ? 'bold text' : 'the icon'}.`, fixable);
  }
  const phone = (design.width !== undefined && design.width <= PHONE_WIDTH) || !!design.responsive?.stackBelow;
  if (phone) {
    for (const o of all) {
      if (popovers.has(o) || !(o.kind === 'button' || o.kind === 'popover-button' || (o.kind === 'field' && o.field?.behavior?.browse !== 'view'))) continue;
      const w = o.bounds.right - o.bounds.left;
      const h = o.bounds.bottom - o.bounds.top;
      // Stacked fields and buttons fill the width, so only height counts there.
      const small = h < TARGET || (w < TARGET && !design.responsive?.stackBelow);
      if (small) add('small-target', 'info', [o], `${objectLabel(o)} is ${Math.round(w)} × ${Math.round(h)} pt: on a phone it's hard to tap. Make it at least ${TARGET} pt each way (44 is comfortable).`, !contained.has(o));
    }
  }

  // Portals sorted on a field that has no index: every row's value is worked out again each time the portal draws.
  for (const o of all) {
    for (const key of o.portal?.sort ?? []) {
      const to = occurrences.get(key.field.tableOccurrenceId);
      const field = to && !to.dataSourceId && to.baseTableId !== undefined ? tables.get(to.baseTableId)?.fields.find((f) => f.id === key.field.fieldId) : undefined;
      if (!field) continue;
      const why = unindexable(field);
      if (why) add('slow-sort', 'info', [o], `The portal sorts on ${to!.name}::${field.name}, ${why}, which can't be indexed: with many related records it draws slowly. Sort on a stored field instead.`);
      else if (field.options?.noAutoIndex && !field.options.index) add('slow-sort', 'info', [o], `The portal sorts on ${to!.name}::${field.name}, which has indexing off and "Automatically create indexes as needed" unchecked: with many related records it draws slowly. Turn on automatic indexing.`, true);
    }
  }

  for (const [key, { objects, sets: names }] of noAccess) {
    add('no-access', 'info', objects, `Accounts with ${names.length === 1 ? `the ${names[0]} privilege set` : `privilege sets ${names.join(', ')}`} see <No Access> in ${key}.`);
  }

  for (const p of layoutPerformance(design, schema, stats)) {
    issues.push({ rule: 'slow', severity: (p.cost ?? 0) >= SLOW ? 'warning' : 'info', objectIds: p.objectIds, message: p.message, ...(p.fixable ? { fixable: true } : {}), ...(p.cost !== undefined ? { cost: p.cost } : {}) });
  }

  for (const i of issues) if (isFixable(i)) i.fixable = true;
  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

const edgeOf = (o: LayoutObject, edge: 'left' | 'top') => o.bounds[edge];
const spread = (group: LayoutObject[], edge: 'left' | 'top') => {
  const v = group.map((o) => edgeOf(o, edge));
  return Math.round((Math.max(...v) - Math.min(...v)) * 100) / 100;
};

/**
 * Objects whose `edge` is within NEAR points of each other but not all equal: a
 * column of labels one point out, say. Left edges count only for objects one
 * above the other, top edges only for objects side by side, and not when their
 * centres or far edges line up instead.
 */
export function nearGroups(objs: LayoutObject[], edge: 'left' | 'top'): LayoutObject[][] {
  const sorted = [...objs].sort((a, b) => edgeOf(a, edge) - edgeOf(b, edge));
  const groups: LayoutObject[][] = [];
  let run: LayoutObject[] = [];
  const flush = () => {
    // Side by side for a column, or stacked for a row, isn't lining up.
    const apart = run.every((a, i) => run.every((b, j) => i === j || (edge === 'left'
      ? a.bounds.bottom <= b.bounds.top || b.bounds.bottom <= a.bounds.top
      : a.bounds.right <= b.bounds.left || b.bounds.right <= a.bounds.left)));
    // Lined up another way instead (centres, or the far edges: a right-aligned column of labels) is on purpose.
    const far = edge === 'left' ? 'right' : 'bottom';
    const other = (v: (o: LayoutObject) => number) => Math.max(...run.map(v)) - Math.min(...run.map(v)) <= 0.5;
    const elsewise = other((o) => o.bounds[far]) || other((o) => (o.bounds[edge] + o.bounds[far]) / 2);
    if (run.length > 1 && spread(run, edge) > 0 && apart && !elsewise) groups.push(run);
    run = [];
  };
  for (const o of sorted) {
    if (run.length && edgeOf(o, edge) - edgeOf(run[0], edge) > NEAR) flush();
    run.push(o);
  }
  flush();
  return groups;
}

/** Why a field can't be indexed, if it can't. */
export function unindexable(f: Field): string | undefined {
  if (f.options?.global) return 'a global field';
  if (f.kind === 'summary') return 'a summary field';
  if (f.type === 'container') return 'a container field';
  if (f.kind === 'calculation' && f.options?.unstored) return 'an unstored calculation';
  return undefined;
}

/** A condition whose style rules all set colours (text, fill, border, icon). */
export function colourOnly(c: NonNullable<LayoutObject['conditions']>[number]): boolean {
  if (!c.rules.length || !c.rules.every((r) => Object.keys(r.css).every((k) => k.endsWith('color')))) return false;
  // A see-through colour hides the object (an old FileMaker trick), which isn't meaning carried by colour.
  return !c.rules.some((r) => Object.values(r.css).some((v) => v === 'transparent' || /\/\s*0(\.0+)?\s*\)$/.test(v)));
}

/** An object's colour-only conditions that mark a state (not ones that always apply, like `True`). */
export function colourShifts(o: LayoutObject): NonNullable<LayoutObject['conditions']> {
  return (o.conditions ?? []).filter((c) => colourOnly(c) && !/^\s*(true|1)\s*$/i.test(c.formula));
}

/** What a chart with no title can be called by screen readers: its value axis title, else its first series' name (formulas, like the title). */
export function chartName(o: LayoutObject): string | undefined {
  return o.chart?.yTitle?.trim() || o.chart?.series.find((x) => x.name?.trim())?.name?.trim() || undefined;
}

/** What a button with no text can be called by screen readers: its script, else its step (a bare "Perform Script" says nothing). */
export function buttonName(o: LayoutObject): string | undefined {
  const a = o.action;
  return a?.script?.trim() || (a?.stepId !== 1 ? a?.step?.trim() : undefined) || undefined;
}

/** What Fix can mend without a person deciding: see layout-fix.ts. (Labels, tap sizes and portal indexes are marked where they're found.) */
export function isFixable(i: LintIssue): boolean {
  if (i.fixable) return true;
  if (i.rule === 'overlap' || i.rule === 'misaligned') return true;
  if (i.rule === 'tab-order') return true;
  return i.rule === 'outside' && i.severity === 'info';
}
