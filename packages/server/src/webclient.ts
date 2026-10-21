// The web client: static files under /app/, and the layout designs it draws.
//
//   GET /app/...                                         the browser app (packages/web)
//   GET /tabularius/app/v1/databases/{db}/layouts           layout menu (folders, order)
//   GET /tabularius/app/v1/databases/{db}/layouts/{layout}  design, theme, fields, value lists
//   GET /tabularius/images/{db}/{id}?sig=                   image library (signed, for <img>)
//   POST /tabularius/app/v1/databases/{db}/layouts/{layout}/view     hide conditions, tooltips, placeholders
//   POST /tabularius/app/v1/databases/{db}/layouts/{layout}/records  records by id (a script's found set)
//   POST /tabularius/app/v1/databases/{db}/layouts/{layout}/button   run a button's script
//   POST /tabularius/app/v1/databases/{db}/layouts/{layout}/explain  why a field shows its value (formula, inputs, relationship), no AI
//   POST /tabularius/app/v1/databases/{db}/runs/{run}/file            answer a script that asks for a file, or Continue/Cancel a paused one
//   POST /tabularius/app/v1/databases/{db}/runs/stop                  stop this session's running scripts (unless Allow User Abort is off)
//   GET  /tabularius/app/v1/databases/{db}/prefs                       this account's saved finds, saved sorts and recent records
//   PUT  /tabularius/app/v1/databases/{db}/prefs/{finds|sorts|recent}  keeps one of them ({ value })
//
// A button's script that reaches Insert File without a stored path pauses and
// answers with `waiting: { run, step, title }` and the actions so far. The
// client answers it with { filename, data (base64) } or { cancel: true } (or a
// multipart "upload" part), and gets the rest of the run, which may ask again.
// Pause/Resume Script waits the same way (step "Pause", answered with {} or
// { cancel: true }), as does Show Custom Dialog (step "Dialog", with title,
// message, buttons and inputs; answered with { button, inputs }) and Sort
// Records with its dialog (step "Sort", answered with { sort: [...] }).
// An unanswered run is canceled after 10 minutes.
//
// Records go through the Data API (/fmi/data/...), with the same session token.
// The app is TypeScript; Node strips the types as it serves each module, so
// there is no build step.

import { parseRequestJson } from './request-json.ts';
import type { SqlValue } from '../../store/src/find.ts';
import { SERVER_VERSION, serverCommit } from './version.ts';
import { ReadAudit } from './read-audit.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { explainAccessDenial, fmpXmlResult, fmpXmlHeader, fmpXmlRow, fmpXmlFooter, formulaGuard, PendingApprovalError, PrivilegeError, StoreError, ExplainRelatedError, writer, canCreateRelated, explainField, explainRelated, occurrence, csvField, type EvaluateOptions, type FindRequest, type LayoutInfo, type Privileges, type SortSpec, type Store } from '../../store/src/index.ts';
import { externalFieldNames, type DeviceType, type CustomMenu, type Script, type CustomMenuItem, type LayoutDesign, type LayoutObject, type StepParams, type Theme, type TriggerMode } from '../../fmp12/src/index.ts';
import { asBoolean, asText, compile, num, text, type DeviceLocation, type Value } from '../../calc/src/index.ts';
import { randomBytes } from 'node:crypto';
import { captureDenial, DenialCollector, denialOperation } from './denial-audit.ts';
import { denialOf } from '../../store/src/access-denial.ts';
import { scriptDenial, ScriptError, clientWindow, clientWindowGet, importFileRowIterator, runScript, type ClientAction, type DialogRequest, type OpenWindow, type RunResult, type WindowState, type ClientCheckpoint } from '../../scripts/src/index.ts';
import { isoCell, xlsx, xlsxSheetNames, type XlsxOutCell } from '../../scripts/src/xlsx.ts';
import { aiRefusal } from './ai-access.ts';
import { ImportError, applyImport, applyImportAddStream, importFields, importMappedRows, planImport, replan, undoImport, type ImportMapper } from './import-mapping.ts';
import { AiLimitError, type FillInput } from './assistant.ts';
import { redactSecrets, secretName } from './ai-output.ts';
import { redactExplanation, redactRelated } from './mcp.ts';
import { recordHistory } from './record-history.ts';
import { ApiError, badPathError, multipartText, multipartUpload, readBody, readJson, recordJson, sessionPrivileges, type DataApi, type Session } from './dataapi.ts';
import { FAULT_MESSAGE, isFault, logFault } from './fault-log.ts';
import type { Host } from './host.ts';
import { requestHostName } from './public-origin.ts';
import { sendError } from './pages.ts';
import { loadAsset, sendAsset, type Asset } from './static-cache.ts';
import { Derived, WebBuild, staticImports, versionPage, versionScript } from './web-build.ts';
import { journalDeletes, journalFieldChange, snapshotField, snapshotFields, snapshotRows } from './cleanup.ts';
import { said } from './said.ts';

/** Titles of FileMaker's standard menus, by the "based on" id custom menus store. */
const MENU_TITLES: Record<number, string> = { 2: 'File', 3: 'Edit', 4: 'View', 5: 'Insert', 6: 'Format', 7: 'Records', 9: 'Window', 10: 'Requests', 0x33: 'Help' };

const WEB_ROOT = join(import.meta.dirname, '..', '..', 'web');

const ASK_IDLE_MS = 10 * 60_000;

/** A Scripts menu entry: a script, a folder of them (a submenu), or a separator. */
export type ScriptsMenuEntry = { name: string; id: number } | { name: string; items: ScriptsMenuEntry[] } | { separator: true };

/**
 * The Scripts menu: scripts in the file's order and folders, leaving out those (and
 * folders) with "Include in menu" unchecked and those the account can't run.
 */
export function scriptsMenu(store: Store, privileges: Privileges): ScriptsMenuEntry[] {
  const ids = new Set(store.schema.scripts.map((s) => s.id));
  const root: ScriptsMenuEntry[] = [];
  const stack: ScriptsMenuEntry[][] = [root];
  const seen = new Set<number>();
  let skipBelow = -1;
  for (const o of store.schema.scriptOrder) {
    // Scripts are 'item', or 'unknown' when the catalog entry has no kind byte.
    const isScript = (o.kind === 'item' || o.kind === 'unknown') && ids.has(o.id);
    if (isScript) seen.add(o.id);
    if (skipBelow >= 0 && o.depth > skipBelow) continue;
    skipBelow = -1;
    stack.length = Math.min(stack.length, o.depth + 1);
    const into = stack[stack.length - 1];
    if (o.hidden) {
      if (o.kind === 'folder') skipBelow = o.depth;
      continue;
    }
    if (o.kind === 'folder') {
      const items: ScriptsMenuEntry[] = [];
      into.push({ name: o.name, items });
      stack.push(items);
    } else if (o.kind === 'separator') {
      into.push({ separator: true });
    } else if (isScript && privileges.script(o.name) !== 'none') {
      into.push({ name: o.name, id: o.id });
    }
  }
  // Scripts the order doesn't name (a file without one) go at the end, as the Data API lists them.
  for (const sc of store.schema.scripts) if (!seen.has(sc.id) && privileges.script(sc.name) !== 'none') root.push({ name: sc.name, id: sc.id });
  const prune = (list: ScriptsMenuEntry[]): ScriptsMenuEntry[] => list
    .map((e) => ('items' in e ? { ...e, items: prune(e.items) } : e))
    .filter((e) => !('items' in e) || e.items.some((x) => !('separator' in x)));
  return prune(root);
}

/** Ids of the scripts the Scripts menu lists. */
function scriptsMenuIds(store: Store, privileges: Privileges): Set<number> {
  const out = new Set<number>();
  const walk = (list: ScriptsMenuEntry[]) => {
    for (const e of list) {
      if ('id' in e) out.add(e.id);
      else if ('items' in e) walk(e.items);
    }
  };
  walk(scriptsMenu(store, privileges));
  return out;
}

/** Records menu commands the button endpoint runs as one-step scripts (`command`). */
const COMMAND_STEPS: Record<string, { stepId: number; step: string; params?: StepParams }> = {
  'Duplicate Record': { stepId: 8, step: 'Duplicate Record/Request' },
  'Omit Record': { stepId: 25, step: 'Omit Record' },
  'Show Omitted Only': { stepId: 27, step: 'Show Omitted Only' },
  // The current record (`recordId`); the client asks first, as FileMaker does.
  'Delete Record': { stepId: 9, step: 'Delete Record/Request' },
  // Every record in the found set; the client asks first, as FileMaker does.
  'Delete All Records': { stepId: 10, step: 'Delete All Records' },
  // `count` records from the current one.
  'Omit Multiple': { stepId: 26, step: 'Omit Multiple Records' },
  // `field` ("Field" or "TO::Field") set in every record of the found set: to `value`, or with
  // `replaceWith` "serial" to serial numbers (`serial`: {initial, increment, update}; no initial
  // uses the field's entry options), or "calculation" to a `calculation`'s result (full access).
  'Replace Field Contents': { stepId: 91, step: 'Replace Field Contents' },
  // The match `field` whose lookups copy their values again, in every record of the found set.
  'Relookup Field Contents': { stepId: 40, step: 'Relookup Field Contents' },
  // Edit > Copy with no field active: the record's fields, tab-separated, for the person's clipboard.
  'Copy Record': { stepId: 101, step: 'Copy Record/Request' },
  // Edit > Find/Replace > Replace All: `find` replaced with `replace` in the `fields` named ("Field" or
  // "TO::Field"), in every record of the found set or (`currentRecord`) the current one, with `matchCase`, `wholeWords`.
  'Replace All': { stepId: 128, step: 'Perform Find/Replace' },
  // File > Save Records as PDF: the found set (or `records` "current") as printed, downloaded as `name`.
  'Save Records as PDF': { stepId: 144, step: 'Save Records as PDF' },
  // Find mode: the requests typed come with the command (`requests`).
  'Constrain Found Set': { stepId: 126, step: 'Constrain Found Set' },
  'Extend Found Set': { stepId: 127, step: 'Extend Found Set' },
};
const MAX_FILE = 50 * 1024 * 1024;
/** The most values of a list one page call returns. */
const VALUE_LIST_MAX = 5000;
/** What a WebDirect-style link may carry: a script name, a parameter and variables, each cut to this size. */
/** The triggers of File Options a client runs by name, and the option each one is. */
const FILE_TRIGGERS = { OnFirstWindowOpen: 'onFirstWindowOpen', OnLastWindowClose: 'onLastWindowClose', OnWindowOpen: 'onWindowOpen', OnWindowClose: 'onWindowClose' } as const;
const URL_SCRIPT_LIMIT = { name: 256, value: 10_000, variables: 20 };

type PickedFile = { filename: string; data: Uint8Array } | undefined;
/** What a running button script did next: finished, failed, or asked for a file. */
type Step = { done: RunResult } | { failed: unknown } | { ask: { title?: string; actions: ClientAction[] } } | { pause: { actions: ClientAction[]; state: WindowState } }
  | { checkpoint: { actions: ClientAction[]; state: WindowState } } | { dialog: DialogRequest } | { sort: { sort: SortSpec[]; actions: ClientAction[]; state: WindowState } }
  | { index: { field: string; values: string[]; actions: ClientAction[]; state: WindowState } }
  | { device: { type: DeviceType; camera?: 'back' | 'front'; actions: ClientAction[] } } | { locate: { actions: ClientAction[] } }
  | { clipboard: { actions: ClientAction[] } };

/** Insert from Device's answer: a photo, video, sound or signature, or a bar code's text. */
type DeviceAnswer = NonNullable<PickedFile> | { text: string };

/** Insert from Index's answer: the value picked from the index. */
type IndexAnswer = { picked: string };

/** Paste's answer: the text on the person's clipboard. */
type ClipboardAnswer = { pasted: string };

/** A person's answer to Show Custom Dialog: the button (1-3) and what they typed. */
type DialogAnswer = { button: number; inputs?: string[] };

/** A button's script, paused while a person picks a file. */
interface Paused {
  id: string;
  db: string;
  token: string;
  script: string;
  /** Actions already sent to the client. */
  sent: number;
  /** Answers the script: a file (or undefined, canceled) for Insert File; true (Continue) or false (Cancel) for a pause. */
  answer: (value: PickedFile | boolean | DialogAnswer | SortSpec[] | DeviceAnswer | DeviceLocation | IndexAnswer | ClipboardAnswer) => void;
  /** What the script is waiting for. */
  display?: Record<string, unknown>;
  waiting?: 'Insert File' | 'Pause' | 'Dialog' | 'Sort' | 'Index' | 'Device' | 'Location' | 'Checkpoint' | 'Clipboard';
  next: () => Promise<Step>;
  timer: NodeJS.Timeout;
  /** Nobody will answer: further requests for a file are canceled at once. */
  abandoned?: boolean;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

export class WebClient {
  private readonly host: Host;
  private readonly build = new WebBuild(WEB_ROOT);
  private readonly derived = new Derived();
  private readonly api: DataApi;
  private readonly paused = new Map<string, Paused>();
  /** Each session's running button scripts, by token and file, so the person can stop them (Allow User Abort). */
  private readonly running = new Map<string, Set<EventTarget>>();
  private readonly runningProgress = new Map<EventTarget, { operation: string; completed: number; total: number }>();
  /**
   * The timer each web client session's window has (Install OnTimer Script),
   * by session token: the client fires it by id, and only the script the
   * step named runs, with its parameter worked out each time.
   */
  private readonly timers = new Map<string, { id: string; db: string; scriptId: number; parameter?: string; file?: { id: number; name: string } }>();

  /** The assistant's column matching for imports, when it is on (index.ts sets it). */
  importMapper?: (store: Store, account: string) => ImportMapper;

  /** The assistant's Replace Field Contents with AI, when it is on (index.ts sets it). */
  aiFiller?: (store: Store, account: string) => (input: FillInput, signal?: AbortSignal) => Promise<Map<number, string | null>>;

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  /** Returns false when the request is not for the web client. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const collector = new DenialCollector('web', 'request');
    return denialOperation.run(collector, async () => {
      try { return await this.handleOperation(req, res, url); } finally { collector.flush(); }
    });
  }

  private async handleOperation(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    if (path === '/' && /text\/html/.test(req.headers.accept ?? '')) {
      res.writeHead(302, { location: '/app/' }).end();
      return true;
    }
    // Browsers ask for this on their own; the app's icon is an SVG.
    if (path === '/favicon.ico' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(302, { location: '/app/favicon.svg', 'cache-control': 'public, max-age=86400' }).end();
      return true;
    }
    // A WebDirect-style link, /fmi/webd/<file>?script=<name>&param=<text>&$name=<value>: the web client opens the file and, once
    // the person is signed in, runs the script if their privilege set has fmurlscript.
    const webd = /^\/fmi\/webd\/([^/]+)\/?$/.exec(path);
    if (webd && (req.method === 'GET' || req.method === 'HEAD')) {
      let db: string;
      try { db = decodeURIComponent(webd[1]); } catch { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('That file name is not valid.'); return true; }
      const to = new URLSearchParams({ db });
      const script = url.searchParams.get('script');
      if (script) {
        to.set('script', script.slice(0, URL_SCRIPT_LIMIT.name));
        const param = url.searchParams.get('param');
        if (param) to.set('param', param.slice(0, URL_SCRIPT_LIMIT.value));
        let n = 0;
        for (const [k, v] of url.searchParams) if (/^\$[^$\s]{1,100}$/.test(k) && n++ < URL_SCRIPT_LIMIT.variables) to.set(k, v.slice(0, URL_SCRIPT_LIMIT.value));
      }
      res.writeHead(302, { location: `/app/?${to}`, 'cache-control': 'no-store' }).end();
      return true;
    }
    if (path === '/app') {
      res.writeHead(301, { location: '/app/' }).end();
      return true;
    }
    if (path.startsWith('/app/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendError(req, res, 405, { allow: 'GET, HEAD' });
        return true;
      }
      await this.serveStatic(req, res, path.slice('/app/'.length) || 'index.html');
      return true;
    }
    // The alternative client (packages/web/next): its page lives at /next/, its modules and styles under /app/next/.
    if (path === '/next') {
      res.writeHead(301, { location: '/next/' }).end();
      return true;
    }
    if (path === '/next/') {
      await this.serveStatic(req, res, 'next/index.html');
      return true;
    }
    const img = /^\/tabularius\/images\/([^/]+)\/(\d+)$/.exec(path);
    if (img && req.method === 'GET') {
      const [db, id] = [decodeURIComponent(img[1]), Number(img[2])];
      const image = this.host.checkUrl(db, id, url.searchParams, 'image') ? this.host.get(db)?.image(id) : undefined;
      if (!image) {
        res.writeHead(404).end();
        return true;
      }
      res.writeHead(200, {
        'content-type': image.mime, 'content-length': image.data.length,
        'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=86400',
        // SVG icons are documents; keep them from running scripts.
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end(image.data);
      return true;
    }
    const stop = /^\/tabularius\/app\/v1\/databases\/([^/]+)\/runs\/stop$/.exec(path);
    if (stop) {
      this.stopRuns(req, res, decodeURIComponent(stop[1]));
      return true;
    }
    const progress = /^\/tabularius\/app\/v1\/databases\/([^/]+)\/runs\/progress$/.exec(path);
    if (progress) {
      this.progressRuns(req, res, decodeURIComponent(progress[1]));
      return true;
    }
    const ask = /^\/tabularius\/app\/v1\/databases\/([^/]+)\/runs\/([0-9a-f]+)\/file$/.exec(path);
    if (ask) {
      await this.answerFile(req, res, decodeURIComponent(ask[1]), ask[2]);
      return true;
    }
    const prefs = /^\/tabularius\/app\/v1\/databases\/([^/]+)\/prefs(?:\/([a-z]+))?$/.exec(path);
    if (prefs) {
      await this.prefs(req, res, decodeURIComponent(prefs[1]), prefs[2]);
      return true;
    }
    const m = /^\/tabularius\/app\/v1\/databases\/([^/]+)\/layouts(?:\/([^/]+)(?:\/(view|records|foundset|groups|charts|menus|button|index|position|export|import|undo-import|ai-replace|explain|history|revert|refresh|value-list))?)?$/.exec(path);
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
      const shown = clientWindow(req.headers['x-tabularius-window']);
      if (shown) session.window = shown;
      // Everything here runs with the account's privilege set, as the Data API does.
      const privileges = sessionPrivileges(store, session);
      if (m[2] !== undefined) privileges.checkLayout(decodeURIComponent(m[2]));
      if (m[3]) {
        if (req.method !== 'POST') throw new ApiError(3, 'Command is unavailable', 405);
        const layout = decodeURIComponent(m[2]);
        if (m[3] === 'import') {
          const info = store.layout(layout);
          const params = url.searchParams;
          const action = params.get('action');
          const pv = privileges.in(info.owner);
          const planning = params.get('preview') === '1' || params.get('plan') === '1';
          pv.checkImport(info.table, planning && action === null ? 'plan'
            : action === 'update' || action === 'replace' ? action : 'add', params.get('addRemaining') === '1');
          // The legacy mapping path always creates; only a column plan can update/replace.
          if (!planning && !params.get('columns')) pv.checkImport(info.table);
          const type = req.headers['content-type'] ?? '';
          const raw = await readBody(req, MAX_FILE);
          if (res.destroyed) return true;
          this.api.authorize(req, db);
          const active = new EventTarget();
          const controller = new AbortController();
          const stop = () => controller.abort();
          active.addEventListener('stop', stop);
          res.on('close', stop);
          const key = `${session.token}\u0000${store.name}`;
          const mine = this.running.get(key) ?? new Set<EventTarget>();
          this.running.set(key, mine.add(active));
          try {
            if (res.destroyed) return true;
            send(200, await this.importRecords(store, session, layout, multipartUpload(type, raw), url.searchParams, privileges, multipartText(type, raw, 'found'),
              controller.signal, (completed) => this.runningProgress.set(active, { operation: 'Import Records', completed, total: 0 })));
          } finally {
            res.off('close', stop);
            active.removeEventListener('stop', stop);
            mine.delete(active);
            this.runningProgress.delete(active);
            if (!mine.size && this.running.get(key) === mine) this.running.delete(key);
          }
          return true;
        }
        const body = await readJson(req);
        // Refresh Window resends the browser's full found set to preserve its order and selection.
        // Its JSON body is size-limited, and refresh caps the displayed-record response at 200.
        if (m[3] !== 'refresh') checkFoundIds(body);
        if (m[3] === 'undo-import') {
          try {
            send(200, undoImport(store, said(body.id), { privileges, account: session.account }));
          } catch (e) {
            if (e instanceof ImportError) throw new ApiError(3, e.message, 400);
            throw e;
          }
          return true;
        }
        if (m[3] === 'ai-replace') {
          const abort = new AbortController();
          res.on('close', () => { if (!res.writableEnded) abort.abort(); });
          send(200, await this.aiReplace(store, session, layout, body, privileges, AbortSignal.any([abort.signal, AbortSignal.timeout(AI_REPLACE_TIMEOUT)])));
          return true;
        }
        if (m[3] === 'export') {
          // Exports can be much larger than the server's heap. Send them a page at a time, respect socket
          // backpressure and accept Stop; a workbook needs its whole content for its encoder.
          if (body.format !== 'xlsx') {
            if (res.destroyed) return true;
            this.api.authorize(req, db);
            await this.streamExportRecords(store, session, layout, body, privileges, res);
            return true;
          }
          const file = this.exportRecords(store, layout, body, privileges);
          res.writeHead(200, {
            'content-type': file.type, 'content-length': file.data.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          });
          res.end(file.data);
          return true;
        }
        if (m[3] === 'refresh') send(200, writer.run({ ...writer.getStore(), globals: session.scripts }, () => this.refresh(store, session, layout, body, privileges)));
        else if (m[3] === 'view') send(200, this.view(store, session, layout, body, privileges));
        else if (m[3] === 'records') send(200, this.records(store, layout, body, privileges));
        else if (m[3] === 'groups') send(200, this.groups(store, layout, body, privileges));
        else if (m[3] === 'foundset') send(200, this.foundSetPortal(store, layout, body, privileges));
        else if (m[3] === 'charts') send(200, this.charts(store, session, layout, body, privileges));
        else if (m[3] === 'menus') send(200, this.menus(store, session, layout, body));
        else if (m[3] === 'index') send(200, this.index(store, layout, body, privileges));
        else if (m[3] === 'position') send(200, this.position(store, layout, body, privileges));
        else if (m[3] === 'explain') send(200, this.explain(store, session, layout, body, privileges));
        else if (m[3] === 'history') send(200, this.history(store, layout, body, privileges));
        else if (m[3] === 'value-list') send(200, this.valueListFor(store, body, privileges));
        else if (m[3] === 'revert') send(200, this.revert(store, session, layout, body, privileges));
        else send(200, await this.button(store, session, layout, body, privileges));
      } else {
        send(200, m[2] === undefined ? this.menu(store, privileges, session.account) : this.layout(store, decodeURIComponent(m[2]), privileges, session, requestHostName(req)));
      }
    } catch (e) {
      captureDenial(e);
      denialOperation.getStore()?.flush();
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof StoreError || e instanceof PrivilegeError ? new ApiError(e.code, e.message, 400, e.denial) : unknownError(e);
      if (!(e instanceof URIError) && !(e instanceof ApiError) && !(e instanceof StoreError) && !(e instanceof PrivilegeError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message, ...(err.denial ? { denial: explainAccessDenial(err.denial) } : {}) } });
    }
    return true;
  }

  /**
   * A value list by name, for a web viewer page (tabularius.valueList): the values to store, and the text to show when it
   * differs. A list of related values needs a record to start from, so it is empty here. Capped, as the lists a layout sends are not.
   */
  private valueListFor(store: Store, body: Record<string, unknown>, privileges: Privileges): { values: string[]; labels?: string[] } {
    const name = typeof body.name === 'string' ? body.name : '';
    const vl = store.schema.valueLists.find((v) => v.name.toLowerCase() === name.toLowerCase());
    if (!vl) throw new ApiError(108, `Value list "${name}" is missing`, 404);
    if (privileges.valueList(vl.name) === 'none') throw new ApiError(9, `Insufficient privileges to use the value list "${vl.name}"`, 403);
    const values: Record<number, string[]> = {};
    const labels: Record<number, string[]> = {};
    listItems(store, vl.id, undefined, privileges, values, labels);
    return { values: values[vl.id].slice(0, VALUE_LIST_MAX), ...(labels[vl.id] ? { labels: labels[vl.id].slice(0, VALUE_LIST_MAX) } : {}) };
  }

