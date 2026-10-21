// An account whose privilege set hides some related records never learns
// what they hold, however a value reaches it: evaluated formulas (hide
// conditions, tooltips), ValueListItems, portals (paging and counts), SQL
// over a calculation that reads another file, and summaries kept for one
// account and asked for by another with the same set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

const CLERK = (view: string) => ({
  name: 'Clerk', records: { view: true, edit: false, create: false, delete: false },
  tables: { Orders: { view, edit: false, create: false, delete: false } },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
});

function shop(fn: (store: Store, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-priv-everywhere-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createCustomFunction', name: 'Me', parameters: [], formula: 'Get ( AccountName )' },
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Total', type: 'number' }, { name: 'Owner', type: 'text' }] },
      { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
      { op: 'createField', table: 'Customers', name: 'Spent', type: 'number', kind: 'calculation', calculation: 'Sum ( Orders::Total )', options: { unstored: true } },
      { op: 'createField', table: 'Customers', name: 'sSpent', kind: 'summary', summary: { type: 'total', field: 'Spent' } },
      { op: 'createValueList', name: 'VL', field: { occurrence: 'Orders', field: 'Total' } },
      { op: 'createField', table: 'Customers', name: 'VLI', type: 'text', kind: 'calculation', calculation: 'ValueListItems ( "Shop" ; "VL" )', options: { unstored: true } },
    ] as never);
    store.create('Customers', { Id: '1' });
    for (const [t, o] of [['500', 'alice'], ['1', 'bob'], ['2', 'bob']]) store.create('Orders', { CustomerId: '1', Total: t, Owner: o });
    fn(store, dir);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('formulas evaluated for an account (hide conditions, tooltips) and ValueListItems see only what it may view', () => shop((store) => {
  store.savePrivilegeSet(CLERK('Total < 100') as never);
  store.setPassword('Clerk', 'pw', 'Clerk');
  const p = store.privileges('Clerk');
  const id = Number(store.find('Customers', { limit: 1 }).records[0].recordId);
  const each = store.evaluateEach('Customers', ['Sum ( Orders::Total )', 'Orders::Total', 'Spent'], id, { account: 'Clerk', privileges: p });
  assert.deepEqual(each.map((v) => v && Number(v.value)), [3, 1, 3]);
  assert.equal(store.evaluate('Customers', 'List ( Orders::Total )', id, { account: 'Clerk', privileges: p }).value, '1\r2');
  assert.equal(store.find('Customers', { limit: 1, privileges: p } as never).records[0].fieldData.VLI, '1\n2');
}));

test('two accounts with one set whose rule reads the account (through a custom function) each get their own totals', () => shop((store) => {
  store.savePrivilegeSet(CLERK('Owner = Me') as never);
  store.setPassword('alice', 'pw', 'Clerk');
  store.setPassword('bob', 'pw', 'Clerk');
  const read = (who: string) => store.find('Customers', { limit: 1, privileges: store.privileges(who) } as never).records[0].fieldData;
  assert.equal(read('alice').sSpent, 500);
  assert.equal(read('bob').sSpent, 3, 'never alice\'s total');
  assert.equal(read('bob').Spent, 3);
}));

test('a portal pages and counts only the related records the account may view', () => shop((store) => {
  const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
  const field = (f: string) => store.schema.tables.find((x) => x.name === 'Orders')!.fields.find((x) => x.name === f)!.id;
  const ref = (f: string) => ({ tableOccurrenceId: occ('Orders'), fieldId: field(f), tableOccurrence: 'Orders', field: f });
  const layout = store.design('Customers')!;
  const portal = {
    id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
    portal: { tableOccurrenceId: occ('Orders'), tableOccurrence: 'Orders', rows: 4, initialRow: 1 },
    children: [{ id: 901, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 202, left: 22, bottom: 222, right: 120 }, style: {}, field: { ...ref('Total'), display: 'edit', repetitions: 1 } }],
  };
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [...layout.objects, portal] } as never }]);
  store.savePrivilegeSet(CLERK('Total < 100') as never);
  store.setPassword('Clerk', 'pw', 'Clerk');
  const p = store.privileges('Clerk');
  const id = Number(store.find('Customers', { limit: 1 }).records[0].recordId);
  const page = (offset: number) => store.get('Customers', id, 'us', { Orders: { offset, limit: 1 } }, p).portalData!.Orders.map((r) => r['Orders::Total']);
  assert.deepEqual([page(1), page(2), page(3)], [[1], [2], []], 'no empty pages where hidden records sit');
  assert.deepEqual(store.portalCounts('Customers', id, p), { Orders: 2 });
  assert.deepEqual(store.portalCounts('Customers', id), { Orders: 3 });
  const read = store.get('Customers', id, 'us', undefined, p);
  store.update('Orders', 3, { Total: '500' });
  assert.deepEqual(store.portalCounts('Customers', id, p, read), { Orders: 1 }, 'cached portal counts cannot retain newly hidden related records');
}));

test('SQL over a calculation that reads another file leaves out what the account can\'t view there', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-priv-files-'));
  createStore(join(dir, 'B.sqlite'));
  const b = new Store(join(dir, 'B.sqlite'), 'B');
  createStore(join(dir, 'A.sqlite'));
  const a = new Store(join(dir, 'A.sqlite'), 'A');
  try {
    b.applyDesign([{ op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Total', type: 'number' }] }] as never);
    b.create('Orders', { CustomerId: '1', Total: '500' });
    b.create('Orders', { CustomerId: '1', Total: '1' });
    b.savePrivilegeSet(CLERK('Total < 100') as never);
    b.setPassword('u', 'pw', 'Clerk');
    const tbl = b.schema.tables.find((t) => t.name === 'Orders')!;
    a.resolveFile = (n) => (n.toLowerCase() === 'b' ? b : undefined);
    a.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createDataSource', name: 'B', paths: ['file:B'] },
      { op: 'createOccurrence', name: 'Orders_ext', file: 'B', externalTable: tbl.id },
    ] as never);
    const cid = a.schema.tables.find((t) => t.name === 'Customers')!.fields.find((f) => f.name === 'Id')!.id;
    a.applyDesign([
      { op: 'createRelationship', left: 'Customers', right: 'Orders_ext', predicates: [{ left: cid, right: tbl.fields.find((x) => x.name === 'CustomerId')!.id }] },
      { op: 'createField', table: 'Customers', name: 'Spent', type: 'number', kind: 'calculation', calculation: 'Sum ( Orders_ext::Total )', options: { unstored: true } },
      { op: 'createField', table: 'Customers', name: 'Sql', type: 'text', kind: 'calculation', calculation: 'ExecuteSQL ( "SELECT Spent FROM Customers" ; "" ; "" )', options: { unstored: true } },
    ] as never);
    a.create('Customers', { Id: '1' });
    a.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'] } as never);
    a.setPassword('u', 'pw', 'Reader');
    const full = a.find('Customers', { limit: 1 } as never).records[0].fieldData;
    const u = a.find('Customers', { limit: 1, privileges: a.privileges('u') } as never).records[0].fieldData;
    assert.deepEqual([full.Spent, full.Sql], [501, '501']);
    assert.deepEqual([u.Spent, u.Sql], [1, '1']);
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
