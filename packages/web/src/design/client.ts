// Talks to the design endpoints (/tabularius/design/v1), with the web client's session.

import type { LayoutDesign, LayoutObject, Theme } from '../types.ts';
import type { Samples } from '../modernize.ts';
import { httpProblem } from '../http-problem.ts';

/** A theme's design tokens (store/token-theme.ts): #rrggbb colours, a font, sizes in points. */
export interface ThemeTokens { accent: string; accentText: string; text: string; muted: string; background: string; panel: string; line: string; font: string; size: number; radius: number }

/** What restyling every layout in a file would do (POST /restyle). */
export interface FileRestyle {
  changes: Change[];
  layouts: { id: number; name: string; before: LayoutDesign; after: LayoutDesign; notes: string[]; changed: number; issues?: { before: number; after: number } }[];
  unchanged: { id: number; name: string; why: string }[];
  theme: string;
  themeContent?: Theme;
}

export class DesignError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** Tabularius's own runaway guard on a script: stop it after so many steps or seconds, or a loop after so many times round. */
export interface ScriptLimits { steps?: number; seconds?: number; loopPasses?: number }

/** One problem the layout linter found (packages/store/src/layout-lint.ts). */
/** A redesign that makes a layout faster (server: store/layout-speed.ts), with its estimated cost after. */
export interface SpeedMove { kind: string; objectIds: number[]; title: string; caveat?: string; changes: Change[]; after: number; ai?: boolean; details?: string[] }
export interface SpeedPlan {
  layout: { id: number; name: string };
  before: number;
  moves: SpeedMove[];
  left: { kind: string; objectIds: number[]; message: string; cost?: number }[];
  ai?: { ideas?: number; dropped?: string[]; note?: string };
}

export interface LintIssue {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  objectIds: number[];
  message: string;
  /** Fix mends it in one step. */
  fixable?: boolean;
  /** Slow objects: estimated record reads to draw the layout once. */
  cost?: number;
}

/** A script test case (packages/store/src/script-tests.ts): saved inputs and what the script should end with. */
export interface ScriptTestCase {
  id: string;
  script: number;
  name: string;
  given: { parameter?: string; layout?: string; find?: Record<string, string>[]; record?: number; globals?: Record<string, string>; ai?: string[] };
  expect: ScriptTestEnd;
}

/** A script's step timings: each step's own time (not the scripts it calls) and how often it ran. */
export interface ScriptProfileData {
  since: string;
  runs: number;
  totalMs: number;
  averageMs: number;
  maxMs: number;
  errors: number;
  lastRun: string;
  /** Each timed step that is still the step at its place, with `at`, its first line in the editor. */
  steps: { index: number; at: number; line: string; count: number; perRun: number; totalMs: number; averageMs: number; maxMs: number; errors: number }[];
  /** Timed steps left out because the script changed there since. */
  changed: number;
}

/** What one run of a script would change, record by record, each field before and after. */
export interface ScriptDryRun {
  ended: ScriptTestEnd;
  message?: string;
  changes: {
    records: { file?: string; table: string; recordId: number; kind: 'create' | 'update' | 'delete'; fields: { field: string; before: string; after: string }[] }[];
    more: number;
    truncated: { file?: string; table: string; records: number }[];
    incomplete?: boolean;
  };
}

export interface ScriptTestEnd {
  result?: string;
  error?: number;
  foundCount?: number;
  layout?: string;
  variables?: Record<string, string>;
  fields?: Record<string, string>;
}

/** How a test case ran (packages/scripts/src/script-tests.ts). */
/** A test case the AI proposed, after one offline run on a copy: whether the script did what the case expects. */
export interface SuggestedTest {
  name: string;
  why?: string;
  given: ScriptTestCase['given'];
  expect: ScriptTestEnd;
  passed: boolean;
  failures: { what: string; expected: string; actual: string }[];
  message?: string;
  /** The case with what the run did in place of each expectation it missed. */
  asRuns?: ScriptTestEnd;
  /** What the run would change: records created, changed and deleted, more past those listed, and tables emptied. */
  changes?: { create: number; update: number; delete: number; more?: number; emptied?: string[] };
}

