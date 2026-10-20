// A locked-out account's refusal on the Data API, OData and SQL endpoints is still a 401, and says in a Retry-After
// header how many seconds the lockout has left, as the admin console and the admin API already do.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, request, type Server } from 'node:http';
import type { SignInFailures } from '../../store/src/sign-in-failures.ts';
import { serve, setAdminPassword, type Host } from '../src/index.ts';
import { createStore, LOCKOUT } from '../../store/src/index.ts';

const FROM = '203.0.113.9';
let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-retry-'));
  createStore(join(dir, 'Charts.openhbam.sqlite'));
  setAdminPassword(dir, 'admin-secret');
  const s = await serve({ dir, port: 0, log: () => {}, proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1', '::1'] });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.get('Charts')!;
  store.setPassword('Admin', 'admin-secret', '[Full Access]');
  store.setPassword('pat', 'right-pw', '[Full Access]');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const basic = (password: string) => ({ authorization: 'Basic ' + btoa(`pat:${password}`), 'x-forwarded-for': FROM });

test('the lockout refusal carries Retry-After on the Data API, OData and SQL, and stays a 401', async () => {
  const sessions = () => fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: basic('wrong'), body: '{}' });
  for (let i = 0; i < LOCKOUT.attempts; i++) {
    const r = await sessions();
    assert.equal(r.status, 401);
    if (i < LOCKOUT.attempts - 1) assert.equal(r.headers.get('retry-after'), null, 'a plain wrong password is not a lockout');
    await r.text();
  }
  const calls = {
    'Data API': () => sessions(),
    OData: () => fetch(`${base}/fmi/odata/v4/Charts`, { headers: basic('wrong') }),
    SQL: () => fetch(`${base}/tabularius/sql/v1/databases/Charts/tables`, { headers: basic('wrong') }),
  };
  for (const [name, call] of Object.entries(calls)) {
    const r = await call();
    assert.equal(r.status, 401, name);
    const secs = Number(r.headers.get('retry-after'));
    assert.ok(Number.isInteger(secs) && secs >= 1 && secs <= LOCKOUT.lockMs / 1000 + 1, `${name}: Retry-After ${r.headers.get('retry-after')}`);
    assert.match(await r.text(), /Too many failed sign-ins/, name);
  }
  host.get('Charts')!.unlock('pat');
});

