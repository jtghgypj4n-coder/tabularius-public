import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { guardedFetch } from '../src/net-guard.ts';

const server = createServer((_req, res) => res.end('delivered'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const options = { policy: { private: ['127.0.0.1'] } };
try {
  const signal = AbortSignal.timeout(1500);
  const response = await guardedFetch(url, { signal }, options);
  assert.equal(response.status, 200);
  // Keep the body unread, including after its caller's signal fires. No uncaughtException handler:
  // a late, unhandled PassThrough error must fail this child, just as it would the server.
  await sleep(1700);
  assert.equal(response.bodyUsed, false);
  assert.equal(signal.aborted, true);
  assert.equal(getEventListeners(signal, 'abort').length, 0);
  assert.equal(await (await guardedFetch(url, {}, options)).text(), 'delivered');
  console.log('survived unread response timeout and completed another request');
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
