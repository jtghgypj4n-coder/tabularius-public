// Design mode over HTTP: read a solution's full design and change it.
//
//   GET  /tabularius/design/v1/databases/{db}               tables, fields, occurrences, relationships, value lists,
//                                                          custom functions, layouts, scripts, themes
//   GET  /tabularius/design/v1/databases/{db}/layouts/{id}  a layout's design, as stored (for the layout editor)
//   POST /tabularius/design/v1/databases/{db}/layouts/{id}/fix   {"design"?, "only"?: [{rule, objectIds}]}: the layout with
//                                                             the linter's mechanical findings mended (not saved), with any field changes they need
//   GET  /tabularius/design/v1/databases/{db}/layouts/{id}/history  every save of the layout, oldest first
//   POST /tabularius/design/v1/databases/{db}/layouts/{id}/speed  {"ai"?}: Check's speed findings, each with a redesign
//                                                             as changes and the cost before and after (not saved)
//   GET  /tabularius/design/v1/databases/{db}/layouts/{id}/lint  what will look or behave wrong on it (POST {"design"}: on an
//                                                          unsaved design; the layout editor's Check layout)
//   POST /tabularius/design/v1/databases/{db}/scripts/lint  {"text"} or {"script": id}: loops that never end and guards that
//                                                          catch nothing, with a fix for each (the script editor's Check)
//   POST /tabularius/design/v1/databases/{db}/restyle       {"theme"} or {"tokens", "name"?}, "consistent"?, "layouts"?: [ids]: every
//                                                          layout onto one theme, before and after each, and the changes
//                                                          that do it (not applied; a new theme from tokens comes first)
//   POST /tabularius/design/v1/databases/{db}/import-tables  multipart/form-data: files ("file" parts: CSV, Excel, Markdown, a Notion ZIP; "pages" + "folder": a folder of
//                                                          Notion pages), "overrides" (JSON {sheet: {column: kind}}); ?stage=preview (default)|import, ?links=0:
//                                                          the plan with a few rows of each sheet, or the tables made (counts); as `tabularius import-tables`
//   POST /tabularius/design/v1/databases/{db}/modernize    {"tables"?, "styles"?, "folder"?, "fromLayouts"?}: a list, detail, list and detail, classic list
//                                                          and classic form for each table, from templates with no AI, beside the
//                                                          file's own layouts; the layouts and the changes that make them (not applied)
//   GET  /tabularius/design/v1/databases/{db}/themes/{id}   a theme: element defaults and every named style, with rules
//   GET  /tabularius/design/v1/databases/{db}/history       design changes made in Tabularius
//   GET  /tabularius/design/v1/databases/{db}/ddr          the Database Design Report as XML (FileMaker's FMPReport format)
//   GET  /tabularius/design/v1/databases/{db}/docs          ?format=md|html: documentation of the solution (POST {"introduction"} to put one first)
//   GET  /tabularius/design/v1/databases/{db}/report        what in the file won't work yet (conversion report)
//   GET  /tabularius/design/v1/databases/{db}/audit         record changes: ?table=&recordId=&account=&surface=&script=&since=&limit=
//   POST /tabularius/design/v1/databases/{db}               {"changes": [DesignOp, ...]}: all apply, or none
//                                                          (returns `undo` when they only add things; ?preview=1 describes them instead)
//   POST /tabularius/design/v1/databases/{db}/check         {"formula", "occurrence"?, "table"?, "customFunction"?, "parameters"?}:
//                                                          the formula's first error, as the Specify Calculation dialog reports it
//   POST /tabularius/design/v1/databases/{db}/evaluate      {"formula", "layout"?}: its result, on no record (to try a custom function)
//   POST /tabularius/design/v1/databases/{db}/preview       {"formula", "occurrence"?, "table"?, "layout"?, "recordId"?}: its results on the
//                                                         record the person was on and the first few others (live preview; nothing stored)
//   POST /tabularius/design/v1/databases/{db}/snippet       {"xml", "table"?, "script"?, "at"?}: the changes that paste FileMaker's
//                                                          clipboard XML (tables, fields, scripts, steps, custom functions,
//                                                          value lists) into this file, with a summary and notes; not applied.
//                                                          Layout objects ("layout": the layout they go onto) come back as
//                                                          {"objects", "summary", "notes"} for the layout editor to place
//   POST /tabularius/design/v1/databases/{db}/snippet/copy  {"tables"?, "fields"?: {table, ids}, "scripts"?, "steps"?: {script, indexes},
//                                                          "customFunctions"?, "valueLists"?} (ids): FileMaker's clipboard XML for them;
//                                                          or {"objects": [layout objects], "layout"}: Layout mode's clipboard XML
//   GET  /tabularius/design/v1/databases/{db}/images        the image library (button icons, pictures), with signed URLs
//   POST /tabularius/design/v1/databases/{db}/images        {"filename", "mime", "data": base64}: adds a PNG, JPEG, GIF, WebP or SVG
//   GET  /tabularius/design/v1/databases/{db}/used          ?name=&kind=: where a field, script, layout, custom function... is used
//   GET  /tabularius/design/v1/databases/{db}/graph         the relationship graph in plain English, its problems, and
//                                                          the updateOccurrence changes that tidy it (anchor-buoy aware)
//   DELETE /tabularius/design/v1/databases/{db}/deleted[/{id}]  let go of a deleted table's or field's data for good
//                                                          (restore one with the restoreDeleted change instead)
//   GET|POST /tabularius/design/v1/databases/{db}/script-tests   script test cases (?script=id); POST {"test"} saves one
//   DELETE /tabularius/design/v1/databases/{db}/script-tests/{id}
//   POST /tabularius/design/v1/databases/{db}/script-tests/run    {"ids"} or {"script"}: runs them offline on a copy
//   POST /tabularius/design/v1/databases/{db}/script-tests/record {"script", "given"}: how a run ends, to save as a case
//   GET  /tabularius/design/v1/databases/{db}/scripts/{id}/history  the script as each save here left it, as text
//   GET  /tabularius/design/v1/databases/{db}/scripts/{id}/profile  each step's time and run count on this server
//   POST /tabularius/design/v1/databases/{db}/scripts/{id}/profile  {"given"}: profiles one run, offline on a copy
//   POST /tabularius/design/v1/databases/{db}/scripts/{id}/dry-run  {"given"}: which records and fields one run would change
//   GET|POST /tabularius/design/v1/databases/{db}/library   the component library shared by every file here; POST {"component"} saves one
//   POST|DELETE /tabularius/design/v1/databases/{db}/library/{id}  {"preview"?}: places it here or takes its latest version; DELETE takes it out
//   POST /tabularius/design/v1/databases/{db}/scripts/dry-run  {"text", "given"}: the same for steps not saved yet (a recorded macro)
//   GET  /tabularius/design/v1/databases/{db}/scripts/{id}/dependencies  what the script uses (fields, layouts, scripts...),
//                                                          what starts it, and how it reaches outside the solution
//   POST /tabularius/design/v1/databases/{db}/scripts/{id}/compare  {"text", "base"?}: proves a drafted version does what
//                                                          the script does (each run and its saved test cases, offline on a copy)
//
// Same session tokens as the Data API. Changing the design needs full access:
// an account with the [Full Access] privilege set, or one set up on the server
// with `tabularius passwd` that the file itself does not define.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { DesignError, StoreError, speedContext, speedMoveFromIdea, speedPlan, type SpeedIdea, checkStoreFormula, cleanScriptTest, phoneFingerprint, phoneDesign, PHONE_WIDTH, designReport, lintLayout, lintScript, refactorHints, parseScriptText as parseStoreScriptText, type LintStep, fixLayout, storeStats, places, syncPlaced, adaptObjects, tokensFromTheme, imageIds, portableObjects, parseScriptText, type LintIssue, designSnippet, isLayoutSnippet, layoutObjectsFromSnippet, layoutSnippet, snippetChanges, type SnippetPick, type DesignOp, type FormulaContext, type ScriptTest, type ScriptTestExpect, type Store } from '../../store/src/index.ts';
import { lintScriptText } from './script-check.ts';
import { ComponentLibrary, LibraryError, LibraryOwnerError, LibraryVersionError, type LibraryEntry, type LibraryImage } from './component-library.ts';
import { createHash } from 'node:crypto';
import { scriptForModel } from './script-for-model.ts';
import { AiLimitError, type ScriptTestsInput } from './assistant.ts';
import { compareScriptDraft, draftCases, dryRunScript, recordScriptTest, runScriptTests } from '../../scripts/src/index.ts';
import { SCRATCH_MAX_BYTES, dropScratch, scratchCopy } from './debug.ts';
import { Profiler } from './profiler.ts';
import { MENU_COMMANDS, SCRIPT_STEP_NAMES, scriptText, stepLine, type LayoutDesign, type LayoutObject } from '../../fmp12/src/index.ts';
import { previewFormula } from './formula-preview.ts';
import { ApiError, badPathError, readJson, sessionPrivileges, type DataApi, type Session } from './dataapi.ts';
import { aiRefusal } from './ai-access.ts';
import { docsHtml, documentSolution } from './docs.ts';
import type { Host } from './host.ts';
import { conversionReport, hostedAs } from './conversion.ts';
import { scriptDependencies, whereUsed, type TargetKind } from './insight.ts';
import { reviewGraph } from './graph-review.ts';
import { importTablesRoute } from './import-tables-route.ts';
import { changeImpact, type ImpactKind } from './change-impact.ts';
import { PendingChanges } from './design-review.ts';
import { suggestRules } from './rule-suggestions.ts';
import { layoutsBefore, ordersBefore, previewDesign, restyleFileChange, undoChanges } from './design-preview.ts';
import { modernizeChange } from './modernize.ts';

