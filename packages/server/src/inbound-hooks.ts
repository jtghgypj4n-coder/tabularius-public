import { itemNetwork } from './item-network.ts';
import { clientAddress } from './client-address.ts';
// Inbound webhooks: another service (a payment provider, a form, a CI job) calls the server, and a chosen script
// runs with the JSON it sent as Get ( ScriptParameter ). FileMaker has no way in like this short of the Data API
// and an account; here each hook has its own secret, every call is signed with it, and nothing else is reachable.
//
//   POST /tabularius/hooks/v1/{id}       the call: a JSON body, signed (below)
//
// Signing: X-Tabularius-Timestamp is the time in Unix seconds, and X-Tabularius-Signature is "sha256=" and the hex
// HMAC-SHA256, with the hook's secret, of the timestamp, a ".", and the body as sent. A call more than five
// minutes from the server's clock, or one already seen, is refused, so a captured call can't be sent again.
//
// Off by default: calls are answered only on a server started with --allow-inbound-hooks. Hooks are set up in the
// admin console (or its API), which shows each one's recent calls; the secret is shown once, when the hook is made
// or its secret is changed, and never again. Scripts run as the hook's account, within its privileges, as
// automations do: offline unless the server and the hook both allow the network, mail only through the server's
// outbound settings, and no AI steps (the payload is someone else's data). A capture-only file never has one.
//
//   GET    /tabularius/admin/v1/inbound-hooks             hooks (no secrets), whether calls are answered, recent calls
//   POST   /tabularius/admin/v1/inbound-hooks             {name, database, script, account, layout?, perMinute?, network?}
//   PATCH  /tabularius/admin/v1/inbound-hooks/{id}        {enabled?, name?, script?, account?, layout?, perMinute?, network?}
//   POST   /tabularius/admin/v1/inbound-hooks/{id}/secret a new secret (the old one stops working)
//   DELETE /tabularius/admin/v1/inbound-hooks/{id}

import { ApiError, readBody } from './dataapi.ts';
import { parseRequestJson } from './request-json.ts';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { addressBucket, writer } from '../../store/src/index.ts';
import { captureOnly, runScript } from '../../scripts/src/index.ts';
import type { Host } from './host.ts';
import { readJsonStateSync, updateJsonStateSync, withStateLock, writeStateFileSync } from '../../store/src/durable.ts';

export interface InboundHook {
  id: string;
  name: string;
  database: string;
  script: string;
  /** The account the script runs as: its privilege set applies. */
  account: string;
  /** Where the script starts; without one, the file's first layout. */
  layout?: string;
  enabled: boolean;
  /** Calls a minute it answers; more get 429. */
  perMinute: number;
  /** Insert from URL may reach the network: only when the server also allows scripts the network. */
  network?: boolean;
  secret: string;
  created: string;
}

export interface HookCall {
  at: string;
  /** The HTTP status the caller got. */
  status: number;
  outcome: 'ok' | 'error' | 'refused';
  error?: number;
  message?: string;
  ms?: number;
  /** The body's size; the body itself is never kept (it is someone else's data). */
  bytes?: number;
  from?: string;
}

export class HookError extends Error {}

const HOOKS_FILE = 'inbound-hooks.json';
const CALLS_FILE = 'inbound-hook-calls.jsonl';
const REPLAYS_FILE = 'inbound-hook-replays.sqlite';
export const MAX_REPLAY_CLAIMS = 100_000;
/** The largest body a call may send. */
export const MAX_BODY = 256 * 1024;
/** How far a call's timestamp may be from the server's clock. */
const SKEW_S = 300;
/** Calls shown per hook, and lines kept in the calls file before it is trimmed. */
const CALLS_SHOWN = 20;
const CALLS_KEPT = 1000;
/** Bad calls (wrong signature, unknown hook) one address may make in a minute before it gets 429. */
const BAD_PER_MINUTE = 20;
const RESULT_CHARS = 10_000;
const TIMEOUT_MS = 30_000;
/** Changes a hook's script makes carry this as their writer. */
const OWNER = 'inbound-hook:';

const lower = (s: string) => s.toLowerCase();

