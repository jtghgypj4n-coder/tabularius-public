// Sign-in through an identity provider, against a stand-in OpenID Connect provider.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, chownSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { assertSameOidcFile, oidcHostDirectoryWarning, Oidc, type Resume } from '../src/oidc.ts';
import { DataApi } from '../src/dataapi.ts';
import { Host } from '../src/host.ts';
import { serve } from '../src/index.ts';
import type { Store } from '../../store/src/index.ts';
import { expiryClock, ExpiryClock } from '../../store/src/clock.ts';

// The remote identity provider has its own clock, independent of host-clock tests.
const providerNow = Date.now;

// Each test has an independent startup reference; simulated jumps must not leak to the next test.
beforeEach((t) => {
  const clock = new ExpiryClock();
  assert.ok('mock' in t, 'this top-level hook runs for tests');
  t.mock.method(expiryClock, 'now', () => clock.now());
});

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let idp: Server;
let base: string;
let issuer: string;
let store: Store;
let host: Host;
let secondary: Server;
let secondaryBase: string;
let secondOidc: Oidc;

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
/** What the provider says about the next person to sign in. */
let person: Record<string, unknown> = {};
let signWith = privateKey;
const codes = new Map<string, { nonce: string; challenge: string }>();
let tokenRequests = 0;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function idToken(claims: Record<string, unknown>): string {
  const head = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64(claims)}`;
  return `${head}.${sign('sha256', Buffer.from(head), signWith).toString('base64url')}`;
}

before(async () => {
  if (skip) return;
  idp = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    const send = (body: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/.well-known/openid-configuration') {
      send({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    } else if (url.pathname === '/jwks') {
      send({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
    } else if (url.pathname === '/token') {
      tokenRequests++;
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      const c = codes.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      if (!c || createHash('sha256').update(verifier).digest('base64url') !== c.challenge || form.get('client_id') !== 'tabularius') {
        send({ error: 'invalid_grant' }, 400);
        return;
      }
      const now = Math.floor(providerNow() / 1000);
      send({ id_token: idToken({ iss: issuer, aud: 'tabularius', sub: 'u1', exp: now + 300, iat: now, nonce: c.nonce, ...person }) });
    } else send({ error: 'not found' }, 404);
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;

  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  chmodSync(dir, 0o755); // Same mode as the CLI's recursive mkdir under the usual umask.
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, oidc: { name: 'Test IdP', issuer, clientId: 'tabularius' } });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  host = s.host;
  store.setExternalAccount('Staff', store.privilegeSets().find((p) => p.id === 1)!.name);
  store.setExternalAccount('pat@example.com', '[Read-Only Access]');
  const ro = store.privilegeSet('[Read-Only Access]')!;
  store.savePrivilegeSet({ ...ro, extendedPrivileges: [...ro.extendedPrivileges, 'fmapp'] });
  secondOidc = new Oidc(s.host, new DataApi(s.host), { name: 'Test IdP', issuer, clientId: 'tabularius' });
  secondary = createServer((req, res) => { void secondOidc.handle(req, res, new URL(req.url!, 'http://localhost')); });
  await new Promise<void>((r) => secondary.listen(0, '127.0.0.1', r));
  secondaryBase = `http://127.0.0.1:${(secondary.address() as { port: number }).port}`;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await new Promise<void>((r) => (secondary ? secondary.close(() => r()) : r()));
  idp?.close();
  if (dir) rmSync(dir, { recursive: true });
});

