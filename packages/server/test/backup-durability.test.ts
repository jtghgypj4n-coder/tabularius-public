import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createStore, Store } from '../../store/src/index.ts';
import { writeDurable } from '../../store/src/durable.ts';
import type { DurableFs } from '../../store/src/durable.ts';
import { claimFolder, sweepCrashLeftovers, LEFTOVER_MAX_AGE_MS } from '../src/backup.ts';
import { encryptFile, encryptFileSync, decryptFile, decryptFileSync } from '../src/encrypt.ts';
import { moveContainersToManagedStorage } from '../src/optimization-containers.ts';
import { Host } from '../src/host.ts';
import { Replication, MAX_CONCURRENT_COPIES } from '../src/replication.ts';
import { LogShipper } from '../src/logs.ts';

function setup(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'backup-durability-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('X1.4: startup sweeps only old crash remnants and respects another running server', (t) => {
  const dir = setup(t);
  const old = new Date(Date.now() - LEFTOVER_MAX_AGE_MS - 10000);
  const names = ['2026-10-01_120000.partial', '.standby-copy-abcdef.tmp', 'A.openhbam.sqlite.standby-partial', 'A.openhbam.sqlite.restoring'];
  mkdirSync(join(dir, 'Backups'));
  const paths = names.map((n, i) => join(dir, i === 0 ? 'Backups' : '', n));
  paths.forEach((path, i) => {
    if (i === 0) mkdirSync(path); else writeFileSync(path, 'stale');
    utimesSync(path, old, old);
  });
  const fresh = join(dir, 'B.openhbam.sqlite.restoring');
  writeFileSync(fresh, 'recent');
  const live = join(dir, 'A.openhbam.sqlite');
  writeFileSync(live, 'live'); utimesSync(live, old, old);
  const outside = join(dir, 'unrelated'); mkdirSync(outside); utimesSync(outside, old, old);
  const link = join(dir, 'C.openhbam.sqlite.restoring'); symlinkSync(outside, link);
  writeFileSync(join(dir, '.openhbam.pid'), String(process.ppid));
  assert.deepEqual(sweepCrashLeftovers(dir), []);
  paths.forEach((path) => assert.ok(existsSync(path)));
  rmSync(join(dir, '.openhbam.pid'));
  const release = claimFolder(dir);
  release();
  paths.forEach((path) => assert.equal(existsSync(path), false));
  for (const path of [fresh, live, outside, link]) assert.ok(existsSync(path));
});

