import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { Host, STORE_EXT } from '../src/host.ts';
import { applyLog, decodeRecords, LogShipper } from '../src/logs.ts';
import { COPY_HOLD_MS, Replication } from '../src/replication.ts';

const TOKEN = ['synthetic', 'copy', 'credential'].join('-');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-copy-'));
  for (const name of ['A', 'B']) createStore(join(dir, name + STORE_EXT));
  const host = new Host(dir);
  const lines: string[] = [];
  const shipper = new LogShipper(host, (line) => lines.push(line));
  const replication = new Replication(host, shipper, TOKEN);
  const store = host.get('A')!;
  for (const name of host.names()) host.get(name)!.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  shipper.ship();
  const handled: Promise<boolean>[] = [];
  const responses: ServerResponse[] = [];
  const server = createServer((req, res) => {
    responses.push(res);
    handled.push(replication.handle(req, res, new URL(req.url!, 'http://localhost')));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/tabularius/replication/v1/files`;
  const get = (path: string) => fetch(base + path, { headers: { authorization: `Bearer ${TOKEN}`, connection: 'close' } });
  const gates: ReturnType<typeof deferred>[] = [];
  const slowCopies = (count = 1, snapshotAfterWrites = false) => {
    const copies = Array.from({ length: count }, () => ({ entered: deferred(), release: deferred() }));
    gates.push(...copies.map((c) => c.release));
    const realBackup = store.backup.bind(store);
    let next = 0;
    t.mock.method(store, 'backup', async (path: string) => {
      const gate = copies[next++];
      // Exercise both a snapshot before the concurrent writes and one that already includes them.
      if (!snapshotAfterWrites) await realBackup(path);
      gate.entered.resolve();
      await gate.release.promise;
      if (snapshotAfterWrites) await realBackup(path);
    });
    return copies.map((c) => ({ entered: c.entered.promise, release: c.release.resolve }));
  };
  const position = async () => {
    const { files } = await (await get('')).json() as { files: { name: string; run: string; seq: number }[] };
    return files.find((f) => f.name === 'A')!;
  };
  const contents = (s: Store) => s.find('Items', { limit: 100_000 }).records.map((r) => [r.recordId, r.fieldData]);
  const catchUp = async (copy: Response) => {
    assert.equal(copy.status, 200);
    const path = join(dir, 'replica.sqlite');
    writeFileSync(path, Buffer.from(await copy.arrayBuffer()));
    const from = Number(copy.headers.get('x-tabularius-seq'));
    const run = copy.headers.get('x-tabularius-run');
    const changes = await get(`/A/changes?run=${run}&after=${from}&wait=0`);
    assert.equal(changes.status, 200);
    const records = decodeRecords(Buffer.from(await changes.arrayBuffer()));
    for (const record of records) applyLog(path, record.data);
    assert.ok((records.at(-1)?.seq ?? from) >= Number(copy.headers.get('x-tabularius-whole-after')));
    const replica = new Store(path, 'Replica');
    try { assert.deepEqual(contents(replica), contents(store)); }
    finally { replica.close(); }
  };
  t.after(async () => {
    for (const gate of gates) gate.resolve();
    await Promise.all(handled);
    replication.close(); shipper.stop(); host.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, host, store, shipper, replication, lines, handled, responses, get, position, slowCopies, catchUp };
}

test('copy holds shipping across concurrent writes and replays every record from its exact position', async (t) => {
  const h = await setup(t);
  h.store.create('Items', { Name: 'Before copying' });
  const [gate] = h.slowCopies();
  const pending = h.get('/A/copy');
  await gate.entered;
  const before = await h.position();
  for (let i = 0; i < 8; i++) {
    h.store.create('Items', { Name: `During copying ${i}` });
    h.shipper.ship();
  }
  const during = await h.position();
  gate.release();
  const copy = await pending;
  await h.catchUp(copy);
  assert.equal(during.seq, before.seq, 'shipping must not advance while the online backup is pending');
  assert.equal(copy.headers.get('x-tabularius-seq'), String(before.seq));
  assert.equal(copy.headers.get('x-tabularius-whole-after'), String(before.seq));
  assert.equal(copy.headers.get('x-openhbam-seq'), String(before.seq));
  assert.equal(copy.headers.get('x-openhbam-whole-after'), String(before.seq));
});

test('timeout resumes shipping and the fallback copy catches up to every primary record', async (t) => {
  const h = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const [gate] = h.slowCopies();
  const pending = h.get('/A/copy');
  await gate.entered;
  const before = await h.position();
  h.store.create('Items', { Name: 'Held' });
  h.shipper.ship();
  assert.equal((await h.position()).seq, before.seq);
  t.mock.timers.tick(COPY_HOLD_MS);
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], /A: copy was taken while changes shipped/);
  assert.ok((await h.position()).seq > before.seq);
  for (let i = 0; i < 4; i++) {
    h.store.create('Items', { Name: `After timeout ${i}` });
    h.shipper.ship();
  }
  h.store.create('Items', { Name: 'Pending at backup completion' });
  gate.release();
  const copy = await pending;
  await h.catchUp(copy);
  assert.ok(Number(copy.headers.get('x-tabularius-whole-after')) > Number(copy.headers.get('x-tabularius-seq')));
  assert.equal(copy.headers.get('x-openhbam-whole-after'), copy.headers.get('x-tabularius-whole-after'));
});

test('destroying the response releases shipping before the blocked backup finishes', async (t) => {
  const h = await setup(t);
  const [gate] = h.slowCopies();
  const pending = h.get('/A/copy').catch((e: Error) => e);
  await gate.entered;
  const before = await h.position();
  h.store.create('Items', { Name: 'Before disconnect' });
  h.shipper.ship();
  assert.equal((await h.position()).seq, before.seq);
  const closed = deferred();
  h.responses[0].once('close', closed.resolve);
  h.responses[0].destroy();
  await closed.promise;
  assert.ok(await pending instanceof Error);
  assert.ok((await h.position()).seq > before.seq);
  assert.equal(h.responses[0].headersSent, false);
  gate.release();
  await Promise.all(h.handled);
  assert.deepEqual(readdirSync(h.dir).filter((name) => name.endsWith('.tmp')), []);
  t.mock.restoreAll();
  const next = await h.get('/A/copy');
  await h.catchUp(next);
});

test('a throwing backup releases its hold and copy slot', async (t) => {
  const h = await setup(t);
  const before = await h.position();
  t.mock.method(h.store, 'backup', async () => {
    h.store.create('Items', { Name: 'Before backup failure' });
    throw new Error('synthetic backup failure');
  });
  const copy = await h.get('/A/copy');
  assert.equal(copy.status, 500);
  assert.match(await copy.text(), /synthetic backup failure/);
  assert.ok((await h.position()).seq > before.seq);
  t.mock.restoreAll();
  await h.catchUp(await h.get('/A/copy'));
});

test('held WAL grows past autocheckpoint size, other files and backups proceed, and both followers receive every page', async (t) => {
  const h = await setup(t);
  const logs: Buffer[] = [];
  const other: Buffer[] = [];
  h.shipper.add({ every: 1000, take: (store, data) => {
    (store === h.store ? logs : other).push(Buffer.from(data));
    return true;
  } });
  const backupPath = join(h.dir, 'backup.sqlite');
  const realBackup = h.store.backup.bind(h.store);
  await realBackup(backupPath);
  const [gate] = h.slowCopies();
  const pending = h.get('/A/copy');
  await gate.entered;
  assert.equal((h.store.sql.prepare('PRAGMA wal_autocheckpoint').get() as { wal_autocheckpoint: number }).wal_autocheckpoint, 0);
  for (let i = 0; i < 24; i++) {
    h.store.create('Items', { Name: `${i}:` + 'x'.repeat(200_000) });
    h.shipper.ship();
  }
  assert.equal(logs.length, 0);
  const pageSize = Number(h.store.sql.prepare('PRAGMA page_size').get()!.page_size);
  assert.ok(statSync(h.store.path + '-wal').size > pageSize * 1000, 'held WAL survives the usual automatic checkpoint threshold');
  h.host.get('B')!.create('Items', { Name: 'Other file' });
  h.shipper.ship();
  assert.equal(other.length, 1);
  const second = await h.get('/B/copy');
  assert.equal(second.status, 200);
  await second.arrayBuffer();
  await realBackup(join(h.dir, 'independent-backup.sqlite'));
  gate.release();
  await h.catchUp(await pending);
  assert.equal(logs.length, 1);
  for (const log of logs) applyLog(backupPath, log);
  const backup = new Store(backupPath, 'Backup');
  try {
    assert.deepEqual(backup.find('Items', { limit: 100 }).records, h.store.find('Items', { limit: 100 }).records);
  } finally { backup.close(); }
});

test('two copies share the hold until the last finishes and the third is refused', async (t) => {
  const h = await setup(t);
  const [first, second] = h.slowCopies(2);
  const pendingFirst = h.get('/A/copy');
  await first.entered;
  const pendingSecond = h.get('/A/copy');
  await second.entered;
  const third = await h.get('/B/copy');
  assert.equal(third.status, 503);
  await third.arrayBuffer();
  const before = await h.position();
  h.store.create('Items', { Name: 'Shared hold' });
  first.release();
  const copyFirst = await pendingFirst;
  const bytesFirst = Buffer.from(await copyFirst.arrayBuffer());
  h.shipper.ship();
  assert.equal((await h.position()).seq, before.seq, 'first completion must not release the second holder');
  second.release();
  const copySecond = await pendingSecond;
  await h.catchUp(copySecond);
  await h.catchUp(new Response(bytesFirst, { headers: copyFirst.headers }));
  assert.equal(copyFirst.headers.get('x-tabularius-whole-after'), String(before.seq));
  assert.equal(copySecond.headers.get('x-tabularius-whole-after'), String(before.seq));
});

test('a second copy cannot extend the shared deadline and both copies fall back', async (t) => {
  const h = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const [first, second] = h.slowCopies(2);
  const pendingFirst = h.get('/A/copy');
  await first.entered;
  t.mock.timers.tick(COPY_HOLD_MS / 2);
  const pendingSecond = h.get('/A/copy');
  await second.entered;
  h.store.create('Items', { Name: 'Shared timeout' });
  t.mock.timers.tick(COPY_HOLD_MS / 2);
  assert.equal(h.lines.length, 1);
  first.release(); second.release();
  for (const pending of [pendingFirst, pendingSecond]) {
    const copy = await pending;
    await h.catchUp(copy);
    assert.ok(Number(copy.headers.get('x-tabularius-whole-after')) > Number(copy.headers.get('x-tabularius-seq')));
  }
});

test('a held copy that already includes concurrent edits replays the retained WAL without losing records', async (t) => {
  const h = await setup(t);
  for (let i = 0; i < 10; i++) h.store.create('Items', { Name: `Before ${i}` });
  const [gate] = h.slowCopies(1, true);
  const pending = h.get('/A/copy');
  await gate.entered;
  const before = await h.position();
  for (let i = 1; i <= 10; i++) {
    if (i % 2) h.store.update('Items', i, { Name: `Edited ${i}` });
    else h.store.delete('Items', i);
    h.store.create('Items', { Name: `Added ${i}` });
    h.shipper.ship();
  }
  assert.equal((await h.position()).seq, before.seq);
  gate.release();
  const copy = await pending;
  const bytes = Buffer.from(await copy.arrayBuffer());
  const snapshotPath = join(h.dir, 'snapshot.sqlite');
  writeFileSync(snapshotPath, bytes);
  const snapshot = new Store(snapshotPath, 'Snapshot');
  try { assert.deepEqual(snapshot.find('Items').records, h.store.find('Items').records); }
  finally { snapshot.close(); }
  await h.catchUp(new Response(bytes, { headers: copy.headers }));
  assert.equal(copy.headers.get('x-tabularius-whole-after'), String(before.seq));
});

test('finishing a timed-out copy cannot release a later copy hold', async (t) => {
  const h = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const [first, second] = h.slowCopies(2);
  const pendingFirst = h.get('/A/copy');
  await first.entered;
  h.store.create('Items', { Name: 'Before timeout' });
  t.mock.timers.tick(COPY_HOLD_MS);
  const pendingSecond = h.get('/A/copy');
  await second.entered;
  const before = await h.position();
  first.release();
  const copyFirst = await pendingFirst;
  const bytesFirst = Buffer.from(await copyFirst.arrayBuffer());
  h.store.create('Items', { Name: 'Later hold' });
  h.shipper.ship();
  assert.equal((await h.position()).seq, before.seq);
  second.release();
  await h.catchUp(await pendingSecond);
  await h.catchUp(new Response(bytesFirst, { headers: copyFirst.headers }));
  t.mock.timers.tick(COPY_HOLD_MS);
  assert.equal(h.lines.length, 1, 'completed copies cancel their timeout');
});

test('the fallback keeps the pending-WAL estimate when another follower refuses changes', async (t) => {
  const h = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let accept = false;
  h.shipper.add({ every: 1000, take: () => accept });
  const [gate] = h.slowCopies();
  const pending = h.get('/A/copy');
  await gate.entered;
  h.store.create('Items', { Name: 'Retained for backup' });
  t.mock.timers.tick(COPY_HOLD_MS);
  h.store.create('Items', { Name: 'Still pending' });
  gate.release();
  const copy = await pending;
  assert.equal(Number(copy.headers.get('x-tabularius-whole-after')), (await h.position()).seq + 1);
  accept = true;
  h.shipper.ship();
  await h.catchUp(copy);
});

test('pausing and resuming a file during a held copy ships its changes first, so none are lost', async (t) => {
  const h = await setup(t);
  // The wiring serve() does: closing or pausing a file ships what follows it before the checkpoint folds the log away.
  h.host.beforeClose.push(() => h.shipper.shipBeforeCheckpoint());
  const [gate] = h.slowCopies();
  const pending = h.get('/A/copy');
  await gate.entered;
  for (let i = 0; i < 5; i++) h.store.create('Items', { Name: `During the hold ${i}` });
  assert.equal(h.host.pauseFile('A'), true);
  assert.equal(h.host.openFile('A'), true);
  gate.release();
  const copy = await pending;
  await h.catchUp(copy);
  assert.equal(h.store.find('Items', { limit: 100 }).records.length, 5);
});

test('closing a file during a held copy ships its changes first, so a follower has every record', async (t) => {
  const h = await setup(t);
  h.host.beforeClose.push(() => h.shipper.shipBeforeCheckpoint());
  const base = join(h.dir, 'closed-replica.sqlite');
  await h.store.backup(base);
  const shipped: Buffer[] = [];
  h.shipper.add({ every: 60_000, take: (_store, log) => { shipped.push(Buffer.from(log)); return true; } });
  const [gate] = h.slowCopies();
  const pending = h.get('/A/copy');
  await gate.entered;
  for (let i = 0; i < 5; i++) h.store.create('Items', { Name: `During the hold ${i}` });
  assert.equal(h.host.closeFile('A'), true);
  gate.release();
  await pending; // the copy is refused (the file was closed); what matters is that the follower got every change
  // The logs the follower received bring the file as it was before the writes up to date.
  for (const log of shipped) applyLog(base, log);
  const replica = new Store(base, 'Replica');
  try { assert.equal(replica.find('Items', { limit: 100 }).records.length, 5); }
  finally { replica.close(); }
});

test('serve() ships before the checkpoint through the hold-ignoring path', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8'), /shipper\.shipBeforeCheckpoint\(\)/);
});