  /**
   * A record's history for the web client's History panel: who changed what and when, from where, newest first. The
   * record may be deleted (its history stays) if the account can view the whole table. Fields the account may not see
   * are left out.
   */
  private history(store: Store, layout: string, body: Record<string, unknown>, privileges: Privileges) {
    const recordId = Number(body.recordId);
    if (!Number.isInteger(recordId) || recordId < 1) throw new ApiError(5, 'Name a record', 400);
    const table = store.layout(layout).table;
    let exists = true;
    try {
      store.get(layout, recordId, 'us', undefined, privileges, { fields: [] });
    } catch (e) {
      if (!(e instanceof StoreError) || e.code !== 101) throw e;
      exists = false;
    }
    if (!exists && !privileges.full && privileges.table(table).view !== true) throw new StoreError(101, 'Record is missing');
    const limit = body.limit === undefined ? undefined : Number(body.limit);
    const h = recordHistory(store, table, recordId, {
      ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
      hideField: (f) => !privileges.full && privileges.field(table, f) === 'none',
      hideTable: (tn) => !privileges.full && privileges.table(tn).view !== true,
    });
    return { ...h, exists };
  }

  /**
   * Puts back what one audit entry changed (body: recordId, seq, and optionally fields to put back), as the account:
   * it can put back only what its privileges let it change by hand. Logged as a change that says which entry it reverts.
   */
  private revert(store: Store, session: Session, layout: string, body: Record<string, unknown>, privileges: Privileges) {
    const recordId = Number(body.recordId);
    const seq = Number(body.seq);
    if (!Number.isInteger(recordId) || !Number.isInteger(seq)) throw new ApiError(5, 'Name a record and the audit entry to put back', 400);
    const fields = body.fields === undefined ? undefined : Array.isArray(body.fields) ? body.fields.map(String) : undefined;
    if (body.fields !== undefined && !fields) throw new ApiError(5, 'fields is a list of field names', 400);
    return store.revertAuditEntry(layout, recordId, seq, { privileges, account: session.account, ...(fields ? { fields } : {}) });
  }

