// Synthetic authentication audit profile. Child processes inherit only command traps on PATH.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const trap = mkdtempSync(join(tmpdir(), 'tabularius-auth-command-traps-'));
const marker = join(trap, 'forbidden-command');
const requested = process.argv.slice(2);
const files = requested.length === 1 && requested[0] === '--regression' ? [
  'packages/store/test/lockout.test.ts',
  'packages/store/test/unicode-text-equality.test.ts',
  'packages/store/test/account-provisioning.test.ts',
  'packages/store/test/clock.test.ts',
  'packages/server/test/session-clock.test.ts',
  'packages/server/test/mcp-signin-parity.test.ts',
  'packages/server/test/ldap-scim-signin.test.ts',
  'packages/server/test/signin-lockout-retry-after.test.ts',
  'packages/server/test/signin-parity.test.ts',
  'packages/server/test/host-lockout-pairs.test.ts',
  'packages/server/test/dataapi-data-source.test.ts',
  'packages/server/test/adminapi-tokens.test.ts',
] : requested;
if (files.some((file) => !/^packages\/(?:store|server)\/test\/[a-z0-9-]+\.test\.ts$/.test(file))) throw new Error('Expected explicit store/server test paths');
try {
  for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(trap, command), '#!/bin/sh\nprintf "%s\\n" forbidden >> "$TABULARIUS_TEST_COMMAND_MARKER"\nexit 99\n', { mode: 0o755 });
    writeFileSync(join(trap, `${command}.cmd`), '@echo off\r\necho forbidden>>"%TABULARIUS_TEST_COMMAND_MARKER%"\r\nexit /b 99\r\n');
  }
  const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...(
    files.length ? files : ['packages/store/test/auth-review-round2.test.ts', 'packages/server/test/auth-review-round2.test.ts', 'packages/server/test/auth-review-round2-cluster.test.ts', 'packages/server/test/auth-review-round2-oidc.test.ts', 'packages/server/test/auth-review-round2-scim.test.ts']
  )], { cwd: root, stdio: 'inherit', env: { ...process.env, PATH: trap, TABULARIUS_TEST_COMMAND_MARKER: marker } });
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (existsSync(marker)) {
    console.error('FAIL: a test attempted a forbidden command');
    process.exitCode = 1;
  }
} finally { rmSync(trap, { recursive: true, force: true }); }
