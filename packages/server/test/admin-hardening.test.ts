import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import { serve, setAdminPassword, MCP_LOCAL_TOKEN_FILE } from '../src/index.ts';
import { Admin, ADMIN_LIMIT } from '../src/admin.ts';
import { Host } from '../src/host.ts';
import type { DataApi } from '../src/dataapi.ts';
import { createStore } from '../../store/src/index.ts';
import { makeAuthenticator, forgeRegistration, forgeAssertion } from '../../store/test/forge-webauthn.ts';

// The admin console's open doors (sign-in, passkey sign-in) and what every answer carries.

async function localProxy(dir: string) {
  const app = await serve({ dir, port: 0, log: () => {}, proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1', '::1'] });
  app.server.prependListener('request', req => { req.headers['x-forwarded-for'] ??= '198.51.100.254'; });
  return app;
}

const open = { 'x-tabularius-admin': '1', 'content-type': 'application/json' };

for (const flood of ['direct', 'proxied IPv6']) {
  test(`passkey global capacity bounds ${flood} traffic and reserves proxied IPv4 sign-ins`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-passkey-pool-'));
    const host = new Host(dir);
    const limits = { ...ADMIN_LIMIT };
    t.after(async () => { Object.assign(ADMIN_LIMIT, limits); await host.close(); rmSync(dir, { recursive: true }); });
    Object.assign(ADMIN_LIMIT, { passkeyChallenges: 10, passkeyChallengesProxyReserve: 2 });
    const admin = new Admin(host, {} as DataApi) as unknown as {
      issuePasskeyChallenge(from?: string, direct?: boolean): string | undefined;
      takePasskeyChallenge(challenge: string): boolean;
      passkeyChallenges: Map<string, unknown>;
    };
    const pending: string[] = [];
    for (let i = 0; i < 30; i++) {
      const challenge = admin.issuePasskeyChallenge(flood === 'direct' ? `203.0.113.${i + 1}` : `2001:db8:${i.toString(16)}::1`, flood === 'direct');
      if (challenge) pending.push(challenge);
    }
    assert.equal(pending.length, 8, 'strangers cannot spend the proxy reserve');
    for (let i = 0; i < 2; i++) assert.ok(admin.issuePasskeyChallenge(`198.51.100.${i + 1}`, false));
    assert.equal(admin.issuePasskeyChallenge('198.51.100.99', false), undefined, 'the reserve is bounded by the global cap');
    assert.equal(admin.passkeyChallenges.size, 10);
    assert.ok(admin.issuePasskeyChallenge('127.0.0.1', true), 'loopback survives a full pool');
    for (let i = 0; i < 12; i++) assert.ok(admin.issuePasskeyChallenge(), 'authenticated callers remain exempt');
    assert.equal(admin.issuePasskeyChallenge('203.0.113.99', true), undefined);
    for (const challenge of pending) assert.equal(admin.takePasskeyChallenge(challenge), true, 'no live challenge was evicted');
    assert.ok(admin.issuePasskeyChallenge('203.0.113.99', true), 'consumption releases global and caller counts');
  });
}

test('passkey counts release on consumption and expiry without scanning fresh challenges, including clock edits', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-passkey-counts-'));
  const host = new Host(dir);
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true }); });
  const admin = new Admin(host, {} as DataApi) as unknown as {
    issuePasskeyChallenge(from?: string, direct?: boolean): string | undefined;
    takePasskeyChallenge(challenge: string): boolean;
    passkeyChallenges: Map<string, unknown>;
  };
  let now = Math.floor(performance.now()); // whole milliseconds, so expiry boundaries compare exactly
  t.mock.method(performance, 'now', () => now);
  const scans = t.mock.method(admin.passkeyChallenges, Symbol.iterator);
  const first = admin.issuePasskeyChallenge('2001:db8:1::1')!;
  for (let i = 1; i < 5; i++) assert.ok(admin.issuePasskeyChallenge('2001:db8:1::1'));
  assert.equal(admin.issuePasskeyChallenge('2001:db8:1::1'), undefined);
  assert.equal(scans.mock.callCount(), 0, 'fresh requests use counts, not full-map scans');
  assert.equal(admin.takePasskeyChallenge(first), true);
  assert.equal(admin.takePasskeyChallenge(first), false, 'replay cannot decrement twice');
  assert.ok(admin.issuePasskeyChallenge('2001:db8:1::1'));
  now -= 60_000;
  const earlier = admin.issuePasskeyChallenge('198.51.100.7')!;
  now += 300_000;
  assert.equal(admin.takePasskeyChallenge(earlier), false, 'expiry is exclusive, even after a backward clock edit');
  assert.equal(admin.issuePasskeyChallenge('2001:db8:1::1'), undefined, 'later expiries are still live');
  now += 60_000;
  assert.ok(admin.issuePasskeyChallenge('2001:db8:1::1'));
  assert.equal(admin.passkeyChallenges.size, 1, 'expired entries and their counts are released');
});

