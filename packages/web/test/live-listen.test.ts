import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listen, type Change } from '../src/live.ts';
import type { Api } from '../src/api.ts';

test('web-b-56: a throwing handler does not reconnect or leak its live stream', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let opened = 0;
  let cancelled = 0;
  let handled = 0;
  let stop = () => {};
  let done = () => {};
  const seen = new Promise<void>((resolve) => { done = resolve; });
  const timeout = setTimeout(done, 4000);
  globalThis.fetch = (async () => {
    opened++;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (opened === 1) controller.enqueue(new TextEncoder().encode([
          'event: change\ndata: {"kind":"update"}\n\n',
          'event: change\ndata: {bad json}\n\n',
          'event: message\ndata: {"text":"notice"}\n\n',
          'event: change\ndata: {"kind":"update"}\n\n',
        ].join('')));
      },
      cancel() { cancelled++; },
    });
    return new Response(body);
  }) as typeof fetch;
  console.warn = () => {};
  try {
    stop = listen({ db: 'D', token: 't' } as Api, (_change: Change) => {
      handled++;
      if (handled === 1) throw new Error('handler failure');
      stop();
      done();
    }, () => {}, () => { throw new Error('message handler failure'); });
    await seen;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(handled, 2, 'events after a failing handler and malformed JSON are delivered');
    assert.equal(opened, 1, 'a handler error is not a dropped connection');
    assert.equal(cancelled, opened, 'the stopped stream is cancelled');
  } finally {
    clearTimeout(timeout);
    stop();
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('web-b-56: an expired event cancels its stream', async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = 0;
  let expired = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('event: expired\n\n')); },
    cancel() { cancelled++; },
  });
  globalThis.fetch = (async () => new Response(body)) as typeof fetch;
  const stop = listen({ db: 'D', token: 't' } as Api, () => {}, () => { expired++; });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(expired, 1);
    assert.equal(cancelled, 1);
  } finally {
    stop();
    globalThis.fetch = originalFetch;
  }
});
