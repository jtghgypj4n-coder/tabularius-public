// Layout designs: parts, objects with their positions, and styles.
//
// Path map (inferred from sample files, checked against FileMaker's Database
// Design Report for "Flicks": every object position matches exactly):
//
//   4.5.[layout]        key 11 = theme (length-prefixed id), key 16 = name
//     .2  (segment or long value) settings: 2 = TO (+0x104000), 8 = width,
//                         7 = local style
//     .3.[n]  key 2 = part: 1 kind, 4 top, 5 height, 10 style
//     .5.[object]  key 1 = text (labels, button captions, tab names),
//                  key 16 = object name
//     .7  (segment or long value) objects: repeated 1 = top-level object ids
//         in stacking order; repeated 2 = every object (see readObject)
//     .13 the Table View design, laid out the same way (.3 parts, .7 objects)
//   6.5.[theme]   see styles.ts
//   25.5.[128+n]  fonts: key 16 = family name; style property 64 holds n
//   31.5.[image]  image library: child 0x504e4766 ("PNGf") etc. hold the bytes

import { buildTree, type Node } from './tree.ts';
import { pathValue } from './chunks.ts';
import { Pb } from './proto.ts';
import { readRules, readTheme, styleScope, type FontTable, type StyleRule, type Theme } from './styles.ts';
import { scriptStepName } from './script-steps.ts';
import { decodeStepParams, shortRef, type ParamContext, type StepParams } from './script-params.ts';
import { CalcDecodeError, calcTokens, decodeCalc, schemaFieldNamer } from './calc.ts';
import { FmpError, type FmpFile } from './file.ts';
import type { Schema } from './schema.ts';

/** Table occurrence ids (128 + n) are stored offset by this in layout data. */
const TO_BASE = 0x104000;
const MAX_OBJECT_DEPTH = 128;

export interface Bounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type ObjectKind =
  | 'field' | 'text' | 'graphic' | 'line' | 'rectangle' | 'rounded-rectangle' | 'oval' | 'group'
  | 'portal' | 'button' | 'tab-control' | 'tab-panel' | 'web-viewer' | 'chart' | 'popover-button'
  | 'popover' | 'slide-control' | 'slide-panel' | 'button-bar' | 'unknown';

/**
 * Kinds Arrange > Rotate works on: "fields, text blocks, and graphic objects" (so buttons, which are those, and popover
 * buttons), but not portals, tab or slide controls, web viewers or popovers (Claris help, "Rotating objects").
 */
export const ROTATABLE_KINDS: ReadonlySet<ObjectKind> = new Set<ObjectKind>([
  'field', 'text', 'graphic', 'line', 'rectangle', 'rounded-rectangle', 'oval', 'button', 'popover-button',
]);

/** An angle as a clockwise quarter turn, 90, 180 or 270; undefined for no turn or an angle that isn't one (not drawn). */
export function quarterTurn(degrees: unknown): 90 | 180 | 270 | undefined {
  if (typeof degrees !== 'number' || !Number.isFinite(degrees)) return undefined;
  const d = ((Math.round(degrees) % 360) + 360) % 360;
  return d === 90 || d === 180 || d === 270 ? d : undefined;
}

const OBJECT_KINDS: Record<number, ObjectKind> = {
  1: 'field', 2: 'text', 3: 'graphic', 4: 'line', 5: 'rectangle', 6: 'rounded-rectangle', 7: 'oval', 8: 'group',
  9: 'portal', 10: 'button', 11: 'tab-control', 12: 'tab-panel', 13: 'web-viewer', 14: 'popover-button',
  15: 'popover', 16: 'slide-control', 17: 'slide-panel', 18: 'button-bar',
};

export type FieldDisplay = 'edit' | 'popup' | 'dropdown' | 'checkbox' | 'radio' | 'calendar';
// 1 is a drop-down list and 2 a pop-up menu: fields shown as 1 use theme
// element 62, which themes' named styles call "drop-down list" (header_drop-down_list,
// transparent_drop_down), and fields shown as 2 use 63, their "pop-up menu".
const FIELD_DISPLAYS: Record<number, FieldDisplay> = { 0: 'edit', 1: 'dropdown', 2: 'popup', 3: 'checkbox', 4: 'radio', 6: 'calendar' };

/** Field entry in one mode, when it is not Edit: View Only, Select Only (select and copy, no changes) or Set by Calculation. */
export type FieldEntry = 'view' | 'select' | 'calculation';

/** Field behavior from the Inspector; only what differs from a new field's defaults is set. */
export interface FieldBehavior {
  browse?: FieldEntry;
  find?: FieldEntry;
  /** Select entire contents on entry. */
  selectOnEntry?: true;
  /** Tab does not go to the next object. */
  noTab?: true;
  /** Left out of Quick Find. */
  quickFindOff?: true;
  /** Auto-complete using previously entered values. */
  autoComplete?: true;
  /** Drop-down calendars: include the icon that shows and hides the calendar. */
  calendarIcon?: true;
  /** Checkbox and radio button sets: include an "Other..." item. */
  otherValue?: true;
  /** Concealed edit box: shows dots instead of the data (it isn't encrypted). */
  concealed?: true;
  /** Edit boxes: show a vertical scroll bar. */
  scrollBar?: true;
  /** Return and Enter also go to the next object (inferred, see readFieldBehavior). */
  returnKey?: true;
  enterKey?: true;
}

/**
 * Field object options (field message 8, key 1; the DDR's FieldObj flags):
 * bit0 Other item, bit1 select on entry, bit2/bit24 Browse mode and bit4/bit25
 * Find mode entry (low bit alone View Only, high bit alone Select Only, both Set
 * by Calculation), bit5 Tab to next object, bit11 auto-complete, bit10 with
 * bit19 calendar icon, bit15 Quick Find off. Bit17 is placeholder text and
 * bit20 a value list override, both read elsewhere or not used. Bit meanings
 * follow andykear/FileMaker-XMLsnippet-Layout-Claude-Skill's clipboard
 * decode; the integers match Flicks' DDR FieldObj flags one for one.
 *
 * Inferred from private sample files (no Design Report to check against yet):
 * bit21 is a concealed edit box (only on fields labelled Password, API Key,
 * Account SID and License Key), bit8 a vertical scroll bar (only on edit boxes
 * holding notes, descriptions and HTTP bodies), and bits 6 and 7 the Return
 * and Enter keys, next to Tab's bit5 as in the Inspector (bit7 sits on search
 * and Quick Find fields).
 */
export function readFieldBehavior(flags: number): FieldBehavior | undefined {
  const bit = (n: number) => Math.floor(flags / 2 ** n) % 2 === 1;
  const entry = (low: number, high: number): FieldEntry | undefined =>
    bit(low) ? (bit(high) ? 'calculation' : 'view') : bit(high) ? 'select' : undefined;
  const out: FieldBehavior = {};
  const browse = entry(2, 24);
  if (browse) out.browse = browse;
  const find = entry(4, 25);
  if (find) out.find = find;
  if (bit(1)) out.selectOnEntry = true;
  if (!bit(5)) out.noTab = true;
  if (bit(15)) out.quickFindOff = true;
  if (bit(11)) out.autoComplete = true;
  if (bit(10) && bit(19)) out.calendarIcon = true;
  if (bit(0)) out.otherValue = true;
  if (bit(21)) out.concealed = true;
  if (bit(8)) out.scrollBar = true;
  if (bit(6)) out.returnKey = true;
  if (bit(7)) out.enterKey = true;
  return Object.keys(out).length ? out : undefined;
}

/** Where a button shows its icon (DDR ButtonObj displayType 0..5). */
export type IconDisplay = 'label' | 'icon' | 'left' | 'right' | 'top' | 'bottom';
// Button Setup's order: text only, icon only, then the icon at top, bottom, left or right of the text.
const ICON_DISPLAYS: IconDisplay[] = ['label', 'icon', 'top', 'bottom', 'left', 'right'];

export type PartKind =
  | 'title-header' | 'header' | 'leading-grand-summary' | 'sub-summary-leading' | 'body' | 'sub-summary-trailing'
  | 'trailing-grand-summary' | 'footer' | 'title-footer' | 'top-navigation' | 'bottom-navigation' | 'unknown';
