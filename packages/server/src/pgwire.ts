// SQL over the PostgreSQL protocol: reports, spreadsheets and BI tools
// (Excel, Power BI, Tableau, Metabase, psql, any PostgreSQL ODBC or JDBC
// driver) connect to hosted files as if to a PostgreSQL server. FileMaker's
// counterpart is ODBC/JDBC access (the fmxdbc extended privilege).
//
//   tabularius serve <folder> --sql-port 5432
//   psql "host=server port=5432 dbname=Contacts user=Ann sslmode=require"
//
// The database is the hosted file; queries are FileMaker SQL, as in
// ExecuteSQL and the HTTP SQL endpoint (sql.ts), and read-only. Sign in with
// the file's account name and password; the account needs fmxdbc and must be
// able to view every record and field. The password crosses the connection as
// typed, so off this machine the connection must use TLS (the server's
// certificate, from --tls-cert or --https).
//
// Both the simple and the extended query protocols are spoken ($1 parameters,
// prepared statements, row limits), with parameters and results in the text or
// the binary format, per value, as Bind asks (pgbinary.ts).

import { isUtf8 } from 'node:buffer';
import { cleanSql, maskSql, sqlTokens } from '../../store/src/sql-tokens.ts';
import { noteSurfaceSignIn } from './surface-access.ts';
import { FAULT_MESSAGE, isFault, logFault } from './fault-log.ts';
import { createServer, type Server, type Socket } from 'node:net';
import { createSecureContext, TLSSocket } from 'node:tls';
import { randomBytes } from 'node:crypto';
import { addressBucket, spendPasswordCheck, StoreError, writer, type Privileges, type Store } from '../../store/src/index.ts';
import { SignInFailures } from '../../store/src/sign-in-failures.ts';
import type { SqlValue } from '../../store/src/find.ts';
import type { Host } from './host.ts';
import { BinaryFormatError, binaryParam, binaryValue, castParamTypes, expansionBudget, isFalse, isPlainNumber } from './pgbinary.ts';
import { passwordLoginSecondFactor } from './password-login-policy.ts';
import { BOOLEAN_COLUMNS, catalogFunctions, FIRST_TABLE_OID, namesCatalogRelation, pgSyntax, readsCatalog, withCatalog, type CatalogData } from './pgcatalog.ts';

// Store.select buffers the whole result, including for suspended portals.
// Measured with three text columns; see docs/pgwire-results.md.
/** The most rows one query may return: TABULARIUS_PGWIRE_MAX_ROWS, default 100,000, 0 for no cap. Read per query. */
export function maxRows(): number {
  const given = process.env.TABULARIUS_PGWIRE_MAX_ROWS?.trim();
  const n = given ? Number(given) : 100_000;
  return Number.isInteger(n) && n >= 0 ? n : 100_000;
}
/** Connections from one network that may be waiting to sign in at once (this computer is not counted). */
const MAX_UNSIGNED_PER_ADDRESS = 50;
const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** Signed-in SQL connections allowed concurrently on this server. */
export const PGWIRE_LIMIT = { signedPerAccount: 32, signedGlobal: 256 };
/** Prepared statements and portals one connection may hold. */
const MAX_PREPARED = 1000;
/** Total materialised portal rows one connection may retain, even if a query's own cap is raised or disabled. */
const MAX_BUFFERED_ROWS_PER_CONNECTION = 100_000;
/** The longest account name a startup message may carry. */
const MAX_USER = 255;
const SSL_REQUEST = 80877103;
const GSS_REQUEST = 80877104;
const CANCEL_REQUEST = 80877102;
const PROTOCOL_3 = 196608;

const OID = { bool: 16, bytea: 17, int8: 20, text: 25, float8: 701, numeric: 1700, jsonb: 3802, uuid: 2950 } as const;

class PgError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Wire text is UTF-8; replacement decoding would silently change SQL or values. */
function wireText(raw: Buffer): string {
  if (!isUtf8(raw) || raw.includes(0)) throw new PgError('22021', 'Invalid UTF-8 SQL text');
  return raw.toString('utf8');
}

// --- writing messages ----------------------------------------------------------

function message(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(5);
  head.write(type, 0, 'latin1');
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}

const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
const i16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const i32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};

type TransactionStatus = 'I' | 'T' | 'E';
const ready = (status: TransactionStatus) => message('Z', Buffer.from(status));
const complete = (tag: string) => message('C', cstr(tag));
const errorMsg = (code: string, text: string) => message('E', Buffer.from('S'), cstr('ERROR'), Buffer.from('V'), cstr('ERROR'), Buffer.from('C'), cstr(code), Buffer.from('M'), cstr(text), Buffer.from([0]));
const warningMsg = (code: string, text: string) => message('N', Buffer.from('S'), cstr('WARNING'), Buffer.from('V'), cstr('WARNING'), Buffer.from('C'), cstr(code), Buffer.from('M'), cstr(text), Buffer.from([0]));

interface Column {
  name: string;
  oid: number;
}

/** The format (0 text, 1 binary) of each column, from Bind's result format codes: none means text, one applies to every column. */
function formatOf(formats: number[] | undefined, i: number): number {
  return !formats?.length ? 0 : formats.length === 1 ? formats[0] : formats[i] ?? 0;
}

function rowDescription(cols: Column[], formats?: number[]): Buffer {
  return message('T', i16(cols.length), ...cols.map((c, i) => Buffer.concat([cstr(c.name), i32(0), i16(0), i32(c.oid), i16(-1), i32(-1), i16(formatOf(formats, i))])));
}

/** A value as PostgreSQL's text format for its column's type. */
export function textValue(value: SqlValue, oid: number): Buffer | null {
  // Containers' bytes and big integers come back too.
  const v = value as unknown;
  if (v === null || v === undefined) return null;
  if (oid === OID.bool) return Buffer.from(isFalse(v) ? 'f' : 't');
  if (oid === OID.bytea) return Buffer.from('\\x' + Buffer.from(v as Uint8Array).toString('hex'));
  if (oid === OID.numeric) {
    // A number field can hold text ("$3750"): FileMaker SQL reads its number, or nothing.
    if (typeof v === 'number') return Number.isFinite(v) ? Buffer.from(String(v)) : null;
    if (typeof v === 'bigint') return Buffer.from(v.toString());
    const s = String(v).trim();
    return isPlainNumber(s) ? Buffer.from(s) : null;
  }
  return Buffer.from(String(v), 'utf8');
}

