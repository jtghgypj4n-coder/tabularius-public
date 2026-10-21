// Schema catalogs of an fmp12 file, decoded from the path tree.
//
// Path map (top-level path -> catalog). Object definitions live at
// [catalog].5.[id]; [catalog].1 holds indexes and display order.
//
//   2       file/version info              23.1  accounts
//   3.16    base tables (ids >= 129)       23.2  privilege sets
//   3.17    table occurrences              23.3  extended privileges
//   3.251   relationships
//   4       layouts (4.1.7 = display order with folders)
//   6       themes                         25    fonts
//   16      custom functions               31    image/container library
//   17      scripts (17.1.7 = order)       32    external data sources
//   33      value lists                    64/65 custom menu sets / menus
//   [128+n] a base table's own data: .3.5.[field] field defs, .5.[record] rows
//
// Inferred from sample files; see docs/research/fmp12-format.md.

import { buildTree, type Node, type Segment } from './tree.ts';
import { readCustomMenus, type CustomMenu, type CustomMenuSet } from './menus.ts';
import { decodeText } from './scsu.ts';
import { scriptStepName } from './script-steps.ts';
import { decodeStepParams, stepLine, type ParamContext, type StepParams } from './script-params.ts';
import { pathValue } from './chunks.ts';
import { Pb } from './proto.ts';
import { CalcDecodeError, calcTokens, decodeCalc, schemaFieldNamer, type FieldNamer } from './calc.ts';

interface Namers {
  field: FieldNamer;
  customFunction: (id: number) => string;
}
import type { FmpFile, Header } from './file.ts';

export type FieldKind = 'normal' | 'calculation' | 'summary' | 'unknown';
export type FieldType = 'text' | 'number' | 'date' | 'time' | 'timestamp' | 'container' | 'unknown'
  | 'boolean' | 'integer' | 'decimal' | 'json' | 'uuid';

export interface Field {
  id: number;
  name: string;
  kind: FieldKind;
  type: FieldType;
  comment?: string;
  /** Auto-enter / calculation formula, when present. */
  hasCalculation: boolean;
  /** Formula of a calculation field, or the auto-enter calculation of a normal field. */
  calculation?: string;
  /** Table occurrence the formula is evaluated from (its TO::Field names are relative to it). */
  calculationContextId?: number;
  /** Storage, auto-enter and validation options. */
  options?: FieldOptions;
  /** What a summary field summarizes. */
  summary?: { type: SummaryType; fieldId: number; field?: string; running?: boolean; restartFieldId?: number; restartField?: string };
}

/** Summary field kinds; the ids after Count are inferred from FileMaker's option order. */
export type SummaryType = 'total' | 'average' | 'count' | 'minimum' | 'maximum' | 'stdDev' | 'fractionOfTotal' | 'stdDevP' | 'list';
const SUMMARY_TYPES: Record<number, SummaryType> = {
  1: 'total', 2: 'average', 3: 'count', 4: 'minimum', 5: 'maximum', 6: 'stdDev', 7: 'fractionOfTotal', 8: 'stdDevP', 9: 'list',
};

export type AutoEnterValue =
  | 'creationDate' | 'creationTime' | 'creationTimestamp' | 'creationName' | 'creationAccountName'
  | 'modificationDate' | 'modificationTime' | 'modificationTimestamp' | 'modificationName' | 'modificationAccountName';

/**
 * Field options from the 26-byte definition at key 2 and its companions.
 * Bits were matched against a Database Design Report; the meaning of a few
 * (noted below) is inferred from field names and values.
 */
export interface FieldOptions {
  /** Global storage: one value shared by all records. */
  global: boolean;
  /** A calculation whose result is not stored, so it is computed when read. */
  unstored: boolean;
  /** Number of repetitions (1 for an ordinary field). */
  repetitions: number;
  /**
   * A calculation field computed even when every field it reads is empty
   * ("Do not evaluate if all referenced fields are empty" unchecked).
   */
  evaluateWhenEmpty?: boolean;
  /**
   * Storage indexes kept: a value index, and for text a word index. Indexing
   * "All" is both for text and the value index for other types; "Minimal" a
   * text field with one of them. None when absent.
   */
  index?: { value?: true; word?: true };
  /** "Automatically create indexes as needed" unchecked. */
  noAutoIndex?: true;
  /** Default language for indexing and sorting, as FileMaker's XML names it ("English"); indexLanguageId when the name isn't known. */
  indexLanguage?: string;
  indexLanguageId?: number;
  autoEnter?: {
    /** Creation / modification date, time, timestamp, name or account name. */
    value?: AutoEnterValue;
    /** Serial number; onCommit: generated when the record is first committed, not when it is created. */
    serial?: { next: string; increment: number; onCommit?: boolean };
    /** Constant data entered on creation. */
    data?: string;
    /**
     * "Value from last visited record": a new record copies this field from the
     * record the window was on. Set in design mode and by pasted XML; not decoded
     * from files yet (byte 11 bit 6 is a candidate no sample sets).
     */
    lastVisited?: boolean;
    /** Field.calculation is an auto-enter calculation. */
    calculation?: boolean;
    /** Recompute even when the field already has a value ("Do not replace existing value" unchecked). */
    replaceExisting?: boolean;
    /** Evaluate even when every field the calculation references is empty. */
    evaluateWhenEmpty?: boolean;
    /** Copy a value from a related record when the match fields change ("Looked-up value"). */
    lookup?: FieldLookup;
    /** People can't change the value (Data API and web client edits); scripts still can. */
    prohibitModification?: boolean;
  };
  /**
   * Container fields: "Store container data externally", in a Manage Containers
   * base directory (id 0 is the default, [database location]/Files/[database name]/):
   * secure storage, or open storage under `path` (a calculation). Read from files
   * (def[10] & 0x30) as open storage under its path; secure storage's flag is not
   * known yet, so `secure` is only set in design mode and by pasted XML.
   */
  externalStorage?: { directoryId: number; path?: string; secure?: boolean; fewerFolders?: boolean };
  validation?: {
    /** Validate always, not only during data entry (inferred). */
    always?: boolean;
    /** The user cannot override a failed validation. */
    strict?: boolean;
    notEmpty?: boolean;
    unique?: boolean;
    range?: { min: string; max: string };
    maxLength?: number;
    /** Must be a member of this value list (id), inferred. */
    valueList?: number;
    /** Must make this calculation true. */
    calculation?: string;
    /** Check the calculation on every commit, not only when the field changed ("Validate only if field has been modified" unchecked). */
    calculationAlways?: boolean;
    message?: string;
    /** The message is a calculation (FileMaker 21.1.1 and later), worked out when the check fails. */
    messageCalculation?: boolean;
    /** Strict data type: a number, a date with a four-digit year, or a time of day. */
    type?: 'number' | 'date4' | 'time';
    /** Must be a value some other record already has in this field. */
    existing?: boolean;
  };
}

/** Where a looked-up value comes from. */
export interface FieldLookup {
  /** Table occurrence the lookup starts from (one of the field's table); default: the table's first. */
  fromId?: number;
  /** Related table occurrence and the field to copy from it. */
  occurrenceId: number;
  fieldId: number;
  /**
   * With no related record: keep the value (default, "do not copy"), copy from
   * the record with the next lower or higher match value, use `value`, or
   * empty the field (Tabularius's own).
   */
  noMatch?: 'keep' | 'lower' | 'higher' | 'value' | 'empty';
  value?: string;
  /** Copy an empty related value too (default: keep the current value). */
  copyEmpty?: boolean;
}

export interface Table {
  id: number;
  name: string;
  fields: Field[];
}

export interface TableOccurrence {
  id: number;
  name: string;
  /** Base table id, in this file or in the external data source below. */
  baseTableId?: number;
  /** External data source id (see Schema.dataSources); absent for this file's tables. */
  dataSourceId?: number;
  /** Box colour on the relationship graph, #rrggbb. */
  color?: string;
  /** Box on the relationship graph (inferred: x, y, then two size values). */
  graph?: { left: number; top: number; width: number; height: number };
}

export type JoinOperator = '=' | '≠' | '<' | '≤' | '>' | '≥' | '×';

export interface JoinPredicate {
  leftFieldId: number;
  operator: JoinOperator;
  rightFieldId: number;
  /** Field names, resolved through each side's base table. */
  leftField?: string;
  rightField?: string;
}

