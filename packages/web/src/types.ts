// Shapes of what the server sends: layout designs (see packages/fmp12/src/layouts.ts)
// and Data API records. Kept here so the browser code has no server imports.

export interface Bounds { top: number; left: number; bottom: number; right: number }

/** A field's data formatting from the Inspector (see packages/fmp12/src/layouts.ts). */
export interface DataFormat {
  number?: NumberFormat;
  date?: DateFormat;
  time?: TimeFormat;
  /** Containers: crop to the frame, enlarge, or reduce or enlarge to fit; absent: reduce to fit. */
  container?: 'crop' | 'enlarge' | 'fit';
}

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

export interface StyleRule { part: number; state: number; css: Record<string, string> }

export interface ObjectStyle { element?: number; name?: string; displayName?: string; rules?: StyleRule[] }

export interface FieldRef { tableOccurrenceId: number; fieldId: number; tableOccurrence?: string; field?: string }

/**
 * The Inspector's field behavior, where it differs from FileMaker's defaults
 * (see packages/fmp12/src/layouts.ts): entry in Browse and Find mode ('view'
 * can't be entered, 'select' can be selected and copied but not changed),
 * select the whole contents on entry, and Tab typing a tab rather than moving on.
 */
export interface FieldBehavior {
  browse?: 'view' | 'select' | 'calculation';
  find?: 'view' | 'select' | 'calculation';
  selectOnEntry?: boolean;
  noTab?: boolean;
  quickFindOff?: boolean;
  autoComplete?: boolean;
  calendarIcon?: boolean;
  otherValue?: boolean;
  /** Concealed edit box: dots instead of the data. */
  concealed?: boolean;
  /** Edit boxes: always show the vertical scroll bar. */
  scrollBar?: boolean;
  /** Return or Enter (keypad) also goes to the next object. */
  returnKey?: boolean;
  enterKey?: boolean;
}

export type FieldDisplay = 'edit' | 'popup' | 'dropdown' | 'checkbox' | 'radio' | 'calendar';

export interface LayoutObject {
  id: number;
  kind: string;
  type: number;
  bounds: Bounds;
  anchors: { left: boolean; top: boolean; right: boolean; bottom: boolean };
  style: ObjectStyle;
  /** Turned clockwise by this many degrees (Arrange > Rotate); see rotation.ts. */
  rotation?: 90 | 180 | 270;
  /** Responsive (Tabularius only): hidden in windows narrower than hideBelow. */
  responsive?: { hideBelow?: number };
  name?: string;
  text?: string;
  field?: FieldRef & { display: FieldDisplay; repetitions: number; valueListId?: number; valueList?: string; format?: DataFormat; behavior?: FieldBehavior };
  /** Portal Setup: scrolling (with the scroll bar shown only while scrolling), and whether people can delete its rows. */
  portal?: { tableOccurrenceId: number; tableOccurrence?: string; rows: number; initialRow: number; sort?: { field: FieldRef; descending?: boolean }[]; filter?: string; scrolling?: boolean; scrollBarWhenScrolling?: boolean; allowDelete?: boolean };
  /** A button's action: Perform Script (stepId 1) with its script, or one other step (line: as a script line; text: a new line to read on saving). */
  action?: { stepId: number; step: string; scriptId?: number; script?: string; layoutId?: number; layout?: string; param?: number; parameter?: string; params?: Record<string, unknown>; line?: string; text?: string };
  target?: number;
  imageId?: number;
  icon?: { imageId: number; size: number; display: 'label' | 'icon' | 'left' | 'right' | 'top' | 'bottom' };
  external?: string;
  hide?: { formula: string; inFind: boolean };
  /** Popover: its title bar shows (the title is in text, or label when it is a formula). */
  titleBar?: true;
  /** Hidden in Preview mode and when printed. */
  hideWhenPrinting?: true;
  /** Locked in Layout mode: it can be selected but not moved, resized or deleted. */
  locked?: true;
  /** Sliding & Visibility: in Preview mode and when printed, slides up and/or left, and the part shrinks with it. */
  sliding?: { up?: true; left?: true; resizePart?: true };
  /** Slide control: the navigation dots are hidden. */
  noDots?: true;
  /** Slide control: swipe gestures are turned off. */
  noSwipe?: true;
  placeholder?: string;
  tooltip?: string;
  /** Conditional formatting, applied in order when its formula is true. */
  conditions?: { formula: string; rules: StyleRule[] }[];
  /** Button bar segment: its label calculation (worked out by the server). */
  label?: string;
  /** Button bar: the active segment's object id, or a calculation returning its object name. */
  activeSegment?: number;
  activeSegmentFormula?: string;
  /** Web viewer: its address formula (worked out per record into FormulaState.web). */
  webUrl?: string;
  /** Web Viewer Setup's options. */
  webOptions?: { interaction: boolean; findMode: boolean; progressBar: boolean; statusMessages: boolean; encodeUrl: boolean; jsBridge: boolean };
  tab?: { left: number; width: number };
  tabHeight?: number;
  chart?: Chart;
  triggers?: ScriptTrigger[];
  /** Tabularius only: a placed copy of a layout component; its children follow the component. */
  component?: { id: number };
  children?: LayoutObject[];
}

