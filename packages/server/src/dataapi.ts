import { clientAddress } from './client-address.ts';
import { assertAiPolicy } from './ai-policy.ts';
// FileMaker Data API–compatible REST endpoints, so existing integrations can
// point at Tabularius instead of FileMaker Server. Paths, envelopes and error
// codes follow Claris's published Data API guide:
//   POST   /fmi/data/vLatest/databases/{db}/sessions           (Basic auth)
//   DELETE /fmi/data/vLatest/databases/{db}/sessions/{token}
//   GET    /fmi/data/vLatest/databases[/{db}/layouts[/{layout}]]
//   GET    .../layouts/{layout}/records[?_offset&_limit&_sort]
//   GET    .../layouts/{layout}/records/{id}
//   POST   .../layouts/{layout}/records                         {fieldData}
//   PATCH  .../layouts/{layout}/records/{id}                    {fieldData, modId}
//   DELETE .../layouts/{layout}/records/{id}
//   POST   .../layouts/{layout}/_find                           {query, sort, offset, limit}
//   POST   .../layouts/{layout}/records/{id}/containers/{field}[/{rep}]  multipart "upload"
//   GET    .../layouts/{layout}/script/{script}[?script.param]
//   POST   .../layouts/{layout}/records/{id}                    duplicate
//   GET    .../databases/{db}/scripts                           in folders
//   PATCH  .../databases/{db}/globals                           {globalFields}
//   GET    /fmi/data/vLatest/validateSession  and  /productInfo
// test/dataapi-conformance.test.ts checks these against the guide.
// Record requests take script, script.param, script.prerequest[.param] and
// script.presort[.param] (query string or JSON body) and answer with
// scriptResult / scriptError, as FileMaker Server does.
// Container fields read as signed download URLs (see Host.setBaseUrl).
// Records include portalData for the layout's portals and "TO::Field" values
// for related fields on it; PATCH takes portalData and fieldData.deleteRelated.
//
// Every request runs with the account's privilege set: logging in needs the
// fmrest extended privilege (the web client's sessions need fmapp or
// fmwebdirect instead), layouts and scripts the set can't use are hidden,
// records it can't view are left out, and fields it can't see are omitted.

import { AUTH_BODY_LIMIT, drainSmallBody } from './request-body.ts';
import { assertRequestJsonBounds, JsonDepthError, JsonSizeError, JsonNumberError, MAX_JSON_QUERY_BYTES, parseRequestJson } from './request-json.ts';
import { PASSKEY_SECOND_FACTOR_REQUIRED } from '../../store/src/error-codes.ts';
import { sharedSource } from '../../store/src/sign-in-failures.ts';
import { publicPasswordLockout } from './password-login-policy.ts';
import { noteSurfaceSignIn } from './surface-access.ts';
import { requestOrigin } from './public-origin.ts';
import { createHash, randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { closeSync, fstatSync, openSync, readFileSync, readSync, rmSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MultipartLimits, MultipartLimitError } from './multipart-limits.ts';
import { type ContainerFile, plainMessage, explainAccessDenial, fieldDisplayTypes, fieldMetaData, type AccessDenial, PrivilegeError, StoreError, endTransaction, spendPasswordCheck, spendRecoveryCodeCheck, writer, type DateFormat, type FindOptions, type PortalPaging, type SortSpec, Privileges, type Store, type StoredRecord, type Transaction } from '../../store/src/index.ts';
import { ScriptError, ScriptSession, runScript, scriptDenial, type ClientWindow } from '../../scripts/src/index.ts';
import { cleanRuns, type StyleRun } from '../../calc/src/index.ts';
import type { Field, OrderedItem } from '../../fmp12/src/schema.ts';
import type { Host } from './host.ts';
import type { DirectoryAuthenticator } from './ldap.ts';
import type { OAuthGrant } from './oidc.ts';
import { redactPath } from './server-logs.ts';
import { narrowPrivileges } from './token-scope.ts';
import { ContainerUploadError, ContainerUploads, MAX_CONTAINER_FILE, MAX_CONTAINER_PIECE } from './container-uploads.ts';

import { captureDenial, DenialCollector, denialOperation } from './denial-audit.ts';
import { denialOf, type DenialAudit } from '../../store/src/access-denial.ts';
import { decoyPasskeyStart, listedFiles } from './file-list.ts';
import { faultLog, logFaultFor, type FaultLog } from './fault-log.ts';
import { canonicalJson, decimalNumberText } from '../../store/src/native-types.ts';
import { openApiDocument } from './openapi.ts';
import { SERVER_VERSION } from './version.ts';

/** The longest a web-client session whose set turns idle-disconnect off may sit idle: a hard cap, so none lives forever. */
const KEEP_ALIVE_MAX_MS = 24 * 60 * 60 * 1000;

/** Bound login work and validate every entry before checking any password, including the primary file's. */
function dataSourceList(value: unknown): { database: string; username: string; password: string }[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new ApiError(960, 'Parameter is invalid: fmDataSource', 400);
  return value.map((x: unknown) => {
    const { database, username, password } = (x ?? {}) as Record<string, unknown>;
    // Only accounts and passwords: OAuth for an external data source isn't supported.
    if (typeof database !== 'string' || typeof username !== 'string' || typeof password !== 'string' || !database || !username) {
      throw new ApiError(960, 'Parameter is invalid: fmDataSource', 400);
    }
    return { database, username, password };
  });
}

const sessionId = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 12);

export interface Session {
  token: string;
  db: string;
  account: string;
  /** Epoch milliseconds, for display only. */
  started: number;
  /** Monotonic milliseconds, for idle expiry and eviction. */
  lastUsed: number;
  /** Calls using this session right now, for validateSession's isSessionInUse. */
  busy?: number;
  /** $$variables and global fields, kept for the session like FileMaker Server keeps them. */
  scripts: ScriptSession;
  /** How the session logged in: the Data API, or Tabularius's web client. */
  client: 'rest' | 'web';
  /** Signed in through an identity provider: the external account (group or email) whose privilege set applies. */
  via?: string;
  /** Stable identity of the external mapping selected at sign-in. */
  viaId?: string;
  /** Persisted identity generation, preventing same-name recreation from inheriting this session. */
  principalId?: string;
  /** Persisted identity of a separately retained federated person. */
  personId?: string;
  /** Credentials and authority at sign-in: changes require fresh authentication. */
  signInMark?: string;
  /** Extended privileges can be removed live, but cannot be added to an open session. */
  signedInExtended?: string[];
  /** Trusted person and provider identity behind an external privilege mapping. */
  externalIdentity?: { issuer?: string; sub?: string; person?: string; mapping: string };
  /** A scoped API token that may only read: writes and scripts are refused. */
  readOnly?: boolean;
  /** A layout-scoped API token: only these layouts may be read or written through (undefined = every layout the set can use). */
  layoutScope?: string[];
  /** The account owes a password change (marked must-change, or the policy's age passed): only changing it, or logging out, is allowed until it is done. */
  mustChangePassword?: boolean;
  /** The network address the session signed in from (empty for a loopback/internal sign-in). */
  from?: string;
  /** The client's User-Agent at sign-in, shown as the device in the active-sessions view. */
  device?: string;
  /** The web client's window and device, as it last said: for Get ( Device ), Get ( WindowWidth ) and the like. */
  window?: ClientWindow;
  /** fmDataSource at log in: the authenticated account generation in each other hosted file (by lowercased name). */
  dataSources?: Record<string, { account: string; principalId: string }>;
}

/** Extended privileges that let a client log in: FileMaker's for the Data API, and FileMaker Pro or WebDirect access for the web client. */
const CLIENT_PRIVILEGES: Record<Session['client'], string[]> = { rest: ['fmrest'], web: ['fmapp', 'fmwebdirect'] };

/** The account's privileges, read on each request so changes (a revoked fmrest, say) apply at once. */
export function sessionPrivileges(store: Store, session: Session): Privileges {
  if (!store.identityAllowed(session.account, session.via, session.viaId, session.externalIdentity?.person, session.principalId, session.personId)) throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
  let p = store.privileges(session.account, session.via, session.externalIdentity?.person);
  if (session.signInMark !== undefined && session.signInMark !== store.signInMark(session.account, session.via, session.externalIdentity?.person)) {
    throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
  }
  if (session.signedInExtended) {
    const own = p;
    p = new Privileges(own.account, { ...own.set, extendedPrivileges: own.set.extendedPrivileges.filter(e => session.signedInExtended!.includes(e.toLowerCase())) }, own.file, file => own.in(file)).withVia(own.via);
  }
  const sources = session.dataSources;
  if (sources) {
    // In a file named at log in, its own account's privileges; in any other, the session account's as usual.
    const own = p;
    p = new Privileges(own.account, own.set, own.file, (file) => {
      const binding = sources[(file as Store).name.toLowerCase()];
      const source = file as Store;
      if (binding === undefined) return own.in(file);
      if (!source.identityAllowed(binding.account, undefined, undefined, undefined, binding.principalId)) throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
      return source.privileges(binding.account);
    }).withVia(own.via);
  }
  if (!CLIENT_PRIVILEGES[session.client].some((e) => p.has(e))) {
    throw new ApiError(9, `Insufficient privileges: the account's privilege set needs the ${CLIENT_PRIVILEGES[session.client].join(' or ')} extended privilege`, 401, p.extendedDenial(CLIENT_PRIVILEGES[session.client]));
  }
  if (store.isAgent(session.account)) assertAiPolicy(store, p, 'AI agent API', { scripts: true });
  return narrowPrivileges(store, p, { readOnly: session.readOnly, layouts: session.layoutScope });
}

type ScriptPhase = 'prerequest' | 'presort' | '';

/**
 * Beyond FileMaker's Data API: "styles" beside "fieldData" sets the formatting of text fields written in the same
 * request (fonts, sizes, colors and styles over ranges of the value), as Browse mode's Format menu does.
 */
function textFormatting(input: unknown, fieldData: Record<string, unknown>): Record<string, StyleRun[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(960, 'styles must be an object of fields', 400);
  const out: Record<string, StyleRun[]> = {};
  for (const [name, runs] of Object.entries(input as Record<string, unknown>)) {
    const value = fieldData[name];
    if (value === undefined) throw new ApiError(960, `styles for "${name}" need its value in fieldData`, 400);
    const clean = cleanRuns(runs, String(value).length);
    if (!clean) throw new ApiError(960, `styles for "${name}" are not valid`, 400);
    out[name] = clean;
  }
  return out;
}

/**
 * The same for portal rows: "portalStyles" beside "portalData", by portal, then the row's recordId, then "TO::Field".
 * Each field's value must be in that row of portalData.
 */
function portalFormatting(input: unknown, portalData: Record<string, Record<string, unknown>[]>): Record<string, Record<string, Record<string, StyleRun[]>>> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(960, 'portalStyles must be an object of portals', 400);
  const out: Record<string, Record<string, Record<string, StyleRun[]>>> = {};
  for (const [portal, rows] of Object.entries(input as Record<string, unknown>)) {
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) throw new ApiError(960, `portalStyles for "${portal}" must be an object of rows`, 400);
    for (const [recordId, fields] of Object.entries(rows as Record<string, unknown>)) {
      const row = portalData[portal]?.find((r) => r.recordId !== undefined && String(r.recordId) === recordId);
      if (!row) throw new ApiError(960, `portalStyles for row ${recordId} of "${portal}" need that row in portalData`, 400);
      ((out[portal] ??= {})[recordId] = textFormatting(fields, row));
    }
  }
  return out;
}

/** A sort order (`_sort` in a query string, `sort` in a body): an array of {fieldName, sortOrder}; error 960 otherwise. */
function sortParam(v: unknown, name: string): SortSpec[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  let sort = v;
  if (typeof v === 'string') {
    try {
      sort = parseRequestJson(v, MAX_JSON_QUERY_BYTES);
    } catch {
      throw new ApiError(960, `Parameter is invalid: ${name}`, 400);
    }
  }
  if (!Array.isArray(sort) || !sort.every((s) => s && typeof s === 'object' && typeof (s as SortSpec).fieldName === 'string')) {
    throw new ApiError(960, `Parameter is invalid: ${name}`, 400);
  }
  return sort as SortSpec[];
}

/** The most records (or portal rows) one request may ask for: TABULARIUS_DATA_API_MAX_LIMIT, default 10,000, 0 for no cap. Read per request. */
export function maxLimit(): number {
  const given = process.env.TABULARIUS_DATA_API_MAX_LIMIT?.trim();
  const n = given ? Number(given) : 10_000;
  return Number.isInteger(n) && n >= 0 ? n : 10_000;
}

/**
 * An offset or limit: a whole number, 1 or more (a limit may be 0), and a limit no more than maxLimit(); error 960
 * otherwise. A limit past the cap is refused, not cut down, so a client that pages until it gets fewer records than it
 * asked for fails loudly instead of stopping after the first page.
 */
function countParam(v: unknown, name: string, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  const isLimit = /limit$/.test(name);
  if (!Number.isInteger(n) || n < (isLimit ? 0 : 1)) throw new ApiError(960, `Parameter is invalid: ${name}`, 400);
  if (isLimit) overCap(n, name);
  return n;
}

function overCap(n: number, name: string): void {
  const cap = maxLimit();
  if (cap && n > cap) throw new ApiError(960, `Parameter is invalid: ${name} may be at most ${cap.toLocaleString('en')}; ask for the records in pages (use _offset)`, 400);
}

/** Runs fn as one transaction in every file it touches: all of it, or none. */
function atomically<T>(fn: () => T): T {
  const tx: Transaction = { files: new Map() };
  try {
    const r = writer.run({ ...(writer.getStore() ?? {}), transaction: { open: tx } }, fn);
    endTransaction(tx, true);
    return r;
  } catch (e) {
    endTransaction(tx, false);
    throw e;
  }
}

/** script, script.param, script.prerequest, ... from a query string or JSON body. */
function scriptArgs(src: Record<string, unknown> | URLSearchParams): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const key of ['script', 'script.param', 'script.prerequest', 'script.prerequest.param', 'script.presort', 'script.presort.param']) {
    const v = src instanceof URLSearchParams ? src.get(key) : src[key];
    if (v !== null && v !== undefined) out[key] = String(v);
  }
  return out;
}

/**
 * options.entrymode and options.prohibitmode of a create or edit, as the guide describes them. entrymode "script"
 * skips validation set to "Only during data entry" (fields validated "Always" are still checked); prohibitmode
 * "script" may change fields that prohibit modification during data entry. Both default to "user".
 */
function entryOptions(body: Record<string, unknown>): { dataEntry: boolean; skipEntryValidation?: boolean } {
  const options = body.options === undefined || body.options === null ? {} : body.options;
  if (typeof options !== 'object' || Array.isArray(options)) throw new ApiError(960, 'Parameter is invalid: options', 400);
  const mode = (key: string) => {
    const v = (options as Record<string, unknown>)[key] ?? 'user';
    if (v !== 'user' && v !== 'script') throw new ApiError(960, `Parameter is invalid: options.${key}`, 400);
    return v;
  };
  const skip = mode('entrymode') === 'script';
  return { dataEntry: mode('prohibitmode') !== 'script', ...(skip ? { skipEntryValidation: true } : {}) };
}

export class ApiError extends Error {
  readonly code: number;
  readonly status: number;
  readonly denial?: AccessDenial;
  /** Seconds until a sign-in lockout ends: the Retry-After a client can wait on. */
  readonly retryAfter?: number;
  constructor(code: number, message: string, status = 500, denial?: AccessDenial, retryAfter?: number) {
    super(plainMessage(code, message, status));
    this.code = code;
    this.status = status;
    this.denial = denial;
    this.retryAfter = retryAfter;
  }
}

