// Generated inputs and public vectors only. Child commands cannot operate on the host.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'openhbam-crypto-path-'));
const marker = join(dir, 'forbidden-command');
try {
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, name), '#!/bin/sh\nprintf "%s\\n" "$0" >> "$OPENHBAM_CRYPTO_TEST_MARKER"\nexit 99\n', { mode: 0o700 });
  }
  const files = [
    'packages/calc/test/crypto-conformance.test.ts',
    'packages/calc/test/container-crypt.test.ts',
    'packages/calc/test/mbs-hash.test.ts',
    'packages/web/test/offline.test.ts',
    'packages/scripts/test/digest-auth.test.ts',
    'packages/store/test/crypto-conformance.test.ts',
    'packages/store/test/webauthn.test.ts',
    'packages/store/test/webauthn-conformance.test.ts',
    'packages/server/test/oidc-conformance.test.ts',
    'packages/server/test/crypto-protocols.test.ts',
    'packages/scripts/test/sigv4.test.ts',
    'packages/scripts/test/sigv4-conformance.test.ts',
  ];
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-timeout=60000', '--test-reporter=spec', ...files], {
    cwd: join(import.meta.dirname, '..'), stdio: 'inherit',
    env: { ...process.env, PATH: dir, OPENHBAM_CRYPTO_TEST_MARKER: marker },
  });
  assert.equal(existsSync(marker), false, 'a test invoked a forbidden child command');
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
