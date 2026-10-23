// What changed in a hosted file, for other systems to keep up with it: a
// change feed to poll, and webhooks that push the same changes.
//
// Change feed (signed in like the Data API, with a session or API token):
//
//   GET /tabularius/changes/v1/databases/{db}?since={cursor}&wait={seconds}&limit={n}
//     -> { changes: [{ seq, kind, table, recordId, modId, at }], next: cursor }
//
// Without `since`, it answers no changes and the cursor for "now". Pass `next`
// back as `since` to get what happened after it; `wait` (up to 60) holds the
// request open until something does (long polling). Only tables and records
// the account may view are listed. Changes are kept in memory, the last 10,000
// per file: a cursor older than that, or from before a restart, answers 410
// with a fresh cursor, and the caller reads what it needs again.
//
// A change carries no field data: kind (create, update, delete, truncate),
// table, record id and modification count. Callers read the record through
// the Data API, where the account's privileges apply.
//
// Webhooks POST the same changes to URLs an administrator sets up
// (/tabularius/admin/v1/webhooks). Like scripts, the server reaches no network
// unless started with --allow-webhooks; until then webhooks are kept but sent
// nowhere. Each POST is signed: x-tabularius-signature: sha256=<HMAC of the body
// with the webhook's secret>.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Change, Store } from '../../store/src/index.ts';
import { OutboundRefused, guardedFetch, isInternalHost, mappedIPv4, NAME_LOOKUP } from '../../scripts/src/net-guard.ts';
import { ApiError, badPathError, sessionPrivileges, type DataApi } from './dataapi.ts';
import type { Host } from './host.ts';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';
import { diagnosticEndpoint, redactDiagnosticText } from '../../scripts/src/redaction.ts';

/** Receivers set up under the old product name (openhbam) look for these headers. */
const legacyHookHeaders = (signature: string, id: string) => ({ 'x-openhbam-signature': signature, 'x-openhbam-webhook': id });
const KEEP = 10_000;
const MAX_WAIT_S = 60;
const MAX_LIMIT = 1000;

export interface FeedEntry {
  seq: number;
  kind: 'create' | 'update' | 'delete' | 'truncate';
  table: string;
  recordId?: number;
  modId?: number;
  at: string;
}

interface Feed {
  epoch: string;
  seq: number;
  entries: FeedEntry[];
  waiters: Set<() => void>;
}

