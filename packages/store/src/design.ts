// Design mode: changes to a solution's tables, fields, relationships, value
// lists, custom functions, layouts and scripts, made without FileMaker Pro.
//
// A change is a DesignOp. Applying one updates the design (the schema and
// layout designs a store keeps as JSON) and returns the effects it has on the
// SQL tables, which the store carries out. Ops are logged once their names
// are resolved to ids, so they can be replayed when a store's design is
// re-read from its .fmp12 (after a reader upgrade) without losing edits.
//
// Formulas name fields as text, so renaming a field or table occurrence
// rewrites every formula that refers to it (field definitions, custom
// functions, layout objects, script steps), the way FileMaker's references by
// id follow a rename. Deleting one leaves <Field Missing> / <Table Missing>,
// as FileMaker shows. Unlike FileMaker, a deleted table or field can be
// restored (restoreDeleted): its data is kept aside, and the references the
// delete rewrote are put back.

import { NameTable, fieldSpans } from '../../calc/src/index.ts';
import { parseScriptText, keepUndecodedImportMarks } from './script-text.ts';
import { isFullAccess, BUILT_IN_EXTENDED_PRIVILEGES, type PrivilegeDefinition, type TablePrivileges } from './privileges.ts';
import { relationPath } from './related.ts';
import { checkJavaScript } from './javascript.ts';
import { atPath, diffDesign, undoPatch, type DesignPatch } from './patch.ts';
import { phoneDesign, phoneFingerprint, PHONE_WIDTH } from './phone.ts';
import { componentFrom, places, placed, objectIds, syncPlaced } from './components.ts';
import {
  scriptStepId, scriptStepName, displayedStepLine,
  type Field, type FieldKind, type FieldLookup, type FieldOptions, type FieldType, type JoinOperator, type LayoutDesign, type LayoutDesigns,
  type LayoutObject, type LayoutPart, type LayoutView, type OrderedItem, type PageSetup, type Schema, type ScriptStep, type StepParams, type SummaryType, type Table,
  type Relationship, type TableOccurrence, type DataSource, type CustomFunction, type Script, type ValueListField, type CustomMenu, type CustomMenuItem, type StyleRule, type Theme, type ThemeStyle,
  MENU_COMMANDS,
} from '../../fmp12/src/index.ts';

/** A table, field, layout, ... named by its name or id. */
export type Ref = string | number;

export interface FieldSpec {
  id?: number;
  name: string;
  type?: FieldType;
  kind?: Exclude<FieldKind, 'unknown'>;
  comment?: string;
  /** Calculation formula (kind "calculation"), or an auto-enter calculation (set options.autoEnter.calculation). */
  calculation?: string;
  /** Table occurrence the formula is evaluated from; defaults to the table's first occurrence. */
  calculationContext?: Ref;
  options?: FieldOptionsSpec;
  /** Summary fields: what they summarize. */
  summary?: { type: SummaryType; field: Ref; running?: boolean; restartField?: Ref };
}

/**
 * Per side: allow creating records in that side's table through the
 * relationship (a portal's last row), and delete them when the record they
 * relate to on the other side is deleted.
 */
export interface RelationshipOptions {
  leftCreate?: boolean;
  rightCreate?: boolean;
  leftDelete?: boolean;
  rightDelete?: boolean;
}

const REL_OPTIONS = ['leftCreate', 'rightCreate', 'leftDelete', 'rightDelete'] as const;

export interface PredicateSpec {
  left: Ref;
  operator?: JoinOperator;
  right: Ref;
}

export type DesignOp =
  | { op: 'createTable'; id?: number; name: string; fields?: FieldSpec[]; occurrenceId?: number; layoutId?: number; /** Also add a table occurrence and a layout for it (default true), as FileMaker does. */ withLayout?: boolean }
  | { op: 'renameTable'; table: Ref; name: string }
  | { op: 'deleteTable'; table: Ref }
  | ({ op: 'createField'; table: Ref } & FieldSpec)
  | ({ op: 'updateField'; table: Ref; field: Ref } & Partial<FieldSpec>)
  | { op: 'deleteField'; table: Ref; field: Ref }
  /** Bring back a deleted table or field (its id in the store's deleted list), with its data and the references the delete changed. */
  | { op: 'restoreDeleted'; deleted: number; patch?: DesignPatch }
  | { op: 'createOccurrence'; id?: number; name: string; table?: Ref; /** A table in another hosted file instead: the data source, and the table's id in that file. */ file?: Ref; externalTable?: number; color?: string; graph?: TableOccurrence['graph'] }
  | { op: 'updateOccurrence'; occurrence: Ref; name?: string; table?: Ref; color?: string; graph?: TableOccurrence['graph'] }
  | { op: 'deleteOccurrence'; occurrence: Ref }
  | ({ op: 'createRelationship'; id?: number; left: Ref; right: Ref; predicates: PredicateSpec[] } & RelationshipOptions)
  | ({ op: 'updateRelationship'; relationship: number; left?: Ref; right?: Ref; predicates?: PredicateSpec[] } & RelationshipOptions)
  | { op: 'deleteRelationship'; relationship: number }
  | { op: 'createValueList'; id?: number; name: string; values?: string[]; field?: ValueListFieldSpec; /** The list of that id in another hosted file instead: the data source naming it, and the list's id there. */ external?: { file: Ref; valueList: number } }
  | { op: 'updateValueList'; valueList: Ref; name?: string; values?: string[]; field?: ValueListFieldSpec }
  | { op: 'deleteValueList'; valueList: Ref }
  /** A custom "way in" privilege sets can grant (Manage Security's Extended Privileges tab), beyond Tabularius's own fmapp/fmwebdirect/fmrest/fmxml/fmmcp. */
  | { op: 'createExtendedPrivilege'; id?: number; name: string }
  | { op: 'updateExtendedPrivilege'; extendedPrivilege: Ref; name: string }
  | { op: 'deleteExtendedPrivilege'; extendedPrivilege: Ref }
  | { op: 'createCustomFunction'; id?: number; name: string; parameters?: string[]; formula: string; language?: 'calculation' | 'javascript' }
  | { op: 'updateCustomFunction'; customFunction: Ref; name?: string; parameters?: string[]; formula?: string; language?: 'calculation' | 'javascript' }
  | { op: 'deleteCustomFunction'; customFunction: Ref }
  /**
   * Manage External Data Sources: a FileMaker file reference (paths such as
   * file:Name, fmnet:/host/Name, filemac:/..., one per line, tried in order) or
   * an ODBC entry (one path, odbc:DSN). Tabularius never connects to either: a
   * file reference finds the hosted database of the same name.
   */
  | { op: 'createDataSource'; id?: number; name: string; paths: string[] }
  | { op: 'updateDataSource'; dataSource: Ref; name?: string; paths?: string[] }
  | { op: 'deleteDataSource'; dataSource: Ref }
  | { op: 'createContainerDirectory'; id?: number; path: string }
  | { op: 'updateContainerDirectory'; directory: number; path: string }
  | { op: 'deleteContainerDirectory'; directory: number }
  | { op: 'createLayout'; id?: number; name: string; occurrence?: Ref; /** A full design; without one, a form with every field is generated. */ design?: Partial<LayoutDesign>;
      /** A phone layout made from this desktop layout instead (its occurrence, stacked at `width`), kept in step with it. */ phoneOf?: Ref; width?: number }
  | { op: 'updateLayout'; layout: Ref; name?: string; occurrence?: Ref; design?: Partial<LayoutDesign>; /** Layout Setup's "Include in layout menus". */ includeInMenu?: boolean;
      /** A phone layout: rebuild it from its desktop layout now, hand edits and all. */ rebuildPhone?: boolean }
  | { op: 'deleteLayout'; layout: Ref }
  /**
   * A layout component (not in FileMaker): objects saved once and placed on many layouts. Give the objects themselves, or
   * a layout and the ids of objects on it: those objects then become the component's first placed copy there.
   */
  | { op: 'createComponent'; id?: number; name: string; objects?: LayoutObject[]; layout?: Ref; objectIds?: number[]; library?: LibraryLink }
  /** Rename it or change its objects (bounds from its top left corner): every placed copy follows. */
  | { op: 'updateComponent'; component: Ref; name?: string; objects?: LayoutObject[]; library?: LibraryLink | null }
  /** Placed copies stay on their layouts as plain groups. */
  | { op: 'deleteComponent'; component: Ref }
  | { op: 'createScript'; id?: number; name: string; steps?: StepSpec[]; /** The script as text, one step per line, instead of steps. */ text?: string }
  | { op: 'updateScript'; script: Ref; name?: string; steps?: StepSpec[]; text?: string; /** "Include in menu" in Manage Scripts. */ includeInMenu?: boolean;
      /** Tabularius's runaway guard for this script (Script.limits); null takes it off. */
      limits?: { steps?: number; seconds?: number; loopPasses?: number } | null }
  | { op: 'deleteScript'; script: Ref }
  | { op: 'createCustomMenu'; id?: number; name: string; basedOn?: number; comment?: string; installWhen?: string; items?: MenuItemSpec[] }
  | { op: 'updateCustomMenu'; customMenu: Ref; name?: string; comment?: string; installWhen?: string; items?: MenuItemSpec[] }
  | { op: 'deleteCustomMenu'; customMenu: Ref }
  | { op: 'createMenuSet'; id?: number; name: string; comment?: string; menus?: Ref[] }
  | { op: 'updateMenuSet'; menuSet: Ref; name?: string; comment?: string; menus?: Ref[] }
  | { op: 'deleteMenuSet'; menuSet: Ref }
  /** The menu set the file opens with; null for FileMaker's standard menus. */
  | { op: 'setDefaultMenuSet'; menuSet: Ref | null }
  /** File Options: the scripts run when the first window opens and the last closes, and the layout the file opens on (null clears one). */
  | { op: 'setFileOptions'; onFirstWindowOpen?: Ref | null; onLastWindowClose?: Ref | null; onWindowOpen?: Ref | null; onWindowClose?: Ref | null; openLayout?: Ref | null }
  /** A theme: a copy of another (`from`), or one with no styles yet. */
  | { op: 'createTheme'; id?: number; name: string; from?: Ref; /** Manage Themes' Import: a theme exported from another file. */ content?: ThemeContent }
  /** Rename a theme, or change the look of its elements: element type (see STYLE_ELEMENTS) -> rules, null to drop them. */
  | { op: 'updateTheme'; theme: Ref; name?: string; defaults?: Record<string, StyleRule[] | null> }
  | { op: 'deleteTheme'; theme: Ref }
  /** A named style for one kind of object (its element), as FileMaker's Styles inspector saves. */
  | { op: 'createStyle'; theme: Ref; name: string; element: number; rules?: StyleRule[] }
  /** Rename it (objects using it follow) or change its rules. */
  | { op: 'updateStyle'; theme: Ref; style: string; element?: number; name?: string; rules?: StyleRule[] }
  /** Objects using it go back to their element's look in the theme. */
  | { op: 'deleteStyle'; theme: Ref; style: string; element?: number }
  /** The order of the layout or script list, with folders and separators, as Manage Layouts and Manage Scripts show it. */
  | { op: 'setOrder'; list: 'layouts' | 'scripts'; order: OrderSpec[] };

/** One entry of a layout or script list: an item, a folder of entries, or a separator line. */
export type OrderSpec = { item: Ref; includeInMenu?: boolean } | { folder: string; id?: number; children: OrderSpec[]; includeInMenu?: boolean } | { separator: true; id?: number };

/** A custom menu item: a command (by name or id), a submenu, or a separator, optionally running a script. */
export interface MenuItemSpec {
  kind?: 'command' | 'submenu' | 'separator';
  command?: string | number;
  commandId?: number;
  title?: string;
  installWhen?: string;
  submenu?: Ref;
  submenuId?: number;
  script?: Ref;
  scriptId?: number;
  parameter?: string;
  shortcut?: { key: string; modifiers?: number } | null;
  /** Override bits kept from the file (platform bits FileMaker sets that aren't decoded yet). */
  flags?: number;
}

/** A script step: the step's name (or type id) and its options. */
export interface StepSpec {
  stepId?: number;
  /** Formulas of a step kept as it was (from parseScriptText). */
  calculations?: string[];
  name?: string;
  enabled?: boolean;
  text?: string;
  params?: StepParams;
  line?: string;
}

/** What an op does to the SQL tables; the store carries these out. */
export type Effect =
  | { k: 'createTable'; table: Table }
  | { k: 'renameTable'; from: string; to: string }
  | { k: 'dropTable'; name: string }
  | { k: 'addColumn'; table: string; field: Field }
  | { k: 'renameColumn'; table: string; from: string; to: string }
  | { k: 'dropColumn'; table: string; name: string }
  /** A deleted table or field: its data is kept aside, with the patch that restores its design. */
  | { k: 'trashTable'; table: Table; patch: DesignPatch }
  | { k: 'trashField'; table: string; field: Field; data: boolean; patch: DesignPatch }
  | { k: 'restoreTable'; deleted: number; table: Table }
  | { k: 'restoreField'; deleted: number; table: string; field: Field }
  | { k: 'restoreRetype'; deleted: number; table: string; field: string; type: FieldType }
  | { k: 'retype'; table: string; field: string; from: FieldType; to: FieldType }
  | { k: 'recompute'; table: string; field: string };

export interface DesignState {
  schema: Schema;
  designs: LayoutDesigns;
  fileMode?: 'native' | 'compat';
  /**
   * The store's privilege sets, when a rename or delete must follow through to
   * them: per-object access (layouts, scripts, value lists, tables, fields) is
   * keyed by name, and record-access rules are formulas, both of which have to
   * track design changes or a "no access" restriction is silently lost. Left
   * undefined by callers that don't carry privileges (then nothing is rewritten).
   */
  privileges?: PrivilegeDefinition[];
  /**
   * The tables and value lists of the hosted file a data source points at, when the caller may read that file. Design
   * can't change another file, but it reads these so a layout or value list can use a table occurrence from another
   * file. Not cloned with the state (a function). Left undefined, nothing of another file is read: the caller sets it
   * only for accounts that may design that file too.
   */
  externalFile?: (source: DataSource) => { tables: Table[]; valueLists: Schema['valueLists'] } | undefined;
}

/** A deleted table or field the store still has the data for. */
export interface DeletedDesign {
  id: number;
  kind: 'table' | 'field';
  /** The table (for a field, the table it was in), as named when deleted. */
  table: string;
  name: string;
  at: string;
  account: string | null;
  /** Records whose data is kept: all of a table's, or those with a value in the field. */
  records: number;
  patch: DesignPatch;
}

/** Store-owned deletions, or a recorded patch supplied by the trusted design-log replay. */
export type DeletedLookup = (id: number) => DeletedDesign | Pick<DeletedDesign, 'patch'> | undefined;

/** The list each removed element's id is retired from: "tables", "fields.<table id>", "tableOccurrences", "relationships". */
function retiredKey(path: (string | number | { id: number })[]): string | undefined {
  if (path[0] !== 'schema') return undefined;
  if (path.length === 2 && typeof path[1] === 'string') return path[1];
  if (path.length === 4 && path[1] === 'tables' && typeof path[2] === 'object' && path[3] === 'fields') return `fields.${path[2].id}`;
  return undefined;
}

const retired = (s: Schema, key: string) => s.retiredIds?.[key] ?? [];

/** What a delete changed, from a snapshot taken before it; the ids it removed are kept out of use. */
function deletePatch(st: DesignState, before: DesignState): DesignPatch {
  const patch = diffDesign(before, st);
  for (const r of patch.removed) {
    const key = retiredKey(r.path);
    if (!key) continue;
    const ids = ((st.schema.retiredIds ??= {})[key] ??= []);
    if (!ids.includes(r.value.id)) ids.push(r.value.id);
  }
  return patch;
}

/** A design change that cannot be made; code is a FileMaker error code. */
export class DesignError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const invalid = (msg: string) => new DesignError(960, msg);

/** A CSS color a design may keep: #hex, rgb()/rgba() of numbers, or a name. Nothing that could add a declaration or a url(). */
const isColor = (v: unknown): v is string => typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([0-9.,/ %]+\)|[a-z]+)$/i.test(v.trim());
const occurrenceColor = (v: unknown): string => {
  if (!isColor(v)) throw invalid('A table occurrence\'s color is #rrggbb, rgb(…) or a color name');
  return v.trim();
};

/** A script's own limits from a design op: whole numbers from 1 up; none at all takes them off. */
function scriptLimits(limits: unknown): Script['limits'] | undefined {
  if (limits === null) return undefined;
  if (typeof limits !== 'object' || Array.isArray(limits)) throw invalid('A script\'s limits are {steps, seconds, loopPasses}, or null');
  const out: NonNullable<Script['limits']> = {};
  for (const key of ['steps', 'seconds', 'loopPasses'] as const) {
    const v = (limits as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 1e9) throw invalid(`A script's ${key} limit is a whole number from 1 up`);
    out[key] = v;
  }
  for (const key of Object.keys(limits)) if (!['steps', 'seconds', 'loopPasses'].includes(key)) throw invalid(`Scripts have no "${key}" limit: use steps, seconds or loopPasses`);
  return Object.keys(out).length ? out : undefined;
}

/** A custom function's language as a design op names it: FileMaker's calculations unless it says JavaScript. */
function languageOf(language: unknown): 'calculation' | 'javascript' {
  if (language === undefined || language === 'calculation') return 'calculation';
  if (language === 'javascript') return 'javascript';
  throw invalid('A custom function\'s language is "calculation" or "javascript"');
}