/** The theme of a layout, by id. */
export function layoutTheme(store: Store, layout: unknown) {
  const designs = store.designs();
  const themeId = designs.layouts.find((l) => l.id === Number(layout))?.themeId;
  return designs.themes.find((t) => t.id === themeId);
}

/** A theme's styles by the name FileMaker shows, from the objects that use them. */
export function styleNames(store: Store, themeId: number | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (objs: LayoutObject[]) => {
    for (const o of objs) {
      if (o.style.displayName && o.style.name && !out.has(o.style.displayName)) out.set(o.style.displayName, o.style.name);
      walk(o.children ?? []);
    }
  };
  for (const l of store.designs().layouts) if (l.themeId === themeId) walk(l.objects);
  return out;
}

/** Whether an account may change a file's design: [Full Access] only, as in FileMaker. */
export function canDesign(store: Store, account: string, via?: string): boolean {
  return store.privileges(account, via).full;
}

/** Where a formula to check is evaluated: occurrence and table by name or id, or a custom function's parameters. */
export function formulaContext(store: Store, body: { occurrence?: unknown; table?: unknown; customFunction?: unknown; parameters?: unknown }): FormulaContext {
  const s = store.schema;
  const byRef = <T extends { id: number; name: string }>(list: T[], ref: unknown, what: string): T | undefined => {
    if (ref === undefined || ref === null || ref === '') return undefined;
    const hit = list.find((x) => (typeof ref === 'number' ? x.id === ref : x.name.toLowerCase() === String(ref).toLowerCase()));
    if (!hit) throw new ApiError(100, `No ${what} "${String(ref)}"`, 400);
    return hit;
  };
  const ctx: FormulaContext = {
    occurrence: byRef(s.tableOccurrences, body.occurrence, 'table occurrence')?.id,
    table: byRef(s.tables, body.table, 'table')?.id,
  };
  const cf = byRef(s.customFunctions, body.customFunction, 'custom function');
  if (Array.isArray(body.parameters)) ctx.parameters = body.parameters.map(String);
  else if (cf) ctx.parameters = cf.parameters;
  return ctx;
}

/**
 * The whole design, in the shape design tools work with; hosted: the databases served alongside, which file references find.
 * other opens one of them when the account may design it too, so its tables can be put on this file's graph.
 */
export function designOf(store: Store, hosted: string[] = [], other?: (name: string) => Store | undefined) {
  const s = store.schema;
  // Layout Setup's menu set, for the menu sets' "used by" list.
  const layoutMenus = new Map(store.designs().layouts.filter((d) => d.menuSetId !== undefined).map((d) => [d.id, d.menuSetId!]));
  return {
    database: store.name,
    ...(store.fileMode === 'native' ? { fileMode: 'native' as const } : {}),
    tables: s.tables.map((t) => ({ ...t, records: recordCount(store, t.name) })),
    tableOccurrences: s.tableOccurrences.map((to) => ({
      ...to,
      ...(to.dataSourceId ? { file: s.dataSources.find((d) => d.id === to.dataSourceId)?.name } : { table: s.tables.find((t) => t.id === to.baseTableId)?.name }),
    })),
    relationships: s.relationships,
    /** Manage External Data Sources: each entry, the hosted database a file reference finds, and the occurrences using it. */
    dataSources: s.dataSources.map((d) => {
      const odbc = d.paths[0]?.startsWith('odbc:');
      const at = odbc ? undefined : hostedAs(d.paths, hosted);
      const there = at ? other?.(at) : undefined;
      const tables = there?.schema.tables.map((t) => ({ id: t.id, name: t.name, fields: t.fields.map((f) => ({ id: f.id, name: f.name, kind: f.kind, type: f.type, ...(f.options ? { options: f.options } : {}) })) }));
      return { id: d.id, name: d.name, paths: d.paths, kind: odbc ? 'odbc' : 'file', ...(at ? { hosted: at } : {}), ...(tables?.length ? { tables } : {}), occurrences: s.tableOccurrences.filter((t) => t.dataSourceId === d.id).length };
    }),
    /** Manage Containers: base directories (0, the default, always), the fields storing there, and what Tabularius keeps. */
    containerDirectories: containerDirectories(store),
    containerData: containerData(store),
    /** File Options, with names as they are now. */
    fileOptions: fileOptionsOf(store),
    valueLists: s.valueLists,
    customFunctions: s.customFunctions,
    /** Deleted tables and fields whose data is kept: the restoreDeleted change brings one back. */
    deleted: store.deletedDesigns(),
    customMenus: s.customMenus ?? [],
    customMenuSets: s.customMenuSets ?? [],
    defaultMenuSetId: s.defaultMenuSetId ?? null,
    /** Menu commands Tabularius knows by name, for custom menu items. */
    menuCommands: Object.entries(MENU_COMMANDS).map(([id, name]) => ({ id: Number(id), name })).sort((a, b) => a.name.localeCompare(b.name)),
    layouts: s.layouts.map((l) => {
      const menuSetId = layoutMenus.get(l.id);
      // A phone layout made from another: which, and whether it still follows it (not edited by hand since it was last rebuilt).
      const d = store.designs().layouts.find((x) => x.id === l.id);
      const phone = d?.phone ? { of: d.phone.of, following: phoneFingerprint(d) === d.phone.synced } : undefined;
      return { id: l.id, name: l.name, tableOccurrenceId: l.tableOccurrenceId, occurrence: s.tableOccurrences.find((t) => t.id === l.tableOccurrenceId)?.name, ...(menuSetId !== undefined ? { menuSetId } : {}), ...(phone ? { phone } : {}) };
    }),
    layoutOrder: s.layoutOrder,
    scripts: s.scripts.map((x) => ({ id: x.id, name: x.name, steps: x.steps, text: scriptText(x.steps), ...(x.limits ? { limits: x.limits } : {}) })),
    scriptOrder: s.scriptOrder,
    /** Layout components (not in FileMaker): reusable groups of objects, and the layouts they're placed on. */
    components: (store.designs().components ?? []).map((c) => ({ ...c, layouts: store.designs().layouts.filter((d) => places(d, c.id)).map((d) => d.id) })),
    // Each theme's look as design tokens (store/token-theme.ts), with the tokens it doesn't set.
    themes: store.designs().themes.map((t) => {
      const { tokens, unmapped } = tokensFromTheme(t);
      return { id: t.id, name: t.name, styles: t.styles.map((x) => ({ name: x.name, ...(x.element !== undefined ? { element: x.element } : {}) })), tokens, unmapped };
    }),
    privilegeSets: s.privilegeSets.map((p) => p.name),
    /** The file's page setup (paper and margins), for Layout Setup's fixed page margins. */
    ...(s.pageSetup ? { pageSetup: s.pageSetup } : {}),
    /** Every script step's name, for writing scripts as text. */
    scriptSteps: [...new Set(SCRIPT_STEP_NAMES)].sort((a, b) => a.localeCompare(b)),
  };
}

