// FileMaker Server's Admin API (v2), so tools written for it (fmcsadmin,
// Claris Connect's FileMaker Admin connector, in-house scripts) can manage
// Tabularius too: list, open, close and pause files; see and disconnect
// clients and send them messages; and manage script schedules.
//
//   POST   /fmi/admin/api/v2/user/auth              Basic (the admin password, any user name) -> {token}
//   DELETE /fmi/admin/api/v2/user/auth/{token}      log out
//   GET    /fmi/admin/api/v2/server/metadata        name, version, host time
//   GET    /fmi/admin/api/v2/server/status          {status: RUNNING | STOPPED}
//   PATCH  /fmi/admin/api/v2/server/status          {status}: STOPPED closes every file, RUNNING opens them
//   GET    /fmi/admin/api/v2/databases              hosted files
//   PATCH  /fmi/admin/api/v2/databases[/{id}]       {status: OPENED | CLOSED | PAUSED | RESUMED, messageText}
//   GET    /fmi/admin/api/v2/clients                who is connected
//   DELETE /fmi/admin/api/v2/clients/{id}           disconnect (?messageText=)
//   POST   /fmi/admin/api/v2/clients/{id}/message   {messageText}
//   GET    /fmi/admin/api/v2/schedules[/{id}]       script schedules
//   POST   /fmi/admin/api/v2/schedules/filemakerscript   create one (or ?source={id} on /schedules to duplicate)
//   PATCH  /fmi/admin/api/v2/schedules/{id}         {enabled}, {status: "RUNNING"} to run now, or new settings
//   DELETE /fmi/admin/api/v2/schedules/{id}
//
// Shapes follow Claris's Admin API reference (research/admin-api-spec.md):
// every answer is {response, messages: [{code, text}]} with string codes.
// Only FileMaker script schedules exist here, and they never reach the network
// when made through this API. Backups have their own settings (the console and
// command line), so backup, verify and system-script schedules are refused
// with code 21, "Not Supported".

import { IdentityInFlight, busyHeaders } from './in-flight.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { statSync } from 'node:fs';
import type { Admin } from './admin.ts';
import type { DataApi } from './dataapi.ts';
import type { Host } from './host.ts';
import type { Live } from './live.ts';
import { ApiError, readBoundedJson } from './dataapi.ts';
import { drainSmallBody } from './request-body.ts';
import { sameOriginRequest } from './browser-request.ts';
import { PASSWORD_POLICY } from '../../store/src/index.ts';
import { CertificateError, type ImportedCertificates } from './cert-import.ts';
import { ScheduleError, type Schedule, type ScheduleInput, type Schedules } from './schedules.ts';
import { said } from './said.ts';

const BASE = '/fmi/admin/api/v2';
/** Like FileMaker Server, a token lasts 15 minutes past its last use. */
const TOKEN_IDLE_MS = 15 * 60_000;
const TOKEN_LIFETIME_MS = 8 * 60 * 60_000;
const MAX_TOKENS = 100;
const MAX_PATH = 2048;

/** Methods for syntactically known paths, before looking up a resource or reading a body. */
function allowedMethods(path: string): string | undefined {
  if (path === '/user/auth') return 'POST';
  if (/^\/user\/auth\/[^/]+$/.test(path)) return 'DELETE';
  if (path === '/server/metadata' || path === '/clients' || path === '/plugins') return 'GET';
  if (path === '/server/status' || path === '/databases' || path === '/server/config/security' ||
      path === '/server/config/blocknewusers' || /^\/server\/config\/(general|authenticatedstream|parallelbackup|persistentcache)$/.test(path) ||
      path === '/php/config' || path === '/xml/config' || path === '/fmclients/httpstunneling') return 'GET, PATCH';
  if (/^\/databases\/\d+$/.test(path)) return 'PATCH, DELETE';
  if (/^\/clients\/\d+\/message$/.test(path)) return 'POST';
  if (/^\/clients\/\d+$/.test(path)) return 'DELETE';
  if (path === '/schedules') return 'GET, POST';
  if (/^\/schedules\/\d+$/.test(path)) return 'GET, PATCH, DELETE';
  if (/^\/schedules\/[a-z]+$/.test(path)) return 'POST';
  if (path === '/server/certificate/csr' || path === '/server/certificate/import') return 'PATCH';
  if (path === '/server/certificate/delete') return 'DELETE';
  return undefined;
}

interface AdminToken {
  created: number;
  lastUsed: number;
  passwordFingerprint: string;
}
/** The Admin API level this answers as: tools check it to decide what they may ask for. */
export const ADMIN_API_VERSION = '21.0.1.0';

interface FixedSettings {
  values: Record<string, unknown>;
  /** Why they can't be changed here. */
  why: string;
}

/**
 * FileMaker Server settings with no counterpart to change in Tabularius, answered as the values that describe it, so
 * tools that read them (fmcsadmin's get serverconfig and get serverprefs) work. (requireSecureDB, which Tabularius
 * sets for each file, is worked out on each call.)
 */
