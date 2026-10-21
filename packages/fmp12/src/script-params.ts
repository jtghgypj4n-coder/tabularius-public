// What a script step does: its options and targets, decoded from the step's
// 28-byte record and its parameter tree at 17.5.[script].5.[instance].
//
// Step record (bytes):
//   2-3     step instance id (keys the parameter tree)
//   4-5     unused (left-over bytes)
//   6-10    first reference: a length byte, then [length][path integer]. The
//           layout, script or table occurrence the step points at.
//   12-15   second reference, same shape: the field (after a table occurrence)
//   19      field repetition
//   20-21   step type id (negated when the step is disabled)
//   22-23   a choice: Go to Record's First/Last/..., Go to Layout's
//           original/named/by calculation, and so on
//   25      bit 1: on (Set Error Capture, Allow User Abort)
//   26      bit 6: the step has a calculation; bit 5: exit after last
//   27      bit 7: no dialog; bit 4: script in another file
// Parameter tree: slots numbered from 128, each a calculation (.5) or text (key 1).
// Verified against FileMaker's Database Design Report for the Flicks sample and
// against the step text of real solutions; see research/fmp12-format.md.

import { pathValue } from './chunks.ts';
import { decodeText, decodeTextChars } from './scsu.ts';
import type { Node } from './tree.ts';

export interface Ref {
  id: number;
  name: string;
}

export interface FieldRef {
  tableOccurrence: Ref;
  field: Ref;
  repetition?: number;
}

export interface FindCriterion {
  field: FieldRef;
  criteria: string;
}

export interface StoredFindRequest {
  omit: boolean;
  criteria: FindCriterion[];
  /**
   * Parts of the request the reader doesn't understand yet, by shape only
   * (key bytes and sizes, never the criteria), so a report can show why a
   * stored find came out empty.
   */
  unread?: string[];
}

export interface SortField {
  field: FieldRef;
  order: 'ascending' | 'descending' | 'custom';
  /** Custom sort's value list. Its binary reference is not decoded yet. */
  valueList?: Ref;
}

export type GoToRecordLocation = 'first' | 'last' | 'previous' | 'next' | 'calculation';

/** Decoded options of a script step. Calculations are formula text. */
/** Insert from Device's sources, as FileMaker names them. */
export const DEVICE_TYPES = ['Camera', 'Video Camera', 'Microphone', 'Photo Library', 'Music Library', 'Bar Code', 'Signature'] as const;
export type DeviceType = typeof DEVICE_TYPES[number];

export const WEB_VIEWER_ACTIONS = ['Reset', 'Reload', 'Go Back', 'Go Forward', 'Go to URL'] as const;
export type WebViewerAction = typeof WEB_VIEWER_ACTIONS[number];

export interface StepParams {
  /** Imported options whose semantics are unknown; diagnostic labels, never executable formulas. */
  undecodedOptions?: string[];
  /** Imported binary options whose encoding has not been established by generated fixtures. */
  unsupportedOptions?: string[];
  /** Perform Script on Server: false when "Wait for completion" is off (unset means wait). */
  wait?: boolean;
  /** Main formula: a condition, Set Field value, Exit Script result, count, URL, ... */
  calculation?: string;
  /** Revert Transaction: the custom error code (5000-5499) and message, as formulas. */
  errorCode?: string;
  errorMessage?: string;
  /** Field the step writes to or goes to. */
  field?: FieldRef;
  /** Insert Current Date / Time / User Name, Insert from Last Visited, Insert from Index: replace the whole field. */
  selectEntireContents?: boolean;
  /** Repetition of `field`, when it is a calculation. */
  repetitionCalculation?: string;
  /** Set Variable name, or the variable a step writes its result to. */
  variable?: string;
  /** Set Variable value. */
  value?: string;
  /** Set Variable repetition. */
  repetition?: string;
  /** Set Field By Name target (a formula giving "TO::field"). */
  fieldName?: string;
  layout?: Ref;
  layoutDestination?: 'original' | 'named' | 'name' | 'number';
  /** Layout name or number, for a layout chosen by calculation. */
  layoutCalculation?: string;
  /**
   * New Window's Window Style. Only Card is told apart in files so far: byte 26 bit 0x40 is clear on the Beezwax
   * samples' card window and set on every document, floating and dialog window in the samples (FMburgh, Flicks).
   */
  windowStyle?: 'document' | 'floating' | 'dialog' | 'card';
  /** Perform Script "Specified: By name": the calculation giving the script's name ("File::Script" for another file). */
  scriptCalculation?: string;
  script?: Ref & { file?: Ref };
  parameter?: string;
  /** Set Error Capture, Allow User Abort, Allow Formatting Bar, Enable Touch Keyboard, Set Layout Object Animation. */
  on?: boolean;
  /** Enable Touch Keyboard [ Toggle ]: switch the setting (then `on` isn't set). */
  toggle?: boolean;
  noDialog?: boolean;
  /**
   * Commit Records/Requests [ Skip data entry validation ]: fields validated "Only during data entry" aren't checked;
   * fields validated "Always" still are. Open Transaction's option of the same name does this for the whole transaction.
   */
  skipValidation?: boolean;
  /** Open Transaction "Skip auto-enter options": no auto-enter for records created or changed in the transaction. */
  skipAutoEnter?: boolean;
  location?: GoToRecordLocation;
  exitAfterLast?: boolean;
  /** Stored find requests or sort order are used (the step's Restore option). */
  restore?: boolean;
  requests?: StoredFindRequest[];
  sort?: SortField[];
  /** Sort Records by Field's order when the active field is used. */
  sortOrder?: SortField['order'];
  title?: string;
  message?: string;
  buttons?: string[];
  /**
   * Replace Field Contents: the current record's value in every record, or
   * serial numbers (from the field's entry options, or from `serial`'s
   * initial and increment values). A calculated result is `calculation`.
   */
  replaceWith?: 'current' | 'serial';
  serial?: { initial?: string; increment?: string; updateEntryOptions?: boolean };
  /**
   * Perform Find/Replace: what to find and replace with (formulas), the
   * operation, and the dialog's options, which FileMaker's text leaves out
   * (Tabularius writes "Match case", "Whole words", "Across: Current record",
   * "Within: All fields" or "Within: Current field").
   */
  findReplace?: {
    find: string; replace?: string; operation: 'Find Next' | 'Replace & Find' | 'Replace' | 'Replace All';
    matchCase?: boolean; wholeWords?: boolean; currentRecord?: boolean; within?: 'all' | 'current';
    /**
     * Only these fields ("Field" or "TO::Field" as the layout shows them): the
     * web client's Edit > Find/Replace sends the fields it can search (those on
     * the front panel, not pop-ups, checkboxes or radio buttons). Not in FileMaker's text.
     */
    fields?: string[];
  };
  /**
   * Send Mail: the recipients, subject and message as formulas, and the
   * attachments as file paths (or $variables). The step's SMTP settings
   * (server, account, password) are deliberately not read: Tabularius never
   * sends with them.
   */
  mail?: {
    to?: string; cc?: string; bcc?: string; subject?: string; message?: string;
    fromName?: string; fromEmail?: string; attachments?: string[];
    /** Send via SMTP Server rather than the e-mail client. */
    smtp?: boolean;
  };
  /** Show Custom Dialog: up to three input fields, each storing into a field or variable. */
  inputs?: DialogInput[];
  /** Show Custom Dialog: whether each button stores the inputs, when not the default (the second button doesn't). */
  commit?: boolean[];
  /** Insert Text. */
  text?: string;
  tableOccurrence?: Ref;
  /** Truncate Table: a base table of this file. */
  table?: Ref;
  objectName?: string;
  /** Refresh Window: related query caches; external data means ODBC, not other hosted files. */
  flushJoinResults?: boolean;
  flushExternalData?: boolean;
  /** Refresh Object: absent and calculated zero mean all repetitions; explicit 1 means the first. */
  objectRepetition?: string;
  /** Set Web Viewer: does not change the layout's viewer setup options. */
  viewerAction?: WebViewerAction;
  viewerUrl?: string;
  /** Perform JavaScript in Web Viewer: the function's name and its parameters, as formulas. */
  functionName?: string;
  jsParameters?: string[];
  /** Install Menu Set: the menu set (id 1 is [Standard FileMaker Menus]). */
  menuSet?: Ref;
  /** Install Menu Set: Use as file default. */
  fileDefault?: boolean;
  /** Open File, Close File: the file (an external data source); absent for the current file. */
  dataSource?: Ref;
  /** Export Field Contents and other file steps: the output file path list, as entered. */
  filePaths?: string[];
  /**
   * Insert from Device (FileMaker Go): what to take the value from, and which camera. Not decoded from files yet;
   * set from the step's text.
   */
  device?: { type: DeviceType; camera?: 'back' | 'front' };
  /** Import Records: the source format ("COMS" comma-separated, "TABS" tab-separated, "FMPR" a FileMaker file, ...). */
  importFormat?: string;
  /** Import Records from an Excel workbook: the sheet to read, by name (the first when left out). Set from the step's text (Worksheet: "Stock"). */
  worksheet?: string;
  /** Import Records from a FileMaker file: the source table occurrence (an id in the source file) and its fields, in column order. */
  importSource?: { tableOccurrenceId: number; fieldIds: number[] };
  /**
   * Import Records from a folder of files in the documents folder (the path is in filePaths): text files give
   * Text Content, File Name and File Path; picture, PDF and movie files give Image, File Name, File Path and
   * Image Thumbnail, in that column order. Set from the step's text; no fixture establishes its binary encoding.
   */
  importFolder?: { kind: 'text' | 'picture'; enclosed?: boolean };
  /**
   * Import Records, Export Records: "Specify XML and XSL Options". The XSLT style sheet to apply (a file in the documents
   * folder; Claris also allows an HTTP request or a calculation). Import applies it to the XML source before the import
   * reads it; export applies it to the exported XML. Set from the step's text; no fixture establishes its binary encoding.
   */
  xslt?: string;
  /** Export Records: the XML grammar written before any style sheet runs; absent = FMPXMLRESULT. */
  xmlGrammar?: 'FMPXMLRESULT' | 'FMPDSORESULT';
  /** Import Records: the target field of each source column, in column order; import false = not imported. */
  fieldMapping?: { field?: FieldRef; import: boolean; match?: boolean }[];
  /** Import Records: Update matches fields; Replace updates the found set in order. Absent = Add for authored steps; binary imports retain an unresolved Import mode marker. */
  importAction?: 'add' | 'update' | 'replace';
  /** Import Records: add source rows that do not match, or exceed the found set for Replace. */
  addRemaining?: boolean;
  /** Import Records: perform the target fields' auto-enter options. Absent preserves the existing behaviour. */
  performAutoEnter?: boolean;
  /** Data file steps (Read from, Write to, Close Data File, ...): the file ID, a formula. */
  fileId?: string;
  /** Read from Data File: how much to read (bytes, or UTF-16 code units), a formula; absent = the rest of the file. */
  amount?: string;
  /** Read from or Write to Data File: the encoding (FileMaker's default is UTF-16); Export Records: the character set. */
  encoding?: 'utf-16' | 'utf-8' | 'bytes';
  /** Write to Data File: add a line feed after the data. */
  appendLineFeed?: boolean;
  /** Create Data File, Export Records: create missing folders in the path. */
  createFolders?: boolean;
  /** Rename File: the new name, a formula. */
  newName?: string;
  /** Export Records: the output format ("COMS" comma-separated, "TABS" tab-separated, "MRGE" merge); else from the file's extension. */
  exportFormat?: string;
  /** Export Records: the exported fields, in order; else the current layout's fields. */
  exportFields?: FieldRef[];
  /** Account steps (Delete Account, Reset Account Password, Enable Account, Re-Login): the account name, a formula. */
  accountName?: string;
  /** Reset Account Password, Re-Login: the password, a formula. */
  password?: string;
  /** Reset Account Password: the person must change the password at their next sign-in. */
  expirePassword?: boolean;
  /** Enable Account: activate (true) or deactivate (false). */
  activate?: boolean;
  /** Adjust Window: what to do with the window. */
  adjust?: 'resize to fit' | 'maximize' | 'minimize' | 'restore' | 'hide';
  /** Undo/Redo: which; Undo when the step doesn't say (FileMaker's default). */
  undo?: 'undo' | 'redo' | 'toggle';
  /** Scroll Window: where the window scrolls to. */
  scroll?: 'home' | 'end' | 'page up' | 'page down' | 'to selection';
  /** Show/Hide Toolbars, Show/Hide Menubar, Show/Hide Text Ruler: show, hide or toggle, and whether to lock it there. */
  showHide?: 'show' | 'hide' | 'toggle';
  lock?: boolean;
  /** View As: the view, or Cycle (form, list, table and back). */
  view?: 'form' | 'list' | 'table' | 'cycle';
  /** Set Zoom Level: a percentage, Zoom In or Zoom Out; zoomCalculation when it is worked out (lock is "Lock"). */
  zoom?: number | 'in' | 'out';
  zoomCalculation?: string;
  /** Set Selection: the start and end positions, formulas (the field is `field`, else the active one). */
  selectionStart?: string;
  selectionEnd?: string;
  /** Move/Resize Window: the new size and position, formulas (the window's name, if not the current one, is calculation). */
  bounds?: { height?: string; width?: string; top?: string; left?: string };
  /** Save a Copy as: a plain copy, compacted, a clone without records, or self-contained. */
  copyKind?: 'copy' | 'compacted' | 'clone' | 'self-contained';
  /** Save Records as PDF: which records, the found set (the default), the current record or a blank record. */
  pdfRecords?: 'browsed' | 'current' | 'blank';
  /** Save Records as PDF: add the pages to the end of an existing PDF. */
  appendPdf?: boolean;
  /** Go to Related Record: show records using this layout (else the current one). */
  useLayout?: boolean;
  /** Go to Related Record: Match all records in the current found set (not just the current record). */
  matchFoundSet?: boolean;
  /** Go to Related Record: show them in a new window; its name is slot 128, as for New Window. */
  newWindow?: boolean;
  /** Perform Script on Server with Callback: the script to run afterwards here, its parameter (a formula) and the State option. */
  callback?: { script: Ref; parameter?: string; state?: string };
  /** Save Records as PDF: into the PDF Create PDF opened ("Currently open PDF"). */
  toOpenPdf?: boolean;
  /** Configure Persistent Data: remove the entry (`text` is its name, `calculation` the instance ID, `value` the value). */
  deleteEntry?: boolean;
  /** Find Matching Records: replace the found set, constrain it or extend it. */
  findMode?: 'replace' | 'constrain' | 'extend';
  /** Add Account: the privilege set the account gets. */
  privilegeSet?: Ref;
  /** Add Account: active by default; structured/text steps may explicitly make it inactive. Binary status slot is unknown. */
  accountStatus?: 'active' | 'inactive';
  /** Change Password: the current password, a formula (password is the new one). */
  oldPassword?: string;
  /** Save Records as JSONL: "Format for fine-tuning" and its prompts (formulas); without it, `field` is the completion field. */
  jsonl?: { fineTuning: boolean; system?: string; user?: string; assistant?: string };
  /** Other formulas the step holds, by parameter slot, when their meaning is not decoded. */
  slots?: Record<number, string>;
  /** FileMaker 2024+ AI steps: Configure AI Account, Insert Embedding (in Found Set), Perform Semantic Find. */
  ai?: AiStepParams;
}

