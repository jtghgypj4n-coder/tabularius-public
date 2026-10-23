import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, findStaleCalcs, refreshStaleCalcs, staleRefreshHistory, undoStaleRefresh, Store } from '../src/index.ts';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-stale-'));
});
after(() => {
  if (dir) rmSync(dir, { recursive: true });
});

function shop(name: string): Store {
  const path = join(dir, `${name}.sqlite`);
  createStore(path);
  const store = new Store(path, name);
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }, { name: 'Modified', type: 'timestamp', options: { autoEnter: { value: 'modificationTimestamp' } } }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'OrderId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createField', table: 'Orders', name: 'Total', kind: 'calculation', type: 'number', calculation: 'ExecuteSQL ( "SELECT SUM(Amount) FROM Lines WHERE OrderId = ?" ; "" ; "" ; Id )' },
    { op: 'createField', table: 'Orders', name: 'Twice', kind: 'calculation', type: 'number', calculation: 'Id * 2' },
    { op: 'createField', table: 'Orders', name: 'Stamp', kind: 'calculation', type: 'text', calculation: 'Get ( CurrentTimestamp )' },
  ]);
  for (const [o, a] of [[1, 5], [2, 3]]) store.create('Lines', { OrderId: String(o), Amount: String(a) });
  store.create('Orders', { Id: '1' });
  store.create('Orders', { Id: '2' });
  store.create('Orders', { Id: '3' });
  return store;
}

const totals = (s: Store) => (s.sql.prepare('SELECT Id, Total FROM Orders ORDER BY Id').all() as { Id: number; Total: number | null }[]).map((r) => [r.Id, r.Total]);

test('finds stored calculations that fell behind other records, changing nothing', () => {
  const store = shop('Find');
  assert.equal(findStaleCalcs(store).stale, 0);
  // A line added later: FileMaker leaves the orders' stored totals as they were.
  store.create('Lines', { OrderId: '1', Amount: '7' });
  store.create('Lines', { OrderId: '3', Amount: '2' });
  // And as if FileMaker had stored something else for a formula of the record's own fields.
  store.sql.prepare('UPDATE Orders SET Twice = 5 WHERE Id = 2').run();
  const before = totals(store);
  const r = findStaleCalcs(store);
  assert.deepEqual(r.fields.map((f) => [f.field, f.cause, f.stale, f.wasEmpty, f.looked, f.records]), [
    ['Total', 'other records (ExecuteSQL)', 2, 1, 3, 3],
    ['Twice', 'this record only', 1, 0, 3, 3],
  ]);
  assert.equal(r.fields[0].recordIds.length, 2);
  assert.deepEqual(r.skipped.map((s) => s.field), ['Stamp']);
  assert.deepEqual(totals(store), before);
  assert.equal(store.sql.isTransaction, false);
  assert.deepEqual(findStaleCalcs(store, { fields: ['Twice'] }).fields.map((f) => f.field), ['Twice']);
  store.close();
});

test('refreshing brings chosen fields up to date, logged, and undo puts them back', () => {
  const store = shop('Refresh');
  store.create('Lines', { OrderId: '1', Amount: '7' });
  const stamp = (store.sql.prepare('SELECT Modified FROM Orders WHERE Id = 1').get() as { Modified: string }).Modified;
  const before = totals(store);
  assert.deepEqual(before, [[1, 5], [2, 3], [3, null]]);

  const batch = refreshStaleCalcs(store, { fields: [{ table: 'Orders', field: 'Total' }] }, { account: 'Admin' });
  assert.equal(batch.changes, 1);
  assert.deepEqual(batch.perField, [{ table: 'Orders', field: 'Total', refreshed: 1, failing: 0, skipped: 0 }]);
  assert.deepEqual(totals(store), [[1, 12], [2, 3], [3, null]]);
  // Nobody edited the order, so its modification timestamp stays.
  assert.equal((store.sql.prepare('SELECT Modified FROM Orders WHERE Id = 1').get() as { Modified: string }).Modified, stamp);
  const log = store.auditLog({ table: 'Orders', kind: 'update' });
  assert.deepEqual((log.at(-1)?.changes?.Total as unknown[]).map(Number), [5, 12]);
  assert.equal(log.at(-1)?.account, 'Admin');
  assert.equal(findStaleCalcs(store).stale, 0);

  assert.deepEqual(staleRefreshHistory(store).map((b) => b.id), [batch.id]);
  assert.deepEqual(undoStaleRefresh(store, batch.id, { account: 'Admin' }), { undone: 1, skipped: 0 });
  assert.deepEqual(totals(store), before);
  assert.ok(staleRefreshHistory(store)[0].undone);
  assert.throws(() => undoStaleRefresh(store, batch.id), /Already undone/);
  assert.throws(() => refreshStaleCalcs(store, { fields: [{ table: 'Orders', field: 'Stamp' }] }), /can't be refreshed: depends on the time/);
  assert.throws(() => refreshStaleCalcs(store, { fields: [{ table: 'Orders', field: 'Id' }] }), /not a stored calculation/);
  store.close();
});

test('undo leaves values that changed again since', () => {
  const store = shop('Again');
  store.create('Lines', { OrderId: '1', Amount: '7' });
  store.create('Lines', { OrderId: '2', Amount: '1' });
  const batch = refreshStaleCalcs(store, { fields: [{ table: 'Orders', field: 'Total', recordIds: [1, 2] }] });
  assert.equal(batch.changes, 2);
  store.sql.prepare('UPDATE Orders SET Total = 99 WHERE Id = 2').run();
  assert.deepEqual(undoStaleRefresh(store, batch.id), { undone: 1, skipped: 1 });
  assert.deepEqual(totals(store), [[1, 5], [2, 99], [3, null]]);
  store.close();
});

test('AR-store-core-06 refresh and undo markers roll back with values', () => {
  const store = shop('JournalFailure');
  try {
    store.sql.prepare('UPDATE Orders SET Twice = 4 WHERE Id = 3').run();
    staleRefreshHistory(store);
    const heard: string[] = [];
    store.listeners.add((change) => heard.push(change.kind));
    store.sql.exec("CREATE TRIGGER reject_refresh BEFORE INSERT ON _fm_calc_refresh BEGIN SELECT RAISE(ABORT, 'journal unavailable'); END");
    assert.throws(() => refreshStaleCalcs(store, { fields: [{ table: 'Orders', field: 'Twice', recordIds: [3] }] }), /journal unavailable/);
    assert.equal((store.sql.prepare('SELECT Twice FROM Orders WHERE Id = 3').get() as { Twice: number }).Twice, 4);
    assert.equal(staleRefreshHistory(store).length, 0);
    assert.deepEqual(heard, []);
    store.sql.exec('DROP TRIGGER reject_refresh');
    const batch = refreshStaleCalcs(store, { fields: [{ table: 'Orders', field: 'Twice', recordIds: [3] }] });
    assert.deepEqual(heard, ['update']);
    heard.length = 0;
    store.sql.exec("CREATE TRIGGER reject_undo BEFORE UPDATE OF undone ON _fm_calc_refresh BEGIN SELECT RAISE(ABORT, 'undo unavailable'); END");
    assert.throws(() => undoStaleRefresh(store, batch.id), /undo unavailable/);
    assert.equal((store.sql.prepare('SELECT Twice FROM Orders WHERE Id = 3').get() as { Twice: number }).Twice, 6);
    assert.equal(staleRefreshHistory(store)[0].undone, undefined);
    assert.deepEqual(heard, []);
  } finally { store.close(); }
});
