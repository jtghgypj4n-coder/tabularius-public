import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import type { Server } from 'node:http';
import { createStore, LOCKOUT, Store, totpCode } from '../../store/src/index.ts';
import type { SignInFailures } from '../../store/src/sign-in-failures.ts';
import { Host } from '../src/host.ts';
import { serve } from '../src/index.ts';
import { numberedParams, PgServer, PGWIRE_LIMIT, splitStatements } from '../src/pgwire.ts';
import { pgSyntax, riskyPattern } from '../src/pgcatalog.ts';
import { binaryParam, castParamTypes, decimalText, decodeNumeric, encodeNumeric } from '../src/pgbinary.ts';

// BI tools and ODBC/JDBC drivers connect over the PostgreSQL protocol.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const openssl = spawnSync('openssl', ['version']).status === 0;
const psql = spawnSync('psql', ['--version']).status === 0;
const asyncpg = spawnSync('python3', ['-c', 'import asyncpg']).status === 0;
let dir: string;
let server: Server;
let sqlPort: number;
let charts: import('../../store/src/index.ts').Store;
let host: import('../src/host.ts').Host;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const nativePath = join(dir, 'Native.openhbam.sqlite');
  createStore(nativePath, { mode: 'native' });
  const native = new Store(nativePath, 'Native');
  try {
    native.applyDesign([{ op: 'createTable', name: 'Values', fields: [
      { name: 'Flag', type: 'boolean' }, { name: 'Count', type: 'integer' }, { name: 'Price', type: 'decimal' },
      { name: 'Payload', type: 'json' }, { name: 'Key', type: 'uuid' },
    ] }]);
    const full = native.privilegeSets().find((p) => p.id === 1)!;
    native.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
    native.setPassword('Ann', 'pw', full.name);
    native.create('Values', { Flag: 'true', Count: '-12', Price: '900719925474099312345.01', Payload: '{"x":1}', Key: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' });
    native.create('Values', { Price: '9' });
  } finally { native.close(); }
  let tls: { tlsCert?: string; tlsKey?: string } = {};
  if (openssl) {
    spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-subj', '/CN=localhost', '-days', '1'], { cwd: dir });
    tls = { tlsCert: join(dir, 'cert.pem'), tlsKey: join(dir, 'key.pem') };
  }
  // Every address, so a connection from the network (not loopback) can be tried.
  const logs: string[] = [];
  const s = await serve({ dir, port: 0, hostname: '0.0.0.0', watch: false, sqlPort: 0, ...tls, log: (m) => void logs.push(m) });
  server = s.server;
  const store = s.host.get('Charts')!;
  charts = store;
  host = s.host;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
  store.setPassword('Ann', 'pw', full.name);
  store.setPassword('TwoFactorPG', 'pw', full.name);
  const { secret } = store.enrollTotp('TwoFactorPG');
  store.confirmTotp('TwoFactorPG', totpCode(secret));
  store.setPassword('ForcedPG', 'pw', full.name, { mustChange: true });
  store.savePrivilegeSet({ name: 'Viewers', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('Val', 'pw', 'Viewers');
  for (let i = 0; i < 100 && !logs.some((l) => l.startsWith('PostgreSQL clients: port')); i++) await new Promise((r) => setTimeout(r, 20));
  sqlPort = Number(/port (\d+)/.exec(logs.find((l) => l.startsWith('PostgreSQL clients'))!)![1]);
});
const opened = new Set<Socket>();
after(async () => {
  for (const s of opened) s.destroy();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** Just enough of a PostgreSQL client to speak the protocol. */
class Client {
  private buf = Buffer.alloc(0);
  private waiting?: () => void;
  socket: Socket;
  constructor(socket: Socket) {
    this.socket = socket;
    this.listen(socket);
  }
  listen(s: Socket): void {
    s.on('data', (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.waiting?.();
    });
    s.on('close', () => this.waiting?.());
  }
  static async open(opts: { user: string; password: string; database: string; host?: string; ssl?: boolean; port?: number }): Promise<Client> {
    const socket = connect(opts.port ?? sqlPort, opts.host ?? '127.0.0.1');
    opened.add(socket);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        socket.destroy();
        reject(new Error('unreachable'));
      }, 2000);
      socket.once('connect', () => {
        clearTimeout(t);
        resolve(undefined);
      });
      socket.once('error', reject);
    });
    let c = new Client(socket);
    if (opts.ssl) {
      const req = Buffer.alloc(8);
      req.writeInt32BE(8);
      req.writeInt32BE(80877103, 4);
      socket.write(req);
      const answer = await c.bytes(1);
      if (answer.toString() !== 'S') throw new Error('no TLS');
      socket.removeAllListeners('data');
      const secure = tlsConnect({ socket, rejectUnauthorized: false });
      await new Promise((r) => secure.once('secureConnect', r));
      c = new Client(secure);
    }
    const params = Buffer.from(`user\0${opts.user}\0database\0${opts.database}\0\0`);
    const head = Buffer.alloc(8);
    head.writeInt32BE(8 + params.length);
    head.writeInt32BE(196608, 4);
    c.socket.write(Buffer.concat([head, params]));
    const auth = await c.read();
    if (auth.type === 'E') throw new Error(c.errorText(auth.body));
    assert.equal(auth.body.readInt32BE(0), 3);
    c.send('p', Buffer.from(opts.password + '\0'));
    const msgs = await c.until('Z', true);
    const err = msgs.find((m) => m.type === 'E');
    if (err) throw new Error(c.errorText(err.body));
    return c;
  }
  private async bytes(n: number): Promise<Buffer> {
    while (this.buf.length < n) await new Promise<void>((r) => (this.waiting = r));
    const b = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return b;
  }
  async read(): Promise<{ type: string; body: Buffer }> {
    for (;;) {
      if (this.buf.length >= 5 && this.buf.length >= this.buf.readInt32BE(1) + 1) {
        const len = this.buf.readInt32BE(1);
        const m = { type: String.fromCharCode(this.buf[0]), body: this.buf.subarray(5, len + 1) };
        this.buf = this.buf.subarray(len + 1);
        return m;
      }
      if (this.socket.destroyed || this.socket.readableEnded) throw new Error('closed');
      await new Promise<void>((r) => (this.waiting = r));
    }
  }
  async until(type: string, orError = false): Promise<{ type: string; body: Buffer }[]> {
    const out: { type: string; body: Buffer }[] = [];
    for (;;) {
      const m = await this.read();
      out.push(m);
      if (m.type === type || (m.type === 'E' && orError)) return out;
    }
  }
  send(type: string, body = Buffer.alloc(0)): void {
    const head = Buffer.alloc(5);
    head.write(type);
    head.writeInt32BE(body.length + 4, 1);
    this.socket.write(Buffer.concat([head, body]));
  }
  errorText(body: Buffer): string {
    const fields = body.toString().split('\0');
    return `${fields.find((f) => f.startsWith('C'))?.slice(1)} ${fields.find((f) => f.startsWith('M'))?.slice(1)}`;
  }
  /** A simple query: column names and rows as text. */
  async query(sql: string): Promise<{ columns: string[]; oids: number[]; rows: (string | null)[][]; tags: string[]; error?: string }> {
    this.send('Q', Buffer.from(sql + '\0'));
    return this.results(await this.until('Z'));
  }
  results(msgs: { type: string; body: Buffer }[]) {
    const out = { columns: [] as string[], oids: [] as number[], rows: [] as (string | null)[][], tags: [] as string[], error: undefined as string | undefined };
    for (const m of msgs) {
      if (m.type === 'T') {
        let pos = 2;
        out.columns = [];
        out.oids = [];
        for (let i = 0; i < m.body.readInt16BE(0); i++) {
          const end = m.body.indexOf(0, pos);
          out.columns.push(m.body.subarray(pos, end).toString());
          out.oids.push(m.body.readInt32BE(end + 7));
          pos = end + 19;
        }
      } else if (m.type === 'D') {
        let pos = 2;
        const row: (string | null)[] = [];
        for (let i = 0; i < m.body.readInt16BE(0); i++) {
          const len = m.body.readInt32BE(pos);
          pos += 4;
          row.push(len < 0 ? null : m.body.subarray(pos, pos + len).toString());
          if (len > 0) pos += len;
        }
        out.rows.push(row);
      } else if (m.type === 'C') out.tags.push(m.body.subarray(0, m.body.length - 1).toString());
      else if (m.type === 's') out.tags.push('(suspended)');
      else if (m.type === 'E') out.error = this.errorText(m.body);
    }
    return out;
  }
  close(): void {
    this.send('X');
    this.socket.end();
  }
}

const cstr = (s: string) => Buffer.from(s + '\0');
const i16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const i32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};

test('statements split at semicolons outside quotes; $n become ?n', () => {
  assert.deepEqual(splitStatements(`SELECT 'a;b'; SELECT "x;y" -- c;d\n; /* e;f */ SELECT 3;`), [`SELECT 'a;b'`, `SELECT "x;y"`, 'SELECT 3']);
  assert.deepEqual(numberedParams(`SELECT * FROM t WHERE a = $2 AND b = '$1' AND c = $1`), { sql: `SELECT * FROM t WHERE a = ?2 AND b = '$1' AND c = ?1`, count: 2 });
});

