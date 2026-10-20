// Stats.log and TopCallStats.log: FileMaker Server's layout, so the tools that read a FileMaker Server's Logs folder read ours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';
import { Metrics } from '../src/metrics.ts';
import { StatsLog, STATS_HEADER, TOP_CALL_HEADER, parseStatsInterval, procDiskBytes } from '../src/stats-log.ts';
import { parseLogTime } from '../src/server-logs.ts';

const rows = (file: string) => readFileSync(file, 'utf8').trimEnd().split('\n').map((l) => l.split('\t'));

async function until(ok: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for stats logs');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('a sample writes one Stats.log line and the top calls, with headers once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-stats-'));
  try {
    const metrics = new Metrics();
    const log = new StatsLog(dir, metrics, { clients: () => 3, openFiles: () => 2, sessions: () => 4 }, { intervalMs: 60_000, stats: true });
    log.start();
    const call = (route: string, path: string, seconds: number, client = '10.0.0.5') =>
      metrics.onCall!({ route, method: 'GET', path, client, start: 1_000, end: 2_000, seconds, bytesIn: 100, bytesOut: 2000 });
    call('dataapi', '/fmi/data/vLatest/databases/Sales/layouts/Orders/records', 0.5);
    call('dataapi', '/fmi/data/vLatest/databases/Sales/layouts/Orders/records', 1.5);
    call('dataapi', '/fmi/data/vLatest/databases/Sales/sessions/SECRETTOKEN', 0.1);
    call('live', '/tabularius/live', 9);
    log.sample(Date.now() + 60_000);
    log.sample(Date.now() + 120_000);
    log.stop();

    const stats = rows(join(dir, 'Logs', 'Stats.log'));
    assert.deepEqual(stats[0], STATS_HEADER);
    assert.equal(stats.filter((r) => r[0] === 'Timestamp').length, 1, 'one header');
    assert.equal(stats[1].length, STATS_HEADER.length);
    assert.ok(!Number.isNaN(parseLogTime(stats[1][0])), 'a timestamp like the other logs');
    assert.deepEqual(stats[1].slice(7, 10), ['3', '2', '4'], 'clients, open files, sessions');

    const top = rows(join(dir, 'Logs', 'TopCallStats.log'));
    assert.deepEqual(top[0], TOP_CALL_HEADER);
    assert.equal(top.length, 3, 'two kinds of call (the stream is left out); the second sample had none');
    assert.equal(top[1][4], 'Data API');
    assert.equal(top[1][5], 'GET /fmi/data/vLatest/databases/Sales/layouts/Orders/records');
    assert.equal(top[1][3], '2000000', 'the slowest first: 2 s in microseconds');
    assert.equal(top[1][7], '200', 'bytes in');
    assert.equal(top[1][8], '4000', 'bytes out');
    assert.ok(!readFileSync(join(dir, 'Logs', 'TopCallStats.log'), 'utf8').includes('SECRETTOKEN'), 'session tokens are cut out of targets');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the server writes both logs for real calls, and none when turned off', async () => {
  for (const interval of [50, 0]) {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-stats-serve-'));
    try {
      setAdminPassword(dir, 'secret');
      const s = await serve({ dir, port: 0, log: () => {}, statsInterval: interval });
      for (let i = 0; i < 3; i++) await (await fetch(`${s.url}/fmi/data/vLatest/databases`)).text();
      const stats = join(dir, 'Logs', 'Stats.log');
      const top = join(dir, 'Logs', 'TopCallStats.log');
      if (interval !== 0) await until(() => {
        try { return rows(stats).length >= 2 && rows(top).some((r) => r[4] === 'Data API'); }
        catch { return false; }
      }, 5000);
      await new Promise<void>((r) => s.server.close(() => r()));
      if (interval === 0) {
        assert.equal(existsSync(stats), false);
        continue;
      }
      const lines = rows(stats);
      assert.ok(lines.length >= 2);
      const total = lines.slice(1).reduce((n, r) => n + Number(r[10]), 0);
      assert.ok(total > 0, 'calls per second counted');
      assert.ok(rows(top).some((r) => r[4] === 'Data API'));
    } finally {
      rmSync(dir, { recursive: true });
    }
  }
});

test('the interval is read like a person writes it', () => {
  assert.equal(parseStatsInterval('30s'), 30_000);
  assert.equal(parseStatsInterval('2m'), 120_000);
  assert.equal(parseStatsInterval('45'), 45_000);
  assert.equal(parseStatsInterval('off'), 0);
  assert.throws(() => parseStatsInterval('soon'), /--stats-interval/);
});

test('disk rates come from the bytes the process read and wrote since the last line, and are 0 where the system does not say', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-stats-disk-'));
  try {
    let bytes: { read: number; write: number } | undefined = { read: 0, write: 0 };
    const log = new StatsLog(dir, new Metrics(), { clients: () => 0, openFiles: () => 0, sessions: () => 0, disk: () => bytes }, { intervalMs: 60_000, stats: true });
    log.start();
    const t0 = Date.now();
    bytes = { read: 60 * 1024 * 10, write: 60 * 1024 * 2 };
    log.sample(t0 + 60_000);
    bytes = undefined;
    log.sample(t0 + 120_000);
    log.stop();
    const stats = rows(join(dir, 'Logs', 'Stats.log'));
    assert.deepEqual(stats[1].slice(3, 7), ['10.000', '2.000', '0', '0'], '10 KB/s read, 2 KB/s written; the cache columns are not measured');
    assert.deepEqual(stats[2].slice(3, 5), ['0', '0'], 'no figure from the system, no rate');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('procDiskBytes reads read_bytes and write_bytes, and says nothing for a file that is not there or not in that shape', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-stats-proc-'));
  try {
    const file = join(dir, 'io');
    writeFileSync(file, 'rchar: 100\nwchar: 50\nread_bytes: 4096\nwrite_bytes: 8192\ncancelled_write_bytes: 0\n');
    assert.deepEqual(procDiskBytes(file), { read: 4096, write: 8192 });
    writeFileSync(file, 'nothing useful\n');
    assert.equal(procDiskBytes(file), undefined);
    assert.equal(procDiskBytes(join(dir, 'missing')), undefined);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
