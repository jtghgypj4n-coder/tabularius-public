// Accounts and privilege sets: what each account may see and change.
//
// A privilege set says, for records in each table, whether the account can
// view, edit, create and delete them (yes, no, or "limited": a calculation
// evaluated on each record), and which fields it can modify, only view, or
// not see; which layouts, value lists and scripts it can use; and which
// extended privileges (ways in: fmapp, fmrest, ...) it has.
//
// Imported files bring their privilege sets (see fmp12 schema). Tabularius
// keeps its own copy of each set in _fm_privileges once one is edited, so
// sets can be changed without FileMaker Pro. Privileges are per file, as in
// FileMaker: a layout showing a table in another hosted file uses the
// account's privileges in that file.

import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { PrivilegeSet, Schema } from '../../fmp12/src/index.ts';
import { captureAccessDenial, type AccessDenial, type AccessOperation, type AccessPermission } from './access-denial.ts';
import { validPrivilegeSetName } from './security-names.ts';

/** A named policy entry exists only when the dictionary owns it. */
export function ownPrivilegeEntry<T>(map: Record<string, T> | undefined, name: string): T | undefined {
  return map && Object.hasOwn(map, name) ? map[name] : undefined;
}

const accessLevel = (value: unknown): Level => value === 'modifiable' || value === 'viewOnly' ? value : 'none';

/** Access to a layout, value list or script. For scripts, viewOnly means "executable only". */
export type Level = 'modifiable' | 'viewOnly' | 'none';

/**
 * A field's access. `masked` is the one level only fields have: the account sees a
 * stand-in (see FieldMask) instead of the value. It can never change it, search,
 * sort or total it, or reach it through SQL, a calculation, an export or an AI tool;
 * only a record read shows the stand-in. Everywhere that asks `Privileges.field()`
 * sees `none` for a masked field, so a surface that was not taught about masking
 * hides the field instead of leaking it.
 */
export type FieldLevel = Level | 'masked';

/** What an account sees in place of a masked field: its last four characters, or a fixed text. */
export interface FieldMask {
  kind: 'last4' | 'placeholder';
  /** The text a `placeholder` mask shows (and the filler a `last4` mask shows in place of hidden characters). */
  text?: string;
}

/** The stand-in character a last4 mask puts in place of the characters it hides. */
export const MASK_FILL = '\u2022';
/** What a placeholder mask shows when the field's mask gives no text. */
export const MASK_PLACEHOLDER = MASK_FILL.repeat(4);
/** The longest a placeholder text can be, so it can't carry a value of its own. */
export const MASK_TEXT_MAX = 16;

/** true, false, or a calculation that decides per record ("limited" in FileMaker). */
export type Rule = boolean | string;

export interface TablePrivileges {
  view: Rule;
  edit: Rule;
  create: boolean;
  delete: Rule;
  /** Fields not listed are modifiable (when the record can be edited), unless `fieldsDefault` says otherwise. */
  fields?: Record<string, FieldLevel>;
  /** How each `masked` field in `fields` shows; a masked field without an entry shows its last four characters. */
  masks?: Record<string, FieldMask>;
  /**
   * What a field not listed in `fields` gets. Set to 'none' on tables imported from a custom set that
   * customises fields, so a field added to the table later starts hidden rather than modifiable.
   */
  fieldsDefault?: 'none';
}

