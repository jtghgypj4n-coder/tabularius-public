import { clientAddress } from './client-address.ts';
// Read-only SQL over hosted files, for reports, spreadsheets and BI tools:
// Tabularius's counterpart of FileMaker Server's ODBC/JDBC access.
//
//   POST /tabularius/sql/v1/databases/{db}          {"sql": "SELECT ...", "params": [...], "limit": 10000}
//   GET  /tabularius/sql/v1/databases/{db}?q=SELECT...&format=csv&limit=10000
//   GET  /tabularius/sql/v1/databases/{db}/tables   table occurrences and their columns
//
// Queries are FileMaker SQL, as in ExecuteSQL and over ODBC: tables are
// table occurrences, FETCH FIRST n ROWS ONLY works, and FileMaker_Tables /
// FileMaker_Fields describe the file. Underneath it is SQLite, so its
// functions work too. Only SELECT runs, on a read-only connection.
//
// Sign in with the account's name and password (HTTP Basic, which
// spreadsheet "from web" imports support) or a Data API session token
// (Bearer). The account's privilege set needs the fmxdbc extended privilege
// (FileMaker's "Access via ODBC/JDBC"), and since SQL reads rows directly,
// it must be able to view every record and field of every table.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { FAULT_MESSAGE, isFault, logFault } from './fault-log.ts';
import { refreshAuthCache } from './auth-cache.ts';
import { createHash } from 'node:crypto';
import { StoreError, occurrence, type Privileges, type Store } from '../../store/src/index.ts';
import type { SqlValue } from '../../store/src/find.ts';
import { ApiError, lockedOutError, readJson, sessionPrivileges, type DataApi } from './dataapi.ts';
import type { Host } from './host.ts';
import { refuseUnknownFile } from './file-list.ts';
import { narrowPrivileges, type TokenScope } from './token-scope.ts';
import { csvField } from '../../store/src/index.ts';
import { passwordLoginSecondFactor, publicPasswordLockout } from './password-login-policy.ts';

const DEFAULT_LIMIT = 10_000;
const MAX_LIMIT = 1_000_000;
/** Checked Basic credentials, so a report polling every minute doesn't re-hash its password each time. */
const VERIFIED_MS = 60_000;

/** Values as JSON can carry them: container bytes as base64, big integers as numbers. */
function plain(v: SqlValue): string | number | null {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return Buffer.from(v as Uint8Array).toString('base64');
}

function csvCell(v: SqlValue): string {
  const s = v === null ? '' : String(plain(v));
  return csvField(s, { quoteWhitespace: true });
}

