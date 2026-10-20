import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { createStore, Store, LOCKOUT } from '../../store/src/index.ts';
import { SignInFailures } from '../../store/src/sign-in-failures.ts';
import { Host, STORE_EXT } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';
import { ServerLogs } from '../src/server-logs.ts';
import { SqlEndpoint } from '../src/sql.ts';
import { ODataEndpoint } from '../src/odata.ts';
import { CwpXmlEndpoint } from '../src/cwp-xml.ts';
import { OAuthServer } from '../src/oauth.ts';
import { ScimDirectory, ScimEndpoint } from '../src/scim.ts';

test('confirmed directory users survive made-up names filling anonymous capacity', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-directory-capacity-'));
  createStore(join(dir, 'A' + STORE_EXT));
  const host = new Host(dir, () => {}, { background: false });
  const api = new DataApi(host);
  const store = host.get('A')!;
  store.setExternalAccount('Staff', '[Full Access]');
  store.setPassword('Local', 'local-password', '[Full Access]');
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  const directory = t.mock.fn(async (name: string, password: string) =>
    ['alice', 'bob', 'carol'].includes(name.toLowerCase()) && password === 'directory-password' ? { email: `${name}@example.test`, groups: ['Staff'] } : undefined);
  const server = createServer((req, res) => {
    Object.defineProperty(req.socket, 'remoteAddress', { value: 'unknown', configurable: true });
    void api.handle(req, res, new URL(req.url!, 'http://127.0.0.1'));
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const signIn = async (name: string, password: string) => {
    const res = await fetch(`${base}/fmi/data/vLatest/databases/A/sessions`, {
      method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${name}:${password}`).toString('base64') }, body: '{}',
    });
    const body = await res.json() as { response?: { token?: string }; messages: { code: string }[] };
    return { status: res.status, body, retry: res.headers.get('retry-after') };
  };
  api.directory = directory;
  assert.equal(store.canonicalAccount('alice'), undefined, 'only the group has an account row');
  const alice = await signIn('alice', 'directory-password');
  assert.equal(alice.status, 200);
  assert.ok(alice.body.response?.token);
  assert.equal(directory.mock.callCount(), 1);
  assert.equal(failures.size, 0, 'successful directory authentication clears its counter');
  assert.equal((await signIn('bob', 'directory-password')).status, 200);
  // Exercise real HTTP admission without paying for dummy scrypt on every invented name.
  const hashes = t.mock.method(crypto, 'scrypt', ((_password: unknown, _salt: unknown, length: number, callback: (error: Error | null, key: Buffer) => void) => {
    queueMicrotask(() => callback(null, Buffer.alloc(length)));
  }) as typeof crypto.scrypt);
  syncBuiltinESMExports();
  t.after(() => { hashes.mock.restore(); syncBuiltinESMExports(); });
  // First send the 128 names that used to exhaust the directory reserve, through HTTP.
  for (let i = 0; i < 128; i++) assert.equal((await signIn(`made-up${i}`, 'wrong')).status, 401);
  assert.equal(failures.size, 128);
  assert.equal((await signIn('ALICE', 'directory-password')).status, 200);
  for (let i = Number(failures.size); i < LOCKOUT.sharedFailures; i++) store.useRecoveryCode(`invented${i}`, 'wrong', 'unknown');
  assert.equal(failures.size, LOCKOUT.sharedFailures);
  const shared = [...failures];
  const beforeFlood = directory.mock.callCount();
  for (let i = 128; i < 256; i++) assert.equal((await signIn(`made-up${i}`, 'wrong')).status, 401);
  const carol = await signIn('carol', 'directory-password');
  assert.equal(carol.status, 401, 'never-seen real directory users need shared capacity');
  assert.equal(carol.retry, null, 'anonymous directory refusals do not reveal capacity');
  assert.equal(directory.mock.callCount(), beforeFlood, 'unconfirmed names cannot reach LDAP when the shared pool is full');
  assert.deepEqual([...failures], shared, 'made-up names cannot occupy reserved counters');
  hashes.mock.restore();
  syncBuiltinESMExports();
  assert.equal((await signIn('alice', 'directory-password')).status, 200);
  assert.equal((await signIn('alice', 'directory-password')).status, 200, 'returning users stay confirmed after success');
  // Ordinary table saturation also cannot consume the directory reserve.
  for (let i = Number(failures.size); i < LOCKOUT.maxFailures; i++) failures.countAddressFailure(`2001:db8:${i.toString(16)}::1`);
  const ordinary = [...failures];
  for (let i = 0; i < LOCKOUT.attempts; i++) assert.equal((await signIn('bob', 'wrong')).status, 401);
  const calls = directory.mock.callCount();
  const locked = await signIn('bob', 'directory-password');
  assert.equal(locked.status, 401);
  assert.equal(locked.retry, null, 'anonymous directory refusals do not reveal account locks');
  assert.equal(directory.mock.callCount(), calls, 'a locked name never reaches LDAP');
  assert.equal(failures.get(failures.accountKey('bob', 'unknown'))?.count, 5);
  assert.equal((await signIn('alice', 'directory-password')).status, 200, 'another directory person still signs in');
  assert.equal(failures.size, LOCKOUT.maxFailures + 1, 'only confirmed bob occupies a reserved counter');
  const full = [...failures];
  assert.equal((await signIn('new-directory-name', 'wrong')).status, 401);
  assert.equal((await signIn('Local', 'local-password')).status, 200, 'provisioned accounts keep their own reserve');
  assert.deepEqual([...failures], full);
  for (const [key, value] of ordinary) assert.deepEqual(failures.get(key), value, 'no live address or anonymous counter was evicted');
  const session = await fetch(`${base}/fmi/data/vLatest/databases/A/layouts`, { headers: { authorization: `Bearer ${alice.body.response!.token}` } });
  await session.arrayBuffer();
  assert.equal(session.status, 200, 'capacity limits do not affect signed-in directory users');
  failures.delete(failures.accountKey('made-up0', 'unknown'));
  assert.equal((await signIn('carol', 'directory-password')).status, 200, 'a never-seen real user can sign in once shared capacity frees');
  assert.equal((await signIn('carol', 'directory-password')).status, 200, 'the newly confirmed user retains access');
});

// Synthetic LDAP and loopback HTTP: compare every response header, with the server's
// unrelated wall-clock Date header disabled so a second boundary cannot make this flaky.
async function directorySignInFixture(t: TestContext) {
  const limits = { ...LOCKOUT };
  Object.assign(LOCKOUT, { attempts: 5, sharedFailures: 8, maxFailures: 64, directoryAccounts: 4 });
  t.after(() => Object.assign(LOCKOUT, limits));
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-directory-outcomes-'));
  createStore(join(dir, 'A' + STORE_EXT));
  const host = new Host(dir, () => {}, { background: false });
  const api = new DataApi(host);
  const store = host.get('A')!;
  store.setPassword('local', 'local-right', '[Full Access]');
  const oauth = new OAuthServer(host, dir);
  const endpoints = [new SqlEndpoint(host, api), new ODataEndpoint(host, api), new CwpXmlEndpoint(host, api), oauth, api];
  store.setExternalAccount('Staff', '[Full Access]');
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  const directory = t.mock.fn(async (name: string, password: string) =>
    ['alice', 'bob'].includes(name) && password === 'right' ? { email: `${name}@example.test`, groups: ['Staff'] } : undefined);
  api.directory = directory;
  const source = { from: 'unknown' };
  const server = createServer(async (req, res) => {
    Object.defineProperty(req.socket, 'remoteAddress', { value: source.from, configurable: true });
    res.sendDate = false;
    for (const endpoint of endpoints) if (await endpoint.handle(req, res, new URL(req.url!, 'http://127.0.0.1'))) return;
    res.writeHead(404).end();
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    oauth.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  // Hash correctness has separate coverage; these tests exercise outcome accounting.
  const hashes = t.mock.method(crypto, 'scrypt', ((_password: unknown, _salt: unknown, length: number, callback: (error: Error | null, key: Buffer) => void) => {
    queueMicrotask(() => callback(null, Buffer.alloc(length)));
  }) as typeof crypto.scrypt);
  syncBuiltinESMExports();
  t.after(() => { hashes.mock.restore(); syncBuiltinESMExports(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const registration = await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Synthetic', redirect_uris: ['http://127.0.0.1:50000/callback'] }),
  });
  assert.equal(registration.status, 201);
  const { client_id } = await registration.json() as { client_id: string };
  const surfaces = ['data', 'passkey-2fa', 'sql', 'odata', 'xml', 'oauth'] as const;
  const signIn = async (name: string, password = 'wrong', surface: typeof surfaces[number] = 'data') => {
    const headers = { authorization: 'Basic ' + Buffer.from(`${name}:${password}`).toString('base64') };
    const paths = { sql: '/tabularius/sql/v1/databases/A/tables', odata: '/fmi/odata/v4/A', xml: '/fmi/xml/fmresultset.xml?-db=A&-layoutnames' };
    if (surface !== 'data') {
      const res = surface === 'oauth' ? await fetch(`${base}/oauth/authorize`, {
        method: 'POST', body: new URLSearchParams({ client_id, redirect_uri: 'http://127.0.0.1:50000/callback',
          response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', database: 'A', account: name, password }),
      }) : surface === 'passkey-2fa' ? await fetch(`${base}/fmi/data/vLatest/databases/A/sessions/passkey-2fa`, { method: 'POST', headers, body: '{}' })
        : await fetch(base + paths[surface], { headers });
      return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() };
    }
    const res = await fetch(`${base}/fmi/data/vLatest/databases/A/sessions`, {
      method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${name}:${password}`).toString('base64') }, body: '{}',
    });
    return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() };
  };
  return { api, host, store, failures, directory, source, signIn, surfaces, hashes };
}

