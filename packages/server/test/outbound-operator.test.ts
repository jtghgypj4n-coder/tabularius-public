// Generated stores and real requests on 127.0.0.1; operator work must not inherit a script's context.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { runScript } from '../../scripts/src/engine.ts';
import { outboundContext } from '../../scripts/src/net-guard.ts';
import { deferred, generatedStore, localServer, network, script } from '../../scripts/test/outbound-engine-helpers.ts';
import { ChangeFeed, Webhooks } from '../src/changes.ts';
import type { Host } from '../src/host.ts';
import { ScriptQueue } from '../src/server-queue.ts';

async function until(predicate: () => boolean): Promise<void> {
  const end = performance.now() + 4000; // Four times the webhook batching interval.
  while (!predicate()) {
    assert.ok(performance.now() < end, 'operator work progressed while the script was stopped or busy');
    await sleep(10);
  }
}

function fixture(t: TestContext) {
  const stores = [generatedStore(t, 'Busy'), generatedStore(t, 'Other')];
  for (const store of stores) {
    store.applyDesign([{ op: 'createTable', name: 'Records', fields: [{ name: 'Note', type: 'text' }] }]);
    store.create('Records', { Note: 'before' });
  }
  const host = {
    dir: dirname(stores[0].path), openStores: () => stores, onAdd: [], onClose: [],
    get: (name: string) => stores.find((store) => store.name === name),
  } as unknown as Host;
  const feed = new ChangeFeed(host, {} as never);
  const hooks = new Webhooks(host, feed, true);
  t.after(() => hooks.stop());
  const contexts: unknown[] = [];
  stores[0].listeners.add(() => contexts.push(outboundContext.getStore()));
  feed.subscribe(() => {
    contexts.push(outboundContext.getStore());
    queueMicrotask(() => contexts.push(outboundContext.getStore()));
  });
  return { store: stores[0], other: stores[1], hooks, contexts };
}

const commit = 'Set Field [ Records::Note ; "changed" ]\nCommit Records/Requests [ With dialog: Off ]';

test('a script commit queues webhooks for both files that survive admin cancellation', { timeout: 12_000 }, async (t) => {
  const { store, other, hooks, contexts } = fixture(t);
  const arrived = deferred();
  const deliveries: { database: string; changes: { kind: string }[] }[] = [];
  const base = await localServer(t, (req, res) => {
    if (req.url === '/hold') { res.write('held'); arrived.resolve(); return; }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { deliveries.push(JSON.parse(body)); res.writeHead(204).end(); });
  });
  for (const file of [store, other]) hooks.create({ database: file.name, url: base + '/hook' });
  const queue = new ScriptQueue(1);
  const running = queue.run((stop) => runScript(store, script(store, `${commit}\nInsert from URL [ $answer ; "${base}/hold" ]`), {
    ...network, layout: 'Records', stop,
  }), { file: store.name, script: 'Generated request', kind: 'server' });
  t.after(async () => { for (const job of queue.list().running) queue.cancel(job.id); await running; });
  await arrived.promise;
  assert.equal(hooks.list().find((h) => h.database === store.name)!.queued, 1);
  other.update('Records', 1, { Note: 'another file in the same batch timer' });
  assert.equal(queue.cancel(queue.list().running[0].id), true);
  assert.equal((await running).halted, true);
  await until(() => hooks.list().every((h) => h.delivered === 1));
  assert.deepEqual(deliveries.map((d) => d.database).sort(), ['Busy', 'Other']);
  assert.ok(deliveries.every((d) => d.changes.length === 1 && d.changes[0].kind === 'update'));
  assert.ok(contexts.length >= 4);
  assert.ok(contexts.every((context) => context === undefined), 'store listeners and asynchronous feed subscribers run outside script context');
  assert.ok(hooks.list().every((h) => h.dropped === 0 && !h.lastError));
});

test('webhooks bypass a script file with all eight outbound slots occupied', { timeout: 12_000 }, async (t) => {
  const { store, hooks, contexts } = fixture(t);
  let held = 0;
  let delivered = 0;
  const base = await localServer(t, (req, res) => {
    if (req.url!.startsWith('/hold')) { held++; res.write('held'); return; }
    req.resume();
    req.on('end', () => { delivered++; res.writeHead(204).end(); });
  });
  hooks.create({ database: store.name, url: base + '/hook' });
  const stop = new AbortController();
  const jobs: ReturnType<typeof runScript>[] = [];
  t.after(async () => { stop.abort(); await Promise.allSettled(jobs); });
  for (let i = 0; i < 8; i++) jobs.push(runScript(store, script(store, `Insert from URL [ $answer ; "${base}/hold-${i}" ]`), {
    ...network, account: i < 4 ? 'alice' : 'bob', stop: stop.signal,
  }));
  await until(() => held === 8);
  jobs.push(runScript(store, script(store, `${commit}\nInsert from URL [ $answer ; "${base}/hold-queued" ]`), {
    ...network, layout: 'Records', account: 'carol', stop: stop.signal,
  }));
  await until(() => hooks.list()[0].delivered === 1);
  assert.equal(delivered, 1);
  assert.equal(held, 8, 'the ninth script request is still waiting for capacity');
  assert.equal(stop.signal.aborted, false, 'webhook delivery did not need script cancellation to free a slot');
  assert.ok(contexts.length >= 3 && contexts.every((context) => context === undefined));
});