/** What a script uses and what starts it (server: scripts/{id}/dependencies). */
export interface ScriptDependencies {
  script: string;
  uses: { kind: 'field' | 'layout' | 'script' | 'valueList' | 'customFunction'; name: string; lines: number[]; byName?: boolean }[];
  startedBy: { how: 'script' | 'button' | 'trigger'; name: string }[];
  outbound: string[];
}

/** A drafted version of a script against the script itself (server: scripts/{id}/compare). */
export interface ScriptComparison {
  /** Each run, the script and the draft side by side. */
  cases: { name: string; same: boolean; differences: { what: string; expected: string; actual: string }[] }[];
  /** The script's saved test cases, run against the draft. */
  tests: ScriptTestOutcome[];
  /** Every run ended the same, and no saved test case that passed fails with the draft. */
  equal: boolean;
}

export interface ScriptTestOutcome {
  id: string;
  name: string;
  script: string;
  passed: boolean;
  failures: { what: string; expected: string; actual: string }[];
  message?: string;
  steps: number;
  ms: number;
}

/** One problem the script linter found (packages/store/src/script-lint.ts): a loop that never ends, a guard that catches nothing. */
/** A place a script could be simpler or faster (store/script-refactor.ts). */
export interface RefactorHint {
  kind: 'dead-branch' | 'unreachable' | 'repeated' | 'same-as-script' | 'record-loop' | 'find-in-loop' | 'commit-in-loop' | 'slow-step' | 'disabled';
  line: number;
  endLine: number;
  message: string;
  fix: string;
}

export interface ScriptLintIssue {
  rule: string;
  severity: 'error' | 'warning';
  /** Line in the text checked, from 1. */
  line: number;
  message: string;
  fix: string;
  /** Why it happens, in more depth (for a count: where it comes from and when it is 0). */
  detail?: string;
}

export interface DesignField {
  id: number;
  name: string;
  kind: 'normal' | 'calculation' | 'summary' | 'unknown';
  type: 'text' | 'number' | 'date' | 'time' | 'timestamp' | 'container' | 'unknown';
  comment?: string;
  calculation?: string;
  calculationContextId?: number;
  options?: {
    global: boolean;
    unstored: boolean;
    repetitions: number;
    /** Storage: the value and word indexes kept (none when absent); automatic indexing unless noAutoIndex. */
    index?: { value?: true; word?: true };
    noAutoIndex?: true;
    indexLanguage?: string;
    indexLanguageId?: number;
    evaluateWhenEmpty?: boolean;
    /** Container fields: FileMaker's "Store container data externally" (Tabularius keeps the data in the database either way). */
    externalStorage?: { directoryId: number; path?: string; secure?: boolean; fewerFolders?: boolean };
    autoEnter?: {
      value?: string; serial?: { next: string; increment: number; onCommit?: boolean }; data?: string; calculation?: boolean; replaceExisting?: boolean; evaluateWhenEmpty?: boolean;
      lookup?: { fromId?: number; occurrenceId: number; fieldId: number; noMatch?: 'keep' | 'empty' | 'value' | 'lower' | 'higher'; value?: string; copyEmpty?: boolean };
      prohibitModification?: boolean;
      lastVisited?: boolean;
    };
    validation?: { always?: boolean; strict?: boolean; notEmpty?: boolean; unique?: boolean; range?: { min: string; max: string }; maxLength?: number; valueList?: number; calculation?: string; message?: string;
      calculationAlways?: boolean; messageCalculation?: boolean;
      type?: 'number' | 'date4' | 'time'; existing?: boolean };
  };
  summary?: { type: string; fieldId: number; field?: string };
}