test('X1.4: replication limits simultaneous copies and releases slots after completion', async (t) => {
  const dir = setup(t);
  createStore(join(dir, 'A.openhbam.sqlite'));
  const host = new Host(dir);
  const shipper = new LogShipper(host);
  const replication = new Replication(host, shipper, 'secret');
  const store = host.get('A')!;
  shipper.follow(store);
  const realBackup = store.backup.bind(store);
  let entered = 0;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(store, 'backup', async (path: string) => {
    if (++entered === MAX_CONCURRENT_COPIES) ready();
    await gate;
    await realBackup(path);
  });
  const handled: Promise<boolean>[] = [];
  const server = createServer((req, res) => { handled.push(replication.handle(req, res, new URL(req.url!, 'http://localhost'))); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/tabularius/replication/v1/files/A/copy`;
  const get = () => fetch(url, { headers: { authorization: 'Bearer secret' }, signal: AbortSignal.timeout(10000) });
  try {
    const pending = Array.from({ length: MAX_CONCURRENT_COPIES }, get);
    await started;
    const limited = await get();
    assert.equal(limited.status, 503);
    assert.equal(limited.headers.get('retry-after'), '1');
    assert.equal(entered, MAX_CONCURRENT_COPIES);
    await limited.text();
    release();
    for (const response of await Promise.all(pending)) {
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    await Promise.all(handled);
    const next = await get();
    assert.equal(next.status, 200);
    await next.arrayBuffer();
  } finally {
    release(); replication.close(); shipper.stop(); host.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('X1.5: durable publication flushes the file before rename and the directory after, stopping on error', () => {
  for (const failure of ['', 'sync:1', 'rename', ...(process.platform === 'win32' ? [] : ['sync:2'])]) {
    const calls: string[] = [];
    let fd = 0;
    const note = (s: string) => { calls.push(s); if (s === failure) throw new Error('disk failure'); };
    const fs: DurableFs = {
      statSync(path) { return { isDirectory: () => path === '/data' }; },
      openSync(path) { note(`open:${path}`); return ++fd; },
      fsyncSync(n) { note(`sync:${n}`); },
      closeSync(n) { note(`close:${n}`); },
      renameSync() { note('rename'); },
    };
    if (failure) assert.throws(() => writeDurable('/data/next', '/data/live', fs), /disk failure/);
    else writeDurable('/data/next', '/data/live', fs);
    const expected = ['open:/data/next', 'sync:1', 'close:1', 'rename', ...(process.platform === 'win32' ? [] : ['open:/data', 'sync:2', 'close:2'])];
    assert.deepEqual(calls, failure === 'sync:1' ? expected.slice(0, 3) : failure === 'rename' ? expected.slice(0, 4) : expected);
  }
});

test('X1.5: container source survives until a full checkpoint completes, including a busy checkpoint', (t) => {
  const dir = setup(t);
  const path = join(dir, 'A.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'A');
  const warnings: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { warnings.push(args); });
  try {
    const external = join(dir, 'RC_Data_FMS', 'A'); mkdirSync(external, { recursive: true });
    const prepare = store.sql.prepare.bind(store.sql);
    let busy = false;
    let checkpointed = 0;
    t.mock.method(store.sql, 'prepare', (sql: string) => {
      if (sql === 'PRAGMA wal_checkpoint(FULL)') {
        assert.ok(existsSync(join(external, busy ? 'busy' : 'ok')), 'source still exists at checkpoint');
        checkpointed++;
        if (busy) return { get: () => ({ busy: 1, log: 2, checkpointed: 1 }) };
      }
      return prepare(sql);
    });
    for (const [id, name] of [[1, 'ok'], [2, 'busy']] as const) {
      writeFileSync(join(external, name), 'data');
      store.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (?, ?, 'text/plain', 'file', x'', ?)").run(id, name, name);
      busy = name === 'busy';
      if (busy) {
        assert.deepEqual(store.moveContainersIn([id]), { moved: 1, bytes: 4, missing: 0 });
        assert.ok(existsSync(join(external, name)));
      } else {
        assert.equal(store.moveContainersIn([id]).moved, 1);
        assert.equal(existsSync(join(external, name)), false);
      }
      assert.equal(Buffer.from(store.container(id)!.data).toString(), 'data');
    }
    assert.equal(checkpointed, 4);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /checkpoint incomplete; external files retained/);
    assert.equal(store.sql.prepare('PRAGMA busy_timeout').get()!.timeout, 5000);
  } finally { store.close(); }
});

for (const mode of ['busy then ready', 'throw then ready', 'always throws', 'incomplete'] as const) {
  test(`container checkpoint retries: ${mode}`, (t) => {
    const dir = setup(t);
    const path = join(dir, 'A.openhbam.sqlite');
    createStore(path);
    const store = new Store(path, 'A');
    const external = join(dir, 'RC_Data_FMS', 'A');
    mkdirSync(external, { recursive: true });
    const source = join(external, 'data');
    writeFileSync(source, 'data');
    const warnings: unknown[][] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => { warnings.push(args); });
    try {
      store.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (1, 'data', 'text/plain', 'file', x'', 'data')").run();
      store.sql.exec('PRAGMA busy_timeout = 1234');
      const prepare = store.sql.prepare.bind(store.sql);
      let attempts = 0;
      t.mock.method(store.sql, 'prepare', (sql: string) => {
        if (sql !== 'PRAGMA wal_checkpoint(FULL)') return prepare(sql);
        return { get() {
          assert.ok(existsSync(source));
          assert.equal(prepare('PRAGMA busy_timeout').get()!.timeout, 50);
          attempts++;
          if (mode === 'always throws' || (mode === 'throw then ready' && attempts === 1)) throw new Error('database is locked');
          if (mode === 'incomplete') return { busy: 0, log: 2, checkpointed: 1 };
          if (attempts === 1) return { busy: 1, log: 2, checkpointed: 1 };
          return prepare(sql).get();
        } };
      });
      assert.deepEqual(store.moveContainersIn([1]), { moved: 1, bytes: 4, missing: 0 });
      const retained = mode === 'always throws' || mode === 'incomplete';
      assert.equal(attempts, retained ? 3 : 2);
      assert.equal(existsSync(source), retained);
      assert.equal(warnings.length, retained ? 1 : 0);
      assert.equal(Buffer.from(store.container(1)!.data).toString(), 'data');
      assert.equal(prepare('PRAGMA busy_timeout').get()!.timeout, 1234);
    } finally { store.close(); }
  });
}

test('X1.6: sync and async encryption stop on a zero-byte read before EOF, while empty files round-trip', async (t) => {
  const dir = setup(t);
  const src = join(dir, 'src'); const enc = join(dir, 'enc'); const plain = join(dir, 'plain');
  writeFileSync(src, 'source');
  let reads = 0;
  assert.throws(() => encryptFileSync(src, enc, 'key', () => { reads++; return 0; }), /changed while being encrypted/);
  assert.equal(reads, 1);
  reads = 0;
  await assert.rejects(encryptFile(src, enc, 'key', async () => { reads++; return 0; }), /changed while being encrypted/);
  assert.equal(reads, 1);
  writeFileSync(src, '');
  encryptFileSync(src, enc, 'key'); decryptFileSync(enc, plain, 'key');
  assert.equal(readFileSync(plain).length, 0);
  await encryptFile(src, enc, 'key'); await decryptFile(enc, plain, 'key');
  assert.equal(readFileSync(plain).length, 0);
});

test('X1.7: encrypted hosting warns in the move preview and still allows the move', (t) => {
  const dir = setup(t); const path = join(dir, 'A.openhbam.sqlite');
  createStore(path); const store = new Store(path, 'A');
  const before = process.env.TABULARIUS_ENCRYPTION_KEY;
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Pic', type: 'container' }] }]);
    const id = Number(store.create('Items', {}).recordId);
    store.setContainer('Items', id, 'Pic', 1, { filename: 'pic', mime: 'text/plain', data: Buffer.from('data') });
    delete process.env.TABULARIUS_ENCRYPTION_KEY;
    assert.ok(!moveContainersToManagedStorage(store, 'Items', 'Pic', { preview: true }).plan.preview.some((s) => s.includes('TABULARIUS_ENCRYPTION_KEY')));
    process.env.TABULARIUS_ENCRYPTION_KEY = 'key';
    const plan = moveContainersToManagedStorage(store, 'Items', 'Pic', { preview: true }).plan;
    assert.ok(plan.preview.some((s) => /TABULARIUS_ENCRYPTION_KEY.*plaintext/.test(s)));
    assert.equal(moveContainersToManagedStorage(store, 'Items', 'Pic', { compact: false }).move?.moved, 1);
  } finally {
    if (before === undefined) delete process.env.TABULARIUS_ENCRYPTION_KEY; else process.env.TABULARIUS_ENCRYPTION_KEY = before;
    store.close();
  }
});
