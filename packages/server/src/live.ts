// Live editing for several people at once: record locks and a change stream.
//
//   GET    /tabularius/live/v1/databases/{db}/events        Server-Sent Events: record and lock changes
//   GET    /tabularius/live/v1/databases/{db}/clients       who is logged in to the file
//   GET    /tabularius/live/v1/databases/{db}/locks         records being edited now
//   GET    /tabularius/live/v1/databases/{db}/viewers       who is looking at which record now
//   POST   /tabularius/live/v1/databases/{db}/layouts/{layout}/records/{id}/lock   take or renew a lock
//   DELETE /tabularius/live/v1/databases/{db}/layouts/{layout}/records/{id}/lock   release it
//   POST   /tabularius/live/v1/databases/{db}/layouts/{layout}/records/{id}/view   "I'm looking at this record" (renew while shown)
//   DELETE /tabularius/live/v1/databases/{db}/layouts/{layout}/records/{id}/view   stopped looking
//   GET    /tabularius/live/v1/databases/{db}/design         who else is in design mode, and on which layout
//   POST   /tabularius/live/v1/databases/{db}/design         {"layout"|"script"|"table": id (or none), "selection": [ids]}: "I'm
//                                                          in design mode here" (renew while open); others get a `designer`
//                                                          change (table _design, _design/scripts or _design/tables)
//   DELETE /tabularius/live/v1/databases/{db}/design         left design mode
//
// Design mode (accounts that can change the design) also gets a `design` change
// whenever anyone saves a design change, with the layouts (table _design), scripts (_design/scripts) or tables
// (_design/tables) it touched in `ids`.
//
// All take the Data API session token (Bearer). A locked record can still be
// read by everyone; writes by anyone but the lock's session get error 301,
// over the Data API, scripts and MCP alike (the check is in the store).
// The stream is fetched rather than opened with EventSource, so the token
// goes in a header instead of the URL.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { DESIGN_TABLE, DESIGN_SCRIPTS, DESIGN_TABLES, isDesignTable, StoreError, type Change, type Store } from '../../store/src/index.ts';
import { ApiError, badPathError, readJson, sessionPrivileges, type DataApi, type Session } from './dataapi.ts';
import type { Host } from './host.ts';

const HEARTBEAT_MS = 20_000;
/** Event streams one session may hold open at once (a person's windows and tabs); opening one more closes its oldest. */
export const MAX_STREAMS_PER_SESSION = 10;
/** Across sessions in this process; transport connection limits also cover idle handshakes and other streams. */
export const MAX_LIVE_STREAMS = 256;
/** Bytes a stream may have waiting to be sent before its reader is counted as stalled and cut off (it reconnects). */
export const MAX_STREAM_BUFFER = 256 * 1024;

/**
 * Writes to a stream unless it has ended; a stream whose reader has stopped taking data (more than MAX_STREAM_BUFFER
 * waiting) is destroyed instead, so one stalled client never makes the server hold its events without end.
 */
export function putStream(res: ServerResponse, chunk: string): boolean {
  if (res.writableEnded || res.destroyed) return false;
  if (res.writableLength > MAX_STREAM_BUFFER) {
    res.destroy();
    return false;
  }
  res.write(chunk);
  return true;
}