/** A JavaScript function's parameters must be JavaScript names and its body must compile (nothing runs here). */
function checkJavaScriptFunction(cf: CustomFunction): void {
  if (cf.language !== 'javascript') return;
  cf.parameters = cf.parameters.map((p) => p.trim());
  const problem = checkJavaScript(cf.parameters, cf.formula ?? '');
  if (problem) throw invalid(`${cf.name}: ${problem}`);
}
const COMPAT_FIELD_TYPES: FieldType[] = ['text', 'number', 'date', 'time', 'timestamp', 'container'];
/** N5 compat-export preflight can import this list to flag native field types. */
export const NATIVE_FIELD_TYPES: readonly FieldType[] = ['boolean', 'integer', 'decimal', 'json', 'uuid'];
const FIELD_TYPES: readonly FieldType[] = [...COMPAT_FIELD_TYPES, ...NATIVE_FIELD_TYPES];
const fieldTypes = (st: DesignState): readonly FieldType[] => st.fileMode === 'native' ? FIELD_TYPES : COMPAT_FIELD_TYPES;
const FIELD_KINDS = ['normal', 'calculation', 'summary'];
const OPERATORS: JoinOperator[] = ['=', '≠', '<', '≤', '>', '≥', '×'];
const SUMMARY_TYPES: SummaryType[] = ['total', 'average', 'count', 'minimum', 'maximum', 'stdDev', 'fractionOfTotal', 'stdDevP', 'list'];

const nextId = (ids: number[], first = 1) => ids.reduce((m, id) => Math.max(m, id), first - 1) + 1;
const lower = (s: string) => s.toLowerCase();

function checkName(name: unknown, what: string): string {
  if (typeof name !== 'string' || !name.trim()) throw invalid(`${what} needs a name`);
  const n = name.trim();
  if (n.includes('::')) throw invalid(`${what} names can't contain "::"`);
  return n;
}

function unique(names: string[], name: string, what: string, except?: string): void {
  if (names.some((n) => lower(n) === lower(name) && (except === undefined || lower(n) !== lower(except)))) {
    throw new DesignError(504, `${what} "${name}" already exists`);
  }
}

/**
 * Catalog entries seeded with one of Tabularius's own built-in extended-privilege
 * names (a brand-new file's starting catalog, or a real .fmp12's own Extended
 * Privileges table, both predate this check and can carry one) can't be
 * renamed or deleted here: doing so would silently strip that name from every
 * non-full-access set's grants (Tabularius still treats the name as a built-in
 * "way in" regardless of the catalog, so the row isn't really custom).
 */
function checkNotBuiltIn(name: string): void {
  if ((BUILT_IN_EXTENDED_PRIVILEGES as readonly string[]).some((b) => lower(b) === lower(name))) {
    throw new DesignError(504, `"${name}" is one of Tabularius's own extended privileges and can't be renamed or deleted here`);
  }
}

function find<T extends { id: number; name: string }>(list: T[], ref: Ref | undefined, what: string, code: number): T {
  const item = typeof ref === 'number' ? list.find((x) => x.id === ref) : typeof ref === 'string' ? list.find((x) => lower(x.name) === lower(ref)) : undefined;
  if (!item) throw new DesignError(code, `${what} "${ref}" is missing`);
  return item;
}

/** A lookup as design ops write it: occurrences and fields by name or id. */
export interface LookupSpec {
  from?: Ref;
  occurrence: Ref;
  field: Ref;
  noMatch?: 'keep' | 'lower' | 'higher' | 'empty' | 'value';
  value?: string;
  copyEmpty?: boolean;
}

const STRICT_TYPES = ['number', 'date4', 'time'];

/** Field options with names resolved to ids (lookups, the validation value list), checked. */
/** A container field's external storage as changes give it: the base directory by id (0, the default, when left out). */
export interface ExternalStorageSpec { directory?: number; directoryId?: number; secure?: boolean; fewerFolders?: boolean; path?: string }

/** Field options as changes give them: indexing may also be named as Manage Database does (minimal, all). */
export type FieldOptionsSpec = Omit<Partial<FieldOptions>, 'index' | 'externalStorage'> & {
  index?: FieldOptions['index'] | 'minimal' | 'all' | null;
  externalStorage?: ExternalStorageSpec | null;
};

function resolveFieldOptions(s: Schema, table: Table, options: FieldOptionsSpec | undefined): Partial<FieldOptions> | undefined {
  if (!options) return options as undefined;
  const out = structuredClone(options) as Partial<FieldOptions>;
  const ae = out.autoEnter as (NonNullable<FieldOptions['autoEnter']> & { lookup?: FieldLookup | LookupSpec | null }) | null | undefined;
  if (ae?.lookup) {
    const spec = ae.lookup as Partial<FieldLookup & LookupSpec>;
    const from = spec.from ?? spec.fromId;
    const fromTo = from !== undefined ? find(s.tableOccurrences, from, 'Table occurrence', 106)
      : s.tableOccurrences.find((t) => !t.dataSourceId && t.baseTableId === table.id);
    if (!fromTo || fromTo.baseTableId !== table.id || fromTo.dataSourceId) throw invalid(`A lookup starts from a table occurrence of ${table.name}`);
    const to = find(s.tableOccurrences, spec.occurrence ?? spec.occurrenceId, 'Table occurrence', 106);
    if (to.id === fromTo.id || !relationPath(s, fromTo.id, to.id)) throw invalid(`A lookup needs a relationship from ${fromTo.name} to ${to.name}`);
    const source = localTable(s, to);
    const fieldId = source ? find(source.fields, spec.field ?? spec.fieldId, `Field ${to.name}::`, 102).id : Number(spec.field ?? spec.fieldId);
    if (!Number.isInteger(fieldId)) throw invalid('A lookup from another file names its field by id');
    if (spec.noMatch !== undefined && !['keep', 'lower', 'higher', 'value', 'empty'].includes(spec.noMatch)) throw invalid('A lookup\'s noMatch is keep, lower, higher, value or empty');
    const lookup: FieldLookup = { occurrenceId: to.id, fieldId };
    if (from !== undefined) lookup.fromId = fromTo.id;
    if (spec.noMatch && spec.noMatch !== 'keep') lookup.noMatch = spec.noMatch;
    if (spec.noMatch === 'value') lookup.value = String(spec.value ?? '');
    if (spec.copyEmpty) lookup.copyEmpty = true;
    ae.lookup = lookup;
  } else if (ae && 'lookup' in ae) delete ae.lookup;
  const index = options.index;
  if (index === 'all') out.index = { value: true, word: true };
  else if (index === 'minimal') out.index = { value: true };
  else if (index !== undefined && index !== null) {
    if (typeof index !== 'object' || Object.entries(index).some(([k, v]) => !['value', 'word'].includes(k) || v !== true) || !Object.keys(index).length) {
      throw invalid('A field\'s index is minimal, all, or {value, word} (null for none)');
    }
  }
  if (out.noAutoIndex !== undefined && out.noAutoIndex !== null && out.noAutoIndex !== true) (out as Record<string, unknown>).noAutoIndex = null;
  if (out.indexLanguage !== undefined && out.indexLanguage !== null) {
    if (typeof out.indexLanguage !== 'string' || !/^[A-Za-z_]+$/.test(out.indexLanguage)) throw invalid('An index language is a name such as English, Unicode_Raw (Default) or German_Dictionary');
    // A name replaces an id read from the file that had no name.
    (out as Record<string, unknown>).indexLanguageId = null;
  }
  if (options.externalStorage) out.externalStorage = externalStorage(s, options.externalStorage);
  const v = out.validation as (NonNullable<FieldOptions['validation']> & { valueList?: Ref }) | null | undefined;
  if (v) {
    if (v.valueList !== undefined && v.valueList !== null) v.valueList = find(s.valueLists, v.valueList as Ref, 'Value list', 108).id;
    if (v.type !== undefined && v.type !== null && !STRICT_TYPES.includes(v.type)) throw invalid(`A strict data type is one of ${STRICT_TYPES.join(', ')}`);
  }
  return out;
}

/** Base table of a table occurrence in this file (not one from another file). */
const localTable = (s: Schema, to: TableOccurrence) => (to.dataSourceId ? undefined : s.tables.find((t) => t.id === to.baseTableId));

/** The base table behind an occurrence: this file's, or the one in the other hosted file a data source names (when it can be read). */
function tableOf(st: DesignState, to: TableOccurrence): Table | undefined {
  if (!to.dataSourceId) return localTable(st.schema, to);
  const source = st.schema.dataSources.find((d) => d.id === to.dataSourceId);
  return source && st.externalFile?.(source)?.tables.find((t) => t.id === to.baseTableId);
}

/** Where a value list takes its values: a field (and a second field to show) of an occurrence, optionally only related values. */
export interface ValueListFieldSpec {
  occurrence: Ref;
  field: Ref;
  second?: Ref | null;
  showSecondOnly?: boolean;
  /** Only values related to the current record, starting from this occurrence. */
  related?: Ref | null;
  sortBySecond?: boolean;
}

function valueListField(st: DesignState, spec: ValueListFieldSpec): ValueListField {
  const s = st.schema;
  if (!spec || typeof spec !== 'object') throw invalid('A value list field needs an occurrence and a field');
  const to = find(s.tableOccurrences, spec.occurrence, 'Table occurrence', 106);
  const table = tableOf(st, to);
  // One message for every reason the other file can't be read (not hosted, not designable by this account, AI closed to it), so it says nothing about what that file holds.
  if (!table) throw invalid(to.dataSourceId ? `${to.name} is in another file that isn't hosted here or that this account can't design, so its fields can't be read to make a value list` : `${to.name} has no table`);
  const field = find(table.fields, spec.field, `Field ${to.name}::`, 102);
  const out: ValueListField = { occurrenceId: to.id, fieldId: field.id };
  if (spec.second !== undefined && spec.second !== null) out.secondFieldId = find(table.fields, spec.second, `Field ${to.name}::`, 102).id;
  if (spec.showSecondOnly && out.secondFieldId !== undefined) out.showSecondOnly = true;
  if (spec.sortBySecond && out.secondFieldId !== undefined) out.sortBySecond = true;
  if (spec.related !== undefined && spec.related !== null) {
    const from = find(s.tableOccurrences, spec.related, 'Table occurrence', 106);
    if (from.id === to.id) throw invalid('Related values start from a different table occurrence than the one the values come from');
    out.relatedFromId = from.id;
  }
  return out;
}

/**
 * Store container data externally: secure storage (optionally with fewer
 * folders), or open storage under `path` (a calculation; FileMaker's default is
 * "Table/Field/"). The base directory is one of Manage Containers'.
 */
function externalStorage(s: Schema, spec: ExternalStorageSpec): NonNullable<FieldOptions['externalStorage']> {
  if (typeof spec !== 'object') throw invalid('externalStorage is {directory, secure, fewerFolders, path}');
  const directoryId = Number(spec.directory ?? spec.directoryId ?? 0);
  if (directoryId !== 0 && !s.containerDirectories?.some((d) => d.id === directoryId)) throw new DesignError(960, `Base directory ${directoryId} is missing`);
  const out: NonNullable<FieldOptions['externalStorage']> = { directoryId };
  if (spec.secure) {
    out.secure = true;
    if (spec.fewerFolders) out.fewerFolders = true;
  } else {
    const path = typeof spec.path === 'string' ? spec.path.trim() : '';
    if (!path) throw invalid('Open storage needs a path (a calculation), such as "Invoices/Attachment/"');
    out.path = path;
  }
  return out;
}

/** A Manage Containers base directory: relative to the database's folder (or absolute), ending in "/". */
function containerPath(path: unknown): string {
  const p = typeof path === 'string' ? path.trim().replace(/\\/g, '/') : '';
  if (!p) throw invalid('A base directory needs a path, such as Files/Invoices/');
  if (p.split('/').includes('..')) throw invalid('A base directory can\'t go up with ".."');
  return p.endsWith('/') ? p : `${p}/`;
}

/** A resolved value list field as ids, for the design log. */
const fieldSpec = (f: ValueListField): ValueListFieldSpec => ({
  occurrence: f.occurrenceId, field: f.fieldId,
  ...(f.secondFieldId !== undefined ? { second: f.secondFieldId } : {}),
  ...(f.showSecondOnly ? { showSecondOnly: true } : {}),
  ...(f.relatedFromId !== undefined ? { related: f.relatedFromId } : {}),
  ...(f.sortBySecond ? { sortBySecond: true } : {}),
});

// ---------------------------------------------------------------- formulas

type Rename =
  | { kind: 'field'; tableId: number; from: string; to: string | null }
  | { kind: 'occurrence'; from: string; to: string | null };

const MISSING_FIELD = '<Field Missing>';
const MISSING_TABLE = '<Table Missing>';

/**
 * Rewrite one formula for a rename (or a deletion, when `to` is null).
 * contextToId: the occurrence unqualified field names resolve against, if any.
 */
function rewriteFormula(s: Schema, formula: string, r: Rename, contextToId: number | undefined, names: (toId: number | undefined) => NameTable): string {
  if (!formula || !formula.toLowerCase().includes(r.from.toLowerCase())) return formula;
  let spans;
  try {
    spans = fieldSpans(formula, names(contextToId));
  } catch {
    return formula; // a formula this parser can't read is left as it is
  }
  const ctx = contextToId === undefined ? undefined : s.tableOccurrences.find((t) => t.id === contextToId);
  let out = '';
  let last = 0;
  for (const sp of spans) {
    let replacement: string | undefined;
    if (r.kind === 'field') {
      if (lower(sp.name) !== lower(r.from)) continue;
      const to = sp.occurrence === undefined ? ctx : s.tableOccurrences.find((t) => lower(t.name) === lower(sp.occurrence!));
      if (!to || to.dataSourceId || to.baseTableId !== r.tableId) continue;
      const name = r.to ?? MISSING_FIELD;
      replacement = sp.occurrence === undefined ? name : `${sp.occurrence}::${name}`;
    } else {
      if (sp.occurrence === undefined || lower(sp.occurrence) !== lower(r.from)) continue;
      replacement = `${r.to ?? MISSING_TABLE}::${sp.name}`;
    }
    out += formula.slice(last, sp.at) + replacement;
    last = sp.end;
  }
  return last === 0 ? formula : out + formula.slice(last);
}

/** Rewrite "TO::Field" mentions in display text: merge fields (<<TO::Field>>) and script step lines. */
function rewriteText(s: Schema, text: string, r: Rename): string {
  if (!text.toLowerCase().includes(r.from.toLowerCase())) return text;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (r.kind === 'occurrence') {
    return text.replace(new RegExp(`(^|[^\\w])${esc(r.from)}::`, 'gi'), (_m, pre) => `${pre}${r.to ?? MISSING_TABLE}::`);
  }
  for (const to of s.tableOccurrences) {
    if (to.dataSourceId || to.baseTableId !== r.tableId) continue;
    text = text.replace(new RegExp(`(^|[^\\w])${esc(to.name)}::${esc(r.from)}(?![\\w])`, 'gi'), (_m, pre) => `${pre}${to.name}::${r.to ?? MISSING_FIELD}`);
  }
  return text;
}

/** A key in `map` matching `name` case-insensitively (privilege lookups fall back by exact key, so stale casing matters). */
function findKey(map: Record<string, unknown>, name: string): string | undefined {
  return Object.keys(map).find((k) => lower(k) === lower(name));
}

/** Re-key `map[from]` to `map[to]`, or drop it when `to` is null, matching the old key case-insensitively. */
function moveKey(map: Record<string, unknown> | undefined, from: string, to: string | null): void {
  if (!map) return;
  const key = findKey(map, from);
  if (key === undefined) return; // no entry: the object was on the blanket level, nothing to follow
  const value = map[key];
  delete map[key];
  if (to === null) return;
  // Clear any stale entry already sitting under the new name, then re-key.
  const clash = findKey(map, to);
  if (clash !== undefined) delete map[clash];
  map[to] = value;
}

/**
 * Privilege sets key per-object access (layouts, scripts, value lists, base
 * tables) by NAME. When a design object is renamed or removed those keys must
 * follow it, or a "no access" entry is silently orphaned under the old name and
 * the live object falls back to the (more permissive) blanket level — a
 * privilege escalation on rename, a dangling restriction on delete. Re-keys on
 * rename (to set) and drops on delete (to null), across every non-full set.
 */
function rekeyAccess(st: DesignState, kind: 'layout' | 'script' | 'valueList' | 'table', from: string, to: string | null): void {
  for (const set of st.privileges ?? []) {
    // AI exceptions follow table identity for every set, including Full Access.
    if (kind === 'table' && set.aiVisible) {
      if (findKey(set.aiVisible, from) === undefined && to !== null) {
        // An unmarked table must not acquire a stale grant at the destination name.
        const stale = findKey(set.aiVisible, to);
        if (stale !== undefined) delete set.aiVisible[stale];
      } else moveKey(set.aiVisible, from, to);
    }
    if (isFullAccess(set)) continue;
    const map = kind === 'layout' ? set.layoutAccess
      : kind === 'script' ? set.scriptAccess
      : kind === 'valueList' ? set.valueListAccess
      : set.tables;
    moveKey(map, from, to);
  }
}

/**
 * Extended privileges are granted by NAME in a privilege set's
 * `extendedPrivileges` list (unlike layouts/scripts/value lists/tables, a flat
 * array, not a map keyed by name). Renaming or deleting one in the catalog
 * must follow through there too, or a grant silently stops matching anything
 * on rename (a lockout, the mirror image of the escalation `rekeyAccess`
 * guards against) and sits inert after a delete. Re-keys on rename (to set)
 * and drops on delete (to null), across every non-full set.
 */
function rekeyExtendedPrivilege(st: DesignState, from: string, to: string | null): void {
  for (const set of st.privileges ?? []) {
    if (isFullAccess(set)) continue;
    const has = set.extendedPrivileges.some((e) => lower(e) === lower(from));
    if (!has) continue;
    set.extendedPrivileges = set.extendedPrivileges.filter((e) => lower(e) !== lower(from));
    // The rename target might already be granted under its own name (an ungoverned string from an import or a
    // direct savePrivilegeSet, never registered in the catalog) — don't end up with it listed twice.
    if (to !== null && !set.extendedPrivileges.some((e) => lower(e) === lower(to))) set.extendedPrivileges.push(to);
  }
}