export type ChartType = 'column' | 'stacked-column' | 'bar' | 'stacked-bar' | 'line' | 'area' | 'pie' | 'scatter' | 'bubble';

/** A chart's design: its type, data source and formulas (worked out by the server). */
export interface Chart {
  type: ChartType;
  source: 'record' | 'found-set' | 'related';
  grouped?: boolean;
  occurrence?: string;
  title?: string;
  xTitle?: string;
  yTitle?: string;
  categories?: string;
  yMin?: string;
  yMax?: string;
  series: { data: string; name?: string; x?: string; sizes?: string }[];
  background?: [string, string];
  text?: Record<'title' | 'xLabels' | 'xTitle' | 'yLabels' | 'yTitle' | 'legend', { size: number; color: string }>;
}

/** A chart's data for one record (POST .../layouts/{layout}/charts). */
export interface ChartData {
  title?: string;
  xTitle?: string;
  yTitle?: string;
  categories: string[];
  /** The value axis's bounds, when the chart specifies them. */
  yMin?: number;
  yMax?: number;
  series: { name: string; values: (number | null)[]; x?: (number | null)[]; sizes?: (number | null)[] }[];
}

/** A script trigger: the script (and parameter formula) run when the event happens. */
export interface ScriptTrigger { event: string; scriptId: number; script?: string; parameter?: string; modes?: ('browse' | 'find' | 'preview')[] }

export interface LayoutPart { kind: string; kindId: number; top: number; height: number; style: ObjectStyle; breakField?: FieldRef; options?: PartOptions }

/** How a part prints (Part Definition): a new page before it or after every N of it, page numbers starting again after it. */
export interface PartOptions { pageBreakBefore?: boolean; pageBreakEvery?: number; restartPageNumbers?: boolean }

/** Records sharing a sub-summary's break values: position in the found set, size and summary values. */
export interface GroupRun { start: number; count: number; values: Record<string, string | number> }

export interface LayoutDesign {
  id: number;
  name: string;
  tableOccurrenceId?: number;
  width?: number;
  themeId?: number;
  style: ObjectStyle;
  parts: LayoutPart[];
  objects: LayoutObject[];
  tableView?: { field: FieldRef; width: number }[];
  view?: 'form' | 'list' | 'table';
  triggers?: ScriptTrigger[];
  /** Set Tab Order: object ids in the order Tab visits them. */
  tabOrder?: number[];
  /** Layout Setup's menu set: 1 for FileMaker's standard menus, else a custom menu set's id; none for the file's default. */
  menuSetId?: number;
  /** Layout Setup: the views people may use (absent: all three). */
  viewsAllowed?: ('form' | 'list' | 'table')[];
  /** Layout Setup options; false turns one off (FileMaker's defaults are on). */
  saveRecordChanges?: boolean;
  fieldFrames?: boolean;
  recordIndicator?: boolean;
  /** Responsive (Tabularius only): below this window width the web client stacks each part's objects in one column. */
  responsive?: { stackBelow?: number };
  /** Layout Setup > Printing: records print in this many columns, across first unless `order` is down. */
  printColumns?: { count: number; order?: 'across' | 'down' };
  /** Layout Setup > Printing: fixed page margins in points; they replace the file's page setup margins in Preview mode, browser printing and Save Records as PDF. */
  fixedMargins?: { top: number; left: number; bottom: number; right: number };
}

export interface Theme {
  id: number;
  name: string;
  defaults: Record<string, StyleRule[]>;
  contextual?: { path: number[]; rules: StyleRule[] }[];
  styles: { name: string; element?: number; rules: StyleRule[] }[];
}

/** readOnly: the account's privileges let it view the field but not change it. */
export interface FieldMeta { name: string; type: string; calculated: boolean; summary: boolean; global?: boolean; readOnly?: boolean }

