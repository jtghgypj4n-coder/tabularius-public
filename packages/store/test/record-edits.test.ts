// A read may use one window's edits without writing them or changing its access rights.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-record-edits-'));
  const path = join(dir, 'R.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
    { name: 'Owner' }, { name: 'Amount', type: 'number' },
    { name: 'Parts', type: 'number', options: { repetitions: 3 } },
    { name: 'Stored', type: 'number', kind: 'calculation', calculation: 'Amount + Parts[2]', options: { evaluateWhenEmpty: true } },
    { name: 'Live', type: 'number', kind: 'calculation', calculation: 'Stored * 2', options: { unstored: true } },
  ] }]);
  const id = store.create('Items', { Owner: 'reader', Amount: 2 }).recordId;
  return { store, id };
}

test('reading edited repetitions recomputes dependent fields without writing data or metadata', (t) => {
  const { store, id } = setup(t);
  const info = store.layout('Items');
  const row = store.row(info, id);
  const meta = store.sql.prepare('SELECT * FROM _fm_meta ORDER BY key').all();
  const got = store.get(info, id, 'iso', undefined, undefined, { edits: { Amount: 5, 'Parts(2)': 8 } });
  assert.equal(got.fieldData.Stored, 13);
  assert.equal(got.fieldData.Live, 26);
  assert.equal(got.fieldData['Parts(2)'], 8);
  assert.equal(got.modId, Number(row._fm_mod_id));
  assert.deepEqual(store.row(info, id), row);
  assert.deepEqual(store.sql.prepare('SELECT * FROM _fm_meta ORDER BY key').all(), meta);
  assert.equal(store.get(info, id).fieldData.Live, 4);
});

test('pending edits cannot make a forbidden record viewable or expose masked inputs', (t) => {
  const { store, id } = setup(t);
  store.savePrivilegeSet({
    name: 'Limited', records: { view: 'Owner = Get ( AccountName )', edit: true, create: false, delete: false, fields: { Amount: 'masked' } },
    layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('reader', 'pw', 'Limited');
  const p = store.privileges('reader');
  const hidden = store.create('Items', { Owner: 'someone else', Amount: 99 }).recordId;
  assert.throws(() => store.get('Items', hidden, 'iso', undefined, p, { edits: { Owner: 'reader' } }), (e: unknown) => e instanceof StoreError && e.code === 200);
  const got = store.get('Items', id, 'iso', undefined, p, { edits: { Amount: 99, 'Parts(2)': 8 } });
  assert.equal(got.fieldData.Stored, 8, 'masked Amount contributes nothing');
  assert.equal(got.fieldData.Live, 16);
});

test('commit does not persist a calculation cached with masked inputs', (t) => {
  const { store, id } = setup(t);
  store.savePrivilegeSet({
    name: 'Limited', records: { view: 'Owner = Get ( AccountName )', edit: true, create: false, delete: false, fields: { Amount: 'masked' } },
    layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('reader', 'pw', 'Limited');
  const privileges = store.privileges('reader');
  const editKey = {};
  const edits = { 'Parts(2)': 8 };
  const opts = { edits, editKey, account: 'reader' };
  assert.equal(store.get('Items', id, 'iso', undefined, privileges, opts).fieldData.Stored, 8);
  assert.equal(store.get('Items', id, 'iso', undefined, privileges, opts).fieldData.Stored, 8);
  store.update('Items', id, edits, undefined, { editKey, account: 'reader', privileges });
  assert.equal(store.get('Items', id).fieldData.Stored, 10, 'stored results use full data at commit');
});