/** Re-key or drop a per-field access entry under its base table, across every non-full set. */
function rekeyField(st: DesignState, table: string, from: string, to: string | null): void {
  for (const set of st.privileges ?? []) {
    const key = set.aiVisible && findKey(set.aiVisible, table);
    const visible = key !== undefined ? set.aiVisible![key] : undefined;
    if (Array.isArray(visible)) {
      const marked = visible.some((name) => lower(name) === lower(from));
      // Remove stale destination grants too: marks belong to the old field, not its next name.
      const kept = visible.filter((name) => lower(name) !== lower(from) && (to === null || lower(name) !== lower(to)));
      if (marked && to !== null) kept.push(to);
      set.aiVisible![key!] = kept;
    }
    if (isFullAccess(set)) continue;
    if (!set.tables) continue;
    const t = findKey(set.tables, table);
    if (t !== undefined) moveKey(set.tables[t].fields, from, to);
  }
}

/** Apply a rename to every formula and cached name in the design. Runs before the schema itself changes. */
function propagate(st: DesignState, r: Rename): void {
  const s = st.schema;
  const tables = new Map<number, NameTable>();
  const occurrences: [string, string[]][] = s.tableOccurrences.map((to) => [to.name, localTable(s, to)?.fields.map((f) => f.name) ?? []]);
  const names = (toId: number | undefined) => {
    const key = toId ?? -1;
    let t = tables.get(key);
    if (!t) {
      const to = toId === undefined ? undefined : s.tableOccurrences.find((x) => x.id === toId);
      t = new NameTable({ fields: to ? localTable(s, to)?.fields.map((f) => f.name) ?? [] : [], occurrences });
      tables.set(key, t);
    }
    return t;
  };
  const fx = (formula: string | undefined, ctx?: number) => (formula === undefined ? undefined : rewriteFormula(s, formula, r, ctx, names));

  for (const t of s.tables) {
    const defaultTo = s.tableOccurrences.find((to) => !to.dataSourceId && to.baseTableId === t.id)?.id;
    for (const f of t.fields) {
      const ctx = f.calculationContextId ?? defaultTo;
      if (f.calculation !== undefined) f.calculation = fx(f.calculation, ctx);
      const v = f.options?.validation;
      if (v?.calculation !== undefined) v.calculation = fx(v.calculation, ctx);
    }
  }
  for (const cf of s.customFunctions) if (cf.formula !== undefined && cf.language !== 'javascript') cf.formula = fx(cf.formula);
  for (const m of s.customMenus ?? []) {
    if (m.installWhen !== undefined) m.installWhen = fx(m.installWhen);
    for (const i of m.items) {
      if (i.title !== undefined) i.title = fx(i.title);
      if (i.installWhen !== undefined) i.installWhen = fx(i.installWhen);
      if (i.parameter !== undefined) i.parameter = fx(i.parameter);
    }
  }

  for (const script of s.scripts) {
    for (const step of script.steps) {
      if (step.calculations) step.calculations = step.calculations.map((c) => fx(c)!);
      const p = step.params;
      if (p) {
        for (const k of ['calculation', 'value', 'parameter', 'repetition', 'repetitionCalculation', 'layoutCalculation', 'scriptCalculation', 'message', 'title'] as const) {
          if (typeof p[k] === 'string') (p as Record<string, unknown>)[k] = fx(p[k] as string);
        }
        if (p.slots) for (const k of Object.keys(p.slots)) p.slots[Number(k)] = fx(p.slots[Number(k)])!;
        const ai = p.ai as Record<string, unknown> | undefined;
        if (ai) for (const k of Object.keys(ai)) if (typeof ai[k] === 'string' && !['queryBy', 'recordSet', 'condition', 'ragAction', 'dataSource', 'requestType'].includes(k)) ai[k] = fx(ai[k] as string);
        const refs = [p.field, p.ai?.sourceField, ...(p.requests ?? []).flatMap((q) => q.criteria.map((c) => c.field)), ...(p.sort ?? []).map((x) => x.field)];
        for (const ref of refs) {
          if (!ref) continue;
          if (r.kind === 'occurrence' && lower(ref.tableOccurrence.name) === lower(r.from)) ref.tableOccurrence.name = r.to ?? MISSING_TABLE;
          if (r.kind === 'field' && lower(ref.field.name) === lower(r.from) && occurrenceOnTable(s, ref.tableOccurrence.id, r.tableId)) ref.field.name = r.to ?? MISSING_FIELD;
        }
        if (r.kind === 'occurrence' && p.tableOccurrence && lower(p.tableOccurrence.name) === lower(r.from)) p.tableOccurrence.name = r.to ?? MISSING_TABLE;
      }
      if (step.line) step.line = rewriteText(s, step.line, r);
    }
  }

  for (const rel of s.relationships) {
    if (r.kind === 'occurrence') {
      if (rel.leftTableOccurrence && lower(rel.leftTableOccurrence) === lower(r.from)) rel.leftTableOccurrence = r.to ?? MISSING_TABLE;
      if (rel.rightTableOccurrence && lower(rel.rightTableOccurrence) === lower(r.from)) rel.rightTableOccurrence = r.to ?? MISSING_TABLE;
    } else {
      for (const p of rel.predicates) {
        if (p.leftField && lower(p.leftField) === lower(r.from) && occurrenceOnTable(s, rel.leftTableOccurrenceId, r.tableId)) p.leftField = r.to ?? MISSING_FIELD;
        if (p.rightField && lower(p.rightField) === lower(r.from) && occurrenceOnTable(s, rel.rightTableOccurrenceId, r.tableId)) p.rightField = r.to ?? MISSING_FIELD;
      }
    }
  }
  if (r.kind === 'field') {
    const t = s.tables.find((x) => x.id === r.tableId);
    for (const f of t?.fields ?? []) {
      if (f.summary?.field && lower(f.summary.field) === lower(r.from)) f.summary.field = r.to ?? MISSING_FIELD;
      if (f.summary?.restartField && lower(f.summary.restartField) === lower(r.from)) f.summary.restartField = r.to ?? MISSING_FIELD;
    }
  }

  const walk = (objs: LayoutObject[], ctx: number | undefined) => {
    for (const o of objs) {
      if (o.hide) o.hide.formula = fx(o.hide.formula, ctx)!;
      if (o.placeholder !== undefined) o.placeholder = fx(o.placeholder, ctx);
      if (o.tooltip !== undefined) o.tooltip = fx(o.tooltip, ctx);
      if (o.action?.parameter !== undefined) o.action.parameter = fx(o.action.parameter, ctx);
      for (const c of o.conditions ?? []) c.formula = fx(c.formula, ctx)!;
      for (const t of o.triggers ?? []) if (t.parameter !== undefined) t.parameter = fx(t.parameter, ctx);
      if (o.text) o.text = rewriteText(s, o.text, r);
      if (o.field) renameRef(s, o.field, r);
      if (r.kind === 'occurrence' && o.portal?.tableOccurrence && lower(o.portal.tableOccurrence) === lower(r.from)) o.portal.tableOccurrence = r.to ?? MISSING_TABLE;
      if (o.portal?.filter !== undefined) o.portal.filter = fx(o.portal.filter, o.portal.tableOccurrenceId);
      for (const k of o.portal?.sort ?? []) renameRef(s, k.field, r);
      if (o.children) walk(o.children, ctx);
    }
  };
  for (const layout of st.designs.layouts) {
    const ctx = layout.tableOccurrenceId;
    walk(layout.objects, ctx);
    for (const c of layout.tableView ?? []) renameRef(s, c.field, r);
    for (const p of layout.parts) if (p.breakField) renameRef(s, p.breakField, r);
    for (const t of layout.triggers ?? []) if (t.parameter !== undefined) t.parameter = fx(t.parameter, ctx);
  }
  // Components too: their copies are rebuilt from them, so a rename only on the copies would be undone on the next save.
  for (const c of st.designs.components ?? []) for (const ctx of componentContexts(st, c.id)) walk(c.objects, ctx);

  // Record-access ("limited") rules are formulas too, kept in privilege sets
  // rather than the design, so a field or occurrence rename has to follow them
  // the same way — otherwise the rule keeps naming the old field and quietly
  // stops matching (fails closed, but wrongly).
  const defaultTo = (tableId: number | undefined) =>
    tableId === undefined ? undefined : s.tableOccurrences.find((to) => !to.dataSourceId && to.baseTableId === tableId)?.id;
  const rewriteRules = (tp: TablePrivileges, ctxToId: number | undefined) => {
    for (const k of ['view', 'edit', 'delete'] as const) {
      const v = tp[k];
      if (typeof v === 'string') tp[k] = fx(v, ctxToId)!;
    }
  };
  for (const set of st.privileges ?? []) {
    if (isFullAccess(set)) continue;
    // The blanket rule covers every table; resolve its unqualified names against the renamed field's own table.
    rewriteRules(set.records, r.kind === 'field' ? defaultTo(r.tableId) : undefined);
    for (const [name, tp] of Object.entries(set.tables ?? {})) {
      rewriteRules(tp, defaultTo(s.tables.find((t) => lower(t.name) === lower(name))?.id));
    }
  }
}

function occurrenceOnTable(s: Schema, toId: number, tableId: number): boolean {
  const to = s.tableOccurrences.find((t) => t.id === toId);
  return !!to && !to.dataSourceId && to.baseTableId === tableId;
}

function renameRef(s: Schema, ref: { tableOccurrenceId: number; tableOccurrence?: string; field?: string }, r: Rename): void {
  if (r.kind === 'occurrence' && ref.tableOccurrence && lower(ref.tableOccurrence) === lower(r.from)) ref.tableOccurrence = r.to ?? MISSING_TABLE;
  if (r.kind === 'field' && ref.field && lower(ref.field) === lower(r.from) && occurrenceOnTable(s, ref.tableOccurrenceId, r.tableId)) ref.field = r.to ?? MISSING_FIELD;
}

/**
 * A data source's paths: one per entry, each a type and a path (file:, filemac:,
 * filewin:, fmnet:, or odbc: alone for an ODBC source; a $variable path has no
 * type, as FileMaker stores it).
 */
function dataSourcePaths(paths: unknown): string[] {
  const list = (Array.isArray(paths) ? paths : typeof paths === 'string' ? paths.split(/\r?\n/) : []).map((p) => String(p).trim()).filter(Boolean)
    .map((p) => (p.startsWith('$') ? `:${p}` : p));
  if (!list.length) throw invalid('A data source needs a path: file:Name for a FileMaker file, odbc:DSN for ODBC');
  for (const p of list) {
    if (!/^(?:file|filemac|filewin|fmnet|odbc)?:\S/i.test(p)) throw invalid(`"${p}" isn't a data source path: start it with file:, fmnet:, filemac:, filewin: or odbc:`);
    if (/^:/.test(p) && !/^:\$/.test(p)) throw invalid(`"${p}" needs a type, such as file:`);
  }
  const odbc = list.filter((p) => /^odbc:/i.test(p));
  if (odbc.length && list.length > 1) throw invalid('An ODBC data source has one path, odbc:DSN');
  return list.map((p) => p.replace(/^(file|filemac|filewin|fmnet|odbc):/i, (_m, t: string) => `${t.toLowerCase()}:`));
}

/** Rename a data source in the steps that name it (Open File, Close File, Perform Script from another file). */
function renameDataSource(s: Schema, id: number, from: string, to: string): void {
  for (const script of s.scripts) {
    for (const step of script.steps) {
      for (const ref of [step.params?.dataSource, step.params?.script?.file]) {
        if (ref?.id !== id) continue;
        ref.name = to;
        if (step.line) step.line = step.line.split(`“${from}”`).join(`“${to}”`);
      }
    }
  }
}

/** Rename a layout or script in the places that show its name (orders, steps, buttons). */
function renameItem(st: DesignState, kind: 'layout' | 'script', id: number, from: string, to: string): void {
  const s = st.schema;
  const order = kind === 'layout' ? s.layoutOrder : s.scriptOrder;
  for (const o of order) if (o.kind === 'item' && o.id === id) o.name = to;
  const quoted = (line: string) => line.split(`“${from}”`).join(`“${to}”`);
  for (const script of s.scripts) {
    for (const step of script.steps) {
      const ref = kind === 'layout' ? step.params?.layout : step.params?.script;
      if (ref && ref.id === id && !(kind === 'script' && step.params?.script?.file)) {
        ref.name = to;
        if (step.line) step.line = quoted(step.line);
      }
    }
  }
  if (kind === 'script') for (const m of s.customMenus ?? []) for (const i of m.items) if (i.scriptId === id) i.script = to;
  const walk = (objs: LayoutObject[]) => {
    for (const o of objs) {
      if (o.action) {
        if (kind === 'layout' && o.action.layoutId === id) o.action.layout = to;
        if (kind === 'script' && o.action.scriptId === id && !o.action.file) o.action.script = to;
      }
      if (kind === 'script') for (const t of o.triggers ?? []) if (t.scriptId === id) t.script = to;
      if (o.children) walk(o.children);
    }
  };
  for (const layout of st.designs.layouts) {
    if (kind === 'layout' && layout.id === id) layout.name = to;
    walk(layout.objects);
    if (kind === 'script') for (const t of layout.triggers ?? []) if (t.scriptId === id) t.script = to;
  }
  for (const c of st.designs.components ?? []) walk(c.objects);
}

/** The table occurrences a component's unqualified names can mean: those of the layouts it is placed on (none placed: no context). */
function componentContexts(st: DesignState, componentId: number): (number | undefined)[] {
  const tos = [...new Set(st.designs.layouts.filter((d) => places(d, componentId)).map((d) => d.tableOccurrenceId))];
  return tos.length ? tos : [undefined];
}


// ---------------------------------------------------------------- custom menus

const COMMAND_IDS = new Map(Object.entries(MENU_COMMANDS).map(([id, name]) => [name.toLowerCase(), Number(id)]));
const optionalText = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? undefined : String(v));

function menuItems(s: Schema, specs: MenuItemSpec[] | undefined, self?: number): CustomMenuItem[] {
  if (specs === undefined) return [];
  if (!Array.isArray(specs)) throw invalid('Menu items are a list');
  return specs.map((spec) => {
    const kind = spec.kind ?? (spec.submenu !== undefined || spec.submenuId !== undefined ? 'submenu' : 'command');
    if (!['command', 'submenu', 'separator'].includes(kind)) throw invalid('A menu item is a command, a submenu or a separator');
    // Bits 0x01 title, 0x02 shortcut and 0x08 script follow the item; the others are kept as read.
    const item: CustomMenuItem = { kind, flags: (Number(spec.flags) || 0) & ~0x0b };
    if (kind === 'separator') return item;
    const title = optionalText(spec.title);
    if (title !== undefined) { item.title = title; item.flags |= 0x01; }
    const when = optionalText(spec.installWhen);
    if (when !== undefined) item.installWhen = when;
    if (kind === 'submenu') {
      const menu = find(s.customMenus, spec.submenu ?? spec.submenuId, 'Custom menu', 960);
      if (menu.id === self) throw invalid(`Menu "${menu.name}" can't be its own submenu`);
      item.submenuId = menu.id;
      item.submenu = menu.name;
      return item;
    }
    const command = spec.commandId ?? spec.command;
    if (command !== undefined && command !== null && command !== '') {
      const id = typeof command === 'number' ? command : COMMAND_IDS.get(String(command).toLowerCase()) ?? (/^\d+$/.test(String(command)) ? Number(command) : undefined);
      if (id === undefined) throw invalid(`Unknown menu command "${command}"`);
      item.commandId = id;
      if (MENU_COMMANDS[id]) item.command = MENU_COMMANDS[id];
    }
    const scriptRef = spec.script ?? spec.scriptId;
    if (scriptRef !== undefined && scriptRef !== null && scriptRef !== '') {
      const script = find(s.scripts, scriptRef, 'Script', 104);
      item.scriptId = script.id;
      item.script = script.name;
      item.flags |= 0x08;
      const parameter = optionalText(spec.parameter);
      if (parameter !== undefined) item.parameter = parameter;
    }
    if (item.commandId === undefined && item.scriptId === undefined) throw invalid('A menu item runs a command or a script');
    if (spec.shortcut && spec.shortcut.key) {
      const key = String(spec.shortcut.key);
      if (key.length !== 1) throw invalid('A shortcut is one key');
      item.shortcut = { key: key.toUpperCase(), modifiers: Number(spec.shortcut.modifiers) || 0 };
      item.flags |= 0x02;
    }
    return item;
  });
}

/** Menu items as specs, by id: what the log keeps so a replay doesn't depend on names. */
const itemSpecs = (items: CustomMenuItem[]): MenuItemSpec[] => items.map((i) => ({
  kind: i.kind, flags: i.flags,
  ...(i.commandId !== undefined ? { commandId: i.commandId } : {}), ...(i.title !== undefined ? { title: i.title } : {}),
  ...(i.installWhen !== undefined ? { installWhen: i.installWhen } : {}), ...(i.submenuId !== undefined ? { submenuId: i.submenuId } : {}),
  ...(i.scriptId !== undefined ? { scriptId: i.scriptId } : {}), ...(i.parameter !== undefined ? { parameter: i.parameter } : {}),
  ...(i.shortcut ? { shortcut: i.shortcut } : {}),
}));

function menuIds(s: Schema, refs: Ref[] | undefined): number[] {
  if (refs === undefined) return [];
  if (!Array.isArray(refs)) throw invalid('A menu set\'s menus are a list');
  return refs.map((r) => find(s.customMenus, r, 'Custom menu', 960).id);
}