test('abandoned passkey responses release their challenge and every allowance', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-passkey-abandoned-'));
  const host = new Host(dir);
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true }); });
  const admin = new Admin(host, {} as DataApi) as unknown as {
    deliverPasskeyChallenge(req: IncomingMessage, res: ServerResponse, from: string | undefined, direct: boolean, respond: (challenge: string | undefined) => void): void;
    issuePasskeyChallenge(from?: string, direct?: boolean): string | undefined;
    passkeyChallenges: Map<string, unknown>;
    passkeyAddressCounts: Map<string, number>;
    passkeyPrefixCounts: Map<string, number>;
    passkeyPending: number;
    passkeyGeneralPending: number;
  };
  for (const from of [undefined, '2001:db8:1::1', '198.51.100.7']) {
    for (const when of ['before', 'during', 'close', 'throw']) {
      const socket = { destroyed: when === 'before' };
      const req = { socket } as IncomingMessage;
      const res = Object.assign(new EventEmitter(), { destroyed: false, writableFinished: false }) as unknown as ServerResponse;
      const original = admin.issuePasskeyChallenge.bind(admin);
      const issue = t.mock.method(admin, 'issuePasskeyChallenge', (address?: string, direct?: boolean) => {
        const challenge = original(address, direct);
        if (when === 'during') socket.destroyed = true;
        return challenge;
      });
      const deliver = () => admin.deliverPasskeyChallenge(req, res, from, false, (challenge) => {
        assert.ok(challenge);
        if (when === 'throw') throw new Error('response failed');
        res.emit('close');
        res.emit('close'); // release is idempotent
      });
      if (when === 'throw') assert.throws(deliver, /response failed/);
      else deliver();
      issue.mock.restore();
      assert.equal(admin.passkeyChallenges.size, 0, when);
      assert.equal(admin.passkeyAddressCounts.size, 0, when);
      assert.equal(admin.passkeyPrefixCounts.size, 0, when);
      assert.equal(admin.passkeyPending, 0, when);
      assert.equal(admin.passkeyGeneralPending, 0, when);
    }
  }
});

test('console 500 hides internal errors and known paths reject wrong methods', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-errors-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const headers = { authorization: 'Basic ' + btoa('admin:secret'), 'x-tabularius-admin': '1' };
    const names = t.mock.method(s.host.config, 'sessionIdleMinutes', () => { throw new Error('private /tmp/db stack trace'); });
    const fault = await fetch(`${s.url}/tabularius/admin/v1/status`, { headers });
    assert.equal(fault.status, 500);
    assert.deepEqual(await fault.json(), { error: 'Internal server error' });
    assert.equal(fault.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(fault.headers.get('cache-control'), 'no-store');
    names.mock.restore();
    for (const [path, method, allow] of [
      ['/tabularius/admin/v1/status', 'POST', 'GET'],
      ['/tabularius/admin/v1/session-timeout', 'GET', 'POST'],
      ['/tabularius/admin/v1/clients/abcdef/message', 'DELETE', 'POST'],
      ['/tabularius/admin/v1/backups/example/verify', 'GET', 'POST'],
      ['/tabularius/admin/v1/files/Foo/orphan-containers', 'DELETE', 'GET, POST'],
      ['/tabularius/admin/v1/schedules/abcdef', 'GET', 'PATCH, DELETE'],
      ['/tabularius/admin/v1/passkeys/Ab_-', 'GET', 'DELETE'],
    ]) {
      const r = await fetch(s.url + path, { method, headers });
      assert.equal(r.status, 405, `${method} ${path}`);
      assert.equal(r.headers.get('allow'), allow);
    }
    const missing = await fetch(`${s.url}/tabularius/admin/v1/unknown`, { headers });
    assert.equal(missing.status, 404);
    for (const limit of ['Infinity', '-1', '1e9']) {
      const r = await fetch(`${s.url}/tabularius/admin/v1/profile?limit=${limit}`, { headers });
      assert.equal(r.status, 400, `profile limit=${limit}`);
    }
    const longMessage = await fetch(`${s.url}/tabularius/admin/v1/message`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(100_000) }),
    });
    assert.equal(longMessage.status, 400);
    const many = await fetch(`${s.url}/tabularius/admin/v1/message`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi', extra: Array(1001).fill(0) }),
    });
    assert.equal(many.status, 400);
    const lenientBody = await fetch(`${s.url}/tabularius/admin/v1/solutions/plan`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Example', description: 'x', extra: Array(1001).fill(0) }),
    });
    assert.equal(lenientBody.status, 400);
    const reconvert = await fetch(`${s.url}/tabularius/admin/v1/reconvert-all`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ preview: true, extra: Array(1001).fill(0) }),
    });
    assert.equal(reconvert.status, 400);
    const early = await fetch(`${s.url}/tabularius/admin/v1/sign-in`, {
      method: 'POST', headers: open,
      body: JSON.stringify({ password: 'wrong', extra: Array(1001).fill(0) }),
    });
    assert.equal(early.status, 400);
    const credential = ['sk', 'test', 'abc123'].join('-');
    const logged = t.mock.method(console, 'error', () => {});
    const add = t.mock.method(s.host, 'add', () => { throw new Error(`private /tmp/solution api_key=${credential}`); });
    const solution = await fetch(`${s.url}/tabularius/admin/v1/solutions`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Example', changes: [{ op: 'createTable', name: 'People', fields: [{ name: 'Name', type: 'text' }] }] }),
    });
    assert.equal(solution.status, 500);
    assert.deepEqual(await solution.json(), { error: 'Internal server error' });
    assert.equal(logged.mock.callCount(), 1);
    const [diagnostic] = logged.mock.calls[0].arguments;
    assert.equal(typeof diagnostic, 'string');
    assert.doesNotMatch(diagnostic as string, new RegExp(credential));
    assert.doesNotMatch(diagnostic as string, /private \/tmp\/solution/);
    logged.mock.restore();
    add.mock.restore();
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
  }
});

