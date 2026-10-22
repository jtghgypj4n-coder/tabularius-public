// The design API (and get_design, which reads the same summary) lists a native file's foreign keys with their
// relationships; GetTableDDL in a calculation writes them as named constraints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { designOf } from '../src/design.ts';

test('the design summary lists a relationship\'s foreign key, and GetTableDDL names it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-fk-design-'));
  try {
    createStore(join(dir, 'Sales.sqlite'), { mode: 'native' });
    const store = new Store(join(dir, 'Sales.sqlite'), 'Sales');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'Customers', fields: [{ name: 'ID' }] },
        { op: 'createTable', name: 'Invoices', fields: [{ name: 'CustomerID' }] },
        { op: 'createRelationship', left: 'Customers', right: 'Invoices', predicates: [{ left: 'ID', right: 'CustomerID' }],
          foreignKey: { name: 'invoice_customer', child: { table: 'Invoices', field: 'CustomerID' }, parent: { table: 'Customers', field: 'ID' }, onDelete: 'set-null' } },
      ]);
      const rel = designOf(store).relationships[0];
      assert.deepEqual(rel.foreignKey, { name: 'invoice_customer', child: 'right', childTableId: rel.foreignKey!.childTableId, childFieldId: 1, parentTableId: rel.foreignKey!.parentTableId, parentFieldId: 1, onDelete: 'set-null' });
      store.create('Customers', { ID: 'c1' });
      const id = store.create('Invoices', { CustomerID: 'c1' }).recordId;
      assert.match(String(store.evaluate('Invoices', 'GetTableDDL ( List ( "Invoices" ; "Customers" ) ; False )', id).value),
        /CONSTRAINT "invoice_customer" FOREIGN KEY \("CustomerID"\) REFERENCES "Customers" \("ID"\) ON DELETE SET NULL/);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