const PART_KINDS: Record<number, PartKind> = {
  0: 'title-header', 1: 'header', 2: 'leading-grand-summary', 3: 'sub-summary-leading', 4: 'body', 5: 'sub-summary-trailing',
  6: 'trailing-grand-summary', 7: 'footer', 8: 'title-footer', 12: 'top-navigation', 13: 'bottom-navigation',
};

export interface ObjectStyle {
  /** Theme element type (see STYLE_ELEMENTS). */
  element?: number;
  /** Theme style name the object uses (matches ThemeStyle.name). */
  name?: string;
  /** Name shown in FileMaker's Styles inspector. */
  displayName?: string;
  /** Local overrides. */
  rules?: StyleRule[];
}

export interface Condition {
  formula: string;
  /** Style rules in the same form as a theme's (part, state, properties). */
  rules: StyleRule[];
}

/**
 * A field's data formatting (node k13, the same options as the Design
 * Report's NumFormat, DateFormat and TimeFormat). Fields left out mean
 * "as entered"; see docs/research/fmp12-format.md.
 */
export interface DataFormat {
  number?: NumberFormat;
  date?: DateFormat;
  time?: TimeFormat;
  /** Containers: crop to the frame, enlarge, or reduce or enlarge to fit; absent: reduce to fit (the default). */
  container?: ContainerFormat;
}

/** The Inspector's container format; the DDR's pictFormat 4, 6 and 7 (5, reduce, is the default). */
export type ContainerFormat = 'crop' | 'enlarge' | 'fit';
const CONTAINER_FORMATS: Record<number, ContainerFormat> = { 4: 'crop', 6: 'enlarge', 7: 'fit' };
export const CONTAINER_FORMAT_CODES: Record<ContainerFormat, number> = { crop: 4, enlarge: 6, fit: 7 };

export interface NumberFormat {
  decimalPoint: string;
  /** Fixed number of decimal digits. */
  decimals?: number;
  thousands?: string;
  /** Currency symbol, or '%' for percent (the value is multiplied by 100). */
  notation?: string;
  /** Notation goes before the number (currency only). */
  leading?: boolean;
  /** Notation goes outside the negative sign: "$-12" instead of "-$12". */
  outside?: boolean;
  /** 0 "-12", 1 "12-", 2 "(12)", 3 "<12>", 4 "12 CR", 5 "▲12". */
  negativeStyle?: number;
  negativeColor?: string;
  blankIfZero?: boolean;
  /** Boolean format: text for non-zero and zero values. */
  boolean?: { true: string; false: string };
}

export interface DateFormat {
  /** 1 custom, 2 numeric, 3 "Dec 25, 2014", 4 "December 25, 2014", 5 and 6 the same with the day name, 7 long numeric. */
  style: number;
  /** Padding for month and day numbers: '' none, '0' leading zero, ' ' leading space. */
  monthPad: string;
  dayPad: string;
  separator: string;
  /** Custom formats: four elements (1 day, 2 short day name, 3 day name, 4 month, 5 short month name, 6 month name, 7 short year, 8 year) and the five separators around them. */
  elements?: number[];
  separators?: string[];
}

export interface TimeFormat {
  minutes: boolean;
  seconds: boolean;
  h24: boolean;
  hourPad: string;
  minSecPad: string;
  separator: string;
  /** Text added after the time (before it when prefix is set): AM/PM for 12-hour times, an optional suffix for 24-hour times. */
  am: string;
  pm: string;
  prefix: boolean;
}

export interface FieldRef {
  tableOccurrenceId: number;
  fieldId: number;
  tableOccurrence?: string;
  field?: string;
}

export interface ButtonAction {
  stepId: number;
  step: string;
  /** Perform Script: the script (by id in `file` when the button runs a script in another file). */
  scriptId?: number;
  /** Perform Script: the data source naming the other file the script is in; its script's name is read there. */
  file?: { id: number; name: string };
  /** Go to Layout: the layout. */
  layoutId?: number;
  /** The step's single id parameter, whatever it refers to. */
  param?: number;
  /** Perform Script: the script parameter formula. */
  parameter?: string;
  /** Other steps: their options, decoded as for the same step in a script. */
  params?: StepParams;
  /** Other steps: the step as a script line (set when design mode saves it, or for the layout editor). */
  line?: string;
}

export interface LayoutObject {
  id: number;
  kind: ObjectKind;
  type: number;
  /** Position on the layout (absolute, in points). */
  bounds: Bounds;
  /** Which edges keep their distance to the window edge when it resizes. */
  anchors: { left: boolean; top: boolean; right: boolean; bottom: boolean };
  style: ObjectStyle;
  /** Tabularius only: hidden in web client windows narrower than hideBelow. */
  responsive?: { hideBelow?: number };
  name?: string;
  /** Static text, button caption or tab name. Merge fields read <<TO::Field>>. */
  text?: string;
  field?: FieldRef & {
    display: FieldDisplay;
    repetitions: number;
    valueListId?: number;
    valueList?: string;
    /** Data formatting from the Inspector, where it changes what is shown. */
    format?: DataFormat;
    behavior?: FieldBehavior;
  };
  portal?: {
    tableOccurrenceId: number; tableOccurrence?: string; rows: number; initialRow: number;
    /** Sort order for the portal's rows: ascending, descending, or the order of a value list's values. */
    sort?: { field: FieldRef; descending?: boolean; valueListId?: number; valueList?: string }[];
    /** Rows show only when this formula is true for them. */
    filter?: string;
    /** Portal Setup: allow vertical scrolling; the scroll bar shows only while scrolling; allow deletion of portal records. */
    scrolling?: true;
    scrollBarWhenScrolling?: true;
    allowDelete?: true;
  };
  action?: ButtonAction & { script?: string; layout?: string };
  /** Tab control: the panel shown first. Popover button: its popover. */
  target?: number;
  /** Graphic: image library id (31.5.[id]). */
  imageId?: number;
  /** Button icon: image library id, size in points, and placement. */
  icon?: { imageId: number; size: number; display: IconDisplay };
  /** Web viewer or chart. */
  external?: string;
  /** Web viewer: the address formula. */
  webUrl?: string;
  /** Web Viewer Setup's options (see WebViewerOptions). */
  webOptions?: WebViewerOptions;
  /** "Hide object when" formula; inFind: also applied in Find mode. */
  hide?: { formula: string; inFind: boolean };
  /**
   * Turned clockwise by this many degrees, as Arrange > Rotate turns an object (only the kinds in ROTATABLE_KINDS). The
   * bounds are taken to be the box the turned object fills on the layout, not its box before the turn.
   */
  rotation?: 90 | 180 | 270;
  /** Hidden in Preview mode and when printed. */
  hideWhenPrinting?: true;
  /** Locked in Layout mode: it can be selected but not moved, resized or deleted. */
  locked?: true;
  /** Sliding & Visibility: in Preview mode and when printed, slides up and/or left over empty space, and the part shrinks with it. */
  sliding?: { up?: true; left?: true; resizePart?: true };
  /** Slide control: the navigation dots are hidden. */
  noDots?: true;
  /** Slide control: swipe gestures are off (inferred). */
  noSwipe?: true;
  /** Popover: its title bar shows (the title is in text, or label when it is a formula). */
  titleBar?: true;
  /** Placeholder text formula (fields) and tooltip formula. */
  placeholder?: string;
  tooltip?: string;
  /** Conditional formatting: when a formula is true, these style rules apply on top of the object's own. */
  conditions?: Condition[];
  /** Button bar segment: its label calculation. */
  label?: string;
  /**
   * Button bar: which segment shows as active. A segment's object id, or a
   * calculation that returns the segment's object name. Absent: none.
   */
  activeSegment?: number;
  activeSegmentFormula?: string;
  /** Tab panel: its tab's offset and width in the tab strip (0 width = sized to its label). */
  tab?: { left: number; width: number };
  /** Tab control: the height of its tabs. */
  tabHeight?: number;
  /** Chart: its type, where its data comes from, and its formulas. */
  chart?: Chart;
  /** Script triggers on the object (OnObjectEnter, OnObjectModify, ...). */
  triggers?: ScriptTrigger[];
  /** Tabularius only: this group is a placed copy of a layout component (see LayoutComponent); its children follow the component. */
  component?: { id: number };
  children?: LayoutObject[];
}

export type ChartType = 'column' | 'stacked-column' | 'bar' | 'stacked-bar' | 'line' | 'area' | 'pie' | 'scatter' | 'bubble';

