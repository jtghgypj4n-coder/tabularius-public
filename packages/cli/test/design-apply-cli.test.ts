// `tabularius design-apply` reads an edited design-text folder back: it lists the changes and makes none until
// --apply, and writing the folder again afterwards gives the same text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store } from '../../store/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('design-apply shows the changes, makes them with --apply, and the folder then matches', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-design-apply-cli-'));
  try {
    copyFileSync(fixture, join(dir, 'Charts.fmp12'));
    const path = join(dir, 'Charts.openhbam.sqlite');
    importFmp12(join(dir, 'Charts.fmp12'), path);
    const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });
    const text = join(dir, 'text');

    let r = run('design-text', dir, 'Charts', text);
    assert.equal(r.status, 0, r.stderr);
    r = run('design-apply', dir, 'Charts', text);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Charts: nothing to change \(\d+ files already match\)/);

    mkdirSync(join(text, 'custom-functions'), { recursive: true });
    writeFileSync(join(text, 'custom-functions', 'Twice.txt'), 'Twice ( x )\n\nx * 2\n');
    r = run('design-apply', dir, 'Charts', text);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Add custom function "Twice"/);
    assert.match(r.stdout, /1 changes; nothing was changed\. Run again with --apply/);
    let s = new Store(path, 'Charts');
    assert.equal(s.schema.customFunctions.length, 0);
    s.close();

    r = run('design-apply', dir, 'Charts', text, '--apply');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Charts: 1 changes made/);
    s = new Store(path, 'Charts');
    assert.equal(s.schema.customFunctions.find((c) => c.name === 'Twice')?.formula, 'x * 2');
    s.close();

    // Written again, the folder is what it was (the new function's file is the one we wrote).
    r = run('design-text', dir, 'Charts', text);
    assert.match(r.stdout, /0 written|nothing changed/);
    assert.equal(readFileSync(join(text, 'custom-functions', 'Twice.txt'), 'utf8'), 'Twice ( x )\n\nx * 2\n');

    r = run('design-apply', dir, 'Charts', join(dir, 'nowhere'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /doesn't exist/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
