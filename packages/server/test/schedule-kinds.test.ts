// Script schedules beyond "every N minutes": one that runs each time its file opens, a capture-only file
// that is never scheduled (or run, even from a schedule saved before), and failing schedules on the security
// health page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { setCaptureOnlyDefaults } from '../../scripts/src/index.ts';
import { serve, Schedules, setAdminPassword, type Host } from '../src/index.ts';

// No file is capture-only by default; this test names the ones it holds back.
setCaptureOnlyDefaults(['Held']);

let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-schedule-kinds-'));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  for (const name of ['Shop', 'Held_Sample']) {
    host.create(name).applyDesign([
      { op: 'createTable', name: 'Log', fields: [{ name: 'Note' }] },
      { op: 'createScript', name: 'Note it', text: 'New Record/Request\nSet Field [ Log::Note ; "opened" ]\nCommit Records/Requests' },
      { op: 'createScript', name: 'Fail', text: 'Enter Find Mode [ Pause: Off ]\nSet Field [ Log::Note ; "nothing-matches" ]\nPerform Find [ ]' },
    ]);
  }
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const admin = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/tabularius/admin/v1${path}`, {
    method,
    headers: { 'x-tabularius-admin': '1', authorization: 'Basic ' + btoa('admin:secret'), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const notes = () => host.get('Shop')!.query('SELECT Note FROM Log').length;

/** Waits for the runs set off by an opening (they start on the next turn of the event loop). */
async function settle(id: string, runs: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if ((await admin('GET', `/schedules/${id}/runs`)).body.runs.length >= runs) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('a schedule can run each time its file opens, and has no timer', async () => {
  const add = await admin('POST', '/schedules', { name: 'On open', database: 'Shop', script: 'Note it', account: 'Admin', onOpen: true });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const listed = (await admin('GET', '/schedules')).body.schedules.find((s: { id: string }) => s.id === add.body.id);
  assert.equal(listed.onOpen, true);
  assert.equal(listed.next, undefined);
  assert.equal(notes(), 0);

  assert.ok(host.closeFile('Shop'));
  assert.ok(host.openFile('Shop'));
  await settle(add.body.id, 1);
  assert.equal(notes(), 1);
  const [run] = (await admin('GET', `/schedules/${add.body.id}/runs`)).body.runs;
  assert.equal(run.error, 0);
  assert.equal(run.manual, undefined);

  // Turned off, opening the file runs nothing.
  await admin('PATCH', `/schedules/${add.body.id}`, { enabled: false });
  host.closeFile('Shop');
  host.openFile('Shop');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(notes(), 1);
  await admin('DELETE', `/schedules/${add.body.id}`);
});

test('a capture-only file is never scheduled, and a schedule saved for one before never runs', async () => {
  const add = await admin('POST', '/schedules', { name: 'x', database: 'Held_Sample', script: 'Note it', account: 'Admin', everyMinutes: 60 });
  assert.equal(add.status, 400);
  assert.match(add.body.error, /capture-only/);
  const open = await admin('POST', '/schedules', { name: 'x', database: 'Held_Sample', script: 'Note it', account: 'Admin', onOpen: true });
  assert.equal(open.status, 400);

  // One already in the schedules file (written before this rule, or by hand) is refused when it would run.
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-schedule-kinds-held-'));
  try {
    writeFileSync(join(folder, '.openhbam-schedules.json'), JSON.stringify({ schedules: [
      { id: 'abc', name: 'old', database: 'Held_Sample', script: 'Note it', account: 'Admin', everyMinutes: 60, enabled: true, onOpen: true },
    ] }));
    const held = new Schedules({ ...host, dir: folder, scriptOptions: host.scriptOptions.bind(host), get: host.get.bind(host), names: () => [], onAdd: [] } as unknown as Host);
    const run = await held.run('abc');
    held.stop();
    assert.notEqual(run.error, 0);
    assert.match(run.message ?? '', /capture-only/);
    assert.equal(host.get('Held_Sample')!.query('SELECT Note FROM Log').length, 0);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a schedule whose last run failed shows on the security health page until it runs cleanly', async () => {
  const add = await admin('POST', '/schedules', { name: 'Nightly', database: 'Shop', script: 'Fail', account: 'Admin', everyMinutes: 1440, at: '02:00' });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const run = await admin('POST', `/schedules/${add.body.id}/run`);
  assert.notEqual(run.body.error, 0);

  const health = (await admin('GET', '/health?database=Shop')).body.databases[0];
  assert.equal(health.scheduleFailures.length, 1);
  assert.equal(health.scheduleFailures[0].name, 'Nightly');
  assert.equal(health.scheduleFailures[0].failedRuns, 1);

  // Turned off, it won't fail again unattended: it leaves the list.
  await admin('PATCH', `/schedules/${add.body.id}`, { enabled: false });
  assert.deepEqual((await admin('GET', '/health?database=Shop')).body.databases[0].scheduleFailures, []);
  await admin('PATCH', `/schedules/${add.body.id}`, { enabled: true });
  assert.equal((await admin('GET', '/health?database=Shop')).body.databases[0].scheduleFailures.length, 1);

  // Pointed at a script that works, its next run clears it.
  await admin('PATCH', `/schedules/${add.body.id}`, { script: 'Note it' });
  await admin('POST', `/schedules/${add.body.id}/run`);
  assert.deepEqual((await admin('GET', '/health?database=Shop')).body.databases[0].scheduleFailures, []);
  await admin('DELETE', `/schedules/${add.body.id}`);
});

test('FileMaker\'s Admin API keeps a "when the file opens" schedule as it is when copied, and a timing it sends makes it a timer', async () => {
  const fms = (path: string, init: RequestInit = {}) =>
    fetch(`${base}/fmi/admin/api/v2${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } })
      .then(async (r) => ({ status: r.status, body: await r.json() }));
  const token = (await fms('/user/auth', { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') } })).body.response.token;
  const auth = { authorization: `Bearer ${token}` };
  const add = await admin('POST', '/schedules', { name: 'On open', database: 'Shop', script: 'Note it', account: 'Admin', onOpen: true, enabled: false });
  assert.equal(add.status, 201);
  const listed = (await fms('/schedules', { headers: auth })).body.response.schedules as { id: string; name: string; description?: string }[];
  const mine = listed.find((x) => x.name === 'On open')!;
  assert.match(mine.description ?? '', /when the file opens/);

  const copy = await fms(`/schedules?source=${mine.id}`, { method: 'POST', headers: auth });
  assert.equal(copy.body.messages[0].code, '0', copy.body.messages[0].text);
  const ours = (await admin('GET', '/schedules')).body.schedules.filter((x: { name: string }) => x.name.startsWith('On open'));
  assert.equal(ours.length, 2);
  assert.ok(ours.every((x: { onOpen?: boolean }) => x.onOpen === true), 'the copy runs when the file opens too');

  await fms(`/schedules/${mine.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ everyndaysType: { startTimeStamp: '2026-01-01T03:00:00', dailyDays: 1 } }) });
  const timed = (await admin('GET', '/schedules')).body.schedules.find((x: { id: string }) => x.id === add.body.id);
  assert.equal(timed.onOpen, undefined);
  assert.equal(timed.everyMinutes, 1440);
  for (const x of ours) await admin('DELETE', `/schedules/${x.id}`);
});