test('all password surfaces hide confirmation and provisioning in every pool state', async (t) => {
  const { api, store, failures, directory, signIn, surfaces } = await directorySignInFixture(t);
  let now = Math.floor(performance.now());
  t.mock.method(performance, 'now', () => now);
  assert.equal((await signIn('alice', 'right')).status, 200);
  const key = (name: string) => failures.accountKey(name, 'unknown');
  const fill = (count: number) => {
    for (let i = 0; i < count; i++) failures.record(key(`invented${i}`), 'unknown', false);
  };
  const windowMs = LOCKOUT.windowMs;
  const states: [string, () => void][] = [
    ['empty', () => {}],
    ['partly full', () => fill(3)],
    ['last shared slot', () => fill(LOCKOUT.sharedFailures - 1)],
    ['shared pool full', () => fill(LOCKOUT.sharedFailures)],
    ['ordinary table full', () => {
      for (let i = 0; i < LOCKOUT.maxFailures; i++) failures.set(`ordinary${i}`, { count: 1, first: now });
    }],
    ['confirmed name has four failures at capacity', () => {
      for (let i = 0; i < 4; i++) failures.record(key('alice'), 'unknown', false);
      fill(LOCKOUT.sharedFailures);
    }],
    ['only confirmed name locked', () => {
      for (let i = 0; i < 5; i++) failures.record(key('alice'), 'unknown', false);
    }],
    ['only never-seen name locked', () => {
      for (let i = 0; i < 5; i++) failures.record(key('bob'), 'unknown', false);
    }],
    ['locked confirmed name and full pool', () => {
      for (let i = 0; i < 5; i++) failures.record(key('alice'), 'unknown', false);
      fill(LOCKOUT.sharedFailures);
    }],
    ['expired full pool', () => { fill(LOCKOUT.sharedFailures); now += LOCKOUT.windowMs; }],
    ['edited failure window', () => { fill(LOCKOUT.sharedFailures); now += 2; LOCKOUT.windowMs = 1; }],
  ];
  const references = new Map<string, Awaited<ReturnType<typeof signIn>>>();
  for (const configured of [true, false]) for (const surface of surfaces) for (const [state, prepare] of states) {
    api.directory = configured ? directory : undefined;
    LOCKOUT.windowMs = windowMs;
    failures.clear();
    prepare();
    for (const name of ['alice', 'bob', 'local', 'made-up']) {
      const response = await signIn(name, 'wrong', surface);
      assert.equal(response.status, 401, state);
      assert.equal(response.headers['retry-after'], undefined, state);
      assert.doesNotMatch(response.body, /Too many failed sign-ins/, state);
      if (!references.has(surface)) references.set(surface, response);
      assert.deepEqual(response, references.get(surface), `${surface}, directory=${configured}, ${state}: ${name} has identical status, all headers and body`);
    }
    assert.ok(failures.size <= LOCKOUT.maxFailures + LOCKOUT.directoryAccounts, state);
  }
  api.directory = directory;
  LOCKOUT.windowMs = windowMs;
  failures.clear();
  for (let i = 0; i < 4; i++) await signIn('alice');
  const counter = { ...failures.get(key('alice'))! };
  fill(LOCKOUT.sharedFailures);
  for (let i = 0; i < 32; i++) await signIn(`flood${i}`);
  assert.deepEqual(failures.get(key('alice')), counter, 'a flood cannot evict or reset a real counter');
  assert.equal(failures.size, LOCKOUT.sharedFailures + 1);
  const calls = directory.mock.callCount();
  assert.equal((await signIn('bob', 'right')).status, 401, 'unconfirmed correct passwords still need capacity');
  assert.equal(directory.mock.callCount(), calls);
  assert.equal((await signIn('alice', 'right')).status, 200, 'four wrong passwords then a correct one succeeds at capacity');
  assert.equal(failures.has(key('alice')), false);
  assert.equal(store.lockedOut('alice', 'unknown'), undefined);
});

