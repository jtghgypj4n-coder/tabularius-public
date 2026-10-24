import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { backupFolder, backupSets, scheduleProgressive } from '../src/backup.ts';
import { logRecords, type LogFollower } from '../src/logs.ts';
import { LOGS } from '../src/backup-log-chain.ts';
import { logTime, parseLogTime } from '../src/server-logs.ts';

const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-backup-time-'));
  createStore(join(dir, 'Notes' + STORE_EXT));
  return dir;
};

test('server log timestamps retain the offset through a repeated hour and zone change', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const first = logTime(new Date('2026-11-01T05:30:00Z'));
    const second = logTime(new Date('2026-11-01T06:30:00Z'));
    assert.match(first, /-0400$/);
    assert.match(second, /-0500$/);
    assert.equal(parseLogTime(first), Date.parse('2026-11-01T05:30:00Z'));
    assert.equal(parseLogTime(second), Date.parse('2026-11-01T06:30:00Z'));
    process.env.TZ = 'Pacific/Honolulu';
    assert.match(logTime(new Date('2026-11-01T06:30:00Z')), /-1000$/);
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('backup set names stay unique and ordered through a zone change and year boundary', async () => {
  const previous = process.env.TZ;
  const dir = folder();
  const dest = join(dir, 'Backups');
  const now = Date.parse('2026-12-31T23:59:59Z');
  try {
    process.env.TZ = 'Asia/Kolkata';
    const first = (await backupFolder(dir, dest, 7, undefined, { now: () => now })).dir.split('/').at(-1)!;
    process.env.TZ = 'America/New_York';
    const second = (await backupFolder(dir, dest, 7, undefined, { now: () => now + 1000 })).dir.split('/').at(-1)!;
    assert.ok(second > first);
    assert.deepEqual(backupSets(dest), [first, second]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('progressive log names remain ordered when a repeated hour is followed by a zone change', async () => {
  assert.equal(LOGS.test('2026-11-01_013000.000.log'), true, 'older local-name logs remain readable');
  assert.equal(LOGS.test('2026-11-01_053000.000Z.log'), true);
  const previous = process.env.TZ;
  const dir = folder();
  const dest = join(dir, 'Backups');
  let follower: LogFollower | undefined;
  const store = { name: 'Notes' };
  const shipper = { follow: () => {}, add: (f: LogFollower) => { follower = f; }, remove: () => {}, ship: () => {} };
  try {
    process.env.TZ = 'America/New_York';
    const schedule = await scheduleProgressive({ dir, names: () => ['Notes'], get: () => store } as never,
      { every: 1, dest, shipper: shipper as never });
    const at = Date.parse('2026-11-01T05:30:00Z');
    const logDir = join(schedule.set()!, 'progressive', 'Notes');
    assert.equal(follower!.take(store as never, Buffer.from('first'), at), true);
    const first = readdirSync(logDir)[0];
    assert.match(first, /^2026-11-01_053000\.000Z\.log$/);
    schedule.follow(schedule.set()!);
    assert.equal(follower!.take(store as never, Buffer.from('second'), at + 30 * 60_000), true);
    const second = readdirSync(logDir).find((name) => name !== first)!;
    assert.match(second, /^2026-11-01_060000\.000Z\.log$/);
    process.env.TZ = 'Pacific/Honolulu';
    schedule.follow(schedule.set()!);
    assert.equal(follower!.take(store as never, Buffer.from('third'), at + 31 * 60_000), true);
    const third = readdirSync(logDir).find((name) => name !== first && name !== second)!;
    assert.match(third, /Z\.log$/);
    assert.deepEqual(readdirSync(logDir).sort(), [first, second, third]);
    assert.equal([first, second, third].every((name) => logRecords(join(logDir, name)).length === 1), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});