export class InboundHooks {
  private readonly host: Host;
  private readonly log: (m: string) => void;
  /** Calls are answered only when the server was started with --allow-inbound-hooks. */
  readonly allowed: boolean;
  private hooks: InboundHook[] = [];
  /** The hooks file's modification time when read: another worker's change is read again. */
  private readAt = -1;
  /** Recent calls per hook and recent bad calls per address, for the rate limits (per server process). */
  private readonly recent = new Map<string, number[]>();
  private readonly bad = new Map<string, number[]>();

  constructor(host: Host, allowed: boolean, log: (m: string) => void = () => {}) {
    this.host = host;
    this.allowed = allowed;
    this.log = log;
    this.load();
  }

  private file(): string {
    return join(this.host.dir, HOOKS_FILE);
  }

  private load(): void {
    const f = this.file();
    let mtime = 0;
    try {
      mtime = statSync(f).mtimeMs;
    } catch {
      this.hooks = [];
      this.readAt = 0;
      return;
    }
    if (mtime === this.readAt) return;
    try {
      this.hooks = (readJsonStateSync<{ hooks?: InboundHook[] }>(f)).hooks ?? [];
      this.readAt = mtime;
    } catch (e) {
      this.log(`inbound hooks: can't read ${HOOKS_FILE}: ${(e as Error).message}`);
    }
  }

  private save(changed?: InboundHook, removedId?: string, create = false): void {
    const f = this.file();
    const saved = updateJsonStateSync<{ hooks: InboundHook[] }>(f, { hooks: [] }, (current) => {
      const hooks = current.hooks ?? [];
      return { hooks: removedId ? hooks.filter((h) => h.id !== removedId)
        : changed ? hooks.some((h) => h.id === changed.id)
          ? hooks.map((h) => h.id === changed.id ? changed : h) : create ? [...hooks, changed] : hooks
          : hooks };
    }, { mode: 0o600 });
    this.hooks = saved.hooks;
    this.readAt = statSync(f).mtimeMs;
  }

  /** Hooks without their secrets, each with its address and recent calls. */
  list(): (Omit<InboundHook, 'secret'> & { path: string; calls: HookCall[]; fullAccess: boolean })[] {
    this.load();
    const calls = this.calls();
    return this.hooks.map(({ secret: _s, ...h }) => ({ ...h, path: `/tabularius/hooks/v1/${h.id}`, calls: calls.get(h.id) ?? [], fullAccess: this.fullAccess(h) }));
  }

  /** Whether the hook's script runs with Full Access (shown as a warning: whoever has the secret gets its result). */
  private fullAccess(h: Pick<InboundHook, 'database' | 'account'>): boolean {
    try {
      return this.host.get(h.database)?.privileges(h.account).full ?? false;
    } catch {
      return false;
    }
  }