class BoundedBodyError extends ApiError {}

/** A malformed % escape in the request path (/databases/%zz): the caller's mistake, 400 with code 960. */
export function badPathError(): ApiError {
  return new ApiError(960, 'The request path has an invalid % escape', 400);
}

/** The refusal for an account locked out after too many failed sign-ins (401, as before, with the seconds left). */
export function lockedOutError(until: number): ApiError {
  return new ApiError(212, `Too many failed sign-ins; try again after ${new Date(until).toISOString()}`, 401, undefined, Math.max(1, Math.ceil((until - Date.now()) / 1000)));
}

/** The version and build date productInfo reports: Tabularius's own. */
const BUILD = (() => {
  try {
    const path = new URL('../../../package.json', import.meta.url);
    const d = statSync(path).mtime;
    return {
      version: SERVER_VERSION,
      date: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`,
    };
  } catch {
    return { version: SERVER_VERSION, date: '01/01/2026' };
  }
})();

type CatalogEntry = { name: string; isFolder?: boolean; table?: string | null } & Record<string, unknown>;

/**
 * Layout or script names as the Data API lists them: in the file's order,
 * with folders holding their contents (`folderKey`) and "-" for separators.
 * Names the order doesn't know (made since) come last; empty folders and
 * names the account can't use are left out.
 */
function catalogTree(order: OrderedItem[], names: string[], allowed: (name: string) => boolean, folderKey: string, flagAll: boolean, tables?: Map<string, string | null>): CatalogEntry[] {
  const item = (name: string): CatalogEntry => ({ name, ...(flagAll ? { isFolder: false } : {}), ...(tables?.has(name) ? { table: tables.get(name) } : {}) });
  const root: CatalogEntry[] = [];
  const stack: CatalogEntry[][] = [root];
  const known = new Set(names);
  const seen = new Set<string>();
  for (const o of order) {
    stack.length = Math.min(stack.length, o.depth + 1);
    const into = stack[stack.length - 1];
    if (o.kind === 'folder') {
      const children: CatalogEntry[] = [];
      into.push({ name: o.name, isFolder: true, [folderKey]: children });
      stack.push(children);
    } else if (o.kind === 'separator') {
      if (flagAll) into.push({ name: '-', isFolder: false });
    } else if (known.has(o.name) && allowed(o.name) && !seen.has(o.name)) {
      seen.add(o.name);
      into.push(item(o.name));
    }
  }
  for (const n of names) if (!seen.has(n) && allowed(n)) root.push(item(n));
  const prune = (list: CatalogEntry[]): CatalogEntry[] => list.filter((e) => {
    if (!e.isFolder) return true;
    e[folderKey] = prune(e[folderKey] as CatalogEntry[]);
    return (e[folderKey] as CatalogEntry[]).length > 0;
  });
  return prune(root);
}

export const recordJson = (r: StoredRecord) => ({
  ...(r.id ? { id: r.id } : {}),
  fieldData: r.fieldData,
  portalData: r.portalData ?? {},
  recordId: String(r.recordId),
  modId: String(r.modId),
  // Fields showing a value from just before the latest change, while it is worked out again (not in FileMaker's Data API).
  ...(r.updating ? { updating: r.updating } : {}),
  // Formatting on parts of text values, by field (not in FileMaker's Data API, which returns plain text).
  ...(r.styles ? { styles: r.styles } : {}),
  ...(r.portalStyles ? { portalStyles: r.portalStyles } : {}),
});

/** Portal paging from query parameters (_offset.{portal}, _limit.{portal}) or a _find body (offset.{portal}, limit.{portal}). */
function portalPaging(get: (key: string) => unknown, keys: Iterable<string>): PortalPaging {
  const out: PortalPaging = {};
  for (const k of keys) {
    const m = /^_?(offset|limit)\.(.+)$/.exec(k);
    if (!m) continue;
    const n = Number(get(k));
    if (!Number.isFinite(n)) continue;
    if (m[1] === 'limit') overCap(n, k);
    (out[m[2]] ??= {})[m[1] as 'offset' | 'limit'] = n;
  }
  return out;
}

/**
 * Hands each piece of a request body to `onChunk`; resolves when the body has all arrived. If `onChunk` throws (the body is
 * too large, or wrong in some other way) that is the rejection, and reading stops without ending the stream: ending it
 * would destroy the socket, and the code that answers and logs the request would find it gone (an unauthenticated
 * request could take the server down that way). The connection is told to close after the answer; the server discards
 * unread bytes for a bounded time so a client that finishes sending before reading can still receive the refusal.
 */
export function eachChunk(req: IncomingMessage, onChunk: (chunk: Buffer) => void | Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (req.readableEnded) return resolve();
    if (req.destroyed) return reject(new Error('The request was closed before its body arrived'));
    let pending: Promise<void> | undefined;
    let settled = false;
    const done = () => {
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onFail);
      req.off('close', onClose);
    };
    const onFail = (e: unknown) => {
      if (settled) return;
      done();
      req.pause();
      const answer = (req as IncomingMessage & { res?: ServerResponse }).res;
      if (answer && !answer.headersSent) answer.setHeader('connection', 'close');
      // A disk write already in flight must finish before its file is closed and removed.
      if (pending) void pending.then(() => reject(e), () => reject(e));
      else reject(e);
    };
    const onData = (c: Buffer) => {
      try {
        const writing = onChunk(c);
        if (writing) {
          req.pause();
          pending = writing;
          void writing.then(() => {
            pending = undefined;
            if (!settled && !req.destroyed) req.resume();
          }, e => { pending = undefined; onFail(e); });
        }
      } catch (e) { onFail(e); }
    };
    const onEnd = () => {
      if (settled) return;
      const writing = pending;
      done();
      if (writing) void writing.then(resolve, reject);
      else resolve();
    };
    const onClose = () => onFail(new Error('The request was closed before its body arrived'));
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onFail);
    req.on('close', onClose);
  });
}

function multipartLimits(type: string): MultipartLimits | undefined {
  if (!/^multipart\/form-data/i.test(type)) return;
  try { return new MultipartLimits(type); }
  catch (e) { if (e instanceof MultipartLimitError) throw new ApiError(960, e.message, e.status); throw e; }
}
function checkMultipart(limits: MultipartLimits | undefined, chunk: Buffer): void {
  try { limits?.push(chunk); }
  catch (e) { if (e instanceof MultipartLimitError) throw new ApiError(960, e.message, e.status); throw e; }
}

export async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  if (Number(req.headers['content-length']) > max) throw new ApiError(960, 'Request body too large', 413);
  const limits = multipartLimits(req.headers['content-type'] ?? '');
  const chunks: Buffer[] = [];
  let size = 0;
  await eachChunk(req, (c) => {
    size += c.length;
    if (size > max) {
      chunks.length = 0;
      throw new ApiError(960, 'Request body too large', 413);
    }
    checkMultipart(limits, c);
    chunks.push(c);
  });
  const body = Buffer.concat(chunks);
  return body;
}

/** For a body that is optional or tolerated when it is not JSON: that is the fallback, but one that is too large is still refused. */
export function lenient<T>(fallback: T): (e: unknown) => T {
  return (e) => {
    if (e instanceof BoundedBodyError || (e instanceof ApiError && (e.status === 413 || e.cause instanceof JsonDepthError || e.cause instanceof JsonNumberError))) throw e;
    return fallback;
  };
}

const numberSources = new WeakMap<object, Map<string, string>>();
const requestSources = new WeakMap<object, string>();
const responseSerialization = new AsyncLocalStorage<{ exactNumbers: boolean }>();

/** Check duplicate keys only when a native JSON value is written. */
export function validateNativeJsonBody(body: object): void {
  const raw = requestSources.get(body);
  if (!raw) return;
  try { canonicalJson(raw); }
  catch (cause) { const error = new ApiError(960, 'Invalid JSON: duplicate keys in a native json write', 400); error.cause = cause; throw error; }
}

export function jsonNumberSource(holder: object, key: string): string | undefined { return numberSources.get(holder)?.get(key); }

export function stringifyJsonPreservingNumbers(value: unknown): string {
  return JSON.stringify(value, function (this: object, key, v: unknown) {
    const source = jsonNumberSource(this, key);
    return source !== undefined && typeof v === 'number' ? (JSON as typeof JSON & { rawJSON(text: string): unknown }).rawJSON(source) : v;
  });
}

export function serializeDataApiResponse(value: unknown, native: boolean): string {
  return native ? stringifyJsonPreservingNumbers(value) : JSON.stringify(value);
}

function parseJsonPreservingNumberSources(raw: string): unknown {
  const serialization = responseSerialization.getStore();
  if (serialization) serialization.exactNumbers = true;
  return JSON.parse(raw, function (this: object, key: string, value: unknown, context?: { source?: string }) {
    if (typeof value === 'number' && context?.source !== undefined) {
      let sources = numberSources.get(this);
      if (!sources) numberSources.set(this, sources = new Map());
      sources.set(key, context.source);
    }
    return value;
  });
}

/** `limit` is a byte limit (default 10 MB), or `true` to read a native file's body with its numbers kept exact. */
export async function readJson(req: IncomingMessage, limit: boolean | number = false): Promise<Record<string, unknown>> {
  const native = limit === true;
  const body = await readBody(req, typeof limit === 'number' ? limit : 10 * 1024 * 1024);
  if (!body.length) return {};
  let parsed: unknown;
  try {
    const raw = body.toString('utf8');
    if (native) {
      assertRequestJsonBounds(raw);
      parsed = parseJsonPreservingNumberSources(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) requestSources.set(parsed, raw);
    } else parsed = parseRequestJson(raw);
  } catch (cause) {
    const error = new ApiError(960, cause instanceof JsonDepthError || cause instanceof JsonSizeError ? cause.message : 'Invalid JSON', 400);
    error.cause = cause;
    throw error;
  }
  // A request body is a JSON object; null, a number, text or an array would fail on the first property read.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError(960, 'The request body must be a JSON object', 400);
  return parsed as Record<string, unknown>;
}

/** Admin request bodies have explicit structural bounds beyond the raw 10 MB byte limit. */
export async function readBoundedJson(req: IncomingMessage, limits: { array?: number; nodes?: number; bytes?: number } = {}): Promise<Record<string, unknown>> {
  const body = await readJson(req, limits.bytes);
  const maxArray = limits.array ?? 1000, maxNodes = limits.nodes ?? 100_000;
  let nodes = 0;
  const check = (value: unknown, depth: number): void => {
    if (++nodes > maxNodes || depth > 20) throw new BoundedBodyError(960, 'Parameter is invalid: body is too complex', 400);
    if (typeof value === 'string' && value.length > 1_000_000) throw new BoundedBodyError(960, 'Parameter is invalid: body string is too long', 400);
    if (Array.isArray(value)) {
      if (value.length > maxArray) throw new BoundedBodyError(960, 'Parameter is invalid: body array is too long', 400);
      for (const item of value) check(item, depth + 1);
    } else if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length > 1000) throw new BoundedBodyError(960, 'Parameter is invalid: body has too many fields', 400);
      for (const [key, item] of entries) {
        if (key.length > 255) throw new BoundedBodyError(960, 'Parameter is invalid: body field name is too long', 400);
        check(item, depth + 1);
      }
    }
  };
  check(body, 0);
  return body;
}

/** portalData on a create or edit: an object of portal names to lists of row objects; 960 otherwise. */
function portalDataOf(v: unknown, nativeType?: (portal: string, field: string) => string | undefined, body?: object): Record<string, Record<string, string>[]> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new ApiError(960, 'Parameter is invalid: portalData must be an object of portal names and lists of rows', 400);
  for (const [portal, rows] of Object.entries(v)) {
    if (!Array.isArray(rows) || !rows.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
      throw new ApiError(960, `Parameter is invalid: portalData "${portal}" must be a list of rows`, 400);
    }
    if (nativeType) for (const row of rows as Record<string, unknown>[]) for (const [name, value] of Object.entries(row)) {
      const type = nativeType(portal, name);
      if (type === 'json' && value !== null && typeof value === 'object') {
        if (body) validateNativeJsonBody(body);
        row[name] = stringifyJsonPreservingNumbers(value);
      } else if (type === 'decimal' && typeof value === 'number') {
        const decimal = decimalNumberText(value);
        if (decimal === undefined) throw new ApiError(500, `The value of "${name}" needs a decimal string for numbers with more than 15 significant digits`, 400);
        row[name] = decimal;
      } else if (type === 'integer' && typeof value === 'number' && !Number.isSafeInteger(value)) {
        throw new ApiError(500, `The value of "${name}" is outside the safe integer range: ${jsonNumberSource(row, name) ?? String(value)}`, 400);
      }
    }
  }
  return v as Record<string, Record<string, string>[]>;
}

/** fieldData.deleteRelated: one "Portal.recordId" or a list of them; 960 for anything else. */
function deleteRelatedOf(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : [v];
  if (!list.every((x) => typeof x === 'string' || typeof x === 'number')) throw new ApiError(960, 'Parameter is invalid: deleteRelated must be text or a list of text', 400);
  return list.map(String);
}

/** The fieldData of a create or edit: an object of field names to text, numbers, booleans or nothing at all. */
function fieldDataOf(body: Record<string, unknown>, nativeType?: (name: string) => string | undefined): Record<string, string> {
  const fd = body.fieldData;
  if (fd === undefined || fd === null) return {};
  if (typeof fd !== 'object' || Array.isArray(fd)) throw new ApiError(960, 'fieldData must be an object of field names and values', 400);
  for (const [name, v] of Object.entries(fd)) {
    if (name === 'deleteRelated') continue; // a list of Table.recordId, on an edit
    if (v !== null && typeof v === 'object') {
      if (nativeType?.(name) === 'json') { validateNativeJsonBody(body); (fd as Record<string, unknown>)[name] = stringifyJsonPreservingNumbers(v); }
      else throw new ApiError(960, `The value of "${name}" in fieldData must be text or a number, not ${Array.isArray(v) ? 'a list' : 'an object'}`, 400);
    }
    if (typeof v === 'number' && nativeType?.(name) === 'decimal') {
      const decimal = decimalNumberText(v);
      if (decimal === undefined) throw new ApiError(500, `The value of "${name}" needs a decimal string for numbers with more than 15 significant digits`, 400);
      (fd as Record<string, unknown>)[name] = decimal;
    }
    if (typeof v === 'number' && nativeType?.(name) === 'integer' && !Number.isSafeInteger(v)) {
      throw new ApiError(500, `The value of "${name}" is outside the safe integer range: ${jsonNumberSource(fd, name) ?? String(v)}`, 400);
    }
  }
  return fd as Record<string, string>;
}

const MAX_UPLOAD = MAX_CONTAINER_FILE;
export const MAX_MULTIPART_BUFFER = 50 * 1024 * 1024;

/** Where streamed uploads land while arriving; its own folder can hold a lot. */
const UPLOAD_TMP = process.env.TABULARIUS_UPLOAD_TMP || tmpdir();

/**
 * A container upload, streamed to a temp file as it arrives rather than held
 * whole in the JS heap, then the single "upload" part is read back from disk.
 * So a 500 MB upload (or several at once) costs disk, not a half-gig of heap
 * per request; the cap is enforced byte-by-byte so a lying Content-Length or a
 * chunked body can't slip past it. Falls back to the in-memory parse when the
 * body isn't a plain single "upload" part.
 */
export async function multipartUploadStream(
  req: IncomingMessage, contentType: string, max: number, maxBuffered = MAX_MULTIPART_BUFFER,
): Promise<ContainerFile & { release(): void }> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!/^multipart\/form-data/i.test(contentType) || !boundary) throw new ApiError(960, 'Expected multipart/form-data', 400);
  const delim = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const tmp = join(UPLOAD_TMP, `tabularius-upload-${randomBytes(12).toString('hex')}`);
  let size = 0;
  // The file stays where it was written until the caller has put it in the field (`release`): the part is read from it
  // in pieces, never all at once.
  let keep = false;
  try {
    if (Number(req.headers['content-length']) > max) throw new ApiError(960, 'Request body too large', 413);
    const limits = multipartLimits(contentType);
    if (req.socket.destroyed) throw new Error('The request was closed before its body arrived');
    const out = await open(tmp, 'wx', 0o600);
    try {
      if (req.socket.destroyed) throw new Error('The request was closed before its body arrived');
      await eachChunk(req, async c => {
        size += c.length;
        if (size > max) throw new ApiError(960, 'Request body too large', 413);
        checkMultipart(limits, c);
        for (let at = 0; at < c.length;) {
          if (req.socket.destroyed) throw new Error('The request was closed before its body arrived');
          const { bytesWritten } = await out.write(c, at, c.length - at);
          if (req.socket.destroyed) throw new Error('The request was closed before its body arrived');
          if (!bytesWritten) throw new Error('Could not write the upload');
          at += bytesWritten;
        }
      });
    } finally { await out.close(); }
    if (req.socket.destroyed) throw new Error('The request was closed before its body arrived');
    const fd = openSync(tmp, 'r');
    try {
      const total = fstatSync(fd).size;
      const window = Math.min(64 * 1024, total);
      const head = Buffer.alloc(window);
      readSync(fd, head, 0, window, 0);
      const first = head.indexOf(delim);
      const partStart = first === -1 ? -1 : first + delim.length + 2; // skip CRLF after the delimiter
      const headerEnd = partStart === -1 ? -1 : head.indexOf('\r\n\r\n', partStart);
      const headers = headerEnd === -1 ? '' : head.subarray(partStart, headerEnd).toString('utf8');
      if (limits?.parts !== 1 || headerEnd === -1 || !/name="upload"/i.test(headers)) {
        // Not the simple single-part shape we stream (another field comes first,
        // or headers run past the window): read the whole file and parse in memory.
        if (total > maxBuffered) throw new ApiError(960, `Multi-part uploads are limited to ${maxBuffered} bytes; send one upload part for larger files`, 413);
        const whole = Buffer.alloc(total);
        readSync(fd, whole, 0, total, 0);
        return { ...multipartUpload(contentType, whole), release: () => {} };
      }
      const filename = /filename\*=UTF-8''([^;\r\n]+)/i.exec(headers)?.[1];
      const plain = /filename="([^"]*)"/i.exec(headers)?.[1];
      // The part ends at the CRLF before the closing delimiter, found from the tail.
      const tailLen = Math.min(64 * 1024, total);
      const tail = Buffer.alloc(tailLen);
      readSync(fd, tail, 0, tailLen, total - tailLen);
      const rel = tail.indexOf(Buffer.from(`\r\n${delim.toString()}--`));
      if (rel === -1) throw new ApiError(960, "Upload payload must contain a part named 'upload'.", 400);
      const contentStart = headerEnd + 4;
      const contentEnd = total - tailLen + rel;
      if (contentEnd < contentStart) throw new ApiError(10, 'Requested data is missing: empty "upload" part', 400);
      keep = true;
      return {
        filename: baseName(filename ? decodeUpload(filename) : plain || null), mime: /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1].trim() ?? 'application/octet-stream',
        path: tmp, offset: contentStart, size: contentEnd - contentStart, release: () => rmSync(tmp, { force: true }),
      };
    } finally {
      closeSync(fd);
    }
  } finally {
    if (!keep) rmSync(tmp, { force: true });
  }
}

/** An uploaded file's name without any folder in front of it, as OData keeps it (a name is only ever a name). */
function baseName(name: string | null): string | null {
  return name ? name.replace(/^[\s\S]*[\\/]/, '') || null : null;
}

/** A percent-encoded file name (filename*=UTF-8''...), 400 when the encoding is broken. */
function decodeUpload(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new ApiError(960, 'The upload\'s file name is not valid UTF-8 percent-encoding', 400);
  }
}

/** The parts of a multipart/form-data body: each one's form name, file name, type and bytes. */
export function* multipartParts(contentType: string, body: Buffer): Generator<{ name: string; filename: string | null; mime: string; data: Buffer }> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!/^multipart\/form-data/i.test(contentType) || !boundary) throw new ApiError(960, 'Expected multipart/form-data', 400);
  // Validate the entire form before yielding: a caller may stop after its first wanted part.
  checkMultipart(multipartLimits(contentType), body);
  const delim = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const between = Buffer.from(`\r\n${delim.toString()}`);
  let at = body.indexOf(delim);
  while (at !== -1) {
    const suffix = body.toString('latin1', at + delim.length, at + delim.length + 2);
    if (suffix === '--') break; // epilogue is not another part
    if (suffix !== '\r\n') { at = body.indexOf(delim, at + 1); continue; }
    const start = at + delim.length + 2; // skip CRLF after the delimiter
    let next = body.indexOf(between, start);
    while (next !== -1 && !['--', '\r\n'].includes(body.toString('latin1', next + between.length, next + between.length + 2))) {
      next = body.indexOf(between, next + 1);
    }
    if (next === -1) break;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd !== -1 && headerEnd < next) {
      const headers = body.subarray(start, headerEnd).toString('utf8');
      const filename = /filename\*=UTF-8''([^;\r\n]+)/i.exec(headers)?.[1];
      const plain = /filename="([^"]*)"/i.exec(headers)?.[1];
      yield {
        name: /\bname="([^"]*)"/i.exec(headers)?.[1] ?? '',
        filename: baseName(filename ? decodeUpload(filename) : plain || null),
        mime: /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1].trim() ?? 'application/octet-stream',
        data: body.subarray(headerEnd + 4, next), // part ends with CRLF before the delimiter
      };
    }
    at = next + 2;
  }
}

/** The "upload" part of a multipart/form-data body, as the Data API's container upload expects. */
export function multipartUpload(contentType: string, body: Buffer): { filename: string | null; mime: string; data: Buffer } {
  for (const part of multipartParts(contentType, body)) {
    if (part.name.toLowerCase() === 'upload') return { filename: part.filename, mime: part.mime, data: part.data };
  }
  throw new ApiError(960, "Upload payload must contain a part named 'upload'.", 400);
}

/** The text of a named part of a multipart/form-data body, if it has one. */
export function multipartText(contentType: string, body: Buffer, name: string): string | undefined {
  for (const part of multipartParts(contentType, body)) if (part.name === name) return part.data.toString('utf8');
  return undefined;
}

/** FileMaker's `dateformats`: 0 = US, 1 = file locale, 2 = ISO 8601; anything else is error 960. */
function dateFormat(v: unknown): DateFormat {
  const given = String(v ?? '0');
  if (!['0', '1', '2'].includes(given)) throw new ApiError(960, 'Parameter is invalid: dateformats', 400);
  return given === '2' ? 'iso' : 'us';
}

function storeDateFormat(store: Store, v: unknown): DateFormat {
  const format = dateFormat(v);
  return store.fileMode === 'native' ? 'iso' : format;
}

/**
 * How dates sent as text are read: MM/DD/YYYY, as records are given (dateformats 1, the file's own
 * order, gives them as MM/DD/YYYY too, so it is read the same way). ISO dates (2026-11-10) read as ISO.
 */
function writeDateOrder(store: Store, v: unknown): Store['dateOrder'] {
  dateFormat(v);
  return store.fileMode === 'native' ? 'ISO' : 'MDY';
}

/** A session another process of this server holds (see cluster.ts). */
export interface RemoteSession {
  id: string;
  token: string;
  db: string;
  account: string;
  idleSeconds: number;
  since: string;
  client: Session['client'];
  from?: string;
  device?: string;
  via?: string;
  externalIdentity?: Session['externalIdentity'];
  /** Its open live-update streams. */
  streams: number;
}

/** The account named in a request's Basic authorization, if any. */
function basicAccount(req: IncomingMessage): string | undefined {
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  return basic ? Buffer.from(basic, 'base64').toString('utf8').split(':')[0] || undefined : undefined;
}

/**
 * The WebAuthn relying party for a request: the rpId (the bare host, which a
 * passkey is scoped to) and the origin the browser will have signed over. Taken
 * from the request's host, honouring a reverse proxy's X-Forwarded-* headers (only from a proxy on
 * this computer, see public-origin.ts) or the public URL, so
 * a passkey registered through nginx verifies against the public host, not the
 * loopback the server actually listens on.
 */
export function webauthnEnv(req: IncomingMessage, publicUrl?: string): { rpId: string; origin: string } {
  const { proto, host } = requestOrigin(req, publicUrl);
  return { rpId: host.split(':')[0], origin: `${proto}://${host}` };
}

const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_G = /[\u0000-\u001f\u007f]/g;

/** A find is a read: it may overlap other requests on the same token (the in-flight gate is for writes). */
const FIND_ROUTE = new Set(['_find']);

/** What a client needs to carry on a container upload: where to send the next piece and how big a piece may be. */
function containerUploadView(u: { id: string; size: number; received: number }): { uploadId: string; size: number; received: number; maxPiece: number } {
  return { uploadId: u.id, size: u.size, received: u.received, maxPiece: MAX_CONTAINER_PIECE };
}

export class DataApi {
  private signInWarnings = { start: -Infinity, written: 0, dropped: 0 };

  /**
   * The Access-log line for a failed sign-in. Anyone can cause one, so a minute keeps at most 30; the rest are counted
   * and said in one line when the next minute starts.
   */
  private signInWarning(from: string, text: string): void {
    const now = performance.now();
    const w = this.signInWarnings;
    if (now - w.start >= 60_000) {
      if (w.dropped) this.host.logs?.write('Access', 'Warning', from, `${w.dropped} more failed sign-ins in the last minute were not logged one by one`);
      this.signInWarnings = { start: now, written: 0, dropped: 0 };
    }
    if (this.signInWarnings.written < 30) {
      this.signInWarnings.written++;
      this.host.logs?.write('Access', 'Warning', from, text);
    } else this.signInWarnings.dropped++;
  }

  /** The Access-log line for a sign-in on OData, the XML interface or SQL over HTTP (surface-access.ts). */
  noteSignIn(from: string, database: string, account: string, surface: string, failure?: string): void {
    noteSurfaceSignIn(this.host, from, database, account, surface, failure);
  }

  private readonly host: Host;
  private readonly sessions = new Map<string, Session>();
  /** Per-process ceiling also covers churning accounts and scoped API tokens. */
  readonly maxSessions = 2048;
  private readonly containerUploads = new ContainerUploads();
  readonly endListeners = new Set<(token: string) => void>();
  private swept = performance.now();
  /**
   * How many sessions one account may hold in one file at once; signing in again past it ends the one used least
   * recently. TABULARIUS_MAX_SESSIONS_PER_ACCOUNT sets it (default 100, 0 for no limit). Counted in this process.
   */
  maxSessionsPerAccount = (() => {
    const given = process.env.TABULARIUS_MAX_SESSIONS_PER_ACCOUNT?.trim();
    const n = given ? Number(given) : 100;
    return Number.isInteger(n) && n >= 0 ? n : 100;
  })();
  /**
   * When the server runs as several processes (cluster.ts): this one's
   * tokens start with its number, so the front process sends each request
   * back to the process holding its session; and the sessions the others
   * hold, so the admin console lists, messages and disconnects them all.
   */
  tokenPrefix = '';
  others?: () => RemoteSession[];
  endElsewhere?: (id: string) => void;
  /** When set, accounts can sign in through an LDAP/Active Directory server (see ldap.ts). */
  directory?: DirectoryAuthenticator;
  /** Directory outages are logged through the same per-minute fault cap as unexpected server faults. */
  private readonly directoryFault: FaultLog;
  /** Sign-in through an identity provider set up (oidc.ts): who it vouched for, by getoauthurl's request id and the identifier. */
  oauth?: { take(requestId: string, identifier: string): OAuthGrant | undefined };

  constructor(host: Host) {
    this.host = host;
    host.onClose.push((store) => { this.endByDb(store.name); });
    this.directoryFault = faultLog((entry) => this.host.logs?.write('Access', 'Warning', '', String(entry)));
    host.beforeFileClose?.push((store) => this.endByDb(store.name));
  }

  /** Runs one step of a container upload, turning its refusals into the Data API's. */
  private containerUploadStep<T>(step: () => T): T {
    try {
      return step();
    } catch (e) {
      if (!(e instanceof ContainerUploadError)) throw e;
      throw e.status === 429 ? new ApiError(212, e.message, 429, undefined, 5) : new ApiError(960, e.message, e.status);
    }
  }

  /** An entry exists while a non-read call owns the token; waiters are granted in arrival order. */
  private readonly inFlightWrites = new Map<string, { waiting: Array<() => void> }>();

  private async acquireWrite(token: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const active = this.inFlightWrites.get(token);
    if (!active) {
      if (this.inFlightWrites.size >= 4096) throw new ApiError(301, 'Too many active write tokens; server is busy', 503, undefined, 1);
      this.inFlightWrites.set(token, { waiting: [] });
      return;
    }
    const busy = () => new ApiError(301, 'Record is in use by another user: a request on this token is still running', 503, undefined, 1);
    if (active.waiting.length >= 16) throw busy();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        req.off('close', onRequestClose);
        res.off('close', onResponseClose);
      };
      const remove = (error: ApiError) => {
        if (settled) return;
        settled = true;
        const index = active.waiting.indexOf(grant);
        if (index !== -1) active.waiting.splice(index, 1);
        cleanup();
        reject(error);
      };
      const grant = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onResponseClose = () => remove(new ApiError(-1, 'The client disconnected while waiting', 499));
      // IncomingMessage also closes after a complete body; that alone is not a disconnect.
      const onRequestClose = () => { if (!req.complete) onResponseClose(); };
      const timer = setTimeout(() => remove(busy()), 30_000);
      active.waiting.push(grant);
      req.on('close', onRequestClose);
      res.on('close', onResponseClose);
      if (res.destroyed || req.aborted || (req.destroyed && !req.complete)) onResponseClose();
    });
  }

  private releaseWrite(token: string): void {
    const active = this.inFlightWrites.get(token);
    if (!active) return;
    const next = active.waiting.shift();
    if (next) next();
    else this.inFlightWrites.delete(token);
  }

  /** Returns false when the path is not a Data API path. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname === '/fmi/data/openapi.json') return this.openApi(req, res);
    const collector = new DenialCollector('data-api', 'request');
    return denialOperation.run(collector, () => responseSerialization.run({ exactNumbers: false }, async () => {
      try { return await this.handleOperation(req, res, url); } finally { collector.flush(); }
    }));
  }

  /** GET /fmi/data/openapi.json: the OpenAPI description, generated from the route table; nothing in it depends on a file or an account. */
  private openApi(req: IncomingMessage, res: ServerResponse): true {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      this.send(res, 405, { response: {}, messages: [{ code: '3', message: 'Command is unavailable' }] }, { allow: 'GET, HEAD' });
      return true;
    }
    const text = JSON.stringify(openApiDocument(((o) => `${o.proto}://${o.host}`)(requestOrigin(req, this.host.publicUrl))), null, 2);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=300', 'content-length': Buffer.byteLength(text) });
    res.end(req.method === 'HEAD' ? undefined : text);
    return true;
  }

  private async handleOperation(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/fmi\/data\/(vLatest|v1|v2)(\/.*)?$/.exec(url.pathname);
    if (!m) return false;
    let malformed = false;
    let parts: string[] = [];
    try { parts = (m[2] ?? '').split('/').filter(Boolean).map(decodeURIComponent); } catch { malformed = true; }
    const [section, file] = parts;
    const nativeResponse = section === 'databases' && !!file && this.host.get(file)?.fileMode === 'native';
    const started = performance.now();
    let status: number, code: number, bytes: number;
    // A call on a session marks it in use until it answers; validateSession itself doesn't count.
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? (req.headers['x-fm-data-access-token'] as string | undefined);
    const used = parts[0] !== 'validateSession' && bearer ? this.sessions.get(bearer) : undefined;
    // GET and POST _find may overlap, as the web client pages and searches concurrently.
    // Like GET (which can run scripts), _find remains exempt even with script options.
    // A piece of a big container upload (PUT) may take as long as its network does, so it does not hold up the session's other writes.
    const gated = !!bearer && req.method !== 'GET' && !(req.method === 'POST' && parts.length === 5 && FIND_ROUTE.has(parts[4]))
      && !(req.method === 'PUT' && parts[4] === 'container-uploads');
    let acquired = false;
    let markedBusy = false;
    try {
      if (gated) {
        await this.acquireWrite(bearer!, req, res);
        acquired = true;
        if (res.destroyed || req.aborted || (req.destroyed && !req.complete)) throw new ApiError(-1, 'The client disconnected', 499);
      }
      if (used) { used.busy = (used.busy ?? 0) + 1; markedBusy = true; }
      const headers: Record<string, string> = {};
      if (malformed) throw badPathError();
      const response = await this.route(req, parts, url, headers);
      denialOperation.getStore()?.flush();
      [status, code] = [200, 0];
      bytes = this.send(res, 200, { response, messages: [{ code: '0', message: 'OK' }] }, headers, nativeResponse);
    } catch (e) {
      captureDenial(e);
      denialOperation.getStore()?.flush();
      if (res.destroyed || req.aborted || (req.destroyed && !req.complete)) {
        [status, code, bytes] = [499, -1, 0];
      } else {
        const sqlite = e as { errcode?: number; code?: string } | null;
        const locked = sqlite && (sqlite.errcode === 5 || sqlite.errcode === 6 || sqlite.code === 'ERR_SQLITE_BUSY' || sqlite.code === 'ERR_SQLITE_LOCKED');
        const err = e instanceof ApiError ? e
          : e instanceof StoreError ? new ApiError(e.code, e.message, e.code === 212 ? 401 : (e.code === 812 || e.code === 301) ? 503 : (e.code === 400 || e.code === 508 || e.code === 500) ? 400 : 500, e.denial, e.code === 301 ? 1 : undefined)
          : locked ? new ApiError(301, 'Record is in use by another user', 503, undefined, 1)
          : new ApiError(-1, 'Unknown error');
        if (!(e instanceof ApiError) && !(e instanceof StoreError) && !locked) logFaultFor(this.host.get(parts[1] ?? '') ?? this.host)(e);
        [status, code] = [err.status, err.code];
        bytes = this.send(res, err.status, { response: {}, messages: [{ code: String(err.code), message: err.message }],
          ...(err.denial ? { 'tabularius:denial': explainAccessDenial(err.denial) } : {}) }, err.retryAfter ? { 'retry-after': String(err.retryAfter) } : {}, nativeResponse);
      }
    } finally {
      if (acquired) this.releaseWrite(bearer!);
      if (markedBusy && used) used.busy = Math.max(0, (used.busy ?? 1) - 1);
    }
    const logs = this.host.logs;
    if (logs) {
      // The account the call was made as: its session's, or the one signing in.
      const account = writer.getStore()?.account ?? basicAccount(req) ?? '';
      const ms = Math.round(performance.now() - started);
      logs.write('fmdapi', code ? (status >= 500 ? 'Error' : 'Warning') : 'Information', clientAddress(req),
        `${req.method} ${redactPath(url.pathname)} ${status} code ${code} ${ms} ms ${bytes} bytes${account ? ` account ${account}` : ''}`);
    }
    return true;
  }

  /** Sends a reply; returns its size. */
  private send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}, native = false): number {
    const text = serializeDataApiResponse(body, native || responseSerialization.getStore()?.exactNumbers === true);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...headers });
    res.end(text);
    return Buffer.byteLength(text);
  }

  private store(name: string): Store {
    const s = this.host.get(name);
    // A file dropped in and still converting is on its way, not missing: say so, so a deploy script can wait.
    if (!s && this.host.converted.has(name)) throw new ApiError(802, `${name} is being converted and will be hosted when that finishes; try again shortly`, 503, undefined, 5);
    if (!s) throw new ApiError(802, 'Unable to open file', 404);
    return s;
  }

  /**
   * Whether a session has timed out: past the idle limit, unless it is a scoped
   * API token (a standing credential, `ohbt_`) or it is an interactive web-client
   * session whose account is active and whose privilege set (not Full Access)
   * turns idle-disconnect off, honouring FileMaker's key-10 option. That is read
   * from the set on every check, so turning idle-disconnect back on, moving the
   * account, or disabling it ends the session at once, and such a session still
   * ends after KEEP_ALIVE_MAX_MS idle. Data API sessions keep the fixed idle
   * expiry whatever the set, as the Claris Data API guide specifies.
   */
  private timedOut(s: Session, now = performance.now()): boolean {
    if (s.token.startsWith('ohbt_')) return false;
    const idle = now - s.lastUsed;
    const limit = s.client === 'web' ? this.host.config.webSessionIdleMinutes() : this.host.config.sessionIdleMinutes();
    if (idle <= limit * 60_000) return false;
    return idle > KEEP_ALIVE_MAX_MS || !this.staysConnected(s);
  }

  private staysConnected(s: Session): boolean {
    if (s.client !== 'web') return false;
    try {
      const store = this.host.get(s.db);
      if (!store || store.accountInactive(s.account)) return false;
      const p = store.privileges(s.account, s.via);
      return !p.full && !p.idleDisconnect;
    } catch {
      return false;
    }
  }

  /** The session for a request's token (Bearer or X-FM-Data-Access-Token); throws when missing or expired. */
  authorize(req: IncomingMessage, db: string, allowPasswordChange = false): Session {
    const auth = req.headers.authorization ?? '';
    const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1] ?? (req.headers['x-fm-data-access-token'] as string | undefined);
    const isApi = token?.startsWith('ohbt_');
    // A scoped API token is a bearer credential on its own: it stands in for a
    // session on the file it is for, and doesn't idle out the way a login does.
    // It is re-checked against the file each request, so revoking it takes effect at once.
    let s = isApi && token ? this.apiSession(token, db) : token ? this.sessions.get(token) : undefined;
    // A token used on another database is refused without ending it: a mistyped name must not sign the caller out.
    const wrongDatabase = !!s && s.db.toLowerCase() !== db.toLowerCase();
    if (!s || wrongDatabase || this.timedOut(s)) {
      if (token && s && !isApi && !wrongDatabase) this.end(token, 'timed out');
      throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
    }
    // A disabled account's session ends at once, rather than at its idle timeout.
    if (!isApi && token && this.accountDisabled(token)) {
      throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
    }
    // An API token for a local-only account is honoured only from the server itself.
    if (isApi && !this.store(db).signInLocationAllowed(s.account, clientAddress(req))) {
      throw new ApiError(9, 'This account may be used only from the server itself', 403);
    }
    // All consumers (including the web client and bearer SQL/OData) must
    // honour expiry. Re-read the policy so an open session cannot outlive an
    // administrator's password-age change. Only password repair bypasses it.
    if (!allowPasswordChange && (s.mustChangePassword || this.store(db).mustChangePassword(s.account))) {
      throw new ApiError(212, 'This account must change its password before continuing; change it, then sign in again', 403);
    }
    s.lastUsed = performance.now();
    // Insertion order is the session LRU, including scoped-token sessions.
    this.sessions.delete(s.token);
    this.sessions.set(s.token, s);
    this.store(db).recordUsage(s.account, s.client);
    // Writes made for this request (and the scripts it runs) belong to the session: it may edit records it has locked.
    const w = writer.getStore();
    if (w) {
      w.owner = s.token;
      w.account = s.account;
      w.surface = s.client === 'web' ? 'web' : (w.surface ?? 'rest');
      w.globals = s.scripts;
    }
    return s;
  }

  /** Whether a session token is still live, without renewing its idle timer. Timed-out sessions and those whose accounts were turned off are ended. */
  alive(token: string): boolean {
    const s = this.sessions.get(token);
    if (!s) return false;
    if (this.timedOut(s)) {
      this.end(token, 'timed out');
      return false;
    }
    return !this.accountDisabled(token);
  }

  /**
   * Whether the session's account (or the account it came in through) has been turned off since it signed in. Its session then ends here, as the next
   * request with it would end it (authorize, and apiToken for an API token), so a live stream can stop at once too.
   */
  accountDisabled(token: string): boolean {
    const s = this.sessions.get(token);
    const store = s && this.host.get(s.db);
    if (!s) return false;
    let off = !store || !store.identityAllowed(s.account, s.via, s.viaId, s.externalIdentity?.person, s.principalId, s.personId);
    if (!off && s.signInMark !== undefined) off = s.signInMark !== store!.signInMark(s.account, s.via, s.externalIdentity?.person);
    if (!off && token.startsWith('ohbt_')) {
      try { off = !store!.apiToken(token); } catch { off = true; }
    }
    if (!off) return false;
    this.end(token, 'was signed out (account disabled)');
    return true;
  }

  /** Ends a session: its JavaScript handles and record locks are released, and it stops showing as looking at records. */
  end(token: string, why = 'signed out'): void {
    const s = this.sessions.get(token);
    this.sessions.delete(token);
    if (!s) return;
    s.scripts.close();
    for (const listener of this.endListeners) listener(token);
    if (!token.startsWith('ohbt_')) this.host.logs?.write('Access', 'Information', '', `${s.account} ${why} of ${s.db}`);
    for (const store of this.host.openStores()) {
      for (const lock of store.locks.releaseOwner(token)) store.notify('unlock', lock.table, lock.recordId, undefined, { account: lock.account, owner: token });
      for (const v of store.locks.leaveOwner(token)) store.notify('leave', v.table, v.recordId, undefined, { account: v.account, owner: token });
    }
  }

  /** Sessions held in memory, timed-out ones not yet swept included. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  private remember(session: Session): void {
    if (!this.sessions.has(session.token)) {
      while (this.sessions.size >= this.maxSessions) this.end(this.sessions.keys().next().value!, 'was signed out (server session capacity)');
    }
    this.sessions.set(session.token, session);
  }

  /**
   * Ends sessions that have timed out, at most once a minute, as new ones
   * open. Clients that sign in and never sign out would otherwise leave
   * theirs, with its globals and variables, in memory for good.
   */
  private sweep(now = performance.now()): void {
    if (now - this.swept < 60_000) return;
    this.swept = now;
    for (const s of [...this.sessions.values()]) {
      if (this.timedOut(s, now)) this.end(s.token, 'timed out');
    }
  }

  /** Sessions logged in now. `id` names a session without revealing its token (for the admin console). */
  list(): { id: string; db: string; account: string; idleSeconds: number; since: string; client: Session['client']; from?: string; device?: string; via?: string }[] {
    const now = performance.now();
    return [...this.sessions.values()]
      .filter((s) => !this.timedOut(s, now))
      .map((s) => ({ id: sessionId(s.token), db: s.db, account: s.account, idleSeconds: Math.round((now - s.lastUsed) / 1000), since: new Date(s.started).toISOString(), client: s.client, ...(s.from ? { from: s.from } : {}), ...(s.device ? { device: s.device } : {}), ...(s.via ? { via: s.via } : {}) }))
      .concat((this.others?.() ?? []).map(({ id, db, account, idleSeconds, since, client, from, device, via }) => ({ id, db, account, idleSeconds, since, client, ...(from ? { from } : {}), ...(device ? { device } : {}), ...(via ? { via } : {}) })));
  }

  /** This process's sessions, tokens included, for the leader process to list (cluster.ts). */
  own(streams: (token: string) => number): RemoteSession[] {
    const now = performance.now();
    return [...this.sessions.values()]
      .filter((s) => !this.timedOut(s, now))
      .map((s) => ({ id: sessionId(s.token), token: s.token, db: s.db, account: s.account, idleSeconds: Math.round((now - s.lastUsed) / 1000), since: new Date(s.started).toISOString(), client: s.client, ...(s.from ? { from: s.from } : {}), ...(s.device ? { device: s.device } : {}), ...(s.via ? { via: s.via } : {}), ...(s.externalIdentity ? { externalIdentity: s.externalIdentity } : {}), streams: streams(s.token) }));
  }

  /** Ends every session on a file (when it is closed); returns their tokens' list ids. */
  endByDb(db: string): string[] {
    const ended: string[] = [];
    for (const s of [...this.sessions.values()]) {
      if (s.db.toLowerCase() !== db.toLowerCase()) continue;
      ended.push(sessionId(s.token));
      this.end(s.token, 'was disconnected (file closed)');
    }
    return ended;
  }

  /** Ends a session by its list id (the admin console's Disconnect). */
  endById(id: string): boolean {
    for (const token of this.sessions.keys()) {
      if (sessionId(token) !== id) continue;
      this.end(token, 'was disconnected by the administrator');
      return true;
    }
    if (!this.others?.().some((s) => s.id === id)) return false;
    this.endElsewhere?.(id);
    return true;
  }

  /**
   * Ends every session for one account on a file (the security page's "sign
   * out everywhere", and a password change's "end all other sessions").
   * `except` keeps one token alive — the session making the change itself, so
   * changing your own password doesn't also sign you out of the request
   * that's changing it. Returns how many were ended.
   */
  endByAccount(db: string, account: string, except?: string): number {
    const wanted = account.toLowerCase();
    const matches = (s: { account: string; via?: string; externalIdentity?: { person?: string; mapping: string } }) => [
      s.account,
      s.via,
      s.externalIdentity?.person,
      s.externalIdentity?.mapping,
    ].some((name) => name !== undefined && name.toLowerCase() === wanted);
    let ended = 0;
    for (const s of [...this.sessions.values()]) {
      if (s.db.toLowerCase() !== db.toLowerCase() || !matches(s) || s.token === except) continue;
      this.end(s.token, 'was signed out by the administrator');
      ended++;
    }
    for (const o of this.others?.() ?? []) {
      if (o.db.toLowerCase() !== db.toLowerCase() || !matches(o) || o.id === (except ? sessionId(except) : undefined)) continue;
      this.endElsewhere?.(o.id);
      ended++;
    }
    return ended;
  }

  /** The session token behind a list id, so its locks can be shown against it. */
  idOf(token: string): string {
    return sessionId(token);
  }

  /** The session token for a list id (the admin console messaging one client), if it is still connected. */
  tokenById(id: string): string | undefined {
    for (const token of this.sessions.keys()) if (sessionId(token) === id) return token;
    return this.others?.().find((s) => s.id === id)?.token;
  }

  /**
   * A file by name, for the calls that need none signed in. When the server doesn't list its files, a name that isn't
   * hosted (or is still converting) is not told apart from a hosted one: the caller is refused as for a wrong password.
   */
  private async storeBeforeSignIn(req: IncomingMessage, db: string): Promise<Store> {
    if (!this.host.get(db) && !this.host.listFilesPublicly) {
      // As a hosted file's sign-in does: refused for a block on new users before anything is checked, and the password
      // checked (at its cost) only when an account is named.
      if (this.host.config.blockNewUsers()) throw new ApiError(812, 'The server isn\'t accepting new users right now; try again later', 503);
      const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      const [account, ...rest] = basic ? Buffer.from(basic, 'base64').toString('utf8').split(':') : [];
      if (account) await spendPasswordCheck(rest.join(':'));
      throw new ApiError(212, 'Invalid user account and/or password; please try again', 401);
    }
    return this.store(db);
  }

  private async login(req: IncomingMessage, db: string, body: Record<string, unknown> = {}): Promise<string> {
    dataSourceList(body.fmDataSource);
    const store = await this.storeBeforeSignIn(req, db);
    // Before the password is checked, so a refused sign-in isn't recorded as a success or a failure (open() checks again).
    this.refuseIfBlocked(store, clientAddress(req));
    const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const [account, ...rest] = basic ? Buffer.from(basic, 'base64').toString('utf8').split(':') : [];
    const from = clientAddress(req);
    const device = String(req.headers['user-agent'] ?? '') || undefined;
    const password = rest.join(':');
    const client = /^web$/i.test(String(req.headers['x-tabularius-client'] ?? '')) ? 'web' : 'rest';
    // Signed in through an identity provider, as FileMaker Server's Data API takes it (oidc.ts has the steps before).
    const requestId = req.headers['x-fm-data-oauth-request-id'];
    if (requestId !== undefined || req.headers['x-fm-data-oauth-identifier'] !== undefined) {
      return this.oauthLogin(store, String(requestId ?? ''), String(req.headers['x-fm-data-oauth-identifier'] ?? ''), body, client, from, device, String(req.headers['x-tabularius-otp'] ?? ''));
    }
    // Local and directory checks make one password attempt. Only successfully remembered
    // directory names bypass anonymous capacity; the local miss must not lock out LDAP's fifth try.
    let mapped: { via: string; person?: string } | undefined;
    const checkAlive = () => {
      if (req.socket.destroyed) throw new ApiError(-1, 'The client disconnected', 499);
    };
    const fallback = this.directory ? async () => {
      checkAlive();
      mapped = await this.directoryLogin(store, account, password, from);
      if (req.socket.destroyed) throw new ApiError(-1, 'The client disconnected', 499);
      return !!mapped;
    } : undefined;
    const checkFile = this.fileGuard(store);
    let verified = false;
    try { verified = !!account && await store.verifyAsync(account, password, from, fallback, checkAlive); }
    finally { checkFile(); }
    if (!verified) {
      if (account) store.auditSignIn(account, from, false);
      const until = account ? store.lockedOut(account, from) : undefined;
      this.signInWarning(from, `${(account ?? '').replace(CONTROL_G, ' ') || '(no account)'} could not sign in to ${store.name}: ${until ? 'locked out after too many failed sign-ins' : 'wrong account or password'}`);
      const visible = publicPasswordLockout(until, from);
      if (visible) throw lockedOutError(visible);
      throw new ApiError(212, 'Invalid user account and/or password; please try again', 401);
    }
    if (mapped) {
      const sources = await this.dataSources(store, body, from, String(req.headers['x-tabularius-otp'] ?? ''));
      if (req.socket.destroyed) throw new ApiError(-1, 'The client disconnected', 499);
      store.auditSignIn(account, from, true);
      const token = this.open(store, account, client, mapped.via, from, device, sources, { ...(mapped.person ? { person: mapped.person } : {}), mapping: mapped.via });
      store.confirmDirectorySignIn(account);
      return token;
    }
    // A second factor, when the account has one set up. A one-time code comes
    // in a header (the web client sends it) and is checked right here; error
    // 1211 asks for it without saying whether the password was right, so a
    // guesser learns nothing from it. A passkey used as the second factor
    // needs its own challenge/response round trip, so it only turns this
    // endpoint back (to .../sessions/passkey-2fa) when a second factor is
    // actually required and a passkey is the account's only confirmed one —
    // a passkey registered merely as a passwordless sign-in alternative
    // never forces anything onto the password+code path.
    this.checkSecondFactor(store, account, from, String(req.headers['x-tabularius-otp'] ?? ''));
    const sources = await this.dataSources(store, body, from, String(req.headers['x-tabularius-otp'] ?? ''));
    store.auditSignIn(account, from, true, store.hasTotp(account) ? 'two-factor' : undefined);
    const token = this.open(store, account, client, undefined, from, device, sources);
    // Account Options / password policy: the session is let in but may only
    // change its password (or log out) until an owed change is done.
    if (store.mustChangePassword(account)) this.sessions.get(token)!.mustChangePassword = true;
    return token;
  }

  /** The second-factor rules of a password sign-in to one file: the code, a passkey-only account, and the file's or account's requirement. */
  private checkSecondFactor(store: Store, account: string, from: string, code: string): void {
    const secondFactorRequired = (store.requireTotpForFullAccess() && store.privileges(account).full) || store.accountRequires2fa(account);
    if (store.hasTotp(account)) {
      if (!code) throw new ApiError(1211, 'A one-time code from your authenticator app is required', 401);
      if (!store.verifyTotp(account, code, from)) {
        store.auditSignIn(account, from, false, 'two-factor');
        this.host.logs?.write('Access', 'Warning', from, `${account} could not sign in to ${store.name}: wrong one-time code`);
        throw new ApiError(1211, 'That one-time code is not valid; check your authenticator app', 401);
      }
    } else if (secondFactorRequired && store.hasPasskey(account)) {
      throw new ApiError(PASSKEY_SECOND_FACTOR_REQUIRED, 'This account signs in with a passkey as its second factor', 401);
    }
    if (store.requireTotpForFullAccess() && !store.hasSecondFactor(account) && store.privileges(account).full) {
      store.auditSignIn(account, from, false, 'two-factor');
      this.host.logs?.write('Access', 'Warning', from, `${account} could not sign in to ${store.name}: full access requires a second factor, which this account has not set up`);
      throw new ApiError(9, 'This file requires two-factor authentication for full-access accounts; ask an administrator to set up a second factor for this account', 403);
    }
    if (store.accountRequires2fa(account) && !store.hasSecondFactor(account)) {
      store.auditSignIn(account, from, false, 'two-factor');
      this.host.logs?.write('Access', 'Warning', from, `${account} could not sign in to ${store.name}: this account requires a second factor, which it has not set up`);
      throw new ApiError(9, 'This account requires two-factor authentication; ask an administrator to set up a second factor for it', 403);
    }
  }

  /**
   * fmDataSource at log in (the guide's "Log in to an external data source"): an account and password for each other
   * hosted file whose tables the file's layouts show. Each is checked against that file now, and a wrong one fails
   * the log in, as a wrong password for the file itself does. Without it, a file is used with the same account name.
   */
  private async dataSources(store: Store, body: Record<string, unknown>, from: string, code = ''): Promise<Session['dataSources']> {
    const list = dataSourceList(body.fmDataSource);
    if (!list) return undefined;
    const out: NonNullable<Session['dataSources']> = Object.create(null);
    const seen = new Set<string>([store.name.toLowerCase()]);
    for (const { database, username, password } of list) {
      const other = this.store(database);
      const name = other.name.toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name);
      const principalId = other.accountIdentityId(username);
      if (!(await other.verifyAsync(username, password, from)) || !principalId || !other.identityAllowed(username, undefined, undefined, undefined, principalId)) {
        other.auditSignIn(username, from, false);
        this.host.logs?.write('Access', 'Warning', from, `${username} could not sign in to ${other.name} (a data source of ${store.name}): wrong account or password`);
        throw new ApiError(212, 'Invalid user account and/or password; please try again', 401);
      }
      this.checkSecondFactor(other, username, from, code);
      other.auditSignIn(username, from, true);
      out[name] = { account: username, principalId };
    }
    return Object.keys(out).length ? out : undefined;
  }

  /**
   * Logs in a Data API app with the request id and identifier a sign-in through an identity provider gave it: the
   * file's external accounts decide, as for the web client's sign-in (an account named the email, its domain, or a
   * group). The identifier is good once, whatever the outcome.
   */
  private async oauthLogin(store: Store, requestId: string, identifier: string, body: Record<string, unknown>, client: Session['client'], from: string, device?: string, code = ''): Promise<string> {
    const grant = requestId && identifier ? this.oauth?.take(requestId, identifier) : undefined;
    if (grant && !grant.email) {
      store.auditSignIn(grant.sub, from, false);
      throw new ApiError(212, 'This provider sign-in needs a trusted, verified email before it can use an account mapping', 401);
    }
    const via = grant && store.externalAccount(grant.email, grant.groups);
    // Recorded under what the provider vouched for: an address it didn't verify could be anyone's.
    const who = grant ? grant.email ?? grant.sub : '(unknown identity provider sign-in)';
    if (!grant || !via) {
      if (grant) store.auditSignIn(who, from, false);
      const unverified = grant && !grant.email && grant.claimed ? ` (said to be ${grant.claimed}, not verified)` : '';
      this.host.logs?.write('Access', 'Warning', from, `${who}${unverified} could not sign in to ${store.name} through ${grant ? grant.provider : 'an identity provider'}: ${grant ? 'no external account matches' : 'unknown, used or expired identifier'}`);
      throw new ApiError(212, 'Invalid user account and/or password; please try again', 401);
    }
    const account = grant.email ?? grant.sub;
    const sources = await this.dataSources(store, body, from, code);
    store.auditSignIn(account, from, true);
    return this.open(store, account, client, via, from, device, sources, { issuer: grant.issuer, sub: grant.sub, person: grant.email, mapping: via });
  }

  /**
   * Checks a name and password against the directory and returns the external
   * account whose privilege set applies, or undefined when the directory
   * rejects them or the file has no account for the person. verifyAsync records
   * the combined outcome and clears only this source's counter on success.
   */
  private async directoryLogin(store: Store, account: string, password: string, from: string): Promise<{ via: string; person?: string } | undefined> {
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(account)) {
      const safeAccount = account.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ');
      store.auditSignIn(safeAccount, from, false);
      this.signInWarning(from, `${safeAccount} could not sign in to ${store.name}: invalid account name`);
      throw new ApiError(212, 'Invalid user account and/or password; please try again', 401);
    }
    let who;
    try {
      who = await this.directory!(account, password);
    } catch (e) {
      // The directory's own words name its host and port, and a server's diagnostic text can echo a DN or a reason: the log gets them, the caller does not.
      this.directoryFault(`the directory could not sign ${account} in to ${store.name} from ${from}: ${e instanceof Error ? e.message : String(e)}`);
      // An outage must not reveal which shared-source names were admitted to the directory check.
      throw new ApiError(212, sharedSource(from) ? 'Invalid user account and/or password; please try again' : 'The directory could not be reached', 401);
    }
    if (!who) return undefined;
    if (!who.email) return undefined;
    if (store.canonicalAccount(who.email) && store.accountInactive(who.email)) return undefined;
    const via = store.externalAccount(who.email, who.groups);
    return via ? { via, person: who.email } : undefined;
  }

  /** A session standing in for a scoped API token, kept so its globals and locks persist; undefined when the token is invalid for this file. */
  private apiSession(token: string, db: string): Session | undefined {
    const store = this.host.get(db);
    const bound = store && store.apiToken(token);
    if (!store || !bound) {
      // Only the owning file can invalidate this cache entry; a wrong-database request must not end it.
      const existing = this.sessions.get(token);
      if (existing?.db.toLowerCase() === db.toLowerCase()) this.end(token, 'was signed out (token invalid)');
      return undefined;
    }
    if (bound.surfaces && !bound.surfaces.includes('fmrest')) throw new ApiError(9, 'This API token is not scoped for Data API access (fmrest)', 403);
    const existing = this.sessions.get(token);
    if (existing) {
      existing.lastUsed = performance.now();
      existing.readOnly = bound.readOnly;
      existing.layoutScope = bound.layouts;
      return existing;
    }
    const session: Session = { token, db: store.name, account: bound.account, started: Date.now(), lastUsed: performance.now(), scripts: new ScriptSession(), client: 'rest', readOnly: bound.readOnly, ...(bound.identity ? { via: bound.identity.mapping, externalIdentity: bound.identity } : {}), ...(bound.layouts ? { layoutScope: bound.layouts } : {}) };
    sessionPrivileges(store, session);
    this.remember(session);
    return session;
  }

  /** Blocked by an administrator (Admin API or console): sessions already open carry on, new ones wait. */
  private refuseIfBlocked(store: Store, from: string, account?: string): void {
    if (!this.host.config.blockNewUsers()) return;
    this.host.logs?.write('Access', 'Warning', from, `${account ?? 'Someone'} could not sign in to ${store.name}: the server is blocking new users`);
    throw new ApiError(812, 'The server isn\'t accepting new users right now; try again later', 503);
  }

  /** Starts a session for an account that has signed in; throws when its privilege set doesn't let this client in. */
  open(store: Store, account: string, client: Session['client'], via?: string, from = '', device?: string, dataSources?: Session['dataSources'], externalIdentity?: Session['externalIdentity']): string {
    this.assertHosted(store);
    this.sweep();
    this.refuseIfBlocked(store, from, account);
    const viaId = via ? store.externalIdentityId(via) : undefined;
    if (!store.identityAllowed(account, via, viaId, externalIdentity?.person)) throw new ApiError(212, 'This account is not active', 401);
    // A local-only account may sign in only from the server itself.
    if (!via && !store.signInLocationAllowed(account, from)) {
      this.host.logs?.write('Access', 'Warning', from, `${account} could not sign in to ${store.name}: this account may sign in only from the server itself`);
      throw new ApiError(212, 'This account may sign in only from the server itself', 401);
    }
    const token = this.tokenPrefix + randomBytes(24 - this.tokenPrefix.length / 2).toString('hex');
    const principalId = store.accountIdentityId(account);
    const personId = externalIdentity?.person ? store.accountIdentityId(externalIdentity.person) : undefined;
    const session: Session = { token, db: store.name, account, principalId, personId, started: Date.now(), lastUsed: performance.now(), scripts: new ScriptSession(), client, ...(via ? { via, viaId } : {}), ...(externalIdentity ? { externalIdentity } : {}), ...(from ? { from } : {}), ...(device ? { device: device.slice(0, 200) } : {}), ...(dataSources ? { dataSources } : {}) };
    session.signInMark = store.signInMark(account, via, externalIdentity?.person);
    session.signedInExtended = store.privileges(account, via, externalIdentity?.person).set.extendedPrivileges.map(e => e.toLowerCase());
    try {
      // The same privilege check the client-login gate makes: this throws when
      // the set lacks the client's extended privilege. (Idle-disconnect is read from
      // the set on each timeout check; see timedOut.)
      sessionPrivileges(store, session);
    } catch (e) {
      this.host.logs?.write('Access', 'Warning', from, `${account} could not sign in to ${store.name}: ${(e as Error).message}`);
      throw e;
    }
    // One account can't hold sessions without end (a script signing in again and again): past the cap, the one unused longest is ended.
    if (this.maxSessionsPerAccount > 0) {
      const name = account.toLowerCase();
      const mine = [...this.sessions.values()].filter((o) => o.db === store.name && o.account.toLowerCase() === name && !o.token.startsWith('ohbt_'));
      mine.sort((a, b) => a.lastUsed - b.lastUsed);
      for (const old of mine.slice(0, Math.max(0, mine.length - this.maxSessionsPerAccount + 1))) {
        this.host.logs?.write('Access', 'Warning', from, `${account} already had ${this.maxSessionsPerAccount} sessions open in ${store.name}: the one unused longest was ended`);
        this.end(old.token, 'was signed out (too many sessions for this account)');
      }
    }
    this.remember(session);
    this.host.logs?.write('Access', 'Information', from, `${account} signed in to ${store.name} (${client === 'web' ? 'web client' : 'Data API'}${via ? `, as ${via}` : ''})`);
    return token;
  }

  private assertHosted(store: Store): void {
    if (this.host.get(store.name) !== store) throw new ApiError(3, 'The file is no longer open for this request; retry', 409);
  }

  private fileGuard(store: Store): () => void {
    const schema = store.schemaSignature;
    const generation = this.host.fileGeneration(store);
    return () => {
      this.assertHosted(store);
      if (this.host.fileGeneration(store) !== generation || store.schemaSignature !== schema) throw new ApiError(3, 'The file changed while this request was waiting; retry', 409);
    };
  }

  /** Validate captured state after body reads and script waits, before touching SQLite or taking locks. */
  private requestGuard(req: IncomingMessage, store: Store, session: Session): (inScript?: boolean) => void {
    const checkFile = this.fileGuard(store);
    return (inScript = false) => {
      if (req.socket.destroyed || req.aborted || (req.destroyed && !req.complete)) throw new ApiError(-1, 'The client disconnected', 499);
      checkFile();
      // The script engine reports account changes as script error 212. Keep that
      // check there, while still refusing ended or expired sessions here.
      if (this.sessions.get(session.token) !== session || (inScript ? this.timedOut(session) : !this.alive(session.token))) throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
    };
  }

  /** Runs a script on a layout for a Data API session; errors become scriptError, as FileMaker Server reports them. */
  private async script(store: Store, layout: string, session: Session, script: string, parameter: string, checkCurrent: (inScript?: boolean) => void, foundSet?: number[], phase: DenialAudit['phase'] = 'script') {
    const collector = denialOperation.getStore();
    try {
      const privileges = sessionPrivileges(store, session);
      try {
        privileges.checkScript(script);
      } catch (e) {
        if (!(e instanceof PrivilegeError)) throw e;
        if (e.denial) collector?.observe(e.denial, e.code, 'script', phase);
        this.scriptFailed(store, script, session, e.code, e.message);
        return { scriptResult: '', scriptError: String(e.code),
          ...(e.denial ? { 'tabularius:denial': explainAccessDenial(e.denial) } : {}) };
      }
      const files = new Map<Store, () => void>();
      const r = await runScript(store, script, { parameter, layout, foundSet, account: session.account, session: session.scripts, ...this.host.scriptOptions(store.name), executionAccount: session.account, executionVia: session.via, privileges,
        beforeFile: (file) => {
          checkCurrent(true);
          if (!files.has(file)) files.set(file, this.fileGuard(file));
          files.get(file)!();
        },
        onAccessDenial: (denial, code) => collector?.observe(denial, code, 'script', phase) });
      if (r.error) this.scriptFailed(store, script, session, r.error);
      const denial = scriptDenial(r);
      return { scriptResult: r.result, scriptError: String(r.error),
        ...(denial ? { 'tabularius:denial': explainAccessDenial(denial) } : {}) };
    } catch (e) {
      if (e instanceof ScriptError || e instanceof StoreError || e instanceof PrivilegeError) {
        this.scriptFailed(store, script, session, e.code, e.message);
        const denial = denialOf(e);
        if (denial) collector?.observe(denial, e.code, 'script', phase);
        return { scriptResult: '', scriptError: String(e.code),
          ...(denial ? { 'tabularius:denial': explainAccessDenial(denial) } : {}) };
      }
      throw e;
    }
  }

  private scriptFailed(store: Store, script: string, session: Session, error: number, why?: string): void {
    this.host.logs?.write('ScriptEvent', 'Warning', store.name, `Data API script "${script}" (${session.account}) ended with error ${error}${why ? `, ${why}` : ''}`);
  }

  private async route(req: IncomingMessage, p: string[], url: URL, headers: Record<string, string>): Promise<unknown> {
    const method = req.method ?? 'GET';
    if (p[0] === 'productInfo' && method === 'GET') {
      return { productInfo: { name: 'tabularius', buildDate: BUILD.date, version: BUILD.version, dateFormat: 'MM/dd/yyyy', timeFormat: 'HH:mm:ss', timeStampFormat: 'MM/dd/yyyy HH:mm:ss' } };
    }
    // GET /fmi/data/{version}/validateSession: whether a token is still good.
    if (p[0] === 'validateSession' && p.length === 1 && method === 'GET') {
      const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
      const s = this.sessions.get(token);
      if (!s || !this.alive(token)) throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
      // Checking a token doesn't keep it alive, as on FileMaker Server: only calls that use it do.
      return { isSessionInUse: (s.busy ?? 0) > 0 };
    }
    if (p[0] !== 'databases') throw new ApiError(3, 'Command is unavailable', 404);
    if (p.length === 1 && method === 'GET') {
      const names = listedFiles(this.host);
      if (!names) throw new ApiError(3, 'The list of files is turned off on this server: name the file in the address', 404);
      return { databases: names.map((name) => ({ name })) };
    }
    const db = p[1];

    if (p[2] === 'sessions') {
      if (p.length === 3 && method === 'POST') {
        // The body is {} or holds fmDataSource; one that isn't JSON is let through as before.
        const body = await readJson(req, AUTH_BODY_LIMIT).catch(lenient({}));
        const token = await this.login(req, db, body);
        headers['x-fm-data-access-token'] = token;
        return this.sessions.get(token)?.mustChangePassword ? { token, passwordChangeRequired: true } : { token };
      }
      // PATCH .../sessions {oldPassword, newPassword}: change the signed-in
      // account's own password. Allowed for a must-change session (that is how
      // it clears the requirement), and FileMaker needs the new one different.
      if (p.length === 3 && method === 'PATCH') {
        const session = this.authorize(req, db, true);
        const store = this.store(db);
        sessionPrivileges(store, session);
        if (session.readOnly || session.layoutScope) throw new ApiError(9, 'This API token cannot change account credentials', 403);
        const body = await readJson(req);
        const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
        const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
        if (!newPassword) throw new ApiError(960, 'newPassword is required', 400);
        try {
          store.changePassword(session.account, oldPassword, newPassword, clientAddress(req));
        } catch (e) {
          if (e instanceof StoreError) throw new ApiError(e.code, e.message, e.code === 212 ? 401 : e.code === 812 ? 503 : 400, e.denial);
          throw e;
        }
        session.mustChangePassword = false;
        // A service token is independent of the password it was made under: it carries no sign-in mark to go stale.
        if (!session.token.startsWith('ohbt_')) session.signInMark = store.signInMark(session.account, session.via, session.externalIdentity?.person);
        // A changed password is a new secret: anyone else signed in on the old one is signed out, this request's own session kept.
        this.endByAccount(db, session.account, session.token);
        return {};
      }
      if (p.length === 4 && method === 'DELETE') {
        const session = this.sessions.get(p[3]);
        if (session && session.db.toLowerCase() !== db.toLowerCase()) throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
        this.end(p[3]);
        await drainSmallBody(req);
        return {};
      }
      // Passwordless sign-in. .../sessions/passkey (POST): with no body, issue a
      // challenge and the account's credential ids; with an assertion, verify it
      // and mint a session. .../sessions/recovery (POST): sign in with a one-time
      // recovery code. None of these needs an existing session.
      if (p[3] === 'passkey' && method === 'POST') {
        const body = await readJson(req, AUTH_BODY_LIMIT).catch(lenient({} as Record<string, unknown>));
        const env = webauthnEnv(req, this.host.publicUrl);
        // A file that isn't hosted answers as a hosted one does for an account it doesn't know (nothing to sign in to).
        if (!this.host.get(db) && !this.host.listFilesPublicly) {
          if (!body || !body.response) return decoyPasskeyStart(db, typeof body?.account === 'string' ? body.account : undefined, env.rpId);
          // As a hosted file refuses an assertion that is malformed, or whose challenge it never issued.
          const r = body.response as { credentialId?: unknown; challenge?: unknown };
          throw new ApiError(212, typeof r.credentialId !== 'string' || typeof r.challenge !== 'string' ? 'That passkey was not accepted; try again' : 'The sign-in has expired; try again', 401);
        }
        const store = this.store(db);
        if (!body || !body.response) {
          const account = typeof body?.account === 'string' ? body.account : undefined;
          const wait = store.challengeWait(clientAddress(req));
          if (wait) throw new ApiError(212, 'Too many sign-in requests; try again shortly', 429, undefined, wait);
          return { challenge: store.issueWebauthnChallenge('auth'), rpId: env.rpId,
            allowCredentials: account ? store.passkeyAllowList(account) : [] };
        }
        const r = body.response as { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string; challenge: string };
        const from = clientAddress(req);
        // Nothing to charge a bad assertion to but the address, so that has its own budget (see Store.addressLockedOut).
        const blocked = store.addressLockedOut(from);
        if (blocked) throw lockedOutError(blocked);
        let account: string;
        try {
          account = store.verifyPasskeyAssertion(r, { rpId: env.rpId, origin: env.origin, challenge: r.challenge });
        } catch (e) {
          store.countAddressFailure(from);
          throw e;
        }
        store.auditSignIn(account, from, true, 'passkey');
        const token = this.open(store, account, /^web$/i.test(String(req.headers['x-tabularius-client'] ?? '')) ? 'web' : 'rest', undefined, from, String(req.headers['user-agent'] ?? '') || undefined);
        if (store.mustChangePassword(account)) this.sessions.get(token)!.mustChangePassword = true;
        headers['x-fm-data-access-token'] = token;
        return this.sessions.get(token)?.mustChangePassword ? { token, passwordChangeRequired: true } : { token };
      }
      if (p[3] === 'recovery' && method === 'POST') {
        const body = await readJson(req, AUTH_BODY_LIMIT);
        if (!this.host.get(db) && !this.host.listFilesPublicly) {
          // A hosted file checks a code against a set of slow hashes: spend the same, so the time does not say which files exist.
          if (typeof body.account === 'string' && body.account) await spendRecoveryCodeCheck(typeof body.code === 'string' ? body.code : '');
          throw new ApiError(212, 'That recovery code is not valid', 401);
        }
        const store = this.store(db);
        const account = typeof body.account === 'string' ? body.account : '';
        const code = typeof body.code === 'string' ? body.code : '';
        const from = clientAddress(req);
        const blocked = store.addressLockedOut(from);
        if (blocked) throw lockedOutError(blocked);
        if (!account || !await store.useRecoveryCodeAsync(account, code, from)) {
          // Named failures are charged by the store before it admits a new failure key.
          if (!account) store.countAddressFailure(from);
          store.auditSignIn(account || '(no account)', from, false, 'recovery-code');
          throw new ApiError(212, 'That recovery code is not valid', 401);
        }
        store.auditSignIn(account, from, true, 'recovery-code');
        const token = this.open(store, account, /^web$/i.test(String(req.headers['x-tabularius-client'] ?? '')) ? 'web' : 'rest', undefined, from, String(req.headers['user-agent'] ?? '') || undefined);
        if (store.mustChangePassword(account)) this.sessions.get(token)!.mustChangePassword = true;
        headers['x-fm-data-access-token'] = token;
        return this.sessions.get(token)?.mustChangePassword ? { token, passwordChangeRequired: true } : { token };
      }
      // Passkey as the second factor: .../sessions/passkey-2fa (POST), with the
      // same Basic auth (account:password) as a plain sign-in — this verifies
      // the first factor, since a second factor supplements the password
      // rather than replacing it (unlike .../sessions/passkey above). With no
      // body, issues a challenge restricted to this account's own passkeys;
      // with an assertion, verifies it belongs to this account and mints a
      // session exactly like the password+one-time-code path does.
      if (p[3] === 'passkey-2fa' && method === 'POST') {
        const store = await this.storeBeforeSignIn(req, db);
        const from = clientAddress(req);
        const device = String(req.headers['user-agent'] ?? '') || undefined;
        const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
        const [account, ...rest] = basic ? Buffer.from(basic, 'base64').toString('utf8').split(':') : [];
        const password = rest.join(':');
        if (!account || !(await store.verifyAsync(account, password, from))) {
          if (account) store.auditSignIn(account, from, false);
          const until = account ? store.lockedOut(account, from) : undefined;
          const visible = publicPasswordLockout(until, from);
          if (visible) throw lockedOutError(visible);
          throw new ApiError(212, 'Invalid user account and/or password; please try again', 401);
        }
        if (!store.hasPasskey(account)) throw new ApiError(1211, 'This account has no passkey set up as a second factor', 401);
        const env = webauthnEnv(req, this.host.publicUrl);
        const body = await readJson(req, AUTH_BODY_LIMIT).catch(lenient({} as Record<string, unknown>));
        if (!body || !body.response) {
          const wait = store.challengeWait(from);
          if (wait) throw new ApiError(212, 'Too many sign-in requests; try again shortly', 429, undefined, wait);
          return { challenge: store.issueWebauthnChallenge('auth'), rpId: env.rpId, allowCredentials: store.passkeyIds(account) };
        }
        const r = body.response as { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string; challenge: string };
        try {
          store.verifyPasskeyFactor(account, r, { rpId: env.rpId, origin: env.origin, challenge: r.challenge });
        } catch (e) {
          store.countAddressFailure(from);
          store.auditSignIn(account, from, false, 'two-factor');
          if (e instanceof StoreError) throw new ApiError(e.code, e.message, 401, e.denial);
          throw e;
        }
        store.auditSignIn(account, from, true, 'two-factor');
        const client = /^web$/i.test(String(req.headers['x-tabularius-client'] ?? '')) ? 'web' : 'rest';
        const token = this.open(store, account, client, undefined, from, device);
        if (store.mustChangePassword(account)) this.sessions.get(token)!.mustChangePassword = true;
        headers['x-fm-data-access-token'] = token;
        return this.sessions.get(token)?.mustChangePassword ? { token, passwordChangeRequired: true } : { token };
      }
      throw new ApiError(3, 'Command is unavailable', 404);
    }

    // Managing your own passkeys and recovery codes (an authenticated account,
    // for itself — not a full-access-only surface).
    if (p[2] === 'passkey' || p[2] === 'recovery-codes') {
      const session = this.authorize(req, db);
      const store = this.store(db);
      sessionPrivileges(store, session);
      if (session.readOnly || session.layoutScope) throw new ApiError(9, 'This API token cannot manage account credentials', 403);
      const env = webauthnEnv(req, this.host.publicUrl);
      const self = session.account;
      if (session.via || session.externalIdentity) throw new ApiError(9, 'This session signed in through an identity provider and cannot manage local account credentials', 403);
      if (p[2] === 'recovery-codes' && p.length === 3 && method === 'POST') {
        return { codes: store.generateRecoveryCodes(self), remaining: store.recoveryCodesRemaining(self) };
      }
      if (p[2] === 'passkey' && p[3] === 'register' && p[4] === 'options' && method === 'POST') {
        const wait = store.challengeWait(clientAddress(req));
        if (wait) throw new ApiError(212, 'Too many requests; try again shortly', 429, undefined, wait);
        return { challenge: store.issueWebauthnChallenge('register', self), rpId: env.rpId,
          user: { name: self }, excludeCredentials: store.passkeyIds(self) };
      }
      if (p[2] === 'passkey' && p[3] === 'register' && p.length === 4 && method === 'POST') {
        const body = await readJson(req);
        if (!body.response || typeof body.response !== 'object' || Array.isArray(body.response)) throw new ApiError(960, 'Send {"response": {...}} from the browser\'s passkey creation', 400);
        const response = body.response as { attestationObject: string; clientDataJSON: string; challenge: string };
        for (const part of ['attestationObject', 'clientDataJSON', 'challenge'] as const) {
          if (typeof response[part] !== 'string') throw new ApiError(960, `Parameter is invalid: response.${part} must be a string`, 400);
        }
        const label = typeof body.label === 'string' ? body.label : undefined;
        try {
          return store.registerPasskey(self, response, { rpId: env.rpId, origin: env.origin, challenge: response.challenge }, label);
        } catch (e) {
          // A challenge that is unknown or has expired is the caller's to retry, not a server fault.
          if (e instanceof StoreError && e.code === 960) throw new ApiError(960, e.message, 400);
          throw e;
        }
      }
      if (p[2] === 'passkey' && p.length === 3 && method === 'GET') {
        return { passkeys: store.passkeys(self) };
      }
      if (p[2] === 'passkey' && p.length === 4 && method === 'DELETE') {
        // Only your own passkeys.
        if (!store.passkeyIds(self).includes(p[3])) throw new ApiError(9, 'Not your passkey', 403);
        return { removed: store.removePasskey(p[3]) };
      }
      throw new ApiError(3, 'Command is unavailable', 404);
    }

    const session = this.authorize(req, db);
    // A session that owes a password change can do nothing else until it does.
    if (session.mustChangePassword) throw new ApiError(212, 'This account must change its password before continuing; change it, then sign in again', 403);
    const { account } = session;
    const store = this.store(db);
    const privileges = sessionPrivileges(store, session);
    const checkCurrent = this.requestGuard(req, store, session);
    // A read-only API token may only read: no writes, and no scripts (which can write).
    if (session.readOnly) {
      const writes = method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';
      if (writes && p[4] !== '_find') throw new ApiError(9, 'This API token is read-only', 403);
      if (p[4] === 'script') throw new ApiError(9, 'This API token is read-only and cannot run scripts', 403);
    }
    // PATCH .../globals {globalFields: {"Table::Field": value}}: for this session.
    if (p[2] === 'globals' && p.length === 3 && method === 'PATCH') {
      const body = await readJson(req);
      checkCurrent();
      const fields = body.globalFields;
      if (fields === undefined || fields === null) throw new ApiError(958, 'Parameter missing (*): globalFields', 400);
      if (typeof fields !== 'object' || Array.isArray(fields)) throw new ApiError(960, 'Parameter is invalid: globalFields', 400);
      // Validate all JSON values before changing any session globals.
      const entries = Object.entries(fields).map<[string, string | number]>(([name, value]) => {
        if (typeof value !== 'string' && typeof value !== 'number') throw new ApiError(960, `Parameter is invalid: ${name}`, 400);
        return [name, value];
      });
      for (const [name, value] of entries) {
        store.setGlobalField(name, value, privileges, writeDateOrder(store, body.dateformats));
      }
      return {};
    }
    // GET .../scripts: names, in folders, as in FileMaker's Scripts menu.
    if (p[2] === 'scripts' && p.length === 3 && method === 'GET') {
      return { scripts: catalogTree(store.schema.scriptOrder, store.schema.scripts.map((x) => x.name), (n) => privileges.script(n) !== 'none', 'folderScriptNames', true) };
    }
    if (p[2] !== 'layouts') throw new ApiError(3, 'Command is unavailable', 404);
    // A layout-scoped token sees and uses only the layouts it was scoped to.
    const inScope = (name: string) => !session.layoutScope || session.layoutScope.some((l) => l.toLowerCase() === name.toLowerCase());
    if (p.length === 3 && method === 'GET') {
      const tables = new Map(store.layouts().map((l) => [l.name, l.table]));
      return { layouts: catalogTree(store.schema.layoutOrder, [...tables.keys()], (n) => inScope(n) && privileges.layout(n).layout !== 'none', 'folderLayoutNames', false, tables) };
    }
    // Only GET lists the layouts; any other method here has no layout to act on.
    if (p.length === 3) throw new ApiError(3, 'Command is unavailable', 404);
    const layout = p[3];
    // To a layout-scoped token, a layout outside its scope is as if it weren't there.
    if (!inScope(layout) || privileges.layout(layout).layout === 'none') throw new ApiError(105, `Layout "${layout}" is missing`);

    if (p.length === 4 && method === 'GET') {
      const info = store.layout(layout);
      const fieldPrivileges = privileges.in(info.owner);
      // Value lists the layout's fields use.
      const design = info.layoutId !== undefined ? store.design(info.layoutId) : undefined;
      const used = new Set<number>();
      const walk = (objs: NonNullable<typeof design>['objects']) => {
        for (const o of objs) {
          if (o.field?.valueListId) used.add(o.field.valueListId);
          if (o.children) walk(o.children);
        }
      };
      if (design) walk(design.objects);
      const shownAs = fieldDisplayTypes(design?.objects ?? [], info.occurrence);
      // What the guide's fieldMetaData shows, from the field's definition.
      const meta = (name: string, def?: Field) => fieldMetaData(name, def, shownAs.get(name.toLowerCase()) ?? 'editText');
      const fieldOf = (occurrence: string, field: string): Field | undefined => {
        try {
          const o = store.occurrence(occurrence);
          return o.owner.schema.tables.find((t) => t.name === o.table)?.fields.find((f) => f.name === field);
        } catch {
          return undefined;
        }
      };
      // A related or portal field, as the account may see it: hidden ones are left out (as their values are), and
      // a masked one reads as its stand-in text.
      const relatedMeta = (occurrence: string, field: string): Record<string, unknown>[] => {
        let access: ReturnType<Privileges['fieldAccess']> = 'none';
        try {
          const o = store.occurrence(occurrence);
          access = privileges.in(o.owner).fieldAccess(o.table, field);
        } catch {
          return [];
        }
        if (access === 'none') return [];
        const m = meta(`${occurrence}::${field}`, fieldOf(occurrence, field));
        return [access === 'masked' ? { ...m, result: 'text' } : m];
      };
      const own = info.owner.schema.tables.find((t) => t.name === info.table);
      const portalMetaData: Record<string, unknown[]> = {};
      for (const portal of info.plan?.portals ?? []) portalMetaData[portal.name] = portal.fields.flatMap((f) => relatedMeta(portal.occurrence, f));
      // Lists of related values depend on a record: with ?recordId= (read as GET .../records/{id} would), those that start
      // from the layout's table list that record's related values; without it they're left out.
      const asked = url.searchParams.get('recordId');
      let from: { info: typeof info; recordId: number } | undefined;
      if (asked !== null) {
        const id = Number(asked);
        if (!Number.isInteger(id) || id < 1) throw new ApiError(960, 'Parameter is invalid: recordId', 400);
        store.get(layout, id, 'us', undefined, privileges, { fields: [] });
        from = { info, recordId: id };
      }
      const startsHere = (relatedFromId: number) => {
        const to = store.schema.tableOccurrences.find((t) => t.id === relatedFromId);
        if (!to) return false;
        try {
          const o = store.occurrence(to.name);
          return o.owner === info.owner && o.table === info.table;
        } catch {
          return false;
        }
      };
      const valueLists = store.schema.valueLists.filter((v) => used.has(v.id) && (v.values || v.external || (v.field && (v.field.relatedFromId === undefined || (from && startsHere(v.field.relatedFromId))))) && privileges.valueList(v.name) !== 'none').map((v) => ({
        name: v.name, type: v.values ? 'customList' : 'byField',
        values: store.valueListItems(v.id, v.field?.relatedFromId !== undefined ? from : undefined, privileges).map((x) => ({ value: x.value, displayValue: x.display })),
      }));
      return {
        fieldMetaData: [
          // A masked field is listed too: its value is the stand-in text, whatever type the field has.
          ...info.fields.filter((f) => fieldPrivileges.fieldAccess(info.table, f.name) !== 'none').map((f) => {
            const m = meta(f.name, own?.fields.find((x) => x.name === f.name));
            return fieldPrivileges.fieldAccess(info.table, f.name) === 'masked' ? { ...m, result: 'text' } : m;
          }),
          ...(info.plan?.related ?? []).flatMap((r) => r.fields.flatMap((f) => relatedMeta(r.occurrence, f))),
        ],
        portalMetaData,
        ...(valueLists.length ? { valueLists } : {}),
      };
    }

    // GET .../layouts/{layout}/script/{script}
    if (p[4] === 'script' && p.length === 6 && method === 'GET') {
      const r = await this.script(store, layout, session, p[5], url.searchParams.get('script.param') ?? '', checkCurrent);
      return r;
    }

    /** Runs the request's scripts around an action, adding scriptResult/scriptError to its response. */
    const withScripts = async (args: Partial<Record<string, string>>, action: () => Record<string, unknown>, ids: (r: Record<string, unknown>) => number[]) => {
      if (session.readOnly && Object.keys(args).length) throw new ApiError(9, 'This API token is read-only and cannot run scripts', 403);
      const out: Record<string, unknown> = {};
      const phase = async (name: ScriptPhase, found?: number[]) => {
        checkCurrent();
        const key = name ? `script.${name}` : 'script';
        const script = args[key];
        if (script === undefined) return;
        const r = await this.script(store, layout, session, script, args[`${key}.param`] ?? '', checkCurrent, found, name || 'script');
        out[name ? `scriptResult.${name}` : 'scriptResult'] = r.scriptResult;
        out[name ? `scriptError.${name}` : 'scriptError'] = r.scriptError;
        if ('tabularius:denial' in r) out[name ? `tabularius:denial.${name}` : 'tabularius:denial'] = r['tabularius:denial'];
      };
      await phase('prerequest');
      await phase('presort');
      checkCurrent();
      const response = action();
      await phase('', args.script !== undefined ? ids(response) : undefined);
      return { ...response, ...out };
    };

    /** A record as the guide shows it: with only the portals asked for, and portalDataInfo for them. */
    const portalsAsked = (v: unknown): string[] | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      const invalid = () => new ApiError(960, 'Parameter is invalid: portal', 400);
      if (Array.isArray(v)) return v.map(String);
      const text = String(v);
      try {
        const parsed = parseRequestJson(text, MAX_JSON_QUERY_BYTES);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch (e) {
        if (e instanceof JsonDepthError || e instanceof JsonSizeError) throw invalid();
        // portal=Contact,History or portal=[Contact,History]
      }
      return text.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
    };
    const nativeMaps = new Map<string, Map<string, string>>();
    const occurrenceTypes = (occurrence: string): Map<string, string> => {
      let types = nativeMaps.get(occurrence.toLowerCase());
      if (!types) {
        try {
          const info = store.occurrence(occurrence);
          types = info.owner.fileMode === 'native' ? new Map(info.fields.map((f) => [f.name.toLowerCase(), f.type])) : new Map();
        } catch { types = new Map(); } // The store reports an unknown related occurrence.
        nativeMaps.set(occurrence.toLowerCase(), types);
      }
      return types;
    };
    const nativeFieldType = (name: string, on = layout): string | undefined => {
      const split = name.lastIndexOf('::');
      if (split >= 0) return occurrenceTypes(name.slice(0, split)).get(name.slice(split + 2).toLowerCase());
      return occurrenceTypes(store.layout(on).occurrence).get(name.toLowerCase());
    };
    const nativePortalType = (portal: string, name: string): string | undefined => {
      const plan = store.layout(layout).plan?.portals.find((p) => p.name.toLowerCase() === portal.toLowerCase() || p.occurrence.toLowerCase() === portal.toLowerCase());
      return plan ? nativeFieldType(name.includes('::') ? name : `${plan.occurrence}::${name}`) : undefined;
    };
    const nativeBody = store.fileMode === 'native' || (store.layout(layout).plan?.portals ?? []).some((p) => occurrenceTypes(p.occurrence).size > 0)
      || store.layout(layout).fields.some((f) => f.name.includes('::') && nativeFieldType(f.name) !== undefined);
    const needsNativeShape = new Map<string, boolean>();
    const recordOut = (r: StoredRecord, asked?: string[], on = layout) => {
      const out = recordJson(r);
      const nativeShape = (value: string | number, type: string | undefined): unknown => {
        if (['boolean', 'integer', 'decimal', 'json', 'uuid'].includes(type ?? '') && value === '') return null;
        if (type === 'boolean') return value === 1 || value === '1' ? true : value === 0 || value === '0' ? false : value;
        if (type === 'json') {
          try {
            const raw = String(value);
            const parsed = parseJsonPreservingNumberSources(raw);
            return typeof parsed === 'number' ? (JSON as typeof JSON & { rawJSON(text: string): unknown }).rawJSON(raw) : parsed;
          } catch { return value; } // A privilege mask is display text.
        }
        return value;
      };
      let shape = needsNativeShape.get(on);
      if (shape === undefined) {
        shape = store.fileMode === 'native' || Object.keys(out.fieldData).some((name) => name.includes('::') && nativeFieldType(name, on) !== undefined);
        needsNativeShape.set(on, shape);
      }
      if (shape) {
        const shaped: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(out.fieldData)) {
          const type = nativeFieldType(name, on);
          shaped[name] = type ? nativeShape(value, type) : value;
        }
        (out as { fieldData: Record<string, unknown> }).fieldData = shaped;
      }
      const portals = store.layout(on).plan?.portals ?? [];
      if (!portals.length) return out;
      const wanted = asked && new Set(asked.map((x) => x.toLowerCase()));
      const keep = portals.filter((x) => !wanted || wanted.has(x.name.toLowerCase()) || wanted.has(x.occurrence.toLowerCase()));
      const counts = store.portalCounts(on, r.recordId, privileges, r);
      out.portalData = Object.fromEntries(keep.filter((x) => x.name in out.portalData).map((x) => [x.name, out.portalData[x.name]]));
      const portalData = Object.fromEntries(keep.filter((x) => x.name in out.portalData).map((x) => {
        const types = occurrenceTypes(x.occurrence);
        return [x.name, types.size ? out.portalData[x.name].map((row) => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, nativeShape(value, types.get(name.split('::').pop()!.toLowerCase()))]))) : out.portalData[x.name]];
      }));
      return {
        ...out,
        portalData,
        portalDataInfo: keep.filter((x) => x.name in out.portalData).map((x) => ({
          portalObjectName: x.name, database: store.name, table: x.occurrence,
          foundCount: counts[x.name] ?? out.portalData[x.name].length, returnedCount: out.portalData[x.name].length,
        })),
      };
    };

    const dataInfo = (found: number, total: number, returned: number, on = layout) => ({
      database: store.name, layout: on, table: store.layout(on).occurrence,
      totalRecordCount: total, foundCount: found, returnedCount: returned,
    });

    /**
     * layout.response: the layout the records are answered with, while the request's layout does the finding
     * and sorting. It must show the same table, so the found records are records it can show.
     */
    const responseLayout = (v: unknown): string => {
      if (v === undefined || v === null || v === '') return layout;
      const name = String(v);
      if (!inScope(name) || privileges.layout(name).layout === 'none') throw new ApiError(105, `Layout "${name}" is missing`);
      const shown = store.layout(name);
      const asked = store.layout(layout);
      if (shown.owner !== asked.owner || shown.table !== asked.table) throw new ApiError(960, 'Parameter is invalid: layout.response', 400);
      return shown.name;
    };
    /** The found records as the response layout shows them. */
    const shownAs = (records: StoredRecord[], on: string, format: DateFormat, portals: PortalPaging | undefined) =>
      on === layout ? records : records.map((x) => store.get(on, x.recordId, format, portals, privileges, { layoutOnly: true }));

    if (p[4] === 'records') {
      if (p.length === 5 && method === 'GET') {
        const q = url.searchParams;
        const sort = sortParam(q.get('_sort') ?? undefined, '_sort');
        const offset = countParam(q.get('_offset') ?? undefined, '_offset', 1);
        const limit = countParam(q.get('_limit') ?? undefined, '_limit', 100);
        const shown = responseLayout(q.get('layout.response'));
        return withScripts(scriptArgs(q), () => {
          const format = storeDateFormat(store, q.get('dateformats'));
          const portals = portalPaging((k) => q.get(k), q.keys());
          const r = store.find(layout, { offset, limit, sort, dateFormat: format, portals, privileges, layoutOnly: true });
          const records = shownAs(r.records, shown, format, portals);
          store.logRead(store.layout(layout).table, records.map((x) => x.recordId), { account, privileges });
          return { dataInfo: dataInfo(r.foundCount, r.totalCount, records.length, shown), data: records.map((x) => recordOut(x, portalsAsked(q.get('portal')), shown)) };
        }, () => store.findIds(layout, { sort, privileges }));
      }
      if (p.length === 5 && method === 'POST') {
        const body = await readJson(req, nativeBody);
        checkCurrent();
        const entry = entryOptions(body);
        const portalData = portalDataOf(body.portalData, nativePortalType, body);
        return withScripts(scriptArgs(body), () => {
          // Tabularius's web client names the record the window was on, for "value from last visited record".
          const lastVisited = Number((body.options as { lastVisited?: unknown } | undefined)?.lastVisited);
          // And makes a new record as FileMaker's New Record does: not committed yet, so the fields that must have a
          // value are checked when it is committed (options.firstCommit on an edit), not while it is still empty.
          const uncommitted = (body.options as { uncommitted?: unknown } | undefined)?.uncommitted === true;
          const create = () => store.create(layout, fieldDataOf(body, (name) => nativeFieldType(name)), { account, privileges, ...entry, dateOrder: writeDateOrder(store, body.dateformats), ...(Number.isInteger(lastVisited) && lastVisited > 0 ? { lastVisited } : {}), ...(uncommitted ? { requiredAtCommit: true } : {}) });
          // portalData: related records made with it, as the guide's Create a record allows. The record and its
          // related records are made together or not at all, so a refused portal row leaves no record behind.
          if (Object.keys(portalData).length) {
            // A new record has no related records yet: each row makes one, so none may name an existing one.
            for (const rows of Object.values(portalData)) {
              if (!rows.every((row) => row.recordId === undefined)) {
                throw new ApiError(960, 'Parameter is invalid: portalData', 400);
              }
            }
            // Adding related records leaves the new record's own modId as it is.
            const r = atomically(() => {
              const made = create();
              store.updatePortals(layout, made.recordId, portalData, [], { account, privileges, justCreated: true, ...entry, dateOrder: writeDateOrder(store, body.dateformats) });
              return made;
            });
            return { ...(r.id ? { id: r.id } : {}), recordId: String(r.recordId), modId: String(r.modId) };
          }
          const r = create();
          return { ...(r.id ? { id: r.id } : {}), recordId: String(r.recordId), modId: String(r.modId) };
        }, (r) => [Number(r.recordId)]);
      }
      const id = Number(p[5]);
      if (p.length === 6 && Number.isInteger(id)) {
        if (method === 'GET') {
          const q = url.searchParams;
          const shown = responseLayout(q.get('layout.response'));
          return withScripts(scriptArgs(q), () => {
            const r = store.get(shown, id, storeDateFormat(store, q.get('dateformats')), portalPaging((k) => q.get(k), q.keys()), privileges, { layoutOnly: true });
            store.logRead(store.layout(layout).table, [id], { account, privileges });
            return { dataInfo: dataInfo(1, store.find(shown, { limit: 0, privileges }).totalCount, 1, shown), data: [recordOut(r, portalsAsked(q.get('portal')), shown)] };
          }, () => [id]);
        }
        if (method === 'PATCH') {
          const body = await readJson(req, nativeBody);
          checkCurrent();
          const modId = body.modId === undefined ? undefined : Number(body.modId);
          const fieldData = { ...fieldDataOf(body, (name) => nativeFieldType(name)) };
          const del = fieldData.deleteRelated;
          delete fieldData.deleteRelated;
          const portalData = portalDataOf(body.portalData, nativePortalType, body);
          const deleteRelated = deleteRelatedOf(del);
          // Checked before anything is written.
          const styles = body.styles === undefined ? undefined : textFormatting(body.styles, fieldData);
          const portalStyles = body.portalStyles === undefined ? undefined : portalFormatting(body.portalStyles, portalData);
          const entry = entryOptions(body);
          const portals = Object.keys(portalData).length > 0 || deleteRelated.length > 0;
          // With portal rows to change, all of it or none (a later failure doesn't leave rows deleted).
          return withScripts(scriptArgs(body), () => (portals ? atomically : <T>(fn: () => T) => fn())(() => {
            if (portals) {
              // The record must be one the account can see, and unchanged since modId, before any portal row is touched.
              const current = store.get(layout, id, 'us', undefined, privileges, { fields: [] });
              if (modId !== undefined && current.modId !== modId) throw new StoreError(306, 'Record modification ID does not match');
            }
            const made = Object.keys(portalData).length || deleteRelated.length ? store.updatePortals(layout, id, portalData, deleteRelated, { account, privileges, ...entry, dateOrder: writeDateOrder(store, body.dateformats) }, portalStyles) : [];
            // The related records portal rows created, as FileMaker's Data API reports them.
            const created = made.length ? { newPortalRecordInfo: made.map((m) => ({ tableName: m.portal, ...(m.id ? { id: m.id } : {}), recordId: String(m.recordId), modId: String(m.modId) })) } : {};
            // Tabularius's web client committing a record made with options.uncommitted: its validation, required fields included.
            const firstCommit = (body.options as { firstCommit?: unknown } | undefined)?.firstCommit === true;
            if (!Object.keys(fieldData).length && !firstCommit) return { modId: String(store.get(layout, id, 'us', undefined, privileges, { fields: [] }).modId), ...created };
            return { modId: String(store.update(layout, id, fieldData, modId, { account, privileges, ...entry, dateOrder: writeDateOrder(store, body.dateformats), ...(styles ? { styles } : {}), ...(firstCommit ? { firstCommit: true } : {}) }).modId), ...created };
          }), () => [id]);
        }
        // POST .../records/{id}: duplicate it.
        if (method === 'POST') {
          const body = await readJson(req);
          checkCurrent();
          return withScripts(scriptArgs(body), () => {
            const r = store.duplicate(layout, id, { account, privileges });
            return { ...(r.id ? { id: r.id } : {}), recordId: String(r.recordId), modId: String(r.modId) };
          }, (r) => [Number(r.recordId)]);
        }
        if (method === 'DELETE') {
          return withScripts(scriptArgs(url.searchParams), () => {
            store.delete(layout, id, { privileges });
            return {};
          }, () => []);
        }
      }
    }

    // A portal row's container (beyond FileMaker's Data API): ?portal=<portal name>&portalRecordId=<the row's recordId>.
    const portalRow = (q: URLSearchParams) => {
      const name = q.get('portal');
      const id = q.get('portalRecordId');
      if (name === null && id === null) return undefined;
      // One without the other is a mistake (a mistyped name), never a write to the record's own field of that name.
      if (!name || id === null || !/^\d+$/.test(id) || Number(id) < 1) throw new ApiError(960, 'portal and portalRecordId must name a portal and a row of it', 400);
      return { name, recordId: Number(id) };
    };

    // POST .../records/{id}/containers/{field}[/{repetition}]  (multipart, part "upload")
    if (p[4] === 'records' && p[6] === 'containers' && (p.length === 8 || p.length === 9) && method === 'POST') {
      // Turn away an oversize upload on its declared length, before a byte is read.
      if (Number(req.headers['content-length']) > MAX_UPLOAD) throw new ApiError(960, 'Request body too large', 413);
      const rep = p.length === 9 ? Number(p[8]) : 1;
      if (!Number.isInteger(rep) || rep < 1) throw new ApiError(960, 'Invalid repetition', 400);
      const portal = portalRow(url.searchParams);
      // Whether this account may put a file there is settled before a byte of the body is read: a sign-in without the
      // privilege must not be able to make the server take in a gigabyte.
      if (portal) store.checkPortalContainerWrite(layout, Number(p[5]), portal.name, portal.recordId, p[7], rep, { privileges });
      else store.checkContainerWrite(layout, Number(p[5]), p[7], rep, { privileges });
      const upload = await multipartUploadStream(req, req.headers['content-type'] ?? '', MAX_UPLOAD);
      try {
        checkCurrent();
        const expected = url.searchParams.get('modId');
        if (expected !== null && Number(expected) !== store.get(layout, Number(p[5]), 'iso', undefined, privileges, { fields: [] }).modId) {
          throw new ApiError(306, 'Record modification ID does not match');
        }
        if (portal) store.setPortalContainer(layout, Number(p[5]), portal.name, portal.recordId, p[7], rep, upload, { privileges });
        else store.setContainer(layout, Number(p[5]), p[7], rep, upload, { privileges });
      } finally {
        upload.release();
      }
      return {};
    }

    // Beyond FileMaker's Data API: a big file in pieces that can be picked up again (container-uploads.ts).
    //   POST .../records/{id}/container-uploads/{field}[/{repetition}]  {filename, mime, size, sha256?, modId?}  starts one
    if (p[4] === 'records' && p[6] === 'container-uploads' && (p.length === 8 || p.length === 9) && method === 'POST') {
      const rep = p.length === 9 ? Number(p[8]) : 1;
      if (!Number.isInteger(rep) || rep < 1) throw new ApiError(960, 'Invalid repetition', 400);
      const portal = portalRow(url.searchParams);
      // As for a single request: whether this account may put a file there is settled before any of it is taken in.
      if (portal) store.checkPortalContainerWrite(layout, Number(p[5]), portal.name, portal.recordId, p[7], rep, { privileges });
      else store.checkContainerWrite(layout, Number(p[5]), p[7], rep, { privileges });
      const body = await readJson(req);
      checkCurrent();
      const modId = body.modId ?? url.searchParams.get('modId') ?? undefined;
      // A record that has already changed would refuse the finished file; say so before the file is sent.
      if (modId !== undefined && Number(modId) !== store.get(layout, Number(p[5]), 'iso', undefined, privileges, { fields: [] }).modId) {
        throw new ApiError(306, 'Record modification ID does not match');
      }
      const started = this.containerUploadStep(() => this.containerUploads.start({ db: store.name, account },
        { layout, recordId: Number(p[5]), field: p[7], repetition: rep, ...(portal ? { portal } : {}), ...(modId === undefined ? {} : { modId: String(modId) }) }, body));
      try {
        checkCurrent();
      } catch (e) {
        this.containerUploadStep(() => this.containerUploads.cancel(started.id, { db: store.name, account }, layout));
        throw e;
      }
      return containerUploadView(started);
    }
    if (p[4] === 'container-uploads' && p.length >= 6 && p.length <= 7 && (p.length === 6 ? ['GET', 'PUT', 'DELETE'].includes(method) : p[6] === 'finish' && method === 'POST')) {
      const who = { db: store.name, account };
      const step = <T>(f: () => T): T => this.containerUploadStep(f);
      if (p.length === 7) {
        const { upload, file } = step(() => this.containerUploads.complete(p[5], who, layout));
        try {
          const target = { privileges };
          if (upload.modId !== undefined && Number(upload.modId) !== store.get(layout, upload.recordId, 'iso', undefined, privileges, { fields: [] }).modId) {
            throw new ApiError(306, 'Record modification ID does not match');
          }
          if (upload.portal) store.setPortalContainer(layout, upload.recordId, upload.portal.name, upload.portal.recordId, upload.field, upload.repetition, file, target);
          else store.setContainer(layout, upload.recordId, upload.field, upload.repetition, file, target);
        } catch (e) {
          // The record only moves on, so an upload started against an older modId can never be put in: forget it.
          if (e instanceof ApiError && e.code === 306) this.containerUploads.done(p[5]);
          else this.containerUploads.reopen(p[5]);
          throw e;
        }
        this.containerUploads.done(p[5]);
        return {};
      }
      if (method === 'GET') return containerUploadView(step(() => this.containerUploads.get(p[5], who, layout)));
      if (method === 'DELETE') {
        step(() => this.containerUploads.cancel(p[5], who, layout));
        return {};
      }
      // PUT ...?offset=N: the next piece, raw bytes. It must start where the last one ended.
      const given = url.searchParams.get('offset');
      if (given === null || !/^\d+$/.test(given)) throw new ApiError(960, 'Say where this piece starts: ?offset=N, the bytes that have arrived', 400);
      const length = req.headers['content-length'] === undefined ? undefined : Number(req.headers['content-length']);
      const piece = step(() => this.containerUploads.beginPiece(p[5], who, layout, Number(given), length));
      try {
        await eachChunk(req, (chunk) => step(() => piece.append(chunk)));
      } finally {
        piece.end();
      }
      return containerUploadView(step(() => this.containerUploads.get(p[5], who, layout)));
    }

    // DELETE .../records/{id}/containers/{field}[/{repetition}]: empties the container (beyond FileMaker's Data API).
    if (p[4] === 'records' && p[6] === 'containers' && (p.length === 8 || p.length === 9) && method === 'DELETE') {
      const rep = p.length === 9 ? Number(p[8]) : 1;
      if (!Number.isInteger(rep) || rep < 1) throw new ApiError(960, 'Invalid repetition', 400);
      const expected = url.searchParams.get('modId');
      if (expected !== null && Number(expected) !== store.get(layout, Number(p[5]), 'iso', undefined, privileges, { fields: [] }).modId) {
        throw new ApiError(306, 'Record modification ID does not match');
      }
      const portal = portalRow(url.searchParams);
      if (portal) store.setPortalContainer(layout, Number(p[5]), portal.name, portal.recordId, p[7], rep, null, { privileges });
      else store.setContainer(layout, Number(p[5]), p[7], rep, null, { privileges });
      return {};
    }

    if (p[4] === '_find' && p.length === 5 && method === 'POST') {
      const body = await readJson(req);
      checkCurrent();
      if (!Array.isArray(body.query) || !body.query.length) throw new ApiError(10, 'Requested data is missing', 400);
      if (body.query.some((r: unknown) => r === null || typeof r !== 'object' || Array.isArray(r))) throw new ApiError(960, 'Each find request in query must be an object of field names and criteria', 400);
      // A criterion is text, a number, a boolean or empty: not a list or an object.
      for (const r of body.query as Record<string, unknown>[]) {
        for (const [field, crit] of Object.entries(r)) {
          if (crit !== null && typeof crit === 'object') throw new ApiError(960, `The criterion for "${field}" must be text or a number, not ${Array.isArray(crit) ? 'a list' : 'an object'}`, 400);
        }
      }
      const opts: FindOptions = {
        query: body.query as FindOptions['query'],
        sort: sortParam(body.sort, 'sort'),
        offset: countParam(body.offset, 'offset', 1),
        limit: countParam(body.limit, 'limit', 100),
        dateFormat: storeDateFormat(store, body.dateformats),
        dateOrder: writeDateOrder(store, body.dateformats),
        portals: portalPaging((k) => body[k], Object.keys(body)),
        privileges,
        layoutOnly: true,
      };
      const shown = responseLayout(body['layout.response']);
      return withScripts(scriptArgs(body), () => {
        const r = store.find(layout, opts);
        if (r.foundCount === 0) throw new ApiError(401, 'No records match the request');
        const records = shownAs(r.records, shown, opts.dateFormat!, opts.portals);
        store.logRead(store.layout(layout).table, records.map((x) => x.recordId), { account, privileges });
        return { dataInfo: dataInfo(r.foundCount, r.totalCount, records.length, shown), data: records.map((x) => recordOut(x, portalsAsked(body.portal), shown)) };
      }, () => store.findIds(layout, { query: opts.query, sort: opts.sort, privileges, dateOrder: opts.dateOrder }));
    }

    throw new ApiError(3, 'Command is unavailable', 404);
  }
}
