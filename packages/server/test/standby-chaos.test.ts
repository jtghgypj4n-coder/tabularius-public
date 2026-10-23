import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createStore, STORE_FORMAT } from '../../store/src/index.ts';
import { armCrashPointForTest } from '../../store/src/crash-point.ts';
import { Host, STORE_EXT } from '../src/host.ts';
import { LogShipper } from '../src/logs.ts';
import { Replication } from '../src/replication.ts';
import { Metrics } from '../src/metrics.ts';
import { monotonicClock } from '../../store/src/monotonic.ts';
import { Standby } from '../src/standby.ts';
import { runStandbyChaos } from '../../../scripts/standby-chaos.ts';

const TOKEN = 'synthetic-replication-token';

test('seeded 5,000-change catch-up respects bandwidth, time, and chaos invariants', () => {
  for (const seed of [26014, 1, 987654321]) {
    const result = runStandbyChaos({ changes: 5_000, seed, bandwidthBytesPerSecond: 512 * 1024, budgetSeconds: 90 });
    assert.equal(result.changes, 5_000);
    assert.ok(result.virtualSeconds < 90);
    assert.ok(result.maxBytesInTick <= Math.floor(512 * 1024 / 10));
    assert.equal(result.promotions, 1);
    assert.equal(result.refusals, 1);
    assert.ok(result.copyRestarts >= 1 && result.copies >= 3);
    assert.ok(result.diskFailures > 0 && result.linkFailures > 0);
    assert.ok(result.schemaChanges > 0 && result.containersChecked > 0 && result.lagChecks > 0);
  }
  assert.throws(() => runStandbyChaos({ changes: 5_000, seed: 26014, bandwidthBytesPerSecond: 512 * 1024, budgetSeconds: 1 }), /time budget/);
});