export interface PrivilegeDefinition {
  /** Explicit AI exceptions, by base table: true for the table or a list of field names. Does not grant data access. */
  aiVisible?: Record<string, true | string[]>;
  name: string;
  /** Id in the FileMaker file. 1-3 are the built-in sets (1 = [Full Access]), whatever the file's language calls them. */
  id?: number;
  comment?: string;
  /** Records in every table without its own entry in `tables`. */
  records: TablePrivileges;
  /** Custom privileges per base table, by name. */
  tables?: Record<string, TablePrivileges>;
  /**
   * Fields the importer made inaccessible because the file's per-field access byte
   * (0x01) is only *inferred* to mean view-only, by table. An admin may knowingly
   * relax them to view-only (`relaxUnverified`); until then they are no access.
   */
  unverifiedReadOnly?: Record<string, string[]>;
  /** All layouts, unless listed in `layoutAccess`. */
  layouts: Level;
  /** Per layout: the layout itself, and records through it. */
  layoutAccess?: Record<string, { layout: Level; records: Level }>;
  valueLists: Level;
  valueListAccess?: Record<string, Level>;
  scripts: Level;
  scriptAccess?: Record<string, Level>;
  /**
   * Which menu commands the client makes available, as in FileMaker's "Available
   * menu commands": `all`, `editing` (commands that change record data but not
   * the found set or structure), or `minimum` (navigation and viewing only).
   * A guard on what the UI offers, not a security boundary — record, field,
   * layout and script privileges are enforced on every surface regardless.
   * Absent means `all`.
   */
  menuCommands?: 'all' | 'editing' | 'minimum';
  /**
   * Key-10 "other options" from the file, decoded by the fmp12 reader. Each is
   * absent on sets converted before they were decoded; absent means allowed
   * (FileMaker's default), so enforcement only ever denies on an explicit false.
   */
  /** Allow printing and Save Records as PDF (key 10, 0x0100). */
  printing?: boolean;
  /** Allow exporting records and Save a Copy of the file (key 10, 0x0200). */
  exporting?: boolean;
  /** Allow the account holder to change their own password (key 10, 0x0004). */
  allowModifyPassword?: boolean;
  /** Disconnect the session from the host when idle (key 10): on by default. */
  idleDisconnect?: boolean;
  /** Extended privilege keywords: fmapp, fmwebdirect, fmrest, fmxml, fmmcp (AI access, new in Tabularius), ... */
  extendedPrivileges: string[];
}

export type MenuCommandLevel = 'all' | 'editing' | 'minimum';

export const FULL_ACCESS = '[Full Access]';

/**
 * Extended privileges Tabularius itself understands as "ways in" (fmapp: the web
 * client and Data API, fmwebdirect: the same, fmxml: the XML publishing surfaces,
 * fmrest: the REST-style Data API, fmmcp: AI/MCP tools, fmurlscript: running a script from a WebDirect-style link), offered to every file
 * whether or not its own catalog (Schema.extendedPrivileges) lists them. A
 * custom extended privilege can't take one of these names.
 */
export const BUILT_IN_EXTENDED_PRIVILEGES = ['fmapp', 'fmwebdirect', 'fmrest', 'fmxml', 'fmmcp', 'fmurlscript'] as const;

const ALL: TablePrivileges = { view: true, edit: true, create: true, delete: true };
const VIEW: TablePrivileges = { view: true, edit: false, create: false, delete: false };
export const NO_ACCESS: TablePrivileges = { view: false, edit: false, create: false, delete: false };

