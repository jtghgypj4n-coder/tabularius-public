// A limited account never sees, through a total over related records or a
// summary field over such totals, the related records it can't view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('totals and summaries over related records leave out the ones the account can\'t view', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-private-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'Shop');
    store.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Total', type: 'number' }] },
      { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
      { op: 'createField', table: 'Customers', name: 'Spent', type: 'number', kind: 'calculation', calculation: 'Sum ( Orders::Total )', options: { unstored: true } },
      { op: 'createField', table: 'Customers', name: 'sSpent', kind: 'summary', summary: { type: 'total', field: 'Spent' } },
      { op: 'createField', table: 'Customers', name: 'Sql', type: 'number', kind: 'calculation', calculation: 'ExecuteSQL ( "SELECT Spent FROM Customers" ; "" ; "" )', options: { unstored: true } },
      { op: 'createField', table: 'Orders', name: 'sTotal', kind: 'summary', summary: { type: 'total', field: 'Total' } },
      { op: 'createField', table: 'Orders', name: 'All', type: 'number', kind: 'calculation', calculation: 'sTotal', options: { unstored: true } },
    ] as never);
    store.create('Customers', { Id: '1' });
    store.create('Orders', { CustomerId: '1', Total: '1' });
    store.create('Orders', { CustomerId: '1', Total: '500' });
    store.savePrivilegeSet({
      name: 'Clerk',
      records: { view: true, edit: false, create: false, delete: false },
      tables: { Orders: { view: 'Total < 100', edit: false, create: false, delete: false } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
    } as never);
    store.setPassword('Clerk', 'pw', 'Clerk');
    const read = (p?: ReturnType<Store['privileges']>) => store.find('Customers', { limit: 1, privileges: p } as never).records[0].fieldData;
    assert.deepEqual([read().Spent, read().sSpent], [501, 501]);
    const clerk = read(store.privileges('Clerk'));
    assert.equal(clerk.Spent, 1, 'the order it can\'t view is left out');
    assert.equal(clerk.sSpent, 1, 'and from the summary over it');
    assert.equal(read().sSpent, 501);
    const p = store.privileges('Clerk');
    // Nor through SQL over a calculation, a summary inside a calculation, a find or sort, or sub-summaries.
    assert.equal(clerk.Sql, '1');
    assert.equal(read().Sql, '501');
    const order = store.find('Orders', { limit: 1, privileges: p } as never).records[0].fieldData;
    assert.equal(order.sTotal, 1);
    assert.equal(order.All, 1);
    assert.equal(store.find('Customers', { query: [{ Spent: '>100' }], privileges: p } as never).foundCount, 0);
    assert.equal(store.find('Customers', { query: [{ Spent: '>100' }] } as never).foundCount, 1);
    const groups = store.groupSummaries('Customers', store.findIds('Customers', { privileges: p } as never), ['Id'], 'us', p);
    assert.ok(!JSON.stringify(groups).includes('501'), JSON.stringify(groups));
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
