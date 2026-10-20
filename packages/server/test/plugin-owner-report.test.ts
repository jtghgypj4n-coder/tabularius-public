import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { conversionReport } from '../src/conversion.ts';

test('conversion report counts owner-only plugin ids without exposing source details', () => {
  const dir = mkdtempSync(join(tmpdir(), 'owner-id-report-'));
  try {
    const file = join(dir, 'synthetic.sqlite');
    createStore(file);
    const store = new Store(file, 'Synthetic');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'PrivateMarkerName', fields: [{ name: 'Source' }] },
        { op: 'createField', table: 'PrivateMarkerName', name: 'Result', kind: 'calculation', type: 'text', calculation: '<plugin:PCCC:17> ( "FORMULA_SECRET" ) & <plugin:PCCC:18> ( "FORMULA_SECRET" )' },
      ]);
      const report = conversionReport(store);
      const item = report.functions.plugIns.find((x) => x.name === 'unknown plug-in (id only) pccc');
      assert.equal(item?.count, 2);
      assert.match(report.summary, /unknown plug-in \(id only\) pccc \(2\)/);
      assert.deepEqual(item?.where, []);
      const output = JSON.stringify(report);
      for (const secret of ['PrivateMarkerName', 'FORMULA_SECRET', file, dir]) assert.equal(output.includes(secret), false);
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
