// Generated traffic only. No child processes, external hosts or fixture files.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getEventListeners } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { guardedFetch, outboundContext, outboundDeadline } from '../src/net-guard.ts';

const PRIVATE = { policy: { private: ['127.0.0.1'] } };

async function until(predicate: () => boolean): Promise<void> {
  const end = performance.now() + 3000;
  while (!predicate()) {
    assert.ok(performance.now() < end, 'local request made progress within 3 seconds');
    await sleep(5);
  }
}

async function fixture(t: TestContext) {
  const seen = new Map<string, ServerResponse>();
  const stop = new AbortController();
  const pending: Promise<unknown>[] = [];
  const server = createServer((req, res) => {
    seen.set(req.url!, res);
    if (req.url!.startsWith('/fast')) res.end('ok');
    else if (req.url === '/oversize') { res.writeHead(200, { 'content-length': 999 }); res.end('large'); }
    else if (req.url === '/redirect') { res.writeHead(302, { location: '/fast-redirect' }); res.write('hold'); }
    else if (req.url!.startsWith('/steady')) {
      res.write('steady');
      const timer = setInterval(() => res.write(Buffer.alloc(2048)), 500);
      res.once('close', () => clearInterval(timer));
    } else if (req.url === '/drip') {
      res.write('x');
      const timer = setInterval(() => res.write('x'), 50);
      res.once('close', () => clearInterval(timer));
    } else res.write('held');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    stop.abort();
    server.closeAllConnections();
    await Promise.allSettled(pending);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  });
  const request = (file: string, account: string, path: string, signal?: AbortSignal) => {
    const result = outboundContext.run({ file, account, stop: stop.signal }, async () =>
      (await guardedFetch(base + path, { signal }, PRIVATE)).text());
    result.catch(() => {});
    pending.push(result);
    return result;
  };
  return { seen, stop, base, request };
}

test('eight active sockets in one file cannot starve another file', { timeout: 10_000 }, async (t) => {
  const { seen, request } = await fixture(t);
  for (let i = 0; i < 16; i++) void request('busy-file', `account-${i % 4}`, `/held-${i}`);
  await until(() => seen.size === 8);
  assert.equal(await request('other-file', 'account-0', '/fast-other-file'), 'ok');
  assert.equal([...seen.keys()].filter((p) => p.startsWith('/held')).length, 8);
});

test('four active sockets in one account cannot starve another account in the same file', { timeout: 10_000 }, async (t) => {
  const { seen, request } = await fixture(t);
  for (let i = 0; i < 12; i++) void request('same-file', i % 2 ? 'ALICE' : 'alice', `/held-${i}`);
  await until(() => seen.size === 4);
  assert.equal(await request('same-file', 'bob', '/fast-bob'), 'ok');
  assert.equal([...seen.keys()].filter((p) => p.startsWith('/held')).length, 4, 'account identity ignores case');
});

test('queued accounts rotate while each account retains FIFO ordering', { timeout: 10_000 }, async (t) => {
  const { seen, request } = await fixture(t);
  for (let i = 0; i < 8; i++) void request('round-robin', i < 4 ? 'a' : 'b', `/held-${i}`);
  await until(() => seen.size === 8);
  for (const account of ['c', 'd']) for (let i = 0; i < 3; i++) void request('round-robin', account, `/queued-${account}-${i}`);
  for (let i = 0; i < 4; i++) {
    seen.get(`/held-${i}`)!.end();
    await until(() => seen.size === 9 + i);
  }
  assert.deepEqual([...seen.keys()].slice(8), ['/queued-c-0', '/queued-d-0', '/queued-c-1', '/queued-d-1']);
});

