import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { createStore } from '../../store/src/index.ts';
import { withFilesystemHook } from '../../store/src/fs-boundary.ts';
import { backupFolder } from '../src/backup.ts';
import { Host } from '../src/host.ts';
import { Uploads } from '../src/uploads.ts';
import { ContainerFiles } from '../src/containers.ts';
import { ContainerUploads, ContainerUploadError } from '../src/container-uploads.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cleanup-order-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const warnings = t.mock.method(console, 'warn', () => {});
  const work = new Error('original work failed');
  const cleanup = Object.assign(new Error('cleanup denied'), { code: 'EACCES' });
  return { dir, warnings, work, cleanup };
}

test('backup preserves its work error when partial cleanup fails', async (t) => {
  const s = setup(t), live = join(s.dir, 'live');
  mkdirSync(live);
  createStore(join(live, 'Generated.openhbam.sqlite'));
  await assert.rejects(withFilesystemHook((event) => {
    if (event.operation === 'native') throw s.work;
    if (event.operation === 'remove') throw s.cleanup;
  }, () => backupFolder(live, join(s.dir, 'backups'))), (error) => error === s.work);
  assert.equal(s.warnings.mock.calls.length, 1);
});

test('upload conversion records the work error even when partial cleanup fails', async (t) => {
  const s = setup(t), host = new Host(s.dir);
  t.after(() => host.close());
  t.mock.method(host, 'hostUpload', async () => { throw s.work; });
  const logs: string[] = [];
  const uploads = new Uploads(host, (line) => logs.push(line), { idleMs: 0 });
  const u = uploads.start({ name: 'Generated.fmp12', size: 1 });
  await uploads.write(u.id, 0, Object.assign(Readable.from([Buffer.alloc(1)]), { headers: {} }) as unknown as IncomingMessage);
  await withFilesystemHook((event) => {
    if (event.operation === 'remove') throw s.cleanup;
  }, async () => {
    uploads.finish(u.id);
    const internals = uploads as unknown as { conversions: Map<string, { done: Promise<void> }> };
    await internals.conversions.get(u.id)!.done;
  });
  assert.equal(u.phase, 'failed');
  assert.match(u.error!, /original work failed/);
  assert.ok(logs.some((line) => line.includes(s.work.message)));
  assert.equal(s.warnings.mock.calls.length, 1);
});

test('explicit upload removal still reports its own cleanup failure', async (t) => {
  const s = setup(t), host = new Host(s.dir);
  t.after(() => host.close());
  const uploads = new Uploads(host, () => {}, { idleMs: 0 });
  const u = uploads.start({ name: 'Generated.fmp12', size: 1 });
  assert.throws(() => withFilesystemHook((event) => {
    if (event.operation === 'remove') throw s.cleanup;
  }, () => uploads.remove(u.id)), (error) => error === s.cleanup);
});

test('thumbnail failure keeps its undefined result and releases its slot when cleanup fails', async (t) => {
  const s = setup(t), files = new ContainerFiles();
  t.after(() => files.stop());
  const internals = files as unknown as {
    tools: { pdftoppm: string };
    activeTools: number;
    withTool(data: Uint8Array, pdf: boolean, size: number): Promise<Uint8Array | undefined>;
  };
  internals.tools = { pdftoppm: 'unused: write fails before any process starts' };
  let staging: string | undefined;
  t.after(() => { if (staging) rmSync(staging, { recursive: true, force: true }); });
  const result = await withFilesystemHook((event) => {
    if (event.operation === 'open' && event.path.endsWith('/in')) {
      staging = join(event.path, '..');
      throw s.work;
    }
    if (event.operation === 'remove') throw s.cleanup;
  }, () => internals.withTool(Buffer.from('generated'), true, 32));
  assert.equal(result, undefined);
  assert.equal(internals.activeTools, 0);
  assert.equal(s.warnings.mock.calls.length, 1);
});

for (const mismatch of [false, true]) test(`container upload ${mismatch ? 'hash failure keeps its status' : 'explicit removal reports failure'} when cleanup fails`, (t) => {
  const s = setup(t), uploads = new ContainerUploads({ tmp: s.dir, idleMs: 0 });
  t.after(() => uploads.stop());
  const who = { db: 'Generated', account: 'Admin' };
  const u = uploads.start(who, { layout: 'Rows', recordId: 1, field: 'File', repetition: 1 }, {
    size: 1, ...(mismatch ? { sha256: '0'.repeat(64) } : {}),
  });
  const piece = uploads.beginPiece(u.id, who, 'Rows', 0, 1);
  piece.append(Buffer.from('x'));
  piece.end();
  assert.throws(() => withFilesystemHook((event) => {
    if (event.operation === 'remove') throw s.cleanup;
  }, () => mismatch ? uploads.complete(u.id, who, 'Rows') : uploads.done(u.id)),
  (error) => mismatch ? error instanceof ContainerUploadError && error.status === 422 : error === s.cleanup);
});
