import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

/** Child processes in settings tests must never run machine-management commands. */
export function testCommandPath(t: TestContext): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-command-stubs-'));
  const marker = join(dir, 'called');
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, name), '#!/bin/sh\n: > "$TEST_BLOCKED_COMMAND_MARKER"\nexit 99\n', { mode: 0o755 });
  }
  t.after(() => {
    try { assert.equal(existsSync(marker), false, 'a forbidden command was invoked'); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
  return { ...process.env, PATH: dir, TEST_BLOCKED_COMMAND_MARKER: marker };
}
