// Synthetic credential audit profile. No package manager, service or network commands.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const files = process.argv.slice(2);
const defaults = [
  'packages/plugins/test/secrets.test.ts',
  'packages/scripts/test/credential-dataflow.test.ts',
  'packages/scripts/test/credential-diagnostics.test.ts',
  'packages/scripts/test/redaction-linear.test.ts',
  'packages/scripts/test/custom-fetch.test.ts',
  'packages/scripts/test/sigv4.test.ts',
  'packages/scripts/test/review-round2-credentials.test.ts',
  'packages/server/test/credential-traces.test.ts',
  'packages/server/test/redaction-diagnostics.test.ts',
  'packages/server/test/mcp-secret-value.test.ts',
  'packages/server/test/mcp-trace-privileges.test.ts',
  'packages/server/test/review-round2-credentials.test.ts',
  'packages/server/test/review-round2-oauth.test.ts',
  'packages/server/test/review-round2-idp.test.ts',
  'packages/server/test/session-clock.test.ts',
  'packages/server/test/connections.test.ts',
  'packages/server/test/ldap-scim-signin.test.ts',
  'packages/store/test/durable.test.ts',
  'packages/store/test/webauthn.test.ts',
];
const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-path-'));
const marker = join(dir, 'forbidden-command');
try {
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, name), '#!/bin/sh\nprintf blocked >> "$REVIEW_AUDIT_MARKER"\nexit 99\n', { mode: 0o700 });
  }
  symlinkSync(process.execPath, join(dir, 'node'));
  const run = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-timeout=60000', '--test-reporter=tap', ...(files.length ? files : defaults)], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, PATH: dir, REVIEW_AUDIT_MARKER: marker },
    stdio: 'inherit',
  });
  assert.ok(!existsSync(marker), 'a test attempted a forbidden command');
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