export class ChangeFeed {
  private readonly host: Host;
  private readonly api: DataApi;
  /** Cursors from before a restart mean nothing now. */
  readonly epoch = randomBytes(4).toString('hex');
  private readonly feeds = new Map<string, Feed>();
  private readonly subscribers = new Set<(file: string, entry: FeedEntry) => void>();

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
    for (const s of host.openStores()) this.watch(s);
    host.onAdd.push((s) => this.watch(s));
    host.onClose.push((s) => {
      const key = s.name.toLowerCase();
      const feed = this.feeds.get(key);
      this.feeds.delete(key);
      for (const wake of feed?.waiters ?? []) wake();
    });
  }

  /** Called with every change to any file (webhooks). */
  subscribe(f: (file: string, entry: FeedEntry) => void): void {
    this.subscribers.add(f);
  }

  private feed(file: string): Feed {
    const key = file.toLowerCase();
    let f = this.feeds.get(key);
    if (!f) {
      f = { epoch: randomBytes(4).toString('hex'), seq: 0, entries: [], waiters: new Set() };
      this.feeds.set(key, f);
    }
    return f;
  }

  private watch(store: Store): void {
    store.listeners.add((c: Change) => {
      if (c.kind === 'lock' || c.kind === 'unlock' || c.kind === 'view' || c.kind === 'leave' || c.kind === 'design' || c.kind === 'designer') return;
      const f = this.feed(c.file);
      const entry: FeedEntry = {
        seq: ++f.seq, kind: c.kind, table: c.table,
        ...(c.recordId !== undefined ? { recordId: c.recordId } : {}),
        ...(c.modId !== undefined ? { modId: c.modId } : {}),
        at: new Date().toISOString(),
      };
      f.entries.push(entry);
      if (f.entries.length > KEEP) f.entries.splice(0, f.entries.length - KEEP);
      for (const w of f.waiters) w();
      f.waiters.clear();
      for (const s of this.subscribers) {
        try {
          s(c.file, entry);
        } catch {
          // a subscriber's trouble is its own
        }
      }
    });
  }

  private cursor(feed: Feed, seq: number): string {
    return `${feed.epoch}-${seq}`;
  }

  /** Returns false when the request is not for the change feed. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/changes\/v1\/databases\/([^/]+)$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    try {
      if (req.method !== 'GET') return send(405, { error: 'method not allowed' }), true;
      const db = decodeURIComponent(m[1]);
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      let privileges = sessionPrivileges(store, session);
      const f = this.feed(store.name);
      const since = url.searchParams.get('since');
      if (since === null) return send(200, { changes: [], next: this.cursor(f, f.seq) }), true;
      const cm = /^([0-9a-f]+)-(\d+)$/.exec(since);
      const from = cm && cm[1] === f.epoch ? Number(cm[2]) : NaN;
      const oldest = f.entries.length ? f.entries[0].seq : f.seq + 1;
      if (!Number.isSafeInteger(from) || from > f.seq || from < oldest - 1) {
        return send(410, { error: 'This cursor is too old or from before a restart: read what you need again, then continue from next.', next: this.cursor(f, f.seq) }), true;
      }
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit') ?? MAX_LIMIT) || MAX_LIMIT));
      let wait = Math.min(MAX_WAIT_S, Math.max(0, Number(url.searchParams.get('wait') ?? 0) || 0)) * 1000;
      const deadline = performance.now() + wait;
      let after = from;
      for (;;) {
        if (this.feeds.get(store.name.toLowerCase()) !== f) throw new ApiError(802, 'The file was closed; start a new change feed', 410);
        // A long poll can outlive the request that authorized it. Revalidate
        // the same principal and selected mapping every time it resumes.
        if (!this.api.alive(session.token)) throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
        privileges = sessionPrivileges(store, session);
        const fresh = f.entries.filter((e) => e.seq > after);
        const visible: FeedEntry[] = [];
        let last = after;
        for (const e of fresh) {
          if (visible.length >= limit) break;
          last = e.seq;
          if (this.visible(store, e, privileges)) visible.push(e);
        }
        if (visible.length || wait <= 0 || res.destroyed) return send(200, { changes: visible, next: this.cursor(f, last) }), true;
        // Everything new was out of sight: move past it and keep waiting.
        after = last;
        wait = deadline - performance.now();
        if (wait <= 0) return send(200, { changes: [], next: this.cursor(f, after) }), true;
        if (f.waiters.size >= 256) throw new ApiError(956, 'Too many change-feed requests are waiting; try again later', 503);
        if (req.socket.destroyed || res.destroyed || res.writableEnded) return true;
        await new Promise<void>((ok) => {
          const done = () => {
            clearTimeout(timer);
            f.waiters.delete(done);
            req.off('close', done);
            ok();
          };
          const timer = setTimeout(done, wait);
          f.waiters.add(done);
          req.once('close', done);
        });
      }
    } catch (e) {
      const err = e instanceof URIError ? badPathError() : e;
      if (err instanceof ApiError) send(err.status, { messages: [{ code: String(err.code), message: err.message }] });
      else send(500, { error: (e as Error).message });
    }
    return true;
  }

  private visible(store: Store, e: FeedEntry, privileges: ReturnType<typeof sessionPrivileges>): boolean {
    if (privileges.full) return true;
    const view = privileges.table(e.table).view;
    if (view === false) return false;
    if (view === true || e.recordId === undefined) return true;
    return store.canViewRecord(e.table, e.recordId, privileges);
  }
}

// Webhooks -------------------------------------------------------------------

const HOOKS_FILE = '.openhbam-webhooks.json';
const BATCH_MS = 1000;
const MAX_BATCH = 500;
const TRIES = 5;
const TIMEOUT_MS = 10_000;

export interface Webhook {
  id: string;
  url: string;
  /** Hosted file whose changes it gets. */
  database: string;
  /** Only these tables; all when absent. */
  tables?: string[];
  /** Signs each delivery; shown once, when the webhook is made. */
  secret: string;
  enabled: boolean;
}

export interface WebhookState {
  queued: number;
  lastOk?: string;
  lastError?: { at: string; message: string };
  delivered: number;
  dropped: number;
}

export class WebhookError extends Error {}

// A webhook goes through the shared outbound guard (scripts/src/net-guard.ts): never to a link-local or metadata address,
// checked after the name is resolved and again on every redirect. Loopback and private LAN ranges stay allowed: a
// collector on the same host or network is a legitimate destination for a URL an administrator typed in.
export { isInternalHost, mappedIPv4, NAME_LOOKUP };

