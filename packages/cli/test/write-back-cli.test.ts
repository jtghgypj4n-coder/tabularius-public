// `tabularius write-back` writes paste files and a README for changes made
// since a file came from its .fmp12, and touches neither the store nor the .fmp12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store } from '../../store/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('write-back writes numbered paste files and a README, read only', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-writeback-cli-'));
  try {
    copyFileSync(fixture, join(dir, 'Charts.fmp12'));
    const path = join(dir, 'Charts.openhbam.sqlite');
    importFmp12(join(dir, 'Charts.fmp12'), path);
    const run = (out: string) => spawnSync(process.execPath, ['--no-warnings', main, 'write-back', dir, 'Charts', join(dir, out)], { encoding: 'utf8' });

    let r = run('none');
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(dir, 'none', 'README.md'), 'utf8'), /Nothing has changed/);

    const s = new Store(path, 'Charts');
    s.applyDesign([
      { op: 'createTable', name: 'Notes', fields: [{ name: 'Text', type: 'text' }] },
      { op: 'createScript', name: 'Hello', text: 'Beep' },
    ]);
    s.close();
    const before = statSync(path).mtimeMs;
    r = run('kit');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^2 files to paste and \d+ changes to make by hand/);
    assert.deepEqual(readdirSync(join(dir, 'kit')).sort(), ['01.xml', '02.xml', 'README.md']);
    assert.match(readFileSync(join(dir, 'kit', '01.xml'), 'utf8'), /<BaseTable comment="" name="Notes">/);
    const readme = readFileSync(join(dir, 'kit', 'README.md'), 'utf8');
    assert.match(readme, /1\. `01\.xml` \(Notes\): File > Manage > Database/);
    assert.match(readme, /2\. `02\.xml` \(Hello\): Scripts > Script Workspace/);
    assert.match(readme, /## Then do these by hand\n\n- Add table occurrence "Notes"/);
    assert.equal(statSync(path).mtimeMs, before);

    // A folder with something in it is left alone.
    r = run('kit');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /isn't empty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
