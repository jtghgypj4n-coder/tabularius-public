import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

function withStore(t: TestContext, fields: { name: string; type?: 'text' | 'number' | 'date' | 'time' | 'timestamp'; options?: { indexLanguage?: string; indexLanguageId?: number; repetitions?: number } }[]) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sort-collation-'));
  const path = join(dir, 'Sort.sqlite');
  createStore(path);
  const store = new Store(path, 'Sort');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields }]);
  return store;
}

function sorted(store: Store, fieldName: string, sortOrder = 'ascend'): string[] {
  const sort = [{ fieldName, sortOrder }];
  const records = store.find('Items', { sort }).records.map((r) => String(r.fieldData.Name));
  assert.deepEqual(store.sortIds('Items', store.findIds('Items'), sort).map((id) => String(store.get('Items', id).fieldData.Name)), records);
  return records;
}

test('English record sorts ignore leading symbols; mixed digits sort by character position', (t) => {
  const store = withStore(t, [{ name: 'Name' }, { name: 'Value' }]);
  for (const [Name, Value] of [['one', '1'], ['eleven', '11'], ['two', '2'], ['hash', '#2'], ['accent', 'Éclair'], ['case', 'eclair'], ['z', 'Zebra']]) {
    store.create('Items', { Name, Value });
  }
  assert.deepEqual(sorted(store, 'Value'), ['one', 'eleven', 'two', 'hash', 'accent', 'case', 'z']);
  store.applyDesign([{ op: 'createValueList', name: 'Last first', values: ['Zebra'] }]);
  assert.deepEqual(sorted(store, 'Value', 'Last first'), ['z', 'one', 'eleven', 'two', 'hash', 'accent', 'case']);
});

test('Unicode sort uses code point order and distinguishes case and accents', (t) => {
  const store = withStore(t, [{ name: 'Name' }, { name: 'Value', options: { indexLanguage: 'Unicode' } }]);
  for (const [Name, Value] of [['lower', 'a'], ['upper', 'A'], ['accent', 'á'], ['symbol', '#a'], ['digit', '2']]) {
    store.create('Items', { Name, Value });
  }
  assert.deepEqual(sorted(store, 'Value'), ['symbol', 'digit', 'upper', 'lower', 'accent']);
  store.applyDesign([{ op: 'createValueList', name: 'Values', values: ['a', 'A'] }]);
  assert.deepEqual(sorted(store, 'Value', 'Values'), ['lower', 'upper', 'symbol', 'digit', 'accent']);
});

test('an unmapped numeric file sort language is reported instead of silently using English', (t) => {
  const store = withStore(t, [{ name: 'Name' }, { name: 'Value', options: { indexLanguageId: 999 } }]);
  store.create('Items', { Name: 'one', Value: 'ä' });
  assert.throws(() => sorted(store, 'Value'), /FileMaker sort language ID 999 is not mapped/);
});

test('blank values sort first ascending and last descending', (t) => {
  const store = withStore(t, [{ name: 'Name' }, { name: 'Value' }]);
  for (const [Name, Value] of [['b', 'banana'], ['empty', ''], ['a', 'apple']]) store.create('Items', { Name, Value });
  assert.deepEqual(sorted(store, 'Value'), ['empty', 'a', 'b']);
  assert.deepEqual(sorted(store, 'Value', 'descend'), ['b', 'a', 'empty']);
});

test('dates, times and timestamps sort by their normalized chronology', (t) => {
  const store = withStore(t, [{ name: 'Name' }, { name: 'Date', type: 'date' }, { name: 'Time', type: 'time' }, { name: 'Stamp', type: 'timestamp' }]);
  for (const [Name, Date, Time, Stamp] of [
    ['late', '12/31/2026', '8:00 PM', '12/31/2026 8:00 PM'],
    ['early', '2/1/2026', '8:00 AM', '2/1/2026 8:00 AM'],
    ['middle', '10/1/2026', '12:00 PM', '10/1/2026 12:00 PM'],
  ]) store.create('Items', { Name, Date, Time, Stamp });
  for (const field of ['Date', 'Time', 'Stamp']) {
    assert.deepEqual(sorted(store, field), ['early', 'middle', 'late']);
    assert.deepEqual(sorted(store, field, 'descend'), ['late', 'middle', 'early']);
  }
});

test('repeating fields sort on the first repetition, including a blank first repetition and a custom list', (t) => {
  const store = withStore(t, [{ name: 'Name' }, { name: 'Value', options: { repetitions: 2 } }, { name: 'Score', type: 'number', options: { repetitions: 2 } }]);
  store.applyDesign([{ op: 'createValueList', name: 'Priority', values: ['High', 'Low'] }]);
  store.create('Items', { Name: 'low', Value: 'Low', 'Value(2)': 'High', Score: '2', 'Score(2)': '100' });
  store.create('Items', { Name: 'high', Value: 'High', 'Value(2)': 'Low', Score: '10', 'Score(2)': '0' });
  store.create('Items', { Name: 'blank', 'Value(2)': 'High', 'Score(2)': '50' });
  assert.deepEqual(sorted(store, 'Value'), ['blank', 'high', 'low']);
  assert.deepEqual(sorted(store, 'Value', 'Priority'), ['high', 'low', 'blank']);
  assert.deepEqual(sorted(store, 'Score'), ['blank', 'low', 'high']);
  assert.deepEqual(sorted(store, 'Score', 'descend'), ['high', 'low', 'blank']);
});
