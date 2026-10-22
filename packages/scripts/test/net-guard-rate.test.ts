// Fake monotonic clock and interval scheduling; generated HTTP bodies on loopback only.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getEventListeners } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { guardedFetch, outboundContext } from '../src/net-guard.ts';

async function response(t: TestContext, contentType = 'text/plain', script = true) {
  let upstream!: ServerResponse;
  const server = createServer((_req, res) => { upstream = res; res.setHeader('content-type', contentType); res.write(Buffer.alloc(15 * 1024)); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const stop = new AbortController();
  t.after(() => new Promise<void>((resolve) => { stop.abort(); server.closeAllConnections(); server.close(() => resolve()); }));
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.timers.enable({ apis: ['setInterval'] });
  const open = () => guardedFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { signal: stop.signal }, { policy: { private: true }, timeoutMs: Infinity });
  const result = script ? await outboundContext.run({ file: 'rate-clock', account: 'a' }, open) : await open();
  const reader = result.body!.getReader();
  assert.equal((await reader.read()).value?.length, 15 * 1024);
  return {
    reader, stop, upstream,
    tick(ms = 15_000) { now += ms; t.mock.timers.tick(ms); },
  };
}

test('minimum rate accepts the exact boundary and resets bytes for the next window', async (t) => {
  const { reader, stop, tick } = await response(t);
  tick(); // Exactly 1024 B/s.
  assert.equal(getEventListeners(stop.signal, 'abort').length > 0, true);
  const pending = reader.read();
  const rejected = assert.rejects(pending, /transfer rate.*1024/);
  tick(14_999);
  // No interval has fired yet, even though this window received nothing.
  assert.equal(getEventListeners(stop.signal, 'abort').length > 0, true);
  tick(1);
  await rejected;
  await sleep(0);
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
});

test('an early burst cannot subsidise a trickling tail in later windows', async (t) => {
  const { reader, upstream, tick } = await response(t);
  upstream.write(Buffer.alloc(30 * 1024));
  assert.equal((await reader.read()).value?.length, 30 * 1024);
  tick();
  upstream.write('x');
  assert.equal((await reader.read()).value?.length, 1);
  const rejected = assert.rejects(reader.read(), /transfer rate/);
  tick();
  await rejected;
});

test('a delayed rate tick uses elapsed monotonic time, not just the nominal interval', async (t) => {
  const { reader, tick } = await response(t);
  const rejected = assert.rejects(reader.read(), /transfer rate/);
  tick(15_001); // 15 KiB over more than 15 seconds is below the threshold.
  await rejected;
});

for (const [label, contentType, script] of [
  ['operator', 'text/plain', false], ['script SSE', 'Text/Event-Stream; charset=utf-8', true],
] as const) test(`${label} is exempt from the minimum rate under a fake clock`, async (t) => {
  const { reader, upstream, tick } = await response(t, contentType, script);
  tick(60_000);
  upstream.end('done');
  assert.equal(Buffer.from((await reader.read()).value!).toString(), 'done');
  assert.equal((await reader.read()).done, true);
});