test('bad passkey assertions count against the address, and an admin can lift the block on an address', async () => {
  const from = '203.0.113.77';
  const bad = () => fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions/passkey`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from },
    body: JSON.stringify({ response: { credentialId: 'nope', clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA', challenge: 'nope' } }),
  });
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) {
    const r = await bad();
    assert.ok(r.status >= 400 && r.status < 500);
    assert.equal(r.headers.get('retry-after'), null, 'a plain failure is not yet a block');
    await r.text();
  }
  const blocked = await bad();
  assert.equal(blocked.status, 401);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'the block says how long it lasts');
  await blocked.text();
  // The same address is refused for a password sign-in too, even a right one.
  const withPassword = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { ...basic('right-pw'), 'x-forwarded-for': from }, body: '{}' });
  assert.equal(withPassword.status, 401);
  await withPassword.text();

  const lift = await fetch(`${base}/tabularius/admin/v1/accounts/unlock`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1', authorization: 'Basic ' + btoa(':admin-secret'), 'x-forwarded-for': '198.51.100.254' }, body: JSON.stringify({ database: 'Charts', address: from }),
  });
  assert.equal(lift.status, 200, await lift.clone().text());
  // Admin input is checked: not both, not a non-address; and it says whether a block was there.
  const adminCall = (body: unknown) => fetch(`${base}/tabularius/admin/v1/accounts/unlock`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1', authorization: 'Basic ' + btoa(':admin-secret'), 'x-forwarded-for': '198.51.100.254' }, body: JSON.stringify(body) });
  assert.equal((await adminCall({ database: 'Charts', address: from, account: 'pat' })).status, 400);
  assert.equal((await adminCall({ database: 'Charts', address: 'not-an-ip' })).status, 400);
  assert.deepEqual(await (await adminCall({ database: 'Charts', address: ` ${from} ` })).json(), { ok: true, cleared: false }, 'already lifted above');
  const after = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { ...basic('right-pw'), 'x-forwarded-for': from }, body: '{}' });
  assert.equal(after.status, 200, 'signs in again once the block is lifted');
  await after.text();
});

test('wrong recovery codes count against the address, and the block is refused with Retry-After', async () => {
  const from = '203.0.113.88';
  const failures = (host.get('Charts')! as unknown as { failures: SignInFailures }).failures;
  const before = failures.size;
  const bad = (i: number) => fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions/recovery`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from }, body: JSON.stringify({ account: `who${i}`, code: 'nope' }),
  });
  for (let i = 0; i < LOCKOUT.addressAttempts - 1; i++) {
    const r = await bad(i);
    assert.equal(failures.get(`\0address\0${from}`)?.count, i + 1, 'exactly one address charge per recovery failure');
    assert.equal(failures.size, before + i + 2);
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('retry-after'), null);
    await r.text();
  }
  const edge = await bad(99); // the 30th failure crosses the limit; the next is refused with a time
  await edge.text();
  assert.equal(failures.get(`\0address\0${from}`)?.count, LOCKOUT.addressAttempts);
  assert.equal(failures.size, before + LOCKOUT.addressAttempts, 'the threshold failure adds no name');
  const blocked = await bad(100);
  assert.equal(blocked.status, 401);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  await blocked.text();
  const twoFactor = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions/passkey-2fa`, { method: 'POST', headers: { ...basic('right-pw'), 'x-forwarded-for': from }, body: '{}' });
  assert.equal(twoFactor.status, 401);
  assert.ok(Number(twoFactor.headers.get('retry-after')) > 0, 'the second-factor path says how long too');
  await twoFactor.text();
});

test('asking for passkey challenges is limited per address with Retry-After, and a name without a passkey still gets ids', async () => {
  const from = '203.0.113.99';
  const ask = (account: string) => fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions/passkey`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from }, body: JSON.stringify({ account }),
  });
  const first = await ask('pat');
  const second = await ask('no-such-account');
  const unwrap = (j: { response?: { allowCredentials: string[] }; allowCredentials?: string[] }) => (j.response ?? j).allowCredentials ?? [];
  const a = { allowCredentials: unwrap(await first.json()) };
  const b = { allowCredentials: unwrap(await second.json()) };
  assert.ok(a.allowCredentials.length > 0 && b.allowCredentials.length > 0, 'an account with no passkey and a made-up one both get ids');
  for (let i = 2; i < 60; i++) await (await ask('pat')).text();
  const limited = await ask('pat');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  await limited.text();
});

test('Data API failures beyond capacity cannot deny correct sign-ins elsewhere', async (t) => {
  const capacity = LOCKOUT.maxFailures;
  LOCKOUT.maxFailures = 128;
  t.after(() => { LOCKOUT.maxFailures = capacity; });
  const from = '203.0.113.5';
  const agent = new Agent({ keepAlive: true, maxSockets: 2 });
  t.after(() => agent.destroy());
  const login = (account: string, password: string, address?: string): Promise<number> => new Promise((resolve, reject) => {
    const req = request(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
      method: 'POST', agent,
      headers: {
        'content-type': 'application/json', 'content-length': '2',
        authorization: 'Basic ' + Buffer.from(`${account}:${password}`).toString('base64'),
        // The configured proxy must name a visitor: a request without an address is refused before authentication.
        'x-forwarded-for': address ?? '198.51.100.254',
      },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    req.on('error', reject);
    req.end('{}');
  });
  const store = host.get('Charts')!;
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  assert.equal(await login('Admin', 'admin-secret'), 200);
  const before = failures.size;
  let i = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (i < LOCKOUT.maxFailures * 2) assert.equal(await login(`made-up-${i++}`, 'wrong', from), 401);
  }));
  assert.ok(store.addressLockedOut(from));
  assert.ok(failures.size <= before + LOCKOUT.addressAttempts, 'a locked address stops admitting names');
  for (const fresh of [undefined, '198.51.100.7', '2001:db8:1::1']) {
    assert.equal(await login('Admin', 'admin-secret', fresh), 200);
  }
  assert.equal(await login('Admin', 'admin-secret', from), 401, 'the spraying address remains locked');
});