// ---------------------------------------------------------------- layouts

/** A plain form layout: a label and an edit box for each field, in a header/body/footer. */
export const FIELD_STYLE = { element: 61, rules: [{ part: 1, state: 1, css: { 'background-color': '#ffffff', border: '1px solid #b9bec7', 'border-radius': '4px', padding: '2px 4px', color: '#1d1d1f' } }] };
export const LABEL_STYLE = { element: 70, rules: [{ part: 1, state: 1, css: { color: '#55595f', 'text-align': 'right', 'padding-right': '8px' } }] };
export const TITLE_STYLE = { element: 70, rules: [{ part: 1, state: 1, css: { 'font-size': '18px', 'font-weight': '600', color: '#1d1d1f' } }] };

/** A layout design; `generated` marks one design mode made and nobody has edited yet. */
type Design = LayoutDesign & { generated?: boolean };

export function generateLayout(st: DesignState, id: number, name: string, toId: number, view: LayoutView = 'form'): Design {
  const s = st.schema;
  const to = s.tableOccurrences.find((t) => t.id === toId);
  const table = to && tableOf(st, to);
  const fields = (table?.fields ?? []).filter((f) => f.type !== 'unknown');
  if (view === 'list') return generateList(st, id, name, toId, fields);
  const header = 60;
  const row = 30;
  const body = Math.max(120, fields.length * row + 40);
  const parts: LayoutPart[] = [
    { kind: 'header', kindId: 1, top: 0, height: header, style: {} },
    { kind: 'body', kindId: 4, top: header, height: body, style: {} },
    { kind: 'footer', kindId: 7, top: header + body, height: 40, style: {} },
  ];
  const anchors = { left: true, top: true, right: false, bottom: false };
  // Without a theme, fields get a visible box of their own.
  const boxStyle = st.designs.themes.length ? { element: 61 } : FIELD_STYLE;
  const labelStyle = st.designs.themes.length ? { element: 70 } : LABEL_STYLE;
  const objects: LayoutObject[] = [
    { id: 1, kind: 'text', type: 2, bounds: { top: 18, left: 20, bottom: 42, right: 520 }, anchors, style: TITLE_STYLE, text: name },
  ];
  let next = 2;
  fields.forEach((f, i) => {
    const top = header + 20 + i * row;
    objects.push({ id: next++, kind: 'text', type: 2, bounds: { top: top + 2, left: 20, bottom: top + 22, right: 150 }, anchors, style: labelStyle, text: f.name });
    objects.push({
      id: next++, kind: 'field', type: 1, bounds: { top, left: 160, bottom: top + 22, right: 520 }, anchors, style: boxStyle,
      field: { tableOccurrenceId: toId, fieldId: f.id, tableOccurrence: to!.name, field: f.name, display: 'edit', repetitions: 1 },
    });
  });
  return {
    id, name, tableOccurrenceId: toId, width: 560, themeId: st.designs.themes[0]?.id, style: {}, parts, objects, generated: true,
    tableView: fields.map((f) => ({ field: { tableOccurrenceId: toId, fieldId: f.id, tableOccurrence: to!.name, field: f.name }, width: 120 })),
  };
}

/** A list layout: column labels in the header, one row of fields per record (the first 8 that aren't containers). */
function generateList(st: DesignState, id: number, name: string, toId: number, all: Field[]): Design {
  const to = st.schema.tableOccurrences.find((t) => t.id === toId)!;
  const fields = all.filter((f) => f.type !== 'container').slice(0, 8);
  const col = 130;
  const width = Math.max(560, 20 + fields.length * col);
  const anchors = { left: true, top: true, right: false, bottom: false };
  const themed = st.designs.themes.length > 0;
  const parts: LayoutPart[] = [
    { kind: 'header', kindId: 1, top: 0, height: 70, style: {} },
    { kind: 'body', kindId: 4, top: 70, height: 30, style: {} },
    { kind: 'footer', kindId: 7, top: 100, height: 30, style: {} },
  ];
  const objects: LayoutObject[] = [
    { id: 1, kind: 'text', type: 2, bounds: { top: 12, left: 20, bottom: 36, right: width - 20 }, anchors, style: TITLE_STYLE, text: name },
  ];
  let next = 2;
  fields.forEach((f, i) => {
    const left = 20 + i * col;
    objects.push({ id: next++, kind: 'text', type: 2, bounds: { top: 46, left, bottom: 66, right: left + col - 10 }, anchors, style: themed ? { element: 70 } : LABEL_STYLE, text: f.name });
    objects.push({
      id: next++, kind: 'field', type: 1, bounds: { top: 74, left, bottom: 96, right: left + col - 10 }, anchors, style: themed ? { element: 61 } : FIELD_STYLE,
      field: { tableOccurrenceId: toId, fieldId: f.id, tableOccurrence: to.name, field: f.name, display: 'edit', repetitions: 1 },
    });
  });
  return {
    id, name, tableOccurrenceId: toId, width, themeId: st.designs.themes[0]?.id, style: {}, parts, objects, view: 'list',
    tableView: fields.map((f) => ({ field: { tableOccurrenceId: toId, fieldId: f.id, tableOccurrence: to.name, field: f.name }, width: 120 })),
  };
}

/** A new field joins the layouts design mode generated for its table, until someone edits them. */
function addToGeneratedLayouts(st: DesignState, table: Table, field: Field): number[] {
  const changed: number[] = [];
  for (const d of st.designs.layouts as Design[]) {
    if (!d.generated || d.tableOccurrenceId === undefined) continue;
    const to = st.schema.tableOccurrences.find((t) => t.id === d.tableOccurrenceId);
    if (!to || localTable(st.schema, to) !== table) continue;
    const body = d.parts.find((p) => p.kind === 'body');
    const fields = d.objects.filter((o) => o.kind === 'field');
    const top = fields.length ? Math.max(...fields.map((o) => o.bounds.top)) + 30 : (body?.top ?? 0) + 20;
    let id = Math.max(0, ...d.objects.map((o) => o.id)) + 1;
    const anchors = { left: true, top: true, right: false, bottom: false };
    const themed = d.themeId !== undefined;
    d.objects.push({ id: id++, kind: 'text', type: 2, bounds: { top: top + 2, left: 20, bottom: top + 22, right: 150 }, anchors, style: themed ? { element: 70 } : LABEL_STYLE, text: field.name });
    d.objects.push({
      id: id++, kind: 'field', type: 1, bounds: { top, left: 160, bottom: top + 22, right: 520 }, anchors, style: themed ? { element: 61 } : FIELD_STYLE,
      field: { tableOccurrenceId: to.id, fieldId: field.id, tableOccurrence: to.name, field: field.name, display: 'edit', repetitions: 1 },
    });
    d.tableView?.push({ field: { tableOccurrenceId: to.id, fieldId: field.id, tableOccurrence: to.name, field: field.name }, width: 120 });
    // Grow the body (and move the parts below it) to fit.
    if (body && top + 40 > body.top + body.height) {
      const grow = top + 40 - (body.top + body.height);
      body.height += grow;
      for (const p of d.parts) if (p.top > body.top) p.top += grow;
    }
    changed.push(d.id);
  }
  return changed;
}

/**
 * Buttons that do one step other than Perform Script: `action.text` is the step
 * as a script line ("Set Field [ Invoices::Status ; "Paid" ]"), read as a
 * script's line is and stored as the step's options (what the web client runs).
 */
function buttonSteps(s: Schema, d: Partial<LayoutDesign>): void {
  const walk = (objs: LayoutObject[]) => {
    for (const o of objs) {
      const a = o.action as (LayoutObject['action'] & { text?: unknown; line?: string }) | undefined;
      if (a && typeof a.text === 'string') {
        // The scripts of other files that this file's scripts already perform are the ones a button can name (From file: "…").
        const performed = s.scripts.flatMap((x) => x.steps.filter((y) => y.params?.script?.file));
        const specs = parseScriptText(a.text.trim(), s, performed);
        if (specs.length !== 1) throw invalid(`A button does one step: "${a.text.trim().split('\n')[0]}"`);
        const [step] = buildSteps(specs);
        if (step.stepId === 89 || step.name === '# (comment)') throw invalid('A button\'s step can\'t be a comment');
        if (step.stepId === 1) {
          // Perform Script keeps the script and parameter where buttons have them.
          const sc = step.params?.script;
          const parameter = step.params?.parameter ? { parameter: step.params.parameter } : {};
          if (sc?.file) {
            // A script in another file (one a script here already performs): kept by id with its data source, as a
            // button of an imported file is; the script's name is the other file's to give.
            o.action = { stepId: 1, step: step.name, scriptId: sc.id, file: sc.file, ...parameter } as never;
          } else {
            const script = sc ? s.scripts.find((x) => x.id === sc.id) : undefined;
            if (!script) throw invalid('Perform Script on a button needs a script of this file, or one a script here already performs from another file');
            o.action = { stepId: 1, step: step.name, scriptId: script.id, script: script.name, ...parameter } as never;
          }
        } else {
          o.action = { stepId: step.stepId, step: step.name, ...(step.params ? { params: step.params } : {}), line: step.line } as never;
        }
      }
      if (o.kind === 'button-bar' && o.activeSegment !== undefined && !o.children?.some((c) => c.id === o.activeSegment)) {
        throw invalid('A button bar\'s active segment must be one of its segments');
      }
      if (o.chart !== undefined) checkChart(o.chart);
      if (o.children) walk(o.children);
    }
  };
  walk(d.objects ?? []);
}

/** Whether any of the objects, or anything inside them, is a placed copy of a component. */
function hasPlacedCopy(objs: LayoutObject[]): boolean {
  return objs.some((o) => !!o.component || (!!o.children && hasPlacedCopy(o.children)));
}

type LibraryLink = { id: string; version: number };

/** A component's link to the server's component library: an id and a version. */
function libraryLink(v: unknown): LibraryLink | undefined {
  if (v === undefined) return undefined;
  const l = v as LibraryLink;
  if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !/^[0-9a-f]{1,64}$/.test(l.id) || !Number.isInteger(l.version) || l.version < 1) throw invalid('A component\'s library link is {"id", "version"}');
  return { id: l.id, version: l.version };
}

/** A component's objects get the checks a layout's do (button steps parsed, charts checked), and hold no copies of components. */
function checkComponentObjects(s: Schema, objects: LayoutObject[]): void {
  checkDesign({ objects });
  if (hasPlacedCopy(objects)) throw invalid('A placed component can\'t go inside another component');
  buttonSteps(s, { objects });
}

const LAYOUT_VIEWS: LayoutView[] = ['form', 'list', 'table'];

/** Layout Setup options keep only what differs from FileMaker's defaults, so true clears one. */
function tidySetup(d: Design): void {
  if (d.viewsAllowed && LAYOUT_VIEWS.every((v) => d.viewsAllowed!.includes(v))) delete d.viewsAllowed;
  else if (d.viewsAllowed) d.viewsAllowed = LAYOUT_VIEWS.filter((v) => d.viewsAllowed!.includes(v));
  for (const k of ['saveRecordChanges', 'recordIndicator', 'fieldFrames'] as const) if (d[k] !== false) delete d[k];
  // 0 is a choice (this layout never stacks, whatever the server's default is); no width at all is the server's default.
  if (d.responsive && d.responsive.stackBelow === undefined) delete d.responsive;
  // One column is FileMaker's default, and across first the default order.
  if (d.printColumns && d.printColumns.count <= 1) delete d.printColumns;
  else if (d.printColumns) d.printColumns = { count: d.printColumns.count, ...(d.printColumns.order === 'down' ? { order: 'down' as const } : {}) };
}

function checkDesign(d: Partial<LayoutDesign>, pageSetup?: PageSetup): void {
  const width = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10000);
  if (d.parts !== undefined && !Array.isArray(d.parts)) throw invalid('A layout design\'s parts must be a list');
  if (d.objects !== undefined && !Array.isArray(d.objects)) throw invalid('A layout design\'s objects must be a list');
  // null takes an optional setting away; these a layout always has.
  for (const k of ['id', 'name', 'tableOccurrenceId', 'generated', 'width', 'style']) if ((d as Record<string, unknown>)[k] === null) throw invalid(`A layout's ${k} can't be taken away`);
  for (const p of d.parts ?? []) {
    const every = p?.options?.pageBreakEvery;
    if (every !== undefined && !(Number.isInteger(every) && every > 0)) throw invalid('A part\'s page break must come after a whole number of occurrences, 1 or more');
  }
  const walk = (objs: unknown[]) => {
    for (const o of objs as LayoutObject[]) {
      if (!o || typeof o !== 'object' || typeof o.id !== 'number' || typeof o.kind !== 'string' || !o.bounds) {
        throw invalid('Each layout object needs an id, a kind and bounds');
      }
      if (o.kind === 'button-bar' && o.activeSegment !== undefined && !o.children?.some((c) => c.id === o.activeSegment)) {
        throw invalid('A button bar\'s active segment must be one of its segments');
      }
      if (o.responsive !== undefined && (typeof o.responsive !== 'object' || !width(o.responsive?.hideBelow))) throw invalid('An object\'s responsive hideBelow is a width in points, 1 to 10000');
      if (o.children) walk(o.children);
    }
  };
  walk(d.objects ?? []);
  if (d.viewsAllowed !== undefined) {
    if (!Array.isArray(d.viewsAllowed) || !d.viewsAllowed.length || d.viewsAllowed.some((v) => !LAYOUT_VIEWS.includes(v))) throw invalid('A layout\'s views allowed are one or more of form, list and table');
    if (d.view && !d.viewsAllowed.includes(d.view)) throw invalid(`A layout that opens in ${d.view} view must allow it`);
  }
  for (const k of ['saveRecordChanges', 'recordIndicator', 'fieldFrames'] as const) {
    if (d[k] !== undefined && typeof d[k] !== 'boolean') throw invalid(`A layout's ${k} is true or false`);
  }
  if (d.responsive !== undefined && (typeof d.responsive !== 'object' || !(d.responsive?.stackBelow === 0 || width(d.responsive?.stackBelow)))) throw invalid('A layout\'s responsive stackBelow is a width in points, 1 to 10000, or 0 for never');
  if (d.printColumns !== undefined && d.printColumns !== null) {
    const c = d.printColumns;
    if (typeof c !== 'object' || !Number.isInteger(c.count) || c.count < 1 || c.count > 99) throw invalid('A layout prints in 1 to 99 columns');
    if (c.order !== undefined && c.order !== 'across' && c.order !== 'down') throw invalid('A layout\'s columns print across first or down first');
  }
  if (d.fixedMargins !== undefined && d.fixedMargins !== null) {
    const m = d.fixedMargins;
    const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10000;
    if (typeof m !== 'object' || !(['top', 'left', 'bottom', 'right'] as const).every((k) => ok(m[k]))) throw invalid('A layout\'s fixed page margins are top, left, bottom and right, each 0 to 10000 points');
    if (pageSetup && (m.top + m.bottom >= pageSetup.height || m.left + m.right >= pageSetup.width)) {
      throw invalid('A layout\'s fixed page margins must leave room on the paper');
    }
  }
}


const CHART_TYPES = new Set(['column', 'stacked-column', 'bar', 'stacked-bar', 'line', 'area', 'pie', 'scatter', 'bubble']);

/** Chart Setup: a known type and data source, and series with data formulas (charts read from files may have none). */
function checkChart(c: LayoutObject['chart']): void {
  if (!c || typeof c !== 'object') throw invalid('A chart needs its setup');
  if (!CHART_TYPES.has(c.type)) throw invalid(`"${c.type}" isn't a chart type: use ${[...CHART_TYPES].join(', ')}`);
  if (!['record', 'found-set', 'related'].includes(c.source)) throw invalid('A chart\'s data comes from the current record, the found set or related records');
  if (!Array.isArray(c.series) || c.series.some((s) => !s || typeof s.data !== 'string')) throw invalid('A chart\'s series each need a data formula');
  const color = isColor;
  if (c.background !== undefined && (!Array.isArray(c.background) || c.background.length !== 2 || !c.background.every(color))) throw invalid('A chart\'s background is two colors (top and bottom)');
  if (c.text !== undefined) {
    if (!c.text || typeof c.text !== 'object') throw invalid('A chart\'s text is a size and color per part');
    for (const [part, t] of Object.entries(c.text)) {
      if (!t || !Number.isFinite(t.size) || t.size < 0 || t.size > 200 || !color(t.color)) throw invalid(`Chart text "${part}" needs a size up to 200 and a color`);
    }
  }
}

// ---------------------------------------------------------------- themes

/** Style rules as sent: part and state numbers, CSS declarations that can't break out of the style sheet. */
function checkRules(rules: unknown, what: string): StyleRule[] {
  if (!Array.isArray(rules)) throw invalid(`${what} must be a list of rules`);
  return rules.map((r: { part?: unknown; state?: unknown; css?: unknown }) => {
    if (!r || typeof r !== 'object' || !Number.isInteger(r.part) || !Number.isInteger(r.state) || !r.css || typeof r.css !== 'object') {
      throw invalid(`${what}: each rule needs a part, a state and css`);
    }
    const css: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.css as Record<string, unknown>)) {
      if (!/^-?[a-z][a-z0-9-]*$/.test(k)) throw invalid(`${what}: "${k}" isn't a CSS property`);
      const value = String(v).trim();
      if (/[{}<>;]/.test(value)) throw invalid(`${what}: the value of ${k} can't contain { } < > or ;`);
      if (value) css[k] = value;
    }
    return { part: r.part as number, state: r.state as number, css };
  });
}

/** A theme's styles without its id and name, as Export theme writes it. */
export type ThemeContent = Pick<Theme, 'defaults' | 'styles' | 'contextual'>;

