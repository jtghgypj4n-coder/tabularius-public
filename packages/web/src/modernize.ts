import { FORMULA_LIMIT, pageFormula } from './page-source.ts';

// Modernize interfaces: ready-made layout templates (a list, a record form and a list with the form beside it) worked
// out from a table's own fields, with no AI. Each is a modern layout page (plain HTML, CSS and JavaScript, see
// page-source.ts) that reads and edits records through window.tabularius as the signed-in account, so privileges and
// validation apply as they do anywhere else, and says where its data comes from when opened somewhere without it
// (FileMaker Pro). The server (server/src/modernize.ts) adds the classic FileMaker-style layouts and applies them all
// beside the file's own layouts, which are never touched.

/** What a template needs to know about a field. */
export interface ModernField {
  name: string;
  type: string;
  kind: string;
  global?: boolean;
  repetitions?: number;
  /** Stamped or numbered by the file itself (creation and modification stamps, serial numbers). */
  automatic?: boolean;
  /** The values of the custom value list the field must come from. */
  values?: string[];
  /** The name of the value list the field must come from, whatever kind it is: the page reads it live. */
  valueList?: string;
  /** The file requires a value ("Not empty" validation). */
  required?: boolean;
}

export interface ModernTable {
  name: string;
  records?: number | null;
  fields: ModernField[];
}

export type Control = 'text' | 'longtext' | 'number' | 'date' | 'time' | 'timestamp' | 'select' | 'checkbox' | 'radio' | 'readonly' | 'container';

/** How a layout draws one of its fields, when a page is made from that layout. */
export interface LayoutField {
  name: string;
  /** The control style: a pop-up, drop-down, checkbox set or radio buttons (edit and calendar change nothing here). */
  display?: 'edit' | 'popup' | 'dropdown' | 'checkbox' | 'radio' | 'calendar';
  /** The layout lets nobody change the field in Browse mode (View Only, Select Only or Set by Calculation). */
  viewOnly?: boolean;
  /** The words the layout draws beside the field. */
  label?: string;
  /** The value list the layout's field uses, by name, and its values when it is a custom list. */
  valueList?: string;
  values?: string[];
}

export interface PlanField {
  name: string;
  label: string;
  control: Control;
  options?: string[];
  /** The value list the options came from: the page asks for it again when it draws, so a changed list shows. */
  list?: string;
  /** Keys and stamps: shown, but under "System" and not editable. */
  system?: true;
  /** The field must not be left empty (the page marks it and tells assistive technology). */
  required?: true;
}

/** A button of the layout the page was made from that performs a script. */
export interface PlanButton {
  label: string;
  script: string;
  /** A parameter the layout's button gave as a fixed text or number; buttons whose parameter is a formula are not carried over. */
  parameter?: string;
}

/** Records of another table that belong to this one, shown under the form. */
export interface PlanRelated {
  label: string;
  /** The modern list layout of the related table, which the page reads its records through. */
  layout: string;
  /** This table's field and the related table's field the relationship matches. */
  local: string;
  remote: string;
  columns: string[];
}

export interface InterfacePlan {
  table: string;
  title: string;
  /** Columns of the list, the first being the record's name. */
  columns: PlanField[];
  fields: PlanField[];
  /** Script buttons from the layout, shown above the form of a saved record. */
  buttons?: PlanButton[];
  /** The first container field, shown as a picture on cards and in the form. */
  picture?: string;
  /** A field to make board columns from (a status, a stage): its listed values, else the values the records hold. */
  board?: { field: string; label: string; values?: string[] };
  /** A date field to place records on a calendar by. */
  calendar?: { field: string; label: string; control: 'date' | 'timestamp' };
  /** Text fields the search box looks in. */
  search: string[];
  related: PlanRelated[];
  /** A native file's page: dates and timestamps go to the server as ISO 8601, as the file gives them. */
  native?: true;
}

export type Mode = 'list' | 'detail' | 'split';
/** What the list starts as: the table or, on the board and calendar layouts, those views. */
export type View = 'table' | 'board' | 'calendar';

export const MODES: { mode: Mode; label: string }[] = [
  { mode: 'list', label: 'List' },
  { mode: 'detail', label: 'Detail' },
  { mode: 'split', label: 'List and detail' },
];

const KEY = /(^|[\s_.-])(id|pk|fk|uuid|guid)$|^(id|pk|fk)([\s_.-]|$)/i;
const CAMEL_KEY = /[a-z](ID|Id)$/;
const STAMP = /^(created|creation|modified|modification|last[\s_-]?modified|updated)/i;
const NAMEISH = /(^|[\s_.-])(name|title|subject|label|company|customer|client|product|item|description)$|^(name|title|subject)/i;
const CATEGORY = /^(status|stage|state|region|category|type|kind|priority|country|city|department|group|source|channel|owner|assigned|team)/i;
const LONG = /(notes?|comments?|description|details?|address|body|message|summary|remarks|bio)$/i;

