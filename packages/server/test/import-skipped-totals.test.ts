import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';
import { applyImport, importMappedRows, planImport, replan, undoImport } from '../src/import-mapping.ts';

test('import accounts for every data row, including repeats, a blank row, errors, and the header', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-totals-'));
  const path = join(dir, 'data.sqlite');
  createStore(path);
  const store = new Store(path, 'Data');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Orders', fields: [{ name: 'Customer' }, { name: 'Amount', type: 'number' }] }] as DesignOp[], { account: 'Admin' });
    store.create('Orders', { Customer: 'already here', Amount: 1 });
    const rows = [
      ['Customer', 'Amount'],
      ['one', '1'], ['two', '2'], ['one', '3'], ['two', '4'], ['already here', '5'],
      ['', ''], ['', 'not a number'], ['eight', '8'], ['nine', '9'], ['ten', '10'],
    ];
    const inferred = await planImport(store, 'Orders', rows);
    assert.equal(inferred.headerRow, true);
    const plan = replan(store, 'Orders', rows, {
      headerRow: true,
      columns: [{ column: 0, field: 'Customer' }, { column: 1, field: 'Amount' }],
      keys: ['Customer'],
    });
    const plain = applyImport(store, 'Orders', rows, plan, { skipDuplicates: false, skipIssues: true, account: 'Admin' });
    assert.equal(plain.imported, 8);
    assert.equal(plain.blankRows, 1);
    assert.equal(plain.headerRows, 1);
    assert.deepEqual(plain.skipped.map((row) => row.why), ['Amount: "not a number" isn\'t a number']);
    assert.equal(plain.imported + plain.skipped.length + (plain.blankRows ?? 0) + (plain.headerRows ?? 0), rows.length);
    undoImport(store, plain.id, {});

    const withRepeatFilter = applyImport(store, 'Orders', rows, plan, { skipDuplicates: true, skipIssues: true, account: 'Admin' });
    assert.equal(withRepeatFilter.imported, 5);
    assert.equal(withRepeatFilter.blankRows, 1);
    assert.equal(withRepeatFilter.headerRows, 1);
    assert.deepEqual(withRepeatFilter.skipped.map(({ row, why }) => [row, why]), [
      [4, 'same as row 2'], [5, 'same as row 3'], [6, 'same as record 1'], [8, 'Amount: "not a number" isn\'t a number'],
    ]);
    assert.equal(withRepeatFilter.imported + withRepeatFilter.skipped.length + (withRepeatFilter.blankRows ?? 0) + (withRepeatFilter.headerRows ?? 0), rows.length);

    const mapped = await importMappedRows(store, 'Orders', [['Customer', 'Amount'], ['mapped', '3']], ['Customer', 'Amount'], { skipFirst: true });
    assert.equal(mapped.imported, 1);
    assert.equal(mapped.headerRows, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
