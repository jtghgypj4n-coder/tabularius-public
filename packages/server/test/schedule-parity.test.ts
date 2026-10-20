// Schedules beyond scripts, where FileMaker Server has them (notes/audits/audit-schedule-parity.md): a backup schedule
// reads its new set back ("Verify"), a verify schedule reads every page of the hosted files, and a scheduled time that
// arrives while the schedule is still running is skipped and logged rather than dropped without a word.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, setAdminPassword, Schedules, type Host } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';

let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-schedule-parity-'));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  host.create('Shop').applyDesign([
    { op: 'createTable', name: 'Log', fields: [{ name: 'Note' }] },
    { op: 'createScript', name: 'Note it', text: 'New Record/Request\nSet Field [ Log::Note ; "ran" ]\nCommit Records/Requests' },
  ]);
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

test('a verify schedule reads every page of the hosted files and says how many were ok', async () => {
  const made = await admin('POST', '/schedules', { kind: 'verify', name: 'Verify all', everyMinutes: 1440 });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const run = await admin('POST', `/schedules/${made.body.id}/run`);
  assert.equal(run.body.error, 0, run.body.message);
  assert.match(run.body.result, /^\d+ files? ok$/);
  const one = await admin('POST', '/schedules', { kind: 'verify', name: 'Verify Shop', database: 'Shop', everyMinutes: 1440 });
  assert.equal((await admin('POST', `/schedules/${one.body.id}/run`)).body.result, '1 file ok');
  // A file that is not hosted is refused when the schedule is made; a verify schedule has no script or account.
  assert.equal((await admin('POST', '/schedules', { kind: 'verify', name: 'Nope', database: 'Nothing' })).status, 400);
  assert.equal((await admin('PATCH', `/schedules/${made.body.id}`, { script: 'x' })).status, 400);
  // Listed by the console's API with its kind; the Admin API v2 (FileMaker Server's shape) does not list it.
  const listed = (await admin('GET', '/schedules')).body.schedules.find((s: any) => s.id === made.body.id);
  assert.equal(listed.kind, 'verify');
  for (const id of [made.body.id, one.body.id]) await admin('DELETE', `/schedules/${id}`);
});

test('a backup schedule reads the new set back, and verify: false turns that off', async () => {
  const target = mkdtempSync(join(tmpdir(), 'tabularius-schedule-parity-backups-'));
  try {
    const on = await admin('POST', '/schedules', { kind: 'backup', name: 'Checked', dest: target, keep: 3, everyMinutes: 1440 });
    assert.equal(on.status, 201, JSON.stringify(on.body));
    assert.equal(on.body.verify, undefined);
    const ran = await admin('POST', `/schedules/${on.body.id}/run`);
    assert.equal(ran.body.error, 0, ran.body.message);
    const set = readdirSync(target).filter((n) => !n.endsWith('.partial'))[0];
    assert.ok(set, 'the set was written');
    const off = await admin('PATCH', `/schedules/${on.body.id}`, { verify: false });
    assert.equal(off.body.verify, false);
    assert.equal((await admin('PATCH', `/schedules/${on.body.id}`, { verify: true })).body.verify, undefined);
    assert.equal((await admin('POST', '/schedules', { kind: 'message', name: 'M', message: 'hi', verify: false })).status, 400);
    await admin('DELETE', `/schedules/${on.body.id}`);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('a verify schedule fails, and says which file, when a page of it is damaged', async () => {
  host.create('Damaged').applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'N' }] }]);
  const store = host.get('Damaged')!;
  store.checkpoint();
  const path = join(dir, 'Damaged' + STORE_EXT);
  // Overwrite a page in the middle of the file with noise.
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 8192, 'the file has pages to damage');
  const noise = Buffer.alloc(4096, 0xa5);
  const fd = openSync(path, 'r+');
  try { writeSync(fd, noise, 0, noise.length, 4096); } finally { closeSync(fd); }
  const made = await admin('POST', '/schedules', { kind: 'verify', name: 'Verify Damaged', database: 'Damaged', everyMinutes: 1440 });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const run = await admin('POST', `/schedules/${made.body.id}/run`);
  assert.notEqual(run.body.error, 0);
  assert.match(run.body.message, /Damaged/);
  await admin('DELETE', `/schedules/${made.body.id}`);
});

test('a scheduled time that arrives while the schedule is still running is skipped, logged and counted, not dropped without a word', () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-schedule-overlap-'));
  const events: string[] = [];
  const stub = { dir: folder, onAdd: [], names: () => [], scriptOptions: () => ({}), logs: { event: (type: string, message: string) => events.push(`${type}: ${message}`) } } as unknown as Host;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-01-01T00:00:00Z') });
  const schedules = new Schedules(stub);
  try {
    schedules.broadcast = () => 0;
    const made = schedules.create({ kind: 'message', name: 'Tick', message: 'hi', everyMinutes: 1 });
    // The previous run has not finished when the next time comes.
    (schedules as unknown as { running: Set<string> }).running.add(made.id);
    mock.timers.tick(61_000);
    assert.equal(schedules.all()[0].skipped, 1);
    assert.equal(schedules.all()[0].runs, 0);
    assert.equal(events.length, 1);
    assert.match(events[0], /^Warning: Schedule "Tick" skipped its run at .* the previous run was still going/);
    // Armed again for the next time.
    assert.ok(schedules.all()[0].next);
    mock.timers.tick(60_000);
    assert.equal(schedules.all()[0].skipped, 2);
  } finally {
    schedules.stop();
    mock.timers.reset();
    rmSync(folder, { recursive: true, force: true });
  }
});
