import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

/** Child tests get only forbidden-command stubs; node itself is launched by absolute path. */
export function commandStubEnv(t: TestContext): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-stubs-'));
  const marker = join(dir, 'called');
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, name), '#!/bin/sh\nprintf forbidden >> "$TABULARIUS_TEST_CHILD_MARKER"\nexit 99\n', { mode: 0o700 });
  }
  t.after(() => {
    const called = existsSync(marker);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(called, false, 'a forbidden child command ran');
  });
  return { ...process.env, PATH: dir, TABULARIUS_TEST_CHILD_MARKER: marker };
}