  /** A person's own saved finds, saved sorts and recent records in a file, kept with their account. */
  private async prefs(req: IncomingMessage, res: ServerResponse, db: string, key: string | undefined): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      // They're the person's own, for the web client: a token limited to reading or to some layouts gets none of them
      // (saved finds name other layouts and hold find criteria) and can't change them.
      if (session.readOnly || session.layoutScope) throw new ApiError(9, 'This token cannot use saved finds and sorts', 403);
      // Only while the account may still use this client, as every other request here checks.
      sessionPrivileges(store, session);
      if (req.method === 'GET' && key === undefined) {
        const kept = store.userPrefs(session.account);
        const out: Record<string, unknown> = {};
        for (const k of PREF_KEYS) {
          if (kept[k] === undefined) continue;
          try {
            const v = JSON.parse(kept[k]) as unknown;
            if (PREF_SHAPES[k](v)) out[k] = v;
          } catch { /* unreadable: as if never kept */ }
        }
        send(200, { prefs: out });
        return;
      }
      if (req.method !== 'PUT' || !key) throw new ApiError(3, 'Command is unavailable', 405);
      if (!PREF_KEYS.includes(key)) throw new ApiError(5, `Unknown preference "${key}"`, 400);
      const raw = (await readBody(req, MAX_PREF)).toString('utf8');
      let body: unknown;
      try {
        body = parseRequestJson(raw) as unknown;
      } catch {
        throw new ApiError(5, 'The body should be JSON', 400);
      }
      if (!isObject(body) || !Object.hasOwn(body, 'value')) throw new ApiError(5, 'The body should contain a value', 400);
      if (body.value !== null && !PREF_SHAPES[key](body.value)) throw new ApiError(5, `"${key}" isn't in the expected form`, 400);
      store.setUserPref(session.account, key, body.value === null ? undefined : JSON.stringify(body.value));
      send(200, {});
    } catch (e) {
      captureDenial(e);
      denialOperation.getStore()?.flush();
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof StoreError || e instanceof PrivilegeError ? new ApiError(e.code, e.message, 400, e.denial) : unknownError(e);
      if (!(e instanceof URIError) && !(e instanceof ApiError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message, ...(err.denial ? { denial: explainAccessDenial(err.denial) } : {}) } });
    }
  }

  /**
   * The file as the browser gets it. Read, type-stripped and hashed once, until the file changes; a script, and a page
   * naming scripts, also carry the build id on the files they reference (web-build.ts).
   */
  private async versioned(file: string, ext: string, id: string): Promise<Asset> {
    const strip = (bytes: Buffer) => stripTypeScriptTypes(bytes.toString('utf8'), { mode: 'strip' });
    const base = await loadAsset(file, ext === '.ts' ? strip : undefined);
    if (ext === '.ts' || (ext === '.js' && file !== join(WEB_ROOT, 'sw.js'))) return this.derived.get(file, id, base, () => versionScript(base.body.toString('utf8'), id));
    if (ext !== '.html') return base;
    return this.derived.get(file, id, base, () => versionPage(base.body.toString('utf8'), id, file, WEB_ROOT, async (module) => {
      // A module that can't be read is left to fail in the browser; it doesn't take the page down with it.
      const source = await loadAsset(module, strip).then((a) => a.body.toString('utf8'), () => '');
      return staticImports(source).map((rel) => join(dirname(module), rel));
    }));
  }

  private async serveStatic(req: IncomingMessage, res: ServerResponse, rel: string): Promise<void> {
    const file = normalize(join(WEB_ROOT, rel));
    const ext = extname(file);
    if (!file.startsWith(WEB_ROOT + sep) || !TYPES[ext]) {
      sendError(req, res, 404);
      return;
    }
    let asset: Asset;
    let id: string;
    try {
      id = await this.build.id();
      asset = await this.versioned(file, ext, id);
    } catch {
      sendError(req, res, 404);
      return;
    }
    // A script, style or image asked for with the current build id never changes under that URL (web-build.ts), so the
    // browser may keep it for good; the pages, the service worker and anything asked for without it are revalidated.
    const forever = ext !== '.html' && ext !== '.webmanifest' && file !== join(WEB_ROOT, 'sw.js')
      && new URL(req.url ?? '/', 'http://localhost').searchParams.get('v') === id;
    await sendAsset(req, res, {
      'content-type': TYPES[ext], 'cache-control': forever ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      // Web viewers draw a solution's HTML in frames; a frame can't navigate itself out to the network.
      // No other site may frame the app (clickjacking).
      // frame-src also names the https hosts an administrator let web viewers load (any file's; the client frames only its own file's).
      ...(ext === '.html' ? { 'x-frame-options': 'DENY', 'content-security-policy': `frame-src 'self' about: data: blob:${this.host.webViewerHostsAll([requestHostName(req)]).map((h) => ` https://${h}`).join('')}; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` } : {}),
    }, asset);
  }

  /** A field's index, for auto-complete: its values starting with `prefix`. */
  /**
   * Explain This Value without the assistant: the field's formula with every value it read, or the relationship a
   * related field or portal row follows. Formulas are the file's design and the trace reads any record, so only
   * sets that may see the design and read everything get it, as with the MCP explain_value tool.
   */
  private explain(store: Store, session: Session, layout: string, body: Record<string, unknown>, privileges: Privileges) {
    if (!canSeeDesign(privileges, session)) throw new ApiError(9, `The "${privileges.name}" privilege set can't see this file's formulas`, 403);
    const recordId = Number(body.recordId);
    const key = said(body.field).replace(/\(\d+\)$/, '');
    if (!Number.isInteger(recordId) || !key) throw new ApiError(5, 'Name a record and a field', 400);
    const rowId = body.row === undefined || body.row === '' ? undefined : Number(body.row);
    if (rowId !== undefined && !Number.isInteger(rowId)) throw new ApiError(5, 'The portal row should be a record id', 400);
    const info = store.layout(layout);
    store.get(layout, recordId, 'iso', undefined, privileges, { fields: [] });
    // Another hosted file's formulas and records are its own: its privileges must allow the same there.
    const mayRead = (other: Store) => {
      if (other !== store && !canSeeDesign(privileges.in(other), session)) throw new ApiError(9, `The "${privileges.in(other).name}" privilege set can't see the formulas of ${other.name}`, 403);
    };
    mayRead(info.owner);
    const account = privileges.account;
    const toName = key.includes('::') ? key.slice(0, key.indexOf('::')) : info.occurrence;
    const fieldName = key.replace(/^.*::/, '');
    const fieldOf = (owner: Store, tableName: string) => {
      const table = owner.schema.tables.find((t) => t.name === tableName);
      const f = table?.fields.find((x) => x.name.toLowerCase() === fieldName.toLowerCase());
      if (!table || !f) throw new ApiError(102, `${tableName} has no field named "${fieldName}"`, 400);
      return { table, f };
    };
    const occurrenceNamed = (name: string) => {
      const to = store.schema.tableOccurrences.find((t) => t.name === name);
      const occ = to && occurrence(store, to.id);
      if (!occ) throw new ApiError(102, `Table occurrence "${name}" is missing`, 400);
      mayRead(occ.store);
      return occ;
    };
    const related = (target: { portal?: string; field?: string }, candidate?: number) => {
      try {
        return redactRelated(explainRelated(store, info, recordId, target, { candidate, limit: 10 }));
      } catch (e) {
        if (e instanceof ExplainRelatedError) throw new ApiError(3, e.message, 400);
        throw e;
      }
    };
    // A field of the layout's own table, on this record.
    if (toName === info.occurrence) {
      const { table, f } = fieldOf(info.owner, info.table);
      return { field: redactExplanation(explainField(info.owner, table, f, { store: info.owner, table, row: info.owner.row(info, recordId) }, { account, privileges: privileges.in(info.owner) })) };
    }
    // A portal row: how the row's record relates to this one, and (for the portal's own fields) the field's formula on it.
    if (rowId !== undefined) {
      const portalName = typeof body.portal === 'string' ? body.portal : toName;
      const portal = info.plan?.portals.find((p) => p.name === portalName) ?? info.plan?.portals.find((p) => p.occurrence === portalName);
      if (!portal) throw new ApiError(102, `Portal "${portalName}" is not on this layout`, 400);
      const occ = occurrenceNamed(portal.occurrence);
      const relation = related({ portal: portal.name }, rowId);
      // A field from further along (a LineItems portal showing Products::Name) belongs to another record: the relationship says why the row is there.
      if (toName !== portal.occurrence || !relation.candidate?.related) return { related: relation };
      const { table, f } = fieldOf(occ.store, occ.table.name);
      const formula = f.calculation || f.kind === 'summary'
        ? redactExplanation(explainField(occ.store, table, f, { store: occ.store, table, row: occ.store.row(store.occurrenceInfo(occ), rowId) }, { account, privileges: privileges.in(occ.store) }))
        : undefined;
      return { related: relation, ...(formula ? { field: formula } : {}) };
    }
    // A related field outside a portal: the record it shows, found through the relationship.
    occurrenceNamed(toName);
    return { related: related({ field: key }) };
  }

  private index(store: Store, layout: string, body: Record<string, unknown>, privileges: Privileges) {
    if (typeof body.field !== 'string' || body.field === '') throw new ApiError(102, 'Field is missing', 400);
    const prefix = typeof body.prefix === 'string' ? body.prefix : '';
    const limit = Math.min(Math.max(1, Number(body.limit) || 50), 500);
    return { values: store.fieldIndex(layout, body.field, { prefix, limit, privileges }) };
  }

  /** The layout menu: FileMaker's order with folders, marking layouts that can be opened. */
  private menu(store: Store, privileges: Privileges, account?: string) {
    const open = new Set(store.layouts().map((l) => l.name));
    const order = store.schema.layoutOrder.length
      ? store.schema.layoutOrder
      : store.schema.layouts.map((l) => ({ id: l.id, name: l.name, kind: 'item' as const, depth: 0 }));
    // Layouts the privilege set has no access to are not listed at all.
    const layouts = order.filter((o) => o.kind !== 'item' || privileges.layout(o.name).layout !== 'none')
      .map((o) => ({ ...o, open: o.kind === 'item' && open.has(o.name) }));
    // File Options: the layout the file opens on, and its window script triggers.
    const options = store.schema.fileOptions;
    // The layout File Options stores for "Switch to layout". Whether the option is ticked isn't
    // decoded; FileMaker would otherwise reopen the last layout used, which a converted file doesn't know.
    // By id, so a layout renamed in design mode still opens.
    const start = (options?.openLayoutId !== undefined ? store.schema.layouts.find((l) => l.id === options.openLayoutId)?.name : undefined) ?? options?.openLayout;
    return {
      database: store.name,
      // For Help > About: shown to signed-in users only, not on the public health route.
      version: SERVER_VERSION,
      ...(serverCommit() ? { commit: serverCommit() } : {}),
      // For Insert > Current User Name.
      ...(account ? { account } : {}),
      // The Scripts menu of FileMaker's standard menus.
      scripts: scriptsMenu(store, privileges),
      layouts,
      ...(start && layouts.some((l) => l.open && l.name === start) ? { openLayout: start } : {}),
      ...(options?.onFirstWindowOpen ? { onFirstWindowOpen: true } : {}),
      ...(options?.onLastWindowClose ? { onLastWindowClose: true } : {}),
      ...(options?.onWindowOpen ? { onWindowOpen: true } : {}),
      ...(options?.onWindowClose ? { onWindowClose: true } : {}),
      // A file with menu sets can switch to one with Install Menu Set, even when it opens on the standard menus.
      ...(store.schema.customMenuSets?.length ? { customMenus: true } : {}),
      // Available menu commands for this account: the client offers fewer below 'all'.
      ...(privileges.menuCommands !== 'all' ? { menuCommands: privileges.menuCommands } : {}),
      // The set's "Allow printing" and "Allow exporting": the client leaves out the commands they cover.
      ...(!privileges.canPrint ? { printing: false } : {}),
      ...(!privileges.canExport ? { exporting: false } : {}),
    };
  }

  /**
   * The custom menu set in use: the one put in place for the window
   * (`installed`, kept by the client: by an Install Menu Set step, or by
   * going to a layout whose Layout Setup names a set), else the layout's own,
   * else the one the file opens with (File Options). Undefined for
   * FileMaker's standard menus (set 1).
   */
  private menuSet(store: Store, installed?: unknown, layout?: string): { menus: CustomMenu[]; byId: Map<number, CustomMenu> } | undefined {
    const s = store.schema;
    const sets = s.customMenuSets ?? [];
    const known = (x: unknown) => x === 1 || sets.some((m) => m.id === x);
    const own = layout === undefined ? undefined : layoutMenuSet(store, layout);
    const id = known(installed) ? (installed as number) : known(own) ? own : s.defaultMenuSetId;
    const set = id !== undefined && id !== null && id !== 1 ? sets.find((x) => x.id === id) : undefined;
    if (!set) return undefined;
    const byId = new Map((s.customMenus ?? []).map((m) => [m.id, m]));
    const menus = set.menuIds.map((id) => byId.get(id)).filter((m): m is CustomMenu => !!m);
    return { menus, byId };
  }

  /**
   * The custom menu bar for a record on a layout: each menu's title and
   * items, with title and "install when" formulas worked out for that record.
   * Built-in menus ([Format], [Window], ...) carry no items and are left out.
   */
  private menus(store: Store, session: Session, layout: string, body: Record<string, unknown>) {
    const set = this.menuSet(store, body.menuSet, layout);
    if (!set) return { standard: true, menus: [] };
    const recordId = num0(body.recordId);
    const w = { mode: String(body.mode ?? 'browse'), view: String(body.view ?? 'form'), foundCount: num0(body.foundCount), totalCount: num0(body.totalCount), number: num0(body.number) };
    // Every formula, worked out in one go.
    const formulas: string[] = [];
    const slot = (f: string | undefined) => (f === undefined ? -1 : formulas.push(f) - 1);
    type Item = { kind: CustomMenuItem['kind']; title?: number; when?: number; command?: string; run?: [number, number]; shortcut?: CustomMenuItem['shortcut']; builtin?: string; items?: Item[] };
    const build = (m: CustomMenu, seen: Set<number>): Item[] => m.items.map((it, i) => {
      const out: Item = { kind: it.kind, title: slot(it.title), when: slot(it.installWhen) };
      if (it.command) out.command = it.command;
      if (it.scriptId !== undefined) out.run = [m.id, i];
      if (it.shortcut) out.shortcut = it.shortcut;
      const sub = it.submenuId !== undefined ? set.byId.get(it.submenuId) : undefined;
      if (it.kind === 'submenu') {
        if (sub && sub.items.length && !seen.has(sub.id)) out.items = build(sub, new Set([...seen, sub.id]));
        else out.builtin = it.submenu ?? sub?.name;
      }
      return out;
    });
    const menus = set.menus.filter((m) => m.items.length).map((m) => ({ menu: m, when: slot(m.installWhen), items: build(m, new Set([m.id])) }));
    const values = formulas.length ? store.evaluateEach(layout, formulas, recordId, this.screen(store, session, layout, w)) : [];
    const shown = (i: number | undefined) => i === undefined || i < 0 || values[i] === undefined || asBoolean(values[i]!);
    const titled = (i: number | undefined) => (i === undefined || i < 0 || values[i] === undefined ? undefined : asText(values[i]!, store.dateOrder));
    const finish = (items: Item[]): unknown[] => items.filter((it) => shown(it.when)).map((it) => {
      const title = titled(it.title);
      return {
        kind: it.kind,
        ...(title !== undefined ? { title } : {}),
        ...(it.command ? { command: it.command } : {}),
        ...(it.run ? { run: it.run } : {}),
        ...(it.shortcut ? { shortcut: it.shortcut } : {}),
        ...(it.builtin ? { builtin: it.builtin } : {}),
        ...(it.items ? { items: finish(it.items) } : {}),
      };
    });
    return {
      menus: menus.filter((m) => shown(m.when)).map((m) => ({ title: MENU_TITLES[m.menu.basedOn ?? 0] ?? m.menu.name, items: finish(m.items) })),
    };
  }

  private layout(store: Store, name: string, privileges: Privileges, session: Session, host = '') {
    const info = store.layout(name);
    const design = info.layoutId !== undefined ? store.design(info.layoutId) : undefined;
    if (!design) throw new ApiError(105, `Layout "${name}" has no design`, 404);
    const theme = store.designs().themes.find((t) => t.id === design.themeId);

    // Images: signed URLs, so <img> can load them without the session token.
    const images: Record<number, string> = {};
    const valueLists: Record<number, string[]> = {};
    const valueListLabels: Record<number, string[]> = {};
    const recordValueLists = new Set<number>();
    const occurrences = new Set<number>();
    const styles = new Set<string>();
    const walk = (objs: LayoutObject[]) => {
      for (const o of objs) {
        for (const id of [o.imageId, o.icon?.imageId]) {
          if (id !== undefined) images[id] = `/tabularius/images/${encodeURIComponent(store.name)}/${id}?${this.host.signed(store.name, id, 'image')}`;
        }
        if (o.field) {
          occurrences.add(o.field.tableOccurrenceId);
          const vl = o.field.valueListId !== undefined ? store.schema.valueLists.find((v) => v.id === o.field!.valueListId) : undefined;
          if (vl && privileges.valueList(vl.name) !== 'none') {
            // Lists of related values depend on the record: the view gives them per record.
            if (vl.field?.relatedFromId !== undefined) recordValueLists.add(vl.id);
            else if (!(vl.id in valueLists)) listItems(store, vl.id, undefined, privileges, valueLists, valueListLabels);
          }
        }
        if (o.style.name) styles.add(o.style.name);
        if (o.children) walk(o.children);
      }
    };
    walk(design.objects);
    for (const p of design.parts) {
      if (p.style.name) styles.add(p.style.name);
    }

    // Field types for every occurrence the layout shows, so the client knows what it can edit.
    // Fields the account can't see are left out; ones it can only view are read-only.
    const fields: Record<string, { name: string; type: string; calculated: boolean; summary: boolean; global: boolean; masked?: boolean; readOnly?: boolean }[]> = {};
    for (const id of occurrences) {
      const occ = occurrence(store, id);
      if (!occ) continue;
      const pv = privileges.in(occ.store);
      fields[occ.to.name] = occ.table.fields.flatMap((f) => {
        const level = pv.fieldAccess(occ.table.name, f.name);
        if (level === 'none') return [];
        // A masked field is listed (the record carries its stand-in) but only as read-only text.
        return [{ name: f.name, type: f.type, calculated: f.kind === 'calculation', summary: f.kind === 'summary', global: !!f.options?.global, ...(level === 'masked' ? { masked: true } : {}), ...(level === 'viewOnly' || level === 'masked' || f.options?.autoEnter?.prohibitModification ? { readOnly: true } : {}) }];
      });
    }

    return {
      database: store.name,
      layout: { name, id: design.id, occurrence: info.occurrence, table: info.table, file: info.owner.name },
      fileMode: store.fileMode,
      scriptNetwork: this.host.scriptNetworkOn(store.name),
      // The https hosts this file's web viewers may load (the page's frame policy has them too).
      webViewerHosts: this.host.webViewerHostsOf(store, [host]).hosts,
      design: this.resolveDesign(store, design),
      // The width below which a layout with no breakpoint of its own stacks in one column (0: never).
      stackBelowDefault: this.host.config.responsiveStackBelow(),
      theme: theme && this.trimTheme(theme, styles),
      fields,
      valueLists,
      ...(Object.keys(valueListLabels).length ? { valueListLabels } : {}),
      ...(recordValueLists.size ? { recordValueLists: [...recordValueLists] } : {}),
      images,
      ...(canSeeDesign(privileges, session) ? { canSeeDesign: true } : {}),
      // Each portal says whether its relationship lets a new related record be added from its empty last row.
      // (and the account may create records in its table).
      portals: (info.plan?.portals ?? []).map((p) => {
        const occ = occurrence(store, p.occurrenceId);
        // A portal on the layout's own occurrence lists the window's found set (FileMaker's found-set portal).
        if (p.occurrenceId === info.plan!.occurrenceId) return { ...p, foundSet: true };
        const may = !!occ && privileges.in(occ.store).table(occ.table.name).create && canCreateRelated(store, info.plan!.occurrenceId, p.occurrenceId);
        // The table its rows belong to (and the file, when another one holds it), so a row can be opened as a record.
        const where = occ ? { table: occ.table.name, ...(occ.store !== store ? { file: occ.store.name } : {}) } : {};
        return { ...p, ...where, ...(may ? { create: true } : {}) };
      }),
      layouts: Object.fromEntries(store.layouts().filter((l) => privileges.layout(l.name).layout !== 'none').map((l) => [store.schema.layouts.find((x) => x.name === l.name)?.id, l.name])),
      ...(store.schema.pageSetup ? { pageSetup: store.schema.pageSetup } : {}),
      // Value lists the Sort dialog can order by (a custom order): those the account may see, not of related values.
      sortLists: store.schema.valueLists.filter((v) => v.field?.relatedFromId === undefined && privileges.valueList(v.name) !== 'none').map((v) => v.name),
    };
  }

  /** Get ( ) values a window knows, and the session's $$variables, for layout formulas. */
  private screen(store: Store, session: Session, layout: string, w: { mode?: string; view?: string; foundCount?: number; totalCount?: number; number?: number }): EvaluateOptions {
    return {
      account: session.account,
      // Hide conditions, tooltips, merges and the like are worked out as the account sees the data.
      privileges: sessionPrivileges(store, session),
      get: (name) => {
        switch (name.toLowerCase()) {
          case 'windowmode': return num(w.mode === 'find' ? 1 : w.mode === 'preview' ? 2 : 0);
          case 'foundcount': return w.foundCount === undefined ? undefined : num(w.foundCount);
          case 'totalrecordcount': return w.totalCount === undefined ? undefined : num(w.totalCount);
          case 'recordnumber': return w.number === undefined ? undefined : num(w.number);
          case 'layoutname': return text(layout);
          case 'layoutviewstate': return num(w.view === 'list' ? 1 : w.view === 'table' ? 2 : 0);
        }
        // Hide conditions like Get ( Device ) = 4 answer for the person's phone, not the server.
        return clientWindowGet(session.window, name.toLowerCase());
      },
      variable: (name, rep) => session.scripts.variables.get(name.toLowerCase())?.[rep - 1],
    };
  }

  /**
   * What a layout shows differently per record: hidden objects (hide
   * conditions), tooltips and placeholders. Objects in portals are evaluated
   * per portal row, in the row's context.
   */
  private view(store: Store, session: Session, layout: string, body: Record<string, unknown>, privileges: Privileges, context?: ClientCheckpoint, readAudit?: ReadAudit) {
    const info = store.layout(layout);
    const raw = info.layoutId !== undefined ? store.design(info.layoutId) : undefined;
    const design = raw && this.resolveDesign(store, raw);
    if (!design) throw new ApiError(105, `Layout "${layout}" has no design`, 404);
    const mode = body.mode === 'find' ? 'find' : 'browse';
    type Item = { id: number; kind: 'hide' | 'tooltip' | 'placeholder' | 'style' | 'label' | 'merge' | 'active' | 'web'; formula: string; index?: number; name?: string };
    const top: Item[] = [];
    // Merge fields in text: <<TO::Field>>, or a field of the layout's own table.
    const merges = (o: LayoutObject, into: Item[]) => {
      if (mode !== 'browse' || !o.text) return;
      for (const m of o.text.matchAll(/<<(ƒ:[\s\S]*?|[^<>]+)>>/g)) {
        const name = m[1];
        if (into.some((it) => it.kind === 'merge' && it.name === name)) continue;
        // Calculated text: <<ƒ:formula>> (FileMaker 2025), evaluated like a tooltip.
        if (name.startsWith('ƒ:')) {
          if (name.slice(2).trim()) into.push({ id: o.id, kind: 'merge', name, formula: name.slice(2) });
          continue;
        }
        // Merge variables: <<$$name>>.
        if (/^\$\$?[^\s$]/.test(name)) {
          into.push({ id: o.id, kind: 'merge', name, formula: name });
          continue;
        }
        const [to, field] = name.includes('::') ? [name.slice(0, name.indexOf('::')), name.slice(name.indexOf('::') + 2)] : [info.occurrence, name];
        const occId = store.schema.tableOccurrences.find((t) => t.name === to)?.id;
        const occ = occId !== undefined ? occurrence(store, occId) : undefined;
        const f = occ?.table.fields.find((x) => x.name === field);
        if (!occ || !f) continue;
        const denied = privileges.in(occ.store).field(occ.table.name, f.name) === 'none';
        into.push({ id: o.id, kind: 'merge', name, formula: denied ? '"<No Access>"' : `${to}::${field}` });
      }
    };
    const portals: { name: string; occurrenceId: number; items: Item[] }[] = [];
    const collect = (objs: LayoutObject[], into: Item[]) => {
      for (const o of objs) {
        if (o.hide && (mode === 'browse' || o.hide.inFind)) into.push({ id: o.id, kind: 'hide', formula: withSelf(o.hide.formula, o) });
        if (o.tooltip) into.push({ id: o.id, kind: 'tooltip', formula: withSelf(o.tooltip, o) });
        if (o.label) into.push({ id: o.id, kind: 'label', formula: o.label });
        if (o.activeSegmentFormula && mode === 'browse') into.push({ id: o.id, kind: 'active', formula: o.activeSegmentFormula });
        if (o.webUrl && mode === 'browse') into.push({ id: o.id, kind: 'web', formula: o.webUrl });
        merges(o, into);
        if (o.placeholder && mode === 'find') into.push({ id: o.id, kind: 'placeholder', formula: withSelf(o.placeholder, o) });
        // Conditional formatting shows in Browse mode, not in Find mode.
        if (mode === 'browse') o.conditions?.forEach((c, index) => into.push({ id: o.id, kind: 'style', formula: withSelf(c.formula, o), index }));
        if (o.portal && o.children && mode === 'browse') {
          const p = info.plan?.portals.find((x) => x.name === (o.name ?? o.portal!.tableOccurrence) || x.occurrenceId === o.portal!.tableOccurrenceId);
          const items: Item[] = [];
          collect(o.children, items);
          if (p && items.length) portals.push({ name: p.name, occurrenceId: p.occurrenceId, items });
        } else if (o.children) collect(o.children, into);
      }
    };
    collect(design.objects, top);
    // Placeholders show in empty fields in Browse mode too.
    if (mode === 'browse') {
      const walk = (objs: LayoutObject[]) => {
        for (const o of objs) {
          if (o.placeholder && !o.portal) top.push({ id: o.id, kind: 'placeholder', formula: withSelf(o.placeholder, o) });
          if (o.children && !o.portal) walk(o.children);
        }
      };
      walk(design.objects);
    }
    const apply = (items: Item[], values: (Value | undefined)[]) => {
      const out: { hidden: number[]; tooltips: Record<number, string>; placeholders: Record<number, string>; styles?: Record<number, number[]>; labels?: Record<number, string>; merges?: Record<string, string>; active?: Record<number, string>; web?: Record<number, string> } = { hidden: [], tooltips: {}, placeholders: {} };
      items.forEach((it, i) => {
        const v = values[i];
        if (v === undefined) return;
        if (it.kind === 'hide') {
          if (asBoolean(v)) out.hidden.push(it.id);
        } else if (it.kind === 'style') {
          if (asBoolean(v)) ((out.styles ??= {})[it.id] ??= []).push(it.index!);
        } else if (it.kind === 'label') (out.labels ??= {})[it.id] = asText(v, store.dateOrder);
        else if (it.kind === 'merge') (out.merges ??= {})[it.name!] = asText(v, store.dateOrder);
        else if (it.kind === 'active') (out.active ??= {})[it.id] = asText(v, store.dateOrder);
        else if (it.kind === 'web') (out.web ??= {})[it.id] = asText(v, store.dateOrder);
        else (it.kind === 'tooltip' ? out.tooltips : out.placeholders)[it.id] = asText(v, store.dateOrder);
      });
      return out;
    };
    const w = { mode, view: String(body.view ?? 'form'), foundCount: num0(body.foundCount), totalCount: num0(body.totalCount) };
    const formulas = top.map((x) => x.formula);
    if (mode === 'find' || !Array.isArray(body.records)) return { find: apply(top, store.evaluateEach(info, formulas, undefined, this.screen(store, session, layout, w))) };

    // Value lists of related values the layout's fields (outside portals) use.
    const related = new Set<number>();
    const lists = (objs: LayoutObject[]) => {
      for (const o of objs) {
        const vl = o.field?.valueListId !== undefined ? store.schema.valueLists.find((v) => v.id === o.field!.valueListId) : undefined;
        if (vl?.field?.relatedFromId !== undefined && privileges.valueList(vl.name) !== 'none') related.add(vl.id);
        if (o.children && !o.portal) lists(o.children);
      }
    };
    lists(design.objects);

    const audit = readAudit ?? new ReadAudit();
    const records: Record<string, unknown> = {};
    for (const r of (body.records as ({ id: unknown; number?: unknown } | null)[]).slice(0, 200)) {
      if (typeof r !== 'object' || r === null) continue;
      const id = Number(r.id);
      if (!Number.isInteger(id) || !store.canView(info, id, privileges)) continue;
      const screen = this.screen(store, session, layout, { ...w, number: num0(r.number) });
      const opts: EvaluateOptions = { ...screen,
        ...(context ? { get: (name) => screen.get?.(name) ?? context.get(name), variable: context.variable } : {}),
        ...(context && Object.keys(context.pending).length && id === context.state.recordId ? { row: store.previewRow(info, id, context.pending) } : {}) };
      // Local script variables in layout formulas are visible at a checkpoint too.
      const out: Record<string, unknown> = apply(top, store.evaluateEach(info, formulas, id, opts));
      if (formulas.length) audit.add(info.owner, info.table, [id]);
      if (related.size) {
        const values: Record<number, string[]> = {};
        const labels: Record<number, string[]> = {};
        for (const vl of related) listItems(store, vl, { info, recordId: id }, privileges, values, labels);
        out.valueLists = values;
        if (Object.keys(labels).length) out.valueListLabels = labels;
      }
      if (portals.length) {
        const rows: Record<string, Record<string, { hidden: number[]; styles?: Record<number, number[]>; labels?: Record<number, string>; merges?: Record<string, string>; active?: Record<number, string>; web?: Record<number, string>; tooltips: Record<number, string>; placeholders: Record<number, string> }>> = {};
        const rec = store.get(info, id, 'us', { ...Object.fromEntries(portals.map((p) => [p.name, { limit: 100 }])),
          ...(body.step === 'Refresh Object' || body.step === 'Set Web Viewer' ? this.displayPortals(body, id) : {}) }, privileges, { summaries: false, fresh: !!context, ...(opts.row ? { row: opts.row } : {}) });
        for (const p of portals) {
          const occ = occurrence(store, p.occurrenceId);
          if (!occ) continue;
          const pinfo: LayoutInfo = store.occurrenceInfo(occ);
          const pf = p.items.map((x) => x.formula);
          for (const row of rec.portalData?.[p.name] ?? []) {
            const state = apply(p.items, store.evaluateEach(pinfo, pf, Number(row.recordId), { ...opts,
              row: p.occurrenceId === info.plan?.occurrenceId && Number(row.recordId) === context?.state.recordId ? store.previewRow(info, Number(row.recordId), context.pending) : undefined }));
            (rows[p.name] ??= {})[row.recordId] = state;
            audit.add(pinfo.owner, pinfo.table, [Number(row.recordId)]);
          }
        }
        out.rows = rows;
      }
      records[id] = out;
    }
    if (!readAudit) audit.log(privileges);
    return { records };
  }

  /** Display identities supplied by the browser select rows, never bypass viewing privileges. */
  private displayPortals(body: Record<string, unknown>, id: number): Record<string, { ids: number[] }> {
    const parents = body.displayPortals as Record<string, Record<string, unknown>> | undefined;
    const shown = parents?.[id];
    if (!shown || typeof shown !== 'object') return {};
    return Object.fromEntries(Object.entries(shown).filter(([, ids]) => Array.isArray(ids)).map(([name, ids]) =>
      [name, { ids: (ids as unknown[]).map(Number).filter(Number.isInteger).slice(0, 1000) }]));
  }

  /** Explicit display refresh: fresh values and formulas, with the viewing account's privileges and unchanged found-set order. */
  private refresh(store: Store, session: Session, layout: string, body: Record<string, unknown>, privileges: Privileges, context?: ClientCheckpoint) {
    if (body.flushJoinResults === true && !context) store.flushJoinResults();
    // Flush external data is an empty operation: this host has no ESS/ODBC provider or cache.
    const info = store.layout(layout);
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : foundIds(store, layout, body, privileges);
    const found = new Set(ids);
    const current = Number(body.recordId);
    const sameLayout = !context || body.layoutId === info.layoutId;
    const shown = new Set<number>();
    if (sameLayout && Array.isArray(body.displayRecords)) {
      for (const value of body.displayRecords) {
        const id = Number(value);
        if (found.has(id)) shown.add(id);
        // Cap distinct matches: duplicates and nonmembers must not consume the limit.
        if (shown.size === 200) break;
      }
    }
    const at = Math.max(0, ids.indexOf(current));
    const reads = [...new Set([...shown, ...(!shown.size ? ids.slice(at - at % 50, at - at % 50 + 50) : []), ...(found.has(current) ? [current] : [])])].slice(0, 200);
    const rows = context && Object.keys(context.pending).length && found.has(current) ? new Map([[current, store.previewRow(info, current, context.pending)]]) : undefined;
    const requestedPortals: Record<string, Record<string, number[]>> = {};
    const records = reads.flatMap((id) => {
      const portals = sameLayout && (body.step === 'Refresh Object' || body.step === 'Set Web Viewer') ? this.displayPortals(body, id) : undefined;
      if (portals) requestedPortals[id] = Object.fromEntries(Object.entries(portals).map(([name, page]) => [name, page.ids]));
      return store.getMany(info, [id], ids, { privileges, fresh: true, rows, sort: sortOf(body.sort), ...(portals ? { portals } : {}) });
    }).map(recordJson);
    const audit = new ReadAudit();
    audit.add(info.owner, info.table, records.map((r) => Number(r.recordId)));
    for (const p of info.plan?.portals ?? []) {
      const occ = occurrence(store, p.occurrenceId);
      if (occ) audit.add(occ.store, occ.table.name, records.flatMap((r) => (r.portalData?.[p.name] ?? []).map((row) => Number(row.recordId))));
    }
    const viewBody = { ...body, displayPortals: sameLayout ? body.displayPortals : undefined, foundCount: ids.length, records: records.map((r) => ({ id: r.recordId, number: ids.indexOf(Number(r.recordId)) + 1 })) };
    const states = this.view(store, session, layout, viewBody, privileges, context, audit);
    const charts = this.charts(store, session, layout, { ...viewBody, records: records.map((r) => r.recordId), ids }, privileges, context, rows, audit).records;
    for (const [id, state] of Object.entries(states.records ?? {}) as [string, Record<string, unknown>][]) if (charts[id]) state.charts = charts[id];
    const foundRows: Record<string, ReturnType<Store['foundSetRows']> & { offset: number }> = {};
    for (const p of info.plan?.portals ?? []) {
      if (p.occurrenceId !== info.plan?.occurrenceId) continue;
      if (body.step === 'Refresh Portal' && body.objectId !== undefined) {
        const o = store.design(layout)?.objects.find((o) => o.id === body.objectId);
        if (o && (o.name ?? o.portal?.tableOccurrence) !== p.name) continue;
      }
      const range = sameLayout ? (body.foundPortalRanges as Record<string, { offset?: unknown; limit?: unknown }> | undefined)?.[p.name] : undefined;
      const offset = Math.max(1, num0(range?.offset) ?? 1);
      const limit = Math.min(1000, Math.max(1, num0(range?.limit) ?? 50));
      foundRows[p.name] = { ...store.foundSetRows(info, p.name, ids, { offset, limit }, { privileges, rows }), offset };
      audit.add(info.owner, info.table, foundRows[p.name].rows.map((r) => Number(r.recordId)));
    }
    audit.log(privileges);
    return { records, requestedPortals, states: states.records ?? {}, find: states.find, foundRows };
  }

  /** A script's found set (`ids`), in order: only the records the account can view, sorted by `sort` if given. */
  private foundIds(store: Store, layout: string, body: Record<string, unknown>, privileges: Privileges): number[] {
    checkFoundIds(body);
    const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map(Number).filter(Number.isInteger) : [];
    // Only records the account can view (a script's found set can hold others).
    const viewable = new Set(store.findIds(layout, { sort: sortOf(body.sort), privileges }));
    if (Array.isArray(body.sort) && body.sort.length) {
      // Sorting a script's found set: the same records, in the sort's order.
      const keep = new Set(ids);
      return [...viewable].filter((id) => keep.has(id));
    }
    return ids.filter((id) => viewable.has(id));
  }

  /** A page of records by id, in the given order (a found set a script left). */
  private records(store: Store, layout: string, body: Record<string, unknown>, privileges: Privileges) {
    const ids = this.foundIds(store, layout, body, privileges);
    const offset = Math.max(1, num0(body.offset) ?? 1);
    const limit = Math.min(500, Math.max(0, num0(body.limit) ?? 50));
    // Summary fields are over the script's found set; records deleted since are skipped.
    const rows = store.getMany(layout, ids.slice(offset - 1, offset - 1 + limit), ids, { privileges, layoutOnly: true, sort: sortOf(body.sort) });
    store.logRead(store.layout(layout).table, rows.map((r) => r.recordId), { privileges });
    const data = rows.map(recordJson);
    return { data, foundCount: ids.length, totalCount: store.find(layout, { limit: 0, privileges }).totalCount };
  }

  /**
   * Where a record is in a found set (0-based; -1 when it isn't in it), so the
   * window can stay on the record it was on after a sort moves it to a page it
   * hasn't loaded. The found set is a script's (`ids`) or a find (`query`, all
   * records without one), in `sort`'s order, as the account sees it.
   */
  private position(store: Store, layout: string, body: Record<string, unknown>, privileges: Privileges) {
    const id = Number(body.recordId);
    if (!Number.isInteger(id)) return { index: -1 };
    const ids = foundIds(store, layout, body, privileges);
    return { index: ids.indexOf(id) };
  }

  /**
   * A found-set portal's rows (a portal on the layout's own occurrence): the window's found set, named by its record
   * ids or the find that made it and its sort, a page at a time (at most 1000 rows).
   */
  private foundSetPortal(store: Store, layout: string, body: Record<string, unknown>, privileges: Privileges) {
    if (typeof body.portal !== 'string') throw new ApiError(960, 'portal is required', 400);
    const ids = foundIds(store, layout, body, privileges);
    // Resolve a displaced saved row in the same found set used to read it; zero proves it has left the set.
    if (typeof body.recordId === 'string') {
      const offset = ids.indexOf(Number(body.recordId)) + 1;
      const page = store.foundSetRows(layout, body.portal, ids, { offset: Math.max(1, offset), limit: offset ? 1 : 0 }, { privileges });
      const info = store.layout(layout);
      info.owner.logRead(info.table, page.rows.map((r) => Number(r.recordId)), { privileges });
      return { ...page, offset };
    }
    const offset = Math.max(1, num0(body.offset) ?? 1);
    const limit = Math.min(1000, Math.max(0, num0(body.limit) ?? 1000));
    const page = store.foundSetRows(layout, body.portal, ids, { offset, limit }, { privileges });
    const info = store.layout(layout);
    info.owner.logRead(info.table, page.rows.map((r) => Number(r.recordId)), { privileges });
    return page;
  }

  /**
   * Chart data for the records shown: each chart's titles, categories and
   * series values, worked out from its formulas on the current record, the
   * found set (per record, or per run of records with the same category), or
   * the records related to the current one. Charts in portals are not drawn.
   */
  private charts(store: Store, session: Session, layout: string, body: Record<string, unknown>, privileges: Privileges, context?: ClientCheckpoint, rows?: Map<number, Record<string, SqlValue>>, readAudit?: ReadAudit) {
    const info = store.layout(layout);
    const raw = info.layoutId !== undefined ? store.design(info.layoutId) : undefined;
    const design = raw && this.resolveDesign(store, raw);
    if (!design) throw new ApiError(105, `Layout "${layout}" has no design`, 404);
    const charts: LayoutObject[] = [];
    const walk = (objs: LayoutObject[]) => {
      for (const o of objs) {
        if (o.chart) charts.push(o);
        if (o.children && !o.portal) walk(o.children);
      }
    };
    walk(design.objects);
    const records: Record<string, Record<number, ChartData>> = {};
    if (!charts.length) return { records };
    const w = { mode: 'browse', view: String(body.view ?? 'form'), foundCount: num0(body.foundCount), totalCount: num0(body.totalCount) };
    // The found set, once: the client's record ids (a script's found set) or its find and sort.
    let found: number[] | undefined;
    const foundSet = () => {
      if (found) return found;
      const sort = sortOf(body.sort);
      const viewable = store.findIds(layout, { query: Array.isArray(body.ids) ? undefined : queryOf(body.query), sort, privileges, dateOrder: store.fileMode === 'native' ? 'ISO' : 'MDY' });
      if (Array.isArray(body.ids)) {
        const keep = new Set((body.ids as unknown[]).map(Number));
        found = viewable.filter((id) => keep.has(id));
      } else found = viewable;
      return (found = found.slice(0, 5000));
    };
    // A formula naming a field the account can't see gives no values.
    const self = store.calc.occurrence(info.occurrence);
    const names = self && store.calc.context(undefined, self.id).names;
    const visible = (formula: string | undefined) => {
      if (!formula) return false;
      let refs: { occurrence?: string; name: string }[];
      try {
        refs = compile(formula, names).fields;
      } catch {
        return false;
      }
      return refs.every((ref) => {
        const toId = store.schema.tableOccurrences.find((t) => t.name === (ref.occurrence ?? info.occurrence))?.id;
        const occ = toId !== undefined ? occurrence(store, toId) : undefined;
        const field = occ?.table.fields.find((f) => f.name.toLowerCase() === ref.name.toLowerCase());
        return !occ || !field || privileges.in(occ.store).field(occ.table.name, field.name) !== 'none';
      });
    };
    const list = (v: Value | undefined) => (v === undefined ? [] : asText(v, store.dateOrder).split(/\r\n|\r|\n/));
    const label = (v: Value | undefined) => (v === undefined ? undefined : asText(v, store.dateOrder).replace(/\r\n|\r/g, '\n'));
    const bound = (key: 'yMin' | 'yMax', v: Value | undefined) => {
      const n = v === undefined ? null : chartNumber(asText(v, store.dateOrder));
      return n === null ? {} : { [key]: n };
    };
    const ids = (Array.isArray(body.records) ? body.records as unknown[] : [undefined]).slice(0, body.step ? 200 : 50);
    const shared = new Map<number, (Value | undefined)[][]>();
    const audit = readAudit ?? new ReadAudit();
    const onRead = (owner: Store, table: string, ids: number[]) => audit.add(owner, table, ids);
    for (const r of ids) {
      const id = r === undefined || r === null ? undefined : Number(r);
      const recordId = id !== undefined && Number.isInteger(id) && store.canView(info, id, privileges) ? id : undefined;
      const screen = this.screen(store, session, layout, w);
      const opts: EvaluateOptions = { ...screen, privileges, rows, row: recordId === undefined ? undefined : rows?.get(recordId),
        ...(context ? { get: (name) => screen.get?.(name) ?? context.get(name), variable: context.variable } : {}) };
      const out: Record<number, ChartData> = {};
      for (const o of charts) {
        const c = o.chart!;
        const formulas = [c.categories, ...c.series.flatMap((x) => [x.data, x.x, x.sizes])];
        const usable = formulas.map((f) => (visible(f) ? f! : '""'));
        const [title, xTitle, yTitle, yMin, yMax, ...names] = store.evaluateEach(info, [c.title, c.xTitle, c.yTitle, c.yMin, c.yMax, ...c.series.map((x) => x.name)].map((f) => (visible(f) ? f! : '""')), recordId, opts);
        // Columns of values: one list per formula.
        let columns: string[][];
        if (c.source === 'record') {
          columns = store.evaluateEach(info, usable, recordId, opts).map(list);
          if (recordId !== undefined) audit.add(info.owner, info.table, [recordId]);
        } else {
          let rows: (Value | undefined)[][];
          if (c.source === 'related') {
            rows = recordId === undefined || !c.occurrence ? [] : store.evaluateRows(info, usable, { recordId, related: c.occurrence }, { ...opts, privileges, onRead });
          } else {
            rows = shared.get(o.id) ?? store.evaluateRows(info, usable, { ids: foundSet(), groupBy: c.grouped && c.categories ? 0 : undefined }, { ...opts, onRead });
            shared.set(o.id, rows);
          }
          columns = usable.map((_, i) => rows.map((row) => (row[i] === undefined ? '' : asText(row[i]!, store.dateOrder))));
        }
        const numbers = (i: number) => columns[i].map(chartNumber);
        out[o.id] = {
          title: label(title), xTitle: label(xTitle), yTitle: label(yTitle),
          ...bound('yMin', yMin), ...bound('yMax', yMax),
          categories: c.categories ? columns[0] : [],
          series: c.series.map((x, i) => ({
            name: label(names[i]) ?? `Series ${i + 1}`,
            values: numbers(1 + 3 * i),
            ...(x.x ? { x: numbers(2 + 3 * i) } : {}),
            ...(x.sizes ? { sizes: numbers(3 + 3 * i) } : {}),
          })),
        };
      }
      records[recordId ?? ''] = out;
    }
    if (!readAudit) audit.log(privileges);
    return { records };
  }

  /**
   * Writes a CSV, tab, merge, XML or HTML export in bounded record batches. The run is registered for Stop and
   * reports progress, so a person can cancel a large export; a stopped export leaves a partial download.
   */
  private async streamExportRecords(store: Store, session: Session, layout: string, body: Record<string, unknown>, privileges: Privileges, res: ServerResponse): Promise<void> {
    if (!privileges.canExport) throw new ApiError(9, 'Insufficient privileges: this account may not export records', 403);
    const format = body.format === 'tab' || body.format === 'mer' || body.format === 'xml' || body.format === 'html' ? body.format : 'csv';
    const info = store.layout(layout);
    const fields = (Array.isArray(body.fields) ? body.fields : []).filter((f): f is string => typeof f === 'string' && !!f);
    if (!fields.length) throw new ApiError(3, 'Choose the fields to export', 400);
    const own = store.schema.tables.find((t) => t.name === info.table);
    const def = (f: string) => {
      const m = /^(.+?)::(.+)$/.exec(f);
      if (!m) return own?.fields.find((x) => x.name === f);
      const to = store.schema.tableOccurrences.find((t) => t.name === m[1]);
      return store.schema.tables.find((t) => t.id === to?.baseTableId)?.fields.find((x) => x.name === m[2]);
    };
    const kinds = fields.map((f) => def(f)?.type);
    const hasSummary = fields.some((f) => def(f)?.kind === 'summary');
    // The common "all records" text export walks the primary key in bounded pages.
    // A supplied found set, query or sort still uses its exact order, and so does a summary: a running total or a
    // fraction of the total differs from record to record, so each batch works its summaries out in the found set's order.
    // XML states its record count first, so it needs the ids up front.
    const text = format !== 'xml' && format !== 'html';
    const allInIdOrder = text && !('ids' in body) && !('query' in body) && !('sort' in body) && !hasSummary;
    const ids = allInIdOrder ? undefined : foundIds(store, layout, body, privileges);
    const sort = sortOf(body.sort);
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r\n|[\r\n]/g, '<br>');
    const cell = (v: string | number, i: number) => {
      const one = String(v).replace(/\r\n|[\r\n]/g, '\v');
      return format === 'tab' ? formulaGuard(one.replace(/\t/g, ' '), kinds[i]) : csvField(one, { quoteAll: true, type: kinds[i] });
    };
    const sepr = format === 'tab' ? '\t' : ',';
    const base = String(typeof body.name === 'string' && body.name.trim() ? body.name.trim() : layout).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    const total = ids?.length ?? 0;
    let offset = 0;
    let lastId = 0;
    let sent = 0;
    const audited: number[] = [];
    const nextBatch = (): string | undefined => {
      const chunk = ids
        ? ids.slice(offset, offset + 500)
        : store.selectIds(layout, { where: '_fm_record_id > ?', params: [lastId], limit: 500, privileges });
      if (!chunk.length) return undefined;
      offset += chunk.length;
      lastId = chunk[chunk.length - 1];
      const lines: string[] = [];
      // FileMaker XML says its dates are ISO (DATEFORMAT yyyy-MM-dd); the other types have them as the file shows them.
      for (const r of store.getMany(layout, chunk, ids ?? chunk, { privileges, sort, fields, ...(format === 'xml' ? { dateFormat: 'iso' as const } : {}) })) {
        const row = fields.map((f) => privileges.fieldAccess(info.table, f) === 'masked' ? '' : r.fieldData[f] ?? '');
        if (format === 'xml') lines.push(fmpXmlRow({ recordId: r.recordId, modId: 0, cells: row.map((v) => [String(v)]) }));
        else if (format === 'html') lines.push(`<tr>${row.map((v) => `<td>${esc(String(v))}</td>`).join('')}</tr>\n`);
        else lines.push(row.map(cell).join(sepr) + '\r\n');
        sent++;
        if (audited.length < 100) audited.push(Number(r.recordId));
      }
      return lines.join('');
    };
    // The first batch is read before any header goes out, so a record or field the account may not read is an
    // ordinary error response, as it is for the other formats; a later failure can only end the download early.
    let batch = nextBatch();
    // Stop: the run is registered under the session and file, as a button script is.
    const active = new EventTarget();
    const key = `${session.token}\u0000${store.name}`;
    const mine = this.running.get(key) ?? new Set<EventTarget>();
    if (res.destroyed) return;
    this.running.set(key, mine.add(active));
    let stopped = false;
    const stop = () => { stopped = true; };
    active.addEventListener('stop', stop);
    res.on('close', stop);
    res.writeHead(200, {
      'content-type': format === 'xml' ? 'application/xml; charset=utf-8' : format === 'html' ? 'text/html; charset=utf-8' : `${format === 'tab' ? 'text/tab-separated-values' : 'text/csv'}; charset=utf-8`,
      // Not compressed: the compressing wrapper takes every write at once, so a slow client could not hold the export back.
      'cache-control': 'no-store, no-transform',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.${format}`)}`,
    });
    this.runningProgress.set(active, { operation: 'Export Records', completed: 0, total });
    const write = async (chunk: string): Promise<boolean> => {
      if (stopped || res.destroyed) return false;
      if (!res.write(chunk)) {
        // Stop must release a write that is waiting for the client to drain.
        await new Promise<void>((resolve) => {
          const done = () => { res.off('drain', done); res.off('close', done); active.removeEventListener('stop', done); resolve(); };
          res.once('drain', done);
          res.once('close', done);
          active.addEventListener('stop', done, { once: true });
        });
      }
      return !stopped && !res.destroyed;
    };
    // What was read is logged however the download ends: finished, cut off by the client, stopped, or ended by a later batch failing.
    let failure: Error | undefined;
    let finished = false;
    try {
      let head: string;
      if (format === 'xml') head = fmpXmlHeader(store.name, fields.map((name, i) => ({ name, type: kinds[i] ?? 'text' })), total);
      else if (format === 'html') head = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${esc(info.table)}</title></head><body>\n<table border="1">\n<tr>${fields.map((f) => `<th>${esc(f)}</th>`).join('')}</tr>\n`;
      else head = (body.bom === true ? '﻿' : '') + (body.fieldNames === true || format === 'mer' ? fields.map((name) => cell(name, -1)).join(sepr) + '\r\n' : '');
      if (await write(head)) {
        while (batch !== undefined && !stopped && !res.destroyed) {
          if (batch && !(await write(batch))) break;
          this.runningProgress.set(active, { operation: 'Export Records', completed: ids ? Math.min(offset, total) : sent, total });
          // Other requests get their turn between batches, whatever the client's speed.
          await new Promise<void>((resolve) => setImmediate(resolve));
          if (stopped || res.destroyed) break;
          batch = nextBatch();
        }
        if (batch === undefined && !stopped && !res.destroyed) {
          finished = text || await write(format === 'xml' ? fmpXmlFooter() : '</table>\n</body></html>\n');
        }
      }
    } catch (e) {
      failure = e instanceof Error ? e : new Error(String(e));
    }
    try {
      store.logRead(info.table, audited, { privileges }, sent);
    } catch (e) {
      failure ??= e instanceof Error ? e : new Error(String(e));
    }
    res.off('close', stop);
    active.removeEventListener('stop', stop);
    mine.delete(active);
    this.runningProgress.delete(active);
    if (!mine.size && this.running.get(key) === mine) this.running.delete(key);
    if (failure) res.destroy(failure);
    else if (!finished || res.destroyed) res.destroy();
    else res.end();
  }

  /**
   * Export Records from the web client: the found set (a find, all records,
   * or a script's record ids, in the client's order), with the fields chosen,
   * as a file to download: comma- or tab-separated text or a merge file as
   * FileMaker writes it, an Excel workbook, FileMaker XML (FMPXMLRESULT) or
   * an HTML table. Only records and fields the account can see. With `bom`, text files start with a UTF-8 byte order mark.
   */
  private exportRecords(store: Store, layout: string, body: Record<string, unknown>, privileges: Privileges): { name: string; type: string; data: Uint8Array } {
    if (!privileges.canExport) throw new ApiError(9, 'Insufficient privileges: this account may not export records', 403);
    const format = ['tab', 'xlsx', 'mer', 'xml', 'html'].includes(String(body.format)) ? String(body.format) as 'tab' | 'xlsx' | 'mer' | 'xml' | 'html' : 'csv';
    const info = store.layout(layout);
    const fields = (Array.isArray(body.fields) ? body.fields : []).filter((f): f is string => typeof f === 'string' && !!f);
    if (!fields.length) throw new ApiError(3, 'Choose the fields to export', 400);
    const ids = foundIds(store, layout, body, privileges);
    const rows: (string | number)[][] = [];
    const recordIds: number[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      // FileMaker XML says its dates are ISO (DATEFORMAT yyyy-MM-dd); the other types have them as the file shows them.
      for (const r of store.getMany(layout, ids.slice(i, i + 500), ids, { privileges, sort: sortOf(body.sort), ...(format === 'xml' || format === 'xlsx' ? { dateFormat: 'iso' as const } : {}) })) {
        // Fields the account can't see are left out of fieldData, so they export empty; a masked field's stand-in is
        // not a value, so it exports empty too.
        rows.push(fields.map((f) => (privileges.fieldAccess(info.table, f) === 'masked' ? '' : r.fieldData[f] ?? '')));
        recordIds.push(r.recordId);
      }
    }
    store.logRead(info.table, recordIds, { privileges });
    // The type of each exported field, related ones too.
    const own = store.schema.tables.find((t) => t.name === info.table);
    const def = (f: string) => {
      const m = /^(.+?)::(.+)$/.exec(f);
      if (!m) return own?.fields.find((x) => x.name === f);
      const to = store.schema.tableOccurrences.find((t) => t.name === m[1]);
      return store.schema.tables.find((t) => t.id === to?.baseTableId)?.fields.find((x) => x.name === m[2]);
    };
    const base = String(typeof body.name === 'string' && body.name.trim() ? body.name.trim() : layout).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    if (format === 'xlsx') {
      // Dates, times and timestamps are Excel's own cell types (the values came as ISO text); the rest is as it was.
      const kinds = fields.map((f) => info.fields.find((x) => x.name === f)?.type);
      const cells = rows.map((row) => row.map((v, i): XlsxOutCell => {
        const kind = kinds[i];
        return typeof v === 'string' && v !== '' && (kind === 'date' || kind === 'time' || kind === 'timestamp') ? isoCell(v, kind) : v;
      }));
      const header = body.fieldNames === true;
      return { name: `${base}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: xlsx(header ? [fields, ...cells] : cells, info.table, { header }) };
    }
    if (format === 'xml') {
      // FMPXMLRESULT, which FileMaker's Import Records reads.
      const types = fields.map((f) => def(f)?.type ?? 'text');
      const xml = fmpXmlResult(store.name, fields.map((name, i) => ({ name, type: types[i] })), rows.map((row, k) => ({ recordId: recordIds[k], modId: 0, cells: row.map((v) => [String(v)]) })));
      return { name: `${base}.xml`, type: 'application/xml; charset=utf-8', data: Buffer.from(xml, 'utf8') };
    }
    if (format === 'html') {
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r\n|[\r\n]/g, '<br>');
      const html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${esc(info.table)}</title></head><body>\n<table border="1">\n<tr>${fields.map((f) => `<th>${esc(f)}</th>`).join('')}</tr>\n${rows.map((row) => `<tr>${row.map((v) => `<td>${esc(String(v))}</td>`).join('')}</tr>\n`).join('')}</table>\n</body></html>\n`;
      return { name: `${base}.html`, type: 'text/html; charset=utf-8', data: Buffer.from(html, 'utf8') };
    }
    // A value a spreadsheet would take for a formula gets an apostrophe in front, unless its field holds numbers or dates.
    const kinds = fields.map((f) => def(f)?.type);
    const cell = (v: string | number, i: number) => {
      const one = String(v).replace(/\r\n|[\r\n]/g, '\v'); // returns in a field export as vertical tabs, as in FileMaker
      return format === 'tab' ? formulaGuard(one.replace(/\t/g, ' '), kinds[i]) : csvField(one, { quoteAll: true, type: kinds[i] });
    };
    const sepr = format === 'tab' ? '\t' : ',';
    // A merge file always starts with the field names (Claris: "The first record is a header that lists the field names").
    const header = body.fieldNames === true || format === 'mer' ? [fields.map((name) => cell(name, -1)).join(sepr) + '\r\n'] : [];
    const lines = [...header, ...rows.map((row) => row.map(cell).join(sepr) + '\r\n')];
    // Excel on Windows takes UTF-8 text without a byte order mark for the local ANSI code page, so a name with an accent comes in garbled; with one it does not.
    const mark = body.bom === true ? '\ufeff' : '';
    return { name: `${base}.${format}`, type: `${format === 'tab' ? 'text/tab-separated-values' : 'text/csv'}; charset=utf-8`, data: Buffer.from(mark + lines.join(''), 'utf8') };
  }

  /**
   * Import Records from the web client: a comma- or tab-separated file, an
   * Excel workbook or FileMaker XML the person picked. With `preview`, the
   * fields it can go into and its first rows, to match columns to fields;
   * otherwise each row becomes a new record of the layout's table, with
   * column i going into `mapping[i]` (none: not imported), skipping the first
   * row when it holds field names. A row the account may not create, or that
   * fails validation, is skipped, as in FileMaker. Returns the new records.
   * With `plan` (and `ai` for the assistant's matching), the columns matched
   * to fields with fixes for their formats, a preview and the rows that repeat
   * records; with `columns` (that plan, as the person left it) the import
   * itself, kept so `undo-import` can take it back (import-mapping.ts).
   */
  private async importRecords(store: Store, session: Session, layout: string, file: { filename: string | null; data: Buffer }, params: URLSearchParams, privileges: Privileges, found?: string,
    signal?: AbortSignal, onProgress?: (completed: number) => void) {
    const info = store.layout(layout);
    const pv = privileges.in(info.owner);
    const targets = info.fields.filter((f) => !f.calculated && !f.summary && f.type !== 'container' && pv.field(info.table, f.name) === 'modifiable').map((f) => f.name);
    let rowIterator: Generator<(string | number)[]>;
    let rows: (string | number)[][] | undefined;
    // A workbook offers its sheets (the first is read unless `sheet` names another); text says when a quote it opened is never closed.
    const notices: string[] = [];
    let sheets: string[] | undefined;
    try {
      const worksheet = params.get('sheet') || undefined;
      rowIterator = importFileRowIterator(file.filename ?? '', file.data, undefined, undefined, { worksheet, notices });
      if (/\.xlsx$/i.test(file.filename ?? '')) sheets = xlsxSheetNames(file.data);
    } catch (e) {
      throw new ApiError(3, e instanceof Error ? e.message : String(e), 400);
    }
    if (params.get('preview') === '1') {
      const preview: (string | number)[][] = [];
      let count = 0;
      try {
        for (const row of rowIterator!) { if (preview.length < 3) preview.push(row); count++; }
      } catch (e) { throw new ApiError(3, e instanceof Error ? e.message : String(e), 400); }
      const about = { ...(notices.length ? { notices } : {}), ...(sheets ? { sheets, sheet: params.get('sheet') || sheets[0] } : {}) };
      return { fields: targets, rows: preview, count, ...about };
    }
    // Matched for the person to check: by name, or by the assistant when asked and allowed; then a preview with fixes and duplicates.
    const columns = params.get('columns');
    // FileMaker's import actions: Update and Replace work on the found set, of the records this account can see, in its order.
    const action = params.get('action') === 'update' || params.get('action') === 'replace' ? params.get('action') as 'update' | 'replace' : 'add';
    const about = () => ({ ...(notices.length ? { notices } : {}), ...(sheets ? { sheets, sheet: params.get('sheet') || sheets[0] } : {}) });
    const matchFields = (v: unknown) => {
      if (!Array.isArray(v)) throw new ImportError('Choose the fields to match records on');
      return v.filter((f): f is string => typeof f === 'string');
    };
    const target = () => {
      let body: unknown;
      try {
        body = parseRequestJson(found ?? '');
      } catch {
        throw new ImportError('The found set to update is missing');
      }
      if (!body || typeof body !== 'object') throw new ImportError('The found set to update is missing');
      return foundIds(store, layout, body as Record<string, unknown>, privileges);
    };
    try {
      if (params.get('plan') === '1') {
        const retained: (string | number)[][] = [];
        let sourceRows = 0;
        for (const row of rowIterator!) {
          if (signal?.aborted) throw new ImportError('Import preview was stopped');
          sourceRows++;
          if (retained.length < 20_001) retained.push(row);
          if (sourceRows % 500 === 0) {
            onProgress?.(sourceRows);
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
        const sampled = sourceRows > 20_000;
        rows = sampled ? retained.slice(0, 2000) : retained;
        const sized = <T extends { rows: number; headerRow: boolean }>(plan: T) => sampled
          ? { ...plan, rows: Math.max(0, sourceRows - Number(plan.headerRow)), sampledRows: rows!.length }
          : plan;
        if (!columns) {
          const off = params.get('ai') === '1' ? aiRefusal(store, { account: session.account, via: 'AI import matching' }) : undefined;
          const mapper = params.get('ai') === '1' && !off && privileges.has('fmmcp') ? this.importMapper?.(store, session.account) : undefined;
          const plan = await planImport(store, layout, rows, { privileges, mapper, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000) });
          return { ...sized(plan), ...about(), ...(params.get('ai') === '1' && !mapper ? { ai: { used: false, note: off ? `${off.startsWith('AI policy refused') ? off : off.replace(/:.*$/, '')}; matched by name` : 'The assistant is off here, or this account has no AI access; matched by name' } } : {}) };
        }
        // Update matches only the records of the found set, so its preview looks there.
        return { ...sized(replan(store, layout, rows, parseRequestJson(columns), privileges, action === 'update' ? target() : undefined)), ...about() };
      }
      if (columns) {
        const plan = parseRequestJson(columns) as Parameters<typeof applyImport>[3];
        const match = params.get('match');
        if (action === 'add') return applyImportAddStream(store, layout, rowIterator!, plan, {
          privileges, account: session.account, skipDuplicates: params.get('skipDuplicates') === '1', skipIssues: params.get('skipIssues') === '1', file: file.filename ?? undefined,
          signal, onProgress,
        });
        rows = [...rowIterator!];
        return applyImport(store, layout, rows, plan, {
          privileges, account: session.account, skipDuplicates: params.get('skipDuplicates') === '1', skipIssues: params.get('skipIssues') === '1', file: file.filename ?? undefined,
          action, target: target(), addRemaining: params.get('addRemaining') === '1',
          ...(action === 'update' ? { match: matchFields(match ? parseRequestJson(match) : plan.keys) } : {}),
        });
      }
    } catch (e) {
      if (e instanceof ImportError || e instanceof SyntaxError || e instanceof ScriptError) throw new ApiError(3, e.message, 400);
      throw e;
    }
    let mapping: unknown;
    try {
      mapping = parseRequestJson(params.get('mapping') ?? '[]');
    } catch {
      mapping = undefined;
    }
    if (!Array.isArray(mapping) || !mapping.some((f) => typeof f === 'string' && targets.includes(f))) throw new ApiError(3, 'Choose the fields to import into', 400);
    const into = mapping.map((f) => (typeof f === 'string' && targets.includes(f) ? f : undefined));
    try {
      return { ...await importMappedRows(store, layout, rowIterator!, into, { privileges, account: session.account, skipFirst: params.get('skipFirst') === '1', signal, onProgress }), ...about() };
    } catch (e) {
      if (e instanceof ScriptError) throw new ApiError(3, e.message, 400);
      throw e;
    }
  }

  /**
   * Replace Field Contents with AI (beyond FileMaker): the field gets, in each record of the found set, what the
   * assistant writes from the person's instruction and that record's values on the layout (only fields the account
   * can see; password, key and token fields left out). With `preview`, the value for one record, nothing written.
   * Otherwise each record is changed as the account and the change is journaled, so Undo puts the values back.
   */
  private async aiReplace(store: Store, session: Session, layout: string, body: Record<string, unknown>, privileges: Privileges, signal: AbortSignal) {
    const off = aiRefusal(store, { account: session.account, via: 'AI replace' });
    if (off) throw new ApiError(9, off, 403);
    if (!privileges.has('fmmcp')) throw new ApiError(9, `Insufficient privileges: the "${privileges.name}" privilege set needs the fmmcp extended privilege (AI access)`, 401, privileges.extendedDenial(['fmmcp']));
    const fill = this.aiFiller?.(store, session.account);
    if (!fill) throw new ApiError(3, 'The AI assistant is off on this server (start it with --ai and an API key)', 503);
    const info = store.layout(layout);
    // A field of the layout's own table the account may change: one that holds a value per record.
    const target = importFields(store, layout, privileges).find((f) => f.name === body.field && !f.global);
    if (!target || info.owner !== store) throw new ApiError(102, 'Choose a field of this layout\'s table that you can change', 400);
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (!instruction) throw new ApiError(3, 'Say what the field should hold', 400);
    if (instruction.length > 2000) throw new ApiError(3, 'Keep the instruction under 2,000 characters', 400);
    let ids: number[];
    if (body.preview === true) {
      const id = Number(body.recordId);
      if (!Number.isInteger(id) || !store.canView(layout, id, privileges)) throw new ApiError(101, 'Record is missing', 404);
      ids = [id];
    } else {
      ids = foundIds(store, layout, body, privileges);
      if (ids.length > MAX_AI_REPLACE) throw new ApiError(3, `AI can replace a field in up to ${MAX_AI_REPLACE.toLocaleString('en-US')} records at a time, and this found set has ${ids.length.toLocaleString('en-US')}. Narrow it with a find first`, 400);
    }
    // A field's type, the related ones' through their table occurrence, to leave out containers.
    const typeOf = (key: string) => fieldTypeOf(store, info, key);
    const field = { name: target.name, type: target.type, ...(target.values?.length ? { values: target.values.slice(0, 200) } : {}) };
    // What the model sees of a record: the layout's fields the account can see, never a secret.
    const shown = (fieldData: Record<string, unknown>) => Object.fromEntries(Object.entries(fieldData)
      .filter(([k, v]) => !secretName(k) && typeOf(k) !== 'container' && v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => [k, redactSecrets(String(v)).slice(0, AI_REPLACE_VALUE)]));
    // Batches of whole records, kept small enough for one request: up to 25 records or about 40,000 characters.
    const batches: FillInput['records'][] = [];
    for (let i = 0; i < ids.length; i += AI_REPLACE_BATCH) {
      for (const r of store.getMany(layout, ids.slice(i, i + AI_REPLACE_BATCH), ids, { privileges, layoutOnly: true, sort: sortOf(body.sort) })) {
        const record = { id: Number(r.recordId), values: shown(r.fieldData) };
        const size = JSON.stringify(record).length;
        const last = batches.at(-1);
        if (last && last.length < AI_REPLACE_BATCH && JSON.stringify(last).length + size < AI_REPLACE_CHARS) last.push(record);
        else batches.push([record]);
      }
    }
    const values = new Map<number, string | null>();
    let stopped: string | undefined;
    for (const records of batches) {
      try {
        for (const [id, v] of await fill({ field, instruction, records }, signal)) values.set(id, v);
      } catch (e) {
        if (signal.aborted) throw new ApiError(3, 'AI replace stopped before it finished; nothing was changed', 504);
        // A daily limit reached partway: what AI already wrote goes in, and the rest are left as they are.
        const why = isFault(e) ? (logFault(e), FAULT_MESSAGE) : (e as Error).message;
        if (!values.size) throw new ApiError(3, why, e instanceof AiLimitError ? 429 : 502);
        stopped = why;
        break;
      }
    }
    if (body.preview === true) return { value: values.get(ids[0]) ?? null };
    const snapshot = snapshotField(store, layout, target.name, ids);
    let changed = 0;
    const left: number[] = [];
    const skipped: { recordId: number; why: string }[] = [];
    for (const id of ids) {
      const v = values.get(id);
      if (v === null || v === undefined) {
        left.push(id);
        continue;
      }
      try {
        // The model answers in the format shown by this file's client.
        store.update(layout, id, { [target.name]: v }, undefined, { privileges, account: session.account, dateOrder: store.fileMode === 'native' ? 'ISO' : 'MDY' });
        changed++;
      } catch (e) {
        if (!(e instanceof StoreError || e instanceof PrivilegeError || e instanceof PendingApprovalError)) throw e;
        skipped.push({ recordId: id, why: e.message });
      }
    }
    const batch = snapshot ? journalFieldChange(store, snapshot, session.account, (n) => `AI replaced ${target.name} in ${n} record${n === 1 ? '' : 's'}`) : undefined;
    return { changed, left: left.length, skipped, ...(stopped ? { stopped } : {}), ...(batch ? { undo: { id: batch.id, summary: batch.summary, kind: 'replace' } } : {}) };
  }

  /**
   * Sub-summary groups of a sorted found set (a find, all records, or a
   * script's record ids): for each of the given sort fields, the runs of
   * records it groups, with the layout's summary fields over each run.
   */
  private groups(store: Store, layout: string, body: Record<string, unknown>, privileges: Privileges) {
    const sort = sortOf(body.sort) ?? [];
    // Summaries only over fields and records the account can see.
    const info = store.layout(layout);
    const pv = privileges.in(info.owner);
    const fields = Array.isArray(body.fields)
      ? (body.fields as unknown[]).filter((f): f is string => typeof f === 'string' && pv.field(info.table, f) !== 'none')
      : [];
    if (!sort.length || !fields.length) return { groups: [] };
    const viewable = store.findIds(layout, { query: Array.isArray(body.ids) ? undefined : queryOf(body.query), sort, privileges, dateOrder: store.fileMode === 'native' ? 'ISO' : 'MDY' });
    let ids = viewable;
    if (Array.isArray(body.ids)) {
      const keep = new Set((body.ids as unknown[]).map(Number));
      ids = viewable.filter((id) => keep.has(id));
    }
    const groups = store.groupSummaries(layout, ids, fields, 'us', privileges);
    info.owner.logRead(info.table, ids, { privileges });
    return { groups };
  }

  /**
   * Runs the script of a button, as clicking it in FileMaker would: on the
   * button's record (or portal row) with the client's found set, with the
   * button's script parameter evaluated in that context.
   */
  private async button(store: Store, session: Session, layout: string, body: Record<string, unknown>, privileges: Privileges) {
    const info = store.layout(layout);
    const raw = info.layoutId !== undefined ? store.design(info.layoutId) : undefined;
    const design = raw && this.resolveDesign(store, raw);
    const find = (objs: LayoutObject[]): LayoutObject | undefined => {
      for (const o of objs) {
        if (o.id === body.objectId) return o;
        const c = o.children && find(o.children);
        if (c) return c;
      }
      return undefined;
    };
    const obj = design && body.objectId !== undefined ? find(design.objects) : undefined;
    // A button's script, or a script trigger's (on the object, or on the layout without an object).
    const event = typeof body.trigger === 'string' ? body.trigger : undefined;
    // The file's own triggers (File Options) run whatever the layout.
    const fileTrigger = body.objectId === undefined && event !== undefined && Object.hasOwn(FILE_TRIGGERS, event)
      ? store.schema.fileOptions?.[FILE_TRIGGERS[event as keyof typeof FILE_TRIGGERS]]
      : undefined;
    // A custom menu item that runs a script: [menu id, item index], in the file's menu set.
    const menuItem = Array.isArray(body.menuItem) ? this.menuItem(store, body.menuItem as unknown[], body.menuSet, layout) : undefined;
    if (Array.isArray(body.menuItem) && !menuItem) throw new ApiError(3, 'That menu item does not run a script', 400);
    // An installed OnTimer script, by the id the client was given for it.
    const timer = body.timer !== undefined ? this.timers.get(session.token) : undefined;
    if (body.timer !== undefined && (!timer || timer.id !== body.timer || timer.db !== store.name)) throw new ApiError(3, 'That timer is no longer installed', 400);
    // A script chosen from the Scripts menu: only those the menu lists ("Include in menu", privileges).
    const listed = body.scriptId !== undefined ? scriptsMenuIds(store, privileges).has(Number(body.scriptId)) : false;
    if (body.scriptId !== undefined && !listed) throw new ApiError(3, 'That script is not in the Scripts menu', 400);
    const scriptsMenuItem = listed ? { scriptId: Number(body.scriptId) } : undefined;
    // FileMaker.PerformScript in a web viewer's page: a script of this file by name, only from a web viewer on this
    // layout set to "Allow JavaScript to perform FileMaker scripts". The parameter is the page's text, not a formula.
    let fromPage: { scriptId: number } | undefined;
    // A WebDirect-style link's script: by name, for accounts whose privilege set has fmurlscript, with the link's variables.
    let urlVariables: Record<string, string> | undefined;
    if (body.urlScript === true) {
      if (!privileges.has('fmurlscript')) throw new ApiError(9, `Account "${session.account}" can't run scripts from a link: its privilege set needs the fmurlscript extended privilege`, 403);
      const named = typeof body.script === 'string' ? store.schema.scripts.find((s) => s.name === body.script) : undefined;
      if (!named) throw new ApiError(104, `Script "${said(body.script)}" is missing`, 404);
      fromPage = { scriptId: named.id };
      const vars = body.variables && typeof body.variables === 'object' && !Array.isArray(body.variables) ? Object.entries(body.variables as Record<string, unknown>) : [];
      urlVariables = Object.fromEntries(vars.filter(([k, v]) => /^\$[^$\s]{1,100}$/.test(k) && typeof v === 'string').slice(0, URL_SCRIPT_LIMIT.variables).map(([k, v]) => [k, (v as string).slice(0, URL_SCRIPT_LIMIT.value)]));
    }
    if (body.webViewer !== undefined) {
      const viewer = design && (function look(objs: LayoutObject[]): LayoutObject | undefined {
        for (const o of objs) {
          if (o.id === body.webViewer) return o;
          const c = o.children && look(o.children);
          if (c) return c;
        }
        return undefined;
      })(design.objects);
      if (viewer?.kind !== 'web-viewer' || viewer.webOptions?.jsBridge !== true) throw new ApiError(3, 'That web viewer does not allow JavaScript to perform FileMaker scripts', 403);
      const named = typeof body.script === 'string' ? store.schema.scripts.find((s) => s.name === body.script) : undefined;
      if (!named) throw new ApiError(104, `Script "${said(body.script)}" is missing`, 404);
      fromPage = { scriptId: named.id };
    }
    const action: { scriptId?: number; script?: string; parameter?: string } | undefined = fromPage ?? timer ?? menuItem ?? scriptsMenuItem ?? fileTrigger ?? (event !== undefined
      ? (body.objectId !== undefined ? obj?.triggers : design?.triggers)?.find((t) => t.event === event && (t.modes ?? ['browse']).includes(String(body.mode ?? 'browse') as TriggerMode))
      : obj?.action?.stepId === 1 ? obj.action : undefined);
    // A button that does one step other than Perform Script runs it as a one-step script,
    // so it does what the same step does in a script (Set Field, Go to Related Record, ...).
    // A menu command the web client does through the script engine, so it behaves as the step does.
    // A calculation typed in Replace Field Contents can read any field, so only full access may send one.
    if (body.command === 'Replace Field Contents' && body.replaceWith === 'calculation' && !privileges.full) {
      throw new ApiError(9, `Account "${session.account}" doesn't have full access, which replacing with a calculated result needs`, 403);
    }
    const command = typeof body.command === 'string' && Object.hasOwn(COMMAND_STEPS, body.command) ? commandStep(COMMAND_STEPS[body.command], body, info.occurrence,
      // Compat clients show dates as MM/DD/YYYY; a script step reads text in the file's order.
      (key, typed) => { const type = fieldTypeOf(store, info, key); return type === 'date' || type === 'timestamp' ? inDateOrder(typed, store.dateOrder) : typed; }) : undefined;
    if (body.command !== undefined && !command) throw new ApiError(3, 'Command is unavailable', 400);
    const buttonFile = event === undefined && !fromPage && !timer && !menuItem && !scriptsMenuItem && !fileTrigger && obj?.action?.stepId === 1 && obj.action.scriptId !== undefined ? obj.action.file : undefined;
    // A timer on another file's script runs it as Perform Script does there: its privileges in that file, and the
    // parameter worked out here, in the window that installed it.
    const external = timer?.file ? { stepId: 1, step: 'Perform Script', params: { script: { id: timer.scriptId, name: '', file: timer.file }, ...(timer.parameter !== undefined ? { parameter: timer.parameter } : {}) } }
      // A button on another file's script does the same, with the parameter worked out below passed on as the script's.
      : buttonFile ? { stepId: 1, step: 'Perform Script', params: { script: { id: obj!.action!.scriptId!, name: '', file: buttonFile }, parameter: 'Get ( ScriptParameter )' } } : undefined;
    const single = external ?? command ?? (!action && event === undefined && !menuItem && obj?.action && obj.action.stepId !== 1 ? obj.action : undefined);
    if (!action && !single) throw new ApiError(3, event ? `No ${event} script trigger there` : 'That object does not run a script', 400);
    const byEvent = event !== undefined && !single && !timer && !menuItem && !scriptsMenuItem && !fileTrigger;
    // The field the cursor starts in: only the field whose own OnObject… trigger this is.
    const activeObject = byEvent && event!.startsWith('OnObject') && Number.isInteger(body.activeObject) && body.activeObject === body.objectId ? Number(body.activeObject) : undefined;
    const script: Script | undefined = single
      ? { id: 0, name: '', steps: [{ stepId: single.stepId, name: single.step, enabled: true, ...(single.params ? { params: single.params } : {}) },
        // The other file's script's result is the timer's, as a script of this file's would be.
        ...(external ? [{ stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( ScriptResult )' } }] : [])] }
      : store.schema.scripts.find((s) => s.id === action!.scriptId);
    if (!script) throw new ApiError(104, `Script "${action!.script ?? action!.scriptId}" is missing`, 404);
    if (!single) privileges.checkScript(script.name);

    const recordId = num0(body.recordId);
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).map(Number).filter(Number.isInteger)
      : store.findIds(info, { query: queryOf(body.query), sort: sortOf(body.sort), privileges, dateOrder: store.fileMode === 'native' ? 'ISO' : 'MDY' });
    const w = { mode: String(body.mode ?? 'browse'), view: String(body.view ?? 'form'), foundCount: ids.length, totalCount: num0(body.totalCount), number: recordId === undefined ? undefined : ids.indexOf(recordId) + 1 };
    let parameter = fromPage ? said(body.parameter) : '';
    if (action?.parameter && !timer?.file && !fromPage) {
      // A button in a portal row evaluates its parameter on that row's record.
      const row = body.row as { portal?: string; recordId?: unknown } | undefined;
      const p = row && info.plan?.portals.find((x) => x.name === row.portal);
      const occ = p && occurrence(store, p.occurrenceId);
      const [v] = occ
        ? store.evaluateEach(store.occurrenceInfo(occ), [action.parameter], Number(row!.recordId), this.screen(store, session, layout, w))
        : store.evaluateEach(info, [action.parameter], recordId, this.screen(store, session, layout, w));
      parameter = v === undefined ? '' : asText(v, store.dateOrder);
    }
    // The script's steps arrive one at a time: the end of the run, or Insert File asking for a file.
    const queue: Step[] = [];
    let wake: (() => void) | undefined;
    const push = (s: Step) => {
      queue.push(s);
      wake?.();
    };
    const next = async (): Promise<Step> => {
      while (!queue.length) await new Promise<void>((r) => (wake = r));
      wake = undefined;
      return queue.shift()!;
    };
    const run: Paused = {
      id: '', db: store.name, token: session.token, script: script.name,
      sent: 0, answer: () => {}, next, timer: undefined as unknown as NodeJS.Timeout,
    };
    // OnPanelSwitch: the panel showing and the one clicked, for Get ( TriggerCurrentPanel ) and Get ( TriggerTargetPanel ).
    const panel = body.panel as { current?: unknown; target?: unknown } | undefined;
    // OnObjectKeystroke / OnLayoutKeystroke: the key typed, for Get ( TriggerKeystroke ) and Get ( TriggerModifierKeys ).
    const keystroke = (event === 'OnObjectKeystroke' || event === 'OnLayoutKeystroke') && typeof body.keystroke === 'string'
      ? { keystroke: body.keystroke.slice(0, 8), modifierKeys: Math.trunc(Number(body.modifierKeys) || 0) } : undefined;
    const trigger = event === 'OnPanelSwitch' && panel ? { currentPanel: String(panel.current ?? ''), targetPanel: String(panel.target ?? '') } : keystroke;
    const snapshot = command?.stepId === 91 && typeof body.field === 'string' ? snapshotField(store, layout, body.field, ids)
      : command?.stepId === 128 ? snapshotFields(store, layout, command.params!.findReplace!.fields!, body.currentRecord === true && recordId !== undefined ? [recordId] : ids) : undefined;
    const deleting = command?.stepId === 10 ? snapshotRows(store, layout, ids)
      : command?.stepId === 9 && recordId !== undefined && w.mode !== 'find' ? snapshotRows(store, layout, [recordId]) : undefined;
    // The window the run starts in and every window the person has open (frontmost last), so Close Window in a
    // later run closes a card and shows the window behind it.
    const startWindow = openWindowOf(body.window);
    const openWindows = Array.isArray(body.windows) ? (body.windows as unknown[]).slice(-50).map((v) => {
      const w = openWindowOf(v);
      if (!w?.layout) return w;
      const state = v as Record<string, unknown>;
      // A background window supplies its own found set, including queries whose records aren't all cached in the browser.
      if (!Array.isArray(state.ids) && !Array.isArray(state.query)) return w;
      try {
        const foundSet = Array.isArray(state.ids) ? this.foundIds(store, w.layout, state, privileges)
          : store.findIds(w.layout, { query: state.query as FindRequest[], sort: state.sort as SortSpec[] | undefined, privileges, dateOrder: store.fileMode === 'native' ? 'ISO' : 'MDY' });
        return { ...w, foundSet, recordId: num0(state.recordId), sort: state.sort as SortSpec[] | undefined };
      } catch (e) {
        // Another session may have removed a background layout. The engine handles it if the script selects that window.
        if (!(e instanceof StoreError) || e.code !== 105) throw e;
        return w;
      }
    }).filter((w): w is OpenWindow => !!w) : undefined;
    const collector = new DenialCollector('web', 'script');
    // The record the window showed before this one, for Insert from Last Visited.
    const visited = body.lastVisited as { layout?: unknown; recordId?: unknown } | undefined;
    const lastVisited = typeof visited?.layout === 'string' && Number.isSafeInteger(Number(visited.recordId)) && Number(visited.recordId) > 0
      ? { layout: visited.layout, recordId: Number(visited.recordId) } : undefined;
    // Registered last, just as the run starts, so nothing before it can leave an entry behind.
    const userStop = new EventTarget();
    const runningKey = `${session.token}\u0000${store.name}`;
    const mine = this.running.get(runningKey) ?? new Set<EventTarget>();
    this.running.set(runningKey, mine.add(userStop));
    const forget = () => {
      mine.delete(userStop);
      this.runningProgress.delete(userStop);
      if (!mine.size && this.running.get(runningKey) === mine) this.running.delete(runningKey);
    };
    let started: Promise<RunResult>;
    try {
      started = runScript(store, script, {
      parameter, ...(urlVariables ? { variables: urlVariables } : {}), layout, foundSet: ids, ...(startWindow ? { startWindow } : {}), ...(activeObject !== undefined ? { activeObject } : {}),
      // Only when the event's own trigger chose the script: a timer, menu item or one-step command naming an event
      // mustn't switch that trigger off for its run.
      ...(byEvent ? { startedBy: { event: event!, ...(Number.isInteger(body.objectId) ? { objectId: Number(body.objectId) } : {}) } } : {}),
      ...(activeObject !== undefined && Number.isInteger(body.activeRow) ? { activeRow: Number(body.activeRow) } : {}), ...(openWindows?.length ? { openWindows } : {}), ...(trigger ? { trigger } : {}), ...(w.mode === 'find' ? { mode: 'find' as const, ...(findRequests(body.requests) ? { requests: inFileDateOrder(store, layout, findRequests(body.requests)) } : {}) } : {}), recordId, preview: body.preview === true, ...(body.view === 'form' || body.view === 'list' || body.view === 'table' ? { view: body.view } : {}), account: session.account, session: session.scripts, ...this.host.scriptOptions(store.name), executionAccount: session.account, executionVia: session.via, privileges,
      onAccessDenial: (denial, code) => collector.observe(denial, code),
      onProgress: (event) => this.runningProgress.set(userStop, event),
      ...(lastVisited ? { lastVisited } : {}),
      ...(session.window ? { window: session.window } : {}),
      // Files the script exports or saves as PDF go to the person's browser, as in WebDirect.
      downloads: true,
      ...(Number.isInteger(body.activeObjectId) ? { activeObjectId: Number(body.activeObjectId) } : {}),
      checkpoint: async (request) => {
        if (run.abandoned) throw new ScriptError(1, 'The client stopped acknowledging screen actions');
        const actions = request.actions.slice();
        const last = actions.at(-1);
        if (last && request.state.layout && (last.step.startsWith('Refresh ') || last.step === 'Set Web Viewer' || last.step === 'Perform JavaScript in Web Viewer')) {
          // Prepare within the authorized run, on its connection and transaction, before waiting for the client.
          const display = this.refresh(request.store, session, request.state.layout, { ...body, ...run.display, ids: request.state.foundSet, mode: request.state.mode,
            recordId: request.state.recordId, step: last.step, objectId: last.objectId, flushJoinResults: last.flushJoinResults }, sessionPrivileges(request.store, session), request);
          actions[actions.length - 1] = { ...last, refresh: display };
        }
        await new Promise<void>((resolve) => {
          run.answer = (v) => { if (v !== true) run.abandoned = true; resolve(); };
          push({ checkpoint: { actions, state: request.state } });
        });
        if (run.abandoned) throw new ScriptError(1, 'The client stopped acknowledging screen actions');
      },
      // The person can stop it (Esc), unless it turns Allow User Abort off.
      userStop,
      insertFile: (request) => run.abandoned ? Promise.resolve(undefined) : new Promise<PickedFile>((resolve) => {
        run.answer = (v) => resolve(v && typeof v === 'object' && 'data' in v ? v : undefined);
        push({ ask: { ...(request.title !== undefined ? { title: request.title } : {}), actions: request.actions } });
      }),
      // Pause/Resume Script: the client shows the window as it stands, with Continue and Cancel.
      pause: (request) => run.abandoned ? Promise.resolve(false) : new Promise<boolean>((resolve) => {
        run.answer = (v) => resolve(v === true);
        push({ pause: { actions: request.actions, state: request.state } });
      }),
      // A menu command or a timer on another file tells its own result; a script's failing step shows its error with error capture off.
      ...(command || external ? { errorDialogs: false } : {}),
      // Show Custom Dialog: the client shows the dialog and posts the button and inputs.
      dialog: (request) => run.abandoned ? Promise.resolve(undefined) : new Promise<DialogAnswer | undefined>((resolve) => {
        run.answer = (v) => resolve(v && typeof v === 'object' && 'button' in v ? v : undefined);
        push({ dialog: request });
      }),
      // Sort Records with its dialog: the client shows its sort dialog and posts the order.
      sortDialog: (request) => run.abandoned ? Promise.resolve(undefined) : new Promise<SortSpec[] | undefined>((resolve) => {
        run.answer = (v) => resolve(Array.isArray(v) ? v : undefined);
        push({ sort: { sort: request.sort, actions: request.actions, state: request.state } });
      }),
      // Insert from Index: the client shows View Index with the field's values and posts the one picked.
      indexDialog: (request) => run.abandoned ? Promise.resolve(undefined) : new Promise<string | undefined>((resolve) => {
        run.answer = (v) => resolve(v && typeof v === 'object' && 'picked' in v ? v.picked : undefined);
        push({ index: { field: request.field, values: request.values, actions: request.actions, state: request.state } });
      }),
      // Insert from Device: the person's camera, microphone, bar code reader or signature pad.
      device: (request) => run.abandoned ? Promise.resolve(undefined) : new Promise<DeviceAnswer | undefined>((resolve) => {
        run.answer = (v) => resolve(v && typeof v === 'object' && ('data' in v || 'text' in v) ? v : undefined);
        push({ device: { type: request.type, ...(request.camera ? { camera: request.camera } : {}), actions: request.actions } });
      }),
      // Location and LocationValues: the person's browser asks them, then says where the device is.
      location: (request) => run.abandoned ? Promise.resolve(undefined) : new Promise<DeviceLocation | undefined>((resolve) => {
        run.answer = (v) => resolve(v && typeof v === 'object' && 'latitude' in v ? v : undefined);
        push({ locate: { actions: request.actions } });
      }),
      // Paste with nothing copied in this run: the person's browser reads its clipboard (or they paste into a box).
      clipboard: (request) => run.abandoned ? Promise.resolve(undefined) : new Promise<string | undefined>((resolve) => {
        run.answer = (v) => resolve(v && typeof v === 'object' && 'pasted' in v ? v.pasted : undefined);
        push({ clipboard: { actions: request.actions } });
      }),
    });
    } catch (e) {
      forget();
      throw e;
    }
    started.then((done) => { collector.flush(); push({ done }); }, (failed) => { collector.error(failed); collector.flush(); push({ failed }); }).finally(forget);
    const out = this.outcome(run, await next());
    // Beyond FileMaker, where Replace Field Contents can't be undone: journal what it changed, so the client can offer Undo.
    // The same for Delete Record and Delete All Records, when no relationship deletes related records along with them.
    if ((snapshot || deleting) && (out as { error?: unknown }).error === 0) {
      const what = Array.isArray(snapshot) ? `“${String(body.find)}”` : snapshot?.field;
      const batch = snapshot
        ? journalFieldChange(store, snapshot, session.account, (n) => `Replaced ${what} in ${n} record${n === 1 ? '' : 's'}`)
        : journalDeletes(store, deleting!, session.account, (n) => `Deleted ${n} record${n === 1 ? '' : 's'}`);
      if (batch) return { ...out, undo: { id: batch.id, summary: batch.summary, kind: snapshot ? 'replace' : 'delete' } };
      // Replace All that found nothing to change.
      if (Array.isArray(snapshot)) return { ...out, replaced: 0 };
    }
    return out;
  }

  /** A script-backed item of a menu reachable from the file's menu set. */
  private menuItem(store: Store, ref: unknown[], installed: unknown, layout: string): CustomMenuItem | undefined {
    const set = this.menuSet(store, installed, layout);
    const [menuId, index] = ref.map(Number);
    if (!set) return undefined;
    const reachable = new Set<number>();
    const visit = (m: CustomMenu | undefined) => {
      if (!m || reachable.has(m.id)) return;
      reachable.add(m.id);
      for (const it of m.items) if (it.submenuId !== undefined) visit(set.byId.get(it.submenuId));
    };
    set.menus.forEach(visit);
    const item = reachable.has(menuId) ? set.byId.get(menuId)?.items[index] : undefined;
    return item?.scriptId !== undefined ? item : undefined;
  }

  /** The response for what the script did next; a script waiting for a file is kept until the client answers. */
  private outcome(run: Paused, step: Step) {
    if ('ask' in step || 'pause' in step || 'dialog' in step || 'sort' in step || 'index' in step || 'device' in step || 'locate' in step || 'checkpoint' in step || 'clipboard' in step) {
      const asked = 'ask' in step ? step.ask : 'pause' in step ? step.pause : 'dialog' in step ? step.dialog : 'sort' in step ? step.sort : 'index' in step ? step.index : 'device' in step ? step.device : 'checkpoint' in step ? step.checkpoint : 'clipboard' in step ? step.clipboard : step.locate;
      const actions = this.clientActions(run, asked.actions.slice(run.sent));
      run.sent = asked.actions.length;
      run.waiting = 'ask' in step ? 'Insert File' : 'pause' in step ? 'Pause' : 'dialog' in step ? 'Dialog' : 'sort' in step ? 'Sort' : 'index' in step ? 'Index' : 'device' in step ? 'Device' : 'checkpoint' in step ? 'Checkpoint' : 'clipboard' in step ? 'Clipboard' : 'Location';
      run.id = randomBytes(8).toString('hex'); // each ask has its own id, so an old answer can't land on a new ask
      run.timer = setTimeout(() => {
        // Nobody answered: cancel, as the person would, and let the script finish.
        this.paused.delete(run.id);
        run.abandoned = true;
        run.answer(run.waiting === 'Pause' ? false : undefined);
      }, ASK_IDLE_MS);
      run.timer.unref();
      this.paused.set(run.id, run);
      if ('checkpoint' in step) {
        const s = step.checkpoint.state;
        return { script: run.script, waiting: { run: run.id, step: 'Checkpoint' }, actions, ...s };
      }
      if ('pause' in step) {
        // The window as the paused script leaves it, so the person sees what they are to act on.
        const s = step.pause.state;
        return { script: run.script, waiting: { run: run.id, step: 'Pause' }, actions, ...s };
      }
      if ('sort' in step) {
        const s = step.sort.state;
        return { script: run.script, waiting: { run: run.id, step: 'Sort', sort: step.sort.sort }, actions, ...s };
      }
      if ('index' in step) {
        const s = step.index.state;
        return { script: run.script, waiting: { run: run.id, step: 'Index', field: step.index.field, values: step.index.values }, actions, ...s };
      }
      if ('dialog' in step) {
        const { title, message, buttons, inputs, state: s } = step.dialog;
        return { script: run.script, waiting: { run: run.id, step: 'Dialog', title, message, buttons, inputs }, actions, ...s };
      }
      if ('device' in step) return { script: run.script, waiting: { run: run.id, step: 'Device', type: step.device.type, ...(step.device.camera ? { camera: step.device.camera } : {}) }, actions };
      if ('locate' in step) return { script: run.script, waiting: { run: run.id, step: 'Location' }, actions };
      if ('clipboard' in step) return { script: run.script, waiting: { run: run.id, step: 'Clipboard' }, actions };
      return { script: run.script, waiting: { run: run.id, step: 'Insert File', ...(step.ask.title !== undefined ? { title: step.ask.title } : {}) }, actions };
    }
    if ('failed' in step) {
      const e = step.failed;
      const denial = denialOf(e);
      if (e instanceof ScriptError || e instanceof StoreError || e instanceof PrivilegeError) return { script: run.script, result: '', error: e.code, message: e.message, ...(denial ? { denial: explainAccessDenial(denial) } : {}), actions: [] };
      throw e;
    }
    const r = step.done;
    const denial = scriptDenial(r);
    return { script: run.script, result: r.result, error: r.error, ...(denial ? { denial: explainAccessDenial(denial) } : {}), ...(r.warnings?.length ? { warnings: r.warnings } : {}), syncVersion: r.syncVersion, layout: r.layout, foundSet: r.foundSet, sort: r.sort, recordId: r.recordId, mode: r.mode, ...(r.preview ? { preview: true } : {}), ...(r.active !== undefined ? { active: r.active } : {}), ...(r.window ? { window: r.window } : {}), ...(r.closed ? { closed: r.closed } : {}), actions: this.clientActions(run, r.actions.slice(run.sent)) };
  }

  /**
   * Actions as the client gets them. Install OnTimer Script keeps the script
   * and its parameter formula here and hands the window an id to fire it
   * with, so a client can only run the script a timer step named.
   */
  private clientActions(run: Paused, actions: ClientAction[]): ClientAction[] {
    return actions.map((a) => {
      if (a.step !== 'Install OnTimer Script') return a;
      if (typeof a.timerScriptId !== 'number' || !(Number(a.interval) > 0)) {
        this.timers.delete(run.token);
        return { step: a.step, script: a.script, interval: 0 };
      }
      const id = randomBytes(8).toString('hex');
      const file = a.timerFile as { id: number; name: string } | undefined;
      this.timers.set(run.token, { id, db: run.db, scriptId: a.timerScriptId, ...(typeof a.parameter === 'string' ? { parameter: a.parameter } : {}), ...(file ? { file: { id: file.id, name: file.name } } : {}) });
      return { step: a.step, script: a.script, interval: Number(a.interval), timer: id, timerScript: a.timerScript };
    });
  }

  /**
   * The person asked to stop (Esc): every script this session is running in
   * the file halts at its next step. One that has Allow User Abort off, or
   * is waiting on the person (a dialog, a pause, whose Cancel stops it),
   * ignores the ask. Answers how many runs were asked.
   */
  private stopRuns(req: IncomingMessage, res: ServerResponse, db: string): void {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method !== 'POST') throw new ApiError(3, 'Command is unavailable', 405);
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      const mine = this.running.get(`${session.token}\u0000${store.name}`);
      for (const t of mine ?? []) t.dispatchEvent(new Event('stop'));
      send(200, { stopped: mine?.size ?? 0 });
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof StoreError || e instanceof PrivilegeError ? new ApiError(e.code, e.message, 400, e.denial) : unknownError(e);
      if (!(e instanceof URIError) && !(e instanceof ApiError) && !(e instanceof StoreError) && !(e instanceof PrivilegeError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message, ...(err.denial ? { denial: explainAccessDenial(err.denial) } : {}) } });
    }
  }

  /** A session sees aggregate progress for its own active runs only. */
  private progressRuns(req: IncomingMessage, res: ServerResponse, db: string): void {
    try {
      if (req.method !== 'GET') throw new ApiError(3, 'Command is unavailable', 405);
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      const mine = this.running.get(`${session.token}\u0000${store.name}`);
      const runs = [...(mine ?? [])].flatMap((run) => {
        const progress = this.runningProgress.get(run);
        return progress ? [progress] : [];
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ runs }));
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof StoreError || e instanceof PrivilegeError ? new ApiError(e.code, e.message, 400, e.denial) : unknownError(e);
      res.writeHead(err.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ error: { code: err.code, message: err.message } }));
    }
  }

  /** The client's answer to a script waiting for a file: the file, or a cancel. */
  private async answerFile(req: IncomingMessage, res: ServerResponse, db: string, id: string): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method !== 'POST') throw new ApiError(3, 'Command is unavailable', 405);
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      sessionPrivileges(store, session);
      const run = this.paused.get(id);
      if (!run || run.token !== session.token || run.db !== store.name) throw new ApiError(101, 'No script is waiting for that file', 404);
      if (run.waiting === 'Sort') {
        // {"sort": [{fieldName, sortOrder}, ...]} ([] unsorts); {"cancel": true} for Cancel.
        const body = await readBody(req, 64 * 1024);
        let json: Record<string, unknown>;
        try {
          json = body.length ? parseRequestJson(body.toString('utf8')) : {};
        } catch {
          throw new ApiError(960, 'Invalid JSON', 400);
        }
        const sort = json.sort;
        const valid = Array.isArray(sort) && sort.length <= 50 && sort.every((x) => x && typeof x === 'object' && typeof x.fieldName === 'string');
        if (json.cancel !== true && !valid) throw new ApiError(960, 'Expected "sort" (a list of {fieldName, sortOrder}) or "cancel": true', 400);
        if (this.paused.get(id) !== run) throw new ApiError(101, 'No script is waiting to sort there', 404);
        this.paused.delete(id);
        clearTimeout(run.timer);
        run.answer(json.cancel === true ? undefined : (sort as SortSpec[]).map((x) => ({ fieldName: x.fieldName, sortOrder: x.sortOrder === 'descend' ? 'descend' : typeof x.sortOrder === 'string' && x.sortOrder !== 'ascend' && x.sortOrder.length <= 200 ? x.sortOrder : 'ascend' })));
        send(200, this.outcome(run, await run.next()));
        return;
      }
      if (run.waiting === 'Index') {
        // {"value": text} (one of the values offered; the script checks); {"cancel": true} for Cancel.
        const body = await readBody(req, 4 * 1024 * 1024);
        let json: Record<string, unknown>;
        try {
          json = body.length ? parseRequestJson(body.toString('utf8')) : {};
        } catch {
          throw new ApiError(960, 'Invalid JSON', 400);
        }
        if (json.cancel !== true && typeof json.value !== 'string') throw new ApiError(960, 'Expected "value" (one of the index values) or "cancel": true', 400);
        if (this.paused.get(id) !== run) throw new ApiError(101, 'No script is waiting for an index value there', 404);
        this.paused.delete(id);
        clearTimeout(run.timer);
        run.answer(json.cancel === true ? undefined : { picked: json.value as string });
        send(200, this.outcome(run, await run.next()));
        return;
      }
      if (run.waiting === 'Dialog') {
        // {"button": 1-3, "inputs": [text, ...]}; {"cancel": true} closes it.
        const body = await readBody(req, 4 * 1024 * 1024);
        let json: Record<string, unknown>;
        try {
          json = body.length ? parseRequestJson(body.toString('utf8')) : {};
        } catch {
          throw new ApiError(960, 'Invalid JSON', 400);
        }
        const button = Number(json.button);
        const inputs = json.inputs;
        if (json.cancel !== true && (!Number.isInteger(button) || button < 1 || button > 3)) throw new ApiError(960, 'Expected "button" (1-3) or "cancel": true', 400);
        if (inputs !== undefined && (!Array.isArray(inputs) || inputs.length > 3 || inputs.some((x) => typeof x !== 'string'))) throw new ApiError(960, '"inputs" must be up to three strings', 400);
        if (this.paused.get(id) !== run) throw new ApiError(101, 'No dialog is open there', 404);
        this.paused.delete(id);
        clearTimeout(run.timer);
        run.answer(json.cancel === true ? undefined : { button, ...(inputs ? { inputs: inputs as string[] } : {}) });
        send(200, this.outcome(run, await run.next()));
        return;
      }
      if (run.waiting === 'Clipboard') {
        // {"text": the clipboard's text}; {"cancel": true} when there is none or the person won't give it.
        const body = await readBody(req, 4 * 1024 * 1024);
        let json: Record<string, unknown>;
        try {
          json = body.length ? parseRequestJson(body.toString('utf8')) : {};
        } catch {
          throw new ApiError(960, 'Invalid JSON', 400);
        }
        if (json.cancel !== true && typeof json.text !== 'string') throw new ApiError(960, 'Expected "text" (the clipboard\'s text) or "cancel": true', 400);
        if (this.paused.get(id) !== run) throw new ApiError(101, 'No script is waiting to paste there', 404);
        this.paused.delete(id);
        clearTimeout(run.timer);
        run.answer(json.cancel === true ? undefined : { pasted: json.text as string });
        send(200, this.outcome(run, await run.next()));
        return;
      }
      if (run.waiting === 'Location') {
        // {"latitude", "longitude", "accuracy", "altitude"?, "altitudeAccuracy"?, "at"?}; {"cancel": true} when refused.
        const body = await readBody(req, 4 * 1024);
        let json: Record<string, unknown>;
        try {
          json = body.length ? parseRequestJson(body.toString('utf8')) : {};
        } catch {
          throw new ApiError(960, 'Invalid JSON', 400);
        }
        const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
        const lat = json.latitude, lon = json.longitude;
        const valid = fin(lat) && fin(lon) && Math.abs(lat as number) <= 90 && Math.abs(lon as number) <= 180;
        if (json.cancel !== true && !valid) throw new ApiError(960, 'Expected "latitude" and "longitude", or "cancel": true', 400);
        if (this.paused.get(id) !== run) throw new ApiError(101, 'No script is waiting for a location', 404);
        this.paused.delete(id);
        clearTimeout(run.timer);
        const opt = (v: unknown) => (fin(v) && (v as number) >= 0 ? v as number : undefined);
        const alt = fin(json.altitude) ? json.altitude as number : undefined;
        run.answer(json.cancel === true ? undefined : {
          latitude: lat as number, longitude: lon as number, horizontalAccuracy: opt(json.accuracy) ?? 0,
          ...(alt !== undefined ? { altitude: alt } : {}), ...(opt(json.altitudeAccuracy) !== undefined ? { verticalAccuracy: opt(json.altitudeAccuracy) } : {}),
          // When the device measured it, but never in the future.
          at: fin(json.at) ? Math.min(json.at as number, Date.now()) : Date.now(),
        });
        send(200, this.outcome(run, await run.next()));
        return;
      }
      if (run.waiting === 'Device' && !/^multipart\/form-data/i.test(req.headers['content-type'] ?? '')) {
        // A bar code's text: {"text": "..."}; {"cancel": true}. Photos, videos, sounds and signatures come as files below.
        const body = await readBody(req, Math.ceil(MAX_FILE * 4 / 3) + 64 * 1024);
        let json: Record<string, unknown>;
        try {
          json = body.length ? parseRequestJson(body.toString('utf8')) : {};
        } catch {
          throw new ApiError(960, 'Invalid JSON', 400);
        }
        if (typeof json.text === 'string') {
          if (json.text.length > 64 * 1024) throw new ApiError(960, 'The bar code is too long', 413);
          if (this.paused.get(id) !== run) throw new ApiError(101, 'No script is waiting for a device', 404);
          this.paused.delete(id);
          clearTimeout(run.timer);
          run.answer({ text: json.text });
          send(200, this.outcome(run, await run.next()));
          return;
        }
        if (json.cancel === true || typeof json.data === 'string') {
          const file = json.cancel === true ? undefined : { filename: String(json.filename || 'file'), data: new Uint8Array(Buffer.from(json.data as string, 'base64')) };
          if (file && file.data.length > MAX_FILE) throw new ApiError(960, 'The file is larger than 50 MB', 413);
          if (this.paused.get(id) !== run) throw new ApiError(101, 'No script is waiting for a device', 404);
          this.paused.delete(id);
          clearTimeout(run.timer);
          run.answer(file);
          send(200, this.outcome(run, await run.next()));
          return;
        }
        throw new ApiError(960, 'Expected "text", "data" (base64) or "cancel": true', 400);
      }
      if (run.waiting === 'Pause' || run.waiting === 'Checkpoint') {
        // Continue, or {"cancel": true} for Cancel.
        const body = await readBody(req, 64 * 1024);
        let json: Record<string, unknown> = {};
        try {
          json = body.length ? parseRequestJson(body.toString('utf8')) : {};
        } catch {
          throw new ApiError(960, 'Invalid JSON', 400);
        }
        if (this.paused.get(id) !== run) throw new ApiError(101, 'No script is paused there', 404);
        this.paused.delete(id);
        clearTimeout(run.timer);
        if (run.waiting === 'Checkpoint') run.display = { ...(json.layoutId !== undefined ? { layoutId: json.layoutId } : {}), displayPortals: json.displayPortals, foundPortalRanges: json.foundPortalRanges };
        run.answer(json.cancel !== true);
        send(200, this.outcome(run, await run.next()));
        return;
      }
      // Base64 in JSON is a third larger than the file.
      const body = await readBody(req, Math.ceil(MAX_FILE * 4 / 3) + 64 * 1024);
      let file: PickedFile;
      const type = req.headers['content-type'] ?? '';
      if (/^multipart\/form-data/i.test(type)) {
        const up = multipartUpload(type, body);
        file = { filename: up.filename || 'file', data: new Uint8Array(up.data) };
      } else {
        let json: Record<string, unknown>;
        try {
          json = body.length ? parseRequestJson(body.toString('utf8')) : {};
        } catch {
          throw new ApiError(960, 'Invalid JSON', 400);
        }
        if (json.cancel === true) file = undefined;
        else if (typeof json.data !== 'string') throw new ApiError(960, 'Expected "data" (base64) or "cancel": true', 400);
        else file = { filename: String(json.filename || 'file'), data: new Uint8Array(Buffer.from(json.data, 'base64')) };
      }
      if (file && file.data.length > MAX_FILE) throw new ApiError(960, 'The file is larger than 50 MB', 413);
      // Check the run is still waiting: the timeout may have answered while the body arrived.
      if (this.paused.get(id) !== run) throw new ApiError(101, 'No script is waiting for that file', 404);
      this.paused.delete(id);
      clearTimeout(run.timer);
      run.answer(file);
      send(200, this.outcome(run, await run.next()));
    } catch (e) {
      captureDenial(e);
      denialOperation.getStore()?.flush();
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof StoreError || e instanceof PrivilegeError ? new ApiError(e.code, e.message, 400, e.denial) : unknownError(e);
      if (!(e instanceof URIError) && !(e instanceof ApiError) && !(e instanceof StoreError) && !(e instanceof PrivilegeError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message, ...(err.denial ? { denial: explainAccessDenial(err.denial) } : {}) } });
    }
  }

  /** Cancels scripts still waiting for a file (the server is stopping). */
  stop(): void {
    for (const run of this.paused.values()) {
      clearTimeout(run.timer);
      run.abandoned = true;
      run.answer(run.waiting === 'Pause' ? false : undefined);
    }
    this.paused.clear();
  }

  /** Fills in names of fields in other files' tables, which the design could not resolve on its own. */
  private resolveDesign(store: Store, design: LayoutDesign): LayoutDesign {
    // Formulas name other files' fields as ⟨field:TO.field⟩ until those files are hosted.
    const calc = (formula: string) => externalFieldNames(formula, (to, field) => {
      const occ = occurrence(store, to);
      const name = occ?.table.fields.find((f) => f.id === field)?.name;
      return occ && name ? `${occ.to.name}::${name}` : undefined;
    });
    const fix = (objs: LayoutObject[]): LayoutObject[] => objs.map((o) => {
      const out = { ...o };
      if (o.field && !o.field.field) {
        const name = occurrence(store, o.field.tableOccurrenceId)?.table.fields.find((f) => f.id === o.field!.fieldId)?.name;
        if (name) out.field = { ...o.field, field: name };
      }
      if (o.text) out.text = calc(o.text);
      if (o.hide) out.hide = { ...o.hide, formula: calc(o.hide.formula) };
      if (o.placeholder) out.placeholder = calc(o.placeholder);
      if (o.tooltip) out.tooltip = calc(o.tooltip);
      if (o.label) out.label = calc(o.label);
      if (o.activeSegmentFormula) out.activeSegmentFormula = calc(o.activeSegmentFormula);
      if (o.conditions) out.conditions = o.conditions.map((c) => ({ ...c, formula: calc(c.formula) }));
      if (o.action?.parameter) out.action = { ...o.action, parameter: calc(o.action.parameter) };
      if (o.chart) {
        const c = o.chart;
        const opt = (f: string | undefined) => (f === undefined ? undefined : calc(f));
        out.chart = {
          ...c, title: opt(c.title), xTitle: opt(c.xTitle), yTitle: opt(c.yTitle), categories: opt(c.categories), yMin: opt(c.yMin), yMax: opt(c.yMax),
          series: c.series.map((x) => ({ data: calc(x.data), name: opt(x.name), x: opt(x.x), sizes: opt(x.sizes) })),
        };
      }
      if (o.children) out.children = fix(o.children);
      return out;
    });
    const tableView = design.tableView?.map((c) => {
      if (c.field.field) return c;
      const name = occurrence(store, c.field.tableOccurrenceId)?.table.fields.find((f) => f.id === c.field.fieldId)?.name;
      return name ? { ...c, field: { ...c.field, field: name } } : c;
    });
    const parts = design.parts.map((p) => {
      if (!p.breakField || p.breakField.field) return p;
      const occ = occurrence(store, p.breakField.tableOccurrenceId);
      const name = occ?.table.fields.find((f) => f.id === p.breakField!.fieldId)?.name;
      return name ? { ...p, breakField: { ...p.breakField, field: name, tableOccurrence: occ!.to.name } } : p;
    });
    return { ...design, parts, objects: fix(design.objects), ...(tableView ? { tableView } : {}) };
  }

  /** Only the theme styles this layout uses (themes hold hundreds). */
  private trimTheme(theme: Theme, used: Set<string>): Theme {
    return { ...theme, styles: theme.styles.filter((s) => used.has(s.name)) };
  }
}