function dataRow(row: SqlValue[], cols: Column[], formats?: number[]): Buffer {
  return message('D', i16(row.length), ...row.flatMap((v, i) => {
    const oid = cols[i]?.oid ?? OID.text;
    const b = formatOf(formats, i) === 1 ? binaryValue(v, oid) : textValue(v, oid);
    return b === null ? [i32(-1)] : [i32(b.length), b];
  }));
}

/** Column types: from the column's declared type, else what its values are. */
function columnsOf(names: string[], types: (string | null)[], rows: SqlValue[][]): Column[] {
  return names.map((name, i) => {
    const t = (types[i] ?? '').toUpperCase();
    if (t === 'BOOLEAN') return { name, oid: OID.bool };
    if (t === 'BIGINT') return { name, oid: OID.int8 };
    if (t === 'DECIMAL_TEXT') return { name, oid: OID.numeric };
    if (t === 'JSON_TEXT') return { name, oid: OID.jsonb };
    if (t === 'UUID_TEXT') return { name, oid: OID.uuid };
    if (t === 'REAL' || t === 'INTEGER') return { name, oid: OID.numeric };
    if (t) return { name, oid: OID.text };
    const v = rows.find((r) => r[i] !== null && r[i] !== undefined)?.[i] as unknown;
    return { name, oid: typeof v === 'number' || typeof v === 'bigint' ? OID.numeric : v instanceof Uint8Array ? OID.bytea : OID.text };
  });
}

/** A catalog query's true-or-false columns, which clients read as t or f. */
function booleans(cols: Column[], catalog: boolean): Column[] {
  return catalog ? cols.map((c) => (BOOLEAN_COLUMNS.has(c.name.toLowerCase()) ? { ...c, oid: OID.bool } : c)) : cols;
}

// --- reading SQL -----------------------------------------------------------------

/** Statements in a query string, split at semicolons outside quotes and comments. */
export function splitStatements(sql: string): string[] {
  // Normalize only after tokenization: escaped quotes and dollar strings must
  // never expose a semicolon as a command boundary.
  try { sql = cleanSql(sql, true); }
  catch (e) { throw new PgError('42601', (e as Error).message); }
  const out: string[] = [];
  let start = 0;
  for (const t of sqlTokens(sql)) {
    if (t.kind === 'symbol' && t.text === ';') {
      if (sql.slice(start, t.start).trim()) out.push(sql.slice(start, t.start).trim());
      start = t.end;
    }
  }
  if (sql.slice(start).trim()) out.push(sql.slice(start).trim());
  return out;
}

/** $1, $2 ... as SQLite's ?1, ?2 (outside quotes), and how many there are. */
export function numberedParams(sql: string): { sql: string; count: number } {
  let count = 0;
  const out = sqlTokens(sql, true).map((t) => {
    if (t.kind !== 'parameter' || t.text[0] !== '$') return t.text;
    const n = Number(t.text.slice(1));
    if (!Number.isSafeInteger(n) || n < 1 || n > 32766) throw new PgError('54000', 'SQL parameter number is out of range');
    count = Math.max(count, n);
    return '?' + n;
  }).join('');
  return { sql: out, count };
}

// --- one connection ----------------------------------------------------------------

interface Prepared {
  sql: string;
  count: number;
  types: number[];
}

interface Portal {
  sql: string;
  params: SqlValue[];
  /** Result format codes from Bind. */
  formats: number[];
  result?: { cols: Column[]; rows: SqlValue[][] };
  sent: number;
}

class Connection {
  private socket: Socket | TLSSocket;
  private readonly server: PgServer;
  private buf = Buffer.alloc(0);
  private started = false;
  private store?: Store;
  private privileges?: Privileges;
  private user = '';
  private userIdentityId?: string;
  private settings: Record<string, string> = {};
  private transactionSettings?: Record<string, string>;
  private readonly localSettings = new Map<string, string>();
  private readonly statements = new Map<string, Prepared>();
  private readonly portals = new Map<string, Portal>();
  /** After an error in the extended protocol, messages are skipped until Sync. */
  private skipping = false;
  private transaction: TransactionStatus = 'I';
  private busy: Promise<void> = Promise.resolve();
  private tls = false;

  constructor(socket: Socket, server: PgServer) {
    this.socket = socket;
    this.server = server;
    // Held while waiting to sign in, so one network can't fill the server with connections that never do.
    this.unsignedKey = server.isLocal(socket) ? undefined : addressBucket(socket.remoteAddress ?? '');
    if (this.unsignedKey !== undefined && !server.holdUnsigned(this.unsignedKey)) {
      this.unsignedKey = undefined;
      socket.on('error', () => {});
      socket.end(errorMsg('53300', 'too many connections waiting to sign in from this network; try again shortly'));
      return;
    }
    this.listen(socket);
    // A minute to sign in.
    const timer = setTimeout(() => {
      if (!this.privileges) this.socket.destroy();
    }, 60_000);
    timer.unref();
    socket.once('close', () => {
      clearTimeout(timer);
      this.closed = true;
      this.releaseUnsigned();
      this.releaseSigned();
    });
  }

  private unsignedKey?: string;
  private signedKey?: string;
  /** Set when the socket closes, so a sign-in that was still checking the password does not take a slot nobody will release. */
  private closed = false;

  private releaseUnsigned(): void {
    if (this.unsignedKey === undefined) return;
    this.server.releaseUnsigned(this.unsignedKey);
    this.unsignedKey = undefined;
  }

  private releaseSigned(): void {
    if (this.signedKey === undefined) return;
    this.server.releaseSigned(this.signedKey);
    this.signedKey = undefined;
  }