/** FileMaker's built-in sets, for stores converted before privilege details were decoded. */
const BUILT_IN: Record<number, Omit<PrivilegeDefinition, 'name' | 'extendedPrivileges'>> = {
  1: { records: ALL, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable' },
  2: { records: ALL, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly' },
  3: { records: VIEW, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly' },
};

/** [Full Access], by id (files in other languages name it differently) or by name. */
export function isFullAccess(p: { id?: number; name: string }): boolean {
  return p.id === 1 || p.name === FULL_ACCESS;
}

/** A privilege set as decoded from an .fmp12 file. */
export function fromFmp12(p: PrivilegeSet | { id: number; name: string }, schema?: Schema): PrivilegeDefinition {
  if (!('records' in p)) {
    // Converted by an older version: only the name is known.
    const b = BUILT_IN[p.id];
    return b ? { name: p.name, id: p.id, ...b, extendedPrivileges: [] }
      : { name: p.name, id: p.id, records: NO_ACCESS, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] };
  }
  const r = p.records;
  const custom = p.customRecordAccess === true ? customAccess(p, schema) : undefined;
  return {
    name: p.name,
    id: p.id,
    ...(p.comment ? { comment: p.comment } : {}),
    // A set on "Custom privileges" has no meaningful file-level record access: a
    // table it doesn't list gets none.
    // Edit and delete need view, as they do per table (customAccess): a record nobody can see is not one to change.
    records: custom ? { ...NO_ACCESS } : { view: r.view, edit: r.view && r.edit, create: r.create, delete: r.view && r.delete },
    ...(custom && Object.keys(custom.tables).length ? { tables: custom.tables } : {}),
    ...(custom && Object.keys(custom.unverifiedReadOnly).length ? { unverifiedReadOnly: custom.unverifiedReadOnly } : {}),
    layouts: p.layouts,
    valueLists: p.valueLists,
    scripts: p.scripts,
    // Carry the decoded key-10 options through so a set that forbids printing,
    // exporting, self-password-change or idle-disconnect keeps that restriction
    // instead of silently regaining the capability on import.
    ...(p.printing !== undefined ? { printing: p.printing } : {}),
    ...(p.exporting !== undefined ? { exporting: p.exporting } : {}),
    ...(p.allowModifyPassword !== undefined ? { allowModifyPassword: p.allowModifyPassword } : {}),
    ...(p.idleDisconnect !== undefined ? { idleDisconnect: p.idleDisconnect } : {}),
    extendedPrivileges: [...p.extendedPrivileges],
  };
}

/** How a custom set's per-table and per-field access was mapped, and what could not be (for the conversion report). */
export interface CustomAccessMapping {
  tables: Record<string, TablePrivileges>;
  /** table -> fields whose byte is 0x01 (inferred view-only) but imported as no access. */
  unverifiedReadOnly: Record<string, string[]>;
  /** table -> fields imported as no access (any byte other than 0x03, or not listed when the table customises fields). */
  hiddenFields: Record<string, string[]>;
  /** Listed base-table ids the file has no table for (external, or a stale id): imported as no access. */
  unresolvedTables: number[];
}

/**
 * Maps a custom-record-access set onto per-table definitions, failing closed:
 * - a table the set does not list has no access (the file-level record access is none);
 * - when a table customises fields, only a field whose raw byte is exactly 0x03
 *   (read/write) stays accessible. Any other byte, and any field of the table
 *   the set does not list, is no access: the 0x01-means-view-only reading is
 *   inferred, not pinned, so an admin must relax it knowingly (see `unverifiedReadOnly`);
 * - without the schema nothing can be named, so nothing is granted.
 */
export function customAccess(p: PrivilegeSet, schema?: Schema): CustomAccessMapping {
  const out: CustomAccessMapping = { tables: {}, unverifiedReadOnly: {}, hiddenFields: {}, unresolvedTables: [] };
  for (const tr of p.tableRecords ?? []) {
    const table = schema?.tables.find((t) => t.id === tr.tableId);
    if (!table) { out.unresolvedTables.push(tr.tableId); continue; }
    if (out.tables[table.name]) {
      // Listed twice: the file is ambiguous, so the table gets no access at all.
      out.tables[table.name] = { view: false, edit: false, create: false, delete: false, fields: {}, fieldsDefault: 'none' };
      continue;
    }
    const view = tr.records.view === true;
    const t: TablePrivileges = { view, edit: view && tr.records.edit === true, create: tr.records.create === true, delete: view && tr.records.delete === true };
    if (tr.fields) {
      const byId = new Map(tr.fields.map((f) => [f.fieldId, f]));
      const fields: Record<string, Level> = {};
      for (const f of table.fields) {
        const listed = byId.get(f.id);
        if (listed && listed.access === 0x03) { fields[f.name] = 'modifiable'; continue; } // read/write
        fields[f.name] = 'none';
        (out.hiddenFields[table.name] ??= []).push(f.name);
        if (listed && listed.view && !listed.edit) (out.unverifiedReadOnly[table.name] ??= []).push(f.name);
      }
      t.fields = fields;
      // Fields added to the table after the import are not in the file's list either: hidden until granted.
      t.fieldsDefault = 'none';
    }
    out.tables[table.name] = t;
  }
  return out;
}

/**
 * What a privilege set lets an account do, as a value that changes only when that does: not the idle-disconnect
 * option, the comment, the extended privileges (an open session may only lose those) or the unverified-read-only
 * marker. A field listed at the table's own default level says nothing the default does not, so it is left out:
 * a field added or renamed in a table a file-defined set lists then changes nobody's authority.
 */
export function authorityOf(set: PrivilegeDefinition): Omit<PrivilegeDefinition, 'extendedPrivileges' | 'idleDisconnect' | 'comment' | 'unverifiedReadOnly'> {
  const { extendedPrivileges: _extended, idleDisconnect: _idle, comment: _comment, unverifiedReadOnly: _marker, ...authority } = set;
  if (authority.tables) {
    authority.tables = Object.fromEntries(Object.entries(authority.tables).map(([table, t]) => [table, !t.fields || t.fieldsDefault === undefined ? t
      : { ...t, fields: Object.fromEntries(Object.entries(t.fields).filter(([, level]) => level !== t.fieldsDefault)) }]));
  }
  return authority;
}

export class PrivilegeError extends Error {
  readonly code: number;
  readonly denial?: AccessDenial;
  constructor(code: number, message: string, denial?: AccessDenial) {
    super(message);
    this.code = code;
    this.denial = denial;
  }
}

/**
 * What one account may do in one file. `evaluate` decides "limited" rules:
 * it gets the formula, the base table and a record id.
 */
/**
 * Where a file counts the layouts and scripts an account actually opens or runs (Store.recordObjectUse), for least
 * privilege to tell which of a set's layout and script grants go unused. Keyed by the file, as Privileges.file is.
 */
const objectUse = new WeakMap<object, (account: string, set: string, kind: 'layout' | 'script', name: string) => void>();

export function countObjectUse(file: object, sink: (account: string, set: string, kind: 'layout' | 'script', name: string) => void): void {
  objectUse.set(file, sink);
}

export class Privileges {
  readonly account: string;
  /** The external mapping this session signed in through, when it did (a directory or identity-provider sign-in). */
  via?: string;
  readonly set: PrivilegeDefinition;
  /** The file (store) these privileges are for. */
  readonly file: unknown;
  private readonly other: (file: unknown) => Privileges;
  private readonly captureDenials: boolean;
  /** A token's independent ceiling, reapplied after script elevation or a change of account. */
  readonly ceiling?: (privileges: Privileges) => Privileges;

  constructor(account: string, set: PrivilegeDefinition, file: unknown, other: (file: unknown) => Privileges, captureDenials = true, ceiling?: (privileges: Privileges) => Privileges) {
    this.account = account;
    this.set = set;
    this.file = file;
    this.other = other;
    this.captureDenials = captureDenials;
    this.ceiling = ceiling;
  }

  /** The account whose row decides whether a container link made for this session still works: the mapping for an external sign-in. */
  get linkPrincipal(): string { return this.via ?? this.account; }

  withVia(via: string | undefined): this {
    this.via = via;
    return this;
  }

  /** Carries a ceiling into other files without changing this file's account rules or denial attribution. */
  withCeiling(ceiling: (privileges: Privileges) => Privileges): Privileges {
    return new Privileges(this.account, this.set, this.file, (file) => ceiling(this.in(file)), this.captureDenials, ceiling).withVia(this.via);
  }

  /** The same account's privileges in another hosted file (no access when it has no account there). */
  in(file: unknown): Privileges {
    return file === this.file ? this : this.other(file);
  }

  get name(): string {
    return this.set.name;
  }

  /** Identifies what the set allows, so a result kept for the account is never reused after its privileges change. */
  get fingerprint(): string {
    return (this.print ??= createHash('sha256').update(JSON.stringify(this.set)).digest('hex').slice(0, 16));
  }

  private print?: string;

  /** Full Access: no checks at all. */
  get full(): boolean {
    return isFullAccess(this.set);
  }

  /** Can read every record and field of every table (so raw SQL and free-form formulas reveal nothing more). */
  get readsEverything(): boolean {
    if (this.full) return true;
    const open = (t: TablePrivileges) => t.view === true && t.fieldsDefault !== 'none' && Object.values(t.fields ?? {}).every((l) => l === 'modifiable' || l === 'viewOnly');
    return open(this.set.records) && Object.values(this.set.tables ?? {}).every(open);
  }

  has(extended: string): boolean {
    return this.full && extended === 'fmmcp' ? true : this.set.extendedPrivileges.some((e) => e.toLowerCase() === extended.toLowerCase());
  }

  layout(name: string): { layout: Level; records: Level } {
    if (this.full) return { layout: 'modifiable', records: 'modifiable' };
    const entry = ownPrivilegeEntry(this.set.layoutAccess, name);
    const level = accessLevel(this.set.layouts);
    return entry ? { layout: accessLevel(entry.layout), records: accessLevel(entry.records) }
      : { layout: level, records: level === 'none' ? 'none' : 'modifiable' };
  }

  script(name: string): Level {
    if (this.full) return 'modifiable';
    return accessLevel(ownPrivilegeEntry(this.set.scriptAccess, name) ?? this.set.scripts);
  }

  valueList(name: string): Level {
    if (this.full) return 'modifiable';
    return accessLevel(ownPrivilegeEntry(this.set.valueListAccess, name) ?? this.set.valueLists);
  }

  /** Which menu commands the client should offer; [Full Access] always gets them all. */
  get menuCommands(): MenuCommandLevel {
    if (this.full) return 'all';
    return this.set.menuCommands ?? 'all';
  }

  /** May print or Save Records as PDF (allowed unless the set explicitly forbids it). */
  get canPrint(): boolean {
    return this.full || this.set.printing !== false;
  }

  /** May export records (CSV/XLSX/tab). Raw SQLite backups require Full Access. */
  get canExport(): boolean {
    return this.full || this.set.exporting !== false;
  }

  /** May change its own password. */
  get canModifyPassword(): boolean {
    return this.full || this.set.allowModifyPassword !== false;
  }

  /** Whether the session is disconnected when idle (on by default; honours the set even for full access). */
  get idleDisconnect(): boolean {
    return this.set.idleDisconnect !== false;
  }

  table(name: string): TablePrivileges {
    if (this.full) return ALL;
    return ownPrivilegeEntry(this.set.tables, name) ?? this.set.records;
  }

  /** Refuse an impossible import before reading its source; limited edit rules still run per record. */
  checkImport(table: string, action: 'add' | 'update' | 'replace' | 'plan' = 'add', addRemaining = false): void {
    const { create, edit } = this.table(table);
    const permission = action === 'add' || action === 'plan' ? 'create' : 'edit';
    const denied = action === 'plan' ? create === false && edit === false
      : action === 'add' ? create === false : edit === false && (!addRemaining || create === false);
    if (denied) {
      throw new PrivilegeError(200, 'Record access is denied', this.recordDenial(table, permission, permission));
    }
    // Planning has no action yet. Update/Replace with addRemaining can do either
    // kind of write; per-record checks skip whichever rows the account cannot write.
  }

  /**
   * What the account may do with a field's value: modifiable, viewOnly or none. A masked field is `none`, so
   * every surface that has not been taught about masking hides it rather than showing the value; only a
   * record read asks `fieldAccess` and shows the stand-in.
   */
  field(table: string, field: string): Level {
    const l = this.fieldAccess(table, field);
    return l === 'masked' ? 'none' : l;
  }

  /** `field`, but telling masked from hidden. */
  fieldAccess(table: string, field: string): FieldLevel {
    if (this.full) return 'modifiable';
    const t = this.table(table);
    if (t.view === false) return 'none';
    const level = ownPrivilegeEntry(t.fields, field) ?? (t.fieldsDefault === 'none' ? 'none' : 'modifiable');
    return level === 'masked' ? level : accessLevel(level);
  }

  /** The mask a field shows through, when it is masked for this account. */
  mask(table: string, field: string): FieldMask | undefined {
    if (this.fieldAccess(table, field) !== 'masked') return undefined;
    return ownPrivilegeEntry(this.table(table).masks, field) ?? { kind: 'last4' };
  }

  denial(operation: AccessOperation, permission: AccessPermission, source: AccessDenial['source'], location: string,
    ruleKind: AccessDenial['ruleKind'], outcome: AccessDenial['outcome'] = 'false'): AccessDenial | undefined {
    if (!this.captureDenials) return undefined;
    const file = this.file as { name?: unknown } | undefined;
    return captureAccessDenial({ ...(typeof file?.name === 'string' ? { database: file.name } : {}),
      privilegeSet: this.name, operation, permission, source, location, ruleKind, outcome, policyFingerprint: this.fingerprint }, this.file, this.account);
  }

  recordDenial(table: string, operation: AccessOperation, permission: 'view' | 'edit' | 'create' | 'delete', outcome: AccessDenial['outcome'] = 'false'): AccessDenial | undefined {
    const source = ownPrivilegeEntry(this.set.tables, table) ? 'table' : 'records';
    return this.denial(operation, permission, source, `${source === 'table' ? `tables.${table}` : 'records'}.${permission}`,
      typeof this.table(table)[permission] === 'string' ? 'limited' : 'none', outcome);
  }

  fieldDenial(table: string, field: string, operation: AccessOperation): AccessDenial | undefined {
    const t = this.table(table);
    const explicit = ownPrivilegeEntry(t.fields, field) !== undefined;
    const location = ownPrivilegeEntry(this.set.tables, table) ? `tables.${table}` : 'records';
    return this.denial(operation, 'field-write', explicit ? 'field' : 'fieldsDefault',
      `${location}.${explicit ? `fields.${field}` : 'fieldsDefault'}`, 'view-only');
  }

  extendedDenial(keywords: string[]): AccessDenial | undefined {
    const denial = this.denial('connect', 'extended-privilege', 'extendedPrivileges', `extendedPrivileges.${keywords.join('|')}`, 'missing');
    return denial && captureAccessDenial({ ...denial, requiredPrivileges: Object.freeze([...keywords]) }, this.file, this.account);
  }

  /** Throws unless the layout can be used (and, with `write`, records changed through it). */
  checkLayout(name: string, write = false): void {
    const l = this.layout(name);
    if (l.layout === 'none') throw new PrivilegeError(105, `Layout "${name}" is missing`);
    if (write && l.records !== 'modifiable') throw new PrivilegeError(200, `Record access is denied: layout "${name}" is view only`,
      this.denial('write', 'layout-write', ownPrivilegeEntry(this.set.layoutAccess, name) ? 'layout' : 'layouts',
        ownPrivilegeEntry(this.set.layoutAccess, name) ? `layoutAccess.${name}.records` : 'layouts', l.records === 'none' ? 'none' : 'view-only'));
    this.used('layout', name);
  }

  checkScript(name: string): void {
    if (this.script(name) === 'none') throw new PrivilegeError(9, `Insufficient privileges to run script "${name}"`,
      this.denial('run', 'script-start', ownPrivilegeEntry(this.set.scriptAccess, name) !== undefined ? 'script' : 'scripts',
        ownPrivilegeEntry(this.set.scriptAccess, name) !== undefined ? `scriptAccess.${name}` : 'scripts', 'none'));
    this.used('script', name);
  }

  /**
   * A layout opened or a script run under these privileges, counted for least privilege. Not for Full Access (it has
   * no grants to trim), nor for privileges no one signed in with: a set viewed as in the admin console ("[view as …]")
   * or one worked out with no account.
   */
  private used(kind: 'layout' | 'script', name: string): void {
    if (this.full || !this.account || this.account.startsWith('[view as ') || typeof this.file !== 'object' || this.file === null) return;
    // With the set it was used under: an account signed in through an external group has that group's set, not its own.
    objectUse.get(this.file)?.(this.account, this.set.name, kind, name);
  }
}

/**
 * What a masked value shows. Empty stays empty (masking hides a value, not that there is one); a placeholder
 * mask shows its text whatever the value. A last4 mask shows the last four characters with every other
 * letter or digit replaced, keeping punctuation so "123-45-6789" reads "•••-••-6789", but
 * never shows more than half of a short value, so a 4-digit code is not shown whole.
 */
export function maskValue(value: unknown, mask: FieldMask = { kind: 'last4' }): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (text === '') return '';
  if (mask.kind === 'placeholder') return mask.text ? mask.text : MASK_PLACEHOLDER;
  const chars = [...text];
  // Only separators between words and digits stay; marks, symbols and underscores are hidden like letters.
  const word = (c: string) => !/[\p{Z}\p{P}\p{C}]/u.test(c) || c === '_';
  const total = chars.filter(word).length;
  let keep = Math.min(4, Math.floor(total / 2));
  const fill = mask.text ? [...mask.text][0]! : MASK_FILL;
  const out: string[] = [];
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i]!;
    if (!word(c)) out.push(c);
    else if (keep > 0) { out.push(c); keep--; } else out.push(fill);
  }
  return out.reverse().join('');
}

