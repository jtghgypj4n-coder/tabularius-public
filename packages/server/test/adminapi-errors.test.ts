import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';

test('an unexpected Admin API error gives a fixed message and logs its cause', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-adminapi-errors-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const base = `${s.url}/fmi/admin/api/v2`;
    const login = await fetch(`${base}/user/auth`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') },
    });
    assert.equal(login.status, 200);
    const { response: { token } } = await login.json();
    const credential = ['sk', 'test', 'abc123'].join('-');
    const cause = new Error(`SQLITE_CANTOPEN: api_key=${credential} unable to open /var/lib/private.db`);
    const logged = t.mock.method(console, 'error', () => {});
    const files = t.mock.method(s.host, 'files', () => { throw cause; });
    try {
      const r = await fetch(`${base}/databases`, { headers: { authorization: `Bearer ${token}` } });
      const text = await r.text();
      assert.equal(r.status, 500);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.deepEqual(JSON.parse(text), { response: {}, messages: [{ code: '-1', text: 'Internal server error' }] });
      assert.doesNotMatch(text, /SQLITE_CANTOPEN|private\.db/);
      assert.equal(logged.mock.callCount(), 1);
      const [diagnostic] = logged.mock.calls[0].arguments;
      assert.equal(typeof diagnostic, 'string');
      assert.match(diagnostic as string, /SQLITE_CANTOPEN/);
      assert.doesNotMatch(diagnostic as string, new RegExp(credential));
    } finally {
      files.mock.restore();
      logged.mock.restore();
    }
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
  }
});

test('Admin API method dispatch distinguishes known paths from unknown paths', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-adminapi-methods-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const base = `${s.url}/fmi/admin/api/v2`;
    const login = await fetch(`${base}/user/auth`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') } });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('x-content-type-options'), 'nosniff');
    const token = (await login.json()).response.token;
    const headers = { authorization: `Bearer ${token}` };
    for (const [path, method, allow] of [
      ['/user/auth', 'GET', 'POST'],
      ['/server/metadata', 'PATCH', 'GET'],
      ['/server/status', 'DELETE', 'GET, PATCH'],
      ['/databases', 'POST', 'GET, PATCH'],
      ['/databases/1', 'GET', 'PATCH, DELETE'],
      ['/clients', 'PATCH', 'GET'],
      ['/clients/1/message', 'DELETE', 'POST'],
      ['/schedules', 'PUT', 'GET, POST'],
      ['/schedules/1', 'POST', 'GET, PATCH, DELETE'],
      ['/server/certificate/import', 'GET', 'PATCH'],
    ]) {
      const r = await fetch(base + path, { method, headers });
      assert.equal(r.status, 405, `${method} ${path}`);
      assert.equal(r.headers.get('allow'), allow, `${method} ${path}`);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal((await r.json()).messages[0].code, '3');
    }
    const missing = await fetch(base + '/not-a-route', { headers });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('allow'), null);
    const oversizedId = await fetch(base + '/schedules/' + '9'.repeat(100), { headers });
    assert.equal(oversizedId.status, 400);
    assert.equal((await oversizedId.json()).messages[0].code, '960');
    const source = await fetch(base + '/schedules?source=' + '9'.repeat(100), { method: 'POST', headers });
    assert.equal(source.status, 400);
    assert.equal((await source.json()).messages[0].code, '960');
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
  }
});

test('Admin API rejects coerced values and unbounded schedule fields', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-adminapi-bounds-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const base = `${s.url}/fmi/admin/api/v2`;
    const auth = { authorization: 'Basic ' + btoa('admin:secret') };
    const login = await fetch(base + '/user/auth', { method: 'POST', headers: auth });
    const token = (await login.json()).response.token;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const bad = async (path: string, body: unknown) => {
      const r = await fetch(base + path, { method: 'PATCH', headers, body: JSON.stringify(body) });
      assert.equal(r.status, 400, `${path}: ${JSON.stringify(body).slice(0, 100)}`);
      assert.equal((await r.json()).messages[0].code, '960');
    };
    await bad('/server/status', { status: ['RUNNING'] });
    await bad('/databases', { status: ['OPENED'] });
    await bad('/server/status', { status: 'RUNNING', messageText: ['hello'] });
    const message = await fetch(base + '/schedules/message', { method: 'POST', headers, body: JSON.stringify({ name: 'm', messageType: { text: ['hello'] } }) });
    assert.equal(message.status, 400);
    const week = await fetch(base + '/schedules/message', { method: 'POST', headers, body: JSON.stringify({ name: 'm', messageType: { text: 'hello' }, weeklyType: { daysOfTheWeek: Array(10_000).fill('SUN') } }) });
    assert.equal(week.status, 400);
    assert.equal((await week.json()).messages[0].code, '960');
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
  }
});