  /** The hook as sent, checked against the hosted file: script, account and layout exist; not a capture-only. */
  private clean(input: Record<string, unknown>, old?: InboundHook): Omit<InboundHook, 'id' | 'secret' | 'created'> {
    const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : undefined);
    const name = (str('name') ?? old?.name ?? '').slice(0, 120);
    if (!name) throw new HookError('Give the hook a name');
    const database = old?.database ?? str('database') ?? '';
    const store = this.host.get(database);
    if (!store) throw new HookError(`"${database}" is not hosted`);
    if (captureOnly(store.name, this.host.scriptOptions().outbound?.captureOnly)) throw new HookError(`"${store.name}" is a capture-only file: it never has inbound hooks`);
    const script = str('script') ?? old?.script ?? '';
    if (!store.schema.scripts.some((s) => s.name === script)) throw new HookError(`No script "${script}" in ${store.name}`);
    const account = str('account') ?? old?.account ?? '';
    const known = store.accounts().find((a) => lower(a.name) === lower(account));
    if (known?.inactive) throw new HookError(`The account "${account}" is inactive`);
    if (!known) throw new HookError(`No account "${account}" in ${store.name}`);
    const layout = input.layout === null ? undefined : str('layout') ?? old?.layout;
    if (layout && !store.schema.layouts.some((l) => l.name === layout)) throw new HookError(`No layout "${layout}" in ${store.name}`);
    const perMinute = input.perMinute === undefined ? old?.perMinute ?? 60 : Number(input.perMinute);
    if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > 6000) throw new HookError('Calls a minute is a whole number from 1 to 6000');
    const network = input.network === undefined ? old?.network === true : input.network === true;
    return {
      name, database: store.name, script, account: known.name, ...(layout ? { layout } : {}),
      enabled: input.enabled === undefined ? old?.enabled ?? true : input.enabled === true, perMinute, ...(network ? { network } : {}),
    };
  }

  /** A new hook, with its secret: the only time the secret is shown. */
  create(input: Record<string, unknown>): Omit<InboundHook, 'secret'> & { secret: string; path: string } {
    this.load();
    const hook: InboundHook = { ...this.clean(input), id: randomBytes(9).toString('hex'), secret: newSecret(), created: new Date().toISOString() };
    this.hooks.push(hook);
    this.save(hook, undefined, true);
    return { ...hook, path: `/tabularius/hooks/v1/${hook.id}` };
  }

  update(id: string, input: Record<string, unknown>): Omit<InboundHook, 'secret'> {
    this.load();
    const i = this.hooks.findIndex((h) => h.id === id);
    if (i < 0) throw new HookError('No such hook');
    const old = this.hooks[i];
    const changed = { ...old, ...this.clean(input, old) };
    this.hooks[i] = changed;
    this.save(changed);
    const { secret: _s, ...shown } = changed;
    return shown;
  }

  /** A new secret for the hook; calls signed with the old one are refused from now on. */
  newSecret(id: string): { id: string; secret: string } {
    this.load();
    const h = this.hooks.find((x) => x.id === id);
    if (!h) throw new HookError('No such hook');
    h.secret = newSecret();
    this.save(h);
    return { id, secret: h.secret };
  }

  remove(id: string): boolean {
    this.load();
    const i = this.hooks.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.hooks.splice(i, 1);
    this.save(undefined, id);
    return true;
  }

  // --- calls ---------------------------------------------------------------------------

  private logCall(id: string, call: HookCall): void {
    const f = join(this.host.dir, CALLS_FILE);
    try {
      withStateLock(f, () => {
        appendFileSync(f, JSON.stringify({ hook: id, ...call }) + '\n', { mode: 0o600 });
        if (statSync(f).size > CALLS_KEPT * 300) {
          const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
          writeStateFileSync(f, lines.slice(-CALLS_KEPT / 2).join('\n') + '\n', { mode: 0o600 });
        }
      }, 50);
    } catch (e) {
      this.log(`inbound hooks: can't log a call: ${(e as Error).message}`);
    }
  }

  /** Each hook's latest calls, newest first. */
  private calls(): Map<string, HookCall[]> {
    const out = new Map<string, HookCall[]>();
    const f = join(this.host.dir, CALLS_FILE);
    if (!existsSync(f)) return out;
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean).reverse();
    for (const l of lines) {
      try {
        const { hook, ...call } = JSON.parse(l) as HookCall & { hook: string };
        const list = out.get(hook) ?? [];
        if (list.length < CALLS_SHOWN) list.push(call);
        out.set(hook, list);
      } catch {
        // a line cut short by a crash
      }
    }
    return out;
  }

  /** Whether `key` has had `limit` events in the last minute; counts this one when it hasn't. */
  private over(map: Map<string, number[]>, key: string, limit: number): boolean {
    const now = performance.now();
    if (map === this.bad && !map.has(key) && map.size >= 10_000) {
      for (const [k, ts] of map) if (ts.every((t) => now - t >= 60_000)) map.delete(k);
      if (map.size >= 10_000) return true;
    }
    const times = (map.get(key) ?? []).filter((t) => now - t < 60_000);
    const full = times.length >= limit;
    if (!full) times.push(now);
    map.set(key, times);
    return full;
  }

  /** Independent of file transactions: a committed claim survives a script failure or worker restart. */
  private claim(hook: string, signature: string, stamp: number): 'claimed' | 'replay' | 'expired' | 'full' {
    const db = new DatabaseSync(join(this.host.dir, REPLAYS_FILE));
    try {
      db.exec(`PRAGMA busy_timeout = 1000; PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS claims (hook TEXT NOT NULL, signature TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY (hook, signature));
        CREATE INDEX IF NOT EXISTS claims_expiry ON claims (expires);
        CREATE TABLE IF NOT EXISTS clock (id INTEGER PRIMARY KEY CHECK (id = 1), high_water INTEGER NOT NULL);
        INSERT OR IGNORE INTO clock VALUES (1, 0);
        BEGIN IMMEDIATE`);
      // Expired claims never become valid again after a backward clock adjustment.
      const now = Math.max(Date.now(), Number(db.prepare('SELECT high_water FROM clock WHERE id = 1').get()!.high_water));
      db.prepare('UPDATE clock SET high_water = ? WHERE id = 1').run(now);
      db.prepare('DELETE FROM claims WHERE expires < ?').run(now);
      let result: 'claimed' | 'replay' | 'expired' | 'full';
      if (Math.abs(now / 1000 - stamp) > SKEW_S) result = 'expired';
      else if (db.prepare('SELECT 1 FROM claims WHERE hook = ? AND signature = ?').get(hook, signature)) result = 'replay';
      else if (Number(db.prepare('SELECT COUNT(*) AS n FROM claims').get()!.n) >= MAX_REPLAY_CLAIMS) result = 'full';
      else {
        db.prepare('INSERT INTO claims VALUES (?, ?, ?)').run(hook, signature, (stamp + SKEW_S) * 1000);
        result = 'claimed';
      }
      db.exec('COMMIT');
      return result;
    } finally {
      db.close();
    }
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/hooks\/v1\/([^/]+)$/.exec(url.pathname);
    if (!m) return false;
    const started = Date.now();
    const from = clientAddress(req);
    const send = (status: number, body: Record<string, unknown>) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // One answer for an unknown hook, one turned off and a server with hooks off: nothing to learn by guessing ids.
    const notFound = () => send(404, { error: 'No such hook' });
    // Bad calls (no such hook, a wrong signature) count against the address and the hook they were sent to, so
    // junk sent behind the same proxy (one address for every caller) never shuts out another hook's sender; and a
    // correctly signed call is answered even while its address and hook are over the limit.
    this.load();
    const hook = this.allowed && req.method === 'POST' ? this.hooks.find((h) => h.id === m[1] && h.enabled) : undefined;
    // One bucket for a whole IPv6 /64, which has as many addresses as its owner likes.
    const bucket = `${addressBucket(from)} ${hook ? hook.id : '?'}`;
    const flooded = (this.bad.get(bucket) ?? []).filter((t) => performance.now() - t < 60_000).length >= BAD_PER_MINUTE;
    const refuse = (logged: boolean, status: number, message: string) => {
      // Kept to the limit, so a flood neither grows the list nor makes every call after it slower.
      const over = this.over(this.bad, bucket, BAD_PER_MINUTE);
      if (flooded || over) return send(429, { error: 'Too many bad calls from this address; try again in a minute' }), true;
      // Over the limit, refusals aren't logged either: a flood can't push real calls out of the list.
      if (logged && hook) this.logCall(hook.id, { at: new Date(started).toISOString(), status, outcome: 'refused', message, from });
      if (status === 404) notFound();
      else send(status, { error: message });
      return true;
    };
    if (!hook) {
      if (flooded) return refuse(false, 429, '');
      if (req.method !== 'POST' && this.allowed) return refuse(false, 405, 'Send a POST');
      return refuse(false, 404, 'unknown');
    }

    const stamp = String(req.headers['x-tabularius-timestamp'] ?? '');
    const given = String(req.headers['x-tabularius-signature'] ?? '');
    if (!/^\d{1,12}$/.test(stamp) || Math.abs(Date.now() / 1000 - Number(stamp)) > SKEW_S) {
      return refuse(true, 401, 'X-Tabularius-Timestamp is missing or more than five minutes from the server\'s clock');
    }

    // The body, then the signature over it; nothing about the hook is used before that checks out.
    let body: Buffer;
    try {
      body = await readBody(req, MAX_BODY);
    } catch (e) {
      if (e instanceof ApiError && e.status === 413) return refuse(true, 413, `The body is larger than ${MAX_BODY / 1024} KB`);
      return refuse(true, 400, 'The body could not be read');
    }
    const size = body.length;
    if (!verify(hook.secret, stamp, body, given)) return refuse(true, 401, 'The signature does not match');
    if (req.aborted || req.socket.destroyed || res.destroyed) return true;
    let claim: ReturnType<InboundHooks['claim']>;
    try { claim = this.claim(hook.id, given, Number(stamp)); }
    catch { return send(503, { error: 'Replay protection is unavailable' }), true; }
    if (req.aborted || req.socket.destroyed || res.destroyed) return true;
    if (claim === 'replay') return refuse(true, 409, 'This call was already received');
    if (this.seen.size >= 10_000) return send(429, { error: 'Too many signed calls are awaiting replay expiry; try again later' }), true;
    if (claim === 'expired') return refuse(true, 401, 'The timestamp is outside the acceptance window');
    if (claim === 'full') return send(503, { error: 'Replay protection is at capacity; try again later' }), true;
    // Signed: a call over the hook's own limit isn't a bad call from its address.
    if (this.over(this.recent, hook.id, hook.perMinute)) {
      this.logCall(hook.id, { at: new Date(started).toISOString(), status: 429, outcome: 'refused', message: `over ${hook.perMinute} calls a minute`, bytes: size, from });
      return send(429, { error: `More than ${hook.perMinute} calls a minute` }), true;
    }
    let payload: string;
    try {
      payload = JSON.stringify(parseRequestJson(body.toString('utf8')));
    } catch {
      this.logCall(hook.id, { at: new Date(started).toISOString(), status: 400, outcome: 'refused', message: 'the body is not JSON', bytes: size, from });
      return send(400, { error: 'The body is not JSON' }), true;
    }

    const done = (status: number, call: Omit<HookCall, 'at' | 'status' | 'ms' | 'bytes' | 'from'>, answer: Record<string, unknown>) => {
      this.logCall(hook.id, { at: new Date(started).toISOString(), status, ...call, ms: Date.now() - started, bytes: size, from });
      send(status, answer);
      return true;
    };
    const store = this.host.get(hook.database);
    if (!store) return done(503, { outcome: 'error', message: `${hook.database} is not open` }, { error: 'The file is not available' });
    const opts = this.host.scriptOptions(store.name);
    if (captureOnly(store.name, opts.outbound?.captureOnly)) return done(403, { outcome: 'refused', message: 'a capture-only file never runs inbound hooks' }, { error: 'Refused' });
    try {
      store.requireActiveAccount(hook.account);
      const privileges = store.privileges(hook.account);
      const script = store.schema.scripts.find((s) => s.name === hook.script);
      if (!script) return done(500, { outcome: 'error', error: 104, message: `no script "${hook.script}"` }, { error: 'The hook\'s script is missing' });
      privileges.checkScript(script.name);
      const r = await writer.run({ owner: `${OWNER}${hook.id}`, account: hook.account, surface: 'hook' }, () => opts.serverQueue.run(() => runScript(store, script, {
        ...(hook.layout ? { layout: hook.layout } : {}), account: hook.account, executionAccount: hook.account, privileges, parameter: payload,
        documents: opts.documents, ...itemNetwork(opts, hook.network, 'inbound hook'), ...(opts.networkAllow ? { networkAllow: opts.networkAllow } : {}),
        ...(opts.outbound ? { outbound: opts.outbound } : {}), ...(opts.profile ? { profile: opts.profile } : {}),
        // No AI steps: the payload is someone else's data.
        timeoutMs: TIMEOUT_MS,
      }), { file: store.name, script: script.name, account: hook.account, kind: 'hook' }));
      const result = r.result.slice(0, RESULT_CHARS);
      return done(200, { outcome: r.error ? 'error' : 'ok', ...(r.error ? { error: r.error } : {}) }, { ok: !r.error, ...(r.error ? { error: r.error } : {}), result });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      return done(500, { outcome: 'error', error: typeof code === 'number' ? code : -1, message: (e as Error).message.slice(0, 300) }, { ok: false, error: typeof code === 'number' ? code : -1 });
    }
  }
}

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** The signature a call carries: "sha256=" and the hex HMAC of "timestamp.body". */
export function hookSignature(secret: string, timestamp: string, body: Buffer | string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

function verify(secret: string, timestamp: string, body: Buffer, given: string): boolean {
  const want = Buffer.from(hookSignature(secret, timestamp, body));
  const got = Buffer.from(given);
  return got.length === want.length && timingSafeEqual(got, want);
}
