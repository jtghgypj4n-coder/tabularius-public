import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, writer } from '../src/index.ts';

test('refresh previews, lookup eviction and create statements stay isolated between stores with the same name and schema ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-refresh-isolation-'));
  const stores: Store[] = [];
  try {
    for (const file of ['first.sqlite', 'second.sqlite']) {
      const path = join(dir, file);
      createStore(path);
      const store = new Store(path, 'Data');
      stores.push(store);
      store.applyDesign([
        { op: 'createTable', name: 'Invoices', fields: [{ name: 'Amount', type: 'number' }, { name: 'Key', type: 'number' }] },
        { op: 'createTable', name: 'Rates', fields: [{ name: 'Key', type: 'number' }, { name: 'Factor', type: 'number' }] },
        { op: 'createRelationship', left: 'Invoices', right: 'Rates', predicates: [{ left: 'Key', right: 'Key' }] },
        { op: 'createField', table: 'Invoices', name: 'Due', type: 'number', kind: 'calculation', calculation: 'Amount * Rates::Factor', options: { unstored: true } },
        { op: 'createField', table: 'Invoices', name: 'Sum', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Due' } },
      ]);
      store.shareResults();
    }
    const [first, second] = stores;
    first.create('Rates', { Key: 1, Factor: 2 });
    second.create('Rates', { Key: 1, Factor: 3 });
    const a = first.create('Invoices', { Key: 1, Amount: 4 }).recordId;
    const b = second.create('Invoices', { Key: 1, Amount: 10 }).recordId;
    assert.equal(a, b);
    assert.deepEqual(first.schema.tables.map((t) => t.id), second.schema.tables.map((t) => t.id));
    const read = (store: Store, id: number) => store.get('Invoices', id, 'us', undefined, undefined, { fresh: true }).fieldData;
    assert.equal(read(first, a).Sum, 8);
    assert.equal(read(second, b).Sum, 30);
    const stamps = stores.map((s) => s.dataStamp());
    const row = first.previewRow(first.layout('Invoices'), a, { Amount: 7 });
    assert.equal(first.get('Invoices', a, 'us', undefined, undefined, { fresh: true, row }).fieldData.Sum, 14);
    assert.deepEqual(first.evaluate('Invoices', 'Due', a, { row }), { value: '14', type: 'number' });
    assert.equal(first.evaluateEach('Invoices', ['Due'], a, { row })[0]?.value, 14);
    assert.equal(first.getMany('Invoices', [a], [a], { fresh: true, rows: new Map([[a, row]]) })[0].fieldData.Sum, 14);
    first.flushJoinResults();
    assert.deepEqual(stores.map((s) => s.dataStamp()), stamps);
    assert.equal(read(first, a).Sum, 8);
    assert.equal(read(second, b).Sum, 30);
    // An unrelated store's schema changes and cache resets cannot remove this store's table or redirect its writes.
    second.applyDesign([{ op: 'deleteTable', table: 'Invoices' }]);
    const next = first.create('Invoices', { Key: 1, Amount: 5 }).recordId;
    first.update('Invoices', next, { Amount: 6 });
    assert.equal(read(first, next).Due, 12);
    assert.equal(read(first, next).Sum, 20);
    assert.equal(second.sql.prepare("SELECT name FROM sqlite_master WHERE name = 'Invoices'").get(), undefined);
  } finally {
    for (const store of stores) store.close();
    rmSync(dir, { recursive: true });
  }
});

test('fresh reads suppress stale summary/ExecuteSQL stand-ins while retaining valid shared results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-refresh-read-'));
  const path = join(dir, 'Data.sqlite');
  createStore(path);
  const reader = new Store(path, 'Data');
  reader.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Amount', type: 'number' }, { name: 'Key', type: 'number' }] },
    { op: 'createTable', name: 'Rates', fields: [{ name: 'Key', type: 'number' }, { name: 'Factor', type: 'number' }] },
    { op: 'createRelationship', left: 'Items', right: 'Rates', predicates: [{ left: 'Key', right: 'Key' }] },
    { op: 'createField', table: 'Items', name: 'Due', type: 'number', kind: 'calculation', calculation: 'Amount * Rates::Factor', options: { unstored: true } },
    { op: 'createField', table: 'Items', name: 'Sum', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Due' } },
    { op: 'createField', table: 'Items', name: 'SQL', type: 'number', kind: 'calculation', calculation: 'ExecuteSQL ( "SELECT SUM(Amount) FROM Items" ; "" ; "" )', options: { unstored: true } },
  ]);
  reader.create('Rates', { Key: 1, Factor: 2 });
  const id = reader.create('Items', { Amount: 4, Key: 1 }).recordId;
  reader.setPassword('Reader', 'pw', '[Full Access]');
  const p = reader.privileges('Reader');
  const other = new Store(path, 'Data');
  reader.shareResults(); other.shareResults();
  try {
    const read = (fresh = false) => reader.get('Items', id, 'us', undefined, p, { fresh });
    assert.equal(read().fieldData.Sum, 8);
    assert.equal(Number(read().fieldData.SQL), 4);
    writer.run({ account: 'Writer' }, () => other.update('Items', id, { Amount: 9 }));
    const ordinary = read();
    assert.equal(ordinary.fieldData.Sum, 8);
    assert.equal(Number(ordinary.fieldData.SQL), 4);
    assert.ok(ordinary.updating?.includes('Sum'));
    const fresh = read(true);
    assert.equal(fresh.fieldData.Sum, 18);
    assert.equal(Number(fresh.fieldData.SQL), 9);
    assert.equal(fresh.updating, undefined);
    assert.equal(read().fieldData.Sum, 18);
    const stamp = reader.dataStamp();
    assert.equal(Number(reader.getMany('Items', [id], [id], { privileges: p, fresh: true })[0].fieldData.SQL), 9);
    assert.equal(reader.dataStamp(), stamp);
  } finally { other.close(); reader.close(); rmSync(dir, { recursive: true }); }
});