/** create: the relationship lets a new related record be added from the portal's empty last row. */
export interface Portal { name: string; occurrenceId: number; occurrence: string; fields: string[]; create?: boolean; /** The table its rows belong to, and the file holding it when another file does. */ table?: string; file?: string; /** On the layout's own occurrence: it lists the window's found set. */ foundSet?: boolean; /** Portal Setup's filter and sort, which the server applies. */ filter?: string; sort?: unknown[] }

/** GET /tabularius/app/v1/databases/{db}/layouts/{layout} */
export interface LayoutMeta {
  database: string;
  fileMode?: 'native' | 'compat';
  /** False while this file's scripts can't reach the network: an administrator turns it on in the admin console. */
  scriptNetwork?: boolean;
  /** The https web hosts this file's web viewers may load ("maps.example.com", "*.example.com"); none until an administrator lists some. */
  webViewerHosts?: string[];
  /** `file` is the hosted file holding the table, when it is another file of the solution. */
  layout: { name: string; id: number; occurrence: string; table: string; file?: string };
  design: LayoutDesign;
  /** The width below which a layout with no breakpoint of its own stacks in one column (0: never); the server's setting. */
  stackBelowDefault?: number;
  theme?: Theme;
  /** Field definitions by table occurrence name. */
  fields: Record<string, FieldMeta[]>;
  valueLists: Record<string, string[]>;
  /** Text shown for each value, when it isn't the value itself (a value list with a second field). */
  valueListLabels?: Record<string, string[]>;
  /** Value lists of related values: the view gives them per record. */
  recordValueLists?: number[];
  images: Record<string, string>;
  /** Value lists a sort can follow (Sort dialog's custom order). */
  sortLists?: string[];
  portals: Portal[];
  /** The account may see formulas and the relationship graph (Explain This Value without the assistant). */
  canSeeDesign?: boolean;
  /** Layout names by id, for Go to Layout buttons. */
  layouts: Record<string, string>;
  /** The file's page setup, for Preview mode and printing. */
  pageSetup?: import('./preview.ts').PageSetup;
}

/** A layout menu entry; `hidden` has "Include in layout menus" unchecked (a folder with what it holds). */
export interface MenuItem { id: number; name: string; kind: 'item' | 'folder' | 'separator' | 'folder-end' | 'unknown'; depth: number; open: boolean; hidden?: boolean }

export type Value = string | number;

export type PortalRow = { id?: string; recordId: string; modId: string } & Record<string, Value>;

export interface DataRecord {
  id?: string;
  recordId: string;
  modId: string;
  fieldData: Record<string, Value>;
  portalData: Record<string, PortalRow[]>;
  /** How many related records each portal has in all, beside how many came with the record (the Data API's portalDataInfo). */
  portalDataInfo?: { portalObjectName: string; foundCount: number; returnedCount: number }[];
  /** Fields showing a value from just before the latest change while the server works it out again. */
  updating?: string[];
  /** Fonts, sizes, colors and styles on parts of calculated text values, by field. */
  styles?: Record<string, StyleRun[]>;
  /** Formatting in portal rows: by portal, then the row's record id, then "TO::Field". */
  portalStyles?: Record<string, Record<string, Record<string, StyleRun[]>>>;
}

/** A formatted stretch [start, end) of a text value: style bits as TextStyleAdd's, a size in points, a color as #RRGGBB. */
export interface StyleRun { start: number; end: number; style?: number; font?: string; size?: number; color?: string }

export type FindRequest = Record<string, string> & { omit?: string };

/** sortOrder: ascending, descending, or a value list's name (a custom order based on it). */
export interface SortSpec { fieldName: string; sortOrder: 'ascend' | 'descend' | (string & {}) }

/** Per-record results of a layout's formulas (POST .../layouts/{layout}/view). */
/** Per portal row: objects hidden, and conditional formats that apply (object id -> condition indexes). */
export interface RowState {
  hidden: number[];
  web?: Record<string, string>;
  tooltips?: Record<string, string>;
  placeholders?: Record<string, string>;
  styles?: Record<string, number[]>;
  labels?: Record<string, string>;
  merges?: Record<string, string>;
  active?: Record<string, string>;
}

