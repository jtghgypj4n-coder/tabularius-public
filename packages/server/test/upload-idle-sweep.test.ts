// An upload that stops receiving pieces is removed after the idle limit, with its pieces on disk; one still receiving,
// and a finished one, are kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { Uploads, UploadError } from '../src/uploads.ts';

const HOUR = 3_600_000;

test('abandoned uploads are removed after the idle limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-upload-idle-'));
  const host = new Host(dir, () => {});
  let now = 1_000_000;
  const log: string[] = [];
  try {
    const uploads = new Uploads(host, (m) => log.push(m), { now: () => now, idleMs: 24 * HOUR });
    const a = uploads.start({ name: 'Old.fmp12', size: 1024 });
    now += 20 * HOUR;
    const b = uploads.start({ name: 'Newer.fmp12', size: 1024 });
    const part = (id: string) => join(dir, '.openhbam-uploads', `${id}.part`);
    assert.ok(existsSync(part(a.id)) && existsSync(part(b.id)));
    // Not idle long enough yet.
    now += 3 * HOUR;
    assert.deepEqual(uploads.list().map((u) => u.name).sort(), ['Newer', 'Old']);
    // Old.fmp12 has been idle for 24 hours; Newer.fmp12 for 4.
    now += 1 * HOUR;
    assert.deepEqual(uploads.list().map((u) => u.name), ['Newer']);
    assert.ok(!existsSync(part(a.id)), 'its pieces are deleted');
    assert.ok(existsSync(part(b.id)));
    assert.throws(() => uploads.get(a.id), (e) => e instanceof UploadError && e.status === 404);
    assert.match(log.join('\n'), /removed abandoned upload of Old\.fmp12/);
    // The name is free again.
    assert.ok(uploads.start({ name: 'Old.fmp12', size: 1024 }).id);
    // Starting an upload also sweeps.
    now += 30 * HOUR;
    uploads.start({ name: 'Third.fmp12', size: 1024 });
    assert.deepEqual(uploads.list().map((u) => u.name), ['Third']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('an idle limit of 0 keeps uploads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-upload-idle-off-'));
  const host = new Host(dir, () => {});
  let now = 1_000_000;
  try {
    const uploads = new Uploads(host, () => {}, { now: () => now, idleMs: 0 });
    uploads.start({ name: 'Slow.fmp12', size: 1024 });
    now += 1000 * HOUR;
    assert.equal(uploads.list().length, 1);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