function checkThemeContent(c: unknown): ThemeContent {
  const t = c as Partial<ThemeContent> | null;
  if (!t || typeof t !== 'object' || !t.defaults || typeof t.defaults !== 'object' || !Array.isArray(t.styles)) throw invalid('A theme to import needs defaults and styles');
  const defaults: Theme['defaults'] = {};
  for (const [el, rules] of Object.entries(t.defaults)) {
    if (!/^\d+$/.test(el)) throw invalid(`"${el}" isn't an element type`);
    defaults[Number(el)] = checkRules(rules, `Element ${el}`);
  }
  const styles = t.styles.map((s: Partial<ThemeStyle>) => {
    if (!s || typeof s.name !== 'string' || !s.name.trim()) throw invalid('Each style needs a name');
    if (s.element !== undefined && !Number.isInteger(s.element)) throw invalid(`Style "${s.name}": element must be a number`);
    return { name: s.name, ...(s.element !== undefined ? { element: s.element } : {}), rules: checkRules(s.rules, `Style "${s.name}"`) };
  });
  const out: ThemeContent = { defaults, styles };
  if (t.contextual !== undefined) {
    if (!Array.isArray(t.contextual)) throw invalid('contextual must be a list');
    out.contextual = t.contextual.map((x) => {
      if (!Array.isArray(x?.path) || !x.path.every(Number.isInteger)) throw invalid('Each contextual rule needs a path of element types');
      return { path: [...x.path], rules: checkRules(x.rules, `Elements ${x.path.join(' > ')}`) };
    });
  }
  return out;
}

const themeOf = (st: DesignState, ref: Ref) => find(st.designs.themes, ref, 'Theme', 960);

function styleOf(theme: Theme, name: string, element: number | undefined): ThemeStyle {
  const hits = theme.styles.filter((x) => x.name === name || lower(x.name) === lower(name));
  const hit = element === undefined ? hits[0] : hits.find((x) => x.element === element) ?? hits.find((x) => x.element === undefined);
  if (!hit) throw new DesignError(960, `Style "${name}" is missing from theme "${theme.name}"`);
  return hit;
}

/** Every object and part style on layouts that use a theme. */
function themedStyles(st: DesignState, themeId: number, visit: (style: { name?: string; element?: number }, element: number | undefined) => void): void {
  for (const layout of st.designs.layouts) {
    if (layout.themeId !== themeId) continue;
    const walk = (objs: LayoutObject[]) => {
      for (const o of objs) {
        visit(o.style, o.style.element);
        if (o.children) walk(o.children);
      }
    };
    walk(layout.objects);
    for (const p of layout.parts) visit(p.style, p.style.element);
    visit(layout.style, layout.style.element);
  }
  // Components placed on those layouts: their copies are rebuilt from them.
  const visitAll = (objs: LayoutObject[]) => {
    for (const o of objs) {
      visit(o.style, o.style.element);
      if (o.children) visitAll(o.children);
    }
  };
  for (const c of st.designs.components ?? []) {
    // Only when every copy is on this theme: another theme's copies keep the style names that theme has.
    const on = st.designs.layouts.filter((d) => places(d, c.id));
    if (on.length && on.every((d) => d.themeId === themeId)) visitAll(c.objects);
  }
}

// ---------------------------------------------------------------- scripts

function buildSteps(specs: StepSpec[] | undefined, current: ScriptStep[] = []): ScriptStep[] {
  if (specs !== undefined && !Array.isArray(specs)) throw invalid('Script steps must be a list');
  return keepUndecodedImportMarks(current, specs ?? [], (sp) => sp.line !== undefined).map((sp, i) => {
    // A step kept unchanged from the script (its line matched) stays exactly as it was.
    if (sp.stepId !== undefined && sp.name && sp.line !== undefined && sp.calculations) {
      return { stepId: sp.stepId, name: sp.name, enabled: sp.enabled !== false, line: displayedStepLine({ ...sp, stepId: sp.stepId, name: sp.name }), calculations: sp.calculations, ...(sp.text !== undefined ? { text: sp.text } : {}), ...(sp.params ? { params: sp.params } : {}) };
    }
    const stepId = sp.stepId ?? (sp.name ? scriptStepId(sp.name) : undefined);
    if (stepId === undefined) throw invalid(`Step ${i + 1}: unknown script step "${sp.name ?? ''}"`);
    const name = scriptStepName(stepId);
    const step: ScriptStep = { stepId, name, enabled: sp.enabled !== false };
    if (sp.text !== undefined) step.text = sp.text;
    if (sp.params) step.params = sp.params;
    const calcs = sp.params ? [sp.params.calculation, sp.params.value, sp.params.parameter].filter((c): c is string => typeof c === 'string') : [];
    if (stepId === 207 && sp.calculations?.length) step.calculations = sp.calculations;
    else if (calcs.length) step.calculations = calcs;
    step.line = displayedStepLine({ ...step, line: sp.line });
    return step;
  });
}

// ---------------------------------------------------------------- fields

function buildField(st: DesignState, table: Table, spec: FieldSpec, id: number): Field {
  const name = checkName(spec.name, 'A field');
  unique(table.fields.map((f) => f.name), name, `Field ${table.name}::`);
  const kind = spec.kind ?? (spec.summary ? 'summary' : 'normal');
  if (!FIELD_KINDS.includes(kind)) throw invalid(`Field kind must be one of ${FIELD_KINDS.join(', ')}`);
  const type = spec.type ?? (kind === 'summary' ? 'number' : 'text');
  if (!fieldTypes(st).includes(type)) throw invalid(st.fileMode !== 'native' && NATIVE_FIELD_TYPES.includes(type) ? `Field type "${type}" is available only in native files` : `Field type must be one of ${fieldTypes(st).join(', ')}`);
  if (kind === 'calculation' && !spec.calculation) throw invalid(`Calculation field "${name}" needs a formula`);
  const field: Field = { id, name, kind, type, hasCalculation: spec.calculation !== undefined };
  if (spec.comment) field.comment = spec.comment;
  if (spec.calculation !== undefined) field.calculation = spec.calculation;
  if (spec.calculationContext !== undefined) field.calculationContextId = find(st.schema.tableOccurrences, spec.calculationContext, 'Table occurrence', 106).id;
  field.options = { global: false, unstored: false, repetitions: 1, ...spec.options as Partial<FieldOptions> };
  // A new table's fields come without resolveFieldOptions: name the indexing the same way, and the validation value list.
  const validation = field.options.validation as (FieldOptions['validation'] & { valueList?: Ref }) | undefined;
  if (validation && typeof validation.valueList === 'string') {
    field.options.validation = { ...validation, valueList: find(st.schema.valueLists, validation.valueList, 'Value list', 108).id } as FieldOptions['validation'];
  }
  const index = spec.options?.index;
  if (index === 'all') field.options.index = { value: true, word: true };
  else if (index === 'minimal') field.options.index = { value: true };
  const ext = spec.options?.externalStorage as ExternalStorageSpec | null | undefined;
  if (ext) field.options.externalStorage = externalStorage(st.schema, ext);
  // Only container data is stored outside the database.
  if (type !== 'container') delete field.options.externalStorage;
  for (const [k, v] of Object.entries(field.options)) if (v === null) delete (field.options as unknown as Record<string, unknown>)[k];
  if (kind === 'summary') field.summary = summaryOf(table, spec.summary);
  return field;
}

function summaryOf(table: Table, spec: FieldSpec['summary']): Field['summary'] {
  if (!spec || !SUMMARY_TYPES.includes(spec.type)) throw invalid(`A summary field needs a summary type (${SUMMARY_TYPES.join(', ')}) and a field`);
  const of = find(table.fields, spec.field, `Field ${table.name}::`, 102);
  if ((spec.running || spec.restartField !== undefined) && spec.type !== 'total' && spec.type !== 'count') throw invalid('Only total and count summaries can run');
  if (spec.restartField !== undefined && !spec.running) throw invalid('A restart field needs a running summary');
  const restart = spec.restartField !== undefined ? find(table.fields, spec.restartField, `Field ${table.name}::`, 102) : undefined;
  return { type: spec.type, fieldId: of.id, field: of.name, ...(spec.running ? { running: true } : {}),
    ...(restart ? { restartFieldId: restart.id, restartField: restart.name } : {}) };
}

/** Whether a field has a SQL column: summaries are computed, everything else is stored (globals in meta, but keep the column). */
const hasColumn = (f: Field) => f.kind !== 'summary';
const isStoredFormula = (f: Field) =>
  !f.options?.global && ((f.kind === 'calculation' && !f.options?.unstored) || (f.kind === 'normal' && !!f.options?.autoEnter?.calculation));

// ---------------------------------------------------------------- applying ops

function addLayoutToOrder(s: Schema, id: number, name: string): void {
  if (s.layoutOrder.length) s.layoutOrder.push({ id, name, kind: 'item', depth: 0 });
}

/**
 * A list's order from a tree of folders, separators and items. Every item
 * appears once; ones left out go at the end. Folders and separators keep
 * their ids, or get new ones after every id in use.
 */
function buildOrder(items: { id: number; name: string }[], current: OrderedItem[], spec: OrderSpec[], what: string, code: number): { order: OrderedItem[]; resolved: OrderSpec[] } {
  if (!Array.isArray(spec)) throw invalid('order must be a list');
  const out: OrderedItem[] = [];
  const seen = new Set<number>();
  let next = Math.max(0, ...items.map((i) => i.id), ...current.map((o) => o.id)) + 1;
  const used = new Set(current.filter((o) => o.kind !== 'item').map((o) => o.id));
  // Moving an entry keeps its "Include in menu" setting unless the entry sets it.
  const keep = (id: number, kind: OrderedItem['kind'], include?: unknown) => {
    if (include !== undefined && typeof include !== 'boolean') throw invalid('includeInMenu must be true or false');
    const hide = include === undefined ? current.some((o) => o.id === id && o.kind === kind && o.hidden) : !include;
    return hide ? { hidden: true as const } : {};
  };
  const menu = (include?: boolean) => (include === undefined ? {} : { includeInMenu: include });
  const walk = (list: OrderSpec[], depth: number): OrderSpec[] => list.map((e) => {
    if (e && typeof e === 'object' && 'item' in e) {
      const it = find(items, e.item, what, code);
      if (seen.has(it.id)) throw invalid(`${what} "${it.name}" is in the order twice`);
      seen.add(it.id);
      out.push({ id: it.id, name: it.name, kind: 'item', depth, ...keep(it.id, 'item', e.includeInMenu) });
      return { item: it.id, ...menu(e.includeInMenu) };
    }
    if (e && typeof e === 'object' && 'folder' in e) {
      const name = checkName(e.folder, 'A folder');
      const id = e.id !== undefined && used.has(e.id) ? e.id : next++;
      out.push({ id, name, kind: 'folder', depth, ...keep(id, 'folder', e.includeInMenu) });
      // Like a decoded file's order, a folder's contents are the entries after it one level deeper (no end marker).
      const children = walk(Array.isArray(e.children) ? e.children : [], depth + 1);
      return { folder: name, id, children, ...menu(e.includeInMenu) };
    }
    if (e && typeof e === 'object' && 'separator' in e) {
      const id = e.id !== undefined && used.has(e.id) ? e.id : next++;
      out.push({ id, name: '', kind: 'separator', depth });
      return { separator: true, id };
    }
    throw invalid('Each order entry is {item}, {folder, children} or {separator: true}');
  });
  const resolved = walk(spec, 0);
  for (const it of items) {
    if (seen.has(it.id)) continue;
    out.push({ id: it.id, name: it.name, kind: 'item', depth: 0, ...keep(it.id, 'item') });
    resolved.push({ item: it.id });
  }
  return { order: out, resolved };
}

/** Sets an item's "Include in menu". A file with no stored order gets one first, in the items' order. */
function setInMenu(items: { id: number; name: string }[], order: OrderedItem[], id: number, include: unknown): void {
  if (typeof include !== 'boolean') throw invalid('includeInMenu must be true or false');
  if (!order.length) order.push(...items.map((i) => ({ id: i.id, name: i.name, kind: 'item' as const, depth: 0 })));
  const entry = order.find((o) => o.kind === 'item' && o.id === id);
  if (!entry) return;
  if (include) delete entry.hidden;
  else entry.hidden = true;
}

function removeFromOrder(order: OrderedItem[], id: number): void {
  const i = order.findIndex((o) => o.kind === 'item' && o.id === id);
  if (i >= 0) order.splice(i, 1);
}

/**
 * Apply one op to the design in place. Returns the op with every name
 * resolved to an id and new ids filled in (what the log keeps), and the SQL
 * effects. Throws DesignError, leaving the state partly changed: callers
 * apply ops to a copy.
 */
export function applyOp(st: DesignState, op: DesignOp, deleted?: DeletedLookup): { op: DesignOp; effects: Effect[]; also?: DesignOp[] } {
  // Phone layouts still following their desktop layout keep following when a change rewrites them along with every
  // other layout (a rename, a component's copies, a theme's styles); only a change made to the phone layout itself is
  // an edit by hand. Worked out the same way when the log is replayed, so nothing about it is logged.
  const following = st.designs.layouts.filter((d) => d.phone && phoneFingerprint(d) === d.phone.synced).map((d) => d.id);
  const before = st.fileMode === 'native' ? nativeOffences(st.schema) : undefined;
  const result = applyOneOp(st, op, deleted);
  if (before) {
    // Only what this change made repeating or global is refused, so a field that already is one doesn't block other changes.
    for (const [key, { table, field, repeats, global }] of nativeOffences(st.schema)) {
      if (repeats && !before.get(key)?.repeats) throw invalid(`Native field ${table}::${field} cannot repeat; use an array or JSON field instead`);
      if (global && !before.get(key)?.global) throw invalid(`Native field ${table}::${field} cannot be global; use a settings table instead`);
    }
  }
  const own = (op.op === 'updateLayout' || op.op === 'createLayout') ? result.op as { layout?: unknown; id?: unknown } : undefined;
  for (const id of following) {
    if (own && (own.layout === id || own.id === id)) continue;
    const d = st.designs.layouts.find((x) => x.id === id);
    if (d?.phone) d.phone.synced = phoneFingerprint(d);
  }
  return result;
}

/** The repeating and global fields of a schema, by table and field id. */
function nativeOffences(schema: Schema): Map<string, { table: string; field: string; repeats: boolean; global: boolean }> {
  const out = new Map<string, { table: string; field: string; repeats: boolean; global: boolean }>();
  for (const table of schema.tables) for (const field of table.fields) {
    const repeats = (field.options?.repetitions ?? 1) > 1, global = !!field.options?.global;
    if (repeats || global) out.set(`${table.id}:${field.id}`, { table: table.name, field: field.name, repeats, global });
  }
  return out;
}

