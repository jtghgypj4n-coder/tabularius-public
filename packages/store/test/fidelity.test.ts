import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calcFidelity, createStore, differenceKind, queryShape, Store } from '../src/index.ts';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-fidelity-'));
});
after(() => {
  if (dir) rmSync(dir, { recursive: true });
});

test('query shapes keep SQL keywords only', () => {
  assert.equal(queryShape('SELECT COUNT(*) FROM "Line Items" WHERE OrderId = ? AND Status = \'Open\''), 'SELECT COUNT(*) FROM x WHERE x = ? AND x = v');
  assert.equal(queryShape('select sum(Amount) from Lines where Qty > 10 group by Code'), 'SELECT SUM(x) FROM x WHERE x > v GROUP BY x');
});

test('fidelity counts matches and differences by query shape, and changes nothing', () => {
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'OrderId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createField', table: 'Orders', name: 'Total', kind: 'calculation', type: 'number', calculation: 'ExecuteSQL ( "SELECT SUM(Amount) FROM Lines WHERE OrderId = ?" ; "" ; "" ; Id )' },
    { op: 'createField', table: 'Orders', name: 'Broken', kind: 'calculation', type: 'text', calculation: 'ExecuteSQL ( "SELECT Nope FROM Lines" ; "" ; "" )' },
    { op: 'createField', table: 'Orders', name: 'Twice', kind: 'calculation', type: 'number', calculation: 'Id * 2' },
  ]);
  for (const [o, a] of [[1, 5], [1, 7], [2, 3]]) store.create('Lines', { OrderId: String(o), Amount: String(a) });
  store.create('Orders', { Id: '1' });
  store.create('Orders', { Id: '2' });
  // As if FileMaker had stored something else for order 2.
  store.sql.prepare('UPDATE Orders SET Total = 4 WHERE Id = 2').run();
  const before = store.sql.prepare('SELECT count(*) AS n FROM sqlite_master').get() as { n: number };

  const all = calcFidelity(store);
  assert.equal(all.fields, 3);
  assert.deepEqual(all.total, { values: 6, match: 5, differ: 1, missing: 0, extra: 0, error: 0 });
  const sql = calcFidelity(store, { sqlOnly: true });
  assert.equal(sql.fields, 2);
  assert.deepEqual(sql.queries.map((x) => [x.shape, x.problem, x.tally.differ]), [
    ['SELECT SUM(x) FROM x WHERE x = ?', undefined, 1],
    ['SELECT x FROM x', 'unknown column', 0],
  ]);
  assert.deepEqual(sql.worst.map((w) => w.field), [1]);
  assert.ok(sql.functions.ExecuteSQL.values === 4);
  assert.equal((store.sql.prepare('SELECT count(*) AS n FROM sqlite_master').get() as { n: number }).n, before.n);
  assert.equal(store.sql.isTransaction, false);
  store.close();
});

test('ExecuteSQL reads unstored calculations and globals, worked out for each record', () => {
  const path = join(dir, 'Quotes.sqlite');
  createStore(path);
  const store = new Store(path, 'Quotes');
  // As in a private sample: SUM over an unstored calculation, filtered on a stored one.
  store.applyDesign([
    { op: 'createTable', name: 'Quotes', fields: [{ name: 'Id' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'QuoteId' }, { name: 'Rate', type: 'number' }, { name: 'Qty', type: 'number' }, { name: 'Discount', type: 'number', options: { global: true } }] },
    { op: 'createField', table: 'Lines', name: 'c.Total', kind: 'calculation', type: 'number', calculation: 'Round ( Rate * Qty ; 2 )' },
    { op: 'createField', table: 'Lines', name: 'c.AfterDiscount', kind: 'calculation', type: 'number', calculation: 'Round ( Rate * Qty * ( 1 - Discount ) ; 2 )', options: { unstored: true } },
    { op: 'createField', table: 'Quotes', name: 'Net', kind: 'calculation', type: 'number', calculation: 'ExecuteSQL ( "SELECT SUM(\\"c.AfterDiscount\\") FROM Lines WHERE QuoteId = ? and \\"c.Total\\" > 0 " ; "" ; "" ; Id )' },
  ]);
  store.setGlobalField('Lines::Discount', 0.5);
  for (const [rate, qty] of [[10, 2], [5, 1], [0, 3]]) store.create('Lines', { QuoteId: 'q1', Rate: String(rate), Qty: String(qty) });
  const q = store.create('Quotes', { Id: 'q1' }).recordId;
  assert.equal(store.get('Quotes', q).fieldData.Net, 12.5);
  assert.equal(store.evaluate(store.layout('Quotes'), 'ExecuteSQL ( "SELECT DISTINCT Discount FROM Lines" ; "" ; "" )').value, '0.5');
  store.close();
});

