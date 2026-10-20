import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { existingDirectoryLinks } from '../../store/src/safe-path.ts';

test('mount indexing terminates for an ordinary root instead of looping at the filesystem root', (t) => {
  assert.equal(typeof existingDirectoryLinks, 'function');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mutation-path-liveness-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Preserve loader hooks so this subprocess exercises the same mutant. Forward
  // only preload arguments, not Node's test-runner switches.
  const preloads: string[] = [];
  for (let i = 0; i < process.execArgv.length; i++) {
    const arg = process.execArgv[i];
    if (arg === '--import') preloads.push(arg, process.execArgv[++i]);
    else if (arg.startsWith('--import=')) preloads.push(arg);
  }
  const source = `import { existingDirectoryLinks } from ${JSON.stringify(new URL('../../store/src/safe-path.ts', import.meta.url).href)};
    console.log(existingDirectoryLinks([${JSON.stringify(root)}]).size);`;
  // Normal execution is well below 100 ms; three seconds gives over 30x headroom.
  // A child boundary makes a nonterminating synchronous loop a test failure,
  // instead of hanging every other path assertion until the campaign deadline.
  const child = spawnSync(process.execPath, [...preloads, '--no-warnings', '--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL',
  });
  assert.equal(child.error, undefined, 'mount indexing must finish within its generous execution budget');
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '0\n');
});