/**
 * A chart (Chart Setup). Every text is a formula. Data formulas give one
 * value per record, or a ¶-separated list when the data comes from the
 * current record.
 */
/**
 * Web Viewer Setup's options. In the file they are the external object's
 * field 3 (11.3), the same number as the clipboard's and the Design Report's
 * externalFlagSet (Flicks: 32845 in both). Bits from Kear §15.1: 1 interaction,
 * 2 content in Find mode, 4 progress bar, 8 status messages, 32 URL encoding
 * OFF, 64 JavaScript may perform FileMaker scripts; 0x8000 marks objects made in
 * FileMaker 26 and later.
 */
export interface WebViewerOptions {
  interaction: boolean;
  findMode: boolean;
  progressBar: boolean;
  statusMessages: boolean;
  encodeUrl: boolean;
  jsBridge: boolean;
}

export function webViewerOptions(flags: number): WebViewerOptions {
  return { interaction: !!(flags & 1), findMode: !!(flags & 2), progressBar: !!(flags & 4), statusMessages: !!(flags & 8), encodeUrl: !(flags & 32), jsBridge: !!(flags & 64) };
}

/** Web Viewer Setup's options as externalFlagSet (FileMaker 26's marker bit included). */
export function webViewerFlags(o: WebViewerOptions): number {
  return 0x8000 | (o.interaction ? 1 : 0) | (o.findMode ? 2 : 0) | (o.progressBar ? 4 : 0) | (o.statusMessages ? 8 : 0) | (o.encodeUrl ? 0 : 32) | (o.jsBridge ? 64 : 0);
}

/** Web Viewer Setup's defaults (externalFlagSet 32781). */
export const WEB_VIEWER_DEFAULTS: WebViewerOptions = webViewerOptions(32781);

export interface Chart {
  type: ChartType;
  /** Current record (delimited data), the found set, or the records related through `occurrence`. */
  source: 'record' | 'found-set' | 'related';
  /** Found set: one data point per run of records with the same category (summarized data), not per record. */
  grouped?: boolean;
  /** Related records: their table occurrence. */
  occurrence?: string;
  title?: string;
  xTitle?: string;
  yTitle?: string;
  /** Category labels (the x axis of column, bar, line and area charts; the slices of a pie). */
  categories?: string;
  /** The value axis's minimum and maximum, when Chart Setup specifies them (formulas). */
  yMin?: string;
  yMax?: string;
  /** Each series: its values, its name, and for scatter and bubble charts its x values and bubble sizes. */
  series: { data: string; name?: string; x?: string; sizes?: string }[];
  /** Background: top and bottom of a gradient (CSS colors). */
  background?: [string, string];
  /** Text sizes (points) and colors of its parts. */
  text?: Record<'title' | 'xLabels' | 'xTitle' | 'yLabels' | 'yTitle' | 'legend', { size: number; color: string }>;
}

/** A script trigger: the script (and parameter formula) run when the event happens. */
export interface ScriptTrigger {
  event: string;
  scriptId: number;
  script?: string;
  parameter?: string;
  /** Modes the trigger runs in, when not Browse mode only (the Design Report's triggerFlags: 1 Browse, 2 Find, 4 Preview). */
  modes?: TriggerMode[];
}

export type TriggerMode = 'browse' | 'find' | 'preview';

/**
 * Trigger event codes. Matched from the names of the scripts the triggers run
 * in private sample files (an "… OnLayout Enter Trigger" script on 0x65, an
 * "… OnCommit Trigger" on 0x68, a "Tab Clicked" script on 7);
 * OnObjectValidate (6) and OnRecordRevert (0x69) are inferred from the order;
 * OnObjectAVPlayerChange (8) is the clipboard id Kear §18.1 gives (no sample uses it).
 */
const TRIGGER_EVENTS: Record<number, string> = {
  1: 'OnObjectEnter', 2: 'OnObjectExit', 3: 'OnObjectModify', 4: 'OnObjectSave', 5: 'OnObjectKeystroke',
  6: 'OnObjectValidate', 7: 'OnPanelSwitch', 8: 'OnObjectAVPlayerChange',
  0x65: 'OnLayoutEnter', 0x66: 'OnLayoutKeystroke', 0x67: 'OnRecordLoad', 0x68: 'OnRecordCommit', 0x69: 'OnRecordRevert',
  0x6a: 'OnModeEnter', 0x6b: 'OnModeExit', 0x6d: 'OnLayoutExit',
};

/**
 * Triggers live under node 48: child 5 holds one node per trigger, its key 1
 * 00 <event> <script id as [n+1][n][bytes]> 00 00 00 00 <modes>, and the
 * parameter formula at child 49.
 */
export function readTriggers(n: Node | undefined, schema: Schema | undefined, formula: (n: Node | undefined) => string | undefined, scriptNames = new Map(schema?.scripts.map((s) => [s.id, s.name]) ?? [])): ScriptTrigger[] {
  const out: ScriptTrigger[] = [];
  for (const [, t] of n?.child(5)?.children ?? []) {
    const b = t.kv.get(1);
    if (!b || b.length < 4) continue;
    const scriptId = pathValue(b.subarray(4, 4 + b[3]));
    if (!scriptId) continue;
    const trigger: ScriptTrigger = { event: TRIGGER_EVENTS[b[1]] ?? `Event${b[1]}`, scriptId };
    const script = scriptNames.get(scriptId);
    if (script) trigger.script = script;
    const mask = b[4 + b[3] + 4];
    if (mask !== undefined && mask !== 1) trigger.modes = (['browse', 'find', 'preview'] as const).filter((_, i) => mask & (1 << i));
    const parameter = formula(t.child(49));
    if (parameter) trigger.parameter = parameter;
    out.push(trigger);
  }
  return out;
}

/** The data source a button's Perform Script names in key 32 ([length][id]), when the file still has it. */
export function buttonFile(b: Uint8Array | undefined, schema: Schema): { id: number; name: string } | undefined {
  const id = shortRef(b);
  const source = id === undefined ? undefined : schema.dataSources.find((d) => d.id === id);
  return source ? { id: source.id, name: source.name } : undefined;
}

export interface LayoutPart {
  kind: PartKind;
  kindId: number;
  top: number;
  height: number;
  style: ObjectStyle;
  /** Sub-summary parts: the field whose value groups the records ("when sorted by"). */
  breakField?: FieldRef;
  /** Part Definition's printing options (not read from .fmp12 files yet). */
  options?: PartOptions;
}

/** How a part prints, as FileMaker's Part Definition sets it. */
export interface PartOptions {
  /** Start a new page before each occurrence. */
  pageBreakBefore?: boolean;
  /** Start a new page after every this many occurrences. */
  pageBreakEvery?: number;
  /** Page numbers start again at 1 after each occurrence. */
  restartPageNumbers?: boolean;
}

export interface LayoutDesign {
  id: number;
  name: string;
  tableOccurrenceId?: number;
  width?: number;
  themeId?: number;
  style: ObjectStyle;
  parts: LayoutPart[];
  objects: LayoutObject[];
  /** Columns of the layout's Table View, left to right. */
  tableView?: { field: FieldRef; width: number }[];
  /** The view the layout opens in (Layout Setup's default view). */
  view?: LayoutView;
  /** Script triggers on the layout (OnLayoutEnter, OnRecordLoad, ...). */
  triggers?: ScriptTrigger[];
  /** Set Tab Order: object ids in the order Tab visits them (absent: FileMaker's default order). */
  tabOrder?: number[];
  /** Layout Setup's menu set: 1 for [Standard FileMaker Menus], else a custom menu set's id; none for [File Default]. */
  menuSetId?: number;
  /*
   * Layout Setup options, set in Tabularius's design mode; absent means
   * FileMaker's default. Not decoded from files yet (see research notes).
   */
  /** Views tab: the views people may switch to; absent, all three. */
  viewsAllowed?: LayoutView[];
  /** "Save record changes automatically" unchecked: leaving a changed record asks first. */
  saveRecordChanges?: boolean;
  /** "Show current record indicator in List View" unchecked. */
  recordIndicator?: boolean;
  /** "Show field frames when record is active" unchecked. */
  fieldFrames?: boolean;
  /** Tabularius only: below this window width the web client stacks each part's objects in one column. */
  responsive?: { stackBelow?: number };
  /**
   * Printing tab: "Print in N columns", across first (the default) or down first. Records (body and sub-summary
   * parts) print side by side, each column the printable page width divided by N; anything of a part beyond the
   * first column's width isn't printed.
   */
  printColumns?: { count: number; order?: 'across' | 'down' };
  /** Printing tab: "Use fixed page margins", in points; they replace the file's page setup margins in Preview mode, browser printing and Save Records as PDF. */
  fixedMargins?: { top: number; left: number; bottom: number; right: number };
  /**
   * Tabularius only: a phone layout made from a desktop one (`of`), stacked at `width`. It is rebuilt when the desktop
   * layout changes while it still matches `synced` (what it showed when last rebuilt); once edited by hand it stays as edited.
   */
  phone?: { of: number; width: number; synced: string };
}

