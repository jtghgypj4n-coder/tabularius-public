// The session timeout the console sets: how long a Data API or web client session may sit idle.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-timeout-'));
  createStore(join(dir, 'Alpha' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  s.host.get('Alpha')!.setPassword('Admin', 'pw', '[Full Access]');
});
after(async () => {
  mock.restoreAll();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const setMinutes = (minutes: unknown) => fetch(`${base}/tabularius/admin/v1/session-timeout`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ minutes }),
});
const status = () => fetch(`${base}/tabularius/admin/v1/status`).then((r) => r.json() as Promise<{ server: { sessionIdleMinutes: number } }>);
const post = (body: unknown) => fetch(`${base}/tabularius/admin/v1/session-timeout`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify(body),
});
const webStatus = () => fetch(`${base}/tabularius/admin/v1/status`).then((r) => r.json() as Promise<{ server: { sessionIdleMinutes: number; webSessionIdleMinutes: number } }>);
const login = async () => {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Alpha/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}',
  });
  return ((await r.json()) as { response: { token: string } }).response.token;
};
const layouts = (token: string) => fetch(`${base}/fmi/data/vLatest/databases/Alpha/layouts`, { headers: { authorization: `Bearer ${token}` } });

test('15 minutes by default; the console changes it, refuses nonsense, and sessions follow it', async () => {
  assert.equal((await status()).server.sessionIdleMinutes, 15);
  for (const bad of [0, 1441, 2.5, '10', null]) assert.equal((await setMinutes(bad)).status, 400, `refuses ${String(bad)}`);
  assert.deepEqual(await (await setMinutes(2)).json(), { sessionIdleMinutes: 2 });
  assert.equal((await status()).server.sessionIdleMinutes, 2);

  const token = await login();
  let elapsed = performance.now();
  mock.method(performance, 'now', () => elapsed);
  try {
    elapsed += 90_000;
    assert.equal((await layouts(token)).status, 200, 'inside 2 minutes');
    elapsed += 3 * 60_000;
    const gone = await layouts(token);
    assert.equal(gone.status, 401, 'past 2 minutes');
    assert.equal(((await gone.json()) as { messages: { code: string }[] }).messages[0].code, '952');
  } finally {
    mock.restoreAll();
  }

  // Back to 15: back to the default, and a session lives through 14 idle minutes.
  assert.deepEqual(await (await setMinutes(15)).json(), { sessionIdleMinutes: 15 });
  const again = await login();
  elapsed = performance.now();
  mock.method(performance, 'now', () => elapsed);
  try {
    elapsed += 14 * 60_000;
    assert.equal((await layouts(again)).status, 200);
  } finally {
    mock.restoreAll();
  }
});

test('the web client has its own limit; null makes it follow the Data API again', async () => {
  assert.deepEqual(await (await setMinutes(15)).json(), { sessionIdleMinutes: 15 });
  assert.equal((await webStatus()).server.webSessionIdleMinutes, 15, 'follows the Data API by default');
  assert.deepEqual(await (await post({ minutes: 20 })).json(), { sessionIdleMinutes: 20 });
  assert.equal((await webStatus()).server.webSessionIdleMinutes, 20, 'still following');

  assert.deepEqual(await (await post({ webMinutes: 5 })).json(), { sessionIdleMinutes: 20, webSessionIdleMinutes: 5 });
  let s = (await webStatus()).server;
  assert.equal(s.sessionIdleMinutes, 20);
  assert.equal(s.webSessionIdleMinutes, 5);

  for (const bad of [0, 1441, 2.5, '10']) assert.equal((await post({ webMinutes: bad })).status, 400, `refuses ${String(bad)}`);
  assert.equal((await post({})).status, 400, 'needs one of them');
  // A refused web value leaves the Data API's value alone.
  assert.equal((await post({ minutes: 7, webMinutes: 0 })).status, 400);
  assert.equal((await webStatus()).server.sessionIdleMinutes, 20);

  assert.deepEqual(await (await post({ webMinutes: null })).json(), { sessionIdleMinutes: 20, webSessionIdleMinutes: 20 });
  s = (await webStatus()).server;
  assert.equal(s.webSessionIdleMinutes, 20);
  assert.deepEqual(await (await setMinutes(15)).json(), { sessionIdleMinutes: 15 });
});

test('the status says whether the web client has its own timeout, so the console can leave its box empty while it follows', async () => {
  const own = () => fetch(`${base}/tabularius/admin/v1/status`).then((r) => r.json() as Promise<{ server: { sessionIdleMinutes: number; webSessionIdleMinutes: number; webSessionIdleOwn: boolean } }>);
  assert.equal((await post({ webMinutes: null })).status, 200);
  assert.deepEqual([(await own()).server.webSessionIdleOwn, (await own()).server.webSessionIdleMinutes === (await own()).server.sessionIdleMinutes], [false, true]);
  assert.equal((await post({ webMinutes: 30 })).status, 200);
  assert.deepEqual([(await own()).server.webSessionIdleOwn, (await own()).server.webSessionIdleMinutes], [true, 30]);
  // Changing the Data API's alone leaves the web client's own setting where it was.
  assert.equal((await post({ minutes: 20 })).status, 200);
  assert.deepEqual([(await own()).server.webSessionIdleOwn, (await own()).server.webSessionIdleMinutes], [true, 30]);
  assert.equal((await post({ webMinutes: null })).status, 200);
  assert.deepEqual([(await own()).server.webSessionIdleOwn, (await own()).server.webSessionIdleMinutes], [false, 20]);
});

test('the width below which layouts stack: 640 by default, the console changes it, refuses nonsense, and the web client is told', async () => {
  const put = (stackBelow: unknown) => fetch(`${base}/tabularius/admin/v1/responsive`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ stackBelow }),
  });
  const now = async () => ((await (await fetch(`${base}/tabularius/admin/v1/status`)).json()) as { server: { responsiveStackBelow: number } }).server.responsiveStackBelow;
  assert.equal(await now(), 640);
  for (const bad of [-1, 10001, 2.5, '480', undefined]) assert.equal((await put(bad)).status, 400, `refuses ${String(bad)}`);
  assert.deepEqual(await (await put(480)).json(), { responsiveStackBelow: 480 });
  assert.equal(await now(), 480);
  assert.deepEqual(await (await put(0)).json(), { responsiveStackBelow: 0 }, '0 is never');
  assert.deepEqual(await (await put(null)).json(), { responsiveStackBelow: 640 }, 'null is the default again');
  assert.equal(await now(), 640);
});