test('live standby_behind uses the current backlog and separates two loopback standbys', async (t) => {
  let now = Date.UTC(2026, 0, 1);
  let elapsed = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(monotonicClock, 'now', () => elapsed);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-chaos-metric-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  createStore(join(dir, 'A' + STORE_EXT));
  const host = new Host(dir);
  const shipper = new LogShipper(host);
  const replication = new Replication(host, shipper, TOKEN);
  const metrics = new Metrics();
  metrics.sources = { host, clients: () => [], liveStreams: () => 0, standbys: () => replication.standbys() };
  const server = createServer((req, res) => {
    if (req.url === '/metrics') { res.end(metrics.render()); return; }
    void replication.handle(req, res, new URL(req.url!, 'http://localhost'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/tabularius/replication/v1/files`;
  const get = (path: string, id: string) => fetch(base + path, { headers: { authorization: `Bearer ${TOKEN}`, 'x-tabularius-standby-id': id } });
  try {
    const listed = await get('', '1111111111111111');
    const { files } = await listed.json() as { files: { run: string }[] };
    const run = files[0].run;
    for (const id of ['1111111111111111', '2222222222222222']) {
      const r = await get(`/A/changes?run=${run}&after=0&wait=0`, id);
      assert.equal(r.status, 200);
      await r.arrayBuffer();
    }
    assert.equal(replication.standbys().length, 2);
    now += 10_000;
    assert.deepEqual(replication.standbys().map((s) => s.lagSeconds), [0, 0], 'idle caught-up standbys have no lag');
    const store = host.get('A')!;
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
    store.create('Items', { Name: 'synthetic' });
    shipper.ship();
    now += 1000;
    store.create('Items', { Name: 'second change' });
    shipper.ship();
    now += 3000;
    const seq = (await (await get('', '1111111111111111')).json() as { files: { seq: number }[] }).files[0].seq;
    assert.equal(seq, 2);
    assert.deepEqual(replication.standbys().map((s) => s.behind), [seq, seq]);
    assert.deepEqual(replication.standbys().map((s) => s.lagSeconds), [4, 4]);
    const text = await (await fetch(`http://127.0.0.1:${address.port}/metrics`)).text();
    assert.ok(text.includes('# HELP tabularius_standby_lag_seconds Seconds since the oldest change each standby has yet to copy was taken (0 when caught up)\n'));
    assert.ok(text.includes('# TYPE tabularius_standby_lag_seconds gauge\n'));
    assert.equal([...text.matchAll(/^tabularius_standby_lag_seconds\{standby="[^"]+",file="A"\} 4$/gm)].length, 2);
    const changed = await get(`/A/changes?run=${run}&after=0&wait=0`, '1111111111111111');
    assert.equal(changed.status, 200);
    await changed.arrayBuffer();
    assert.deepEqual(replication.standbys().map((s) => s.behind), [seq, seq], 'downloading does not acknowledge applying changes');
    const acknowledged = await get(`/A/changes?run=${run}&after=${seq}&wait=0`, '1111111111111111');
    assert.equal(acknowledged.status, 200);
    await acknowledged.arrayBuffer();
    assert.deepEqual(replication.standbys().map((s) => s.behind).sort((a, b) => a - b), [0, seq]);
    now += 2000;
    assert.deepEqual(replication.standbys().map((s) => s.lagSeconds), [0, 6], 'acknowledging clears lag even as the clock advances');
    const partial = await get(`/A/changes?run=${run}&after=1&wait=0`, '2222222222222222');
    assert.equal(partial.status, 200);
    await partial.arrayBuffer();
    assert.deepEqual(replication.standbys().map((s) => [s.behind, s.lagSeconds]), [[0, 0], [1, 5]], 'lag follows the next unacknowledged record');

    // Retention uses elapsed time; once the missing record ages out, use the oldest retained record.
    elapsed += 10 * 60_000 + 1;
    store.create('Items', { Name: 'after retention' });
    shipper.ship();
    now += 3000;
    const expired = await get(`/A/changes?run=${run}&after=0&wait=0`, '2222222222222222');
    assert.equal(expired.status, 410);
    await expired.arrayBuffer();
    assert.deepEqual(replication.standbys().map((s) => [s.behind, s.lagSeconds]), [[3, 3]]);
  } finally {
    metrics.stop();
    replication.close(); shipper.stop(); host.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a disconnected copy releases its slot and does not publish a stale response', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-chaos-copy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  createStore(join(dir, 'A' + STORE_EXT));
  const host = new Host(dir);
  const shipper = new LogShipper(host);
  const replication = new Replication(host, shipper, TOKEN);
  const store = host.get('A')!;
  shipper.follow(store);
  const realBackup = store.backup.bind(store);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  t.mock.method(store, 'backup', async (path: string) => {
    if (first) { first = false; entered(); await gate; }
    await realBackup(path);
  });
  const handled: Promise<boolean>[] = [];
  const server = createServer((req, res) => { handled.push(replication.handle(req, res, new URL(req.url!, 'http://localhost'))); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/tabularius/replication/v1/files/A/copy`;
  const headers = { authorization: `Bearer ${TOKEN}` };
  try {
    const controller = new AbortController();
    const aborted = fetch(url, { headers, signal: controller.signal }).catch((e: Error) => e);
    await started;
    controller.abort();
    assert.ok(await aborted instanceof Error);
    release();
    await Promise.all(handled);
    const next = await fetch(url, { headers });
    assert.equal(next.status, 200);
    await next.arrayBuffer();
  } finally {
    release(); replication.close(); shipper.stop(); host.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a standby refuses a newer store format before replacing its local file', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-chaos-format-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'standby');
  mkdirSync(folder);
  const source = join(root, 'A' + STORE_EXT);
  createStore(source);
  const db = new DatabaseSync(source);
  db.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(STORE_FORMAT + 1));
  db.close();
  const bytes = readFileSync(source);
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/copy')) res.writeHead(200, {
      'content-type': 'application/vnd.sqlite3', 'x-tabularius-run': 'run1',
      'x-tabularius-seq': '0', 'x-tabularius-whole-after': '0',
      'x-tabularius-replication-protocol': '2',
    }).end(bytes);
    else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ protocol: 2, files: [{ name: 'A' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const standby = new Standby({ folder, primary: `http://127.0.0.1:${address.port}`, token: TOKEN, log: () => {} });
  try {
    standby.start();
    for (let i = 0; i < 100 && !standby.problem; i++) await sleep(10);
    assert.match(standby.problem ?? '', /written by a newer Tabularius.*Update Tabularius/);
    assert.equal(existsSync(join(folder, 'A' + STORE_EXT)), false);
  } finally {
    await standby.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a copy is refused with a 503 when the primary hosts a different store by the time it is made', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-chaos-swap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const other = mkdtempSync(join(tmpdir(), 'tabularius-chaos-swap-other-'));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  createStore(join(dir, 'A' + STORE_EXT));
  createStore(join(other, 'A' + STORE_EXT));
  const otherHost = new Host(other);
  const replacement = otherHost.get('A')!;
  const host = new Host(dir);
  const shipper = new LogShipper(host);
  const replication = new Replication(host, shipper, TOKEN);
  const store = host.get('A')!;
  shipper.follow(store);
  let swapped = false;
  const realBackup = store.backup.bind(store);
  t.mock.method(store, 'backup', async (path: string) => { await realBackup(path); swapped = true; });
  const realGet = host.get.bind(host);
  t.mock.method(host, 'get', (name: string) => (swapped && name === 'A' ? replacement : realGet(name)));
  const server = createServer((req, res) => { void replication.handle(req, res, new URL(req.url!, 'http://localhost')); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/tabularius/replication/v1/files/A/copy`, { headers: { authorization: `Bearer ${TOKEN}` } });
    await res.arrayBuffer();
    assert.equal(res.status, 503);
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  } finally {
    t.mock.restoreAll();
    replication.close(); shipper.stop(); host.close(); otherHost.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

for (const [label, headers] of [
  ['no sequence header', {}],
  ['an empty sequence header', { 'x-tabularius-seq': '' }],
  ['a blank sequence header', { 'x-tabularius-seq': '   ' }],
  ['a blank whole-after header', { 'x-tabularius-seq': '0', 'x-tabularius-whole-after': ' ' }],
  ['no whole-after header', { 'x-tabularius-seq': '0' }],
  ['a hexadecimal sequence', { 'x-tabularius-seq': '0x10', 'x-tabularius-whole-after': '16' }],
  ['an exponent in the whole-after header', { 'x-tabularius-seq': '0', 'x-tabularius-whole-after': '1e3' }],
  ['a negative sequence', { 'x-tabularius-seq': '-1', 'x-tabularius-whole-after': '0' }],
  ['a fractional sequence', { 'x-tabularius-seq': '1.5', 'x-tabularius-whole-after': '2' }],
] as [string, Record<string, string>][]) {
  test(`a standby does not publish a copy that arrives with ${label}`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'tabularius-chaos-position-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const folder = join(root, 'standby');
    mkdirSync(folder);
    const source = join(root, 'A' + STORE_EXT);
    createStore(source);
    const bytes = readFileSync(source);
    const server = createServer((req, res) => {
      if (req.url?.endsWith('/copy')) res.writeHead(200, { 'content-type': 'application/vnd.sqlite3', 'x-tabularius-run': 'run1', ...headers }).end(bytes);
      else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ protocol: 2, files: [{ name: 'A' }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const standby = new Standby({ folder, primary: `http://127.0.0.1:${address.port}`, token: TOKEN, log: () => {} });
    try {
      standby.start();
      for (let i = 0; i < 100 && !standby.problem; i++) await sleep(10);
      assert.match(standby.problem ?? '', /invalid replication position/);
      assert.equal(existsSync(join(folder, 'A' + STORE_EXT)), false);
    } finally {
      await standby.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

// Arming is a function only test code calls; no request, setting or environment variable reaches it. NODE_ENV=production
// refuses it as a second line, so an unset NODE_ENV (as under node --test) permits it by design.
test('crash checkpoints cannot be armed when NODE_ENV is production', () => {
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { assert.throws(() => armCrashPointForTest('restore:after-publish'), /production/); }
  finally { if (was === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = was; }
});