test('unreachable directories hide name admission at empty and full shared capacity', async (t) => {
  const { api, host, failures, source, signIn } = await directorySignInFixture(t);
  assert.equal((await signIn('alice', 'right')).status, 200, 'remember a confirmed directory name');
  const ordinaryFailure = await signIn('bob');
  assert.equal(ordinaryFailure.status, 401);
  assert.equal(ordinaryFailure.headers['retry-after'], undefined);
  assert.deepEqual(JSON.parse(ordinaryFailure.body).messages, [
    { code: '212', message: 'Invalid user account and/or password; please try again' },
  ]);
  host.logs = new ServerLogs(tmpdir());
  const log = t.mock.method(host.logs, 'write', () => {});
  const directory = t.mock.fn(async () => { throw new Error('LDAP host directory.example.test:636 unreachable'); });
  api.directory = directory;
  for (const full of [false, true]) for (const name of ['alice', 'local', 'bob', 'made-up']) {
    failures.clear();
    if (full) for (let i = 0; i < LOCKOUT.sharedFailures; i++) {
      failures.record(failures.accountKey(`invented${i}`, 'unknown'), 'unknown', false);
    }
    const calls = directory.mock.callCount();
    const logs = log.mock.callCount();
    const response = await signIn(name);
    assert.deepEqual(response, ordinaryFailure, `${name}, full=${full}: identical status, headers and body`);
    const admitted = !full || name === 'alice' || name === 'local';
    assert.equal(directory.mock.callCount() - calls, Number(admitted), 'only admitted names reach LDAP');
    const diagnostics = log.mock.calls.slice(logs).filter(({ arguments: args }) =>
      String(args[3]).includes('LDAP host directory.example.test:636 unreachable'));
    assert.equal(diagnostics.length, Number(admitted), 'the admin log retains each directory failure');
    if (admitted) {
      assert.equal(diagnostics[0].arguments[0], 'Access');
      assert.equal(diagnostics[0].arguments[1], 'Warning');
      assert.match(String(diagnostics[0].arguments[3]), /the directory could not sign .* in to A from unknown/);
    }
  }
  failures.clear();
  source.from = '203.0.113.7';
  const identifiedFailure = await signIn('bob');
  assert.equal(identifiedFailure.status, 401);
  assert.deepEqual(JSON.parse(identifiedFailure.body).messages, [
    { code: '212', message: 'The directory could not be reached' },
  ], 'identified sources retain their existing diagnostic');
});