function applyOneOp(st: DesignState, op: DesignOp, deleted?: DeletedLookup): { op: DesignOp; effects: Effect[]; also?: DesignOp[] } {
  const s = st.schema;
  const effects: Effect[] = [];
  if (!op || typeof op !== 'object' || typeof op.op !== 'string') throw invalid('Each change needs an "op"');
  // Stores converted before menus were read have neither list.
  s.customMenus ??= [];
  s.customMenuSets ??= [];
  switch (op.op) {
    case 'createTable': {
      const name = checkName(op.name, 'A table');
      if (/^_fm_/i.test(name) || /^sqlite_/i.test(name)) throw invalid(`Table names can't start with "${name.slice(0, name.indexOf('_', 1) + 1)}"`);
      unique(s.tables.map((t) => t.name), name, 'Table');
      const id = op.id ?? nextId([...s.tables.map((t) => t.id), ...retired(s, 'tables')], 129);
      const table: Table = { id, name, fields: [] };
      s.tables.push(table);
      for (const f of op.fields ?? []) table.fields.push(buildField(st, table, f.options ? { ...f, options: resolveFieldOptions(s, table, f.options) } : f, f.id ?? nextId([...table.fields.map((x) => x.id), ...retired(s, `fields.${id}`)])));
      effects.push({ k: 'createTable', table: structuredClone(table) });
      const resolved: DesignOp = { ...op, id, fields: table.fields.map((f, i) => ({ ...(op.fields ?? [])[i], id: f.id })) };
      if (op.withLayout !== false) {
        // FileMaker adds an occurrence named after the table, and a layout for it.
        let toName = name;
        for (let n = 2; s.tableOccurrences.some((t) => lower(t.name) === lower(toName)); n++) toName = `${name} ${n}`;
        const toId = op.occurrenceId ?? nextId([...s.tableOccurrences.map((t) => t.id), ...retired(s, 'tableOccurrences')], 129);
        s.tableOccurrences.push({ id: toId, name: toName, baseTableId: id });
        let layoutName = name;
        for (let n = 2; s.layouts.some((l) => lower(l.name) === lower(layoutName)); n++) layoutName = `${name} ${n}`;
        const layoutId = op.layoutId ?? nextId(s.layouts.map((l) => l.id));
        s.layouts.push({ id: layoutId, name: layoutName, tableOccurrenceId: toId, labels: [] });
        addLayoutToOrder(s, layoutId, layoutName);
        st.designs.layouts.push(generateLayout(st, layoutId, layoutName, toId));
        Object.assign(resolved, { occurrenceId: toId, layoutId });
      }
      return { op: resolved, effects };
    }
    case 'renameTable': {
      const table = find(s.tables, op.table, 'Table', 106);
      const name = checkName(op.name, 'A table');
      if (/^_fm_/i.test(name) || /^sqlite_/i.test(name)) throw invalid(`Table names can't start with "_fm_" or "sqlite_"`);
      unique(s.tables.map((t) => t.name), name, 'Table', table.name);
      if (name !== table.name) {
        effects.push({ k: 'renameTable', from: table.name, to: name });
        rekeyAccess(st, 'table', table.name, name);
      }
      table.name = name;
      return { op: { op: 'renameTable', table: table.id, name }, effects };
    }
    case 'deleteTable': {
      const table = find(s.tables, op.table, 'Table', 106);
      const before = cloneState(st);
      // Its occurrences go too (with their relationships); layouts on them stay, without a table.
      for (const to of s.tableOccurrences.filter((t) => !t.dataSourceId && t.baseTableId === table.id)) deleteOccurrence(st, to);
      rekeyAccess(st, 'table', table.name, null);
      s.tables.splice(s.tables.indexOf(table), 1);
      effects.push({ k: 'trashTable', table: structuredClone(table), patch: deletePatch(st, before) });
      return { op: { op: 'deleteTable', table: table.id }, effects };
    }
    case 'createField': {
      const table = find(s.tables, op.table, 'Table', 106);
      const { op: _o, table: _t, ...spec } = op;
      spec.options = resolveFieldOptions(s, table, spec.options);
      // An id given (a proposal drafted earlier, or the log) must still be free.
      if (op.id !== undefined && table.fields.some((f) => f.id === op.id)) throw invalid(`${table.name} already has a field with id ${op.id}: the change was drafted before another one; draft it again`);
      const field = buildField(st, table, spec, op.id ?? nextId([...table.fields.map((f) => f.id), ...retired(s, `fields.${table.id}`)]));
      table.fields.push(field);
      // Generated layouts take the new field, and phone layouts following them are rebuilt.
      const rebuilt = addToGeneratedLayouts(st, table, field).flatMap((id) => rephone(st, id));
      if (hasColumn(field)) effects.push({ k: 'addColumn', table: table.name, field: structuredClone(field) });
      if (isStoredFormula(field)) effects.push({ k: 'recompute', table: table.name, field: field.name });
      return { op: { ...op, table: table.id, id: field.id, ...(spec.options ? { options: spec.options } : {}), ...(field.calculationContextId !== undefined ? { calculationContext: field.calculationContextId } : {}) }, effects, ...(rebuilt.length ? { also: rebuilt } : {}) };
    }
    case 'updateField': {
      const table = find(s.tables, op.table, 'Table', 106);
      const field = find(table.fields, op.field, `Field ${table.name}::`, 102);
      const before = { ...field, options: field.options && structuredClone(field.options) };
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A field');
        unique(table.fields.map((f) => f.name), name, `Field ${table.name}::`, field.name);
        if (name !== field.name) {
          propagate(st, { kind: 'field', tableId: table.id, from: field.name, to: name });
          rekeyField(st, table.name, field.name, name);
          field.name = name;
        }
      }
      if (op.kind !== undefined) {
        if (!FIELD_KINDS.includes(op.kind)) throw invalid(`Field kind must be one of ${FIELD_KINDS.join(', ')}`);
        field.kind = op.kind;
      }
      if (op.type !== undefined) {
        if (!fieldTypes(st).includes(op.type)) throw invalid(st.fileMode !== 'native' && NATIVE_FIELD_TYPES.includes(op.type) ? `Field type "${op.type}" is available only in native files` : `Field type must be one of ${fieldTypes(st).join(', ')}`);
        field.type = op.type;
      }
      if (op.comment !== undefined) {
        if (op.comment) field.comment = op.comment;
        else delete field.comment;
      }
      if (op.calculation !== undefined) {
        if (op.calculation === '' && field.kind !== 'calculation') delete field.calculation;
        else field.calculation = op.calculation;
        field.hasCalculation = field.calculation !== undefined;
      }
      if (op.calculationContext !== undefined) field.calculationContextId = find(s.tableOccurrences, op.calculationContext, 'Table occurrence', 106).id;
      const options = resolveFieldOptions(s, table, op.options ?? undefined);
      if (options !== undefined) {
        const merged = { global: false, unstored: false, repetitions: 1, ...field.options, ...options };
        for (const k of Object.keys(options) as (keyof FieldOptions)[]) if (options[k] === null) delete merged[k];
        field.options = merged;
      }
      // Only container data is stored outside the database.
      if (field.type !== 'container' && field.options?.externalStorage) delete field.options.externalStorage;
      if (field.kind === 'summary') field.summary = op.summary ? summaryOf(table, op.summary) : field.summary ?? summaryOf(table, undefined);
      else delete field.summary;
      if (field.kind === 'calculation' && !field.calculation) throw invalid(`Calculation field "${field.name}" needs a formula`);

      const name = before.name !== field.name ? field.name : before.name;
      if (hasColumn(before) && !hasColumn(field)) effects.push({ k: 'dropColumn', table: table.name, name: before.name });
      else if (!hasColumn(before) && hasColumn(field)) effects.push({ k: 'addColumn', table: table.name, field: structuredClone(field) });
      else if (before.name !== field.name && hasColumn(field)) effects.push({ k: 'renameColumn', table: table.name, from: before.name, to: field.name });
      if (hasColumn(field) && before.type !== field.type && before.kind === 'normal' && field.kind === 'normal') {
        effects.push({ k: 'retype', table: table.name, field: name, from: before.type, to: field.type });
      }
      // Indexing and validation don't change what a calculation stores, so they don't recompute it (nor does FileMaker).
      const valueOptions = (o: Field['options']) => {
        const { index: _i, noAutoIndex: _n, indexLanguage: _l, indexLanguageId: _li, validation: _v, ...rest } = (o ?? {}) as Record<string, unknown>;
        return JSON.stringify(rest);
      };
      const formulaChanged = before.calculation !== field.calculation || before.kind !== field.kind || before.type !== field.type ||
        valueOptions(before.options) !== valueOptions(field.options) || before.calculationContextId !== field.calculationContextId;
      // A changed stored calculation is recomputed for every record (FileMaker does this when you close Manage Database).
      if (formulaChanged && isStoredFormula(field) && field.kind === 'calculation') effects.push({ k: 'recompute', table: table.name, field: field.name });
      const resolved: DesignOp = { ...op, table: table.id, field: field.id, ...(options !== undefined ? { options } : {}) };
      if (op.calculationContext !== undefined) (resolved as { calculationContext?: Ref }).calculationContext = field.calculationContextId;
      return { op: resolved, effects };
    }
    case 'deleteField': {
      const table = find(s.tables, op.table, 'Table', 106);
      const field = find(table.fields, op.field, `Field ${table.name}::`, 102);
      const before = cloneState(st);
      propagate(st, { kind: 'field', tableId: table.id, from: field.name, to: null });
      rekeyField(st, table.name, field.name, null);
      table.fields.splice(table.fields.indexOf(field), 1);
      for (const rel of s.relationships) {
        rel.predicates = rel.predicates.filter((p) =>
          !((p.leftFieldId === field.id && occurrenceOnTable(s, rel.leftTableOccurrenceId, table.id)) ||
            (p.rightFieldId === field.id && occurrenceOnTable(s, rel.rightTableOccurrenceId, table.id))));
      }
      effects.push({ k: 'trashField', table: table.name, field: structuredClone(field), data: hasColumn(field), patch: deletePatch(st, before) });
      return { op: { op: 'deleteField', table: table.id, field: field.id }, effects };
    }
    case 'restoreDeleted': {
      const recorded = deleted?.(op.deleted);
      if (!recorded) throw new DesignError(101, `Nothing deleted has id ${op.deleted}; it may have been emptied`);
      const patch = recorded.patch;
      const entry = 'kind' in recorded ? recorded : undefined;
      const root = st as unknown;
      const retype = entry?.kind === 'field' && !patch.removed.length ? patch.leaves.find((x) => x.path.at(-1) === 'type') : undefined;
      if (retype && atPath(root, retype.path) !== retype.after) throw invalid(`Field "${entry!.name}" has changed type since its values were kept`);
      for (const r of patch.removed) {
        const key = retiredKey(r.path);
        if (!key) continue;
        const list = atPath(root, r.path);
        const what = key === 'tables' ? 'table' : key === 'tableOccurrences' ? 'table occurrence' : key === 'relationships' ? 'relationship' : key === 'scripts' ? 'script' : key === 'valueLists' ? 'value list' : 'field';
        if (!Array.isArray(list)) throw invalid(`Restore the table "${entry?.table ?? ''}" first`);
        if (list.some((x: { id: number }) => x.id === r.value.id)) throw invalid(`Another ${what} has id ${r.value.id} now, so "${r.value.name ?? r.value.id}" can't be restored`);
        const name = r.value.name;
        // Occurrences restored next to a newer one of the same name get a number, as FileMaker names copies.
        if (typeof name === 'string' && list.some((x: { name?: string }) => typeof x.name === 'string' && lower(x.name) === lower(name))) {
          if (key !== 'tableOccurrences') throw invalid(`A ${what} named "${name}" exists now: rename it, then restore`);
        }
      }
      undoPatch(root, patch);
      for (const r of patch.removed) {
        const key = retiredKey(r.path);
        const ids = key ? s.retiredIds?.[key] : undefined;
        if (ids?.includes(r.value.id)) ids.splice(ids.indexOf(r.value.id), 1);
      }
      if (entry) {
        if (entry.kind === 'field' && !patch.removed.length && patch.leaves.some((x) => x.path.at(-1) === 'type')) {
          const path = patch.leaves.find((x) => x.path.at(-1) === 'type')!.path;
          const table = s.tables.find((t) => t.id === (path[2] as { id: number }).id);
          const field = table?.fields.find((f) => f.id === (path[4] as { id: number }).id);
          if (!table || !field) throw invalid(`Restore the field "${entry.name}" before its previous values`);
          effects.push({ k: 'restoreRetype', deleted: entry.id, table: table.name, field: field.name, type: field.type });
        }
        const top = patch.removed.find((r) => (entry.kind === 'table' ? retiredKey(r.path) === 'tables' : retiredKey(r.path)?.startsWith('fields.')));
        const tableId = entry.kind === 'table' ? top?.value.id : (top?.path[2] as { id: number } | undefined)?.id;
        const table = s.tables.find((t) => t.id === tableId);
        if (table && entry.kind === 'table') effects.push({ k: 'restoreTable', deleted: entry.id, table: structuredClone(table) });
        const field = entry.kind === 'field' ? table?.fields.find((f) => f.id === top?.value.id) : undefined;
        if (table && field) {
          effects.push({ k: 'restoreField', deleted: entry.id, table: table.name, field: structuredClone(field) });
          // Values may have gone stale while it was deleted.
          if (isStoredFormula(field)) effects.push({ k: 'recompute', table: table.name, field: field.name });
        }
      }
      return { op: { op: 'restoreDeleted', deleted: op.deleted, patch }, effects };
    }
    case 'createOccurrence': {
      const name = checkName(op.name, 'A table occurrence');
      unique(s.tableOccurrences.map((t) => t.name), name, 'Table occurrence');
      const id = op.id ?? nextId([...s.tableOccurrences.map((t) => t.id), ...retired(s, 'tableOccurrences')], 129);
      const to: TableOccurrence = { id, name, baseTableId: 0 };
      let resolved: DesignOp;
      if (op.file !== undefined) {
        // A table in another hosted file: the design layer can't read that file,
        // so the table (and its match fields, for a relationship) are given by id.
        const ds = find(s.dataSources, op.file, 'Data source', 106);
        if (typeof op.externalTable !== 'number') throw invalid('A table occurrence in another file needs externalTable, the table\'s id in that file');
        to.dataSourceId = ds.id;
        to.baseTableId = op.externalTable;
        resolved = { ...op, id, file: ds.id };
      } else {
        const table = find(s.tables, op.table, 'Table', 106);
        to.baseTableId = table.id;
        resolved = { ...op, id, table: table.id };
      }
      if (op.color) to.color = occurrenceColor(op.color);
      if (op.graph) to.graph = op.graph;
      s.tableOccurrences.push(to);
      return { op: resolved, effects };
    }
    case 'updateOccurrence': {
      const to = find(s.tableOccurrences, op.occurrence, 'Table occurrence', 106);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A table occurrence');
        unique(s.tableOccurrences.map((t) => t.name), name, 'Table occurrence', to.name);
        if (name !== to.name) {
          propagate(st, { kind: 'occurrence', from: to.name, to: name });
          to.name = name;
        }
      }
      const resolved: DesignOp = { ...op, occurrence: to.id };
      if (op.table !== undefined) {
        const table = find(s.tables, op.table, 'Table', 106);
        to.baseTableId = table.id;
        delete to.dataSourceId;
        (resolved as { table?: Ref }).table = table.id;
      }
      if (op.color !== undefined) to.color = op.color === '' ? '' : occurrenceColor(op.color);
      if (op.graph !== undefined) to.graph = op.graph;
      return { op: resolved, effects };
    }
    case 'deleteOccurrence': {
      const to = find(s.tableOccurrences, op.occurrence, 'Table occurrence', 106);
      deleteOccurrence(st, to);
      return { op: { op: 'deleteOccurrence', occurrence: to.id }, effects };
    }
    case 'createRelationship':
    case 'updateRelationship': {
      const existing = op.op === 'updateRelationship' ? s.relationships.find((r) => r.id === op.relationship) : undefined;
      if (op.op === 'updateRelationship' && !existing) throw new DesignError(103, `Relationship ${op.relationship} is missing`);
      const left = op.left !== undefined ? find(s.tableOccurrences, op.left, 'Table occurrence', 106) : s.tableOccurrences.find((t) => t.id === existing!.leftTableOccurrenceId)!;
      const right = op.right !== undefined ? find(s.tableOccurrences, op.right, 'Table occurrence', 106) : s.tableOccurrences.find((t) => t.id === existing!.rightTableOccurrenceId)!;
      if (!left || !right) throw invalid('A relationship needs a table occurrence on each side');
      if (left.id === right.id) throw invalid('A relationship joins two different table occurrences');
      const lt = localTable(s, left);
      const rt = localTable(s, right);
      const specs = op.predicates ?? undefined;
      if (op.op === 'createRelationship' && (!Array.isArray(specs) || !specs.length)) throw invalid('A relationship needs at least one pair of match fields');
      // A match field in another file is given by id (the design layer can't read that file to resolve a name).
      const matchField = (side: Table | undefined, ref: Ref, occName: string): { id: number; name?: string } => {
        if (side) return find(side.fields, ref, `Field ${occName}::`, 102);
        if (typeof ref !== 'number') throw invalid(`Field ${occName}:: is in another file, so its match field must be given by id`);
        return { id: ref };
      };
      const predicates = specs?.map((p) => {
        const operator = p.operator ?? '=';
        if (!OPERATORS.includes(operator)) throw invalid(`Relationship operators are ${OPERATORS.join(' ')}`);
        const lf = matchField(lt, p.left, left.name);
        const rf = matchField(rt, p.right, right.name);
        return { leftFieldId: lf.id, operator, rightFieldId: rf.id, ...(lf.name ? { leftField: lf.name } : {}), ...(rf.name ? { rightField: rf.name } : {}) };
      });
      const options: RelationshipOptions = {};
      for (const k of REL_OPTIONS) {
        const v = (op as RelationshipOptions)[k];
        if (v !== undefined && typeof v !== 'boolean') throw invalid(`${k} is true or false`);
        if (v !== undefined) options[k] = v;
      }
      const setOptions = (rel: Relationship) => {
        for (const k of REL_OPTIONS) {
          if (options[k] === undefined) continue;
          if (options[k]) rel[k] = true;
          else delete rel[k];
        }
      };
      if (existing) {
        setOptions(existing);
        existing.leftTableOccurrenceId = left.id;
        existing.leftTableOccurrence = left.name;
        existing.rightTableOccurrenceId = right.id;
        existing.rightTableOccurrence = right.name;
        if (predicates) existing.predicates = predicates;
        return { op: { op: 'updateRelationship', relationship: existing.id, left: left.id, right: right.id, ...(predicates ? { predicates: predicates.map((p) => ({ left: p.leftFieldId, operator: p.operator, right: p.rightFieldId })) } : {}), ...options }, effects };
      }
      const id = (op as { id?: number }).id ?? nextId([...s.relationships.map((r) => r.id), ...retired(s, 'relationships')]);
      // Relationships made here allow creating records on both sides unless told otherwise (FileMaker starts with it off).
      if (options.leftCreate === undefined) options.leftCreate = true;
      if (options.rightCreate === undefined) options.rightCreate = true;
      const rel: Relationship = { id, leftTableOccurrenceId: left.id, rightTableOccurrenceId: right.id, leftTableOccurrence: left.name, rightTableOccurrence: right.name, predicates: predicates!, sorted: false };
      setOptions(rel);
      s.relationships.push(rel);
      return { op: { op: 'createRelationship', id, left: left.id, right: right.id, predicates: predicates!.map((p) => ({ left: p.leftFieldId, operator: p.operator, right: p.rightFieldId })), ...options }, effects };
    }
    case 'deleteRelationship': {
      const i = s.relationships.findIndex((r) => r.id === op.relationship);
      if (i < 0) throw new DesignError(103, `Relationship ${op.relationship} is missing`);
      s.relationships.splice(i, 1);
      return { op, effects };
    }
    case 'createValueList': {
      const name = checkName(op.name, 'A value list');
      unique(s.valueLists.map((v) => v.name), name, 'Value list');
      const id = op.id ?? nextId(s.valueLists.map((v) => v.id));
      if (op.external !== undefined) {
        if (op.field !== undefined || op.values !== undefined) throw invalid('A value list from another file has no values or field of its own');
        const ds = find(s.dataSources, op.external?.file as Ref, 'Data source', 106);
        if (typeof op.external.valueList !== 'number') throw invalid('A value list from another file needs the list\'s id in that file');
        if (ds.paths[0]?.startsWith('odbc:')) throw invalid(`${ds.name} is an ODBC source, which has no value lists`);
        const other = st.externalFile?.(ds);
        if (!other) throw invalid(`${ds.name} is not hosted here or this account can't design it, so its value lists can't be read`);
        if (!other.valueLists.some((v) => v.id === op.external!.valueList)) throw invalid(`${ds.name} has no value list ${op.external.valueList}`);
        s.valueLists.push({ id, name, external: { dataSourceId: ds.id, valueListId: op.external.valueList } });
        return { op: { op: 'createValueList', id, name, external: { file: ds.id, valueList: op.external.valueList } }, effects };
      }
      if (op.field !== undefined) {
        const field = valueListField(st, op.field);
        s.valueLists.push({ id, name, field });
        return { op: { op: 'createValueList', id, name, field: fieldSpec(field) }, effects };
      }
      if (!Array.isArray(op.values)) throw invalid('A value list needs a list of values or a field');
      s.valueLists.push({ id, name, values: op.values.map(String) });
      return { op: { ...op, id }, effects };
    }
    case 'updateValueList': {
      const vl = find(s.valueLists, op.valueList, 'Value list', 960);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A value list');
        unique(s.valueLists.map((v) => v.name), name, 'Value list', vl.name);
        if (name !== vl.name) rekeyAccess(st, 'valueList', vl.name, name);
        vl.name = name;
      }
      if (op.values !== undefined && op.field !== undefined) throw invalid('A value list has either values or a field, not both');
      if (op.values !== undefined) {
        if (!Array.isArray(op.values)) throw invalid('A value list needs a list of values');
        vl.values = op.values.map(String);
        delete vl.field;
      }
      if (op.field !== undefined) {
        vl.field = valueListField(st, op.field);
        delete vl.values;
        return { op: { ...op, valueList: vl.id, field: fieldSpec(vl.field) }, effects };
      }
      return { op: { ...op, valueList: vl.id }, effects };
    }
    case 'deleteValueList': {
      const vl = find(s.valueLists, op.valueList, 'Value list', 960);
      rekeyAccess(st, 'valueList', vl.name, null);
      s.valueLists.splice(s.valueLists.indexOf(vl), 1);
      return { op: { op: 'deleteValueList', valueList: vl.id }, effects };
    }
    case 'createExtendedPrivilege': {
      const name = checkName(op.name, 'An extended privilege');
      unique([...s.extendedPrivileges.map((e) => e.name), ...BUILT_IN_EXTENDED_PRIVILEGES], name, 'Extended privilege');
      const id = op.id ?? nextId(s.extendedPrivileges.map((e) => e.id));
      s.extendedPrivileges.push({ id, name });
      return { op: { op: 'createExtendedPrivilege', id, name }, effects };
    }
    case 'updateExtendedPrivilege': {
      const ext = find(s.extendedPrivileges, op.extendedPrivilege, 'Extended privilege', 960);
      checkNotBuiltIn(ext.name);
      const name = checkName(op.name, 'An extended privilege');
      unique([...s.extendedPrivileges.map((e) => e.name), ...BUILT_IN_EXTENDED_PRIVILEGES], name, 'Extended privilege', ext.name);
      if (name !== ext.name) rekeyExtendedPrivilege(st, ext.name, name);
      ext.name = name;
      return { op: { op: 'updateExtendedPrivilege', extendedPrivilege: ext.id, name: ext.name }, effects };
    }
    case 'deleteExtendedPrivilege': {
      const ext = find(s.extendedPrivileges, op.extendedPrivilege, 'Extended privilege', 960);
      checkNotBuiltIn(ext.name);
      rekeyExtendedPrivilege(st, ext.name, null);
      s.extendedPrivileges.splice(s.extendedPrivileges.indexOf(ext), 1);
      return { op: { op: 'deleteExtendedPrivilege', extendedPrivilege: ext.id }, effects };
    }
    case 'createCustomFunction': {
      const name = checkName(op.name, 'A custom function');
      if (!/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name)) throw invalid('Custom function names are one word');
      // Keep built-in name collisions (also on rename) for existing/imported files. Claris documents
      // that newer built-ins override older custom functions; evaluation and AI analysis share that order.
      // https://help.claris.com/en/pro-help/content/using-custom-functions.html
      unique(s.customFunctions.map((c) => c.name), name, 'Custom function');
      const id = op.id ?? nextId(s.customFunctions.map((c) => c.id));
      const cf: CustomFunction = { id, name, parameters: (op.parameters ?? []).map(String), formula: String(op.formula ?? '') };
      if (languageOf(op.language) === 'javascript') cf.language = 'javascript';
      checkJavaScriptFunction(cf);
      s.customFunctions.push(cf);
      return { op: { ...op, id }, effects };
    }
    case 'updateCustomFunction': {
      const cf = find(s.customFunctions, op.customFunction, 'Custom function', 960);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A custom function');
        unique(s.customFunctions.map((c) => c.name), name, 'Custom function', cf.name);
        cf.name = name;
      }
      if (op.parameters !== undefined) cf.parameters = op.parameters.map(String);
      if (op.formula !== undefined) cf.formula = String(op.formula);
      if (op.language !== undefined) {
        const to = languageOf(op.language);
        // A body written in one language is never right in the other: a change of language brings its new body.
        if (to !== (cf.language ?? 'calculation') && op.formula === undefined) {
          throw invalid(`${cf.name}: changing a function to ${to === 'javascript' ? 'JavaScript' : 'a calculation'} needs its new formula too`);
        }
        if (to === 'javascript') cf.language = 'javascript';
        else delete cf.language;
      }
      checkJavaScriptFunction(cf);
      return { op: { ...op, customFunction: cf.id }, effects };
    }
    case 'deleteCustomFunction': {
      const cf = find(s.customFunctions, op.customFunction, 'Custom function', 960);
      s.customFunctions.splice(s.customFunctions.indexOf(cf), 1);
      return { op: { op: 'deleteCustomFunction', customFunction: cf.id }, effects };
    }
    case 'createDataSource': {
      const name = checkName(op.name, 'A data source');
      unique(s.dataSources.map((d) => d.name), name, 'Data source');
      const id = op.id ?? nextId([...s.dataSources.map((d) => d.id), ...retired(s, 'dataSources')]);
      const paths = dataSourcePaths(op.paths);
      s.dataSources.push({ id, name, paths });
      return { op: { ...op, id, paths }, effects };
    }
    case 'updateDataSource': {
      const ds = find(s.dataSources, op.dataSource, 'Data source', 960);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A data source');
        unique(s.dataSources.map((d) => d.name), name, 'Data source', ds.name);
        if (name !== ds.name) renameDataSource(s, ds.id, ds.name, name);
        ds.name = name;
      }
      const paths = op.paths === undefined ? undefined : dataSourcePaths(op.paths);
      if (paths) {
        // Tables come from a FileMaker file: an entry in use stays one.
        if (paths[0].startsWith('odbc:') && !ds.paths[0]?.startsWith('odbc:') && s.tableOccurrences.some((t) => t.dataSourceId === ds.id)) {
          throw invalid(`Table occurrences use "${ds.name}" as a FileMaker file: it can't become an ODBC source`);
        }
        ds.paths = paths;
      }
      return { op: { ...op, dataSource: ds.id, ...(paths ? { paths } : {}) }, effects };
    }
    case 'deleteDataSource': {
      const ds = find(s.dataSources, op.dataSource, 'Data source', 960);
      const tos = s.tableOccurrences.filter((t) => t.dataSourceId === ds.id).map((t) => t.name);
      const steps = s.scripts.filter((sc) => sc.steps.some((x) => x.params?.dataSource?.id === ds.id || x.params?.script?.file?.id === ds.id)).map((sc) => sc.name);
      if (tos.length || steps.length) {
        throw invalid(`"${ds.name}" is in use: ${[...tos.map((t) => `table occurrence ${t}`), ...steps.map((n) => `script ${n}`)].slice(0, 6).join(', ')}${tos.length + steps.length > 6 ? ', ...' : ''}`);
      }
      s.dataSources.splice(s.dataSources.indexOf(ds), 1);
      return { op: { op: 'deleteDataSource', dataSource: ds.id }, effects };
    }
    case 'createContainerDirectory': {
      const dirs = (s.containerDirectories ??= []);
      const path = containerPath(op.path);
      if (dirs.some((d) => lower(d.path) === lower(path))) throw invalid(`There is already a base directory ${path}`);
      const id = op.id ?? Math.max(0, ...dirs.map((d) => d.id)) + 1;
      if (dirs.some((d) => d.id === id)) throw invalid(`Base directory ${id} already exists`);
      dirs.push({ id, path });
      dirs.sort((a, b) => a.id - b.id);
      return { op: { op: 'createContainerDirectory', id, path }, effects };
    }
    case 'updateContainerDirectory': {
      const path = containerPath(op.path);
      let dir = s.containerDirectories?.find((d) => d.id === op.directory);
      // The default (0) is there even when the file never changed it.
      if (!dir && op.directory === 0) (s.containerDirectories ??= []).unshift(dir = { id: 0, path });
      if (!dir) throw new DesignError(960, `Base directory ${op.directory} is missing`);
      if (s.containerDirectories!.some((d) => d !== dir && lower(d.path) === lower(path))) throw invalid(`There is already a base directory ${path}`);
      dir.path = path;
      return { op: { op: 'updateContainerDirectory', directory: dir.id, path }, effects };
    }
    case 'deleteContainerDirectory': {
      const dir = s.containerDirectories?.find((d) => d.id === op.directory);
      if (!dir) throw new DesignError(960, `Base directory ${op.directory} is missing`);
      if (dir.id === 0) throw invalid('The default base directory can\'t be deleted');
      const users = s.tables.flatMap((t) => t.fields.filter((f) => f.options?.externalStorage?.directoryId === dir.id).map((f) => `${t.name}::${f.name}`));
      if (users.length) throw invalid(`${dir.path} is in use: ${users.slice(0, 6).join(', ')}${users.length > 6 ? ', ...' : ''}`);
      s.containerDirectories!.splice(s.containerDirectories!.indexOf(dir), 1);
      return { op: { op: 'deleteContainerDirectory', directory: dir.id }, effects };
    }
    case 'createLayout': {
      const name = checkName(op.name, 'A layout');
      unique(s.layouts.map((l) => l.name), name, 'Layout');
      if (op.phoneOf !== undefined) {
        // Made as the full design it starts with, so the log replays it exactly.
        const desktop = find(s.layouts, op.phoneOf, 'Layout', 105);
        const from = st.designs.layouts.find((d) => d.id === desktop.id);
        if (!from || desktop.tableOccurrenceId === undefined) throw invalid(`Layout "${desktop.name}" has no design to make a phone layout from`);
        const design = phoneOf(st, from, typeof op.width === 'number' ? op.width : PHONE_WIDTH);
        const { phoneOf: _p, width: _w, ...rest } = op;
        return applyOp(st, { ...rest, occurrence: desktop.tableOccurrenceId, design: { ...from, ...design, id: undefined, name: undefined, tableOccurrenceId: undefined, responsive: { stackBelow: 0 } } as Partial<LayoutDesign> }, deleted);
      }
      if (op.occurrence === undefined) throw invalid('A layout needs an occurrence');
      const to = find(s.tableOccurrences, op.occurrence, 'Table occurrence', 106);
      const id = op.id ?? nextId(s.layouts.map((l) => l.id));
      s.layouts.push({ id, name, tableOccurrenceId: to.id, labels: [] });
      addLayoutToOrder(s, id, name);
      // A design with no objects (just {"view": "list"}) gets the objects generated for that view.
      const generated = generateLayout(st, id, name, to.id, op.design?.objects ? 'form' : op.design?.view);
      if (op.design) checkDesign(op.design, s.pageSetup);
      const made: Design = { ...generated, ...op.design, id, name, tableOccurrenceId: to.id };
      // Only a layout made from nothing is design mode's own, to keep adding new fields to; one made from a design is not.
      if (op.design?.objects) delete made.generated;
      tidySetup(made);
      const synced = syncPlaced(made, st.designs.components ?? []);
      st.designs.layouts.push(made);
      return { op: { ...op, id, occurrence: to.id, ...(synced && op.design ? { design: { ...op.design, objects: made.objects } } : {}) }, effects };
    }
    case 'updateLayout': {
      const layout = find(s.layouts, op.layout, 'Layout', 105);
      let design = st.designs.layouts.find((d) => d.id === layout.id);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A layout');
        unique(s.layouts.map((l) => l.name), name, 'Layout', layout.name);
        if (name !== layout.name) {
          renameItem(st, 'layout', layout.id, layout.name, name);
          rekeyAccess(st, 'layout', layout.name, name);
        }
        layout.name = name;
      }
      const resolved: DesignOp = { ...op, layout: layout.id };
      if (op.occurrence !== undefined) {
        const to = find(s.tableOccurrences, op.occurrence, 'Table occurrence', 106);
        layout.tableOccurrenceId = to.id;
        if (design) design.tableOccurrenceId = to.id;
        (resolved as { occurrence?: Ref }).occurrence = to.id;
      }
      if (op.rebuildPhone) {
        const desktop = design?.phone && st.designs.layouts.find((d) => d.id === design!.phone!.of);
        if (!design?.phone) throw invalid(`Layout "${layout.name}" isn't a phone layout made from another`);
        if (!desktop) throw invalid(`The layout "${layout.name}" was made from no longer exists`);
        const { rebuildPhone: _r, ...rest } = op;
        return applyOp(st, { ...rest, design: phoneOf(st, desktop, design.phone.width) }, deleted);
      }
      if (op.design) {
        checkDesign(op.design, s.pageSetup);
        buttonSteps(s, op.design);
        const menuSet = op.design.menuSetId;
        if (menuSet && menuSet !== 1 && !s.customMenuSets?.some((m) => m.id === menuSet)) throw new DesignError(960, `No menu set with id ${menuSet}`);
        const base = design ?? generateLayout(st, layout.id, layout.name, layout.tableOccurrenceId!);
        const next: Design = { ...base, ...op.design, id: layout.id, name: layout.name, tableOccurrenceId: layout.tableOccurrenceId };
        delete next.generated;
        // null takes a setting away (undo of a change that gave a layout a theme it didn't have, say).
        for (const [k, v] of Object.entries(op.design)) if (v === null) delete (next as unknown as Record<string, unknown>)[k];
        if (!next.menuSetId) delete next.menuSetId; // 0: [File Default]
        tidySetup(next);
        // Placed copies of components follow their component, whatever the change sent for their children.
        if (syncPlaced(next, st.designs.components ?? []) && op.design.objects) (resolved as { design?: Partial<LayoutDesign> }).design = { ...op.design, objects: next.objects };
        if (design) st.designs.layouts[st.designs.layouts.indexOf(design)] = next;
        else st.designs.layouts.push(next);
        design = next;
      }
      if (design) design.name = layout.name;
      if (op.includeInMenu !== undefined) setInMenu(s.layouts, s.layoutOrder, layout.id, op.includeInMenu);
      // Phone layouts made from this one follow it, unless edited by hand since.
      return { op: resolved, effects, ...(op.design ? { also: rephone(st, layout.id) } : {}) };
    }
    case 'deleteLayout': {
      const layout = find(s.layouts, op.layout, 'Layout', 105);
      rekeyAccess(st, 'layout', layout.name, null);
      s.layouts.splice(s.layouts.indexOf(layout), 1);
      removeFromOrder(s.layoutOrder, layout.id);
      st.designs.layouts = st.designs.layouts.filter((d) => d.id !== layout.id);
      return { op: { op: 'deleteLayout', layout: layout.id }, effects };
    }
    case 'createComponent': {
      const components = (st.designs.components ??= []);
      const name = checkName(op.name, 'A component');
      unique(components.map((c) => c.name), name, 'Component');
      const id = op.id ?? nextId(components.map((c) => c.id));
      if (op.layout === undefined) {
        if (!Array.isArray(op.objects) || !op.objects.length) throw invalid('A component needs objects: give them, or a layout and the ids of objects on it');
        checkComponentObjects(s, op.objects);
        const made = componentFrom(id, name, op.objects);
        const library = libraryLink(op.library);
        if (library) made.library = library;
        components.push(made);
        return { op: { op: 'createComponent', id, name, objects: made.objects, ...(library ? { library } : {}) }, effects };
      }
      // Objects on a layout: they become the component, and its first placed copy takes their place.
      const layout = find(s.layouts, op.layout, 'Layout', 105);
      const design = st.designs.layouts.find((d) => d.id === layout.id);
      const wanted = new Set(op.objectIds ?? []);
      const chosen = design?.objects.filter((o) => wanted.has(o.id)) ?? [];
      if (!design || !wanted.size || chosen.length !== wanted.size) throw invalid('Give the ids of objects on the layout, not inside groups or portals, to make the component from');
      if (hasPlacedCopy(chosen)) throw invalid('A placed component can\'t go inside another component');
      const made = componentFrom(id, name, chosen);
      components.push(made);
      const taken = new Set(objectIds(design.objects));
      const groupId = Math.max(0, ...taken) + 1;
      taken.add(groupId);
      const box = { top: Math.min(...chosen.map((o) => o.bounds.top)), left: Math.min(...chosen.map((o) => o.bounds.left)) };
      // Its children keep the chosen objects' ids, so versions show them moving into the copy.
      for (const o of objectIds(chosen)) taken.delete(o);
      const copy = placed({
        id: groupId, kind: 'group', type: 8, bounds: { ...box, bottom: box.top, right: box.left },
        anchors: { left: true, top: true, right: false, bottom: false }, style: {} as LayoutObject['style'], children: chosen,
      }, made, taken);
      const at = design.objects.findIndex((o) => wanted.has(o.id));
      design.objects = design.objects.filter((o) => !wanted.has(o.id));
      design.objects.splice(at, 0, copy);
      delete (design as Design).generated; // as the logged updateLayout does when replayed
      return {
        op: { op: 'createComponent', id, name, objects: made.objects }, effects,
        also: [{ op: 'updateLayout', layout: layout.id, design: { objects: design.objects } }],
      };
    }
    case 'updateComponent': {
      const components = st.designs.components ?? [];
      const component = find(components, op.component, 'Component', 960);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A component');
        unique(components.map((c) => c.name), name, 'Component', component.name);
        component.name = name;
      }
      if (op.objects !== undefined) {
        if (!Array.isArray(op.objects) || !op.objects.length) throw invalid('A component needs at least one object');
        checkComponentObjects(s, op.objects);
        Object.assign(component, componentFrom(component.id, component.name, op.objects));
      }
      if (op.library === null) delete component.library;
      else if (op.library !== undefined) component.library = libraryLink(op.library);
      return {
        op: { op: 'updateComponent', component: component.id, ...(op.name !== undefined ? { name: component.name } : {}), ...(op.objects !== undefined ? { objects: component.objects } : {}), ...(op.library !== undefined ? { library: op.library === null ? null : component.library } : {}) },
        effects, also: resync(st, component.id),
      };
    }
    case 'deleteComponent': {
      const components = st.designs.components ?? [];
      const component = find(components, op.component, 'Component', 960);
      components.splice(components.indexOf(component), 1);
      return { op: { op: 'deleteComponent', component: component.id }, effects, also: resync(st, component.id) };
    }
    case 'createScript': {
      const name = checkName(op.name, 'A script');
      unique(s.scripts.map((x) => x.name), name, 'Script');
      const id = op.id ?? nextId(s.scripts.map((x) => x.id));
      const steps = buildSteps(op.text !== undefined ? parseScriptText(op.text, s) : op.steps);
      s.scripts.push({ id, name, steps });
      if (s.scriptOrder.length) s.scriptOrder.push({ id, name, kind: 'item', depth: 0 });
      const { text: _t, ...rest } = op;
      return { op: { ...rest, id, steps }, effects };
    }
    case 'updateScript': {
      const script = find(s.scripts, op.script, 'Script', 104);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A script');
        unique(s.scripts.map((x) => x.name), name, 'Script', script.name);
        if (name !== script.name) {
          renameItem(st, 'script', script.id, script.name, name);
          rekeyAccess(st, 'script', script.name, name);
        }
        script.name = name;
      }
      if (op.text !== undefined) script.steps = buildSteps(parseScriptText(op.text, s, script.steps));
      else if (op.steps !== undefined) script.steps = buildSteps(op.steps, script.steps);
      if (op.includeInMenu !== undefined) setInMenu(s.scripts, s.scriptOrder, script.id, op.includeInMenu);
      if (op.limits !== undefined) {
        const limits = scriptLimits(op.limits);
        if (limits) script.limits = limits;
        else delete script.limits;
      }
      const { text: _t, ...rest } = op;
      // The log keeps the steps, so replaying doesn't depend on reading the text again.
      return { op: { ...rest, script: script.id, ...(op.text !== undefined || op.steps !== undefined ? { steps: script.steps } : {}) }, effects };
    }
    case 'deleteScript': {
      const script = find(s.scripts, op.script, 'Script', 104);
      rekeyAccess(st, 'script', script.name, null);
      s.scripts.splice(s.scripts.indexOf(script), 1);
      removeFromOrder(s.scriptOrder, script.id);
      return { op: { op: 'deleteScript', script: script.id }, effects };
    }
    case 'createCustomMenu': {
      const name = checkName(op.name, 'A custom menu');
      unique(s.customMenus.map((m) => m.name), name, 'Custom menu');
      const id = op.id ?? nextId(s.customMenus.map((m) => m.id));
      const menu: CustomMenu = { id, name, items: [] };
      if (op.basedOn !== undefined) menu.basedOn = Number(op.basedOn);
      if (optionalText(op.comment)) menu.comment = String(op.comment);
      if (optionalText(op.installWhen)) menu.installWhen = String(op.installWhen);
      s.customMenus.push(menu);
      menu.items = menuItems(s, op.items, id);
      return { op: { ...op, id, items: itemSpecs(menu.items) }, effects };
    }
    case 'updateCustomMenu': {
      const menu = find(s.customMenus, op.customMenu, 'Custom menu', 960);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A custom menu');
        unique(s.customMenus.map((m) => m.name), name, 'Custom menu', menu.name);
        menu.name = name;
        for (const m of s.customMenus) for (const i of m.items) if (i.submenuId === menu.id) i.submenu = name;
      }
      if (op.comment !== undefined) { if (optionalText(op.comment)) menu.comment = String(op.comment); else delete menu.comment; }
      if (op.installWhen !== undefined) { if (optionalText(op.installWhen)) menu.installWhen = String(op.installWhen); else delete menu.installWhen; }
      if (op.items !== undefined) menu.items = menuItems(s, op.items, menu.id);
      return { op: { ...op, customMenu: menu.id, ...(op.items !== undefined ? { items: itemSpecs(menu.items) } : {}) }, effects };
    }
    case 'deleteCustomMenu': {
      const menu = find(s.customMenus, op.customMenu, 'Custom menu', 960);
      s.customMenus.splice(s.customMenus.indexOf(menu), 1);
      // Submenu items that showed it and its place in menu sets go too.
      for (const m of s.customMenus) m.items = m.items.filter((i) => i.submenuId !== menu.id);
      for (const set of s.customMenuSets) set.menuIds = set.menuIds.filter((id) => id !== menu.id);
      return { op: { op: 'deleteCustomMenu', customMenu: menu.id }, effects };
    }
    case 'createMenuSet': {
      const name = checkName(op.name, 'A menu set');
      unique(s.customMenuSets.map((m) => m.name), name, 'Menu set');
      // Id 1 is FileMaker's standard menus.
      const id = op.id ?? nextId(s.customMenuSets.map((m) => m.id), 2);
      const set = { id, name, menuIds: menuIds(s, op.menus), ...(optionalText(op.comment) ? { comment: String(op.comment) } : {}) };
      s.customMenuSets.push(set);
      return { op: { ...op, id, menus: set.menuIds }, effects };
    }
    case 'updateMenuSet': {
      const set = find(s.customMenuSets, op.menuSet, 'Menu set', 960);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A menu set');
        unique(s.customMenuSets.map((m) => m.name), name, 'Menu set', set.name);
        set.name = name;
      }
      if (op.comment !== undefined) { if (optionalText(op.comment)) set.comment = String(op.comment); else delete set.comment; }
      if (op.menus !== undefined) set.menuIds = menuIds(s, op.menus);
      return { op: { ...op, menuSet: set.id, ...(op.menus !== undefined ? { menus: set.menuIds } : {}) }, effects };
    }
    case 'deleteMenuSet': {
      const set = find(s.customMenuSets, op.menuSet, 'Menu set', 960);
      s.customMenuSets.splice(s.customMenuSets.indexOf(set), 1);
      if (s.defaultMenuSetId === set.id) delete s.defaultMenuSetId;
      // Layouts that used it go back to the file's default.
      for (const d of st.designs.layouts) if (d.menuSetId === set.id) delete d.menuSetId;
      return { op: { op: 'deleteMenuSet', menuSet: set.id }, effects };
    }
    case 'setDefaultMenuSet': {
      if (op.menuSet === null || op.menuSet === 1) {
        delete s.defaultMenuSetId;
        return { op: { op: 'setDefaultMenuSet', menuSet: null }, effects };
      }
      const set = find(s.customMenuSets, op.menuSet, 'Menu set', 960);
      s.defaultMenuSetId = set.id;
      return { op: { op: 'setDefaultMenuSet', menuSet: set.id }, effects };
    }
    case 'setFileOptions': {
      const fo = { ...s.fileOptions };
      const resolved: Record<string, unknown> = { op: 'setFileOptions' };
      for (const key of ['onFirstWindowOpen', 'onLastWindowClose', 'onWindowOpen', 'onWindowClose'] as const) {
        const ref = op[key];
        if (ref === undefined) continue;
        if (ref === null) delete fo[key];
        else {
          const sc = find(s.scripts, ref, 'Script', 104);
          fo[key] = { scriptId: sc.id, script: sc.name };
        }
        resolved[key] = ref === null ? null : fo[key]!.scriptId;
      }
      if (op.openLayout !== undefined) {
        if (op.openLayout === null) {
          delete fo.openLayoutId;
          delete fo.openLayout;
        } else {
          const l = find(s.layouts, op.openLayout, 'Layout', 105);
          fo.openLayoutId = l.id;
          fo.openLayout = l.name;
        }
        resolved.openLayout = op.openLayout === null ? null : fo.openLayoutId;
      }
      if (Object.keys(fo).length) s.fileOptions = fo;
      else delete s.fileOptions;
      return { op: resolved as DesignOp, effects };
    }
    case 'createTheme': {
      const name = checkName(op.name, 'A theme');
      unique(st.designs.themes.map((t) => t.name), name, 'Theme');
      const id = op.id ?? nextId(st.designs.themes.map((t) => t.id), 1);
      // An id worked out earlier (a preview's) that another theme has taken since: two themes can't share one.
      if (st.designs.themes.some((t) => t.id === id)) throw invalid(`Theme id ${id} is taken (by "${st.designs.themes.find((t) => t.id === id)!.name}"); work the change out again`);
      if (op.from !== undefined && op.content !== undefined) throw invalid('A new theme is a copy (from) or an import (content), not both');
      const from = op.from === undefined ? undefined : themeOf(st, op.from);
      const content = op.content === undefined ? undefined : checkThemeContent(op.content);
      const theme: Theme = from ? { ...structuredClone(from), id, name } : content ? { id, name, ...structuredClone(content) } : { id, name, defaults: {}, styles: [] };
      delete theme.internalName;
      st.designs.themes.push(theme);
      return { op: { op: 'createTheme', id, name, ...(from ? { from: from.id } : {}), ...(content ? { content } : {}) }, effects };
    }
    case 'updateTheme': {
      const theme = themeOf(st, op.theme);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A theme');
        unique(st.designs.themes.map((t) => t.name), name, 'Theme', theme.name);
        theme.name = name;
      }
      if (op.defaults !== undefined) {
        if (!op.defaults || typeof op.defaults !== 'object') throw invalid('defaults must map element types to rules');
        for (const [el, rules] of Object.entries(op.defaults)) {
          if (!/^\d+$/.test(el)) throw invalid(`"${el}" isn't an element type`);
          if (rules === null) delete theme.defaults[Number(el)];
          else theme.defaults[Number(el)] = checkRules(rules, `Element ${el}`);
        }
      }
      return { op: { ...op, theme: theme.id }, effects };
    }
    case 'deleteTheme': {
      const theme = themeOf(st, op.theme);
      const using = st.designs.layouts.filter((l) => l.themeId === theme.id).map((l) => l.name);
      if (using.length) throw invalid(`${using.length === 1 ? 'Layout' : `${using.length} layouts`} use theme "${theme.name}" (${using.slice(0, 3).join(', ')}${using.length > 3 ? ', ...' : ''}): change their theme first`);
      st.designs.themes.splice(st.designs.themes.indexOf(theme), 1);
      return { op: { op: 'deleteTheme', theme: theme.id }, effects };
    }
    case 'createStyle': {
      const theme = themeOf(st, op.theme);
      const name = checkName(op.name, 'A style');
      if (!Number.isInteger(op.element)) throw invalid('A style needs the element type it is for');
      unique(theme.styles.filter((x) => x.element === op.element).map((x) => x.name), name, 'Style');
      theme.styles.push({ name, element: op.element, rules: checkRules(op.rules ?? [], `Style "${name}"`) });
      return { op: { ...op, theme: theme.id, name }, effects };
    }
    case 'updateStyle': {
      const theme = themeOf(st, op.theme);
      const style = styleOf(theme, op.style, op.element);
      if (op.rules !== undefined) style.rules = checkRules(op.rules, `Style "${style.name}"`);
      if (op.name !== undefined) {
        const name = checkName(op.name, 'A style');
        unique(theme.styles.filter((x) => x.element === style.element).map((x) => x.name), name, 'Style', style.name);
        if (name !== style.name) {
          themedStyles(st, theme.id, (o, el) => {
            if (o.name === style.name && (style.element === undefined || el === undefined || el === style.element)) o.name = name;
          });
          style.name = name;
        }
      }
      return { op: { ...op, theme: theme.id, ...(style.element !== undefined ? { element: style.element } : {}) }, effects };
    }
    case 'deleteStyle': {
      const theme = themeOf(st, op.theme);
      const style = styleOf(theme, op.style, op.element);
      theme.styles.splice(theme.styles.indexOf(style), 1);
      themedStyles(st, theme.id, (o, el) => {
        if (o.name === style.name && (style.element === undefined || el === undefined || el === style.element)) delete o.name;
      });
      return { op: { op: 'deleteStyle', theme: theme.id, style: style.name, ...(style.element !== undefined ? { element: style.element } : {}) }, effects };
    }
    case 'setOrder': {
      const layouts = op.list === 'layouts';
      if (!layouts && op.list !== 'scripts') throw invalid('setOrder list must be "layouts" or "scripts"');
      const built = layouts
        ? buildOrder(s.layouts, s.layoutOrder, op.order, 'Layout', 105)
        : buildOrder(s.scripts, s.scriptOrder, op.order, 'Script', 104);
      if (layouts) s.layoutOrder = built.order;
      else s.scriptOrder = built.order;
      return { op: { op: 'setOrder', list: op.list, order: built.resolved }, effects };
    }
    default:
      throw invalid(`Unknown change "${(op as { op: string }).op}"`);
  }
}

