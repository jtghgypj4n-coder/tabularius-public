// Only generated stores and fake servers on 127.0.0.1. No child processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import type { ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { runScript } from '../src/engine.ts';
import { guardedFetch } from '../src/net-guard.ts';
import type { ScriptConnections } from '../src/connections.ts';
import { ScriptQueue } from '../../server/src/server-queue.ts';
import { deferred, generatedStore, localServer, network, script } from './outbound-engine-helpers.ts';

for (const stage of ['headers', 'body'] as const) test(`stop aborts an in-flight request waiting for ${stage}`, { timeout: 10_000 }, async (t) => {
  const store = generatedStore(t);
  const arrived = deferred();
  const closed = deferred();
  const base = await localServer(t, (_req, res) => {
    res.once('close', () => closed.resolve());
    if (stage === 'body') res.write('partial');
    arrived.resolve();
  });
  const stop = new AbortController();
  const running = runScript(store, script(store, `Set Error Capture [ On ]\nInsert from URL [ $answer ; "${base}/" ]`), { ...network, stop: stop.signal });
  await arrived.promise;
  stop.abort();
  const result = await running;
  await closed.promise;
  assert.equal(result.halted, true);
  assert.equal(result.error, 1);
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
});

for (const kind of ['server', 'automation'] as const) test(`canceling a ${kind} queue run closes its outbound socket`, { timeout: 10_000 }, async (t) => {
  const store = generatedStore(t);
  const queue = new ScriptQueue(2);
  const arrived = deferred();
  const closed = deferred();
  const base = await localServer(t, (_req, res) => { res.write('partial'); res.once('close', () => closed.resolve()); arrived.resolve(); });
  const running = queue.run((stop) => runScript(store, script(store, `Insert from URL [ $answer ; "${base}/" ]\nExit Script [ Text Result: "finished" ]`), { ...network, stop }), { file: store.name, script: 'Generated request', kind });
  await arrived.promise;
  assert.equal(queue.cancel(queue.list().running[0].id), true);
  const result = await running;
  await closed.promise;
  assert.equal(result.halted, true);
  assert.equal(result.error, 1);
  assert.equal(queue.list().running.length, 0);
  assert.equal(queue.list().recent[0].outcome, 'canceled');
});

test('Perform Script on Server uses its own queue stop signal', { timeout: 10_000 }, async (t) => {
  const store = generatedStore(t);
  const queue = new ScriptQueue(2);
  const arrived = deferred();
  const closed = deferred();
  const base = await localServer(t, (_req, res) => { res.write('partial'); res.once('close', () => closed.resolve()); arrived.resolve(); });
  store.applyDesign([{ op: 'createScript', id: 10, name: 'Remote', text: `Insert from URL [ $answer ; "${base}/" ]\nExit Script [ Text Result: "finished" ]` }]);
  const callerStop = new AbortController();
  const running = runScript(store, script(store, 'Perform Script on Server [ "Remote" ; Wait for completion: On ]\nExit Script [ Text Result: Get ( LastError ) ]'), { ...network, stop: callerStop.signal, serverQueue: queue });
  await arrived.promise;
  assert.equal(queue.cancel(queue.list().running[0].id), true);
  const result = await running;
  await closed.promise;
  assert.equal(callerStop.signal.aborted, false);
  assert.equal(queue.list().recent[0].error, 1);
  assert.equal(result.result, '1');
  assert.equal(getEventListeners(callerStop.signal, 'abort').length, 0);
});

test('connection calls share the initiating account pool with ordinary Insert from URL', { timeout: 10_000 }, async (t) => {
  const store = generatedStore(t);
  const other = generatedStore(t, 'Other');
  const received: string[] = [];
  const responses: ServerResponse[] = [];
  const fourth = deferred();
  const base = await localServer(t, (req, res) => {
    received.push(req.url!);
    if (req.url!.startsWith('/fast')) res.end('ok');
    else { responses.push(res); res.write('held'); if (responses.length === 4) fourth.resolve(); }
  });
  // The adapter signs outside the engine in production. The async context must survive that boundary.
  const connections: ScriptConnections = {
    host: () => '127.0.0.1',
    async request(_name, req) {
      await Promise.resolve();
      return guardedFetch(base + req.path, { signal: req.signal }, { policy: { private: true } });
    },
  };
  const stop = new AbortController();
  const jobs: ReturnType<typeof runScript>[] = [];
  t.after(async () => { stop.abort(); await Promise.allSettled(jobs); });
  const run = (file: typeof store, account: string, url: string) => {
    const pending = runScript(file, script(file, `Insert from URL [ $answer ; "${url}" ]\nExit Script [ Text Result: $answer ]`), { ...network, account, connections, stop: stop.signal });
    jobs.push(pending);
    return pending;
  };
  for (let i = 0; i < 4; i++) void run(store, 'alice', `connection://local/held-${i}`);
  await fourth.promise;
  const queued = run(store, 'ALICE', base + '/queued');
  assert.equal((await run(store, 'bob', base + '/fast-bob')).result, 'ok');
  assert.equal((await run(other, 'alice', base + '/fast-other-file')).result, 'ok');
  assert.equal(received.includes('/queued'), false);
  responses[0].end();
  for (let i = 0; i < 200 && !received.includes('/queued'); i++) await sleep(5);
  assert.equal(received.includes('/queued'), true);
  stop.abort();
  assert.equal((await queued).halted, true);
});

test('stop cancels an in-flight connection request and removes the stop listener', { timeout: 10_000 }, async (t) => {
  const store = generatedStore(t);
  const arrived = deferred();
  const closed = deferred();
  const base = await localServer(t, (_req, res) => { res.write('partial'); res.once('close', () => closed.resolve()); arrived.resolve(); });
  const stop = new AbortController();
  const connections: ScriptConnections = {
    host: () => '127.0.0.1',
    request: (_name, req) => guardedFetch(base, { signal: req.signal }, { policy: { private: true } }),
  };
  const pending = runScript(store, script(store, 'Insert from URL [ $answer ; "connection://local/" ]\nExit Script [ Text Result: "finished" ]'), { ...network, connections, stop: stop.signal });
  await arrived.promise;
  stop.abort();
  assert.equal((await pending).error, 1);
  await closed.promise;
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
});

test('the operator cap wins over a script max-time and normal completion removes its listener', { timeout: 10_000 }, async (t) => {
  const store = generatedStore(t);
  const base = await localServer(t, (req, res) => { if (req.url === '/fast') res.end('ok'); else res.write('partial'); });
  const before = process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS;
  t.after(() => { if (before === undefined) delete process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS; else process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS = before; });
  process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS = '100';
  const stop = new AbortController();
  const capped = script(store, `Set Error Capture [ On ]\nInsert from URL [ $answer ; "${base}/slow" ]\nExit Script [ Text Result: Get ( LastError ) ]`);
  capped.steps[1].params!.slots = { 129: '"--max-time 60"' };
  const result = await runScript(store, capped, { ...network, stop: stop.signal });
  assert.equal(result.result, '1631');
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  const success = await runScript(store, script(store, `Insert from URL [ $answer ; "${base}/fast" ]\nExit Script [ Text Result: $answer ]`), { ...network, stop: stop.signal });
  assert.equal(success.result, 'ok');
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
});
