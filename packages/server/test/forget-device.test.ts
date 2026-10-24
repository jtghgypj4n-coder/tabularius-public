import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';
import { WebClient } from '../src/webclient.ts';
import { Admin } from '../src/admin.ts';
import { ServerConfig } from '../src/server-config.ts';

const CLEAR = '"cache", "storage"';
const APP = '/tabularius/app/v1/databases/Device';
const DATA = '/fmi/data/vLatest/databases/Device';
const DAY = 86_400_000;

async function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-device-'));
  const host = new Host(dir, () => {});
  const store = host.create('Device');
  const api = new DataApi(host), web = new WebClient(host, api), admin = new Admin(host, api);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (await api.handle(req, res, url) || await web.handle(req, res, url) || await admin.handle(req, res, url)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, token?: string, method = 'GET', webClient = true) => fetch(base + path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(webClient ? { 'x-tabularius-client': 'web' } : {}) },
  });
  const setting = (on: unknown) => fetch(base + '/tabularius/admin/v1/device-storage', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ on }),
  });
  return { dir, host, api, store, request, setting, open: (client: 'web' | 'rest' = 'web') => api.open(store, 'Admin', client) };
}

test('web sign-out clears cache/storage and ends only its token; Data API logout and ordinary replies do not clear', async t => {
  const { open, api, request } = await setup(t);
  const token = open(), other = open();
  const ordinary = await request(`${APP}/layouts`, token);
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.headers.get('clear-site-data'), null);
  const out = await request(`${APP}/sign-out`, token, 'POST');
  assert.equal(out.status, 204);
  assert.equal(out.headers.get('clear-site-data'), CLEAR);
  assert.equal(api.alive(token), false);
  assert.equal(api.alive(other), true);
  const rest = open('rest');
  const deleted = await request(`${DATA}/sessions/${rest}`, undefined, 'DELETE', false);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.headers.get('clear-site-data'), null);
});

test('forget-device requires a web session, checks its file and method, clears storage and ends it', async t => {
  const { open, api, store, request } = await setup(t);
  const token = open(), rest = open('rest');
  for (const [credential, status] of [[undefined, 401], [rest, 403], [store.createApiToken('Admin'), 403]] as const) {
    const denied = await request(`${APP}/forget-device`, credential, 'POST');
    assert.equal(denied.status, status);
    assert.equal(denied.headers.get('clear-site-data'), null);
  }
  assert.equal((await request(`${APP}/forget-device`, token)).status, 405);
  assert.equal((await request(`${APP.replace('Device', 'Other')}/forget-device`, token, 'POST')).status, 401);
  assert.equal(api.alive(token), true);
  const forgotten = await request(`${APP}/forget-device`, token, 'POST');
  assert.equal(forgotten.status, 204);
  assert.equal(forgotten.headers.get('clear-site-data'), CLEAR);
  assert.equal(api.alive(token), false);
  assert.equal(api.alive(rest), true);
  assert.equal((await request(`${APP}/layouts`, token)).status, 401);
});

test('device setting defaults off, validates booleans and persists; expired/revoked web calls clear only when on', async t => {
  const { dir, host, open, api, request, setting } = await setup(t);
  assert.equal(host.config.stopKeepingRecordData(), false);
  for (const bad of [null, 'true', 1, {}]) assert.equal((await setting(bad)).status, 400);
  for (const on of [false, true, false]) {
    assert.equal((await setting(on)).status, 200);
    assert.equal(new ServerConfig(dir).stopKeepingRecordData(), on);
    let elapsed = 0;
    const clock = t.mock.method(performance, 'now', () => elapsed);
    const token = open();
    elapsed += 16 * 60_000;
    for (const path of [`${DATA}/layouts`, `${APP}/layouts`, `${APP}/prefs`, `${APP}/runs/progress`]) {
      const expired = await request(path, token);
      assert.equal(expired.status, 401);
      assert.equal(expired.headers.get('clear-site-data'), on ? CLEAR : null);
    }
    const revoked = open();
    api.end(revoked);
    assert.equal((await request(`${DATA}/layouts`, revoked)).headers.get('clear-site-data'), on ? CLEAR : null);
    const rest = open('rest');
    api.end(rest);
    assert.equal((await request(`${DATA}/layouts`, rest, 'GET', false)).headers.get('clear-site-data'), null);
    assert.equal((await request(`${DATA}/layouts`)).headers.get('clear-site-data'), null, 'no credential is not an expired session');
    const healthy = open();
    const wrongFile = await request(APP.replace('Device', 'Other') + '/layouts', healthy);
    assert.equal(wrongFile.status, 401);
    assert.equal(wrongFile.headers.get('clear-site-data'), null, 'wrong file does not sign out a live session');
    const deleted = await request(`${DATA}/sessions/${open()}`, undefined, 'DELETE');
    assert.equal(deleted.status, 200);
    assert.equal(deleted.headers.get('clear-site-data'), null, 'Data API logout never clears, even for a web token');
    assert.equal((await request(`${APP}/layouts`, healthy)).headers.get('clear-site-data'), null);
    clock.mock.restore();
  }
});

test('30 days uses elapsed sign-in age, not activity or wall time; changing the policy applies to existing web sessions only', async t => {
  const { open, api, host, setting, request } = await setup(t);
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const web = open(), rest = open('rest');
  const touch = (token: string) => api.authorize({ headers: { authorization: `Bearer ${token}` } } as IncomingMessage, 'Device');
  host.config.setSessionIdleMinutes(1440);
  for (let day = 0; day < 31; day++) {
    elapsed += DAY;
    touch(web); touch(rest);
  }
  assert.equal(api.alive(web), true, 'off preserves long-lived active sessions');
  assert.equal((await setting(true)).status, 200);
  const expired = await request(`${DATA}/layouts`, web);
  assert.equal(expired.status, 401);
  assert.equal(expired.headers.get('clear-site-data'), CLEAR);
  assert.equal(api.alive(rest), true);
  const fresh = open();
  t.mock.timers.setTime(Date.now() + 60 * DAY);
  assert.equal(api.alive(fresh), true, 'forward wall clock edit cannot expire it');
  t.mock.timers.setTime(0);
  for (let day = 0; day < 29; day++) { elapsed += DAY; touch(fresh); }
  elapsed += DAY - 1;
  touch(fresh);
  elapsed++;
  assert.equal(api.alive(fresh), false, 'expires exactly at 30 days despite activity');
  const another = open();
  assert.equal((await setting(false)).status, 200);
  t.mock.timers.setTime(0);
  for (let day = 0; day < 31; day++) { elapsed += DAY; touch(another); }
  assert.equal(api.alive(another), true, 'turning off removes the age limit');
});