export interface Relationship {
  id: number;
  leftTableOccurrenceId: number;
  rightTableOccurrenceId: number;
  leftTableOccurrence?: string;
  rightTableOccurrence?: string;
  predicates: JoinPredicate[];
  /** True when the relationship sorts related records. */
  sorted: boolean;
  /** "Allow creation of records in this table via this relationship", per side. */
  leftCreate?: boolean;
  rightCreate?: boolean;
  /** "Delete related records in this table when a record is deleted in the other table", per side. */
  leftDelete?: boolean;
  rightDelete?: boolean;
}

export interface CatalogItem {
  id: number;
  name: string;
}

export interface Account extends CatalogItem {
  /** Its privilege set (k11: a count byte, then the id). */
  privilegeSetId?: number;
  /** What in this account the reader did not understand and so left out (an id written in a form no sample uses: the account gets no set). */
  undecoded?: string[];
  /** Authenticated by an external server or identity provider: the name is a group (k2 = 01; Flicks DDR managedBy="External"). */
  external?: boolean;
  /** FileMaker's password verifier (k6, hex): 01, a 10-byte salt, a 20-byte PBKDF2-HMAC-SHA1 key, a check value. */
  passwordVerifier?: string;
  /**
   * The "Active" box is off in Manage Security, so the account can't sign in.
   * Read from k10, a run of nibble-packed values (a length byte, then the
   * nibbles, padded with a 0 to a whole byte): an inactive account's run has
   * 635399 appended (last so far; matched anywhere, so a value added after it
   * still reads as off). Fits every account of the Flicks Design Report (tool_admin,
   * tool-full-access and [Guest] off; Admin, lon_c, workgroup on) and a guest
   * that must be on (PortableCode39-2). How FileMaker packs the rest of k10 is
   * not known; in the runs seen, the other values can't spell 635399.
   */
  inactive?: true;
}

/** What a privilege set allows on all layouts, value lists or scripts. */
export type DesignAccess = 'modifiable' | 'viewOnly' | 'none';

/** Record access to one base table under a set's "Custom privileges". */
export interface TableRecordAccess {
  /** Base-table id (matches Schema.tables[].id). */
  tableId: number;
  records: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  /**
   * Per-field access, when the table customises it (the table node's child 5,
   * keyed by field id). `access` is the raw byte; view/edit are its capability
   * bits (0x01 view, 0x02 edit, edit gated on view): view+edit = ReadWrite,
   * view only = ReadOnly, neither = NoAccess. The ordering 0x03 > 0x01 > 0x00 is
   * solid, but the low bit being *view* (so 0x01 = ReadOnly, not NoAccess) is
   * inferred, not pinned by a labelled source — see `fieldBits`. When a table
   * customises fields, every field is listed explicitly; on import
   * (store customAccess) a field absent from this array gets no access.
   */
  fields?: { fieldId: number; access: number; view: boolean; edit: boolean }[];
}

export interface PrivilegeSet extends CatalogItem {
  comment?: string;
  /** Records in all tables (key 2, first byte: bits for view, create, edit, delete). */
  records: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  /**
   * True when the set uses "Custom privileges" for records — access is per
   * table (see `tableRecords`) and the file-level `records` above is all-false
   * and not meaningful. The marker is the absence of the file-level record byte
   * (key 2) on the set node.
   */
  customRecordAccess?: boolean;
  /**
   * Per-table record access for a custom set (child 5, keyed by base-table id;
   * a table not listed gets no access). Per-field access, when a table
   * customises it, is on each entry's `fields`. Record access that is "limited"
   * by a calculation is not yet distinguished from a plain grant: no accessible
   * .fmp12 uses it, so the
   * byte encoding is unverified (the per-table child 8 seen in samples holds an
   * unrelated identifier calc, not an access predicate).
   */
  tableRecords?: TableRecordAccess[];
  /**
   * What the reader did not understand in this set and so imported as no access (or, for key 10, as the
   * restrictive default). Absent when every byte it read was in a form seen in a real file.
   */
  undecoded?: string[];
  /** Layouts, value lists and scripts (child 9, keys 4, 33 and 17). For scripts, viewOnly means executable only. */
  layouts: DesignAccess;
  valueLists: DesignAccess;
  scripts: DesignAccess;
  /** Keywords of the extended privileges the set has (fmapp, fmrest, ...). */
  extendedPrivileges: string[];
  /** Allow printing (key 10, 0x0100). */
  printing?: boolean;
  /** Allow exporting (key 10, 0x0200). */
  exporting?: boolean;
  /** Allow the account holder to change their own password (key 10, 0x0004). */
  allowModifyPassword?: boolean;
  /** Disconnect the user from the host when idle (key 10): on unless 0x0002 is set. */
  idleDisconnect?: boolean;
  /**
   * Key 10: other options, as a bitfield. Decoded bits: printing 0x0100,
   * exporting 0x0200, allow-modify-password 0x0004, and idle-disconnect, which
   * is on by default and turned off by 0x0002 (so the stored bit means "keep
   * connected"). These are fixed against two independent labelled sources: a
   * Save as XML export (nbourre/yada, MIT) whose `<Other value=…>` names each
   * option, and the Flicks DDR's `<PrivilegeSet>` attributes; both agree on all
   * four bits across eight sets. Manage-accounts, manage-extended-privileges and
   * override-validation only ever appear in [Full Access] (0x9fff, every bit
   * set) in these samples, so their bits aren't isolated. The available-menu
   * level is NOT in this word: Flicks stores 0x0304 with menu "All" while yada
   * stores 0x0304 with menu "Minimum", so it lives in another key.
   */
  flags?: number;
}

export interface Layout extends CatalogItem {
  tableOccurrenceId?: number;
  /** Layout objects that carry a text label (field labels, static text). */
  labels: string[];
}

export interface OrderedItem {
  id: number;
  name: string;
  kind: 'item' | 'folder' | 'separator' | 'folder-end' | 'unknown';
  depth: number;
  /** "Include in menu" unchecked: left out of the Layouts or Scripts menu (a folder with what it holds). */
  hidden?: true;
}

export interface ScriptStep {
  stepId: number;
  name: string;
  /** Disabled (commented-out) steps are stored with a negated type id. */
  enabled: boolean;
  /** Comment text for comment steps, or the first text parameter. */
  text?: string;
  /** Formulas the step uses (Set Variable value, If condition, ...), in storage order. */
  calculations?: string[];
  /** What the step does: its targets and options. */
  params?: StepParams;
  /** The step as FileMaker's script workspace shows it. */
  line?: string;
}

export interface Script extends CatalogItem {
  steps: ScriptStep[];
  /** "Run script with full access privileges" (key 241, bit 0). */
  fullAccess?: boolean;
  /**
   * Tabularius's own guard, which FileMaker doesn't have: stop the script (and the subscripts it performs) cleanly
   * after this many steps or seconds (waits for a person don't count), or any of its loops after this many times round.
   */
  limits?: { steps?: number; seconds?: number; loopPasses?: number };
}

export interface ValueList extends CatalogItem {
  values?: string[];
  /** Values from a field instead. */
  field?: ValueListField;
  /** The values of a list in another file instead: the data source naming that file, and the list's id there. */
  external?: { dataSourceId: number; valueListId: number };
}

/** A value list's values taken from a field: every value in it, or only those related to the current record. */
export interface ValueListField {
  occurrenceId: number;
  fieldId: number;
  /** A second field shown with each value; with showSecondOnly, instead of it (the first field's value is still what's entered). */
  secondFieldId?: number;
  showSecondOnly?: boolean;
  /** Only values related to the current record, starting from this occurrence. */
  relatedFromId?: number;
  /** Sort by the second field instead of the first. */
  sortBySecond?: boolean;
}

export interface CustomFunction extends CatalogItem {
  parameters: string[];
  formula?: string;
  /** Written in JavaScript (Tabularius's own; FileMaker's are always calculations): `formula` is the function's body. */
  language?: 'javascript';
}

export interface DataSource extends CatalogItem {
  paths: string[];
}

/** A Manage Containers base directory: a path relative to the database's folder, ending in "/". */
export interface ContainerDirectory {
  id: number;
  path: string;
}