interface ChartData {
  title?: string;
  xTitle?: string;
  yTitle?: string;
  yMin?: number;
  yMax?: number;
  categories: string[];
  series: { name: string; values: (number | null)[]; x?: (number | null)[]; sizes?: (number | null)[] }[];
}

/** A chart value as a number: FileMaker reads "5,402" or "$1,200.50" for its digits; no digits is no value. */
function chartNumber(s: string): number | null {
  const t = s.replace(/[^0-9.eE+-]/g, '');
  if (!/[0-9]/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A menu command's step, with what the client chose in its dialog as the step's options. */
function commandStep(c: { stepId: number; step: string; params?: StepParams }, body: Record<string, unknown>, layoutOccurrence: string,
  dates: (field: string, typed: string) => string = (_, typed) => typed): { stepId: number; step: string; params?: StepParams } | undefined {
  if (c.stepId === 26) return { ...c, params: { calculation: String(Math.max(1, Math.trunc(Number(body.count) || 1))) } };
  if (c.stepId === 91 || c.stepId === 40) {
    if (typeof body.field !== 'string' || !body.field) return undefined;
    const at = body.field.indexOf('::');
    const to = at < 0 ? layoutOccurrence : body.field.slice(0, at);
    const name = at < 0 ? body.field : body.field.slice(at + 2);
    const field = { tableOccurrence: { id: 0, name: to }, field: { id: 0, name } };
    if (c.stepId === 40) return { ...c, params: { noDialog: true, field } };
    if (body.replaceWith === 'calculation') {
      return typeof body.calculation === 'string' && body.calculation.trim() ? { ...c, params: { field, calculation: body.calculation } } : undefined;
    }
    if (body.replaceWith === 'serial') {
      const s = (body.serial ?? {}) as { initial?: unknown; increment?: unknown; update?: unknown };
      const update = s.update === true ? { updateEntryOptions: true } : {};
      // No initial value: the field's own next serial number and increment (Use Entry Options).
      if (s.initial === undefined || s.initial === '') return { ...c, params: { field, replaceWith: 'serial', serial: update } };
      const by = Math.trunc(Number(s.increment ?? 1));
      if (typeof s.initial !== 'string' || !Number.isFinite(by) || by === 0) return undefined;
      return { ...c, params: { field, replaceWith: 'serial', serial: { initial: textLiteral(s.initial), increment: String(by), ...update } } };
    }
    if (typeof body.value !== 'string') return undefined;
    // The value as a quoted text literal, so it is put in as typed.
    return { ...c, params: { field, calculation: textLiteral(dates(body.field, body.value)) } };
  }
  if (c.stepId === 144) {
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled.pdf';
    return { ...c, params: { noDialog: true, pdfRecords: body.records === 'current' ? 'current' : 'browsed', filePaths: [/\.pdf$/i.test(name) ? name : `${name}.pdf`] } };
  }
  if (c.stepId === 128) {
    const fields = Array.isArray(body.fields) ? [...new Set((body.fields as unknown[]).filter((x): x is string => typeof x === 'string' && x !== ''))] : [];
    if (typeof body.find !== 'string' || !body.find || !fields.length) return undefined;
    return { ...c, params: { noDialog: true, findReplace: {
      find: textLiteral(body.find), replace: textLiteral(typeof body.replace === 'string' ? body.replace : ''), operation: 'Replace All',
      ...(body.matchCase === true ? { matchCase: true } : {}), ...(body.wholeWords === true ? { wholeWords: true } : {}),
      ...(body.currentRecord === true ? { currentRecord: true } : {}), within: 'all', fields,
    } } };
  }
  return c;
}

/** A calculation that is the text as typed. */
function textLiteral(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r\n|\n/g, '\r')}"`;
}