test('directory lockout counts exactly five wrong passwords, including for a never-seen name', async (t) => {
  const { failures, directory, source, signIn } = await directorySignInFixture(t);
  assert.equal((await signIn('alice', 'right')).status, 200);
  for (const from of ['unknown', '198.51.100.7', '127.0.0.1']) {
    source.from = from;
    for (const name of ['alice', 'bob']) {
      failures.clear();
      const key = failures.accountKey(name, from);
      const before = directory.mock.callCount();
      for (let i = 1; i <= 4; i++) {
        assert.equal((await signIn(name)).status, 401);
        assert.equal(failures.get(key)?.count, i, 'one counter increment per wrong password');
      }
      assert.equal((await signIn(name, 'right')).status, 200, 'the fifth request is a correct password');
      assert.equal(directory.mock.callCount() - before, 5, 'LDAP sees all five password attempts');
      assert.equal(failures.has(key), false, 'success clears only the account failure counter');
      const next = directory.mock.callCount();
      for (let i = 1; i <= 5; i++) {
        assert.equal((await signIn(name)).status, 401);
        assert.equal(failures.get(key)?.count, i);
      }
      assert.equal(directory.mock.callCount() - next, 5, 'LDAP evaluates the fifth wrong password before locking');
      assert.ok(failures.blocked(key));
      assert.equal((await signIn(name, 'right')).status, 401, 'five wrong passwords lock even the correct password');
      assert.equal(directory.mock.callCount() - next, 5, 'locked accounts never reach LDAP');
      source.from = '198.51.100.99';
      assert.equal((await signIn(name, 'right')).status, 200, 'another source can still sign in');
      source.from = from;
      assert.equal((await signIn(name, 'right')).status, 401, 'success elsewhere cannot lift this source’s lock');
    }
  }
});

