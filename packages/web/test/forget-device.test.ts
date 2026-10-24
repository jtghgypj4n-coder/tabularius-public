import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../src/api.ts';

const token = ['device', 'session'].join('-');

for (const interactive of [true, false]) {
  test(`${interactive ? 'interactive sign-out uses the web route' : 'temporary cleanup uses Data API logout without clearing'}`, async t => {
    const calls: { path: string; init: RequestInit }[] = [];
    t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
      calls.push({ path, init });
      return new Response(null, { status: 204 });
    });
    const api = new Api('Device', token);
    if (interactive) await api.logout();
    else await api.endSession();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, interactive ? '/tabularius/app/v1/databases/Device/sign-out' : `/fmi/data/vLatest/databases/Device/sessions/${token}`);
    assert.equal(calls[0].init.method, interactive ? 'POST' : 'DELETE');
    if (interactive) assert.equal(new Headers(calls[0].init.headers).get('authorization'), `Bearer ${token}`);
  });
}

test('record calls identify the browser even after the server forgets a revoked token', async t => {
  let expired = 0;
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('x-tabularius-client'), 'web');
    return new Response(JSON.stringify({ messages: [{ code: '952', message: 'Session ended' }] }), { status: 401 });
  });
  const api = new Api('Device', token);
  api.onExpired = () => expired++;
  await assert.rejects(api.record('Layout', '1'));
  assert.equal(expired, 1);
});
