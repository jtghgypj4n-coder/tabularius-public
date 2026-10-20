// Synthetic-only r24-11 regression runner. Child processes have no operational commands on PATH.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tests = process.argv.slice(2);
if (tests.some((path) => !/^packages\/(scripts|store|server)\/test\/[a-z0-9-]+\.test\.ts$/.test(path))) {
  throw new Error('Arguments must be explicit script/store/server test filenames');
}
const dir = mkdtempSync(join(tmpdir(), 'tabularius-inheritance-path-'));
const marker = join(dir, 'forbidden-command');
try {
  for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, command), '#!/bin/sh\n: > "$R24_11_FORBIDDEN_COMMAND_MARKER"\nexit 99\n', { mode: 0o755 });
  }
  symlinkSync(process.execPath, join(dir, 'node'));
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-reporter=spec', ...(tests.length ? tests : [
    'packages/scripts/test/privilege-inheritance.test.ts',
    'packages/store/test/privilege-inheritance.test.ts',
    'packages/server/test/privilege-inheritance.test.ts',
  ])], { cwd: join(import.meta.dirname, '..'), env: { ...process.env, PATH: dir, R24_11_FORBIDDEN_COMMAND_MARKER: marker }, stdio: 'inherit', timeout: 120_000 });
  assert.equal(existsSync(marker), false, 'a forbidden child command was attempted');
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