test('signed-in PostgreSQL connections have per-account and global limits, and release slots on close', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-signed-limit-'));
  createStore(join(dir, 'Limits.openhbam.sqlite'));
  const localHost = new Host(dir);
  const store = localHost.get('Limits')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
  store.setPassword('Ann', 'pw', full.name);
  store.setPassword('Bob', 'pw', full.name);
  const pg = new PgServer(localHost, { port: 0 });
  const old = { ...PGWIRE_LIMIT };
  PGWIRE_LIMIT.signedPerAccount = 2;
  PGWIRE_LIMIT.signedGlobal = 3;
  t.after(async () => {
    Object.assign(PGWIRE_LIMIT, old);
    pg.close();
    await localHost.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const port = await pg.listen();
  const open = (user: string) => Client.open({ user, password: 'pw', database: 'Limits', port });
  const ann1 = await open('Ann');
  const ann2 = await open('Ann');
  const bob = await open('Bob');
  await assert.rejects(open('Ann'), /53300.*per-account/);
  await assert.rejects(open('Bob'), /53300.*global/);
  const closed = new Promise<void>((resolve) => ann1.socket.once('close', () => resolve()));
  ann1.close();
  await closed;
  const bob2 = await open('Bob');
  assert.deepEqual((await bob2.query('SELECT 1')).rows, [['1']]);
  ann2.close(); bob.close(); bob2.close();
});

test('a connection dropped while its password is being checked does not keep a signed-in slot', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-signed-drop-'));
  createStore(join(dir, 'Drop.openhbam.sqlite'));
  const localHost = new Host(dir);
  const store = localHost.get('Drop')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
  store.setPassword('Ann', 'pw', full.name);
  const pg = new PgServer(localHost, { port: 0 });
  t.after(async () => { pg.close(); await localHost.close(); rmSync(dir, { recursive: true, force: true }); });
  const port = await pg.listen();
  for (let i = 0; i < 5; i++) {
    const socket = connect(port);
    opened.add(socket);
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    const client = new Client(socket);
    const params = Buffer.from('user\0Ann\0database\0Drop\0\0');
    const head = Buffer.alloc(8);
    head.writeInt32BE(8 + params.length);
    head.writeInt32BE(196608, 4);
    socket.write(Buffer.concat([head, params]));
    assert.equal((await client.read()).type, 'R');
    // The right password, then gone before the answer: the check is still running when the socket closes.
    client.send('p', cstr('pw'));
    socket.destroy();
  }
  // Let every pending check finish.
  for (let i = 0; i < 50 && (pg.connections || (pg as any).signedCount); i++) await new Promise((r) => setTimeout(r, 40));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(pg.connections, 0);
  assert.equal((pg as any).signedCount, 0, 'no slot is held for a connection that is gone');
  assert.equal((pg as any).signed.size, 0);
  assert.equal((await Client.open({ user: 'Ann', password: 'pw', database: 'Drop', port }).then((c) => { c.close(); return 'ok'; })), 'ok');
});

test('an unhosted PostgreSQL database still asks for and checks a password before its public-list error', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-unhosted-timing-'));
  createStore(join(dir, 'Hosted.openhbam.sqlite'));
  const localHost = new Host(dir);
  const store = localHost.get('Hosted')!;
  store.setPassword('Ann', 'right', '[Full Access]');
  localHost.listFilesPublicly = true;
  const pg = new PgServer(localHost, { port: 0 });
  t.after(async () => { pg.close(); await localHost.close(); rmSync(dir, { recursive: true, force: true }); });
  const port = await pg.listen();
  const socket = connect(port);
  opened.add(socket);
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  const client = new Client(socket);
  const params = Buffer.from('user\0Ann\0database\0Missing\0\0');
  const head = Buffer.alloc(8);
  head.writeInt32BE(8 + params.length);
  head.writeInt32BE(196608, 4);
  socket.write(Buffer.concat([head, params]));
  const auth = await client.read();
  assert.equal(auth.type, 'R', 'the missing file must reach the password exchange');
  assert.equal(auth.body.readInt32BE(0), 3);
  client.send('p', cstr('wrong'));
  const denied = await client.read();
  assert.equal(denied.type, 'E');
  assert.match(client.errorText(denied.body), /^3D000 database "Missing" is not hosted here$/);
  socket.destroy();
});

test('PostgreSQL address lockouts give hosted and unhosted names the same message and password work', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-lockout-oracle-'));
  createStore(join(dir, 'Payroll.openhbam.sqlite'));
  const localHost = new Host(dir);
  const pg = new PgServer(localHost, { port: 0 });
  let from = '198.51.100.50';
  t.mock.method(pg, 'isLocal', (socket: Socket) => {
    Object.defineProperty(socket, 'remoteAddress', { value: from, configurable: true });
    return true;
  });
  // Count real scrypt calls instead of using fragile wall-clock thresholds.
  const hashes = t.mock.method(crypto, 'scrypt');
  syncBuiltinESMExports();
  t.after(async () => {
    hashes.mock.restore();
    syncBuiltinESMExports();
    pg.close();
    await localHost.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const port = await pg.listen();
  const results: { message: string; hashes: number }[][] = [];
  for (const database of ['Payroll', 'Payrol1']) {
    const attempts: { message: string; hashes: number }[] = [];
    for (let i = 0; i <= LOCKOUT.addressAttempts; i++) {
      const before = hashes.mock.callCount();
      await assert.rejects(Client.open({ user: `guess${i}`, password: 'wrong', database, port }), (e: Error) => {
        attempts.push({ message: e.message, hashes: hashes.mock.callCount() - before });
        return /^28P01 /.test(e.message);
      });
    }
    results.push(attempts);
  }
  assert.deepEqual(results[0], results[1], 'file existence changes neither the response nor the password work at or after the lockout threshold');
  assert.match(results[0].at(-1)!.message, /password authentication failed/);
  assert.ok(results.flat().every((r) => r.hashes === 1), 'every attempt, including a locked hosted file, spends one hash');
  from = '198.51.100.51';
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) {
    const before = hashes.mock.callCount();
    await assert.rejects(Client.open({ user: 'same-name', password: 'wrong', database: 'Payroll', port }), { message: /^28P01 / });
    assert.equal(hashes.mock.callCount() - before, 1, 'account lockouts also spend one hash');
  }
  assert.ok(localHost.get('Payroll')!.addressLockedOut(from), 'failures against a locked account still count toward its address budget');
});

test('PostgreSQL repeated-user lockouts match for hosted real, hosted fake and unhosted accounts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-account-oracle-'));
  createStore(join(dir, 'Payroll.openhbam.sqlite'));
  const localHost = new Host(dir);
  const store = localHost.get('Payroll')!;
  store.setPassword('Ann', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
  const pg = new PgServer(localHost, { port: 0 });
  const unhosted = (pg as unknown as { unhostedFailures: SignInFailures }).unhostedFailures;
  let from = '198.51.100.50';
  let now = Math.floor(performance.now()); // whole milliseconds, so expiry boundaries compare exactly
  t.mock.method(performance, 'now', () => now);
  t.mock.method(pg, 'isLocal', (socket: Socket) => {
    Object.defineProperty(socket, 'remoteAddress', { value: from, configurable: true });
    return true;
  });
  const hashes = t.mock.method(crypto, 'scrypt');
  syncBuiltinESMExports();
  t.after(async () => {
    hashes.mock.restore();
    syncBuiltinESMExports();
    pg.close();
    await localHost.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const port = await pg.listen();
  const locked = (database: string, user: string) => database === 'Payroll'
    ? store.lockedOut(user, from)
    : unhosted.lockedOut(unhosted.accountKey(user, from, database), from);
  const attempt = async (database: string, user: string) => {
    const before = hashes.mock.callCount();
    let message = '';
    await assert.rejects(Client.open({ user, password: 'wrong', database, port }), (e: Error) => {
      message = e.message.replace(/"[^"]*"/g, '""');
      return /^28P01 /.test(e.message);
    });
    assert.equal(hashes.mock.callCount() - before, 1, 'locked and unlocked attempts each spend one hash');
    return message;
  };
  for (const address of ['198.51.100.50', '127.0.0.1']) {
    from = address;
    const results: string[][] = [];
    for (const [database, user] of [['Payroll', 'Ann'], ['Payroll', 'nobody'], ['Payrol1', 'Ann']]) {
      const messages: string[] = [];
      for (let i = 0; i <= LOCKOUT.attempts; i++) {
        messages.push(await attempt(i % 2 ? database.toLowerCase() : database, i % 2 ? user.toLowerCase() : user));
        assert.equal(!!locked(database, user), i >= LOCKOUT.attempts - 1, 'the generic wire error still enforces the account limit');
      }
      results.push(messages);
    }
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[0], results[2], 'file existence must not change repeated-user lockout messages');
    assert.match(results[0][0], /password authentication failed/);
    assert.match(results[0].at(-1)!, /password authentication failed/);
    assert.match(await attempt('Payrol2', 'Ann'), /password authentication failed/, 'another file has its own account counter');
    assert.match(await attempt('Payrol1', 'another-user'), /password authentication failed/, 'another user has its own counter');
  }
  from = '198.51.100.51';
  for (const database of ['Payroll', 'Payrol1']) assert.match(await attempt(database, 'Ann'), /password authentication failed/, 'a fresh address is not locked');
  from = '198.51.100.50';
  now += LOCKOUT.lockMs;
  for (const database of ['Payroll', 'Payrol1']) {
    assert.match(await attempt(database, 'Ann'), /password authentication failed/);
    assert.equal(locked(database, 'Ann'), undefined, 'the lock expires at the same time');
  }
  now += LOCKOUT.windowMs;
  for (const database of ['Payroll', 'Payrol1']) {
    for (let i = 1; i < LOCKOUT.attempts; i++) assert.match(await attempt(database, 'Ann'), /password authentication failed/, 'an expired window resets earlier failures');
    assert.match(await attempt(database, 'Ann'), /password authentication failed/);
    assert.ok(locked(database, 'Ann'), 'new failures acquire a fresh lock after expiry');
  }
});

