import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { Admin } from '../src/admin.ts';
import { DataApi } from '../src/dataapi.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import type { CompactionReport } from '../src/compaction.ts';

const report: CompactionReport = { beforeBytes: 100, afterBytes: 80, walBeforeBytes: 20, walAfterBytes: 0, durationMs: 2, writerWaitMs: 0, convertedToIncremental: true, freePagesBefore: 4, freePagesAfter: 0 };

function folder(t: import('node:test').TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-host-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  createStore(join(dir, 'A.openhbam.sqlite'));
  return dir;
}

function gated() {
  let release!: (r: CompactionReport) => void;
  const gate = new Promise<CompactionReport>((resolve) => { release = resolve; });
  return { gate, release };
}

test('one job per file; close waits and blocks a new pass', async (t) => {
  const dir = folder(t);
  const hold = gated();
  let calls = 0;
  const host = new Host(dir, () => {}, { compactionWorker: () => { calls++; return hold.gate; } });
  t.after(() => host.close());
  const first = host.compact('A');
  assert.equal(host.compact('a'), first);
  assert.equal(calls, 1);
  let closed = false;
  const closing = host.closeFileEverywhere('A').then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(host.compact('A'), first);
  hold.release(report);
  await closing;
  assert.equal(closed, true);
  assert.equal(host.get('A'), undefined);
  assert.equal(host.compactionReports.size, 0);
  assert.equal(host.compactionLast.size, 0);
  assert.equal(host.openFile('A'), true);
  assert.deepEqual(await host.compact('A'), report);
});

test('pause and host shutdown wait for a running pass', async (t) => {
  const dir = folder(t);
  const first = gated();
  const second = gated();
  let calls = 0;
  const host = new Host(dir, () => {}, { compactionWorker: () => ++calls === 1 ? first.gate : second.gate });
  const job = host.compact('A');
  let paused = false;
  const pause = host.pauseFileEverywhere('A').then(() => { paused = true; });
  await Promise.resolve();
  assert.equal(paused, false);
  assert.equal(host.compact('A'), job);
  first.release(report);
  await job;
  await pause;
  assert.equal(host.get('A'), undefined);
  assert.equal(host.compactionReports.size, 0);
  await assert.rejects(host.compact('A'), /closing|paused/);
  assert.equal(host.openFile('A'), true);
  const next = host.compact('A');
  let stopped = false;
  const close = host.close().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  await assert.rejects(host.compact('A'), /closing/);
  second.release(report);
  await next;
  await close;
  assert.equal(stopped, true);
});

test('tick starts due jobs, logs failure and leaves later passes possible', async (t) => {
  const dir = folder(t);
  const messages: string[] = [];
  let calls = 0;
  const converts: (boolean | undefined)[] = [];
  const host = new Host(dir, (m) => messages.push(m), { compactionWorker: async (_path, convert) => { calls++; converts.push(convert); throw new Error('synthetic refusal'); } });
  t.after(() => host.close());
  host.compactionTick(100);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(converts, [false], 'the timer never rewrites a file, only an administrator asking does');
  assert.match(messages[0], /A: compaction failed: synthetic refusal/);
  host.compactionTick(101);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  host.compactionTick(100 + 86_400_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
});

test('a follower process cannot start scheduled or manual compaction', async (t) => {
  const dir = folder(t);
  let calls = 0;
  const host = new Host(dir, () => {}, { follower: true, compactionWorker: async () => { calls++; return report; } });
  t.after(() => host.close());
  host.compactionTick(100);
  await assert.rejects(host.compact('A'), /follower process/);
  assert.equal(calls, 0);
});

test('a read-only file refuses before a worker starts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-readonly-'));
  const path = join(dir, 'A.openhbam.sqlite');
  createStore(path);
  let calls = 0;
  const host = new Host(dir, () => {}, { compactionWorker: async () => { calls++; return report; } });
  t.after(async () => { chmodSync(path, 0o600); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  chmodSync(path, 0o400);
  await assert.rejects(host.compact('A'), /read-only file or mount/);
  assert.equal(calls, 0);
});

test('admin compact route returns report, refusal, unhosted and method rejection', async (t) => {
  const dir = folder(t);
  const host = new Host(dir);
  t.after(() => host.close());
  const admin = new Admin(host, new DataApi(host));
  async function call(method: string, path: string): Promise<{ status: number; body: any }> {
    const req = { method, headers: { host: 'localhost', 'x-tabularius-admin': '1' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
    let status = 0;
    let body: any;
    const emitter = new EventEmitter();
    const res = Object.assign(emitter, {
      destroyed: false, writableFinished: false,
      writeHead(code: number) { status = code; return this; },
      end(value: string) { body = JSON.parse(value); this.writableFinished = true; emitter.emit('finish'); return this; },
    }) as unknown as ServerResponse;
    await admin.handle(req, res, new URL(path, 'http://localhost'));
    return { status, body };
  }
  const route = '/tabularius/admin/v1/optimization/A/compact';
  const ok = await call('POST', route);
  assert.equal(ok.status, 200);
  const body = ok.body;
  assert.equal(body.report.walAfterBytes, 0);
  const reportResponse = await call('GET', '/tabularius/admin/v1/optimization/A');
  assert.equal(reportResponse.body.compaction.report.walAfterBytes, 0);
  assert.equal((await call('GET', route)).status, 405);
  assert.equal((await call('POST', '/tabularius/admin/v1/optimization/Missing/compact')).status, 404);
  const mock = t.mock.method(host, 'compact', () => Promise.reject(new Error('space could not be read')));
  const refused = await call('POST', route);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /space could not be read/);
  mock.mock.restore();
});
