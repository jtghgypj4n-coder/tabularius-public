import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

for (const external of [false, true]) test(`fresh outside-portal and further-related repetitions retain masks, empty slots and record restrictions (${external ? 'cross-file' : 'local'})`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-refresh-related-'));
  const open = (name: string) => { const path = join(dir, name + '.sqlite'); createStore(path); return new Store(path, name); };
  const store = open('Main');
  const data = external ? open('Data') : store;
  const stores = [...new Set([store, data])];
  try {
    for (const s of stores) s.applyDesign([
      { op: 'createTable', name: 'Batches', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Batch', type: 'number' }, { name: 'Product', type: 'number' }, { name: 'Amount', type: 'number' }] },
      { op: 'createTable', name: 'Products', fields: [{ name: 'Id', type: 'number' }, { name: 'Secret', options: { repetitions: 3 } }] },
      { op: 'createRelationship', left: 'Batches', right: 'Orders', predicates: [{ left: 'Id', right: 'Batch' }] },
      { op: 'createRelationship', left: 'Orders', right: 'Products', predicates: [{ left: 'Product', right: 'Id' }] },
      { op: 'createField', table: 'Batches', name: 'Total', type: 'number', kind: 'calculation', calculation: 'Sum ( Orders::Amount )', options: { unstored: true } },
      { op: 'createField', table: 'Batches', name: 'Summary', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Total' } },
    ]);
    if (external) {
      store.applyDesign([{ op: 'createDataSource', name: 'Data', paths: ['file:Data'] }]);
      store.schema.tableOccurrences.find((o) => o.name === 'Products')!.dataSourceId = store.schema.dataSources[0].id;
      store.resolveFile = (name) => name === 'Data' ? data : undefined;
    }
    const batch = store.create('Batches', { Id: 1 }).recordId;
    store.create('Orders', { Batch: 1, Product: 1, Amount: 1 });
    store.create('Orders', { Batch: 1, Product: 2, Amount: 99 });
    data.create('Products', { Id: 1, Secret: '11112222', 'Secret(2)': '33334444' });
    data.create('Products', { Id: 2, Secret: '55556666', 'Secret(2)': '77778888', 'Secret(3)': '99990000' });
    const occ = (name: string) => store.schema.tableOccurrences.find((o) => o.name === name)!;
    const source = store.design('Products')!.objects.find((o) => o.kind === 'field' && o.field?.field === 'Secret')!;
    const secret: LayoutObject = { ...source, id: 901, name: 'relatedSecret', field: { ...source.field!, tableOccurrenceId: occ('Products').id, tableOccurrence: 'Products', repetitions: 3 } };
    const design = store.design('Batches')!;
    const portal: LayoutObject = { ...secret, id: 900, name: 'orders', kind: 'portal', field: undefined,
      portal: { tableOccurrenceId: occ('Orders').id, tableOccurrence: 'Orders', rows: 2, initialRow: 1 }, children: [{ ...secret, id: 902 }] };
    store.applyDesign([{ op: 'updateLayout', layout: 'Batches', design: { objects: [...design.objects, secret, portal] } }]);
    for (const s of stores) {
      s.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false },
        tables: { Products: { view: 'Id = 1', edit: false, create: false, delete: false, fields: { Secret: 'masked' }, masks: { Secret: { kind: 'last4' } } },
          Orders: { view: 'Amount < 10', edit: false, create: false, delete: false } },
        layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmapp'] } as never);
      s.setPassword('Reader', 'pw', 'Reader');
      s.shareResults();
    }
    const read = (limited = false) => store.get('Batches', batch, 'us', undefined, limited ? store.privileges('Reader') : undefined, { fresh: true });
    const full = read();
    assert.equal(full.fieldData['Products::Secret(2)'], '33334444');
    assert.equal(full.fieldData['Products::Secret(3)'], '');
    assert.equal(full.portalData!.orders[0]['Products::Secret(2)'], '33334444');
    assert.equal(full.fieldData.Summary, 100);
    const masked = read(true);
    assert.match(String(masked.fieldData['Products::Secret(2)']), /4444$/);
    assert.notEqual(masked.fieldData['Products::Secret(2)'], '33334444');
    assert.equal(masked.fieldData['Products::Secret(3)'], '');
    assert.equal(masked.portalData!.orders.length, 1);
    assert.equal(masked.portalData!.orders[0]['Products::Secret(2)'], masked.fieldData['Products::Secret(2)']);
    assert.equal(masked.fieldData.Summary, 1, 'privileged cached aggregates cannot leak to a limited account');
    assert.equal(read().fieldData.Summary, 100, 'limited cached aggregates cannot replace full-access results');
    // A relationship with no record clears every repetition, rather than leaving old values in a targeted patch.
    store.update('Orders', 1, { Product: 9 });
    const missing = read(true);
    for (const key of ['Products::Secret', 'Products::Secret(2)', 'Products::Secret(3)']) {
      assert.equal(missing.fieldData[key], '');
      assert.equal(missing.portalData!.orders[0][key], '');
    }
  } finally { for (const s of stores) s.close(); rmSync(dir, { recursive: true }); }
});
