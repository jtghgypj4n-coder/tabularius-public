// Layout objects on FileMaker's clipboard: <fmxmlsnippet type="LayoutObjectList">,
// what FileMaker Pro copies in Layout mode, read into Tabularius layout objects
// and written back out, so objects move between FileMaker and Tabularius both ways.
//
// The grammar follows Andrew Kear's round-trip tested specification
// (github.com/andykear/FileMaker-XMLsnippet-Layout-Claude-Skill, CC BY 4.0)
// and FileMaker's own Save as XML layouts, which use the same elements.
//
// Positions: Tabularius keeps every object's bounds on the layout. On the
// clipboard, objects inside a portal, tab or slide panel and button bar
// segments are relative to their container, while popovers and grouped
// objects keep layout positions (Kear §5.7, §9, §11-§14). Save as XML writes
// layout positions throughout.

import { ROTATABLE_KINDS, quarterTurn, scriptStepName, webViewerFlags, webViewerOptions, STYLE_PARTS, STYLE_STATES, type LayoutObject, type ObjectKind, type Schema, type ScriptStep, type StyleRule, type Theme, type FieldDisplay, type FieldBehavior, CONTAINER_FORMAT_CODES, type ContainerFormat } from '../../fmp12/src/index.ts';
import { calcOf, kid, kids, parseXml, stepSpec, text, type StepContext, type XmlElement } from './snippet.ts';
import { cdata, calc, el, esc, stepXml, wrap } from './snippet-xml.ts';
import { DesignError } from './design.ts';

// ---------------------------------------------------------------- shared tables

/** Object type on the clipboard -> kind and FileMaker's object type number. */
const KINDS: Record<string, [ObjectKind, number]> = {
  field: ['field', 1], text: ['text', 2], graphic: ['graphic', 3], line: ['line', 4], rect: ['rectangle', 5], rrect: ['rounded-rectangle', 6],
  roundrect: ['rounded-rectangle', 6], oval: ['oval', 7], group: ['group', 8], groupbutton: ['group', 8], portal: ['portal', 9], button: ['button', 10],
  tabcontrol: ['tab-control', 11], tabpanel: ['tab-panel', 12], externalobject: ['web-viewer', 13], popoverbutton: ['popover-button', 14],
  popover: ['popover', 15], slidecontrol: ['slide-control', 16], slidepanel: ['slide-panel', 17], buttonbar: ['button-bar', 18],
};
const TYPES: Partial<Record<ObjectKind, string>> = {
  field: 'Field', text: 'Text', line: 'Line', rectangle: 'Rect', 'rounded-rectangle': 'RRect', oval: 'Oval', portal: 'Portal', button: 'Button',
  'tab-control': 'TabControl', 'tab-panel': 'TabPanel', 'web-viewer': 'ExternalObject', 'popover-button': 'PopoverButton', popover: 'Popover',
  'slide-control': 'SlideControl', 'slide-panel': 'SlidePanel', 'button-bar': 'ButtonBar',
};
const SHAPES = new Set<ObjectKind>(['line', 'rectangle', 'rounded-rectangle', 'oval']);
const DISPLAYS: Record<number, FieldDisplay> = { 0: 'edit', 1: 'dropdown', 2: 'popup', 3: 'checkbox', 4: 'radio', 6: 'calendar' };
/** Theme element of each kind of object (field controls by their display). */
const ELEMENTS: Partial<Record<ObjectKind, number>> = {
  line: 50, rectangle: 51, 'rounded-rectangle': 52, oval: 53, text: 70, 'button-bar': 78, button: 80, 'tab-control': 81, 'tab-panel': 82,
  portal: 83, graphic: 84, 'web-viewer': 86, chart: 85, group: 87, popover: 89, 'slide-control': 91, 'slide-panel': 92, 'popover-button': 80,
};
const FIELD_ELEMENTS: Record<FieldDisplay, number> = { edit: 61, dropdown: 62, popup: 63, checkbox: 64, radio: 65, calendar: 66 };
const TRIGGER_IDS: Record<string, number> = {
  OnObjectEnter: 1, OnObjectExit: 2, OnObjectModify: 3, OnObjectSave: 4, OnObjectKeystroke: 5, OnObjectValidate: 6, OnPanelSwitch: 7, OnObjectAVPlayerChange: 8,
};
const PART_IDS = Object.fromEntries(Object.entries(STYLE_PARTS).map(([k, v]) => [v, +k])) as Record<string, number>;
const STATE_IDS = Object.fromEntries(Object.entries(STYLE_STATES).map(([k, v]) => [v, +k])) as Record<string, number>;
const V_ALIGN: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

/** Objects whose children sit relative to them on the clipboard; the rest use layout positions. */
const RELATIVE = new Set<ObjectKind>(['portal', 'tab-control', 'tab-panel', 'slide-control', 'slide-panel', 'button-bar']);
/** Portal rows start inside the portal's 1pt border, as in the file itself. */
const inset = (k: ObjectKind) => (k === 'portal' ? 1 : 0);

const lower = (s: string) => s.toLowerCase();
const num = (v: string | undefined, d = 0) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);
const bit = (flags: number, n: number) => Math.floor((flags >>> 0) / 2 ** n) % 2 === 1;
/** The text of a formula that is only a quoted string ("Home"), else undefined. */
const literal = (formula: string) => (/^"(?:[^"\\]|\\.)*"$/s.test(formula.trim()) ? formula.trim().slice(1, -1).replace(/\\(.)/gs, '$1') : undefined);
const quote = (s: string) => `"${s.replace(/[\\"]/g, '\\$&')}"`;
const round = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- CSS