const FIXED_SETTINGS: Record<string, FixedSettings> = {
  general: {
    // No cache to size (SQLite and the system cache files), no limit on files, connections or server scripts (the
    // highest FileMaker Server allows is answered), journaled files that always recover, and every hosted file opens.
    values: { cacheSize: 512, maxFiles: 256, maxProConnections: 2000, maxPSOS: 500, onlyOpenLastOpenedDatabases: false },
    why: 'Tabularius has no cache size or limits on files, connections or server scripts to set, always recovers its files, and opens every hosted file at start',
  },
  authenticatedstream: {
    // 1: container URLs work without signing in, as Tabularius's signed (expiring) URLs do.
    values: { authenticatedStream: 1 },
    why: 'container URLs are signed and expire (TABULARIUS_CONTAINER_TTL), rather than tied to a session',
  },
  parallelbackup: {
    values: { parallelBackupEnabled: false },
    why: 'backups are set up in the admin console or with tabularius serve --backup-every',
  },
  persistentcache: {
    values: { persistentCache: false, persistentCacheSync: false, databaseServerAutoRestart: false },
    why: 'Tabularius writes every change to the file as it commits; there is no cache to persist',
  },
  // Web technologies FileMaker Server has that Tabularius doesn't (PHP, HTTPS tunneling), and the XML interface it serves read-only.
  php: {
    values: { enabled: false, characterEncoding: 'UTF-8', errorMessageLanguage: 'en', dataPreValidation: false, useFileMakerPhp: false },
    why: 'Tabularius has no Custom Web Publishing with PHP; use the Data API or OData',
  },
  xml: {
    // The XML interface (/fmi/xml, reads only) is always served, so it reports enabled; it can't be turned off.
    values: { enabled: true },
    why: 'the XML interface is always served (reads only), so it can\'t be turned off',
  },
  httpstunneling: {
    values: { enableHTTPSTunneling: false },
    why: 'Tabularius serves its web client, Data API and OData over HTTPS on one port, and has no FileMaker Pro protocol to tunnel',
  },
};

class AdminApiError extends Error {
  readonly code: number;
  readonly status: number;
  /** For a 405: the methods that path does answer (the Allow header). */
  readonly allow?: string;
  constructor(code: number, message: string, status = 400, allow?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.allow = allow;
  }
}

/** Check supplied JSON types before defaults, coercions or unsupported-feature checks. */
function scheduleTypes(body: Record<string, unknown>): void {
  const fields = (object: Record<string, unknown>, type: 'string' | 'boolean' | 'number', names: string[], prefix = '') => {
    for (const name of names) {
      if (object[name] !== undefined && typeof object[name] !== type) {
        throw new AdminApiError(960, `Parameter is invalid: ${prefix}${name} must be a ${type}`);
      }
      if (type === 'string' && typeof object[name] === 'string') {
        const max = name === 'fmScriptParam' ? 10_000 : name === 'backupTarget' ? 1024 : 255;
        if (object[name].length > max) throw new AdminApiError(960, `Parameter is invalid: ${prefix}${name} is at most ${max} characters`);
      }
    }
  };
  const object = (value: unknown, field: string): Record<string, unknown> | undefined => {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new AdminApiError(960, `Parameter is invalid: ${field} must be an object`);
    }
    return value as Record<string, unknown>;
  };
  fields(body, 'string', ['name']);
  fields(body, 'boolean', ['enabled']);
  for (const name of ['backupType', 'messageType', 'filemakerScriptType', 'scriptSequenceType', 'systemScriptType', 'verifyType', 'onceType', 'weeklyType', 'everyndaysType']) {
    const value = object(body[name], name);
    if (!value) continue;
    const prefix = `${name}.`;
    if (name === 'backupType') {
      fields(value, 'string', ['resourceType', 'resource', 'backupTarget'], prefix);
      fields(value, 'boolean', ['clone', 'verifyBackup'], prefix);
      fields(value, 'number', ['retainBackups'], prefix);
    } else if (name === 'messageType') {
      fields(value, 'string', ['resourceType'], prefix);
      // messageText() treats a null text as not given
      for (const text of ['text', 'messageText']) if (value[text] !== null) fields(value, 'string', [text], prefix);
    } else if (name === 'filemakerScriptType') {
      fields(value, 'string', ['resource', 'fmScriptName', 'fmScriptParam', 'fmScriptAccount'], prefix);
    } else if (name === 'weeklyType' || name === 'everyndaysType') {
      fields(value, 'string', ['startTimeStamp'], prefix);
      if (name === 'everyndaysType') fields(value, 'number', ['dailyDays'], prefix);
      if (name === 'weeklyType' && value.daysOfTheWeek !== undefined &&
          (!Array.isArray(value.daysOfTheWeek) || value.daysOfTheWeek.length > 7 || value.daysOfTheWeek.some((day) => typeof day !== 'string' || day.length > 3))) {
        throw new AdminApiError(960, `Parameter is invalid: ${prefix}daysOfTheWeek must be at most 7 short strings`);
      }
      const repeat = object(value.repeatTask, `${prefix}repeatTask`);
      if (repeat) {
        fields(repeat, 'number', ['repeatFrequency'], `${prefix}repeatTask.`);
        fields(repeat, 'string', ['repeatInterval'], `${prefix}repeatTask.`);
      }
    }
  }
}

/** Stable small numeric ids ("2", "3", ...) for things Tabularius names otherwise, as FileMaker's tools expect. */
class Ids {
  private readonly byKey = new Map<string, string>();
  private readonly byId = new Map<string, string>();
  private next: number;
  constructor(first: number) {
    this.next = first;
  }
  id(key: string): string {
    let id = this.byKey.get(key);
    if (!id) {
      if (this.byKey.size >= 4096) this.forget(this.byKey.keys().next().value!);
      id = String(this.next++);
      this.byKey.set(key, id);
      this.byId.set(id, key);
    }
    return id;
  }
  key(id: string): string | undefined {
    return this.byId.get(id);
  }
  private forget(key: string): void {
    const id = this.byKey.get(key);
    if (id !== undefined) this.byId.delete(id);
    this.byKey.delete(key);
  }
  retain(keys: Iterable<string>): void {
    const live = new Set(keys);
    for (const key of this.byKey.keys()) if (!live.has(key)) this.forget(key);
  }
}

