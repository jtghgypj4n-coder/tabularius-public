import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandStubEnv } from '../../../scripts/test-command-stubs.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

test('serve help documents accepting partial standby files', async (t) => {
  const result = await runCli(main, ['serve', '--help'], { env: commandStubEnv(t), timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[--accept-partial-standby\]/);
});

for (const [accept, workers] of [[false, 1], [true, 1], [false, 2], [true, 2]] as const) {
  test(`serve CLI ${accept ? 'accepts partial standby files only with the flag' : 'refuses partial standby files by default'}${workers > 1 ? ` with --workers ${workers}` : ''}`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-takeover-cli-'));
    const path = join(dir, '.openhbam-standby.json');
    const state = JSON.stringify({
      primary: 'http://127.0.0.1:1',
      files: { Charts: { run: 'r', seq: 3, wholeAfter: 5, size: 0, mtimeMs: 0, at: 0 } },
    });
    writeFileSync(path, state);
    const { PATH, TABULARIUS_TEST_CHILD_MARKER } = commandStubEnv(t);
    const child = spawn(process.execPath, [
      '--no-warnings', main, 'serve', dir, '--port', '0', '--host', '127.0.0.1', '--no-backups', '--stats-interval', 'off',
      ...(workers > 1 ? ['--workers', String(workers)] : []),
      ...(accept ? ['--accept-partial-standby'] : []),
    ], {
      env: { PATH, TABULARIUS_TEST_CHILD_MARKER },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
    });
    let stdout = '', stderr = '', ready = false;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      // The CLI installs its shutdown handlers before announcing readiness.
      if (!ready && stdout.includes('Web client:')) {
        ready = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    try {
      const status = await closed;
      assert.equal(status, accept ? 0 : 1, stdout + stderr);
      assert.equal(ready, accept, stdout + stderr);
      if (accept) {
        assert.match(stdout, /Charts.*accepted with --accept-partial-standby/);
        assert.equal(existsSync(path), false);
      } else {
        assert.match(stderr, /Charts.*--accept-partial-standby/);
        assert.equal(readFileSync(path, 'utf8'), state);
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await closed;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