/** Resolves ids to names and formulas to text, from the rest of the schema. */
/**
 * Options of FileMaker's AI script steps, as formulas. Decoded from Beezwax's
 * public (MIT) semantic search demos; see research/ai/filemaker-ai-steps-and-functions.md.
 */
export interface AiStepParams {
  accountName?: string;
  /** Configure AI Account: the API key formula (usually a field; never shown when it is a literal). */
  apiKey?: string;
  model?: string;
  /** Insert Embedding: the text to embed. Perform Semantic Find: the search text. */
  input?: string;
  /** Insert Embedding in Found Set: the field whose text is embedded. */
  sourceField?: FieldRef;
  /**
   * Insert Embedding in Found Set's options. Replace target contents: false keeps a target that already has a value
   * (Claris: "results are added to the target field only if the field is empty"); not decoded from files yet, where
   * absent means it replaces, as before. Continue on error: a record whose call fails stays empty and the rest go on.
   * Show summary: a dialog of how many records were updated.
   */
  replaceTarget?: boolean;
  continueOnError?: boolean;
  showSummary?: boolean;
  /** Perform Semantic Find. */
  queryBy?: 'natural language' | 'vector data' | 'image';
  /** Perform Semantic Find by vector data: the embedding to compare with. */
  vector?: string;
  recordSet?: 'all records' | 'current found set';
  /** Perform Semantic Find: the maximum number of records to return (defaults to 10). */
  returnCount?: string;
  condition?: 'greater than' | 'less than' | 'equal to' | 'greater than or equal to' | 'less than or equal to';
  /** The cosine similarity value the condition compares with. */
  threshold?: string;
  /** Configure AI Account: a custom provider's endpoint. */
  endpoint?: string;
  /** Perform Find by Natural Language. */
  prompt?: string;
  /** Perform Find by Natural Language: what to return after generating the find request. */
  findGet?: 'found set' | 'find request as json' | 'found set as json';
  parameters?: string;
  templateName?: string;
  /** Perform RAG Action. */
  ragAccountName?: string;
  spaceId?: string;
  /** The action's key 1 is the one sample's Add Data; Send Prompt (2) and Remove Data (3) follow the menu's order (inferred). */
  ragAction?: 'add data' | 'send prompt' | 'remove data';
  /** RAG Data keys 4 and 5 are from the samples; From Text, From File and From File (Async) (1 to 3) follow the menu's order (inferred). */
  dataSource?: 'from text' | 'from file' | 'from file (async)' | 'from container' | 'from container (async)';
  tokensPerChunk?: string;
  /** Perform RAG Action: the variable that gets the response (Response Target), as written ($name). */
  responseVariable?: string;
  /** Generate Response from Model: the instructions (system prompt). */
  instructions?: string;
  /**
   * Generate Response from Model: the conversation so far (Messages) and where the updated conversation is
   * kept (Save Message History To), both variable names, with how many messages to keep and the history
   * variable's repetition. The one public sample uses the same variable for both, so which of slots 135 and
   * 136 is which is a guess.
   */
  messagesVariable?: string;
  historyVariable?: string;
  historyCount?: string;
  historyRepetition?: string;
  /**
   * Perform SQL Query by Natural Language: what to return, where the tables come from (the occurrences picked
   * in the step, or a calculation giving their names one per line, or DDL), and Stream. Read from script text
   * only: no file sample shows how a .fmp12 keeps them.
   */
  sqlAction?: 'query' | 'query for data only' | 'get sql' | 'get first sql only' | 'get ddl';
  dataTables?: 'from list' | 'by name' | 'by ddl';
  tables?: string[];
  tablesCalculation?: string;
  stream?: boolean;
  /** Configure Prompt Template. */
  requestType?: 'SQL query';
  sqlPrompt?: string;
  naturalLanguagePrompt?: string;
}

export interface ParamContext {
  formula(node: Node | undefined): string | undefined;
  layoutName(id: number): string | undefined;
  scriptName(id: number): string | undefined;
  tableOccurrenceName(id: number): string | undefined;
  tableName?(id: number): string | undefined;
  fieldName(tableOccurrenceId: number, fieldId: number): string | undefined;
  dataSourceName(id: number): string | undefined;
  menuSetName?(id: number): string | undefined;
}

const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];

/** A reference stored as [size][length][path integer] at `at`. */
function refAt(b: Uint8Array, at: number): number | undefined {
  const size = b[at];
  const len = b[at + 1];
  if (size < 2 || len < 1 || len > 3 || len + 1 > size || at + 2 + len > b.length) return undefined;
  return pathValue(b.subarray(at + 2, at + 2 + len));
}

/** A reference stored as [length][path integer]. */
export function shortRef(b: Uint8Array | undefined): number | undefined {
  if (!b || b.length < 2 || b[0] < 1 || b[0] + 1 > b.length) return undefined;
  return pathValue(b.subarray(1, 1 + b[0]));
}

export interface DialogInput {
  field?: FieldRef;
  variable?: string;
  /** The label, as a formula. */
  label?: string;
  /** Typing shows bullets (the Use password character option). */
  password?: boolean;
}