export class SqlEndpoint {
  private readonly host: Host;
  private readonly api: DataApi;
  private readonly verified = new Map<string, number>();

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  /** Returns false when the request is not for the SQL endpoint. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/sql\/v1\/databases\/([^/]+)(\/tables)?\/?$/.exec(url.pathname);
    if (!m) return false;
    const json = (status: number, body: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(JSON.stringify(body));
    // A fault before the caller is signed in says nothing of its cause; after, the query's own error (a syntax error, a missing table) is the answer.
    let signedIn = false;
    try {
      const db = decodeURIComponent(m[1]);
      const store = this.host.get(db);
      if (!store) {
        await refuseUnknownFile(this.host, req);
        throw new ApiError(802, `Unable to open file "${db}"`, 404);
      }
      const p = await this.signIn(req, store);
      signedIn = true;
      if (m[2]) {
        if (req.method !== 'GET') throw new ApiError(3, 'Command is unavailable', 405);
        this.checkReadsEverything(p, store);
        json(200, { tables: this.tables(store, p) });
        return true;
      }
      let sql: unknown, params: unknown = [], limit: unknown, format: string;
      if (req.method === 'GET') {
        sql = url.searchParams.get('q') ?? url.searchParams.get('sql');
        limit = url.searchParams.get('limit') ?? undefined;
        format = url.searchParams.get('format') ?? 'json';
      } else if (req.method === 'POST') {
        const body = await readJson(req);
        ({ sql, params = [], limit } = body);
        format = String(body.format ?? url.searchParams.get('format') ?? 'json');
      } else throw new ApiError(3, 'Command is unavailable', 405);
      if (typeof sql !== 'string' || !sql.trim()) throw new ApiError(10, 'Requested data is missing: the query (sql)', 400);
      if (!Array.isArray(params) || params.some((v) => v !== null && !['string', 'number'].includes(typeof v))) {
        throw new ApiError(960, 'params must be a list of strings, numbers or nulls', 400);
      }
      const max = limit === undefined ? DEFAULT_LIMIT : Number(limit);
      if (!Number.isInteger(max) || max < 1 || max > MAX_LIMIT) throw new ApiError(960, `limit must be 1 to ${MAX_LIMIT}`, 400);
      if (format !== 'json' && format !== 'csv') throw new ApiError(960, 'format must be json or csv', 400);

      const { sql: text, target } = store.calc.translateSQL(sql, p);
      this.checkReadsEverything(p.in(target), target);
      if (format === 'csv' && (!p.canExport || !p.in(target).canExport)) {
        throw new ApiError(9, 'Insufficient privileges: this account may not export records', 403);
      }
      const r = target.select(text, params as SqlValue[], max + 1);
      const truncated = r.rows.length > max;
      if (truncated) r.rows.pop();
      target.logQuery(text, r.rows.length, { privileges: p, account: p.account });
      if (format === 'csv') {
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          ...(truncated ? { 'x-tabularius-truncated': String(max) } : {}),
        });
        res.end([r.names.map(csvCell).join(','), ...r.rows.map((row) => row.map(csvCell).join(','))].join('\r\n') + '\r\n');
      } else {
        json(200, {
          columns: r.names.map((name, i) => ({ name, type: r.types[i] })),
          rows: r.rows.map((row) => row.map(plain)),
          rowCount: r.rows.length,
          truncated,
        });
      }
    } catch (e) {
      // A fault of the server's own (not a SQLite error about the caller's SQL) goes to the log; the caller gets a plain answer.
      const fault = !(e instanceof ApiError) && !(e instanceof StoreError) && !(e instanceof URIError) && isFault(e, { sql: true });
      if (fault) logFault(e);
      const err = e instanceof ApiError ? e : e instanceof StoreError ? new ApiError(e.code, e.message, e.code === 212 ? 401 : 400)
        : fault ? new ApiError(-1, FAULT_MESSAGE, 500)
        : signedIn ? new ApiError(8310, (e as Error).message, 400) : new ApiError(8310, 'The request could not be read', 400);
      if (res.headersSent) res.end();
      else {
        res.writeHead(err.status, {
          'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          ...(err.status === 401 ? { 'www-authenticate': 'Basic realm="tabularius SQL", charset="UTF-8"' } : {}),
          ...(err.retryAfter ? { 'retry-after': String(err.retryAfter) } : {}),
        }).end(JSON.stringify({ error: { code: err.code, message: err.message } }));
      }
    }
    return true;
  }

  private async signIn(req: IncomingMessage, store: Store): Promise<Privileges> {
    return (await signIn(req, store, this.api, this.verified, 'fmxdbc', 'SQL access, like ODBC/JDBC')).privileges;
  }

  private checkReadsEverything(p: Privileges, store: Store): void {
    if (!p.readsEverything) {
      throw new ApiError(9, `Insufficient privileges: SQL reads every record, and the "${p.name}" privilege set can't view every record and field in ${store.name}`, 401);
    }
  }

  /** Table occurrences as SQL sees them, with their columns (unstored calculations and summaries have none). */
  private tables(store: Store, p: Privileges) {
    const out: { name: string; baseTable: string; file: string; columns: { name: string; type: string }[] }[] = [];
    for (const to of store.schema.tableOccurrences) {
      const occ = occurrence(store, to.id);
      if (!occ || !p.in(occ.store).readsEverything) continue;
      const stored = new Set((occ.store.sql.prepare(`PRAGMA table_info(${JSON.stringify(occ.table.name)})`).all() as { name: string }[]).map((c) => c.name));
      out.push({
        name: to.name, baseTable: occ.table.name, file: occ.store.name,
        columns: occ.table.fields.filter((f) => stored.has(f.name)).map((f) => ({ name: f.name, type: f.type })),
      });
    }
    return out;
  }
}

/**
 * The account's privileges in the file, from a scoped API token, a Data API
 * session token, or a name and password (HTTP Basic, checked with the
 * sign-in lockout and then remembered for a minute in `verified`). The
 * privilege set must have the `extended` privilege. `readOnlyToken` is true
 * for a read-only API token, which may not change anything.
 */