test('a directory success already in flight cannot clear a newly issued lock', async (t) => {
  const { api, failures, signIn } = await directorySignInFixture(t);
  assert.equal((await signIn('alice', 'right')).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await signIn('alice')).status, 401);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let finish!: (value: { email: string; groups: string[] }) => void;
  const result = new Promise<{ email: string; groups: string[] }>((resolve) => { finish = resolve; });
  api.directory = async (_name, password) => {
    if (password !== 'right') return undefined;
    entered();
    return result;
  };
  const pending = signIn('alice', 'right');
  try {
    await Promise.race([started, pending.then(() => { throw new Error('the fifth request must reach LDAP'); })]);
    const locked = await signIn('alice');
    const key = failures.accountKey('alice', 'unknown');
    const counter = { ...failures.get(key)! };
    assert.equal(counter.count, 5);
    assert.ok(failures.blocked(key));
    finish({ email: 'alice@example.test', groups: ['Staff'] });
    assert.deepEqual(await pending, locked, 'late success gets the same anonymous refusal');
    assert.deepEqual(failures.get(key), counter, 'late success neither clears nor changes the lock');
    assert.equal(api.sessionCount, 1, 'only the initial successful sign-in created a session');
  } finally {
    finish({ email: 'alice@example.test', groups: ['Staff'] });
    await pending;
  }
});