function color(v: string): string | undefined {
  const m = /^rgba?\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v.trim());
  if (!m) return /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : undefined;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.round((+x / 100) * 255));
  const a = m[4] === undefined ? 1 : round(+m[4]);
  return a >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`;
}
const len = (v: string) => v.trim().split(/\s+/).map((x) => x.replace(/^(-?[\d.]+)pt$/, '$1px')).join(' ');

/** One FileMaker CSS declaration as Tabularius's, or undefined for properties Tabularius doesn't draw. */
function declaration(prop: string, value: string): [string, string] | undefined {
  const v = value.trim();
  if (/^border-(top|right|bottom|left)-color$/.test(prop) || prop === 'background-color' || prop === 'color') {
    const c = color(v);
    return c ? [prop, c] : undefined;
  }
  if (/^border-(top|right|bottom|left)-style$/.test(prop) || prop === 'text-align' || prop === 'font-weight' || prop === 'font-style') return [prop, v];
  if (/^border-(top|right|bottom|left)-width$/.test(prop) || /^(padding|margin)-(top|right|bottom|left)$/.test(prop) || prop === 'font-size' || prop === 'line-height') return [prop, len(v)];
  if (/^border-(top|bottom)-(left|right)-radius$/.test(prop)) {
    const [a, b] = len(v).split(' ');
    return [prop, b === undefined || a === b ? a : `${a} ${b}`];
  }
  if (prop === 'background-image') return v === 'none' ? [prop, 'none'] : undefined;
  if (prop === 'font-family') return [prop, v];
  if (prop === 'box-shadow') {
    const out = v.replace(/rgba?\([^)]*\)/g, (c) => color(c) ?? c);
    return [prop, len(out)];
  }
  if (prop === 'text-decoration' || prop === 'text-decoration-line') return ['text-decoration-line', v];
  if (prop === '-fm-icon-color') {
    const c = color(v);
    return c ? ['--fm-icon-color', c] : undefined;
  }
  if (prop === '-fm-portal-alt-background' || prop === '-fm-use-portal-current-row-style') return v === 'false' ? [prop, 'false'] : undefined;
  if (prop === '-fm-text-vertical-align') return V_ALIGN[v] ? ['--fm-vertical-align', V_ALIGN[v]] : undefined;
  return undefined;
}

/**
 * The snippet's `rotation` attribute is taken to be degrees clockwise, the direction Arrange > Rotate turns (Claris help:
 * "rotate 90 degrees clockwise"); the help does not say how the attribute counts. 1 here; -1 if a copied object from
 * FileMaker shows it counts the other way (the tests pin the choice).
 */
export const SNIPPET_ROTATION_SIGN: 1 | -1 = 1;

/** FileMaker's LocalCSS ("self:normal .self { color: ...; }" blocks) as style rules. */
export function cssRules(css: string | undefined): StyleRule[] {
  const rules: StyleRule[] = [];
  for (const m of (css ?? '').matchAll(/self:([a-z]+)\s+\.([a-z_]+)\s*\{([^}]*)\}/g)) {
    const state = STATE_IDS[m[1]];
    const part = PART_IDS[m[2]];
    if (state === undefined || part === undefined) continue;
    const out: Record<string, string> = {};
    for (const d of m[3].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const kv = declaration(d.slice(0, i).trim(), d.slice(i + 1));
      if (kv) out[kv[0]] = kv[1];
    }
    if (!Object.keys(out).length) continue;
    const same = rules.find((r) => r.part === part && r.state === state);
    if (same) Object.assign(same.css, out);
    else rules.push({ part, state, css: out });
  }
  return rules;
}

const fmColor = (v: string) => v.replace(/rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)/g, (_m, r: string, g: string, b: string, a?: string) =>
  `rgba(${[r, g, b].map((x) => `${round((+x / 255) * 100)}%`).join(',')},${a ?? 1})`);

/** Tabularius's CSS value as FileMaker writes it, or undefined when FileMaker's CSS has no form for it. */
function fmValue(prop: string, v: string): string | undefined {
  if (prop === '--fm-vertical-align') return Object.entries(V_ALIGN).find(([, x]) => x === v)?.[0];
  if (prop === 'background-image' && v !== 'none') return undefined;
  return fmColor(v).split(' ').map((x) => x.replace(/^(-?[\d.]+)px$/, '$1pt')).join(' ');
}

/**
 * Style rules as FileMaker's LocalCSS. Gradients, and parts and states
 * Tabularius has no FileMaker selector for, are left out (`dropped` counts them).
 */
export function localCss(rules: StyleRule[] | undefined, dropped = { count: 0 }): string {
  const blocks: string[] = [];
  for (const r of rules ?? []) {
    const part = STYLE_PARTS[r.part];
    const state = STYLE_STATES[r.state];
    if (!part || !state) {
      dropped.count += Object.keys(r.css).length;
      continue;
    }
    const lines: string[] = [];
    for (const [k, v] of Object.entries(r.css)) {
      const prop = k === '--fm-icon-color' ? '-fm-icon-color' : k === '--fm-vertical-align' ? '-fm-text-vertical-align' : k.startsWith('--') ? undefined : k;
      const value = prop && fmValue(k, v);
      if (prop && value !== undefined) lines.push(`\t${prop}: ${value};`);
      else dropped.count++;
    }
    if (lines.length) blocks.push(`self:${state} .${part}\n{\n${lines.join('\n')}\n}\n`);
  }
  return blocks.join('');
}

// ---------------------------------------------------------------- reading

export interface LayoutPasteOptions {
  /** The theme of the layout the objects go onto: named styles bind only to its styles. */
  theme?: Theme;
  /** Styles of that theme by the name FileMaker shows (from objects that use them), for styles copied by that name. */
  styleNames?: Map<string, string>;
  /** Save as XML (layout positions everywhere) rather than the clipboard. */
  positions?: 'clipboard' | 'layout';
  /** Ids for the new objects start here (default 1). */
  firstId?: number;
}

export interface LayoutPaste {
  objects: LayoutObject[];
  summary: string[];
  notes: string[];
}

/** True when the XML is layout objects copied in FileMaker's Layout mode. */
export const isLayoutSnippet = (xml: string) => /<fmxmlsnippet[^>]*type\s*=\s*["']LayoutObjectList["']/.test(xml);

/** Layout objects from FileMaker's clipboard XML, positioned on the layout. */
export function layoutObjectsFromSnippet(xml: string, schema: Schema, opts: LayoutPasteOptions = {}): LayoutPaste {
  const root = parseXml(xml);
  const snip = kids(root).find((e) => e.name === 'fmxmlsnippet');
  if (!snip || snip.attrs.type !== 'LayoutObjectList') throw new DesignError(960, 'This isn\'t layout objects copied from FileMaker (fmxmlsnippet type="LayoutObjectList")');
  const holder = kid(snip, 'Layout') ?? snip;
  return layoutObjectsFrom(kids(holder, 'Object'), schema, opts);
}

/** Layout objects from <Object> elements (the clipboard's, or a Save as XML layout's). */
export function layoutObjectsFrom(elements: XmlElement[], schema: Schema, opts: LayoutPasteOptions = {}): LayoutPaste {
  const notes = new Set<string>();
  const ctx: StepContext = { schema, notes: [], scripts: new Map() };
  let next = opts.firstId ?? 1;
  const keys = new Map<string, number>();
  const pending: (() => void)[] = [];
  const counts = new Map<string, number>();

  const toByName = (name: string | undefined) => (name ? schema.tableOccurrences.find((t) => lower(t.name) === lower(name)) : undefined);
  const fieldOf = (full: string | undefined, what: string, ddr?: XmlElement) => {
    const [toName, fName] = (full ?? '').includes('::') ? (full ?? '').split('::') : ['', full ?? ''];
    const to = toByName(toName);
    const table = to && schema.tables.find((t) => t.id === to.baseTableId);
    const f = table?.fields.find((x) => lower(x.name) === lower(fName));
    // Fields of another file's tables aren't listed here: keep the copied field's id.
    const external = !f && to?.dataSourceId ? num(ddr?.attrs.id) : 0;
    if (!f && !external) notes.add(`${what}: the field ${full} isn't in this file`);
    const out = { tableOccurrenceId: to?.id ?? 0, fieldId: f?.id ?? external, field: f?.name ?? fName } as { tableOccurrenceId: number; fieldId: number; tableOccurrence?: string; field?: string };
    if (to?.name ?? toName) out.tableOccurrence = to?.name ?? toName;
    if (!out.field) delete out.field;
    return out;
  };
  const valueList = (name: string | undefined, what: string) => {
    if (!name) return undefined;
    const vl = schema.valueLists.find((v) => lower(v.name) === lower(name));
    if (!vl) notes.add(`${what}: the value list "${name}" isn't in this file`);
    return vl;
  };
  const scriptRef = (s: XmlElement | undefined, what: string) => {
    if (!s) return undefined;
    const name = s.attrs.name ?? '';
    const hit = schema.scripts.find((x) => lower(x.name) === lower(name)) ?? (name === '<unknown>' ? undefined : undefined);
    if (!hit) notes.add(`${what}: the script "${name}" isn't in this file`);
    return { id: hit?.id ?? 0, name: hit?.name ?? name };
  };

  const styleOf = (styles: XmlElement | undefined, kind: ObjectKind, element: number | undefined) => {
    const style: LayoutObject['style'] = {};
    if (element !== undefined) style.element = element;
    const rules = cssRules(text(kid(styles, 'LocalCSS')));
    if (rules.length) style.rules = rules;
    const named = text(kid(kid(styles, 'CustomStyles'), 'Name'))?.trim();
    if (named) {
      const hit = opts.theme?.styles.find((s) => s.name === named || lower(s.name) === lower(named))?.name ?? opts.styleNames?.get(named);
      if (hit) {
        style.name = hit;
        if (hit !== named) style.displayName = named;
      }
      else if (opts.theme) notes.add(`The style "${named}" isn't in this layout's theme: those objects use the theme's look`);
      else style.name = named;
    }
    void kind;
    return style;
  };

  const textOf = (t: XmlElement | undefined) => {
    const runs = kids(kid(t, 'CharacterStyleVector'), 'Style').map((s) => text(kid(s, 'Data')) ?? '');
    return runs.join('') || undefined;
  };

  const action = (stepEl: XmlElement | undefined, what: string): LayoutObject['action'] | undefined => {
    if (!stepEl) return undefined;
    ctx.notes = [];
    const spec = stepSpec(stepEl, ctx);
    for (const n of ctx.notes) notes.add(`${what}: ${n}`);
    if (!spec.stepId || spec.enabled === false && spec.stepId === 89) return undefined;
    const a: NonNullable<LayoutObject['action']> = { stepId: spec.stepId, step: scriptStepName(spec.stepId) };
    const p = spec.params;
    if (spec.stepId === 1 && p?.script) {
      a.scriptId = p.script.id;
      a.param = p.script.id;
      a.script = p.script.name;
      if (p.parameter !== undefined) a.parameter = p.parameter;
    } else if (spec.stepId === 6 && p?.layout && p.layoutDestination === 'named') {
      a.layoutId = p.layout.id;
      a.param = p.layout.id;
      a.layout = p.layout.name;
    } else if (p && Object.keys(p).length) a.params = p;
    return a;
  };

  /** The <Object> children of an object: inside its typed element (PortalObj, TabPanelObj, ...) or directly in it. */
  const childElements = (o: XmlElement) => [
    ...kids(o, 'Object'),
    ...kids(o).filter((e) => e.name.endsWith('Obj')).flatMap((e) => kids(e, 'Object')),
  ];

  const read = (o: XmlElement, origin: { top: number; left: number }, parentKind?: ObjectKind): LayoutObject | undefined => {
    const typeName = lower((o.attrs.type ?? '').replace(/\s+/g, ''));
    let [kind, type] = KINDS[typeName] ?? ['unknown' as ObjectKind, 0];
    const label = o.attrs.type ?? 'object';
    if (kind === 'unknown') {
      notes.add(`${label} objects aren't something Tabularius draws: left out`);
      return undefined;
    }
    const ext = kid(o, 'ExternalObj');
    if (kind === 'web-viewer' && ext?.attrs.typeID && ext.attrs.typeID !== 'WEBV') {
      notes.add(ext.attrs.typeID === 'CHRT' ? 'Charts keep their setup in binary data the clipboard doesn\'t carry: left out' : `${ext.attrs.typeID} objects: left out`);
      return undefined;
    }
    if (kind === 'graphic') {
      notes.add('Pictures on a layout don\'t travel on the clipboard as XML: left out');
      return undefined;
    }
    const b = kid(o, 'Bounds')?.attrs ?? {};
    const bounds = { top: round(num(b.top) + origin.top), left: round(num(b.left) + origin.left), bottom: round(num(b.bottom) + origin.top), right: round(num(b.right) + origin.left) };
    const flags = num(o.attrs.flags);
    const id = next++;
    if (o.attrs.key) keys.set(o.attrs.key, id);
    // Anchors: left and top are stored inverted, right and bottom direct (Kear §2.2).
    const obj: LayoutObject = { id, kind, type, bounds, anchors: { left: !bit(flags, 28), top: !bit(flags, 29), right: bit(flags, 30), bottom: bit(flags, 31) }, style: {} };
    if (o.attrs.name) obj.name = o.attrs.name;
    const turn = num(o.attrs.rotation);
    if (turn) {
      const quarter = quarterTurn(SNIPPET_ROTATION_SIGN * turn);
      if (!quarter) notes.add(`${label} rotated ${turn}°: only turns of 90, 180 and 270 degrees are drawn, so it stays upright`);
      else if (!ROTATABLE_KINDS.has(kind)) notes.add(`${label} objects can't be rotated: it stays upright`);
      else obj.rotation = quarter;
    }
    if (bit(flags, 9)) obj.hideWhenPrinting = true;
    // Locked, and Sliding & Visibility: bits 1, 4 (up), 5 (left) and 6 (resize the part), as in the file.
    if (bit(flags, 1)) obj.locked = true;
    if (bit(flags, 4) || bit(flags, 5)) obj.sliding = { ...(bit(flags, 4) ? { up: true as const } : {}), ...(bit(flags, 5) ? { left: true as const } : {}), ...(bit(flags, 6) ? { resizePart: true as const } : {}) };
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const where = `${label}${o.attrs.name ? ` "${o.attrs.name}"` : ''}`;

    const inner = kids(o).find((e) => e.name.endsWith('Obj') && e.name !== 'TextObj') ?? kid(o, 'TextObj');
    const textObj = kid(o, 'TextObj');
    let styles = kid(inner, 'Styles') ?? kid(textObj, 'Styles') ?? kid(o, 'Styles');
    let element = ELEMENTS[kind];
    if (parentKind === 'button-bar' && kind === 'button') element = 79;

    if (kind === 'field') {
      const fo = kid(o, 'FieldObj');
      const display = DISPLAYS[num(fo?.attrs.displayType)] ?? 'edit';
      element = FIELD_ELEMENTS[display];
      styles = kid(fo, 'Styles');
      const ref = fieldOf(text(kid(fo, 'Name')), 'A field', kid(kid(fo, 'DDRInfo'), 'Field'));
      const field: NonNullable<LayoutObject['field']> = { ...ref, display, repetitions: Math.max(1, num(fo?.attrs.numOfReps, 1)) };
      const vl = valueList(text(kid(fo, 'ValueList')), `The field ${ref.tableOccurrence}::${ref.field}`);
      if (vl) {
        field.valueListId = vl.id;
        field.valueList = vl.name;
      }
      const behavior = fieldBehavior(num(fo?.attrs.flags));
      if (behavior) field.behavior = behavior;
      const pict = (Object.entries(CONTAINER_FORMAT_CODES) as [ContainerFormat, number][]).find(([, n]) => n === num(fo?.attrs.pictFormat, 5))?.[0];
      if (pict) field.format = { ...field.format, container: pict };
      obj.field = field;
      const ph = calcOf(kid(fo, 'PlaceholderText'));
      if (ph) obj.placeholder = ph;
    } else if (kind === 'text') {
      const t = textOf(textObj);
      if (t !== undefined) obj.text = t;
    } else if (kind === 'button' || kind === 'popover-button') {
      const t = textOf(textObj);
      const labelCalc = calcOf(kid(o, 'LabelCalc'));
      if (labelCalc !== undefined) obj.label = labelCalc;
      // Segments show their label calculation; other buttons their text (Kear §9.1, §19).
      const lit = labelCalc !== undefined && parentKind === 'button-bar' ? literal(labelCalc) : undefined;
      if (lit) obj.text = lit;
      else if (t !== undefined) obj.text = t;
      const a = action(kid(kid(o, 'ButtonObj'), 'Step'), where);
      if (a) obj.action = a;
    } else if (kind === 'group') {
      const a = action(kid(kid(o, 'GroupButtonObj'), 'Step'), where);
      if (a) obj.action = a;
    } else if (kind === 'portal') {
      const po = kid(o, 'PortalObj');
      const pflags = num(po?.attrs.portalFlags);
      const toName = text(kid(po, 'TableAliasKey'))?.trim();
      const to = toByName(toName);
      if (!to) notes.add(`A portal: the table occurrence "${toName}" isn't in this file`);
      const portal: NonNullable<LayoutObject['portal']> = { tableOccurrenceId: to?.id ?? 0, rows: Math.max(1, num(po?.attrs.numOfRows, 1)), initialRow: num(po?.attrs.initialRow, 1) };
      if (to?.name ?? toName) portal.tableOccurrence = to?.name ?? toName;
      if (pflags & 8) {
        const sort = kids(kid(po, 'SortList'), 'Sort').map((s) => {
          const f = fieldOf(text(kid(s, 'Name')), 'A portal\'s sort');
          const out: NonNullable<NonNullable<LayoutObject['portal']>['sort']>[number] = { field: f };
          if (s.attrs.type === 'Descending') out.descending = true;
          const custom = s.attrs.type === 'Custom' ? valueList(text(kid(s, 'ValueList')), 'A portal\'s sort') : undefined;
          if (custom) {
            out.valueListId = custom.id;
            out.valueList = custom.name;
          }
          return out;
        });
        if (sort.length) portal.sort = sort;
      }
      const filter = pflags & 128 ? calcOf(kid(po, 'FilterCalc')) : undefined;
      if (filter) portal.filter = filter;
      if (pflags & 1) portal.scrolling = true;
      if (pflags & 1 && pflags & 256) portal.scrollBarWhenScrolling = true;
      if (pflags & 4) portal.allowDelete = true;
      obj.portal = portal;
    } else if (kind === 'tab-control') {
      const tc = kid(o, 'TabControlObj');
      const h = num(tc?.attrs.tabHeight);
      if (h) obj.tabHeight = h;
      const front = tc?.attrs.defaultVisPanelKey;
      if (front) pending.push(() => {
        const t = keys.get(front);
        if (t !== undefined) obj.target = t;
      });
    } else if (kind === 'tab-panel' || kind === 'popover') {
      const title = calcOf(kid(o, 'TitleCalc'));
      if (title !== undefined) {
        const lit = literal(title);
        // A popover keeps a calculated title as its label; a tab shows its title as text.
        if (lit === undefined && kind === 'popover') obj.label = title;
        else {
          if (lit === undefined) notes.add(`A tab title is a calculation (${title}): pasted as its text`);
          obj.text = lit ?? title;
        }
      }
      const tp = kid(o, 'TabPanelObj');
      if (tp) obj.tab = { left: num(tp.attrs.tabLeftEdge), width: num(tp.attrs.tabWidth) };
    } else if (kind === 'slide-control') {
      const slide = num(kid(o, 'SlideControlObj')?.attrs.slideFlagSet);
      if (slide & 1) obj.noDots = true;
      if (slide & 2) obj.noSwipe = true;
    } else if (kind === 'button-bar') {
      const seg = kid(o, 'ButtonBarObj')?.attrs.segmentKey;
      if (seg && seg !== '0') pending.push(() => {
        const t = keys.get(seg);
        if (t !== undefined) obj.activeSegment = t;
      });
      styles = kid(o, 'Styles') ?? kid(inner, 'Styles');
    } else if (kind === 'web-viewer') {
      obj.external = 'WEBV';
      const url = kids(ext, 'Calculation').find((c) => (c.attrs.index ?? '0') === '0') ?? kid(kid(ext, 'WebViewer'), 'Calculation');
      const formula = text(url);
      if (formula && formula !== '""') obj.webUrl = formula;
      const flags = ext?.attrs.externalFlagSet;
      if (flags !== undefined && /^\d+$/.test(flags)) obj.webOptions = webViewerOptions(Number(flags));
    } else if (SHAPES.has(kind)) {
      styles = kid(o, 'Styles');
    }
    if (kind === 'popover-button') {
      pending.push(() => {
        const pop = obj.children?.find((c) => c.kind === 'popover');
        if (pop) obj.target = pop.id;
      });
    }
    if (kind === 'slide-control' || kind === 'tab-control') styles = kid(inner, 'Styles') ?? kid(o, 'Styles');
    obj.style = styleOf(styles, kind, element);

    const tip = calcOf(kid(o, 'ToolTip'));
    if (tip) obj.tooltip = tip;
    const hide = kid(o, 'HideCondition');
    const hideCalc = calcOf(hide);
    if (hideCalc) obj.hide = { formula: hideCalc, inFind: hide?.attrs.findMode === 'True' };
    const conditions = kids(kid(o, 'ConditionalFormatting'), 'Item').flatMap((item) => {
      const formula = calcOf(kid(item, 'Condition'));
      if (!formula || !(num(item.attrs.flags) & 1)) return [];
      return [{ formula, rules: cssRules(text(kid(kid(kid(item, 'Format'), 'Styles'), 'LocalCSS'))) }];
    });
    if (conditions.length) obj.conditions = conditions;
    const triggers = kids(kid(o, 'ScriptTriggers'), 'Trigger').map((t) => {
      const s = scriptRef(kid(t, 'Script'), `${where}'s ${t.attrs.event} trigger`);
      const tf = num(t.attrs.triggerFlags, 1);
      const modes = (['browse', 'find', 'preview'] as const).filter((_, i) => tf & (1 << i));
      const out: NonNullable<LayoutObject['triggers']>[number] = { event: t.attrs.event ?? '', scriptId: s?.id ?? 0, ...(s?.name ? { script: s.name } : {}) };
      const param = calcOf(t);
      if (param) out.parameter = param;
      if (modes.length && !(modes.length === 1 && modes[0] === 'browse')) out.modes = [...modes];
      return out;
    });
    if (triggers.length) obj.triggers = triggers;

    const childEls = childElements(o);
    if (childEls.length) {
      const rel = { top: bounds.top + inset(kind), left: bounds.left + inset(kind) };
      const relative = opts.positions === 'layout' ? false : choosePositions(kind, bounds, childEls, rel);
      const children = childEls.map((c) => read(c, relative ? rel : { top: 0, left: 0 }, kind)).filter((c): c is LayoutObject => !!c);
      if (children.length) obj.children = children;
    }
    if (kind === 'portal' || kind === 'tab-panel' || kind === 'slide-panel' || kind === 'tab-control' || kind === 'slide-control' || kind === 'button-bar' || kind === 'popover') obj.children ??= [];
    return obj;
  };

  const objects = elements.map((e) => read(e, { top: 0, left: 0 })).filter((o): o is LayoutObject => !!o);
  for (const p of pending) p();
  const summary = counts.size ? [plural(objects.length, 'layout object')] : [];
  return { objects, summary, notes: [...notes] };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Whether a container's children are relative to it. The clipboard makes
 * portal, panel and button bar contents relative and keeps popovers and
 * groups on the layout; when the children only fit inside the container
 * read the other way, that way wins.
 */
