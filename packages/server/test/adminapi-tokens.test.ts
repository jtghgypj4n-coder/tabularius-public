import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';

async function setup(t: TestContext, publicUrl?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-adminapi-tokens-'));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, watch: false, publicUrl, log: () => {} });
  t.after(async () => {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `${s.url}/fmi/admin/api/v2`;
  return {
    dir,
    base,
    async login(password = 'secret') {
      const r = await fetch(`${base}/user/auth`, {
        method: 'POST', headers: { authorization: 'Basic ' + btoa(`admin:${password}`) },
      });
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.equal(body.messages[0].code, '0');
      return body.response.token as string;
    },
    async use(token: string) {
      const r = await fetch(`${base}/server/metadata`, { headers: { authorization: `Bearer ${token}` } });
      return { status: r.status, body: await r.json() };
    },
  };
}

function denied(r: { status: number; body: unknown }): void {
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { response: {}, messages: [{ code: '9', text: 'Access denied' }] });
}

test('Admin API tokens stop working immediately after the admin password changes', async (t) => {
  const api = await setup(t);
  const token = await api.login();
  assert.equal((await api.use(token)).status, 200);
  setAdminPassword(api.dir, 'changed');
  denied(await api.use(token));
  const fresh = await api.login('changed');
  assert.equal((await api.use(fresh)).status, 200);
  denied(await api.use(token));
});

test('Admin API failures reveal no account existence through password or lockout messages', async (t) => {
  const api = await setup(t);
  const attempt = async (user: string) => {
    const r = await fetch(`${api.base}/user/auth`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa(`${user}:wrong`) },
    });
    return { status: r.status, retryAfter: r.headers.get('retry-after'), body: await r.json() };
  };
  assert.deepEqual(await attempt('does-not-exist'), await attempt('admin'));
  await attempt('does-not-exist');
  await attempt('admin');
  const locked = await attempt('does-not-exist');
  assert.equal(locked.status, 429);
  assert.deepEqual(locked, await attempt('admin'));
});

for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=form', 'application/json']) {
  test(`Admin API refuses cross-origin ${contentType} login with cached Basic credentials`, async (t) => {
    const api = await setup(t);
    const r = await fetch(`${api.base}/user/auth`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + btoa('admin:secret'), 'content-type': contentType, origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { response: {}, messages: [{ code: '9', text: 'Access denied' }] });
    assert.equal((await api.use(await api.login())).status, 200);
  });
}

for (const headers of [
  { 'sec-fetch-site': 'cross-site' },
  { 'sec-fetch-site': 'same-site' },
  { origin: 'null' },
  { origin: 'not an origin' },
] as Record<string, string>[]) {
  test(`Admin API refuses untrusted browser login metadata ${JSON.stringify(headers)}`, async (t) => {
    const api = await setup(t);
    const r = await fetch(`${api.base}/user/auth`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret'), ...headers },
    });
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { response: {}, messages: [{ code: '9', text: 'Access denied' }] });
  });
}

test('Admin API accepts native JSON clients and same-origin browser logins', async (t) => {
  const api = await setup(t);
  for (const headers of [{}, { origin: new URL(api.base).origin, 'sec-fetch-site': 'same-origin' }] as Record<string, string>[]) {
    const r = await fetch(`${api.base}/user/auth`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret'), 'content-type': 'application/json', ...headers }, body: '{}',
    });
    assert.equal(r.status, 200);
    assert.equal((await api.use((await r.json()).response.token)).status, 200);
  }
});

test('cross-site form logins cannot exhaust the Admin API token slots', async (t) => {
  const api = await setup(t);
  const statuses: number[] = [];
  // More than MAX_TOKENS attempts must leave room for a legitimate login.
  for (let i = 0; i < 101; i++) {
    const r = await fetch(`${api.base}/user/auth`, {
      method: 'POST', headers: {
        authorization: 'Basic ' + btoa('admin:secret'), 'content-type': 'text/plain', origin: 'https://evil.example',
      }, body: '{}',
    });
    statuses.push(r.status);
    await r.arrayBuffer();
  }
  assert.equal((await api.use(await api.login())).status, 200);
  assert.ok(statuses.every((status) => status === 403));
});

test('Admin API browser login uses the configured public origin behind a proxy', async (t) => {
  const api = await setup(t, 'https://files.example');
  for (const origin of ['https://files.example', 'https://evil.example']) {
    const r = await fetch(`${api.base}/user/auth`, {
      method: 'POST', headers: {
        authorization: 'Basic ' + btoa('admin:secret'), 'content-type': 'application/json', origin,
        'sec-fetch-site': 'same-origin', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https',
      }, body: '{}',
    });
    assert.equal(r.status, origin === 'https://files.example' ? 200 : 403);
    const body = await r.json();
    if (r.status === 200) assert.equal((await api.use(body.response.token)).status, 200);
    else assert.deepEqual(body.response, {});
  }
});

test('Admin API tokens expire after eight hours even when continually used', async (t) => {
  const api = await setup(t);
  let now = performance.now();
  t.mock.method(performance, 'now', () => now);
  const started = now;
  const token = await api.login();
  // Keep it active every ten minutes: an idle timeout cannot explain the refusal.
  for (let minutes = 10; minutes < 480; minutes += 10) {
    now = started + minutes * 60_000;
    assert.equal((await api.use(token)).status, 200);
  }
  now = started + 8 * 60 * 60_000 - 1;
  assert.equal((await api.use(token)).status, 200);
  now++;
  denied(await api.use(token));
  now++;
  denied(await api.use(token));
  assert.equal((await api.use(await api.login())).status, 200);
});

test('Admin API tokens still expire after fifteen minutes idle', async (t) => {
  const api = await setup(t);
  let now = performance.now();
  t.mock.method(performance, 'now', () => now);
  const token = await api.login();
  now += 14 * 60_000;
  assert.equal((await api.use(token)).status, 200);
  now += 15 * 60_000 + 1;
  denied(await api.use(token));
});

test('Admin API distinguishes missing or non-Basic login syntax from a wrong password', async (t) => {
  const api = await setup(t);
  for (const authorization of [undefined, 'Bearer unrelated', 'Digest unrelated', 'Basic']) {
    const response = await fetch(`${api.base}/user/auth`, { method: 'POST', headers: authorization ? { authorization } : {} });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).messages[0].code, '1702');
  }
});

test('Admin API idle expiry ignores forward and backward wall-clock jumps', async (t) => {
  const api = await setup(t);
  let wall = Date.now(), mono = performance.now();
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  const token = await api.login();
  wall += 3600_000;
  mono += 1000;
  assert.equal((await api.use(token)).status, 200);
  wall -= 7200_000;
  mono += 16 * 60_000;
  denied(await api.use(token));
});