export function decodeStepParams(stepId: number, rec: Uint8Array, p: Node | undefined, ctx: ParamContext): StepParams | undefined {
  const calc = (slot: number) => ctx.formula(p?.child(slot, 5));
  const text = (slot: number): string | undefined => {
    const n = p?.child(slot);
    if (!n) return undefined;
    const inline = n.textOrLong(1);
    if (inline !== undefined) return inline;
    return n.segments.size ? decodeText(n.longBytes()!) : undefined;
  };
  const ref = (id: number | undefined, name: (id: number) => string | undefined): Ref | undefined =>
    id === undefined ? undefined : { id, name: name(id) ?? `<missing ${id}>` };
  const fieldAt = (toAt: number, fieldAt: number, b: Uint8Array = rec): FieldRef | undefined => {
    const to = refAt(b, toAt);
    const field = refAt(b, fieldAt);
    if (to === undefined || field === undefined || to < 128) return undefined;
    const out: FieldRef = {
      tableOccurrence: ref(to, ctx.tableOccurrenceName)!,
      field: { id: field, name: ctx.fieldName(to, field) ?? `<missing ${field}>` },
    };
    if (b === rec && rec[19] > 1) out.repetition = rec[19];
    return out;
  };
  const target = (): Pick<StepParams, 'field' | 'variable' | 'repetitionCalculation'> => {
    const out: Pick<StepParams, 'field' | 'variable' | 'repetitionCalculation'> = {};
    const field = fieldAt(6, 12);
    if (field) out.field = field;
    const variable = p?.child(160)?.text(1);
    if (variable) out.variable = variable;
    const rep = ctx.formula(p?.child(138, 5));
    if (rep !== undefined) out.repetitionCalculation = rep;
    return out;
  };
  const slotsOf = (skip: number[] = []): StepParams | undefined => {
    const slots: Record<number, string> = {};
    for (const [slot] of p?.numbered() ?? []) {
      if (slot < 128 || skip.includes(slot)) continue;
      const c = calc(slot);
      if (c !== undefined) slots[slot] = c;
    }
    return Object.keys(slots).length ? { slots } : undefined;
  };
  const choice = u16(rec, 22);
  const on = (rec[25] & 0x02) !== 0;
  const noDialog = (rec[27] & 0x80) !== 0;
  const hasCalc = (rec[26] & 0x40) !== 0;
  // Bits of the flags word at 24-27 numbered as Save as XML's <Options> numbers them (bit 8 is byte 26 & 0x01):
  // bit 9 is Create folders on the steps that write a file, bit 12 Select on the Insert steps.
  const createFolders = (rec[26] & 0x02) !== 0;
  const selectAll = (rec[26] & 0x10) !== 0;

  switch (stepId) {
    case 1: // Perform Script
    case 164: // Perform Script on Server
    case 148: { // Install OnTimer Script
      const out: StepParams = {};
      const id = refAt(rec, 6);
      const fileId = shortRef(p?.kv.get(32));
      if (id !== undefined) {
        out.script = ref(id, fileId ? () => undefined : ctx.scriptName)!;
        if (fileId) out.script.file = ref(fileId, ctx.dataSourceName);
      }
      const param = calc(128);
      if (param !== undefined) out.parameter = param;
      // Specified: By name (FileMaker 18+): no script id, the name's calculation at 130 (Beezwax samples).
      const byName = id === undefined && stepId !== 148 ? calc(130) : undefined;
      if (byName !== undefined) out.scriptCalculation = byName;
      // Wait for completion is on unless bit 8 of the flags word is set, as Save as XML's <Options> numbers it.
      if (stepId === 164 && rec[26] & 0x01) out.wait = false;
      if (stepId === 148) {
        const interval = calc(129);
        if (interval !== undefined) out.calculation = interval;
      }
      return out;
    }
    case 142: { // Install Menu Set: [2][1][set id] at 6; byte 26 bit 0x02 is Use as file default (inferred from samples)
      const out: StepParams = {};
      const id = refAt(rec, 6);
      if (id !== undefined) out.menuSet = ref(id, (n) => (n === 1 ? '[Standard FileMaker Menus]' : ctx.menuSetName?.(n)));
      if (rec[26] & 0x02) out.fileDefault = true;
      return out;
    }
    case 6: { // Go to Layout
      const dest = ({ 1: 'original', 3: 'name', 4: 'number', 5: 'named' } as const)[choice as 1 | 3 | 4 | 5];
      const out: StepParams = {};
      if (dest) out.layoutDestination = dest;
      if (dest === 'named') out.layout = ref(refAt(rec, 6), ctx.layoutName);
      const c = calc(133);
      if (c !== undefined && (dest === 'name' || dest === 'number')) out.layoutCalculation = c;
      return out;
    }
    case 16: // Go to Record/Request/Page
    case 99: { // Go to Portal Row
      const location = (['first', 'last', 'previous', 'next', 'calculation'] as const)[choice - 1];
      const out: StepParams = { noDialog };
      if (location) out.location = location;
      if (rec[26] & 0x20) out.exitAfterLast = true;
      if (location === 'calculation') out.calculation = calc(128);
      return out;
    }
    case 22: // Enter Find Mode
    case 28: // Perform Find
    case 126: // Constrain Found Set
    case 127: { // Extend Found Set
      const out: StepParams = { restore: (rec[24] & 0x02) !== 0 || (rec[26] & 0x80) !== 0 };
      const requests = findRequests(p?.child(6), ctx);
      if (requests.length) out.requests = requests;
      if (!out.restore) delete out.restore;
      return out;
    }
    case 39: { // Sort Records
      const out: StepParams = { noDialog, restore: (rec[24] & 0x02) !== 0 };
      const sort = sortFields(p?.kv.get(10), ctx);
      if (sort.length) out.sort = sort;
      return out;
    }
    case 75: { // Commit Records/Requests: bit 8 of the flags word is Skip data entry validation, as Save as XML's <Options> numbers it
      const out: StepParams = { noDialog };
      if (rec[26] & 0x01) out.skipValidation = true;
      return out;
    }
    case 205: { // Open Transaction: bit 8 Skip data entry validation, bit 12 Skip auto-enter options (bit 9, ESS, isn't kept)
      const out: StepParams = {};
      if (rec[26] & 0x01) out.skipValidation = true;
      if (rec[26] & 0x10) out.skipAutoEnter = true;
      return out;
    }
    case 9: case 10: case 26: case 51: case 98: case 182: { // record and table steps with a dialog option
      const out: StepParams = { noDialog };
      if (stepId === 26 && hasCalc) out.calculation = calc(128); // Omit Multiple Records
      // Truncate Table names a base table, not a table occurrence.
      if (stepId === 182 && choice === 1) out.table = ref(refAt(rec, 6), (id) => ctx.tableName?.(id));
      return out;
    }
    case 68: case 125: case 72: case 103: case 62: case 111: case 150: case 117: { // one calculation
      const c = calc(128);
      return c === undefined ? {} : { calculation: c };
    }
    case 33: case 34: { // Open File, Close File
      const id = shortRef(p?.kv.get(32));
      return id === undefined ? {} : { dataSource: ref(id, ctx.dataSourceName) };
    }
    case 46: case 47: case 48: case 49: case 131: case 132: case 157: { // Cut, Copy, Paste, Clear, Insert File, Export Field Contents
      const out: StepParams = target();
      if (stepId === 132) {
        const paths = pathList(p?.child(128)?.kv.get(130));
        if (paths.length) out.filePaths = paths;
        if (createFolders) out.createFolders = true;
      }
      if (stepId === 131 || stepId === 157) { // 157 (Install Plug-In File) is read like Insert File's stored source; not yet seen in a file
        // A stored source file, when the step names one; otherwise a person picks the file in a dialog titled by slot 128.
        for (const [slot, n] of p?.numbered() ?? []) {
          const paths = slot >= 128 ? pathList(n.kv.get(130)) : [];
          if (paths.length) {
            out.filePaths = paths;
            break;
          }
        }
        const title = calc(128);
        if (title !== undefined) out.title = title;
      }
      return out;
    }
    case 36: { // Export Records
      const out: StepParams = { noDialog };
      const paths = pathList(p?.child(128)?.kv.get(130));
      if (paths.length) out.filePaths = paths;
      const format = p?.kv.get(134);
      if (format && format.length >= 4) out.exportFormat = String.fromCharCode(...format.subarray(0, 4));
      const fields = exportFields(p?.kv.get(133) ?? (p?.segments.size ? p.longBytes() : undefined), ctx);
      if (fields.length) out.exportFields = fields;
      if (createFolders) out.createFolders = true;
      return out;
    }
    case 37: { // Save a Copy as: the kind is the record's choice (private samples' Save As Clone scripts use 3; the order is FileMaker's menu)
      const out: StepParams = {};
      const paths = pathList(p?.child(128)?.kv.get(130));
      if (paths.length) out.filePaths = paths;
      const kind = ({ 1: 'copy', 2: 'compacted', 3: 'clone', 4: 'self-contained' } as const)[choice as 1 | 2 | 3 | 4];
      if (kind) out.copyKind = kind;
      if (createFolders) out.createFolders = true;
      return out;
    }
    case 144: case 152: { // Save Records as PDF, as Snapshot Link (the path is where the other file steps keep theirs)
      const out: StepParams = { noDialog };
      const paths = pathList(p?.child(128)?.kv.get(130));
      if (paths.length) out.filePaths = paths;
      if (createFolders) out.createFolders = true;
      if (stepId === 144 && rec[26] & 0x01) out.appendPdf = true; // bit 8: Append to existing PDF
      return out;
    }
    case 188: case 189: case 191: { // Get File Exists, Get File Size, Open Data File: a path and a target
      const out: StepParams = target();
      // A variable target leaves the field reference of an earlier target in the record.
      if (out.variable) delete out.field;
      const paths = pathList(p?.child(128)?.kv.get(130));
      if (paths.length) out.filePaths = paths;
      return out;
    }
    case 190: case 197: case 199: { // Create Data File, Delete File, Rename File (not yet seen in a file)
      const out: StepParams = {};
      const paths = pathList(p?.child(128)?.kv.get(130));
      if (paths.length) out.filePaths = paths;
      if (stepId === 190 && createFolders) out.createFolders = true;
      if (stepId === 199) {
        const name = calc(129);
        if (name !== undefined) out.newName = name;
      }
      return out;
    }
    case 192: case 193: case 194: case 195: case 196: { // the steps that take a file ID (slot 128)
      const out: StepParams = stepId === 196 || stepId === 195 ? {} : target();
      if (out.variable) delete out.field;
      const id = calc(128);
      if (id !== undefined) out.fileId = id;
      // Read as / Write as: the record's choice, 1 UTF-16 (FileMaker's default), 2 UTF-8, 3 Bytes (inferred from private samples' reads).
      if (stepId === 192 || stepId === 193) out.encoding = choice === 2 ? 'utf-8' : choice === 3 && stepId === 193 ? 'bytes' : 'utf-16';
      if (stepId === 192 && rec[26] & 0x02) out.appendLineFeed = true; // bit 9
      if (stepId === 193) {
        const amount = calc(129);
        if (amount !== undefined) out.amount = amount;
      }
      if (stepId === 195) {
        const position = calc(129);
        if (position !== undefined) out.calculation = position;
      }
      return out;
    }
    case 207: { // Revert Transaction: presence is known, calculation-slot meanings are not.
      const options: string[] = [];
      if (rec[26] & 0x01) options.push('Condition');
      if (rec[26] & 0x02) options.push('Error code');
      if (rec[26] & 0x40) options.push('Calculations');
      const payload = (n: Node): boolean => n.kv.size > 0 || n.kvLong.length > 0 || n.data.length > 0 || n.segments.size > 0 || n.children.size > 0;
      const slots = (p?.numbered() ?? []).filter(([slot, n]) => slot >= 128 && payload(n));
      const hasCalculation = (n: Node): boolean => n.children.has(5) || [...n.children.values()].some(hasCalculation);
      if (slots.length || p && (hasCalculation(p) || [...p.kv.keys()].some((key) => key >= 128))) options.push('Option payloads');
      if (!options.length) return undefined;
      const out: StepParams = { undecodedOptions: options };
      // A failed formula extraction must never erase the diagnostic and permit a rollback.
      for (const [slot] of slots) {
        try {
          const formula = calc(slot);
          if (formula !== undefined) (out.slots ??= {})[slot] = formula;
        } catch { /* Keep the option-presence diagnostic. */ }
      }
      return out;
    }
    case 223: { // No fixture establishes this step's binary On/Off encoding.
      const out: StepParams = { undecodedOptions: ['On/Off'] };
      for (const [slot] of p?.numbered() ?? []) {
        if (slot < 128) continue;
        try {
          const formula = calc(slot);
          if (formula !== undefined) (out.slots ??= {})[slot] = formula;
        } catch { /* The unresolved state survives optional formula extraction. */ }
      }
      return out;
    }
    case 35: { // Import Records
      const out: StepParams = { noDialog, undecodedOptions: ['Import mode'] };
      // Action, match-field flags and auto-enter slots have not been established from a fixture.
      // Keep the binary mapping unchanged; these options are supported in structured and text steps.
      try {
        const paths = pathList(p?.child(128)?.kv.get(130));
        if (paths.length) out.filePaths = paths;
        const format = p?.kv.get(134);
        if (format && format.length >= 4) out.importFormat = String.fromCharCode(...format.subarray(0, 4));
        if (out.importFormat === 'FMPR' && format) {
          const source = fileMakerSource(format);
          if (source) out.importSource = source;
        }
        // Key 132: [target table occurrence ref] 00 00 02 [u16 count], then per source column
        // [size][field id][flag], flag 0 = import into the field, 1 = don't import.
        const m = p?.kv.get(132);
        const to = m ? refAt(m, 0) : undefined;
        if (m && to !== undefined) {
          out.tableOccurrence = ref(to, ctx.tableOccurrenceName);
          let at = 1 + m[0] + 3;
          const count = at + 2 <= m.length ? u16(m, at) : 0;
          at += 2;
          const mapping: NonNullable<StepParams['fieldMapping']> = [];
          for (let i = 0; i < count && at + 1 < m.length; i++) {
            const id = refAt(m, at);
            const flag = m[at + 1 + m[at]];
            const entry: (typeof mapping)[number] = { import: flag === 0 && !!id };
            if (id) entry.field = { tableOccurrence: out.tableOccurrence!, field: { id, name: ctx.fieldName(to, id) ?? `<missing ${id}>` } };
            mapping.push(entry);
            at += 2 + m[at];
          }
          out.fieldMapping = mapping;
        }
      } catch { /* Keep the binary import-mode diagnostic even if optional metadata is malformed. */ }
      return out;
    }
    case 85: case 86: // Allow User Abort, Set Error Capture
      return { on };
    case 76: // Set Field
    case 77: // Insert Calculated Result
    case 116: // Set Next Serial Value
    case 91: { // Replace Field Contents
      const out: StepParams = target();
      const c = calc(128);
      if (c !== undefined) out.calculation = c;
      if (stepId === 91) out.noDialog = noDialog;
      return out;
    }
    case 17: case 61: case 160: { // Go to Field, Insert Text, Insert from URL
      const out: StepParams = target();
      if (stepId === 61) {
        const t = text(128);
        if (t !== undefined) out.text = t;
      }
      if (stepId === 160) {
        const url = calc(128);
        if (url !== undefined) out.calculation = url;
        const curl = calc(129);
        if (curl !== undefined) out.slots = { 129: curl };
      }
      return out;
    }
    case 141: { // Set Variable
      const out: StepParams = {};
      const name = text(128);
      if (name !== undefined) out.variable = name;
      const value = calc(129);
      if (value !== undefined) out.value = value;
      const rep = calc(130);
      if (rep !== undefined && rep.trim() !== '1') out.repetition = rep;
      return out;
    }
    case 147: { // Set Field By Name
      const out: StepParams = {};
      const name = calc(129);
      if (name !== undefined) out.fieldName = name;
      const value = calc(128);
      if (value !== undefined) out.calculation = value;
      return out;
    }
    case 63: { // Send Mail
      // Slots 128-134 are To, CC, BCC, Subject, Message, the sender's name and
      // address; 136-139 the SMTP server, port, account and password, which are
      // not read. Attachments are a path list in slot 128's key 130. Byte 1 of
      // the record is 2 for "SMTP Server", 1 for "E-mail Client" (private samples).
      const mail: NonNullable<StepParams['mail']> = {};
      const keys = ['to', 'cc', 'bcc', 'subject', 'message', 'fromName', 'fromEmail'] as const;
      keys.forEach((k, i) => {
        const v = calc(128 + i);
        if (v !== undefined) mail[k] = v;
      });
      const files = pathList(p?.child(128)?.kv.get(130));
      if (files.length) mail.attachments = files;
      if (rec[1] === 2) mail.smtp = true;
      return { noDialog, mail };
    }
    case 87: { // Show Custom Dialog
      const out: StepParams = {};
      const title = calc(128);
      if (title !== undefined) out.title = title;
      const message = calc(129);
      if (message !== undefined) out.message = message;
      const buttons = [133, 134, 135].map(calc).filter((b): b is string => b !== undefined);
      if (buttons.length) out.buttons = buttons;
      // Input fields: labels are calculations at 130-132 and targets at 160-162
      // (a variable's name as text; no sample has a field target). Each label
      // slot's byte 3 is 1 on the second one in every sample, inputs or not:
      // taken as FileMaker's per-button Commit option being off, since by
      // default the second button (Cancel) doesn't store the inputs.
      const inputs = [0, 1, 2].flatMap((i): DialogInput[] => {
        const variable = p?.child(160 + i)?.text(1);
        if (!variable?.startsWith('$')) return [];
        const label = calc(130 + i);
        return [{ variable, ...(label !== undefined ? { label } : {}) }];
      });
      if (inputs.length) out.inputs = inputs;
      const commit = [0, 1, 2].map((i) => p?.child(130 + i)?.kv.get(3)?.[0] !== 1);
      if (commit.some((c, i) => c !== (i !== 1))) out.commit = commit;
      return out;
    }
    case 145: case 167: { // Go to Object, Refresh Object
      const name = calc(128);
      // Go to Object's Repetition is not decoded from the binary parameter tree yet.
      // Keep the record untouched rather than guessing which slot holds its formula.
      const out: StepParams = name === undefined ? {} : { objectName: name };
      if (stepId === 167) out.unsupportedOptions = ['binary Refresh Object repetition'];
      // Refresh Object's repetition slot is not established by a FileMaker-generated fixture yet.
      // Keep remaining formulas undecoded rather than treating an unknown slot as repetition 1.
      if (stepId === 167) {
        const slots = slotsOf([128])?.slots ?? {};
        if (Object.keys(slots).length) out.slots = slots;
      }
      return out;
    }
    case 146: { // Set Web Viewer: name and URL formulas verified against Flicks' generated DDR
      const out: StepParams = { unsupportedOptions: ['binary Set Web Viewer action'] };
      const name = calc(128);
      const url = calc(129);
      if (name !== undefined) out.objectName = name;
      if (url !== undefined) out.viewerUrl = url;
      Object.assign(out, slotsOf([128, 129]));
      // The action's binary choice is unverified. A populated URL slot does not establish Go to URL.
      return out;
    }
    case 80: case 180:
      // Refresh Window flags, Refresh Portal's name still need
      // FileMaker-generated binary fixtures. Preserve formulas without assigning byte meanings.
      return { ...slotsOf(), unsupportedOptions: [stepId === 80 ? 'binary Refresh Window flush flags' : 'binary Refresh Portal object name'] };
    case 135: // Delete Account
    case 136: // Reset Account Password
    case 137: // Enable Account
    case 138: { // Re-Login
      // The account name is slot 128 and the password slot 129. The flags are
      // inferred from private samples' scripts: Reset Account Password's records all
      // have bit 0x02 of byte 27 ("Expire password", which they turn on).
      // Enable Account's choice is 1 to activate and 0 to deactivate: a private sample's
      // account-status script has one of each, for status 1 (active) and status 0.
      const out: StepParams = {};
      const name = calc(128);
      if (name !== undefined) out.accountName = name;
      const password = calc(129);
      if (password !== undefined && (stepId === 136 || stepId === 138)) out.password = password;
      if (stepId === 136) out.expirePassword = (rec[27] & 0x02) !== 0;
      if (stepId === 137) out.activate = choice !== 0;
      if (stepId === 138) out.noDialog = noDialog;
      return out;
    }
    case 154: { // Sort Records by Field: the field, and the order as the record's choice (1 seen in a private sample; taken as Ascending, 2 as Descending)
      // The Associated value list choice needs fixture evidence before decoding it.
      const t = target();
      return t.field ? { sort: [{ field: t.field, order: choice === 2 ? 'descending' : 'ascending' }] } : {};
    }
    case 31: { // Adjust Window: 1-5 as the dialog lists them (5 is a private sample's "Hide" command)
      const adjust = (['resize to fit', 'maximize', 'minimize', 'restore', 'hide'] as const)[choice - 1];
      return adjust ? { adjust } : {};
    }
    case 45: { // Undo/Redo: 1-3 taken as the dialog lists them (Undo, Redo, Toggle), as Show/Hide Toolbars numbers its choices (inferred; no sample file has the step)
      const undo = (['undo', 'redo', 'toggle'] as const)[choice - 1];
      return undo ? { undo } : {};
    }
    case 81: { // Scroll Window: 1-5 taken as the dialog lists them (inferred from Adjust Window's numbering; no sample file has the step)
      const scroll = (['home', 'end', 'page up', 'page down', 'to selection'] as const)[choice - 1];
      return scroll ? { scroll } : {};
    }
    case 29: case 166: { // Show/Hide Toolbars, Show/Hide Menubar: 1 Show, 2 Hide, 3 Toggle; byte 25 bit 3 Lock
      // (inferred from the samples: Hide when a welcome slide opens or an advanced find returns, Show on first window open)
      const showHide = (['show', 'hide', 'toggle'] as const)[choice - 1];
      const out: StepParams = showHide ? { showHide } : {};
      if (rec[25] & 0x08) out.lock = true;
      return out;
    }
    case 30: { // View As: 1 Form, 2 List, 3 Table, 4 Cycle (fmIDE restores Get ( LayoutViewState ) 0, 1 and 2 with choices 1, 2 and 3)
      const view = (['form', 'list', 'table', 'cycle'] as const)[choice - 1];
      return view ? { view } : {};
    }
    case 97: { // Set Zoom Level: 1-8 are 25-400%, 9 Zoom In, 10 Zoom Out, 11 by calculation (slot 128); byte 25 bit 3 Lock
      // (read against the ai2fm bug suite's 16_Set_Zoom_Level file and its clipboard XML, which lists every option in order)
      const out: StepParams = {};
      const zoom = ([25, 50, 75, 100, 150, 200, 300, 400, 'in', 'out'] as const)[choice - 1];
      if (zoom !== undefined) out.zoom = zoom;
      const c = calc(128);
      if (choice === 11 && c !== undefined) out.zoomCalculation = c;
      if (rec[25] & 0x08) out.lock = true;
      return out;
    }
    case 130: { // Set Selection: the field as Set Field keeps it (none: the active field), start and end in slots 128 and 129
      const out: StepParams = target();
      const start = calc(128);
      if (start !== undefined) out.selectionStart = start;
      const end = calc(129);
      if (end !== undefined) out.selectionEnd = end;
      return out;
    }
    case 119: { // Move/Resize Window: the window's name in slot 128 (choice 1), height, width, top and left in 129-132
      const out: StepParams = {};
      const name = calc(128);
      if (name !== undefined) out.calculation = name;
      const bounds: NonNullable<StepParams['bounds']> = {};
      (['height', 'width', 'top', 'left'] as const).forEach((k, i) => {
        const v = calc(129 + i);
        if (v !== undefined) bounds[k] = v;
      });
      if (Object.keys(bounds).length) out.bounds = bounds;
      return out;
    }
    case 123: { // Select Window: the current window (choice 0) or one by name (slot 128)
      const name = calc(128);
      return name === undefined ? {} : { calculation: name };
    }
    case 122: { // New Window: name, height, width, top and left in slots 128-132; the layout as Go to Layout keeps it (a private sample's main-navigation script)
      const out: StepParams = slotsOf([133]) ?? {};
      if (!(rec[26] & 0x40)) out.windowStyle = 'card';
      const dest = ({ 3: 'name', 4: 'number', 5: 'named' } as const)[choice as 3 | 4 | 5];
      if (dest) out.layoutDestination = dest;
      if (dest === 'named') out.layout = ref(refAt(rec, 6), ctx.layoutName);
      const c = calc(133);
      if (c !== undefined && (dest === 'name' || dest === 'number')) out.layoutCalculation = c;
      return out;
    }
    case 74: { // Go to Related Record
      const out: StepParams = { useLayout: choice === 5 };
      const to = shortRef(p?.child(128)?.kv.get(17));
      if (to !== undefined) out.tableOccurrence = ref(to, ctx.tableOccurrenceName);
      if (choice === 5) out.layout = ref(refAt(rec, 6), ctx.layoutName);
      // New window (inferred from the samples: set on every step whose script opens one, and only those carry
      // the window's name, height, width, top and left in slots 128-132, as New Window does).
      if (rec[25] & 0x02) {
        out.newWindow = true;
        const name = calc(128);
        if (name !== undefined) out.slots = { 128: name };
      }
      return out;
    }
    case 219: // Perform RAG Action
    case 221: // Perform Find by Natural Language
    case 226: { // Configure Prompt Template
      // Read off the ai2fm bug-report files (FileMaker 2025 and 2026), which ship
      // FileMaker's own XML for each step beside the file. Choices (u32 keys) are
      // labelled only where a sample shows the value; the rest stay unlabelled.
      const ai: AiStepParams = {};
      const set = <K extends keyof AiStepParams>(k: K, v: AiStepParams[K] | undefined) => v !== undefined && (ai[k] = v);
      const pick = (key: number) => { const b = p?.kv.get(key); return b?.length === 4 ? new DataView(b.buffer, b.byteOffset).getUint32(0) : undefined; };
      let used: number[];
      if (stepId === 221) { // account 129, model 130, prompt 131, parameters 133, template name 135
        set('accountName', calc(129));
        set('model', calc(130));
        set('prompt', calc(131));
        set('parameters', calc(133));
        set('templateName', calc(135));
        // The Get choice's binary slot is not established from a fixture yet.
        used = [129, 130, 131, 133, 135];
      } else if (stepId === 219) { // RAG account 129, space ID 130, data source key 131, action key 133, tokens per chunk 142
        set('ragAccountName', calc(129));
        set('spaceId', calc(130));
        set('ragAction', ({ 1: 'add data', 2: 'send prompt', 3: 'remove data' } as const)[pick(133) as 1 | 2 | 3]);
        set('dataSource', ({ 1: 'from text', 2: 'from file', 3: 'from file (async)', 4: 'from container', 5: 'from container (async)' } as const)[pick(131) as 1 | 2 | 3 | 4 | 5]);
        set('tokensPerChunk', calc(142));
        used = [129, 130, 142];
      } else { // template name 129, SQL prompt 131, natural-language prompt 132, request type key 133
        set('templateName', calc(129));
        set('sqlPrompt', calc(131));
        set('naturalLanguagePrompt', calc(132));
        set('requestType', pick(133) === 1 ? 'SQL query' : undefined);
        used = [129, 131, 132];
      }
      const out: StepParams = { ...slotsOf(used), ai };
      if (stepId !== 226) Object.assign(out, target());
      return out;
    }
    case 220: { // Generate Response from Model
      // Read off a public sample (sales-management-fm26) against agentic-fm's XML for the step (Apache-2.0):
      // account 129, model 130, user prompt 131, instructions 133, messages and save-history-to variables
      // 135/136, message history count 137, its repetition 139, the response in a variable (160) or a field.
      const ai: AiStepParams = {};
      const set = <K extends keyof AiStepParams>(k: K, v: AiStepParams[K] | undefined) => v !== undefined && (ai[k] = v);
      set('accountName', calc(129));
      set('model', calc(130));
      set('input', calc(131));
      set('instructions', calc(133));
      set('messagesVariable', p?.child(135)?.text(1) || undefined);
      set('historyVariable', p?.child(136)?.text(1) || undefined);
      set('historyCount', calc(137));
      set('historyRepetition', calc(139));
      const out: StepParams = { ...slotsOf([129, 130, 131, 133, 137, 139]), ai, ...target() };
      // A response variable wins over the field the step also keeps (the sample reads $Response afterwards).
      if (out.variable) delete out.field;
      return out;
    }
    case 212: // Configure AI Account: account name 129, API key 131 (130, the endpoint for a custom provider, is not seen yet)
    case 215: // Insert Embedding: target field in the record, account 129, model 130, text 131
    case 216: // Insert Embedding in Found Set: target field in the record, account 129, model 130, source field at 131 key 16
    case 218: { // Perform Semantic Find: see below
      const ai: AiStepParams = {};
      const set = <K extends keyof AiStepParams>(k: K, v: AiStepParams[K] | undefined) => v !== undefined && (ai[k] = v);
      set('accountName', calc(129));
      const used = [129];
      if (stepId === 212) {
        set('endpoint', calc(130));
        set('apiKey', calc(131));
        used.push(130, 131);
      } else if (stepId === 218) {
        // Slots 130 text, 131 return count (inferred from the option order: no sample file sets one), 132 model, 133 cosine similarity value, 137 the vector (query by vector data).
        // Keys 134-136 are u32 choices, numbered as in FileMaker's XML: 134 the condition
        // (Beezwax's "≥ .8" search stores 4), 135 the record set, 136 query by (the vector
        // searches store 2 and fill 137; FileMaker keeps a step's hidden natural-language slots).
        set('input', calc(130));
        set('returnCount', calc(131));
        set('model', calc(132));
        set('threshold', calc(133));
        set('vector', calc(137));
        used.push(130, 131, 132, 133, 137);
        const pick = (key: number) => { const b = p?.kv.get(key); return b?.length === 4 ? new DataView(b.buffer, b.byteOffset).getUint32(0) : undefined; };
        set('condition', (['greater than', 'less than', 'equal to', 'greater than or equal to', 'less than or equal to'] as const)[pick(134)! - 1]);
        set('recordSet', (['all records', 'current found set'] as const)[pick(135)! - 1]);
        set('queryBy', (['natural language', 'vector data', 'image'] as const)[pick(136)! - 1]);
      } else {
        set('model', calc(130));
        used.push(130);
        if (stepId === 215) {
          set('input', calc(131));
          used.push(131);
        } else {
          const src = p?.child(131)?.kv.get(16);
          if (src) set('sourceField', fieldAt(0, 6, src));
        }
      }
      const out: StepParams = { ...slotsOf(used), ai };
      if (stepId !== 212) Object.assign(out, target());
      return out;
    }
  }
  // Insert from Index, Insert from Last Visited, Insert Current Date / Time / User Name: Select (their target isn't decoded yet).
  if ([11, 12, 13, 14, 60].includes(stepId) && selectAll) return { ...slotsOf(), selectEntireContents: true };
  // Anything else: keep whatever formulas it holds, by slot.
  return slotsOf();
}