test('concurrent guesses share one LDAP flight per normalized name and source', async (t) => {
  const { api, store, failures, source, signIn } = await directorySignInFixture(t);
  for (const from of ['unknown', '198.51.100.7', '127.0.0.1']) for (const prior of [0, 4]) {
    source.from = from;
    failures.clear();
    const key = failures.accountKey('alice', from);
    for (let i = 0; i < prior; i++) failures.record(key, from, false);
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { finish = resolve; });
    const directory = t.mock.fn(async () => { entered(); await held; return undefined; });
    api.directory = directory;
    const first = signIn('alice');
    try {
      await Promise.race([started, first.then(() => { throw new Error('first attempt must reach LDAP'); })]);
      const overlapping = await Promise.all(Array.from({ length: 12 }, (_, i) => signIn(i % 2 ? 'ALICE' : 'ａｌｉｃｅ')));
      assert.ok(overlapping.every((r) => r.status === 401));
      assert.equal(directory.mock.callCount(), 1, 'overlapping spelling variants never multiply LDAP work');
      assert.equal(failures.get(key)?.count, 5);
      assert.ok(store.lockedOut('alice', from));
    } finally { finish(); await first; }
    assert.equal((store as unknown as { directoryChecks: Set<string> }).directoryChecks.size, 0);
    store.unlock('alice');
    assert.equal((await signIn('alice')).status, 401);
    assert.equal(directory.mock.callCount(), 2, 'a completed flight releases the name');
  }
});

test('documented full-pool timing residual skips hashing and LDAP only for refused names', async (t) => {
  const { failures, directory, signIn, hashes } = await directorySignInFixture(t);
  assert.equal((await signIn('alice', 'right')).status, 200);
  for (let i = 0; i < LOCKOUT.sharedFailures; i++) failures.record(failures.accountKey(`fill${i}`, 'unknown'), 'unknown', false);
  const work = async (name: string) => {
    const before = hashes.mock.callCount(), ldap = directory.mock.callCount();
    const response = await signIn(name);
    return { hashes: hashes.mock.callCount() - before, ldap: directory.mock.callCount() - ldap, response };
  };
  const refused = await work('made-up'), confirmed = await work('alice');
  assert.deepEqual(refused.response, confirmed.response);
  assert.deepEqual([refused.hashes, refused.ldap], [0, 0]);
  assert.deepEqual([confirmed.hashes, confirmed.ldap], [1, 1]);
});

