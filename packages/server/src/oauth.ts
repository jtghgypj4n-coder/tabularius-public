import { clientAddress } from './client-address.ts';
import { addressBucket } from '../../store/src/client-ip.ts';
// Sign-in for remote AI apps at /mcp: claude.ai and Claude Desktop custom connectors, and other MCP clients that
// speak OAuth 2.1 (the MCP authorization spec). Tabularius is its own authorization server for /mcp only:
//
//   GET  /.well-known/oauth-protected-resource[/mcp]   which server signs people in for /mcp (RFC 9728)
//   GET  /.well-known/oauth-authorization-server       the endpoints below (RFC 8414)
//   POST /oauth/register                               an app registers itself (dynamic client registration, RFC 7591)
//   GET  /oauth/authorize                              the sign-in page: a hosted file, one of its accounts, its password
//   POST /oauth/token                                  a code (with its PKCE verifier) or a refresh token for an access token
//   POST /oauth/revoke                                 the app signs out (RFC 7009)
//
// Someone signs in with an account of one hosted file, as in the web client: its password, its second factor, its
// lockout after wrong passwords, where it may sign in from. The access token is that file's own API token for the
// account, limited to AI apps (fmmcp) and expiring in an hour, so every tool call runs under the account's privilege
// set, Manage Security lists it, and revoking it there signs the app out (its refresh token stops working too). A file
// with AI turned off can't be signed in to. Apps, codes and refresh tokens (their hashes only) are kept in a small
// database in the hosted folder, so every worker of a cluster sees the same ones.

import { expiryClock } from '../../store/src/clock.ts';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Store } from '../../store/src/index.ts';
import { publicPasswordLockout } from './password-login-policy.ts';
import { aiBlocker, aiRefusal } from './ai-access.ts';
import type { Host } from './host.ts';
import { SignInError, type Oidc } from './oidc.ts';
import { MARK, PRODUCT_NAME, pageCss } from './pages.ts';
import { ApiError, readBody as readRaw } from './dataapi.ts';
import { parseRequestJson } from './request-json.ts';

export const OAUTH_DB = '.openhbam-oauth.sqlite';
const PASSWORD_REFUSAL = 'Wrong account or password. (Accounts that sign in through an identity provider use the button above, when there is one.)';
const ACCESS_SECONDS = 60 * 60;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * An account that signs in through an identity provider has no password here to change, and what the provider says
 * about the person (still employed, still in the group) can't be asked again at a refresh. So its refresh tokens do
 * not renew past this long after the sign-in: the person signs in again, which asks the provider afresh.
 */
const REFRESH_EXTERNAL_MS = 24 * 60 * 60 * 1000;
const CODE_MS = 60 * 1000;
const MAX_CLIENTS = 500;
const MAX_SPENT_REFRESH = 100_000;
/** Spent refresh tokens remembered per sign-in: older ones go, so one busy (or abusive) sign-in cannot fill the list for everyone. */
const SPENT_PER_FAMILY = 20;
/** A refresh token used again this soon after it was spent is two requests racing, not a stolen token: refused, but the sign-in is kept. */
const REPLAY_GRACE_MS = 10_000;
/** Registrations from one address in an hour; a registration needs no sign-in, so it is kept from filling the list. */
const REGISTER_PER_HOUR = 30;
const MAX_BODY = 64 * 1024;