test('fidelity counts records the "do not evaluate if empty" option should have left alone', () => {
  const path = join(dir, 'Empty.sqlite');
  createStore(path);
  const store = new Store(path, 'Empty');
  store.applyDesign([
    { op: 'createTable', name: 'People', fields: [{ name: 'Name' }] },
    { op: 'createField', table: 'People', name: 'Shout', kind: 'calculation', type: 'text', calculation: 'Upper ( Name ) & "!"' },
  ]);
  store.create('People', { Name: 'ann' });
  store.create('People', {});
  store.create('People', {});
  // As if FileMaker had evaluated it on one record anyway.
  store.sql.exec(`UPDATE People SET Shout = '!' WHERE _fm_record_id = 3`);
  assert.deepEqual(calcFidelity(store).emptyRule, { 'no custom function, FileMaker stored nothing': 1, 'no custom function, FileMaker stored a value': 1 });
  store.close();
});

test('difference kinds say how values differ without saying what they are', () => {
  assert.equal(differenceKind('2019\n2020', '2020\n2019'), 'same lines, other order');
  assert.equal(differenceKind('Acme', 'ACME '), 'case or spacing');
  assert.equal(differenceKind('1,250', '1250'), 'number formatting');
  assert.equal(differenceKind('Open', 'Paid'), 'other');
  assert.equal(differenceKind('1250', '1100.5'), 'other, both numbers, stored higher');
  assert.equal(differenceKind('900', '1100.5'), 'other, both numbers, stored lower');
});

test('fidelity: a record saved again later can still hold the value worked out when it was made', () => {
  const path = join(dir, 'Made.sqlite');
  createStore(path);
  const store = new Store(path, 'Made');
  const made = { name: 'Created', type: 'timestamp' as const, options: { autoEnter: { value: 'creationTimestamp' as const } } };
  const stamp = { name: 'Modified', type: 'timestamp' as const, options: { autoEnter: { value: 'modificationTimestamp' as const } } };
  store.applyDesign([
    { op: 'createTable', name: 'Quotes', fields: [{ name: 'Id' }, { name: 'Note' }, made, stamp] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'QuoteId' }, { name: 'Amount', type: 'number' }, stamp] },
    { op: 'createField', table: 'Quotes', name: 'Total', kind: 'calculation', type: 'number', calculation: 'ExecuteSQL ( "SELECT SUM(Amount) FROM Lines WHERE QuoteId = ?" ; "" ; "" ; Id )' },
  ]);
  // As in a private sample: the quote is made (its total worked out, empty), lines are added, then the
  // quote's other fields are edited. FileMaker doesn't recompute the total, since Id didn't change.
  for (const id of ['q1', 'q2']) store.create('Quotes', { Id: id });
  store.create('Lines', { QuoteId: 'q1', Amount: '5' });
  store.create('Lines', { QuoteId: 'q2', Amount: '7' });
  store.sql.exec(`UPDATE Quotes SET Total = NULL, Created = '2020-01-01 10:00:00', Modified = '2020-03-01 10:00:00' WHERE Id = 'q1'`);
  store.sql.exec(`UPDATE Quotes SET Total = 3, Created = '2020-03-01 09:00:00', Modified = '2020-03-01 10:00:00' WHERE Id = 'q2'`);
  store.sql.exec(`UPDATE Lines SET Modified = '2020-02-01 10:00:00'`);
  const r = calcFidelity(store, { sqlOnly: true });
  assert.deepEqual(r.timing, { 'a record it reads changed after this record was made (not since it was saved)': 1, 'nothing it reads changed after this record was made (other, both numbers, stored lower)': 1 });
  // A line deleted later: FileMaker keeps the total worked out from it.
  store.sql.exec(`DELETE FROM Lines WHERE QuoteId = 'q2'`);
  assert.equal(calcFidelity(store, { sqlOnly: true }).timing['no record it reads exists now (deleted since, or never matched)'], 1);
  store.close();
});

