// Talks to the Tabularius server: the FileMaker Data API for records, and the
// app endpoints for layout designs.

import type { ValueExplanation } from './explain.ts';
import type { RecordHistory, RevertResult } from './record-history.ts';
import { CopyMoved, OfflineCopy, type OfflineKey, type QueuedEdit } from './offline.ts';
import { classifyWrite, type Write } from './change-relay.ts';
import type { ImportAction, ImportChoice, ImportFound, ImportPlan, ImportResult } from './import-dialog.ts';
import type { RefreshData, ChartData, CustomMenu, DataRecord, FindRequest, GroupRun, LayoutMeta, MenuItem, PortalRow, ScriptRun, ScriptsMenuEntry, SortSpec, Value, ViewState } from './types.ts';
import { BROWSER_NETWORK_WORDS, httpProblem } from './http-problem.ts';

/** A calendar feed as the list shows it (never its address). */
export interface CalendarFeed { id: string; label: string; account: string; layout: string; created: string; expires?: string; lastUsed?: string }

export interface AccessDenialExplanation {
  operation: string;
  permission: string;
  explanation: string;
}

export class ApiError extends Error {
  readonly code: number;
  readonly denial?: AccessDenialExplanation;
  readonly status?: number;
  constructor(code: number, message: string, denial?: AccessDenialExplanation, status?: number) {
    super(message);
    this.code = code;
    this.denial = denial;
    this.status = status;
  }
}

/** Only transport failures and explicit temporary server conditions warrant an automatic retry. */
export function retryableRequest(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.denial) return false;
    if ([300, 301, 302, 303, 304, 306, 307, 812].includes(error.code)) return true;
    // FileMaker validation and access errors can use HTTP 500 too; their error code takes precedence.
    if (error.code !== -1) return false;
    return error.status === 408 || error.status === 429
      || (error.status !== undefined && error.status >= 500 && error.status < 600);
  }
  return error instanceof TypeError || (error instanceof Error &&
    (['AbortError', 'TimeoutError'].includes(error.name) || /network|disconnected|failed to fetch|timed? ?out/i.test(error.message)));
}

/** A request that never reached a server (fetch rejects with a TypeError, or the browser's own words for it). */
export function unreachableRequest(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && !(e instanceof ApiError) && BROWSER_NETWORK_WORDS.test(e.message));
}

/**
 * Runs a request again when it never reached the server (so it cannot have been applied twice), after each pause in
 * `pauses`. Anything the server answered, or a request that may have arrived, is thrown at once.
 */
export async function retrying<T>(run: () => Promise<T>, pauses: readonly number[] = [600, 1800]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= pauses.length || !unreachableRequest(e)) throw e;
      await new Promise((ok) => setTimeout(ok, pauses[attempt]));
    }
  }
}

export interface FoundSet {
  data: DataRecord[];
  foundCount: number;
  totalCount: number;
}

const enc = encodeURIComponent;
/** The query that makes a container call act on a row of a portal instead of the record itself. */
const portalQuery = (portal?: { name: string; recordId: string }): string => (portal ? `?portal=${enc(portal.name)}&portalRecordId=${enc(portal.recordId)}` : '');

/** Files this big or bigger go in pieces (Api.upload). */
export const PIECED_FROM = 8 * 1024 * 1024;
const PIECE = 2 * 1024 * 1024;

/** What a caller of a big upload gets to know and may do. */
export interface UploadProgress {
  onProgress?(sent: number, total: number): void;
  signal?: AbortSignal;
}

/** The error a request gets when there is no connection and the offline copy can't answer it. */
export const OFFLINE = -2;

/**
 * Whether a response can be kept in the offline copy: reads only (records, finds, layouts and what the client
 * works out for them). Script runs, imports, exports and every change are never kept.
 */
export function keepable(method: string, path: string): boolean {
  if (/[?&]script/.test(path)) return false;
  if (path.startsWith('/fmi/data/')) {
    if (method === 'GET') return /^\/fmi\/data\/vLatest\/databases\/[^/]+\/layouts\/[^/]+\/records(\/[^/?]+)?(\?|$)/.test(path);
    return method === 'POST' && /^\/fmi\/data\/vLatest\/databases\/[^/]+\/layouts\/[^/]+\/_find$/.test(path);
  }
  if (!path.startsWith('/tabularius/app/v1/databases/')) return false;
  if (method === 'GET') return /^\/tabularius\/app\/v1\/databases\/[^/]+\/layouts(\/[^/?]+)?$/.test(path);
  return method === 'POST' && /^\/tabularius\/app\/v1\/databases\/[^/]+\/layouts\/[^/]+\/(view|records|groups|index|charts|menus)$/.test(path);
}

/** A change to a record's fields (the Data API's PATCH), which the offline copy can hold until the connection is back. */
/**
 * Whether a request failed for want of the server: no connection (fetch rejects with a TypeError only when the
 * request never reached a server), or something in between, such as a proxy, answering for it (no answer from
 * Tabularius, so no error code).
 */
function unreachable(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof ApiError && e.code === -1);
}

const EDIT = /^\/fmi\/data\/vLatest\/databases\/[^/]+\/layouts\/([^/]+)\/records\/([^/?]+)$/;

export async function listDatabases(): Promise<string[]> {
  const r = await fetch('/fmi/data/vLatest/databases');
  const body = await r.json();
  if (r.status === 503) throw new ApiError(301, 'Server busy. Try again shortly.', undefined, 503);
  if (!r.ok) throw new ApiError(Number(body.messages?.[0]?.code ?? -1), body.messages?.[0]?.message ?? httpProblem(r.status), undefined, r.status);
  return (body.response?.databases ?? []).map((d: { name: string }) => d.name);
}