/** The first four groups (the /64) of an IPv6 address written in full, so `2001:db8::5` and `2001:db8::6` are one machine. */
export function ipv6Prefix(address: string): string {
  const [head, tail] = address.split('%')[0].split('::');
  const a = head ? head.split(':') : [];
  const b = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return groups.slice(0, 4).map((g) => (parseInt(g || '0', 16) || 0).toString(16)).join(':');
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const token = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`;
/** Text for a log line or a label: no line breaks or control characters, so a name can't forge another entry. */
const plain = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').trim();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** The account's name as the file keeps it, matched as sign-in matches it; undefined when there is no such account. */
function storedName(store: Store, account: string): string | undefined {
  return (store.sql.prepare('SELECT name FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as { name: string } | undefined)?.name;
}

/** Bind codes and refresh tokens to the same identity (the account's and, for a federated sign-in, the person's), credentials and authority as the sign-in. */
function passwordMark(store: Store, account: string, person?: string): string {
  store.accountIdentityId(account);
  return hash(`${store.signInMark(account, undefined, person)}:${JSON.stringify(store.privileges(account, undefined, person).set.extendedPrivileges)}`);
}

/** What a code or refresh token carried before sign-ins were bound to authority: only the account row and its password hash. */
function legacyPasswordMark(store: Store, account: string): string {
  const row = store.sql.prepare('SELECT rowid AS id, password_hash FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(account) as { id: number; password_hash: string | null } | undefined;
  return hash(`${row ? row.id : 'none'}:${row?.password_hash ?? ''}`);
}

/** Whether a stored refresh mark is this account's current one (or, for a grant from before marks bound authority, its password's: the refresh then binds it to authority). */
function markCurrent(store: Store, account: string, stored: string | null, person?: string): boolean {
  return stored !== null && (stored === passwordMark(store, account, person) || stored === legacyPasswordMark(store, account));
}

const BLOCKED = 'The server isn\'t accepting new users right now; try again later.';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

interface Client { id: string; secret_hash: string | null; auth_method: string | null; name: string; redirect_uris: string }

class OAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** A redirect URI an app may register: https anywhere, or http back to this computer (RFC 8252); no fragment. */
function redirectAllowed(uri: string): boolean {
  if (uri.length > 2000 || /[#\\\u0000-\u001f\u007f]/.test(uri)) return false;
  try {
    const u = new URL(uri);
    if (u.hash || u.username || u.password) return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname));
  } catch {
    return false;
  }
}

/** Whether `got` is one of the app's redirect URIs: exactly, or (for one on this computer) on any port (RFC 8252 7.3). */
function redirectMatches(registered: string[], got: string): boolean {
  if (registered.includes(got)) return true;
  try {
    const g = new URL(got);
    if (g.protocol !== 'http:' || !LOOPBACK.has(g.hostname)) return false;
    return registered.some((r) => {
      const u = new URL(r);
      // Compare the original strings, not URL's decoded/normalised path and query.
      const stripPort = (s: string) => s.replace(/^(http:\/\/)(localhost|127\.0\.0\.1|\[::1\]):\d+(?=\/|\?|$)/, '$1$2');
      return u.protocol === 'http:' && u.hostname === g.hostname && stripPort(r) === stripPort(got);
    });
  } catch {
    return false;
  }
}

function csrfFrom(req: IncomingMessage, name: string): string {
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1) ?? '';
}

async function readBody(req: IncomingMessage): Promise<string> {
  try {
    return (await readRaw(req, MAX_BODY)).toString('utf8');
  } catch (e) {
    if (e instanceof ApiError && e.status === 413) throw new OAuthError('invalid_request', 'The request is too large');
    throw e;
  }
}

export class OAuthServer {
  private oidc?: Oidc;

  /** Offers the identity providers the web client has (Google, Microsoft, ...) on the sign-in page too. */
  useOidc(oidc: Oidc | undefined): void {
    this.oidc = oidc;
  }

  private readonly db: DatabaseSync;
  private readonly registered = new Map<string, number[]>();
  private readonly host: Host;
  private readonly opts: { publicUrl?: string };

  constructor(host: Host, dir: string, opts: { publicUrl?: string } = {}) {
    this.host = host;
    this.opts = opts;
    const file = join(dir, OAUTH_DB);
    // Hashes only, but who signed in to which file: readable by the server's user only, like the files themselves.
    if (!existsSync(file)) writeFileSync(file, '', { mode: 0o600, flag: 'a' });
    try {
      chmodSync(file, 0o600);
    } catch {
      // Another user's file on a shared folder: left as it is.
    }
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout = 5000');
    for (let tries = 0; ; tries++) {
      try {
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, secret_hash TEXT, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created INTEGER NOT NULL, used INTEGER);
          CREATE TABLE IF NOT EXISTS codes (hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, database TEXT NOT NULL, account TEXT NOT NULL, expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS refresh (hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, database TEXT NOT NULL, account TEXT NOT NULL, access_id TEXT NOT NULL, expires INTEGER NOT NULL, password TEXT NOT NULL)`);
        // Added later: who an identity-provider sign-in was (an email), for the token's label.
        const cols = (t: string) => (this.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
        if (!cols('codes').includes('who')) this.db.exec('ALTER TABLE codes ADD COLUMN who TEXT');
        // Added later: the account's password mark when the code was given, so a code for an account that was replaced by another of the same name is refused.
        if (!cols('codes').includes('mark')) this.db.exec('ALTER TABLE codes ADD COLUMN mark TEXT');
        this.db.exec('CREATE TABLE IF NOT EXISTS consents (hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, database TEXT NOT NULL, account TEXT NOT NULL, who TEXT, provider TEXT NOT NULL, expires INTEGER NOT NULL)');
        if (!cols('consents').includes('mark')) this.db.exec('ALTER TABLE consents ADD COLUMN mark TEXT');
        for (const table of ['consents', 'codes', 'refresh']) {
          const present = (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === 'identity');
          if (!present) this.db.exec(`ALTER TABLE ${table} ADD COLUMN identity TEXT`);
        }
        // Added later: the sign-in a refresh token belongs to, kept across rotations. A refresh token that has been used is kept (retired) with it, and
        // a sign-in ended is remembered (revoked_grants), so a sign-out made while another worker rotates the token still ends the new one.
        if (!cols('refresh').includes('grant_id')) this.db.exec('ALTER TABLE refresh ADD COLUMN grant_id TEXT');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS retired (hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, database TEXT NOT NULL, grant_id TEXT NOT NULL, access_id TEXT NOT NULL, expires INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS retired_access ON retired (access_id);
          CREATE TABLE IF NOT EXISTS revoked_grants (grant_id TEXT PRIMARY KEY, expires INTEGER NOT NULL)`);
        for (const table of ['consents', 'codes', 'refresh']) {
          if (!cols(table).includes('resource')) this.db.exec(`ALTER TABLE ${table} ADD COLUMN resource TEXT`);
        }
        if (!cols('refresh').includes('family')) this.db.exec('ALTER TABLE refresh ADD COLUMN family TEXT');
        if (!cols('clients').includes('auth_method')) this.db.exec('ALTER TABLE clients ADD COLUMN auth_method TEXT');
        this.db.exec('CREATE TABLE IF NOT EXISTS spent_refresh (hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, family TEXT NOT NULL, expires INTEGER NOT NULL, at INTEGER)');
        if (!cols('spent_refresh').includes('at')) this.db.exec('ALTER TABLE spent_refresh ADD COLUMN at INTEGER');
        this.db.exec('CREATE INDEX IF NOT EXISTS refresh_family ON refresh(family)');
        break;
      } catch (e) {
        if (tries >= 50 || !/locked|busy/i.test((e as Error).message)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    // Older local OAuth grants were accidentally labelled service credentials, so a password reset did not end them.
    // Relabel them delegated (they are known by the refresh row that points at them) and bind them to the sign-in as it
    // is now, so the app stays connected; one whose password already changed since can no longer be vouched for and ends.
    for (const grant of this.db.prepare('SELECT hash, database, account, access_id, password FROM refresh').iterate() as Iterable<{ hash: string; database: string; account: string; access_id: string; password: string | null }>) {
      const store = this.host.get(grant.database);
      const access = store?.sql.prepare('SELECT provenance FROM _fm_api_tokens WHERE id = ? AND account = ? COLLATE NOCASE').get(grant.access_id, grant.account);
      if (!store || !access || access.provenance === 'delegated') continue;
      if (grant.password === legacyPasswordMark(store, grant.account)) {
        store.sql.prepare("UPDATE _fm_api_tokens SET provenance = 'delegated' WHERE id = ?").run(grant.access_id);
        this.db.prepare('UPDATE refresh SET password = ? WHERE hash = ?').run(passwordMark(store, grant.account), grant.hash);
      } else {
        store.revokeApiToken(grant.access_id);
        this.db.prepare('DELETE FROM refresh WHERE hash = ?').run(grant.hash);
      }
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed.
    }
  }

  /** The address apps reach this server at: the configured public URL, else what the request was sent to. */
  base(req: IncomingMessage): string {
    if (this.opts.publicUrl) return new URL(this.opts.publicUrl).origin;
    const host = String(req.headers.host ?? '');
    const safe = /^[A-Za-z0-9.-]+(?::\d+)?$|^\[[0-9A-Fa-f:.]+\](?::\d+)?$/.test(host) ? host : 'localhost';
    return new URL(`${(req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'}://${safe}`).origin;
  }

  private csrfCookie(req?: IncomingMessage): { name: string; attributes: string } {
    const secure = (this.opts.publicUrl ? new URL(this.opts.publicUrl).protocol === 'https:' : false) || (req?.socket as { encrypted?: boolean } | undefined)?.encrypted;
    return secure
      ? { name: '__Host-tabularius_oauth_csrf', attributes: 'Path=/; HttpOnly; SameSite=Strict; Max-Age=600; Secure' }
      : { name: 'tabularius_oauth_csrf', attributes: 'Path=/oauth/authorize; HttpOnly; SameSite=Strict; Max-Age=600' };
  }

  /** The WWW-Authenticate challenge /mcp answers 401 with, pointing apps at the sign-in (RFC 9728 5.1). */
  challenge(req: IncomingMessage, error?: 'invalid_token'): string {
    return `Bearer ${error ? `error="${error}", ` : ''}resource_metadata="${this.base(req)}/.well-known/oauth-protected-resource/mcp"`;
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const p = url.pathname;
    if (!p.startsWith('/.well-known/oauth-') && !p.startsWith('/oauth/')) return false;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '600' }).end();
      return true;
    }
    try {
      // Not cached: without a public URL the addresses come from the request.
      if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp') return this.json(res, 200, this.resourceMetadata(req), { 'cache-control': 'no-store' });
      if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/oauth-authorization-server/mcp') return this.json(res, 200, this.serverMetadata(req), { 'cache-control': 'no-store' });
      if (p === '/oauth/register' && req.method === 'POST') return this.json(res, 201, this.register(req, await readBody(req)));
      if (p === '/oauth/authorize' && (req.method === 'GET' || req.method === 'POST')) return await this.authorize(req, res, url);
      if (p === '/oauth/token' && req.method === 'POST') return this.json(res, 200, this.token(req, new URLSearchParams(await readBody(req))), { 'cache-control': 'no-store', pragma: 'no-cache' });
      if (p === '/oauth/revoke' && req.method === 'POST') {
        this.revoke(req, new URLSearchParams(await readBody(req)));
        res.writeHead(200, { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }).end();
        return true;
      }
      return this.json(res, 404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof OAuthError) {
        const headers = e.status === 401 ? { 'www-authenticate': 'Basic realm="tabularius"' } : undefined;
        return this.json(res, e.status, { error: e.code }, headers);
      }
      throw e;
    }
  }

  private json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): true {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body));
    return true;
  }

  resourceMetadata(req: IncomingMessage): Record<string, unknown> {
    const base = this.base(req);
    return { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'], scopes_supported: ['mcp'], resource_name: PRODUCT_NAME };
  }

  serverMetadata(req: IncomingMessage): Record<string, unknown> {
    const base = this.base(req);
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['mcp'],
      authorization_response_iss_parameter_supported: true,
      resource_indicators_supported: true,
    };
  }

  // --- registration --------------------------------------------------------

  private register(req: IncomingMessage, raw: string): Record<string, unknown> {
    let body: Record<string, unknown>;
    try {
      body = parseRequestJson(raw) as Record<string, unknown>;
    } catch {
      throw new OAuthError('invalid_client_metadata', 'The registration must be JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OAuthError('invalid_client_metadata', 'The registration must be a JSON object');
    // Counted per address, and per /64 for IPv6 (one machine usually has a whole /64).
    const from = addressBucket(clientAddress(req));
    const now = performance.now();
    for (const [k, ts] of this.registered) if (ts.every((t) => now - t >= 3600_000)) this.registered.delete(k);
    if (!this.registered.has(from) && this.registered.size >= 1000) throw new OAuthError('invalid_client_metadata', 'Too many apps are registering; try again later', 429);
    const recent = (this.registered.get(from) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= REGISTER_PER_HOUR) throw new OAuthError('invalid_client_metadata', 'Too many apps registered from this address; try again later', 429);
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === 'string' && redirectAllowed(u))) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris must list up to 10 https addresses (or http ones on this computer), with no fragment');
    }
    const method = body.token_endpoint_auth_method === undefined ? 'none' : String(body.token_endpoint_auth_method);
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) throw new OAuthError('invalid_client_metadata', `token_endpoint_auth_method "${method}" is not supported`);
    const grants = body.grant_types === undefined ? ['authorization_code', 'refresh_token'] : body.grant_types;
    // A client may ask for the code grant alone; the server grants both and says so in its answer (RFC 7591 section 3.2.1).
    if (!Array.isArray(grants) || !grants.includes('authorization_code') || !grants.every((g) => g === 'authorization_code' || g === 'refresh_token')) throw new OAuthError('invalid_client_metadata', 'The authorization_code grant is required, and only it and refresh_token are supported');
    if (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.length !== 1 || body.response_types[0] !== 'code')) throw new OAuthError('invalid_client_metadata', 'Only the code response type is supported');
    // Keys that carry a key set or a request address would have to be fetched, which registration never does, so they are refused.
    // The display addresses (client_uri, logo_uri, tos_uri, policy_uri) are ignored: never fetched, never shown, never stored.
    for (const key of ['jwks_uri', 'jwks', 'sector_identifier_uri', 'request_uris']) {
      if (body[key] !== undefined) throw new OAuthError('invalid_client_metadata', `${key} is not supported`);
    }
    const name = typeof body.client_name === 'string' && plain(body.client_name) ? plain(body.client_name).slice(0, 80) : 'An AI app';
    const wall = Date.now();
    // Apps registered and never used for a day go, and the oldest never-used ones when the list is full. An app someone
    // signed in with is never pushed out by new registrations: when only those are left, no more can register.
    const id = `ohc_${randomBytes(16).toString('hex')}`;
    const secret = method === 'none' ? undefined : token('ohcs_');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM clients WHERE used IS NULL AND created < ?').run(wall - 24 * 3600_000);
      const count = (this.db.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number }).n;
      if (count >= MAX_CLIENTS) this.db.prepare('DELETE FROM clients WHERE id IN (SELECT id FROM clients WHERE used IS NULL ORDER BY created, rowid LIMIT ?)').run(count - MAX_CLIENTS + 1);
      if ((this.db.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number }).n >= MAX_CLIENTS) throw new OAuthError('invalid_client_metadata', 'Too many apps are registered with this server; try again later', 429);
      this.db.prepare('INSERT INTO clients (id, secret_hash, auth_method, name, redirect_uris, created) VALUES (?, ?, ?, ?, ?, ?)').run(id, secret ? hash(secret) : null, method, name, JSON.stringify(uris), wall);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    recent.push(now);
    this.registered.set(from, recent);
    return {
      client_id: id, client_id_issued_at: Math.floor(wall / 1000), client_name: name, redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: method,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    };
  }

  private client(id: string | null): Client | undefined {
    return id ? this.db.prepare('SELECT id, secret_hash, auth_method, name, redirect_uris FROM clients WHERE id = ?').get(id) as Client | undefined : undefined;
  }

  /** The app calling the token or revoke endpoint, with its secret checked when it has one. */
  private callingClient(req: IncomingMessage, form: URLSearchParams): Client {
    const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    let id = form.get('client_id');
    let secret = form.get('client_secret');
    if (basic) {
      if (secret) throw new OAuthError('invalid_client', 'Use one client authentication method', 401);
      const [u, ...rest] = Buffer.from(basic, 'base64').toString('utf8').split(':');
      try {
        const named = decodeURIComponent(u);
        // Some libraries send the client_id in the body as well as in the header: fine when they agree.
        if (id !== null && id !== named) throw new OAuthError('invalid_client', 'Use one client authentication method', 401);
        id = named;
        secret = decodeURIComponent(rest.join(':'));
      } catch (error) {
        if (error instanceof OAuthError) throw error;
        throw new OAuthError('invalid_client', 'The app\'s credentials are malformed', 401);
      }
    }
    const client = this.client(id);
    if (!client) throw new OAuthError('invalid_client', 'Unknown app; register it again', 401);
    if (!client.secret_hash && (basic || form.get('client_secret'))) throw new OAuthError('invalid_client', 'This app is public', 401);
    if (client.auth_method === 'client_secret_basic' && !basic || client.auth_method === 'client_secret_post' && !!basic) throw new OAuthError('invalid_client', 'Wrong app authentication method', 401);
    if (client.secret_hash && !(secret && sameSecret(hash(secret), client.secret_hash))) throw new OAuthError('invalid_client', 'Wrong app secret', 401);
    return client;
  }

  // --- the sign-in page ----------------------------------------------------

  private async authorize(req: IncomingMessage, res: ServerResponse, url: URL): Promise<true> {
    const form = req.method === 'POST' ? new URLSearchParams(await readBody(req)) : url.searchParams;
    const client = this.client(form.get('client_id'));
    const redirect = form.get('redirect_uri') ?? '';
    const uris = client ? JSON.parse(client.redirect_uris) as string[] : [];
    // Without a known app and one of its own redirect addresses there is nowhere safe to send an answer.
    if (!client) return this.page(res, 400, 'Unknown app', '<p>This sign-in link names an app this server doesn\'t know. Add the connector again from the app.</p>');
    const target = redirect || (uris.length === 1 ? uris[0] : '');
    if (!target || !redirectMatches(uris, target)) return this.page(res, 400, 'Wrong return address', '<p>This sign-in link would send you somewhere the app didn\'t register. Add the connector again from the app.</p>');
    const state = form.get('state');
    const location = (params: Record<string, string>) => {
      const u = new URL(target);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (state !== null) u.searchParams.set('state', state);
      u.searchParams.set('iss', this.base(req));
      return u.toString();
    };
    const back = (params: Record<string, string>) => {
      res.writeHead(302, { location: location(params), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end();
      return true as const;
    };
    // A bad request is shown here rather than sent back: anyone can register an app, so sending every error to its
    // address would make this server a redirector to any site.
    const bad = (why: string) => this.page(res, 400, 'This sign-in link doesn\'t work', `<p>${esc(why)} Add the connector again from the app.</p>`);
    if (form.get('response_type') !== 'code') return bad('Only response_type=code is supported.');
    const challenge = form.get('code_challenge') ?? '';
    if (form.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return bad('PKCE with code_challenge_method=S256 is required.');
    const requestedResource = form.get('resource');
    const resource = requestedResource === null ? null : this.canonicalResource(req, requestedResource);
    if (form.getAll('resource').length > 1 || (requestedResource !== null && !resource)) return bad(`This server signs in for ${this.base(req)}/mcp only.`);
    if (form.get('scope') && form.get('scope') !== 'mcp') return bad('Only the mcp scope is supported.');
    const csrf = csrfFrom(req, this.csrfCookie(req).name);
    if (req.method === 'POST' && (!/^[A-Za-z0-9_-]{43}$/.test(csrf) || !sameSecret(form.get('csrf') ?? '', csrf))) return bad('This approval page has expired.');
    if (req.method === 'POST' && form.get('cancel') !== null) return back({ error: 'access_denied', error_description: 'Signing in was cancelled' });

    const files = this.files();
    const hidden = { client_id: client.id, redirect_uri: target, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', ...(state !== null ? { state } : {}), ...(resource ? { resource } : {}) };
    const returnHost = new URL(target).host;
    const provider = form.get('oidc');
    if (req.method === 'GET' && provider && this.oidc) {
      // "Sign in with Google/Microsoft": the identity provider vouches for the person, who then gets the external
      // account the file maps them to; everything after is as for a password sign-in (where from, AI access, the app).
      const typed = (form.get('database') ?? '').trim();
      const name = files.find((f) => f.toLowerCase() === typed.toLowerCase());
      // Without a public file list, a name that isn't hosted goes to the identity provider like a real one, and is refused after the person has signed in there.
      if (!name && (this.host.listFilesPublicly || !typed)) return this.signInPage(res, client, target, hidden, files, { error: 'Choose a hosted file.' }, 400, req);
      const database = name ?? typed;
      await this.oidc.begin(provider, database, req, res, {
        fail: (r, message) => { this.signInPage(r, client, target, hidden, files, { database, error: message }, 401, req); },
        done: (r, { store: st, via, email, issuer, sub, provider: pname, from }) => {
          const identity = { issuer, sub, person: email, mapping: via };
          const who = email ?? via;
          const warn = (why: string) => this.host.logs?.write('Access', 'Warning', from, `${plain(who)} could not sign in to ${st.name} for an AI app through ${plain(pname)}: ${why}`);
          if (!st.signInLocationAllowed(via, from)) {
            st.auditSignIn(via, from, false);
            warn('not allowed from this address');
            throw new SignInError('This account can\'t sign in from here.');
          }
          const refused = this.allowed(st, via, from, true);
          if (refused) {
            if (refused.audit) st.auditSignIn(via, from, false, 'two-factor');
            if (refused.log) warn(refused.log);
            throw new SignInError(refused.message);
          }
          // The provider has said who this is; the app has not yet been allowed anything. A page names the app, the
          // person and where they will be sent back to, and only their click there (a single-use token only this
          // page holds) gives the app a code. Without it, a link sent to someone already signed in at the provider
          // could hand an app their access unseen.
          const consent = token('ohcs_');
          this.db.prepare('DELETE FROM consents WHERE expires < ?').run(expiryClock.now());
          this.db.prepare('INSERT INTO consents (hash, client_id, redirect_uri, challenge, database, account, who, provider, expires, identity, resource, mark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(hash(consent), client.id, target, challenge, st.name, via, email ?? null, pname, expiryClock.now() + 5 * 60_000, JSON.stringify(identity), resource ?? `${this.base(req)}/mcp`, passwordMark(st, via, email));
          const csrf = token('').slice(0, 43);
          const fields = Object.entries({ ...hidden, consent, csrf }).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
          this.page(r, 200, `Allow ${client.name}?`, `
<p><strong>${esc(client.name)}</strong> wants to use ${PRODUCT_NAME} as <strong>${esc(who)}</strong>${email ? ` (the account <strong>${esc(via)}</strong>)` : ''} in <strong>${esc(st.name)}</strong>, after you signed in through ${esc(pname)}. It can see and change what that account can, in that file, and nothing else. You'll be sent back to <strong>${esc(returnHost)}</strong>.</p>
<form method="post" action="/oauth/authorize">${fields}
<div class="actions"><button class="primary" type="submit">Allow</button><button type="submit" name="cancel" value="1" formnovalidate>Cancel</button></div>
</form>`, csrf, req);
        },
      });
      return true;
    }
    if (req.method === 'GET') return this.signInPage(res, client, target, hidden, files, {}, 200, req);

    // The person's "Allow" after signing in through an identity provider: the page's single-use token, for this app only.
    const consentToken = form.get('consent');
    if (consentToken) {
      const row = this.db.prepare('DELETE FROM consents WHERE hash = ? AND client_id = ? RETURNING redirect_uri, challenge, database, account, who, provider, expires, identity, resource, mark').get(hash(consentToken), client.id) as
        { redirect_uri: string; challenge: string; database: string; account: string; who: string | null; provider: string; expires: number; identity: string | null; resource: string | null; mark: string | null } | undefined;
      if (!row || row.expires <= expiryClock.now() || row.redirect_uri !== target || row.challenge !== challenge || (resource ?? `${this.base(req)}/mcp`) !== row.resource) return bad('This approval has expired or was already used.');
      const code = token('ohac_');
      this.db.prepare('DELETE FROM codes WHERE expires < ?').run(expiryClock.now());
      const st = this.host.get(row.database);
      this.db.prepare('INSERT INTO codes (hash, client_id, redirect_uri, challenge, database, account, expires, who, identity, mark, resource) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(hash(code), client.id, target, challenge, row.database, row.account, expiryClock.now() + CODE_MS, row.who, row.identity, row.mark, row.resource);
      const from = clientAddress(req);
      // Checked again as the person says yes: the account may have been turned off in the minutes between.
      const binding = row.identity ? JSON.parse(row.identity) as { issuer: string; sub: string; person?: string; mapping: string } : undefined;
      const refusedNow = st && (!binding || row.mark !== passwordMark(st, row.account, binding.person) || binding.mapping !== row.account || (binding.person && st.accountInactive(binding.person)) || !st.isExternalAccount(binding.mapping) || this.allowed(st, row.account, from, true));
      if (!st || refusedNow || !st.signInLocationAllowed(row.account, from)) {
        this.db.prepare('DELETE FROM codes WHERE hash = ?').run(hash(code));
        return bad(refusedNow === true ? 'This federated sign-in is no longer valid.' : refusedNow ? refusedNow.message : 'This account can\'t sign in from here.');
      }
      st.auditSignIn(row.account, from, true);
      this.host.logs?.write('Access', 'Information', clientAddress(req), `${plain(row.who ?? row.account)} allowed the AI app "${plain(client.name)}" to use ${row.database} after signing in through ${plain(row.provider)} (returning to ${returnHost})`);
      return back({ code });
    }
    const database = (form.get('database') ?? '').trim();
    const account = (form.get('account') ?? '').trim();
    const from = clientAddress(req);
    const again = (error: string, status = 401) => this.signInPage(res, client, target, hidden, files, { database, account: error === PASSWORD_REFUSAL ? '' : account, error }, status, req);
    const file = files.find((f) => f.toLowerCase() === database.toLowerCase());
    const store = file ? this.host.get(file) : undefined;
    // The account is asked for first, so the order of the checks doesn't tell a hosted file from one that isn't.
    if (!account) return again('Enter an account name.', 400);
    // Without a list to choose from, a name that isn't hosted is refused like a wrong password, so it doesn't say which files exist.
    if (!store) return this.host.listFilesPublicly ? again('Choose a hosted file.', 400) : again('The file, account or password is wrong.');
    // Every check, and the token, use the account's name as the file keeps it, found the way the file finds it at sign-in
    // (SQLite's case folding), so no name that only matches another one under a wider folding can stand in for it.
    const name = storedName(store, account) ?? account;
    const refused = await this.signIn(store, name, form.get('password') ?? '', form.get('otp') ?? '', from);
    if (refused) return again(refused);
    const code = token('ohac_');
    this.db.prepare('DELETE FROM codes WHERE expires < ?').run(expiryClock.now());
    this.db.prepare('INSERT INTO codes (hash, client_id, redirect_uri, challenge, database, account, expires, mark, resource) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(hash(code), client.id, target, challenge, store.name, name, expiryClock.now() + CODE_MS, passwordMark(store, name), resource ?? `${this.base(req)}/mcp`);
    this.host.logs?.write('Access', 'Information', from, `${account} signed in to ${store.name} for the AI app "${plain(client.name)}" (returning to ${new URL(target).host})`);
    return back({ code });
  }

  private canonicalResource(req: IncomingMessage, resource: string): string | undefined {
    const canonical = `${this.base(req)}/mcp`;
    if (resource === canonical || resource === `${this.base(req)}` || resource === `${this.base(req)}/` || resource === `${canonical}/`) return canonical;
    if (/[\\\u0000-\u001f\u007f]/.test(resource)) return undefined;
    try {
      const url = new URL(resource);
      return url.origin === this.base(req) && url.origin + url.pathname === canonical && !url.search && !url.hash && !url.username && !url.password ? canonical : undefined;
    } catch {
      return undefined;
    }
  }

  /** Hosted files an AI app may be signed in to: AI isn't turned off for them. */
  private files(): string[] {
    return this.host.names().filter((n) => {
      const s = this.host.get(n);
      return s && !aiBlocker(s);
    });
  }

  /**
   * Checks the account as the web client's sign-in does (password, lockout, second factor, where it may sign in
   * from) and that it may use AI apps in the file. Returns why not, or undefined when it may.
   */
  private async signIn(store: Store, account: string, password: string, otp: string, from: string): Promise<string | undefined> {
    const warn = (why: string) => this.host.logs?.write('Access', 'Warning', from, `${account} could not sign in to ${store.name} for an AI app: ${why}`);
    // Blocked by an administrator: refused before the password is checked (allowed() checks again for the other ways in).
    if (this.host.config.blockNewUsers()) {
      warn('the server is blocking new users');
      return BLOCKED;
    }
    if (!(await store.verifyAsync(account, password, from))) {
      store.auditSignIn(account, from, false);
      const until = store.lockedOut(account, from);
      warn(until ? 'locked out after too many failed sign-ins' : 'wrong account or password');
      return publicPasswordLockout(until, from) ? `Too many failed sign-ins; try again after ${new Date(until!).toLocaleTimeString('en-US')}.` : PASSWORD_REFUSAL;
    }
    if (store.hasTotp(account)) {
      if (!otp) return 'Enter the one-time code from your authenticator app.';
      if (!store.verifyTotp(account, otp.replace(/\s+/g, ''), from)) {
        store.auditSignIn(account, from, false, 'two-factor');
        warn('wrong one-time code');
        return 'That one-time code is not valid; check your authenticator app.';
      }
    }
    if (!store.signInLocationAllowed(account, from)) {
      store.auditSignIn(account, from, false);
      warn('not allowed from this address');
      return 'This account can\'t sign in from here.';
    }
    const refused = this.allowed(store, account, from);
    if (refused) {
      if (refused.audit) store.auditSignIn(account, from, false, 'two-factor');
      if (refused.log) warn(refused.log);
      return refused.message;
    }
    store.auditSignIn(account, from, true, store.hasTotp(account) ? 'two-factor' : undefined);
    return undefined;
  }

  /** What the account must be to use AI apps in the file, at sign-in and at every refresh; why not, when it isn't. */
  private allowed(store: Store, account: string, from: string, viaProvider = false, signingIn = true): { message: string; log?: string; audit?: true } | undefined {
    // A refresh is an app already signed in, which blocking new users leaves alone.
    if (signingIn && this.host.config.blockNewUsers()) return { message: BLOCKED, log: 'the server is blocking new users' };
    if (store.accountInactive(account)) return { message: 'This account is turned off.' };
    if (!store.hasTotp(account) && ((store.requireTotpForFullAccess() && store.privileges(account).full) || store.accountRequires2fa(account))) {
      return { message: viaProvider ? 'This account needs a second factor, which an account that signs in through an identity provider can\'t set up here yet.' : 'This account needs a second factor; set one up in the web client first.', log: 'a second factor is required and not set up', audit: true };
    }
    if (store.mustChangePassword(account)) return { message: 'This account has to change its password first; sign in to the web client to change it.' };
    const p = store.privileges(account);
    if (!p.has('fmmcp')) return { message: `This account's privilege set (${p.name}) doesn't allow AI apps. An administrator can turn on the fmmcp extended privilege for it.`, log: `the "${p.name}" privilege set doesn't allow AI apps (fmmcp)` };
    const refused = aiRefusal(store, { account, via: 'AI app sign-in', from });
    if (refused) return { message: refused.startsWith('AI policy refused') ? refused : 'AI is turned off for this file.' };
    return undefined;
  }

  private signInPage(res: ServerResponse, client: Client, target: string, hidden: Record<string, string>, files: string[], now: { database?: string; account?: string; error?: string }, status = 200, req?: IncomingMessage): true {
    const returnHost = new URL(target).host;
    const csrf = token('').slice(0, 43);
    const fields = Object.entries({ ...hidden, csrf }).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
    const body = files.length ? `
<p><strong>${esc(client.name)}</strong> wants to use ${PRODUCT_NAME} as one of your accounts. It can see and change what that account can, in that file, and nothing else. You'll be sent back to <strong>${esc(returnHost)}</strong>.</p>
${now.error ? `<p class="error" role="alert">${esc(now.error)}</p>` : ''}
${this.providerForm(fields, files, now.database)}
<form method="post" action="/oauth/authorize">${fields}
${this.fileField(files, now.database)}
<label>Account<input name="account" autocomplete="username" required value="${esc(now.account ?? '')}"></label>
<label>Password<input name="password" type="password" autocomplete="current-password"></label>
<label>One-time code <span class="hint">(if your account has a second factor)</span><input name="otp" inputmode="numeric" autocomplete="one-time-code"></label>
<div class="actions"><button class="primary" type="submit">Allow</button><button type="submit" name="cancel" value="1" formnovalidate>Cancel</button></div>
</form>` : '<p>No hosted file can be used by AI apps right now: AI is turned off for every one.</p>';
    return this.page(res, status, `Sign in for ${client.name}`, body, csrf, req);
  }

  /** The file to sign in to: a list to choose from, or on a server that doesn't list its files (no --list-files-publicly) a name to type, so this page names none to a stranger. */
  private fileField(files: string[], selected?: string): string {
    if (!this.host.listFilesPublicly) return `<label>File<input name="database" required autocomplete="off" spellcheck="false" value="${esc(selected ?? '')}"></label>`;
    const options = files.map((f) => `<option${f === (selected ?? (files.length === 1 ? f : '')) ? ' selected' : ''}>${esc(f)}</option>`).join('');
    return `<label>File<select name="database" required>${files.length > 1 && !selected ? '<option value="">Choose a file…</option>' : ''}${options}</select></label>`;
  }

  /** "Sign in with Google/Microsoft" buttons, when the server has identity providers; empty otherwise. */
  private providerForm(fields: string, files: string[], database?: string): string {
    const providers = this.oidc?.providers() ?? [];
    if (!providers.length) return '';
    return `<form method="get" action="/oauth/authorize" aria-label="Sign in through an identity provider">${fields}
${this.fileField(files, database)}
<div class="actions">${providers.map((p) => `<button type="submit" name="oidc" value="${esc(p.slug)}">Sign in with ${esc(p.name)}</button>`).join('')}</div>
</form>
<p class="hint">Or with an account name and password:</p>`;
  }

  private page(res: ServerResponse, status: number, title: string, body: string, csrf?: string, req?: IncomingMessage): true {
    const css = pageCss() + `
form { display: grid; gap: var(--s3, 12px); margin-top: var(--s4, 16px); }
label { display: grid; gap: 4px; font-weight: 500; }
.hint { color: var(--muted); font-weight: 400; }
input, select { min-height: 34px; padding: 0 var(--s3, 12px); border: 1px solid var(--line-strong); border-radius: var(--radius-sm, 6px); background: var(--panel); color: var(--text); font: inherit; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: none; box-shadow: var(--focus); }
.actions { display: flex; gap: var(--s2, 8px); margin-top: var(--s2, 8px); }
button { min-height: 34px; padding: 0 var(--s4, 16px); border-radius: var(--radius-sm, 6px); border: 1px solid var(--line-strong); background: var(--panel); color: var(--text); font: inherit; font-weight: 500; cursor: pointer; }
button.primary { background: var(--brand); border-color: var(--brand); color: var(--brand-text); }
.error { color: var(--danger, #b42318); font-weight: 500; }
p strong { color: var(--text); }
@media (forced-colors: active) { input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid CanvasText; } }`;
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
      ...(csrf ? { 'set-cookie': `${this.csrfCookie(req).name}=${csrf}; ${this.csrfCookie(req).attributes}` } : {}),
      // No form-action: browsers apply it to the redirect back to the app after signing in.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'",
    }).end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${esc(title)} · ${PRODUCT_NAME}</title><style>${css}</style></head>
<body><main><div class="brand-lockup">${MARK}<span>${PRODUCT_NAME}</span></div><h1>${esc(title)}</h1>${body}</main></body></html>`);
    return true;
  }

  // --- tokens --------------------------------------------------------------

  private token(req: IncomingMessage, form: URLSearchParams): Record<string, unknown> {
    const client = this.callingClient(req, form);
    const grant = form.get('grant_type');
    const requestedResource = form.get('resource');
    const resource = requestedResource === null ? null : this.canonicalResource(req, requestedResource);
    if (form.getAll('resource').length > 1 || (requestedResource !== null && !resource)) throw new OAuthError('invalid_target', `This server issues tokens for ${this.base(req)}/mcp only`);
    if (form.get('scope') && form.get('scope') !== 'mcp') throw new OAuthError('invalid_scope', 'Only the mcp scope is supported');
    this.sweep();
    if (grant === 'authorization_code') {
      const code = form.get('code') ?? '';
      // Taken out as it is used (by the app it was given to only), so a code works once even with two workers asked at the same moment.
      const row = this.db.prepare('DELETE FROM codes WHERE hash = ? AND client_id = ? RETURNING client_id, redirect_uri, challenge, database, account, expires, who, identity, mark, resource').get(hash(code), client.id) as
        { client_id: string; redirect_uri: string; challenge: string; database: string; account: string; expires: number; who: string | null; identity: string | null; mark: string | null; resource: string | null } | undefined;
      if (!row || row.expires <= expiryClock.now() || row.client_id !== client.id) throw new OAuthError('invalid_grant', 'The sign-in code is not valid or has expired; sign in again');
      const sent = form.get('redirect_uri');
      const only = JSON.parse(client.redirect_uris) as string[];
      // Required when the sign-in named one; an app with a single registered address may leave both out.
      if (sent !== row.redirect_uri && !(sent === null && only.length === 1 && only[0] === row.redirect_uri)) throw new OAuthError('invalid_grant', 'redirect_uri doesn\'t match the sign-in');
      const audience = row.resource ?? `${this.base(req)}/mcp`;
      if (resource && resource !== audience) throw new OAuthError('invalid_target', 'The resource does not match the sign-in');
      const verifier = form.get('code_verifier') ?? '';
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== row.challenge) throw new OAuthError('invalid_grant', 'The PKCE code_verifier doesn\'t match');
      const identity = row.identity ? JSON.parse(row.identity) as { issuer: string; sub: string; person?: string; mapping: string } : undefined;
      if (!identity && row.who !== null) throw new OAuthError('invalid_grant', 'This federated sign-in is no longer valid; sign in again');
      const targetStore = this.host.get(row.database);
      // The account is the one the code was given for, with the authority it signed in with: a code with no mark (given before marks were kept), or one bound
      // to the password only (before marks held authority; it lives a minute, so none outlasts an upgrade), or for an account since replaced by another of the same name, is refused.
      if (targetStore && row.mark !== passwordMark(targetStore, row.account, identity?.person)) throw new OAuthError('invalid_grant', 'The account changed since it signed in; sign in again');
      if (!targetStore || (targetStore.isExternalAccount(row.account) && (!identity || identity.mapping !== row.account)) ||
        (identity && (identity.mapping !== row.account || (identity.person && targetStore.accountInactive(identity.person)) || !targetStore.isExternalAccount(identity.mapping)))) {
        throw new OAuthError('invalid_grant', 'This federated sign-in is no longer valid; sign in again');
      }
      // A code given out just before new users were blocked doesn't become a grant after.
      if (this.host.config.blockNewUsers()) throw new OAuthError('invalid_grant', BLOCKED);
      return this.issue(client, row.database, row.account, clientAddress(req), audience, row.who ? `${plain(row.who)} via AI app: ${plain(client.name)}` : undefined, undefined, identity, false, row.mark, undefined, token('og_'));
    }
    if (grant === 'refresh_token') {
      const refreshHash = hash(form.get('refresh_token') ?? '');
      // One transaction takes the token out and records it as spent, so a second worker sees either the live token or its spent record,
      // never the gap between them. The rest of the rotation is not held inside it: a sign-out made meanwhile (another worker) is
      // remembered in revoked_grants and checked again where the new refresh token is written.
      const taken = this.inTransaction(() => {
        const current = this.db.prepare('SELECT resource FROM refresh WHERE hash = ? AND client_id = ?').get(refreshHash, client.id) as { resource: string | null } | undefined;
        if (current && resource && resource !== (current.resource ?? `${this.base(req)}/mcp`)) throw new OAuthError('invalid_target', 'The resource does not match the sign-in');
        const row = this.db.prepare('DELETE FROM refresh WHERE hash = ? AND client_id = ? RETURNING client_id, database, account, access_id, expires, password, identity, resource, family, grant_id').get(refreshHash, client.id) as
          { client_id: string; database: string; account: string; access_id: string; expires: number; password: string; identity: string | null; resource: string | null; family: string | null; grant_id: string | null } | undefined;
        if (!row) {
          const spent = this.db.prepare('SELECT family, at FROM spent_refresh WHERE hash = ? AND client_id = ? AND expires > ?').get(refreshHash, client.id, expiryClock.now()) as { family: string; at: number | null } | undefined;
          return { spent };
        }
        const audience = row.resource ?? `${this.base(req)}/mcp`;
        // A refused refresh still consumes the old token (and ends the access token it renewed), without a spent record.
        if (row.expires <= expiryClock.now()) return { row, audience, refused: new OAuthError('invalid_grant', 'The refresh token is not valid; sign in again') };
        if (resource && resource !== audience) return { row, audience, refused: new OAuthError('invalid_target', 'The resource does not match the sign-in') };
        // The sign-in's identity, kept across rotations: the grant id (a sign-out ends everything under it) is the replay family too.
        const family = row.grant_id ?? row.family ?? token('og_');
        this.db.prepare('INSERT INTO spent_refresh (hash, client_id, family, expires, at) VALUES (?, ?, ?, ?, ?)').run(refreshHash, client.id, family, row.expires, expiryClock.now());
        // Only the newest few per sign-in, and the oldest overall when the list is full: replay of a long-spent token goes
        // unnoticed rather than refresh failing for everyone.
        this.db.prepare('DELETE FROM spent_refresh WHERE family = ? AND rowid NOT IN (SELECT rowid FROM spent_refresh WHERE family = ? ORDER BY rowid DESC LIMIT ?)').run(family, family, SPENT_PER_FAMILY);
        if ((this.db.prepare('SELECT COUNT(*) AS n FROM spent_refresh').get() as { n: number }).n > MAX_SPENT_REFRESH) this.db.prepare('DELETE FROM spent_refresh WHERE rowid IN (SELECT rowid FROM spent_refresh ORDER BY rowid LIMIT ?)').run(MAX_SPENT_REFRESH / 100);
        // Kept as a retired token of the same sign-in too, so signing out with it afterwards still ends the new ones.
        this.db.prepare('INSERT OR REPLACE INTO retired (hash, client_id, database, grant_id, access_id, expires) VALUES (?, ?, ?, ?, ?, ?)').run(refreshHash, row.client_id, row.database, family, row.access_id, row.expires);
        // Only the latest few are kept per sign-in: an app that has refreshed hourly for a month would otherwise leave hundreds.
        this.db.prepare('DELETE FROM retired WHERE grant_id = ? AND rowid NOT IN (SELECT rowid FROM retired WHERE grant_id = ? ORDER BY rowid DESC LIMIT 5)').run(family, family);
        return { row, audience, family };
      });
      if (!taken.row) {
        if (taken.spent && !(taken.spent.at && expiryClock.now() - taken.spent.at < REPLAY_GRACE_MS)) this.revokeFamily(taken.spent.family);
        throw new OAuthError('invalid_grant', 'The refresh token is not valid; sign in again');
      }
      const { row, audience } = taken;
      if (taken.refused) {
        this.host.get(row.database)?.revokeApiToken(row.access_id);
        throw taken.refused;
      }
      const family = taken.family!;
      if (row.client_id !== client.id) throw new OAuthError('invalid_grant', 'The refresh token is not valid; sign in again');
      const store = this.host.get(row.database);
      const identity = row.identity ? JSON.parse(row.identity) as { issuer: string; sub: string; person?: string; mapping: string } : undefined;
      if (!store || (this.host.get(row.database)?.isExternalAccount(row.account) && (!identity || identity.mapping !== row.account)) || (identity?.person && store.accountInactive(identity.person)) || (identity && !store.isExternalAccount(identity.mapping))) throw new OAuthError('invalid_grant', 'This federated sign-in is no longer valid; sign in again');
      // Revoked in Manage Security (only a refresh ever removes it otherwise): the app is signed out.
      if (!store || !store.apiTokens().some((t) => t.id === row.access_id)) throw new OAuthError('invalid_grant', 'This sign-in was revoked; sign in again');
      // An account turned off keeps its sign-in as it is: nothing is rotated or revoked for it.
      if (store.accountInactive(row.account)) throw new OAuthError('invalid_grant', 'This account is no longer eligible; sign in again');
      const label = store.apiTokens().find((t) => t.id === row.access_id)?.label;
      // As at sign-in: still allowed (a second factor now required, a password to change, AI access taken away), and
      // with the same password: a password changed since signs the app out.
      if (!markCurrent(store, row.account, row.password, identity?.person) || this.allowed(store, row.account, clientAddress(req), false, false)) {
        store.revokeApiToken(row.access_id);
        throw new OAuthError('invalid_grant', 'This account\'s password or access changed since it signed in; sign in again');
      }
      try {
        return this.issue(client, row.database, row.account, clientAddress(req), audience, label, identity ? row.expires : undefined, identity, true, row.password, row.access_id, family);
      } catch (e) {
        // Whatever stopped the refresh, the access token it was renewing does not stay in use: its refresh token is already used up.
        store.revokeApiToken(row.access_id);
        throw e;
      }
    }
    throw new OAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
  }

  private issue(client: Client, database: string, account: string, from: string, audience: string, label?: string, keepExpiry?: number, identity?: { issuer: string; sub: string; person?: string; mapping: string }, refreshing = false, signedInMark: string | null = null, replacing?: string, family = token('og_')): Record<string, unknown> {
    const store = this.host.get(database);
    if (!store) throw new OAuthError('invalid_grant', `${database} is no longer hosted`);
    if (identity && (identity.mapping !== account || !store.canonicalAccount(identity.mapping) || !store.isExternalAccount(identity.mapping) || (identity.person && store.accountInactive(identity.person)))) throw new OAuthError('invalid_grant', 'This federated sign-in is no longer valid; sign in again');
    if (this.allowed(store, account, from, !!identity, !refreshing)) throw new OAuthError('invalid_grant', "This account's access changed since it signed in; sign in again");
    // The mark the caller checked is checked again as the token is written, under the file's lock: a password or privilege change
    // made in between (by another worker) must not be outlived by a token of the old sign-in. The refresh row keeps that same mark.
    let mark = '';
    const access = store.createApiToken(account, {
      label: (label ?? `AI app: ${plain(client.name)}`).slice(0, 80), surfaces: ['fmmcp'], provenance: 'delegated', expires: new Date(expiryClock.now() + ACCESS_SECONDS * 1000), ...(identity ? { identity } : {}),
      guard: () => {
        // A refresh takes the access token it renews out in the same change that writes the next one, and refuses when it is already gone:
        // revoked in Manage Security (by another worker, say) between the check and now, the sign-in is over.
        if (replacing && !store.revokeApiToken(replacing)) throw new OAuthError('invalid_grant', 'This sign-in was revoked; sign in again');
        if (!markCurrent(store, account, signedInMark, identity?.person)) throw new OAuthError('invalid_grant', 'This account\'s password or access changed since it signed in; sign in again');
        mark = passwordMark(store, account, identity?.person);
      },
    });
    const accessId = /^ohbt_([0-9a-f]+)\./.exec(access)![1];
    const refresh = token('ohrt_');
    // Written only if the sign-in has not been ended meanwhile (the app signed out through another worker): then the token just made goes too.
    const write = () => {
      if (this.db.prepare('SELECT 1 FROM revoked_grants WHERE grant_id = ?').get(family)) return true;
      this.db.prepare('INSERT INTO refresh (hash, client_id, database, account, access_id, expires, password, identity, resource, family, grant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(hash(refresh), client.id, store.name, account, accessId, keepExpiry ?? expiryClock.now() + (identity ? REFRESH_EXTERNAL_MS : REFRESH_MS), mark, identity ? JSON.stringify(identity) : null, audience, family, family);
      this.db.prepare('UPDATE clients SET used = ? WHERE id = ?').run(Date.now(), client.id);
      return false;
    };
    let ended: boolean;
    try { ended = this.inTransaction(write); }
    catch (error) {
      store.revokeApiToken(accessId);
      throw error;
    }
    if (ended) {
      store.revokeApiToken(accessId);
      throw new OAuthError('invalid_grant', 'This sign-in was ended; sign in again');
    }
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: 'mcp' };
  }

  /** Sign-ins whose refresh token ran out: their last access token goes from the file too. */
  private sweep(): void {
    const old = this.db.prepare('DELETE FROM refresh WHERE expires < ? RETURNING database, access_id').all(expiryClock.now()) as { database: string; access_id: string }[];
    for (const r of old) this.host.get(r.database)?.revokeApiToken(r.access_id);
    this.db.prepare('DELETE FROM codes WHERE expires < ?').run(expiryClock.now());
    this.db.prepare('DELETE FROM retired WHERE expires < ?').run(expiryClock.now());
    this.db.prepare('DELETE FROM revoked_grants WHERE expires < ?').run(expiryClock.now());
    this.db.prepare('DELETE FROM spent_refresh WHERE expires < ?').run(expiryClock.now());
  }

  /** Runs `work` as one write transaction on the OAuth file, which other workers wait for. */
  private inTransaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Ends a sign-in: its refresh tokens go, it is remembered as ended (so a rotation under way ends too), and its access tokens are revoked. */
  private endGrant(grantId: string): void {
    const live = this.inTransaction(() => {
      this.db.prepare('INSERT OR REPLACE INTO revoked_grants (grant_id, expires) VALUES (?, ?)').run(grantId, expiryClock.now() + REFRESH_MS);
      return this.db.prepare('DELETE FROM refresh WHERE grant_id = ? OR family = ? RETURNING database, access_id').all(grantId, grantId) as { database: string; access_id: string }[];
    });
    for (const r of live) this.host.get(r.database)?.revokeApiToken(r.access_id);
  }

  /** A spent refresh token used again after the grace window: the whole sign-in is treated as stolen and ends. */
  private revokeFamily(family: string): void {
    this.endGrant(family);
  }

  /** OAuth tokens carry their audience and account mark in the grant record; check both on every MCP request. */
  managedAccess(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM refresh WHERE access_id = ?').get(id);
  }

  accessAllowed(id: string, req: IncomingMessage, store: Store, account: string): boolean {
    const row = this.db.prepare('SELECT resource, password, account, identity FROM refresh WHERE access_id = ? AND database = ?').get(id, store.name) as { resource: string | null; password: string; account: string; identity: string | null } | undefined;
    // A federated grant's mark is bound to the person as well as the mapping account it signed in through.
    const person = row?.identity ? (JSON.parse(row.identity) as { person?: string }).person : undefined;
    return !!row && row.account === account && row.resource === `${this.base(req)}/mcp` && markCurrent(store, account, row.password, person);
  }

  private revoke(req: IncomingMessage, form: URLSearchParams): void {
    const client = this.callingClient(req, form);
    const value = form.get('token') ?? '';
    type Found = { database: string; access_id: string; grant_id: string | null };
    if (value.startsWith('ohrt_')) {
      // One still to be used, or one already used (the app may sign out with the token it holds while the new one is on its way): either ends the whole sign-in.
      const h = hash(value);
      const row = (this.db.prepare('SELECT database, access_id, grant_id FROM refresh WHERE hash = ? AND client_id = ?').get(h, client.id)
        ?? this.db.prepare('SELECT database, access_id, grant_id FROM retired WHERE hash = ? AND client_id = ?').get(h, client.id)) as Found | undefined;
      if (!row) return;
      if (row.grant_id) this.endGrant(row.grant_id);
      else this.db.prepare('DELETE FROM refresh WHERE hash = ? AND client_id = ?').run(h, client.id);
      this.host.get(row.database)?.revokeApiToken(row.access_id);
      return;
    }
    const id = /^ohbt_([0-9a-f]+)\./.exec(value)?.[1];
    if (!id) return;
    // An access token: only one this app was given, and only the whole token (its id alone is in the security log).
    const row = (this.db.prepare('SELECT database, grant_id FROM refresh WHERE access_id = ? AND client_id = ?').get(id, client.id)
      ?? this.db.prepare('SELECT database, grant_id FROM retired WHERE access_id = ? AND client_id = ?').get(id, client.id)) as Omit<Found, 'access_id'> | undefined;
    const store = row && this.host.get(row.database);
    if (!row || !store?.apiToken(value)) return;
    if (row.grant_id) this.endGrant(row.grant_id);
    else this.db.prepare('DELETE FROM refresh WHERE access_id = ? AND client_id = ?').run(id, client.id);
    store.revokeApiToken(id);
  }
}