export interface DesignTable { id: number; name: string; fields: DesignField[]; records: number | null }
export interface DesignOccurrence { id: number; name: string; baseTableId?: number; dataSourceId?: number; table?: string; file?: string; color?: string; graph?: { left: number; top: number; width: number; height: number } }
export interface DesignRelationship {
  id: number; leftTableOccurrenceId: number; rightTableOccurrenceId: number; leftTableOccurrence?: string; rightTableOccurrence?: string;
  predicates: { leftFieldId: number; operator: string; rightFieldId: number; leftField?: string; rightField?: string }[];
  leftCreate?: boolean; rightCreate?: boolean; leftDelete?: boolean; rightDelete?: boolean;
}
export interface OrderedItem { id: number; name: string; kind: 'item' | 'folder' | 'separator' | 'folder-end' | 'unknown'; depth: number; /** "Include in menu" unchecked. */ hidden?: true }
export interface DesignStep { stepId: number; name: string; enabled: boolean; text?: string; line?: string; params?: Record<string, unknown> }

export interface DesignValueList {
  id: number; name: string; values?: string[];
  field?: { occurrenceId: number; fieldId: number; secondFieldId?: number; showSecondOnly?: boolean; relatedFromId?: number; sortBySecond?: boolean };
}

export interface DeletedItem { id: number; kind: 'table' | 'field'; table: string; name: string; at: string; account: string | null; records: number }

export interface Design {
  database: string;
  fileMode?: 'native';
  tables: DesignTable[];
  tableOccurrences: DesignOccurrence[];
  relationships: DesignRelationship[];
  /** Manage External Data Sources: hosted is the database a file reference finds. */
  dataSources?: DesignDataSource[];
  /** Manage Containers: base directories (0 is the default) and the fields storing there. */
  containerDirectories?: { id: number; path: string; fields: { table: string; field: string; tableId: number; fieldId: number }[] }[];
  containerData?: { files: number; bytes: number };
  /** File Options: the layout the file opens on and its open and close scripts. */
  fileOptions?: { openLayoutId?: number; openLayout?: string; onFirstWindowOpen?: { scriptId: number; script?: string }; onLastWindowClose?: { scriptId: number; script?: string }; onWindowOpen?: { scriptId: number; script?: string }; onWindowClose?: { scriptId: number; script?: string } };
  valueLists: DesignValueList[];
  customFunctions: { id: number; name: string; parameters: string[]; formula?: string; language?: 'javascript' }[];
  /** Deleted tables and fields whose data is kept, newest first. */
  deleted?: DeletedItem[];
  layouts: { id: number; name: string; tableOccurrenceId?: number; occurrence?: string; menuSetId?: number;
    /** A phone layout made from another (of), and whether it still follows that layout's changes. */ phone?: { of: number; following: boolean } }[];
  layoutOrder: OrderedItem[];
  scripts: { id: number; name: string; steps: DesignStep[]; text: string; limits?: ScriptLimits }[];
  scriptOrder: OrderedItem[];
  /** `tokens`: the theme's look as design tokens; `unmapped`: tokens it doesn't set (Tabularius's own used). */
  themes: { id: number; name: string; styles?: { name: string; element?: number }[]; tokens?: ThemeTokens; unmapped?: (keyof ThemeTokens)[] }[];
  /** Layout components (not in FileMaker): objects saved once and placed on many layouts, with the layouts they're on. */
  components?: DesignComponent[];
  privilegeSets: string[];
  /** The file's page setup (paper and margins), when it has one. */
  pageSetup?: import('../preview.ts').PageSetup;
  scriptSteps?: string[];
  customMenus?: DesignMenu[];
  customMenuSets?: DesignMenuSet[];
  defaultMenuSetId?: number | null;
  menuCommands?: { id: number; name: string }[];
}

/** A layout component: its objects are measured from its top left corner. */
export interface DesignComponent { id: number; name: string; width: number; height: number; objects: LayoutObject[]; layouts: number[]; library?: { id: string; version: number } }

/** A component in the server's library, shared by every file here; `here` is this file's copy of it, if any. */
export interface LibraryComponent {
  id: string; name: string; width: number; height: number; objects: LayoutObject[]; version: number; updated: string; from: string;
  /** The file it was first saved from: only it saves new versions or takes it out. */
  owner: string; uses: string[];
  here?: { component: number; version: number };
}