export interface Schema {
  header: Header;
  tables: Table[];
  tableOccurrences: TableOccurrence[];
  relationships: Relationship[];
  layouts: Layout[];
  layoutOrder: OrderedItem[];
  scripts: Script[];
  scriptOrder: OrderedItem[];
  valueLists: ValueList[];
  customFunctions: CustomFunction[];
  accounts: Account[];
  privilegeSets: PrivilegeSet[];
  extendedPrivileges: CatalogItem[];
  dataSources: DataSource[];
  /** Manage Containers base directories; absent when the file has only the default. */
  containerDirectories?: ContainerDirectory[];
  themes: CatalogItem[];
  fonts: CatalogItem[];
  customMenus: CustomMenu[];
  customMenuSets: CustomMenuSet[];
  /** The menu set a file opens with (File Options); 1 is FileMaker's standard menus. */
  defaultMenuSetId?: number;
  /** File Options: the scripts run when the file opens and closes, and the layout it opens on. */
  fileOptions?: FileOptions;
  /** The file's page setup (Print Setup), from the last Mac that set it. */
  pageSetup?: PageSetup;
  /** tabularius: ids of deleted design objects, kept out of use so references cannot bind to an unrelated replacement. */
  retiredIds?: Record<string, number[]>;
}

export interface FileOptions {
  onFirstWindowOpen?: { scriptId: number; script?: string };
  onLastWindowClose?: { scriptId: number; script?: string };
  /**
   * OnWindowOpen and OnWindowClose (File Options, Claris "Script triggers"). Not decoded from a FileMaker file: they are
   * set in design mode and kept in the repo's own format only.
   */
  onWindowOpen?: { scriptId: number; script?: string };
  onWindowClose?: { scriptId: number; script?: string };
  /** "Switch to layout"; whether the option is ticked is not decoded yet, so this may be unset in FileMaker. */
  openLayoutId?: number;
  openLayout?: string;
}

/**
 * File Options, key 24 of catalog 2: four flag bytes, two bytes not decoded yet
 * (01 01 or 02 01; the files with 02 log in with an account), then the
 * OnFirstWindowOpen script, the OnLastWindowClose script and the layout to open
 * on, each [n+1][n][id] or 00 for none. Matched across the sample files, whose
 * trigger scripts are named after the events and whose layouts are often "Splash".
 */
