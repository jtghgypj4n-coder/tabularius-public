import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

// People coming and going in waves, some dropping mid-edit: after every wave
// nothing is left behind and memory levels off. A short run here; run
// scripts/soak.ts for longer to catch slower leaks. It takes a while, so only
// with TABULARIUS_SOAK=1 (CI's manual run from the Actions tab sets it).
const root = join(import.meta.dirname, '..', '..', '..');
const fixture = join(root, 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = !process.env.TABULARIUS_SOAK ? 'set TABULARIUS_SOAK=1 to run it' : existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('soak test: nothing left behind after waves of users, memory levels off', { skip }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--no-warnings', join(root, 'scripts', 'soak.ts'), fixture, '--users', '12', '--minutes', '0.4', '--wave', '3', '--script', 'Show House'], { timeout: 180_000 })
    .catch((e: { stdout?: string; message: string }) => assert.fail(`soak test failed:\n${e.stdout ?? e.message}`));
  assert.match(stdout, /checks passed: nothing left behind, memory levels off/, stdout);
  assert.match(stdout, /heap trend after warm-up/, stdout);
  assert.match(stdout, /^no errors$/m, stdout);
});
