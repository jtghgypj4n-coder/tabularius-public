import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HISTORY, nextRun, Schedules } from '../src/schedules.ts';
import type { Host } from '../src/host.ts';

process.env.TZ = 'UTC';
const time = (s: string) => Date.parse(s);
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('daily next run resolves skipped and repeated hours and crosses short months', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const daily = { everyMinutes: 1440, at: '02:30' };
    assert.equal(nextRun(daily, time('2026-03-08T05:00:00Z')), time('2026-03-08T07:30:00Z'));
    assert.equal(nextRun(daily, time('2026-03-08T07:30:01Z')), time('2026-03-09T06:30:00Z'));
    const repeated = { everyMinutes: 1440, at: '01:30' };
    assert.equal(nextRun(repeated, time('2026-11-01T05:00:00Z')), time('2026-11-01T05:30:00Z'));
    assert.equal(nextRun(repeated, time('2026-11-01T06:00:00Z')), time('2026-11-01T06:30:00Z'));
    assert.equal(nextRun(daily, new Date(2024, 1, 29, 3).getTime()), new Date(2024, 2, 1, 2, 30).getTime());
    assert.equal(nextRun(daily, new Date(2026, 0, 31, 3).getTime()), new Date(2026, 1, 1, 2, 30).getTime());
    assert.equal(nextRun(daily, new Date(2026, 11, 31, 3).getTime()), new Date(2027, 0, 1, 2, 30).getTime());
    process.env.TZ = 'Europe/London';
    assert.equal(nextRun({ everyMinutes: 1440, at: '01:30' }, time('2026-03-29T00:00:00Z')), time('2026-03-29T01:30:00Z'));
    process.env.TZ = 'Australia/Sydney';
    assert.equal(nextRun(daily, new Date(2026, 9, 4, 0).getTime()), new Date(2026, 9, 4, 3, 30).getTime());
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('run history stays in creation order after a wall-clock rollback and restart', async () => {
  let clock = time('2026-11-01T05:30:00Z');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-schedule-history-'));
  const host = { dir, onAdd: [], names: () => [], scriptOptions: () => ({}) } as unknown as Host;
  const schedules = new Schedules(host, () => {}, () => clock);
  let restarted: Schedules | undefined;
  try {
    schedules.broadcast = () => 1;
    const made = schedules.create({ kind: 'message', name: 'History', message: 'sent', everyMinutes: 60, enabled: false });
    const first = await schedules.run(made.id);
    clock = time('2026-11-01T04:30:00Z');
    const second = await schedules.run(made.id);
    assert.ok(second.at > first.at, 'a later run has a later stamp');
    assert.ok(second.ms >= 0 && second.ms < 1000, 'duration is elapsed time, even when the wall clock rolls back');
    assert.deepEqual(schedules.runs(made.id).map((r) => r.at), [second.at, first.at]);
    schedules.stop();
    restarted = new Schedules(host, () => {}, () => clock);
    assert.deepEqual(restarted.runs(made.id).map((r) => r.at), [second.at, first.at]);
  } finally {
    schedules.stop(); restarted?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missed timer runs once after a forward clock jump, then resumes at the next time', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: time('2026-01-01T12:00:00Z') });
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-schedule-jump-'));
  const host = { dir, onAdd: [], names: () => [], scriptOptions: () => ({}) } as unknown as Host;
  const schedules = new Schedules(host);
  const sent: string[] = [];
  try {
    schedules.broadcast = (s) => { sent.push(s); return 1; };
    const made = schedules.create({ kind: 'message', name: 'Minute', message: 'sent', everyMinutes: 1, at: '12:02' });
    schedules.create({ kind: 'message', name: 'Off', message: 'never', everyMinutes: 1, enabled: false });
    t.mock.timers.setTime(time('2026-01-01T12:20:00Z'));
    t.mock.timers.tick(60_000);
    await flush();
    assert.deepEqual(sent, ['sent']);
    assert.equal(schedules.runs(made.id).length, 1);
    assert.equal(schedules.all()[0].next, '2026-01-01T12:22:00.000Z');
    t.mock.timers.tick(60_000);
    await flush();
    assert.deepEqual(sent, ['sent', 'sent']);
  } finally {
    schedules.stop();
    t.mock.timers.reset();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a backward clock jump waits for the original due time; a time edit replaces it', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: time('2026-01-01T12:00:00Z') });
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-schedule-edit-'));
  const host = { dir, onAdd: [], names: () => [], scriptOptions: () => ({}) } as unknown as Host;
  const schedules = new Schedules(host);
  let sent = 0;
  try {
    schedules.broadcast = () => ++sent;
    const made = schedules.create({ kind: 'message', name: 'Edited', message: 'sent', everyMinutes: 1440, at: '12:02' });
    t.mock.timers.setTime(time('2026-01-01T11:00:00Z'));
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(sent, 0);
    schedules.update(made.id, { at: '12:04' });
    t.mock.timers.setTime(time('2026-01-01T12:02:00Z'));
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(sent, 0, 'the old time did not fire');
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(sent, 1);
  } finally {
    schedules.stop();
    t.mock.timers.reset();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a schedule edit during an overlapping run keeps the edited timer', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: time('2026-01-01T12:00:00Z') });
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-schedule-overlap-'));
  const host = { dir, onAdd: [], names: () => [], get: () => ({}), scriptOptions: () => ({}) } as unknown as Host;
  const schedules = new Schedules(host);
  let release!: (value: { summary: string; conflicts: number; changed: number }) => void;
  const calls: string[] = [];
  schedules.syncJobs = {
    check: () => {},
    run: () => { calls.push(new Date().toISOString()); return new Promise((resolve) => { release = resolve; }); },
  };
  try {
    const made = schedules.create({ name: 'Sync', database: 'Local', script: '', account: '', sync: {}, everyMinutes: 5, at: '12:05' });
    t.mock.timers.tick(5 * 60_000);
    await flush();
    assert.equal(calls.length, 1);
    await assert.rejects(schedules.run(made.id), /already running/);
    schedules.update(made.id, { at: '12:11' });
    t.mock.timers.setTime(time('2026-01-01T12:12:00Z'));
    release({ summary: 'ok', conflicts: 0, changed: 0 });
    await flush();
    assert.equal(schedules.all()[0].next, '2026-01-01T12:11:00.000Z');
  } finally {
    schedules.stop();
    t.mock.timers.reset();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('daily DST run key and bounded history survive a restart', async (t) => {
  const oldZone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: time('2026-11-01T05:29:00Z') });
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-schedule-restart-'));
  const host = { dir, onAdd: [], names: () => [], scriptOptions: () => ({}) } as unknown as Host;
  const first = new Schedules(host);
  let restarted: Schedules | undefined;
  let sent = 0;
  try {
    first.broadcast = () => ++sent;
    const made = first.create({ kind: 'message', name: 'Daily', message: 'sent', everyMinutes: 1440, at: '01:30' });
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(sent, 1);
    first.stop();
    t.mock.timers.setTime(time('2026-11-01T06:15:00Z'));
    restarted = new Schedules(host);
    restarted.broadcast = () => ++sent;
    assert.equal(restarted.all()[0].next, '2026-11-02T06:30:00.000Z');
    t.mock.timers.tick(20 * 60_000);
    await flush();
    assert.equal(sent, 1);
    for (let day = 2; day <= 65; day++) {
      t.mock.timers.setTime(time('2026-11-02T06:30:00Z') + (day - 2) * 86_400_000);
      await restarted.run(made.id, false, Date.now());
    }
    const persisted = JSON.parse(readFileSync(join(dir, '.openhbam-schedule-runs.json'), 'utf8'));
    assert.equal(persisted.runs[made.id].length, HISTORY);
    assert.ok(persisted.runDays[made.id].length <= 14);
    restarted.stop();
    restarted = new Schedules(host);
    assert.equal(restarted.runs(made.id).length, HISTORY);
  } finally {
    first.stop(); restarted?.stop();
    t.mock.timers.reset();
    if (oldZone === undefined) delete process.env.TZ; else process.env.TZ = oldZone;
    rmSync(dir, { recursive: true, force: true });
  }
});
