import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { guardedFetch, outboundContext } from '../src/net-guard.ts';
import { localServer } from './outbound-engine-helpers.ts';

const PRIVATE = { policy: { private: ['127.0.0.1'] } };

test('operator transfers retain their finite or infinite timeouts despite an injected script cap', { timeout: 10_000 }, async (t) => {
  const before = process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS;
  t.after(() => { if (before === undefined) delete process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS; else process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS = before; });
  process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS = '250';
  const base = await localServer(t, (req, res) => {
    if (req.url === '/sse') res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.write('start');
    const timer = setTimeout(() => res.end('done'), 1000);
    res.once('close', () => clearTimeout(timer));
  });
  const stop = new AbortController();
  await Promise.all([
    ...[6 * 60 * 60_000, 60 * 60_000, Infinity].map(async (timeoutMs) => {
      const response = await guardedFetch(base, { signal: stop.signal }, { ...PRIVATE, timeoutMs });
      assert.equal(await response.text(), 'startdone');
    }),
    outboundContext.run({ file: 'script', account: 'alice' }, () => assert.rejects(async () => {
      // SSE is exempt from the rate rule, but still obeys the script's total deadline.
      const response = await guardedFetch(base + '/sse', {}, { ...PRIVATE, timeoutMs: Infinity });
      await response.text();
    }, { name: 'TimeoutError' })),
  ]);
  await assert.rejects(async () => {
    const short = await guardedFetch(base, {}, { ...PRIVATE, timeoutMs: 250 });
    await short.text();
  }, { name: 'TimeoutError' });
  const canceled = await guardedFetch(base, { signal: stop.signal }, { ...PRIVATE, timeoutMs: Infinity });
  const reading = canceled.text();
  stop.abort(new Error('operator stopped'));
  await assert.rejects(reading, /operator stopped/);
  await sleep(0); // Request/stream close handlers have removed their signal links.
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
});

test('sparse operator responses and script SSE survive a full transfer-rate window', { timeout: 55_000 }, async (t) => {
  const base = await localServer(t, (req, res) => {
    res.setHeader('content-type', req.url === '/text' ? 'text/plain' : 'Text/Event-Stream; charset=utf-8');
    const event = `data: ${'x'.repeat(52)}\n\n`; // 60 bytes every two seconds.
    res.write(event);
    const drip = setInterval(() => res.write(event), 2000);
    const end = setTimeout(() => res.end('done'), 17_000);
    res.once('close', () => { clearInterval(drip); clearTimeout(end); });
  });
  const read = async (path: string) => {
    const response = await guardedFetch(base + path, {}, { ...PRIVATE, timeoutMs: Infinity });
    const body = await response.text();
    assert.ok(body.startsWith('data: '));
    assert.ok(body.endsWith('done'), 'the sparse stream reached its normal end after the rate window');
  };
  await Promise.all([
    read('/text'), read('/sse'),
    outboundContext.run({ file: 'sse-script', account: 'alice' }, () => read('/sse')),
  ]);
});
