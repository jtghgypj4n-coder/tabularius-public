import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { compressResponse } from '../src/compression.ts';

function response() {
  const emitter = new EventEmitter() as ServerResponse & EventEmitter;
  const callbacks: (() => void)[] = [];
  const chunks: Buffer[] = [];
  let ended = false;
  emitter.statusCode = 200;
  emitter.getHeaders = () => ({ 'content-type': 'text/plain' });
  emitter.removeHeader = () => {};
  emitter.writeHead = function (this: ServerResponse) { return this; } as typeof emitter.writeHead;
  emitter.write = ((chunk: Buffer, callback?: () => void) => {
    chunks.push(Buffer.from(chunk));
    if (callback) callbacks.push(callback);
    return false;
  }) as typeof emitter.write;
  emitter.end = (function () { ended = true; emitter.emit('finish'); return emitter; }) as typeof emitter.end;
  const req = { method: 'GET', headers: { 'accept-encoding': 'gzip' } } as IncomingMessage;
  compressResponse(req, emitter, '/docs');
  return { res: emitter, callbacks, chunks, get ended() { return ended; } };
}

test('AR-server-backup-ops-12: response pressure defers producer completion until drain', async () => {
  const sink = response();
  let completed = false;
  let callbackError: Error | undefined;
  const accepted = sink.res.write(Buffer.alloc(1 << 20, 65), (error?: Error | null) => { completed = true; callbackError = error ?? undefined; });
  assert.equal(accepted, false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  sink.res.emit('close');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, true);
  assert.match(callbackError?.message ?? '', /response closed|destroy/i);
  assert.equal(sink.ended, false);
});

test('AR-server-backup-ops-12: close releases writes still waiting on compression', () => {
  const sink = response();
  const errors: (Error | undefined)[] = [];
  const onWrite = (error?: Error | null) => { errors.push(error ?? undefined); };
  sink.res.write(Buffer.alloc(1 << 20, 65), onWrite);
  sink.res.write(Buffer.alloc(1 << 20, 66), onWrite);
  sink.res.emit('close');
  assert.equal(errors.length, 2);
  for (const error of errors) assert.match(error?.message ?? '', /response closed|destroy/i);
  assert.equal(sink.ended, false);
});

test('AR-server-backup-ops-12: draining a paused response completes once with intact output', async () => {
  const sink = response();
  const source = Buffer.alloc(1 << 20, 65);
  let completed = 0;
  sink.res.write(source, () => { completed++; });
  sink.res.end();
  for (let i = 0; i < 100 && (!sink.ended || completed === 0); i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    for (const cb of sink.callbacks.splice(0)) cb();
    sink.res.emit('drain');
  }
  assert.equal(sink.ended, true);
  assert.equal(completed, 1);
  assert.deepEqual(gunzipSync(Buffer.concat(sink.chunks)), source);
});

test('AR-server-backup-ops-12: a paused client bounds accepted input in a watchdog process', () => {
  const moduleUrl = pathToFileURL(join(import.meta.dirname, '..', 'src', 'compression.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    import { EventEmitter } from 'node:events';
    const { compressResponse } = await import(process.argv[1]);
    const res = new EventEmitter();
    res.statusCode = 200;
    res.getHeaders = () => ({ 'content-type': 'text/plain' });
    res.removeHeader = () => {};
    res.writeHead = function() { return this; };
    res.write = () => false;
    res.end = function() { return this; };
    compressResponse({ method: 'GET', headers: { 'accept-encoding': 'gzip' } }, res, '/docs');
    const before = process.memoryUsage().rss;
    const chunk = Buffer.alloc(64 * 1024, 65);
    let accepted = 0;
    while (accepted < 64 * 1024 * 1024) {
      accepted += chunk.length;
      if (!res.write(chunk)) break;
    }
    assert.ok(accepted <= 2 * 1024 * 1024, 'paused client accepted unbounded input');
    assert.ok(process.memoryUsage().rss - before < 64 * 1024 * 1024, 'paused client retained too much memory');
    res.emit('close');
  `;
  const result = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script, moduleUrl], {
    encoding: 'utf8', timeout: 12_000,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});