/** What placing a library component in a file, or taking its latest version, would do there. */
export interface LibraryPreview {
  version: number; current?: number; missing: string[];
  layouts: { id: number; name: string; before: LayoutDesign; after: LayoutDesign }[];
}

export interface DesignDataSource {
  id: number; name: string; paths: string[]; kind: 'file' | 'odbc'; hosted?: string; occurrences: number;
  /** The hosted file's tables, when this account may design that file too: for occurrences into it. */
  tables?: { id: number; name: string; fields: DesignField[] }[];
}

export interface DesignMenuItem {
  kind: 'command' | 'submenu' | 'separator';
  commandId?: number; command?: string; title?: string; installWhen?: string;
  submenuId?: number; submenu?: string; scriptId?: number; script?: string; parameter?: string;
  shortcut?: { key: string; modifiers: number }; flags: number;
}
export interface DesignMenu { id: number; name: string; basedOn?: number; comment?: string; installWhen?: string; items: DesignMenuItem[] }
export interface DesignMenuSet { id: number; name: string; comment?: string; menuIds: number[] }

export type Change = { op: string } & Record<string, unknown>;

export interface ConversionItem { name: string; count: number; where: string[] }
/** What in the file won't work yet (see packages/server/src/conversion.ts). */
export interface ConversionReport {
  database: string;
  summary: string;
  functions: { notYet: ConversionItem[]; undecoded: ConversionItem[]; plugIns: ConversionItem[] };
  steps: { notYet: ConversionItem[]; blocked: ConversionItem[]; network: ConversionItem[]; screenOnly: ConversionItem[]; clientOnly?: ConversionItem[] };
  unparsed: { where: string; text: string; error: string }[];
  broken: { where: string; text: string }[];
  dataSources: { name: string; paths: string[]; occurrences: number; hosted?: string }[];
  accounts: { withoutPassword: string[]; blankPassword: string[] };
}

export interface HistoryEntry { seq: number; at: string; account: string | null; op: Change }

const enc = encodeURIComponent;

export class DesignClient {
  readonly db: string;
  readonly token: string;

