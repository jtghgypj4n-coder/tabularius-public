// A hostile or broken .fmp12 must be rejected cleanly, not crash or hang the
// importer. (The server also caps upload size and runs conversion on a worker
// with a memory and time budget; this covers the reader itself.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12 } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('malformed, truncated and garbage files are refused, not crashed on', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-malformed-'));
  const real = readFileSync(fixture);
  const cases: Record<string, Buffer> = {
    empty: Buffer.alloc(0),
    garbage: Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 2654435761) & 0xff)),
    zeros: Buffer.alloc(100_000),
    truncatedHeader: real.subarray(0, 512),
    truncatedBody: real.subarray(0, 4096),
    headerThenGarbage: Buffer.concat([real.subarray(0, 1024), Buffer.alloc(8192, 0x5a)]),
  };
  try {
    for (const [name, bytes] of Object.entries(cases)) {
      const src = join(dir, `${name}.fmp12`);
      writeFileSync(src, bytes);
      const started = Date.now();
      assert.throws(() => importFmp12(src, join(dir, `${name}.sqlite`)), Error, `${name} should be refused`);
      // Fail fast: a refusal is near-instant, never a hang.
      assert.ok(Date.now() - started < 5000, `${name} should fail quickly`);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});