async function webhookFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  try {
    return await guardedFetch(input, init, { policy: { private: true }, timeoutMs: 60_000, maxBytes: 4 * 1024 * 1024 });
  } catch (e) {
    if (e instanceof OutboundRefused) throw new WebhookError(e.message);
    throw e;
  }
}

export class Webhooks {
  private readonly host: Host;
  private readonly log: (m: string) => void;
  /** Sending is allowed only when the server was started with --allow-webhooks. */
  readonly allowed: boolean;
  private hooks: Webhook[] = [];
  private readonly queues = new Map<string, { file: string; entry: FeedEntry }[]>();
  private readonly states = new Map<string, WebhookState>();
  private readonly busy = new Set<string>();
  private timer?: NodeJS.Timeout;
  private stopped = false;
  /** Swappable for tests. The real one refuses a name that resolves to the link-local range, as connections do. */
  fetch: typeof fetch = webhookFetch;

  constructor(host: Host, feed: ChangeFeed, allowed: boolean, log: (m: string) => void = () => {}) {
    this.host = host;
    this.allowed = allowed;
    this.log = log;
    const f = join(host.dir, HOOKS_FILE);
    if (existsSync(f)) {
      try {
        this.hooks = (readJsonStateSync<{ webhooks?: Webhook[] }>(f)).webhooks ?? [];
      } catch (e) {
        log(`webhooks: can't read ${HOOKS_FILE}: ${(e as Error).message}`);
      }
    }
    feed.subscribe((file, entry) => this.enqueue(file, entry));
  }

  /** Webhooks without their secrets, with how delivery is going. */
  list(): (Omit<Webhook, 'secret'> & WebhookState & { sending: boolean })[] {
    return this.hooks.map(({ secret: _s, ...h }) => ({ ...h, ...this.state(h.id), sending: this.allowed && h.enabled }));
  }

  private state(id: string): WebhookState {
    let s = this.states.get(id);
    if (!s) {
      s = { queued: 0, delivered: 0, dropped: 0 };
      this.states.set(id, s);
    }
    s.queued = this.queues.get(id)?.length ?? 0;
    return s;
  }

  create(input: Record<string, unknown>): Webhook {
    const url = String(input.url ?? '');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new WebhookError('Give the URL to send changes to');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new WebhookError('Webhook URLs are http or https');
    if (parsed.username || parsed.password) throw new WebhookError('Put no credentials in the URL: deliveries are signed with the webhook\'s secret');
    if (isInternalHost(parsed.hostname)) throw new WebhookError('That host is on the link-local range; a webhook can\'t be pointed at a cloud metadata endpoint (169.254.169.254)');
    const database = String(input.database ?? '');
    const store = this.host.get(database);
    if (!store) throw new WebhookError(`"${database}" is not hosted`);
    let tables: string[] | undefined;
    if (input.tables !== undefined) {
      if (!Array.isArray(input.tables)) throw new WebhookError('tables is a list of table names');
      tables = input.tables.map(String);
      const known = new Set(store.schema.tables.map((t) => t.name));
      const unknown = tables.filter((t) => !known.has(t));
      if (unknown.length) throw new WebhookError(`No table named ${unknown.join(', ')} in ${store.name}`);
    }
    const hook: Webhook = {
      id: randomBytes(6).toString('hex'), url, database: store.name, ...(tables?.length ? { tables } : {}),
      secret: randomBytes(24).toString('base64url'), enabled: input.enabled !== false,
    };
    this.hooks.push(hook);
    this.save(hook, undefined, true);
    return hook;
  }

  update(id: string, input: Record<string, unknown>): Omit<Webhook, 'secret'> {
    const h = this.hooks.find((x) => x.id === id);
    if (!h) throw new WebhookError('no such webhook');
    if (input.enabled !== undefined) h.enabled = input.enabled === true;
    this.save(h);
    const { secret: _s, ...shown } = h;
    return shown;
  }

  remove(id: string): boolean {
    const i = this.hooks.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.hooks.splice(i, 1);
    this.queues.delete(id);
    this.states.delete(id);
    this.save(undefined, id);
    return true;
  }

  private save(changed?: Webhook, removedId?: string, create = false): void {
    const f = join(this.host.dir, HOOKS_FILE);
    const saved = updateJsonStateSync<{ webhooks: Webhook[] }>(f, { webhooks: [] }, (current) => {
      const webhooks = current.webhooks ?? [];
      return { webhooks: removedId ? webhooks.filter((h) => h.id !== removedId)
        : changed ? webhooks.some((h) => h.id === changed.id)
          ? webhooks.map((h) => h.id === changed.id ? changed : h) : create ? [...webhooks, changed] : webhooks
          : webhooks };
    }, { mode: 0o600 });
    this.hooks = saved.webhooks;
  }

