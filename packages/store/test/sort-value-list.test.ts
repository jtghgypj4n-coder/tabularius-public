// Sorting in a custom order based on a value list, as FileMaker's Sort dialog
// and the Data API's sortOrder (a value list's name) do.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import type { FieldType } from '@tabularius/fmp12';

test('a sort can follow a value list: its values in order first, then the rest ascending', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tabularius-sortvl-')), 'Tasks.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Tasks');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Tasks', fields: [{ name: 'Name' }, { name: 'Priority' }] },
      { op: 'createValueList', name: 'Priorities', values: ['High', 'Medium', 'Low'] },
    ] as never);
    for (const [name, priority] of [['a', 'Low'], ['b', 'zzz'], ['c', 'high'], ['d', ''], ['e', 'Medium'], ['f', 'Another']]) store.create('Tasks', { Name: name, Priority: priority });
    const names = (sortOrder: string) => store.find('Tasks', { sort: [{ fieldName: 'Priority', sortOrder }] }).records.map((r) => r.fieldData.Name);
    assert.deepEqual(names('Priorities'), ['c', 'e', 'a', 'f', 'b', 'd']);
    assert.deepEqual(names('priorities'), ['c', 'e', 'a', 'f', 'b', 'd']);
    assert.deepEqual(names('ascend'), ['d', 'f', 'c', 'a', 'e', 'b']);
    assert.throws(() => names('No such list'), /missing/);
  } finally {
    store.close();
  }
});

function valuesStore(t: TestContext, type: FieldType, values: string[], rows: string[], japanese = false): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sort-values-'));
  const path = join(dir, 'Values.sqlite');
  createStore(path);
  const store = new Store(path, 'Values');
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true });
  });
  store.applyDesign([
    { op: 'createTable', name: 'Values', fields: [{ name: 'Name' }, { name: 'Value', type, ...(japanese ? { options: { indexLanguage: 'Japanese' } } : {}) }] },
    { op: 'createValueList', name: 'Order', values },
    { op: 'createValueList', name: 'Empty', values: [] },
  ]);
  for (const Value of rows) store.create('Values', { Name: Value, Value });
  return store;
}

const sortedNames = (store: Store, sortOrder = 'Order') => {
  const sort = [{ fieldName: 'Value', sortOrder }];
  const names = store.find('Values', { sort }).records.map((r) => r.fieldData.Name);
  assert.deepEqual(store.sortIds('Values', store.findIds('Values'), sort).map((id) => store.get('Values', id).fieldData.Name), names);
  return names;
};

test('custom number sorts match normalized numbers and retain the first equivalent entry', (t) => {
  const store = valuesStore(t, 'number', ['10.0', '2', '010'], ['2', '10']);
  assert.deepEqual(sortedNames(store), ['10', '2']);
  assert.deepEqual(sortedNames(store, 'ascend'), ['2', '10']);
  assert.deepEqual(sortedNames(store, 'descend'), ['10', '2']);
});

test('custom date sorts match displayed dates to ISO storage and deduplicate equivalent dates', (t) => {
  const store = valuesStore(t, 'date', ['12/31/2026', '1/1/2026', '2026-12-31'], ['1/1/2026', '12/31/2026']);
  assert.deepEqual(sortedNames(store), ['12/31/2026', '1/1/2026']);
  assert.deepEqual(sortedNames(store, 'ascend'), ['1/1/2026', '12/31/2026']);
});

test('custom text sorts use Unicode collation for matching and first-occurrence detection', (t) => {
  const store = valuesStore(t, 'text', ['Éclair', 'ΚΑΦΕ', 'zebra', 'éCLAIR', 'καφε'], ['zebra', 'éclair', 'ÉCLAIR', 'Banana', 'καφε', 'ΚΑΦΕ']);
  assert.deepEqual(sortedNames(store), ['éclair', 'ÉCLAIR', 'καφε', 'ΚΑΦΕ', 'zebra', 'Banana']);
});

test('unlisted numbers sort as formatted text, including when the list is empty', (t) => {
  const store = valuesStore(t, 'number', ['1'], ['2', '1', '10']);
  assert.deepEqual(sortedNames(store), ['1', '10', '2']);
  assert.deepEqual(sortedNames(store, 'Empty'), ['1', '10', '2']);
  assert.deepEqual(sortedNames(store, 'ascend'), ['1', '2', '10']);
  assert.deepEqual(sortedNames(store, 'descend'), ['10', '2', '1']);
});

test('unlisted dates sort alphabetically by formatted dates, including with an empty list', (t) => {
  const store = valuesStore(t, 'date', ['7/1/2026'], ['2/1/2026', '12/31/2026', '7/1/2026', '10/1/2026']);
  assert.deepEqual(sortedNames(store), ['7/1/2026', '10/1/2026', '12/31/2026', '2/1/2026']);
  assert.deepEqual(sortedNames(store, 'Empty'), ['10/1/2026', '12/31/2026', '2/1/2026', '7/1/2026']);
  assert.deepEqual(sortedNames(store, 'ascend'), ['2/1/2026', '7/1/2026', '10/1/2026', '12/31/2026']);
});

test('custom matching and unlisted fallback both use the field\'s Japanese collation', (t) => {
  const store = valuesStore(t, 'text', ['カキ', '自費', 'かき'], ['処方', 'かき', '自費', 'あいう'], true);
  assert.deepEqual(sortedNames(store), ['かき', '自費', 'あいう', '処方']);
  assert.deepEqual(sortedNames(store, 'Empty'), ['あいう', 'かき', '自費', '処方']);
});

test('the full list is ranked beyond 2000 entries and duplicates do not consume its capacity', (t) => {
  const values = [...Array<string>(2200).fill('First'), ...Array.from({ length: 3000 }, (_, i) => `v${String(2999 - i).padStart(4, '0')}`)];
  const store = valuesStore(t, 'text', values, ['v0001', 'Other', 'v2500', 'v2999', 'First']);
  assert.deepEqual(sortedNames(store), ['First', 'v2999', 'v2500', 'v0001', 'Other']);
  store.applyDesign([{ op: 'updateValueList', valueList: 'Order', values: ['v0001', 'v2500', 'v2999', 'First'] }]);
  assert.deepEqual(sortedNames(store), ['v0001', 'v2500', 'v2999', 'First', 'Other']);
});