test('fidelity tells stale stored values apart: the records a query reads changed after the record was saved', () => {
  const path = join(dir, 'Stale.sqlite');
  createStore(path);
  const store = new Store(path, 'Stale');
  const stamp = { name: 'Modified', type: 'timestamp' as const, options: { autoEnter: { value: 'modificationTimestamp' as const } } };
  store.applyDesign([
    { op: 'createTable', name: 'Quotes', fields: [{ name: 'Id' }, stamp] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'QuoteId' }, { name: 'Amount', type: 'number' }, stamp] },
    { op: 'createField', table: 'Quotes', name: 'Total', kind: 'calculation', type: 'number', calculation: 'ExecuteSQL ( "SELECT SUM(Amount) FROM Lines WHERE QuoteId = ?" ; "" ; "" ; Id )' },
  ]);
  // Quote 1 was saved before its lines were added (FileMaker's stored total stays empty); quote 2 after.
  store.create('Quotes', { Id: 'q1' });
  store.create('Quotes', { Id: 'q2' });
  store.create('Lines', { QuoteId: 'q1', Amount: '5' });
  store.create('Lines', { QuoteId: 'q2', Amount: '7' });
  store.sql.exec(`UPDATE Quotes SET Total = NULL, Modified = '2020-01-01 10:00:00' WHERE Id = 'q1'`);
  store.sql.exec(`UPDATE Quotes SET Total = 3, Modified = '2020-03-01 10:00:00' WHERE Id = 'q2'`);
  store.sql.exec(`UPDATE Lines SET Modified = '2020-02-01 10:00:00'`);
  const r = calcFidelity(store, { sqlOnly: true });
  assert.deepEqual(r.total, { values: 2, match: 0, differ: 1, missing: 0, extra: 1, error: 0 });
  assert.deepEqual(r.timing, { 'a record it reads changed after this record was saved': 1, 'nothing it reads changed after this record was saved (other, both numbers, stored lower)': 1 });
  assert.equal(r.queries[0].problem, undefined);
  store.close();
});

test('a query built by the formula: the column named from a field, as a private sample picks a rate', () => {
  const path = join(dir, 'Rates.sqlite');
  createStore(path);
  const store = new Store(path, 'Rates');
  store.applyDesign([
    { op: 'createTable', name: 'AdSizes', fields: [{ name: 'pkAdSizeID' }, { name: 'Net1', type: 'number' }, { name: 'Net2', type: 'number' }] },
    { op: 'createTable', name: 'QuoteLineItems', fields: [{ name: 'fkAdSizeID' }, { name: 'Qty', type: 'number' }] },
    { op: 'createField', table: 'QuoteLineItems', name: 'zc_defaultRate', kind: 'calculation', type: 'number', calculation:
      'Let ( [ $Net = "Net" & QuoteLineItems::Qty ; $query1234 = " SELECT " & $Net & "    FROM AdSizes   WHERE pkAdSizeID = ?" ; ' +
      '$result = ExecuteSQL ( $query1234 ; "" ; "" ; QuoteLineItems::fkAdSizeID ) ] ; $result )' },
  ]);
  store.create('AdSizes', { pkAdSizeID: 'A', Net1: '1250', Net2: '1100.5' });
  const one = store.create('QuoteLineItems', { fkAdSizeID: 'A', Qty: '1' }).recordId;
  const two = store.create('QuoteLineItems', { fkAdSizeID: 'A', Qty: '2' }).recordId;
  const rate = (id: number) => store.get('QuoteLineItems', id).fieldData.zc_defaultRate;
  assert.equal(rate(one), 1250);
  assert.equal(rate(two), 1100.5);
  store.close();
});
