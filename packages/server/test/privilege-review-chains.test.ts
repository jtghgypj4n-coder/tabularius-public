// The privilege review follows a calculation through a summary field, and a long chain of calculations or custom
// functions costs one walk of the chain per field, not a parse of it per field and privilege set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { reviewPrivileges } from '../src/privilege-review.ts';

function shop(t: { after: (f: () => void) => void }): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tab-privrev-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => store.close());
  return store;
}

const none = { view: false, edit: false, create: false, delete: false };
const viewable = { view: true, edit: false, create: false, delete: false };
const setOf = (store: Store, tables: string[]) => store.savePrivilegeSet({
  name: 'Sales', records: none, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
  tables: Object.fromEntries(tables.map((n) => [n, viewable])),
} as never);

test('a calculation that reads a summary field over a calculation that reads a hidden table is found', (t) => {
  const store = shop(t);
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }] },
    { op: 'createTable', name: 'Secrets', fields: [{ name: 'OrderId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Secrets', predicates: [{ left: 'CustomerId', right: 'OrderId' }] },
    { op: 'createField', table: 'Orders', name: 'Hidden', type: 'number', kind: 'calculation', calculation: 'Secrets::Amount', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'Total', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Hidden' } },
    { op: 'createField', table: 'Customers', name: 'Leak', type: 'number', kind: 'calculation', calculation: 'Orders::Total', options: { unstored: true } },
    { op: 'createField', table: 'Customers', name: 'Fine', type: 'number', kind: 'calculation', calculation: 'Id + 1', options: { unstored: true } },
  ] as never);
  setOf(store, ['Customers', 'Orders']);
  const found = reviewPrivileges(store).findings.filter((f) => f.kind === 'calc-reads-hidden' && f.table === 'Customers').map((f) => f.field);
  assert.deepEqual(found, ['Leak']);
});

test('a thousand chained calculations and a three-hundred-function chain are reviewed in a moment', (t) => {
  const store = shop(t);
  const ops: unknown[] = [
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Secrets', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Secrets', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createCustomFunction', name: 'F0', parameters: ['x'], formula: 'Secrets::Amount + x' },
  ];
  for (let i = 1; i < 300; i++) ops.push({ op: 'createCustomFunction', name: `F${i}`, parameters: ['x'], formula: `F${i - 1} ( x ) + 1` });
  ops.push({ op: 'createField', table: 'Customers', name: 'C0', type: 'number', kind: 'calculation', calculation: 'F299 ( Id )', options: { unstored: true } });
  for (let i = 1; i < 1000; i++) ops.push({ op: 'createField', table: 'Customers', name: `C${i}`, type: 'number', kind: 'calculation', calculation: `C${i - 1} + 1`, options: { unstored: true } });
  store.applyDesign(ops as never);
  setOf(store, ['Customers']);
  const started = Date.now();
  const found = reviewPrivileges(store).findings.filter((f) => f.kind === 'calc-reads-hidden');
  const took = Date.now() - started;
  assert.equal(found.length, 1000);
  assert.ok(took < 3000, `the review took ${took} ms`);
});