/** FileMaker's local timestamp form: 2026-10-12T09:30:00, no zone. */
function stamp(t: number | string | undefined): string {
  if (t === undefined) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Unambiguous companion to the FileMaker-compatible local timestamp fields. */
function stampISO(t: number | string | undefined): string {
  if (t === undefined) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  return `${stamp(t)}${offset < 0 ? '-' : '+'}${p(Math.floor(Math.abs(offset) / 60))}:${p(Math.abs(offset) % 60)}`;
}

function duration(seconds: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(seconds / 3600))}:${p(Math.floor(seconds / 60) % 60)}:${p(seconds % 60)}`;
}

/** FileMaker's path form for a folder: filemac:/..., filewin:/C:/..., filelinux:/... */
function fmPath(dir: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/?$/, '/');
  if (process.platform === 'win32') return 'filewin:/' + d;
  return (process.platform === 'darwin' ? 'filemac:' : 'filelinux:') + d;
}

function serverIp(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '127.0.0.1';
}

export class AdminApi {
  private readonly admin: Admin;
  private readonly host: Host;
  private readonly api: DataApi;
  private readonly inFlight = new IdentityInFlight();
  private readonly tokens = new Map<string, AdminToken>();
  private readonly dbIds = new Ids(1);
  private readonly clientIds = new Ids(1);
  // Schedule 1 is FileMaker Server's own; user schedules start at 2.
  private readonly scheduleIds = new Ids(2);
  private readonly pluginIds = new Ids(1);
  /** Set when the server was stopped through the API: which files to open again on RUNNING. */
  private stoppedFiles?: string[];
  schedules?: Schedules;
  live?: Live;
  /**
   * Certificates put in place here (fmcsadmin certificate create/import/delete). `managed` says why not, when the
   * server gets its certificate another way; `use` serves a new one at once, where this process serves https.
   */
  certificates?: { store: ImportedCertificates; managed?: string; use?: (cert: string, key: string) => void };

  constructor(admin: Admin, host: Host, api: DataApi) {
    this.admin = admin;
    this.host = host;
    this.api = api;
  }

  /** Returns false when the request is not for the Admin API. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return false;
    const path = url.pathname.slice(BASE.length) || '/';
    const send = (status: number, response: unknown, code = 0, text = 'OK', headers: Record<string, string> = {}) =>
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
        .end(JSON.stringify({ response, messages: [{ code: String(code), text }] }));
    let done: (() => void) | undefined;
    try {
      const method = req.method ?? 'GET';
      if (path.length > MAX_PATH) throw new AdminApiError(960, 'Parameter is invalid: request path is too long');
      const allow = allowedMethods(path);
      // The sign-in route is open to everyone; for any other path, which methods it answers and how it reads an id are told only to a signed-in caller.
      if (path === '/user/auth') {
        if (method !== 'POST') throw new AdminApiError(3, 'Unavailable command', 405, allow);
        return await this.login(req, send);
      }
      const logout = /^\/user\/auth\/([^/]+)$/.exec(path);
      this.authorize(req);
      const numericId = /^\/(?:databases|clients|schedules)\/(\d+)(?:\/|$)/.exec(path)?.[1];
      if (numericId && numericId.length > 9) throw new AdminApiError(960, 'Parameter is invalid: id is too long');
      if (allow && !allow.split(', ').includes(method)) throw new AdminApiError(3, 'Unavailable command', 405, allow);
      done = this.inFlight.enter('admin', res);
      if (!done) {
        busyHeaders(res);
        return send(503, {}, 956, 'Too many requests in flight for this identity'), true;
      }
      if (logout && method === 'DELETE') {
        this.tokens.delete(decodeURIComponent(logout[1]));
        return send(200, {}), true;
      }
      const body = method === 'PATCH' || method === 'POST' ? await this.body(req) : {};
      send(200, await this.route(method, path, url, body));
    } catch (e) {
      if (e instanceof AdminApiError) send(e.status, {}, e.code, e.message, e.status === 401 ? { 'www-authenticate': 'Bearer realm="Tabularius admin"' } : e.allow ? { allow: e.allow } : {});
      else if (e instanceof ScheduleError) send(400, {}, 960, e.message);
      else if (e instanceof URIError) send(400, {}, 960, 'Parameter is invalid: the request path has an invalid % escape');
      else {
        console.error(e);
        send(500, {}, -1, 'Internal server error');
      }
    } finally { done?.(); }
    return true;
  }

  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    try {
      const b = await readBoundedJson(req);
      return b;
    } catch (e) {
      if (e instanceof ApiError && e.status === 413) throw new AdminApiError(960, 'Request body too large', 413);
      throw new AdminApiError(960, 'Parameter is invalid: the body is not JSON');
    }
  }

  private async login(req: IncomingMessage, send: (status: number, response: unknown, code?: number, text?: string, headers?: Record<string, string>) => void): Promise<true> {
    // Browsers may attach cached Basic credentials to a cross-site form. Refuse it before authenticating or
    // allocating a token; native clients need neither Origin nor Fetch Metadata (including bodyless logins).
    if (!sameOriginRequest(req, this.host.publicUrl, this.host.browserOrigins)) throw new AdminApiError(9, 'Access denied', 403);
    if (!/^Basic\s+/i.test(req.headers.authorization ?? '')) throw new AdminApiError(1702, 'Authentication information wasn\'t provided in the correct format; verify the value of the Authorization header', 401);
    const passwordFingerprint = this.admin.passwordFingerprint();
    const denied = this.admin.checkBasic(req);
    if (denied) {
      const headers: Record<string, string> = denied.retryAfter ? { 'retry-after': String(denied.retryAfter) } : {};
      if (denied.status === 429) return send(429, {}, 214, 'Too many login attempts, account locked out', headers), true;
      if (denied.message === 'Admin password required') return send(401, {}, 212, 'Set an admin password before using the Admin API (tabularius admin-password <folder>)'), true;
      return send(401, {}, 212, 'Invalid user account and/or password; please try again'), true;
    }
    await drainSmallBody(req);
    if (passwordFingerprint !== this.admin.passwordFingerprint()) return send(401, {}, 9, 'Access denied'), true;
    const now = performance.now();
    for (const [t, session] of this.tokens) if (!this.tokenCurrent(session, now, passwordFingerprint)) this.tokens.delete(t);
    if (this.tokens.size >= MAX_TOKENS) return send(401, {}, 956, 'Maximum number of Admin API sessions exceeded'), true;
    const token = randomBytes(32).toString('base64url');
    this.tokens.set(token, { created: now, lastUsed: now, passwordFingerprint });
    send(200, { token });
    return true;
  }

  // Only a Bearer token opens the other endpoints: a browser never adds one on
  // its own, so a page elsewhere can't use a saved admin login against them.
  private authorize(req: IncomingMessage): void {
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const session = token ? this.tokens.get(token) : undefined;
    const now = performance.now();
    if (!session || !this.tokenCurrent(session, now, this.admin.passwordFingerprint())) {
      if (token) this.tokens.delete(token);
      throw new AdminApiError(9, 'Access denied', 401);
    }
    session.lastUsed = now;
  }

  private tokenCurrent(session: AdminToken, now: number, passwordFingerprint: string): boolean {
    return session.passwordFingerprint === passwordFingerprint
      && now - session.lastUsed <= TOKEN_IDLE_MS
      && now - session.created < TOKEN_LIFETIME_MS;
  }

  private async route(method: string, path: string, url: URL, body: Record<string, unknown>): Promise<unknown> {
    if (path === '/server/metadata' && method === 'GET') return this.metadata();
    if (path === '/server/status') {
      if (method === 'GET') return { status: this.stoppedFiles ? 'STOPPED' : 'RUNNING' };
      if (method === 'PATCH') return await this.serverStatus(body);
    }
    if (path === '/databases') {
      if (method === 'GET') return this.databases();
      if (method === 'PATCH') {
        const status = this.status(body);
        const databases = [];
        for (const f of this.host.files()) databases.push(await this.setStatus(f.name, status, body));
        return { databases };
      }
    }
    const db = /^\/databases\/(\d+)$/.exec(path);
    if (db) {
      const name = this.dbIds.key(db[1]);
      const file = name && this.host.files().find((f) => f.name.toLowerCase() === name.toLowerCase());
      if (!file) throw new AdminApiError(1700, 'Resource doesn\'t exist', 404);
      if (method === 'PATCH') return { database: await this.setStatus(file.name, this.status(body), body) };
      if (method === 'DELETE') throw new AdminApiError(21, 'Not Supported: remove the file from the hosted folder instead', 400);
    }
    if (path === '/clients' && method === 'GET') return this.clients();
    const client = /^\/clients\/(\d+)(\/message)?$/.exec(path);
    if (client) {
      const listId = this.clientIds.key(client[1]);
      const token = listId && this.api.tokenById(listId);
      if (!listId || !token) throw new AdminApiError(1700, 'Resource doesn\'t exist', 404);
      if (client[2] && method === 'POST') {
        const text = this.messageText(body.messageText, true)!;
        this.live?.message(text, token);
        return { client: { id: client[1] } };
      }
      if (!client[2] && method === 'DELETE') {
        const text = this.messageText(url.searchParams.get('messageText') ?? undefined, false);
        if (text) this.live?.message(text, token);
        this.api.endById(listId);
        return { client: { id: client[1] } };
      }
    }
    if (path.startsWith('/schedules')) return this.handleSchedules(method, path, url, body);
    const setting = /^\/server\/config\/(general|authenticatedstream|parallelbackup|persistentcache)$/.exec(path)?.[1]
      ?? (path === '/php/config' ? 'php' : path === '/xml/config' ? 'xml' : path === '/fmclients/httpstunneling' ? 'httpstunneling' : undefined);
    if (setting) {
      const fixed = FIXED_SETTINGS[setting];
      if (method === 'GET') return fixed.values;
      if (method === 'PATCH') return this.unchanged(fixed, body);
    }
    if (path === '/server/config/security') {
      // Off another machine an empty password never signs in, unless the server was started with
      // --allow-blank-passwords or a file was set to allow it from the LAN.
      const security = { requireSecureDB: !PASSWORD_POLICY.blankFromNetwork && !this.host.names().some((n) => this.host.get(n)?.allowBlankPasswordFromLan()) };
      if (method === 'GET') return security;
      if (method === 'PATCH') return this.unchanged({ values: security, why: 'empty passwords from other machines are allowed with tabularius serve --allow-blank-passwords, or for each file from the LAN in the admin console' }, body);
    }
    if (path === '/server/config/blocknewusers') {
      if (method === 'GET') return { blockNewUsers: this.host.config.blockNewUsers() };
      if (method === 'PATCH') return this.blockNewUsers(body);
    }
    if (path === '/plugins' && method === 'GET') return { plugins: this.plugins() };
    if (path === '/server/certificate/csr' && method === 'PATCH') return this.certificate('csr', body);
    if (path === '/server/certificate/import' && method === 'PATCH') return this.certificate('import', body);
    if (path === '/server/certificate/delete' && method === 'DELETE') return this.certificate('delete', body);
    throw new AdminApiError(3, 'Unavailable command', 404);
  }

  /** A PATCH of settings Tabularius doesn't have: fine when it changes nothing (tools send every value back), else Not Supported. */
  private unchanged(fixed: FixedSettings, body: Record<string, unknown>): Record<string, unknown> {
    for (const [k, v] of Object.entries(body)) {
      if (!(k in fixed.values)) throw new AdminApiError(960, `Parameter is invalid: ${k}`);
      if (v !== fixed.values[k]) throw new AdminApiError(21, `Not Supported: ${fixed.why}`);
    }
    return fixed.values;
  }

  private blockNewUsers(body: Record<string, unknown>): { blockNewUsers: boolean } {
    const on = body.blockNewUsers;
    if (on === undefined) throw new AdminApiError(958, 'Parameter missing: blockNewUsers');
    if (typeof on !== 'boolean') throw new AdminApiError(960, 'Parameter is invalid: blockNewUsers is true or false');
    if (on !== this.host.config.blockNewUsers()) {
      this.host.config.setBlockNewUsers(on);
      this.host.logs?.write('Event', 'Information', '', on ? 'New users are blocked (Admin API): only sessions already open carry on' : 'New users may sign in again (Admin API)');
    }
    return { blockNewUsers: on };
  }

  private certificate(action: 'csr' | 'import' | 'delete', body: Record<string, unknown>): Record<string, unknown> {
    const c = this.certificates;
    if (!c) throw new AdminApiError(21, 'Not Supported: certificates');
    if (c.managed) throw new AdminApiError(21, `Not Supported: ${c.managed}`);
    const text = (k: string) => {
      const v = body[k];
      if (v !== undefined && v !== null && typeof v !== 'string') throw new AdminApiError(960, `Parameter is invalid: ${k}`);
      if (typeof v === 'string' && v.length > (k === 'certificate' || k === 'privateKey' || k === 'intermediateCertificates' ? 1_000_000 : 1024)) {
        throw new AdminApiError(960, `Parameter is invalid: ${k} is too long`);
      }
      return (v ?? '') as string;
    };
    try {
      if (action === 'csr') {
        const encoded = text('subject');
        if (!encoded) throw new AdminApiError(958, 'Parameter missing: subject');
        // fmcsadmin sends the subject base64-encoded ("/CN=…/O=…").
        const decoded = /^[A-Za-z0-9+/]+=*$/.test(encoded) ? Buffer.from(encoded, 'base64').toString('utf8') : encoded;
        const subject = decoded.startsWith('/') ? decoded : encoded;
        const request = c.store.createRequest(subject, text('password'));
        this.host.logs?.write('Event', 'Information', '', `Certificate request made for ${subject} (Admin API)`);
        return { csr: request };
      }
      if (action === 'import') {
        const certificate = text('certificate');
        if (!certificate) throw new AdminApiError(958, 'Parameter missing: certificate');
        const r = c.store.import({ certificate, privateKey: text('privateKey'), intermediateCertificates: text('intermediateCertificates'), password: text('password') });
        c.use?.(r.cert, r.key);
        this.host.logs?.write('Event', 'Information', '', `Certificate for ${r.subject} (valid until ${r.expires}) imported (Admin API)${c.use ? ', in use now' : ', used from the next start'}`);
        return { subject: r.subject, expires: r.expires, restartRequired: !c.use };
      }
      if (!c.store.delete()) throw new AdminApiError(1700, 'Resource doesn\'t exist: no certificate was imported here');
      this.host.logs?.write('Event', 'Information', '', 'Imported certificate deleted (Admin API): the next start serves without it');
      return { restartRequired: true };
    } catch (e) {
      if (e instanceof CertificateError) throw new AdminApiError(e.code, e.message);
      throw e;
    }
  }

  /** Installed plug-ins, as FileMaker Server lists its own; enabled when any hosted file has it turned on. */
  private plugins() {
    const on = new Set(this.host.files().flatMap((f) => this.host.plugins.plugins(f.name).map((m) => m.id)));
    return this.host.plugins.manifests().map((m) => ({ id: this.pluginIds.id(m.id), pluginName: m.name, filename: m.id, version: m.version, enabled: on.has(m.id) }));
  }

  private metadata() {
    const id = createHash('sha256').update(this.host.dir).digest('hex');
    const now = Date.now();
    return {
      serverName: hostname(),
      serverID: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`.toUpperCase(),
      serverIP: serverIp(),
      serverVersion: ADMIN_API_VERSION,
      // fmcsadmin reads this spelling.
      ServerVersion: ADMIN_API_VERSION,
      serverHostTime: stamp(now),
      serverHostTimeISO: stampISO(now),
      product: 'tabularius',
    };
  }

  private async serverStatus(body: Record<string, unknown>) {
    if (typeof body.status !== 'string') throw new AdminApiError(960, 'Parameter is invalid: status must be a string');
    this.messageText(body.messageText, false);
    const status = body.status.toUpperCase();
    if (status === 'STOPPED') {
      if (!this.stoppedFiles) {
        const open = this.host.files().filter((f) => f.status !== 'closed').map((f) => f.name);
        const text = this.messageText(body.messageText, false);
        for (const name of open) await this.setStatus(name, 'CLOSED', { messageText: text });
        this.stoppedFiles = open;
      }
      return { status: 'STOPPED' };
    }
    if (status === 'RUNNING') {
      for (const name of this.stoppedFiles ?? []) await this.host.openFileEverywhere(name);
      this.stoppedFiles = undefined;
      return { status: 'RUNNING' };
    }
    throw new AdminApiError(960, 'Parameter is invalid: status is RUNNING or STOPPED');
  }

  private status(body: Record<string, unknown>): string {
    if (body.status !== undefined && typeof body.status !== 'string') throw new AdminApiError(960, 'Parameter is invalid: status must be a string');
    const status = (body.status ?? '').toUpperCase();
    if (!['OPENED', 'CLOSED', 'PAUSED', 'RESUMED'].includes(status)) {
      throw new AdminApiError(status ? 960 : 958, status ? 'Parameter is invalid: status is OPENED, CLOSED, PAUSED or RESUMED' : 'Parameter missing: status');
    }
    return status;
  }

  private messageText(v: unknown, required: boolean): string | undefined {
    if (v === undefined || v === null || v === '') {
      if (required) throw new AdminApiError(958, 'Parameter missing: messageText');
      return undefined;
    }
    if (typeof v !== 'string') throw new AdminApiError(960, 'Parameter is invalid: messageText must be a string');
    const text = v;
    if (text.length > 200) throw new AdminApiError(960, 'Parameter is invalid: messageText is at most 200 characters');
    return text;
  }

  private fileStatus(name: string): string {
    const f = this.host.files().find((x) => x.name.toLowerCase() === name.toLowerCase());
    return f?.status === 'paused' ? 'PAUSED' : f?.status === 'closed' ? 'CLOSED' : 'NORMAL';
  }

  private async setStatus(name: string, status: string, body: Record<string, unknown>) {
    if (status === 'CLOSED') {
      const text = this.messageText(body.messageText, false);
      if (text) for (const c of this.api.list()) if (c.db.toLowerCase() === name.toLowerCase()) this.live?.message(text, this.api.tokenById(c.id));
      this.api.endByDb(name);
      await this.host.closeFileEverywhere(name);
    } else if (status === 'PAUSED') {
      await this.host.pauseFileEverywhere(name);
    } else if (status === 'RESUMED') {
      if (this.fileStatus(name) === 'PAUSED') await this.host.openFileEverywhere(name);
    } else {
      if (this.fileStatus(name) === 'CLOSED') await this.host.openFileEverywhere(name);
    }
    if (this.stoppedFiles && status !== 'CLOSED') this.stoppedFiles = undefined;
    // fileMode only for native files: a compat file's response keeps FileMaker Server's shape.
    const native = this.host.files().find((f) => f.name.toLowerCase() === name.toLowerCase())?.fileMode === 'native';
    return { id: this.dbIds.id(name.toLowerCase()), filename: name + '.fmp12', status: this.fileStatus(name), ...(native ? { fileMode: 'native' } : {}) };
  }

  private databases() {
    const clients = this.api.list();
    const files = this.host.files();
    const databases = files.map((f) => {
      const store = f.status === 'closed' ? undefined : this.host.storeOf(f.name);
      const extended = new Set<string>();
      for (const p of store?.privilegeSets() ?? []) for (const e of p.extendedPrivileges) extended.add(e);
      let size = 0;
      try {
        size = statSync(f.path).size;
      } catch {
        size = 0;
      }
      return {
        id: this.dbIds.id(f.name.toLowerCase()),
        filename: f.name + '.fmp12',
        ...(f.fileMode === 'native' ? { fileMode: f.fileMode } : {}),
        folder: fmPath(this.host.dir),
        status: f.status === 'paused' ? 'PAUSED' : f.status === 'closed' ? 'CLOSED' : 'NORMAL',
        size,
        clients: clients.filter((c) => c.db.toLowerCase() === f.name.toLowerCase()).length,
        isEncrypted: this.host.encrypted,
        decryptHint: '',
        hasSavedDecryptKey: false,
        enabledExtPrivileges: [...extended].sort(),
      };
    });
    return { totalDBCount: databases.length, openDBCount: databases.filter((d) => d.status !== 'CLOSED').length, databases };
  }

  private clients() {
    const now = Date.now();
    const list = this.api.list();
    this.clientIds.retain(list.map((c) => c.id));
    const clients = list.map((c) => {
      const since = Date.parse(c.since);
      const dbId = this.dbIds.id(c.db.toLowerCase());
      let privset = '';
      try {
        privset = this.host.get(c.db)?.privileges(c.account).name ?? '';
      } catch {
        privset = '';
      }
      return {
        id: this.clientIds.id(c.id),
        userName: c.account,
        computerName: '',
        extpriv: c.client === 'web' ? 'fmwebdirect' : 'fmrest',
        ipaddress: '',
        macaddress: '',
        appType: c.client === 'web' ? 'WebDirect' : 'FileMaker Data API',
        appVersion: '',
        appLanguage: '',
        operatingSystem: '',
        connectTime: stamp(since),
        connectTimeISO: stampISO(since),
        connectDuration: duration(Math.max(0, Math.round((now - since) / 1000))),
        concurrent: false,
        teamLicensed: false,
        status: 'NORMAL',
        guestFiles: [{ id: dbId, filename: c.db + '.fmp12', accountName: c.account, privsetName: privset, groupName: '' }],
      };
    });
    return {
      clients,
      fmproCount: 0,
      fmgoCount: 0,
      fmwebdCount: list.filter((c) => c.client === 'web').length,
      fmconcurrentCount: 0,
      fmsaseCount: 0,
      fmxdbcCount: 0,
      fmmiscCount: list.filter((c) => c.client !== 'web').length,
    };
  }

  // Schedules ---------------------------------------------------------------

  private schedule(s: ReturnType<Schedules['all']>[number]) {
    const at = s.at ?? '00:00';
    const start = new Date();
    const [h, m] = at.split(':').map(Number);
    start.setHours(h || 0, m || 0, 0, 0);
    const days = s.everyMinutes % 1440 === 0 ? s.everyMinutes / 1440 : 1;
    const repeat = s.everyMinutes % 1440 === 0 ? undefined
      : s.everyMinutes % 60 === 0 ? { repeatFrequency: s.everyMinutes / 60, repeatInterval: 'HOURS', endTime: '23:59:00' }
      : { repeatFrequency: s.everyMinutes, repeatInterval: 'MINUTES', endTime: '23:59:00' };
    return {
      id: this.scheduleIds.id(s.id),
      name: s.name,
      enabled: s.enabled,
      status: s.running ? 'RUNNING' : 'IDLE',
      ...(s.unavailable ? { unavailable: s.unavailable } : {}),
      lastError: s.last?.error ?? 0,
      lastRun: s.last ? stamp(s.last.at) : '',
      lastRunISO: s.last ? stampISO(s.last.at) : '',
      nextRun: s.enabled && s.next ? stamp(s.next) : '',
      nextRunISO: s.enabled && s.next ? stampISO(s.next) : '',
      sendEmail: [],
      ...(s.kind === 'message' ? {
        messageType: { resourceType: 'ALL_CLIENTS', text: s.message ?? '' },
      } : s.kind === 'backup' ? {
        // Every hosted file, as FileMaker Server's "all databases" backup; cloning is not offered. verifyBackup reads the new set back.
        backupType: { resourceType: 'ALL_DB', resource: '', backupTarget: s.dest ?? '', retainBackups: s.keep ?? 7, clone: false, verifyBackup: s.verify !== false },
      } : {
        filemakerScriptType: {
          resource: `file:${s.database}.fmp12`,
          fmScriptName: s.script,
          fmScriptParam: s.parameter ?? '',
          fmScriptAccount: s.account,
          fmScriptPassword: '',
          timeout: 0,
          autoAbort: false,
        },
      }),
      // FileMaker Server has no "when the file opens" schedule: such a one shows as daily, with no next run.
      ...(s.onOpen ? { description: 'Runs when the file opens (set in the Tabularius console)' } : {}),
      everyndaysType: { startTimeStamp: stamp(start.getTime()), dailyDays: days, ...(repeat ? { repeatTask: repeat } : {}) },
    };
  }

  /** Turns an Admin API schedule body into Tabularius's settings; only what's given. */
  private scheduleInput(body: Record<string, unknown>, creating: boolean): ScheduleInput {
    scheduleTypes(body);
    const input: ScheduleInput = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name || name.length > 100) throw new AdminApiError(960, 'Parameter is invalid: name is 1 to 100 characters');
      input.name = name;
    } else if (creating) throw new AdminApiError(958, 'Parameter missing: name');
    if (body.enabled !== undefined) input.enabled = body.enabled === true;
    else if (creating) input.enabled = false;
    const backup = body.backupType as Record<string, unknown> | undefined;
    if (backup && body.filemakerScriptType !== undefined) throw new AdminApiError(960, 'Parameter is invalid: a schedule is one type of task');
    const message = body.messageType as Record<string, unknown> | undefined;
    if (message && (body.filemakerScriptType !== undefined || backup)) throw new AdminApiError(960, 'Parameter is invalid: a schedule is one type of task');
    for (const other of [ 'scriptSequenceType', 'systemScriptType', 'verifyType']) {
      if (body[other] !== undefined) throw new AdminApiError(21, `Not Supported: Tabularius schedules run FileMaker scripts, backups and messages (${other})`);
    }
    if (message) {
      const type = String(message.resourceType ?? 'ALL_CLIENTS').toUpperCase();
      if (type !== 'ALL_CLIENTS') throw new AdminApiError(21, 'Not Supported: Tabularius schedule messages go to every connected client (resourceType ALL_CLIENTS)');
      input.kind = 'message';
      const text = message.text ?? message.messageText;
      if (text !== undefined || creating) input.message = this.messageText(text, true);
    }
    if (backup) {
      const type = String(backup.resourceType ?? 'ALL_DB').toUpperCase();
      if (type !== 'ALL_DB') throw new AdminApiError(21, 'Not Supported: Tabularius backs up every hosted file (resourceType ALL_DB)');
      if (backup.clone === true) throw new AdminApiError(21, 'Not Supported: Tabularius backups are not clones');
      input.kind = 'backup';
      if (backup.verifyBackup !== undefined) input.verify = backup.verifyBackup === true;
      if (backup.backupTarget !== undefined) input.dest = String(backup.backupTarget);
      if (backup.retainBackups !== undefined) {
        const keep = backup.retainBackups as number;
        if (!Number.isInteger(keep) || keep < 1 || keep > 1000) throw new AdminApiError(960, 'Parameter is invalid: retainBackups is 1 to 1000');
        input.keep = keep;
      }
    }
    const task = body.filemakerScriptType as Record<string, unknown> | undefined;
    if (backup || message) {
      // nothing else names the task
    } else if (task) {
      const resource = String(task.resource ?? '');
      const file = /^file:(.+?)(?:\.fmp12)?$/i.exec(resource)?.[1];
      if (!file) throw new AdminApiError(960, 'Parameter is invalid: filemakerScriptType.resource is "file:Name.fmp12"');
      input.database = file;
      if (task.fmScriptName !== undefined) input.script = String(task.fmScriptName);
      if (task.fmScriptParam !== undefined) input.parameter = String(task.fmScriptParam);
      if (task.fmScriptAccount !== undefined) input.account = String(task.fmScriptAccount);
    } else if (creating) throw new AdminApiError(958, 'Parameter missing: filemakerScriptType');
    if (body.onceType !== undefined) throw new AdminApiError(21, 'Not Supported: Tabularius schedules repeat (use everyndaysType)');
    const weekly = body.weeklyType as Record<string, unknown> | undefined;
    if (weekly && !(Array.isArray(weekly.daysOfTheWeek) && new Set(weekly.daysOfTheWeek.map(String)).size === 7)) {
      throw new AdminApiError(21, 'Not Supported: Tabularius schedules run every day or every N days (use everyndaysType)');
    }
    const timing = (body.everyndaysType ?? weekly) as Record<string, unknown> | undefined;
    if (timing) {
      // Timing given: it runs on that timer, not when its file opens (which FileMaker Server has no schedule for).
      input.onOpen = false;
      const days = timing === weekly ? 1 : (timing.dailyDays ?? 1) as number;
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw new AdminApiError(960, 'Parameter is invalid: dailyDays is 1 to 3650');
      const time = /T(\d\d:\d\d)/.exec(String(timing.startTimeStamp ?? ''))?.[1];
      if (time && (+time.slice(0, 2) > 23 || +time.slice(3) > 59)) throw new AdminApiError(960, 'Parameter is invalid: startTimeStamp');
      if (time) input.at = time;
      const repeat = timing.repeatTask as Record<string, unknown> | undefined;
      if (repeat) {
        const n = repeat.repeatFrequency as number;
        const unit = String(repeat.repeatInterval ?? 'HOURS').toUpperCase();
        if (!Number.isInteger(n) || n < 1 || n > 10_080 || !['HOURS', 'MINUTES'].includes(unit) || (unit === 'HOURS' && n > 168)) throw new AdminApiError(960, 'Parameter is invalid: repeatTask');
        input.everyMinutes = unit === 'HOURS' ? n * 60 : n;
      } else input.everyMinutes = days * 1440;
    } else if (creating) input.everyMinutes = 1440;
    return input;
  }

  private find(id: string) {
    const key = this.scheduleIds.key(id);
    const s = key && this.schedules!.all().find((x) => x.id === key && !x.sync && x.kind !== 'verify');
    if (!s) throw new AdminApiError(10600, 'Schedule at specified index does not exist', 404);
    return s;
  }

  private current(key: string) {
    return this.schedule(this.schedules!.all().find((x) => x.id === key && !x.sync && x.kind !== 'verify')!);
  }

  private async handleSchedules(method: string, path: string, url: URL, body: Record<string, unknown>): Promise<unknown> {
    if (!this.schedules) throw new AdminApiError(10610, 'No schedules created in configuration file', 404);
    const schedules = this.schedules;
    if (path === '/schedules' && method === 'GET') return { schedules: schedules.all().filter((s) => !s.sync && s.kind !== 'verify').map((s) => this.schedule(s)) };
    if (path === '/schedules' && method === 'POST') {
      const source = url.searchParams.get('source');
      if (!source) throw new AdminApiError(958, 'Parameter missing: source');
      if (!/^\d{1,9}$/.test(source)) throw new AdminApiError(960, 'Parameter is invalid: source is a numeric id');
      const s = this.find(source);
      const copy = schedules.create({
        ...(s.kind === 'backup' ? { kind: 'backup' as const, dest: s.dest, keep: s.keep } : s.kind === 'message' ? { kind: 'message' as const, message: s.message } : {}),
        name: `${s.name} Copy`, database: s.database, script: s.script, parameter: s.parameter, account: s.account,
        everyMinutes: s.everyMinutes, at: s.at, enabled: s.enabled, network: s.network, onOpen: s.onOpen,
        // A copy of a schedule whose scripts changed since they were approved is held the same way.
        approveScripts: !schedules.connectionsHeld(s),
      });
      return { schedule: this.current(copy.id) };
    }
    const create = /^\/schedules\/([a-z]+)$/.exec(path);
    if (create && method === 'POST') {
      const bodyKey: Record<string, string> = { filemakerscript: 'filemakerScriptType', backup: 'backupType', message: 'messageType' };
      if (!bodyKey[create[1]]) throw new AdminApiError(21, `Not Supported: Tabularius schedules run FileMaker scripts, backups and messages (${create[1]})`);
      if (body[bodyKey[create[1]]] === undefined) throw new AdminApiError(958, `Parameter missing: ${bodyKey[create[1]]}`);
      for (const [path, key] of Object.entries(bodyKey)) if (path !== create[1] && body[key] !== undefined) throw new AdminApiError(958, `Parameter missing: ${bodyKey[create[1]]} (the path and the body name different kinds)`);
      const made: Schedule = schedules.create(this.scheduleInput(body, true));
      return { schedule: this.current(made.id) };
    }
    const one = /^\/schedules\/(\d+)$/.exec(path);
    if (!one) throw new AdminApiError(3, 'Unavailable command', 404);
    const s = this.find(one[1]);
    if (method === 'GET') return { schedule: this.schedule(s) };
    if (method === 'DELETE') {
      const shown = this.schedule(s);
      schedules.remove(s.id);
      return { schedule: shown };
    }
    if (method === 'PATCH') {
      if (body.status !== undefined && typeof body.status !== 'string') throw new AdminApiError(960, 'Parameter is invalid: status must be a string');
      const run = said(body.status).toUpperCase();
      if (body.status !== undefined && run !== 'RUNNING') throw new AdminApiError(10601, 'Schedule is misconfigured; invalid taskType or run status');
      const { status: _status, ...rest } = body;
      if (Object.keys(rest).length) schedules.update(s.id, this.scheduleInput(rest, false));
      if (run === 'RUNNING') {
        if (s.running) throw new AdminApiError(10601, 'The schedule is already running', 409);
        void schedules.run(s.id).catch(() => {});
      }
      return { schedule: this.current(s.id) };
    }
    throw new AdminApiError(3, 'Unavailable command', 405, 'GET, PATCH, DELETE');
  }
}
