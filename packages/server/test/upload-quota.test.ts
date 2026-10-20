import type { IncomingMessage } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { Uploads, UploadError, MAX_UPLOAD } from '../src/uploads.ts';

test('empty uploads do not reserve their declared sizes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-upload-quota-'));
  try {
    const uploads = new Uploads(new Host(dir, () => {}), () => {});
    // Default aggregate quota: 20 GiB, independent of the 10 GiB per-file cap.
    const a = uploads.start({ name: 'A.fmp12', size: MAX_UPLOAD });
    uploads.start({ name: 'B.fmp12', size: MAX_UPLOAD });
    assert.ok(uploads.start({ name: 'C.fmp12', size: MAX_UPLOAD }).id);
    assert.equal(readdirSync(join(dir, '.openhbam-uploads')).length, 3);
    uploads.remove(a.id);
    assert.ok(uploads.start({ name: 'D.fmp12', size: MAX_UPLOAD }).id);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('configured quota counts received bytes through conversion, failure and expiry', async () => {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { mkdtempSync, rmSync, statSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { PassThrough, Readable } from 'node:stream';
    import { Host } from './packages/server/src/host.ts';
    import { Uploads, MAX_UPLOAD, MAX_UPLOAD_IN_PROGRESS } from './packages/server/src/uploads.ts';
    assert.equal(MAX_UPLOAD, 0);
    assert.equal(MAX_UPLOAD_IN_PROGRESS, 10);
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-upload-quota-env-'));
    try {
      let now = 0;
      let reject;
      const host = new Host(dir, () => {});
      host.hostUpload = () => new Promise((_, fail) => { reject = fail; });
      const uploads = new Uploads(host, () => {}, { now: () => now, idleMs: 100 });
      const a = uploads.start({ name: 'A.fmp12', size: 6 });
      const b = uploads.start({ name: 'B.fmp12', size: 4 });
      const piece = (n) => Object.assign(Readable.from([Buffer.alloc(n)]), { headers: {} });
      const live = Object.assign(new PassThrough(), { headers: {} });
      const writing = uploads.write(a.id, 0, live);
      live.write(Buffer.alloc(6));
      assert.equal(statSync(join(dir, '.openhbam-uploads', a.id + '.part')).size, 6);
      await uploads.write(b.id, 0, piece(4));
      const c = uploads.start({ name: 'C.fmp12', size: 4 });
      await assert.rejects(uploads.write(c.id, 0, piece(1)), /aggregate quota/, 'active piece counts before its request ends');
      live.end();
      await writing;
      uploads.finish(a.id);
      await assert.rejects(uploads.write(c.id, 0, piece(1)), /aggregate quota/);
      assert.equal(a.phase, 'waiting');
      now = 101;
      uploads.sweep();
      assert.equal(uploads.list().length, 1, 'queued conversion keeps its reservation');
      const d = uploads.start({ name: 'D.fmp12', size: 4 });
      await uploads.write(d.id, 0, piece(4));
      reject(new Error('conversion failed'));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(a.phase, 'failed');
      const e = uploads.start({ name: 'E.fmp12', size: 6 });
      await uploads.write(e.id, 0, piece(6));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  `], { cwd: join(import.meta.dirname, '../../..'), env: { ...process.env, TABULARIUS_MAX_UPLOAD: '0', TABULARIUS_MAX_UPLOAD_IN_PROGRESS: '10' }, stdio: 'pipe' });
});

test('an active piece cannot be removed or swept to free its reserved bytes', async () => {
  const { PassThrough } = await import('node:stream');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-upload-quota-write-'));
  let now = 0;
  const uploads = new Uploads(new Host(dir, () => {}), () => {}, { now: () => now, idleMs: 100 });
  const u = uploads.start({ name: 'A.fmp12', size: 10 });
  const first = Object.assign(new PassThrough(), { headers: {} });
  const initialWrite = uploads.write(u.id, 0, first as unknown as IncomingMessage);
  first.end(Buffer.alloc(10));
  await initialWrite;
  const req = Object.assign(new PassThrough(), { headers: {} });
  const writing = uploads.write(u.id, 0, req as unknown as IncomingMessage);
  try {
    assert.throws(() => uploads.finish(u.id), (e) => e instanceof UploadError && e.status === 409);
    assert.throws(() => uploads.remove(u.id), (e) => e instanceof UploadError && e.status === 409);
    now = 101;
    uploads.sweep();
    assert.equal(uploads.list().length, 1);
  } finally {
    req.end(Buffer.alloc(10));
    await writing;
    if (uploads.list().some((v) => v.id === u.id)) uploads.remove(u.id);
    rmSync(dir, { recursive: true, force: true });
  }
});
