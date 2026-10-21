import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../src/index.ts';

// A large sorted found set keeps its order between pages (the sort reads every record once); a change to the data
// works it out again, so a page never shows the order from before an edit.
test('pages of a large sorted found set match the sort, and follow edits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sorted-'));
  try {
    const path = join(dir, 'S.sqlite');
    createStore(path);
    const s = new Store(path, 'S');
    s.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'N', type: 'number' }] }] as never);
    const names = ['delta', 'Alpha', 'charlie', 'Bravo', 'echo'];
    for (let i = 0; i < 2600; i++) s.create('People', { Name: `${names[i % 5]} ${String(2600 - i).padStart(4, '0')}`, N: (i * 37) % 101 });
    const sort = [{ fieldName: 'Name', sortOrder: 'ascend' }];
    const all = s.find('People', { sort, limit: 3000 }).records.map((r) => r.fieldData.Name);
    assert.equal(all.length, 2600);
    // Page by page, the same order as one read of everything.
    const paged: unknown[] = [];
    for (let offset = 1; offset <= 2600; offset += 500) paged.push(...s.find('People', { sort, offset, limit: 500 }).records.map((r) => r.fieldData.Name));
    assert.deepEqual(paged, all);
    assert.match(String(all[0]), /^Alpha/);
    // Two keys, one descending.
    const two = [{ fieldName: 'N', sortOrder: 'descend' }, { fieldName: 'Name', sortOrder: 'ascend' }];
    const first = s.find('People', { sort: two, offset: 1, limit: 3 }).records.map((r) => r.fieldData.N);
    assert.deepEqual(first, [100, 100, 100]);
    // An edit moves a record: the next page knows.
    const last = s.find('People', { sort, offset: 2600, limit: 1 }).records[0];
    s.update('People', last.recordId, { Name: '0 first now' });
    assert.equal(s.find('People', { sort, offset: 1, limit: 1 }).records[0].recordId, last.recordId);
    s.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('AR-store-core-08: computed sort uses current global values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-computed-sort-'));
  const path = join(dir, 'S.sqlite');
  try {
    createStore(path);
    const setup = new Store(path, 'S');
    setup.applyDesign([
      { op: 'createTable', name: 'T', fields: [
        { name: 'N', type: 'number' }, { name: 'Direction', type: 'number', options: { global: true } },
        { name: 'Order', type: 'number', kind: 'calculation', calculation: 'N * Direction', options: { unstored: true } },
      ] },
      { op: 'createTable', name: 'U', fields: [
        { name: 'N', type: 'number' },
        { name: 'Order', type: 'number', kind: 'calculation', calculation: '-N', options: { unstored: true } },
      ] },
    ] as never);
    setup.close();
    const db = new DatabaseSync(path);
    db.exec('BEGIN');
    const insertT = db.prepare('INSERT INTO T (N) VALUES (?)');
    const insertU = db.prepare('INSERT INTO U (N) VALUES (?)');
    for (let i = 1; i <= 2000; i++) { insertT.run(i); insertU.run(i); }
    db.exec('COMMIT');
    db.close();
    const store = new Store(path, 'S');
    try {
      const sort = [{ fieldName: 'Order', sortOrder: 'ascend' }];
      const first = () => store.find('T', { sort, limit: 2 }).records.map((r) => r.recordId);
      store.setGlobalField('T::Direction', '1');
      assert.deepEqual(first(), [1, 2]);
      assert.deepEqual(store.find('U', { sort, limit: 2 }).records.map((r) => r.recordId), [2000, 1999]);
      store.setGlobalField('T::Direction', '-1');
      assert.deepEqual(first(), [2000, 1999]);
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AR-store-core-09: sorted pages preserve ids across signed 32-bit boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-large-ids-'));
  const path = join(dir, 'S.sqlite');
  try {
    createStore(path);
    const setup = new Store(path, 'S');
    setup.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name' }] }]);
    setup.close();
    const db = new DatabaseSync(path);
    db.exec('BEGIN');
    const insert = db.prepare('INSERT INTO T (_fm_record_id, Name) VALUES (?, ?)');
    const start = 2 ** 31 - 1000;
    for (let i = 0; i < 2000; i++) insert.run(start + i, String(i).padStart(4, '0'));
    db.exec('COMMIT');
    db.close();
    const store = new Store(path, 'S');
    try {
      const sort = [{ fieldName: 'Name', sortOrder: 'ascend' }];
      assert.deepEqual(store.find('T', { sort, limit: 5 }).records.map((r) => r.recordId),
        Array.from({ length: 5 }, (_, i) => start + i));
      const result = store.find('T', { sort, limit: 5, offset: 1001 });
      assert.equal(result.foundCount, 2000);
      assert.deepEqual(result.records.map((r) => r.recordId), Array.from({ length: 5 }, (_, i) => 2 ** 31 + i));
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
