// Layout styles. FileMaker 12+ themes are CSS compiled to protobuf: each
// style is a list of rules, a rule targets one part of an object (the object
// itself, its text area, its icon, ...) in one state (normal, hover, ...),
// and holds properties keyed by number. Local styles on layout objects and
// parts use the same encoding. Property numbers below were matched against
// FileMaker's Database Design Report CSS (sample "Flicks") and the built-in
// themes' visible behaviour; unknown properties are kept by number.
//
// Theme catalog: 6.5.[theme id], key 10 display name, key 16 internal name,
// child 22 = the compiled style sheet:
//   message { repeated Default 1 { 1: element; 2: Rules } ;
//             repeated Named 2 { 1: name (often "FM-<uuid>"); 2: Rules; 3: element } }
//   Rules   { repeated Rule 1 { 1: part; 2: state; 3: Props } }
//   Props   { repeated Prop 1 { 1: property id; 3|5|6|12|13|18|19: value } }

import { Pb } from './proto.ts';

/**
 * Which part of an object a rule styles, by FileMaker's CSS part selector.
 * Matched by value against FileMaker Pro's own theme CSS and the theme CSS in
 * the Flicks Design Report: an edit box's part 3 holds the margins of its
 * `.text` box, part 2 the shadow of its `.inner_border`; 12, 13 and 28 are
 * a portal's rows. 8 is a popover's content area (`.contents`, inferred from the
 * popover rules it holds).
 */
export const STYLE_PARTS: Record<number, string> = {
  1: 'self', 2: 'inner_border', 3: 'text', 4: 'icon', 6: 'repeat_border', 9: 'tab', 10: 'tab_inner_border',
  8: 'contents', 12: 'row', 13: 'row_alt', 18: 'panel', 19: 'panel_inner_border', 28: 'row_active',
};

/** Object state a rule applies in. */
export const STYLE_STATES: Record<number, string> = {
  1: 'normal', 2: 'hover', 3: 'pressed', 4: 'focus', 7: 'checked', 18: 'placeholder',
};

/**
 * Theme element type of each kind of layout object or part. Objects name
 * their element (object style field 3); these are the defaults in themes.
 * Names are the element selectors of FileMaker Pro's own theme CSS
 * (FileMaker Pro.app/Contents/Resources/Themes/<theme>/<theme>.css), where
 * it has one. 66 and 68 are matched by use across the samples: 66 only on
 * fields shown as drop-down calendars (32 of 32) and 68 only on edit boxes
 * with a vertical scroll bar (44 of 44), the two field elements the theme CSS
 * names that no other id takes ("calendar", and "text_area", whose text box
 * stops 17pt short of the right edge for the scroll bar).
 */
export const STYLE_ELEMENTS: Record<number, string> = {
  20: 'layout', 21: 'layout_inner',
  30: 'part', 31: 'title_header', 32: 'header', 33: 'leading_grand_summary', 34: 'body', 35: 'body_alt',
  36: 'sub_summary', 37: 'trailing_grand_summary', 38: 'footer', 39: 'title_footer', 40: 'top_nav_part', 41: 'bottom_nav_part',
  50: 'line', 51: 'rectangle', 52: 'rounded', 53: 'oval', 54: 'shape',
  60: 'field', 61: 'edit_box', 62: 'drop_down', 63: 'pop_up', 64: 'checkbox_set', 65: 'radio_set',
  66: 'calendar', 67: 'container', 68: 'text_area', 70: 'text_box',
  78: 'button_bar', 79: 'button_bar_segment', 80: 'button', 81: 'tab_control', 82: 'tab_panel', 83: 'portal',
  84: 'graphic', 85: 'web_viewer', 86: 'chart', 87: 'group', 89: 'popover', 90: 'dot_control', 91: 'slide_control', 92: 'slide_panel',
};

export interface StyleRule {
  part: number;
  state: number;
  /** CSS declarations: property -> value. */
  css: Record<string, string>;
}

export interface ThemeStyle {
  /** Style name as stored ("FM-<uuid>" for custom styles, a readable name for built-in ones). */
  name: string;
  element?: number;
  rules: StyleRule[];
}