export function readFileOptions(b: Uint8Array | undefined, scripts: CatalogItem[], layouts: CatalogItem[]): FileOptions | undefined {
  if (!b || b.length < 5) return undefined;
  const refs: (number | undefined)[] = [];
  for (let at = 6; refs.length < 3 && at < b.length;) {
    const len = b[at];
    refs.push(len > 1 ? pathValue(b.subarray(at + 2, at + 1 + len)) : undefined);
    at += len + 1;
  }
  const out: FileOptions = {};
  const script = (id: number | undefined) => {
    if (!id) return undefined;
    const name = scripts.find((s) => s.id === id)?.name;
    return name ? { scriptId: id, script: name } : { scriptId: id };
  };
  const open = script(refs[0]);
  if (open) out.onFirstWindowOpen = open;
  const close = script(refs[1]);
  if (close) out.onLastWindowClose = close;
  if (refs[2]) {
    out.openLayoutId = refs[2];
    const name = layouts.find((l) => l.id === refs[2])?.name;
    if (name) out.openLayout = name;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface PageSetup {
  orientation: 'portrait' | 'landscape';
  /** The paper, as the printer names it ("na-letter", "iso-a4"). */
  paper?: string;
  /** Paper size and the printer's margins around the printable area, in points. */
  width: number;
  height: number;
  margins: { top: number; left: number; bottom: number; right: number };
  /** Page Setup's scale (1 for 100%). */
  scale?: number;
}

/**
 * Page setup, catalog 2 child 135: a binary header, then the macOS print
 * page format as a property list (in the node's segments). Read from the
 * plist: PMOrientation (1 portrait, 2 landscape), the paper name, and the
 * adjusted paper and page rectangles (top, left, bottom, right; the page
 * rectangle is the printable area, the paper's starts at minus the margins).
 * Files last set up on Windows have no plist.
 */
export function readPageSetup(n: Node | undefined): PageSetup | undefined {
  if (!n?.segments.size) return undefined;
  const parts = [...n.segments.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const bytes = new Uint8Array(parts.reduce((t, b) => t + b.length, 0));
  let at = 0;
  for (const b of parts) {
    bytes.set(b, at);
    at += b.length;
  }
  const text = new TextDecoder('latin1').decode(bytes);
  // Each setting appears twice: as the ticket's key, then inside its item array with the value.
  const value = (key: string) => text.match(new RegExp(`<key>com\\.apple\\.print\\.\\w+\\.${key}</key>\\s*<(integer|real|string|array)>([\\s\\S]*?)</\\1>`))?.[2];
  const rect = (key: string) => {
    const nums = [...(value(key) ?? '').matchAll(/<(?:real|integer)>([-\d.e]+)<\/(?:real|integer)>/g)].map((m) => Number(m[1]));
    return nums.length === 4 && nums.every(Number.isFinite) ? nums : undefined;
  };
  const paperRect = rect('PMAdjustedPaperRect');
  const pageRect = rect('PMAdjustedPageRect');
  if (!paperRect || !pageRect) return undefined;
  const [pt, pl, pb, pr] = paperRect;
  const [t, l, b, r] = pageRect;
  const width = pr - pl;
  const height = pb - pt;
  if (!(width > 0 && height > 0 && r > l && b > t)) return undefined;
  const out: PageSetup = {
    orientation: value('PMOrientation') === '2' ? 'landscape' : 'portrait',
    width, height,
    margins: { top: t - pt, left: l - pl, bottom: pb - b, right: pr - r },
  };
  const paper = value('PMPaperName') ?? value('PMPPDPaperCodeName');
  if (paper) out.paper = paper.trim();
  const scale = Number(value('PMScaling'));
  if (Number.isFinite(scale) && scale > 0 && scale !== 1) out.scale = scale;
  return out;
}

const FIELD_KINDS: Record<number, FieldKind> = { 1: 'normal', 2: 'calculation', 3: 'summary' };
const FIELD_TYPES: Record<number, FieldType> = {
  1: 'text', 2: 'number', 3: 'date', 4: 'time', 5: 'timestamp', 6: 'container',
};

// FileMaker stores built-in names as Private Use characters that the client
// localises. U+E002 is the Guest account (inferred from every sample file).
const BUILTIN_NAMES: Record<string, string> = { '[\ue002]': '[Guest]' };

function items(n: Node | undefined): CatalogItem[] {
  if (!n) return [];
  return n.numbered().map(([id, c]) => {
    const name = c.name ?? '';
    return { id, name: BUILTIN_NAMES[name] ?? name };
  });
}

/** Whether an account's k10 says its Active box is off (see Account.inactive). */
export function accountInactive(k10: Uint8Array | undefined): boolean {
  if (!k10 || k10.length < 2 || k10[0] !== k10.length - 1) return false;
  return Buffer.from(k10.subarray(1)).toString('hex').includes('635399');
}

export function readAccounts(n: Node | undefined): Account[] {
  return items(n).map((a) => {
    const node = n!.child(a.id)!;
    const out: Account = node.kv.get(2)?.[0] === 1 ? { ...a, external: true } : { ...a };
    const verifier = node.kv.get(6);
    if (verifier && verifier.length >= 31 && verifier[0] === 1) out.passwordVerifier = Buffer.from(verifier).toString('hex');
    if (accountInactive(node.kv.get(10))) out.inactive = true;
    const k = node.kv.get(11);
    // A count byte, then that many bytes of id (ids are small: four bytes is far more than a file needs). Any other
    // shape names no set, so the account has none and opens nothing; reading trailing bytes into the id could land
    // on another set, [Full Access] included.
    if (k && (k.length < 2 || k[0] !== k.length - 1 || k.length > 5)) return { ...out, undecoded: [`privilege set (id stored as ${Buffer.from(k).toString('hex')}; the account has no set)`] };
    if (!k || k.length < 2) return out;
    let id = 0;
    for (const b of k.subarray(1)) id = id * 256 + b;
    return { ...out, privilegeSetId: id };
  });
}

// Child 9 of a privilege set: bit 0 = modify (and create), bit 1 = view or
// run. Every sample stores exactly four values: 0xdf and 0xde for layouts,
// 0xd7 and 0xd6 for value lists and scripts (modifiable and view only, against
// the Flicks DDR). "No access" has never been seen. Anything else (another
// byte, another pairing, more than one byte, a missing key) is a form nobody
// has seen and may be how a per-layout "Custom privileges" choice is stored,
// so it imports as no access and is reported, the same for a byte that looks
// like "none": it cannot be told from a custom choice.
function designAccess(v: Uint8Array | undefined, seen: [number, number], what: string, undecoded: string[]): DesignAccess {
  if (v?.length === 1 && (v[0] === seen[0] || v[0] === seen[1])) return v[0] === seen[0] ? 'modifiable' : 'viewOnly';
  undecoded.push(`${what} access (${v?.length ? `stored as ${Buffer.from(v).toString('hex')}` : 'not stored'})`);
  return 'none';
}

const NO_RECORDS = { view: false, create: false, edit: false, delete: false };

/**
 * Record-access bits (key 2 first byte), at file level and per table alike.
 * The bytes the samples hold are 0x55 (view, create, edit, delete) and 0x10
 * (view only), plus none at all. 0x10 for view is checked against the Flicks
 * DDR; which of 0x01, 0x04 and 0x40 is create, edit or delete is inferred, as
 * is the guess that each permission is a two-bit field whose other value
 * (0x20, 0x02, 0x08, 0x80) is "limited by calculation". So only those three
 * bytes are read in full. Any other byte could be a different permission than
 * the inference says, so it gives view when the view bit is set and nothing
 * else, and is reported. At file level the second byte is 0x03 in every sample
 * and the key is two bytes; another form is read the same cautious way.
 */
function recordBits(byte: number, where: string, undecoded: string[], whole = true): { view: boolean; create: boolean; edit: boolean; delete: boolean } {
  if (byte === 0x55 && whole) return { view: true, create: true, edit: true, delete: true };
  if (byte === 0x10 && whole) return { view: true, create: false, edit: false, delete: false };
  if (byte === 0 && whole) return { ...NO_RECORDS };
  undecoded.push(`${where} record access (${whole ? `byte ${byte.toString(16).padStart(2, '0')}` : 'a form no sample shows'}; only view is imported)`);
  return { ...NO_RECORDS, view: (byte & 0x30) === 0x10 };
}

/**
 * Per-field access byte within a custom set's per-table node (child 5 of the
 * table node, keyed by field id), decoded as two capability bits: 0x01 view,
 * 0x02 edit. So 0x03 = view+edit (ReadWrite), 0x01 = view only (ReadOnly),
 * 0x00 or an absent entry = no access (NoAccess).
 *
 * CONFIDENT: 0x03 is the only full-access value, and the edit (write) bit is
 * 0x02 — 0x03 carries it, 0x01 does not — so the access ordering 0x03 > 0x01 >
 * 0x00 is solid. Edit is gated on view so an anomalous byte (e.g. 0x02 alone,
 * or spare high bits) can never grant edit-without-view or more than view+edit;
 * it collapses to the safe reading.
 *
 * INFERRED, not pinned by a labelled source: that the low bit (0x01) is *view*,
 * hence that 0x01 means ReadOnly rather than NoAccess. No source carries both
 * the raw byte and its FileMaker label together: the bytes come from a public
 * FileMaker 26 solution (sales.fmp12, no labels) and the three state *names*
 * (ReadWrite/ReadOnly/NoAccess) come from a public Save-as-XML export
 * (nbourre/yada, no bytes). The ReadOnly reading rests on parsimony (0x00 is
 * the natural NoAccess; the low bit as the base "granted/readable" flag) and on
 * that sample's 0x01 fields being role-coherent as view-only (cost and
 * inventory fields). If 0x01 were actually NoAccess, reporting view here would
 * over-grant view on those fields, so the raw byte is exposed too (`access`)
 * for the importer to apply a more conservative mapping if it chooses.
 */
function fieldBits(byte: number): { access: number; view: boolean; edit: boolean } {
  const view = !!(byte & 0x01);
  return { access: byte, view, edit: view && !!(byte & 0x02) };
}

/**
 * Decode a privilege set's key-10 "other options" word (big-endian) into named
 * booleans. Bit meanings are fixed against two labelled sources (see the
 * PrivilegeSet.flags doc). Absent key 10 reads as the restrictive default, with
 * idle-disconnect on (FileMaker's default).
 */
export function privilegeOther(flags: Uint8Array | undefined): {
  printing: boolean;
  exporting: boolean;
  allowModifyPassword: boolean;
  idleDisconnect: boolean;
  flags?: number;
} {
  // Every sample stores two bytes. Another length is a form nobody has seen, and
  // reading it as one big-endian number would line its bits up differently (and
  // lose them above 2^53), so it gets the restrictive default, as an absent key does.
  const other = flags?.length === 2 ? flags[0] * 256 + flags[1] : 0;
  return {
    printing: !!(other & 0x0100),
    exporting: !!(other & 0x0200),
    allowModifyPassword: !!(other & 0x0004),
    idleDisconnect: (other & 0x0002) === 0,
    ...(flags?.length === 2 ? { flags: other } : {}),
  };
}

/**
 * Privilege sets (23.2.5.[id]) and which extended privileges each has
 * (23.3.5.[id].5 lists privilege set ids). Record bits: 0x10 view, and 0x55
 * for create, edit and delete (verified against the Flicks DDR); which of
 * 0x01, 0x04 and 0x40 is delete is inferred. A "Custom privileges" set has no
 * file-level record byte and lists per-table record access under child 5 (see
 * tableRecords), with per-field access on each table's nested child 5. Custom
 * per-layout/value-list/script access (extra keys in child 9) is not decoded
 * yet; "limited by calculation" record access is not yet distinguished either.
 */
export function privilegeSets(sets: Node | undefined, extended: Node | undefined): PrivilegeSet[] {
  const ext = new Map<number, string[]>();
  for (const e of items(extended)) {
    for (const d of extended!.child(e.id, 5)?.data ?? []) {
      let id = 0;
      for (const b of d) id = id * 256 + b;
      ext.set(id, [...(ext.get(id) ?? []), e.name]);
    }
  }
  // Names are what an account's set is looked up by, case-insensitively and first match, and a set called
  // [Full Access] (or any set with id 1) has no checks at all. So no two sets may share a name, and no set but
  // the built-in one may take a built-in name: a later set that does keeps its access but gets another name.
  // FileMaker never lets two sets share a name, so only a crafted file has them.
  const fold = (name: string) => name.normalize('NFKC').toLowerCase();
  const taken = new Set<string>();
  const renamed = new Map<number, string>();
  const catalog = items(sets);
  for (const p of [...catalog.filter((c) => c.id <= 3), ...catalog.filter((c) => c.id > 3)]) {
    const builtIn = BUILT_IN_SET_IDS[p.name.toLowerCase()];
    if (p.name && (taken.has(fold(p.name)) || (builtIn !== undefined && builtIn !== p.id))) {
      let name = `${p.name} (imported set ${p.id})`;
      for (let i = 2; taken.has(fold(name)); i++) name = `${p.name} (imported set ${p.id}, ${i})`;
      renamed.set(p.id, p.name);
      p.name = name;
    }
    if (p.name) taken.add(fold(p.name));
  }
  return catalog.map((p) => {
    const n = sets!.child(p.id)!;
    const undecoded: string[] = [];
    if (renamed.has(p.id)) undecoded.push(`name (another set already has the name ${renamed.get(p.id)}; renamed, access kept)`);
    const k2 = n.kv.get(2);
    const comment = n.text(3);
    // No file-level record byte ⇒ "Custom privileges": record access is per
    // table, under child 5 keyed by base-table id (verified against a public
    // FileMaker 26 solution: every child-5 key is a real base-table id).
    const perTable = k2 ? undefined : n.child(5);
    // A set with a file-level byte and per-table entries too: which wins is not known, so neither grants anything.
    const both = !!k2 && !!n.child(5)?.numbered().length;
    if (both) undecoded.push('record access (a file-level value and per-table entries together; no record access imported)');
    const tableRecords = perTable?.numbered().map(([tableId, t]) => {
      // Nested child 5 (keyed by field id) carries per-field access bytes.
      // Field ids are >= 1, so a key-0 entry (a formatting record, as elsewhere
      // in the tree) is skipped rather than surfaced as a phantom field 0; an
      // empty byte array decodes as 0 (no access), keeping the raw `access`
      // numeric and the reading fail-closed.
      const perField = t.child(5);
      const fields = perField
        ? [...perField.kv].filter(([fieldId]) => fieldId >= 1).map(([fieldId, v]) => ({ fieldId, ...fieldBits(v[0] ?? 0) }))
        : undefined;
      return {
        tableId,
        records: recordBits(t.kv.get(2)?.[0] ?? 0, `table ${tableId}`, undecoded),
        ...(perField ? { fields } : {}),
      };
    });
    // fmmcp is Tabularius's own keyword (AI access). FileMaker has no such privilege, so a file that carries one
    // did not get it from FileMaker, and importing it would grant what the file never did.
    const extendedPrivileges = (ext.get(p.id) ?? []).filter((e) => e.toLowerCase() !== 'fmmcp');
    if (extendedPrivileges.length !== (ext.get(p.id) ?? []).length) undecoded.push('extended privilege fmmcp (not a FileMaker privilege; not imported)');
    // Child 9 holds exactly keys 4, 17 and 33 in every sample. More (the schema notes say per-layout choices may
    // be extra keys here) means the three bytes may not be the whole story, so none of them is trusted.
    const child9 = n.child(9);
    const extra9 = child9 ? [...child9.kv.keys()].filter((k) => ![4, 17, 33].includes(k)).length + child9.children.size + child9.kvLong.length : 0;
    if (extra9) undecoded.push('layout, value-list and script access (child 9 holds more than the three values every sample has)');
    const design = child9?.kv;
    const none: [number, number] = [-1, -1];
    const layouts = designAccess(design?.get(4), extra9 ? none : [0xdf, 0xde], 'layout', undecoded);
    const valueLists = designAccess(design?.get(33), extra9 ? none : [0xd7, 0xd6], 'value list', undecoded);
    const scripts = designAccess(design?.get(17), extra9 ? none : [0xd7, 0xd6], 'script', undecoded);
    const other = n.kv.get(10);
    if (other && other.length !== 2) undecoded.push(`other options (stored as ${other.length} bytes; printing, exporting and password change import as off, idle disconnect as on)`);
    return {
      ...p,
      ...(comment ? { comment } : {}),
      records: both ? { ...NO_RECORDS } : recordBits(k2?.[0] ?? 0, 'file-level', undecoded, !k2 || (k2.length === 2 && k2[1] === 3)),
      ...(k2 ? {} : { customRecordAccess: true as const }),
      ...(tableRecords?.length ? { tableRecords } : {}),
      ...(undecoded.length ? { undecoded } : {}),
      layouts,
      valueLists,
      scripts,
      extendedPrivileges,
      ...privilegeOther(other),
    };
  });
}

const BUILT_IN_SET_IDS: Record<string, number> = { '[full access]': 1, '[data entry only]': 2, '[read-only access]': 3 };

function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}

function f32(b: Uint8Array, at: number): number {
  return new DataView(b.buffer, b.byteOffset + at, 4).getFloat32(0, false);
}

/** Index languages by the id the field definition stores (byte 7), named as FileMaker's XML names them. Only English is confirmed (Flicks' report). */
// 31 holds every Japanese text field in the jp_ samples.
const INDEX_LANGUAGES: Record<number, string> = { 21: 'English', 31: 'Japanese' };

const AUTO_ENTER_VALUES: AutoEnterValue[] = [
  'creationDate', 'creationTime', 'creationTimestamp', 'creationName', 'creationAccountName',
  'modificationDate', 'modificationTime', 'modificationTimestamp', 'modificationName', 'modificationAccountName',
];

/**
 * Options from the field definition at key 2 (byte: meaning):
 *   3  auto-enter value kind (0-9, AUTO_ENTER_VALUES)
 *   7  index language (21 English)
 *   8  indexing: bit7 and bit5 are the two indexes (values, words); a text
 *      field with one is Minimal, with both All, and other types have only
 *      All; bit6 "Automatically create indexes as needed" off. Checked against
 *      Flicks' Design Report: 143 of 143 fields' index, 117 of 117 automatic
 *      settings and 203 of 203 languages match. (These bits were read before
 *      as a calculation's "evaluate when empty"; the report says otherwise.)
 *   9  bit0 global, bit1 calculation not stored
 *   10 bit0 prohibit modification (inferred: set only with auto-enter, on
 *      ids, creation and modification stamps, and on all five of the fields
 *      FileMaker adds to a new table, which come with it ticked)
 *   11 auto-enter: bit0 creation/modification value, bit1 serial, bit2 data,
 *      bit3 calculation, bit5 evaluate when references are empty,
 *      bit7 replace existing value. Calculation fields keep their own
 *      "evaluate when empty" in bit5 too (the report calls both alwaysEvaluate;
 *      Flicks' 23 calculations match, where byte 8 got 2 wrong).
 *   14 validation: bit0 value list (key 7), bit1 maximum length,
 *      bit2 always (inferred), bit4/5/6 strict data type number, four-digit
 *      year date, time of day (inferred: bit4 only on number fields, bit5
 *      only on dates and timestamps; bit6 by order, not seen yet),
 *      bit7 message is a calculation (child 32)
 *   15 validation: bit0/1 calculation (child 25), bit2 strict, bit3 not
 *      empty, bit4 unique, bit5 existing value (inferred from the dialog's
 *      order; no sample has it on), bit6 range (keys 33/34), bit7 message
 *      (key 24)
 *   16-19 serial increment, 20-23 maximum length, 24-25 repetitions
 * Key 12 is the next serial value and key 13 the auto-enter data. Key 8
 * holds looked-up value settings (readLookup). FileMaker keeps them after the
 * option is switched off, so they count only when byte 11 has bit4 (inferred:
 * the one auto-enter bit no sample sets) or no other value source.
 */
export function readOptions(f: Node, def: Uint8Array, namer?: Namers): FieldOptions | undefined {
  if (def.length < 26) return undefined;
  const opts: FieldOptions = {
    global: (def[9] & 1) !== 0,
    unstored: (def[9] & 2) !== 0,
    repetitions: (def[24] << 8) | def[25],
  };
  const calcField = def[0] === 2;
  if (calcField && def[11] & 0x20) opts.evaluateWhenEmpty = true;
  if (def[8] & 0xa0) opts.index = { ...(def[8] & 0x80 ? { value: true } : {}), ...(def[8] & 0x20 ? { word: true } : {}) };
  if (def[8] & 0x40) opts.noAutoIndex = true;
  if (def[7]) {
    if (INDEX_LANGUAGES[def[7]]) opts.indexLanguage = INDEX_LANGUAGES[def[7]];
    else opts.indexLanguageId = def[7];
  }
  const ae = calcField ? 0 : def[11];
  if (ae) {
    const a: NonNullable<FieldOptions['autoEnter']> = {};
    if (ae & 1 && AUTO_ENTER_VALUES[def[3]]) a.value = AUTO_ENTER_VALUES[def[3]];
    if (ae & 2) a.serial = { next: f.text(12) ?? '1', increment: u32(def, 16) || 1 };
    if (ae & 4) a.data = f.textOrLong(13) ?? '';
    if (ae & 8) a.calculation = true;
    if (ae & 0x20) a.evaluateWhenEmpty = true;
    if (ae & 0x80) a.replaceExisting = true;
    if (def[10] & 1) a.prohibitModification = true;
    opts.autoEnter = a;
  }
  const k8 = f.kv.get(8);
  if (k8 && !calcField && (ae & 0x10 || !(ae & 0x0f))) {
    const lookup = readLookup(k8);
    if (lookup) (opts.autoEnter ??= {}).lookup = lookup;
  }
  const v1 = def[14];
  const v2 = def[15];
  if (v1 || v2) {
    const v: NonNullable<FieldOptions['validation']> = {};
    if (v1 & 4) v.always = true;
    if (v2 & 4) v.strict = true;
    if (v2 & 8) v.notEmpty = true;
    if (v2 & 0x10) v.unique = true;
    if (v2 & 0x20) v.existing = true;
    if (v2 & 0x40) v.range = { min: f.text(33) ?? '', max: f.text(34) ?? '' };
    if (v1 & 2) v.maxLength = u32(def, 20);
    if (v1 & 0x10) v.type = 'number';
    else if (v1 & 0x20) v.type = 'date4';
    else if (v1 & 0x40) v.type = 'time';
    const vl = f.kv.get(7);
    if (v1 & 1 && vl && vl.length >= 6) v.valueList = (vl[4] << 8) | vl[5];
    if (v2 & 3 && namer) {
      const c = formula(calcTokens(f.child(25)), namer);
      if (c !== undefined) v.calculation = c;
    }
    if (v2 & 0x80) {
      const m = v1 & 0x80 && namer ? formula(calcTokens(f.child(32)), namer) : f.textOrLong(24);
      if (m !== undefined) v.message = m;
      if (m !== undefined && v1 & 0x80 && namer) v.messageCalculation = true;
    }
    if (Object.keys(v).length) opts.validation = v;
  }
  // "Store container data externally" (Manage Containers). The flag is def[10] &
  // 0x30 (0x30 on a private sample's invoice PDF field, which stores externally;
  // bit 0 of def[10] is prohibitModification, above). FileMaker writes key 38 (the
  // base directory) and child 39 (the open-storage path) on a container even when
  // it stores *internally* — Flicks' LIBRARY_CODE::container has both yet def[10] is
  // 0 and its Design Report shows no <Remote> — so key 38/child 39 don't mark
  // external; the def[10] flag does. Secure storage's encoding is not known yet (no
  // sample), so external storage is read as open, under its path.
  if (def[1] === 6 && (def[10] & 0x30) !== 0) {
    const dir = f.kv.get(38);
    const es: NonNullable<FieldOptions['externalStorage']> = { directoryId: dir && dir.length >= 4 ? u32(dir, 0) : 0 };
    const path = containerStoragePath(f.child(39));
    // The path is held as a calculation (quoted when serialized to XML and in
    // design mode), and FileMaker stores it as a plain literal, so it becomes a
    // string literal: "Docs/Invoices/".
    if (path) es.path = `"${path.replace(/[\\"]/g, '\\$&')}"`;
    opts.externalStorage = es;
  }
  return opts;
}

/**
 * The open-storage path of an externally-stored container (its plain text, not
 * yet quoted as a calculation), from child 39 key 5 (key 6 is a copy). The bytes
 * are [0x13][length][path], the path obfuscated by XOR 0x5A and then UTF-8 —
 * e.g. 13 0e 1e3539297513342c3533393f2975 → "Docs/Invoices/".
 */
export function containerStoragePath(n: Node | undefined): string | undefined {
  const b = n?.kv.get(5);
  if (!b || b.length < 2 || b[0] !== 0x13) return undefined;
  const len = b[1];
  if (b.length < 2 + len) return undefined;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = b[2 + i] ^ 0x5a;
  return new TextDecoder().decode(out);
}

/**
 * Looked-up value settings, field key 8 (price fields in one private sample,
 * and 20 lookups in another):
 *   2 bytes (03 01 or 00 00), related occurrence as a ref, 1 byte, the
 *   field as a ref in a 4-byte slot, 4 bytes (not decoded: likely the
 *   no-match and empty options), occurrence the lookup starts from as a
 *   ref, 1 byte. Each ref is [length + 1][length][path integer], so a field
 *   id past 127 takes 03 02 and fills its slot.
 * The no-match and copy-empty options stay at FileMaker's defaults.
 */
export function readLookup(b: Uint8Array): FieldLookup | undefined {
  const isRef = (at: number) => at + 1 < b.length && b[at] === b[at + 1] + 1 && at + 2 + b[at + 1] <= b.length;
  if (b.length < 8 || !isRef(2)) return undefined;
  const occ = readRef(b, 2);
  if (!isRef(occ.next + 1)) return undefined;
  const field = readRef(b, occ.next + 1);
  if (!occ.value || !field.value) return undefined;
  const out: FieldLookup = { occurrenceId: occ.value, fieldId: field.value };
  const at = occ.next + 1 + 8;
  if (isRef(at)) {
    const from = readRef(b, at);
    if (from.value) out.fromId = from.value;
  }
  return out;
}

export function readFields(t: Node | undefined): Field[] {
  if (!t) return [];
  const fields: Field[] = [];
  for (const [id, f] of t.numbered()) {
    const name = f.name;
    if (name === undefined) continue;
    const def = f.kv.get(2);
    const field: Field = {
      id,
      name,
      kind: (def && FIELD_KINDS[def[0]]) || 'unknown',
      type: (def && FIELD_TYPES[def[1]]) || 'unknown',
      hasCalculation: f.children.has(5),
    };
    const comment = f.text(3);
    if (comment) field.comment = comment;
    // Summary definition, key 9: type, then the summarized field as a tagged
    // reference at byte 8 (tag, length, path value). Matched by field names
    // such as "Extended Price Total" and "IdList".
    const sum = field.kind === 'summary' ? f.kv.get(9) : undefined;
    if (sum && sum.length > 10 && SUMMARY_TYPES[sum[0]]) {
      const fieldId = pathValue(sum.subarray(10, 10 + sum[9]));
      if (fieldId !== undefined) field.summary = { type: SUMMARY_TYPES[sum[0]], fieldId };
    }
    fields.push(field);
  }
  const namesById = new Map(fields.map((f) => [f.id, f.name]));
  for (const f of fields) if (f.summary) f.summary.field = namesById.get(f.summary.fieldId);
  return fields;
}

/**
 * Kind of a layout or script catalog entry, from the 8-byte value at key 240:
 * bit 0 marks a folder, 2 closes the open folder, and bit 3 appears to mean
 * "include in menu". Items named "-" are separators.
 */
function entryKind(n: Node): OrderedItem['kind'] {
  const v = n.kv.get(240);
  const name = n.name;
  if (!v) return name === '-' ? 'separator' : 'unknown';
  const t = v[v.length - 1];
  if ((t & 0x07) === 2) return 'folder-end';
  if (t & 1) return 'folder';
  return name === '-' ? 'separator' : 'item';
}

/**
 * Key 240's bit 3 is "Include in menu" unchecked, on layouts, scripts and their
 * folders alike (bit 0 marks a folder, 2 a folder's end or a separator). The
 * Flicks Design Report has its one layout with the bit, SOLUTION, as
 * includeInMenu="False" and every other layout and script as "True".
 */
function menuHidden(n: Node): boolean {
  const v = n.kv.get(240);
  return !!v?.length && (v[v.length - 1] & 0x08) !== 0;
}

function readOrder(n: Node | undefined): OrderedItem[] {
  if (!n) return [];
  const out: OrderedItem[] = [];
  let depth = 0;
  for (const [id, c] of n.numbered()) {
    const kind = entryKind(c);
    if (kind === 'folder-end') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const item: OrderedItem = { id, name: c.name ?? '', kind, depth };
    if (menuHidden(c)) item.hidden = true;
    out.push(item);
    if (kind === 'folder') depth++;
  }
  return out;
}

/** Ids of real objects (not folders or separators) per the display-order catalog. */
function itemIds(order: OrderedItem[]): Set<number> | undefined {
  if (!order.length) return undefined;
  return new Set(order.filter((o) => o.kind === 'item' || o.kind === 'unknown').map((o) => o.id));
}

function formula(tokens: Uint8Array | undefined, namer: Namers): string | undefined {
  if (!tokens?.length) return undefined;
  try {
    return decodeCalc(tokens, namer.field, namer.customFunction).text;
  } catch (error) {
    if (error instanceof CalcDecodeError) throw error;
    return undefined; // malformed or not yet understood; the rest of the schema still reads
  }
}

/** Every calculation (a node with a key-4 context and key-5 tokens) under n, in id order. */
function calculationsUnder(n: Node, namer: Namers, out: string[] = []): string[] {
  const own = n.kv.has(4) ? formula(calcTokens(n), namer) : undefined;
  if (own !== undefined) out.push(own);
  for (const [, c] of n.numbered()) calculationsUnder(c, namer, out);
  return out;
}

function readScripts(n: Node | undefined, ids: Set<number> | undefined, namer: Namers, ctx: Omit<ParamContext, 'formula' | 'scriptName'>): Script[] {
  if (!n) return [];
  const names = new Map(n.numbered().map(([id, s]) => [id, s.name ?? '']));
  const pctx: ParamContext = {
    ...ctx,
    formula: (node) => formula(calcTokens(node), namer),
    scriptName: (id) => names.get(id),
  };
  const scripts: Script[] = [];
  for (const [id, s] of n.numbered()) {
    if (ids ? !ids.has(id) : entryKind(s) !== 'item') continue;
    const raw = s.kv.get(4) ?? s.segments.get(4) ?? s.children.get(4)?.longBytes();
    const params = s.child(5);
    const steps: ScriptStep[] = [];
    if (raw) {
      // Steps are 28-byte records; the step instance id (byte 2) keys its
      // parameters at [script].5.[instance], and bytes 20-21 hold the step type.
      for (let at = 0; at + 28 <= raw.length; at += 28) {
        // Instance ids past 127 take two bytes (a path integer).
        const instance = raw[at + 2] & 0x80 ? pathValue(raw.subarray(at + 2, at + 4))! : raw[at + 2];
        const stored = (raw[at + 20] << 8) | raw[at + 21];
        const enabled = stored < 0x8000;
        const stepId = enabled ? stored : 0x10000 - stored;
        const step: ScriptStep = {
          stepId,
          name: scriptStepName(stepId),
          enabled,
        };
        const p = params?.child(instance);
        const text = p?.child(128)?.text(1);
        if (text !== undefined) step.text = text.replace(/^\t/, '');
        const calcs = p ? calculationsUnder(p, namer) : [];
        if (calcs.length) step.calculations = calcs;
        try {
          const decoded = decodeStepParams(stepId, raw.subarray(at, at + 28), p, pctx);
          if (decoded) step.params = decoded;
        } catch {
          // parameters not understood; the step still reads
        }
        step.line = stepLine(step.name, step.params, step.text);
        steps.push(step);
      }
    }
    const options = s.kv.get(241);
    scripts.push({ id, name: s.name ?? '', steps, ...(options?.length && options[options.length - 1] & 1 ? { fullAccess: true } : {}) });
  }
  return scripts;
}

function readLayouts(n: Node | undefined, ids?: Set<number>): Layout[] {
  if (!n) return [];
  const layouts: Layout[] = [];
  for (const [id, l] of n.numbered()) {
    if (ids ? !ids.has(id) : entryKind(l) !== 'item') continue;
    const layout: Layout = { id, name: l.name ?? '', labels: [] };
    // The layout's settings (protobuf, field 2) name its table occurrence. Older
    // code guessed from the field index at .1, which also lists related and global fields.
    const settings = Pb.parse(l.segments.get(2) ?? l.child(2)?.longBytes());
    const toRef = settings?.num(2);
    const to = l.child(1)?.numbered().find(([k]) => k >= 128);
    if (toRef !== undefined && toRef > 0x104000) layout.tableOccurrenceId = toRef - 0x104000;
    else if (to) layout.tableOccurrenceId = to[0];
    for (const [, obj] of l.child(5)?.numbered() ?? []) {
      const label = obj.text(1);
      if (label) layout.labels.push(label);
    }
    layouts.push(layout);
  }
  return layouts;
}

function readTableOccurrences(n: Node | undefined): TableOccurrence[] {
  if (!n) return [];
  return n.numbered().map(([id, c]) => {
    const to: TableOccurrence = { id, name: c.name ?? '' };
    const def = c.kv.get(2);
    // 02 01 <data source> 03 02 <base table as 2-byte path int> <4 x float32 graph box> ... <rgba>
    if (def && def.length >= 23 && def[4] === 2) {
      to.baseTableId = 0x80 + ((def[5] & 0x7f) << 8) + def[6];
      if (def[2]) to.dataSourceId = def[2];
      to.graph = { left: f32(def, 7), top: f32(def, 11), width: f32(def, 15), height: f32(def, 19) };
      if (def.length >= 35) to.color = '#' + [...def.subarray(def.length - 4, def.length - 1)].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
    return to;
  });
}

// Operator order follows FileMaker's relationship dialog (inferred: '=' and
// '×' match what the sample files' relationships evidently are).
const JOIN_OPERATORS: JoinOperator[] = ['=', '≠', '<', '≤', '>', '≥', '×'];

/** Tagged reference: tag byte, length byte, then a path integer. */
function readRef(b: Uint8Array, at: number): { tag: number; value: number | undefined; next: number } {
  const len = b[at + 1];
  return { tag: b[at], value: pathValue(b.subarray(at + 2, at + 2 + len)), next: at + 2 + len };
}

function readRelationships(n: Node | undefined, tos: TableOccurrence[], tables: Table[]): Relationship[] {
  if (!n) return [];
  const occurrencesById = new Map(tos.map((to) => [to.id, to]));
  const fieldsByTableId = new Map(tables.map((table) => [table.id, new Map(table.fields.map((field) => [field.id, field.name]))]));
  const fieldName = (toId: number, fieldId: number) => {
    const to = occurrencesById.get(toId);
    if (!to || to.dataSourceId) return undefined; // table lives in another file
    return fieldsByTableId.get(to.baseTableId ?? -1)?.get(fieldId);
  };
  const out: Relationship[] = [];
  for (const [id, r] of n.numbered()) {
    const def = r.kv.get(2);
    if (!def || def[0] !== 4) continue;
    // 04 03 <left TO> 04 03 <right TO> ... (longer when sorted)
    const left = readRef(def, 0);
    const right = readRef(def, left.next);
    if (left.value === undefined || right.value === undefined) continue;
    const rel: Relationship = {
      id,
      leftTableOccurrenceId: left.value,
      rightTableOccurrenceId: right.value,
      leftTableOccurrence: occurrencesById.get(left.value)?.name,
      rightTableOccurrence: occurrencesById.get(right.value)?.name,
      predicates: [],
      sorted: def.length > 22,
    };
    // The last byte holds each side's options: 01/02 delete right/left, 10/20 create right/left, 40/80 sort right/left.
    const options = def[def.length - 1];
    if (options & 0x20) rel.leftCreate = true;
    if (options & 0x10) rel.rightCreate = true;
    if (options & 0x02) rel.leftDelete = true;
    if (options & 0x01) rel.rightDelete = true;
    // Each predicate: operator byte, then the left and right field references.
    for (const [, p] of [...(r.child(3)?.kv ?? new Map())].sort((a, b) => a[0] - b[0])) {
      const lf = readRef(p, 1);
      const rf = readRef(p, lf.next);
      if (lf.value === undefined || rf.value === undefined) continue;
      rel.predicates.push({
        leftFieldId: lf.value,
        operator: JOIN_OPERATORS[p[0]] ?? '=',
        rightFieldId: rf.value,
        leftField: fieldName(left.value, lf.value),
        rightField: fieldName(right.value, rf.value),
      });
    }
    out.push(rel);
  }
  return out;
}

function readValueLists(n: Node | undefined): ValueList[] {
  if (!n) return [];
  return n.numbered().map(([id, c]) => {
    const vl: ValueList = { id, name: c.name ?? '' };
    const custom = c.textOrLong(3);
    if (custom !== undefined) vl.values = custom.split('\n');
    else {
      const field = valueListField(c.kv.get(2));
      if (field) vl.field = field;
      const external = valueListExternal(c.kv.get(2));
      if (external) vl.external = external;
    }
    return vl;
  });
}

/**
 * Key 2 of a value list using field values: 01 00 <flags>, then numbers each
 * written as <length + 1> <length> <bytes>, with 00 01 between the groups:
 * first field (occurrence, field), second field (or 0, 0), then the occurrence
 * "only related values" starts from (or 0). Type 02 is a list from another file.
 */
export function valueListField(b: Uint8Array | undefined): ValueListField | undefined {
  if (!b || b[0] !== 1) return undefined;
  const nums: number[] = [];
  for (let at = 3; at < b.length && nums.length < 5;) {
    if (b[at] === 0) { at += 2; continue; }
    const r = readRef(b, at);
    nums.push(r.value ?? 0);
    at = r.next;
  }
  const [occurrenceId, fieldId, secondOccurrenceId, secondFieldId, relatedFromId] = nums;
  if (!occurrenceId || !fieldId) return undefined;
  const out: ValueListField = { occurrenceId, fieldId };
  // The model keeps both fields in one occurrence; a second field from another one is left out.
  if (secondFieldId && secondOccurrenceId === occurrenceId) out.secondFieldId = secondFieldId;
  if (relatedFromId) out.relatedFromId = relatedFromId;
  return out;
}

/**
 * Key 2 of a list from another file: 02, the same layout as a field list with
 * every field number 0, then the data source id and that file's value list id.
 */
export function valueListExternal(b: Uint8Array | undefined): ValueList['external'] {
  if (!b || b[0] !== 2) return undefined;
  const nums: number[] = [];
  for (let at = 3; at < b.length && nums.length < 7;) {
    if (b[at] === 0) { at += 2; continue; }
    const r = readRef(b, at);
    nums.push(r.value ?? 0);
    at = r.next;
  }
  const [dataSourceId, valueListId] = nums.slice(5, 7);
  return dataSourceId && valueListId ? { dataSourceId, valueListId } : undefined;
}

function readCustomFunctions(n: Node | undefined, namer: Namers): CustomFunction[] {
  if (!n) return [];
  return n.numbered().map(([id, c]) => {
    const p = c.text(33);
    const f: CustomFunction = { id, name: c.name ?? '', parameters: p ? p.split(';').map((x) => x.trim()) : [] };
    const body = formula(calcTokens(c.child(35)), namer);
    if (body !== undefined) f.formula = body;
    return f;
  });
}

/**
 * Manage Containers › Base Directories at 38.5.[id] (four-byte ids, 0 the
 * default): key 16 the path relative to the database's folder, XOR-0x5A text
 * ("Files/Name/" in one private sample, "Name/" in another).
 */
function readContainerDirectories(n: Node | undefined): ContainerDirectory[] {
  const out: ContainerDirectory[] = [];
  for (const [k, c] of n?.children ?? []) {
    const id = typeof k === 'number' ? k : /^0x[0-9a-f]{8}$/.test(k) ? parseInt(k.slice(2), 16) : undefined;
    const path = c.text(16);
    if (id !== undefined && path !== undefined) out.push({ id, path });
  }
  return out.sort((a, b) => a.id - b.id);
}

function readDataSources(n: Node | undefined): DataSource[] {
  if (!n) return [];
  return n.numbered().map(([id, c]) => {
    // key 130: u32 count, then per path: u8 type-length, type ("file"), u16 length, path
    const paths: string[] = [];
    const raw = c.kv.get(130);
    if (raw && raw.length >= 4) {
      const b = raw.map((x) => x ^ 0x5a);
      let at = 4;
      for (let i = 0; i < u32(raw, 0) && at < b.length; i++) {
        const tl = raw[at++];
        const type = String.fromCharCode(...b.subarray(at, at + tl));
        at += tl;
        const pl = (raw[at] << 8) | raw[at + 1];
        at += 2;
        paths.push(`${type}:${decodeText(raw.subarray(at, at + pl))}`);
        at += pl;
      }
    }
    return { id, name: c.name ?? '', paths };
  });
}

/** Tree of every metadata path (catalogs and field definitions, no row data). */
export function metadataTree(file: FmpFile): Node {
  const root = buildTree(file, () => true, file.catalogChunks());
  // Each base table's field definitions live under [table].3, beside its records.
  for (const [id] of root.child(3, 16, 5)?.numbered() ?? []) {
    const fields = buildTree(file, () => true, file.chunks(undefined, [id, 3]));
    const t = fields.child(id);
    if (t) root.children.set(id, t);
  }
  return root;
}

export function readSchema(file: FmpFile): Schema {
  const root = metadataTree(file);
  const layoutOrder = readOrder(root.child(4, 1, 7));
  const scriptOrder = readOrder(root.child(17, 1, 7));
  const tables: Table[] = [];
  for (const [id, t] of root.child(3, 16, 5)?.numbered() ?? []) {
    tables.push({ id, name: t.name ?? '', fields: readFields(root.child(id, 3, 5)) });
  }
  const tableOccurrences = readTableOccurrences(root.child(3, 17, 5));
  const cfNames = new Map(root.child(16, 5)?.numbered().map(([id, c]) => [id, c.name ?? `⟨cf:${id}⟩`]) ?? []);
  const namer: Namers = {
    field: schemaFieldNamer({ tables, tableOccurrences }),
    customFunction: (id) => cfNames.get(id) ?? '<Function Missing>',
  };
  for (const t of tables) {
    for (const f of t.fields) {
      const node = root.child(t.id, 3, 5, f.id);
      const c = formula(calcTokens(node?.child(5)), namer);
      if (c !== undefined) f.calculation = c;
      // Key 4 of the calculation: a length-prefixed table occurrence reference.
      const ctx = node?.child(5)?.kv.get(4);
      const to = ctx && ctx.length > 1 ? pathValue(ctx.subarray(1, 1 + ctx[0])) : undefined;
      if (c !== undefined && to !== undefined) f.calculationContextId = to;
      const def = node?.kv.get(2);
      const opts = node && def ? readOptions(node, def, namer) : undefined;
      if (opts) f.options = opts;
    }
  }
  const layouts = readLayouts(root.child(4, 5), itemIds(layoutOrder));
  const dataSources = readDataSources(root.child(32, 5));
  const containerDirectories = readContainerDirectories(root.child(38, 5));
  const layoutsById = new Map(layouts.map((item) => [item.id, item.name]));
  const occurrencesById = new Map(tableOccurrences.map((item) => [item.id, item]));
  const tablesById = new Map(tables.map((item) => [item.id, item]));
  const fieldsByTableId = new Map(tables.map((item) => [item.id, new Map(item.fields.map((field) => [field.id, field.name]))]));
  const dataSourcesById = new Map(dataSources.map((item) => [item.id, item.name]));
  const paramCtx = {
    layoutName: (id: number) => layoutsById.get(id),
    tableOccurrenceName: (id: number) => occurrencesById.get(id)?.name,
    tableName: (id: number) => tablesById.get(id)?.name,
    fieldName: (to: number, field: number) => {
      const occurrence = occurrencesById.get(to);
      if (occurrence?.dataSourceId) return `⟨field:${field}⟩`; // lives in another file
      return fieldsByTableId.get(occurrence?.baseTableId ?? -1)?.get(field);
    },
    dataSourceName: (id: number) => dataSourcesById.get(id),
    menuSetName: (id: number) => root.child(64, 5)?.child(id)?.name,
  };
  const scripts = readScripts(root.child(17, 5), itemIds(scriptOrder), namer, paramCtx);
  const scriptsById = new Map(scripts.map((item) => [item.id, item.name]));
  const menus = readCustomMenus(
    root.child(65, 5), root.child(64, 5),
    (n) => formula(calcTokens(n), namer),
    (id) => scriptsById.get(id),
    root.child(64, 1)?.kv.get(24),
  );
  const fileOptions = readFileOptions(root.child(2)?.kv.get(24), scripts, layouts);
  const pageSetup = readPageSetup(root.child(2, 135));
  return {
    header: file.header,
    tables,
    tableOccurrences,
    relationships: readRelationships(root.child(3, 251, 5), tableOccurrences, tables),
    layouts,
    layoutOrder,
    scripts,
    scriptOrder,
    valueLists: readValueLists(root.child(33, 5)),
    customFunctions: readCustomFunctions(root.child(16, 5), namer),
    accounts: readAccounts(root.child(23, 1, 5)),
    privilegeSets: privilegeSets(root.child(23, 2, 5), root.child(23, 3, 5)),
    extendedPrivileges: items(root.child(23, 3, 5)),
    dataSources,
    ...(containerDirectories.length ? { containerDirectories } : {}),
    themes: items(root.child(6, 5)).map((t) => ({ ...t, name: root.child(6, 5, t.id)?.text(10) ?? t.name })),
    fonts: items(root.child(25, 5)),
    customMenus: menus.menus,
    customMenuSets: menus.sets,
    ...(menus.defaultSetId !== undefined ? { defaultMenuSetId: menus.defaultSetId } : {}),
    ...(fileOptions ? { fileOptions } : {}),
    ...(pageSetup ? { pageSetup } : {}),
  };
}
