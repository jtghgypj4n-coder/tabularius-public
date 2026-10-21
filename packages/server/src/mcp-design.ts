// MCP tools for design mode: AI assistants read and change a solution's
// tables, fields, relationships, layouts and scripts, or start a new one.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { callerText } from './fault-log.ts';
import { z } from 'zod';
import type { DesignOp, SnippetPick, Store } from '../../store/src/index.ts';
import { checkStoreFormula, speedPlan, lintLayout, lintScript, fixLayout, storeStats, type LintIssue, designSnippet, isLayoutSnippet, layoutObjectsFromSnippet, layoutSnippet, snippetChanges } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import { designOf, formulaContext, layoutTheme, styleNames } from './design.ts';
import { auditForModel, redactSecrets, redactStep } from './ai-output.ts';
import { recordHistory } from './record-history.ts';
import { dryRunChanges } from './dry-run.ts';
import { applySecurityChanges, securityOf } from './security.ts';
import { aiBlocker } from './ai-access.ts';
import { assertAiSecurityChanges } from './ai-security.ts';
import { assertAiDesignChanges } from './ai-policy.ts';
import { findAdvice } from './find-advice.ts';
import type { Profiler } from './profiler.ts';
import { reviewPrivileges } from './privilege-review.ts';
import { changeImpact } from './change-impact.ts';
import { suggestRules } from './rule-suggestions.ts';
import type { Host } from './host.ts';
import { aiHostedNames } from './ai-access.ts';
import { modernizeChange, STYLES } from './modernize.ts';
import { draftLayoutChange, layoutsBefore, ordersBefore, previewDesign, restyleChange, restyleFileChange, undoChanges } from './design-preview.ts';
import { reviewGraph } from './graph-review.ts';
import { checkSolution } from './check-solution.ts';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] });

function applyAi(store: Store, changes: DesignOp[], readOtherFile?: (file: Store) => boolean): { applied: DesignOp[] } {
  assertAiDesignChanges(store, changes, undefined, readOtherFile);
  return store.applyDesign(changes, { account: 'AI', ...(readOtherFile ? { readOtherFile } : {}) });
}

export const CHANGES = `Design changes, applied in order as one unit (all or none). Name things by name or id. Ops:
- {op:"createTable", name, fields?: [FieldSpec]} also adds a table occurrence and a form layout named after it (withLayout:false to skip)
- {op:"renameTable", table, name} / {op:"deleteTable", table}
- {op:"createField", table, ...FieldSpec} / {op:"updateField", table, field, ...changes} / {op:"deleteField", table, field}
- {op:"createTheme", name, from?: theme to copy, content?: {defaults, styles, contextual?} to import} / {op:"updateTheme", theme, name?, defaults?: {elementType: [StyleRule] | null}} / {op:"deleteTheme", theme}
  (refused while layouts use it). StyleRule: {part: 1 object|2 text|4 icon, state: 1 normal|2 hover|3 pressed|4 focus, css: {property: value}}.
  Element types: 20 layout background, 34 body, 32 header, 38 footer, 61 edit box, 62 pop-up menu, 64 checkbox set, 70 text, 80 button, 83 portal, 51 rectangle...
- {op:"createStyle", theme, name, element, rules?} / {op:"updateStyle", theme, style, element?, name?, rules?} (renaming updates objects using it)
  / {op:"deleteStyle", theme, style, element?} (objects using it get the element's default look). Objects use a style with style.name on their layout.
- Phone layouts (not in FileMaker): {op:"createLayout", name, phoneOf: layout, width?: 390} makes one from a desktop layout (stacked, tap-sized) that follows its changes until edited by hand; {op:"updateLayout", layout, rebuildPhone: true} rebuilds it.
- Layout components (not in FileMaker): {op:"createComponent", name, objects: [LayoutObject]} or {op:"createComponent", name, layout, objectIds: [ids of
  objects on it]} (those objects become its first placed copy there) / {op:"updateComponent", component, name?, objects?} (every placed copy follows) /
  {op:"deleteComponent", component} (copies stay as plain groups). Place one with a group object {kind:"group", type:8, bounds (top left is where it goes),
  component:{id}} in an updateLayout: its children are filled in from the component. Drop "component" from a copy to detach it. get_design lists components.
- {op:"restoreDeleted", deleted: id} brings back a deleted table or field (ids in get_design's "deleted"), with its data and the formulas,
  relationships and occurrences the delete changed
  FieldSpec: {name, type?: text|number|date|time|timestamp|container, kind?: normal|calculation|summary, calculation?: formula,
  calculationContext?: occurrence, comment?, options?: {global?, unstored?, repetitions?, index?: minimal|all (null: none), noAutoIndex?,
  indexLanguage?: English|Unicode_Raw|..., externalStorage?: {directory?: base directory id (0 default), secure?: true, fewerFolders?, path?: formula (open storage)}
  (containers; kept for FileMaker, tabularius keeps the data in the database), autoEnter?: {serial?: {next, increment, onCommit?},
  data?, lastVisited?: true (a new record copies it from the record the window was on), value?: creationTimestamp|modificationAccountName|..., calculation?: true (calculation is an auto-enter calc), replaceExisting?,
  lookup?: {occurrence, field, from?: occurrence of this table, noMatch?: keep|lower|higher|value|empty (lower/higher: the next match value down or up), value?, copyEmpty?} (copy from the first related record
  when the match fields change), prohibitModification?: true (people can't change it, scripts can)},
  validation?: {notEmpty?, unique?, existing?, type?: number|date4|time (strict data type), valueList?: name, range?: {min, max}, maxLength?,
  calculation?, calculationAlways? (check it on every commit, not only when the field changed), message?}}, summary?: {type: total|count|average|..., field}}
- {op:"createOccurrence", name, table | file: data source, externalTable: the table's id in that file} / {op:"updateOccurrence", occurrence, name?, table?, color?} / {op:"deleteOccurrence", occurrence}
- {op:"createRelationship", left, right, predicates: [{left: field, operator?: = ≠ < ≤ > ≥ ×, right: field}]} (left/right are occurrences)
  plus per-side options leftCreate/rightCreate (allow creating records on that side through the relationship; new ones default to true)
  and leftDelete/rightDelete (delete that side's related records when a record on the other side is deleted)
  / {op:"updateRelationship", relationship: id, ...} / {op:"deleteRelationship", relationship: id}
- {op:"createValueList", name, values} or {op:"createValueList", name, field: {occurrence, field, second?: field to show too,
  showSecondOnly?, sortBySecond?, related?: occurrence (only values related to the current record, starting from it)}}
  or {op:"createValueList", name, external: {file: data source, valueList: the list's id in that file}} (a list of another hosted file)
  / updateValueList (valueList; values or field replaces the other) / deleteValueList (valueList)
- {op:"createCustomFunction", name, parameters, formula, language?: "calculation" (default) | "javascript"} / updateCustomFunction /
  deleteCustomFunction (customFunction). A JavaScript function's formula is the body of a JavaScript function of its parameters
  (it returns the answer: a number, text, true/false, or an object/array as JSON text; dates come in as ISO text). It runs in a
  sandbox with no files, network, modules or timers, 1 second and 64 MB per call; use it for what calculations do badly
  (regular expressions, parsing, hashing, number crunching), not for anything needing the file's data beyond its arguments.
- {op:"createCustomMenu", name, installWhen?, items?: [{kind?: command|submenu|separator, command?: name (e.g. "New Record") or id,
  script?, parameter?, submenu?: menu, title?: formula, installWhen?: formula, shortcut?: {key, modifiers?: 1 Shift + 4 Cmd/Ctrl}}]}
  / updateCustomMenu (customMenu; items replaces the list) / deleteCustomMenu (customMenu)
- {op:"createMenuSet", name, menus: [menu, ...] in menu bar order} / updateMenuSet (menuSet) / deleteMenuSet (menuSet)
  / {op:"setDefaultMenuSet", menuSet} (null for FileMaker's standard menus)
  A layout's own menu set: updateLayout with design: {menuSetId} (a set's id, 1 for FileMaker's standard menus, 0 for the file's default).
  Layout Setup: design: {viewsAllowed?: [form, list, table], saveRecordChanges?, fieldFrames?, recordIndicator?} (false turns one off; all on by default),
  printColumns?: {count: 1-99, order?: across|down} (records print side by side in Preview mode and PDFs),
  fixedMargins?: {top, left, bottom, right} in points (Use fixed page margins: they replace the file's page setup margins in Preview mode and PDFs; null clears it).
  Responsive (tabularius only): design: {responsive: {stackBelow: width}} stacks each part in one column in narrower web client windows (a layout without it follows the server's setting, 640 points unless changed; stackBelow 0 never stacks that layout); an object's responsive: {hideBelow: width} hides it there.
- {op:"createDataSource", name, paths: ["file:Name"]} (Manage External Data Sources: a FileMaker file, paths tried in order:
  file:, fmnet:/host/Name, filemac:, filewin:; or one odbc:DSN entry) / updateDataSource (dataSource; name?, paths?) / deleteDataSource
  (refused while occurrences or scripts use it). Nothing connects out: a file reference finds the hosted database of that name.
- {op:"setFileOptions", openLayout?, onFirstWindowOpen?: script, onLastWindowClose?: script, onWindowOpen?: script, onWindowClose?: script} (File Options; null clears one)
- {op:"createContainerDirectory", path} / {op:"updateContainerDirectory", directory: id, path} / {op:"deleteContainerDirectory", directory}
  (Manage Containers base directories, relative to the database's folder; 0 is the default; refused while fields store there)
- {op:"createLayout", name, occurrence, design?} (no design: a generated form) / {op:"updateLayout", layout, name?, occurrence?, design?} / deleteLayout
- {op:"createScript", name, text} / {op:"updateScript", script, name?, text?, limits?: {steps?, seconds?, loopPasses?} | null} / deleteScript.
  limits is Tabularius's runaway guard for that script (whole numbers; null takes it off). text is the script as FileMaker's
  workspace shows it (get_script's text): one step per line, e.g. Set Field [ Table::Field ; formula ], Go to Layout [ “Name” ],
  Perform Script [ “Name” ; Parameter: formula ], If [ test ] ... End If, // disables, # comments. Unchanged lines keep their steps.
  (steps: [{name, params}] also works.)
- {op:"setOrder", list: "layouts"|"scripts", order: [{item: name}, {folder: "Name", children: [...]}, {separator: true}]}: the list's
  order with folders, as Manage Layouts / Manage Scripts show it (layoutOrder / scriptOrder in get_design). Items left out go at the end.
Renaming a field or occurrence rewrites every formula, layout and script that refers to it. Stored calculations are computed for existing records.`;