test('LDAP sign-in refuses an unmapped directory email even when the typed name is privileged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-auth2-'));
  createStore(join(dir, 'A' + STORE_EXT));
  const host = new Host(dir, () => {}, { background: false });
  const api = new DataApi(host);
  const store = host.get('A')!;
  store.setExternalAccount('owner@example.test', '[Full Access]');
  api.directory = async (user, password) => user === 'owner@example.test' && password === 'directory-password'
    ? { email: 'attacker@unmapped.test', groups: [] } : undefined;
  const server = createServer((req, res) => { void api.handle(req, res, new URL(req.url!, 'http://localhost')); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const signIn = await fetch(`${base}/fmi/data/vLatest/databases/A/sessions`, {
      method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('owner@example.test:directory-password').toString('base64') }, body: '{}',
    });
    const login = await signIn.json() as { response?: { token?: string }; messages: { code: string }[] };
    assert.equal(signIn.status, 401, 'a verified email with no external mapping must be refused even if the typed username names one');
    assert.equal(login.messages[0].code, '212');
    assert.equal(login.response?.token, undefined);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a refused SCIM group replacement leaves every membership and privilege set unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-scim-auth2-'));
  const path = join(dir, 'A' + STORE_EXT);
  createStore(path);
  const store = new Store(path, 'A');
  try {
    const scim = new ScimDirectory(store);
    const ordinary = scim.create({ userName: 'ordinary@example.test', active: true });
    const protectedUser = scim.create({ userName: 'protected@example.test', active: true });
    store.setAccountPrivilegeSet('protected@example.test', '[Full Access]');
    const set = 'SCIM Reader';
    store.savePrivilegeSet({ name: set, records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
    assert.equal(store.accountPrivilegeSet('ordinary@example.test'), undefined);
    assert.throws(() => scim.setMembers(set, [ordinary.id, protectedUser.id]), /full access/i);
    assert.equal(store.accountPrivilegeSet('ordinary@example.test'), undefined, 'a failed replacement must not grant any membership');
    assert.deepEqual(scim.members(set).map((r) => r.id), []);
    assert.equal(store.accountPrivilegeSet('protected@example.test'), '[Full Access]');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a SCIM group replacement rolls back when clearing a member privilege set fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-scim-rollback-'));
  const path = join(dir, 'A' + STORE_EXT);
  createStore(path);
  const store = new Store(path, 'A');
  try {
    const scim = new ScimDirectory(store);
    const user = scim.create({ userName: 'member@example.test', active: true });
    const set = 'SCIM Reader';
    store.savePrivilegeSet({ name: set, records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
    scim.setMembers(set, [user.id]);
    assert.equal(store.accountPrivilegeSet(user.account), set);

    const clear = store.clearAccountPrivilegeSet.bind(store);
    store.clearAccountPrivilegeSet = ((account: string, opts?: { by?: string }) => {
      clear(account, opts);
      throw new Error('injected failure after clearing privilege set');
    }) as Store['clearAccountPrivilegeSet'];
    assert.throws(() => scim.setMembers(set, []), /injected failure/);

    assert.deepEqual(scim.members(set).map((r) => r.id), [user.id]);
    assert.equal(store.accountPrivilegeSet(user.account), set);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SCIM Group POST, PUT, and PATCH refuse protected members without granting earlier members', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-scim-group-'));
  createStore(join(dir, 'A' + STORE_EXT));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.get('A')!;
  const scim = new ScimDirectory(store);
  const ordinary = scim.create({ userName: 'ordinary@example.test', active: true });
  const protectedUser = scim.create({ userName: 'protected@example.test', active: true });
  store.setAccountPrivilegeSet(protectedUser.account, '[Full Access]');
  const set = 'SCIM Reader';
  store.savePrivilegeSet({ name: set, records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  const token = scim.issueToken();
  const endpoint = new ScimEndpoint(host, new DataApi(host));
  const server = createServer((req, res) => { void endpoint.handle(req, res, new URL(req.url!, 'http://localhost')); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/tabularius/scim/v2/databases/A/Groups`;
  const members = [{ value: ordinary.id }, { value: protectedUser.id }];
  const request = async (method: string, suffix: string, body: unknown): Promise<number> => {
    const response = await fetch(base + suffix, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' },
      body: JSON.stringify(body),
    });
    await response.arrayBuffer();
    return response.status;
  };
  try {
    const group = '/' + Buffer.from(set).toString('base64url');
    assert.equal(await request('POST', '', { displayName: set, members }), 403);
    assert.equal(await request('PUT', group, { displayName: set, members }), 403);
    assert.equal(await request('PATCH', group, { Operations: [
      { op: 'add', path: 'members', value: [members[0]] },
      { op: 'add', path: 'members', value: [members[1]] },
    ] }), 403);
    assert.equal(await request('PATCH', group, { Operations: [
      { op: 'add', path: 'members', value: [members[1]] },
      { op: 'remove', path: 'members', value: [members[1]] },
    ] }), 403);
    assert.equal(await request('PATCH', group, { Operations: [
      { op: 'add', path: 'members', value: [{ value: 'missing-id' }] },
      { op: 'remove', path: 'members', value: [{ value: 'missing-id' }] },
    ] }), 400);
    assert.equal(await request('PATCH', group, { Operations: [
      { op: 'add', path: 'members', value: [members[0]] },
      { op: 'replace', path: 'displayName', value: 'No Such Group' },
    ] }), 400);
    assert.deepEqual(scim.members(set).map((r) => r.id), []);
    assert.equal(store.accountPrivilegeSet(ordinary.account), undefined);
    assert.equal(store.accountPrivilegeSet(protectedUser.account), '[Full Access]');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
