import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';

// A multi-file solution: the layouts of the first file mostly use tables stored in
// the second. These are private sample files, so the test skips unless
// TABULARIUS_MULTIFILE_FIXTURES names the two (e.g. "main,data", without .fmp12) in fixtures/private.
const priv = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'private');
const files = (process.env.TABULARIUS_MULTIFILE_FIXTURES ?? '').split(',').map((f) => f.trim()).filter(Boolean);
const skip = files.length >= 2 && files.every((f) => existsSync(join(priv, `${f}.fmp12`))) ? false : 'private multi-file fixtures not present';

test('multi-file: layouts on another hosted file\'s tables', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  try {
    for (const f of files) copyFileSync(join(priv, `${f}.fmp12`), join(dir, `${f}.fmp12`));
    const host = new Host(dir);
    const store = host.get(files[0])!;
    const layouts = store.layouts();
    const external = layouts.filter((l) => l.file);
    assert.ok(external.length > 20);
    assert.ok(external.every((l) => l.table), 'every external layout resolves to a table');
    for (const l of layouts) store.find(l.name, { limit: 1 });
    host.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