/** Find requests sent from the web client's Find mode: `[{criteria: {field: text}, omit}]`, anything else dropped. */
function findRequests(v: unknown): { criteria: Record<string, string>; omit: boolean }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.flatMap((r) => {
    const c = (r as { criteria?: unknown })?.criteria;
    if (!c || typeof c !== 'object') return [];
    const criteria = Object.fromEntries(Object.entries(c).filter(([, x]) => typeof x === 'string')) as Record<string, string>;
    return [{ criteria, omit: (r as { omit?: unknown }).omit === true }];
  });
  return out.length ? out : undefined;
}

/** A sort order from a request body: a list of { fieldName, sortOrder? }; anything else is refused, not trusted. */
function sortOf(v: unknown): SortSpec[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x) && typeof (x as SortSpec).fieldName === 'string' && ((x as SortSpec).sortOrder === undefined || typeof (x as SortSpec).sortOrder === 'string'))) {
    throw new ApiError(5, 'sort is a list of { fieldName, sortOrder }', 400);
  }
  return v as SortSpec[];
}

/** Find requests from a request body: a list of { field: criterion } objects. */
function queryOf(v: unknown): FindRequest[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x) && Object.values(x).every((c) => typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean'))) {
    throw new ApiError(5, 'query is a list of { field: criterion } objects', 400);
  }
  return v as FindRequest[];
}