/**
 * Key 133 of Export Records: a u16 count, then per field the table occurrence
 * and field references ([size][length][id] each) and 10 bytes not decoded.
 */
export function exportFields(b: Uint8Array | undefined, ctx: ParamContext): FieldRef[] {
  if (!b || b.length < 2) return [];
  const count = u16(b, 0);
  const out: FieldRef[] = [];
  let at = 2;
  for (let i = 0; i < count && at < b.length; i++) {
    const to = refAt(b, at);
    at += 1 + b[at];
    const field = refAt(b, at);
    at += 1 + (b[at] ?? 0) + 10;
    if (to === undefined || field === undefined) return out;
    out.push({
      tableOccurrence: { id: to, name: ctx.tableOccurrenceName(to) ?? `<missing ${to}>` },
      field: { id: field, name: ctx.fieldName(to, field) ?? `<missing ${field}>` },
    });
  }
  return out;
}

/**
 * Key 134 of Import Records from a FileMaker file: "FMPR" 00 00, the source
 * table occurrence [size][length][id], then (after bytes not decoded) a u32
 * count and that many field references [size][length][id], then zeros.
 */
function fileMakerSource(b: Uint8Array): StepParams['importSource'] {
  const to = refAt(b, 6);
  if (to === undefined) return undefined;
  // The field list: the u32 count after which exactly that many references end the key (zeros may follow).
  for (let at = 7 + b[6]; at + 4 <= b.length; at++) {
    const count = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
    if (count === 0 || count > 4096) continue;
    const ids: number[] = [];
    let pos = at + 4;
    while (ids.length < count && pos < b.length) {
      const id = refAt(b, pos);
      if (id === undefined) break;
      ids.push(id);
      pos += 1 + b[pos];
    }
    if (ids.length === count && b.subarray(pos).every((x) => x === 0)) return { tableOccurrenceId: to, fieldIds: ids };
  }
  return undefined;
}

