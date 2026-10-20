// update_records: one set of fields on every record a find gives, all or none, previewable, counted and undoable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { undoCleanup, updateMany } from '../src/cleanup.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-update-records-'));
  createStore(join(dir, 'test.sqlite'));
  store = new Store(join(dir, 'test.sqlite'), 'Test');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
    { name: 'Name', type: 'text' },
    { name: 'Status', type: 'text' },
    { name: 'Qty', type: 'number', options: { validation: { type: 'number' } } },
  ] }] as never);
  for (const [name, status] of [['a', 'Open'], ['b', 'Open'], ['c', 'Closed'], ['d', 'Open']]) store.create('Items', { Name: name, Status: status });
});

after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const statuses = () => (store.sql.prepare('SELECT Status FROM Items ORDER BY _fm_record_id').all() as { Status: string }[]).map((r) => r.Status);
const open = [{ Status: '=Open' }];

test('a dry run says what would change and changes nothing', () => {
  const r = updateMany(store, { layout: 'Items', query: open, fieldData: { Status: 'Done' }, dryRun: true }, {});
  assert.equal(r.matched, 3);
  assert.equal(r.records, 3);
  assert.equal(r.total, 3);
  assert.deepEqual(r.changes.map((c) => [c.field, c.from, c.to]), [['Status', 'Open', 'Done'], ['Status', 'Open', 'Done'], ['Status', 'Open', 'Done']]);
  assert.deepEqual(statuses(), ['Open', 'Open', 'Closed', 'Open']);
});

test('expectCount refuses a find that gives a different number, and a change with no query needs it', () => {
  assert.throws(() => updateMany(store, { layout: 'Items', query: open, fieldData: { Status: 'Done' }, expectCount: 2 }, {}), /gives 3 records, not the 2 expected/);
  assert.throws(() => updateMany(store, { layout: 'Items', fieldData: { Status: 'Done' } }, {}), /expectCount/);
  assert.deepEqual(statuses(), ['Open', 'Open', 'Closed', 'Open']);
});

test('fields outside the layout\'s table, missing fields and an empty change are refused', () => {
  assert.throws(() => updateMany(store, { layout: 'Items', query: open, fieldData: { 'Other::Status': 'x' } }, {}), /not in this layout's own table/);
  assert.throws(() => updateMany(store, { layout: 'Items', query: open, fieldData: { Nope: 'x' } }, {}), /Field "Nope" is missing/);
  assert.throws(() => updateMany(store, { layout: 'Items', query: open, fieldData: {} }, {}), /Nothing to set/);
});

test('a record that refuses the value stops the whole change', () => {
  assert.throws(() => updateMany(store, { layout: 'Items', query: open, fieldData: { Qty: 'many' } }, {}), /nothing changed/);
  assert.deepEqual(store.sql.prepare('SELECT Qty FROM Items WHERE Qty IS NOT NULL AND Qty != \'\'').all(), []);
});

test('the change is made, counted, and undone as a batch', () => {
  const r = updateMany(store, { layout: 'Items', query: open, fieldData: { Status: 'Done' }, expectCount: 3 }, { account: 'Admin' });
  assert.equal(r.records, 3);
  assert.equal('id' in r && r.id.length > 0, true);
  assert.deepEqual(statuses(), ['Done', 'Done', 'Closed', 'Done']);

  // Records that already have the value are matched but not counted.
  const again = updateMany(store, { layout: 'Items', query: [{ Status: '=Done' }], fieldData: { Status: 'Done' } }, { account: 'Admin' });
  assert.equal(again.matched, 3);
  assert.equal(again.records, 0);

  const undone = undoCleanup(store, (r as { id: string }).id, {});
  assert.equal(undone.undone, 3);
  assert.deepEqual(statuses(), ['Open', 'Open', 'Closed', 'Open']);
});
