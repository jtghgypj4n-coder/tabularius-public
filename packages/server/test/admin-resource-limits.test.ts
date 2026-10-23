import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { serve, setAdminPassword } from '../src/index.ts';
import { readJson, ApiError, lenient } from '../src/dataapi.ts';

const basic = (account: string) => ({ authorization: 'Basic ' + btoa(`${account}:secret`) });
const nested = (levels: number) => '['.repeat(levels) + '0' + ']'.repeat(levels);
async function start(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-resource-limits-'));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, mcpToken: 'secret', requestLimit: 256, requestQueue: 256 });
  t.after(async () => {
    s.server.closeAllConnections();
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  const store = s.host.create('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }, { op: 'createScript', name: 'Echo', text: 'Exit Script [ Get ( ScriptParameter ) ]' }]);
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata', 'fmmcp', 'fmrest'] });
  store.setPassword('Ann', 'secret', full.name);
  store.setPassword('Bob', 'secret', full.name);
  const login = async () => {
    const r = await fetch(`${s.url}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: basic('admin') });
    assert.equal(r.status, 200);
    return { authorization: `Bearer ${(await r.json()).response.token}` };
  };
  const adminToken = await login();
  const otherAdminToken = await login();
  const session = await fetch(`${s.url}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: basic('Ann') });
  assert.equal(session.status, 200);
  const web = { authorization: `Bearer ${(await session.json()).response.token}` };
  const surfaces = [
    { name: 'OData', path: '/fmi/odata/v4/Shop/Items', headers: basic('Ann'), body: '{"Name":"ok"}', ok: 201, other: basic('Bob'), same: web },
    { name: 'MCP', path: '/mcp', headers: { ...basic('Ann'), accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}', ok: 200, other: basic('Bob'), same: { authorization: `Bearer ${store.createApiToken('Ann', { surfaces: ['fmmcp'] })}` } },
    { name: 'admin', path: '/tabularius/admin/v1/block-new-users', headers: { ...basic('admin'), 'x-tabularius-admin': '1' }, body: '{"on":false}', ok: 200 },
    { name: 'Admin API', path: '/fmi/admin/api/v2/server/config/general', headers: adminToken, body: '{}', method: 'PATCH', ok: 200, same: otherAdminToken },
    { name: 'web client', path: '/tabularius/app/v1/databases/Shop/layouts/Items/records', headers: web, body: '{}', ok: 200 },
  ];
  return { ...s, surfaces };
}

test('shared JSON reader rejects more than 64 container levels', async () => {
  const read = (body: string) => readJson(Object.assign(Readable.from([Buffer.from(body)]), { headers: {} }) as IncomingMessage);
  assert.ok(await read(`{"extra":${nested(63)}}`));
  await assert.rejects(read(`{"extra":${nested(64)}}`), (e) => e instanceof ApiError && e.status === 400 && e.code === 960);
});

test('optional JSON bodies cannot swallow a nesting-limit violation', async () => {
  const req = Object.assign(Readable.from([Buffer.from(`{"extra":${nested(64)}}`)]), { headers: {} }) as IncomingMessage;
  await assert.rejects(readJson(req).catch(lenient({})), (e) => e instanceof ApiError && e.status === 400);
});

for (const name of ['OData', 'MCP', 'admin', 'Admin API', 'web client']) {
  test(`${name}: excessive JSON nesting uses the invalid-body response`, async (t) => {
    const s = await start(t);
    const surface = { ...s.surfaces.find((v) => v.name === name)! };
    if (name === 'OData') { surface.path = '/fmi/odata/v4/Shop/Script.Echo'; surface.body = '{}'; surface.ok = 200; }
    if (name === 'Admin API') { surface.path = '/fmi/admin/api/v2/server/status'; surface.body = '{"status":"RUNNING"}'; }
    const post = (extra: string) => fetch(s.url + surface.path, {
      method: surface.method ?? 'POST', headers: { ...surface.headers, 'content-type': 'application/json' },
      body: name === 'MCP' ? `{"jsonrpc":"2.0","id":1,"method":"ping","params":{"extra":${extra}}}` : surface.body.slice(0, -1) + (surface.body === '{}' ? '' : ',') + `"extra":${extra}}`,
    });
    const admin = name === 'admin' || name === 'Admin API';
    const acceptedLevels = admin ? 19 : name === 'MCP' ? 62 : 63;
    assert.equal((await post(nested(acceptedLevels))).status, surface.ok);
    const bad = await post(nested(acceptedLevels + 1));
    assert.equal(bad.status, 400, await bad.text());
  });
}

for (const name of ['OData', 'MCP', 'admin', 'Admin API']) {
  test(`${name}: 32 in flight per identity, other identities and static assets stay available`, async (t) => {
    const s = await start(t);
    const surface = s.surfaces.find((v) => v.name === name)!;
    const held: ClientRequest[] = [];
    const answers: Promise<void>[] = [];
    const incoming: IncomingMessage[] = [];
    s.server.on('request', (req) => { if (req.headers['x-limit-test']) incoming.push(req); });
    const post = (headers = surface.headers) => fetch(s.url + surface.path, {
      method: surface.method ?? 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: surface.body,
    });
    try {
      for (let i = 0; i < 32; i++) {
        const req = request(s.url + surface.path, { method: surface.method ?? 'POST', headers: { ...surface.headers, 'content-type': 'application/json', 'x-limit-test': '1' } });
        req.on('error', () => {});
        answers.push(new Promise<void>((resolve) => req.on('response', (res) => { res.resume(); res.on('end', resolve); })));
        req.write('{');
        held.push(req);
      }
      const deadline = Date.now() + 5000;
      while (incoming.length !== 32 || incoming.some((r) => r.listenerCount('data') === 0)) {
        assert.ok(Date.now() < deadline, 'all held requests reached their body readers');
        await delay(10);
      }
      const busy = await post(surface.same ? { ...surface.headers, ...surface.same } : surface.headers);
      assert.equal(busy.status, 503, await busy.text());
      assert.equal(busy.headers.get('retry-after'), '1');
      if (name === 'Admin API') {
        const logout = await fetch(`${s.url}/fmi/admin/api/v2/user/auth`, { method: 'DELETE', headers: surface.headers });
        assert.equal(logout.status, 503, await logout.text());
      }
      if (surface.other) assert.equal((await post({ ...surface.headers, ...surface.other })).status, surface.ok);
      assert.equal((await fetch(s.url + '/admin/')).status, 200);
      for (const req of held) req.end(surface.body.slice(1));
      await Promise.all(answers);
      assert.equal((await post()).status, surface.ok, 'completed requests release slots');
      if (name === 'Admin API') {
        const logout = await fetch(`${s.url}/fmi/admin/api/v2/user/auth`, { method: 'DELETE', headers: surface.headers });
        assert.equal(logout.status, 200);
        assert.equal((await post()).status, 401, 'the session ended after the limiter admitted logout');
      }
    } finally {
      for (const req of held) req.destroy();
    }
  });
}

test('identity bookkeeping is bounded and disconnects cannot free work still running', async () => {
  const { EventEmitter } = await import('node:events');
  const { IdentityInFlight } = await import('../src/in-flight.ts');
  const limiter = new IdentityInFlight();
  const response = () => Object.assign(new EventEmitter(), { writableFinished: false, destroyed: false });
  const held = Array.from({ length: 4096 }, (_, i) => {
    const res = response();
    const done = limiter.enter(String(i), res as unknown as ServerResponse);
    assert.ok(done);
    return { res, done };
  });
  assert.equal(limiter.enter('new', response() as unknown as ServerResponse), undefined);
  held[0].res.emit('close');
  assert.equal(limiter.enter('new', response() as unknown as ServerResponse), undefined, 'disconnect alone does not release running work');
  held[0].done();
  const res = response();
  const done = limiter.enter('new', res as unknown as ServerResponse);
  assert.ok(done);
  done();
  assert.equal(limiter.enter('next', response() as unknown as ServerResponse), undefined, 'operation alone does not release a streaming response');
  res.emit('finish');
  done();
  res.emit('close');
  assert.ok(limiter.enter('next', response() as unknown as ServerResponse));
});

test('bounded JSON parsing counts containers, ignores escaped string delimiters, and covers OData batch envelopes', async () => {
  const { parseRequestJson } = await import('../src/request-json.ts');
  const { batchRequests } = await import('../src/odata-batch.ts');
  const text = JSON.stringify({ text: '[{"\\'.repeat(1000), extra: JSON.parse(nested(63)) });
  assert.deepEqual(parseRequestJson(text), JSON.parse(text));
  assert.throws(() => parseRequestJson('{"x":' + nested(64) + '}'), /nesting/);
  assert.throws(() => parseRequestJson('{"x":' + '{"x":'.repeat(64) + '0' + '}'.repeat(65)), /nesting/);
  assert.throws(() => parseRequestJson('{"x":'), SyntaxError);
  assert.throws(() => batchRequests('application/json', Buffer.from(`{"requests":[],"extra":${nested(64)}}`)), /not valid JSON/);
});

test('web client preference reader applies the shared nesting bound', async (t) => {
  const s = await start(t);
  const web = s.surfaces.find((v) => v.name === 'web client')!;
  const r = await fetch(s.url + '/tabularius/app/v1/databases/Shop/prefs/finds', {
    method: 'PUT', headers: { ...web.headers, 'content-type': 'application/json' }, body: `{"extra":${nested(64)}}`,
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 5);
});

test('unauthenticated OAuth registration applies the shared nesting bound', async (t) => {
  const s = await start(t);
  const register = (levels: number) => fetch(s.url + '/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: `{"redirect_uris":["https://example.com/callback"],"extra":${nested(levels)}}`,
  });
  assert.equal((await register(63)).status, 201);
  const bad = await register(64);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_client_metadata');
});

test('MCP GET does not consume a request slot while POST bodies are held', async (t) => {
  const s = await start(t);
  const held: ClientRequest[] = [];
  const incoming: IncomingMessage[] = [];
  s.server.on('request', (req) => { if (req.headers['x-stream-limit-test']) incoming.push(req); });
  try {
    for (let i = 0; i < 32; i++) {
      const req = request(s.url + '/mcp', { method: 'POST', headers: { ...basic('Ann'), accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'x-stream-limit-test': '1' } });
      req.on('error', () => {});
      req.write('{');
      held.push(req);
    }
    const deadline = Date.now() + 5000;
    while (incoming.length !== 32 || incoming.some((r) => r.listenerCount('data') === 0)) {
      assert.ok(Date.now() < deadline);
      await delay(10);
    }
    const stream = await fetch(s.url + '/mcp', { headers: { ...basic('Ann'), accept: 'text/event-stream' } });
    assert.notEqual(stream.status, 503);
    await stream.body?.cancel();
  } finally {
    for (const req of held) req.destroy();
  }
});

test('MCP keeps header validation and the declared body byte limit ahead of reading', async (t) => {
  const s = await start(t);
  for (const [headers, status] of [
    [{ accept: 'application/json', 'content-type': 'application/json' }, 406],
    [{ accept: 'application/json, text/event-stream', 'content-type': 'application/json-evil' }, 415],
    [{ accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024 + 1) }, 413],
  ] as const) {
    await new Promise<void>((resolve, reject) => {
      const req = request(s.url + '/mcp', { method: 'POST', headers: { ...basic('Ann'), ...headers } }, (res) => {
        res.resume();
        try { assert.equal(res.statusCode, status); resolve(); } catch (e) { reject(e); }
        finally { req.destroy(); }
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('header rejection waited for the body')); });
      req.flushHeaders();
    });
  }
});