test('Let assignments override inherited variables consistently in evaluate, evaluateEach and evaluateRows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-refresh-let-'));
  const path = join(dir, 'Data.sqlite');
  createStore(path);
  const store = new Store(path, 'Data');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Key', type: 'number' }] }]);
    const id = store.create('Items', { Key: 1 }).recordId;
    const opts = { variable: () => ({ type: 'number' as const, value: 1 }) };
    for (const formula of ['Let ( $x = 2 ; $x )', 'Let ( $$x = 2 ; $$x )', 'Let ( $x[2] = 2 ; $x[2] )']) {
      assert.equal(store.evaluate('Items', formula, id, opts).value, '2');
      assert.equal(store.evaluateEach('Items', [formula], id, opts)[0]?.value, 2);
      assert.equal(store.evaluateRows('Items', [formula], { ids: [id] }, opts)[0][0]?.value, 2);
    }
    assert.equal(store.evaluateEach('Items', ['$x'], id, opts)[0]?.value, 1, 'assignments do not escape an evaluation');
    assert.equal(store.evaluateRows('Items', ['$x'], { ids: [id] }, opts)[0][0]?.value, 1);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('preview chart rows and grouped summaries see pending values without changing persisted rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-refresh-chart-'));
  const path = join(dir, 'Data.sqlite');
  createStore(path);
  const store = new Store(path, 'Data');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Category' }, { name: 'Amount', type: 'number' }] },
      { op: 'createField', table: 'Items', name: 'Sum', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
    ]);
    const a = store.create('Items', { Category: 'A', Amount: 1 }).recordId;
    const b = store.create('Items', { Category: 'A', Amount: 2 }).recordId;
    const rows = new Map([[a, store.previewRow(store.layout('Items'), a, { Amount: 9 })]]);
    const values = (preview = false, groupBy?: number) => store.evaluateRows('Items', ['Category', 'Amount', 'Sum', 'Let ( $x = 2 ; $x )'], { ids: [a, b], groupBy }, { rows: preview ? rows : undefined, variable: () => ({ type: 'number', value: 1 }) }).map((r) => r.map((v) => v?.value));
    assert.deepEqual(values(true), [['A', 9, 11, 2], ['A', 2, 11, 2]]);
    assert.deepEqual(values(true, 0), [['A', 9, 11, 2]]);
    assert.deepEqual(values(), [['A', 1, 3, 2], ['A', 2, 3, 2]]);
    assert.equal(store.get('Items', a).fieldData.Amount, 1);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('ordinary repeating field create/update preserves other repetitions and supports clearing a cell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-refresh-repetition-write-'));
  const path = join(dir, 'Data.sqlite');
  createStore(path);
  const store = new Store(path, 'Data');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Repeated', options: { repetitions: 3 } }] }]);
    const array = store.create('Items', { Repeated: JSON.stringify(['first', 'second', 'third']) }).recordId;
    assert.deepEqual(store.get('Items', array).fieldData, { Repeated: 'first', 'Repeated(2)': 'second', 'Repeated(3)': 'third' });
    store.update('Items', array, { 'Repeated(2)': 'updated' });
    assert.deepEqual(store.get('Items', array).fieldData, { Repeated: 'first', 'Repeated(2)': 'updated', 'Repeated(3)': 'third' });
    const id = store.create('Items', { Repeated: 'one', 'Repeated(2)': 'two', 'Repeated(3)': 'three' }).recordId;
    const read = () => store.get('Items', id).fieldData;
    assert.deepEqual(read(), { Repeated: 'one', 'Repeated(2)': 'two', 'Repeated(3)': 'three' });
    store.update('Items', id, { Repeated: 'new one' });
    assert.deepEqual(read(), { Repeated: 'new one', 'Repeated(2)': 'two', 'Repeated(3)': 'three' });
    store.update('Items', id, { 'Repeated(2)': '' });
    assert.deepEqual(read(), { Repeated: 'new one', 'Repeated(2)': '', 'Repeated(3)': 'three' });
    store.update('Items', id, { 'Repeated(1)': '["literal"]' });
    assert.deepEqual(read(), { Repeated: '["literal"]', 'Repeated(2)': '', 'Repeated(3)': 'three' });
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