/** A field name read as a label: "first_name" and "FirstName" become "First name". */
export function labelOf(name: string): string {
  const s = name.replace(/_+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().replace(/\s+/g, ' ');
  return s ? s[0].toUpperCase() + s.slice(1) : name;
}

/** Whether a field is one the file keeps itself: a key, a stamp, or numbered by the file. */
const isSystem = (f: ModernField) => f.automatic === true || KEY.test(f.name) || CAMEL_KEY.test(f.name) || STAMP.test(f.name);

function control(f: ModernField): Control {
  if (f.type === 'container') return 'container';
  if (f.kind !== 'normal') return 'readonly';
  if (f.values?.length || f.valueList) return 'select';
  if (f.type === 'number' || f.type === 'date' || f.type === 'time' || f.type === 'timestamp') return f.type;
  return LONG.test(f.name) ? 'longtext' : 'text';
}

/** The control a layout's field gets: the field's own, unless the layout makes it view only or draws it as a set of choices. */
function layoutControl(f: ModernField, l?: LayoutField): Control {
  const c = control(f);
  if (!l || c === 'container') return c;
  if (l.viewOnly) return 'readonly';
  if (c === 'select' && (l.display === 'checkbox' || l.display === 'radio')) return l.display;
  return c;
}

/** The fields a template can show: not globals, not repeating fields, not types it can't read. */
function usable(table: ModernTable): ModernField[] {
  // A name of only punctuation is a divider field ("_____"), not data.
  return table.fields.filter((f) => !f.global && (f.repetitions ?? 1) <= 1 && f.type !== 'unknown' && /[\p{L}\p{N}]/u.test(f.name));
}

/** Why a table gets no interface (a join table of only keys, say), or undefined when it does. */
export function whyNot(table: ModernTable): string | undefined {
  const shown = usable(table).filter((f) => f.type !== 'container' && !isSystem(f));
  if (!table.fields.length) return 'no fields';
  if (table.fields.every((f) => f.global)) return 'only global fields, which no record holds';
  if (!shown.length) return 'only keys and stamps, which looks like a join table';
  return undefined;
}

const STAGE = /^(status|stage|state|phase|priority|step|lane|progress)/i;
const WHEN = /(due|date|start|begin|when|scheduled|deadline|appointment|event)/i;

/** The field a board is made of: one with a custom value list, else one named like a status or stage. */
function boardOf(fields: ModernField[]): { board?: InterfacePlan['board'] } {
  const own = fields.filter((f) => f.type === 'text' && f.kind === 'normal' && !isSystem(f));
  const f = own.find((x) => (x.values?.length ?? 0) >= 2 && STAGE.test(x.name)) ?? own.find((x) => (x.values?.length ?? 0) >= 2) ?? own.find((x) => STAGE.test(x.name));
  return f ? { board: { field: f.name, label: labelOf(f.name), ...(f.values?.length ? { values: f.values } : {}) } } : {};
}

/** The field a calendar places records by: a date or timestamp, preferring one named like a due date or start. */
function calendarOf(fields: ModernField[]): { calendar?: InterfacePlan['calendar'] } {
  const own = fields.filter((f) => (f.type === 'date' || f.type === 'timestamp') && f.kind === 'normal' && !isSystem(f));
  const f = own.find((x) => WHEN.test(x.name)) ?? own[0];
  return f ? { calendar: { field: f.name, label: labelOf(f.name), control: f.type as 'date' | 'timestamp' } } : {};
}

const pictureOf = (fields: PlanField[]): { picture?: string } => {
  const f = fields.find((x) => x.control === 'container');
  return f ? { picture: f.name } : {};
};

/**
 * The list columns and form fields for a table, from names and types alone (no records are read): the record's name
 * first, then what groups it (a status, a type), dates, numbers and the rest, up to six columns. Keys, stamps and
 * globals stay out of the list; keys and stamps are in the form under System, and globals are left out.
 */
export function planInterface(table: ModernTable, related: PlanRelated[] = []): InterfacePlan {
  const fields = usable(table);
  const field = (f: ModernField): PlanField => ({
    name: f.name, label: labelOf(f.name), control: control(f), ...(f.values?.length ? { options: f.values } : {}), ...(f.valueList ? { list: f.valueList } : {}), ...(isSystem(f) ? { system: true as const } : {}), ...(f.required && !isSystem(f) ? { required: true as const } : {}),
  });
  const body = fields.filter((f) => !isSystem(f) && f.type !== 'container' && f.kind !== 'summary');
  const title = body.find((f) => f.type === 'text' && f.kind === 'normal' && NAMEISH.test(f.name)) ?? body.find((f) => f.type === 'text') ?? body[0];
  const rest = body.filter((f) => f !== title);
  const rank = (f: ModernField) => (CATEGORY.test(f.name) && f.type === 'text' ? 0 : f.type === 'date' || f.type === 'timestamp' ? 1 : f.type === 'number' ? 2 : f.type === 'text' ? 3 : 4)
    + (f.kind === 'normal' ? 0 : 4) + (LONG.test(f.name) ? 3 : 0);
  const ordered = [...rest].sort((a, b) => rank(a) - rank(b) || fields.indexOf(a) - fields.indexOf(b));
  const columns = [title, ...ordered].filter((f): f is ModernField => !!f).slice(0, 6).map(field);
  // Form: the fields in the file's own order, the system ones last.
  // (A summary field summarizes the found set, which says nothing about one record, so it stays out.)
  const shown = fields.filter((f) => f.kind !== 'summary');
  const form = [...shown.filter((f) => !isSystem(f)), ...shown.filter(isSystem)].map(field);
  const search = fields.filter((f) => f.type === 'text' && f.kind === 'normal' && !isSystem(f)).slice(0, 5).map((f) => f.name);
  return { table: table.name, title: labelOf(table.name), columns, fields: form, ...pictureOf(form), ...boardOf(fields), ...calendarOf(fields), search, related };
}

/**
 * The same interface for a table, but worked out from a layout the file already has: `shown` are the names of the fields
 * that layout shows, top to bottom and left to right, and the list columns and the form follow that order instead of
 * ranking the table's fields. Fields the templates can't use (globals, repeating fields, summaries) are left out.
 */
export function planFromLayout(table: ModernTable, shown: (string | LayoutField)[], title: string, related: PlanRelated[] = [], buttons: PlanButton[] = []): InterfacePlan {
  const have = new Map(usable(table).map((f) => [f.name, f]));
  const how = new Map(shown.map((x) => (typeof x === 'string' ? { name: x } : x)).map((x) => [x.name, x as LayoutField]));
  // The layout's own value list (and its look) wins over the field's validation list.
  const fields = [...how.keys()].map((n) => {
    const f = have.get(n), l = how.get(n)!;
    return f && f.kind !== 'summary' ? { ...f, ...(l.valueList ? { valueList: l.valueList, values: l.values } : {}) } : undefined;
  }).filter((f): f is ModernField => !!f);
  const field = (f: ModernField): PlanField => ({
    name: f.name, label: how.get(f.name)?.label ?? labelOf(f.name), control: layoutControl(f, how.get(f.name)), ...(f.values?.length ? { options: f.values } : {}), ...(f.valueList ? { list: f.valueList } : {}), ...(isSystem(f) ? { system: true as const } : {}), ...(f.required && !isSystem(f) ? { required: true as const } : {}),
  });
  const columns = fields.filter((f) => !isSystem(f) && f.type !== 'container').slice(0, 6).map(field);
  const search = fields.filter((f) => f.type === 'text' && f.kind === 'normal' && !isSystem(f)).slice(0, 5).map((f) => f.name);
  return { table: table.name, title, columns, fields: fields.map(field), ...(buttons.length ? { buttons } : {}), ...pictureOf(fields.map(field)), ...boardOf(fields), ...calendarOf(fields), search, related };
}

/** A value inside a script tag: JSON with the characters that could end the tag or the script written as escapes. */
const js = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const text = (s: string): string => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** A hue (0-359) from a name, so each table's pages have a colour of their own. */
function hue(name: string): number {
  let n = 0;
  for (const c of name) n = (n * 31 + c.codePointAt(0)!) >>> 0;
  return n % 360;
}

const CSS = String.raw`
  :root { color-scheme: light dark; --h: 200; --bg: #f4f6f8; --panel: #fff; --sunken: #eef1f4; --text: #18212b; --muted: #5c6773; --line: #dde3e9; --a: hsl(var(--h) 62% 26%); --on-a: #fff; --a-soft: hsl(var(--h) 60% 94%); --bad: #b42318; }
  /*<float>*/
  :root { --line: #e3e8ee; --shadow: 0 1px 2px rgb(16 24 40 / 6%), 0 4px 14px rgb(16 24 40 / 6%); }
  /*</float>*/
  @media (prefers-color-scheme: dark) { :root { --bg: #11161b; --panel: #1a2128; --sunken: #151b21; --text: #e7edf2; --muted: #9aa7b3; --line: #29323b; --a: hsl(var(--h) 70% 74%); --on-a: #0b1217; --a-soft: hsl(var(--h) 35% 20%); --bad: #ff8a7a; } }
  /*<float>*/
  @media (prefers-color-scheme: dark) { :root { --shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 6px 18px rgb(0 0 0 / 30%); } }
  /*</float>*/
  /*<chips>*/
  :root { --ok: #067647; --ok-soft: #dcfae6; --info: #175cd3; --info-soft: #e0ecff; --bad-soft: #fee4e2; --warn: #b54708; --warn-soft: #fef0c7; }
  @media (prefers-color-scheme: dark) { :root { --ok: #75e0a7; --ok-soft: #0b3a26; --info: #84adff; --info-soft: #11264d; --bad-soft: #4a1712; --warn: #fec84b; --warn-soft: #43300b; } }
  /*</chips>*/
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 14px 20px; background: var(--panel); border-bottom: 1px solid var(--line); }
  header { position: relative; z-index: 6; }
  h1 { margin: 0; font-size: 19px; letter-spacing: -.01em; }
  h1::before { content: ""; display: inline-block; width: 9px; height: 9px; border-radius: 3px; background: var(--a); margin-right: 8px; }
  .grow { flex: 1; }
  .muted { color: var(--muted); }
  button, input, select, textarea { font: inherit; color: inherit; }
  button { min-height: 34px; padding: 0 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); cursor: pointer; }
  button:hover { background: var(--sunken); }
  button.primary { background: var(--a); border-color: var(--a); color: var(--on-a); }
  button.primary:hover { filter: brightness(1.08); }
  button.danger { color: var(--bad); }
  button:disabled { opacity: .5; cursor: default; }
  :focus-visible { outline: 2px solid var(--a); outline-offset: 2px; }
  input[type=search] { width: min(280px, 100%); min-height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
  /*<float>*/
  main { flex: 1; min-height: 0; display: flex; gap: 16px; padding: 16px 20px 20px; }
  /*</float>*/
  /*<flat>*/
  main { flex: 1; min-height: 0; display: flex; }
  /*</flat>*/
  /*<float>*/
  .listpane { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--panel); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; }
  /*</float>*/
  /*<flat>*/
  .listpane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  /*</flat>*/
  .scroll { flex: 1; overflow: auto; }
  table { width: 100%; border-collapse: collapse; }
  /*<float>*/
  th, td { padding: 13px 16px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  /*</float>*/
  /*<flat>*/
  th, td { padding: 9px 14px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  /*</flat>*/
  /*<float>*/
  th { position: sticky; top: 0; background: var(--panel); font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; z-index: 1; border-bottom: 1px solid var(--line); }
  /*</float>*/
  /*<flat>*/
  th { position: sticky; top: 0; background: var(--sunken); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; z-index: 1; }
  /*</flat>*/
  /*<float>*/
  tbody td { border-bottom-color: var(--sunken); }
  /*</float>*/
  /*<chips>*/
  .who { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; max-width: 100%; }
  .who::before { content: attr(data-i); flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; letter-spacing: .02em; color: var(--a); background: var(--a-soft); }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--sunken); color: var(--muted); }
  .pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.info { background: var(--info-soft); color: var(--info); } .pill.bad { background: var(--bad-soft); color: var(--bad); } .pill.warn { background: var(--warn-soft); color: var(--warn); }
  .title { display: flex; align-items: center; gap: 12px; margin: 0 0 14px; font-size: 20px; letter-spacing: -.01em; }
  .title .who { font-size: 20px; }
  .title .who::before { width: 40px; height: 40px; font-size: 15px; }
  /*</chips>*/
  th button { all: unset; cursor: pointer; text-transform: inherit; letter-spacing: inherit; }
  th button:focus-visible { outline: 2px solid var(--a); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr { cursor: pointer; }
  /*<float>*/
  tbody tr:hover { background: var(--sunken); }
  /*</float>*/
  /*<flat>*/
  tbody tr:hover { background: var(--a-soft); }
  /*</flat>*/
  tbody tr[aria-selected=true] { background: var(--a-soft); box-shadow: inset 3px 0 var(--a); }
  .seg { display: inline-flex; } .seg button { border-radius: 0; margin-left: -1px; } .seg button:first-child { border-radius: 8px 0 0 8px; margin: 0; } .seg button:last-child { border-radius: 0 8px 8px 0; }
  .seg button[aria-pressed=true] { background: var(--a-soft); border-color: var(--a); color: var(--a); position: relative; font-weight: 600; }
  /*<cards>*/
  .cardbar { padding: 10px 20px 0; } .cardbar select { min-height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
  .cards { list-style: none; margin: 0; padding: 14px 20px 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
  /*<float>*/
  .cards { gap: 16px; }
  /*</float>*/
  /*</cards>*/
  /*<float>*/
  .card { all: unset; box-sizing: border-box; display: grid; gap: 4px; align-content: start; width: 100%; height: 100%; padding: 16px 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); box-shadow: var(--shadow); cursor: pointer; transition: transform .12s, box-shadow .12s; }
  /*</float>*/
  /*<flat>*/
  .card { all: unset; box-sizing: border-box; display: grid; gap: 4px; align-content: start; width: 100%; height: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); cursor: pointer; }
  /*</flat>*/
  /*<float>*/
  .card:hover { border-color: var(--a); transform: translateY(-1px); }
  .card:focus-visible { outline: 2px solid var(--a); outline-offset: 2px; }
  /*</float>*/
  /*<flat>*/
  .card:hover { border-color: var(--a); } .card:focus-visible { outline: 2px solid var(--a); outline-offset: 2px; }
  /*</flat>*/
  /*<chips>*/
  .card .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  /*</chips>*/
  .card[aria-pressed=true] { border-color: var(--a); background: var(--a-soft); box-shadow: inset 3px 0 var(--a); }
  .card strong { font-size: 15px; overflow-wrap: anywhere; } .fact { display: flex; gap: 8px; font-size: 13px; min-width: 0; } .fact .lab { flex: 0 0 38%; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .fact span:last-child { overflow-wrap: anywhere; }
  .pager { display: flex; align-items: center; gap: 10px; padding: 8px 20px; border-top: 1px solid var(--line); background: var(--panel); }
  /*<float>*/
  .formpane { background: var(--panel); overflow: auto; border-radius: 14px; box-shadow: var(--shadow); }
  /*</float>*/
  /*<flat>*/
  .formpane { background: var(--panel); overflow: auto; }
  /*</flat>*/
  /*<float>*/
  .split .listpane { flex: 0 0 min(56%, 800px); }
  /*</float>*/
  /*<flat>*/
  .split .listpane { flex: 0 0 min(46%, 640px); border-right: 1px solid var(--line); }
  /*</flat>*/
  .split .formpane { flex: 1; min-width: 0; }
  .drawer .formpane { position: fixed; inset: var(--head, 62px) 0 0 auto; width: min(560px, 100%); box-shadow: -12px 0 30px rgb(0 0 0 / 22%); border-left: 1px solid var(--line); z-index: 5; }
  .detail .formpane { flex: 1; }
  /*<float>*/
  .detail main, .list main { padding-left: 20px; }
  /*</float>*/
  /*<flat>*/

  /*</flat>*/
  /*<float>*/
  form { padding: 22px 26px 30px; max-width: 760px; }
  /*</float>*/
  /*<flat>*/
  form { padding: 18px 22px 26px; max-width: 760px; }
  /*</flat>*/
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 14px 18px; }
  .field { display: grid; gap: 4px; min-width: 0; align-content: start; }
  .field.long { grid-column: 1 / -1; }
  label, .lab { font-size: 12px; font-weight: 600; color: var(--muted); }
  .field input, .field select, .field textarea { width: 100%; min-height: 36px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
  /*<float>*/
  .field input, .field select, .field textarea { border-radius: 10px; }
  /*</float>*/
  .field textarea { min-height: 84px; resize: vertical; }
  .pic img { display: block; max-width: 100%; max-height: 320px; border-radius: 6px; }
  .thumb { height: 120px; margin: -2px 0 4px; border-radius: 6px; background: var(--sunken); display: grid; place-items: center; overflow: hidden; font-size: 12px; color: var(--muted); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .ro { min-height: 36px; padding: 6px 10px; border-radius: 8px; background: var(--sunken); overflow-wrap: anywhere; }
  details { margin-top: 18px; } summary { cursor: pointer; color: var(--muted); font-weight: 600; margin-bottom: 12px; }
  /*<float>*/
  .rel { padding: 0 26px 30px; } .rel h2 { font-size: 13px; margin: 18px 0 6px; } .rel table { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  /*</float>*/
  /*<flat>*/
  .rel { padding: 0 22px 26px; } .rel h2 { font-size: 13px; margin: 18px 0 6px; } .rel table { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  /*</flat>*/
  .empty, .err { padding: 22px; color: var(--muted); } .err { color: var(--bad); }
  #status { padding: 6px 20px; font-size: 13px; color: var(--muted); } #status:empty { display: none; } #status.bad { color: var(--bad); }
  .choices { display: flex; flex-wrap: wrap; gap: 6px 16px; } .choice { display: inline-flex; gap: 6px; align-items: center; }
  .fielderr { margin: 4px 0 0; font-size: 13px; color: var(--bad); } [aria-invalid="true"] { border-color: var(--bad); outline-color: var(--bad); }
  .split #back { display: none; }
  @media (max-width: 760px) { .split #back { display: inline-flex; align-items: center; } .split .listpane { flex-basis: auto; border: 0; } .split.has-sel .listpane, .split:not(.has-sel) .formpane { display: none; } th, td { padding: 9px 10px; } form { padding: 14px; } }
  /*<float>*/
  @media (max-width: 760px) { main { padding: 10px; } }
  /*</float>*/
  @media (prefers-reduced-motion: no-preference) { .drawer .formpane { animation: in .18s ease-out; } @keyframes in { from { transform: translateX(24px); opacity: 0; } } }
`;

/* The page's script. It is written as plain strings and functions (no template literals) so the plan is the only thing
   put into it, and it reads the same way in FileMaker Pro's web viewer, where only window.tabularius is missing. */
const RUNTIME = String.raw`
(function () {
  var P = __PLAN__, PAGE = 50, S = { rows: [], found: 0, offset: 0, sort: null, q: '', cur: null, idx: 0, view: P.view || 'table' }, V = {}, LOAD = {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'text') e.textContent = v; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { e.append(c); });
    return e;
  }
  var p2 = function (n) { return ('0' + n).slice(-2); };
  function toIn(t, v) {
    v = v == null ? '' : String(v);
    var m;
    if (t === 'date' && (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) return m[3] + '-' + p2(m[1]) + '-' + p2(m[2]);
    if (t === 'timestamp' && (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(v))) return m[3] + '-' + p2(m[1]) + '-' + p2(m[2]) + 'T' + p2(m[4]) + ':' + m[5] + ':' + (m[6] || '00');
    return v;
  }
  function fromIn(t, v) {
    var m;
    /*__NATIVE__*/
    if (t === 'date' && (m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v))) return m[2] + '/' + m[3] + '/' + m[1];
    if (t === 'timestamp' && (m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/.exec(v))) return m[2] + '/' + m[3] + '/' + m[1] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00');
    return v;
  }
  function status(msg, bad) { var s = $('#status'); s.textContent = msg || ''; s.className = bad ? 'bad' : ''; }
  function fail(e) { status(e && e.message ? e.message : String(e), true); }
  // A rejected save that names a field ('Field "Name" requires a value') is also shown beside that field, which is marked invalid.
  function clearInvalid() {
    document.querySelectorAll('#form [aria-invalid]').forEach(function (c) { c.removeAttribute('aria-invalid'); c.removeAttribute('aria-describedby'); });
    document.querySelectorAll('#form .fielderr').forEach(function (m) { m.remove(); });
  }
  function invalid(e) {
    var msg = e && e.message ? e.message : String(e), hit;
    P.fields.forEach(function (f) { if (msg.indexOf('"' + f.name + '"') >= 0 && (!hit || f.name.length > hit.name.length)) hit = f; });
    var c = hit && document.querySelector('#form [id="f-' + P.fields.indexOf(hit) + '"]');
    if (!c || c.classList.contains('ro')) return fail(e);
    clearInvalid();
    var m = el('p', { class: 'fielderr', id: c.id + '-err', text: hit.label + ': ' + msg.replace(/^Field "[^"]*" /, '') });
    c.parentNode.append(m); c.setAttribute('aria-invalid', 'true'); c.setAttribute('aria-describedby', m.id); (c.querySelector('input') || c).focus();
    status('Not saved: ' + hit.label + ' needs attention.', true);
  }
  /*<chips>*/
  // Names get an initials badge; state-like columns (Status, Stage, Priority...) get a coloured pill. Both are CSS only, so cell text stays the value.
  var TONES = { paid: 'ok', done: 'ok', complete: 'ok', completed: 'ok', active: 'ok', won: 'ok', approved: 'ok', open: 'info', sent: 'info', new: 'info', draft: 'warn', pending: 'warn', 'in progress': 'info', overdue: 'bad', late: 'bad', lost: 'bad', cancelled: 'bad', void: 'bad', high: 'bad', medium: 'warn', low: 'ok' };
  function isState(c) { return c.control !== 'number' && c.control !== 'longtext' && (/(^|[ _])(status|stage|priority)$|^(state|status)([ _]|$)/i.test(c.name) || /[a-z](Status|Stage|Priority)$/.test(c.name)); }
  function pill(v) { var k = String(v).toLowerCase(); return el('span', { class: 'pill ' + (Object.prototype.hasOwnProperty.call(TONES, k) ? TONES[k] : ''), text: v }); }
  function avatar(v) { var w = String(v).trim().split(/\s+/).filter(Boolean).map(function (x) { return Array.from(x)[0]; }); return el('span', { class: 'who', 'data-i': ((w[0] || '?') + (w.length > 1 ? w[w.length - 1] : '')).toUpperCase(), text: v }); }
  function nameCol(c) { return c === P.columns[0] && c.control !== 'number' && c.control !== 'date' && c.control !== 'timestamp' && c.control !== 'time' && !/(^|[ _])(id|no|number)$|^#$/i.test(c.name) && !/[a-z]ID$/.test(c.name); }
  function recHead(rec, isNew) { var c = P.columns[0]; if (!c) return []; var n = val(rec, c.name); return [el('h2', { class: 'title' }, [isNew ? el('span', { text: 'New ' + P.title.replace(/([^su])s$/, '$1') }) : (n && !/\d{3}/.test(n) ? avatar(n) : el('span', { text: n || P.title }))])]; }
  /*</chips>*/
  var val = function (rec, f) { var v = rec && rec.fieldData ? rec.fieldData[f] : ''; return v == null ? '' : String(v); };

  // ---- the list
  function head() {
    var tr = el('tr');
    P.columns.forEach(function (c) {
      var on = S.sort && S.sort.fieldName === c.name, num = c.control === 'number';
      tr.append(el('th', { scope: 'col', class: num ? 'num' : false, 'aria-sort': on ? (S.sort.sortOrder === 'ascend' ? 'ascending' : 'descending') : 'none' }, [
        el('button', { type: 'button', text: c.label + (on ? (S.sort.sortOrder === 'ascend' ? ' ▲' : ' ▼') : ''), onclick: function () {
          S.sort = { fieldName: c.name, sortOrder: on && S.sort.sortOrder === 'ascend' ? 'descend' : 'ascend' }; S.offset = 0; load();
        } })]));
    });
    return el('thead', {}, [tr]);
  }
  // The same rows as cards: the first column is the heading, the others sit under it. Sorting is a menu, since there are no column heads.
  function thumb(link) { var b = el('div', { class: 'thumb' }); pic(b, link, 240); return b; }
  /*<cards>*/
  function cards() {
    var pick = el('select', { id: 'sortby', 'aria-label': 'Sort by', onchange: function (e) {
      var v = e.target.value; S.sort = v ? { fieldName: v, sortOrder: 'ascend' } : null; S.offset = 0; load();
    } }, [el('option', { value: '', text: 'Sort: file order' })].concat(P.columns.map(function (c) { return el('option', { value: c.name, text: 'Sort: ' + c.label }); })));
    pick.value = S.sort ? S.sort.fieldName : '';
    var list = el('ul', { class: 'cards' });
    S.rows.forEach(function (rec) {
      /*<chips>*/
      var stateCol = P.columns.slice(1).filter(function (c) { return isState(c) && val(rec, c.name); })[0];
      var facts = P.columns.slice(1).map(function (c) { return val(rec, c.name) && c !== stateCol ? el('div', { class: 'fact' }, [el('span', { class: 'lab', text: c.label }), el('span', { text: val(rec, c.name) })]) : null; }).filter(Boolean);
      list.append(el('li', {}, [el('button', { type: 'button', class: 'card', 'data-id': rec.recordId, 'aria-pressed': S.cur && S.cur.recordId === rec.recordId ? 'true' : 'false', onclick: function () { openRec(rec); } },
        (P.picture && val(rec, P.picture) ? [thumb(val(rec, P.picture))] : []).concat([el('div', { class: 'head' }, [el('strong', { text: val(rec, P.columns[0].name) || '(blank)' })].concat(stateCol ? [pill(val(rec, stateCol.name))] : []))], facts))]));
      /*</chips>*/
      /*<nochips>*/
      var facts = P.columns.slice(1).map(function (c) { return val(rec, c.name) ? el('div', { class: 'fact' }, [el('span', { class: 'lab', text: c.label }), el('span', { text: val(rec, c.name) })]) : null; }).filter(Boolean);
      list.append(el('li', {}, [el('button', { type: 'button', class: 'card', 'data-id': rec.recordId, 'aria-pressed': S.cur && S.cur.recordId === rec.recordId ? 'true' : 'false', onclick: function () { openRec(rec); } },
        (P.picture && val(rec, P.picture) ? [thumb(val(rec, P.picture))] : []).concat([el('strong', { text: val(rec, P.columns[0].name) || '(blank)' })], facts))]));
      /*</nochips>*/
    });
    return el('div', {}, [el('div', { class: 'cardbar' }, [pick]), list]);
  }
  /*</cards>*/
  function renderList() {
    var body = el('tbody');
    S.rows.forEach(function (rec) {
      var tr = el('tr', { tabindex: 0, 'data-id': rec.recordId, 'aria-selected': S.cur && S.cur.recordId === rec.recordId ? 'true' : 'false', onclick: function () { openRec(rec); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRec(rec); } } });
      /*<chips>*/
      P.columns.forEach(function (c) {
        var v = val(rec, c.name), td = el('td', { class: c.control === 'number' ? 'num' : false });
        if (v && isState(c)) td.append(pill(v)); else if (v && nameCol(c) && !/\d{3}/.test(v)) td.append(avatar(v)); else td.textContent = v;
        tr.append(td);
      });
      /*</chips>*/
      /*<nochips>*/
      P.columns.forEach(function (c) { tr.append(el('td', { class: c.control === 'number' ? 'num' : false, text: val(rec, c.name) })); });
      /*</nochips>*/
      body.append(tr);
    });
    var box = $('#rows');
    box.replaceChildren(V[S.view] ? V[S.view]() : !S.rows.length ? el('p', { class: 'empty', text: S.q ? 'No ' + P.title.toLowerCase() + ' match "' + S.q + '".' : 'No records yet.' }) : S.view === 'cards' ? cards() : el('table', { 'aria-label': P.title }, [head(), body]));
    document.querySelectorAll('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', b.id === 'v-' + S.view ? 'true' : 'false'); });
    var from = S.found ? S.offset + 1 : 0, to = Math.min(S.found, S.offset + S.rows.length), paged = !LOAD[S.view];
    $('#count').textContent = paged ? from + '–' + to + ' of ' + S.found : S.rows.length + (S.found > S.rows.length ? ' of ' + S.found : '') + ' shown';
    $('#prev').hidden = $('#next').hidden = !paged;
    $('#prev').disabled = S.offset <= 0; $('#next').disabled = S.offset + PAGE >= S.found;
  }
  function load() {
    if (LOAD[S.view]) return LOAD[S.view]();
    var o = { offset: S.offset + 1, limit: PAGE }; if (S.sort) o.sort = [S.sort];
    var q = S.q && P.search.length ? P.search.map(function (f) { var r = {}; r[f] = '*' + JSON.stringify(S.q) + '*'; return r; }) : null;
    var call = q ? tabularius.find(P.layout, q, o) : tabularius.records(P.layout, o);
    return call.then(function (r) { S.rows = r.data || []; S.found = r.foundCount != null ? r.foundCount : S.rows.length; if ($('#status').className) status(''); renderList(); }, function (e) {
      S.rows = []; S.found = 0; renderList(); fail(e);
    });
  }

/*__VIEWS__*/
  // ---- the form
  var dirty = false;
  function beforeUnload(e) { e.preventDefault(); e.returnValue = ''; }
  function setDirty(value) { if (dirty !== value) { dirty = value; window[dirty ? 'addEventListener' : 'removeEventListener']('beforeunload', beforeUnload); } }
  function edited() { setDirty(Array.from(document.querySelectorAll('#form [data-field]')).some(function (c) { return c.value !== c.dataset.saved; })); }
  function discard() { return !dirty || confirm('Discard unsaved changes?'); }
  function fill(c, values, labels, v) {
    var all = values.concat(v && values.indexOf(v) < 0 ? [v] : []);
    c.replaceChildren.apply(c, [el('option', { value: '', text: '' })].concat(all.map(function (o) { return el('option', { value: o, text: labels && values.indexOf(o) >= 0 ? labels[values.indexOf(o)] : o }); })));
    c.value = v;
  }
  function control(f, v) {
    var id = 'f-' + P.fields.indexOf(f), c;
    // A container is shown as a picture through the page bridge's thumbnail link; a file that is not a picture says it has one.
    if (f.control === 'container') { c = el('div', { class: 'ro pic', id: id, text: v ? '' : 'Empty' }); if (v) pic(c, v, 480); }
    else if (f.system || f.control === 'readonly') c = el('div', { class: 'ro', id: id, text: v });
    else if (f.control === 'longtext') { c = el('textarea', { id: id }); c.value = v; }
    /*__CHOICES__*/
    else if (f.control === 'select') {
      c = el('select', { id: id }); fill(c, f.options || [], null, v);
      // The list is read again from the file, so one changed since the page was made shows; if that fails, the values it was made with stay.
      if (f.list) tabularius.valueList(f.list).then(function (L) { fill(c, L.values || [], L.labels, c.value); }, function () {});
    } else {
      var t = f.control === 'date' ? 'date' : f.control === 'time' ? 'time' : f.control === 'timestamp' ? 'datetime-local' : 'text';
      c = el('input', { id: id, type: t, step: t === 'time' || t === 'datetime-local' ? '1' : false, inputmode: f.control === 'number' ? 'decimal' : false });
      c.value = toIn(f.control, v);
    }
    c.dataset.field = f.name;
    if (c.tagName !== 'DIV') c.dataset.saved = c.value;
    if (f.required && !c.classList.contains('ro')) c.setAttribute('aria-required', 'true');
    c.addEventListener('input', clearInvalid);
    return c;
  }
  function pic(box, link, size) {
    var none = function () { box.textContent = 'Has a file'; };
    Promise.resolve(tabularius.image ? tabularius.image(link, size) : link).then(function (src) {
      if (!src) return none();
      var i = el('img', { src: src, alt: '', loading: 'lazy' }); i.addEventListener('error', none); box.replaceChildren(i);
    }, none);
  }
  function group(fields, rec, cur) {
    return el('div', { class: 'fields' }, fields.map(function (f) {
      var long = f.control === 'longtext';
      return el('div', { class: 'field' + (long ? ' long' : '') }, [el('label', { for: 'f-' + P.fields.indexOf(f), id: 'f-' + P.fields.indexOf(f) + '-l', text: f.label }, f.required ? [el('span', { 'aria-hidden': 'true', text: ' *' })] : []), control(f, val(rec, f.name))]);
    }));
  }
  function showForm(rec, isNew) {
    setDirty(false);
    S.cur = rec; $('#layout').classList.toggle('has-sel', !!rec);
    document.querySelectorAll('#rows tbody tr').forEach(function (tr) { tr.setAttribute('aria-selected', rec && tr.dataset.id === String(rec.recordId) ? 'true' : 'false'); });
    document.querySelectorAll('#rows .card').forEach(function (b) { b.setAttribute('aria-pressed', rec && b.dataset.id === String(rec.recordId) ? 'true' : 'false'); });
    var box = $('#form'), rel = $('#related');
    if (!rec) { box.replaceChildren(el('p', { class: 'empty', text: 'Pick a record to see it here.' })); rel.replaceChildren(); return; }
    var main = P.fields.filter(function (f) { return !f.system; }), sys = P.fields.filter(function (f) { return f.system; });
    var bar = el('div', { class: 'bar' }, []);
    if (P.mode !== 'detail') bar.append(el('button', { type: 'button', id: 'back', text: P.mode === 'list' ? 'Close' : '← List', onclick: close }));
    if (P.mode === 'detail') {
      bar.append(el('button', { type: 'button', id: 'first', text: '‹ Previous', disabled: S.idx <= 0, onclick: function () { go(S.idx - 1); } }),
        el('span', { class: 'muted', text: isNew ? 'New record' : 'Record ' + (S.idx + 1) + ' of ' + S.found }),
        el('button', { type: 'button', text: 'Next ›', disabled: S.idx + 1 >= S.found, onclick: function () { go(S.idx + 1); } }));
    }
    if (!isNew) (P.buttons || []).forEach(function (b) { bar.append(el('button', { type: 'button', text: b.label, onclick: function () { status('Running ' + b.label + '…'); tabularius.performScript(b.script, b.parameter || '').then(function () { status(''); }, fail); } })); });
    bar.append(el('span', { class: 'grow' }), el('button', { type: 'button', id: 'save', class: 'primary', text: 'Save', onclick: function () { save(rec, isNew); } }));
    if (!isNew) bar.append(el('button', { type: 'button', id: 'del', class: 'danger', text: 'Delete', onclick: del }));
    // The page's frame is sandboxed without forms, so Save is a button and Enter in a field presses it.
    /*<chips>*/
    var form = el('form', { novalidate: true, oninput: edited, onchange: edited, onsubmit: function (e) { e.preventDefault(); }, onkeydown: function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(rec, isNew); }
    } }, [bar].concat(recHead(rec, isNew), [group(main, rec)]));
    /*</chips>*/
    /*<nochips>*/
    var form = el('form', { novalidate: true, oninput: edited, onchange: edited, onsubmit: function (e) { e.preventDefault(); }, onkeydown: function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(rec, isNew); }
    } }, [bar, group(main, rec)]);
    /*</nochips>*/
    if (sys.length) form.append(el('details', {}, [el('summary', { text: 'System fields' }), group(sys, rec)]));
    box.replaceChildren(form);
    rel.replaceChildren();
    if (!isNew) related(rec);
    if (P.mode === 'list') { var f = $('input,select,textarea', form); if (f) f.focus(); }
  }
  var RELATED_PAGE = 25;
  function related(rec) {
    P.related.forEach(function (r) {
      var k = val(rec, r.local); if (k === '') return;
      var box = el('section', {}, [el('h2', { text: r.label })]); $('#related').append(box);
      var q = {}; q[r.remote] = '==' + k;
      var got = 0, body, note, more;
      function next() {
        return tabularius.find(r.layout, [q], { offset: got + 1, limit: RELATED_PAGE }).then(function (x) {
          var rows = x.data || [], total = x.foundCount != null ? x.foundCount : got + rows.length;
          if (!got && !rows.length) { box.append(el('p', { class: 'muted', text: 'None.' })); return; }
          if (!body) {
            body = el('tbody', {}); note = el('p', { class: 'muted' }); more = el('button', { type: 'button', text: 'Show more' });
            more.addEventListener('click', function () { more.disabled = true; next().then(function () { more.disabled = false; }); });
            box.append(el('table', { 'aria-label': r.label }, [el('thead', {}, [el('tr', {}, r.columns.map(function (c) { return el('th', { scope: 'col', text: c }); }))]), body]), note, more);
          }
          rows.forEach(function (row) { body.append(el('tr', {}, r.columns.map(function (c) { return el('td', { text: val(row, c) }); }))); });
          got += rows.length;
          note.textContent = 'Showing ' + got + ' of ' + total + '.';
          more.style.display = !rows.length || got >= total ? 'none' : '';
        }, function (e) { box.append(el('p', { class: 'err', text: e.message || String(e) })); });
      }
      next();
    });
  }
  function save(rec, isNew) {
    var changes = {}, any = false;
    document.querySelectorAll('#form [data-field]').forEach(function (c) {
      if (c.classList.contains('ro')) return;
      var f = P.fields.filter(function (x) { return x.name === c.dataset.field; })[0], now = fromIn(f.control, c.value);
      if (isNew ? now !== '' : now !== val(rec, f.name)) { changes[f.name] = now; any = true; }
    });
    if (!isNew && !any) { status('Nothing changed.'); return; }
    clearInvalid(); status('Saving…');
    (isNew ? tabularius.create(P.layout, changes) : tabularius.update(P.layout, rec.recordId, changes)).then(function (r) {
      setDirty(false);
      var id = isNew ? r.recordId : rec.recordId;
      return tabularius.record(P.layout, id).then(function (x) {
        var fresh = x.data ? x.data[0] : x;
        if (P.mode === 'detail') return (isNew ? go(-1) : go(S.idx)).then(function () { status('Saved.'); });
        return load().then(function () { showForm(fresh); status('Saved.'); });
      });
    }).catch(invalid);
  }
  var armed = false;
  function del() {
    var b = $('#del');
    if (!armed) { armed = true; b.textContent = 'Really delete?'; setTimeout(function () { armed = false; if (b.isConnected) b.textContent = 'Delete'; }, 4000); return; }
    armed = false;
    tabularius.remove(P.layout, S.cur.recordId).then(function () { setDirty(false); status('Deleted.'); if (P.mode === 'detail') return go(Math.max(0, S.idx - 1)); close(); return load(); }).catch(fail);
  }
  function openRec(rec) { if (discard()) showForm(rec); }
  function close() { if (!discard()) return; showForm(null); if (P.mode === 'list') $('#layout').classList.remove('drawer-open'); }
  function newRec() { if (discard()) showForm({ fieldData: {} }, true); }
  function go(i) {
    if (!discard()) return Promise.resolve();
    return tabularius.records(P.layout, { offset: Math.max(1, i + 1), limit: 1 }).then(function (r) {
      S.found = r.foundCount != null ? r.foundCount : 0;
      if (i < 0) i = Math.max(0, S.found - 1);
      S.idx = Math.min(Math.max(0, i), Math.max(0, S.found - 1));
      return S.found ? tabularius.records(P.layout, { offset: S.idx + 1, limit: 1 }).then(function (x) { showForm(x.data[0]); }) : (showForm({ fieldData: {} }, true), status('No records yet: fill in the first one.'));
    }).catch(fail);
  }

  // ---- start
  function start() {
    $('#where').textContent = 'Live from ' + P.table;
    var fit = function () { document.documentElement.style.setProperty('--head', $('header').offsetHeight + 'px'); };
    fit(); addEventListener('resize', fit); if (window.ResizeObserver) new ResizeObserver(fit).observe($('header'));
    if (P.mode !== 'detail') {
      var t; $('#q').addEventListener('input', function (e) { clearTimeout(t); t = setTimeout(function () { S.q = e.target.value.trim(); S.offset = 0; load(); }, 250); });
      document.querySelectorAll('.seg button').forEach(function (b) { b.addEventListener('click', function () {
        var was = S.view; S.view = b.id.slice(2); S.offset = 0;
        if (LOAD[S.view] || LOAD[was]) load(); else renderList();
      }); });
      $('#prev').addEventListener('click', function () { S.offset = Math.max(0, S.offset - PAGE); load(); });
      $('#next').addEventListener('click', function () { S.offset += PAGE; load(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.cur && P.mode === 'list') close(); });
      load();
      if (P.mode === 'split') showForm(null);
    }
    $('#new').addEventListener('click', newRec);
    if (P.mode === 'detail') tabularius.context().then(function (c) { return go(c && c.recordNumber ? c.recordNumber - 1 : 0); }, function () { return go(0); });
    tabularius.on('refresh', function () { if (P.mode === 'detail') go(S.idx); else load(); });
  }
  if (!window.tabularius) $('#where').textContent = 'Shows ' + P.table + ' records when opened in Tabularius.'; else start();
})();
`;


/* The board and calendar views are put into a page only when it is made to open on them, so the other pages stay as small as they were. */
const BOARD_CSS = String.raw`
  .board { display: flex; gap: 12px; padding: 14px 20px 20px; align-items: flex-start; overflow-x: auto; }
  /*<float>*/
  .bcol { flex: 0 0 280px; background: var(--sunken); border-radius: 14px; padding: 12px; display: grid; gap: 10px; }
  .bcol h2 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .bcol h2 span:last-child { min-width: 24px; padding: 1px 8px; border-radius: 999px; background: var(--panel); text-align: center; letter-spacing: 0; box-shadow: var(--shadow); }
  /*</float>*/
  /*<flat>*/
  .bcol { flex: 0 0 260px; background: var(--sunken); border-radius: 10px; padding: 10px; display: grid; gap: 8px; }
  .bcol h2 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); display: flex; justify-content: space-between; gap: 8px; }
  /*</flat>*/
  .bcards { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; min-height: 44px; align-content: start; }
  .bcards.over { outline: 2px dashed var(--a); outline-offset: 2px; border-radius: 8px; }
  .bcards li { display: grid; gap: 4px; cursor: grab; }
  /*<float>*/
  .mv { min-height: 28px; font-size: 12px; border: 0; border-radius: 8px; background: transparent; padding: 0 4px; color: var(--muted); cursor: pointer; }
  .mv:hover { background: var(--panel); }
  /*</float>*/
  /*<flat>*/
  .mv { min-height: 30px; font-size: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); padding: 0 6px; color: var(--muted); }
  /*</flat>*/
`;
/** The checkbox and radio sets of a page, which only a page with one carries (an `else if` of the form's control()). */
/* Put into a native file's pages only: its dates are the date input's own, and a timestamp gets the seconds the browser leaves off. */
const NATIVE_JS = String.raw`if (P.native) return t === 'timestamp' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v) ? v + ':00' : v;`;
const CHOICES_JS = String.raw`else if (f.control === 'checkbox' || f.control === 'radio') {
      // A set of choices; the box's value is the ticked ones, one to a line, as the file stores them.
      var kind = f.control, picked = v.split(/[\r\n\v]+/);
      c = el('div', { id: id, role: kind === 'radio' ? 'radiogroup' : 'group', 'aria-labelledby': id + '-l', class: 'choices' });
      Object.defineProperty(c, 'value', { get: function () { return [].filter.call(c.querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; }).join('\n'); } });
      var build = function (items, labels, now) {
        var on = now.split(/[\r\n\v]+/), n = 0;
        c.replaceChildren.apply(c, items.concat(on.filter(function (x) { return x && items.indexOf(x) < 0; })).map(function (o, i) {
          var box = el('input', { type: kind, id: id + '-' + n++, name: id, value: o }); box.checked = on.indexOf(o) >= 0;
          return el('label', { class: 'choice' }, [box, el('span', { text: labels && labels[i] != null ? labels[i] : o })]);
        }));
      };
      build(f.options || [], null, v);
      if (f.list) tabularius.valueList(f.list).then(function (L) { build(L.values || [], L.labels, c.value); }, function () {});
    }`;

const BOARD_JS = String.raw`
  // ---- board: cards in a column for each value of a status field, moved by dragging or from the menu on each card
  PAGE = 200;
  V.board = function () {
    var B = P.board, cols = (B.values || []).slice();
    S.rows.forEach(function (r) { var v = val(r, B.field); if (v && cols.indexOf(v) < 0) cols.push(v); });
    if (!cols.length || S.rows.some(function (r) { return !val(r, B.field); })) cols.push('');
    var facts = P.columns.slice(1).filter(function (c) { return c.name !== B.field; }).slice(0, 2);
    return el('div', { class: 'board' }, cols.map(function (name) {
      var mine = S.rows.filter(function (r) { return val(r, B.field) === name; });
      var list = el('ul', { class: 'bcards', 'data-value': name, 'aria-label': name || 'No ' + B.label.toLowerCase() });
      list.addEventListener('dragover', function (e) { e.preventDefault(); list.classList.add('over'); });
      list.addEventListener('dragleave', function () { list.classList.remove('over'); });
      list.addEventListener('drop', function (e) {
        e.preventDefault(); list.classList.remove('over');
        var id = e.dataTransfer.getData('text/plain'), rec = S.rows.filter(function (r) { return String(r.recordId) === id; })[0];
        if (rec) move(rec, name);
      });
      mine.forEach(function (rec) {
        var title = val(rec, P.columns[0].name) || '(blank)';
        var pick = el('select', { class: 'mv', 'aria-label': 'Move ' + title + ' to', onchange: function (e) { move(rec, e.target.value); } },
          cols.map(function (c) { return el('option', { value: c, text: c || '(none)' }); }));
        pick.value = name;
        var body = (P.picture && val(rec, P.picture) ? [thumb(val(rec, P.picture))] : []).concat([el('strong', { text: title })], facts.map(function (c) {
          return val(rec, c.name) ? el('div', { class: 'fact' }, [el('span', { class: 'lab', text: c.label }), el('span', { text: val(rec, c.name) })]) : null;
        }).filter(Boolean));
        var li = el('li', { draggable: 'true', 'data-id': rec.recordId }, [el('button', { type: 'button', class: 'card', 'data-id': rec.recordId, 'aria-pressed': S.cur && S.cur.recordId === rec.recordId ? 'true' : 'false', onclick: function () { openRec(rec); } }, body), pick]);
        li.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', String(rec.recordId)); e.dataTransfer.effectAllowed = 'move'; });
        list.append(li);
      });
      return el('section', { class: 'bcol', 'aria-label': name || 'No ' + B.label.toLowerCase() }, [el('h2', {}, [el('span', { text: name || 'No ' + B.label.toLowerCase() }), el('span', { text: String(mine.length) })]), list]);
    }));
  };
  function move(rec, value) {
    var B = P.board, d = {};
    if (val(rec, B.field) === value) return;
    d[B.field] = value;
    tabularius.update(P.layout, rec.recordId, d).then(function () {
      rec.fieldData[B.field] = value; status('Moved to ' + (value || 'none') + '.'); renderList();
      if (S.cur && S.cur.recordId === rec.recordId) showForm(rec);
    }).catch(function (e) { load(); fail(e); });
  }
`;
const CALENDAR_CSS = String.raw`
  .calbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 20px 8px; }
  .calbar h2 { margin: 0 6px; font-size: 16px; min-width: 9em; text-align: center; }
  .cal { table-layout: fixed; } .cal th { text-align: center; position: static; }
  .cal td { vertical-align: top; height: 104px; white-space: normal; max-width: none; padding: 4px 6px; border-right: 1px solid var(--line); }
  .cal td.off { background: var(--sunken); } .cal td.today { background: var(--a-soft); } .cal td.today .dn { color: var(--text); font-weight: 700; }
  .dn { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--muted); }
  .dn button { min-height: 22px; padding: 0 6px; border-radius: 6px; }
  .ev { all: unset; display: block; box-sizing: border-box; width: 100%; margin-top: 3px; padding: 2px 6px; border-radius: 5px; background: var(--a-soft); color: var(--a); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; border: 1px solid var(--line); }
  .ev:focus-visible { outline: 2px solid var(--a); } .ev[aria-pressed=true] { background: var(--a); color: #fff; }
  .more { all: unset; font-size: 12px; color: var(--muted); cursor: pointer; margin-top: 3px; display: block; } .more:focus-visible { outline: 2px solid var(--a); }
`;
// Choose the date syntax while generating the page so compat pages keep exactly their existing script.
function calendarJs(native = false): string {
  return String.raw`
  // ---- calendar: a month at a time, records on the day of their date field
  var C = P.calendar, N = new Date(), CAL = { y: N.getFullYear(), m: N.getMonth(), open: '' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var mdy = function (d) { return ${native ? "('0000' + CAL.y).slice(-4) + '-' + p2(CAL.m + 1) + '-' + p2(d)" : "p2(CAL.m + 1) + '/' + p2(d) + '/' + CAL.y"}; };
  function dayOf(rec) { ${native ? String.raw`var m = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(val(rec, C.field)); return m && +m[1] === CAL.y && +m[2] === CAL.m + 1 ? +m[3] : 0;` : String.raw`var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(val(rec, C.field)); return m && +m[3] === CAL.y && +m[1] === CAL.m + 1 ? +m[2] : 0;`} }
  LOAD.calendar = function () {
    var a = mdy(1), b = mdy(new Date(CAL.y, CAL.m + 1, 0).getDate()), range = C.control === 'timestamp' ? a + '${native ? 'T' : ' '}00:00:00...' + b + '${native ? 'T' : ' '}23:59:59' : a + '...' + b;
    var reqs = (S.q && P.search.length ? P.search : [null]).map(function (f) { var r = {}; r[C.field] = range; if (f) r[f] = '*' + JSON.stringify(S.q) + '*'; return r; });
    return tabularius.find(P.layout, reqs, { offset: 1, limit: 500 }).then(function (r) {
      S.rows = r.data || []; S.found = r.foundCount != null ? r.foundCount : S.rows.length; if ($('#status').className) status(''); renderList();
    }, function (e) { S.rows = []; S.found = 0; renderList(); if (!/match|no records/i.test(e && e.message || '')) fail(e); });
  };
  V.calendar = function () {
    var start = new Date(CAL.y, CAL.m, 1).getDay(), days = new Date(CAL.y, CAL.m + 1, 0).getDate(), by = {};
    S.rows.forEach(function (r) { var d = dayOf(r); if (d) (by[d] = by[d] || []).push(r); });
    var step = function (n) { var t = new Date(CAL.y, CAL.m + n, 1); CAL.y = t.getFullYear(); CAL.m = t.getMonth(); CAL.open = 0; load(); };
    var bar = el('div', { class: 'calbar' }, [
      el('button', { type: 'button', id: 'cal-prev', 'aria-label': 'Previous month', text: '‹', onclick: function () { step(-1); } }),
      el('h2', { id: 'cal-month', 'aria-live': 'polite', text: MONTHS[CAL.m] + ' ' + CAL.y }),
      el('button', { type: 'button', id: 'cal-next', 'aria-label': 'Next month', text: '›', onclick: function () { step(1); } }),
      el('button', { type: 'button', text: 'Today', onclick: function () { CAL.y = N.getFullYear(); CAL.m = N.getMonth(); CAL.open = 0; load(); } }),
      el('span', { class: 'muted', text: 'by ' + C.label })]);
    var head = el('tr', {}, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (d) { return el('th', { scope: 'col', text: d }); }));
    var body = el('tbody');
    for (var w = 0; w < Math.ceil((start + days) / 7); w++) {
      var tr = el('tr');
      for (var i = 0; i < 7; i++) {
        var d = w * 7 + i - start + 1;
        if (d < 1 || d > days) { tr.append(el('td', { class: 'off' })); continue; }
        var evs = by[d] || [], all = CAL.open === d, shown = all ? evs : evs.slice(0, 3);
        var cell = el('td', { class: d === N.getDate() && CAL.m === N.getMonth() && CAL.y === N.getFullYear() ? 'today' : false }, [
          el('div', { class: 'dn' }, [el('span', { text: String(d) }), el('button', { type: 'button', text: '+', 'aria-label': 'New on ' + MONTHS[CAL.m] + ' ' + d, onclick: (function (day) { return function () {
            var pre = {}; pre[C.field] = mdy(day) + (C.control === 'timestamp' ? '${native ? 'T' : ' '}09:00:00' : ''); showForm({ fieldData: pre }, true);
          }; })(d) })])]);
        shown.forEach(function (rec) {
          cell.append(el('button', { type: 'button', class: 'ev', 'data-id': rec.recordId, 'aria-pressed': S.cur && S.cur.recordId === rec.recordId ? 'true' : 'false', text: val(rec, P.columns[0].name) || '(blank)', onclick: function () { openRec(rec); } }));
        });
        if (evs.length > shown.length) cell.append(el('button', { type: 'button', class: 'more', text: '+' + (evs.length - shown.length) + ' more', onclick: (function (day) { return function () { CAL.open = day; renderList(); }; })(d) }));
        tr.append(cell);
      }
      body.append(tr);
    }
    return el('div', {}, [bar, el('table', { class: 'cal', 'aria-label': MONTHS[CAL.m] + ' ' + CAL.y }, [el('thead', {}, [head]), body])]);
  };
`;
}

/**
 * A page for one table: the list (rows open the record beside it or in a side panel), the record form alone (with
 * Previous and Next), or both side by side. Search, sorting, paging, new, save and delete work as the signed-in
 * account; a field the account may not see or change reports the server's reason in the status line.
 */
/** A page's CSS or script without its indentation and whole-line comments: a page has 30,000 characters to fit in. */
const gate = (code: string, name: string, keep: boolean): string => code.replace(keep ? new RegExp(`^[ \\t]*\\/\\*<\\/?${name}>\\*\\/\\n`, 'gm') : new RegExp(`^[ \\t]*\\/\\*<${name}>\\*\\/\\n[\\s\\S]*?^[ \\t]*\\/\\*<\\/${name}>\\*\\/\\n`, 'gm'), '');
/**
 * How much of the restyle a page carries. A page has FileMaker Pro's 30,000 characters to fit in and the restyle costs
 * about 3,500 of them, so a page takes the fullest look that still fits: `full` (badges, pills, record title, floating
 * panels), `soft` (floating panels only) or `plain` (the page as it was).
 */
type Look = 'full' | 'soft' | 'plain';
/** The page's code with the parts for `view` and `look` kept: cards only in a plain table page; the badges, pills and record title only in a full table page; the floating panels in every look but the plain one. */
const forView = (code: string, view: View, look: Look): string => {
  const chips = look === 'full' && view === 'table';
  return ['cards', 'chips'].reduce((c, n) => gate(c, n, n === 'cards' ? view === 'table' : chips), gate(gate(gate(code, 'nochips', !chips), 'float', look !== 'plain'), 'flat', look === 'plain'));
};
const squeeze = (code: string): string => code.replace(/^[ \t]+/gm, '').replace(/^\/\/.*\n/gm, '').replace(/^\/\*(?!__).*\*\/\n/gm, '').replace(/\n[ \t]*\n/g, '\n');

export function interfacePage(layout: string, plan: InterfacePlan, mode: Mode, view: View = 'table'): string {
  // A board or calendar needs its own field; without it the page is the plain list.
  if (view === 'board' && !plan.board) view = 'table';
  if (view === 'calendar' && !plan.calendar) view = 'table';
  // The calendar has no room for the restyle; the others take the fullest look that leaves some of the formula limit free.
  const looks: Look[] = view === 'table' ? ['full', 'soft', 'plain'] : view === 'board' ? ['soft', 'plain'] : ['plain'];
  // The look is the table's, not the page's: the list page is the longest, so the form pages of a table look like its list.
  const look = looks.find((l) => pageFormula(pageWith(layout, plan, 'list', view, l)).length <= RESTYLE_BUDGET) ?? 'plain';
  return pageWith(layout, plan, mode, view, look);
}

/** How long a restyled page's address formula may be: FileMaker Pro's limit, with room left for a longer layout name or a field added later. */
const RESTYLE_BUDGET = FORMULA_LIMIT - 500;

function pageWith(layout: string, plan: InterfacePlan, mode: Mode, view: View, look: Look): string {
  const list = mode !== 'detail';
  const { board, calendar, ...rest } = plan;
  const embed = { layout, mode, view, ...rest, ...(view === 'board' ? { board } : {}), ...(view === 'calendar' ? { calendar } : {}) };
  const extra = view === 'board' ? `<button type="button" id="v-board" aria-pressed="${view === 'board'}">Board</button>` : view === 'calendar' ? `<button type="button" id="v-calendar" aria-pressed="true">Calendar</button>` : '';
  const pressed = (v: View) => (view === v ? 'true' : 'false');
  const searched = plan.search.join(', ');
  const body = `<header><h1>${text(plan.title)}</h1><span class="muted" id="where"></span><span class="grow"></span>${list ? `<input type="search" id="q" placeholder="Search ${searched ? text(searched) : text(plan.title.toLowerCase())}" aria-label="Search ${text(plan.title)}"><span class="seg" role="group" aria-label="View"><button type="button" id="v-table" aria-pressed="${pressed('table')}">Table</button>${view === 'table' ? '<button type="button" id="v-cards" aria-pressed="false">Cards</button>' : ''}${extra}</span>` : ''}<button type="button" class="primary" id="new">New</button></header>
<div id="status" role="status" aria-live="polite"></div>
<main id="layout" class="${mode === 'split' ? 'split' : mode === 'detail' ? 'detail' : 'drawer'}">
${list ? `<section class="listpane" aria-label="${text(plan.title)}"><div class="scroll" id="rows"></div><div class="pager"><button type="button" id="prev">Previous</button><button type="button" id="next">Next</button><span class="muted" id="count" aria-live="polite"></span></div></section>` : ''}
<section class="formpane" aria-label="Record"><div id="form"></div><div class="rel" id="related"></div></section>
</main>`;
  // The drawer of the list page shows only while a record is open.
  const drawer = mode === 'list' ? '\n  .drawer:not(.has-sel) .formpane { display: none; }' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text(plan.title)}</title>
<style>${squeeze(forView(CSS.replace('--h: 200', `--h: ${hue(plan.table)}`) + (view === 'board' ? BOARD_CSS : view === 'calendar' ? CALENDAR_CSS : ''), view, look) + drawer).replace(/([;{}])\n/g, '$1').replace(/: |, | \{|\} /g, (s) => s.trim())}</style>
</head>
<body>
${body}
<script>${squeeze(forView(RUNTIME, view, look).replace('/*__VIEWS__*/', () => (view === 'board' ? BOARD_JS : view === 'calendar' ? calendarJs(plan.native) : '')).replace('/*__CHOICES__*/', () => (plan.fields.some((f) => f.control === 'checkbox' || f.control === 'radio') ? CHOICES_JS : '')).replace('/*__NATIVE__*/', () => (plan.native ? NATIVE_JS : ''))).replace('__PLAN__', () => js(embed))}</script>
</body>
</html>
`;
}

/** A table's fields as a page's stand-in data needs them: name and what kind of control, by layout name. */
export type Samples = Record<string, Record<string, { control: Control; options?: string[] }>>;

const STUB = String.raw`
(function () {
  var S = __SAMPLES__, rows = {}, next = 1000;
  var NAMES = ['Ada Lovelace', 'Grace Hopper', 'Linus Torvalds', 'Hedy Lamarr', 'Alan Turing', 'Margaret Hamilton', 'Dennis Ritchie', 'Katherine Johnson', 'Tim Berners-Lee', 'Radia Perlman', 'Ken Thompson', 'Barbara Liskov'];
  var CITIES = ['London', 'New York', 'Helsinki', 'Vienna', 'Cambridge', 'Seattle', 'Tokyo', 'Toronto'], STATUS = ['Open', 'Paid', 'Late', 'Draft'];
  var p2 = function (n) { return ('0' + n).slice(-2); };
  // Made-up dates fall within a few weeks of today, so a calendar has something to show.
  function near(i) { var d = new Date(Date.now() + ((i * 5) % 40 - 15) * 864e5); return p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + '/' + d.getFullYear(); }
  // A date or timestamp as digits that sort, for finds over a range of dates.
  function stamp(v) { var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2}):(\d{2}))?/.exec(v); return m ? m[3] + p2(m[1]) + p2(m[2]) + p2(m[4] || 0) + p2(m[5] || 0) + p2(m[6] || 0) : ''; }
  function make(layout, i) {
    var d = {};
    Object.keys(S[layout] || {}).forEach(function (f) {
      var c = S[layout][f].control, o = S[layout][f].options, v;
      if (c === 'number') v = String(((i * 37 + 13) % 90 + 10) * (1 + i % 3));
      else if (c === 'date') v = near(i);
      else if (c === 'timestamp') v = near(i) + ' ' + p2(8 + i % 9) + ':30:00';
      else if (c === 'time') v = p2(8 + i % 9) + ':30:00';
      else if (c === 'container') v = i % 4 === 3 ? '' : 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="hsl(' + (i * 47 % 360) + ',55%,70%)"/><circle cx="120" cy="70" r="34" fill="hsl(' + (i * 47 % 360) + ',55%,40%)"/></svg>');
      else if (o && o.length) v = o[i % o.length];
      else if (/mail/i.test(f)) v = NAMES[i % NAMES.length].toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com';
      else if (/city/i.test(f)) v = CITIES[i % CITIES.length];
      else if (/status|stage|state|type|category/i.test(f)) v = STATUS[i % STATUS.length];
      else if (/name|title|company|customer|client|subject/i.test(f)) v = NAMES[i % NAMES.length];
      else if (/notes?|description|comments?|address/i.test(f)) v = 'Sample text for row ' + (i + 1) + '.';
      else v = f + ' ' + (i + 1);
      d[f] = v;
    });
    return { recordId: String(i + 1), modId: '0', fieldData: d };
  }
  function all(layout) { if (!rows[layout]) { rows[layout] = []; for (var i = 0; i < 12; i++) rows[layout].push(make(layout, i)); } return rows[layout]; }
  function page(list, o) {
    o = o || {}; var out = list.slice();
    if (o.sort && o.sort[0]) { var f = o.sort[0].fieldName, dir = o.sort[0].sortOrder === 'descend' ? -1 : 1; out.sort(function (a, b) { var x = a.fieldData[f], y = b.fieldData[f], n = Number(x) - Number(y); return dir * (isNaN(n) ? String(x).localeCompare(String(y)) : n); }); }
    var from = (o.offset || 1) - 1;
    return Promise.resolve({ data: out.slice(from, from + (o.limit || 100)), foundCount: out.length, totalCount: rows[Object.keys(rows)[0]] ? out.length : out.length });
  }
  var find = function (layout, q, o) {
    return page(all(layout).filter(function (r) { return q.some(function (req) { return Object.keys(req).every(function (k) {
      var want = String(req[k]), have = String(r.fieldData[k]).toLowerCase(), span = want.split('...');
      if (span.length === 2) { var at = stamp(have); return !!at && at >= stamp(span[0]) && at <= stamp(span[1]); }
      if (want.slice(0, 2) === '==') return have === want.slice(2).toLowerCase();
      // The page quotes what was typed so the server matches it literally (*"text"* is "contains text"): the stand-in reads the quotes the same way.
      var lit = /^(\*?)("(?:[^"\\]|\\.)*")(\*?)$/.exec(want);
      if (lit) { var text = JSON.parse(lit[2]).toLowerCase(); return lit[1] && lit[3] ? have.indexOf(text) >= 0 : lit[1] ? have.slice(-text.length) === text && have.length >= text.length : lit[3] ? have.slice(0, text.length) === text : have === text; }
      return have.indexOf(want.replace(/\*/g, '').toLowerCase()) >= 0;
    }); }); }), o);
  };
  window.FileMaker = { PerformScript: function () {}, PerformScriptWithOption: function () {} };
  window.tabularius = {
    context: function () { return Promise.resolve({ recordNumber: 1 }); },
    records: function (l, o) { return page(all(l), o); }, find: find,
    valueList: function () { return Promise.reject(new Error('The preview uses the values the page was made with.')); },
    record: function (l, id) { return Promise.resolve({ data: all(l).filter(function (r) { return r.recordId === String(id); }) }); },
    create: function (l, f) { var r = make(l, 0); r.recordId = String(++next); Object.keys(f || {}).forEach(function (k) { r.fieldData[k] = f[k]; }); all(l).push(r); return Promise.resolve({ recordId: r.recordId }); },
    update: function (l, id, f) { all(l).forEach(function (r) { if (r.recordId === String(id)) Object.keys(f || {}).forEach(function (k) { r.fieldData[k] = f[k]; }); }); return Promise.resolve({ modId: '1' }); },
    remove: function (l, id) { rows[l] = all(l).filter(function (r) { return r.recordId !== String(id); }); return Promise.resolve({ deleted: true }); },
    layouts: function () { return Promise.resolve(Object.keys(S)); }, goToLayout: function () { return Promise.resolve(null); },
    image: function (link) { return Promise.resolve(link); },
    summarize: function () { return Promise.reject(new Error('Figures need the real data')); }, performScript: function () { return Promise.resolve(null); }, on: function () {},
  };
  window.openhbam = window.tabularius;
})();
`;

/**
 * A page made for preview: the page with a stand-in for window.tabularius in front, serving made-up records kept in the
 * page (so searching, sorting, editing, adding and deleting all work, and nothing reaches the file). `samples` says
 * which fields each layout has, by layout name, so the page and the layouts it reads related records through agree.
 */
export function previewPage(html: string, samples: Samples): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">`;
  const stub = `<script>${STUB.replace('__SAMPLES__', () => js(samples))}</script>`;
  return html.includes('<head>') ? html.replace('<head>', () => `<head>\n${csp}\n${stub}`) : csp + stub + html;
}

/** The stand-in data a plan's page and its related layouts read, for previewPage. */
export function samplesOf(layout: string, plan: InterfacePlan, others: Record<string, InterfacePlan> = {}): Samples {
  const of = (p: InterfacePlan) => Object.fromEntries(p.fields.map((f) => [f.name, { control: f.control, ...(f.options ? { options: f.options } : {}) }]));
  return { [layout]: of(plan), ...Object.fromEntries(Object.entries(others).map(([name, p]) => [name, of(p)])) };
}

/**
 * A rough guess at what asking the assistant to rewrite template pages will use, shown before anything is sent: the
 * conversation's fixed part, then for each page reading it and writing it again (a page is about 19,000 characters).
 * It is a guess from the usual size of these pages, not a count; the real use is on the assistant's usage line.
 */
export function estimatePolish(pages: number, price?: { input: number; output: number }): { input: number; output: number; usd?: number } {
  const input = pages ? 15_000 + 11_000 * pages : 0;
  const output = 6_000 * pages;
  return { input, output, ...(price && pages ? { usd: (input * price.input + output * price.output) / 1_000_000 } : {}) };
}