/** Field reference inside find requests and sort orders: 03 <TO path int> 01|02 <field> ... */
function taggedField(b: Uint8Array, ctx: ParamContext): FieldRef | undefined {
  // [len][TO path int][len][field path int]
  const toLen = b[0];
  const to = pathValue(b.subarray(1, 1 + toLen));
  const fLen = b[1 + toLen];
  const field = pathValue(b.subarray(2 + toLen, 2 + toLen + fLen));
  if (to === undefined || field === undefined) return undefined;
  return {
    tableOccurrence: { id: to, name: ctx.tableOccurrenceName(to) ?? `<missing ${to}>` },
    field: { id: field, name: ctx.fieldName(to, field) ?? `<missing ${field}>` },
  };
}

/**
 * Stored find requests (Perform Find with Restore): .6.6.[request] holds one
 * value per field, keyed 00 <TO> <field> with the criteria as text, or a node
 * under that key with the criteria as its value 1. Key 252 (01 01) marks an
 * omit request.
 */
function findRequests(n: Node | undefined, ctx: ParamContext): StoredFindRequest[] {
  const out: StoredFindRequest[] = [];
  for (const [, r] of n?.child(6)?.numbered() ?? []) {
    const req: StoredFindRequest = { omit: r.kv.get(252)?.[1] === 1, criteria: [] };
    const unread: string[] = [];
    const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
    for (const { key, data } of r.kvLong) {
      const field = key[0] === 0 ? taggedField(key.subarray(1), ctx) : undefined;
      if (field) req.criteria.push({ field, criteria: decodeText(data) });
      else unread.push(`key ${hex(key)} (${data.length} bytes)`);
    }
    for (const [k, v] of r.kv) if (k !== 252) unread.push(`key ${k} (${v.length} bytes)`);
    for (const [k, c] of r.children) {
      // Some criteria (a private sample's "≥ $from" and "≤ $to" dates) are a node under the same 00 <TO> <field> key, with the criteria as value 1.
      const key = typeof k === 'string' && k.startsWith('0x00') ? Uint8Array.from(Buffer.from(k.slice(4), 'hex')) : undefined;
      const field = key && c.kv.has(1) ? taggedField(key, ctx) : undefined;
      if (field) req.criteria.push({ field, criteria: decodeText(c.kv.get(1)!) });
      else unread.push(`node ${String(k)} (${c.kv.size + c.kvLong.length} values, ${c.children.size} nodes)`);
    }
    if (unread.length) req.unread = unread;
    out.push(req);
  }
  return out;
}

/**
 * Sort order (key 10): u32 count, then per field its table occurrence and
 * field references, an optional summary field to reorder by, and the order:
 * 0 = ascending, 1 = descending, 2 = custom (value list).
 */
function sortFields(b: Uint8Array | undefined, ctx: ParamContext): SortField[] {
  if (!b || b.length < 4) return [];
  const count = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  const out: SortField[] = [];
  let at = 4;
  for (let i = 0; i < count && at < b.length; i++) {
    const toSize = b[at];
    const to = shortRef(b.subarray(at + 1, at + 1 + toSize));
    at += 1 + toSize;
    const fSize = b[at];
    const field = shortRef(b.subarray(at + 1, at + 1 + fSize));
    at += 1 + fSize;
    // 00 01, the summary field to reorder by (two references, 02 01 00 when
    // unused), 00 01 00, the order, 00 00 00 00
    at += 2;
    at += 1 + b[at];
    at += 1 + b[at];
    const order = b[at + 3];
    // The custom value-list reference/slot has not been established from a fixture.
    // Leave valueList unset rather than interpreting the remaining bytes as an id.
    at += 8;
    if (to === undefined || field === undefined) continue;
    out.push({
      field: {
        tableOccurrence: { id: to, name: ctx.tableOccurrenceName(to) ?? `<missing ${to}>` },
        field: { id: field, name: ctx.fieldName(to, field) ?? `<missing ${field}>` },
      },
      order: order === 1 ? 'descending' : order === 2 ? 'custom' : 'ascending',
    });
  }
  return out;
}

/** The targeted capability failure, shared by execution, lint and Design presentation. */
export function undecodedOptionError(stepId: number, p?: StepParams, calculations: string[] = []): string | undefined {
  if (stepId === 207 && (p?.undecodedOptions?.length || Object.keys(p?.slots ?? {}).length || calculations.some((c) => ![p?.calculation, p?.errorCode, p?.errorMessage].includes(c)))) {
    return 'Revert Transaction cannot run because its imported condition or error options are not decoded. Re-enter the intended options in script text or structured parameters. This step did not revert the transaction.';
  }
  if (stepId === 223 && (p?.undecodedOptions?.length || typeof p?.on !== 'boolean')) {
    return 'Set Revert Transaction on Error cannot run because its On/Off option is unspecified or not decoded. Specify On or Off explicitly. The current setting was not changed.';
  }
  if (stepId === 35 && (p?.importAction !== undefined && !['add', 'update', 'replace'].includes(p.importAction) || p?.undecodedOptions?.includes('Import mode') && !p.importAction)) {
    return 'Import Records cannot run because its Add/Update/Replace mode is unspecified or not decoded. Specify the mode explicitly and review match fields, add-remaining, and auto-enter options. No records were imported.';
  }
  return undefined;
}