  private listen(socket: Socket | TLSSocket): void {
    socket.on('data', (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      // One message at a time, in order, even while a query runs.
      this.busy = this.busy.then(() => this.drain()).catch((e) => {
        this.server.log(`sql connection: ${(e as Error).message}`);
        socket.destroy();
      });
    });
    socket.on('error', () => socket.destroy());
  }

  private send(...parts: Buffer[]): void {
    if (!this.socket.destroyed) this.socket.write(Buffer.concat(parts));
  }

  private async drain(): Promise<void> {
    while (!this.socket.destroyed) {
      if (!this.started) {
        if (this.buf.length < 8) return;
        const len = this.buf.readInt32BE(0);
        if (len < 8 || len > 10_000) throw new Error('bad startup message');
        if (this.buf.length < len) return;
        const body = this.buf.subarray(4, len);
        this.buf = this.buf.subarray(len);
        await this.startup(body);
        continue;
      }
      if (this.buf.length < 5) return;
      const len = this.buf.readInt32BE(1);
      if (len < 4 || len > 256 * 1024 * 1024) throw new Error('bad message length');
      if (this.buf.length < len + 1) return;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      await this.handle(type, body);
    }
  }

  private async startup(body: Buffer): Promise<void> {
    const code = body.readInt32BE(0);
    if (code === SSL_REQUEST) {
      const ctx = this.server.tlsContext();
      if (!ctx || this.tls) {
        this.send(Buffer.from('N'));
        return;
      }
      this.send(Buffer.from('S'));
      // Everything from here goes through TLS.
      const raw = this.socket as Socket;
      raw.removeAllListeners('data');
      const secure = new TLSSocket(raw, { isServer: true, secureContext: createSecureContext(ctx) });
      this.socket = secure;
      this.tls = true;
      this.buf = Buffer.alloc(0);
      this.listen(secure);
      return;
    }
    if (code === GSS_REQUEST) {
      this.send(Buffer.from('N'));
      return;
    }
    if (code === CANCEL_REQUEST) {
      this.socket.destroy();
      return;
    }
    // Protocol 3 of any minor version: a newer minor or an option (_pq_.name) this server does not know is answered
    // with NegotiateProtocolVersion, and the connection goes on at 3.0.
    if (code >>> 16 !== PROTOCOL_3 >>> 16) {
      this.send(errorMsg('08P01', 'only protocol 3.0 is spoken'));
      this.socket.end();
      return;
    }
    const params: Record<string, string> = {};
    const parts = body.subarray(4).toString('utf8').split('\0');
    for (let i = 0; i + 1 < parts.length && parts[i]; i += 2) params[parts[i]] = parts[i + 1];
    const options = Object.keys(params).filter((k) => k.startsWith('_pq_.'));
    if (code !== PROTOCOL_3 || options.length) this.send(message('v', i32(PROTOCOL_3 & 0xffff), i32(options.length), ...options.map(cstr)));
    this.user = params.user ?? '';
    const db = params.database || this.user;
    this.settings = { application_name: params.application_name ?? '', client_encoding: 'UTF8', DateStyle: 'ISO, MDY' };
    this.started = true;
    const fail = (code: string, text: string) => {
      this.send(errorMsg(code, text));
      this.socket.end();
    };
    if (this.user.length > MAX_USER) return fail('28000', 'the user name is too long');
    this.store = this.server.host.get(db);
    // Even when file names are public, wait for and check the password before refusing an unhosted file.
    if (!this.tls && !this.server.isLocal(this.socket)) {
      return fail('28000', 'connect with TLS (sslmode=require): passwords are not sent unencrypted over the network');
    }
    // Asked for in the clear, inside TLS or on this machine; a minute to answer.
    this.send(message('R', i32(3)));
    const timer = setTimeout(() => this.socket.destroy(), 60_000);
    const reply = await this.next('p').finally(() => clearTimeout(timer));
    if (!reply || this.closed || this.socket.destroyed) return;
    const password = reply.subarray(0, Math.max(0, reply.indexOf(0))).toString('utf8');
    const from = this.socket.remoteAddress ?? '';
    // Blocked by an administrator: refused before the password is checked, as for the Data API.
    if (this.server.host.config.blockNewUsers()) return fail('57P03', 'the server isn\'t accepting new users right now; try again later');
    // Hosted files and the unhosted-name pool have independent failure histories and
    // eviction. Exposing their lockout state would reveal whether a file exists.
    const passwordMessage = `password authentication failed for user "${this.user}"`;
    if (!this.store) {
      const until = this.user ? await this.server.checkUnhostedPassword(password, from, db, this.user) : undefined;
      if (this.closed || this.socket.destroyed) return;
      if (this.server.host.listFilesPublicly) return fail('3D000', `database "${db}" is not hosted here`);
      noteSurfaceSignIn(this.server.host, from, db, this.user, 'the PostgreSQL protocol', until ? 'too many failed sign-ins' : 'wrong account or password');
      return fail('28P01', passwordMessage);
    }
    const locked = this.user ? this.store.lockedOut(this.user, from) : undefined;
    const verified = !!this.user && await this.store.verifyAsync(this.user, password, from);
    // Store lockouts normally skip scrypt. This surface must match the dummy work for an unhosted file.
    if (locked) await spendPasswordCheck(password);
    if (!verified) {
      if (this.user) this.store.auditSignIn(this.user, from, false);
      const until = locked ?? (this.user ? this.store.lockedOut(this.user, from) : undefined);
      noteSurfaceSignIn(this.server.host, from, this.store.name, this.user, 'the PostgreSQL protocol', until ? 'too many failed sign-ins' : 'wrong account or password');
      return fail('28P01', passwordMessage);
    }
    const secondFactorError = passwordLoginSecondFactor(this.store, this.user, undefined, from);
    if (secondFactorError) {
      const text = secondFactorError.code === 1211 || secondFactorError.code === 1212
        ? 'PostgreSQL wire sign-in does not support one-time codes or passkey challenges; use SQL over HTTP with the X-Tabularius-OTP header or a supported sign-in surface'
        : secondFactorError.message;
      return fail(secondFactorError.code === 9 ? '28000' : '28P01', text);
    }
    if (this.store.mustChangePassword(this.user)) return fail('28000', 'this account must change its password before signing in to PostgreSQL wire; change it, then sign in again');
    // A correct password is a sign-in whatever the privilege checks below say, as it was before the connection caps.
    this.store.auditSignIn(this.user, from, true, this.store.hasTotp(this.user) ? 'two-factor' : undefined);
    noteSurfaceSignIn(this.server.host, from, this.store.name, this.user, 'the PostgreSQL protocol');
    this.userIdentityId = this.store.accountIdentityId(this.user);
    const p = this.store.privileges(this.user);
    if (!p.has('fmxdbc')) return fail('42501', `the "${p.name}" privilege set needs the fmxdbc extended privilege (SQL access, like ODBC/JDBC). Grant it with: tabularius privileges <folder> ${this.store?.name} grant "${p.name}" fmxdbc`);
    if (!p.readsEverything) return fail('42501', `SQL reads every record, and the "${p.name}" privilege set can't view every record and field`);
    // The socket may have closed while the password was being checked: its close handler has already run, so taking a slot now would never be given back.
    if (this.closed || this.socket.destroyed) return;
    const signedKey = `${this.store.name.toLowerCase()}\0${this.user.toLowerCase()}`;
    const limit = this.server.holdSigned(signedKey);
    if (limit) return fail('53300', `too many signed-in PostgreSQL connections (${limit} limit); close another connection and try again`);
    this.signedKey = signedKey;
    this.privileges = p;
    this.releaseUnsigned();
    this.store.recordUsage(this.user, 'sql');
    const status: Record<string, string> = {
      server_version: '14.0 (Tabularius)', server_encoding: 'UTF8', client_encoding: 'UTF8', DateStyle: 'ISO, MDY',
      integer_datetimes: 'on', standard_conforming_strings: 'on', TimeZone: 'UTC', IntervalStyle: 'postgres',
      is_superuser: 'off', session_authorization: this.user, application_name: this.settings.application_name,
      default_transaction_read_only: 'on', in_hot_standby: 'off',
    };
    this.send(
      message('R', i32(0)),
      ...Object.entries(status).map(([k, v]) => message('S', cstr(k), cstr(v))),
      message('K', i32(process.pid), randomBytes(4)),
      ready(this.transaction),
    );
  }

