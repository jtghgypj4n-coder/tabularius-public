import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api, ApiError, listDatabases, retryableRequest } from '../src/api.ts';

test('busy sign-in discovery preserves 503 so the app can show its retry screen', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ messages: [{ code: '301', message: 'Busy' }] }), { status: 503 }));
  await assert.rejects(listDatabases(), (e) => e instanceof ApiError && e.status === 503);
  await assert.rejects(Api.login('Scratch', 'Admin', 'pw'), (e) => e instanceof ApiError && e.status === 503);
});

test('Data API writes queue per token, including uploads, while reads and other tokens proceed', async (t) => {
  const calls: { method: string; token: string; body: unknown }[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', async (_path: unknown, init: RequestInit) => {
    const token = (init.headers as Record<string, string>).authorization;
    calls.push({ method: init.method!, token, body: init.body });
    const first = calls.length === 1;
    if (first) { entered(); await held; }
    return new Response(JSON.stringify({
      messages: [{ code: first ? '301' : '0', message: first ? 'Busy' : 'OK' }],
      response: { recordId: '1', data: [], dataInfo: { foundCount: 0, totalRecordCount: 0 } },
    }), { status: first ? 503 : 200 });
  });
  const api = new Api('Scratch', 'shared');
  const same = new Api('Scratch', 'shared');
  const other = new Api('Scratch', 'other');
  const first = assert.rejects(api.create('Rows'), (e) => e instanceof ApiError && e.code === 301);
  await started;
  const upload = same.upload('Rows', '1', 'Photo', 1, new File(['image'], 'photo.png'));
  const next = api.create('Rows');
  try {
    await Promise.all([
      api.records('Rows', { offset: 1, limit: 1 }),
      api.records('Rows', { offset: 1, limit: 1, query: [{ Name: 'one' }] }),
      other.create('Rows'),
    ]);
    assert.equal(calls.length, 4, 'two reads and the other token proceed while two writes wait');
  } finally {
    release();
    await Promise.all([first, upload, next]);
  }
  assert.equal(calls.length, 6);
  assert.ok(calls[4].body instanceof FormData, 'the queued upload retains its multipart body');
});

test('retry classification distinguishes transport/server failures from terminal API errors', () => {
  for (const code of [9, 10, 101, 102, 105, 200, 201, 202, 401, 500, 509, 952]) {
    assert.equal(retryableRequest(new ApiError(code, 'Terminal API error', undefined, 500)), false, `code ${code}`);
  }
  for (const code of [300, 301, 302, 303, 304, 306, 307, 812]) {
    assert.equal(retryableRequest(new ApiError(code, 'Temporary condition')), true, `code ${code}`);
  }
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(retryableRequest(new ApiError(-1, 'HTTP failure', undefined, status)), true, `HTTP ${status}`);
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(retryableRequest(new ApiError(-1, 'HTTP failure', undefined, status)), false, `HTTP ${status}`);
  }
  assert.equal(retryableRequest(new ApiError(-1, 'Denied', { operation: 'read', permission: 'view', explanation: 'Denied' }, 503)), false);
  assert.equal(retryableRequest(new TypeError('Failed to fetch')), true);
  assert.equal(retryableRequest(Object.assign(new Error('Aborted'), { name: 'AbortError' })), true);
  assert.equal(retryableRequest(Object.assign(new Error('Timeout'), { name: 'TimeoutError' })), true);
  assert.equal(retryableRequest(new Error('Unexpected response')), false);
});

for (const protocol of ['app', 'data']) test(`the ${protocol} API preserves HTTP status for retry classification`, async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(protocol === 'app'
    ? { error: { code: -1, message: 'Service unavailable' } }
    : { messages: [{ code: '-1', message: 'Service unavailable' }] }), { status: 503 }));
  const api = new Api('Scratch', 'token');
  await assert.rejects(protocol === 'app'
    ? api.foundSetPortal('Rows', { portal: 'found', offset: 1, limit: 1 })
    : api.record('Rows', '1'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    assert.equal(retryableRequest(error), true);
    return true;
  });
});
