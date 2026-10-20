// Scheduled syncs, through the server's schedules: a check by default, an opt-in to send or bring in changes (which
// the file's sync setup has to allow as well), and an alert (the schedule's run, the security health report and
// the Event log) while records changed on both sides wait for an administrator. Two servers on 127.0.0.1 in this
// process: the console's, and one standing in for FileMaker Server with Tabularius's own Data API. Nothing here can
// reach a real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { setCaptureOnlyDefaults, captureOnlyDefaults } from '../../scripts/src/index.ts';
import { serve, setAdminPassword, type Host } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';

const wasHeld = [...captureOnlyDefaults()];
setCaptureOnlyDefaults(['Held'], true);

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

const design: DesignOp[] = [{ op: 'createTable', name: 'Contacts', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }] } as DesignOp];
const tables = [{ localTable: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' }];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sync-schedules-'));
  const fmDir = join(dir, 'fm');
  mkdirSync(fmDir);
  createStore(join(fmDir, 'Remote' + STORE_EXT));
  const fm = await serve({ dir: fmDir, port: 0, watch: false, log: () => {} });
  fmServer = fm.server;
  fmBase = fm.url;
  // What the operator of this server says: where passwords are kept, and which FileMaker Server it may reach (a stand-in, here).
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
  host.create('Held_Books').applyDesign(design);
  passwordFile = join(dir, 'fm-password');
  writeFileSync(passwordFile, 'pw\n', { mode: 0o600 });
});
after(async () => {
  for (const [k, v] of [['TABULARIUS_SYNC_HOSTS', wasEnv.hosts], ['TABULARIUS_SYNC_SECRETS', wasEnv.secrets]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  setCaptureOnlyDefaults(wasHeld, true);
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
const names = (s: Store) => s.query('SELECT uuid, Name FROM "Contacts" ORDER BY uuid', 100).map((r) => ({ ...r }));
const remoteId = (uuid: string) => Number(remote.query(`SELECT _fm_record_id id FROM "Contacts" WHERE uuid = '${uuid}'`, 1)[0].id);
const localId = (uuid: string) => Number(local.query(`SELECT _fm_record_id id FROM "Contacts" WHERE uuid = '${uuid}'`, 1)[0].id);
const health = async () => (await admin('GET', '/health?database=Shop')).body.databases[0];
const eventLog = async () => {
  await host.logs?.flush();
  try {
    return readFileSync(join(dir, 'console', 'Logs', 'Event.log'), 'utf8');
  } catch {
    return '';
  }
};
const schedule = (extra: Record<string, unknown> = {}) => admin('POST', '/schedules', { database: 'Shop', everyMinutes: 60, sync: {}, ...extra });

test('a sync schedule needs a sync setup, and asks for no more than the setup allows', async () => {
  const none = await schedule();
  assert.equal(none.status, 400);
  assert.match(none.body.error, /Shop has no sync set up/);

  assert.equal((await admin('PUT', '/sync/Shop', setup())).status, 200);
  assert.match((await schedule({ sync: { write: true } })).body.error, /doesn't allow writing to FileMaker/);
  assert.match((await schedule({ sync: { pull: true } })).body.error, /doesn't allow changing it from FileMaker/);
  assert.match((await schedule({ sync: { delete: true } })).body.error, /unknown sync option "delete"/);
  assert.match((await schedule({ sync: { write: 'yes' } })).body.error, /true or false/);
  assert.match((await schedule({ sync: [] })).body.error, /is an object/);
  assert.match((await schedule({ everyMinutes: 2 })).body.error, /at most every 5 minutes/);
  assert.match((await schedule({ at: '25:00' })).body.error, /HH:MM/);
  assert.match((await schedule({ script: 'Anything' })).body.error, /no script, account/);
  const held = await schedule({ database: 'Held_Books' });
  assert.equal(held.status, 400);
  assert.match(held.body.error, /capture-only/);

  // A password nobody can type at 3 a.m.: a schedule needs one the server has.
  assert.equal((await admin('PUT', '/sync/Shop', setup({ passwordFile: 'missing' }))).status, 200);
  assert.match((await schedule()).body.error, /can't be typed a password/);
  assert.equal((await admin('PUT', '/sync/Shop', setup())).status, 200);

  const ok = await schedule();
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.sync, {});
  assert.equal(ok.body.name, 'Sync Shop');
  assert.equal(ok.body.script, '');
  await admin('DELETE', `/schedules/${ok.body.id}`);
});

test('by default a scheduled sync only checks: it reads both sides, writes neither, and raises an alert for records changed on both', async () => {
  remote.create('Contacts', { uuid: 'same', Name: 'Same' });
  local.create('Contacts', { uuid: 'same', Name: 'Same' });
  remote.create('Contacts', { uuid: 'both', Name: 'FileMaker version' });
  local.create('Contacts', { uuid: 'both', Name: 'Local version' });
  local.create('Contacts', { uuid: 'new-here', Name: 'Only here' });
  remote.create('Contacts', { uuid: 'new-there', Name: 'Only there' });
  const before = JSON.stringify([names(local), names(remote)]);

  const add = await schedule({ everyMinutes: 30 });
  assert.equal(add.status, 201);
  assert.deepEqual((await health()).syncAlerts, []);

  const run = (await admin('POST', `/schedules/${add.body.id}/run`)).body;
  assert.equal(run.error, 0, JSON.stringify(run));
  assert.equal(run.conflicts, 1);
  assert.match(run.result, /^Checked: 2 records would move, 1 changed on both sides$/);
  assert.equal(run.steps, 0, 'a check moves nothing');
  assert.equal(JSON.stringify([names(local), names(remote)]), before);

  // The alert: on the health report, in the Event log (once, not at every run), and in the sync status the page shows.
  const [alert] = (await health()).syncAlerts;
  assert.deepEqual([alert.name, alert.conflicts, alert.write, alert.pull, alert.problem], ['Sync Shop', 1, false, false, undefined]);
  assert.equal((await health()).scheduleFailures.length, 0, 'a conflict is not a failed script');
  await admin('POST', `/schedules/${add.body.id}/run`);
  const warned = (await eventLog()).split('\n').filter((l) => l.includes('changed on both sides and wait for a decision'));
  assert.equal(warned.length, 1);
  assert.match(warned[0], /\tWarning\tShop\t.*1 record is changed on both sides/);
  assert.equal((await admin('GET', '/sync/Shop')).body.last.trigger, 'scheduled');
  assert.equal((await admin('GET', '/sync/Shop')).body.last.conflicts.length, 1);
  assert.equal((await admin('GET', '/sync/Shop/log')).body.log.length, 0, 'a check logs nothing: it sends nothing');
  assert.equal((await admin('GET', '/schedules')).body.schedules.find((s: { id: string }) => s.id === add.body.id).last.conflicts, 1);
  await admin('DELETE', `/schedules/${add.body.id}`);
  assert.deepEqual((await health()).syncAlerts, []);
});

test('a schedule that sends or brings in changes needs the setup to allow it; conflicts stop it before anything moves', async () => {
  assert.equal((await admin('PUT', '/sync/Shop', setup({ allowWrites: true, allowPulls: true }))).status, 200);
  const add = await schedule({ sync: { write: true, pull: true } });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const before = JSON.stringify([names(local), names(remote)]);

  const held = (await admin('POST', `/schedules/${add.body.id}/run`)).body;
  assert.equal(held.error, 0, 'held for review is not an error');
  assert.equal(held.conflicts, 1);
  assert.equal(JSON.stringify([names(local), names(remote)]), before, 'a conflict stops the run before anything is written');
  assert.equal((await health()).syncAlerts[0].write, true);

  // An administrator settles it in the Sync page; the next scheduled run moves the rest and the alert clears.
  const review = await admin('POST', '/sync/Shop/check');
  const done = await admin('POST', '/sync/Shop/apply', { write: true, pull: true, resolutions: [{ table: 'Contacts', uuid: 'both', keep: 'theirs', reviewToken: review.body.conflicts[0].reviewToken }] });
  assert.equal(done.body.refused, undefined, JSON.stringify(done.body));
  local.create('Contacts', { uuid: 'later-here', Name: 'Later, here' });
  remote.create('Contacts', { uuid: 'later-there', Name: 'Later, there' });
  const clean = (await admin('POST', `/schedules/${add.body.id}/run`)).body;
  assert.equal(clean.error, 0, JSON.stringify(clean));
  assert.equal(clean.conflicts, undefined);
  assert.equal(clean.steps, 2);
  assert.match(clean.result, /^Ran: 2 records moved$/);
  assert.deepEqual(names(local), names(remote));
  assert.deepEqual((await health()).syncAlerts, []);
  assert.match(await eventLog(), /no records are waiting for a decision any more/);

  // Deletions never ride a schedule: a record deleted on FileMaker stays here until someone allows it.
  remote.delete('Contacts', remoteId('later-there'));
  local.delete('Contacts', localId('new-here'));
  const held2 = (await admin('POST', `/schedules/${add.body.id}/run`)).body;
  assert.equal(held2.error, 0);
  assert.equal(names(local).some((r) => r.uuid === 'later-there'), true);
  assert.equal(names(remote).some((r) => r.uuid === 'new-here'), true);
  await admin('DELETE', `/schedules/${add.body.id}`);
});

test('turning the setup\'s permission off stops a schedule that relied on it, and its failure is an alert', async () => {
  const add = await schedule({ sync: { write: true } });
  assert.equal(add.status, 201);
  assert.equal((await admin('PUT', '/sync/Shop', setup({ allowPulls: true }))).status, 200);
  local.create('Contacts', { uuid: 'blocked', Name: 'Must not be sent' });
  const run = (await admin('POST', `/schedules/${add.body.id}/run`)).body;
  assert.notEqual(run.error, 0);
  assert.match(run.message, /doesn't allow writing to FileMaker/);
  assert.equal(names(remote).some((r) => r.uuid === 'blocked'), false);
  const [alert] = (await health()).syncAlerts;
  assert.match(alert.problem, /doesn't allow writing/);
  assert.equal((await health()).scheduleFailures.length, 0, 'it is a sync alert, not a failing script');

  // It can't be turned from a sync into a script schedule, and the Admin API (which only knows script schedules) never lists it.
  assert.match((await admin('PATCH', `/schedules/${add.body.id}`, { sync: { write: true, pull: true } })).body.error, /allow/);
  const fms = await fetch(`${base}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') } }).then((r) => r.json());
  const listed = await fetch(`${base}/fmi/admin/api/v2/schedules`, { headers: { authorization: `Bearer ${fms.response.token}` } }).then((r) => r.json());
  assert.deepEqual(listed.response.schedules, []);
  await admin('DELETE', `/schedules/${add.body.id}`);
});
