// Runs FileMaker scripts against hosted stores, the way FileMaker Server runs
// them for the Data API: no user interface, one window per file, found sets
// kept as lists of record ids. Steps that need a screen (dialogs, web viewers,
// URLs to open) are skipped like FileMaker Server skips them, and reported as
// client actions so a web client can carry them out.

import { cancellationScope, untilCanceled } from './cancellation.ts';
import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, constants as fsConstants, cpSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statfsSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { renewTransactionLocks } from '../../store/src/activity.ts';
import { defineFold } from '../../store/src/words.ts';
import { getHeapStatistics } from 'node:v8';
import { CredentialRedactor } from './redaction.ts';
import { TEST_ONLY_CUSTOM_FETCH } from './test-only.ts';
import { sqlMayReadSecret } from './credentials.ts';
import { DELIMITED_SEPARATORS, parseDelimitedRows, sniffSeparator } from '../../store/src/delimited.ts';
import { decodeText } from '../../store/src/text-decode.ts';
import { formulaGuard, stripFormulaGuard } from '../../store/src/csv-export.ts';
import { fmpXmlReader } from './fmp-xml-dates.ts';
import { serialOf, xlsx, type XlsxOutCell } from './xlsx.ts';
import { executeDataApi } from './data-api-step.ts';
import { PdfAppendError, appendPdf, createPdfWriter, pdf, type PdfPage } from './pdf.ts';
import { dynapdfCall } from './dynapdf.ts';
import { pdfMerge, pdfProblem, PdfLimitError } from '../../calc/src/pdf-text.ts';
import { LayoutPrinter, type PrintItem, type PrintSource } from './print.ts';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { foldCase } from '../../calc/src/collation.ts';
import {
  CalcError, CalcNestingError, ERR, NameTable, pdfText, asBoolean, asNumber, asText, compile, cosineSimilarity, embeddingFile, embeddingOf, evaluate, fromStored, num, text, toStored, dayNumber,
  type CalcContext, type DeviceLocation, type PluginFiles, type PluginOutbound, type PluginNetwork, type PluginMailer, type PluginResponse, type MbsCurlRequest, type FieldRef as CalcFieldRef, type Value, type ValueType,
  HostWait, markExecutionRefusal, rethrowExecutionRefusal,
  beginMbsReplay, rewindMbsReplay, endMbsReplay,
} from '../../calc/src/index.ts';
import { WEB_VIEWER_ACTIONS, undecodedOptionError, containerMime, externalFieldNames, type DeviceType, scriptText, getParameterName, type LayoutObject, type LayoutPart, type Table, type Field, type FieldRef, type Ref, type Relationship, type Schema, type Script, type ScriptStep, type StepParams, type TriggerMode, type ScriptTrigger, type LayoutView } from '../../fmp12/src/index.ts';
import { scriptStepName } from '../../fmp12/src/script-steps.ts';
import { chunkText, findPrompt, parseFindAnswer, parseSqlAnswer, readMessages, sqlAnswerPrompt, sqlPrompt, type AiMessage, type AiSessionState, type RagBackend, type ScriptAi } from './ai.ts';
import { signSigV4 } from './sigv4.ts';
import { parseConnectionUrl, type ScriptConnections } from './connections.ts';
import { guardedFetcher, networkProblem, outboundContext, outboundDeadline, parseAllowList } from './net-guard.ts';
import { addresses, captureOnly, curlAddressAllowed, hostAllowed, hostOf, OUTBOX_ATTACHMENT_LIMIT, redactUrl, redirectedText, TEST_SUBJECT_PREFIX, REFUSED_CALL_LIMIT, type OutboundTest, type OutboxEntry, type OutgoingMail, type OutboxMail, type OutboxRequest, type OutsideCalls } from './outbound.ts';
import { digestAuthorization, parseDigestChallenge } from './digest-auth.ts';
import { MissingSheetError, readXlsx, SheetLimitError, unxml, xmlElements, xmlTags, xmlText } from './xlsx.ts';
import { applyXslt, XsltError } from '../../calc/src/xslt.ts';
import { stepLocates } from './location-use.ts';
import { localeElements } from './locale.ts';
import { denialOf, retainDenial, explainAccessDenial, type AccessDenial } from '../../store/src/access-denial.ts';
import { Privileges, PrivilegeError, StoreError, designReport, isFullAccess, dataSourceFile, endTransaction, type Transaction, summarize, serialNext, type FieldData, type FindRequest, type LayoutInfo, type SessionGlobals, type SortSpec, type Store, writer, lintScript, tableDDL, schemaVisibility, fmpXmlResult, fmpDsoResult, dsoElementName, type ExportField, type ExportRow, customFunctionDef, occurrence as occurrenceOf, rowsById, relatedCondition, designFunction, NO_FILE_ARGUMENT, containerValue, errorMeaning } from '../../store/src/index.ts';
import type { SqlValue } from '../../store/src/find.ts';
import { valueListOrder } from '../../store/src/value-list-sort.ts';
import { recordSortKey, recordSortLanguage } from '../../calc/src/collation.ts';
import { safeExistingPath } from '../../store/src/safe-path.ts';
import { closeMbsJavaScriptSession } from '../../calc/src/mbs-js.ts';

export { parseDelimited } from '../../store/src/delimited.ts';

/** FileMaker error codes the engine reports. */
export const ERROR = {
  none: 0,
  /** A script trigger that runs before its event exited with False. */
  canceledByTrigger: 20,
  unavailable: 3,
  missingFile: 100,
  recordMissing: 101,
  fieldMissing: 102,
  scriptMissing: 104,
  layoutMissing: 105,
  windowMissing: 112,
  fieldNotModifiable: 201,
  objectMissing: 116,
  endOfFile: 10,
  fileInUse: 300,
  noRecords: 401,
  noCriteria: 400,
  findCriteria: 400,
  network: 1631,
  capacity: 812,
  privileges: 9,
  /** Not in Claris's current error list (FileMaker 14's said "User account and/or password does not exist"); kept for a missing account. */
  accountMissing: 213,
  /** Claris's list: wrong file type for import; the import file has no data; the file could not be created, opened or written (disk full, invalid path). */
  wrongFileType: 700,
  missingWorksheet: 715,
  noImportData: 731,
  cannotCreateFile: 800,
  cannotOpenFile: 802,
  diskFull: 809,
  invalidPath: 850,
  wrongPassword: 212,
  aiAccountMissing: 877,
  /** Not enough XML/XSL information, XML parse error, XSL transform error, unsupported XML grammar (Claris's list). */
  xmlParse: 718,
  xslTransform: 719,
  xmlGrammar: 954,
  protocol: 1626,
  urlFormat: 1630,
  mailNotSent: 1506,
  /** Perform SQL Query by Natural Language when no SQL the model wrote would run (a guess: Claris doesn't document it). */
  calculation: 1200,
} as const;

/**
 * A file step's failure as a FileMaker error. A Node file error (EACCES, EISDIR, ENOSPC and the like) is mapped to the
 * code Claris lists for it: disk full 809, a path the system cannot use 850, else the step's own (create 800, open 802).
 * Anything that is not a Node file error goes on as it is. The message never holds the path.
 */
function diskFailure(e: unknown, fallback: number): unknown {
  const code = (e as { code?: unknown } | null)?.code;
  if (e instanceof ScriptError || typeof code !== 'string' || !/^E[A-Z0-9]+$/.test(code)) return e;
  const n = code === 'ENOSPC' || code === 'EDQUOT' ? ERROR.diskFull
    : code === 'ENAMETOOLONG' || code === 'ENOTDIR' || code === 'EINVAL' || code === 'ELOOP' ? ERROR.invalidPath : fallback;
  return new ScriptError(n, `The file could not be ${fallback === ERROR.cannotCreateFile ? 'created or written' : 'opened, read or changed'} (${code})`);
}

/** How many records of a query's result Perform SQL Query by Natural Language shows the model when it answers in plain words. */
const SQL_ANSWER_ROWS = 500;

/** Where the web client's Design screen shows what each design dialog step opens. */
const DESIGN_SCREENS: Record<number, string> = {
  38: 'design.html#tables', // Open Manage Database
  88: 'design.html#scripts', // Open Script Workspace
  112: 'design.html#valueLists', // Open Manage Value Lists
  140: 'design.html#relationships', // Open Manage Data Sources
  151: 'design.html#layouts', // Open Manage Layouts
  156: 'design.html#containers', // Open Manage Containers
};

/** A step failed with a FileMaker error code; the script carries on, as FileMaker does. */
/**
 * Step ids the engine runs (ScriptEngine.step has a case for each), and those
 * it skips because they only affect a screen, as FileMaker Server does. For
 * reports on what a converted file can run; a test keeps them in sync.
 */
/** The biggest file Perform RAG Action reads from the documents folder. */
const RAG_FILE_LIMIT = 50_000_000;
/** The most chunks one Add Data may make, checked before anything is sent to an embedding model (the space's own limit is checked after). */
const RAG_ADD_CHUNK_LIMIT = 50_000;

export const SERVER_STEPS: ReadonlySet<number> = new Set([202, 219, 227, 157, 
  1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 21, 22, 23, 25, 26, 27, 28, 29, 30, 31, 33, 34, 35, 39, 41, 49, 50, 51, 55, 60, 61, 62,
  63, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 79, 80, 81, 85, 86, 87, 90, 91, 92, 93, 97, 99, 103, 104, 111, 115, 116, 119,
  120, 121, 122, 123, 124, 125, 126, 127, 130, 43, 131, 132, 133, 141, 142, 145, 146, 147, 148, 150, 160, 164, 166, 167, 168, 169,
  174, 175, 180, 182, 36, 37, 46, 47, 48, 94, 144, 42, 44, 65, 154, 38, 84, 88, 112, 135, 136, 137, 138, 140, 151, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 199, 205, 206, 207, 223, 4, 5, 17,
  40, 24, 155, 203, 134, 83, 200, 102, 208, 165, 56, 158, 159, 143, 225, 228, 101, 98, 238, 237, 243, 244, 245, 246, 247, 210, 3, 128, 218,
  212, 214, 215, 216, 217, 220, 221, 226,
  242, 161, 181, 67, 117, 152,
  32, 45, 105, 109, 113, 114, 118, 129, 149, 156, 172, 183, 209,
]);
export const SCREEN_STEPS: ReadonlySet<number> = new Set([
  29, 30, 31, 81, 92, 93, 97, 115, 119, 120, 166, 168, 169, 174, 130, 50, 42,
  32, 45, 105, 109, 113, 114, 118, 129, 149, 172, 183, 209,
]);
/** Steps only FileMaker Pro can do (a person choosing, a device, AppleScript): error 3 here, as on FileMaker Server. */
export const CLIENT_ONLY_STEPS: ReadonlySet<number> = new Set([161, 181, 67, 202, 11]);

export class ScriptError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** Something a client (a person's screen) would do for a step the server skips. */
export interface ClientAction {
  step: string;
  script: string;
  windowId?: string;
  layoutId?: number;
  recordId?: number;
  objectId?: number;
  objectName?: string;
  repetition?: number;
  flushJoinResults?: boolean;
  flushExternalData?: boolean;
  action?: StepParams['viewerAction'];
  url?: string;
  [key: string]: unknown;
}

export interface TraceLine {
  script: string;
  /** 0-based step index within the script. */
  index: number;
  line: string;
  /** Get ( LastError ) after the step, when not 0. */
  error?: number;
  /** Why the step failed, when it did. */
  message?: string;
}

/** Show Custom Dialog, evaluated: what a person is shown. */
export interface DialogRequest {
  script: string;
  title: string;
  message: string;
  /** The button labels, first button first; blank ones are left out by the client. */
  buttons: string[];
  /** Input fields, each prefilled with its target's current value. */
  inputs: { label: string; value: string; password: boolean }[];
  actions: ClientAction[];
  /** The window the dialog shows over. */
  state: WindowState;
}

/**
 * The person's window and device, as their browser reports it, for Get ( Device ), Get ( WindowWidth ),
 * Get ( ScreenWidth ) and the like: FileMaker answers these for the client's screen, not the server's.
 */
export interface ClientWindow {
  /** Get ( Device ): 0 unknown, 1 Mac, 2 Windows, 3 iPad, 4 iPhone, 5 Android. */
  device: number;
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  screenWidth: number;
  screenHeight: number;
  scale: number;
  /** Get ( WindowOrientation ): 0 portrait, 1 landscape. */
  orientation: number;
}

/** A browser's window info (header x-tabularius-window), checked, or undefined. */
export function clientWindow(raw: unknown): ClientWindow | undefined {
  if (typeof raw !== 'string' || raw.length > 400) return undefined;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!j || typeof j !== 'object') return undefined;
  const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0);
  return {
    device: Number.isInteger(j.device) && (j.device as number) >= 0 && (j.device as number) <= 5 ? j.device as number : 0,
    width: Math.round(n(j.width, 100_000)), height: Math.round(n(j.height, 100_000)),
    contentWidth: Math.round(n(j.contentWidth, 100_000)), contentHeight: Math.round(n(j.contentHeight, 100_000)),
    screenWidth: Math.round(n(j.screenWidth, 100_000)), screenHeight: Math.round(n(j.screenHeight, 100_000)),
    scale: n(j.scale, 16) || 1, orientation: j.orientation === 1 ? 1 : 0,
  };
}

/** Get ( ) values that come from the person's window, when the client said what it is. */
export function clientWindowGet(w: ClientWindow | undefined, name: string): Value | undefined {
  if (!w) return undefined;
  switch (name) {
    case 'device': return num(w.device);
    // As FileMaker WebDirect answers: 4, a web browser, whatever the device.
    case 'systemplatform': return num(4);
    case 'windowwidth': return num(w.width);
    case 'windowheight': return num(w.height);
    case 'windowcontentwidth': return num(w.contentWidth);
    case 'windowcontentheight': return num(w.contentHeight);
    case 'windowdesktopwidth': case 'screenwidth': return num(w.screenWidth);
    case 'windowdesktopheight': case 'screenheight': return num(w.screenHeight);
    case 'screenscalefactor': return num(w.scale);
    case 'windoworientation': return num(w.orientation);
  }
  return undefined;
}

/** The smallest height or width Move/Resize Window gives a window, in points. */
const MIN_WINDOW_SIZE = 50;

/** Insert Embedding in Found Set's MaxRecPerCall from its Parameters JSON: 20 unless it gives 1 to 500. */
export function embedBatchSize(parameters: string): number {
  let n: unknown;
  try { n = (JSON.parse(parameters || '{}') as Record<string, unknown>)?.MaxRecPerCall; } catch { return 20; }
  const v = typeof n === 'string' ? Number(n) : n;
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(500, Math.max(1, Math.trunc(v))) : 20;
}

/** FileMaker's window styles (New Window's Window Style). */
export type WindowStyle = 'document' | 'floating' | 'dialog' | 'card';

/** A window the person has open: the web client's id for it, its name and style, and the layout it shows. */
export interface OpenWindow {
  id: string;
  name: string;
  style?: WindowStyle;
  layout?: string;
  /** The background window's own found set and position, when the client supplied them. */
  foundSet?: number[];
  recordId?: number;
  sort?: SortSpec[];
  /** A card's (or other overlay's) size and place, as New Window or Move/Resize Window last gave them (points). */
  height?: number;
  width?: number;
  top?: number;
  left?: number;
}

/** The size and place an open window was given, from the person's window as the client reports it. */
function geometryOf(o: OpenWindow): Window['geometry'] {
  return Object.fromEntries((['height', 'width', 'top', 'left'] as const).filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
}

/** The window a script ended in (the front window), as the web client draws it. */
export interface EndWindow {
  id: string;
  name: string;
  style: WindowStyle;
  /** New Window's Height, Width, Top and Left, when it gave them (points). */
  height?: number;
  width?: number;
  top?: number;
  left?: number;
  /** A card window dims the window behind it, and has a close control. */
  dimParent?: boolean;
  closeButton?: boolean;
  /** The script left this window as the person had it (it came to the front when the one above it closed): the client keeps its own state of it. */
  untouched?: boolean;
}

export interface ClientCheckpoint {
  script: string;
  actions: ClientAction[];
  state: WindowState;
  store: Store;
  pending: FieldData;
  get: (name: string) => Value | undefined;
  variable: (name: string, repetition: number) => Value | undefined;
}

export interface RunOptions {
  /** @internal Explicit test-only permission to inject a custom fetch transport. */
  [TEST_ONLY_CUSTOM_FETCH]?: true;
  /** Apply ordered screen actions at their script point, then acknowledge automatically. No commit or focus change. */
  checkpoint?: (request: ClientCheckpoint) => Promise<void>;
  /** The actual focused layout object, including portals and nonfield objects. */
  activeObjectId?: number;
  /** Return Export Field Contents as an action even when this run has a server Documents folder. */
  clientFieldExports?: boolean;
  /** Checks each resolved file before reading its scripts, schema or records, including dynamic cross-file calls. */
  beforeFile?: (store: Store) => void;
  /** Non-throwing observation of explicitly tagged refused checks, independent of LastError. */
  onAccessDenial?: (denial: AccessDenial, code: number) => void;
  /** Observe a field value read by the run, including reads through calculations and related records. */
  onFieldRead?: (name: string, value: string) => void;
  /** Observe ExecuteSQL (with its query text), whose row reads bypass the script engine's field reader. */
  onExecuteSQL?: (query: string) => void;
  /** The person's window and device, for Get ( Device ), Get ( WindowWidth ) and the like. */
  window?: ClientWindow;
  /** The window the run starts in (the one the button or trigger is in): its id, name and style. */
  startWindow?: OpenWindow;
  /**
   * Every window the person has open in this file, frontmost last, the start window among them: Close Window in a
   * later run (a card's Cancel) then closes the card and shows the window behind it, and Get ( WindowNames ) and
   * Select Window see them all. A script that works in one gets its layout and any supplied found set and position.
   */
  openWindows?: OpenWindow[];
  /**
   * Location and LocationValues: asks the person's device where it is (their browser asks them for permission), once
   * per run, before the first step whose formulas use them. Without it, or when refused, they give empty.
   */
  location?: (request: { script: string; actions: ClientAction[] }) => Promise<DeviceLocation | undefined>;
  /**
   * Insert from Device: the person's device takes a photo, video or sound, reads a bar code or takes a signature.
   * A file for media and signatures, text for a bar code; undefined when they cancel.
   */
  device?: (request: { script: string; type: DeviceType; camera?: 'back' | 'front'; actions: ClientAction[] }) => Promise<{ filename: string; data: Uint8Array } | { text: string } | undefined>;
  /** Get ( ScriptParameter ). */
  parameter?: string;
  /** Local variables the first script starts with, named with their $ (a WebDirect-style link's &$name=value). */
  variables?: Record<string, string>;
  /** Get ( AccountName ). */
  account?: string;
  /** Every authenticated run retains its initiating principal, including Full Access and Re-Login. */
  executionAccount?: string;
  /** The initiating identity's privilege mapping, when it signed in through a provider. */
  executionVia?: string;
  /** Authoritative initiating file, when the run uses a scratch copy. */
  executionStore?: Store;
  /**
   * What set off a script trigger: for OnPanelSwitch, Get ( TriggerCurrentPanel )
   * and Get ( TriggerTargetPanel ), each "panel number;object name"; for
   * OnObjectKeystroke and OnLayoutKeystroke, Get ( TriggerKeystroke ) and
   * Get ( TriggerModifierKeys ).
   */
  trigger?: { currentPanel?: string; targetPanel?: string; keystroke?: string; modifierKeys?: number };
  /** The layout object (a field) the cursor is in as the script starts: a step that leaves it runs its OnObjectExit. */
  activeObject?: number;
  /** The run is this layout (or object) trigger's script: a step in it doesn't set the same trigger off again. */
  startedBy?: { event: string; objectId?: number };
  /** With activeObject in a portal: the record id of the portal row the cursor is in. */
  activeRow?: number;
  /** Layout the script starts on (the Data API runs scripts on the layout in the request). Default: the file's first layout. */
  layout?: string;
  /** The window starts in Find mode (with one empty request), as when a script trigger fires in Find mode. Default: Browse mode. */
  mode?: 'browse' | 'find';
  /** Find mode: the requests the window starts with (the ones typed in the web client), instead of one empty request. */
  requests?: { criteria: Record<string, string>; omit: boolean }[];
  /** Start with this found set (in order) instead of every record. */
  foundSet?: number[];
  /** Start on this record of the found set (a button clicked on a record). */
  recordId?: number;
  /**
   * The record the person's window showed before the one it shows now, and the layout it was shown on (the web
   * client remembers it), so Insert from Last Visited works on the record visited before the script started.
   */
  lastVisited?: { layout: string; recordId: number };
  /** The window starts in Preview mode (a client showing printed pages); it runs as Browse mode. */
  preview?: boolean;
  /** The view the window starts in (what the web client shows). Default: the layout's own, as when it is gone to. */
  view?: LayoutView;
  /** Global variables and global fields: pass the same session to keep them between runs. */
  session?: ScriptSession;
  /** Stop after this many steps (default 1,000,000). */
  maxSteps?: number;
  /** Stop after this long (default 60 s). */
  timeoutMs?: number;
  /**
   * Runaway-loop guard: stop a loop that has gone round this many times since
   * it started (each Loop step starts the count again). No limit by default
   * beyond the step limit.
   */
  loopLimit?: number;
  /** Passes after which a loop that walks the found set but never leaves its first record is stopped (default 10,000). */
  stuckLoopPasses?: number;
  /**
   * Runaway-loop guard: stop a loop that has added this many records since it
   * started, counting New Record, Duplicate, records made through a portal and
   * imports (default 100,000).
   */
  loopRecordLimit?: number;
  /**
   * Scripts never to run, however they are reached (Perform Script, on the
   * server, a callback): the step fails with error 3 and the caller goes on.
   */
  skip?: (script: string) => boolean;
  /**
   * Stop when the process's JavaScript heap passes this many bytes (checked
   * between steps and inside long calculations): one script reading far more
   * than it should can't take the whole process down. No limit when absent.
   */
  memoryLimit?: number;
  /** Record each step that runs. */
  trace?: boolean;
  /**
   * Network access for Insert from URL. Off unless set: a solution's scripts can
   * call mail, SMS and payment services, so a run never reaches the network by
   * accident. true uses the global fetch; a function requires the internal test-only injection.
   */
  network?: boolean | typeof fetch;
  /**
   * Hosts, addresses and ranges on the machine's own network that web requests may reach ("intranet.example", "*.corp.example",
   * "10.0.0.0/8"). Without them loopback and private addresses are refused; link-local and metadata addresses never are reachable.
   */
  networkAllow?: readonly string[];
  /**
   * Whether web requests are allowed for a file: with `network` on, every file on the call stack (the one that started
   * the run, and each file it performs scripts in) has to pass, so a script in a file whose network access is off never
   * borrows another file's. Absent: `network` alone decides.
   */
  networkFiles?: (file: string) => boolean;
  /**
   * What the error says when web requests are refused for a file (the file whose access is off, or the one that
   * started a run with no network): the server uses it to say how to turn network access on. Absent: a plain message.
   */
  networkOff?: (file: string) => string;
  /**
   * Outbound test mode (outbound.ts): Send Mail and mail plug-ins write to an
   * outbox and send nothing to the recipients a script names; web requests
   * reach only allowlisted hosts and are recorded. Takes the place of
   * `network` when set.
   */
  outbound?: OutboundTest;
  /**
   * The server's connections (connections.ts): Insert from URL with an address like connection://name/path goes
   * through one, which adds its credentials. Only where Insert from URL may use the network at all.
   */
  connections?: ScriptConnections;
  /**
   * Send Mail via SMTP really sends, through the server operator's account, when they switched it on.
   * Absent, the step is error 3. Outbound test mode takes its place when set, and mail from a capture-only
   * file (a capture-only) is never sent. A string back: not sent, and why.
   */
  mail?: (message: OutgoingMail) => Promise<void | string>;
  /**
   * Install Plug-In File installs a signed plug-in package into the server's plug-ins folder, when an administrator
   * turned that on. Absent, the step is error 3. Throws, with the reason, for a package it won't install.
   */
  installPlugin?: (bytes: Uint8Array) => { id: string; version: string; signer: string };
  /**
   * Tabularius's AI, for FileMaker's AI script steps (ai.ts). The server gives it only when it runs with
   * --ai; without it those steps stop with error 3, as scripts here run offline.
   */
  ai?: ScriptAi;
  /**
   * Source files from the run that started this one (Perform Script on Server), including hosted imports:
   * they still count for AI and outbound checks, as this run's own sources do.
   */
  callerFiles?: string[];
  /**
   * Folder Import Records reads from, like FileMaker Server's Documents folder.
   * Only the file name of the step's source path is used, so a script can't
   * read anywhere else. No folder: Import Records fails with error 100.
   */
  documents?: string;
  /**
   * The files Export Records, Save Records as Excel, Save Records as PDF and
   * Close PDF write go to the person running the script instead of the
   * documents folder: as a client action ({download, base64}) the web client
   * saves, as WebDirect downloads them to the browser. The path a step names
   * gives only the file's name.
   */
  downloads?: boolean;
  /**
   * Insert File without a stored path asks a person for a file: this supplies
   * it (a web client upload, say). Without it such a step fails with error 3;
   * undefined means the person canceled (error 1). `actions` are the client
   * actions so far, for a client to carry out before it asks. Time spent
   * waiting doesn't count toward `timeoutMs`.
   */
  insertFile?: (request: { script: string; title?: string; actions: ClientAction[] }) => Promise<{ filename: string; data: Uint8Array } | undefined>;
  /**
   * Pause/Resume Script with no duration waits for a person: this shows them
   * the window as it stands (`state`, after the client carries out `actions`)
   * and resolves true for Continue, false for Cancel (which halts the script,
   * as in FileMaker). Without it the step is skipped, as on FileMaker Server.
   * Time spent waiting doesn't count toward `timeoutMs`.
   */
  pause?: (request: { script: string; actions: ClientAction[]; state: WindowState }) => Promise<boolean>;
  /**
   * Show Custom Dialog waits for a person: this shows them the dialog (after
   * the client carries out `actions`) and resolves with the button they chose
   * (1-3) and what they typed into each input field, or undefined if they
   * closed it, taken as the last button. Without it the first button is
   * chosen, as nobody can answer. Time spent waiting doesn't count toward
   * `timeoutMs`.
   */
  dialog?: (request: DialogRequest) => Promise<{ button: number; inputs?: string[] } | undefined>;
  /**
   * With error capture off, show a failing step's error through `dialog` (default true). Off for a menu
   * command the client runs, which tells its own result.
   */
  errorDialogs?: boolean;
  /**
   * Sort Records with its dialog: a person picks the sort order, starting
   * from `sort` (the step's stored order, or the found set's). Resolves with
   * the order, or undefined for Cancel (error 1). Without it the step sorts by
   * its stored order and fails (error 3) when it has none. Time spent waiting
   * doesn't count toward `timeoutMs`.
   */
  sortDialog?: (request: { script: string; sort: SortSpec[]; actions: ClientAction[]; state: WindowState }) => Promise<SortSpec[] | undefined>;
  /**
   * Insert from Index with its View Index dialog: a person picks one of
   * `values`, the field's index as the script's privileges see it (an account's own, or full access for a script set to run with it). Resolves with the
   * value, or undefined for Cancel (error 1). Without it the step fails
   * (error 3), as on FileMaker Server. Time spent waiting doesn't count
   * toward `timeoutMs`.
   */
  indexDialog?: (request: { script: string; field: string; values: string[]; actions: ClientAction[]; state: WindowState }) => Promise<string | undefined>;
  /**
   * Paste with nothing copied or cut in this run: the text on the person's own
   * clipboard, as FileMaker pastes what is on the computer's clipboard.
   * Resolves with it, or undefined when there is none or the person won't
   * give it (Paste then does nothing). Asked once a run. Without it Paste
   * pastes only what this run copied. Time spent waiting doesn't count toward
   * `timeoutMs`.
   */
  clipboard?: (request: { script: string; actions: ClientAction[]; state: WindowState }) => Promise<string | undefined>;
  /**
   * Called before each step runs (the script debugger). The script waits while
   * the returned promise is pending; time spent waiting doesn't count toward
   * `timeoutMs`. Returning 'halt' stops the script like Halt Script;
   * returning { next } runs that step of the paused script next instead (Set
   * Next Step), and asks again there.
   */
  debug?: (point: DebugPoint) => DebugAnswer | Promise<DebugAnswer>;
  /** Told how long each step and the whole run took (the admin console's script profiler). */
  profile?: ScriptProfile;
  /** Monotonic clock for profiling, defaulting to performance.now. `advanceStep` lets tests model scripted work. */
  profileClock?: { now(): number; advanceStep?(): void };
  /**
   * The server's queue for server-side scripts (Perform Script on Server and
   * schedules), so only so many run at once, first come first served, as on
   * FileMaker Server. Unset: Perform Script on Server runs at once.
   */
  serverQueue?: ServerQueue;
  /** Aborted to stop the run and its cooperative in-flight operations; the run ends as halted. */
  stop?: AbortSignal;
  /**
   * Fires a "stop" event each time the person running the script asks to
   * stop it (Esc in FileMaker): the run ends as halted at its next step. An ask that comes
   * while the script has Allow User Abort off, or while it waits on the
   * person (a dialog, whose Cancel is theirs to press), is ignored, as in
   * FileMaker.
   */
  userStop?: EventTarget;
  /** Clock, for tests. */
  now?: () => Date;
  /**
   * The account's privileges. Scripts then see and change only what the account
   * may, except scripts set to "Run script with full access privileges" (each
   * script by its own setting; subscripts don't inherit it). Unset: full access.
   */
  privileges?: Privileges;
}

/** A server-side script, as the server's queue and script log name it. */
export interface ServerScriptAbout {
  file: string;
  script: string;
  account?: string;
  /** What started it (default: Perform Script on Server). */
  kind?: 'server' | 'schedule' | 'automation' | 'hook';
}

/** Runs server-side scripts a few at a time, in the order they were asked for. */
export interface ServerQueue {
  /**
   * Runs a server-side script in its turn; `about` names it, for the server's script log and the admin console's
   * list. Admission may throw synchronously when full, including for non-waiting callers.
   * `stop` is aborted when an administrator cancels it: pass it to the run as its `stop` option.
   */
  run<T>(script: (stop?: AbortSignal) => Promise<T>, about?: ServerScriptAbout): Promise<T>;
}

/** Perform Script on Server passes at most this much of a parameter or result, as FileMaker Server does. */
const SERVER_TEXT_LIMIT = 1_000_000;

/** Receives timings from a run: each step's own time (a Perform Script step's excludes the subscript's steps), then the whole run. */
export interface ScriptProfile {
  step(file: string, script: string, index: number, line: string, ms: number, error: number): void;
  run(file: string, script: string, ms: number, error: number, steps: number): void;
  /** A script starts (the run's own, or one Perform Script calls), and ends. */
  enter?(file: string, script: string): void;
  leave?(file: string, script: string): void;
}

/** What the debugger answers at a step: carry on, halt, or run another step of this script next. */
export type DebugAnswer = void | 'halt' | { next: number };

/** Where a script is about to run a step, and what the debugger can look at there. */
export interface DebugPoint {
  script: string;
  /** 0-based index of the step about to run. */
  index: number;
  /** How many steps the script has. */
  steps: number;
  line: string;
  /** Scripts in progress, outermost first; the last is this one. */
  stack: { script: string; index: number }[];
  /** Get ( LastError ) so far. */
  lastError: number;
  /** The step that ran just before, when it set an error (for Pause on error). */
  previousError?: { script: string; index: number; line: string; code: number; message?: string };
  layout?: string;
  foundCount: number;
  recordId?: number;
  mode: 'browse' | 'find';
  /** Local ($) variables of this script and global ($$) variables, as text; repetitions after the first as name[n]. */
  variables(): { locals: Record<string, string>; globals: Record<string, string> };
  /** The record ids of the found set, in order, up to `limit`. */
  foundSet(limit: number): number[];
  /** The current record's edits not committed yet ("Field" or "Field(2)" → stored value), and its table. */
  pending(): { table?: string; recordId?: number; fields: Record<string, string> };
  /** Evaluates a formula here, as the Data Viewer does, without touching the script's error state. */
  evaluate(formula: string): { value: string; error?: number; message?: string };
}

/** Where a window stands: its layout, found set, record and mode. */
export interface WindowState {
  syncVersion?: number;
  window?: EndWindow;
  layout?: string;
  foundCount: number;
  recordId?: number;
  foundSet?: number[];
  sort?: SortSpec[];
  mode?: 'browse' | 'find';
  /** The window is in Preview mode (mode is then 'browse'). */
  preview?: boolean;
  /** Where the script left the cursor, when it moved it (null: out of every field). */
  active?: ActiveField | null;
}

/** The field object the cursor is in, and the text selected in it (0-based, end exclusive, or the whole value). */
export interface ActiveField {
  objectId: number;
  portal?: string;
  row?: number;
  selection?: [number, number] | 'all';
}

export interface RunResult {
  /** Options rejected during import-backed execution, retained even if later steps clear LastError. */
  warnings?: string[];
  syncVersion?: number;
  /** Exit Script result, as text. */
  result: string;
  /** The first step that found its record in use by someone else (error 301), though the script went on and ended without that error. */
  recordInUse?: { line: string; message: string };
  /** Get ( LastError ) when the script ended (the Data API's scriptError). */
  error: number;
  /** Halt Script ran, or a limit stopped the script. */
  halted: boolean;
  /** Layout, found set and record the script ended on. */
  layout?: string;
  foundCount: number;
  recordId?: number;
  /** The found set the script ended with (record ids, in order), and the window's mode. */
  foundSet?: number[];
  /** The found set's sort order, when the script left it sorted. */
  sort?: SortSpec[];
  mode?: 'browse' | 'find';
  /** The window ended in Preview mode (mode is then 'browse'). */
  preview?: boolean;
  /** Where the script left the cursor, when it moved it (null: out of every field). */
  active?: ActiveField | null;
  /** The window the script ended in (layout, found set and record above are its state); with startWindow or a New Window. */
  window?: EndWindow;
  /** Ids of the windows the run closed (Close Window), in order. */
  closed?: string[];
  /** Steps that ran. */
  steps: number;
  actions: ClientAction[];
  trace?: TraceLine[];
  /** In outbound test mode: the outside services the run tried to reach, and the emails it wrote. */
  outside?: OutsideCalls[];
  mail?: number;
}

/** Terminal context is private: RunResult remains safe to serialize. */
export function scriptDenial(result: RunResult): AccessDenial | undefined {
  return result.error ? denialOf(result) : undefined;
}

/**
 * A value to keep past this run ($$variables, global fields): a container's file is read now, while its file is open,
 * rather than when first used, when the file may have been closed or reloaded.
 */
function kept(value: Value): Value {
  return value.type === 'container' && value.data && !Object.prototype.propertyIsEnumerable.call(value, 'data')
    ? { type: 'container', value: value.value, data: value.data, ...(value.changed ? { changed: true as const } : {}) }
    : value;
}

/** Global variables and global field values that outlive one script run (one per client session). */
export class ScriptSession implements SessionGlobals {
  readonly variables = new Map<string, Value[]>();
  readonly globalFields = new Map<string, Value[]>();
  /** AI accounts and prompt templates the session's scripts configured. */
  readonly ai: AiSessionState = { accounts: new Set(), ragAccounts: new Set(), ragConfigured: false, templates: new Map() };

  /** End this session's persistent JavaScript handles, even if an in-flight run still holds the session. */
  close(): void {
    closeMbsJavaScriptSession(this);
  }

  // The store reads and writes the same globals (formulas, Data API edits) through these.

  readGlobal(store: Store, table: Table, field: Field): SqlValue | undefined {
    const arr = this.globalFields.get(`${store.name}::${table.name}::${field.name}`.toLowerCase());
    if (!arr || field.type === 'container') return undefined;
    const type = field.type === 'unknown' ? 'text' : field.type;
    const stored = (v: Value | undefined) => (v === undefined ? null : toStored(v, type, store.dateOrder));
    return (field.options?.repetitions ?? 1) > 1 ? JSON.stringify(Array.from(arr, stored)) : stored(arr[0]);
  }

  readVariable(name: string, repetition: number): Value | undefined {
    return this.variables.get(name.toLowerCase())?.[repetition - 1];
  }

  writeVariable(name: string, repetition: number, value: Value): void {
    const arr = this.variables.get(name.toLowerCase()) ?? [];
    arr[repetition - 1] = value;
    this.variables.set(name.toLowerCase(), arr);
  }

  writeGlobal(store: Store, table: Table, field: Field, value: SqlValue): void {
    let values: SqlValue[] = [value];
    if (typeof value === 'string' && value.startsWith('[') && (field.options?.repetitions ?? 1) > 1) {
      try {
        values = JSON.parse(value) as SqlValue[];
      } catch {
        // plain text
      }
    }
    const type = field.type === 'unknown' ? 'text' : field.type;
    this.globalFields.set(`${store.name}::${table.name}::${field.name}`.toLowerCase(),
      values.map((v) => fromStored(v, type)));
  }
}

interface FoundSet {
  ids: number[];
  index: number;
  sort?: SortSpec[];
  /** Records were created or changed since the sort, so the order may no longer hold (Get(SortState) 2). */
  semi?: boolean;
}

/** Steps that don't touch a window: If, Else, End If, Loop, Exit Loop If, End Loop, Allow User Abort, Set Error Capture, comment, Halt Script, Beep, Exit Script, Else If. */
const WINDOWLESS_STEPS = new Set([68, 69, 70, 71, 72, 73, 85, 86, 89, 90, 93, 103, 125]);

interface Window {
  name: string;
  store: Store;
  /** The web client's id for it (from startWindow/openWindows), or the one New Window made. */
  id?: string;
  style?: WindowStyle;
  geometry?: Pick<EndWindow, 'height' | 'width' | 'top' | 'left'>;
  /** One of the person's other windows, not opened yet here: its layout is gone to when a step needs it. */
  unloaded?: string;
  /** Client state to install when this background window is first used. */
  initialFoundSet?: FoundSet;
  /** No step has run in it this run (a window of the person's that came to the front). */
  untouched?: boolean;
  layout?: LayoutInfo;
  layoutName?: string;
  mode: 'browse' | 'find';
  /** Enter Preview Mode ran: the window runs as Browse mode, but a client shows printed pages. */
  preview?: boolean;
  /** View As chose this view for the layout it is on; absent, the layout's own (see viewOf). */
  view?: LayoutView;
  /** Found sets by table occurrence, as FileMaker keeps them per window. */
  foundSets: Map<string, FoundSet>;
  requests: { criteria: Record<string, string>; omit: boolean }[];
  requestIndex: number;
  /** Get ( QuickFindText ): the last Perform Quick Find's text. */
  quickFindText?: string;
  /** Show/Hide Text Ruler, Allow Formatting Bar, Enable Touch Keyboard: what Get ( TextRulerVisible / AllowFormattingBarState / TouchKeyboardState ) give; off until a script turns one on. */
  chrome?: { textRuler?: boolean; formattingBar?: boolean; touchKeyboard?: boolean };
  /** Get ( WindowUUID ). */
  uuid?: string;
  /** The requests of the last find, for Modify Last Find. */
  lastFind?: { criteria: Record<string, string>; omit: boolean }[];
  /** Field edits of the current record not yet committed, keyed "Field" or "Field(2)". */
  pending: Map<string, string | number>;
  /** Undo/Redo: the uncommitted edits, each with the value it replaced (undefined: none pending), newest last; and those undone. */
  undo?: { key: string; value: string | number | undefined }[];
  redo?: { key: string; value: string | number | undefined }[];
  /** Undo/Redo [ Toggle ]: the last one was an undo. */
  undid?: boolean;
  /** Privileges under which limited edits were made, retained until commit. */
  pendingPrivileges?: Privileges;
  /** The current record was created by New Record and not committed yet. */
  uncommittedNew: boolean;
  /** The record lock this run took for its edits (not one its session already held), released when they are committed or dropped. */
  held?: { info: LayoutInfo; id: number; owner: string; transaction?: Transaction };
  /** The active portal (Go to Object, Go to Portal Row) and its 1-based row. */
  portal?: { occurrence: string; row: number };
  /** The field the cursor is in (Go to Field, Go to Next Field): a layout field object; cleared when the record is exited. */
  activeField?: FieldStop;
  activeObjectId?: number;
  frozen?: boolean;
  /** A step moved the cursor (or took it out of the fields), so the person's window follows. */
  focusMoved?: boolean;
  /** Set Selection, Select All: what is selected in the active field. */
  selection?: [number, number] | 'all';
  /** The record each table was on, and the one before it, for Insert from Last Visited. Keyed by file and table. */
  visited?: Map<string, { current: number; previous?: number }>;
}

/** A window's layout, mode and current record (or find request), as its layout triggers last saw them. */
interface Shown {
  layout?: string;
  mode: TriggerMode;
  record?: string;
  /** The layout object the cursor is in: its id, and the portal row for a field in a portal. */
  object?: string;
  /** One of the person's other windows, not loaded yet: whatever it first shows is what they already see. */
  unloaded?: boolean;
}

/**
 * The view a layout opens in: the one FileMaker saved with it, else (a layout made in Tabularius) list for one with
 * summary parts or a short body under a header, table for one with only table view columns, else form. The web
 * client's savedView makes the same choice, so Get ( LayoutViewState ) says what the person sees.
 */
/** Send Mail via the e-mail client as a mailto: link: ¶-separated addresses become comma-separated, line breaks CRLF. */
export function mailtoUrl(m: NonNullable<StepParams['mail']>, calc: (formula: string) => string): string {
  const list = (x: string | undefined) => (x === undefined ? '' : calc(x).split(/\r\n|\r|\n|[,;]/).map((a) => a.trim()).filter(Boolean).join(','));
  const enc = (t: string) => encodeURIComponent(t.replace(/\r\n|\r|\n/g, '\r\n'));
  const query = ([['cc', list(m.cc)], ['bcc', list(m.bcc)], ['subject', m.subject === undefined ? '' : calc(m.subject)], ['body', m.message === undefined ? '' : calc(m.message)]] as const)
    .filter(([, v]) => v !== '').map(([k, v]) => `${k}=${k === 'cc' || k === 'bcc' ? v.split(',').map(encodeURIComponent).join(',') : enc(v)}`);
  return `mailto:${list(m.to).split(',').filter(Boolean).map(encodeURIComponent).join(',')}${query.length ? '?' + query.join('&') : ''}`;
}

function ownView(d: NonNullable<ReturnType<Store['design']>>): LayoutView {
  if (d.view) return d.view;
  if (!d.objects.length && d.tableView?.length) return 'table';
  const body = d.parts.find((p) => p.kind === 'body');
  if (!body) return 'form';
  const kinds = new Set<string>(d.parts.map((p) => p.kind));
  if (['leading-grand-summary', 'trailing-grand-summary', 'sub-summary-leading', 'sub-summary-trailing'].some((k) => kinds.has(k))) return 'list';
  return body.height < 150 && (kinds.has('header') || kinds.has('top-navigation')) ? 'list' : 'form';
}

/** A field object Tab stops at; `portal` is the portal it sits in. */
interface FieldStop {
  id: number;
  /** The active field: a step (Insert, Paste, Cut, Clear) changed it since the cursor went in. */
  changed?: true;
  name?: string;
  occurrence: string;
  field: string;
  repetition: number;
  portal?: string;
}

interface Frame {
  script: Script;
  store: Store;
  locals: Map<string, Value[]>;
  parameter: Value;
  result: Value;
  originalLayout?: string;
  window: Window;
  /**
   * Each running Loop step: times round, and the engine's record count, step count and window's record (its found
   * set's index there) when it started.
   */
  loops?: Map<number, { passes: number; created: number; steps: number; at?: { window: Window; occurrence: string; index: number }; moved?: boolean }>;
  /**
   * The script's own limits (Script.limits) as the step count and busy time it may reach, each the tightest of its own
   * and the limited scripts that called it, and the script whose limit that is.
   */
  limits?: { steps: number; stepsBy: Frame; busy: number; busyBy: Frame };
}

class Halt extends Error {}

interface EmbeddingAsk { account: string; model: string; input: string }
/** Formulas called GetEmbedding for texts not embedded yet: the step runs again once they are. */
class NeedEmbedding extends HostWait {
  readonly asks: EmbeddingAsk[];
  constructor(asks: EmbeddingAsk[]) {
    super('GetEmbedding');
    this.asks = asks;
  }
}
interface PluginFetchAsk { key: string; via: string; method: string; url: string; headers: Record<string, string>; body: string; allows(url: string): boolean; curl?: MbsCurlRequest }
/** A plug-in asked for a web request not made yet: the step runs again once it has been. */
class NeedFetch extends HostWait {
  readonly ask: PluginFetchAsk;
  constructor(ask: PluginFetchAsk) {
    super('plug-in web request');
    this.ask = ask;
  }
}
interface PluginMailAsk { key: string; via: string; message: OutgoingMail }
/** A plug-in asked to send a message not sent yet: the step runs again once it has been. */
class NeedMail extends HostWait {
  readonly ask: PluginMailAsk;
  constructor(ask: PluginMailAsk) {
    super('plug-in mail');
    this.ask = ask;
  }
}
/** The longest a plug-in's web request may take. */
const PLUGIN_FETCH_MS = 30_000;
/** Request headers a plug-in can't set. */
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade']);
/** Formulas that may call GetEmbedding (or build a call with Evaluate): their step's variables are kept to put back. */
const EMBEDS = /GetEmbedding\s*\(|Evaluate\s*\(/i;
const CURL_PERFORM = /CURL\.Perform|BE_HTTP_|BE_SMTPSend|BE_SMTP_Send/i;
const filesEmbedding = new WeakMap<object, boolean>();
/** Whether any of a file's custom functions may call GetEmbedding. */
function functionsEmbed(store: Store): boolean {
  writer.getStore()?.beforeFile?.(store);
  let v = filesEmbedding.get(store.schema);
  if (v === undefined) filesEmbedding.set(store.schema, v = store.schema.customFunctions.some((c) => EMBEDS.test(c.formula ?? '')));
  return v;
}
const callsEmbedding = new WeakMap<ScriptStep, boolean>();
const CANT_EMBED_HERE = 'GetEmbedding was reached where this step can\'t safely run again; work the embedding out in a Set Variable step first';
const CANT_FETCH_HERE = 'A web request (such as CURL.Perform or BE_HTTP_GET) was reached where this step can\'t safely run again; make the request in a Set Variable step first';
const cantRunAgain = (e: unknown) => (e instanceof NeedFetch ? CANT_FETCH_HERE : CANT_EMBED_HERE);
/** Embeddings a run keeps for GetEmbedding, by account, model and text. */
const EMBEDDINGS_KEPT = 500;

/** Records (or single fields) kept in the read cache during one step before it starts over. */
const READ_CACHE_LIMIT = 2000;

/** What Get ( DocumentsPath ) and Get ( TemporaryPath ) give; file steps map them to the server's folders. */
/** A formula that asks Get ( PageNumber ). */
const PAGE_NUMBER = /\bGet\s*\(\s*PageNumber\s*\)/i;
const DOCUMENTS = '/Documents/';
const TEMPORARY = '/Temporary/';
/** The largest file a script sends to the person's browser (downloads). */
const MAX_DOWNLOAD = 50 * 1024 * 1024;
/** The most of a response Insert from URL takes in; a bigger one fails the step rather than fill the server's memory. */
export const MAX_URL_RESPONSE = 64 * 1024 * 1024;
/** The most a CURL.Perform response may hold. */
const CURL_RESPONSE_MAX = 16 * 1024 * 1024;

/** A response's body, read up to `max` bytes: past that it stops reading and throws. */
/** What --max-filesize allows a response to be, with the words for going over it; the server's own limit when it names none. */
function urlCap(curl: ReturnType<typeof parseCurl> | undefined): [number, string?] {
  const n = curl?.maxFilesize;
  return n !== undefined && n < MAX_URL_RESPONSE ? [n, `the response is over the ${n}-byte limit (--max-filesize)`] : [MAX_URL_RESPONSE];
}
async function readCapped(res: Response, max = MAX_URL_RESPONSE, limit?: string): Promise<Uint8Array> {
  const over = () => new Error(limit ?? `the response is over ${max / 1024 / 1024} MB`);
  if (Number(res.headers.get('content-length')) > max) {
    await res.body?.cancel().catch(() => {});
    throw over();
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw over();
    }
    chunks.push(value);
  }
  return chunks.length === 1 ? chunks[0] : new Uint8Array(Buffer.concat(chunks));
}
const MAX_DATA_FILES = 25;
/** Save Records as PDF [ Append ] reads the PDF it adds to whole: up to this size. */
const MAX_APPEND_PDF = 256 * 1024 * 1024;
/** Insert from Index offers at most this many values. */
const MAX_INDEX_VALUES = 2000;

/** A data file a script opened (Open Data File). */
interface DataFile {
  owner: Store;
  fd: number;
  path: string;
  /** The path as the script named it, for Get ( OpenDataFileInfo ). */
  shown: string;
  position: number;
}

/** Errors that revert an open transaction: privileges, record locks, validation, host capacity. */
const REVERTS_TRANSACTION = (code: number) => code === 9 || (code >= 200 && code < 300) || (code >= 301 && code <= 306) || (code >= 500 && code < 600) || code === 812;

const CONTROL = new Set([68, 69, 70, 71, 72, 73, 89, 90, 103, 125]);
/** Errors that show no dialog with error capture off: a person's cancel, a step this server can't run, a trigger's cancel. */
const SILENT_ERRORS: ReadonlySet<number> = new Set([1, 3, 20]);
/** Go to Record/Request/Page and Go to Portal Row: running off the end is error 101 without a dialog. */
const GO_TO_STEPS: ReadonlySet<number> = new Set([16, 99]);
/** Steps that take the cursor out of the field it is in: Go to Field, Go to Next / Previous Field, Go to Object, Set Selection. */
const OBJECT_EXIT_STEPS: ReadonlySet<number> = new Set([17, 4, 5, 145, 130]);

/** A layout object by id, inside groups, portals and panels too. */
function objectById(objects: LayoutObject[] | undefined, id: number): LayoutObject | undefined {
  for (const o of objects ?? []) {
    if (o.id === id) return o;
    const inner = objectById(o.children, id);
    if (inner) return inner;
  }
  return undefined;
}

/** The first layout object that matches, inside groups, portals and panels too. */
function findObject(objects: LayoutObject[] | undefined, match: (o: LayoutObject) => boolean): LayoutObject | undefined {
  for (const o of objects ?? []) {
    if (match(o)) return o;
    const inner = findObject(o.children, match);
    if (inner) return inner;
  }
  return undefined;
}

/** A layout object by name, inside groups, portals and panels too. */
function objectByName(objects: LayoutObject[] | undefined, name: string): LayoutObject | undefined {
  for (const o of objects ?? []) {
    if (o.name === name) return o;
    const inner = objectByName(o.children, name);
    if (inner) return inner;
  }
  return undefined;
}

/**
 * Steps that commit the record in Browse mode, so the cursor leaves its field: Commit Records/Requests, and the steps
 * that move to another record, layout or found set (Go to Record, Go to Related Record, New Record, Duplicate Record,
 * Go to Layout, Enter Find Mode, Modify Last Find, Show All, Omit, Show Omitted Only, Perform / Constrain / Extend
 * Find, Find Matching Records, Perform Quick Find, Sort Records, Sort Records by Field, Close / New / Select Window).
 * Go to Field with no field commits too.
 */
const COMMITTING_STEPS: ReadonlySet<number> = new Set([75, 16, 74, 7, 8, 6, 22, 24, 23, 25, 26, 27, 28, 126, 127, 155, 150, 39, 154, 121, 122, 123]);
/** Steps that can set off a trigger that runs before its event (and can cancel it): Go to Layout, the Enter ... Mode steps, Commit and Revert Record, the field-leaving and committing steps. */
const BEFORE_TRIGGER_STEPS: ReadonlySet<number> = new Set([...COMMITTING_STEPS, 55, 41, 51, 17, 4, 5, 145, 130]);
/** Steps whose change of record doesn't activate script triggers (Claris, "Actions that don't activate script triggers"). */
const QUIET_STEPS: ReadonlySet<number> = new Set([35, 128]); // Import Records, Perform Find/Replace
/** Steps ScriptEngine.quickStep runs: none of them waits, so a loop of them makes no promise per step. */
/**
 * Steps whose change to a field sets off its object's OnObjectModify (Claris: "script steps such as the Insert Text
 * script step that change a field", and edit operations such as cut, paste and clear): Insert Text, Insert Calculated
 * Result, Insert Current Date / Time / User Name, Insert from Index, Insert from Last Visited, Cut, Paste, Clear.
 * Set Field doesn't.
 */
const MODIFY_STEPS: ReadonlySet<number> = new Set([61, 77, 13, 14, 60, 11, 12, 46, 48, 49]);
const QUICK_STEPS: ReadonlySet<number> = new Set([68, 125, 69, 70, 71, 72, 73, 103, 141, 86, 85, 76, 77]);
const SLOW = Symbol('slow');
const noTiming = (_err: number): void => {};
const STEP_LIMIT = 1_000_000;
const LOOP_RECORD_LIMIT = 100_000;
/** A loop that walks the found set with Go to Record but is still on its first record after this many passes is stuck. */
const STUCK_LOOP_PASSES = 10_000;
const TIMEOUT = 60_000;
const TRACE_LIMIT = 10_000;
const FIND_JSON_BATCH_SIZE = 100;
const FIND_JSON_BYTE_LIMIT = 8 * 1024 * 1024;

/** If / Else If / Else / End If and Loop / End Loop pairs, by step index. */
interface Blocks {
  /** If, Else If, Else -> the next Else If, Else or End If. */
  next: Map<number, number>;
  /** If, Else If, Else -> its End If. */
  end: Map<number, number>;
  /** Loop -> End Loop and End Loop -> Loop. */
  loop: Map<number, number>;
  /** Any step inside a loop -> the innermost End Loop around it. */
  enclosingEnd: Map<number, number>;
  /** Open Transaction -> its Commit Transaction. */
  commit: Map<number, number>;
}

function blocks(steps: ScriptStep[]): Blocks {
  const b: Blocks = { next: new Map(), end: new Map(), loop: new Map(), enclosingEnd: new Map(), commit: new Map() };
  const ifs: number[][] = [];
  const opens: number[] = [];
  const loops: number[] = [];
  const inside: number[][] = [];
  steps.forEach((s, i) => {
    if (!s.enabled) return;
    for (const l of inside) l.push(i);
    switch (s.stepId) {
      case 68: ifs.push([i]); break;
      case 125: case 69: {
        const chain = ifs[ifs.length - 1];
        if (chain) {
          b.next.set(chain[chain.length - 1], i);
          chain.push(i);
        }
        break;
      }
      case 70: {
        const chain = ifs.pop();
        if (chain) {
          b.next.set(chain[chain.length - 1], i);
          for (const c of chain) b.end.set(c, i);
        }
        break;
      }
      case 71: loops.push(i); inside.push([]); break;
      case 205: opens.push(i); break;
      case 206: {
        const open = opens.pop();
        if (open !== undefined) b.commit.set(open, i);
        break;
      }
      case 73: {
        const start = loops.pop();
        const body = inside.pop();
        if (start !== undefined) {
          b.loop.set(start, i);
          b.loop.set(i, start);
          for (const j of body ?? []) if (!b.enclosingEnd.has(j)) b.enclosingEnd.set(j, i);
        }
        break;
      }
    }
  });
  return b;
}

const blockCache = new WeakMap<Script, Blocks>();

/** Field type as the calculation engine names it. */
const calcType = (t: Field['type']): ValueType | 'unknown' =>
  t === 'boolean' || t === 'integer' ? 'number' : t === 'decimal' || t === 'json' || t === 'uuid' ? 'text' : t;

export class ScriptEngine {
  private readonly session: ScriptSession;
  /** This run's global field values, for the store to read and write. */
  get globals(): ScriptSession {
    return this.session;
  }
  private opts: RunOptions;
  private profileNow(): number {
    return this.opts.profileClock?.now() ?? performance.now();
  }
  private readonly windows: Window[] = [];
  /** Ids of the windows Close Window closed this run. */
  private readonly closed: string[] = [];
  private current!: Window;
  private lastError = 0;
  /** The first step of the run that found its record in use by someone else (error 301), kept though a later step succeeds. */
  private recordInUse?: { line: string; message: string };
  private lastDenial?: AccessDenial;
  /** Get ( LastErrorDetail ): safe privilege wording or custom Revert Transaction detail. */
  private lastErrorDetail = '';
  /** An error a step sets while jumping (Open Transaction that can't commit, Revert Transaction's own code). */
  private forced?: { code: number; message?: string; detail?: string; denial?: AccessDenial };
  /** The open transaction; `skipValidation` and `skipAutoEnter` apply to every write inside it. */
  private tx?: { state: Transaction; frame: Frame; window: Window; after: number; skipValidation?: boolean; skipAutoEnter?: boolean };
  /** After a transaction reverts: leave subscripts until this frame, then go on at `to`. */
  private unwinding?: { frame: Frame; to: number; error: number; detail: string; denial?: AccessDenial };
  /** Set Revert Transaction on Error: On unless a running script turned it off. */
  private revertOnError = true;
  /** The step that just ran, when it set an error: for the debugger's Pause on error. */
  private erred?: DebugPoint['previousError'];
  private lastMessageChoice = 0;
  /** Set Error Logging is on: the file whose scripts log, and the custom debug info formula. */
  private errorLogging?: { store: Store; info?: string };
  /** Callback scripts of Perform Script on Server with Callback, run when the top script ends. */
  private readonly callbacks: { running: Promise<RunResult>; store: Store; script: Script; parameter?: string }[] = [];
  /** The PDF Create PDF started, until Close PDF or Cancel PDF. */
  /**
   * The PDF Create PDF or Open PDF started: `base` is a PDF taken as it is (opened, or merged from an Append PDF),
   * `pages` the ones Save Records as PDF made since, which come after it.
   */
  private openPdf?: { base?: Uint8Array; pages: PdfPage[]; title: string; owners: Set<Store> };
  /** Files read while rendering pages kept for a later Close PDF. */
  private pdfFiles?: Set<Store>;
  private errorCapture = false;
  private allowAbort = true;
  /** Set Layout Object Animation: Get ( ScriptAnimationState ). Animations are off while a script runs unless it turns them on. */
  private animations = false;
  private useSystemFormats = false;
  private sessionIdentifier = '';
  private menuSetName?: string;
  /** Get ( LastErrorLocation ): script, step and line of the last error, tab-separated. */
  private lastErrorLocation = '';
  /** Set Error Logging's session number: one per run. */
  private readonly sessionNumber = String(Math.floor(Math.random() * 1e9));
  private lastResult: Value = text('');
  /** What each window showed when its layout triggers last had their chance: a step that changes it fires them. */
  private readonly shown = new Map<Window, Shown>();
  /** View As just showed this window's layout in another view: its OnViewChange runs after the step. */
  private viewChanged?: Window;
  /** Move/Resize Window just changed this window's size: its layout's OnLayoutSizeChange runs after the step. */
  private sizeChanged?: Window;
  /** Windows other than the script's own that Move/Resize Window resized: each one's layout runs OnLayoutSizeChange, in that window. */
  private sizeChangedElsewhere: Window[] = [];
  /** Each window's layout triggers that are running now (file, layout, event), so none sets itself off again. */
  private readonly runningTriggers = new Map<Window, Set<string>>();
  /** The layout the OnLayoutExit check found a Go to Layout step going to, so the step doesn't work it out again. */
  private layoutChosen?: { params: StepParams; name: string | undefined };
  /** The object name the OnObjectExit check worked out for a Go to Object step. */
  private objectChosen?: { params: StepParams; name: string; repetition?: number };
  /** The fields an Insert, Paste, Cut or Clear step changed, for their objects' OnObjectModify; undefined during other steps. */
  private modified?: { win: Window; occurrence: string; field: string }[];
  /** The window name the trigger checks worked out for a Close Window or Select Window step. */
  private windowChosen?: { params: StepParams; name: string | undefined };
  private steps = 0;
  /** Time spent in nested steps during the current step, so each step's own time can be told apart (profiling). */
  private childMs = 0;
  /** Time spent waiting in the debugger, so far. */
  private pausedMs = 0;
  /** Open data files by file ID; closed when the run ends. */
  private readonly dataFiles = new Map<number, DataFile>();
  private nextFileId = 1;
  /** This run's temporary folder (Get ( TemporaryPath )), made when first used and removed at the end. */
  private tempDir?: string;
  /** Calls from calculations back into the script, counted to check the time limit inside a long step. */
  private polls = 0;
  /** The sort last performed on each file's table, for Sort Records with no order of its own. */
  private lastSorts = new Map<string, SortSpec[]>();
  /**
   * Outbound test mode: calls per host, emails written, and the reason to stop
   * once one host has refused too many. Shared with scripts run on the server.
   */
  private tally: { outside: Map<string, OutsideCalls>; mails: number; stop?: string } = { outside: new Map(), mails: 0 };
  private deadline: number;
  /** Time spent waiting for a person (a dialog, a pause, the debugger), which no script's own time limit counts; and when the current wait began. */
  private waited = 0;
  private heldAt?: number;
  /** GetEmbedding's answers in this run. */
  private readonly embeddings = new Map<string, number[]>();
  /** While set, GetEmbedding notes the texts it would need instead of stopping (Replace Field Contents' first pass). */
  private embeddingAsks?: EmbeddingAsk[];
  /** Scripts in progress that have their own limits. */
  private readonly limitedFrames: Frame[] = [];

  /**
   * A wait begins: the run's time limit stops while a person answers or the machine saves a copy or sends mail.
   * Only a person's wait is left out of a script's own time limit.
   */
  private hold(person = true): void {
    this.heldAt = person ? Date.now() : undefined;
    this.deadline = Infinity;
  }

  /** The wait is over: the run's time limit goes on with what was left. */
  private resumeAfter(left: number): void {
    if (this.heldAt !== undefined) this.waited += Date.now() - this.heldAt;
    this.heldAt = undefined;
    this.deadline = Date.now() + left;
  }

  /** Milliseconds spent running so far, not counting waits. */
  private busy(): number {
    return Date.now() - this.waited;
  }
  private readonly actions: ClientAction[] = [];
  private syncVersion = 0;
  private readonly warnings: string[] = [];
  private readonly trace?: TraceLine[];
  private executionStore?: Store;
  private identityStore?: Store;
  private identityVia?: string;
  private diagnostics = new CredentialRedactor();
  // Provenance belongs to a variable repetition, not its text: an equal field/SQL/calc result is still hidden.
  private diagnosticLiterals = new WeakMap<Value[], Map<number, Value>>();
  /** Recordings use the run's discovered names and values for committed audit data too. */
  redactDiagnosticValue(value: string, name: string): string {
    return this.diagnostics.value(value, name);
  }
  private initiatingPrivileges?: Privileges;
  private outboundIdentity?: { file: string; account: string };
  private pluginAccount?: string;
  private localIdentities = new WeakMap<Store, Set<string>>();

  private hiddenSource(store: Store, script: Script): boolean {
    // Diagnostics must not refresh privileges from an isolated file's schema.
    try { this.opts.beforeFile?.(store); } catch (e) {
      rethrowExecutionRefusal(e);
      if ((e instanceof ScriptError || e instanceof StoreError) && e.code === 3) return true;
      throw e;
    }
    return !!this.initiatingPrivileges && this.initiatingPrivileges.in(store).script(script.name) !== 'modifiable';
  }

  private requireIdentity(store: Store, account: string, via?: string): void {
    if (store.mustChangePassword(account)) throw new StoreError(212, 'This account must change its password before continuing');
    if (!via) { store.requireActiveAccount(account); return; }
    store.requireActiveAccount(via);
    const key = account.toLowerCase();
    let local = this.localIdentities.get(store);
    if (store.accounts().some((a) => a.name.toLowerCase() === key)) {
      if (!local) this.localIdentities.set(store, (local = new Set()));
      local.add(key);
    }
    // A person known to have a local account cannot fall back to their mapping after deletion.
    if (local?.has(key)) store.requireActiveAccount(account);
  }

  /** Account refusals at execution boundaries and file guards cannot become handleable step errors. */
  private enforceExecution(frameStore: Store, fileGuard?: () => void): void {
    try {
      if (fileGuard) fileGuard();
      else this.checkExecution(frameStore);
    } catch (e) {
      // File guards also refuse isolation (3) and access (9), which keep their
      // ordinary semantics. Only their account refusal is an execution halt.
      if (e instanceof Error && (!fileGuard || (e as { code?: number }).code === 212)) markExecutionRefusal(e);
      throw e;
    }
  }

  private checkExecution(frameStore: Store): void {
    if (this.opts.executionAccount === undefined) return;
    this.requireIdentity(this.executionStore!, this.opts.executionAccount, this.opts.executionVia);
    if (this.opts.account !== undefined && (this.identityStore !== this.executionStore ||
      this.opts.account.toLowerCase() !== this.opts.executionAccount.toLowerCase() || this.identityVia !== this.opts.executionVia)) {
      this.requireIdentity(this.identityStore!, this.opts.account, this.identityVia);
    }
    // Retain both sets of mappings when executing a subscript in another file.
    for (const target of new Set([frameStore, this.windows.length ? this.current.store : frameStore])) {
      for (const [p, via] of [[this.initiatingPrivileges, this.opts.executionVia], [this.opts.privileges, this.identityVia]] as const) {
        if (p && p.file !== target) this.requireIdentity(target, p.in(target).account, via);
      }
    }
  }
  private calcError = 0;
  private calcMessage?: string;
  /** What Copy or Cut last put on the clipboard, for Paste in the same run. */
  private clipboard?: Value;
  /** Paste asked for the person's own clipboard already this run (opts.clipboard). */
  private clipboardAsked = false;
  /** The frame whose step is running (auto-enter formulas evaluate in it). */
  private frame?: Frame;
  /** Scripts in progress and the step each is on, for the debugger. */
  private readonly stack: { frame: Frame; pc: number }[] = [];
  /**
   * Every file supplying scripts or hosted import data, finished calls included. Its data can remain in
   * records, results or variables, so a capture-only file (or one kept from AI) still counts. Shared with
   * server subsessions because their record writes can be visible before either run finishes.
   */
  private sourceFiles = new Set<string>();
  /** Actual programs, including unsaved scripts and completed subcalls, for the AI read-set check. */
  private readonly aiPrograms = new Map<string, Set<Script>>();
  /** Variable names as the script wrote them (they are kept lowercased), for the debugger. */
  private readonly varNames = new Map<string, string>();
  private readonly namesCache = new Map<string, NameTable>();
  /** Record values read during one step (cleared after each step, as steps change records). */
  private readonly readCache = new Map<string, FieldData>();

  /** Aborted when an administrator cancels the run (opts.stop, or the server queue's signal). */
  private stopSignal?: AbortSignal;

  /** Stops an in-flight outbound request and ends the run at its next step. Set before running. */
  stopOn(signal: AbortSignal): void {
    this.stopSignal = signal;
  }

  /** Ends the run when it was canceled, from the admin console or (while Allow User Abort is on) by the person running it. */
  private canceled(script: string): void {
    if (this.stopSignal?.aborted) {
      this.actions.push({ step: 'Halt Script', script, reason: 'canceled from the admin console' });
      throw new Halt();
    }
    if (this.userAborted) {
      this.actions.push({ step: 'Halt Script', script, reason: 'canceled by the user' });
      throw new Halt();
    }
  }

  /** The person asked to stop at a moment the script let them (Allow User Abort on, not waiting on them). */
  private userAborted = false;
  private readonly userCancellation = new AbortController();
  private work?: ReturnType<typeof cancellationScope>;
  private workCleanup: (() => void)[] = [];
  private disposeWork(): void {
    this.work?.dispose();
    for (const clean of this.workCleanup) clean();
  }
  private readonly onUserStop = () => {
    if (this.allowAbort && this.heldAt === undefined) {
      this.userAborted = true;
      this.userCancellation.abort();
    }
  };

  constructor(opts: RunOptions = {}) {
    this.initiatingPrivileges = opts.privileges;
    this.opts = opts.beforeFile ? { ...opts, beforeFile: (file) => {
      this.enforceExecution(file, () => opts.beforeFile!(file));
      this.pdfFiles?.add(file);
    } } : opts;
    if (opts.stop) this.stopSignal = opts.stop;
    opts.userStop?.addEventListener('stop', this.onUserStop);
    this.session = opts.session ?? new ScriptSession();
    this.deadline = Date.now() + (opts.timeoutMs ?? TIMEOUT);
    if (opts.trace) this.trace = [];
  }

  private observeDenial(e: unknown, code: number): AccessDenial | undefined {
    const denial = denialOf(e);
    if (denial) {
      try { this.opts.onAccessDenial?.(denial, code); } catch (e) { rethrowExecutionRefusal(e); /* other observation errors cannot change execution */ }
    }
    return denial;
  }

  /** Runs a script (by name or object) of a hosted store. */
  async run(store: Store, script: string | Script): Promise<RunResult> {
    // The audit log names the script that made a change (the innermost one running).
    const name = typeof script === 'string' ? script : script.name;
    try {
      this.outboundIdentity ??= {
        file: realpathSync((this.executionStore ?? this.opts.executionStore ?? store).path),
        account: (this.opts.executionAccount ?? this.initiatingPrivileges?.account ?? this.opts.account ?? '').toLowerCase(),
      };
      // Commits and operator callbacks must not pass script cancellation or capacity to their listeners/timers.
      const outer = writer.getStore();
      return await outboundContext.exit(() =>
        writer.run({ ...outer, globals: this.globals, transaction: outer?.transaction ?? {},
          ...(name ? { script: name } : {}), ...(this.opts.beforeFile ? { beforeFile: this.opts.beforeFile } : {}) }, () => this.runChecked(store, script)));
    } finally {
      this.opts.userStop?.removeEventListener('stop', this.onUserStop);
      // Caller-owned sessions survive script runs; an engine's private session ends with its run.
      if (!this.opts.session) this.session.close();
    }
  }

  private async runChecked(store: Store, script: string | Script): Promise<RunResult> {
    this.opts.beforeFile?.(store);
    const s = typeof script === 'string' ? findScript(store, script) : script;
    if (!s) throw new ScriptError(ERROR.scriptMissing, `Script "${script}" is missing`);
    const began = this.profileNow();
    try {
      // Named entry scripts need the same execution grant as Perform Script.
      // Anonymous single-step buttons are governed by the step's own checks.
      if (typeof script === 'string' || store.schema.scripts.some((known) => known.id === s.id && known.name === s.name)) {
        this.opts.privileges?.in(store).checkScript(s.name);
      }
      const r = await this.runTop(store, s);
      this.opts.profile?.run(store.name, s.name, this.profileNow() - began, r.error, this.steps);
      return r;
    } catch (e) {
      this.observeDenial(e, e instanceof StoreError || e instanceof PrivilegeError || e instanceof ScriptError ? e.code : -1);
      this.opts.profile?.run(store.name, s.name, this.profileNow() - began, -1, this.steps);
      throw e;
    }
  }

  private async runTop(store: Store, s: Script): Promise<RunResult> {
    this.executionStore ??= this.opts.executionStore ?? store;
    // Charge the initiating database/account across sessions, Full Access, Re-Login and external subscripts.
    this.pluginAccount ??= JSON.stringify([this.executionStore.path,
      (this.opts.executionAccount ?? this.opts.account ?? this.initiatingPrivileges?.account ?? '').toLowerCase()]);
    if (!this.identityStore) {
      this.identityStore = this.executionStore;
      this.identityVia = this.opts.executionVia;
    }
    this.enforceExecution(store);
    const fields = store.schema.tables.flatMap((t) => t.fields.map((f) => f.name));
    this.diagnostics = new CredentialRedactor({ fields, occurrences: store.schema.tableOccurrences.map((to) => [to.name, fields]) });
    this.diagnosticLiterals = new WeakMap();
    this.diagnostics.inspect([...store.schema.scripts, s], store.schema.customFunctions.map((cf) => cf.name));
    const start = this.opts.startWindow;
    // The person's other windows in this file, behind the start one (frontmost last).
    const others = (this.opts.openWindows ?? []).filter((w) => w.id !== start?.id).slice(-50);
    for (const o of others) {
      this.windows.push({
        name: o.name, store, id: o.id, style: o.style ?? 'document', geometry: geometryOf(o), unloaded: o.layout ?? '', untouched: true,
        mode: 'browse', foundSets: new Map(), requests: [], requestIndex: 0, pending: new Map(), uncommittedNew: false,
        ...(o.foundSet ? { initialFoundSet: { ids: [...o.foundSet], index: Math.max(0, o.foundSet.indexOf(o.recordId ?? -1)), sort: o.sort } } : {}),
      });
    }
    const win = this.openWindow(store, this.opts.layout, start?.name || store.name);
    if (start) Object.assign(win, { id: start.id, style: start.style ?? 'document', geometry: geometryOf(start) });
    win.activeObjectId = this.opts.activeObjectId;
    if (this.opts.preview) win.preview = true;
    if (this.opts.view && this.views(win).includes(this.opts.view)) win.view = this.opts.view;
    if (this.opts.foundSet && win.layout) {
      const index = this.opts.recordId === undefined ? 0 : Math.max(0, this.opts.foundSet.indexOf(this.opts.recordId));
      win.foundSets.set(win.layout.occurrence, { ids: [...this.opts.foundSet], index });
    }
    const last = this.opts.lastVisited;
    if (last && win.layout) {
      let info: LayoutInfo | undefined;
      try {
        info = store.layout(last.layout);
      } catch {
        // A layout gone or renamed since: nothing is remembered.
      }
      // That record was the one its table was on; the next record this window shows in that table makes it the last visited.
      if (info?.table) (win.visited ??= new Map()).set(`${info.owner.name}\u0000${info.table}`, { current: last.recordId });
    }
    if (this.opts.mode === 'find') {
      win.mode = 'find';
      win.requests = this.opts.requests?.length ? this.opts.requests.map((r) => ({ criteria: { ...r.criteria }, omit: r.omit })) : [{ criteria: {}, omit: false }];
    }
    if (this.opts.activeObject !== undefined) this.startIn(win, this.opts.activeObject);
    if (this.opts.startedBy && win.layoutName) {
      const by = this.opts.startedBy;
      this.runningTriggers.set(win, new Set([`${store.name}\u0000${win.layoutName}${by.objectId !== undefined ? `\u0000${by.objectId}` : ''}\u0000${by.event}`]));
    }
    // What the person sees as the script starts: going on as it is fires nothing.
    for (const w of this.windows) this.shown.set(w, w.unloaded !== undefined ? { layout: w.unloaded, mode: 'browse', unloaded: true } : this.shownNow(w));
    let halted = false;
    let result: Value = text('');
    let end: Window;
    let active: ActiveField | null | undefined;
    try {
      try {
        result = await this.perform(store, s, text(this.opts.parameter ?? ''), win,
          new Map(Object.entries(this.opts.variables ?? {}).filter(([n]) => /^\$[^$]/.test(n)).map(([n, v]) => [n.toLowerCase(), [text(v)]])));
      } catch (e) {
        if (!(e instanceof Halt)) throw e;
        halted = true;
      }
      if (await this.runCallbacks()) halted = true;
      // Where the cursor is before the last commit, which here (unlike FileMaker) also takes it out of the field: the person's window keeps it there.
      end = this.current;
      active = end.focusMoved ? this.activeState(end) : undefined;
      // Edits that still can't be committed when the script ends are lost, as when FileMaker closes the window.
      for (const w of this.windows) {
        // A person's own stop commits like Halt Script; only an external cancellation discards edits.
        if (halted && this.stopSignal?.aborted) this.revert(w);
        else this.commitOrDrop(w);
      }
    } catch (e) {
      // A run that fails leaves no record locked behind it.
      for (const w of this.windows) this.unlockEdits(w);
      throw e;
    } finally {
      for (const d of this.dataFiles.values()) closeSync(d.fd);
      this.dataFiles.clear();
      if (this.tempDir) rmSync(this.tempDir, { recursive: true, force: true });
    }
    // That last commit took the cursor out of its field here only: where it was before it is what the window shows.
    const state = this.windowState();
    if (this.current === end) delete state.active;
    const outcome: RunResult = {
      result: asText(result, this.current.store.dateOrder),
      // Canceled from the admin console: "user canceled action", for a Perform Script on Server caller and the schedule's history.
      error: halted && this.stopSignal?.aborted ? 1 : this.lastError,
      halted,
      ...state,
      ...(active !== undefined && this.current === end ? { active } : {}),
      ...(this.current.id ? { window: this.endWindow(this.current) } : {}),
      ...(this.closed.length ? { closed: this.closed } : {}),
      steps: this.steps,
      ...(this.recordInUse ? { recordInUse: this.recordInUse } : {}),
      actions: this.actions,
      ...(this.warnings.length ? { warnings: this.warnings } : {}),
      ...(this.trace ? { trace: this.trace } : {}),
      ...(this.tally.outside.size ? { outside: [...this.tally.outside.values()].sort((a, b) => b.calls - a.calls) } : {}),
      ...(this.tally.mails ? { mail: this.tally.mails } : {}),
    };
    if (outcome.error === this.lastError) retainDenial(outcome, this.lastDenial);
    return outcome;
  }

  /**
   * Records a call to an outside service in test mode. Once one host has
   * refused the limit, the run stops at the next step: a script that loops
   * over records calling a blocked service would otherwise try it for each.
   */
  private noteOutbound(out: OutboundTest, entry: OutboxEntry): void {
    out.record(entry);
    if (entry.kind === 'mail') {
      this.tally.mails++;
      return;
    }
    let o = this.tally.outside.get(entry.host);
    if (!o) this.tally.outside.set(entry.host, (o = { host: entry.host, via: [], calls: 0, sent: 0 }));
    o.calls++;
    if (!o.via.includes(entry.via)) o.via.push(entry.via);
    if (entry.allowed) o.sent++;
    const refused = o.calls - o.sent;
    if (!entry.allowed && refused === (out.refusedCallLimit ?? REFUSED_CALL_LIMIT) && !this.tally.stop) {
      const what = entry.host || 'a web address with no host (probably built from an empty field)';
      this.tally.stop = `refused-call limit reached: the script keeps calling ${what}, which test mode blocks (${refused} calls)`;
    }
  }

  /**
   * Perform Script on Server with Callback: once the script that started it
   * ends, each callback script runs in turn, after its server script finishes,
   * with Get ( ScriptResult ) and Get ( LastError ) from the server script.
   * Returns true when cancellation interrupts outstanding callback work.
   */
  private async runCallbacks(): Promise<boolean> {
    let canceled = false;
    while (this.callbacks.length) {
      if (this.stopSignal?.aborted || this.userAborted) {
        for (const cb of this.callbacks.splice(0)) cb.running.catch(() => {});
        return true;
      }
      const cb = this.callbacks.shift()!;
      let outcome: { result: string; error: number };
      let denial: AccessDenial | undefined;
      try {
        const r = await this.serverAnswer(cb.running, cb.script.name);
        outcome = { result: r.result.slice(0, SERVER_TEXT_LIMIT), error: r.error };
        denial = scriptDenial(r);
      } catch (e) {
        rethrowExecutionRefusal(e);
        if (e instanceof Halt) {
          for (const pending of this.callbacks.splice(0)) pending.running.catch(() => {});
          return true;
        }
        outcome = { result: '', error: e instanceof ScriptError ? e.code : ERROR.unavailable };
        denial = this.observeDenial(e, outcome.error);
      }
      this.lastResult = text(outcome.result);
      this.lastError = outcome.error;
      this.lastDenial = denial;
      this.lastErrorDetail = denial ? explainAccessDenial(denial).explanation : '';
      try {
        this.opts.privileges?.in(cb.store).checkScript(cb.script.name);
        // Worked out now, on the window as it is, with no script running: a caller's $variables have no value.
        const idle: Frame = { script: { id: 0, name: '', steps: [] } as unknown as Script, store: cb.store, locals: new Map(), parameter: text(''), result: text(''), window: this.current };
        const parameter = cb.parameter !== undefined ? this.eval(idle, cb.parameter) : text('');
        await this.perform(cb.store, cb.script, parameter, this.current);
      } catch (e) {
        rethrowExecutionRefusal(e);
        // A skipped callback script: not run, and the run's other callbacks go on.
        if (e instanceof ScriptError && this.opts.skip?.(cb.script.name)) {
          this.lastError = e.code;
          this.lastDenial = undefined;
          this.lastErrorDetail = '';
        }
        // A denied or skipped callback never runs, and the run's other callbacks go on.
        if (e instanceof PrivilegeError || (e instanceof ScriptError && this.opts.skip?.(cb.script.name))) this.lastError = e.code;
        else if (!(e instanceof Halt)) throw e;
        else if (this.stopSignal?.aborted || this.userAborted) canceled = true;
      }
    }
    return canceled;
  }

  // --- windows, layouts, found sets -----------------------------------------

  /** The current window's layout, found set, record and mode. */
  private windowState(): WindowState & { foundCount: number } {
    const end = this.current;
    // One of the person's windows the script never worked in: its state is the client's, so only its layout is said.
    if (end.unloaded !== undefined) return { ...(end.unloaded ? { layout: end.unloaded } : {}), foundCount: 0, mode: 'browse' };
    // Report the retained window state without reading its owner again after a refused step.
    const fs = end.layout ? end.foundSets.get(end.layout.occurrence) : undefined;
    return {
      syncVersion: this.syncVersion,
      ...(end.id ? { window: this.endWindow(end) } : {}),
      layout: end.layoutName,
      foundCount: fs?.ids.length ?? 0,
      recordId: fs?.ids[fs.index],
      ...(fs ? { foundSet: [...fs.ids] } : {}),
      ...(fs?.sort ? { sort: fs.sort } : {}),
      mode: end.mode,
      ...(end.preview ? { preview: true } : {}),
      ...(end.focusMoved ? { active: this.activeState(end) } : {}),
    };
  }

  private activeState(win: Window): ActiveField | null {
    const a = win.activeField;
    if (!a) return null;
    return {
      objectId: a.id,
      ...(a.portal && win.portal ? { portal: a.portal, row: win.portal.row } : {}),
      ...(win.selection ? { selection: win.selection } : {}),
    };
  }

  /** The cursor leaves the field it is in (a record exited, another layout). */
  private leaveField(win: Window): void {
    if (win.activeField) win.focusMoved = true;
    win.activeField = undefined;
    win.activeObjectId = undefined;
    win.selection = undefined;
  }

  /** Pause/Resume Script: a person sees the window and clicks Continue or Cancel. */
  private async pause(f: Frame): Promise<void> {
    for (const w of this.windows) this.commitOrDrop(w);
    const left = this.deadline - Date.now();
    this.hold();
    const go = await this.opts.pause!({ script: f.script.name, actions: this.actions.slice(), state: this.windowState() });
    this.resumeAfter(left);
    if (!go) throw new Halt();
  }

  /**
   * Show Custom Dialog. With someone to answer (the dialog option) it waits
   * for their button; otherwise the first button is chosen. Input fields store
   * what was typed when the chosen button has its Commit option on (by
   * default all but the second, Cancel). That default is inferred from the
   * flags in sample files and FileMaker's dialog, not documented.
   */
  /**
   * With error capture off, a step that fails shows the error to the person, with Cancel (which halts the
   * script, as Halt Script does) and Continue. Only in a window someone is looking at: a run with no one to
   * answer (a schedule, the Data API) carries on, as on FileMaker Server. Not for a person's own cancel, a
   * step this server can't run (error 3: WebDirect skips those quietly), a trigger's cancel, or running off the
   * end of the records with Go to Record (inferred: FileMaker shows nothing there either).
   */
  private async errorDialog(f: Frame, step: ScriptStep, error: number): Promise<void> {
    if (!this.opts.dialog || this.opts.errorDialogs === false || SILENT_ERRORS.has(error) || (error === ERROR.recordMissing && GO_TO_STEPS.has(step.stepId))) return;
    const left = this.deadline - Date.now();
    this.hold();
    let answer: { button: number } | undefined;
    try {
      answer = await this.opts.dialog({
        script: f.script.name, title: f.store.name,
        message: `${errorMeaning(error) ?? 'An error occurred'} (error ${error}). "${step.name}" in script "${f.script.name}" couldn't be completed.`,
        buttons: ['Continue', 'Cancel'], inputs: [], actions: this.actions.slice(), state: this.windowState(),
      });
    } finally {
      this.resumeAfter(left);
    }
    // Closing the dialog is Cancel, as Esc is in FileMaker.
    if (answer?.button !== 1) throw new Halt();
  }

  private async customDialog(f: Frame, p: StepParams, name: string): Promise<void> {
    const calc = (x: string | undefined) => (x === undefined ? '' : asText(this.eval(f, x)));
    const buttons = p.buttons?.length ? p.buttons.map(calc) : ['OK'];
    const title = calc(p.title);
    const message = calc(p.message);
    const inputs = (p.inputs ?? []).map((x) => ({
      label: calc(x.label),
      value: x.field ? asText(this.readField(this.current, { occurrence: x.field.tableOccurrence.name, field: x.field.field.name, repetition: Number(x.field.repetition ?? 1) || 1 }) ?? text('')) : x.variable ? asText(this.eval(f, x.variable)) : '',
      // FileMaker's Use password character option isn't decoded from files, so a label naming a password stands in for it.
      password: x.password ?? /password|passwort|mot de passe|contrase/i.test(calc(x.label)),
    }));
    if (!this.opts.dialog) {
      this.actions.push({ step: name, script: f.script.name, title, message, buttons });
      this.lastMessageChoice = 1;
      return;
    }
    const left = this.deadline - Date.now();
    this.hold();
    let answer: { button: number; inputs?: string[] } | undefined;
    try {
      answer = await this.opts.dialog({ script: f.script.name, title, message, buttons, inputs, actions: this.actions.slice(), state: this.windowState() });
    } finally {
      this.resumeAfter(left);
    }
    const shown = buttons.filter((b) => b !== '').length || 1;
    const button = answer && Number.isInteger(answer.button) && answer.button >= 1 && answer.button <= Math.max(shown, buttons.length) ? answer.button : shown;
    this.lastMessageChoice = button;
    const commit = p.commit?.[button - 1] ?? button !== 2;
    if (!commit || !answer) return;
    (p.inputs ?? []).forEach((x, i) => {
      const typed = answer.inputs?.[i];
      if (typed === undefined) return;
      const value = typed.slice(0, SERVER_TEXT_LIMIT);
      if (x.variable && !x.field) this.setVariable(f, x.variable, 1, text(value));
      else if (x.field) this.setField(f, { field: x.field }, text(value));
    });
  }

  /** The window as the client draws it. */
  private endWindow(w: Window): EndWindow {
    const style = w.style ?? 'document';
    return {
      id: w.id!, name: w.name, style, ...w.geometry,
      ...(style === 'card' ? { dimParent: true, closeButton: true } : {}),
      ...(w.untouched ? { untouched: true } : {}),
    };
  }

  /** A window the script is about to work in: one of the person's windows goes to its layout first. */
  private use(w: Window): Window {
    w.untouched = false;
    if (w.unloaded === undefined) return w;
    const layout = w.unloaded;
    w.unloaded = undefined;
    const first = layout && w.store.layouts().some((l) => l.name === layout) ? layout : w.store.layouts().find((l) => l.table)?.name;
    try {
      if (first) {
        this.goToLayout(w, first);
        // Older clients supply no found set: keep it empty rather than changing an arbitrary record.
        if (w.layout) w.foundSets.set(w.layout.occurrence, w.initialFoundSet ?? { ids: [], index: 0 });
        w.initialFoundSet = undefined;
      }
    } catch (e) {
      rethrowExecutionRefusal(e);
      // A layout this account can't see (or gone since): the window stays without one; the step says what's wrong.
      if (!(e instanceof ScriptError || e instanceof StoreError || e instanceof PrivilegeError)) throw e;
    }
    return w;
  }

  private openWindow(store: Store, layout?: string, name = store.name, privileges = this.privileges): Window {
    this.opts.beforeFile?.(store);
    const win: Window = {
      name, store, mode: 'browse', foundSets: new Map(), requests: [], requestIndex: 0,
      pending: new Map(), uncommittedNew: false,
    };
    const first = layout ?? store.layouts().find((l) => l.table)?.name;
    if (first) this.goToLayout(win, first, privileges);
    this.windows.push(win);
    this.current = win;
    return win;
  }

  /**
   * Opens another hosted file that no window shows yet, as a step does (Open File, or Perform Script of one of its
   * scripts): a hidden window on the file's "Switch to layout" when the account can see it (else its first layout),
   * where the file's OnFirstWindowOpen script then runs, as when the file is opened by hand (inferred: Claris says it
   * runs "after the first window of a file is opened", however that happens). The script's own window stays current.
   */
  private async openFile(f: Frame, store: Store): Promise<Window> {
    const caller = this.current;
    const options = store.schema.fileOptions;
    let win: Window | undefined;
    if (options?.openLayout && store.layouts().some((l) => l.name === options.openLayout)) {
      try {
        win = this.openWindow(store, options.openLayout, store.name, this.opts.privileges);
      } catch (e) {
        rethrowExecutionRefusal(e);
        if (!(e instanceof StoreError || e instanceof PrivilegeError)) throw e;
      }
    }
    win ??= this.openWindow(store, undefined, store.name, this.opts.privileges);
    this.current = caller;
    const trigger = options?.onFirstWindowOpen;
    if (trigger) {
      this.current = win;
      try {
        await this.runTrigger(f, win, [{ event: 'OnFirstWindowOpen', scriptId: trigger.scriptId }], '', 'OnFirstWindowOpen', 'browse');
      } finally {
        this.current = caller;
        f.window = caller;
      }
      // The script closed the window it ran in: the file opens again on a plain window, without running it again.
      if (!this.windows.includes(win)) {
        win = this.openWindow(store, undefined, store.name, this.opts.privileges);
        this.current = caller;
      }
    }
    // The first window is a window too: OnWindowOpen follows OnFirstWindowOpen (Claris's order).
    await this.runWindowTrigger(f, win, 'OnWindowOpen');
    if (!this.windows.includes(win)) {
      win = this.openWindow(store, undefined, store.name, this.opts.privileges);
      this.current = caller;
    }
    return win;
  }

  private goToLayout(win: Window, name: string, privileges = this.privileges): void {
    privileges?.in(win.store).checkLayout(name); // 105 for a layout the account can't see
    let info: LayoutInfo | undefined;
    try {
      info = win.store.layout(name); // throws 105 when missing
    } catch (e) {
      rethrowExecutionRefusal(e);
      // A layout whose table occurrence the reader could not decode: use a TO of
      // the same name when there is one, else treat it as a layout with no table.
      if (!win.store.layouts().some((l) => l.name === name)) throw e;
      try { info = win.store.occurrence(name); } catch (e) { rethrowExecutionRefusal(e); info = undefined; }
    }
    this.commit(win);
    if (win.layoutName !== name) win.view = undefined;
    win.layout = info;
    win.layoutName = name;
    win.portal = undefined;
    this.leaveField(win);
    if (!info) return;
    if (!win.foundSets.has(info.occurrence)) {
      // FileMaker keeps one found set per base table in a window, even when
      // layouts use different occurrences of that table.
      const sameTable = [...win.foundSets].find(([to]) => {
        const other = win.store.occurrence(to);
        return other.owner === info.owner && other.table === info.table;
      })?.[1];
      win.foundSets.set(info.occurrence, sameTable ?? { ids: info.owner.findIds(info, { privileges }), index: 0 });
    }
    if (win.mode === 'find' && !win.requests.length) win.requests = [{ criteria: {}, omit: false }];
  }

  /** Layout Setup's views allowed for the window's layout: all three unless the layout limits them. */
  private views(win: Window): LayoutView[] {
    let design: ReturnType<Store['design']> | undefined;
    try { design = win.layoutName ? win.store.design(win.layoutName) : undefined; } catch (e) { rethrowExecutionRefusal(e); design = undefined; }
    return design?.viewsAllowed?.length ? design.viewsAllowed : ['form', 'list', 'table'];
  }

  /** The view the window shows its layout in: what View As chose, else the layout's own (Layout Setup's default view). */
  private viewOf(win: Window): LayoutView {
    if (win.view) return win.view;
    let design: ReturnType<Store['design']> | undefined;
    try { design = win.layoutName ? win.store.design(win.layoutName) : undefined; } catch (e) { rethrowExecutionRefusal(e); design = undefined; }
    const allowed = design?.viewsAllowed?.length ? design.viewsAllowed : ['form', 'list', 'table'] as LayoutView[];
    const own = design ? ownView(design) : 'form';
    return allowed.includes(own) ? own : allowed[0];
  }

  private shownNow(w: Window): Shown {
    const mode: TriggerMode = w.preview ? 'preview' : w.mode;
    const a = w.activeField;
    const object = a ? { object: a.portal ? `${a.id}:${w.portal?.occurrence === a.portal ? w.portal.row : 1}` : String(a.id) } : {};
    if (!w.layout) return { layout: w.layoutName, mode, ...object };
    if (w.mode === 'find') return { layout: w.layoutName, mode, record: `request ${w.requestIndex}`, ...object };
    // Without making the found set: a layout whose set isn't read yet has shown no record.
    const fs = w.foundSets.get(w.layout.occurrence);
    const id = fs?.ids[fs.index];
    return { layout: w.layoutName, mode, ...(id !== undefined ? { record: String(id) } : {}), ...object };
  }

  /**
   * A step took the window to another layout, mode or record: its layout's script triggers fire, as they do in
   * FileMaker when a script step does what a person would (Claris: "Script triggers can be activated by user actions
   * or by scripts"). Each runs at once, before the next step, in FileMaker's order (OnLayoutEnter, OnModeEnter,
   * OnRecordLoad); the step's Get ( LastError ) and Get ( ScriptResult ) are kept. The ones that run before their
   * event are beforeTriggers'.
   */
  private async layoutTriggers(f: Frame, stepId: number): Promise<void> {
    // Windows Move/Resize Window resized by name: their layouts' OnLayoutSizeChange, each in its own window.
    const elsewhere = this.sizeChangedElsewhere;
    this.sizeChangedElsewhere = [];
    for (const target of elsewhere) {
      if (this.unwinding || target.unloaded !== undefined || !target.layoutName || !this.windows.includes(target)) continue;
      this.opts.beforeFile?.(target.store);
      const other = target.store.design(target.layoutName);
      // The trigger's script sees its own window (Get ( WindowName ), a window's size), then the script's window is current again.
      const caller = this.current;
      this.current = target;
      try {
        await this.runTrigger(f, target, other?.triggers, `${other?.name}`, 'OnLayoutSizeChange', target.preview ? 'preview' : target.mode);
      } finally {
        if (this.windows.includes(caller)) this.current = caller;
        f.window = this.current;
      }
    }
    const w = this.current;
    // One of the person's windows that no step has worked in yet: it still shows what it showed.
    if (w.unloaded !== undefined) return;
    const was = this.shown.get(w);
    const now = this.shownNow(w);
    // View As showed the layout in another view: OnViewChange, after the step (Claris: "after you switch views ... in a script step").
    const viewChanged = this.viewChanged === w;
    this.viewChanged = undefined;
    // Claris: OnLayoutSizeChange runs when a window's size changes "by script step", and "when a window is first opened".
    const sized = this.sizeChanged === w;
    this.sizeChanged = undefined;
    if (was && was.layout === now.layout && was.mode === now.mode && was.record === now.record && was.object === now.object && !viewChanged && !sized) return;
    this.shown.set(w, now);
    // One of the person's windows, loaded when a step needed it, shows what it showed before (or, when the client
    // didn't say which layout, the one it opens on).
    if (was?.unloaded && (!was.layout || was.layout === now.layout)) return;
    // Steps FileMaker lists as not activating triggers: the window shows their result, quietly.
    if (QUIET_STEPS.has(stepId) || this.unwinding) return;
    const entered = !was || was.layout !== now.layout;
    const events = [
      // A window just opened: the file's OnWindowOpen comes before the layout's own triggers (Claris's order).
      ...(!was ? ['OnWindowOpen'] : []),
      ...(entered ? ['OnLayoutEnter'] : []),
      ...(was && !entered && was.mode !== now.mode ? ['OnModeEnter'] : []),
      ...(now.record !== undefined && (entered || was!.mode !== now.mode || was!.record !== now.record) ? ['OnRecordLoad'] : []),
      ...(!was || sized ? ['OnLayoutSizeChange'] : []),
      // Last in Claris's order. Going to a layout shows it in its own view; that isn't a switch.
      ...(viewChanged && !entered ? ['OnViewChange'] : []),
    ];
    const design = now.layout ? w.store.design(now.layout) : undefined;
    for (const event of events) {
      // A trigger before it took the window elsewhere: the triggers of where it went have had their turn. One that
      // reverted the transaction: the scripts unwind now.
      if (this.current !== w || this.shown.get(w) !== now || this.unwinding) return;
      if (event === 'OnWindowOpen') await this.runWindowTrigger(f, w, 'OnWindowOpen');
      else await this.runTrigger(f, w, design?.triggers, `${design?.name}`, event, now.mode);
    }
    // The cursor went into a field (Go to Field, Go to Object, Go to Next Field): its OnObjectEnter.
    if (now.object !== undefined && now.object !== was?.object && this.current === w && this.shown.get(w) === now && !this.unwinding) {
      const id = Number(now.object.split(':')[0]);
      await this.runTrigger(f, w, objectById(design?.objects, id)?.triggers, `${design?.name}\u0000${id}`, 'OnObjectEnter', now.mode);
    }
  }

  /**
   * Before a step leaves the layout, leaves the mode, or commits or reverts a changed record: the layout's trigger for
   * that runs first, and exiting with False (Exit Script [ Result: False ]) cancels the step, which then sets error 20
   * ("Command/operation canceled by triggered script"). False when it was canceled.
   */
  private async beforeTriggers(f: Frame, s: ScriptStep): Promise<boolean> {
    const w = this.current;
    if (w.unloaded !== undefined || !w.layoutName || this.unwinding) return true;
    const mode: TriggerMode = w.preview ? 'preview' : w.mode;
    const p = s.params ?? {};
    const changed = w.mode === 'browse' && (w.pending.size > 0 || w.uncommittedNew);
    let event: string | undefined;
    switch (s.stepId) {
      case 6: {
        let to: string | undefined;
        try { to = this.layoutTarget(f, p); } catch (e) { rethrowExecutionRefusal(e); return true; } // the step itself says what's wrong
        this.layoutChosen = { params: p, name: to };
        // A layout that isn't there: the step fails before it commits or leaves.
        if (to === undefined || !w.store.layouts().some((l) => l.name === to)) return true;
        try { this.privileges?.in(w.store).checkLayout(to); } catch (e) { rethrowExecutionRefusal(e); return true; }
        if (to !== w.layoutName) event = 'OnLayoutExit';
        break;
      }
      case 74: { // Go to Related Record onto another layout in this window: leaving the layout, once it has records to show
        if (p.newWindow || !p.layout || !p.tableOccurrence || p.layout.name === w.layoutName) break;
        if (!w.store.layouts().some((l) => l.name === p.layout!.name)) break;
        try { this.privileges?.in(w.store).checkLayout(p.layout.name); } catch (e) { rethrowExecutionRefusal(e); break; }
        const from = p.matchFoundSet && w.layout && w.mode === 'browse' ? { occurrence: w.layout.occurrence, ids: this.foundSet(w).ids } : undefined;
        let related = 0;
        try { related = this.relatedIds(w, p.tableOccurrence.name, from).length; } catch (e) { rethrowExecutionRefusal(e); break; }
        if (related) event = 'OnLayoutExit';
        break;
      }
      case 121: case 123: { // Close Window, Select Window: the window named, worked out once for the step too
        const formula = p.calculation ?? p.slots?.[128];
        let name: string | undefined;
        try { name = formula !== undefined ? asText(this.eval(f, formula)) : undefined; } catch (e) { rethrowExecutionRefusal(e); return true; }
        this.windowChosen = { params: p, name };
        const target = name === undefined ? w : this.windows.find((x) => x.name.toLowerCase() === name.toLowerCase());
        // Select Window with no window, or one that isn't open, does nothing or fails before it commits.
        if (s.stepId === 123 && !target) return true;
        if (s.stepId === 123 && name === undefined) return true;
        // Closing this window leaves its layout ("can be activated when the window is closed", Claris). Not the
        // script's only window, which stays.
        if (s.stepId === 121 && target === w && this.windows.length > 1) event = 'OnLayoutExit';
        // Another window: its own layout's OnLayoutExit, in that window, and exiting False keeps it open.
        if (s.stepId === 121 && target && target !== w && target.unloaded === undefined && target.layoutName) {
          this.opts.beforeFile?.(target.store);
          const other = target.store.design(target.layoutName);
          const r = await this.runTrigger(f, target, other?.triggers, `${other?.name}`, 'OnLayoutExit', target.preview ? 'preview' : target.mode);
          if (r !== undefined && asText(r).trim() !== '' && asNumber(r) === 0) return false;
          // Then the file's OnWindowClose, in that window; exiting False keeps it open.
          const closing = await this.runWindowTrigger(f, target, 'OnWindowClose');
          return !(closing !== undefined && asText(closing).trim() !== '' && asNumber(closing) === 0);
        }
        break;
      }
      case 22: if (mode !== 'find') event = 'OnModeExit'; break;
      case 55: if (mode !== 'browse') event = 'OnModeExit'; break;
      case 41: if (mode !== 'preview') event = 'OnModeExit'; break;
      case 51: if (changed && !this.tx) event = 'OnRecordRevert'; break;
    }
    // Committing the record (Commit Records/Requests, or a step that moves off it) takes the cursor out of its field.
    // Not a step that fails before it commits: a find with nothing to find, Go to Related Record naming no table.
    const commits = w.mode === 'browse' && (COMMITTING_STEPS.has(s.stepId) || (s.stepId === 17 && !p.field))
      && !(s.stepId === 74 && !p.tableOccurrence) && !([28, 126, 127].includes(s.stepId) && !this.findHasCriteria(f, p, w));
    // Revert Record/Request exits the record as a commit does, so the cursor leaves its field too (inferred).
    const reverts = w.mode === 'browse' && s.stepId === 51;
    const design = w.store.design(w.layoutName);
    const vetoed = (r: Value | undefined) => r !== undefined && asText(r).trim() !== '' && asNumber(r) === 0;
    // Leaving the field the cursor is in: its OnObjectExit (not when the step goes back into the same field).
    const at = w.activeField;
    if (at && (commits || reverts || OBJECT_EXIT_STEPS.has(s.stepId))) {
      const intoSame = (x: StepParams['field']) => !!x && x.tableOccurrence.name.toLowerCase() === at.occurrence.toLowerCase() && x.field.name.toLowerCase() === at.field.toLowerCase();
      let same: boolean;
      // A field or object that isn't there: the step fails and the cursor stays where it is.
      const isStop = (x: NonNullable<StepParams['field']>) => this.fieldStops(w).some((t) => t.occurrence.toLowerCase() === x.tableOccurrence.name.toLowerCase() && t.field.toLowerCase() === x.field.name.toLowerCase());
      if (commits || reverts) same = false;
      else if ((s.stepId === 17 || s.stepId === 130) && p.field && !isStop(p.field)) return true;
      else if (s.stepId === 17) same = intoSame(p.field);
      else if (s.stepId === 130) same = !p.field || intoSame(p.field); // Set Selection in the active field stays in it
      else if (s.stepId === 145) {
        let name: string | undefined;
        try { name = p.objectName !== undefined ? asText(this.eval(f, p.objectName)) : ''; } catch (e) { rethrowExecutionRefusal(e); name = undefined; }
        // Worked out once: the step uses this name too.
        const object = name !== undefined && design ? objectByName(design.objects, name) : undefined;
        if (name === undefined || (design && !object)) return true;
        // A field object's repetition, worked out once too: one the field doesn't show fails the step first.
        let repetition: number | undefined;
        if (object?.kind === 'field' && object.field?.tableOccurrence && object.field.field) {
          try {
            repetition = this.objectRepetition(w, object, p.repetitionCalculation !== undefined ? asNumber(this.eval(f, p.repetitionCalculation)) : 1);
          } catch (e) { rethrowExecutionRefusal(e); return true; }
        }
        this.objectChosen = { params: p, name, ...(repetition !== undefined ? { repetition } : {}) };
        same = name === at.name;
      } else {
        const to = this.nextStop(w, s.stepId === 5);
        const row = at.portal && w.portal?.occurrence === at.portal ? w.portal.row : 1;
        same = !to || (to.stop.id === at.id && to.row === row);
      }

      if (!same) {
        // A field a step changed: OnObjectValidate, then OnObjectSave, then OnObjectExit (Claris's order); any of them
        // exiting False keeps the cursor in the field. A revert throws the change away, so it is neither validated nor
        // saved (inferred).
        const triggers = objectById(design?.objects, at.id)?.triggers;
        const where = `${design?.name}\u0000${at.id}`;
        for (const event of [...(at.changed && mode !== 'preview' && !reverts ? ['OnObjectValidate', 'OnObjectSave'] : []), 'OnObjectExit']) {
          if (this.current !== w || w.activeField !== at) break;
          const result = await this.runTrigger(f, w, triggers, where, event, mode);
          // Once saved, the field isn't changed any more, even when OnObjectSave keeps the cursor there (Claris).
          if (event === 'OnObjectSave') delete at.changed;
          if (vetoed(result)) return false;
        }
      }
    }
    // Then OnRecordCommit, for a changed record ("not activated within a transaction", Claris), then the step's own.
    // Changed as it is now: the OnObjectExit script may have committed the record, or changed it.
    const changedNow = w.mode === 'browse' && (w.pending.size > 0 || w.uncommittedNew);
    if (commits && changedNow && !this.tx && this.current === w && vetoed(await this.runTrigger(f, w, design?.triggers, `${design?.name}`, 'OnRecordCommit', mode))) return false;
    if (!event || this.current !== w) return true;
    if (vetoed(await this.runTrigger(f, w, design?.triggers, `${design?.name}`, event, mode))) return false;
    // Closing this window: after OnLayoutExit comes the file's OnWindowClose (Claris's order); exiting False keeps the window.
    if (s.stepId === 121 && this.current === w && !this.unwinding) return !vetoed(await this.runWindowTrigger(f, w, 'OnWindowClose'));
    return true;
  }

  /**
   * OnObjectModify for the field objects an Insert, Paste, Cut or Clear step changed: the object the cursor is in when
   * it shows that field, else the first on the layout that does. After the step, as Claris has it.
   */
  private async modifyTriggers(f: Frame, modified: NonNullable<ScriptEngine['modified']>): Promise<void> {
    const seen = new Set<string>();
    for (const m of modified) {
      const w = m.win;
      if (w !== this.current || w.unloaded !== undefined || !w.layoutName || this.unwinding) continue;
      const design = w.store.design(w.layoutName);
      const shows = (o: LayoutObject) => o.kind === 'field' && !!o.field?.tableOccurrence && o.field.tableOccurrence.toLowerCase() === m.occurrence.toLowerCase() && o.field.field?.toLowerCase() === m.field.toLowerCase();
      const active = w.activeField ? objectById(design?.objects, w.activeField.id) : undefined;
      // Changed while the cursor is in it: leaving it validates and saves it (OnObjectValidate, OnObjectSave).
      if (active && shows(active)) w.activeField!.changed = true;
      const object = active && shows(active) ? active : findObject(design?.objects, shows);
      if (!object || seen.has(`${object.id}`)) continue;
      seen.add(`${object.id}`);
      await this.runTrigger(f, w, object.triggers, `${design?.name}\u0000${object.id}`, 'OnObjectModify', w.preview ? 'preview' : w.mode);
    }
  }

  /**
   * Runs the layout's trigger for `event` in this mode, if it has one the account may run: its result, or undefined.
   * Not while that same trigger is running: an OnRecordCommit script that sets a field and commits, or an OnLayoutExit
   * script that goes to a layout, would otherwise set itself off without end.
   */
  private async runTrigger(f: Frame, w: Window, triggers: ScriptTrigger[] | undefined, where: string, event: string, mode: TriggerMode): Promise<Value | undefined> {
    const t = triggers?.find((x) => x.event === event && (x.modes ?? ['browse']).includes(mode));
    const script = t && w.store.schema.scripts.find((x) => x.id === t.scriptId);
    if (!t || !script) return undefined;
    const key = `${w.store.name}\u0000${where}\u0000${event}`;
    let running = this.runningTriggers.get(w);
    if (running?.has(key)) return undefined;
    if (!running) this.runningTriggers.set(w, (running = new Set()));
    try {
      this.privileges?.in(w.store).checkScript(script.name);
    } catch (e) {
      rethrowExecutionRefusal(e);
      return undefined; // as a button the account can't run: nothing happens
    }
    const kept = { error: this.lastError, detail: this.lastErrorDetail, location: this.lastErrorLocation, result: this.lastResult };
    try {
      // In the window's file, on its record (a step may have gone to another file's window).
      const parameter = t.parameter ? this.eval(w.store === f.store ? f : { ...f, store: w.store, window: w, locals: new Map() }, t.parameter) : text('');
      this.actions.push({ step: 'Script Trigger', script: script.name, event });
      running.add(key);
      return await this.perform(w.store, script, parameter, w);
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof Halt) throw e;
      // A trigger that can't run (its parameter fails, it is skipped) leaves the script that set it off going on.
      return undefined;
    } finally {
      running.delete(key);
      this.lastError = kept.error;
      this.lastErrorDetail = kept.detail;
      this.lastErrorLocation = kept.location;
      this.lastResult = kept.result;
    }
  }

  /** File Options triggers of a window running now (file and event), so an OnWindowOpen script that opens a window doesn't set itself off again. */
  private readonly runningWindowTriggers = new Set<string>();

  /**
   * The file's OnWindowOpen or OnWindowClose script (File Options), run in window `w` as the file's own windows run
   * their layout triggers: its result, or undefined when the file has none, the account can't run it, or it is
   * already running.
   */
  private async runWindowTrigger(f: Frame, w: Window, event: 'OnWindowOpen' | 'OnWindowClose'): Promise<Value | undefined> {
    const option = w.store.schema.fileOptions?.[event === 'OnWindowOpen' ? 'onWindowOpen' : 'onWindowClose'];
    const key = `${w.store.name}\u0000${event}`;
    if (!option || this.runningWindowTriggers.has(key) || this.unwinding) return undefined;
    const caller = this.current;
    this.current = w;
    this.runningWindowTriggers.add(key);
    try {
      return await this.runTrigger(f, w, [{ event, scriptId: option.scriptId }], '', event, 'browse');
    } finally {
      this.runningWindowTriggers.delete(key);
      this.current = this.windows.includes(caller) ? caller : this.current;
      f.window = this.current;
    }
  }

  private layoutOf(win: Window): LayoutInfo {
    if (!win.layout) throw new ScriptError(ERROR.layoutMissing, 'The window has no layout');
    this.opts.beforeFile?.(win.layout.owner);
    return win.layout;
  }

  /** A record of this table was created or changed: every sorted found set of it is now only partly in order. */
  private touched(info: LayoutInfo): void {
    for (const w of this.windows) {
      for (const [to, fs] of w.foundSets) {
        if (!fs.sort) continue;
        const o = w.store.occurrence(to);
        if (o.table === info.table && o.owner === info.owner) fs.semi = true;
      }
    }
  }

  private foundSet(win: Window): FoundSet {
    const info = this.layoutOf(win);
    let fs = win.foundSets.get(info.occurrence);
    if (!fs) {
      fs = { ids: info.owner.findIds(info, this.reading), index: 0 };
      win.foundSets.set(info.occurrence, fs);
    }
    return fs;
  }

  /**
   * Remembers the record the window's table is on, and the one it was on
   * before, as each step starts. Only a found set already worked out is read,
   * so this never runs a find of its own.
   */
  private noteVisit(win: Window): void {
    if (!win.layout || win.mode === 'find') return;
    const fs = win.foundSets.get(win.layout.occurrence);
    const id = fs?.ids[fs.index];
    if (id === undefined) return;
    const key = `${win.layout.owner.name}\u0000${win.layout.table}`;
    const seen = (win.visited ??= new Map()).get(key);
    if (!seen) win.visited.set(key, { current: id });
    else if (seen.current !== id) { seen.previous = seen.current; seen.current = id; }
  }

  private currentId(win: Window): number | undefined {
    if (!win.layout || win.mode === 'find') return undefined;
    const fs = this.foundSet(win);
    return fs.ids[fs.index];
  }

  private setFound(win: Window, ids: number[], sort?: SortSpec[]): void {
    this.commit(win);
    const info = this.layoutOf(win);
    const fs: FoundSet = { ids, index: 0 };
    if (sort) {
      fs.sort = sort;
      fs.ids = this.sortIds(win, info, ids, sort);
      fs.semi = undefined;
    }
    for (const to of win.foundSets.keys()) {
      const other = win.store.occurrence(to);
      if (other.owner === info.owner && other.table === info.table) win.foundSets.set(to, fs);
    }
    win.foundSets.set(info.occurrence, fs);
  }

  /**
   * Perform Semantic Find by vector data: no model needed, so it runs offline.
   * The found set becomes the target field's closest records, most similar
   * first, up to the evaluated return count (10 when absent). By natural
   * language, the search text is embedded first by the server's embedding
   * model (ai.ts); by image is not supported.
   */
  private async semanticFind(f: Frame, p: StepParams): Promise<void> {
    const ai = p.ai ?? {};
    if (!p.field) throw new ScriptError(ERROR.fieldMissing, 'Perform Semantic Find names no target field');
    const win = this.current;
    const info = this.layoutOf(win);
    const { info: target, field } = this.resolveTarget(f, p.field);
    // A related target (Beezwax's demos search asset.EMBEDDING~create::embedding from
    // the Assets layout) finds the layout's records by their related embeddings, as a
    // find on a related field does: a record scores its closest related record.
    const related = target.table !== info.table || target.owner !== info.owner;
    if (related && !relationshipPath(win.store.schema, info.occurrence, target.occurrence)) {
      throw new ScriptError(ERROR.fieldMissing, `Perform Semantic Find's target field ${p.field.tableOccurrence.name}::${p.field.field.name} is not related to the current layout's table`);
    }
    // Related records the account can't see don't count (record-level access).
    const visible = related ? new Set(target.owner.findIds(target, this.reading)) : undefined;
    const query = ai.queryBy === 'vector data'
      ? embeddingOf(this.eval(f, ai.vector ?? '""'))
      : ai.queryBy === 'image' ? await this.embedQueryImage(f, p)
      : (await this.embed(f, p, 'Perform Semantic Find', [asText(this.eval(f, ai.input ?? '""'))]))[0];
    if (!query) throw new ScriptError(ERROR.noCriteria, 'Perform Semantic Find has no vector to compare with');
    const threshold = ai.condition && ai.threshold !== undefined ? asNumber(this.eval(f, ai.threshold)) : undefined;
    const requestedCount = ai.returnCount === undefined ? 10 : asNumber(this.eval(f, ai.returnCount));
    if (this.calcError) return;
    if (!Number.isFinite(requestedCount)) throw new ScriptError(1200, 'Perform Semantic Find\'s Return count is not a finite number');
    const count = Math.max(0, Math.trunc(requestedCount));
    const keep = (x: number) => {
      if (threshold === undefined) return true;
      switch (ai.condition) {
        case 'greater than': return x > threshold;
        case 'less than': return x < threshold;
        case 'equal to': return x === threshold;
        case 'greater than or equal to': return x >= threshold;
        default: return x <= threshold;
      }
    };
    const ids = ai.recordSet === 'current found set' ? this.foundSet(win).ids : info.owner.findIds(info, this.reading);
    const scored: [number, number][] = [];
    // Each related record is scored once, however many records share it.
    const scores = new Map<number, number | undefined>();
    const score = (sid: number) => {
      if (!scores.has(sid)) {
        const vector = embeddingOf(this.valueOf(related ? target : info, field, sid, 1, undefined, false));
        const similarity = vector && cosineSimilarity(query, vector);
        scores.set(sid, similarity !== undefined && keep(similarity) ? similarity : undefined);
      }
      return scores.get(sid);
    };
    for (const id of ids) {
      const sources = related ? this.relatedIds(win, target.occurrence, { occurrence: info.occurrence, ids: [id] }).filter((sid) => visible!.has(sid)) : [id];
      let best: number | undefined;
      for (const sid of sources) {
        const similarity = score(sid);
        if (similarity !== undefined && (best === undefined || similarity > best)) best = similarity;
      }
      if (best !== undefined) scored.push([id, best]);
    }
    scored.sort((x, y) => y[1] - x[1]);
    const limited = scored.slice(0, count).map(([id]) => id);
    // Inferred for zero/negative/empty counts: FileMaker's behavior is undocumented;
    // keep the same error and found set as a semantic search with no matches.
    if (!limited.length) throw new ScriptError(ERROR.noRecords, 'No records match the request');
    this.setFound(win, limited);
  }

  /**
   * Perform RAG Action on the server's own spaces (a space belongs to the file that made it): Add Data cuts text, or
   * the text of a text or PDF container, into chunks and embeds them; Send Prompt finds the closest chunks and
   * gives them to the model with the question; Remove Data drops documents. The search compares every chunk of the
   * space (no index), so a space is meant for up to tens of thousands of chunks.
   */
  /**
   * GetRAGSpaceInfo: this file's spaces, or one space's documents, as the JSON Claris documents; undefined (the function
   * gives "?") without a RAG account, RAG spaces or AI for the file. Held to Perform RAG Action's rules (aiFor: capture-only
   * files and every file on the call stack), never raises (a store error gives "?"), and the answer is capped by the store.
   */
  private ragSpaceInfo(f: Frame, account: string, spaceId?: string): string | undefined {
    let rag: RagBackend | undefined;
    try {
      this.checkRagRead(f);
      rag = this.aiFor(f, 'GetRAGSpaceInfo').rag;
    } catch { return undefined; }
    const ai = this.session.ai;
    const name = account.toLowerCase();
    if (!rag || !ai.ragConfigured || (ai.ragAccounts.size > 0 && !ai.ragAccounts.has(name))) return undefined;
    const file = f.store.name;
    try {
      if (spaceId === undefined || spaceId.trim() === '') {
        return JSON.stringify({ rag_space_list: rag.spaces({ account: this.opts.account, file }).map((s) => ({ space_id: s.space, model: s.model })) });
      }
      const id = spaceId.trim();
      const info = rag.info({ account: this.opts.account, file, space: id });
      if (!info) return `[RAG Space] error. Reason: RAG space ${id} not found`;
      return JSON.stringify({ rag_space_id: id, model: info.model, entries: info.entries.length, values: info.entries });
    } catch { return undefined; }
  }

  private async ragAction(f: Frame, p: StepParams): Promise<void> {
    const step = 'Perform RAG Action';
    this.checkRagRead(f);
    const ai = this.aiFor(f, step);
    const rag = ai.rag;
    if (!rag) throw new ScriptError(ERROR.unavailable, `${step} needs RAG spaces, and this server has none set up (it needs an embedding model: --ai-embed-url)`);
    const a = p.ai ?? {};
    const account = asText(this.eval(f, a.ragAccountName ?? '""')).toLowerCase();
    const known = this.session.ai.ragAccounts;
    if (!this.session.ai.ragConfigured || (known.size > 0 && !known.has(account))) {
      throw new ScriptError(ERROR.aiAccountMissing, `${step}: no RAG account with that name was set up in this session (run Configure RAG Account first)`);
    }
    const space = asText(this.eval(f, a.spaceId ?? '""')).trim();
    if (!space) throw new ScriptError(5, `${step} needs a Space ID`);
    const file = f.store.name;
    const respond = (json: unknown) => {
      const value = text(typeof json === 'string' ? json : JSON.stringify(json));
      if (a.responseVariable) this.setVariable(f, a.responseVariable, 1, value);
      else if (a.ragAction === 'send prompt') this.storeResult(f, p, value);
    };
    const parameters = (): Record<string, unknown> => {
      if (a.parameters === undefined) return {};
      const raw = asText(this.eval(f, a.parameters)).trim();
      if (!raw) return {};
      try {
        const v = JSON.parse(raw) as unknown;
        if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
      } catch { /* below */ }
      throw new ScriptError(5, `${step}: Parameters is not a JSON object`);
    };
    switch (a.ragAction) {
      case 'add data': {
        const source = a.dataSource;
        let name: string | undefined;
        let content: string;
        // A document's text: PDF text, or a text file (txt, md, csv, json, jsonl).
        const textOf = (docName: string, bytes: Uint8Array): string => {
          const pdf = pdfText(bytes);
          if (pdf !== undefined) return pdf;
          if (/\.pdf$/i.test(docName) || String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-') throw new ScriptError(ERROR.unavailable, `${step}: no text could be read from this PDF (scanned or protected PDFs can't be used)`);
          if (bytes.subarray(0, 4096).includes(0)) throw new ScriptError(ERROR.unavailable, `${step}: only PDF and text documents (txt, md, csv, json, jsonl) can be added`);
          return new TextDecoder().decode(bytes);
        };
        if (source === 'from text') {
          content = asText(this.eval(f, a.input ?? '""'));
        } else if (source === 'from file' || source === 'from file (async)') {
          // The server's documents folder only, as the other file steps.
          const { path } = this.filePath(f, p, step, true);
          let bytes: Uint8Array;
          try {
            // Opened without waiting (a named pipe in the folder would otherwise hold the whole server) and read only if it is a plain file, up to the limit.
            const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
            try {
              const info = fstatSync(fd);
              if (!info.isFile()) throw new Error('not a plain file');
              if (info.size > RAG_FILE_LIMIT) throw new ScriptError(ERROR.capacity, `${step}: the file is bigger than ${RAG_FILE_LIMIT / 1_000_000} MB`);
              bytes = new Uint8Array(info.size);
              let got = 0;
              while (got < bytes.length) {
                const n = readSync(fd, bytes, got, bytes.length - got, null);
                if (!n) break;
                got += n;
              }
              if (got < bytes.length) bytes = bytes.subarray(0, got);
            } finally {
              closeSync(fd);
            }
          } catch (e) {
            if (e instanceof ScriptError) throw e;
            throw new ScriptError(ERROR.missingFile, `${step}: ${basename(path)} can't be read in the documents folder`);
          }
          name = basename(path);
          content = textOf(name, bytes);
        } else if (source === 'from container' || source === 'from container (async)') {
          if (!p.field) throw new ScriptError(ERROR.fieldMissing, `${step} names no container field`);
          const win = this.current;
          const v = this.readField(win, { occurrence: p.field.tableOccurrence.name, field: p.field.field.name, repetition: 1 }) ?? text('');
          if (v.type !== 'container' || !v.data) throw new ScriptError(ERROR.recordMissing, `${step}: the container field is empty`);
          name = v.value || undefined;
          content = textOf(name ?? '', v.data);
        } else {
          throw new ScriptError(5, `${step}: choose where the data comes from (RAG Data)`);
        }
        let tokens = 200;
        if (a.tokensPerChunk !== undefined) {
          const n = asNumber(this.eval(f, a.tokensPerChunk));
          if (n !== 0) {
            // Claris explicitly returns 887 outside 75..512; zero selects the server default.
            if (!(n >= 75 && n <= 512)) throw new ScriptError(887, `${step}: Tokens per Text Chunk is 75 to 512`);
            tokens = Math.trunc(n);
          }
        }
        if (content.length > RAG_FILE_LIMIT) throw new ScriptError(ERROR.capacity, `${step}: the data is bigger than ${RAG_FILE_LIMIT / 1_000_000} MB`);
        const chunks = chunkText(content, tokens, /\.jsonl$/i.test(name ?? ''));
        if (!chunks.length) throw new ScriptError(ERROR.noRecords, `${step}: there is no text to add`);
        if (chunks.length > RAG_ADD_CHUNK_LIMIT) throw new ScriptError(ERROR.capacity, `${step}: the data makes ${chunks.length} chunks, and one Add Data takes at most ${RAG_ADD_CHUNK_LIMIT}`);
        const vectors = await this.embedTexts(f, step, '', chunks);
        let id: string;
        try {
          id = rag.add({ account: this.opts.account, file, space, ...(name ? { name } : {}), chunks, vectors });
        } catch (e) {
          throw new ScriptError(ERROR.capacity, `${step}: ${(e as Error).message}`);
        }
        respond({ id, rag_space_id: space, result: 'success', ...(name ? { file: name } : { text: content.slice(0, 200) }), chunks: chunks.length });
        return;
      }
      case 'send prompt': {
        const prompt = a.prompt !== undefined ? asText(this.eval(f, a.prompt)) : a.input !== undefined ? asText(this.eval(f, a.input)) : '';
        if (!prompt.trim()) throw new ScriptError(ERROR.noCriteria, `${step}: there is no prompt to send`);
        const params = parameters();
        // Claris documents these ranges and that zero results means no context, but not how out-of-range
        // values are handled. Keep this engine's existing clamps for compatibility.
        const threshold = typeof params.similarity_threshold === 'number' ? Math.max(-1, Math.min(1, params.similarity_threshold)) : 0;
        const top = typeof params.num_top_ranked_results === 'number' ? Math.max(0, Math.min(100, Math.trunc(params.num_top_ranked_results))) : 5;
        // Beyond Claris: keyword_weight (0 to 1, default 0) blends how many of the question's words a chunk holds into its score.
        const keywordWeight = typeof params.keyword_weight === 'number' ? Math.max(0, Math.min(1, params.keyword_weight)) : 0;
        let context: string[] = [];
        if (top > 0) {
          const [vector] = await this.embedTexts(f, step, '', [prompt]);
          try {
            context = rag.search({ account: this.opts.account, file, space, vector, top, threshold, ...(keywordWeight ? { query: prompt, keywordWeight } : {}) }).map((c) => c.text);
          } catch (e) {
            throw new ScriptError(ERROR.capacity, `${step}: ${(e as Error).message}`);
          }
        }
        const template = a.templateName !== undefined ? this.session.ai.templates.get(asText(this.eval(f, a.templateName)).toLowerCase())?.naturalLanguage : undefined;
        const joined = context.map((c, i) => `[${i + 1}] ${c}`).join('\n\n');
        const system = template && /:question:|:context:/.test(template)
          ? template.replaceAll(':context:', joined).replaceAll(':question:', prompt)
          : `Answer the question using only the context below. If the context doesn't hold the answer, say so.\n\nContext:\n${joined || '(nothing found)'}`;
        let answer: string;
        try {
          answer = await ai.generate({ file, account: this.opts.account, signal: this.aiSignal(), model: asText(this.eval(f, a.model ?? '""')), system, messages: [{ role: 'user', content: prompt }] });
        } catch (e) {
          throw new ScriptError(ERROR.unavailable, `${step}: ${(e as Error).message}`);
        }
        respond(answer);
        return;
      }
      case 'remove data': {
        const ids = parameters().id;
        const list = Array.isArray(ids) ? ids.map(String) : ids === undefined ? undefined : [String(ids)];
        const removed = rag.remove({ account: this.opts.account, file, space, ...(list ? { ids: list } : {}) });
        respond({ rag_space_id: space, result: 'success', removed });
        return;
      }
      default:
        throw new ScriptError(ERROR.unavailable, `${step}: this action was not read from the file; set it in the step (Add Data, Send Prompt or Remove Data)`);
    }
  }

  /** One signal per active step, detached when that step finishes (including nested scripts). */
  private aiSignal(): AbortSignal {
    this.work ??= cancellationScope([this.stopSignal, this.userCancellation.signal], this.deadline - Date.now());
    return this.work.signal;
  }

  /**
   * Every file on the call stack, every source used by this run, and those of the run that started it.
   */
  private callStackFiles(f: Frame): string[] {
    return [...new Set([f.store.name, ...this.stack.map((x) => x.frame.store.name), ...this.sourceFiles, ...(this.opts.callerFiles ?? [])])];
  }

  /** Check source access before reading it and retain its provenance for every outbound capability. */
  private useSourceFile(store: Store): void {
    this.opts.beforeFile?.(store);
    this.sourceFiles.add(store.name);
  }

  /** Saved spaces have no provenance for applying row rules or a token's independent ceiling. */
  private checkRagRead(f: Frame): void {
    const privileges = this.privileges;
    if (privileges && (privileges.ceiling || !privileges.in(f.store).readsEverything)) {
      throw new ScriptError(ERROR.privileges, 'Saved RAG spaces require unrestricted access to every record and field');
    }
  }

  /**
   * The server's AI for an AI step, checked for every file on the call stack: refused (error 3, with the
   * reason) when scripts here run offline, a file has AI turned off, or a file is a capture-only.
   */
  private aiFor(f: Frame, step: string): ScriptAi {
    const files = this.callStackFiles(f);
    const held = files.find((x) => captureOnly(x, this.opts.outbound?.captureOnly));
    if (held !== undefined) throw new ScriptError(ERROR.unavailable, `${step} is not available: "${held}" is a capture-only file, and its data never goes to AI`);
    const ai = this.opts.ai;
    if (!ai) throw new ScriptError(ERROR.unavailable, `${step} needs an AI model, and scripts here run offline (a server started with --ai runs it)`);
    for (const file of files) {
      const why = ai.refusal(file, this.opts.account, [...(this.aiPrograms.get(file) ?? [])]);
      if (why) throw new ScriptError(ERROR.unavailable, `${step} is not available: ${why}`);
    }
    const checked = <T>(call: Promise<T>) => call.then((value) => { this.canceled(f.script.name); return value; });
    return {
      refusal: (...args) => ai.refusal(...args),
      generate: (request) => checked(this.scriptOutbound(() => ai.generate(request))),
      ...(ai.embed ? { embed: (request: Parameters<NonNullable<ScriptAi['embed']>>[0]) => checked(this.scriptOutbound(() => ai.embed!(request))) } : {}),
      ...(ai.embedImage ? { embedImage: (request: Parameters<NonNullable<ScriptAi['embedImage']>>[0]) => checked(this.scriptOutbound(() => ai.embedImage!(request))) } : {}),
      rag: ai.rag,
    };
  }

  /** The step's AI account, which Configure AI Account must have set up in this session (its name is never repeated: it can come from data). */
  private aiAccount(f: Frame, p: StepParams, step: string): void {
    const name = asText(this.eval(f, p.ai?.accountName ?? '""')).toLowerCase();
    if (!name || !this.session.ai.accounts.has(name)) {
      throw new ScriptError(ERROR.aiAccountMissing, `${step}: no AI account with that name was set up in this session (run Configure AI Account first)`);
    }
  }

  /** Embeddings for texts from the server's embedding model. */
  private async embed(f: Frame, p: StepParams, step: string, texts: string[]): Promise<number[][]> {
    // Offline (or AI off for the file) is error 3 before any account is looked for, as for the other AI steps.
    this.aiFor(f, step);
    this.aiAccount(f, p, step);
    return this.embedTexts(f, step, asText(this.eval(f, p.ai?.model ?? '""')), texts);
  }

  /** The vector of the picture in Perform Semantic Find by image's input (a container), from the server's image embedding model. */
  private async embedQueryImage(f: Frame, p: StepParams): Promise<number[]> {
    const step = 'Perform Semantic Find';
    const ai = this.aiFor(f, step);
    this.aiAccount(f, p, step);
    const image = this.eval(f, p.ai?.input ?? '""');
    if (this.calcError) return [];
    if (image.type !== 'container' || !image.data?.length) throw new ScriptError(ERROR.noCriteria, `${step} by image needs a picture in a container field or from a function that gives one`);
    if (!ai.embedImage) throw new ScriptError(ERROR.unavailable, `${step} by image needs an image embedding model, and this server has none set up (--ai-image-embed)`);
    let out: number[][];
    try {
      out = await ai.embedImage({ file: f.store.name, account: this.opts.account, model: asText(this.eval(f, p.ai?.model ?? '""')), images: [{ mime: containerMime('', image.value || undefined, image.data), data: image.data }], signal: this.aiSignal() });
    } catch (e) {
      throw new ScriptError(ERROR.unavailable, `${step}: ${(e as Error).message}`);
    }
    if (out.length !== 1 || !out[0]?.length) throw new ScriptError(ERROR.unavailable, `${step}: the image embedding model gave no answer`);
    return out[0];
  }

  private async embedTexts(f: Frame, step: string, model: string, texts: string[]): Promise<number[][]> {
    const ai = this.aiFor(f, step);
    if (!ai.embed) throw new ScriptError(ERROR.unavailable, `${step} needs an embedding model, and this server has none set up`);
    let out: number[][];
    try {
      out = await ai.embed({ file: f.store.name, account: this.opts.account, model, texts, signal: this.aiSignal() });
    } catch (e) {
      rethrowExecutionRefusal(e);
      throw new ScriptError(ERROR.unavailable, `${step}: ${(e as Error).message}`);
    }
    if (out.length !== texts.length || out.some((v) => !v?.length)) throw new ScriptError(ERROR.unavailable, `${step}: the embedding model gave no answer`);
    return out;
  }

  /**
   * A step whose formulas call GetEmbedding: each text not embedded yet stops the step, is embedded (as Insert
   * Embedding does, with the same AI checks), and the step runs again with its variables as they were.
   */
  /** Whether the step's formulas, or a custom function they may call, can reach GetEmbedding. */
  private mayEmbed(f: Frame, step: ScriptStep): boolean {
    let mayEmbed = callsEmbedding.get(step);
    if (mayEmbed === undefined) callsEmbedding.set(step, mayEmbed = EMBEDS.test(JSON.stringify(step.params ?? {})) || (step.calculations ?? []).some((c) => EMBEDS.test(c)));
    // Import Records has no calculations whose custom functions can embed;
    // its own executing-file guard runs immediately before source access.
    // A plug-in allowed to reach the web may ask for a request in any calculation.
    return mayEmbed || CURL_PERFORM.test(JSON.stringify(step.params ?? {})) || this.mayFetch(f) || this.mayMail(f) || (step.stepId !== 35 && (functionsEmbed(f.store) || functionsEmbed(this.current.store)));
  }

  /** quickStep for a step with no GetEmbedding in sight; one reached anyway (through Evaluate) fails as in stepWithEmbeddings. */
  private quickStepNoEmbedding(f: Frame, step: ScriptStep, pc: number, b: Blocks): number | 'exit' | undefined {
    try {
      return this.quickStep(f, step, pc, b);
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof NeedEmbedding || e instanceof NeedFetch || e instanceof NeedMail) throw new ScriptError(ERROR.unavailable, cantRunAgain(e));
      throw e;
    }
  }

  private async stepWithEmbeddings(f: Frame, step: ScriptStep, pc: number, b: Blocks): Promise<number | 'exit' | undefined> {
    const keep = this.mayEmbed(f, step);
    const replay = keep ? beginMbsReplay(this.session) : undefined;
    // The answers to the web requests this step has made, dropped when it is done so the next step asks afresh.
    const made: string[] = [];
    try {
      for (let tries = 0; ; tries++) {
        const saved = keep ? { locals: copyVariables(f.locals), globals: copyVariables(this.session.variables) } : undefined;
        if (replay) rewindMbsReplay(replay);
        try {
          return await this.step(f, step, pc, b);
        } catch (e) {
          rethrowExecutionRefusal(e);
          if (!(e instanceof NeedEmbedding) && !(e instanceof NeedFetch) && !(e instanceof NeedMail)) throw e;
          if (!saved) throw new ScriptError(ERROR.unavailable, cantRunAgain(e));
          restoreVariables(f.locals, saved.locals);
          restoreVariables(this.session.variables, saved.globals);
          this.calcError = 0;
          this.calcMessage = undefined;
          if (e instanceof NeedFetch) {
            if (tries >= 20) throw new ScriptError(ERROR.network, 'A plug-in made more than 20 web requests in one step');
            made.push(e.ask.key);
            await this.fetchForPlugin(e.ask);
            continue;
          }
          if (e instanceof NeedMail) {
            if (tries >= 20) throw new ScriptError(ERROR.mailNotSent, 'A plug-in sent more than 20 messages in one step');
            made.push(e.ask.key);
            await this.mailForPlugin(f, e.ask);
            continue;
          }
          if (tries >= 20) throw new ScriptError(ERROR.unavailable, 'GetEmbedding: one step kept asking for more embeddings');
          await this.fetchEmbeddings(f, e.asks);
        }
      }
    } finally {
      if (replay) endMbsReplay(this.session, replay);
      for (const k of made) { this.pluginFetched.delete(k); this.pluginMailed.delete(k); }
    }
  }

  /** Answers to plug-ins' web requests made during the step that is running, by request. */
  private readonly pluginFetched = new Map<string, PluginResponse>();

  /** Whether a plug-in could ask for a real web request here: the server lets scripts reach the network and one is on. */
  private mayFetch(f: Frame): boolean {
    return !this.opts.outbound && !!this.opts.network && this.networkBlocker(f) === undefined && f.store.pluginsUseNetwork();
  }

  /**
   * Plug-ins' web requests where scripts may reach the network: a request not made yet ends the step's run (NeedFetch)
   * and is made before it runs again. Never from a capture-only file, wherever it is on the call stack.
   */
  private pluginNetwork(f: Frame): PluginNetwork | undefined {
    if (!this.mayFetch(f)) return undefined;
    return {
      fetch: (via, req) => {
        const held = this.callStackFiles(f).find((x) => captureOnly(x));
        if (held !== undefined) throw new CalcError(ERR.calculation, `${via} can't reach the web: "${held}" is a capture-only file, and its scripts never reach the network`);
        // Checked at every request: this closure outlives the step that made it, and a file may have joined the call stack since.
        const refused = this.networkRefusal(f);
        if (refused) throw new CalcError(ERR.calculation, `${via} can't reach the web: ${refused}`);
        const key = JSON.stringify([via, req.method, req.url, req.headers, req.body]);
        const done = this.pluginFetched.get(key);
        if (done) return done;
        throw new NeedFetch({ key, via, ...req });
      },
    };
  }

  /** MBS CURL uses the same offline switch and bounded host fetch as script URL steps. */
  private curlFetch(f: Frame, request: MbsCurlRequest): PluginResponse {
    const refused = this.networkRefusal(f);
    if (refused) throw new CalcError(ERR.calculation, `${request.via ?? 'CURL.Perform'} can't reach the web: ${refused}`);
    const held = this.callStackFiles(f).find((x) => captureOnly(x));
    if (held !== undefined) throw new CalcError(ERR.calculation, `${request.via ?? 'CURL.Perform'} can't reach the web: "${held}" is a capture-only file`);
    const key = JSON.stringify([request.via ?? 'CURL.Perform', request]);
    const done = this.pluginFetched.get(key);
    if (done) return done;
    // Only an explicitly authorized test fetch may serve local addresses. Real requests use the strict guard and pinned transport.
    throw new NeedFetch({ key, via: request.via ?? 'CURL.Perform', method: request.method, url: request.url, headers: request.headers,
      body: request.body ?? '', allows: (url) => curlAddressAllowed(url, typeof this.opts.network === 'function' && this.opts[TEST_ONLY_CUSTOM_FETCH] === true), curl: request });
  }

  /** What became of the messages plug-ins sent during the step that is running, by message: '' sent, else why not. */
  private readonly pluginMailed = new Map<string, string>();

  /** Whether a plug-in could ask to send real mail here: the operator switched sending on and a plug-in for this file asks to. */
  private mayMail(f: Frame): boolean {
    return !this.opts.outbound && !!this.opts.mail && f.store.pluginsUseMail();
  }

  /** Whether a built-in function (BE_SMTPSend) could send real mail here: sending is set up, and every file on the call stack may use the network. */
  private mayMailBuiltin(f: Frame): boolean {
    return !this.opts.outbound && !!this.opts.mail && !!this.opts.network && this.networkBlocker(f) === undefined;
  }

  /** Plug-ins' mail where sending is on: a message not sent yet ends the step's run (NeedMail) and is sent before it runs again. */
  private pluginMailer(f: Frame, builtin = false): PluginMailer | undefined {
    if (!(builtin ? this.mayMailBuiltin(f) : this.mayMail(f))) return undefined;
    return {
      send: (via, m) => {
        // The same message twice in one step is sent once.
        const key = JSON.stringify([via, m]);
        const done = this.pluginMailed.get(key);
        if (done === '') return;
        if (done !== undefined) throw new CalcError(ERR.calculation, `${via}: the message wasn't sent (${done})`);
        const held = this.callStackFiles(f).find((x) => captureOnly(x));
        if (held !== undefined) throw new CalcError(ERR.calculation, `${via} can't send mail: "${held}" is a capture-only file, and its scripts never send email`);
        // A built-in function's mail follows the network switch, checked at every message (this closure outlives the step that made it).
        const refused = builtin ? this.networkRefusal(f) : undefined;
        if (refused) throw new CalcError(ERR.calculation, `${via} can't send mail: ${refused}`);
        // "Name <address>" gives the address; the operator's account is always the sender.
        const bare = (list: string) => addresses(list).map((a) => /<([^<>]*)>\s*$/.exec(a)?.[1].trim() ?? a);
        const from = addresses(m.from)[0] ?? '';
        const replyTo = bare(m.from)[0];
        const attachments: { name: string; data: Uint8Array }[] = [];
        for (const a of m.attachments) {
          const path = this.sandboxPath(a);
          if (!path || !existsSync(path)) throw new CalcError(ERR.calculation, `${via}: the attachment "${basename(a)}" wasn't found`);
          attachments.push({ name: basename(path), data: readFileSync(path) });
        }
        const name = /^(.*?)\s*<[^<>]*>\s*$/.exec(from)?.[1].replace(/^"|"$/g, '').trim() ?? '';
        const message: OutgoingMail = {
          to: bare(m.to), cc: bare(m.cc), bcc: bare(m.bcc), subject: m.subject, text: m.body, fromName: name, ...(replyTo ? { replyTo } : {}),
          attachments, files: this.callStackFiles(f),
        };
        throw new NeedMail({ key, via, message });
      },
    };
  }

  /** Sends a plug-in's message through the operator's account, and notes what became of it. */
  private async mailForPlugin(f: Frame, ask: PluginMailAsk): Promise<void> {
    const left = this.deadline - Date.now();
    this.hold(false);
    try {
      const refused = await this.scriptOutbound(() => this.opts.mail!({ ...ask.message, signal: this.aiSignal() }));
      this.pluginMailed.set(ask.key, typeof refused === 'string' ? refused : '');
    } catch (e) {
      this.pluginMailed.set(ask.key, (e as Error).message || 'failed');
    } finally {
      this.resumeAfter(left);
    }
  }

  /** Only the script's own requests inherit its identity and stop signal, never commits or operator callbacks. */
  private scriptOutbound<T>(request: () => T): T {
    return outboundContext.run({ ...this.outboundIdentity!, stop: this.stopSignal }, request);
  }

  /**
   * The fetch a script's web request goes through: the one the caller supplied, else the shared outbound guard
   * (net-guard.ts), which never reaches link-local or metadata addresses and reaches the machine's own network only
   * for the hosts and ranges an administrator listed (`networkAllow`, and in test mode the allowed hosts).
   */
  private scriptFetch(allowedHosts: readonly string[] = [], supplied?: typeof fetch): typeof fetch {
    const net = this.opts.network;
    const custom = supplied ?? (typeof net === 'function' ? net : undefined);
    if (custom) {
      if (this.opts[TEST_ONLY_CUSTOM_FETCH] !== true) throw new ScriptError(ERROR.unavailable, 'Custom script fetch requires the internal test-only injection');
      return (input, init) => this.scriptOutbound(() => custom(input, init));
    }
    // Test mode's allowed hosts are reached on the own network only by exact name: a wildcard (any subdomain of a domain whose users point names anywhere) is not.
    const entries = [...allowedHosts.filter((h) => !h.includes('*')), ...(this.opts.networkAllow ?? [])].filter((e) => {
      try {
        parseAllowList([e]);
        return true;
      } catch {
        return false;
      }
    });
    const guarded = guardedFetcher({ policy: { private: entries }, maxBytes: 1024 ** 3 });
    return (input, init) => this.scriptOutbound(() => guarded(input, init));
  }

  /** Makes a plug-in's web request, following redirects by hand so each hop is one the plug-in may reach. */
  private async fetchForPlugin(ask: PluginFetchAsk): Promise<void> {
    // Every callback, including MBS CURL's transport, requires the internal test capability.
    const doFetch = this.scriptFetch()!;
    const headers = Object.fromEntries(Object.entries(ask.headers).filter(([k]) => !FORBIDDEN_HEADERS.has(k)));
    const scope = cancellationScope([this.aiSignal()], PLUGIN_FETCH_MS);
    const signal = scope.signal;
    const answer = async (): Promise<PluginResponse> => {
      try {
        if (!ask.allows(ask.url)) throw new Error('the address is not allowed');
        if (ask.curl) {
          const request = ask.curl;
          let at = request.url;
          let method = request.method;
          let body = request.body;
          let sentHeaders = { ...headers };
          if (request.aws) {
            if (request.follow) throw new Error('CURL.SetupAWS cannot follow redirects without signing each destination');
            sentHeaders = signSigV4({ method, url: at, headers: sentHeaders, body }, request.aws, new Date());
          }
          const curlHop = async (url: string, hopMethod: string, hopHeaders: Record<string, string>, hopBody: string | undefined) => {
            if (!ask.allows(url)) throw new Error('the address is not allowed');
            const init = { method: hopMethod, headers: hopHeaders, body: hopBody, redirect: 'manual' as const, signal };
            return doFetch(url, init);
          };
          let res = await curlHop(at, method, sentHeaders, body);
          for (let hop = 0; request.follow && res.status >= 300 && res.status < 400 && res.headers.get('location'); hop++) {
            const next = new URL(res.headers.get('location')!, at).toString();
            if (hop >= Math.min(request.maxRedirs < 0 ? 5 : request.maxRedirs, 5)) return { status: res.status, body: '', headers: {}, error: 'too many redirects' };
            if (!ask.allows(next)) throw new Error('the redirect address is not allowed');
            if (new URL(next).origin !== new URL(at).origin) {
              // Another origin gets only the plain headers: a custom X-Api-Key or X-Auth-Token is as much a credential as Authorization.
              sentHeaders = Object.fromEntries(Object.entries(sentHeaders).filter(([k]) => /^(accept|accept-encoding|accept-language|content-type|content-length|user-agent)$/i.test(k)));
            }
            if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
              method = 'GET'; body = undefined;
              sentHeaders = Object.fromEntries(Object.entries(sentHeaders).filter(([k]) => !/^(content-type|content-length)$/i.test(k)));
            }
            at = next;
            await res.body?.cancel().catch(() => {});
            res = await curlHop(at, method, sentHeaders, body);
          }
          // A script run keeps up to 16 handles, each holding its response: a smaller cap than Insert from URL's.
          const bytes = await readCapped(res, CURL_RESPONSE_MAX);
          return { status: res.status, body: new TextDecoder().decode(bytes), headers: Object.fromEntries(res.headers),
            headerText: `HTTP/1.1 ${res.status} ${res.statusText}\r\n${[...res.headers].map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n` };
        }
        const body = ask.method === 'GET' || ask.method === 'HEAD' ? undefined : ask.body;
        let res = await doFetch(ask.url, { method: ask.method, headers, body, redirect: 'manual', signal });
        for (let hop = 0, at = ask.url; res.status >= 300 && res.status < 400 && res.headers.get('location'); hop++) {
          await res.body?.cancel().catch(() => {});
          at = new URL(res.headers.get('location')!, at).toString();
          if (hop >= 5 || !ask.allows(at)) throw new Error(`redirected to ${hop >= 5 ? 'too many places' : `${hostOf(at)}, which the plug-in may not reach`}`);
          res = await doFetch(at, { method: 'GET', headers: {}, redirect: 'manual', signal });
        }
        const bytes = ask.method === 'HEAD' ? new Uint8Array(0) : await readCapped(res);
        return { status: res.status, body: new TextDecoder().decode(bytes), headers: Object.fromEntries(res.headers) };
      } catch (e) {
        return { status: 0, body: '', headers: {}, error: (e as Error).message };
      }
    };
    try { this.pluginFetched.set(ask.key, await answer()); }
    finally { scope.dispose(); }
  }

  /** Embeds the texts GetEmbedding asked for, a model at a time, with Insert Embedding's checks. */
  private async fetchEmbeddings(f: Frame, asks: EmbeddingAsk[]): Promise<void> {
    const groups = new Map<string, EmbeddingAsk[]>();
    for (const a of asks) {
      if (!a.account || !this.session.ai.accounts.has(a.account.toLowerCase())) {
        throw new ScriptError(ERROR.unavailable, 'GetEmbedding: no AI account with that name was set up in this session (run Configure AI Account first)');
      }
      if (this.embeddings.has(embeddingKey(a.account, a.model, a.input))) continue;
      const k = `${a.account.toLowerCase()}\u0000${a.model}`;
      const g = groups.get(k) ?? [];
      if (!g.some((x) => x.input === a.input)) g.push(a);
      groups.set(k, g);
    }
    if ([...groups.values()].reduce((n, g) => n + g.length, 0) > EMBEDDINGS_KEPT) {
      throw new ScriptError(ERROR.unavailable, `GetEmbedding: one step asked for more than ${EMBEDDINGS_KEPT} embeddings; use Insert Embedding in Found Set for many records`);
    }
    for (const g of groups.values()) {
      for (let i = 0; i < g.length; i += 100) {
        const part = g.slice(i, i + 100);
        const vectors = await this.embedTexts(f, 'GetEmbedding', part[0].model, part.map((x) => x.input));
        part.forEach((x, j) => {
          if (this.embeddings.size >= EMBEDDINGS_KEPT) this.embeddings.delete(this.embeddings.keys().next().value!);
          this.embeddings.set(embeddingKey(x.account, x.model, x.input), vectors[j]);
        });
      }
    }
  }

  /** An embedding as its target wants it: an .fve file for a container field, else text (a JSON array). */
  private embeddingValue(f: Frame, p: StepParams, vector: number[]): Value {
    const container = p.field && !p.variable && this.resolveTarget(f, p.field).field.type === 'container';
    return container ? embeddingFile(vector) : text(`[${vector.join(',')}]`);
  }

  /** Insert Embedding in Found Set: each record's source field, embedded into its target field. */
  private async embedFoundSet(f: Frame, p: StepParams): Promise<void> {
    const step = 'Insert Embedding in Found Set';
    const a = p.ai ?? {};
    const source = a.sourceField;
    if (!source || !p.field) throw new ScriptError(ERROR.fieldMissing, `${step} needs a source field and a target field`);
    const target = p.field;
    const win = this.current;
    this.commit(win);
    const fs = this.foundSet(win);
    const keep = fs.index;
    // Parameters' MaxRecPerCall: how many records go to the model in each call (Claris: default 20, 1 to 500).
    const batch = embedBatchSize(a.parameters !== undefined ? asText(this.eval(f, a.parameters)) : '');
    // Replace target contents off: only targets that are empty get a vector. Absent (a file's step, whose option
    // isn't decoded yet) replaces, as before.
    const replace = a.replaceTarget !== false;
    const readAt = (i: number, ref: FieldRef) => {
      fs.index = i;
      this.readCache.clear();
      return asText(this.readField(win, { occurrence: ref.tableOccurrence.name, field: ref.field.name, repetition: Number(ref.repetition ?? 1) || 1 }) ?? text(''));
    };
    let checked = false;
    const model = () => asText(this.eval(f, a.model ?? '""'));
    try {
      for (let start = 0; start < fs.ids.length; start += batch) {
        const at = [...Array(Math.min(batch, fs.ids.length - start)).keys()].map((i) => start + i);
        // Records with no text keep their target as it is (Claris: "nothing is sent to the model").
        const todo = at.filter((i) => readAt(i, source).trim() !== '' && (replace || readAt(i, target) === ''));
        if (!todo.length) continue;
        const texts = todo.map((i) => readAt(i, source));
        if (!checked) {
          // Offline, AI off for the file or no account stop the step whatever Continue on error says.
          this.aiFor(f, step);
          this.aiAccount(f, p, step);
          checked = true;
        }
        let vectors: number[][];
        try {
          vectors = await this.embedTexts(f, step, model(), texts);
        } catch (e) {
          // Continue on error: these records stay as they were, and the rest go on.
          if (a.continueOnError && e instanceof ScriptError) continue;
          throw e;
        }
        todo.forEach((i, n) => {
          fs.index = i;
          this.poll(f);
          this.readCache.clear();
          this.setField(f, p, this.embeddingValue(f, p, vectors[n]));
          this.commit(win);
        });
      }
    } finally {
      fs.index = keep;
    }
  }

  /**
   * Generate Response from Model: the user prompt (after the conversation in Messages, if any) goes to
   * the server's model with the step's instructions; the answer goes to Response, and the conversation,
   * keeping Message History Count previous pairs plus the current pair, to Save Message History To
   * as a JSON array of {role, content}.
   * Agentic mode, tool definitions and streaming are not decoded yet: the answer comes back whole, and
   * the model calls no tools.
   */
  private async generateResponse(f: Frame, p: StepParams): Promise<void> {
    const step = 'Generate Response from Model';
    const ai = this.aiFor(f, step);
    this.aiAccount(f, p, step);
    const a = p.ai ?? {};
    const rep = a.historyRepetition !== undefined ? Math.max(1, Math.trunc(asNumber(this.eval(f, a.historyRepetition))) || 1) : 1;
    const prior = a.messagesVariable ? readMessages(asText(this.getVariable(f, a.messagesVariable, rep) ?? text(''))) : [];
    const messages: AiMessage[] = [...prior, { role: 'user', content: asText(this.eval(f, a.input ?? '""')) }];
    const system = a.instructions !== undefined ? asText(this.eval(f, a.instructions)) || undefined : undefined;
    let answer: string;
    try {
      answer = await ai.generate({ file: f.store.name, account: this.opts.account, signal: this.aiSignal(), model: asText(this.eval(f, a.model ?? '""')), ...(system ? { system } : {}), messages });
    } catch (e) {
      rethrowExecutionRefusal(e);
      throw new ScriptError(ERROR.unavailable, `${step}: ${(e as Error).message}`);
    }
    if (a.historyVariable) {
      let history = prior;
      if (a.historyCount !== undefined) {
        const count = Math.max(0, Math.trunc(asNumber(this.eval(f, a.historyCount))));
        const pairs: AiMessage[][] = [];
        // Only a user question followed by an assistant answer is a previous pair.
        for (let i = 0; i + 1 < prior.length; i++) {
          if (prior[i].role === 'user' && prior[i + 1].role === 'assistant') pairs.push(prior.slice(i, i + 2));
        }
        history = count > 0 ? pairs.slice(-count).flat() : [];
      }
      const all: AiMessage[] = [...history, messages.at(-1)!, { role: 'assistant', content: answer }];
      this.setVariable(f, a.historyVariable, rep, text(JSON.stringify(all)));
    }
    this.storeResult(f, p, text(answer));
  }

  /**
   * Perform Find by Natural Language: the model gets the request and the current layout's field names and
   * types (never record data), then the Get option determines whether to find or return JSON.
   */
  private async findByNaturalLanguage(f: Frame, p: StepParams): Promise<void> {
    const step = 'Perform Find by Natural Language';
    const ai = this.aiFor(f, step);
    this.aiAccount(f, p, step);
    const a = p.ai ?? {};
    const win = this.current;
    const info = this.layoutOf(win);
    const fields = info.fields.filter((x) => !info.uses || info.uses.has(x.name.toLowerCase())).map((x) => ({ name: x.name, type: String(x.type) }));
    const template = a.templateName !== undefined ? this.session.ai.templates.get(asText(this.eval(f, a.templateName)).toLowerCase()) : undefined;
    let answer: string;
    try {
      answer = await ai.generate({
        file: f.store.name, account: this.opts.account, signal: this.aiSignal(), model: asText(this.eval(f, a.model ?? '""')),
        system: findPrompt(fields, template?.naturalLanguage), messages: [{ role: 'user', content: asText(this.eval(f, a.prompt ?? '""')) }],
      });
    } catch (e) {
      rethrowExecutionRefusal(e);
      throw new ScriptError(ERROR.unavailable, `${step}: ${(e as Error).message}`);
    }
    const generated = parseFindAnswer(answer, fields.map((x) => x.name));
    const { requests, sort } = generated;
    const get = a.findGet ?? 'found set';
    if (!requests.length) throw new ScriptError(ERROR.noCriteria, `${step}: the model gave no find request on this layout's fields`);
    if (get === 'find request as json') {
      const query = requests.map((r) => ({
        ...Object.fromEntries(Object.entries(r.criteria).map(([name, value]) => [`${info.occurrence}::${name}`, value])),
        ...(r.omit ? { omit: 'true' } : {}),
      }));
      const requestSort = sort.map((x) => ({ fieldName: `${info.occurrence}::${x.fieldName}`, sortOrder: x.sortOrder }));
      if (p.field || p.variable) this.storeResult(f, p, text(JSON.stringify({ layouts: info.name, query, sort: requestSort })));
      return;
    }
    if (get === 'found set as json') {
      const query = requests.map((r) => ({ ...r.criteria, ...(r.omit ? { omit: 'true' } : {}) }));
      const requestSort = sort.map((x) => ({ fieldName: x.fieldName, sortOrder: x.sortOrder }));
      // Pages are read back to back with no await between them, so nothing in this
      // process can change the records while the response is assembled.
      const dataParts: string[] = [];
      let dataBytes = 0;
      let response: { messages: { code: string; message: string }[]; response: { dataInfo?: Record<string, unknown>; data?: unknown[] } } | undefined;
      let expected = 0;
      let offset = 1;
      while (offset === 1 || offset <= expected) {
        this.late(f);
        this.overMemory(f.script.name);
        const r = executeDataApi(win.store, JSON.stringify({ action: 'read', layouts: win.layoutName, query, sort: requestSort, offset, limit: FIND_JSON_BATCH_SIZE }), { ...this.reading, rethrowExecutionRefusal });
        const page = JSON.parse(r.json) as typeof response;
        if (r.code) {
          this.readCache.clear();
          if (p.field || p.variable) this.storeResult(f, p, text(r.json));
          this.forced = { code: r.code, message: r.message };
          return;
        }
        response ??= page;
        if (!response) throw new ScriptError(ERROR.capacity, 'Exceeded host capacity: the JSON response could not be assembled');
        if (offset === 1) expected = Number(page?.response.dataInfo?.foundCount ?? 0);
        const rows = Array.isArray(page?.response.data) ? page.response.data : [];
        for (const row of rows) {
          const part = JSON.stringify(row);
          dataBytes += Buffer.byteLength(part) + (dataParts.length ? 1 : 0);
          const metadata = {
            messages: response.messages,
            response: { dataInfo: { ...response.response.dataInfo, returnedCount: dataParts.length + rows.length }, data: [] },
          };
          const wrapperBytes = Buffer.byteLength(JSON.stringify(metadata)) - 2;
          if (dataBytes + wrapperBytes > FIND_JSON_BYTE_LIMIT) {
            throw new ScriptError(ERROR.capacity, `Exceeded host capacity: the JSON response exceeds the ${Math.floor(FIND_JSON_BYTE_LIMIT / 1048576)} MB response byte limit`);
          }
          dataParts.push(part);
        }
        offset += rows.length;
        if (rows.length < FIND_JSON_BATCH_SIZE || offset > expected) break;
      }
      if (dataParts.length !== expected) {
        throw new ScriptError(ERROR.capacity, 'Exceeded host capacity: the found set changed while its JSON response was being read; retry the request');
      }
      const result = JSON.stringify({
        messages: response?.messages ?? [],
        response: { dataInfo: { ...response?.response.dataInfo, returnedCount: dataParts.length }, data: [] },
      }).replace(/"data":\[\]/, () => `"data":[${dataParts.join(',')}]`);
      if (Buffer.byteLength(result) > FIND_JSON_BYTE_LIMIT) {
        throw new ScriptError(ERROR.capacity, `Exceeded host capacity: the JSON response exceeds the ${Math.floor(FIND_JSON_BYTE_LIMIT / 1048576)} MB response byte limit`);
      }
      this.readCache.clear();
      if (p.field || p.variable) this.storeResult(f, p, text(result));
      return;
    }
    this.performFind(f, {}, 28, requests);
    if (sort.length) {
      const found = this.foundSet(win);
      this.setFound(win, found.ids, sort.map((x) => ({ fieldName: x.fieldName, sortOrder: x.sortOrder })));
    }
  }

  /**
   * Perform SQL Query by Natural Language: the model sees the tables as DDL, only the ones and only the fields the
   * account can see (never record data), and writes a SELECT that runs as ExecuteSQL does, with the account's
   * privileges, so it reads nothing the account couldn't read itself. A query that fails goes back to the model
   * with its error, up to three tries. Get DDL never asks the model. Action Query sends the result to the model
   * for an answer in plain words, as Generate Response from Model sends what a script gives it.
   */
  private async sqlByNaturalLanguage(f: Frame, p: StepParams): Promise<void> {
    const step = 'Perform SQL Query by Natural Language';
    const a = p.ai;
    if (!a) throw new ScriptError(ERROR.unavailable, `${step}: this step's options aren't read from .fmp12 files yet (script text carries them)`);
    const action = a.sqlAction ?? 'query';
    const visible = schemaVisibility(this.privileges?.in(f.store));
    let ddl: string;
    if (a.dataTables === 'by ddl') ddl = asText(this.eval(f, a.tablesCalculation ?? '""'));
    else {
      const names = a.dataTables === 'by name' ? asText(this.eval(f, a.tablesCalculation ?? '""')).split(/[\r\n]+/)
        : a.tables?.length ? a.tables : f.store.schema.tableOccurrences.filter((t) => !t.dataSourceId).map((t) => t.name);
      ddl = tableDDL(f.store.schema, JSON.stringify(names.map((x) => x.trim()).filter(Boolean)), false, visible);
    }
    if (action === 'get ddl') {
      this.storeResult(f, p, text(ddl));
      return;
    }
    const ai = this.aiFor(f, step);
    this.aiAccount(f, p, step);
    const question = asText(this.eval(f, a.prompt ?? '""'));
    const model = asText(this.eval(f, a.model ?? '""'));
    const template = a.templateName !== undefined ? this.session.ai.templates.get(asText(this.eval(f, a.templateName)).toLowerCase()) : undefined;
    const ask = async (system: string, messages: AiMessage[]) => {
      try {
        return await ai.generate({ file: f.store.name, account: this.opts.account, signal: this.aiSignal(), model, system, messages });
      } catch (e) {
        throw new ScriptError(ERROR.unavailable, `${step}: ${(e as Error).message}`);
      }
    };
    if (!ddl.trim()) {
      this.storeResult(f, p, text('No tables this account can see were given to the model.'));
      return;
    }
    const system = sqlPrompt(ddl, question, template?.sql);
    const messages: AiMessage[] = [{ role: 'user', content: question }];
    const written: string[] = [];
    let rows: Value[][] | undefined;
    let lastError = '';
    for (let round = 0; round < 3 && !rows; round++) {
      const answer = await ask(system, messages);
      const got = parseSqlAnswer(answer);
      if ('none' in got) {
        // Nothing relevant: the model's reason is the response, and the step succeeds (as Claris documents).
        this.storeResult(f, p, text(written.length ? written.join('\r') : got.none));
        return;
      }
      written.push(got.sql);
      if (action === 'get first sql only') break;
      try {
        // The query's data goes back to the model (its result, or an error about it): the file it reads must allow AI too.
        // So must the file of each calculated field the query works out.
        const { target, computed } = f.store.calc.translateSQL(got.sql, this.privileges);
        for (const name of new Set([target.name, ...computed.map((c) => c.store.name)])) {
          if (name === f.store.name) continue;
          if (captureOnly(name, this.opts.outbound?.captureOnly)) throw new ScriptError(ERROR.unavailable, `${step} is not available: "${name}" is a capture-only file, and its data never goes to AI`);
          const why = ai.refusal(name, this.opts.account);
          if (why) throw new ScriptError(ERROR.unavailable, `${step} is not available: ${why}`);
        }
        rows = f.store.calc.executeSQL(got.sql, [], this.privileges);
      } catch (e) {
        if (e instanceof ScriptError) throw e;
        lastError = (e as Error).message;
        messages.push({ role: 'assistant', content: answer }, { role: 'user', content: `That query failed: ${lastError}\nWrite a corrected SELECT.` });
      }
    }
    if (action === 'get first sql only' || action === 'get sql') {
      if (!rows && action === 'get sql') throw new ScriptError(ERROR.calculation, `${step}: none of the SQL the model wrote would run (${lastError})`);
      this.storeResult(f, p, text(written.join('\r')));
      return;
    }
    if (!rows) throw new ScriptError(ERROR.calculation, `${step}: none of the SQL the model wrote would run (${lastError})`);
    if (action === 'query for data only') {
      this.storeResult(f, p, text(rows.map((r) => r.map((v) => asText(v)).join(',')).join('\r')));
      return;
    }
    const shown = rows.slice(0, SQL_ANSWER_ROWS).map((r) => r.map((v) => asText(v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n') +
      (rows.length > SQL_ANSWER_ROWS ? `\n(${rows.length - SQL_ANSWER_ROWS} more records not shown)` : '');
    const sql = written.at(-1)!;
    const reply = await ask(sqlAnswerPrompt(question, sql, shown, template?.naturalLanguage), [{ role: 'user', content: question }]);
    this.storeResult(f, p, text(reply));
  }

  /** Sorts record ids; a related field (TO::field) sorts by the first related record's value. */
  private sortIds(win: Window, info: LayoutInfo, ids: number[], sort: SortSpec[], f?: Frame): number[] {
    this.opts.beforeFile?.(info.owner);
    // The store sorts on the stored values, so a field the account can't read (hidden or masked) is sorted here, where it reads as empty.
    const pv = this.privileges?.in(info.owner);
    const unreadable = (x: SortSpec) => !!pv && !x.fieldName.includes('::') && pv.field(info.table, x.fieldName.replace(/\(\d+\)$/, '')) === 'none';
    const custom = (x: SortSpec) => !['ascend', 'ascending', 'descend', 'descending'].includes((x.sortOrder ?? 'ascend').toLowerCase());
    const recordId = this.currentId(win);
    if (!sort.some((x) => x.fieldName.includes('::') || unreadable(x))) return info.owner.sortIds(info, ids, sort, {
      privileges: this.privileges, valueLists: { store: win.store, recordId },
    });
    const orders = sort.map((x) => {
      if (!custom(x)) return undefined;
      if (this.privileges?.in(win.store).valueList(x.sortOrder!) === 'none') throw new StoreError(108, `Value list "${x.sortOrder}" is missing`);
      const items = win.store.valueListItems(x.sortOrder!, recordId !== undefined ? { info, recordId } : undefined, this.privileges);
      const at = x.fieldName.indexOf('::');
      const source = at < 0 ? info : win.store.occurrence(x.fieldName.slice(0, at));
      const name = at < 0 ? x.fieldName : x.fieldName.slice(at + 2);
      const field = this.tableFields(source).find((field) => field.name === name);
      if (!field) throw new StoreError(102, `Field "${x.fieldName}" is missing`);
      return valueListOrder(field, source.owner.dateOrder, items.map((item) => item.value));
    });
    const fields = this.tableFields(info);
    const languages = sort.map((x) => {
      const at = x.fieldName.indexOf('::');
      const source = at < 0 ? info : win.store.occurrence(x.fieldName.slice(0, at));
      const name = at < 0 ? x.fieldName : x.fieldName.slice(at + 2);
      const field = this.tableFields(source).find((field) => field.name === name);
      return recordSortLanguage(field?.options?.indexLanguage, field?.options?.indexLanguageId);
    });
    const keyOf = (id: number, fieldName: string): Value => {
      const at = fieldName.indexOf('::');
      if (at < 0) {
        const field = fields.find((x) => x.name === fieldName);
        return field ? this.valueOf(info, field, id, 1) : text('');
      }
      const other = win.store.occurrence(fieldName.slice(0, at));
      const field = this.tableFields(other).find((x) => x.name === fieldName.slice(at + 2));
      const first = field && this.relatedIds(win, other.occurrence, { occurrence: info.occurrence, ids: [id] })[0];
      return field && first !== undefined ? this.valueOf(other, field, first, 1) : text('');
    };
    const keys = new Map(ids.map((id) => {
      if (f) this.poll(f);
      return [id, sort.map((x) => keyOf(id, x.fieldName))];
    }));
    const compare = (a: Value, b: Value, language: string): number => {
      const ta = asText(a);
      const tb = asText(b);
      // Empty values sort first, as in FileMaker.
      if (ta === '' || tb === '') return ta === tb ? 0 : ta === '' ? -1 : 1;
      if (a.type !== 'text' && b.type !== 'text') return asNumber(a) - asNumber(b);
      const ka = language === 'unicode' ? ta : recordSortKey(ta, language);
      const kb = language === 'unicode' ? tb : recordSortKey(tb, language);
      return Buffer.compare(Buffer.from(ka), Buffer.from(kb));
    };
    return [...ids].sort((x, y) => {
      const kx = keys.get(x)!;
      const ky = keys.get(y)!;
      for (let i = 0; i < sort.length; i++) {
        const order = orders[i];
        if (order) {
          const c = order.compare(kx[i], ky[i]);
          if (c) return c;
          continue;
        }
        const c = compare(kx[i], ky[i], languages[i]);
        if (c) return ['descend', 'descending'].includes((sort[i].sortOrder ?? '').toLowerCase()) ? -c : c;
      }
      return x - y;
    });
  }

  private commitOrDrop(win: Window): void {
    try {
      this.commit(win);
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (!(e instanceof StoreError || e instanceof PrivilegeError)) throw e;
      this.observeDenial(e, e.code);
      this.revert(win);
    }
  }

  // --- transactions -------------------------------------------------------------

  /** Revert Transaction, or a step error with Set Revert Transaction on Error on: undo it all and go on after its Commit Transaction. */
  private revertTransaction(error = 0, detail = '', denial?: AccessDenial): void {
    const tx = this.tx;
    if (!tx) return;
    this.tx = undefined;
    const slot = writer.getStore()?.transaction;
    if (slot?.open === tx.state) slot.open = undefined;
    for (const w of this.windows) {
      w.pending = new Map();
      w.pendingPrivileges = undefined;
      w.uncommittedNew = false;
      this.unlockEdits(w);
    }
    endTransaction(tx.state, false);
    this.readCache.clear();
    // Records the transaction created are gone from found sets.
    for (const w of this.windows) {
      for (const [occurrence, fs] of w.foundSets) {
        try {
          const info = w.store.occurrence(occurrence);
          const left = new Set(info.owner.findIds(info, this.reading));
          const kept = fs.ids.filter((id) => left.has(id));
          if (kept.length === fs.ids.length) continue;
          const current = fs.ids[fs.index];
          fs.ids = kept;
          fs.index = Math.max(0, current !== undefined && kept.includes(current) ? kept.indexOf(current) : Math.min(fs.index, kept.length - 1));
        } catch (e) {
          rethrowExecutionRefusal(e);
          // a found set on a file or table that isn't there
        }
      }
    }
    this.unwinding = { frame: tx.frame, to: tx.after, error, detail, denial };
  }

  /**
   * The file a write to a layout's records goes through: the layout's own, so its layout privileges (records view
   * only) apply even when the layout shows a table from another file, which then checks its record and field access.
   */
  private via(info: LayoutInfo): Store {
    const file = info.layoutId !== undefined && info.home ? info.home : info.owner;
    const tx = this.tx;
    if (!tx || tx.window === this.current) return file;
    const writes = new Set(['create', 'duplicate', 'update', 'delete', 'setContainer']);
    return new Proxy(file, { get: (target, property, receiver) => {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== 'string' || !writes.has(property) || typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const targetInfo = args[0] as LayoutInfo;
        const id = typeof args[1] === 'number' ? args[1] : undefined;
        if (id !== undefined && this.txRecordLocked(targetInfo, id)) throw new StoreError(301, 'Record is in use by the originating transaction window');
        const write = () => Reflect.apply(value, target, args);
        return targetInfo.owner.independentWindowWrite(tx.state, () => target === targetInfo.owner
          ? write() : target.independentWindowWrite(tx.state, write));
      };
    } });
  }

  private txRecordLocked(info: LayoutInfo, id: number): boolean {
    return this.tx?.window !== this.current && !!this.tx?.state.windowRecords?.get(info.owner)?.has(`${info.table}\u0000${id}`);
  }

  private holdWindowRecord(win: Window, info: LayoutInfo, id: number): void {
    const tx = this.tx?.window === win ? this.tx.state : undefined;
    if (!tx) return;
    let records = tx.windowRecords?.get(info.owner);
    if (!records) (tx.windowRecords ??= new Map()).set(info.owner, records = new Set());
    records.add(`${info.table}\u0000${id}`);
  }

  /** Writes the current record's pending edits; `skipValidation`: only fields validated "Always" are checked. */
  private commit(win: Window, skipValidation = false): void {
    this.leaveField(win);
    // A new record is checked at its first commit even with nothing to write: a required field left empty fails.
    if (!win.pending.size && !win.uncommittedNew) return this.unlockEdits(win);
    const id = this.currentId(win);
    const info = win.layout;
    const data = Object.fromEntries(win.pending);
    // Edits are checked with the privileges of the scripts that made them, not of the one committing.
    const privileges = win.pendingPrivileges;
    // A commit that fails (validation, privileges, a lock) leaves the record open with its edits, as in FileMaker.
    if (id !== undefined && info) this.via(info).update(info, id, data, undefined, { account: this.opts.account, privileges, editKey: win.pending, ...(win.uncommittedNew ? { firstCommit: true } : {}), ...this.txWrite, ...(skipValidation ? { skipEntryValidation: true } : {}) });
    if (id !== undefined && info) this.touched(info);
    win.pending = new Map();
    win.pendingPrivileges = undefined;
    win.uncommittedNew = false;
    this.unlockEdits(win);
    this.readCache.clear();
  }

  /**
   * Locks the window's current record for this run's edits, as FileMaker does
   * when a script opens or changes a record: someone else editing it is error
   * 301, and others get 301 until the script commits or reverts. Only runs
   * with an owner (a session, a schedule) can hold a lock; others just check.
   */
  private lockForEdit(win: Window): void {
    const info = win.layout;
    const id = this.currentId(win);
    if (!info || id === undefined || win.uncommittedNew) return;
    if (this.txRecordLocked(info, id)) throw new StoreError(301, 'Record is in use by the originating transaction window');
    const owner = writer.getStore()?.owner;
    if (!owner) {
      const lock = info.owner.locks.holder(info.table, id);
      if (lock) throw new StoreError(301, `Record is in use by another user (${lock.account})`);
      this.holdWindowRecord(win, info, id);
      return;
    }
    const h = win.held;
    if (h && !(h.id === id && h.info.owner === info.owner && h.info.table === info.table)) this.unlockEdits(win);
    const account = this.opts.account ?? '';
    const r = info.owner.locks.acquire(info.table, id, owner, account);
    if (!r.ok) throw new StoreError(301, `Record is in use by another user (${r.lock.account})`);
    this.holdWindowRecord(win, info, id);
    if (!r.fresh) return; // renewed: this run's own lock, or one its session already held (the session releases that)
    const transaction = writer.getStore()?.transaction?.open;
    const held = win.held = { info, id, owner, transaction };
    if (transaction) (transaction.releaseLocks ??= new Set()).add(() => {
      if (win.held === held) win.held = undefined;
      this.releaseEdit(held);
    });
    info.owner.notify('lock', info.table, id, undefined, { owner, account });
  }

  /** Releases the lock lockForEdit() took for the window's edits. */
  private unlockEdits(win: Window): void {
    const h = win.held;
    if (!h) return;
    win.held = undefined;
    if (h.transaction) return; // a record commit/navigation inside a transaction does not end its lease
    this.releaseEdit(h);
  }

  private releaseEdit(h: NonNullable<Window['held']>): void {
    if (h.info.owner.locks.release(h.info.table, h.id, h.owner)) h.info.owner.notify('unlock', h.info.table, h.id, undefined, { owner: h.owner, account: this.opts.account ?? '' });
  }

  // --- running ----------------------------------------------------------------

  private async perform(store: Store, script: Script, parameter: Value, win: Window, locals = new Map<string, Value[]>()): Promise<Value> {
    this.useSourceFile(store);
    if (this.opts.skip?.(script.name)) {
      this.actions.push({ step: 'Skip Script', script: script.name, reason: 'skipped: never run' });
      throw new ScriptError(ERROR.unavailable, `Script "${script.name}" is skipped and was not run`);
    }
    this.diagnostics.inspect([...store.schema.scripts, script], store.schema.customFunctions.map((cf) => cf.name));
    this.diagnostics.scriptState(asText(parameter, store.dateOrder), asText(this.lastResult, store.dateOrder));
    const frame: Frame = {
      script, store, locals, parameter, result: text(''), window: win,
      originalLayout: win.layoutName,
    };
    const limited = this.limitedFrames.at(-1)?.limits;
    if (script.limits || limited) {
      const own = { steps: this.steps + (script.limits?.steps ?? Infinity), busy: this.busy() + (script.limits?.seconds ?? Infinity) * 1000 };
      frame.limits = {
        ...(limited && limited.steps <= own.steps ? { steps: limited.steps, stepsBy: limited.stepsBy } : { steps: own.steps, stepsBy: frame }),
        ...(limited && limited.busy <= own.busy ? { busy: limited.busy, busyBy: limited.busyBy } : { busy: own.busy, busyBy: frame }),
      };
    }
    const b = blockCache.get(script) ?? blocks(script.steps);
    blockCache.set(script, b);
    const steps = script.steps;
    const outer = this.frame;
    const revertOnError = this.revertOnError;
    this.frame = frame;
    this.stack.push({ frame, pc: 0 });
    if (frame.limits) this.limitedFrames.push(frame);
    const programs = this.aiPrograms.get(frame.store.name) ?? new Set<Script>();
    programs.add(script);
    this.aiPrograms.set(frame.store.name, programs);
    this.opts.profile?.enter?.(store.name, script.name);
    try {
      return await this.runSteps(frame, b);
    } finally {
      this.frame = outer;
      this.stack.pop();
      if (frame.limits) this.limitedFrames.splice(this.limitedFrames.lastIndexOf(frame), 1);
      // Set Revert Transaction on Error lasts while this script and its subscripts run.
      this.revertOnError = revertOnError;
      // A script that ends (or halts) without reaching its Commit Transaction keeps none of the transaction's changes.
      if (this.tx?.frame === frame) this.revertTransaction();
      if (this.unwinding?.frame === frame) this.unwinding = undefined;
      // Observation callbacks may throw; essential transaction cleanup must already be complete.
      this.opts.profile?.leave?.(store.name, script.name);
    }
  }

  private async runSteps(frame: Frame, b: Blocks): Promise<Value> {
    const { script } = frame;
    const steps = script.steps;
    let pc = 0;
    while (pc < steps.length) {
      const step = steps[pc];
      if (!step.enabled || step.stepId === 89) {
        pc++;
        continue;
      }
      const parentWork = this.work;
      const parentCleanup = this.workCleanup;
      this.work = undefined;
      this.workCleanup = [];
      try {
        this.canceled(script.name);
        if (++this.steps > (this.opts.maxSteps ?? STEP_LIMIT) || Date.now() > this.deadline) {
          const what = this.steps > (this.opts.maxSteps ?? STEP_LIMIT) ? 'step limit' : 'time limit';
          this.actions.push({ step: 'Halt Script', script: script.name, reason: `${what} reached${this.whereNow()}${this.inLoop(frame, b, pc)}` });
          throw new Halt();
        }
        if (this.limitedFrames.length) this.ownLimits(frame, b, pc);
        if ((this.steps & 63) === 0) this.overMemory(script.name);
        if (this.tally.stop) {
          this.actions.push({ step: 'Halt Script', script: script.name, reason: this.tally.stop });
          throw new Halt();
        }
        // Let other requests run during long scripts.
        if (this.steps % 2000 === 0) await new Promise((r) => setImmediate(r));
        if (this.opts.debug) {
          this.stack[this.stack.length - 1].pc = pc;
          // No time limit while the script waits (the Data Viewer can evaluate meanwhile).
          const left = this.deadline - Date.now();
          this.hold();
          const paused = this.profileNow();
          let answer: DebugAnswer;
          try {
            const pending = Promise.resolve(this.opts.debug(this.debugPoint(frame, pc, step)));
            try {
              answer = this.stopSignal ? await untilCanceled(pending, this.stopSignal) : await pending;
            } catch (e) {
              if (this.stopSignal?.aborted) this.canceled(script.name);
              throw e;
            }
          } finally {
            this.pausedMs += this.profileNow() - paused;
            this.resumeAfter(left);
          }
          // Halted before this step ran: it isn't counted among the steps run.
          if (answer === 'halt') {
            this.steps--;
            throw new Halt();
          }
          if (answer && typeof answer === 'object' && Number.isInteger(answer.next) && answer.next >= 0 && answer.next < steps.length) {
            this.steps--;
            pc = answer.next;
            continue;
          }
        }
        this.calcError = 0;
        let error = 0;
        let message: string | undefined;
        let denial: AccessDenial | undefined;
        let next = pc + 1;
        const profile = this.opts.profile;
        const outerChild = this.childMs;
        const began = profile ? this.profileNow() : 0;
        const pausedBefore = this.pausedMs;
        if (profile) this.childMs = 0;
        const timed = profile ? (err: number) => {
          // Time the debugger held a subscript's steps isn't this step's either.
          this.opts.profileClock?.advanceStep?.();
          const took = this.profileNow() - began - (this.pausedMs - pausedBefore);
          profile.step(frame.store.name, script.name, pc, this.diagnostics.line(step, this.hiddenSource(frame.store, script)), took - this.childMs, err);
          this.childMs = outerChild + took;
        } : noTiming;
        try {
          this.canceled(script.name);
          // A transaction belongs to the window that opened it. Give each step
          // its own writer context so writes after Select/New Window commit outside
          // that transaction, while subscripts in the original window share it.
          const context = writer.getStore();
          const open = this.tx ? (this.tx.window === this.current ? this.tx.state : undefined) : context?.transaction?.open;
          const stepContext = context ? { ...context, transaction: { open } } : undefined;
          const jump = await writer.run(stepContext ?? {}, async () => {
            const transaction = writer.getStore()?.transaction?.open;
            if (transaction) renewTransactionLocks(transaction);
            // A caller may have returned from another file after isolation was
            // enabled. Check both files before location or trigger work can inspect
            // schema, layout, trigger, or window state for this step.
            this.opts.beforeFile?.(frame.store);
            this.opts.beforeFile?.(this.current.store);
            // Recheck after waits and debugger pauses, immediately before the step. After the isolation check, so a refused
            // file's schema is never read to look up the account.
            this.enforceExecution(frame.store);
            await this.locate(frame, step);
            this.enforceExecution(frame.store);
            this.canceled(script.name);
            // A final targeted action needs no subsequent window reload unless a later step may change its display.
            if (!WINDOWLESS_STEPS.has(step.stepId) && ![79, 80, 146, 167, 180, 175, 145].includes(step.stepId)) this.syncVersion++;
            // Steps that never wait run without a promise each (a loop's If, Set Variable and Set Field), unless a formula
            // may call GetEmbedding, which waits for the model and runs the step again.
            if (BEFORE_TRIGGER_STEPS.has(step.stepId) && !(await this.beforeTriggers(frame, step))) {
              this.layoutChosen = undefined;
              this.objectChosen = undefined;
              this.windowChosen = undefined;
              throw new ScriptError(ERROR.canceledByTrigger, `A script trigger canceled ${step.name}`);
            }
            this.enforceExecution(frame.store);
            this.canceled(script.name);
            if (EMBEDS.test(JSON.stringify(step.params ?? {})) || (step.calculations ?? []).some((calculation) => EMBEDS.test(calculation))) {
              this.opts.beforeFile?.(frame.store);
              if (this.current.store !== frame.store) this.opts.beforeFile?.(this.current.store);
            }
            this.modified = MODIFY_STEPS.has(step.stepId) ? [] : undefined;
            const quick: number | 'exit' | undefined | typeof SLOW = QUICK_STEPS.has(step.stepId) && !this.mayEmbed(frame, step) ? this.quickStepNoEmbedding(frame, step, pc, b) : SLOW;
            return quick !== SLOW ? quick : await this.stepWithEmbeddings(frame, step, pc, b);
          });
          this.canceled(script.name);
          if (jump === 'exit') {
            timed(0);
            this.traceStep(script, pc, step, 0);
            return frame.result;
          }
          if (jump !== undefined) next = jump;
        } catch (e) {
          rethrowExecutionRefusal(e);
          if (!(e instanceof Halt)) this.canceled(script.name);
          if (profile && !(e instanceof ScriptError || e instanceof StoreError || e instanceof CalcError || e instanceof PrivilegeError || e instanceof RangeError)) timed(-1);
          if (e instanceof Halt) throw e;
          if (e instanceof ScriptError || e instanceof StoreError || e instanceof CalcError || e instanceof PrivilegeError) { error = e.code; message = e.message; denial = this.observeDenial(e, error); }
          // A formula nested or recursing deeper than JavaScript's stack allows: the step fails, as too-deep recursion does in FileMaker.
          else if (e instanceof RangeError && /call stack/i.test(e.message)) { error = 1200; message = 'The calculation recursed too deeply'; }
          else {
            const safe = this.diagnostics.error((e as Error).message, step, this.hiddenSource(frame.store, script));
            if (safe !== (e as Error).message) throw new Error(safe);
            throw e;
          }
        }
        if (!error && this.calcError) { error = this.calcError; message = this.calcMessage; }
        if (error === 301 && !this.recordInUse) {
          const hidden = this.hiddenSource(frame.store, script);
          this.recordInUse = {
            line: this.diagnostics.line(step, hidden),
            message: this.diagnostics.error(message ?? 'Record is in use by another user', step, hidden),
          };
        }
        const forced = this.forced;
        this.forced = undefined;
        if (forced) ({ code: error, message, denial } = forced);
        if (message) message = this.diagnostics.error(message, step, this.hiddenSource(frame.store, script));
        timed(error);
        // Control steps keep the previous error; a Perform Script that ran leaves the subscript's last error.
        if ((!CONTROL.has(step.stepId) && step.stepId !== 1) || error) {
          this.lastError = error;
          this.lastDenial = denial;
          this.lastErrorDetail = denial ? explainAccessDenial(denial).explanation : forced?.detail ?? '';
          this.lastErrorLocation = error ? `${script.name}\t${step.name}\t${pc + 1}` : '';
        }
        this.readCache.clear();
        this.traceStep(script, pc, step, error, message);
        if (error && this.errorLogging) this.logError(frame, pc, step, error);
        // Error capture off: the person sees the error and chooses to carry on or stop the script, as in FileMaker.
        if (error && !this.errorCapture && !this.unwinding) await this.errorDialog(frame, step, error);
        if (this.opts.debug) this.erred = error ? { script: script.name, index: pc, line: this.diagnostics.line(step, this.hiddenSource(frame.store, script)), code: error, ...(message ? { message } : {}) } : undefined;
        // A step that couldn't create, change or delete data reverts the open transaction (Set Revert Transaction on Error).
        // Capacity is a host resource failure: never allow a partial commit, even with automatic revert off.
        if (error && this.tx && (this.revertOnError || error === 812) && REVERTS_TRANSACTION(error)) this.revertTransaction(error, this.lastErrorDetail, this.lastDenial);
        // Before a reverted transaction is unwound: a trigger's own revert unwinds along with it.
        const modified = this.modified;
        this.modified = undefined;
        if (modified?.length && !error && !this.unwinding) await this.modifyTriggers(frame, modified);
        if (!error && !QUICK_STEPS.has(step.stepId)) await this.layoutTriggers(frame, step.stepId);
        if (this.unwinding) {
          if (this.unwinding.frame !== frame) return frame.result;
          next = this.unwinding.to;
          // Get ( LastError ) is the error that reverted it, also when that was in a subscript.
          this.lastError = this.unwinding.error;
          this.lastErrorDetail = this.unwinding.detail;
          this.lastDenial = this.unwinding.denial;
          this.unwinding = undefined;
        }
        pc = next;
      } finally {
        this.disposeWork();
        this.work = parentWork;
        this.workCleanup = parentCleanup;
      }
    }
    return frame.result;
  }

  private debugPoint(frame: Frame, pc: number, step: ScriptStep): DebugPoint {
    const win = this.current;
    const previousError = this.erred;
    this.erred = undefined;
    const fs = win.layout ? this.foundSet(win) : undefined;
    const show = (scope: Map<string, Value[]>) => {
      const out: Record<string, string> = {};
      for (const [name, values] of scope) {
        values.forEach((v, i) => {
          const shown = this.varNames.get(name) ?? name;
          if (v !== undefined) out[i ? `${shown}[${i + 1}]` : shown] = this.diagnostics.value(asText(v, win.store.dateOrder), shown, this.hiddenSource(frame.store, frame.script), this.diagnosticLiterals.get(values)?.get(i) === v);
        });
      }
      return out;
    };
    return {
      script: frame.script.name,
      index: pc,
      steps: frame.script.steps.length,
      line: this.diagnostics.line(step, this.hiddenSource(frame.store, frame.script)),
      stack: this.stack.map((s) => ({ script: s.frame.script.name, index: s.pc })),
      lastError: this.lastError,
      ...(previousError ? { previousError } : {}),
      ...(win.layoutName ? { layout: win.layoutName } : {}),
      foundCount: fs?.ids.length ?? 0,
      ...(fs?.ids[fs.index] !== undefined ? { recordId: fs.ids[fs.index] } : {}),
      mode: win.mode,
      variables: () => ({ locals: show(frame.locals), globals: show(this.session.variables) }),
      foundSet: (limit: number) => fs ? fs.ids.slice(0, Math.max(0, limit)) : [],
      pending: () => ({
        ...(win.layout ? { table: win.layout.table } : {}),
        ...(fs?.ids[fs.index] !== undefined ? { recordId: fs.ids[fs.index] } : {}),
        fields: Object.fromEntries([...win.pending].map(([k, v]) => [k, this.diagnostics.value(String(v), k, this.hiddenSource(frame.store, frame.script))])),
      }),
      evaluate: (formula: string) => {
        const [code, message] = [this.calcError, this.calcMessage];
        this.calcError = 0;
        try {
          const value = this.diagnostics.value(asText(this.eval(frame, formula), win.store.dateOrder), undefined, this.diagnostics.sensitiveExpression(formula) || this.hiddenSource(frame.store, frame.script));
          return this.calcError ? { value, error: this.calcError, ...(this.calcMessage ? { message: this.diagnostics.error(this.calcMessage, step, this.hiddenSource(frame.store, frame.script)) } : {}) } : { value };
        } catch (e) {
          rethrowExecutionRefusal(e);
          const err = e as { code?: number; message: string };
          return { value: '?', error: typeof err.code === 'number' ? err.code : -1, message: this.diagnostics.error(err.message, step, this.hiddenSource(frame.store, frame.script)) };
        } finally {
          this.calcError = code;
          this.calcMessage = message;
          this.readCache.clear();
        }
      },
    };
  }

  private traceStep(script: Script, index: number, step: ScriptStep, error: number, message?: string): void {
    if (!this.trace || this.trace.length >= TRACE_LIMIT) return;
    this.trace.push({ script: script.name, index, line: this.diagnostics.line(step, this.hiddenSource(this.frame!.store, script)), ...(error ? { error } : {}), ...(error && message ? { message } : {}) });
  }

  /** Runs one of QUICK_STEPS (steps that never wait); returns the next step index for a jump, or 'exit'. */
  private quickStep(f: Frame, s: ScriptStep, pc: number, b: Blocks): number | 'exit' | undefined {
    const p: StepParams = s.params ?? {};
    const calc = (formula: string | undefined) => (formula === undefined ? text('') : this.eval(f, formula));
    switch (s.stepId) {
      // --- control ---
      case 68: // If
        return asBoolean(calc(p.calculation)) ? undefined : this.nextBranch(f, b, pc);
      case 125: // Else If (reached after a branch ran)
      case 69: // Else
        return (b.end.get(pc) ?? pc) + 1;
      case 70: // End If
        return undefined;
      case 71: // Loop
        (f.loops ??= new Map()).set(pc, { passes: 0, created: this.created, steps: this.steps, at: this.recordAt(this.current) });
        return undefined;
      case 72: // Exit Loop If
        return asBoolean(calc(p.calculation)) ? this.exitLoop(b, pc) : undefined;
      case 73: { // End Loop
        const start = b.loop.get(pc) ?? pc;
        this.loopGuard(f, b, start);
        return start + 1;
      }
      case 103: // Exit Script
        if (p.calculation !== undefined) f.result = calc(p.calculation);
        return 'exit';
      case 141: { // Set Variable
        if (!p.variable) return undefined;
        const value = calc(p.value);
        const rep = p.repetition ? Math.max(1, Math.trunc(asNumber(calc(p.repetition)))) : 1;
        this.setVariable(f, p.variable, rep, value, p.value !== undefined && this.diagnostics.literalExpression(p.value));
        return undefined;
      }
      case 86: // Set Error Capture: no dialogs are shown here either way; Get ( ErrorCaptureState ) tells
        this.errorCapture = p.on !== false;
        return undefined;
      case 85: // Allow User Abort: nobody can abort here; Get ( AllowAbortState ) tells
        this.allowAbort = p.on !== false;
        return undefined;

      // --- fields ---
      case 76: // Set Field
      case 77: { // Insert Calculated Result
        const value = calc(p.calculation);
        if (this.calcError) return undefined; // the field keeps its value; the error is the step's
        this.place(f, p, value);
        return undefined;
      }
    }
    throw new Error(`Step ${s.stepId} is not one of the quick steps`);
  }

  /** Runs one step; returns the next step index for a jump, or 'exit'. */
  private async step(f: Frame, s: ScriptStep, pc: number, b: Blocks): Promise<number | 'exit' | undefined> {
    if (scriptStepName(s.stepId).startsWith('Unknown step ')) {
      const warning = `${scriptStepName(s.stepId)}: skipped; command unavailable (3)`;
      if (!this.warnings.includes(warning)) this.warnings.push(warning);
      throw new ScriptError(ERROR.unavailable, warning);
    }
    // A step that works in the window opens one of the person's windows here; control steps leave it as they have it.
    if (!WINDOWLESS_STEPS.has(s.stepId)) this.use(this.current);
    this.noteVisit(this.current);
    if (QUICK_STEPS.has(s.stepId)) return this.quickStep(f, s, pc, b);
    const p: StepParams = s.params ?? {};
    if (p.unsupportedOptions?.length) {
      const warning = `Unsupported imported options: ${p.unsupportedOptions.join(', ')}`;
      this.warnings.push(warning);
      throw new ScriptError(ERROR.unavailable, warning);
    }
    const win = this.current;
    const calc = (formula: string | undefined) => (formula === undefined ? text('') : this.eval(f, formula));
    const unsupported = () => {
      throw new ScriptError(ERROR.unavailable, `${s.name} is not available on the server`);
    };
    switch (s.stepId) {
      // --- control ---
      case 90: // Halt Script
      case 44: // Exit Application: on the server, the script stops as with Halt Script
        throw new Halt();
      case 1: // Perform Script
      case 164: // Perform Script on Server
        await this.performScript(f, p, s.stepId === 164);
        return undefined;
      case 210: // Perform Script on Server with Callback: the caller carries on; the callback runs when it ends
        await this.performScript(f, p, true);
        return undefined;

      // --- fields ---
      case 61: // Insert Text
        this.place(f, p, text(p.text ?? ''));
        return undefined;
      case 12: { // Insert from Last Visited: the field's value in the record this window was on before this one
        const active = win.activeField;
        if (!p.field && !active) throw new ScriptError(ERROR.fieldMissing, `${s.name} needs a field: no field is active`);
        const target: FieldRef = p.field ?? { tableOccurrence: { id: 0, name: active!.occurrence }, field: { id: 0, name: active!.field }, repetition: active!.repetition };
        const { info, field } = this.resolveTarget(f, target);
        this.noteVisit(win);
        const previous = win.visited?.get(`${info.owner.name}\u0000${info.table}`)?.previous;
        if (previous === undefined) throw new ScriptError(ERROR.recordMissing, 'No record was visited before this one');
        let value: Value;
        try {
          value = this.valueOf(info, field, previous, target.repetition ?? 1);
        } catch (e) {
          rethrowExecutionRefusal(e);
          // Deleted since, or a record this account can't see: nothing to copy.
          if (e instanceof ScriptError) throw e;
          throw new ScriptError(ERROR.recordMissing, 'The record visited before this one is not available');
        }
        this.setField(f, { field: target }, value);
        return undefined;
      }
      case 13: case 14: case 60: { // Insert Current Date / Time / User Name
        const name = s.stepId === 13 ? 'CurrentDate' : s.stepId === 14 ? 'CurrentTime' : 'AccountName';
        const value = calc(`Get ( ${name} )`);
        if (p.field) this.setField(f, p, value);
        else if (p.variable) this.setVariable(f, p.variable, 1, value);
        else {
          const target = this.activeTarget(win);
          if (!target) throw new ScriptError(ERROR.fieldMissing, `${s.name} needs a field: no field is active`);
          this.insertAtSelection(f, win, target, asText(value, win.store.dateOrder), p.selectEntireContents);
        }
        return undefined;
      }
      case 11: { // Insert from Index: a person picks one of the field's values (View Index); nobody can on a server
        if (!this.opts.indexDialog) throw new ScriptError(ERROR.unavailable, 'Insert from Index asks a person to pick from the index, and nobody can on the server');
        const target = p.field ?? this.activeTarget(win);
        if (!target) throw new ScriptError(ERROR.fieldMissing, `${s.name} needs a field: no field is active`);
        const { field } = this.resolveTarget(f, target);
        const key = `${target.tableOccurrence.name}::${field.name}`;
        // Dates and timestamps as this file writes them, so the value picked reads back as the same day.
        const dated = field.type === 'date' || field.type === 'timestamp';
        const values = win.store.fieldIndex(this.layoutOf(win), key, { limit: MAX_INDEX_VALUES, privileges: this.privileges, ...(dated ? { dateFormat: 'iso' as const } : {}) })
          .map((v) => dated ? asText(fromStored(v, field.type as ValueType), win.store.dateOrder) : v);
        const left = this.deadline - Date.now();
        this.hold();
        let picked: string | undefined;
        try {
          picked = await this.opts.indexDialog({ script: f.script.name, field: key, values, actions: this.actions.slice(), state: this.windowState() });
        } finally {
          this.resumeAfter(left);
        }
        // Cancel, or anything that isn't one of the values offered (the dialog has no way to type one).
        if (picked === undefined || !values.includes(picked)) throw new ScriptError(1, 'Insert from Index was canceled');
        if (p.field) this.setField(f, { field: target }, text(picked));
        else this.insertAtSelection(f, win, target, picked, p.selectEntireContents);
        return undefined;
      }
      case 147: { // Set Field By Name
        const name = asText(calc(p.fieldName));
        if (this.calcError) return undefined;
        const value = calc(p.calculation);
        const m = /^(.*?)::(.*)$/.exec(name);
        const occurrence = m ? m[1] : this.layoutOf(win).occurrence;
        const field = m ? m[2] : name;
        this.setField(f, { field: { tableOccurrence: { id: 0, name: occurrence }, field: { id: 0, name: field } } }, value);
        return undefined;
      }
      case 91: // Replace Field Contents
        await this.replaceField(f, p);
        return undefined;
      case 116: { // Set Next Serial Value
        if (!p.field) throw new ScriptError(ERROR.fieldMissing, 'No field to set');
        const { info, field } = this.resolveTarget(f, p.field);
        this.requireSerialAccess(info.owner, 'Set Next Serial Value');
        const table = info.owner.schema.tables.find((t) => t.name === info.table);
        const value = asText(this.eval(f, p.calculation ?? '""'));
        if (!table || !info.owner.calc.setNextSerial(table, field, value)) throw new ScriptError(ERROR.fieldMissing, `Field "${field.name}" has no serial number`);
        return undefined;
      }

      // --- records ---
      case 7: this.newRecord(); return undefined;
      case 8: this.duplicateRecord(win); return undefined;
      case 9: this.deleteRecord(win); return undefined;
      case 10: await this.deleteAll(f, win); return undefined;
      case 75: this.commit(win, p.skipValidation); return undefined; // Commit Records/Requests
      case 205: { // Open Transaction
        const slot = writer.getStore()?.transaction;
        if (!slot) throw new ScriptError(ERROR.unavailable, 'Transactions are not available here');
        // A transaction already open (a subscript's, say) is error 3, not skipped.
        if (slot.open || this.tx) throw new ScriptError(ERROR.unavailable, 'A transaction is already open');
        const after = (b.commit.get(pc) ?? f.script.steps.length - 1) + 1;
        try {
          for (const w of this.windows) this.commit(w);
        } catch (e) {
          rethrowExecutionRefusal(e);
          if (!(e instanceof StoreError || e instanceof PrivilegeError)) throw e;
          // The active record can't be committed: the steps inside the transaction are skipped.
          this.forced = { code: e.code, message: e.message, denial: this.observeDenial(e, e.code) };
          return after;
        }
        slot.open = { files: new Map() };
        this.tx = { state: slot.open, frame: f, window: win, after, ...(p.skipValidation ? { skipValidation: true } : {}), ...(p.skipAutoEnter ? { skipAutoEnter: true } : {}) };
        return undefined;
      }
      case 206: { // Commit Transaction
        if (!this.tx || this.tx.frame !== f) throw new ScriptError(ERROR.unavailable, 'No transaction is open in this script');
        const tx = this.tx;
        // A commit that fails reverts the whole transaction (the step's error says why).
        for (const w of this.windows) this.commit(w, tx.skipValidation);
        this.tx = undefined;
        const slot = writer.getStore()?.transaction;
        if (slot?.open === tx.state) slot.open = undefined;
        endTransaction(tx.state, true);
        return undefined;
      }
      case 207: { // Revert Transaction [ Condition ; Error code ; Error message ]
        this.requireDecodedOptions(207, p, s.calculations);
        if (!this.tx) throw new ScriptError(ERROR.unavailable, 'No transaction is open');
        if (p.calculation !== undefined && !asBoolean(calc(p.calculation))) return undefined;
        const code = p.errorCode !== undefined ? Math.trunc(asNumber(calc(p.errorCode))) : 0;
        const custom = code >= 5000 && code <= 5499;
        const detail = custom && p.errorMessage !== undefined ? asText(calc(p.errorMessage), win.store.dateOrder) : '';
        // Get ( LastError ) is the given code when it is a custom one (5000-5499), else 0.
        this.revertTransaction(custom ? code : 0, detail);
        if (custom) this.forced = { code, message: detail || 'Transaction reverted', detail };
        return undefined;
      }
      case 223: // Set Revert Transaction on Error
        this.requireDecodedOptions(223, p);
        this.revertOnError = p.on!;
        return undefined;
      case 51: // Revert Record/Request: exits the record, so the cursor leaves its field
        this.revert(win);
        if (win.mode === 'browse') this.leaveField(win);
        return undefined;
      case 133: { // Open Record/Request: the record must be one this account may edit and no one else is editing
        const id = win.mode === 'browse' && !win.uncommittedNew ? this.currentId(win) : undefined;
        if (id === undefined || !win.layout) return undefined;
        const info = win.layout;
        this.via(info).checkEditable(info, id, this.privileges);
        this.lockForEdit(win);
        return undefined;
      }
      case 182: { // Truncate Table
        this.opts.beforeFile?.(f.store);
        this.commit(win);
        let info = p.tableOccurrence ? f.store.occurrence(p.tableOccurrence.name) : this.layoutOf(win);
        if (p.table) {
          // A base table of this file: any of its local table occurrences addresses it.
          const to = f.store.schema.tableOccurrences.find((t) => t.baseTableId === p.table!.id && !t.dataSourceId);
          if (!to) throw new ScriptError(ERROR.missingFile, `Table "${p.table.name}" has no table occurrence`);
          info = f.store.occurrence(to.name);
        }
        this.via(info).truncate(info, this.write);
        for (const w of this.windows) {
          for (const [to, fs] of w.foundSets) if (w.store.occurrence(to).table === info.table && w.store.occurrence(to).owner === info.owner) fs.ids = [];
        }
        return undefined;
      }

      // --- navigation ---
      case 6: // Go to Layout
        this.goToLayoutStep(f, p);
        return undefined;
      case 16: // Go to Record/Request/Page
        return this.goToRecord(f, p, b, pc);
      case 74: // Go to Related Record
        this.goToRelated(f, p);
        return undefined;

      // --- found sets ---
      case 23: { // Show All Records
        win.mode = 'browse';
        const info = this.layoutOf(win);
        this.setFound(win, info.owner.findIds(info, this.reading));
        return undefined;
      }
      case 21: { // Unsort Records
        const fs = this.foundSet(win);
        const id = fs.ids[fs.index];
        fs.ids = [...fs.ids].sort((x, y) => x - y);
        fs.sort = undefined;
        fs.index = Math.max(0, fs.ids.indexOf(id!));
        return undefined;
      }
      case 39: // Sort Records
      case 154: { // Sort Records by Field
        const info = this.layoutOf(win);
        const sortSpec = (field: FieldRef, order: 'ascending' | 'descending' | 'custom', valueList?: Ref): SortSpec => {
          const fieldName = this.layoutFieldName(win, field, true);
          if (order !== 'custom') return { fieldName, sortOrder: order === 'descending' ? 'descend' : 'ascend' };
          if (!valueList && s.stepId === 154) {
            // The associated list belongs to the field object on the current layout.
            const objects: LayoutObject[] = [...(win.layoutName ? win.store.design(win.layoutName)?.objects ?? [] : [])];
            const matches: LayoutObject[] = [];
            for (const object of objects) {
              const ref = object.field;
              if (ref?.tableOccurrence?.toLowerCase() === field.tableOccurrence.name.toLowerCase() && ref.field?.toLowerCase() === field.field.name.toLowerCase()) matches.push(object);
              objects.push(...(object.children ?? []));
            }
            const associated = (matches.find((o) => o.id === win.activeField?.id) ?? matches[0])?.field;
            valueList = win.store.schema.valueLists.find((v) => associated?.valueListId !== undefined ? v.id === associated.valueListId : associated?.valueList?.toLowerCase() === v.name.toLowerCase());
          }
          const list = valueList && win.store.schema.valueLists.find((v) => valueList.name ? v.name.toLowerCase() === valueList.name.toLowerCase() : v.id === valueList.id);
          if (!list) throw new StoreError(108, `Custom sort for "${fieldName}" has no resolved value list`);
          return { fieldName, sortOrder: list.name };
        };
        let sort: SortSpec[] | undefined;
        if (s.stepId === 154 && !p.sort?.length) {
          // The active field.
          const active = this.activeTarget(win);
          if (!active) throw new ScriptError(ERROR.fieldMissing, 'Sort Records by Field names no field and no field is active');
          sort = [sortSpec(active, p.sortOrder ?? 'ascending')];
        } else {
          sort = p.sort?.map((x) => sortSpec(x.field, x.order, x.valueList));
        }
        this.commit(win); // after reading the active field, which a commit leaves
        if (s.stepId === 39 && !p.noDialog && this.opts.sortDialog) {
          const left = this.deadline - Date.now();
          this.hold();
          try {
            sort = await this.opts.sortDialog({ script: f.script.name, sort: sort ?? this.foundSet(win).sort ?? [], actions: this.actions.slice(), state: this.windowState() });
          } finally {
            this.resumeAfter(left);
          }
          if (!sort) throw new ScriptError(1, 'Sort Records was canceled'); // FileMaker's "user canceled action"
          sort = sort.map((x) => ({ fieldName: String(x.fieldName), sortOrder: x.sortOrder === undefined ? 'ascend' : String(x.sortOrder) }));
          if (!sort.length) {
            // Unsort: the found set goes back to creation order.
            const fs = this.foundSet(win);
            const id = fs.ids[fs.index];
            fs.ids = [...fs.ids].sort((a, b) => a - b);
            fs.sort = undefined;
            fs.index = Math.max(0, fs.ids.indexOf(id!));
            return undefined;
          }
        }
        // No sort order given: "FileMaker Pro uses the most recently performed sort instructions" (Sort Records
        // help); on the server the dialog is off. With none performed yet, the found set stays as it is.
        const key = `${info.owner.name}\u0000${info.table}`;
        if (!sort?.length) sort = this.foundSet(win).sort ?? this.lastSorts.get(key);
        if (!sort?.length) return undefined;
        const fs = this.foundSet(win);
        const id = fs.ids[fs.index];
        fs.ids = this.sortIds(win, info, fs.ids, sort, f);
        fs.semi = undefined;
        fs.sort = sort;
        this.lastSorts.set(key, sort);
        fs.index = Math.max(0, fs.ids.indexOf(id!));
        return undefined;
      }
      case 25: case 26: { // Omit Record, Omit Multiple Records
        if (win.mode === 'find') {
          const r = win.requests[win.requestIndex];
          if (r) r.omit = !r.omit;
          return undefined;
        }
        this.commit(win);
        const fs = this.foundSet(win);
        const n = s.stepId === 26 ? Math.max(1, Math.trunc(asNumber(calc(p.calculation ?? '1')))) : 1;
        if (!fs.ids.length) throw new ScriptError(ERROR.recordMissing, 'No record to omit');
        fs.ids.splice(fs.index, n);
        fs.index = Math.min(fs.index, Math.max(0, fs.ids.length - 1));
        return undefined;
      }
      case 27: { // Show Omitted Only
        this.commit(win);
        const info = this.layoutOf(win);
        const shown = new Set(this.foundSet(win).ids);
        this.setFound(win, info.owner.findIds(info, this.reading).filter((id) => !shown.has(id)));
        return undefined;
      }
      case 22: // Enter Find Mode
        this.commit(win);
        win.mode = 'find';
        win.preview = false;
        win.requests = p.restore && p.requests?.length ? this.storedRequests(f, p) : [{ criteria: {}, omit: false }];
        win.requestIndex = 0;
        return undefined;
      case 55: case 41: // Enter Browse Mode, Enter Preview Mode (Browse mode here; the client draws the pages)
        win.mode = 'browse';
        win.preview = s.stepId === 41;
        return undefined;
      case 43: case 242: // Print, Print PDF: the client opens the browser's print dialog
        if (this.privileges && !this.privileges.in(this.current.store).canPrint) throw new ScriptError(ERROR.privileges, 'Printing needs the "print" privilege (or a script set to run with full access privileges)');
        this.actions.push({ step: s.name, script: f.script.name });
        return undefined;
      case 161: // Insert from Device: the person's phone or computer, when there is one
        await this.insertFromDevice(f, p);
        return undefined;
      case 181: // Get Folder Path
        throw new ScriptError(ERROR.unavailable, 'Get Folder Path asks a person to choose a folder, and nobody can on the server');
      case 67: // Perform AppleScript
        throw new ScriptError(ERROR.unavailable, 'Perform AppleScript runs only in FileMaker Pro on a Mac, never on a server');
      case 202: // Configure Machine Learning Model
        throw new ScriptError(ERROR.unavailable, 'Configure Machine Learning Model loads a Core ML model, which runs only on Apple devices, not on this server');
      case 219: // Perform RAG Action: spaces kept by the server, searched by cosine similarity
        await this.ragAction(f, p);
        return undefined;
      case 227: { // Configure RAG Account: names an account for Perform RAG Action. Its endpoint and key are never read: Tabularius's own spaces answer.
        const name = asText(this.eval(f, p.ai?.ragAccountName ?? '""'));
        this.session.ai.ragConfigured = true;
        if (name) this.session.ai.ragAccounts.add(name.toLowerCase());
        return undefined;
      }
      case 117: // Execute SQL: an ODBC data source outside the solution
        throw new ScriptError(ERROR.unavailable, 'Execute SQL connects to an ODBC data source, which Tabularius doesn\'t reach; ExecuteSQL ( ) reads this file\'s own tables');
      case 152: // Save Records as Snapshot Link
        this.snapshotLink(f, p);
        return undefined;
      case 28: case 126: case 127: // Perform Find, Constrain Found Set, Extend Found Set
        this.performFind(f, p, s.stepId);
        return undefined;
      case 150: // Perform Quick Find
        win.quickFindText = asText(calc(p.calculation));
        this.quickFind(win, win.quickFindText);
        return undefined;

      // --- windows ---
      case 122: // New Window
        this.newWindow(f, win, p);
        if (p.layoutDestination) this.goToLayoutStep(f, p); // Using layout
        return undefined;
      case 33: { // Open File: the file opens hidden, so the script stays in its window
        const store = this.otherFile(f, p.dataSource);
        if (!this.windows.some((w) => w.store === store)) await this.openFile(f, store);
        return undefined;
      }
      case 34: { // Close File
        if (!p.dataSource) return undefined; // the current file stays open while its script runs
        const store = this.otherFile(f, p.dataSource);
        const open = this.windows.filter((x) => x.store === store && x !== this.current);
        // Its last window closing: the file's OnLastWindowClose runs first, in that window (not when the script's own
        // window, which stays open, is one of the file's).
        const trigger = store.schema.fileOptions?.onLastWindowClose;
        if (open.length && this.current.store !== store && trigger) {
          const caller = this.current;
          this.current = open[open.length - 1];
          try {
            await this.runTrigger(f, this.current, [{ event: 'OnLastWindowClose', scriptId: trigger.scriptId }], '', 'OnLastWindowClose', 'browse');
          } finally {
            this.current = caller;
            f.window = caller;
          }
        }
        for (const w of this.windows.filter((x) => x.store === store && x !== this.current)) {
          this.unlockEdits(w);
          this.windows.splice(this.windows.indexOf(w), 1);
        }
        return undefined;
      }
      case 49: { // Clear: the field's contents, or without Select entire contents only the text selected in it
        const target = p.field ?? this.activeTarget(win);
        const part = p.selectEntireContents === false && target ? this.selectedPart(f, target) : undefined;
        if (part) {
          this.setField(f, { field: target }, text(part.text.slice(0, part.start) + part.text.slice(part.end)));
          win.selection = [part.start, part.start];
        } else this.setField(f, p, text(''));
        return undefined;
      }
      case 47: case 46: { // Copy, Cut: into this run's clipboard (the server has no other)
        const active = !p.field && !p.variable ? this.activeTarget(win) : undefined;
        if (!p.field && !p.variable && !active) {
          // No field: Copy takes the whole record, as Copy Record/Request does.
          if (s.stepId === 46) throw new ScriptError(ERROR.fieldMissing, 'Cut needs a field: no field is active');
          this.copied(f, s, text(this.copyRecords(win, false)));
          return undefined;
        }
        const from = active ? { field: active } : p;
        // Without Select entire contents, only the text selected in the field (all of it when nothing is).
        const part = p.selectEntireContents === false && from.field ? this.selectedPart(f, from.field) : undefined;
        this.copied(f, s, part ? text(part.text.slice(part.start, part.end)) : this.sourceValue(f, from));
        if (s.stepId === 46 && from.field) this.setField(f, from, part ? text(part.text.slice(0, part.start) + part.text.slice(part.end)) : text(''));
        if (s.stepId === 46 && part) win.selection = [part.start, part.start];
        return undefined;
      }
      case 101: case 98: // Copy Record/Request, Copy All Records/Requests
        this.copied(f, s, text(this.copyRecords(win, s.stepId === 98)));
        return undefined;
      case 48: { // Paste: what Copy or Cut put on this run's clipboard, else what is on the person's own
        if (!p.field && !p.variable && !win.activeField) throw new ScriptError(ERROR.fieldMissing, 'Paste needs a field: no field is active');
        if (this.clipboard === undefined && this.opts.clipboard && !this.clipboardAsked) {
          this.clipboardAsked = true;
          const left = this.deadline - Date.now();
          this.hold();
          let got: string | undefined;
          try {
            got = await this.opts.clipboard({ script: f.script.name, actions: this.actions.slice(), state: this.windowState() });
          } finally {
            this.resumeAfter(left);
          }
          // Line breaks as FileMaker keeps them.
          if (typeof got === 'string' && got !== '') this.clipboard = text(got.replace(/\r\n?|\n/g, '\r'));
        }
        if (this.clipboard === undefined) return undefined;
        this.place(f, p, this.clipboard);
        return undefined;
      }
      case 94: { // Set Use System Formats: script text carries On/Off as a calculation; converted files carry `on`.
        const option = p.calculation?.trim().toLowerCase();
        const value = p.on === undefined && option && !['on', 'off', 'yes', 'no', 'true', 'false'].includes(option)
          ? this.eval(f, p.calculation!) : undefined;
        this.useSystemFormats = p.on ?? (option === undefined || ['on', 'yes', 'true'].includes(option) || (value !== undefined && asBoolean(value)));
        return undefined;
      }
      case 37: // Save a Copy as
        await this.saveCopy(f, p);
        return undefined;
      case 35: // Import Records
        await this.importRecords(f, p);
        return undefined;
      case 131: // Insert File
        await this.insertFile(f, p);
        return undefined;
      case 157: // Install Plug-In File
        this.installPluginFile(f, p);
        return undefined;
      case 36: // Export Records
        try { await this.exportRecords(f, p); } catch (e) { throw diskFailure(e, ERROR.cannotCreateFile); }
        return undefined;
      case 144: // Save Records as PDF
        try { await this.saveRecordsAsPdf(f, p); } catch (e) { throw diskFailure(e, ERROR.cannotCreateFile); }
        return undefined;
      case 188: case 189: case 190: case 191: case 192: case 193: case 194: case 195: case 196: case 197: case 199:
        try { this.dataFileStep(f, s.stepId, p); } catch (e) { throw diskFailure(e, s.stepId === 190 ? ERROR.cannotCreateFile : ERROR.cannotOpenFile); }
        return undefined;
      case 132: // Export Field Contents: the client saves the file
        this.exportField(f, p);
        return undefined;
      case 121: { // Close Window
        this.commit(win);
        const name = this.windowName(p, calc);
        const target = name === undefined ? win : this.windows.find((w) => w.name.toLowerCase() === name.toLowerCase());
        if (!target) throw new ScriptError(ERROR.windowMissing, `Window "${name}" is missing`);
        if (this.windows.length === 1) return undefined; // the script's own window stays
        // Another file's last window: the file closes with it, so its OnLastWindowClose runs first, in that window.
        const trigger = target.store !== f.store && !this.windows.some((w) => w !== target && w.store === target.store)
          ? target.store.schema.fileOptions?.onLastWindowClose : undefined;
        if (trigger) {
          const caller = this.current;
          this.current = target;
          try {
            await this.runTrigger(f, target, [{ event: 'OnLastWindowClose', scriptId: trigger.scriptId }], '', 'OnLastWindowClose', 'browse');
          } finally {
            this.current = caller;
            f.window = caller;
          }
          if (!this.windows.includes(target)) return undefined; // it closed the window itself
        }
        this.unlockEdits(target);
        this.windows.splice(this.windows.indexOf(target), 1);
        if (target.id) this.closed.push(target.id);
        if (target === this.current) this.current = [...this.windows].reverse().find((w) => w.store === f.store) ?? this.windows[this.windows.length - 1];
        f.window = this.current;
        return undefined;
      }
      case 123: { // Select Window
        const name = this.windowName(p, calc);
        if (name === undefined) return undefined;
        const target = this.windows.find((w) => w.name.toLowerCase() === name.toLowerCase());
        if (!target) throw new ScriptError(ERROR.windowMissing, `Window "${name}" is missing`);
        this.commit(win);
        this.current = target;
        f.window = target;
        return undefined;
      }
      case 124: { // Set Window Title
        const title = p.slots?.[129] ?? p.slots?.[128];
        if (title !== undefined) win.name = asText(calc(title));
        return undefined;
      }

      // --- the outside world ---
      case 160: // Insert from URL
        await this.insertFromUrl(f, p);
        return undefined;
      case 87: // Show Custom Dialog
        await this.customDialog(f, p, s.name);
        return undefined;
      case 63: // Send Mail: in outbound test mode, captured in the outbox; via SMTP, sent only when the operator allows it
        if (this.opts.outbound) {
          await this.sendMail(f, p, s.name);
          return undefined;
        }
        if (p.mail?.smtp && this.opts.mail) {
          await this.sendSmtp(f, p);
          return undefined;
        }
        // Via the e-mail client, in the web client: the person's own mail app opens with the message, as WebDirect
        // does, and they send it (or not). Attachments can't go in a mailto: link and are left out.
        if (!p.mail?.smtp && this.opts.downloads) {
          this.actions.push({ step: 'Open URL', script: f.script.name, url: mailtoUrl(p.mail ?? {}, (x) => asText(this.eval(f, x))) });
          return undefined;
        }
        throw new ScriptError(ERROR.unavailable, p.mail?.smtp
          ? 'Send Mail via SMTP is not available: this server never sends email unless its administrator switches sending on'
          : 'Send Mail via the e-mail client needs a person\'s browser to open their mail app in; Tabularius never sends email itself');
      case 65: // Dial Phone: the person's device dials it
        this.actions.push({ step: s.name, script: f.script.name, url: `tel:${asText(calc(p.calculation)).replace(/[^\d+#*,;]/g, '')}` });
        return undefined;
      case 111: { // Open URL: the person's window opens it; in outbound test mode, only allowlisted web pages
        const url = asText(calc(p.calculation));
        const out = this.opts.outbound;
        if (out) {
          // mailto:, sms:, tel: and other hosts would reach someone from the person's device: recorded, not opened.
          const allowed = /^https?:\/\//i.test(url) && hostAllowed(url, out.allowHosts);
          this.noteOutbound(out, { kind: 'http', at: new Date().toISOString(), script: f.script.name, via: 'Open URL', method: 'OPEN', url: redactUrl(url), host: hostOf(url), allowed, requestBytes: 0 });
          if (!allowed) return undefined;
        }
        this.actions.push({ step: s.name, script: f.script.name, url });
        return undefined;
      }
      case 99: // Go to Portal Row
        return this.goToPortalRow(f, p, b, pc);
      case 104: // Delete Portal Row
        this.deletePortalRow(win);
        return undefined;
      case 148: // Install OnTimer Script: the person's window runs the timer
        this.actions.push({ step: s.name, script: f.script.name, ...this.onTimer(f, p) });
        return undefined;
      case 175: { // Perform JavaScript in Web Viewer: the person's window calls the function in its web viewer
        if (p.functionName === undefined) return undefined;
        this.actions.push({
          step: s.name, script: f.script.name, ...this.actionScope(win),
          objectName: asText(calc(p.objectName ?? '')),
          functionName: asText(calc(p.functionName)),
          parameters: (p.jsParameters ?? []).map((x) => asText(calc(x))),
        });
        await this.clientCheckpoint(f);
        return undefined;
      }
      case 145: { // Go to Object
        const known = this.objectChosen?.params === p ? this.objectChosen : undefined;
        this.objectChosen = undefined;
        const chosen = known?.name ?? (p.objectName !== undefined ? asText(calc(p.objectName)) : '');
        this.goToObject(win, chosen, () => known?.repetition ?? (p.repetitionCalculation !== undefined ? asNumber(this.eval(f, p.repetitionCalculation)) : 1));
        const values: Record<string, string> = {};
        for (const [slot, formula] of Object.entries(p.slots ?? {})) values[slot] = asText(calc(formula));
        if (p.objectName !== undefined) values.objectName = chosen ?? asText(calc(p.objectName));
        this.actions.push({ step: s.name, script: f.script.name, ...values });
        return undefined;
      }
      case 79: // Freeze Window: only Refresh Window resumes updates during the run
        win.frozen = true;
        this.actions.push({ step: s.name, script: f.script.name, ...this.actionScope(win) });
        await this.clientCheckpoint(f);
        return undefined;
      case 80: { // Refresh Window
        if (p.flushJoinResults) win.store.flushJoinResults();
        // No ODBC provider or external-data cache exists. Retain the flag as an empty operation.
        win.frozen = false;
        this.readCache.clear();
        this.actions.push({ step: s.name, script: f.script.name, ...this.actionScope(win), flushJoinResults: !!p.flushJoinResults, flushExternalData: !!p.flushExternalData });
        await this.clientCheckpoint(f);
        return undefined;
      }
      case 180: case 167: case 146: { // Refresh Portal, Refresh Object, Set Web Viewer
        const name = p.objectName !== undefined ? asText(calc(p.objectName)) : undefined;
        const target = this.layoutObject(win, name === undefined || name === '' ? win.activeObjectId : name);
        if (!target || (s.stepId === 146 && !name)) throw new ScriptError(ERROR.objectMissing, `Object "${name ?? ''}" is missing`);
        const o = target.object;
        const scope = { ...this.actionScope(win), objectId: o.id, objectName: o.name ?? name ?? '' };
        if (s.stepId === 146) {
          if (o.kind !== 'web-viewer') throw new ScriptError(ERROR.objectMissing, `Object "${name}" is not a web viewer`);
          if (!p.viewerAction || !WEB_VIEWER_ACTIONS.includes(p.viewerAction)) throw new ScriptError(5, 'Set Web Viewer needs a decoded action');
          if (p.viewerAction === 'Go to URL' && p.viewerUrl === undefined) throw new ScriptError(5, 'Go to URL needs an address calculation');
          const url = p.viewerAction === 'Go to URL' ? asText(calc(p.viewerUrl)) : undefined;
          this.actions.push({ step: s.name, script: f.script.name, ...scope, action: p.viewerAction, ...(url !== undefined ? { url } : {}) });
        } else {
          const repetition = p.objectRepetition === undefined ? undefined : asNumber(calc(p.objectRepetition));
          if (repetition !== undefined && (!Number.isInteger(repetition) || repetition < 0)) throw new ScriptError(5, 'Repetition must be a nonnegative integer');
          const def = o.kind === 'field' && o.field ? this.schemaField(win, o.field.tableOccurrence, o.field.field ?? '') : undefined;
          if (def && repetition !== undefined && repetition > (def.options?.repetitions ?? 1)) throw new ScriptError(5, 'Repetition is out of range');
          this.readCache.clear();
          this.actions.push({ step: s.stepId === 180 && o.kind !== 'portal' ? 'Refresh Object' : s.name, script: f.script.name, ...scope, ...(repetition !== undefined && o.kind === 'field' ? { repetition } : {}) });
        }
        await this.clientCheckpoint(f);
        return undefined;
      }

      // --- accounts ---
      case 135: case 136: case 137: // Delete Account, Reset Account Password, Enable Account
        this.manageAccount(f, s.stepId, p);
        return undefined;
      case 138: // Re-Login
        await this.reLogin(f, p);
        return undefined;

      // The design dialogs: the web client opens its Design screen at the matching tab.
      case 38: case 88: case 112: case 140: case 151: case 156:
        this.actions.push({ step: s.name, script: f.script.name, open: DESIGN_SCREENS[s.stepId] });
        return undefined;
      case 142: // Install Menu Set: the client draws the menus
        if (p.menuSet) this.menuSetName = p.menuSet.name;
        if (p.menuSet) this.actions.push({ step: s.name, script: f.script.name, menuSetId: p.menuSet.id, ...(p.fileDefault ? { fileDefault: true } : {}) });
        return undefined;
      case 62: { // Pause/Resume Script: indefinitely waits for a person when one can answer; a duration waits that long
        if (p.calculation === undefined) {
          if (this.opts.pause) await this.pause(f);
          return undefined;
        }
        // As on FileMaker Server, the script waits out the duration; the time counts toward the time limit.
        const seconds = asNumber(calc(p.calculation));
        // A script's own time limit also ends the wait (the next step then stops it).
        const own = this.limitedFrames.at(-1)?.limits?.busy ?? Infinity;
        const until = () => Math.min(this.deadline, Date.now() + own - this.busy());
        const ms = Math.min(Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : 0, Math.max(0, until() - Date.now() + 1));
        if (ms > 0) {
          // A cancel ends the wait at once, as does the person stopping it while Allow User Abort is on.
          const user = this.opts.userStop;
          await new Promise<void>((r) => {
            const done = () => {
              clearTimeout(timer);
              this.stopSignal?.removeEventListener('abort', done);
              user?.removeEventListener('stop', asked);
              r();
            };
            // Runs after the constructor's listener, which decides whether the ask counts.
            const asked = () => {
              if (this.userAborted) done();
            };
            const timer = setTimeout(done, ms);
            this.stopSignal?.addEventListener('abort', done, { once: true });
            user?.addEventListener('stop', asked);
          });
          this.canceled(f.script.name);
        }
        // A timer can fire a millisecond early; if a time limit is what ended the wait, make sure it has passed.
        while (seconds * 1000 > ms && Date.now() <= until()) await new Promise((r) => setTimeout(r, 1));
        this.late(f);
        return undefined;
      }
      case 84: // Set Multi-User: a hosted file is always shared
        return undefined;

      case 17: // Go to Field
        if (!p.field) {
          // No field: the cursor leaves the field and the record is committed.
          this.commit(win);
          return undefined;
        }
        this.goToField(win, p.field.tableOccurrence.name, p.field.field.name);
        return undefined;
      case 4: // Go to Next Field
      case 5: // Go to Previous Field
        this.tab(win, s.stepId === 5);
        return undefined;
      case 40: // Relookup Field Contents
        this.relookup(f, p);
        return undefined;
      case 24: // Modify Last Find: Find mode with the last find's requests
        this.commit(win);
        win.mode = 'find';
        win.preview = false;
        win.requests = (win.lastFind?.length ? win.lastFind : [{ criteria: {}, omit: false }]).map((r) => ({ criteria: { ...r.criteria }, omit: r.omit }));
        win.requestIndex = win.requests.length - 1;
        return undefined;
      case 128: // Perform Find/Replace
        this.findReplace(f, p);
        return undefined;
      case 155: // Find Matching Records
        this.findMatching(f, p);
        return undefined;
      case 203: { // Execute FileMaker Data API: against this file, with the script's privileges, in a session of its own
        this.opts.beforeFile?.(f.store);
        const r = executeDataApi(f.store, asText(calc(p.calculation)), { ...this.write, rethrowExecutionRefusal });
        this.readCache.clear();
        if (p.field || p.variable) this.place(f, p, text(r.json));
        if (r.code) this.forced = { code: r.code, message: r.message };
        return undefined;
      }
      case 134: // Add Account
        this.addAccount(f, p);
        return undefined;
      case 83: // Change Password: the running account's own
        this.changePassword(f, p);
        return undefined;
      case 200: // Set Error Logging: needs full access, as in FileMaker
        if (this.privileges && !this.privileges.in(f.store).full) throw new ScriptError(ERROR.privileges, 'Set Error Logging needs full access (or a script set to run with full access privileges)');
        this.errorLogging = p.on === false ? undefined : { store: f.store, info: p.calculation };
        return undefined;
      case 102: // Flush Cache to Disk: every commit is already on disk
        return undefined;
      case 237: // Flush Web Viewer Cookies: the web client clears what it can
        this.actions.push({ step: s.name, script: f.script.name });
        return undefined;
      case 208: // Set Session Identifier: only Insert from URL uses it (off here); Get ( SessionIdentifier ) gives it back
        this.sessionIdentifier = asText(calc(p.calculation));
        return undefined;
      case 165: // Open Manage Themes
        this.actions.push({ step: s.name, script: f.script.name, open: 'design.html#themes' });
        return undefined;
      case 56: case 158: case 159: // Insert Picture, Insert PDF, Insert Audio/Video: the person picks a file, as for Insert File
        await this.insertFile(f, p);
        return undefined;
      case 143: // Save Records as Excel
        await this.exportRecords(f, { ...p, exportFormat: 'XLXE' });
        return undefined;
      case 225: // Save Records as JSONL
        this.saveJsonl(f, p);
        return undefined;
      case 238: { // Configure Persistent Data: needs full access; deleting an entry that isn't there is error 10
        this.opts.beforeFile?.(f.store);
        if (this.privileges && !this.privileges.in(f.store).full) throw new ScriptError(ERROR.privileges, 'Configure Persistent Data needs full access (or a script set to run with full access privileges)');
        const name = (p.text ?? '').trim();
        if (!name) throw new ScriptError(ERROR.unavailable, 'Configure Persistent Data needs a name');
        const instance = p.calculation !== undefined ? asText(calc(p.calculation)) : '';
        if (p.deleteEntry) {
          if (!f.store.setPersistentData(name, instance, undefined)) throw new ScriptError(10, `No persistent data "${name}"${instance ? ` for "${instance}"` : ''}`);
        } else {
          const value = calc(p.value);
          if (this.calcError) return undefined;
          f.store.setPersistentData(name, instance, value);
        }
        return undefined;
      }
      case 3: { // Save a Copy as XML: the file's design as XML (the Database Design Report's FMPReport form), full access only
        this.opts.beforeFile?.(f.store);
        if (this.privileges && !this.privileges.in(f.store).full) throw new ScriptError(ERROR.privileges, 'Save a Copy as XML needs full access (or a script set to run with full access privileges)');
        const path = this.pdfOutput(f, p, 'Save a Copy as XML');
        writeFileSync(path, designReport(f.store.schema, f.store.designs(), { fileName: `${f.store.name}.fmp12` }));
        return undefined;
      }
      case 243: // Create PDF: one open at a time (error 833 otherwise)
        if (this.openPdf) throw new ScriptError(833, 'PDF file is already opened');
        this.openPdf = { pages: [], title: f.script.name, owners: new Set([f.store]) };
        return undefined;
      case 244: // Append PDF (FileMaker 26): all the pages of another PDF go on the end of the open one
        this.appendToOpenPdf(f, p);
        return undefined;
      case 245: // Close PDF
        this.closePdf(f, p);
        return undefined;
      case 246: // Open PDF (FileMaker 26): an existing PDF, to add to and save with Close PDF
        this.openExistingPdf(f, p);
        return undefined;
      case 247: // Cancel PDF
        if (!this.openPdf) throw new ScriptError(5, 'No PDF is open');
        this.openPdf = undefined;
        return undefined;
      case 228: // Go to List of Records
        this.goToList(f, p);
        return undefined;
      case 218: // Perform Semantic Find
        await this.semanticFind(f, p);
        return undefined;
      case 212: { // Configure AI Account: names an account for the AI steps. Its API key and endpoint are never read: Tabularius's own AI answers.
        const name = asText(this.eval(f, p.ai?.accountName ?? '""'));
        if (name) this.session.ai.accounts.add(name.toLowerCase());
        return undefined;
      }
      case 217: // Set AI Call Logging: no operation is performed
        return undefined;
      case 226: { // Configure Prompt Template: kept for Perform Find by Natural Language in this session
        const name = asText(this.eval(f, p.ai?.templateName ?? '""'));
        const ev = (x: string | undefined) => (x === undefined ? undefined : asText(this.eval(f, x)) || undefined);
        if (name) this.session.ai.templates.set(name.toLowerCase(), { sql: ev(p.ai?.sqlPrompt), naturalLanguage: ev(p.ai?.naturalLanguagePrompt) });
        return undefined;
      }
      case 220: // Generate Response from Model
        await this.generateResponse(f, p);
        return undefined;
      case 221: // Perform Find by Natural Language
        await this.findByNaturalLanguage(f, p);
        return undefined;
      case 214: // Perform SQL Query by Natural Language
        await this.sqlByNaturalLanguage(f, p);
        return undefined;
      case 215: { // Insert Embedding
        const [vector] = await this.embed(f, p, 'Insert Embedding', [asText(this.eval(f, p.ai?.input ?? '""'))]);
        this.storeResult(f, p, this.embeddingValue(f, p, vector));
        return undefined;
      }
      case 216: // Insert Embedding in Found Set
        await this.embedFoundSet(f, p);
        return undefined;
      // Steps that only affect a screen: the person's window does them; FileMaker Server skips them.
      case 30: { // View As: a view the layout allows, or Cycle to the next one it allows (form, list, table)
        if (!p.view) return undefined;
        const win = this.current;
        if (!win.layoutName || win.unloaded !== undefined) {
          this.actions.push({ step: s.name, script: f.script.name, view: p.view });
          return undefined;
        }
        const allowed = this.views(win);
        const was = this.viewOf(win);
        const order: LayoutView[] = ['form', 'list', 'table'];
        const to = p.view === 'cycle'
          ? [1, 2, 3].map((i) => order[(order.indexOf(was) + i) % 3]).find((v) => allowed.includes(v))
          : allowed.includes(p.view) ? p.view : undefined;
        if (!to) return undefined;
        win.view = to;
        this.actions.push({ step: s.name, script: f.script.name, view: to });
        if (to !== was) this.viewChanged = win;
        return undefined;
      }
      case 97: { // Set Zoom Level
        const zoom = p.zoomCalculation !== undefined ? asNumber(calc(p.zoomCalculation)) : p.zoom;
        if (zoom !== undefined && !(typeof zoom === 'number' && !Number.isFinite(zoom))) this.actions.push({ step: s.name, script: f.script.name, zoom, ...(p.lock ? { lock: true } : {}) });
        return undefined;
      }
      case 29: case 166: // Show/Hide Toolbars, Show/Hide Menubar; Lock: the person can't show or hide it themselves
        if (p.showHide) this.actions.push({ step: s.name, script: f.script.name, showHide: p.showHide, ...(p.lock ? { lock: true } : {}) });
        return undefined;
      case 169: case 93: // Close Popover, Beep
        this.actions.push({ step: s.name, script: f.script.name });
        return undefined;
      case 50: // Select All: the active field's whole value
        if (win.activeField) {
          win.selection = 'all';
          win.focusMoved = true;
        }
        return undefined;
      case 130: { // Set Selection: in the named field (the cursor goes there) or the active one
        if (p.field) this.goToField(win, p.field.tableOccurrence.name, p.field.field.name);
        if (!win.activeField) return undefined;
        const start = Math.max(1, Math.trunc(asNumber(p.selectionStart !== undefined ? calc(p.selectionStart) : num(1)) || 1));
        const end = p.selectionEnd !== undefined ? Math.trunc(asNumber(calc(p.selectionEnd)) || 0) : 0;
        // An end before the start puts the insertion point at the start.
        win.selection = [start - 1, end >= start ? end : start - 1];
        win.focusMoved = true;
        return undefined;
      }
      case 81: // Scroll Window: the person's window scrolls (nothing to scroll on the server)
        if (p.scroll) this.actions.push({ step: s.name, script: f.script.name, scroll: p.scroll });
        return undefined;
      case 119: { // Move/Resize Window: in a web browser, as in WebDirect, only a card (or other window drawn over another) moves
        const name = p.calculation !== undefined ? asText(calc(p.calculation)) : undefined;
        const lower = name?.toLowerCase();
        // By name first, then by Get ( WindowUUID ); not case sensitive (Claris).
        const target = lower === undefined ? win
          : this.windows.find((w) => w.name.toLowerCase() === lower) ?? this.windows.find((w) => (w.uuid ?? w.id)?.toLowerCase() === lower);
        if (!target) throw new ScriptError(ERROR.windowMissing, `Window "${name}" is missing`);
        const geometry = { ...target.geometry };
        for (const k of ['height', 'width', 'top', 'left'] as const) {
          const formula = p.bounds?.[k];
          if (formula === undefined || formula.trim() === '') continue; // no value: the window keeps its own
          const n = asNumber(calc(formula));
          if (!Number.isFinite(n) || Math.abs(n) >= 100_000) continue;
          // The smallest a window can be; the client keeps it inside the browser window, as WebDirect does.
          geometry[k] = k === 'height' || k === 'width' ? Math.max(MIN_WINDOW_SIZE, Math.round(n)) : Math.round(n);
        }
        if ((target.style ?? 'document') === 'document') return undefined;
        const resized = geometry.height !== target.geometry?.height || geometry.width !== target.geometry?.width;
        target.geometry = geometry;
        // Its layout's OnLayoutSizeChange, after the step, in that window (not when only top or left changed).
        if (resized) {
          if (target === win) this.sizeChanged = target;
          else if (!this.sizeChangedElsewhere.includes(target)) this.sizeChangedElsewhere.push(target);
        }
        return undefined;
      }
      case 31: { // Adjust Window: in WebDirect only Resize to Fit works, and only on a card (Claris): it takes the layout's own size
        const g = win.geometry;
        if (p.adjust === 'resize to fit' && win.style === 'card' && g && (g.height !== undefined || g.width !== undefined)) {
          delete g.height;
          delete g.width;
          this.sizeChanged = win;
        }
        return undefined;
      }
      // Window chrome the server has no screen for: the state is kept, so a script's Get ( ... ) reads back what it set.
      case 92: case 115: case 174: { // Show/Hide Text Ruler, Allow Formatting Bar, Enable Touch Keyboard: the active window
        const chrome = (win.chrome ??= {});
        if (s.stepId === 92) {
          if (p.showHide === 'toggle') chrome.textRuler = !chrome.textRuler;
          else if (p.showHide) chrome.textRuler = p.showHide === 'show';
        } else {
          const key = s.stepId === 115 ? 'formattingBar' : 'touchKeyboard';
          if (p.toggle) chrome[key] = !chrome[key];
          else if (p.on !== undefined) chrome[key] = p.on;
        }
        return undefined;
      }
      case 168: // Set Layout Object Animation: every window, for the script
        if (p.on !== undefined) this.animations = p.on;
        return undefined;
      case 120: case 42:
        return undefined;
      case 45: // Undo/Redo: the script's own uncommitted field edits in the current record
        this.undoRedo(win, p.undo ?? 'undo');
        return undefined;
      case 149: // Open Edit Saved Finds: the web client's Edit Saved Finds dialog
        this.actions.push({ step: s.name, script: f.script.name, open: 'saved-finds' });
        return undefined;
      case 32: case 105: case 109: case 113: case 114: case 118: case 129: case 172: case 183: case 209:
        return undefined;
    }
    return unsupported();
  }

  private nextBranch(f: Frame, b: Blocks, pc: number): number {
    let at = b.next.get(pc);
    while (at !== undefined) {
      const s = f.script.steps[at];
      if (s.stepId === 70 || s.stepId === 69) return at + 1; // End If, Else
      // Else If: test its condition here
      if (asBoolean(this.eval(f, s.params?.calculation ?? ''))) return at + 1;
      at = b.next.get(at);
    }
    return (b.end.get(pc) ?? pc) + 1;
  }

  /** Records the engine has added (New Record, Duplicate, through a portal, imports), for the runaway-loop guard. */
  private created = 0;

  /**
   * A script's own limits (set on the script, so a stuck one stops cleanly whoever runs it): the steps it and its
   * subscripts have run, and the time they have taken, not counting waits for a person.
   */
  private ownLimits(frame: Frame, b: Blocks, pc: number): void {
    // The innermost limited script carries the tightest limits of all that called it.
    const l = this.limitedFrames.at(-1)!.limits!;
    let by: Frame | undefined;
    let why: string | undefined;
    if (this.steps > l.steps) [by, why] = [l.stepsBy, `its limit of ${l.stepsBy.script.limits!.steps!.toLocaleString('en-US')} steps`];
    else if (this.busy() > l.busy) [by, why] = [l.busyBy, `its limit of ${l.busyBy.script.limits!.seconds!.toLocaleString('en-US')} seconds`];
    if (!by) return;
    this.actions.push({ step: 'Halt Script', script: frame.script.name, reason: `"${by.script.name}" reached ${why}${this.whereNow()}${this.inLoop(frame, b, pc)}` });
    throw new Halt();
  }

  /** Stops a loop that has gone round more than loopLimit times, or added more than loopRecordLimit records. */
  private loopGuard(f: Frame, b: Blocks, start: number): void {
    const run = f.loops?.get(start);
    if (!run) return;
    run.passes++;
    const added = this.created - run.created;
    // The script's own limit on times round, or the run's, whichever is lower.
    const own = f.script.limits?.loopPasses;
    const passLimit = own !== undefined && (this.opts.loopLimit === undefined || own < this.opts.loopLimit) ? own : this.opts.loopLimit;
    const recordLimit = this.opts.loopRecordLimit ?? LOOP_RECORD_LIMIT;
    let why: string | undefined;
    // A loop that moves through the found set (it has a Go to Record step) but never leaves the record it started on.
    if (run.at && !run.moved) {
      const now = this.recordAt(this.current);
      if (!now || now.window !== run.at.window || now.occurrence !== run.at.occurrence || now.index !== run.at.index) run.moved = true;
      else if (run.passes >= (this.opts.stuckLoopPasses ?? STUCK_LOOP_PASSES)) {
        const walk = this.walkStep(f.script, start, b.loop.get(start) ?? start);
        if (walk !== undefined) why = `went round ${run.passes.toLocaleString('en-US')} times without leaving its first record, though the Go to Record/Request/Page at line ${this.lineOf(f.script, walk)} should move it on (a Go to Record that goes by a number stays put when the number is 0, and Next stays on the last record unless it exits after last)`;
      }
    }
    if (!why && passLimit !== undefined && run.passes >= passLimit) why = `went round ${run.passes.toLocaleString('en-US')} times without ending`;
    else if (!why && added >= recordLimit) why = `added ${added.toLocaleString('en-US')} records without ending`;
    if (!why) return;
    this.actions.push({ step: 'Halt Script', script: f.script.name, reason: `runaway loop: the loop at line ${this.lineOf(f.script, start)} ${why}${this.whereNow()}${this.loopCause(f, b, start)}` });
    throw new Halt();
  }

  /** The first enabled Go to Record/Request/Page between a loop's Loop and End Loop steps, if any. */
  private walkStep(script: Script, start: number, end: number): number | undefined {
    for (let i = start + 1; i < end; i++) if (script.steps[i]?.stepId === 16 && script.steps[i].enabled) return i;
    return undefined;
  }

  /** For a stop inside a loop: which loop, how many times round, and why it may never end. */
  private inLoop(f: Frame, b: Blocks, pc: number): string {
    const end = b.enclosingEnd.get(pc);
    const start = end === undefined ? (f.script.steps[pc]?.stepId === 71 ? pc : undefined) : b.loop.get(end);
    if (start === undefined) return '';
    const run = f.loops?.get(start);
    const passes = run ? `, ${run.passes.toLocaleString('en-US')} times round` : '';
    return ` in the loop at line ${this.lineOf(f.script, start)}${passes}${run ? this.pace(run) : ''}${this.loopCause(f, b, start)}`;
  }

  /** The window's layout occurrence and record, when it is on one in browse mode. */
  private recordAt(win: Window | undefined): { window: Window; occurrence: string; index: number } | undefined {
    if (!win?.layout || win.mode === 'find') return undefined;
    try {
      return { window: win, occurrence: this.layoutOf(win).occurrence, index: this.foundSet(win).index };
    } catch (e) {
      rethrowExecutionRefusal(e);
      return undefined;
    }
  }

  /**
   * A loop stopped by a limit while still moving through its found set: how many steps a record took, and how many the
   * records left would need. So a long batch that would finish reads differently from a loop going nowhere.
   */
  private pace(run: { passes: number; steps: number; at?: { window: Window; occurrence: string; index: number } }): string {
    const now = this.recordAt(this.current);
    if (!run.at || !now || now.window !== run.at.window || now.occurrence !== run.at.occurrence || run.passes < 2) return '';
    const moved = now.index - run.at.index;
    const total = this.foundSet(now.window).ids.length;
    if (moved < 1 || moved > run.passes) return '';
    const perRecord = (this.steps - run.steps) / moved;
    const left = total - now.index - 1;
    const n = (x: number) => Math.round(x).toLocaleString('en-US');
    return left > 0
      ? `; still moving through the records, about ${n(perRecord)} steps each, so the ${n(left)} left need about ${n(left * perRecord)} more steps: a long batch, not a loop going nowhere`
      : `; on the last record after moving through ${n(moved + 1)}, about ${n(perRecord)} steps each`;
  }

  /**
   * What the linter says about this loop, with the one value that proves it:
   * a count of 0 or empty. Names only otherwise, never values.
   */
  private loopCause(f: Frame, b: Blocks, start: number): string {
    const end = b.loop.get(start) ?? start;
    let issues;
    try {
      issues = lintScript(f.script);
    } catch {
      return '';
    }
    const issue = issues.find((i) => i.rule !== 'isvalid-related' && i.step >= start && i.step <= end);
    if (!issue) return '';
    let now = '';
    const count = issue.rule === 'count-equality' ? /^(\$\$?\S+) comes from/.exec(issue.message)?.[1] : undefined;
    if (count) {
      try {
        const v = asText(this.eval(f, count));
        if (v === '' || v === '0') now = ` Here ${count} is ${v === '' ? 'empty' : '0'}.`;
      } catch (e) {
        rethrowExecutionRefusal(e);
        // a name that doesn't evaluate here: say nothing about its value
      }
    }
    return `. Why: ${issue.message}${now}`;
  }

  /** A step's first line in the script text, from 1. */
  private lineOf(script: Script, step: number): number {
    let line = 1;
    for (let i = 0; i < step && i < script.steps.length; i++) line += scriptText([script.steps[i]]).split('\n').length;
    return line;
  }

  private exitLoop(b: Blocks, pc: number): number | undefined {
    const end = b.enclosingEnd.get(pc);
    return end === undefined ? undefined : end + 1;
  }

  /** The hosted file an external data source points at (the frame's own file when there is none). */
  /** The script a Perform Script step picks from the list (Specified: From list). */
  private listedScript(f: Frame, p: StepParams): { store: Store; script: Script } {
    if (!p.script) throw new ScriptError(ERROR.scriptMissing, 'Perform Script names no script');
    const store = this.otherFile(f, p.script.file);
    const script = store.schema.scripts.find((s) => s.id === p.script!.id);
    if (!script) throw new ScriptError(ERROR.scriptMissing, `Script "${p.script.name}" is missing`);
    return { store, script };
  }

  /**
   * Specified: By name: the calculation's result names the script, "File::Script" for another file (FileMaker's
   * form; "::Script", with no file, is this one). Matched as FileMaker does, ignoring case.
   */
  private scriptByName(f: Frame, calculation: string): { store: Store; script: Script } {
    const full = asText(this.eval(f, calculation)).trim();
    const at = full.lastIndexOf('::');
    const fileName = at < 0 ? '' : full.slice(0, at).trim();
    const name = at < 0 ? full : full.slice(at + 2).trim();
    let store = f.store;
    if (fileName && fileName.toLowerCase() !== f.store.name.toLowerCase()) {
      // A calculated name must use the same declared file graph as a listed script.
      // Accept the source alias or its hosted file name, never an arbitrary hosted file.
      const key = fileName.toLowerCase();
      const source = f.store.schema.dataSources.find((d) => d.name.toLowerCase() === key)
        ?? f.store.schema.dataSources.find((d) => dataSourceFile(d.paths)?.toLowerCase() === key);
      const file = source && dataSourceFile(source.paths);
      const other = file ? f.store.resolveFile(file) : undefined;
      if (!other) throw new ScriptError(ERROR.missingFile, `File "${fileName}" is not hosted`);
      store = other;
    }
    this.opts.beforeFile?.(store);
    const scripts = store.schema.scripts.filter((s) => s.name);
    const script = scripts.find((s) => s.name === name) ?? scripts.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!script) throw new ScriptError(ERROR.scriptMissing, name ? `Script "${name}" is missing` : 'Perform Script\'s calculation gives no script name');
    return { store, script };
  }

  private otherFile(f: Frame, ref: Ref | undefined): Store {
    if (!ref) return f.store;
    const source = f.store.schema.dataSources.find((d) => d.id === ref.id);
    const file = source ? dataSourceFile(source.paths) : undefined;
    const other = file ? f.store.resolveFile(file) : undefined;
    if (!other) throw new ScriptError(ERROR.missingFile, `File "${file ?? ref.name}" is not hosted`);
    this.opts.beforeFile?.(other);
    return other;
  }

  /** Stop waiting for a server session without canceling that independent session. */
  private async serverAnswer<T>(running: Promise<T>, script: string): Promise<T> {
    const scope = cancellationScope([this.stopSignal, this.userCancellation.signal]);
    try {
      const result = await untilCanceled(running, scope.signal);
      this.canceled(script);
      return result;
    } catch (e) {
      this.canceled(script);
      throw e;
    } finally { scope.dispose(); }
  }

  private async performScript(f: Frame, p: StepParams, onServer: boolean): Promise<void> {
    const { store, script } = p.script || p.scriptCalculation === undefined ? this.listedScript(f, p) : this.scriptByName(f, p.scriptCalculation);
    // Full access in the caller's file never grants entry to another file's script.
    (store === f.store ? this.privileges : this.opts.privileges)?.in(store).checkScript(script.name);
    const parameter = p.parameter !== undefined ? this.eval(f, p.parameter) : text('');
    if (onServer) {
      const executionAccount = this.opts.executionAccount ?? this.opts.privileges?.account;
      if (executionAccount !== undefined) this.enforceExecution(store, () => store.requireActiveAccount(executionAccount));
      // A new session on the server, as the same account: none of the caller's
      // window, found set, record, globals or variables, and records the caller
      // has open are locked to it. Nothing it does reaches the caller's screen.
      const sub = new ScriptEngine({
        ...this.opts, executionAccount, session: undefined, layout: undefined, foundSet: undefined, recordId: undefined, mode: undefined, preview: undefined,
        trigger: undefined, parameter: asText(parameter).slice(0, SERVER_TEXT_LIMIT), debug: undefined, insertFile: undefined, pause: undefined, dialog: undefined,
        // Scripts it calls on the server run at once, so waiting on each other can't fill the queue.
        serverQueue: undefined,
        onAccessDenial: p.wait === false && !p.callback ? undefined : this.opts.onAccessDenial,
        // Its own run: canceling the caller doesn't stop it (as on FileMaker Server); the queue may.
        stop: undefined,
        // The caller's files still count: a file kept from AI (or a capture-only) can't reach a model, or
        // send mail, by handing its data to a script on the server.
        callerFiles: this.callStackFiles(f),
      });
      // What it tries to reach counts toward this run's (and a blocked host's limit stops both).
      sub.tally = this.tally;
      sub.sourceFiles = this.sourceFiles;
      sub.executionStore = this.executionStore;
      sub.identityStore = this.identityStore;
      sub.identityVia = this.identityVia;
      sub.initiatingPrivileges = this.initiatingPrivileges;
      sub.outboundIdentity = this.outboundIdentity;
      sub.localIdentities = this.localIdentities;
      const owner = `server-script:${randomUUID()}`;
      const go = (stop?: AbortSignal) => {
        if (executionAccount !== undefined) this.enforceExecution(store, () => store.requireActiveAccount(executionAccount));
        if (stop) sub.stopOn(stop);
        return writer.run({ ...writer.getStore(), owner, globals: sub.globals, transaction: {} }, () => sub.run(store, script));
      };
      const running = this.opts.serverQueue ? this.opts.serverQueue.run(go, { file: store.name, script: script.name, account: this.opts.account }) : go();
      if (p.callback) {
        // The callback is a script of the caller's file, run here (as on the person's client) afterwards.
        const cb = f.store.schema.scripts.find((x) => x.id === p.callback!.script.id);
        if (!cb) {
          running.catch(() => {});
          throw new ScriptError(ERROR.scriptMissing, `Callback script "${p.callback.script.name}" is missing`);
        }
        // Its parameter is worked out when the callback runs, not now (Claris: "evaluated when the callback script is performed").
        this.callbacks.push({ running, store: f.store, script: cb, ...(p.callback.parameter !== undefined ? { parameter: p.callback.parameter } : {}) });
        this.lastResult = text('');
        return;
      }
      if (p.wait === false) {
        // The caller carries on; the server script runs on its own.
        running.catch(() => {});
        this.lastResult = text('');
        return;
      }
      let r: RunResult;
      try {
        r = await this.serverAnswer(running, f.script.name);
      } catch (e) {
        rethrowExecutionRefusal(e);
        // Canceled from the admin console before it started: "user canceled action".
        const code = (e as { code?: unknown }).code;
        if (typeof code === 'number') {
          const converted = new ScriptError(code, (e as Error).message);
          retainDenial(converted, denialOf(e));
          throw converted;
        }
        throw e;
      }
      this.lastResult = text(r.result.slice(0, SERVER_TEXT_LIMIT));
      if (r.error) {
        const converted = new ScriptError(r.error, `Script "${script.name}" ended with error ${r.error}`);
        retainDenial(converted, scriptDenial(r));
        throw converted;
      }
      return;
    }
    const caller = this.current;
    let win = caller;
    if (store !== f.store) {
      // A script in another file runs in that file's window.
      win = this.windows.find((w) => w.store === store) ?? await this.openFile(f, store);
      this.current = win;
    }
    const saved = this.lastError;
    this.lastError = saved;
    const result = await this.perform(store, script, parameter, win);
    this.lastResult = result;
    if (store !== f.store) this.current = caller;
    f.window = this.current;
  }

  // --- variables and calculations ---------------------------------------------

  private setVariable(f: Frame, name: string, rep: number, value: Value, scriptLiteral = false): void {
    if (this.diagnostics.sensitiveName(name)) this.diagnostics.remember(asText(value, this.current.store.dateOrder));
    if (this.opts.debug) this.varNames.set(name.toLowerCase(), name);
    const scope = name.startsWith('$$') ? this.session.variables : f.locals;
    const arr = scope.get(name.toLowerCase()) ?? [];
    arr[rep - 1] = scope === this.session.variables ? kept(value) : value;
    scope.set(name.toLowerCase(), arr);
    if (scriptLiteral) {
      const literals = this.diagnosticLiterals.get(arr) ?? new Map<number, Value>();
      literals.set(rep - 1, arr[rep - 1]);
      this.diagnosticLiterals.set(arr, literals);
    } else this.diagnosticLiterals.get(arr)?.delete(rep - 1);
  }

  private getVariable(f: Frame, name: string, rep: number): Value | undefined {
    const scope = name.startsWith('$$') ? this.session.variables : f.locals;
    return scope.get(name.toLowerCase())?.[rep - 1];
  }

  /** Evaluates a formula in the current window's context; an error gives "?" and sets the step's error. */
  private eval(f: Frame, formula: string): Value {
    if (this.opts.beforeFile) return writer.run({ ...writer.getStore(), beforeFile: this.opts.beforeFile }, () => this.evalChecked(f, formula));
    return this.evalChecked(f, formula);
  }

  private evalChecked(f: Frame, formula: string): Value {
    try {
      const value = evaluate(resolveExternal(this.current.store, formula), this.calcContext(f));
      if (this.diagnostics.sensitiveExpression(formula)) this.diagnostics.remember(asText(value, this.current.store.dateOrder));
      return value;
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof CalcNestingError) throw e;
      if (!(e instanceof CalcError)) throw e;
      if (!this.calcError) { this.calcError = e.code; this.calcMessage = e.message; }
      return text('?');
    }
  }

  private names(store: Store, info: LayoutInfo | undefined): NameTable {
    if (info && info.owner !== store) this.opts.beforeFile?.(info.owner);
    const key = `${store.name}\u0000${info?.owner.name ?? ''}\u0000${info?.table ?? ''}`;
    let t = this.namesCache.get(key);
    if (!t) {
      const occurrences: [string, string[]][] = [];
      for (const to of store.schema.tableOccurrences) {
        try {
          occurrences.push([to.name, this.tableFields(store.occurrence(to.name)).map((x) => x.name)]);
        } catch (e) {
          rethrowExecutionRefusal(e);
          occurrences.push([to.name, []]); // a file that is not hosted
        }
      }
      const fields = info ? this.tableFields(info).map((x) => x.name) : [];
      t = new NameTable({ fields, occurrences });
      this.namesCache.set(key, t);
    }
    return t;
  }

  /** Schema fields of the table behind a layout or occurrence, summary fields included. */
  private tableFields(info: LayoutInfo): Field[] {
    this.opts.beforeFile?.(info.owner);
    return info.owner.schema.tables.find((t) => t.name === info.table)?.fields ?? [];
  }

  /** The last calculation context: a loop evaluates many formulas in the same frame, window and layout. */
  private lastContext?: { f: Frame; win: Window; info: LayoutInfo | undefined; ctx: CalcContext };

  private calcContext(f: Frame): CalcContext {
    const win = this.current;
    this.opts.beforeFile?.(win.store);
    const info = win.layout;
    if (info && info.owner !== win.store) this.opts.beforeFile?.(info.owner);
    const last = this.lastContext;
    // A new object each time, as plug-in functions keep their state (BE_GetLastError, stacks) per context object;
    // only the parts (closures and the name table) are reused.
    if (last && last.f === f && last.win === win && last.info === info) return { ...last.ctx, dateOrder: win.store.dateOrder };
    const ctx = this.newCalcContext(f, win, info);
    this.lastContext = { f, win, info, ctx };
    return { ...ctx, dateOrder: win.store.dateOrder };
  }

  private newCalcContext(f: Frame, win: Window, info: LayoutInfo | undefined): CalcContext {
    return {
      notice: (message) => { if (!this.warnings.includes(message)) this.warnings.push(message); },
      names: this.names(win.store, info),
      occurrence: info?.occurrence,
      dateOrder: win.store.dateOrder,
      field: (ref) => {
        this.poll(f);
        const value = this.readField(win, ref);
        if (value !== undefined && this.diagnostics.sensitiveName(ref.field)) this.diagnostics.remember(asText(value, win.store.dateOrder));
        return value;
      },
      related: (ref) => (this.poll(f), this.readRelated(win, ref)),
      summary: (ref, brk) => this.getSummary(win, ref, brk),
      executeSQL: (query, args) => {
        this.opts.onExecuteSQL?.(query);
        const rows = win.store.calc.executeSQL(query, args, this.privileges);
        // SQL row reads bypass field(), so learn each returned cell before the
        // enclosing formula can trim or copy it into a diagnostic variable.
        if (sqlMayReadSecret(query)) for (const row of rows) for (const cell of row) {
          this.diagnostics.rememberSql(asText(cell, win.store.dateOrder));
        }
        return rows;
      },
      persistentData: (name, instance) => win.store.persistentData(name, instance),
      persistentDataIds: (name) => win.store.persistentDataIds(name),
      pluginSession: this.session,
      mbsCall: (name, args) => dynapdfCall(name, args, this.session, this.opts.documents, (path, bytes) => this.pluginFiles.write(path, bytes, false)),
      curlScope: this,
      ...(!this.opts.outbound && this.opts.network ? { curlFetch: (request: MbsCurlRequest) => this.curlFetch(f, request) } : {}),
      pluginAccount: this.pluginAccount,
      location: () => this.where,
      repetitions: (ref) => this.schemaField(win, ref.occurrence, ref.field)?.options?.repetitions ?? 1,
      lookupNext: (ref, direction) => this.lookupNext(win, ref, direction),
      get: (name) => this.get(f, name),
      variable: (name, rep) => (this.poll(f), this.getVariable(f, name, rep)),
      setVariable: (name, rep, value) => this.setVariable(f, name, rep, value),
      customFunction: (name) => {
        this.poll(f);
        return customFunctionDef(win.store.schema.customFunctions.find((c) => c.name.toLowerCase() === name.toLowerCase()));
      },
      plugin: (name) => win.store.plugin(name),
      installedPlugins: () => win.store.installedPlugins(),
      builtinOff: (name) => win.store.builtinOff(name),
      design: (name, args) => this.design(win, name, args),
      ragSpaceInfo: (account, spaceId) => this.ragSpaceInfo(f, account, spaceId),
      embedding: (account, model, input) => {
        const v = this.embeddings.get(embeddingKey(account, model, input));
        if (v) return embeddingFile(v);
        if (!this.embeddingAsks) throw new NeedEmbedding([{ account, model, input }]);
        this.embeddingAsks.push({ account, model, input });
        return embeddingFile([0]);
      },
      now: this.opts.now,
      files: this.pluginFiles,
      ...(this.opts.outbound ? { outbound: this.pluginOutbound(f, this.opts.outbound) } : {}),
      ...(this.mayFetch(f) ? { network: this.pluginNetwork(f) } : {}),
      ...(this.mayMail(f) ? { mailer: this.pluginMailer(f) } : {}),
      ...(this.mayMailBuiltin(f) ? { builtinMailer: this.pluginMailer(f, true) } : {}),
    };
  }

  /**
   * Stops the script when one step runs past the time limit: a calculation
   * looping over many records or recursing in custom functions.
   */
  /** Yield between batches so a socket/admin cancellation can actually reach record loops. */
  private checkpoints = 0;
  private async checkpoint(f: Frame): Promise<void> {
    this.canceled(f.script.name);
    if ((this.checkpoints++ & 255) === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    this.canceled(f.script.name);
    this.poll(f);
  }

  private poll(f: Frame): void {
    const transaction = writer.getStore()?.transaction?.open;
    if (transaction) renewTransactionLocks(transaction);
    if (++this.polls & 1023) return;
    this.canceled(f.script.name);
    this.late(f);
    this.overMemory(f.script.name);
  }

  /**
   * Where a stopped script was, so a long batch run (on record 9,950 of 12,000)
   * can be told from a loop going nowhere (on record 1 of 1). Names only, no values.
   */
  private whereNow(): string {
    const win = this.current;
    if (!win?.layout) return '';
    if (win.mode === 'find') return ` (in find mode on layout "${win.layoutName}")`;
    let fs;
    try {
      fs = this.foundSet(win);
    } catch (e) {
      rethrowExecutionRefusal(e);
      return ''; // a layout on a file that isn't here
    }
    const n = fs.ids.length;
    return ` (on record ${n ? (fs.index + 1).toLocaleString('en-US') : 0} of ${n.toLocaleString('en-US')} on layout "${win.layoutName}")`;
  }

  /** Stops the script when the heap has passed the memory limit. */
  private overMemory(script: string): void {
    const limit = this.opts.memoryLimit;
    if (limit === undefined || getHeapStatistics().used_heap_size <= limit) return;
    this.actions.push({ step: 'Halt Script', script, reason: `stopped: memory limit reached (${Math.round(limit / 1048576)} MB)` });
    throw new Halt();
  }

  /** Stops the script when the time limit has passed (checked every time: for loops whose turns are slow). */
  private late(f: Frame): void {
    this.canceled(f.script.name);
    if (Date.now() <= this.deadline) return;
    this.actions.push({ step: 'Halt Script', script: f.script.name, reason: 'time limit reached during a step' });
    throw new Halt();
  }

  /** The page being printed or saved as PDF (1-based), 0 when not printing. */
  private printPage = 0;
  /** Get ( PageCount ) while a job prints. */
  private printPageCount = 0;

  private get(f: Frame, name: string): Value | undefined {
    // Script state needs neither the window's found set nor its owning file.
    switch (name.toLowerCase()) {
      case 'scriptparameter': return f.parameter;
      case 'scriptresult': return this.lastResult;
      case 'lasterror': return num(this.lastError);
      case 'lasterrordetail': return text(this.lastErrorDetail);
    }
    const win = this.current;
    const fs = win.layout && win.mode === 'browse' ? this.foundSet(win) : undefined;
    switch (name.toLowerCase()) {
      // The page being printed or saved as PDF; 0 otherwise, as in Browse mode.
      case 'pagenumber': return num(this.printPage);
      // The pages of the print job running (worked out by laying the job out once first); empty otherwise, as Claris says.
      case 'pagecount': return this.printPageCount ? num(this.printPageCount) : text('');
      case 'scriptname': return text(f.script.name);
      case 'triggercurrentpanel': return text(this.opts.trigger?.currentPanel ?? '');
      case 'triggertargetpanel': return text(this.opts.trigger?.targetPanel ?? '');
      case 'triggerkeystroke': return text(this.opts.trigger?.keystroke ?? '');
      case 'triggermodifierkeys': return num(this.opts.trigger?.modifierKeys ?? 0);
      // The server's folders, as paths the file steps understand (see filePath).
      case 'documentspath': return text(DOCUMENTS);
      case 'temporarypath': return text(TEMPORARY);
      case 'opendatafileinfo': return text([...this.dataFiles].map(([id, d]) => `${id} ${d.shown}`).join('\r'));
      case 'transactionopenstate': return num(this.tx ? 1 : 0);
      case 'reverttransactiononerrorstate': return num(this.revertOnError ? 1 : 0);
      // 0 closed, 1 new and not committed, 2 changed and not committed.
      case 'recordopenstate': return num(win.uncommittedNew ? 1 : win.pending.size ? 2 : 0);
      case 'lastmessagechoice': return num(this.lastMessageChoice);
      case 'foundcount': return num(win.mode === 'find' ? 0 : fs?.ids.length ?? 0);
      // A script's record is the one the window is on, so the active record's number is the same.
      case 'recordnumber': case 'activerecordnumber': return num(win.mode === 'find' ? win.requestIndex + 1 : fs?.ids.length ? fs.index + 1 : 0);
      case 'requestcount': return num(win.requests.length);
      case 'portalrownumber': return num(win.portal?.row ?? 0);
      case 'activelayoutobjectname': return text(win.activeObjectId !== undefined ? this.layoutObject(win, win.activeObjectId)?.object.name ?? '' : win.activeField ? win.activeField.name ?? '' : win.portal ? this.portals(win).find((x) => x.occurrence === win.portal!.occurrence)?.name ?? '' : '');
      case 'activefieldname': return text(win.activeField?.field ?? '');
      case 'activefieldtablename': return text(win.activeField?.occurrence ?? '');
      case 'activefieldcontents': {
        const a = win.activeField;
        return a ? this.readField(win, { occurrence: a.occurrence, field: a.field, repetition: a.repetition }) ?? text('') : text('');
      }
      case 'activerepetitionnumber': return num(win.activeField?.repetition ?? 0);
      case 'layoutviewstate': return num(win.layoutName && win.unloaded === undefined ? ['form', 'list', 'table'].indexOf(this.viewOf(win)) : 0);
      // What Set Selection selected (FileMaker counts from 1); a person's own selection isn't known here.
      case 'activeselectionstart': return num(win.activeField && Array.isArray(win.selection) ? win.selection[0] + 1 : 0);
      case 'activeselectionsize': return num(win.activeField && Array.isArray(win.selection) ? win.selection[1] - win.selection[0] : 0);
      case 'activeportalrownumber': return num(win.activeField?.portal && win.portal ? win.portal.row : 0);
      case 'recordid': return fs?.ids.length ? num(fs.ids[fs.index]) : text('');
      case 'totalrecordcount': return win.layout ? num(win.layout.owner.findIds(win.layout, this.reading).length) : num(0);
      case 'layoutname': return text(win.layoutName ?? '');
      case 'layouttablename': return text(win.layout?.occurrence ?? '');
      case 'layoutnumber': {
        const i = win.store.schema.layouts.findIndex((l) => l.name === win.layoutName);
        return num(i + 1);
      }
      case 'layoutcount': return num(win.store.schema.layouts.length);
      case 'windowmode': return num(win.mode === 'find' ? 1 : win.preview ? 2 : 0);
      case 'windowname': return text(win.name);
      case 'filename': return text(win.store.name);
      case 'accountname': case 'username': return text(this.opts.account ?? '');
      case 'currentprivilegesetname':
        if (this.privileges) return text(this.privileges.in(win.store).name);
      // falls through: otherwise the account's own set
      case 'accountprivilegesetname': {
        if (this.opts.privileges) return text(this.opts.privileges.in(win.store).name);
        const name = this.opts.account === undefined ? undefined : win.store.accountPrivilegeSet(this.opts.account);
        return name === undefined ? undefined : text(name);
      }
      case 'sortstate': return num(fs?.sort ? (fs.semi ? 2 : 1) : 0);
      case 'applicationversion': return text('tabularius Server 0.1');
      case 'windowheight': case 'windowwidth': case 'windowtop': case 'windowleft': {
        // A card's size and place, when New Window or Move/Resize Window gave them; else the person's browser window.
        const k = name.toLowerCase().slice(6) as 'height' | 'width' | 'top' | 'left';
        const given = (win.style ?? 'document') !== 'document' ? win.geometry?.[k] : undefined;
        if (given !== undefined) return num(given);
        return k === 'height' || k === 'width' ? clientWindowGet(this.opts.window, name.toLowerCase()) : undefined;
      }
      case 'device': case 'systemplatform': case 'windowcontentwidth': case 'windowcontentheight':
      case 'windowdesktopwidth': case 'windowdesktopheight': case 'screenwidth': case 'screenheight': case 'screenscalefactor': case 'windoworientation':
        return clientWindowGet(this.opts.window, name.toLowerCase());
      case 'errorcapturestate': return num(this.errorCapture ? 1 : 0);
      case 'allowabortstate': return num(this.allowAbort ? 1 : 0);
      case 'textrulervisible': return num(win.chrome?.textRuler ? 1 : 0);
      case 'allowformattingbarstate': return num(win.chrome?.formattingBar ? 1 : 0);
      case 'touchkeyboardstate': return num(win.chrome?.touchKeyboard ? 1 : 0);
      case 'scriptanimationstate': return num(this.animations ? 1 : 0);
      case 'usesystemformatsstate': return num(this.useSystemFormats ? 1 : 0);
      case 'lasterrorlocation': return text(this.lastErrorLocation);
      case 'sessionidentifier': return text(this.sessionIdentifier);
      case 'quickfindtext': return text(win.quickFindText ?? '');
      case 'requestomitstate': return num(win.mode === 'find' && win.requests[win.requestIndex]?.omit ? 1 : 0);
      // Fields set since the record was last committed, one per line.
      case 'modifiedfields': return text([...new Set([...win.pending.keys()].map((k) => k.replace(/\(\d+\)$/, '')))].join('\r'));
      case 'recordopencount': return num(win.pending.size || win.uncommittedNew ? 1 : 0);
      case 'custommenusetname': {
        const s = win.store.schema;
        return text(this.menuSetName ?? s.customMenuSets.find((m) => m.id === s.defaultMenuSetId)?.name ?? '[Standard FileMaker Menus]');
      }
      case 'filelocaleelements': return text(localeElements(f.store.dateOrder, true));
      case 'systemlocaleelements': return text(localeElements(f.store.dateOrder, false));
      case 'windowuuid': return text(win.uuid ??= randomUUID().toUpperCase());
      case 'windowstyle': return num(({ document: 0, floating: 1, dialog: 2, card: 3 } as const)[win.style ?? 'document']);
      case 'accounttype': {
        const name = this.opts.account;
        if (name === undefined) return text('');
        if (/^\[guest\]$/i.test(name)) return text('Guest');
        const a = win.store.accounts().find((x) => x.name.toLowerCase() === name.toLowerCase());
        return text(a?.external ? 'External' : 'FileMaker File');
      }
      // An external account named for a group (not a person's email or a whole domain) is the group the person
      // signed in through (inferred from how sign-in matches them; FileMaker gives the directory's group name).
      case 'accountgroupname': {
        const name = this.opts.account;
        if (name === undefined || name.includes('@')) return text('');
        const a = win.store.accounts().find((x) => x.name.toLowerCase() === name.toLowerCase());
        return text(a?.external ? a.name : '');
      }
      case 'accountpassworddaysremaining': return num(this.opts.account === undefined ? -1 : win.store.passwordDaysRemaining(this.opts.account));
      case 'accountextendedprivileges': case 'currentextendedprivileges': {
        const p = this.opts.privileges?.in(win.store);
        if (!p) return undefined;
        // With "Grant full access privileges" the script's current set is [Full Access].
        const set = name.toLowerCase() === 'currentextendedprivileges' ? this.privileges?.in(win.store).set ?? p.set : p.set;
        return text((set?.extendedPrivileges ?? []).join('\r'));
      }
      case 'layoutaccess': {
        if (!win.layoutName) return num(0);
        const level = this.privileges?.in(win.store).layout(win.layoutName).records ?? 'modifiable';
        return num(level === 'modifiable' ? 2 : level === 'viewOnly' ? 1 : 0);
      }
      case 'recordaccess': {
        const id = this.currentId(win);
        if (id === undefined || !win.layout) return num(0);
        const pv = this.privileges?.in(win.layout.owner);
        try {
          this.via(win.layout).checkEditable(win.layout, id, this.privileges);
          return num(2);
        } catch (e) {
          rethrowExecutionRefusal(e);
          return num(win.layout.owner.canViewRecord(win.layout.table, id, pv) ? 1 : 0);
        }
      }
      case 'filepath': return text(`fmnet:/${hostname()}/${win.store.name}.fmp12`);
      case 'documentspathlisting': {
        // Every file and folder in the documents folder, as paths file steps take (folders end in "/").
        const dir = this.opts.documents;
        if (!dir || !existsSync(dir)) return text('');
        const out: string[] = [];
        const walk = (at: string, rel: string) => {
          for (const e of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (e.name.startsWith('.') || out.length >= 10_000) continue;
            out.push(DOCUMENTS + rel + e.name + (e.isDirectory() ? '/' : ''));
            if (e.isDirectory()) walk(join(at, e.name), `${rel}${e.name}/`);
          }
        };
        walk(dir, '');
        return text(out.join('\r'));
      }
      case 'systemstorageavailable': {
        try {
          const st = statfsSync(this.opts.documents ?? tmpdir());
          return num(st.bavail * st.bsize);
        } catch {
          return num(0);
        }
      }
      case 'filesize': {
        try {
          return num(statSync(win.store.path).size);
        } catch {
          return num(0);
        }
      }
      case 'recordmodificationcount': {
        const id = this.currentId(win);
        return id === undefined || !win.layout ? num(0) : num(this.via(win.layout).get(win.layout, id, 'iso', undefined, this.privileges, { fields: [] }).modId);
      }
    }
    return undefined;
  }

  private design(win: Window, name: string, args: Value[]): Value | undefined {
    const arg = (i: number) => asText(args[i] ?? text(''));
    // fileName: the window's file, or another file a window has open ("" is the current one). Other hosted files
    // aren't open in this run, so their design isn't read (FileMaker answers only for open files).
    const store = this.designFile(win, NO_FILE_ARGUMENT.has(name.toLowerCase()) ? '' : arg(0));
    if (!store) return undefined;
    const list = (xs: (string | number)[]) => text(xs.join('\r'));
    switch (name.toLowerCase()) {
      case 'gettableddl': return text(tableDDL(store.schema, arg(0), !!args[1] && asBoolean(args[1]), schemaVisibility(this.privileges?.in(store))));
      case 'getfieldsonlayout': {
        // "" is the window's current layout.
        const name = arg(0) || win.layout?.name || '';
        return text(win.store.calc.fieldsOnLayout(name, this.privileges) ?? '');
      }
      case 'getrecordidsfromfoundset': {
        // 0 a return-separated list, 1 a JSON array of strings, 2 a JSON array of numbers.
        const ids = win.mode === 'find' ? [] : [...this.foundSet(win).ids];
        const type = Math.trunc(asNumber(args[0] ?? num(0)));
        return text(type === 1 ? JSON.stringify(ids.map(String)) : type === 2 ? JSON.stringify(ids) : ids.join('\r'));
      }
      case 'valuelistitems': {
        const vl = store.schema.valueLists.find((v) => v.name === arg(1));
        if (!vl) return list([]);
        // A list of related values is the current record's.
        const id = store === win.store ? this.currentId(win) : undefined;
        return list(store.valueListItems(vl.id, win.layout && id !== undefined ? { info: win.layout, recordId: id } : undefined, this.privileges).map((i) => i.value));
      }
      case 'databasenames': return list(this.windows.map((w) => w.store.name).filter((x, i, a) => a.indexOf(x) === i));
      case 'windownames': return list(this.windows.map((w) => w.name));
    }
    const own = store === win.store && win.layout && win.layout.owner === store;
    return designFunction(store, name, args, {
      privileges: this.privileges,
      table: own ? store.schema.tables.find((t) => t.name === win.layout!.table) : undefined,
      occurrence: store === win.store ? win.layout?.occurrence : undefined,
    });
  }

  /** The open file a design function names: "" or the window's own file, or one another window has open. */
  private designFile(win: Window, fileName: string): Store | undefined {
    if (!fileName || fileName.toLowerCase() === win.store.name.toLowerCase()) return win.store;
    return this.windows.find((w) => w.store.name.toLowerCase() === fileName.toLowerCase())?.store;
  }

  // --- reading fields -------------------------------------------------------

  private schemaField(win: Window, occurrence: string | undefined, field: string): Field | undefined {
    const info = this.infoFor(win, occurrence);
    return info && this.tableFields(info).find((x) => x.name.toLowerCase() === field.toLowerCase());
  }

  /** The layout or occurrence a field reference reads through. */
  private infoFor(win: Window, occurrence: string | undefined): LayoutInfo | undefined {
    if (!occurrence || occurrence.toLowerCase() === win.layout?.occurrence.toLowerCase()) {
      if (win.layout) this.opts.beforeFile?.(win.layout.owner);
      return win.layout;
    }
    try {
      return win.store.occurrence(occurrence);
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof ScriptError) throw e;
      return undefined;
    }
  }

  /**
   * A record's field data: only `field` when given, so reading one field
   * doesn't compute the record's other unstored calculations. The engine
   * computes summary fields itself (summaryOver), so the store doesn't.
   */
  private record(info: LayoutInfo, id: number, field?: string, cache = true): FieldData {
    this.opts.beforeFile?.(info.owner);
    const privileges = this.privileges;
    const win = this.current;
    const edited = win.mode === 'browse' && win.pending.size > 0 && info.owner === win.layout?.owner && info.table === win.layout.table && id === this.currentId(win);
    const key = `${info.owner.name}\u0000${info.table}\u0000${id}\u0000${privileges?.in(info.owner).fingerprint ?? ''}\u0000${field?.toLowerCase() ?? ''}\u0000${edited ? win.id : ''}`;
    let r = this.readCache.get(key);
    if (!r) {
      r = info.owner.get(info, id, 'iso', undefined, privileges, { fresh: true, summaries: false, ...(field ? { fields: [field] } : {}), ...(edited ? { edits: Object.fromEntries(win.pending), editKey: win.pending, account: this.opts.account } : {}) }).fieldData;
      // One step that walks a big found set (an export, a sort, a replace) would otherwise hold every record it read.
      if (this.readCache.size >= READ_CACHE_LIMIT) this.readCache.clear();
      if (cache) this.readCache.set(key, r);
    }
    return r;
  }

  private globalKey(info: LayoutInfo, field: string) {
    return `${info.owner.name}::${info.table}::${field}`.toLowerCase();
  }

  private valueOf(info: LayoutInfo, field: Field, id: number | undefined, rep: number, pending?: Map<string, string | number>, cache = true): Value {
    this.opts.beforeFile?.(info.owner);
    const observed = (value: Value): Value => {
      if (this.opts.onFieldRead) this.opts.onFieldRead(field.name, asText(value, info.owner.dateOrder));
      return value;
    };
    // Field-level privileges: a script running without full access can't read a
    // field it has no access to — container fields included, which otherwise
    // read straight from the store, past the redaction that covers other fields.
    const pv = this.privileges?.in(info.owner);
    if (pv && pv.field(info.table, field.name) === 'none') return text('');
    const key = rep > 1 ? `${field.name}(${rep})` : field.name;
    if (field.options?.global) {
      const g = this.session.globalFields.get(this.globalKey(info, field.name));
      if (g) return observed(g[rep - 1] ?? text(''));
    }
    if (pending?.has(key)) return observed(fromStored(pending.get(key)!, calcType(field.type)));
    if (id === undefined) {
      if (!field.options?.global) return text('');
      // A global's stored value is the same in every record; read it from any.
      id = info.owner.findIds(info)[0];
      if (id === undefined) return text('');
    }
    if (field.type === 'container') {
      // A container's bytes come from the store directly, so first read the record through the account's
      // privileges: a record it can't view (an id a client sent, say) throws here instead of giving its file.
      if (this.privileges) this.record(info, id, field.name, cache);
      // The file, read when Set Field or a function (Base64Encode, GetWidth...) needs its bytes; showing its name doesn't.
      const cid = info.owner.containerId(info, id, field.name, rep);
      const c = cid === undefined ? undefined : containerValue(info.owner, cid);
      if (!c) return text('');
      // A file stored outside that is missing copies as an empty file of its name, as it always has.
      return observed(c.type === 'container' && c.changed && !c.data ? { type: 'container', value: c.value, data: new Uint8Array(0), changed: true } : c);
    }
    const raw = this.record(info, id, field.name, cache)[key];
    return observed(fromStored(raw === '' ? null : raw, calcType(field.type)));
  }

  /** LookupNext's nearest related value, from the window's record as it is now (its uncommitted edits included). */
  private lookupNext(win: Window, ref: CalcFieldRef, direction: 'lower' | 'higher'): Value | undefined {
    const info = win.layout;
    const id = this.currentId(win);
    const to = info && win.store.schema.tableOccurrences.find((t) => t.name === info.occurrence);
    const table = info && info.owner === win.store ? win.store.schema.tables.find((t) => t.name === info.table) : undefined;
    if (!info || id === undefined || !to || !table) return undefined;
    if (this.privileges) this.via(info).get(info, id, 'iso', undefined, this.privileges, { fields: [] });
    const row = { ...info.owner.row(info, id), ...Object.fromEntries(win.pending) };
    const pass = win.store.calc.newPass(this.opts.account, this.privileges);
    return win.store.calc.context({ store: win.store, table, row }, to.id, pass).lookupNext?.(ref, direction);
  }

  private readField(win: Window, ref: CalcFieldRef): Value | undefined {
    const info = this.infoFor(win, ref.occurrence);
    if (!info) return undefined;
    const field = this.tableFields(info).find((x) => x.name.toLowerCase() === ref.field.toLowerCase());
    if (!field) return undefined;
    if (field.kind === 'summary') {
      // Over the found set on the layout's own table, over the related records otherwise.
      const ids = info === win.layout ? (win.mode === 'browse' ? this.foundSet(win).ids : []) : this.relatedIds(win, info.occurrence);
      return this.summaryOver(win, info, field, ids);
    }
    if (info === win.layout) return this.valueOf(info, field, this.currentId(win), ref.repetition, win.pending);
    if (field.options?.global) return this.valueOf(info, field, undefined, ref.repetition);
    const id = this.relatedRecord(win, info.occurrence);
    return id !== undefined ? this.valueOf(info, field, id, ref.repetition) : text('');
  }

  private summaryOver(win: Window, info: LayoutInfo, field: Field, ids: number[]): Value {
    if (this.privileges?.in(info.owner).field(info.table, field.name) === 'none') return text('');
    const of = field.summary && this.tableFields(info).find((x) => x.id === field.summary!.fieldId);
    if (!of) return text('');
    if (field.summary?.running && info === win.layout) {
      const fs = this.foundSet(win);
      if (ids === fs.ids && fs.index >= 0) {
        let start = 0;
        const restart = this.tableFields(info).find((x) => x.id === field.summary!.restartFieldId);
        if (restart && fs.sort?.some((x) => x.fieldName.split('::').pop()?.toLowerCase() === restart.name.toLowerCase())) {
          const key = asText(this.valueOf(info, restart, fs.ids[fs.index], 1, undefined, false), info.owner.dateOrder).toLowerCase();
          start = fs.index;
          while (start > 0 && asText(this.valueOf(info, restart, fs.ids[start - 1], 1, undefined, false), info.owner.dateOrder).toLowerCase() === key) start--;
        }
        ids = fs.ids.slice(start, fs.index + 1);
      }
    }
    // Not kept in the read cache: a summary over a large found set would hold every record until the step ends.
    const values: Value[] = [];
    for (const id of ids) {
      const v = this.valueOf(info, of, id, 1, undefined, false);
      if (asText(v) !== '') values.push(v);
      const top = this.stack[this.stack.length - 1];
      if (top) this.poll(top.frame);
    }
    const current = info === win.layout ? this.currentId(win) : undefined;
    const result = summarize(field.summary!.type, values, current !== undefined ? this.valueOf(info, of, current, 1, win.pending) : undefined);
    if (this.opts.onFieldRead) this.opts.onFieldRead(field.name, asText(result, info.owner.dateOrder));
    return result;
  }

  /**
   * GetSummary ( summary ; break ): the summary over the run of records in the
   * sorted found set that share the current record's break value; the total
   * when the break field is the summary field itself.
   */
  private getSummary(win: Window, ref: CalcFieldRef, brk: CalcFieldRef): Value | undefined {
    const info = this.infoFor(win, ref.occurrence);
    if (!info || info !== win.layout || this.infoFor(win, brk.occurrence) !== info || win.mode !== 'browse') return undefined;
    const fields = this.tableFields(info);
    const field = fields.find((x) => x.name.toLowerCase() === ref.field.toLowerCase());
    const by = fields.find((x) => x.name.toLowerCase() === brk.field.toLowerCase());
    if (field?.kind !== 'summary' || !by) return undefined;
    const fs = this.foundSet(win);
    if (by.id === field.id || !fs.ids.length) return this.summaryOver(win, info, field, fs.ids);
    // Claris returns an empty result unless the active sort includes the break field.
    if (!fs.sort?.some((s) => s.fieldName.split('::').pop()?.toLowerCase() === by.name.toLowerCase())) return text('');
    const key = (i: number) => foldCase(asText(this.valueOf(info, by, fs.ids[i], 1, i === fs.index ? win.pending : undefined), win.store.dateOrder));
    const mine = key(fs.index);
    let from = fs.index;
    let to = fs.index;
    while (from > 0 && key(from - 1) === mine) from--;
    while (to < fs.ids.length - 1 && key(to + 1) === mine) to++;
    return this.summaryOver(win, info, field, fs.ids.slice(from, to + 1));
  }

  private readRelated(win: Window, ref: CalcFieldRef): Value[] | undefined {
    const info = this.infoFor(win, ref.occurrence);
    if (!info) return undefined;
    const field = this.tableFields(info).find((x) => x.name.toLowerCase() === ref.field.toLowerCase());
    if (!field) return undefined;
    if (info === win.layout || field.options?.global) return [this.readField(win, ref)!];
    return this.relatedIds(win, info.occurrence).map((id) => this.valueOf(info, field, id, ref.repetition));
  }

  /** Records of a table occurrence related to the window's current record, through the relationship graph. */
  private relatedIds(win: Window, occurrence: string, from?: { occurrence: string; ids: number[] }): number[] {
    const start = from ?? (win.layout ? { occurrence: win.layout.occurrence, ids: [this.currentId(win)].filter((x): x is number => x !== undefined) } : undefined);
    if (!start || !start.ids.length) return [];
    const schema = win.store.schema;
    const path = relationshipPath(schema, start.occurrence, occurrence);
    if (!path) return [];
    let ids = start.ids;
    let at = schema.tableOccurrences.find((t) => t.name.toLowerCase() === start.occurrence.toLowerCase())!;
    for (const { rel, forward } of path) {
      const nextId = forward ? rel.rightTableOccurrenceId : rel.leftTableOccurrenceId;
      const next = schema.tableOccurrences.find((t) => t.id === nextId)!;
      const fromInfo = win.store.occurrence(at.name);
      const toInfo = win.store.occurrence(next.name);
      const out = new Set<number>();
      if (rel.predicates.some((x) => x.operator === '×')) {
        for (const id of toInfo.owner.findIds(toInfo, this.reading)) out.add(id);
      } else if (rel.predicates.some((x) => x.operator !== '=')) {
        // <, ≤, >, ≥ or ≠ in it: the same SQL condition portals and calculations use (left op right, from either side),
        // record by record.
        const fromOcc = occurrenceOf(win.store, at.id);
        const toOcc = occurrenceOf(win.store, next.id);
        if (fromOcc && toOcc) {
          for (const id of ids) {
            const [rec] = rowsById(fromOcc.store, fromOcc.table, [id]);
            const c = rec && relatedCondition({ rel, forward }, fromOcc, toOcc, rec.row as Record<string, SqlValue>, this.privileges,
              (field) => this.record(fromInfo, id, field.name)[field.name] ?? null);
            if (!c) continue;
            for (const x of toOcc.store.select(`SELECT _fm_record_id FROM "${toOcc.table.name.replace(/"/g, '""')}" WHERE ${c.where}`, c.params, 100_000).rows) out.add(Number(x[0]));
          }
        }
      } else {
        const preds = rel.predicates.filter((x) => x.operator === '=').flatMap((pred) => {
          // Field names are blank for a table in another file: look them up by id there.
          const mine = this.predicateField(fromInfo, forward ? pred.leftField : pred.rightField, forward ? pred.leftFieldId : pred.rightFieldId);
          const theirs = this.predicateField(toInfo, forward ? pred.rightField : pred.leftField, forward ? pred.rightFieldId : pred.leftFieldId);
          return mine && theirs ? [{ mine, theirs }] : [];
        });
        const keysOf = (id: number, mine: string) => String(this.record(fromInfo, id, mine)[mine] ?? '').split(/\r|\n/).filter((k) => k !== '');
        if (preds.length === 1) {
          // One match field: every record's keys in one lookup.
          const keys = new Set(ids.flatMap((id) => keysOf(id, preds[0].mine)));
          for (const x of toInfo.owner.matchIds(toInfo, preds[0].theirs, [...keys])) out.add(x);
        } else {
          // More: record by record, so each record's keys match together. Records with the same keys (a found set of
          // line items for a few orders) look them up once.
          const seen = new Map<string, number[]>();
          const matching = (theirs: string, keys: string[]) => {
            const key = `${theirs}\u0000${keys.join('\u0000')}`;
            let found = seen.get(key);
            if (!found) seen.set(key, (found = toInfo.owner.matchIds(toInfo, theirs, keys)));
            return found;
          };
          for (const id of ids) {
            let match: Set<number> | undefined;
            for (const { mine, theirs } of preds) {
              const found = new Set(matching(theirs, keysOf(id, mine)));
              match = match ? new Set([...match].filter((x) => found.has(x))) : found;
            }
            for (const x of match ?? []) out.add(x);
          }
        }
      }
      ids = [...out].sort((a, b) => a - b);
      // Without full access, related records the account can't view aren't there, as in the Data API's portals.
      const viewable = this.privileges && toInfo.owner.viewableIds(toInfo.table, this.privileges);
      if (viewable) {
        const allowed = new Set(viewable);
        ids = ids.filter((x) => allowed.has(x));
      }
      at = next;
      if (!ids.length) break;
    }
    return ids;
  }

  // --- portals ---------------------------------------------------------------

  /** Portals on the window's layout, with their object names, in layout order. */
  private portals(win: Window): { name?: string; occurrence: string }[] {
    const design = win.layoutName ? win.store.design(win.layoutName) : undefined;
    const out: { name?: string; occurrence: string }[] = [];
    const walk = (objs: LayoutObject[] | undefined) => {
      for (const o of objs ?? []) {
        if (o.kind === 'portal' && o.portal?.tableOccurrence) out.push({ name: o.name, occurrence: o.portal.tableOccurrence });
        else walk(o.children);
      }
    };
    walk(design?.objects);
    return out;
  }

  private actionScope(win: Window): Pick<ClientAction, 'windowId' | 'layoutId' | 'recordId'> {
    return { ...(win.id ? { windowId: win.id } : {}), layoutId: win.layout?.layoutId, recordId: win.layout && win.mode === 'browse' ? this.currentId(win) : undefined };
  }

  /** Search the design, including hidden objects, without moving focus. */
  private layoutObject(win: Window, target: string | number | undefined): { object: LayoutObject; path: LayoutObject[] } | undefined {
    const walk = (objects: LayoutObject[], path: LayoutObject[]): { object: LayoutObject; path: LayoutObject[] } | undefined => {
      for (const object of objects) {
        if (typeof target === 'number' ? object.id === target : target !== undefined && object.name === target) return { object, path };
        const child = object.children && walk(object.children, [...path, object]);
        if (child) return child;
      }
    };
    return win.layoutName ? walk(win.store.design(win.layoutName)?.objects ?? [], []) : undefined;
  }

  private async clientCheckpoint(f: Frame): Promise<void> {
    if (!this.opts.checkpoint) return;
    const left = this.deadline - Date.now();
    this.hold();
    try {
      await this.opts.checkpoint({ script: f.script.name, actions: this.actions.slice(), state: this.windowState(), store: this.current.store,
        pending: Object.fromEntries(this.current.pending), get: (name) => this.get(f, name), variable: (name, rep) => this.getVariable(f, name, rep) });
    } finally {
      this.resumeAfter(left);
    }
  }

  /** The cursor is in this field object as the run starts (a field's own trigger, or a button clicked while typing). */
  private startIn(win: Window, id: number): void {
    const design = win.layoutName ? win.store.design(win.layoutName) : undefined;
    let portal: string | undefined;
    const walk = (objs: LayoutObject[] | undefined, inside?: string): LayoutObject | undefined => {
      for (const o of objs ?? []) {
        const here = o.kind === 'portal' ? o.portal?.tableOccurrence : inside;
        if (o.id === id) { portal = here; return o; }
        const found = walk(o.children, here);
        if (found) return found;
      }
      return undefined;
    };
    const o = walk(design?.objects);
    const ref = o?.kind === 'field' ? o.field : undefined;
    if (!ref?.tableOccurrence || !ref.field) return;
    // Only a field the person could have put the cursor in: one they can tab to, and may see.
    if (!this.fieldStops(win).some((x) => x.id === id)) return;
    let info: LayoutInfo | undefined;
    try { info = win.store.occurrence(ref.tableOccurrence); } catch (e) { rethrowExecutionRefusal(e); return; }
    const pv = this.opts.privileges;
    if (pv && !pv.full && pv.in(info.owner).field(info.table, ref.field) === 'none') return;
    win.activeField = { id, ...(o!.name ? { name: o!.name } : {}), occurrence: ref.tableOccurrence, field: ref.field, repetition: 1, ...(portal ? { portal } : {}) };
    if (portal) {
      const at = this.opts.activeRow !== undefined ? this.relatedIds(win, portal).indexOf(this.opts.activeRow) + 1 : 0;
      win.portal = { occurrence: portal, row: at > 0 ? at : win.portal?.occurrence === portal ? win.portal.row : 1 };
    }
  }

  /** Go to Object's repetition in a field object: 1 for none or below 1; past what the field shows is error 102. */
  private objectRepetition(win: Window, object: LayoutObject, requested: number): number {
    const ref = object.field!;
    const field = this.schemaField(win, ref.tableOccurrence!, ref.field!);
    const fieldRepetitions = Math.max(1, field?.options?.repetitions ?? 1);
    const displayedRepetitions = Math.max(1, ref.repetitions ?? 1);
    const max = Math.min(fieldRepetitions, displayedRepetitions);
    const selected = Number.isFinite(requested) ? Math.max(1, Math.trunc(requested)) : 1;
    if (selected > max) throw new ScriptError(ERROR.fieldMissing, `Repetition ${selected} is outside the field's displayed range (1-${max})`);
    return selected;
  }

  /** Go to Object: a named portal, or an object inside one, becomes the active portal. */
  private goToObject(win: Window, name: string, repetition: () => number): void {
    const design = win.layoutName ? win.store.design(win.layoutName) : undefined;
    if (!design) return; // no layout design imported: nothing to check against
    let found: string | undefined;
    let object: LayoutObject | undefined;
    const walk = (objs: LayoutObject[] | undefined, portal?: string): boolean => {
      for (const o of objs ?? []) {
        const inside = o.kind === 'portal' ? o.portal?.tableOccurrence : portal;
        if (o.name === name) { found = inside; object = o; return true; }
        if (walk(o.children, inside)) return true;
      }
      return false;
    };
    if (!walk(design?.objects)) throw new ScriptError(ERROR.objectMissing, `Object "${name}" is missing`);
    // A field object: the cursor goes into it.
    const ref = object?.kind === 'field' ? object.field : undefined;
    let activeField: Window['activeField'];
    if (ref?.tableOccurrence && ref.field) {
      // Only field objects use Repetition. Its omitted and nonpositive values
      // select the first repetition; a value beyond the field or displayed
      // repetitions is an error. Validate before changing any window focus.
      const selected = this.objectRepetition(win, object!, repetition());
      activeField = { id: object!.id, name, occurrence: ref.tableOccurrence, field: ref.field, repetition: selected, ...(found ? { portal: found } : {}) };
    }
    win.portal = found ? { occurrence: found, row: win.portal?.occurrence === found ? win.portal.row : 1 } : undefined;
    win.activeObjectId = object!.id;
    win.activeField = activeField;
    // Where the cursor ends up is what the client shows; a selection made in another field doesn't carry over.
    win.focusMoved = true;
    win.selection = undefined;
  }

  /**
   * The fields Tab visits on the window's layout: Set Tab Order's, else left
   * to right and top to bottom. Summary fields, and calculations and fields
   * that can't be entered in Browse mode, are left out.
   */
  private fieldStops(win: Window): FieldStop[] {
    const design = win.layoutName ? win.store.design(win.layoutName) : undefined;
    if (!design) return [];
    const all: (FieldStop & { top: number; left: number })[] = [];
    const walk = (objs: LayoutObject[] | undefined, portal?: string) => {
      for (const o of objs ?? []) {
        const inside = o.kind === 'portal' ? o.portal?.tableOccurrence : portal;
        const ref = o.field;
        if (o.kind === 'field' && ref?.tableOccurrence && ref.field) {
          const def = this.schemaField(win, ref.tableOccurrence, ref.field);
          const enterable = def && def.kind !== 'summary' && (win.mode === 'find' || (def.kind !== 'calculation' && ref.behavior?.browse !== 'view'));
          if (enterable) {
            all.push({ id: o.id, ...(o.name ? { name: o.name } : {}), occurrence: ref.tableOccurrence, field: ref.field, repetition: 1,
              ...(inside ? { portal: inside } : {}), top: o.bounds.top, left: o.bounds.left });
          }
        }
        walk(o.children, inside);
      }
    };
    walk(design.objects);
    const ordered = design.tabOrder?.length
      ? design.tabOrder.map((id) => all.find((x) => x.id === id)).filter((x): x is (typeof all)[number] => !!x)
      : [...all].sort((a, b) => a.top - b.top || a.left - b.left);
    return ordered.map(({ top: _t, left: _l, ...stop }) => stop);
  }

  /** Go to Field: the first instance of the field on the layout. */
  private goToField(win: Window, occurrence: string, field: string): void {
    const stop = this.fieldStops(win).find((x) => x.occurrence.toLowerCase() === occurrence.toLowerCase() && x.field.toLowerCase() === field.toLowerCase());
    if (!stop) throw new ScriptError(ERROR.fieldMissing, `Field "${occurrence}::${field}" is not on the layout`);
    this.enter(win, stop, 1);
  }

  /**
   * Go to Next / Previous Field, as Tab and Shift-Tab: the next stop in tab
   * order, wrapping round. In a portal, Tab from the last field of a row goes
   * to the first field of the next row; after the last row it leaves the portal.
   */
  private tab(win: Window, back: boolean): void {
    const to = this.nextStop(win, back);
    if (to) this.enter(win, to.stop, to.row);
  }

  /** Where Go to Next (or Previous) Field takes the cursor: the stop and its portal row (1 outside portals). */
  private nextStop(win: Window, back: boolean): { stop: FieldStop; row: number } | undefined {
    const stops = this.fieldStops(win);
    if (!stops.length) return undefined;
    const now = win.activeField;
    const at = now ? stops.findIndex((x) => x.id === now.id) : -1;
    if (at < 0) return { stop: stops[back ? stops.length - 1 : 0], row: 1 };
    const step = back ? -1 : 1;
    const next = stops[(at + step + stops.length) % stops.length];
    if (now!.portal && next.portal !== now!.portal) {
      // Leaving this row's fields: the next row, if there is one.
      const row = (win.portal?.occurrence === now!.portal ? win.portal.row : 1) + step;
      const rows = this.relatedIds(win, now!.portal).length;
      if (row >= 1 && row <= rows) {
        // The run of this portal's stops around `at`: its first (Tab) or last (Shift-Tab) one.
        let i = at;
        while (stops[(i - step + stops.length) % stops.length].portal === now!.portal && (i - step + stops.length) % stops.length !== at) i = (i - step + stops.length) % stops.length;
        return { stop: stops[i], row };
      }
    }
    return { stop: next, row: next.portal && back ? Math.max(1, this.relatedIds(win, next.portal).length) : 1 };
  }

  private enter(win: Window, stop: FieldStop, row: number): void {
    win.activeField = stop;
    win.activeObjectId = stop.id;
    win.focusMoved = true;
    win.selection = undefined;
    win.portal = stop.portal ? { occurrence: stop.portal, row } : undefined;
  }

  /** The active portal, or the layout's first one (FileMaker's choice when none is active). */
  private activePortal(win: Window): { occurrence: string; row: number } {
    if (!win.portal) {
      const first = this.portals(win)[0];
      if (!first) throw new ScriptError(ERROR.recordMissing, 'The layout has no portal');
      win.portal = { occurrence: first.occurrence, row: 1 };
    }
    return win.portal;
  }

  private goToPortalRow(f: Frame, p: StepParams, b: Blocks, pc: number): number | undefined {
    const win = this.current;
    const portal = this.activePortal(win);
    const n = this.relatedIds(win, portal.occurrence).length;
    // A portal whose relationship allows creating related records ends in an empty row: Last goes there,
    // and setting a field in it makes a related record (Claris: "Goes to the last row of a portal to create a record").
    const blankRow = this.canCreateRelated(win, portal.occurrence);
    switch (p.location) {
      case 'first': portal.row = 1; break;
      case 'last': portal.row = blankRow ? n + 1 : Math.max(1, n); break;
      case 'next':
        if (portal.row >= n) {
          if (p.exitAfterLast) return this.exitLoop(b, pc);
          throw new ScriptError(ERROR.recordMissing, 'Already on the last portal row');
        }
        portal.row++;
        break;
      case 'previous':
        if (portal.row <= 1) {
          if (p.exitAfterLast) return this.exitLoop(b, pc);
          throw new ScriptError(ERROR.recordMissing, 'Already on the first portal row');
        }
        portal.row--;
        break;
      case 'calculation': {
        const row = Math.trunc(asNumber(this.eval(f, p.calculation ?? '')));
        if (row < 1 || row > n) throw new ScriptError(ERROR.recordMissing, `There is no portal row ${row}`);
        portal.row = row;
        break;
      }
    }
    if (!n && !blankRow) throw new ScriptError(ERROR.recordMissing, 'The portal has no rows');
    return undefined;
  }

  private deletePortalRow(win: Window): void {
    const portal = this.activePortal(win);
    this.commit(win);
    const id = this.relatedIds(win, portal.occurrence)[portal.row - 1];
    if (id === undefined) throw new ScriptError(ERROR.recordMissing, 'No portal row to delete');
    const info = win.store.occurrence(portal.occurrence);
    this.via(info).delete(info, id, this.write);
    this.readCache.clear();
    portal.row = Math.max(1, portal.row - 1);
  }

  /** The record a related field means: the active portal row when the field is in that portal, else the first related record. */
  private relatedRecord(win: Window, occurrence: string): number | undefined {
    const ids = this.relatedIds(win, occurrence);
    if (win.portal && win.portal.occurrence.toLowerCase() === occurrence.toLowerCase()) return ids[win.portal.row - 1];
    return ids[0];
  }

  private predicateField(info: LayoutInfo, name: string | undefined, id: number): string | undefined {
    return name ?? this.tableFields(info).find((x) => x.id === id)?.name;
  }

  // --- writing fields --------------------------------------------------------

  private resolveTarget(f: Frame, ref: FieldRef): { info: LayoutInfo; field: Field; win: Window } {
    const win = this.current;
    const info = this.infoFor(win, ref.tableOccurrence.name);
    if (!info) throw new ScriptError(ERROR.fieldMissing, `Table occurrence "${ref.tableOccurrence.name}" is missing`);
    const fields = this.tableFields(info);
    const field = ref.field.name.startsWith('⟨field:')
      ? fields.find((x) => x.id === ref.field.id)
      : fields.find((x) => x.name.toLowerCase() === ref.field.name.toLowerCase());
    if (!field) throw new ScriptError(ERROR.fieldMissing, `Field "${ref.field.name}" is missing`);
    return { info, field, win };
  }

  private setField(f: Frame, p: Pick<StepParams, 'field' | 'repetitionCalculation'>, value: Value): void {
    // A failed calculation yields "?" as a value; no caller may turn that placeholder into a field write.
    if (this.calcError) return;
    if (p.field && this.diagnostics.sensitiveName(p.field.field.name)) this.diagnostics.remember(asText(value, this.current.store.dateOrder));
    const noted = this.modified?.length;
    try {
      this.writeField(f, p, value);
    } catch (e) {
      if (this.modified && noted !== undefined) this.modified.length = noted; // not changed after all
      throw e;
    }
  }

  /** Invalidate stored results on each input change, even when the next step changes it back. */
  private setPending(win: Window, key: string, value: string | number | undefined): void {
    if (win.pending.get(key) !== value) win.layout?.owner.calc.invalidateEdits(win.pending, [key.replace(/\(\d+\)$/, '')]);
    if (value === undefined) win.pending.delete(key);
    else win.pending.set(key, value);
  }

  /** Keeps what an edit replaces, for Undo/Redo. Edits made before the record was last committed or reverted don't count. */
  private noteUndo(win: Window, key: string): void {
    if (!win.pending.size) win.undo = [];
    (win.undo ??= []).push({ key, value: win.pending.get(key) });
    win.redo = [];
    win.undid = false;
  }

  /**
   * Undo/Redo: Undo puts back the field the last uncommitted edit changed (as it was before it), Redo makes an undone
   * edit again, Toggle does whichever didn't happen last. Edits are the ones this run made to the current record since
   * it was last committed or reverted (a person's typing before the script started isn't known here); with nothing to
   * undo or redo it does nothing, as FileMaker's menu item would be dimmed (inferred).
   */
  private undoRedo(win: Window, which: 'undo' | 'redo' | 'toggle'): void {
    if (!win.pending.size) win.undo = win.redo = [];
    const undo = which === 'undo' || (which === 'toggle' && !win.undid);
    const from = undo ? win.undo : win.redo;
    const step = from?.pop();
    if (!step) return;
    (undo ? (win.redo ??= []) : (win.undo ??= [])).push({ key: step.key, value: win.pending.get(step.key) });
    this.setPending(win, step.key, step.value);
    win.undid = undo;
  }

  private writeField(f: Frame, p: Pick<StepParams, 'field' | 'repetitionCalculation'>, value: Value): void {
    const active = this.current.activeField;
    if (!p.field && !active) throw new ScriptError(ERROR.fieldMissing, 'No field to set: no field is active');
    const target: FieldRef = p.field ?? { tableOccurrence: { id: 0, name: active!.occurrence }, field: { id: 0, name: active!.field }, repetition: active!.repetition };
    const { info, field, win } = this.resolveTarget(f, target);
    this.modified?.push({ win, occurrence: target.tableOccurrence.name, field: field.name });
    const rep = p.repetitionCalculation ? Math.max(1, Math.trunc(asNumber(this.eval(f, p.repetitionCalculation)))) : target.repetition ?? 1;
    const key = rep > 1 ? `${field.name}(${rep})` : field.name;
    if (win.mode === 'find') {
      const r = win.requests[win.requestIndex] ?? (win.requests[0] = { criteria: {}, omit: false });
      r.criteria[info === win.layout ? key : `${info.occurrence}::${key}`] = asText(value, win.store.dateOrder);
      return;
    }
    if (field.options?.global) {
      const privileges = this.privileges?.in(info.owner);
      if (privileges && privileges.field(info.table, field.name) !== 'modifiable') throw new ScriptError(ERROR.fieldNotModifiable, `Field "${field.name}" cannot be modified`);
      if (privileges && privileges.table(info.table).edit === false) throw new ScriptError(200, 'Record access is denied');
      const k = this.globalKey(info, field.name);
      const arr = this.session.globalFields.get(k) ?? [];
      arr[rep - 1] = kept(value);
      this.session.globalFields.set(k, arr);
      return;
    }
    if (field.kind !== 'normal') throw new ScriptError(ERROR.fieldNotModifiable, `Field "${field.name}" is a ${field.kind} field`);
    if (field.type === 'container') return this.setContainer(win, info, field, rep, value);
    const stored = toStored(value, calcType(field.type) as ValueType, win.store.dateOrder);
    if (info === win.layout) {
      if (this.currentId(win) === undefined) throw new ScriptError(ERROR.recordMissing, 'No current record');
      this.lockForEdit(win);
      this.noteUndo(win, key);
      this.setPending(win, key, stored ?? '');
      this.limitPending(win, info);
      return;
    }
    // A related field: the active portal row or the first related record, created when the relationship allows it.
    const id = this.relatedRecord(win, info.occurrence) ?? this.createRelated(win, info);
    this.via(info).update(info, id, { [key]: stored ?? '' }, undefined, this.write);
    this.touched(info);
  }

  /**
   * A new related record, as FileMaker makes one when a field is set through
   * relationships that allow creation on the related side. Each hop reuses the
   * first related record or creates one with the match values; when the record
   * it comes from has an empty match field, that field takes the new record's
   * (auto-entered) key instead.
   */
  private createRelated(win: Window, info: LayoutInfo): number {
    const missing = () => new ScriptError(ERROR.recordMissing, `No related record in "${info.occurrence}"`);
    const start = this.currentId(win);
    const path = win.layout && relationshipPath(win.store.schema, win.layout.occurrence, info.occurrence);
    if (start === undefined || !path?.length) throw missing();
    let id: number = start;
    if (!this.canCreateRelated(win, info.occurrence)) throw missing();
    let at = win.store.occurrence(win.layout!.occurrence);
    for (const [i, { rel, forward }] of path.entries()) {
      const next = win.store.occurrence((forward ? rel.rightTableOccurrence : rel.leftTableOccurrence) ?? '');
      const existing: number | undefined = i ? this.relatedIds(win, next.occurrence, { occurrence: at.occurrence, ids: [id] })[0] : undefined;
      id = existing ?? this.createThrough(win, rel, forward, at, id, next, i === 0, missing);
      at = next;
    }
    return id;
  }

  /** Whether every relationship from the layout to the occurrence allows creating records on the far side, with = matches. */
  private canCreateRelated(win: Window, occurrence: string): boolean {
    const path = win.layout && relationshipPath(win.store.schema, win.layout.occurrence, occurrence);
    return !!path?.length && path.every(({ rel, forward }) => (forward ? rel.rightCreate : rel.leftCreate) && rel.predicates.length > 0 && rel.predicates.every((x) => x.operator === '='));
  }

  private createThrough(win: Window, rel: Relationship, forward: boolean, from: LayoutInfo, fromId: number, to: LayoutInfo, current: boolean, missing: () => ScriptError): number {
    const keys = rel.predicates.map((pred) => {
      const a = this.predicateField(from, forward ? pred.leftField : pred.rightField, forward ? pred.leftFieldId : pred.rightFieldId);
      const b = this.predicateField(to, forward ? pred.rightField : pred.leftField, forward ? pred.rightFieldId : pred.leftFieldId);
      if (!a || !b) throw missing();
      const field = this.tableFields(from).find((x) => x.name === a);
      // A masked key would be read as its stand-in and copied into the new record.
      if (this.privileges?.in(from.owner).field(from.table, a) === 'none') throw missing();
      const value = field?.options?.global
        ? asText(this.session.globalFields.get(this.globalKey(from, a))?.[0] ?? text(''))
        : String((current ? win.pending.get(a) : undefined) ?? this.record(from, fromId, a)[a] ?? '');
      return { a, b, field, value, theirs: this.tableFields(to).find((x) => x.name === b) };
    });
    // Every empty match field here must be one FileMaker can fill from the new record.
    if (keys.some((k) => k.value === '' && (k.field?.kind !== 'normal' || !k.theirs?.options?.autoEnter))) throw missing();
    const data: FieldData = {};
    for (const k of keys) if (k.value !== '' && k.theirs?.kind === 'normal') data[k.b] = k.value;
    const { recordId } = this.via(to).create(to, data, this.write);
    this.created++;
    this.readCache.clear();
    const created = this.record(to, recordId);
    for (const k of keys) {
      if (k.value !== '') continue;
      const v = String(created[k.b] ?? '');
      if (k.field!.options?.global) this.session.globalFields.set(this.globalKey(from, k.a), [text(v)]);
      else if (current) {
        this.lockForEdit(win);
        this.setPending(win, k.a, v);
        this.limitPending(win, from);
      }
      else this.via(from).update(from, fromId, { [k.a]: v }, undefined, this.write);
    }
    this.readCache.clear();
    return recordId;
  }

  /** Containers are written at once (not held until commit): a file from another container or a function like Base64Decode, or empty. */
  private setContainer(win: Window, info: LayoutInfo, field: Field, rep: number, value: Value): void {
    let file: { filename: string | null; mime: string; data: Uint8Array } | null = null;
    if (value.type === 'container' && value.data) {
      const filename = value.value || null;
      file = { filename, mime: containerMime('', filename ?? undefined, value.data), data: value.data };
    } else if (asText(value) !== '') {
      throw new ScriptError(ERROR.fieldNotModifiable, `Container field "${field.name}" takes a file, not text or a file path`);
    }
    const id = info === win.layout ? this.currentId(win) : this.relatedRecord(win, info.occurrence);
    if (id === undefined) throw new ScriptError(ERROR.recordMissing, 'No current record');
    this.via(info).setContainer(info, id, field.name, rep, file, this.write);
    this.readCache.clear();
  }

  /** Export Field Contents: a client action with the file name and where to download the file. */
  private exportField(f: Frame, p: StepParams): void {
    // No field named: the active one (Go to Field), as in FileMaker.
    const active = this.current.activeField;
    if (!p.field && !active) throw new ScriptError(ERROR.fieldMissing, 'No field to export: no field is active');
    const target: FieldRef = p.field ?? { tableOccurrence: { id: 0, name: active!.occurrence }, field: { id: 0, name: active!.field }, repetition: active!.repetition };
    const { info, field, win } = this.resolveTarget(f, target);
    if (this.privileges && (!this.privileges.in(win.store).canExport || !this.privileges.in(info.owner).canExport)) throw new ScriptError(ERROR.privileges, 'Export Field Contents needs the "export" privilege (or a script set to run with full access privileges)');
    const rep = target.repetition ?? 1;
    // The output path: an entry that is a variable name gives the path; the file name is its last part.
    const path = (p.filePaths ?? []).map((x) => (x.startsWith('$') ? asText(this.getVariable(f, x, 1) ?? text('')) : x))[0] ?? '';
    const named = path.split(/[/:\\]/).pop() || undefined;
    const action: ClientAction = { step: 'Export Field Contents', script: f.script.name, field: `${info.occurrence}::${field.name}` };
    if (field.type === 'container' && !field.options?.global) {
      // A container the account can't read (hidden or masked) exports nothing.
      if (this.privileges?.in(info.owner).field(info.table, field.name) === 'none') return;
      const id = info === win.layout ? this.currentId(win) : this.relatedRecord(win, info.occurrence);
      if (id === undefined) throw new ScriptError(ERROR.recordMissing, 'No current record');
      // A supplied/stale found-set ID must not bypass the normal record-view check.
      if (this.privileges) this.via(info).get(info, id, 'iso', undefined, this.privileges, { fields: [field.name] });
      const cid = info.owner.containerId(info, id, field.name, rep);
      if (cid === undefined) return; // an empty container exports nothing
      const c = info.owner.container(cid)!;
      if (this.writesToDocuments() && !this.opts.clientFieldExports) return this.writeExported(f, p, named ?? c.filename ?? 'Untitled', c.data);
      Object.assign(action, this.opts.clientFieldExports && this.writesToDocuments()
        ? { filename: named ?? c.filename ?? 'Untitled', mime: c.mime, base64: Buffer.from(c.data).toString('base64') }
        : { filename: named ?? c.filename ?? 'Untitled', mime: c.mime, url: info.owner.containerUrl(cid, c.filename, this.privileges?.linkPrincipal) });
    } else {
      // Text (or a global container): the contents travel with the action.
      const v = this.readField(win, { occurrence: info.occurrence, field: field.name, repetition: rep }) ?? text('');
      const data = v.type === 'container' && v.data ? v.data : new TextEncoder().encode(asText(v, win.store.dateOrder));
      const filename = named ?? (v.type === 'container' && v.value ? v.value : 'Untitled.txt');
      if (this.writesToDocuments() && !this.opts.clientFieldExports) return this.writeExported(f, p, filename, data);
      Object.assign(action, { filename, base64: Buffer.from(data).toString('base64') });
    }
    this.actions.push(action);
  }

  /** A run with a documents folder and no person to download to (a schedule, the Data API, the command line) writes files there. */
  private writesToDocuments(): boolean {
    return !this.opts.downloads && !!this.opts.documents;
  }

  /** Export Field Contents into the documents folder: the step's path, or the field's own file name when it gives none. */
  private writeExported(f: Frame, p: StepParams, filename: string, data: Uint8Array): void {
    const path = p.filePaths?.some((x) => x.trim()) ? this.filePath(f, p, 'Export Field Contents').path : this.sandboxPath(filename);
    if (!path) throw new ScriptError(ERROR.missingFile, `"${filename}" is not a file name in the documents folder`);
    if (!existsSync(dirname(path))) {
      if (!p.createFolders && dirname(path) !== this.opts.documents) throw new ScriptError(ERROR.missingFile, 'The folder is missing (Create folders is off)');
      mkdirSync(dirname(path), { recursive: true });
    }
    if ([...this.dataFiles.values()].some((d) => d.path === path)) throw new ScriptError(ERROR.fileInUse, 'The file is open (Open Data File)');
    if (existsSync(path) && statSync(path).isDirectory()) throw new ScriptError(ERROR.fileInUse, `"${basename(path)}" is a folder`);
    writeFileSync(path, data);
  }

  /** Serial entry options are a design change in the field's owning file. */
  private requireSerialAccess(owner: Store, step: string): void {
    if (this.privileges && !this.privileges.in(owner).full) throw new ScriptError(ERROR.privileges, `${step} needs full access to the field's file`);
  }

  /**
   * Replace Field Contents over the found set: a calculated result, the
   * current record's value, or serial numbers. Serial numbers count up from
   * custom values or from the field's next serial value; with "Update serial
   * number in Entry Options" the field's next value then follows the last one.
   */
  private async replaceField(f: Frame, p: StepParams): Promise<void> {
    const win = this.current;
    const target = p.field ?? this.activeTarget(win);
    if (!target) throw new ScriptError(ERROR.fieldMissing, 'Replace Field Contents names no field and no field is active');
    const set = { ...p, field: target };
    const { info, field } = this.resolveTarget(f, target);
    if (p.replaceWith === 'serial' && p.serial?.updateEntryOptions) this.requireSerialAccess(info.owner, 'Replace Field Contents');
    const table = info.owner.schema.tables.find((t) => t.name === info.table);
    let value: (i: number) => Value;
    let serial: string | undefined;
    let by = 1;
    if (p.replaceWith === 'current') {
      const current = this.readField(win, { occurrence: target.tableOccurrence.name, field: target.field.name, repetition: Number(target.repetition ?? 1) || 1 }) ?? text('');
      value = () => current;
    } else if (p.replaceWith === 'serial') {
      if (p.serial?.initial !== undefined) {
        serial = asText(this.eval(f, p.serial.initial));
        if (this.calcError) throw new ScriptError(this.calcError, this.calcMessage ?? 'Replace Field Contents calculation failed');
        by = asNumber(this.eval(f, p.serial.increment ?? '1')) || 1;
      } else {
        serial = table && info.owner.calc.peekSerial(table, field);
        if (serial === undefined) throw new ScriptError(ERROR.fieldMissing, `Field "${field.name}" has no serial number in its entry options`);
        by = field.options?.autoEnter?.serial?.increment || 1;
      }
      value = (i) => text(i === 0 ? serial! : (serial = serialNext(serial!, by)));
    } else if (p.calculation !== undefined) {
      value = () => this.eval(f, p.calculation!);
    } else throw new ScriptError(ERROR.unavailable, 'Replace Field Contents needs a calculation, the current contents or serial numbers');
    this.commit(win);
    const fs = this.foundSet(win);
    const keep = fs.index;
    // A formula that may call GetEmbedding is worked out on every record first, writing nothing, to embed the texts
    // it needs at once; a step run again after records were written would write them twice.
    if (p.calculation !== undefined && p.replaceWith !== 'current' && p.replaceWith !== 'serial' && (EMBEDS.test(p.calculation) || functionsEmbed(f.store) || functionsEmbed(win.store))) {
      const locals = copyVariables(f.locals);
      const globals = copyVariables(this.session.variables);
      const asks: EmbeddingAsk[] = [];
      this.embeddingAsks = asks;
      try {
        for (let i = 0; i < fs.ids.length; i++) {
          fs.index = i;
          await this.checkpoint(f);
          this.readCache.clear();
          value(i);
          if (this.calcError) throw new ScriptError(this.calcError, this.calcMessage ?? 'Replace Field Contents calculation failed');
        }
      } finally {
        this.embeddingAsks = undefined;
        fs.index = keep;
        restoreVariables(f.locals, locals);
        restoreVariables(this.session.variables, globals);
        this.calcError = 0;
        this.calcMessage = undefined;
      }
      if (asks.length) throw new NeedEmbedding(asks);
    }
    try {
      for (let i = 0; i < fs.ids.length; i++) {
        fs.index = i;
        await this.checkpoint(f);
        this.readCache.clear();
        let v: Value;
        try {
          v = value(i);
          if (this.calcError) throw new ScriptError(this.calcError, this.calcMessage ?? 'Replace Field Contents calculation failed');
        } catch (e) {
          rethrowExecutionRefusal(e);
          // A text the first pass didn't need (the formula reads what earlier records were set to): stop rather than run again.
          if (e instanceof NeedEmbedding) throw new ScriptError(ERROR.unavailable, 'GetEmbedding: Replace Field Contents needed a text it couldn\'t embed beforehand; use Insert Embedding in Found Set');
          throw e;
        }
        this.setField(f, set, v);
        this.commit(win);
      }
    } finally {
      fs.index = keep;
    }
    if (serial !== undefined && p.serial?.updateEntryOptions && table && fs.ids.length) info.owner.calc.setNextSerial(table, field, serialNext(serial, by));
  }

  /**
   * Relookup Field Contents: for each record in the found set, the lookups
   * that match on the field copy their values again (as when the match field
   * is set to the value it has).
   */
  private relookup(f: Frame, p: StepParams): void {
    const win = this.current;
    const active = this.activeTarget(win);
    const target = p.field ?? active;
    if (!target) throw new ScriptError(ERROR.fieldMissing, 'Relookup Field Contents names no field and no field is active');
    const { info, field } = this.resolveTarget(f, target);
    if (field.kind !== 'normal') throw new ScriptError(ERROR.fieldNotModifiable, `Field "${field.name}" can't be a match field to relookup (it is a ${field.kind} field)`);
    if (info !== win.layout) throw new ScriptError(ERROR.fieldMissing, 'Relookup Field Contents works on a field of the layout\'s table');
    this.commit(win);
    const fs = this.foundSet(win);
    const keep = fs.index;
    try {
      for (let i = 0; i < fs.ids.length; i++) {
        fs.index = i;
        this.poll(f);
        const id = fs.ids[i];
        const value = this.via(info).get(info, id, 'iso', undefined, this.privileges, { fields: [field.name] }).fieldData[field.name];
        this.via(info).update(info, id, { [field.name]: value ?? '' }, undefined, this.write);
      }
    } finally {
      fs.index = keep;
      this.readCache.clear();
    }
  }

  /** The active field as a field reference, when the cursor is in one. */
  /**
   * Perform Find/Replace. Replace All changes every match in the found set (or
   * the current record), in the active field or every field on the layout;
   * Find Next selects the next match after the cursor (later in the same
   * field, then the fields after it, then the records after it, wrapping
   * round). Replace changes the selected text when it is a match (as after
   * Find Next or Set Selection), and Replace & Find then finds the next one;
   * with no match selected, Replace changes nothing and Replace & Find only
   * finds. A cursor with no selection made by the script counts as at the
   * end of its field, as for Insert Current Date. FileMaker's text doesn't keep
   * the dialog's options: without "Within", a script with a field active
   * searches that field (as Claris's Go to Field example does), otherwise all
   * fields. No match isn't an error, as in FileMaker.
   */
  private findReplace(f: Frame, p: StepParams): void {
    const win = this.current;
    const o = p.findReplace;
    if (!o) throw new ScriptError(ERROR.unavailable, 'Perform Find/Replace names nothing to find');
    const find = asText(this.eval(f, o.find));
    if (!find) return;
    const replace = asText(this.eval(f, o.replace ?? '""'));
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(o.wholeWords ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped, `gu${o.matchCase ? '' : 'i'}`);
    const within = o.within ?? (win.activeField ? 'current' : 'all');
    const only = o.fields && new Set(o.fields.map((x) => x.toLowerCase()));
    const layoutTo = this.layoutOf(win).occurrence.toLowerCase();
    const named = (x: FieldStop) => !only || (only.has(x.field.toLowerCase()) && x.occurrence.toLowerCase() === layoutTo) || only.has(`${x.occurrence}::${x.field}`.toLowerCase());
    const stops = this.fieldStops(win).filter((x) => !x.portal && named(x));
    const fields = within === 'current'
      ? (win.activeField && !win.activeField.portal ? [win.activeField] : [])
      : stops.filter((x, i) => stops.findIndex((y) => y.occurrence === x.occurrence && y.field === x.field && y.repetition === x.repetition) === i);
    if (within === 'current' && !fields.length) throw new ScriptError(ERROR.fieldMissing, 'Perform Find/Replace searches the current field, and no field is active');
    const editable = fields.flatMap((x) => {
      const ref: FieldRef = { tableOccurrence: { id: 0, name: x.occurrence }, field: { id: 0, name: x.field }, repetition: x.repetition };
      const { field } = this.resolveTarget(f, ref);
      return field.kind === 'normal' && field.type !== 'container' ? [{ stop: x, ref }] : [];
    });
    const fs = this.foundSet(win);
    const read = (x: FieldStop) => asText(this.readField(win, { occurrence: x.occurrence, field: x.field, repetition: x.repetition }) ?? text(''));
    const at = (x: FieldStop | undefined) => (x ? editable.findIndex((y) => y.stop.id === x.id) : -1);
    /** The match the selection covers exactly, in the active field: [start, end], or undefined. */
    const selected = (): [number, number] | undefined => {
      const i = at(win.activeField);
      if (i < 0 || !win.selection) return undefined;
      const value = read(editable[i].stop);
      const [s, e] = win.selection === 'all' ? [0, value.length] : win.selection.map((n) => Math.min(n, value.length));
      if (e <= s) return undefined;
      pattern.lastIndex = s;
      const m = pattern.exec(value);
      return m && m.index === s && m[0].length === e - s ? [s, e] : undefined;
    };
    const findNext = () => {
      const n = o.currentRecord ? 1 : fs.ids.length;
      const start = fs.index;
      const after = at(win.activeField);
      // Where the search starts in the active field: after the selection, else at the end.
      const value = after >= 0 ? read(editable[after].stop) : '';
      const offset = after < 0 ? 0 : Array.isArray(win.selection) ? Math.min(win.selection[1], value.length) : value.length;
      // Other records are read as saved, not with this record's unsaved edits (which the window holds), and nothing
      // is saved or moved unless a match turns up: with none, the cursor and the edits stay as they were.
      const edits = win.pending;
      let hit: { k: number; i: number; m: RegExpExecArray } | undefined;
      try {
        for (let k = 0; k <= n && !hit; k++) {
          // Across the current record only: back round to this one, not on to the next.
          const other = !o.currentRecord && k > 0 && k < n;
          fs.index = o.currentRecord ? start : (start + k) % Math.max(1, fs.ids.length);
          win.pending = fs.index === start ? edits : new Map();
          this.readCache.clear();
          const from = k === 0 ? Math.max(after, 0) : 0;
          const to = k === n ? after + 1 : editable.length;
          for (let i = from; i < to; i++) {
            const v = read(editable[i].stop);
            pattern.lastIndex = k === 0 && i === after ? offset : 0;
            const m = pattern.exec(v);
            // Back round to where it started: only what lies before the cursor.
            if (m && !(k === n && i === after && m.index + m[0].length > offset)) {
              hit = { k: other ? k : 0, i, m };
              break;
            }
          }
        }
      } finally {
        fs.index = start;
        win.pending = edits;
        this.readCache.clear();
      }
      if (!hit) return;
      if (hit.k) {
        // On to another record: this one's edits (a Replace) are saved first, as leaving a record does.
        this.commit(win);
        fs.index = (start + hit.k) % fs.ids.length;
        this.readCache.clear();
      }
      this.enter(win, editable[hit.i].stop, 1);
      win.selection = [hit.m.index, hit.m.index + hit.m[0].length];
    };
    if (o.operation === 'Find Next') return findNext();
    if (o.operation === 'Replace' || o.operation === 'Replace & Find') {
      const sel = selected();
      if (sel) {
        const x = editable[at(win.activeField)];
        const value = read(x.stop);
        this.setField(f, { field: x.ref }, text(value.slice(0, sel[0]) + replace + value.slice(sel[1])));
        this.readCache.clear();
        win.selection = [sel[0], sel[0] + replace.length];
      }
      if (o.operation === 'Replace & Find') findNext();
      return;
    }
    // Replace All.
    this.commit(win);
    const keep = fs.index;
    const indexes = o.currentRecord ? [keep] : fs.ids.map((_, i) => i);
    try {
      for (const i of indexes) {
        fs.index = i;
        this.poll(f);
        this.readCache.clear();
        let changed = false;
        for (const x of editable) {
          const before = read(x.stop);
          const after = before.replace(pattern, () => replace);
          if (after !== before) {
            this.setField(f, { field: x.ref }, text(after));
            changed = true;
          }
        }
        if (changed) this.commit(win);
      }
    } finally {
      fs.index = keep;
    }
  }

  /** What Copy, Cut or Copy Record put on the clipboard: kept for Paste in this run, and sent to the person's own clipboard. */
  private copied(f: Frame, s: ScriptStep, value: Value): void {
    this.clipboard = value;
    this.actions.push({ step: s.name, script: f.script.name, clipboard: asText(value, this.current.store.dateOrder) });
  }

  /** Puts text in the active field at its insertion point (over the selection, or over everything with Select), leaving the cursor after it. */
  /**
   * Insert Text, Insert Calculated Result and Paste: with Select entire contents (or a script that doesn't say, as a
   * converted file's doesn't yet) the value replaces the field or variable. Without it, in the active field it replaces
   * the selected text or goes in at the insertion point, in another field at the end (FileMaker's default insertion
   * point), and in a variable at the end; container values always replace.
   */
  private place(f: Frame, p: StepParams, value: Value): void {
    const win = this.current;
    if (p.variable && !p.field) {
      const was = p.selectEntireContents === false ? this.getVariable(f, p.variable, 1) : undefined;
      const append = was !== undefined && was.type !== 'container' && value.type !== 'container';
      this.setVariable(f, p.variable, 1, append ? text(asText(was, win.store.dateOrder) + asText(value, win.store.dateOrder)) : value);
      return;
    }
    const target = p.field ?? this.activeTarget(win);
    if (p.selectEntireContents !== false || !target || value.type === 'container' || p.repetitionCalculation !== undefined
      || this.resolveTarget(f, target).field.type === 'container') {
      this.setField(f, p, value);
      return;
    }
    const inserted = asText(value, win.store.dateOrder);
    if (this.isActive(win, target)) this.insertAtSelection(f, win, target, inserted);
    else {
      const current = asText(this.readField(win, { occurrence: target.tableOccurrence.name, field: target.field.name, repetition: target.repetition ?? 1 }) ?? text(''), win.store.dateOrder);
      this.setField(f, { field: target }, text(current + inserted));
    }
  }

  /** Whether the field is the one the cursor is in. */
  private isActive(win: Window, ref: FieldRef): boolean {
    const a = win.activeField;
    return !!a && a.occurrence.toLowerCase() === ref.tableOccurrence.name.toLowerCase() && a.field.toLowerCase() === ref.field.name.toLowerCase()
      && (ref.repetition ?? a.repetition) === a.repetition;
  }

  /** The text selected in the active field, when this is that field and some is selected. */
  private selectedPart(f: Frame, ref: FieldRef): { text: string; start: number; end: number } | undefined {
    const win = this.current;
    if (!this.isActive(win, ref) || !Array.isArray(win.selection) || win.selection[0] >= win.selection[1]) return undefined;
    const current = asText(this.readField(win, { occurrence: ref.tableOccurrence.name, field: ref.field.name, repetition: ref.repetition ?? win.activeField!.repetition }) ?? text(''), win.store.dateOrder);
    const [start, end] = win.selection.map((n) => Math.min(n, current.length));
    return start < end ? { text: current, start, end } : undefined;
  }

  private insertAtSelection(f: Frame, win: Window, target: FieldRef, inserted: string, selectAll?: boolean): void {
    const current = asText(this.readField(win, { occurrence: target.tableOccurrence.name, field: target.field.name, repetition: target.repetition ?? 1 }) ?? text(''), win.store.dateOrder);
    const [start, end] = selectAll || win.selection === 'all' ? [0, current.length]
      : Array.isArray(win.selection) ? win.selection.map((n) => Math.min(n, current.length)) : [current.length, current.length];
    this.setField(f, { field: target }, text(current.slice(0, start) + inserted + current.slice(end)));
    win.selection = [start + inserted.length, start + inserted.length];
  }

  private activeTarget(win: Window): FieldRef | undefined {
    const a = win.activeField;
    return a ? { tableOccurrence: { id: 0, name: a.occurrence }, field: { id: 0, name: a.field }, repetition: a.repetition } : undefined;
  }

  /**
   * Copy Record/Request and Copy All Records/Requests: the layout's fields as
   * text, separated by tabs, repetitions by the group separator, and records
   * (or requests) by returns. Containers give their file name.
   */
  private copyRecords(win: Window, all: boolean): string {
    const info = this.layoutOf(win);
    const sep = '\u001d';
    if (win.mode === 'find') {
      const rows = all ? win.requests : win.requests.slice(win.requestIndex, win.requestIndex + 1);
      return rows.map((r) => info.fields.map((x) => (r.criteria[x.name] ?? '').replace(/[\t\r\n]/g, ' ')).join('\t')).join('\r');
    }
    this.commit(win);
    const fs = this.foundSet(win);
    const ids = all ? fs.ids : fs.ids.slice(fs.index, fs.index + 1);
    if (!ids.length) throw new ScriptError(ERROR.recordMissing, 'No record to copy');
    const fields = this.tableFields(info);
    const keep = fs.index;
    try {
      return ids.map((id) => {
        fs.index = fs.ids.indexOf(id);
        return info.fields.map((x) => {
          const reps = fields.find((y) => y.name === x.name)?.options?.repetitions ?? 1;
          const values: string[] = [];
          for (let r = 1; r <= reps; r++) {
            const v = this.readField(win, { occurrence: info.occurrence, field: x.name, repetition: r }) ?? text('');
            values.push(asText(v, win.store.dateOrder).replace(/\t/g, ' ').replace(/\r\n|[\r\n]/g, '\v'));
          }
          while (values.length > 1 && values[values.length - 1] === '') values.pop();
          return values.join(sep);
        }).join('\t');
      }).join('\r');
    } finally {
      fs.index = keep;
    }
  }

  /**
   * Find Matching Records: records whose field matches the current record's
   * value exactly (an empty value finds empty fields). Replace finds in the
   * whole table, Constrain within the found set, Extend adds to it.
   */
  private findMatching(f: Frame, p: StepParams): void {
    const win = this.current;
    const target = p.field ?? this.activeTarget(win);
    if (!target) throw new ScriptError(ERROR.fieldMissing, 'Find Matching Records names no field and no field is active');
    win.mode = 'browse';
    win.preview = false;
    const { info, field } = this.resolveTarget(f, target);
    if (this.currentId(win) === undefined) throw new ScriptError(ERROR.recordMissing, 'No current record');
    const value = asText(this.readField(win, { occurrence: info.occurrence, field: field.name, repetition: target.repetition ?? 1 }) ?? text(''), win.store.dateOrder);
    const name = info === win.layout ? field.name : `${info.occurrence}::${field.name}`;
    // "==" matches the whole field, the rest of the text as it is.
    const criteria = value === '' ? '=' : `==${value}`;
    const mode = p.findMode ?? 'replace';
    this.performFind(f, { restore: false }, mode === 'constrain' ? 126 : mode === 'extend' ? 127 : 28, [{ criteria: { [name]: criteria }, omit: false }]);
  }

  /**
   * Add Account: a FileMaker file account with a password and a privilege set
   * (not Full Access, which only a person can give). The script needs full
   * access, as in FileMaker. A name the file already has sets error 3 (the help
   * page names no code for it).
   */
  private addAccount(f: Frame, p: StepParams): void {
    this.opts.beforeFile?.(f.store);
    if (this.privileges && !this.privileges.in(f.store).full) throw new ScriptError(ERROR.privileges, 'Adding accounts needs full access (or a script set to run with full access privileges)');
    const store = f.store;
    const name = asText(this.eval(f, p.accountName ?? '""')).trim();
    if (!name) throw new ScriptError(ERROR.unavailable, 'Add Account needs an account name');
    if (store.accounts().some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new ScriptError(ERROR.unavailable, `The file already has an account "${name}"`);
    const set = p.privilegeSet?.name;
    if (!set) throw new ScriptError(ERROR.unavailable, 'Add Account needs a privilege set');
    const definition = store.privilegeSet(set);
    if (!definition) throw new ScriptError(ERROR.unavailable, `No privilege set "${set}"`);
    if (isFullAccess(definition)) throw new ScriptError(ERROR.unavailable, 'Add Account can\'t give the Full Access privilege set');
    store.createAccount(name, asText(this.eval(f, p.password ?? '""')), definition.name, {
      inactive: p.accountStatus === 'inactive', mustChange: p.expirePassword === true,
    });
  }

  /** Change Password: the running account's own; the old password must be right (error 212 otherwise). */
  private changePassword(f: Frame, p: StepParams): void {
    this.opts.beforeFile?.(f.store);
    const account = this.opts.account;
    const own = account === undefined ? undefined : f.store.accounts().find((a) => a.name.toLowerCase() === account.toLowerCase());
    if (!own || own.external || /^\[guest\]$/i.test(own.name)) throw new ScriptError(ERROR.unavailable, 'Change Password works for accounts with a password in this file');
    if (p.oldPassword === undefined || p.password === undefined) throw new ScriptError(ERROR.unavailable, 'Change Password asks a person for the passwords, and nobody can here');
    f.store.changePassword(own.name, asText(this.eval(f, p.oldPassword)), asText(this.eval(f, p.password)), 'script');
  }

  /**
   * Set Error Logging: a line for each step error, tab-separated as FileMaker
   * writes it (timestamp, session, file, account, script [index], step [line],
   * error code, custom debug info), appended to ScriptErrors.log in the
   * documents folder.
   */
  private logError(frame: Frame, pc: number, step: ScriptStep, error: number): void {
    const log = this.errorLogging!;
    if (frame.store !== log.store || !this.opts.documents) return;
    try { this.opts.beforeFile?.(frame.store); } catch (e) { rethrowExecutionRefusal(e); return; }
    // The debug info can't itself log or change the step's error.
    this.errorLogging = undefined;
    const calcError = this.calcError;
    let info = '';
    try {
      if (log.info !== undefined) info = asText(this.eval(frame, log.info), frame.store.dateOrder);
    } finally {
      this.calcError = calcError;
      this.errorLogging = log;
    }
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    const d = this.opts.now?.() ?? new Date();
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    const index = frame.store.schema.scripts.findIndex((x) => x.id === frame.script.id) + 1;
    const clean = (x: string) => x.replace(/[\t\r\n]+/g, ' ');
    const line = [stamp, this.sessionNumber, frame.store.name, this.opts.account ?? '', `${frame.script.name} [${index}]`, `${step.name} [${pc + 1}]`, String(error), this.diagnostics.value(info, undefined, this.diagnostics.line(step) !== (step.line ?? step.name ?? `Step ${step.stepId}`) || (log.info !== undefined && this.diagnostics.sensitiveExpression(log.info)) || this.hiddenSource(frame.store, frame.script))].map(clean).join('\t');
    mkdirSync(this.opts.documents, { recursive: true });
    appendFileSync(join(this.opts.documents, 'ScriptErrors.log'), line + '\n');
  }

  /**
   * Save Records as JSONL: one line per record of the found set, with a
   * messages array as for fine-tuning a model. With "Format for fine-tuning"
   * the prompts are formulas; without it the completion field is the
   * assistant's answer and the user's message lists the other fields as
   * Field=value. Records with an empty completion are left out.
   */
  private saveJsonl(f: Frame, p: StepParams): void {
    const win = this.current;
    this.opts.beforeFile?.(win.store);
    if (win.mode !== 'browse') throw new ScriptError(ERROR.unavailable, 'Save Records as JSONL works in Browse mode');
    if (this.privileges && !this.privileges.in(this.current.store).canExport) throw new ScriptError(ERROR.privileges, 'Saving records as JSONL needs the "export" privilege (or a script set to run with full access privileges)');
    const info = this.layoutOf(win);
    this.commit(win);
    const { path } = this.filePath(f, p, 'Save Records as JSONL');
    if (p.createFolders) mkdirSync(dirname(path), { recursive: true });
    else if (!existsSync(dirname(path))) {
      if (dirname(path) !== this.opts.documents) throw new ScriptError(ERROR.missingFile, 'The folder is missing (Create folders is off)');
      mkdirSync(dirname(path), { recursive: true });
    }
    const fields = this.tableFields(info).filter((x) => x.kind !== 'summary' && x.type !== 'container');
    const completion = p.field?.field.name;
    if (!p.jsonl?.fineTuning && !completion) throw new ScriptError(ERROR.fieldMissing, 'Save Records as JSONL needs a completion field');
    const fs = this.foundSet(win);
    const lines: string[] = [];
    const keep = fs.index;
    const value = (name: string): string | number => {
      const v = this.readField(win, { occurrence: info.occurrence, field: name, repetition: 1 }) ?? text('');
      return v.type === 'number' && v.value !== null && Number.isFinite(Number(v.value)) ? Number(v.value) : asText(v, win.store.dateOrder);
    };
    try {
      for (let i = 0; i < fs.ids.length; i++) {
        fs.index = i;
        this.poll(f);
        const messages: { role: string; content: string }[] = [];
        if (p.jsonl?.fineTuning) {
          const system = p.jsonl.system !== undefined ? asText(this.eval(f, p.jsonl.system), win.store.dateOrder) : '';
          if (system) messages.push({ role: 'system', content: system });
          messages.push({ role: 'user', content: asText(this.eval(f, p.jsonl.user ?? '""'), win.store.dateOrder) });
          messages.push({ role: 'assistant', content: asText(this.eval(f, p.jsonl.assistant ?? '""'), win.store.dateOrder) });
        } else {
          const answer = String(value(completion!));
          if (answer === '') continue;
          messages.push({ role: 'system', content: 'You are a helpful assistant.' });
          messages.push({ role: 'user', content: fields.filter((x) => x.name !== completion).map((x) => `${x.name}=${value(x.name)}`).join(', ') });
          messages.push({ role: 'assistant', content: answer });
        }
        lines.push(JSON.stringify({ messages }));
      }
    } finally {
      fs.index = keep;
    }
    writeFileSync(path, lines.map((l) => l + '\n').join(''));
  }

  /**
   * Go to List of Records: a layout (in this or a new window) showing the
   * records with the given IDs, in that order. IDs may be a list ("1 5
   * 21-23"), a JSON array of numbers or strings, or of objects with recordId.
   * IDs that aren't there are skipped; none found is error 401.
   */
  private goToList(f: Frame, p: StepParams): void {
    const raw = asText(this.eval(f, p.calculation ?? '""')).trim();
    const items: string[] = [];
    let json: unknown;
    try {
      json = raw.startsWith('[') ? JSON.parse(raw) : undefined;
    } catch {
      throw new ScriptError(1708, 'The list of record IDs is not valid JSON');
    }
    if (Array.isArray(json)) {
      for (const x of json) items.push(x && typeof x === 'object' ? String((x as { recordId?: unknown }).recordId ?? '') : String(x));
    } else items.push(...raw.split(/[\s,;¶\u001d]+/));
    const ids: number[] = [];
    for (const item of items.map((x) => x.trim()).filter(Boolean)) {
      const range = /^(\d+)\s*-\s*(\d+)$/.exec(item);
      if (range) {
        const [a, b] = [Number(range[1]), Number(range[2])];
        for (let n = a; n <= b && n - a < 100_000; n++) ids.push(n);
      } else if (/^\d+$/.test(item)) ids.push(Number(item));
    }
    let win = this.current;
    if (p.newWindow) win = this.newWindow(f, win, p);
    if (p.layout || p.layoutDestination) {
      if (p.layoutDestination) this.goToLayoutStep(f, p);
      else this.goToLayout(win, p.layout!.name);
    }
    const info = this.layoutOf(win);
    const have = new Set(info.owner.findIds(info, this.reading));
    const seen = new Set<number>();
    const found = ids.filter((x) => have.has(x) && !seen.has(x) && seen.add(x));
    win.mode = 'browse';
    this.setFound(win, found);
    if (!found.length) throw new ScriptError(ERROR.noRecords, 'None of the record IDs is in the table');
  }

  // --- records ---------------------------------------------------------------

  /** Store write options: auto-enter stamps record the script's account. */
  private get write(): { account?: string; privileges?: Privileges; skipEntryValidation?: boolean; performAutoEnter?: boolean } {
    return { account: this.opts.account, privileges: this.privileges, ...this.txWrite };
  }

  /** Open Transaction's options, for the writes made inside the transaction. */
  private get txWrite(): { skipEntryValidation?: true; performAutoEnter?: false } {
    const tx = this.tx?.window === this.current ? this.tx : undefined;
    return { ...(tx?.skipValidation ? { skipEntryValidation: true } : {}), ...(tx?.skipAutoEnter ? { performAutoEnter: false } : {}) };
  }

  private limitPending(win: Window, info: LayoutInfo): void {
    const p = this.privileges;
    // Kept when either the table's file or the layout's own file limits the account (its layout may be view only).
    if (p && (!p.in(info.owner).full || !p.in(this.via(info)).full)) win.pendingPrivileges = p === this.opts.privileges ? p : win.pendingPrivileges ?? p;
  }

  private elevated?: { account: Privileges; store: Store; privileges: Privileges };

  /** The privileges the running script works within: a full account still carries other files' limits. */
  private get privileges(): Privileges | undefined {
    const p = this.opts.privileges;
    const f = this.frame;
    if (!p || !f?.script.fullAccess) return p;
    if (this.elevated?.account === p && this.elevated.store === f.store) return this.elevated.privileges;
    // Elevation belongs to this script's file. Other files retain the account's rules, and a token always limits it.
    const full = f.store.privilegeSets().find(isFullAccess)!;
    const elevated = new Privileges(p.account, full, f.store, (file) => p.in(file)).withVia(p.via);
    const privileges = p.ceiling ? p.ceiling(elevated) : elevated;
    this.elevated = { account: p, store: f.store, privileges };
    return privileges;
  }

  /**
   * Delete Account, Reset Account Password, Enable Account: change an account
   * of the file the script belongs to. As in FileMaker, the script needs full
   * access (error 9 otherwise) and a missing account sets error 213 (FileMaker 14's "account does not exist").
   */
  private manageAccount(f: Frame, stepId: number, p: StepParams): void {
    this.opts.beforeFile?.(f.store);
    if (this.privileges && !this.privileges.in(f.store).full) throw new ScriptError(ERROR.privileges, 'Managing accounts needs full access (or a script set to run with full access privileges)');
    const store = f.store;
    const name = asText(this.eval(f, p.accountName ?? '""'));
    const account = store.accounts().find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (!account) throw new ScriptError(ERROR.accountMissing, `No account "${name}"`);
    if (stepId === 135) {
      store.deleteAccount(account.name);
    } else if (stepId === 136) {
      if (account.external) throw new ScriptError(ERROR.accountMissing, `"${account.name}" signs in through an identity provider and has no password here`);
      const password = asText(this.eval(f, p.password ?? '""'));
      store.setPassword(account.name, password, undefined, { mustChange: p.expirePassword === true });
    } else {
      store.setAccountActive(account.name, p.activate !== false);
    }
  }

  /**
   * Re-Login: signs the run in as another account of this file, whose
   * privileges apply from the next step. A wrong name or password sets error
   * 212 and keeps the current account; a dialog is never shown on the server.
   */
  /**
   * Re-Login: with a stored account name and password, or, with someone to
   * answer (the dialog option), as they type them into an account and
   * password dialog. Cancel is error 1.
   */
  private async reLogin(f: Frame, p: StepParams): Promise<void> {
    this.opts.beforeFile?.(f.store);
    let name: string;
    let password: string;
    if (p.accountName !== undefined) {
      name = asText(this.eval(f, p.accountName));
      password = asText(this.eval(f, p.password ?? '""'));
    } else {
      if (!this.opts.dialog) throw new ScriptError(ERROR.unavailable, 'Re-Login asks a person for an account, and nobody can on the server');
      const left = this.deadline - Date.now();
      this.hold();
      let answer: { button: number; inputs?: string[] } | undefined;
      try {
        answer = await this.opts.dialog({
          script: f.script.name, title: `Re-Login to "${f.store.name}"`, message: 'Type an account name and password.',
          buttons: ['OK', 'Cancel'],
          inputs: [{ label: 'Account Name', value: this.opts.account ?? '', password: false }, { label: 'Password', value: '', password: true }],
          actions: this.actions.slice(), state: this.windowState(),
        });
      } finally {
        this.resumeAfter(left);
      }
      if (!answer || answer.button !== 1) throw new ScriptError(1, 'Re-Login was canceled'); // FileMaker's "user canceled action"
      [name = '', password = ''] = answer.inputs ?? [];
    }
    if (!name || !f.store.verify(name, password, 'script')) throw new ScriptError(ERROR.wrongPassword, 'Account name or password is wrong');
    const account = f.store.accounts().find((a) => a.name.toLowerCase() === name.toLowerCase())?.name ?? name;
    const authenticated = f.store.privileges(account);
    const ceiling = this.opts.privileges?.ceiling;
    this.identityStore = f.store.name === this.executionStore?.name ? this.executionStore : f.store;
    this.identityVia = undefined;
    this.opts = { ...this.opts, account, privileges: ceiling ? ceiling(authenticated) : authenticated };
    // Records read as the account before are kept for that account only.
    this.readCache.clear();
  }

  /** Store read options under the running script's privileges. */
  private get reading(): { privileges?: Privileges } {
    const privileges = this.privileges;
    return privileges ? { privileges } : {};
  }

  /**
   * The file a step names, in the documents folder. FileMaker tries each path in
   * turn; here only a path's file name counts, so nothing outside the folder is read.
   */
  private documentFile(f: Frame, p: StepParams, step: string): { dir: string; name: string } {
    const dir = this.opts.documents;
    if (!dir) throw new ScriptError(ERROR.missingFile, `${step} reads files only from the server's documents folder, and none is set`);
    const name = (p.filePaths ?? []).map((x) => (x.startsWith('$') ? asText(this.getVariable(f, x, 1) ?? text('')) : x))
      .map((x) => x.split(/[/:\\]/).pop() ?? '')
      .find((x) => {
        if (!x || x.startsWith('.')) return false;
        const path = safeExistingPath(dir, x);
        return !!path && statSync(path).isFile();
      });
    if (!name) throw new ScriptError(ERROR.missingFile, `No such file in the documents folder (${(p.filePaths ?? []).join(', ') || 'the step names none'})`);
    return { dir, name };
  }

  /**
   * A path a file step names, as a file on the server: in the documents folder
   * (or this run's temporary folder), and never outside it. A path with
   * Get ( DocumentsPath ) or Get ( TemporaryPath ) keeps its subfolders; any
   * other path counts only by its file name, as Import Records reads it.
   * Entries may be variables ("$path"), and the first that names a file is
   * used; `existing` prefers one that exists.
   */
  private filePath(f: Frame, p: StepParams, step: string, existing = false): { path: string; shown: string } {
    if (!this.opts.documents) throw new ScriptError(ERROR.missingFile, `${step} works only in the server's documents folder, and none is set`);
    const entries = (p.filePaths ?? []).flatMap((x) => {
      const v = x.replace(/\$\$?[\p{L}\p{N}_.]+/gu, (name) => asText(this.getVariable(f, name, 1) ?? text('')));
      return v.split(/\r\n|[\r\n]/).map((y) => y.trim()).filter(Boolean);
    });
    const mapped = entries.map((raw) => {
      const path = this.sandboxPath(raw);
      if (!path && this.documentsLink(raw)) throw new ScriptError(ERROR.missingFile, `${raw} is a link`);
      return path && { path, shown: raw };
    }).filter((x): x is { path: string; shown: string } => !!x);
    const found = (existing && mapped.find((x) => existsSync(x.path))) || mapped[0];
    if (!found) throw new ScriptError(ERROR.missingFile, `${step} names no file in the documents folder (${(p.filePaths ?? []).join(', ') || 'none given'})`);
    return found;
  }

  /**
   * Install OnTimer Script, as the action a window acts on: the script (of
   * this file, or of another hosted file with timerFile naming its data
   * source) and interval in seconds, or interval 0 to stop the window's
   * timer when the step names no script or no interval above 0. The
   * parameter goes as its formula: FileMaker works it out each time the timer
   * runs the script.
   */
  private onTimer(f: Frame, p: StepParams): Record<string, unknown> {
    const interval = p.calculation === undefined ? 0 : asNumber(this.eval(f, p.calculation));
    if (!p.script || !(interval > 0)) return { interval: 0 };
    if (p.script.file) {
      // A script of another hosted file: the timer runs it as Perform Script would, so it must be there now.
      const { script } = this.listedScript(f, p);
      return { interval, timerScriptId: script.id, timerScript: script.name, timerFile: p.script.file, ...(p.parameter !== undefined ? { parameter: p.parameter } : {}) };
    }
    const target = f.store.schema.scripts.find((x) => x.id === p.script!.id) ?? f.store.schema.scripts.find((x) => x.name === p.script!.name);
    if (!target) throw new ScriptError(ERROR.scriptMissing, `Script "${p.script.name}" is missing`);
    return { interval, timerScriptId: target.id, timerScript: target.name, ...(p.parameter !== undefined ? { parameter: p.parameter } : {}) };
  }

  /**
   * A path as a file in the documents folder or this run's temporary folder,
   * never outside them: Get ( DocumentsPath ) and Get ( TemporaryPath ) keep
   * their subfolders, and any other path counts only by its file name.
   */
  private sandboxPath(raw: string): string | undefined {
    if (!this.opts.documents) return undefined;
    const s = raw.replace(/^(?:file|filemac|filewin|image|imagemac|imagewin|movie|moviemac|moviewin)?:/i, '').replace(/\\/g, '/');
    const temp = s.indexOf(TEMPORARY);
    const docs = s.indexOf(DOCUMENTS);
    let base = this.opts.documents;
    let rel: string;
    if (temp >= 0) {
      this.tempDir ??= mkdtempSync(join(tmpdir(), 'tabularius-script-'));
      base = this.tempDir;
      rel = s.slice(temp + TEMPORARY.length);
    } else if (docs >= 0) rel = s.slice(docs + DOCUMENTS.length);
    else rel = s.split('/').pop() ?? '';
    const parts = rel.split('/');
    if (!rel || parts.some((x) => !x || x.startsWith('.'))) return undefined;
    const path = join(base, ...parts);
    // A link inside the folder that points outside it is not a way out: where the path (or its nearest existing parent) really is must be under the folder.
    try {
      // The real place of a path whose tail may not exist yet: its nearest existing parent, resolved, plus the rest.
      const resolve = (target: string): string => {
        for (let at = target; ; at = dirname(at)) {
          // lstat: a link that points nowhere still counts as there, and realpath then refuses it.
          const there = (() => { try { lstatSync(at); return true; } catch { return false; } })();
          if (there || at === dirname(at)) return join(realpathSync(at), relative(at, target));
        }
      };
      const inside = relative(resolve(base), resolve(path));
      if (inside.startsWith('..') || isAbsolute(inside)) return undefined;
    } catch {
      return undefined;
    }
    return path;
  }

  /** Whether an otherwise refused Documents path crosses a link. */
  private documentsLink(raw: string): boolean {
    if (!this.opts.documents) return false;
    const s = raw.replace(/^(?:file|filemac|filewin|image|imagemac|imagewin|movie|moviemac|moviewin)?:/i, '').replace(/\\/g, '/');
    if (s.includes(TEMPORARY)) return false;
    const docs = s.indexOf(DOCUMENTS);
    const rel = docs >= 0 ? s.slice(docs + DOCUMENTS.length) : s.split('/').pop() ?? '';
    const parts = rel.split('/');
    if (!rel || parts.some((x) => !x || x.startsWith('.'))) return false;
    let at = this.opts.documents;
    for (const part of parts) {
      at = join(at, part);
      try {
        if (lstatSync(at).isSymbolicLink()) return true;
      } catch { return false; }
    }
    return false;
  }

  /** Text files for plug-in functions (BE_FileReadText and friends), in the same folders as the file steps. */
  private readonly pluginFiles: PluginFiles = {
    read: (raw) => {
      const path = this.sandboxPath(raw);
      return path && existsSync(path) && statSync(path).isFile() ? new Uint8Array(readFileSync(path)) : undefined;
    },
    write: (raw, content, append) => {
      const path = this.sandboxPath(raw);
      if (!path || !existsSync(dirname(path)) || (existsSync(path) && !statSync(path).isFile())) return false;
      if (append) appendFileSync(path, content);
      else writeFileSync(path, content);
      return true;
    },
    size: (raw) => {
      const path = this.sandboxPath(raw);
      return path && existsSync(path) ? statSync(path).size : undefined;
    },
    makeFolder: (raw) => this.fsCode(() => mkdirSync(this.sandboxed(raw.replace(/[/\\]+$/, '')), { recursive: true })),
    remove: (raw) => this.fsCode(() => {
      const path = this.sandboxed(raw);
      if (!existsSync(path)) throw Object.assign(new Error('missing'), { errno: -2 });
      rmSync(path, { recursive: true });
    }),
    move: (from, to, overwrite) => this.fsCode(() => {
      const target = this.sandboxed(to);
      if (!overwrite && existsSync(target)) throw Object.assign(new Error('exists'), { errno: -17 });
      renameSync(this.sandboxed(from), target);
    }),
    copy: (from, to, overwrite) => this.fsCode(() => cpSync(this.sandboxed(from), this.sandboxed(to), { recursive: true, force: overwrite, errorOnExist: !overwrite })),
    list: (raw, recurse) => {
      const path = this.sandboxPath(raw.replace(/[/\\]+$/, ''));
      if (!path || !existsSync(path) || !statSync(path).isDirectory()) return undefined;
      const out: { path: string; folder: boolean }[] = [];
      const walk = (dir: string, prefix: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
          out.push({ path: prefix + e.name, folder: e.isDirectory() });
          if (recurse && e.isDirectory()) walk(join(dir, e.name), prefix + e.name + '/');
        }
      };
      walk(path, '');
      return out;
    },
    modified: (raw) => {
      const path = this.sandboxPath(raw);
      return path && existsSync(path) ? statSync(path).mtime : undefined;
    },
  };

  /** A sandboxed path, or an error that reads as a missing file. */
  private sandboxed(raw: string): string {
    const path = this.sandboxPath(raw);
    if (!path) throw Object.assign(new Error('outside the allowed folders'), { errno: -2 });
    return path;
  }

  /** 0 when the file operation works, else its system error number. */
  private fsCode(op: () => void): number {
    try {
      op();
      return 0;
    } catch (e) {
      rethrowExecutionRefusal(e);
      const errno = (e as { errno?: number }).errno;
      const code = (e as { code?: string }).code;
      return errno ? Math.abs(errno) : code === 'ERR_FS_CP_EEXIST' ? 17 : 5;
    }
  }

  /** The value of a step's field or variable, with a container field's file data. */
  private sourceValue(f: Frame, p: StepParams): Value {
    if (p.variable && !p.field) return this.getVariable(f, p.variable, 1) ?? text('');
    if (!p.field) throw new ScriptError(ERROR.fieldMissing, 'The step names no field or variable');
    const { info, field, win } = this.resolveTarget(f, p.field);
    const rep = p.field.repetition ?? 1;
    if (field.type === 'container' && !field.options?.global) {
      if (this.privileges?.in(info.owner).field(info.table, field.name) === 'none') return text('');
      const id = info === win.layout ? this.currentId(win) : this.relatedRecord(win, info.occurrence);
      if (id !== undefined && this.privileges) this.via(info).get(info, id, 'iso', undefined, this.privileges, { fields: [field.name] });
      const cid = id === undefined ? undefined : info.owner.containerId(info, id, field.name, rep);
      const c = cid === undefined ? undefined : info.owner.container(cid);
      return c ? { type: 'container', value: c.filename ?? 'Untitled', data: c.data } : text('');
    }
    return this.readField(win, { occurrence: info.occurrence, field: field.name, repetition: rep }) ?? text('');
  }

  private storeResult(f: Frame, p: StepParams, value: Value): void {
    if (p.variable && !p.field) this.setVariable(f, p.variable, 1, value);
    else if (p.field) this.setField(f, p, value);
  }

  /** Get File Exists, Get File Size, and the data file steps (FileMaker 18): files in the documents folder only. */
  private dataFileStep(f: Frame, stepId: number, p: StepParams): void {
    this.opts.beforeFile?.(f.store);
    const open = (): [number, DataFile] => {
      const id = Math.trunc(asNumber(this.eval(f, p.fileId ?? '')));
      const d = this.dataFiles.get(id);
      if (!d) throw new ScriptError(ERROR.missingFile, `No data file is open with file ID ${id}`);
      this.opts.beforeFile?.(d.owner);
      return [id, d];
    };
    const isOpen = (path: string) => [...this.dataFiles.values()].some((d) => d.path === path);
    switch (stepId) {
      case 188: { // Get File Exists
        let exists = false;
        try {
          const { path } = this.filePath(f, p, 'Get File Exists', true);
          exists = existsSync(path);
        } catch (e) {
          rethrowExecutionRefusal(e);
          if (!(e instanceof ScriptError)) throw e;
        }
        return this.storeResult(f, p, num(exists ? 1 : 0));
      }
      case 189: { // Get File Size
        const { path } = this.filePath(f, p, 'Get File Size', true);
        if (!existsSync(path) || !statSync(path).isFile()) throw new ScriptError(ERROR.missingFile, 'The file is missing');
        return this.storeResult(f, p, num(statSync(path).size));
      }
      case 190: { // Create Data File: replaces a file that exists
        const { path } = this.filePath(f, p, 'Create Data File');
        if (isOpen(path)) throw new ScriptError(ERROR.fileInUse, 'The file is open');
        if (p.createFolders) mkdirSync(dirname(path), { recursive: true });
        else if (!existsSync(dirname(path))) {
          if (dirname(path) !== this.opts.documents) throw new ScriptError(ERROR.missingFile, 'The folder is missing (Create folders is off)');
          mkdirSync(dirname(path), { recursive: true });
        }
        writeFileSync(path, new Uint8Array(0));
        return;
      }
      case 191: { // Open Data File
        const { path, shown } = this.filePath(f, p, 'Open Data File', true);
        if (!existsSync(path) || !statSync(path).isFile()) throw new ScriptError(ERROR.missingFile, 'The file is missing');
        if (isOpen(path)) throw new ScriptError(ERROR.fileInUse, 'The file is already open');
        if (this.dataFiles.size >= MAX_DATA_FILES) throw new ScriptError(2, `At most ${MAX_DATA_FILES} data files can be open`);
        const id = this.nextFileId++;
        this.dataFiles.set(id, { owner: f.store, fd: openSync(path, 'r+'), path, shown, position: 0 });
        return this.storeResult(f, p, num(id));
      }
      case 192: { // Write to Data File: overwrites at the position
        const [, d] = open();
        const v = this.sourceValue(f, p);
        let data: Uint8Array = v.type === 'container' && v.data ? v.data : encodeText(asText(v, this.current.store.dateOrder), p.encoding === 'utf-8' ? 'utf-8' : 'utf-16');
        if (p.appendLineFeed) data = concatBytes(data, encodeText('\n', p.encoding === 'utf-8' ? 'utf-8' : 'utf-16'));
        writeSync(d.fd, data, 0, data.length, d.position);
        d.position += data.length;
        return;
      }
      case 193: { // Read from Data File
        const [, d] = open();
        const size = fstatSync(d.fd).size;
        if (d.position >= size) throw new ScriptError(ERROR.endOfFile, 'The end of the file was reached');
        const amount = p.amount === undefined || p.amount === '' ? undefined : Math.max(0, Math.trunc(asNumber(this.eval(f, p.amount))));
        const unit = (p.encoding ?? 'utf-16') === 'utf-16' ? 2 : 1;
        const length = Math.min(size - d.position, amount === undefined ? Infinity : amount * unit, 64 * 1024 * 1024);
        const buf = new Uint8Array(length);
        const read = readSync(d.fd, buf, 0, length, d.position);
        d.position += read;
        const bytes = buf.subarray(0, read);
        const value: Value = p.encoding === 'bytes'
          ? { type: 'container', value: d.path.split(/[/\\]/).pop() ?? 'file', data: bytes }
          : text(new TextDecoder(p.encoding === 'utf-8' ? 'utf-8' : 'utf-16le').decode(bytes));
        return this.storeResult(f, p, value);
      }
      case 194: { // Get Data File Position
        const [, d] = open();
        return this.storeResult(f, p, num(d.position));
      }
      case 195: { // Set Data File Position
        const [, d] = open();
        d.position = Math.max(0, Math.trunc(asNumber(this.eval(f, p.calculation ?? '0'))));
        return;
      }
      case 196: { // Close Data File
        const [id, d] = open();
        closeSync(d.fd);
        this.dataFiles.delete(id);
        return;
      }
      case 197: { // Delete File
        const { path } = this.filePath(f, p, 'Delete File', true);
        if (!existsSync(path) || !statSync(path).isFile()) throw new ScriptError(ERROR.missingFile, 'The file is missing');
        if (isOpen(path)) throw new ScriptError(ERROR.fileInUse, 'The file is open');
        unlinkSync(path);
        return;
      }
      case 199: { // Rename File: a new name in the same folder
        const { path } = this.filePath(f, p, 'Rename File', true);
        if (!existsSync(path) || !statSync(path).isFile()) throw new ScriptError(ERROR.missingFile, 'The file is missing');
        if (isOpen(path)) throw new ScriptError(ERROR.fileInUse, 'The file is open');
        const name = asText(this.eval(f, p.newName ?? '')).trim();
        if (!name || /[/\\:]/.test(name) || name.startsWith('.')) throw new ScriptError(ERROR.missingFile, `"${name}" is not a file name`);
        const to = join(dirname(path), name);
        if (existsSync(to)) throw new ScriptError(ERROR.fileInUse, `A file named "${name}" exists`);
        renameSync(path, to);
        return;
      }
    }
  }

  /**
   * Export Records: the found set, as comma- or tab-separated text or a merge
   * file, Excel, FileMaker XML (FMPXMLRESULT) or an HTML table, into the documents folder. Other formats set error 3.
   */
  private async exportRecords(f: Frame, p: StepParams): Promise<void> {
    const win = this.current;
    this.opts.beforeFile?.(win.store);
    if (win.mode !== 'browse') throw new ScriptError(ERROR.unavailable, 'Export Records works in Browse mode');
    if (this.privileges && !this.privileges.in(this.current.store).canExport) throw new ScriptError(ERROR.privileges, 'Exporting records needs the "export" privilege (or a script set to run with full access privileges)');
    const info = this.layoutOf(win);
    this.commit(win);
    const fallback = ({ XLXE: 'Untitled.xlsx', TABS: 'Untitled.tab', MRGE: 'Untitled.mer', XML: 'Untitled.xml' } as Record<string, string>)[p.exportFormat ?? ''] ?? 'Untitled.csv';
    const target = this.outputPath(f, p, p.exportFormat === 'XLXE' ? 'Save Records as Excel' : 'Export Records', fallback);
    const path = `${target}.${randomUUID()}.partial`;
    const complete = (step: string) => {
      this.canceled(f.script.name);
      renameSync(path, target);
      this.deliver(f, step, target);
    };
    try {
      const ext = target.split('.').pop()?.toLowerCase();
      // FileMaker XML and HTML Table go by the file's name (.xml, .htm or .html): their format codes aren't known from a sample.
      // XML options (a grammar or a style sheet) make it an XML export whatever the file is called.
      const xmlOptions = p.xslt !== undefined || p.xmlGrammar !== undefined;
      if (xmlOptions && p.exportFormat === 'XLXE') throw new ScriptError(ERROR.unavailable, 'An XML grammar or XSLT style sheet applies to an XML export, not an Excel workbook');
      const byName = xmlOptions || ext === 'xml' ? 'XML' : ext === 'htm' || ext === 'html' ? 'HTML' : undefined;
      const format = byName ?? p.exportFormat ?? (ext === 'csv' ? 'COMS' : ext === 'tab' || ext === 'txt' ? 'TABS' : ext === 'mer' ? 'MRGE' : ext === 'xlsx' ? 'XLXE' : undefined);
      if (!format || !['COMS', 'TABS', 'MRGE', 'XLXE', 'XML', 'HTML'].includes(format)) throw new ScriptError(ERROR.unavailable, `Exporting to ${format ?? `.${ext}`} files is not available; use comma- or tab-separated values, merge, Excel, FileMaker XML (.xml) or HTML (.html)`);
      const refs: CalcFieldRef[] = p.exportFields?.length
        ? p.exportFields.map((x) => ({ occurrence: x.tableOccurrence.name, field: x.field.name, repetition: x.repetition ?? 1 }))
        : info.fields.map((x) => ({ occurrence: info.occurrence, field: x.name, repetition: 1 }));
      if (p.createFolders) mkdirSync(dirname(path), { recursive: true });
      else if (!existsSync(dirname(path))) {
        if (dirname(path) !== this.opts.documents) throw new ScriptError(ERROR.missingFile, 'The folder is missing (Create folders is off)');
        mkdirSync(dirname(path), { recursive: true });
      }
      // A repeating field named whole (not one repetition of it) exports every repetition, to the last one with a value.
      const named = p.exportFields?.length ? p.exportFields.map((x) => x.repetition === undefined) : refs.map(() => true);
      const repetitions = refs.map((r, i) => {
        if (!named[i]) return 1;
        try {
          return this.resolveTarget(f, { tableOccurrence: { id: 0, name: r.occurrence ?? info.occurrence }, field: { id: 0, name: r.field } }).field.options?.repetitions ?? 1;
        } catch (e) {
          rethrowExecutionRefusal(e);
          return 1;
        }
      });
      const fs = this.foundSet(win);
      const index = fs.index;
      const records = function* (this: ScriptEngine): Generator<Value[][]> {
        try {
          for (let i = 0; i < fs.ids.length; i++) {
            fs.index = i;
            this.poll(f);
            yield refs.map((r, k) => {
              const values = [this.readField(win, r) ?? text('')];
              for (let n = 2; n <= repetitions[k]; n++) values.push(this.readField(win, { ...r, repetition: n }) ?? text(''));
              while (values.length > 1 && asText(values[values.length - 1]) === '') values.pop();
              return values;
            });
          }
        } finally {
          fs.index = index;
        }
      }.call(this);
      // Excel and HTML tables have one value to a cell: a repeating field gives its first.
      const rows = function* (): Generator<Value[]> {
        for (const record of records) yield record.map((values) => values[0]);
      }();
      if (format === 'XLXE') {
        // Numbers stay numbers, dates, times and timestamps are Excel's own cell types; other values are text as FileMaker shows them.
        if (fs.ids.length > 1_048_576) throw new ScriptError(ERROR.unavailable, 'Excel allows at most 1,048,576 rows; no file was written');
        const cells: XlsxOutCell[][] = [];
        for (const row of rows) {
          await this.checkpoint(f);
          cells.push(row.map((v): XlsxOutCell => (v.type === 'number' && v.value !== null ? Number(v.value)
          : v.type === 'date' || v.type === 'time' || v.type === 'timestamp' ? serialOf[v.type](v.value)
          : asText(v, win.store.dateOrder))));
        }
        let workbook: Uint8Array;
        try { workbook = xlsx(cells, info.table); }
        catch (e) {
          if (e instanceof SheetLimitError) throw new ScriptError(ERROR.unavailable, `${e.message}; no file was written`);
          throw e;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        this.canceled(f.script.name);
        writeFileSync(path, workbook);
        complete('Save Records as Excel');
        return;
      }
      const heading = (r: CalcFieldRef) => (r.occurrence === info.occurrence ? r.field : `${r.occurrence}::${r.field}`);
      if (format === 'XML') {
        // FMPXMLRESULT (the XML FileMaker's Import Records reads) or FMPDSORESULT: dates, times and timestamps as ISO text, containers by file name.
        const stylesheet = p.xslt === undefined ? undefined : this.documentFile(f, { ...p, filePaths: [p.xslt] }, 'Export Records');
        const sheet = stylesheet && readFileSync(join(stylesheet.dir, stylesheet.name), 'utf8');
        const fields: ExportField[] = refs.map((r, i) => {
          let type: ExportField['type'] = 'text';
          try {
            type = this.resolveTarget(f, { tableOccurrence: { id: 0, name: r.occurrence ?? info.occurrence }, field: { id: 0, name: r.field } }).field.type;
          } catch (e) { rethrowExecutionRefusal(e); /* a field that can't be found exports as text, as its value does */ }
          return { name: heading(r), type, ...(repetitions[i] > 1 ? { maxRepeat: repetitions[i] } : {}) };
        });
        if (p.xmlGrammar === 'FMPDSORESULT') {
          const bad = fields.find((x) => dsoElementName(x.name) === undefined);
          if (bad) throw new ScriptError(ERROR.xmlGrammar, `Field "${bad.name}" cannot be an FMPDSORESULT element (names must not start with a number or hold punctuation other than spaces and colons)`);
        }
        const out: ExportRow[] = [];
        // A repeating field's values are one DATA each.
        for (const record of records) {
          await this.checkpoint(f);
          out.push({
            recordId: fs.ids[fs.index], modId: 0,
            cells: record.map((values) => values.map((v) => v.type === 'date' || v.type === 'time' || v.type === 'timestamp' ? String(toStored(v, v.type) ?? '') : asText(v, win.store.dateOrder))),
          });
        }
        const grammar = p.xmlGrammar === 'FMPDSORESULT'
          ? fmpDsoResult(win.store.name, win.layoutName ?? '', fields.map((x) => ({ name: x.name, repeating: (x.maxRepeat ?? 1) > 1 })), out)
          : fmpXmlResult(win.store.name, fields, out);
        writeFileSync(path, sheet === undefined ? grammar : transformXml(grammar, sheet));
        complete('Export Records');
        return;
      }
      if (format === 'HTML') {
        const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r\n|[\r\n]/g, '<br>');
        const fd = openSync(path, 'w');
        try {
          const put = (t: string) => writeSync(fd, t);
          put(`<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${esc(info.table)}</title></head><body>\n<table border="1">\n<tr>${refs.map((r) => `<th>${esc(heading(r))}</th>`).join('')}</tr>\n`);
          for (const row of rows) {
            await this.checkpoint(f);
            put(`<tr>${row.map((v) => `<td>${esc(asText(v, win.store.dateOrder))}</td>`).join('')}</tr>\n`);
          }
          put('</table>\n</body></html>\n');
        } finally {
          closeSync(fd);
        }
        complete('Export Records');
        return;
      }
      const cell = (v: string, type?: string) => {
        const one = formulaGuard(v.replace(/\r\n|[\r\n]/g, '\v'), type); // returns in a field export as vertical tabs, as in FileMaker
        const quoted = `"${one.replace(/"/g, '""')}"`;
        // Tab-separated text is written bare; only a value that starts with a quote is quoted, so reading it back
        // does not take that quote for the start of a quoted value.
        return format === 'TABS' ? (one.startsWith('"') ? quoted : one.replace(/\t/g, ' ')) : quoted;
      };
      const sep = format === 'TABS' ? '\t' : ',';
      const encoding = p.encoding === 'utf-16' ? 'utf-16' : 'utf-8';
      // Written a record at a time, so a big found set never sits in memory.
      const fd = openSync(path, 'w');
      try {
        // UTF-16 text starts with a byte order mark, so a program that opens the file (this one's Import Records too) knows its byte order.
        if (encoding === 'utf-16') writeSync(fd, new Uint8Array([0xff, 0xfe]));
        const line = (l: string) => writeSync(fd, encodeText(l + '\r\n', encoding));
        if (format === 'MRGE') line(refs.map((r) => cell(heading(r), 'text')).join(sep));
        // Claris: "Values in repeating fields are separated by the group separator character."
        for (const record of records) {
          await this.checkpoint(f);
          line(record.map((values) => cell(values.map((v) => asText(v, win.store.dateOrder)).join(GROUP_SEPARATOR), values[0]?.type)).join(sep));
        }
      } finally {
        closeSync(fd);
      }
      complete('Export Records');
    } finally { rmSync(path, { force: true }); }
  }

  /**
   * The file an output step writes: in the documents folder, or with
   * `downloads` in this run's temporary folder under the name the step gives
   * (else `fallback`, as FileMaker's "Untitled.pdf"), to be sent on by deliver().
   */
  private outputPath(f: Frame, p: StepParams, step: string, fallback: string): string {
    this.opts.beforeFile?.(f.store);
    if (!this.opts.downloads) return this.filePath(f, p, step).path;
    const named = (p.filePaths ?? [])
      .map((x) => x.replace(/\$\$?[\p{L}\p{N}_.]+/gu, (name) => asText(this.getVariable(f, name, 1) ?? text(''))))
      .flatMap((x) => x.split(/\r\n|[\r\n]/))
      .map((x) => x.trim().replace(/\\/g, '/').split(/[/:]/).pop() ?? '')
      .find((x) => x && !x.startsWith('.'));
    this.tempDir ??= mkdtempSync(join(tmpdir(), 'tabularius-script-'));
    return join(this.tempDir, named ?? fallback);
  }

  /** With `downloads`: the file just written goes to the person as a client action, and leaves the server. */
  private deliver(f: Frame, step: string, path: string): void {
    if (!this.opts.downloads) return;
    try {
      if (statSync(path).size > MAX_DOWNLOAD) throw new ScriptError(ERROR.unavailable, `${step} made a file too big to download (over ${MAX_DOWNLOAD / 1024 / 1024} MB)`);
      this.actions.push({ step, script: f.script.name, download: basename(path), base64: readFileSync(path).toString('base64') });
    } finally {
      rmSync(path, { force: true });
    }
  }

  /** The file a PDF step writes, its folder made as the step allows. */
  /**
   * Save Records as Snapshot Link: an .fmpsl file naming the found set (or only the current record, with
   * Current record), layout and current record, as FileMaker writes it, for opening the same records again.
   */
  private snapshotLink(f: Frame, p: StepParams): void {
    const win = this.current;
    this.opts.beforeFile?.(win.store);
    if (win.layout) this.layoutOf(win);
    if (this.privileges && !this.privileges.in(this.current.store).canExport) throw new ScriptError(ERROR.privileges, 'Save Records as Snapshot Link needs the "export" privilege (or a script set to run with full access privileges)');
    const path = this.outputPath(f, p, 'Save Records as Snapshot Link', 'Untitled.fmpsl');
    if (!existsSync(dirname(path))) {
      if (!p.createFolders && dirname(path) !== this.opts.documents) throw new ScriptError(ERROR.missingFile, 'The folder is missing (Create folders is off)');
      mkdirSync(dirname(path), { recursive: true });
    }
    const fs: { ids: number[]; index: number; sort?: unknown } = win.layout ? this.foundSet(win) : { ids: [], index: 0 };
    const layout = win.store.schema.layouts.find((l) => l.name === win.layoutName);
    const table = win.layout ? win.store.schema.tables.find((t) => t.name === win.layout!.table) : undefined;
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const current = fs.ids[fs.index];
    // Current record: the link opens that record alone; Records being browsed (the default): the whole found set.
    const rows = p.pdfRecords === 'current' ? (current === undefined ? [] : [current]) : fs.ids;
    writeFileSync(path, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<FPSL>',
      '  <UIState>',
      `    <UniversalPathList>fmnet:/${esc(hostname())}/${esc(win.store.name)}.fmp12</UniversalPathList>`,
      `    <Rows type="nativeIDList" rowCount="${rows.length}" baseTableId="${table?.id ?? 0}">${rows.join(' ')}</Rows>`,
      `    <Layout id="${layout?.id ?? 0}"></Layout>`,
      // The view the window shows the layout in (what View As chose, else the layout's own).
      `    <View type="${win.layout ? this.viewOf(win) : 'form'}"></View>`,
      `    <SelectedRow type="nativeID" id="${current ?? 0}"></SelectedRow>`,
      '    <StatusToolbar visible="True"></StatusToolbar>',
      `    <Mode value="${win.mode === 'find' ? 'findMode' : win.preview ? 'previewMode' : 'browseMode'}"></Mode>`,
      `    <SortList Maintain="True" value="${fs.sort ? 'True' : 'False'}"></SortList>`,
      '  </UIState>',
      '</FPSL>',
      '',
    ].join('\n'));
    this.deliver(f, 'Save Records as Snapshot Link', path);
  }

  private pdfOutput(f: Frame, p: StepParams, step: string): string {
    const path = this.outputPath(f, p, step, 'Untitled.pdf');
    if (p.createFolders) mkdirSync(dirname(path), { recursive: true });
    else if (!existsSync(dirname(path))) {
      if (dirname(path) !== this.opts.documents) throw new ScriptError(ERROR.missingFile, 'The folder is missing (Create folders is off)');
      mkdirSync(dirname(path), { recursive: true });
    }
    return path;
  }

  /** The open PDF as one file: its base with the pages made since (a new PDF when it has no base), or undefined when it holds nothing. */
  private openPdfBytes(open: NonNullable<ScriptEngine['openPdf']>): Uint8Array | undefined {
    if (!open.pages.length) return open.base;
    const made = pdf(open.pages, open.title);
    if (!open.base) return made;
    const joined = pdfMerge([open.base, made]);
    if (!joined) throw new ScriptError(830, 'The open PDF could not be put together with the pages added to it');
    return joined;
  }

  /**
   * The PDF Open PDF and Append PDF name: the first of the files listed that is in the documents folder, or the
   * container field or variable. Claris's errors: 830 not found or not a PDF, 831 an encrypted PDF without its
   * password, 832 a PDF whose security settings stop it being changed. Encrypted PDFs are not decrypted here, so
   * one given its password is 832.
   */
  private pdfSource(f: Frame, p: StepParams, step: string): Uint8Array {
    let data: Uint8Array | undefined;
    if (p.field || p.variable) {
      let v: Value | undefined;
      if (p.variable) v = this.getVariable(f, p.variable, 1);
      else {
        const { info, win } = this.resolveTarget(f, p.field!);
        v = this.readField(win, { occurrence: info.occurrence, field: p.field!.field.name, repetition: p.field!.repetition ?? 1 });
      }
      data = v?.type === 'container' ? v.data : undefined;
      if (!data?.length) throw new ScriptError(830, `${step}: the source holds no PDF`);
    } else if (p.filePaths?.length) {
      let file: { dir: string; name: string };
      try {
        file = this.documentFile(f, p, step);
      } catch (e) {
        if (e instanceof ScriptError && e.code === ERROR.missingFile) throw new ScriptError(830, `PDF file not found: ${e.message}`);
        throw e;
      }
      const path = join(file.dir, file.name);
      if (statSync(path).size > MAX_APPEND_PDF) throw new ScriptError(800, `The PDF is over ${MAX_APPEND_PDF / 1024 / 1024} MB`);
      data = readFileSync(path);
    } else throw new ScriptError(ERROR.unavailable, `${step} names no PDF to read (a step read from a converted file keeps no options for it; author it as script text)`);
    const problem = pdfProblem(data);
    if (problem === 'limit') throw new PdfLimitError();
    if (problem === 'encrypted') {
      if (p.password === undefined || asText(this.eval(f, p.password)) === '') throw new ScriptError(831, 'Invalid PDF password: the PDF is encrypted');
      throw new ScriptError(832, 'PDF file security settings prevent modification: encrypted PDFs cannot be opened here');
    }
    if (problem) throw new ScriptError(830, 'PDF file not found or has an invalid format');
    return data;
  }

  /** Open PDF: only one PDF is open at a time (833). The file is left as it is until Close PDF writes it. */
  private openExistingPdf(f: Frame, p: StepParams): void {
    this.opts.beforeFile?.(f.store);
    if (this.openPdf) throw new ScriptError(833, 'PDF file is already opened');
    const base = this.pdfSource(f, p, 'Open PDF');
    this.openPdf = { base, pages: [], title: f.script.name, owners: new Set([f.store]) };
  }

  /** Append PDF: every page of the source goes after the open PDF's pages (829 when none is open). */
  private appendToOpenPdf(f: Frame, p: StepParams): void {
    this.opts.beforeFile?.(f.store);
    const open = this.openPdf;
    if (!open) throw new ScriptError(829, 'No PDF file is open to append to (use Create PDF or Open PDF first)');
    const source = this.pdfSource(f, p, 'Append PDF');
    const current = this.openPdfBytes(open);
    const joined = current ? pdfMerge([current, source]) : source;
    if (!joined) throw new ScriptError(830, 'The PDF could not be put together with the pages added to it');
    open.base = joined;
    open.pages = [];
  }

  /**
   * Close PDF: the PDF Create PDF started, to a file in the documents folder
   * or (Save to: Target) into a container field or variable. With none open,
   * error 5 as the help page says; a write that fails leaves it open.
   */
  private closePdf(f: Frame, p: StepParams): void {
    this.opts.beforeFile?.(f.store);
    const open = this.openPdf;
    if (!open) throw new ScriptError(5, 'No PDF is open');
    for (const owner of open.owners) this.opts.beforeFile?.(owner);
    const data = this.openPdfBytes(open) ?? pdf([], open.title);
    if (p.field || p.variable) {
      const name = p.newName !== undefined ? asText(this.eval(f, p.newName)) : 'Untitled.pdf';
      this.storeResult(f, p, { type: 'container', value: /\.pdf$/i.test(name) ? name : `${name}.pdf`, data: new Uint8Array(data) });
    } else {
      const path = this.pdfOutput(f, p, 'Close PDF');
      writeFileSync(path, data);
      this.deliver(f, 'Close PDF', path);
    }
    this.openPdf = undefined;
  }

  /**
   * Save Records as PDF: the layout as printed, into the documents folder.
   * Headers and footers go on every page, the body once per record, and
   * sub-summaries around each group when the found set is sorted by their
   * break field. See print.ts for how objects are drawn.
   */
  private async saveRecordsAsPdf(f: Frame, p: StepParams): Promise<void> {
    const previous = this.pdfFiles;
    this.pdfFiles = p.toOpenPdf ? this.openPdf?.owners : undefined;
    try { await this.saveRecordsAsPdfChecked(f, p); }
    finally { this.pdfFiles = previous; }
  }

  private async saveRecordsAsPdfChecked(f: Frame, p: StepParams): Promise<void> {
    const win = this.current;
    this.opts.beforeFile?.(f.store);
    this.opts.beforeFile?.(win.store);
    if (win.mode !== 'browse') throw new ScriptError(ERROR.unavailable, 'Save Records as PDF works in Browse mode');
    if (this.privileges && !this.privileges.in(this.current.store).canPrint) throw new ScriptError(ERROR.privileges, 'Printing (Save Records as PDF) needs the "print" privilege (or a script set to run with full access privileges)');
    const info = this.layoutOf(win);
    const home = info.home ?? info.owner;
    this.opts.beforeFile?.(home);
    // "Currently open PDF": the pages go into the PDF Create PDF started.
    const into = p.toOpenPdf ? this.openPdf : undefined;
    if (p.toOpenPdf && !into) throw new ScriptError(829, 'No PDF file is open to add to (use Create PDF first)');
    this.commit(win);
    const path = into ? '' : this.pdfOutput(f, p, 'Save Records as PDF');
    const design = info.layoutId !== undefined ? home.design(info.layoutId) : undefined;
    if (!design) throw new ScriptError(ERROR.unavailable, `The layout ${info.name} has no design to print`);
    const theme = design.themeId !== undefined ? home.designs().themes.find((t) => t.id === design.themeId) : undefined;
    const fs = this.foundSet(win);
    const blank = p.pdfRecords === 'blank';
    const saved = { ids: fs.ids, index: fs.index, portal: win.portal, calcError: this.calcError, calcMessage: this.calcMessage };

    // A formula on the layout (hide, conditional format) counts as true or false; its errors don't fail the step.
    const test = (formula: string): boolean => {
      this.poll(f);
      const before = [this.calcError, this.calcMessage] as const;
      try {
        return asBoolean(this.eval(f, formula));
      } finally {
        [this.calcError, this.calcMessage] = before;
      }
    };
    const shown = (v: Value | undefined) => (v ? asText(v, win.store.dateOrder) : '');
    const read = (occurrence: string | undefined, field: string, repetition = 1): string =>
      blank ? '' : shown(this.readField(win, { occurrence: occurrence ?? info.occurrence, field, repetition }));
    const symbol = (sym: string, page: number): string => {
      const name = /^\d+$/.test(sym) ? getParameterName(Number(sym) - 1000) : sym;
      if (!name) return '';
      if (name.toLowerCase() === 'pagenumber') return String(page);
      return shown(this.get(f, name));
    };
    const portalOccurrence = (o: LayoutObject) => o.portal?.tableOccurrence ?? this.objectOccurrence(win, o.portal?.tableOccurrenceId);
    const pictures = new Map<number, Uint8Array | undefined>();
    const source: PrintSource = {
      field: (o, repetition) => {
        // Printing a big found set reads a field per object per record: the time and memory limits apply.
        this.poll(f);
        const ref = o.field!;
        const occurrence = ref.tableOccurrence ?? this.objectOccurrence(win, ref.tableOccurrenceId);
        if (blank || !ref.field || !occurrence) return { text: '' };
        const file = this.containerFile(win, occurrence, ref.field, repetition);
        if (file) return { text: file.filename, file: file.data };
        // An unstored calculation that asks for the page ("Page " & Get ( PageNumber ) in a footer) is worked out here, on its page.
        const def = occurrence === info.occurrence ? this.schemaField(win, occurrence, ref.field) : undefined;
        if (def?.kind === 'calculation' && def.options?.unstored && def.calculation && PAGE_NUMBER.test(def.calculation)) {
          try {
            return { text: shown(this.eval(f, def.calculation)) };
          } catch (e) {
            rethrowExecutionRefusal(e);
            return { text: '?' };
          }
        }
        return { text: read(occurrence, ref.field, repetition) };
      },
      merge: (t, page) => t
        .replace(/<<(ƒ:[\s\S]*?|[^<>]+?)>>/g, (_, name: string) => {
          // Calculated text (<<ƒ:formula>>); like hide formulas, its errors don't fail the step.
          if (name.startsWith('ƒ:')) {
            this.poll(f);
            const before = [this.calcError, this.calcMessage] as const;
            try {
              return blank ? '' : shown(this.eval(f, name.slice(2)));
            } catch (e) {
              rethrowExecutionRefusal(e);
              return '?';
            } finally {
              [this.calcError, this.calcMessage] = before;
            }
          }
          const at = name.indexOf('::');
          return at < 0 ? read(undefined, name) : read(name.slice(0, at), name.slice(at + 2));
        })
        .replace(/\{\{(\w+)\}\}/g, (_, sym: string) => symbol(sym, page)),
      hidden: (o) => !!o.hide && (!blank || o.hide.inFind) && test(o.hide.formula),
      conditions: (o) => (o.conditions ?? []).filter((c) => !blank && test(c.formula)).flatMap((c) => c.rules),
      // Read once per step: every page showing the picture shares the same bytes.
      image: (id) => {
        if (!pictures.has(id)) pictures.set(id, home.image(id)?.data);
        return pictures.get(id);
      },
      portalCount: (o) => {
        const to = portalOccurrence(o);
        return blank || !to ? 0 : this.relatedIds(win, to).length;
      },
      portalRow: (o, row) => {
        const to = portalOccurrence(o);
        win.portal = row === undefined || !to ? saved.portal : { occurrence: to, row };
      },
      page: (n) => {
        this.printPage = n;
      },
    };

    const parts = (kind: string) => design.parts.filter((x) => x.kind === kind && x.height > 0);
    const all = saved.ids;
    const at = (ids: number[], index: number) => () => {
      fs.ids = ids;
      fs.index = index;
    };
    const engine = this;
    function* items(): Generator<PrintItem> {
      fs.ids = all;
      fs.index = saved.index;
      for (const part of parts('leading-grand-summary')) yield { part, select: at(all, saved.index) };
      if (p.pdfRecords === 'current' || blank) {
        for (const part of parts('body')) yield { part, select: at(all, saved.index) };
      } else {
        // Sub-summaries print when the found set is sorted by their break field, around each run of equal values.
        const sorted = new Set((fs.sort ?? []).map((s) => s.fieldName.split('::').pop()!.toLowerCase()));
        const breaks = [...parts('sub-summary-leading'), ...parts('sub-summary-trailing')]
          .filter((x) => x.breakField?.field && sorted.has(x.breakField.field.toLowerCase()));
        const key = (part: LayoutPart, i: number) => {
          fs.index = i;
          return read(part.breakField!.tableOccurrence, part.breakField!.field!);
        };
        const values = breaks.map((part) => all.map((_, i) => key(part, i)));
        fs.index = saved.index;
        const group = (b: number, i: number) => {
          let from = i, to = i;
          while (from > 0 && values[b][from - 1] === values[b][i]) from--;
          while (to + 1 < all.length && values[b][to + 1] === values[b][i]) to++;
          return { from, to };
        };
        for (let i = 0; i < all.length; i++) {
          engine.poll(f);
          for (const [b, part] of breaks.entries()) {
            if (part.kind !== 'sub-summary-leading' || (i > 0 && values[b][i - 1] === values[b][i])) continue;
            const g = group(b, i);
            yield { part, select: at(all.slice(g.from, g.to + 1), 0) };
          }
          for (const part of parts('body')) yield { part, select: at(all, i) };
          for (const [b, part] of breaks.entries()) {
            if (part.kind !== 'sub-summary-trailing' || (i + 1 < all.length && values[b][i + 1] === values[b][i])) continue;
            const g = group(b, i);
            yield { part, select: at(all.slice(g.from, g.to + 1), g.to - g.from) };
          }
        }
      }
      for (const part of parts('trailing-grand-summary')) yield { part, select: at(all, saved.index) };
    }

    const streamFile = !into && !(p.appendPdf && existsSync(path));
    const printer = () => new LayoutPrinter(design, theme, source, { setup: home.schema.pageSetup });
    const needsPageCount = /pagecount/i.test(JSON.stringify(design));
    let pages: PdfPage[] = [];
    try {
      if (streamFile) {
        // Page-count labels need one measurement pass before bytes are written.
        if (needsPageCount) this.printPageCount = printer().printTo(items(), () => {});
        const temporary = `${path}.tmp-${randomUUID()}`;
        const fd = openSync(temporary, 'wx');
        try {
          const writer = createPdfWriter((chunk) => {
            for (let at = 0; at < chunk.length;) {
              const n = writeSync(fd, chunk, at, chunk.length - at);
              if (n <= 0) throw new Error('PDF output stopped before all bytes were written');
              at += n;
            }
          }, info.name);
          printer().printTo(items(), (page) => writer.addPage(page));
          writer.finish();
          await new Promise<void>((resolve) => setImmediate(resolve));
          this.canceled(f.script.name);
          closeSync(fd);
          renameSync(temporary, path);
        } catch (e) {
          try { closeSync(fd); } catch { /* already closed */ }
          try { unlinkSync(temporary); } catch { /* already renamed */ }
          throw e;
        }
      } else {
        pages = printer().print(items());
        // An append or open PDF still needs an array of pages for its existing workflow.
        if (needsPageCount) {
          this.printPageCount = pages.length;
          pages = printer().print(items());
        }
      }
    } finally {
      fs.ids = saved.ids;
      fs.index = saved.index;
      win.portal = saved.portal;
      this.printPage = 0;
      this.printPageCount = 0;
    }
    if (streamFile) {
      this.deliver(f, 'Save Records as PDF', path);
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.canceled(f.script.name);
    if (into) into.pages.push(...pages);
    else {
      // Append: the pages go after those of the PDF already there (a new one when there is none).
      // Only the update is written, after the file's own bytes, so a write that fails can't lose them.
      if (p.appendPdf && existsSync(path)) {
        if (statSync(path).size > MAX_APPEND_PDF) throw new ScriptError(800, `The PDF to add to is over ${MAX_APPEND_PDF / 1024 / 1024} MB`);
        let update: Buffer;
        try {
          update = appendPdf(readFileSync(path), pages);
        } catch (e) {
          rethrowExecutionRefusal(e);
          if (e instanceof PdfAppendError) throw new ScriptError(800, `Can't add pages to that PDF: ${e.message}`);
          throw e;
        }
        appendFileSync(path, update);
      }
      this.deliver(f, 'Save Records as PDF', path);
    }
  }

  /** The table occurrence a layout object names by id. */
  private objectOccurrence(win: Window, id: number | undefined): string | undefined {
    return id === undefined ? undefined : (win.layout?.home ?? win.store).schema.tableOccurrences.find((t) => t.id === id)?.name;
  }

  /** A container field's file in the current record (or related record), when it holds one. */
  private containerFile(win: Window, occurrence: string, name: string, repetition: number): { filename: string; data: Uint8Array } | undefined {
    const info = this.infoFor(win, occurrence);
    const field = info && this.tableFields(info).find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!info || field?.type !== 'container' || field.options?.global) return undefined;
    // A container the account can't read (hidden or masked) doesn't print.
    if (this.privileges?.in(info.owner).field(info.table, field.name) === 'none') return undefined;
    const id = info === win.layout ? this.currentId(win) : this.relatedRecord(win, info.occurrence);
    if (id !== undefined && this.privileges) this.via(info).get(info, id, 'iso', undefined, this.privileges, { fields: [field.name] });
    const cid = id === undefined ? undefined : info.owner.containerId(info, id, field.name, repetition);
    const c = cid === undefined ? undefined : info.owner.container(cid);
    return c?.data ? { filename: c.filename ?? 'Untitled', data: c.data } : undefined;
  }

  /**
   * Save a Copy as: a copy of this file, in Tabularius's own format, in the
   * documents folder (".fmp12" in the name becomes ".openhbam.sqlite", so it
   * can be hosted). A clone keeps the design and accounts but no records.
   */
  private async saveCopy(f: Frame, p: StepParams): Promise<void> {
    this.opts.beforeFile?.(f.store);
    const win = this.current;
    // Unlike a protected FileMaker copy, this SQLite file exposes all records,
    // fields and account data to ordinary file readers. Authorize that disclosure
    // before committing or writing anything, including for a no-records clone.
    if (this.privileges && !this.privileges.in(f.store).full) throw new ScriptError(ERROR.privileges, 'Save a Copy needs full access (or a script set to run with full access privileges) because the SQLite copy is unprotected');
    this.commit(win);
    let { path } = this.filePath(f, p, 'Save a Copy as');
    path = path.replace(/\.fmp12$/i, '') + (/\.sqlite$/i.test(path) ? '' : '.openhbam.sqlite');
    if (existsSync(path)) throw new ScriptError(ERROR.fileInUse, 'A file with that name exists');
    mkdirSync(dirname(path), { recursive: true });
    const left = this.deadline - Date.now();
    this.hold(false);
    try {
      await f.store.backup(path);
    } finally {
      this.resumeAfter(left);
    }
    if (p.copyKind === 'clone') clearRecords(path, f.store.schema);
  }

  /**
   * Install Plug-In File: a plug-in package (.ohplugin) in the documents folder, installed when the administrator
   * turned script installs on, the package is signed by a publisher they trust, and the script has full access.
   * Installing never turns the plug-in on for a file. Every outcome is in the file's security log.
   */
  private installPluginFile(f: Frame, p: StepParams): void {
    const install = this.opts.installPlugin;
    if (!install) throw new ScriptError(ERROR.unavailable, 'Install Plug-In File is off: an administrator turns it on with "tabularius plugins <folder> script-install on"');
    const refuse = (code: number, why: string): never => {
      f.store.recordPluginInstall(undefined, { ...(this.opts.account ? { account: this.opts.account } : {}), script: f.script.name, why });
      throw new ScriptError(code, `Install Plug-In File: ${why}`);
    };
    if (this.privileges && !this.privileges.in(f.store).full) return refuse(ERROR.privileges, 'installing a plug-in needs full access (or a script set to run with full access privileges)');
    const { dir, name } = this.documentFile(f, p, 'Install Plug-In File');
    if (!/\.ohplugin$/i.test(name)) return refuse(ERROR.unavailable, `${name} is not a plug-in package (.ohplugin)`);
    try {
      const done = install(new Uint8Array(readFileSync(join(dir, name))));
      f.store.recordPluginInstall(done, { ...(this.opts.account ? { account: this.opts.account } : {}), script: f.script.name });
    } catch (e) {
      return refuse(ERROR.unavailable, (e as Error).message);
    }
  }

  /** Insert File: a file from the documents folder, or one a person chooses (the insertFile option), into a container field or variable. */
  private async insertFromDevice(f: Frame, p: StepParams): Promise<void> {
    if (!this.opts.device) throw new ScriptError(ERROR.unavailable, 'Insert from Device needs a camera, microphone, scanner or signature pad, and the server has none');
    const type = p.device?.type ?? 'Camera';
    const left = this.deadline - Date.now();
    this.hold();
    const got = await this.opts.device({ script: f.script.name, type, ...(p.device?.camera ? { camera: p.device.camera } : {}), actions: this.actions.slice() });
    this.resumeAfter(left);
    if (!got) throw new ScriptError(1, 'Nothing was taken'); // FileMaker's "user canceled action"
    const value: Value = 'text' in got ? text(got.text) : { type: 'container', value: got.filename, data: got.data };
    if (p.variable && !p.field) this.setVariable(f, p.variable, 1, value);
    else this.setField(f, p, value);
  }

  /** Where the person's device is, asked once per run, before the first step that needs it. */
  private async locate(f: Frame, s: ScriptStep): Promise<void> {
    if (this.located || !this.opts.location || !s.params || !stepLocates(s, this.current.store.schema)) return;
    this.located = true;
    const left = this.deadline - Date.now();
    this.hold();
    this.where = await this.opts.location({ script: f.script.name, actions: this.actions.slice() });
    this.resumeAfter(left);
  }

  private located = false;
  private where?: DeviceLocation;

  private async insertFile(f: Frame, p: StepParams): Promise<void> {
    this.opts.beforeFile?.(f.store);
    const active = this.current.activeField;
    const target = p.field ?? (!p.variable && active ? {
      tableOccurrence: { id: 0, name: active.occurrence }, field: { id: 0, name: active.field }, repetition: active.repetition,
    } : undefined);
    if (target) {
      const { info, field, win } = this.resolveTarget(f, target);
      if (field.type === 'container' && !field.options?.global && win.mode !== 'find') {
        const id = info === win.layout ? this.currentId(win) : this.relatedRecord(win, info.occurrence);
        if (id === undefined) throw new ScriptError(ERROR.recordMissing, 'No current record');
        // Match the upload API: refuse the destination before reading or requesting file bytes.
        this.via(info).checkContainerWrite(info, id, field.name, target.repetition ?? 1, this.write);
      }
    }
    let file: { filename: string; data: Uint8Array } | undefined;
    if (p.filePaths?.length || !this.opts.insertFile) {
      if (!p.filePaths?.length) throw new ScriptError(ERROR.unavailable, 'Insert File asks a person to choose a file, and nobody can on the server');
      const { dir, name } = this.documentFile(f, p, 'Insert File');
      file = { filename: name, data: new Uint8Array(readFileSync(join(dir, name))) };
    } else {
      const left = this.deadline - Date.now();
      this.hold();
      file = await this.opts.insertFile({ script: f.script.name, ...(p.title !== undefined ? { title: asText(this.eval(f, p.title)) } : {}), actions: this.actions.slice() });
      this.resumeAfter(left);
      if (!file) throw new ScriptError(1, 'No file was chosen'); // FileMaker's "user canceled action"
    }
    const value: Value = { type: 'container', value: file.filename, data: file.data };
    if (p.variable && !p.field) this.setVariable(f, p.variable, 1, value);
    else this.setField(f, p, value);
  }

  /** Refuse unresolved data-changing options with a targeted LastErrorDetail. */
  private requireDecodedOptions(stepId: number, p: StepParams, calculations?: string[]): void {
    const detail = undecodedOptionError(stepId, p, calculations);
    if (!detail) return;
    this.forced = { code: ERROR.unavailable, message: detail, detail };
    throw new ScriptError(ERROR.unavailable, detail);
  }

  /** Import Records: Add, Update matching records, or Replace the found set in source order. */
  private async importRecords(f: Frame, p: StepParams): Promise<void> {
    this.requireDecodedOptions(35, p);
    this.opts.beforeFile?.(f.store);
    const win = this.current;
    const info = p.tableOccurrence ? win.store.occurrence(p.tableOccurrence.name) : this.layoutOf(win);
    this.opts.beforeFile?.(info.owner);
    const action = p.importAction ?? 'add';
    const pv = this.privileges?.in(info.owner);
    // Resolve the source without reading rows: a missing source still reports 100
    // before a privilege denial, while an existing source is not parsed when denied.
    const folder = p.importFolder ? this.importFolderPath(f, p) : undefined;
    const hosted = !p.importFolder && p.importFormat === 'FMPR' ? this.fileMakerSource(f, p) : undefined;
    const file = !p.importFolder && p.importFormat !== 'FMPR' ? this.documentFile(f, p, 'Import Records') : undefined;
    pv?.checkImport(info.table, action, p.addRemaining);
    const source: { rows: (string | number)[][]; excel: boolean; files?: Map<string, { filename: string; data: Uint8Array }> } = p.importFolder ? this.folderRows(f, p, folder)
      : p.importFormat === 'FMPR' ? { rows: this.fileMakerRows(f, p, hosted), excel: false } : this.textRows(f, p, file);
    const rows = source.rows;
    this.commit(win);
    const table = info.owner.schema.tables.find((t) => t.name === info.table);
    const mapping: NonNullable<StepParams['fieldMapping']> = p.fieldMapping ?? info.fields.filter((x) => !x.calculated && !x.summary).map((x) => ({
      import: true, field: { tableOccurrence: { id: 0, name: info.occurrence }, field: { id: 0, name: x.name } },
    }));
    const repeating = (field: NonNullable<typeof table>['fields'][number]) => (field.options?.repetitions ?? 1) > 1 || info.owner.isRepeating(info.table, field.name);
    const fields = mapping.map((m) => {
      if (!m.import && !m.match) return undefined;
      const field = m.field && table?.fields.find((x) => m.field!.field.id ? x.id === m.field!.field.id : x.name === m.field!.field.name);
      if (!field || m.field?.tableOccurrence.name !== info.occurrence) throw new ScriptError(ERROR.fieldMissing, 'An import target field is missing');
      if (m.match && (field.type === 'container' || field.kind === 'summary' || field.options?.global)) throw new ScriptError(ERROR.findCriteria, `Field "${field.name}" cannot be used for matching`);
      if (m.match && pv?.field(info.table, field.name) === 'none') throw new ScriptError(ERROR.fieldNotModifiable, `Field "${field.name}" is not accessible for matching`);
      // A repeating field takes the source's repetitions (group-separated values); the mapping names fields, not repetitions.
      if ((m.field?.repetition ?? 1) > 1) throw new ScriptError(ERROR.unavailable, `Importing into repetition ${m.field!.repetition} of "${field.name}" is not supported; no records were imported`);
      if (m.match && repeating(field)) throw new ScriptError(ERROR.findCriteria, `Repeating field "${field.name}" cannot be used for matching`);
      return field.kind === 'normal' || m.match ? field : undefined;
    });
    const matches = mapping.flatMap((m, i) => m.match && fields[i] ? [i] : []);
    if (action === 'update' && !matches.length) throw new ScriptError(ERROR.noCriteria, 'Update import requires match fields');
    this.commit(win);
    const visible = action === 'add' ? [] : info.owner.findIds(info, this.reading);
    const have = new Set(visible);
    const targets = action === 'add' ? [] : (win.foundSets.get(info.occurrence)?.ids ?? visible).filter((id) => have.has(id));
    // Only workbook numbers are Excel serial dates; hosted FileMaker numbers are already field values.
    const value = (row: (string | number)[], i: number) => {
      const v = row[i];
      if (source.excel && typeof v === 'number') return excelDate(v, fields[i]?.type);
      // A text export puts an apostrophe before a value a spreadsheet would take for a formula; a number or date field doesn't want it.
      return typeof v === 'string' ? stripFormulaGuard(v, fields[i]?.type) : v ?? '';
    };
    const key = (values: (string | number | null | undefined)[]) => JSON.stringify(values.map((v, i) => {
      const normalized = info.owner.normalize(String(v ?? ''), fields[matches[i]]!.type);
      return typeof normalized === 'string' ? normalized.toLowerCase() : normalized ?? '';
    }));
    // Match only the original found set, never records added during this import.
    const byKey = new Map<string, number[]>();
    if (action === 'update') {
      const wanted = matches.map((i) => fields[i]!.name);
      for (const id of targets) {
        await this.checkpoint(f);
        const data = info.owner.get(info, id, 'iso', undefined, pv, { summaries: false, fields: wanted }).fieldData;
        const values = wanted.map((n) => data[n] as string | number | null | undefined);
        if (values.every((v) => v === '' || v === null || v === undefined)) continue;
        const k = key(values);
        byKey.set(k, [...(byKey.get(k) ?? []), id]);
      }
    }
    const ids = new Set<number>();
    let failure: StoreError | PrivilegeError | undefined;
    // Skip auto-enter options on the open transaction overrides the import's own Perform auto-enter options.
    const write = { ...this.write, performAutoEnter: this.tx?.skipAutoEnter ? false : p.performAutoEnter };
    for (const [position, row] of rows.entries()) {
      await this.checkpoint(f);
      const values = matches.map((i) => value(row, i));
      if (action === 'update' && values.every((v) => v === '')) continue;
      const existing = action === 'update' ? byKey.get(key(values)) ?? [] : action === 'replace' ? targets.slice(position, position + 1) : [];
      const adding = !existing.length && (action === 'add' || p.addRemaining);
      if (!existing.length && !adding) continue;
      const data: FieldData = {};
      let denied = false, permitted = false;
      fields.forEach((field, i) => {
        // Match fields identify records; they are copied only when adding unmatched data.
        if (!field || field.kind !== 'normal' || (mapping[i].match ? !adding : !mapping[i].import)) return;
        if (pv && pv.field(info.table, field.name) !== 'modifiable') {
          denied = true;
          failure ??= new StoreError(ERROR.fieldNotModifiable, 'An import field cannot be modified; inaccessible fields were skipped');
          return;
        }
        permitted = true;
        const v = value(row, i);
        const parts = typeof v === 'string' && v.includes(GROUP_SEPARATOR) ? v.split(GROUP_SEPARATOR) : [v];
        if (!repeating(field)) {
          // One value for a field of one: the first of the source's repetitions.
          if (!adding || parts[0] !== '') data[field.name] = parts[0];
          return;
        }
        // Each repetition gets the source's value for it, and the ones it has none for are emptied.
        const count = Math.max(field.options?.repetitions ?? 1, parts.length);
        for (let k = 0; k < count; k++) {
          const one = parts[k] ?? '';
          if (!adding || one !== '') data[k ? `${field.name}(${k + 1})` : field.name] = one;
        }
      });
      if (denied && !permitted) continue;
      // A folder's picture, PDF or movie goes into a container field as a file; the other columns are field data.
      const files: [string, { filename: string; data: Uint8Array }][] = [];
      if (source.files) {
        fields.forEach((field, i) => {
          const file = field?.type === 'container' && typeof row[i] === 'string' && source.files!.get(row[i] as string);
          if (file && field && field.name in data) { delete data[field.name]; files.push([field.name, file]); }
        });
      }
      const save = (id?: number) => {
        try {
          // Claris skips most invalid fields, while Not empty and calculation validation skip the record.
          // The rejected record write has not been committed. Remove only its rejected field and retry the rest.
          const pending: FieldData = { ...data };
          for (;;) {
            try {
              if (id === undefined) {
                id = this.via(info).create(info, pending, write).recordId;
                this.created++;
              } else if (Object.keys(pending).length) this.via(info).update(info, id, pending, undefined, write);
              else return;
              break;
            } catch (e) {
              rethrowExecutionRefusal(e);
              const field = e instanceof StoreError && e.code !== 509 && e.code !== 507 ? e.validationField : undefined;
              const rejected = field && Object.keys(pending).filter((name) => name === field || name.startsWith(`${field}(`));
              if (!(e instanceof StoreError) || !rejected?.length) throw e;
              failure ??= e;
              for (const name of rejected) delete pending[name];
            }
          }
          this.touched(info);
          for (const [name, file] of files) {
            this.via(info).setContainer(info, id, name, 1, { filename: file.filename, mime: containerMime('', file.filename, file.data), data: file.data }, this.write);
          }
          ids.add(id);
        } catch (e) {
          rethrowExecutionRefusal(e);
          if (!(e instanceof StoreError) && !(e instanceof PrivilegeError)) throw e; // a record that fails validation or access checks is skipped
          failure ??= e;
        }
      };
      if (adding) save();
      else existing.forEach((id) => save(id));
    }
    // The imported records become the found set, when the window shows their table.
    const shown = this.layoutOf(win);
    if (shown.table === info.table && shown.owner === info.owner) this.setFound(win, [...ids]);
    if (failure) throw failure;
  }

  /** Rows of a comma- or tab-separated file, an Excel workbook or FileMaker XML in the documents folder. */
  private textRows(f: Frame, p: StepParams, file = this.documentFile(f, p, 'Import Records')): { rows: (string | number)[][]; excel: boolean } {
    const { dir, name } = file;
    const stylesheet = p.xslt === undefined ? undefined : this.documentFile(f, { ...p, filePaths: [p.xslt] }, 'Import Records');
    const data = readFileSync(join(dir, name));
    // Claris: error 731, "The import file has no data". Only a file with nothing in it; a header alone still imports as before.
    if (!decodeText(data).trim()) throw new ScriptError(ERROR.noImportData, 'The import file has no data');
    const rows = importFileRows(name, data, p.importFormat, stylesheet && readFileSync(join(stylesheet.dir, stylesheet.name), 'utf8'), { worksheet: p.worksheet });
    // A merge file's first record names the fields (Claris: "The first record is a header that lists the field names").
    if (isMerge(name, p.importFormat)) rows.shift();
    return {
      rows,
      excel: /\.xlsx$/i.test(name) || !!p.importFormat?.startsWith('XLX'),
    };
  }

  /** Locate the import folder without enumerating or reading its files. */
  private importFolderPath(f: Frame, p: StepParams): string {
    const root = this.filePath(f, p, 'Import Records', true).path;
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new ScriptError(ERROR.missingFile, `No such folder in the documents folder (${(p.filePaths ?? []).join(', ')})`);
    return root;
  }

  /**
   * Rows of a folder of files in the documents folder, one per file with the columns Claris lists: Text Content,
   * File Name, File Path for text files; Image, File Name, File Path, Image Thumbnail for pictures, PDFs and movies.
   * Files come in path order, up to 100 folder levels down when enclosed folders are included. Hidden files, links
   * to folders and links that lead outside the documents folder are skipped; File Path is relative to that folder.
   * An Image cell holds the file's path, which the import turns into the file in the container field.
   */
  private folderRows(f: Frame, p: StepParams, root = this.importFolderPath(f, p)): { rows: (string | number)[][]; excel: boolean; files?: Map<string, { filename: string; data: Uint8Array }> } {
    const base = this.opts.documents!;
    const kind = p.importFolder!.kind;
    const accepted = kind === 'text' ? /\.(csv|json|log|mer|tab|tsv|txt|xml|xsl|xslt)$/i : /\.(jpe?g|png|gif|tiff?|bmp|heic|webp|pdf|mov|mp4|m4v|avi|mpe?g)$/i;
    const home = realpathSync(base);
    const found: string[] = [];
    const walk = (dir: string, level: number) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        let info = lstatSync(path);
        if (info.isSymbolicLink()) {
          // An alias to a file is followed, but never out of the documents folder; an alias to a folder is not.
          try {
            const real = realpathSync(path);
            if (relative(home, real).startsWith('..') || isAbsolute(relative(home, real))) continue;
            info = statSync(path);
          } catch { continue; }
        }
        if (info.isDirectory()) {
          if (p.importFolder!.enclosed && !entry.isSymbolicLink() && level < 100) walk(path, level + 1);
        } else if (info.isFile() && accepted.test(entry.name)) found.push(path);
      }
    };
    walk(root, 1);
    found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const files = new Map<string, { filename: string; data: Uint8Array }>();
    const rows = found.map((path) => {
      this.poll(f);
      const shown = relative(base, path).split(sep).join('/');
      const data = new Uint8Array(readFileSync(path));
      if (kind === 'picture') {
        files.set(shown, { filename: basename(path), data });
        return [shown, basename(path), shown, ''];
      }
      return [decodeText(data), basename(path), shown];
    });
    return { rows, excel: false, ...(kind === 'picture' ? { files } : {}) };
  }

  /** Resolve a hosted import source without reading any of its records. */
  private fileMakerSource(f: Frame, p: StepParams) {
    const path = (p.filePaths ?? []).map((x) => (x.startsWith('$') ? asText(this.getVariable(f, x, 1) ?? text('')) : x));
    const files = path.map((x) => (x.split(/[/:\\]/).pop() ?? '').replace(/\.fmp12$/i, '')).filter(Boolean);
    const store = files.map((n) => (n.toLowerCase() === f.store.name.toLowerCase() ? f.store : f.store.resolveFile(n))).find((x) => x);
    if (!store) throw new ScriptError(ERROR.missingFile, `File ${path.join(', ') || '(none named)'} is not hosted`);
    this.useSourceFile(store);
    const to = p.importSource && store.schema.tableOccurrences.find((t) => t.id === p.importSource!.tableOccurrenceId);
    if (!p.importSource || !to) throw new ScriptError(ERROR.missingFile, 'The table to import from is missing');
    const source = store.occurrence(to.name);
    this.useSourceFile(source.owner);
    return { store, to, source };
  }

  /**
   * Rows of a table in a hosted FileMaker file: its found set when this run
   * shows that table occurrence, as FileMaker imports from an open file's
   * found set, else every record.
   */
  private fileMakerRows(f: Frame, p: StepParams, resolved = this.fileMakerSource(f, p)): (string | number)[][] {
    const { store, to, source } = resolved;
    const table = source.owner.schema.tables.find((t) => t.name === source.table);
    const pv = this.privileges?.in(source.owner);
    // A masked field reads as its stand-in, which must not be imported as if it were the value: it imports empty, like a hidden one.
    const names = p.importSource!.fieldIds.map((id) => table?.fields.find((x) => x.id === id && x.type !== 'container' && !(pv && pv.field(source.table, x.name) === 'none'))?.name);
    // A repeating source field gives all its repetitions, group-separated, as a repeating field exports them.
    const repeated = new Set(names.filter((n): n is string => !!n && ((table?.fields.find((x) => x.name === n)?.options?.repetitions ?? 1) > 1 || source.owner.isRepeating(source.table, n))));
    const all = (data: Record<string, unknown>, n: string) => {
      const out = [String(data[n] ?? '')];
      for (let k = 2; `${n}(${k})` in data; k++) out.push(String(data[`${n}(${k})`] ?? ''));
      while (out.length > 1 && out[out.length - 1] === '') out.pop();
      return out.join(GROUP_SEPARATOR);
    };
    const shown = this.windows.find((w) => w.store === store && w.foundSets.has(to.name));
    const ids = shown ? [...shown.foundSets.get(to.name)!.ids] : source.owner.findIds(source, pv ? { privileges: pv } : {});
    // Only the fields imported: reading whole records (every unstored calculation) of a big table filled the heap.
    const wanted = names.filter((n): n is string => n !== undefined);
    return ids.map((id) => {
      this.poll(f);
      const data = wanted.length ? source.owner.get(source, id, 'iso', undefined, pv, { summaries: false, fields: wanted }).fieldData : {};
      return names.map((n) => (n === undefined ? '' : repeated.has(n) ? all(data, n) : (data[n] as string | number) ?? ''));
    });
  }

  private newRecord(): void {
    const win = this.current;
    if (win.mode === 'find') {
      win.requests.push({ criteria: {}, omit: false });
      win.requestIndex = win.requests.length - 1;
      return;
    }
    this.commit(win);
    const info = this.layoutOf(win);
    const fs = this.foundSet(win);
    const lastVisited = this.currentId(win);
    const otherSets = new Set<FoundSet>();
    for (const other of this.windows) {
      if (other === win) continue;
      if (other.unloaded && other.initialFoundSet) {
        try {
          const shown = other.store.layout(other.unloaded);
          if (shown.owner === info.owner && shown.table === info.table) otherSets.add(other.initialFoundSet);
        } catch (e) {
          rethrowExecutionRefusal(e);
          // The client may name a layout removed since it supplied this window.
        }
      }
      for (const [to, found] of other.foundSets) {
        const shown = other.store.occurrence(to);
        if (shown.owner === info.owner && shown.table === info.table) otherSets.add(found);
      }
    }
    // A window showing all records gains the new record without changing its
    // current one; a window showing a subset keeps the new record omitted.
    const before = otherSets.size ? new Set(info.owner.findIds(info, this.reading)) : undefined;
    const allInOtherWindows = before ? [...otherSets].filter((found) => found.ids.length === before.size && found.ids.every((id) => before.has(id))) : [];
    // The store applies auto-enter options (stamps, serials, constants, formulas, the last visited record's values).
    // Its validation waits for the commit, so a required field the script sets next doesn't fail New Record.
    const { recordId } = this.via(info).create(info, {}, { ...this.write, uncommitted: true, ...(lastVisited === undefined ? {} : { lastVisited }) });
    this.holdWindowRecord(win, info, recordId);
    this.created++;
    fs.ids.push(recordId);
    for (const other of allInOtherWindows) other.ids.push(recordId);
    this.touched(info);
    fs.index = fs.ids.length - 1;
    win.uncommittedNew = true;
  }

  private duplicateRecord(win: Window): void {
    if (win.mode === 'find') {
      const r = win.requests[win.requestIndex];
      win.requests.push({ criteria: { ...(r?.criteria ?? {}) }, omit: r?.omit ?? false });
      win.requestIndex = win.requests.length - 1;
      return;
    }
    this.commit(win);
    const info = this.layoutOf(win);
    const id = this.currentId(win);
    if (id === undefined) throw new ScriptError(ERROR.recordMissing, 'No record to duplicate');
    const { recordId } = this.via(info).duplicate(info, id, this.write);
    this.holdWindowRecord(win, info, recordId);
    this.created++;
    const fs = this.foundSet(win);
    fs.ids.splice(fs.index + 1, 0, recordId);
    fs.index++;
    this.touched(info);
  }

  private deleteRecord(win: Window): void {
    if (win.mode === 'find') {
      win.requests.splice(win.requestIndex, 1);
      if (!win.requests.length) win.requests.push({ criteria: {}, omit: false });
      win.requestIndex = Math.min(win.requestIndex, win.requests.length - 1);
      return;
    }
    const info = this.layoutOf(win);
    const fs = this.foundSet(win);
    const id = fs.ids[fs.index];
    if (id === undefined) throw new ScriptError(ERROR.recordMissing, 'No record to delete');
    win.pending = new Map();
    win.pendingPrivileges = undefined;
    this.unlockEdits(win);
    this.via(info).delete(info, id, this.write);
    this.forget(info, [id]);
    // The record a New Record made is gone: the next commit is not its first.
    win.uncommittedNew = false;
  }

  private async deleteAll(f: Frame, win: Window): Promise<void> {
    this.commit(win);
    const info = this.layoutOf(win);
    const ids = [...this.foundSet(win).ids];
    const gone: number[] = [];
    try {
      for (const id of ids) {
        await this.checkpoint(f);
        this.late(f);
        this.via(info).delete(info, id, this.write);
        gone.push(id);
      }
    } finally {
      this.forget(info, gone);
    }
  }

  /** Removes deleted records from every window's found sets. */
  private forget(info: LayoutInfo, ids: number[]): void {
    const gone = new Set(ids);
    for (const w of this.windows) {
      for (const [to, fs] of w.foundSets) {
        let other: LayoutInfo;
        try {
          other = w.store.occurrence(to);
        } catch (e) {
          rethrowExecutionRefusal(e);
          continue;
        }
        if (other.owner !== info.owner || other.table !== info.table) continue;
        const cur = fs.ids[fs.index];
        fs.ids = fs.ids.filter((x) => !gone.has(x));
        const at = cur === undefined ? -1 : fs.ids.indexOf(cur);
        fs.index = at >= 0 ? at : Math.min(fs.index, Math.max(0, fs.ids.length - 1));
      }
    }
  }

  private revert(win: Window): void {
    win.pending = new Map();
    win.pendingPrivileges = undefined;
    this.unlockEdits(win);
    if (win.uncommittedNew) {
      const info = this.layoutOf(win);
      const id = this.currentId(win);
      if (id !== undefined) {
        this.via(info).delete(info, id, this.write);
        this.forget(info, [id]);
      }
    }
    win.uncommittedNew = false;
  }

  // --- navigation ----------------------------------------------------------

  private goToLayoutStep(f: Frame, p: StepParams): void {
    // Worked out once: the OnLayoutExit check before the step may have done it.
    const known = this.layoutChosen?.params === p ? this.layoutChosen.name : undefined;
    this.layoutChosen = undefined;
    const name = known ?? this.layoutTarget(f, p);
    if (!name) throw new ScriptError(ERROR.layoutMissing, 'Layout is missing');
    this.goToLayout(this.current, name);
  }

  /** The layout a Go to Layout step goes to, if it names one. */
  private layoutTarget(f: Frame, p: StepParams): string | undefined {
    const win = this.current;
    let name: string | undefined;
    switch (p.layoutDestination) {
      case 'original': name = f.originalLayout; break;
      case 'named': name = p.layout?.name; break;
      case 'name': name = asText(this.eval(f, p.layoutCalculation ?? '')); break;
      case 'number': {
        const n = Math.trunc(asNumber(this.eval(f, p.layoutCalculation ?? '')));
        name = win.store.schema.layouts[n - 1]?.name;
        break;
      }
    }
    return name;
  }

  private goToRecord(f: Frame, p: StepParams, b: Blocks, pc: number): number | undefined {
    const win = this.current;
    if (win.mode === 'find') {
      const n = win.requests.length;
      const i = win.requestIndex;
      // Exit after last leaves the loop from the last request (next) or the first (previous), as it does in Browse mode.
      if (p.exitAfterLast && ((p.location === 'next' && i >= n - 1) || (p.location === 'previous' && i <= 0))) return this.exitLoop(b, pc);
      win.requestIndex = p.location === 'first' ? 0 : p.location === 'last' ? n - 1
        : p.location === 'next' ? Math.min(n - 1, i + 1) : p.location === 'previous' ? Math.max(0, i - 1)
        : Math.min(n - 1, Math.max(0, Math.trunc(asNumber(this.eval(f, p.calculation ?? '1'))) - 1));
      return undefined;
    }
    this.commit(win);
    const fs = this.foundSet(win);
    const last = fs.ids.length - 1;
    switch (p.location) {
      case 'first': fs.index = 0; break;
      case 'last': fs.index = Math.max(0, last); break;
      case 'next':
        if (fs.index >= last) {
          if (p.exitAfterLast) return this.exitLoop(b, pc);
          throw new ScriptError(ERROR.recordMissing, 'Already on the last record');
        }
        fs.index++;
        break;
      case 'previous':
        if (fs.index <= 0) {
          if (p.exitAfterLast) return this.exitLoop(b, pc);
          throw new ScriptError(ERROR.recordMissing, 'Already on the first record');
        }
        fs.index--;
        break;
      case 'calculation': {
        const n = Math.trunc(asNumber(this.eval(f, p.calculation ?? '')));
        if (n < 1 || n > fs.ids.length) throw new ScriptError(ERROR.recordMissing, `There is no record ${n}`);
        fs.index = n - 1;
        break;
      }
    }
    if (!fs.ids.length) throw new ScriptError(ERROR.recordMissing, 'No records in the found set');
    return undefined;
  }

  /** New Window, also Go to Related Record's: a copy of the window (layout, found sets), named by slot 128's formula. */
  private newWindow(f: Frame, win: Window, p: StepParams): Window {
    this.commit(win);
    const name = p.slots?.[128] !== undefined ? asText(this.eval(f, p.slots[128])) : `${f.store.name} - ${this.windows.length + 1}`;
    // Its id is its Get ( WindowUUID ); its style and size as the step gives them (Height, Width, Top, Left in slots 129-132).
    const id = randomUUID().toUpperCase();
    const size = (slot: number) => {
      const formula = p.slots?.[slot];
      const n = formula === undefined ? NaN : asNumber(this.eval(f, formula));
      return Number.isFinite(n) && Math.abs(n) < 100_000 ? Math.round(n) : undefined;
    };
    const geometry = Object.fromEntries(([['height', 129], ['width', 130], ['top', 131], ['left', 132]] as const)
      .map(([k, slot]) => [k, size(slot)]).filter(([, v]) => v !== undefined));
    const copied = new Map<FoundSet, FoundSet>();
    const foundSets = new Map([...win.foundSets].map(([key, found]) => {
      let clone = copied.get(found);
      if (!clone) {
        clone = { ...found, ids: [...found.ids] };
        copied.set(found, clone);
      }
      return [key, clone] as const;
    }));
    const copy: Window = {
      ...win, name, foundSets,
      requests: [], requestIndex: 0, pending: new Map(), uncommittedNew: false, mode: 'browse', activeField: undefined, chrome: undefined,
      id, uuid: id, style: p.windowStyle ?? 'document', geometry, untouched: false,
    };
    this.windows.push(copy);
    this.current = copy;
    return copy;
  }

  private goToRelated(f: Frame, p: StepParams): void {
    let win = this.current;
    if (!p.tableOccurrence) throw new ScriptError(ERROR.unavailable, 'Go to Related Record names no table');
    this.commit(win);
    // Match all records in the found set: records related to any of them, else to the current one.
    const from = p.matchFoundSet && win.layout && win.mode === 'browse' ? { occurrence: win.layout.occurrence, ids: this.foundSet(win).ids } : undefined;
    const ids = this.relatedIds(win, p.tableOccurrence.name, from);
    // With none, the step fails before any window opens or layout changes: 401 when matching the found set, as for a find.
    if (!ids.length) throw new ScriptError(from ? ERROR.noRecords : ERROR.recordMissing, `No related records in "${p.tableOccurrence.name}"`);
    if (p.newWindow) win = this.newWindow(f, win, p);
    if (p.layout) this.goToLayout(win, p.layout.name);
    const info = this.layoutOf(win);
    const target = win.store.occurrence(p.tableOccurrence.name);
    if (info.table !== target.table || info.owner !== target.owner) {
      throw new ScriptError(ERROR.layoutMissing, `Layout "${win.layoutName}" does not show "${p.tableOccurrence.name}" records`);
    }
    win.mode = 'browse';
    this.setFound(win, ids);
  }

  // --- finds -------------------------------------------------------------------

  /** A field reference as the layout's find and sort take it; a find also takes related fields as TO::field. */
  private layoutFieldName(win: Window, ref: FieldRef, related = false): string {
    const info = this.layoutOf(win);
    if (ref.tableOccurrence.name.toLowerCase() === info.occurrence.toLowerCase()) {
      if (!ref.field.name.startsWith('⟨field:')) return ref.field.name;
      const field = this.tableFields(info).find((x) => x.id === ref.field.id);
      if (field) return field.name;
    }
    const other = win.store.occurrence(ref.tableOccurrence.name);
    if (other.table === info.table && other.owner === info.owner) return ref.field.name;
    if (related) {
      const field = ref.field.name.startsWith('⟨field:') ? this.tableFields(other).find((x) => x.id === ref.field.id)?.name : ref.field.name;
      if (field) return `${other.occurrence}::${field}`;
    }
    throw new ScriptError(ERROR.fieldMissing, `Finds and sorts on related fields (${ref.tableOccurrence.name}::${ref.field.name}) are not supported yet`);
  }

  private storedRequests(f: Frame, p: StepParams): Window['requests'] {
    const win = this.current;
    // Stored criteria may name variables: FileMaker substitutes their values.
    const subst = (c: string) => c.replace(/\$\$?[\p{L}\p{N}_.~]+/gu, (v) => asText(this.getVariable(f, v, 1) ?? text('')));
    return (p.requests ?? []).map((r) => ({
      omit: r.omit,
      criteria: Object.fromEntries(r.criteria.map((c) => [this.layoutFieldName(win, c.field, true), subst(c.criteria)])),
    }));
  }

  /** Close Window's and Select Window's window name (decoded from files as slot 128), unless the trigger checks worked it out. */
  private windowName(p: StepParams, calc: (formula: string) => Value): string | undefined {
    const known = this.windowChosen?.params === p ? this.windowChosen : undefined;
    this.windowChosen = undefined;
    if (known) return known.name;
    const formula = p.calculation ?? p.slots?.[128];
    return formula !== undefined ? asText(calc(formula)) : undefined;
  }

  /** Whether Perform / Constrain / Extend Find has something to find, so it gets as far as committing the record. */
  private findHasCriteria(f: Frame, p: StepParams, win: Window): boolean {
    let requests: Window['requests'];
    try { requests = p.restore && p.requests?.length ? this.storedRequests(f, p) : win.requests; } catch (e) { rethrowExecutionRefusal(e); return false; }
    return requests.some((r) => Object.values(r.criteria).some((v) => v !== ''));
  }

  private performFind(f: Frame, p: StepParams, stepId: number, given?: Window['requests']): void {
    const win = this.current;
    const requests = given ?? (p.restore && p.requests?.length ? this.storedRequests(f, p) : win.requests);
    win.lastFind = requests.map((r) => ({ criteria: { ...r.criteria }, omit: r.omit }));
    win.mode = 'browse';
    win.requests = [];
    // A field set to nothing in find mode (an empty variable, say) is no criterion.
    const query: FindRequest[] = requests
      .map((r) => ({ ...r, criteria: Object.fromEntries(Object.entries(r.criteria).filter(([, v]) => v !== '')) }))
      .filter((r) => Object.keys(r.criteria).length)
      .map((r) => ({ ...r.criteria, ...(r.omit ? { omit: 'true' } : {}) }));
    const info = this.layoutOf(win);
    // Which fields were asked for (names only, never the criteria: they can hold client data).
    const named = [...new Set(requests.flatMap((r) => Object.keys(r.criteria)))];
    if (!query.length) {
      const empty = p.restore && p.requests?.length ? this.emptyVariables(f, p) : [];
      // A stored request Tabularius couldn't read (its criteria are somewhere the reader doesn't look yet) is a reader gap, not the script's.
      const unread = p.restore && p.requests?.some((r) => r.unread && !r.criteria.length);
      throw new ScriptError(ERROR.noCriteria, `No find criteria${named.length ? ` (${named.join(', ')} set to nothing${empty.length ? `; ${empty.join(', ')} empty` : ''})`
        : unread ? ' (the stored find request has parts Tabularius cannot read yet: a Tabularius gap)' : ' (no field was set in find mode)'}`);
    }
    const related = query.some((r) => Object.keys(r).some((k) => k.includes('::')));
    let ids = related ? this.findRelated(win, info, query) : info.owner.findIds(info, { query, ...this.reading });
    const current = this.foundSet(win);
    if (stepId === 126) { // Constrain
      const keep = new Set(ids);
      ids = current.ids.filter((x) => keep.has(x));
    } else if (stepId === 127) { // Extend
      const have = new Set(current.ids);
      ids = [...current.ids, ...ids.filter((x) => !have.has(x))];
    }
    this.setFound(win, ids, current.sort);
    if (!ids.length) {
      const asked = [...new Set(query.flatMap((r) => Object.keys(r).filter((k) => k !== 'omit')))];
      const of = stepId === 126 ? `, within ${current.ids.length} found` : '';
      throw new ScriptError(ERROR.noRecords, `No records match the request (by ${asked.join(', ')}${of})`);
    }
  }

  /** The variables a stored find request names that are empty now (so their criteria were dropped). */
  private emptyVariables(f: Frame, p: StepParams): string[] {
    const names = new Set((p.requests ?? []).flatMap((r) => r.criteria.flatMap((c) => c.criteria.match(/\$\$?[\p{L}\p{N}_.~]+/gu) ?? [])));
    return [...names].filter((v) => asText(this.getVariable(f, v, 1) ?? text('')) === '');
  }

  /** Requests with related criteria: a record matches when any related record does. */
  private findRelated(win: Window, info: LayoutInfo, query: FindRequest[]): number[] {
    const all = info.owner.findIds(info, this.reading);
    const found = new Set<number>(query[0]?.omit === true || query[0]?.omit === 'true' ? all : []);
    for (const { omit, ...criteria } of query) {
      const own: FindRequest = {};
      const byOccurrence = new Map<string, FindRequest>();
      for (const [k, v] of Object.entries(criteria)) {
        const at = k.indexOf('::');
        if (at < 0) own[k] = v;
        else byOccurrence.set(k.slice(0, at), { ...byOccurrence.get(k.slice(0, at)), [k.slice(at + 2)]: v });
      }
      let hits = Object.keys(own).length ? info.owner.findIds(info, { query: [own], ...this.reading }) : all;
      for (const [occurrence, c] of byOccurrence) {
        const other = win.store.occurrence(occurrence);
        const back = new Set(this.relatedIds(win, info.occurrence, { occurrence: other.occurrence, ids: other.owner.findIds(other, { query: [c], ...this.reading }) }));
        hits = hits.filter((x) => back.has(x));
      }
      const omitting = omit === 'true' || omit === true;
      for (const x of hits) {
        if (omitting) found.delete(x);
        else found.add(x);
      }
    }
    return all.filter((x) => found.has(x));
  }

  private quickFind(win: Window, phrase: string): void {
    this.commit(win);
    const info = this.layoutOf(win);
    const words = phrase.split(/\s+/).filter(Boolean);
    const fields = info.fields.filter((x) => x.type !== 'container');
    let ids: number[] | undefined;
    for (const w of words) {
      const hits = new Set(info.owner.findIds(info, { query: fields.map((x) => ({ [x.name]: w })), ...this.reading }));
      ids = (ids ?? info.owner.findIds(info, this.reading)).filter((x) => hits.has(x));
    }
    win.mode = 'browse';
    this.setFound(win, ids ?? info.owner.findIds(info, this.reading));
    if (!ids?.length && words.length) throw new ScriptError(ERROR.noRecords, 'No records match the request');
  }

  // --- network -----------------------------------------------------------------

  /**
   * Plug-in web and mail calls in outbound test mode: recorded, never sent.
   * A calculation can't wait for a reply, so even allowlisted hosts get none;
   * mail is captured but not copied to the redirect address.
   */
  private pluginOutbound(f: Frame, out: OutboundTest): PluginOutbound {
    const at = () => new Date().toISOString();
    return {
      request: (via, method, url, bodyBytes) => this.noteOutbound(out, {
        kind: 'http', at: at(), script: f.script.name, via, method, url: redactUrl(url), host: hostOf(url), allowed: false, requestBytes: bodyBytes,
      }),
      mail: (via, m) => {
        const attachments = m.attachments.flatMap((a) => {
          const path = this.sandboxPath(a);
          if (!path || !existsSync(path)) return [];
          const data = readFileSync(path);
          return [{ name: basename(path), size: data.length, ...(data.length <= OUTBOX_ATTACHMENT_LIMIT ? { data: data.toString('base64') } : {}) }];
        });
        this.noteOutbound(out, {
          kind: 'mail', at: at(), script: f.script.name, via, from: m.from,
          to: addresses(m.to), cc: addresses(m.cc), bcc: addresses(m.bcc), subject: m.subject, body: m.body, attachments,
        });
      },
    };
  }

  /**
   * Send Mail in outbound test mode: the message goes to the outbox with the
   * recipients the script named, and is never sent to them. With a delivery
   * set up, a copy goes to the redirect address only, saying who it was meant for.
   * The step's own SMTP settings are never used.
   */
  private async sendMail(f: Frame, p: StepParams, step: string): Promise<void> {
    const out = this.opts.outbound!;
    const m = p.mail ?? {};
    const calc = (x: string | undefined) => (x === undefined ? '' : asText(this.eval(f, x)));
    const attachments: { name: string; data: Uint8Array }[] = [];
    for (const a of m.attachments ?? []) {
      try {
        const { path } = this.filePath(f, { filePaths: [a] }, 'Send Mail', true);
        if (existsSync(path)) attachments.push({ name: basename(path), data: readFileSync(path) });
      } catch (e) {
        rethrowExecutionRefusal(e);
        if (!(e instanceof ScriptError)) throw e; // a missing attachment is left out
      }
    }
    const fromName = calc(m.fromName);
    const fromEmail = calc(m.fromEmail);
    const entry: OutboxMail = {
      kind: 'mail', at: new Date().toISOString(), script: f.script.name, via: step,
      from: fromName && fromEmail ? `${fromName} <${fromEmail}>` : fromEmail || fromName,
      to: addresses(calc(m.to)), cc: addresses(calc(m.cc)), bcc: addresses(calc(m.bcc)),
      subject: calc(m.subject), body: calc(m.message),
      attachments: attachments.map((x) => ({
        name: x.name, size: x.data.length,
        ...(x.data.length <= OUTBOX_ATTACHMENT_LIMIT ? { data: Buffer.from(x.data).toString('base64') } : {}),
      })),
    };
    // Every file on the call stack: mail from a capture-only file (a capture-only) is never delivered.
    const files = this.callStackFiles(f);
    const held = files.find((x) => captureOnly(x, out.captureOnly));
    if (held !== undefined && !out.copyHeld) entry.notCopied = `kept in the outbox only: "${held}" is capture-only`;
    else if (out.deliver && out.redirectTo) {
      const left = this.deadline - Date.now();
      this.hold(false);
      try {
        const sent = await out.deliver({ signal: this.aiSignal(), subject: TEST_SUBJECT_PREFIX + entry.subject, text: redirectedText(entry, f.store.name, held !== undefined), attachments, files });
        if (sent === false) entry.notCopied = 'the limit on test copies was reached';
        else if (typeof sent === 'string') entry.notCopied = sent;
        else entry.deliveredTo = out.redirectTo;
      } catch (e) {
        rethrowExecutionRefusal(e);
        entry.error = (e as Error).message;
      } finally {
        this.resumeAfter(left);
      }
    }
    this.noteOutbound(out, entry);
    if (entry.error) throw new ScriptError(ERROR.mailNotSent, `Send Mail: the test copy wasn't sent (${entry.error})`);
  }

  /** Send Mail via SMTP, with sending switched on: to the recipients the script names, never from a capture-only file. */
  private async sendSmtp(f: Frame, p: StepParams): Promise<void> {
    const m = p.mail ?? {};
    const files = this.callStackFiles(f);
    const held = files.find((x) => captureOnly(x));
    if (held !== undefined) throw new ScriptError(ERROR.unavailable, `Send Mail is not available: "${held}" is a capture-only file, and its scripts never send email`);
    const calc = (x: string | undefined) => (x === undefined ? '' : asText(this.eval(f, x)));
    const attachments: { name: string; data: Uint8Array }[] = [];
    for (const a of m.attachments ?? []) {
      const { path } = this.filePath(f, { filePaths: [a] }, 'Send Mail', true);
      // FileMaker doesn't send a message whose attachment is missing.
      if (!existsSync(path)) throw new ScriptError(ERROR.mailNotSent, `Send Mail: the attachment "${basename(path)}" wasn't found`);
      attachments.push({ name: basename(path), data: readFileSync(path) });
    }
    // "Name <address>" gives the address.
    const bare = (list: string) => addresses(list).map((a) => /<([^<>]*)>\s*$/.exec(a)?.[1].trim() ?? a);
    const replyTo = bare(calc(m.fromEmail))[0];
    const message: OutgoingMail = {
      to: bare(calc(m.to)), cc: bare(calc(m.cc)), bcc: bare(calc(m.bcc)),
      subject: calc(m.subject), text: calc(m.message), fromName: calc(m.fromName), ...(replyTo ? { replyTo } : {}), attachments, files,
    };
    const left = this.deadline - Date.now();
    this.hold(false);
    let refused: void | string;
    try {
      refused = await this.scriptOutbound(() => this.opts.mail!({ ...message, signal: this.aiSignal() }));
    } catch (e) {
      throw new ScriptError(ERROR.mailNotSent, `Send Mail: the message wasn't sent (${(e as Error).message})`);
    } finally {
      this.resumeAfter(left);
    }
    if (typeof refused === 'string') throw new ScriptError(ERROR.unavailable, `Send Mail is not available: ${refused}`);
  }

  /** The file whose scripts can't make web requests here: the one that started a run with no network, or one on the call stack that hasn't been allowed it. */
  private networkBlocker(f: Frame): string | undefined {
    const check = this.opts.networkFiles;
    const blocked = check ? this.callStackFiles(f).find((x) => !check(x)) : undefined;
    return this.opts.network ? blocked : blocked ?? f.store.name;
  }

  /** Why web requests can't be made from here, or undefined when they can. Test mode records requests instead, so it is never asked. */
  private networkRefusal(f: Frame): string | undefined {
    const file = this.networkBlocker(f);
    if (file === undefined) return undefined;
    const off = this.opts.networkOff;
    return off ? off(file) : this.opts.network ? `Network access is off for "${file}"` : 'Network access is off for scripts (allow it with the network option)';
  }

  /** The offline switch applies before either ordinary URLs or connections are dispatched. */
  private requireScriptNetwork(f: Frame): typeof fetch {
    const out = this.opts.outbound;
    if (!out) {
      const why = this.networkRefusal(f);
      if (why) throw new ScriptError(ERROR.unavailable, why);
    }
    return out ? this.scriptFetch(out.allowHosts, out.fetch) : this.scriptFetch();
  }

  private async insertFromUrl(f: Frame, p: StepParams): Promise<void> {
    const doFetch = this.requireScriptNetwork(f);
    const out = this.opts.outbound;
    const url = asText(this.eval(f, p.calculation ?? ''));
    // connection://name/path goes through a connection set up in the admin console, which adds its credentials.
    if (/^connection:/i.test(url)) return this.insertViaConnection(f, p, url);
    // A URL that isn't one is 1630; another protocol (ftp, file and so on) is 1626, as only http and https are reached here.
    requireScriptUrl(url);
    const curl = p.slots?.[129] !== undefined ? parseCurl(asText(this.eval(f, p.slots[129])), (v) => this.getVariable(f, v, 1)) : undefined;
    const request = curlRequest(url, curl);
    if (curl?.awsSigv4) {
      // --aws-sigv4 replaces the Basic header --user would send; a form upload has no single body to sign.
      if (request.body !== undefined && typeof request.body !== 'string' && !(request.body instanceof Uint8Array)) throw new ScriptError(ERROR.unavailable, '--aws-sigv4 signs --data or --data-binary, not a form upload');
      try {
        request.headers = signSigV4({ method: request.method, url: request.url, headers: request.headers ?? {}, body: request.body }, curl.awsSigv4, new Date());
      } catch (e) {
        throw new ScriptError(ERROR.urlFormat, `Insert from URL: ${(e as Error).message}`);
      }
    }
    const { method } = request;
    const limits = this.urlLimits(curl);
    try {
      const { signal } = limits;
      // A capture-only file (anywhere on the call stack) never reaches the network, whatever the server allows.
      const held = this.callStackFiles(f).find((x) => captureOnly(x, out?.captureOnly));
      if (held !== undefined && !out) throw new ScriptError(ERROR.unavailable, `Insert from URL is not available: "${held}" is a capture-only file, and its scripts never reach the network`);
      if (out) {
        // Test mode: only allowlisted hosts are reached; every request is recorded, without credentials.
        const entry: OutboxRequest = {
          kind: 'http', at: new Date().toISOString(), script: f.script.name, via: 'Insert from URL', method,
          // The address as the script wrote it: -G's data is counted, not recorded.
          url: redactUrl(url), host: hostOf(url), allowed: held === undefined && hostAllowed(url, out.allowHosts), requestBytes: request.bytes,
        };
        if (!entry.allowed) {
          this.noteOutbound(out, entry);
          if (p.variable && !p.field) this.setVariable(f, p.variable, 1, text(''));
          else this.setField(f, p, text(''));
          return;
        }
        try {
          // Redirects are followed by hand so each hop is checked against the allowlist.
          let res = await fetchWithCurlAuth(doFetch, request.url, { method, headers: request.headers, body: request.body as BodyInit | undefined, redirect: 'manual', signal }, curl);
          limits.begun();
          for (let hop = 0, at = request.url; res.status >= 300 && res.status < 400 && res.headers.get('location'); hop++) {
            await res.body?.cancel().catch(() => {});
            at = new URL(res.headers.get('location')!, at).toString();
            if (hop >= 5 || !hostAllowed(at, out.allowHosts)) throw new Error(`redirected to ${hop >= 5 ? 'too many places' : `${hostOf(at)}, which is not allowed`}`);
            res = await doFetch(at, { method: curl?.head ? 'HEAD' : 'GET', redirect: 'manual', signal });
          }
          const bytes = await readCapped(res, ...urlCap(curl));
          Object.assign(entry, { status: res.status, responseBytes: bytes.length });
          this.noteOutbound(out, entry);
          if (!res.ok && curl?.fail) throw new ScriptError(ERROR.network, `The address answered HTTP ${res.status}, which --fail counts as an error`);
          this.storeUrlResponse(f, p, res, curl?.head ? headerText(res) : bytes, url, curl?.head, curl?.containerResult);
          return;
        } catch (e) {
          if (this.stopSignal?.aborted) this.canceled(f.script.name);
          rethrowExecutionRefusal(e);
          if (e instanceof ScriptError) throw e;
          entry.error = (e as Error).message;
          this.noteOutbound(out, entry);
          throw new ScriptError(ERROR.network, `Insert from URL failed: ${networkProblem(e)}`);
        }
      }
      let res: Response;
      let bytes: Uint8Array;
      try {
        res = await fetchWithCurlAuth(doFetch, request.url, { method, headers: request.headers, body: request.body as BodyInit | undefined, signal }, curl);
        limits.begun();
        bytes = await readCapped(res, ...urlCap(curl));
        if (curl?.dumpHeaders) this.setVariable(f, curl.dumpHeaders, 1, text(new TextDecoder().decode(headerText(res))));
        // -I: the response's headers are the result, as cURL prints them.
        if (curl?.head) bytes = headerText(res);
        if (!res.ok && curl?.fail) throw new ScriptError(ERROR.network, `The address answered HTTP ${res.status}, which --fail counts as an error`);
      } catch (e) {
        if (this.stopSignal?.aborted) this.canceled(f.script.name);
        rethrowExecutionRefusal(e);
        if (e instanceof ScriptError) throw e;
        throw new ScriptError(ERROR.network, `Insert from URL failed: ${networkProblem(e)}`);
      }
      this.storeUrlResponse(f, p, res, bytes, url, curl?.head, curl?.containerResult);
    } finally {
      limits.dispose();
    }
  }

  /**
   * Insert from URL through a connection (connection://name/path?query): the connection signs the request with
   * credentials the script never sees and answers like any web response. Refused for a capture-only file anywhere
   * on the call stack, and in outbound test mode recorded and sent only to an allowlisted host.
   */
  private async insertViaConnection(f: Frame, p: StepParams, url: string): Promise<void> {
    const out = this.opts.outbound;
    const connections = this.opts.connections;
    const address = parseConnectionUrl(url);
    if (!address) throw new ScriptError(ERROR.urlFormat, 'A connection address looks like connection://name/folder/file (the name is the connection\'s, from the admin console)');
    if (!connections) throw new ScriptError(ERROR.unavailable, `Insert from URL can't use the connection ${address.name}: this server has no connections`);
    const curl = p.slots?.[129] !== undefined ? parseCurl(asText(this.eval(f, p.slots[129])), (v) => this.getVariable(f, v, 1)) : undefined;
    if (curl?.awsSigv4) throw new ScriptError(ERROR.unavailable, 'A connection adds its own credentials, so --aws-sigv4 is not used with one');
    const request = curlRequest(url, curl);
    const { method } = request;
    // -G moves data into the query, as for any address.
    const sent = parseConnectionUrl(request.url) ?? address;
    if (request.body !== undefined && typeof request.body !== 'string' && !(request.body instanceof Uint8Array)) {
      throw new ScriptError(ERROR.unavailable, 'A connection takes --data or --data-binary, not a form upload');
    }
    const body = typeof request.body === 'string' ? new TextEncoder().encode(request.body) : request.body;
    const files = this.callStackFiles(f);
    // A capture-only file (anywhere on the call stack) never gets a connection, whatever the server allows.
    const held = files.find((x) => captureOnly(x, out?.captureOnly));
    if (held !== undefined && !out) throw new ScriptError(ERROR.unavailable, `Insert from URL is not available: "${held}" is a capture-only file, and its scripts never reach the network`);
    const limits = this.urlLimits(curl);
    try {
      const { signal } = limits;
      const host = connections.host(address.name);
      if (out) {
        const entry: OutboxRequest = {
          kind: 'http', at: new Date().toISOString(), script: f.script.name, via: `Insert from URL (connection ${address.name})`, method,
          url: redactUrl(`https://${host ?? address.name}${sent.path}${sent.query}`).replace(/^https:\/\//, 'connection://'), host: host ?? address.name,
          allowed: held === undefined && host !== undefined && hostAllowed(`https://${host}`, out.allowHosts), requestBytes: request.bytes,
        };
        if (!entry.allowed) {
          this.noteOutbound(out, entry);
          if (p.variable && !p.field) this.setVariable(f, p.variable, 1, text(''));
          else this.setField(f, p, text(''));
          return;
        }
        try {
          const res = await this.throughConnection(connections, address.name, method, sent, request.headers ?? {}, body, files, signal);
          limits.begun();
          const bytes = await readCapped(res, ...urlCap(curl));
          Object.assign(entry, { status: res.status, responseBytes: bytes.length });
          this.noteOutbound(out, entry);
          if (!res.ok && curl?.fail) throw new ScriptError(ERROR.network, `The address answered HTTP ${res.status}, which --fail counts as an error`);
          this.storeUrlResponse(f, p, res, curl?.head ? headerText(res) : bytes, url, curl?.head, curl?.containerResult);
          return;
        } catch (e) {
          if (this.stopSignal?.aborted) this.canceled(f.script.name);
          if (e instanceof ScriptError) throw e;
          entry.error = (e as Error).message;
          this.noteOutbound(out, entry);
          throw new ScriptError(ERROR.network, `Insert from URL failed: ${networkProblem(e)}`);
        }
      }
      let res: Response;
      let bytes: Uint8Array;
      try {
        res = await this.throughConnection(connections, address.name, method, sent, request.headers ?? {}, body, files, signal);
        limits.begun();
        bytes = await readCapped(res, ...urlCap(curl));
        if (curl?.dumpHeaders) this.setVariable(f, curl.dumpHeaders, 1, text(new TextDecoder().decode(headerText(res))));
        if (curl?.head) bytes = headerText(res);
        if (!res.ok && curl?.fail) throw new ScriptError(ERROR.network, `The address answered HTTP ${res.status}, which --fail counts as an error`);
      } catch (e) {
        if (this.stopSignal?.aborted) this.canceled(f.script.name);
        if (e instanceof ScriptError) throw e;
        throw new ScriptError(ERROR.network, `Insert from URL failed: ${networkProblem(e)}`);
      }
      this.storeUrlResponse(f, p, res, bytes, url, curl?.head, curl?.containerResult);
    } finally {
      limits.dispose();
    }
  }

  private async throughConnection(
    connections: ScriptConnections, name: string, method: string, address: { path: string; query: string },
    headers: Record<string, string>, body: Uint8Array | undefined, files: readonly string[], signal?: AbortSignal,
  ): Promise<Response> {
    signal?.throwIfAborted();
    const call = this.scriptOutbound(() => connections.request(name, { method, path: address.path, query: address.query, headers, ...(body ? { body } : {}), ...(signal ? { signal } : {}) }, files));
    return signal ? untilCanceled(call, signal) : call;
  }

  /**
   * The abort signal for one request. --max-time bounds all of it; --connect-timeout only until the response begins
   * (`begun`, called once the answer's headers are in), as fetch cannot tell connecting from waiting for the first byte.
   */
  private urlLimits(curl: ReturnType<typeof parseCurl> | undefined): { signal: AbortSignal; begun(): void; dispose(): void } {
    const lifetime = this.scriptOutbound(() => outboundDeadline([this.aiSignal()], curl?.timeout));
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (curl?.connectTimeout) {
      timer = setTimeout(() => lifetime.abort(new Error('the connection timed out (--connect-timeout)')), curl.connectTimeout);
      timer.unref();
    }
    return { signal: lifetime.signal, begun: () => clearTimeout(timer), dispose() { clearTimeout(timer); lifetime.dispose(); } };
  }

  /**
   * Insert from URL's response into its target: into a container field, or a variable when the response isn't text
   * (an image, a PDF), as a file named after the URL's last path part (or the Content-Disposition name); otherwise as
   * text, decoded by the response's charset (UTF-8 when it names none or one this can't read).
   */
  private storeUrlResponse(f: Frame, p: StepParams, res: Response, bytes: Uint8Array, url: string, headers = false, asContainer = false): void {
    this.canceled(f.script.name);
    // -I's result is the headers' text, whatever the response says it is.
    const type = headers ? 'text/plain' : res.headers.get('content-type') ?? '';
    const toVariable = !!p.variable && !p.field;
    // No field named: the active one, as setField below writes to.
    const target = toVariable ? undefined : p.field ?? this.activeTarget(this.current);
    const intoContainer = !!target && this.resolveTarget(f, target).field.type === 'container';
    const textual = !type || /^text\/|[+/](json|xml|javascript|ecmascript|x-www-form-urlencoded|csv)\b|charset=/i.test(type);
    let value: Value;
    if (intoContainer || (toVariable && (!textual || (asContainer && !headers)))) {
      const disposition = /filename\*?=(?:[\w-]*'[\w-]*')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1];
      // The address it ended up at, after any redirects.
      let name = disposition ?? new URL(res.url || url).pathname.split('/').pop() ?? '';
      try {
        name = decodeURIComponent(name);
      } catch { /* kept as it came */ }
      name = name.replace(/[\/\\:\0]/g, '_').trim() || 'file';
      value = { type: 'container', value: name, data: bytes };
    } else {
      const charset = /charset="?([\w.:-]+)/i.exec(type)?.[1];
      let decoder: TextDecoder;
      try {
        decoder = new TextDecoder(charset ?? 'utf-8');
      } catch {
        decoder = new TextDecoder('utf-8');
      }
      value = text(decoder.decode(bytes));
    }
    if (toVariable) this.setVariable(f, p.variable!, 1, value);
    else this.setField(f, p, value);
  }
}

function findScript(store: Store, name: string): Script | undefined {
  return store.schema.scripts.find((s) => s.name === name) ?? store.schema.scripts.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

/** Empties every table (and the container files) of a saved copy: what makes it a clone. */
function clearRecords(path: string, schema: Schema): void {
  const db = new DatabaseSync(path);
  defineFold(db); // deleting records fires the word index triggers
  try {
    const tables = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name));
    db.exec('BEGIN');
    for (const t of schema.tables) if (tables.has(t.name)) db.exec(`DELETE FROM "${t.name.replace(/"/g, '""')}"`);
    for (const t of ['_fm_containers', '_fm_container_chunks', '_fm_audit', '_fm_user_prefs', '_fm_pii_vault']) if (tables.has(t)) db.exec(`DELETE FROM ${t}`);
    db.exec('COMMIT');
    db.exec('VACUUM');
  } finally {
    db.close();
  }
}

type RelPath = { rel: Relationship; forward: boolean }[];
const pathCache = new WeakMap<Schema, Map<string, RelPath | undefined>>();

/** Shortest path between two table occurrences over the relationship graph (remembered per schema: related reads ask often). */
function relationshipPath(schema: Schema, from: string, to: string): RelPath | undefined {
  let cache = pathCache.get(schema);
  if (!cache) pathCache.set(schema, (cache = new Map()));
  const key = `${from.toLowerCase()}\u0000${to.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  const path = findPath(schema, from, to);
  cache.set(key, path);
  return path;
}

function findPath(schema: Schema, from: string, to: string): RelPath | undefined {
  const start = schema.tableOccurrences.find((t) => t.name.toLowerCase() === from.toLowerCase());
  const goal = schema.tableOccurrences.find((t) => t.name.toLowerCase() === to.toLowerCase());
  if (!start || !goal) return undefined;
  if (start.id === goal.id) return [];
  const prev = new Map<number, { rel: Relationship; forward: boolean; from: number }>();
  const queue = [start.id];
  const seen = new Set(queue);
  while (queue.length) {
    const at = queue.shift()!;
    for (const rel of schema.relationships) {
      const forward = rel.leftTableOccurrenceId === at;
      if (!forward && rel.rightTableOccurrenceId !== at) continue;
      const next = forward ? rel.rightTableOccurrenceId : rel.leftTableOccurrenceId;
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { rel, forward, from: at });
      if (next === goal.id) {
        const path: { rel: Relationship; forward: boolean }[] = [];
        for (let n = goal.id; n !== start.id;) {
          const p = prev.get(n)!;
          path.unshift({ rel: p.rel, forward: p.forward });
          n = p.from;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return undefined;
}

/** A response's status line and headers, as cURL's -D and -I give them (lines end in a carriage return). */
function headerText(res: Response): Uint8Array {
  return new TextEncoder().encode(`HTTP/1.1 ${res.status} ${res.statusText}\r` + [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\r'));
}

/** A file a cURL -F part uploads: a container variable's data, with its name. */
type CurlPart = string | { name: string; data: Uint8Array; type?: string };

/**
 * The cURL options Insert from URL takes that matter for a request; @$var reads a variable. Options that name files
 * on disk (-T, -o, --cookie-jar, -F name=@file) aren't followed: scripts reach files only through their own steps.
 */
export function parseCurl(options: string, variable: (name: string) => Value | undefined): {
  method?: string; headers: Record<string, string>; data?: string; dumpHeaders?: string; fail?: boolean;
  get?: boolean; head?: boolean; form?: [string, CurlPart][]; timeout?: number;
  /** -u's "user:password" when --digest or --anyauth waits for the server's challenge instead of sending Basic at once. */
  user?: string; authMode?: 'digest' | 'any';
  /** --aws-sigv4 with the --user it is paired with. */
  awsSigv4?: { spec: string; user: string };
  /** --connect-timeout, in milliseconds: how long to wait for the server to begin answering. */
  connectTimeout?: number;
  /** --max-filesize: the most bytes a response may be. */
  maxFilesize?: number;
  /** --no-compressed: a compressed response is not asked for. */
  noCompressed?: boolean;
  /** --FM-return-container-variable: into a variable, the result is stored as a container whatever its type. */
  containerResult?: boolean;
  /** --data-binary @$var with a container in the variable: its file, sent as it is. */
  binary?: { name: string; data: Uint8Array };
} {
  const words: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(options));) words.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]);
  const read = (name: string) => variable(name);
  const containerOf = (w: string | undefined) => {
    const v = w?.startsWith('@$') ? read(w.slice(1)) : undefined;
    return v?.type === 'container' && v.data ? { value: v.value, data: v.data } : undefined;
  };
  const value = (w: string) => (w.startsWith('@$') ? asText(read(w.slice(1)) ?? text('')) : w);
  const out: ReturnType<typeof parseCurl> = { headers: {} };
  let user: string | undefined;
  let mode: 'digest' | 'any' | undefined;
  let sigv4: string | undefined;
  const addData = (d: string) => { out.data = (out.data ? out.data + '&' : '') + d; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const arg = () => value(words[++i] ?? '');
    if (w === '-X' || w === '--request') out.method = arg().toUpperCase();
    else if (w === '-H' || w === '--header') {
      for (const line of arg().split(/\r|\n/)) {
        const at = line.indexOf(':');
        if (at > 0) out.headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
    } else if (w === '--data-binary' && containerOf(words[i + 1])) {
      const got = containerOf(words[++i])!;
      out.binary = { name: String(got.value || 'file'), data: got.data };
    } else if (w === '-d' || w === '--data' || w === '--data-raw' || w === '--data-binary' || w === '--data-ascii') addData(arg());
    else if (w === '--data-urlencode') {
      // "content", "=content" or "name=content": only the content is encoded, as cURL does.
      const d = arg();
      const at = d.indexOf('=');
      addData(at < 0 ? encodeURIComponent(d) : (at > 0 ? d.slice(0, at) + '=' : '') + encodeURIComponent(d.slice(at + 1)));
    } else if (w === '-F' || w === '--form' || w === '--form-string') {
      const d = words[++i] ?? '';
      const at = d.indexOf('=');
      if (at <= 0) continue;
      const name = d.slice(0, at);
      let v = d.slice(at + 1);
      // ;type=, ;filename= and ;headers= describe the part rather than belong to its value, as in cURL.
      const opts: Record<string, string> = {};
      if (w !== '--form-string') {
        const cut = v.search(/;\s*(?:type|filename|headers|encoder)=/i);
        if (cut >= 0) {
          for (const m of v.slice(cut).matchAll(/;\s*(type|filename|headers|encoder)=("[^"]*"|[^;]*)/gi)) opts[m[1].toLowerCase()] = m[2].replace(/^"|"$/g, '');
          v = v.slice(0, cut);
        }
      }
      // name=@$var uploads the variable: a container's file, or its text as a file.
      if (w !== '--form-string' && (v.startsWith('@$') || v.startsWith('<$'))) {
        const got = read(v.slice(1));
        const file = (fallback: string, data: Uint8Array): CurlPart => ({ name: opts.filename || fallback, data, type: opts.type });
        if (got?.type === 'container' && got.data) out.form = [...(out.form ?? []), [name, file(String(got.value || 'file'), got.data)]];
        else if (v.startsWith('<$')) out.form = [...(out.form ?? []), [name, asText(got ?? text(''))]];
        else out.form = [...(out.form ?? []), [name, file('file', new TextEncoder().encode(asText(got ?? text(''))))]];
        continue;
      }
      if (w !== '--form-string' && (v.startsWith('@') || v.startsWith('<'))) continue;
      out.form = [...(out.form ?? []), [name, v]];
    } else if (w === '-G' || w === '--get') out.get = true;
    else if (w === '-I' || w === '--head') out.head = true;
    else if (w === '-D' || w === '--dump-header') out.dumpHeaders = words[++i];
    else if (w === '-f' || w === '--fail') out.fail = true;
    else if (w === '-u' || w === '--user') user = arg();
    else if (w === '--basic') mode = undefined;
    else if (w === '--digest') mode = 'digest';
    else if (w === '--anyauth') mode = 'any';
    else if (w === '--aws-sigv4') sigv4 = arg();
    else if (w === '--oauth2-bearer') out.headers.Authorization = 'Bearer ' + arg();
    else if (w === '-A' || w === '--user-agent') out.headers['User-Agent'] = arg();
    else if (w === '-e' || w === '--referer') out.headers.Referer = arg();
    else if (w === '-b' || w === '--cookie') {
      // Without an "=" cURL reads cookies from a file, which isn't followed.
      const c = arg();
      if (c.includes('=')) out.headers.Cookie = c;
    } else if (w === '-m' || w === '--max-time') {
      const n = Number(arg());
      // Whole milliseconds, within what a timer can wait (2.01 × 1000 isn't a whole number in floating point).
      if (n > 0 && Number.isFinite(n)) out.timeout = Math.max(1, Math.min(Math.round(n * 1000), 2 ** 31 - 1));
    } else if (w === '--connect-timeout') {
      const n = Number(arg());
      if (n > 0 && Number.isFinite(n)) out.connectTimeout = Math.max(1, Math.min(Math.round(n * 1000), 2 ** 31 - 1));
    } else if (w === '--max-filesize') {
      const n = Number(arg());
      if (n >= 0 && Number.isFinite(n)) out.maxFilesize = Math.floor(n);
    } else if (w === '--no-compressed') out.noCompressed = true;
    else if (w === '--FM-return-container-variable') out.containerResult = true;
  }
  if (sigv4 !== undefined) out.awsSigv4 = { spec: sigv4, user: user ?? '' };
  // -u is Basic, sent with the first request, unless --digest or --anyauth wait for the server to say what it accepts
  // (--aws-sigv4 signs the request itself and replaces the header).
  if (user !== undefined) {
    if (mode && sigv4 === undefined) Object.assign(out, { user, authMode: mode });
    else out.headers.Authorization = 'Basic ' + Buffer.from(user).toString('base64');
  }
  return out;
}

/** Ordinary Insert from URL requests support only well-formed HTTP(S) addresses. */
function requireScriptUrl(url: string): void {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) || !URL.canParse(url)) throw new ScriptError(ERROR.urlFormat, 'Insert from URL was given text that is not a URL');
  if (!/^https?:\/\//i.test(url)) throw new ScriptError(ERROR.protocol, `Insert from URL can't use ${/^[a-z][a-z0-9+.-]*:/i.exec(url)![0]} (http and https only)`);
}

/**
 * One request, answered again with credentials when --digest or --anyauth asked for that and the server answers 401 with a
 * challenge it can be given: Digest if offered (--digest needs it; --anyauth prefers it), else Basic for --anyauth.
 * Without those options this is a plain fetch. The first request carries no credentials, as in cURL.
 */
export async function fetchWithCurlAuth(
  doFetch: (url: string, init: RequestInit) => Promise<Response>, url: string, init: RequestInit,
  curl: Pick<ReturnType<typeof parseCurl>, 'user' | 'authMode'> | undefined,
): Promise<Response> {
  const res = await doFetch(url, init);
  if (!curl?.authMode || curl.user === undefined || res.status !== 401) return res;
  const colon = curl.user.indexOf(':');
  const [user, password] = colon < 0 ? [curl.user, ''] : [curl.user.slice(0, colon), curl.user.slice(colon + 1)];
  const header = res.headers.get('www-authenticate');
  const digest = parseDigestChallenge(header);
  let authorization: string | undefined;
  if (digest) {
    const at = new URL(url);
    authorization = digestAuthorization(digest, { method: init.method ?? 'GET', uri: at.pathname + at.search, user, password });
  } else if (curl.authMode === 'any' && /(?:^|[\s,])Basic\s/i.test(header ?? '')) authorization = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  if (!authorization) return res;
  await res.body?.cancel().catch(() => {});
  return doFetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: authorization } });
}

/**
 * What a parsed cURL request sends: its method, address (-G moves the data into the query), headers and body. Like
 * cURL, -d data is sent as a form unless a Content-Type is given, and a form upload keeps its own boundary.
 */
export function curlRequest(url: string, curl: ReturnType<typeof parseCurl> | undefined): {
  method: string; url: string; headers?: Record<string, string>; body?: string | FormData | Uint8Array; bytes: number;
} {
  if (!curl) return { method: 'GET', url, bytes: 0 };
  // By default a compressed response is asked for; --no-compressed turns that off (a header the script gave stays).
  if (curl.noCompressed && !Object.keys(curl.headers).some((k) => k.toLowerCase() === 'accept-encoding')) curl = { ...curl, headers: { ...curl.headers, 'Accept-Encoding': 'identity' } };
  const typed = Object.keys(curl.headers).find((k) => k.toLowerCase() === 'content-type');
  if (curl.get || curl.head) {
    if (curl.data === undefined) return { method: curl.method ?? (curl.head ? 'HEAD' : 'GET'), url, headers: curl.headers, bytes: 0 };
    // cURL leaves out the fragment, which would otherwise swallow the query.
    const u = new URL(url);
    u.hash = '';
    u.search = (u.search ? u.search.slice(1) + '&' : '') + curl.data;
    return { method: curl.method ?? (curl.head ? 'HEAD' : 'GET'), url: u.toString(), headers: curl.headers, bytes: Buffer.byteLength(curl.data) };
  }
  if (curl.binary && !curl.form) {
    // A file sent as it is: its own type unless the script named one.
    const headers = typed ? curl.headers : { ...curl.headers, 'Content-Type': containerMime('', curl.binary.name, curl.binary.data) };
    return { method: curl.method ?? 'POST', url, headers, body: curl.binary.data, bytes: curl.binary.data.length };
  }
  if (curl.form) {
    const form = new FormData();
    let bytes = 0;
    for (const [name, part] of curl.form) {
      if (typeof part === 'string') {
        form.append(name, part);
        bytes += Buffer.byteLength(part);
      } else {
        form.append(name, new Blob([part.data as Uint8Array<ArrayBuffer>], part.type ? { type: part.type } : {}), part.name);
        bytes += part.data.length;
      }
    }
    // A multipart Content-Type the script gave has no boundary; the one fetch writes does.
    const headers = { ...curl.headers };
    if (typed && /^multipart\/form-data/i.test(headers[typed])) delete headers[typed];
    return { method: curl.method ?? 'POST', url, headers, body: form, bytes };
  }
  const headers = curl.data !== undefined && !typed ? { ...curl.headers, 'Content-Type': 'application/x-www-form-urlencoded' } : curl.headers;
  return { method: curl.method ?? (curl.data !== undefined ? 'POST' : 'GET'), url, headers, body: curl.data, bytes: Buffer.byteLength(curl.data ?? '') };
}

/** Runs a script by name: the entry point the Data API and MCP server use. */
export function runScript(store: Store, script: string | Script, opts: RunOptions = {}): Promise<RunResult> {
  return new ScriptEngine(opts).run(store, script);
}

/** Field names a formula reads (qualified or not). */
function fieldsUsed(formula: string): string[] {
  try {
    return compile(formula).fields.map((x) => x.name);
  } catch {
    return [];
  }
}

/** A JavaScript date as a FileMaker date, time or timestamp (local time). */
function toValue(d: Date, type: 'date' | 'time' | 'timestamp'): Value {
  const day = dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const seconds = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  if (type === 'date') return { type, value: day };
  if (type === 'time') return { type, value: seconds };
  return { type, value: (day - 1) * 86400 + seconds };
}

const resolved = new WeakMap<Store, Map<string, string>>();

/** Names fields of other files' tables in a formula (the reader leaves them as ⟨field:TO.field⟩). */
function resolveExternal(store: Store, formula: string): string {
  if (!formula.includes('⟨field:')) return formula;
  let cache = resolved.get(store);
  if (!cache) resolved.set(store, (cache = new Map()));
  let out = cache.get(formula);
  if (out === undefined) {
    out = externalFieldNames(formula, (toId, fieldId) => {
      const to = store.schema.tableOccurrences.find((t) => t.id === toId);
      if (!to) return undefined;
      try {
        const info = store.occurrence(to.name);
        const field = info.owner.schema.tables.find((t) => t.name === info.table)?.fields.find((x) => x.id === fieldId);
        return field ? `${to.name}::${field.name}` : undefined;
      } catch (e) {
        rethrowExecutionRefusal(e);
        return undefined;
      }
    });
    cache.set(formula, out);
  }
  return out;
}

function encodeText(s: string, encoding: 'utf-8' | 'utf-16'): Uint8Array {
  return encoding === 'utf-8' ? new TextEncoder().encode(s) : new Uint8Array(Buffer.from(s, 'utf16le'));
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * Rows of a file to import, by its name (or the step's import format): comma-
 * or tab-separated text, an Excel workbook or FileMaker XML.
 */
/** A merge file: comma-separated, with the field names in its first record. */
const isMerge = (name: string, importFormat?: string) => importFormat === 'MRGE' || (!importFormat && /\.mer$/i.test(name));

/** Between the values of a repeating field in exported and imported text (ASCII 29). */
const GROUP_SEPARATOR = '\u001d';

/**
 * Applies the XSLT style sheet a step names to XML text, as Claris does before an import reads it. A document or
 * style sheet that does not parse is error 718, any other fault of the transform 719.
 */
function transformXml(xml: string, stylesheet: string): string {
  try {
    return applyXslt(xml, stylesheet.replace(/\r\n?/g, '\n'));
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (!(e instanceof XsltError)) throw e;
    throw new ScriptError(/^Bad (source XML|stylesheet)/.test(e.message) ? ERROR.xmlParse : ERROR.xslTransform, `The XSLT style sheet could not be applied: ${e.message}`);
  }
}

/**
 * `stylesheet` (the text of an XSLT style sheet) is applied to an XML source first; its result must be FMPXMLRESULT.
 * `worksheet` names the sheet of an Excel workbook to read (the first when left out); a text file that holds a
 * quote it never closes adds a sentence to `notices` saying where, since everything after it is read as one value.
 */
export function* importFileRowIterator(name: string, data: Uint8Array, importFormat?: string, stylesheet?: string, options: { worksheet?: string; notices?: string[] } = {}): Generator<(string | number)[]> {
  if (stylesheet !== undefined) {
    if (/\.xlsx$/i.test(name) || importFormat?.startsWith('XLX')) throw new ScriptError(ERROR.unavailable, 'An XSLT style sheet applies to an XML source, not an Excel workbook');
    yield* fmpXmlRowIterator(transformXml(decodeText(data), stylesheet), ERROR.xmlGrammar);
    return;
  }
  if (/\.xlsx$/i.test(name) || importFormat?.startsWith('XLX')) {
    try {
      yield* readXlsx(Buffer.from(data), options.worksheet || undefined);
      return;
    } catch (e) {
      if (e instanceof MissingSheetError) throw new ScriptError(ERROR.missingWorksheet, `The Excel worksheet is missing: ${e.message}`);
      if (e instanceof SheetLimitError) throw new ScriptError(ERROR.wrongFileType, `${name} can't be imported: ${e.message}`);
      throw new ScriptError(ERROR.wrongFileType, `${name} is not an Excel workbook FileMaker can import (${e instanceof Error ? e.message : e})`);
    }
  }
  const src = decodeText(data);
  if (/\.xml$/i.test(name)) { yield* fmpXmlRowIterator(src); return; }
  const sep = textSeparator(name, importFormat, src);
  if (!sep) throw new ScriptError(ERROR.wrongFileType, `Importing ${importFormat ?? 'this kind of file'} is not supported (comma-, tab-, semicolon- and pipe-separated text, merge files, Excel workbooks, FileMaker XML and FileMaker files are)`);
  const report: { unclosedQuoteRow?: number } = {};
  const rows = parseDelimitedRows(src, DELIMITED_SEPARATORS[sep], false, report);
  for (const row of rows) {
    // FileMaker writes line breaks inside a value as vertical tabs in tab-separated and comma-separated text alike.
    for (let i = 0; i < row.length; i++) row[i] = row[i].replace(/\v/g, '\n');
    yield row;
  }
  if (report.unclosedQuoteRow) options.notices?.push(`A quote opened on row ${report.unclosedQuoteRow} is never closed, so everything after it was read as part of that value`);
}

/** Array-returning compatibility API for script and library callers. */
export function importFileRows(name: string, data: Uint8Array, importFormat?: string, stylesheet?: string, options: { worksheet?: string; notices?: string[] } = {}): (string | number)[][] {
  return [...importFileRowIterator(name, data, importFormat, stylesheet, options)];
}

/**
 * The separator a text file uses: the format the step names, else the file's kind (.mer commas, .tab and .tsv tabs,
 * .txt tabs unless every line has the same number of semicolons or pipes), and a .csv by what its first line holds, so
 * a semicolon or pipe file (what Excel writes in much of Europe) comes in as columns, not as one.
 */
function textSeparator(name: string, importFormat: string | undefined, src: string): keyof typeof DELIMITED_SEPARATORS | undefined {
  if (importFormat === 'MRGE' || importFormat === 'COMS') return 'csv';
  if (importFormat === 'TABS') return 'tab';
  if (/\.mer$/i.test(name)) return 'csv';
  if (/\.(tab|tsv)$/i.test(name)) return 'tab';
  if (/\.csv$/i.test(name)) return sniffSeparator(src);
  if (/\.txt$/i.test(name)) {
    // Text is tab-separated unless it plainly is not: a semicolon or pipe on every one of the first lines.
    if (/^[^\r\n]*\t/.test(src.replace(/^\ufeff/, ''))) return 'tab';
    const sniffed = sniffSeparator(src);
    const lines = src.split(/\r\n|[\r\n]/).filter(Boolean).slice(0, 20);
    const count = (line: string) => line.split(DELIMITED_SEPARATORS[sniffed]).length;
    return sniffed !== 'csv' && lines.length > 1 && count(lines[0]) > 1 && lines.every((l) => count(l) === count(lines[0])) ? sniffed : 'tab';
  }
  return undefined;
}

/**
 * An Excel date, time or timestamp is a serial number (days since 1899-12-30);
 * into a date, time or timestamp field it goes as that value, ISO-style.
 * Other numbers stay numbers.
 */
export function excelDate(v: number, type: string | undefined): string | number {
  if (type !== 'date' && type !== 'time' && type !== 'timestamp') return v;
  const ms = Math.round((v - 25569) * 86400000);
  const iso = new Date(ms).toISOString();
  if (type === 'date') return iso.slice(0, 10);
  if (type === 'time') return iso.slice(11, 19);
  return iso.slice(0, 19);
}

/** Rows of FileMaker XML (FMPXMLRESULT). Multiple DATA values require repetition support. */
function* fmpXmlRowIterator(xml: string, notXml: number = ERROR.unavailable): Generator<string[]> {
  if (!/<FMPXMLRESULT\b/.test(xml)) throw new ScriptError(notXml, 'Only FileMaker XML (FMPXMLRESULT) can be imported' + (notXml === ERROR.xmlGrammar ? '; the style sheet must produce it' : ''));
  // Dates and times are written as the file that made this showed them (DATEFORMAT, TIMEFORMAT), by field type.
  const attribute = (tag: string, name: string) => { const v = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]; return v === undefined ? undefined : unxml(v); };
  const database = xmlTags(xml, /<DATABASE\b[^>]*>/g).next().value?.[0] ?? '';
  const read = fmpXmlReader(attribute(database, 'DATEFORMAT'), attribute(database, 'TIMEFORMAT'));
  const types = [...xmlTags(xmlElements(xml, 'METADATA').next().value?.[1] ?? '', /<FIELD\b[^>]*>/g)].map((m) => (attribute(m[0], 'TYPE') ?? '').toUpperCase());
  // Scanned element by element, not by lazy regular expressions, which take quadratic time over tags never closed.
  for (const [, row] of xmlElements(xml, 'ROW')) {
    yield [...xmlElements(row ?? '', 'COL')].map(([, col], column) => {
      // A repeating field's values are one DATA each: they go in as repetitions, as group-separated text does.
      const values = [...xmlElements(col ?? '', 'DATA')];
      return values.map(([, d]) => read(types[column] ?? '', xmlText(d ?? ''))).join(GROUP_SEPARATOR);
    });
  }
}

function embeddingKey(account: string, model: string, input: string): string {
  return `${account.toLowerCase()}\u0000${model}\u0000${input}`;
}

function copyVariables(m: Map<string, Value[]>): Map<string, Value[]> {
  return new Map([...m].map(([k, v]) => [k, [...v]]));
}

function restoreVariables(m: Map<string, Value[]>, saved: Map<string, Value[]>): void {
  m.clear();
  for (const [k, v] of saved) m.set(k, v);
}