/** Privilege sets of a store: imported ones, overridden by those saved in Tabularius. */
export function privilegeSets(sql: DatabaseSync, schema: Schema): PrivilegeDefinition[] {
  const saved = new Map((sql.prepare('SELECT name, json FROM _fm_privileges').all() as { name: string; json: string }[])
    .map((r) => [r.name.toLowerCase(), JSON.parse(r.json) as PrivilegeDefinition]));
  const out: PrivilegeDefinition[] = [];
  for (const p of schema.privilegeSets) {
    const override = saved.get(p.name.toLowerCase());
    out.push(override ? withFileOptions(override, p) : fromFmp12(p, schema));
    saved.delete(p.name.toLowerCase());
  }
  return [...out, ...saved.values()];
}

/**
 * A set saved in Tabularius before the key-10 options were carried over lacks them, which would read as
 * "allowed". Fill each missing option from the file's own set of the same name, so an upgrade never turns a
 * restriction the file set into a permission.
 */
function withFileOptions(saved: PrivilegeDefinition, file: PrivilegeSet | { id: number; name: string }): PrivilegeDefinition {
  if (!('records' in file)) return saved;
  const out = { ...saved };
  for (const k of ['printing', 'exporting', 'allowModifyPassword', 'idleDisconnect'] as const) {
    if (out[k] === undefined && file[k] !== undefined) out[k] = file[k];
  }
  return out;
}