function fileOptionsOf(store: Store) {
  const s = store.schema;
  const fo = s.fileOptions;
  if (!fo) return {};
  const script = (x?: { scriptId: number }) => x && { scriptId: x.scriptId, script: s.scripts.find((sc) => sc.id === x.scriptId)?.name };
  return {
    ...(fo.openLayoutId !== undefined ? { openLayoutId: fo.openLayoutId, openLayout: s.layouts.find((l) => l.id === fo.openLayoutId)?.name } : {}),
    ...(fo.onFirstWindowOpen ? { onFirstWindowOpen: script(fo.onFirstWindowOpen) } : {}),
    ...(fo.onLastWindowClose ? { onLastWindowClose: script(fo.onLastWindowClose) } : {}),
    ...(fo.onWindowOpen ? { onWindowOpen: script(fo.onWindowOpen) } : {}),
    ...(fo.onWindowClose ? { onWindowClose: script(fo.onWindowClose) } : {}),
  };
}

function containerDirectories(store: Store) {
  const s = store.schema;
  const dirs = [...(s.containerDirectories ?? [])];
  if (!dirs.some((d) => d.id === 0)) dirs.unshift({ id: 0, path: `Files/${store.name}/` });
  return dirs.map((d) => ({
    ...d,
    fields: s.tables.flatMap((t) => t.fields.filter((f) => f.type === 'container' && f.options?.externalStorage?.directoryId === d.id).map((f) => ({ table: t.name, field: f.name, tableId: t.id, fieldId: f.id }))),
  }));
}

