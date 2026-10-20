// Find criteria on a related unstored calculation or global ("Orders::Big") are matched on the computed value, as
// they are on the record's own fields, not on whatever the column holds; with other related criteria, the related
// record has to match them all; and a limited account's computed values leave out what it can't view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('finds on related unstored calculations and globals use their computed values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-find-related-unstored-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'Shop');
    store.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Total', type: 'number' }, { name: 'Status' }, { name: 'Region', options: { global: true } }] },
      { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
      { op: 'createField', table: 'Orders', name: 'Size', type: 'text', kind: 'calculation', calculation: 'If ( Total > 100 ; "big" ; "small" )', options: { unstored: true } },
    ] as never);
    store.create('Customers', { Id: '1', Name: 'Ann' });
    store.create('Customers', { Id: '2', Name: 'Bob' });
    store.create('Customers', { Id: '3', Name: 'Cy' });
    store.create('Orders', { CustomerId: '1', Total: '500', Status: 'open' });
    store.create('Orders', { CustomerId: '2', Total: '5', Status: 'open' });
    store.create('Orders', { CustomerId: '2', Total: '200', Status: 'shipped' });
    const names = (query: Record<string, string>[], privileges?: ReturnType<Store['privileges']>) =>
      store.find('Customers', { query, sort: [{ fieldName: 'Name', sortOrder: 'ascend' }], privileges } as never).records.map((r) => r.fieldData.Name);

    assert.deepEqual(names([{ 'Orders::Size': 'big' }]), ['Ann', 'Bob']);
    assert.deepEqual(names([{ 'Orders::Size': 'small' }]), ['Bob']);
    // One related record has to match every criterion on its occurrence: Bob's open order is small.
    assert.deepEqual(names([{ 'Orders::Size': 'big', 'Orders::Status': 'open' }]), ['Ann']);
    assert.deepEqual(names([{ 'Orders::Size': 'big' }, { 'Orders::Size': 'small', omit: 'true' }]), ['Ann']);
    // A global holds one value, this session's, for every record: every customer with an order matches.
    store.setGlobalField('Orders::Region', 'North');
    assert.deepEqual(names([{ 'Orders::Region': 'North' }]), ['Ann', 'Bob']);
    assert.deepEqual(names([{ 'Orders::Region': 'South' }]), []);

    // A limited account: related records it can't view never match, computed or not.
    store.savePrivilegeSet({
      name: 'Clerk', records: { view: true, edit: false, create: false, delete: false },
      tables: { Orders: { view: 'Total < 100', edit: false, create: false, delete: false } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
    } as never);
    store.setPassword('Clerk', 'clerk-pw-123', 'Clerk');
    const clerk = store.privileges('Clerk');
    assert.deepEqual(names([{ 'Orders::Size': 'big' }], clerk), []);
    assert.deepEqual(names([{ 'Orders::Size': 'small' }], clerk), ['Bob']);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
