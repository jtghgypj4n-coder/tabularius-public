import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import * as trace from '../src/trace.ts';

test('20k requested records sort by computed value within a read budget', (t) => {
  process.env.TABULARIUS_COUNT_SQL = '1';
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-calculated-sort-'));
  const path = join(dir, 'Generated.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'Computed', type: 'number', kind: 'calculation', calculation: 'Value * -2', options: { unstored: true } },
  ]);
  store.sql.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM n WHERE x < 20000)
    INSERT INTO T (_fm_record_id, _fm_mod_id, Value) SELECT x, 0, x FROM n`);
  const ids = store.findIds('T');
  const before = { statements: trace.statements, written: trace.rowsWritten, rss: process.memoryUsage().rss };
  const sorted = store.sortIds('T', ids, [{ fieldName: 'Computed', sortOrder: 'ascend' }]);
  assert.equal(sorted.length, 20_000);
  assert.equal(sorted[0], 20_000);
  assert.equal(sorted.at(-1), 1);
  assert.ok(trace.statements - before.statements < 60_000);
  assert.equal(trace.rowsWritten - before.written, 0);
  assert.ok(process.memoryUsage().rss - before.rss < 192 * 1024 * 1024);
  const blank = store.create('T', {}).recordId;
  const withBlank = store.sortIds('T', [...ids.slice(0, 3), blank], [{ fieldName: 'Computed', sortOrder: 'descend' }]);
  assert.deepEqual(withBlank, [1, 2, 3, blank]);
});

test('a computed sort orders like the stored one: empty values first when ascending, text by the field language', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-calculated-sort-parity-'));
  const path = join(dir, 'Parity.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Name' }] },
    { op: 'createField', table: 'T', name: 'Same', kind: 'calculation', calculation: 'Name', options: { unstored: true } },
  ]);
  const names = ['banana', 'Apple', '', 'cherry', 'apple', '_under', 'Zed'];
  const ids = names.map((name) => store.create('T', name ? { Name: name } : {}).recordId);
  for (const sortOrder of ['ascend', 'descend']) {
    const stored = store.sortIds('T', ids, [{ fieldName: 'Name', sortOrder }]);
    const computed = store.sortIds('T', ids, [{ fieldName: 'Same', sortOrder }]);
    assert.deepEqual(computed, stored, `${sortOrder} matches the stored order`);
  }
});

test('a computed sort leaves out records the account may not view', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-calculated-sort-view-'));
  const path = join(dir, 'View.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Owner' }, { name: 'Amount', type: 'number' }] },
    { op: 'createField', table: 'Items', name: 'Doubled', type: 'number', kind: 'calculation', calculation: 'Amount * 2', options: { unstored: true } },
  ]);
  const other = store.create('Items', { Owner: 'other', Amount: 1 }).recordId;
  const mine = store.create('Items', { Owner: 'reader', Amount: 2 }).recordId;
  store.savePrivilegeSet({ name: 'Restricted', records: { view: false, edit: false, create: false, delete: false },
    tables: { Items: { view: 'Owner = Get ( AccountName )', edit: false, create: false, delete: false } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] });
  store.setPassword('reader', 'synthetic-password', 'Restricted');
  assert.deepEqual(store.sortIds('Items', [other, mine], [{ fieldName: 'Doubled' }], { privileges: store.privileges('reader') }), [mine]);
  assert.deepEqual(store.sortIds('Items', [other, mine], [{ fieldName: 'Doubled' }]), [other, mine]);
});
