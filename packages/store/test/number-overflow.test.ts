// A number too big to be one ("1e999") used to reach SQLite's number column as text and come out as Infinity,
// which exports print as "Infinity" and the Data API shows as null. It is refused now, as a value that isn't a number is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-number-overflow-'));
  const path = join(dir, 'Num.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Age', type: 'number' }, { name: 'Note' }] }]);
  return store;
}
const stored = (store: Store, id: number) => ({ ...(store.query(`SELECT Age, typeof(Age) AS t FROM People WHERE _fm_record_id = ${id}`, 1)[0] as { Age: unknown; t: string }) });

test('a number field refuses a value too large to be a number, on create and on update', (t) => {
  const store = fixture(t);
  for (const v of ['1e999', '-1e999', '1e309', '+9e999', '1,0e999']) {
    assert.throws(() => store.create('People', { Age: v }), (e: unknown) => e instanceof StoreError && e.code === 502 && /too large to be a number/.test(e.message), v);
  }
  const ok = store.create('People', { Age: '12' }).recordId;
  assert.throws(() => store.update('People', ok, { Age: '1e999' }), (e: unknown) => e instanceof StoreError && e.code === 502);
  assert.deepEqual(stored(store, ok), { Age: 12, t: 'real' }, 'the record is as it was');
  assert.equal(store.query('SELECT count(*) AS n FROM People', 1)[0].n, 1, 'nothing was made by the refused creates');
});

test('values that are numbers, or never were, are as before', (t) => {
  const store = fixture(t);
  const cases: [string, unknown, string][] = [
    ['1e308', 1e308, 'real'], ['1,5', 15, 'real'], [' 7 ', 7, 'real'], ['1e-999', 0, 'real'], ['-0.5', -0.5, 'real'],
    ['12x', '12x', 'text'], ['Infinity', 'Infinity', 'text'], ['NaN', 'NaN', 'text'],
  ];
  for (const [input, value, type] of cases) {
    const id = store.create('People', { Age: input }).recordId;
    assert.deepEqual(stored(store, id), { Age: value, t: type }, input);
  }
  // A text field is not a number field.
  assert.doesNotThrow(() => store.create('People', { Note: '1e999' }));
});
