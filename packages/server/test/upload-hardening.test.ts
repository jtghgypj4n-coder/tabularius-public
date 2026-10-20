// The /admin upload is an attack surface: a declared size can't exceed the cap
// (so it can't fill the disk), and a hostile file fails the conversion cleanly
// without crashing the server or jamming the single conversion slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { Uploads, UploadError, MAX_UPLOAD } from '../src/uploads.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('an upload larger than the cap is refused before any bytes are taken', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-uphard-cap-'));
  const host = new Host(dir, () => {});
  try {
    const uploads = new Uploads(host, () => {});
    assert.throws(() => uploads.start({ name: 'Huge.fmp12', size: MAX_UPLOAD + 1 }),
      (e) => e instanceof UploadError && e.status === 413, 'over the cap is refused');
    // A sensible size is accepted.
    assert.ok(uploads.start({ name: 'Fine.fmp12', size: 1024 }).id);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a hostile file fails conversion cleanly and frees the slot for the next upload', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-uphard-conv-'));
  const host = new Host(dir, () => {});
  try {
    // Garbage where a .fmp12 is expected: the worker's importer throws, so the
    // conversion rejects rather than crashing the process.
    const bad = join(dir, 'bad.src');
    writeFileSync(bad, randomBytes(8192));
    await assert.rejects(() => host.hostUpload(bad, 'Bad'), 'a hostile file is rejected, not crashed on');
    assert.equal(host.get('Bad'), undefined, 'nothing is hosted from it');

    // The single conversion slot is freed, so a real file still hosts afterwards.
    const good = join(dir, 'good.src');
    copyFileSync(fixture, good);
    const r = await host.hostUpload(good, 'Good');
    assert.ok(r.tables > 0 && host.get('Good'), 'a valid upload still converts after the bad one');
  } finally {
    rmSync(dir, { recursive: true });
  }
});
