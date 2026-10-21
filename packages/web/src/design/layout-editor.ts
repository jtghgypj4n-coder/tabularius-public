// The layout editor: the layout drawn by the browse-mode renderer, with an
// editing layer on top. Select, drag, resize and nudge objects (snapping to the
// grid and to other objects' edges and centres); add fields, text, shapes,
// buttons, button bars, popovers, portals and tab controls; drop objects into a
// portal's first row, a tab panel or an open popover; align, distribute, group,
// lock and arrange them; pick them from the Objects panel; set the tab order;
// change parts; edit an object's settings in the inspector. Saving sends the
// whole design as one updateLayout change.

import { LayoutRenderer, layoutWidth, tabJustify, webViewer, type Host } from '../layout.ts';
import { PAGE_OPTIONS, modernPage, pageFormula, pageSizeNote, pageSource, starterPage } from '../page-source.ts';
import type { LayoutDesign, LayoutMeta, LayoutObject, LayoutPart, ScriptTrigger, StyleRule, Theme } from '../types.ts';
import { h, button, select, field, check, toast } from './dom.ts';
import { apiTour, insertSnippet } from './page-api-tour.ts';
import { copyXml, designWithAI, errorText, notesDialog, type Studio } from './main.ts';
import { elementOf } from '../styles.ts';
import { ROTATABLE } from '../rotation.ts';
import { DEFAULT_TEXT } from '../chart.ts';
import { VALUE_OPS, valueFormula, valueIs, type ValueIs } from './conditions.ts';
import { elementName, ruleEditor } from './styles.ts';
import { DesignClient, type Change, type DesignComponent, type LibraryPreview, type LintIssue, type SpeedMove, type SpeedPlan } from './client.ts';
import { Api } from '../api.ts';
import { contrastRatio, measured, readableOn } from './contrast.ts';
import { mergeDesign, settleClash, type Clash } from './merge.ts';
import type { ProposalLayout } from '../assistant.ts';
import { personColor } from './together.ts';
import { changeSummary, changedIds, layoutChanges, layoutVersions } from './layout-diff.ts';
import { equalSpacing, type Gap } from './guides.ts';
import { pageSize } from '../preview.ts';
import { responsiveDesign, stackBreakpoint } from '../responsive.ts';
import { returnFocus } from '../return-focus.ts';
import { layoutViewClasses, loadLayoutViewOptions, saveLayoutViewOptions, type LayoutViewOptions } from './layout-view.ts';
import { httpProblem } from '../http-problem.ts';
import { acknowledgeLayoutSave, findLayoutObject, pushBoundedHistory } from './async-state.ts';

const SCOPE = 'fm-layout';
/** Pictures of layout versions drawn so far, for each one's own style scope. */
let pictures = 0;
/** How close (in points) an edge comes to another object's before it snaps to it. */
const GUIDE_SNAP = 4;
/** Objects that take part in Set Tab Order, as in FileMaker. */
const TAB_KINDS = new Set(['field', 'button', 'popover-button', 'tab-control', 'slide-control', 'web-viewer']);
const tabbable = (o: LayoutObject) => TAB_KINDS.has(o.kind) || (o.kind === 'group' && !!o.action);
const PART_KINDS: [string, number][] = [
  ['top-navigation', 12], ['title-header', 0], ['header', 1], ['leading-grand-summary', 2], ['sub-summary-leading', 3], ['body', 4],
  ['sub-summary-trailing', 5], ['trailing-grand-summary', 6], ['footer', 7], ['title-footer', 8], ['bottom-navigation', 13],
];
/** Script triggers the web client fires, with when. */
const LAYOUT_EVENTS: [string, string][] = [
  ['OnRecordLoad', 'After a record is shown (on opening the layout and moving between records)'],
  ['OnRecordCommit', 'Before a changed record is committed (moving to another record or layout, Commit Records); False keeps the person on it'],
  ['OnRecordRevert', 'Before a record\'s changes are reverted; False keeps them'],
  ['OnLayoutKeystroke', 'When a key is pressed on the layout, before it is typed; False drops the key. Get ( TriggerKeystroke ) says which'],
  ['OnLayoutEnter', 'After the layout opens'],
  ['OnLayoutExit', 'Before going to another layout; the script returning False keeps the person here'],
  ['OnLayoutSizeChange', 'After the window changes size (once it stops changing)'],
  ['OnModeEnter', 'After entering Browse, Find or Preview mode'],
  ['OnModeExit', 'Before leaving Browse or Find mode; False stays in the mode'],
  ['OnViewChange', 'After the layout is shown as a form, list or table'],
];
const PANEL_EVENTS: [string, string][] = [['OnPanelSwitch', 'Before another tab or slide comes to the front; False keeps the current one. Get ( TriggerTargetPanel ) says which']];
const NOT_YET = 'Kept for FileMaker: the web client doesn\'t run it yet';
const OBJECT_EVENTS: [string, string][] = [['OnObjectEnter', 'When the field is entered'], ['OnObjectModify', 'After the field\'s new value is saved'], ['OnObjectExit', 'When the field is left'],
  ['OnObjectKeystroke', 'When a key is pressed in the field, before it is typed; False drops the key'], ['OnObjectValidate', 'Before the field\'s value is validated; False keeps the person in the field'],
  ['OnObjectSave', 'After the field\'s value is validated and saved'],
  ['OnObjectAVPlayerChange', `When a container's audio or video starts, stops or moves. ${NOT_YET}`]];
/** Objects other than fields: entering and leaving them. */
const OTHER_EVENTS: [string, string][] = [['OnObjectEnter', `When the object becomes active. ${NOT_YET}`], ['OnObjectExit', `When the object stops being active. ${NOT_YET}`]];
/** What a field dragged from the Fields pane carries. */
const FIELD_DRAG = 'application/x-tabularius-field';
const DISPLAYS = ['edit', 'popup', 'dropdown', 'checkbox', 'radio', 'calendar'];

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const rule = (css: Record<string, string>): StyleRule[] => [{ part: 1, state: 1, css }];
/** Styles for new objects: the theme's when the layout has one, else a plain look of their own. */
function newStyle(kind: string, themed: boolean): LayoutObject['style'] {
  const element = ({ field: 61, text: 70, rectangle: 51, 'rounded-rectangle': 52, oval: 53, button: 80, line: 50, portal: 83, 'tab-control': 81, 'tab-panel': 82,
    'slide-control': 91, 'slide-panel': 92, 'web-viewer': 85, 'button-bar': 78, segment: 79, 'popover-button': 79, popover: 89, graphic: 60 } as Record<string, number>)[kind];
  if (themed) return { element };
  switch (kind) {
    case 'field': return { element, rules: rule({ 'background-color': '#ffffff', border: '1px solid #b9bec7', 'border-radius': '4px', padding: '2px 4px', color: '#1d1d1f' }) };
    case 'text': return { element, rules: rule({ color: '#1d1d1f' }) };
    case 'rectangle': return { element, rules: rule({ 'background-color': '#eef2f7', border: '1px solid #b9bec7' }) };
    case 'rounded-rectangle': return { element, rules: rule({ 'background-color': '#eef2f7', border: '1px solid #b9bec7', 'border-radius': '10px' }) };
    case 'oval': return { element, rules: rule({ 'background-color': '#eef2f7', border: '1px solid #b9bec7', 'border-radius': '50%' }) };
    case 'line': return { element, rules: rule({ 'border-top': '1px solid #6b7280' }) };
    case 'web-viewer': return { element, rules: rule({ border: '1px solid #b9bec7' }) };
    case 'chart': return { element, rules: rule({ 'background-color': '#ffffff', border: '1px solid #b9bec7' }) };
    case 'button': return { element, rules: rule({ 'background-color': '#1f6fd1', color: '#ffffff', 'border-radius': '6px', 'text-align': 'center' }) };
    case 'portal': return { element, rules: rule({ 'background-color': '#ffffff', border: '1px solid #b9bec7' }) };
    case 'tab-panel': return { element, rules: rule({ 'background-color': '#ffffff', border: '1px solid #b9bec7', color: '#1d1d1f' }) };
    case 'segment': return { element, rules: rule({ 'background-color': '#f4f6f9', border: '1px solid #b9bec7', color: '#1d1d1f', 'text-align': 'center' }) };
    case 'popover-button': return { element, rules: rule({ 'background-color': '#f4f6f9', border: '1px solid #b9bec7', 'border-radius': '6px', color: '#1d1d1f', 'text-align': 'center' }) };
    case 'popover': return { element, rules: rule({ 'background-color': '#ffffff', border: '1px solid #b9bec7', 'border-radius': '8px', 'box-shadow': '0 6px 24px rgb(0 0 0 / 0.18)' }) };
    default: return { element };
  }
}

/** Whether any of the objects, or anything inside them, is a placed copy of a component. */
function hasCopy(objs: LayoutObject[]): boolean {
  return objs.some((o) => !!o.component || (!!o.children && hasCopy(o.children)));
}

function walk(objs: LayoutObject[], fn: (o: LayoutObject) => void): void {
  for (const o of objs) {
    fn(o);
    if (o.children) walk(o.children, fn);
  }
}

/** Web Viewer Setup's defaults (FileMaker's externalFlagSet 32781). */
const WEB_VIEWER_DEFAULTS = { interaction: true, findMode: false, progressBar: true, statusMessages: true, encodeUrl: true, jsBridge: false };

const PANEL_KINDS = new Set(['tab-panel', 'slide-panel']);
const isPanels = (o: LayoutObject) => o.kind === 'tab-control' || o.kind === 'slide-control';
/** Objects FileMaker won't put inside a portal row. */
const NOT_IN_PORTAL = new Set(['portal', 'tab-control', 'slide-control', 'popover', 'popover-button', 'web-viewer']);

/** A bar taller than it is wide is vertical (as the reader lays them out). */
const isVertical = (o: LayoutObject) => o.bounds.right - o.bounds.left <= o.bounds.bottom - o.bounds.top;

/** A button bar's segments share it equally: side by side, or stacked when it's vertical. */
function fitSegments(o: LayoutObject): void {
  if (o.kind !== 'button-bar' || !o.children?.length) return;
  const { top, left, bottom, right } = o.bounds;
  const n = o.children.length;
  const across = !isVertical(o);
  const step = ((across ? right - left : bottom - top)) / n;
  o.children.forEach((c, i) => {
    const a = Math.round((across ? left : top) + i * step), z = Math.round((across ? left : top) + (i + 1) * step);
    c.bounds = across ? { top, bottom, left: a, right: z } : { top: a, bottom: z, left, right };
  });
}

/** A tab or slide control's panels share its bounds. */
function fitPanels(o: LayoutObject): void {
  if (isPanels(o)) for (const p of o.children ?? []) if (PANEL_KINDS.has(p.kind)) p.bounds = { ...o.bounds };
}

function portalRowHeight(o: LayoutObject): number {
  return Math.max(8, (o.bounds.bottom - o.bounds.top - 2) / Math.max(1, o.portal?.rows ?? 1));
}

const inside = (b: LayoutObject['bounds'], r: LayoutObject['bounds']) => b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom;

/** Move an object and everything inside it. */
function shift(o: LayoutObject, dx: number, dy: number): void {
  walk([o], (x) => {
    x.bounds = { top: x.bounds.top + dy, bottom: x.bounds.bottom + dy, left: x.bounds.left + dx, right: x.bounds.right + dx };
  });
}

/** The smallest box around some objects. */
function union(objs: LayoutObject[]): LayoutObject['bounds'] {
  return {
    top: Math.min(...objs.map((o) => o.bounds.top)), left: Math.min(...objs.map((o) => o.bounds.left)),
    bottom: Math.max(...objs.map((o) => o.bounds.bottom)), right: Math.max(...objs.map((o) => o.bounds.right)),
  };
}

/** Resizes a group: what's in it scales with it, as in FileMaker. */
function scaleGroup(o: LayoutObject, from: LayoutObject, to: LayoutObject['bounds']): void {
  const f = from.bounds;
  const sx = (to.right - to.left) / Math.max(1, f.right - f.left);
  const sy = (to.bottom - to.top) / Math.max(1, f.bottom - f.top);
  const x = (v: number) => Math.round(to.left + (v - f.left) * sx);
  const y = (v: number) => Math.round(to.top + (v - f.top) * sy);
  o.children = structuredClone(from.children ?? []);
  walk(o.children, (c) => (c.bounds = { left: x(c.bounds.left), right: x(c.bounds.right), top: y(c.bounds.top), bottom: y(c.bounds.bottom) }));
}

/** Layout settings by their names in Layout Setup, for the list of changes you and someone else both made. */
const SETTING_NAMES: Record<string, string> = {
  name: 'Layout name', tableOccurrenceId: 'Show records from', width: 'Layout width', themeId: 'Theme', style: 'Layout style', parts: 'Parts',
  tableView: 'Table view columns', view: 'View', triggers: 'Script triggers', tabOrder: 'Tab order', menuSetId: 'Menu set', viewsAllowed: 'Views allowed',
  saveRecordChanges: 'Save record changes automatically', fieldFrames: 'Show field frames', recordIndicator: 'Current record indicator', responsive: 'Responsive layout',
  printColumns: 'Print in columns', fixedMargins: 'Fixed page margins',
};

function label(o: LayoutObject): string {
  if (o.field) return `${o.field.tableOccurrence ? o.field.tableOccurrence + '::' : ''}${o.field.field ?? 'field ' + o.field.fieldId}`;
  if (o.kind === 'group') return o.name ? `group: ${o.name}` : `group of ${o.children?.length ?? 0}`;
  if (o.text) return `${o.kind}: ${o.text.slice(0, 40)}`;
  if (o.portal) return `portal: ${o.portal.tableOccurrence ?? ''}`;
  return o.name ? `${o.kind}: ${o.name}` : o.kind;
}

/**
 * Draws a design into `target` as the canvas shows it (fields show their names, the
 * way FileMaker's layout mode does), with an open popover over it; returns its size.
 * `scope` is a class on `target` or an ancestor, which the theme's CSS is scoped to.
 */
function paintLayout(target: HTMLElement, meta: LayoutMeta, scope: string, panels: Map<number, number>, open?: LayoutObject): { width: number; height: number } {
  const design = meta.design;
  const renderer = new LayoutRenderer(meta, scope);
  const names = new Proxy({} as Record<string, string>, { get: (_t, k) => (typeof k === 'string' ? k.replace(/^.*\|/, '') : undefined), set: () => true });
  const host: Host = { mode: 'find', criteria: names, save() {}, upload() {}, action() {}, panels };
  const parts = [...design.parts].sort((a, b) => a.top - b.top);
  // An open popover can hang below the last part; the canvas grows to show it.
  const height = Math.max(parts.length ? Math.max(...parts.map((p) => p.top + p.height)) : 400, open ? open.bounds.bottom + 20 : 0);
  const width = Math.max(renderer.width, 400);
  target.replaceChildren();
  for (const p of renderer.parts) {
    const el = renderer.renderPart(p, host);
    el.style.position = 'absolute';
    el.style.top = `${p.top}px`;
    el.style.width = `${width}px`;
    target.append(el);
  }
  // The open popover draws over the layout, at its place on it.
  if (open) {
    const el = renderer.renderPopover(open.id, host, 0);
    // Objects are positioned inside parts; a part-like layer at the top of the canvas holds the popover.
    if (el) target.append(h('div', { class: 'fm-part', style: 'position:absolute;top:0;left:0;height:0;z-index:5' }, el));
  }
  target.append(renderer.style());
  return { width, height };
}

/** A small picture of a design, drawn as the canvas draws it, with objects marked (added green, removed red, changed amber). */
function picture(meta: LayoutMeta, design: LayoutDesign, marks: Map<number, 'added' | 'removed' | 'changed'>, caption: string, max = { width: 230, height: 260 }): HTMLElement {
  const scope = `fm-pic-${++pictures}`;
  const inner = h('div', { class: `le-picture-canvas ${scope}` });
  let size = { width: 400, height: 300 };
  try {
    size = paintLayout(inner, { ...meta, design }, scope, new Map());
  } catch {
    inner.replaceChildren(h('p', { class: 'd-muted' }, 'This version can\'t be drawn.'));
  }
  const all = new Map<number, LayoutObject>();
  walk(design.objects, (o) => all.set(o.id, o));
  for (const [id, kind] of marks) {
    const b = all.get(id)?.bounds;
    if (b) inner.append(h('div', { class: `le-mark ${kind}`, style: `left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px`, title: kind }));
  }
  // Shown down to where the objects end, so a wide layout with little on it isn't a speck.
  let right = 0;
  let bottom = 0;
  for (const o of all.values()) {
    right = Math.max(right, o.bounds.right);
    bottom = Math.max(bottom, o.bounds.bottom);
  }
  const shown = { width: Math.min(size.width, right ? right + 24 : size.width), height: Math.min(size.height, bottom ? bottom + 24 : size.height) };
  const scale = Math.min(1, max.width / shown.width, max.height / shown.height);
  inner.style.width = `${size.width}px`;
  inner.style.height = `${size.height}px`;
  inner.style.transform = `scale(${scale})`;
  return h('figure', { class: 'le-picture' },
    h('div', { class: 'le-picture-frame', style: `width:${Math.ceil(shown.width * scale)}px;height:${Math.ceil(shown.height * scale)}px` }, inner),
    h('figcaption', {}, caption));
}

/**
 * Pictures of a layout an AI proposal makes or changes, drawn as the canvas draws them, before anything is
 * applied: the new layout, or before and after with what changed marked, and what Check found on it.
 */
/** How big a picture can be in the assistant panel. */
const PANEL = { width: 320, height: 360 };

export async function proposalPicture(studio: Studio, l: ProposalLayout, opts: { themes?: Map<number, Theme>; max?: { width: number; height: number } } = {}): Promise<HTMLElement> {
  const max = opts.max ?? PANEL;
  const d = studio.design;
  const fields: LayoutMeta['fields'] = {};
  for (const to of d.tableOccurrences) {
    const table = d.tables.find((t) => t.id === to.baseTableId);
    if (table) fields[to.name] = table.fields.map((f) => ({ name: f.name, type: f.type, calculated: f.kind === 'calculation', summary: f.kind === 'summary', global: !!f.options?.global }));
  }
  const named = (design: LayoutDesign): LayoutDesign => {
    // Field objects carry ids; the picture labels them by name.
    const occurrences = new Map(d.tableOccurrences.map((t) => [t.id, t]));
    const fix = (objs: LayoutObject[]): LayoutObject[] => objs.map((o) => {
      const out = { ...o, ...(o.children ? { children: fix(o.children) } : {}) };
      if (o.field) {
        const to = occurrences.get(o.field.tableOccurrenceId);
        const name = d.tables.find((t) => t.id === to?.baseTableId)?.fields.find((f) => f.id === o.field!.fieldId)?.name;
        out.field = { ...o.field, tableOccurrence: o.field.tableOccurrence ?? to?.name, field: o.field.field ?? name };
      }
      return out;
    });
    return { ...design, objects: fix(design.objects) };
  };
  const to = d.tableOccurrences.find((t) => t.id === l.design.tableOccurrenceId);
  // Each picture in its own theme: a restyle's before and after differ.
  const themeOf = async (id: number | undefined) => (id === undefined ? undefined : opts.themes?.get(id) ?? await studio.client.theme(id).catch(() => undefined));
  const theme = await themeOf(l.design.themeId);
  const meta: LayoutMeta = {
    database: studio.client.db, layout: { name: l.name, id: l.id, occurrence: to?.name ?? '', table: d.tables.find((t) => t.id === to?.baseTableId)?.name ?? '' },
    design: named(l.design), ...(theme ? { theme } : {}), fields, valueLists: {}, images: {}, portals: [], layouts: {},
  };
  const after = named(l.design);
  let shown: HTMLElement;
  if (l.before) {
    const before = named(l.before);
    const { added, removed, changed } = changedIds(before, after);
    const marks = (ids: [number[], 'added' | 'removed' | 'changed'][]) => new Map(ids.flatMap(([list, kind]) => list.map((id) => [id, kind] as const)));
    const beforeTheme = l.before.themeId === l.design.themeId ? theme : await themeOf(l.before.themeId);
    const { theme: _t, ...plain } = meta;
    shown = h('div', { class: 'le-before-after' },
      picture({ ...plain, ...(beforeTheme ? { theme: beforeTheme } : {}) }, before, marks([[removed, 'removed'], [changed, 'changed']]), 'Before', max),
      picture(meta, after, marks([[added, 'added'], [changed, 'changed']]), 'After', max));
  } else shown = picture(meta, after, new Map(), `New layout "${l.name}"`, max);
  const serious = l.issues.filter((i) => i.severity !== 'info');
  return h('div', { class: 'ai-layout-picture' }, shown,
    ...(serious.length ? [h('p', { class: 'ai-note' }, `Check: ${serious.length === 1 ? serious[0].message : `${serious.length} problems, such as: ${serious[0].message}`}`)] : []));
}

export async function layoutEditor(studio: Studio, layoutId: number, close: () => void): Promise<HTMLElement> {
  const entry = studio.design.layouts.find((l) => l.id === layoutId);
  if (!entry) throw new Error('That layout no longer exists');
  const [raw, meta] = await Promise.all([studio.client.layout(layoutId), appMeta(studio, entry.name)]);
  // The whole theme, so any of its styles draws when an object is given it (browse mode gets only the used ones).
  if (raw.themeId !== undefined) meta.theme = await studio.client.theme(raw.themeId).catch(() => meta.theme);
  return new LayoutEditor(studio, entry.name, raw, meta, close).el;
}