export class Api {
  readonly db: string;
  readonly token: string;
  /** Called when the session expires, so the app can show the login again. */
  onExpired: () => void = () => {};
  /** Set when the account owes a password change (policy or Account Options): only changePassword works until it is done. */
  passwordChangeRequired = false;

  /** This browser's offline copy of the file, when the account keeps one: reads are kept, and answered from it without a connection. */
  offline?: OfflineCopy;
  /** The password's key for an offline copy, kept after a password sign-in so one can be started without asking again. */
  offlineKey?: OfflineKey;
  /** A copy made with this account's earlier password still holds changes waiting: they need that password to be sent. */
  staleCopy = false;
  /** Set while requests are being answered from the offline copy (the connection is gone, or the copy was opened without one). */
  isOffline = false;
  /** Field changes waiting in the offline copy to be sent. */
  waiting = 0;
  /** Called when isOffline or waiting changes. */
  onOfflineChange: () => void = () => {};
  /** Called after a request that changed the file's data succeeded (see change-relay.ts). */
  wrote?: (w: Write) => void;

  constructor(db: string, token: string) {
    this.db = db;
    this.token = token;
  }

  /** Opened from the offline copy alone, without signing in to the server: nothing can be sent until someone does. */
  get copyOnly(): boolean {
    return !this.token;
  }

