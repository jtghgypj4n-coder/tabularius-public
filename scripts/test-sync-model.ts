// Targeted runner: the Node test worker and anything it launches inherit inert stubs.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'openhbam-sync-runner-'));
try {
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, name), '#!/bin/sh\nprintf blocked > "${0%/*}/called"\nexit 99\n', { mode: 0o755 });
    writeFileSync(join(dir, `${name}.cmd`), '@echo off\r\necho blocked > "%~dp0called"\r\nexit /b 99\r\n');
  }
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', 'packages/server/test/sync-model.test.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, PATH: dir }, stdio: 'inherit', timeout: 120_000,
  });
  if (existsSync(join(dir, 'called'))) throw new Error('Tabularius sync tests invoked a forbidden command');
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