  constructor(db: string, token: string) {
    this.db = db;
    this.token = token;
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const r = await fetch(`/tabularius/design/v1/databases/${enc(this.db)}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new DesignError(json.error?.code ?? -1, json.error?.message ?? httpProblem(r.status));
    return json;
  }

  design(): Promise<Design> {
    return this.call('GET', '');
  }

  /** Applies the changes (all or none); `undo` takes them back, when they only added things. */
  async change(changes: Change[]): Promise<{ applied: Change[]; undo?: Change[]; design: Design }> {
    return this.call('POST', '', { changes });
  }

  /** Changes staged for review, described (design-review.ts). */
  pending(): Promise<PendingReview> {
    return this.call('GET', '/pending');
  }

  /** Stages changes without making them. */
  stage(changes: Change[]): Promise<PendingReview & { staged: number[] }> {
    return this.call('POST', '/pending', { changes });
  }

  /** Applies staged changes (all when `ids` is absent); those in conflict wait unless named in `overrideConflicts`. */
  applyPending(ids?: number[], overrideConflicts: number[] = []): Promise<PendingReview & { result: PendingResult; design: Design }> {
    return this.call('POST', '/pending/apply', { ...(ids ? { ids } : {}), overrideConflicts });
  }

  discardPending(ids?: number[]): Promise<PendingReview & { discarded: number }> {
    return this.call('POST', '/pending/discard', ids ? { ids } : {});
  }

  /** The server's component library. */
  async library(): Promise<LibraryComponent[]> {
    return (await this.call('GET', '/library')).library;
  }

  /** Saves one of this file's components to the library (its next version, when it's already a copy of one). */
  async saveToLibrary(component: number): Promise<{ entry: LibraryComponent; design: Design }> {
    return this.call('POST', '/library', { component });
  }

  /** What placing a library component here, or taking its latest version, would change. */
  async previewFromLibrary(id: string): Promise<LibraryPreview> {
    return this.call('POST', `/library/${enc(id)}`, { preview: true });
  }

  /** Places a library component in this file, or brings this file's copy up to its latest version. */
  async takeFromLibrary(id: string): Promise<{ missing: string[]; design: Design }> {
    return this.call('POST', `/library/${enc(id)}`, {});
  }

  async removeFromLibrary(id: string): Promise<void> {
    await this.call('DELETE', `/library/${enc(id)}`);
  }

  async layout(id: number): Promise<LayoutDesign> {
    return (await this.call('GET', `/layouts/${id}`)).design;
  }

  /** The layout linter's issues, on the saved layout or on the design given (what the editor has open). */
  async lint(id: number, design?: LayoutDesign): Promise<LintIssue[]> {
    return (await this.call(design ? 'POST' : 'GET', `/layouts/${id}/lint`, design ? { design } : undefined)).issues;
  }

  /** What a phone layout made from this design shows, and the phone layout already made from it, if any (nothing is saved). */
  async phone(id: number, design: LayoutDesign): Promise<{ phone: LayoutDesign; existing?: { id: number; name: string; following: boolean; design: LayoutDesign } }> {
    return this.call('POST', `/layouts/${id}/phone`, { design });
  }

  /** Every layout onto one theme (an existing one, or new from tokens): before and after each, and the changes (nothing is saved). */
  restyle(req: { theme?: number; tokens?: Partial<ThemeTokens>; name?: string; consistent?: boolean; layouts?: number[] }): Promise<FileRestyle> {
    return this.call('POST', '/restyle', req);
  }

  /** The assistant's model and its list prices (US dollars per million tokens), when the AI assistant is on and this account may use it. */
  async assistantModel(): Promise<{ model: string; price?: { input: number; output: number } } | undefined> {
    try {
      const r = await fetch(`/tabularius/assistant/v1/databases/${enc(this.db)}`, { headers: { authorization: `Bearer ${this.token}` } });
      const body = r.ok ? await r.json() as { available?: boolean; model?: string; price?: { input: number; output: number } } : undefined;
      return body?.available && body.model ? { model: body.model, ...(body.price ? { price: body.price } : {}) } : undefined;
    } catch {
      return undefined;
    }
  }

  /** New layouts for each table from templates, beside the file's own, and the changes that make them (nothing is saved). */
  modernize(req: { tables?: string[]; styles?: string[]; folder?: boolean; fromLayouts?: boolean }): Promise<{
    layouts: { name: string; table: string; style: string; notes: string[]; samples?: Samples }[];
    skipped: { table: string; style?: string; why: string }[];
    changes: Change[];
  }> {
    return this.call('POST', '/modernize', req);
  }

  /** The script linter's findings on a script's text (what the editor has open). */
  async lintScript(text: string, script?: number): Promise<ScriptLintIssue[]> {
    return (await this.call('POST', '/scripts/lint', { text, ...(script !== undefined ? { script } : {}) })).issues;
  }

  /** The design with the linter's fixable findings mended (all, or `only` these); nothing is saved. */
  async fix(id: number, design: LayoutDesign, only?: LintIssue[]): Promise<{ design: LayoutDesign; fixed: LintIssue[]; changes: Change[]; issues: LintIssue[] }> {
    return this.call('POST', `/layouts/${id}/fix`, { design, ...(only ? { only: only.map((i) => ({ rule: i.rule, objectIds: i.objectIds })) } : {}) });
  }

  /** Check's speed findings on the saved layout, each with a redesign where there is one (with `ai`, ideas from the assistant too); nothing is saved. */
  async speed(id: number, ai = false): Promise<SpeedPlan> {
    return this.call('POST', `/layouts/${id}/speed`, { ai });
  }

  /** A script's test cases. */
  async scriptTests(script: number): Promise<ScriptTestCase[]> {
    return (await this.call('GET', `/script-tests?script=${script}`)).tests;
  }

  async saveScriptTest(test: Omit<ScriptTestCase, 'id'> & { id?: string }): Promise<ScriptTestCase> {
    return (await this.call('POST', '/script-tests', { test })).test;
  }

  async deleteScriptTest(id: string): Promise<void> {
    await this.call('DELETE', `/script-tests/${enc(id)}`);
  }

  /** Runs a script's test cases offline on a copy of the file. */
  async runScriptTests(script: number, ids?: string[]): Promise<ScriptTestOutcome[]> {
    return (await this.call('POST', '/script-tests/run', { script, ...(ids ? { ids } : {}) })).outcomes;
  }

  /** Runs a script once with these inputs, offline on a copy, and says how it ended. */
  /** Test cases the AI writes for a script, each already run once offline on a copy. Nothing is saved. */
  async suggestScriptTests(script: number): Promise<{ cases: SuggestedTest[]; skipped?: string[] }> {
    return this.call('POST', '/script-tests/suggest', { script });
  }

  async recordScriptTest(script: number, given: ScriptTestCase['given']): Promise<ScriptTestEnd> {
    return (await this.call('POST', '/script-tests/record', { script, given })).expect;
  }

  /** Each step's time on this server since it started (null when the script hasn't run here yet). */
  async scriptProfile(script: number): Promise<{ profile: ScriptProfileData | null; recording: boolean }> {
    return this.call('GET', `/scripts/${script}/profile`);
  }

  /** Runs a script once with these inputs, offline on a copy, and says which records and fields it would change (with `text`, as those steps: a draft not saved yet). */
  async dryRunScript(script: number, given: ScriptTestCase['given'], text?: string): Promise<ScriptDryRun> {
    return this.call('POST', `/scripts/${script}/dry-run`, { given, ...(text !== undefined ? { text } : {}) });
  }

  /** Proves `text` does what the script does: runs both offline on a copy and compares (`base`: the editor's unsaved steps, to compare against instead of the saved ones). */
  async compareScriptDraft(script: number, text: string, base?: string): Promise<ScriptComparison> {
    return this.call('POST', `/scripts/${script}/compare`, { text, ...(base !== undefined ? { base } : {}) });
  }

  /** Where a script could be simpler or faster: the saved one (timed when the server has run it), or `text` the editor has open. */
  async refactorHints(script: number, text?: string): Promise<{ hints: RefactorHint[]; timed: boolean }> {
    return text === undefined ? this.call('GET', `/scripts/${script}/refactor`) : this.call('POST', `/scripts/${script}/refactor`, { text });
  }

  /** Runs a script once with these inputs, offline on a copy, and returns each step's time. */
  async profileScriptRun(script: number, given: ScriptTestCase['given']): Promise<{ profile: ScriptProfileData | null; ended: ScriptTestEnd }> {
    return this.call('POST', `/scripts/${script}/profile`, { given });
  }

  /** The script as each save here left it, oldest first. */
  async scriptVersions(script: number): Promise<{ seq: number; at: string; account: string | null; text: string }[]> {
    return (await this.call('GET', `/scripts/${script}/history`)).versions;
  }

  async history(): Promise<HistoryEntry[]> {
    return (await this.call('GET', '/history')).history;
  }

  /** Every save of one layout, oldest first. */
  async layoutHistory(id: number): Promise<HistoryEntry[]> {
    return (await this.call('GET', `/layouts/${id}/history`)).history;
  }

  /** A formula's first error, as FileMaker's Specify Calculation dialog reports it. */
  check(formula: string, context: FormulaContext = {}): Promise<FormulaCheck> {
    return this.call('POST', '/check', { formula, ...context });
  }

  /** A formula's results on the record the person was on (`at`) and the first few others: the live preview under a formula box. */
  preview(formula: string, context: FormulaContext = {}, at: { layout?: string; recordId?: number } = {}): Promise<FormulaPreview> {
    return this.call('POST', '/preview', { formula, ...context, ...at });
  }

  /** A formula's result on no record, from the file's first layout (or `layout`). */
  evaluate(formula: string, layout?: string): Promise<{ value: string; type: string }> {
    return this.call('POST', '/evaluate', { formula, ...(layout ? { layout } : {}) });
  }

  /** The relationship graph in plain English, its problems, and the changes that tidy it (graph-review.ts). */
  graph(): Promise<GraphReview> {
    return this.call('GET', '/graph');
  }

  /** Where a field ("Table::Field"), script, layout, custom function or value list is used. */
  async used(name: string, kind?: string): Promise<Usage[]> {
    const q = new URLSearchParams({ name, ...(kind ? { kind } : {}) });
    return (await this.call('GET', `/used?${q}`)).used.flatMap((u: { usages: Usage[] }) => u.usages);
  }

  /** Validations, value lists, serials and defaults a table's data already follows, each with the change that adds it. */
  suggestRules(table: string): Promise<{ suggestions: RuleSuggestion[]; alsoAlwaysFilled: { table: string; fields: string[] }[] }> {
    return this.call('GET', `/suggest-rules?${new URLSearchParams({ table })}`);
  }

  /** What renaming or deleting a field ("Table::Field"), table, layout, script or value list would break. */
  /** What a script uses (fields, layouts, scripts...), what starts it, and how it reaches outside the solution. */
  scriptDependencies(script: number): Promise<ScriptDependencies> {
    return this.call('GET', `/scripts/${script}/dependencies`);
  }

  impact(kind: string, name: string, change: 'rename' | 'delete'): Promise<ChangeImpact> {
    return this.call('GET', `/impact?${new URLSearchParams({ kind, name, change })}`);
  }

  /** A theme in full: element defaults and every named style. */
  async theme(id: number): Promise<Theme> {
    return (await this.call('GET', `/themes/${id}`)).theme;
  }

  /** Lets go of a deleted table's or field's data for good (every one without an id). */
  emptyDeleted(id?: number): Promise<{ emptied: number; design: Design }> {
    return this.call('DELETE', `/deleted${id === undefined ? '' : `/${id}`}`);
  }

  /** The changes that paste FileMaker's clipboard XML into this file (fields into `table`, steps into `script` at `at`). */
  snippet(xml: string, where: { table?: number; script?: number; at?: number } = {}): Promise<{ changes: Change[]; summary: string[]; notes: string[] }> {
    return this.call('POST', '/snippet', { xml, ...where });
  }

  /** FileMaker's clipboard XML for tables, fields, scripts, steps, custom functions or value lists (by id). */
  copySnippet(pick: { tables?: number[]; fields?: { table: number; ids: number[] }; scripts?: number[]; steps?: { script: number; indexes?: number[]; lines?: [number, number] }; customFunctions?: number[]; valueLists?: number[] }): Promise<{ xml: string; notes: string[] }> {
    return this.call('POST', '/snippet/copy', pick);
  }

  /** Layout objects copied in FileMaker's Layout mode, read for the layout `layout` (its theme's styles); not placed. */
  layoutSnippet(xml: string, layout: number): Promise<{ objects: LayoutObject[]; summary: string[]; notes: string[] }> {
    return this.call('POST', '/snippet', { xml, layout });
  }

  /** Layout objects as FileMaker's Layout mode clipboard XML. */
  copyLayoutObjects(objects: LayoutObject[], layout: number): Promise<{ xml: string; notes: string[] }> {
    return this.call('POST', '/snippet/copy', { objects, layout });
  }

  /** The Database Design Report as XML (FileMaker's FMPReport format). */
  async designReport(): Promise<string> {
    const r = await fetch(`/tabularius/design/v1/databases/${enc(this.db)}/ddr`, { headers: { authorization: `Bearer ${this.token}` } });
    if (!r.ok) {
      const json = await r.json().catch(() => ({}));
      throw new DesignError(json.error?.code ?? -1, json.error?.message ?? httpProblem(r.status));
    }
    return r.text();
  }

  /** The solution's documentation, as a Markdown or HTML file, with an introduction first when given. */
  async docs(format: 'md' | 'html', introduction?: string): Promise<string> {
    const r = await fetch(`/tabularius/design/v1/databases/${enc(this.db)}/docs?format=${format}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(introduction ? { introduction } : {}),
    });
    if (!r.ok) {
      const json = await r.json().catch(() => ({}));
      throw new DesignError(json.error?.code ?? -1, json.error?.message ?? httpProblem(r.status));
    }
    return r.text();
  }

  /**
   * "Explain this file": a handover memo the assistant writes from the design (no memo given; `scripts` adds a write-up
   * of every script), or the given one as a page to download.
   */
  async handover(format: 'md' | 'html', memo?: string, scripts = false): Promise<string> {
    const r = await fetch(`/tabularius/assistant/v1/databases/${enc(this.db)}/handover?format=${format}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(memo ? { memo } : scripts ? { scripts } : {}),
    });
    if (!r.ok) {
      const json = await r.json().catch(() => ({}));
      throw new DesignError(json.error?.code ?? -1, json.error?.message ?? httpProblem(r.status));
    }
    return r.text();
  }

  /** The image library: button icons and pictures. */
  async images(): Promise<LibraryImage[]> {
    return (await this.call('GET', '/images')).images;
  }

  /** Adds an image to the library. */
  addImage(file: { filename: string; mime: string; data: string }): Promise<{ id: number; url: string }> {
    return this.call('POST', '/images', file);
  }

  async report(): Promise<ConversionReport> {
    return (await this.call('GET', '/report')).report;
  }
}

/** Where a formula is evaluated: an occurrence, a table, or a custom function's parameters. */
export interface FormulaContext {
  occurrence?: number;
  table?: number;
  parameters?: string[];
}

export interface FormulaPreview {
  ok: boolean;
  message?: string;
  layout?: string;
  results: { recordId: number; value?: string; error?: string }[];
}

export type FormulaCheck = { ok: true } | { ok: false; code: number; message: string; at?: number };

export interface LibraryImage { id: number; filename: string | null; mime: string; bytes: number; url: string }

export interface Usage { kind: string; where: string; text: string }

/** The server's rule-suggestions.ts suggestion. */
export interface RuleSuggestion { table: string; field: string; kind: string; title: string; evidence: string; changes: Change[] }

/** The server's graph-review.ts answer. */
export interface GraphIssue { rule: string; severity: 'warning' | 'info'; message: string; occurrences: number[]; relationship?: number }
export interface GraphReview { summary: string[]; groups: { anchor: number; occurrences: number[]; anchorBuoy: boolean }[]; issues: GraphIssue[]; arrange: Change[] }

/** The server's change-impact.ts answer. */
export interface ChangeImpact {
  target: { kind: string; name: string };
  change: 'rename' | 'delete';
  uses: { where: string; text: string; breaks: boolean; why: string }[];
  useCount: number;
  privileges: { privilegeSet: string; entry: string; breaks: boolean; why: string }[];
  clients: { surface: string; account: string; calls: number; last: string; via: string }[];
  logDays: number;
  logRead: boolean;
  summary: string[];
}

export interface PendingConflict { seq: number; at: string; account: string | null; what: string }
export interface PendingTextDiff { label: string; before: string; after: string; cut?: number }
export interface PendingChange {
  id: number;
  op: Change;
  by: string | null;
  at: string;
  title: string;
  object: { kind: string; label: string; name: string };
  lines: string[];
  diffs: PendingTextDiff[];
  impact?: { change: 'rename' | 'delete'; summary: string[]; useCount: number; breaking: number };
  status: 'ready' | 'blocked';
  message?: string;
  conflicts: PendingConflict[];
}
export interface PendingReview { changes: PendingChange[]; seq: number }
export interface PendingResult {
  applied: { id: number; title: string }[];
  blocked: { id: number; title: string; message: string }[];
  conflicts: { id: number; title: string; conflicts: PendingConflict[] }[];
  remaining: number;
}