test('unhosted PostgreSQL floods retain dummy hashes after the PgServer address budget locks', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-unhosted-limit-'));
  // An empty host must also track failures: there is no Store to own this budget.
  const localHost = new Host(dir);
  localHost.listFilesPublicly = true;
  const pg = new PgServer(localHost, { port: 0 });
  const failures = (pg as unknown as { unhostedFailures: Map<string, { count: number; first: number; until?: number }> }).unhostedFailures;
  let from = '198.51.100.20';
  // Exercise network address accounting over a real loopback socket without requiring a TLS fixture.
  t.mock.method(pg, 'isLocal', (socket: Socket) => {
    Object.defineProperty(socket, 'remoteAddress', { value: from, configurable: true });
    return true;
  });
  const hashes = t.mock.method(crypto, 'scrypt');
  syncBuiltinESMExports();
  t.after(async () => {
    hashes.mock.restore();
    syncBuiltinESMExports();
    pg.close();
    await localHost.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const port = await pg.listen();
  const attempt = (i: number, publicList = true) => {
    localHost.listFilesPublicly = publicList;
    return assert.rejects(Client.open({ user: `guess${i}`, password: 'wrong', database: `Missing${i}`, port }), publicList ? /3D000 .* is not hosted here/ : /28P01 password authentication failed/);
  };
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) {
    from = i % 2 ? '::ffff:198.51.100.20' : '198.51.100.20';
    await attempt(i);
  }
  assert.equal(hashes.mock.callCount(), LOCKOUT.addressAttempts);
  assert.equal(failures.get('\u0000address\u0000198.51.100.20')?.count, LOCKOUT.addressAttempts);
  assert.ok(failures.get('\u0000address\u0000198.51.100.20')!.until! > performance.now());
  await attempt(100);
  await attempt(101, false);
  assert.equal(hashes.mock.callCount(), LOCKOUT.addressAttempts + 2, 'a blocked address still spends one dummy hash per request, even with new names');
  assert.equal(failures.get('\u0000address\u0000198.51.100.20')?.count, LOCKOUT.addressAttempts, 'locked entries do not keep growing');
  assert.equal(failures.size, LOCKOUT.addressAttempts, 'new accounts and database names cannot grow a locked address\'s table');

  from = '198.51.100.21';
  await attempt(102);
  assert.equal(hashes.mock.callCount(), LOCKOUT.addressAttempts + 3, 'another address still gets a password check');
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) {
    from = `2001:db8:1:2::${i + 1}`;
    await attempt(i);
  }
  const used = hashes.mock.callCount();
  from = '2001:db8:1:2::ffff';
  await attempt(103);
  assert.equal(hashes.mock.callCount(), used + 1, 'a blocked IPv6 /64 still spends a dummy hash');
  assert.equal(failures.get('\u0000address\u00002001:db8:1:2')?.count, LOCKOUT.addressAttempts, 'one IPv6 /64 shares the tracked budget');

  const now = Math.floor(performance.now()); // whole milliseconds, so expiry boundaries compare exactly
  t.mock.method(performance, 'now', () => now + LOCKOUT.lockMs + LOCKOUT.windowMs);
  await attempt(104);
  assert.equal(hashes.mock.callCount(), used + 2, 'expired blocks still spend a dummy hash');
  assert.equal(failures.get('\u0000address\u00002001:db8:1:2')?.count, 1, 'expired blocks start a fresh budget');
});

test('unhosted PostgreSQL requests still hash when the PgServer address table is full', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-unhosted-full-'));
  const localHost = new Host(dir);
  const pg = new PgServer(localHost, { port: 0 });
  const failures = (pg as unknown as { unhostedFailures: Map<string, { count: number; first: number; until?: number }> }).unhostedFailures;
  let now = Math.floor(performance.now()); // whole milliseconds, so expiry boundaries compare exactly
  const wall = Date.now();
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Date, 'now', () => wall);
  for (let i = 0; i < 40_000; i++) failures.set(`\u0000address\u00002001:db8:${i.toString(16)}:0`, { count: 1, first: now });
  const hashes = t.mock.method(crypto, 'scrypt');
  syncBuiltinESMExports();
  t.after(async () => {
    hashes.mock.restore();
    syncBuiltinESMExports();
    pg.close();
    await localHost.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.ok(await pg.checkUnhostedPassword('wrong', '198.51.100.30', 'Missing', 'Ann'), 'live address budgets refuse an untracked source at capacity');
  assert.equal(hashes.mock.callCount(), 1, 'a full table must not reveal an unhosted name with a fast reply');
  assert.equal(failures.size, 40_000);
  assert.equal(failures.has('\u0000address\u0000198.51.100.30'), false, 'live address counters cannot yield capacity');
  await pg.checkUnhostedPassword('wrong', '2001:db8:ff::1', 'Missing', 'Ann');
  assert.equal(hashes.mock.callCount(), 2);
  assert.equal(failures.get('\u0000address\u00002001:db8:ff:0')?.count, 2, 'existing entries still count attempts at capacity');
  now += LOCKOUT.windowMs;
  await pg.checkUnhostedPassword('wrong', '198.51.100.30', 'Missing', 'Ann');
  assert.equal(hashes.mock.callCount(), 3);
  assert.equal(failures.size, 2, 'expired entries release account and address capacity');
  assert.equal(failures.get('\u0000address\u0000198.51.100.30')?.count, 1);
});