function choosePositions(kind: ObjectKind, bounds: LayoutObject['bounds'], els: XmlElement[], rel: { top: number; left: number }): boolean {
  const fits = (origin: { top: number; left: number }) => els.every((e) => {
    const b = kid(e, 'Bounds')?.attrs ?? {};
    const top = num(b.top) + origin.top;
    const left = num(b.left) + origin.left;
    const slack = 2;
    // Header rows of a portal sit just above it; a popover is beside its button.
    return top >= bounds.top - 40 && left >= bounds.left - slack && num(b.right) + origin.left <= bounds.right + slack && num(b.bottom) + origin.top <= bounds.bottom + 40;
  });
  const want = RELATIVE.has(kind);
  if (kind === 'popover-button') return false;
  const relFits = fits(rel);
  const absFits = fits({ top: 0, left: 0 });
  if (want) return relFits || !absFits;
  return !absFits && relFits;
}

/** Field Behavior from FieldObj flags (the same bits as the file's own). */
function fieldBehavior(flags: number): FieldBehavior | undefined {
  const entry = (low: number, high: number) => (bit(flags, low) && bit(flags, high) ? 'calculation' : bit(flags, high) ? 'select' : bit(flags, low) ? 'view' : undefined);
  const out: FieldBehavior = {};
  const browse = entry(2, 24);
  if (browse) out.browse = browse;
  const find = entry(4, 25);
  if (find) out.find = find;
  if (bit(flags, 1)) out.selectOnEntry = true;
  if (!bit(flags, 5)) out.noTab = true;
  if (bit(flags, 15)) out.quickFindOff = true;
  if (bit(flags, 11)) out.autoComplete = true;
  if (bit(flags, 10) && bit(flags, 19)) out.calendarIcon = true;
  if (bit(flags, 0)) out.otherValue = true;
  if (bit(flags, 21)) out.concealed = true;
  if (bit(flags, 8)) out.scrollBar = true;
  if (bit(flags, 6)) out.returnKey = true;
  if (bit(flags, 7)) out.enterKey = true;
  return Object.keys(out).length ? out : undefined;
}

