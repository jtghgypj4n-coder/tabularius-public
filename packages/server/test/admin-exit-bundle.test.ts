// The console's portable copy: POST /tabularius/admin/v1/exit-bundle writes <hosted folder>/Exports/<name>, only for a
// Full Access account that signs in again, and the scan for hosted files never reads Exports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, setAdminPassword } from '../src/index.ts';
import { Host } from '../src/host.ts';
import { createStore, Store } from '../../store/src/index.ts';

const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');
const CONSOLE = ['console', 'passphrase', 'for', 'tests'].join(' ');
const REMOTE = '203.0.113.5';
let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-exit-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  const store = new Store(join(dir, 'Shop.openhbam.sqlite'), 'Shop');
  store.applyDesign([{ op: 'createTable', name: 'Orders', fields: [{ name: 'Customer', type: 'text' }] }]);
  store.create('Orders', { Customer: 'Zelda' });
  store.setPassword('Admin', PASSWORD);
  store.setPassword('twofactor', PASSWORD, '[Full Access]');
  store.close();
  setAdminPassword(dir, CONSOLE);
  const s = await serve({ dir, port: 0, log: () => {}, proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1', '::1'] });
  s.server.prependListener('request', (req) => { req.headers['x-forwarded-for'] ??= REMOTE; });
  server = s.server;
  base = s.url;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

const headers = { authorization: `Basic ${btoa(`:${CONSOLE}`)}`, 'x-tabularius-admin': '1', 'content-type': 'application/json' };
const post = (route: string, body: unknown, auth: Record<string, string> = headers) =>
  fetch(`${base}/tabularius/admin/v1/${route}`, { method: 'POST', headers: auth, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() as Record<string, unknown> }));
const copy = (name: string, extra: Record<string, unknown> = {}) => post('exit-bundle', { database: 'Shop', name, account: 'Admin', password: PASSWORD, ...extra });

test('an unauthenticated request is refused before any bundle code runs', async () => {
  const r = await post('exit-bundle', { database: 'Shop', name: 'x', account: 'Admin', password: PASSWORD }, { 'x-tabularius-admin': '1', 'content-type': 'application/json' });
  assert.equal(r.status, 401);
  assert.equal(existsSync(join(dir, 'Exports')), false);
});

test('bad names, missing credentials and unhosted files are refused', async () => {
  for (const name of ['', '.', '..', '../escape', 'a/b', '.hidden', 'x.partial', 'a'.repeat(81)]) assert.equal((await copy(name)).status, 400, name);
  assert.equal((await post('exit-bundle', { database: 'Shop', name: 'ok' })).status, 400);
  assert.equal((await post('exit-bundle', { database: 'Nothing', name: 'ok', account: 'Admin', password: PASSWORD })).status, 404);
  assert.equal(existsSync(join(dir, 'Exports', 'ok')), false);
});

test('a wrong password and an unknown account are refused with the same answer', async () => {
  const wrong = await copy('refused', { password: 'not it' });
  const unknown = await copy('refused', { account: 'nobody' });
  assert.equal(wrong.status, 403);
  assert.deepEqual(unknown, wrong);
});

test('a second factor makes the remote request fail closed: the console address is never empty', async () => {
  const store = new Store(join(dir, 'Shop.openhbam.sqlite'), 'Shop');
  try {
    store.setAccountRequire2fa('twofactor', true);
  } finally {
    store.close();
  }
  const r = await copy('with-second-factor', { account: 'twofactor' });
  assert.equal(r.status, 403);
  assert.match(String(r.body.error), /second factor/);
  assert.equal(existsSync(join(dir, 'Exports', 'with-second-factor')), false);
});

test('success writes under Exports, never hosts it, and a second request for the same name is a 409', async () => {
  const r = await copy('first');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, folder: 'Exports/first', tables: 1, rows: 1, containers: 0 });
  assert.ok(existsSync(join(dir, 'Exports', 'first', 'data.sqlite')));
  assert.equal((await copy('first')).status, 409);
  const host = new Host(dir);
  try {
    assert.deepEqual(host.names(), ['Shop']);
  } finally {
    await host.close();
  }
});

test('an unfinished copy is discarded through the console, and 404 says when there is none', async () => {
  assert.equal((await post('exit-bundle/discard', { database: 'Shop', name: 'none', account: 'Admin', password: PASSWORD })).status, 404);
  mkdirSync(join(dir, 'Exports', 'half.partial'), { mode: 0o700 });
  const r = await post('exit-bundle/discard', { database: 'Shop', name: 'half', account: 'Admin', password: PASSWORD });
  assert.equal(r.status, 200);
  assert.equal(existsSync(join(dir, 'Exports', 'half.partial')), false);
  assert.equal((await post('exit-bundle/discard', { database: 'Shop', name: 'half', account: 'Admin', password: 'wrong' })).status, 403);
});

test('an Exports that is a symlink is refused', async () => {
  const real = join(dir, 'elsewhere');
  mkdirSync(real);
  rmSync(join(dir, 'Exports'), { recursive: true, force: true });
  symlinkSync(real, join(dir, 'Exports'));
  const r = await copy('through-a-link');
  assert.equal(r.status, 409);
  assert.deepEqual(readdirSync(real), []);
  rmSync(join(dir, 'Exports'));
});
