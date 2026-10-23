// Webhook receivers may send bodies we never need, or leave those bodies open indefinitely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { deferred, generatedStore, localServer } from '../../scripts/test/outbound-engine-helpers.ts';
import { ChangeFeed, Webhooks } from '../src/changes.ts';
import type { Host } from '../src/host.ts';

test('unsent changes stay pending when a delivery batch is held while the queue overflows', async (t) => {
  const store = generatedStore(t);
  const host = { dir: dirname(store.path), get: () => store } as unknown as Host;
  const hooks = new Webhooks(host, { subscribe: () => {} } as unknown as ChangeFeed, true);
  t.after(() => hooks.stop());
  const hook = hooks.create({ database: store.name, url: 'https://example.com/hook' });
  const internals = hooks as unknown as { enqueue: (file: string, entry: { seq: number; kind: 'create'; table: string; at: string }) => void; queues: Map<string, { entry: { seq: number } }[]> };
  const first = deferred<Response>();
  const second = deferred<Response>();
  const sent: number[][] = [];
  hooks.fetch = async (_url, init) => {
    sent.push((JSON.parse(String(init?.body)) as { changes: { seq: number }[] }).changes.map((c) => c.seq));
    return sent.length === 1 ? first.promise : second.promise;
  };
  for (let seq = 1; seq <= 500; seq++) internals.enqueue(store.name, { seq, kind: 'create', table: 'Records', at: '' });
  const flushing = hooks.flush();
  assert.deepEqual([sent[0][0], sent[0].at(-1)], [1, 500]);
  for (let seq = 501; seq <= 5500; seq++) internals.enqueue(store.name, { seq, kind: 'create', table: 'Records', at: '' });
  first.resolve(new Response(null, { status: 204 }));
  await flushing;
  assert.equal(sent[1][0], 501);
  assert.equal(internals.queues.get(hook.id)?.[0]?.entry.seq, 1001);
  assert.deepEqual([hooks.list()[0].delivered, hooks.list()[0].dropped], [500, 0]);
  hooks.stop();
  second.resolve(new Response(null, { status: 204 }));
});

for (const mode of ['changes', 'digest'] as const) for (const retry of [false, true]) {
  test(`${mode} delivery cancels ${retry ? 'failed and successful' : 'successful'} response bodies`, { timeout: 10_000 }, async (t) => {
    const store = generatedStore(t);
    store.applyDesign([{ op: 'createTable', name: 'Records', fields: [{ name: 'Note', type: 'text' }] }]);
    const host = {
      dir: dirname(store.path), openStores: () => [store], onAdd: [], onClose: [],
      get: (name: string) => name === store.name ? store : undefined,
    } as unknown as Host;
    const hooks = new Webhooks(host, new ChangeFeed(host, {} as never), true);
    t.after(() => hooks.stop());
    let requests = 0;
    let closed = 0;
    const base = await localServer(t, (req, res) => {
      req.resume();
      req.on('end', () => {
        requests++;
        res.once('close', () => { closed++; });
        res.writeHead(retry && requests === 1 ? 503 : 200);
        res.write('acknowledgement that never ends');
      });
    });
    const responses: Response[] = [];
    const signals: AbortSignal[] = [];
    const fetch = hooks.fetch;
    hooks.fetch = async (input, init) => {
      if (responses.length) assert.equal(responses.at(-1)!.bodyUsed, true, 'the failed body was cancelled before retrying');
      const response = await fetch(input, init);
      responses.push(response);
      signals.push(init!.signal!);
      return response;
    };
    const hook = hooks.create({ database: store.name, url: base });
    if (mode === 'changes') {
      store.create('Records', { Note: 'changed' });
      await hooks.flush();
    } else await hooks.post(hook.id, store.name, { digest: 'ready' });
    assert.equal(responses.length, retry ? 2 : 1);
    assert.ok(responses.every((response) => response.bodyUsed), 'all unused bodies were cancelled');
    const end = performance.now() + 3000;
    while (closed < responses.length) {
      assert.ok(performance.now() < end, 'cancelled response sockets closed within 3 seconds');
      await sleep(5);
    }
    assert.ok(signals.every((signal) => getEventListeners(signal, 'abort').length === 0), 'delivery deadlines retain no body links');
    assert.equal(hooks.list()[0].delivered, 1);
    assert.equal(hooks.list()[0].dropped, 0);
    assert.equal(hooks.list()[0].queued, 0);
  });
}