function num0(v: unknown): number | undefined {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? undefined : n;
}

/**
 * Self in a field's formulas is the field's value: written out as the field,
 * so the formula reads it from the record (or portal row). Text in quotes is
 * left alone.
 */
function withSelf(formula: string, o: LayoutObject): string {
  const f = o.field;
  if (!f?.field || !f.tableOccurrence) return formula;
  const ref = `${f.tableOccurrence}::${f.field}`;
  return formula.replace(/"(?:[^"\\]|\\.)*"|\bSelf\b(?!\s*\()/g, (m) => (m === 'Self' ? ref : m));
}

/**
 * Puts a value list's values (what's entered) into `values`, and the text to
 * show into `labels` when it differs: the second field, alone or after the value.
 */
function listItems(store: Store, id: number, from: { info: LayoutInfo; recordId: number } | undefined, privileges: Privileges,
  values: Record<number, string[]>, labels: Record<number, string[]>): void {
  const items = store.valueListItems(id, from, privileges);
  values[id] = items.map((i) => i.value);
  const vl = store.schema.valueLists.find((v) => v.id === id);
  if (vl?.field?.secondFieldId !== undefined) labels[id] = items.map((i) => (vl.field!.showSecondOnly ? i.display : `${i.value}  ${i.display}`));
}

