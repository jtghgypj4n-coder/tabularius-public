import { test, after } from 'node:test';
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { mailTransport } from '../src/smtp.ts';
import { withRetries } from '../src/assistant.ts';
import { backupFolder, restoreBackup } from '../src/backup.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../../scripts/src/test-only.ts';

test('cancel destroys a blocked SMTP socket and the next request is independent', async (t) => {
  const connected = gate();
  const closed = gate();
  const server = createServer((socket) => {
    connected.resolve();
    socket.on('close', () => closed.resolve());
    socket.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  const stop = new AbortController();
  const send = mailTransport({ url: `smtp://127.0.0.1:${port}` }, 'sender@test.invalid');
  const message = { to: ['receiver@test.invalid'], cc: [], bcc: [], fromName: '', subject: 'generated', text: '', attachments: [], files: [] };
  const sending = send({ ...message, signal: stop.signal });
  const rejected = assert.rejects(sending, /canceled/);
  await connected.promise;
  stop.abort();
  await rejected;
  await closed.promise;
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  const fresh = new AbortController();
  fresh.abort();
  await assert.rejects(send({ ...message, signal: fresh.signal }), { name: 'AbortError' });
});

test('AI cancellation interrupts retry backoff and never starts another request', async () => {
  const stop = new AbortController();
  const waiting = gate();
  const release = gate();
  let calls = 0;
  const run = withRetries(async () => { calls++; return new Response('', { status: 429 }); }, stop.signal, () => { waiting.resolve(); return release.promise; });
  const rejected = assert.rejects(run, { name: 'AbortError' });
  await waiting.promise;
  stop.abort();
  await rejected;
  release.resolve();
  assert.equal(calls, 1);
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  assert.equal((await withRetries(async () => new Response('ok'))).status, 200);
});

test('backup cancellation removes staging and releases its queue for the next backup', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-backup-cancel-'));
  const dest = join(dir, 'backups');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  createStore(join(dir, 'Test.openhbam.sqlite'));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(dir, 'Test.openhbam.sqlite'));
  db.exec('CREATE TABLE generated_payload (value BLOB); BEGIN');
  const insert = db.prepare('INSERT INTO generated_payload VALUES (zeroblob(8192))');
  for (let i = 0; i < 256; i++) insert.run();
  db.exec('COMMIT');
  db.close();
  const stop = new AbortController();
  await assert.rejects(backupFolder(dir, dest, 7, '', { signal: stop.signal, now: () => { setImmediate(() => stop.abort()); return 1_800_000_000_000; } }), /stopped/);
  assert.deepEqual(readdirSync(dest), []);
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  const next = await backupFolder(dir, dest, 7, '');
  assert.deepEqual(next.files, ['Test.openhbam.sqlite']);
});

test('restore cancellation before publication leaves live data intact and removes staging', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-cancel-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Test.openhbam.sqlite');
  createStore(path);
  let store = new Store(path, 'Test');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  const id = store.create('Items', { Name: 'backup' }).recordId;
  store.close();
  const backup = await backupFolder(dir, join(dir, 'backups'), 7, '');
  store = new Store(path, 'Test');
  store.update('Items', id, { Name: 'live' });
  store.close();
  const stop = new AbortController();
  const restoring = restoreBackup(dir, backup.dir, undefined, '', { signal: stop.signal });
  // restoreBackup reaches its checksum await after staging the generated database.
  stop.abort();
  await assert.rejects(restoring, { name: 'AbortError' });
  assert.ok(!readdirSync(dir).some((f) => f.includes('.restoring')));
  store = new Store(path, 'Test');
  assert.equal(store.get('Items', id).fieldData.Name, 'live');
  store.close();
  await restoreBackup(dir, backup.dir, undefined, '');
});

test('worker cancellation waits for exit before staging cleanup and a subsequent worker runs', async () => {
  const { Worker } = await import('node:worker_threads');
  const { workerResult } = await import('../src/worker-result.ts');
  const stop = new AbortController();
  const worker = new Worker('setInterval(() => {}, 1000)', { eval: true });
  const online = new Promise<void>((r) => worker.once('online', r));
  let exited = false;
  worker.once('exit', () => { exited = true; });
  const running = workerResult(worker, () => undefined, stop.signal);
  const rejected = assert.rejects(running, { name: 'AbortError' });
  await online;
  stop.abort();
  await rejected;
  assert.equal(exited, true);
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  const next = new Worker('require("node:worker_threads").parentPort.postMessage(42)', { eval: true });
  assert.equal(await workerResult(next, (n) => Number(n), new AbortController().signal), 42);
});