export type LayoutView = 'form' | 'list' | 'table';

/** Layout node kv 241, byte 6: 0x02 list, 0x40 table (with 0x02), neither form. */
export function readLayoutView(b: Uint8Array | undefined): LayoutView | undefined {
  if (!b || b.length < 8) return undefined;
  return b[6] & 0x40 ? 'table' : b[6] & 0x02 ? 'list' : 'form';
}

/**
 * The views Layout Setup allows (its three "Views" checkboxes), from byte 6 of
 * kv 241: 0x08 Form, 0x02 List, 0x40 Table. Every sample layout has at least
 * one set. Returned only when it isn't the default all-three, so a plain layout
 * stays plain. (Which of the allowed views a layout opens in is stored
 * elsewhere and still decodes through readLayoutView.)
 */
export function readViewsAllowed(b: Uint8Array | undefined): LayoutView[] | undefined {
  if (!b || b.length < 8) return undefined;
  const views: LayoutView[] = [];
  if (b[6] & 0x08) views.push('form');
  if (b[6] & 0x02) views.push('list');
  if (b[6] & 0x40) views.push('table');
  if (!views.length || views.length === 3) return undefined;
  return views;
}

export interface LayoutDesigns {
  layouts: LayoutDesign[];
  themes: Theme[];
  /** Tabularius only: reusable groups of objects placed on layouts. */
  components?: LayoutComponent[];
}

/**
 * Tabularius only (FileMaker has no such thing): a group of objects, such as a
 * header, a navigation bar or an address block, saved once and placed on many
 * layouts. Each placed copy is a group object marked with the component's id;
 * changing the component changes every copy. Detaching a copy (dropping the
 * mark) leaves a plain group that no longer follows it.
 */
export interface LayoutComponent {
  id: number;
  name: string;
  width: number;
  height: number;
  /** Its objects, with bounds measured from the component's top left corner. */
  objects: LayoutObject[];
  /** Tabularius only: a copy of a component in the server's library (shared across files), at this version. */
  library?: { id: string; version: number };
}

/**
 * Set Tab Order (layout node child 21): one kv per stop, in key order from
 * 129 (keys of removed stops leave gaps). Each value is 0, the length of
 * the object id that follows ([len][id]) and four trailing bytes.
 */
export function readTabOrder(n: Node | undefined): number[] | undefined {
  if (!n?.kv.size) return undefined;
  const ids: number[] = [];
  for (const k of [...n.kv.keys()].sort((a, b) => a - b)) {
    const v = n.kv.get(k)!;
    const id = v[0] === 0 ? lpIds(v.subarray(2, 2 + v[1]))[0] : undefined;
    if (id !== undefined) ids.push(id);
  }
  return ids.length ? ids : undefined;
}

/** A value stored either inline as segment `key` or as a long value in child `key`. */
function blob(n: Node, key: number): Uint8Array | undefined {
  return n.segments.get(key) ?? n.kv.get(key) ?? n.child(key)?.longBytes();
}

/** Length-prefixed id lists ("[len][bytes]..."), used by theme refs and step parameters. */
function lpIds(b: Uint8Array | undefined, at = 0): number[] {
  const out: number[] = [];
  while (b && at < b.length) {
    const len = b[at++];
    if (len === 0 || at + len > b.length) break;
    const v = pathValue(b.subarray(at, at + len));
    if (v === undefined) break;
    out.push(v);
    at += len;
  }
  return out;
}

function readBounds(m: Pb | undefined): Bounds {
  const n = (k: number) => Math.round((m?.num(k) ?? 0) * 100) / 100;
  return { top: n(1), left: n(2), bottom: n(3), right: n(4) };
}

function readStyle(m: Pb | undefined, fonts: FontTable): ObjectStyle {
  const s: ObjectStyle = {};
  if (!m) return s;
  const rules = readRules(m.msg(1), fonts);
  if (rules.length) s.rules = rules;
  const name = m.str(2);
  if (name) s.name = name;
  const el = m.num(3);
  if (el !== undefined) s.element = el;
  const display = m.str(4);
  if (display) s.displayName = display;
  return s;
}

function fieldRef(m: Pb | undefined): { tableOccurrenceId: number; fieldId: number; repetition: number } | undefined {
  const to = m?.num(1);
  const field = m?.num(2);
  if (to === undefined || field === undefined || to <= TO_BASE) return undefined;
  return { tableOccurrenceId: to - TO_BASE, fieldId: field, repetition: m?.num(3) ?? 1 };
}

/** Replaces FileMaker's encoded merge fields (<<\x01\x02\x0e[hex]>>) with <<TO::Field>>. */
export function decodeMergeFields(text: string, name: (to: number, field: number) => string | undefined): string {
  return text.replace(/<<[\x00-\x1f]{1,3}([0-9A-Fa-f]+)>>/g, (all, hex: string) => {
    const b = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
    // u16 length + TO id, then u8 length + field-reference payload.
    if (b.length < 4) return all;
    const toLen = (b[0] << 8) | b[1];
    const to = pathValue(b.subarray(2, 2 + toLen));
    if (to === undefined) return all;
    const at = 2 + toLen;
    const payload = b.subarray(at + 1, at + 1 + b[at]);
    // A repeating field is stored as [field id byte][repetition byte]; a plain
    // field as a single length-prefixed id. Try the repeating form first — if
    // its leading byte names a real field of this occurrence, use it (with its
    // 1-based repetition) — then fall back to reading the whole payload as one
    // id (a large id, or a field of another file named once that file is open;
    // see externalFieldNames).
    if (payload.length === 2) {
      const named = name(to, payload[0]);
      if (named) return `<<${named}${payload[1] > 1 ? `[${payload[1]}]` : ''}>>`;
    }
    const field = pathValue(payload);
    if (field === undefined) return all;
    return `<<${name(to, field) ?? `⟨field:${to}.${field}⟩`}>>`;
  });
}

function schemaIndex(schema: Schema) {
  return {
    layouts: new Map(schema.layouts.map((item) => [item.id, item.name])),
    scripts: new Map(schema.scripts.map((item) => [item.id, item.name])),
    occurrences: new Map(schema.tableOccurrences.map((item) => [item.id, item])),
    tables: new Map(schema.tables.map((item) => [item.id, item.name])),
    fields: new Map(schema.tables.map((item) => [item.id, new Map(item.fields.map((field) => [field.id, field.name]))])),
    sources: new Map(schema.dataSources.map((item) => [item.id, item.name])),
    menuSets: new Map(schema.customMenuSets?.map((item) => [item.id, item.name]) ?? []),
    valueLists: new Map(schema.valueLists.map((item) => [item.id, item.name])),
  };
}
type SchemaIndex = ReturnType<typeof schemaIndex>;

interface Ctx {
  layoutId: number;
  schema?: Schema;
  index?: SchemaIndex;
  fonts: FontTable;
  nodes: Node | undefined;
  byId: Map<number, Pb>;
  seen: Set<number>;
  formula: (n: Node | undefined) => string | undefined;
}

/** Names for decoding a button's step options, as a script's steps are decoded. */
function paramContext(ctx: Ctx): ParamContext {
  const s = ctx.schema!;
  const index = ctx.index ?? schemaIndex(s);
  return {
    formula: ctx.formula,
    layoutName: (id) => index.layouts.get(id),
    scriptName: (id) => index.scripts.get(id),
    tableOccurrenceName: (id) => index.occurrences.get(id)?.name,
    tableName: (id) => index.tables.get(id),
    fieldName: (to, field) => {
      const occurrence = index.occurrences.get(to);
      if (occurrence?.dataSourceId) return `⟨field:${field}⟩`; // lives in another file
      return index.fields.get(occurrence?.baseTableId ?? -1)?.get(field);
    },
    dataSourceName: (id) => index.sources.get(id),
    menuSetName: (id) => index.menuSets.get(id),
  };
}