/** The menu set a layout's Layout Setup names, if any (1: FileMaker's standard menus). */
function layoutMenuSet(store: Store, layout: string): number | undefined {
  try {
    const id = store.layout(layout).layoutId;
    return id === undefined ? undefined : store.design(id)?.menuSetId;
  } catch {
    return undefined;
  }
}

/** A field's type by the name a client uses ("Field", "Field(2)", "TO::Field"), related ones through their table occurrence. */
function fieldTypeOf(store: Store, info: LayoutInfo, key: string): string | undefined {
  const name = key.replace(/\(\d+\)$/, '');
  const at = name.indexOf('::');
  if (at < 0) return info.fields.find((f) => f.name === name)?.type;
  try {
    return store.occurrence(name.slice(0, at)).fields.find((f) => f.name === name.slice(at + 2))?.type;
  } catch {
    return undefined;
  }
}

/** Dates written m/d/y (with /, - or .) in `text` written in `order` instead. */
function inDateOrder(text: string, order: Store['dateOrder']): string {
  if (order === 'MDY' || order === 'ISO') return text;
  return text.replace(/(?<!\d)(?<!\d[/.-])(\d{1,2})([/.-])(\d{1,2})\2(\d{1,4})(?!\d)(?![/.-]\d)/g,
    (_, m: string, sep: string, d: string, y: string) => (order === 'DMY' ? `${d}${sep}${m}${sep}${y}` : `${y}${sep}${m}${sep}${d}`));
}

