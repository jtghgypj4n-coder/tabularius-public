import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const main = join(import.meta.dirname, '../src/main.ts');
test('new (native and compat), info and ai-policy toggle round-trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-ai-policy-'));
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout;
  };
  try {
    for (const native of [false, true]) {
      const name = native ? 'Native' : 'Compat';
      run('new', dir, name, ...(native ? ['--native'] : []));
      const info = () => JSON.parse(run('info', join(dir, `${name}.openhbam.sqlite`)));
      assert.equal(info().aiPolicy, true);
      run('ai-policy', dir, name, 'off'); assert.equal(info().aiPolicy, false);
      run('ai-policy', dir, name, 'on'); assert.equal(info().aiPolicy, true);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