/** Decodes the calculation stored at a node (key 5 tokens), or undefined. */
// Chart Setup (object node 139.138), big-endian: 8 the type, 44 and 48 the
// background gradient, 113 3 when found set data is summarized, 117 the data
// source (1 current record, 2 found set, 3 related records, followed by the
// related table occurrence as a tagged id). The series count is 164 bytes
// after the second font record (u32 13, font, style, flags and u16 size, RGBA), which
// starts at 132 unless a related table occurrence comes first; it and the
// records 40, 61, 101, 122 and 147 bytes after it are the title, x axis labels,
// x axis title, y axis labels, y axis title and legend. Formulas are
// node children: 128 title, 129 x axis title, 130 y axis title, 131
// categories, then 133 + 2i the data and 134 + 2i the name of series i of n;
// scatter and bubble charts keep series i's x values at 133 + 2n + 2i, and
// bubble charts its sizes at 133 + 4n + 2i. The value axis's minimum and
// maximum are children 142 + 2k and 143 + 2k, set when the byte 260 + 25k
// after the second font record has 0x10 (minimum) or 0x20 (maximum), where
// the blob is 1110 + 25k bytes long (not counting a related table occurrence).
// HYPOTHESIS: these binary positions are inferred from existing reader research;
// public Claris documentation describes the controls, not their file encoding.
const CHART_TYPES: Record<number, ChartType> = {
  0: 'column', 1: 'bar', 2: 'line', 3: 'area', 4: 'pie', 6: 'stacked-column', 7: 'stacked-bar', 8: 'bubble', 9: 'scatter',
};

