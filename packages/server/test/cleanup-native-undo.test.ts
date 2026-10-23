import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../../store/src/index.ts';
import { applyCleanup, undoCleanup } from '../src/cleanup.ts';

function sales(t: { after: (fn: () => void) => void }): { store: Store; kept: number; removed: number; invoice: number } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cleanup-native-'));
  const path = join(dir, 'Sales.sqlite');
  createStore(path, { mode: 'native' });
  const store = new Store(path, 'Sales');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'ID' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'CustomerID' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Invoices', predicates: [{ left: 'ID', right: 'CustomerID' }],
      foreignKey: { name: 'invoice_customer', child: { table: 'Invoices', field: 'CustomerID' }, parent: { table: 'Customers', field: 'ID' }, onDelete: 'restrict' } },
  ]);
  const kept = store.create('Customers', { ID: 'c1', Name: 'Keep' }).recordId;
  const removed = store.create('Customers', { ID: 'c2', Name: 'Duplicate' }).recordId;
  store.create('Customers', { ID: 'c3', Name: 'Other' });
  const invoice = store.create('Invoices', { CustomerID: 'c2' }).recordId;
  return { store, kept, removed, invoice };
}

const customer = (store: Store, id: number) => store.sql.prepare('SELECT ID, Name, _fm_uuid FROM "Customers" WHERE _fm_record_id = ?').get(id) as
  { ID: string; Name: string; _fm_uuid: string } | undefined;
const invoiceKey = (store: Store, id: number) => (store.sql.prepare('SELECT CustomerID FROM "Invoices" WHERE _fm_record_id = ?').get(id) as
  { CustomerID: string }).CustomerID;

test('native merge undo restores the deleted parent and its related key', (t) => {
  const { store, kept, removed, invoice } = sales(t);
  const saved = customer(store, removed)!;
  const batch = applyCleanup(store, { layout: 'Customers', merges: [{ keep: kept, remove: [removed] }] }, {});
  assert.ok('id' in batch);
  assert.equal(batch.merged, 1);
  assert.equal(customer(store, removed), undefined);
  assert.equal(invoiceKey(store, invoice), 'c1');

  assert.deepEqual(undoCleanup(store, batch.id, {}), { undone: 2, skipped: [] });
  assert.deepEqual({ ...customer(store, removed) }, { ...saved });
  assert.equal(invoiceKey(store, invoice), 'c2');
});

test('native merge undo refuses a taken UUID as one unchanged batch and can be retried', (t) => {
  const { store, kept, removed, invoice } = sales(t);
  const saved = customer(store, removed)!;
  const batch = applyCleanup(store, { layout: 'Customers', merges: [{ keep: kept, remove: [removed] }] }, {});
  assert.ok('id' in batch);
  const replacement = store.create('Customers', { ID: 'c4', Name: 'Later' }).recordId;
  const replacementUuid = customer(store, replacement)!._fm_uuid;
  store.sql.prepare('UPDATE "Customers" SET _fm_uuid = ? WHERE _fm_record_id = ?').run(saved._fm_uuid, replacement);
  const audits = store.auditLog({ limit: 1000 }).length;

  assert.throws(() => undoCleanup(store, batch.id, {}), (e: unknown) => e instanceof StoreError && e.code === 504 && /Customers.*_fm_uuid/.test(e.message));
  assert.equal(customer(store, removed), undefined);
  assert.equal(invoiceKey(store, invoice), 'c1');
  assert.equal(store.auditLog({ limit: 1000 }).length, audits);

  store.sql.prepare('UPDATE "Customers" SET _fm_uuid = ? WHERE _fm_record_id = ?').run(replacementUuid, replacement);
  assert.deepEqual(undoCleanup(store, batch.id, {}), { undone: 2, skipped: [] });
  assert.deepEqual({ ...customer(store, removed) }, { ...saved });
  assert.equal(invoiceKey(store, invoice), 'c2');
});
