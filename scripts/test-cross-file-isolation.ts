// Generated-input audit checks only. Every child inherits a PATH of forbidden-command stubs.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = mkdtempSync(join(tmpdir(), 'tabularius-isolation-path-'));
const marker = join(bin, 'unexpected-command');
try {
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(bin, name), '#!/bin/sh\nprintf forbidden > "$TABULARIUS_TEST_CHILD_MARKER"\nexit 99\n', { mode: 0o755 });
  }
  const files = [
    'packages/server/test/cross-file-entrypoints.test.ts',
    'packages/server/test/cross-file-protocols.test.ts',
    'packages/server/test/cross-file-regressions.test.ts',
    'packages/server/test/cross-file-state.test.ts',
    'packages/server/test/dataapi-data-source.test.ts',
    'packages/server/test/mcp-origin.test.ts',
    'packages/scripts/test/cross-file-privileges.test.ts',
    'packages/scripts/test/open-file-triggers.test.ts',
  ];
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-timeout=55000', '--test-reporter=spec', ...files], {
    cwd: root, stdio: 'inherit', timeout: 180_000,
    env: { ...process.env, PATH: bin, TABULARIUS_TEST_CHILD_MARKER: marker },
  });
  if (existsSync(marker)) throw new Error('A forbidden child command ran during the isolation audit');
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(bin, { recursive: true, force: true }); }
