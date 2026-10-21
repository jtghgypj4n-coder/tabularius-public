import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createStore, Store } from '../../store/src/index.ts';
import { LogShipper, type LogFollower } from '../src/logs.ts';
import { scheduleProgressive } from '../src/backup.ts';
import { Host } from '../src/host.ts';
import { ServerLogs, parseLogLimit } from '../src/server-logs.ts';
import { Metrics } from '../src/metrics.ts';
import { StatsLog, parseStatsInterval } from '../src/stats-log.ts';

const temp = (t: { after(fn: () => void): void }) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-observability-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('AR-server-observability-02', () => {
  const child = spawnSync(process.execPath, [join(import.meta.dirname, 'helpers', 'debug-expiry-child.ts')], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
});

test('AR-server-observability-05 follower lifecycle', (t) => {
  const dir = temp(t);
  const file = join(dir, 'Test.sqlite');
  createStore(file);
  const store = new Store(file, 'Test');
  t.after(() => store.close());
  store.sql.exec('PRAGMA wal_autocheckpoint = 1');
  const policy = () => Number((store.sql.prepare('PRAGMA wal_autocheckpoint').get() as { wal_autocheckpoint: number }).wal_autocheckpoint);
  const host = { names: () => ['Test'], get: () => store };
  const shipper = new LogShipper(host as never);
  t.after(() => shipper.stop());
  const follower: LogFollower = { every: 60_000, take: () => true };
  shipper.add(follower);
  shipper.follow(store);
  assert.equal(policy(), 0);
  shipper.remove(follower);
  assert.equal(policy(), 1);
  shipper.add(follower);
  assert.equal(policy(), 0);
  shipper.remove(follower);
  assert.equal(policy(), 1);
  shipper.follow(store); // Initial backup can fail before any follower is installed.
  shipper.stop();
  assert.equal(policy(), 1);
});

test('AR-server-observability-05 startup failure', async (t) => {
  const dir = temp(t);
  const host = new Host(dir, () => {}, { background: false });
  t.after(() => { void host.close(); });
  const store = host.create('BackupStart');
  store.sql.exec('PRAGMA wal_autocheckpoint = 1');
  const blocked = join(dir, 'blocked');
  writeFileSync(blocked, 'not a directory');
  await assert.rejects(scheduleProgressive(host, { every: 60_000, dest: blocked }));
  assert.equal((store.sql.prepare('PRAGMA wal_autocheckpoint').get() as { wal_autocheckpoint: number }).wal_autocheckpoint, 1);
});

test('AR-server-observability-06', async (t) => {
  const dir = temp(t);
  const logs = new ServerLogs(dir, { limit: 128 });
  logs.write('Event', 'Information', 'test', 'x'.repeat(200));
  await logs.flush();
  const file = join(dir, 'Logs', 'Event.log');
  const original = statSync(file).size;
  mkdirSync(join(dir, 'Logs', 'Event-old.log'));
  const failures: unknown[][] = [];
  const old = console.error;
  console.error = (...args: unknown[]) => { failures.push(args); };
  try {
    for (let i = 0; i < 5; i++) {
      logs.write('Event', 'Information', 'test', `queued ${i} ${'y'.repeat(200)}`);
      await logs.flush();
    }
    assert.equal(statSync(file).size, original);
    assert.equal(failures.length, 1);
    rmSync(join(dir, 'Logs', 'Event-old.log'), { recursive: true });
    await logs.flush();
    assert.match(readFileSync(file, 'utf8'), /queued 4/);

    // Shutdown uses a separate synchronous flush path and must obey the same bound.
    rmSync(join(dir, 'Logs', 'Event-old.log'));
    mkdirSync(join(dir, 'Logs', 'Event-old.log'));
    logs.write('Event', 'Information', 'test', 'at shutdown');
    const beforeClose = statSync(file).size;
    logs.close();
    assert.equal(statSync(file).size, beforeClose);
  } finally {
    console.error = old;
  }
});

test('AR-server-observability-07', (t) => {
  assert.throws(() => parseStatsInterval('2147484s'), /--stats-interval/);
  assert.throws(() => parseLogLimit('9'.repeat(309) + 'GB'), /--log-limit/);
  const dir = temp(t);
  const metrics = new Metrics();
  t.after(() => metrics.stop());
  const sources = { clients: () => 0, openFiles: () => 0, sessions: () => 0 };
  assert.throws(() => new StatsLog(dir, metrics, sources, { intervalMs: 2_147_484_000, stats: true }), /interval/i);
  assert.throws(() => new ServerLogs(dir, { limit: Infinity }), /limit/i);
});
