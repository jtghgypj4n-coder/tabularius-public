import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Host } from '../src/host.ts';
import { serve } from '../src/index.ts';
import { explainHostingFailure } from '../src/uploads.ts';
import { workerResult } from '../src/worker-result.ts';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

test('conversion timeout preserves its duration and waits for worker termination', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-convert-timeout-'));
  const host = new Host(dir);
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const terminate = Worker.prototype.terminate;
  let exited = false;
  t.mock.method(Worker.prototype, 'terminate', async function (this: Worker) {
    const code = await terminate.call(this);
    exited = true;
    return code;
  });
  const converter = host as unknown as {
    convert(src: string, dest: string, progress: undefined, limits: { timeoutMs: number; memoryMb: number }, passphrase?: string, signal?: AbortSignal): Promise<unknown>;
  };
  const stop = new AbortController();
  const running = converter.convert(join(dir, 'missing.fmp12'), join(dir, 'temp'), undefined, { timeoutMs: 2000, memoryMb: 0 }, undefined, stop.signal);
  const rejected = assert.rejects(running, { message: 'conversion took longer than 2s and was stopped' });
  t.mock.timers.tick(2000);
  await rejected;
  assert.equal(exited, true);
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  const explanation = explainHostingFailure('Example', 'conversion took longer than 2s and was stopped');
  assert.match(explanation, /conversion took longer than 2s and was stopped/);
  assert.match(explanation, /TABULARIUS_CONVERT_TIMEOUT/);
  assert.doesNotMatch(explanation, /damaged|FileMaker Pro/);

  // A caller's own timeout reason is an external cancellation, not the conversion deadline.
  const external = new AbortController();
  const reason = new DOMException('caller deadline', 'TimeoutError');
  const canceled = converter.convert(join(dir, 'missing.fmp12'), join(dir, 'temp'), undefined, { timeoutMs: 2000, memoryMb: 0 }, undefined, external.signal);
  const externalRejected = assert.rejects(canceled, (e) => e === reason);
  external.abort(reason);
  await externalRejected;
  assert.equal(getEventListeners(external.signal, 'abort').length, 0);
});

test('upload DELETE waits for worker exit and cleanup, and logs cancellation', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-upload-cancel-'));
  const logs: string[] = [];
  const { server, host, url } = await serve({ dir, port: 0, log: (message) => logs.push(message) });
  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });
  const entered = gate();
  const stopping = gate();
  const release = gate();
  t.after(() => release.resolve());
  let exited = false;
  let signal: AbortSignal | undefined;
  t.mock.method(host, 'hostUpload', async (_src: string, _name: string, _progress: unknown, stop: AbortSignal) => {
    signal = stop;
    const worker = new Worker('setInterval(() => {}, 1000)', { eval: true });
    worker.once('online', entered.resolve);
    worker.once('exit', () => { exited = true; });
    const terminate = worker.terminate.bind(worker);
    t.mock.method(worker, 'terminate', async () => {
      stopping.resolve();
      await release.promise;
      return terminate();
    });
    return workerResult(worker, () => undefined, stop);
  });
  let answeredBeforeExit = false;
  server.on('request', (req, res) => {
    if (req.method === 'DELETE') res.once('finish', () => { answeredBeforeExit = !exited; });
  });
  const admin = async (path: string, method = 'GET', body?: string | Uint8Array<ArrayBuffer>) => {
    const response = await fetch(`${url}/tabularius/admin/v1/uploads${path}`, {
      method, headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body,
    });
    return { status: response.status, body: await response.json() };
  };
  const started = await admin('', 'POST', JSON.stringify({ name: 'Generated.fmp12', size: 1 }));
  assert.equal(started.status, 201);
  const id = started.body.id as string;
  const part = join(dir, '.openhbam-uploads', `${id}.part`);
  assert.equal((await admin(`/${id}?offset=0`, 'PUT', new Uint8Array([0]))).status, 200);
  assert.equal((await admin(`/${id}/finish`, 'POST')).status, 200);
  await entered.promise;
  const deleting = admin(`/${id}`, 'DELETE');
  try {
    await stopping.promise;
    assert.equal(exited, false);
    assert.equal(existsSync(part), true, 'the worker still owns its source');
    // A second request makes progress while DELETE waits for the worker.
    assert.equal((await admin(`/${id}`)).status, 200);
  } finally { release.resolve(); }
  assert.equal((await deleting).status, 200);
  assert.equal(exited, true);
  assert.equal(answeredBeforeExit, false);
  assert.equal(getEventListeners(signal!, 'abort').length, 0);
  assert.equal((await admin(`/${id}`)).status, 404);
  assert.deepEqual(readdirSync(join(dir, '.openhbam-uploads')), []);
  assert.ok(logs.some((line) => line === 'cancelled upload of Generated.fmp12'), logs.join('\n'));
  assert.ok(!logs.some((line) => line.includes("couldn't host uploaded Generated")), logs.join('\n'));
  assert.equal((await admin('', 'POST', JSON.stringify({ name: 'Generated.fmp12', size: 1 }))).status, 201, 'the cancelled name is available again');
});