/** Container files the database keeps (all of them, whatever FileMaker's storage settings say). */
function containerData(store: Store): { files: number; bytes: number } {
  try {
    const r = store.query('SELECT count(*) AS files, coalesce(sum(length(data)), 0) + coalesce((SELECT sum(length(data)) FROM _fm_container_chunks), 0) AS bytes FROM _fm_containers')[0];
    return { files: Number(r.files), bytes: Number(r.bytes) };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

function recordCount(store: Store, table: string): number | null {
  try {
    return Number(store.query(`SELECT count(*) AS n FROM "${table.replace(/"/g, '""')}"`)[0].n);
  } catch {
    return null;
  }
}

export class DesignApi {
  private readonly host: Host;
  private readonly api: DataApi;
  /** The AI assistant's test-case writer, when the server has one (index.ts). */
  testWriter?: (store: Store, account: string) => (input: ScriptTestsInput, signal?: AbortSignal) => Promise<unknown[]>;

  private readonly lib: ComponentLibrary;
  /** Changes staged for review, applied (all or some) from the Review tab (design-review.ts). */
  private readonly pending = new PendingChanges();
  /** The assistant's speed-up ideas (assistant.ts speedIdeas), when the server has one. */
  speedAi?: (store: Store, account: string, context: unknown, signal: AbortSignal) => Promise<unknown[]>;

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
    this.lib = new ComponentLibrary(host.dir);
  }

  /**
   * The component library (component-library.ts), shared by every file here:
   * GET lists it (with this file's copy of each, if any); POST {"component"}
   * saves one of this file's components to it (the next version, when it is
   * already a copy of one); POST /library/{id} places that component in this
   * file, or brings this file's copy up to its latest version ({"preview":
   * true}: what it would leave out, and each layout it changes before and
   * after, nothing saved); DELETE /library/{id} takes it out, from a file that
   * uses it. Files keep their own copies.
   */
  private library(req: IncomingMessage, store: Store, id: string | undefined, account: string, send: (status: number, body: unknown) => void): Promise<void> | void {
    const components = () => store.designs().components ?? [];
    const summary = (e: LibraryEntry) => {
      const here = components().find((c) => c.library?.id === e.id);
      // Pictures stay in the file they came from until the component is placed; the preview draws without them.
      const objects = structuredClone(e.objects);
      const strip = (list: LayoutObject[]) => list.forEach((o) => { delete o.imageId; delete o.icon; if (o.children) strip(o.children); });
      strip(objects);
      return { id: e.id, name: e.name, width: e.width, height: e.height, objects, version: e.version, updated: e.updated, from: e.from, owner: e.owner, uses: e.uses,
        ...(here ? { here: { component: here.id, version: here.library!.version } } : {}) };
    };
    const fields = (to: number) => store.calc.occurrenceTable(to)?.table.fields;
    if (!id && req.method === 'GET') return send(200, { library: this.lib.list().map(summary) });
    return (async () => {
      if (!id && req.method === 'POST') {
        const body = await readJson(req);
        const c = components().find((x) => x.id === body.component);
        if (!c) throw new ApiError(960, 'Send {"component": id} of one of this file\'s components', 400);
        const images: Record<string, LibraryImage> = {};
        for (const i of imageIds(c.objects)) {
          const img = store.image(i);
          if (img) images[i] = { filename: img.filename, mime: img.mime, data: Buffer.from(img.data).toString('base64') };
        }
        const linked = c.library && this.lib.get(c.library.id) ? c.library.id : undefined;
        let entry: LibraryEntry;
        try {
          entry = this.lib.save({ id: linked, base: c.library?.version, name: c.name, width: c.width, height: c.height, objects: portableObjects(c.objects, store.schema, fields), images, from: store.name });
        } catch (e) {
          if (e instanceof LibraryOwnerError) throw new ApiError(9, e.message, 403);
          if (e instanceof LibraryVersionError) throw new ApiError(960, e.message, 409);
          if (e instanceof LibraryError) throw new ApiError(960, e.message, 400);
          throw e;
        }
        store.applyDesign([{ op: 'updateComponent', component: c.id, library: { id: entry.id, version: entry.version } } as DesignOp], { account });
        return send(200, { entry: summary(entry), design: designOf(store, this.host.names()) });
      }
      const entry = id ? this.lib.get(id) : undefined;
      if (!entry) throw new ApiError(960, 'That component is not in the library', 404);
      if (req.method === 'DELETE') {
        if (entry.owner !== store.name) throw new ApiError(9, `Only ${entry.owner}, where "${entry.name}" was first saved to the library, can take it out`, 403);
        this.lib.remove(entry.id);
        return send(200, { removed: entry.id });
      }
      if (req.method !== 'POST') throw new ApiError(3, 'Command is unavailable', 405);
      const body = await readJson(req);
      const preview = body.preview === true;
      const here = components().find((c) => c.library?.id === entry.id);
      // Pictures: this file's own when it already has the same bytes, else added (not for a preview).
      const pictures = new Map<number, number>();
      if (!preview && Object.keys(entry.images).length) {
        const hash = (d: Uint8Array) => createHash('sha256').update(d).digest('hex');
        const have = new Map(store.images().map((i) => [hash(store.image(i.id)!.data), i.id]));
        for (const [from, img] of Object.entries(entry.images)) {
          const data = Buffer.from(img.data, 'base64');
          pictures.set(Number(from), have.get(hash(data)) ?? store.addImage(img.filename, img.mime, data, { account }));
        }
      }
      const step = (line: string): LayoutObject['action'] | undefined => {
        try {
          if (parseScriptText(line, store.schema).length !== 1) return undefined;
        } catch {
          return undefined;
        }
        return { stepId: 0, step: '', text: line } as unknown as LayoutObject['action'];
      };
      const { objects, missing } = adaptObjects(entry.objects, store.schema, fields, (i) => pictures.get(i), step);
      if (preview) {
        const next = { ...(here ?? { id: -1, name: entry.name }), width: entry.width, height: entry.height, objects };
        const layouts = here ? store.designs().layouts.filter((d) => places(d, here.id)).map((d) => {
          const after = structuredClone(d);
          syncPlaced(after, [next]);
          return { id: d.id, name: d.name, before: d, after };
        }) : [];
        return send(200, { version: entry.version, ...(here ? { current: here.library!.version } : {}), missing, layouts });
      }
      const library = { id: entry.id, version: entry.version };
      let name = entry.name;
      for (let n = 2; !here && components().some((c) => c.name.toLowerCase() === name.toLowerCase()); n++) name = `${entry.name} ${n}`;
      const change = here
        ? { op: 'updateComponent', component: here.id, objects, library }
        : { op: 'createComponent', name, objects, library };
      const { applied } = store.applyDesign([change as DesignOp], { account });
      this.lib.use(entry.id, store.name);
      send(200, { applied, missing, design: designOf(store, this.host.names()) });
    })();
  }

  /**
   * Script test cases (store/script-tests.ts): GET lists them (?script=id for one script's), POST saves one,
   * DELETE /script-tests/{id} deletes one, POST /script-tests/run runs them ({"ids"} or {"script"}, else all) and
   * POST /script-tests/record runs a script once with {"script", "given"} and returns how it ended, to save as a
   * case. Runs are offline, on a throwaway copy of the file, so the hosted data never changes.
   */
  private async scriptTests(req: IncomingMessage, store: Store, sub: string | undefined, url: URL, send: (status: number, body: unknown) => void, account: string): Promise<void> {
    if (req.method === 'POST' && sub === 'suggest') return this.suggestTests(req, store, send, account);
    if (req.method === 'GET' && !sub) {
      const script = url.searchParams.has('script') ? Number(url.searchParams.get('script')) : undefined;
      send(200, { tests: store.scriptTests(script) });
    } else if (req.method === 'POST' && !sub) {
      const body = await readJson(req);
      try {
        send(200, { test: store.saveScriptTest(body.test) });
      } catch (e) {
        if (e instanceof StoreError) throw e;
        throw new ApiError(960, (e as Error).message, 400);
      }
    } else if (req.method === 'DELETE' && sub && sub !== 'run' && sub !== 'record' && sub !== 'suggest') {
      if (!store.deleteScriptTest(sub)) throw new ApiError(5, 'No such test case', 404);
      send(200, { deleted: sub });
    } else if (req.method === 'POST' && (sub === 'run' || sub === 'record')) {
      const body = await readJson(req);
      const copy = await scratchCopy(store, SCRATCH_MAX_BYTES);
      try {
        if (sub === 'run') {
          const ids = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : undefined;
          const tests = store.scriptTests(typeof body.script === 'number' ? body.script : undefined).filter((t) => !ids || ids.has(t.id));
          send(200, { outcomes: await runScriptTests(copy.store, tests) });
        } else {
          if (typeof body.script !== 'number') throw new ApiError(960, 'Send {"script": id, "given": {...}}', 400);
          // The same checks a saved case gets, with a placeholder expectation.
          let given;
          try {
            given = cleanScriptTest({ script: body.script, name: 'record', given: body.given ?? {}, expect: { error: 0 } }, store.schema.scripts.map((x) => x.id)).given;
          } catch (e) {
            throw new ApiError(960, (e as Error).message, 400);
          }
          try {
            send(200, { expect: await recordScriptTest(copy.store, body.script, given) });
          } catch (e) {
            // The run itself failed (the inputs couldn't be set up): say why.
            if (e instanceof ApiError || e instanceof StoreError) throw e;
            throw new ApiError(960, (e as Error).message, 400);
          }
        }
      } finally {
        dropScratch(copy);
      }
    } else throw new ApiError(960, 'Unknown script test request', 400);
  }

  /**
   * AI-written test cases: POST /script-tests/suggest {"script"}. The model sees the script (secrets hidden) and the
   * file's outline, never its records. Each case it proposes is run here, offline on a throwaway copy, and comes
   * back with whether the script did what the case expects, what it did instead, and what the run would change, so
   * the person keeps the ones they want (as expected, or as the script runs now). Nothing is saved here.
   */
  private async suggestTests(req: IncomingMessage, store: Store, send: (status: number, body: unknown) => void, account: string): Promise<void> {
    const body = await readJson(req);
    const script = store.schema.scripts.find((x) => x.id === body.script);
    if (!script) throw new ApiError(104, 'No such script', 404);
    const write = this.testWriter?.(store, account);
    if (!write) throw new ApiError(960, 'The AI assistant is off on this server (start it with --ai)', 503);
    // One at a time per file: each takes a model call and several runs on a copy.
    if (this.suggesting.has(store)) throw new ApiError(960, 'Test cases are already being suggested for this file; try again when they arrive', 409);
    this.suggesting.add(store);
    // Closing the page stops the model call.
    const abort = new AbortController();
    const gone = () => abort.abort();
    req.socket.once('close', gone);
    // The copy first, so a file too big to copy costs no model call.
    let copy: Awaited<ReturnType<typeof scratchCopy>> | undefined;
    try {
      copy = await scratchCopy(store, SCRATCH_MAX_BYTES);
      await this.suggestOnCopy(store, copy.store, script, write, abort.signal, send);
    } finally {
      if (copy) dropScratch(copy);
      this.suggesting.delete(store);
      req.socket.off('close', gone);
    }
  }

  private readonly suggesting = new Set<Store>();

  private async suggestOnCopy(store: Store, scratch: Store, script: Store['schema']['scripts'][number], write: (input: ScriptTestsInput, signal?: AbortSignal) => Promise<unknown[]>,
    signal: AbortSignal, send: (status: number, body: unknown) => void): Promise<void> {
    const s = store.schema;
    const occurrenceOf = (id?: number) => s.tableOccurrences.find((t) => t.id === id);
    const used = new Set(s.layouts.map((l) => occurrenceOf(l.tableOccurrenceId)?.name).filter((x): x is string => !!x));
    const input: ScriptTestsInput = {
      script: { name: script.name, text: scriptForModel(script.steps).slice(0, 40_000) },
      layouts: s.layouts.slice(0, 200).flatMap((l) => { const o = occurrenceOf(l.tableOccurrenceId); return o ? [{ name: l.name, table: o.name }] : []; }),
      tables: s.tableOccurrences.filter((o) => used.has(o.name)).slice(0, 60).map((o) => ({
        name: o.name,
        fields: (s.tables.find((t) => t.id === o.baseTableId)?.fields ?? []).slice(0, 80).map((f) => `${f.name} (${f.kind === 'normal' ? f.type : `${f.kind} ${f.type}`}${f.options?.global ? ', global' : ''})`),
      })),
      scripts: s.scripts.slice(0, 300).map((x) => x.name),
      existing: store.scriptTests(script.id).map((t) => t.name),
    };
    let proposed: unknown[];
    try {
      proposed = await write(input, signal);
    } catch (e) {
      throw new ApiError(960, (e as Error).message, e instanceof AiLimitError ? 429 : 400);
    }
    const ids = s.scripts.map((x) => x.id);
    const cases: { c: Omit<ScriptTest, 'id'>; why?: string }[] = [];
    const skipped: string[] = [];
    for (const raw of proposed.slice(0, 6)) {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      try {
        cases.push({ c: cleanScriptTest({ script: script.id, name: r.name, given: r.given ?? {}, expect: r.expect ?? {} }, ids), ...(typeof r.why === 'string' ? { why: r.why.slice(0, 300) } : {}) });
      } catch (e) {
        skipped.push(`${typeof r.name === 'string' ? r.name.slice(0, 80) : 'A case'}: ${(e as Error).message}`);
      }
    }
    const out = [];
    for (const [i, { c, why }] of cases.entries()) {
      if (signal.aborted) return;
      const [o] = await runScriptTests(scratch, [{ id: `ai-${i + 1}`, ...c }]);
      // What the run would change, for the person to judge the case by.
      const dry = await dryRunScript(scratch, script.id, c.given).catch(() => undefined);
      // A case that couldn't run has nothing to keep "as it runs now".
      const ran = o.passed || o.failures.length ? asRuns(c.expect, o.failures) : undefined;
      out.push({
        name: c.name, ...(why ? { why } : {}),
        given: c.given, expect: c.expect, passed: o.passed, failures: o.failures, ...(o.message ? { message: o.message } : {}),
        // The same case with what the script did in place of each expectation it missed: "keep as it runs now".
        ...(ran ? { asRuns: ran } : {}),
        ...(dry ? { changes: {
          create: count(dry, 'create'), update: count(dry, 'update'), delete: count(dry, 'delete'),
          // Past the records listed, and tables emptied whole: so "changes no records" is never said of either.
          ...(dry.changes.more ? { more: dry.changes.more } : {}),
          ...(dry.changes.truncated.length ? { emptied: dry.changes.truncated.map((t) => `${t.table} (${t.records})`) } : {}),
        } } : {}),
      });
    }
    send(200, { cases: out, ...(skipped.length ? { skipped } : {}) });
  }

  /**
   * A script's step timings for the editor. GET: from the runs on this server since it started (or the
   * profiler was reset). POST {"given"}: runs it once now, offline on a throwaway copy, with a test case's
   * inputs, and returns that run's timings and how it ended.
   */
  private async scriptProfile(req: IncomingMessage, store: Store, id: number, send: (status: number, body: unknown) => void): Promise<void> {
    const script = store.schema.scripts.find((x) => x.id === id);
    if (!script) throw new ApiError(104, 'No such script', 404);
    if (req.method === 'GET') {
      const p = this.host.profiler instanceof Profiler ? this.host.profiler.script(store.name, script.name) : undefined;
      send(200, { profile: placeSteps(script, p), recording: this.host.profiler instanceof Profiler });
      return;
    }
    if (req.method !== 'POST') throw new ApiError(960, 'Unknown script profile request', 400);
    const body = await readJson(req);
    let given;
    try {
      given = cleanScriptTest({ script: id, name: 'profile', given: body.given ?? {}, expect: { error: 0 } }, store.schema.scripts.map((x) => x.id)).given;
    } catch (e) {
      throw new ApiError(960, (e as Error).message, 400);
    }
    const copy = await scratchCopy(store, SCRATCH_MAX_BYTES);
    try {
      const profiler = new Profiler();
      let ended;
      try {
        ended = await recordScriptTest(copy.store, id, given, { profile: profiler });
      } catch (e) {
        if (e instanceof ApiError || e instanceof StoreError) throw e;
        throw new ApiError(960, (e as Error).message, 400);
      }
      send(200, { profile: placeSteps(script, profiler.script(copy.store.name, script.name)), ended });
    } finally {
      dropScratch(copy);
    }
  }

  /**
   * Where the script could be simpler or faster (store/script-refactor.ts): GET for the saved script, with where the
   * time goes when the server has timed it; POST {"text"} for what the script editor has open (timed only while the
   * text is still the saved script's).
   */
  private async scriptRefactor(req: IncomingMessage, store: Store, id: number, send: (status: number, body: unknown) => void): Promise<void> {
    const script = store.schema.scripts.find((x) => x.id === id);
    if (!script) throw new ApiError(104, 'No such script', 404);
    const body = req.method === 'POST' ? await readJson(req) : {};
    if (req.method === 'POST' && typeof body.text !== 'string') throw new ApiError(960, 'Send {"text": "..."}', 400);
    let steps: LintStep[] = script.steps;
    if (typeof body.text === 'string' && body.text.trim() !== scriptText(script.steps).trim()) {
      try {
        steps = parseStoreScriptText(body.text, store.schema, script.steps);
      } catch (e) {
        throw new ApiError(960, (e as Error).message, 400);
      }
      send(200, { hints: refactorHints({ name: script.name, steps }, store.schema), timed: false });
      return;
    }
    const placed = placeSteps(script, this.host.profiler instanceof Profiler ? this.host.profiler.script(store.name, script.name) : undefined);
    const profile = placed?.steps.map((st) => ({ index: st.index, ms: st.totalMs, runs: st.count }));
    send(200, { hints: refactorHints({ name: script.name, steps }, store.schema, profile), timed: !!profile?.length });
  }

  /**
   * A dry run: POST {"given"} runs the script once, offline on a throwaway copy, and returns exactly which
   * records and fields it would change (each with its value before and after), and how it ended. With {"text"},
   * the copy's script is those steps first (a draft not saved yet).
   */
  private async scriptDryRun(req: IncomingMessage, store: Store, id: number, send: (status: number, body: unknown) => void): Promise<void> {
    if (!store.schema.scripts.some((x) => x.id === id)) throw new ApiError(104, 'No such script', 404);
    const body = await readJson(req);
    let given;
    try {
      given = cleanScriptTest({ script: id, name: 'dry run', given: body.given ?? {}, expect: { error: 0 } }, store.schema.scripts.map((x) => x.id)).given;
    } catch (e) {
      throw new ApiError(960, (e as Error).message, 400);
    }
    if (body.text !== undefined && (typeof body.text !== 'string' || body.text.length > 200_000)) throw new ApiError(960, '"text" is the script\'s steps as text', 400);
    const copy = await scratchCopy(store, SCRATCH_MAX_BYTES);
    try {
      try {
        // Steps not saved yet (a drafted change, before it is put in the editor): onto the copy only.
        if (typeof body.text === 'string') copy.store.applyDesign([{ op: 'updateScript', script: id, text: body.text }]);
        send(200, await dryRunScript(copy.store, id, given));
      } catch (e) {
        if (e instanceof ApiError || e instanceof StoreError) throw e;
        throw new ApiError(960, (e as Error).message, 400);
      }
    } finally {
      dropScratch(copy);
    }
  }

  /**
   * Is a drafted version the same script? POST {"text"} (and {"base"}: what the editor has open, when it isn't saved
   * yet) runs the script and then the draft on a throwaway copy, offline, from each saved test case's inputs and
   * from where buttons start it, and compares how each run ended and what it changed; then the saved test cases run
   * against the draft. Nothing on the real file changes.
   */
  private async scriptCompare(req: IncomingMessage, store: Store, id: number, send: (status: number, body: unknown) => void): Promise<void> {
    if (!store.schema.scripts.some((x) => x.id === id)) throw new ApiError(104, 'No such script', 404);
    const body = await readJson(req);
    const isText = (x: unknown) => typeof x === 'string' && x.length <= 200_000;
    if (!isText(body.text) || (body.base !== undefined && !isText(body.base))) throw new ApiError(960, 'Send {"text": "..."}: the drafted steps as text', 400);
    const copy = await scratchCopy(store, SCRATCH_MAX_BYTES);
    try {
      try {
        if (typeof body.base === 'string') copy.store.applyDesign([{ op: 'updateScript', script: id, text: body.base }]);
        const tests = copy.store.scriptTests(id);
        send(200, await compareScriptDraft(copy.store, id, body.text as string, draftCases(copy.store, id, tests), tests));
      } catch (e) {
        if (e instanceof ApiError || e instanceof StoreError) throw e;
        throw new ApiError(960, (e as Error).message, 400);
      }
    } finally {
      dropScratch(copy);
    }
  }

  /**
   * A dry run of a script not saved yet (a recorded macro, before it is saved): POST {"text", "given"} adds the
   * steps as a new script to a throwaway copy, runs it once offline and returns what it would change.
   */
  private async draftDryRun(req: IncomingMessage, store: Store, send: (status: number, body: unknown) => void): Promise<void> {
    const body = await readJson(req);
    if (typeof body.text !== 'string' || body.text.length > 200_000) throw new ApiError(960, 'Send {"text": "..."}: the script\'s steps as text', 400);
    const copy = await scratchCopy(store, SCRATCH_MAX_BYTES);
    try {
      try {
        const before = new Set(copy.store.schema.scripts.map((x) => x.id));
        copy.store.applyDesign([{ op: 'createScript', name: 'Draft (dry run)', text: body.text }]);
        const id = copy.store.schema.scripts.find((x) => !before.has(x.id))!.id;
        const given = cleanScriptTest({ script: id, name: 'dry run', given: body.given ?? {}, expect: { error: 0 } }, copy.store.schema.scripts.map((x) => x.id)).given;
        send(200, await dryRunScript(copy.store, id, given));
      } catch (e) {
        if (e instanceof ApiError || e instanceof StoreError) throw e;
        throw new ApiError(960, (e as Error).message, 400);
      }
    } finally {
      dropScratch(copy);
    }
  }

  /**
   * Make this layout faster (layout-speed.ts): Check's speed findings on the saved layout, each with a redesign
   * where there is a mechanical one, as changes to look over (nothing is saved; the editor applies the ones picked
   * through the change endpoint, which returns the undo). With {"ai": true}, the assistant proposes redesigns for
   * the rest from the layout's design (never its records), unless AI is off for the file or the account lacks AI
   * access; its ideas that don't apply to the file are left out.
   */
  private async speed(store: Store, session: Session, layoutId: number, ai: boolean, req: IncomingMessage): Promise<unknown> {
    const plan = speedPlan(store, layoutId);
    if (!ai || !plan.left.length) return plan;
    const off = aiRefusal(store, { account: session.account, via: 'AI speed-up' });
    if (off) return { ...plan, ai: { note: off } };
    if (!sessionPrivileges(store, session).has('fmmcp')) return { ...plan, ai: { note: 'Ideas from AI need the fmmcp extended privilege (AI access) in this account\'s privilege set' } };
    if (!this.speedAi) return { ...plan, ai: { note: 'The AI assistant is off on this server (start it with --ai and an API key)' } };
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    let ideas: unknown[];
    try {
      ideas = await this.speedAi(store, session.account, speedContext(store, layoutId, plan.left), abort.signal);
    } catch (e) {
      return { ...plan, ai: { note: (e as Error).message } };
    }
    const moves = [...plan.moves];
    const dropped: string[] = [];
    for (const raw of ideas) {
      const idea = raw as SpeedIdea & { finding?: unknown };
      const finding = typeof idea.finding === 'number' ? plan.left[idea.finding] : undefined;
      if (!finding || typeof idea.title !== 'string') continue;
      try {
        const objectIds = Array.isArray(idea.objectIds) ? idea.objectIds.filter((x): x is number => Number.isInteger(x)) : finding.objectIds;
        moves.push(speedMoveFromIdea(store, layoutId, finding.kind, {
          title: idea.title.slice(0, 300), objectIds, ...(typeof idea.caveat === 'string' ? { caveat: idea.caveat.slice(0, 600) } : {}),
          add: Array.isArray(idea.add) ? idea.add : [], edits: Array.isArray(idea.edits) ? idea.edits : [],
        }));
      } catch (e) {
        dropped.push(`${idea.title.slice(0, 120)}: ${(e as Error).message}`);
      }
    }
    const answered = new Set(moves.filter((x) => x.ai).flatMap((x) => x.objectIds));
    return { ...plan, moves, left: plan.left.filter((i) => !i.objectIds.some((id) => answered.has(id))), ai: { ideas: moves.length - plan.moves.length, ...(dropped.length ? { dropped } : {}) } };
  }

  /** Returns false when the request is not for design mode. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/design\/v1\/databases\/([^/]+)(?:\/(history|audit|report|ddr|docs|check|preview|restyle|modernize|import-tables|impact|pending(?:\/(?:apply|discard))?|suggest-rules|evaluate|snippet(?:\/copy)?|used|graph|scripts\/lint|scripts\/dry-run|layouts\/(\d+)|deleted(?:\/(\d+))?|themes\/(\d+)|images|layouts\/(\d+)\/(lint|fix|history|phone|speed)|script-tests(?:\/(run|record|[\w-]{1,64}))?|scripts\/(\d+)\/(history|profile|dry-run|refactor|compare|dependencies)|library(?:\/([0-9a-f]{12}))?))?$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const db = decodeURIComponent(m[1]);
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      const privileges = sessionPrivileges(store, session);
      // Another hosted file's tables, for occurrences into it, only when this account may design that file too.
      const mayDesign = (o: Store) => privileges.in(o).full;
      const other = (name: string) => { const o = this.host.get(name); return o && mayDesign(o) ? o : undefined; };
      if (!privileges.full) throw new ApiError(9, `Account "${session.account}" doesn't have full access, which design changes need`, 403);
      if (req.method === 'GET' && m[2] === 'history') send(200, { history: store.designHistory() });
      else if (req.method === 'GET' && m[2] === 'ddr') {
        const xml = designReport(store.schema, store.designs(), { fileName: `${db}.fmp12`, records: (t) => recordCount(store, t) ?? undefined });
        res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${encodeURIComponent(db)}_ddr.xml"` });
        res.end(xml);
      }
      else if ((req.method === 'GET' || req.method === 'POST') && m[2] === 'docs') {
        const body = req.method === 'POST' ? await readJson(req) : {};
        const introduction = typeof body.introduction === 'string' ? body.introduction.slice(0, 100_000) : undefined;
        const md = documentSolution(store, { introduction });
        const html = url.searchParams.get('format') === 'html';
        res.writeHead(200, {
          'content-type': html ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8', 'cache-control': 'no-store',
          'content-disposition': `attachment; filename="${encodeURIComponent(db)}_docs.${html ? 'html' : 'md'}"`,
          // The page is only ever downloaded; if it is opened from here, nothing in it runs.
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        });
        res.end(html ? docsHtml(md, `${db}: documentation`) : md);
      }
      else if (req.method === 'GET' && m[2] === 'report') send(200, { report: conversionReport(store, this.host.names()) });
      else if (req.method === 'GET' && m[2] === 'audit') {
        const p = url.searchParams;
        const n = (k: string) => (p.has(k) ? Number(p.get(k)) : undefined);
        send(200, { audit: store.auditLog({ table: p.get('table') ?? undefined, recordId: n('recordId'), account: p.get('account') ?? undefined, surface: p.get('surface') ?? undefined, script: p.get('script') ?? undefined, since: p.get('since') ?? undefined, limit: n('limit') }) });
      }
      else if (req.method === 'POST' && m[2] === 'check') {
        const body = await readJson(req);
        if (typeof body.formula !== 'string') throw new ApiError(960, 'Send {"formula": "..."}', 400);
        send(200, checkStoreFormula(store, body.formula, formulaContext(store, body)));
      }
      else if (req.method === 'POST' && m[2] === 'preview') {
        // The formula as typed, on the record the person was on and the first few others (nothing is stored).
        const body = await readJson(req);
        if (typeof body.formula !== 'string') throw new ApiError(960, 'Send {"formula": "..."}', 400);
        const ctx = formulaContext(store, body);
        const table = store.schema.tables.find((t) => t.id === ctx.table);
        const to = ctx.occurrence ?? (table ? store.calc.defaultOccurrence(table) : undefined);
        const check = checkStoreFormula(store, body.formula, { ...ctx, occurrence: to });
        const preview = check.ok ? previewFormula(store, to, body.formula, { layout: typeof body.layout === 'string' ? body.layout : undefined, recordId: body.recordId }) : undefined;
        send(200, { ok: check.ok, ...(check.ok ? {} : { message: check.message }), ...(preview ?? { results: [] }) });
      }
      else if (req.method === 'POST' && m[2] === 'restyle') {
        // Every layout onto one theme (an existing one, or new from tokens): before and after, nothing saved.
        const body = await readJson(req);
        try {
          send(200, restyleFileChange(store, body));
        } catch (e) {
          if (e instanceof StoreError || e instanceof DesignError || e instanceof ApiError) throw e;
          throw new ApiError(960, (e as Error).message, 400);
        }
      }
      else if (req.method === 'POST' && m[2] === 'modernize') {
        // New list, detail and classic layouts for each table from templates, beside the file's own: the layouts and the changes that make them (not applied).
        const body = await readJson(req);
        try {
          send(200, modernizeChange(store, body));
        } catch (e) {
          if (e instanceof StoreError || e instanceof DesignError || e instanceof ApiError) throw e;
          throw new ApiError(960, (e as Error).message, 400);
        }
      }
      else if (req.method === 'POST' && m[2] === 'snippet/copy') {
        const body = await readJson(req);
        if (body.objects === undefined) send(200, designSnippet(store.schema, body as SnippetPick));
        else {
          if (!Array.isArray(body.objects) || !body.objects.every((o: unknown) => typeof o === 'object' && o && 'kind' in o && 'bounds' in o)) throw new ApiError(960, '"objects" should be a list of layout objects', 400);
          send(200, layoutSnippet(body.objects as LayoutObject[], store.schema, { theme: layoutTheme(store, body.layout) }));
        }
      }
      else if (req.method === 'POST' && m[2] === 'snippet') {
        const body = await readJson(req);
        if (typeof body.xml !== 'string') throw new ApiError(960, 'Send {"xml": "<fmxmlsnippet ..."}', 400);
        const ref = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? v : undefined);
        if (isLayoutSnippet(body.xml)) {
          const theme = layoutTheme(store, body.layout);
          send(200, layoutObjectsFromSnippet(body.xml, store.schema, { theme, styleNames: styleNames(store, theme?.id) }));
        } else send(200, snippetChanges(body.xml, store.schema, { table: ref(body.table), script: ref(body.script), at: typeof body.at === 'number' ? body.at : undefined }));
      }
      else if (req.method === 'POST' && m[2] === 'evaluate') {
        const body = await readJson(req);
        if (typeof body.formula !== 'string') throw new ApiError(960, 'Send {"formula": "..."}', 400);
        const usable = (name: string) => {
          try {
            return !!store.calc.occurrence(store.layout(name).occurrence);
          } catch {
            return false;
          }
        };
        const layout = typeof body.layout === 'string' ? body.layout : store.schema.layouts.find((l) => usable(l.name))?.name;
        if (!layout) throw new ApiError(105, 'Formulas run from a layout; this file has none yet', 400);
        send(200, store.evaluate(layout, body.formula, undefined, { account: session.account }));
      }
      else if (req.method === 'DELETE' && m[2]?.startsWith('deleted')) {
        const emptied = store.emptyDeleted(m[4] === undefined ? undefined : Number(m[4]));
        if (m[4] !== undefined && !emptied) throw new ApiError(101, `Nothing deleted has id ${m[4]}`, 404);
        send(200, { emptied, design: designOf(store, this.host.names(), other) });
      }
      else if (m[2] === 'images') {
        const link = (id: number) => `/tabularius/images/${encodeURIComponent(store.name)}/${id}?${this.host.signed(store.name, id, 'image')}`;
        if (req.method === 'GET') send(200, { images: store.images().map((i) => ({ ...i, url: link(i.id) })) });
        else if (req.method === 'POST') {
          const body = await readJson(req);
          if (typeof body.data !== 'string' || typeof body.mime !== 'string') throw new ApiError(960, 'Send {"filename", "mime", "data": base64}', 400);
          const id = store.addImage(typeof body.filename === 'string' ? body.filename.slice(0, 255) : null, body.mime, Buffer.from(body.data, 'base64'), { account: session.account });
          send(200, { id, url: link(id) });
        } else throw new ApiError(3, 'Command is unavailable', 405);
      }
      else if (req.method === 'GET' && m[2] === 'suggest-rules') {
        // Validations, value lists, serials and defaults the data already follows (rule-suggestions.ts).
        try {
          send(200, suggestRules(store, { ...(url.searchParams.get('table') ? { table: url.searchParams.get('table')! } : {}) }));
        } catch (e) {
          throw new ApiError(5, (e as Error).message, 404);
        }
      }
      else if (req.method === 'GET' && m[2] === 'impact') {
        // What a rename or delete would break, before it is done (change-impact.ts).
        const kind = url.searchParams.get('kind') ?? '';
        if (!['field', 'table', 'layout', 'script', 'valueList'].includes(kind)) throw new ApiError(5, 'kind must be field, table, layout, script or valueList', 400);
        const change = url.searchParams.get('change') === 'delete' ? 'delete' : 'rename';
        try {
          // The design API is a human designer's view, so it checks every other hosted file.
          send(200, await changeImpact(store, this.host.logs, kind as ImpactKind, url.searchParams.get('name') ?? '', change, { others: this.host.openStores().filter((s) => s !== store) }));
        } catch (e) {
          throw new ApiError(5, (e as Error).message, 404);
        }
      }
      else if (m[2]?.startsWith('pending')) {
        // Staged changes: looked over (each described, with its text before and after, what it would break, and whether
        // someone else has changed the same thing since) and then applied, all or some (design-review.ts).
        const others = this.host.openStores().filter((s) => s !== store);
        const review = () => this.pending.review(store, (kind, name, change) => changeImpact(store, this.host.logs, kind, name, change, { others }));
        const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : undefined);
        if (req.method === 'GET' && m[2] === 'pending') send(200, await review());
        else if (req.method === 'POST' && m[2] === 'pending') {
          const body = await readJson(req);
          if (!Array.isArray(body.changes)) throw new ApiError(960, 'Send {"changes": [...]}', 400);
          const staged = this.pending.stage(store, body.changes, session.account);
          send(200, { staged: staged.map((p) => p.id), ...(await review()) });
        } else if (req.method === 'POST' && m[2] === 'pending/apply') {
          const body = await readJson(req);
          const result = this.pending.apply(store, session.account, ids(body.ids), ids(body.overrideConflicts) ?? []);
          send(200, { result, ...(await review()), design: designOf(store, this.host.names(), other) });
        } else if (req.method === 'POST' && m[2] === 'pending/discard') {
          const body = await readJson(req);
          const discarded = this.pending.discard(store, ids(body.ids));
          send(200, { discarded, ...(await review()) });
        } else throw new ApiError(3, 'Command is unavailable', 405);
      }
      else if (req.method === 'POST' && m[2] === 'scripts/dry-run') await this.draftDryRun(req, store, send);
      else if (req.method === 'POST' && m[2] === 'scripts/lint') {
        // The script linter (store/script-lint.ts) on a saved script, or on the text the script editor has open.
        const body = await readJson(req);
        const saved = typeof body.script === 'number' ? store.schema.scripts.find((x) => x.id === body.script) : undefined;
        if (typeof body.text !== 'string' && !saved) throw new ApiError(960, 'Send {"text": "..."} or {"script": id}', 400);
        send(200, { issues: typeof body.text === 'string' ? lintScriptText(store, body.text, undefined, saved?.steps) : lintScript(saved!, store.schema) });
      }
      else if (m[2] === 'library' || m[2]?.startsWith('library/')) await this.library(req, store, m[11], session.account, send);
      else if (m[2]?.startsWith('script-tests')) await this.scriptTests(req, store, m[8], url, send, session.account);
      else if (req.method === 'GET' && m[10] === 'history') send(200, { versions: scriptVersions(store, Number(m[9])) });
      else if (m[10] === 'profile') await this.scriptProfile(req, store, Number(m[9]), send);
      else if (m[10] === 'dry-run' && req.method === 'POST') await this.scriptDryRun(req, store, Number(m[9]), send);
      else if (m[10] === 'refactor' && (req.method === 'GET' || req.method === 'POST')) await this.scriptRefactor(req, store, Number(m[9]), send);
      else if (m[10] === 'compare' && req.method === 'POST') await this.scriptCompare(req, store, Number(m[9]), send);
      else if (m[10] === 'dependencies' && req.method === 'GET') {
        // What the script uses and what starts it (insight.ts): its dependency map.
        const deps = scriptDependencies(store, Number(m[9]));
        if (!deps) throw new ApiError(104, 'No such script', 404);
        send(200, deps);
      }
      else if (req.method === 'GET' && m[2] === 'used') {
        const kind = url.searchParams.get('kind') ?? undefined;
        send(200, { used: whereUsed(store, url.searchParams.get('name') ?? '', kind as TargetKind | undefined) });
      }
      else if (req.method === 'GET' && m[2] === 'graph') send(200, reviewGraph(store));
      else if (m[2] === 'import-tables') send(200, await importTablesRoute(req, url.searchParams, store, privileges, session));
      else if (m[6] && m[7] === 'history') {
        // Every save of one layout, for its Versions list (the file's history keeps only the latest changes).
        if (req.method !== 'GET') throw new ApiError(3, 'Command is unavailable', 405);
        send(200, { history: store.layoutHistory(Number(m[6])) });
      }
      else if (m[6] && (req.method === 'GET' || req.method === 'POST')) {
        // The layout linter, on the saved design or (POST {design}) on what the editor has open.
        const stored = store.design(Number(m[6]));
        if (!stored) throw new ApiError(105, `Layout ${m[6]} has no design`, 404);
        const body = req.method === 'POST' ? await readJson(req) : {};
        const given = body.design as Partial<LayoutDesign> | undefined;
        if (given !== undefined && (typeof given !== 'object' || (given.objects !== undefined && !Array.isArray(given.objects)) || (given.parts !== undefined && !Array.isArray(given.parts)))) throw new ApiError(960, 'Send {"design": {parts, objects, ...}}', 400);
        const open = body.design && typeof body.design === 'object' ? { ...stored, ...(body.design as Partial<LayoutDesign>), id: stored.id, name: stored.name } : stored;
        if (m[7] === 'phone') {
          // What a phone layout made from what is open shows, and the phone layout already made from it (whether it still follows it).
          const made = store.designs().layouts.find((l) => l.phone?.of === stored.id);
          const existing = made && { id: made.id, name: made.name, following: made.phone?.synced === phoneFingerprint(made), design: made };
          send(200, { phone: { ...open, ...phoneDesign(open, made?.phone?.width ?? PHONE_WIDTH) }, ...(existing ? { existing } : {}) });
        } else if (m[7] === 'speed') {
          if (req.method !== 'POST') throw new ApiError(3, 'Command is unavailable', 405);
          send(200, await this.speed(store, session, stored.id, body.ai === true, req));
        } else if (m[7] === 'fix') {
          // Fix: Check's mechanical findings mended on what is open (all of them, or {"only": [{rule, objectIds}]}); nothing is saved.
          if (req.method !== 'POST') throw new ApiError(3, 'Command is unavailable', 405);
          const only = Array.isArray(body.only) ? (body.only as { rule?: unknown; objectIds?: unknown }[])
            .filter((w) => w && typeof w.rule === 'string' && Array.isArray(w.objectIds))
            .map((w) => ({ rule: w.rule as LintIssue['rule'], objectIds: (w.objectIds as unknown[]).filter((x): x is number => Number.isInteger(x)) })) : undefined;
          const { design, fixed, changes } = fixLayout(open, store.schema, store.privilegeSets(), only);
          // Changes outside the layout (a field's indexing) are the editor's to apply; the remaining findings assume they were.
          const after = changes.length ? store.checkDesign(changes).schema : store.schema;
          send(200, { design, fixed, changes, issues: lintLayout(design, after, store.privilegeSets(), storeStats(store)) });
        } else send(200, { issues: lintLayout(open, store.schema, store.privilegeSets(), storeStats(store)) });
      }
      else if (req.method === 'GET' && m[5]) {
        const theme = store.designs().themes.find((t) => t.id === Number(m[5]));
        if (!theme) throw new ApiError(960, `Theme ${m[5]} is missing`, 404);
        send(200, { theme });
      }
      else if (req.method === 'GET' && m[3]) {
        const stored = store.design(Number(m[3]));
        if (!stored) throw new ApiError(105, `Layout ${m[3]} has no design`, 404);
        // Single-step buttons read from the file get their step as a script line, for the editor.
        const design = structuredClone(stored);
        const lines = (objs: LayoutObject[]) => {
          for (const o of objs) {
            if (o.action && o.action.stepId !== 1 && o.action.line === undefined) o.action.line = stepLine(o.action.step, o.action.params);
            if (o.children) lines(o.children);
          }
        };
        lines(design.objects);
        send(200, { design });
      } else if (req.method === 'GET' && !m[2]) send(200, designOf(store, this.host.names(), other));
      else if (req.method === 'POST' && !m[2]) {
        const body = await readJson(req);
        if (!Array.isArray(body.changes)) throw new ApiError(960, 'Send {"changes": [...]}', 400);
        if (url.searchParams.get('preview') === '1') {
          send(200, previewDesign(store, body.changes as DesignOp[], { readOtherFile: mayDesign }));
          return true;
        }
        const requested = body.changes as DesignOp[];
        const canonicalLayout = (layout: LayoutDesign): string => {
          const copy = structuredClone(layout);
          const walk = (objects: LayoutObject[]) => objects.forEach((o) => {
            if (o.action) delete o.action.line;
            if (o.children) walk(o.children);
          });
          walk(copy.objects);
          return JSON.stringify(copy);
        };
        for (const change of requested) {
          if (change.op !== 'updateLayout' || !change.expectedDesign) continue;
          const current = store.design(change.layout as string | number);
          if (!current || canonicalLayout(current) !== canonicalLayout(change.expectedDesign)) {
            throw new ApiError(409, 'This layout changed while you were editing it. Review the latest version before saving.', 409);
          }
        }
        // expectedDesign is a transport precondition, not part of the persisted operation/history.
        const changes = requested.map((change) => {
          if (change.op !== 'updateLayout' || !change.expectedDesign) return change;
          const { expectedDesign: _expectedDesign, ...operation } = change;
          return operation as DesignOp;
        });
        const before = layoutsBefore(store, changes);
        const orders = ordersBefore(store, changes);
        const { applied } = store.applyDesign(changes, { account: session.account, readOtherFile: mayDesign });
        const undo = undoChanges(applied, before, orders);
        send(200, { applied, ...(undo ? { undo } : {}), design: designOf(store, this.host.names(), other) });
      } else throw new ApiError(3, 'Command is unavailable', 405);
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof StoreError || e instanceof DesignError ? new ApiError(e.code, e.message, 400) : new ApiError(-1, 'Unknown error');
      if (!(e instanceof URIError) && !(e instanceof ApiError) && !(e instanceof StoreError) && !(e instanceof DesignError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message } });
    }
    return true;
  }
}

/**
 * A script's timings placed on the lines of its text in the editor: `at` is each timed step's first line.
 * Timings are kept by step position, so a step changed or moved since it was timed is left out and counted
 * in `changed`.
 */
export function placeSteps(script: { steps: { name: string; line?: string; enabled: boolean; stepId: number; params?: unknown; text?: string }[] }, p: ReturnType<Profiler['script']>) {
  if (!p) return null;
  const at: number[] = [];
  let line = 1;
  for (const s of script.steps) {
    at.push(line);
    line += scriptText([s as Parameters<typeof scriptText>[0][number]]).split('\n').length;
  }
  const steps = p.steps.flatMap((st) => {
    const now = script.steps[st.index];
    return now && (now.line ?? now.name) === st.line ? [{ ...st, at: at[st.index] }] : [];
  });
  return { ...p, steps, changed: p.steps.length - steps.length };
}

/**
 * A script as each save left it, oldest first, from the design history (createScript, and updateScript
 * changes that gave its steps; a rename alone is no new version), as text, with who saved it and when.
 * Saves before Tabularius (in FileMaker) aren't in the history, so the first version is the first save here.
 */
export function scriptVersions(store: Store, id: number): { seq: number; at: string; account: string | null; text: string }[] {
  const out: { seq: number; at: string; account: string | null; text: string }[] = [];
  for (const e of store.scriptHistory(id)) {
    const op = e.op as { steps?: unknown };
    if (!Array.isArray(op.steps)) continue;
    out.push({ seq: e.seq, at: e.at, account: e.account, text: scriptText(op.steps as Parameters<typeof scriptText>[0]) });
  }
  return out;
}

const count = (d: { changes: { records: { kind: string }[] } }, kind: string) => d.changes.records.filter((r) => r.kind === kind).length;


/** A case's expectations with what the run did in place of each one it missed (runScriptTests' failure names). */
export function asRuns(expect: ScriptTestExpect, failures: { what: string; actual: string }[]): ScriptTestExpect | undefined {
  // A variable or field named like one of the run's own checks can't be told apart from it.
  const own = new Set(['result', 'error', 'found count', 'layout']);
  if ([...Object.keys(expect.variables ?? {}), ...Object.keys(expect.fields ?? {})].some((k) => own.has(k))) return undefined;
  const out: ScriptTestExpect = JSON.parse(JSON.stringify(expect));
  for (const f of failures) {
    if (f.what === 'result') out.result = f.actual;
    else if (f.what === 'error') out.error = Number(f.actual) || 0;
    else if (f.what === 'found count') out.foundCount = Number(f.actual) || 0;
    else if (f.what === 'layout') out.layout = f.actual;
    else if (out.variables && f.what in out.variables) out.variables[f.what] = f.actual;
    else if (out.fields && f.what in out.fields) out.fields[f.what] = f.actual;
  }
  return out;
}
