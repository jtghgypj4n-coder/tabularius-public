import { deleteBeforeStateLock } from './state-lock-race.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, nextRun, Schedules, type Host } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sched-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('next run: every N minutes, lined up with a time of day', () => {
  const from = new Date(2026, 9, 11, 10, 7).getTime();
  assert.equal(nextRun({ everyMinutes: 30 }, from), from + 30 * 60_000);
  assert.equal(nextRun({ everyMinutes: 15, at: '09:00' }, from), new Date(2026, 9, 11, 10, 15).getTime());
  assert.equal(nextRun({ everyMinutes: 1440, at: '02:30' }, from), new Date(2026, 9, 12, 2, 30).getTime());
  assert.equal(nextRun({ everyMinutes: 1440, at: '23:00' }, from), new Date(2026, 9, 11, 23, 0).getTime());
});

test('daily schedule advances by a local calendar day at fall-back', () => {
  const zone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const first = nextRun({ everyMinutes: 1440, at: '00:30' }, new Date(2026, 10, 1, 0, 0).getTime());
    assert.equal(first, new Date(2026, 10, 1, 0, 30).getTime());
    assert.equal(nextRun({ everyMinutes: 1440, at: '00:30' }, first + 1), new Date(2026, 10, 2, 0, 30).getTime());
    assert.equal(nextRun({ everyMinutes: 1440, at: '01:30' }, Date.parse('2026-11-01T06:15:00Z')), Date.parse('2026-11-01T06:30:00Z'));
  } finally {
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
  }
});

test('a daily run key survives restart inside the repeated hour', async () => {
  const zone = process.env.TZ;
  const actualNow = Date.now;
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-schedule-day-'));
  const localHost = { dir: folder, onAdd: [], names: () => [], scriptOptions: () => ({}) } as unknown as Host;
  const sent: string[] = [];
  let first: Schedules | undefined;
  let restarted: Schedules | undefined;
  try {
    process.env.TZ = 'America/New_York';
    Date.now = () => Date.parse('2026-11-01T05:30:00Z');
    first = new Schedules(localHost);
    first.broadcast = (message) => { sent.push(message); return 1; };
    const made = first.create({ kind: 'message', name: 'Once', message: 'daily', everyMinutes: 1440, at: '01:30', enabled: false });
    assert.equal((await first.run(made.id, false)).error, 0);
    first.update(made.id, { enabled: true });
    first.stop();
    Date.now = () => Date.parse('2026-11-01T06:15:00Z');
    restarted = new Schedules(localHost);
    restarted.broadcast = (message) => { sent.push(message); return 1; };
    assert.equal(restarted.all()[0].next, '2026-11-02T06:30:00.000Z');
    await assert.rejects(restarted.run(made.id, false), /already ran/);
    assert.deepEqual(sent, ['daily']);
  } finally {
    first?.stop(); restarted?.stop();
    Date.now = actualNow;
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
    rmSync(folder, { recursive: true, force: true });
  }
});
test('a new time of day for a daily schedule is not held back by today\'s run at the old time', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-schedule-retime-'));
  const localHost = { dir: folder, onAdd: [], names: () => [], scriptOptions: () => ({}) } as unknown as Host;
  const sent: string[] = [];
  const schedules = new Schedules(localHost);
  try {
    schedules.broadcast = (message) => { sent.push(message); return 1; };
    const made = schedules.create({ kind: 'message', name: 'Retimed', message: 'daily', everyMinutes: 1440, at: '02:30', enabled: false });
    assert.equal((await schedules.run(made.id, false)).error, 0);
    await assert.rejects(schedules.run(made.id, false), /already ran/);
    schedules.update(made.id, { at: '23:59' });
    assert.equal((await schedules.run(made.id, false)).error, 0, 'a different time of day starts again');
    assert.deepEqual(sent, ['daily', 'daily']);
  } finally {
    schedules.stop();
    rmSync(folder, { recursive: true, force: true });
  }
});

for (const zone of ['America/New_York', 'Europe/London', 'Australia/Sydney', 'Australia/Adelaide']) {
  test(`daily local-time schedule crosses DST and year end once in ${zone}`, () => {
    const old = process.env.TZ;
    process.env.TZ = zone;
    try {
      const daily = (at: string, from: number) => nextRun({ everyMinutes: 1440, at }, from);
      const localDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA');
      const oneDay = (ymd: number[], at: string) => {
        const start = new Date(ymd[0], ymd[1], ymd[2]).getTime();
        const first = daily(at, start);
        assert.equal(localDay(first), localDay(start));
        const second = daily(at, first + 1);
        const tomorrow = new Date(ymd[0], ymd[1], ymd[2] + 1).getTime();
        assert.equal(localDay(second), localDay(tomorrow));
      };
      const transitions: { spring?: number[]; fall?: number[] } = {};
      let previous = new Date(2025, 11, 31, 12).getTimezoneOffset();
      for (let day = 1; day <= 365; day++) {
        const noon = new Date(2026, 0, day, 12);
        const offset = noon.getTimezoneOffset();
        if (offset !== previous) {
          const date = [noon.getFullYear(), noon.getMonth(), noon.getDate()];
          transitions[offset < previous ? 'spring' : 'fall'] = date;
        }
        previous = offset;
      }
      assert.ok(transitions.spring && transitions.fall, `2026 DST transitions in ${zone}`);
      oneDay(transitions.spring, zone === 'Europe/London' ? '01:30' : '02:30');
      oneDay(transitions.fall, '00:30');
      oneDay(transitions.fall, zone === 'Europe/London' || zone === 'America/New_York' ? '01:30' : '02:30');
      oneDay([2026, 11, 31], '23:30');
    } finally {
      if (old === undefined) delete process.env.TZ;
      else process.env.TZ = old;
    }
  });
}

