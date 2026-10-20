// Container files in the console's Sync page: allowed in the setup, asked for in the run (with a pull), counted in
// the check, and brought by the run. Two servers on 127.0.0.1 as in sync-console.test.ts; nothing reaches a real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, setAdminPassword, type Host } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';

let dir: string;
let consoleServer: Server;
let fmServer: Server;
let host: Host;
let base: string;
let fmBase: string;
let remote: Store;
let local: Store;
let passwordFile: string;
const wasEnv = { hosts: process.env.TABULARIUS_SYNC_HOSTS, secrets: process.env.TABULARIUS_SYNC_SECRETS };

const design: DesignOp[] = [{ op: 'createTable', name: 'Contacts', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }, { name: 'Photo', type: 'container' }] } as DesignOp];
const tables = [{ localTable: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' }];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sync-containers-'));
  const fmDir = join(dir, 'fm');
  mkdirSync(fmDir);
  createStore(join(fmDir, 'Remote' + STORE_EXT));
  const fm = await serve({ dir: fmDir, port: 0, watch: false, log: () => {} });
  fmServer = fm.server;
  fmBase = fm.url;
  process.env.TABULARIUS_SYNC_SECRETS = dir;
  process.env.TABULARIUS_SYNC_HOSTS = new URL(fm.url).host;
  remote = fm.host.get('Remote')!;
  remote.applyDesign(design);
  remote.setPassword('Admin', 'pw', '[Full Access]');
  const own = join(dir, 'console');
  mkdirSync(own);
  setAdminPassword(own, 'secret');
  const s = await serve({ dir: own, port: 0, log: () => {} });
  consoleServer = s.server;
  host = s.host;
  base = s.url;
  local = host.create('Shop');
  local.applyDesign(design);
  passwordFile = join(dir, 'fm-password');
  writeFileSync(passwordFile, 'pw\n', { mode: 0o600 });
});
after(async () => {
  for (const [k, v] of [['TABULARIUS_SYNC_HOSTS', wasEnv.hosts], ['TABULARIUS_SYNC_SECRETS', wasEnv.secrets]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await new Promise<void>((resolve) => (consoleServer ? consoleServer.close(() => resolve()) : resolve()));
  await new Promise<void>((resolve) => (fmServer ? fmServer.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const admin = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/tabularius/admin/v1${path}`, {
    method,
    headers: { 'x-tabularius-admin': '1', authorization: 'Basic ' + btoa('admin:secret'), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
const setup = (extra: Record<string, unknown> = {}) => ({ server: fmBase, database: 'Remote', user: 'Admin', passwordFile, tables, ...extra });
const photo = () => {
  const id = local.query(`SELECT Photo FROM "Contacts" WHERE uuid = 'u1'`, 1)[0]?.Photo;
  return id ? local.container(Number(id)) : undefined;
};

test('container files need the setup to allow them and the run to ask', async () => {
  const made = remote.create('Contacts', { uuid: 'u1', Name: 'Ann' });
  remote.setContainer('Contacts', made.recordId, 'Photo', 1, { filename: 'ann.png', mime: 'image/png', data: new Uint8Array([1, 2, 3, 4]) });

  assert.equal((await admin('PUT', '/sync/Shop', setup({ allowPulls: true, allowContainers: 'yes' }))).status, 400);
  const saved = await admin('PUT', '/sync/Shop', setup({ allowPulls: true }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.setup.allowContainers, undefined);

  const refused = await admin('POST', '/sync/Shop/apply', { pull: true, containers: true });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /allowContainers/);
  assert.match((await admin('POST', '/sync/Shop/apply', { pull: true, containers: 'yes' })).body.error ?? 'ok', /ok|container/);

  // A pull without them brings the record only.
  const bare = await admin('POST', '/sync/Shop/apply', { pull: true });
  assert.equal(bare.status, 200, JSON.stringify(bare.body));
  assert.equal(photo(), undefined);
});

test('with the setup allowing them, a check counts the files and a pull brings them', async () => {
  assert.equal((await admin('PUT', '/sync/Shop', setup({ allowWrites: true, allowPulls: true, allowContainers: true }))).status, 200);
  // Change only the file on FileMaker: the check says one file would be fetched, and changes nothing.
  remote.setContainer('Contacts', Number(remote.query(`SELECT _fm_record_id id FROM "Contacts" WHERE uuid = 'u1'`, 1)[0].id), 'Photo', 1, { filename: 'ann.png', mime: 'image/png', data: new Uint8Array([9, 9, 9, 9]) });
  const check = await admin('POST', '/sync/Shop/check');
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.equal(check.body.tables[0].containers.checked, 1);
  assert.equal(photo(), undefined);

  const done = await admin('POST', '/sync/Shop/apply', { pull: true, containers: true });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.tables[0].containers.pulled, 1);
  assert.deepEqual([...photo()!.data], [9, 9, 9, 9]);
});