  /** Waits for the next message, which must be of `type`. */
  private async next(type: string): Promise<Buffer | undefined> {
    for (;;) {
      if (this.buf.length >= 5) {
        const len = this.buf.readInt32BE(1);
        // Before sign-in only a password comes: nothing large.
        if (len < 4 || len > 10_000) throw new PgError('08P01', 'bad message length');
        if (this.buf.length >= len + 1) {
          const t = String.fromCharCode(this.buf[0]);
          const body = this.buf.subarray(5, len + 1);
          this.buf = this.buf.subarray(len + 1);
          if (t !== type) throw new PgError('08P01', `expected message ${type}, got ${t}`);
          return body;
        }
      }
      if (this.socket.destroyed) return undefined;
      await new Promise<void>((resolve) => {
        const done = () => {
          this.socket.off('data', done);
          this.socket.off('close', done);
          resolve();
        };
        this.socket.once('data', done);
        this.socket.once('close', done);
      });
      await new Promise((r) => setImmediate(r));
    }
  }

  private async handle(type: string, body: Buffer): Promise<void> {
    if (type === 'X') {
      this.socket.end();
      return;
    }
    if (type === 'S') {
      this.skipping = false;
      // Sync ends an implicit transaction; its portals cannot be executed again.
      if (this.transaction === 'I') this.portals.clear();
      this.send(ready(this.transaction));
      return;
    }
    if (this.skipping) return;
    if (type === 'Q') {
      try {
        if (body.indexOf(0) !== body.length - 1) throw new PgError('08P01', 'Invalid query message');
        await this.simpleQuery(wireText(body.subarray(0, -1)));
      } catch (e) { this.sendError(e); }
      if (this.transaction === 'I') this.portals.clear();
      this.send(ready(this.transaction));
      return;
    }
    if (type === 'H') return;
    try {
      this.extended(type, body);
    } catch (e) {
      this.skipping = true;
      this.sendError(e);
    }
  }

  /** Established connections and saved portals must not outlive their account. */
  private identityStillAllowed(): boolean {
    const allowed = !!this.store && !!this.user && this.store.identityAllowed(this.user, undefined, undefined, undefined, this.userIdentityId);
    if (!allowed) { this.statements.clear(); this.portals.clear(); }
    return allowed;
  }

  private sendError(e: unknown): void {
    if (this.transaction === 'T') this.transaction = 'E';
    const err = e instanceof PgError ? e : e instanceof BinaryFormatError ? new PgError(e.code, e.message) : e instanceof StoreError ? new PgError(e.code === 212 ? '28000' : '42000', e.message)
      : isFault(e, { sql: true }) ? (logFault(e), new PgError('XX000', FAULT_MESSAGE)) : new PgError('42000', (e as Error).message);
    this.send(errorMsg(err.code, err.message));
  }

  // --- statements