/** Cached text cannot hide unresolved options, including evidence retained by older conversions. */
export function displayedStepLine(s: { stepId: number; name: string; line?: string; params?: StepParams; text?: string; calculations?: string[] }): string {
  if (s.stepId === 35 && s.params?.importAction && s.params.undecodedOptions?.includes('Import mode')) return stepLine(s.name, s.params, s.text);
  if (!undecodedOptionError(s.stepId, s.params, s.calculations)) return s.line ?? stepLine(s.name, s.params, s.text);
  const p = s.stepId === 207 && !s.params?.undecodedOptions?.length ? { ...s.params, undecodedOptions: ['Option payloads'] } : s.params;
  return stepLine(s.name, p, s.text);
}

const q = (s: string) => `“${s}”`;
const IMPORT_FORMATS: Record<string, string> = { COMS: 'Comma-Separated Values', TABS: 'Tab-Separated Values', MRGE: 'Merge', FMPR: 'FileMaker Pro' };
const COPY_KINDS = { copy: 'copy of current file', compacted: 'compacted copy (smaller)', clone: 'clone (no records)', 'self-contained': 'self-contained copy (single file)' } as const;
const EXPORT_FORMATS: Record<string, string> = { COMS: 'Comma-Separated Values', TABS: 'Tab-Separated Values', MRGE: 'Merge', FMPR: 'FileMaker Pro', XLXE: 'Excel Workbooks (.xlsx)', XML: 'XML' };
const fieldText = (f: FieldRef) => `${f.tableOccurrence.name}::${f.field.name}${f.repetition ? `[${f.repetition}]` : ''}`;