const api = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/tabularius/admin/v1/schedules${path}`, {
    method,
    headers: { 'x-tabularius-admin': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('admin console: add, run, turn off and delete script schedules', { skip }, async () => {
  const bad = await api('POST', '', { name: 'x', database: 'Charts', script: 'No such script', account: 'Admin', everyMinutes: 60 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /no script/);
  assert.equal((await api('POST', '', { name: 'x', database: 'Charts', script: 'Show Senate', account: 'Admin', everyMinutes: 0 })).status, 400);
  assert.equal((await api('POST', '', { name: 'x', database: 'Charts', script: 'Show Senate', account: 'Nobody', everyMinutes: 60 })).status, 400);

  const add = await api('POST', '', { name: 'Senate', database: 'Charts', script: 'Show Senate', account: 'Admin', everyMinutes: 60, at: '03:00' });
  assert.equal(add.status, 201);
  const id = add.body.id as string;
  const listed = (await api('GET', '')).body.schedules[0];
  assert.equal(listed.name, 'Senate');
  assert.ok(Date.parse(listed.next) > Date.now());
  assert.equal(listed.network, undefined); // offline unless asked

  const run = await api('POST', `/${id}/run`);
  assert.equal(run.status, 200);
  assert.equal(run.body.error, 0);
  assert.ok(run.body.steps > 0);
  assert.equal((await api('GET', '')).body.schedules[0].last.error, 0);
  // Its runs are kept, newest first, and counted.
  await api('POST', `/${id}/run`);
  const runs = (await api('GET', `/${id}/runs`)).body.runs;
  assert.equal(runs.length, 2);
  assert.equal(runs[0].manual, true);
  assert.ok(Date.parse(runs[0].at) >= Date.parse(runs[1].at));
  const counted = (await api('GET', '')).body.schedules[0];
  assert.deepEqual([counted.runs, counted.failures, counted.lastError], [2, 0, undefined]);
  assert.equal((await api('GET', '/0123abcd/runs')).status, 404);

  const off = await api('PATCH', `/${id}`, { enabled: false });
  assert.equal(off.body.enabled, false);
  assert.equal((await api('GET', '')).body.schedules[0].next, undefined);

  // Kept in the hosted folder, and read back when the server starts.
  assert.match(readFileSync(join(dir, '.openhbam-schedules.json'), 'utf8'), /Show Senate/);
  const again = new Schedules(host);
  assert.equal(again.all()[0].id, id);
  // Recent runs too.
  assert.equal(again.runs(id).length, 2);
  assert.equal(again.all()[0].last?.error, 0);
  again.stop();

  // Changes need the console header, like every other change.
  assert.equal((await fetch(`${base}/tabularius/admin/v1/schedules/${id}`, { method: 'DELETE' })).status, 403);
  assert.deepEqual((await api('DELETE', `/${id}`)).body, { deleted: true });
  assert.equal((await api('GET', '')).body.schedules.length, 0);
  assert.equal((await api('POST', `/${id}/run`)).status, 404);
});

test('a message schedule hands its text to the broadcast and records how many clients it reached', { skip }, async () => {
  const schedules = new Schedules(host, () => {});
  try {
    const sent: string[] = [];
    schedules.broadcast = (text) => { sent.push(text); return 3; };
    const made = schedules.create({ kind: 'message', name: 'Notice', message: 'Server restarts at 6 pm', everyMinutes: 1440, at: '18:00', enabled: false });
    assert.equal(made.kind, 'message');
    const run = await schedules.run(made.id);
    assert.deepEqual(sent, ['Server restarts at 6 pm']);
    assert.equal(run.error, 0);
    assert.equal(run.result, '3 clients');
    // No text, or too much, is refused; a message schedule can't become a script schedule.
    assert.throws(() => schedules.create({ kind: 'message', name: 'Empty', message: ' ', everyMinutes: 60 }), /1 to 200/);
    assert.throws(() => schedules.update(made.id, { script: 'x' }), /no file, script or account/);
    assert.equal(schedules.update(made.id, { message: 'Back at 7' }).message, 'Back at 7');
    // With nothing to send through (a standalone Schedules), the run fails and says so.
    schedules.broadcast = undefined;
    assert.notEqual((await schedules.run(made.id)).error, 0);
  } finally {
    schedules.stop();
  }
});

test('an edit does not resurrect a schedule deleted by another store', () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-schedule-delete-'));
  const localHost = { dir: folder, onAdd: [], names: () => [], scriptOptions: () => ({}) } as unknown as Host;
  const editor = new Schedules(localHost);
  const made = editor.create({ kind: 'backup', name: 'delete-me', everyMinutes: 60 });
  const remover = new Schedules(localHost);
  try {
    deleteBeforeStateLock(join(folder, '.openhbam-schedules.json'), () => {
      assert.equal(remover.remove(made.id), true);
    }, () => { editor.update(made.id, { name: 'late edit' }); });
    assert.deepEqual(JSON.parse(readFileSync(join(folder, '.openhbam-schedules.json'), 'utf8')).schedules, []);
    assert.equal(editor.get(made.id), undefined);
  } finally {
    editor.stop();
    remover.stop();
    rmSync(folder, { recursive: true, force: true });
  }
});