export interface FormulaState {
  hidden: number[];
  tooltips: Record<string, string>;
  placeholders: Record<string, string>;
  /** Button bar segment labels: object id -> text. */
  labels?: Record<string, string>;
  /** Merge field values: "TO::Field" as written in the text -> its value. */
  merges?: Record<string, string>;
  /** Button bars whose active segment is a calculation: bar id -> the segment's object name. */
  active?: Record<string, string>;
  /** Web viewer addresses: object id -> the address for this record. */
  web?: Record<string, string>;
  /** Conditional formats that apply: object id -> indexes into its conditions. */
  styles?: Record<string, number[]>;
  /** Portal rows: portal name -> row record id -> what applies in that row. */
  rows?: Record<string, Record<string, RowState>>;
  /** Value lists of related values, for this record. */
  valueLists?: Record<string, string[]>;
  /** Chart data: object id -> what the chart shows for this record. */
  charts?: Record<string, ChartData>;
  valueListLabels?: Record<string, string[]>;
}

/** What a button's script did (POST .../layouts/{layout}/button). */
/** FileMaker's window styles (New Window's Window Style). */
export type WindowStyle = 'document' | 'floating' | 'dialog' | 'card';

/**
 * A window a script opened or ran in: its id (Get ( WindowUUID )), name and style, and New Window's size and
 * place, in points (top and left from the window it opened over). Card windows dim their parent and have a close
 * control unless the script said otherwise.
 */
export interface ScriptWindow {
  id: string;
  name: string;
  style: WindowStyle;
  width?: number;
  height?: number;
  top?: number;
  left?: number;
  dimParent?: boolean;
  closeButton?: boolean;
}

export interface RefreshData {
  records: DataRecord[];
  /** Exact related-portal identities requested, including rows now deleted or denied. */
  requestedPortals?: Record<string, Record<string, number[]>>;
  states: Record<string, FormulaState>;
  find?: FormulaState;
  foundRows: Record<string, { rows: PortalRow[]; count: number; offset?: number }>;
}

export interface ScriptRun {
  warnings?: string[];
  syncVersion?: number;
  denial?: { operation: string; permission: string; explanation: string };
  script: string;
  /** The window the script ended in (the front window); layout, found set and record are that window's. */
  window?: ScriptWindow;
  /** The windows the script closed (Close Window), by id, in order. */
  closed?: string[];
  result: string;
  error: number;
  message?: string;
  layout?: string;
  foundSet?: number[];
  sort?: SortSpec[];
  recordId?: number;
  mode?: 'browse' | 'find';
  /** The script left the window in Preview mode. */
  preview?: boolean;
  /** Where the script left the cursor, when it moved it: a field object (and portal row), with what is selected in it; null when it left every field. */
  active?: { objectId: number; portal?: string; row?: number; selection?: [number, number] | 'all' } | null;
  /** A bulk change (Replace Field Contents, Delete All Records) the server journaled, which Undo takes back. */
  undo?: { id: string; summary: string; kind: 'replace' | 'delete' };
  /** Replace All that matched nothing: 0. */
  replaced?: number;
  actions: ({ step: string; script: string } & Record<string, unknown>)[];
  /**
   * The script is waiting on the person: Insert File (answer with
   * api.answerRun), Pause (api.continueRun) or Dialog, Show Custom Dialog
   * (api.answerDialog), which also carries the message, buttons and inputs,
   * or Sort, Sort Records' dialog (api.answerSort), starting from `sort`,
   * or Index, Insert from Index's View Index (api.answerIndex), offering `values`.
   */
  waiting?: { run: string; step: string; title?: string; message?: string; buttons?: string[]; inputs?: DialogInput[]; sort?: SortSpec[]; field?: string; values?: string[]; type?: string; camera?: 'back' | 'front' };
}

/** An input field of Show Custom Dialog, prefilled with its target's value. */
export interface DialogInput {
  label: string;
  value: string;
  password: boolean;
}

/** A menu of the file's custom menu set, as the server works it out for a record. */
export interface CustomMenu {
  title: string;
  items: CustomMenuItem[];
}

export interface CustomMenuItem {
  kind: 'command' | 'submenu' | 'separator';
  /** The title override, worked out. */
  title?: string;
  /** The FileMaker command, where known. */
  command?: string;
  /** A script-backed item: [menu id, item index], sent back to run it. */
  run?: [number, number];
  /** A script in the standard Scripts menu, by id. */
  scriptId?: number;
  /** Modifiers: 1 Shift, 4 Cmd/Ctrl. */
  shortcut?: { key: string; modifiers: number };
  /** A built-in submenu, such as "[Go to Layout]". */
  builtin?: string;
  items?: CustomMenuItem[];
}

/** A Scripts menu entry from the server: a script, a folder (submenu) or a separator. */
export type ScriptsMenuEntry = { name: string; id: number } | { name: string; items: ScriptsMenuEntry[] } | { separator: true };
