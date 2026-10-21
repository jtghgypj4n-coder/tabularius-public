// Synthetic inputs only; children cannot invoke host maintenance or network commands.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = mkdtempSync(join(tmpdir(), 'tabularius-read-gate-path-'));
const marker = join(bin, 'unexpected-command');
const buildInfo = resolve(import.meta.dirname, '../packages/server/build-info.json');
let madeBuildInfo = false;
try {
  // Release-style synthetic metadata prevents serverCommit's optional checkout probe.
  // Exclusive creation preserves any operator-supplied build metadata.
  if (!existsSync(buildInfo)) {
    writeFileSync(buildInfo, JSON.stringify({ commit: 'synthetic-read-gate' }), { flag: 'wx' });
    madeBuildInfo = true;
  }
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(bin, name), '#!/bin/sh\nprintf forbidden > "$TABULARIUS_TEST_CHILD_MARKER"\nexit 99\n', { mode: 0o755 });
  }
  const files = process.argv.includes('--surfaces') ? ['packages/server/test/read-gate-surfaces.test.ts'] : [
    'packages/store/test/read-gate.test.ts',
    'packages/server/test/read-gate-surfaces.test.ts',
    'packages/store/test/summary-privileges.test.ts',
    'packages/store/test/found-set-portal.test.ts',
    'packages/store/test/privileges-everywhere.test.ts',
    'packages/scripts/test/ai-steps.test.ts',
    'packages/server/test/rag-store.test.ts',
    'packages/server/test/rag-hybrid.test.ts',
    'packages/server/test/r15-rag-ai.test.ts',
    'packages/server/test/calendar-feed.test.ts',
    ...['admin', 'api-token', 'dataapi', 'mcp', 'odata', 'pgwire', 'scripts', 'sql', 'web', 'xml'].map((surface) => `packages/server/test/privilege-matrix-${surface}.test.ts`),
  ];
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-timeout=55000', '--test-reporter=spec', ...files], {
    cwd: resolve(import.meta.dirname, '..'), stdio: 'inherit', timeout: 180_000,
    env: { ...process.env, PATH: bin, TABULARIUS_TEST_CHILD_MARKER: marker },
  });
  if (existsSync(marker)) throw new Error('A forbidden child command ran during the read-gate audit');
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (madeBuildInfo) rmSync(buildInfo);
  rmSync(bin, { recursive: true, force: true });
}
