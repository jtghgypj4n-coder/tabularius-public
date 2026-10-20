// The triggers that move a file's data version are named after the table's id. A table created with the id of a trashed table
// found the trashed table's triggers under those names and got none of its own, so its writes left the version unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('a table created with the id of a trashed table still moves the write token', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-trigger-id-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'a.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => store.close());
  store.applyDesign([{ op: 'createTable', name: 'Old', fields: [{ name: 'Note' }] }]);
  const id = store.schema.tables.find((x) => x.name === 'Old')!.id;
  store.applyDesign([{ op: 'deleteTable', table: id }]);
  store.applyDesign([{ op: 'createTable', name: 'Keys', id, fields: [{ name: 'Password' }] } as never]);
  const before = store.writeToken();
  store.create('Keys', { Password: 'x' });
  assert.notEqual(store.writeToken(), before, 'a record created in the new table moves the token');
  const mid = store.writeToken();
  store.update('Keys', Number(store.select('SELECT _fm_record_id AS id FROM Keys').rows[0][0]), { Password: 'y' });
  assert.notEqual(store.writeToken(), mid, 'and so does an update');
});