  private enqueue(file: string, entry: FeedEntry): void {
    if (!this.allowed || this.stopped) return;
    for (const h of this.hooks) {
      if (!h.enabled || h.database.toLowerCase() !== file.toLowerCase()) continue;
      if (h.tables && !h.tables.includes(entry.table)) continue;
      let q = this.queues.get(h.id);
      if (!q) {
        q = [];
        this.queues.set(h.id, q);
      }
      q.push({ file, entry });
      // A receiver that is down doesn't make the server hold everything forever.
      if (q.length > 10 * MAX_BATCH) {
        const over = q.length - 10 * MAX_BATCH;
        q.splice(0, over);
        this.state(h.id).dropped += over;
      }
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, BATCH_MS);
      this.timer.unref();
    }
  }

  /** Sends what is waiting, one batch per webhook. */
  async flush(): Promise<void> {
    await Promise.all(this.hooks.map((h) => this.deliver(h)));
  }

  private async deliver(h: Webhook): Promise<void> {
    if (this.busy.has(h.id)) return;
    const q = this.queues.get(h.id);
    if (!q?.length) return;
    this.busy.add(h.id);
    const batch = q.splice(0, MAX_BATCH);
    const body = JSON.stringify({ webhook: h.id, database: h.database, changes: batch.map((b) => b.entry) });
    const signature = 'sha256=' + createHmac('sha256', h.secret).update(body).digest('hex');
    const state = this.state(h.id);
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await this.fetch(h.url, {
            method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { 'content-type': 'application/json', 'user-agent': 'tabularius-webhooks', 'x-tabularius-signature': signature, 'x-tabularius-webhook': h.id, ...legacyHookHeaders(signature, h.id) },
          });
          // Only the status is used. Cancel success and error bodies before delivery or retry.
          await r.body?.cancel().catch(() => {});
          if (r.status < 200 || r.status >= 300) throw new Error(`the address answered HTTP ${r.status}`);
          state.delivered += batch.length;
          state.lastOk = new Date().toISOString();
          break;
        } catch (e) {
          state.lastError = { at: new Date().toISOString(), message: (e as Error).message };
          if (attempt >= TRIES || this.stopped) {
            state.dropped += batch.length;
            this.log(`webhook ${h.id} (${diagnosticEndpoint(h.url)}): dropped ${batch.length} changes after ${attempt} tries: ${redactDiagnosticText((e as Error).message)}`);
            break;
          }
          await new Promise((ok) => setTimeout(ok, 1000 * 2 ** (attempt - 1)).unref());
        }
      }
    } finally {
      this.busy.delete(h.id);
    }
    if (q.length && !this.stopped) void this.deliver(h);
  }

  /**
   * Posts one message (a scheduled digest's run) to a webhook of the same file, signed like change deliveries and
   * tried as often; throws when it couldn't be delivered.
   */
  async post(id: string, database: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.allowed) throw new WebhookError('webhooks are off on this server (start it with --allow-webhooks)');
    const h = this.hooks.find((x) => x.id === id);
    if (!h) throw new WebhookError('the webhook has been removed');
    if (!h.enabled) throw new WebhookError('the webhook is turned off');
    if (h.database.toLowerCase() !== database.toLowerCase()) throw new WebhookError(`the webhook is for ${h.database}`);
    const body = JSON.stringify({ webhook: h.id, ...payload });
    const signature = 'sha256=' + createHmac('sha256', h.secret).update(body).digest('hex');
    const state = this.state(h.id);
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await this.fetch(h.url, {
          method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'content-type': 'application/json', 'user-agent': 'tabularius-webhooks', 'x-tabularius-signature': signature, 'x-tabularius-webhook': h.id, ...legacyHookHeaders(signature, h.id) },
        });
        await r.body?.cancel().catch(() => {});
        if (r.status < 200 || r.status >= 300) throw new Error(`the address answered HTTP ${r.status}`);
        state.delivered++;
        state.lastOk = new Date().toISOString();
        return;
      } catch (e) {
        state.lastError = { at: new Date().toISOString(), message: (e as Error).message };
        if (attempt >= TRIES || this.stopped) {
          state.dropped++;
          throw new WebhookError(`not delivered after ${attempt} tries: ${(e as Error).message}`);
        }
        await new Promise((ok) => setTimeout(ok, 1000 * 2 ** (attempt - 1)).unref());
      }
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
