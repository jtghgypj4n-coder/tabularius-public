import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('a generated 20 MiB CSV imports within a 128 MiB V8 heap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-child-'));
  try {
    const marker = join(dir, 'command-ran');
    for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
      const path = join(dir, name);
      writeFileSync(path, '#!/bin/sh\nprintf x > "$TABULARIUS_TEST_CHILD_MARKER"\nexit 99\n');
      chmodSync(path, 0o755);
    }
    const child = spawnSync(process.execPath, ['--no-warnings', '--max-old-space-size=128', fileURLToPath(new URL('./support/import-memory-child.ts', import.meta.url))], {
      env: { ...process.env, PATH: dir, TABULARIUS_TEST_CHILD_MARKER: marker }, encoding: 'utf8', timeout: 55_000,
    });
    assert.equal(existsSync(marker), false, 'a forbidden child command ran');
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
  } finally { rmSync(dir, { recursive: true }); }
});