/** Goes through the whole sign-in; returns where the server sends the browser back to. */
async function signIn(): Promise<URLSearchParams> {
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start?db=Charts`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('location')!);
  assert.equal(auth.origin + auth.pathname, `${issuer}/authorize`);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const code = Math.random().toString(36).slice(2);
  codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
  const back = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=${code}&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
  assert.equal(back.status, 302);
  const to = back.headers.get('location')!;
  assert.ok(to.startsWith('/app/#'), to);
  return new URLSearchParams(to.slice('/app/#'.length));
}

const layouts = (token: string) => fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());

test('identity provider sign-in: a group gives its external account\'s privilege set', { skip }, async () => {
  const providers = await fetch(`${base}/tabularius/auth/v1/providers`).then((r) => r.json());
  assert.deepEqual(providers.providers.map((p: { name: string }) => p.name), ['Test IdP']);

  person = { email: 'sam@example.com', email_verified: true, groups: ['Interns', 'Staff'] };
  const ok = await signIn();
  assert.equal(ok.get('db'), 'Charts');
  const r = await layouts(ok.get('token')!);
  assert.equal(r.messages[0].code, '0');
});

test('pending sign-in is shared between handlers, single-use and expires', { skip }, async () => {
  person = { email: 'sam@example.com', email_verified: true, groups: ['Staff'] };
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start?db=Charts`, { redirect: 'manual' });
  const auth = new URL(start.headers.get('location')!);
  const code = Math.random().toString(36).slice(2);
  codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
  const callback = () => fetch(`${secondaryBase}/tabularius/auth/v1/oidc/callback?code=${code}&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
  const done = await callback();
  assert.match(done.headers.get('location')!, /#db=Charts&token=/);
  const replay = await callback();
  assert.match(decodeURIComponent(replay.headers.get('location')!), /already used/);

  const expiredStart = await fetch(`${base}/tabularius/auth/v1/oidc/start?db=Charts`, { redirect: 'manual' });
  const expiredAuth = new URL(expiredStart.headers.get('location')!);
  const db = new DatabaseSync(join(dir, '.openhbam-oidc', 'pending.sqlite'));
  db.prepare('UPDATE pending SET expires = 0 WHERE state = ?').run(expiredAuth.searchParams.get('state'));
  const expired = await fetch(`${secondaryBase}/tabularius/auth/v1/oidc/callback?code=x&state=${expiredAuth.searchParams.get('state')}`, { redirect: 'manual' });
  assert.match(decodeURIComponent(expired.headers.get('location')!), /took too long/);
  db.close();
});

test('a Data API app\'s sign-in is shared between handlers: started on one, finished on another, taken once by a third', { skip }, async () => {
  person = { email: 'sam@example.com', email_verified: true, groups: ['Staff'] };
  const start = await fetch(`${secondaryBase}/oauth/getoauthurl?trackingID=t1&provider=test-idp`, { headers: { 'x-fms-return-url': `${secondaryBase}/done` } });
  assert.equal(start.status, 200, await start.clone().text());
  const requestId = start.headers.get('x-fms-request-id')!;
  const auth = new URL(start.headers.get('x-fms-return-url')!);
  const code = Math.random().toString(36).slice(2);
  codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
  const back = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=${code}&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
  assert.equal(back.status, 302);
  const to = new URL(back.headers.get('location')!);
  assert.equal(to.origin + to.pathname, `${secondaryBase}/done`);
  const identifier = to.searchParams.get('identifier')!;
  assert.ok(identifier, to.toString());
  assert.equal(secondOidc.takeGrant(requestId, 'wrong'), undefined, 'a wrong attempt uses the grant up');
  assert.equal(secondOidc.takeGrant(requestId, identifier), undefined);

  // Again; this time the right identifier is taken once, with who the provider vouched for.
  const start2 = await fetch(`${secondaryBase}/oauth/getoauthurl?trackingID=t2&provider=test-idp`, { headers: { 'x-fms-return-url': `${secondaryBase}/done` } });
  const requestId2 = start2.headers.get('x-fms-request-id')!;
  const auth2 = new URL(start2.headers.get('x-fms-return-url')!);
  const code2 = Math.random().toString(36).slice(2);
  codes.set(code2, { nonce: auth2.searchParams.get('nonce')!, challenge: auth2.searchParams.get('code_challenge')! });
  const back2 = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=${code2}&state=${auth2.searchParams.get('state')}`, { redirect: 'manual' });
  const identifier2 = new URL(back2.headers.get('location')!).searchParams.get('identifier')!;
  const grant = secondOidc.takeGrant(requestId2, identifier2);
  assert.deepEqual({ email: grant?.email, groups: grant?.groups, sub: grant?.sub }, { email: 'sam@example.com', groups: ['Staff'], sub: 'u1' });
  assert.equal(secondOidc.takeGrant(requestId2, identifier2), undefined, 'good once');
});

