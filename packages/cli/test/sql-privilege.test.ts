import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const main = join(import.meta.dirname, '../src/main.ts');
test('sql-privilege turns the second-file SQL privilege switch on and off for a file; info shows it; a bad word is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-sql-privilege-'));
  const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });
  const ok = (...args: string[]) => { const r = run(...args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  try {
    ok('new', dir, 'Data', '--native');
    const info = () => JSON.parse(ok('info', join(dir, 'Data.openhbam.sqlite')));
    assert.equal(info().sqlRequiresFmxdbc, false, 'off by default');
    assert.match(ok('sql-privilege', dir, 'Data', 'on'), /on for Data/);
    assert.equal(info().sqlRequiresFmxdbc, true);
    ok('sql-privilege', dir, 'Data', 'off');
    assert.equal(info().sqlRequiresFmxdbc, false);
    const bad = run('sql-privilege', dir, 'Data', 'maybe');
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /sql-privilege: give a database and on\|off/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