/** The step as FileMaker's script workspace shows it, e.g. `Set Field [ Card::Status ; $status ]`. */
export function stepLine(name: string, p: StepParams | undefined, comment?: string): string {
  if (name === '# (comment)') return comment ? `# ${comment}` : '';
  // Steps with a Select entire contents option show it even with no other options.
  if (!p && !['Insert Text', 'Insert Calculated Result', 'Copy', 'Cut', 'Paste', 'Clear', 'Set Revert Transaction on Error',
    'Execute FileMaker Data API', 'Insert from URL'].includes(name)) return name;
  p ??= {};
  const parts: string[] = [];
  const add = (s: string | undefined) => s !== undefined && s !== '' && parts.push(s);
  const fieldOrVar = () => (p.field ? fieldText(p.field) : p.variable);
  switch (name) {
    case 'Set Variable':
      add(p.variable + (p.repetition ? `[${p.repetition}]` : ''));
      add(p.value !== undefined ? `Value: ${p.value}` : undefined);
      break;
    case 'Send Mail': {
      const m = p.mail;
      if (m?.smtp) add('Send via SMTP Server');
      if (p.noDialog !== undefined) add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      if (!m) break;
      if (m.to !== undefined) add(`To: ${m.to}`);
      if (m.cc !== undefined) add(`CC: ${m.cc}`);
      if (m.bcc !== undefined) add(`BCC: ${m.bcc}`);
      if (m.subject !== undefined) add(`Subject: ${m.subject}`);
      if (m.message !== undefined) add(`Message: ${m.message}`);
      if (m.fromName !== undefined) add(`From name: ${m.fromName}`);
      if (m.fromEmail !== undefined) add(`From: ${m.fromEmail}`);
      for (const a of m.attachments ?? []) add(`Attachment: ${a}`);
      break;
    }
    case 'Perform Find/Replace': {
      const fr = p.findReplace;
      if (p.noDialog !== undefined) add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      if (!fr) break;
      add(fr.find);
      if (fr.operation !== 'Find Next') add(fr.replace ?? '""');
      add(fr.operation);
      if (fr.matchCase) add('Match case');
      if (fr.wholeWords) add('Whole words');
      if (fr.currentRecord) add('Across: Current record');
      if (fr.within) add(`Within: ${fr.within === 'all' ? 'All fields' : 'Current field'}`);
      break;
    }
    case 'Set Field':
    case 'Set Next Serial Value':
    case 'Insert Calculated Result':
    case 'Replace Field Contents':
      // Select entire contents: unless a script says otherwise (a decoded file doesn't yet), the whole field.
      if (name === 'Insert Calculated Result' && p.selectEntireContents !== false) add('Select');
      if (p.noDialog !== undefined) add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      add(fieldOrVar());
      if (p.replaceWith === 'current') add('Current contents');
      else if (p.replaceWith === 'serial') {
        const c = p.serial?.initial !== undefined;
        add(`Replace with serial numbers: ${c ? 'Custom values' : 'Entry Options'}`);
        if (c) add(`Initial value: ${p.serial!.initial}`);
        if (c) add(`Increment value: ${p.serial!.increment ?? '1'}`);
        if (p.serial?.updateEntryOptions) add('Update serial number in Entry Options');
      } else add(p.calculation);
      break;
    case 'Open File':
    case 'Close File':
      add(p.dataSource ? q(p.dataSource.name) : 'Current File');
      break;
    case 'Copy':
    case 'Cut':
    case 'Paste':
    case 'Clear':
    case 'Insert from Device':
      if (name !== 'Insert from Device' && p.selectEntireContents !== false) add('Select');
      add(fieldOrVar());
      if (p.device) add(`Type: ${p.device.type}`);
      if (p.device?.camera) add(`Camera: ${p.device.camera === 'front' ? 'Front' : 'Back'}`);
      break;
    case 'Insert File':
    case 'Install Plug-In File':
    case 'Export Field Contents':
      add(fieldOrVar());
      if (p.filePaths) add(`“${p.filePaths.join(' ')}”`);
      if (p.createFolders && name === 'Export Field Contents') add('Create folders: On');
      break;
    case 'Import Records':
      add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      if (p.tableOccurrence) add(`Table: ${p.tableOccurrence.name}`);
      if (p.filePaths) add(`${p.importFolder ? 'Folder' : 'Source'}: “${p.filePaths.join(' ')}”`);
      if (p.importFolder) {
        add(`File type: ${p.importFolder.kind === 'text' ? 'Text files' : 'Picture and movie files'}`);
        add(`Include enclosed folders: ${p.importFolder.enclosed ? 'On' : 'Off'}`);
      }
      if (p.worksheet) add(`Worksheet: “${p.worksheet}”`);
      add(IMPORT_FORMATS[p.importFormat ?? ''] ?? p.importFormat);
      if (p.xslt) add(`XSLT: “${p.xslt}”`);
      if (undecodedOptionError(35, p)) add('Mode: Undecoded');
      else if (p.importAction) add({ add: 'Add', update: 'Update', replace: 'Replace' }[p.importAction]);
      if (p.fieldMapping) add(`Fields: ${p.fieldMapping.map((m) => m.field && (m.import || m.match) ? fieldText(m.field) : "Don't Import").join(', ')}`);
      if (p.fieldMapping?.some((m) => m.match)) add(`Match fields: ${p.fieldMapping.filter((m) => m.match && m.field).map((m) => fieldText(m.field!)).join(', ')}`);
      if (p.addRemaining !== undefined) add(`Add remaining data as new records: ${p.addRemaining ? 'On' : 'Off'}`);
      if (p.performAutoEnter !== undefined) add(`Perform auto-enter options: ${p.performAutoEnter ? 'On' : 'Off'}`);
      break;
    case 'Get File Exists':
    case 'Get File Size':
    case 'Open Data File':
      if (p.filePaths) add(q(p.filePaths.join(' ')));
      add(fieldOrVar() && `Target: ${fieldOrVar()}`);
      break;
    case 'Create Data File':
      if (p.filePaths) add(q(p.filePaths.join(' ')));
      add(`Create folders: ${p.createFolders ? 'On' : 'Off'}`);
      break;
    case 'Delete File':
      if (p.filePaths) add(`Target file: ${q(p.filePaths.join(' '))}`);
      break;
    case 'Rename File':
      if (p.filePaths) add(`Source file: ${q(p.filePaths.join(' '))}`);
      add(p.newName !== undefined ? `New name: ${p.newName}` : undefined);
      break;
    case 'Write to Data File':
      add(p.fileId !== undefined ? `File ID: ${p.fileId}` : undefined);
      add(fieldOrVar() && `Data source: ${fieldOrVar()}`);
      add(`Write as: ${p.encoding === 'utf-8' ? 'UTF-8' : 'UTF-16'}`);
      if (p.appendLineFeed) add('Append line feed');
      break;
    case 'Read from Data File':
      add(p.fileId !== undefined ? `File ID: ${p.fileId}` : undefined);
      add(p.amount !== undefined ? `Amount (bytes): ${p.amount}` : undefined);
      add(fieldOrVar() && `Target: ${fieldOrVar()}`);
      add(`Read as: ${p.encoding === 'utf-8' ? 'UTF-8' : p.encoding === 'bytes' ? 'Bytes' : 'UTF-16'}`);
      break;
    case 'Get Data File Position':
      add(p.fileId !== undefined ? `File ID: ${p.fileId}` : undefined);
      add(fieldOrVar() && `Target: ${fieldOrVar()}`);
      break;
    case 'Set Data File Position':
      add(p.fileId !== undefined ? `File ID: ${p.fileId}` : undefined);
      add(p.calculation !== undefined ? `New position: ${p.calculation}` : undefined);
      break;
    case 'Close Data File':
      add(p.fileId !== undefined ? `File ID: ${p.fileId}` : undefined);
      break;
    case 'Export Records':
      add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      if (p.createFolders) add('Create folders: On');
      if (p.filePaths) add(q(p.filePaths.join(' ')));
      if (p.exportFormat) add(EXPORT_FORMATS[p.exportFormat] ?? p.exportFormat);
      if (p.xmlGrammar) add(`Grammar: ${p.xmlGrammar}`);
      if (p.xslt) add(`XSLT: “${p.xslt}”`);
      if (p.encoding) add(p.encoding === 'utf-16' ? 'Unicode (UTF-16)' : 'Unicode (UTF-8)');
      if (p.exportFields?.length) add(`Fields: ${p.exportFields.map(fieldText).join(', ')}`);
      break;
    case 'Save a Copy as':
      if (p.filePaths) add(q(p.filePaths.join(' ')));
      if (p.copyKind) add(COPY_KINDS[p.copyKind]);
      if (p.createFolders) add('Create folders: On');
      break;
    case 'Save Records as PDF':
      add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      if (p.appendPdf) add('Append');
      if (p.filePaths) add(q(p.filePaths.join(' ')));
      add(p.pdfRecords === 'current' ? 'Current record' : p.pdfRecords === 'blank' ? 'Blank record' : 'Records being browsed');
      add(`Create folders: ${p.createFolders ? 'On' : 'Off'}`);
      break;
    case 'Save Records as Snapshot Link':
      add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      if (p.filePaths) add(q(p.filePaths.join(' ')));
      if (p.pdfRecords) add(p.pdfRecords === 'current' ? 'Current record' : 'Records being browsed');
      add(`Create folders: ${p.createFolders ? 'On' : 'Off'}`);
      break;
    case 'Set Field By Name':
      add(p.fieldName);
      add(p.calculation);
      break;
    case 'Perform Script':
    case 'Perform Script on Server':
    case 'Install OnTimer Script':
      if (p.script) add((p.script.file ? `From file: ${q(p.script.file.name)}; ` : '') + q(p.script.name));
      else if (p.scriptCalculation !== undefined) add(`Specified: By name ; ${p.scriptCalculation}`);
      add(p.parameter !== undefined ? `Parameter: ${p.parameter}` : undefined);
      add(p.calculation !== undefined ? `Interval: ${p.calculation}` : undefined);
      if (p.wait === false && name === 'Perform Script on Server') add('Wait for completion: Off');
      break;
    case 'Perform Script on Server with Callback':
      if (p.script) add(q(p.script.name));
      add(p.parameter !== undefined ? `Parameter: ${p.parameter}` : undefined);
      if (p.callback) {
        add(`Callback script: ${q(p.callback.script.name)}`);
        add(p.callback.parameter !== undefined ? `Parameter: ${p.callback.parameter}` : undefined);
        add(p.callback.state !== undefined ? `State: ${p.callback.state}` : undefined);
      }
      break;
    case 'Go to Layout':
      if (p.layoutDestination === 'original') add('original layout');
      else if (p.layout) add(q(p.layout.name));
      else if (p.layoutCalculation) add(`${p.layoutDestination === 'number' ? 'Layout Number' : 'Layout Name'}: ${p.layoutCalculation}`);
      break;
    case 'Go to Record/Request/Page':
    case 'Go to Portal Row':
      add(p.location === 'calculation' ? `With dialog: ${p.noDialog ? 'Off' : 'On'}; ${p.calculation ?? ''}` : p.location && p.location[0].toUpperCase() + p.location.slice(1));
      if (p.exitAfterLast) add('Exit after last: On');
      break;
    case 'Set Error Capture':
    case 'Allow User Abort':
    case 'Allow Formatting Bar':
    case 'Set Layout Object Animation':
      add(p.on ? 'On' : 'Off');
      break;
    case 'Enable Touch Keyboard':
      add(p.toggle ? 'Toggle' : p.on ? 'On' : 'Off');
      break;
    case 'Set Revert Transaction on Error':
      add(undecodedOptionError(223, p) ? 'Undecoded options: On/Off' : p.on ? 'On' : 'Off');
      break;
    case 'Revert Transaction':
      if (undecodedOptionError(207, p)) {
        add(`Undecoded options: ${(p.undecodedOptions?.length ? p.undecodedOptions : ['Option payloads']).join(', ')}`);
        break;
      }
      if (p.calculation !== undefined) add(`Condition: ${p.calculation}`);
      if (p.errorCode !== undefined) add(`Error code: ${p.errorCode}`);
      if (p.errorMessage !== undefined) add(`Error message: ${p.errorMessage}`);
      break;
    case 'Exit Script':
      add(p.calculation !== undefined ? `Result: ${p.calculation}` : undefined);
      break;
    case 'Perform Find':
    case 'Enter Find Mode':
    case 'Constrain Found Set':
    case 'Extend Found Set':
      if (p.requests?.length) {
        add('Restore; ' + p.requests.map((r) =>
          `${r.omit ? 'Omit' : 'Find'}: ${r.criteria.map((c) => `${fieldText(c.field)}: ${q(c.criteria)}`).join(' AND ')}${
            r.unread && !r.criteria.length ? ` /* not read: ${r.unread.join(', ')} */` : ''}`).join('; '));
      }
      break;
    case 'Sort Records by Field':
      if (p.selectEntireContents) add('Select');
      if (p.sort?.[0]) add(`${fieldText(p.sort[0].field)}; ${p.sort[0].order === 'custom' ? 'Associated value list' : p.sort[0].order === 'descending' ? 'Descending' : 'Ascending'}`);
      else if (p.sortOrder) add(p.sortOrder === 'custom' ? 'Associated value list' : p.sortOrder === 'descending' ? 'Descending' : 'Ascending');
      if (p.sort?.[0]?.valueList) add(`Value list: ${q(p.sort[0].valueList.name)}`);
      break;
    case 'Sort Records':
      if (p.sort?.length) add('Restore; ' + p.sort.map((s) => `${fieldText(s.field)}; ${s.order}${s.order === 'custom' && s.valueList ? `; Value list: ${q(s.valueList.name)}` : ''}`).join('; '));
      if (p.noDialog) add('With dialog: Off');
      break;
    case 'Show Custom Dialog':
      add(p.title);
      add(p.message);
      p.buttons?.forEach((b, i) => add(`Button ${i + 1}: ${b}`));
      p.inputs?.forEach((x, i) => {
        add(`Input ${i + 1}: ${x.field ? fieldText(x.field) : x.variable}`);
        if (x.label !== undefined) add(`Label ${i + 1}: ${x.label}`);
        if (x.password) add(`Password ${i + 1}`);
      });
      p.commit?.forEach((c, i) => c !== (i !== 1) && add(`Commit ${i + 1}: ${c ? 'On' : 'Off'}`));
      break;
    case 'Insert Current Date':
    case 'Insert Current Time':
    case 'Insert Current User Name':
    case 'Insert from Last Visited':
    case 'Insert from Index':
      if (p.selectEntireContents) add('Select');
      add(fieldOrVar());
      break;
    case 'Insert Text':
      if (p.selectEntireContents !== false) add('Select');
      add(fieldOrVar());
      add(p.text !== undefined ? q(p.text) : undefined);
      break;
    case 'Insert from URL':
      add(p.selectEntireContents === false ? 'Select: Off' : 'Select');
      add(fieldOrVar());
      add(p.calculation);
      break;
    case 'Truncate Table':
      add(p.table ? `Table: ${p.table.name}` : p.tableOccurrence ? `Table: ${p.tableOccurrence.name}` : 'Table: <Current Table>');
      break;
    case 'Go to Related Record':
      if (p.matchFoundSet) add('Match all records in the found set');
      if (p.tableOccurrence) add(`From table: ${q(p.tableOccurrence.name)}`);
      add(p.layout ? `Using layout: ${q(p.layout.name)}` : 'Using layout: <Current Layout>');
      if (p.newWindow) add(p.slots?.[128] !== undefined ? `New window: ${p.slots[128]}` : 'New window');
      break;
    case 'Go to Field':
      add(fieldOrVar());
      break;
    case 'Delete Account':
    case 'Reset Account Password':
    case 'Enable Account':
    case 'Re-Login':
      if (p.accountName !== undefined) add(`Account Name: ${p.accountName}`);
      if (p.password !== undefined) add(`${name === 'Re-Login' ? 'Password' : 'New Password'}: ${p.password}`);
      if (p.expirePassword) add('Expire password');
      if (p.activate !== undefined) add(p.activate ? 'Activate' : 'Deactivate');
      if (name === 'Re-Login') add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      break;
    case 'Relookup Field Contents':
    case 'Find Matching Records':
      if (name === 'Relookup Field Contents') add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      if (p.findMode) add(p.findMode[0].toUpperCase() + p.findMode.slice(1));
      add(fieldOrVar());
      break;
    case 'Execute FileMaker Data API': {
      add(p.selectEntireContents === false ? 'Select: Off' : 'Select');
      const into = fieldOrVar();
      if (into) add(`Target: ${into}`);
      add(p.calculation);
      break;
    }
    case 'Add Account':
    case 'Change Password':
      if (p.accountName !== undefined) add(`Account Name: ${p.accountName}`);
      if (p.oldPassword !== undefined) add(`Old Password: ${p.oldPassword}`);
      if (p.password !== undefined) add(`${name === 'Add Account' ? 'Password' : 'New Password'}: ${p.password}`);
      if (p.privilegeSet) add(`Privilege Set: ${q(p.privilegeSet.name)}`);
      if (p.accountStatus) add(`Account Status: ${p.accountStatus[0].toUpperCase()}${p.accountStatus.slice(1)}`);
      if (p.expirePassword) add('Expire password');
      if (name === 'Change Password') add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      break;
    case 'Set Error Logging':
      add(p.on === false ? 'Off' : 'On');
      if (p.calculation !== undefined) add(`Custom debug info: ${p.calculation}`);
      break;
    case 'Save Records as Excel':
    case 'Save Records as JSONL':
      if (name === 'Save Records as Excel') add(`With dialog: ${p.noDialog ? 'Off' : 'On'}`);
      if (p.jsonl) {
        add(`Format for fine-tuning: ${p.jsonl.fineTuning ? 'On' : 'Off'}`);
        if (p.jsonl.system !== undefined) add(`System Prompt: ${p.jsonl.system}`);
        if (p.jsonl.user !== undefined) add(`User Prompt: ${p.jsonl.user}`);
        if (p.jsonl.assistant !== undefined) add(`Assistant Prompt: ${p.jsonl.assistant}`);
      }
      if (p.field) add(`Completion Field: ${fieldText(p.field)}`);
      if (p.filePaths) add(q(p.filePaths.join(' ')));
      if (p.createFolders !== undefined) add(`Create folders: ${p.createFolders ? 'On' : 'Off'}`);
      break;
    case 'Save a Copy as XML':
      if (p.filePaths) add(`Destination: ${q(p.filePaths.join(' '))}`);
      if (p.createFolders !== undefined) add(`Create folders: ${p.createFolders ? 'On' : 'Off'}`);
      break;
    case 'Open PDF':
    case 'Append PDF':
      if (p.field || p.variable) {
        add('From: Source');
        add(`Source: ${fieldOrVar()}`);
      } else {
        add('From: File');
        if (p.filePaths) add(q(p.filePaths.join(' ')));
      }
      if (p.password !== undefined) add(`Password: ${p.password}`);
      break;
    case 'Close PDF':
      if (p.field || p.variable) {
        add('Save to: Target');
        add(`Target: ${fieldOrVar()}`);
        if (p.newName !== undefined) add(`Filename: ${p.newName}`);
      } else {
        add('Save to: File');
        if (p.filePaths) add(q(p.filePaths.join(' ')));
        if (p.createFolders !== undefined) add(`Create folders: ${p.createFolders ? 'On' : 'Off'}`);
      }
      break;
    case 'Configure Persistent Data':
      if (p.text !== undefined) add(`Name: ${p.text}`);
      if (p.calculation !== undefined) add(`Instance ID: ${p.calculation}`);
      if (p.deleteEntry) add('Delete Entry');
      else if (p.value !== undefined) add(`Value: ${p.value}`);
      break;
    case 'Go to List of Records':
      if (p.calculation !== undefined) add(`List of record IDs: ${p.calculation}`);
      if (p.layout) add(`Using layout: ${q(p.layout.name)}`);
      if (p.newWindow) add('New window');
      break;
    case 'Insert Picture':
    case 'Insert PDF':
    case 'Insert Audio/Video':
      add(fieldOrVar());
      if (p.filePaths) add(q(p.filePaths.join(' ')));
      break;
    case 'Install Menu Set':
      if (p.menuSet) add(q(p.menuSet.name));
      if (p.fileDefault) add('Use as file default');
      break;
    case 'New Window':
      if (p.windowStyle) add(`Style: ${p.windowStyle[0].toUpperCase()}${p.windowStyle.slice(1)}`);
      for (const v of Object.values(p.slots ?? {})) add(v);
      if (p.layout) add(`Using layout: ${q(p.layout.name)}`);
      else if (p.layoutCalculation) add(`Using layout: ${p.layoutCalculation}`);
      break;
    case 'Perform JavaScript in Web Viewer':
      add(p.objectName !== undefined ? `Object Name: ${p.objectName}` : undefined);
      add(p.functionName !== undefined ? `Function Name: ${p.functionName}` : undefined);
      add(p.jsParameters?.length ? `Parameters: ${p.jsParameters.join(', ')}` : undefined);
      break;
    case 'Refresh Window':
      if (p.flushJoinResults) add('Flush cached join results');
      if (p.flushExternalData) add('Flush cached external data');
      break;
    case 'Refresh Portal':
      add(p.objectName !== undefined ? `Object Name: ${p.objectName}` : undefined);
      break;
    case 'Refresh Object':
      add(p.objectName !== undefined ? `Object Name: ${p.objectName}` : undefined);
      add(p.objectRepetition !== undefined ? `Repetition: ${p.objectRepetition}` : undefined);
      break;
    case 'Set Web Viewer':
      add(p.objectName !== undefined ? `Object Name: ${p.objectName}` : undefined);
      if (p.viewerAction === 'Go to URL') add(p.viewerUrl !== undefined ? `URL: ${p.viewerUrl}` : 'Go to URL');
      else add(p.viewerAction);
      break;
    case 'Go to Object':
      add(p.objectName !== undefined ? `Object Name: ${p.objectName}` : undefined);
      add(p.repetitionCalculation !== undefined ? `Repetition: ${p.repetitionCalculation}` : undefined);
      break;
    case 'Close Window':
    case 'Select Window': {
      const window = p.calculation ?? p.slots?.[128];
      add(window !== undefined ? `Name: ${window}` : 'Current Window');
      break;
    }
    case 'Move/Resize Window':
      add(p.calculation !== undefined ? `Name: ${p.calculation}` : 'Current Window');
      for (const k of ['height', 'width', 'top', 'left'] as const) {
        const v = p.bounds?.[k];
        if (v !== undefined) add(`${k[0].toUpperCase()}${k.slice(1)}: ${v}`);
      }
      break;
    case 'Adjust Window':
      if (p.adjust) add(p.adjust.replace(/\b\w/g, (c) => c.toUpperCase()).replace('To', 'to'));
      break;
    case 'Undo/Redo':
      if (p.undo) add(p.undo[0].toUpperCase() + p.undo.slice(1));
      break;
    case 'Scroll Window':
      if (p.scroll) add(p.scroll.replace(/\b\w/g, (c) => c.toUpperCase()));
      break;
    case 'View As':
      if (p.view) add(p.view === 'cycle' ? 'Cycle' : `View as ${p.view[0].toUpperCase()}${p.view.slice(1)}`);
      break;
    case 'Set Zoom Level':
      if (p.lock) add('Lock');
      if (p.zoomCalculation !== undefined) add(p.zoomCalculation);
      else if (typeof p.zoom === 'number') add(`${p.zoom}%`);
      else if (p.zoom) add(p.zoom === 'in' ? 'Zoom In' : 'Zoom Out');
      break;
    case 'Set Selection':
      if (p.field) add(fieldText(p.field));
      if (p.selectionStart !== undefined) add(`Start Position: ${p.selectionStart}`);
      if (p.selectionEnd !== undefined) add(`End Position: ${p.selectionEnd}`);
      break;
    case 'Check Selection':
      if (p.selectEntireContents) add('Select');
      if (p.field) add(fieldText(p.field));
      break;
    case 'Show/Hide Text Ruler':
      if (p.showHide) add(p.showHide[0].toUpperCase() + p.showHide.slice(1));
      break;
    case 'Show/Hide Toolbars':
    case 'Show/Hide Menubar':
      if (p.lock) add('Lock');
      if (p.showHide) add(p.showHide[0].toUpperCase() + p.showHide.slice(1));
      break;
    case 'Perform Find by Natural Language':
    case 'Perform RAG Action':
    case 'Configure Prompt Template': {
      const ai = p.ai ?? {};
      const label = (l: string, v: string | undefined) => add(v !== undefined ? `${l}: ${v}` : undefined);
      label('RAG Account Name', ai.ragAccountName);
      label('Space ID', ai.spaceId);
      if (ai.ragAction) add(`Action: ${ai.ragAction[0].toUpperCase()}${ai.ragAction.slice(1)}`);
      if (ai.dataSource) add(`RAG Data: ${ai.dataSource[0].toUpperCase()}${ai.dataSource.slice(1)}`);
      if (name === 'Perform RAG Action') label('Text', ai.input);
      if (name === 'Perform RAG Action' && p.filePaths) add(`Input File: ${q(p.filePaths.join(' '))}`);
      label('Tokens per text chunk', ai.tokensPerChunk);
      label('Account Name', ai.accountName);
      label('Model', ai.model);
      label('Prompt', ai.prompt);
      if (ai.findGet) add(`Get: ${ai.findGet[0].toUpperCase()}${ai.findGet.slice(1)}`);
      label(name === 'Configure Prompt Template' ? 'Template Name' : 'Prompt Template Name', ai.templateName);
      if (ai.requestType) add(`Template Type: ${ai.requestType}`);
      label('SQL Prompt', ai.sqlPrompt);
      label('Natural Language Prompt', ai.naturalLanguagePrompt);
      label('Parameters', ai.parameters);
      const target = fieldOrVar();
      if (target) add(`${name === 'Perform RAG Action' ? 'Input' : name === 'Perform Find by Natural Language' ? 'Response Target' : 'Target'}: ${target}`);
      label('Response Target', ai.responseVariable);
      for (const v of Object.values(p.slots ?? {})) add(v);
      break;
    }
    case 'Configure RAG Account': {
      const ai = p.ai ?? {};
      add(ai.ragAccountName !== undefined ? `RAG Account Name: ${ai.ragAccountName}` : undefined);
      add(ai.endpoint !== undefined ? `Endpoint: ${ai.endpoint}` : undefined);
      if (ai.apiKey !== undefined) add(`API key: ${ai.apiKey.startsWith('"') ? '"…"' : ai.apiKey}`);
      for (const v of Object.values(p.slots ?? {})) add(v);
      break;
    }
    case 'Perform SQL Query by Natural Language': {
      const ai = p.ai ?? {};
      const label = (l: string, v: string | undefined) => add(v !== undefined ? `${l}: ${v}` : undefined);
      const cap = (v: string) => v[0].toUpperCase() + v.slice(1);
      label('Account Name', ai.accountName);
      label('Model', ai.model);
      label('Prompt', ai.prompt);
      const actions = { 'query': 'Query', 'query for data only': 'Query for Data Only', 'get sql': 'Get SQL', 'get first sql only': 'Get First SQL Only', 'get ddl': 'Get DDL' };
      if (ai.sqlAction) add(`Action: ${actions[ai.sqlAction]}`);
      if (ai.dataTables) add(`Data Tables: ${cap(ai.dataTables)}`);
      if (ai.tables?.length) add(`Tables: ${ai.tables.join(', ')}`);
      label(ai.dataTables === 'by ddl' ? 'DDL' : 'Table Names', ai.tablesCalculation);
      if (ai.stream !== undefined) add(`Stream: ${ai.stream ? 'On' : 'Off'}`);
      label('Parameters', ai.parameters);
      label('Prompt Template Name', ai.templateName);
      const target = fieldOrVar();
      if (target) add(`Response Target: ${target}`);
      for (const v of Object.values(p.slots ?? {})) add(v);
      break;
    }
    case 'Generate Response from Model': {
      const ai = p.ai ?? {};
      const label = (l: string, v: string | undefined) => add(v !== undefined ? `${l}: ${v}` : undefined);
      label('Account Name', ai.accountName);
      label('Model', ai.model);
      label('User Prompt', ai.input);
      label('Instructions', ai.instructions);
      label('Messages', ai.messagesVariable);
      label('Save Message History To', ai.historyVariable);
      label('Message History Count', ai.historyCount);
      const target = fieldOrVar();
      if (target) add(`Response: ${target}`);
      for (const v of Object.values(p.slots ?? {})) add(v);
      break;
    }
    case 'Configure AI Account':
    case 'Insert Embedding':
    case 'Insert Embedding in Found Set':
    case 'Perform Semantic Find': {
      const ai = p.ai ?? {};
      const semantic = name === 'Perform Semantic Find';
      if (semantic && ai.queryBy) add(`Query by: ${ai.queryBy[0].toUpperCase()}${ai.queryBy.slice(1)}`);
      if (!semantic || ai.queryBy !== 'vector data') {
        add(ai.accountName !== undefined ? `Account Name: ${ai.accountName}` : undefined);
        add(ai.model !== undefined ? `${semantic ? 'Embedding Model' : 'Model'}: ${ai.model}` : undefined);
      }
      add(ai.endpoint !== undefined ? `Endpoint: ${ai.endpoint}` : undefined);
      if (ai.apiKey !== undefined) add(`API key: ${ai.apiKey.startsWith('"') ? '"…"' : ai.apiKey}`);
      if (semantic && ai.queryBy === 'vector data') add(ai.vector !== undefined ? `Vector: ${ai.vector}` : undefined);
      else add(ai.input !== undefined ? `${semantic ? 'Text' : 'Input'}: ${ai.input}` : undefined);
      if (ai.sourceField) add(`Source Field: ${fieldText(ai.sourceField)}`);
      if (ai.recordSet) add(`Record set: ${ai.recordSet[0].toUpperCase()}${ai.recordSet.slice(1)}`);
      const target = fieldOrVar();
      if (target) add(`Target${name === 'Insert Embedding in Found Set' ? ' Field' : ''}: ${target}`);
      if (name === 'Insert Embedding in Found Set') {
        if (ai.replaceTarget !== false) add('Replace target contents');
        if (ai.continueOnError) add('Continue on error');
        if (ai.showSummary) add('Show summary');
        add(ai.parameters !== undefined ? `Parameters: ${ai.parameters}` : undefined);
      }
      add(ai.returnCount !== undefined ? `Return count: ${ai.returnCount}` : undefined);
      if (ai.condition) add(`Cosine similarity condition: ${ai.condition}`);
      add(ai.threshold !== undefined ? `Cosine similarity value: ${ai.threshold}` : undefined);
      for (const v of Object.values(p.slots ?? {})) add(v);
      break;
    }
    case 'Commit Records/Requests':
      if (p.noDialog) add('With dialog: Off');
      if (p.skipValidation) add('Skip data entry validation');
      break;
    case 'Open Transaction':
      if (p.skipAutoEnter) add('Skip auto-enter options');
      if (p.skipValidation) add('Skip data entry validation');
      break;
    default:
      add(p.calculation);
      add(p.objectName);
      for (const v of Object.values(p.slots ?? {})) add(v);
      if (p.noDialog && !parts.length) add('With dialog: Off');
  }
  if (!parts.length && name === 'Insert Text' && p.selectEntireContents === false) return `${name} [ ; ]`;
  if (!parts.length && ['Insert Calculated Result', 'Copy', 'Cut', 'Paste', 'Clear'].includes(name) && p.selectEntireContents === false) return `${name} [ ; ]`;
  return parts.length ? `${name} [ ${parts.join(' ; ')} ]` : name;
}