test('unhosted PostgreSQL account tracking is bounded and expired entries free capacity', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-unhosted-accounts-'));
  const localHost = new Host(dir);
  const pg = new PgServer(localHost, { port: 0 });
  t.after(async () => {
    pg.close();
    await localHost.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const failures = (pg as unknown as { unhostedFailures: Map<string, { count: number; first: number; until?: number }> }).unhostedFailures;
  let now = Math.floor(performance.now()); // whole milliseconds, so expiry boundaries compare exactly
  t.mock.method(performance, 'now', () => now);
  await pg.checkUnhostedPassword('wrong', '127.0.0.1', 'Missing', 'Ann');
  assert.equal(failures.size, 1);
  const key = failures.keys().next().value!;
  for (let i = 1; i < 40_000; i++) failures.set(`old${i}`, { count: 1, first: now });
  for (let i = 1; i <= LOCKOUT.attempts; i++) {
    const until = await pg.checkUnhostedPassword('wrong', '127.0.0.1', 'Missing', 'Ann');
    assert.equal(!!until, i >= LOCKOUT.attempts - 1, 'existing accounts still lock at capacity');
  }
  assert.equal(failures.get(key)?.count, LOCKOUT.attempts, 'locked counters stop growing');
  for (let i = 0; i <= LOCKOUT.attempts; i++) {
    const until = await pg.checkUnhostedPassword('wrong', '127.0.0.1', 'Another', 'Ann');
    assert.equal(!!until, i >= LOCKOUT.attempts - 1, 'new accounts lock only after their own failures at capacity');
    assert.equal(failures.size, 40_000, 'new names cannot grow the bounded table');
  }
  now += LOCKOUT.lockMs + LOCKOUT.windowMs;
  assert.equal(await pg.checkUnhostedPassword('wrong', '127.0.0.1', 'Fresh', 'Ann'), undefined);
  assert.equal(failures.size, 1, 'expired windows and locks are removed before retaining new names');
});

test('transaction status and extended error recovery without imported files', { timeout: 30_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-state-'));
  createStore(join(dir, 'State.openhbam.sqlite'));
  const host = new Host(dir);
  const store = host.get('State')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
  store.setPassword('Ann', 'pw', full.name);
  const pg = new PgServer(host, { port: 0 });
  t.after(async () => {
    pg.close();
    try {
      await host.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  const port = await pg.listen();
  const open = () => Client.open({ user: 'Ann', password: 'pw', database: 'State', port });
  const query = async (c: Client, sql: string, status: string) => {
    c.send('Q', cstr(sql));
    const msgs = await c.until('Z');
    assert.deepEqual(msgs.at(-1)!.body, Buffer.from(status), sql);
    return { ...c.results(msgs), msgs };
  };
  const parse = (c: Client, sql: string, name = '') => c.send('P', Buffer.concat([cstr(name), cstr(sql), i16(0)]));
  const bind = (c: Client, statement = '') => c.send('B', Buffer.concat([cstr(''), cstr(statement), i16(0), i16(0), i16(0)]));
  const execute = (c: Client) => c.send('E', Buffer.concat([cstr(''), i32(0)]));
  const sync = async (c: Client, status: string) => {
    c.send('S');
    const msgs = await c.until('Z');
    assert.deepEqual(msgs.at(-1)!.body, Buffer.from(status));
    return msgs;
  };
  const notice = (msgs: { type: string; body: Buffer }[], tag: string, message: RegExp) => {
    assert.deepEqual(msgs.map((m) => m.type), ['N', 'C', 'Z']);
    const fields = Object.fromEntries(msgs[0].body.toString().split('\0').filter(Boolean).map((field) => [field[0], field.slice(1)]));
    assert.equal(fields.S, 'WARNING');
    assert.equal(fields.V, 'WARNING');
    assert.match(fields.C, /^(01000|25[A-Z0-9]{3})$/);
    assert.match(fields.M, message);
    assert.equal(msgs[1].body.toString(), `${tag}\0`);
  };

  await t.test('BEGIN warns that no storage transaction starts', async () => {
    const c = await open();
    try { notice((await query(c, 'BEGIN', 'T')).msgs, 'BEGIN', /read-only|transaction/i); } finally { c.close(); }
  });
  await t.test('COMMIT and ROLLBACK warn when ending a bookkeeping transaction', async () => {
    const c = await open();
    try {
      for (const end of ['COMMIT', 'ROLLBACK']) {
        await query(c, 'BEGIN', 'T');
        notice((await query(c, end, 'I')).msgs, end, /read-only|transaction/i);
      }
    } finally { c.close(); }
  });
  await t.test('unsupported SET warns and does not claim to change behavior', async () => {
    const c = await open();
    try {
      notice((await query(c, 'SET statement_timeout = 1', 'I')).msgs, 'SET', /statement_timeout.*not (?:supported|enforced|honou?red)/i);
      notice((await query(c, "SET search_path TO private", 'I')).msgs, 'SET', /search_path.*not supported/i);
      notice((await query(c, 'SET extra_float_digits = 3', 'I')).msgs, 'SET', /extra_float_digits.*not supported/i);
      assert.deepEqual((await query(c, 'SHOW statement_timeout', 'I')).rows, [['0']]);
      assert.deepEqual((await query(c, 'SHOW search_path', 'I')).rows, [['public']]);
      assert.match((await query(c, 'SHOW extra_float_digits', 'I')).error!, /^42704 /);
    } finally { c.close(); }
  });
  await t.test('SHOW answers every startup ParameterStatus', async () => {
    const c = await open();
    try {
      const status = {
        server_version: '14.0 (Tabularius)', server_encoding: 'UTF8', client_encoding: 'UTF8', DateStyle: 'ISO, MDY',
        integer_datetimes: 'on', standard_conforming_strings: 'on', TimeZone: 'UTC', IntervalStyle: 'postgres',
        is_superuser: 'off', session_authorization: 'Ann', application_name: '',
        default_transaction_read_only: 'on', in_hot_standby: 'off',
      };
      for (const [name, value] of Object.entries(status)) {
        const r = await query(c, `SHOW ${name}`, 'I');
        assert.equal(r.tags[0], 'SHOW');
        assert.deepEqual(r.rows, [[value]], name);
      }
    } finally { c.close(); }
  });
  await t.test('DISCARD reports that session cleanup is unsupported', async () => {
    const c = await open();
    try {
      await query(c, "SET application_name = 'kept'", 'I');
      notice((await query(c, 'DISCARD ALL', 'I')).msgs, 'DISCARD ALL', /DISCARD.*not supported/i);
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['kept']]);
    } finally { c.close(); }
  });
  await t.test('RESET reports that it did not reset a session parameter', async () => {
    const c = await open();
    try {
      await query(c, "SET application_name = 'kept'", 'I');
      notice((await query(c, 'RESET application_name', 'I')).msgs, 'RESET', /RESET.*not supported/i);
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['kept']]);
    } finally { c.close(); }
  });
  await t.test('SET TRANSACTION reports that transaction options are unsupported', async () => {
    const c = await open();
    try { notice((await query(c, 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE', 'I')).msgs, 'SET', /SET TRANSACTION.*not supported/i); } finally { c.close(); }
  });
  await t.test('DEALLOCATE reports that prepared statements were not cleared', async () => {
    const c = await open();
    try { notice((await query(c, 'DEALLOCATE ALL', 'I')).msgs, 'DEALLOCATE', /DEALLOCATE.*not supported/i); } finally { c.close(); }
  });

  await t.test('SET follows commit and rollback, including an aborted transaction', async () => {
    const c = await open();
    try {
      await query(c, "SET application_name = 'outside'", 'I');
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['outside']]);
      await query(c, 'BEGIN', 'T');
      await query(c, "SET application_name = 'rolled_back'", 'T');
      assert.deepEqual((await query(c, 'SHOW application_name', 'T')).rows, [['rolled_back']]);
      await query(c, 'ROLLBACK', 'I');
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['outside']]);
      await query(c, 'BEGIN', 'T');
      await query(c, "SET application_name = 'committed'", 'T');
      await query(c, 'COMMIT', 'I');
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['committed']]);
      await query(c, 'BEGIN', 'T');
      await query(c, "SET application_name = 'aborted'", 'T');
      assert.match((await query(c, 'SELECT * FROM missing_table', 'E')).error!, /^42000 /);
      assert.deepEqual((await query(c, 'COMMIT', 'I')).tags, ['ROLLBACK']);
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['committed']]);
    } finally {
      c.close();
    }
  });

  await t.test('SET LOCAL is temporary and preserves a transaction SET on commit', async () => {
    const c = await open();
    try {
      await query(c, "SET application_name = 'outside'", 'I');
      await query(c, 'BEGIN', 'T');
      await query(c, "SET application_name = 'session'", 'T');
      await query(c, "SET LOCAL application_name = 'local'", 'T');
      assert.deepEqual((await query(c, 'SHOW application_name', 'T')).rows, [['local']]);
      await query(c, 'COMMIT', 'I');
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['session']]);
      await query(c, 'BEGIN', 'T');
      await query(c, "SET LOCAL application_name = 'temporary'", 'T');
      assert.deepEqual((await query(c, 'SHOW application_name', 'T')).rows, [['temporary']]);
      await query(c, 'ROLLBACK', 'I');
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['session']]);
      await query(c, 'BEGIN', 'T');
      await query(c, "SET LOCAL application_name = 'overridden'", 'T');
      await query(c, "SET application_name = 'last'", 'T');
      assert.deepEqual((await query(c, 'SHOW application_name', 'T')).rows, [['last']]);
      await query(c, 'COMMIT', 'I');
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['last']]);
      const outside = await query(c, "SET LOCAL application_name = 'ignored'", 'I');
      assert.deepEqual(outside.msgs.map((m) => m.type), ['N', 'C', 'Z']);
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['last']]);
    } finally {
      c.close();
    }
  });

  await t.test('transaction warnings are NoticeResponse before CommandComplete, only at execution', async () => {
    const c = await open();
    const fields = (body: Buffer) => Object.fromEntries(body.toString().split('\0').filter(Boolean).map((field) => [field[0], field.slice(1)]));
    const warning = (msgs: { type: string; body: Buffer }[], code: string, message: string, tag: string) => {
      assert.deepEqual(msgs.map((m) => m.type), ['N', 'C', 'Z']);
      assert.deepEqual(fields(msgs[0].body), { S: 'WARNING', V: 'WARNING', C: code, M: message });
      assert.equal(msgs[1].body.toString(), `${tag}\0`);
    };
    try {
      for (const sql of ['COMMIT', 'ROLLBACK']) {
        warning((await query(c, sql, 'I')).msgs, '25P01', 'there is no transaction in progress', sql);
      }
      await query(c, "SET application_name = 'before'", 'I');
      await query(c, 'BEGIN', 'T');
      await query(c, "SET application_name = 'in_transaction'", 'T');
      warning((await query(c, 'BEGIN', 'T')).msgs, '25001', 'there is already a transaction in progress', 'BEGIN');
      assert.deepEqual((await query(c, 'SHOW application_name', 'T')).rows, [['in_transaction']]);
      parse(c, 'START TRANSACTION');
      bind(c);
      assert.deepEqual((await sync(c, 'T')).map((m) => m.type), ['1', '2', 'Z']);
      execute(c);
      warning(await sync(c, 'T'), '25001', 'there is already a transaction in progress', 'BEGIN');
      await query(c, 'ROLLBACK', 'I');
      assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['before']]);
    } finally {
      c.close();
    }
  });

  await t.test('simple errors keep the transaction failed until ROLLBACK or COMMIT', async () => {
    const c = await open();
    try {
      assert.deepEqual((await query(c, 'SELECT 1', 'I')).rows, [['1']]);
      for (const end of ['ROLLBACK', 'COMMIT']) {
        assert.deepEqual((await query(c, 'BEGIN', 'T')).tags, ['BEGIN']);
        assert.deepEqual((await query(c, 'SELECT 1', 'T')).rows, [['1']]);
        assert.match((await query(c, 'SELECT * FROM missing_table', 'E')).error!, /^42000 /);
        for (const sql of ['SELECT 2', 'BEGIN', 'SET application_name = failed']) {
          const r = await query(c, sql, 'E');
          assert.match(r.error!, /^25P02 /);
          assert.deepEqual(r.rows, []);
        }
        assert.deepEqual((await query(c, end, 'I')).tags, ['ROLLBACK']);
        assert.deepEqual((await query(c, 'SELECT 3', 'I')).rows, [['3']]);
      }
      assert.match((await query(c, 'BEGIN; DELETE FROM missing_table; ROLLBACK', 'E')).error!, /^25006 /);
      await query(c, 'ROLLBACK', 'I');
      assert.match((await query(c, 'DELETE FROM missing_table', 'I')).error!, /^25006 /);
      assert.deepEqual((await query(c, 'SELECT 4', 'I')).rows, [['4']]);
    } finally {
      c.close();
    }
  });

  await t.test('savepoints, chaining and invalid exit suffixes cannot end a failed transaction', async () => {
    const c = await open();
    try {
      for (const sql of ['SAVEPOINT s', 'RELEASE SAVEPOINT s', 'ROLLBACK TO nonexistent', 'ROLLBACK WORK TO SAVEPOINT nonexistent']) {
        await query(c, 'BEGIN; DELETE FROM missing_table', 'E');
        assert.match((await query(c, sql, 'E')).error!, /^0A000 savepoints are not supported$/);
        assert.match((await query(c, 'SELECT 1', 'E')).error!, /^25P02 /);
        await query(c, 'ROLLBACK', 'I');
      }
      for (const sql of ['COMMIT AND CHAIN', 'ROLLBACK AND CHAIN', 'END WORK AND CHAIN']) {
        for (const failed of [false, true]) {
          await query(c, 'BEGIN', 'T');
          if (failed) await query(c, 'DELETE FROM missing_table', 'E');
          assert.match((await query(c, sql, 'E')).error!, /^0A000 transaction chaining is not supported$/);
          await query(c, 'ROLLBACK', 'I');
        }
      }
      for (const sql of ['COMMIT nonsense', 'END nonsense', 'ROLLBACK nonsense']) {
        await query(c, 'BEGIN; DELETE FROM missing_table', 'E');
        assert.match((await query(c, sql, 'E')).error!, /^42601 /);
        await query(c, 'ROLLBACK', 'I');
      }
      for (const sql of ['COMMIT WORK', 'END TRANSACTION', 'ROLLBACK WORK', 'COMMIT AND NO CHAIN', 'ROLLBACK TRANSACTION AND NO CHAIN']) {
        await query(c, 'BEGIN; DELETE FROM missing_table', 'E');
        assert.deepEqual((await query(c, sql, 'I')).tags, ['ROLLBACK']);
      }
      await query(c, 'BEGIN', 'T');
      parse(c, 'ROLLBACK TO nonexistent');
      assert.match(c.results(await sync(c, 'E')).error!, /^0A000 /);
      await query(c, 'ROLLBACK', 'I');
    } finally {
      c.close();
    }
  });

  await t.test('syntax errors anywhere in a simple query prevent every statement from running', async () => {
    const c = await open();
    try {
      await query(c, "SET application_name = 'before'", 'I');
      for (const invalid of ['SELCT 1', 'SELECT FROM', 'SELECT 1 +', "SELECT 'unterminated", 'SELECT 1 /* unterminated', 'COMMIT nonsense', 'END nonsense', 'ROLLBACK nonsense']) {
        const r = await query(c, `SET application_name = 'after'; BEGIN; ${invalid}`, 'I');
        assert.match(r.error!, /^42601 /, invalid);
        assert.deepEqual(r.tags, [], 'nothing before the syntax error executes');
        assert.deepEqual((await query(c, 'SHOW application_name', 'I')).rows, [['before']]);
      }
      const r = await query(c, 'BEGIN; SELCT 1', 'I');
      assert.match(r.error!, /^42601 /);
      assert.deepEqual(r.tags, []);
      // Name resolution and execution errors still occur after BEGIN executes.
      assert.deepEqual((await query(c, 'BEGIN; SELECT * FROM missing_table', 'E')).tags, ['BEGIN']);
      await query(c, 'ROLLBACK', 'I');
      await query(c, 'BEGIN', 'T');
      assert.match((await query(c, 'COMMIT; SELCT 1', 'E')).error!, /^42601 /);
      await query(c, 'ROLLBACK', 'I');
    } finally {
      c.close();
    }
  });

  await t.test('empty extended queries bind and execute with EmptyQueryResponse', async () => {
    const c = await open();
    try {
      for (const sql of ['', '  ', '; -- empty\n;', '/* empty */']) {
        parse(c, sql);
        bind(c);
        execute(c);
        assert.deepEqual((await sync(c, 'I')).map((m) => m.type), ['1', '2', 'I', 'Z']);
      }
      await query(c, 'BEGIN', 'T');
      parse(c, '');
      bind(c);
      c.send('D', Buffer.concat([Buffer.from('S'), cstr('')]));
      c.send('D', Buffer.concat([Buffer.from('P'), cstr('')]));
      execute(c);
      assert.deepEqual((await sync(c, 'T')).map((m) => m.type), ['1', '2', 't', 'n', 'n', 'I', 'Z']);
      await query(c, 'ROLLBACK', 'I');
    } finally {
      c.close();
    }
  });

  await t.test('Sync destroys implicit portals but preserves prepared statements', async () => {
    const c = await open();
    try {
      parse(c, 'BEGIN', 'kept');
      bind(c, 'kept');
      assert.deepEqual((await sync(c, 'I')).map((m) => m.type), ['1', '2', 'Z']);
      execute(c);
      const missing = await sync(c, 'I');
      assert.deepEqual(missing.map((m) => m.type), ['E', 'Z']);
      assert.match(c.results(missing).error!, /^34000 /);
      bind(c, 'kept');
      execute(c);
      assert.deepEqual(c.results(await sync(c, 'T')).tags, ['BEGIN']);
      // A portal in an explicit transaction survives Sync until COMMIT.
      parse(c, 'SELECT 1');
      bind(c);
      await sync(c, 'T');
      execute(c);
      assert.deepEqual(c.results(await sync(c, 'T')).rows, [['1']]);
      await query(c, 'COMMIT', 'I');
      execute(c);
      assert.match(c.results(await sync(c, 'I')).error!, /^34000 /);
    } finally {
      c.close();
    }
  });

  await t.test('Parse, Bind and Describe do not execute transaction commands', async () => {
    const c = await open();
    try {
      for (const [sql, before, after] of [['BEGIN', 'I', 'T'], ['COMMIT', 'T', 'I'], ['START TRANSACTION', 'I', 'T'], ['END', 'T', 'I']]) {
        await sync(c, before);
        parse(c, sql);
        bind(c);
        c.send('D', Buffer.concat([Buffer.from('S'), cstr('')]));
        c.send('D', Buffer.concat([Buffer.from('P'), cstr('')]));
        c.send('H');
        const described = [];
        for (let i = 0; i < 5; i++) described.push(await c.read());
        assert.deepEqual(described.map((m) => m.type), ['1', '2', 't', 'n', 'n']);
        execute(c);
        const executed = await sync(c, after);
        assert.deepEqual(c.results(executed).tags, [after === 'T' ? 'BEGIN' : 'COMMIT']);
      }
      for (const end of ['ROLLBACK', 'COMMIT']) {
        await query(c, 'BEGIN; DELETE FROM missing_table', 'E');
        parse(c, end);
        bind(c);
        await sync(c, 'E');
        execute(c);
        assert.deepEqual(c.results(await sync(c, 'I')).tags, ['ROLLBACK']);
      }
    } finally {
      c.close();
    }
  });

  for (const transaction of [false, true]) {
    for (const stage of ['Parse', 'Bind', 'Execute']) {
      await t.test(`${stage} error discards queries until Sync${transaction ? ' inside BEGIN' : ''}`, async () => {
        const c = await open();
        try {
          if (transaction) await query(c, 'BEGIN', 'T');
          if (stage === 'Parse') parse(c, 'SELECT * FROM missing_table');
          else if (stage === 'Bind') bind(c, 'missing_statement');
          else {
            parse(c, 'SELECT abs(-9223372036854775808)');
            bind(c);
            execute(c);
          }
          c.send('H');
          const failed = await c.until('E');
          assert.deepEqual(failed.map((m) => m.type), stage === 'Execute' ? ['1', '2', 'E'] : ['E']);
          assert.match(c.errorText(failed.at(-1)!.body), stage === 'Bind' ? /^26000 / : /^42000 /);
          // A simple query, including a transaction exit, cannot recover an extended error.
          c.send('Q', cstr('SELECT 42'));
          c.send('Q', cstr('ROLLBACK'));
          parse(c, 'SELECT 43');
          bind(c);
          execute(c);
          c.send('D', Buffer.concat([Buffer.from('P'), cstr('')]));
          c.send('C', Buffer.concat([Buffer.from('S'), cstr('')]));
          c.send('H');
          const recovered = await sync(c, transaction ? 'E' : 'I');
          assert.deepEqual(recovered.map((m) => m.type), ['Z'], 'no response or rows for discarded messages');
          if (transaction) {
            assert.match((await query(c, 'SELECT 44', 'E')).error!, /^25P02 /);
            await query(c, 'ROLLBACK', 'I');
          }
          assert.deepEqual((await query(c, 'SELECT 45', 'I')).rows, [['45']]);
        } finally {
          c.close();
        }
      });
    }
  }

  await t.test('54000 in Parse fails an explicit transaction', async () => {
    const c = await open();
    try {
      await query(c, 'BEGIN', 'T');
      for (let i = 0; i <= 1000; i++) parse(c, 'SELECT 1', `s${i}`);
      const msgs = await sync(c, 'E');
      assert.equal(msgs.filter((m) => m.type === '1').length, 1000);
      assert.match(c.results(msgs).error!, /^54000 /);
      assert.match((await query(c, 'SELECT 2', 'E')).error!, /^25P02 /);
      await query(c, 'ROLLBACK', 'I');
      assert.deepEqual((await query(c, 'SELECT 3', 'I')).rows, [['3']]);
    } finally {
      c.close();
    }
  });

  await t.test('prepared statements and cached portals cannot bypass a failed transaction', async () => {
    const c = await open();
    try {
      await query(c, 'BEGIN', 'T');
      parse(c, 'SELECT 1', 'kept');
      bind(c, 'kept');
      execute(c);
      assert.deepEqual(c.results(await sync(c, 'T')).rows, [['1']]);
      await query(c, 'DELETE FROM missing_table', 'E');
      for (const stage of ['Parse', 'Bind', 'Execute', 'Describe']) {
        if (stage === 'Parse') parse(c, 'SELECT 2');
        else if (stage === 'Bind') bind(c, 'kept');
        else if (stage === 'Execute') execute(c);
        else c.send('D', Buffer.concat([Buffer.from('P'), cstr('')]));
        c.send('H');
        const error = await c.read();
        assert.equal(error.type, 'E', stage);
        assert.match(c.errorText(error.body), /^25P02 /, stage);
        assert.deepEqual((await sync(c, 'E')).map((m) => m.type), ['Z']);
      }
      await query(c, 'ROLLBACK', 'I');
      assert.deepEqual((await query(c, 'SELECT 3', 'I')).rows, [['3']]);
    } finally {
      c.close();
    }
  });

  await t.test('Terminate is honored while discarding messages', async () => {
    const c = await open();
    try {
      bind(c, 'missing_statement');
      c.send('H');
      assert.equal((await c.read()).type, 'E');
      const ended = new Promise<void>((resolve) => c.socket.once('end', resolve));
      c.send('X');
      await ended;
    } finally {
      c.socket.destroy();
    }
  });
});