export class Live {
  private readonly host: Host;
  private readonly api: DataApi;
  private readonly streams = new Set<ServerResponse>();
  /** Open streams by session token, so the admin console can message one client. */
  private readonly byToken = new Map<string, Set<ServerResponse>>();

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
    this.api.endListeners.add((token) => this.closeToken(token));
  }

  private closeToken(token: string): void {
    for (const res of [...(this.byToken.get(token) ?? [])]) {
      const close = (res as ServerResponse & { closeStream?: () => void }).closeStream;
      close?.();
    }
  }

  /**
   * When the server runs as several processes (cluster.ts): passes a message
   * on to the others, and counts the streams they have open, by token.
   */
  elsewhere?: { message(text: string, token?: string): void; streams(token?: string): number };

  /** Open live-update streams (in every process of the server). */
  get streamCount(): number {
    return this.streams.size + (this.elsewhere?.streams() ?? 0);
  }

  /** This process's open streams for a session. */
  streamsOf(token: string): number {
    return this.byToken.get(token)?.size ?? 0;
  }

  /**
   * Pushes a message to connected web clients (FileMaker's "Send Message to
   * clients"), as an SSE `message` event the web client shows. With a token,
   * only that session's streams; otherwise everyone. Returns how many streams
   * it reached (REST/Data API clients hold no stream, so they get none).
   */
  message(text: string, token?: string): number {
    if (this.elsewhere && !(token && this.byToken.has(token))) {
      this.elsewhere.message(text, token);
      return this.deliver(text, token) + this.elsewhere.streams(token);
    }
    return this.deliver(text, token);
  }

  /** message, to this process's streams only. */
  deliver(text: string, token?: string): number {
    const payload = `event: message\ndata: ${JSON.stringify({ text })}\n\n`;
    const targets = token ? this.byToken.get(token) : this.streams;
    let n = 0;
    for (const res of [...targets ?? []]) if (putStream(res, payload)) n++;
    return n;
  }

  /** Returns false when the request is not a live path. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/live\/v1\/databases\/([^/]+)\/(events|clients|locks|viewers|design|layouts\/([^/]+)\/records\/(\d+)\/(lock|view))$/.exec(url.pathname);
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
      const method = req.method ?? 'GET';
      const privileges = sessionPrivileges(store, session);
      if (m[2] === 'events' && method === 'GET') {
        this.stream(req, res, store, session);
        return true;
      }
      if (m[2] === 'clients' && method === 'GET') {
        send(200, { clients: this.api.list().filter((c) => c.db.toLowerCase() === store.name.toLowerCase()).map(({ account, idleSeconds, since }) => ({ account, idleSeconds, since })) });
        return true;
      }
      if (m[2] === 'locks' && method === 'GET') {
        const locks = [...this.files(store)].flatMap((s) => s.locks.all().filter((l) => s.canViewRecord(l.table, l.recordId, privileges)).map((l) => ({
          file: s.name, table: l.table, recordId: l.recordId, account: l.account, self: l.owner === session.token,
        })));
        send(200, { locks });
        return true;
      }
      if (m[2] === 'viewers' && method === 'GET') {
        const viewers = [...this.files(store)].flatMap((s) => s.locks.viewers().filter((v) => isDesignTable(v.table) ? s === store && privileges.full : s.canViewRecord(v.table, v.recordId, privileges)).map((v) => ({
          file: s.name, table: v.table, recordId: v.recordId, account: v.account, self: v.owner === session.token,
        })));
        send(200, { viewers });
        return true;
      }
      if (m[2] === 'design') {
        // Who is in design mode: presence rides on "viewing" entries under the design tables (record id = the layout,
        // script or table they have open, 0 for none), shared across server processes.
        if (!privileges.full) throw new ApiError(9, 'Design mode needs full access', 403);
        const WHERE = { layout: DESIGN_TABLE, script: DESIGN_SCRIPTS, table: DESIGN_TABLES } as const;
        const kindOf = (table: string) => (Object.keys(WHERE) as (keyof typeof WHERE)[]).find((k) => WHERE[k] === table);
        const present = () => store.locks.viewers().filter((v) => isDesignTable(v.table));
        const mine = () => present().filter((v) => v.owner === session.token);
        if (method === 'GET') {
          send(200, { designers: present().map((v) => {
            const kind = kindOf(v.table) ?? 'layout';
            // `layout` for each, as before scripts and tables had presence: null when not on a layout.
            return { account: v.account, layout: kind === 'layout' ? v.recordId || null : null, ...(kind !== 'layout' && v.recordId ? { [kind]: v.recordId } : {}), self: v.owner === session.token };
          }) });
        } else if (method === 'POST') {
          const body = await readJson(req);
          const id = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0);
          // One place at a time: a layout, a script or a table (with its fields), or none (0) for the lists.
          const [kind, at] = id(body.script) ? ['script', id(body.script)] as const : id(body.table) ? ['table', id(body.table)] as const : ['layout', id(body.layout)] as const;
          const table = WHERE[kind];
          const selection = Array.isArray(body.selection) ? body.selection.filter((x: unknown) => Number.isInteger(x)).slice(0, 500) as number[] : [];
          for (const v of mine()) if (v.table !== table || v.recordId !== at) store.locks.leave(v.table, v.recordId, session.token);
          store.locks.view(table, at, session.token, session.account);
          store.notify('designer', table, at, undefined, { owner: session.token, account: session.account }, undefined, selection);
          send(200, {});
        } else if (method === 'DELETE') {
          for (const v of mine()) store.locks.leave(v.table, v.recordId, session.token);
          store.notify('leave', DESIGN_TABLE, undefined, undefined, { owner: session.token, account: session.account });
          send(200, {});
        } else throw new ApiError(3, 'Command is unavailable', 405);
        return true;
      }
      if (m[4] !== undefined && m[5] === 'view' && (method === 'POST' || method === 'DELETE')) {
        const info = store.layout(decodeURIComponent(m[3]));
        const owner = info.owner;
        const id = Number(m[4]);
        if (method === 'DELETE') {
          if (owner.locks.leave(info.table, id, session.token)) owner.notify('leave', info.table, id);
        } else {
          if (!store.canView(info, id, privileges)) throw new ApiError(200, 'Record access is denied', 403);
          if (owner.locks.view(info.table, id, session.token, session.account)) owner.notify('view', info.table, id);
        }
        send(200, {});
        return true;
      }
      if (m[4] !== undefined && (method === 'POST' || method === 'DELETE')) {
        const info = store.layout(decodeURIComponent(m[3]));
        const owner = info.owner;
        const id = Number(m[4]);
        if (method === 'DELETE') {
          // Only the session that holds a lock lets it go; for anyone else, or a record nobody holds, nothing was released.
          const released = owner.locks.release(info.table, id, session.token);
          if (released) owner.notify('unlock', info.table, id);
          send(200, { released });
          return true;
        }
        store.checkEditable(info, id, privileges); // 101 when the record is missing, 200 when the account can't edit it
        const r = owner.locks.acquire(info.table, id, session.token, session.account);
        if (!r.ok) throw new ApiError(301, `Record is in use by another user (${r.lock.account})`, 409);
        if (r.fresh) owner.notify('lock', info.table, id);
        send(200, { lock: { account: r.lock.account, expires: new Date(r.lock.expires).toISOString() } });
        return true;
      }
      throw new ApiError(3, 'Command is unavailable', 405);
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof StoreError ? new ApiError(e.code, e.message, 400) : e instanceof URIError ? badPathError() : new ApiError(-1, 'Unknown error');
      if (!(e instanceof ApiError) && !(e instanceof StoreError) && !(e instanceof URIError)) console.error(e);
      if (!res.headersSent) send(err.status, { error: { code: err.code, message: err.message } });
    }
    return true;
  }

  /** Ends every open event stream (server shutdown), after telling each one why: a client reconnects once the server is back. */
  closeAll(): void {
    for (const res of this.streams) {
      putStream(res, `event: shutdown\ndata: {"reason":"restart"}\n\n`);
      res.end();
    }
  }

  /** The file and the other hosted files its layouts show tables from. */
  private files(store: Store): Set<Store> {
    const out = new Set<Store>([store]);
    for (const l of store.layouts()) {
      const other = l.file ? this.host.get(l.file) : undefined;
      if (other) out.add(other);
    }
    return out;
  }

  private stream(req: IncomingMessage, res: ServerResponse, store: Store, session: Session): void {
    if (req.socket.destroyed || res.destroyed || res.writableEnded || !this.api.alive(session.token)) return;
    const token = session.token;
    // The oldest goes, not the new one: a client that lost its network leaves streams the server cannot yet tell are
    // dead, and refusing its reconnects would leave it without updates until they time out.
    const held = this.byToken.get(token);
    while (held && held.size >= MAX_STREAMS_PER_SESSION) {
      const oldest = held.values().next().value as ServerResponse;
      held.delete(oldest);
      this.streams.delete(oldest);
      oldest.destroy();
    }
    if (this.streams.size >= MAX_LIVE_STREAMS) {
      res.writeHead(503, { 'retry-after': '1', 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Too many live streams' }));
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // let nginx pass events straight through
    });
    res.write(`retry: 3000\n\n`);
    const listener = (c: Change) => {
      if (stopped || res.writableEnded) return;
      // An account turned off gets no more changes: its window is told to sign in again instead.
      if (this.api.accountDisabled(token)) return expire();
      // Privileges are read per event, so a revoke applies at once; changes to tables the account can't see are left out.
      let visible: boolean;
      let ids = c.ids;
      try {
        const file = [...files].find((f) => f.name === c.file);
        const privileges = sessionPrivileges(store, session);
        // Design changes and who is in design mode: only for accounts that can change this file's design.
        visible = !!file && (isDesignTable(c.table) ? file === store && privileges.full : file.tableVisible(c.table, privileges));
        if (visible && file && !isDesignTable(c.table)) {
          if (c.recordId !== undefined) visible = file.canViewRecord(c.table, c.recordId, privileges);
          if (ids) {
            ids = ids.filter((id) => file.canViewRecord(c.table, id, privileges));
            if (!ids.length) visible = false;
          }
        }
      } catch {
        visible = false;
      }
      if (!visible) return;
      const event = {
        kind: c.kind, file: c.file, table: c.table, recordId: c.recordId, modId: c.modId,
        account: c.account, self: c.owner !== undefined && c.owner === token, ...(ids ? { ids } : {}),
      };
      // Events from one moment go out in one write: with many people connected, a write per event per stream is most of the work.
      if (!pending) queueMicrotask(flush);
      pending += `event: change\ndata: ${JSON.stringify(event)}\n\n`;
    };
    let pending = '';
    const flush = () => {
      if (stopped || res.writableEnded) return;
      if (!this.api.alive(token)) {
        expire();
        pending = '';
        return;
      }
      putStream(res, pending);
      pending = '';
    };
    const files = this.files(store);
    for (const s of files) s.listeners.add(listener);
    const beat = setInterval(() => {
      if (!this.api.alive(token)) return expire();
      putStream(res, `: ping\n\n`);
    }, HEARTBEAT_MS);
    this.streams.add(res);
    let forToken = this.byToken.get(token);
    if (!forToken) this.byToken.set(token, (forToken = new Set()));
    forToken.add(res);
    let stopped = false;
    const expire = () => {
      if (stopped) return;
      putStream(res, `event: expired\ndata: {}\n\n`);
      res.end();
      stop();
      pending = '';
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      this.streams.delete(res);
      const set = this.byToken.get(token);
      if (set && (set.delete(res), set.size === 0)) this.byToken.delete(token);
      clearInterval(beat);
      for (const s of files) s.listeners.delete(listener);
    };
    (res as ServerResponse & { closeStream?: () => void }).closeStream = expire;
    req.on('close', stop);
    res.on('close', stop);
  }
}
