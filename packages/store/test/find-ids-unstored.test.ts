// findIds (a script's Perform Find, the Data API's found sets, summaries) on the table's own unstored calculations and
// globals matches and sorts on their computed values, as find does, not on whatever their columns hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('findIds finds and sorts on unstored calculations and globals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-find-ids-unstored-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'Shop');
    store.applyDesign([
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Item' }, { name: 'Total', type: 'number' }, { name: 'Region', options: { global: true } }] },
      { op: 'createField', table: 'Orders', name: 'Size', type: 'text', kind: 'calculation', calculation: 'If ( Total > 100 ; "big" ; "small" )', options: { unstored: true } },
      { op: 'createField', table: 'Orders', name: 'Rank', type: 'number', kind: 'calculation', calculation: '-Total', options: { unstored: true } },
    ] as never);
    const a = store.create('Orders', { Item: 'a', Total: '500' }).recordId;
    const b = store.create('Orders', { Item: 'b', Total: '5' }).recordId;
    const c = store.create('Orders', { Item: 'c', Total: '200' }).recordId;
    assert.deepEqual(store.findIds('Orders', { query: [{ Size: 'big' }], sort: [{ fieldName: 'Item', sortOrder: 'ascend' }] }), [a, c]);
    assert.deepEqual(store.findIds('Orders', { query: [{ Size: 'small' }] }), [b]);
    // Sorted on a computed value: by -Total, so the largest first.
    assert.deepEqual(store.findIds('Orders', { sort: [{ fieldName: 'Rank', sortOrder: 'ascend' }] }), [a, c, b]);
    store.setGlobalField('Orders::Region', 'North');
    assert.equal(store.findIds('Orders', { query: [{ Region: 'North' }] }).length, 3);
    // The same answers as find.
    assert.equal(store.find('Orders', { query: [{ Size: 'big' }] }).foundCount, 2);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