function behaviorFlags(b: FieldBehavior | undefined): number {
  let f = b?.noTab ? 0 : 32;
  const set = (n: number) => (f += 2 ** n);
  const entry = (e: FieldBehavior['browse'], low: number, high: number) => {
    if (e === 'view' || e === 'calculation') set(low);
    if (e === 'select' || e === 'calculation') set(high);
  };
  entry(b?.browse, 2, 24);
  entry(b?.find, 4, 25);
  if (b?.selectOnEntry) set(1);
  if (b?.quickFindOff) set(15);
  if (b?.autoComplete) set(11);
  if (b?.calendarIcon) {
    set(10);
    set(19);
  }
  if (b?.otherValue) set(0);
  if (b?.concealed) set(21);
  if (b?.scrollBar) set(8);
  if (b?.returnKey) set(6);
  if (b?.enterKey) set(7);
  return f;
}

// ---------------------------------------------------------------- writing

export interface LayoutCopyOptions {
  /** The theme of the layout the objects come from. FileMaker binds styles through it. */
  theme?: Theme;
}

const DISPLAY_TYPES: Record<FieldDisplay, number> = { edit: 0, dropdown: 1, popup: 2, checkbox: 3, radio: 4, calendar: 6 };

/** Kear §31: every TextObj carries ExtendedAttributes, or FileMaker runs the texts of a multi-object paste together. */
function characterStyle(rules: StyleRule[] | undefined): string {
  const css = rules?.find((r) => r.part === 1 && r.state === 1)?.css ?? {};
  const family = (css['font-family'] ?? 'Helvetica').split(',')[0].replace(/["']/g, '').trim() || 'Helvetica';
  const size = Math.round(parseFloat(css['font-size'] ?? '12') || 12);
  const rgb = /^rgb\((\d+) (\d+) (\d+)/.exec(css.color ?? '');
  const hex = rgb ? `#${[rgb[1], rgb[2], rgb[3]].map((x) => (+x).toString(16).padStart(2, '0').toUpperCase()).join('')}` : '#000000';
  return el('CharacterStyle', { mask: 32695 }, el('Font-family', { codeSet: 'Roman', fontId: 0, postScript: family.replace(/\s+/g, '') }, esc(family)) + el('Font-size', {}, String(size)) + el('Face', {}, '0') + el('Color', {}, hex));
}
function extendedAttributes(rules: StyleRule[] | undefined): string {
  const dates = [0, 0, 0, 0].map(() => el('DateElement', {}, '0')).join('') + [0, 1, 2, 3, 4].map((i) => el('DateElementSep', { index: i })).join('');
  return el('ExtendedAttributes', { fontHeight: 10, graphicFormat: 0 }, [
    el('NumFormat', { flags: 0, charStyle: 0, negativeStyle: 0, currencySymbol: '', thousandsSep: 0, decimalPoint: 0, negativeColor: '#0', decimalDigits: 0, trueString: '', falseString: '' }),
    el('DateFormat', { format: 0, charStyle: 0, monthStyle: 0, dayStyle: 0, separator: 0 }, dates),
    el('TimeFormat', { flags: 0, charStyle: 0, hourStyle: 0, minsecStyle: 0, separator: 0, amString: '', pmString: '', ampmString: '' }),
    characterStyle(rules),
  ].join(''));
}

/** Layout objects as the XML FileMaker Pro copies in Layout mode, and notes on what it can't carry. */
export function layoutSnippet(objects: LayoutObject[], schema: Schema, opts: LayoutCopyOptions = {}): { xml: string; notes: string[] } {
  const notes = new Set<string>();
  const stepNotes: string[] = [];
  const dropped = { count: 0 };
  const themeName = opts.theme ? opts.theme.internalName ?? opts.theme.name : undefined;
  const toName = (id: number, name?: string) => name ?? schema.tableOccurrences.find((t) => t.id === id)?.name ?? '';
  const stylesXml = (o: LayoutObject | undefined, rules = o?.style.rules) => {
    const local = localCss(rules, dropped);
    // User-made styles bind by the name FileMaker shows (Kear §25.1).
    const named = o?.style.displayName ?? o?.style.name;
    return el('Styles', {}, (local ? el('LocalCSS', {}, esc(local).replace(/&#13;/g, '\n')) : '') + (named ? el('CustomStyles', {}, el('Name', {}, esc(named))) : '') + (themeName ? el('ThemeName', {}, esc(themeName)) : '')) || el('Styles');
  };
  const textObj = (o: LayoutObject, flags: number, data: string) => el('TextObj', { flags }, extendedAttributes(o.style.rules) + stylesXml(o)
    + el('CharacterStyleVector', {}, el('Style', {}, el('Data', {}, data ? cdata(data) : '') + characterStyle(o.style.rules))));
  const stepOf = (o: LayoutObject) => {
    const a = o.action;
    if (!a) return '';
    const step: ScriptStep = { stepId: a.stepId, name: scriptStepName(a.stepId), enabled: true };
    if (a.stepId === 1 && a.scriptId !== undefined) step.params = { script: { id: a.scriptId, name: a.script ?? schema.scripts.find((s) => s.id === a.scriptId)?.name ?? '' }, ...(a.parameter !== undefined ? { parameter: a.parameter } : {}) };
    else if (a.stepId === 6 && a.layoutId !== undefined) step.params = { layoutDestination: 'named', layout: { id: a.layoutId, name: a.layout ?? schema.layouts.find((l) => l.id === a.layoutId)?.name ?? '' } };
    else if (a.params) step.params = a.params;
    return stepXml(schema, step, stepNotes);
  };
  const boundsXml = (b: LayoutObject['bounds'], origin: { top: number; left: number }) =>
    el('Bounds', { top: round(b.top - origin.top), left: round(b.left - origin.left), bottom: round(b.bottom - origin.top), right: round(b.right - origin.left) });

  const write = (o: LayoutObject, origin: { top: number; left: number }, parent?: LayoutObject): string => {
    if (o.kind === 'chart' || o.kind === 'graphic' || o.kind === 'unknown' || (o.kind === 'field' && !o.field)) {
      notes.add(o.kind === 'chart' ? 'Charts keep their setup in binary data FileMaker\'s clipboard XML doesn\'t carry: left out' : o.kind === 'graphic' ? 'Pictures don\'t travel on the clipboard as XML: left out' : 'Objects Tabularius couldn\'t read: left out');
      return '';
    }
    const kids_ = o.children ?? [];
    const childOrigin = RELATIVE.has(o.kind) ? { top: o.bounds.top + inset(o.kind), left: o.bounds.left + inset(o.kind) } : { top: 0, left: 0 };
    const childXml = (list = kids_) => list.map((c) => write(c, childOrigin, o)).join('');
    let type = TYPES[o.kind] ?? 'Rect';
    let flags = (o.anchors.left ? 0 : 2 ** 28) + (o.anchors.top ? 0 : 2 ** 29) + (o.anchors.right ? 2 ** 30 : 0) + (o.anchors.bottom ? 2 ** 31 : 0);
    if (o.conditions?.length) flags += 1;
    if (o.hide) flags += 4;
    if (o.hideWhenPrinting) flags += 512;
    if (o.locked) flags += 2;
    if (o.sliding?.up) flags += 16;
    if (o.sliding?.left) flags += 32;
    if (o.sliding?.resizePart && (o.sliding.up || o.sliding.left)) flags += 64;
    if (o.tooltip) flags += 16384;
    const before: string[] = [];
    if (o.conditions?.length) {
      before.push(el('ConditionalFormatting', {}, o.conditions.map((c, i) => el('Item', { id: i, flags: 7 },
        el('Condition', { op: 0 }, calc(c.formula) + el('RangeBegin') + el('RangeEnd')) + el('Format', {}, el('Styles', {}, el('LocalCSS', {}, esc(localCss(c.rules, dropped)).replace(/&#13;/g, '\n')))))).join('')));
    }
    if (o.triggers?.length) {
      before.push(el('ScriptTriggers', {}, o.triggers.map((t) => el('Trigger', { event: t.event, id: TRIGGER_IDS[t.event] ?? 0, triggerFlags: (t.modes ?? ['browse']).reduce((n, m) => n | ({ browse: 1, find: 2, preview: 4 }[m]), 0) },
        el('Script', { id: t.scriptId, name: t.script ?? schema.scripts.find((s) => s.id === t.scriptId)?.name ?? '' }) + calc(t.parameter))).join('')));
    }
    const body: string[] = [boundsXml(o.bounds, origin)];
    if (o.tooltip) body.push(wrap('ToolTip', o.tooltip));
    const after: string[] = [];
    switch (o.kind) {
      case 'field': {
        const f = o.field!;
        const to = toName(f.tableOccurrenceId, f.tableOccurrence);
        const base = schema.tableOccurrences.find((t) => t.id === f.tableOccurrenceId)?.baseTableId;
        const fieldName = f.field ?? schema.tables.find((t) => t.id === base)?.fields.find((x) => x.id === f.fieldId)?.name ?? '';
        const vl = f.valueList ?? schema.valueLists.find((v) => v.id === f.valueListId)?.name;
        body.push(el('FieldObj', { numOfReps: f.repetitions || 1, flags: behaviorFlags(f.behavior), inputMode: 0, keyboardType: 1, displayType: DISPLAY_TYPES[f.display] ?? 0, quickFind: f.behavior?.quickFindOff ? 0 : 1, pictFormat: f.format?.container ? CONTAINER_FORMAT_CODES[f.format.container] : 5 }, [
          el('Name', {}, esc(`${to}::${fieldName}`)),
          vl ? el('ValueList', {}, esc(vl)) : '',
          stylesXml(o),
          o.placeholder ? wrap('PlaceholderText', o.placeholder) : '',
          el('DDRInfo', {}, el('Field', { name: fieldName, id: f.fieldId, repetition: 1, maxRepetition: f.repetitions || 1, table: to }) + (vl ? el('ValueList', { name: vl, id: f.valueListId }) : '')),
        ].join('')));
        break;
      }
      case 'text': {
        const merge = /<<[^<>]+>>/.test(o.text ?? '');
        // FileMaker gives merge text Object flags bit 3 (Kear §6.1 writes 10, but bit 1 is the padlock).
        if (merge) flags = (flags | 8) >>> 0;
        body.push(textObj(o, merge ? 10 : 0, o.text ?? ''));
        break;
      }
      case 'button': {
        if (parent?.kind === 'button-bar') {
          flags = 8;
          body.push(textObj(o, 2, ''));
          body.push(el('ButtonObj', { buttonFlags: 2, iconSize: 16, displayType: 0 }, stepOf(o)));
          after.push(wrap('LabelCalc', o.label ?? quote(o.text ?? '')));
        } else {
          body.push(textObj(o, 2, o.text ?? ''));
          body.push(el('ButtonObj', { buttonFlags: o.label !== undefined ? 1 : 0, iconSize: o.icon?.size ?? 0, displayType: 0 }, stepOf(o)));
          if (o.label !== undefined) after.push(wrap('LabelCalc', o.label));
          if (o.icon) notes.add('Button icons are pictures FileMaker keeps as data the clipboard XML doesn\'t carry: buttons copy without them');
        }
        break;
      }
      case 'popover-button': {
        // A popover button outside a bar shows its text; as a bar segment, its label calculation.
        const segment = parent?.kind === 'button-bar';
        if (segment) flags = 8;
        body.push(textObj(o, 2, segment ? '' : o.text ?? ''));
        body.push(el('PopoverButtonObj', {}, childXml()));
        if (segment) after.push(wrap('LabelCalc', o.label ?? quote(o.text ?? '')));
        break;
      }
      case 'popover':
        body.push(stylesXml(o), (o.label !== undefined ? wrap('TitleCalc', o.label) : o.text !== undefined ? wrap('TitleCalc', quote(o.text)) : ''), el('PopoverObj', {}, childXml()));
        if (o.titleBar) notes.add('Whether a popover shows its title bar isn\'t in FileMaker\'s clipboard XML as far as is known: check it after pasting');
        break;
      case 'group':
        if (o.action) {
          type = 'GroupButton';
          body.push(el('GroupButtonObj', { numOfObjs: kids_.length }, stepOf(o) + stylesXml(o) + childXml()));
        } else {
          type = 'Group';
          body.push(el('GroupObj', { numOfObjs: kids_.length }, stylesXml(o) + childXml()));
        }
        break;
      case 'portal': {
        const p = o.portal!;
        const pf = (p.scrolling ? 1 : 0) + (p.allowDelete ? 4 : 0) + (p.sort?.length ? 8 : 0) + (p.filter ? 128 : 0) + (p.scrolling && p.scrollBarWhenScrolling ? 256 : 0);
        const sort = (p.sort ?? []).filter((s) => s.field.field).map((s) => el('Sort', { type: s.valueList ? 'Custom' : s.descending ? 'Descending' : 'Ascending' },
          el('Name', {}, esc(`${toName(s.field.tableOccurrenceId, s.field.tableOccurrence)}::${s.field.field ?? ''}`)) + (s.valueList ? el('ValueList', {}, esc(s.valueList)) : ''))).join('');
        body.push(el('PortalObj', { portalFlags: pf, numOfRows: p.rows, initialRow: p.initialRow }, [
          el('TableAliasKey', {}, esc(toName(p.tableOccurrenceId, p.tableOccurrence))),
          `<SortList>${sort}</SortList>`,
          p.filter ? wrap('FilterCalc', p.filter) : '',
          stylesXml(o),
          childXml(),
        ].join('')));
        break;
      }
      case 'tab-control':
      case 'slide-control': {
        const panels = kids_.filter((k) => k.kind === 'tab-panel' || k.kind === 'slide-panel');
        const front = Math.max(0, panels.findIndex((p) => p.id === o.target));
        const key = panels[front]?.id ?? 0;
        body.push(o.kind === 'tab-control'
          ? el('TabControlObj', { tabHeight: o.tabHeight ?? 20, visPanelKey: key, defaultVisPanelKey: key, visPanelIndex: front, defaultVisPanelIndex: front, tabWidthModifier: 70, tabFlagSet: 264 }, stylesXml(o) + childXml())
          : el('SlideControlObj', { visPanelKey: key, visPanelIndex: front, dotSize: 9, slideFlagSet: (o.noDots ? 1 : 0) + (o.noSwipe ? 2 : 0) }, stylesXml(o) + childXml()));
        break;
      }
      case 'tab-panel':
        body.push(stylesXml(o), (o.text !== undefined ? wrap('TitleCalc', quote(o.text)) : ''), el('TabPanelObj', { tabLeftEdge: o.tab?.left ?? 0, tabWidth: o.tab?.width ?? 0, tabPanelFlagSet: 0 }, childXml()));
        break;
      case 'slide-panel':
        body.push(el('SlidePanelObj', { slidePanelFlagSet: 0 }, childXml()));
        break;
      case 'button-bar':
        body.push(stylesXml(o), el('ButtonBarObj', { flags: 0, segmentKey: o.activeSegment ?? 0 }, childXml()));
        if (o.activeSegmentFormula) notes.add('A button bar\'s active segment calculation: FileMaker\'s clipboard keeps only a fixed segment');
        break;
      case 'web-viewer':
        body.push(el('ExternalObj', { typeID: 'WEBV', typeIndex: 0, externalFlagSet: o.webOptions ? webViewerFlags(o.webOptions) : 32781 }, stylesXml(o) + calc(o.webUrl ?? '""', undefined).replace('<Calculation>', '<Calculation index="0">')));
        break;
      default: // shapes
        body.push(stylesXml(o), el('RenderFormat', { renderType: 0 }));
    }
    if (o.hide) after.push(el('HideCondition', { findMode: o.hide.inFind ? 'True' : 'False' }, calc(o.hide.formula)));
    return el('Object', { type, key: o.id, LabelKey: 0, ...(o.name ? { name: o.name } : {}), flags: flags | 0, rotation: o.rotation && ROTATABLE_KINDS.has(o.kind) ? (SNIPPET_ROTATION_SIGN === 1 ? o.rotation : 360 - o.rotation) : 0 }, [...before, ...body, ...after].join(''));
  };

  const all = objects.map((o) => write(o, { top: 0, left: 0 })).join('');
  if (dropped.count) notes.add('Some styling isn\'t written for FileMaker: gradients, and a few parts of objects Tabularius has no FileMaker style name for');
  for (const n of stepNotes) notes.add(n);
  const bs = objects.map((o) => o.bounds);
  const rect = bs.length
    ? { enclosingRectTop: round(Math.min(...bs.map((b) => b.top))), enclosingRectLeft: round(Math.min(...bs.map((b) => b.left))), enclosingRectBottom: round(Math.max(...bs.map((b) => b.bottom))), enclosingRectRight: round(Math.max(...bs.map((b) => b.right))) }
    : { enclosingRectTop: 0, enclosingRectLeft: 0, enclosingRectBottom: 0, enclosingRectRight: 0 };
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>${el('fmxmlsnippet', { type: 'LayoutObjectList' }, el('Layout', rect, all))}`, notes: [...notes] };
}
