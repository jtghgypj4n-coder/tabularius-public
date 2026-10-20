// `tabularius design-diff <old> <new>`: folders, a FileMaker file or a hosted file on either side; changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });

test('design-diff compares folders and files, and --exit-code reports a difference', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-design-diff-cli-'));
  try {
    copyFileSync(fixture, join(dir, 'Charts.fmp12'));
    let r = run('design-diff', join(dir, 'Charts.fmp12'), join(dir, 'Charts.fmp12'), '--exit-code');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No differences\./);

    const before = join(dir, 'before');
    const after = join(dir, 'after');
    for (const f of [before, after]) {
      r = run('design-text', join(dir, 'Charts.fmp12'), f);
      assert.equal(r.status, 0, r.stderr);
    }
    const table = readdirSync(join(after, 'tables'))[0];
    writeFileSync(join(after, 'tables', table), readFileSync(join(after, 'tables', table), 'utf8') + '\nReviewer note\n  Type: text, normal\n');
    r = run('design-diff', before, after);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Tables$/m);
    assert.match(r.stdout, /\+ field Reviewer note \(text, normal\)/);
    assert.match(r.stdout, /1 object differs/);
    assert.equal(run('design-diff', before, after, '--exit-code').status, 1);
    assert.equal(run('design-diff', before, join(dir, 'missing')).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