test('every console answer says nosniff, and the page refuses frames, referrers and stray forms', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-hard-'));
  createStore(join(dir, 'Charts.openhbam.sqlite'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const admin = { authorization: 'Basic ' + btoa(':admin secret'), 'x-tabularius-admin': '1' };
    const answers = await Promise.all([
      fetch(`${s.url}/tabularius/admin/v1/sign-in-info`),
      fetch(`${s.url}/tabularius/admin/v1/status`),
      fetch(`${s.url}/tabularius/admin/v1/status`, { headers: admin }),
      fetch(`${s.url}/tabularius/admin/v1/sign-in`, { method: 'POST', headers: open, body: '{"password":"no"}' }),
      fetch(`${s.url}/tabularius/admin/v1/block-new-users`, { method: 'POST', headers: { authorization: admin.authorization }, body: '{}' }),
      fetch(`${s.url}/tabularius/admin/v1/nothing-here`, { headers: admin }),
    ]);
    assert.deepEqual(answers.map((a) => a.status), [200, 401, 200, 401, 403, 404]);
    for (const a of answers) {
      assert.match(a.headers.get('content-type') ?? '', /json/);
      assert.equal(a.headers.get('x-content-type-options'), 'nosniff', `${a.url} ${a.status}`);
      await a.arrayBuffer();
    }
    const page = await fetch(`${s.url}/admin/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal(page.headers.get('referrer-policy'), 'same-origin', 'sent only to the console\'s own origin, so downloads keep their same-origin proof');
    const csp = page.headers.get('content-security-policy') ?? '';
    for (const part of ["frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "default-src 'self'"]) assert.ok(csp.includes(part), part);
    await page.arrayBuffer();
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unexpected console fault returns a generic 500 and logs its cause', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-hard-'));
  createStore(join(dir, 'Charts.openhbam.sqlite'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  const logged = t.mock.method(console, 'error', () => {});
  const credential = ['sk', 'test', 'abc123'].join('-');
  const cause = new Error(`private path /var/lib/private.db api_key=${credential}`);
  const reconvertStatus = t.mock.method(s.host, 'reconvertStatus', () => { throw cause; });
  try {
    const r = await fetch(`${s.url}/tabularius/admin/v1/status`, { headers: { authorization: 'Basic ' + btoa(':admin secret'), 'x-tabularius-admin': '1' } });
    const text = await r.text();
    assert.equal(r.status, 500);
    assert.deepEqual(JSON.parse(text), { error: 'Internal server error' });
    assert.doesNotMatch(text, /private path|private\.db/);
    assert.equal(logged.mock.callCount(), 1);
    const [diagnostic] = logged.mock.calls[0].arguments;
    assert.equal(typeof diagnostic, 'string');
    assert.doesNotMatch(diagnostic as string, new RegExp(credential));
  } finally {
    reconvertStatus.mock.restore();
    logged.mock.restore();
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed address is a plain 400 naming the address, not an unexpected fault', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-hard-'));
  createStore(join(dir, 'Charts.openhbam.sqlite'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  const logged = t.mock.method(console, 'error', () => {});
  try {
    const r = await fetch(`${s.url}/tabularius/admin/v1/passkeys/%E0%A4%A`, { method: 'DELETE', headers: { authorization: 'Basic ' + btoa(':admin secret'), 'x-tabularius-admin': '1' } });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'URI malformed' });
    assert.equal(logged.mock.callCount(), 0, 'a caller\'s mistake is not a server fault');
  } finally {
    logged.mock.restore();
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a filesystem error in a per-file result does not reveal its absolute path', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-hard-'));
  createStore(join(dir, 'Charts.openhbam.sqlite'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  t.mock.method(s.host, 'reconvertStatus', () => ({ outdated: true } as any));
  t.mock.method(s.host, 'previewReconvert', async () => {
    throw Object.assign(new Error("ENOENT: no such file or directory, open '/var/lib/secret/Charts.fmp12'"), { code: 'ENOENT' });
  });
  const logged = t.mock.method(console, 'error', () => {});
  try {
    const r = await fetch(`${s.url}/tabularius/admin/v1/reconvert-all`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + btoa(':admin secret'), 'x-tabularius-admin': '1', 'content-type': 'application/json' },
      body: '{"preview":true}',
    });
    const body = await r.text();
    assert.equal(r.status, 200);
    assert.doesNotMatch(body, /\/var\/lib\/secret|ENOENT|Charts\.fmp12/);
    assert.match(body, /Unknown error/);
    assert.ok(logged.mock.calls.flatMap((call) => call.arguments).some((x) => /ENOENT/.test(x instanceof Error ? x.message : String(x))), 'the cause is logged (as redacted text, not the error object, which would also print custom properties)');
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('expired admin passkey challenges free sign-in capacity while registration stays available', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-hard-'));
  createStore(join(dir, 'Charts.openhbam.sqlite'));
  setAdminPassword(dir, 'admin secret');
  const s = await localProxy(dir);
  const limits = { ...ADMIN_LIMIT };
  ADMIN_LIMIT.passkeyChallengesProxyReserve = 0;
  try {
    const u = new URL(s.url);
    const auth = makeAuthenticator(u.hostname, u.origin);
    const admin = { authorization: 'Basic ' + btoa(':admin secret'), ...open };
    const opts = await (await fetch(`${s.url}/tabularius/admin/v1/passkeys/register/options`, { method: 'POST', headers: admin, body: '{}' })).json();
    const reg = await fetch(`${s.url}/tabularius/admin/v1/passkeys/register`, { method: 'POST', headers: admin, body: JSON.stringify({ response: { ...forgeRegistration(auth, opts.challenge), challenge: opts.challenge }, label: 'k' }) });
    assert.equal(reg.status, 200);

    ADMIN_LIMIT.passkeyChallenges = 1;
    const ask = () => fetch(`${s.url}/tabularius/admin/v1/passkey-sign-in`, { method: 'POST', headers: { ...open, 'x-forwarded-for': '198.51.100.10' }, body: '{}' });
    const register = () => fetch(`${s.url}/tabularius/admin/v1/passkeys/register/options`, { method: 'POST', headers: admin, body: '{}' });
    const first = (await (await ask()).json()).challenge as string;
    const full = await ask();
    assert.equal(full.status, 429, await full.text());
    const registration = await register();
    assert.equal(registration.status, 200, 'authenticated registration is exempt from the global cap');
    await registration.arrayBuffer();
    const now = Math.floor(performance.now()); // whole milliseconds, so expiry boundaries compare exactly
    const clock = t.mock.method(performance, 'now', () => now + 300_001);
    const fresh = await ask();
    assert.equal(fresh.status, 200);
    const last = (await fresh.json()).challenge as string;
    const blocked = await ask();
    assert.equal(blocked.status, 429, await blocked.text());
    const signIn = (challenge: string) => fetch(`${s.url}/tabularius/admin/v1/passkey-sign-in`, { method: 'POST', headers: open, body: JSON.stringify({ response: { ...forgeAssertion(auth, challenge), challenge } }) });
    const old = await signIn(first);
    assert.equal(old.status, 401);
    assert.match(((await old.json()) as { error: string }).error, /expired/);
    assert.equal((await signIn(last)).status, 200);
    clock.mock.restore();
  } finally {
    Object.assign(ADMIN_LIMIT, limits);
    await new Promise<void>((r) => s.server.close(() => r()));
    await s.host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('proxy passkey floods preserve the proxy reserve, loopback and authenticated administrators', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-global-cap-'));
  createStore(join(dir, 'Charts.openhbam.sqlite'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {}, proxyHeader: 'x-forwarded-for', trustedProxies: ['172.30.0.0/24'] });
  let peer = '172.30.0.2';
  s.server.prependListener('request', (req) => Object.defineProperty(req.socket, 'remoteAddress', { value: peer, configurable: true }));
  const limits = { ...ADMIN_LIMIT };
  ADMIN_LIMIT.passkeyChallengesProxyReserve = 0;
  t.after(async () => {
    Object.assign(ADMIN_LIMIT, limits);
    await new Promise<void>((r) => s.server.close(() => r()));
    await s.host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const u = new URL(s.url);
  const auth = makeAuthenticator(u.hostname, u.origin);
  const admin = { ...open, connection: 'close', authorization: 'Basic ' + btoa(':admin secret'), 'x-forwarded-for': '198.51.100.77' };
  const register = () => fetch(`${s.url}/tabularius/admin/v1/passkeys/register/options`, { method: 'POST', headers: admin, body: '{}' });
  const opts = await (await register()).json();
  const reg = await fetch(`${s.url}/tabularius/admin/v1/passkeys/register`, { method: 'POST', headers: admin, body: JSON.stringify({ response: { ...forgeRegistration(auth, opts.challenge), challenge: opts.challenge } }) });
  assert.equal(reg.status, 200, await reg.text());
  ADMIN_LIMIT.passkeyChallenges = 4;
  ADMIN_LIMIT.passkeyChallengesProxyReserve = 1;
  const ask = (headers: Record<string, string> = {}) => fetch(`${s.url}/tabularius/admin/v1/passkey-sign-in`, { method: 'POST', headers: { ...open, connection: 'close', ...headers }, body: '{}' });
  const challenges: string[] = [];
  for (let i = 0; i < ADMIN_LIMIT.passkeyChallenges - ADMIN_LIMIT.passkeyChallengesProxyReserve; i++) {
    const r = await ask({ 'x-forwarded-for': `2001:db8:${i}::1` });
    assert.equal(r.status, 200);
    challenges.push((await r.json()).challenge);
  }
  const capped = await ask({ 'x-forwarded-for': '2001:db8:ffff::1' });
  assert.equal(capped.status, 429);
  assert.equal((await capped.json()).challenge, undefined);
  const missingHeader = await ask();
  assert.equal(missingHeader.status, 400, 'a trusted proxy without a visitor header is rejected before authentication');
  assert.match(await missingHeader.text(), /--proxy-header and --trusted-proxies/, 'the refusal says what to check');
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    peer = address;
    const local = await ask();
    assert.equal(local.status, 200, `${address} must retain challenge access when proxy traffic fills the global cap`);
    challenges.push((await local.json()).challenge);
  }
  peer = '198.51.100.80';
  const direct = await ask();
  assert.equal(direct.status, 429, 'direct network callers cannot bypass the global budget');
  await direct.arrayBuffer();
  peer = '172.30.0.2';
  const proxied = await ask({ 'x-forwarded-for': '198.51.100.77' });
  assert.equal(proxied.status, 200, 'a known proxied IPv4 caller can use the reserve');
  challenges.push((await proxied.json()).challenge);
  const authenticated = await ask(admin);
  assert.equal(authenticated.status, 200, 'authenticated sign-in is exempt from the unauthenticated global cap');
  challenges.push((await authenticated.json()).challenge);
  const registration = await register();
  assert.equal(registration.status, 200, 'authenticated registration is exempt too');
  await registration.arrayBuffer();
  // Capacity exceptions must not evict any challenge already issued to another visitor.
  let count = 0;
  for (const challenge of challenges) {
    const signed = await fetch(`${s.url}/tabularius/admin/v1/passkey-sign-in`, {
      method: 'POST', headers: { ...open, 'x-forwarded-for': '198.51.100.77' },
      body: JSON.stringify({ response: { ...forgeAssertion(auth, challenge, ++count), challenge } }),
    });
    assert.equal(signed.status, 200, await signed.text());
  }
});

for (const trusted of [true, false]) {
  test(`admin passkey sign-in stays available behind ${trusted ? 'a trusted' : 'an untrusted'} container proxy`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-proxy-'));
    createStore(join(dir, 'Charts.openhbam.sqlite'));
    setAdminPassword(dir, 'admin secret');
    const s = await serve({ dir, port: 0, log: () => {}, proxyHeader: 'x-forwarded-for', trustedProxies: trusted ? ['172.30.0.0/24'] : [] });
    // A real HTTP request with the connecting peer supplied by a container network, independent of the test host's LAN.
    s.server.prependListener('request', (req) => Object.defineProperty(req.socket, 'remoteAddress', { value: '::ffff:172.30.0.2', configurable: true }));
    const limits = { ...ADMIN_LIMIT };
    try {
      const u = new URL(s.url);
      const auth = makeAuthenticator(u.hostname, u.origin);
      const admin = { ...open, authorization: 'Basic ' + btoa(':admin secret'), 'x-forwarded-for': '198.51.100.77' };
      const register = () => fetch(`${s.url}/tabularius/admin/v1/passkeys/register/options`, { method: 'POST', headers: admin, body: '{}' });
      const opts = await (await register()).json();
      const reg = await fetch(`${s.url}/tabularius/admin/v1/passkeys/register`, { method: 'POST', headers: admin, body: JSON.stringify({ response: { ...forgeRegistration(auth, opts.challenge), challenge: opts.challenge } }) });
      assert.equal(reg.status, 200, await reg.text());
      ADMIN_LIMIT.passkeyChallengesProxyReserve = 0;
      ADMIN_LIMIT.passkeyChallengesUnknown = 8;
      ADMIN_LIMIT.passkeyChallenges = 20;
      const ask = (from: string, headers: Record<string, string> = {}) => fetch(`${s.url}/tabularius/admin/v1/passkey-sign-in`, { method: 'POST', headers: { ...open, 'x-forwarded-for': from, ...headers }, body: '{}' });
      let first = '';
      for (let i = 0; i < (trusted ? 6 : 4); i++) {
        const r = await ask(`203.0.113.${i + 1}`);
        assert.equal(r.status, 200, 'trusted visitors have separate caps; untrusted values share the socket cap');
        const body = await r.json();
        first ||= body.challenge;
      }
      const realAdmin = await ask('198.51.100.77');
      assert.equal(realAdmin.status, 200, 'the administrator can still start passkey sign-in');
      await realAdmin.arrayBuffer();
      // Trusted addresses have separate allowances; untrusted headers share the socket allowance.
      for (let i = 0; i < (trusted ? 4 : 0); i++) {
        const r = await ask('203.0.113.1');
        assert.equal(r.status, 200);
        await r.arrayBuffer();
      }
      const limited = await ask(trusted ? '203.0.113.1' : '192.0.2.99');
      assert.equal(limited.status, 429, 'rotating untrusted headers cannot escape the shared cap');
      assert.equal((await limited.json()).challenge, undefined);
      const authenticated = await ask('203.0.113.1', { authorization: admin.authorization });
      assert.equal(authenticated.status, 200, 'authenticated challenges are exempt from both caller caps');
      await authenticated.arrayBuffer();
      const registration = await register();
      assert.equal(registration.status, 200, 'authenticated registration is exempt too');
      await registration.arrayBuffer();
      const signed = await fetch(`${s.url}/tabularius/admin/v1/passkey-sign-in`, {
        method: 'POST', headers: { ...open, 'x-forwarded-for': '203.0.113.1' },
        body: JSON.stringify({ response: { ...forgeAssertion(auth, first, 1), challenge: first } }),
      });
      assert.equal(signed.status, 200, await signed.text());
      const freed = await ask('203.0.113.1');
      assert.equal(freed.status, 200, 'consuming a challenge frees its allowance without evicting other challenges');
      await freed.arrayBuffer();
      const now = Math.floor(performance.now()); // whole milliseconds, so expiry boundaries compare exactly
      t.mock.method(performance, 'now', () => now + 300_001);
      const expired = await ask('203.0.113.1');
      assert.equal(expired.status, 200, 'expired challenges free the caller and global allowances');
      await expired.arrayBuffer();
      ADMIN_LIMIT.passkeyChallenges = 1;
      const global = await ask('198.51.100.77');
      assert.equal(global.status, 429, 'the global cap also applies to unknown visitors');
      await global.arrayBuffer();
      const authenticatedGlobal = await register();
      assert.equal(authenticatedGlobal.status, 200, 'authenticated requests are exempt from the global cap');
      await authenticatedGlobal.arrayBuffer();
    } finally {
      Object.assign(ADMIN_LIMIT, limits);
      await new Promise<void>((r) => s.server.close(() => r()));
      await s.host.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const [flood, cap, address] of [
  ['one IPv4 address', 5, (i: number) => ['203.0.113.20', '::ffff:203.0.113.20', '::ffff:cb00:7114', '0:0:0:0:0:ffff:cb00:7114'][i % 4]],
  ['one IPv6 /64', 5, (i: number) => i % 2 ? `2001:0DB8:0001:0002::${i + 1}` : `2001:db8:1:2::${i + 1}`],
  ['rotating IPv6 /64s within one /48', 50, (i: number) => `2001:db8:1:${i.toString(16)}::1`],
] as const) {
  test(`admin passkey requests from ${flood} leave capacity for other addresses and authenticated callers`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-challenge-cap-'));
    createStore(join(dir, 'Charts.openhbam.sqlite'));
    setAdminPassword(dir, 'admin secret');
    const s = await localProxy(dir);
    const limits = { ...ADMIN_LIMIT };
    ADMIN_LIMIT.passkeyChallengesProxyReserve = 0;
    try {
      const u = new URL(s.url);
      const auth = makeAuthenticator(u.hostname, u.origin);
      const admin = { authorization: 'Basic ' + btoa(':admin secret'), ...open, 'x-forwarded-for': address(0) };
      const register = () => fetch(`${s.url}/tabularius/admin/v1/passkeys/register/options`, { method: 'POST', headers: admin, body: '{}' });
      const opts = await (await register()).json();
      const reg = await fetch(`${s.url}/tabularius/admin/v1/passkeys/register`, { method: 'POST', headers: admin, body: JSON.stringify({ response: { ...forgeRegistration(auth, opts.challenge), challenge: opts.challenge } }) });
      assert.equal(reg.status, 200, await reg.text());
      // A small global ceiling exercises exhaustion without thousands of HTTP requests.
      ADMIN_LIMIT.passkeyChallenges = cap + 8;
      const ask = (from: string, headers: Record<string, string> = {}) => fetch(`${s.url}/tabularius/admin/v1/passkey-sign-in`, { method: 'POST', headers: { ...open, 'x-forwarded-for': from, ...headers }, body: '{}' });
      const pending: string[] = [];
      const statuses: number[] = [];
      for (let i = 0; i < cap + 9; i++) {
        const r = await ask(address(i));
        statuses.push(r.status);
        const body = await r.json();
        if (r.status === 200) pending.push(body.challenge);
        else assert.equal(body.challenge, undefined, 'refusal issues no challenge');
      }
      const legitimate = await ask('2001:db8:2::1');
      assert.equal(legitimate.status, 200, 'a flood cannot exhaust another address or /48');
      await legitimate.arrayBuffer();
      assert.deepEqual(statuses, [...Array(cap).fill(200), ...Array(9).fill(429)]);
      for (let i = 0; i < 6; i++) {
        const r = await register();
        assert.equal(r.status, 200, 'authenticated registration is exempt from the address caps');
        await r.arrayBuffer();
      }
      const authenticated = await ask(address(0), { authorization: admin.authorization });
      assert.equal(authenticated.status, 200, 'authenticated challenge requests are exempt too');
      await authenticated.arrayBuffer();
      let signCount = 0;
      for (const challenge of pending) {
        const signed = await fetch(`${s.url}/tabularius/admin/v1/passkey-sign-in`, {
          method: 'POST', headers: { ...open, 'x-forwarded-for': address(0) },
          body: JSON.stringify({ response: { ...forgeAssertion(auth, challenge, ++signCount), challenge } }),
        });
        assert.equal(signed.status, 200, await signed.text());
      }
      // Consuming challenges releases the bucket allowance, including its /48 aggregate.
      for (let i = 0; i < cap; i++) {
        const r = await ask(address(i));
        assert.equal(r.status, 200);
        await r.arrayBuffer();
      }
      const now = Math.floor(performance.now()); // whole milliseconds, so expiry boundaries compare exactly
      t.mock.method(performance, 'now', () => now + 300_001);
      const expired = await ask(address(0));
      assert.equal(expired.status, 200, 'expired challenges release both address and global capacity');
      await expired.arrayBuffer();
    } finally {
      Object.assign(ADMIN_LIMIT, limits);
      await new Promise<void>((r) => s.server.close(() => r()));
      await s.host.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const flood of ['one address', 'rotating IPv6 /64s within a /48', 'the same NAT address']) {
  test(`admin passkey challenges survive a flood from ${flood}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-challenge-'));
    createStore(join(dir, 'Charts.openhbam.sqlite'));
    setAdminPassword(dir, 'admin secret');
    const s = await localProxy(dir);
    const limits = { ...ADMIN_LIMIT };
    ADMIN_LIMIT.passkeyChallengesProxyReserve = 0;
    try {
      const u = new URL(s.url);
      const auth = makeAuthenticator(u.hostname, u.origin);
      const admin = { authorization: 'Basic ' + btoa(':admin secret'), ...open, 'x-forwarded-for': '198.51.100.10' };
      const opts = await (await fetch(`${s.url}/tabularius/admin/v1/passkeys/register/options`, { method: 'POST', headers: admin, body: '{}' })).json();
      const reg = await fetch(`${s.url}/tabularius/admin/v1/passkeys/register`, { method: 'POST', headers: admin, body: JSON.stringify({ response: { ...forgeRegistration(auth, opts.challenge), challenge: opts.challenge }, label: 'k' }) });
      assert.equal(reg.status, 200);
      ADMIN_LIMIT.passkeyChallenges = 3;
      const ask = (address: string) => fetch(`${s.url}/tabularius/admin/v1/passkey-sign-in`, { method: 'POST', headers: { ...open, 'x-forwarded-for': address }, body: '{}' });
      const pending: string[] = [];
      const real = await ask('198.51.100.10');
      assert.equal(real.status, 200);
      pending.push((await real.json()).challenge);
      for (let i = 0; i < 7; i++) {
        const address = flood === 'one address' ? '203.0.113.20'
          : flood === 'the same NAT address' ? '198.51.100.10' : `2001:db8:1:${i}::1`;
        const r = await ask(address);
        if (pending.length < ADMIN_LIMIT.passkeyChallenges) {
          assert.equal(r.status, 200);
          pending.push((await r.json()).challenge);
        } else {
          assert.equal(r.status, 429, await r.clone().text());
          assert.equal((await r.json()).challenge, undefined, 'refusal issues no challenge');
        }
      }
      let signCount = 0;
      const signIn = (challenge: string) => fetch(`${s.url}/tabularius/admin/v1/passkey-sign-in`, {
        method: 'POST', headers: admin,
        body: JSON.stringify({ response: { ...forgeAssertion(auth, challenge, ++signCount), challenge } }),
      });
      for (const challenge of pending) {
        const signed = await signIn(challenge);
        assert.equal(signed.status, 200, await signed.text());
      }
      const replay = await signIn(pending[0]);
      assert.equal(replay.status, 401, await replay.text());
      const again = await ask('198.51.100.10');
      assert.equal(again.status, 200, 'consuming pending challenges frees capacity');
      await again.arrayBuffer();
    } finally {
      Object.assign(ADMIN_LIMIT, limits);
      await new Promise<void>((r) => s.server.close(() => r()));
      await s.host.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

/** A request with headers fetch won't let a page set (Host), answered as status and JSON. */
function raw(base: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { headers }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(password: string | undefined, run: (s: { url: string }, dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-hard-'));
  createStore(join(dir, 'Charts.openhbam.sqlite'));
  if (password) setAdminPassword(dir, password);
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    await run(s, dir);
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
}

test('with no password set, the console is open only to this computer itself, by name, not through a proxy', () => withServer(undefined, async (s, dir) => {
  const status = (headers: Record<string, string> = {}) => raw(s.url, '/tabularius/admin/v1/status', headers);
  assert.equal((await status()).status, 200, 'this computer, by its address');
  assert.equal((await status({ host: 'localhost:8080' })).status, 200, 'this computer, as localhost');
  // A proxy on this computer says whom it speaks for: that is not this computer asking.
  const proxies: Record<string, string>[] = [{ 'x-forwarded-for': '203.0.113.9' }, { forwarded: 'for=203.0.113.9' }, { 'x-real-ip': '203.0.113.9' }];
  for (const h of proxies) {
    const r = await status(h);
    assert.equal(r.status, 403, JSON.stringify(h));
    assert.match(r.body.error, /only open on this machine/);
  }
  // A site that points its own name at 127.0.0.1 is not this computer by name.
  assert.equal((await status({ host: 'evil.example' })).status, 403);
  assert.equal((await status({ host: 'evil.example:80' })).status, 403);
  const proxied = await raw(s.url, '/tabularius/admin/v1/sign-in-info', { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(proxied.body.local, false);
  assert.equal(proxied.body.command, 'tabularius admin-password <folder>', 'no folder path for who is asking over a network');
  const direct = await raw(s.url, '/tabularius/admin/v1/sign-in-info');
  assert.equal(direct.body.local, true);
  assert.ok(direct.body.command.includes(dir));
}));

test('sign-in-info tells a stranger only the assistant\'s state, never its message or model', () => withServer('admin secret', async (s) => {
  const info = (await raw(s.url, '/tabularius/admin/v1/sign-in-info')).body;
  assert.deepEqual(Object.keys(info.ai), ['state']);
  assert.deepEqual(Object.keys(info).sort(), ['ai', 'command', 'hasPasskey', 'https', 'local', 'passwordSet']);
}));

test('wrong passwords from a shared address do not lock out who is signed in', () => withServer('admin secret', async (s) => {
  const signIn = (password: string) => fetch(`${s.url}/tabularius/admin/v1/sign-in`, { method: 'POST', headers: open, body: JSON.stringify({ password }) });
  const ok = await signIn('admin secret');
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie')!.split(';')[0]!;
  await ok.arrayBuffer();
  const status = async (headers: Record<string, string> = {}) => {
    const r = await fetch(`${s.url}/tabularius/admin/v1/status`, { headers: headers.cookie ? { ...headers, 'x-tabularius-admin': '1' } : headers });
    await r.arrayBuffer();
    return r.status;
  };
  assert.equal(await status({ cookie }), 200);
  for (let i = 0; i < 5; i++) await (await signIn('guess')).arrayBuffer();
  assert.equal(await status(), 429, 'a stranger is locked out');
  assert.equal(await status({ cookie }), 200, 'the signed-in console carries on');
  const again = await signIn('admin secret');
  assert.equal(again.status, 429, 'a password is still refused while the address is locked');
  await again.arrayBuffer();
}));

test('a new admin password ends every console sign-in made with the old one', () => withServer('admin secret', async (s, dir) => {
  const signIn = async (password: string) => {
    const r = await fetch(`${s.url}/tabularius/admin/v1/sign-in`, { method: 'POST', headers: open, body: JSON.stringify({ password }) });
    await r.arrayBuffer();
    return r.headers.get('set-cookie')?.split(';')[0] ?? '';
  };
  const status = async (cookie: string) => {
    const r = await fetch(`${s.url}/tabularius/admin/v1/status`, { headers: { cookie, 'x-tabularius-admin': '1' } });
    await r.arrayBuffer();
    return r.status;
  };
  const old = await signIn('admin secret');
  assert.equal(await status(old), 200);
  setAdminPassword(dir, 'another secret');
  assert.equal(await status(old), 401, 'the cookie of a sign-in made with the old password');
  const fresh = await signIn('another secret');
  assert.equal(await status(fresh), 200);
  assert.equal(await status(fresh), 200, 'and it stays good');
  assert.equal(await status(old), 401);
}));

test('/mcp answers no one without a credential, this computer included; the folder\'s own token is the administrator\'s', () => withServer(undefined, async (s, dir) => {
  const call = (headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
    const req = request(`${s.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  });
  assert.equal(await call({}), 401, 'this computer, with nothing to show');
  assert.equal(await call({ host: 'localhost:8080' }), 401);
  assert.equal(await call({ host: 'evil.example' }), 403, 'a page whose name points at 127.0.0.1: refused by the same-origin guard before authentication');
  assert.equal(await call({ 'x-forwarded-for': '203.0.113.9' }), 401);
  // The server made a token of its own on first start, in a file only its owner can read.
  const file = join(dir, MCP_LOCAL_TOKEN_FILE);
  const token = readFileSync(file, 'utf8').trim();
  assert.match(token, /^tbmcp_[A-Za-z0-9_-]{43}$/);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(await call({ authorization: `Bearer ${token}` }), 200);
  assert.equal(await call({ authorization: `Bearer ${token}x` }), 401, 'a near miss is not the token');
  assert.equal(await call({ authorization: 'Bearer ' + 'tbmcp_' + 'a'.repeat(43) }), 401);
  // Same number of characters as the token but more bytes (a header is read as latin1): refused, not a server error.
  assert.equal(await call({ authorization: `Bearer ${'\u00e9'.repeat(token.length)}` }), 401);
  // A second start in the same folder keeps the token, so an app set up once keeps working.
  const again = await serve({ dir, port: 0, log: () => {} });
  try { assert.equal(readFileSync(file, 'utf8').trim(), token); } finally { await new Promise<void>((r) => again.server.close(() => r())); }
}));
