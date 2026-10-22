// Import Records into a native file's child table obeys its foreign key: a row whose key has no parent is skipped
// (the step reports error 505), rows with a parent's key or an empty key come in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, StepParams } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

test('Import Records skips rows whose foreign key has no parent and says error 505', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-fk-import-'));
  createStore(join(dir, 'S.sqlite'), { mode: 'native' });
  const store = new Store(join(dir, 'S.sqlite'), 'S');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'ID' }] },
      { op: 'createTable', name: 'Invoices', fields: [{ name: 'ID' }, { name: 'CustomerID' }] },
      { op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'ID' }],
        foreignKey: { name: 'invoice_customer', child: { table: 'Invoices', field: 'CustomerID' }, parent: { table: 'Customers', field: 'ID' } } },
    ]);
    store.create('Customers', { ID: 'c1' });
    writeFileSync(join(dir, 'in.csv'), 'i1,c1\r\ni2,c9\r\ni3,\r\n');
    const ref = (name: string) => ({ tableOccurrence: { id: 0, name: 'Invoices' }, field: { id: 0, name } });
    const r = await runScript(store, { id: 1, name: 'Import', steps: [
      { stepId: 35, name: 'Import Records', enabled: true, params: { filePaths: ['in.csv'], importFormat: 'COMS', importAction: 'add', fieldMapping: [{ field: ref('ID'), import: true }, { field: ref('CustomerID'), import: true }] } as StepParams },
    ] } as Script, { layout: 'Invoices', documents: dir });
    assert.equal(r.error, 505);
    assert.deepEqual(store.query('SELECT ID, CustomerID FROM "Invoices" ORDER BY _fm_record_id', 10).map((x) => [x.ID, x.CustomerID ?? '']), [['i1', 'c1'], ['i3', '']]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