  static async login(db: string, account: string, password: string, otp?: string): Promise<Api> {
    const r = await fetch(`/fmi/data/vLatest/databases/${enc(db)}/sessions`, {
      method: 'POST',
      // The web client logs in as a FileMaker client (fmapp / fmwebdirect), not a Data API integration.
      headers: {
        authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${account}:${password}`))),
        'content-type': 'application/json', 'x-tabularius-client': 'web',
        ...(otp ? { 'x-tabularius-otp': otp } : {}),
      },
      body: '{}',
    });
    const body = await r.json();
    const msg = body.messages?.[0];
    if (!r.ok || msg?.code !== '0') throw new ApiError(Number(msg?.code ?? -1), msg?.message ?? 'Login failed', body['tabularius:denial'], r.status);
    const api = new Api(db, body.response.token);
    api.passwordChangeRequired = !!body.response.passwordChangeRequired;
    return api;
  }

  async logout(): Promise<void> {
    await fetch(`/fmi/data/vLatest/databases/${enc(this.db)}/sessions/${enc(this.token)}`, { method: 'DELETE' }).catch(() => {});
  }

  /** Changes the signed-in account's own password; clears a must-change requirement on success. */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.send('PATCH', `/fmi/data/vLatest/databases/${enc(this.db)}/sessions`, { oldPassword, newPassword });
    this.passwordChangeRequired = false;
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const copy = this.offline;
    if (!copy) return this.send(method, path, body);
    const request = keepable(method, path) ? `${method} ${path}\u0000${body === undefined ? '' : JSON.stringify(body)}` : undefined;
    const edit = method === 'PATCH' ? EDIT.exec(path) : null;
    const b = body as { fieldData?: Record<string, string>; modId?: string; portalData?: unknown; styles?: Record<string, unknown[]> } | undefined;
    const target = edit ? { layout: decodeURIComponent(edit[1]), recordId: decodeURIComponent(edit[2]) } : undefined;
    // Opened from the copy alone, nothing goes to the server (there is no session).
    if (!this.copyOnly) {
      // A change to a record with a change still waiting from offline goes with it, on the modId that one was
      // made on: sent alone, it would move the record on, and the waiting one would then look like a clash.
      const waiting = target && b?.fieldData && !b.portalData ? await copy.pendingFor(target.layout, target.recordId) : undefined;
      let sent = body;
      if (waiting && !waiting.conflict) {
        // Formatting waiting for a field typed over again no longer fits its text.
        const styles: Record<string, unknown[]> = { ...waiting.styles };
        for (const f of Object.keys(b!.fieldData!)) delete styles[f];
        Object.assign(styles, b!.styles);
        sent = { ...b, fieldData: { ...waiting.fieldData, ...b!.fieldData }, ...(Object.keys(styles).length ? { styles } : {}), ...(waiting.modId ? { modId: waiting.modId } : {}) };
      }
      try {
        const res = await this.send(method, path, sent);
        if (waiting && !waiting.conflict) {
          await copy.settle(waiting);
          await this.countWaiting();
        }
        this.offlineNow(false);
        if (request) void copy.keep(request, { ok: res }).catch(() => {});
        return res;
      } catch (e) {
        // FileMaker's "no records match" is an answer too: keep it.
        if (request && e instanceof ApiError && e.code === 401) void copy.keep(request, { error: [e.code, e.message] }).catch(() => {});
        if (!unreachable(e)) throw e;
      }
      this.offlineNow(true);
    }
    if (request) {
      const kept = await copy.recall(request) as { ok?: unknown; error?: [number, string] } | undefined;
      if (kept?.error) throw new ApiError(kept.error[0], kept.error[1]);
      if (kept && 'ok' in kept) return kept.ok;
      throw new ApiError(OFFLINE, "You're offline, and this wasn't opened before, so the offline copy doesn't have it.");
    }
    if (target && b?.fieldData && !b.portalData && !('deleteRelated' in b.fieldData)) {
      // Waits only with the modId it was made on, so sending it can tell whether someone changed the record meanwhile.
      if (!b.modId && !await copy.pendingFor(target.layout, target.recordId)) {
        throw new ApiError(OFFLINE, "You're offline, and this change can't be kept for later; it has to wait for the connection.");
      }
      try {
        await copy.queue({ ...target, modId: b.modId, fieldData: b.fieldData, ...(b.styles ? { styles: b.styles } : {}) });
      } catch (e) {
        if (e instanceof CopyMoved) throw new ApiError(OFFLINE, "This change was not kept: the offline copy was moved to another password (or removed) in another window. Sign in again to keep working offline.");
        throw e;
      }
      await copy.patch(`/layouts/${enc(target.layout)}/`, target.recordId, b.fieldData);
      await this.countWaiting();
      return { modId: b.modId };
    }
    throw new ApiError(OFFLINE, "You're offline. Changes to fields are kept until the connection is back; this has to wait for it.");
  }

  /** The connection is back (the browser says so): requests go to the server again until one fails. */
  markOnline(): void {
    this.offlineNow(false);
  }

  private offlineNow(offline: boolean): void {
    if (this.isOffline === offline) return;
    this.isOffline = offline;
    this.onOfflineChange();
    // The server answers again (whatever the browser says about the network): send what waits.
    if (!offline && this.waiting) this.onReconnect();
  }

  /** Called when the server answers again after requests failed, with changes waiting. */
  onReconnect: () => void = () => {};

  /** Counts the changes waiting in the offline copy. */
  async countWaiting(): Promise<QueuedEdit[]> {
    const pending = this.offline ? await this.offline.pending() : [];
    if (pending.length !== this.waiting) {
      this.waiting = pending.length;
      this.onOfflineChange();
    }
    return pending;
  }

  /**
   * Sends the changes waiting in the offline copy, oldest first, each only if its record is as it was when the
   * change was made (its modId). One changed by someone else meanwhile, or deleted, or refused, is kept and
   * marked: those are returned, for the person to decide. Stops when the server can't be reached or the record
   * is locked by someone editing it, leaving the rest waiting. One window sends at a time.
   */
  async sync(): Promise<QueuedEdit[]> {
    const copy = this.offline;
    if (!copy || this.copyOnly) return [];
    const run = async (): Promise<QueuedEdit[]> => {
      const clashes: QueuedEdit[] = [];
      for (const edit of await copy.pending()) {
        if (edit.conflict) { clashes.push(edit); continue; }
        try {
          await this.sendEdit(edit, edit.modId);
          this.offlineNow(false);
          await copy.settle(edit);
        } catch (e) {
          if (unreachable(e) || (e instanceof ApiError && e.code === 301)) break;
          if (!(e instanceof ApiError) || e.code === 952) throw e;
          const gone = e.code === 101;
          const changed = e.code === 306;
          const server = changed ? await this.send('GET', `${this.base(edit.layout)}/records/${enc(edit.recordId)}`).then((r) => r.data?.[0]?.fieldData as Record<string, unknown>, () => undefined) : undefined;
          const conflict = { message: e.message, ...(server ? { server } : {}), ...(gone ? { gone } : {}), ...(!gone && !changed ? { refused: true } : {}) };
          await copy.conflict(edit, conflict);
          clashes.push({ ...edit, conflict });
        }
      }
      await this.countWaiting();
      return clashes;
    };
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    return locks ? locks.request(`tabularius-offline-${this.db}-${copy.account.toLowerCase()}`, run) : run();
  }

  /** Settles a change that clashed: sends it over what the server has now ("keep mine"), or drops it ("keep theirs"). */
  async resolve(edit: QueuedEdit, keepMine: boolean): Promise<void> {
    if (!this.offline) return;
    if (keepMine) await this.sendEdit(edit, undefined);
    await this.offline.settle(edit);
    await this.countWaiting();
  }

  private sendEdit(edit: QueuedEdit, modId: string | undefined): Promise<unknown> {
    return this.send('PATCH', `${this.base(edit.layout)}/records/${enc(edit.recordId)}`, {
      fieldData: edit.fieldData, ...(edit.styles ? { styles: edit.styles } : {}), ...(modId ? { modId } : {}),
    });
  }

  /** Shared across windows/Api instances using one token; a failed write must not stall the queue. */
  private static readonly writes = new Map<string, Promise<unknown>>();

  private send(method: string, path: string, body?: unknown): Promise<any> {
    const read = method === 'GET' || (method === 'POST' && /\/_find$/.test(path));
    if (!path.startsWith('/fmi/data/') || read) return this.sendNow(method, path, body);
    const pending = (Api.writes.get(this.token) ?? Promise.resolve()).catch(() => {}).then(() => this.sendNow(method, path, body));
    Api.writes.set(this.token, pending);
    const release = () => { if (Api.writes.get(this.token) === pending) Api.writes.delete(this.token); };
    void pending.then(release, release);
    return pending;
  }

  private async sendNow(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    const window = windowInfo();
    const raw = body instanceof FormData || body instanceof Blob;
    const r = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(window ? { 'x-tabularius-window': window } : {}), ...(body === undefined || raw ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : raw ? (body as FormData | Blob) : JSON.stringify(body),
      signal,
    });
    const json = await r.json().catch(() => ({}));
    if (path.startsWith('/tabularius/')) {
      if (!r.ok) {
        const err = new ApiError(json.error?.code ?? -1, json.error?.message ?? httpProblem(r.status), json.error?.denial, r.status);
        if (err.code === 952) this.onExpired();
        throw err;
      }
      this.told(method, path);
      return json;
    }
    const msg = json.messages?.[0];
    if (!r.ok || (msg && msg.code !== '0')) {
      const err = new ApiError(Number(msg?.code ?? -1), msg?.message ?? httpProblem(r.status), json['tabularius:denial'], r.status);
      if (err.code === 952) this.onExpired();
      throw err;
    }
    this.told(method, path);
    return json.response;
  }

  /** Tells the window about a request that changed data, for its sibling windows. */
  private told(method: string, path: string): void {
    const w = classifyWrite(method, path);
    if (w) this.wrote?.(w);
  }

  private base(layout: string): string {
    return `/fmi/data/vLatest/databases/${enc(this.db)}/layouts/${enc(layout)}`;
  }

  menu(): Promise<{ database: string; version?: string; commit?: string; account?: string; scripts?: ScriptsMenuEntry[]; layouts: MenuItem[]; openLayout?: string; onFirstWindowOpen?: boolean; onLastWindowClose?: boolean; onWindowOpen?: boolean; onWindowClose?: boolean; customMenus?: boolean; menuCommands?: 'all' | 'editing' | 'minimum'; printing?: false; exporting?: false }> {
    return this.call('GET', `/tabularius/app/v1/databases/${enc(this.db)}/layouts`);
  }

  /** Takes back a journaled bulk change; fields changed again since are left alone and listed. */
  undoChange(id: string): Promise<{ undone: number; skipped: string[] }> {
    return this.call('POST', `/tabularius/cleanup/v1/databases/${enc(this.db)}/history/${enc(id)}/undo`, {});
  }

  /** Formulas evaluated on a record from a layout, as the Data Viewer does (full access only). */
  evaluate(layout: string, formulas: string[], recordId?: string): Promise<{ results: { value: unknown; error?: number; message?: string }[] }> {
    return this.call('POST', `/tabularius/debug/v1/databases/${enc(this.db)}/evaluate`, { layout, formulas, ...(recordId ? { recordId } : {}) });
  }

  /** This account's saved finds, saved sorts and recent records in the file (kept on the server, so they follow the account). */
  async prefs(): Promise<Record<string, unknown>> {
    return (await this.call('GET', `/tabularius/app/v1/databases/${enc(this.db)}/prefs`)).prefs ?? {};
  }

  async setPref(key: 'finds' | 'sorts' | 'recent', value: unknown): Promise<void> {
    await this.call('PUT', `/tabularius/app/v1/databases/${enc(this.db)}/prefs/${key}`, { value });
  }

  layout(name: string): Promise<LayoutMeta> {
    return this.call('GET', `/tabularius/app/v1/databases/${enc(this.db)}/layouts/${enc(name)}`);
  }

  /** A page of the found set: all records, or the result of a find. offset is 1-based. */
  /** Related records `offset` (1-based) on of one portal of a record, up to `limit`: the Data API sends 50 of each with the record. */
  async portalRows(layout: string, id: string, portal: string, offset: number, limit: number): Promise<PortalRow[]> {
    const r = await this.call('GET', `${this.base(layout)}/records/${enc(id)}?portal=${enc(JSON.stringify([portal]))}&_offset.${enc(portal)}=${offset}&_limit.${enc(portal)}=${limit}`);
    return r.data?.[0]?.portalData?.[portal] ?? [];
  }
  async records(layout: string, opts: { offset: number; limit: number; query?: FindRequest[]; sort?: SortSpec[] }): Promise<FoundSet> {
    try {
      const r = opts.query?.length
        ? await this.call('POST', `${this.base(layout)}/_find`, { query: opts.query, sort: opts.sort, offset: opts.offset, limit: opts.limit })
        : await this.call('GET', `${this.base(layout)}/records?_offset=${opts.offset}&_limit=${opts.limit}${opts.sort?.length ? `&_sort=${enc(JSON.stringify(opts.sort))}` : ''}`);
      return { data: r.data, foundCount: r.dataInfo.foundCount, totalCount: r.dataInfo.totalRecordCount };
    } catch (e) {
      // FileMaker reports "no records match" as error 401.
      if (e instanceof ApiError && e.code === 401) return { data: [], foundCount: 0, totalCount: -1 };
      throw e;
    }
  }

  async record(layout: string, id: string): Promise<DataRecord> {
    return (await this.call('GET', `${this.base(layout)}/records/${enc(id)}`)).data[0];
  }

  async update(layout: string, id: string, fieldData: Record<string, Value>, extra: { modId?: string; portalData?: Record<string, Partial<PortalRow>[]>; deleteRelated?: string | string[]; styles?: DataRecord['styles']; portalStyles?: DataRecord['portalStyles'] } = {}): Promise<string> {
    const body: Record<string, unknown> = { fieldData: extra.deleteRelated ? { ...fieldData, deleteRelated: extra.deleteRelated } : fieldData };
    if (extra.styles) body.styles = extra.styles;
    if (extra.modId) body.modId = extra.modId;
    if (extra.portalData) body.portalData = extra.portalData;
    if (extra.portalStyles) body.portalStyles = extra.portalStyles;
    return (await this.call('PATCH', `${this.base(layout)}/records/${enc(id)}`, body)).modId;
  }

  /** Why a field shows its value: its formula and inputs, or the relationship it follows (no AI). */
  async explain(layout: string, req: { recordId: string; field: string; portal?: string; row?: string }): Promise<ValueExplanation> {
    return (await this.call('POST', this.app(layout, 'explain'), req)) as ValueExplanation;
  }

  /** A record's history: who changed it, when and from where, with each change's old and new value. */
  async recordHistory(layout: string, recordId: string): Promise<RecordHistory> {
    return (await this.call('POST', this.app(layout, 'history'), { recordId: Number(recordId) })) as unknown as RecordHistory;
  }

  /** Puts back what one logged change did (some of an edit's fields, or all of it), with this account's privileges. */
  async revertChange(layout: string, recordId: string, seq: number, fields?: string[]): Promise<RevertResult> {
    return (await this.call('POST', this.app(layout, 'revert'), { recordId: Number(recordId), seq, ...(fields ? { fields } : {}) })) as unknown as RevertResult;
  }

  /** Types into a portal's empty last row: a new related record, its match fields filled in from record `id`. */
  async addRelated(layout: string, id: string, portal: string, fieldData: Record<string, Value>): Promise<{ modId: string; recordId?: string; relatedModId?: string }> {
    const r = await this.call('PATCH', `${this.base(layout)}/records/${enc(id)}`, { fieldData: {}, portalData: { [portal]: [fieldData] } });
    const made = (r.newPortalRecordInfo as { recordId: string; modId: string }[] | undefined)?.[0];
    return { modId: r.modId, recordId: made?.recordId, relatedModId: made?.modId };
  }

  /**
   * lastVisited: the record the window was on, for fields with "value from last visited record". uncommitted: made
   * as New Record makes it, its required fields checked when it is committed (commitNew) rather than now.
   */
  async create(layout: string, fieldData: Record<string, Value> = {}, lastVisited?: string, uncommitted = false): Promise<string> {
    const options = { ...(lastVisited ? { lastVisited } : {}), ...(uncommitted ? { uncommitted: true } : {}) };
    return (await this.call('POST', `${this.base(layout)}/records`, { fieldData, ...(Object.keys(options).length ? { options } : {}) })).recordId;
  }

  /** Commits a record made with create(…, uncommitted): its validation runs, fields that must have a value included. */
  async commitNew(layout: string, id: string): Promise<string> {
    return (await this.call('PATCH', `${this.base(layout)}/records/${enc(id)}`, { fieldData: {}, options: { firstCommit: true } })).modId;
  }

  /** A value list by name as this account may use it: the values to store and, when they differ, the text to show. */
  valueList(layout: string, name: string): Promise<{ values: string[]; labels?: string[] }> {
    return this.call('POST', this.app(layout, 'value-list'), { name });
  }

  /** A dashboard widget worked out without saving anything (a chart's, table's or number's figures), as the signed-in account. */
  async summarize(widget: Record<string, unknown>): Promise<unknown> {
    const r = await this.call('POST', `/tabularius/dashboards/v1/databases/${enc(this.db)}?preview=1`, { name: 'Page', widgets: [widget] });
    return r.data?.[0];
  }

  async remove(layout: string, id: string): Promise<void> {
    await this.call('DELETE', `${this.base(layout)}/records/${enc(id)}`);
  }

  /**
   * Puts a file in a container field. One of PIECED_FROM bytes or more goes in pieces that pick up where they stopped
   * if the connection drops, with `progress` told how far it has got and able to cancel it; a smaller one in one request.
   */
  async upload(layout: string, id: string, field: string, repetition: number, file: File, portal?: { name: string; recordId: string }, progress?: UploadProgress): Promise<void> {
    if (file.size >= PIECED_FROM) return this.uploadInPieces(layout, id, field, repetition, file, portal, progress);
    const form = new FormData();
    form.append('upload', file, file.name);
    await this.call('POST', `${this.base(layout)}/records/${enc(id)}/containers/${enc(field)}/${repetition}${portalQuery(portal)}`, form);
  }

  private async uploadInPieces(layout: string, id: string, field: string, repetition: number, file: File, portal: { name: string; recordId: string } | undefined, progress?: UploadProgress): Promise<void> {
    const signal = progress?.signal;
    const stopped = () => new DOMException('Upload cancelled', 'AbortError');
    const started = await this.call('POST', `${this.base(layout)}/records/${enc(id)}/container-uploads/${enc(field)}/${repetition}${portalQuery(portal)}`, {
      filename: file.name, mime: file.type || 'application/octet-stream', size: file.size,
    });
    const at = `${this.base(layout)}/container-uploads/${enc(started.uploadId)}`;
    const piece = Math.max(64 * 1024, Math.min(PIECE, Number(started.maxPiece) || PIECE));
    let received = Number(started.received) || 0;
    // A connection that drops, or a server that is briefly busy, is waited out; anything else ends the upload.
    const temporary = (e: unknown) => unreachable(e) || (e instanceof ApiError && (e.status === 409 || e.status === 503 || e.status === 502 || e.status === 504));
    const pause = (ms: number) => new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(stopped()); }, { once: true });
    });
    try {
      progress?.onProgress?.(received, file.size);
      for (let failures = 0; received < file.size;) {
        if (signal?.aborted) throw stopped();
        try {
          const r = await this.sendNow('PUT', `${at}?offset=${received}`, file.slice(received, Math.min(file.size, received + piece)), signal);
          received = Number(r.received);
          failures = 0;
          progress?.onProgress?.(received, file.size);
        } catch (e) {
          if (signal?.aborted) throw stopped();
          if (!temporary(e) || ++failures > 6) throw e;
          // Ask where the upload stands, and go on from there.
          for (;;) {
            await pause(Math.min(8000, 400 * 2 ** failures));
            try {
              received = Number((await this.sendNow('GET', at, undefined, signal)).received);
              break;
            } catch (again) {
              if (signal?.aborted) throw stopped();
              if (!temporary(again) || ++failures > 6) throw again;
            }
          }
        }
      }
      for (let tries = 1;; tries++) {
        try {
          await this.call('POST', `${at}/finish`, {});
          break;
        } catch (e) {
          // The record may be in use for a moment; the file waits for it.
          if (tries >= 4 || !(temporary(e) && !(e instanceof ApiError && e.status === 409))) throw e;
          await pause(1000 * tries);
        }
      }
      this.wrote?.({ kind: 'update', layout, recordId: id });
    } catch (e) {
      // What arrived is of no use to anyone now.
      void this.sendNow('DELETE', at).catch(() => {});
      throw e;
    }
  }

  /** Empties a container field (its repetition). */
  async clearContainer(layout: string, id: string, field: string, repetition: number, portal?: { name: string; recordId: string }): Promise<void> {
    await this.call('DELETE', `${this.base(layout)}/records/${enc(id)}/containers/${enc(field)}/${repetition}${portalQuery(portal)}`);
  }

  private app(layout: string, what: string): string {
    return `/tabularius/app/v1/databases/${enc(this.db)}/layouts/${enc(layout)}/${what}`;
  }

  /** Records by id, in order: a found set a script left behind. offset is 1-based. */
  async recordsById(layout: string, ids: number[], offset: number, limit: number, sort?: SortSpec[]): Promise<FoundSet> {
    const r = await this.call('POST', this.app(layout, 'records'), { ids, offset, limit, sort });
    return { data: r.data, foundCount: r.foundCount, totalCount: r.totalCount };
  }

  /** Where a record is in a found set (a script's `ids`, or a find), 0-based; -1 when it isn't in it. */
  async position(layout: string, body: { recordId: string; ids?: number[]; query?: FindRequest[]; sort?: SortSpec[] }): Promise<number> {
    return (await this.call('POST', this.app(layout, 'position'), body)).index;
  }

  /** A found-set portal's page. A recordId retry returns its current 1-based offset, or zero when absent. */
  async foundSetPortal(layout: string, body: { portal: string; ids?: number[]; query?: FindRequest[]; sort?: SortSpec[]; offset?: number; limit?: number; recordId?: string }): Promise<{ rows: PortalRow[]; count: number; offset?: number }> {
    return (await this.call('POST', this.app(layout, 'foundset'), body)) as { rows: PortalRow[]; count: number; offset?: number };
  }

  /** Sub-summary groups of a sorted found set, one list of runs per field in `fields`. */
  async groups(layout: string, body: { fields: string[]; sort: SortSpec[]; ids?: number[]; query?: FindRequest[] }): Promise<GroupRun[][]> {
    return (await this.call('POST', this.app(layout, 'groups'), body)).groups;
  }

  /** A field's indexed values starting with `prefix` (auto-complete). */
  async fieldIndex(layout: string, field: string, prefix: string, limit = 50): Promise<string[]> {
    return (await this.call('POST', this.app(layout, 'index'), { field, prefix, limit })).values ?? [];
  }

  /** The found set's records with the fields chosen, as a file to download (comma- or tab-separated text, or Excel). */
  /** The calendar routes answer {"messages":[{"code","message"}]} on failure, unlike the app routes. */
  private async calendar(method: string, path: string, init: { json?: unknown; text?: string } = {}): Promise<any> {
    const r = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(init.json !== undefined ? { 'content-type': 'application/json' } : init.text !== undefined ? { 'content-type': 'text/calendar' } : {}) },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : init.text !== undefined ? { body: init.text } : {}),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = json.messages?.[0];
      const err = new ApiError(Number(msg?.code ?? -1), msg?.message ?? httpProblem(r.status), undefined, r.status);
      if (err.code === 952) this.onExpired();
      throw err;
    }
    return json;
  }

  /** The calendar feeds in this file (Full Access): never an address. */
  async calendarFeeds(): Promise<CalendarFeed[]> {
    return (await this.calendar('GET', `/tabularius/calendar/v1/databases/${enc(this.db)}/feeds`)).feeds;
  }

  /** Makes a feed; the address in the answer is the only time it is shown. */
  makeCalendarFeed(body: Record<string, unknown>): Promise<{ id: string; layout: string; address: string; url: string }> {
    return this.calendar('POST', `/tabularius/calendar/v1/databases/${enc(this.db)}/feeds`, { json: body });
  }

  async revokeCalendarFeed(id: string): Promise<void> {
    await this.calendar('DELETE', `/tabularius/calendar/v1/databases/${enc(this.db)}/feeds/${enc(id)}`);
  }

  /** An .ics file's events as records of a layout: `fields` names the field for start, end, title, description and location. */
  importCalendar(layout: string, fields: Record<string, string>, text: string): Promise<{ imported: number; skipped: number; notes: string[] }> {
    const q = new URLSearchParams(Object.entries(fields).filter(([, v]) => v));
    return this.calendar('POST', `/tabularius/calendar/v1/databases/${enc(this.db)}/layouts/${enc(layout)}/calendar-import?${q}`, { text });
  }

  /**
   * Import Tables (Full Access): the files as a multipart body. A preview answers the plan with a few rows of each sheet and
   * writes nothing; an import makes the tables and answers in counts. The design routes answer {"error":{"code","message"}}.
   */
  async importTables(form: FormData, query: string): Promise<any> {
    const r = await fetch(`/tabularius/design/v1/databases/${enc(this.db)}/import-tables${query}`, { method: 'POST', headers: { authorization: `Bearer ${this.token}` }, body: form });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new ApiError(Number(json.error?.code ?? -1), json.error?.message ?? (r.status === 413 ? 'Those files are more than the 50 MB one import takes.' : httpProblem(r.status)), undefined, r.status);
      if (err.code === 952) this.onExpired();
      throw err;
    }
    return json;
  }

  async exportRecords(layout: string, body: { fields: string[]; format: ExportFormat; fieldNames?: boolean; bom?: boolean; name?: string; ids?: number[]; query?: FindRequest[]; sort?: SortSpec[] }): Promise<{ name: string; blob: Blob }> {
    const r = await fetch(this.app(layout, 'export'), {
      method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) {
      const json = await r.json().catch(() => ({}));
      const err = new ApiError(json.error?.code ?? -1, json.error?.message ?? httpProblem(r.status), json.error?.denial);
      if (err.code === 952) this.onExpired();
      throw err;
    }
    const name = /filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition') ?? '')?.[1];
    return { name: name ? decodeURIComponent(name) : `${layout}.${body.format}`, blob: await r.blob() };
  }

  /**
   * Import Records: with `preview`, the fields the file can go into and its first rows;
   * otherwise its rows become new records, column i into mapping[i] (null: not imported).
   */
  importRecords(layout: string, file: File, opts: { preview: true } | { mapping: (string | null)[]; skipFirst: boolean }): Promise<{ fields: string[]; rows: Value[][]; count: number } & { foundSet: number[]; imported: number; skipped: number }> {
    const form = new FormData();
    form.append('upload', file, file.name);
    const q = 'preview' in opts ? 'preview=1' : `mapping=${enc(JSON.stringify(opts.mapping))}&skipFirst=${opts.skipFirst ? 1 : 0}`;
    return this.call('POST', `${this.app(layout, 'import')}?${q}`, form);
  }

  /** An import's plan: columns matched to fields (by the assistant with ai), fixes, a preview and duplicates; with plan, the preview for that plan. */
  planImport(layout: string, file: File, opts: { ai?: boolean; plan?: ImportChoice; action?: ImportAction; found?: ImportFound; sheet?: string }): Promise<ImportPlan> {
    const form = new FormData();
    form.append('upload', file, file.name);
    if (opts.found) form.append('found', JSON.stringify(opts.found));
    const q = opts.plan ? `plan=1&columns=${enc(JSON.stringify(opts.plan))}` : `plan=1${opts.ai ? '&ai=1' : ''}`;
    return this.call('POST', `${this.app(layout, 'import')}?${q}${opts.action && opts.action !== 'add' ? `&action=${opts.action}` : ''}${opts.sheet ? `&sheet=${enc(opts.sheet)}` : ''}`, form);
  }

  /** Imports with a plan; the result's id undoes it. Update and Replace work on the found set sent with it. */
  applyImport(layout: string, file: File, plan: ImportChoice, opts: { skipDuplicates: boolean; skipIssues: boolean; action?: ImportAction; found?: ImportFound; addRemaining?: boolean; sheet?: string }): Promise<ImportResult> {
    const form = new FormData();
    form.append('upload', file, file.name);
    if (opts.found) form.append('found', JSON.stringify(opts.found));
    const action = opts.action && opts.action !== 'add' ? `&action=${opts.action}&addRemaining=${opts.addRemaining ? 1 : 0}${opts.action === 'update' ? `&match=${enc(JSON.stringify(plan.keys))}` : ''}` : '';
    return this.call('POST', `${this.app(layout, 'import')}?columns=${enc(JSON.stringify(plan))}&skipDuplicates=${opts.skipDuplicates ? 1 : 0}&skipIssues=${opts.skipIssues ? 1 : 0}${action}${opts.sheet ? `&sheet=${enc(opts.sheet)}` : ''}`, form);
  }

  /**
   * Replace Field Contents with AI: the field gets what the assistant writes from the instruction and each record of the
   * found set; with `preview`, just the value for one record. Undo takes it back (undoChange).
   */
  aiReplace(layout: string, body: { field: string; instruction: string; preview?: boolean; recordId?: string; ids?: number[]; query?: FindRequest[]; sort?: SortSpec[] }):
    Promise<{ value?: string | null; changed?: number; left?: number; stopped?: string; skipped?: { recordId: number; why: string }[]; undo?: { id: string; summary: string; kind: string } }> {
    return this.call('POST', this.app(layout, 'ai-replace'), body);
  }

  undoImport(layout: string, id: string): Promise<{ deleted: number; restored?: number; kept: { recordId: number; why: string }[] }> {
    return this.call('POST', this.app(layout, 'undo-import'), { id });
  }

  /** Chart data for the records shown: record id -> chart object id -> its data. */
  async charts(layout: string, body: { records: string[]; query?: FindRequest[]; sort?: SortSpec[]; ids?: number[]; view: string; foundCount: number; totalCount: number }): Promise<Record<string, Record<string, ChartData>>> {
    return (await this.call('POST', this.app(layout, 'charts'), body)).records ?? {};
  }

  /** The custom menus in use for a record, worked out for it; undefined when FileMaker's standard menus are in use. */
  async menus(layout: string, body: { recordId?: number; mode: string; view: string; foundCount: number; totalCount: number; number?: number; menuSet?: number }): Promise<CustomMenu[] | undefined> {
    const r = await this.call('POST', this.app(layout, 'menus'), body);
    return r.standard ? undefined : r.menus;
  }

  async view(layout: string, body: { mode: string; view: string; foundCount: number; totalCount: number; records?: { id: string; number: number }[] }): Promise<{ records?: Record<string, ViewState>; find?: ViewState }> {
    return this.call('POST', this.app(layout, 'view'), body);
  }

  /** Fresh display values and formulas, retaining the supplied found-set identity and order. */
  refresh(layout: string, body: Record<string, unknown>): Promise<RefreshData> {
    return this.call('POST', this.app(layout, 'refresh'), body);
  }

  /** Runs the script of a button, on a record (or portal row) of a found set. */
  button(layout: string, body: Record<string, unknown>): Promise<ScriptRun> {
    return this.call('POST', this.app(layout, 'button'), body);
  }

  /** Asks this session's running scripts to stop (Esc); one that turned Allow User Abort off carries on. */
  stopRuns(): Promise<{ stopped: number }> {
    return this.call('POST', `/tabularius/app/v1/databases/${enc(this.db)}/runs/stop`, {});
  }

  runningProgress(): Promise<{ runs: { operation: string; completed: number; total: number }[] }> {
    return this.call('GET', `/tabularius/app/v1/databases/${enc(this.db)}/runs/progress`);
  }

  /** Continues a paused script (Pause/Resume Script), or cancels it, which halts it; returns what the script does next. */
  continueRun(run: string, go: boolean, display: Record<string, unknown> = {}): Promise<ScriptRun> {
    return this.call('POST', `/tabularius/app/v1/databases/${enc(this.db)}/runs/${enc(run)}/file`, go ? display : { cancel: true });
  }

  /** Answers a running script's Sort Records dialog with the order ([] unsorts), or cancels it; returns what the script does next. */
  answerSort(run: string, sort: SortSpec[] | undefined): Promise<ScriptRun> {
    return this.call('POST', `/tabularius/app/v1/databases/${enc(this.db)}/runs/${enc(run)}/file`, sort ? { sort } : { cancel: true });
  }

  /** Answers a running script's Insert from Index with the value picked, or cancels it; returns what the script does next. */
  answerIndex(run: string, value: string | undefined): Promise<ScriptRun> {
    return this.call('POST', `/tabularius/app/v1/databases/${enc(this.db)}/runs/${enc(run)}/file`, value === undefined ? { cancel: true } : { value });
  }

  /** Answers a running script's Show Custom Dialog with the button clicked (1-3) and the inputs, or closes it; returns what the script does next. */
  answerDialog(run: string, answer: { button: number; inputs: string[] } | undefined): Promise<ScriptRun> {
    return this.call('POST', `/tabularius/app/v1/databases/${enc(this.db)}/runs/${enc(run)}/file`, answer ?? { cancel: true });
  }

  /** Answers a running script's Insert from Device with a bar code's text, or cancels it. */
  answerText(run: string, text: string | undefined): Promise<ScriptRun> {
    return this.call('POST', `/tabularius/app/v1/databases/${enc(this.db)}/runs/${enc(run)}/file`, text === undefined ? { cancel: true } : { text });
  }

  /** Answers a running script's Location ( ) with where the device is, or says it isn't known. */
  answerLocation(run: string, at: { latitude: number; longitude: number; accuracy: number; altitude?: number; altitudeAccuracy?: number; at: number } | undefined): Promise<ScriptRun> {
    return this.call('POST', `/tabularius/app/v1/databases/${enc(this.db)}/runs/${enc(run)}/file`, at ?? { cancel: true });
  }

  /** Answers a running script's Insert File with a file, or cancels it; returns what the script does next. */
  answerRun(run: string, file: File | undefined): Promise<ScriptRun> {
    const path = `/tabularius/app/v1/databases/${enc(this.db)}/runs/${enc(run)}/file`;
    if (!file) return this.call('POST', path, { cancel: true });
    const form = new FormData();
    form.append('upload', file, file.name);
    return this.call('POST', path, form);
  }
}

/**
 * This browser's window and device, sent with each request so scripts and layout formulas get the person's own
 * Get ( Device ), Get ( WindowWidth ), Get ( ScreenWidth ) and Get ( WindowOrientation ), as FileMaker Go and
 * WebDirect give them (phone layouts are chosen this way).
 */
export function windowInfo(): string | undefined {
  // Outside a browser window (a worker, the tests): nothing to tell.
  if (typeof document === 'undefined' || typeof screen === 'undefined') return undefined;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
  const device = /iPhone|iPod/.test(ua) ? 4 : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 3
    : /Android/.test(ua) ? 5 : /Mac/.test(ua) ? 1 : /Windows/.test(ua) ? 2 : 0;
  const content = document.querySelector<HTMLElement>('.stage > .window-frame > .content');
  return JSON.stringify({
    device, width: innerWidth, height: innerHeight,
    contentWidth: content?.clientWidth ?? innerWidth, contentHeight: content?.clientHeight ?? innerHeight,
    screenWidth: screen.width, screenHeight: screen.height, scale: devicePixelRatio,
    orientation: innerWidth > innerHeight ? 1 : 0,
  });
}

/** The file types File > Export Records offers, as FileMaker's Export dialog does. */
export type ExportFormat = 'csv' | 'tab' | 'mer' | 'xlsx' | 'xml' | 'html';