/** Brings the placed copies of a component up to date on every layout, as layout changes for the log. */
/** A phone layout's design from its desktop layout: stacked, and marked with what it showed, so a hand edit is noticed. */
function phoneOf(st: DesignState, desktop: Design, width: number): Partial<LayoutDesign> {
  const stacked = phoneDesign(desktop, width);
  // Copies of components keep their component's children, as they will once saved.
  syncPlaced(stacked as Design, st.designs.components ?? []);
  return { ...stacked, phone: { of: desktop.id, width, synced: phoneFingerprint(stacked) } };
}

/** Rebuilds the phone layouts made from a layout that still show what they were built as. */
function rephone(st: DesignState, desktopId: number): DesignOp[] {
  const desktop = st.designs.layouts.find((d) => d.id === desktopId);
  if (!desktop) return [];
  const out: DesignOp[] = [];
  for (const d of st.designs.layouts) {
    if (d.phone?.of !== desktopId || phoneFingerprint(d) !== d.phone.synced) continue;
    const next = phoneOf(st, desktop, d.phone.width);
    if (JSON.stringify(next) === JSON.stringify({ objects: d.objects, parts: d.parts, width: d.width, phone: d.phone })) continue;
    Object.assign(d, next);
    delete (d as Design).generated; // as the logged updateLayout does when replayed
    out.push({ op: 'updateLayout', layout: d.id, design: next });
  }
  return out;
}