  /** Recognize only complete transaction exits, without changing session state. */
  private transactionEnd(sql: string): 'COMMIT' | 'ROLLBACK' | undefined {
    if (/^(?:SAVEPOINT|RELEASE|ROLLBACK(?:\s+(?:WORK|TRANSACTION))?\s+TO)\b/i.test(sql)) {
      throw new PgError('0A000', 'savepoints are not supported');
    }
    if (/^(COMMIT|END|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?\s+AND\s+CHAIN$/i.test(sql)) {
      throw new PgError('0A000', 'transaction chaining is not supported');
    }
    if (/^(COMMIT|END|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+NO\s+CHAIN)?$/i.test(sql)) {
      return /^ROLLBACK\b/i.test(sql) ? 'ROLLBACK' : 'COMMIT';
    }
    if (/^(COMMIT|END|ROLLBACK)\b/i.test(sql)) throw new PgError('42601', 'invalid transaction-ending command');
    return undefined;
  }

  /** Authorization is live for every query, including already materialized portals. */
  private authorize(): void {
    this.store!.requireActiveAccount(this.user);
    if (this.store!.mustChangePassword(this.user)) throw new PgError('28000', 'this account must change its password before continuing');
    if (!this.identityStillAllowed()) throw new PgError('28000', 'account identity has changed; sign in again');
    const p = this.store!.privileges(this.user);
    if (!p.has('fmxdbc')) throw new PgError('42501', 'this account no longer has the fmxdbc extended privilege');
    if (!p.readsEverything) throw new PgError('42501', "SQL reads every record, and this account can't view every record and field");
    this.privileges = p;
  }

  /** Statements the session answers itself; Parse and Describe must not execute them. */
  private session(sql: string, execute = false): { tag: string; cols?: Column[]; rows?: SqlValue[][] } | undefined {
    const s = sql.trim();
    let m: RegExpExecArray | null;
    const end = this.transactionEnd(s);
    if (end) {
      const tag = this.transaction === 'E' ? 'ROLLBACK' : end;
      if (execute) {
        if (this.transaction === 'I') this.send(warningMsg('25P01', 'there is no transaction in progress'));
        else {
          this.send(warningMsg('01000', `${end} does not ${end === 'COMMIT' ? 'commit' : 'roll back'} a storage transaction on this read-only connection`));
          if (tag === 'ROLLBACK') this.settings = this.transactionSettings!;
        }
        this.transactionSettings = undefined;
        this.localSettings.clear();
        this.transaction = 'I';
        this.portals.clear();
      }
      return { tag };
    }
    if (this.transaction === 'E') throw new PgError('25P02', 'current transaction is aborted, commands ignored until end of transaction block');
    this.authorize();
    if (/^(BEGIN|START\s+TRANSACTION)\b/i.test(s)) {
      if (execute) {
        if (this.transaction === 'T') this.send(warningMsg('25001', 'there is already a transaction in progress'));
        else {
          this.transactionSettings = { ...this.settings };
          this.transaction = 'T';
          this.send(warningMsg('01000', 'BEGIN tracks session state only; this read-only connection has no storage transaction'));
        }
      }
      return { tag: 'BEGIN' };
    }
    if (/^DISCARD\b/i.test(s)) {
      if (execute) this.send(warningMsg('01000', 'DISCARD is not supported; session state was not cleared'));
      return { tag: 'DISCARD ALL' };
    }
    if (/^DEALLOCATE\b/i.test(s)) {
      if (execute) this.send(warningMsg('01000', 'DEALLOCATE is not supported; prepared statements were not cleared'));
      return { tag: 'DEALLOCATE' };
    }
    if (/^SET\s+(?:SESSION\s+)?TRANSACTION\b/i.test(s)) {
      if (execute) this.send(warningMsg('01000', 'SET TRANSACTION is not supported; isolation and access mode are unchanged'));
      return { tag: 'SET' };
    }
    if ((m = /^SET\s+(?:(SESSION|LOCAL)\s+)?(\w+)\s*(?:=|TO)\s*'?([^']*)'?/i.exec(s))) {
      if (execute) {
        const key = m[2].toLowerCase();
        const value = m[3].trim();
        const supported = key === 'application_name' || (key === 'client_encoding' && value.toUpperCase() === 'UTF8')
          || (key === 'datestyle' && value.toUpperCase() === 'ISO, MDY');
        if (!supported) {
          const reason = key === 'statement_timeout' ? 'statement_timeout is not enforced on this connection'
            : `${m[2]} is not supported on this connection`;
          this.send(warningMsg('01000', `${reason}; SET had no effect`));
        } else if (m[1]?.toUpperCase() === 'LOCAL') {
          if (this.transaction === 'I') this.send(warningMsg('25P01', 'SET LOCAL can only be used in transaction blocks'));
          else this.localSettings.set(key, value);
        } else {
          const name = Object.keys(this.settings).find((k) => k.toLowerCase() === key) ?? m[2];
          this.settings[name] = value;
          this.localSettings.delete(key);
        }
      }
      return { tag: 'SET' };
    }
    if (/^(SET|RESET)\b/i.test(s)) {
      const tag = s.split(/\s/)[0].toUpperCase();
      if (execute) this.send(warningMsg('01000', `${tag} is not supported; session state was not changed`));
      return { tag };
    }
    if ((m = /^SHOW\s+(.+?)\s*$/i.exec(s))) {
      const name = m[1].replace(/\s+/g, ' ').toLowerCase();
      const known: Record<string, string> = {
        'transaction isolation level': 'read committed', server_version: '14.0 (Tabularius)', server_encoding: 'UTF8',
        standard_conforming_strings: 'on', timezone: 'UTC', datestyle: 'ISO, MDY', transaction_read_only: 'on',
        integer_datetimes: 'on', intervalstyle: 'postgres', is_superuser: 'off', session_authorization: this.user,
        default_transaction_read_only: 'on', in_hot_standby: 'off',
        search_path: 'public', statement_timeout: '0',
      };
      const value = this.localSettings.get(name) ?? Object.entries(this.settings).find(([k]) => k.toLowerCase() === name)?.[1] ?? known[name];
      if (value === undefined) throw new PgError('42704', `unrecognized configuration parameter "${m[1]}"`);
      return { tag: 'SHOW', cols: [{ name: name.replace(/ /g, '_'), oid: OID.text }], rows: [[value]] };
    }
    if (/^(DECLARE|FETCH|MOVE|CLOSE)\b/i.test(s)) {
      throw new PgError('0A000', 'cursors are not supported on this connection (DECLARE, FETCH, MOVE, CLOSE); run the SELECT itself. A driver\'s fetch size works: the extended protocol\'s row limit pages through a result');
    }
    if (/^(PREPARE|EXECUTE)\b/i.test(s)) {
      throw new PgError('0A000', 'SQL-level PREPARE and EXECUTE are not supported on this connection; send the statement with parameters through the extended protocol (Parse, Bind, Execute), as drivers do');
    }
    if (!/^(SELECT|WITH|VALUES|TABLE)\b/i.test(s) && !/^\(/.test(s)) {
      throw new PgError('25006', 'this connection is read-only: only SELECT queries run');
    }
    return undefined;
  }

  /**
   * A query in the file's terms: PostgreSQL syntax and session functions, then
   * FileMaker SQL, with PostgreSQL's catalog tables when it reads them.
   */
  private translate(sql: string): { text: string; target: Store; catalog: boolean } {
    this.authorize();
    const query = pgSyntax(sql);
    const code = maskSql(query);
    const values: Record<string, string> = {
      version: `'PostgreSQL 14.0 (Tabularius)'`,
      current_database: `'${this.store!.name.replace(/'/g, "''")}'`,
      current_schema: `'public'`, pg_backend_pid: String(process.pid),
    };
    // One pass over code positions: neither input literals nor inserted account
    // and database names can be interpreted as session expressions.
    const pgFunctions = query.replace(/\b(version|current_database|current_schema|pg_backend_pid)\(\)|\b(current_user|session_user|current_role)\b(?!\s*\()/gi,
      (text, call: string | undefined, user: string | undefined, offset: number) => {
        if (code.slice(offset, offset + text.length) !== text) return text;
        return call ? values[call.toLowerCase()] : `'${this.user.replace(/'/g, "''")}'`;
      });
    const translated = this.store!.calc.translateSQL(pgFunctions);
    let { sql: text } = translated;
    const { target } = translated;
    if (!this.privileges!.in(target).readsEverything) {
      throw new PgError('42501', `SQL reads every record, and this account can't view every record and field in ${target.name}`);
    }
    // Only a query of the catalog's own tables is left out of the read log; a function of the catalog's name beside a table of the file is still a read of it.
    const catalog = namesCatalogRelation(text);
    let read: CatalogData | undefined;
    const data = () => (read ??= this.catalog());
    // array_agg is built from a function the catalog's helpers define, so queries of the file's own tables can use it too.
    if (catalog || readsCatalog(text) || /\btabularius_array_item\b/.test(text)) catalogFunctions(target, data);
    if (catalog) text = withCatalog(text, data);
    return { text, target, catalog };
  }

  /** The file's tables and columns, as the catalog shows them. */
  private catalog(): CatalogData {
    const store = this.store!;
    return {
      database: store.name,
      user: this.user,
      tables: store.schema.tableOccurrences.flatMap((to, i) => {
        const t = store.calc.occurrenceTable(to.id);
        if (!t) return [];
        // The columns a query of it returns, typed as results are.
        const { names, types } = t.store.describe(`SELECT * FROM "${t.table.name.replace(/"/g, '""')}"`);
        const columns = columnsOf(names, types, []).filter((c) => !c.name.startsWith('_fm_'));
        return [{ oid: FIRST_TABLE_OID + i, name: to.name, columns }];
      }),
    };
  }

  private run(sql: string, params: SqlValue[]): { cols: Column[]; rows: SqlValue[][] } {
    const { text, target, catalog } = this.translate(sql);
    const cap = maxRows();
    const r = target.select(text, params, cap === 0 ? Infinity : cap + 1);
    if (cap > 0 && r.rows.length > cap) throw new PgError('54000', `SQL results are limited to ${cap} rows; use LIMIT and page through the result with a stable ORDER BY`);
    // Clients read the catalog on connect and for every autocomplete; only queries of the file's own tables are reads of its data.
    if (!catalog) writer.run({ account: this.user, surface: 'sql' }, () => target.logQuery(text, r.rows.length, { privileges: this.privileges }));
    return { cols: booleans(columnsOf(r.names, r.types, r.rows), catalog), rows: r.rows };
  }

  private async simpleQuery(query: string): Promise<void> {
    let statements: string[];
    try {
      statements = splitStatements(query).filter(Boolean);
      // PostgreSQL parses the entire string before executing its first command.
      // Prepare without stepping: semantic and read-only errors still belong to
      // execution (BEGIN; SELECT * FROM missing_table must end in E).
      for (const sql of statements) this.validateSyntax(sql);
    } catch (e) {
      this.sendError(e);
      return;
    }
    if (!statements.length) {
      this.send(message('I'));
      return;
    }
    for (const sql of statements) {
      try {
        const own = this.session(sql, true);
        if (own) {
          if (own.cols) this.send(rowDescription(own.cols), ...own.rows!.map((r) => dataRow(r, own.cols!)));
          this.send(complete(own.tag));
          continue;
        }
        const r = this.run(sql, []);
        this.send(rowDescription(r.cols));
        for (let i = 0; i < r.rows.length; i += 1000) this.send(...r.rows.slice(i, i + 1000).map((row) => dataRow(row, r.cols)));
        this.send(complete(`SELECT ${r.rows.length}`));
      } catch (e) {
        // The rest of a multi-statement query is skipped, as PostgreSQL does.
        this.sendError(e);
        return;
      }
      await new Promise((r) => setImmediate(r));
    }
  }

  private validateSyntax(sql: string): void {
    // These commands use PostgreSQL session syntax rather than SQLite syntax.
    if (/^(BEGIN|START\s+TRANSACTION|SET|RESET|SHOW|DISCARD|DEALLOCATE|DECLARE|FETCH|MOVE|CLOSE|PREPARE|EXECUTE|COPY|LISTEN|UNLISTEN|NOTIFY)\b/i.test(sql)) return;
    try {
      if (this.transactionEnd(sql)) return;
      const { text, target } = this.translate(sql);
      target.sql.prepare(text);
    } catch (e) {
      if (e instanceof PgError && e.code === '42601') throw e;
      // SQLite also resolves names during preparation. Only syntax failures
      // abort the whole string before execution; other errors are deferred.
      const err = e as Error & { code?: string };
      if (err.code === 'ERR_SQLITE_ERROR' && /^(?:near "[\s\S]*": syntax error|incomplete input|unrecognized token: [\s\S]*)$/.test(err.message)) {
        throw new PgError('42601', err.message);
      }
    }
  }

  private extended(type: string, body: Buffer): void {
    let pos = 0;
    const str = () => {
      const end = body.indexOf(0, pos);
      if (end < 0) throw new PgError('08P01', 'Invalid SQL message');
      const s = wireText(body.subarray(pos, end));
      pos = end + 1;
      return s;
    };
    const int16 = () => {
      if (pos + 2 > body.length) throw new PgError('08P01', 'Invalid SQL message');
      const v = body.readInt16BE(pos);
      pos += 2;
      return v;
    };
    const int32 = () => {
      if (pos + 4 > body.length) throw new PgError('08P01', 'Invalid SQL message');
      const v = body.readInt32BE(pos);
      pos += 4;
      return v;
    };
    switch (type) {
      case 'P': {
        const name = str();
        const statements = splitStatements(str()).filter(Boolean);
        if (statements.length > 1) throw new PgError('42601', 'cannot insert multiple commands into a prepared statement');
        const sql = statements[0] ?? '';
        const typeCount = int16();
        if (typeCount < 0 || pos + typeCount * 4 !== body.length) throw new PgError('08P01', 'Invalid Parse message');
        const given = Array.from({ length: typeCount }, () => int32());
        const { sql: numbered, count } = numberedParams(sql);
        const casts = castParamTypes(sql);
        const types = Array.from({ length: Math.max(count, given.length) }, (_, i) => given[i] || casts.get(i + 1) || 0);
        // Checked now, as PostgreSQL does: a bad statement fails at Parse.
        if (numbered.trim()) this.describe(numbered);
        if (!this.statements.has(name) && this.statements.size >= MAX_PREPARED) throw new PgError('54000', 'too many prepared statements on this connection; close some');
        this.statements.set(name, { sql: numbered, count, types });
        this.send(message('1'));
        return;
      }
      case 'B': {
        const portal = str();
        const name = str();
        const st = this.statements.get(name);
        if (!st) throw new PgError('26000', 'no such prepared statement');
        if (st.sql) this.session(st.sql);
        const formats = Array.from({ length: int16() }, () => int16());
        const n = int16();
        // As PostgreSQL: no format code means text, one applies to every parameter, otherwise one per parameter.
        if (formats.length > 1 && formats.length !== n) throw new PgError('08P01', `bind message has ${formats.length} parameter formats but ${n} parameters`);
        if (n !== st.types.length) throw new PgError('08P01', `bind message supplies ${n} parameters, but prepared statement "${name}" requires ${st.types.length}`);
        const params: SqlValue[] = [];
        // One allowance for the text all of this Bind's binary arrays expand to, in proportion to the bytes sent.
        const budget = expansionBudget(body.length);
        for (let i = 0; i < n; i++) {
          const len = int32();
          if (len === -1) {
            params.push(null);
            continue;
          }
          // Any other negative length, or one past the end of the message, is malformed: never read as NULL or as a shorter value.
          if (len < 0 || pos + len > body.length) throw new PgError('08P01', 'insufficient data left in message');
          const oid = st.types[i] ?? 0;
          const raw = body.subarray(pos, pos + len);
          pos += len;
          const format = formats.length === 1 ? formats[0] : formats[i] ?? 0;
          if (format === 1) {
            let v: SqlValue | undefined;
            try { v = binaryParam(raw, oid, budget); }
            catch (e) { throw e instanceof BinaryFormatError ? new PgError(e.code, `${e.message} in bind parameter ${i + 1}`) : e; }
            if (v === undefined) throw new PgError('0A000', `binary parameters of type ${oid} are not supported: send this one as text`);
            params.push(v);
            continue;
          }
          if (format !== 0) throw new PgError('08P01', `unknown parameter format ${format}`);
          const text = wireText(raw);
          params.push([20, 21, 23, 700, 701, 1700].includes(oid) && text.trim() !== '' && !Number.isNaN(Number(text)) ? Number(text) : text);
        }
        const results = Array.from({ length: int16() }, () => int16());
        if (results.some((f) => f !== 0 && f !== 1)) throw new PgError('08P01', 'result formats must be 0 (text) or 1 (binary)');
        if (pos !== body.length) throw new PgError('08P01', 'invalid message format: bytes after the Bind message\'s result formats');
        // Several result format codes must be one per column, checked at Bind as PostgreSQL does; a statement with no rows takes any.
        if (results.length > 1) {
          const cols = this.describe(st.sql);
          if (cols && cols.length !== results.length) throw new PgError('08P01', `bind message has ${results.length} result formats but query has ${cols.length} columns`);
        }
        if (!this.portals.has(portal) && this.portals.size >= MAX_PREPARED) throw new PgError('54000', 'too many portals on this connection; close some');
        this.portals.set(portal, { sql: st.sql, params, formats: results, sent: 0 });
        this.send(message('2'));
        return;
      }
      case 'D': {
        const kind = String.fromCharCode(body[0]);
        pos = 1;
        const name = str();
        if (kind === 'S') {
          const st = this.statements.get(name);
          if (!st) throw new PgError('26000', 'no such prepared statement');
          const types = Array.from({ length: st.count }, (_, i) => st.types[i] || OID.text);
          this.send(message('t', i16(types.length), ...types.map(i32)));
          const cols = this.describe(st.sql);
          this.send(cols ? rowDescription(cols) : message('n'));
          return;
        }
        const p = this.portals.get(name);
        if (!p) throw new PgError('34000', 'no such portal');
        const r = this.resultOf(p);
        this.send(r ? rowDescription(r.cols, p.formats) : message('n'));
        return;
      }
      case 'E': {
        const p = this.portals.get(str());
        if (!p) throw new PgError('34000', 'no such portal');
        const max = int32();
        if (!p.sql) {
          this.send(message('I'));
          return;
        }
        const own = this.session(p.sql, true);
        if (own && !own.cols) {
          this.send(complete(own.tag));
          return;
        }
        const r = this.resultOf(p)!;
        const end = max > 0 ? Math.min(r.rows.length, p.sent + max) : r.rows.length;
        for (let i = p.sent; i < end; i += 1000) this.send(...r.rows.slice(i, Math.min(end, i + 1000)).map((row) => dataRow(row, r.cols, p.formats)));
        p.sent = end;
        this.send(end < r.rows.length ? message('s') : complete(`${own ? own.tag : 'SELECT'} ${own ? '' : r.rows.length}`.trim()));
        return;
      }
      case 'C': {
        const kind = String.fromCharCode(body[0]);
        pos = 1;
        const name = str();
        if (kind === 'S') this.statements.delete(name);
        else this.portals.delete(name);
        this.send(message('3'));
        return;
      }
      default:
        throw new PgError('08P01', `message type ${type} is not supported`);
    }
  }

  /** A portal's rows, run once. */
  private resultOf(p: Portal): { cols: Column[]; rows: SqlValue[][] } | undefined {
    if (!p.sql) return undefined;
    const own = this.session(p.sql);
    if (p.result && !own) this.translate(p.sql); // recheck access to external files before returning cached rows
    if (!p.result) {
      if (own) {
        if (!own.cols) return undefined;
        this.keepPortalResult(p, { cols: own.cols, rows: own.rows! });
      } else {
        // The types Describe gave the client, which it reads binary values by: a column with no declared type
        // (an expression) is described as text before any row exists, so it stays text here.
        const r = this.run(p.sql, p.params);
        const described = this.describe(p.sql);
        this.keepPortalResult(p, described && described.length === r.cols.length ? { cols: described, rows: r.rows } : r);
      }
    }
    return p.result;
  }

  /** A suspended result remains in its portal, so cap the sum held by this connection. */
  private keepPortalResult(p: Portal, result: { cols: Column[]; rows: SqlValue[][] }): void {
    const alreadyBuffered = [...this.portals.values()].reduce((n, portal) => n + (portal.result?.rows.length ?? 0), 0);
    // TABULARIUS_PGWIRE_MAX_BUFFERED_ROWS (default 100,000) caps what this connection's portals hold together, but at
    // least one full result always fits: a larger TABULARIUS_PGWIRE_MAX_ROWS raises it, and 0 (no row cap) lifts it.
    const perQuery = maxRows();
    const given = Number(process.env.TABULARIUS_PGWIRE_MAX_BUFFERED_ROWS);
    const total = Number.isInteger(given) && given > 0 ? given : MAX_BUFFERED_ROWS_PER_CONNECTION;
    const cap = perQuery === 0 ? Infinity : Math.max(perQuery, total);
    if (alreadyBuffered + result.rows.length > cap) {
      throw new PgError('54000', `buffered SQL results on this connection are limited to ${cap} rows; close portals to free their rows`);
    }
    p.result = result;
  }

  /** A statement's columns without running it (types from the columns it reads). */
  private describe(sql: string): Column[] | undefined {
    if (!sql) return undefined;
    const own = this.session(sql);
    if (own) return own.cols;
    const { text, target, catalog } = this.translate(sql);
    const cols = target.describe(text);
    return booleans(columnsOf(cols.names, cols.types, []), catalog);
  }
}

export interface PgServerOptions {
  port: number;
  hostname?: string;
  /** The certificate to offer TLS with, current at the time (renewals included). */
  tls?: () => { cert: string | Buffer; key: string | Buffer } | undefined;
  log?: (m: string) => void;
}

export class PgServer {
  readonly host: Host;
  readonly log: (m: string) => void;
  private readonly opts: PgServerOptions;
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly unsigned = new Map<string, number>();
  private readonly signed = new Map<string, number>();
  private signedCount = 0;
  private readonly unhostedFailures = new SignInFailures();

  /** The same accounting as Store, in a separate bounded budget for names with no Store.
   * Reserve failures before yielding; every reply still spends one hash to hide file existence. */
  async checkUnhostedPassword(password: string, from: string, database: string, account: string): Promise<number | undefined> {
    const key = this.unhostedFailures.accountKey(account, from, database);
    this.unhostedFailures.record(key, from, false);
    const until = this.unhostedFailures.lockedOut(key, from);
    await spendPasswordCheck(password);
    return until;
  }

  /** Counts a connection not yet signed in from a network; false when it has too many. */
  holdUnsigned(key: string): boolean {
    const n = this.unsigned.get(key) ?? 0;
    if (n >= MAX_UNSIGNED_PER_ADDRESS) return false;
    this.unsigned.set(key, n + 1);
    return true;
  }

  releaseUnsigned(key: string): void {
    const n = (this.unsigned.get(key) ?? 0) - 1;
    if (n > 0) this.unsigned.set(key, n);
    else this.unsigned.delete(key);
  }

  /** Reserves a signed-in slot after authentication; the account is scoped to its hosted file. */
  holdSigned(key: string): 'per-account' | 'global' | undefined {
    if ((this.signed.get(key) ?? 0) >= PGWIRE_LIMIT.signedPerAccount) return 'per-account';
    if (this.signedCount >= PGWIRE_LIMIT.signedGlobal) return 'global';
    this.signed.set(key, (this.signed.get(key) ?? 0) + 1);
    this.signedCount++;
    return undefined;
  }

  releaseSigned(key: string): void {
    const n = this.signed.get(key) ?? 0;
    if (n <= 0) return;
    if (n === 1) this.signed.delete(key);
    else this.signed.set(key, n - 1);
    this.signedCount--;
  }

  /** Open connections. */
  get connections(): number {
    return this.sockets.size;
  }

  constructor(host: Host, opts: PgServerOptions) {
    this.host = host;
    this.opts = opts;
    this.log = opts.log ?? (() => {});
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.setNoDelay(true);
      new Connection(socket, this);
    });
  }

  tlsContext(): { cert: string | Buffer; key: string | Buffer } | undefined {
    return this.opts.tls?.();
  }

  isLocal(socket: Socket | TLSSocket): boolean {
    return LOCAL_ADDRESSES.has(socket.remoteAddress ?? '');
  }

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.opts.port, this.opts.hostname ?? '127.0.0.1', () => resolve((this.server.address() as { port: number }).port));
    });
  }

  close(): void {
    this.server.close();
    for (const s of this.sockets) s.destroy();
  }
}