test('sync cancellation destroys its active request and does not retry or fetch another page', async (t) => {
  const { createServer } = await import('node:http');
  const { dataApiSource } = await import('../src/fms-sync.ts');
  const waiting = gate();
  const closed = gate();
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    req.resume();
    if (req.method === 'POST') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ messages: [{ code: '0' }], response: { token: 'fake' } }));
    } else if (req.method === 'DELETE') res.end('{}');
    else {
      res.on('close', () => closed.resolve());
      waiting.resolve();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const stop = new AbortController();
  const source = dataApiSource({ server: `http://127.0.0.1:${(server.address() as { port: number }).port}`, database: 'Generated', user: 'test', password: 'fake', signal: stop.signal,
    tables: [{ localTable: 'Items', remoteLayout: 'Items', uuidField: 'ID', modTimestampField: 'Modified' }] });
  const running = source.changedSince('Items', null);
  const rejected = assert.rejects(running);
  await waiting.promise;
  stop.abort();
  await rejected;
  await closed.promise;
  assert.equal(calls, 2);
  await source.close();
  assert.equal(calls, 3, 'the session is logged out even after cancellation');
});

test('canceling an agent dry run during its backup removes the copy before another run', async (t) => {
  const { dryRunPlan } = await import('../src/agent.ts');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-agent-cancel-'));
  createStore(join(dir, 'Test.openhbam.sqlite'));
  const store = new Store(join(dir, 'Test.openhbam.sqlite'), 'Test');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  const entered = gate();
  const release = gate();
  const backup = store.backup.bind(store);
  let copyPath = '';
  t.mock.method(store, 'backup', async (path: string) => { await backup(path); copyPath = path; entered.resolve(); await release.promise; });
  const stop = new AbortController();
  const plan = { summary: 'generated', layout: 'Items', steps: [{ kind: 'find' as const, layout: 'Items' }] };
  const running = dryRunPlan(store, plan, { account: 'Admin', signal: stop.signal });
  const rejected = assert.rejects(running, { name: 'AbortError' });
  await entered.promise;
  stop.abort();
  release.resolve();
  await rejected;
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(copyPath), false);
  t.mock.restoreAll();
  assert.equal((await dryRunPlan(store, plan, { account: 'Admin' })).results.length, 1);
});

test('canceling a Perform Script on Server caller releases it while the independent server session continues', async (t) => {
  const { runScript } = await import('@tabularius/scripts');
  const { ScriptQueue } = await import('../src/server-queue.ts');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-psos-cancel-'));
  createStore(join(dir, 'Test.openhbam.sqlite'));
  const store = new Store(join(dir, 'Test.openhbam.sqlite'), 'Test');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] },
    { op: 'createScript', name: 'Worker', text: 'Insert from URL [ $result ; "http://127.0.0.1/blocked" ]' },
  ]);
  const id = store.create('Items', { Name: 'before' }).recordId;
  const worker = store.schema.scripts.find((s) => s.name === 'Worker')!;
  store.applyDesign([{ op: 'createScript', name: 'Caller', text: 'Open Transaction\nSet Field [ Items::Name ; "pending" ]\nPerform Script on Server [ “Worker” ; Wait for completion: On ]\nCommit Transaction' }]);
  const caller = store.schema.scripts.find((s) => s.name === 'Caller')!;
  caller.steps[2].params = { script: { id: worker.id, name: worker.name }, wait: true };
  const entered = gate();
  const released = gate();
  const stop = new AbortController();
  let serverSignal: AbortSignal | undefined;
  const queue = new ScriptQueue(1);
  const running = runScript(store, caller, { layout: 'Items', foundSet: [id], stop: stop.signal, serverQueue: queue, [TEST_ONLY_CUSTOM_FETCH]: true,
    network: (async (_url, init) => {
      serverSignal = init?.signal ?? undefined;
      entered.resolve();
      await released.promise;
      return new Response('done');
    }) as typeof fetch });
  await entered.promise;
  stop.abort();
  const result = await running;
  assert.equal(result.halted, true);
  assert.equal(result.error, 1);
  assert.equal(serverSignal?.aborted, false);
  assert.equal(store.get('Items', id).fieldData.Name, 'before');
  store.update('Items', id, { Name: 'next request' });
  released.resolve();
  // Let the independent session finish before closing its store.
  while (queue.running) await new Promise<void>((r) => setImmediate(r));
  assert.equal(queue.running, 0);
});

// The runner gives every child a stub PATH; a prohibited command makes the test fail.
after(() => {
  const marker = process.env.TABULARIUS_TEST_COMMAND_MARKER;
  if (marker) assert.equal(existsSync(marker), false, 'a prohibited child command was invoked');
});
