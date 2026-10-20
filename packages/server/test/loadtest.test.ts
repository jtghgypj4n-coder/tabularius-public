import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

// Many people editing the same few records at once, through the web client's
// lock-save-unlock and through Data API clients that don't lock: no update is
// lost, every live update arrives, and no lock is left behind.
const root = join(import.meta.dirname, '..', '..', '..');
const fixture = join(root, 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('load test on a few hot records: no lost updates, no missed live updates, no stuck locks', { skip }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--no-warnings', join(root, 'scripts', 'loadtest.ts'), fixture, '--users', '16', '--seconds', '4', '--hot', '3'], { timeout: 120_000 })
    .catch((e: { stdout?: string; message: string }) => assert.fail(`load test failed:\n${e.stdout ?? e.message}`));
  assert.match(stdout, /checks passed: no lost updates, every live update arrived, no locks left/, stdout);
  assert.match(stdout, /increments accepted: [1-9]/, stdout);
  assert.match(stdout, /^no errors$/m, stdout);
});

test('the same with the server as two worker processes: locks and live updates hold across them', { skip }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--no-warnings', join(root, 'scripts', 'loadtest.ts'), fixture, '--users', '16', '--seconds', '4', '--hot', '3', '--workers', '2'], { timeout: 120_000 })
    .catch((e: { stdout?: string; message: string }) => assert.fail(`load test failed:\n${e.stdout ?? e.message}`));
  assert.match(stdout, /checks passed: no lost updates, every live update arrived, no locks left/, stdout);
  assert.match(stdout, /increments accepted: [1-9]/, stdout);
  assert.match(stdout, /^no errors$/m, stdout);
});