/** Creates the tables privileges need in a store converted before they existed. */
export function ensurePrivilegeTables(sql: DatabaseSync): void {
  sql.exec('CREATE TABLE IF NOT EXISTS _fm_privileges (name TEXT PRIMARY KEY, json TEXT NOT NULL)');
  const cols = sql.prepare('PRAGMA table_info(_fm_accounts)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'privilege_set')) sql.exec('ALTER TABLE _fm_accounts ADD COLUMN privilege_set TEXT');
  if (!cols.some((c) => c.name === 'inactive')) sql.exec('ALTER TABLE _fm_accounts ADD COLUMN inactive INTEGER NOT NULL DEFAULT 0');
  // Password policy (see Store.passwordPolicy): whether a change is owed on next
  // sign-in, and when the password was last set (to measure expiry against).
  if (!cols.some((c) => c.name === 'must_change')) sql.exec('ALTER TABLE _fm_accounts ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0');
  if (!cols.some((c) => c.name === 'password_changed')) sql.exec('ALTER TABLE _fm_accounts ADD COLUMN password_changed TEXT');
  // Per-account opt-in sign-in restrictions (both off by default, so existing
  // files are unchanged): local_only refuses sign-in from a non-loopback
  // address; require_2fa refuses sign-in without a confirmed second factor.
  if (!cols.some((c) => c.name === 'local_only')) sql.exec('ALTER TABLE _fm_accounts ADD COLUMN local_only INTEGER NOT NULL DEFAULT 0');
  if (!cols.some((c) => c.name === 'require_2fa')) sql.exec('ALTER TABLE _fm_accounts ADD COLUMN require_2fa INTEGER NOT NULL DEFAULT 0');
  // Stable account identity lets sessions distinguish a deleted mapping from a
  // later account recreated under the same name.
  if (!cols.some((c) => c.name === 'identity_id')) sql.exec('ALTER TABLE _fm_accounts ADD COLUMN identity_id TEXT');
}

/** Checks a definition's shape before saving it (it comes from people and AI tools). */
export function validateDefinition(d: unknown): PrivilegeDefinition {
  const bad = (m: string): never => {
    throw new PrivilegeError(960, `Invalid privilege set: ${m}`);
  };
  if (!d || typeof d !== 'object') bad('expected an object');
  const p = d as PrivilegeDefinition;
  if (!validPrivilegeSetName(p.name)) bad('name is invalid');
  if (p.id !== undefined && (!Number.isInteger(p.id) || p.id < 1)) bad('id must be a positive whole number');
  if (p.aiVisible !== undefined) {
    if (!p.aiVisible || typeof p.aiVisible !== 'object' || Array.isArray(p.aiVisible) ||
      Object.values(p.aiVisible).some((v) => v !== true && (!Array.isArray(v) || v.some((f) => typeof f !== 'string' || !f)))) bad('aiVisible must map table names to true or field-name lists');
  }
  if (isFullAccess(p)) {
    // Only its extended privileges can change: [Full Access] always has every other
    // access privilege (printing/exporting/password are forced allowed by the oracle).
    // idle-disconnect is not an access grant and is honoured even for full access, so
    // keep an explicit setting rather than silently dropping it.
    if (!Array.isArray(p.extendedPrivileges) || p.extendedPrivileges.some((e) => typeof e !== 'string')) bad('extendedPrivileges must be a list of keywords');
    if (p.idleDisconnect !== undefined && typeof p.idleDisconnect !== 'boolean') bad('idleDisconnect must be true or false');
    return { name: p.name, id: 1, ...BUILT_IN[1], ...(p.aiVisible ? { aiVisible: p.aiVisible } : {}), ...(p.comment ? { comment: p.comment } : {}), ...(p.idleDisconnect !== undefined ? { idleDisconnect: p.idleDisconnect } : {}), extendedPrivileges: p.extendedPrivileges };
  }
  const level = (v: unknown, what: string) => {
    if (v !== 'modifiable' && v !== 'viewOnly' && v !== 'none') bad(`${what} must be modifiable, viewOnly or none`);
  };
  const rule = (v: unknown, what: string) => {
    if (typeof v !== 'boolean' && typeof v !== 'string') bad(`${what} must be true, false or a calculation`);
  };
  const table = (t: TablePrivileges, what: string) => {
    if (!t || typeof t !== 'object') bad(`${what} must be an object`);
    rule(t.view, `${what}.view`);
    rule(t.edit, `${what}.edit`);
    rule(t.delete, `${what}.delete`);
    if (typeof t.create !== 'boolean') bad(`${what}.create must be true or false`);
    for (const [f, l] of Object.entries(t.fields ?? {})) {
      if (l !== 'masked') level(l, `${what}.fields.${f}`);
    }
    for (const [f, m] of Object.entries(t.masks ?? {})) {
      if (ownPrivilegeEntry(t.fields, f) !== 'masked') bad(`${what}.masks.${f} is for a field that is not masked`);
      if (!m || (m.kind !== 'last4' && m.kind !== 'placeholder')) bad(`${what}.masks.${f}.kind must be last4 or placeholder`);
      if (m.text !== undefined && (typeof m.text !== 'string' || [...m.text].length > MASK_TEXT_MAX)) bad(`${what}.masks.${f}.text must be text of at most ${MASK_TEXT_MAX} characters`);
    }
    if (t.fieldsDefault !== undefined && t.fieldsDefault !== 'none') bad(`${what}.fieldsDefault must be none`);
  };
  table(p.records, 'records');
  for (const [n, t] of Object.entries(p.tables ?? {})) table(t, `tables.${n}`);
  level(p.layouts, 'layouts');
  level(p.valueLists, 'valueLists');
  level(p.scripts, 'scripts');
  for (const [n, l] of Object.entries(p.layoutAccess ?? {})) {
    level(l?.layout, `layoutAccess.${n}.layout`);
    level(l?.records, `layoutAccess.${n}.records`);
  }
  for (const [n, l] of Object.entries(p.valueListAccess ?? {})) level(l, `valueListAccess.${n}`);
  for (const [n, l] of Object.entries(p.scriptAccess ?? {})) level(l, `scriptAccess.${n}`);
  if (p.menuCommands !== undefined && p.menuCommands !== 'all' && p.menuCommands !== 'editing' && p.menuCommands !== 'minimum') {
    bad('menuCommands must be all, editing or minimum');
  }
  for (const k of ['printing', 'exporting', 'allowModifyPassword', 'idleDisconnect'] as const) {
    if (p[k] !== undefined && typeof p[k] !== 'boolean') bad(`${k} must be true or false`);
  }
  if (p.unverifiedReadOnly !== undefined) {
    const u = p.unverifiedReadOnly as unknown;
    if (!u || typeof u !== 'object' || Array.isArray(u) || Object.values(u as object).some((v) => !Array.isArray(v) || v.some((f) => typeof f !== 'string'))) {
      bad('unverifiedReadOnly must map table names to lists of field names');
    }
  }
  if (!Array.isArray(p.extendedPrivileges) || p.extendedPrivileges.some((e) => typeof e !== 'string')) bad('extendedPrivileges must be a list of keywords');
  return p;
}

/**
 * The admin's knowing relaxation of an unverified mapping: fields the importer hid
 * because their byte (0x01) is only inferred to mean view-only become view-only.
 * A field whose current level is no longer 'none' (the admin already changed it) is left alone.
 */
export function relaxUnverified(d: PrivilegeDefinition): { def: PrivilegeDefinition; relaxed: number } {
  let relaxed = 0;
  const tables: Record<string, TablePrivileges> = { ...(d.tables ?? {}) };
  for (const [table, names] of Object.entries(d.unverifiedReadOnly ?? {})) {
    const t = ownPrivilegeEntry(tables, table);
    if (!t?.fields) continue;
    const fields = { ...t.fields };
    for (const n of names) if (ownPrivilegeEntry(fields, n) === 'none') { fields[n] = 'viewOnly'; relaxed++; }
    tables[table] = { ...t, fields };
  }
  const { unverifiedReadOnly: _gone, ...rest } = d;
  return { def: { ...rest, ...(d.tables ? { tables } : {}) }, relaxed };
}
