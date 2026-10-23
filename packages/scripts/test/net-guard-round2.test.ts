// Generated requests and resolver answers; every actual connection is loopback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { getEventListeners } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { guardedFetch, NAME_LOOKUP, outboundContext } from '../src/net-guard.ts';
import { listen } from '../../server/test/edge-test-helpers.ts';

const LOCAL = { policy: { private: true }, timeoutMs: 3000 };

const framingCases: Record<string, string>[] = [
  { 'content-length': '1' },
  { 'transfer-encoding': 'chunked', 'content-length': '999' },
  { connection: 'keep-alive, x-private', 'x-private': 'secret', host: 'other.invalid', 'proxy-authorization': 'secret' },
];
for (const supplied of framingCases) test(`the guard owns outbound framing and authority: ${Object.keys(supplied).join(', ')}`, async t => {
  const body = 'é🙂';
  let wire = Buffer.alloc(0);
  const server = tcpServer(socket => {
    let answered = false;
    socket.on('data', chunk => {
      wire = Buffer.concat([wire, chunk]);
      const end = wire.indexOf('\r\n\r\n');
      if (!answered && end >= 0 && wire.length >= end + 4 + Buffer.byteLength(body)) {
        answered = true;
        socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok');
      }
    });
  });
  // The helper only needs Server's listen/close/connection methods.
  const port = await listen(t, server as unknown as ReturnType<typeof createServer>);
  const res = await guardedFetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: supplied, body }, LOCAL);
  assert.equal(await res.text(), 'ok');
  const headers = wire.subarray(0, wire.indexOf('\r\n\r\n')).toString();
  assert.match(headers, new RegExp(`content-length: ${Buffer.byteLength(body)}\\r?$`, 'im'));
  assert.match(headers, new RegExp(`host: 127\\.0\\.0\\.1:${port}\\r?$`, 'im'));
  assert.doesNotMatch(headers, /transfer-encoding:|x-private:|proxy-authorization:|keep-alive/i);
  assert.equal(wire.subarray(wire.indexOf('\r\n\r\n') + 4).toString(), body);
});

test('same-origin Unicode redirects re-resolve and refuse a changed DNS answer', async t => {
  let hits = 0, lookups = 0;
  const port = await listen(t, createServer((_req, res) => {
    hits++;
    res.writeHead(307, { location: '/%E2%98%83?round=2' }).end();
  }));
  t.mock.method(NAME_LOOKUP, 'lookup', async (host: string) => {
    assert.equal(host, 'xn--bcher-kva.invalid');
    return [{ address: ++lookups === 1 ? '127.0.0.1' : '169.254.169.254', family: 4 }];
  });
  await assert.rejects(guardedFetch(`http://bücher.invalid:${port}/`, {}, LOCAL), /link-local/);
  assert.equal(lookups, 2);
  assert.equal(hits, 1);
});

test('completed requests do not reuse a checked socket after DNS changes', async t => {
  let hits = 0, lookups = 0;
  const port = await listen(t, createServer((_req, res) => { hits++; res.end('ok'); }));
  t.mock.method(NAME_LOOKUP, 'lookup', async () => [{ address: ++lookups === 1 ? '127.0.0.1' : '169.254.170.2', family: 4 }]);
  const url = `http://changing.invalid:${port}/`;
  assert.equal(await (await guardedFetch(url, {}, LOCAL)).text(), 'ok');
  await assert.rejects(guardedFetch(url, {}, LOCAL), /link-local/);
  assert.equal(lookups, 2);
  assert.equal(hits, 1);
});

test('Unicode account case variants share admission; cancellation and pool reuse restore capacity', { timeout: 15000 }, async t => {
  let hits = 0;
  const port = await listen(t, createServer((_req, res) => { hits++; res.write('held'); }));
  for (let round = 0; round < 2; round++) {
    hits = 0;
    const stop = new AbortController();
    t.after(() => stop.abort());
    const jobs = Array.from({ length: 9 }, (_, i) => outboundContext.run({ file: 'round2', account: i % 2 ? 'ÄLICE' : 'älice', stop: stop.signal }, async () => {
      const res = await guardedFetch(`http://127.0.0.1:${port}/${i}`, {}, { ...LOCAL, timeoutMs: 10000 });
      return res.text();
    }));
    const settled = Promise.allSettled(jobs);
    const until = performance.now() + 3000;
    while (hits < 4 && performance.now() < until) await sleep(5);
    assert.equal(hits, 4);
    // A distinct account is admitted while the case variants are blocked.
    const other = await outboundContext.run({ file: 'round2', account: 'other' }, () => guardedFetch(`http://127.0.0.1:${port}/other`, {}, LOCAL));
    assert.equal(hits, 5);
    await other.body!.cancel();
    stop.abort(new Error('restart'));
    assert.ok((await settled).every(r => r.status === 'rejected'));
    assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  }
});
