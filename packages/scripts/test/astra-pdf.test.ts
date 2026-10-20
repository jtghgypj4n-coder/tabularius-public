import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('AR-calc-extensions-11', () => {
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(new URL('./astra-pdf-child.ts', import.meta.url))], {
    encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