async function appMeta(studio: Studio, name: string): Promise<LayoutMeta> {
  const r = await fetch(`/tabularius/app/v1/databases/${encodeURIComponent(studio.client.db)}/layouts/${encodeURIComponent(name)}`, {
    headers: { authorization: `Bearer ${studio.client.token}` },
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error?.message ?? httpProblem(r.status));
  return json;
}

class LayoutEditor {
  readonly el: HTMLElement;
  private readonly studio: Studio;
  private readonly name: string;
  private readonly meta: LayoutMeta;
  private tableViewOpen = false;
  /** Conditions shown as "Formula is" even when they read as "Value is". */
  private readonly formulaConditions = new WeakSet<object>();
  private design: LayoutDesign;
  private saved: string;
  /** A component being edited here: its copy ungrouped, and the layout as it was before (Cancel). */
  private editingComponent?: { id: number; name: string; before: string };
  private selected = new Set<number>();
  private undo: string[] = [];
  private redo: string[] = [];
  private zoom = 1;
  /** Window-width preview (0: editing): the layout as the web client shows it in a window this wide. */
  private previewWidth = 0;
  /** Side by side with a phone (not in FileMaker): what a phone layout made from this one shows, beside it as it's edited. */
  private showPhone = false;
  private readonly phonePane = h('aside', { class: 'le-phone', hidden: '', 'aria-label': 'Phone preview' });
  private phoneTimer?: ReturnType<typeof setTimeout>;
  private phoneAsked = 0;
  private readonly previewNote = h('div', { class: 'le-preview-note', hidden: '' });
  /** What you and someone else both changed when their save was merged with your unsaved edits: each kept as yours until you pick. */
  private clashes: Clash[] = [];
  private clashWho = '';
  private readonly clashNote = h('div', { class: 'le-preview-note le-clashes', hidden: '', role: 'region', 'aria-label': 'Changes you both made' });
  /** Grid: its spacing, whether objects snap to it, and whether it shows. */
  private grid = { size: 4, snap: true, show: false };
  private viewOptions: LayoutViewOptions;
  /** The Objects panel shows. */
  private showObjects = false;
  /** The left pane's tab, as FileMaker's: Fields to drag onto the layout, Objects to list what's on it. */
  private leftTab: 'fields' | 'objects' = 'fields';
  /** The right pane (the Inspector) shown, and its tab, as FileMaker's Position, Styles, Appearance and Data. */
  private showInspector = true;
  private inspectorTab: 'position' | 'styles' | 'appearance' | 'data' = 'position';
  /** The Fields pane, built once: picking a table and filtering keep their place while objects change. */
  private fieldsPane?: HTMLElement;
  /** Set Tab Order: the order being built while the editor is in that mode. */
  private tabDraft?: number[];
  /** Dynamic guides shown during a drag: x and y lines. */
  private guides: { x: number[]; y: number[]; gaps: Gap[] } = { x: [], y: [], gaps: [] };
  private readonly objectsPanel = h('aside', { class: 'd-panel le-objects', hidden: '' });
  /** Which panel each tab or slide control shows while editing. */
  private readonly panels = new Map<number, number>();
  /** The popover shown for editing, by id (its button is selected, or something in it). */
  private openPopover?: number;
  private readonly canvas = h('div', { class: 'le-canvas' });
  private readonly overlay = h('div', {
    class: 'le-overlay', tabindex: '0', role: 'application', 'aria-label': 'Design canvas',
    'aria-description': 'Tab and Shift+Tab select objects; at either end, Tab leaves the canvas. Arrow keys move; Alt+Arrow resizes. Add Shift for 10 points.',
  });
  private readonly selectionStatus = h('div', { class: 'sr-only le-selection-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  private readonly stage = h('div', { class: `le-stage ${SCOPE}` });
  private readonly inspector = h('aside', { class: 'd-panel le-inspector' });
  private readonly status = h('span', { class: 'd-muted' });
  private readonly close: () => void;
  /** The part and state the Appearance editor shows, kept as objects are edited. */
  private readonly styleView = { part: 1, state: 1 };

  constructor(studio: Studio, name: string, raw: LayoutDesign, meta: LayoutMeta, close: () => void) {
    this.studio = studio;
    this.name = name;
    this.meta = meta;
    this.design = structuredClone(raw);
    this.saved = JSON.stringify(this.design);
    this.viewOptions = loadLayoutViewOptions(`tabularius.layout-view.${studio.client.db}`);
    // Layout mode opens with the Fields pane showing, as FileMaker's does.
    this.showObjects = !!studio.layoutMode;
    // Leaving the editor tells the others this layout is no longer open here.
    this.close = () => {
      studio.together?.at(0, []);
      close();
    };
    const together = studio.together;
    if (together) {
      const offPeers = together.onPeers(() => (this.el.isConnected ? this.drawPeers() : offPeers()));
      const offDesign = together.onDesign((ids, account, where) => {
        if (!this.el.isConnected) return offDesign();
        if (where === 'layout' && ids.includes(this.design.id)) void this.catchUp(account);
      });
    }

    const toolbar = this.toolbar();
    this.stage.append(this.canvas, this.overlay);
    this.el = h('div', { class: 'le' }, toolbar, h('div', { class: 'le-body' }, this.objectsPanel, h('div', { class: 'le-scroll' }, this.clashNote, this.previewNote, h('div', { class: 'le-stage-row' }, this.stage, this.phonePane)), this.inspector));
    this.el.append(this.selectionStatus);
    this.overlay.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.overlay.addEventListener('contextmenu', (e) => this.contextMenu(e));
    // pointerDown focuses the overlay and redraws its boxes; the mousedown that follows would otherwise move focus to the
    // page (its target is gone), and the arrow keys and shortcuts the overlay listens for would do nothing.
    this.overlay.addEventListener('mousedown', (e) => e.preventDefault());
    this.overlay.addEventListener('keydown', (e) => this.key(e));
    // A field dragged from the Fields pane lands where it's let go, as in FileMaker.
    this.overlay.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(FIELD_DRAG)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    this.overlay.addEventListener('drop', (e) => {
      const raw = e.dataTransfer?.getData(FIELD_DRAG);
      if (!raw) return;
      e.preventDefault();
      try {
        const f = JSON.parse(raw) as { to: number; field: number; label: boolean; display: string };
        this.addField(f.to, f.field, f.label, f.display, this.point(e));
        this.overlay.focus({ preventScroll: true });
      } catch { /* not ours */ }
    });
    // Applying an assistant's proposal reopens the layout from the server: it asks first while there are unsaved edits.
    studio.unsaved = () => this.el.isConnected && this.dirty;
    // Layout objects copied in FileMaker's Layout mode paste here (Cmd/Ctrl+V or Paste from FileMaker).
    studio.pasteLayout = async (xml) => {
      if (!this.el.isConnected) {
        toast('Open a layout in the layout editor to paste layout objects');
        return undefined;
      }
      return this.pasteObjects(xml);
    };
    this.draw();
  }

  // ---------------------------------------------------------------- state

  private get themed(): boolean {
    return this.design.themeId !== undefined && !!this.meta.theme;
  }

  private change(fn: () => void): void {
    this.rememberUndo(JSON.stringify(this.design));
    this.redo = [];
    fn();
    this.draw();
  }

  /** All editing paths retain the same bounded undo history. */
  private rememberUndo(snapshot: string): void {
    pushBoundedHistory(this.undo, snapshot, 200);
  }

  /**
   * The page editor: a web viewer's page as HTML, CSS and JavaScript, with a preview that follows the typing. Applying
   * it is one undoable step, saved with the layout. The preview has no data calls; the page gets them in Browse mode.
   */
  private editPage(objectId: number): void {
    const original = this.find(objectId);
    if (!original) return toast('This web viewer is no longer on the layout');
    const dialog = h('dialog', { class: 'd-dialog le-page', 'aria-label': 'Page' }) as HTMLDialogElement;
    const code = h('textarea', { class: 'd-code le-page-code', spellcheck: 'false', 'aria-label': 'Page HTML, CSS and JavaScript' }) as HTMLTextAreaElement;
    code.value = pageSource(original.webUrl) ?? starterPage(this.design.name ?? 'Page', this.design.name ?? '');
    const preview = h('div', { class: 'le-page-preview' });
    const size = h('p', { class: 'd-muted', 'aria-live': 'polite' });
    const encode = (html: string) => {
      const bytes = new TextEncoder().encode(html);
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return 'data:text/html;base64,' + btoa(bin);
    };
    const show = () => {
      preview.replaceChildren(webViewer(encode(code.value)));
      const length = pageFormula(code.value).length;
      const note = pageSizeNote(length);
      size.textContent = note.text;
      size.classList.toggle('d-warn', note.level !== 'ok');
    };
    let wait: ReturnType<typeof setTimeout> | undefined;
    code.addEventListener('input', () => {
      clearTimeout(wait);
      wait = setTimeout(show, 400);
    });
    // Tab types a tab in the code, as code editors do; Escape then Tab moves on.
    let escaped = false;
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        escaped = true;
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey && !escaped) {
        e.preventDefault();
        code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end');
        code.dispatchEvent(new Event('input'));
      }
      escaped = false;
    });
    // A step-by-step tour of the page API; Add to page puts the snippet at the end of the page's script.
    const tour = apiTour(this.design.name ?? '', (snippet, guarded) => {
      code.value = insertSnippet(code.value, snippet, guarded);
      code.dispatchEvent(new Event('input'));
    });
    tour.hidden = true;
    const close = () => {
      clearTimeout(wait);
      dialog.close();
      dialog.remove();
    };
    const apply = button('Apply', () => {
      const current = this.find(objectId);
      if (!current) return toast('This web viewer was removed while its page was open');
      this.change(() => {
        current.webUrl = pageFormula(code.value);
        current.webOptions = { ...(current.webOptions ?? PAGE_OPTIONS), jsBridge: true, encodeUrl: false };
      });
      close();
    }, { class: 'primary', title: 'One undoable step; Save keeps it' });
    dialog.append(
      h('h3', {}, 'Page'),
      h('p', { class: 'd-muted' }, 'HTML, CSS and JavaScript. In Browse mode the page reads and changes records with window.tabularius and runs scripts with FileMaker.PerformScript, as the signed-in account.'),
      h('div', { class: 'le-page-body' }, code, preview),
      tour,
      size,
      // The assistant rewrites the saved page and shows its version with Apply, as it does any design change.
      ...designWithAI(this.studio, 'Describe a change to this page…', (want) => `Change the page of the modern layout "${this.design.name}": ${want}. ` +
        `Read its saved page with get_layout_design, keep what works, and propose the whole new page with propose_page (layout: "${this.design.name}"), ` +
        'using the file\'s real layout and field names.').map((form) => {
        form.addEventListener('submit', () => close());
        return form;
      }),
      h('div', { class: 'd-row' }, button('Page API tour', () => { tour.hidden = !tour.hidden; }, { title: 'What window.tabularius and FileMaker.PerformScript can do, with snippets to add' }), h('span', { class: 'd-spacer' }), button('Cancel', close), apply),
    );
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close();
    });
    document.body.append(dialog);
    dialog.showModal();
    show();
    code.focus();
  }

  private restore(from: string[], to: string[]): void {
    const s = from.pop();
    if (!s) return;
    to.push(JSON.stringify(this.design));
    this.design = JSON.parse(s);
    this.draw();
  }

  /**
   * Undo history you can browse: every step since the layout opened, named by
   * what it changed, with steps undone still listed until a new edit replaces
   * them. Picking one goes straight there (each step stays undoable).
   */
  private historyMenu(): HTMLSelectElement {
    const menu = h('select', { class: 'le-history', 'aria-label': 'Undo history', title: 'Undo history: pick a step to go back or forward to it' }) as HTMLSelectElement;
    // Built when opened: naming the steps compares designs, too slow for every redraw.
    const fill = () => {
      const states = [...this.undo, JSON.stringify(this.design), ...[...this.redo].reverse()];
      const at = this.undo.length;
      const parsed = states.map((s) => JSON.parse(s) as LayoutDesign);
      menu.replaceChildren(...parsed.map((d, i) => {
        const text = i === 0 ? (this.undo.length >= 200 ? 'Earliest step kept' : 'As opened') : changeSummary(layoutChanges(parsed[i - 1], d, label));
        return h('option', { value: String(i) }, `${i > at ? '↷ ' : ''}${text}`);
      }));
      menu.value = String(at);
    };
    fill();
    menu.addEventListener('pointerdown', fill);
    menu.addEventListener('focus', fill);
    menu.addEventListener('change', () => {
      const to = Number(menu.value);
      const at = this.undo.length;
      for (let i = at; i > to; i--) this.restore(this.undo, this.redo);
      for (let i = at; i < to; i++) this.restore(this.redo, this.undo);
      fill();
    });
    return menu;
  }

  /** What opened the Check layout dialog, where focus goes back to when it closes. */
  private lintOpener?: Element | null;

  /**
   * Check layout, which FileMaker doesn't have: the server's linter on what is
   * open (missing and unrelated fields, objects outside the layout or on top of
   * each other or nearly lined up, buttons with no action, tab order, privilege
   * sets that can't see a field, unlabeled fields and buttons, small targets on
   * phone layouts), plus text contrast measured on the canvas. Clicking an issue
   * selects its objects; the list stays open while you fix them.
   */
  private async check(given?: LintIssue[]): Promise<void> {
    const keep = document.querySelector<HTMLElement>('.le-lint .le-lint-list')?.scrollTop ?? 0;
    // Checking again redraws the dialog; what opened it stays the place focus goes back to.
    const opener = document.querySelector('.le-lint') ? this.lintOpener : document.activeElement;
    this.lintOpener = opener;
    document.querySelector('.le-lint')?.remove();
    let issues: LintIssue[];
    try {
      issues = given ?? await this.studio.client.lint(this.design.id, this.design);
    } catch (e) {
      return toast(errorText(e));
    }
    const order = { error: 0, warning: 1, info: 2 };
    issues = [...issues, ...this.contrastIssues()].sort((a, b) => order[a.severity] - order[b.severity]);
    const dialog = h('dialog', { class: 'd-dialog le-lint', 'aria-label': 'Layout check' });
    const close = () => {
      returnFocus(opener, dialog);
      dialog.close();
      dialog.remove();
      this.lintOpener = undefined;
    };
    const counts = (['error', 'warning', 'info'] as const).map((k) => [k, issues.filter((i) => i.severity === k).length] as const).filter(([, n]) => n);
    const summary = counts.length
      ? counts.map(([k, n]) => `${n} ${k === 'info' ? 'note' : k}${n === 1 ? '' : 's'}`).join(', ')
      : 'No problems found: every field is there and related, nothing is off the layout or on top of something else, every button does something, every field and button says what it is, and the text is easy to read.';
    const fixable = issues.filter((i) => i.fixable);
    // Fix: the server mends them on what is open; the result is one undoable step, saved only with Save.
    const fix = async (only?: LintIssue[]) => {
      // Contrast is measured here, so it's mended here: the text takes the colour that reads best on what's behind it.
      const contrast = (only ?? fixable).filter((i) => i.rule === 'contrast');
      const rest = only?.filter((i) => i.rule !== 'contrast');
      if (only && !rest!.length) {
        this.change(() => this.fixContrast(contrast));
        toast(`Fixed ${contrast.length === 1 ? 'it' : `${contrast.length} problems`}. Undo takes ${contrast.length === 1 ? 'it' : 'them'} back; Save keeps ${contrast.length === 1 ? 'it' : 'them'}.`, 'info');
        return void this.check();
      }
      let res: Awaited<ReturnType<typeof this.studio.client.fix>>;
      try {
        res = await this.studio.client.fix(this.design.id, this.design, rest);
      } catch (e) {
        return toast(errorText(e));
      }
      if (!res.fixed.length && !contrast.length) {
        toast('Nothing left to fix there: it may already be fixed', 'info');
        return void this.check();
      }
      // A field's indexing is a change to the field, not the layout: it is saved now (History takes it back).
      let indexed = '';
      let unsaved = false;
      if (res.changes?.length) {
        try {
          const r = await this.studio.client.change(res.changes);
          this.studio.design = r.design;
          indexed = ` Automatic indexing is back on for ${res.changes.length === 1 ? 'the field' : `${res.changes.length} fields`} the portal sorts on (saved now; History takes it back).`;
        } catch (e) {
          // The fields weren't changed, so their portals' slow sorts aren't fixed: say only what was.
          unsaved = true;
          toast(errorText(e));
        }
      }
      const done = unsaved ? res.fixed.filter((i) => i.rule !== 'slow-sort') : res.fixed;
      if (!done.length && !contrast.length) return void this.check();
      this.change(() => {
        this.design = { ...this.design, objects: res.design.objects, tabOrder: res.design.tabOrder, parts: res.design.parts };
        this.fixContrast(contrast);
      });
      const n = done.length + contrast.length;
      this.selected = new Set([...done, ...contrast].flatMap((i) => i.objectIds).filter((id) => this.find(id)));
      this.draw();
      toast(`Fixed ${n === 1 ? 'it' : `${n} problems`}. Undo takes the layout changes back; Save keeps them.${indexed}`, 'info');
      void this.check(contrast.length || unsaved ? undefined : res.issues);
    };
    const select = (issue: LintIssue) => {
      this.selected = new Set(issue.objectIds);
      // An object on a tab or slide panel: bring the panel to the front.
      for (const id of issue.objectIds) {
        const o = this.find(id);
        if (o) for (let p = this.parentOf(id), c: LayoutObject = o; p; c = p, p = this.parentOf(p.id)) if (isPanels(p) && PANEL_KINDS.has(c.kind)) this.panels.set(p.id, c.id);
      }
      this.draw();
      this.overlay.querySelector(`.le-obj[data-id="${issue.objectIds[0]}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    // Layout problems first, then what makes the layout hard to use for some people (WCAG).
    const ACCESSIBILITY = new Set(['contrast', 'unlabeled', 'small-target', 'tab-order', 'color-only']);
    // Then what makes it slow to draw, slowest first (its estimate counts the file's records now).
    const SPEED = new Set(['slow', 'slow-sort']);
    const groups = [
      ['Layout', issues.filter((i) => !ACCESSIBILITY.has(i.rule) && !SPEED.has(i.rule))],
      ['Accessibility', issues.filter((i) => ACCESSIBILITY.has(i.rule))],
      ['Speed', issues.filter((i) => SPEED.has(i.rule)).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))],
    ] as const;
    const rowFor = (issue: LintIssue) => {
      const row = h('button', { type: 'button', class: `le-lint-issue ${issue.severity}`, disabled: issue.objectIds.length ? false : '' },
        h('span', { class: 'le-lint-dot', 'aria-hidden': 'true' }), h('span', {}, issue.message));
      row.addEventListener('click', () => select(issue));
      const actions: HTMLElement[] = [];
      if (issue.fixable) actions.push(button('Fix', () => void fix([issue]), { class: 'le-lint-fix', title: 'Mend this one step (undoable)' }));
      // The ones that need judgment: the assistant explains what to do about it here.
      else if (this.studio.ask) {
        actions.push(button('Ask AI', () => {
          select(issue);
          this.studio.ask!(`On the layout "${this.design.name}", Check layout says: ${issue.message} (rule ${issue.rule}${issue.objectIds.length ? `, object ids ${issue.objectIds.join(', ')}` : ''}). Explain why this matters for people using the layout and what I should do about it here. If a change to the layout would fix it, propose it.`);
        }, { class: 'le-lint-ask', title: 'The assistant explains it and suggests what to do' }));
      }
      return h('li', { class: 'le-lint-row' }, row, ...actions);
    };
    const list = h('ul', { class: 'le-lint-list' }, ...groups.filter(([, g]) => g.length).flatMap(([name, g]) => [
      h('li', { class: 'le-lint-head', role: 'presentation' }, `${name} · ${g.length}`), ...g.map(rowFor),
    ]));
    dialog.append(
      h('h3', {}, 'Check layout'),
      h('p', {}, summary),
      list,
      h('div', { class: 'd-row' },
        ...(fixable.length ? [button(fixable.length === 1 ? 'Fix it' : `Fix all ${fixable.length}`, () => void fix(), { class: 'primary', title: 'Line up, move apart, move inside, complete the tab order, add labels, make text readable and targets tappable: one undoable step' })] : []),
        ...(issues.some((i) => i.rule === 'slow') ? [button('Make it faster…', () => { close(); void this.speedUp(); }, { title: 'A redesign for each slow part, with the work it saves' })] : []),
        button('Check again', () => void this.check()), button('Close', close)),
    );
    document.body.append(dialog);
    dialog.show();
    list.scrollTop = keep;
  }

  /**
   * Make it faster (not in FileMaker): for each slow part of the saved layout, a redesign with the layout's
   * estimated work before and after; each applies on its own as a design change (Undo takes it back). Ideas
   * from the assistant for the rest, on request, where the server has one and AI is on for the file.
   */
  private async speedUp(ai = false, keep?: SpeedPlan): Promise<void> {
    if (this.dirty) return toast('Save the layout first: the redesign is worked out on the saved layout');
    let plan: SpeedPlan;
    try {
      plan = await this.studio.client.speed(this.design.id, ai);
    } catch (e) {
      return toast(errorText(e));
    }
    // The assistant's earlier ideas stay listed when nothing has changed since.
    if (keep && !ai) plan = { ...plan, moves: [...plan.moves, ...keep.moves.filter((m) => m.ai)] };
    const reads = (n: number) => `about ${Math.round(n).toLocaleString()} record read${Math.round(n) === 1 ? '' : 's'}`;
    const dialog = h('dialog', { class: 'd-dialog le-speed', 'aria-labelledby': 'le-speed-title' });
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.addEventListener('close', () => dialog.remove());
    const row = (m: SpeedMove) => {
      const saved = plan.before > 0 ? Math.round((1 - m.after / plan.before) * 100) : 0;
      const apply = button('Apply', async () => {
        apply.disabled = true;
        close();
        if (await this.studio.apply(m.changes)) {
          const undo = this.studio.lastUndo;
          toast(`Done: ${reads(plan.before)} each time the layout draws, now ${reads(m.after)}.`, 'info', undo ? { label: 'Undo', run: () => void this.studio.apply(undo, 'Undone') } : undefined);
        }
      }, { class: 'primary' });
      const show = button('Show', () => {
        this.selected = new Set(m.objectIds.filter((id) => this.find(id)));
        this.draw();
      });
      return h('li', { class: 'le-speed-move' },
        h('p', { class: 'le-speed-title' }, m.ai ? h('span', { class: 'le-speed-ai' }, 'Idea from AI') : '', m.title),
        ...(m.caveat ? [h('p', { class: 'le-speed-caveat' }, m.caveat)] : []),
        // An idea's changes as they will be saved, worked out by the server rather than taken from the model's words.
        ...(m.details?.length ? [h('ul', { class: 'le-speed-details', 'aria-label': 'What changes' }, ...m.details.map((d) => h('li', {}, d)))] : []),
        h('p', { class: 'le-speed-cost' }, `After: ${reads(m.after)}${saved > 0 ? ` (${saved}% less)` : ''}`),
        h('div', { class: 'd-row' }, show, apply));
    };
    const askAi = this.studio.ask && plan.left.length && !ai
      ? [button('Ideas from AI for the rest', () => { close(); void this.speedUp(true, plan); }, { title: 'The assistant proposes redesigns from the layout\'s design (no records are sent)' })]
      : [];
    dialog.append(
      h('h3', { id: 'le-speed-title' }, 'Make it faster'),
      h('p', {}, `Now: ${reads(plan.before)} each time "${plan.layout.name}" draws, from the file's record counts.`),
      plan.moves.length ? h('ul', { class: 'le-speed-list' }, ...plan.moves.map(row)) : h('p', {}, 'Nothing here can be redesigned on its own.'),
      ...(plan.left.length ? [h('p', { class: 'le-speed-left' }, `Left for you${this.studio.ask ? ' or the assistant' : ''}: ${plan.left.map((i) => i.message.split('. ')[0]).join('; ')}.`)] : []),
      ...(plan.ai?.note ? [h('p', { class: 'le-speed-left' }, plan.ai.note)] : []),
      ...(plan.ai?.dropped?.length ? [h('p', { class: 'le-speed-left' }, `Ideas left out because they don't fit this file: ${plan.ai.dropped.join('; ')}`)] : []),
      h('div', { class: 'd-row' }, ...askAi, button('Close', close)),
    );
    document.body.append(dialog);
    dialog.showModal();
  }

  /** For each object Check found hard to read, the text colour that fixes it. */
  private contrastFixes = new Map<number, string>();

  /** The text of each object takes its readable colour, as its own formatting (it beats the theme's). */
  private fixContrast(issues: LintIssue[]): void {
    for (const issue of issues) {
      const o = this.find(issue.objectIds[0]);
      const color = this.contrastFixes.get(issue.objectIds[0]);
      if (!o || !color) continue;
      const rules = [...(o.style.rules ?? [])];
      const at = rules.findIndex((r) => r.part === 1 && r.state === 1);
      if (at === -1) rules.push({ part: 1, state: 1, css: { color } });
      else rules[at] = { ...rules[at], css: { ...rules[at].css, color } };
      o.style = { ...o.style, rules };
    }
  }

  /** Text and fields whose text is hard to read against what's behind it, measured on the canvas. */
  private contrastIssues(): LintIssue[] {
    this.contrastFixes.clear();
    const out: LintIssue[] = [];
    const visit = (objs: LayoutObject[]) => {
      for (const o of objs) {
        if (o.children) visit(o.children);
        if (o.kind !== 'text' && o.kind !== 'field' && o.kind !== 'button') continue;
        const el = this.canvas.querySelector(`[data-id="${o.id}"]`);
        if (!el || !(el as HTMLElement).offsetParent) continue;
        // The element holding the text: a field's input, else the first text in it.
        let at: Element | null = el.querySelector('input, textarea, select');
        if (!at) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
          at = walker.nextNode()?.parentElement ?? null;
        }
        if (!at) continue;
        const m = measured(at, this.canvas);
        if (m && m.ratio < m.required) {
          // Fixable when the readable colour would actually pass on that background.
          const color = readableOn(m.behind);
          const passes = contrastRatio(color === '#ffffff' ? [255, 255, 255] : [29, 29, 31], m.behind) >= m.required;
          if (passes) this.contrastFixes.set(o.id, color);
          out.push({ rule: 'contrast', severity: m.ratio < 3 ? 'warning' : 'info', objectIds: [o.id], ...(passes ? { fixable: true } : {}),
            message: `${!o.field && o.text?.trim() ? `"${o.text.trim().slice(0, 30)}"` : label(o)} is hard to read: its text has ${m.ratio.toFixed(1)}:1 contrast with what's behind it, and ${m.required}:1 is the minimum for text this size. Darken the text or lighten the fill.` });
        }
      }
    };
    visit(this.design.objects);
    return out;
  }

  /**
   * Earlier saves of this layout, from the design history: what each save
   * changed, a comparison with what's open, and opening one as unsaved edits
   * (undoable, saved only with Save).
   */
  private async versions(): Promise<void> {
    let list: ReturnType<typeof layoutVersions>;
    try {
      list = layoutVersions(await this.studio.client.layoutHistory(this.design.id), this.design.id);
    } catch (e) {
      return toast(errorText(e));
    }
    const dialog = h('dialog', { class: 'd-dialog le-versions', 'aria-labelledby': 'le-versions-title' });
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    const detail = h('div', { class: 'le-version-detail' }, h('p', { class: 'd-muted' }, list.length ? 'Pick a save to see what it changed.' : 'No saves of this layout in Tabularius yet: the design history lists changes made here, by scripts or by AI.'));
    const rows = h('ul', { class: 'le-version-list' });
    const show = (i: number) => {
      const v = list[i];
      for (const [j, li] of [...rows.children].entries()) li.classList.toggle('selected', list.length - 1 - j === i);
      const changed = i > 0 ? layoutChanges(list[i - 1].design, v.design, label) : ['The first save of this layout in Tabularius'];
      const sinceThen = layoutChanges(v.design, this.design, label);
      detail.replaceChildren(
        h('h4', {}, `${new Date(v.at).toLocaleString()}${v.account ? ` by ${v.account}` : ''}`),
        h('ul', {}, ...changed.map((l) => h('li', {}, l))),
        i > 0 ? this.beforeAfter(list[i - 1].design, v.design) : this.picture(v.design, new Map(), 'This save'),
        h('h4', {}, 'From this save to what\'s open now'),
        sinceThen.length ? h('ul', {}, ...sinceThen.map((l) => h('li', {}, l))) : h('p', { class: 'd-muted' }, 'The same'),
        h('div', { class: 'd-actions' }, button('Open this version', () => {
          // Keeps the layout's identity; the rest comes from the save.
          this.change(() => (this.design = { ...structuredClone(v.design), id: this.design.id, name: this.design.name, tableOccurrenceId: this.design.tableOccurrenceId }));
          this.selected.clear();
          close();
          toast('Opened that version: Save keeps it, Undo goes back', 'info');
        }, { class: 'primary', disabled: sinceThen.length ? false : '' })),
      );
    };
    rows.append(...list.map((v, i) => {
      const changed = i > 0 ? changeSummary(layoutChanges(list[i - 1].design, v.design, label)) : 'First save';
      const li = h('li', {}, h('button', { type: 'button' }, h('span', { class: 'd-muted' }, new Date(v.at).toLocaleString()), ' ', changed));
      li.querySelector('button')!.addEventListener('click', () => show(i));
      return li;
    }).reverse());
    dialog.append(h('h3', { id: 'le-versions-title' }, `Versions of ${this.name}`), h('div', { class: 'le-versions-body' }, rows, detail), h('div', { class: 'd-actions' }, button('Close', close)));
    document.body.append(dialog);
    dialog.showModal();
    if (list.length) show(list.length - 1);
  }

  /**
   * The window-width preview: the layout as the web client draws it in a window
   * `previewWidth` points wide (stacked below Layout Setup's breakpoint, objects
   * hidden below theirs), framed at that width. Editing is off while it shows.
   */
  private drawPreview(): void {
    this.canvas.inert = false;
    this.overlay.tabIndex = -1;
    const w = this.previewWidth;
    const fallback = this.meta.stackBelowDefault ?? 0;
    const shown = responsiveDesign(this.design, w, fallback);
    const { height } = paintLayout(this.canvas, { ...this.meta, design: shown }, SCOPE, this.panels);
    for (const s of [this.canvas, this.overlay]) {
      s.style.width = `${w}px`;
      s.style.height = `${height}px`;
    }
    this.overlay.replaceChildren();
    this.stage.classList.add('le-previewing');
    this.el?.classList.add('le-previewing');
    this.stage.style.width = `${w * this.zoom}px`;
    this.stage.style.height = `${height * this.zoom}px`;
    this.canvas.style.transform = this.overlay.style.transform = `scale(${this.zoom})`;
    const own = this.design.responsive?.stackBelow;
    const stackBelow = stackBreakpoint(this.design, fallback);
    const stacked = stackBelow > 0 && w < stackBelow;
    const hidden = (objs: LayoutObject[]): number => objs.reduce((n, o) => n + (o.responsive?.hideBelow && w < o.responsive.hideBelow ? 1 : 0) + hidden(o.children ?? []), 0);
    const gone = hidden(this.design.objects);
    const wide = layoutWidth(this.design.width, this.design.objects) > w;
    const from = own === undefined ? ', the server\'s setting' : '';
    const how = stacked ? `stacked in one column (it stacks below ${stackBelow}${from})`
      : stackBelow ? `as designed (it stacks only below ${stackBelow}${from})`
      : wide ? 'as designed, scrolling sideways: set "Stack in one column below" in Layout Setup to fit narrow windows'
      : 'as designed';
    this.previewNote.replaceChildren(
      h('span', {}, `A window ${w} points wide shows this layout ${how}${gone ? `, without ${gone} object${gone === 1 ? '' : 's'} hidden at this width` : ''}. Editing is off while previewing.`),
      stacked && w <= 480 ? button('Make a phone layout', () => void this.makePhoneLayout(shown), { title: 'A new layout from this stacked version, to adjust by hand' }) : '',
    );
    this.previewNote.hidden = false;
    this.drawInspector();
  }

  /** Redraws the phone preview a moment after the last change (it's worked out by the server from what is open). */
  private queuePhone(): void {
    this.phonePane.hidden = !this.showPhone;
    if (!this.showPhone) return;
    clearTimeout(this.phoneTimer);
    this.phoneTimer = setTimeout(() => void this.drawPhone(), 300);
  }

  private async drawPhone(): Promise<void> {
    const asked = ++this.phoneAsked;
    let r: Awaited<ReturnType<typeof this.studio.client.phone>>;
    try {
      r = await this.studio.client.phone(this.design.id, this.design);
    } catch (e) {
      if (asked === this.phoneAsked) this.phonePane.replaceChildren(h('p', { class: 'd-muted' }, `No phone preview: ${errorText(e)}`));
      return;
    }
    if (asked !== this.phoneAsked || !this.showPhone) return;
    const ex = r.existing;
    // A phone layout that was edited by hand shows as it is; one that follows (or none yet) shows what this layout makes.
    const design = ex && !ex.following ? ex.design : r.phone;
    const caption = !ex ? 'What a phone layout made from this shows'
      : ex.following ? `${ex.name}, which follows this layout${this.dirty ? ' (as it will after Save)' : ''}`
      : `${ex.name}, edited by hand: it no longer follows this layout`;
    const actions = !ex ? button('Make phone layout', () => void this.makePhoneLayout({ ...this.design, width: design.width }), { title: 'A new layout from this one at phone width, following its changes until it is edited by hand' })
      : !ex.following ? button('Rebuild from this layout', () => confirm(`Rebuild ${ex.name} from this layout? Its hand edits are replaced (History takes it back).`) && void this.studio.apply([{ op: 'updateLayout', layout: ex.id, rebuildPhone: true }], `Rebuilt ${ex.name}: it follows this layout again`), { title: 'Throws away the hand edits on the phone layout' })
      : '';
    this.phonePane.replaceChildren(picture(this.meta, design, new Map(), caption, { width: design.width ?? 390, height: 4000 }), actions);
  }

  /** A new layout, "<name> (phone)", from the stacked design at phone width, opened to adjust by hand. */
  private async makePhoneLayout(shown: LayoutDesign): Promise<void> {
    // Making it reopens this editor: unsaved edits are saved first, as Change with AI does.
    if (this.dirty) await this.save();
    if (this.dirty) return;
    const taken = new Set(this.studio.design.layouts.map((l) => l.name));
    let name = `${this.name} (phone)`;
    for (let n = 2; taken.has(name); n++) name = `${this.name} (phone ${n})`;
    if (this.design.tableOccurrenceId === undefined) return toast('This layout shows no table occurrence, so a copy of it can\'t be made');
    // Made by the server from the saved layout at this width, so it follows this layout's changes until it's edited by hand.
    await this.studio.apply([{ op: 'createLayout', name, phoneOf: this.design.id, width: shown.width }], `Made "${name}": it follows this layout until you edit it; open it from the Layouts tab`);
  }

  /** Two pictures of a save: the layout before it and after it, with what it added, removed and changed marked. */
  private beforeAfter(before: LayoutDesign, after: LayoutDesign): HTMLElement {
    const { added, removed, changed } = changedIds(before, after);
    const marks = (ids: [number[], 'added' | 'removed' | 'changed'][]) => new Map(ids.flatMap(([list, kind]) => list.map((id) => [id, kind] as const)));
    return h('div', { class: 'le-before-after' },
      this.picture(before, marks([[removed, 'removed'], [changed, 'changed']]), 'Before'),
      this.picture(after, marks([[added, 'added'], [changed, 'changed']]), 'After'));
  }

  private picture(design: LayoutDesign, marks: Map<number, 'added' | 'removed' | 'changed'>, caption: string): HTMLElement {
    return picture(this.meta, design, marks, caption);
  }

  /** The selected objects, leaving out ones inside a selected object (they move with it). */
  private objects(): LayoutObject[] {
    const out: LayoutObject[] = [];
    const visit = (objs: LayoutObject[]) => {
      for (const o of objs) {
        if (this.selected.has(o.id)) out.push(o);
        else if (o.children) visit(o.children);
      }
    };
    visit(this.design.objects);
    return out;
  }

  /** The list an object sits in: the layout's, or a portal's, tab panel's or group's. */
  private listOf(id: number, objs = this.design.objects): LayoutObject[] | undefined {
    for (const o of objs) {
      if (o.id === id) return objs;
      const inner = o.children && this.listOf(id, o.children);
      if (inner) return inner;
    }
    return undefined;
  }

  private remove(ids: Set<number>): void {
    ids = new Set(ids);
    walk(this.design.objects, (o) => {
      if (ids.has(o.id) && o.kind === 'popover-button' && o.target !== undefined) ids.add(o.target);
    });
    const prune = (objs: LayoutObject[]): LayoutObject[] => objs.filter((o) => !ids.has(o.id)).map((o) => (o.children ? { ...o, children: prune(o.children) } : o));
    this.design.objects = prune(this.design.objects);
    this.selected.clear();
  }

  /** The object whose children hold an object (undefined on the layout itself). */
  private parentOf(id: number): LayoutObject | undefined {
    let found: LayoutObject | undefined;
    walk(this.design.objects, (o) => {
      if (o.children?.some((c) => c.id === id)) found = o;
    });
    return found;
  }

  private find(id: number | undefined): LayoutObject | undefined {
    return id === undefined ? undefined : findLayoutObject(this.design.objects, id);
  }

  /**
   * Open a popover when its button, it, or something in it is selected; it
   * stays open (so objects can be dragged onto it) until the selection is
   * cleared by clicking an empty spot.
   */
  private syncPopover(): void {
    const sel = [...this.selected].map((id) => this.find(id)).filter((o): o is LayoutObject => !!o);
    for (const o of sel) {
      if (o.kind === 'popover-button' && o.target !== undefined) return void (this.openPopover = o.target);
      if (o.kind === 'popover') return void (this.openPopover = o.id);
      let p = this.parentOf(o.id);
      while (p && p.kind !== 'popover') p = this.parentOf(p.id);
      if (p) return void (this.openPopover = p.id);
    }
    if (!sel.length) this.openPopover = undefined;
  }

  private shownPanel(o: LayoutObject): LayoutObject | undefined {
    const panels = (o.children ?? []).filter((c) => PANEL_KINDS.has(c.kind));
    const id = this.panels.get(o.id) ?? o.target;
    return panels.find((p) => p.id === id) ?? panels[0];
  }

  /** What an object would drop into: the innermost portal first row or shown tab panel around it. */
  private containerFor(o: LayoutObject): LayoutObject | undefined {
    let found: LayoutObject | undefined;
    const visit = (objs: LayoutObject[]) => {
      for (const c of objs) {
        if (c === o) continue;
        if (c.kind === 'portal' && !NOT_IN_PORTAL.has(o.kind)) {
          const row = { ...c.bounds, top: c.bounds.top + 1, bottom: c.bounds.top + 1 + portalRowHeight(c) };
          if (inside(o.bounds, row)) found = c;
        } else if (isPanels(c) && inside(o.bounds, c.bounds)) {
          const panel = this.shownPanel(c);
          if (panel) {
            found = panel;
            visit(panel.children ?? []);
          }
        }
      }
    };
    visit(this.design.objects);
    const pop = this.find(this.openPopover);
    if (!found && pop && o !== pop && o.kind !== 'popover' && o.kind !== 'popover-button' && inside(o.bounds, pop.bounds)) {
      found = pop;
      visit(pop.children ?? []);
    }
    return found;
  }

  /** Put moved objects into the portal or tab panel they were dropped on, or back on the layout. */
  private reparent(moved: LayoutObject[]): void {
    for (const o of moved) {
      const parent = this.parentOf(o.id);
      if (parent && (parent.kind === 'button-bar' || parent.kind === 'group')) continue; // segments and grouped objects stay put
      const from = this.listOf(o.id);
      const into = this.containerFor(o);
      const to = into ? (into.children ??= []) : this.design.objects;
      if (!from || from === to) continue;
      from.splice(from.indexOf(o), 1);
      to.push(o);
    }
  }

  private nextId(): number {
    let max = 0;
    walk(this.design.objects, (o) => (max = Math.max(max, o.id)));
    return max + 1;
  }

  private get dirty(): boolean {
    return JSON.stringify(this.design) !== this.saved;
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    this.syncPopover();
    this.queuePhone();
    if (this.previewWidth) return this.drawPreview();
    // The painted fields are a picture in editing mode; keyboard focus belongs to the overlay.
    this.canvas.inert = true;
    this.overlay.tabIndex = 0;
    this.previewNote.hidden = true;
    this.stage.classList.remove('le-previewing');
    this.el?.classList.remove('le-previewing');
    const parts = [...this.design.parts].sort((a, b) => a.top - b.top);
    const { width, height } = paintLayout(this.canvas, { ...this.meta, design: this.design }, SCOPE, this.panels, this.find(this.openPopover));
    for (const s of [this.canvas, this.overlay]) {
      s.style.width = `${width}px`;
      s.style.height = `${height}px`;
    }
    this.stage.style.width = `${width * this.zoom}px`;
    this.stage.style.height = `${height * this.zoom}px`;
    this.canvas.style.transform = this.overlay.style.transform = `scale(${this.zoom})`;

    // The editing layer: part boundaries and a box per top-level object.
    this.overlay.replaceChildren();
    const viewClasses = layoutViewClasses(this.viewOptions);
    this.overlay.classList.toggle('le-show-margins', viewClasses.includes('le-show-margins'));
    if (this.viewOptions.pageMargins && !parts.some((p) => p.kind === 'top-navigation' || p.kind === 'bottom-navigation')) {
      const page = pageSize(this.design.width ?? width, this.meta.pageSetup);
      const { top, left } = page.margins;
      this.overlay.append(h('div', {
        class: 'le-page-margins', 'aria-hidden': 'true',
        style: `left:${left}px;top:${top}px;width:${page.width}px;height:${page.height}px`,
      }));
    }
    for (const p of parts) {
      const name = p.kind.startsWith('sub-summary') ? `sub-summary by ${p.breakField?.field ?? '?'} (${p.kind.endsWith('leading') ? 'leading' : 'trailing'})` : p.kind.replace(/-/g, ' ');
      const bar = h('div', { class: 'le-part', style: `top:${p.top + p.height - 1}px`, 'data-part': String(p.top) }, h('span', {}, name));
      this.overlay.append(bar);
    }
    // Objects inside portals and the shown tab panels get boxes of their own, drawn above their container's.
    const boxes = (objs: LayoutObject[], nested: boolean) => {
      for (const o of objs) {
        if (o.kind === 'popover' && o.id !== this.openPopover) continue;
        const b = o.bounds;
        const box = h('div', {
          class: ['le-obj', nested && 'le-nested', o.kind === 'portal' && 'le-portal', this.selected.has(o.id) && 'selected', o.locked && 'le-locked', ...layoutViewClasses(this.viewOptions, o)].filter(Boolean).join(' '),
          'data-id': String(o.id), 'data-kind': o.kind, title: label(o) + (o.locked ? ' (locked)' : ''),
          style: `left:${b.left}px;top:${b.top}px;width:${Math.max(2, b.right - b.left)}px;height:${Math.max(2, b.bottom - b.top)}px`,
        });
        if (o.sliding && this.viewOptions.slidingObjects) {
          const directions = [o.sliding.up && '↑', o.sliding.left && '←'].filter(Boolean).join(' ');
          box.append(h('span', { class: 'le-slide-indicator', 'aria-hidden': 'true', title: `Slides${directions ? ` ${directions}` : ''}` }, directions || '↕'));
        }
        if (o.hide && this.viewOptions.hideCondition) box.append(h('span', { class: 'le-hide-indicator', 'aria-hidden': 'true', title: `Hide condition: ${o.hide.formula}` }, '◉'));
        if (o.kind === 'portal') box.style.setProperty('--le-row', `${portalRowHeight(o)}px`);
        if (this.selected.size === 1 && this.selected.has(o.id) && !this.locked(o) && !this.tabDraft) {
          for (const hd of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Handle[]) box.append(h('i', { class: `le-handle le-${hd}`, 'data-handle': hd }));
        }
        this.overlay.append(box);
        if (this.tabDraft && tabbable(o)) {
          const n = this.tabDraft.indexOf(o.id);
          box.append(h('span', { class: `le-tab${n < 0 ? ' le-tab-off' : ''}`, 'data-tab': String(o.id) }, n < 0 ? '' : String(n + 1)));
        }
        if (o.kind === 'portal' || o.kind === 'button-bar' || o.kind === 'popover') boxes(o.children ?? [], true);
        else if (isPanels(o)) boxes(this.shownPanel(o)?.children ?? [], true);
      }
    };
    boxes(this.design.objects.filter((o) => o.kind !== 'popover'), false);
    boxes(this.design.objects.filter((o) => o.kind === 'popover'), false);
    if (this.design.width) this.overlay.append(h('div', { class: 'le-width', style: `left:${this.design.width}px` }));
    for (const x of this.guides.x) this.overlay.append(h('div', { class: 'le-guide le-guide-x', style: `left:${x}px` }));
    for (const y of this.guides.y) this.overlay.append(h('div', { class: 'le-guide le-guide-y', style: `top:${y}px` }));
    for (const g of this.guides.gaps) this.overlay.append(h('div', { class: `le-gap le-gap-${g.across ? 'x' : 'y'}`, style: g.across ? `left:${g.from}px;width:${g.to - g.from}px;top:${g.at}px` : `top:${g.from}px;height:${g.to - g.from}px;left:${g.at}px` }));
    this.overlay.classList.toggle('le-show-grid', this.grid.show);
    this.overlay.style.setProperty('--le-grid', `${this.grid.size}px`);
    this.overlay.classList.toggle('le-tabbing', !!this.tabDraft);
    this.status.textContent = this.dirty ? 'Unsaved changes' : 'Saved';
    this.drawPeers();
    this.drawClashes();
    this.studio.together?.at(this.design.id, [...this.selected]);
    this.drawInspector();
    this.drawObjects();
    this.announceSelection();
  }

  private announceSelection(): void {
    const objects = this.objects();
    const message = objects.length ? objects.map((o) => {
      const b = o.bounds;
      const name = o.name || (o.field ? label(o) : o.text || o.portal?.tableOccurrence) || `Object ${o.id}`;
      return `${o.kind.replace(/-/g, ' ')}: ${name}. Position ${b.left}, ${b.top}; width ${b.right - b.left}, height ${b.bottom - b.top} points${this.locked(o) ? '. Locked' : ''}.`;
    }).join(' ') : 'No object selected.';
    // Keep the live region mounted and quiet on redraws that don't change the selection or its geometry.
    if (this.selectionStatus.textContent !== message) this.selectionStatus.textContent = message;
  }

  /** Traverse the same objects that have editing boxes, including shown container contents. */
  private selectNext(backward: boolean): boolean {
    const objects = [...this.overlay.querySelectorAll<HTMLElement>('.le-obj')]
      .map((box) => this.find(Number(box.dataset.id))).filter((o): o is LayoutObject => !!o);
    const order = new Map((this.design.tabOrder ?? []).map((id, i) => [id, i]));
    objects.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)
      || a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left || a.id - b.id);
    const selected = objects.filter((o) => this.selected.has(o.id));
    const current = backward ? selected[0] : selected.at(-1);
    const at = current ? objects.indexOf(current) + (backward ? -1 : 1) : backward ? objects.length - 1 : 0;
    const next = objects[at];
    if (!next) return false; // Let the browser move focus out at either end; never wrap or trap Tab.
    this.selected = new Set([next.id]);
    this.draw();
    this.overlay.querySelector(`.le-obj[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  // ---------------------------------------------------------------- pointer

  private snap(v: number, free: boolean): number {
    return free || !this.grid.snap ? Math.round(v) : Math.round(v / this.grid.size) * this.grid.size;
  }

  /** Locked, or inside a locked group or container. */
  private locked(o: LayoutObject): boolean {
    for (let x: LayoutObject | undefined = o; x; x = this.parentOf(x.id)) if (x.locked) return true;
    return false;
  }

  /**
   * Dynamic guides: the edges and centres of the objects showing (not the ones
   * being moved) that a moved box's edges or centre come within GUIDE_SNAP of.
   * Returns the shift that lines it up, and the lines to draw.
   */
  private guideSnap(box: LayoutObject['bounds'], moving: Set<number>): { dx?: number; dy?: number; x: number[]; y: number[]; gaps: Gap[] } {
    const xs: number[] = [];
    const ys: number[] = [];
    const others: LayoutObject['bounds'][] = [];
    const visit = (objs: LayoutObject[]) => {
      for (const o of objs) {
        if (moving.has(o.id) || (o.kind === 'popover' && o.id !== this.openPopover)) continue;
        const b = o.bounds;
        others.push(b);
        xs.push(b.left, (b.left + b.right) / 2, b.right);
        ys.push(b.top, (b.top + b.bottom) / 2, b.bottom);
        if (o.kind === 'portal' || o.kind === 'popover') visit(o.children ?? []);
        else if (isPanels(o)) visit(this.shownPanel(o)?.children ?? []);
      }
    };
    visit(this.design.objects);
    const best = (mine: number[], theirs: number[]) => {
      let d: number | undefined;
      for (const m of mine) for (const t of theirs) if (Math.abs(t - m) <= GUIDE_SNAP / this.zoom && (d === undefined || Math.abs(t - m) < Math.abs(d))) d = t - m;
      return d;
    };
    const mx = [box.left, (box.left + box.right) / 2, box.right];
    const my = [box.top, (box.top + box.bottom) / 2, box.bottom];
    const lines = (mine: number[], theirs: number[], d?: number) => (d === undefined ? [] : [...new Set(mine.map((m) => m + d).filter((m) => theirs.some((t) => Math.abs(t - m) < 0.5)))]);
    let dx = best(mx, xs);
    let dy = best(my, ys);
    const out = { x: lines(mx, xs, dx), y: lines(my, ys, dy), gaps: [] as Gap[] };
    // Equal spacing, which FileMaker's guides don't offer: with no edge to line up
    // with, the box snaps to the same gap two of its row's (or column's) neighbours have.
    if (dx === undefined) {
      const s = equalSpacing(box, others, true, GUIDE_SNAP / this.zoom);
      if (s) [dx, out.gaps] = [s.d, [...out.gaps, ...s.gaps]];
    }
    if (dy === undefined) {
      const s = equalSpacing(box, others, false, GUIDE_SNAP / this.zoom);
      if (s) [dy, out.gaps] = [s.d, [...out.gaps, ...s.gaps]];
    }
    return { dx, dy, ...out };
  }

  private point(e: MouseEvent): { x: number; y: number } {
    const r = this.overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom };
  }

  private pointerDown(e: PointerEvent): void {
    this.overlay.focus({ preventScroll: true });
    const target = e.target as HTMLElement;
    const start = this.point(e);
    const free = e.altKey;
    if (this.tabDraft) return this.tabClick(target);
    // A right-click only selects (the context menu follows); it never starts a drag.
    if (e.button === 2) {
      const hit = target.closest<HTMLElement>('.le-obj');
      if (hit && !this.selected.has(Number(hit.dataset.id))) {
        this.selected = new Set([Number(hit.dataset.id)]);
        this.draw();
      }
      return;
    }
    const partBar = target.closest<HTMLElement>('.le-part');
    if (partBar) return this.dragPart(e, Number(partBar.dataset.part), start);
    const box = target.closest<HTMLElement>('.le-obj');
    if (!box) {
      this.selected.clear();
      this.draw();
      return;
    }
    let id = Number(box.dataset.id);
    // As in FileMaker, the first click on a button bar selects the bar; a click on a segment of the selected bar selects the segment.
    const bar = this.parentOf(id);
    if (bar?.kind === 'button-bar' && !this.selected.has(bar.id) && !bar.children!.some((c) => this.selected.has(c.id))) id = bar.id;
    const segment = bar?.kind === 'button-bar' && id !== bar.id;
    const handle = target.dataset.handle as Handle | undefined;
    if (e.shiftKey) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
      this.draw();
      return;
    }
    if (!this.selected.has(id)) {
      this.selected = new Set([id]);
      this.draw();
    }
    // Locked objects can be selected (to unlock them, or to copy them) but not moved or resized.
    if (this.objects().some((o) => this.locked(o))) return;
    const before = JSON.stringify(this.design);
    const originals = new Map(this.objects().map((o) => [o.id, structuredClone(o)]));
    const moving = new Set<number>();
    for (const o of originals.values()) walk([o], (x) => moving.add(x.id));
    const box0 = union([...originals.values()]);
    let moved = false;
    this.overlay.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = this.point(ev);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (segment || (!moved && Math.abs(dx) + Math.abs(dy) < 3)) return; // segments move with their bar
      moved = true;
      this.guides = { x: [], y: [], gaps: [] };
      if (handle) {
        for (const o of this.objects()) {
          const orig = originals.get(o.id)!;
          const b = { ...orig.bounds };
          if (handle.includes('n')) b.top = Math.min(this.snap(orig.bounds.top + dy, free), b.bottom - 4);
          if (handle.includes('s')) b.bottom = Math.max(this.snap(orig.bounds.bottom + dy, free), b.top + 4);
          if (handle.includes('w')) b.left = Math.min(this.snap(orig.bounds.left + dx, free), b.right - 4);
          if (handle.includes('e')) b.right = Math.max(this.snap(orig.bounds.right + dx, free), b.left + 4);
          if (o.kind === 'group') scaleGroup(o, orig, b);
          o.bounds = b;
          fitPanels(o);
          fitSegments(o);
        }
      } else {
        // Lining up with another object's edge or centre wins over the grid; Alt moves freely.
        const g = free ? { x: [], y: [], gaps: [] } : this.guideSnap({ left: box0.left + dx, right: box0.right + dx, top: box0.top + dy, bottom: box0.bottom + dy }, moving);
        for (const o of this.objects()) {
          const orig = originals.get(o.id)!;
          const ndx = 'dx' in g && g.dx !== undefined ? Math.round(dx + g.dx) : this.snap(orig.bounds.left + dx, free) - orig.bounds.left;
          const ndy = 'dy' in g && g.dy !== undefined ? Math.round(dy + g.dy) : this.snap(orig.bounds.top + dy, free) - orig.bounds.top;
          shift(o, ndx - (o.bounds.left - orig.bounds.left), ndy - (o.bounds.top - orig.bounds.top));
        }
        this.guides = { x: g.x, y: g.y, gaps: g.gaps };
      }
      this.draw();
    };
    const up = () => {
      this.overlay.removeEventListener('pointermove', move);
      this.overlay.removeEventListener('pointerup', up);
      this.guides = { x: [], y: [], gaps: [] };
      if (moved) {
        this.rememberUndo(before);
        this.redo = [];
        if (!handle) this.reparent(this.objects());
      }
      this.draw();
    };
    this.overlay.addEventListener('pointermove', move);
    this.overlay.addEventListener('pointerup', up);
  }

  /** Right-click: the everyday commands for the selection (or Paste on empty canvas), as in FileMaker's Layout mode. */
  private contextMenu(e: MouseEvent): void {
    if (this.tabDraft) return;
    e.preventDefault();
    this.overlay.focus({ preventScroll: true });
    document.querySelector('.le-context')?.remove();
    const sel = this.objects();
    const free = sel.filter((o) => !this.locked(o));
    const menu = h('ul', { class: 'menu field-menu le-context', role: 'menu', 'aria-label': 'Layout object commands' });
    const close = () => {
      menu.remove();
      document.removeEventListener('mousedown', outside, true);
    };
    const outside = (m: Event) => {
      if (!menu.contains(m.target as Node)) close();
    };
    const item = (label: string, run: () => unknown, enabled = true) => {
      const li = h('li', { role: 'menuitem', ...(enabled ? {} : { class: 'disabled', 'aria-disabled': 'true' }) }, h('span', { class: 'label' }, label));
      if (enabled) li.addEventListener('click', () => {
        close();
        void Promise.resolve(run()).catch((err) => toast(err instanceof Error ? err.message : String(err)));
        this.overlay.focus({ preventScroll: true });
      });
      menu.append(li);
    };
    const sep = () => menu.append(h('li', { class: 'separator', role: 'separator' }));
    if (sel.length) {
      item('Cut', () => this.cutObjects());
      item('Copy', () => this.copyObjects());
    }
    item('Paste', async () => {
      const xml = await navigator.clipboard.readText().catch(() => '');
      if (!xml) return toast('Nothing to paste; copy layout objects first');
      await this.pasteObjects(xml);
    });
    if (sel.length) {
      item('Duplicate', () => this.duplicate());
      sep();
      item('Bring to Front', () => this.toEnd(free, true), free.length > 0);
      item('Send to Back', () => this.toEnd(free, false), free.length > 0);
      sep();
      item('Group', () => this.group(), sel.length > 1);
      item('Ungroup', () => this.ungroup(), sel.some((o) => o.kind === 'group'));
      const locked = sel.some((o) => this.locked(o));
      item(locked ? 'Unlock' : 'Lock', () => this.setLocked(sel, !locked));
      sep();
      item('Delete', () => {
        if (free.length < sel.length) toast('Locked objects stay; unlock them to delete them');
        if (free.length) this.change(() => this.remove(new Set(free.map((o) => o.id))));
      }, free.length > 0);
    }
    document.body.append(menu);
    menu.style.left = `${Math.min(e.clientX, innerWidth - menu.offsetWidth - 4)}px`;
    menu.style.top = `${Math.min(e.clientY, innerHeight - menu.offsetHeight - 4)}px`;
    document.addEventListener('mousedown', outside, true);
    const first = menu.querySelector<HTMLElement>('li[role=menuitem]');
    first?.focus?.();
  }

  /** Drag a part's bottom edge: the part grows or shrinks, and everything below moves with it. */
  private dragPart(e: PointerEvent, top: number, start: { x: number; y: number }): void {
    const part = this.design.parts.find((p) => p.top === top);
    if (!part) return;
    const before = JSON.stringify(this.design);
    const orig = structuredClone(this.design);
    const end = part.top + part.height;
    let moved = false;
    this.overlay.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dy = this.snap(this.point(ev).y - start.y, ev.altKey);
      const grow = Math.max(-orig.parts.find((p) => p.top === top)!.height + 8, dy);
      moved = grow !== 0;
      this.design.parts = orig.parts.map((p) => (p.top === top ? { ...p, height: p.height + grow } : p.top > top ? { ...p, top: p.top + grow } : { ...p }));
      this.design.objects = structuredClone(orig.objects);
      for (const o of this.design.objects) if (o.bounds.top >= end) shift(o, 0, grow);
      this.draw();
    };
    const up = () => {
      this.overlay.removeEventListener('pointermove', move);
      this.overlay.removeEventListener('pointerup', up);
      if (moved) {
        this.rememberUndo(before);
        this.redo = [];
      }
    };
    this.overlay.addEventListener('pointermove', move);
    this.overlay.addEventListener('pointerup', up);
  }

  private key(e: KeyboardEvent): void {
    if (this.previewWidth) return;
    const mod = e.metaKey || e.ctrlKey;
    if (this.tabDraft) {
      if (e.key === 'Escape') this.endTabOrder(false);
      if (e.key === 'Enter') this.endTabOrder(true);
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      if (this.selectNext(e.shiftKey)) e.preventDefault();
      return;
    }
    // FileMaker's pane shortcuts: ⌘K the Fields and Objects pane, ⌘I the Inspector.
    if (mod && !e.shiftKey && !e.altKey && (e.code === 'KeyK' || e.code === 'KeyI')) {
      e.preventDefault();
      if (e.code === 'KeyK') this.toggleLeft();
      else this.toggleInspector();
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.restore(this.redo, this.undo);
      else this.restore(this.undo, this.redo);
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.save();
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.selected = new Set(this.design.objects.map((o) => o.id));
      this.draw();
      return;
    }
    if (!this.selected.size) return;
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      this.copyObjects();
      return;
    }
    if (mod && e.key.toLowerCase() === 'x') {
      // Cut: copied for FileMaker, then removed; locked objects stay.
      e.preventDefault();
      void this.cutObjects();
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.duplicate();
      return;
    }
    // FileMaker's stacking shortcuts: ⌘] forward, ⌘[ backward, ⇧⌘] to front, ⇧⌘[ to back.
    if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      e.preventDefault();
      const free = this.objects().filter((o) => !this.locked(o));
      const forward = e.code === 'BracketRight';
      if (e.shiftKey) this.toEnd(free, forward);
      else this.step(free, forward ? 1 : -1);
      return;
    }
    // FileMaker's Arrange shortcuts: ⌘R group, ⇧⌘R ungroup, ⌘L lock, ⌥⌘L unlock.
    if (mod && e.code === 'KeyR') {
      e.preventDefault();
      if (e.shiftKey) this.ungroup();
      else this.group();
      return;
    }
    if (mod && e.code === 'KeyL') {
      e.preventDefault();
      this.setLocked(this.objects(), !e.altKey);
      return;
    }
    const free = this.objects().filter((o) => !this.locked(o));
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (free.length < this.objects().length) toast('Locked objects stay; unlock them to delete them');
      if (free.length) this.change(() => this.remove(new Set(free.map((o) => o.id))));
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
    if (d && !mod) {
      e.preventDefault();
      if (free.length) this.change(() => free.forEach((o) => {
        if (!e.altKey) return shift(o, d[0], d[1]);
        // Alt+Arrow changes the right/bottom edge; Shift keeps the existing 10-point step.
        const b = { ...o.bounds };
        if (d[0]) b.right = Math.max(b.left + 4, b.right + d[0]);
        if (d[1]) b.bottom = Math.max(b.top + 4, b.bottom + d[1]);
        if (o.kind === 'group') scaleGroup(o, o, b);
        o.bounds = b;
        fitPanels(o);
        fitSegments(o);
      }));
    }
  }

  /** Copies of the selected objects, 10 points down and right; a popover button brings its popover. */
  private duplicate(): void {
    this.change(() => {
      const copies: number[] = [];
      let next = this.nextId();
      const ids = new Map<number, number>();
      const copy = (o: LayoutObject) => {
        const c = structuredClone(o);
        walk([c], (x) => {
          ids.set(x.id, next);
          x.id = next++;
        });
        delete c.locked;
        shift(c, 10, 10);
        (this.listOf(o.id) ?? this.design.objects).push(c);
        return c;
      };
      const made = this.objects().map(copy);
      for (const c of [...made]) {
        if (c.kind === 'popover-button' && c.target !== undefined && !ids.has(c.target)) {
          const pop = this.find(c.target);
          if (pop) made.push(copy(pop));
        }
      }
      walk(made, (x) => {
        if (x.target !== undefined && ids.has(x.target)) x.target = ids.get(x.target);
        if (x.activeSegment !== undefined && ids.has(x.activeSegment)) x.activeSegment = ids.get(x.activeSegment);
      });
      for (const c of made) if (c.kind !== 'popover' || !made.some((b) => b.target === c.id)) copies.push(c.id);
      this.selected = new Set(copies);
    });
  }

  // ---------------------------------------------------------------- arranging

  private setLocked(objs: LayoutObject[], lock: boolean): void {
    if (!objs.length) return;
    this.change(() => objs.forEach((o) => (lock ? (o.locked = true) : delete o.locked)));
  }

  /** Groups the selected objects (they must share a container), at the place of the frontmost. */
  private group(): void {
    const sel = this.objects();
    if (sel.length < 2) return toast('Select two or more objects to group');
    const list = this.listOf(sel[0].id);
    if (!list || sel.some((o) => this.listOf(o.id) !== list)) return toast('Objects in different portals, panels or popovers can\'t be grouped');
    if (this.parentOf(sel[0].id)?.kind === 'button-bar') return toast('Button bar segments can\'t be grouped');
    if (sel.some((o) => this.locked(o))) return toast('Unlock the objects first');
    this.change(() => {
      const ordered = list.filter((o) => sel.includes(o));
      const at = list.indexOf(ordered[ordered.length - 1]) - ordered.length + 1;
      const g: LayoutObject = { id: this.nextId(), kind: 'group', type: 8, anchors: { left: true, top: true, right: false, bottom: false }, bounds: union(ordered), style: {}, children: ordered };
      for (const o of ordered) list.splice(list.indexOf(o), 1);
      list.splice(at, 0, g);
      this.selected = new Set([g.id]);
    });
  }

  /** Ungroups the selected groups: what was in them takes their place. */
  private ungroup(): void {
    const groups = this.objects().filter((o) => o.kind === 'group');
    if (!groups.length) return toast('Select a group to ungroup');
    if (groups.some((o) => this.locked(o))) return toast('Unlock the group first');
    if (groups.some((g) => g.action) && !confirm('Ungrouping a button group removes its button action. Ungroup?')) return;
    this.change(() => {
      const ids: number[] = [];
      for (const g of groups) {
        const list = this.listOf(g.id)!;
        list.splice(list.indexOf(g), 1, ...(g.children ?? []));
        ids.push(...(g.children ?? []).map((c) => c.id));
      }
      this.selected = new Set(ids);
    });
  }

  /** Brings objects to the front or sends them to the back of the list they are in, keeping their order among themselves. */
  private toEnd(objs: LayoutObject[], front: boolean): void {
    this.change(() => {
      for (const o of front ? objs : [...objs].reverse()) {
        const list = this.listOf(o.id)!;
        list.splice(list.indexOf(o), 1);
        if (front) list.push(o);
        else list.unshift(o);
      }
    });
  }

  /** Moves an object one step forward or back among the objects it overlaps' list (FileMaker's Bring Forward, Send Backward). */
  private step(objs: LayoutObject[], dir: 1 | -1): void {
    this.change(() => {
      for (const o of dir > 0 ? [...objs].reverse() : objs) {
        const list = this.listOf(o.id)!;
        const i = list.indexOf(o);
        const j = i + dir;
        if (j < 0 || j >= list.length || objs.includes(list[j])) continue;
        [list[i], list[j]] = [list[j], list[i]];
      }
    });
  }

  /**
   * Spaces three or more objects evenly between the outermost two, across or
   * down: equal gaps between them, or, when they are too big to fit side by
   * side, equally spaced centres.
   */
  private distribute(sel: LayoutObject[], across: boolean): void {
    const [a, b] = across ? (['left', 'right'] as const) : (['top', 'bottom'] as const);
    const size = (o: LayoutObject) => o.bounds[b] - o.bounds[a];
    const mid = (o: LayoutObject) => (o.bounds[a] + o.bounds[b]) / 2;
    const sorted = [...sel].sort((x, y) => mid(x) - mid(y));
    const start = Math.min(...sel.map((o) => o.bounds[a]));
    const gap = (Math.max(...sel.map((o) => o.bounds[b])) - start - sel.reduce((n, o) => n + size(o), 0)) / (sel.length - 1);
    const first = mid(sorted[0]);
    const step = (mid(sorted[sorted.length - 1]) - first) / (sel.length - 1);
    this.change(() => {
      let at = start;
      sorted.forEach((o, i) => {
        const to = gap >= 0 ? at : first + i * step - size(o) / 2;
        const d = Math.round(to) - o.bounds[a];
        at += size(o) + gap;
        shift(o, across ? d : 0, across ? 0 : d);
      });
    });
  }

  // ---------------------------------------------------------------- tab order

  /** Set Tab Order: click objects in the order Tab should visit them. */
  private startTabOrder(): void {
    this.tabDraft = [...(this.design.tabOrder ?? [])];
    this.selected.clear();
    this.draw();
  }

  private endTabOrder(keep: boolean): void {
    const draft = this.tabDraft;
    this.tabDraft = undefined;
    if (keep && draft && JSON.stringify(draft) !== JSON.stringify(this.design.tabOrder ?? [])) {
      this.change(() => (draft.length ? (this.design.tabOrder = draft) : delete this.design.tabOrder));
    } else this.draw();
  }

  /** A click in Set Tab Order: an object not in the order joins it at the end; one in it leaves it. */
  private tabClick(target: HTMLElement): void {
    const el = target.closest<HTMLElement>('[data-tab]') ?? target.closest<HTMLElement>('.le-obj')?.querySelector<HTMLElement>(':scope > [data-tab]');
    if (!el || !this.tabDraft) return;
    const id = Number(el.dataset.tab);
    const i = this.tabDraft.indexOf(id);
    if (i < 0) this.tabDraft.push(id);
    else this.tabDraft.splice(i, 1);
    this.draw();
  }

  /** The objects that can be in the tab order, top to bottom and left to right (FileMaker's default order). */
  private defaultTabOrder(fieldsOnly: boolean): number[] {
    const all: LayoutObject[] = [];
    walk(this.design.objects, (o) => {
      if (tabbable(o) && (!fieldsOnly || o.kind === 'field')) all.push(o);
    });
    return all.sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left).map((o) => o.id);
  }

  private tabInspector(): HTMLElement[] {
    const draft = this.tabDraft!;
    const set = (ids: number[]) => () => {
      this.tabDraft = ids;
      this.draw();
    };
    return [
      h('h3', {}, 'Set Tab Order'),
      h('p', { class: 'd-muted' }, `Click objects in the order Tab should go to them; click a numbered one to take it out. ${draft.length} in the order. Objects in other tab panels show when their panel does.`),
      h('div', { class: 'd-actions' },
        button('Default order', set(this.defaultTabOrder(false)), { title: 'Every field, button and control, top to bottom and left to right' }),
        button('Fields only', set(this.defaultTabOrder(true))),
        button('Clear', set([]))),
      h('div', { class: 'd-actions' },
        button('Done', () => this.endTabOrder(true), { class: 'primary' }),
        button('Cancel', () => this.endTabOrder(false))),
    ];
  }

  // ---------------------------------------------------------------- objects panel

  /** The Objects panel: every object, front to back, with what's inside indented; click to select, the padlock to lock. */
  private drawObjects(): void {
    this.objectsPanel.hidden = !this.showObjects;
    this.el?.querySelector('.le-body')?.classList.toggle('le-with-objects', this.showObjects);
    if (!this.showObjects) return;
    const tabs = h('div', { class: 'le-pane-tabs', role: 'tablist', 'aria-label': 'Left pane' },
      ...([['fields', 'Fields'], ['objects', 'Objects']] as const).map(([id, text]) => button(text, () => {
        this.leftTab = id;
        this.drawObjects();
      }, { role: 'tab', 'aria-selected': String(this.leftTab === id) })));
    if (this.leftTab === 'fields') {
      // Built once, so the table picked and the filter stay put as the selection changes.
      const pane = (this.fieldsPane ??= this.buildFieldsPane());
      if (!this.objectsPanel.contains(pane)) this.objectsPanel.replaceChildren(tabs, pane);
      return;
    }
    const filter = this.objectsPanel.querySelector<HTMLInputElement>('.le-objsearch')?.value.trim().toLowerCase() ?? '';
    const search = h('input', { type: 'search', class: 'le-objsearch', placeholder: 'Find objects', 'aria-label': 'Find objects', value: filter });
    search.addEventListener('input', () => {
      const at = search.selectionStart;
      this.drawObjects();
      const again = this.objectsPanel.querySelector<HTMLInputElement>('.le-objsearch')!;
      again.focus();
      again.setSelectionRange(at, at);
    });
    const list = h('div', { class: 'le-objlist', role: 'tree' });
    const rows = (objs: LayoutObject[], depth: number) => {
      for (const o of [...objs].reverse()) {
        const text = label(o);
        const kids = o.children ?? [];
        if (!filter || text.toLowerCase().includes(filter)) {
          const lock = button(o.locked ? '🔒' : '🔓', () => this.setLocked([o], !o.locked), { class: `le-lock${o.locked ? ' on' : ''}`, title: o.locked ? 'Unlock' : 'Lock', 'aria-label': `${o.locked ? 'Unlock' : 'Lock'} ${text}` });
          const name = h('button', { type: 'button', class: 'le-objname', role: 'treeitem', 'data-id': String(o.id), 'aria-selected': String(this.selected.has(o.id)), style: `padding-left:${6 + depth * 14}px` }, text);
          name.addEventListener('click', (e) => {
            if (e.shiftKey) {
              if (this.selected.has(o.id)) this.selected.delete(o.id);
              else this.selected.add(o.id);
            } else this.selected = new Set([o.id]);
            // A tab panel's contents: bring the panel to the front.
            for (let p = this.parentOf(o.id), c: LayoutObject = o; p; c = p, p = this.parentOf(p.id)) if (isPanels(p) && PANEL_KINDS.has(c.kind)) this.panels.set(p.id, c.id);
            this.draw();
            this.overlay.querySelector(`.le-obj[data-id="${o.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          });
          list.append(h('div', { class: `le-objrow${this.selected.has(o.id) ? ' selected' : ''}` }, name, lock));
        }
        rows(kids, depth + 1);
      }
    };
    rows(this.design.objects, 0);
    const keep = this.objectsPanel.querySelector('.le-objlist')?.scrollTop ?? 0;
    this.objectsPanel.replaceChildren(tabs, search, list);
    list.scrollTop = keep;
  }

  /**
   * FileMaker's Fields pane: a table occurrence's fields, to drag onto the layout (or click to add where there's room),
   * with the control style and label they come with. Several at once go through the Field Picker.
   */
  private buildFieldsPane(): HTMLElement {
    const d = this.studio.design;
    const tos = d.tableOccurrences.filter((t) => !t.dataSourceId && d.tables.some((x) => x.id === t.baseTableId))
      .sort((a, b) => (a.id === this.design.tableOccurrenceId ? -1 : b.id === this.design.tableOccurrenceId ? 1 : a.name.localeCompare(b.name)));
    const occ = select(tos.map((t) => [String(t.id), t.id === this.design.tableOccurrenceId ? `Current Table ("${t.name}")` : t.name] as [string, string]), String(tos[0]?.id ?? ''), { 'aria-label': 'Fields from' });
    const filter = h('input', { type: 'search', placeholder: 'Filter fields', 'aria-label': 'Filter fields' }) as HTMLInputElement;
    const control = select([['edit', 'Edit Box'], ['dropdown', 'Drop-down List'], ['popup', 'Pop-up Menu'], ['checkbox', 'Checkbox Set'], ['radio', 'Radio Button Set'], ['calendar', 'Drop-down Calendar']], 'edit', { 'aria-label': 'Control style' });
    const withLabel = check('With label', true);
    const list = h('div', { class: 'le-fieldlist', role: 'list' });
    const fill = () => {
      const to = tos.find((t) => String(t.id) === occ.value);
      const t = d.tables.find((x) => x.id === to?.baseTableId);
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren(...(t?.fields ?? []).filter((f) => !q || f.name.toLowerCase().includes(q)).map((f) => {
        const row = h('button', { type: 'button', class: 'le-fieldrow', role: 'listitem', draggable: 'true', title: `Drag onto the layout, or click to add ${f.name}` },
          h('span', {}, f.name), h('span', { class: 'le-fieldtype' }, f.kind === 'calculation' ? 'Calculation' : f.kind === 'summary' ? 'Summary' : f.type));
        row.addEventListener('click', () => this.addField(to!.id, f.id, withLabel.input.checked, control.value));
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData(FIELD_DRAG, JSON.stringify({ to: to!.id, field: f.id, label: withLabel.input.checked, display: control.value }));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
        });
        return row;
      }));
    };
    occ.addEventListener('change', fill);
    filter.addEventListener('input', fill);
    fill();
    return h('div', { class: 'le-fields' }, occ, filter, list,
      h('div', { class: 'le-field-options' }, field('Control style', control), withLabel.el),
      button('Several fields at once…', () => this.fieldPicker(), { title: 'Field Picker: tick fields, place them down or across, labels to the left, on top or none' }));
  }

  /** Cut: copies the selection as FileMaker XML, and only once that exists removes it (locked objects stay). */
  private async cutObjects(): Promise<void> {
    const objs = this.objects();
    const free = objs.filter((o) => !this.locked(o));
    if (!(await this.copyObjects())) return;
    if (free.length < objs.length) toast('Locked objects stay; unlock them to cut them');
    if (free.length) this.change(() => this.remove(new Set(free.map((o) => o.id))));
  }

  /** Copies the selected objects as FileMaker's Layout mode clipboard XML. */
  private copyObjects(): Promise<boolean> {
    const objs = this.objects();
    if (!objs.length) return Promise.resolve(false);
    return copyXml(() => this.studio.client.copyLayoutObjects(objs, this.meta.layout.id), objs.length === 1 ? 'the object' : `${objs.length} objects`);
  }

  /**
   * Pastes layout objects copied in FileMaker (or copied here): they keep their
   * positions, or move down and right a little when they would land exactly
   * on objects already there, and come in selected. Unsaved until Save.
   */
  private async pasteObjects(xml: string): Promise<string[] | undefined> {
    try {
      const r = await this.studio.client.layoutSnippet(xml, this.meta.layout.id);
      if (!r.objects.length) {
        toast(r.notes[0] ?? 'Nothing in that to paste');
        return undefined;
      }
      this.change(() => {
        const ids = new Map<number, number>();
        let next = this.nextId();
        walk(r.objects, (o) => {
          ids.set(o.id, next);
          o.id = next++;
        });
        walk(r.objects, (o) => {
          if (o.target !== undefined) o.target = ids.get(o.target);
          if (o.activeSegment !== undefined) o.activeSegment = ids.get(o.activeSegment);
        });
        const here = new Set<string>();
        walk(this.design.objects, (o) => here.add(JSON.stringify(o.bounds)));
        if (r.objects.some((o) => here.has(JSON.stringify(o.bounds)))) r.objects.forEach((o) => shift(o, 10, 10));
        this.design.objects.push(...r.objects);
        this.selected = new Set(r.objects.map((o) => o.id));
      });
      this.overlay.focus();
      if (r.notes.length) notesDialog(r.summary, r.notes);
      else toast(`Pasted ${r.summary.join(', ')}`, 'info');
      return r.notes;
    } catch (e) {
      toast(errorText(e));
      return undefined;
    }
  }

  // ---------------------------------------------------------------- adding

  /** Where new objects go: below everything in the body. */
  private slot(height: number): { top: number; left: number } {
    const body = this.design.parts.find((p) => p.kind === 'body') ?? this.design.parts[0];
    const top0 = body ? body.top + 12 : 12;
    const inBody = this.design.objects.filter((o) => o.kind !== 'popover' && (!body || (o.bounds.top >= body.top && o.bounds.top < body.top + body.height)));
    const top = inBody.length ? Math.max(...inBody.map((o) => o.bounds.bottom)) + 8 : top0;
    if (body && top + height > body.top + body.height) {
      const grow = top + height + 12 - (body.top + body.height);
      const end = body.top + body.height;
      body.height += grow;
      for (const p of this.design.parts) if (p.top > body.top) p.top += grow;
      for (const o of this.design.objects) if (o.bounds.top >= end) shift(o, 0, grow);
    }
    return { top: this.snap(top, false), left: 20 };
  }

  /**
   * Where a new object goes: into the open popover (below what's in it, the
   * popover growing to fit), or below everything in the body.
   */
  private place(height: number, kind: string): { top: number; left: number; right?: number; list: LayoutObject[] } {
    const pop = this.find(this.openPopover);
    if (!pop || kind === 'popover' || kind === 'popover-button') return { ...this.slot(height), list: this.design.objects };
    const kids = (pop.children ??= []);
    const top = this.snap(kids.length ? Math.max(...kids.map((k) => k.bounds.bottom)) + 8 : pop.bounds.top + 12, false);
    if (top + height + 12 > pop.bounds.bottom) pop.bounds = { ...pop.bounds, bottom: top + height + 12 };
    return { top, left: pop.bounds.left + 12, right: pop.bounds.right - 12, list: kids };
  }

  private add(o: Omit<LayoutObject, 'id' | 'anchors' | 'bounds'> & { width: number; height: number; left?: number }, above = 0): void {
    this.change(() => {
      const at = this.place(o.height + above, o.kind);
      at.top += above;
      const left = o.left ?? at.left;
      const { width, height, left: _l, ...rest } = o;
      const right = at.right !== undefined ? Math.min(left + width, at.right) : left + width;
      const obj: LayoutObject = { id: this.nextId(), anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: at.top, left, bottom: at.top + height, right }, ...rest };
      at.list.push(obj);
      this.selected = new Set([obj.id]);
    });
  }

  private addField(toId: number, fieldId: number, withLabel: boolean, display = 'edit', drop?: { x: number; y: number }): void {
    const to = this.studio.design.tableOccurrences.find((t) => t.id === toId);
    const table = this.studio.design.tables.find((t) => t.id === to?.baseTableId);
    const f = table?.fields.find((x) => x.id === fieldId);
    if (!to || !f) return;
    // With a portal (or something in one) selected, the field goes into the portal's first row.
    const sel = this.objects();
    const portal = sel.length === 1 ? (sel[0].kind === 'portal' ? sel[0] : this.portalAround(sel[0])) : undefined;
    if (portal) return this.addToPortal(portal, to, f, withLabel);
    this.change(() => {
      const at = this.place(22, 'field');
      // In a popover the label sits above the field; on the layout, to its left.
      const stacked = at.right !== undefined;
      const fieldTop = withLabel && stacked ? at.top + 20 : at.top;
      if (stacked && withLabel) this.find(this.openPopover)!.bounds.bottom += 20;
      if (withLabel) {
        at.list.push({ id: this.nextId(), kind: 'text', type: 2, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: at.top + 2, left: at.left, bottom: at.top + 20, right: stacked ? at.right! : at.left + 130 }, style: newStyle('text', this.themed), text: f.name });
      }
      const id = this.nextId();
      const left = withLabel && !stacked ? at.left + 140 : at.left;
      at.list.push({
        id, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false },
        bounds: { top: fieldTop, left, bottom: fieldTop + 22, right: stacked ? at.right! : left + 260 }, style: newStyle('field', this.themed),
        field: { tableOccurrenceId: to.id, fieldId: f.id, tableOccurrence: to.name, field: f.name, display: display as never, repetitions: 1 },
      });
      this.selected = new Set([id]);
      // Dropped from the Fields pane: the field's top left where it was let go, its label beside it.
      if (drop && !stacked) {
        const made = at.list.slice(withLabel ? -2 : -1);
        const dx = Math.round(drop.x - left), dy = Math.round(drop.y - fieldTop);
        for (const m of made) shift(m, Math.max(-m.bounds.left, dx), Math.max(-m.bounds.top, dy));
      }
    });
  }

  /** Field Picker: several fields of one occurrence at once, stacked down or across, labels to the left, on top or none. */
  private fieldPicker(): void {
    const d = this.studio.design;
    const tos = d.tableOccurrences.filter((t) => !t.dataSourceId && d.tables.some((x) => x.id === t.baseTableId))
      .sort((a, b) => (a.id === this.design.tableOccurrenceId ? -1 : b.id === this.design.tableOccurrenceId ? 1 : a.name.localeCompare(b.name)));
    const occ = select(tos.map((t) => [String(t.id), t.name] as [string, string]), String(tos[0]?.id ?? ''), { 'aria-label': 'Fields from' });
    const filter = h('input', { type: 'search', placeholder: 'Filter fields', 'aria-label': 'Filter fields' }) as HTMLInputElement;
    const list = h('div', { class: 'le-picker-list' });
    const order: number[] = [];
    const fill = () => {
      const t = d.tables.find((x) => x.id === tos.find((o) => String(o.id) === occ.value)?.baseTableId);
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren(...(t?.fields ?? []).filter((f) => !q || f.name.toLowerCase().includes(q)).map((f) => {
        const c = check(f.name, order.includes(f.id));
        c.input.dataset.id = String(f.id);
        // Fields go on the layout in the order they're ticked, as FileMaker's picker does.
        c.input.addEventListener('change', () => {
          const at = order.indexOf(f.id);
          if (c.input.checked && at < 0) order.push(f.id);
          else if (!c.input.checked && at >= 0) order.splice(at, 1);
        });
        return c.el;
      }));
    };
    occ.addEventListener('change', () => {
      order.length = 0;
      fill();
    });
    filter.addEventListener('input', fill);
    const across = select([['down', 'Vertical'], ['across', 'Horizontal']], 'down', { 'aria-label': 'Field placement' });
    const labels = select([['left', 'Labels to the left'], ['top', 'Labels on top'], ['none', 'No labels']], 'left', { 'aria-label': 'Labels' });
    const dialog = h('dialog', { class: 'd-dialog le-picker', 'aria-labelledby': 'le-picker-title' });
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    const add = button('Add fields', () => {
      if (!order.length) return toast('Tick the fields to add');
      this.addFields(Number(occ.value), [...order], across.value === 'across', labels.value as 'left' | 'top' | 'none');
      close();
    }, { class: 'primary' });
    dialog.append(h('h3', { id: 'le-picker-title' }, 'Field Picker'), h('div', { class: 'd-row' }, field('Fields from', occ), filter), list,
      h('div', { class: 'd-row' }, field('Placement', across), field('Labels', labels)),
      h('div', { class: 'd-actions' }, add, button('Cancel', close)));
    fill();
    document.body.append(dialog);
    dialog.showModal();
  }

  /** Puts fields on the layout as a block: one per row (vertical) or per column (horizontal), with their labels. */
  private addFields(toId: number, ids: number[], across: boolean, labels: 'left' | 'top' | 'none'): void {
    const to = this.studio.design.tableOccurrences.find((t) => t.id === toId);
    const table = this.studio.design.tables.find((t) => t.id === to?.baseTableId);
    const fields = ids.map((id) => table?.fields.find((f) => f.id === id)).filter((f) => !!f);
    if (!to || !fields.length) return;
    const H = 22, LABEL = labels === 'top' ? 18 : 0, ROW = H + LABEL + 8;
    const labelW = labels === 'left' ? 130 : 0, fieldW = across ? 150 : 260, COL = across ? Math.max(fieldW, labelW + fieldW) + 12 : 0;
    this.change(() => {
      const at = this.place(across ? H + LABEL : fields.length * ROW - 8, 'field');
      const made: number[] = [];
      fields.forEach((f, i) => {
        const top = at.top + (across ? 0 : i * ROW);
        let left = at.left + (across ? i * COL : 0);
        const anchors = { left: true, top: true, right: false, bottom: false };
        if (labels !== 'none') {
          const lb = labels === 'top' ? { top, left, bottom: top + LABEL, right: left + fieldW } : { top: top + 2, left, bottom: top + H, right: left + labelW - 10 };
          at.list.push({ id: this.nextId(), kind: 'text', type: 2, anchors, bounds: lb, style: newStyle('text', this.themed), text: f!.name });
        }
        if (labels === 'left') left += labelW;
        const fieldTop = top + LABEL;
        const id = this.nextId();
        const right = at.right !== undefined ? Math.min(left + fieldW, at.right) : left + fieldW;
        at.list.push({
          id, kind: 'field', type: 1, anchors, bounds: { top: fieldTop, left, bottom: fieldTop + H, right }, style: newStyle('field', this.themed),
          field: { tableOccurrenceId: to.id, fieldId: f!.id, tableOccurrence: to.name, field: f!.name, display: 'edit', repetitions: 1 },
        });
        made.push(id);
      });
      this.selected = new Set(made);
    });
  }

  private portalAround(o: LayoutObject): LayoutObject | undefined {
    let found: LayoutObject | undefined;
    walk(this.design.objects, (x) => {
      if (x.kind === 'portal' && x.children?.includes(o)) found = x;
    });
    return found;
  }

  /** A field in a portal's first row, after the fields already there, with its label above the portal. */
  private addToPortal(portal: LayoutObject, to: { id: number; name: string }, f: { id: number; name: string }, withLabel: boolean): void {
    this.change(() => {
      const kids = (portal.children ??= []);
      const row = portalRowHeight(portal);
      const left = kids.length ? Math.max(...kids.map((k) => k.bounds.right)) + 4 : portal.bounds.left + 4;
      const height = Math.min(22, row - 4);
      const top = portal.bounds.top + 1 + Math.max(2, Math.floor((row - height) / 2));
      const width = Math.max(40, Math.min(140, portal.bounds.right - 4 - left));
      const id = this.nextId();
      kids.push({
        id, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false },
        bounds: { top, left, bottom: top + height, right: left + width }, style: newStyle('field', this.themed),
        field: { tableOccurrenceId: to.id, fieldId: f.id, tableOccurrence: to.name, field: f.name, display: 'edit', repetitions: 1 },
      });
      if (withLabel && portal.bounds.top >= 20) {
        this.design.objects.push({ id: id + 1, kind: 'text', type: 2, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: portal.bounds.top - 20, left, bottom: portal.bounds.top - 2, right: left + width }, style: newStyle('text', this.themed), text: f.name });
      }
      this.selected = new Set([id]);
    });
  }

  /** A portal showing records related to the layout's occurrence (the first one related to it). */
  private addPortal(): void {
    const d = this.studio.design;
    const own = this.design.tableOccurrenceId;
    const related = d.relationships.flatMap((r) => (r.leftTableOccurrenceId === own ? [r.rightTableOccurrenceId] : r.rightTableOccurrenceId === own ? [r.leftTableOccurrenceId] : []));
    const to = d.tableOccurrences.find((t) => t.id === related[0]) ?? d.tableOccurrences.find((t) => t.id !== own && !t.dataSourceId) ?? d.tableOccurrences[0];
    if (!to) return toast('Add a table occurrence first.');
    this.add({ kind: 'portal', type: 9, style: newStyle('portal', this.themed), portal: { tableOccurrenceId: to.id, tableOccurrence: to.name, rows: 4, initialRow: 1 }, children: [], width: 360, height: 4 * 26 + 2 }, 24); // room above for its field labels
  }

  private addTabControl(): void {
    this.add({ kind: 'tab-control', type: 11, style: newStyle('tab-control', this.themed), children: [], width: 420, height: 220 });
    this.change(() => {
      const control = this.objects()[0];
      for (const text of ['Tab 1', 'Tab 2']) this.addTab(control, text);
      control.target = control.children![0].id;
    });
    this.undo.splice(-1, 1);
  }


  private addSlideControl(): void {
    this.add({ kind: 'slide-control', type: 16, style: newStyle('slide-control', this.themed), children: [], width: 420, height: 220 });
    this.change(() => {
      const control = this.objects()[0];
      for (const text of ['Slide 1', 'Slide 2', 'Slide 3']) this.addTab(control, text);
      control.target = control.children![0].id;
    });
    this.undo.splice(-1, 1);
  }

  private addTab(control: LayoutObject, text: string): LayoutObject {
    const panel: LayoutObject = { id: this.nextId(), kind: control.kind === 'slide-control' ? 'slide-panel' : 'tab-panel', type: control.kind === 'slide-control' ? 17 : 12, anchors: { ...control.anchors }, bounds: { ...control.bounds }, style: newStyle('tab-panel', this.themed), text, tab: { left: 0, width: 0 }, children: [] };
    (control.children ??= []).push(panel);
    return panel;
  }

  private segment(bar: LayoutObject, text: string): LayoutObject {
    return { id: this.nextId(), kind: 'button', type: 10, anchors: { ...bar.anchors }, bounds: { ...bar.bounds }, style: newStyle('segment', this.themed), text };
  }

  private addButtonBar(): void {
    this.add({ kind: 'button-bar', type: 18, style: newStyle('button-bar', this.themed), children: [], width: 300, height: 28 });
    this.change(() => {
      const bar = this.objects()[0];
      for (const text of ['One', 'Two', 'Three']) bar.children!.push(this.segment(bar, text));
      fitSegments(bar);
    });
    this.undo.splice(-1, 1);
  }

  /** A popover button, with its popover just below it, open for editing. */
  private addPopover(): void {
    this.add({ kind: 'popover-button', type: 14, style: newStyle('popover-button', this.themed), text: 'More', width: 80, height: 26 });
    this.change(() => {
      const btn = this.objects()[0];
      const b = btn.bounds;
      const pop: LayoutObject = { id: this.nextId(), kind: 'popover', type: 15, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: b.bottom + 8, left: b.left, bottom: b.bottom + 168, right: b.left + 260 }, style: newStyle('popover', this.themed), children: [] };
      this.design.objects.push(pop);
      btn.target = pop.id;
    });
    this.undo.splice(-1, 1);
  }

  // ---------------------------------------------------------------- toolbar

  private toolbar(): HTMLElement {
    const d = this.studio.design;
    // Window-width preview, which FileMaker doesn't have: the responsive layout at phone, tablet or desktop width.
    const widths = select([['0', 'Edit'], ['390', 'Phone · 390'], ['768', 'Tablet · 768'], ['1280', 'Desktop · 1280']], '0', { 'aria-label': 'Preview at window width', title: 'See the layout as the web client shows it in a window this wide (Layout Setup\'s stacking and each object\'s hiding)', class: 'le-widths le-keep' });
    widths.addEventListener('change', () => {
      this.previewWidth = Number(widths.value);
      if (this.previewWidth) this.selected.clear();
      this.draw();
      if (!this.previewWidth) this.drawInspector();
    });
    const phone = button('Phone', () => {
      this.showPhone = !this.showPhone;
      phone.classList.toggle('on', this.showPhone);
      phone.setAttribute('aria-pressed', String(this.showPhone));
      this.queuePhone();
    }, { title: 'Show a phone version beside this layout as you edit it', class: 'le-keep', 'aria-pressed': 'false' });
    const zoom = select([['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%'], ['2', '200%']], '1', { 'aria-label': 'Zoom', class: 'le-keep' });
    zoom.addEventListener('change', () => {
      this.zoom = Number(zoom.value);
      this.draw();
    });
    // Grid: spacing in points, snapping (Alt moves freely either way) and showing it.
    const gridSize = select(['2', '4', '6', '8', '10', '12', '16', '20', '24'], String(this.grid.size), { 'aria-label': 'Grid spacing', title: 'Grid spacing (points)', class: 'le-gridsize' });
    gridSize.addEventListener('change', () => {
      this.grid.size = Number(gridSize.value);
      this.draw();
    });
    const snapTo = check('Snap', this.grid.snap);
    snapTo.el.title = 'Snap to the grid while dragging (hold Alt to move freely)';
    snapTo.input.addEventListener('change', () => (this.grid.snap = snapTo.input.checked));
    const showGrid = check('Grid', this.grid.show);
    showGrid.input.addEventListener('change', () => {
      this.grid.show = showGrid.input.checked;
      this.draw();
    });
    const viewShow = h('details', { class: 'le-view-show' }, h('summary', {}, 'View'), h('strong', {}, 'Show'));
    const viewToggles: [keyof LayoutViewOptions, string][] = [
      ['pageMargins', 'Page Margins'], ['textBoundaries', 'Text Boundaries'], ['fieldBoundaries', 'Field Boundaries'],
      ['buttonOutlines', 'Button Outlines'], ['slidingObjects', 'Sliding Objects'], ['hideCondition', 'Hide Condition'],
    ];
    for (const [key, label] of viewToggles) {
      const toggle = check(label, this.viewOptions[key]);
      toggle.input.addEventListener('change', () => {
        this.viewOptions = { ...this.viewOptions, [key]: toggle.input.checked };
        saveLayoutViewOptions(`tabularius.layout-view.${this.studio.client.db}`, this.viewOptions);
        this.draw();
      });
      viewShow.append(toggle.el);
    }
    // FileMaker's layout bar: the panes either side, the layout and what it's based on, Layout Setup, Exit Layout.
    const leftPane = button('Fields', () => this.toggleLeft(), { class: 'le-keep le-pane-toggle', title: 'Show or hide the Fields and Objects pane (⌘K)', 'aria-pressed': String(this.showObjects) });
    const rightPane = button('Inspector', () => this.toggleInspector(), { class: 'le-keep le-pane-toggle', title: 'Show or hide the Inspector (⌘I)', 'aria-pressed': String(this.showInspector) });
    const layouts = select(d.layouts.map((l) => [String(l.id), l.name] as [string, string]), String(this.design.id), { 'aria-label': 'Layout', class: 'le-keep le-layout-pick' });
    layouts.addEventListener('change', () => {
      const id = Number(layouts.value);
      if (this.dirty && !confirm('Go to another layout without saving your changes to this one?')) {
        layouts.value = String(this.design.id);
        return;
      }
      this.studio.together?.at(0, []);
      this.studio.selected.layout = id;
      this.studio.selected.editLayout = id;
      this.studio.render();
    });
    const occ = d.tableOccurrences.find((t) => t.id === this.design.tableOccurrenceId);
    const theme = d.themes.find((t) => t.id === this.design.themeId);
    const setup = button('Layout Setup…', () => {
      this.selected.clear();
      if (!this.showInspector) this.toggleInspector();
      this.draw();
      this.inspector.scrollTop = 0;
    }, { class: 'le-keep', title: 'The layout\'s name, width, theme, views, menu set, parts and script triggers, in the Inspector' });
    // A modern layout (one web viewer showing a page written here): its page is a click away.
    const modern = modernPage(this.design.objects);
    const layoutBar = h('div', { class: 'le-layoutbar' },
      leftPane,
      h('span', { class: 'le-bar-item' }, h('span', { class: 'd-label' }, 'Layout:'), layouts),
      h('span', { class: 'le-bar-item' }, h('span', { class: 'd-label' }, 'Table:'), h('strong', {}, occ?.name ?? '?')),
      h('span', { class: 'le-bar-item' }, h('span', { class: 'd-label' }, 'Theme:'), h('strong', {}, theme?.name ?? 'None')),
      setup,
      ...(modern ? [button('Edit page…', () => this.editPage(modern.viewer.id), { class: 'le-keep', title: 'This layout is a page in HTML, CSS and JavaScript' })] : []),
      h('span', { class: 'd-spacer' }),
      this.status,
      button('Save', () => void this.save(), { class: 'primary le-keep', title: 'Save the layout (⌘S)' }),
      // In Layout mode (from a browse window) leaving goes back to the records, as FileMaker's Exit Layout does.
      this.studio.layoutMode
        ? button('Exit Layout', () => this.studio.layoutMode!.exit('browse'), { class: 'le-keep', title: 'Back to Browse mode on the same record (⌘B)' })
        : button('‹ Layouts', () => {
          if (!this.dirty || confirm('Leave without saving your changes?')) this.close();
        }, { class: 'le-keep' }),
      rightPane,
    );
    // FileMaker's layout tools, in its order (each puts its object where there's room; drag it from there).
    const fieldControl = select([['', 'Field/Control…'], ['edit', 'Edit Box'], ['dropdown', 'Drop-down List'], ['popup', 'Pop-up Menu'], ['checkbox', 'Checkbox Set'], ['radio', 'Radio Button Set'], ['calendar', 'Drop-down Calendar']], '', { 'aria-label': 'Field/Control tool', title: 'Field/Control tool: a field shown as an edit box, list, menu, checkboxes, radio buttons or calendar' });
    fieldControl.addEventListener('change', () => {
      const display = fieldControl.value;
      fieldControl.value = '';
      if (display) this.addFirstField(display);
    });
    const shape = (kind: string, text: string, title: string) => button(text, () => {
      const type = { rectangle: 5, 'rounded-rectangle': 6, oval: 7, line: 4 }[kind]!;
      this.add({ kind, type, style: newStyle(kind, this.themed), width: kind === 'line' ? 200 : kind === 'oval' ? 80 : 200, height: kind === 'line' ? 1 : kind === 'oval' ? 80 : 60 });
    }, { title });
    const tools = h('div', { class: 'le-tools', role: 'toolbar', 'aria-label': 'Layout tools' },
      button('Text', () => this.add({ kind: 'text', type: 2, style: newStyle('text', this.themed), text: 'Text', width: 120, height: 20 }), { title: 'Text tool: a text object (merge fields as <<Table::Field>>)' }),
      shape('line', 'Line', 'Line tool'), shape('rectangle', 'Rectangle', 'Rectangle tool'), shape('rounded-rectangle', 'Rounded Rectangle', 'Rounded Rectangle tool'), shape('oval', 'Oval', 'Oval tool'),
      button('Field', () => this.addFirstField('edit'), { title: 'Field tool: a field with its label (or drag one from the Fields pane)' }),
      fieldControl,
      button('Button', () => this.add({ kind: 'button', type: 10, style: newStyle('button', this.themed), text: 'Button', width: 100, height: 26 }), { title: 'Button tool' }),
      button('Popover Button', () => this.addPopover(), { title: 'Popover Button tool: a button that opens a popover' }),
      button('Button Bar', () => this.addButtonBar(), { title: 'Button Bar tool' }),
      button('Tab Control', () => this.addTabControl(), { title: 'Tab Control tool' }),
      button('Slide Control', () => this.addSlideControl(), { title: 'Slide Control tool: panels people swipe or click the dots to move between' }),
      button('Portal', () => this.addPortal(), { title: 'Portal tool: related records in rows' }),
      button('Chart', () => this.addChart(), { title: 'Chart tool: a chart of the found set, the current record or related records' }),
      button('Web Viewer', () => this.add({ kind: 'web-viewer', type: 13, style: newStyle('web-viewer', this.themed), webUrl: '"https://"', webOptions: { ...WEB_VIEWER_DEFAULTS }, width: 320, height: 220 }), { title: 'Web Viewer tool: a web page from an address formula' }),
      button('Picture', () => this.pickImage((img) => this.add({ kind: 'graphic', type: 3, style: newStyle('graphic', this.themed), imageId: img.id, width: img.width, height: img.height })), { title: 'Insert › Picture: from the file\'s image library, or one you upload' }),
    );
    // What FileMaker's Layout mode keeps in menus (Arrange, View) and what Tabularius adds beyond it.
    const more = h('div', { class: 'le-more' },
      this.componentMenu(),
      ...this.changeWithAI(),
      h('span', { class: 'd-spacer' }),
      button('Tab order', () => (this.tabDraft ? this.endTabOrder(true) : this.startTabOrder()), { title: 'Layouts › Set Tab Order: the order Tab moves through fields and buttons' }),
      viewShow,
      h('span', { class: 'd-row' }, showGrid.el, snapTo.el, gridSize),
      button('↶', () => this.restore(this.undo, this.redo), { title: 'Undo (⌘Z)', 'aria-label': 'Undo' }),
      button('↷', () => this.restore(this.redo, this.undo), { title: 'Redo (⇧⌘Z)', 'aria-label': 'Redo' }),
      widths, phone,
      this.historyMenu(),
      button('Versions', () => void this.versions(), { title: 'Earlier saves of this layout: what changed, and open one again', class: 'le-keep' }),
      button('Check', () => void this.check(), { title: 'Check the layout for missing fields, overlapping objects, buttons that do nothing, hard-to-read text and more', class: 'le-keep' }),
      zoom,
    );
    this.paneToggles = { left: leftPane, right: rightPane };
    return h('div', { class: 'le-toolbar' }, layoutBar, tools, more);
  }

  /** The pane toggle buttons, kept pressed while their pane shows. */
  private paneToggles?: { left: HTMLElement; right: HTMLElement };

  /** Shows or hides the left pane (Fields and Objects), as FileMaker's ⌘K. */
  private toggleLeft(): void {
    this.showObjects = !this.showObjects;
    this.paneToggles?.left.setAttribute('aria-pressed', String(this.showObjects));
    this.drawObjects();
  }

  /** Shows or hides the Inspector, as FileMaker's ⌘I. */
  private toggleInspector(): void {
    this.showInspector = !this.showInspector;
    this.paneToggles?.right.setAttribute('aria-pressed', String(this.showInspector));
    this.inspector.hidden = !this.showInspector;
    this.el?.querySelector('.le-body')?.classList.toggle('le-no-inspector', !this.showInspector);
  }

  /** The Field and Field/Control tools: the layout's first field, shown as asked, selected so the Data tab can point it at another. */
  private addFirstField(display: string): void {
    const d = this.studio.design;
    const to = d.tableOccurrences.find((t) => t.id === this.design.tableOccurrenceId);
    const f = d.tables.find((t) => !to?.dataSourceId && t.id === to?.baseTableId)?.fields[0];
    if (!to || !f) return toast('This layout\'s table has no fields yet');
    this.addField(to.id, f.id, true, display);
    this.inspectorTab = 'data';
    this.drawInspector();
  }

  /**
   * "Change with AI": what to change on this layout, in words. The assistant reads the saved layout and
   * proposes an updateLayout in its panel; applying it reopens the layout as changed. Unsaved edits are
   * saved first, so the proposal starts from what is on screen.
   */
  private changeWithAI(): HTMLElement[] {
    if (!this.studio.ask) return [];
    const want = h('input', { class: 'd-ai-want le-ai-want', placeholder: 'Change with AI…', 'aria-label': 'What to change with AI' }) as HTMLInputElement;
    const go = async () => {
      const what = want.value.trim();
      if (!what) return want.focus();
      if (this.dirty) await this.save();
      if (this.dirty) return; // the save failed; its error is shown
      const picked = this.objects().slice(0, 8).map(label);
      this.studio.ask!(`Change the layout "${this.name}": ${what}.` +
        (picked.length ? ` Selected on it: ${picked.join('; ')}.` : '') +
        ' Read it with get_layout_design, change only what is asked, keep the theme\'s styles, and propose it as an updateLayout' +
        ' (or, to make it look like another layout, switch its theme or apply the theme consistently, use propose_restyle).');
    };
    want.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void go();
      }
    });
    return [want, button('Change with AI', () => void go(), { title: 'The assistant proposes the change in its panel; nothing changes until you apply it' })];
  }

  /** Saves the layout together with theme changes (a style made from an object), then redraws with the theme as saved. */
  private async saveWith(changes: Change[], done: string): Promise<void> {
    const had = this.clashes.length;
    if (!(await this.catchUp())) return;
    if (this.clashes.length > had) return;
    const submitted = structuredClone(this.design);
    try {
      const r = await this.studio.client.change([...changes, { op: 'updateLayout', layout: submitted.id, design: submitted, expectedDesign: JSON.parse(this.saved) }]);
      this.studio.design = r.design;
      const accepted = [...r.applied].reverse().find((c) => c.op === 'updateLayout' && c.layout === submitted.id && (c.design as LayoutDesign | undefined)?.objects);
      const savedDesign = structuredClone((accepted?.design as LayoutDesign | undefined) ?? submitted);
      const acknowledged = acknowledgeLayoutSave(this.design, submitted, savedDesign);
      this.design = acknowledged.design;
      if (acknowledged.design === savedDesign) this.takeSteps(r.applied);
      if (savedDesign.themeId !== undefined) this.meta.theme = await this.studio.client.theme(savedDesign.themeId);
      this.saved = acknowledged.saved;
      this.draw();
      toast(done, 'info');
    } catch (e) {
      toast(errorText(e));
    }
  }

  /** Single-step buttons as the server read them (their step's options and line), from the saved change. */
  private takeSteps(applied: Change[]): void {
    const saved = applied.find((c) => c.op === 'updateLayout' && (c.design as LayoutDesign | undefined)?.objects) as { design: LayoutDesign } | undefined;
    if (!saved) return;
    const actions = new Map<number, LayoutObject['action']>();
    const collect = (objs: LayoutObject[]) => objs.forEach((o) => { if (o.action) actions.set(o.id, o.action); if (o.children) collect(o.children); });
    collect(saved.design.objects);
    const apply = (objs: LayoutObject[]) => objs.forEach((o) => { if (o.action?.text !== undefined && actions.has(o.id)) o.action = actions.get(o.id); if (o.children) apply(o.children); });
    apply(this.design.objects);
  }

  private async save(): Promise<void> {
    if (!this.dirty) return;
    // Someone else may have saved this layout since it was opened here: bring that in first rather than overwrite it.
    const had = this.clashes.length;
    if (!(await this.catchUp())) return;
    // You both changed more of the same things: look at them before saving over theirs (saving again keeps yours).
    if (this.clashes.length > had) return;
    const submitted = structuredClone(this.design);
    try {
      const r = await this.studio.client.change([{ op: 'updateLayout', layout: submitted.id, design: submitted, expectedDesign: JSON.parse(this.saved) }]);
      this.studio.design = r.design;
      const accepted = [...r.applied].reverse().find((c) => c.op === 'updateLayout' && c.layout === submitted.id && (c.design as LayoutDesign | undefined)?.objects);
      const savedDesign = structuredClone((accepted?.design as LayoutDesign | undefined) ?? submitted);
      // The file stops marking a layout as generated once it is saved; left on here, the next Save
      // reads the difference as someone else's save and merges with it.
      delete (savedDesign as { generated?: boolean }).generated;
      const acknowledged = acknowledgeLayoutSave(this.design, submitted, savedDesign);
      this.design = acknowledged.design;
      if (acknowledged.design === savedDesign) this.takeSteps(r.applied);
      this.saved = acknowledged.saved;
      this.clashes = [];
      this.draw();
      toast('Layout saved', 'info');
    } catch (e) {
      toast(errorText(e));
    }
  }

  /**
   * Brings in what someone else saved of this layout since it was opened or last
   * saved here: shown as is when nothing here is unsaved, else merged with the
   * unsaved edits (merge.ts). False when the layout is gone.
   */
  private async catchUp(account?: string): Promise<boolean> {
    let theirs: LayoutDesign;
    try {
      theirs = await this.studio.client.layout(this.design.id);
    } catch {
      toast(`${account ?? 'Someone'} deleted this layout, so it can't be saved. Copy what you need from it before leaving.`);
      return false;
    }
    if (JSON.stringify(theirs) === this.saved) return true;
    const who = account ?? 'Someone';
    const base = JSON.parse(this.saved) as LayoutDesign;
    if (!this.dirty) {
      this.design = theirs;
      this.clashes = [];
      toast(`${who} saved this layout: you're seeing their changes`, 'info');
    } else {
      const { design, clashes } = mergeDesign(base, this.design, theirs);
      this.design = design;
      // Clashes from an earlier merge stay listed until picked, unless this one settles the same thing again.
      const again = new Set(clashes.map((c) => `${c.what}:${c.id}`));
      this.clashes = [...this.clashes.filter((c) => !again.has(`${c.what}:${c.id}`)), ...clashes];
      this.clashWho = who;
      toast(clashes.length
        ? `${who} saved this layout too. Their changes are merged with yours; pick yours or theirs where you both changed the same thing (${clashes.length}).`
        : `${who} saved this layout too. Their changes are merged with your unsaved ones.`, 'info');
    }
    this.saved = JSON.stringify(theirs);
    // Undo would step back past their changes and undo them on the next save.
    this.undo = [];
    this.redo = [];
    if (theirs.themeId !== undefined && theirs.themeId !== base.themeId) this.meta.theme = await this.studio.client.theme(theirs.themeId).catch(() => this.meta.theme);
    for (const id of [...this.selected]) if (!this.find(id)) this.selected.delete(id);
    this.draw();
    return true;
  }

  /**
   * What you and someone else both changed, after their save was merged with
   * your unsaved edits: outlined on the layout and listed above it, each with
   * yours (kept so far) or theirs to pick, one undoable step at a time.
   */
  private drawClashes(): void {
    this.clashNote.hidden = !this.clashes.length;
    if (!this.clashes.length) return this.clashNote.replaceChildren();
    for (const c of this.clashes) if (c.what === 'object') this.overlay.querySelector(`.le-obj[data-id="${c.id}"]`)?.classList.add('le-clash');
    const settle = (list: Clash[], side: 'mine' | 'theirs') => this.change(() => {
      for (const c of list) this.design = settleClash(this.design, c, side);
      this.clashes = this.clashes.filter((c) => !list.includes(c));
      for (const id of [...this.selected]) if (!this.find(id)) this.selected.delete(id);
    });
    const name = (c: Clash) => {
      if (c.what === 'setting') return SETTING_NAMES[c.id as string] ?? String(c.id);
      if (c.what === 'order') return 'Object stacking order';
      const o = (c.mine ?? c.theirs) as LayoutObject;
      const how = c.mine === undefined ? ' (you deleted it, they changed it)' : c.theirs === undefined ? ' (they deleted it, you changed it)' : '';
      return label(o) + how;
    };
    const n = this.clashes.length;
    this.clashNote.replaceChildren(
      h('strong', {}, `You and ${this.clashWho} both changed ${n === 1 ? 'one thing' : `${n} things`}.`),
      h('span', {}, ' Yours are kept unless you take theirs. Save again when you are done.'),
      h('ul', { class: 'le-clash-list' }, ...this.clashes.map((c) => h('li', {},
        c.what === 'object' && this.find(c.id as number)
          ? button(name(c), () => { this.selected = new Set([c.id as number]); this.draw(); }, { class: 'link', title: 'Select it' })
          : h('span', {}, name(c)),
        button(c.kept === 'theirs' ? 'Delete it' : 'Keep mine', () => settle([c], 'mine')),
        button('Take theirs', () => settle([c], 'theirs')),
      ))),
      ...(n > 1 ? [button('Keep all mine', () => settle([...this.clashes], 'mine')), button('Take all theirs', () => settle([...this.clashes], 'theirs'))] : []),
    );
  }

  /** Other people's selections on this layout, outlined in their colour with their name. */
  private drawPeers(): void {
    for (const el of this.overlay.querySelectorAll('.le-peer')) el.remove();
    if (this.previewWidth || !this.studio.together) return;
    for (const d of this.studio.together.others.values()) {
      if (d.layout !== this.design.id) continue; // on another layout, or a script or table
      let first = true;
      for (const id of d.selection) {
        const b = this.find(id)?.bounds;
        if (!b) continue;
        this.overlay.append(h('div', {
          class: 'le-peer', style: `--peer:${personColor(d.account)};left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px`,
          title: `${d.account} has this selected`,
        }, first ? h('span', {}, d.account) : ''));
        first = false;
      }
    }
  }

  // ---------------------------------------------------------------- inspector

  /** The Inspector's four tabs, as FileMaker's; the tab picked stays picked as the selection changes. */
  private tabbed(title: string, tabs: Record<'position' | 'styles' | 'appearance' | 'data', HTMLElement[]>): HTMLElement[] {
    const names = { position: 'Position', styles: 'Styles', appearance: 'Appearance', data: 'Data' } as const;
    const ids = (Object.keys(names) as (keyof typeof names)[]).filter((k) => tabs[k].length);
    if (!ids.includes(this.inspectorTab)) this.inspectorTab = ids[0] ?? 'position';
    const strip = h('div', { class: 'le-inspector-tabs', role: 'tablist', 'aria-label': 'Inspector' },
      ...ids.map((id) => button(names[id], () => {
        this.inspectorTab = id;
        this.drawInspector();
      }, { role: 'tab', 'aria-selected': String(this.inspectorTab === id) })));
    return [h('h3', {}, title), strip, h('div', { class: 'le-inspector-tab', role: 'tabpanel', 'aria-label': names[this.inspectorTab] }, ...tabs[this.inspectorTab])];
  }

  private drawInspector(): void {
    // A box being typed in sends its change on blur: let that happen before its node goes, not during the swap.
    const typing = document.activeElement;
    if (typing instanceof HTMLElement && this.inspector.contains(typing)) typing.blur();
    const sel = this.objects();
    if (this.tabDraft) this.inspector.replaceChildren(...this.tabInspector());
    else if (sel.length === 1) this.inspector.replaceChildren(...this.objectInspector(sel[0]));
    else if (sel.length > 1) this.inspector.replaceChildren(...this.multiInspector(sel));
    else this.inspector.replaceChildren(...this.layoutInspector());
    const extra = this.componentPanel(sel);
    if (this.editingComponent) this.inspector.prepend(...extra);
    else this.inspector.append(...extra);
  }

  // ---------------------------------------------------------------- components

  private component(id: number | undefined): DesignComponent | undefined {
    return id === undefined ? undefined : this.studio.design.components?.find((c) => c.id === id);
  }

  /**
   * Layout components (not in FileMaker): save objects as one, see and detach a
   * placed copy, or edit the component from a copy so every copy changes.
   */
  private componentPanel(sel: LayoutObject[]): HTMLElement[] {
    const editing = this.editingComponent;
    if (editing) {
      return [h('div', { class: 'le-component-edit' },
        h('h3', {}, `Editing component "${editing.name}"`),
        h('p', { class: 'd-muted' }, `Change its objects here, select everything that belongs to it, then save. Every layout with "${editing.name}" on it changes.`),
        h('div', { class: 'd-actions' },
          button('Save component', () => void this.saveComponent(), { class: 'primary' }),
          button('Cancel', () => this.cancelComponent())))];
    }
    const top = sel.filter((o) => this.design.objects.includes(o));
    if (sel.length === 1 && sel[0].component) {
      const c = this.component(sel[0].component.id);
      const others = (c?.layouts ?? []).filter((id) => id !== this.design.id).length;
      return [h('h3', {}, 'Component'),
        h('p', { class: 'd-muted' }, c
          ? `A copy of "${c.name}"${others ? `, also on ${others} other layout${others === 1 ? '' : 's'}` : ''}. It follows the component: edit the component to change every copy, or detach this one to change it on its own.`
          : 'A copy of a component that isn\'t saved yet: save the layout first.'),
        h('div', { class: 'd-actions' },
          ...(c ? [button('Edit component', () => this.editComponent(sel[0], c), { title: 'Change it here; saving changes every copy' })] : []),
          button('Detach', () => this.change(() => delete sel[0].component), { title: 'Keep this copy as a plain group that no longer follows the component' })),
        ...(c ? this.libraryPanel(c) : [])];
    }
    if (top.length && top.length === sel.length && !hasCopy(sel)) {
      return [h('div', { class: 'd-actions' }, button('Save as component…', () => void this.saveAsComponent(top), { title: 'Save these objects once and place them on other layouts; editing the component later changes every copy' }))];
    }
    return [];
  }

  /** The objects become a component, and its first copy takes their place here. */
  private async saveAsComponent(sel: LayoutObject[]): Promise<void> {
    const name = prompt('Name the component (for example "Header" or "Address block")')?.trim();
    if (!name) return;
    const had = this.clashes.length;
    if (!(await this.catchUp()) || this.clashes.length > had) return;
    await this.saveComponentChange([{ op: 'createComponent', name, layout: this.design.id, objectIds: sel.map((o) => o.id) }], `Saved "${name}" as a component`, true);
  }

  /** Ungroups the copy so its objects can be changed; Save component sends them back. */
  private editComponent(copy: LayoutObject, c: DesignComponent): void {
    this.editingComponent = { id: c.id, name: c.name, before: JSON.stringify(this.design) };
    this.change(() => {
      const list = this.listOf(copy.id)!;
      list.splice(list.indexOf(copy), 1, ...(copy.children ?? []));
      this.selected = new Set((copy.children ?? []).map((o) => o.id));
    });
  }

  private cancelComponent(): void {
    const editing = this.editingComponent;
    if (!editing) return;
    this.editingComponent = undefined;
    this.change(() => Object.assign(this.design, JSON.parse(editing.before)));
  }

  private async saveComponent(): Promise<void> {
    const editing = this.editingComponent;
    if (!editing) return;
    const had = this.clashes.length;
    if (!(await this.catchUp()) || this.clashes.length > had) return;
    const sel = this.objects();
    if (!sel.length) return toast('Select the objects that make up the component');
    // They go back into one copy in the list they're in: the layout, or the group, panel or popover the copy was in.
    const list = this.listOf(sel[0].id)!;
    if (sel.some((o) => !list.includes(o))) return toast('Select objects side by side, all in the same place (not some inside a group)');
    if (hasCopy(sel)) return toast('A component can\'t hold a copy of a component');
    // Kept as it was, so a save that fails leaves the component being edited.
    const before = JSON.stringify(this.design);
    const box = union(sel);
    const copy: LayoutObject = { id: this.nextId(), kind: 'group', type: 8, anchors: { left: true, top: true, right: false, bottom: false }, bounds: box, style: {}, component: { id: editing.id }, children: sel };
    const at = Math.min(...sel.map((o) => list.indexOf(o)));
    const rest = list.filter((o) => !sel.includes(o));
    rest.splice(at, 0, copy);
    list.splice(0, list.length, ...rest);
    const objects = structuredClone(sel);
    walk(objects, (o) => (o.bounds = { top: o.bounds.top - box.top, left: o.bounds.left - box.left, bottom: o.bounds.bottom - box.top, right: o.bounds.right - box.left }));
    this.editingComponent = undefined;
    if (await this.saveComponentChange([{ op: 'updateComponent', component: editing.id, objects }], `Saved "${editing.name}" everywhere it's placed`, false)) return;
    this.editingComponent = editing;
    Object.assign(this.design, JSON.parse(before));
    this.selected = new Set(sel.map((o) => o.id));
    this.draw();
  }

  /** Saves the layout with a component change, then takes the layout as the server left it. */
  private async saveComponentChange(changes: Change[], done: string, layoutFirst: boolean): Promise<boolean> {
    const had = this.clashes.length;
    if (!(await this.catchUp())) return false;
    if (this.clashes.length > had) return false;
    const submitted = structuredClone(this.design);
    const mine: Change = { op: 'updateLayout', layout: submitted.id, design: submitted, expectedDesign: JSON.parse(this.saved) };
    try {
      const r = await this.studio.client.change(layoutFirst ? [mine, ...changes] : [...changes, mine]);
      this.studio.design = r.design;
      const last = [...r.applied].reverse().find((c) => c.op === 'updateLayout' && c.layout === this.design.id && (c.design as LayoutDesign | undefined)?.objects);
      const savedDesign = structuredClone((last?.design as LayoutDesign | undefined) ?? submitted);
      const acknowledged = acknowledgeLayoutSave(this.design, submitted, savedDesign);
      this.design = acknowledged.design;
      if (acknowledged.design === savedDesign) this.takeSteps(r.applied);
      this.saved = acknowledged.saved;
      this.selected = new Set();
      this.refreshComponents?.();
      this.draw();
      toast(done, 'info');
      return true;
    } catch (e) {
      toast(errorText(e));
      return false;
    }
  }

  /** Brings the component picker up to date with the file's components. */
  private refreshComponents?: () => void;

  // ------------------------------------------------- the component library

  /** A component's place in the server's library (not in FileMaker): share it with every file here, take newer versions, update other files. */
  private libraryPanel(c: DesignComponent): HTMLElement[] {
    const linked = c.library;
    return [h('h4', {}, 'Library'),
      h('p', { class: 'd-muted' }, linked
        ? `In the component library, shared with every file on this server (this file has version ${linked.version}).`
        : 'Save it to the component library to place it in other files on this server too.'),
      h('div', { class: 'd-actions' },
        button('Save to library', () => void this.saveToLibrary(c), { title: linked ? 'Save this file\'s component as the library\'s next version' : 'Share it with the designers of every file on this server' }),
        ...(linked ? [
          button('Newer version?', () => void this.takeNewer(linked.id, c.name), { title: 'See whether the library has a newer version, and what it would change here' }),
          button('Update other files…', () => void this.updateOtherFiles(linked.id, c.name), { title: 'Bring the files that use it up to the latest version, one at a time, with a preview of each' }),
        ] : []))];
  }

  private async saveToLibrary(c: DesignComponent): Promise<void> {
    if (this.dirty) return toast('Save the layout first');
    if (!c.library && !confirm(`Share "${c.name}" with the designers of every file on this server? They can place it in their files; its fields, scripts and value lists are matched there by name.`)) return;
    try {
      const r = await this.studio.client.saveToLibrary(c.id);
      this.studio.design = r.design;
      this.refreshComponents?.();
      this.draw();
      toast(r.entry.version === 1 ? `"${c.name}" is in the library` : `Saved "${c.name}" to the library as version ${r.entry.version}: files that use it are offered the update`, 'info');
    } catch (e) {
      toast(errorText(e));
    }
  }

  /** What a library version would change in a file: what it leaves out, and each layout before and after. */
  private libraryChanges(p: LibraryPreview, note?: string): HTMLElement[] {
    return [
      ...(p.missing.length ? [h('p', {}, 'Not in this file, so left as missing (as FileMaker shows a deleted field or script):'), h('ul', { class: 'le-library-missing' }, ...p.missing.map((m) => h('li', {}, m)))] : []),
      ...(note ? [h('p', { class: 'd-muted' }, note)] : []),
      ...(p.layouts.length ? p.layouts.flatMap((l) => [h('h4', {}, l.name), this.beforeAfter(l.before, l.after)]) : [h('p', { class: 'd-muted' }, 'It isn\'t placed on any layout there yet.')]),
    ];
  }

  /** A dialog with a body and buttons; `closed` runs however it closes (Escape too). */
  private libraryDialog(title: string, body: HTMLElement[], actions: (close: () => void) => HTMLElement[], closed?: () => void): HTMLDialogElement {
    const dialog = h('dialog', { class: 'd-dialog le-library', 'aria-label': title });
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    if (closed) dialog.addEventListener('close', closed);
    dialog.append(h('h3', {}, title), h('div', { class: 'le-library-body' }, ...body), h('div', { class: 'd-actions' }, ...actions(close)));
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
  }

  /** The library's latest version of a component this file has a copy of: previewed, then taken on request. */
  private async takeNewer(id: string, name: string): Promise<void> {
    if (this.dirty) return toast('Save the layout first');
    let p: LibraryPreview;
    try {
      p = await this.studio.client.previewFromLibrary(id);
    } catch (e) {
      return toast(errorText(e));
    }
    if (p.current !== undefined && p.version <= p.current) return toast(`This file has the library's latest version of "${name}"`, 'info');
    this.libraryDialog(`Take version ${p.version} of "${name}"`, this.libraryChanges(p), (close) => [
      button('Take it', async () => {
        try {
          const r = await this.studio.client.takeFromLibrary(id);
          this.studio.design = r.design;
          this.design = await this.studio.client.layout(this.design.id);
          this.saved = JSON.stringify(this.design);
          // Undo would step back past the update and undo it on the next save.
          this.undo = [];
          this.redo = [];
          this.selected.clear();
          this.refreshComponents?.();
          close();
          this.draw();
          toast(`This file now has version ${p.version} of "${name}"`, 'info');
        } catch (e) {
          toast(errorText(e));
        }
      }, { class: 'primary' }),
      button('Cancel', close),
    ]);
  }

  /**
   * Update all uses: each other file that has placed the component, brought up
   * to the latest version on its own, after signing in to it (each file has
   * its own accounts) and seeing what it changes there.
   */
  private async updateOtherFiles(id: string, name: string): Promise<void> {
    let entry;
    try {
      entry = (await this.studio.client.library()).find((e) => e.id === id);
    } catch (e) {
      return toast(errorText(e));
    }
    if (!entry) return toast(`"${name}" is no longer in the library`);
    const others = entry.uses.filter((db) => db !== this.studio.client.db);
    // Sessions signed in to other files from here: each signs out when its file is done, and the rest when the dialog closes.
    const signedIn = new Set<Api>();
    const rows = others.map((db) => {
      const row = h('li', {}, h('strong', {}, db));
      const account = h('input', { autocomplete: 'username', 'aria-label': `Account in ${db}` });
      const password = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': `Password in ${db}` });
      const out = h('div', { class: 'le-library-file' });
      const signIn = h('form', { class: 'le-library-signin' }, field('Account', account), field('Password', password), h('button', { type: 'submit' }, 'Sign in and preview'));
      signIn.addEventListener('submit', async (e) => {
        e.preventDefault();
        let api: Api;
        try {
          api = await Api.login(db, account.value, password.value);
        } catch (err) {
          out.replaceChildren(h('p', { class: 'd-error', role: 'alert' }, errorText(err)));
          return;
        }
        password.value = '';
        signIn.hidden = true;
        signedIn.add(api);
        const there = new DesignClient(db, api.token);
        const done = (text: string) => {
          signedIn.delete(api);
          void api.logout();
          signIn.hidden = true;
          out.replaceChildren(h('p', {}, text));
        };
        try {
          const p = await there.previewFromLibrary(id);
          if (p.current !== undefined && p.version <= p.current) return done('Already has the latest version.');
          out.replaceChildren(...this.libraryChanges(p, `Drawn with this file's theme; ${db} may look different.`), h('div', { class: 'd-actions' },
            button(`Update ${db}`, async () => {
              try {
                await there.takeFromLibrary(id);
                done(`Updated to version ${p.version}.`);
              } catch (err) {
                out.append(h('p', { class: 'd-error', role: 'alert' }, errorText(err)));
              }
            }, { class: 'primary' }),
            button('Skip', () => done('Skipped.'))));
        } catch (err) {
          done(errorText(err));
        }
      });
      row.append(signIn, out);
      return row;
    });
    this.libraryDialog(`Update other files to version ${entry.version} of "${name}"`, others.length
      ? [h('p', { class: 'd-muted' }, 'Each file has its own accounts: sign in to one with an account that has full access there to see what changes, then update it.'), h('ul', { class: 'le-library-files' }, ...rows)]
      : [h('p', { class: 'd-muted' }, 'No other file has placed it yet.')], (close) => [button('Done', close)], () => {
      for (const api of signedIn) void api.logout();
      signedIn.clear();
    });
  }

  /** Insert › Component › From the library: place a component another file shared here. */
  private async fromLibrary(): Promise<void> {
    let list;
    try {
      list = await this.studio.client.library();
    } catch (e) {
      return toast(errorText(e));
    }
    const place = async (id: string, close: () => void) => {
      const entry = list.find((e) => e.id === id)!;
      let local = entry.here ? this.component(entry.here.component) : undefined;
      if (!local) {
        try {
          const p = await this.studio.client.previewFromLibrary(id);
          if (p.missing.length && !confirm(`These aren't in this file and will show as missing:\n\n${p.missing.join('\n')}\n\nPlace "${entry.name}" anyway?`)) return;
          const r = await this.studio.client.takeFromLibrary(id);
          this.studio.design = r.design;
          this.refreshComponents?.();
          local = this.studio.design.components?.find((c) => c.library?.id === id);
        } catch (e) {
          return toast(errorText(e));
        }
      }
      close();
      if (local) this.placeCopy(local);
      if (entry.here && entry.here.version < entry.version) toast(`This file has version ${entry.here.version}; the library has ${entry.version}. Select the copy and use Newer version? to see what changed.`, 'info');
    };
    const remove = async (id: string, li: HTMLElement) => {
      if (!confirm('Take it out of the library? Files keep their own copies.')) return;
      try {
        await this.studio.client.removeFromLibrary(id);
        li.remove();
      } catch (e) {
        toast(errorText(e));
      }
    };
    this.libraryDialog('Component library', list.length ? [
      h('p', { class: 'd-muted' }, 'Components saved by the files on this server. Placing one finds its fields, scripts and value lists in this file by name.'),
      h('ul', { class: 'le-library-list' }, ...list.map((e) => {
        const li = h('li', {});
        li.append(
          h('div', {}, h('strong', {}, e.name), h('span', { class: 'd-muted' }, ` version ${e.version}, from ${e.from}${e.here ? ', in this file' : ''}`)),
          h('div', { class: 'd-actions' },
            button('Place', () => void place(e.id, () => {
              const dialog = li.closest('dialog');
              dialog?.close();
              dialog?.remove();
            })),
            ...(e.owner === this.studio.client.db ? [button('Take out', () => void remove(e.id, li))] : [])),
        );
        return li;
      })),
    ] : [h('p', { class: 'd-muted' }, 'Nothing in the library yet. Select a placed component and use Save to library to share it with the other files on this server.')],
    (close) => [button('Close', close)]);
  }

  /** A copy of a component placed where new objects go, selected. */
  private placeCopy(c: DesignComponent): void {
    this.change(() => {
      const at = this.place(c.height, 'group');
      const copyId = this.nextId();
      let id = copyId;
      const children = structuredClone(c.objects);
      walk(children, (o) => {
        o.id = ++id;
        o.bounds = { top: o.bounds.top + at.top, left: o.bounds.left + at.left, bottom: o.bounds.bottom + at.top, right: o.bounds.right + at.left };
      });
      const copy: LayoutObject = { id: copyId, kind: 'group', type: 8, anchors: { left: true, top: true, right: false, bottom: false },
        bounds: { top: at.top, left: at.left, bottom: at.top + c.height, right: at.left + c.width }, style: {}, component: { id: c.id }, children };
      at.list.push(copy);
      this.selected = new Set([copy.id]);
    });
  }

  /** Insert › a component: a copy placed where new objects go. */
  private componentMenu(): HTMLElement {
    const pick = select([], '', { 'aria-label': 'Place a component' });
    // Filled again whenever components change here, and when opened (someone else may have saved one).
    const fill = () => {
      const list = this.studio.design.components ?? [];
      pick.replaceChildren(...[['', 'Component…'], ...list.map((c): [string, string] => [String(c.id), c.name]), ['library', 'From the library…']].map(([v, l]) => h('option', { value: v }, l)));
      pick.value = '';
      pick.title = list.length ? 'Place a copy of a saved component, or one from the library other files share' : 'No components here yet: select objects and use Save as component, or place one from the library';
    };
    fill();
    this.refreshComponents = fill;
    pick.addEventListener('focus', fill);
    pick.addEventListener('change', () => {
      const value = pick.value;
      pick.value = '';
      if (value === 'library') return void this.fromLibrary();
      const c = this.component(Number(value));
      if (c) this.placeCopy(c);
    });
    return pick;
  }

  /** An input that applies on change (one undo step per edit). */
  private bind<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(el: T, apply: (value: string) => void): T {
    el.addEventListener('change', () => this.change(() => apply(el.value)));
    return el;
  }

  private objectInspector(o: LayoutObject): HTMLElement[] {
    const d = this.studio.design;
    const b = o.bounds;
    const num = (v: number, apply: (n: number) => void) => this.bind(h('input', { type: 'number', value: String(Math.round(v)), class: 'd-narrow', disabled: this.locked(o) ? '' : false, title: this.locked(o) ? 'Locked' : false }), (s) => apply(Number(s) || 0));
    const resize = (to: LayoutObject['bounds']) => {
      if (o.kind === 'group') scaleGroup(o, structuredClone(o), to);
      o.bounds = to;
      fitPanels(o);
      fitSegments(o);
    };
    // FileMaker's Inspector tabs: Position, Styles, Appearance and Data.
    const pos: HTMLElement[] = [], dat: HTMLElement[] = [];
    pos.push(field('Name', this.bind(h('input', { value: o.name ?? '' }), (v) => (v ? (o.name = v) : delete o.name)), 'Object name, for Go to Object and scripts'));
    pos.push(field('Tooltip (formula)', this.bind(h('input', { value: o.tooltip ?? '', class: 'd-code' }), (v) => (v ? (o.tooltip = v) : delete o.tooltip))));
    pos.push(h('h4', {}, 'Position'));
    pos.push(h('div', { class: 'le-grid' },
      field('Left', num(b.left, (n) => shift(o, n - b.left, 0))),
      field('Top', num(b.top, (n) => shift(o, 0, n - b.top))),
      field('Width', num(b.right - b.left, (n) => resize({ ...o.bounds, right: o.bounds.left + Math.max(2, n) }))),
      field('Height', num(b.bottom - b.top, (n) => resize({ ...o.bounds, bottom: o.bounds.top + Math.max(2, n) }))),
    ));
    if (ROTATABLE.has(o.kind)) {
      pos.push(field('Rotation', this.bind(select(['0', '90', '180', '270'].map((v): [string, string] => [v, `${v}°`]), String(o.rotation ?? 0)), (v) => (Number(v) ? (o.rotation = Number(v) as 90 | 180 | 270) : delete o.rotation)),
        'Turned clockwise; the Left, Top, Width and Height above are the box it fills once turned'));
    }
    const anchors = h('div', { class: 'd-row' }, h('span', { class: 'd-label' }, 'Anchors'));
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      const c = check(side, o.anchors[side]);
      c.input.addEventListener('change', () => this.change(() => (o.anchors = { ...o.anchors, [side]: c.input.checked })));
      anchors.append(c.el);
    }
    pos.push(h('h4', {}, 'Autosizing'), anchors);
    // Sliding & Visibility (Preview mode and printing) and the padlock.
    const flag = (text: string, on: boolean, set: (v: boolean) => void, title?: string) => {
      const c = check(text, on);
      if (title) c.el.title = title;
      c.input.addEventListener('change', () => this.change(() => set(c.input.checked)));
      return c.el;
    };
    const slide = (key: 'up' | 'left' | 'resizePart') => (v: boolean) => {
      const next = { ...o.sliding, [key]: v || undefined };
      if (!next.up && !next.left) delete next.resizePart;
      if (Object.values(next).some(Boolean)) o.sliding = JSON.parse(JSON.stringify(next));
      else delete o.sliding;
    };
    pos.push(h('h4', {}, 'Sliding & Visibility'));
    pos.push(h('div', { class: 'd-row' }, h('span', { class: 'd-label' }, 'Sliding'),
      flag('up', !!o.sliding?.up, slide('up'), 'Slide up over empty space above it in Preview mode and when printed'),
      flag('left', !!o.sliding?.left, slide('left'), 'Slide left over empty space'),
      ...(o.sliding?.up || o.sliding?.left ? [flag('shrink part', !!o.sliding?.resizePart, slide('resizePart'), 'Also reduce the size of the enclosing part')] : [])));
    pos.push(h('div', { class: 'd-row' },
      flag('Hide when printing', !!o.hideWhenPrinting, (v) => (v ? (o.hideWhenPrinting = true) : delete o.hideWhenPrinting), 'Hidden in Preview mode and when printed'),
      flag('Locked', !!o.locked, (v) => (v ? (o.locked = true) : delete o.locked), 'Can\'t be moved, resized or deleted until unlocked (⌘L, ⌥⌘L)')));
    pos.push(field('Hide object when (formula)', this.bind(h('input', { value: o.hide?.formula ?? '', class: 'd-code' }), (v) => (v ? (o.hide = { formula: v, inFind: o.hide?.inFind ?? false }) : delete o.hide))));
    if (o.hide) pos.push(flag('Apply in Find mode', o.hide.inFind, (v) => (o.hide = { ...o.hide!, inFind: v }), 'Hide it in Find mode too when the formula is true'));
    pos.push(field('Hide in windows narrower than', this.bind(h('input', { type: 'number', min: '0', placeholder: 'Always show', value: o.responsive?.hideBelow ? String(o.responsive.hideBelow) : '', class: 'd-narrow' }),
      (v) => (Number(v) > 0 ? (o.responsive = { hideBelow: Math.round(Number(v)) }) : delete o.responsive)), 'Points; Tabularius only, e.g. 600 to hide it on phones'));

    if (o.kind === 'text' || o.kind === 'button' || o.kind === 'popover-button') {
      dat.push(field(o.kind === 'text' ? 'Text' : 'Label', this.bind(h('textarea', { rows: '3' }, o.text ?? ''), (v) => (o.text = v)), o.kind === 'text' ? 'Merge fields: <<Table::Field>>' : undefined));
    }
    if (o.field) {
      const f = o.field;
      const pick = h('select');
      for (const to of d.tableOccurrences) {
        const t = d.tables.find((x) => !to.dataSourceId && x.id === to.baseTableId);
        if (!t) continue;
        const g = h('optgroup', { label: to.name });
        for (const x of t.fields) g.append(h('option', { value: `${to.id}:${x.id}` }, x.name));
        pick.append(g);
      }
      pick.value = `${f.tableOccurrenceId}:${f.fieldId}`;
      dat.push(field('Field', this.bind(pick, (v) => {
        const [toId, fid] = v.split(':').map(Number);
        const to = d.tableOccurrences.find((t) => t.id === toId)!;
        const fd = d.tables.find((t) => t.id === to.baseTableId)?.fields.find((x) => x.id === fid);
        o.field = { ...f, tableOccurrenceId: toId, fieldId: fid, tableOccurrence: to.name, field: fd?.name };
      })));
      dat.push(field('Control', this.bind(select(DISPLAYS, f.display), (v) => (o.field = { ...o.field!, display: v as never }))));
      const lists = select([['', 'None'], ...d.valueLists.map((v) => [String(v.id), v.name] as [string, string])], String(f.valueListId ?? ''));
      dat.push(field('Value list', this.bind(lists, (v) => {
        const vl = d.valueLists.find((x) => x.id === Number(v));
        o.field = { ...o.field!, valueListId: vl?.id, valueList: vl?.name };
        if (vl?.values) this.meta.valueLists[String(vl.id)] = vl.values;
      })));
      dat.push(field('Placeholder (formula)', this.bind(h('input', { value: o.placeholder ?? '', class: 'd-code' }), (v) => (v ? (o.placeholder = v) : delete o.placeholder))));
      dat.push(...this.dataInspector(o));
    }
    if (o.portal) dat.push(...this.portalInspector(o));
    if (o.kind === 'button-bar') dat.push(...this.barInspector(o));
    if (o.kind === 'popover-button' || o.kind === 'popover') {
      // Popover Setup: the title bar and its title (on the popover).
      const pop = o.kind === 'popover' ? o : o.children?.find((c) => c.kind === 'popover');
      if (pop) {
        const bar = check('Show title bar', !!pop.titleBar);
        bar.input.addEventListener('change', () => this.change(() => (bar.input.checked ? (pop.titleBar = true) : delete pop.titleBar)));
        dat.push(bar.el);
        if (pop.titleBar) dat.push(field('Title', this.bind(h('input', { value: pop.text ?? '' }), (v) => (pop.text = v))));
      }
      dat.push(h('p', { class: 'd-muted' }, 'The popover shows while its button or anything in it is selected. Drag objects onto it to put them in it.'));
    }
    if (o.kind === 'slide-control') {
      const dots = check('Show navigation dots', !o.noDots);
      dots.input.addEventListener('change', () => this.change(() => (dots.input.checked ? delete o.noDots : (o.noDots = true))));
      const swipe = check('Enable swipe gestures', !o.noSwipe);
      swipe.input.addEventListener('change', () => this.change(() => (swipe.input.checked ? delete o.noSwipe : (o.noSwipe = true))));
      dat.push(h('div', { class: 'd-row' }, dots.el, swipe.el));
    }
    if (o.kind === 'web-viewer') {
      dat.push(field('Web address (formula)', this.bind(h('textarea', { rows: '2', class: 'd-code', spellcheck: 'false' }, o.webUrl ?? ''), (v) => (v ? (o.webUrl = v) : delete o.webUrl)),
        'Worked out for each record, e.g. "https://maps.example.com/?q=" & Customers::City. The page loads in the person\'s browser.'));
      // Web Viewer Setup's options; files without them read as FileMaker's defaults.
      const wo = o.webOptions ?? { ...WEB_VIEWER_DEFAULTS };
      const opt = (label: string, key: keyof typeof wo, title?: string) => flag(label, wo[key], (v) => (o.webOptions = { ...wo, [key]: v }), title);
      dat.push(h('div', { class: 'd-stack' },
        opt('Allow interaction with web viewer content', 'interaction'),
        opt('Allow JavaScript to perform FileMaker scripts', 'jsBridge', 'FileMaker.PerformScript() in the page reaches the file'),
        opt('Display content in Find mode', 'findMode'),
        opt('Display progress bar', 'progressBar'),
        opt('Display status messages', 'statusMessages'),
        opt('Automatically encode URL', 'encodeUrl', 'Turn off for data: addresses that carry HTML')));
      // A page written here (HTML, CSS, JavaScript), kept in the address formula, so FileMaker Pro shows it too.
      const page = pageSource(o.webUrl);
      if (page !== undefined || !o.webUrl) {
        dat.push(button(page !== undefined ? 'Edit page…' : 'Write a page…', () => this.editPage(o.id), { title: 'The web viewer shows a page you write in HTML, CSS and JavaScript' }));
      }
    }
    if (isPanels(o)) dat.push(...this.panelsInspector(o));
    if (o.kind === 'button') {
      // Button Setup: Perform Script, or one other step written as a script line.
      const act = o.action;
      const mode = !act ? '' : act.stepId === 1 ? 'script' : 'step';
      const modes = select([['', 'Do nothing'], ['script', 'Perform script'], ['step', 'Single step']], mode, { 'aria-label': 'Button action' });
      dat.push(field('Action', this.bind(modes, (v) => {
        if (!v) delete o.action;
        else if (v === 'script') o.action = { stepId: 1, step: 'Perform Script' };
        else o.action = { stepId: 0, step: 'Beep', text: 'Beep' };
      })));
      if (mode === 'script') {
        const scripts = select([['', 'Pick a script'], ...d.scripts.map((s) => [String(s.id), s.name] as [string, string])], String(act?.scriptId ?? ''));
        dat.push(field('Perform script', this.bind(scripts, (v) => {
          const s = d.scripts.find((x) => x.id === Number(v));
          o.action = { stepId: 1, step: 'Perform Script', ...(s ? { scriptId: s.id, script: s.name } : {}), ...(o.action?.parameter ? { parameter: o.action.parameter } : {}) };
        })));
        dat.push(field('Script parameter (formula)', this.bind(h('input', { value: act?.parameter ?? '', class: 'd-code' }), (v) => {
          if (o.action) o.action = { ...o.action, parameter: v || undefined };
        })));
      } else if (mode === 'step') {
        const line = h('input', { value: act?.text ?? act?.line ?? act?.step ?? '', class: 'd-code', spellcheck: 'false', 'aria-label': 'Step' });
        dat.push(field('Step', this.bind(line, (v) => (o.action = { stepId: act?.stepId ?? 0, step: act?.step ?? '', text: v })),
          'As a script line, e.g. Set Field [ Invoices::Status ; "Paid" ], Go to Object [ Object Name: "notes" ], Go to Layout [ "Home" ]. Read when the layout is saved.'));
      }
    }
    if (o.kind === 'button' || o.kind === 'popover-button') dat.push(...this.iconInspector(o));
    if (o.kind === 'chart' && o.chart) dat.push(...this.chartInspector(o.chart));
    if (o.kind === 'graphic') dat.push(button('Replace picture', () => this.pickImage((img) => this.change(() => (o.imageId = img.id)))));
    const app = [...this.appearanceInspector(o), ...this.conditionsInspector(o)];
    if (o.kind === 'field') dat.push(...this.triggersInspector(o, OBJECT_EVENTS));
    if (o.kind === 'tab-control' || o.kind === 'slide-control') dat.push(...this.triggersInspector(o, PANEL_EVENTS));
    if (['button', 'popover-button', 'popover', 'portal', 'web-viewer'].includes(o.kind)) dat.push(...this.triggersInspector(o, OTHER_EVENTS));
    pos.push(h('h4', {}, 'Arrange & Align'), h('div', { class: 'd-actions' },
      button('Duplicate', () => this.duplicate()),
      button('Copy for FileMaker', () => this.copyObjects(), { title: 'Copy as FileMaker Layout mode XML (Cmd/Ctrl+C)' }),
      ...(o.kind === 'group' ? [button('Ungroup', () => this.ungroup(), { title: '⇧⌘R' })] : []),
    ), h('div', { class: 'd-actions' },
      button('Bring to front', () => this.toEnd([o], true), { title: '⇧⌘]' }),
      button('Forward', () => this.step([o], 1), { title: 'Bring forward one step (⌘])' }),
      button('Backward', () => this.step([o], -1), { title: 'Send backward one step (⌘[)' }),
      button('Send to back', () => this.toEnd([o], false), { title: '⇧⌘[' }),
      button('Delete', () => (this.locked(o) ? toast('Unlock it to delete it') : this.change(() => this.remove(new Set([o.id])))), { class: 'danger' }),
    ));
    return this.tabbed(label(o), { position: pos, styles: this.stylesInspector(o), appearance: app, data: dat });
  }

  /** The Data inspector's control options, behavior and data formatting for a field object. */
  private dataInspector(o: LayoutObject): HTMLElement[] {
    const f = o.field!;
    const d = this.studio.design;
    const to = d.tableOccurrences.find((t) => t.id === f.tableOccurrenceId);
    const type = d.tables.find((t) => !to?.dataSourceId && t.id === to?.baseTableId)?.fields.find((x) => x.id === f.fieldId)?.type;
    const behavior = (key: keyof NonNullable<typeof f.behavior>, value: unknown) => {
      const next: Record<string, unknown> = { ...o.field!.behavior, [key]: value };
      for (const [k, v] of Object.entries(next)) if (v === undefined || v === false) delete next[k];
      o.field = { ...o.field!, behavior: Object.keys(next).length ? next as never : undefined };
      if (!o.field.behavior) delete o.field.behavior;
    };
    const flag = (text: string, on: boolean, set: (v: boolean) => void, title?: string) => {
      const c = check(text, on);
      if (title) c.el.title = title;
      c.input.addEventListener('change', () => this.change(() => set(c.input.checked)));
      return c.el;
    };
    const b = f.behavior ?? {};
    const out: HTMLElement[] = [h('h3', {}, 'Data')];
    // Control options for the control style.
    if (f.display === 'calendar') out.push(flag('Include icon to show and hide the calendar', !!b.calendarIcon, (v) => behavior('calendarIcon', v || undefined)));
    if (f.display === 'dropdown') out.push(flag('Include arrow to show and hide list', !!b.calendarIcon, (v) => behavior('calendarIcon', v || undefined)));
    if (f.display === 'edit') {
      out.push(flag('Concealed edit box', !!b.concealed, (v) => behavior('concealed', v || undefined), 'Shows dots instead of the data. The data is not encrypted, only hidden'));
      out.push(flag('Show vertical scroll bar', !!b.scrollBar, (v) => behavior('scrollBar', v || undefined)));
    }
    if (f.display === 'edit' || f.display === 'dropdown') out.push(flag('Auto-complete using previously entered values', !!b.autoComplete, (v) => behavior('autoComplete', v || undefined)));
    if (f.display === 'checkbox' || f.display === 'radio') out.push(flag('Include "Other…" item to allow entry of other values', !!b.otherValue, (v) => behavior('otherValue', v || undefined)));
    out.push(field('Repetitions shown', this.bind(h('input', { type: 'number', min: '1', value: String(f.repetitions || 1), class: 'd-narrow' }), (v) => (o.field = { ...o.field!, repetitions: Math.max(1, Number(v) || 1) }))));
    // Behavior: field entry per mode, and how people move through fields.
    const ENTRY: [string, string][] = [['', 'Edit'], ['view', 'View only'], ['select', 'Select only'], ...(b.browse === 'calculation' || b.find === 'calculation' ? [['calculation', 'Set by calculation (kept)'] as [string, string]] : [])];
    out.push(h('div', { class: 'le-grid' },
      field('Browse mode entry', this.bind(select(ENTRY, b.browse ?? '', { 'aria-label': 'Browse mode entry' }), (v) => behavior('browse', v || undefined))),
      field('Find mode entry', this.bind(select(ENTRY, b.find ?? '', { 'aria-label': 'Find mode entry' }), (v) => behavior('find', v || undefined)))));
    out.push(flag('Select entire contents on entry', !!b.selectOnEntry, (v) => behavior('selectOnEntry', v || undefined)));
    out.push(h('div', { class: 'd-row' }, h('span', { class: 'd-hint' }, 'Go to next object using'),
      flag('Tab', !b.noTab, (v) => behavior('noTab', v ? undefined : true), 'Unchecked: Tab types a tab character in the field'),
      flag('Return', !!b.returnKey, (v) => behavior('returnKey', v || undefined)),
      flag('Enter', !!b.enterKey, (v) => behavior('enterKey', v || undefined), 'The keypad Enter key')));
    out.push(flag('Include field for Quick Find', !b.quickFindOff, (v) => behavior('quickFindOff', v ? undefined : true)));
    out.push(...this.formatInspector(o, type));
    return out;
  }

  /** Data formatting for number, date, time and timestamp fields. */
  private formatInspector(o: LayoutObject, type: string | undefined): HTMLElement[] {
    const fmt = o.field!.format ?? {};
    const setFormat = (key: 'number' | 'date' | 'time' | 'container', value: unknown) => {
      const next: Record<string, unknown> = { ...o.field!.format, [key]: value };
      if (value === undefined) delete next[key];
      if (Object.keys(next).length) o.field = { ...o.field!, format: next as never };
      else {
        o.field = { ...o.field! };
        delete o.field.format;
      }
    };
    const out: HTMLElement[] = [];
    if (type === 'container') {
      const pict = select([['', 'Reduce image to fit'], ['crop', 'Crop to frame'], ['enlarge', 'Enlarge image to fit'], ['fit', 'Reduce or enlarge image to fit']], fmt.container ?? '', { 'aria-label': 'Container format' });
      out.push(field('Container format', this.bind(pict, (v) => setFormat('container', v || undefined)), 'How a picture fits the field. Alignment follows the text alignment in Appearance'));
    }
    if (type === 'number') {
      const n = fmt.number;
      const kind = !n ? '' : n.boolean ? 'boolean' : n.notation === '%' ? 'percent' : n.notation ? 'currency' : 'decimal';
      const kinds = select([['', 'As entered'], ['decimal', 'Decimal'], ['currency', 'Currency'], ['percent', 'Percentage'], ['boolean', 'Boolean']], kind, { 'aria-label': 'Number format' });
      out.push(field('Number format', this.bind(kinds, (v) => {
        const base = { decimalPoint: n?.decimalPoint ?? '.', ...(n?.decimals !== undefined ? { decimals: n.decimals } : { decimals: 2 }), ...(n?.thousands ? { thousands: n.thousands } : {}) };
        if (!v) setFormat('number', undefined);
        else if (v === 'boolean') setFormat('number', { decimalPoint: '.', boolean: n?.boolean ?? { true: 'Yes', false: 'No' } });
        else if (v === 'percent') setFormat('number', { ...base, notation: '%' });
        else if (v === 'currency') setFormat('number', { ...base, notation: n?.notation && n.notation !== '%' ? n.notation : '$', leading: n?.notation && n.notation !== '%' ? n.leading : true });
        else setFormat('number', base);
      })));
      if (n && !n.boolean) {
        const set = (patch: Record<string, unknown>) => {
          const next: Record<string, unknown> = { ...o.field!.format!.number, ...patch };
          for (const [k, v] of Object.entries(next)) if (v === undefined || v === false || v === '') delete next[k];
          next.decimalPoint ??= '.';
          setFormat('number', next);
        };
        out.push(h('div', { class: 'le-grid' },
          field('Decimal digits', this.bind(h('input', { type: 'number', min: '0', max: '20', value: n.decimals === undefined ? '' : String(n.decimals), class: 'd-narrow', placeholder: 'any' }), (v) => set({ decimals: v === '' ? undefined : Math.max(0, Math.min(20, Number(v) || 0)) }))),
          ...(kind === 'currency' ? [field('Symbol', this.bind(h('input', { value: n.notation ?? '$', class: 'd-narrow' }), (v) => set({ notation: v || '$' })))] : []),
        ));
        const c = check('Use thousands separator', !!n.thousands);
        c.input.addEventListener('change', () => this.change(() => set({ thousands: c.input.checked ? ',' : undefined })));
        out.push(c.el);
        if (kind === 'currency') {
          const lead = check('Symbol before the number', !!n.leading);
          lead.input.addEventListener('change', () => this.change(() => set({ leading: lead.input.checked || undefined })));
          out.push(lead.el);
        }
        out.push(field('Negative numbers', this.bind(select([['0', '-12'], ['1', '12-'], ['2', '(12)'], ['3', '<12>'], ['4', '12 CR'], ['5', '▲12']], String(n.negativeStyle ?? 0)), (v) => set({ negativeStyle: Number(v) || undefined }))));
        const red = check('Show negatives in red', !!n.negativeColor);
        red.input.addEventListener('change', () => this.change(() => set({ negativeColor: red.input.checked ? 'rgb(191 26 47)' : undefined })));
        const zero = check('Blank when zero', !!n.blankIfZero);
        zero.input.addEventListener('change', () => this.change(() => set({ blankIfZero: zero.input.checked || undefined })));
        out.push(h('div', { class: 'd-row' }, red.el, zero.el));
      } else if (n?.boolean) {
        const bool = n.boolean;
        out.push(h('div', { class: 'le-grid' },
          field('Non-zero shows', this.bind(h('input', { value: bool.true }), (v) => setFormat('number', { ...n, boolean: { ...bool, true: v } }))),
          field('Zero shows', this.bind(h('input', { value: bool.false }), (v) => setFormat('number', { ...n, boolean: { ...bool, false: v } })))));
      }
    }
    if (type === 'date' || type === 'timestamp') {
      const dt = fmt.date;
      const styles: [string, string][] = [['', 'As entered'], ['2', '12/25/2014'], ['3', 'Dec 25, 2014'], ['4', 'December 25, 2014'], ['5', 'Thu, Dec 25, 2014'], ['6', 'Thursday, December 25, 2014'], ...(dt?.style === 1 ? [['1', 'Custom (kept)'] as [string, string]] : []), ...(dt?.style === 7 ? [['7', 'Long numeric (kept)'] as [string, string]] : [])];
      out.push(field('Date format', this.bind(select(styles, dt ? String(dt.style) : ''), (v) => setFormat('date', v ? { style: Number(v), monthPad: dt?.monthPad ?? '', dayPad: dt?.dayPad ?? '', separator: dt?.separator ?? '/' } : undefined))));
      if (dt && (dt.style === 2 || dt.style === 7)) {
        const pad = check('Leading zeros for month and day', dt.monthPad === '0');
        pad.input.addEventListener('change', () => this.change(() => setFormat('date', { ...dt, monthPad: pad.input.checked ? '0' : '', dayPad: pad.input.checked ? '0' : '' })));
        out.push(h('div', { class: 'd-row' }, field('Separator', this.bind(h('input', { value: dt.separator, class: 'd-narrow', maxlength: '2' }), (v) => setFormat('date', { ...dt, separator: v || '/' }))), pad.el));
      }
    }
    if (type === 'time' || type === 'timestamp') {
      const t = fmt.time;
      const shape = !t ? '' : t.seconds ? 'hms' : t.minutes ? 'hm' : 'h';
      const DEFAULT = { minutes: true, seconds: true, h24: false, hourPad: '', minSecPad: '0', separator: ':', am: ' AM', pm: ' PM', prefix: false };
      out.push(field('Time format', this.bind(select([['', 'As entered'], ['hms', 'hh:mm:ss'], ['hm', 'hh:mm'], ['h', 'hh']], shape), (v) => {
        if (!v) return setFormat('time', undefined);
        setFormat('time', { ...DEFAULT, ...t, minutes: v !== 'h', seconds: v === 'hms' });
      })));
      if (t) {
        const h24 = check('24-hour clock', t.h24);
        h24.input.addEventListener('change', () => this.change(() => setFormat('time', { ...t, h24: h24.input.checked, am: h24.input.checked ? '' : ' AM', pm: h24.input.checked ? '' : ' PM' })));
        const pad = check('Leading zero for hours', t.hourPad === '0');
        pad.input.addEventListener('change', () => this.change(() => setFormat('time', { ...t, hourPad: pad.input.checked ? '0' : '' })));
        out.push(h('div', { class: 'd-row' }, h24.el, pad.el));
      }
    }
    return out.length ? [h('h4', {}, 'Data formatting'), ...out] : [];
  }

  /** Script triggers: for each event the web client fires, the script to run and its parameter. */
  private triggersInspector(target: { triggers?: ScriptTrigger[] }, events: [string, string][]): HTMLElement[] {
    const scripts = this.studio.design.scripts;
    const rows = events.map(([event, hint]) => {
      const t = target.triggers?.find((x) => x.event === event);
      const set = (next: ScriptTrigger | undefined) => {
        const rest = (target.triggers ?? []).filter((x) => x.event !== event);
        if (next) rest.push(next);
        if (rest.length) target.triggers = rest;
        else delete target.triggers;
      };
      const script = select([['', 'No script'], ...scripts.map((x) => [String(x.id), x.name] as [string, string])], String(t?.scriptId ?? ''), { 'aria-label': `${event} script` });
      const param = h('input', { value: t?.parameter ?? '', class: 'd-code', placeholder: 'Parameter (formula)', 'aria-label': `${event} parameter` });
      script.addEventListener('change', () => this.change(() => {
        const s = scripts.find((x) => String(x.id) === script.value);
        set(s && { event, scriptId: s.id, script: s.name, ...(param.value ? { parameter: param.value } : {}), ...(t?.modes ? { modes: t.modes } : {}) });
      }));
      param.addEventListener('change', () => this.change(() => {
        if (t) set({ ...t, parameter: param.value || undefined });
      }));
      param.disabled = !t;
      // Browse mode always; Find mode when ticked (FileMaker's per-mode checkboxes).
      const find = check('Find', !!t?.modes?.includes('find'));
      find.input.disabled = !t;
      find.input.title = 'Also run in Find mode';
      find.input.addEventListener('change', () => this.change(() => {
        if (!t) return;
        const modes: NonNullable<ScriptTrigger['modes']> = (t.modes ?? ['browse']).filter((m) => m !== 'find');
        if (find.input.checked) modes.push('find');
        set({ ...t, modes: modes.length === 1 && modes[0] === 'browse' ? undefined : modes });
      }));
      return h('div', { class: 'le-trigger' }, h('span', { class: 'd-label', title: hint }, event), script, param, find.el);
    });
    return [h('h3', {}, 'Script triggers'), ...rows];
  }

  /** Conditional formatting: a formula and the text color, fill and weight to use when it's true. */
  /** The object's theme style and its own formatting, like FileMaker's Styles and Appearance inspectors. */
  /** The Inspector's Styles tab: the theme's styles for this kind of object, and saving this object's look as one. */
  private stylesInspector(o: LayoutObject): HTMLElement[] {
    const out: HTMLElement[] = [];
    const themeId = this.design.themeId;
    const theme = themeId !== undefined ? this.studio.design.themes.find((t) => t.id === themeId) : undefined;
    const element = elementOf(o);
    const local = o.style.rules ?? [];
    if (theme) {
      const names = [...new Set((theme.styles ?? []).filter((x) => x.element === undefined || x.element === element).map((x) => x.name))];
      if (o.style.name && !names.includes(o.style.name)) names.unshift(o.style.name);
      const pick = select([['', `Default ${elementName(element).toLowerCase()}`], ...names.map((n) => [n, n] as [string, string])], o.style.name ?? '', { 'aria-label': 'Style' });
      out.push(field(`Style (theme "${theme.name}")`, this.bind(pick, (v) => {
        if (v) o.style = { ...o.style, name: v, ...(element !== undefined ? { element } : {}) };
        else delete o.style.name;
      })));
      const actions = h('div', { class: 'd-actions' });
      actions.append(button('New style…', () => {
        const name = prompt(`Name the new ${elementName(element).toLowerCase()} style. It gets this object's look.`)?.trim();
        if (!name || element === undefined) return;
        const named = this.meta.theme?.styles.find((x) => x.name === o.style.name && (x.element === undefined || x.element === element));
        const rules = mergeRules(named?.rules ?? [], local);
        this.rememberUndo(JSON.stringify(this.design));
        o.style = { element, name };
        void this.saveWith([{ op: 'createStyle', theme: themeId!, name, element, rules }], `Saved style ${name}`);
      }, { title: 'Save this object\'s look as a style others can use' }));
      if (o.style.name && local.length) {
        actions.append(button('Update style', () => {
          const named = this.meta.theme?.styles.find((x) => x.name === o.style.name && (x.element === undefined || x.element === element));
          const rules = mergeRules(named?.rules ?? [], local);
          const name = o.style.name!;
          this.rememberUndo(JSON.stringify(this.design));
          delete o.style.rules;
          void this.saveWith([{ op: 'updateStyle', theme: themeId!, style: name, ...(named?.element !== undefined ? { element: named.element } : {}), rules }], `Updated style ${name} on every object that uses it`);
        }, { title: 'Put this object\'s own formatting into its style' }));
      }
      out.push(actions);
    } else out.push(h('p', { class: 'd-muted' }, 'This layout has no theme: objects only have their own formatting. Pick a theme in Layout Setup to use styles.'));
    return out;
  }

  /** The Inspector's Appearance tab: this object's own formatting over its style, per part and state, and the Format Painter. */
  private appearanceInspector(o: LayoutObject): HTMLElement[] {
    const out: HTMLElement[] = [];
    const local = o.style.rules ?? [];
    const draft = structuredClone(local);
    out.push(ruleEditor(draft, () => this.change(() => {
      if (draft.length) o.style = { ...o.style, rules: structuredClone(draft) };
      else delete o.style.rules;
    }), { compact: true, view: this.styleView }));
    if (local.length) out.push(button('Clear formatting', () => this.change(() => delete o.style.rules), { class: 'quiet', title: 'Remove this object\'s own formatting, keeping its style' }));
    out.push(this.formatPainter([o]));
    return out;
  }

  /** What Copy format took, for Paste format: FileMaker's Format Painter. */
  private copiedFormat?: LayoutObject['style'];

  /**
   * Format Painter: Copy format takes one object's style and own formatting; Paste format puts them on the
   * selected objects. An object of another kind keeps its own style and gets only the formatting.
   */
  private formatPainter(sel: LayoutObject[]): HTMLElement {
    const free = sel.filter((o) => !this.locked(o));
    const paste = () => {
      const from = this.copiedFormat;
      if (!from) return;
      this.change(() => free.forEach((o) => {
        const same = from.element === undefined || from.element === o.style.element;
        const rules = from.rules?.length ? structuredClone(from.rules) : undefined;
        o.style = same ? { ...o.style, ...(from.element !== undefined ? { element: from.element } : {}), name: from.name, rules } : { ...o.style, rules };
        if (!o.style.name) delete o.style.name;
        if (!o.style.rules) delete o.style.rules;
      }));
    };
    return h('div', { class: 'd-actions' },
      ...(sel.length === 1 ? [button('Copy format', () => {
        this.copiedFormat = structuredClone(sel[0].style);
        toast('Format copied: select objects and Paste format', 'info');
        this.draw();
      }, { class: 'quiet', title: 'Format Painter: take this object\'s style and formatting' })] : []),
      ...(this.copiedFormat && free.length ? [button('Paste format', paste, { class: 'quiet', title: 'Put the copied style and formatting on the selected objects' })] : []));
  }

  private conditionsInspector(o: LayoutObject): HTMLElement[] {
    const rows = h('div', { class: 'd-stack' });
    (o.conditions ?? []).forEach((c, i) => {
      const css = c.rules.find((r) => r.part === 1 && r.state === 1)?.css ?? {};
      const set = (k: string, v: string | undefined) => {
        const rules = o.conditions![i].rules;
        let r = rules.find((x) => x.part === 1 && x.state === 1);
        if (!r) rules.push((r = { part: 1, state: 1, css: {} }));
        if (v) r.css[k] = v;
        else delete r.css[k];
      };
      const colorInput = (k: string, title: string) => {
        const on = check(title, !!css[k]);
        const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(css[k] ?? '') ? css[k] : k === 'color' ? '#c0392b' : '#fff3c4', 'aria-label': `${title} color` });
        on.input.addEventListener('change', () => this.change(() => set(k, on.input.checked ? pick.value : undefined)));
        pick.addEventListener('change', () => this.change(() => set(k, pick.value)));
        return h('span', { class: 'd-row' }, on.el, pick);
      };
      const deco = css['text-decoration'] ?? '';
      const toggle = (title: string, k: string, value: string, on: boolean) => {
        const box = check(title, on);
        box.input.addEventListener('change', () => this.change(() => {
          if (k !== 'text-decoration') return set(k, box.input.checked ? value : undefined);
          // Underline and strikethrough share text-decoration.
          const words = new Set<string>(deco.split(/\s+/).filter((w) => w === 'underline' || w === 'line-through'));
          if (box.input.checked) words.add(value);
          else words.delete(value);
          set(k, [...words].join(' ') || undefined);
        }));
        return box.el;
      };
      const size = this.bind(h('input', { type: 'number', min: '4', value: (css['font-size'] ?? '').replace(/pt|px$/, ''), placeholder: 'size', class: 'd-narrow', 'aria-label': `Condition ${i + 1} font size` }),
        (v) => set('font-size', Number(v) > 0 ? `${Number(v)}pt` : undefined));
      // Format when: a formula, or "Value is" (written as a formula on Self, as FileMaker evaluates it).
      const value = this.formulaConditions.has(c) ? undefined : valueIs(c.formula);
      const kind = this.bind(select([['formula', 'Formula is'], ['value', 'Value is']], value ? 'value' : 'formula', { 'aria-label': `Condition ${i + 1} kind` }), (v) => {
        if (v === 'formula') return void this.formulaConditions.add(c);
        this.formulaConditions.delete(c);
        if (!valueIs(c.formula)) c.formula = valueFormula({ op: 'eq', a: '""', b: '' });
      });
      let when: HTMLElement;
      if (value) {
        const update = (next: Partial<ValueIs>) => (o.conditions![i].formula = valueFormula({ ...value, ...next }));
        const op = this.bind(select(VALUE_OPS.map(([k, label]) => [k, label] as [string, string]), value.op, { 'aria-label': `Condition ${i + 1} operator` }), (v) => update({ op: v as ValueIs['op'], a: value.a || '""', b: value.b || '""' }));
        const arity = VALUE_OPS.find(([k]) => k === value.op)![2];
        const a = this.bind(h('input', { value: value.a, class: 'd-code', 'aria-label': `Condition ${i + 1} value` }), (v) => update({ a: v || '""' }));
        const b = this.bind(h('input', { value: value.b, class: 'd-code', 'aria-label': `Condition ${i + 1} second value` }), (v) => update({ b: v || '""' }));
        when = h('div', { class: 'd-row' }, op, ...(arity > 0 ? [a] : []), ...(arity > 1 ? [h('span', {}, 'and'), b] : []));
      } else {
        when = this.bind(h('input', { value: c.formula, class: 'd-code', 'aria-label': `Condition ${i + 1} formula` }), (v) => (o.conditions![i].formula = v));
      }
      rows.append(h('div', { class: 'le-condition' },
        h('div', { class: 'd-row' }, kind, button('×', () => this.change(() => {
          o.conditions!.splice(i, 1);
          if (!o.conditions!.length) delete o.conditions;
        }), { class: 'quiet', title: 'Remove condition' })),
        when,
        h('div', { class: 'd-row' }, colorInput('color', 'text'), colorInput('background-color', 'fill')),
        h('div', { class: 'd-row' },
          toggle('bold', 'font-weight', 'bold', css['font-weight'] === 'bold' || css['font-weight'] === '700'),
          toggle('italic', 'font-style', 'italic', css['font-style'] === 'italic'),
          toggle('underline', 'text-decoration', 'underline', /underline/.test(deco)),
          toggle('strike', 'text-decoration', 'line-through', /line-through/.test(deco)),
          size)));
    });
    return [
      h('h3', {}, 'Conditional formatting'),
      rows,
      button('Add condition', () => this.change(() => {
        (o.conditions ??= []).push({ formula: 'Self = ""', rules: [{ part: 1, state: 1, css: { 'background-color': '#fff3c4' } }] });
      })),
    ];
  }

  private portalInspector(o: LayoutObject): HTMLElement[] {
    const d = this.studio.design;
    const p = o.portal!;
    const tos = select(d.tableOccurrences.filter((t) => !t.dataSourceId).map((t) => [String(t.id), t.name] as [string, string]), String(p.tableOccurrenceId));
    const rows = h('input', { type: 'number', min: '1', value: String(p.rows), class: 'd-narrow' });
    const first = h('input', { type: 'number', min: '1', value: String(p.initialRow), class: 'd-narrow' });
    return [
      field('Show related records from', this.bind(tos, (v) => {
        const to = d.tableOccurrences.find((t) => t.id === Number(v));
        if (to) o.portal = { ...o.portal!, tableOccurrenceId: to.id, tableOccurrence: to.name, sort: undefined }; // the old sort fields belong to the old occurrence
      })),
      h('div', { class: 'le-grid' },
        field('Rows', this.bind(rows, (v) => {
          // Rows keep their height: the portal grows or shrinks.
          const n = Math.max(1, Math.round(Number(v)) || 1);
          const rh = portalRowHeight(o);
          o.portal = { ...o.portal!, rows: n };
          o.bounds = { ...o.bounds, bottom: Math.round(o.bounds.top + 2 + rh * n) };
        })),
        field('First row', this.bind(first, (v) => (o.portal = { ...o.portal!, initialRow: Math.max(1, Math.round(Number(v)) || 1) })))),
      field('Show only rows where (formula)', this.bind(h('input', { value: p.filter ?? '', class: 'd-code', placeholder: `${p.tableOccurrence ?? 'Table'}::Status ≠ "Void"` }), (v) => {
        const { filter: _f, ...rest } = o.portal!;
        o.portal = v.trim() ? { ...rest, filter: v } : rest;
      })),
      ...this.portalSort(o),
      ...this.portalOptions(o),
      h('p', { class: 'd-muted' }, `${o.children?.length ?? 0} objects in the first row. With the portal selected, Add field puts a field there; drag objects into the first row to add them.`),
    ];
  }

  /**
   * Portal Setup's checkboxes. The row states are FileMaker's LocalCSS properties
   * -fm-portal-alt-background and -fm-use-portal-current-row-style, true unless
   * set false (Kear §10.2).
   */
  private portalOptions(o: LayoutObject): HTMLElement[] {
    const p = o.portal!;
    const box = (label: string, on: boolean, set: (v: boolean) => void, title?: string) => {
      const c = check(label, on);
      if (title) c.el.title = title;
      c.input.addEventListener('change', () => this.change(() => set(c.input.checked)));
      return c.el;
    };
    const setup = (key: 'scrolling' | 'scrollBarWhenScrolling' | 'allowDelete') => (v: boolean) => {
      const next = { ...o.portal! };
      if (v) next[key] = true;
      else delete next[key];
      if (!next.scrolling) delete next.scrollBarWhenScrolling;
      o.portal = next;
    };
    const css = (k: string) => o.style.rules?.find((r) => r.part === 1 && r.state === 1)?.css[k];
    const rowState = (k: string) => (v: boolean) => {
      const rules = (o.style.rules ??= []);
      let r = rules.find((x) => x.part === 1 && x.state === 1);
      if (!r) rules.push((r = { part: 1, state: 1, css: {} }));
      if (v) delete r.css[k];
      else r.css[k] = 'false';
    };
    return [
      h('div', { class: 'd-stack' },
        box('Allow deletion of portal records', !!p.allowDelete, setup('allowDelete')),
        box('Allow vertical scrolling', !!p.scrolling, setup('scrolling')),
        ...(p.scrolling ? [box('Show scroll bar only when scrolling', !!p.scrollBarWhenScrolling, setup('scrollBarWhenScrolling'))] : []),
        box('Use alternate row state', css('-fm-portal-alt-background') !== 'false', rowState('-fm-portal-alt-background'), 'Every other row takes the alternate row look'),
        box('Use active row state', css('-fm-use-portal-current-row-style') !== 'false', rowState('-fm-use-portal-current-row-style'), 'The row being edited takes the active row look')),
    ];
  }

  /** The portal's sort order: fields of its occurrence, each ascending or descending. */
  private portalSort(o: LayoutObject): HTMLElement[] {
    const d = this.studio.design;
    const p = o.portal!;
    const to = d.tableOccurrences.find((t) => t.id === p.tableOccurrenceId);
    const fields = d.tables.find((t) => !to?.dataSourceId && t.id === to?.baseTableId)?.fields ?? [];
    if (!to || !fields.length) return [];
    const set = (sort: NonNullable<typeof p.sort>) => {
      const { sort: _s, ...rest } = o.portal!;
      o.portal = sort.length ? { ...rest, sort } : rest;
    };
    const ref = (id: number) => ({ tableOccurrenceId: to.id, fieldId: id, tableOccurrence: to.name, field: fields.find((f) => f.id === id)?.name });
    const rows = (p.sort ?? []).map((k, i) => {
      const pick = this.bind(select(fields.map((f) => [String(f.id), f.name] as [string, string]), String(k.field.fieldId)), (v) => set(p.sort!.map((x, j) => (j === i ? { ...x, field: ref(Number(v)) } : x))));
      const dir = this.bind(select([['asc', 'Ascending'], ['desc', 'Descending']], k.descending ? 'desc' : 'asc'), (v) => set(p.sort!.map((x, j) => (j === i ? { ...x, descending: v === 'desc' || undefined } : x))));
      return h('div', { class: 'd-row' }, pick, dir, button('×', () => this.change(() => set(p.sort!.filter((_, j) => j !== i))), { class: 'quiet', title: 'Remove' }));
    });
    return [
      h('span', { class: 'd-label' }, p.sort?.length ? 'Sort rows by' : 'Rows in creation order'),
      ...rows,
      button('Add sort field', () => this.change(() => set([...(p.sort ?? []), { field: ref(fields[0].id) }]))),
    ];
  }

  /** A column chart of the found set: the layout's first number field by its first text field. */
  private addChart(): void {
    const to = this.studio.design.tableOccurrences.find((t) => t.id === this.design.tableOccurrenceId);
    const table = this.studio.design.tables.find((t) => t.id === to?.baseTableId);
    const ref = (type: string) => {
      const f = table?.fields.find((x) => x.type === type && x.kind !== 'summary');
      return f && to ? `${to.name}::${f.name}` : '';
    };
    const value = ref('number');
    this.add({ kind: 'chart', type: 13, external: 'CHRT', style: newStyle('chart', this.themed), width: 360, height: 240,
      chart: { type: 'column', source: 'found-set', title: '"Chart"', categories: ref('text') || '""', series: [{ data: value || '0', name: value ? JSON.stringify(value.split('::')[1]) : '"Series 1"' }] } });
  }

  /** Chart Setup: type, data source, titles, axes and series. Every text is a formula. */
  private chartInspector(c: NonNullable<LayoutObject['chart']>): HTMLElement[] {
    const formula = (label: string, value: string | undefined, apply: (v: string | undefined) => void, hint?: string) =>
      field(label, this.bind(h('input', { value: value ?? '', class: 'd-code', spellcheck: 'false', 'aria-label': label }), (v) => apply(v || undefined)), hint);
    const put = <K extends keyof typeof c>(k: K) => (v: (typeof c)[K] | undefined) => (v === undefined ? delete c[k] : (c[k] = v));
    const types: [string, string][] = [['column', 'Column'], ['stacked-column', 'Stacked column'], ['bar', 'Bar'], ['stacked-bar', 'Stacked bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['scatter', 'Scatter'], ['bubble', 'Bubble']];
    const xy = c.type === 'scatter' || c.type === 'bubble';
    const out: HTMLElement[] = [h('h3', {}, 'Chart Setup'),
      field('Type', this.bind(select(types, c.type, { 'aria-label': 'Chart type' }), (v) => (c.type = v as typeof c.type)))];
    const source = select([['found-set', 'Current found set'], ['record', 'Current record (delimited data)'], ['related', 'Related records']], c.source, { 'aria-label': 'Chart data source' });
    out.push(field('Data source', this.bind(source, (v) => {
      c.source = v as typeof c.source;
      if (v !== 'found-set') delete c.grouped;
      if (v !== 'related') delete c.occurrence;
      else c.occurrence ??= this.studio.design.tableOccurrences.find((t) => t.id !== this.design.tableOccurrenceId)?.name;
    }), c.source === 'record' ? 'Each formula returns a list of values, one per line.' : undefined));
    if (c.source === 'found-set') {
      const g = check('Summarized data (one point per group of sorted records)', !!c.grouped);
      g.input.addEventListener('change', () => this.change(() => (g.input.checked ? (c.grouped = true) : delete c.grouped)));
      out.push(g.el);
    }
    if (c.source === 'related') {
      const tos = this.studio.design.tableOccurrences.map((t) => [t.name, t.name] as [string, string]);
      out.push(field('Related through', this.bind(select(tos, c.occurrence ?? '', { 'aria-label': 'Related occurrence' }), (v) => (c.occurrence = v))));
    }
    out.push(formula('Title', c.title, put('title')));
    if (c.type !== 'pie') {
      out.push(h('div', { class: 'd-row' }, formula('X-axis title', c.xTitle, put('xTitle')), formula('Y-axis title', c.yTitle, put('yTitle'))));
      out.push(h('div', { class: 'd-row' }, formula('Y-axis minimum', c.yMin, put('yMin')), formula('Y-axis maximum', c.yMax, put('yMax'))));
    }
    if (!xy) out.push(formula(c.type === 'pie' ? 'Slice labels' : 'Categories (x axis)', c.categories, put('categories')));
    out.push(h('h4', {}, 'Series'));
    c.series.forEach((sr, i) => {
      const set = (k: 'data' | 'name' | 'x' | 'sizes') => (v: string | undefined) => (v === undefined && k !== 'data' ? delete sr[k] : (sr[k] = v ?? '0'));
      out.push(h('div', { class: 'd-stack le-series' },
        formula(xy ? `Series ${i + 1} y values` : `Series ${i + 1} values`, sr.data, set('data')),
        formula(`Series ${i + 1} name`, sr.name, set('name')),
        ...(xy ? [formula(`Series ${i + 1} x values`, sr.x, set('x'))] : []),
        ...(c.type === 'bubble' ? [formula(`Series ${i + 1} bubble sizes`, sr.sizes, set('sizes'))] : []),
        ...(c.series.length > 1 ? [button('Remove series', () => this.change(() => c.series.splice(i, 1)), { class: 'quiet' })] : [])));
    });
    if (c.type !== 'pie' || c.series.length === 0) out.push(button('Add series', () => this.change(() => c.series.push({ data: '0', name: `"Series ${c.series.length + 1}"` }))));
    out.push(...this.chartLook(c));
    return out;
  }

  /** Chart Setup's look: the background gradient, and each text's size and color. */
  private chartLook(c: NonNullable<LayoutObject['chart']>): HTMLElement[] {
    const color = (label: string, value: string, apply: (hex: string) => void) => {
      const pick = h('input', { type: 'color', value: toHex(value), 'aria-label': label }) as HTMLInputElement;
      pick.addEventListener('change', () => this.change(() => apply(pick.value)));
      return field(label, pick);
    };
    const out: HTMLElement[] = [h('h4', {}, 'Appearance')];
    const [top, bottom] = c.background ?? ['#ffffff', '#ffffff'];
    out.push(h('div', { class: 'd-row' },
      color('Background top', top, (v) => (c.background = [v, c.background?.[1] ?? bottom])),
      color('Background bottom', bottom, (v) => (c.background = [c.background?.[0] ?? top, v]))));
    const parts: [keyof typeof DEFAULT_TEXT, string][] = [['title', 'Title'], ['legend', 'Legend'], ...(c.type === 'pie' ? [] : [['xLabels', 'X-axis labels'], ['xTitle', 'X-axis title'], ['yLabels', 'Y-axis labels'], ['yTitle', 'Y-axis title']] as [keyof typeof DEFAULT_TEXT, string][])];
    const text = () => (c.text ??= structuredClone(DEFAULT_TEXT));
    for (const [part, name] of parts) {
      const t = c.text?.[part] && c.text[part].size > 0 ? c.text[part] : DEFAULT_TEXT[part];
      const size = h('input', { type: 'number', min: '4', max: '200', value: String(t.size), class: 'd-narrow', 'aria-label': `${name} size` });
      out.push(h('div', { class: 'd-row' },
        field(`${name} size`, this.bind(size, (v) => (text()[part] = { ...text()[part], size: Math.min(200, Math.max(4, Number(v) || DEFAULT_TEXT[part].size)) }))),
        color(`${name} color`, t.color, (v) => (text()[part] = { ...text()[part], color: v }))));
    }
    return out;
  }

  /** Button Setup's icon: one from the file's image library (or uploaded), its size and where it sits. */
  private iconInspector(o: LayoutObject): HTMLElement[] {
    const out: HTMLElement[] = [h('h3', {}, 'Icon')];
    const choose = () => this.pickImage((img) => this.change(() => {
      o.icon = { imageId: img.id, size: o.icon?.size ?? 16, display: o.icon?.display ?? (o.text || o.label ? 'left' : 'icon') };
    }));
    if (!o.icon) {
      out.push(button('Choose icon', choose));
      return out;
    }
    const icon = o.icon;
    const url = this.meta.images[icon.imageId];
    out.push(h('div', { class: 'd-row' },
      url ? h('img', { src: url, alt: '', class: 'le-icon-preview' }) : h('span', { class: 'd-muted' }, `Image ${icon.imageId}`),
      button('Change', choose),
      button('Remove', () => this.change(() => delete o.icon), { class: 'quiet' })));
    const display = select([['label', 'Label only'], ['icon', 'Icon only'], ['left', 'Icon left of label'], ['right', 'Icon right of label'], ['top', 'Icon above label'], ['bottom', 'Icon below label']], icon.display, { 'aria-label': 'Icon position' });
    out.push(h('div', { class: 'd-row' },
      field('Show', this.bind(display, (v) => (o.icon = { ...icon, display: v as typeof icon.display }))),
      field('Size (pt)', this.bind(h('input', { type: 'number', min: '4', value: String(icon.size), 'aria-label': 'Icon size' }), (v) => (o.icon = { ...icon, size: Math.max(4, Number(v) || 16) })))));
    return out;
  }

  /** The image library in a dialog: pick one, or upload a PNG, JPEG, GIF, WebP or SVG into it. */
  private pickImage(done: (img: { id: number; width: number; height: number }) => void): void {
    const dialog = h('dialog', { class: 'd-dialog le-images', 'aria-labelledby': 'le-images-title' });
    const grid = h('div', { class: 'le-image-grid' }, h('span', { class: 'd-muted' }, 'Loading the image library…'));
    const finish = (id: number, url: string) => {
      this.meta.images[id] = url;
      const probe = new Image();
      const size = () => {
        // Pictures come in at their own size, up to 240 points wide.
        const w = probe.naturalWidth || 64, ht = probe.naturalHeight || 64, k = Math.min(1, 240 / w);
        dialog.close();
        dialog.remove();
        done({ id, width: Math.round(w * k), height: Math.round(ht * k) });
      };
      probe.onload = size;
      probe.onerror = size;
      probe.src = url;
    };
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml', 'aria-label': 'Upload an image' }) as HTMLInputElement;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const r = await this.studio.client.addImage({ filename: f.name, mime: f.type, data: btoa(bin) });
        finish(r.id, r.url);
      } catch (e) {
        toast(errorText(e));
      }
    });
    dialog.append(h('h3', { id: 'le-images-title' }, 'Image library'), grid,
      h('div', { class: 'd-actions' }, h('label', { class: 'd-label' }, 'Upload ', file), button('Cancel', () => { dialog.close(); dialog.remove(); })));
    document.body.append(dialog);
    dialog.showModal();
    this.studio.client.images().then((images) => {
      grid.replaceChildren(...(images.length ? images.map((img) => {
        const b = h('button', { class: 'le-image', title: img.filename ?? `Image ${img.id}`, 'data-id': String(img.id) }, h('img', { src: img.url, alt: img.filename ?? '' }));
        b.addEventListener('click', () => finish(img.id, img.url));
        return b;
      }) : [h('span', { class: 'd-muted' }, 'No images yet. Upload one.')]));
    }, (e) => grid.replaceChildren(h('span', { class: 'd-muted' }, errorText(e))));
  }

  private barInspector(o: LayoutObject): HTMLElement[] {
    const segs = o.children ?? [];
    // Button Bar Setup: each segment's label is text or a calculation.
    const row = (c: LayoutObject, i: number) => {
      const calc = c.label !== undefined;
      const input = this.bind(h('input', { value: calc ? c.label! : c.text ?? '', class: calc ? 'd-code' : '', 'aria-label': `Segment ${i + 1} label` }),
        (v) => (calc ? (c.label = v || '""') : (c.text = v)));
      const fx = check('calc', calc);
      fx.el.title = 'The label is a calculation, worked out for each record';
      fx.input.addEventListener('change', () => this.change(() => {
        if (fx.input.checked) {
          c.label = c.text ? JSON.stringify(c.text) : '""';
          delete c.text;
        } else {
          const literal = /^"((?:[^"\\]|\\.)*)"$/.exec(c.label ?? '');
          c.text = literal ? literal[1].replace(/\\(.)/g, '$1') : '';
          delete c.label;
        }
      }));
      return h('div', { class: 'd-row' }, input, fx.el,
        button('×', () => {
          if (segs.length < 2) return toast('A button bar needs at least one segment.');
          this.change(() => {
            o.children = segs.filter((x) => x !== c);
            if (o.activeSegment === c.id) delete o.activeSegment;
            fitSegments(o);
          });
        }, { class: 'quiet', title: 'Remove segment' }));
    };
    const name = (c: LayoutObject, i: number) => c.text || c.name || (c.label ? `Segment ${i + 1} (calculated)` : `Segment ${i + 1}`);
    const activeNow = o.activeSegmentFormula !== undefined ? 'formula' : o.activeSegment !== undefined ? String(o.activeSegment) : '';
    const active = this.bind(select([['', 'None'], ...segs.map((c, i) => [String(c.id), name(c, i)] as [string, string]), ['formula', 'Specify (calculation)']], activeNow), (v) => {
      delete o.activeSegment;
      delete o.activeSegmentFormula;
      if (v === 'formula') o.activeSegmentFormula = '""';
      else if (v) o.activeSegment = Number(v);
    });
    const vertical = isVertical(o);
    const orient = this.bind(select([['h', 'Horizontal'], ['v', 'Vertical']], vertical ? 'v' : 'h'), (v) => {
      if ((v === 'v') === vertical) return;
      // Turn the bar about its top-left corner, as FileMaker's orientation switch does.
      const { top, left, bottom, right } = o.bounds;
      o.bounds = { top, left, right: left + (bottom - top), bottom: top + (right - left) };
      fitSegments(o);
    });
    const out = [
      h('h3', {}, 'Button Bar Setup'),
      field('Orientation', orient),
      ...segs.map(row),
      button('Add segment', () => this.change(() => {
        o.children = [...segs, this.segment(o, `Button ${segs.length + 1}`)];
        fitSegments(o);
      })),
      field('Active segment', active, 'Shown as pressed. A calculation returns the object name of the segment to show active.'),
    ];
    if (o.activeSegmentFormula !== undefined) {
      out.push(field('Active segment (formula)', this.bind(h('input', { value: o.activeSegmentFormula, class: 'd-code' }), (v) => (o.activeSegmentFormula = v || '""'))));
    }
    out.push(h('p', { class: 'd-muted' }, 'Click a segment on the layout to set its action or object name.'));
    return out;
  }

  /** Tab Control Setup: justification, tab width and height, written as each tab's place in the strip (as the file keeps them). */
  private tabSetup(o: LayoutObject, panels: LayoutObject[]): HTMLElement[] {
    const width = o.bounds.right - o.bounds.left;
    const tabs = panels.map((p) => p.tab);
    const total = tabs.reduce((n, t) => n + (t?.width ?? 0), 0);
    const fixed = tabs.length > 0 && tabs.every((t) => t?.width && Math.abs(t.width - tabs[0]!.width) < 1) ? Math.round(tabs[0]!.width) : 0;
    const justify = tabs[0] && tabs[0].left <= 0 && total && Math.abs(total - width) <= 2 ? 'full'
      : ({ center: 'center', 'flex-end': 'right' } as Record<string, string>)[tabJustify(panels, width) ?? ''] ?? 'left';
    const lay = (how: string, tabWidth: number) => {
      // Label-width tabs: as wide as their label, measured in the theme's usual size.
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) ctx.font = '13px system-ui, sans-serif';
      const label = (p: LayoutObject) => Math.ceil((ctx?.measureText(p.text ?? '').width ?? (p.text ?? '').length * 7) + 24);
      const widths = how === 'full' ? panels.map(() => width / panels.length) : panels.map((p) => tabWidth || label(p));
      const sum = widths.reduce((n, w) => n + w, 0);
      let x = how === 'center' ? Math.max(0, (width - sum) / 2) : how === 'right' ? Math.max(0, width - sum) : 0;
      panels.forEach((p, i) => {
        p.tab = { left: Math.round(x * 100) / 100, width: Math.round(widths[i] * 100) / 100 };
        x += widths[i];
      });
    };
    const how = this.bind(select([['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['full', 'Full']], justify, { 'aria-label': 'Tab justification' }), (v) => lay(v, fixed));
    const w = this.bind(h('input', { type: 'number', min: '0', value: String(fixed || ''), placeholder: 'label width', class: 'd-narrow', 'aria-label': 'Tab width' }), (v) => lay(justify === 'full' ? 'left' : justify, Math.max(0, Number(v) || 0)));
    const ht = this.bind(h('input', { type: 'number', min: '8', value: String(o.tabHeight ?? ''), placeholder: '24', class: 'd-narrow', 'aria-label': 'Tab height' }), (v) => (Number(v) >= 8 ? (o.tabHeight = Number(v)) : delete o.tabHeight));
    return [h('h3', {}, 'Tab Control Setup'), h('div', { class: 'd-row' }, field('Justification', how), field('Tab width (pt)', w), field('Tab height', ht))];
  }

  private panelsInspector(o: LayoutObject): HTMLElement[] {
    const panels = (o.children ?? []).filter((c) => PANEL_KINDS.has(c.kind));
    const shown = this.shownPanel(o);
    const opts = panels.map((p, i) => [String(p.id), p.text || `Panel ${i + 1}`] as [string, string]);
    const showing = select(opts, String(shown?.id ?? ''));
    showing.addEventListener('change', () => {
      this.panels.set(o.id, Number(showing.value));
      this.draw();
    });
    const front = this.bind(select(opts, String(o.target ?? panels[0]?.id ?? '')), (v) => (o.target = Number(v)));
    const list = h('div', { class: 'd-stack' });
    panels.forEach((p, i) => {
      const name = this.bind(h('input', { value: p.text ?? '', 'aria-label': `Tab ${i + 1} name` }), (v) => (p.text = v));
      list.append(h('div', { class: 'd-row' }, name, button('×', () => {
        if (panels.length < 2) return toast('A tab control needs at least one tab.');
        if (p.children?.length && !confirm(`Remove "${p.text ?? 'this panel'}" and the ${p.children.length} objects on it?`)) return;
        this.change(() => {
          o.children = o.children!.filter((c) => c !== p);
          if (o.target === p.id) o.target = o.children.find((c) => PANEL_KINDS.has(c.kind))?.id;
          this.panels.delete(o.id);
        });
      }, { class: 'quiet', title: 'Remove tab' })));
    });
    return [
      ...(o.kind === 'tab-control' ? this.tabSetup(o, panels) : []),
      field('Showing while editing', showing),
      field('Front tab in browse mode', front),
      h('h3', {}, o.kind === 'tab-control' ? 'Tabs' : 'Panels'),
      list,
      button(o.kind === 'tab-control' ? 'Add tab' : 'Add panel', () => this.change(() => {
        const p = this.addTab(o, o.kind === 'tab-control' ? `Tab ${panels.length + 1}` : '');
        this.panels.set(o.id, p.id);
      })),
      h('p', { class: 'd-muted' }, 'Drag objects onto the control to put them on the panel that\'s showing.'),
    ];
  }

  private multiInspector(sel: LayoutObject[]): HTMLElement[] {
    const free = sel.filter((o) => !this.locked(o));
    const align = (fn: (o: LayoutObject) => [number, number]) => () => this.change(() => free.forEach((o) => shift(o, ...fn(o))));
    const box = union(sel);
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const size = (w: boolean) => () => this.change(() => free.forEach((o) => {
      const b = sel[0].bounds;
      o.bounds = w ? { ...o.bounds, right: o.bounds.left + (b.right - b.left) } : { ...o.bounds, bottom: o.bounds.top + (b.bottom - b.top) };
      fitPanels(o);
      fitSegments(o);
    }));
    const locked = sel.filter((o) => o.locked);
    return [
      h('h3', {}, `${sel.length} objects`),
      ...(free.length < sel.length ? [h('p', { class: 'd-muted' }, `${sel.length - free.length} locked: aligning and resizing leave ${sel.length - free.length === 1 ? 'it' : 'them'} where ${sel.length - free.length === 1 ? 'it is' : 'they are'}.`)] : []),
      h('span', { class: 'd-label' }, 'Align'),
      h('div', { class: 'd-actions' },
        button('Left', align((o) => [box.left - o.bounds.left, 0]), { title: 'Align left edges' }),
        button('Centre', align((o) => [Math.round(cx - (o.bounds.left + o.bounds.right) / 2), 0]), { title: 'Align horizontal centres' }),
        button('Right', align((o) => [box.right - o.bounds.right, 0]), { title: 'Align right edges' }),
        button('Top', align((o) => [0, box.top - o.bounds.top]), { title: 'Align top edges' }),
        button('Middle', align((o) => [0, Math.round(cy - (o.bounds.top + o.bounds.bottom) / 2)]), { title: 'Align vertical centres' }),
        button('Bottom', align((o) => [0, box.bottom - o.bounds.bottom]), { title: 'Align bottom edges' })),
      h('span', { class: 'd-label' }, 'Distribute and resize'),
      h('div', { class: 'd-actions' },
        button('Across', () => (free.length < 3 ? toast('Select three or more unlocked objects to distribute') : this.distribute(free, true)), { title: 'Space evenly from left to right' }),
        button('Down', () => (free.length < 3 ? toast('Select three or more unlocked objects to distribute') : this.distribute(free, false)), { title: 'Space evenly from top to bottom' }),
        button('Same width', size(true), { title: 'The width of the first one selected' }),
        button('Same height', size(false), { title: 'The height of the first one selected' })),
      h('span', { class: 'd-label' }, 'Arrange'),
      h('div', { class: 'd-actions' },
        button('Group', () => this.group(), { title: '⌘R' }),
        ...(sel.some((o) => o.kind === 'group') ? [button('Ungroup', () => this.ungroup(), { title: '⇧⌘R' })] : []),
        locked.length === sel.length
          ? button('Unlock', () => this.setLocked(sel, false), { title: '⌥⌘L' })
          : button('Lock', () => this.setLocked(sel, true), { title: '⌘L' }),
        button('To front', () => this.toEnd(free, true), { title: '⇧⌘]' }),
        button('Forward', () => this.step(free, 1), { title: '⌘]' }),
        button('Backward', () => this.step(free, -1), { title: '⌘[' }),
        button('To back', () => this.toEnd(free, false), { title: '⇧⌘[' })),
      h('div', { class: 'd-actions' },
        button('Duplicate', () => this.duplicate()),
        button('Copy for FileMaker', () => this.copyObjects(), { title: 'Copy as FileMaker Layout mode XML (Cmd/Ctrl+C)' }),
        button('Delete', () => {
          if (free.length < sel.length) toast('Locked objects stay; unlock them to delete them');
          if (free.length) this.change(() => this.remove(new Set(free.map((o) => o.id))));
        }, { class: 'danger' })),
      this.formatPainter(sel),
    ];
  }

  private layoutInspector(): HTMLElement[] {
    const d = this.design;
    const out: HTMLElement[] = [h('h3', {}, 'Layout')];
    out.push(field('Width', this.bind(h('input', { type: 'number', value: String(d.width ?? ''), class: 'd-narrow' }), (v) => (d.width = Math.max(100, Number(v) || 0)))));
    const themes = select([['', 'No theme'], ...this.studio.design.themes.map((t) => [String(t.id), t.name] as [string, string])], String(d.themeId ?? ''));
    out.push(field('Theme', this.bind(themes, (v) => (v ? (d.themeId = Number(v)) : delete d.themeId)), 'The full theme shows after saving'));
    // Layout Setup's menu set: the menu bar while this layout shows.
    const sets = this.studio.design.customMenuSets ?? [];
    const menuSet = select([['0', '[File Default]'], ['1', '[Standard FileMaker Menus]'], ...sets.map((m) => [String(m.id), m.name] as [string, string])], String(d.menuSetId ?? 0), { 'aria-label': 'Menu set' });
    out.push(field('Menu set', this.bind(menuSet, (v) => (d.menuSetId = Number(v))), 'The menu bar while this layout shows'));
    const view = select([['form', 'Form view'], ['list', 'List view'], ['table', 'Table view']], d.view ?? 'form', { 'aria-label': 'Opens in' });
    out.push(field('Opens in', this.bind(view, (v) => {
      d.view = v as 'form' | 'list' | 'table';
      if (d.viewsAllowed && !d.viewsAllowed.includes(d.view)) d.viewsAllowed = [...d.viewsAllowed, d.view];
    }), 'The view the layout shows first'));
    out.push(...this.layoutSetup());
    out.push(this.tableViewInspector());
    const parts = h('div', { class: 'd-stack' });
    for (const p of [...d.parts].sort((a, b) => a.top - b.top)) parts.append(this.partRow(p));
    // Sub-summaries can repeat (one per sort level); other parts appear once.
    const kinds = PART_KINDS.filter(([k]) => k.startsWith('sub-summary') || !d.parts.some((p) => p.kind === k));
    const partName = (k: string) => (k === 'sub-summary-leading' ? 'sub-summary (above records)' : k === 'sub-summary-trailing' ? 'sub-summary (below records)' : k.replace(/-/g, ' '));
    const kind = select(kinds.map(([k]) => [k, partName(k)] as [string, string]), kinds[0]?.[0] ?? '');
    out.push(...this.triggersInspector(d, LAYOUT_EVENTS));
    out.push(h('h3', {}, 'Parts'), parts, h('div', { class: 'd-row' }, kind, button('Add part', () => this.addPart(kind.value))));
    out.push(h('p', { class: 'd-muted' }, 'Drag objects to move them, the handles to resize, a part\'s bottom edge to change its height. Shift-click to select several; arrow keys nudge (shift: 10 pt); hold Alt to move off the grid and guides. ⌘R groups, ⌘L locks. ⌘Z undoes, ⌘S saves.'));
    return out;
  }

  /** Layout Setup's General and Views options: FileMaker's defaults are all on. */
  private layoutSetup(): HTMLElement[] {
    const d = this.design;
    const flag = (text: string, on: boolean, set: (v: boolean) => void, title?: string) => {
      const c = check(text, on);
      if (title) c.el.title = title;
      c.input.addEventListener('change', () => this.change(() => set(c.input.checked)));
      return c.el;
    };
    const views = (['form', 'list', 'table'] as const).map((v) => {
      const c = check(`${v[0].toUpperCase()}${v.slice(1)} view`, !d.viewsAllowed || d.viewsAllowed.includes(v));
      c.input.addEventListener('change', () => {
        const now = d.viewsAllowed ?? ['form', 'list', 'table'];
        const next = c.input.checked ? [...now, v] : now.filter((x) => x !== v);
        if (!next.length) {
          c.input.checked = true;
          toast('A layout needs at least one view');
          return;
        }
        this.change(() => {
          d.viewsAllowed = next;
          // The view it opens in must be one people may use.
          if (d.view && !next.includes(d.view)) d.view = (['form', 'list', 'table'] as const).find((x) => next.includes(x));
        });
      });
      return c.el;
    });
    // The page the layout prints on without fixed margins: the file's page setup, or Preview's own choice.
    const page = () => pageSize(d.width ?? 0, this.studio.design.pageSetup);
    const fixed = check('Use fixed page margins', !!d.fixedMargins);
    fixed.input.addEventListener('change', () => this.change(() => {
      if (fixed.input.checked) d.fixedMargins ??= { ...page().margins };
      else delete d.fixedMargins;
    }));
    const margins = d.fixedMargins;
    const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
    const marginFields = margins ? (['top', 'left', 'bottom', 'right'] as const).map((side) => field(`${side[0].toUpperCase()}${side.slice(1)} margin`, this.bind(h('input', {
      type: 'number', min: '0', step: '0.1', value: String(margins[side]), class: 'd-narrow', 'aria-label': `${side} page margin`,
    }), (v) => {
      const n = Number(v);
      if (!d.fixedMargins || v.trim() === '' || !Number.isFinite(n)) return;
      // At least 0, with a little printable space beyond the opposite margin.
      const { paper } = page();
      const room = (side === 'top' || side === 'bottom' ? paper.height : paper.width) - d.fixedMargins[opposite[side]];
      d.fixedMargins[side] = Math.min(Math.max(0, n), Math.max(0, room - 0.1));
    }), 'Points; replace the file\'s page setup margins in Preview, browser printing and Save Records as PDF')) : [];
    return [
      h('span', { class: 'd-label' }, 'Views allowed'),
      h('div', { class: 'd-row' }, ...views),
      flag('Save record changes automatically', d.saveRecordChanges !== false, (v) => (d.saveRecordChanges = v),
        'Unchecked, leaving a changed record asks whether to save it'),
      flag('Show field frames when record is active', d.fieldFrames !== false, (v) => (d.fieldFrames = v)),
      flag('Show current record indicator in List view', d.recordIndicator !== false, (v) => (d.recordIndicator = v)),
      field('Stack in one column below', this.bind(h('input', { type: 'number', min: '0', placeholder: this.meta.stackBelowDefault ? `Server's setting (${this.meta.stackBelowDefault})` : 'Never', value: d.responsive?.stackBelow !== undefined ? String(d.responsive.stackBelow) : '', class: 'd-narrow', 'aria-label': 'Stack in one column below' }),
        // Empty follows the server's setting; 0 is never for this layout.
        (v) => (v.trim() !== '' && Number(v) >= 0 ? (d.responsive = { stackBelow: Math.round(Number(v)) }) : (d.responsive = {}))),
        'Window width in points; Tabularius only. Narrower windows show each part\'s objects one under another instead of shrinking the layout. Leave empty to follow the server\'s setting; 0 never stacks this layout'),
      h('span', { class: 'd-label' }, 'Printing'),
      fixed.el,
      ...marginFields,
      h('div', { class: 'd-row' },
        field('Print in columns', this.bind(h('input', { type: 'number', min: '1', max: '99', value: String(d.printColumns?.count ?? 1), class: 'd-narrow', 'aria-label': 'Print in columns' }),
          (v) => (d.printColumns = { count: Math.min(99, Math.max(1, Math.round(Number(v)) || 1)), order: d.printColumns?.order }))),
        field('Order', this.bind(select([['across', 'Across first'], ['down', 'Down first']], d.printColumns?.order ?? 'across', { 'aria-label': 'Column order' }),
          (v) => (d.printColumns = { count: d.printColumns?.count ?? 1, order: v === 'down' ? 'down' : 'across' })))),
    ];
  }

  /** Table View's columns: which fields, in what order, how wide. Without any, Table View shows every field. */
  private tableViewInspector(): HTMLElement {
    const d = this.design;
    const cols = d.tableView ?? [];
    const to = this.studio.design.tableOccurrences.find((t) => t.id === d.tableOccurrenceId);
    const table = this.studio.design.tables.find((t) => t.id === to?.baseTableId);
    const fields = to && table ? table.fields.map((f) => ({ id: f.id, name: f.name, ref: { tableOccurrenceId: to.id, fieldId: f.id, tableOccurrence: to.name, field: f.name } })) : [];
    const key = (r: { tableOccurrenceId: number; fieldId: number }) => `${r.tableOccurrenceId}:${r.fieldId}`;
    const set = (next: typeof cols) => (d.tableView = next);
    const rows = cols.map((c, i) => {
      const options: [string, string][] = fields.map((f) => [key(f.ref), f.name]);
      // A related field read from the file stays pickable under its own name.
      if (!options.some(([k]) => k === key(c.field))) options.unshift([key(c.field), c.field.tableOccurrence && c.field.tableOccurrence !== to?.name ? `${c.field.tableOccurrence}::${c.field.field}` : c.field.field ?? `Field ${c.field.fieldId}`]);
      const pick = this.bind(select(options, key(c.field), { 'aria-label': `Column ${i + 1} field` }), (v) => {
        const f = fields.find((x) => key(x.ref) === v);
        if (f) set(cols.map((x, j) => (j === i ? { ...x, field: f.ref } : x)));
      });
      const width = this.bind(h('input', { type: 'number', min: '20', value: String(Math.round(c.width)), class: 'd-narrow', 'aria-label': `Column ${i + 1} width` }),
        (v) => set(cols.map((x, j) => (j === i ? { ...x, width: Math.max(20, Number(v) || 120) } : x))));
      const move = (by: number) => this.change(() => {
        const next = [...cols];
        next.splice(i + by, 0, ...next.splice(i, 1));
        set(next);
      });
      return h('div', { class: 'd-row' }, pick, width,
        button('↑', () => move(-1), { class: 'quiet', title: 'Move left', ...(i === 0 ? { disabled: '' } : {}) }),
        button('↓', () => move(1), { class: 'quiet', title: 'Move right', ...(i === cols.length - 1 ? { disabled: '' } : {}) }),
        button('×', () => this.change(() => set(cols.filter((_, j) => j !== i))), { class: 'quiet', title: 'Remove column' }));
    });
    const unused = fields.filter((f) => !cols.some((c) => key(c.field) === key(f.ref)));
    const box = h('details', { class: 'le-tableview' }, h('summary', {}, `Table View columns (${cols.length || 'every field'})`), ...rows,
      h('div', { class: 'd-row' },
        ...(unused.length ? [button('Add column', () => this.change(() => set([...cols, { field: unused[0].ref, width: 120 }])))] : []),
        ...(cols.length ? [] : [button('Use the layout\'s fields', () => this.change(() => set(this.layoutFields().map((f) => ({ field: f.ref, width: 120 })))))])));
    if (this.tableViewOpen) box.setAttribute('open', '');
    box.addEventListener('toggle', () => (this.tableViewOpen = box.open));
    return box;
  }

  private addPart(kind: string): void {
    const kindId = PART_KINDS.find(([k]) => k === kind)?.[1];
    if (kindId === undefined) return;
    this.change(() => {
      const part: LayoutPart = { kind, kindId, top: 0, height: 40, style: {} };
      if (kind.startsWith('sub-summary')) {
        // Grouped by the layout's first field until another is picked.
        const fields = this.layoutFields();
        if (fields.length) part.breakField = fields[0].ref;
      }
      this.insertBand(part, this.placeFor(kind), []);
    });
  }

  /** Where a part of this kind goes: after the parts FileMaker puts before it (or level with it). */
  private placeFor(kind: string): number {
    const order = PART_KINDS.map(([k]) => k);
    const before = this.design.parts.filter((p) => order.indexOf(p.kind) <= order.indexOf(kind));
    return before.length ? Math.max(...before.map((p) => p.top + p.height)) : 0;
  }

  /** Takes a part out of the layout with the objects that start in it (their tops made relative to it); the rest closes up. */
  private cutBand(p: LayoutPart): LayoutObject[] {
    const inside = this.design.objects.filter((o) => o.bounds.top >= p.top && o.bounds.top < p.top + p.height);
    for (const o of inside) shift(o, 0, -p.top);
    this.design.objects = this.design.objects.filter((o) => !inside.includes(o));
    this.design.parts = this.design.parts.filter((x) => x !== p);
    for (const x of this.design.parts) if (x.top > p.top) x.top -= p.height;
    for (const o of this.design.objects) if (o.bounds.top >= p.top + p.height) shift(o, 0, -p.height);
    return inside;
  }

  /** Puts a part (and its objects, tops relative to it) in at `top`; everything from there down moves down. */
  private insertBand(p: LayoutPart, top: number, inside: LayoutObject[]): void {
    for (const x of this.design.parts) if (x.top >= top) x.top += p.height;
    for (const o of this.design.objects) if (o.bounds.top >= top) shift(o, 0, p.height);
    p.top = top;
    for (const o of inside) shift(o, 0, top);
    this.design.objects.push(...inside);
    this.design.parts.push(p);
  }

  /** Part Definition's type: the part moves to where that kind goes, with its objects. */
  private retype(p: LayoutPart, kind: string): void {
    const kindId = PART_KINDS.find(([k]) => k === kind)?.[1];
    if (kindId === undefined || kind === p.kind) return;
    this.change(() => {
      const inside = this.cutBand(p);
      p.kind = kind;
      p.kindId = kindId;
      if (!kind.startsWith('sub-summary')) delete p.breakField;
      else if (!p.breakField) {
        const fields = this.layoutFields();
        if (fields.length) p.breakField = fields[0].ref;
      }
      this.insertBand(p, this.placeFor(kind), inside);
    });
  }

  /** Swaps a sub-summary with the next one of its kind above (-1) or below (1): their order sets which groups hold which. */
  private reorder(p: LayoutPart, dir: -1 | 1): void {
    const same = this.design.parts.filter((x) => x.kind === p.kind).sort((a, b) => a.top - b.top);
    const other = same[same.indexOf(p) + dir];
    if (!other) return;
    this.change(() => {
      const inside = this.cutBand(p);
      // After closing up, the other part's top is where this one goes (above it) or its bottom (below it).
      this.insertBand(p, dir < 0 ? other.top : other.top + other.height, inside);
    });
  }

  /** A part's new height: what is below it moves with its bottom edge. */
  private resizePart(p: LayoutPart, height: number): void {
    const next = Math.max(0, Math.round(height));
    const delta = next - p.height;
    if (!delta) return;
    this.change(() => {
      const bottom = p.top + p.height;
      for (const x of this.design.parts) if (x !== p && x.top >= bottom) x.top += delta;
      for (const o of this.design.objects) if (o.bounds.top >= bottom) shift(o, 0, delta);
      p.height = next;
    });
  }

  /** Fields of the layout's table occurrence, for a sub-summary's "when sorted by". */
  private layoutFields(): { name: string; ref: LayoutPart['breakField'] & {} }[] {
    const to = this.studio.design.tableOccurrences.find((t) => t.id === this.design.tableOccurrenceId);
    const table = this.studio.design.tables.find((t) => t.id === to?.baseTableId);
    return to && table ? table.fields.filter((f) => f.kind !== 'summary' && f.type !== 'container')
      .map((f) => ({ name: f.name, ref: { tableOccurrenceId: to.id, fieldId: f.id, tableOccurrence: to.name, field: f.name } })) : [];
  }

  /** A part in the layout inspector: its height, fill, a sub-summary's field, and Remove. */
  private partRow(p: LayoutPart): HTMLElement {
    const sub = p.kind.startsWith('sub-summary');
    const fill = p.style.rules?.find((r) => r.part === 1 && r.state === 1)?.css['background-color'];
    const on = check('fill', !!fill);
    const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(fill ?? '') ? fill! : '#eef2f7', 'aria-label': `${p.kind} fill color` });
    const setFill = (v: string | undefined) => this.change(() => {
      const rules = (p.style.rules ??= []);
      let r = rules.find((x) => x.part === 1 && x.state === 1);
      if (!r) rules.push((r = { part: 1, state: 1, css: {} }));
      if (v) r.css['background-color'] = v;
      else delete r.css['background-color'];
    });
    on.input.addEventListener('change', () => setFill(on.input.checked ? pick.value : undefined));
    pick.addEventListener('change', () => setFill(pick.value));
    const partName = (k: string) => (k === 'sub-summary-leading' ? 'sub-summary above' : k === 'sub-summary-trailing' ? 'sub-summary below' : k.replace(/-/g, ' '));
    // Part Definition's type: kinds that can appear again, and this one.
    const kinds = PART_KINDS.filter(([k]) => k === p.kind || k.startsWith('sub-summary') || !this.design.parts.some((x) => x.kind === k));
    const type = select(kinds.map(([k]) => [k, partName(k)] as [string, string]), p.kind, { 'aria-label': 'Part type', class: 'le-part-type' });
    type.addEventListener('change', () => this.retype(p, type.value));
    const height = h('input', { type: 'number', min: '0', value: String(p.height), class: 'd-narrow', 'aria-label': `${partName(p.kind)} height` });
    height.addEventListener('change', () => this.resizePart(p, Number(height.value) || 0));
    const same = this.design.parts.filter((x) => x.kind === p.kind).sort((a, b) => a.top - b.top);
    const at = same.indexOf(p);
    const row = h('div', { class: 'le-part-row' },
      h('div', { class: 'd-row' }, type, height, h('span', { class: 'd-muted' }, 'pt')),
      h('div', { class: 'd-row' }, on.el, pick, h('span', { class: 'd-spacer' }),
        ...(sub && same.length > 1 ? [
          button('↑', () => this.reorder(p, -1), { class: 'quiet', title: 'Move above the sub-summary before it (groups it more widely)', ...(at === 0 ? { disabled: '' } : {}) }),
          button('↓', () => this.reorder(p, 1), { class: 'quiet', title: 'Move below the sub-summary after it', ...(at === same.length - 1 ? { disabled: '' } : {}) }),
        ] : []),
        button('Remove', () => this.removePart(p), { class: 'quiet', title: 'Remove part (its objects too)' })));
    if (sub) {
      const fields = this.layoutFields();
      const current = p.breakField ? `${p.breakField.tableOccurrenceId}:${p.breakField.fieldId}` : '';
      const opts: [string, string][] = fields.map((f) => [`${f.ref.tableOccurrenceId}:${f.ref.fieldId}`, f.name]);
      if (current && !opts.some(([v]) => v === current)) opts.unshift([current, p.breakField!.field ?? '?']);
      const by = select(opts, current, { 'aria-label': 'When sorted by' });
      by.addEventListener('change', () => this.change(() => {
        p.breakField = fields.find((f) => `${f.ref.tableOccurrenceId}:${f.ref.fieldId}` === by.value)?.ref ?? p.breakField;
      }));
      row.append(h('div', { class: 'd-row' }, h('span', { class: 'd-muted' }, 'when sorted by'), by));
    }
    row.append(this.partOptions(p));
    return row;
  }

  /** Part Definition's printing options, used by Preview mode and printing. */
  private partOptions(p: LayoutPart): HTMLElement {
    const o = p.options ?? {};
    const set = (fn: (x: NonNullable<LayoutPart['options']>) => void) => this.change(() => {
      const next = { ...(p.options ?? {}) };
      fn(next);
      if (Object.values(next).some((v) => v !== undefined && v !== false)) p.options = next;
      else delete p.options;
    });
    const before = check('New page before each', !!o.pageBreakBefore);
    before.input.addEventListener('change', () => set((x) => (before.input.checked ? (x.pageBreakBefore = true) : delete x.pageBreakBefore)));
    const every = h('input', { type: 'number', min: '1', value: o.pageBreakEvery ? String(o.pageBreakEvery) : '', placeholder: '–', class: 'd-narrow', 'aria-label': 'New page after every' });
    every.addEventListener('change', () => set((x) => {
      const n = Math.floor(Number(every.value));
      if (n >= 1) x.pageBreakEvery = n;
      else delete x.pageBreakEvery;
    }));
    const restart = check('Restart page numbers after each', !!o.restartPageNumbers);
    restart.input.addEventListener('change', () => set((x) => (restart.input.checked ? (x.restartPageNumbers = true) : delete x.restartPageNumbers)));
    const details = h('details', { class: 'le-part-options' }, h('summary', {}, p.options ? 'Printing (set)' : 'Printing'),
      before.el,
      h('label', { class: 'd-row' }, 'New page after every', every, 'occurrences'),
      restart.el);
    if (p.options) details.open = true;
    return details;
  }

  private removePart(p: LayoutPart): void {
    const inside = this.design.objects.filter((o) => o.bounds.top >= p.top && o.bounds.top < p.top + p.height);
    if (inside.length && !confirm(`Remove the ${p.kind} part and its ${inside.length} objects?`)) return;
    this.change(() => void this.cutBand(p));
  }
}

/** A style's rules with an object's own on top, per part and state. */
function mergeRules(base: StyleRule[], over: StyleRule[]): StyleRule[] {
  const out = structuredClone(base);
  for (const r of over) {
    const hit = out.find((x) => x.part === r.part && x.state === r.state);
    if (hit) hit.css = { ...hit.css, ...r.css };
    else out.push(structuredClone(r));
  }
  return out;
}

/** A CSS color as #rrggbb for a color input ("rgb(r g b / a)", "#rgb" or "#rrggbb"); black if it can't be read. */
function toHex(css: string): string {
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(css);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join('')}`;
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(css);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() : '#000000';
}
