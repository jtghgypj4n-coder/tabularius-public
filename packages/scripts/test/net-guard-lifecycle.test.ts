import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { guardedFetch, outboundContext, outboundDeadline } from '../src/net-guard.ts';

const PRIVATE = { policy: { private: ['127.0.0.1'] } };

async function localServer(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('an unread response survives a late caller timeout in a child process', { timeout: 15_000 }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-unread-path-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const marker = join(dir, 'attempted-command');
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, name), '#!/bin/sh\nprintf "%s\\n" "$0" >> "$OUTBOUND_STUB_MARKER"\nexit 99\n', { mode: 0o755 });
  }
  const child = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(new URL('./net-guard-unread-child.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, OUTBOUND_STUB_MARKER: marker },
  });
  assert.equal(existsSync(marker), false, 'the child did not invoke any guarded command');
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, `child exited ${child.status}: ${child.stderr}`);
  assert.match(child.stdout, /survived unread response timeout and completed another request/);
});

test('a deadline unlinks every source on abort, including an already aborted source', async () => {
  for (const mode of ['caller', 'deadline', 'already aborted'] as const) {
    const caller = new AbortController();
    const stop = new AbortController();
    if (mode === 'already aborted') caller.abort(new Error('already stopped'));
    const lifetime = outboundDeadline([caller.signal, stop.signal], mode === 'deadline' ? 50 : Infinity);
    try {
      if (mode === 'caller') caller.abort(new Error('stopped'));
      if (mode === 'deadline') await sleep(150);
      assert.equal(lifetime.signal.aborted, true);
      assert.equal(getEventListeners(caller.signal, 'abort').length, 0, mode);
      assert.equal(getEventListeners(stop.signal, 'abort').length, 0, mode);
    } finally { lifetime.dispose(); }
  }
});

test('consuming or cancelling a response releases caller and run signals without waiting for a deadline', { timeout: 10_000 }, async (t) => {
  const base = await localServer(t, (req, res) => {
    if (req.url === '/held') res.write('held');
    else res.end('ok');
  });
  for (const mode of ['consume', 'cancel unread', 'cancel reader'] as const) {
    const caller = new AbortController();
    const stop = new AbortController();
    const response = await outboundContext.run({ file: 'lifecycle', account: 'reader', stop: stop.signal }, () =>
      guardedFetch(base + (mode === 'consume' ? '/' : '/held'), { signal: caller.signal }, { ...PRIVATE, timeoutMs: Infinity }));
    if (mode === 'consume') assert.equal(await response.text(), 'ok');
    else if (mode === 'cancel unread') await response.body!.cancel();
    else {
      const reader = response.body!.getReader();
      assert.equal((await reader.read()).done, false);
      await reader.cancel();
    }
    await sleep(0); // Stream close resolves the lifetime's settlement promise.
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0, mode);
    assert.equal(getEventListeners(stop.signal, 'abort').length, 0, mode);
    caller.abort(new Error('after disposal'));
    stop.abort(new Error('after disposal'));
  }
});

test('unread and discarded bodies expire, unlink long-lived signals and free all account slots', { timeout: 10_000 }, async (t) => {
  let hits = 0;
  const base = await localServer(t, (_req, res) => { hits++; res.end('ok'); });
  const caller = new AbortController();
  const stop = new AbortController();
  t.after(() => { caller.abort(); stop.abort(); });
  await outboundContext.run({ file: 'unread-lifecycle', account: 'reader', stop: stop.signal }, async () => {
    // Drop all four Responses: the source signal must not retain them beyond their request lifetime.
    for (let i = 0; i < 4; i++) await guardedFetch(base, { signal: caller.signal }, { ...PRIVATE, timeoutMs: 1000 });
    assert.equal(hits, 4);
    const next = await guardedFetch(base, { signal: caller.signal }, { ...PRIVATE, timeoutMs: 5000 });
    assert.equal(await next.text(), 'ok', 'expired unread bodies release admission for the next request');
  });
  // The first expiry admits the fifth request; the other three deadlines can be a few ticks later.
  const end = performance.now() + 3000;
  while (getEventListeners(caller.signal, 'abort').length || getEventListeners(stop.signal, 'abort').length) {
    assert.ok(performance.now() < end, 'all unread bodies released their source links within three deadline intervals');
    await sleep(5);
  }
  assert.equal(hits, 5);
  assert.equal(caller.signal.aborted, false);
  assert.equal(stop.signal.aborted, false);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
});

test('an abort still reaches both an active reader and a reader attached after destruction', { timeout: 10_000 }, async (t) => {
  const base = await localServer(t, (req, res) => {
    if (req.url === '/held') res.write('held');
    else res.end('buffered');
  });
  for (const mode of ['active', 'late'] as const) {
    const caller = new AbortController();
    const response = await guardedFetch(base + (mode === 'active' ? '/held' : '/'), { signal: caller.signal }, PRIVATE);
    const reading = mode === 'active' ? response.text() : undefined;
    await sleep(50); // Let the buffered response's pipeline finish before destroying its unread PassThrough.
    const reason = new Error(`${mode} reader aborted`);
    caller.abort(reason);
    if (!reading) await sleep(0); // No reader exists when the Node stream emits its error.
    await assert.rejects(reading ?? response.text(), (error) => error === reason);
    await sleep(0);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  }
});