test('cancelled waiters leave no slots or listeners, including cancellation just after admission', { timeout: 10_000 }, async (t) => {
  const { seen, request, base } = await fixture(t);
  for (let i = 0; i < 8; i++) void request('cancel-file', i < 4 ? 'a' : 'b', `/held-${i}`);
  await until(() => seen.size === 8);
  const canceled = new AbortController();
  const waiters = Array.from({ length: 8 }, (_, i) => request('cancel-file', 'c', `/cancelled-${i}`, canceled.signal));
  canceled.abort(new Error('cancel waiting'));
  for (const waiter of waiters) await assert.rejects(waiter, /cancel waiting/);
  assert.equal(getEventListeners(canceled.signal, 'abort').length, 0);
  for (const response of seen.values()) response.end();
  const later = Array.from({ length: 8 }, (_, i) => request('cancel-file', i < 4 ? 'a' : 'b', `/next-${i}`));
  await until(() => seen.size === 16);
  assert.equal([...seen.keys()].some((p) => p.startsWith('/cancelled')), false);
  for (const response of seen.values()) response.end();
  await Promise.all(later);

  // reserveOutbound resolves synchronously, but guardedFetch resumes in a microtask.
  for (let i = 0; i < 12; i++) {
    const stop = new AbortController();
    const raced = outboundContext.run({ file: 'cancel-file', account: 'a' }, () => guardedFetch(base + '/never-open', { signal: stop.signal }, PRIVATE));
    stop.abort(new Error('admission race'));
    await assert.rejects(raced, /admission race/);
    assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  }
  assert.equal(seen.has('/never-open'), false);
  assert.equal(await request('cancel-file', 'a', '/fast-after-races'), 'ok');
});

test('unread cancellation, redirects, refused bodies and failed connects release admission', { timeout: 10_000 }, async (t) => {
  const { base, request } = await fixture(t);
  await outboundContext.run({ file: 'release-file', account: 'a' }, async () => {
    for (let i = 0; i < 12; i++) {
      const response = await guardedFetch(base + `/unread-${i}`, {}, PRIVATE);
      await response.body!.cancel();
      assert.equal(await (await guardedFetch(base + '/redirect', {}, PRIVATE)).text(), 'ok');
      await assert.rejects(guardedFetch(base + '/oversize', {}, { ...PRIVATE, maxBytes: 8 }), /larger/);
      await assert.rejects(guardedFetch('http://127.0.0.1:0/', {}, PRIVATE), /fetch failed/);
    }
  });
  assert.equal(await request('release-file', 'a', '/fast-after-errors'), 'ok');
});

test('a trickling response is cut by the transfer-rate rule and frees its slot', { timeout: 50_000 }, async (t) => {
  const { request, seen } = await fixture(t);
  for (let i = 0; i < 3; i++) void request('rate-file', 'a', `/steady-${i}`);
  const started = performance.now();
  const drip = request('rate-file', 'a', '/drip');
  await until(() => seen.size === 4);
  const waiting = request('rate-file', 'a', '/fast-after-drip');
  await assert.rejects(drip, /transfer rate.*1024/);
  assert.ok(performance.now() - started < 45_000, '15-second window has threefold timing headroom');
  assert.equal(await waiting, 'ok');
});

test('configured script time cap applies to bodies and waiters even with Infinity; edits affect new requests', { timeout: 10_000 }, async (t) => {
  const { base, request, seen } = await fixture(t);
  for (let i = 0; i < 4; i++) void request('deadline-file', 'a', `/held-${i}`);
  await until(() => seen.size === 4);
  const before = process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS;
  t.after(() => { if (before === undefined) delete process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS; else process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS = before; });
  process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS = '100';
  await outboundContext.run({ file: 'deadline-file', account: 'a' }, async () => {
    await assert.rejects(guardedFetch(base + '/never-admitted', {}, { ...PRIVATE, timeoutMs: Infinity }), { name: 'TimeoutError' });
  });
  assert.equal(seen.has('/never-admitted'), false);
  await outboundContext.run({ file: 'deadline-body', account: 'a' }, async () => {
    const response = await guardedFetch(base + '/silent-body', {}, { ...PRIVATE, timeoutMs: Infinity });
    await assert.rejects(response.text(), { name: 'TimeoutError' });
  });
  process.env.TABULARIUS_OUTBOUND_MAX_TIME_MS = '2000';
  const changed = outboundContext.run({ file: 'deadline-body', account: 'a' }, () => outboundDeadline([]));
  try {
    await sleep(300);
    assert.equal(changed.signal.aborted, false, 'new deadline uses the edited cap');
  } finally { changed.dispose(); }
});