/**
 * `guard` throws unless the client may see and change a file's design (an
 * account needs [Full Access]); `canCreate` is whether it may start new files; `readOtherFile` is whether it may also
 * design (and AI may read) another hosted file, whose tables a layout or value list here can then use (default: none).
 */
export function registerDesignTools(server: McpServer, host: Host, guard: (s: Store) => void = () => {}, canCreate = true, visible: (s: Store) => boolean = () => true, readOtherFile?: (file: Store) => boolean): void {
  const applyAiDesign = (store: Store, changes: DesignOp[]) => applyAi(store, changes, readOtherFile);
  const withStore = (database: string, fn: (s: Store) => unknown) => {
    const store = host.get(database);
    if (!store) return fail(`No hosted database named "${database}". Hosted: ${aiHostedNames(host, visible)}`);
    try {
      guard(store);
      return json(fn(store));
    } catch (e) {
      return fail(callerText(e));
    }
  };
  const db = z.string().describe('Hosted database name');
  const SECTIONS = ['tables', 'tableOccurrences', 'relationships', 'dataSources', 'containerDirectories', 'containerData', 'fileOptions', 'pageSetup', 'valueLists',
    'customFunctions', 'deleted', 'customMenus', 'customMenuSets', 'defaultMenuSetId', 'menuCommands', 'layouts', 'layoutOrder', 'scripts', 'scriptOrder',
    'themes', 'privilegeSets', 'scriptSteps'] as const;
  /** Above this, get_design without sections lists the sections and their sizes instead. */
  const WHOLE_DESIGN_CHARS = 25_000;

  server.registerTool('get_design', {
    description: 'Design of a database for design work, with ids: tables with every field option, table occurrences, ' +
      'relationships with match fields, File Options (startup layout and scripts), value lists, custom functions, custom menus, ' +
      'layouts, scripts as text. Pick sections; for a large solution, a call without sections lists them with their sizes. ' +
      'Scripts come as text; name scripts to get their steps with decoded options too.',
    inputSchema: {
      database: db,
      sections: z.array(z.enum(SECTIONS)).optional().describe('Default: all, when that is small enough'),
      scripts: z.array(z.string()).max(50).optional().describe('Only these scripts, with their steps\' decoded options'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ database, sections, scripts }) => withStore(database, (s) => {
    const all = designOf(s, host.names()) as Record<string, unknown>;
    // Scripts as text (secrets hidden); steps with their options only for the scripts asked for by name.
    const wanted = scripts?.length ? new Set(scripts.map((x) => x.toLowerCase())) : undefined;
    all.scripts = (all.scripts as { id: number; name: string; steps: unknown[]; text: string }[])
      .filter((x) => !wanted || wanted.has(x.name.toLowerCase()))
      .map((x) => ({ id: x.id, name: x.name, text: redactSecrets(x.text), ...(wanted ? { steps: x.steps.map(redactStep) } : {}) }));
    all.customFunctions = (all.customFunctions as { formula?: string }[]).map((c) => (c.formula ? { ...c, formula: redactSecrets(c.formula) } : c));
    const picked = sections?.length ? sections : wanted ? ['scripts' as const] : undefined;
    if (picked) return Object.fromEntries([['database', s.name], ...picked.map((k) => [k, all[k]])]);
    const sizes = Object.fromEntries(SECTIONS.map((k) => [k, JSON.stringify(all[k] ?? null).length]));
    const total = Object.values(sizes).reduce((a, b) => a + b, 0);
    if (total <= WHOLE_DESIGN_CHARS) return all;
    return {
      database: s.name,
      note: `The whole design is ${total.toLocaleString('en-US')} characters, too much to read at once. Ask for sections (and scripts by name); sizes in characters:`,
      sections: sizes,
    };
  }));

  server.registerTool('get_theme', {
    description: 'A theme in full: element defaults and every named style, each as rules (part, state, css). get_design lists themes and their style names.',
    inputSchema: { database: db, theme: z.union([z.string(), z.number().int()]) },
    annotations: { readOnlyHint: true },
  }, async ({ database, theme }) => withStore(database, (s) => {
    const t = s.designs().themes.find((x) => (typeof theme === 'number' ? x.id === theme : x.name.toLowerCase() === theme.toLowerCase()));
    if (!t) throw new Error(`No theme "${theme}"`);
    return t;
  }));

  server.registerTool('get_layout_design', {
    description: 'A layout\'s design as stored: parts (kind, top, height), objects (kind, bounds in points, field, text, ' +
      'portal, button action, styles, conditions), table view columns. Edit it and send it back with change_design updateLayout.',
    inputSchema: {
      database: db, layout: z.union([z.string(), z.number().int()]),
      compact: z.boolean().default(false).describe('Leave out styles and anchors (for reading what is on a layout; not for editing it back)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ database, layout, compact }) => withStore(database, (s) => {
    const design = s.design(layout);
    if (!design) throw new Error(`No layout "${layout}"`);
    if (!compact) return design;
    const strip = (objects: LayoutObject[]): unknown[] => objects.map(({ style: _style, anchors: _anchors, children, ...o }) => ({ ...o, ...(children?.length ? { children: strip(children) } : {}) }));
    return { ...design, objects: strip(design.objects) };
  }));

  server.registerTool('lint_script', {
    description: 'Check scripts for loops that never end and guards that catch nothing, which FileMaker never warns about: ' +
      'a loop with no way out (Go to Record [ Next ] without “Exit after last”), Exit Loop If [ $count = $i ] when $i starts at 1 and ' +
      'the count can be 0, a loop that omits records and only ends on “Exit after last” in another branch, and IsValid used to ask ' +
      'whether there is a related record. Each issue gives the step, its line, what goes wrong in plain English, a fix, and detail: why ' +
      '(for a count, where it comes from and when it is 0, such as a parameter the script never got). ' +
      'Leave out script to check every script. Nothing runs.',
    inputSchema: { database: db, script: z.union([z.string(), z.number().int()]).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ database, script }) => withStore(database, (s) => {
    const scripts = s.schema.scripts.filter((x) => script === undefined || x.id === script || x.name === script);
    if (script !== undefined && !scripts.length) throw new Error(`No script "${script}"`);
    return { scripts: scripts.map((x) => ({ script: x.name, issues: lintScript(x, s.schema) })).filter((x) => script !== undefined || x.issues.length) };
  }));

  server.registerTool('lint_layout', {
    description: 'Check a layout for what will look or behave wrong in Browse mode: fields showing <Field Missing> or nothing ' +
      '(occurrence not related to the layout\'s), objects outside the layout, clickable objects on top of each other, buttons ' +
      'with no action, enterable fields left out of the tab order, and fields some privilege sets see as <No Access>; ' +
      'rule "slow" is what makes the layout slow to draw (unstored related totals, summaries on every row, portal filters), ' +
      'with cost = estimated record reads per draw from the file\'s record counts. ' +
      'Each issue names the object ids; fix them with change_design updateLayout or edit_layout_objects.',
    inputSchema: { database: db, layout: z.union([z.string(), z.number().int()]) },
    annotations: { readOnlyHint: true },
  }, async ({ database, layout }) => withStore(database, (s) => {
    const design = s.design(layout);
    if (!design) throw new Error(`No layout "${layout}"`);
    return { layout: design.name, issues: lintLayout(design, s.schema, s.privilegeSets(), storeStats(s)) };
  }));

  server.registerTool('check_solution', {
    description: 'Look through the whole solution for what is wrong, without running anything: calculations that do not parse or name a ' +
      'field, function, script, layout or value list that is not there; layout objects and relationships that point at a deleted field; ' +
      'value lists with no source; script steps and plug-in functions this build does not run (error 3, or "?"); privilege sets that name ' +
      'things that are gone or grant nothing; accounts with no privilege set; and, as information only, scripts, value lists and custom ' +
      'functions nothing uses. Each finding has a kind, severity (error, warning, info), where it is, what is wrong and a one-line fix. ' +
      'With account, also what that account cannot reach (a button for a script it may not run, the layout the file opens on). ' +
      'The same check as `tabularius check-solution`. For one script or calculation use check_script, check_calculation and lint_script.',
    inputSchema: { database: db, account: z.string().optional().describe('Also check what this account can reach') },
    annotations: { readOnlyHint: true },
  }, async ({ database, account }) => withStore(database, (s) => checkSolution(s, { account })));

  server.registerTool('fix_layout', {
    description: 'Mend lint_layout\'s mechanical findings on a layout in one change: nearly lined-up edges lined up, clickable objects ' +
      'on top of each other moved apart, objects running past the layout\'s edge moved inside, and the tab order given the fields ' +
      'it skips (in reading order), fields with no label labelled with their name, buttons with no text given a tooltip naming their ' +
      'script, fields and buttons too small to tap on a phone layout grown, and fields a portal sorts on with indexing off given ' +
      'automatic indexing, and summary fields on every row of a list moved into a trailing grand summary. Only findings with fixable: true; the rest need a person. With preview: true nothing is saved.',
    inputSchema: {
      database: db, layout: z.union([z.string(), z.number().int()]),
      only: z.array(z.object({ rule: z.string(), objectIds: z.array(z.number().int()) })).optional().describe('Fix just these findings (from lint_layout); default all fixable ones'),
      preview: z.boolean().default(false).describe('Say what would be fixed, without saving'),
    },
    annotations: { destructiveHint: true },
  }, async ({ database, layout, only, preview }) => withStore(database, (s) => {
    const current = s.design(layout);
    if (!current) throw new Error(`No layout "${layout}"`);
    const { design, fixed, changes } = fixLayout(current, s.schema, s.privilegeSets(), only as Pick<LintIssue, 'rule' | 'objectIds'>[] | undefined);
    if (!preview && fixed.length) applyAiDesign(s, [...changes, { op: 'updateLayout', layout: current.id, design: { objects: design.objects, tabOrder: design.tabOrder, parts: design.parts } } as unknown as DesignOp]);
    // A preview hasn't changed the fields yet: what's left is linted against the schema as it would be.
    const schema = preview && changes.length ? s.checkDesign(changes).schema : s.schema;
    return { layout: current.name, fixed: fixed.map((i) => i.message), saved: !preview && fixed.length > 0, remaining: lintLayout(design, schema, s.privilegeSets(), storeStats(s)) };
  }));

  server.registerTool('speed_up_layout', {
    description: 'Make a slow layout faster (FileMaker has no such tool): for each of lint_layout\'s "slow" findings, a redesign ' +
      'that removes the work where there is a mechanical one: a summary field on every row moved into a trailing grand summary, ' +
      'an unstored calculation or related summary on every row shown from a new stored calculation (which can fall behind related ' +
      'records; the caveat says so). Each move has the layout\'s estimated record reads per draw before and after. Portal filters ' +
      'and formulas come back in left: redesign those yourself with change_design (a relationship that matches the records ' +
      'instead of a filter). With apply: [move indexes] those moves are saved as one change and undo is returned; otherwise nothing is saved.',
    inputSchema: {
      database: db, layout: z.union([z.string(), z.number().int()]),
      apply: z.array(z.number().int()).optional().describe('Indexes into moves to save'),
    },
    annotations: { destructiveHint: true },
  }, async ({ database, layout, apply }) => withStore(database, (s) => {
    const plan = speedPlan(s, layout);
    const summary = {
      layout: plan.layout.name, before: plan.before,
      moves: plan.moves.map((m, i) => ({ index: i, kind: m.kind, objectIds: m.objectIds, title: m.title, ...(m.caveat ? { caveat: m.caveat } : {}), after: m.after })),
      left: plan.left.map((i) => ({ kind: i.kind, objectIds: i.objectIds, message: i.message, cost: i.cost })),
    };
    if (!apply?.length) return { ...summary, saved: false };
    const picked = [...new Set(apply)].map((i) => plan.moves[i]);
    if (picked.some((m) => !m)) throw new Error(`apply takes indexes 0 to ${plan.moves.length - 1}`);
    // One move at a time, each worked out again on the layout as the ones before left it, so they don't undo each other.
    const undo: (DesignOp[] | undefined)[] = [];
    const applied: number[] = [], skipped: number[] = [];
    let error: string | undefined;
    for (const [n, want] of picked.entries()) {
      const index = [...new Set(apply)][n];
      const move = speedPlan(s, plan.layout.id).moves.find((m) => m.kind === want.kind && m.objectIds[0] === want.objectIds[0]);
      // A move an earlier one made unnecessary (or impossible) is reported, not dropped quietly.
      if (!move) {
        skipped.push(index);
        continue;
      }
      try {
        const before = layoutsBefore(s, move.changes);
        const { applied: done } = applyAiDesign(s, move.changes);
        undo.unshift(undoChanges(done, before));
        applied.push(index);
      } catch (e) {
        // Stop here; the moves already saved stay saved, with their undo.
        error = `Move ${index} wasn't saved: ${callerText(e)}`;
        break;
      }
    }
    // Undo takes back the last move first; when one of them can't be undone, there is no undo.
    return {
      ...summary, saved: applied.length > 0, applied, ...(skipped.length ? { skipped } : {}), ...(error ? { error } : {}),
      after: speedPlan(s, plan.layout.id).before, ...(applied.length && undo.every((u) => u) ? { undo: undo.flat() } : {}),
    };
  }));

  server.registerTool('review_graph', {
    description: 'Look over the relationship graph: a plain-English account of its groups (and whether it follows anchor-buoy), ' +
      'and the problems worth a look: occurrences nothing uses, relationships that repeat another in the same group, match fields ' +
      'that can\'t be indexed (globals, unstored calculations, summaries, containers) or have indexing off, and missing tables or ' +
      'fields. Each issue names occurrence ids (and a relationship id). Use it to explain the graph to a person or to propose fixes.',
    inputSchema: { database: db },
    annotations: { readOnlyHint: true },
  }, async ({ database }) => withStore(database, (s) => {
    const { summary, groups, issues, arrange } = reviewGraph(s);
    return { summary, groups, issues, boxesToTidy: arrange.length };
  }));

  server.registerTool('arrange_graph', {
    description: 'Tidy the relationship graph\'s boxes in one change: each group laid out from its anchor (the occurrence layouts ' +
      'are based on) in columns to the right, groups stacked top to bottom, lone occurrences in a grid at the end. Only positions ' +
      'change. With preview: true nothing is saved.',
    inputSchema: { database: db, preview: z.boolean().default(false).describe('Say how many boxes would move, without saving') },
    annotations: { destructiveHint: true },
  }, async ({ database, preview }) => withStore(database, (s) => {
    const { arrange } = reviewGraph(s);
    if (!preview && arrange.length) applyAiDesign(s, arrange);
    return { moved: arrange.length, saved: !preview && arrange.length > 0 };
  }));

  server.registerTool('restyle_layout', {
    description: 'Restyle a layout: make it look like another layout (its theme, and each kind of object\'s most common style and ' +
      'formatting, part by part), switch it to a theme, and/or apply the theme consistently (drop local formatting so every object ' +
      'shows its theme style). Only looks change: nothing moves. With preview: true (the default) nothing is saved; it says what ' +
      'would change and what Check finds on the result. Undo is returned when saved.',
    inputSchema: {
      database: db, layout: z.union([z.string(), z.number().int()]),
      like: z.union([z.string(), z.number().int()]).optional().describe('The layout to take the look from'),
      theme: z.union([z.string(), z.number().int()]).optional().describe('A theme to switch to, by name or id'),
      consistent: z.boolean().optional().describe('Drop local formatting so objects show their theme styles'),
      preview: z.boolean().default(true),
    },
    annotations: { destructiveHint: true },
  }, async ({ database, layout, like, theme, consistent, preview }) => withStore(database, (s) => {
    const { change, notes, layout: name } = restyleChange(s, { layout, like, theme, consistent });
    const checked = previewDesign(s, [change]).layouts?.flatMap((l) => l.issues.filter((i) => i.severity !== 'info').map((i) => i.message)) ?? [];
    if (preview) return { layout: name, notes, check: checked, saved: false };
    const before = layoutsBefore(s, [change]);
    const { applied } = applyAiDesign(s, [change]);
    return { layout: name, notes, check: checked, saved: true, undo: undoChanges(applied, before) };
  }));

  server.registerTool('restyle_file', {
    description: 'Restyle every layout in a file at once (FileMaker restyles one layout at a time): onto an existing theme, or onto ' +
      'a new theme made from a few design tokens (accent, accentText, text, muted, background, panel, line: #rrggbb colours; font; ' +
      'size and radius in points; tabularius\'s own look for any left out). consistent also drops local formatting. layouts limits it ' +
      'to those ids. Phone layouts that follow their desktop layout stay in step. With preview: true (the default) nothing is saved; ' +
      'it says what would change on each layout. Undo is returned when saved.',
    inputSchema: {
      database: db,
      theme: z.union([z.string(), z.number().int()]).optional().describe('An existing theme, by name or id'),
      tokens: z.object({
        accent: z.string(), accentText: z.string(), text: z.string(), muted: z.string(), background: z.string(), panel: z.string(),
        line: z.string(), font: z.string(), size: z.number(), radius: z.number(),
      }).partial().optional().describe('A new theme from these tokens (instead of theme)'),
      name: z.string().optional().describe('The new theme\'s name (default House)'),
      consistent: z.boolean().optional(), layouts: z.array(z.number().int()).optional(),
      preview: z.boolean().default(true),
    },
    annotations: { destructiveHint: true },
  }, async ({ database, preview, ...req }) => withStore(database, (s) => {
    const r = restyleFileChange(s, req);
    const summary = {
      theme: r.theme,
      layouts: r.layouts.map((l) => ({ name: l.name, notes: l.notes, check: l.issues })),
      unchanged: r.unchanged.map((u) => `${u.name}: ${u.why}`),
    };
    if (preview) return { ...summary, saved: false };
    const before = layoutsBefore(s, r.changes);
    const { applied } = applyAiDesign(s, r.changes);
    return { ...summary, saved: true, undo: undoChanges(applied, before) };
  }));

  server.registerTool('modernize_interfaces', {
    description: 'Make new layouts for a file\'s tables from ready-made templates, with no AI: for each table a modern list, a modern detail ' +
      '(one record with Previous and Next), a modern list and detail side by side (HTML, CSS and JavaScript pages that search, sort, edit, add and ' +
      'delete records as the signed-in account and show related records), and a classic FileMaker list and form drafted the way the file\'s own layouts ' +
      'look. Columns and controls come from the fields\' types and names; join tables of only keys get none. The file\'s own layouts are never ' +
      'changed, and a layout that is already there is left alone. tables and styles (modern-list, modern-detail, modern-split, classic-list, ' +
      'classic-form; and, only when asked for, modern-board: cards in columns by a status field, and modern-calendar: records on a month by a date field) narrow it; fromLayouts: true also makes a modern list and detail for each of the file\'s own layouts, with the fields that layout shows in its order; the new layouts go in a "Modernized interfaces" folder unless folder is false. With preview: true (the default) ' +
      'nothing is saved; it returns the layouts, the tables skipped and why, and the changes. Undo is returned when saved.',
    inputSchema: {
      database: db, tables: z.array(z.string()).max(500).optional(), styles: z.array(z.enum(STYLES)).optional(), folder: z.boolean().optional(), fromLayouts: z.boolean().optional(),
      preview: z.boolean().default(true),
    },
    annotations: { destructiveHint: true },
  }, async ({ database, preview, ...req }) => withStore(database, (s) => {
    const r = modernizeChange(s, req);
    const summary = { layouts: r.layouts, skipped: r.skipped };
    if (preview) return { ...summary, saved: false };
    const orders = ordersBefore(s, r.changes);
    const { applied } = applyAiDesign(s, r.changes);
    return { ...summary, saved: true, undo: undoChanges(applied, undefined, orders) };
  }));

  server.registerTool('draft_layout', {
    description: 'Draft a new layout that looks like the file\'s own: the theme most of its layouts use (or like: another layout\'s), ' +
      'fields, labels, title and parts styled as they most often are there, and the components the file keeps in its headers and ' +
      'footers placed where they usually sit. totals: number fields to total in a grand summary (summary fields are added) or ' +
      'existing summary fields (list view). A layout keeps no find, so find ({field: criterion}, omit) and sort add a "Show <layout>" ' +
      'script that goes to it and finds those records. portals (form view): related records as a portal ({occurrence, fields, rows, ' +
      'totals: columns to total under it, as Sum calculations}). A report: groups (sub-summaries; a date by month, quarter or ' +
      'year), summaryOnly, and chart (one point per group); the script sorts by the groups. arrangement: when copying a picture of a ' +
      'layout (a screenshot, a sketch), where it shows each thing, in points from its part\'s top left, with the file\'s real fields; ' +
      'it replaces fields, totals and portals. Check\'s mechanical fixes are applied to the draft. ' +
      'With preview: true (the default) nothing is saved; it returns the changes, ' +
      'how the draft matches the file and what Check finds on it. Undo is returned when saved.',
    inputSchema: {
      database: db, name: z.string().min(1), occurrence: z.union([z.string(), z.number().int()]),
      view: z.enum(['list', 'form']).default('list'),
      fields: z.array(z.string()).optional(), totals: z.array(z.string()).optional(),
      like: z.union([z.string(), z.number().int()]).optional().describe('The layout to take the look from'),
      find: z.record(z.string(), z.string()).optional().describe('Field name to find criterion'),
      omit: z.boolean().optional(), sort: z.array(z.string()).optional(),
      portals: z.array(z.object({
        occurrence: z.union([z.string(), z.number().int()]), fields: z.array(z.string()).optional(),
        rows: z.number().int().min(1).max(50).optional(), totals: z.array(z.string()).optional(),
      })).optional().describe('Form only: portals of related records'),
      arrangement: z.object({
        width: z.number(),
        parts: z.array(z.object({ kind: z.enum(['header', 'body', 'trailing-grand-summary', 'footer']), height: z.number() })),
        objects: z.array(z.object({
          kind: z.enum(['field', 'label', 'title', 'button', 'portal', 'rectangle', 'line']), part: z.number().int().min(0),
          left: z.number(), top: z.number(), width: z.number(), height: z.number(),
          field: z.string().optional().describe('"Field", or "Occurrence::Field" of a related occurrence'), text: z.string().optional(),
          portal: z.object({ occurrence: z.string(), fields: z.array(z.string()).max(20), rows: z.number().int().min(1).max(50).optional() }).optional(),
        })).max(300),
      }).optional().describe('From a picture: the layout as it shows it'),
      groups: z.array(z.union([z.string(), z.object({ field: z.string(), by: z.enum(['month', 'quarter', 'year']) })])).optional()
        .describe('List only, a report: fields to group by in sub-summaries, outermost first; a date by month, quarter or year'),
      summaryOnly: z.boolean().optional().describe('Only the groups\' totals, no row per record'),
      chart: z.object({ type: z.enum(['column', 'bar', 'line', 'area', 'pie']).default('column'), value: z.string(), by: z.string().optional(), title: z.string().optional() }).optional()
        .describe('A chart of the found set at the top, one point per group; value is a number field to total or a summary field'),
      preview: z.boolean().default(true),
    },
    annotations: { destructiveHint: true },
  }, async ({ database, preview, ...req }) => withStore(database, (s) => {
    const { changes, notes, layout } = draftLayoutChange(s, req);
    const check = previewDesign(s, changes).layouts?.flatMap((l) => l.issues.filter((i) => i.severity !== 'info').map((i) => i.message)) ?? [];
    if (preview) return { layout, notes, check, changes, saved: false };
    const { applied } = applyAiDesign(s, changes);
    return { layout, notes, check, saved: true, undo: undoChanges(applied) };
  }));

  server.registerTool('change_design', {
    description: 'Change a database\'s design: create, rename, change or delete tables, fields, table occurrences, ' +
      'relationships, value lists, custom functions, layouts and scripts. Returns the changes as applied (with ids), and, when ' +
      'they only add things, `undo`: the changes that take them back. With preview: true nothing changes; it returns what the ' +
      'changes would do, one line each, to show the person first.',
    inputSchema: {
      database: db, changes: z.array(z.record(z.string(), z.unknown())).min(1).describe(CHANGES),
      preview: z.boolean().default(false).describe('Describe what the changes would do, without making them'),
    },
    annotations: { destructiveHint: true },
  }, async ({ database, changes, preview }) => withStore(database, (s) => {
    if (preview) {
      // Layouts as words and Check's findings; the designs themselves are for drawing pictures.
      const { lines, layouts } = previewDesign(s, changes as unknown as DesignOp[], { readOtherFile });
      return { lines, ...(layouts ? { layouts: layouts.map((l) => ({ name: l.name, issues: l.issues.map((i) => `${i.severity}: ${i.message}`) })) } : {}) };
    }
    const before = layoutsBefore(s, changes as unknown as DesignOp[]);
    const orders = ordersBefore(s, changes as unknown as DesignOp[]);
    const { applied } = applyAiDesign(s, changes as unknown as DesignOp[]);
    const undo = undoChanges(applied, before, orders);
    return { applied, ...(undo ? { undo } : {}) };
  }));

  server.registerTool('check_formula', {
    description: 'Check a calculation formula before using it in change_design, as FileMaker\'s Specify Calculation dialog does: ' +
      'syntax, field and table occurrence names, function names and parameter counts. Returns {ok:true} or the first error with its offset.',
    inputSchema: {
      database: db,
      formula: z.string(),
      occurrence: z.string().optional().describe('Table occurrence it is evaluated from (unqualified names are its fields)'),
      table: z.string().optional().describe('Or a base table: its first occurrence'),
      customFunction: z.string().optional().describe('Or the custom function whose body this is (its parameters are known names)'),
      parameters: z.array(z.string()).optional().describe('A new custom function\'s parameters'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ database, formula, ...ctx }) => withStore(database, (s) => checkStoreFormula(s, formula, formulaContext(s, ctx))));

  server.registerTool('design_history', {
    description: 'Design changes made to a database in Tabularius (by people, scripts or AI), oldest first.',
    inputSchema: { database: db, limit: z.number().int().min(1).max(1000).default(100) },
    annotations: { readOnlyHint: true },
  }, async ({ database, limit }) => withStore(database, (s) => s.designHistory(limit)));

  server.registerTool('audit_log', {
    description: 'Who created, changed and deleted which records of a database, and when, oldest first. ' +
      'Edits list each field\'s old and new value; deletes list the values the record had. Each entry says where the change came from (surface) ' +
      'and the script that made it. Fields named like passwords or keys, and any an administrator excluded, show ‹not logged› instead of a value.',
    inputSchema: {
      database: db,
      table: z.string().optional().describe('Base table name'),
      recordId: z.number().int().optional(),
      account: z.string().optional(),
      surface: z.string().optional().describe('Where the change came from: web, rest (Data API), odata, sql, mcp, admin, automation, hook, cleanup, agent, assistant, import, sync'),
      script: z.string().optional().describe('Changes a script of this name made'),
      since: z.string().optional().describe('ISO date or time'),
      limit: z.number().int().min(1).max(1000).default(100),
    },
    annotations: { readOnlyHint: true },
  }, async ({ database, ...filter }) => withStore(database, (s) => auditForModel(s.auditLog(filter))));

  server.registerTool('explain_record_history', {
    description: 'What changed on one record and why, newest first: changes made together are one event (who, when, each field ' +
      'from and to), each change says how it came about where the design shows it (worked out by an auto-enter calculation from ' +
      'another field changed then, stamped with the modification time or account, looked up from a related record), which ' +
      'automation or data cleanup made it, and what else the same account changed in other tables at that moment. Works for ' +
      'deleted records too. Use it for "who changed this", "why did Status change", "what happened to this record".',
    inputSchema: {
      database: db,
      table: z.string().describe('Base table name (or pass layout instead)').optional(),
      layout: z.string().optional().describe('A layout on the record\'s table'),
      recordId: z.number().int(),
      limit: z.number().int().min(1).max(2000).optional().describe('Audit entries to read, newest (default 200)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ database, table, layout, recordId, limit }) => withStore(database, (s) => {
    const t = table ?? (layout ? s.layout(layout).table : undefined);
    if (!t) throw new Error('Name the table or a layout on it');
    return recordHistory(s, t, recordId, { limit });
  }));

  server.registerTool('suggest_indexes', {
    description: 'Slow finds on this server and what would speed them up: each kind of find (table, fields searched, sort) that ' +
      'took 50 ms or more on average since the server started, with its timings, an index to add where a stored field has none ' +
      '(with why), and plain-English hints where no index helps (unstored calculations, criteria starting with *). Read-only: ' +
      'an index is added from the admin console\'s Slow finds list.',
    inputSchema: { database: db },
    annotations: { readOnlyHint: true },
  }, async ({ database }) => withStore(database, (s) => {
    const p = host.profiler as Partial<Profiler> | undefined;
    if (!p?.findReport) return { finds: [], note: 'Finds are not being timed on this server.' };
    const finds = findAdvice((n) => host.get(n), p.findReport(200), { file: s.name });
    return { finds, note: finds.length ? 'Slowest in total first.' : 'No slow finds since the server started.' };
  }));

  server.registerTool('get_security', {
    description: 'Accounts and privilege sets, as Manage Security shows them: each account\'s privilege set, whether it has a password ' +
      '(blankPassword: still the file\'s empty one), a second factor, is external or inactive; each privilege set\'s record, layout, ' +
      'value list and script access and extended privileges; the password policy; and API tokens (without their secrets). ' +
      'importApproximations lists sets imported from the FileMaker file whose access here only approximates FileMaker\'s (more or ' +
      'less, as each note says; editedSince: changed here since, so the notes may no longer hold): mention it when saying who can ' +
      'see what. Never passwords.',
    inputSchema: { database: db },
    annotations: { readOnlyHint: true },
  }, async ({ database }) => withStore(database, (s) => {
    const { accounts, privilegeSets, importApproximations, passwordPolicy, minPasswordLength, apiTokens } = securityOf(s);
    return { database: s.name, accounts, privilegeSets, importApproximations, passwordPolicy, minPasswordLength, apiTokens: apiTokens.map(({ id: _, ...t }) => t) };
  }));

  server.registerTool('review_privileges', {
    description: 'A privilege audit in plain English: risky setups among the accounts and privilege sets, worst first, each as a ' +
      'sentence with where it is and what to do: full-access accounts with no password or only a password, guest access, ' +
      'extended privileges (Data API, OData, ODBC, ...) switched on that no recent sign-in uses, record-level limits that are ' +
      'true for every record, and unstored calculations a limited set can see that read records it can\'t view. Plus the ' +
      'security health counts (dormant accounts, broad API tokens, sets that over-share). Read-only; never passwords or record values.',
    inputSchema: { database: db, unusedDays: z.number().int().min(1).max(3650).optional().describe('Days without a sign-in that count as unused (default 90)') },
    annotations: { readOnlyHint: true },
  }, async ({ database, unusedDays }) => withStore(database, (s) => {
    const review = reviewPrivileges(s, { unusedDays });
    const h = s.securityHealth({ unusedDays });
    return {
      ...review,
      health: {
        fullAccessAccounts: h.fullAccess.accounts, without2fa: h.without2fa, dormant: h.unused.map((u) => u.account),
        broadTokens: h.broadTokens.map((t) => ({ label: t.label, account: t.account, reasons: t.reasons })), oversharingSets: h.oversharingSets,
        orphanedAccessKeys: h.orphanedAccessKeys,
      },
    };
  }));

  server.registerTool('check_change_impact', {
    description: 'Before renaming or deleting a field, table, layout, value list or script: everything that uses it and whether ' +
      'each use breaks. Calculations, scripts, layouts, relationships and value lists in the file (references by id follow a ' +
      'rename; names inside quotes, as in GetField, ExecuteSQL, Evaluate or steps "by name", do not), privilege set entries and ' +
      'record limits that name it (kept by name, so a rename leaves them behind), other hosted files that reach into it ' +
      '(their occurrences, relationships, script calls and value lists, by id: a rename follows, a delete breaks), and Data ' +
      'API clients seen in the server log calling it in the last 30 days. Returns plain sentences first. Read-only.',
    inputSchema: {
      database: db,
      kind: z.enum(['field', 'table', 'layout', 'script', 'valueList']),
      name: z.string().describe('The name; a field as Table::Field'),
      change: z.enum(['rename', 'delete']).optional().describe('Default rename'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ database, kind, name, change }) => {
    const store = host.get(database);
    if (!store) return fail(`No hosted database named "${database}". Hosted: ${aiHostedNames(host, visible)}`);
    try {
      guard(store);
      // Other files are checked too, but a file with AI off (or one that uses it) is only counted, never named.
      const otherStores = host.openStores().filter((s) => s !== store);
      const others = otherStores.filter((s) => !aiBlocker(s));
      const hiddenOthers = otherStores.filter((s) => aiBlocker(s));
      return json(await changeImpact(store, host.logs, kind, name, change ?? 'rename', { others, hiddenOthers }));
    } catch (e) {
      return fail(callerText(e));
    }
  });

  server.registerTool('suggest_rules', {
    description: 'Rules a table\'s data already follows, as field options to add: a text field that only ever holds a handful ' +
      'of values (a value list to check entries against; spellings that differ only in case are named), an id-like field ' +
      'that is different on every record (unique, required), a name or key field always filled in (required), a text ' +
      'field holding only numbers, a number counting up with each record (serial), a value nearly every record has (a ' +
      'default). Each has the design changes that add it (propose them with propose_design_change or apply with ' +
      'change_design, one at a time, after the developer agrees). Read-only; skips fields named like secrets and ' +
      'housekeeping fields (creation/modification stamps, cached copies, globals).',
    inputSchema: { database: db, table: z.string().optional().describe('One table; default every table') },
    annotations: { readOnlyHint: true },
  }, async ({ database, table }) => withStore(database, (s) => suggestRules(s, { ...(table ? { table } : {}) })));

  server.registerTool('edit_layout_objects', {
    description: 'Change some of a layout\'s objects without sending its whole design (get_layout_design gives object ids): set ' +
      'properties of objects by id (bounds, text, field, style, conditions, button action, an object\'s own script triggers...), ' +
      'add objects, remove objects, and replace the layout\'s own script triggers (OnRecordLoad, OnLayoutEnter, ...). ' +
      'Applied as one change: all or none.',
    inputSchema: {
      database: db,
      layout: z.union([z.string(), z.number().int()]),
      set: z.array(z.object({ object: z.number().int(), changes: z.record(z.string(), z.unknown()) })).optional()
        .describe('Properties to change on existing objects; nested objects (in portals, tabs, groups) are found by id too'),
      add: z.array(z.record(z.string(), z.unknown())).optional()
        .describe('New objects, shaped like get_layout_design\'s (kind, bounds {top,left,bottom,right}, ...); parent: id of a portal, tab panel or group to put one in'),
      remove: z.array(z.number().int()).optional().describe('Ids of objects to delete (with what they contain)'),
      triggers: z.array(z.object({ event: z.string(), script: z.union([z.string(), z.number().int()]), parameter: z.string().optional() })).optional()
        .describe('The layout\'s triggers, replacing the current ones ([] removes them all)'),
    },
    annotations: { destructiveHint: true },
  }, async ({ database, layout, set, add, remove, triggers }) => withStore(database, (s) => {
    const current = s.design(layout);
    if (!current) throw new Error(`No layout "${layout}"`);
    const objects = structuredClone(current.objects) as LayoutObject[];
    const all: LayoutObject[] = [];
    const walk = (list: LayoutObject[]) => list.forEach((o) => (all.push(o), walk(o.children ?? [])));
    walk(objects);
    const byId = (id: number) => {
      const o = all.find((x) => x.id === id);
      if (!o) throw new Error(`Layout "${current.name}" has no object ${id}`);
      return o;
    };
    for (const { object, changes } of set ?? []) {
      const { id: _, children: __, ...rest } = changes as Record<string, unknown>;
      Object.assign(byId(object), rest);
    }
    let next = Math.max(0, ...all.map((o) => o.id)) + 1;
    for (const spec of add ?? []) {
      const { parent, ...o } = spec as Record<string, unknown> & { parent?: number };
      if (typeof o.kind !== 'string' || typeof o.bounds !== 'object') throw new Error('A new object needs kind and bounds {top, left, bottom, right}');
      const obj = {
        type: 0, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, ...o,
        id: typeof o.id === 'number' && !all.some((x) => x.id === o.id) ? o.id : next++,
      } as unknown as LayoutObject;
      if (parent !== undefined) (byId(parent).children ??= []).push(obj);
      else objects.push(obj);
      all.push(obj);
    }
    const gone = new Set(remove ?? []);
    for (const id of gone) byId(id);
    const prune = (list: LayoutObject[]): LayoutObject[] => list.filter((o) => !gone.has(o.id)).map((o) => (o.children ? { ...o, children: prune(o.children) } : o));
    const design: Record<string, unknown> = { objects: prune(objects) };
    if (triggers) {
      design.triggers = triggers.map((t) => {
        const script = s.schema.scripts.find((x) => (typeof t.script === 'number' ? x.id === t.script : x.name.toLowerCase() === t.script.toLowerCase()));
        if (!script) throw new Error(`No script "${t.script}"`);
        return { event: t.event, scriptId: script.id, script: script.name, ...(t.parameter !== undefined ? { parameter: t.parameter } : {}) };
      });
    }
    applyAiDesign(s, [{ op: 'updateLayout', layout: current.id, design } as unknown as DesignOp]);
    const after = s.design(current.id)!;
    return { layout: after.name, objects: after.objects.length, ...(after.triggers ? { triggers: after.triggers } : {}) };
  }));

  server.registerTool('try_design_change', {
    description: 'Try design changes (change_design\'s) on a throwaway copy of the file, then run scripts there once, offline ' +
      '(no network, mail or plug-ins), and report how each run went: steps, the last error and where. Nothing changes in ' +
      'the real file. By default the scripts the changes create or rewrite are run.',
    inputSchema: {
      database: db,
      changes: z.array(z.record(z.string(), z.unknown())).describe(CHANGES),
      scripts: z.array(z.string()).max(5).optional().describe('Scripts to run on the copy (default: those the changes write, up to 5)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ database, changes, scripts }) => {
    const store = host.get(database);
    if (!store) return fail(`No hosted database named "${database}". Hosted: ${aiHostedNames(host, visible)}`);
    try {
      guard(store);
      store.checkDesign(changes as unknown as DesignOp[], { readOtherFile });
      const names = scripts?.length ? scripts : changes.flatMap((c) => {
        if (c.text === undefined && c.steps === undefined) return [];
        if (c.op === 'createScript' && typeof c.name === 'string') return [c.name];
        if (c.op !== 'updateScript') return [];
        if (typeof c.name === 'string') return [c.name];
        const found = store.schema.scripts.find((x) => x.id === c.script || x.name === c.script);
        return found ? [found.name] : [];
      }).slice(0, 5);
      return json({ applies: true, runs: await dryRunChanges(store, changes, names, undefined, { readOtherFile }) });
    } catch (e) {
      return fail(callerText(e));
    }
  });

  server.registerTool('paste_from_filemaker', {
    description: 'Read what was copied in FileMaker Pro (clipboard XML: tables, fields, scripts, script steps, custom functions, ' +
      'value lists, or layout objects) and return it as Tabularius changes, not applied: change_design applies design changes; ' +
      'layout objects go in with edit_layout_objects add. Comes with notes on anything that did not carry over.',
    inputSchema: {
      database: db,
      xml: z.string().describe('The <fmxmlsnippet> XML'),
      table: z.union([z.string(), z.number().int()]).optional().describe('Table to paste fields into'),
      script: z.union([z.string(), z.number().int()]).optional().describe('Script to paste steps into'),
      at: z.number().int().optional().describe('Step index to insert pasted steps at (default the end)'),
      layout: z.union([z.string(), z.number().int()]).optional().describe('Layout that layout objects go on (its theme names the styles)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ database, xml, table, script, at, layout }) => withStore(database, (s) => {
    if (isLayoutSnippet(xml)) {
      const id = layout === undefined ? undefined : s.design(layout)?.id;
      const theme = layoutTheme(s, id);
      return layoutObjectsFromSnippet(xml, s.schema, { theme, styleNames: styleNames(s, theme?.id) });
    }
    return snippetChanges(xml, s.schema, { table, script, at });
  }));

  server.registerTool('copy_for_filemaker', {
    description: 'FileMaker Pro clipboard XML for design items, to paste into a FileMaker file: tables, fields, scripts, custom ' +
      'functions and value lists by id (get_design), or a layout\'s objects by id.',
    inputSchema: {
      database: db,
      tables: z.array(z.number().int()).max(500).optional(),
      fields: z.object({ table: z.number().int(), ids: z.array(z.number().int()) }).optional(),
      scripts: z.array(z.number().int()).optional(),
      customFunctions: z.array(z.number().int()).optional(),
      valueLists: z.array(z.number().int()).optional(),
      layout: z.union([z.string(), z.number().int()]).optional(),
      objects: z.array(z.number().int()).optional().describe('Object ids on layout'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ database, layout, objects, ...pick }) => withStore(database, (s) => {
    if (!objects) return designSnippet(s.schema, pick as SnippetPick);
    const design = layout === undefined ? undefined : s.design(layout);
    if (!design) throw new Error('Name the layout the objects are on');
    const want = new Set(objects);
    const found: LayoutObject[] = [];
    const walk = (list: LayoutObject[]) => list.forEach((o) => (want.has(o.id) ? found.push(o) : walk(o.children ?? [])));
    walk(design.objects);
    return layoutSnippet(found, s.schema, { theme: layoutTheme(s, design.id) });
  }));

  server.registerTool('list_images', {
    description: 'The file\'s image library (button icons and pictures): id, file name, type and size.',
    inputSchema: { database: db },
    annotations: { readOnlyHint: true },
  }, async ({ database }) => withStore(database, (s) => s.images()));

  server.registerTool('add_image', {
    description: 'Add an image to the file\'s library, for buttons and pictures on layouts. Returns its id.',
    inputSchema: { database: db, filename: z.string().max(255), mime: z.string().regex(/^image\//), data: z.string().describe('The image, base64') },
    annotations: { destructiveHint: false },
  }, async ({ database, filename, mime, data }) => withStore(database, (s) => {
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Images are limited to 20 MB');
    return { id: s.addImage(filename, mime, bytes, { account: 'AI' }) };
  }));

  server.registerTool('change_security', {
    description: 'Change accounts and privilege sets, as Manage Security does, all or none. Ops: {op:"setAccount", name, ' +
      'privilegeSet?, mustChange?} (creates or changes an account; passwords are never set here: people set their own, or the ' +
      'administrator uses tabularius passwd), {op:"setExternalAccount", name: group, privilegeSet}, {op:"deleteAccount", name}, ' +
      '{op:"savePrivilegeSet", set: a privilege set as get_security shows it}, {op:"deletePrivilegeSet", name}, ' +
      '{op:"setPasswordPolicy", policy} (it may keep or raise the minimum password length, never lower it), {op:"disableTotp", account}, {op:"createExtendedPrivilege", name} / ' +
      '{op:"updateExtendedPrivilege", extendedPrivilege: name or id, name} / {op:"deleteExtendedPrivilege", extendedPrivilege} ' +
      '(a custom "way in" a privilege set can grant, Manage Security\'s Extended Privileges tab). API tokens are managed in Manage Security. Returns the result as get_security does.',
    inputSchema: { database: db, changes: z.array(z.record(z.string(), z.unknown())).min(1) },
    annotations: { destructiveHint: true },
  }, async ({ database, changes }) => withStore(database, (s) => {
    assertAiSecurityChanges(s, changes);
    if (changes.some((c) => 'password' in c)) throw new Error('Passwords are not set through AI tools: the account holder sets it, or the administrator uses tabularius passwd');
    if (changes.some((c) => c.op === 'revokeApiToken')) throw new Error('API tokens are managed in Manage Security, not through AI tools');
    applySecurityChanges(s, changes as unknown as Parameters<typeof applySecurityChanges>[1], 'AI');
    const { accounts, privilegeSets, importApproximations, passwordPolicy, minPasswordLength, apiTokens } = securityOf(s);
    return { database: s.name, accounts, privilegeSets, importApproximations, passwordPolicy, minPasswordLength, apiTokens: apiTokens.map(({ id: _, ...t }) => t) };
  }));

  server.registerTool('create_database', {
    description: 'Start a new, empty database on this server (no FileMaker file needed), then build it with change_design. ' +
      'Set a password for its first account with `tabularius passwd` before people log in.',
    inputSchema: { name: z.string().describe('Database name: letters, digits, spaces, - and _') },
    annotations: { destructiveHint: false },
  }, async ({ name }) => {
    if (!canCreate) return fail('Insufficient privileges: only the server administrator can create databases');
    try {
      const store = host.create(name);
      await host.openFileEverywhere(store.name);
      return json({ database: store.name });
    } catch (e) {
      return fail(callerText(e));
    }
  });
}
