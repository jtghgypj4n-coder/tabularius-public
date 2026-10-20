import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetries } from '../src/assistant.ts';

const reply = (status: number, headers: Record<string, string> = {}) => new Response('{}', { status, headers });

test('model calls: tried again when the provider is overloaded or rate limited', async () => {
  const waits: number[] = [];
  const answers = [reply(529), reply(429, { 'retry-after': '3' }), reply(200)];
  const res = await withRetries(async () => answers.shift()!, undefined, async (ms) => void waits.push(ms));
  assert.equal(res.status, 200);
  assert.deepEqual(waits, [1000, 3000]);
});

test('model calls: give up after two retries, and never retry a bad request', async () => {
  let calls = 0;
  const busy = await withRetries(async () => (calls++, reply(503)), undefined, async () => {});
  assert.equal(busy.status, 503);
  assert.equal(calls, 3);
  calls = 0;
  const bad = await withRetries(async () => (calls++, reply(400)), undefined, async () => {});
  assert.equal(bad.status, 400);
  assert.equal(calls, 1);
});

test('model calls: a network error is tried again, a stopped question is not', async () => {
  let calls = 0;
  const res = await withRetries(async () => {
    if (calls++ === 0) throw new TypeError('fetch failed');
    return reply(200);
  }, undefined, async () => {});
  assert.equal(res.status, 200);
  const stop = new AbortController();
  calls = 0;
  await assert.rejects(withRetries(async () => {
    calls++;
    stop.abort();
    throw new DOMException('aborted', 'AbortError');
  }, stop.signal, async () => {}));
  assert.equal(calls, 1);
  // Stopped while waiting to try again.
  const later = new AbortController();
  calls = 0;
  await assert.rejects(withRetries(async () => (calls++, reply(529)), later.signal, async () => later.abort()));
  assert.equal(calls, 1);
});