test('native scalar fields have PostgreSQL type OIDs and numeric decimal SQL behavior', { skip }, async () => {
  const c = await Client.open({ user: 'Ann', password: 'pw', database: 'Native' });
  try {
    const r = await c.query('SELECT Flag, Count, Price, Payload, Key FROM "Values" WHERE Price > 10 ORDER BY Price');
    assert.equal(r.error, undefined);
    assert.deepEqual(r.oids, [16, 20, 1700, 3802, 2950]);
    assert.deepEqual(r.rows, [['t', '-12', String(Number('900719925474099312345.01')), '{"x":1}', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']]);
    assert.deepEqual((await c.query('SELECT Price FROM "Values" ORDER BY Price')).rows, [['9'], [String(Number('900719925474099312345.01'))]]);
  } finally { c.close(); }
});

test('simple queries: FileMaker SQL by table occurrence, types, several statements, session commands', { skip }, async () => {
  const c = await Client.open({ user: 'Ann', password: 'pw', database: 'Charts' });
  try {
    const r = await c.query(`SELECT "Name", "Party" FROM "Congress" ORDER BY "Name" FETCH FIRST 2 ROWS ONLY`);
    assert.deepEqual(r.columns, ['Name', 'Party']);
    assert.equal(r.rows.length, 2);
    assert.deepEqual(r.tags, ['SELECT 2']);
    const n = await c.query('SELECT count(*) AS n, 1.5 AS x, NULL AS blank FROM Congress');
    assert.deepEqual(n.rows, [['540', '1.5', null]]);
    assert.equal(n.oids[0], 1700);
    const many = await c.query(`SET client_encoding = 'UTF8'; BEGIN; SELECT 'a;b' AS s; SHOW client_encoding; COMMIT`);
    assert.deepEqual(many.tags, ['SET', 'BEGIN', 'SELECT 1', 'SHOW', 'COMMIT']);
    assert.deepEqual(many.rows, [['a;b'], ['UTF8']]);
    assert.deepEqual((await c.query('SELECT current_database() AS db')).rows, [['Charts']]);
    // The connection counts toward Ann's SQL usage, so least privilege can tell whether fmxdbc is used.
    assert.ok((charts.accountUsage(1).accounts.find((a) => a.account.toLowerCase() === 'ann')?.bySurface.sql ?? 0) >= 1);
    // Read-only, and errors don't end the connection.
    assert.match((await c.query('DELETE FROM Congress')).error!, /^25006 /);
    assert.match((await c.query('UPDATE Congress SET Name = 1')).error!, /^25006 /);
    assert.match((await c.query('SELECT * FROM missing_table')).error!, /^42000 /);
    assert.equal((await c.query('SELECT 1 AS ok')).rows[0][0], '1');
    // FileMaker's system tables work too.
    assert.ok((await c.query(`SELECT TableName FROM FileMaker_Tables`)).rows.some((row) => row[0] === 'Congress'));
  } finally {
    c.close();
  }
});

test('extended queries: parameters, describe, row limits, statements kept', { skip }, async () => {
  const c = await Client.open({ user: 'Ann', password: 'pw', database: 'Charts' });
  try {
    // Parse a named statement with $1, describe it, then run it twice with different values.
    c.send('P', Buffer.concat([cstr('byParty'), cstr(`SELECT "Name" FROM "Congress" WHERE "Party" = $1 ORDER BY "Name"`), i16(0)]));
    c.send('D', Buffer.concat([Buffer.from('S'), cstr('byParty')]));
    c.send('S');
    const described = await c.until('Z');
    assert.deepEqual(described.map((m) => m.type), ['1', 't', 'T', 'Z']);
    assert.equal(described[1].body.readInt16BE(0), 1);
    const run = async (party: string, max: number) => {
      c.send('B', Buffer.concat([cstr(''), cstr('byParty'), i16(0), i16(1), i32(Buffer.byteLength(party)), Buffer.from(party), i16(0)]));
      c.send('D', Buffer.concat([Buffer.from('P'), cstr('')]));
      c.send('E', Buffer.concat([cstr(''), i32(max)]));
      c.send('S');
      return c.results(await c.until('Z'));
    };
    const d = await run('D', 0);
    assert.deepEqual(d.columns, ['Name']);
    assert.ok(d.rows.length > 100);
    assert.deepEqual(d.tags, [`SELECT ${d.rows.length}`]);
    const r = await run('R', 5);
    assert.equal(r.rows.length, 5);
    assert.deepEqual(r.tags, ['(suspended)']);
    // A bad statement, then a NULL parameter: the error skips to Sync and the connection carries on.
    c.send('P', Buffer.concat([cstr(''), cstr('SELECT nope FROM nowhere'), i16(0)]));
    c.send('B', Buffer.concat([cstr(''), cstr(''), i16(0), i16(0), i16(0)]));
    c.send('E', Buffer.concat([cstr(''), i32(0)]));
    c.send('S');
    const bad = await c.until('Z');
    // Fails at Parse, as in PostgreSQL; Bind and Execute are skipped.
    assert.deepEqual(bad.map((m) => m.type), ['E', 'Z']);
    c.send('P', Buffer.concat([cstr(''), cstr('SELECT $1 AS v'), i16(1), i32(23)]));
    c.send('B', Buffer.concat([cstr(''), cstr(''), i16(0), i16(1), i32(-1), i16(0)]));
    c.send('E', Buffer.concat([cstr(''), i32(0)]));
    c.send('S');
    assert.deepEqual(c.results(await c.until('Z')).rows, [[null]]);
  } finally {
    c.close();
  }
});

test('an established pgwire connection cannot inherit a recreated account or its saved portal', { skip }, async () => {
  const full = charts.privilegeSets().find((p) => p.id === 1)!;
  charts.setPassword('Recreated', 'pw', full.name);
  const c = await Client.open({ user: 'Recreated', password: 'pw', database: 'Charts' });
  try {
    await c.query('BEGIN'); // Sync keeps portals inside an explicit transaction.
    c.send('P', Buffer.concat([cstr('after-recreate'), cstr('SELECT 1 UNION ALL SELECT 2'), i16(0)]));
    c.send('B', Buffer.concat([cstr('revoked-portal'), cstr('after-recreate'), i16(0), i16(0), i16(0)]));
    c.send('E', Buffer.concat([cstr('revoked-portal'), i32(1)]));
    c.send('S');
    const first = c.results(await c.until('Z'));
    assert.deepEqual(first.rows, [['1']]);
    assert.ok(first.tags.includes('(suspended)'));

    assert.equal(charts.deleteAccount('Recreated'), true);
    charts.setPassword('Recreated', 'new-pw', full.name);
    c.send('E', Buffer.concat([cstr('revoked-portal'), i32(1)]));
    c.send('S');
    const denied = c.results(await c.until('Z'));
    assert.match(denied.error!, /^28000 account identity has changed/);
    assert.deepEqual(denied.rows, []);
    await c.query('ROLLBACK');
    assert.match((await c.query('SELECT 3')).error!, /^28000 /);
  } finally {
    c.close();
    charts.deleteAccount('Recreated');
  }
});

test('numeric binary form: round trips, signs, scales, exponents', () => {
  for (const t of ['0', '1', '-1', '12345.678', '-0.0001', '10000', '93.3', '0.5', '123456789012.000100', '-99999999.99']) {
    assert.equal(decodeNumeric(encodeNumeric(t)), t, t);
  }
  assert.equal(decimalText(1.5e-7), '0.00000015');
  assert.equal(decimalText(1e21), '1000000000000000000000');
  assert.equal(decimalText('$3750'), undefined);
  // 12345.678: 2 digit groups before the point (1, 2345), weight 1, scale 3.
  const b = encodeNumeric('12345.678');
  assert.deepEqual([b.readInt16BE(0), b.readInt16BE(2), b.readUInt16BE(4), b.readInt16BE(6)], [3, 1, 0, 3]);
  assert.deepEqual([b.readInt16BE(8), b.readInt16BE(10), b.readInt16BE(12)], [1, 2345, 6780]);
});

test('binary parameters read as their text form would, and casts name parameter types', () => {
  const i32b = Buffer.alloc(4);
  i32b.writeInt32BE(-7);
  assert.equal(binaryParam(i32b, 23), -7);
  const date = Buffer.alloc(4);
  date.writeInt32BE(8834); // days after 2000-01-01
  assert.equal(binaryParam(date, 1082), '2024-03-09');
  const ts = Buffer.alloc(8);
  ts.writeBigInt64BE(763_259_400_500_000n);
  assert.equal(binaryParam(ts, 1114), '2024-03-09 00:30:00.5');
  assert.equal(binaryParam(encodeNumeric('-2.50'), 1700), -2.5);
  assert.equal(binaryParam(Buffer.from('hé'), 25), 'hé');
  assert.equal(binaryParam(Buffer.alloc(16), 2950), '00000000-0000-0000-0000-000000000000', 'a uuid is read as its text');
  assert.equal(binaryParam(Buffer.alloc(16), 600), undefined, 'a point is not read');
  assert.deepEqual([...castParamTypes('SELECT * FROM t WHERE a < $1::numeric AND b = $2 :: date AND c = $3::double precision')], [[1, 1700], [2, 1082], [3, 701]]);
});

test('extended queries in the binary format, as asyncpg and Npgsql ask', { skip }, async () => {
  const c = await Client.open({ user: 'Ann', password: 'pw', database: 'Charts' });
  try {
    c.send('P', Buffer.concat([cstr('top'), cstr('SELECT "Name", "Liberal_Rank" FROM "Congress" WHERE "Liberal_Rank" <= $1::int4 ORDER BY "Liberal_Rank", "Name" LIMIT 2'), i16(0)]));
    c.send('D', Buffer.concat([Buffer.from('S'), cstr('top')]));
    c.send('S');
    const described = await c.until('Z');
    const t = described.find((m) => m.type === 't')!;
    assert.equal(t.body.readInt32BE(2), 23, 'the cast names the parameter\'s type');
    // $1 as a binary int4; every result column binary.
    const one = Buffer.alloc(4);
    one.writeInt32BE(1);
    c.send('B', Buffer.concat([cstr(''), cstr('top'), i16(1), i16(1), i16(1), i32(4), one, i16(1), i16(1)]));
    c.send('D', Buffer.concat([Buffer.from('P'), cstr('')]));
    c.send('E', Buffer.concat([cstr(''), i32(0)]));
    c.send('S');
    const msgs = await c.until('Z');
    const desc = msgs.find((m) => m.type === 'T')!;
    const nameEnd = desc.body.indexOf(0, 2);
    assert.equal(desc.body.readInt16BE(nameEnd + 17), 1, 'the row description says binary');
    const rows = msgs.filter((m) => m.type === 'D').map((m) => {
      let pos = 2;
      return Array.from({ length: m.body.readInt16BE(0) }, () => {
        const len = m.body.readInt32BE(pos);
        const v = m.body.subarray(pos + 4, pos + 4 + len);
        pos += 4 + Math.max(len, 0);
        return v;
      });
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0][0].toString(), 'Barbara Lee', 'text is UTF-8 in either format');
    assert.equal(decodeNumeric(rows[0][1]), '1', 'numbers are numeric\'s binary form');
    // An unknown binary parameter type is refused and the connection carries on.
    c.send('P', Buffer.concat([cstr(''), cstr('SELECT $1 AS v'), i16(1), i32(600)]));
    c.send('B', Buffer.concat([cstr(''), cstr(''), i16(1), i16(1), i16(1), i32(16), Buffer.alloc(16), i16(0)]));
    c.send('E', Buffer.concat([cstr(''), i32(0)]));
    c.send('S');
    assert.match(c.results(await c.until('Z')).error ?? '', /^0A000 binary parameters of type 600/);
    assert.deepEqual((await c.query('SELECT 1 AS ok')).rows, [['1']]);
  } finally {
    c.close();
  }
});

test('asyncpg connects and queries', { skip: skip || (asyncpg ? false : 'python asyncpg is not installed') }, async () => {
  const script = `
import asyncio, asyncpg, decimal, sys
async def main():
    c = await asyncpg.connect(host='127.0.0.1', port=int(sys.argv[1]), user='Ann', password='pw', database='Charts', ssl=False)
    rows = await c.fetch('SELECT "Name", "Liberal_Rank" FROM "Congress" WHERE "Party" = $1 AND "Liberal_Rank" < $2::numeric ORDER BY "Name" LIMIT 2', 'D', decimal.Decimal('3'))
    print('|'.join(f"{r['Name']}={r['Liberal_Rank']!r}" for r in rows))
    await c.close()
asyncio.run(main())`;
  const { stdout } = await promisify(execFile)('python3', ['-c', script, String(sqlPort)], { timeout: 30_000 });
  assert.match(stdout.trim(), /^[^=|]+=Decimal\('\d+'\)\|[^=|]+=Decimal\('\d+'\)$/);
});

test('blocking new users refuses new connections; one already open carries on', { skip }, async () => {
  const open = await Client.open({ user: 'Ann', password: 'pw', database: 'Charts' });
  host.config.setBlockNewUsers(true);
  try {
    await assert.rejects(Client.open({ user: 'Ann', password: 'pw', database: 'Charts' }), /57P03 the server isn't accepting new users/);
    // Refused before the password is checked: a wrong one gets the same answer, so it tells a guesser nothing.
    await assert.rejects(Client.open({ user: 'Ann', password: 'wrong', database: 'Charts' }), /57P03 /);
    assert.deepEqual((await open.query('SELECT 1 AS one')).rows, [['1']]);
  } finally {
    host.config.setBlockNewUsers(false);
    open.close();
  }
  const again = await Client.open({ user: 'Ann', password: 'pw', database: 'Charts' });
  again.close();
});

test('sign-in: wrong password, no fmxdbc, unknown file; TLS, and none off this machine without it', { skip }, async () => {
  await assert.rejects(Client.open({ user: 'Ann', password: 'wrong', database: 'Charts' }), /28P01 password authentication failed/);
  await assert.rejects(Client.open({ user: 'Val', password: 'pw', database: 'Charts' }), /42501 .*fmxdbc/);
  // A file that isn't hosted is refused like a wrong password (the server lists no files), so the name isn't confirmed.
  const wrong = await Client.open({ user: 'Ann', password: 'wrong', database: 'Charts' }).then(() => '', (e: Error) => e.message);
  const nope = await Client.open({ user: 'Ann', password: 'wrong', database: 'Nope' }).then(() => '', (e: Error) => e.message);
  assert.match(nope, /28P01 password authentication failed for user "Ann"/);
  assert.equal(nope, wrong);
  if (openssl) {
    const c = await Client.open({ user: 'Ann', password: 'pw', database: 'Charts', ssl: true });
    assert.deepEqual((await c.query('SELECT 2 AS two')).rows, [['2']]);
    c.close();
  }
  const outside = Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
  // From the network (where this machine has such an address and can reach itself on it).
  if (outside) {
    // A sandbox may route that address elsewhere: no answer in time counts as unreachable.
    let timer: NodeJS.Timeout | undefined;
    const err = await Promise.race([
      Client.open({ user: 'Ann', password: 'pw', database: 'Charts', host: outside }).then(() => undefined, (e: Error) => e.message),
      new Promise<string>((r) => (timer = setTimeout(() => r('unreachable'), 3000))),
    ]);
    clearTimeout(timer);
    if (err !== 'unreachable') assert.match(err ?? 'connected', /28000 connect with TLS/);
  }
});

test('password sign-in refuses TOTP and owed password changes; accounts without TOTP still work', { skip }, async () => {
  const noTotp = await Client.open({ user: 'Ann', password: 'pw', database: 'Charts' });
  noTotp.close();
  await assert.rejects(Client.open({ user: 'TwoFactorPG', password: 'pw', database: 'Charts' }), /28P01 .*does not support one-time codes/);
  await assert.rejects(Client.open({ user: 'ForcedPG', password: 'pw', database: 'Charts' }), /28000 .*must change its password/);
});

test('psql connects and queries', { skip: skip || (psql ? false : 'psql is not installed') }, async () => {
  // Not spawnSync: the server answering it runs in this process.
  const { stdout } = await promisify(execFile)('psql', [`host=127.0.0.1 port=${sqlPort} dbname=Charts user=Ann`, '-At', '-c', 'SELECT count(*) FROM Congress', '-c', `SELECT "Name" FROM "Congress" WHERE "Name" LIKE 'Al%' ORDER BY 1 FETCH FIRST 1 ROWS ONLY`], { env: { ...process.env, PGPASSWORD: 'pw' }, timeout: 20_000 });
  assert.deepEqual(stdout.trim().split('\n'), ['540', 'AL Green']);
  // psql's \dt and \d read the catalog; names are found in any case, as FileMaker's are.
  const run = (cmd: string) => promisify(execFile)('psql', [`host=127.0.0.1 port=${sqlPort} dbname=Charts user=Ann`, '-At', '-c', cmd], { env: { ...process.env, PGPASSWORD: 'pw' }, timeout: 20_000 });
  assert.ok((await run('\\dt')).stdout.split('\n').includes('public|NW Customers|table|Ann'));
  assert.deepEqual((await run('\\d grades')).stdout.trim().split('\n'), ['Name|text|||', 'GPA|numeric|||', 'Study Hours per Week|numeric|||']);
  assert.match((await run('\\l')).stdout, /^Charts\|Ann\|UTF8/);
});

test('PostgreSQL syntax as SQLite reads it', () => {
  const pg = (sql: string) => pgSyntax(sql).replace(/\s+/g, ' ').trim();
  assert.equal(pg(`SELECT c.oid::pg_catalog.regclass, 'a::b' FROM pg_catalog.pg_class c WHERE c.relname OPERATOR(pg_catalog.~) '^(x)$' COLLATE pg_catalog.default`),
    `SELECT c.oid, 'a::b' FROM pg_class c WHERE c.relname REGEXP '^(x)$'`);
  assert.equal(pg(`SELECT "public"."T"."a" FROM public."T", pg_class WHERE n !~ '^pg_' AND k = ANY (ARRAY['r','p']) AND x ILIKE 'a%'`),
    `SELECT "T"."a" FROM "T", pg_class WHERE n NOT REGEXP '^pg_' AND k IN ('r','p') AND x LIKE 'a%'`);
  assert.equal(pg(`SELECT table_name FROM information_schema.tables`), `SELECT table_name FROM information_schema__tables`);
  assert.equal(pg(`SELECT array_to_string(d.datacl, E'\\n'), trim(both '"' from x), a[1] FROM unnest(t.o) u, pg_class`),
    `SELECT array_to_string(d.datacl, ' '), trim(x, '"'), a FROM (SELECT value AS u FROM json_each(t.o)) AS u, pg_class`);
  assert.equal(pgSyntax(`SELECT E'a\\nb', 'c\\n'`), `SELECT 'a\nb', 'c\\n'`);
  assert.equal(pg(`SELECT n FROM generate_series(1, 3) s(n) JOIN pg_class ON true`), `SELECT n FROM (WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 3) SELECT n FROM s) AS s JOIN pg_class ON true`);
});

test('the catalog: tables and columns for BI tools and JDBC metadata', { skip }, async () => {
  const c = await Client.open({ user: 'Ann', password: 'pw', database: 'Charts' });
  try {
    // JDBC's getTables, in short.
    const tables = await c.query(`SELECT NULL AS TABLE_CAT, n.nspname AS TABLE_SCHEM, c.relname AS TABLE_NAME, CASE n.nspname ~ '^pg_' OR n.nspname = 'information_schema' WHEN true THEN 'SYSTEM TABLE' WHEN false THEN CASE c.relkind WHEN 'r' THEN 'TABLE' END END AS TABLE_TYPE, d.description AS REMARKS
      FROM pg_catalog.pg_namespace n, pg_catalog.pg_class c LEFT JOIN pg_catalog.pg_description d ON (c.oid = d.objoid AND d.objsubid = 0 and d.classoid = 'pg_class'::regclass)
      WHERE c.relnamespace = n.oid AND c.relname LIKE 'NW%' AND (false OR (c.relkind IN ('r','p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')) ORDER BY TABLE_TYPE,TABLE_SCHEM,TABLE_NAME`);
    assert.equal(tables.error, undefined);
    assert.deepEqual(tables.rows.map((r) => r.slice(1, 4)), [['public', 'NW Customers', 'TABLE'], ['public', 'NW Line Items', 'TABLE'], ['public', 'NW Salespeople', 'TABLE'], ['public', 'NW SalespersonCustomers', 'TABLE']]);
    // Columns, typed as query results are, with booleans as t and f.
    const cols = await c.query(`SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attnum FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
      WHERE c.relname = 'nw customers' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`);
    assert.deepEqual(cols.rows, [['Customer', 'text', 'f', '1'], ['Total Sales', 'numeric', 'f', '2']]);
    assert.equal(cols.oids[2], 16);
    // The SQL standard's views.
    const info = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Grades' ORDER BY ordinal_position`);
    assert.deepEqual(info.rows, [['Name', 'text'], ['GPA', 'numeric'], ['Study Hours per Week', 'numeric']]);
    const listed = await c.query(`SELECT count(*) FROM information_schema.tables WHERE table_type = 'BASE TABLE'`);
    assert.deepEqual(listed.rows, [['10']]);
    // Queries name tables with their schema, as BI tools write them.
    const data = await c.query(`SELECT "public"."Grades"."Name" AS "Name" FROM "public"."Grades" ORDER BY "public"."Grades"."Name" LIMIT 1`);
    assert.equal(data.error, undefined);
    assert.equal(data.rows.length, 1);
    // A query with its own WITH clause gets the catalog's too.
    const own = await c.query(`WITH names AS (SELECT relname FROM pg_class) SELECT count(*) FROM names`);
    assert.deepEqual(own.rows, [['10']]);
    // A pattern that could backtrack without end is refused at once, not run; the connection carries on.
    const stalled = await c.query(`SELECT count(*) FROM pg_catalog.pg_namespace n WHERE n.nspname ~ '(a+)+$'`);
    assert.match(stalled.error ?? '', /could take forever/);
    // Thousands of nested groups would abort the whole server inside V8's regex compiler.
    const deep = await c.query(`SELECT count(*) FROM pg_catalog.pg_namespace n WHERE n.nspname ~ '${'(?<=a'.repeat(4000)}${')'.repeat(4000)}'`);
    assert.match(deep.error ?? '', /nested more than 250 deep/);
    assert.deepEqual((await c.query(`SELECT 1`)).rows, [['1']]);
    // Settings drivers read, and catalog functions.
    const set = await c.query(`SELECT setting FROM pg_catalog.pg_settings WHERE name = 'max_index_keys'`);
    assert.deepEqual(set.rows, [['32']]);
    const fns = await c.query(`SELECT current_setting('server_version_num'), pg_catalog.pg_get_userbyid(10), pg_catalog.pg_table_is_visible(1)`);
    assert.deepEqual(fns.rows, [['140000', 'Ann', '1']]);
    const arrays = await c.query(`SELECT
      array_length(NULL, 1), array_length('{}', 1), array_length('{one}', 1),
      array_length('{"a,b"}', 1), array_length('{"a,b",c}', 1),
      array_length('{"a\\"b"}', 1), array_length('{one}', 2),
      array_upper('{"a,b",c}', 1), array_upper('{one}', 2), array_to_string('{"a,b",c}', '|'),
      array_to_string('{"a\\"b"}', '|')`);
    assert.deepEqual(arrays.rows, [[null, null, '1', '1', '2', '1', null, '2', null, 'a,b|c', 'a"b']]);
    // psql 17's \l query uses this long-standing ACL formatter on servers before PostgreSQL 15.
    const databases = await c.query(`SELECT
      d.datname as "Name",
      pg_catalog.pg_get_userbyid(d.datdba) as "Owner",
      pg_catalog.pg_encoding_to_char(d.encoding) as "Encoding",
      'libc' AS "Locale Provider",
      d.datcollate as "Collate",
      d.datctype as "Ctype",
      NULL as "Locale",
      NULL as "ICU Rules",
      CASE WHEN pg_catalog.array_length(d.datacl, 1) = 0 THEN '(none)'
        ELSE pg_catalog.array_to_string(d.datacl, E'\\n') END AS "Access privileges"
      FROM pg_catalog.pg_database d ORDER BY 1;`);
    assert.deepEqual(databases.rows, [['Charts', 'Ann', 'UTF8', 'libc', 'C', 'C', null, null, null]]);
  } finally {
    c.close();
  }
});

test('patterns that could backtrack without end are told from the ones catalogs use', () => {
  for (const p of ['(a+)+$', '(a*)*', '(a|aa)+', '(\\w+\\s?)+$', '((ab)*c)*', '(a)\\1', '(?<x>a)\\k<x>', '(x(a|b))+']) assert.equal(riskyPattern(p), true, p);
  for (const p of ['^(congress)$', '^pg_', '^(.*)$', '^(public|pg_catalog)$', '(a|b)?c', 'a+b*', '[(+)]+', '\\(a+\\)+', '^(nw customers)$']) assert.equal(riskyPattern(p), false, p);
});

test('a connection holds a limited number of prepared statements', { skip }, async () => {
  const c = await Client.open({ user: 'Ann', password: 'pw', database: 'Charts' });
  try {
    for (let i = 0; i < 1000; i++) c.send('P', Buffer.concat([cstr(`s${i}`), cstr('SELECT 1 AS one'), i16(0)]));
    c.send('P', Buffer.concat([cstr('one-too-many'), cstr('SELECT 1 AS one'), i16(0)]));
    c.send('S');
    const msgs = await c.until('Z');
    const error = msgs.find((m) => m.type === 'E');
    assert.ok(error, 'the 1001st is refused');
    assert.match(error.body.toString(), /54000/);
    assert.equal(msgs.filter((m) => m.type === '1').length, 1000);
  } finally {
    c.close();
  }
});

test('a start-up message with a very long user name is refused', { skip }, async () => {
  await assert.rejects(Client.open({ user: 'a'.repeat(300), password: 'pw', database: 'Charts' }), /too long/);
});

test('one network may have only so many connections waiting to sign in', { skip }, async () => {
  const { PgServer } = await import('../src/pgwire.ts');
  const pg = new PgServer(host, { port: 0 });
  let held = 0;
  while (pg.holdUnsigned('203.0.113.0') && held < 100) held++;
  assert.equal(held, 50);
  assert.equal(pg.holdUnsigned('198.51.100.0'), true, 'another network is not affected');
  pg.releaseUnsigned('203.0.113.0');
  assert.equal(pg.holdUnsigned('203.0.113.0'), true, 'a released place can be taken again');
});

for (const revoke of ['fmxdbc', 'read-all', 'inactive'] as const) test(`open SQL connections reject ${revoke} revocation, including cached portal rows`, { timeout: 30_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-revoke-'));
  const path = join(dir, 'Revocation.openhbam.sqlite');
  createStore(path);
  const localHost = new Host(dir);
  const store = localHost.get('Revocation')!;
  const definition = { name: 'SQL Readers', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly' as const, valueLists: 'viewOnly' as const, scripts: 'none' as const, extendedPrivileges: ['fmxdbc'] };
  store.savePrivilegeSet(definition);
  store.setPassword('Reader', 'pw', definition.name);
  const pg = new PgServer(localHost, { port: 0 });
  const peer = new Store(path);
  t.after(async () => { pg.close(); peer.close(); await localHost.close(); rmSync(dir, { recursive: true, force: true }); });
  const port = await pg.listen();
  const c = await Client.open({ user: 'Reader', password: 'pw', database: 'Revocation', port });
  t.after(() => c.close());
  const query = async (sql: string) => { c.send('Q', cstr(sql)); return c.results(await c.until('Z')); };
  assert.deepEqual((await query('SELECT 1')).rows, [['1']]);
  await query('BEGIN');
  c.send('P', Buffer.concat([cstr('rows'), cstr('SELECT 1 UNION ALL SELECT 2'), i16(0)]));
  c.send('B', Buffer.concat([cstr('held'), cstr('rows'), i16(0), i16(0), i16(0)]));
  c.send('E', Buffer.concat([cstr('held'), i32(1)]));
  c.send('S');
  const first = c.results(await c.until('Z'));
  assert.deepEqual(first.rows, [['1']]);
  assert.ok(first.tags.includes('(suspended)'));
  if (revoke === 'inactive') peer.sql.exec("UPDATE _fm_accounts SET inactive = 1 WHERE name = 'Reader'");
  else peer.savePrivilegeSet({ ...definition, ...(revoke === 'fmxdbc' ? { extendedPrivileges: [] } : { records: { ...definition.records, view: false } }) });
  c.send('E', Buffer.concat([cstr('held'), i32(1)]));
  c.send('S');
  const denied = c.results(await c.until('Z'));
  assert.match(denied.error!, /^(42501|28000) /);
  assert.deepEqual(denied.rows, []);
  await query('ROLLBACK');
  const simple = await query('SELECT 3');
  assert.match(simple.error!, /^(42501|28000) /);
  assert.deepEqual(simple.rows, []);
  c.send('P', Buffer.concat([cstr('new'), cstr('SELECT 4'), i16(0)]));
  c.send('S');
  assert.match(c.results(await c.until('Z')).error!, /^(42501|28000) /);
});