export async function signIn(req: IncomingMessage, store: Store, api: DataApi, verified: Map<string, number>, extended: string, what: string): Promise<{ privileges: Privileges; readOnlyToken: boolean; via?: string }> {
  const auth = req.headers.authorization ?? '';
  let account: string;
  let via: string | undefined;
  let privileges: Privileges | undefined;
  let scope: TokenScope | undefined;
  let readOnlyToken = false;
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1] ?? req.headers['x-fm-data-access-token'] as string | undefined;
  if (bearer?.startsWith('ohbt_')) {
    const bound = store.apiToken(bearer);
    if (!bound) throw new ApiError(212, 'Invalid API token', 401);
    if (!store.signInLocationAllowed(bound.account, req.socket.remoteAddress ?? '')) {
      throw new ApiError(9, 'This account may be used only from the server itself', 403);
    }
    if (bound.surfaces && !bound.surfaces.includes(extended)) throw new ApiError(9, `This API token is not scoped for ${what} (${extended})`, 403);
    // A layout-scoped token is limited to specific Data API layouts; the
    // table-oriented surfaces (OData, SQL) go through no layout, so the scope
    // can't be honoured there and the token is refused rather than widened.
    if (bound.layouts) throw new ApiError(9, `This API token is limited to specific Data API layouts and can't be used for ${what}`, 403);
    account = bound.account;
    readOnlyToken = bound.readOnly;
    scope = { readOnly: bound.readOnly, layouts: bound.layouts };
  } else if (/^Bearer\s/i.test(auth) || req.headers['x-fm-data-access-token']) {
    const session = api.authorize(req, store.name);
    ({ account, via } = session);
    readOnlyToken = !!session.readOnly;
    if (session.layoutScope) throw new ApiError(9, `This API token is limited to specific Data API layouts and can't be used for ${what}`, 403);
    privileges = sessionPrivileges(store, session);
  } else {
    const basic = /^Basic\s+(.+)$/i.exec(auth)?.[1];
    if (!basic) throw new ApiError(212, 'Sign in with an account name and password', 401);
    const [name, ...rest] = Buffer.from(basic, 'base64').toString('utf8').split(':');
    refreshAuthCache(store, verified);
    const from = clientAddress(req);
    const key = createHash('sha256').update(`${store.path}\0${basic}`).digest('hex');
    let checkedPassword = false;
    if ((verified.get(key) ?? -Infinity) < performance.now()) {
      if (!name || !(await store.verifyAsync(name, rest.join(':'), from))) {
        if (name) store.auditSignIn(name, from, false);
        const until = name ? store.lockedOut(name, from) : undefined;
        api.noteSignIn(from, store.name, name, what, until ? 'too many failed sign-ins' : 'wrong account or password');
        const visible = publicPasswordLockout(until, from);
        throw visible ? lockedOutError(visible) : new ApiError(212, 'Invalid user account and/or password', 401);
      }
      if (verified.size > 1000) verified.clear();
      refreshAuthCache(store, verified);
      verified.set(key, performance.now() + VERIFIED_MS);
      checkedPassword = true;
    }
    try { store.requireActiveAccount(name); } catch {
      verified.clear();
      throw new ApiError(212, 'Invalid user account and/or password', 401);
    }
    // The cache above covers the password only. An account with a second factor sends a fresh one-time code with
    // every request (each code works once), or uses a token as a Bearer instead, as the error says.
    const secondFactorError = passwordLoginSecondFactor(store, name, String(req.headers['x-tabularius-otp'] ?? '') || undefined, from);
    if (secondFactorError) {
      const hint = secondFactorError.code === 1211 ? '. Each code works once: send a new one in X-Tabularius-OTP with each request, or sign in once to the Data API and use its token (or an API token) as a Bearer token' : '';
      throw new ApiError(secondFactorError.code, secondFactorError.message + hint, secondFactorError.code === 9 ? 403 : 401);
    }
    if (store.mustChangePassword(name)) throw new ApiError(212, 'This account must change its password before continuing; change it, then sign in again', 403);
    if (checkedPassword || store.hasTotp(name)) {
      const passwordUntil = verified.get(key);
      store.auditSignIn(name, from, true, store.hasTotp(name) ? 'two-factor' : undefined);
      if (checkedPassword) api.noteSignIn(from, store.name, name, what);
      // Sign-in audits advance the security token too. Sync after the audit and
      // restore only this verified password, keeping its original expiry.
      refreshAuthCache(store, verified);
      if (passwordUntil !== undefined) verified.set(key, passwordUntil);
    }
    account = name;
  }
  const p = privileges ?? narrowPrivileges(store, store.privileges(account, via), scope);
  if (!p.has(extended)) {
    throw new ApiError(9, `Insufficient privileges: the "${p.name}" privilege set needs the ${extended} extended privilege (${what}) in ${store.name}. Grant it with: tabularius privileges <folder> ${store.name} grant "${p.name}" ${extended}`, 403);
  }
  // Counted toward the account's usage, so least privilege can tell an unused way in.
  store.recordUsage(account, extended === 'fmodata' ? 'odata' : extended === 'fmxml' ? 'xml' : 'sql');
  return { privileges: p, readOnlyToken, ...(via ? { via } : {}) };
}
