// `tabularius new` takes a name the server could host: a path-like name used to create a file outside the folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE_EXT } from '../../server/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });

test('new refuses a name that is a path or starts with a symbol, and creates nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-newname-'));
  try {
    const folder = join(root, 'hosted');
    mkdirSync(folder);
    for (const name of ['../outside', 'bad/name', 'bad\\name', '.hidden', '-lead', '', 'a'.repeat(101)]) {
      const r = cli('new', folder, name);
      assert.notEqual(r.status, 0, JSON.stringify(name));
      assert.match(r.stderr, /Database names use letters, digits, spaces, - and _|give the new database a name/, JSON.stringify(name));
    }
    assert.deepEqual(readdirSync(folder), []);
    assert.deepEqual(readdirSync(root), ['hosted'], 'nothing was made beside the folder');
    const ok = cli('new', folder, 'Sales 2026_a-b');
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(existsSync(join(folder, 'Sales 2026_a-b' + STORE_EXT)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
