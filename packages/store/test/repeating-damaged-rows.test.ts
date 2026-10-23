// The list of repeating fields is read from the file's metadata. A row that is not a per-table list of names
// (a number, an object, text) reads as no list: creating in that table works and a field is not a repeating one
// because its name is part of some text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { nameLists } from '../src/own-keys.ts';

function damaged(row: unknown, run: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-repeating-rows-'));
  const path = join(dir, 'Test.sqlite');
  try {
    createStore(path);
    let store = new Store(path, 'Test');
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Note', type: 'text' }, { name: 'Other', type: 'text' }] }]);
    store.sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run('repeating', JSON.stringify(row));
    store.close();
    store = new Store(path, 'Test');
    try { run(store); } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a repeating row that is not a list of names for the table reads as none', () => {
  for (const row of [{ T: 7 }, { T: { Note: 1 } }, { T: 'Notes' }, { T: null }, null, 5, 'abc', ['T'], { T: [3, null, {}] }]) {
    damaged(row, (store) => {
      assert.equal(store.isRepeating('T', 'Note'), false, JSON.stringify(row));
      const id = store.create('T', { Note: 'a', Other: 'b' }).recordId;
      store.update('T', id, { Note: 'c' });
      assert.equal(store.get('T', id).fieldData.Note, 'c', JSON.stringify(row));
    });
  }
});

test('names in a repeating list are kept, and only the names', () => {
  damaged({ T: ['Note', 3, null, 'Other'] }, (store) => {
    assert.equal(store.isRepeating('T', 'Note'), true);
    assert.equal(store.isRepeating('T', 'Other'), true);
  });
  assert.deepEqual(nameLists(JSON.parse('{"__proto__":["A",1],"T":"x"}')), Object.assign(Object.create(null), { ['__proto__']: ['A'] }));
});
