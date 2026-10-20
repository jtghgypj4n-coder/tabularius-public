// `tabularius stale-calcs` prints counts only: no record ids and no stored or recomputed values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

test('stale-calcs --json has counts but no record values or ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-stale-cli-'));
  try {
    const path = join(dir, 'Shop.openhbam.sqlite');
    createStore(path);
    const s = new Store(path, 'Shop');
    s.applyDesign([
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Lines', fields: [{ name: 'OrderId', type: 'number' }, { name: 'Amount', type: 'number' }] },
      { op: 'createField', table: 'Orders', name: 'Total', kind: 'calculation', type: 'number', calculation: 'ExecuteSQL ( "SELECT SUM(Amount) FROM Lines WHERE OrderId = ?" ; "" ; "" ; Id )' },
    ]);
    s.create('Orders', { Id: '1' });
    s.create('Lines', { OrderId: '1', Amount: '98765' });
    s.close();
    const r = spawnSync(process.execPath, ['--no-warnings', main, 'stale-calcs', dir, 'Shop', '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.stale, 1);
    assert.deepEqual(Object.keys(out.fields[0]).filter((k) => k === 'examples' || k === 'recordIds'), []);
    assert.doesNotMatch(r.stdout, /98765/);
    const text = spawnSync(process.execPath, ['--no-warnings', main, 'stale-calcs', dir, 'Shop'], { encoding: 'utf8' });
    assert.doesNotMatch(text.stdout, /98765/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