function resync(st: DesignState, componentId: number): DesignOp[] {
  const out: DesignOp[] = [];
  for (const d of st.designs.layouts) {
    if (places(d, componentId) && syncPlaced(d, st.designs.components ?? [])) {
      delete (d as Design).generated; // as the logged updateLayout does when replayed
      out.push({ op: 'updateLayout', layout: d.id, design: { objects: d.objects } });
    }
  }
  return out;
}

function deleteOccurrence(st: DesignState, to: TableOccurrence): void {
  const s = st.schema;
  propagate(st, { kind: 'occurrence', from: to.name, to: null });
  s.relationships = s.relationships.filter((r) => r.leftTableOccurrenceId !== to.id && r.rightTableOccurrenceId !== to.id);
  s.tableOccurrences.splice(s.tableOccurrences.indexOf(to), 1);
}

/** A copy of the state to change; the reader of other files is shared (a function can't be cloned). */
function cloneState(st: DesignState): DesignState {
  const { externalFile, ...cloneable } = st;
  return { ...structuredClone(cloneable), externalFile };
}

/** Apply ops to a copy of the design; the original is untouched if any op fails. */
export function applyOps(st: DesignState, ops: DesignOp[], deleted?: DeletedLookup): { state: DesignState; ops: DesignOp[]; effects: Effect[] } {
  if (!Array.isArray(ops) || !ops.length) throw invalid('Send a list of changes');
  const state = cloneState(st);
  const resolved: DesignOp[] = [];
  const effects: Effect[] = [];
  ops.forEach((op, i) => {
    try {
      const r = applyOp(state, op, deleted);
      resolved.push(r.op);
      // Layouts a change rewrote as well (a component's placed copies): logged so their versions show it.
      if (r.also) resolved.push(...r.also);
      effects.push(...r.effects);
    } catch (e) {
      if (e instanceof DesignError && ops.length > 1) throw new DesignError(e.code, `Change ${i + 1} (${op?.op}): ${e.message}`);
      throw e;
    }
  });
  return { state, ops: resolved, effects };
}

/** An empty schema, for a solution started from scratch. */
export function emptySchema(): Schema {
  return {
    header: { format: 'openhbam', encrypted: false, versionNum: 12, creator: 'openhbam', versionDate: '' },
    tables: [], tableOccurrences: [], relationships: [], layouts: [], layoutOrder: [], scripts: [], scriptOrder: [],
    valueLists: [], customFunctions: [],
    // The owner: give Admin a password with `tabularius passwd`. Full Access can use the Data API, the web client and AI.
    accounts: [{ id: 1, name: 'Admin', privilegeSetId: 1 }],
    privilegeSets: [{
      id: 1, name: '[Full Access]', records: { view: true, create: true, edit: true, delete: true },
      layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmapp', 'fmwebdirect', 'fmrest'],
    }],
    extendedPrivileges: [{ id: 1, name: 'fmapp' }, { id: 2, name: 'fmwebdirect' }, { id: 3, name: 'fmrest' }],
    dataSources: [], themes: [], fonts: [], customMenus: [], customMenuSets: [],
  };
}