export interface Theme {
  id: number;
  name: string;
  internalName?: string;
  /** Element type -> its default rules. */
  defaults: Record<number, StyleRule[]>;
  /** Rules for an element inside another, like text in a header: path is outermost first. */
  contextual?: { path: number[]; rules: StyleRule[] }[];
  styles: ThemeStyle[];
}

/** Font table: font id (style property 64) -> family name. */
export type FontTable = Map<number, string>;

const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const BORDER_STYLES: Record<number, string> = {
  1: 'none', 2: 'hidden', 3: 'dotted', 4: 'dashed', 5: 'solid', 6: 'double', 7: 'groove', 8: 'ridge', 9: 'inset', 10: 'outset',
};
const TEXT_ALIGN: Record<number, string> = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify' };
const VERTICAL_ALIGN: Record<number, string> = { 0: 'flex-start', 1: 'center', 2: 'flex-end' };

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

function rgba(m: Pb | undefined): string | undefined {
  if (!m) return undefined;
  const c = [1, 2, 3, 4].map((n) => m.num(n) ?? 0);
  const [r, g, b] = c.slice(0, 3).map((x) => Math.round(x * 255));
  return c[3] >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${round(c[3])})`;
}

/** A length message { 1: value, 2: unit }. FileMaker points are CSS pixels at 100% zoom. */
function length(m: Pb | undefined): string | undefined {
  if (!m) return undefined;
  const v = round(m.num(1) ?? 0);
  switch (m.num(2) ?? 0) {
    case 1: return `${v}%`;
    case 6: return `${v}px`;
    case 7: return `${v}em`;
    case 9: return `${v}`;
    default: return v === 0 ? '0' : undefined;
  }
}

const LINE = 1.2;

/**
 * Line spacing. In "lines" (unit 9) one line is the font's own line height,
 * which is about 1.2 times the font size, not CSS's line-height: 1.
 */
function lineHeight(m: Pb | undefined): string | undefined {
  if (m?.num(2) === 9) return String(round((m.num(1) ?? 0) * LINE));
  return length(m);
}

function gradient(m: Pb): string | undefined {
  const g = m.msg(2);
  if (!g) return undefined;
  const point = (p: Pb | undefined) => {
    const xy = p?.msg(1);
    return [xy?.msg(1)?.num(1) ?? 0, xy?.msg(2)?.num(1) ?? 0];
  };
  const [x1, y1] = point(g.msg(2));
  const [x2, y2] = point(g.msg(3));
  const angle = Math.round((Math.atan2(x2 - x1, -(y2 - y1)) * 180) / Math.PI + 360) % 360;
  const stops = g.msgs(6).map((s) => `${rgba(s.msg(2))} ${round((s.num(1) ?? 0) * 100, 1)}%`);
  if (stops.length < 2) return undefined;
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

/**
 * A style property the reader met: its id, which value field it carries (a
 * hint at its type), its value as read (for research), and the layout object
 * whose local style holds it (none for themes).
 */
export interface StyleGap {
  id: number;
  field: number;
  value: unknown;
  object?: number;
  /** In a theme: its id and the element path (for a named style, its element). */
  theme?: number;
  element?: number[];
  part?: number;
  state?: number;
  known: boolean;
}

let gapSink: ((gap: StyleGap) => void) | undefined;
/**
 * Where the style being read is, so a gap can say: the layout object
 * (layouts.ts sets it), or the theme and its element path, and the rule's part and state.
 */
export const styleScope: { object?: number; theme?: number; element?: number[]; part?: number; state?: number } = {};

/** Every style property `read` meets, known or not (for matching property ids against FileMaker's CSS). */
export function withStyleProbe<T>(read: () => T, probe: (gap: StyleGap) => void): T {
  const before = gapSink;
  gapSink = probe;
  try {
    return read();
  } finally {
    gapSink = before;
  }
}

/** A property's value in plain form: its fields after the id, numbers or nested messages. */
function plain(p: Pb): unknown {
  return fieldsOf(new Pb(p.fields.filter((f) => f.n !== 1)));
}

function fieldsOf(p: Pb): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of p.fields) {
    if (f.wire !== 2) out[f.n] = f.value;
    else {
      const m = Pb.parse(f.value as Uint8Array);
      out[f.n] = m && m.fields.length ? fieldsOf(m) : [...(f.value as Uint8Array)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  return out;
}

/**
 * Runs `read` (reading themes or layouts) and counts, by property id, the
 * style properties it met but couldn't turn into CSS: what a converted
 * layout doesn't yet look like in FileMaker.
 */
export function withStyleGaps<T>(read: () => T): { result: T; gaps: Map<number, { count: number; fields: Set<number> }> } {
  const gaps = new Map<number, { count: number; fields: Set<number> }>();
  const before = gapSink;
  gapSink = (g) => {
    if (g.known) return;
    const e = gaps.get(g.id) ?? { count: 0, fields: new Set<number>() };
    e.count++;
    e.fields.add(g.field);
    gaps.set(g.id, e);
  };
  try {
    return { result: read(), gaps };
  } finally {
    gapSink = before;
  }
}

/** The property ids declare() turns into CSS. */
const KNOWN = (id: number) => id === 1 || id === 7 || (id >= 20 && id <= 35) || id === 64 || id === 65 || id === 67 || id === 504 || id === 505 ||
  id === 69 || id === 70 || id === 72 || id === 74 || (id >= 101 && id <= 108) || id === 122 || id === 514 || id === 611 || id === 621;

function declare(p: Pb, css: Record<string, string>, fonts?: FontTable): void {
  const id = p.num(1);
  if (id === undefined) return;
  if (gapSink) gapSink({ id, field: [3, 5, 6, 12, 13, 18, 19].find((f) => p.fields.some((x) => x.n === f)) ?? 0, value: plain(p), object: styleScope.object, theme: styleScope.theme, element: styleScope.element, part: styleScope.part, state: styleScope.state, known: KNOWN(id) });
  const set = (k: string, v: string | undefined) => {
    if (v !== undefined) css[k] = v;
  };
  if (id === 1) {
    const img = p.msg(18);
    if (!img) return;
    const kind = img.num(1);
    if (kind === 0) set('background-image', 'none');
    else if (kind === 1) set('background-image', gradient(img));
  } else if (id === 7) set('background-color', rgba(p.msg(5)));
  else if (id >= 20 && id <= 23) set(`border-${SIDES[id - 20]}-color`, rgba(p.msg(5)));
  else if (id >= 24 && id <= 27) set(`border-${SIDES[id - 24]}-style`, BORDER_STYLES[p.num(3) ?? 5] ?? 'solid');
  else if (id >= 28 && id <= 31) set(`border-${SIDES[id - 28]}-width`, length(p.msg(6)));
  else if (id >= 32 && id <= 35) {
    const r = p.msg(13);
    const a = length(r?.msg(1));
    const b = length(r?.msg(2));
    if (a !== undefined) set(`border-${CORNERS[id - 32]}-radius`, a === b || b === undefined ? a : `${a} ${b}`);
  } else if (id === 64) {
    const v = p.num(3);
    const name = v !== undefined ? fonts?.get(128 + v) : undefined;
    if (name) set('font-family', fontStack(name));
  } else if (id === 65) set('font-weight', p.num(3) === 2 ? 'bold' : 'normal');
  else if (id === 67) set('font-style', p.num(3) === 2 ? 'italic' : 'normal');
  else if (id === 504 || id === 505) {
    // Strikethrough (504) and underline (505) share one CSS property.
    const word = id === 504 ? 'line-through' : 'underline';
    const lines = new Set((css['text-decoration-line'] ?? '').split(' ').filter((w) => w && w !== 'none'));
    if (p.num(3) === 1) lines.add(word);
    else lines.delete(word);
    set('text-decoration-line', lines.size ? [...lines].join(' ') : 'none');
  }
  else if (id === 69) set('font-size', length(p.msg(6)));
  else if (id === 70) set('color', rgba(p.msg(5)));
  else if (id === 72) set('line-height', lineHeight(p.msg(6)));
  else if (id === 74) set('text-align', TEXT_ALIGN[p.num(3) ?? 1]);
  else if (id >= 101 && id <= 104) set(`padding-${SIDES[id - 101]}`, length(p.msg(6)));
  // Margins: in themes, the text box's inset within its object (FileMaker's `.text` part).
  else if (id >= 105 && id <= 108) set(`margin-${SIDES[id - 105]}`, length(p.msg(6)));
  else if (id === 122) {
    const s = p.msg(19);
    if (!s) return;
    const color = rgba(s.msg(3));
    const parts = [4, 5, 6, 7].map((n) => length(s.msg(n)) ?? '0');
    set('box-shadow', `${s.num(1) ? 'inset ' : ''}${parts.join(' ')} ${color}`);
  } else if (id === 514) set('--fm-icon-color', rgba(p.msg(5)));
  else if (id === 611) set('--fm-vertical-align', VERTICAL_ALIGN[p.num(3) ?? 0]);
  else if (id === 621) set('--fm-icon-size', length(p.msg(6)));
}

const GENERIC: Record<string, string> = {
  monaco: 'monospace', courier: 'monospace', consolas: 'monospace', menlo: 'monospace',
  times: 'serif', georgia: 'serif', 'times new roman': 'serif',
};

/** CSS font-family list for a FileMaker font name ("arial,sans-serif" is already a list). */
export function fontStack(name: string): string {
  const fams = name.split(',').map((s) => s.trim()).filter(Boolean)
    // Apple private system fonts (".SF NS Text") map to the platform UI font.
    .map((f) => (f.startsWith('.') ? 'system-ui' : f));
  const quoted = fams.map((f) => (/^[a-z-]+$/i.test(f) && ['serif', 'sans-serif', 'monospace', 'system-ui'].includes(f) ? f : JSON.stringify(f)));
  const generic = GENERIC[fams[0]?.toLowerCase() ?? ''] ?? 'sans-serif';
  if (!quoted.includes(generic)) quoted.push(generic);
  return quoted.join(', ');
}

/** Decodes a Rules message (theme style or local object style). */
export function readRules(m: Pb | undefined, fonts?: FontTable): StyleRule[] {
  if (!m) return [];
  const rules: StyleRule[] = [];
  for (const r of m.msgs(1)) {
    const css: Record<string, string> = {};
    styleScope.part = r.num(1) ?? 1;
    styleScope.state = r.num(2) ?? 1;
    for (const props of r.msgs(3)) for (const p of props.msgs(1)) declare(p, css, fonts);
    styleScope.part = styleScope.state = undefined;
    if (Object.keys(css).length) rules.push({ part: r.num(1) ?? 1, state: r.num(2) ?? 1, css });
  }
  return rules;
}

/** Decodes a compiled theme style sheet (6.5.[id].22). */
export function readTheme(id: number, name: string, sheet: Uint8Array | undefined, fonts?: FontTable): Theme {
  const theme: Theme = { id, name, defaults: {}, styles: [] };
  const m = Pb.parse(sheet);
  if (!m) return theme;
  styleScope.theme = id;
  for (const d of m.msgs(1)) {
    // Field 1 repeats for contextual selectors ("text in a header" is [32, 70]).
    const path = d.nums(1);
    styleScope.element = path;
    if (path.length === 1) theme.defaults[path[0]] = readRules(d.msg(2), fonts);
    else if (path.length > 1) (theme.contextual ??= []).push({ path, rules: readRules(d.msg(2), fonts) });
  }
  for (const s of m.msgs(2)) {
    styleScope.element = s.num(3) === undefined ? undefined : [s.num(3)!];
    const style: ThemeStyle = { name: s.str(1) ?? '', rules: readRules(s.msg(2), fonts) };
    const el = s.num(3);
    if (el !== undefined) style.element = el;
    theme.styles.push(style);
  }
  styleScope.theme = styleScope.element = undefined;
  return theme;
}

/** CSS text for a declaration block. */
export function cssText(css: Record<string, string>): string {
  return Object.entries(css).map(([k, v]) => `${k}:${v}`).join(';');
}