export function readChart(ctx: Pick<Ctx, 'schema' | 'formula'>, node: Node | undefined): Chart | undefined {
  const blob = node?.child(139, 138)?.longBytes();
  if (!blob || blob.length < 140) return undefined;
  const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const u32 = (at: number) => (at + 4 <= blob.length ? v.getUint32(at) : 0);
  const color = (at: number) => {
    const [r, g, b, a] = blob.subarray(at, at + 4);
    return a === 255 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${Math.round((a / 255) * 1000) / 1000})`;
  };
  const kind = u32(117);
  const type = CHART_TYPES[u32(8)];
  // An unknown code must not be rendered as a different chart or data source.
  if (!type || (kind !== 1 && kind !== 2 && kind !== 3)) return undefined;
  const chart: Chart = {
    type,
    source: kind === 3 ? 'related' : kind === 2 ? 'found-set' : 'record',
    series: [],
  };
  if (chart.source === 'found-set' && u32(113) === 3) chart.grouped = true;
  if (chart.source === 'related') {
    const at = blob.indexOf(0x04, 121);
    const to = at > 0 && at < 130 ? pathValue(blob.subarray(at + 2, at + 2 + blob[at + 1])) : undefined;
    const name = to !== undefined ? toName(ctx, to) : undefined;
    if (name) chart.occurrence = name;
  }
  chart.background = [color(44), color(48)];
  const f = (k: number) => ctx.formula(node?.child(k, 5));
  const set = (key: 'title' | 'xTitle' | 'yTitle' | 'categories', k: number) => {
    const formula = f(k);
    if (formula) chart[key] = formula;
  };
  set('title', 128);
  set('xTitle', 129);
  set('yTitle', 130);
  set('categories', 131);
  let font = -1;
  for (let at = 128; at + 16 <= blob.length && font < 0; at++) {
    if (u32(at) === 13 && (u32(at + 8) & 0xffff) > 0 && (u32(at + 8) & 0xffff) < 200) font = at;
  }
  // Font records from the second on: the title, x axis labels and title, y axis labels and title, the legend.
  if (font >= 0) {
    const text = (at: number) => ({ size: u32(at + 8) & 0xffff, color: color(at + 12) });
    chart.text = {
      title: text(font), xLabels: text(font + 40), xTitle: text(font + 61),
      yLabels: text(font + 101), yTitle: text(font + 122), legend: text(font + 147),
    };
  }
  // Value axis bounds: the Charts sample's random 1-10 line charts fix it at 0-10, its 0-100 scores at 0-100.
  const k = font >= 0 ? (blob.length - (font - 132) - 1110) / 25 : -1;
  if (Number.isInteger(k) && k >= 0 && font + 260 + 25 * k < blob.length) {
    const flags = blob[font + 260 + 25 * k];
    const min = flags & 0x10 ? f(142 + 2 * k) : undefined;
    const max = flags & 0x20 ? f(143 + 2 * k) : undefined;
    if (min) chart.yMin = min;
    if (max) chart.yMax = max;
  }
  const count = font >= 0 ? u32(font + 164) : 0;
  // HYPOTHESIS: without a plausible encoded count, formula slots cannot be
  // assigned to series safely. Leave the setup unread for aggregate census.
  if (count < 1 || count > 32) return undefined;
  for (let i = 0; i < count; i++) {
    const data = f(133 + 2 * i);
    if (!data) continue;
    const s: Chart['series'][number] = { data };
    const name = f(134 + 2 * i);
    if (name) s.name = name;
    if (chart.type === 'scatter' || chart.type === 'bubble') {
      // A series without its own x values uses the first series' x values.
      const x = f(133 + 2 * count + 2 * i) ?? chart.series[0]?.x;
      if (x) s.x = x;
    }
    if (chart.type === 'bubble') {
      const sizes = f(133 + 4 * count + 2 * i);
      if (sizes) s.sizes = sizes;
    }
    chart.series.push(s);
  }
  return chart;
}

function formulaReader(schema: Schema | undefined): (n: Node | undefined) => string | undefined {
  const field = schema ? schemaFieldNamer(schema) : undefined;
  const cfs = new Map(schema?.customFunctions.map((c) => [c.id, c.name]) ?? []);
  return (n) => {
    const tokens = calcTokens(n);
    if (!tokens?.length) return undefined;
    try {
      return decodeCalc(tokens, field, (id) => cfs.get(id) ?? '<Function Missing>').text;
    } catch (error) {
      if (error instanceof CalcDecodeError) throw error;
      return undefined;
    }
  };
}

/**
 * A condition's format stores a whole style, but only what was ticked in the
 * Conditional Formatting dialog applies. Its field 1 is a mask (inferred from
 * a private sample): 2 text color, 4 fill color, 128 icon color. Bold, italic,
 * underline and strikethrough are stored as on or off; off means "leave as is".
 */
function conditionRules(mask: number, rules: StyleRule[]): StyleRule[] {
  const drop: Record<string, boolean> = {
    color: !(mask & 2),
    'background-color': !(mask & 4),
    '--fm-icon-color': !(mask & 128),
  };
  const out: StyleRule[] = [];
  for (const r of rules) {
    const css: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.css)) {
      if (drop[k] || (k === 'font-weight' && v !== 'bold') || (k === 'font-style' && v !== 'italic') || (k === 'text-decoration-line' && v === 'none')) continue;
      css[k] = v;
    }
    if (Object.keys(css).length) out.push({ ...r, css });
  }
  return out;
}

/**
 * Node k13 of a field object, a fixed-layout block whose fields follow the
 * Design Report's NumFormat, DateFormat and TimeFormat (offsets checked
 * against a private sample and Charts):
 *
 * - number: 2 flags (u16), 5 negative style, 6 currency symbol (6 UTF-16
 *   chars), 18 thousands separator, 20 decimal point, 22 negative color
 *   (r, g, b, 0), 26 decimal digits, 28 and 44 boolean texts (8 chars).
 *   Flags: 0x0001 no formatting, 0x0002 thousands separator, 0x0004
 *   notation, 0x0008 fixed decimals, 0x0010 percent, 0x0020 boolean, 0x0100
 *   general, 0x0400 notation outside negative, 0x0800 leading currency,
 *   0x1000 negative color, 0x2000 blank if zero.
 * - date: 60 format (0 as entered), 62 month and 63 day padding (0 none, 1
 *   zero, 2 space), 64 separator (u16), 66 four custom elements, then five
 *   16-byte separators at 70, 86, 102, 118 and 134.
 * - time: 151 flags (0x01 hour, 0x02 minutes, 0x04 seconds, 0x08 as entered,
 *   0x10 24-hour, 0x20 suffix before a 24-hour time, 0x40 AM/PM before the
 *   time), 153 hour and 154 minute/second padding, 156 separator, 158 AM,
 *   174 PM and 190 24-hour suffix texts.
 */
function readDataFormat(b: Uint8Array | undefined): DataFormat | undefined {
  if (!b || b.length < 206) return undefined;
  const u16 = (at: number) => (b[at] << 8) | b[at + 1];
  const chars = (at: number, n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = u16(at + i * 2);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const pad = (v: number) => (v === 1 ? '0' : v === 2 ? ' ' : '');
  const out: DataFormat = {};
  const flags = u16(2);
  if (!(flags & 0x0101)) {
    const n: NumberFormat = { decimalPoint: String.fromCharCode(u16(20) || 46) };
    if (flags & 0x20) n.boolean = { true: chars(28, 8), false: chars(44, 8) };
    if (flags & 0x08) n.decimals = u16(26);
    if (flags & 0x02) n.thousands = String.fromCharCode(u16(18) || 44);
    if (flags & 0x04) {
      n.notation = flags & 0x10 ? '%' : chars(6, 6);
      if (!(flags & 0x10) && flags & 0x0800) n.leading = true;
      if (flags & 0x0400) n.outside = true;
    }
    if (b[5]) n.negativeStyle = b[5];
    if (flags & 0x1000) n.negativeColor = `rgb(${b[22]} ${b[23]} ${b[24]})`;
    if (flags & 0x2000) n.blankIfZero = true;
    out.number = n;
  }
  if (b[60] >= 1 && b[60] <= 7) {
    const d: DateFormat = { style: b[60], monthPad: pad(b[62]), dayPad: pad(b[63]), separator: String.fromCharCode(u16(64) || 47) };
    if (d.style === 1) {
      d.elements = [...b.subarray(66, 70)];
      d.separators = [70, 86, 102, 118, 134].map((at) => chars(at, 8));
    }
    out.date = d;
  }
  // Byte 211: the container format (pictFormat). 4, 5 and 7 all appear on the
  // samples' container fields; Kear §5.4 gives the meanings.
  const pict = CONTAINER_FORMATS[b[211]];
  if (pict) out.container = pict;
  const time = b[151];
  if (time & 0x01 && !(time & 0x08)) {
    const h24 = !!(time & 0x10);
    out.time = {
      minutes: !!(time & 0x02),
      seconds: !!(time & 0x02 && time & 0x04),
      h24,
      hourPad: pad(b[153]),
      minSecPad: pad(b[154]),
      separator: String.fromCharCode(u16(156) || 58),
      am: h24 ? chars(190, 8) : chars(158, 8),
      pm: h24 ? chars(190, 8) : chars(174, 8),
      prefix: !!(time & (h24 ? 0x20 : 0x40)),
    };
  }
  return out.number || out.date || out.time || out.container ? out : undefined;
}

/**
 * A portal's sort order (object node k10): [u32 count], then per field a
 * length-prefixed table occurrence and field (each itself length-prefixed),
 * nine fixed bytes, [01][order] (0 ascending, 1 descending, 2 custom order),
 * for a custom order the value list as a length-prefixed id, then padding.
 * Checked against a private sample whose "primary" portals sort by the Boolean
 * value list; descending (1) is inferred from the order of the options.
 */
export function readPortalSort(ctx: Pick<Ctx, 'schema' | 'index'>, b: Uint8Array | undefined): NonNullable<NonNullable<LayoutObject['portal']>['sort']> {
  const out: NonNullable<NonNullable<LayoutObject['portal']>['sort']> = [];
  if (!b || b.length < 4) return out;
  const count = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  let at = 4;
  for (let i = 0; i < count && at < b.length; i++) {
    const toLen = b[at];
    const [to] = lpIds(b.subarray(at + 1, at + 1 + toLen));
    at += 1 + toLen;
    const fieldLen = b[at];
    const [field] = lpIds(b.subarray(at + 1, at + 1 + fieldLen));
    at += 1 + fieldLen + 9;
    const order = b[at] === 1 ? b[at + 1] : 0;
    at += 2;
    if (to === undefined || field === undefined) break;
    const entry: (typeof out)[number] = { field: resolveRef(ctx, { tableOccurrenceId: to, fieldId: field }) };
    if (order === 1) entry.descending = true;
    if (order === 2) {
      const [vl] = lpIds(b, at);
      if (vl !== undefined) {
        entry.valueListId = vl;
        const name = ctx.index ? ctx.index.valueLists.get(vl) : ctx.schema?.valueLists.find((v) => v.id === vl)?.name;
        if (name) entry.valueList = name;
      }
    }
    out.push(entry);
    // The next field starts at the next length-prefixed reference.
    while (at < b.length && !(b[at] >= 2 && b[at + 1] === b[at] - 1 && b[at + 1] > 0)) at++;
  }
  return out;
}

function toName(ctx: Pick<Ctx, 'schema' | 'index'>, id: number): string | undefined {
  return ctx.index ? ctx.index.occurrences.get(id)?.name : ctx.schema?.tableOccurrences.find((t) => t.id === id)?.name;
}

function fieldName(ctx: Pick<Ctx, 'schema' | 'index'>, to: number, field: number): string | undefined {
  const occ = ctx.index ? ctx.index.occurrences.get(to) : ctx.schema?.tableOccurrences.find((t) => t.id === to);
  if (!occ || occ.dataSourceId) return undefined;
  return ctx.index ? ctx.index.fields.get(occ.baseTableId ?? -1)?.get(field) : ctx.schema?.tables.find((t) => t.id === occ.baseTableId)?.fields.find((f) => f.id === field)?.name;
}

function resolveRef(ctx: Pick<Ctx, 'schema' | 'index'>, r: { tableOccurrenceId: number; fieldId: number }): FieldRef {
  const ref: FieldRef = { tableOccurrenceId: r.tableOccurrenceId, fieldId: r.fieldId };
  const t = toName(ctx, r.tableOccurrenceId);
  if (t) ref.tableOccurrence = t;
  const f = fieldName(ctx, r.tableOccurrenceId, r.fieldId);
  if (f) ref.field = f;
  return ref;
}

function readObject(ctx: Ctx, m: Pb, origin: { top: number; left: number }, depth = 1): LayoutObject | undefined {
  const id = m.num(2);
  const type = m.num(1) ?? 0;
  if (id === undefined || ctx.seen.has(id)) return undefined;
  if (depth > MAX_OBJECT_DEPTH) {
    throw new FmpError(`layout ${ctx.layoutId}: object ${id} exceeds nesting depth ${MAX_OBJECT_DEPTH}`);
  }
  ctx.seen.add(id);
  const rel = readBounds(m.msg(4));
  const bounds = {
    top: rel.top + origin.top, left: rel.left + origin.left,
    bottom: rel.bottom + origin.top, right: rel.right + origin.left,
  };
  const flags = m.num(3) ?? 0;
  const bit = (n: number) => Math.floor(flags / 2 ** n) % 2 === 1;
  const obj: LayoutObject = {
    id, type, kind: OBJECT_KINDS[type] ?? 'unknown', bounds,
    anchors: { left: bit(28), top: bit(29), right: bit(30), bottom: bit(31) },
    style: (styleScope.object = id, readStyle(m.msg(5), ctx.fonts)),
  };
  styleScope.object = undefined;
  const node = ctx.nodes?.child(id);
  const name = node?.text(16);
  if (name) obj.name = name;
  const text = node?.textOrLong(1);
  if (text) obj.text = decodeMergeFields(text, (to, f) => {
    const t = toName(ctx, to);
    const n = fieldName(ctx, to, f);
    return t && n ? `${t}::${n}` : undefined;
  });

  // Object calculations: 141 hide condition, 6 placeholder, 3 tooltip (checked against the Design Report).
  const hide = ctx.formula(node?.child(141));
  // Object flags: bit8 Apply in Find mode, bit9 Hide when printing (both from
  // andykear/FileMaker-XMLsnippet-Layout-Claude-Skill's clipboard decode; across
  // the samples bit8 is set on 350 objects with a hide condition and 2 without,
  // where bit0, read before, is on 548 objects that have none).
  if (hide) obj.hide = { formula: hide, inFind: bit(8) };
  if (bit(9)) obj.hideWhenPrinting = true;
  // bit1 Locked, bit4 Slide up, bit5 Slide left, bit6 Resize enclosing part (Kear §2.1;
  // the clipboard, the DDR and the file share these bits).
  if (bit(1)) obj.locked = true;
  if (bit(4) || bit(5)) obj.sliding = { ...(bit(4) ? { up: true } : {}), ...(bit(5) ? { left: true } : {}), ...(bit(6) ? { resizePart: true } : {}) } as LayoutObject['sliding'];
  const placeholder = ctx.formula(node?.child(6));
  if (placeholder) obj.placeholder = placeholder;
  const tooltip = ctx.formula(node?.child(3));
  if (tooltip) obj.tooltip = tooltip;
  // Conditional formatting (138): one child per condition from 128, each with
  // its formula at 5 and the format at k13 (a protobuf whose 2 is a style).
  const conditions: Condition[] = [];
  for (const [n, c] of node?.child(138)?.numbered() ?? []) {
    if (n < 128) continue;
    const formula = ctx.formula(c.child(5));
    if (!formula) continue;
    const format = Pb.parse(c.kv.get(13));
    conditions.push({ formula, rules: conditionRules(format?.num(1) ?? 0, readRules(format?.msg(2)?.msg(1), ctx.fonts)) });
  }
  if (conditions.length) obj.conditions = conditions;
  const triggers = readTriggers(node?.child(48), ctx.schema, ctx.formula);
  if (triggers.length) obj.triggers = triggers;

  switch (type) {
    case 1: {
      const f = m.msg(8);
      const ref = fieldRef(f?.msg(2));
      if (!f || !ref) break;
      const reps = f.num(3) ?? 1;
      obj.field = {
        ...resolveRef(ctx, ref),
        display: FIELD_DISPLAYS[f.num(5) ?? 0] ?? 'edit',
        repetitions: reps >= 1 && reps < 1000 ? reps : 1,
      };
      const behavior = readFieldBehavior(f.num(1) ?? 0);
      if (behavior) obj.field.behavior = behavior;
      const format = readDataFormat(ctx.nodes?.child(id)?.kv.get(13));
      if (format) obj.field.format = format;
      const vl = f.num(6);
      if (vl) {
        obj.field.valueListId = vl;
        const name = ctx.index ? ctx.index.valueLists.get(vl) : ctx.schema?.valueLists.find((v) => v.id === vl)?.name;
        if (name) obj.field.valueList = name;
      }
      break;
    }
    case 3:
      obj.imageId = m.msg(10)?.num(1);
      break;
    case 9: {
      const p = m.msg(15);
      const to = p?.num(2);
      if (p && to !== undefined) {
        obj.portal = { tableOccurrenceId: to - TO_BASE, rows: p.num(6) ?? 1, initialRow: p.num(7) ?? 1 };
        const t = toName(ctx, to - TO_BASE);
        if (t) obj.portal.tableOccurrence = t;
        // Portal Setup flags (the DDR's portalFlags): bit0 vertical scrolling,
        // bit2 deletion, bit3 sort, bit7 filter, bit8 scroll bar only while
        // scrolling. FileMaker keeps the sort and filter after they are
        // switched off, so they count only with their bit.
        const flags = p.num(3) ?? 0;
        const sort = flags & 8 ? readPortalSort(ctx, node?.kv.get(10)) : [];
        if (sort.length) obj.portal.sort = sort;
        const filter = flags & 0x80 ? ctx.formula(node?.child(37)) : undefined;
        if (filter) obj.portal.filter = filter;
        if (flags & 1) obj.portal.scrolling = true;
        if (flags & 1 && flags & 0x100) obj.portal.scrollBarWhenScrolling = true;
        if (flags & 4) obj.portal.allowDelete = true;
      }
      break;
    }
    case 8: case 10: case 14: {
      const a = m.msg(type === 10 ? 16 : type === 8 ? 12 : 17);
      const step = a?.msg(3);
      const stepId = step?.num(1);
      if (stepId) {
        // Parameters: [length][id bytes as [n][n bytes]]...
        const param = lpIds(step?.bytes(4), 1)[0];
        obj.action = { stepId, step: scriptStepName(stepId) };
        if (param !== undefined) obj.action.param = param;
        if (stepId === 1 && param !== undefined) {
          obj.action.scriptId = param;
          const parameter = ctx.formula(node?.child(17, 128, 5));
          if (parameter) obj.action.parameter = parameter;
          // A script in another file keeps its data source in key 32 of the step's options, as a Perform Script step
          // does; that id is the other file's, so the script's name is not looked up here. A data source the file no
          // longer has leaves the button as it was (read as this file's script).
          const file = ctx.schema ? buttonFile(node?.child(17)?.kv.get(32), ctx.schema) : undefined;
          if (file) obj.action.file = file;
          else {
            const s = ctx.index ? ctx.index.scripts.get(param) : ctx.schema?.scripts.find((x) => x.id === param)?.name;
            if (s) obj.action.script = s;
          }
        }
        if (stepId === 6 && param !== undefined) {
          obj.action.layoutId = param;
          const l = ctx.index ? ctx.index.layouts.get(param) : ctx.schema?.layouts.find((x) => x.id === param)?.name;
          if (l) obj.action.layout = l;
        }
        // A one-step button stores what a script step keeps in bytes 6-27 of its
        // 28-byte record in its key 4, and its options in node child 17, as a
        // script step keeps them at [script].5.[instance] (checked on Set Field,
        // Go to Object, Sort and Go to Related Record buttons against the same steps in scripts).
        if (stepId !== 1 && ctx.schema) {
          const rec = new Uint8Array(28);
          rec.set((step?.bytes(4) ?? new Uint8Array()).subarray(0, 22), 6);
          try {
            const params = decodeStepParams(stepId, rec, node?.child(17), paramContext(ctx));
            if (params && Object.keys(params).length) obj.action.params = params;
          } catch {
            // options not understood; the button still shows
          }
        }
      }
      // A button bar segment's label is a calculation (child 2), not text.
      const label = obj.text === undefined ? ctx.formula(node?.child(2)) : undefined;
      const literal = label && /^"((?:[^"\\]|\\.)*)"$/.exec(label);
      if (literal) obj.text = literal[1].replace(/\\(.)/g, '$1');
      else if (label) obj.label = label;
      if (type === 14) obj.target = a?.num(3);
      const icon = type === 8 ? undefined : a?.num(4);
      if (icon) obj.icon = { imageId: icon, size: a?.num(5) ?? 12, display: ICON_DISPLAYS[a?.num(6) ?? 0] ?? 'label' };
      break;
    }
    case 11: {
      // 3 the tab height, 5 the default front panel.
      const t = m.msg(13);
      obj.target = t?.num(5);
      const height = t?.num(3);
      if (height) obj.tabHeight = height;
      break;
    }
    case 15: {
      // Popover: the title is a calculation (child 2); field 18.1 bit1 hides the
      // title bar (inferred: 135 of the samples' 210 popovers with it set keep
      // the default title "Popover", against 8 of 120 without it).
      const title = ctx.formula(node?.child(2));
      const literal = title && /^"((?:[^"\\]|\\.)*)"$/.exec(title);
      if (literal) obj.text = literal[1].replace(/\\(.)/g, '$1');
      else if (title) obj.label = title;
      if (!((m.msg(18)?.num(1) ?? 0) & 2)) obj.titleBar = true;
      break;
    }
    case 16:
      // Slide control flags (the clipboard's slideFlagSet): bit0 hides the dots;
      // bit1 turns swipe gestures off (inferred: like bit0 it marks a change from
      // the defaults, and it is set on the 65 script-driven slide
      // controls of a private sample but not on DEMO_drawers' 2).
      const slide = m.msg(19)?.num(1) ?? 0;
      if (slide & 1) obj.noDots = true;
      if (slide & 2) obj.noSwipe = true;
      break;
    case 12: {
      const t = m.msg(14);
      obj.tab = { left: t?.num(2) ?? 0, width: t?.num(3) ?? 0 };
      break;
    }
    case 13: {
      const fourcc = m.msg(11)?.num(1);
      if (fourcc) obj.external = String.fromCharCode(fourcc >>> 24, (fourcc >>> 16) & 255, (fourcc >>> 8) & 255, fourcc & 255);
      if (obj.external === 'CHRT') {
        obj.kind = 'chart';
        const chart = readChart(ctx, node);
        if (chart) obj.chart = chart;
      } else if (obj.external === 'WEBV') {
        // Web Viewer Setup's address: a formula at child 128 (a private sample builds data:text/html URLs from a field).
        const url = ctx.formula(node?.child(128, 5));
        if (url && url !== '""') obj.webUrl = url;
        const flags = m.msg(11)?.num(3);
        if (flags !== undefined) obj.webOptions = webViewerOptions(flags);
      }
      break;
    }
  }

  // Children are positioned relative to their parent; portal rows start inside its border.
  const inset = type === 9 ? 1 : 0;
  const kids: LayoutObject[] = [];
  for (const c of m.nums(6)) {
    const cm = ctx.byId.get(c);
    const child = cm && readObject(ctx, cm, { top: bounds.top + inset, left: bounds.left + inset }, depth + 1);
    if (child) kids.push(child);
  }
  if (kids.length) obj.children = kids;
  if (type === 18 && kids.length) layoutButtonBar(obj, kids);
  if (type === 18) {
    const active = readActiveSegment(m.msg(21), kids.map((k) => k.id));
    if (active === 'formula') {
      const formula = ctx.formula(node?.child(142));
      if (formula && formula !== '""') obj.activeSegmentFormula = formula;
    } else if (active !== undefined) obj.activeSegment = active;
  }
  return obj;
}

/**
 * Button bar segments are stored stacked top to bottom with heights in
 * proportion to their share of the bar (inferred). For a bar wider than it
 * is tall, lay them out left to right instead.
 */
function layoutButtonBar(bar: LayoutObject, segments: LayoutObject[]): void {
  const { top, left, bottom, right } = bar.bounds;
  if (right - left <= bottom - top) return;
  const total = segments.reduce((n, s) => n + (s.bounds.bottom - s.bounds.top), 0) || segments.length;
  let x = left;
  for (const s of segments) {
    const share = total === segments.length ? 1 : s.bounds.bottom - s.bounds.top;
    const w = ((right - left) * share) / total;
    s.bounds = { top, bottom, left: Math.round(x * 100) / 100, right: Math.round((x + w) * 100) / 100 };
    x += w;
  }
}

function readParts(n: Node | undefined, fonts: FontTable, schema: Schema | undefined): LayoutPart[] {
  const parts: LayoutPart[] = [];
  for (const [, p] of n?.numbered() ?? []) {
    const m = Pb.parse(blob(p, 2));
    if (!m) continue;
    const kindId = m.num(1) ?? 4;
    parts.push({
      kind: PART_KINDS[kindId] ?? 'unknown', kindId,
      top: m.num(4) ?? 0, height: m.num(5) ?? 0,
      style: readStyle(m.msg(10), fonts),
    });
    // 6: [8][length][0] then the table occurrence and field as length-prefixed ids.
    const brk = m.bytes(6);
    if (brk?.[0] === 8) {
      const [to, field] = lpIds(brk, 3);
      if (to !== undefined && field !== undefined) parts[parts.length - 1].breakField = resolveRef({ schema }, { tableOccurrenceId: to, fieldId: field });
    }
  }
  return parts.sort((a, b) => a.top - b.top);
}

/**
 * Button Bar Setup's Active Segment (object field 21): 1 is "None", 0 a
 * segment (its object id in field 2), 2 "Specify", a calculation kept in the
 * object's node 142 that returns the segment's object name.
 */
export function readActiveSegment(m: Pb | undefined, segments: number[]): number | 'formula' | undefined {
  if (m?.num(1) === 2) return 'formula';
  const id = m?.num(2);
  return m?.num(1) === 0 && id !== undefined && segments.includes(id) ? id : undefined;
}

function readObjects(design: Node, schema: Schema | undefined, fonts: FontTable, layoutId: number, formula = formulaReader(schema), index = schema && schemaIndex(schema)): LayoutObject[] {
  const m = Pb.parse(blob(design, 7));
  if (!m) return [];
  const byId = new Map<number, Pb>();
  for (const o of m.msgs(2)) {
    const id = o.num(2);
    if (id !== undefined) byId.set(id, o);
  }
  const ctx: Ctx = { layoutId, schema, index, fonts, nodes: design.child(5), byId, seen: new Set(), formula };
  const out: LayoutObject[] = [];
  const top = m.nums(1);
  for (const id of top.length ? top : [...byId.keys()]) {
    const o = byId.get(id);
    const obj = o && readObject(ctx, o, { top: 0, left: 0 });
    if (obj) out.push(obj);
  }
  return out;
}

function readTableView(design: Node | undefined, schema: Schema | undefined, fonts: FontTable, layoutId: number, formula = formulaReader(schema), index = schema && schemaIndex(schema)): LayoutDesign['tableView'] {
  if (!design) return undefined;
  const cols: { field: FieldRef; width: number; left: number }[] = [];
  const walk = (objs: LayoutObject[]) => {
    for (const o of objs) {
      if (o.field) {
        const { display, repetitions, valueListId, valueList, behavior, ...field } = o.field;
        cols.push({ field, width: o.bounds.right - o.bounds.left, left: o.bounds.left });
      }
      if (o.children && o.kind !== 'portal') walk(o.children);
    }
  };
  walk(readObjects(design, schema, fonts, layoutId, formula, index));
  if (!cols.length) return undefined;
  return cols.sort((a, b) => a.left - b.left).map(({ field, width }) => ({ field, width }));
}

export function readFonts(file: FmpFile): FontTable {
  const root = buildTree(file, () => true, file.chunks(undefined, [25, 5]));
  const fonts: FontTable = new Map();
  for (const [id, f] of root.child(25, 5)?.numbered() ?? []) {
    const name = f.text(16);
    if (name) fonts.set(id, name);
  }
  return fonts;
}

export function readThemes(file: FmpFile, fonts: FontTable = readFonts(file)): Theme[] {
  const root = buildTree(file, () => true, file.chunks(undefined, [6, 5]));
  const themes: Theme[] = [];
  for (const [id, t] of root.child(6, 5)?.numbered() ?? []) {
    const theme = readTheme(id, t.text(10) ?? t.name ?? '', t.child(22)?.longBytes() ?? blob(t, 22), fonts);
    const internal = t.text(16);
    if (internal) theme.internalName = internal;
    themes.push(theme);
  }
  return themes;
}

/** Decodes every layout's design. Pass the schema to resolve names. */
export function readLayoutDesigns(file: FmpFile, schema?: Schema, only?: Set<number>): LayoutDesigns {
  const fonts = readFonts(file);
  const themes = readThemes(file, fonts);
  const formula = formulaReader(schema);
  const index = schema && schemaIndex(schema);
  const ids = only ?? (schema ? new Set(schema.layouts.map((l) => l.id)) : undefined);
  const layouts: LayoutDesign[] = [];
  const root = buildTree(file, () => true, file.chunks(undefined, [4, 5]));
  for (const [id, l] of root.child(4, 5)?.numbered() ?? []) {
    if (ids && !ids.has(id)) continue;
    const settings = Pb.parse(blob(l, 2));
    const design: LayoutDesign = {
      id, name: l.name ?? '',
      style: readStyle(settings?.msg(7), fonts),
      parts: readParts(l.child(3), fonts, schema),
      objects: readObjects(l, schema, fonts, id, formula, index),
    };
    const to = settings?.num(2);
    if (to !== undefined) design.tableOccurrenceId = to - TO_BASE;
    const width = settings?.num(8);
    if (width) design.width = width;
    // 0 is [File Default].
    const menuSet = settings?.num(3);
    if (menuSet) design.menuSetId = menuSet;
    const theme = lpIds(l.kv.get(11))[0];
    if (theme !== undefined) design.themeId = theme;
    const table = readTableView(l.child(13), schema, fonts, id, formula, index);
    if (table) design.tableView = table;
    const view = readLayoutView(l.kv.get(241));
    if (view) design.view = view;
    const viewsAllowed = readViewsAllowed(l.kv.get(241));
    if (viewsAllowed) design.viewsAllowed = viewsAllowed;
    const triggers = readTriggers(l.child(48), schema, formula, index?.scripts);
    if (triggers.length) design.triggers = triggers;
    const tabOrder = readTabOrder(l.child(21));
    if (tabOrder) design.tabOrder = tabOrder;
    layouts.push(design);
  }
  return { layouts, themes };
}
