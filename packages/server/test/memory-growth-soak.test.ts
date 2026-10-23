// Run with node --expose-gc --test --test-concurrency=2. No fixture or external service is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { serve } from '../src/index.ts';

class Reply extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  writableFinished = false;
  destroyed = false;
  body = '';
  shouldKeepAlive = true;
  headers: Record<string, unknown> = {};
  setHeader(key: string, value: unknown) { this.headers[key] = value; return this; }
  getHeader(key: string) { return this.headers[key]; }
  removeHeader(key: string) { delete this.headers[key]; }
  writeHead(status: number, headers: Record<string, unknown> = {}) { this.statusCode = status; this.headersSent = true; Object.assign(this.headers, headers); return this; }
  end(body = '') { this.body = body; this.writableEnded = this.writableFinished = true; this.emit('finish'); this.emit('close'); return this; }
}

test('20,000 sign-ins stay below 64 MiB heap and 24 MiB growth after GC in under 40 seconds', { skip: !global.gc && 'run with --expose-gc', timeout: 40_000 }, async (t) => {
  const started = performance.now();
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-memory-soak-'));
  // Exercise the aggregate ceiling independently of the optional per-account ceiling.
  const perAccount = process.env.TABULARIUS_MAX_SESSIONS_PER_ACCOUNT;
  process.env.TABULARIUS_MAX_SESSIONS_PER_ACCOUNT = '0';
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const store = s.host.create('Growth');
    // Substitute only authentication/identity lookup: 20k scrypt operations would be a CPU benchmark.
    // Routing, sessions, eviction, logs, metrics, hook rate tables and cleanup stay real.
    // Durable sign-in audit appends are covered separately; forcing 20k SQLite commits is not a heap soak.
    const p = store.privileges('Admin');
    store.verifyAsync = async (_name, password) => password === 'soak';
    store.privileges = () => p;
    store.accountInactive = () => false;
    store.identityAllowed = () => true;
    store.signInLocationAllowed = () => true;
    store.auditSignIn = () => {};
    store.requireTotpForFullAccess = () => false;
    store.accountRequires2fa = () => false;
    store.hasTotp = () => false;
    store.mustChangePassword = () => false;
    const handler = s.server.listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => Promise<void>;
    let requests = 0;
    const call = async (method: string, url: string, address: string, extra: Record<string, string> = {}, body = '') => {
      // HTTP/1.1 requires exactly one Host header; the edge refuses a request without one.
      const headers = { host: 'localhost', ...extra };
      const input = Readable.from(body ? [Buffer.from(body)] : []);
      const socket = Object.assign(new EventEmitter(), {
        remoteAddress: address, bytesRead: body.length, bytesWritten: 0, destroyed: false,
        pause() {}, destroy() { this.destroyed = true; (this as typeof this & EventEmitter).emit('close'); },
      });
      const req = Object.assign(input, { method, url, headers, rawHeaders: Object.entries(headers).flat(), httpVersion: '1.1', complete: true, socket });
      const res = new Reply();
      await new Promise<void>((resolve) => {
        res.once('finish', resolve);
        void handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
      });
      requests++;
      assert.ok(res.writableFinished, `${method} ${url} did not finish`);
      return res;
    };
    const login = async (i: number) => {
      const r = await call('POST', '/fmi/data/vLatest/databases/Growth/sessions', `198.18.${i >> 8}.${i & 255}`, { authorization: 'Basic ' + btoa(`account-${i}:soak`), 'content-type': 'application/json' }, '{}');
      assert.equal(r.statusCode, 200, r.body);
      return JSON.parse(r.body).response.token as string;
    };
    for (let i = 0; i < 1024; i++) await login(30_000 + i);
    await s.host.logs?.flush();
    await new Promise<void>((ok) => setImmediate(ok));
    global.gc!();
    const before = process.memoryUsage().heapUsed;
    let first = '';
    let latest = '';
    for (let i = 0; i < 20_000; i++) {
      t.signal.throwIfAborted();
      latest = await login(i);
      if (!i) first = latest;
      // Unknown hook requests exercise a distinct unauthenticated address table.
      if (i % 10 === 0) {
        const r = await call('POST', '/tabularius/hooks/v1/missing', `198.19.${i >> 8}.${i & 255}`, {}, '{}');
        assert.ok(r.statusCode === 404 || r.statusCode === 429);
      }
      // Some clients sign out; others disappear and must be evicted without a timeout sweep.
      if (i % 20 === 1) {
        const r = await call('DELETE', `/fmi/data/vLatest/databases/Growth/sessions/${latest}`, '192.0.2.1', { authorization: `Bearer ${latest}` });
        assert.equal(r.statusCode, 200, r.body);
      }
      if (i % 1000 === 999) {
        await new Promise<void>((ok) => setImmediate(ok));
        if (i % 5000 === 4999) t.diagnostic(`${i + 1} sign-ins in ${Math.round(performance.now() - started)} ms`);
      }
    }
    const old = await call('GET', '/fmi/data/vLatest/validateSession', '192.0.2.1', { authorization: `Bearer ${first}` });
    assert.equal(old.statusCode, 401, 'the abandoned oldest session was evicted');
    const last = await call('GET', '/fmi/data/vLatest/validateSession', '192.0.2.1', { authorization: `Bearer ${latest}` });
    assert.equal(last.statusCode, 200, 'a recent admitted session remains usable');
    const metrics = await call('GET', '/tabularius/admin/v1/metrics', '127.0.0.1');
    assert.equal(metrics.statusCode, 200);
    const held = Number(/^tabularius_sessions_held (\d+)/m.exec(metrics.body)?.[1]);
    assert.ok(held <= 2048, `${held} retained sessions`);
    await s.host.logs?.flush();
    await new Promise<void>((ok) => setImmediate(ok));
    global.gc!();
    const after = process.memoryUsage().heapUsed;
    const growth = after - before;
    assert.ok(after <= 64 * 1024 * 1024, `${after} bytes of heap after GC (absolute budget 64 MiB)`);
    assert.ok(growth <= 24 * 1024 * 1024, `${growth} bytes retained after GC (budget 24 MiB)`);
    s.host.closeFile('Growth');
    const closed = await call('GET', '/tabularius/admin/v1/metrics', '127.0.0.1');
    assert.match(closed.body, /^tabularius_sessions_held 0$/m);
    t.diagnostic(JSON.stringify({ signIns: 20_000, warmupSignIns: 1024, requests, held, beforeHeapBytes: before, afterHeapBytes: after, retainedBytes: growth, budgetBytes: 24 * 1024 * 1024, heapBudgetBytes: 64 * 1024 * 1024, elapsedMs: Math.round(performance.now() - started) }));
  } finally {
    if (perAccount === undefined) delete process.env.TABULARIUS_MAX_SESSIONS_PER_ACCOUNT; else process.env.TABULARIUS_MAX_SESSIONS_PER_ACCOUNT = perAccount;
    await new Promise<void>((ok) => s.server.close(() => ok()));
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(performance.now() - started < 40_000, 'the complete soak, including cleanup, must finish within 40 seconds');
});