test('abandoned AI resume expires and a late callback fails', { skip }, async () => {
  const request = { headers: { host: 'localhost' }, socket: { encrypted: false } } as never;
  let location = '';
  const response = { writeHead(_status: number, headers: Record<string, string>) { location = headers.location; return this; }, end() {} } as never;
  const resume: Resume = { done() {}, fail() {} };
  const oidc = new Oidc(host, new DataApi(host), { name: 'Test IdP', issuer, clientId: 'tabularius' });
  const local = createServer((req, res) => { void oidc.handle(req, res, new URL(req.url!, 'http://localhost')); });
  await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve));
  await oidc.begin('test-idp', 'Charts', request, response, resume);
  const auth = new URL(location);
  const db = new DatabaseSync(join(dir, '.openhbam-oidc', 'pending.sqlite'));
  db.prepare('UPDATE pending SET expires = 0 WHERE state = ?').run(auth.searchParams.get('state'));
  const late = await fetch(`http://127.0.0.1:${(local.address() as { port: number }).port}/tabularius/auth/v1/oidc/callback?code=x&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
  assert.match(decodeURIComponent(late.headers.get('location')!), /took too long/);
  await new Promise<void>((resolve) => local.close(() => resolve()));
  db.close();
});

test('persisted AI sign-in with a lost resume handler cannot fall back to web login', { skip }, async () => {
  const request = { headers: { host: 'localhost' }, socket: { encrypted: false } } as never;
  let location = '';
  const response = { writeHead(_status: number, headers: Record<string, string>) { location = headers.location; return this; }, end() {} } as never;
  const resume: Resume = { done() { assert.fail('must not finish as web login'); }, fail() {} };
  const first = new Oidc(host, new DataApi(host), { name: 'Test IdP', issuer, clientId: 'tabularius' });
  await first.begin('test-idp', 'Charts', request, response, resume);
  const state = new URL(location).searchParams.get('state')!;
  const reply = await fetch(`${secondaryBase}/tabularius/auth/v1/oidc/callback?code=x&state=${state}`, { redirect: 'manual' });
  assert.match(decodeURIComponent(reply.headers.get('location')!), /app sign-in expired/);
});

test('callback does not continue when consuming pending state fails', { skip }, async () => {
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start?db=Charts`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const db = new DatabaseSync(join(dir, '.openhbam-oidc', 'pending.sqlite'));
  db.exec("CREATE TRIGGER refuse_oidc_consume BEFORE DELETE ON pending BEGIN SELECT RAISE(ABORT, 'forced consume failure'); END");
  const before = tokenRequests;
  try {
    const reply = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=unused&state=${state}`, { redirect: 'manual' });
    assert.match(decodeURIComponent(reply.headers.get('location')!), /Sign-in failed/);
    assert.equal(tokenRequests, before, 'token exchange must not run after failed consumption');
  } finally {
    db.exec('DROP TRIGGER refuse_oidc_consume');
    db.close();
  }
});

test('OIDC pending state and Data API grants issued during rollback remain usable', { skip }, async (t) => {
  let wall = Date.now(), mono = performance.now();
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  const clock = new ExpiryClock();
  t.mock.method(expiryClock, 'now', () => clock.now());
  wall -= 3600_000;
  person = { email: 'sam@example.com', email_verified: true, groups: ['Staff'] };
  const start = await fetch(`${secondaryBase}/oauth/getoauthurl?trackingID=rollback&provider=test-idp`, { headers: { 'x-fms-return-url': `${secondaryBase}/done` } });
  assert.equal(start.status, 200);
  const requestId = start.headers.get('x-fms-request-id')!;
  const auth = new URL(start.headers.get('x-fms-return-url')!);
  const code = Math.random().toString(36).slice(2);
  codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
  const back = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=${code}&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
  assert.equal(back.status, 302);
  const to = new URL(back.headers.get('location')!, base);
  const identifier = to.searchParams.get('identifier');
  assert.ok(identifier, decodeURIComponent(to.toString()));
  const grant = secondOidc.takeGrant(requestId, identifier);
  assert.equal(grant?.email, 'sam@example.com');
  assert.equal(grant.expires, clock.now() + 5 * 60_000);
});

test('callback rechecks expiry after consuming the pending row', { skip }, async () => {
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start?db=Charts`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const db = new DatabaseSync(join(dir, '.openhbam-oidc', 'pending.sqlite'));
  db.prepare('UPDATE pending SET expires = ? WHERE state = ?').run(Date.now() + 50_000, state);
  const before = tokenRequests;
  const realNow = Date.now;
  const sampledNow = realNow();
  let samples = 0;
  try {
    Date.now = () => ++samples === 1 ? sampledNow : sampledNow + 50_001;
    const reply = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=unused&state=${state}`, { redirect: 'manual' });
    assert.match(decodeURIComponent(reply.headers.get('location')!), /took too long/);
    assert.equal(tokenRequests, before, 'token exchange must not run after expiry');
  } finally {
    Date.now = realNow;
    db.close();
  }
});

test('callback rejects pending expiry implausibly far in the future after clock rollback', { skip }, async () => {
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start?db=Charts`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const db = new DatabaseSync(join(dir, '.openhbam-oidc', 'pending.sqlite'));
  db.prepare('UPDATE pending SET expires = ? WHERE state = ?').run(Date.now() + 20 * 60_000, state);
  const before = tokenRequests;
  try {
    const reply = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=unused&state=${state}`, { redirect: 'manual' });
    assert.match(decodeURIComponent(reply.headers.get('location')!), /system clock change/);
    assert.equal(tokenRequests, before);
  } finally { db.close(); }
});

test('pending OIDC sign-in expires after elapsed lifetime despite a backward wall-clock jump', { skip }, async (t) => {
  let wall = Date.now(), mono = performance.now();
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start?db=Charts`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const before = tokenRequests;
  wall -= 3600_000;
  mono += 11 * 60_000;
  const reply = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=unused&state=${state}`, { redirect: 'manual' });
  assert.match(decodeURIComponent(reply.headers.get('location')!), /took too long/);
  assert.equal(tokenRequests, before);
});

test('callback rejects a pending row created in the future after a clock rollback', { skip }, async () => {
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start?db=Charts`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const db = new DatabaseSync(join(dir, '.openhbam-oidc', 'pending.sqlite'));
  const future = Date.now() + 120_000;
  db.prepare('UPDATE pending SET created = ?, expires = ? WHERE state = ?').run(future, future + 600_000, state);
  const before = tokenRequests;
  const realNow = Date.now;
  try {
    Date.now = () => future - 60_000;
    const reply = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=unused&state=${state}`, { redirect: 'manual' });
    assert.match(decodeURIComponent(reply.headers.get('location')!), /system clock change/);
    assert.equal(tokenRequests, before);
  } finally { Date.now = realNow; db.close(); }
});

test('OIDC closes SQLite when the initial pending-row prune fails', { skip }, () => {
  const testDir = mkdtempSync(join(tmpdir(), 'tabularius-oidc-init-'));
  const storeDir = join(testDir, '.openhbam-oidc');
  mkdirSync(storeDir, { mode: 0o700 });
  const path = join(storeDir, 'pending.sqlite');
  const setup = new DatabaseSync(path);
  setup.exec("CREATE TABLE pending (state TEXT PRIMARY KEY, provider TEXT NOT NULL, database TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires INTEGER NOT NULL, flow TEXT NOT NULL DEFAULT 'web', created INTEGER NOT NULL DEFAULT 0); INSERT INTO pending VALUES ('old', 'x', 'x', 'x', 'x', 'x', 1, 'web', 1); CREATE TRIGGER reject_prune BEFORE DELETE ON pending BEGIN SELECT RAISE(ABORT, 'forced prune failure'); END");
  setup.close();
  chmodSync(path, 0o600);
  const prototype = DatabaseSync.prototype as unknown as { close: () => void };
  const realClose = prototype.close;
  let closes = 0;
  prototype.close = function () { closes++; return realClose.call(this); };
  try {
    assert.throws(() => new Oidc({ dir: testDir } as never, new DataApi({} as never), { name: 'x', issuer, clientId: 'x' }), /forced prune failure/);
    assert.equal(closes, 1, 'constructor failure must close its opened SQLite database');
  } finally {
    prototype.close = realClose;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('OIDC file identity check rejects replacement and host folder warning is nonblocking', { skip }, () => {
  assert.throws(() => assertSameOidcFile({ dev: 1, ino: 2 }, { dev: 1, ino: 3 }), /changed while opening/);
  const testDir = mkdtempSync(join(tmpdir(), 'tabularius-oidc-host-'));
  try {
    chmodSync(testDir, 0o755);
    assert.equal(oidcHostDirectoryWarning(testDir), undefined);
    chmodSync(testDir, 0o777);
    assert.match(oidcHostDirectoryWarning(testDir)!, /group\/world-writable/);
    const oidc = new Oidc({ dir: testDir } as never, new DataApi({} as never), { name: 'x', issuer, clientId: 'x' });
    assert.match(oidc.storageWarning!, /group\/world-writable/);
    const timer = (oidc as unknown as { resumePruner: NodeJS.Timeout }).resumePruner as NodeJS.Timeout & { _destroyed?: boolean };
    oidc.close();
    assert.equal(timer._destroyed, true, 'close must stop the pruning interval');
  } finally { rmSync(testDir, { recursive: true, force: true }); }
});

test('SQLite lock contention returns a temporary-unavailable sign-in error', { skip }, async () => {
  const db = new DatabaseSync(join(dir, '.openhbam-oidc', 'pending.sqlite'));
  db.exec('BEGIN IMMEDIATE');
  try {
    const reply = await fetch(`${base}/tabularius/auth/v1/oidc/start?db=Charts`, { redirect: 'manual' });
    assert.match(decodeURIComponent(reply.headers.get('location')!), /temporarily unavailable/);
  } finally {
    db.exec('ROLLBACK');
    db.close();
  }
});

test('OIDC storage refuses symlinks and permissive main files and sidecars', { skip }, () => {
  const testDir = mkdtempSync(join(tmpdir(), 'tabularius-oidc-secure-'));
  const storeDir = join(testDir, '.openhbam-oidc');
  const path = join(storeDir, 'pending.sqlite');
  const create = () => new Oidc({ dir: testDir } as never, new DataApi({} as never), { name: 'x', issuer, clientId: 'x' });
  chmodSync(testDir, 0o755);
  writeFileSync(join(testDir, '.openhbam-oidc.sqlite'), 'old pending state that must never be read');
  create().close();
  assert.equal(existsSync(join(testDir, '.openhbam-oidc.sqlite')), true, 'legacy state is ignored and left untouched');
  rmSync(storeDir, { recursive: true, force: true });
  symlinkSync(join(testDir, 'elsewhere'), storeDir);
  assert.throws(create);
  rmSync(storeDir);
  mkdirSync(storeDir, { mode: 0o700 });
  chmodSync(storeDir, 0o755);
  assert.throws(create, /private/);
  chmodSync(storeDir, 0o700);
  if (process.getuid && process.getuid() === 0) {
    // Root can exercise the foreign-owner check deterministically.
    chownSync(storeDir, 1, 1);
    assert.throws(create, /owned by this service/);
    chownSync(storeDir, 0, 0);
  }
  rmSync(path, { force: true });
  symlinkSync(join(dir, 'missing-target'), path);
  assert.throws(create);
  rmSync(path);
  writeFileSync(path, '');
  chmodSync(path, 0o644);
  assert.throws(create);
  chmodSync(path, 0o600);
  writeFileSync(`${path}-wal`, '');
  chmodSync(`${path}-wal`, 0o644);
  assert.throws(create);
  rmSync(`${path}-wal`, { force: true });
  rmSync(path, { force: true });
  rmSync(testDir, { recursive: true, force: true });
});

test('OIDC startup failure is visible in administrator status', { skip }, async () => {
  const badDir = mkdtempSync(join(tmpdir(), 'tabularius-oidc-admin-'));
  const path = join(badDir, '.openhbam-oidc');
  symlinkSync(join(badDir, 'missing'), path);
  const s = await serve({ dir: badDir, port: 0, log: () => {}, oidc: { name: 'x', issuer, clientId: 'x' } });
  try {
    const status = await fetch(`${s.url}/tabularius/admin/v1/status`).then((r) => r.json());
    assert.equal(status.server.oidc.on, false);
    assert.match(status.server.oidc.error, /OIDC storage directory/);
  } finally {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(badDir, { recursive: true, force: true });
  }
});

test('pending sign-in cap is shared by handlers', { skip }, async () => {
  const db = new DatabaseSync(join(dir, '.openhbam-oidc', 'pending.sqlite'));
  try {
    db.prepare('DELETE FROM pending').run();
    const insert = db.prepare("INSERT INTO pending (state,provider,database,verifier,nonce,redirect_uri,expires,flow) VALUES (?, ?, ?, ?, ?, ?, ?, 'web')");
    // One transaction: 2000 separate commits took 7 s on a slow disk, long enough for the server to close the
    // test's idle keep-alive connection (ECONNRESET), and the rows then stayed and failed the tests after it.
    db.exec('BEGIN');
    for (let i = 0; i < 2000; i++) insert.run(`cap-${i}`, 'test-idp', 'Charts', 'v', 'n', 'http://localhost/callback', Date.now() + 60_000);
    db.exec('COMMIT');
    const denied = await fetch(`${secondaryBase}/tabularius/auth/v1/oidc/start?db=Charts`, { redirect: 'manual' });
    assert.match(decodeURIComponent(denied.headers.get('location')!), /Too many sign-ins/);
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.prepare('DELETE FROM pending').run();
    db.close();
  }
});

test('identity provider sign-in: an account named the email wins over groups', { skip }, async () => {
  person = { email: 'Pat@Example.com', email_verified: true, groups: ['Staff'] };
  const back = await signIn();
  const token = back.get('token')!;
  const rec = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records/1`, {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Name: 'x' } }),
  }).then((r) => r.json());
  assert.equal(rec.messages[0].code, '200', '[Read-Only Access] can\'t edit');
});

test('identity provider sign-in: refused without a matching account or with a forged token', { skip }, async () => {
  person = { email: 'stranger@example.com', email_verified: true, groups: ['Nobody'] };
  const none = await signIn();
  assert.match(none.get('error')!, /no external account/);

  person = { email: 'sam@example.com', email_verified: true, groups: ['Staff'] };
  signWith = otherKey;
  try {
    assert.match((await signIn()).get('error')!, /signature/);
  } finally {
    signWith = privateKey;
  }

  // A state can't be replayed.
  const replay = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=x&state=made-up`, { redirect: 'manual' });
  assert.match(decodeURIComponent(replay.headers.get('location')!), /took too long or was already used/);
});