/** A whole script as text, indented like FileMaker's script workspace; disabled steps start with //. */
export function scriptText(steps: { stepId: number; name: string; enabled: boolean; line?: string; params?: StepParams; text?: string; calculations?: string[] }[]): string {
  let depth = 0;
  return steps.map((s) => {
    const opens = s.stepId === 68 || s.stepId === 71; // If, Loop
    const closes = s.stepId === 70 || s.stepId === 73; // End If, End Loop
    const middle = s.stepId === 69 || s.stepId === 125; // Else, Else If
    if (s.enabled && (closes || middle)) depth = Math.max(0, depth - 1);
    const line = '\t'.repeat(depth) + (s.enabled ? '' : '// ') + displayedStepLine(s).replace(/\r\n?|\n/g, '\n' + '\t'.repeat(depth + 1));
    if (s.enabled && (opens || middle)) depth++;
    return line;
  }).join('\n');
}

/**
 * A file path list (key 130): u32 count, then per path a length-prefixed kind
 * ("file", "filemac", "filewin", "image", ... or none), the folder (a length in
 * characters, then text whose separators are U+E000), and a length-prefixed file name.
 */
export function pathList(b: Uint8Array | undefined): string[] {
  if (!b || b.length < 4) return [];
  const count = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  const out: string[] = [];
  let at = 4;
  for (let i = 0; i < count && at + 3 <= b.length; i++) {
    const kind = decodeText(b.subarray(at + 1, at + 1 + b[at]));
    at += 1 + b[at];
    const folder = decodeTextChars(b.subarray(at + 1), b[at]);
    at += 1 + folder.end;
    const name = decodeText(b.subarray(at + 1, at + 1 + b[at]));
    at += 1 + b[at];
    out.push((kind ? `${kind}:` : '') + folder.text.replace(/\uE000/g, '/') + name);
  }
  return out;
}