/**
 * Find requests typed in the compat web client, which shows dates as MM/DD/YYYY whatever the file's date order,
 * with the dates in date and timestamp fields put in the file's own order: a script's find reads them as
 * the file does, as it reads a script's own requests.
 */
function inFileDateOrder(store: Store, layout: string, requests: { criteria: Record<string, string>; omit: boolean }[] | undefined) {
  if (!requests || store.dateOrder === 'MDY' || store.dateOrder === 'ISO') return requests;
  let info: LayoutInfo;
  try {
    info = store.layout(layout);
  } catch {
    return requests;
  }
  const order = store.dateOrder;
  const swap = (text: string) => inDateOrder(text, order);
  return requests.map((r) => ({
    ...r,
    criteria: Object.fromEntries(Object.entries(r.criteria).map(([k, v]) => {
      const type = fieldTypeOf(store, info, k);
      return [k, type === 'date' || type === 'timestamp' ? swap(v) : v];
    })),
  }));
}

/**
 * The records of a found set the client names (its record ids, or the find that made it, and its sort), in order,
 * of those the account can see.
 */
/** A fault of the server's own, for a caller: "Unknown error", with the cause in the server log. */
function unknownError(e: unknown): ApiError {
  logFault(e);
  return new ApiError(-1, 'Unknown error');
}

/** Bound client-supplied found sets before coercion, deduplication or store work. */
function checkFoundIds(body: Record<string, unknown>): void {
  if (Array.isArray(body.ids) && body.ids.length > 100_000) {
    throw new ApiError(3, 'A found-set ids array may contain at most 100,000 entries', 400);
  }
}

function foundIds(store: Store, layout: string, body: Record<string, unknown>, privileges: Privileges): number[] {
  checkFoundIds(body);
  const sort = sortOf(body.sort)?.length ? sortOf(body.sort) : undefined;
  if (!Array.isArray(body.ids)) return store.findIds(layout, { query: queryOf(body.query), sort, privileges, dateOrder: store.fileMode === 'native' ? 'ISO' : 'MDY' });
  const want = [...new Set((body.ids as unknown[]).map(Number).filter(Number.isInteger))];
  const viewable = store.findIds(layout, { sort, privileges });
  const keep = new Set(want);
  const can = new Set(viewable);
  return sort ? viewable.filter((id) => keep.has(id)) : want.filter((id) => can.has(id));
}

/** Replace Field Contents with AI: at most this many records at once, asked about this many at a time. */
const MAX_AI_REPLACE = 500;
const AI_REPLACE_BATCH = 25;
const AI_REPLACE_CHARS = 40_000;
const AI_REPLACE_VALUE = 1000;
const AI_REPLACE_TIMEOUT = 600_000;

/** What a person may keep in a file for themselves, and how much of it. */
const PREF_KEYS = ['finds', 'sorts', 'recent'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const named = (v: unknown): v is Record<string, unknown> => isObject(v) && typeof v.name === 'string' && typeof v.layout === 'string';
const finds = (v: unknown) => Array.isArray(v) && v.every((f) => named(f) && Array.isArray(f.requests));
/** The form each kept value must have, so a client never reads back something it can't use. */
const PREF_SHAPES: Record<string, (v: unknown) => boolean> = {
  finds: (v) => isObject(v) && finds(v.saved) && finds(v.recent),
  sorts: (v) => Array.isArray(v) && v.every((x) => named(x) && Array.isArray(x.sort)),
  recent: (v) => Array.isArray(v) && v.every((r) => isObject(r) && typeof r.layout === 'string' && typeof r.recordId === 'string' && typeof r.title === 'string'),
};
const MAX_PREF = 64 * 1024;

/** Formulas and the relationship graph are design: for full access, or sets that may modify scripts and read everything. */
function canSeeDesign(p: Privileges, session: Session): boolean {
  // An API token limited to some layouts or to reading isn't given the whole design, as with the MCP tools.
  if (session.layoutScope || session.readOnly) return false;
  return p.full || (p.set.scripts === 'modifiable' && p.readsEverything);
}

const WINDOW_STYLES = new Set(['document', 'floating', 'dialog', 'card']);
/** A window as the client describes it: { id, name, style?, layout? }, short strings only. */
function openWindowOf(v: unknown): OpenWindow | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const w = v as Record<string, unknown>;
  if (typeof w.id !== 'string' || !w.id || w.id.length > 100) return undefined;
  const name = typeof w.name === 'string' ? w.name.slice(0, 200) : '';
  return {
    id: w.id, name,
    ...(typeof w.style === 'string' && WINDOW_STYLES.has(w.style) ? { style: w.style as OpenWindow['style'] } : {}),
    ...(typeof w.layout === 'string' && w.layout.length <= 200 ? { layout: w.layout } : {}),
    // A card's size and place, as the script that opened or moved it left them.
    ...Object.fromEntries((['height', 'width', 'top', 'left'] as const)
      .filter((k) => typeof w[k] === 'number' && Number.isFinite(w[k]) && Math.abs(w[k] as number) < 100_000).map((k) => [k, Math.round(w[k] as number)])),
  };
}
