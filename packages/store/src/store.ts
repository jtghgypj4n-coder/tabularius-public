// An imported solution, opened for reading and writing. Values cross this
// API in FileMaker's shapes: field names, repetitions as "Field(2)", and
// dates in US (M/D/YYYY) or ISO format.

import { cleanSql, sqlName, sqlTokens } from './sql-tokens.ts';
import { SignInFailures, LOCKOUT, NO_ADDRESS_BUDGET, addressBucket, accountsSharingLockout, lockoutName } from './sign-in-failures.ts';
import { expiryClock } from './clock.ts';
import { crashPoint } from './crash-point.ts';
import { atomicWrite, syncPath } from './durable.ts';
import { ensureCacheVersions, ensureContainerVersions } from './cache-versions.ts';
import { PreparedCache } from './preparation.ts';
import { rethrowExecutionRefusal } from '../../calc/src/execution-refusal.ts';
import { SQL_DATE_FUNCTIONS, placeholders, oneStatement } from './sql-dates.ts';
import { DatabaseSync, backup, type Session, type StatementSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import { createHash, createHmac, pbkdf2Sync, scrypt, scryptSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { basename, dirname, extname, join, relative, resolve, isAbsolute } from 'node:path';
import { closeSync, constants as fsConstants, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { externalFieldNames, parseDate, parseTime, parseTimestamp, type DateStyle, type Field, type FieldType, type LayoutDesign, type LayoutDesigns, type LayoutObject, type Schema, type Table } from '../../fmp12/src/index.ts';
import { findWhere, registerFindFunctions, beginFindBudget, FindError, type RelatedCriteria, type FieldInfo, type FindRequest, type SqlValue, type WordIndex } from './find.ts';
import { defineFold, WordIndexes, wordIndexName } from './words.ts';
import { q, dataSourceFile, SQL_TYPES, DESIGN_LOG, writeDesign, addExternalSizeColumn } from './import.ts';
import { decimalKey, decimalNumberText, nativeValue } from './native-types.ts';
import { Calculations, ValidationError, rowsById, sortKeyFunction, summaryColumns, summaryType, summedFor, type Pass, type Rec, type Row, type Summed, type EditedRecord } from './calc.ts';
import { asBoolean, asNumberOrEmpty, asText, CalcError, compare, decimalSum, editRuns, evaluate as evaluateFormula, fromStored, isEmpty, toStored, type CalcContext, type InstalledPlugin, type PluginFunction, type StyleRun, type Value } from '../../calc/src/index.ts';
import { foldCase, recordSortKey, recordSortLanguage, SORT_LANGUAGE_IDS, sortFunction, sortKey, sortLanguage } from '../../calc/src/collation.ts';
import { valueListOrder } from './value-list-sort.ts';
import { languageOrderBy } from './sql-language-order.ts';
import { authorityOf, countObjectUse, ensurePrivilegeTables, isFullAccess, privilegeSets, relaxUnverified, validateDefinition, Privileges, PrivilegeError, NO_ACCESS, maskValue, type FieldMask, type PrivilegeDefinition, type Rule } from './privileges.ts';
import { accessReport, explainAccess, diffPrivilegeSet, testAccount, type AccessReport, type AccessExplanation, type SetChange, type AccountTest } from './access-report.ts';
import { accessDenialContext, denialAuditDetail, denialAuditSuppressed, type AccessDenial, type DenialAudit, type AccessOperation, type RuleOutcome } from './access-denial.ts';
import { applyOps, DesignError, type DeletedDesign, type DesignOp, type Effect } from './design.ts';
import { occurrence, occurrenceByName, firstRelatedEach, relatedIdList, relatedKeys, relatedRows, type Occurrence, type RelatedResult } from './related.ts';
import { DESIGN_TABLE, DESIGN_SCRIPTS, DESIGN_TABLES, RecordLocks, writer, type Change, type ChangeKind, type Transaction } from './activity.ts';
import { accountCollisionKey, accountKey, AccountImportError, ensureAccountImportTables, importDigest, isRecoveryAdministrator, parseAccountCsv, planAccountImport, type ImportAccount, type AccountImportPreview, type AccountImportResult } from './account-provisioning.ts';
import { checkTotp, generateTotpSecret, totpUri } from './totp.ts';
import { verifyRegistration, verifyAssertion, type RegisteredCredential } from './webauthn.ts';
import { existingDirectoryLinks, safeExistingPath, safeWritePath } from './safe-path.ts';
import { ensureRecordChain, linkRecordEntry, pruneRecordEntries, verifyRecordAudit, type RecordAuditVerification } from './record-chain.ts';
import { ensureSecurityChain, appendSecurityEvent, securityWrite, verifySecurityAudit, type SecurityAuditVerification } from './security-chain.ts';

export { FindError, type FindRequest };

/** Error with a FileMaker Data API error code. */
import { checkMemory, PendingApprovalError, StoreError } from './errors.ts';
import { watchDatabase, type DamageWatch, type DiskTrouble, type FileDamaged } from './damage.ts';
import { formulaShape, statements, traceDatabase, traceField, tracing } from './trace.ts';
import { ResultCache } from './results.ts';
import { cleanScriptTest, SCRIPT_TEST_LIMIT, type ScriptTest } from './script-tests.ts';
import { ensureTextStyles, repetitionText, TextStyles } from './text-styles.ts';
import { checkFormat, storedFormat } from './store-format.ts';
export { StoreError, PendingApprovalError };

export interface AccountMutationAudit { account?: string; by?: string; detail?: Record<string, unknown> }

export type DateFormat = 'us' | 'iso';
export type FieldData = Record<string, string | number>;

export interface StoredRecord {
  recordId: number;
  modId: number;
  fieldData: FieldData;
  /** Related records shown in the layout's portals, by portal name (Data API shape). */
  portalData?: Record<string, PortalRow[]>;
  /**
   * Fields showing a result from just before the latest change (a summary or
   * ExecuteSQL result the background warmer is working out again): shown as
   * "updating". Absent when every value is current.
   */
  updating?: string[];
  /**
   * Formatting on parts of text values (a calculation's TextColor or TextStyleAdd), by field: runs of
   * characters with their font, size, color and styles. Absent when no value has any (not in FileMaker's Data API).
   */
  styles?: Record<string, StyleRun[]>;
  /** The same for portal rows: by portal name, then the row's record id, then "TO::Field". */
  portalStyles?: Record<string, Record<string, Record<string, StyleRun[]>>>;
}

/** Summary values over a found set, and which of them are from before the latest change. */
// Names address displayed values; numeric field IDs address fraction denominators.
// Separate key types keep user-defined names from colliding with internal metadata.
type Summaries = Map<string | number, SqlValue> & { updating?: Set<string>; running?: Map<string, Map<number, number>> };

/** A related record in a portal: its fields are keyed "TableOccurrence::Field". */
export type PortalRow = { recordId: string; modId: string } & Record<string, string | number>;

/** What a layout shows beyond its own table: portals and related fields. */
export interface LayoutPlan {
  occurrenceId: number;
  portals: {
    name: string; occurrenceId: number; occurrence: string; fields: string[];
    /** Fields in the portal from occurrences related to the portal's own: each row shows its first related record. */
    related?: { occurrenceId: number; occurrence: string; fields: string[] }[];
    /** The portal's sort order (fields of its occurrence's table) and filter formula. */
    sort?: { field: string; descending?: boolean; order?: string[] }[];
    filter?: string;
    /** Portal Setup's number of rows: a found-set portal reads that many (and a few more) unless asked for others. */
    rows?: number;
  }[];
  /** Fields from other occurrences placed outside portals: they show the first related record. */
  related: { occurrenceId: number; occurrence: string; fields: string[] }[];
}

/** Paging for each portal (Data API _offset.{portal} and _limit.{portal}); offsets are 1-based. */
export type PortalPaging = Record<string, { offset?: number; limit?: number; ids?: number[] }>;

export interface LayoutInfo {
  name: string;
  table: string;
  occurrence: string;
  fields: FieldInfo[];
  /** The store holding the table: another hosted file for a layout on an external table occurrence. */
  owner: Store;
  /** The store the layout belongs to; its relationship graph applies. */
  home?: Store;
  layoutId?: number;
  /** Portals and related fields, when the layout's design is known. */
  plan?: LayoutPlan;
  /**
   * The table's fields the layout uses (lower-cased), when its design is
   * known: those placed on it and those its formulas, merge text, sorts and
   * parts name. Records read through the layout carry only these, as
   * FileMaker's Data API does (FindOptions.layoutOnly), so unstored
   * calculations and summaries elsewhere in the table aren't worked out for nothing.
   */
  uses?: Set<string>;
}

export interface SortSpec {
  fieldName: string;
  sortOrder?: 'ascend' | 'descend' | string;
}

// The security/authentication event kinds, their grouping and their readable
// rendering live in one place (security-events.ts); SecurityEventKind is derived
// from that canonical list and re-exported here so existing imports still work.
import {
  type SecurityEventKind,
  type SecurityEventSeverity,
  categoryKinds,
  securityEventCategory,
  securityEventSeverity,
  describeSecurityEvent,
} from './security-events.ts';
export type { SecurityEventKind };

/** What the audit log keeps out of its entries (see Store.setAuditSettings). */
export interface AuditSettings {
  /** Fields named like passwords, secrets, tokens, API keys and card numbers never have their values logged. Off unless turned on: a value that is not logged cannot be put back by Undo or a revert. */
  redactSensitive: boolean;
  /** Table -> fields whose values are never logged: the entry says the field changed, not what it held. */
  excludeFields: Record<string, string[]>;
  /** Log who reads records (one entry per request: the table and the record ids it returned). Off unless turned on. */
  logReads: boolean;
  /** Record entries older than this many days are removed (the chain records that they were); 0 keeps them all. */
  retentionDays: number;
}

/** Stands in for a value the audit log doesn't keep. */
export const NOT_LOGGED = '‹not logged›';
const SENSITIVE_FIELD = /(^|[^a-z])(pass(word|code|phrase|wd)?|pwd|secret|token|api[ _-]?key|private[ _-]?key|credential|ssn|social[ _-]?security|card[ _-]?(number|no|num)|cvv|cvc|iban|pin)($|[^a-z])/i;

/** One entry of the audit log: a record change, or a security/authentication event. */
export interface AuditEntry {
  seq: number;
  /** ISO time. */
  at: string;
  /** Who did it (or, for a sign-in, who signed in); null when not known at this level. */
  account: string | null;
  kind: 'create' | 'update' | 'delete' | 'truncate' | 'read' | SecurityEventKind;
  /** The table, for a record change; '' for a security event. */
  table: string;
  recordId?: number;
  /** create: the values set; update: field → [old, new]; delete: the values it had; truncate: {records}; a security event: any extra detail. */
  changes?: Record<string, unknown>;
  /** True for a security/authentication event (not a record-data change). */
  security?: boolean;
  /** True when the acting account is an AI agent (an MCP/AI identity, not a person). */
  agent?: boolean;
  /** Where a record change came from: "web", "rest" (Data API), "odata", "sql", "mcp", "admin", "automation", ...; absent when not known (older entries). */
  surface?: string;
  /** The script that made the change, when one did. */
  script?: string;
  /** A create that duplicated a record: the record it copied. */
  copyOf?: number;
  /** A change that put back what an earlier entry changed (a revert): that entry's seq. */
  revertOf?: number;
  /** The object a security event acted on: the affected account, privilege set, or token. */
  target?: string;
  /** For a sign-in or lockout: the place (client address) the attempt came from. */
  from?: string;
}

/** A security/authentication audit entry with its group, a readable description and a severity (see Store.securityEvents). */
export interface SecurityEvent extends AuditEntry {
  category: string;
  description: string;
  severity: SecurityEventSeverity;
}

/** One API token that needs tidying up: dead, forgotten, or soon to expire (see Store.securityHealth → staleTokens). */
export interface TokenHygieneFinding {
  id: string;
  label?: string;
  account: string;
  created: string;
  expires?: string;
  lastUsed?: string;
  ageDays: number;
  /** Why it was flagged, in plain English (e.g. "not used in 120 days", "the account is deactivated", "expired 5 days ago"). */
  reasons: string[];
  /** What to do: revoke a dead or forgotten token, or rotate one that's about to expire. */
  action: 'revoke' | 'rotate';
}

/** The kinds of unusual-access finding Store.unusualAccess surfaces. */
export type AccessAlertKind =
  | 'failed-burst' | 'lockout' | 'new-place' | 'many-places' | 'dormant-return' | 'protection-removed';

/**
 * One unusual-access finding over a recent window: a pattern in the sign-in and
 * security log worth a person's eye. Read-only and recomputed each time, drawn
 * entirely from the audit log (see Store.unusualAccess).
 */
export interface AccessAlert {
  kind: AccessAlertKind;
  /** alert: act now (a burst, a lockout); notice: worth a look (a new place, a dormant account waking, a protection removed). */
  severity: 'alert' | 'notice';
  /** The account involved, or null when not tied to one. */
  account: string | null;
  /** The place (client address) involved, when the finding is about one. */
  from?: string;
  /** When the finding's most recent supporting event happened (ISO). */
  at: string;
  /** A supporting count (failures in the burst, distinct places, days dormant). */
  count?: number;
  /** The finding said in plain English. */
  description: string;
  /** The audit sequence numbers behind it, so a reader can find them in the log. */
  seqs: number[];
}

/**
 * One least-privilege suggestion (see Store.leastPrivilege): a privilege set
 * that may write to a table that no account on it has actually written to in
 * the window — a candidate for downgrading to view-only.
 *
 * SCOPE: only record writes are attributed to an account in the audit log, so
 * this covers write access only. Ways in (the Data API, OData, SQL, AI apps,
 * the web client) are covered by LeastPrivilegeAccessFinding, from the usage
 * counts. Whether a view, layout or script grant goes unused can't be told.
 */
export interface LeastPrivilegeFinding {
  set: string;
  table: string;
  /** The write grants the set holds on this table and hasn't exercised. */
  grants: ('edit' | 'create' | 'delete')[];
  /** Active accounts on the set — who a downgrade would affect. */
  accounts: string[];
  /** The finding said in plain English. */
  description: string;
}

/**
 * A way in (an extended privilege) a set allows but no account on it has used
 * in the window, from the per-account usage counts (Store.recordUsage).
 */
export interface LeastPrivilegeAccessFinding {
  set: string;
  /** The extended privilege, such as fmodata. */
  privilege: string;
  /** What it lets in, in plain words. */
  what: string;
  /** Active accounts on the set — who removing it would affect. */
  accounts: string[];
  description: string;
}

/**
 * Layouts a set lets its accounts open, or scripts it lets them run, that none of them has opened or run in the
 * window, from the per-account counts (Store.recordObjectUse). One a set and kind.
 */
export interface LeastPrivilegeObjectFinding {
  set: string;
  kind: 'layout' | 'script';
  /** The layouts or scripts, by name. */
  names: string[];
  /** Active accounts on the set — who taking them away would affect. */
  accounts: string[];
  description: string;
}

/** The extended privileges that open a way in here, and the usage surfaces (Store.recordUsage) that count as using them. */
const ACCESS_USAGE: Record<string, { what: string; surfaces: string[] }> = {
  fmrest: { what: 'the Data API', surfaces: ['rest'] },
  fmapp: { what: 'the web client', surfaces: ['web'] },
  fmwebdirect: { what: 'the web client', surfaces: ['web'] },
  fmodata: { what: 'OData', surfaces: ['odata'] },
  fmxdbc: { what: 'SQL (ODBC/JDBC and Postgres clients)', surfaces: ['sql'] },
  // The assistant, AI ideas and the AI import mapper in the web client need fmmcp too, and count as 'web'.
  fmmcp: { what: 'AI (AI apps over MCP, and AI in the web client)', surfaces: ['mcp', 'web'] },
};

/**
 * Raised when what is counted changes (2: OData, SQL, every MCP sign-in and
 * AI digests). A surface counted only since then (USAGE_SINCE_VERSION) is
 * judged by least privilege only once its counts cover the whole window.
 */
const USAGE_COUNTING = 2;
/** Surfaces counted the same way before USAGE_COUNTING 2, so their counts go back to the first day kept. */
const USAGE_COUNTED_BEFORE = new Set(['rest', 'web']);

/** Layouts opened and scripts run, by account and day (Store.recordObjectUse). */
const OBJECT_USAGE = '_fm_object_usage';

export { LOCKOUT, addressBucket } from './sign-in-failures.ts';

/**
 * A file's password policy, matching FileMaker's account options: how short a
 * password a person may set, and how long one stays valid before a change is
 * required. An unset or 0 value means no limit. Per account, a password can
 * also be marked must-change on next sign-in (see Store.setMustChangePassword).
 */
export interface PasswordPolicy {
  /** Shortest password a person may set; 0 or undefined means no minimum. */
  minLength?: number;
  /** Days a password stays valid before a change is required; 0 or undefined means it never expires. */
  maxAgeDays?: number;
}

/** A security change, applied all-or-none by Store.applySecurity (see security.ts). */
export type SecurityOp =
  | { op: 'setAccount'; name: string; password?: string; privilegeSet?: string; mustChange?: boolean; localOnly?: boolean; require2fa?: boolean }
  | { op: 'setExternalAccount'; name: string; privilegeSet: string }
  | { op: 'setAgentAccount'; name: string; privilegeSet: string; createdBy?: string; needsApproval?: boolean }
  | { op: 'deleteAccount'; name: string }
  | { op: 'savePrivilegeSet'; set: unknown }
  | { op: 'deletePrivilegeSet'; name: string }
  | { op: 'setPasswordPolicy'; policy: PasswordPolicy }
  | { op: 'setRequireTotpForFullAccess'; on: boolean }
  | { op: 'disableTotp'; account: string }
  | { op: 'revokeApiToken'; id: string };

/** One find, timed: what it searched and sorted on, and how long it took (the admin console's slow finds). */
export interface FindTiming {
  table: string;
  layout: string;
  /** Fields with criteria ("Table::Field" for related ones), and fields sorted on. */
  fields: string[];
  sort: string[];
  /** Criteria that start with a wildcard ("*smith"), which no index can help. */
  leadingWildcard: boolean;
  ms: number;
  found?: number;
  total: number;
}

export interface FindOptions {
  query?: FindRequest[];
  sort?: SortSpec[];
  /** 1-based, like the Data API. */
  offset?: number;
  limit?: number;
  dateFormat?: DateFormat;
  /** Portal paging; portals default to their first 50 rows. */
  portals?: PortalPaging;
  /** Whose privileges apply: records they can't view are left out, fields they can't see are blank. */
  privileges?: Privileges;
  /** Only the fields the layout uses (LayoutInfo.uses), as FileMaker's Data API returns them. */
  layoutOnly?: boolean;
  /** How dates in the find criteria are read (see WriteOptions.dateOrder); unset, the file's order. */
  dateOrder?: DateStyle;
}

export interface Container {
  id: number;
  filename: string | null;
  mime: string;
  data: Uint8Array;
}

/**
 * A file put in a container field: its bytes, or a file on this computer that holds them (a large upload spooled to
 * disk), read in pieces so that nothing the size of the file is ever in memory. `sha256` is the hash of the bytes when the
 * caller already has it; the audit log records it.
 */
export type ContainerFile =
  | { filename: string | null; mime: string; data: Uint8Array }
  | { filename: string | null; mime: string; path: string; offset?: number; size: number; sha256?: string };

const spooled = (f: ContainerFile): f is Extract<ContainerFile, { path: string }> => 'path' in f;
const containerFileSize = (f: ContainerFile): number => spooled(f) ? f.size : f.data.length;

/** The pieces of a container file, each at most CONTAINER_CHUNK bytes. The piece is reused for the next: copy what is kept. */
function eachContainerPiece(f: ContainerFile, visit: (n: number, piece: Uint8Array) => void): void {
  if (!spooled(f)) {
    for (let n = 0; n * CONTAINER_CHUNK < f.data.length; n++) visit(n, f.data.subarray(n * CONTAINER_CHUNK, (n + 1) * CONTAINER_CHUNK));
    return;
  }
  const fd = openSync(f.path, 'r');
  try {
    const buf = Buffer.allocUnsafe(Math.min(CONTAINER_CHUNK, Math.max(1, f.size)));
    for (let n = 0, at = 0; at < f.size; n++) {
      const want = Math.min(CONTAINER_CHUNK, f.size - at);
      let got = 0;
      while (got < want) {
        const r = readSync(fd, buf, got, want - got, (f.offset ?? 0) + at + got);
        if (!r) throw new StoreError(500, 'The uploaded file ended early');
        got += r;
      }
      visit(n, buf.subarray(0, want));
      at += want;
    }
  } finally {
    closeSync(fd);
  }
}

/** The SHA-256 of a container file, read in pieces. */
function containerFileHash(f: ContainerFile): string {
  if (spooled(f) && f.sha256) return f.sha256;
  const h = createHash('sha256');
  eachContainerPiece(f, (_n, piece) => { h.update(piece); });
  return h.digest('hex');
}

/** A container file without its bytes. */
export interface ContainerInfo {
  id: number;
  /** Changes only when this container is replaced or rewritten. */
  version: string;
  filename: string | null;
  mime: string;
  size: number;
  /** Kept in pieces (see CONTAINER_CHUNK), so ranges read only what they need. */
  chunked: boolean;
  /** When the file was put in, in whole seconds since 1970; absent for one stored before that was kept, or converted from a FileMaker file. */
  modified?: number;
  /** Stored outside the file (FileMaker's external storage); `missing` when the file isn't there, `changed` when it is missing or not the size it was stored at. */
  external?: { path: string; missing: boolean; changed?: true };
}

/** A file's size, or undefined when it went away after it was found. */
function fileSize(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

/**
 * Where a hosted file's externally stored container files may be, first match
 * first: FileMaker Server keeps them in RC_Data_FMS/<file>/, FileMaker Pro in
 * Files/<file>/, each under the field's base directory (Manage Containers;
 * the default is named after the file). Every one is inside `folder`.
 */
export function externalRoots(folder: string, name: string, baseDirs: string[]): string[] {
  const roots: string[] = [];
  const add = (...parts: string[]) => {
    const r = resolve(folder, ...parts);
    const inside = relative(folder, r);
    if (inside && !inside.startsWith('..') && !isAbsolute(inside) && !roots.includes(r)) roots.push(r);
  };
  for (const base of baseDirs) {
    const b = base.replace(/\\/g, '/').replace(/^\/+/, '');
    for (const top of ['RC_Data_FMS', 'Files']) {
      add(top, name, b);
      add(top, b);
    }
    add(b);
  }
  add('RC_Data_FMS', name);
  add('Files', name);
  return roots;
}

/** Container files bigger than this are kept in pieces of this size. */
export const CONTAINER_CHUNK = 1024 * 1024;

/** Turns a container id into the value clients see (a download URL when served). */
/** `principal`: the account the link is made for (see Store.linkPrincipal). A link made for one stops working when that account is blocked or removed. */
export type ContainerUrl = (id: number, filename: string | null, principal?: string) => string;

/** Who is writing, for auto-enter account names and Get ( AccountName ). */
export interface WriteOptions {
  account?: string;
  /** Internal: the window's pending edit buffer, for retaining stored calculation results through commit. */
  editKey?: object;
  /** Server code replaying a restore patch it recorded itself (an optimization fix's undo): never set from a request. */
  recordedRestore?: boolean;
  /** Import Records can suppress auto-enter while retaining stored calculations and validation. */
  performAutoEnter?: boolean;
  /** Whose privileges apply: writes they are not allowed fail with error 200 or 201. */
  privileges?: Privileges;
  /** A person typing (Data API, web client), not a script: fields that prohibit modification refuse it. */
  dataEntry?: boolean;
  /** create: the record the window was on, for fields with "value from last visited record". */
  lastVisited?: number;
  /**
   * How dates and timestamps sent as text are read: the Data API sends them as MM/DD/YYYY ('MDY'),
   * as it gives them, whatever the file's own date order. Unset: the file's order, as a script's are.
   */
  dateOrder?: DateStyle;
  /** Putting back values a field had before (an undo): its validation isn't checked again. */
  restoring?: boolean;
  /** delete: `false` leaves the records related through "delete related records" relationships alone (live sync's pulled deletions). */
  cascade?: boolean;
  /** create: a record a script's New Record made: like FileMaker, its fields are validated when it is committed, not now. */
  uncommitted?: boolean;
  /** update: the commit of such a record: required fields are checked even when the script didn't set them. */
  firstCommit?: boolean;
  /**
   * create: the web client's New Record (the Data API's options.uncommitted): the values given are checked as usual,
   * but the fields that must have a value are left to the first commit (firstCommit), as for a script's new record.
   */
  requiredAtCommit?: boolean;
  /** "Skip data entry validation" (Commit Records/Requests, or every write inside Open Transaction with it), or the Data API's entrymode "script": only fields validated "Always" are checked. */
  skipEntryValidation?: boolean;
  /** Fields whose validation warning a person explicitly chose to override during data entry; strict fields still reject the write. */
  overrideValidation?: string[];
  /** Internal: an approval-gated agent's change being applied after a human approved it, so the approval gate is not re-triggered. Not set by request handlers. */
  approvedChange?: boolean;
  /**
   * update: formatting for text fields being written, by field name, for the value written (Browse mode's Format
   * menu); an empty list removes it. Without it, a person's edit (dataEntry) keeps the formatting around what they
   * changed, and any other write of a text field drops it.
   */
  styles?: Record<string, StyleRun[]>;
}

export interface EvaluateOptions extends WriteOptions {
  /** A read-only preview of the script's uncommitted current row. */
  row?: Record<string, SqlValue>;
  /** Preview rows by identity for found-set chart evaluation and summaries. */
  rows?: Map<number, Record<string, SqlValue>>;
  get?: (name: string) => Value | undefined;
  variable?: (name: string, repetition: number) => Value | undefined;
  /** Where Let ( $$name = ... ) writes, in `evaluate` (the Data Viewer); otherwise $$variables set by a formula last only for it. */
  setVariable?: (name: string, repetition: number, value: Value) => void;
}

/** A run of records sharing a sub-summary's break values: position in the found set, size and summary values. */
export interface GroupRun {
  start: number;
  count: number;
  values: Record<string, string | number>;
}

export interface FindResult {
  records: StoredRecord[];
  foundCount: number;
  totalCount: number;
}

/** Field names a write names ("Field(2)" is Field). */
function fieldNames(data: FieldData): string[] {
  return Object.keys(data).map((k) => k.replace(/\(\d+\)$/, ''));
}

/** A write's key split into its field name and repetition ("Notes(2)" is repetition 2 of Notes). */
function splitRep(key: string): { name: string; rep: number } {
  const m = /^(.*)\((\d+)\)$/.exec(key);
  return m ? { name: m[1], rep: Number(m[2]) } : { name: key, rep: 1 };
}

/** A field's key in a record's data: its name, with "(n)" past the first repetition. */
function repKey(name: string, rep: number): string {
  return rep === 1 ? name : `${name}(${rep})`;
}

function repetitionsOf(f: { options?: { repetitions?: number } }): number {
  return Math.max(1, f.options?.repetitions ?? 1);
}

function toUsDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/** Found sets at least this large keep their sorted order between pages. */
const SORTED_KEEP_MIN = 2000;
/** A found-set portal without a number of rows in Portal Setup reads this many, and every one reads a few more than it shows. */
const FOUND_SET_ROWS = 10;
const FOUND_SET_SPARE = 5;
/** How many sorted orders are kept at once. */
const SORTED_KEEP = 4;

/**
 * The internal `_fm_` names a read-only query may touch: the row-id and
 * modification-id columns of base tables, and the two container tables (whose
 * bytes an account with full record access can already download). Every other
 * `_fm_` name — accounts, API tokens, second-factor secrets, the audit log,
 * meta, privileges, and the find/word/tombstone machinery — is off-limits.
 */
const SQL_ALLOWED_INTERNAL = new Set(['_fm_record_id', '_fm_mod_id', '_fm_containers', '_fm_container_chunks']);

/**
 * The first reference to a forbidden internal table in a SQL string, if any.
 * Line and block comments and single-quoted string literals are removed first
 * (so a value that merely contains "_fm_" is not a reference), but quoted,
 * bracketed and backtick-quoted identifiers are kept, so `"_fm_totp"` and
 * `[_fm_totp]` are caught as well as the bare name.
 */
function internalTableRef(sqlText: string): string | undefined {
  for (const t of sqlTokens(sqlText)) {
    if (t.kind !== 'word' && t.kind !== 'identifier') continue;
    const name = sqlName(t).toLowerCase();
    if (name.startsWith('_fm_') && !SQL_ALLOWED_INTERNAL.has(name)) return name;
  }
  return undefined;
}

/**
 * The first reference to SQLite's own catalog in a SQL string: `sqlite_master` and its aliases, `dbstat`, and the
 * `pragma_*` functions. They list every table the file holds, internal ones included, with their columns, so a caller learns the
 * file's internals (and a quoted name like `pragma_table_info('_fm_totp')` that the name screen above strips as a
 * string). The calculation engine's ExecuteSQL refuses the same names.
 */
function catalogRef(sqlText: string): string | undefined {
  const tokens = sqlTokens(sqlText).filter((t) => t.kind !== 'space');
  for (const [i, t] of tokens.entries()) {
    if (t.kind !== 'word' && t.kind !== 'identifier' && t.kind !== 'string') continue;
    const name = sqlName(t).toLowerCase();
    // SQLite accepts string-quoted table names after commas and schema dots too,
    // and a pragma's hidden argument may arrive through WHERE instead of (...).
    if (/^pragma_\w+$/.test(name)) return name;
    if (t.kind === 'string') {
      let before = i - 1;
      while (tokens[before]?.text === '(') before--;
      if (!/^(?:FROM|JOIN)$/i.test(tokens[before]?.text ?? '') && tokens[i + 1]?.text !== '(') continue;
    }
    if (/^(?:sqlite_(?:temp_)?(?:master|schema)|dbstat)$/.test(name)) return name;
  }
  return undefined;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 32).toString('base64')}`;
}

/**
 * A readable one-time password for migrated accounts: base64url (no padding,
 * no ambiguous characters from the alphabet's own set) from 18 random bytes,
 * always at least `minLength` characters so it satisfies the file's policy.
 */
export function generateTempPassword(minLength = 0): string {
  let pw = randomBytes(18).toString('base64url');
  while (pw.length < minLength) pw += randomBytes(9).toString('base64url');
  return pw;
}

/**
 * Whether accounts the file left with an empty password (FileMaker's default
 * Admin) can sign in from other computers. Off: they work only from this
 * computer, until a password is set with `tabularius passwd`.
 */
export const PASSWORD_POLICY = { blankFromNetwork: false };

const LOCAL = new Set(['', 'mcp', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

const PASSKEY_REFUSED = 'That passkey was not accepted; try again';

/** Extended privileges that let an account sign in from another computer (the security health report flags these on empty-password accounts). */
const NETWORK_LOGIN_PRIVILEGES = ['fmapp', 'fmwebdirect', 'fmrest', 'fmxml', 'fmmcp'];

/** The largest number of allowed-id sets kept; the oldest is dropped past this. */
const ALLOWED_CACHE_MAX = 512;
/** How long an account that changed a file sees results worked out after its change, never one from before it. */
const READ_YOUR_WRITES_MS = 120_000;
/** How often an account's latest change is noted for the server's other processes (well within READ_YOUR_WRITES_MS). */
const WRITE_SHARE_MS = 5_000;
/**
 * The surfaces a bearer API token can be restricted to, each the extended
 * privilege that surface already requires: the Data API (fmrest), OData
 * (fmodata), the SQL endpoint (fmxdbc) and MCP (fmmcp). These are the surfaces
 * that accept a bearer token; the web client and the Postgres wire sign in
 * with a password, and MCP also takes an account password or the server's
 * admin token.
 */
const TOKEN_SURFACES = new Set(['fmrest', 'fmodata', 'fmxdbc', 'fmmcp']);
/**
 * A record-access rule whose value changes with the wall clock, not with the
 * data: it is never cached, since no write would mark a stale set dirty. Covers
 * Random, UUID and the Get(Current…Date/Time/HostTimestamp/UTC…) family. A rule
 * that hides such a function inside a custom function isn't seen here; its set
 * may lag the clock until the next write to the file (a correctness, not an
 * access, matter — the cache is keyed per account and never crosses accounts).
 */
const VOLATILE_RULE = /random|uuid|current(date|time|host)/i;

/**
 * Checks a password against the verifier FileMaker stored for the account:
 * PBKDF2-HMAC-SHA1, one iteration, over the password combined with a fixed
 * 30-byte string, with the verifier's 10-byte salt (see
 * docs/research/fmp12-format.md). Only the empty password is checked so far:
 * the published research on this scheme (David Hamann's write-up, cited in
 * that doc) reconstructs the field layout and the KDF from a debugger but
 * does not give the 30-byte constant or confirm the byte order, and working
 * that out further would mean reconstructing a password-cracking primitive
 * against a proprietary scheme from a single worked example — not something
 * this project does. So a non-blank FileMaker password does NOT carry over on
 * import today; only accounts that had no password verify as before. See
 * Store.setPassword to give an imported account a working password, and
 * `allowBlankPasswordFromLan` for the stopgap this limit calls for.
 */
function checkFmp12Password(password: string, verifierHex: string): boolean {
  const v = Buffer.from(verifierHex, 'hex');
  if (v.length < 31 || v[0] !== 1 || password !== '') return false;
  return timingSafeEqual(pbkdf2Sync(Buffer.alloc(0), v.subarray(1, 11), 1, 20, 'sha1'), v.subarray(11, 31));
}

/** A private-network or loopback address (RFC 1918, fc00::/7, 127/8, ::1) — the same ranges local-tls.ts's own copy trusts. */
function privateAddress(rawIp: string): boolean {
  // A dual-stack `::` listener reports an IPv4 peer as "::ffff:10.0.0.5"; strip that prefix first (oauth.ts does the
  // same for its per-address registration limit) so such a peer is checked as the IPv4 address it actually is.
  const ip = rawIp.replace(/^::ffff:/, '');
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
  }
  if (isIP(ip) === 6) {
    if (ip === '::1') return true;
    // Only the first hextet (fc00::/7 = ULA) matters here, so a full address parse isn't needed.
    const first = parseInt((ip.split('::')[0].split(':')[0] || '0'), 16);
    return (first & 0xfe00) === 0xfc00;
  }
  return false;
}

/** A scrypt hash of a password nobody has, checked when a refusal must cost what a wrong password costs (see Store.spendsScrypt). Its parameters are the real ones, so it takes as long. */
const DUMMY_HASH = `scrypt$${Buffer.alloc(16, 7).toString('base64')}$${Buffer.alloc(32, 9).toString('base64')}`;

export function checkPassword(password: string, stored: string): boolean {
  if (stored.startsWith('fmp12$')) return checkFmp12Password(password, stored.slice(6));
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(want, got);
}

/** The cost of checking one wrong password, spent when a request is refused before any file's accounts are looked at (see Store.spendsScrypt). */
export async function spendPasswordCheck(password: string): Promise<void> {
  await checkPasswordAsync(password, DUMMY_HASH);
}

/** checkPassword off the main thread, so a burst of logins doesn't stall everyone else's requests. */
export function checkPasswordAsync(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('fmp12$')) return Promise.resolve(checkFmp12Password(password, stored.slice(6)));
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return Promise.resolve(false);
  const want = Buffer.from(hash, 'base64');
  return new Promise((ok, fail) => scrypt(password, Buffer.from(salt, 'base64'), want.length, (e, got) => (e ? fail(e) : ok(timingSafeEqual(want, got)))));
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

/** A function SQL queries call: SQLite values in, a value out. */
export type QueryFunction = (...args: SQLOutputValue[]) => SQLInputValue;

/**
 * Text's sort key, kept for values seen recently: a sort reads the same names,
 * regions or statuses over and over, and working out a key is the slow part.
 */
const sortKeys = new PreparedCache(new Map<string, Map<string, string>>(), (value) => new Map([...value].map(([id, kept]) => [id, new Map(kept)])));
const SORT_KEYS_KEEP = 20_000;
function keptSortKey(v: string, lang: string): string {
  const all = sortKeys.value;
  let kept = all.get(lang);
  if (!kept) all.set(lang, kept = new Map());
  let k = kept.get(v);
  if (k === undefined) {
    k = sortKey(v, lang);
    if (v.length <= 200) {
      if (kept.size >= SORT_KEYS_KEEP) kept.clear();
      kept.set(v, k);
    }
  }
  return k;
}

/** formulaColumns' answers, per design (the schema object is replaced when the design changes). */
const formulaColumnsKept = new WeakMap<Schema, PreparedCache<Map<string, string[] | null>>>();

/** Text made wholly of a number's parts: a sign, digits (with commas and a point) and an exponent. */
const NUMBER_LOOKING = /^[+-]?(?:\d[\d,]*\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** A SQL query's rows and where they came from (see `Store.queryWithOrigins`). */
export interface QueryOrigins {
  rows: Record<string, SqlValue>[];
  columns: { name: string; origin: string | null }[];
  tables: { table: string; columns: string[] }[];
  virtual: boolean;
}

export class Store {
  private readonly valueListSorts = new PreparedCache(new Map<string, { token: string; order: ReturnType<typeof valueListOrder> }>(), (value) => new Map(value));
  private readonly valueListRanks = new PreparedCache(new Map<string, ReturnType<typeof valueListOrder>>(), (value) => new Map(value));
  readonly sql: DatabaseSync;
  private readonly damageWatch: DamageWatch = {};
  /** Set once a query has found damaged pages in the file: every query after it is refused (damage.ts). */
  get damage(): FileDamaged | undefined { return this.damageWatch.damage; }
  /** Called once with the first damage found, so the host can stop serving the file. */
  set onDamage(fn: ((damage: FileDamaged) => void) | undefined) { this.damageWatch.onDamage = fn; }
  /** Called when a write failed because the disk is full or cannot be written. */
  set onDiskTrouble(fn: ((trouble: DiskTrouble) => void) | undefined) { this.damageWatch.onDiskTrouble = fn; }
  readonly path: string;
  readonly name: string;
  private readOnlySql?: DatabaseSync;
  private decimalSqlViewVersion = -1;
  private readonly queryFunctions = new Map<string, QueryFunction>();
  private readonly untrustedQueryFunctions = new Set<string>();
  /** The solution's design; replaced (not mutated) when design mode changes it. */
  private currentSchema: Schema;
  private schemaText?: string;
  private designVersion?: number;
  /** A synchronous read checks each participating file once, not once per field. */
  private static designRead?: Set<Store>;

  private withDesignRead<T>(read: () => T): T {
    if (Store.designRead) return read();
    Store.designRead = new Set();
    try { return read(); } finally { Store.designRead = undefined; }
  }

  private metadataVersionQuery?: StatementSync;

  declare readonly schema: Schema;

  /** Only metadata mutations advance these counters; failed sign-ins do not. */
  private metadataVersions(): { design: number; privileges: number } {
    return (this.metadataVersionQuery ??= this.sql.prepare('SELECT design, privileges FROM _fm_metadata_versions WHERE id = 1')).get() as { design: number; privileges: number };
  }

  /** The schema as text: unchanged while only the layouts or repetitions change, unlike the schema object, which is renewed with each design change. */
  get schemaSignature(): string {
    this.refreshDesign();
    return this.schemaText ??= JSON.stringify(this.currentSchema);
  }

  private refreshDesign(): void {
    if (this.designVersion === undefined) return; // constructor
    if (Store.designRead?.has(this)) return;
    Store.designRead?.add(this);
    if (this.metadataVersions().design !== this.designVersion) this.resetCaches();
  }
  /** Live calculations, auto-enter and validation for this file. */
  calc: Calculations;
  /** Formatting kept with text fields' data (Browse mode's Format menu). */
  readonly textStyles: TextStyles;
  /** How the file writes dates as text (order, two-digit months and days). */
  readonly dateOrder: DateStyle;
  /** Native stores have ISO dates and modern field constraints; older stores remain compatible. */
  readonly fileMode: 'native' | 'compat';
  private repeating: Record<string, string[]>;
  private readonly layoutSchemas = new WeakMap<LayoutInfo, Schema>();
  private readonly layoutCache = new PreparedCache(new Map<string, LayoutInfo>(), (value) => new Map(value));
  /** Word indexes for finds on text (see words.ts). */
  readonly words: WordIndexes;
  /** Privileges by account (lowercase), valid at the metadata and connection versions. */
  private readonly privilegeCache = new PreparedCache(new Map<string, Privileges>(), (value) => new Map(value));
  private readonly privilegeVersion = new PreparedCache<string>('');
  /** Prepared statements by SQL text, for the per-record reads and writes a script loop repeats. */
  private readonly statements = new Map<string, StatementSync>();
  private dataVersionQuery?: StatementSync;
  /** Records per table, keyed by the transactional write token. */
  private readonly counts = new PreparedCache(new Map<string, { token: string; n: number }>(), (value) => new Map(value));
  /**
   * Ids a "limited" view rule allows, by table+account+rule, each valid only
   * while the write token it was computed at still holds. The token advances on
   * any row change (this connection or another) and the map is cleared on a
   * schema change, so a cached set can never show a record a write has hidden.
   */
  private readonly allowedCache = new PreparedCache(new Map<string, { token: string; ids: number[] }>(), (value) => new Map(value));
  /** Diagnostics: how many limited-rule id scans have run (a cache miss costs one full table scan). */
  allowedScans = 0;
  private designCache = new PreparedCache<LayoutDesigns | undefined>(undefined);
  /** Finds another hosted file by name, for layouts whose table lives there (set by the host). */
  resolveFile: (name: string) => Store | undefined = () => undefined;

  /** Resolve an owning file under the current script's isolation boundary. */
  resolvedFile(name: string): Store | undefined {
    const file = this.resolveFile(name);
    if (file) writer.getStore()?.beforeFile?.(file);
    return file;
  }
  /** A function a plug-in enabled for this file provides, by name or ⟨OWNR:n⟩ marker (set by the host). */
  plugin: (name: string) => PluginFunction | undefined = () => undefined;
  /** Identifies the file's enabled plug-in functions and what they may cache; part of every shared result's key. It must not depend on which functions a formula has happened to call, or processes would key the same result differently. */
  pluginsKey: () => string = () => '';
  /** Get ( InstalledFMPlugins ) for this file; the host sets it. */
  installedPlugins: () => InstalledPlugin[] = () => [];
  /** Whether a plug-in enabled for this file may make web requests; the host sets it. */
  pluginsUseNetwork: () => boolean = () => false;
  /** Whether a plug-in enabled for this file may send mail; the host sets it. */
  pluginsUseMail: () => boolean = () => false;
  /** Whether a function belongs to a built-in plug-in pack turned off for this file; the host sets it. */
  builtinOff: (name: string) => boolean = () => false;
  containerUrl: ContainerUrl = (id, filename) => `container:${id}${filename ? '/' + encodeURIComponent(filename) : ''}`;
  /** Records being edited, by whom (shared between processes when the server runs several; see SharedRecordLocks). */
  locks = new RecordLocks();
  /** Called after every change to a record (and lock changes), for live clients. */
  readonly listeners = new Set<(change: Change) => void>();
  /** Single-flight directory checks, keyed exactly like failures. No queue, timers or idle entries;
   * entries live only as long as their active authentication request and are released in finally.
   */
  private readonly directoryChecks = new Set<string>();
  /** Recent failed sign-ins, by account and place. */
  private readonly failures = new SignInFailures((key, address) => {
    const [account, from, factor] = key.split('\u0000');
    if (account === '') this.logSecurity('locked-out', { from: factor, detail: { scope: 'address' } });
    else this.logSecurity('locked-out', { account, from: address ?? from, ...(factor === 'totp' ? { detail: { factor: 'two-factor' } } : {}) });
  });
  /** Called after design mode changes this file (the host refreshes the other files that may use it). */
  onDesignChange: () => void = () => {};

  constructor(path: string, name = basename(path, extname(path))) {
    Object.defineProperty(this, 'schema', {
      configurable: true, enumerable: true,
      get: () => { this.refreshDesign(); return this.currentSchema; },
    });
    const display = name.replace(/\.tabularius$/i, '');
    const existed = existsSync(path);
    // An empty file is what a copy or a restore cut short leaves. Opening it would build tables into it and then fail on them.
    if (existed && statSync(path).size === 0) throw new Error(`${display} is an empty file (0 bytes), not a database; put a backup of it back`);
    this.sql = traceDatabase(watchDatabase(new DatabaseSync(path), display, this.damageWatch));
    // The wait comes first: another process replaying the log after a crash would otherwise fail this first read at once.
    this.sql.exec('PRAGMA busy_timeout = 5000');
    let designed: unknown;
    try { designed = this.sql.prepare("SELECT 1 FROM sqlite_master WHERE name = '_fm_meta'").get(); } catch (e) {
      try { this.sql.close(); } catch { /* the file is not usable either way */ }
      throw e;
    }
    if (!designed) {
      this.sql.close();
      if (!existed) for (const side of ['', '-wal', '-shm']) rmSync(path + side, { force: true });
      throw new Error(`${display} is not a Tabularius database (it has no design tables); it may be damaged or another program's file`);
    }
    try { checkFormat(this.sql, display); } catch (e) {
      try { this.sql.close(); } catch { /* the file is not usable either way */ }
      throw e;
    }
    // WAL: readers (finds, MCP SQL, backups, other processes) don't wait on writers.
    // synchronous NORMAL syncs the log at checkpoints rather than on every save: the
    // file can't be corrupted, but a power cut may lose the last moments of edits
    // (as with FileMaker Server's cache), and saves no longer wait on the disk.
    // Set the wait before changing journal mode: another Store (for example,
    // the running server while `tabularius passwd` opens this file) may be in a
    // write transaction during startup. Setting busy_timeout afterwards does
    // not protect the journal_mode pragma that can hit that lock.
    this.sql.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL');
    this.path = path;
    this.name = name;
    // Text sorts in FileMaker's index order (case and accents ignored), not byte order.
    for (const [fn, impl] of Object.entries(SQL_DATE_FUNCTIONS)) {
      this.sql.function(fn, { deterministic: !/^(CURDATE|CURTIME|NOW|CURTIMESTAMP|TODAY)$/.test(fn), varargs: fn === 'ROUND' }, impl);
      this.queryFunctions.set(fn, impl);
    }
    // One function per language order a field can be indexed in (fm_sort_key for English, fm_sort_key_ja, fm_sort_key_sv, ...).
    for (const id of SORT_LANGUAGE_IDS) {
      this.sql.function(sortFunction(id), { deterministic: true }, (v) => (typeof v === 'string' ? keptSortKey(v, id) : v));
      this.sql.function(id === 'en' ? 'fm_record_sort_key' : `fm_record_sort_key_${id}`, { deterministic: true },
        (v) => (typeof v === 'string' ? recordSortKey(v, id) : v));
    }
    // Finds and unique values compare text without regard to case in every script (SQLite's NOCASE knows ASCII only).
    defineFold(this.sql);
    this.sql.function('fm_fold_case', { deterministic: true }, (v) => (typeof v === 'string' ? foldCase(v) : v));
    this.sql.function('fm_first_repetition', { deterministic: true }, (v) => {
      if (typeof v !== 'string' || !v.startsWith('[')) return v;
      try {
        const list: unknown = JSON.parse(v);
        return Array.isArray(list) ? (list[0] as string | number | null) ?? null : v;
      } catch { return v; }
    });
    this.sql.function('fm_value_list_rank', { deterministic: true }, (v, token) => {
      const order = this.valueListRanks.value.get(String(token))!;
      return order.rank(fromStored(v as string | number | null, order.type));
    });
    this.sql.function('fm_value_list_text_key', { deterministic: true }, (v, token) => {
      const order = this.valueListRanks.value.get(String(token))!;
      return order.textKey(fromStored(v as string | number | null, order.type));
    });
    registerFindFunctions(this.sql);
    this.words = new WordIndexes(this.sql);
    ensureCacheVersions(this.sql);
    const initialDesignVersion = this.metadataVersions().design;
    this.currentSchema = this.meta('schema');
    this.fileMode = this.meta('fileMode') === 'native' ? 'native' : 'compat';
    if (this.fileMode === 'native') this.sql.function('fm_decimal_key', { deterministic: true }, (v) => decimalKey(v as string | number | null));
    this.dateOrder = this.meta('dateOrder') ?? 'MDY';
    this.repeating = this.meta('repeating') ?? {};
    this.calc = new Calculations(this);
    ensurePrivilegeTables(this.sql);
    // Backfill identities once; newly inserted replacement accounts receive a
    // different identity when first used as a mapping.
    const missingIdentity = this.sql.prepare('SELECT name FROM _fm_accounts WHERE identity_id IS NULL').all() as { name: string }[];
    const setIdentity = this.sql.prepare('UPDATE _fm_accounts SET identity_id = ? WHERE name = ? COLLATE NOCASE AND identity_id IS NULL');
    for (const row of missingIdentity) setIdentity.run(randomUUID(), row.name);
    ensureAccountImportTables(this.sql);
    this.sql.prepare('INSERT OR IGNORE INTO _fm_meta (key, json) VALUES (?, ?)').run('accountImportSecret', JSON.stringify(randomBytes(32).toString('hex')));
    // created_by: for an AI agent account, the human account that created it, so
    // the trail shows who an agent acts for. NULL for ordinary accounts.
    if (!(this.sql.prepare('PRAGMA table_info(_fm_accounts)').all() as { name: string }[]).some((c) => c.name === 'created_by')) {
      this.sql.exec('ALTER TABLE _fm_accounts ADD COLUMN created_by TEXT');
    }
    // needs_approval: for an AI agent account, 1 when its writes are held as
    // proposals for a human to approve rather than applied straight away.
    if (!(this.sql.prepare('PRAGMA table_info(_fm_accounts)').all() as { name: string }[]).some((c) => c.name === 'needs_approval')) {
      this.sql.exec('ALTER TABLE _fm_accounts ADD COLUMN needs_approval INTEGER NOT NULL DEFAULT 0');
    }
    // Explicitly disables password authentication, including a FileMaker
    // verifier stored outside password_hash.
    if (!(this.sql.prepare('PRAGMA table_info(_fm_accounts)').all() as { name: string }[]).some((c) => c.name === 'password_disabled')) {
      this.sql.exec('ALTER TABLE _fm_accounts ADD COLUMN password_disabled INTEGER NOT NULL DEFAULT 0');
    }
    // Proposed changes from approval-gated agents, awaiting a human's decision.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_pending (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, agent TEXT NOT NULL,
      kind TEXT NOT NULL, layout TEXT NOT NULL, tbl TEXT NOT NULL, record_id INTEGER, data TEXT, mod_id INTEGER, summary TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, account TEXT,
      kind TEXT NOT NULL, tbl TEXT NOT NULL, record_id INTEGER, changes TEXT, security INTEGER NOT NULL DEFAULT 0)`);
    // Older files had a record-only audit log; add the column that marks security events.
    if (!(this.sql.prepare('PRAGMA table_info(_fm_audit)').all() as { name: string }[]).some((c) => c.name === 'security')) {
      this.sql.exec('ALTER TABLE _fm_audit ADD COLUMN security INTEGER NOT NULL DEFAULT 0');
    }
    // agent: 1 when the acting account is an AI agent, so agent actions can be
    // picked out of the log at a glance even after the account is gone.
    if (!(this.sql.prepare('PRAGMA table_info(_fm_audit)').all() as { name: string }[]).some((c) => c.name === 'agent')) {
      this.sql.exec('ALTER TABLE _fm_audit ADD COLUMN agent INTEGER NOT NULL DEFAULT 0');
    }
    // Where a record change came from (web client, Data API, OData, SQL, MCP, ...), the script running, and for a duplicate the record it copied.
    for (const [name, type] of [['surface', 'TEXT'], ['script', 'TEXT'], ['copy_of', 'INTEGER'], ['revert_of', 'INTEGER']] as const) {
      if (!(this.sql.prepare('PRAGMA table_info(_fm_audit)').all() as { name: string }[]).some((c) => c.name === name)) {
        this.sql.exec(`ALTER TABLE _fm_audit ADD COLUMN ${name} ${type}`);
      }
    }
    ensureSecurityChain(this.sql);
    ensureRecordChain(this.sql);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_api_tokens (id TEXT PRIMARY KEY, label TEXT, account TEXT NOT NULL,
      token_hash TEXT NOT NULL, read_only INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, expires TEXT, last_used TEXT)`);
    // surfaces: a JSON array of extended-privilege keywords the token may be used on, or NULL for all the account's.
    if (!(this.sql.prepare('PRAGMA table_info(_fm_api_tokens)').all() as { name: string }[]).some((c) => c.name === 'surfaces')) {
      this.sql.exec('ALTER TABLE _fm_api_tokens ADD COLUMN surfaces TEXT');
    }
    // layouts: a JSON array of layout names the token may read/write through, or NULL for every layout the account can use.
    if (!(this.sql.prepare('PRAGMA table_info(_fm_api_tokens)').all() as { name: string }[]).some((c) => c.name === 'layouts')) {
      this.sql.exec('ALTER TABLE _fm_api_tokens ADD COLUMN layouts TEXT');
    }
    if (!(this.sql.prepare('PRAGMA table_info(_fm_api_tokens)').all() as { name: string }[]).some((c) => c.name === 'identity')) this.sql.exec('ALTER TABLE _fm_api_tokens ADD COLUMN identity TEXT');
    if (!(this.sql.prepare('PRAGMA table_info(_fm_api_tokens)').all() as { name: string }[]).some((c) => c.name === 'provenance')) this.sql.exec('ALTER TABLE _fm_api_tokens ADD COLUMN provenance TEXT');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_totp (account TEXT PRIMARY KEY, secret TEXT NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, last_step INTEGER)`);
    // Passkeys (WebAuthn): one row per registered credential; public key only.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_passkeys (id TEXT PRIMARY KEY, account TEXT NOT NULL COLLATE NOCASE,
      public_key TEXT NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, alg INTEGER NOT NULL, label TEXT,
      created TEXT NOT NULL, last_used TEXT)`);
    // Short-lived sign-in / registration challenges, consumed once.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_webauthn_challenges (challenge TEXT PRIMARY KEY, account TEXT, kind TEXT NOT NULL, created TEXT NOT NULL)`);
    // One-time recovery codes (a fallback when a passkey or authenticator is lost); only the hashes are kept.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_recovery_codes (account TEXT NOT NULL COLLATE NOCASE, code_hash TEXT NOT NULL,
      used TEXT, created TEXT NOT NULL, PRIMARY KEY (account, code_hash))`);
    // Big container files in pieces, so a range of one (a video's next few seconds) reads only those pieces.
    this.sql.exec('CREATE TABLE IF NOT EXISTS _fm_container_chunks (id INTEGER NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, n)) WITHOUT ROWID');
    ensureTextStyles(this.sql);
    this.textStyles = new TextStyles(this.sql);
    countObjectUse(this, (account, set, kind, name) => this.recordObjectUse(account, set, kind, name));
    // Externally stored container files: their path under the file's container folder (see externalRoots).
    if (!(this.sql.prepare('PRAGMA table_info(_fm_containers)').all() as { name: string }[]).some((c) => c.name === 'external')) {
      this.sql.exec('ALTER TABLE _fm_containers ADD COLUMN external TEXT');
    }
    addExternalSizeColumn(this.sql);
    // When a container file was put in (seconds since 1970): its Last-Modified. Absent for files stored before it was kept.
    if (!(this.sql.prepare('PRAGMA table_info(_fm_containers)').all() as { name: string }[]).some((c) => c.name === 'stored')) {
      this.sql.exec('ALTER TABLE _fm_containers ADD COLUMN stored INTEGER');
    }
    this.externalRoots = externalRoots(dirname(path), name, this.schema?.containerDirectories?.map((d) => d.path) ?? []);
    this.externalDirectoryLinks = existingDirectoryLinks(this.externalRoots);
    if (existsSync(this.path + '.containers-out.json')) {
      this.sql.exec('BEGIN IMMEDIATE');
      try { this.recoverContainersOut(); this.sql.exec('COMMIT'); }
      catch (error) { this.sql.exec('ROLLBACK'); this.sql.close(); throw error; }
    }
    this.grantFullAccessClients();
    this.versionTriggers(false);
    ensureCacheVersions(this.sql);
    ensureContainerVersions(this.sql);
    this.designVersion = initialDesignVersion;
  }

  /**
   * A file's own [Full Access] often lists no extended privileges (FileMaker's
   * default), and FileMaker Server turns on fmapp for it when a file is hosted
   * with no sharing set up. So that a converted file opens for its administrator
   * straight away, [Full Access] gets fmapp and fmrest once, when the file is first
   * opened here; revoking them afterwards sticks.
   */
  private grantFullAccessClients(): void {
    if (!this.schema || this.meta('fullAccessClients')) return;
    try {
      const full = this.privilegeSets().find((p) => isFullAccess(p));
      if (full) {
        const missing = ['fmapp', 'fmrest'].filter((e) => !full.extendedPrivileges.includes(e));
        if (missing.length) this.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, ...missing] });
      }
      this.sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run('fullAccessClients', JSON.stringify(true));
    } catch {
      // a read-only copy: leave it as it is
    }
  }

  private meta(key: string) {
    const row = this.sql.prepare('SELECT json FROM _fm_meta WHERE key = ?').get(key) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : undefined;
  }

  // --- persistent data (Configure Persistent Data, GetPersistentData) ------------

  private persistentTable(): boolean {
    try {
      this.sql.exec('CREATE TABLE IF NOT EXISTS _fm_persistent (name TEXT NOT NULL, instance TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (name, instance))');
      return true;
    } catch {
      return false; // a read-only copy without the table
    }
  }

  /** An entry Configure Persistent Data stored, with its type; undefined when there is none. */
  persistentData(name: string, instance: string): Value | undefined {
    if (!this.persistentTable()) return undefined;
    const row = this.prepared('SELECT json FROM _fm_persistent WHERE name = ? AND instance = ?').get(name, instance) as { json: string } | undefined;
    if (!row) return undefined;
    const v = JSON.parse(row.json) as Value & { base64?: string };
    if (v.type === 'container' && v.base64 !== undefined) return { type: 'container', value: v.value, data: new Uint8Array(Buffer.from(v.base64, 'base64')) };
    return v;
  }

  persistentDataIds(name: string): string[] {
    if (!this.persistentTable()) return [];
    return (this.prepared('SELECT instance FROM _fm_persistent WHERE name = ? ORDER BY instance').all(name) as { instance: string }[]).map((r) => r.instance);
  }

  /** Stores an entry (keeping the value's type), or removes it when `value` is undefined; false when there was nothing to remove. */
  setPersistentData(name: string, instance: string, value: Value | undefined): boolean {
    this.persistentTable();
    if (value === undefined) return this.sql.prepare('DELETE FROM _fm_persistent WHERE name = ? AND instance = ?').run(name, instance).changes > 0;
    const json = value.type === 'container'
      ? JSON.stringify({ type: 'container', value: value.value, ...(value.data ? { base64: Buffer.from(value.data).toString('base64') } : {}) })
      : JSON.stringify(value);
    this.sql.prepare('INSERT INTO _fm_persistent VALUES (?, ?, ?) ON CONFLICT(name, instance) DO UPDATE SET json = excluded.json').run(name, instance, json);
    return true;
  }

  /** Folds the write-ahead log into the database file, so the file alone is complete — before copying or encrypting it. */
  checkpoint(): void {
    // Reads use their own lazily-opened connection. A cursor left at an async
    // boundary on that connection can hold a shared-cache table lock and make
    // a checkpoint throw SQLITE_LOCKED. Request reads themselves are
    // synchronous, so closing it here finalizes any abandoned cursors; the
    // next read opens a fresh connection.
    this.readOnlySql?.close();
    this.readOnlySql = undefined;
    const done = this.sql.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number } | undefined;
    // A reader that has not finished (the startup page check, a backup) holds the log back: the file alone is not
    // complete yet. Saying so beats copying or encrypting it as if it were.
    if (done?.busy) throw new StoreError(-1, `${this.name} is being read by a check that has not finished, so its changes could not be folded into the file. Try again in a moment.`);
  }

  /** The file format number now recorded in the file (a newer build opening it elsewhere raises it); see Host.checkFormats. */
  recordedFormat(): number | 'unreadable' {
    return storedFormat(this.sql);
  }

  close(): void {
    clearTimeout(this.denialTimer);
    this.denialPending.clear();
    clearTimeout(this.usageTimer);
    try { this.flushUsage(); } catch { /* the file is going away */ }
    this.results?.close();
    this.readOnlySql?.close();
    this.sql.close();
  }

  /**
   * Change logs (see server/src/logs.ts): hands `take` the write-ahead log,
   * every change since the last call, then folds it into the database and
   * empties it, unless `take` returns false (the log then keeps growing and
   * is offered again with later changes). Synchronous, so no write of this
   * connection falls between the two. Returns the bytes taken (0: no
   * changes, `take` not called). The server turns automatic checkpoints off
   * while it does this, so the log only resets here.
   */
  shipWal(take: (log: Buffer) => boolean): number {
    const wal = this.path + '-wal';
    const size = existsSync(wal) ? statSync(wal).size : 0;
    if (size === 0) return 0;
    if (take(readFileSync(wal))) this.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return size;
  }

  /**
   * Starts a trial: every change to this file from now on (records, globals,
   * accounts) is thrown away by `undo`. A SQLite savepoint; for running
   * scripts to see what they do without keeping what they did.
   */
  trial(): { undo(): void } {
    const name = `trial_${++this.trials}`;
    this.sql.exec(`SAVEPOINT ${name}`);
    this.openTrials++;
    return {
      undo: () => {
        this.openTrials--;
        this.sql.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        this.resetCaches();
        if (this.denialPending.size) this.scheduleDenials(0);
      },
    };
  }
  private trials = 0;
  private openTrials = 0;

  /** Changes so far may still be undone: a script's transaction or a trial is open on this file. */
  get undoable(): boolean {
    return this.heldBy !== undefined || this.openTrials > 0;
  }

  /** The transaction holding this file's savepoint, if any. */
  private heldBy?: Transaction;
  /** Changes made under the held savepoint, used to let another window commit on this file. */
  private heldSession?: Session;
  private heldAudit: { seq: number; onAudit?: (file: object, seq: number) => void }[] = [];
  private heldNewIds = new Map<string, number>();
  /** Container files written to disk (external storage) under the held transaction: removed if it rolls back. */
  private heldFiles: string[] = [];

  /**
   * Before a write: a script's open transaction takes this file (a savepoint),
   * and a write from another session while the transaction holds it is refused.
   */
  private joinTransaction(): void {
    const tx = writer.getStore()?.transaction?.open;
    if (this.heldBy && this.heldBy !== tx) throw new StoreError(301, 'Record is in use by another user (a transaction is open)');
    if (!tx || this.heldBy) return;
    const name = `tx_${++this.trials}`;
    // Outside any other transaction, the file's write lock is taken now (waiting for another process's write to
    // finish). A savepoint alone starts a deferred transaction: its first read fixes what it sees, and its first write
    // then fails at once with "database is locked" if another process (the warm-up worker, a cluster peer) wrote in between.
    const began = !this.sql.isTransaction;
    if (began) this.sql.exec('BEGIN IMMEDIATE');
    try {
      this.sql.exec(`SAVEPOINT ${name}`);
    } catch (e) {
      if (began) this.sql.exec('ROLLBACK');
      throw e;
    }
    this.heldBegan = began;
    this.heldBy = tx;
    tx.files.set(this, name);
    this.heldSession = this.sql.createSession();
  }

  /** Commit one other-window action while preserving this file's pending transaction. */
  independentWindowWrite<T>(tx: Transaction, run: () => T): T {
    if (this.heldBy !== tx) return run();
    if (!this.heldBegan || !this.heldSession) throw new StoreError(301, 'The transaction cannot be suspended on this file');
    const name = tx.files.get(this)!;
    const changes = this.heldSession.changeset();
    this.heldSession.close();
    this.heldSession = undefined;
    const audit = this.heldAudit.map(({ seq, onAudit }) => ({
      row: this.sql.prepare('SELECT * FROM _fm_audit WHERE seq = ?').get(seq) as Record<string, SQLInputValue>, onAudit,
    }));
    this.heldAudit = [];
    this.sql.exec(`ROLLBACK TO ${name}; RELEASE ${name}; COMMIT`);
    this.heldBy = undefined;
    this.heldBegan = false;
    tx.files.delete(this);
    this.resetCaches();
    let result!: T;
    let failed: unknown;
    try { result = run(); } catch (e) { failed = e; }
    try {
      // Rejoin using the originating transaction, regardless of the current window's writer context.
      writer.run({ ...writer.getStore(), transaction: { open: tx } }, () => this.joinTransaction());
      // Audit rows have generated sequence numbers and a hash chain. Reinsert and relink them
      // after the independent write, instead of replaying their old sequence numbers.
      // Node's changeset filter includes a table when it returns true. Rebuild the
      // audit chain separately and let write triggers update the version counters.
      const applied = this.sql.applyChangeset(changes, { filter: (table) =>
        !['_fm_audit', '_fm_record_chain_state', '_fm_metadata_versions', '_fm_cache_version'].includes(table) });
      if (!applied) throw new StoreError(301, 'The pending transaction could not be restored');
      for (const { row, onAudit } of audit) {
        const cols = Object.keys(row).filter((column) => !['seq', 'rchain_seq', 'rprev_hash', 'rhash'].includes(column));
        const inserted = this.sql.prepare(`INSERT INTO _fm_audit (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(...cols.map((column) => row[column]));
        const seq = Number(inserted.lastInsertRowid);
        linkRecordEntry(this.sql, seq);
        this.heldAudit.push({ seq, onAudit });
      }
      this.resetCaches();
    } catch (e) {
      // The independent commit stands. End the restored savepoint so no partial replay remains.
      this.endTransaction(tx, false);
      throw e;
    }
    if (failed !== undefined) throw failed;
    return result;
  }

  /** Publications belonging to the single-write transaction we own, never a caller's transaction. */
  private writePublications?: (() => void)[];

  /** Keep the record id, serial allocation, validation and write under one file lock. */
  private withWriteTransaction<T>(run: () => T): T {
    if (this.sql.isTransaction) return run();
    const publications: (() => void)[] = [];
    let result: T;
    this.sql.exec('BEGIN IMMEDIATE');
    this.writePublications = publications;
    try {
      result = run();
      this.sql.exec('COMMIT');
    } catch (e) {
      if (this.sql.isTransaction) this.sql.exec('ROLLBACK');
      this.resetCaches();
      throw e;
    } finally {
      this.writePublications = undefined;
    }
    for (const publish of publications) publish();
    return result;
  }
  /** Whether the held transaction's savepoint began the SQLite transaction (BEGIN IMMEDIATE), so ending it commits. */
  private heldBegan = false;

  /** Ends the transaction's hold on this file (see endTransaction). */
  endTransaction(tx: Transaction, keep: boolean): void {
    const name = tx.files.get(this);
    if (!name || this.heldBy !== tx) return;
    this.heldSession?.close();
    this.heldSession = undefined;
    const audit = this.heldAudit;
    this.heldAudit = [];
    this.heldNewIds.clear();
    this.heldBy = undefined;
    tx.files.delete(this);
    const written = this.heldFiles;
    this.heldFiles = [];
    const began = this.heldBegan;
    this.heldBegan = false;
    try {
      this.sql.exec(keep ? `RELEASE ${name}${began ? '; COMMIT' : ''}` : `ROLLBACK TO ${name}; RELEASE ${name}${began ? '; COMMIT' : ''}`);
    } catch (e) {
      // Never left open holding the file's write lock: what wasn't committed is undone.
      if (began && this.sql.isTransaction) this.sql.exec('ROLLBACK');
      this.resetCaches();
      throw e;
    }
    if (!keep) {
      this.resetCaches();
      // No container names them any more: the files go too, as if they had never been put in.
      // A file that can't be removed (in use, no permission) is only left behind: the rollback stands, and other files' holds still end.
      for (const f of written) {
        try { rmSync(f, { force: true }); } catch { /* orphaned file only */ }
      }
    }
    if (this.denialPending.size) this.scheduleDenials(0);
    if (keep) for (const entry of audit) entry.onAudit?.(this, entry.seq);
  }

  /** Copies the live database to `dest` while it stays in use (SQLite's online backup). */
  async backup(dest: string): Promise<void> {
    await backup(this.sql, dest);
  }

  // --- several users -------------------------------------------------------

  /** Throws FileMaker's 301 when someone other than the current writer is editing the record. */
  private checkLock(table: string, recordId: number): void {
    const lock = this.locks.holder(table, recordId);
    if (lock && lock.owner !== writer.getStore()?.owner) {
      throw new StoreError(301, `Record is in use by another user (${lock.account})`);
    }
  }

  /** Changes when another connection (another process) commits to the file; not for this connection's own writes. */
  private dataVersion(): number {
    return Number(((this.dataVersionQuery ??= this.sql.prepare('PRAGMA data_version')).get() as { data_version: number }).data_version);
  }

  /**
   * Results shared with the server's other processes and its background
   * warmer (results.ts), once shareResults() has been called; undefined
   * otherwise (a store used on its own, or one encrypted at rest).
   */
  results?: ResultCache;
  /** Set on the background warmer's own connection: it works results out afresh, never standing in an older one. */
  warming = false;
  /** Asks for this file's layout results to be worked out again in the background (set by the host). */
  warmSoon: () => void = () => {};

  /**
   * Works out every whole-table summary of a table in one pass over its
   * records (for the warmer): layouts showing different sets of them then
   * find each one kept, instead of each reading every record for its own.
   */
  warmSummaries(...args: Parameters<Store['warmSummariesCurrent']>): number {
    return this.withDesignRead(() => this.warmSummariesCurrent(...args));
  }

  private warmSummariesCurrent(table: string): number {
    const t = this.schema.tables.find((x) => x.name === table);
    if (!t) return 0;
    // Those some layout of the table shows (as a layout read works them out).
    const shown = new Set<string>();
    for (const l of this.schema.layouts) {
      try {
        const info = this.layout(l.name);
        if (info.owner !== this || info.table !== table) continue;
        for (const f of info.fields) if (!info.uses || info.uses.has(f.name.toLowerCase())) shown.add(f.name);
      } catch (e) {
        rethrowExecutionRefusal(e);
        // a layout with no table here
      }
    }
    const defs = t.fields.filter((f) => f.kind === 'summary' && f.summary && shown.has(f.name));
    if (!defs.length) return 0;
    this.calc.wholeTable(t, defs, { ...this.calc.newPass(), display: true });
    return defs.length;
  }
  private stampQuery?: StatementSync;
  private cacheStampQuery?: StatementSync;
  /** Which store file the counter belongs to: a file put in its place (reconverted, restored) starts a new series. */
  private stampFile = '';

  /**
   * Shares worked-out results through <store>.results, keyed by a data
   * version every change to a record moves, in any process: a counter that
   * triggers on each table keep, together with the store file's identity.
   * Kept up as tables are added.
   */
  shareResults(): void {
    if (this.results) return;
    try {
      this.versionTriggers();
      const st = statSync(this.path);
      this.stampFile = `${st.ino}.${Math.round(st.birthtimeMs || st.ctimeMs)}`;
      // Nothing is shared from inside a script's open transaction, a trial or any other transaction: it may yet be rolled back.
      this.results = new ResultCache(`${this.path}.results`, () => !!this.heldBy || this.openTrials > 0 || this.sql.isTransaction);
    } catch {
      // read-only or busy: results stay per process
    }
  }

  private versionTriggers(shared = true): void {
    const counter = shared ? '_fm_data_version' : '_fm_cache_version';
    const prefix = shared ? '_fm_dv_' : '_fm_cv_';
    // Nothing is written when all is in place already: another process may be in the middle of a write.
    const present = (this.sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(counter) as { n: number }).n > 0;
    if (!present) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ${counter} (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL)`);
      this.sql.exec(`INSERT OR IGNORE INTO ${counter} (id, n) VALUES (1, 0)`);
    }
    const existing = new Map((this.sql.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND name GLOB ?").all(`${prefix}*`) as { name: string; tbl_name: string }[]).map((r) => [r.name, r.tbl_name]));
    const tables = new Set((this.sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    for (const t of this.schema.tables) {
      if (!tables.has(t.name)) continue;
      for (const [k, event] of [['i', 'INSERT'], ['u', 'UPDATE'], ['d', 'DELETE']]) {
        const name = `${prefix}${k}_${t.id}`;
        const on = existing.get(name);
        if (on === t.name) continue;
        // A table id given again (a new table created with the id of a trashed one) finds the old table's trigger under its name:
        // that one stays with the trashed table, and this table needs its own.
        if (on !== undefined) this.sql.exec(`DROP TRIGGER IF EXISTS ${q(name)}`);
        this.sql.exec(`CREATE TRIGGER IF NOT EXISTS ${q(name)} AFTER ${event} ON ${q(t.name)} BEGIN UPDATE ${counter} SET n = n + 1; END`);
      }
    }
  }

  /**
   * The data version results are kept at: with shared results, the counter
   * every process moves; otherwise this connection's write token.
   */
  dataStamp(): string {
    const n = this.results ? this.versionNumber() : undefined;
    return n === undefined ? this.writeToken() : `${this.stampFile}/v${n}`;
  }

  private versionNumber(): number | undefined {
    try {
      return Number(((this.stampQuery ??= this.sql.prepare('SELECT n FROM _fm_data_version')).get() as { n: number }).n);
    } catch {
      return undefined;
    }
  }

  /**
   * Runs one record's write and, when that write was the only change to the
   * file meanwhile (no other process wrote, no transaction may roll it back),
   * brings the shared whole-table summaries it affects up to date at once
   * (Calculations.applyDelta) rather than leaving them for the warmer.
   */
  private changeOne<T>(table: Table, recordId: number, old: Row | undefined, run: () => T): T {
    if (!this.results || (this.sql.isTransaction && !this.writePublications) || !this.calc.summaryFields(table).length) return run();
    // In one write transaction, so no other process's write can land between reading the record, the write and the version.
    if (!this.sql.isTransaction) return this.withWriteTransaction(() => this.changeOne(table, recordId, old, run));
    const read = () => this.sql.prepare(`SELECT * FROM ${q(table.name)} WHERE _fm_record_id = ?`).get(recordId) as Row | undefined;
    const before = this.versionNumber();
    const was = old && read();
    const out = run();
    const after = this.versionNumber();
    const now = read();
    if (before !== undefined && after === before + 1) {
      try {
        const publish = this.calc.applyDelta(table, was, now, `${this.stampFile}/v${before}`, `${this.stampFile}/v${after}`);
        if (publish) this.writePublications!.push(publish);
      } catch (e) {
        rethrowExecutionRefusal(e);
        // left for the warmer
      }
    }
    return out;
  }

  /**
   * When each account (or '' for none) last changed this file from this
   * process: it then sees its own changes, never a result from before them.
   * The shared results file keeps the same for every process of the server,
   * since an account's next request may go to another one.
   */
  private readonly lastWrites = new Map<string, number>();
  /** When each account's latest change was last noted in the shared results file. */
  private readonly lastShared = new Map<string, number>();

  /** Whether `account` changed this file a moment ago (see lastWrites). */
  wroteRecently(account?: string): boolean {
    const mine = this.lastWrites.get(account ?? '') ?? -Infinity;
    if (performance.now() - mine < READ_YOUR_WRITES_MS) return true;
    const at = account ? this.results?.lastWrite(account) ?? 0 : 0;
    // Shared result metadata comes from other processes and survives restarts.
    return Date.now() - at < READ_YOUR_WRITES_MS;
  }

  /** Record and security changes, with counters that follow transactions, including rollback. */
  writeToken(): string {
    const row = (this.cacheStampQuery ??= this.sql.prepare('SELECT n, head_seq, head_hash FROM _fm_cache_version JOIN _fm_security_chain_state ON _fm_security_chain_state.id = 1')).get() as { n: number; head_seq: number; head_hash: string };
    return `${this.dataVersion()}:${row.n}:${row.head_seq}:${row.head_hash}`;
  }

  /**
   * Records in a table. Every page of records reports the total, and counting
   * scans the table, so the count is kept while its data token still holds.
   */
  recordCount(table: string): number {
    const token = this.writeToken();
    let kept = this.counts.value.get(table);
    if (!kept || kept.token !== token) {
      const n = Number((this.sql.prepare(`SELECT count(*) AS n FROM ${q(table)}`).get() as { n: number }).n);
      this.counts.value.set(table, kept = { token, n });
    }
    return kept.n;
  }

  /** Tells live clients about a change. */
  notify(kind: ChangeKind, table: string, recordId?: number, modId?: number, by?: { owner?: string; account?: string }, fields?: string[], ids?: number[]): void {
    if (this.writePublications) {
      this.writePublications.push(() => this.notify(kind, table, recordId, modId, by, fields, ids));
      return;
    }
    if (kind === 'create' || kind === 'delete' || kind === 'truncate') this.counts.value.delete(table);
    const w = by ?? writer.getStore();
    // A dry run's writes are rolled back, so nothing is told about them.
    if (writer.getStore()?.transaction?.open?.quiet) return;
    // Only a change to the data counts as a write (not viewing, locking or design).
    if (kind === 'create' || kind === 'update' || kind === 'delete' || kind === 'truncate') {
      const account = w?.account ?? '';
      const at = performance.now();
      this.lastWrites.set(account, at);
      // Shared at most every few seconds per account, and only for a signed-in account: changes made
      // with none (automations, maintenance) would otherwise hold back every such read on every process.
      if (account && this.results && at - (this.lastShared.get(account) ?? -Infinity) > WRITE_SHARE_MS) {
        this.results.wrote(account, Date.now());
        this.lastShared.set(account, at);
      }
    }
    if (!this.listeners.size) return;
    const change: Change = { kind, file: this.name, table, recordId, modId, account: w?.account, owner: w?.owner, ...(fields ? { fields } : {}), ...(ids ? { ids } : {}) };
    for (const l of this.listeners) {
      try {
        l(change);
      } catch (e) {
        rethrowExecutionRefusal(e);
        console.error(e);
      }
    }
  }

  // --- design mode --------------------------------------------------------

  /** Forget everything derived from the design: after this file's or a related file's design changed. */
  resetCaches(): void {
    this.designVersion = this.metadataVersions().design;
    this.currentSchema = this.meta('schema');
    // What a waiting request compares: a change only to the layouts or to which fields hold repetitions (the first
    // repetition written marks one) renews the schema object but is not a different file to that request.
    this.schemaText = undefined;
    // A remote design may first be observed inside preparation that later fails.
    // Forget published entries too, so that failure cannot revive the old design.
    this.designCache = new PreparedCache<LayoutDesigns | undefined>(undefined);
    this.repeating = this.meta('repeating') ?? {};
    this.layoutCache.invalidate((cache) => cache.clear());
    this.externalNamed.invalidate((cache) => cache.clear());
    this.privilegeCache.invalidate((cache) => cache.clear());
    this.counts.invalidate((cache) => cache.clear());
    this.allowedCache.invalidate((cache) => cache.clear());
    this.words.reset();
    this.textStyles?.reset();
    this.calc = new Calculations(this);
    // Local cache tokens are available even when shared summary results are off.
    this.versionTriggers(false);
    // New or renamed tables move the shared data version too.
    if (this.results) {
      try {
        this.versionTriggers();
      } catch {
        this.results.close();
        this.results = undefined;
      }
    }
  }

  /**
   * Change the solution's design: tables, fields, relationships, value lists,
   * custom functions, layouts, scripts (see DesignOp). All changes apply or
   * none do. Returns the changes as logged, with names resolved to ids.
   */
  /** Checks design changes without making them: the changes as they would apply, or the error applyDesign would give. */
  checkDesign(ops: DesignOp[]): { applied: DesignOp[]; schema: Schema; designs: LayoutDesigns; privileges: PrivilegeDefinition[] } {
    try {
      const r = applyOps({ schema: this.schema, designs: this.designs(), privileges: this.privilegeSets(), fileMode: this.fileMode }, ops, (id) => this.deletedDesign(id));
      return { applied: r.ops, schema: r.state.schema, designs: r.state.designs, privileges: r.state.privileges ?? this.privilegeSets() };
    } catch (e) {
      if (e instanceof DesignError) throw new StoreError(e.code, e.message);
      throw e;
    }
  }

  applyDesign(ops: DesignOp[], opts: WriteOptions = {}): { applied: DesignOp[] } {
    this.joinTransaction();
    const was = this.schema;
    let result;
    // Renames and deletes must follow through to privilege sets (per-object
    // access is keyed by name, record-access rules are formulas); carry them in
    // so applyOps can rewrite them, and remember each set's state to spot which changed.
    const privBefore = new Map(this.privilegeSets().map((p) => [p.name, JSON.stringify(p)]));
    try {
      result = applyOps({ schema: this.schema, designs: this.designs(), privileges: [...privBefore.keys()].map((n) => JSON.parse(privBefore.get(n)!) as PrivilegeDefinition), fileMode: this.fileMode }, ops, (id) => this.deletedDesign(id) ?? (opts.recordedRestore ? this.recordedRestore(ops, id) : undefined));
    } catch (e) {
      if (e instanceof DesignError) throw new StoreError(e.code, e.message);
      throw e;
    }
    const nested = this.sql.isTransaction;
    this.sql.exec(nested ? 'SAVEPOINT security_design' : 'BEGIN IMMEDIATE');
    try {
      // Their triggers name columns, which would block dropping or changing them; finds build them again.
      this.words.dropAll();
      this.designAccount = opts.account ?? null;
      const recompute: Extract<Effect, { k: 'recompute' }>[] = [];
      for (const e of result.effects) {
        if (e.k === 'recompute') recompute.push(e);
        else this.designEffect(e);
        crashPoint('design-apply:after-effect');
      }
      writeDesign(this.sql, result.state.schema, result.state.designs);
      crashPoint('design-apply:after-schema');
      // Persist any privilege set whose access keys or rule calcs the rename/delete rewrote.
      const savePriv = this.sql.prepare('INSERT INTO _fm_privileges (name, json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json');
      for (const set of result.state.privileges ?? []) {
        const json = JSON.stringify(set);
        if (privBefore.get(set.name) !== json) savePriv.run(set.name, json);
      }
      const log = this.sql.prepare(`INSERT INTO ${DESIGN_LOG} (at, account, op) VALUES (?, ?, ?)`);
      const at = new Date().toISOString();
      for (const op of result.ops) log.run(at, opts.account ?? null, JSON.stringify(op));
      crashPoint('design-apply:after-log');
      if (result.ops.length) {
        const byOp: Record<string, number> = {};
        for (const op of result.ops) byOp[op.op] = (byOp[op.op] ?? 0) + 1;
        this.logSecurity('schema-changed', { account: opts.account ?? null, detail: { ops: byOp, count: result.ops.length } });
      }
      this.resetCaches();
      for (const e of recompute) this.recompute(e.table, e.field);
      crashPoint('design-apply:before-commit');
      this.sql.exec(nested ? 'RELEASE security_design' : 'COMMIT');
      crashPoint('design-apply:after-commit');
    } catch (e) {
      if (this.sql.isTransaction) this.sql.exec(nested ? 'ROLLBACK TO security_design; RELEASE security_design' : 'ROLLBACK');
      this.resetCaches();
      throw e instanceof DesignError ? new StoreError(e.code, e.message) : e;
    }
    this.onDesignChange();
    if (result.ops.length) {
      // Design mode in other windows reloads what changed (the layouts by id, so an open layout editor knows it's its own).
      const layoutId = (ref: unknown) => (typeof ref === 'number' ? ref : this.schema.layouts.find((l) => l.name === ref)?.id);
      const layouts = new Set<number>();
      for (const op of result.ops) {
        const id = op.op === 'updateLayout' || op.op === 'deleteLayout' ? layoutId(op.layout) : op.op === 'createLayout' ? (op.id ?? layoutId(op.name)) : undefined;
        if (id !== undefined) layouts.add(id);
      }
      const who = opts.account ? { ...writer.getStore(), account: opts.account } : undefined;
      this.notify('design', DESIGN_TABLE, undefined, undefined, who, undefined, [...layouts]);
      // Scripts and tables (with their fields) too, so a script being edited elsewhere merges, and Tables & fields refreshes.
      const idOf = (list: 'scripts' | 'tables', ref: unknown) => typeof ref === 'number' ? ref
        : (this.schema[list] as { id: number; name: string }[]).find((x) => x.name === ref)?.id ?? (was[list] as { id: number; name: string }[]).find((x) => x.name === ref)?.id;
      const scripts = new Set<number>();
      const tables = new Set<number>();
      for (const op of result.ops) {
        const o = op as { op: string; script?: unknown; table?: unknown; id?: number; name?: string };
        const script = o.op === 'updateScript' || o.op === 'deleteScript' ? idOf('scripts', o.script) : o.op === 'createScript' ? (o.id ?? idOf('scripts', o.name)) : undefined;
        if (script !== undefined) scripts.add(script);
        const table = ['renameTable', 'deleteTable', 'createField', 'updateField', 'deleteField'].includes(o.op) ? idOf('tables', o.table) : o.op === 'createTable' ? (o.id ?? idOf('tables', o.name)) : undefined;
        if (table !== undefined) tables.add(table);
      }
      if (scripts.size) this.notify('design', DESIGN_SCRIPTS, undefined, undefined, who, undefined, [...scripts]);
      if (tables.size) this.notify('design', DESIGN_TABLES, undefined, undefined, who, undefined, [...tables]);
    }
    return { applied: result.ops };
  }

  /** Design changes made in this store, oldest first. */
  /**
   * Who changed which record and when: creates (with their values), edits
   * (each field's old and new value) and deletes (the record as it was).
   */
  auditLog(filter: { table?: string; recordId?: number; account?: string; since?: string; until?: string; kind?: string; kinds?: string[]; security?: boolean; agent?: boolean; surface?: string; script?: string; limit?: number; afterSeq?: number } = {}): AuditEntry[] {
    const where: string[] = [];
    const args: SqlValue[] = [];
    if (filter.table !== undefined) { where.push('tbl = ? COLLATE NOCASE'); args.push(filter.table); }
    if (filter.recordId !== undefined && Number.isFinite(filter.recordId)) { where.push('record_id = ?'); args.push(filter.recordId); }
    if (filter.account !== undefined) { where.push('account = ? COLLATE NOCASE'); args.push(filter.account); }
    if (filter.kind !== undefined) { where.push('kind = ?'); args.push(filter.kind); }
    if (filter.kinds !== undefined && filter.kinds.length) { where.push(`kind IN (${filter.kinds.map(() => '?').join(', ')})`); args.push(...filter.kinds); }
    if (filter.security !== undefined) { where.push('security = ?'); args.push(filter.security ? 1 : 0); }
    if (filter.agent !== undefined) { where.push('agent = ?'); args.push(filter.agent ? 1 : 0); }
    if (filter.surface !== undefined) { where.push('surface = ? COLLATE NOCASE'); args.push(filter.surface); }
    if (filter.script !== undefined) { where.push('script = ? COLLATE NOCASE'); args.push(filter.script); }
    // A wall clock can move backwards after crossing a boundary. Treat the first crossing in insertion order as the
    // boundary, then use the monotonic seq for every later entry. This keeps subsequent corrected-clock writes in
    // a `since` window and excludes them from the preceding `until` window. `afterSeq` remains the precise cursor.
    if (filter.since !== undefined) { where.push('seq >= (SELECT MIN(seq) FROM _fm_audit WHERE at >= ?)'); args.push(filter.since); }
    if (filter.until !== undefined) { where.push('seq < COALESCE((SELECT MIN(seq) FROM _fm_audit WHERE at > ?), 9223372036854775807)'); args.push(filter.until); }
    // After a given entry: the first ones after it (oldest first), rather than the latest.
    if (filter.afterSeq !== undefined) { where.push('seq > ?'); args.push(filter.afterSeq); }
    const rows = this.sql.prepare(`SELECT seq, at, account, kind, tbl, record_id, changes, security, agent, surface, script, copy_of, revert_of FROM _fm_audit${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY seq ${filter.afterSeq !== undefined ? 'ASC' : 'DESC'} LIMIT ?`)
      .all(...args, Number.isFinite(filter.limit) ? Math.max(1, Math.min(Math.trunc(filter.limit!), 10_000)) : 200) as { seq: number; at: string; account: string | null; kind: string; tbl: string; record_id: number | null; changes: string | null; security: number; agent: number; surface: string | null; script: string | null; copy_of: number | null; revert_of: number | null }[];
    return (filter.afterSeq !== undefined ? rows : rows.reverse()).map((r) => {
      const base = { seq: Number(r.seq), at: r.at, account: r.account, kind: r.kind as AuditEntry['kind'], table: r.tbl, ...(r.agent ? { agent: true } : {}) };
      const parsed = r.changes ? JSON.parse(r.changes) as Record<string, unknown> : undefined;
      if (r.security) {
        const { target, from, ...rest } = parsed ?? {};
        return {
          ...base, security: true,
          ...(typeof target === 'string' ? { target } : {}),
          ...(typeof from === 'string' && from ? { from } : {}),
          ...(Object.keys(rest).length ? { changes: rest } : {}),
        };
      }
      return {
        ...base,
        ...(r.record_id !== null ? { recordId: Number(r.record_id) } : {}),
        ...(r.surface ? { surface: r.surface } : {}),
        ...(r.script ? { script: r.script } : {}),
        ...(r.copy_of !== null ? { copyOf: Number(r.copy_of) } : {}),
        ...(r.revert_of !== null ? { revertOf: Number(r.revert_of) } : {}),
        ...(parsed ? { changes: parsed } : {}),
      };
    });
  }

  /**
   * The security and authentication events only (no record-data changes),
   * newest last, each with the group it belongs to, a plain-English description
   * and a severity — the shape the /admin security event log and its CSV export
   * render. `category` resolves to that group's kinds; `kind` narrows to one;
   * `target` and `from` match case-insensitively on the object acted on and the
   * place it came from.
   */
  securityEvents(filter: { account?: string; target?: string; from?: string; category?: string; kind?: string; since?: string; until?: string; limit?: number } = {}): SecurityEvent[] {
    const kinds = filter.kind ? [filter.kind]
      : filter.category ? [...categoryKinds(filter.category)]
      : undefined;
    // A named category that matches no kinds means "show none", not "show all".
    if (kinds && kinds.length === 0) return [];
    const entries = this.auditLog({
      security: true,
      ...(filter.account !== undefined ? { account: filter.account } : {}),
      ...(filter.since !== undefined ? { since: filter.since } : {}),
      ...(filter.until !== undefined ? { until: filter.until } : {}),
      ...(kinds ? { kinds } : {}),
      limit: filter.limit,
    });
    const target = filter.target?.trim().toLowerCase();
    const from = filter.from?.trim().toLowerCase();
    return entries
      .filter((e) => !target || (e.target ?? '').toLowerCase().includes(target))
      .filter((e) => !from || (e.from ?? '').toLowerCase().includes(from))
      .map((e) => ({
        ...e,
        category: securityEventCategory(e.kind) ?? 'Other',
        description: describeSecurityEvent(e),
        severity: securityEventSeverity(e.kind),
      }));
  }

  /** A prepared statement for `text`, kept for reuse (SQLite re-prepares it itself after a schema change). */
  private prepared(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) {
      if (this.statements.size >= 1000) this.statements.clear();
      st = this.sql.prepare(text);
      this.statements.set(text, st);
    }
    return st;
  }

  /**
   * A record as it was right after audit entry `seq` (0: before any change the
   * log holds), worked back from how it is now through the log's later entries.
   * undefined when it didn't exist then. Throws when the log can't say: the
   * table was emptied (Truncate Table) since.
   */
  recordAsOf(table: string, recordId: number, seq: number): Record<string, SqlValue> | undefined {
    const t = this.schema?.tables.find((x) => x.name.toLowerCase() === table.toLowerCase());
    if (!t) throw new StoreError(106, `Table "${table}" is missing`);
    const truncated = this.sql.prepare("SELECT 1 FROM _fm_audit WHERE security = 0 AND kind = 'truncate' AND tbl = ? COLLATE NOCASE AND seq > ?").get(t.name, seq);
    if (truncated) throw new StoreError(500, `${t.name} was emptied since then, so the record can't be put back from the audit log`);
    const now = this.sql.prepare(`SELECT * FROM ${q(t.name)} WHERE _fm_record_id = ?`).get(recordId) as Record<string, SqlValue> | undefined;
    let row: Record<string, SqlValue> | undefined = now && Object.fromEntries(Object.entries(now).filter(([k]) => !k.startsWith('_fm_')));
    const columns = new Set((this.sql.prepare(`PRAGMA table_info(${q(t.name)})`).all() as { name: string }[]).map((c) => c.name).filter((c) => !c.startsWith('_fm_')));
    const later = this.sql.prepare('SELECT kind, changes FROM _fm_audit WHERE security = 0 AND tbl = ? COLLATE NOCASE AND record_id = ? AND seq > ? ORDER BY seq DESC')
      .all(t.name, recordId, seq) as { kind: string; changes: string | null }[];
    for (const e of later) {
      const changes = e.changes ? JSON.parse(e.changes) as Record<string, unknown> : {};
      if (e.kind === 'create') row = undefined; // not there before it was made
      else if (e.kind === 'delete') {
        // The values it held when deleted (empty ones aren't logged).
        row = Object.fromEntries([...columns].map((c) => [c, (changes[c] === NOT_LOGGED ? null : changes[c] ?? null) as SqlValue]));
      } else if (e.kind === 'update' && row) {
        for (const [key, pair] of Object.entries(changes)) {
          const col = key.replace(/\(\d+\)$/, '');
          // A value the log doesn't keep stays as it is now.
          if (columns.has(col) && Array.isArray(pair) && pair[0] !== NOT_LOGGED) row[col] = pair[0] as SqlValue;
        }
      }
    }
    return row;
  }

  /**
   * Puts a record back as it was right after audit entry `seq` (see
   * recordAsOf): changed fields set back, a deleted record made again with its
   * id, a record made since deleted. Logged and announced like any change.
   */
  restoreRecord(table: string, recordId: number, seq: number, opts: WriteOptions = {}): { action: 'updated' | 'created' | 'deleted' | 'unchanged'; fields: string[] } {
    const then = this.recordAsOf(table, recordId, seq);
    const t = this.schema!.tables.find((x) => x.name.toLowerCase() === table.toLowerCase())!;
    const T = q(t.name);
    this.checkLock(t.name, recordId);
    const now = this.sql.prepare(`SELECT * FROM ${T} WHERE _fm_record_id = ?`).get(recordId) as Record<string, SqlValue> | undefined;
    if (!then && !now) return { action: 'unchanged', fields: [] };
    if (!then) {
      this.sql.prepare(`DELETE FROM ${T} WHERE _fm_record_id = ?`).run(recordId);
      this.audit('delete', t.name, recordId, Object.fromEntries(Object.entries(now!).filter(([k, v]) => !k.startsWith('_fm_') && v !== null)), opts);
      this.notify('delete', t.name, recordId);
      return { action: 'deleted', fields: [] };
    }
    const cols = Object.keys(then);
    if (!now) {
      this.sql.prepare(`INSERT INTO ${T} (_fm_record_id, ${cols.map(q).join(', ')}) VALUES (?${', ?'.repeat(cols.length)})`).run(recordId, ...cols.map((c) => then[c]));
      this.audit('create', t.name, recordId, Object.fromEntries(cols.filter((c) => then[c] !== null).map((c) => [c, then[c]])), opts);
      this.notify('create', t.name, recordId, 0);
      return { action: 'created', fields: cols.filter((c) => then[c] !== null) };
    }
    const diff = cols.filter((c) => (now[c] ?? null) !== (then[c] ?? null));
    if (!diff.length) return { action: 'unchanged', fields: [] };
    this.sql.prepare(`UPDATE ${T} SET _fm_mod_id = _fm_mod_id + 1, ${diff.map((c) => `${q(c)} = ?`).join(', ')} WHERE _fm_record_id = ?`).run(...diff.map((c) => then[c]), recordId);
    this.audit('update', t.name, recordId, Object.fromEntries(diff.map((c) => [c, [now[c] ?? null, then[c] ?? null]])), opts);
    this.notify('update', t.name, recordId, Number(now._fm_mod_id) + 1);
    return { action: 'updated', fields: diff };
  }

  /**
   * Puts back what one audit entry changed, as the account (its privileges apply, so it can put back only what it
   * could change by hand): an edit's fields get their old values again (`fields` picks some), a created record is
   * deleted, a deleted record is made again under its id. The change is logged like any other, saying which entry it
   * reverts. Fields whose values were not logged, containers and repetitions are left as they are and listed as skipped.
   */
  revertAuditEntry(layout: string, recordId: number, seq: number, opts: WriteOptions & { fields?: string[] } = {}): { action: 'updated' | 'deleted' | 'created'; fields: string[]; skipped: { field: string; reason: string }[] } {
    const info = this.layout(layout);
    const entry = Number.isInteger(seq) && seq > 0 ? this.auditLog({ afterSeq: seq - 1, limit: 1 })[0] : undefined;
    if (!entry || entry.seq !== seq || entry.security || entry.recordId !== recordId || entry.table.toLowerCase() !== info.table.toLowerCase()) {
      throw new StoreError(101, `Audit entry ${seq} is not a change to this record`);
    }
    const w = { ...writer.getStore(), revertOf: seq, ...(opts.account ? { account: opts.account } : {}) };
    const changes = (entry.changes ?? {}) as Record<string, unknown>;
    const write: WriteOptions = { account: opts.account, privileges: opts.privileges };
    return writer.run(w, () => {
      if (entry.kind === 'create') {
        this.delete(info, recordId, write);
        return { action: 'deleted' as const, fields: [], skipped: [] };
      }
      if (entry.kind === 'delete') {
        const row: Record<string, SqlValue> = { _fm_record_id: recordId, _fm_mod_id: 0 };
        for (const [k, v] of Object.entries(changes)) if (v !== NOT_LOGGED && !/\(\d+\)$/.test(k)) row[k] = v as SqlValue;
        // Making the record again is a create: the same checks as a create (layout, every field written, an agent's approval).
        const data = Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_fm_'))) as FieldData;
        this.checkLayout(info, opts.privileges);
        this.checkWriteFields(info, opts.privileges, fieldNames(data));
        this.checkLayout(info, opts.privileges, true);
        this.gateAgentWrite(opts, 'create', info, undefined, data, undefined);
        this.restoreDeletedRow(info.table, row, write);
        return { action: 'created' as const, fields: Object.keys(row).filter((k) => !k.startsWith('_fm_')), skipped: [] };
      }
      if (entry.kind !== 'update') throw new StoreError(500, `A ${entry.kind} can't be reverted`);
      const wanted = opts.fields && new Set(opts.fields.map((f) => f.toLowerCase()));
      const data: Record<string, string> = {};
      const skipped: { field: string; reason: string }[] = [];
      const pv = this.local(opts.privileges);
      const unseen = (field: string) => !!pv && pv.field(info.table, field.replace(/\(\d+\)$/, '')) === 'none';
      for (const [field, pair] of Object.entries(changes)) {
        if (wanted && !wanted.has(field.toLowerCase())) continue;
        const def = info.fields.find((f) => f.name === field);
        if (!Array.isArray(pair)) continue;
        if (unseen(field)) skipped.push({ field, reason: 'can\'t be put back' });
        else if (/\(\d+\)$/.test(field)) skipped.push({ field, reason: 'a repetition can\'t be put back from the log' });
        else if (!def) skipped.push({ field, reason: 'not on this layout' });
        else if (def.type === 'container') skipped.push({ field, reason: 'a container\'s file isn\'t kept in the log' });
        else if (pair[0] === NOT_LOGGED) skipped.push({ field, reason: 'its value was not logged' });
        else data[field] = pair[0] === null ? '' : String(pair[0]);
      }
      if (wanted) for (const f of wanted) if (!Object.keys(changes).some((k) => k.toLowerCase() === f)) skipped.push({ field: f, reason: unseen(f) ? 'can\'t be put back' : 'not changed by that entry' });
      if (Object.keys(data).length) this.update(info, recordId, data, undefined, { ...write, restoring: true, dataEntry: true });
      return { action: 'updated' as const, fields: Object.keys(data), skipped };
    });
  }

  private auditConfig?: { at: number; value: AuditSettings };

  /** What the audit log keeps out of its entries: fields whose values are never logged. */
  auditSettings(): AuditSettings {
    const now = performance.now();
    if (!this.auditConfig || now - this.auditConfig.at > 2000) {
      const stored = this.meta('auditSettings') as Partial<AuditSettings> | undefined;
      this.auditConfig = { at: now, value: {
        redactSensitive: stored?.redactSensitive === true,
        excludeFields: Object.fromEntries(Object.entries(stored?.excludeFields ?? {}).map(([t, fs]) => [t, [...new Set((fs ?? []).map(String))]])),
        logReads: stored?.logReads === true,
        retentionDays: Number.isFinite(stored?.retentionDays) && stored!.retentionDays! > 0 ? Math.floor(stored!.retentionDays!) : 0,
      } };
    }
    return this.auditConfig.value;
  }

  /** Sets which fields the audit log never records values of (by table), and whether names that look like passwords, keys and card numbers are left out too. */
  setAuditSettings(change: Partial<AuditSettings>): AuditSettings {
    const current = this.auditSettings();
    const next: AuditSettings = {
      redactSensitive: change.redactSensitive ?? current.redactSensitive,
      excludeFields: change.excludeFields ?? current.excludeFields,
      logReads: change.logReads ?? current.logReads,
      retentionDays: change.retentionDays ?? current.retentionDays,
    };
    if (!Number.isInteger(next.retentionDays) || next.retentionDays < 0 || next.retentionDays > 36_500) throw new StoreError(960, 'Retention is a whole number of days, 0 to keep every entry');
    const tables = new Map((this.schema?.tables ?? []).map((t) => [t.name.toLowerCase(), t]));
    const clean: Record<string, string[]> = {};
    for (const [name, fields] of Object.entries(change.excludeFields === undefined ? {} : next.excludeFields)) {
      // An entry already saved for a table or field that is in the trash stays as it was: putting it back must not start logging it in clear.
      const saved = (n: string) => Object.entries(current.excludeFields).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1];
      const t = tables.get(name.toLowerCase());
      if (!t) {
        if (saved(name)) { clean[name] = saved(name)!; continue; }
        throw new StoreError(106, `Table "${name}" is missing`);
      }
      const known = new Set(t.fields.map((f) => f.name.toLowerCase()));
      const was = new Set((saved(name) ?? []).map((f) => f.toLowerCase()));
      const gone = fields.filter((f) => !known.has(f.toLowerCase()) && was.has(f.toLowerCase()));
      const missing = fields.filter((f) => !known.has(f.toLowerCase()) && !was.has(f.toLowerCase()));
      if (missing.length) throw new StoreError(102, `Field "${missing[0]}" is missing in ${t.name}`);
      const keep = [...new Set([...fields.filter((f) => !gone.includes(f)).map((f) => t.fields.find((x) => x.name.toLowerCase() === f.toLowerCase())!.name), ...gone])];
      if (keep.length) clean[t.name] = keep;
    }
    if (change.excludeFields !== undefined) next.excludeFields = clean;
    this.sql.prepare(`INSERT INTO _fm_meta VALUES ('auditSettings', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(next));
    this.auditConfig = undefined;
    const was = JSON.stringify(current), now = JSON.stringify(next);
    if (was !== now) {
      const parts = [
        next.redactSensitive !== current.redactSensitive ? `sensitive-name redaction ${next.redactSensitive ? 'on' : 'off'}` : '',
        JSON.stringify(next.excludeFields) !== JSON.stringify(current.excludeFields) ? `${Object.values(next.excludeFields).flat().length} field${Object.values(next.excludeFields).flat().length === 1 ? '' : 's'} left out` : '',
        next.logReads !== current.logReads ? `reads ${next.logReads ? 'logged' : 'not logged'}` : '',
        next.retentionDays !== current.retentionDays ? (next.retentionDays ? `entries kept ${next.retentionDays} days` : 'entries kept forever') : '',
      ].filter(Boolean);
      this.logSecurity('audit-settings-changed', { account: writer.getStore()?.account ?? null, detail: { summary: parts.join('; ') } });
    }
    return next;
  }

  /** Checks the record audit chain on a separate read-only connection. */
  verifyRecordAudit(): RecordAuditVerification {
    return verifyRecordAudit(this.path);
  }

  /** Removes record entries older than the retention setting (or `days`), recording in the chain that they were; returns how many went. */
  pruneAudit(days = this.auditSettings().retentionDays, now = Date.now()): number {
    if (!(days > 0) || this.sql.isTransaction) return 0;
    const cutoff = new Date(now - days * 86_400_000).toISOString();
    const through = (this.sql.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM _fm_audit WHERE security = 0 AND at < ?').get(cutoff) as { n: number }).n;
    if (!through) return 0;
    const removed = pruneRecordEntries(this.sql, Number(through));
    if (removed) this.logSecurity('audit-pruned', { detail: { removed, through: Number(through), days } });
    return removed;
  }

  /** Fields whose names look sensitive (password, secret, token, API key, card number) that the audit log still records values of, by table. */
  auditSuggestedExclusions(): Record<string, string[]> {
    const s = this.auditSettings();
    const out: Record<string, string[]> = {};
    for (const t of this.schema?.tables ?? []) {
      const listed = new Set((Object.entries(s.excludeFields).find(([n]) => n.toLowerCase() === t.name.toLowerCase())?.[1] ?? []).map((f) => f.toLowerCase()));
      const names = t.fields.filter((f) => f.kind === 'normal' && !listed.has(f.name.toLowerCase()) && SENSITIVE_FIELD.test(f.name.replace(/([a-z])([A-Z])/g, '$1 $2'))).map((f) => f.name);
      if (names.length) out[t.name] = names;
    }
    return out;
  }

  /**
   * Logs that an account read records, when the file's audit settings ask for it (off by default): one entry per
   * request with the table and the ids it returned (the first 100 are listed). Never the values read.
   */
  logRead(table: string, recordIds: number[], opts: WriteOptions = {}, total = recordIds.length): void {
    if (!total || !this.auditSettings().logReads) return;
    this.audit('read', table, total === 1 ? recordIds[0] : undefined, { records: total, ...(total > 1 ? { ids: recordIds.slice(0, 100) } : {}) }, opts);
  }

  /**
   * Logs that an account ran a read-only SQL query, when read logging is on: one entry for each table of this file the
   * query names, with the number of rows the query returned. Never the query text (it can hold values) or the rows.
   */
  logQuery(sqlText: string, rows: number, opts: WriteOptions = {}): void {
    if (!this.auditSettings().logReads) return;
    // Names inside string literals are values, not tables.
    const text = sqlText.replace(/'(?:[^']|'')*'/g, "''");
    for (const t of this.schema?.tables ?? []) {
      const name = t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![\\w$])"?${name}"?(?![\\w$])`, 'i').test(text)) this.audit('read', t.name, undefined, { query: true, rows }, opts);
    }
  }

  /**
   * Logs that an account read the file's design (its tables, scripts, layouts, formulas or privilege sets) through
   * the named AI tool, when read logging is on. Never what the tool returned.
   */
  logDesignRead(tool: string, opts: WriteOptions = {}): void {
    if (!this.auditSettings().logReads) return;
    this.audit('read', DESIGN_TABLE, undefined, { design: tool }, opts);
  }

  /** Logs that an account read a container's file, when read logging is on: its id, name and size, never its contents. */
  logContainerRead(id: number, filename: string | null, bytes: number, opts: WriteOptions = {}): void {
    if (!this.auditSettings().logReads) return;
    this.audit('read', '_containers', id, { container: filename ?? null, bytes }, opts);
  }

  /** Whether the audit log leaves out this field's values. */
  private auditHides(table: string, field: string): boolean {
    const s = this.auditSettings();
    const name = field.replace(/\(\d+\)$/, '');
    if (s.redactSensitive && SENSITIVE_FIELD.test(name.replace(/([a-z])([A-Z])/g, '$1 $2'))) return true;
    const listed = Object.entries(s.excludeFields).find(([t]) => t.toLowerCase() === table.toLowerCase())?.[1];
    return !!listed?.some((f) => f.toLowerCase() === name.toLowerCase());
  }

  private audit(kind: AuditEntry['kind'], table: string, recordId: number | undefined, changes: Record<string, unknown> | undefined, opts: WriteOptions, copyOf?: number): void {
    const w = writer.getStore();
    const account = opts.account ?? w?.account ?? opts.privileges?.account ?? null;
    let logged = changes;
    if (changes && (kind === 'create' || kind === 'update' || kind === 'delete')) {
      logged = Object.fromEntries(Object.entries(changes).map(([field, v]) => [field, this.auditHides(table, field) ? (kind === 'update' ? [NOT_LOGGED, NOT_LOGGED] : NOT_LOGGED) : v]));
    }
    const json = logged && JSON.stringify(logged, (_k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : typeof v === 'bigint' ? Number(v) : v));
    const agent = account && this.isAgent(account) ? 1 : 0;
    const r = this.prepared('INSERT INTO _fm_audit (at, account, kind, tbl, record_id, changes, security, agent, surface, script, copy_of, revert_of) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), account, kind, table, recordId ?? null, json ?? null, agent, w?.surface ?? null, w?.script ?? null, copyOf ?? null, w?.revertOf ?? null);
    const seq = Number(r.lastInsertRowid);
    const pending = this.heldBy !== undefined && this.heldBy === w?.transaction?.open;
    if (pending) this.heldAudit.push({ seq, onAudit: w?.onAudit });
    linkRecordEntry(this.sql, seq);
    if (!pending) w?.onAudit?.(this, seq);
  }

  private readonly denialKeys = new Map<string, number>();
  private readonly denialPending = new Map<string, { account: string; target: string; audit: DenialAudit; detail: Record<string, unknown>; expires: number; attempts: number; retryAt?: number }>();
  private denialTimer?: ReturnType<typeof setTimeout>;
  private denialBudget: number[] = [];
  private denialWrites: number[] = [];
  private readonly denialCounts = { failures: 0, drops: 0 };

  get privilegeDenialAuditSuppressed(): boolean { return this.openTrials > 0; }

  /** Aggregate delivery diagnostics only; no errors or event payloads. */
  privilegeDeniedStats(): { failures: number; drops: number; pending: number; keys: number } {
    return { ...this.denialCounts, pending: this.denialPending.size, keys: this.denialKeys.size };
  }

  /** A sampled refusal history, repeat-suppressed within this process and owning file. */
  recordPrivilegeDenied(denial: AccessDenial, audit: DenialAudit): void {
    const context = accessDenialContext(denial);
    // Trials are diagnostics, not production operations.
    if (context?.file !== this || denialAuditSuppressed(denial)) return;
    const now = performance.now();
    for (const [key, at] of this.denialKeys) if (at <= now - 600_000) this.denialKeys.delete(key);
    for (const [key, item] of this.denialPending) if (item.expires <= now) { this.denialPending.delete(key); this.denialCounts.drops++; }
    const key = JSON.stringify([context.account, audit.surface, denial.operation, denial.permission,
      denial.policyFingerprint, denial.source, denial.location]);
    if (this.denialKeys.has(key) || this.denialPending.has(key)) return;
    this.denialBudget = this.denialBudget.filter((at) => at > now - 60_000);
    if (this.denialBudget.length >= 60 || this.denialPending.size >= 500) { this.denialCounts.drops++; return; }
    while (this.denialKeys.size + this.denialPending.size >= 500 && this.denialKeys.size) this.denialKeys.delete(this.denialKeys.keys().next().value!);
    this.denialBudget.push(now);
    this.denialPending.set(key, { account: context.account, target: denial.privilegeSet,
      audit: { ...audit }, detail: denialAuditDetail(denial, audit), expires: now + 600_000, attempts: 0 });
    this.drainDenials();
  }

  private scheduleDenials(ms: number): void {
    clearTimeout(this.denialTimer);
    // An unrelated script's async transaction context must never reach the append.
    writer.exit(() => {
      this.denialTimer = setTimeout(() => this.drainDenials(), ms);
      this.denialTimer.unref();
    });
  }

  private drainDenials(): void {
    clearTimeout(this.denialTimer);
    writer.exit(() => {
      const now = performance.now();
      this.denialWrites = this.denialWrites.filter((at) => at > now - 60_000);
      for (const [key, item] of this.denialPending) {
        if (item.expires <= now) {
          this.denialPending.delete(key); this.denialCounts.drops++; continue;
        }
        if (this.undoable || (item.retryAt ?? 0) > now || this.denialWrites.length >= 60) continue;
        // Attempts share one rolling append budget, including failures and their retries.
        this.denialWrites.push(now);
        try {
          this.logSecurity('privilege-denied', { account: item.account, target: item.target,
            from: item.audit.surface, detail: item.detail });
          while (this.denialKeys.size >= 500) this.denialKeys.delete(this.denialKeys.keys().next().value!);
          this.denialKeys.set(key, now);
          this.denialPending.delete(key);
        } catch {
          this.denialCounts.failures++;
          if (++item.attempts >= 3) { this.denialPending.delete(key); this.denialCounts.drops++; }
          else item.retryAt = now + 1000;
        }
      }
      if (this.denialPending.size) {
        const slot = this.denialWrites.length >= 60 ? this.denialWrites[0] + 60_000 : now;
        const next = Math.min(...[...this.denialPending.values()].map((v) => this.undoable ? v.expires
          : Math.min(v.expires, Math.max(now, v.retryAt ?? now, slot))));
        this.scheduleDenials(Math.max(1, next - now));
      }
    });
  }

  /** Checks committed security history on a separate read-only connection. */
  verifySecurityAudit(): SecurityAuditVerification {
    return verifySecurityAudit(this.path);
  }

  /** Own the file before any security mutation; its state, audit row and chain roll back together. */
  private securityChange<T>(run: () => T): T {
    this.joinTransaction();
    try {
      return securityWrite(this.sql, () => {
        // A script's savepoint can be deferred: lock before reading security state.
        this.sql.prepare('UPDATE _fm_security_chain_state SET head_seq = head_seq WHERE id = 1').run();
        const result = run();
        this.settleSignIns();
        return result;
      });
    } catch (e) {
      this.privilegeCache.invalidate((cache) => cache.clear());
      throw e;
    }
  }

  /**
   * Records a security or authentication event in the audit log, so the trail
   * covers who signed in (and who failed), who was locked out, and every change
   * to accounts, privilege sets, passwords, second factors, API tokens and
   * schema — not only record edits. `target` names the object acted on.
   */
  private logSecurity(kind: SecurityEventKind, opts: { account?: string | null; target?: string; from?: string; detail?: Record<string, unknown> } = {}): void {
    const payload: Record<string, unknown> = { ...(opts.detail ?? {}) };
    if (opts.target !== undefined) payload.target = opts.target;
    if (opts.from) payload.from = opts.from;
    const agent = opts.account && this.isAgent(opts.account) ? 1 : 0;
    this.securityChange(() => appendSecurityEvent(this.sql, new Date().toISOString(), opts.account ?? null, kind,
      Object.keys(payload).length ? JSON.stringify(payload) : null, agent));
  }

  /**
   * Records the outcome of an interactive sign-in attempt (a session surface:
   * the Data API, SQL, Postgres wire, or a script Re-Login). Called once per
   * attempt with the final result. Lockouts are recorded on their own, from any
   * surface, as they happen; stateless per-request re-authentication (MCP) is
   * not recorded here, to keep the log to genuine sign-ins.
   */
  auditSignIn(account: string, from: string, ok: boolean, factor?: 'two-factor' | 'passkey' | 'recovery-code'): void {
    this.logSecurity(ok ? 'sign-in' : 'sign-in-failed', { account, from, ...(factor ? { detail: { factor } } : {}) });
  }

  /** Records an administrator clearing an actual sign-in block. */
  auditLockoutCleared(target: string, scope: 'account' | 'address', from: string): void {
    this.logSecurity('lockout-cleared', { target, from, detail: { scope, via: 'admin console' } });
  }

  private designAccount: string | null = null;

  private ensureDeleted(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_deleted (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, tbl TEXT NOT NULL, name TEXT NOT NULL,
      at TEXT NOT NULL, account TEXT, records INTEGER NOT NULL, patch TEXT NOT NULL, meta TEXT NOT NULL)`);
  }

  private deletedRows(id?: number): DeletedDesign[] {
    const exists = this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_fm_deleted'").get();
    if (!exists) return [];
    const rows = (id === undefined ? this.sql.prepare('SELECT * FROM _fm_deleted ORDER BY id DESC').all() : this.sql.prepare('SELECT * FROM _fm_deleted WHERE id = ?').all(id)) as
      { id: number; kind: 'table' | 'field'; tbl: string; name: string; at: string; account: string | null; records: number; patch: string }[];
    return rows.map((r) => ({ id: Number(r.id), kind: r.kind, table: r.tbl, name: r.name, at: r.at, account: r.account, records: Number(r.records), patch: JSON.parse(r.patch) }));
  }

  /** Deleted tables and fields whose data is kept, newest first: restore one with the restoreDeleted design op. */
  deletedDesigns(): Omit<DeletedDesign, 'patch'>[] {
    return this.deletedRows().map(({ patch: _, ...d }) => d);
  }

  deletedDesign(id: number): DeletedDesign | undefined {
    return Number.isInteger(id) ? this.deletedRows(id)[0] : undefined;
  }

  /** The patch a restoreDeleted op carries, for server code that recorded it (see WriteOptions.recordedRestore). */
  private recordedRestore(ops: DesignOp[], id: number): Pick<DeletedDesign, 'patch'> | undefined {
    const op = ops.find((x) => x.op === 'restoreDeleted' && x.deleted === id && x.patch);
    return op && op.op === 'restoreDeleted' && op.patch ? { patch: op.patch } : undefined;
  }

  /** Lets go of a deleted table's or field's data for good (all of them without an id). Returns how many went. */
  emptyDeleted(id?: number): number {
    const gone = id === undefined ? this.deletedRows() : this.deletedRows(id);
    if (!gone.length) return 0;
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      for (const d of gone) {
        this.sql.exec(`DROP TABLE IF EXISTS ${q(`_fm_deleted_${d.id}`)}`);
        this.sql.prepare('DELETE FROM _fm_deleted WHERE id = ?').run(d.id);
      }
      this.sql.exec('COMMIT');
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
    return gone.length;
  }

  designHistory(limit = 200): { seq: number; at: string; account: string | null; op: DesignOp }[] {
    const rows = this.sql.prepare(`SELECT seq, at, account, op FROM ${DESIGN_LOG} ORDER BY seq DESC LIMIT ?`).all(limit) as
      { seq: number; at: string; account: string | null; op: string }[];
    return rows.reverse().map((r) => ({ seq: Number(r.seq), at: r.at, account: r.account, op: JSON.parse(r.op) }));
  }

  /** Every logged change that made one script or gave it new steps, oldest first, however long ago (the history above keeps the latest only). */
  scriptHistory(scriptId: number): { seq: number; at: string; account: string | null; op: DesignOp }[] {
    const rows = this.sql.prepare(`SELECT seq, at, account, op FROM ${DESIGN_LOG}
      WHERE ((json_extract(op, '$.op') = 'updateScript' AND json_extract(op, '$.script') = ?)
         OR (json_extract(op, '$.op') = 'createScript' AND json_extract(op, '$.id') = ?))
        AND json_type(op, '$.steps') = 'array'
      ORDER BY seq`).all(scriptId, scriptId) as { seq: number; at: string; account: string | null; op: string }[];
    return rows.map((r) => ({ seq: Number(r.seq), at: r.at, account: r.account, op: JSON.parse(r.op) }));
  }

  /** Every logged change that made or redesigned one layout, oldest first: its saves, however long ago (the history above keeps the latest only). */
  layoutHistory(layoutId: number): { seq: number; at: string; account: string | null; op: DesignOp }[] {
    const rows = this.sql.prepare(`SELECT seq, at, account, op FROM ${DESIGN_LOG}
      WHERE (json_extract(op, '$.op') = 'updateLayout' AND json_extract(op, '$.layout') = ?)
         OR (json_extract(op, '$.op') = 'createLayout' AND json_extract(op, '$.id') = ?)
      ORDER BY seq`).all(layoutId, layoutId) as { seq: number; at: string; account: string | null; op: string }[];
    return rows.map((r) => ({ seq: Number(r.seq), at: r.at, account: r.account, op: JSON.parse(r.op) }));
  }

  private designEffect(e: Effect): void {
    const renameKey = (key: 'repeating' | 'globals' | 'serials', table: string, from: string | null, to: string | null) => {
      const value = this.meta(key) as Record<string, unknown> | undefined;
      if (!value) return;
      if (from === null) {
        // table-level rename or drop
        if (!(table in value)) return;
        if (to !== null) value[to] = value[table];
        delete value[table];
      } else {
        const t = value[table] as Record<string, unknown> | string[] | undefined;
        if (!t) return;
        if (Array.isArray(t)) value[table] = t.flatMap((n) => (n === from ? (to === null ? [] : [to]) : [n]));
        else if (from in t) {
          if (to !== null) t[to] = t[from];
          delete t[from];
        }
      }
      this.sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(key, JSON.stringify(value));
    };
    // The audit log's excluded fields are kept by name too, so a rename has to carry them along or the field starts being logged in clear.
    const renameExcluded = (table: string, from: string | null, to: string | null) => {
      const value = this.meta('auditSettings') as { excludeFields?: Record<string, string[]> } | undefined;
      const ex = value?.excludeFields;
      if (!value || !ex) return;
      const key = Object.keys(ex).find((n) => n.toLowerCase() === table.toLowerCase());
      if (!key) return;
      if (from === null) {
        if (to !== null) ex[to] = ex[key];
        delete ex[key];
      } else {
        ex[key] = ex[key].flatMap((n) => (n.toLowerCase() === from.toLowerCase() ? (to === null ? [] : [to]) : [n]));
        if (!ex[key].length) delete ex[key];
      }
      this.sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run('auditSettings', JSON.stringify(value));
      this.auditConfig = undefined;
    };
    const keys = ['repeating', 'globals', 'serials'] as const;
    switch (e.k) {
      case 'createTable': {
        const cols = e.table.fields.filter((f) => f.kind !== 'summary').map((f) => `, ${q(f.name)} ${SQL_TYPES[f.type]}`).join('');
        this.sql.exec(`CREATE TABLE ${q(e.table.name)} (_fm_record_id INTEGER PRIMARY KEY, _fm_mod_id INTEGER NOT NULL DEFAULT 0${cols})`);
        break;
      }
      case 'renameTable':
        this.sql.exec(`ALTER TABLE ${q(e.from)} RENAME TO ${q(e.to)}`);
        for (const k of keys) renameKey(k, e.from, null, e.to);
        renameExcluded(e.from, null, e.to);
        break;
      case 'dropTable':
        this.sql.exec(`DROP TABLE IF EXISTS ${q(e.name)}`);
        for (const k of keys) renameKey(k, e.name, null, null);
        renameExcluded(e.name, null, null);
        break;
      case 'addColumn':
        this.sql.exec(`ALTER TABLE ${q(e.table)} ADD COLUMN ${q(e.field.name)} ${SQL_TYPES[e.field.type]}`);
        break;
      case 'renameColumn':
        this.sql.exec(`ALTER TABLE ${q(e.table)} RENAME COLUMN ${q(e.from)} TO ${q(e.to)}`);
        for (const k of keys) renameKey(k, e.table, e.from, e.to);
        renameExcluded(e.table, e.from, e.to);
        break;
      case 'dropColumn':
        this.dropColumnIndexes(e.table, e.name);
        this.sql.exec(`ALTER TABLE ${q(e.table)} DROP COLUMN ${q(e.name)}`);
        for (const k of keys) renameKey(k, e.table, e.name, null);
        renameExcluded(e.table, e.name, null);
        break;
      // Deletes keep the data aside in _fm_deleted_<id>, with what the store's metadata said about it.
      case 'trashTable': {
        this.ensureDeleted();
        const meta = Object.fromEntries(keys.map((k) => [k, (this.meta(k) as Record<string, unknown> | undefined)?.[e.table.name]]).filter(([, v]) => v !== undefined));
        const records = Number((this.sql.prepare(`SELECT count(*) AS n FROM ${q(e.table.name)}`).get() as { n: number }).n);
        const id = Number(this.sql.prepare('INSERT INTO _fm_deleted (kind, tbl, name, at, account, records, patch, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run('table', e.table.name, e.table.name, new Date().toISOString(), this.designAccount, records, JSON.stringify(e.patch), JSON.stringify(meta)).lastInsertRowid);
        this.sql.exec(`ALTER TABLE ${q(e.table.name)} RENAME TO ${q(`_fm_deleted_${id}`)}`);
        for (const k of keys) renameKey(k, e.table.name, null, null);
        break;
      }
      case 'trashField': {
        this.ensureDeleted();
        const meta: Record<string, unknown> = {};
        for (const k of keys) {
          const t = (this.meta(k) as Record<string, unknown> | undefined)?.[e.table] as Record<string, unknown> | string[] | undefined;
          if (Array.isArray(t) ? t.includes(e.field.name) : t && e.field.name in t) meta[k] = Array.isArray(t) ? true : t![e.field.name];
        }
        const col = q(e.field.name);
        const records = e.data ? Number((this.sql.prepare(`SELECT count(*) AS n FROM ${q(e.table)} WHERE ${col} IS NOT NULL AND ${col} <> ''`).get() as { n: number }).n) : 0;
        const id = Number(this.sql.prepare('INSERT INTO _fm_deleted (kind, tbl, name, at, account, records, patch, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run('field', e.table, e.field.name, new Date().toISOString(), this.designAccount, records, JSON.stringify(e.patch), JSON.stringify(meta)).lastInsertRowid);
        if (e.data) {
          this.sql.exec(`CREATE TABLE ${q(`_fm_deleted_${id}`)} AS SELECT _fm_record_id AS id, ${col} AS value FROM ${q(e.table)} WHERE ${col} IS NOT NULL`);
          this.dropColumnIndexes(e.table, e.field.name);
          this.sql.exec(`ALTER TABLE ${q(e.table)} DROP COLUMN ${col}`);
        }
        for (const k of keys) renameKey(k, e.table, e.field.name, null);
        break;
      }
      case 'restoreTable': {
        const row = this.sql.prepare('SELECT meta FROM _fm_deleted WHERE id = ?').get(e.deleted) as { meta: string } | undefined;
        const kept = this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(`_fm_deleted_${e.deleted}`);
        if (kept) this.sql.exec(`ALTER TABLE ${q(`_fm_deleted_${e.deleted}`)} RENAME TO ${q(e.table.name)}`);
        else this.designEffect({ k: 'createTable', table: e.table });
        for (const [k, v] of Object.entries(row ? JSON.parse(row.meta) as Record<string, unknown> : {})) {
          const value = (this.meta(k) as Record<string, unknown> | undefined) ?? {};
          value[e.table.name] = v;
          this.sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(k, JSON.stringify(value));
        }
        this.sql.prepare('DELETE FROM _fm_deleted WHERE id = ?').run(e.deleted);
        break;
      }
      case 'restoreField': {
        const row = this.sql.prepare('SELECT meta FROM _fm_deleted WHERE id = ?').get(e.deleted) as { meta: string } | undefined;
        const kept = `_fm_deleted_${e.deleted}`;
        if (e.field.kind !== 'summary') {
          this.sql.exec(`ALTER TABLE ${q(e.table)} ADD COLUMN ${q(e.field.name)} ${SQL_TYPES[e.field.type]}`);
          if (this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(kept)) {
            // Records deleted meanwhile are gone; records created meanwhile stay empty.
            this.sql.exec(`UPDATE ${q(e.table)} SET ${q(e.field.name)} = (SELECT value FROM ${q(kept)} k WHERE k.id = ${q(e.table)}._fm_record_id)`);
          }
        }
        this.sql.exec(`DROP TABLE IF EXISTS ${q(kept)}`);
        for (const [k, v] of Object.entries(row ? JSON.parse(row.meta) as Record<string, unknown> : {})) {
          const value = (this.meta(k) as Record<string, unknown> | undefined) ?? {};
          if (v === true) value[e.table] = [...((value[e.table] as string[] | undefined) ?? []), e.field.name];
          else value[e.table] = { ...((value[e.table] as Record<string, unknown> | undefined) ?? {}), [e.field.name]: v };
          this.sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(k, JSON.stringify(value));
        }
        this.sql.prepare('DELETE FROM _fm_deleted WHERE id = ?').run(e.deleted);
        break;
      }
      case 'restoreRetype': {
        const original = q(e.field);
        const temporary = q(`_fm_restore_${++this.trials}`);
        const kept = q(`_fm_deleted_${e.deleted}`);
        this.sql.exec(`ALTER TABLE ${q(e.table)} ADD COLUMN ${temporary} ${SQL_TYPES[e.type]}`);
        this.sql.exec(`UPDATE ${q(e.table)} SET ${temporary} = (SELECT value FROM ${kept} WHERE id = ${q(e.table)}._fm_record_id)`);
        this.dropColumnIndexes(e.table, e.field);
        this.sql.exec(`ALTER TABLE ${q(e.table)} DROP COLUMN ${original}`);
        this.sql.exec(`ALTER TABLE ${q(e.table)} RENAME COLUMN ${temporary} TO ${original}`);
        this.sql.exec(`DROP TABLE ${kept}`);
        this.sql.prepare('DELETE FROM _fm_deleted WHERE id = ?').run(e.deleted);
        break;
      }
      case 'retype': {
        // Re-read what is stored under the new type, as FileMaker reinterprets a field's data.
        const original = q(e.field);
        const temporary = q(`_fm_retype_${++this.trials}`);
        const indexes = (this.sql.prepare(`PRAGMA index_list(${q(e.table)})`).all() as { name: string }[])
          .filter((index) => (this.sql.prepare(`PRAGMA index_info(${q(index.name)})`).all() as { name: string | null }[])
            .some((c) => c.name?.toLowerCase() === e.field.toLowerCase()))
          .map((index) => (this.sql.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(index.name) as { sql: string | null }).sql)
          .filter((sql): sql is string => !!sql);
        const rows = this.sql.prepare(`SELECT _fm_record_id AS id, ${original} AS v FROM ${q(e.table)} WHERE ${original} IS NOT NULL`).iterate() as Iterable<{ id: number; v: SqlValue }>;
        this.sql.exec(`ALTER TABLE ${q(e.table)} ADD COLUMN ${temporary} ${SQL_TYPES[e.to]}`);
        const update = this.sql.prepare(`UPDATE ${q(e.table)} SET ${temporary} = ? WHERE _fm_record_id = ?`);
        const shown = (v: SqlValue) => (typeof v === 'string' && e.from !== 'text' ? String(this.present(v, e.from, 'us')) : String(v));
        if (e.to === 'container') {
          this.ensureDeleted();
          const records = Number((this.sql.prepare(`SELECT count(*) AS n FROM ${q(e.table)} WHERE ${q(e.field)} IS NOT NULL`).get() as { n: number }).n);
          const table = this.schema.tables.find((t) => t.name === e.table)!;
          const field = table.fields.find((f) => f.name === e.field)!;
          const patch = { leaves: [{ path: ['schema', 'tables', { id: table.id }, 'fields', { id: field.id }, 'type'], before: e.from, after: e.to }], removed: [] };
          const id = Number(this.sql.prepare('INSERT INTO _fm_deleted (kind, tbl, name, at, account, records, patch, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run('field', e.table, e.field, new Date().toISOString(), this.designAccount, records, JSON.stringify(patch), '{}').lastInsertRowid);
          this.sql.exec(`CREATE TABLE ${q(`_fm_deleted_${id}`)} AS SELECT _fm_record_id AS id, ${q(e.field)} AS value FROM ${q(e.table)} WHERE ${q(e.field)} IS NOT NULL`);
        }
        const repeated = (this.repeating[e.table] ?? []).includes(e.field)
          || (this.schema.tables.find((t) => t.name === e.table)?.fields.find((f) => f.name === e.field)?.options?.repetitions ?? 1) > 1;
        const convert = (v: SqlValue): SqlValue => {
          if (this.fileMode === 'native' && (e.to === 'date' || e.to === 'timestamp') && v !== null) {
            const text = shown(v).trim();
            if (!text) return null;
            // A type change migrates existing text with the compat parser; ordinary native writes stay ISO-only.
            const parse = e.to === 'date' ? parseDate : parseTimestamp;
            const iso = parse(text, 'ISO') ?? parse(text, 'MDY');
            if (!iso || parse(iso, 'ISO') !== iso) {
              throw new StoreError(500, `Field "${e.field}" cannot be converted to ${e.to}: an existing value is not a valid date or timestamp`);
            }
            return iso;
          }
          if (this.fileMode === 'native' && (e.to === 'boolean' || e.to === 'integer' || e.to === 'decimal' || e.to === 'json' || e.to === 'uuid') && v !== null) {
            const text = shown(v).trim();
            if (!text) return null;
            const converted = nativeValue(text, e.to);
            if (converted === undefined) throw new StoreError(500, `Field "${e.field}" cannot be converted to ${e.to}: an existing value is invalid`);
            return converted;
          }
          return v === null || e.to === 'container' ? null : e.to === 'text' ? shown(v) : this.normalize(shown(v), e.to);
        };
        for (const r of rows) {
          let values: SqlValue[] | undefined;
          if (repeated && typeof r.v === 'string' && r.v.startsWith('[')) {
            try {
              const parsed = JSON.parse(r.v);
              if (Array.isArray(parsed)) values = parsed;
            } catch { /* literal text */ }
          }
          const next = values && e.to !== 'container' ? JSON.stringify(values.map(convert)) : convert(r.v);
          update.run(next, r.id);
        }
        crashPoint('compat:after-copy');
        this.dropColumnIndexes(e.table, e.field);
        this.sql.exec(`ALTER TABLE ${q(e.table)} DROP COLUMN ${original}`);
        crashPoint('compat:after-drop');
        this.sql.exec(`ALTER TABLE ${q(e.table)} RENAME COLUMN ${temporary} TO ${original}`);
        crashPoint('compat:after-rename');
        if (e.to !== 'container') for (const sql of indexes) this.sql.exec(sql);
        break;
      }
    }
  }

  /** SQLite rejects DROP COLUMN while any index still names that column. */
  private dropColumnIndexes(table: string, field: string): void {
    const indexes = this.sql.prepare(`PRAGMA index_list(${q(table)})`).all() as { name: string }[];
    for (const index of indexes) {
      const columns = this.sql.prepare(`PRAGMA index_info(${q(index.name)})`).all() as { name: string | null }[];
      if (columns.some((c) => c.name?.toLowerCase() === field.toLowerCase())) this.sql.exec(`DROP INDEX ${q(index.name)}`);
    }
  }

  /** Compute a stored calculation for every record of a table. */
  private recompute(tableName: string, fieldName: string): void {
    const table = this.schema.tables.find((t) => t.name === tableName);
    const field = table?.fields.find((f) => f.name === fieldName);
    if (!table || !field) return;
    const update = this.sql.prepare(`UPDATE ${q(table.name)} SET ${q(field.name)} = ? WHERE _fm_record_id = ?`);
    // A stored text calculation keeps its result's formatting, as it does when a record is written.
    const styled = field.kind === 'calculation' && this.keepsFormatting(field);
    const kept: [number, string, StyleRun[] | undefined][] = [];
    for (const row of this.sql.prepare(`SELECT * FROM ${q(table.name)}`).iterate() as Iterable<Row>) {
      const { value: v, runs } = this.calc.computeStoredStyled({ store: this, table, row }, field);
      if (v !== row[field.name]) update.run(v as string | number | null, row._fm_record_id as number);
      if (styled && (runs || this.textStyles.has(table.id))) kept.push([row._fm_record_id as number, String(v ?? ''), runs]);
    }
    for (const [id, text, runs] of kept) this.textStyles.write(table.id, id, field.id, text, runs);
  }

  // --- accounts ---------------------------------------------------------

  /**
   * The account row a container link made for this principal is tied to: the name as stored and the row's identity, so a link
   * dies when the account is blocked, removed, or removed and made again under the same name. None when the principal has no
   * row here (a directory sign-in with no account of its own, a script's system account): its links expire as usual.
   */
  linkPrincipal(name: string): { name: string; identity: string } | undefined {
    const row = this.sql.prepare('SELECT name FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name) as { name: string } | undefined;
    const identity = row && this.accountIdentityId(row.name);
    return row && identity ? { name: row.name, identity } : undefined;
  }

  /** The row a link was tied to, by its exact name: its identity, and whether the account is blocked. */
  linkIdentity(name: string): { identity: string; inactive: boolean } | undefined {
    const row = this.sql.prepare('SELECT inactive, identity_id FROM _fm_accounts WHERE name = ?').get(name) as { inactive: number; identity_id: string | null } | undefined;
    return row?.identity_id ? { identity: row.identity_id, inactive: row.inactive !== 0 } : undefined;
  }

  /** Accounts that count failed sign-ins together because their names fold to one (see lockoutName); new ones are refused. */
  accountsSharingLockout(): string[][] {
    return accountsSharingLockout((this.sql.prepare('SELECT name FROM _fm_accounts').all() as { name: string }[]).map((r) => r.name));
  }

  accounts(): { name: string; hasPassword: boolean; privilegeSet?: string; external?: boolean; agent?: boolean; createdBy?: string; needsApproval?: boolean; inactive?: boolean; mustChange?: boolean; localOnly?: boolean; require2fa?: boolean }[] {
    return (this.sql.prepare('SELECT name, password_hash, source, created_by, needs_approval, inactive, must_change, local_only, require_2fa FROM _fm_accounts ORDER BY name').all() as { name: string; password_hash: string | null; source: string; created_by: string | null; needs_approval: number; inactive: number; must_change: number; local_only: number; require_2fa: number }[])
      .map((r) => {
        const set = this.accountPrivilegeSet(r.name);
        const external = this.isExternal(r.name);
        const agent = r.source === 'agent';
        const fromFile = r.source === 'fmp12' && this.schema.accounts.some((a) => !a.external && a.passwordVerifier && a.name.toLowerCase() === r.name.toLowerCase());
        return { name: r.name, hasPassword: r.password_hash !== null || fromFile, ...(set ? { privilegeSet: set } : {}), ...(external ? { external } : {}), ...(agent ? { agent: true } : {}), ...(r.created_by ? { createdBy: r.created_by } : {}), ...(agent && r.needs_approval ? { needsApproval: true } : {}), ...(r.inactive ? { inactive: true } : {}), ...(r.must_change ? { mustChange: true } : {}), ...(r.local_only ? { localOnly: true } : {}), ...(r.require_2fa ? { require2fa: true } : {}) };
      });
  }

  /** Whether an account is an AI agent identity (source 'agent'): used by MCP and the audit log. */
  isAgent(name: string): boolean {
    const row = this.sql.prepare('SELECT source FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name) as { source: string } | undefined;
    return row?.source === 'agent';
  }

  /** Whether an account is an approval-gated agent: its writes are held as proposals for a human to approve. */
  private agentNeedsApproval(name: string): boolean {
    const row = this.sql.prepare('SELECT source, needs_approval FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name) as { source: string; needs_approval: number } | undefined;
    return row?.source === 'agent' && !!row.needs_approval;
  }

  /** Accounts that still have the file's empty password (no password set in Tabularius). */
  blankPasswordAccounts(): string[] {
    const set = new Set((this.sql.prepare(`SELECT name FROM _fm_accounts WHERE password_hash IS NULL AND source = 'fmp12'`).all() as { name: string }[]).map((r) => r.name.toLowerCase()));
    return this.schema.accounts.filter((a) => !a.external && a.passwordVerifier && set.has(a.name.toLowerCase()) && checkFmp12Password('', a.passwordVerifier)).map((a) => a.name);
  }

  /**
   * Accounts carried over from a converted file that still sign in with the
   * file's own password (no Tabularius password set yet): local accounts with
   * `source = 'fmp12'` and no password hash. These are the ones `migrateAccounts`
   * gives a fresh temporary password to.
   */
  unmigratedAccounts(): string[] {
    return (this.sql.prepare(`SELECT name FROM _fm_accounts WHERE password_hash IS NULL AND source = 'fmp12' AND inactive = 0 ORDER BY name`).all() as { name: string }[])
      .map((r) => r.name)
      // FileMaker's built-in accounts (bracketed, like [Guest]) have no password
      // by design and aren't migration targets; external accounts have none either.
      .filter((n) => !/^\[.*\]$/.test(n) && !this.isExternal(n));
  }

  /**
   * First-login flow for a converted file: gives each named account (default:
   * every account still on the file's own password, see `unmigratedAccounts`) a
   * fresh random temporary password and marks it must-change, so the account
   * signs in once with the temporary password and is forced to set its own
   * before doing anything. Account names and their privilege sets are left
   * exactly as they are. Returns each account with its one-time temporary
   * password for the admin to hand out; the passwords are never logged or
   * stored in clear, so this is the only time they are shown.
   */
  migrateAccounts(opts: { accounts?: string[] } = {}): { account: string; password: string }[] {
    return this.securityChange(() => {
      const eligible = new Set(this.unmigratedAccounts().map((n) => n.toLowerCase()));
      let targets: string[];
      if (opts.accounts) {
        targets = [];
        for (const name of opts.accounts) {
          const canonical = this.unmigratedAccounts().find((n) => n.toLowerCase() === name.toLowerCase());
          if (!eligible.has(name.toLowerCase()) || !canonical) {
            throw new StoreError(960, `"${name}" is not an account awaiting migration (it already has a password, is external, or doesn't exist)`);
          }
          targets.push(canonical);
        }
      } else {
        targets = this.unmigratedAccounts();
      }
      const out = targets.map((account) => {
        const password = generateTempPassword(this.passwordPolicy().minLength ?? 0);
        // Keep the privilege set: setPassword leaves it untouched when none is passed.
        this.setPassword(account, password, undefined, { mustChange: true });
        return { account, password };
      });
      if (out.length) this.logSecurity('accounts-migrated', { detail: { count: out.length } });
      return out;
    });
  }

  /**
   * Adds or changes an external account: one whose people sign in through an
   * identity provider. As in FileMaker, its name is a group, or one person's
   * email address; anyone the provider vouches for with that name gets its
   * privilege set.
   */
  setExternalAccount(name: string, privilegeSet: string): void {
    return this.securityChange(() => {
      if (!this.privilegeSet(privilegeSet)) throw new StoreError(960, `No privilege set "${privilegeSet}"`);
      const existing = this.sql.prepare('SELECT source, password_hash FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name) as { source: string; password_hash: string | null } | undefined;
      if (existing && (existing.password_hash !== null || (existing.source !== 'external' && !this.isExternal(name)))) {
        throw new StoreError(960, `"${name}" is an account with a password, not an external account`);
      }
      if (!existing) this.refuseLookalikeAccount(name);
      this.sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source) VALUES (?, NULL, 'external') ON CONFLICT(name) DO UPDATE SET source = 'external'`).run(name);
      this.setAccountPrivilegeSet(name, privilegeSet);
    });
  }

  /**
   * A new account whose name is another account's written another way (é as one character or as e and an accent, or a
   * capital the database does not fold) is refused: the two would look the same and be separate accounts with their
   * own passwords and lockouts. Account import already refuses the same pair.
   */
  private refuseLookalikeAccount(name: string): void {
    const key = accountCollisionKey(name);
    // Only the accounts that exist: the file's own list still names one that was deleted, and that one can no longer sign in.
    const names = (this.sql.prepare('SELECT name FROM _fm_accounts').all() as { name: string }[]).map((r) => r.name);
    // Also a name that shares the account's lockout bucket (ß and ss, a ligature and its letters, a full-width letter): one
    // person's correct sign-in would otherwise clear the other's failed guesses.
    const bucket = lockoutName(name);
    const other = names.find((n) => accountKey(n) !== accountKey(name) && (accountCollisionKey(n) === key || lockoutName(n) === bucket));
    if (other) throw new StoreError(960, `Account "${name}" looks the same as the existing account "${other}"`);
  }

  private isExternal(name: string): boolean {
    const row = this.sql.prepare('SELECT source FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name) as { source: string } | undefined;
    return row?.source === 'external' || !!this.schema.accounts.find((a) => a.external && a.name.toLowerCase() === name.toLowerCase());
  }

  /** Whether a stored account is an external identity mapping. */
  isExternalAccount(name: string): boolean { return this.isExternal(name); }

  /**
   * Adds or re-binds an AI agent account: a named identity an MCP/AI client acts
   * as, bound to a privilege set, with no password (so it can't sign in
   * interactively — only an MCP token minted for it works). The set is never
   * [Full Access]: an agent is strictly less powerful than the full-access human
   * who creates it. `createdBy` records that human, so the trail shows who the
   * agent acts for. An existing account with a password can't be turned into an
   * agent, so a person's credentials are never quietly repurposed.
   */
  setAgentAccount(name: string, privilegeSet: string, opts: { createdBy?: string; needsApproval?: boolean } = {}): void {
    return this.securityChange(() => {
      const set = this.privilegeSet(privilegeSet);
      if (!set) throw new StoreError(960, `No privilege set "${privilegeSet}"`);
      if (isFullAccess(set)) throw new StoreError(960, 'An AI agent cannot be given [Full Access]; bind it to a narrower set');
      const existing = this.sql.prepare('SELECT source, password_hash FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name) as { source: string; password_hash: string | null } | undefined;
      if (existing && (existing.password_hash !== null || (existing.source !== 'agent' && existing.source !== 'openhbam' && !this.isExternal(name)))) {
        throw new StoreError(960, `"${name}" is already a sign-in account, not an AI agent`);
      }
      if (!existing) this.refuseLookalikeAccount(name);
      const fresh = !existing || existing.source !== 'agent';
      this.sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source, created_by, needs_approval) VALUES (?, NULL, 'agent', ?, ?)
        ON CONFLICT(name) DO UPDATE SET source = 'agent', password_hash = NULL${opts.createdBy !== undefined ? ', created_by = excluded.created_by' : ''}${opts.needsApproval !== undefined ? ', needs_approval = excluded.needs_approval' : ''}`)
        .run(name, opts.createdBy ?? null, opts.needsApproval ? 1 : 0);
      this.setAccountPrivilegeSet(name, set.name);
      if (fresh) this.logSecurity('agent-added', { target: name, detail: { ...(opts.createdBy ? { createdBy: opts.createdBy } : {}), needsApproval: !!opts.needsApproval } });
    });
  }

  /**
   * For an approval-gated agent, records the attempted write as a pending
   * proposal and throws PendingApprovalError so nothing changes yet; for anyone
   * else (and for an already-approved change being applied) does nothing. Called
   * at the top of each record write, before any mutation.
   */
  private gateAgentWrite(opts: WriteOptions, kind: 'create' | 'update' | 'delete', info: LayoutInfo, recordId: number | undefined, data: FieldData | undefined, modId: number | undefined): void {
    if (opts.approvedChange || !opts.account || !this.agentNeedsApproval(opts.account)) return;
    const summary = kind === 'create' ? `create a record on ${info.name}`
      : kind === 'delete' ? `delete record ${recordId} on ${info.name}`
      : `change ${Object.keys(data ?? {}).length} field${Object.keys(data ?? {}).length === 1 ? '' : 's'} of record ${recordId} on ${info.name}`;
    const account = opts.account;
    // Dates kept for approval in ISO form, which reads the same however the approval replays them.
    if (data && (this.fileMode === 'native' || opts.dateOrder && opts.dateOrder !== this.dateOrder)) {
      const types = new Map(info.fields.map((f) => [f.name, f.type]));
      data = Object.fromEntries(Object.entries(data).map(([k, v]) => {
        const type = types.get(k.replace(/\(\d+\)$/, ''));
        if ((type === 'date' || type === 'timestamp') && (typeof v === 'string' || this.fileMode === 'native')) {
          const normalized = this.normalize(String(v), type, opts.dateOrder);
          this.validateNativeDate(k, normalized, type);
          return [k, normalized ?? ''];
        }
        return [k, v];
      })) as FieldData;
    }
    const id = this.securityChange(() => {
      const r = this.sql.prepare('INSERT INTO _fm_pending (at, agent, kind, layout, tbl, record_id, data, mod_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(new Date().toISOString(), account, kind, info.name, info.table, recordId ?? null, data ? JSON.stringify(data) : null, modId ?? null, summary);
      this.logSecurity('agent-change-proposed', { account, target: info.name, detail: { id: Number(r.lastInsertRowid), kind, ...(recordId !== undefined ? { recordId } : {}) } });
      return Number(r.lastInsertRowid);
    });
    // The proposal and event are kept even though the requested record write is refused.
    throw new PendingApprovalError(id, summary);
  }

  /**
   * Portal edits and container uploads carry payloads (nested rows, files) that
   * don't fit a simple pending-change record, so an approval-gated agent is
   * refused them outright rather than letting the write slip past the gate.
   */
  private refuseIfGated(opts: WriteOptions, what: string): void {
    if (!opts.approvedChange && opts.account && this.agentNeedsApproval(opts.account)) {
      throw new StoreError(9, `This agent's changes need approval, and ${what} can't be queued for approval — use a record create, update or delete instead`);
    }
  }

  /** Approval-gated agents' proposed changes awaiting a human decision, oldest first. */
  pendingChanges(): { id: number; at: string; agent: string; kind: string; layout: string; table: string; recordId?: number; summary: string; data?: Record<string, unknown> }[] {
    return (this.sql.prepare('SELECT id, at, agent, kind, layout, tbl, record_id, data, summary FROM _fm_pending ORDER BY id').all() as
      { id: number; at: string; agent: string; kind: string; layout: string; tbl: string; record_id: number | null; data: string | null; summary: string }[])
      .map((r) => ({ id: Number(r.id), at: r.at, agent: r.agent, kind: r.kind, layout: r.layout, table: r.tbl, summary: r.summary,
        ...(r.record_id !== null ? { recordId: Number(r.record_id) } : {}), ...(r.data ? { data: JSON.parse(r.data) as Record<string, unknown> } : {}) }));
  }

  /**
   * Applies a pending agent change after a human approved it, as the agent and
   * with the agent's own privileges (so approval never grants more than the
   * agent could do), then removes the proposal. The record change is audited as
   * the agent; the approval is logged against the approver.
   */
  approvePending(id: number, approver: string): { recordId?: number } {
    return this.securityChange(() => {
      const row = this.sql.prepare('SELECT agent, kind, layout, record_id, data FROM _fm_pending WHERE id = ?').get(id) as
        { agent: string; kind: string; layout: string; record_id: number | null; data: string | null } | undefined;
      if (!row) throw new StoreError(960, `No pending change ${id}`);
      const privileges = this.privileges(row.agent);
      const data = row.data ? JSON.parse(row.data) as FieldData : {};
      const opts: WriteOptions = { privileges, account: row.agent, approvedChange: true, dataEntry: true };
      let result: { recordId?: number } = {};
      if (row.kind === 'create') result = { recordId: this.create(row.layout, data, opts).recordId };
      else if (row.kind === 'update') this.update(row.layout, row.record_id!, data, undefined, opts);
      else if (row.kind === 'delete') this.delete(row.layout, row.record_id!, opts);
      else throw new StoreError(960, `Unknown pending change kind "${row.kind}"`);
      this.sql.prepare('DELETE FROM _fm_pending WHERE id = ?').run(id);
      this.logSecurity('agent-change-approved', { account: approver, target: row.agent,
        detail: { id, kind: row.kind, ...(result.recordId !== undefined ? { recordId: result.recordId } : row.record_id !== null ? { recordId: Number(row.record_id) } : {}) } });
      return result;
    });
  }

  /** Discards a pending agent change without applying it; returns whether one was removed. */
  rejectPending(id: number, approver: string): boolean {
    return this.securityChange(() => {
      const row = this.sql.prepare('SELECT agent, kind FROM _fm_pending WHERE id = ?').get(id) as { agent: string; kind: string } | undefined;
      if (!row) return false;
      this.sql.prepare('DELETE FROM _fm_pending WHERE id = ?').run(id);
      this.logSecurity('agent-change-rejected', { account: approver, target: row.agent, detail: { id, kind: row.kind } });
      return true;
    });
  }

  /**
   * The external account someone signed in through an identity provider uses:
   * the one named their email address, else their email's domain (an account
   * named "@example.com"), else the first of their groups that has one (in the
   * provider's order; a group with an "@" in its name never matches, as it could
   * stand for an address). Undefined when none matches, or when the account named
   * their email is deactivated. The domain step lets a whole organisation sign
   * in with one external account — beyond FileMaker, which maps only by exact
   * email or group.
   */
  externalAccount(email: string | undefined, groups: string[] = []): string | undefined {
    // A person whose own account is deactivated stays out: their domain or a group must not let them back in
    // (an identity provider deprovisioning someone over SCIM deactivates exactly that account).
    if (email && this.canonicalAccount(email) && this.accountInactive(email)) return undefined;
    const names = (this.sql.prepare('SELECT name FROM _fm_accounts WHERE inactive = 0').all() as { name: string }[]).map((r) => r.name).filter((n) => this.isExternal(n));
    const at = email?.lastIndexOf('@') ?? -1;
    const domain = at > 0 ? email!.slice(at) : undefined; // includes the "@"
    // A group only matches an account named for a group: else a group someone could name "@example.com" would
    // stand in for an email the provider never vouched for.
    for (const want of [email, domain, ...groups.filter((g) => !g.includes('@'))]) {
      if (!want) continue;
      const hit = names.find((n) => n.toLowerCase() === want.toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  }

  /**
   * Sets an account's password, adding the account (with `privilegeSet`, if
   * given) when it is new. Enforces the file's minimum-length policy, records
   * when the password was set (so expiry can be measured), and clears any
   * owed change unless `mustChange` asks for a fresh one on next sign-in.
   */
  setPassword(account: string, password: string, privilegeSet?: string, opts: { mustChange?: boolean } = {}): void {
    return this.securityChange(() => {
      account = this.canonicalAccount(account) ?? account;
      const min = this.passwordPolicy().minLength;
      if (min && password.length > 0 && password.length < min) {
        throw new StoreError(960, `Password must be at least ${min} characters`);
      }
      // Checked before anything is written, so a mistyped set name neither adds an
      // account with no privilege set nor changes an existing account's password.
      if (privilegeSet !== undefined && !this.privilegeSet(privilegeSet)) throw new StoreError(960, `No privilege set "${privilegeSet}"`);
      if (privilegeSet !== undefined && !this.accountIsFull(privilegeSet)) this.guardFullAccess(account);
      // A new account starts with the owed-change flag opts asks for (default off).
      // On an existing one, the flag is left as it is unless opts names it, so
      // setting a password doesn't silently clear a standing must-change.
      const keepMust = opts.mustChange === undefined ? '' : ', must_change = excluded.must_change';
      const existed = !!this.sql.prepare('SELECT 1 FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account);
      if (!existed) this.refuseLookalikeAccount(account);
      this.sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source, must_change, password_changed, password_disabled) VALUES (?, ?, 'openhbam', ?, ?, 0)
        ON CONFLICT(name) DO UPDATE SET password_hash = excluded.password_hash, password_changed = excluded.password_changed, password_disabled = 0${keepMust}`)
        .run(account, hashPassword(password), opts.mustChange ? 1 : 0, new Date(expiryClock.now()).toISOString());
      this.privilegeCache.invalidate((cache) => cache.clear());
      // A fresh or changed password is the normal way out of a lockout: if it's the right one, nothing is gained by
      // still blocking it, and if the account was locked out by someone guessing, a password change is exactly the
      // moment to let its owner back in rather than make them wait out the window.
      this.unlock(account);
      // OAuth grants depend on this sign-in; independently issued service tokens do not.
      this.sql.prepare("DELETE FROM _fm_api_tokens WHERE account = ? COLLATE NOCASE AND provenance = 'delegated'").run(account);
      this.logSecurity(existed ? 'password-changed' : 'account-added', { target: account });
      if (privilegeSet !== undefined) this.setAccountPrivilegeSet(account, privilegeSet);
    });
  }

  /** Add a local account with its initial security state as one atomic change. */
  createAccount(account: string, password: string, privilegeSet: string, opts: { inactive?: boolean; mustChange?: boolean } = {}): void {
    return this.securityChange(() => {
      account = this.canonicalAccount(account) ?? account;
      const min = this.passwordPolicy().minLength;
      if (min && password.length > 0 && password.length < min) throw new StoreError(960, `Password must be at least ${min} characters`);
      const set = this.privilegeSet(privilegeSet);
      if (!set) throw new StoreError(960, `No privilege set "${privilegeSet}"`);
      if (isFullAccess(set)) throw new StoreError(960, 'A new account cannot be assigned Full Access');
      if (this.sql.prepare('SELECT 1 FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account)) throw new StoreError(960, `Account "${account}" already exists`);
      this.refuseLookalikeAccount(account);
      this.guardFullAccess(account);

      this.sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source, must_change, password_changed) VALUES (?, ?, 'openhbam', 0, ?)`)
        .run(account, hashPassword(password), new Date(expiryClock.now()).toISOString());
      this.privilegeCache.invalidate((cache) => cache.clear());
      this.unlock(account);
      this.appendSecurityEvent('account-added', account);

      this.sql.prepare('UPDATE _fm_accounts SET privilege_set = ? WHERE name = ? COLLATE NOCASE').run(set.name, account);
      this.privilegeCache.invalidate((cache) => cache.clear());
      this.appendSecurityEvent('privilege-set-assigned', account, { privilegeSet: set.name });

      if (opts.mustChange) {
        this.sql.prepare('UPDATE _fm_accounts SET must_change = 1 WHERE name = ? COLLATE NOCASE').run(account);
        this.privilegeCache.invalidate((cache) => cache.clear());
      }
      if (opts.inactive) {
        this.guardFullAccess(account);
        this.sql.prepare('UPDATE _fm_accounts SET inactive = 1 WHERE name = ? COLLATE NOCASE').run(account);
        this.privilegeCache.invalidate((cache) => cache.clear());
        this.appendSecurityEvent('account-disabled', account);
      }
    });
  }

  private appendSecurityEvent(kind: SecurityEventKind, target: string, detail?: Record<string, unknown>): void {
    appendSecurityEvent(this.sql, new Date().toISOString(), null, kind,
      JSON.stringify({ ...(detail ?? {}), target }), 0);
  }

  /**
   * The file's password policy (minimum length, maximum age). FileMaker keeps
   * these as file-wide account options; an empty object means no limits.
   */
  passwordPolicy(): PasswordPolicy {
    return this.meta('passwordPolicy') ?? {};
  }

  /** Sets the file's password policy; a 0 or missing value turns that limit off. */
  setPasswordPolicy(policy: PasswordPolicy): void {
    return this.securityChange(() => {
      const clean: PasswordPolicy = {};
      for (const key of ['minLength', 'maxAgeDays'] as const) {
        const v = policy[key];
        if (v === undefined || v === null) continue;
        if (!Number.isInteger(v) || v < 0) throw new StoreError(960, `${key} must be a whole number${key === 'minLength' ? ' of characters' : ' of days'}, or 0 for none`);
        if (v > 0) clean[key] = v;
      }
      this.sql.prepare(`INSERT INTO _fm_meta VALUES ('passwordPolicy', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(clean));
      this.logSecurity('password-policy-changed', { detail: { ...clean } });
    });
  }

  /** Whether this file requires a confirmed second factor on every full-access account (an admin switch). */
  requireTotpForFullAccess(): boolean {
    return this.meta('requireTotpForFullAccess') === true;
  }

  /**
   * Active, local (non-external) accounts that have full access but no confirmed
   * second factor. These are what block `setRequireTotpForFullAccess(true)`, and
   * what the switch refuses to let sign in once it is on.
   */
  fullAccessAccountsWithoutTotp(): string[] {
    const totp = new Set(this.totpAccounts().map((n) => n.toLowerCase()));
    return this.accounts()
      .filter((a) => !a.external && !a.inactive && !totp.has(a.name.toLowerCase()) && this.privileges(a.name).full)
      .map((a) => a.name);
  }

  /**
   * Turns the "require two-factor for full-access accounts" switch on or off.
   * Turning it on is refused while any full-access account still lacks a second
   * factor, so an admin cannot lock every full-access account (themselves
   * included) out of the file.
   */
  setRequireTotpForFullAccess(on: boolean): void {
    return this.securityChange(() => {
      if (on) {
        const missing = this.fullAccessAccountsWithoutTotp();
        if (missing.length) {
          throw new StoreError(960, `Set up two-factor for these full-access accounts first, or this would lock them out: ${missing.join(', ')}`);
        }
      }
      this.sql.prepare(`INSERT INTO _fm_meta VALUES ('requireTotpForFullAccess', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(on));
      this.privilegeCache.invalidate((cache) => cache.clear());
      this.logSecurity(on ? 'require-2fa-set' : 'require-2fa-cleared');
    });
  }

  // --- script test cases (script-tests.ts) -------------------------------------

  /** The file's script test cases, or one script's. */
  scriptTests(script?: number): ScriptTest[] {
    const all = (this.meta('scriptTests') ?? []) as ScriptTest[];
    return script === undefined ? all : all.filter((t) => t.script === script);
  }

  /** Adds a test case, or replaces the one with its id. Returns it as kept. */
  saveScriptTest(raw: unknown): ScriptTest {
    const clean = cleanScriptTest(raw, this.schema.scripts.map((x) => x.id));
    const all = this.scriptTests();
    const at = clean.id ? all.findIndex((t) => t.id === clean.id) : -1;
    if (at < 0 && all.length >= SCRIPT_TEST_LIMIT) throw new StoreError(3, `A file keeps at most ${SCRIPT_TEST_LIMIT} script test cases`);
    const test: ScriptTest = { ...clean, id: at >= 0 ? clean.id! : randomUUID() };
    if (at >= 0) all[at] = test;
    else all.push(test);
    this.sql.prepare(`INSERT INTO _fm_meta VALUES ('scriptTests', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(all));
    return test;
  }

  /** Deletes a test case; false when there was none with that id. */
  deleteScriptTest(id: string): boolean {
    const all = this.scriptTests();
    const keep = all.filter((t) => t.id !== id);
    if (keep.length === all.length) return false;
    this.sql.prepare(`INSERT INTO _fm_meta VALUES ('scriptTests', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(keep));
    return true;
  }

  // --- AI access ------------------------------------------------------------

  /** Set by the server for files it was told to keep from AI (serve --ai-exclude): off whatever the file says. */
  aiExcludedByServer = false;
  private aiRefusals = new Map<string, number>();

  /**
   * Whether this file's data may go to AI: the assistant, digests' summaries, AI matching and every MCP client,
   * whatever the account's privileges (Full Access and the local administrator included). On unless turned off.
   */
  get aiAllowed(): boolean {
    return !this.aiExcludedByServer && this.meta('aiOff') !== true;
  }

  /** Whether the file itself has AI turned off (as opposed to the server keeping it from AI). */
  get aiTurnedOff(): boolean {
    return this.meta('aiOff') === true;
  }

  /** Records a script's Install Plug-In File, done or refused, in this file's security log. */
  recordPluginInstall(done: { id: string; version: string; signer: string } | undefined, opts: { account?: string; script: string; why?: string }): void {
    this.securityChange(() => {
      if (done) this.logSecurity('plugin-installed', { account: opts.account ?? null, detail: { ...done, script: opts.script } });
      else this.logSecurity('plugin-install-refused', { account: opts.account ?? null, detail: { script: opts.script, why: opts.why ?? '' } });
    });
  }

  /** Turns AI on or off for this file; kept in the file, and in its security log. */
  setAiAllowed(on: boolean, opts: { account?: string } = {}): void {
    return this.securityChange(() => {
      if (on === !this.aiTurnedOff) return;
      this.sql.prepare(`INSERT INTO _fm_meta VALUES ('aiOff', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(!on));
      this.logSecurity(on ? 'ai-turned-on' : 'ai-turned-off', { account: opts.account ?? null });
    });
  }

  /** Per-file AI-visible policy. Missing metadata is deliberately OFF for existing/imported files. */
  get aiPolicy(): boolean { return this.meta('aiPolicy') === true; }

  setAiPolicy(on: boolean): void {
    if (typeof on !== 'boolean') throw new StoreError(960, 'AI policy must be true or false');
    this.securityChange(() => {
      this.sql.prepare(`INSERT INTO _fm_meta VALUES ('aiPolicy', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(on));
      this.logSecurity(on ? 'ai-policy-on' : 'ai-policy-off', { account: writer.getStore()?.account ?? null });
    });
  }

  // --- Personal data isolation -----------------------------------------------

  /**
   * Whether personal data is kept from AI for this file: names, emails, phone numbers, addresses, ids and free text
   * are swapped for stand-ins (<PERSON_3>) before anything goes to an AI model, and swapped back in what people see
   * (server/src/pii.ts). Off unless turned on.
   */
  get piiIsolation(): boolean {
    return this.meta('piiIsolation') === true;
  }

  /** Turns personal data isolation on or off for this file; kept in the file, and in its security log. */
  setPiiIsolation(on: boolean, opts: { account?: string } = {}): void {
    return this.securityChange(() => {
      if (on === this.piiIsolation) return;
      this.sql.prepare(`INSERT INTO _fm_meta VALUES ('piiIsolation', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(on));
      this.logSecurity(on ? 'pii-isolation-on' : 'pii-isolation-off', { account: opts.account ?? null });
    });
  }

  /** Fields an administrator marked as personal (true) or not (false), by "Table::Field", over what is worked out. */
  piiFieldMarks(): Record<string, boolean> {
    const m = this.meta('piiFields');
    return m && typeof m === 'object' ? m as Record<string, boolean> : {};
  }

  /** Marks a field as personal data (true), not (false), or back to what is worked out (null). */
  markPiiField(table: string, field: string, pii: boolean | null, opts: { account?: string } = {}): void {
    return this.securityChange(() => {
      const t = this.schema.tables.find((x) => x.name.toLowerCase() === table.toLowerCase());
      const f = t?.fields.find((x) => x.name.toLowerCase() === field.toLowerCase());
      if (!t || !f) throw new StoreError(102, `No field ${table}::${field}`);
      const marks = this.piiFieldMarks();
      const key = `${t.name}::${f.name}`;
      if ((marks[key] ?? null) === pii) return;
      if (pii === null) delete marks[key];
      else marks[key] = pii;
      this.sql.prepare(`INSERT INTO _fm_meta VALUES ('piiFields', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(marks));
      this.logSecurity('pii-field-marked', { account: opts.account ?? null, target: key, detail: { pii } });
    });
  }

  /** Records, in the security log, what was kept from an AI model in one exchange: counts by kind, never the values. */
  logAiMasked(opts: { account?: string | null; via: string; masked: Record<string, number>; blocked?: boolean }): void {
    this.logSecurity('ai-data-masked', { account: opts.account ?? null, detail: { via: opts.via, masked: opts.masked, ...(opts.blocked ? { blocked: true } : {}) } });
  }

  /** Why AI can't use this file, for whoever asked. */
  aiOffMessage(): string {
    return `AI is turned off for ${this.name}: its data is never sent to AI apps or the AI assistant` +
      (this.aiExcludedByServer && !this.aiTurnedOff ? ' (the server was started with --ai-exclude)' : '. An administrator can turn it on in the admin console');
  }

  /**
   * Records that AI was refused this file (in its security log), once per account, way in and ten minutes, so a
   * client retrying doesn't flood the log. Returns the message to give.
   */
  refuseAi(opts: { account?: string | null; via: string; from?: string }): string {
    const key = `${opts.account ?? ''}\0${opts.via}`;
    const now = performance.now();
    if ((this.aiRefusals.get(key) ?? -Infinity) < now - 600_000) {
      // Only the last ten minutes matter: older entries go, and the map never holds more than a few hundred.
      for (const [k, at] of this.aiRefusals) if (at < now - 600_000 || this.aiRefusals.size >= 500) this.aiRefusals.delete(k);
      this.aiRefusals.set(key, now);
      this.logSecurity('ai-access-refused', { account: opts.account ?? null, ...(opts.from ? { from: opts.from } : {}), detail: { via: opts.via } });
    }
    return this.aiOffMessage();
  }

  /**
   * A security health report for the admin console: a least-privilege and
   * hygiene snapshot built entirely from what the file already knows. Read-only.
   *   - fullAccess: active accounts that hold full access, and the count.
   *   - without2fa: active, local accounts that can sign in with only a password.
   *   - unused: active, local accounts with no sign-in in the last `unusedDays`
   *     (default 90), newest sign-in first; accounts that never signed in are
   *     listed with no `lastSignIn`. Drawn from the audit log, so it reaches
   *     only as far back as the log is kept.
   *   - broadTokens: API tokens that are unscoped (reach every surface the
   *     account has), can write, or never expire — each with its age in days.
   *   - oversharingSets: privilege sets (other than full access) that can read
   *     tables no layout they can open ever shows, i.e. data reachable only
   *     through the API, SQL or export. Lists those tables per set.
   *   - emptyPassword: active, local accounts that still have the file's empty
   *     password, each with the sign-in surfaces its privilege set opens
   *     (fmapp, fmrest, …) and whether any of those reach it over the network.
   *     FileMaker Server lets such an account sign in from anywhere; Tabularius
   *     refuses an empty password from the network unless blankPasswordFromNetwork
   *     is on (it is off by default), but the account is still a standing risk.
   *   - blankPasswordFromNetwork: whether the server currently accepts an empty
   *     password from a non-local address at all.
   *   - noWorkingPassword: active, local accounts carried over from a converted
   *     file whose FileMaker password was not blank — so unlike emptyPassword,
   *     nothing signs them in at all (see checkFmp12Password's doc comment for
   *     why), until an admin gives one a password here. migrateAccounts (and the
   *     admin console's "set temporary password") works on these the same as on
   *     emptyPassword accounts.
   */
  /**
   * Stored calculation fields that expose a value derived from a field some
   * privilege set cannot see. A stored calc is computed once and kept; like
   * FileMaker, Tabularius does not re-evaluate a stored value against the viewer's
   * privileges, so a set that can read the calc but not one of its inputs still
   * sees a value derived from that input. (Unstored calcs are recomputed with
   * the viewer's privileges and don't leak this way.) This is a beyond-FileMaker
   * hardening heads-up, not something changed automatically: the fix is to make
   * the calculation unstored. Each entry names the table, the stored calc, the
   * source fields it exposes, and the sets that can read it but not those.
   */
  leakyStoredCalcs(): { table: string; field: string; exposes: string[]; sets: string[] }[] {
    const nonFull = this.privilegeSets().filter((s) => !isFullAccess(s));
    if (!nonFull.length) return [];
    const pvs = nonFull.map((s) => this.privilegesForSet(s.name));
    const out: { table: string; field: string; exposes: string[]; sets: string[] }[] = [];
    for (const t of this.schema.tables) {
      for (const f of t.fields) {
        if (f.kind !== 'calculation' || f.options?.unstored || f.options?.global || f.calculation === undefined) continue;
        const c = this.calc.formula(t, f);
        if (!c) continue;
        const ctxId = f.calculationContextId ?? this.calc.defaultOccurrence(t);
        // Each referenced field resolved to its (same-file) base table and field.
        const sources = c.fields
          .map((r) => {
            const occ = r.occurrence ? this.calc.occurrence(r.occurrence) : (ctxId !== undefined ? this.schema.tableOccurrences.find((o) => o.id === ctxId) : undefined);
            const where = occ && this.calc.occurrenceTable(occ.id);
            const sf = where && where.store === this && where.table.fields.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
            return sf ? { table: where.table.name, field: sf.name } : undefined;
          })
          .filter((s): s is { table: string; field: string } => !!s && !(s.table === t.name && s.field === f.name));
        if (!sources.length) continue;
        const exposes = new Set<string>();
        const sets = new Set<string>();
        for (const pv of pvs) {
          if (pv.field(t.name, f.name) === 'none') continue; // can't even see the calc
          for (const s of sources) {
            const hidden = pv.field(s.table, s.field) === 'none' || pv.table(s.table).view === false;
            if (hidden) {
              exposes.add(s.table === t.name ? s.field : `${s.table}::${s.field}`);
              sets.add(pv.name);
            }
          }
        }
        if (sets.size) out.push({ table: t.name, field: f.name, exposes: [...exposes], sets: [...sets] });
      }
    }
    return out;
  }

  /** Every account's latest sign-in, by lowercased name (from the audit log, so it reaches only as far back as the log is kept). An account that never signed in is absent. */
  lastSignIns(): Map<string, string> {
    const lastSignIn = new Map<string, string>();
    for (const e of this.auditLog({ kind: 'sign-in', security: true, limit: 10_000 })) {
      if (e.account) lastSignIn.set(e.account.toLowerCase(), e.at);
    }
    return lastSignIn;
  }

  /** Privilege-set access keys that name something no longer in the file (a rename or delete left them behind). */
  orphanedAccessKeys(): { set: string; layouts: string[]; scripts: string[]; valueLists: string[]; tables: string[]; fields: { table: string; fields: string[] }[] }[] {
    const nameSet = (names: string[]) => new Set(names.map((n) => n.toLowerCase()));
    const layoutNames = nameSet(this.schema.layouts.map((l) => l.name));
    const scriptNames = nameSet(this.schema.scripts.map((s) => s.name));
    const valueListNames = nameSet(this.schema.valueLists.map((v) => v.name));
    const tableNames = nameSet(this.schema.tables.map((t) => t.name));
    const fieldNames = new Map(this.schema.tables.map((t) => [t.name.toLowerCase(), nameSet(t.fields.map((f) => f.name))]));
    const orphanKeys = (map: Record<string, unknown> | undefined, known: Set<string>) =>
      Object.keys(map ?? {}).filter((k) => !known.has(k.toLowerCase()));
    return this.privilegeSets()
      .filter((s) => !isFullAccess(s))
      .map((s) => ({
        set: s.name,
        layouts: orphanKeys(s.layoutAccess, layoutNames),
        scripts: orphanKeys(s.scriptAccess, scriptNames),
        valueLists: orphanKeys(s.valueListAccess, valueListNames),
        tables: orphanKeys(s.tables, tableNames),
        // Orphaned field keys, but only under a base table that still exists (a
        // missing table is already reported whole, above).
        fields: Object.entries(s.tables ?? {})
          .filter(([tbl]) => tableNames.has(tbl.toLowerCase()))
          .map(([tbl, tp]) => ({ table: tbl, fields: orphanKeys(tp.fields, fieldNames.get(tbl.toLowerCase()) ?? new Set()) }))
          .filter((f) => f.fields.length > 0),
      }))
      .filter((s) => s.layouts.length || s.scripts.length || s.valueLists.length || s.tables.length || s.fields.length);
  }

  securityHealth(opts: { unusedDays?: number; idleTokenDays?: number; expiringSoonDays?: number } = {}): {
    unusedDays: number;
    fullAccess: { count: number; accounts: string[] };
    without2fa: string[];
    unused: { account: string; lastSignIn?: string; daysSince?: number }[];
    broadTokens: { id: string; label?: string; account: string; surfaces: string[] | 'all'; readOnly: boolean; created: string; expires?: string; ageDays: number; reasons: string[] }[];
    staleTokens: TokenHygieneFinding[];
    oversharingSets: { set: string; tables: string[] }[];
    orphanedAccessKeys: { set: string; layouts: string[]; scripts: string[]; valueLists: string[]; tables: string[]; fields: { table: string; fields: string[] }[] }[];
    leakyStoredCalcs: { table: string; field: string; exposes: string[]; sets: string[] }[];
    emptyPassword: { account: string; privilegeSet?: string; surfaces: string[]; networkLogin: boolean }[];
    blankPasswordFromNetwork: boolean;
    noWorkingPassword: { account: string; privilegeSet?: string }[];
  } {
    const unusedDays = Number.isFinite(opts.unusedDays) && opts.unusedDays! > 0 ? Math.trunc(opts.unusedDays!) : 90;
    const now = Date.now();
    const days = (iso: string) => Math.floor((now - Date.parse(iso)) / 86_400_000);
    const local = this.accounts().filter((a) => !a.external && !a.inactive);
    const totp = new Set(this.totpAccounts().map((n) => n.toLowerCase()));

    const fullAccounts = local.filter((a) => this.privileges(a.name).full).map((a) => a.name);
    const without2fa = local.filter((a) => a.hasPassword && !totp.has(a.name.toLowerCase())).map((a) => a.name);

    const lastSignIn = this.lastSignIns();
    const unused = local
      .map((a) => {
        const at = lastSignIn.get(a.name.toLowerCase());
        return { account: a.name, lastSignIn: at, daysSince: at ? days(at) : undefined };
      })
      .filter((u) => u.lastSignIn === undefined || (u.daysSince ?? 0) >= unusedDays)
      .sort((a, b) => (b.lastSignIn ?? '').localeCompare(a.lastSignIn ?? ''));

    const broadTokens = this.apiTokens().map((t) => {
      const reasons: string[] = [];
      if (!t.surfaces) reasons.push('reaches every surface');
      if (!t.readOnly) reasons.push('can write');
      if (!t.expires) reasons.push('never expires');
      return { ...t, surfaces: (t.surfaces ?? 'all') as string[] | 'all', created: t.created, ageDays: days(t.created), reasons };
    }).filter((t) => t.reasons.length > 0);

    // Token hygiene: tokens that are dead, forgotten, or about to expire — a
    // lifecycle view, apart from broadTokens (which is about scope and power).
    const idleTokenDays = Number.isFinite(opts.idleTokenDays) && opts.idleTokenDays! > 0 ? Math.trunc(opts.idleTokenDays!) : 90;
    const expiringSoonDays = Number.isFinite(opts.expiringSoonDays) && opts.expiringSoonDays! > 0 ? Math.trunc(opts.expiringSoonDays!) : 14;
    const acctByName = new Map(this.accounts().map((a) => [a.name.toLowerCase(), a]));
    const staleTokens: TokenHygieneFinding[] = [];
    for (const t of this.apiTokens()) {
      const reasons: string[] = [];
      let revoke = false;
      const acct = acctByName.get(t.account.toLowerCase());
      if (!acct) { reasons.push('the account no longer exists'); revoke = true; }
      else if (acct.inactive) { reasons.push('the account is deactivated'); revoke = true; }
      if (t.expires) {
        const until = Math.ceil((Date.parse(t.expires) - now) / 86_400_000);
        if (until < 0) { reasons.push(`expired ${-until} day${-until === 1 ? '' : 's'} ago`); revoke = true; }
        else if (until <= expiringSoonDays) reasons.push(`expires in ${until} day${until === 1 ? '' : 's'}`);
      }
      if (t.lastUsed) {
        const idle = days(t.lastUsed);
        if (idle >= idleTokenDays) { reasons.push(`not used in ${idle} days`); revoke = true; }
      } else if (days(t.created) >= idleTokenDays) {
        reasons.push(`never used (issued ${days(t.created)} days ago)`); revoke = true;
      }
      if (reasons.length) staleTokens.push({ id: t.id, ...(t.label ? { label: t.label } : {}), account: t.account, created: t.created, ...(t.expires ? { expires: t.expires } : {}), ...(t.lastUsed ? { lastUsed: t.lastUsed } : {}), ageDays: days(t.created), reasons, action: revoke ? 'revoke' : 'rotate' });
    }

    // Base-table name for each layout, so we can tell which tables a set's
    // openable layouts actually surface.
    const occToTable = new Map<number, string>();
    for (const o of this.schema.tableOccurrences) {
      if (o.baseTableId !== undefined && o.dataSourceId === undefined) {
        const t = this.schema.tables.find((tb) => tb.id === o.baseTableId);
        if (t) occToTable.set(o.id, t.name);
      }
    }
    const oversharingSets = this.privilegeSets()
      .filter((s) => !isFullAccess(s))
      .map((s) => {
        const shown = new Set<string>();
        for (const l of this.schema.layouts) {
          const access = s.layoutAccess?.[l.name]?.layout ?? s.layouts;
          if (access !== 'none' && l.tableOccurrenceId !== undefined) {
            const t = occToTable.get(l.tableOccurrenceId);
            if (t) shown.add(t);
          }
        }
        const tables = this.schema.tables
          .filter((t) => {
            const view = (s.tables?.[t.name] ?? s.records).view;
            return (view === true || typeof view === 'string') && !shown.has(t.name);
          })
          .map((t) => t.name);
        return { set: s.name, tables };
      })
      .filter((s) => s.tables.length > 0);

    // Per-object access is keyed by name. A key that names no current object is
    // a restriction left behind by a rename or delete — before this was fixed,
    // or by FileMaker Pro editing the file directly. It protects nothing now
    // (the renamed object falls back to the blanket level), so flag it for review.
    const orphanedAccessKeys = this.orphanedAccessKeys();

    // Accounts still on the file's empty password, with the sign-in surfaces
    // their privilege set opens. The ones with a network surface are what a
    // FileMaker Server would expose to anyone; Tabularius gates them on the
    // blankPasswordFromNetwork policy, but they should still get a password.
    const blankSet = new Set(this.blankPasswordAccounts().map((n) => n.toLowerCase()));
    const emptyPassword = local
      .filter((a) => blankSet.has(a.name.toLowerCase()))
      .map((a) => {
        const p = this.privileges(a.name);
        const surfaces = NETWORK_LOGIN_PRIVILEGES.filter((e) => p.has(e));
        return { account: a.name, ...(a.privilegeSet ? { privilegeSet: a.privilegeSet } : {}), surfaces, networkLogin: surfaces.length > 0 };
      });

    // Imported accounts stuck on a non-blank FileMaker password: unlike
    // emptyPassword above, these can't sign in from anywhere at all.
    const unmigratedSet = new Set(this.unmigratedAccounts().map((n) => n.toLowerCase()));
    const noWorkingPassword = local
      .filter((a) => unmigratedSet.has(a.name.toLowerCase()) && !blankSet.has(a.name.toLowerCase()))
      .map((a) => ({ account: a.name, ...(a.privilegeSet ? { privilegeSet: a.privilegeSet } : {}) }));

    return {
      unusedDays,
      fullAccess: { count: fullAccounts.length, accounts: fullAccounts },
      without2fa,
      unused,
      broadTokens,
      staleTokens,
      oversharingSets,
      orphanedAccessKeys,
      leakyStoredCalcs: this.leakyStoredCalcs(),
      emptyPassword,
      blankPasswordFromNetwork: PASSWORD_POLICY.blankFromNetwork,
      noWorkingPassword,
    };
  }

  /**
   * Unusual-access findings over a recent window, worst first: patterns in the
   * sign-in and security log that deserve a person's attention. Read-only and
   * recomputed each call from the audit log (so it reaches only as far back as
   * the log is kept). A beyond-FileMaker heads-up, not an automatic block.
   *   - failed-burst: `failureThreshold`+ failed sign-ins for one account within
   *     the window (password guessing).
   *   - lockout: an account locked out after too many failures.
   *   - new-place: a successful sign-in from a place an account had never used
   *     before (only for accounts that had signed in from somewhere else first,
   *     so a brand-new account doesn't flag).
   *   - many-places: one account signed in from 3+ distinct places in the window
   *     (a shared or stolen credential).
   *   - dormant-return: an account signed in after `dormantDays`+ with no sign-in.
   *   - protection-removed: a second factor, a passkey, or a 2FA/this-computer-only
   *     requirement was turned off.
   * `windowHours` (default 72) bounds what counts as recent; `limit` (default 100)
   * caps the findings.
   */
  unusualAccess(opts: { windowHours?: number; failureThreshold?: number; dormantDays?: number; limit?: number } = {}): AccessAlert[] {
    const windowHours = Number.isFinite(opts.windowHours) && opts.windowHours! > 0 ? opts.windowHours! : 72;
    const failureThreshold = Number.isFinite(opts.failureThreshold) && opts.failureThreshold! > 0 ? Math.trunc(opts.failureThreshold!) : 5;
    const dormantDays = Number.isFinite(opts.dormantDays) && opts.dormantDays! > 0 ? Math.trunc(opts.dormantDays!) : 60;
    const limit = Number.isFinite(opts.limit) && opts.limit! > 0 ? Math.trunc(opts.limit!) : 100;
    const now = Date.now();
    const windowStart = new Date(now - windowHours * 3_600_000).toISOString();
    const recent = (iso: string) => iso >= windowStart;
    const place = (e: AuditEntry) => e.from ?? '';
    const alerts: AccessAlert[] = [];

    // The whole sign-in history (oldest first), for baselines and the window alike.
    const signIns = this.auditLog({ kinds: ['sign-in', 'sign-in-failed', 'locked-out'], security: true, limit: 50_000 });

    // failed-burst and lockout, per account, within the window.
    const failures = new Map<string, AuditEntry[]>();
    for (const e of signIns) {
      if (!recent(e.at)) continue;
      const who = e.account ?? '';
      if (e.kind === 'sign-in-failed') {
        (failures.get(who) ?? failures.set(who, []).get(who)!).push(e);
      } else if (e.kind === 'locked-out') {
        alerts.push({ kind: 'lockout', severity: 'alert', account: e.account, ...(e.from ? { from: e.from } : {}), at: e.at, description: `${e.account ?? 'An account'} was locked out after too many failed sign-ins${e.from ? ` from ${e.from}` : ''}`, seqs: [e.seq] });
      }
    }
    for (const [who, es] of failures) {
      if (es.length < failureThreshold) continue;
      const places = [...new Set(es.map(place).filter(Boolean))];
      const last = es[es.length - 1];
      alerts.push({
        kind: 'failed-burst', severity: 'alert', account: who || null, ...(places.length === 1 ? { from: places[0] } : {}),
        at: last.at, count: es.length,
        description: `${es.length} failed sign-ins for ${who || 'an unknown account'} in the last ${windowHours}h${places.length ? ` from ${places.join(', ')}` : ''}`,
        seqs: es.map((e) => e.seq),
      });
    }

    // Per-account successful-sign-in history: places ever used, and the previous time.
    const placesBefore = new Map<string, Set<string>>();
    const prevSuccessAt = new Map<string, string>();
    const windowSuccess = new Map<string, AuditEntry[]>();
    for (const e of signIns) {
      if (e.kind !== 'sign-in' || !e.account) continue;
      const who = e.account.toLowerCase();
      if (recent(e.at)) {
        (windowSuccess.get(who) ?? windowSuccess.set(who, []).get(who)!).push(e);
      } else {
        (placesBefore.get(who) ?? placesBefore.set(who, new Set()).get(who)!).add(place(e));
        prevSuccessAt.set(who, e.at); // last pre-window success (history is oldest-first)
      }
    }
    for (const [who, es] of windowSuccess) {
      const known = placesBefore.get(who);
      // new-place: a place never seen before, for an account that had used another.
      if (known && known.size) {
        const fresh = new Map<string, AuditEntry[]>();
        for (const e of es) { const p = place(e); if (!known.has(p)) (fresh.get(p) ?? fresh.set(p, []).get(p)!).push(e); }
        for (const [p, list] of fresh) {
          const last = list[list.length - 1];
          alerts.push({ kind: 'new-place', severity: 'notice', account: last.account, from: p || undefined, at: last.at, count: list.length, description: `${last.account} signed in from ${p || 'an unknown place'}, which it had not used before`, seqs: list.map((x) => x.seq) });
        }
      }
      // many-places: 3+ distinct places in the window.
      const distinct = [...new Set(es.map(place).filter(Boolean))];
      if (distinct.length >= 3) {
        const last = es[es.length - 1];
        alerts.push({ kind: 'many-places', severity: 'notice', account: last.account, at: last.at, count: distinct.length, description: `${last.account} signed in from ${distinct.length} different places in the last ${windowHours}h (${distinct.join(', ')})`, seqs: es.map((x) => x.seq) });
      }
      // dormant-return: first in-window success, preceded by a long gap (or no prior success).
      const first = es[0];
      const prev = prevSuccessAt.get(who);
      const gapDays = prev ? Math.floor((Date.parse(first.at) - Date.parse(prev)) / 86_400_000) : undefined;
      if (prev && gapDays !== undefined && gapDays >= dormantDays) {
        alerts.push({ kind: 'dormant-return', severity: 'notice', account: first.account, ...(first.from ? { from: first.from } : {}), at: first.at, count: gapDays, description: `${first.account} signed in after ${gapDays} days with no sign-in`, seqs: [first.seq] });
      }
    }

    // protection-removed: a weakening change within the window.
    for (const e of this.auditLog({ kinds: ['require-2fa-cleared', 'account-require-2fa-cleared', 'account-local-only-cleared', 'two-factor-disabled', 'passkey-removed'], security: true, since: windowStart, limit })) {
      alerts.push({ kind: 'protection-removed', severity: 'notice', account: e.account, ...(e.from ? { from: e.from } : {}), at: e.at, description: describeSecurityEvent(e) + (e.account ? ` (by ${e.account})` : ''), seqs: [e.seq] });
    }

    const rank = { alert: 0, notice: 1 };
    return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || b.at.localeCompare(a.at)).slice(0, limit);
  }

  /**
   * Least-privilege suggestions from the audit log: for each non-full privilege
   * set with at least one active account, every table it may edit, create or
   * delete in that no account on the set has actually written to in the last
   * `unusedDays` days (default 30) — a candidate for downgrading to view-only.
   * Pure and recomputed each time.
   *
   * SCOPE: only record writes (create/update/delete) are attributed to an
   * account, so this covers write access only — it cannot yet tell whether a
   * view, layout, script or external-surface grant goes unused.
   */
  leastPrivilege(opts: { unusedDays?: number } = {}): { unusedDays: number; findings: LeastPrivilegeFinding[]; access: LeastPrivilegeAccessFinding[]; objects: LeastPrivilegeObjectFinding[]; objectsJudged: boolean; notYetCounted: string[] } {
    // Clamp to [1, 36500] days (100 years): a finite-but-huge value would
    // overflow Date.now() - unusedDays * 86_400_000 to -Infinity and make
    // new Date(...).toISOString() throw. Non-finite/≤0 fall back to 30.
    const unusedDays = Number.isFinite(opts.unusedDays) && opts.unusedDays! > 0 ? Math.min(Math.trunc(opts.unusedDays!), 36_500) : 30;
    const since = new Date(Date.now() - unusedDays * 86_400_000).toISOString();
    // Distinct (account, table) pairs that saw a record write in the window.
    // Every data-write kind counts, truncate (bulk clear) included — a set
    // whose accounts clear a table via Truncate Table is exercising its delete
    // grant just as much as one deleting row by row. Bounded by distinct pairs,
    // not event volume, so it is exact however busy the file is (auditLog()
    // would cap the scan).
    const writes = this.sql.prepare(
      `SELECT DISTINCT account, tbl FROM _fm_audit WHERE kind IN ('create', 'update', 'delete', 'truncate') AND account IS NOT NULL AND at >= ?`,
    ).all(since) as { account: string; tbl: string }[];
    const bySet = (name: string | undefined, map: Map<string, Set<string>>, add: string) => {
      if (!name) return;
      const key = name.toLowerCase();
      let s = map.get(key);
      if (!s) map.set(key, (s = new Set()));
      s.add(add);
    };
    const written = new Map<string, Set<string>>(); // set name (lc) -> table names (lc) written in the window
    // A write is credited to the account's CURRENT set, not whatever set it held
    // at write time. If an account is moved between sets within the window, its
    // writes follow it, so the old set may look used when its own members never
    // exercised the grant — an under-report (a real unused grant hidden), never a
    // false "safe to drop". We accept that: reporting a grant as used when it
    // might be droppable is the safe direction on a security surface.
    // A write by an account that no longer has a set (deleted since, or someone who signed in through an identity
    // provider as an email rather than a stored account) can't be credited to any set. Whichever set it came from
    // may be using its grant on that table, so the table is left out of the suggestions rather than reported unused.
    const unattributed = new Set<string>();
    for (const w of writes) {
      const set = this.accountPrivilegeSet(w.account);
      if (set) bySet(set, written, w.tbl.toLowerCase()); else unattributed.add(w.tbl.toLowerCase());
    }
    const accountsBySet = new Map<string, string[]>(); // set name (lc) -> active account names
    for (const a of this.accounts()) {
      if (a.inactive) continue;
      const set = this.accountPrivilegeSet(a.name);
      if (!set) continue;
      const key = set.toLowerCase();
      let list = accountsBySet.get(key);
      if (!list) accountsBySet.set(key, (list = []));
      list.push(a.name);
    }
    const findings: LeastPrivilegeFinding[] = [];
    for (const s of this.privilegeSets()) {
      if (isFullAccess(s)) continue;
      const key = s.name.toLowerCase();
      const accounts = accountsBySet.get(key) ?? [];
      if (!accounts.length) continue; // "unused" is only meaningful for a set someone can sign in as
      const used = written.get(key) ?? new Set<string>();
      for (const t of this.schema.tables) {
        const tp = s.tables?.[t.name] ?? s.records;
        // Editing, adding and deleting need the right to view: without it the set can do none of them, so there is no grant to drop.
        if (tp.view === false) continue;
        const grants: ('edit' | 'create' | 'delete')[] = [];
        if (tp.edit !== false) grants.push('edit');
        if (tp.create) grants.push('create');
        if (tp.delete !== false) grants.push('delete');
        if (!grants.length) continue; // no write grant to drop
        if (used.has(t.name.toLowerCase())) continue; // written recently — in use
        if (unattributed.has(t.name.toLowerCase())) continue; // written by an account no set can be found for — may be this set's
        findings.push({
          set: s.name, table: t.name, grants, accounts,
          description: `"${s.name}" can ${grants.join('/')} records in ${t.name}, but no account using it has changed a record there in ${unusedDays} days. Consider view-only.`,
        });
      }
    }
    return { unusedDays, findings, ...this.unusedAccess(unusedDays, accountsBySet), ...this.unusedObjects(unusedDays, accountsBySet) };
  }

  /**
   * Ways in a set allows that no account on it has used in the window. A way
   * in is judged only when its use has been counted since before the window
   * began: before that (a file converted lately, or a surface this version
   * started counting), nothing used would look the same as nothing counted.
   * Those are listed in notYetCounted instead.
   */
  private unusedAccess(unusedDays: number, accountsBySet: Map<string, string[]>): { access: LeastPrivilegeAccessFinding[]; notYetCounted: string[] } {
    try { this.flushUsage(); } catch { /* what is on disk */ }
    const since = new Date(Date.now() - (unusedDays - 1) * 86_400_000).toISOString().slice(0, 10);
    const counting = this.usageCounting();
    const first = counting && (this.sql.prepare('SELECT min(day) AS day FROM _fm_usage').get() as { day: string | null }).day;
    // Counted on a whole day before the window's first, so none of the window was missed.
    const covered = (surface: string) => {
      if (!counting) return false;
      const start = USAGE_COUNTED_BEFORE.has(surface) && first && first < counting.since ? first : counting.since;
      return start < since;
    };
    const used = new Map<string, Set<string>>(); // set name (lc) -> surfaces used
    const unattributed = new Set<string>(); // surfaces used by an account no set can be found for
    const rows = counting ? this.sql.prepare('SELECT DISTINCT account, surface FROM _fm_usage WHERE day >= ? AND requests > 0').all(since) as { account: string; surface: string }[] : [];
    for (const r of rows) {
      const set = this.accountPrivilegeSet(r.account)?.toLowerCase();
      if (!set) { unattributed.add(r.surface); continue; }
      let s = used.get(set);
      if (!s) used.set(set, (s = new Set()));
      s.add(r.surface);
    }
    const access: LeastPrivilegeAccessFinding[] = [];
    const notYetCounted = new Set<string>();
    for (const s of this.privilegeSets()) {
      if (isFullAccess(s)) continue;
      const accounts = accountsBySet.get(s.name.toLowerCase()) ?? [];
      if (!accounts.length) continue;
      const mine = used.get(s.name.toLowerCase()) ?? new Set<string>();
      for (const privilege of s.extendedPrivileges ?? []) {
        const known = ACCESS_USAGE[privilege];
        if (!known) continue;
        if (known.surfaces.some((x) => mine.has(x) || unattributed.has(x))) continue;
        if (!known.surfaces.every(covered)) { notYetCounted.add(privilege); continue; }
        access.push({
          set: s.name, privilege, what: known.what, accounts,
          description: `"${s.name}" lets its accounts in through ${known.what} (${privilege}), but none of them has used it in ${unusedDays} days. Consider taking ${privilege} off the set.`,
        });
      }
    }
    return { access, notYetCounted: [...notYetCounted].sort() };
  }

  /**
   * Layouts a set lets its accounts open, and scripts it lets them run, that none of them has opened or run in the
   * window (from recordObjectUse): one finding a set and kind, listing them. Judged only once layouts and scripts have
   * been counted since before the window began; until then objectsJudged is false.
   */
  private unusedObjects(unusedDays: number, accountsBySet: Map<string, string[]>): { objects: LeastPrivilegeObjectFinding[]; objectsJudged: boolean } {
    try { this.flushUsage(); } catch { /* what is on disk */ }
    const since = new Date(Date.now() - (unusedDays - 1) * 86_400_000).toISOString().slice(0, 10);
    const counted = this.objectUseSince();
    if (!counted || counted >= since) return { objects: [], objectsJudged: false };
    const counts = this.sql.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${OBJECT_USAGE}'`).get();
    // By the set each was used under, which for an account signed in through an external group is that group's.
    const used = new Map<string, Set<string>>(); // set name (lc) -> "kind\0name" opened or run under it
    for (const r of (counts ? this.sql.prepare(`SELECT DISTINCT privilege_set, kind, name FROM ${OBJECT_USAGE} WHERE day >= ? AND uses > 0`).all(since) : []) as { privilege_set: string; kind: string; name: string }[]) {
      const set = r.privilege_set.toLowerCase();
      let s = used.get(set);
      if (!s) used.set(set, (s = new Set()));
      s.add(`${r.kind}\0${r.name}`);
    }
    const objects: LeastPrivilegeObjectFinding[] = [];
    // Not the separators ("-") FileMaker lists among them.
    const layouts = this.layouts().map((l) => l.name).filter((n) => n && n !== '-');
    const scripts = this.schema.scripts.map((x) => x.name).filter((n) => n && n !== '-');
    for (const s of this.privilegeSets()) {
      if (isFullAccess(s)) continue;
      const accounts = accountsBySet.get(s.name.toLowerCase()) ?? [];
      if (!accounts.length) continue;
      const p = this.privilegesForSet(s.name);
      const mine = used.get(s.name.toLowerCase()) ?? new Set<string>();
      const unused = (kind: 'layout' | 'script', name: string) => !mine.has(`${kind}\0${name}`);
      const kinds = [
        { kind: 'layout' as const, names: layouts.filter((n) => p.layout(n).layout !== 'none' && unused('layout', n)), verb: 'open', noun: 'layout' },
        { kind: 'script' as const, names: scripts.filter((n) => p.script(n) !== 'none' && unused('script', n)), verb: 'run', noun: 'script' },
      ];
      for (const k of kinds) {
        if (!k.names.length) continue;
        const shown = k.names.length > 5 ? `${k.names.slice(0, 5).map((n) => `"${n}"`).join(', ')} and ${k.names.length - 5} more` : k.names.map((n) => `"${n}"`).join(', ');
        objects.push({
          set: s.name, kind: k.kind, names: k.names, accounts,
          description: `"${s.name}" can ${k.verb} ${k.names.length} ${k.noun}${k.names.length === 1 ? '' : 's'} that none of its accounts has ${k.kind === 'layout' ? 'opened' : 'run'} in ${unusedDays} days: ${shown}. Consider setting ${k.names.length === 1 ? 'it' : 'them'} to no access for the set.`,
        });
      }
    }
    return { objects, objectsJudged: true };
  }

  /** When this file began counting usage the current way (USAGE_COUNTING), or undefined before it has. */
  private usageCounting(): { since: string } | undefined {
    const row = this.sql.prepare(`SELECT json FROM _fm_meta WHERE key = 'usageCounting'`).get() as { json: string } | undefined;
    const v = row ? JSON.parse(row.json) as { version: number; since: string } : undefined;
    return v && v.version >= USAGE_COUNTING ? { since: v.since } : undefined;
  }

  /** Account Options: require (or clear) a password change on the account's next sign-in. Returns whether the account exists. */
  setMustChangePassword(account: string, mustChange: boolean): boolean {
    return this.securityChange(() => {
      const r = this.sql.prepare('UPDATE _fm_accounts SET must_change = ? WHERE name = ? COLLATE NOCASE').run(mustChange ? 1 : 0, account);
      this.privilegeCache.invalidate((cache) => cache.clear());
      if (r.changes > 0) this.logSecurity(mustChange ? 'must-change-set' : 'must-change-cleared', { target: account });
      return r.changes > 0;
    });
  }

  /**
   * Whether the account owes a password change before it can work: it was
   * marked must-change, or the policy's maximum age has passed since the
   * password was last set. External (identity-provider) accounts never do;
   * they have no local password to change.
   */
  mustChangePassword(account: string): boolean {
    const row = this.sql.prepare('SELECT must_change, password_changed FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as
      | { must_change: number; password_changed: string | null } | undefined;
    if (!row) return false;
    if (row.must_change) return true;
    const maxAge = this.passwordPolicy().maxAgeDays;
    if (maxAge && row.password_changed) {
      return expiryClock.now() - Date.parse(row.password_changed) > maxAge * 86_400_000;
    }
    return false;
  }

  /**
   * Changes an account's own password: the current one must be right and the
   * new one different, and the new one must meet the policy. Clears any owed
   * change. Used by the Change Password surface and a must-change sign-in.
   */
  changePassword(account: string, oldPassword: string, newPassword: string, from = ''): void {
    if (!this.verify(account, oldPassword, from)) throw new StoreError(212, 'The current password is wrong');
    if (newPassword === oldPassword) throw new StoreError(960, 'The new password must be different from the current one');
    // Honour the set's "allow the account to change its own password" option —
    // but never when a change is currently owed (must-change or expired), since
    // refusing then would lock the account out of a sign-in it can't complete.
    const setName = this.accountPrivilegeSet(account);
    const def = setName ? this.privilegeSet(setName) : undefined;
    if (def && !isFullAccess(def) && def.allowModifyPassword === false && !this.mustChangePassword(account)) {
      throw new StoreError(9, 'Insufficient privileges: this account may not change its own password');
    }
    this.setPassword(account, newPassword, undefined, { mustChange: false });
  }

  /**
   * Get ( AccountPasswordDaysRemaining ): whole days until the password
   * expires under the policy's maximum age; 0 once expired; -1 when it never
   * expires or the account has no password in this file.
   */
  passwordDaysRemaining(account: string): number {
    const acct = this.accounts().find((a) => a.name.toLowerCase() === account.toLowerCase());
    const maxAge = this.passwordPolicy().maxAgeDays;
    if (!acct || acct.external || !acct.hasPassword || !maxAge) return -1;
    const row = this.sql.prepare('SELECT password_changed FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as { password_changed: string | null } | undefined;
    if (!row?.password_changed) return -1;
    const left = maxAge - (expiryClock.now() - Date.parse(row.password_changed)) / 86_400_000;
    return Math.max(0, Math.floor(left));
  }

  private importAccounts(): ImportAccount[] {
    const stored = new Map((this.sql.prepare('SELECT name, source, password_hash FROM _fm_accounts').all() as { name: string; source: string; password_hash: string | null }[]).map((a) => [a.name, a]));
    return this.accounts().map((a) => {
      const row = stored.get(a.name)!;
      const local = row.source === 'openhbam' || row.source === 'fmp12';
      const verifier = row.source === 'fmp12' ? this.schema.accounts.find((fromFile) => accountKey(fromFile.name) === accountKey(a.name))?.passwordVerifier : undefined;
      const password = row.password_hash !== null || !!(verifier && checkFmp12Password('', verifier));
      return { ...a, local, recoverable: local && !a.external && !a.agent && (password || this.hasPasskey(a.name)), hasSecondFactor: this.hasSecondFactor(a.name) };
    });
  }

  private guardFullAccess(account: string): void {
    const accounts = this.importAccounts();
    const a = accounts.find((a) => accountKey(a.name) === accountKey(account));
    if (!a || a.inactive || !this.accountIsFull(a.privilegeSet)) return;
    const sets = this.privilegeSets();
    const fileRequires2fa = this.requireTotpForFullAccess();
    if (!accounts.some((other) => accountKey(other.name) !== accountKey(a.name) && isRecoveryAdministrator(other, accounts, sets, fileRequires2fa))) {
      throw new StoreError(960, 'Cannot remove the last account with full access (keep an active account with unambiguous sign-in, working credentials and required MFA enrolled)');
    }
  }

  /** Resolves to stored casing and refuses an ambiguous SQLite NOCASE key. */
  canonicalAccount(account: string): string | undefined {
    const matches = this.sql.prepare('SELECT name FROM _fm_accounts WHERE name = ? COLLATE NOCASE').all(account) as { name: string }[];
    if (matches.length > 1) throw new AccountImportError('ambiguous-existing-account');
    return matches[0]?.name;
  }

  /** Creates a local identity which cannot password-sign-in until separate credential setup. */
  createLocalAccount(account: string, privilegeSet: string, active: boolean, audit: AccountMutationAudit = {}): void {
    this.securityChange(() => {
      const set = this.privilegeSet(privilegeSet);
      if (!set) throw new AccountImportError('unknown-privilege-set');
      if (this.isExternal(account) || this.isAgent(account)) throw new AccountImportError('non-local-account');
      if (this.canonicalAccount(account)) throw new AccountImportError('account-already-exists');
      this.sql.prepare(`INSERT INTO _fm_accounts (name, source, password_hash, privilege_set, inactive, must_change)
        VALUES (?, 'openhbam', NULL, ?, ?, 1)`).run(account, set.name, active ? 0 : 1);
      this.privilegeCache.invalidate((cache) => cache.clear());
      this.logSecurity('account-added', { ...audit, target: account });
      this.logSecurity('privilege-set-assigned', { ...audit, target: account, detail: { ...audit.detail, privilegeSet: set.name } });
      this.logSecurity('must-change-set', { ...audit, target: account });
      if (!active) this.logSecurity('account-disabled', { ...audit, target: account });
    });
  }

  private importSnapshot(): string {
    return importDigest({ accounts: this.importAccounts(), sets: this.privilegeSets(), fileRequires2fa: this.requireTotpForFullAccess() });
  }

  private importSignature(payload: string): string {
    return createHmac('sha256', this.meta('accountImportSecret') as string).update(payload).digest('base64url');
  }

  private importActor(actor: string, via?: string): void {
    const canonical = this.canonicalAccount(via ?? actor);
    if (!canonical || this.accountInactive(canonical) || this.isAgent(canonical) || !this.accountIsFull(this.accountPrivilegeSet(canonical)) || this.mustChangePassword(actor)) {
      throw new AccountImportError('import-requires-current-full-access', 403);
    }
  }

  /** Read-only preview; the signed, five-minute binding needs no preview row or audit write. */
  previewAccountImport(csv: string, actor: string, via?: string): AccountImportPreview {
    this.importActor(actor, via);
    const input = parseAccountCsv(csv);
    // A read transaction gives the plan and its binding the same snapshot across processes.
    const own = !this.sql.isTransaction;
    if (own) this.sql.exec('BEGIN');
    try {
      this.importActor(actor, via);
      const plan = planAccountImport(input, this.importAccounts(), this.privilegeSets(), actor, via, this.schema.accounts.filter((a) => a.external).map((a) => a.name), this.requireTotpForFullAccess());
      if (!plan.valid) return plan;
      const expires = expiryClock.now() + 5 * 60_000;
      const payload = Buffer.from(JSON.stringify({ actor, via, database: this.name, digest: importDigest(input), snapshot: this.importSnapshot(), expires })).toString('base64url');
      return { ...plan, previewToken: `${payload}.${this.importSignature(payload)}`, expiresAt: new Date(expires).toISOString() };
    } finally {
      if (own) this.sql.exec('COMMIT');
    }
  }

  /** Durable per-file actor limits shared by all processes hosting this SQLite file. */
  limitAccountImport(actor: string, kind: 'preview' | 'apply' | 'ip'): void {
    this.securityChange(() => {
      const window = Math.floor(Date.now() / 60_000);
      this.sql.prepare('DELETE FROM _fm_account_import_limits WHERE window < ?').run(window - 1);
      const row = this.sql.prepare('SELECT window, count FROM _fm_account_import_limits WHERE actor = ? AND kind = ?').get(accountKey(actor), kind) as { window: number; count: number } | undefined;
      const count = row?.window === window ? row.count : 0;
      if (count >= (kind === 'preview' ? 20 : kind === 'apply' ? 5 : 60)) throw new AccountImportError('import-rate-limit', 429);
      this.sql.prepare(`INSERT INTO _fm_account_import_limits VALUES (?, ?, ?, ?)
        ON CONFLICT(actor, kind) DO UPDATE SET window = excluded.window, count = excluded.count`).run(accountKey(actor), kind, window, count + 1);
    });
  }

  /** Recompute and apply under one write lock; receipts and successful audit events commit together. */
  applyAccountImport(csv: string, actor: string, previewToken: string, idempotencyKey: string, via?: string): AccountImportResult {
    if (this.sql.isTransaction || this.heldBy) throw new AccountImportError('import-requires-own-transaction', 409);
    const batchId = randomUUID();
    try {
      return this.securityChange(() => {
        this.importActor(actor, via);
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(idempotencyKey)) throw new AccountImportError('invalid-idempotency-key');
        const input = parseAccountCsv(csv);
        const digest = importDigest(input);
        const receipt = this.sql.prepare('SELECT actor, digest, result FROM _fm_account_import_receipts WHERE key = ?').get(idempotencyKey) as { actor: string; digest: string; result: string } | undefined;
        if (receipt) {
          if (receipt.actor !== actor || receipt.digest !== digest) throw new AccountImportError('idempotency-conflict', 409);
          return JSON.parse(receipt.result) as AccountImportResult;
        }
        if (previewToken.length > 4096) throw new AccountImportError('invalid-preview', 409);
        const [payload, signature, extra] = previewToken.split('.');
        if (!payload || !signature || extra || !/^[A-Za-z0-9_-]{43}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(this.importSignature(payload)))) throw new AccountImportError('invalid-preview', 409);
        let binding: { actor: string; via?: string; database: string; digest: string; snapshot: string; expires: number };
        try { binding = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
        catch { throw new AccountImportError('invalid-preview', 409); }
        if (binding.actor !== actor || binding.via !== via || binding.database !== this.name || binding.digest !== digest || !Number.isFinite(binding.expires) || binding.expires <= expiryClock.now() || binding.snapshot !== this.importSnapshot()) {
          throw new AccountImportError('stale-or-changed-preview', 409);
        }
        const plan = planAccountImport(input, this.importAccounts(), this.privilegeSets(), actor, via, this.schema.accounts.filter((a) => a.external).map((a) => a.name), this.requireTotpForFullAccess());
        if (!plan.valid) throw new AccountImportError('invalid-import');
        // Reactivate existing identities first, so final-state administrator protection
        // is independent of CSV row order. All phases still share this transaction.
        const ordered = [...plan.rows].sort((a, b) => Number(b.actions.includes('reactivate')) - Number(a.actions.includes('reactivate')));
        for (const row of ordered) {
          const audit = { account: actor, detail: { batchId, source: 'csv', row: row.row, before: row.before, after: row.after } };
          if (row.actions.includes('create')) this.createLocalAccount(row.account, row.after.privilegeSet, row.after.active, audit);
          else {
            if (row.actions.includes('update')) this.setAccountPrivilegeSet(row.account, row.after.privilegeSet, audit);
            if (row.actions.includes('deactivate') || row.actions.includes('reactivate')) this.setAccountActive(row.account, row.after.active, audit);
          }
        }
        const result = { ...plan, batchId };
        this.logSecurity('accounts-imported', { account: actor, detail: { batchId, source: 'csv', rows: plan.rows.length, changed: plan.rows.filter((r) => !r.actions.includes('no-op')).length } });
        this.sql.prepare('INSERT INTO _fm_account_import_receipts VALUES (?, ?, ?, ?)').run(idempotencyKey, actor, digest, JSON.stringify(result));
        return result;
      });
    } catch (e) {
      this.logSecurity('accounts-import-rejected', { account: actor, detail: { batchId, source: 'csv', reason: e instanceof AccountImportError ? e.message : 'mutation-failed' } });
      throw e;
    }
  }

  /** Whether an account (by its set's name) has full access. */
  private accountIsFull(privilegeSet?: string): boolean {
    const d = privilegeSet ? this.privilegeSet(privilegeSet) : undefined;
    return !!d && isFullAccess(d);
  }

  /**
   * Deletes the AI stand-ins kept for an account, here and in every hosted file this one uses (isolation can be
   * switched on in a data-source file, which is where the stand-ins are then kept). A scoped MCP connection keeps its
   * own set, keyed "<account>\u0001<scope>". A hosted file's own account of the same name just gets new ones. Stand-ins an MCP connection keyed by a different
   * name (the owner account of a shared connection) are not touched.
   */
  forgetStandIns(account: string, seen = new Set<Store>()): void {
    if (seen.has(this)) return;
    seen.add(this);
    if (this.hasTable('_fm_pii_vault')) {
      this.sql.prepare('DELETE FROM _fm_pii_vault WHERE account = ? COLLATE NOCASE OR (substr(account, 1, ?) = ? COLLATE NOCASE AND substr(account, ?, 1) = char(1))')
        .run(account, [...account].length, account, [...account].length + 1); // SQLite counts code points, not UTF-16 units
    }
    for (const d of this.schema.dataSources) {
      let other: Store | undefined;
      try {
        other = this.resolveFile(dataSourceFile(d.paths) ?? d.name);
      } catch {
        other = undefined;
      }
      // A hosted file that is busy or closed must not stop the account being removed: its stand-ins are left for the
      // next delete or for turning isolation off.
      try {
        other?.forgetStandIns(account, seen);
      } catch {
        /* best effort */
      }
    }
  }

  /**
   * Removes an account, along with its API tokens and second factor. Refuses
   * to remove the last account with full access, so a file can't be left with
   * no way in. Returns whether an account was removed.
   */
  deleteAccount(account: string, opts: { by?: string } = {}): boolean {
    return this.securityChange(() => {
      const name = this.canonicalAccount(account);
      const acct = this.accounts().find((a) => a.name === name);
      if (!acct) return false;
      this.guardFullAccess(acct.name);
      // Remove every credential the account held, so nothing is left to sign in
      // with — and so a later account of the same name can't inherit it.
      this.sql.prepare('DELETE FROM _fm_api_tokens WHERE account = ? COLLATE NOCASE').run(acct.name);
      this.sql.prepare('DELETE FROM _fm_totp WHERE account = ? COLLATE NOCASE').run(acct.name);
      this.sql.prepare('DELETE FROM _fm_passkeys WHERE account = ? COLLATE NOCASE').run(acct.name);
      // Its saved finds and recent records too (they hold record data).
      if (this.hasTable('_fm_user_prefs')) this.sql.prepare('DELETE FROM _fm_user_prefs WHERE account = ? COLLATE NOCASE').run(acct.name);
      // And the stand-ins kept for it while AI isolation was on: they are the real names, numbers and addresses
      // the account's AI use touched, and nothing should keep them once the account is gone.
      this.forgetStandIns(acct.name);
      const r = this.sql.prepare('DELETE FROM _fm_accounts WHERE name = ? COLLATE NOCASE').run(acct.name);
      this.privilegeCache.invalidate((cache) => cache.clear());
      if (r.changes > 0) this.logSecurity(acct.agent ? 'agent-removed' : 'account-removed', { account: opts.by, target: acct.name });
      return r.changes > 0;
    });
  }

  /**
   * Enable Account: an inactive account can't sign in (its password, API
   * tokens and identity-provider sign-ins are refused) until it is activated
   * again. Returns whether the account exists.
   */
  setAccountActive(account: string, active: boolean, audit: AccountMutationAudit = {}): boolean {
    return this.securityChange(() => {
      account = this.canonicalAccount(account) ?? account;
      if (!active) this.guardFullAccess(account);
      if (this.canonicalAccount(account) && this.accountInactive(account) === !active) return true;
      const r = this.sql.prepare('UPDATE _fm_accounts SET inactive = ? WHERE name = ? COLLATE NOCASE').run(active ? 0 : 1, account);
      if (r.changes && !active) {
        // Re-enabling an account must not resurrect a captured session or bearer credential.
        this.sql.prepare('UPDATE _fm_accounts SET identity_id = ? WHERE name = ? COLLATE NOCASE').run(randomUUID(), account);
        this.sql.prepare("DELETE FROM _fm_api_tokens WHERE account = ? COLLATE NOCASE OR json_extract(identity, '$.person') = ? COLLATE NOCASE OR json_extract(identity, '$.mapping') = ? COLLATE NOCASE").run(account, account, account);
      }
      this.privilegeCache.invalidate((cache) => cache.clear());
      if (r.changes > 0) this.logSecurity(active ? 'account-enabled' : 'account-disabled', { ...audit, account: audit.account ?? audit.by, target: account });
      return r.changes > 0;
    });
  }

  /** Whether an account is inactive (Enable Account [ Deactivate ]). */
  accountInactive(account: string): boolean {
    return !!(this.sql.prepare('SELECT inactive FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as { inactive: number } | undefined)?.inactive;
  }

  /** Whether a session principal and its selected privilege mapping are still active. */
  identityAllowed(account: string, via?: string, mappingId?: string, person?: string, principalId?: string): boolean {
    const principal = this.sql.prepare('SELECT inactive, identity_id FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as { inactive: number; identity_id: string | null } | undefined;
    // A federated login may use a directory email that has no local account;
    // local sessions always require their persisted account row.
    if (!principal && via === undefined) return false;
    if (principal && (principal.inactive !== 0 || (principalId !== undefined && principal.identity_id !== principalId))) return false;
    if (via !== undefined) {
      const mapping = this.sql.prepare("SELECT inactive, source, identity_id FROM _fm_accounts WHERE name = ? COLLATE NOCASE").get(via) as { inactive: number; source: string; identity_id: string | null } | undefined;
      const schemaMapping = this.schema.accounts.some((a) => a.external && a.name.toLowerCase() === via.toLowerCase());
      const external = mapping?.source === 'external' || (mapping?.source === 'fmp12' && schemaMapping);
      if (!mapping || !external || mapping.inactive !== 0 || (mappingId !== undefined && mapping.identity_id !== mappingId)) return false;
    }
    if (person !== undefined) {
      const bound = this.sql.prepare('SELECT inactive FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(person) as { inactive: number } | undefined;
      if (bound?.inactive !== undefined && bound.inactive !== 0) return false;
    }
    return true;
  }

  /** Stable identity for a selected external mapping, captured by a new session. */
  externalIdentityId(name: string): string | undefined {
    const row = this.sql.prepare('SELECT identity_id, source FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name) as { identity_id: string | null; source: string } | undefined;
    const schemaMapping = this.schema.accounts.some((a) => a.external && a.name.toLowerCase() === name.toLowerCase());
    if (!row || (row.source !== 'external' && !(row.source === 'fmp12' && schemaMapping))) return undefined;
    if (row.identity_id) return row.identity_id;
    const id = randomUUID();
    this.sql.prepare("UPDATE _fm_accounts SET identity_id = ? WHERE name = ? COLLATE NOCASE AND source IN ('external', 'fmp12') AND identity_id IS NULL").run(id, name);
    return (this.sql.prepare('SELECT identity_id FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name) as { identity_id: string } | undefined)?.identity_id;
  }

  /** Identity generation for any persisted account, captured by sessions. */
  accountIdentityId(name: string): string | undefined {
    const row = this.sql.prepare('SELECT identity_id FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name) as { identity_id: string | null } | undefined;
    if (!row) return undefined;
    if (row.identity_id) return row.identity_id;
    const id = randomUUID();
    this.sql.prepare('UPDATE _fm_accounts SET identity_id = ? WHERE name = ? COLLATE NOCASE AND identity_id IS NULL').run(id, name);
    return (this.sql.prepare('SELECT identity_id FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name) as { identity_id: string } | undefined)?.identity_id;
  }

  /**
   * A sign-in's credentials and authority, without retaining password material in a session.
   * Idle policy is live; extended privileges are intersected separately by session consumers.
   * It carries a generation that only ever rises (see `_fm_sign_in_ledger`), so authority that changed and then came back is
   * still a different sign-in: a code, token or session made before the change is not the same one after it was undone.
   */
  signInMark(account: string, via?: string, person?: string): string {
    const key = this.signInKey(account, via, person);
    const base = this.signInBase(account, via, person);
    // First look, or it changed: record that under the write lock, with the state read again under it, so two writers
    // can never leave the older state recorded over the newer one.
    try {
      const known = this.ledgerRow(key);
      if (known?.mark === base) return `${known.gen}:${base}`;
      return this.ledgerWrite(() => {
        const fresh = this.signInBase(account, via, person);
        const row = this.ledgerRow(key);
        if (row?.mark === fresh) return `${row.gen}:${fresh}`;
        // Above anything issued before, including the generations of rows since forgotten (the floor kept in the '' row).
        const gen = Math.max(row?.gen ?? 0, this.ledgerRow('')?.gen ?? 0) + 1;
        this.sql.prepare('INSERT INTO main._fm_sign_in_ledger (key, mark, gen) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET mark = excluded.mark, gen = excluded.gen').run(key, fresh, gen);
        return `${gen}:${fresh}`;
      });
    } catch {
      // Not recorded (a file that cannot be written): a mark that matches nothing, so nothing issued with it is honoured.
      return `unrecorded:${randomUUID()}:${base}`;
    }
  }

  private signInBase(account: string, via?: string, person?: string): string {
    const row = this.sql.prepare('SELECT identity_id, password_hash, password_disabled FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account);
    const authority = authorityOf(this.privileges(account, via, person).set);
    const identity = (name: string | undefined) => name === undefined ? undefined : this.sql.prepare('SELECT identity_id FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name);
    return createHash('sha256').update(JSON.stringify([row, authority, identity(via), identity(person)])).digest('hex');
  }

  private signInKey(account: string, via?: string, person?: string): string {
    return JSON.stringify([account.toLowerCase(), via?.toLowerCase() ?? '', person?.toLowerCase() ?? '']);
  }

  private ledgerRow(key: string): { mark: string; gen: number } | undefined {
    // Missing means the table is not there, asked of the schema itself (SQLite folds the case of identifiers, so does this; every
    // statement names the main database so a temporary table of the same name cannot stand in for it): an error from reading it is never taken for "nothing
    // recorded", whatever its text says, because that would restart a sign-in at generation 1.
    if (!this.sql.prepare("SELECT 1 FROM sqlite_master WHERE name = '_fm_sign_in_ledger' COLLATE NOCASE").get()) return undefined;
    const row = this.sql.prepare('SELECT mark, gen FROM main._fm_sign_in_ledger WHERE key = ?').get(key) as { mark: string; gen: unknown } | undefined;
    if (!row) return undefined;
    // Whole numbers with room to add one: anything else (a REAL, a negative, a value past 2^53) cannot be counted up exactly.
    if (typeof row.gen !== 'number' || !Number.isSafeInteger(row.gen) || row.gen < 0 || row.gen >= Number.MAX_SAFE_INTEGER - 1) {
      throw new Error('The sign-in ledger holds a generation that cannot be counted from');
    }
    return { mark: row.mark, gen: row.gen };
  }

  /** Runs `run` inside a write transaction (this one if it is open), with the ledger table in place. */
  private ledgerWrite<T>(run: () => T): T {
    const own = !this.sql.isTransaction;
    if (own) this.sql.exec('BEGIN IMMEDIATE');
    try {
      this.sql.exec('CREATE TABLE IF NOT EXISTS main._fm_sign_in_ledger (key TEXT PRIMARY KEY, mark TEXT NOT NULL, gen INTEGER NOT NULL)');
      const result = run();
      if (own) this.sql.exec('COMMIT');
      return result;
    } catch (e) {
      if (own && this.sql.isTransaction) this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  /**
   * Brings every known sign-in's generation up to the file as it now is, inside the security change that is committing, so a
   * change undone before anyone asks still counts and a change that rolls back leaves no trace. The version it has settled to is
   * kept in the ledger itself (key ''), so it rolls back with the change too. A sign-in whose account (or, for a directory
   * sign-in, mapping) is gone is forgotten, its generation folded into a floor that later rows start above, and a later account
   * of that name has an identity of its own: nothing issued for the old one matches. A failure to write fails the change.
   */
  private settleSignIns(): void {
    const { design, privileges } = this.metadataVersions();
    const version = `${design}/${privileges}`;
    this.ledgerWrite(() => {
      if (this.ledgerRow('')?.mark === version) return;
      // The key's names are lower-cased in JavaScript, so they are compared against the accounts the same way (SQLite's NOCASE
      // folds ASCII only, and would call a live "Élodie" gone).
      const live = new Set((this.sql.prepare('SELECT name FROM _fm_accounts').all() as { name: string }[]).map((r) => r.name.toLowerCase()));
      // A forgotten sign-in keeps its place in history: the generations of the rows dropped are folded into a floor (the '' row's
      // gen) that every later row starts above, so nothing issued before can match whatever is recorded afterwards, whether or not
      // the row was still wanted. A local sign-in goes with its account, a directory one with its mapping; the person a directory
      // sign-in names need not have an account here, so does not decide it.
      let floor = this.ledgerRow('')?.gen ?? 0;
      for (const { key } of this.sql.prepare("SELECT key FROM main._fm_sign_in_ledger WHERE key != ''").all() as { key: string }[]) {
        const held = this.ledgerRow(key)!;
        const names = JSON.parse(key) as string[];
        const [account, via, person] = names;
        if (via ? !live.has(via) : !live.has(account)) {
          floor = Math.max(floor, held.gen);
          this.sql.prepare('DELETE FROM main._fm_sign_in_ledger WHERE key = ?').run(key);
          continue;
        }
        const base = this.signInBase(account, via || undefined, person || undefined);
        if (held.mark !== base) this.sql.prepare('UPDATE main._fm_sign_in_ledger SET mark = ?, gen = gen + 1 WHERE key = ?').run(base, key);
      }
      this.sql.prepare("INSERT INTO main._fm_sign_in_ledger (key, mark, gen) VALUES ('', ?, ?) ON CONFLICT(key) DO UPDATE SET mark = excluded.mark, gen = max(gen, excluded.gen)").run(version, floor);
    });
  }

  /** Authentication and execution eligibility, separate from assigned privileges. */
  requireActiveAccount(account: string): void {
    if (!this.canonicalAccount(account) || this.accountInactive(account)) throw new StoreError(212, 'The execution account is inactive or missing');
  }

  /** Committed or in-transaction security changes, including changes made by another worker. */
  securityToken(): string {
    const row = this.sql.prepare('SELECT head_seq, head_hash FROM _fm_security_chain_state WHERE id = 1').get();
    return JSON.stringify(row);
  }

  // --- per-account sign-in restrictions (opt-in, off by default) ------------

  /** Whether an account is restricted to signing in from the server itself (a loopback address). */
  accountLocalOnly(account: string): boolean {
    return !!(this.sql.prepare('SELECT local_only FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as { local_only: number } | undefined)?.local_only;
  }

  /** Whether an account must have a confirmed second factor to sign in with a password. */
  accountRequires2fa(account: string): boolean {
    return !!(this.sql.prepare('SELECT require_2fa FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as { require_2fa: number } | undefined)?.require_2fa;
  }

  /** Turns the "sign in only from this computer" restriction on or off for an account. Returns whether the account exists. */
  setAccountLocalOnly(account: string, on: boolean): boolean {
    return this.securityChange(() => {
      const r = this.sql.prepare('UPDATE _fm_accounts SET local_only = ? WHERE name = ? COLLATE NOCASE').run(on ? 1 : 0, account);
      if (r.changes > 0) this.logSecurity(on ? 'account-local-only-set' : 'account-local-only-cleared', { target: account });
      return r.changes > 0;
    });
  }

  /** Turns the "require a second factor" restriction on or off for an account. Returns whether the account exists. */
  setAccountRequire2fa(account: string, on: boolean): boolean {
    return this.securityChange(() => {
      const r = this.sql.prepare('UPDATE _fm_accounts SET require_2fa = ? WHERE name = ? COLLATE NOCASE').run(on ? 1 : 0, account);
      if (r.changes > 0) this.logSecurity(on ? 'account-require-2fa-set' : 'account-require-2fa-cleared', { target: account });
      return r.changes > 0;
    });
  }

  /** Whether an account may sign in from `from`: false when it is local-only and the address is not a loopback one. */
  signInLocationAllowed(account: string, from: string): boolean {
    return !this.accountLocalOnly(account) || LOCAL.has(from);
  }

  // --- API tokens -----------------------------------------------------------

  /**
   * A long-lived, revocable bearer credential for an integration, bound to an
   * account (so it carries that account's privilege set) and, when `readOnly`,
   * allowed only to read. `surfaces` restricts it further to a subset of the
   * surfaces a token can reach (fmrest/fmodata/fmxdbc/fmmcp) — a token minted
   * for one integration then can't be replayed on another; left out, it reaches
   * every surface the account's extended privileges already allow. Unlike a
   * password it can be revoked on its own and never has to be stored in the
   * integration's config in a form that logs in as the person. Returns the
   * token once; only its hash is kept.
   */
  createApiToken(account: string, opts: { label?: string; readOnly?: boolean; expires?: Date; surfaces?: string[]; layouts?: string[]; identity?: { issuer: string; sub: string; person?: string; mapping: string }; provenance?: 'service' | 'delegated' } = {}): string {
    // opts.expires is an absolute date; relative-lifetime callers use expiryClock.now().
    return this.securityChange(() => {
      // Matched as sign-in matches it (SQLite's case folding), and kept under the name the file has for it.
      const found = this.sql.prepare('SELECT name FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as { name: string } | undefined;
      if (!found) throw new StoreError(960, `No account "${account}"`);
      account = found.name;
      let surfaces: string[] | undefined;
      if (opts.surfaces && opts.surfaces.length) {
        surfaces = [...new Set(opts.surfaces.map((s) => s.toLowerCase()))];
        const bad = surfaces.find((s) => !TOKEN_SURFACES.has(s));
        if (bad) throw new StoreError(960, `"${bad}" is not a surface a token can be scoped to (${[...TOKEN_SURFACES].join(', ')})`);
      }
      // Layout scope: the token may read/write only through these layouts, on the
      // Data API. The table-oriented surfaces (OData, SQL) go through no layout, so
      // a layout-scoped token is refused there rather than silently unscoped.
      let layouts: string[] | undefined;
      if (opts.layouts && opts.layouts.length) {
        const byName = new Map(this.schema.layouts.map((l) => [l.name.toLowerCase(), l.name]));
        layouts = [];
        for (const name of opts.layouts) {
          const real = byName.get(String(name).toLowerCase());
          if (!real) throw new StoreError(960, `No layout "${name}"`);
          if (!layouts.includes(real)) layouts.push(real);
        }
        if (surfaces && !surfaces.includes('fmrest') && !surfaces.includes('fmmcp')) throw new StoreError(960, 'A layout-scoped token must allow the Data API (fmrest) or AI apps (fmmcp)');
      }
      const id = randomBytes(6).toString('hex');
      const secret = randomBytes(24).toString('base64url');
      const token = `ohbt_${id}.${secret}`;
      if (opts.identity && opts.provenance === 'service') throw new StoreError(960, 'A person-bound token cannot be a service token');
      const provenance = opts.identity ? 'delegated' : opts.provenance ?? 'service';
      this.sql.prepare(`INSERT INTO _fm_api_tokens (id, label, account, token_hash, read_only, created, expires, surfaces, layouts, identity, provenance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, opts.label ?? null, account, createHash('sha256').update(token).digest('hex'),
        opts.readOnly ? 1 : 0, new Date().toISOString(), opts.expires ? opts.expires.toISOString() : null,
        surfaces ? JSON.stringify(surfaces) : null, layouts ? JSON.stringify(layouts) : null, opts.identity ? JSON.stringify(opts.identity) : null, provenance);
      this.logSecurity('api-token-issued', { target: account, detail: { id, ...(opts.label ? { label: opts.label } : {}), readOnly: !!opts.readOnly, ...(surfaces ? { surfaces } : {}), ...(layouts ? { layouts } : {}) } });
      return token;
    });
  }

  // --- usage per account ---------------------------------------------------

  private usagePending = new Map<string, number>();
  private usageFlushed = performance.now();
  private usageTimer?: ReturnType<typeof setTimeout>;

  /**
   * Counts one request by an account on a surface ('web', 'rest', 'mcp'...) toward today's usage. Counted in memory and
   * written together every few seconds (and at close), so it adds nothing to a request; each write adds to the day's
   * row, so several workers of one server add up exactly. Only counts: never what was asked or returned.
   */
  recordUsage(account: string, surface: string): void {
    const key = `${account.toLowerCase()}\0${surface}`;
    this.usagePending.set(key, (this.usagePending.get(key) ?? 0) + 1);
    if (performance.now() - this.usageFlushed > 10_000) {
      try { this.flushUsage(); } catch { /* counted again next time */ }
    } else if (!this.usageTimer) {
      // Written within seconds even if no other request comes, so another worker's report sees it.
      this.usageTimer = setTimeout(() => {
        this.usageTimer = undefined;
        try { this.flushUsage(); } catch { /* counted again next time */ }
      }, 10_000);
      this.usageTimer.unref?.();
    }
  }

  private objectUsePending = new Map<string, number>();

  /**
   * Counts a layout opened or a script run by an account toward today's use, as recordUsage counts requests: for
   * least privilege to tell which of a set's layout and script grants nobody on it uses. Only names and counts, with
   * the set the account used them under.
   */
  recordObjectUse(account: string, set: string, kind: 'layout' | 'script', name: string): void {
    const key = `${account.toLowerCase()}\0${set}\0${kind}\0${name}`;
    this.objectUsePending.set(key, (this.objectUsePending.get(key) ?? 0) + 1);
    // Not inside a transaction (a write, a script's): the flush would only fail there, after waiting for the file.
    if (performance.now() - this.usageFlushed > 10_000 && !this.sql.isTransaction) {
      try { this.flushUsage(); } catch { /* counted again next time */ }
    } else if (!this.usageTimer) {
      this.usageTimer = setTimeout(() => {
        this.usageTimer = undefined;
        try { this.flushUsage(); } catch { /* counted again next time */ }
      }, 10_000);
      this.usageTimer.unref?.();
    }
  }

  flushUsage(): void {
    this.usageFlushed = performance.now();
    if (!this.usagePending.size && !this.objectUsePending.size) return;
    const day = new Date().toISOString().slice(0, 10);
    const rows = [...this.usagePending];
    const objects = [...this.objectUsePending];
    this.usagePending = new Map();
    this.objectUsePending = new Map();
    try {
      this.writeUsage(day, rows, objects);
    } catch (e) {
      // Not written (a busy file): counted again at the next flush instead of lost.
      for (const [key, n] of rows) this.usagePending.set(key, (this.usagePending.get(key) ?? 0) + n);
      for (const [key, n] of objects) this.objectUsePending.set(key, (this.objectUsePending.get(key) ?? 0) + n);
      throw e;
    }
  }

  private writeUsage(day: string, rows: [string, number][], objects: [string, number][] = []): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS _fm_usage (day TEXT NOT NULL, account TEXT NOT NULL, surface TEXT NOT NULL, requests INTEGER NOT NULL, PRIMARY KEY (day, account, surface))');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${OBJECT_USAGE} (day TEXT NOT NULL, account TEXT NOT NULL, privilege_set TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, uses INTEGER NOT NULL, PRIMARY KEY (day, account, privilege_set, kind, name))`);
    // All or none, so a retry after a failure never counts a row twice.
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      if (rows.length) this.writeUsageRows(day, rows);
      if (objects.length) this.writeObjectUseRows(day, objects);
      this.sql.exec('COMMIT');
    } catch (e) {
      try { this.sql.exec('ROLLBACK'); } catch { /* nothing open */ }
      throw e;
    }
  }

  private writeUsageRows(day: string, rows: [string, number][]): void {
    // From the first counts written the current way, least privilege can judge the surfaces counted only since then.
    if (!this.usageCounting()) this.sql.prepare(`INSERT INTO _fm_meta VALUES ('usageCounting', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify({ version: USAGE_COUNTING, since: day }));
    const add = this.sql.prepare('INSERT INTO _fm_usage (day, account, surface, requests) VALUES (?, ?, ?, ?) ON CONFLICT (day, account, surface) DO UPDATE SET requests = requests + excluded.requests');
    for (const [key, n] of rows) {
      const [account, surface] = key.split('\0');
      add.run(day, account, surface, n);
    }
    // A year and a bit is plenty; older days go.
    this.sql.prepare('DELETE FROM _fm_usage WHERE day < ?').run(new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10));
  }

  private writeObjectUseRows(day: string, rows: [string, number][]): void {
    // Least privilege judges layout and script grants only over days counted since then.
    if (!this.objectUseSince()) this.sql.prepare(`INSERT INTO _fm_meta VALUES ('objectUseSince', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(day));
    const add = this.sql.prepare(`INSERT INTO ${OBJECT_USAGE} (day, account, privilege_set, kind, name, uses) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (day, account, privilege_set, kind, name) DO UPDATE SET uses = uses + excluded.uses`);
    for (const [key, n] of rows) {
      const [account, set, kind, name] = key.split('\0');
      add.run(day, account, set, kind, name, n);
    }
    this.sql.prepare(`DELETE FROM ${OBJECT_USAGE} WHERE day < ?`).run(new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10));
  }

  /** The first day layouts and scripts were counted in this file, or undefined before they have been. */
  private objectUseSince(): string | undefined {
    const row = this.sql.prepare(`SELECT json FROM _fm_meta WHERE key = 'objectUseSince'`).get() as { json: string } | undefined;
    return row ? JSON.parse(row.json) as string : undefined;
  }

  /**
   * What each account has done in the last `days` days (default 30): requests by surface, days active, first and last
   * day, and sign-ins from the audit log (failed ones too). Every account in the file is listed, those that did
   * nothing with zero requests, so unused accounts stand out. Counts only.
   */
  accountUsage(days = 30): { days: number; accounts: { account: string; requests: number; bySurface: Record<string, number>; daysActive: number; firstDay?: string; lastDay?: string; signIns: number; failedSignIns: number }[] } {
    try { this.flushUsage(); } catch { /* what is on disk */ }
    days = Math.max(1, Math.min(400, Math.floor(days) || 30));
    const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const exists = this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_fm_usage'").get();
    const rows = exists ? this.sql.prepare('SELECT day, account, surface, requests FROM _fm_usage WHERE day >= ?').all(since) as { day: string; account: string; surface: string; requests: number }[] : [];
    const out = new Map<string, { account: string; requests: number; bySurface: Record<string, number>; dayset: Set<string>; signIns: number; failedSignIns: number }>();
    const entry = (name: string) => {
      const k = name.toLowerCase();
      let e = out.get(k);
      if (!e) out.set(k, e = { account: name, requests: 0, bySurface: {}, dayset: new Set(), signIns: 0, failedSignIns: 0 });
      return e;
    };
    for (const a of this.accounts()) if (!/^\[.*\]$/.test(a.name)) entry(a.name);
    for (const r of rows) {
      const e = entry(r.account);
      e.requests += Number(r.requests);
      e.bySurface[r.surface] = (e.bySurface[r.surface] ?? 0) + Number(r.requests);
      e.dayset.add(r.day);
    }
    const from = `${since}T00:00:00.000Z`;
    for (const a of this.auditLog({ kinds: ['sign-in', 'sign-in-failed'], security: true, since: from, limit: 50_000 })) {
      if (!a.account) continue;
      const e = entry(a.account);
      if (a.kind === 'sign-in') e.signIns++; else e.failedSignIns++;
    }
    return {
      days,
      accounts: [...out.values()].map(({ dayset, ...e }) => {
        const d = [...dayset].sort();
        return { ...e, daysActive: d.length, ...(d.length ? { firstDay: d[0], lastDay: d[d.length - 1] } : {}) };
      }).sort((a, b) => b.requests - a.requests || a.account.localeCompare(b.account)),
    };
  }

  /** API tokens for this file, newest first; the secret is never shown again. */
  apiTokens(): { id: string; label?: string; account: string; readOnly: boolean; created: string; expires?: string; lastUsed?: string; surfaces?: string[]; layouts?: string[] }[] {
    return (this.sql.prepare('SELECT id, label, account, read_only, created, expires, last_used, surfaces, layouts FROM _fm_api_tokens ORDER BY created DESC, rowid DESC').all() as
      { id: string; label: string | null; account: string; read_only: number; created: string; expires: string | null; last_used: string | null; surfaces: string | null; layouts: string | null }[])
      .map((r) => ({ id: r.id, account: r.account, readOnly: !!r.read_only, created: r.created,
        ...(r.label ? { label: r.label } : {}), ...(r.expires ? { expires: r.expires } : {}), ...(r.last_used ? { lastUsed: r.last_used } : {}),
        ...(r.surfaces ? { surfaces: JSON.parse(r.surfaces) as string[] } : {}), ...(r.layouts ? { layouts: JSON.parse(r.layouts) as string[] } : {}) }));
  }

  /** Revokes a token by its id; returns whether one was removed. */
  revokeApiToken(id: string): boolean {
    return this.securityChange(() => {
      const removed = this.sql.prepare('DELETE FROM _fm_api_tokens WHERE id = ?').run(id).changes > 0;
      if (removed) this.logSecurity('api-token-revoked', { detail: { id } });
      return removed;
    });
  }

  /**
   * The account a bearer token stands for, or undefined when the token is invalid
   * or expired, or its account is inactive or owes a password change.
   * Compared in constant time; records the time it was last used.
   */
  apiToken(token: string): { account: string; readOnly: boolean; surfaces?: string[]; layouts?: string[]; identity?: { issuer: string; sub: string; person?: string; mapping: string }; provenance?: 'service' | 'delegated' } | undefined {
    const m = /^ohbt_([0-9a-f]+)\./.exec(token);
    if (!m) return undefined;
    const row = this.sql.prepare('SELECT token_hash, account, read_only, expires, surfaces, layouts, identity, provenance FROM _fm_api_tokens WHERE id = ?').get(m[1]) as
      { token_hash: string; account: string; read_only: number; expires: string | null; surfaces: string | null; layouts: string | null; identity: string | null; provenance: string | null } | undefined;
    if (!row) return undefined;
    const want = Buffer.from(row.token_hash, 'hex');
    const got = createHash('sha256').update(token).digest();
    if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
    if (row.expires && !(Date.parse(row.expires) > expiryClock.now())) return undefined;
    if (this.accountInactive(row.account) || this.mustChangePassword(row.account)) return undefined;
    const identity = row.identity ? JSON.parse(row.identity) as { issuer: string; sub: string; person?: string; mapping: string } : undefined;
    if (this.isExternal(row.account) && row.provenance !== 'service' && (!identity || identity.mapping.toLowerCase() !== row.account.toLowerCase())) return undefined;
    if (identity?.person && this.accountInactive(identity.person)) return undefined;
    if (identity && (!this.isExternal(identity.mapping) || !this.canonicalAccount(identity.mapping) || this.accountInactive(identity.mapping))) return undefined;
    this.sql.prepare('UPDATE _fm_api_tokens SET last_used = ? WHERE id = ?').run(new Date().toISOString(), m[1]);
    return { account: row.account, readOnly: !!row.read_only, ...(row.surfaces ? { surfaces: JSON.parse(row.surfaces) as string[] } : {}), ...(row.layouts ? { layouts: JSON.parse(row.layouts) as string[] } : {}), ...(identity ? { identity } : {}), ...(row.provenance === 'service' || row.provenance === 'delegated' ? { provenance: row.provenance } : {}) };
  }

  // --- two-factor sign-in (TOTP) --------------------------------------------

  /**
   * Starts setting up a second factor for an account: makes a secret, keeps it
   * pending, and returns it with the otpauth:// URI to show as a QR code. The
   * account must confirm a code (confirmTotp) before it takes effect, so a
   * mistyped secret can't lock anyone out.
   */
  enrollTotp(account: string): { secret: string; uri: string } {
    return this.securityChange(() => {
      if (!this.accounts().some((a) => a.name.toLowerCase() === account.toLowerCase())) throw new StoreError(960, `No account "${account}"`);
      const secret = generateTotpSecret();
      this.sql.prepare(`INSERT INTO _fm_totp (account, secret, confirmed, created) VALUES (?, ?, 0, ?)
        ON CONFLICT(account) DO UPDATE SET secret = excluded.secret, confirmed = 0, created = excluded.created, last_step = NULL`)
        .run(account, secret, new Date().toISOString());
      this.logSecurity('two-factor-enrolled', { target: account });
      return { secret, uri: totpUri(account, secret) };
    });
  }

  /** Confirms a pending second factor with a code from the authenticator app; returns whether it matched. */
  confirmTotp(account: string, code: string): boolean {
    return this.securityChange(() => {
      const row = this.sql.prepare('SELECT secret FROM _fm_totp WHERE account = ? COLLATE NOCASE AND confirmed = 0').get(account) as { secret: string } | undefined;
      if (!row || checkTotp(row.secret, code) === undefined) return false;
      this.sql.prepare('UPDATE _fm_totp SET confirmed = 1 WHERE account = ? COLLATE NOCASE').run(account);
      this.logSecurity('two-factor-confirmed', { target: account });
      return true;
    });
  }

  /** Whether the account has a confirmed second factor it must use to sign in. */
  hasTotp(account: string): boolean {
    return !!this.sql.prepare('SELECT 1 FROM _fm_totp WHERE account = ? COLLATE NOCASE AND confirmed = 1').get(account);
  }

  /** Accounts with a confirmed second factor. */
  totpAccounts(): string[] {
    return (this.sql.prepare('SELECT account FROM _fm_totp WHERE confirmed = 1 ORDER BY account').all() as { account: string }[]).map((r) => r.account);
  }

  /** Turns off the second factor for an account. */
  disableTotp(account: string): boolean {
    return this.securityChange(() => {
      const removed = this.sql.prepare('DELETE FROM _fm_totp WHERE account = ? COLLATE NOCASE').run(account).changes > 0;
      if (removed) this.logSecurity('two-factor-disabled', { target: account });
      return removed;
    });
  }

  /**
   * Checks a one-time code for an account's confirmed second factor. A code is
   * accepted once: the step it matched is remembered, so it can't be replayed
   * within its 30-second window.
   */
  /**
   * Checks a one-time code for an account, as the second factor at sign-in.
   * Wrong codes from a place are throttled like wrong passwords (their own
   * lockout bucket, so a success at the password step doesn't reset the code
   * count): too many and that place is blocked for LOCKOUT.lockMs, which stops
   * someone brute-forcing the six digits. `from` names the place (the client
   * address); a blocked place is refused before the code is even checked.
   */
  verifyTotp(account: string, code: string, from = ''): boolean {
    const key = `${this.bucketKey(account, from)}\u0000totp`;
    const known = this.knownSharedAccount(account, from);
    if (this.failures.lockedOut(key, from, known)) return this.failures.record(key, from, false, known);
    const row = this.sql.prepare('SELECT secret, last_step FROM _fm_totp WHERE account = ? COLLATE NOCASE AND confirmed = 1').get(account) as
      { secret: string; last_step: number | null } | undefined;
    if (!row) return this.failures.record(key, from, false, known);
    const step = checkTotp(row.secret, code);
    if (step === undefined || (row.last_step !== null && step <= row.last_step)) return this.failures.record(key, from, false, known);
    if (!this.failures.record(key, from, true, known)) return false;
    this.sql.prepare('UPDATE _fm_totp SET last_step = ? WHERE account = ? COLLATE NOCASE').run(step, account);
    return true;
  }

  // --- passkeys (WebAuthn) --------------------------------------------------

  /**
   * Issues a one-time challenge for a passkey ceremony and remembers it (with
   * the account, for registration). Old challenges are swept so the table
   * doesn't grow. Returns the base64url challenge to send to the browser.
   */
  issueWebauthnChallenge(kind: 'register' | 'auth', account?: string): string {
    const now = expiryClock.now();
    this.sql.prepare(`DELETE FROM _fm_webauthn_challenges WHERE created < ?`).run(new Date(now - 300_000).toISOString());
    // However fast they are asked for, only so many wait at once: the oldest go first.
    const waiting = (this.sql.prepare('SELECT count(*) AS n FROM _fm_webauthn_challenges').get() as { n: number }).n;
    if (waiting > 5000) this.sql.prepare('DELETE FROM _fm_webauthn_challenges WHERE rowid IN (SELECT rowid FROM _fm_webauthn_challenges ORDER BY created LIMIT ?)').run(waiting - 4000);
    const challenge = randomBytes(32).toString('base64url');
    this.sql.prepare('INSERT INTO _fm_webauthn_challenges (challenge, account, kind, created) VALUES (?, ?, ?, ?)')
      .run(challenge, account ?? null, kind, new Date(now).toISOString());
    return challenge;
  }

  private challengeAsks = new Map<string, { start: number; n: number }>();

  /**
   * How many seconds an address must wait before it may ask for another sign-in challenge (0 when it may now): each
   * address gets 60 a minute, 600 for this computer and for visitors who can't be told apart, so a flood of asks
   * neither fills the table nor burns time. Asking is not a failed sign-in and is not charged to the lockout budget, so
   * it can't lock anyone out of a password sign-in; people sharing an address do share this allowance. The counts are
   * kept in this process.
   */
  challengeWait(from: string): number {
    const now = performance.now();
    const key = NO_ADDRESS_BUDGET.has(from) ? from : addressBucket(from);
    const limit = NO_ADDRESS_BUDGET.has(from) ? 600 : 60;
    let e = this.challengeAsks.get(key);
    if (!e || now - e.start >= 60_000) {
      if (this.challengeAsks.size > 10_000) {
        for (const [k, v] of this.challengeAsks) if (now - v.start >= 60_000) this.challengeAsks.delete(k);
        for (const k of this.challengeAsks.keys()) { // still full of live ones: the oldest go, not everyone's count
          if (this.challengeAsks.size <= 8_000) break;
          this.challengeAsks.delete(k);
        }
      }
      this.challengeAsks.set(key, (e = { start: now, n: 0 }));
    }
    if (e.n >= limit) return Math.max(1, Math.ceil((e.start + 60_000 - now) / 1000));
    e.n++;
    return 0;
  }

  /**
   * The credential ids to offer someone signing in as this account. An account with no passkey, a deactivated one, or
   * no such account gets one to three made-up ids, the same each time for the same name, with lengths taken from the
   * ids this file really holds, so the answer doesn't say which accounts exist. (Someone who watches one name over time
   * can still see a made-up id become a real one when a passkey is added.)
   */
  passkeyAllowList(account: string): string[] {
    if (!this.accountInactive(account)) {
      const real = this.passkeyIds(account);
      if (real.length) return real;
    }
    const key = createHmac('sha256', this.meta('accountImportSecret') as string).update('passkey-decoy-v1').digest();
    const h = createHmac('sha256', key).update(account.toLowerCase().slice(0, 256)).digest();
    const lengths = [...new Set((this.sql.prepare('SELECT length(id) AS n FROM _fm_passkeys').all() as { n: number }[]).map((r) => Math.floor((r.n * 3) / 4)))].sort((x, y) => x - y);
    const sizes = lengths.length ? lengths : [32];
    const count = 1 + (h[30] % 3 === 0 ? 1 : 0) + (h[30] % 11 === 0 ? 1 : 0);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const bytes = createHmac('sha256', key).update(h).update(String(i)).digest();
      const size = sizes[h[i] % sizes.length];
      ids.push((size <= bytes.length ? bytes.subarray(0, size) : Buffer.concat([bytes, createHmac('sha256', key).update(bytes).digest()]).subarray(0, size)).toString('base64url'));
    }
    return ids;
  }

  /** Consumes a challenge, returning its account (for registration) when still valid (issued, right kind, under 5 minutes old). */
  private takeWebauthnChallenge(challenge: string, kind: 'register' | 'auth'): { ok: boolean; account: string | null } {
    const row = this.sql.prepare('SELECT account, kind, created FROM _fm_webauthn_challenges WHERE challenge = ?').get(challenge) as
      { account: string | null; kind: string; created: string } | undefined;
    if (row) this.sql.prepare('DELETE FROM _fm_webauthn_challenges WHERE challenge = ?').run(challenge);
    if (!row || row.kind !== kind || expiryClock.now() - Date.parse(row.created) > 300_000) return { ok: false, account: null };
    return { ok: true, account: row.account };
  }

  /** The passkeys registered for an account (or all of them), newest first; never the key material in a usable form. */
  passkeys(account?: string): { id: string; account: string; label?: string; created: string; lastUsed?: string }[] {
    const where = account ? ' WHERE account = ? COLLATE NOCASE' : '';
    const rows = this.sql.prepare(`SELECT id, account, label, created, last_used FROM _fm_passkeys${where} ORDER BY created DESC, rowid DESC`)
      .all(...(account ? [account] : [])) as { id: string; account: string; label: string | null; created: string; last_used: string | null }[];
    return rows.map((r) => ({ id: r.id, account: r.account, ...(r.label ? { label: r.label } : {}), created: r.created, ...(r.last_used ? { lastUsed: r.last_used } : {}) }));
  }

  /** Whether an account has at least one passkey (so the sign-in page can offer it). */
  hasPasskey(account: string): boolean {
    return !!this.sql.prepare('SELECT 1 FROM _fm_passkeys WHERE account = ? COLLATE NOCASE LIMIT 1').get(account);
  }

  /** The credential ids registered for an account, for a sign-in's allowCredentials list. */
  passkeyIds(account: string): string[] {
    return (this.sql.prepare('SELECT id FROM _fm_passkeys WHERE account = ? COLLATE NOCASE').all(account) as { id: string }[]).map((r) => r.id);
  }

  /**
   * Verifies a registration ceremony against the challenge just issued for the
   * account and stores the new passkey. `rpId` and `origin` come from the
   * request so the credential is bound to this server.
   */
  registerPasskey(account: string, response: { attestationObject: string; clientDataJSON: string },
    env: { rpId: string; origin: string | string[]; challenge: string }, label?: string): { id: string } {
    this.joinTransaction();
    if (!this.accounts().some((a) => a.name.toLowerCase() === account.toLowerCase())) throw new StoreError(960, `No account "${account}"`);
    const taken = this.takeWebauthnChallenge(env.challenge, 'register');
    if (!taken.ok || (taken.account && taken.account.toLowerCase() !== account.toLowerCase())) throw new StoreError(960, 'The registration has expired; start again');
    let cred: RegisteredCredential;
    try {
      cred = verifyRegistration({ attestationObject: response.attestationObject, clientDataJSON: response.clientDataJSON, challenge: env.challenge, origin: env.origin, rpId: env.rpId });
    } catch (e) {
      throw new StoreError(960, `The passkey could not be registered: ${(e as Error).message}`);
    }
    // Keep challenge consumption on a failed ceremony; the credential and event are atomic.
    return this.securityChange(() => {
      this.sql.prepare(`INSERT INTO _fm_passkeys (id, account, public_key, sign_count, alg, label, created) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET account = excluded.account, public_key = excluded.public_key, sign_count = excluded.sign_count, alg = excluded.alg`)
        .run(cred.credentialId, account, cred.publicKey, cred.signCount, cred.alg, label ?? null, new Date().toISOString());
      this.logSecurity('passkey-registered', { target: account, detail: { id: cred.credentialId, ...(label ? { label } : {}) } });
      return { id: cred.credentialId };
    });
  }

  /** Removes a passkey by its credential id; returns whether one was removed. */
  removePasskey(id: string): boolean {
    return this.securityChange(() => {
      const row = this.sql.prepare('SELECT account FROM _fm_passkeys WHERE id = ?').get(id) as { account: string } | undefined;
      const removed = this.sql.prepare('DELETE FROM _fm_passkeys WHERE id = ?').run(id).changes > 0;
      if (removed) this.logSecurity('passkey-removed', { target: row?.account, detail: { id } });
      return removed;
    });
  }

  /**
   * Verifies a sign-in assertion against the issued challenge and the stored
   * credential, advances the signature counter, and returns the account the
   * passkey belongs to. Throws (StoreError 212) when anything doesn't check out.
   */
  verifyPasskeyAssertion(response: { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string },
    env: { rpId: string; origin: string | string[]; challenge: string }): string {
    if (typeof response.credentialId !== 'string' || typeof env.challenge !== 'string') throw new StoreError(212, PASSKEY_REFUSED);
    const taken = this.takeWebauthnChallenge(env.challenge, 'auth');
    if (!taken.ok) throw new StoreError(212, 'The sign-in has expired; try again');
    const row = this.sql.prepare('SELECT account, public_key, sign_count FROM _fm_passkeys WHERE id = ?').get(response.credentialId) as
      { account: string; public_key: string; sign_count: number } | undefined;
    // One answer for every way a passkey can fail, so nobody learns which of them it was.
    if (!row || this.accountInactive(row.account)) throw new StoreError(212, PASSKEY_REFUSED);
    let result: { signCount: number };
    try {
      result = verifyAssertion({ publicKey: row.public_key, clientDataJSON: response.clientDataJSON, authenticatorData: response.authenticatorData,
        signature: response.signature, challenge: env.challenge, origin: env.origin, rpId: env.rpId, storedSignCount: row.sign_count });
    } catch (e) {
      throw new StoreError(212, PASSKEY_REFUSED);
    }
    this.sql.prepare('UPDATE _fm_passkeys SET sign_count = ?, last_used = ? WHERE id = ?').run(result.signCount, new Date().toISOString(), response.credentialId);
    return row.account;
  }

  /**
   * Verifies a passkey assertion as the second factor for an account whose
   * password has already checked out — unlike verifyPasskeyAssertion (which
   * identifies the account from the credential alone), this requires the
   * credential to belong to the account already being signed in as. Throws
   * (StoreError 212) when it doesn't verify or belongs to someone else.
   */
  verifyPasskeyFactor(account: string, response: { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string },
    env: { rpId: string; origin: string | string[]; challenge: string }): void {
    const who = this.verifyPasskeyAssertion(response, env);
    if (who.toLowerCase() !== account.toLowerCase()) throw new StoreError(212, PASSKEY_REFUSED);
  }

  /** Whether an account has a confirmed second factor of any kind (an authenticator app or a passkey) set up. */
  hasSecondFactor(account: string): boolean {
    return this.hasTotp(account) || this.hasPasskey(account);
  }

  // --- recovery codes -------------------------------------------------------

  private hashRecoveryCode(code: string): string {
    return createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');
  }

  /**
   * Makes a fresh set of one-time recovery codes for an account (replacing any
   * it had), stores only their hashes, and returns the codes once to show the
   * person. A fallback for when a passkey or authenticator is lost.
   */
  generateRecoveryCodes(account: string, count = 10): string[] {
    return this.securityChange(() => {
      if (!this.accounts().some((a) => a.name.toLowerCase() === account.toLowerCase())) throw new StoreError(960, `No account "${account}"`);
      this.sql.prepare('DELETE FROM _fm_recovery_codes WHERE account = ? COLLATE NOCASE').run(account);
      const now = new Date().toISOString();
      const codes: string[] = [];
      const insert = this.sql.prepare('INSERT INTO _fm_recovery_codes (account, code_hash, created) VALUES (?, ?, ?)');
      for (let i = 0; i < count; i++) {
        // Readable groups, like "a1b2-c3d4-e5f6".
        const raw = randomBytes(6).toString('hex');
        const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
        codes.push(code);
        insert.run(account, this.hashRecoveryCode(code), now);
      }
      this.logSecurity('recovery-codes-generated', { target: account, detail: { count } });
      return codes;
    });
  }

  /** How many unused recovery codes an account has left. */
  recoveryCodesRemaining(account: string): number {
    return Number((this.sql.prepare('SELECT COUNT(*) AS n FROM _fm_recovery_codes WHERE account = ? COLLATE NOCASE AND used IS NULL').get(account) as { n: number }).n);
  }

  /** Consumes one of an account's recovery codes; returns whether it matched an unused one. */
  useRecoveryCode(account: string, code: string, from = ''): boolean {
    return this.securityChange(() => {
      const key = `${this.bucketKey(account, from)}\u0000recovery`;
      const known = this.knownSharedAccount(account, from);
      if (this.failures.lockedOut(key, from, known) || this.accountInactive(account)) return this.failures.record(key, from, false, known);
      const hash = this.hashRecoveryCode(code);
      const match = this.sql.prepare('SELECT 1 FROM _fm_recovery_codes WHERE account = ? COLLATE NOCASE AND code_hash = ? AND used IS NULL').get(account, hash);
      if (!this.failures.record(key, from, !!match, known)) return false;
      this.sql.prepare('UPDATE _fm_recovery_codes SET used = ? WHERE account = ? COLLATE NOCASE AND code_hash = ? AND used IS NULL')
        .run(new Date().toISOString(), account, hash);
      this.logSecurity('recovery-code-used', { target: account });
      return true;
    });
  }

  // --- privileges -----------------------------------------------------------

  /** Every privilege set: the file's, as changed in Tabularius, plus sets added here. */
  privilegeSets(): PrivilegeDefinition[] {
    return privilegeSets(this.sql, this.schema);
  }

  privilegeSet(name: string): PrivilegeDefinition | undefined {
    return this.privilegeSets().find((p) => p.name.toLowerCase() === name.toLowerCase());
  }

  /** Adds or replaces a privilege set ([Full Access] can only change its extended privileges). */
  savePrivilegeSet(definition: unknown): PrivilegeDefinition {
    return this.securityChange(() => {
      const d = this.privilegeError(() => validateDefinition(definition));
      const existing = this.privilegeSet(d.name);
      // A set keeps its name's spelling and its id in the file; an id can't be taken from another set.
      const name = existing?.name ?? d.name;
      const id = existing ? existing.id : d.id !== undefined && this.privilegeSets().some((p) => p.id === d.id) ? undefined : d.id;
      if (!existing && isFullAccess(d)) throw new StoreError(960, 'Invalid privilege set: there is only one [Full Access]');
      const saved = { ...d, name, ...(id !== undefined ? { id } : {}) };
      if (id === undefined) delete saved.id;
      // The unverified-import marker only stays for fields that are still hidden and still exist, so a later
      // "relax" can never widen a field the admin hid on purpose after the import, or one that was removed.
      if (saved.unverifiedReadOnly) {
        const kept: Record<string, string[]> = {};
        for (const [table, names] of Object.entries(saved.unverifiedReadOnly)) {
          const def = this.schema.tables.find((t) => t.name === table);
          const live = names.filter((n) => saved.tables?.[table]?.fields?.[n] === 'none' && def?.fields.some((f) => f.name === n));
          if (live.length) kept[table] = live;
        }
        if (Object.keys(kept).length) saved.unverifiedReadOnly = kept; else delete saved.unverifiedReadOnly;
      }
      this.sql.prepare('INSERT INTO _fm_privileges VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json').run(name, JSON.stringify(saved));
      this.privilegeCache.invalidate((cache) => cache.clear());
      const authority = (set: PrivilegeDefinition) => {
        const { idleDisconnect: _idle, comment: _comment, ...rest } = set;
        return JSON.stringify(rest);
      };
      if (existing && authority(existing) !== authority(saved)) {
        for (const account of this.accounts()) if (account.privilegeSet?.toLowerCase() === name.toLowerCase()) {
          this.sql.prepare('DELETE FROM _fm_api_tokens WHERE account = ? COLLATE NOCASE').run(account.name);
        }
      }
      this.logSecurity('privilege-set-saved', { target: name });
      return saved;
    });
  }

  /**
   * The admin's knowing relaxation of an unverified import mapping: fields of a custom
   * set that the importer hid because their per-field byte (0x01) is only inferred to
   * mean view-only become view-only. Returns how many fields were relaxed.
   */
  relaxUnverifiedAccess(name: string): number {
    const set = this.privilegeSet(name);
    if (!set) throw new StoreError(960, `No privilege set "${name}"`);
    if (!Object.keys(set.unverifiedReadOnly ?? {}).length) return 0;
    const { def, relaxed } = relaxUnverified(set);
    this.savePrivilegeSet(def);
    return relaxed;
  }

  /**
   * Deletes a privilege set. Refuses the built-in sets ([Full Access] and the
   * two others), a set an account still uses, and a set defined only in the
   * FileMaker file (which has no Tabularius copy to remove). Returns whether one
   * was removed.
   */
  deletePrivilegeSet(name: string): boolean {
    return this.securityChange(() => {
      const set = this.privilegeSet(name);
      if (!set) return false;
      if (isFullAccess(set) || (set.id !== undefined && set.id <= 3)) throw new StoreError(960, `Cannot delete the built-in set "${set.name}"`);
      const users = this.accounts().filter((a) => a.privilegeSet && a.privilegeSet.toLowerCase() === set.name.toLowerCase()).map((a) => a.name);
      if (users.length) throw new StoreError(960, `"${set.name}" is still used by ${users.join(', ')}`);
      const r = this.sql.prepare('DELETE FROM _fm_privileges WHERE name = ? COLLATE NOCASE').run(set.name);
      this.privilegeCache.invalidate((cache) => cache.clear());
      if (!r.changes && this.schema.privilegeSets.some((p) => p.name.toLowerCase() === set.name.toLowerCase())) {
        throw new StoreError(960, `"${set.name}" is defined in the FileMaker file; remove it in FileMaker Pro`);
      }
      if (r.changes > 0) this.logSecurity('privilege-set-deleted', { target: set.name });
      return r.changes > 0;
    });
  }

  /**
   * Applies a batch of account and privilege-set changes all-or-none, so a
   * half-finished edit never leaves the file in a broken state. Credential
   * operations that reveal a secret (minting an API token, enrolling a second
   * factor) are not here: they have their own calls.
   */
  applySecurity(ops: SecurityOp[]): void {
    this.securityChange(() => {
      for (const op of ops) {
        switch (op.op) {
          case 'setAccount':
            if (op.password !== undefined) this.setPassword(op.name, op.password, op.privilegeSet, { mustChange: op.mustChange });
            else {
              if (!this.accounts().some((a) => a.name.toLowerCase() === op.name.toLowerCase())) throw new StoreError(960, `No account "${op.name}" (give it a password to create it)`);
              if (op.privilegeSet !== undefined) this.setAccountPrivilegeSet(op.name, op.privilegeSet);
              if (op.mustChange !== undefined) this.setMustChangePassword(op.name, op.mustChange);
            }
            // Per-account sign-in restrictions, settable with or without a password change.
            if (op.localOnly !== undefined) this.setAccountLocalOnly(op.name, op.localOnly);
            if (op.require2fa !== undefined) this.setAccountRequire2fa(op.name, op.require2fa);
            break;
          case 'setPasswordPolicy': this.setPasswordPolicy(op.policy); break;
          case 'setRequireTotpForFullAccess': this.setRequireTotpForFullAccess(op.on); break;
          case 'setExternalAccount': this.setExternalAccount(op.name, op.privilegeSet); break;
          case 'setAgentAccount': this.setAgentAccount(op.name, op.privilegeSet, { createdBy: op.createdBy, needsApproval: op.needsApproval }); break;
          case 'deleteAccount': this.deleteAccount(op.name); break;
          case 'savePrivilegeSet': this.savePrivilegeSet(op.set); break;
          case 'deletePrivilegeSet': this.deletePrivilegeSet(op.name); break;
          case 'disableTotp': this.disableTotp(op.account); break;
          case 'revokeApiToken': this.revokeApiToken(op.id); break;
          default: throw new StoreError(960, `Unknown security change "${(op as { op: string }).op}"`);
        }
      }
    });
    this.privilegeCache.invalidate((cache) => cache.clear());
  }

  /** The privilege set an account uses: one set in Tabularius, else the file's. */
  accountPrivilegeSet(account: string): string | undefined {
    const row = this.sql.prepare('SELECT name, privilege_set FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as
      | { name: string; privilege_set: string | null } | undefined;
    if (row?.privilege_set) return row.privilege_set;
    const a = this.schema.accounts.find((x) => x.name.toLowerCase() === account.toLowerCase());
    return a?.privilegeSetId === undefined ? undefined : this.schema.privilegeSets.find((p) => p.id === a.privilegeSetId)?.name;
  }

  setAccountPrivilegeSet(account: string, privilegeSet: string, audit: AccountMutationAudit = {}): void {
    return this.securityChange(() => {
      account = this.canonicalAccount(account) ?? account;
      const set = this.privilegeSet(privilegeSet);
      if (!set) throw new StoreError(960, `No privilege set "${privilegeSet}"`);
      if (!isFullAccess(set)) this.guardFullAccess(account);
      // An explicit assignment must be stored even when it matches the schema fallback.
      const assigned = this.sql.prepare('SELECT privilege_set FROM _fm_accounts WHERE name = ?').get(account) as { privilege_set: string | null } | undefined;
      if (assigned?.privilege_set === set.name) return;
      const before = this.accountPrivilegeSet(account);
      const r = this.sql.prepare('UPDATE _fm_accounts SET privilege_set = ? WHERE name = ? COLLATE NOCASE').run(set.name, account);
      if (!r.changes) throw new StoreError(960, `No account "${account}"`);
      this.privilegeCache.invalidate((cache) => cache.clear());
      // Tokens end only when the account's effective set changed: storing the file's own default as an explicit choice changes no one's authority.
      if (before?.toLowerCase() !== set.name.toLowerCase()) this.sql.prepare('DELETE FROM _fm_api_tokens WHERE account = ? COLLATE NOCASE').run(account);
      this.logSecurity('privilege-set-assigned', { ...audit, account: audit.account ?? audit.by, target: account, detail: { ...audit.detail, privilegeSet: set.name } });
    });
  }

  /**
   * Takes an external account's privilege set away, so it opens nothing until
   * it is given one again (an identity provider took the person out of the
   * group that gave it). Only external accounts: one with a password or from
   * the file would fall back to the file's own set, not to no access.
   */
  clearAccountPrivilegeSet(account: string, opts: { by?: string } = {}): void {
    return this.securityChange(() => {
      if (!this.isExternal(account)) throw new StoreError(960, `"${account}" is not an external account`);
      const was = this.accountPrivilegeSet(account);
      const r = this.sql.prepare('UPDATE _fm_accounts SET privilege_set = NULL WHERE name = ? COLLATE NOCASE').run(account);
      if (!r.changes) throw new StoreError(960, `No account "${account}"`);
      this.privilegeCache.invalidate((cache) => cache.clear());
      if (was) this.logSecurity('privilege-set-unassigned', { account: opts.by, target: account, detail: { privilegeSet: was } });
    });
  }

  /**
   * Adds an external account an identity provider provisioned (SCIM): one
   * person, named by their email address, with no privilege set until the
   * provider puts them in a group. `by` names who made it, for the trail.
   */
  addProvisionedAccount(name: string, by: string): void {
    return this.securityChange(() => {
      if (this.sql.prepare('SELECT 1 FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(name)) {
        throw new StoreError(960, `An account named "${name}" already exists`);
      }
      this.refuseLookalikeAccount(name);
      this.sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source, created_by) VALUES (?, NULL, 'external', ?)`).run(name, by);
      this.privilegeCache.invalidate((cache) => cache.clear());
      this.logSecurity('account-added', { account: by, target: name, detail: { external: true } });
    });
  }

  /** Records a provisioning token being issued or revoked (the token lives in the SCIM directory; see scim.ts). */
  logProvisioningToken(issued: boolean, by?: string): void {
    this.logSecurity(issued ? 'scim-token-issued' : 'scim-token-revoked', { account: by });
  }

  /**
   * An account's privileges in this file. Accounts without a privilege set (or
   * not in this file) get no access. Pass them in FindOptions/WriteOptions.
   * `via` names the external account someone signed in through: its set applies.
   */
  privileges(account: string, via?: string, person?: string): Privileges {
    // A prepared scalar read makes a remote revocation effective on the next use.
    // data_version is a cheap fallback for other-process/raw writes outside the
    // tracked tables. Triggers cover raw writes through this connection too.
    const metadata = this.metadataVersions();
    const version = `${metadata.design}/${metadata.privileges}/${this.dataVersion()}`;
    if (version !== this.privilegeVersion.value) {
      this.privilegeCache.invalidate((cache) => cache.clear());
      this.privilegeVersion.value = version;
    }
    const key = `${account.toLowerCase()}\u0000${via?.toLowerCase() ?? ''}\u0000${person?.toLowerCase() ?? ''}`;
    const cached = this.privilegeCache.value.get(key);
    if (cached && cached.account === account) return cached;
    const name = this.accountPrivilegeSet(via ?? account);
    const set = (name && this.privilegeSet(name)) || {
      name: '', records: NO_ACCESS, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
    } satisfies PrivilegeDefinition;
    const p = new Privileges(account, set, this, (file) => {
      const other = file as Store;
      return other.identityAllowed(account, via, undefined, person) ? other.privileges(account, via, person) : other.privileges('\u0000inactive-account');
    }).withVia(via);
    this.privilegeCache.value.set(key, p);
    return p;
  }

  /**
   * A Privileges for a named privilege set, with no account behind it. Used by
   * the admin "view as" preview to read a file exactly as a set would see it,
   * without having to assign the set to a real account.
   */
  privilegesForSet(setName: string): Privileges {
    const set = this.privilegeSet(setName);
    if (!set) throw new StoreError(960, `No privilege set "${setName}"`);
    return new Privileges(`[view as ${setName}]`, set, this, (file) => (file as Store).privilegesForSet(setName));
  }

  /** Audit an admin "view as" preview (a read-only look through a privilege set). */
  logViewedAs(privilegeSet: string, layout: string): void {
    this.logSecurity('viewed-as', { detail: { privilegeSet, layout } });
  }

  /** A ground-truth account of what a privilege set may do, for the "ask about access" tools. */
  accessReport(setName: string): AccessReport {
    return accessReport(this.privilegesForSet(setName), this.schema);
  }

  /**
   * "View as": everything an account or a privilege set can open and change in
   * this file, said in plain English with a reason for every denial. Pass an
   * account to see it through that account's own privileges (so record rules
   * that read Get(AccountName) resolve for that account); pass a set to see the
   * set in the abstract. Read-only — it changes nothing.
   */
  accessExplained(target: { account?: string; privilegeSet?: string }): AccessExplanation {
    if (target.account) {
      if (!this.accounts().some((a) => a.name.toLowerCase() === target.account!.toLowerCase())) {
        throw new StoreError(960, `No account "${target.account}"`);
      }
      const report = accessReport(this.privileges(target.account), this.schema);
      return explainAccess(report, { account: target.account, privilegeSet: this.accountPrivilegeSet(target.account) });
    }
    if (!target.privilegeSet) throw new StoreError(960, 'Give an account or a privilege set to view as');
    return explainAccess(this.accessReport(target.privilegeSet), { privilegeSet: target.privilegeSet });
  }

  /**
   * "Test this account": every layout and script in the file, as this
   * account's own privileges would actually meet them, including script
   * steps that reach for a layout or script it can't use. Read-only — it
   * changes nothing. The admin console logs the run as a "view as" the same
   * way it logs accessExplained.
   */
  testAccount(account: string): AccountTest {
    if (!this.accounts().some((a) => a.name.toLowerCase() === account.toLowerCase())) {
      throw new StoreError(960, `No account "${account}"`);
    }
    return testAccount(this.privileges(account), this.schema, account);
  }

  /**
   * A plain-English diff of a proposed privilege set against an existing one
   * (or against no access). Validates the proposal but never saves it, so a
   * human can approve it before it is applied with applySecurity. Throws only
   * if the proposed definition is itself invalid.
   */
  diffPrivilegeSet(proposed: unknown, baseName?: string): { valid: true; changes: SetChange[] } {
    const def = this.privilegeError(() => validateDefinition(proposed));
    const base = baseName ? this.privilegeSet(baseName) : this.privilegeSet(def.name);
    return { valid: true, changes: diffPrivilegeSet(def, base) };
  }

  /**
   * Compare two existing privilege sets, plain English: the changes that would
   * turn set `a` into set `b` (so an operator can see, line by line, how they
   * differ). Read-only. Throws if either set does not exist.
   */
  comparePrivilegeSets(a: string, b: string): { a: string; b: string; changes: SetChange[] } {
    const from = this.privilegeSet(a);
    if (!from) throw new StoreError(960, `No privilege set "${a}"`);
    const to = this.privilegeSet(b);
    if (!to) throw new StoreError(960, `No privilege set "${b}"`);
    // Normalize the name so the diff doesn't report a "rename" — the compare
    // already names both sets; we want only the access differences.
    return { a: from.name, b: to.name, changes: diffPrivilegeSet({ ...to, name: from.name }, from) };
  }

  private privilegeError<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof PrivilegeError) throw new StoreError(e.code, e.message, e.denial);
      throw e;
    }
  }

  /** The privileges to check in this file; undefined when nothing needs checking. */
  local(p?: Privileges): Privileges | undefined {
    if (!p) return undefined;
    const mine = p.in(this);
    return mine.full ? undefined : mine;
  }

  /** Checks layout access, for a request on one of this file's layouts. */
  private checkLayout(info: LayoutInfo, p: Privileges | undefined, write = false): void {
    if (info.home !== this) return;
    const pv = this.local(p);
    if (pv) this.privilegeError(() => {
      pv.checkLayout(info.name, write);
      // Viewing a layout's design does not grant access to its records. This
      // helper protects record operations; metadata uses checkLayout directly.
      if (pv.layout(info.name).records === 'none') throw new StoreError(200, 'Record access is denied through this layout');
    });
  }

  /** A view, edit or delete rule on one record; a "limited" calculation that fails denies. */
  private allows(table: Table, rule: Rule, row: Record<string, SqlValue>, account: string): boolean {
    return this.ruleOutcome(table, rule, row, account) === 'allowed';
  }

  private ruleOutcome(table: Table, rule: Rule, row: Record<string, SqlValue>, account: string): RuleOutcome {
    if (typeof rule === 'boolean') return rule ? 'allowed' : 'false';
    const to = this.schema.tableOccurrences.find((t) => t.baseTableId === table.id && !t.dataSourceId);
    if (!to) return 'evaluation-failure';
    try {
      return asBoolean(evaluateFormula(rule, this.calc.context({ store: this, table, row: row as Row }, to.id, this.calc.newPass(account)))) ? 'allowed' : 'false';
    } catch (e) {
      rethrowExecutionRefusal(e);
      return 'evaluation-failure';
    }
  }

  private checkRecordRule(table: Table, pv: Privileges, operation: AccessOperation, permission: 'view' | 'edit' | 'delete', row: Record<string, SqlValue>): void {
    const outcome = this.ruleOutcome(table, pv.table(table.name)[permission], row, pv.account);
    if (outcome !== 'allowed') throw new StoreError(200, 'Record access is denied', pv.recordDenial(table.name, operation, permission, outcome));
  }

  /**
   * Ids of the records a "limited" rule allows. Evaluating the rule per record
   * scans the whole table, so the result is memoised by table+account+rule and
   * reused until any write advances the file's write token — unless the rule is
   * volatile (clock/random based), when it is always recomputed. The cache only
   * removes repeated work; it never widens access, as a write that could change
   * which records match moves the token and forces a fresh scan.
   */
  /** Whether a formula names a global field of this file (by name; a false yes only costs a rescan). */
  private readsGlobalField(formula: string): boolean {
    const lower = formula.toLowerCase();
    return this.schema.tables.some((t) => t.fields.some((f) => f.options?.global && lower.includes(f.name.toLowerCase())));
  }

  private allowedIds(table: Table, rule: string, account: string): number[] {
    // A rule reading the session ($$variables, global fields) gives each session its own answer: never kept.
    const cacheable = !VOLATILE_RULE.test(rule) && !rule.includes('$') && !this.readsGlobalField(rule);
    const key = `${table.name}\u0000${account.toLowerCase()}\u0000${rule}`;
    const token = this.writeToken();
    if (cacheable) {
      const hit = this.allowedCache.value.get(key);
      if (hit && hit.token === token) {
        this.allowedCache.value.delete(key); // move to newest, so the oldest is dropped first
        this.allowedCache.value.set(key, hit);
        return hit.ids;
      }
    }
    this.allowedScans++;
    const out: number[] = [];
    for (const row of this.sql.prepare(`SELECT * FROM ${q(table.name)}`).iterate() as Iterable<Record<string, SqlValue>>) {
      checkMemory();
      if (this.allows(table, rule, row, account)) out.push(Number(row._fm_record_id));
    }
    if (cacheable) {
      this.allowedCache.value.set(key, { token, ids: out });
      if (this.allowedCache.value.size > ALLOWED_CACHE_MAX) this.allowedCache.value.delete(this.allowedCache.value.keys().next().value as string);
    }
    return out;
  }

  /** Whether these privileges limit which of the table's records the account may view (viewableIds is then a list). */
  limitsView(table: string, privileges?: Privileges): boolean {
    const rule = this.local(privileges)?.table(table).view ?? true;
    return rule !== true;
  }

  /** Ids of a table's records the privileges can view; undefined when they can view them all. */
  viewableIds(...args: Parameters<Store['viewableIdsCurrent']>): number[] | undefined {
    return this.withDesignRead(() => this.viewableIdsCurrent(...args));
  }

  private viewableIdsCurrent(table: string, privileges?: Privileges): number[] | undefined {
    const pv = this.local(privileges);
    const rule = pv?.table(table).view ?? true;
    if (rule === true) return undefined;
    if (rule === false) return [];
    // A copy: callers own their array, while allowedIds keeps the cached one.
    return this.allowedIds(this.schema.tables.find((t) => t.name === table)!, rule, pv!.account).slice();
  }

  /**
   * Whether these privileges have no access to a field's raw value ("none"
   * or "masked"). Full access, or no privileges, is never hidden. User-facing
   * calculations omit these values on their own record and related records.
   */
  fieldHidden(table: string, field: string, privileges?: Privileges): boolean {
    const pv = this.local(privileges);
    return !!pv && pv.field(table, field) === 'none';
  }

  /** Whether a field holds repetitions (stored as a JSON list). */
  isRepeating(table: string, field: string): boolean {
    return !!this.repeating[table]?.includes(field);
  }

  /** Whether these privileges see only a stand-in for a field (see Privileges.fieldAccess). */
  fieldMasked(table: string, field: string, privileges?: Privileges): boolean {
    const pv = this.local(privileges);
    return !!pv && pv.fieldAccess(table, field) === 'masked';
  }

  /**
   * Whether a summary field would give a hidden or masked field's value away (a total, average or list of it;
   * over one record that is the value). Counts already exclude hidden inputs in the summary collector.
   */
  summaryMasked(table: Table, def: Field, privileges?: Privileges): boolean {
    const of = def.summary && def.summary.type !== 'count' ? table.fields.find((x) => x.id === def.summary!.fieldId) : undefined;
    return !!of && this.fieldHidden(table.name, of.name, privileges);
  }

  /**
   * A base table as an account sees it, as SQL to read from in its place: only the records it can view, and
   * NULL for the fields it has no access to. undefined when it sees the whole table. ExecuteSQL in a script
   * that runs without full access reads through this, so SQL can't count or total past the privilege set.
   */
  scopedTableSql(table: string, privileges?: Privileges): string | undefined {
    const pv = this.local(privileges);
    const t = this.schema.tables.find((x) => x.name === table);
    if (!pv || !t) return undefined;
    const ids = this.viewableIds(table, pv);
    const hidden = new Set(t.fields.filter((f) => pv.field(table, f.name) === 'none').map((f) => f.name));
    if (!ids && !hidden.size) return undefined;
    const columns = (this.sql.prepare(`PRAGMA table_info(${q(table)})`).all() as { name: string }[]).map((c) => c.name);
    const list = columns.map((c) => (hidden.has(c.replace(/\(\d+\)$/, '')) ? `NULL AS ${q(c)}` : q(c))).join(', ');
    const where = ids ? `_fm_record_id IN (SELECT value FROM json_each('${JSON.stringify(ids)}'))` : '1';
    return `SELECT ${list} FROM ${q(table)} WHERE ${where}`;
  }

  /**
   * Try out a record-level access rule before saving it into a privilege set:
   * evaluate a "limited" view/edit/delete calculation against a table's records,
   * as a chosen account would (so `Get ( AccountName )` and the like resolve),
   * and report which sample records it would allow and how many of the whole
   * table match. Nothing is stored. A rule that won't compile comes back with
   * `valid: false` and the error, rather than silently denying everything (as
   * enforcement does). This is what turns a plain-English description — drafted
   * into a formula by the assistant, or typed by hand — into something an
   * administrator can see the effect of before committing to it.
   */
  previewRecordRule(...args: Parameters<Store['previewRecordRuleCurrent']>): ReturnType<Store['previewRecordRuleCurrent']> {
    return this.withDesignRead(() => this.previewRecordRuleCurrent(...args));
  }

  private previewRecordRuleCurrent(table: string, rule: string, opts: { account?: string; limit?: number } = {}): {
    table: string; rule: string; account: string; valid: boolean; error?: string;
    total: number; allowed?: number;
    samples: { recordId: number; allowed?: boolean; error?: string; label?: string }[];
  } {
    const t = this.schema.tables.find((tb) => tb.name === table);
    if (!t) throw new StoreError(106, `No table "${table}"`);
    const to = this.schema.tableOccurrences.find((o) => o.baseTableId === t.id && !o.dataSourceId);
    if (!to) throw new StoreError(100, `No table occurrence for "${table}"`);
    const account = opts.account ?? '';
    const limit = Math.max(1, Math.min(Math.trunc(opts.limit ?? 10) || 10, 200));
    const total = Number((this.sql.prepare(`SELECT COUNT(*) AS n FROM ${q(t.name)}`).get() as { n: number }).n);
    // A short, labelled title for each sample row, so the admin recognises it.
    const titleField = t.fields.find((f) => /name|title|label/i.test(f.name))?.name;
    const rows = this.sql.prepare(`SELECT * FROM ${q(t.name)} LIMIT ?`).all(limit) as Record<string, SqlValue>[];
    const samples: { recordId: number; allowed?: boolean; error?: string; label?: string }[] = rows.map((row) => {
      const recordId = Number(row._fm_record_id);
      const label = titleField && row[titleField] != null ? String(row[titleField]).slice(0, 80) : undefined;
      try {
        // Enforcement treats an errored row as denied, so the preview shows the same.
        const allowed = asBoolean(evaluateFormula(rule, this.calc.context({ store: this, table: t, row: row as Row }, to.id, this.calc.newPass(account))));
        return { recordId, allowed, ...(label ? { label } : {}) };
      } catch (e) {
        rethrowExecutionRefusal(e);
        return { recordId, allowed: false, error: (e as Error).message.slice(0, 300), ...(label ? { label } : {}) };
      }
    });
    // "Valid" means the formula compiles. A per-row runtime error just denies
    // that row (as enforcement does); only every sampled row failing — or, for
    // an empty table, the compile-check on an empty row — marks the rule broken.
    let valid = true;
    let error: string | undefined;
    if (samples.length > 0) {
      if (samples.every((s) => s.error !== undefined)) { valid = false; error = samples[0].error; }
    } else {
      try {
        evaluateFormula(rule, this.calc.context({ store: this, table: t, row: {} as Row }, to.id, this.calc.newPass(account)));
      } catch (e) {
        rethrowExecutionRefusal(e);
        valid = false; error = (e as Error).message.slice(0, 300);
      }
    }
    return {
      table: t.name, rule, account, valid, ...(error ? { error } : {}),
      total,
      ...(valid ? { allowed: this.allowedIds(t, rule, account).length } : {}),
      samples,
    };
  }

  /** SQL restricting a query to the records the privileges can view. */
  private viewFilter(info: LayoutInfo, pv: Privileges | undefined): { where: string; params: SqlValue[] } {
    if (!pv) return { where: '1', params: [] };
    const rule = pv.table(info.table).view;
    if (rule === true) return { where: '1', params: [] };
    if (rule === false) throw new StoreError(200, `Record access is denied: no access to ${info.table} records`, pv.recordDenial(info.table, 'view', 'view'));
    return { where: '_fm_record_id IN (SELECT value FROM json_each(?))', params: [JSON.stringify(this.allowedIds(this.table(info), rule, pv.account))] };
  }

  /** Fields a find or sort names must be visible. */
  private checkFieldsVisible(info: LayoutInfo, pv: Privileges | undefined, names: Iterable<string>): void {
    if (!pv) return;
    for (const n of names) {
      if (n !== 'omit' && pv.field(info.table, n.replace(/\(\d+\)$/, '')) === 'none') throw new StoreError(102, `Field "${n}" is missing`);
    }
  }

  /** Resolve every target before tagged write checks; concealment must not depend on payload order. */
  private checkWriteFields(info: LayoutInfo, privileges: Privileges | undefined, fields: Iterable<string>): void {
    if (!privileges) return;
    for (const name of fields) {
      const ref = /^(.+?)::(.+)$/.exec(name);
      const target = ref && info.home && ref[1] !== info.occurrence
        ? info.home.occurrence(ref[1]) : info;
      const pv = target.owner.local(privileges);
      if (!pv) continue;
      const field = ref ? ref[2] : name;
      if (!target.owner.table(target).fields.some((f) => f.name === field) || pv.field(target.table, field) === 'none') {
        throw new StoreError(201, `Field "${field}" cannot be modified`);
      }
    }
  }

  /** Checks a write of `fields` to a record (current row; none when creating). */
  private checkWrite(info: LayoutInfo, pv: Privileges | undefined, fields: Iterable<string>, current?: Record<string, SqlValue>): void {
    if (!pv) return;
    const names = [...fields];
    this.checkWriteFields(info, pv, names);
    const table = this.table(info);
    const t = pv.table(info.table);
    let ownFields = false;
    for (const name of names) {
      const def = table.fields.find((f) => f.name === name);
      const level = pv.field(info.table, name);
      // Global fields can be set by anyone who can see them, as in FileMaker's [Read-Only Access].
      if (def?.options?.global) {
        if (level === 'none') throw new StoreError(201, `Field "${name}" cannot be modified`);
        continue;
      }
      if (level !== 'modifiable') throw new StoreError(201, `Field "${name}" cannot be modified`,
        level === 'none' ? undefined : pv.fieldDenial(info.table, name, current ? 'edit' : 'create'));
      ownFields = true;
    }
    if (!current) {
      if (!t.create) throw new StoreError(200, 'Record access is denied: cannot create records', pv.recordDenial(info.table, 'create', 'create'));
    } else if (ownFields || !names.length) {
      this.checkRecordRule(table, pv, 'edit', 'view', current);
      this.checkRecordRule(table, pv, 'edit', 'edit', current);
    }
  }

  /**
   * The mask a field really shows through: only text and number fields can show their last characters; a
   * date, time, container or other field shows the placeholder, so a mask never reveals part of a value it can't
   * hide evenly (a container's address, a date's year).
   */
  maskFor(def: { type: string } | undefined, mask: FieldMask): FieldMask {
    return mask.kind === 'last4' && def?.type !== 'text' && def?.type !== 'number' ? { kind: 'placeholder', ...(mask.text ? { text: mask.text } : {}) } : mask;
  }

  /** Blanks what the privileges can't see in a record: fields with no access, related records they can't view. */
  private redact(info: LayoutInfo, rec: StoredRecord, p: Privileges | undefined): StoredRecord {
    if (!p) return rec;
    const pv = this.local(p);
    if (pv) {
      for (const key of Object.keys(rec.fieldData)) {
        if (key.includes('::')) continue;
        const name = key.replace(/\(\d+\)$/, '');
        if (pv.field(info.table, name) !== 'none') continue;
        const mask = pv.mask(info.table, name);
        if (mask) rec.fieldData[key] = maskValue(rec.fieldData[key], this.maskFor(this.table(info).fields.find((f) => f.name === name), mask));
        else delete rec.fieldData[key];
      }
    }
    return rec;
  }

  /** Account names are case-insensitive in FileMaker. */
  /**
   * Checks an account's password. `from` names where the attempt comes from
   * (a client address): after LOCKOUT.attempts wrong passwords from one place
   * within LOCKOUT.windowMs, that place can't sign in to the account for
   * LOCKOUT.lockMs, even with the right password. Other places still can, so
   * someone guessing can't lock the real user out.
   */
  verify(account: string, password: string, from = ''): boolean {
    const hash = this.passwordHash(account, from);
    // An unknown name takes as long as a wrong password, so timing doesn't tell which names exist.
    if (this.spendsScrypt(hash, account, from)) checkPassword(password, DUMMY_HASH);
    return this.signedIn(account, from, hash !== undefined && checkPassword(password, hash));
  }

  /** verify on the thread pool; an optional directory check shares the attempt's single outcome. */
  async verifyAsync(account: string, password: string, from = '', fallback?: () => Promise<boolean>, checkAlive: () => void = () => {}): Promise<boolean> {
    const hash = this.passwordHash(account, from);
    if (this.spendsScrypt(hash, account, from)) await checkPasswordAsync(password, DUMMY_HASH);
    let valid = hash !== undefined && await checkPasswordAsync(password, hash) && !this.accountInactive(account);
    if (!valid && fallback && !this.lockedOut(account, from)) {
      const key = this.bucketKey(account, from);
      // Overlapping guesses still count as failures, but cannot multiply LDAP work.
      // A late success cannot clear a lock issued by those overlapping failures.
      checkAlive();
      if (!this.directoryChecks.has(key)) {
        this.directoryChecks.add(key);
        try {
          checkAlive();
          valid = await fallback();
          checkAlive();
        } catch (error) { this.signedIn(account, from, false); throw error; }
        finally { this.directoryChecks.delete(key); }
      }
    }
    // Recheck admission after either asynchronous check: another request may have locked the account.
    return this.signedIn(account, from, valid);
  }

  /**
   * Whether a refusal needs a throwaway scrypt check to take as long as a wrong password: for a name with no usable
   * hash, and for an imported account on the file's own password (FileMaker's cheap hash). Not for a place that is
   * locked out, which is answered at once whether or not the name exists, so a lockout stays cheap.
   */
  private spendsScrypt(hash: string | undefined, account: string, from: string): boolean {
    return (hash === undefined || hash.startsWith('fmp12$')) && !this.lockedOut(account, from);
  }

  /** The account's password hash; undefined when it has none or the place is locked out. */
  private passwordHash(account: string, from: string): string | undefined {
    if (this.lockedOut(account, from)) return undefined;
    const row = this.sql.prepare('SELECT password_hash, source, inactive, password_disabled FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as
      | { password_hash: string | null; source: string; inactive: number; password_disabled: number } | undefined;
    if (row?.inactive || row?.password_disabled) return undefined;
    if (row?.password_hash) return row.password_hash;
    // No password set in Tabularius: the one the file has, as FileMaker checks it.
    if (row?.source !== 'fmp12') return undefined;
    const verifier = this.schema.accounts.find((a) => !a.external && a.name.toLowerCase() === account.toLowerCase())?.passwordVerifier;
    if (!verifier) return undefined;
    // An empty password lets anyone in, so from other computers only when the server allows it.
    if (checkFmp12Password('', verifier) && !LOCAL.has(from) && !PASSWORD_POLICY.blankFromNetwork && !(this.allowBlankPasswordFromLan() && privateAddress(from))) return undefined;
    return `fmp12$${verifier}`;
  }

  /**
   * This file's own opt-in: an account left with an empty password (FileMaker's
   * default Admin, or any imported account whose non-blank FileMaker password
   * couldn't carry over — see checkFmp12Password) may sign in from this LAN,
   * not only from this computer. Off by default; the server-wide
   * `--allow-blank-passwords` flag (PASSWORD_POLICY.blankFromNetwork) still
   * allows it from anywhere and takes priority when set. Meant as a stopgap
   * until every such account is given a real password.
   */
  allowBlankPasswordFromLan(): boolean {
    return this.meta('allowBlankPasswordFromLan') === true;
  }

  /** Turns the LAN opt-in above on or off for this file. */
  setAllowBlankPasswordFromLan(on: boolean): void {
    return this.securityChange(() => {
      this.sql.prepare(`INSERT INTO _fm_meta VALUES ('allowBlankPasswordFromLan', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(on));
      this.logSecurity(on ? 'blank-password-lan-allowed' : 'blank-password-lan-disallowed', {});
    });
  }

  /** The lockout bucket for an account from a place. The name is attacker-chosen, so it is cut short and kept free of the separator. */
  private bucketKey(account: string, from: string): string {
    return this.failures.accountKey(account, from);
  }

  /** Anonymous real-account counters are bounded by provisioned identities, not caller-supplied names. */
  private knownSharedAccount(account: string, from: string): boolean {
    return NO_ADDRESS_BUDGET.has(from) && !LOCAL.has(from)
      && this.sql.prepare('SELECT 1 FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) !== undefined;
  }

  /** Records a sign-in attempt's outcome for lockouts; returns `ok`. */
  private signedIn(account: string, from: string, ok: boolean): boolean {
    return this.failures.record(this.bucketKey(account, from), from, ok, this.knownSharedAccount(account, from));
  }

  /** Called only after a successful directory sign-in; never persisted to the file. */
  confirmDirectorySignIn(account: string): void {
    this.failures.confirmDirectory(this.bucketKey(account, 'unknown'));
  }

  /** When a bucket is blocked until (epoch ms), if it is. */
  private blocked(key: string): number | undefined {
    return this.failures.blocked(key);
  }

  /** When sign-ins to an account from a place are blocked until (epoch ms), if they are. */
  lockedOut(account: string, from = ''): number | undefined {
    return this.failures.lockedOut(this.bucketKey(account, from), from, this.knownSharedAccount(account, from));
  }

  /** When an address is blocked from signing in to anything (epoch ms), if it is. */
  addressLockedOut(from: string): number | undefined {
    return this.failures.addressLockedOut(from);
  }

  /** Counts a failed sign-in with no account (such as an invalid passkey) against the address. */
  countAddressFailure(from: string): void {
    this.failures.countAddressFailure(from);
  }

  /** Resets an address's failures; true only when an active block was lifted. */
  unlockAddress(from: string): boolean {
    const key = `\u0000address\u0000${addressBucket(from)}`;
    const until = this.failures.get(key)?.until;
    const cleared = until !== undefined && until > performance.now();
    this.failures.delete(key);
    return cleared;
  }

  /** Resets an account's failures (all places and factors); true only when an active block was lifted. */
  unlock(account: string): boolean {
    if (!account) return false; // an empty name would match the address buckets
    const prefix = `${this.bucketKey(account, '')}`;
    if (prefix.startsWith('\u0000')) return false; // nor may a name that folds to nothing
    let cleared = false;
    for (const k of this.failures.keys()) if (k.startsWith(prefix)) {
      cleared = this.blocked(k) !== undefined || cleared;
      this.failures.delete(k);
    }
    return cleared;
  }

  // --- layouts ------------------------------------------------------------

  layouts(): { name: string; table: string | null; file?: string }[] {
    const rows = this.sql.prepare('SELECT name, table_name, file, file_table_id FROM _fm_layouts ORDER BY layout_id').all() as
      { name: string; table_name: string | null; file: string | null; file_table_id: number | null }[];
    return rows.map((r) => r.file
      ? { name: r.name, table: this.resolvedFile(r.file)?.schema.tables.find((t) => t.id === r.file_table_id)?.name ?? null, file: r.file }
      : { name: r.name, table: r.table_name });
  }

  /** Layout designs (parts, objects, styles) and themes, as imported. */
  designs(): LayoutDesigns {
    this.refreshDesign();
    return (this.designCache.value ??= this.meta('designs') ?? { layouts: [], themes: [] });
  }

  design(layout: string | number): LayoutDesign | undefined {
    const id = typeof layout === 'number' ? layout : this.schema.layouts.find((l) => l.name === layout)?.id;
    return this.designs().layouts.find((l) => l.id === id);
  }

  /** An image from the file's image library (graphics and button icons on layouts). */
  image(id: number): { filename: string | null; mime: string; data: Uint8Array } | undefined {
    try {
      return this.sql.prepare('SELECT filename, mime, data FROM _fm_images WHERE id = ?').get(id) as
        { filename: string | null; mime: string; data: Uint8Array } | undefined;
    } catch {
      return undefined; // stores imported before images were kept
    }
  }

  /** The image library, without the images: for picking a button icon or a picture. */
  images(): { id: number; filename: string | null; mime: string; bytes: number }[] {
    try {
      return this.sql.prepare('SELECT id, filename, mime, length(data) AS bytes FROM _fm_images ORDER BY id').all() as
        { id: number; filename: string | null; mime: string; bytes: number }[];
    } catch {
      return [];
    }
  }

  /** Adds an image (PNG, JPEG, GIF, WebP or SVG) to the library, for icons and pictures on layouts; returns its id. */
  addImage(filename: string | null, mime: string, data: Uint8Array, opts: WriteOptions = {}): number {
    return this.securityChange(() => {
      if (!IMAGE_TYPES.has(mime)) throw new StoreError(960, `Images must be PNG, JPEG, GIF, WebP or SVG, not ${mime || 'an unknown type'}`);
      if (!data.length) throw new StoreError(960, 'The image is empty');
      if (mime === 'image/svg+xml' && !/<svg[\s>]/i.test(new TextDecoder().decode(data.subarray(0, 4096)))) throw new StoreError(960, 'That isn\'t an SVG image');
      this.sql.exec('CREATE TABLE IF NOT EXISTS _fm_images (id INTEGER PRIMARY KEY, filename TEXT, mime TEXT NOT NULL, data BLOB NOT NULL)');
      const id = Number(this.sql.prepare('INSERT INTO _fm_images (filename, mime, data) VALUES (?, ?, ?)').run(filename, mime, data).lastInsertRowid);
      this.logSecurity('schema-changed', { account: opts.account ?? null, detail: { ops: { addImage: 1 }, count: 1 } });
      return id;
    });
  }

  layout(name: string): LayoutInfo {
    writer.getStore()?.beforeFile?.(this);
    this.refreshDesign();
    let cached = this.layoutCache.value.get(name);
    if (cached && cached.owner !== this) writer.getStore()?.beforeFile?.(cached.owner);
    if (cached && cached.owner !== this && this.layoutSchemas.get(cached) !== cached.owner.schema) {
      this.layoutCache.value.delete(name);
      cached = undefined;
    }
    if (cached) return cached;
    const row = this.sql.prepare('SELECT layout_id, table_name, occurrence, file, file_table_id FROM _fm_layouts WHERE name = ?').get(name) as
      | { layout_id: number; table_name: string | null; occurrence: string; file: string | null; file_table_id: number | null } | undefined;
    if (!row) throw new StoreError(105, `Layout "${name}" is missing`);
    let owner: Store = this;
    let table = this.schema.tables.find((t) => t.name === row.table_name);
    if (row.file) {
      // The table lives in another file of the solution; it must be hosted alongside.
      const other = this.resolvedFile(row.file);
      if (!other) throw new StoreError(100, `Layout "${name}" uses a table in "${row.file}", which is not hosted`);
      owner = other;
      table = other.schema.tables.find((t) => t.id === row.file_table_id);
    }
    if (!table) throw new StoreError(105, `Layout "${name}" has no table`);
    const info: LayoutInfo = {
      name,
      table: table.name,
      occurrence: row.occurrence,
      fields: table.fields.map((f) => ({
        name: f.name, type: f.type, indexLanguage: f.options?.indexLanguage, calculated: f.kind !== 'normal',
        ...(f.kind === 'summary' ? { summary: true } : {}),
        ...((f.options?.repetitions ?? 1) > 1 ? { repetitions: f.options!.repetitions } : {}),
      })),
      owner,
      home: this,
      layoutId: Number(row.layout_id),
    };
    const plan = this.plan(info);
    if (plan) info.plan = plan;
    const uses = this.layoutUses(info, table);
    if (uses) info.uses = uses;
    this.layoutSchemas.set(info, owner.currentSchema);
    this.layoutCache.value.set(name, info);
    return info;
  }

  /**
   * The table's fields a layout uses: fields of its own occurrence placed on
   * it, in its table view columns (Tabularius's web client shows them) or
   * referenced (portal sorts, part break fields), and any whose name
   * appears in its text (formulas, merge fields, tooltips, button
   * parameters). Generous on purpose: a field named in passing costs only
   * its own value. Undefined when the design is missing or empty.
   */
  private layoutUses(info: LayoutInfo, table: Table): Set<string> | undefined {
    const design = info.layoutId !== undefined ? this.design(info.layoutId) : undefined;
    const to = occurrenceByName(this, info.occurrence);
    if (!design || !to || !design.objects?.length) return undefined;
    const byLower = new Map(table.fields.map((f) => [f.name.toLowerCase(), f.name]));
    const byId = new Map(table.fields.map((f) => [f.id, f.name]));
    const uses = new Set<string>();
    const word = /[\p{L}\p{N}_]/u;
    const text = (v: string) => {
      const lower = (v.length > 20_000 ? v.slice(0, 20_000) : v).toLowerCase();
      for (const name of byLower.keys()) {
        if (uses.has(name)) continue;
        // As a whole name: "Id" isn't used by text that says "Paid".
        for (let i = lower.indexOf(name); i >= 0; i = lower.indexOf(name, i + 1)) {
          if (!word.test(lower[i - 1] ?? ' ') && !word.test(lower[i + name.length] ?? ' ')) { uses.add(name); break; }
        }
      }
    };
    // A text object's words show as they are: only its merge fields (<<Field>>) use a field.
    const merged = (v: string) => text((v.match(/<<[^<>]*>>/g) ?? []).join(' '));
    const walk = (v: unknown, key = '') => {
      if (typeof v === 'string') return key === 'text' ? merged(v) : text(v);
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach((x) => walk(x));
      const o = v as Record<string, unknown>;
      if (o.tableOccurrenceId === to.id && typeof o.fieldId === 'number') {
        const name = byId.get(o.fieldId) ?? (typeof o.field === 'string' ? o.field : undefined);
        if (name) uses.add(name.toLowerCase());
      }
      for (const [k, x] of Object.entries(o)) walk(x, k);
    };
    walk(design);
    return uses;
  }

  /** Records of an occurrence, addressed like a layout (for related records). */
  occurrenceInfo(occ: Occurrence): LayoutInfo {
    return {
      name: occ.to.name, table: occ.table.name, occurrence: occ.to.name, owner: occ.store, home: this,
      fields: occ.table.fields.filter((f) => f.kind !== 'summary').map((f) => ({ name: f.name, type: f.type, indexLanguage: f.options?.indexLanguage, calculated: f.kind === 'calculation', ...((f.options?.repetitions ?? 1) > 1 ? { repetitions: f.options!.repetitions } : {}) })),
    };
  }

  private plan(info: LayoutInfo): LayoutPlan | undefined {
    const design = info.layoutId !== undefined ? this.design(info.layoutId) : undefined;
    const to = occurrenceByName(this, info.occurrence);
    if (!design || !to) return undefined;
    const plan: LayoutPlan = { occurrenceId: to.id, portals: [], related: [] };
    const name = (toId: number, fieldId: number, field?: string) => field ?? occurrence(this, toId)?.table.fields.find((f) => f.id === fieldId)?.name;
    const add = (list: { occurrenceId: number; fields: string[] }[], toId: number, field: string) => {
      const entry = list.find((x) => x.occurrenceId === toId);
      if (entry && !entry.fields.includes(field)) entry.fields.push(field);
    };
    const walk = (objs: LayoutObject[], portal?: LayoutPlan['portals'][number]) => {
      for (const o of objs) {
        if (o.portal && !portal) {
          const occ = this.schema.tableOccurrences.find((t) => t.id === o.portal!.tableOccurrenceId);
          if (occ) {
            // Sort fields from other occurrences (related to the portal's) are named TO::Field;
            // a custom order lists its value list's values.
            const sort = o.portal.sort?.flatMap((s) => {
              const field = name(s.field.tableOccurrenceId, s.field.fieldId, s.field.field);
              if (!field) return [];
              const other = s.field.tableOccurrenceId !== occ.id && occurrence(this, s.field.tableOccurrenceId)?.to.name;
              const order = s.valueListId !== undefined ? this.schema.valueLists.find((v) => v.id === s.valueListId)?.values : undefined;
              return [{ field: other ? `${other}::${field}` : field, descending: s.descending, ...(order ? { order } : {}) }];
            });
            // Fields of other files' tables are named once those files are open.
            const filter = o.portal.filter?.trim() && externalFieldNames(o.portal.filter, (toId, fieldId) => {
              const x = occurrence(this, toId);
              const n = x?.table.fields.find((f) => f.id === fieldId)?.name;
              return x && n ? `${x.to.name}::${n}` : undefined;
            });
            const p: LayoutPlan['portals'][number] = { name: o.name ?? occ.name, occurrenceId: occ.id, occurrence: occ.name, fields: [], ...(sort?.length ? { sort } : {}), ...(filter ? { filter } : {}), ...(o.portal.rows ? { rows: o.portal.rows } : {}) };
            if (!plan.portals.some((x) => x.name === p.name)) plan.portals.push(p);
            walk(o.children ?? [], plan.portals.find((x) => x.name === p.name));
          }
          continue;
        }
        const f = o.field;
        if (f && f.tableOccurrenceId !== to.id) {
          const occName = this.schema.tableOccurrences.find((t) => t.id === f.tableOccurrenceId)?.name;
          const field = name(f.tableOccurrenceId, f.fieldId, f.field);
          if (occName && field) {
            if (portal && f.tableOccurrenceId === portal.occurrenceId) add([portal], f.tableOccurrenceId, field);
            else if (portal) {
              const related = (portal.related ??= []);
              if (!related.some((r) => r.occurrenceId === f.tableOccurrenceId)) related.push({ occurrenceId: f.tableOccurrenceId, occurrence: occName, fields: [] });
              add(related, f.tableOccurrenceId, field);
            } else {
              if (!plan.related.some((r) => r.occurrenceId === f.tableOccurrenceId)) {
                plan.related.push({ occurrenceId: f.tableOccurrenceId, occurrence: occName, fields: [] });
              }
              add(plan.related, f.tableOccurrenceId, field);
            }
          }
        }
        if (o.children) walk(o.children, portal);
      }
    };
    walk(design.objects);
    return plan;
  }

  // --- values -------------------------------------------------------------

  /** Native writes and pending proposals share the same ISO validation and message. */
  private validateNativeDate(key: string, value: SqlValue, type: FieldType): void {
    if (this.fileMode === 'native' && typeof value === 'string' && (type === 'date' ? parseDate(value, 'ISO') !== value : type === 'timestamp' && parseTimestamp(value, 'ISO') !== value)) {
      throw new StoreError(500, `Field "${key}" must be an ISO 8601 ${type === 'date' ? 'date (YYYY-MM-DD)' : 'timestamp (YYYY-MM-DDTHH:MM:SS)'}, not ${value.length > 40 ? `${value.slice(0, 40)}...` : value}`);
    }
  }

  /** User-entered value -> stored form (ISO dates, numbers). */
  readonly normalize = (value: string, type: FieldType, order: DateStyle = this.dateOrder): SqlValue => {
    const v = value.trim();
    if (v === '') return null;
    switch (type) {
      case 'boolean': case 'integer': case 'decimal': case 'json': case 'uuid':
        if (this.fileMode !== 'native') return value;
        try { return nativeValue(v, type) ?? value; }
        catch (e) { throw new StoreError(500, (e as Error).message); }
      case 'number': {
        const n = Number(v.replace(/,/g, ''));
        return Number.isFinite(n) ? n : v;
      }
      // Native files read ISO 8601 only, whatever order a caller passes.
      case 'date': return this.fileMode === 'native' ? parseDate(v, 'ISO') ?? v : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : parseDate(v, order) ?? v;
      case 'time': return parseTime(v) ?? v;
      case 'timestamp': return this.fileMode === 'native' ? parseTimestamp(v, 'ISO') ?? v : /^\d{4}-\d{2}-\d{2}T/.test(v) ? v : parseTimestamp(v, order) ?? v;
    }
    return value;
  };

  present(v: SqlValue, type: FieldType, fmt: DateFormat, principal?: string): string | number {
    if (v === null || v === undefined) return '';
    if (type === 'container') return this.containerUrl(Number(v), this.containerMeta(Number(v))?.filename ?? null, principal);
    if (this.fileMode === 'native' && type === 'boolean') return Number(v) === 0 ? 0 : 1;
    if (this.fileMode === 'native' && type === 'integer') return Number(v);
    if (this.fileMode === 'native' && (type === 'decimal' || type === 'json' || type === 'uuid')) return String(v);
    if (typeof v !== 'string' || fmt === 'iso' || this.fileMode === 'native') return v;
    if (type === 'date') return toUsDate(v);
    if (type === 'timestamp') {
      const m = /^(\d{4}-\d{2}-\d{2})T(.+)$/.exec(v);
      return m ? `${toUsDate(m[1])} ${m[2]}` : v;
    }
    return v;
  }

  /**
   * The word index for a layout's table, built when a find first needs it.
   * Used only when under a tenth of the records match: for words many records
   * have, reading the table is faster than looking up every match.
   */
  private wordIndex(info: LayoutInfo): WordIndex {
    let fields: Set<string> | undefined;
    return (field, match) => {
      if (!this.words.enabled) return undefined;
      const table = this.table(info);
      try {
        // Waiting only briefly for the file: a build may hold it for seconds, and this thread serves everyone.
        this.sql.exec('PRAGMA busy_timeout = 100');
        fields ??= this.words.ensure(table);
      } catch (e) {
        // Another process is building it: this find (every criterion of it) reads every record instead.
        if ((((e as { errcode?: number }).errcode ?? 0) & 0xff) !== 5) throw e;
        fields = new Set();
        return undefined;
      } finally {
        this.sql.exec('PRAGMA busy_timeout = 5000');
      }
      if (!fields.has(field)) return undefined;
      const fts = q(wordIndexName(table));
      const cap = Math.max(100, Math.floor(this.recordCount(table.name) / 10));
      const probe = this.words.retry(() => this.sql.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM ${fts} WHERE ${q(field)} MATCH ? LIMIT ${cap})`).get(match)) as { n: number };
      return probe.n < cap ? fts : undefined;
    };
  }

  private layoutInfo(layout: string | LayoutInfo): LayoutInfo {
    if (typeof layout === 'string') return this.layout(layout);
    if (layout.home?.layoutSchemas.has(layout)) return layout.home.layout(layout.name);
    // Synthetic layouts still need the owner's current design.
    this.refreshDesign();
    return layout;
  }

  private table(info: LayoutInfo): Table {
    // The public read/write already checked its layout. Do not repeat the version
    // query for every record, summary and redaction within that same operation.
    const t = this.currentSchema.tables.find((x) => x.name === info.table);
    if (!t) throw new StoreError(106, `Table "${info.table}" is missing`);
    return t;
  }

  private toRecord(info: LayoutInfo, row: Record<string, SqlValue>, fmt: DateFormat, portals?: PortalPaging, summaries?: Summaries, p?: Privileges, only?: string[], layoutOnly = false, fresh = false,
    found?: { foundSet: NonNullable<Pass['foundSet']>; sums: NonNullable<Pass['sums']>; sort?: SortSpec[] }, edited?: EditedRecord): StoredRecord {
    const reps = new Set(this.repeating[info.table] ?? []);
    const fieldData: FieldData = {};
    const table = this.table(info);
    const defs = new Map(table.fields.map((f) => [f.name, f]));
    // The read's privileges travel with the pass, so an unstored calculation
    // computes what the account may see (related records/fields it can't view
    // are left out) rather than the full value. Shown to a person: a summary or
    // ExecuteSQL result from just before the latest change may stand in while
    // the background warmer works it out again.
    const pass: Pass = { ...this.calc.newPass(edited?.account ?? p?.account, p), display: !fresh && !edited, ...found, edited };
    const updating: string[] = [];
    let styles: Record<string, StyleRun[]> | undefined;
    const traced = tracing();
    const t0 = traced ? performance.now() : 0;
    const ran0 = statements;
    const wanted = only && new Set(only.map((x) => x.toLowerCase()));
    const uses = !wanted && layoutOnly ? info.uses : undefined;
    for (const f of info.fields) {
      if (wanted && !wanted.has(f.name.toLowerCase())) continue;
      if (uses && !uses.has(f.name.toLowerCase())) continue;
      const def = defs.get(f.name);
      let raw = row[f.name];
      // Globals hold one value per file; unstored calculations are computed now.
      if (def?.kind === 'summary') {
        raw = this.summaryMasked(table, def, p) ? null : summaries?.get(f.name) ?? null;
        if (def.summary?.running) raw = this.summaryMasked(table, def, p) ? null : summaries?.running?.get(f.name)?.get(Number(row._fm_record_id)) ?? null;
        if (def.summary?.type === 'fractionOfTotal' && raw === null && !this.summaryMasked(table, def, p)) {
          const denominator = summaries?.get(def.id);
          const source = table.fields.find((field) => field.id === def.summary!.fieldId);
          const own = source && asNumberOrEmpty(this.calc.value({ store: this, table, row: row as Row }, source, 1, pass));
          raw = typeof denominator === 'number' && denominator !== 0 && own !== undefined ? own / denominator : null;
        }
        if (summaries?.updating?.has(f.name)) updating.push(f.name);
      } else if (def?.options?.global) raw = this.calc.globalValue(table, def) as SqlValue;
      else if (def?.kind === 'calculation' && (def.options?.unstored || edited?.fields.has(def))) {
        const was = pass.stale ?? 0;
        const t0 = traced ? performance.now() : 0;
        const ran = statements;
        const got = this.calc.unstoredStyled({ store: this, table, row: row as Row }, def, pass);
        raw = got.value as SqlValue;
        if (got.runs) (styles ??= {})[f.name] = got.runs;
        if ((pass.stale ?? 0) > was) updating.push(f.name);
        if (traced) traceField(performance.now() - t0, `calc t${table.id}.f${def.id} ${formulaShape(def.calculation ?? '', this.schema.customFunctions.map((c) => c.name))}${this.calc.stable(table, def) ? ' stable' : ''}${(pass.stale ?? 0) > was ? ' stale' : ''}`, statements - ran);
      }
      if ((reps.has(f.name) || (def?.options?.repetitions ?? 1) > 1) && typeof raw === 'string' && raw.startsWith('[')) {
        const values = JSON.parse(raw) as SqlValue[];
        values.forEach((v, i) => (fieldData[i === 0 ? f.name : `${f.name}(${i + 1})`] = this.present(v, f.type, fmt, p?.linkPrincipal)));
      } else {
        fieldData[f.name] = this.present(raw, def?.kind === 'summary' ? summaryType(table, def) : f.type, fmt, p?.linkPrincipal);
      }
    }
    const rec: StoredRecord = { recordId: Number(row._fm_record_id), modId: Number(row._fm_mod_id), fieldData };
    const t1 = traced ? performance.now() : 0;
    const ran1 = statements;
    if (info.plan && info.home && !only) info.home.addRelated(info.plan, row, rec, fmt, portals, p);
    // The whole record, so many quick fields that add up are seen too.
    if (traced) traceField(performance.now() - t0, `record t${table.id}: fields ${(t1 - t0).toFixed(1)} ms ${ran1 - ran0} statements, related and portals ${(performance.now() - t1).toFixed(1)} ms ${statements - ran1} statements`, statements - ran0);
    this.redact(info, rec, p);
    const shown = updating.filter((n) => n in fieldData);
    if (shown.length) rec.updating = shown;
    const kept = this.textStyles.read(table.id, Number(row._fm_record_id), (id, r) => {
      const def = table.fields.find((x) => x.id === id);
      return def && this.keepsFormatting(def) ? this.keptText(def, row[def.name], r) : undefined;
    });
    for (const k of kept ?? []) (styles ??= {})[repKey(table.fields.find((x) => x.id === k.field)!.name, k.rep)] = k.runs;
    // Formatting runs index the real text, so a masked field keeps none, in any repetition ("Secret(2)" is Secret's).
    const pv = this.local(p);
    const masked = (n: string) => !!pv && (pv.fieldAccess(info.table, n) === 'masked' || pv.fieldAccess(info.table, splitRep(n).name) === 'masked');
    const styled = styles && Object.entries(styles).filter(([n]) => n in rec.fieldData && !masked(n));
    if (styled?.length) rec.styles = { ...rec.styles, ...Object.fromEntries(styled) };
    return rec;
  }

  /** Values of `fields` (of occurrence `occ`) in a related row, keyed "TO::Field". */
  private relatedValues(occ: Occurrence, row: Record<string, SqlValue>, fields: string[], fmt: DateFormat, p?: Privileges, stamps?: Map<Store, string>): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    // Unstored calculations in a related/portal field see only what the account may.
    const pass = occ.store.calc.newPass(p?.account, p);
    // The files' data versions, read once for the whole record (an ExecuteSQL in a portal row asks on every row).
    if (stamps) pass.stamps = stamps;
    for (const name of fields) {
      const f = occ.table.fields.find((x) => x.name === name);
      if (!f) continue;
      // Like the record's own fields: globals hold one value per file, unstored calculations are computed now.
      const t0 = performance.now();
      const ran = statements;
      const computed = f.kind === 'calculation' && f.options?.unstored;
      let v = f.options?.global
        ? occ.store.calc.globalValue(occ.table, f) as SqlValue
        : computed
          ? occ.store.calc.unstoredValue({ store: occ.store, table: occ.table, row: row as Row }, f, pass) as SqlValue
          : (row[name] ?? null);
      if (computed && tracing()) traceField(performance.now() - t0, `related calc t${occ.table.id}.f${f.id} ${formulaShape(f.calculation ?? '', occ.store.schema.customFunctions.map((c) => c.name))}`, statements - ran);
      // A repeating field gives every repetition, as "TO::Field", "TO::Field(2)", ...: a layout shows as many as it asks for.
      const list = typeof v === 'string' && v.startsWith('[') && occ.store.repeating[occ.table.name]?.includes(name) ? JSON.parse(v) as SqlValue[] : undefined;
      const mask = occ.store.local(p)?.mask(occ.table.name, name);
      const given = list ?? [v];
      const shownReps = list ? Math.max(given.length, repetitionsOf(f)) : 1;
      Array.from({ length: shownReps }, (_, i) => given[i]).forEach((one, i) => {
        const shown = occ.store.present(one ?? null, f.type, fmt, p?.linkPrincipal);
        out[`${occ.to.name}::${name}${i ? `(${i + 1})` : ''}`] = mask ? maskValue(shown, occ.store.maskFor(f, mask)) : shown;
      });
    }
    return out;
  }

  /** Formatting kept with a related record's text fields, keyed "TO::Field": it shows in portals and related fields too. */
  private relatedStyles(occ: Occurrence, row: Record<string, SqlValue>, fields: string[]): Record<string, StyleRun[]> | undefined {
    const wanted = new Set(fields);
    // A related field's first repetition only: the one a portal row or related field shows unless it names another.
    const kept = occ.store.textStyles.read(occ.table.id, Number(row._fm_record_id), (id, r) => {
      const def = occ.table.fields.find((x) => x.id === id);
      return r === 1 && def && wanted.has(def.name) && occ.store.keepsFormatting(def) ? occ.store.keptText(def, row[def.name], 1) : undefined;
    });
    if (!kept?.length) return undefined;
    return Object.fromEntries(kept.map((k) => [`${occ.to.name}::${occ.table.fields.find((x) => x.id === k.field)!.name}`, k.runs]));
  }

  private copyRelatedValues(out: Record<string, unknown>, values: Record<string, unknown>, to: string, fields: string[]): void {
    const target = occurrenceByName(this, to);
    const table = target && (occurrence(this, target.id)?.table ?? this.schema.tables.find((t) => t.id === target.baseTableId));
    for (const name of fields) {
      const field = table?.fields.find((f) => f.name === name);
      for (let rep = 1; rep <= (field?.options?.repetitions ?? 1); rep++) {
        const key = `${to}::${name}${rep === 1 ? '' : `(${rep})`}`;
        out[key] = values[key] ?? '';
      }
    }
  }

  private addRelated(plan: LayoutPlan, row: Record<string, SqlValue>, rec: StoredRecord, fmt: DateFormat, paging: PortalPaging = {}, p?: Privileges): void {
    // With privileges: related records the account can't view show nothing, and fields it can't see are left out.
    const visible = (occ: Occurrence, r: Record<string, SqlValue>) => {
      const pv = occ.store.local(p);
      return !pv || occ.store.allows(occ.table, pv.table(occ.table.name).view, r, pv.account);
    };
    // Masked fields are read (they show their stand-in); only their formatting is left out (see relatedStyles).
    const shown = (occ: Occurrence, fields: string[]) => {
      const pv = occ.store.local(p);
      return pv ? fields.filter((f) => pv.fieldAccess(occ.table.name, f) !== 'none') : fields;
    };
    const styleable = (occ: Occurrence, fields: string[]) => {
      const pv = occ.store.local(p);
      return pv ? fields.filter((f) => pv.field(occ.table.name, f) !== 'none') : fields;
    };
    // The fields a record shows from an occurrence by name: those the account can see, even when no related record is found.
    const listed = (occurrence: string, fields: string[]) => {
      if (!p) return fields;
      try {
        const info = this.occurrence(occurrence);
        const pv = info.owner.local(p);
        return pv ? fields.filter((f) => pv.fieldAccess(info.table, f) !== 'none') : fields;
      } catch (e) {
        rethrowExecutionRefusal(e);
        return fields; // a related file that isn't hosted: its fields read empty, as before
      }
    };
    const traced = tracing();
    const t0 = traced ? performance.now() : 0;
    const ran0 = statements;
    const stamps = new Map<Store, string>();
    for (const r of plan.related) {
      const res = relatedRows(this, plan.occurrenceId, row, r.occurrenceId, { limit: 1, cols: this.shownColumns(r.occurrenceId, r.fields, p) });
      const seen = res?.rows[0] && visible(res.occurrence, res.rows[0]);
      const values = seen ? this.relatedValues(res.occurrence, res.rows[0], shown(res.occurrence, r.fields), fmt, p, stamps) : {};
      this.copyRelatedValues(rec.fieldData, values, r.occurrence, listed(r.occurrence, r.fields));
      const styled = seen ? this.relatedStyles(res.occurrence, res.rows[0], styleable(res.occurrence, r.fields)) : undefined;
      if (styled) rec.styles = { ...rec.styles, ...styled };
    }
    if (traced && plan.related.length) traceField(performance.now() - t0, `related fields: ${plan.related.length} occurrences, ${plan.related.reduce((n, r) => n + r.fields.length, 0)} fields`, statements - ran0);
    if (!plan.portals.length) return;
    rec.portalData = {};
    for (const portal of plan.portals) {
      const t0 = traced ? performance.now() : 0;
      const ran0 = statements;
      const page = paging[portal.name] ?? {};
      // A portal on the layout's own occurrence shows the found set, as in FileMaker: unless asked for more, the rows it
      // shows (and a few more), since its rows are records of the found set and each one works out its fields.
      const foundSetPortal = portal.occurrenceId === plan.occurrenceId;
      const window = { offset: Math.max(1, page.offset ?? 1) - 1, limit: page.limit ?? (foundSetPortal ? (portal.rows ?? FOUND_SET_ROWS) + FOUND_SET_SPARE : 50) };
      // Every record of a page shows the same found-set rows: they are worked out once.
      const memoKey = foundSetPortal && this.foundSetMemo ? `${portal.name}\0${window.offset}\0${window.limit}` : undefined;
      const memo = memoKey !== undefined ? this.foundSetMemo!.get(memoKey) : undefined;
      if (memo) {
        rec.portalData[portal.name] = memo.out.map((o) => ({ ...o }));
        if (memo.styles) (rec.portalStyles ??= {})[portal.name] = memo.styles;
        let counts = this.portalFound.get(rec);
        if (!counts) this.portalFound.set(rec, counts = { privileges: p, counts: {} });
        counts.counts[portal.name] = memo.count;
        continue;
      }
      // Object refresh retains displayed identities even when a new filter would exclude them.
      // These ids select rows only; viewing privileges still filter and redact every result below.
      const occ = page.ids && occurrence(this, portal.occurrenceId);
      const res = occ ? { occurrence: occ, rows: [...rowsById(occ.store, occ.table, page.ids!)].map((r) => r.row as Record<string, SqlValue>), count: page.ids!.length }
        : foundSetPortal ? this.foundSetPage(portal, row, window) : this.portalRows(plan, portal, row, window, p, portal.fields.length ? portal.fields : undefined);
      if (res) {
        let counts = this.portalFound.get(rec);
        if (!counts) this.portalFound.set(rec, counts = { privileges: p, counts: {} });
        counts.counts[portal.name] = res.count;
      }
      const rows = (res?.rows ?? []).map((r) => foundSetPortal ? this.previewRows?.get(Number(r._fm_record_id)) ?? r : r).filter((r) => visible(res!.occurrence, r));
      const ran1 = statements;
      const out = rows.map((r) => {
        const fields = shown(res!.occurrence, portal.fields.length ? portal.fields : res!.occurrence.table.fields.map((f) => f.name));
        const o = {
          recordId: String(r._fm_record_id), modId: String(r._fm_mod_id),
          ...this.relatedValues(res!.occurrence, r, fields, fmt, p, stamps),
        } as PortalRow;
        const styled = this.relatedStyles(res!.occurrence, r, fields.filter((f) => styleable(res!.occurrence, [f]).length));
        if (styled) ((rec.portalStyles ??= {})[portal.name] ??= {})[o.recordId] = styled;
        return o;
      });
      const ran2 = statements;
      // Each related occurrence the portal's rows show, asked once for all of them.
      for (const rel of portal.related ?? []) {
        const each = rows.length ? firstRelatedEach(this, portal.occurrenceId, rows, rel.occurrenceId, rel.fields) : undefined;
        const relFields = listed(rel.occurrence, rel.fields);
        out.forEach((o, i) => {
          const one = each?.firsts[i];
          const values = one && visible(each!.occurrence, one) ? this.relatedValues(each!.occurrence, one, shown(each!.occurrence, rel.fields), fmt, p, stamps) : {};
          this.copyRelatedValues(o, values, rel.occurrence, relFields);
        });
      }
      rec.portalData[portal.name] = out;
      if (memoKey !== undefined && res) this.foundSetMemo!.set(memoKey, { out: out.map((o) => ({ ...o })), styles: rec.portalStyles?.[portal.name], count: res.count });
      if (traced) traceField(performance.now() - t0, `portal t${res?.occurrence.table.id ?? '?'} ${rows.length} rows: rows ${ran1 - ran0}, their fields ${ran2 - ran1}, ${(portal.related ?? []).length} related ${statements - ran2} statements`, statements - ran0);
    }
  }

  /**
   * The found set a find is reading records of, for portals on the layout's own occurrence (found-set portals).
   * Set only while findHere reads its page; elsewhere such a portal shows the record itself, a found set of one.
   */
  private foundSet?: number[];
  private previewRows?: Map<number, Record<string, SqlValue>>;
  /** While findHere reads a page: each found-set portal's rows, worked out for the first record and reused for the rest. */
  private foundSetMemo?: Map<string, { out: PortalRow[]; styles?: Record<string, Record<string, StyleRun[]>>; count: number }>;

  /** A found-set portal's page of rows: the found set's records, in its order, or just this record. */
  private foundSetPage(portal: LayoutPlan['portals'][number], row: Record<string, SqlValue>, page: { offset: number; limit: number }): RelatedResult | undefined {
    const occ = occurrence(this, portal.occurrenceId);
    if (!occ) return undefined;
    const ids = this.foundSet ?? [Number(row._fm_record_id)];
    const rows = [...rowsById(occ.store, occ.table, ids.slice(page.offset, page.offset + page.limit))].map((r) => r.row as Record<string, SqlValue>);
    return { occurrence: occ, rows, count: ids.length };
  }

  /**
   * Rows of a found-set portal (one on the layout's own occurrence) for a found set the caller names, in its order:
   * what the web client shows in such a portal, for the window's found set.
   */
  foundSetRows(...args: Parameters<Store['foundSetRowsCurrent']>): { rows: PortalRow[]; count: number; styles?: Record<string, Record<string, StyleRun[]>> } {
    return this.withDesignRead(() => this.foundSetRowsCurrent(...args));
  }

  private foundSetRowsCurrent(layout: string | LayoutInfo, portalName: string, ids: number[], page: { offset?: number; limit?: number }, opts: { dateFormat?: DateFormat; privileges?: Privileges; rows?: Map<number, Record<string, SqlValue>> } = {}): { rows: PortalRow[]; count: number; styles?: Record<string, Record<string, StyleRun[]>> } {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges);
    // A window's saved ids can outlive its record privileges. Filter before paging or counting.
    const allowed = info.owner.viewableIds(info.table, opts.privileges);
    if (allowed) {
      const visible = new Set(allowed);
      ids = ids.filter((id) => visible.has(id));
    }
    const graph = info.home ?? this;
    const plan = info.plan;
    const portal = plan?.portals.find((x) => x.name === portalName);
    if (!plan || !portal || portal.occurrenceId !== plan.occurrenceId || !ids.length) return { rows: [], count: 0 };
    const rec: StoredRecord = { recordId: ids[0], modId: 0, fieldData: {} };
    const was = graph.foundSet;
    const previews = graph.previewRows;
    graph.previewRows = opts.rows;
    graph.foundSet = ids;
    try {
      const only: LayoutPlan = { ...plan, portals: [portal], related: [] };
      graph.addRelated(only, opts.rows?.get(ids[0]) ?? info.owner.row(info, ids[0]), rec, opts.dateFormat ?? 'us', { [portal.name]: { ...page, ids: ids.slice(Math.max(0, (page.offset ?? 1) - 1), Math.max(0, (page.offset ?? 1) - 1) + (page.limit ?? 50)) } }, opts.privileges);
    } finally {
      graph.foundSet = was;
      graph.previewRows = previews;
    }
    return { rows: rec.portalData?.[portal.name] ?? [], count: ids.length, ...(rec.portalStyles?.[portal.name] ? { styles: rec.portalStyles[portal.name] } : {}) };
  }

  /**
   * Total related records per portal, for a record shown on a layout. Given
   * the record as it was just read (with its portals, for the same account),
   * the totals worked out then are used instead of walking the portals again.
   */
  portalCounts(...args: Parameters<Store['portalCountsCurrent']>): ReturnType<Store['portalCountsCurrent']> {
    return this.withDesignRead(() => this.portalCountsCurrent(...args));
  }

  private portalCountsCurrent(layout: string | LayoutInfo, recordId: number, privileges?: Privileges, read?: StoredRecord): Record<string, number> {
    // Account-bearing reads must recheck current access before any cached result.
    // An account-free snapshot can reuse its counts without refreshing metadata.
    const checked = privileges ? this.layoutInfo(layout) : undefined;
    if (checked) {
      this.checkLayout(checked, privileges);
      if (!this.canView(checked, recordId, privileges)) throw new StoreError(200, 'Record access is denied');
    }
    // Related rows or a time-dependent rule may have changed since the record was read.
    const reuseCounts = !privileges || privileges.readsEverything;
    // Counts attached to the supplied record describe that read's snapshot; no
    // database access is needed when it already contains every portal's count.
    const previous = read && (typeof layout === 'string' ? this.layoutCache.value.get(layout) : layout);
    const counts = read && previous && (this.portalFound.get(read) ?? previous.home?.portalFound.get(read));
    if (reuseCounts && previous?.plan && counts?.privileges === privileges && counts && previous.plan.portals.every((p) => counts.counts[p.name] !== undefined)) {
      return Object.fromEntries(previous.plan.portals.map((p) => [p.name, counts.counts[p.name]]));
    }
    const info = checked ?? this.layoutInfo(layout);
    const out: Record<string, number> = {};
    if (!info.plan) return out;
    const known = read && (this.portalFound.get(read) ?? info.home?.portalFound.get(read));
    let row: Record<string, SqlValue> | undefined;
    for (const p of info.plan.portals) {
      const kept = reuseCounts && known && known.privileges === privileges ? known.counts[p.name] : undefined;
      if (kept !== undefined) {
        out[p.name] = kept;
        continue;
      }
      // A found-set portal read outside a find shows the record itself.
      if (p.occurrenceId === info.plan.occurrenceId) {
        out[p.name] = 1;
        continue;
      }
      row ??= info.owner.row(info, recordId);
      out[p.name] = this.portalRows(info.plan, p, row, { limit: 0 }, privileges)?.count ?? 0;
    }
    return out;
  }

  /** Each portal's total related records, worked out while a record was read (see portalCounts). */
  private readonly portalFound = new WeakMap<StoredRecord, { privileges?: Privileges; counts: Record<string, number> }>();

  /**
   * A field's index: the distinct values it holds across the table, each line of
   * a value on its own, sorted (FileMaker's View Index, Insert From Index and
   * auto-complete). `key` is a field of the layout's occurrence or "TO::Field".
   * Global, unstored and summary fields have no index. Dates and timestamps
   * come as MM/DD/YYYY, or as stored (ISO) with `dateFormat: 'iso'`.
   */
  fieldIndex(...args: Parameters<Store['fieldIndexCurrent']>): ReturnType<Store['fieldIndexCurrent']> {
    return this.withDesignRead(() => this.fieldIndexCurrent(...args));
  }

  private fieldIndexCurrent(layout: string | LayoutInfo, key: string, opts: { prefix?: string; limit?: number; privileges?: Privileges; dateFormat?: DateFormat } = {}): string[] {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges);
    const [toName, name] = key.includes('::') ? key.split('::', 2) as [string, string] : [info.occurrence, key];
    const to = occurrenceByName(this, toName);
    const occ = to && occurrence(this, to.id);
    const field = occ?.table.fields.find((f) => f.name === name.replace(/\(\d+\)$/, ''));
    if (!occ || !field) throw new StoreError(102, `Field "${key}" is missing`);
    if (field.kind === 'summary' || field.options?.global || (field.kind === 'calculation' && field.options?.unstored) || field.type === 'container') return [];
    const pv = occ.store.local(opts.privileges);
    if (pv && pv.field(occ.table.name, field.name) === 'none') return [];
    const col = q(field.name);
    let raws: SqlValue[];
    if (pv) {
      // Record by record, keeping only the values of the records the account can view.
      raws = [];
      for (const r of occ.store.sql.prepare(`SELECT * FROM ${q(occ.table.name)} WHERE ${col} IS NOT NULL`).iterate() as Iterable<Record<string, SqlValue>>) {
        checkMemory();
        if (occ.store.allows(occ.table, pv.table(occ.table.name).view, r, pv.account)) raws.push(r[field.name]);
      }
    } else {
      raws = (occ.store.sql.prepare(`SELECT DISTINCT ${col} AS v FROM ${q(occ.table.name)} WHERE ${col} IS NOT NULL`).all() as { v: SqlValue }[]).map((r) => r.v);
    }
    const prefix = opts.prefix?.toLowerCase() ?? '';
    // Dates and timestamps sort by their stored ISO form; everything else by its text.
    const dated = field.type === 'date' || field.type === 'timestamp';
    const seen = new Map<string, { text: string; key: string }>();
    for (const raw of raws) {
      for (const line of String(occ.store.present(raw, field.type, opts.dateFormat ?? 'us')).split(/\r\n|\r|\n/)) {
        const v = line.trim();
        if (v === '' || !v.toLowerCase().startsWith(prefix)) continue;
        // One entry for values that differ only in case, as FileMaker's index does.
        if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), { text: v, key: dated ? String(raw) : v });
      }
    }
    const out = [...seen.values()].sort(field.type === 'decimal'
      ? (a, b) => { const x = decimalKey(a.text) ?? '', y = decimalKey(b.text) ?? ''; return x < y ? -1 : x > y ? 1 : 0; }
      : field.type === 'number' || field.type === 'integer' || field.type === 'boolean'
      ? (a, b) => Number(a.text) - Number(b.text) || a.text.localeCompare(b.text)
      : (a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base' })).map((e) => e.text);
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /**
   * A value list's items: the value entered and the text shown. Custom lists
   * give their values; a field's list gives each distinct value (with its
   * second field), sorted. A list of related values needs the current record,
   * `from` (a record of the occurrence it starts from), and is empty without one.
   */
  valueListItems(...args: Parameters<Store['valueListItemsCurrent']>): { value: string; display: string }[] {
    return this.withDesignRead(() => this.valueListItemsCurrent(...args));
  }

  private valueListItemsCurrent(list: string | number, from?: { info: LayoutInfo; recordId: number }, privileges?: Privileges): { value: string; display: string }[] {
    const vl = this.schema.valueLists.find((v) => (typeof list === 'number' ? v.id === list : v.name.toLowerCase() === list.toLowerCase()));
    if (!vl) throw new StoreError(108, `Value list "${list}" is missing`);
    if (this.local(privileges)?.valueList(vl.name) === 'none') return [];
    if (vl.external) {
      // A list defined in another file: that file's items, once it is open.
      const file = dataSourceFile(this.schema.dataSources.find((d) => d.id === vl.external!.dataSourceId)?.paths ?? []);
      const other = file ? this.resolvedFile(file) : undefined;
      if (!other || !other.schema.valueLists.some((v) => v.id === vl.external!.valueListId)) return [];
      return other.valueListItems(vl.external.valueListId, undefined, privileges);
    }
    if (!vl.field) return (vl.values ?? []).map((v) => ({ value: v, display: v }));
    const src = vl.field;
    const occ = occurrence(this, src.occurrenceId);
    const field = occ?.table.fields.find((f) => f.id === src.fieldId);
    if (!occ || !field) return [];
    const second = src.secondFieldId !== undefined ? occ.table.fields.find((f) => f.id === src.secondFieldId) : undefined;
    const pv = occ.store.local(privileges);
    if (pv && [field, second].some((f) => f && pv.field(occ.table.name, f.name) === 'none')) return [];
    // Read a record at a time: a value list over a large table keeps its distinct values, not its records.
    let rows: Iterable<Record<string, SqlValue>>;
    if (src.relatedFromId !== undefined) {
      if (!from) return [];
      if (privileges) this.get(from.info, from.recordId, 'iso', undefined, privileges, { fields: [] });
      rows = relatedRows(this, src.relatedFromId, from.info.owner.row(from.info, from.recordId), src.occurrenceId, { privileges })?.rows ?? [];
    } else {
      rows = occ.store.sql.prepare(`SELECT * FROM ${q(occ.table.name)}`).iterate() as Iterable<Record<string, SqlValue>>;
    }
    const calc = occ.store.calc;
    const pass = calc.newPass(privileges?.account, privileges);
    const seen = new Set<string>();
    const items: { value: string; display: string; key: Value }[] = [];
    for (const row of rows) {
      checkMemory();
      if (pv && !occ.store.allows(occ.table, pv.table(occ.table.name).view, row, pv.account)) continue;
      pass.values.clear();
      pass.related.clear();
      const rec = { store: occ.store, table: occ.table, row: row as Row };
      let first: Value, other: Value | undefined;
      try {
        first = calc.value(rec, field, 1, pass);
        other = second && calc.value(rec, second, 1, pass);
      } catch (e) {
        rethrowExecutionRefusal(e);
        continue;
      }
      const value = asText(first, occ.store.dateOrder);
      const display = other === undefined ? value : asText(other, occ.store.dateOrder);
      if (value === '' || seen.has(`${value}\u0000${display}`)) continue;
      seen.add(`${value}\u0000${display}`);
      items.push({ value, display, key: src.sortBySecond && other !== undefined ? other : first });
    }
    items.sort((a, b) => compare(a.key, b.key, occ.store.dateOrder));
    return items.map(({ value, display }) => ({ value, display }));
  }

  /**
   * A portal's rows for one record: its related records, filtered by the
   * portal's formula (evaluated for each row, so the portal's own fields mean
   * that row's) and sorted, then paged.
   */
  /**
   * The columns of `table` that formulas and fields can read, so related
   * records aren't read whole (wide records, containers) for a portal's
   * filter, sort or rows: each stored field named, through the unstored
   * calculations named (their formulas, in turn), and the match fields of
   * every relationship from the table. Undefined (every column) when that
   * can't be told from the text: a summary, a custom function, a field
   * named at run time, or a comment (one may sit between a function's name
   * and its bracket).
   */
  private formulaColumns(table: Table, formulas: string[], fields: Field[]): string[] | undefined {
    // Worked out once a design: a layout's portals ask on every record read.
    let cache = formulaColumnsKept.get(this.schema);
    if (!cache) formulaColumnsKept.set(this.schema, cache = new PreparedCache(new Map<string, string[] | null>(), (value) => new Map(value)));
    const known = cache.value;
    const key = `${table.id}\u0000${fields.map((f) => f.id).join(',')}\u0000${formulas.join('\u0000')}`;
    if (known.has(key)) return known.get(key) ?? undefined;
    const out = this.workOutColumns(table, formulas, fields);
    known.set(key, out ?? null);
    return out;
  }

  private workOutColumns(table: Table, formulas: string[], fields: Field[]): string[] | undefined {
    const cols = new Set(['_fm_mod_id']);
    const seen = new Set<Field>();
    const todo = [...formulas.map((f) => f.toLowerCase())];
    const use = (f: Field): boolean => {
      if (seen.has(f)) return true;
      seen.add(f);
      if (f.kind === 'summary') return false;
      if (f.options?.global) return true;
      // An unstored calculation's own column too: one whose formula can't be worked out shows what it holds.
      if (f.kind === 'calculation' && f.options?.unstored) todo.push((f.calculation ?? '').toLowerCase());
      cols.add(f.name);
      return true;
    };
    for (const f of fields) if (!use(f)) return undefined;
    const mine = new Set(this.schema.tableOccurrences.filter((o) => o.baseTableId === table.id && !o.dataSourceId).map((o) => o.id));
    for (const r of this.schema.relationships) {
      for (const pr of r.predicates) {
        for (const [to, id] of [[r.leftTableOccurrenceId, pr.leftFieldId], [r.rightTableOccurrenceId, pr.rightFieldId]] as const) {
          const f = mine.has(to) ? table.fields.find((x) => x.id === id) : undefined;
          if (f && !use(f)) return undefined;
        }
      }
    }
    for (let text = todo.pop(); text !== undefined; text = todo.pop()) {
      if (/\/\*|\/\//.test(text) || /\b(?:evaluate|getfield|getnthrecord|getfieldname|getsummary|executesql)\s*\(/.test(text)) return undefined;
      if (this.schema.customFunctions.some((c) => text!.includes(c.name.toLowerCase()))) return undefined;
      for (const f of table.fields) if (text.includes(f.name.toLowerCase()) && !use(f)) return undefined;
    }
    return [...cols];
  }

  /**
   * A portal's related records (a page of them) and how many there are in
   * all. `show`: the fields its rows show; then just the columns those need
   * are read for them, not whole records.
   */
  /**
   * The columns a related record is read with to show `show` (field names)
   * of occurrence `toId`: see formulaColumns. Undefined (every column) for a
   * table in another file, or when a record-level rule limits what the
   * account views (it decides from the whole record).
   */
  private shownColumns(toId: number, show: string[], privileges?: Privileges): string[] | undefined {
    const target = occurrence(this, toId);
    if (!target || target.store !== this || target.store.limitsView(target.table.name, privileges)) return undefined;
    return this.formulaColumns(target.table, [], show.flatMap((n) => target.table.fields.filter((f) => f.name === n)));
  }

  private portalRows(plan: LayoutPlan, p: LayoutPlan['portals'][number], row: Record<string, SqlValue>, page: { offset?: number; limit?: number }, privileges?: Privileges, show?: string[]): RelatedResult | undefined {
    // Records the account can't view are left out before paging and counting, so neither shows they exist.
    const target = occurrence(this, p.occurrenceId);
    const limited = !!privileges && !!target && target.store.limitsView(target.table.name, privileges);
    // A record-level rule decides from the whole record which ones the account sees, so then they are read whole.
    const shownCols = show && !limited ? this.shownColumns(p.occurrenceId, show, privileges) : undefined;
    if (!p.filter && !p.sort && !limited) return relatedRows(this, plan.occurrenceId, row, p.occurrenceId, { ...page, cols: shownCols });
    const all = relatedIdList(this, plan.occurrenceId, row, p.occurrenceId);
    if (!all) return undefined;
    const occ = all.occurrence;
    const viewable = limited ? new Set(occ.store.viewableIds(occ.table.name, privileges)) : undefined;
    const calc = occ.store.calc;
    // Formulas name occurrences of this file's graph, even when the rows live in another file.
    // Each row is worked out in passes emptied after it, and only its id and sort values are kept.
    // Worked out as the account sees them: a sort or filter over related totals never counts records it can't view.
    const pass = calc.newPass(privileges?.account, privileges);
    const formulaPass = this.calc.newPass(privileges?.account, privileges);
    const context = (rec: Rec) => this.calc.context(rec, occ.to.id, formulaPass);
    // A field of the portal's table, or TO::Field through a relationship (its first related record).
    const keys = (p.sort ?? []).flatMap((s) => {
      const f = occ.table.fields.find((x) => x.name === s.field);
      if (!f && !s.field.includes('::')) return [];
      const order = s.order?.map((v) => v.toLowerCase());
      return [{ f, formula: s.field, dir: s.descending ? -1 : 1, order }];
    });
    const valueOf = (rec: Rec, k: (typeof keys)[number]): Value | undefined => {
      try {
        return k.f ? calc.value(rec, k.f, 1, pass) : evaluateFormula(k.formula, context(rec));
      } catch (e) {
        rethrowExecutionRefusal(e);
        return undefined;
      }
    };
    let kept: { id: number; values: (Value | undefined)[] }[] = [];
    const cols = occ.store === this ? this.formulaColumns(occ.table, [p.filter ?? '', ...keys.map((k) => (k.f ? '' : k.formula))], keys.flatMap((k) => (k.f ? [k.f] : []))) : undefined;
    for (const rec of rowsById(occ.store, occ.table, viewable ? all.ids.filter((id) => viewable.has(id)) : all.ids, cols)) {
      checkMemory();
      let shown = true;
      if (p.filter) {
        try {
          shown = asBoolean(evaluateFormula(p.filter, context(rec)));
        } catch (e) {
          rethrowExecutionRefusal(e);
          shown = false;
        }
      }
      if (shown) kept.push({ id: Number(rec.row._fm_record_id), values: keys.map((k) => valueOf(rec, k)) });
      for (const x of [pass, formulaPass]) {
        x.values.clear();
        x.related.clear();
      }
    }
    if (keys.length) {
      // A custom order puts the value list's values first, in its order; other values follow, ascending.
      const rank = (v: Value | undefined, order: string[]) => {
        const i = v === undefined ? -1 : order.indexOf(asText(v, this.dateOrder).toLowerCase());
        return i < 0 ? order.length : i;
      };
      kept = [...kept].sort((a, b) => {
        for (let i = 0; i < keys.length; i++) {
          const [x, y] = [a.values[i], b.values[i]];
          const order = keys[i].order;
          const r = order ? rank(x, order) - rank(y, order) : 0;
          if (r) return r * keys[i].dir;
          const c = x === undefined || y === undefined ? (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0) : compare(x, y, this.dateOrder);
          if (c) return c * keys[i].dir;
        }
        return 0;
      });
    }
    const offset = Math.max(0, page.offset ?? 0);
    const limit = page.limit ?? kept.length;
    const shown = kept.slice(offset, offset + limit).map((k) => k.id);
    return { occurrence: occ, rows: [...rowsById(occ.store, occ.table, shown, shownCols)].map((r) => r.row as Record<string, SqlValue>), count: kept.length };
  }

  /** Field data from a client -> column values, validating names. */
  private columns(info: LayoutInfo, data: FieldData, current?: Record<string, SqlValue>, order: DateStyle = this.dateOrder, rememberRepetitions = true): Map<string, SqlValue> {
    const byName = new Map(info.fields.map((f) => [f.name, f]));
    const reps = new Set([...(this.repeating[info.table] ?? []), ...this.table(info).fields.filter((f) => (f.options?.repetitions ?? 1) > 1).map((f) => f.name)]);
    const out = new Map<string, SqlValue>();
    const repValues = new Map<string, SqlValue[]>();
    for (const [key, value] of Object.entries(data)) {
      const m = /^(.*)\((\d+)\)$/.exec(key);
      const name = m && byName.has(m[1]) ? m[1] : key;
      const rep = m && byName.has(m[1]) ? Number(m[2]) : 1;
      const f = byName.get(name);
      if (!f) throw new StoreError(102, `Field "${key}" is missing`);
      if (!Number.isSafeInteger(rep) || rep < 1 || rep > repetitionsOf(this.table(info).fields.find((x) => x.name === name)!)) {
        throw new StoreError(102, `Field "${key}" is missing`);
      }
      if (f.calculated) throw new StoreError(201, `Field "${key}" cannot be modified: it is a calculation`);
      if (f.type === 'container') throw new StoreError(201, `Field "${key}" is a container: upload its contents instead`);
      // Existing callers can supply the stored JSON array as the unsuffixed repeating value.
      // Numbered keys still patch individual cells and preserve the other stored repetitions.
      if (!m && rep === 1 && reps.has(name) && typeof value === 'string' && value.startsWith('[')) {
        let values: unknown;
        try { values = JSON.parse(value); } catch { /* A literal field value, not stored repetitions. */ }
        if (Array.isArray(values)) {
          if (values.length > repetitionsOf(this.table(info).fields.find((x) => x.name === name)!)) throw new StoreError(102, `Field "${key}" is missing`);
          repValues.set(name, values.map((v) => v === null ? null : this.normalize(String(v), f.type, order)));
          continue;
        }
      }
      if (this.fileMode === 'native' && f.type === 'decimal' && typeof value === 'number' && decimalNumberText(value) === undefined) {
        throw new StoreError(500, `Field "${key}" needs a decimal string for numbers with more than 15 significant digits`);
      }
      const input = this.fileMode === 'native' && f.type === 'decimal' && typeof value === 'number' ? decimalNumberText(value)! : String(value);
      const v = this.normalize(input, f.type, order);
      if (this.fileMode === 'native' && (f.type === 'boolean' || f.type === 'integer' || f.type === 'decimal' || f.type === 'json' || f.type === 'uuid') && v !== null && nativeValue(input, f.type) === undefined) {
        throw new StoreError(500, `Field "${key}" must be a valid ${f.type}, not ${String(value).slice(0, 40)}`);
      }
      // A native file's dates and timestamps are ISO 8601: text that isn't one is refused, with the code a date failing validation gets.
      this.validateNativeDate(key, v, f.type);
      // Text that reads as a number too big for one ("1e999") is kept as typed here, and SQLite's number column would make
      // it Infinity: refuse it, with the code a value that isn't a valid number gets. ("12x" and "Infinity" stay as text.)
      if (f.type === 'number' && typeof v === 'string' && NUMBER_LOOKING.test(v) && !Number.isFinite(Number(v.replace(/,/g, '')))) {
        throw new StoreError(502, `Field "${key}" cannot hold ${v.length > 40 ? `${v.slice(0, 40)}...` : v}: it is too large to be a number`);
      }
      if (rep === 1 && !reps.has(name) && !repValues.has(name)) {
        out.set(name, v);
        continue;
      }
      if (!repValues.has(name)) {
        // The first repetition given in the same write ("Note" beside "Note(3)") counts, whichever came first.
        const cur = current?.[name];
        repValues.set(name, out.has(name) ? [out.get(name)!] : typeof cur === 'string' && cur.startsWith('[') ? JSON.parse(cur) : cur != null ? [cur] : []);
      }
      const arr = repValues.get(name)!;
      while (arr.length < rep) arr.push(null);
      arr[rep - 1] = v;
    }
    for (const [name, arr] of repValues) {
      out.set(name, JSON.stringify(arr));
      if (rememberRepetitions) this.markRepeating(info.table, name);
    }
    return out;
  }

  /** Remember (across restarts) that a column now holds repetitions as a JSON array. */
  private markRepeating(table: string, field: string): void {
    const list = (this.repeating[table] ??= []);
    if (list.includes(field)) return;
    list.push(field);
    this.sql.prepare(`INSERT INTO _fm_meta VALUES ('repeating', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`)
      .run(JSON.stringify(this.repeating));
  }

  // --- containers ---------------------------------------------------------

  /** Folders externally stored container files are read from, first match wins (see externalRoots()). */
  externalRoots: string[];
  /** Operator-managed directory symlinks found before this store opened. */
  private externalDirectoryLinks: ReturnType<typeof existingDirectoryLinks> = new Map();
  /** A working copy of `other` (a dry run, the debugger): it reads container files from where `other` does, links included. */
  readContainersLike(other: Store): void {
    this.externalRoots = other.externalRoots;
    this.externalDirectoryLinks = other.externalDirectoryLinks;
  }

  /** Where an externally stored container file is, if it is there; never outside the roots. */
  externalFile(rel: string): string | undefined {
    for (const root of this.externalRoots) {
      const full = safeExistingPath(root, rel, this.externalDirectoryLinks);
      if (full && statSync(full).isFile()) return full;
    }
    return undefined;
  }

  /** How many container files are stored outside the file, and which of them aren't found. */
  externalContainerCheck(): { files: number; missing: number; examples: string[] } {
    const rows = this.sql.prepare('SELECT external FROM _fm_containers WHERE external IS NOT NULL').all() as { external: string }[];
    const missing = rows.filter((r) => !this.externalFile(r.external));
    return { files: rows.length, missing: missing.length, examples: missing.slice(0, 3).map((r) => r.external) };
  }

  /** How many container files are stored outside the file (without looking for them). */
  externalContainerCount(): number {
    return (this.sql.prepare('SELECT count(*) AS n FROM _fm_containers WHERE external IS NOT NULL').get() as { n: number }).n;
  }

  /**
   * Per container field, how many of its files are stored outside the file,
   * how many of those are found beside the hosted file, and the folders they
   * are expected in (under RC_Data_FMS/<file>/), for a migrating administrator.
   */
  externalContainerReport(): { table: string; field: string; files: number; found: number; missing: number; folders: string[]; examples: string[] }[] {
    const external = new Map((this.sql.prepare('SELECT id, external FROM _fm_containers WHERE external IS NOT NULL').all() as { id: number; external: string }[]).map((r) => [Number(r.id), r.external]));
    if (!external.size) return [];
    const seen = new Map<string, boolean>();
    const exists = (rel: string) => {
      let ok = seen.get(rel);
      if (ok === undefined) seen.set(rel, (ok = !!this.externalFile(rel)));
      return ok;
    };
    const out: ReturnType<Store['externalContainerReport']> = [];
    for (const t of this.schema?.tables ?? []) {
      for (const f of t.fields.filter((x) => x.type === 'container')) {
        let rows: { v: unknown }[];
        try {
          rows = this.sql.prepare(`SELECT ${q(f.name)} AS v FROM ${q(t.name)} WHERE ${q(f.name)} IS NOT NULL`).all() as { v: unknown }[];
        } catch {
          continue; // a field the store has no column for (unstored)
        }
        const r = { table: t.name, field: f.name, files: 0, found: 0, missing: 0, folders: [] as string[], examples: [] as string[] };
        const folders = new Set<string>();
        for (const { v } of rows) {
          const ids = typeof v === 'string' && v.startsWith('[') ? (JSON.parse(v) as unknown[]) : [v];
          for (const id of ids) {
            const rel = id === null || id === '' ? undefined : external.get(Number(id));
            if (!rel) continue;
            r.files++;
            folders.add(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '');
            if (exists(rel)) r.found++;
            else {
              r.missing++;
              if (r.examples.length < 3) r.examples.push(rel);
            }
          }
        }
        if (!r.files) continue;
        r.folders = [...folders].sort().slice(0, 10);
        out.push(r);
      }
    }
    return out;
  }

  /** Container rows no record field points to, including their external path when they have one. */
  orphanContainerReport(): { count: number; containers: { id: number; filename: string | null; external: string | null; size: number }[] } {
    const referenced = new Set<number>();
    const add = (value: unknown) => {
      const values = typeof value === 'string' && value.startsWith('[') ? (() => { try { return JSON.parse(value) as unknown[]; } catch { return []; } })() : [value];
      for (const id of values) {
        const n = typeof id === 'number' || typeof id === 'bigint' ? Number(id) : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : NaN;
        if (Number.isSafeInteger(n) && n > 0) referenced.add(n);
      }
    };
    for (const table of this.schema?.tables ?? []) {
      for (const field of table.fields.filter((f) => f.type === 'container')) {
        let rows: { value: unknown }[];
        try {
          rows = this.sql.prepare(`SELECT ${q(field.name)} AS value FROM ${q(table.name)} WHERE ${q(field.name)} IS NOT NULL`).all() as { value: unknown }[];
        } catch (e) {
          // Unstored container calculations have no column. Any other failed scan means
          // the result would be incomplete, so don't let a caller purge from it.
          if (field.kind === 'calculation' && field.options?.unstored) continue;
          throw e;
        }
        for (const { value } of rows) add(value);
      }
    }
    // Persisted global fields are values, not table columns.
    const globals = (this.meta('globals') ?? {}) as Record<string, Record<string, unknown>>;
    for (const table of this.schema?.tables ?? []) for (const field of table.fields.filter((f) => f.type === 'container' && f.options?.global)) {
      add(globals[table.name]?.[field.name]);
    }
    // Design trash keeps deleted fields and tables so restoreField/restoreTable can
    // bring their values back. Their schemas are no longer active, so inspect the
    // archived values directly and retain any container ids they contain.
    const deletedTables = this.sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB '_fm_deleted_[0-9]*'").all() as { name: string }[];
    for (const { name } of deletedTables) {
      const rows = this.sql.prepare(`SELECT * FROM ${q(name)}`).all() as Record<string, unknown>[];
      for (const row of rows) for (const value of Object.values(row)) add(value);
    }
    // Approval proposals can be applied later. Resolve their table and container
    // fields from the current design and retain those values until approval/rejection.
    if (this.hasTable('_fm_pending')) {
      const pending = this.sql.prepare('SELECT tbl, data FROM _fm_pending WHERE data IS NOT NULL').all() as { tbl: string; data: string }[];
      for (const row of pending) {
        const table = this.schema?.tables.find((t) => t.name.toLowerCase() === row.tbl.toLowerCase());
        if (!table) continue;
        const fields = new Set(table.fields.filter((f) => f.type === 'container').map((f) => f.name.toLowerCase()));
        if (!fields.size) continue;
        let data: Record<string, unknown>;
        try { data = JSON.parse(row.data) as Record<string, unknown>; } catch { continue; }
        for (const [key, value] of Object.entries(data)) if (fields.has(key.replace(/\(\d+\)$/, '').toLowerCase())) add(value);
      }
    }
    // Stored-calculation refresh batches also carry before/after values for undo.
    if (this.hasTable('_fm_calc_refresh')) {
      const batches = this.sql.prepare('SELECT undo FROM _fm_calc_refresh').all() as { undo: string }[];
      for (const batch of batches) {
        let changes: { table?: string; field?: string; before?: unknown; after?: unknown }[];
        try { changes = JSON.parse(batch.undo) as typeof changes; } catch { continue; }
        for (const change of changes) {
          const field = this.schema?.tables.find((t) => t.name.toLowerCase() === change.table?.toLowerCase())?.fields
            .find((f) => f.name.toLowerCase() === change.field?.toLowerCase());
          if (field?.type === 'container') { add(change.before); add(change.after); }
        }
      }
    }
    // Audit entries retain the before/after values of deleted and changed rows so
    // restoreRecord and duplicate-merge undo can put the original pointer back.
    const history = this.sql.prepare("SELECT tbl, kind, changes FROM _fm_audit WHERE security = 0 AND changes IS NOT NULL AND kind IN ('create', 'update', 'delete')").all() as { tbl: string; kind: string; changes: string }[];
    for (const entry of history) {
      const table = this.schema?.tables.find((t) => t.name.toLowerCase() === entry.tbl.toLowerCase());
      if (!table) continue;
      const fields = new Set(table.fields.filter((f) => f.type === 'container').map((f) => f.name.toLowerCase()));
      if (!fields.size) continue;
      let changes: Record<string, unknown>;
      try { changes = JSON.parse(entry.changes) as Record<string, unknown>; } catch { continue; }
      for (const [key, value] of Object.entries(changes)) {
        const field = key.replace(/\(\d+\)$/, '').toLowerCase();
        if (!fields.has(field)) continue;
        if (entry.kind === 'update' && Array.isArray(value)) for (const side of value) add(side);
        else add(value);
      }
    }
    // Bulk clean-up, duplicate merges and import update/replace keep row values
    // in a separate undo journal. Imports point to that journal by id.
    const hasCleanupJournal = this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_fm_cleanup'").get();
    if (hasCleanupJournal) {
      const batches = this.sql.prepare('SELECT undo FROM _fm_cleanup').all() as { undo: string }[];
      for (const batch of batches) {
        let ops: { op?: string; table?: string; field?: string; before?: unknown; after?: unknown; row?: Record<string, unknown>; values?: Record<string, unknown> }[];
        try { ops = JSON.parse(batch.undo) as typeof ops; } catch { continue; }
        for (const op of ops) {
          const table = this.schema?.tables.find((t) => t.name.toLowerCase() === op.table?.toLowerCase());
          if (!table) continue;
          const fields = new Set(table.fields.filter((f) => f.type === 'container').map((f) => f.name.toLowerCase()));
          if (op.op === 'set' && op.field && fields.has(op.field.toLowerCase())) {
            add(op.before);
            add(op.after);
          }
          for (const row of [op.row, op.values]) if (row) {
            for (const [field, value] of Object.entries(row)) if (fields.has(field.toLowerCase())) add(value);
          }
        }
      }
    }
    const rows = this.sql.prepare(`SELECT c.id, c.filename, c.external,
      coalesce(c.external_size, length(c.data), (SELECT sum(length(data)) FROM _fm_container_chunks WHERE id = c.id), 0) AS size
      FROM _fm_containers c ORDER BY c.id`).all() as { id: number | bigint; filename: string | null; external: string | null; size: number | bigint }[];
    const containers = rows.filter((row) => !referenced.has(Number(row.id))).map((row) => ({
      id: Number(row.id), filename: row.filename, external: row.external, size: Number(row.size),
    }));
    return { count: containers.length, containers };
  }

  /** Explicitly removes unreferenced container rows, chunks and safe external files. Default retention is unchanged. */
  purgeOrphanContainers(): { removed: number; bytes: number; externalFiles: number } {
    if (this.heldBy || this.sql.isTransaction) throw new StoreError(301, 'Orphan containers can only be purged with no transaction open');
    const { containers } = this.orphanContainerReport();
    if (!containers.length) return { removed: 0, bytes: 0, externalFiles: 0 };
    const paths = new Set(containers.map((c) => c.external).filter((x): x is string => !!x));
    // externalFile returns canonical paths, so canonicalize the owning folders too
    // (e.g. /var and /private/var on macOS). Readable storage mounts outside these
    // folders are not owned by this file and must not be purged.
    const ownFolders = [join(dirname(this.path), 'RC_Data_FMS', this.name), join(dirname(this.path), 'Files', this.name)]
      .map((folder) => safeExistingPath(folder, '.')).filter((folder): folder is string => !!folder);
    const externalFiles = [...paths].filter((rel) => !(this.sql.prepare('SELECT 1 FROM _fm_containers WHERE external = ? AND id NOT IN (SELECT value FROM json_each(?)) LIMIT 1').get(rel, JSON.stringify(containers.map((c) => c.id)))))
      .map((rel) => this.externalFile(rel)).filter((path): path is string => !!path)
      .filter((path) => ownFolders.some((folder) => safeExistingPath(folder, relative(folder, path)) === path));
    this.sql.exec('SAVEPOINT purge_orphan_containers');
    try {
      const delChunks = this.sql.prepare('DELETE FROM _fm_container_chunks WHERE id = ?');
      const delContainer = this.sql.prepare('DELETE FROM _fm_containers WHERE id = ?');
      for (const container of containers) {
        delChunks.run(container.id);
        delContainer.run(container.id);
      }
      this.sql.exec('RELEASE purge_orphan_containers');
    } catch (e) {
      this.sql.exec('ROLLBACK TO purge_orphan_containers; RELEASE purge_orphan_containers');
      throw e;
    }
    for (const path of externalFiles) rmSync(path, { force: true });
    return { removed: containers.length, bytes: containers.reduce((sum, c) => sum + c.size, 0), externalFiles: externalFiles.length };
  }

  /**
   * VerifyContainer: whether a container file is as it was stored. A file in the database always is; one stored
   * outside it isn't when it is missing, or when its size isn't the size recorded as it was stored. (FileMaker also
   * records a 16-byte hash of the file, whose kind isn't known here, so a change that keeps the size isn't caught.)
   */
  containerIntact(id: number): boolean {
    const row = this.sql.prepare('SELECT external, external_size FROM _fm_containers WHERE id = ?').get(id) as
      | { external: string | null; external_size: number | bigint | null } | undefined;
    if (!row?.external) return true;
    const at = this.externalFile(row.external);
    const size = at ? fileSize(at) : undefined;
    if (size === undefined) return false;
    return row.external_size === null || size === Number(row.external_size);
  }

  private externalOf(id: number): string | null | undefined {
    return (this.sql.prepare('SELECT external FROM _fm_containers WHERE id = ?').get(id) as { external: string | null } | undefined)?.external;
  }

  private containerMeta(id: number): { filename: string | null; mime: string } | undefined {
    return this.sql.prepare('SELECT filename, mime FROM _fm_containers WHERE id = ?').get(id) as
      | { filename: string | null; mime: string } | undefined;
  }

  container(id: number): Container | undefined {
    const row = this.sql.prepare('SELECT id, filename, mime, data, external FROM _fm_containers WHERE id = ?').get(id) as
      | { id: number; filename: string | null; mime: string; data: Uint8Array; external?: string | null } | undefined;
    if (!row) return undefined;
    const { external, ...file } = row;
    if (external) {
      const at = this.externalFile(external);
      return { ...file, id: Number(row.id), data: at ? readFileSync(at) : new Uint8Array(0) };
    }
    if (!row.data.length) {
      const chunks = this.sql.prepare('SELECT data FROM _fm_container_chunks WHERE id = ? ORDER BY n').all(id) as { data: Uint8Array }[];
      if (chunks.length) row.data = Buffer.concat(chunks.map((c) => c.data));
    }
    return { ...row, id: Number(row.id) };
  }

  /** A container file's name, type and size, without reading it. */
  containerInfo(id: number): ContainerInfo | undefined {
    const row = this.sql.prepare(`SELECT id, filename, mime, length(data) AS size,
      coalesce((SELECT token FROM _fm_container_versions WHERE id = c.id), 'original') AS version,
      (SELECT sum(length(data)) FROM _fm_container_chunks WHERE id = c.id) AS chunked, external, external_size, stored FROM _fm_containers c WHERE id = ?`).get(id) as
      | { id: number; version: string; filename: string | null; mime: string; size: number; chunked: number | null; external: string | null; external_size: number | bigint | null; stored: number | bigint | null } | undefined;
    const modified = row?.stored == null ? {} : { modified: Number(row.stored) };
    if (row?.external) {
      const at = this.externalFile(row.external);
      const size = at ? fileSize(at) : undefined;
      // Missing, or not the size recorded when it was stored (VerifyContainer): see containerIntact.
      const changed = size === undefined || (row.external_size !== null && size !== Number(row.external_size));
      return {
        id: Number(row.id), version: row.version, filename: row.filename, mime: row.mime, size: size ?? 0, chunked: true, ...modified, // read a range at a time from disk
        external: { path: row.external, missing: size === undefined, ...(changed ? { changed: true as const } : {}) },
      };
    }
    return row && { id: Number(row.id), version: row.version, filename: row.filename, mime: row.mime, size: Number(row.size || row.chunked || 0), chunked: !row.size && !!row.chunked, ...modified };
  }

  /** Bytes `start` to `end` (inclusive) of a container file, reading only the pieces they are in. */
  containerRange(id: number, start: number, end: number): Uint8Array {
    if (end < start) return new Uint8Array(0);
    const external = this.externalOf(id);
    if (external) {
      const at = this.externalFile(external);
      if (!at) return new Uint8Array(0);
      const fd = openSync(at, 'r');
      try {
        const buf = Buffer.alloc(end - start + 1);
        return buf.subarray(0, readSync(fd, buf, 0, buf.length, start));
      } finally {
        closeSync(fd);
      }
    }
    const first = Math.floor(start / CONTAINER_CHUNK);
    const chunks = this.sql.prepare('SELECT n, data FROM _fm_container_chunks WHERE id = ? AND n BETWEEN ? AND ? ORDER BY n')
      .all(id, first, Math.floor(end / CONTAINER_CHUNK)) as { n: number; data: Uint8Array }[];
    if (chunks.length) {
      const all = Buffer.concat(chunks.map((c) => c.data));
      const from = start - first * CONTAINER_CHUNK;
      return all.subarray(from, from + end - start + 1);
    }
    const row = this.sql.prepare('SELECT substr(data, ?, ?) AS part FROM _fm_containers WHERE id = ?').get(start + 1, end - start + 1, id) as { part: Uint8Array } | undefined;
    return row?.part ?? new Uint8Array(0);
  }

  /** Stores a container file (in pieces when big) and returns its id. */
  addContainer(file: ContainerFile): number {
    const kind = file.mime.startsWith('image/') ? 'image' : 'file';
    const stored = Math.floor(Date.now() / 1000);
    const size = containerFileSize(file);
    if (size <= CONTAINER_CHUNK) {
      let data: Uint8Array | undefined;
      if (spooled(file)) eachContainerPiece(file, (_n, piece) => { data = Buffer.from(piece); });
      else data = file.data;
      return Number(this.sql.prepare('INSERT INTO _fm_containers (filename, mime, kind, data, stored) VALUES (?, ?, ?, ?, ?)').run(file.filename, file.mime, kind, data ?? new Uint8Array(0), stored).lastInsertRowid);
    }
    this.sql.exec('SAVEPOINT add_container');
    try {
      const id = Number(this.sql.prepare("INSERT INTO _fm_containers (filename, mime, kind, data, stored) VALUES (?, ?, ?, x'', ?)").run(file.filename, file.mime, kind, stored).lastInsertRowid);
      const piece = this.sql.prepare('INSERT INTO _fm_container_chunks (id, n, data) VALUES (?, ?, ?)');
      eachContainerPiece(file, (n, bytes) => { piece.run(id, n, bytes); });
      this.sql.exec('RELEASE add_container');
      return id;
    } catch (e) {
      this.sql.exec('ROLLBACK TO add_container; RELEASE add_container');
      throw e;
    }
  }

  /**
   * A file for a container field set to store its files outside the database (FileMaker's open external storage):
   * written to the field's folder under the file's container folder (RC_Data_FMS/<file>/<base>/<path>, as FileMaker
   * Server keeps them), where FileMaker and backups of that folder find it. Undefined for fields stored in the file,
   * and for secure storage, whose files are kept in the database instead (encrypted at rest with it).
   */
  private addExternalContainer(info: LayoutInfo, recordId: number, field: string, file: ContainerFile): number | undefined {
    const written = this.writeExternalFile(info, recordId, field, file);
    if (!written) return undefined;
    const rel = written.rel;
    const kind = file.mime.startsWith('image/') ? 'image' : 'file';
    return Number(this.sql.prepare("INSERT INTO _fm_containers (filename, mime, kind, data, external, external_size, stored) VALUES (?, ?, ?, x'', ?, ?, ?)")
      .run(file.filename, file.mime, kind, rel, containerFileSize(file), Math.floor(Date.now() / 1000)).lastInsertRowid);
  }

  /** Writes a container file into its field's external folder; the path it is kept at (under the container folder) and where on disk, or undefined where the field doesn't store files outside. */
  private writeExternalFile(info: LayoutInfo, recordId: number, field: string, file: ContainerFile, beforeWrite?: (root: string, rel: string) => void): { rel: string; full: string } | undefined {
    const table = info.table;
    const es = this.schema.tables.find((t) => t.name === table)?.fields.find((f) => f.name === field)?.options?.externalStorage;
    if (!es || es.secure) return undefined;
    const base = this.schema.containerDirectories?.find((d) => d.id === es.directoryId)?.path ?? '';
    const root = externalRoots(dirname(this.path), this.name, [base])[0];
    if (!root) return undefined;
    // The field's open-storage path: a calculation on the record (often just "Table/Field/"), or its text as read
    // from a FileMaker file. One that fails gives FileMaker's default, Table/Field/.
    let plain = `${table}/${field}/`;
    if (es.path && /^[^"&()\\:*?<>|$]+$/.test(es.path)) plain = es.path;
    else if (es.path) {
      try {
        const [v] = this.evaluateEach(info, [es.path], recordId);
        const t = v === undefined ? '' : asText(v, this.dateOrder);
        if (t && !/[\\:*?"<>|]/.test(t)) plain = t;
      } catch (e) {
        rethrowExecutionRefusal(e);
        // keep the default
      }
    }
    const folder = plain.split('/').filter((x) => x && x !== '.' && x !== '..').join('/');
    const name = (file.filename ?? 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_') || 'file';
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    // Long names are cut (a file system takes 255 bytes), keeping the extension.
    const cut = (t: string, bytes: number) => {
      while (Buffer.byteLength(t) > bytes) t = t.slice(0, -1);
      return t;
    };
    const short = ext.length > 16 ? '' : ext;
    const head = cut(short ? stem : name, 200 - Buffer.byteLength(short));
    let rel = folder ? `${folder}/${head}${short}` : `${head}${short}`;
    // A name already taken keeps its file: the new one is numbered, as FileMaker does. Taken means on disk under
    // any folder files are read from (a migrated file's own), or named by a container even when its file is missing,
    // so a new file can never stand in for an older record's.
    const named = this.sql.prepare('SELECT 1 FROM _fm_containers WHERE external = ? LIMIT 1');
    const taken = (r: string) => !!safeExistingPath(root, r, this.externalDirectoryLinks) || !!this.externalFile(r) || !!named.get(r);
    for (let n = 2; taken(rel); n++) rel = `${folder ? `${folder}/` : ''}${head} ${n}${short}`;
    const full = safeWritePath(root, rel, this.externalDirectoryLinks);
    if (!full) return undefined;
    beforeWrite?.(root, rel);
    const fd = openSync(full, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o666);
    try {
      if (spooled(file)) eachContainerPiece(file, (_n, piece) => { for (let done = 0; done < piece.length;) done += writeSync(fd, piece, done, piece.length - done); });
      else writeFileSync(fd, file.data);
    } finally { closeSync(fd); }
    if (this.heldBy) this.heldFiles.push(full);
    return { rel, full };
  }

  /** The container files a field holds that are stored in the database, each with the first record that shows it. */
  private embeddedContainers(table: string, field: string): Map<number, number> {
    const out = new Map<number, number>();
    const embedded = this.sql.prepare('SELECT 1 FROM _fm_containers WHERE id = ? AND external IS NULL');
    const rows = this.sql.prepare(`SELECT _fm_record_id AS r, ${q(field)} AS v FROM ${q(table)} WHERE ${q(field)} IS NOT NULL AND ${q(field)} != ''`).all() as { r: number | bigint; v: SqlValue }[];
    for (const { r, v } of rows) {
      for (const x of typeof v === 'string' && v.startsWith('[') ? (JSON.parse(v) as SqlValue[]) : [v]) {
        const id = x === null || x === '' ? NaN : Number(x);
        if (Number.isInteger(id) && !out.has(id) && embedded.get(id)) out.set(id, Number(r));
      }
    }
    return out;
  }

  /** How many files a container field keeps in the database, and their size: what moveContainersOut would take out. */
  embeddedContainerCount(table: string, field: string): { files: number; bytes: number } {
    const ids = [...this.embeddedContainers(table, field).keys()];
    const size = this.sql.prepare('SELECT coalesce(length(data), 0) + coalesce((SELECT sum(length(data)) FROM _fm_container_chunks WHERE id = c.id), 0) AS n FROM _fm_containers c WHERE id = ?');
    return { files: ids.length, bytes: ids.reduce((sum, id) => sum + Number((size.get(id) as { n: number | bigint } | undefined)?.n ?? 0), 0) };
  }

  /** Under the database write lock, remove only files named by an interrupted move. */
  private recoverContainersOut(): void {
    const journal = this.path + '.containers-out.json';
    if (!existsSync(journal)) return;
    const pending = JSON.parse(readFileSync(journal, 'utf8')) as { root: string; rel: string }[];
    const named = this.sql.prepare('SELECT 1 FROM _fm_containers WHERE external = ? LIMIT 1');
    for (const { root, rel } of pending) {
      if (!this.externalRoots.includes(root)) throw new Error('Invalid container move journal root');
      if (named.get(rel)) continue;
      const full = safeExistingPath(root, rel, this.externalDirectoryLinks);
      if (full) rmSync(full, { force: true });
    }
    rmSync(journal);
  }

  /**
   * Moves the files a container field keeps in the database out to its external-storage folder (the field has to be
   * set to open external storage first), one file each, where backups of the folder and FileMaker find them. All or
   * nothing: a file that can't be written leaves the database as it was and removes the files already written.
   * Returns the container ids moved, which moveContainersIn takes back.
   */
  moveContainersOut(table: string, field: string): { moved: number; bytes: number; ids: number[] } {
    const t = this.schema.tables.find((x) => x.name === table);
    const f = t?.fields.find((x) => x.name === field);
    if (!t || !f) throw new StoreError(102, `Field "${table}::${field}" is missing`);
    if (f.type !== 'container') throw new StoreError(102, `Field "${table}::${field}" is not a container`);
    if (!f.options?.externalStorage || f.options.externalStorage.secure) throw new StoreError(201, `Field "${table}::${field}" doesn't store its files outside the file: set it to open external storage first`);
    const to = this.schema.tableOccurrences.find((o) => !o.dataSourceId && o.baseTableId === t.id);
    const occ = to && occurrence(this, to.id);
    if (!occ) throw new StoreError(105, `Table "${table}" has no table occurrence`);
    if (this.heldBy || this.sql.isTransaction) throw new StoreError(301, 'Container files can only be moved with no transaction open');
    const info = this.occurrenceInfo(occ);
    const written: string[] = [];
    const ids: number[] = [];
    let bytes = 0;
    const journal = this.path + '.containers-out.json';
    const pending: { root: string; rel: string }[] = [];
    let committed = false;
    const synchronous = Number(this.sql.prepare('PRAGMA synchronous').get()!.synchronous);
    // The journal can go only after the references are durable in the WAL.
    this.sql.exec('PRAGMA synchronous = FULL');
    try {
      this.sql.exec('BEGIN IMMEDIATE');
      this.recoverContainersOut();
      const update = this.sql.prepare("UPDATE _fm_containers SET data = x'', external = ?, external_size = ? WHERE id = ?");
      const chunks = this.sql.prepare('DELETE FROM _fm_container_chunks WHERE id = ?');
      for (const [id, recordId] of this.embeddedContainers(table, field)) {
        const file = this.container(id);
        if (!file || !file.data.length) continue;
        const out = this.writeExternalFile(info, recordId, field, file, (root, rel) => {
          pending.push({ root, rel });
          atomicWrite(journal, JSON.stringify(pending));
        });
        if (!out) throw new StoreError(201, `Field "${table}::${field}" doesn't store its files outside the file`);
        written.push(out.full);
        syncPath(out.full);
        syncPath(dirname(out.full));
        crashPoint('containers-out:after-write');
        update.run(out.rel, file.data.length, id);
        chunks.run(id);
        crashPoint('containers-out:after-update');
        ids.push(id);
        bytes += file.data.length;
      }
      this.sql.exec('COMMIT');
      committed = true;
      crashPoint('containers-out:after-commit');
      // A different mover can take the lock after COMMIT and replace the
      // journal. Reacquire it before recovery/cleanup so its work stays safe.
      this.sql.exec('BEGIN IMMEDIATE');
      this.recoverContainersOut();
      this.sql.exec('COMMIT');
    } catch (e) {
      if (this.sql.isTransaction) {
        this.sql.exec('ROLLBACK');
        if (!committed) for (const w of written) rmSync(w, { force: true });
      }
      throw e;
    } finally { this.sql.exec(`PRAGMA synchronous = ${synchronous}`); }
    return { moved: ids.length, bytes, ids };
  }

  /**
   * Puts container files back in the database from their external files (undo of moveContainersOut), then removes
   * the files it copied. A file that isn't found is left as it is, and counted in `missing`.
   */
  moveContainersIn(ids: number[]): { moved: number; bytes: number; missing: number } {
    if (this.heldBy || this.sql.isTransaction) throw new StoreError(301, 'Container files can only be moved with no transaction open');
    const copied: string[] = [];
    let bytes = 0;
    let missing = 0;
    this.sql.exec('SAVEPOINT move_containers_in');
    try {
      const external = this.sql.prepare('SELECT external FROM _fm_containers WHERE id = ?');
      const update = this.sql.prepare('UPDATE _fm_containers SET data = ?, external = NULL, external_size = NULL WHERE id = ?');
      const empty = this.sql.prepare("UPDATE _fm_containers SET data = x'', external = NULL, external_size = NULL WHERE id = ?");
      const piece = this.sql.prepare('INSERT INTO _fm_container_chunks (id, n, data) VALUES (?, ?, ?)');
      for (const id of ids) {
        const rel = (external.get(id) as { external: string | null } | undefined)?.external;
        if (!rel) continue;
        const at = this.externalFile(rel);
        if (!at) {
          missing++;
          continue;
        }
        const data = readFileSync(at);
        if (data.length <= CONTAINER_CHUNK) update.run(data, id);
        else {
          empty.run(id);
          for (let n = 0; n * CONTAINER_CHUNK < data.length; n++) piece.run(id, n, data.subarray(n * CONTAINER_CHUNK, (n + 1) * CONTAINER_CHUNK));
        }
        crashPoint('containers-in:after-copy');
        copied.push(at);
        bytes += data.length;
      }
      this.sql.exec('RELEASE move_containers_in');
      crashPoint('containers-in:after-commit');
    } catch (e) {
      this.sql.exec('ROLLBACK TO move_containers_in; RELEASE move_containers_in');
      throw e;
    }
    // NORMAL-mode WAL commits are not durable until a checkpoint syncs them.
    // A busy reader can prevent completion: retain the source files in that case.
    let checkpointed = false;
    let checkpointError: unknown;
    const timeout = this.sql.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    try {
      // Bound each retry instead of waiting the connection's usual five seconds.
      this.sql.exec('PRAGMA busy_timeout = 50');
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const checkpoint = this.sql.prepare('PRAGMA wal_checkpoint(FULL)').get() as { busy: number; log: number; checkpointed: number };
          if (!checkpoint.busy && checkpoint.log === checkpoint.checkpointed) {
            checkpointed = true;
            break;
          }
        } catch (error) { checkpointError = error; }
      }
    } finally { this.sql.exec(`PRAGMA busy_timeout = ${timeout.timeout}`); }
    crashPoint('containers-in:after-checkpoint');
    if (checkpointed) for (const at of copied) {
      rmSync(at, { force: true });
      crashPoint('containers-in:after-remove');
    }
    else console.warn('Container move committed, but checkpoint incomplete; external files retained', checkpointError ?? '');
    return { moved: copied.length, bytes, missing };
  }

  /** Gives the space freed by moved or deleted files back to the disk (rewrites the database file; nothing may be open). */
  compactFile(): void {
    if (this.heldBy || this.sql.isTransaction) throw new StoreError(301, 'The file can only be compacted with no transaction open');
    this.sql.exec('VACUUM');
    this.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  /** The container id a record's container field holds (repetition is 1-based). */
  containerId(layout: string | LayoutInfo, recordId: number, field: string, repetition = 1): number | undefined {
    const info = this.layoutInfo(layout);
    if (info.owner !== this) return info.owner.containerId(info, recordId, field, repetition);
    const v = this.row(info, recordId)[field];
    const one = typeof v === 'string' && v.startsWith('[') ? (JSON.parse(v) as SqlValue[])[repetition - 1] : repetition === 1 ? v : null;
    return one === null || one === undefined || one === '' ? undefined : Number(one);
  }

  /**
   * Throws what setContainer would throw for this account, record and field, without changing anything: a caller turns
   * an upload away with it before reading the file's bytes.
   */
  checkContainerWrite(layout: string | LayoutInfo, recordId: number, field: string, repetition: number, opts: WriteOptions = {}): void {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges);
    this.checkWriteFields(info, opts.privileges, [field]);
    this.checkLayout(info, opts.privileges, true);
    this.refuseIfGated(opts, 'container uploads');
    if (info.owner !== this) return info.owner.checkContainerWrite(info, recordId, field, repetition, opts);
    const f = info.fields.find((x) => x.name === field);
    if (!f) throw new StoreError(102, `Field "${field}" is missing`);
    if (f.type !== 'container') throw new StoreError(102, `Field "${field}" is not a container`);
    const reps = Math.max(1, this.schema.tables.find((t) => t.name === info.table)?.fields.find((x) => x.name === field)?.options?.repetitions ?? 1);
    if (!Number.isInteger(repetition) || repetition < 1 || repetition > reps) throw new StoreError(111, `Field "${field}" has no repetition ${repetition}`);
    this.checkLock(info.table, recordId);
    this.checkWrite(info, this.local(opts.privileges), [field], this.row(info, recordId));
  }

  /** Put a file in a container field (repetition is 1-based), like the Data API's upload; null empties it. */
  setContainer(layout: string | LayoutInfo, recordId: number, field: string, repetition: number,
    file: ContainerFile | null, opts: WriteOptions = {}): { modId: number } {
    const info = this.layoutInfo(layout);
    this.checkContainerWrite(info, recordId, field, repetition, opts);
    if (info.owner !== this) return info.owner.setContainer(info, recordId, field, repetition, file, opts);
    this.joinTransaction();
    const current = this.row(info, recordId);
    const id = file && (this.addExternalContainer(info, recordId, field, file) ?? this.addContainer(file));
    let value: SqlValue = id;
    if (repetition > 1 || (this.repeating[info.table] ?? []).includes(field)) {
      const cur = current[field];
      const arr: SqlValue[] = typeof cur === 'string' && cur.startsWith('[') ? JSON.parse(cur) : cur != null ? [cur] : [];
      while (arr.length < repetition) arr.push(null);
      arr[repetition - 1] = id;
      value = JSON.stringify(arr);
      this.markRepeating(info.table, field);
    }
    this.sql.prepare(`UPDATE ${q(info.table)} SET _fm_mod_id = _fm_mod_id + 1, ${q(field)} = ? WHERE _fm_record_id = ?`).run(value, recordId);
    // Never the contents: the name, size and a hash that identifies them.
    const described = file && `${file.filename ?? '(file)'} (${containerFileSize(file)} bytes, sha256 ${containerFileHash(file)})`;
    this.audit('update', info.table, recordId, { [repetition > 1 ? `${field}(${repetition})` : field]: [current[field] ?? null, described ?? null] }, opts);
    this.notify('update', info.table, recordId, Number(current._fm_mod_id) + 1, undefined, [field]);
    return { modId: Number(current._fm_mod_id) + 1 };
  }

  // --- records ------------------------------------------------------------

  private orderBy(info: LayoutInfo, sort?: SortSpec[], privileges?: Privileges, valueLists?: { store: Store; recordId?: number }): string {
    if (!sort?.length) return '_fm_record_id';
    return sort.map((s) => {
      const f = info.fields.find((x) => x.name === s.fieldName);
      if (!f) throw new StoreError(102, `Field "${s.fieldName}" is missing`);
      if (f.summary) throw new StoreError(102, `Field "${s.fieldName}" is a summary field and cannot be sorted on`);
      const field = info.owner.schema.tables.find((t) => t.name === info.table)?.fields.find((x) => x.name === f.name);
      const raw = (field?.options?.repetitions ?? 1) > 1 || (this.repeating[info.table] ?? []).includes(f.name)
        ? `fm_first_repetition(${q(f.name)})` : q(f.name);
      const col = f.type === 'number' ? `CAST(${raw} AS REAL)` : f.type === 'decimal' ? `fm_decimal_key(${raw})` : raw;
      const language = recordSortLanguage(field?.options?.indexLanguage, field?.options?.indexLanguageId);
      const key = f.type === 'text' ? language === 'unicode' ? col
        : `${sortFunction(language).replace('fm_sort_key', 'fm_record_sort_key')}(${col})` : col;
      const order = (s.sortOrder ?? 'ascend').toLowerCase();
      const dir = order === 'descend' || order === 'descending' ? 'DESC' : 'ASC';
      if (!['ascend', 'ascending', 'descend', 'descending'].includes(order)) {
        // A custom order based on a value list (the Sort dialog's choice, and the Data API's sortOrder taking a
        // value list's name): its values first, in the list's order, then the rest alphabetically.
        const listStore = valueLists?.store ?? this;
        const pv = listStore.local(privileges);
        if (pv && pv.valueList(s.sortOrder!) === 'none') throw new StoreError(108, `Value list "${s.sortOrder}" is missing`);
        const from = valueLists?.recordId !== undefined ? { info, recordId: valueLists.recordId } : undefined;
        const items = listStore.valueListItems(s.sortOrder!, from, privileges);
        const custom = valueListOrder(field ?? { type: f.type }, this.dateOrder, items.map((it) => it.value));
        const slot = JSON.stringify([listStore.path, s.sortOrder!.toLowerCase(), custom.type, field?.options?.indexLanguage, this.dateOrder]);
        // Content in the token also invalidates cached sorted pages when a list changes.
        const token = createHash('sha256').update(JSON.stringify([slot, [...custom.ranks]])).digest('hex');
        const previous = this.valueListSorts.value.get(slot);
        if (previous?.token !== token) {
          if (previous) this.valueListRanks.value.delete(previous.token);
          this.valueListSorts.value.set(slot, { token, order: custom });
          this.valueListRanks.value.set(token, custom);
        }
        return `fm_value_list_rank(${raw}, '${token}'), ${raw} IS NULL, fm_value_list_text_key(${raw}, '${token}') ASC`;
      }
      return `CASE WHEN ${raw} IS NULL OR ${raw} = '' THEN 0 ELSE 1 END ${dir}, ${key} ${dir}`;
    }).join(', ') + ', _fm_record_id';
  }

  /**
   * Things a person keeps for themselves in this file (saved finds and sorts, recent records), by account: they follow
   * the account to any browser, as FileMaker keeps saved finds with the user. Values are JSON text the client owns.
   */
  userPrefs(account: string): Record<string, string> {
    if (!this.hasTable('_fm_user_prefs')) return {};
    const rows = this.sql.prepare('SELECT key, value FROM _fm_user_prefs WHERE account = ? COLLATE NOCASE').all(account) as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  private hasTable(name: string): boolean {
    return (this.sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { n: number }).n > 0;
  }

  setUserPref(account: string, key: string, value: string | undefined): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS _fm_user_prefs (account TEXT NOT NULL COLLATE NOCASE, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (account, key)) WITHOUT ROWID');
    if (value === undefined) this.sql.prepare('DELETE FROM _fm_user_prefs WHERE account = ? AND key = ?').run(account, key);
    else this.sql.prepare('INSERT OR REPLACE INTO _fm_user_prefs (account, key, value) VALUES (?, ?, ?)').run(account, key, value);
  }

  /** Fields of a base table that lead a SQLite index (so finds and sorts on them can use it). */
  indexedFields(table: string): Set<string> {
    const out = new Set<string>();
    for (const ix of this.sql.prepare(`PRAGMA index_list(${q(table)})`).all() as { name: string }[]) {
      const first = (this.sql.prepare(`PRAGMA index_info(${q(ix.name)})`).all() as { seqno: number; name: string | null }[]).find((c) => c.seqno === 0);
      if (first?.name) out.add(first.name);
    }
    return out;
  }

  /**
   * Adds an index on a stored field so finds and sorts on it stop reading every record. Only Tabularius's own
   * SQLite index: the FileMaker field's design is unchanged, and dropping it changes nothing but speed.
   */
  addFieldIndex(table: string, field: string): { index: string; created: boolean } {
    this.joinTransaction();
    const t = this.schema.tables.find((x) => x.name.toLowerCase() === table.toLowerCase());
    if (!t) throw new StoreError(106, `No table "${table}"`);
    const f = t.fields.find((x) => x.name.toLowerCase() === field.toLowerCase());
    if (!f) throw new StoreError(102, `${t.name} has no field "${field}"`);
    if (f.kind === 'summary' || f.options?.global || (f.kind === 'calculation' && f.options?.unstored) || f.type === 'container') {
      throw new StoreError(102, `${t.name}::${f.name} isn't stored, so it can't be indexed`);
    }
    const had = this.indexedFields(t.name).has(f.name);
    const index = `_fm_find_${t.id}_${f.id}`;
    if (!had) this.sql.exec(`CREATE INDEX IF NOT EXISTS ${q(index)} ON ${q(t.name)} (${q(f.name)}${f.type === 'text' ? ' COLLATE NOCASE' : ''})`);
    return { index, created: !had };
  }

  /** Removes the index addFieldIndex made on a field, if there is one; whether there was. */
  dropFieldIndex(table: string, field: string): boolean {
    this.joinTransaction();
    const t = this.schema.tables.find((x) => x.name.toLowerCase() === table.toLowerCase());
    if (!t) throw new StoreError(106, `No table "${table}"`);
    const f = t.fields.find((x) => x.name.toLowerCase() === field.toLowerCase());
    if (!f) throw new StoreError(102, `${t.name} has no field "${field}"`);
    const index = `_fm_find_${t.id}_${f.id}`;
    const had = !!this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index);
    if (had) this.sql.exec(`DROP INDEX ${q(index)}`);
    return had;
  }

  /** Told of every find with criteria or a sort, with how long it took (set by the server's profiler). */
  findListener?: (t: FindTiming) => void;

  private timeFind<T>(info: LayoutInfo, opts: { query?: FindRequest[]; sort?: SortSpec[] }, run: () => T, found: (r: T) => number | undefined): T {
    const endBudget = beginFindBudget();
    try {
      if (!this.findListener || (!opts.query?.length && !opts.sort?.length)) return run();
      const started = performance.now();
      const r = run();
      try {
        const fields = [...new Set((opts.query ?? []).flatMap((q) => Object.keys(q).filter((k) => k !== 'omit')))];
        const leadingWildcard = (opts.query ?? []).some((q) => Object.entries(q).some(([k, v]) => k !== 'omit' && typeof v === 'string' && /^[=!<>≤≥]*\*/.test(v.trim())));
        this.findListener({ table: info.table, layout: info.name, fields, sort: (opts.sort ?? []).map((x) => x.fieldName), leadingWildcard,
          ms: performance.now() - started, found: found(r), total: this.recordCount(info.table) });
      } catch (e) { rethrowExecutionRefusal(e); /* timing is best effort */ }
      return r;
    } catch (e) {
      if (e instanceof FindError) throw new StoreError(e.code, e.message);
      throw e;
    } finally {
      endBudget();
    }
  }

  find(layout: string | LayoutInfo, opts: FindOptions = {}): FindResult {
    const previous = Store.designRead;
    Store.designRead ??= new Set();
    try {
      const info = this.layoutInfo(layout);
      this.checkLayout(info, opts.privileges);
      if (info.owner !== this) return info.owner.find(info, opts);
      return this.timeFind(info, opts, () => this.findHere(info, opts), (r) => r.foundCount);
    } finally {
      Store.designRead = previous;
    }
  }

  private findHere(info: LayoutInfo, opts: FindOptions): FindResult {
    const fmt = opts.dateFormat ?? 'us';
    const fields = new Map(info.fields.map((f) => [f.name, f]));
    const pv = this.local(opts.privileges);
    this.checkFieldsVisible(info, pv, [...(opts.query ?? []).flatMap((r) => Object.keys(r)), ...(opts.sort ?? []).map((x) => x.fieldName)]);
    let materialized: string | undefined;
    const source = () => materialized ??= this.findSource(info, opts);
    let where = '1';
    let params: SqlValue[] = [];
    if (opts.query?.length) {
      try {
        ({ where, params } = findWhere(opts.query, fields, (v, t) => this.normalize(v, t, opts.dateOrder), this.relatedCriteria(info, opts.privileges, opts.dateOrder), this.wordIndex(info), () => this.duplicateSource(source(), this.table(info), pv)));
      } catch (e) {
        rethrowExecutionRefusal(e);
        if (e instanceof FindError) throw new StoreError(e.code, e.message);
        throw e;
      }
    }
    // Records the account can't view are not part of any found set (or the total).
    const view = this.viewFilter(info, pv);
    where = `(${where}) AND ${view.where}`;
    params = [...params, ...view.params];
    const total = view.where === '1' ? this.recordCount(info.table)
      : (this.sql.prepare(`SELECT count(*) AS n FROM ${q(info.table)} WHERE ${view.where}`).get(...view.params) as { n: number }).n;
    const limit = Math.max(0, opts.limit ?? 100);
    if (limit === 0 && !opts.query?.length) return { records: [], foundCount: total, totalCount: total };
    const t = source();
    const found = opts.query?.length ? (this.sql.prepare(`SELECT count(*) AS n FROM ${t} WHERE ${where}`).get(...params) as { n: number }).n : total;
    const offset = Math.max(1, opts.offset ?? 1) - 1;
    const order = this.orderBy(info, opts.sort, opts.privileges);
    const rows = opts.sort?.length && found >= SORTED_KEEP_MIN
      ? this.sortedPage(t, where, params, order, offset, limit, found)
      : this.sql.prepare(`SELECT * FROM ${t} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset) as Record<string, SqlValue>[];
    // Every record found (no find, no record-level limits): summaries over the whole table, kept while the data is the same.
    const table = this.table(info);
    const orderedList = !!opts.sort?.length && table.fields.some((f) => f.kind === 'summary' && f.summary?.type === 'list');
    const summaries = rows.length ? this.summaries(info, `SELECT * FROM ${t} WHERE ${where}${orderedList ? ` ORDER BY ${order}` : ''}`, params,
      !orderedList && !opts.query?.length && view.where === '1', opts.layoutOnly, opts.privileges) : undefined;
    if (summaries && table.fields.some((f) => f.summary?.running)) {
      const orderedIds = (this.sql.prepare(`SELECT _fm_record_id AS id FROM ${t} WHERE ${where} ORDER BY ${order}`).all(...params) as { id: number }[]).map((r) => Number(r.id));
      summaries.running = this.runningSummaryValues(info, orderedIds, rows.map((r) => Number(r._fm_record_id)), opts.sort, opts.privileges);
    }
    const foundForCalc = { foundSet: { table, recs: { *[Symbol.iterator](): Generator<Rec> {
      for (const row of info.owner.sql.prepare(`SELECT * FROM ${t} WHERE ${where} ORDER BY ${order}`).iterate(...params) as Iterable<Row>) yield { store: info.owner, table, row };
    } } }, sums: new Map<string, Summed>(), sort: opts.sort };
    // Found-set portals (on the layout's own occurrence) list the records found, in the found set's order.
    const graph = info.home ?? this;
    const foundSet = rows.length && info.plan?.portals.some((x) => x.occurrenceId === info.plan!.occurrenceId)
      ? (this.sql.prepare(`SELECT _fm_record_id AS id FROM ${t} WHERE ${where} ORDER BY ${order}`).all(...params) as { id: number }[]).map((r) => Number(r.id))
      : undefined;
    const was = graph.foundSet;
    const wasMemo = graph.foundSetMemo;
    graph.foundSet = foundSet;
    graph.foundSetMemo = foundSet ? new Map() : undefined;
    try {
      return { records: rows.map((r) => this.toRecord(info, r, fmt, opts.portals, summaries, opts.privileges, undefined, opts.layoutOnly, false, foundForCalc)), foundCount: found, totalCount: total };
    } finally {
      graph.foundSet = was;
      graph.foundSetMemo = wasMemo;
    }
  }

  /**
   * A page of a large sorted found set. Sorting reads every record found (FileMaker's collation can't use an index),
   * so the order is worked out once and kept while the data is the same: scrolling a sorted list of a million records
   * pays for the sort once, not on every page.
   */
  private sortedPage(t: string, where: string, params: SqlValue[], order: string, offset: number, limit: number, found: number): Record<string, SqlValue>[] {
    const key = `${t}\u0000${where}\u0000${JSON.stringify(params)}\u0000${order}`;
    const stamp = this.writeToken();
    let kept = this.sortedIds.value.get(key);
    if (!kept || kept.stamp !== stamp) {
      // The count is already known. Iterate straight into the final typed array so a 5M sort
      // does not also hold 5M SQLite row objects and a second JS number array at its peak.
      const ids = new Int32Array(found);
      let n = 0;
      for (const row of this.sql.prepare(`SELECT _fm_record_id AS id FROM ${t} WHERE ${where} ORDER BY ${order}`).iterate(...params) as Iterable<{ id: number }>) {
        ids[n++] = Number(row.id);
      }
      if (n !== found) throw new Error('Sorted found set changed while it was read');
      kept = { stamp, ids };
      this.sortedIds.value.delete(key);
      this.sortedIds.value.set(key, kept);
      // A few found sets at a time (windows, people): the oldest goes.
      while (this.sortedIds.value.size > SORTED_KEEP) this.sortedIds.value.delete(this.sortedIds.value.keys().next().value!);
    } else {
      this.sortedIds.value.delete(key);
      this.sortedIds.value.set(key, kept);
    }
    const page = [...kept.ids.subarray(offset, offset + limit)];
    if (!page.length) return [];
    const rows = this.sql.prepare(`SELECT * FROM ${t} WHERE _fm_record_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(page)) as Record<string, SqlValue>[];
    const byId = new Map(rows.map((r) => [Number(r._fm_record_id), r]));
    return page.map((id) => byId.get(id)).filter((r): r is Record<string, SqlValue> => !!r);
  }

  private sortedIds = new PreparedCache(new Map<string, { stamp: string; ids: Int32Array }>(), (value) => new Map(value));

  /** Duplicate groups contain only records this account may view, before any request criteria. */
  private duplicateSource(from: string, table: Table, pv?: Privileges): { from: string; params: SqlValue[] } {
    const rule = pv?.table(table.name).view ?? true;
    if (rule === true) return { from, params: [] };
    if (rule === false) return { from: `(SELECT * FROM ${from} WHERE 0)`, params: [] };
    return { from: `(SELECT * FROM ${from} WHERE _fm_record_id IN (SELECT value FROM json_each(?)))`,
      params: [JSON.stringify(this.allowedIds(table, rule, pv!.account))] };
  }

  /**
   * Find criteria on related fields ("Occurrence::Field"): a record matches
   * when one of its related records matches all of that occurrence's
   * criteria, as in FileMaker. Unstored calculations and globals there are
   * computed for the related records the other criteria leave, as a find on
   * the record's own fields computes them (findSource).
   * With privileges, fields the account can't see are missing and related
   * records it can't view never match.
   */
  private relatedCriteria(info: LayoutInfo, privileges?: Privileges, order?: DateStyle): RelatedCriteria {
    return (name, criteria) => {
      const graph = info.home ?? this;
      const target = graph.schema.tableOccurrences.find((t) => t.name.toLowerCase() === name.toLowerCase());
      const from = occurrenceByName(graph, info.occurrence);
      const occ = target && occurrence(graph, target.id);
      if (!from || !occ || target.id === from.id) return undefined;
      const pv = occ.store.local(privileges);
      const fields = new Map<string, FieldInfo>();
      const query: Record<string, string> = {};
      const later: Record<string, string> = {}; // on fields with no stored value: unstored calculations, globals
      const computed: Field[] = [];
      for (const [k, v] of Object.entries(criteria)) {
        const f = occ.table.fields.find((x) => x.name.toLowerCase() === k.toLowerCase());
        if (!f || pv?.field(occ.table.name, f.name.replace(/\(\d+\)$/, '')) === 'none') return undefined;
        if (f.kind === 'summary') throw new FindError(`Field "${name}::${f.name}" is a summary field and cannot be searched`);
        fields.set(f.name, { name: f.name, type: f.type, indexLanguage: f.options?.indexLanguage, ...((f.options?.repetitions ?? 1) > 1 ? { repetitions: f.options!.repetitions } : {}) });
        if ((f.kind === 'calculation' && f.options?.unstored) || f.options?.global) {
          later[f.name] = v;
          computed.push(f);
        } else query[f.name] = v;
      }
      // A duplicate on a computed field must see all records before the other criteria.
      if (Object.values(later).some((v) => v.trim().startsWith('!'))) {
        Object.assign(later, query);
        for (const k of Object.keys(query)) delete query[k];
      }
      const child = findWhere([query], fields, (v, t) => occ.store.normalize(v, t, order), undefined, undefined, () => occ.store.duplicateSource(q(occ.table.name), occ.table, pv));
      const rule = pv?.table(occ.table.name).view ?? true;
      const ids = new Set<number>();
      const matched = (row: Record<string, SqlValue>) => {
        if (rule !== true && !occ.store.allows(occ.table, rule, row, pv!.account)) return;
        for (const r of relatedRows(graph, target.id, row, from.id)?.rows ?? []) ids.add(Number(r._fm_record_id));
      };
      if (!computed.length) {
        for (const row of occ.store.sql.prepare(`SELECT * FROM ${q(occ.table.name)} WHERE ${child.where}`).iterate(...child.params) as Iterable<Record<string, SqlValue>>) {
          checkMemory();
          matched(row);
        }
      } else {
        for (const row of occ.store.computedRows(occ.table, child, computed, later, fields, privileges, order)) {
          checkMemory();
          matched(row);
        }
      }
      return { where: '_fm_record_id IN (SELECT value FROM json_each(?))', params: [JSON.stringify([...ids])] };
    };
  }

  /**
   * The rows of a table that the stored criteria (`stored`) select and, once the `computed` fields (unstored
   * calculations, globals) are worked out for each of them, the `later` criteria on those too. Computed as the account
   * sees them, as findSource does for the found table's own fields.
   */
  private computedRows(table: Table, stored: { where: string; params: SqlValue[] }, computed: Field[], later: Record<string, string>,
    fields: Map<string, FieldInfo>, privileges?: Privileges, order?: DateStyle): Record<string, SqlValue>[] {
    // A name of its own, so a find this one set off (while computing a value) never takes its copy away.
    const name = `_fm_find_related_${++this.trials}`;
    const tmp = `temp.${name}`;
    const pass = this.calc.newPass(privileges?.account, privileges);
    // A savepoint, not BEGIN: it also works inside a trial (see trial()), and the copy goes when the find is done.
    this.sql.exec(`SAVEPOINT ${name}`);
    try {
      const source = this.duplicateSource(q(table.name), table, this.local(privileges));
      this.sql.prepare(`CREATE TEMP TABLE ${name} AS SELECT * FROM ${source.from} WHERE ${stored.where}`).run(...source.params, ...stored.params);
      this.sql.exec(`CREATE UNIQUE INDEX temp.${name}_id ON ${name} (_fm_record_id)`);
      const set = this.sql.prepare(`UPDATE ${tmp} SET ${computed.map((f) => `${q(f.name)} = ?`).join(', ')} WHERE _fm_record_id = ?`);
      // The rows copied, as they were: the copy's own columns are overwritten as it goes.
      for (const row of this.sql.prepare(`SELECT * FROM ${q(table.name)} WHERE _fm_record_id IN (SELECT _fm_record_id FROM ${tmp})`).iterate() as Iterable<Row>) {
        checkMemory();
        const values = computed.map((f) => (f.options?.global
          ? this.calc.globalValue(table, f)
          : this.calc.unstoredValue({ store: this, table, row }, f, pass)) as SqlValue);
        set.run(...values, row._fm_record_id as number);
        pass.values.clear();
        pass.related.clear();
      }
      const then = findWhere([later], fields, (v, t) => this.normalize(v, t, order), undefined, undefined, () => ({ from: tmp, params: [] }));
      const rows = this.sql.prepare(`SELECT * FROM ${tmp} WHERE ${then.where}`).all(...then.params) as Record<string, SqlValue>[];
      this.sql.exec(`DROP TABLE ${tmp}`);
      this.sql.exec(`RELEASE ${name}`);
      return rows;
    } catch (e) {
      try { this.sql.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); } catch { /* the error that matters is the first */ }
      throw e;
    }
  }

  /** Summary fields over a found set (the rows a query selects), in column form. */
  private summaries(info: LayoutInfo, select: string, params: SqlValue[], wholeTable = false, layoutOnly = false, privileges?: Privileges, fresh = false, previews?: Map<number, Record<string, SqlValue>>, orderedIds?: number[]): Summaries | undefined {
    const table = this.table(info);
    const uses = layoutOnly ? info.uses : undefined;
    const defs = table.fields.filter((f) => f.kind === 'summary' && info.fields.some((x) => x.name === f.name) && (!uses || uses.has(f.name.toLowerCase())));
    if (!defs.length) return undefined;
    const values = (collected: Map<Field, Summed>): Summaries => {
      const out: Summaries = new Map(defs.map((f) => [f.name, toStored(summedFor(table, f, collected.get(f)!), summaryType(table, f), this.dateOrder)]));
      for (const f of defs) if (f.summary?.type === 'fractionOfTotal') {
        out.set(f.id, decimalSum(collected.get(f)!.nums));
      }
      return out;
    };
    // Worked out with the account's privileges, so a summary over calculations that read related records leaves
    // out the ones it can't view (as each record's own value does); the account also decides whether a result from
    // before the latest change may stand in (not for its own change).
    const pass: Pass = { ...this.calc.newPass(privileges?.account, privileges), display: !fresh };
    if (wholeTable && !previews?.size) {
      const t0 = performance.now();
      const ran = statements;
      const all = this.calc.wholeTable(table, defs, pass);
      if (tracing()) traceField(performance.now() - t0, `summaries t${table.id} ${defs.length} fields (${defs.map((f) => `f${f.id}`).join(' ')})${pass.staleSums?.size ? ` ${pass.staleSums.size} stale` : ''}`, statements - ran);
      const out = values(all);
      if (pass.staleSums?.size) out.updating = new Set([...pass.staleSums].map((f) => f.name));
      return out;
    }
    // Only the summarized columns, when they are stored, and one record at a time: a found set of a large table isn't held in memory.
    const cols = summaryColumns(table, defs);
    const selected = cols ? select.replace(/^SELECT \* /, `SELECT ${['_fm_record_id', ...cols].map(q).join(', ')} `) : select;
    // List of follows the window's found-set order, including an explicit sort or omission.
    const query = orderedIds && defs.some((f) => f.summary?.type === 'list')
      ? `SELECT selected.* FROM (${selected}) AS selected JOIN json_each(?) AS ordered ON selected._fm_record_id = ordered.value ORDER BY CAST(ordered.key AS INTEGER)`
      : selected;
    if (query !== selected) params = [...params, JSON.stringify(orderedIds)];
    const self = this;
    const recs = function* () {
      for (const row of self.sql.prepare(query).iterate(...params) as Iterable<Row>) yield { store: self, table, row: (previews?.get(Number(row._fm_record_id)) ?? row) as Row };
    };
    // Pending previews have no shared data version and never populate a shared result.
    if (previews?.size) {
      const collected = this.calc.collect(recs(), table, defs, pass);
      return values(collected);
    }
    // Kept as the values shown, not what was collected (which holds every number).
    return this.calc.foundSums(table, defs, pass, query, params, () => {
      const collected = this.calc.collect(recs(), table, defs, pass);
      return values(collected);
    });
  }

  /** Per-record running totals and counts in the found set's order. */
  private runningSummaryValues(info: LayoutInfo, ids: number[], wantedIds: number[], sort?: SortSpec[], privileges?: Privileges, previews?: Map<number, Record<string, SqlValue>>): Map<string, Map<number, number>> {
    const table = this.table(info);
    const defs = table.fields.filter((f) => f.summary?.running && info.fields.some((x) => x.name === f.name));
    const output = new Map(defs.map((f) => [f.name, new Map<number, number>()]));
    const state = new Map(defs.map((f) => [f.id, { total: 0, count: 0, key: undefined as string | undefined }]));
    const pass = this.calc.newPass(privileges?.account, privileges);
    const wanted = new Set(wantedIds);
    const allowed = privileges ? this.viewableIds(table.name, privileges) : undefined;
    const allowedSet = allowed && new Set(allowed);
    for (const rec of rowsById(this, table, ids)) {
      checkMemory();
      const id = Number(rec.row._fm_record_id);
      if (allowedSet && !allowedSet.has(id)) continue;
      if (previews?.has(id)) rec.row = previews.get(id)! as Row;
      for (const f of defs) {
        const s = state.get(f.id)!;
        const restart = table.fields.find((x) => x.id === f.summary!.restartFieldId);
        if (restart && sort?.some((x) => x.fieldName.split('::').pop()?.toLowerCase() === restart.name.toLowerCase())) {
          // Client-supplied sort state does not authorize reading a hidden break field.
          if (this.fieldHidden(table.name, restart.name, privileges)) continue;
          const key = foldCase(asText(this.calc.value(rec, restart, 1, pass), this.dateOrder));
          if (s.key !== undefined && key !== s.key) { s.total = 0; s.count = 0; }
          s.key = key;
        }
        const of = table.fields.find((x) => x.id === f.summary!.fieldId);
        if (of && !this.fieldHidden(table.name, of.name, privileges)) {
          const value = this.calc.value(rec, of, 1, pass);
          if (!isEmpty(value)) {
            s.count++;
            const n = asNumberOrEmpty(value);
            if (n !== undefined) s.total = decimalSum([s.total, n]);
          }
        }
        if (wanted.has(id)) output.get(f.name)!.set(id, f.summary!.type === 'count' ? s.count : s.total);
      }
      wanted.delete(id);
      pass.values.clear();
      pass.related.clear();
      if (!wanted.size) break;
    }
    return output;
  }

  /**
   * The table a find reads. When the find or sort uses unstored calculations
   * or globals, which have no stored values, it reads a temporary copy with
   * those values computed for every record.
   */
  private findSource(info: LayoutInfo, opts: FindOptions): string {
    const used = new Set<string>();
    for (const r of opts.query ?? []) for (const k of Object.keys(r)) used.add(k);
    for (const s of opts.sort ?? []) used.add(s.fieldName);
    const table = this.table(info);
    const computed = table.fields.filter((f) => used.has(f.name) &&
      ((f.kind === 'calculation' && f.options?.unstored) || f.options?.global));
    if (!computed.length) return q(info.table);
    const tmp = 'temp._fm_find';
    this.sql.exec(`DROP TABLE IF EXISTS ${tmp}; CREATE TEMP TABLE _fm_find AS SELECT * FROM ${q(info.table)}; CREATE UNIQUE INDEX temp._fm_find_id ON _fm_find (_fm_record_id)`);
    const set = this.sql.prepare(`UPDATE ${tmp} SET ${computed.map((f) => `${q(f.name)} = ?`).join(', ')} WHERE _fm_record_id = ?`);
    // As the account sees them: a find or sort on a related total never reveals records it can't view.
    const pass = this.calc.newPass(opts.privileges?.account, opts.privileges);
    // A savepoint, not BEGIN: it also works inside a trial (see trial()).
    this.sql.exec('SAVEPOINT find_source');
    try {
      for (const row of this.sql.prepare(`SELECT * FROM ${q(info.table)}`).iterate() as Iterable<Row>) {
        checkMemory();
        const rec = { store: this, table, row };
        const values = computed.map((f) => (f.options?.global
          ? this.calc.globalValue(table, f)
          : this.calc.unstoredValue(rec, f, pass)) as SqlValue);
        set.run(...values, row._fm_record_id as number);
        // Values are reused within a record, not across records.
        pass.values.clear();
        pass.related.clear();
      }
      this.sql.exec('RELEASE find_source');
    } catch (e) {
      this.sql.exec('ROLLBACK TO find_source; RELEASE find_source');
      throw e;
    }
    return tmp;
  }

  /** Flush relationships in this graph and every hosted store its occurrences reach, including multi-hop graphs. */
  flushJoinResults(seen = new Set<Store>()): void {
    if (seen.has(this)) return;
    seen.add(this);
    this.calc.dropLookups();
    for (const to of this.schema.tableOccurrences) {
      const other = occurrence(this, to.id)?.store;
      if (other && other !== this) other.flushJoinResults(seen);
    }
  }

  /** Preview pending script edits for display calculations without writing, committing or updating auto-enter fields. */
  previewRow(info: LayoutInfo, recordId: number, fields: FieldData): Record<string, SqlValue> {
    const row = { ...info.owner.row(info, recordId) };
    for (const f of info.owner.schema.tables.find((t) => t.name === info.table)?.fields ?? []) {
      if (f.options?.global || f.kind !== 'normal') continue;
      const repetitions = f.options?.repetitions ?? 1;
      if (repetitions > 1) {
        const values = typeof row[f.name] === 'string' && String(row[f.name]).startsWith('[') ? JSON.parse(String(row[f.name])) as SqlValue[] : [row[f.name] ?? null];
        for (let i = 0; i < repetitions; i++) {
          const key = i ? `${f.name}(${i + 1})` : f.name;
          if (key in fields) values[i] = info.owner.normalize(String(fields[key]), f.type);
        }
        row[f.name] = JSON.stringify(values);
      } else if (f.name in fields) row[f.name] = info.owner.normalize(String(fields[f.name]), f.type);
    }
    return row;
  }

  /** A record's stored values, by column. */
  row(info: LayoutInfo, recordId: number): Record<string, SqlValue> {
    const row = this.prepared(`SELECT * FROM ${q(info.table)} WHERE _fm_record_id = ?`).get(recordId) as Record<string, SqlValue> | undefined;
    if (!row) throw new StoreError(101, 'Record is missing');
    return row;
  }

  /**
   * A record's field data. `summaries: false` leaves summary fields empty
   * (they are computed over the whole table otherwise); `fields` reads only
   * those fields, with no portals, so unstored calculations elsewhere in the
   * record aren't computed. `edits` overlays one window's pending field data
   * for this read only, after record access checks, including in calculations.
   */
  get(...args: Parameters<Store['getCurrent']>): StoredRecord {
    return this.withDesignRead(() => this.getCurrent(...args));
  }

  private getCurrent(layout: string | LayoutInfo, recordId: number, dateFormat: DateFormat = 'us', portals?: PortalPaging, privileges?: Privileges, opts: { summaries?: boolean; fields?: string[]; layoutOnly?: boolean; fresh?: boolean; row?: Record<string, SqlValue>; edits?: FieldData; editKey?: object; account?: string } = {}): StoredRecord {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, privileges);
    if (info.owner !== this) return info.owner.get(info, recordId, dateFormat, portals, privileges, opts);
    let row = opts.row ?? this.row(info, recordId);
    const pv = this.local(privileges);
    if (pv) this.checkRecordRule(this.table(info), pv, 'view', 'view', row);
    // Check access on the saved row before overlaying a window's pending values.
    // Filtering also prevents hidden inputs from reaching a calculation.
    const edits = opts.edits && Object.fromEntries(Object.entries(opts.edits).filter(([key]) => !pv || pv.field(info.table, splitRep(key).name) !== 'none'));
    let edited: EditedRecord | undefined;
    if (edits && Object.keys(edits).length) {
      const cols = this.columns(info, edits, row, this.dateOrder, false);
      row = { ...row, ...Object.fromEntries(cols) };
      edited = this.calc.editedRecord({ store: this, table: this.table(info), row }, cols.keys(), opts.editKey, opts.account ?? privileges?.account, privileges);
    }
    if (opts.summaries === false || opts.fields) return this.toRecord(info, row, dateFormat, portals, undefined, privileges, opts.fields, opts.layoutOnly, opts.fresh, undefined, edited);
    const view = this.viewFilter(info, pv);
    const overrides = opts.row || edited ? new Map([[recordId, row]]) : undefined;
    const summaries = this.summaries(info, `SELECT * FROM ${q(info.table)} WHERE ${view.where}`, view.params, view.where === '1', opts.layoutOnly, privileges, opts.fresh || !!edited, overrides);
    if (summaries && this.table(info).fields.some((f) => f.summary?.running)) {
      const ids = (this.sql.prepare(`SELECT _fm_record_id AS id FROM ${q(info.table)} WHERE ${view.where} ORDER BY _fm_record_id`).all(...view.params) as { id: number }[]).map((r) => Number(r.id));
      summaries.running = this.runningSummaryValues(info, ids, [recordId], undefined, privileges, overrides);
    }
    return this.toRecord(info, row, dateFormat, portals, summaries, privileges, undefined, opts.layoutOnly, opts.fresh, undefined, edited);
  }

  /**
   * Records by id, in the order given, as get reads them, with summary
   * fields over `foundSet` (a script's found set) rather than the whole
   * table. Records that are missing or can't be viewed are left out.
   */
  getMany(...args: Parameters<Store['getManyCurrent']>): StoredRecord[] {
    return this.withDesignRead(() => this.getManyCurrent(...args));
  }

  private getManyCurrent(layout: string | LayoutInfo, ids: number[], foundSet: number[], opts: { dateFormat?: DateFormat; portals?: PortalPaging; privileges?: Privileges; layoutOnly?: boolean; fresh?: boolean; rows?: Map<number, Record<string, SqlValue>>;
    sort?: SortSpec[];
    /** Only these fields (no summaries are worked out unless one is named). */ fields?: string[] } = {}): StoredRecord[] {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges);
    if (info.owner !== this) return info.owner.getMany(info, ids, foundSet, opts);
    const pv = this.local(opts.privileges);
    const view = this.viewFilter(info, pv);
    const wantsSummary = !opts.fields || this.table(info).fields.some((f) => f.kind === 'summary' && opts.fields!.some((x) => x.toLowerCase() === f.name.toLowerCase()));
    const summaries = ids.length && wantsSummary
      ? this.summaries(info, `SELECT * FROM ${q(info.table)} WHERE _fm_record_id IN (SELECT value FROM json_each(?)) AND ${view.where}`, [JSON.stringify(foundSet), ...view.params], false, opts.layoutOnly, opts.privileges, opts.fresh, opts.rows, foundSet)
      : undefined;
    if (summaries && this.table(info).fields.some((f) => f.summary?.running)) summaries.running = this.runningSummaryValues(info, foundSet, ids, opts.sort, opts.privileges, opts.rows);
    const table = this.table(info);
    const owner = this;
    const foundForCalc = { foundSet: { table, recs: { *[Symbol.iterator](): Generator<Rec> {
      for (const rec of rowsById(owner, table, foundSet)) {
        const row = (opts.rows?.get(Number(rec.row._fm_record_id)) ?? rec.row) as Row;
        if (!pv || owner.allows(table, pv.table(info.table).view, row as Record<string, SqlValue>, pv.account)) yield { store: owner, table, row };
      }
    } } }, sums: new Map<string, Summed>(), sort: opts.sort };
    const out: StoredRecord[] = [];
    for (const id of ids) {
      const row = opts.rows?.get(id) ?? this.sql.prepare(`SELECT * FROM ${q(info.table)} WHERE _fm_record_id = ?`).get(id) as Record<string, SqlValue> | undefined;
      if (!row || (pv && !this.allows(this.table(info), pv.table(info.table).view, row, pv.account))) continue;
      out.push(this.toRecord(info, row, opts.dateFormat ?? 'us', opts.portals, summaries, opts.privileges, opts.fields, opts.layoutOnly, opts.fresh, foundForCalc));
    }
    return out;
  }

  /** Whether the account can view a record: the layout and record access checks of get, without reading it. */
  /** Whether an account may see a record of a base table (its table's view rule), for change feeds. A record that's gone counts as unseen unless the rule is plain. */
  canViewRecord(table: string, recordId: number, privileges?: Privileges): boolean {
    const pv = this.local(privileges);
    if (!pv) return true;
    const rule = pv.table(table).view;
    if (rule === true || rule === false) return rule;
    const t = this.schema.tables.find((x) => x.name === table);
    if (!t) return false;
    const row = this.sql.prepare(`SELECT * FROM ${q(table)} WHERE _fm_record_id = ?`).get(recordId) as Record<string, SqlValue> | undefined;
    return !!row && this.allows(t, rule, row, pv.account);
  }

  canView(layout: string | LayoutInfo, recordId: number, privileges?: Privileges): boolean {
    const info = this.layoutInfo(layout);
    try {
      this.checkLayout(info, privileges);
      if (info.owner !== this) return info.owner.canView(info, recordId, privileges);
      const row = this.row(info, recordId);
      const pv = this.local(privileges);
      return !pv || this.allows(this.table(info), pv.table(info.table).view, row, pv.account);
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof StoreError) return false;
      throw e;
    }
  }

  create(layout: string | LayoutInfo, data: FieldData = {}, opts: WriteOptions = {}): { recordId: number; modId: number } {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges);
    this.checkWriteFields(info, opts.privileges, fieldNames(data));
    this.checkLayout(info, opts.privileges, true);
    this.gateAgentWrite(opts, 'create', info, undefined, data, undefined);
    if (info.owner !== this) return info.owner.create(info, data, opts);
    this.joinTransaction();
    return this.withWriteTransaction(() => {
    const table = this.table(info);
    this.checkWrite(info, this.local(opts.privileges), fieldNames(data));
    if (opts.dataEntry) this.checkEntry(table, data);
    const cols = this.setGlobals(table, this.columns(info, data, undefined, opts.dateOrder));
    // New ids continue after the highest FileMaker record id, like FileMaker does.
    const next = Math.max((this.sql.prepare(`SELECT coalesce(max(_fm_record_id), 0) + 1 AS n FROM ${q(info.table)}`).get() as { n: number }).n,
      (this.heldNewIds.get(info.table) ?? 0) + 1);
    const row: Row = { _fm_record_id: next, _fm_mod_id: 0 };
    for (const f of info.fields) row[f.name] = null;
    for (const [k, v] of cols) row[k] = v;
    let lastVisited = opts.lastVisited !== undefined && table.fields.some((f) => f.options?.autoEnter?.lastVisited)
      ? this.sql.prepare(`SELECT * FROM ${q(info.table)} WHERE _fm_record_id = ?`).get(opts.lastVisited) as Row | undefined
      : undefined;
    // Only a record the account can see gives its values.
    const pv = this.local(opts.privileges);
    if (lastVisited && pv && !this.allows(table, pv.table(info.table).view, lastVisited as Record<string, SqlValue>, pv.account)) lastVisited = undefined;
    // A deleted record's id given again: its formatting isn't this record's (even with the same text).
    this.textStyles.forget(table.id, next);
    const calcRuns = new Map<string, StyleRun[] | undefined>();
    // A record made uncommitted (or with its required fields checked at its first commit) gets its on-commit serial then.
    this.write(() => this.calc.beforeWrite(table, row, new Set(cols.keys()), { isNew: true, account: opts.account, lastVisited, noValidation: opts.uncommitted, uncommitted: opts.uncommitted || opts.requiredAtCommit, requiredAtCommit: opts.requiredAtCommit, skipEntryValidation: opts.skipEntryValidation, performAutoEnter: opts.performAutoEnter, calcRuns, entered: data, overrideValidation: opts.dataEntry ? opts.overrideValidation : undefined }));
    const names = info.fields.map((f) => f.name).filter((n) => row[n] !== null && row[n] !== undefined);
    this.changeOne(table, next, undefined, () => this.sql
      .prepare(`INSERT INTO ${q(info.table)} (${['_fm_record_id', '_fm_mod_id', ...names.map(q)].join(', ')}) VALUES (?, 0${', ?'.repeat(names.length)})`)
      .run(next, ...names.map((n) => row[n] as SqlValue)));
    this.keepCalcRuns(table, next, row, calcRuns);
    this.audit('create', info.table, next, Object.fromEntries(names.map((n) => [n, row[n]])), opts);
    this.notify('create', info.table, next, 0);
    if (this.heldBy && this.heldBy === writer.getStore()?.transaction?.open) this.heldNewIds.set(info.table, next);
    return { recordId: next, modId: 0 };
    });
  }

  /**
   * A copy of a record, as FileMaker's Duplicate Record makes it: stored
   * values are copied (container files included), while serial numbers and
   * creation and modification values are entered anew and calculations
   * computed for the copy.
   */
  duplicate(layout: string | LayoutInfo, recordId: number, opts: WriteOptions = {}): { recordId: number; modId: number } {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges, true);
    if (info.owner !== this) return info.owner.duplicate(info, recordId, opts);
    this.joinTransaction();
    return this.withWriteTransaction(() => {
    const table = this.table(info);
    const current = this.row(info, recordId);
    const pv = this.local(opts.privileges);
    if (pv) this.checkRecordRule(table, pv, 'create', 'view', current);
    this.checkWrite(info, pv, []);
    const next = Math.max((this.sql.prepare(`SELECT coalesce(max(_fm_record_id), 0) + 1 AS n FROM ${q(info.table)}`).get() as { n: number }).n,
      (this.heldNewIds.get(info.table) ?? 0) + 1);
    const row: Row = { _fm_record_id: next, _fm_mod_id: 0 };
    const copied = new Set<string>();
    for (const f of info.fields) {
      const def = table.fields.find((x) => x.name === f.name);
      const fresh = !def || def.kind !== 'normal' || def.options?.global || def.options?.autoEnter?.serial || def.options?.autoEnter?.value;
      row[f.name] = fresh ? null : current[f.name] ?? null;
      if (row[f.name] !== null) copied.add(f.name);
    }
    const calcRuns = new Map<string, StyleRun[] | undefined>();
    this.write(() => this.calc.beforeWrite(table, row, copied, { isNew: true, account: opts.account, calcRuns }));
    const names = info.fields.map((f) => f.name).filter((n) => row[n] !== null && row[n] !== undefined);
    this.changeOne(table, next, undefined, () => this.sql
      .prepare(`INSERT INTO ${q(info.table)} (${['_fm_record_id', '_fm_mod_id', ...names.map(q)].join(', ')}) VALUES (?, 0${', ?'.repeat(names.length)})`)
      .run(next, ...names.map((n) => row[n] as SqlValue)));
    this.keepCalcRuns(table, next, row, calcRuns);
    this.audit('create', info.table, next, Object.fromEntries(names.map((n) => [n, row[n]])), opts, recordId);
    this.notify('create', info.table, next, 0);
    if (this.heldBy && this.heldBy === writer.getStore()?.transaction?.open) this.heldNewIds.set(info.table, next);
    return { recordId: next, modId: 0 };
    });
  }

  /** Sets a global field ("Occurrence::Field") for the current session, like the Data API's globals call. */
  setGlobalField(name: string, value: string | number, privileges?: Privileges, order: DateStyle = this.dateOrder): void {
    const m = /^(.+?)::(.+?)(?:\((\d+)\))?$/.exec(name);
    if (!m) throw new StoreError(102, `Field "${name}" is missing: name global fields as Table::Field`);
    const info = this.occurrence(m[1]);
    if (info.owner !== this) return info.owner.setGlobalField(`${info.table}::${m[2]}`, value, privileges, order);
    const table = this.table(info);
    const def = table.fields.find((f) => f.name === m[2]);
    if (!def) throw new StoreError(102, `Field "${name}" is missing`);
    if (!def.options?.global) throw new StoreError(102, `Field "${name}" is not a global field`);
    const pv = this.local(privileges);
    if (pv && pv.field(info.table, def.name) === 'none') throw new StoreError(102, `Field "${name}" is missing`);
    const v = typeof value === 'number' ? value : this.normalize(String(value), def.type, order);
    this.joinTransaction();
    this.withWriteTransaction(() => this.calc.setGlobal(table, def, v));
  }

  update(layout: string | LayoutInfo, recordId: number, data: FieldData, modId?: number, opts: WriteOptions = {}, retry = 0): { modId: number } {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges);
    this.checkWriteFields(info, opts.privileges, fieldNames(data));
    this.checkLayout(info, opts.privileges, true);
    this.gateAgentWrite(opts, 'update', info, recordId, data, modId);
    // Related fields ("TO::Field") go to the first related record, as in FileMaker.
    const own: FieldData = {};
    const related = new Map<string, FieldData>();
    for (const [k, v] of Object.entries(data)) {
      const m = /^(.+?)::(.+)$/.exec(k);
      if (m && info.home && m[1] !== info.occurrence) {
        if (!related.has(m[1])) related.set(m[1], {});
        related.get(m[1])![m[2]] = v;
      } else own[k] = m ? m[2] : v;
    }
    if (related.size && info.home) {
      const row = info.owner.row(info, recordId);
      // Formatting given as "TO::Field" goes with that related field to the related record; a bare name is the record's own.
      for (const [to, values] of related) {
        const given = opts.styles && Object.entries(opts.styles).filter(([k]) => k.startsWith(`${to}::`)).map(([k, runs]) => [k.slice(to.length + 2), runs] as const);
        info.home.updateRelated(info, row, to, values, { ...opts, styles: given?.length ? Object.fromEntries(given) : undefined });
      }
    }
    if (!Object.keys(own).length && related.size) return { modId: Number(info.owner.row(info, recordId)._fm_mod_id) };
    if (opts.styles && related.size) {
      // What is left is the record's own: without the related fields' formatting, which went with them.
      const mine = Object.entries(opts.styles).filter(([k]) => ![...related.keys()].some((to) => k.startsWith(`${to}::`)));
      opts = { ...opts, styles: Object.fromEntries(mine) };
    }
    if (info.owner !== this) return info.owner.update(info, recordId, own, modId, opts);
    data = own;
    this.joinTransaction();
    return this.withWriteTransaction(() => {
    this.checkLock(info.table, recordId);
    const current = this.row(info, recordId);
    if (modId !== undefined && Number(current._fm_mod_id) !== modId) {
      throw new StoreError(306, 'Record modification id does not match');
    }
    this.checkWrite(info, this.local(opts.privileges), fieldNames(data), current);
    const table = this.table(info);
    if (opts.dataEntry) this.checkEntry(table, data);
    const styled = opts.styles ? this.styledFields(table, data, opts.styles) : undefined;
    const cols = this.setGlobals(table, this.columns(info, data, current, opts.dateOrder));
    const row: Row = { ...(current as Row) };
    for (const [k, v] of cols) row[k] = v;
    // The formatting is written with the record in one step: both or neither.
    const styling = !!styled?.size || this.textStyles.has(table.id);
    const step = styling && !this.sql.isTransaction ? `styles_${++this.trials}` : undefined;
    if (step) this.sql.exec(`SAVEPOINT ${step}`);
    const undo = () => {
      if (step) this.sql.exec(`ROLLBACK TO ${step}; RELEASE ${step}`);
      this.textStyles.reset();
    };
    let restyled: string[] = [];
    let diff: string[];
    const calcRuns = new Map<string, StyleRun[] | undefined>();
    try {
      // Before the record's calculations run, so a stored GetAsCSS ( Notes ) sees the new formatting.
      if (styling) restyled = this.restyle(table, recordId, current as Row, row, styled, !!opts.dataEntry);
      const typed = { ...row };
      calcRuns.clear();
      this.write(() => this.calc.beforeWrite(table, row, new Set(cols.keys()), { isNew: false, account: opts.account, previous: current as Row, noValidation: opts.restoring, required: opts.firstCommit, firstCommit: opts.firstCommit, skipEntryValidation: opts.skipEntryValidation, performAutoEnter: opts.performAutoEnter, calcRuns, entered: data, overrideValidation: opts.dataEntry ? opts.overrideValidation : undefined, editKey: opts.editKey }));
      // An auto-enter that replaced formatted text: the formatting no longer fits it.
      for (const n of restyled) {
        if (row[n] === typed[n]) continue;
        const f = table.fields.find((x) => x.name === n)!;
        for (let r = 1; r <= repetitionsOf(f); r++) {
          const text = this.keptText(f, row[n], r);
          if (text !== this.keptText(f, typed[n], r)) this.textStyles.write(table.id, recordId, f.id, text ?? '', undefined, r);
        }
      }
      const changed = info.fields.map((f) => f.name).filter((n) => cols.has(n) || row[n] !== current[n]);
      const sets = changed.map((n) => `${q(n)} = ?`);
      // Only if nobody saved it since it was read: another server process can, between the two.
      const { changes } = this.changeOne(table, recordId, current as Row, () => this
        .prepared(`UPDATE ${q(info.table)} SET ${['_fm_mod_id = _fm_mod_id + 1', ...sets].join(', ')} WHERE _fm_record_id = ? AND _fm_mod_id = ?`)
        .run(...changed.map((n) => row[n] as SqlValue), recordId, current._fm_mod_id as SqlValue));
      if (!changes) {
        undo();
        // Without a modId the caller doesn't mind what it was: compute it again on the new one.
        if (modId !== undefined || retry >= 5) throw new StoreError(306, 'Record modification id does not match');
        return this.update(info, recordId, data, undefined, opts, retry + 1);
      }
      diff = changed.filter((n) => row[n] !== current[n]);
    } catch (e) {
      if (step && this.sql.isTransaction) undo();
      throw e;
    }
    if (step) this.sql.exec(`RELEASE ${step}`);
    restyled.push(...this.keepCalcRuns(table, recordId, row, calcRuns));
    if (diff.length) this.audit('update', info.table, recordId, Object.fromEntries(diff.map((n) => [n, [current[n] ?? null, row[n] ?? null]])), opts);
    this.notify('update', info.table, recordId, Number(current._fm_mod_id) + 1, undefined, [...new Set([...diff, ...restyled])]);
    return { modId: Number(current._fm_mod_id) + 1 };
    });
  }

  /**
   * Keeps the formatting stored text calculations' formulas gave them (TextStyleAdd, TextColor...), as unstored
   * ones show it; returns the fields whose kept formatting changed.
   */
  private keepCalcRuns(table: Table, recordId: number, row: Row, calcRuns: Map<string, StyleRun[] | undefined>): string[] {
    const out: string[] = [];
    if (!calcRuns.size) return out;
    const has = this.textStyles.has(table.id);
    for (const [name, runs] of calcRuns) {
      const f = table.fields.find((x) => x.name === name);
      if (!f || !this.keepsFormatting(f) || (!runs?.length && !has)) continue;
      this.textStyles.write(table.id, recordId, f.id, String(row[name] ?? ''), runs);
      out.push(name);
    }
    return out;
  }

  /** Fields whose formatting is kept with the record: formattable text fields, and stored text calculations. */
  private keepsFormatting(f: Table['fields'][number]): boolean {
    return this.formattable(f) || (f.kind === 'calculation' && f.type === 'text' && !f.options?.unstored && !f.options?.global && (f.options?.repetitions ?? 1) <= 1);
  }

  /** Text fields formatting can be kept for: stored, one repetition. */
  private formattable(f: Table['fields'][number]): boolean {
    return f.kind === 'normal' && f.type === 'text' && !f.options?.global;
  }

  /** The text of one repetition (1 for a field without repetitions) of a stored value, for the formatting kept with it. */
  private keptText(f: Table['fields'][number], raw: unknown, rep: number): string | undefined {
    return repetitionText(raw, repetitionsOf(f), rep);
  }

  /**
   * The fields of an update's `styles`, checked: each a formattable text field (or one of its repetitions, as
   * "Notes(2)") whose value is written with it. Keyed by field name, "(n)" added past the first repetition.
   */
  private styledFields(table: Table, data: FieldData, styles: Record<string, StyleRun[]>): Map<string, StyleRun[]> {
    const out = new Map<string, StyleRun[]>();
    // Read as a write's keys are (columns): "Notes(2)" is repetition 2 of Notes when there is a Notes.
    const find = (n: string) => table.fields.find((x) => x.name.toLowerCase() === n.toLowerCase());
    const split = (key: string) => {
      const s = splitRep(key);
      return s.name !== key && find(s.name) ? s : { name: key, rep: 1 };
    };
    const given = Object.keys(data).map(split);
    for (const [name, runs] of Object.entries(styles)) {
      const { name: base, rep } = split(name);
      const f = find(base);
      if (!f) throw new StoreError(102, `Field "${name}" is missing`);
      if (!this.formattable(f)) throw new StoreError(201, `Field "${name}" can't keep formatting`);
      if (rep < 1 || rep > repetitionsOf(f)) throw new StoreError(102, `Field "${name}" is missing`);
      if (!given.some((g) => g.rep === rep && g.name.toLowerCase() === f.name.toLowerCase())) throw new StoreError(102, `Formatting for "${name}" needs its value too`);
      out.set(repKey(f.name, rep), runs);
    }
    return out;
  }

  /** Updates the formatting kept with an updated record's text fields; returns the fields whose formatting changed. */
  private restyle(table: Table, recordId: number, before: Row, after: Row, styled: Map<string, StyleRun[]> | undefined, typing: boolean): string[] {
    const has = this.textStyles.has(table.id);
    if (!styled?.size && !has) return [];
    const was = has ? this.textStyles.read(table.id, recordId, (id, r) => {
      const f = table.fields.find((x) => x.id === id);
      return f ? this.keptText(f, before[f.name], r) ?? '' : undefined;
    }) : undefined;
    const out: string[] = [];
    for (const f of table.fields) {
      if (!this.formattable(f)) continue;
      for (let r = 1; r <= repetitionsOf(f); r++) {
        const text = this.keptText(f, after[f.name], r) ?? '';
        const prior = this.keptText(f, before[f.name], r) ?? '';
        const given = styled?.get(repKey(f.name, r));
        const old = was?.find((k) => k.field === f.id && k.rep === r)?.runs;
        if (given) this.textStyles.write(table.id, recordId, f.id, text, given, r);
        else if (old && text !== prior) this.textStyles.write(table.id, recordId, f.id, text, typing ? editRuns(old, prior, text) : undefined, r);
        else continue;
        if (!out.includes(f.name)) out.push(f.name);
      }
    }
    return out;
  }

  /**
   * Sets a stored calculation's value on records directly, for bringing an
   * out-of-date stored value up to date (or putting it back): no auto-enter,
   * no validation, and the modification timestamp stays as it was, since
   * nobody edited the record. Only where the field still holds `expect`;
   * records in use or changed since are skipped and returned. Logged and
   * announced like any change.
   */
  setStoredCalcValues(table: string, field: string, values: { recordId: number; value: SqlValue; expect: SqlValue }[], opts: WriteOptions = {}): { set: number; skipped: number[] } {
    const t = this.schema.tables.find((x) => x.name.toLowerCase() === table.toLowerCase());
    const f = t?.fields.find((x) => x.name.toLowerCase() === field.toLowerCase());
    if (!t || !f) throw new StoreError(102, `Field "${table}::${field}" is missing`);
    if (f.kind !== 'calculation' || f.options?.unstored || f.options?.global) throw new StoreError(102, `"${t.name}::${f.name}" is not a stored calculation`);
    this.joinTransaction();
    const read = this.sql.prepare(`SELECT ${q(f.name)} AS v, _fm_mod_id AS m FROM ${q(t.name)} WHERE _fm_record_id = ?`);
    const write = this.sql.prepare(`UPDATE ${q(t.name)} SET _fm_mod_id = _fm_mod_id + 1, ${q(f.name)} = ? WHERE _fm_record_id = ?`);
    let set = 0;
    const skipped: number[] = [];
    for (const { recordId, value, expect } of values) {
      const now = read.get(recordId) as { v: SqlValue; m: number } | undefined;
      const lock = this.locks.holder(t.name, recordId);
      if (!now || (lock && lock.owner !== writer.getStore()?.owner) || String(now.v ?? '') !== String(expect ?? '')) { skipped.push(recordId); continue; }
      if (String(now.v ?? '') === String(value ?? '')) continue;
      write.run(value, recordId);
      this.audit('update', t.name, recordId, { [f.name]: [now.v ?? null, value ?? null] }, opts);
      this.notify('update', t.name, recordId, Number(now.m) + 1, undefined, [f.name]);
      set++;
    }
    return { set, skipped };
  }

  /** "Prohibit modification of value during data entry": only auto-enter and scripts set these fields. */
  private checkEntry(table: Table, data: FieldData): void {
    for (const name of fieldNames(data)) {
      const f = table.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (f?.options?.autoEnter?.prohibitModification) throw new StoreError(201, `Field "${f.name}" cannot be modified`);
    }
  }

  /** Global fields are kept once per file, not per record. Returns the other columns. */
  private setGlobals(table: Table, cols: Map<string, SqlValue>): Map<string, SqlValue> {
    for (const f of table.fields) {
      if (!f.options?.global || !cols.has(f.name)) continue;
      this.calc.setGlobal(table, f, cols.get(f.name)!);
      cols.delete(f.name);
    }
    return cols;
  }

  /** Run write-time rules, turning a failed validation into the Data API's error. */
  private write(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof ValidationError) {
        const error = new StoreError(e.code, e.message);
        error.validationField = e.field;
        throw error;
      }
      throw e;
    }
  }

  /** Assignments in this evaluation take precedence over inherited script/window variables. */
  private evaluationVariables(ctx: CalcContext, opts: EvaluateOptions): CalcContext {
    const values = new Map<string, Value>();
    const read = ctx.variable;
    const write = ctx.setVariable;
    const key = (name: string, rep: number) => JSON.stringify([name.toLowerCase(), rep]);
    ctx.variable = (name, rep) => values.get(key(name, rep)) ?? opts.variable?.(name, rep) ?? read?.(name, rep);
    ctx.setVariable = (name, rep, value) => {
      values.set(key(name, rep), value);
      write?.(name, rep, value);
      if (name.startsWith('$$')) opts.setVariable?.(name, rep, value);
    };
    return ctx;
  }

  /**
   * Evaluate a formula in a layout's context, on one of its records or on no
   * record. Throws StoreError with FileMaker's calculation error code.
   */
  evaluate(...args: Parameters<Store['evaluateCurrent']>): { value: string; type: Value['type'] } {
    return this.withDesignRead(() => this.evaluateCurrent(...args));
  }

  private evaluateCurrent(layout: string | LayoutInfo, formula: string, recordId?: number, opts: EvaluateOptions = {}): { value: string; type: Value['type'] } {
    const info = this.layoutInfo(layout);
    const to = this.calc.occurrence(info.occurrence);
    if (!to) throw new StoreError(105, `Layout "${info.name}" has no table occurrence`);
    const owner = info.owner;
    const table = owner.schema.tables.find((t) => t.name === info.table)!;
    const rec = recordId === undefined ? undefined : { store: owner, table, row: (opts.row ?? owner.row(info, recordId)) as Row };
    const ctx = this.calc.context(rec, to.id, this.calc.newPass(opts.account, opts.privileges));
    if (opts.get) {
      const baseGet = ctx.get;
      ctx.get = (name) => opts.get!(name) ?? baseGet?.(name);
    }
    this.evaluationVariables(ctx, opts);
    try {
      const v = evaluateFormula(formula, ctx);
      return { value: asText(v, this.dateOrder), type: v.type };
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof CalcError) throw new StoreError(e.code, e.message);
      throw e;
    }
  }

  /**
   * Evaluates several formulas in a layout's context on one record (or none),
   * as a screen would: `get` answers Get ( ) values only a window knows
   * (WindowMode, FoundCount, ...), `variable` reads $$variables. A formula
   * that fails gives undefined instead of throwing.
   */
  evaluateEach(...args: Parameters<Store['evaluateEachCurrent']>): (Value | undefined)[] {
    return this.withDesignRead(() => this.evaluateEachCurrent(...args));
  }

  private evaluateEachCurrent(layout: string | LayoutInfo, formulas: string[], recordId?: number, opts: EvaluateOptions = {}): (Value | undefined)[] {
    const info = this.layoutInfo(layout);
    const to = this.calc.occurrence(info.occurrence);
    if (!to) return formulas.map(() => undefined);
    const owner = info.owner;
    const table = owner.schema.tables.find((t) => t.name === info.table);
    if (!table) return formulas.map(() => undefined);
    let rec: Rec | undefined;
    try {
      rec = recordId === undefined ? undefined : { store: owner, table, row: (opts.row ?? owner.row(info, recordId)) as Row };
    } catch (e) {
      rethrowExecutionRefusal(e);
      return formulas.map(() => undefined);
    }
    const ctx = this.calc.context(rec, to.id, this.calc.newPass(opts.account, opts.privileges));
    const baseGet = ctx.get;
    ctx.get = (name) => opts.get?.(name) ?? baseGet?.(name);
    this.evaluationVariables(ctx, opts);
    return formulas.map((formula) => {
      try {
        return evaluateFormula(formula, ctx);
      } catch (e) {
        rethrowExecutionRefusal(e);
        return undefined;
      }
    });
  }

  /**
   * Formulas evaluated for a chart: on each record of a found set (`ids`), or
   * on each record related to `recordId` through table occurrence `related`.
   * Summary fields cover the found set; with `groupBy` (the index of a
   * formula), consecutive records with the same value of that formula form one
   * row, evaluated on the run's first record with summaries over the run.
   */
  evaluateRows(...args: Parameters<Store['evaluateRowsCurrent']>): (Value | undefined)[][] {
    return this.withDesignRead(() => this.evaluateRowsCurrent(...args));
  }

  private evaluateRowsCurrent(layout: string | LayoutInfo, formulas: string[], rows: { ids?: number[]; recordId?: number; related?: string; groupBy?: number }, opts: EvaluateOptions & { onRead?: (store: Store, table: string, ids: number[]) => void } = {}): (Value | undefined)[][] {
    const info = this.layoutInfo(layout);
    const self = this.calc.occurrence(info.occurrence);
    const owner = info.owner;
    const table = owner.schema.tables.find((t) => t.name === info.table);
    if (!self || !table) return [];
    const pass = this.calc.newPass(opts.account, opts.privileges);
    // The caller can audit chart source rows without logging internal calculation reads.
    const readIds = opts.onRead ? [] as number[] : undefined;
    const each = (rec: Rec, toId: number, p: Pass) => {
      const ctx = this.calc.context(rec, toId, p);
      const baseGet = ctx.get;
      ctx.get = (name) => opts.get?.(name) ?? baseGet?.(name);
      this.evaluationVariables(ctx, opts);
      return formulas.map((formula) => {
        try {
          return evaluateFormula(formula, ctx);
        } catch (e) {
          rethrowExecutionRefusal(e);
          return undefined;
        }
      });
    };
    if (rows.related !== undefined) {
      if (rows.recordId === undefined) return [];
      const to = this.calc.occurrence(rows.related);
      const target = to && this.calc.occurrenceTable(to.id);
      if (!to || !target) return [];
      const pv = target.store.local(opts.privileges);
      const rule = pv?.table(target.table.name).view ?? true;
      if (rule === false) return [];
      const rec = { store: owner, table, row: (opts.row ?? opts.rows?.get(rows.recordId) ?? owner.row(info, rows.recordId)) as Row };
      const out: (Value | undefined)[][] = [];
      for (const r of this.calc.relatedRecs(rec, self.id, to.id, pass)) {
        checkMemory();
        if (rule === true || target.store.allows(target.table, rule, r.row as Record<string, SqlValue>, pv!.account)) {
          out.push(each(r, to.id, this.calc.newPass(opts.account, opts.privileges)));
          readIds?.push(Number(r.row._fm_record_id));
        }
      }
      if (readIds) opts.onRead!(target.store, target.table.name, readIds);
      return out;
    }
    // The found set is read in batches as it is used (and again for its summaries), never held whole.
    const found = (ids: number[]): Iterable<Rec> => ({ *[Symbol.iterator]() {
      for (const rec of rowsById(owner, table, ids)) {
        const row = opts.rows?.get(Number(rec.row._fm_record_id));
        yield row ? { ...rec, row: row as Row } : rec;
      }
    } });
    const ids = rows.ids ?? [];
    pass.foundSet = { table, recs: found(ids) };
    pass.sums = new Map();
    // Each record is worked out in a pass of its own that shares the found set's summaries.
    const own = (p: Pass): Pass => ({ ...this.calc.newPass(opts.account, opts.privileges), foundSet: p.foundSet, sums: p.sums });
    const out: (Value | undefined)[][] = [];
    if (rows.groupBy === undefined) {
      for (const r of found(ids)) {
        checkMemory();
        out.push(each(r, self.id, own(pass)));
        readIds?.push(Number(r.row._fm_record_id));
      }
      if (readIds) opts.onRead!(owner, table.name, readIds);
      return out;
    }
    const key = (r: Rec) => {
      try {
        return asText(evaluateFormula(formulas[rows.groupBy!], this.evaluationVariables(this.calc.context(r, self.id, own(pass)), opts)), this.dateOrder).toLowerCase();
      } catch (e) {
        rethrowExecutionRefusal(e);
        return '';
      }
    };
    // Runs of consecutive records with the same key: only their ids are kept while reading.
    let run: number[] = [];
    let runKey: string | undefined;
    const flush = () => {
      if (!run.length) return;
      const first = [...found(run.slice(0, 1))][0];
      if (first) out.push(each(first, self.id, { ...this.calc.newPass(opts.account, opts.privileges), foundSet: { table, recs: found(run) }, sums: new Map() }));
      run = [];
    };
    for (const r of found(ids)) {
      checkMemory();
      const k = key(r);
      if (k !== runKey) flush();
      runKey = k;
      run.push(Number(r.row._fm_record_id));
      readIds?.push(Number(r.row._fm_record_id));
    }
    flush();
    if (readIds) opts.onRead!(owner, table.name, readIds);
    return out;
  }

  private related(info: LayoutInfo, toName: string): { occ: Occurrence; from: number } {
    const to = occurrenceByName(this, toName);
    const from = occurrenceByName(this, info.occurrence);
    const occ = to && occurrence(this, to.id);
    if (!to || !from || !occ) throw new StoreError(102, `Table occurrence "${toName}" is missing`);
    return { occ, from: from.id };
  }

  private updateRelated(info: LayoutInfo, row: Record<string, SqlValue>, toName: string, values: FieldData, opts: WriteOptions = {}): void {
    const { occ, from } = this.related(info, toName);
    const first = relatedRows(this, from, row, occ.to.id, { limit: 1 })?.rows[0];
    if (!first) throw new StoreError(101, `No related record in "${toName}"`);
    occ.store.update(this.occurrenceInfo(occ), Number(first._fm_record_id), values, undefined, opts);
  }

  /**
   * Edits, adds and deletes portal rows of a record (Data API portalData and
   * deleteRelated). Rows without a recordId are new related records; their
   * match fields are filled in from the parent record. Returns the related records it created.
   */
  updatePortals(layout: string | LayoutInfo, recordId: number, portalData: Record<string, Record<string, string | number>[]>, deleteRelated: string[] = [], opts: WriteOptions = {},
    portalStyles?: Record<string, Record<string, Record<string, StyleRun[]>>>): { portal: string; recordId: number; modId: number }[] {
    const created: { portal: string; recordId: number; modId: number }[] = [];
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges, true);
    this.refuseIfGated(opts, 'portal edits');
    const plan = info.plan;
    if (!plan) throw new StoreError(102, 'This layout has no portals');
    const row = info.owner.row(info, recordId);
    const rowsOf = new Map<number, Set<number>>();
    const portal = (name: string) => {
      const p = plan.portals.find((x) => x.name === name || x.occurrence === name);
      const occ = p && occurrence(this, p.occurrenceId);
      if (!p || !occ) throw new StoreError(102, `Portal "${name}" is missing`);
      // Only the record's own related rows can be edited or deleted through its portal, as in FileMaker.
      const related = (rid: number) => {
        let ids = rowsOf.get(p.occurrenceId);
        if (!ids) rowsOf.set(p.occurrenceId, (ids = new Set(relatedIdList(this, plan.occurrenceId, row, p.occurrenceId)?.ids ?? [])));
        if (!ids.has(rid)) throw new StoreError(101, `Record ${rid} is not a row of portal "${name}" for this record`);
      };
      return { p, occ, rinfo: this.occurrenceInfo(occ), related };
    };
    for (const [name, rows] of Object.entries(portalData)) {
      const { p, occ, rinfo, related } = portal(name);
      for (const r of rows) {
        const values: FieldData = {};
        // Fields of records related to the row (not the portal's own table), by occurrence.
        const further = new Map<string, FieldData>();
        let rid: number | undefined;
        let modId: number | undefined;
        for (const [k, v] of Object.entries(r)) {
          if (k === 'recordId') rid = Number(v);
          else if (k === 'modId') modId = Number(v);
          else if (k.includes('::') && k.slice(0, k.indexOf('::')) !== p.occurrence) {
            const to = k.slice(0, k.indexOf('::'));
            further.set(to, { ...further.get(to), [k.slice(k.indexOf('::') + 2)]: v });
          } else values[k.includes('::') ? k.slice(k.indexOf('::') + 2) : k] = v;
        }
        if (further.size && rid === undefined) throw new StoreError(102, `New rows in portal "${name}" can only set its own fields`);
        if (rid !== undefined) related(rid);
        for (const [to, data] of further) {
          const rel = p.related?.find((x) => x.occurrence === to);
          if (!rel) throw new StoreError(102, `Field "${to}::${Object.keys(data)[0]}" is not in portal "${name}"`);
          const portalRow = occ.store.row(rinfo, rid!);
          const one = relatedRows(this, p.occurrenceId, portalRow, rel.occurrenceId, { limit: 1 });
          if (!one?.rows[0]) throw new StoreError(101, `Row ${rid} of portal "${name}" has no related ${to} record`);
          one.occurrence.store.update(this.occurrenceInfo(one.occurrence), Number(one.rows[0]._fm_record_id), data, undefined, opts);
        }
        if (rid !== undefined && !Object.keys(values).length) continue;
        if (rid !== undefined) {
          // Formatting from the Format menu in this row: by "TO::Field", for the row's own fields.
          const given = portalStyles?.[name]?.[String(rid)];
          const styles = given && Object.fromEntries(Object.entries(given).map(([k, runs]) => [k.includes('::') ? k.slice(k.indexOf('::') + 2) : k, runs]));
          occ.store.update(rinfo, rid, values, modId, styles ? { ...opts, styles } : opts);
        } else {
          const keys = relatedKeys(this, plan.occurrenceId, row, p.occurrenceId);
          if (!keys) throw new StoreError(102, `Cannot create records through portal "${name}"`);
          // The match fields are filled in, not typed: "prohibit modification" doesn't stop them.
          const made = occ.store.create(rinfo, { ...values, ...Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v ?? ''])) }, { ...opts, dataEntry: false });
          created.push({ portal: p.name, recordId: made.recordId, modId: made.modId });
        }
      }
    }
    for (const d of deleteRelated) {
      const m = /^(.+)\.(\d+)$/.exec(d);
      if (!m) throw new StoreError(102, `deleteRelated "${d}" should be "portal.recordId"`);
      const { occ, rinfo, related } = portal(m[1]);
      related(Number(m[2]));
      occ.store.delete(rinfo, Number(m[2]), opts);
    }
    return created;
  }

  /**
   * Puts a file in (or, with null, empties) a container field of a row of one of the record's portals: the related
   * record must be one of the record's own portal rows, as updatePortals requires, and the file goes in under the
   * account's privileges for the related table.
   */
  setPortalContainer(layout: string | LayoutInfo, recordId: number, portalName: string, portalRecordId: number, field: string, repetition: number,
    file: ContainerFile | null, opts: WriteOptions = {}): { modId: number } {
    const t = this.portalContainerTarget(layout, recordId, portalName, portalRecordId, field, opts);
    return t.store.setContainer(t.info, portalRecordId, t.field, repetition, file, opts);
  }

  /** Throws what setPortalContainer would throw, without changing anything: an upload is turned away before its bytes are read. */
  checkPortalContainerWrite(layout: string | LayoutInfo, recordId: number, portalName: string, portalRecordId: number, field: string, repetition: number,
    opts: WriteOptions = {}): void {
    const t = this.portalContainerTarget(layout, recordId, portalName, portalRecordId, field, opts);
    t.store.checkContainerWrite(t.info, portalRecordId, t.field, repetition, opts);
  }

  /** The related table's store, layout info and field name for a container in a portal row; the row must be one of the record's own. */
  private portalContainerTarget(layout: string | LayoutInfo, recordId: number, portalName: string, portalRecordId: number, field: string, opts: WriteOptions): { store: Store; info: LayoutInfo; field: string } {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges, true);
    const plan = info.plan;
    const p = plan?.portals.find((x) => x.name === portalName || x.occurrence === portalName);
    const occ = p && occurrence(this, p.occurrenceId);
    if (!plan || !p || !occ) throw new StoreError(102, `Portal "${portalName}" is missing`);
    const row = info.owner.row(info, recordId);
    if (!(relatedIdList(this, plan.occurrenceId, row, p.occurrenceId)?.ids ?? []).includes(portalRecordId)) {
      throw new StoreError(101, `Record ${portalRecordId} is not a row of portal "${portalName}" for this record`);
    }
    // The field may be named as the layout shows it, Occurrence::Field.
    const own = field.startsWith(`${p.occurrence}::`) ? field.slice(p.occurrence.length + 2) : field;
    return { store: occ.store, info: this.occurrenceInfo(occ), field: own };
  }

  /** Throws unless the account may edit this record through this layout (a record lock is a promise to edit). */
  checkEditable(layout: string | LayoutInfo, recordId: number, privileges?: Privileges): void {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, privileges, true);
    if (info.owner !== this) return info.owner.checkEditable(info, recordId, privileges);
    const row = this.row(info, recordId);
    const pv = this.local(privileges);
    if (!pv) return;
    const table = this.table(info);
    this.checkRecordRule(table, pv, 'edit', 'view', row);
    this.checkRecordRule(table, pv, 'edit', 'edit', row);
  }

  /** Whether the account may see any records of a table in this file (for change events). */
  tableVisible(table: string, privileges?: Privileges): boolean {
    const pv = this.local(privileges);
    return !pv || pv.table(table).view !== false;
  }

  delete(layout: string | LayoutInfo, recordId: number, opts: WriteOptions = {}): void {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges, true);
    this.gateAgentWrite(opts, 'delete', info, recordId, undefined, undefined);
    if (info.owner !== this) return info.owner.delete(info, recordId, opts);
    this.joinTransaction();
    this.checkLock(info.table, recordId);
    const pv = this.local(opts.privileges);
    if (pv) {
      const row = this.row(info, recordId);
      const table = this.table(info);
      this.checkRecordRule(table, pv, 'delete', 'view', row);
      this.checkRecordRule(table, pv, 'delete', 'delete', row);
    }
    const before = this.sql.prepare(`SELECT * FROM ${q(info.table)} WHERE _fm_record_id = ?`).get(recordId) as Record<string, SqlValue> | undefined;
    if (before && opts.cascade !== false) this.cascadeDelete(info.table, recordId, before, opts);
    const res = this.changeOne(this.table(info), recordId, before as Row | undefined, () => this.sql.prepare(`DELETE FROM ${q(info.table)} WHERE _fm_record_id = ?`).run(recordId));
    if (res.changes === 0) throw new StoreError(101, 'Record is missing');
    this.textStyles.forget(this.table(info).id, recordId);
    if (before) this.forgetStandInValues(this.table(info), [before]);
    this.audit('delete', info.table, recordId, before && Object.fromEntries(Object.entries(before).filter(([k, v]) => !k.startsWith('_fm_') && v !== null)), opts);
    const lock = this.locks.holder(info.table, recordId);
    if (lock && this.locks.release(info.table, recordId, lock.owner)) {
      // Said before the delete: a window that marked the record locked would otherwise keep the mark, and a record made
      // later under the same id (the highest id is used again) would show as locked by someone who is not editing it.
      this.notify('unlock', info.table, recordId, undefined, { account: lock.account, owner: lock.owner });
    }
    this.notify('delete', info.table, recordId);
  }

  /**
   * Personal-data isolation keeps every value a model was shown in the file (_fm_pii_vault), for each account. When the
   * records holding those values are deleted the values go too: the whole values of their stored fields, as the Data
   * API shows them (dates in either format) and as stored. A value found inside longer text, or worked out by an
   * unstored calculation, is not matched here and stays until its account is deleted or isolation is turned off.
   */
  private vaultHeld(): boolean {
    return this.hasTable('_fm_pii_vault') && !!this.sql.prepare('SELECT 1 FROM _fm_pii_vault LIMIT 1').get();
  }

  private forgetStandInValues(table: Table, rows: Record<string, SqlValue>[]): void {
    // Nothing to do (and nothing to read) in the usual file: no vault, or one emptied when isolation was turned off.
    if (!this.vaultHeld()) return;
    // Looked up by value, so a file whose vault predates the index gets it now rather than scanning the vault for every record.
    this.sql.exec('CREATE INDEX IF NOT EXISTS _fm_pii_vault_value ON _fm_pii_vault (value)');
    const gone = new Set<string>();
    const add = (v: unknown, type: FieldType) => {
      if (type === 'container' || (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'bigint') || v === '') return;
      gone.add(String(v));
      if (typeof v === 'string') gone.add(String(this.present(v, type, 'us')));
    };
    const reps = new Set(this.repeating[table.name] ?? []);
    for (const row of rows) {
      for (const f of table.fields) {
        const v = row[f.name];
        add(v, f.type);
        // A repeating field is stored as a list; the API (and so the vault) has each repetition on its own.
        if ((reps.has(f.name) || (f.options?.repetitions ?? 1) > 1) && typeof v === 'string' && v.startsWith('[')) {
          try {
            const list = JSON.parse(v);
            if (Array.isArray(list)) for (const x of list) add(x, f.type);
          } catch { /* not a list */ }
        }
      }
    }
    if (gone.size) this.sql.prepare('DELETE FROM _fm_pii_vault WHERE value IN (SELECT value FROM json_each(?))').run(JSON.stringify([...gone]));
  }

  /**
   * Puts a deleted record back as it was, under its own id (undoing a merge of duplicates): `row` is the record's
   * row as it was read before the delete. Fails when its id has been used again since.
   */
  restoreDeletedRow(table: string, row: Record<string, SqlValue>, opts: WriteOptions = {}): void {
    this.joinTransaction();
    if (!this.schema.tables.some((t) => t.name === table)) throw new StoreError(106, `Table "${table}" is missing`);
    const pv = this.local(opts.privileges);
    if (pv && pv.table(table).create !== true) throw new StoreError(200, 'Record access is denied', pv.recordDenial(table, 'create', 'create'));
    const id = Number(row._fm_record_id);
    if (!Number.isInteger(id)) throw new StoreError(101, 'Record is missing');
    if (this.sql.prepare(`SELECT 1 FROM ${q(table)} WHERE _fm_record_id = ?`).get(id)) throw new StoreError(504, `Record ${id} of ${table} can't be put back: a record has that id again`);
    const columns = new Set((this.sql.prepare(`PRAGMA table_info(${q(table)})`).all() as { name: string }[]).map((c) => c.name));
    const names = Object.keys(row).filter((k) => columns.has(k));
    this.sql.prepare(`INSERT INTO ${q(table)} (${names.map(q).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((n) => row[n]));
    this.audit('create', table, id, Object.fromEntries(names.filter((n) => !n.startsWith('_fm_') && row[n] !== null).map((n) => [n, row[n]])), opts);
    this.notify('create', table, id, Number(row._fm_mod_id ?? 0));
  }

  /** Records being deleted by cascades now, so a cycle of relationships stops. */
  private deleting = new Set<string>();

  /**
   * Deletes the records related to one about to be deleted, through every
   * relationship that says to ("Delete related records in this table when a
   * record is deleted in the other table"), as FileMaker does.
   */
  private cascadeDelete(table: string, recordId: number, row: Record<string, SqlValue>, opts: WriteOptions): void {
    const key = `${table}\u0000${recordId}`;
    if (this.deleting.has(key)) return;
    this.deleting.add(key);
    try {
      const mine = new Set(this.schema.tableOccurrences.filter((t) => !t.dataSourceId && this.schema.tables.find((x) => x.id === t.baseTableId)?.name === table).map((t) => t.id));
      for (const rel of this.schema.relationships) {
        const sides: [number, number][] = [];
        if (rel.rightDelete && mine.has(rel.leftTableOccurrenceId)) sides.push([rel.leftTableOccurrenceId, rel.rightTableOccurrenceId]);
        if (rel.leftDelete && mine.has(rel.rightTableOccurrenceId)) sides.push([rel.rightTableOccurrenceId, rel.leftTableOccurrenceId]);
        for (const [from, to] of sides) {
          const related = relatedRows(this, from, row, to, { limit: Number.MAX_SAFE_INTEGER });
          if (!related) continue;
          const info = this.occurrenceInfo(related.occurrence);
          for (const r of related.rows) {
            const id = Number(r._fm_record_id);
            if (related.occurrence.store.deleting.has(`${related.occurrence.table.name}\u0000${id}`)) continue;
            try {
              related.occurrence.store.delete(info, id, opts);
            } catch (e) {
              rethrowExecutionRefusal(e);
              // Already gone through another relationship.
              if (!(e instanceof StoreError && e.code === 101)) throw e;
            }
          }
        }
      }
    } finally {
      this.deleting.delete(key);
    }
  }

  // --- record ids (the script engine keeps found sets as lists of ids) ----

  private externalNamed = new PreparedCache(new Map<string, string>(), (value) => new Map(value));

  /**
   * Names the fields of other files' tables in a formula: the reader leaves
   * them as ⟨field:TO.field⟩ until the other file is open (see resolveFile).
   */
  externalFieldNames(formula: string): string {
    if (!formula.includes('⟨field:')) return formula;
    const done = this.externalNamed.value.get(formula);
    if (done !== undefined) return done;
    const out = externalFieldNames(formula, (toId, fieldId) => {
      const to = this.schema.tableOccurrences.find((t) => t.id === toId);
      if (!to) return undefined;
      try {
        const info = this.occurrence(to.name);
        const field = info.owner.schema.tables.find((t) => t.name === info.table)?.fields.find((x) => x.id === fieldId);
        return field ? `${to.name}::${field.name}` : undefined;
      } catch (e) {
        rethrowExecutionRefusal(e);
        return undefined;
      }
    });
    if (!out.includes('⟨field:')) this.externalNamed.value.set(formula, out);
    return out;
  }

  /** A table occurrence, addressed like a layout (scripts and relationships name occurrences, not layouts). */
  occurrence(name: string): LayoutInfo {
    const key = `\u0000to:${name.toLowerCase()}`;
    const cached = this.layoutCache.value.get(key);
    if (cached) return cached;
    const to = this.schema.tableOccurrences.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!to) throw new StoreError(102, `Table occurrence "${name}" is missing`);
    let owner: Store = this;
    let table = this.schema.tables.find((t) => t.id === to.baseTableId);
    if (to.dataSourceId) {
      const file = dataSourceFile(this.schema.dataSources.find((d) => d.id === to.dataSourceId)?.paths ?? []);
      const other = file ? this.resolvedFile(file) : undefined;
      if (!other) throw new StoreError(100, `Table occurrence "${name}" uses a table in "${file ?? 'another file'}", which is not hosted`);
      owner = other;
      table = other.schema.tables.find((t) => t.id === to.baseTableId);
    }
    if (!table) throw new StoreError(102, `Table occurrence "${name}" has no table`);
    const info: LayoutInfo = {
      name,
      table: table.name,
      occurrence: to.name,
      fields: table.fields.filter((f) => f.kind !== 'summary').map((f) => ({ name: f.name, type: f.type, indexLanguage: f.options?.indexLanguage, calculated: f.kind === 'calculation', ...((f.options?.repetitions ?? 1) > 1 ? { repetitions: f.options!.repetitions } : {}) })),
      owner,
    };
    this.layoutCache.value.set(key, info);
    return info;
  }

  /**
   * Record ids where a SQL condition on the table's own columns holds (an
   * OData $filter, built by the caller from quoted column names and
   * parameters), in sort order, among the records the account may view.
   * `fields` names the fields the condition reads: they must be visible.
   */
  selectIds(...args: Parameters<Store['selectIdsCurrent']>): number[] {
    return this.withDesignRead(() => this.selectIdsCurrent(...args));
  }

  private selectIdsCurrent(layout: string | LayoutInfo, opts: { where?: string; params?: SqlValue[]; fields?: string[]; sort?: SortSpec[]; privileges?: Privileges; /** At most this many ids. */ limit?: number; /** Skip this many ids in sort order. */ offset?: number } = {}): number[] {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges);
    if (info.owner !== this) return info.owner.selectIds(info, opts);
    const pv = this.local(opts.privileges);
    this.checkFieldsVisible(info, pv, [...(opts.fields ?? []), ...(opts.sort ?? []).map((x) => x.fieldName)]);
    const view = this.viewFilter(info, pv);
    const limit = opts.limit === undefined ? (opts.offset === undefined ? '' : ' LIMIT -1') : ` LIMIT ${Math.max(0, Math.floor(opts.limit))}`;
    const offset = opts.offset === undefined ? '' : ` OFFSET ${Math.max(0, Math.floor(opts.offset))}`;
    return (this.sql.prepare(`SELECT _fm_record_id AS id FROM ${q(info.table)} WHERE (${opts.where ?? '1'}) AND ${view.where} ORDER BY ${this.orderBy(info, opts.sort, opts.privileges)}${limit}${offset}`)
      .all(...(opts.params ?? []), ...view.params) as { id: number }[]).map((r) => Number(r.id));
  }

  /** Count the same visible matches as selectIds, without materializing ids or applying pagination. */
  countIds(layout: string | LayoutInfo, opts: Parameters<Store['selectIds']>[1] = {}): number {
    const info = typeof layout === 'string' ? this.layout(layout) : layout;
    this.checkLayout(info, opts.privileges);
    if (info.owner !== this) return info.owner.countIds(info, opts);
    const pv = this.local(opts.privileges);
    this.checkFieldsVisible(info, pv, [...(opts.fields ?? []), ...(opts.sort ?? []).map((x) => x.fieldName)]);
    const view = this.viewFilter(info, pv);
    return Number((this.sql.prepare(`SELECT count(*) AS n FROM ${q(info.table)} WHERE (${opts.where ?? '1'}) AND ${view.where}`)
      .get(...(opts.params ?? []), ...view.params) as { n: number }).n);
  }

  /**
   * The values of SQL expressions on the table's own columns (an OData $compute, built by the caller from quoted
   * column names and parameters) for some records, as a row of values for each record id the account may view.
   * `fields` names the fields the expressions read: they must be visible.
   */
  computeValues(...args: Parameters<Store['computeValuesCurrent']>): Map<number, unknown[]> {
    return this.withDesignRead(() => this.computeValuesCurrent(...args));
  }

  private computeValuesCurrent(layout: string | LayoutInfo, ids: number[], exprs: { sql: string; params: SqlValue[]; fields: string[] }[], privileges?: Privileges): Map<number, unknown[]> {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, privileges);
    if (info.owner !== this) return info.owner.computeValues(info, ids, exprs, privileges);
    const pv = this.local(privileges);
    this.checkFieldsVisible(info, pv, exprs.flatMap((e) => e.fields));
    const view = this.viewFilter(info, pv);
    const out = new Map<number, unknown[]>();
    if (!exprs.length) return out;
    const columns = exprs.map((e, n) => `(${e.sql}) AS c${n}`).join(', ');
    const own = exprs.flatMap((e) => e.params);
    for (let at = 0; at < ids.length; at += 500) {
      const chunk = ids.slice(at, at + 500);
      const rows = this.sql.prepare(`SELECT _fm_record_id AS id, ${columns} FROM ${q(info.table)} WHERE _fm_record_id IN (${chunk.map(() => '?').join(',')}) AND ${view.where}`)
        .all(...own, ...chunk, ...view.params) as Record<string, unknown>[];
      for (const r of rows) out.set(Number(r.id), exprs.map((_, n) => r[`c${n}`] ?? null));
    }
    return out;
  }

  /** Every record id a find (or, without a query, the whole table) gives, in sort order. */
  findIds(...args: Parameters<Store['findIdsCurrent']>): number[] {
    return this.withDesignRead(() => this.findIdsCurrent(...args));
  }

  private findIdsCurrent(layout: string | LayoutInfo, opts: { query?: FindRequest[]; sort?: SortSpec[]; privileges?: Privileges; dateOrder?: DateStyle } = {}): number[] {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges);
    if (info.owner !== this) return info.owner.findIds(info, opts);
    return this.timeFind(info, opts, () => this.findIdsHere(info, opts), (r) => r.length);
  }

  private findIdsHere(info: LayoutInfo, opts: { query?: FindRequest[]; sort?: SortSpec[]; privileges?: Privileges; dateOrder?: DateStyle }): number[] {
    const pv = this.local(opts.privileges);
    this.checkFieldsVisible(info, pv, [...(opts.query ?? []).flatMap((r) => Object.keys(r)), ...(opts.sort ?? []).map((x) => x.fieldName)]);
    let materialized: string | undefined;
    const source = () => materialized ??= this.findSource(info, opts);
    let where = '1';
    let params: SqlValue[] = [];
    if (opts.query?.length) {
      try {
        ({ where, params } = findWhere(opts.query, new Map(info.fields.map((f) => [f.name, f])), (v, t) => this.normalize(v, t, opts.dateOrder), this.relatedCriteria(info, opts.privileges, opts.dateOrder), this.wordIndex(info), () => this.duplicateSource(source(), this.table(info), pv)));
      } catch (e) {
        rethrowExecutionRefusal(e);
        if (e instanceof FindError) throw new StoreError(e.code, e.message);
        throw e;
      }
    }
    const view = this.viewFilter(info, pv);
    // Unstored calculations and globals found or sorted on are computed first, as find does.
    const t = source();
    const ids: number[] = [];
    for (const row of this.sql.prepare(`SELECT _fm_record_id AS id FROM ${t} WHERE (${where}) AND ${view.where} ORDER BY ${this.orderBy(info, opts.sort, opts.privileges)}`)
      .iterate(...params, ...view.params) as Iterable<{ id: number }>) ids.push(Number(row.id));
    return ids;
  }

  /**
   * Groups of a sorted found set, as sub-summary parts show them: for each
   * level, runs of consecutive records with the same values in the first
   * `level + 1` fields, with the layout's summary fields over each run.
   */
  groupSummaries(...args: Parameters<Store['groupSummariesCurrent']>): GroupRun[][] {
    return this.withDesignRead(() => this.groupSummariesCurrent(...args));
  }

  private groupSummariesCurrent(layout: string | LayoutInfo, ids: number[], fields: string[], fmt: DateFormat = 'us', privileges?: Privileges): GroupRun[][] {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, privileges);
    if (info.owner !== this) return info.owner.groupSummaries(info, ids, fields, fmt, privileges);
    const pv = this.local(privileges);
    this.checkFieldsVisible(info, pv, fields);
    // Check the table even for an empty list; supplied ids are not an authorization grant.
    this.viewFilter(info, pv);
    const allowed = this.viewableIds(info.table, privileges);
    if (allowed) {
      const visible = new Set(allowed);
      ids = ids.filter((id) => visible.has(id));
    }
    for (const f of fields) if (!info.fields.some((x) => x.name === f)) throw new StoreError(102, `Field "${f}" is missing`);
    const table = this.table(info);
    const defs = table.fields.filter((f) => f.kind === 'summary' && info.fields.some((x) => x.name === f.name) && !this.fieldHidden(info.table, f.name, privileges));
    // The found set is read in batches, once per level (only the grouped and summarized columns when they are stored).
    const summarized = summaryColumns(table, defs);
    const breaks = fields.map((name) => table.fields.find((f) => f.name === name)!);
    const stored = (f: Field) => f.kind === 'normal' && !f.options?.global
      || f.kind === 'calculation' && !f.options?.unstored && !f.options?.global;
    const cols = summarized && breaks.every(stored) ? [...new Set([...fields, ...summarized])] : undefined;
    const pass = this.calc.newPass(privileges?.account, privileges);
    const fractions = defs.filter((f) => f.summary?.type === 'fractionOfTotal');
    const totals = fractions.length ? this.calc.collect(rowsById(this, table, ids, cols), table, fractions, pass) : undefined;
    // Text groups ignore case, as FileMaker's sort does; a field indexed in another language than English groups values
    // that language sorts as equal (an approximation of Claris, unverified: see docs/sort-languages.md).
    const languages = new Map(fields.map((f) => [f, sortLanguage(table.fields.find((x) => x.name === f)?.options?.indexLanguage)]));
    const norm = (v: unknown, field: string) => {
      if (typeof v !== 'string') return v ?? null;
      const language = languages.get(field)!;
      return language === 'en' ? v.normalize('NFC').toLowerCase().normalize('NFC') : sortKey(v, language);
    };
    return fields.map((_, level) => {
      const keyPass = this.calc.newPass(privileges?.account, privileges);
      const key = (rec: Rec) => {
        const values = breaks.slice(0, level + 1).map((f) => norm(toStored(this.calc.value(rec, f, 1, keyPass), f.type, this.dateOrder), f.name));
        keyPass.values.clear();
        keyPass.related.clear();
        return JSON.stringify(values);
      };
      const runs: GroupRun[] = [];
      let start = 0;
      let i = 0;
      let runKey: string | undefined;
      let runFirst: Row | undefined;
      let acc = this.calc.collector(table, defs, pass);
      const running = new Map<number, { total: number; count: number; key?: string }>();
      const flush = () => {
        if (i === start) return;
        const values: Record<string, string | number> = {};
        for (const f of defs) {
          if (this.summaryMasked(table, f, privileges)) { values[f.name] = ''; continue; }
          if (f.summary?.running) {
            let state = running.get(f.id);
            if (!state) { state = { total: 0, count: 0 }; running.set(f.id, state); }
            const restart = table.fields.find((x) => x.id === f.summary!.restartFieldId);
            if (restart && fields.slice(0, level + 1).includes(restart.name)) {
              const key = JSON.stringify(norm(runFirst?.[restart.name], restart.name));
              if (state.key !== undefined && key !== state.key) { state.total = 0; state.count = 0; }
              state.key = key;
            }
            state.count += acc.result.get(f)!.count;
            state.total = decimalSum([state.total, ...acc.result.get(f)!.nums]);
            values[f.name] = f.summary!.type === 'count' ? state.count : state.total;
          } else if (f.summary?.type === 'fractionOfTotal') {
            const whole = decimalSum(totals!.get(f)!.nums);
            values[f.name] = whole === 0 ? '' : decimalSum(acc.result.get(f)!.nums) / whole;
          } else values[f.name] = this.present(toStored(summedFor(table, f, acc.result.get(f)!), summaryType(table, f), this.dateOrder), summaryType(table, f), fmt);
        }
        runs.push({ start, count: i - start, values });
        start = i;
        acc = this.calc.collector(table, defs, pass);
      };
      for (const rec of rowsById(this, table, ids, cols)) {
        const k = key(rec);
        if (runKey !== undefined && k !== runKey) flush();
        if (runKey === undefined || k !== runKey) runFirst = rec.row;
        runKey = k;
        acc.add(rec);
        i++;
      }
      flush();
      return runs;
    });
  }

  /** Puts record ids in sort order (all of them, unlike find's pages). */
  sortIds(...args: Parameters<Store['sortIdsCurrent']>): number[] {
    return this.withDesignRead(() => this.sortIdsCurrent(...args));
  }

  private sortIdsCurrent(layout: string | LayoutInfo, ids: number[], sort: SortSpec[], opts: { privileges?: Privileges; valueLists?: { store: Store; recordId?: number } } = {}): number[] {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges);
    if (info.owner !== this) return info.owner.sortIds(info, ids, sort, opts);
    const pv = this.local(opts.privileges);
    this.checkFieldsVisible(info, pv, sort.map((s) => s.fieldName));
    const view = this.viewFilter(info, pv);
    return (this.sql.prepare(`SELECT _fm_record_id AS id FROM ${q(info.table)} WHERE _fm_record_id IN (SELECT value FROM json_each(?)) AND ${view.where} ORDER BY ${this.orderBy(info, sort, opts.privileges, opts.valueLists)}`)
      .all(JSON.stringify(ids), ...view.params) as { id: number }[]).map((r) => Number(r.id));
  }

  /**
   * Records whose field matches one of the values, as a relationship matches:
   * text ignores case, and the empty value matches nothing.
   */
  matchIds(layout: string | LayoutInfo, field: string, values: (string | number)[]): number[] {
    const info = this.layoutInfo(layout);
    if (info.owner !== this) return info.owner.matchIds(info, field, values);
    const f = info.fields.find((x) => x.name === field);
    if (!f) throw new StoreError(102, `Field "${field}" is missing`);
    const keys = values.map((v) => (typeof v === 'string' ? this.normalize(v, f.type) : v)).filter((v) => v !== null && v !== '');
    if (!keys.length) return [];
    const col = f.type === 'text' ? `${q(f.name)} COLLATE NOCASE` : q(f.name);
    return (this.sql.prepare(`SELECT _fm_record_id AS id FROM ${q(info.table)} WHERE ${col} IN (SELECT value FROM json_each(?)) ORDER BY _fm_record_id`)
      .all(JSON.stringify(keys)) as { id: number }[]).map((r) => Number(r.id));
  }

  /** Deletes every record of a table (Truncate Table). */
  truncate(layout: string | LayoutInfo, opts: WriteOptions = {}): number {
    const info = this.layoutInfo(layout);
    this.checkLayout(info, opts.privileges, true);
    if (info.owner !== this) return info.owner.truncate(info, opts);
    // Claris requires Full Access, even when a custom set may delete every record.
    // Check before locks or any mutation, including when the table is empty.
    if (this.local(opts.privileges)) throw new StoreError(200, 'Truncate Table requires full access privileges');
    this.joinTransaction();
    const locked = this.locks.othersIn(info.table, writer.getStore()?.owner);
    if (locked.length) throw new StoreError(301, `Record is in use by another user (${locked[0].account})`);
    // Read before the delete, in batches, only when there are stand-ins to take out; all or nothing with the delete.
    const table = this.table(info);
    let n: number;
    this.sql.exec('SAVEPOINT truncate_table');
    try {
      const page = this.sql.prepare(`SELECT * FROM ${q(info.table)} WHERE _fm_record_id > ? ORDER BY _fm_record_id LIMIT 1000`);
      for (let after = 0; this.vaultHeld();) {
        const rows = page.all(after) as Record<string, SqlValue>[];
        if (!rows.length) break;
        this.forgetStandInValues(table, rows);
        after = Number(rows[rows.length - 1]._fm_record_id);
      }
      n = Number(this.sql.prepare(`DELETE FROM ${q(info.table)}`).run().changes);
      this.sql.exec('RELEASE truncate_table');
    } catch (e) {
      this.sql.exec('ROLLBACK TO truncate_table');
      this.sql.exec('RELEASE truncate_table');
      throw e;
    }
    this.textStyles.forget(this.table(info).id);
    this.audit('truncate', info.table, undefined, { records: n }, opts);
    this.notify('truncate', info.table);
    return n;
  }

  /**
   * A statement for the read-only connection. Only queries are allowed: a
   * read-only connection still runs ATTACH (reading any database file the
   * server can open) and VACUUM INTO (writing a copy anywhere). The internal
   * tables (`_fm_accounts`, `_fm_totp`, `_fm_api_tokens`, ...) are off-limits
   * too: they hold password hashes, token hashes and second-factor secrets,
   * which no SQL caller — not even one with full record access — may read, and
   * which FileMaker's own xDBC never exposes. Only `_fm_record_id` (the row id
   * column) and `_fm_containers` (container data a query may join) are allowed.
   */
  /** Rows as a query through SQL sees them: the committed file, whatever an open script transaction has changed meanwhile. */
  iterateCommitted(sqlText: string): IterableIterator<Record<string, SqlValue>> {
    return this.readOnly(sqlText).iterate() as IterableIterator<Record<string, SqlValue>>;
  }

  private readOnly(sqlText: string): StatementSync {
    return this.readOnlyChecked(sqlText).statement;
  }

  private readOnlyChecked(sqlText: string): { statement: StatementSync; opened: { opcode: string; p2: number; p3: number }[] } {
    sqlText = cleanSql(sqlText);
    if (!oneStatement(sqlText)) throw new StoreError(8310, 'SQL runs one statement at a time');
    const tokens = sqlTokens(sqlText).filter((t) => t.kind !== 'space');
    for (const [i, t] of tokens.entries()) {
      const name = sqlName(t).toLowerCase();
      if ((t.kind === 'word' && /^(?:attach|detach|pragma|vacuum|insert|update|delete|create|drop|alter|reindex|analyze)$/.test(name))
        || (t.kind === 'word' && name === 'replace' && tokens[i + 1]?.text !== '(')
        || ((t.kind === 'word' || t.kind === 'identifier' || t.kind === 'string') && /^(?:load_extension|readfile|writefile)$/.test(name) && tokens[i + 1]?.text === '(')) {
        throw new StoreError(8310, 'Only SELECT queries can run here; queries must be readonly');
      }
    }
    const first = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(\w+)/.exec(sqlText)?.[1]?.toUpperCase();
    if (first !== 'SELECT' && first !== 'WITH' && first !== 'VALUES') throw new StoreError(8310, 'Only SELECT queries can run here');
    const forbidden = internalTableRef(sqlText);
    if (forbidden) throw new StoreError(8310, `The internal table "${forbidden}" can't be read through SQL`);
    const catalog = catalogRef(sqlText);
    if (catalog) throw new StoreError(8310, `"${catalog}" lists the file's internal tables and can't be read through SQL; use describe_database for the tables and fields`);
    if (!this.readOnlySql) {
      this.readOnlySql = traceDatabase(watchDatabase(new DatabaseSync(this.path, { readOnly: true }), this.name.replace(/\.tabularius$/i, ''), this.damageWatch));
      defineFold(this.readOnlySql);
      for (const id of SORT_LANGUAGE_IDS) this.readOnlySql.function(sortFunction(id), { deterministic: true }, (v) => (typeof v === 'string' ? keptSortKey(v, id) : v));
      if (this.fileMode === 'native') this.readOnlySql.function('fm_decimal_key', { deterministic: true }, (v) => decimalKey(v as string | number | null));
      for (const [name, fn] of this.queryFunctions) this.readOnlySql.function(name, { varargs: true }, fn);
    }
    if (this.fileMode === 'native') this.refreshDecimalSqlViews();
    sqlText = languageOrderBy(sqlText, this.schema.tables);
    const statement = this.readOnlySql.prepare(sqlText);
    // The name screen above reads the text; SQLite also takes a quoted string as a table name
    // (SELECT secret FROM '_fm_totp'), so the compiled query is checked too: it may open no
    // internal table, whatever it was called.
    const opened = this.readOnlySql.prepare(`EXPLAIN ${sqlText}`).all() as { opcode: string; p2: number; p3: number; p4: string | null }[];
    // Reject writes before inspecting trigger programs, which may access internal counters.
    if (opened.some((o) => o.opcode === 'Transaction' && o.p2 > 0)) throw new StoreError(8310, 'Queries must be readonly');
    const virtualTables = new Set(opened.filter((o) => o.opcode === 'VOpen').map((o) => o.p4));
    if (virtualTables.size) {
      // Preparing a query registers any eponymous pragma modules it uses, even
      // through views. VOpen identifies them by connection-local pointers, not
      // names; compare with compiled probes on this same connection. Recompute
      // each time so schema changes and reopened connections cannot stale them.
      const modules = this.readOnlySql.prepare('PRAGMA module_list').all() as { name: string }[];
      for (const { name } of modules) {
        if (!/^(?:pragma_\w+|dbstat)$/i.test(name)) continue;
        // Check both schemas: an ordinary table can shadow the module in one.
        for (const schema of ['main', 'temp']) {
          const probe = this.readOnlySql.prepare(`EXPLAIN SELECT * FROM ${schema}.${q(name)}`).all() as { opcode: string; p4: string | null }[];
          if (probe.some((o) => o.opcode === 'VOpen' && virtualTables.has(o.p4))) {
            throw new StoreError(8310, "The SQL catalog can't be read through SQL; use describe_database for the tables and fields");
          }
        }
      }
    }
    const tablesOpened = opened.filter((o) => o.opcode === 'OpenRead' || o.opcode === 'OpenWrite' || o.opcode === 'ReopenIdx');
    if (tablesOpened.some((o) => o.p2 === 1)) throw new StoreError(8310, "The SQL catalog can't be read through SQL; use describe_database for the tables and fields");
    const roots = new Set(tablesOpened.filter((o) => o.p3 === 0).map((o) => Number(o.p2)));
    if (roots.size) {
      for (const root of roots) {
        const table = this.internalRoots().get(root);
        if (table) throw new StoreError(8310, `The internal table "${table}" can't be read through SQL`);
      }
    }
    return { statement, opened };
  }

  /** SQL's native decimal projection uses REAL for numeric WHERE, ORDER BY and aggregates. */
  private refreshDecimalSqlViews(): void {
    const db = this.readOnlySql!;
    const version = Number((db.prepare('PRAGMA schema_version').get() as { schema_version: number }).schema_version);
    if (version === this.decimalSqlViewVersion) return;
    for (const t of this.schema.tables) {
      const decimals = new Set(t.fields.filter((f) => f.type === 'decimal').map((f) => f.name.toLowerCase()));
      if (!decimals.size) continue;
      const columns = db.prepare(`PRAGMA main.table_info(${q(t.name)})`).all() as { name: string }[];
      if (!columns.length) continue;
      const select = columns.map((c) => decimals.has(c.name.toLowerCase())
        ? `CAST(NULLIF(${q(c.name)}, '') AS REAL) AS ${q(c.name)}` : q(c.name));
      db.exec(`DROP VIEW IF EXISTS temp.${q(t.name)}`);
      db.exec(`CREATE TEMP VIEW ${q(t.name)} AS SELECT ${select.join(', ')} FROM main.${q(t.name)}`);
    }
    this.decimalSqlViewVersion = version;
  }

  private readonly internalRootCache = new PreparedCache<{ version: number; roots: Map<number, string> } | undefined>(undefined);

  /** Root pages of the internal tables (and their indexes) SQL may not read, re-read when the schema changes. */
  private internalRoots(): Map<number, string> {
    const version = Number((this.readOnlySql!.prepare('PRAGMA schema_version').get() as { schema_version: number }).schema_version);
    if (this.internalRootCache.value?.version !== version) {
      const rows = this.readOnlySql!.prepare(`SELECT tbl_name, rootpage FROM sqlite_master WHERE substr(tbl_name, 1, 4) = '_fm_' AND rootpage > 0`).all() as { tbl_name: string; rootpage: number }[];
      const roots = new Map<number, string>();
      for (const r of rows) if (!SQL_ALLOWED_INTERNAL.has(r.tbl_name.toLowerCase())) roots.set(Number(r.rootpage), r.tbl_name);
      this.internalRootCache.value = { version, roots };
    }
    return this.internalRootCache.value.roots;
  }

  /**
   * A function read-only queries can call, such as PostgreSQL's catalog
   * functions for clients connected over the PostgreSQL protocol.
   */
  defineQueryFunction(name: string, fn: QueryFunction): void {
    this.untrustedQueryFunctions.add(name.toLowerCase());
    this.queryFunctions.set(name, fn);
    this.readOnlySql?.function(name, { varargs: true }, fn);
  }

  /**
   * A read-only query with ? parameters, row by row, with each column's
   * declared type (REAL for number fields) so callers can read values that
   * don't fit their column, such as "$3750" typed into a number field.
   */
  select(...args: Parameters<Store['selectCurrent']>): { names: string[]; types: (string | null)[]; rows: SqlValue[][] } {
    return this.withDesignRead(() => this.selectCurrent(...args));
  }

  private selectCurrent(sqlText: string, params: SqlValue[] = [], limit = 500): { names: string[]; types: (string | null)[]; rows: SqlValue[][] } {
    const wanted = placeholders(sqlText);
    if (wanted > params.length) throw new StoreError(8310, `The query has ${wanted} ? placeholder${wanted === 1 ? '' : 's'} but ${params.length} value${params.length === 1 ? ' was' : 's were'} given`);
    const st = this.readOnly(sqlText);
    st.setReturnArrays(true);
    const rows: SqlValue[][] = [];
    for (const r of st.iterate(...params) as Iterable<SqlValue[]>) {
      rows.push(r);
      if (rows.length >= limit) break;
    }
    const columns = st.columns();
    return { names: columns.map((c) => c.name), types: columns.map((c) => c.type), rows };
  }

  /** A read-only query's columns and their declared types, without running it. */
  describe(...args: Parameters<Store['describeCurrent']>): { names: string[]; types: (string | null)[] } {
    return this.withDesignRead(() => this.describeCurrent(...args));
  }

  private describeCurrent(sqlText: string): { names: string[]; types: (string | null)[] } {
    const columns = this.readOnly(sqlText).columns();
    return { names: columns.map((c) => c.name), types: columns.map((c) => c.type) };
  }

  /** SQL for analysis (used by the MCP server), on a read-only connection. */
  query(sqlText: string, limit = 500): Record<string, SqlValue>[] {
    const rows: Record<string, SqlValue>[] = [];
    for (const r of this.readOnly(sqlText).iterate() as Iterable<Record<string, SqlValue>>) {
      rows.push(r);
      if (rows.length >= limit) break;
    }
    return rows;
  }

  /**
   * `query`, plus what a caller needs to judge what it returned: where each result column comes from (the table
   * column it reads straight through, whatever it is called in the result, or null for an expression), the tables the
   * compiled query opens with their column names (an index counts as its table), and whether it reads a virtual
   * table or table-valued function (json_each, ...), whose columns have no real origin.
   */
  queryWithOrigins(...args: Parameters<Store['queryWithOriginsCurrent']>): QueryOrigins {
    return this.withDesignRead(() => this.queryWithOriginsCurrent(...args));
  }

  /** Compile and inspect SQL without evaluating functions or reading records. */
  inspectQuery(sqlText: string): QueryOrigins {
    return this.withDesignRead(() => {
      const { opened } = this.readOnlyChecked(sqlText);
      for (const op of opened as { opcode: string; p4?: string }[]) {
        if (['Function', 'PureFunc', 'AggStep', 'AggFinal'].includes(op.opcode)) {
          const name = (op.p4 ?? '').replace(/\(-?\d+\)$/, '').toLowerCase();
          if (this.untrustedQueryFunctions.has(name)) throw new StoreError(9, 'SQL user function has an uncertain read set');
        }
      }
      return this.queryWithOriginsCurrent(sqlText, 0);
    });
  }

  private queryWithOriginsCurrent(sqlText: string, limit = 500): QueryOrigins {
    const { statement: st, opened } = this.readOnlyChecked(sqlText);
    const rows: Record<string, SqlValue>[] = [];
    if (limit > 0) for (const r of st.iterate() as Iterable<Record<string, SqlValue>>) {
      rows.push(r);
      if (rows.length >= limit) break;
    }
    const roots = new Set(opened.filter((o) => (o.opcode === 'OpenRead' || o.opcode === 'ReopenIdx') && o.p3 === 0).map((o) => Number(o.p2)));
    const tables = new Map<string, string[]>();
    if (roots.size) {
      const owners = this.readOnlySql!.prepare(`SELECT tbl_name, rootpage FROM sqlite_master WHERE rootpage > 0`).all() as { tbl_name: string; rootpage: number }[];
      for (const o of owners) {
        if (!roots.has(Number(o.rootpage)) || tables.has(o.tbl_name)) continue;
        tables.set(o.tbl_name, (this.readOnlySql!.prepare(`PRAGMA table_info(${q(o.tbl_name)})`).all() as { name: string }[]).map((c) => c.name));
      }
    }
    return {
      rows,
      columns: st.columns().map((c) => ({ name: c.name, origin: c.column })),
      tables: [...tables].map(([table, columns]) => ({ table, columns })),
      virtual: opened.some((o) => o.opcode === 'VOpen' || o.opcode === 'VFilter'),
    };
  }
}
