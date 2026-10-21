import './backup-review-guard.ts';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HISTORY, Schedules } from '../src/schedules.ts';
import type { Host } from '../src/host.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-review-schedules-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const host = { dir, onAdd: [], names: () => [], scriptOptions: () => ({}), logs: { event: () => {} } } as unknown as Host;
  const schedules = new Schedules(host);
  schedules.broadcast = () => 0;
  t.after(() => schedules.stop());
  return { dir, host, schedules };
}

test('deleting skipped schedules releases their counters after clock and interval edits', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 18, 12) });
  const { schedules } = setup(t);
  const state = schedules as unknown as { running: Set<string>; skipped: Map<string, number> };
  for (let i = 0; i < 4; i++) {
    const made = schedules.create({ kind: 'message', name: 'synthetic', message: 'test', everyMinutes: 1 });
    state.running.add(made.id);
    t.mock.timers.tick(61_000);
    assert.equal(schedules.all()[0].skipped, 1);
    schedules.update(made.id, { everyMinutes: 2 });
    t.mock.timers.tick(60_000);
    assert.equal(schedules.all()[0].skipped, 1, 'the old timer was disarmed');
    t.mock.timers.tick(61_000);
    assert.equal(schedules.all()[0].skipped, 2);
    state.running.delete(made.id);
    assert.equal(schedules.remove(made.id), true);
  }
  assert.equal(state.skipped.size, 0, 'removed ids do not grow an unbounded counter map');
});

test('daily verify schedule edits and restart retain bounded run days and history', async (t) => {
  const { dir, host, schedules } = setup(t);
  const day = new Date(2026, 8, 1, 12).getTime();
  const days = HISTORY + 10;
  const lastDay = day + (days - 1) * 86_400_000;
  const made = schedules.create({ kind: 'verify', name: 'synthetic', at: '12:00', everyMinutes: 1440 });
  for (let i = 0; i < days; i++) assert.equal((await schedules.run(made.id, false, day + i * 86_400_000)).error, 0);
  const state = () => JSON.parse(readFileSync(join(dir, '.openhbam-schedule-runs.json'), 'utf8'));
  assert.ok(state().runDays[made.id].length <= 14);
  assert.equal(state().runs[made.id].length, HISTORY);
  await assert.rejects(schedules.run(made.id, false, lastDay), /already ran/);
  schedules.update(made.id, { at: '13:00' });
  assert.equal((await schedules.run(made.id, false, lastDay)).error, 0);
  schedules.stop();
  const restarted = new Schedules(host);
  t.after(() => restarted.stop());
  await assert.rejects(restarted.run(made.id, false, lastDay), /already ran/);
  restarted.remove(made.id);
  assert.equal(state().runDays[made.id], undefined);
  assert.equal(state().runs[made.id], undefined);
});

test('verify schedule refuses overlap and rearms safely when its interval changes during a check', async (t) => {
  const { host, schedules } = setup(t);
  let finish!: (value: { state: 'ok' }) => void;
  host.names = () => ['synthetic'];
  host.verifyHosted = () => new Promise((resolve) => { finish = resolve; });
  const made = schedules.create({ kind: 'verify', name: 'synthetic', everyMinutes: 1 });
  const pending = schedules.run(made.id);
  await assert.rejects(schedules.run(made.id), /already running/);
  schedules.update(made.id, { everyMinutes: 5 });
  finish({ state: 'ok' });
  assert.equal((await pending).error, 0);
  assert.equal(schedules.all()[0].running, false);
  assert.equal(schedules.all()[0].everyMinutes, 5);
  assert.ok(schedules.all()[0].next);
});
