// "Why does this record look wrong?": every calculation and validated field on a record checked, each problem
// traced back to where it starts, and secrets kept out of what the assistant sees.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRecord, createStore, Store } from '../../store/src/index.ts';
import { redactRecordCheck } from '../src/mcp.ts';
import { secretName } from '../src/ai-output.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-record-check-'));
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function shop(): Store {
  const path = join(dir, `Shop${++n}.sqlite`);
  createStore(path);
  const store = new Store(path, 'Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Qty', type: 'number', options: { validation: { range: { min: '1', max: '100' } } } }, { name: 'Price', type: 'number' }, { name: 'Discount', type: 'number' }, { name: 'Code' }, { name: 'Shipping', type: 'number' }, { name: 'Api Key' }] },
    { op: 'createField', table: 'Orders', name: 'Net', kind: 'calculation', type: 'number', calculation: 'Qty * Price' },
    { op: 'createField', table: 'Orders', name: 'Total', kind: 'calculation', type: 'number', calculation: 'Net - Discount' },
    { op: 'createField', table: 'Orders', name: 'Due', kind: 'calculation', type: 'number', calculation: 'If ( IsEmpty ( Price ) ; "" ; Qty * Price )' },
    { op: 'createField', table: 'Orders', name: 'WithShipping', kind: 'calculation', type: 'number', calculation: 'Total + Shipping' },
    { op: 'createField', table: 'Orders', name: 'Bad', kind: 'calculation', type: 'text', calculation: 'Evaluate ( "1 +" )' },
    { op: 'createField', table: 'Orders', name: 'Fine', kind: 'calculation', type: 'text', calculation: 'Code & "!"' },
    { op: 'createField', table: 'Orders', name: 'Signed', kind: 'calculation', type: 'text', calculation: 'If ( IsEmpty ( Code ) ; "" ; Code & Api Key )' },
  ] as never);
  store.applyDesign([{ op: 'deleteField', table: 'Orders', field: 'Shipping' }] as never);
  return store;
}

test('a record\'s problems, root causes first, each with the values its formula read', () => {
  const store = shop();
  const table = store.schema.tables.find((t) => t.name === 'Orders')!;
  const rec = (id: number) => ({ store, table, row: store.row(store.layout('Orders'), id) });
  const id = store.create('Orders', { Qty: '3', Price: '2', Discount: '1', Code: 'A' }).recordId;
  // Changed behind the file's back: Qty past its validation, Net's stored value no longer what its formula gives.
  store.sql.exec(`UPDATE Orders SET Net = 999, Qty = 500 WHERE _fm_record_id = ${id}`);
  const r = checkRecord(store, table, rec(id));
  assert.equal(r.checked, 8);
  const got = r.problems.map((p) => [p.field, p.kind, p.causedBy ?? []]);
  assert.deepEqual(got, [
    ['Bad', 'error', []],
    ['WithShipping', 'missing-reference', []],
    ['Qty', 'validation', []],
    ['Net', 'stale', ['Qty']],
    ['Due', 'stale', ['Qty']],
    ['Total', 'stale', ['Net']],
  ]);
  const net = r.problems.find((p) => p.field === 'Net')!;
  assert.equal(net.value, '999');
  assert.equal(net.now, '1000');
  assert.deepEqual(net.inputs, [{ field: 'Qty', value: '500' }, { field: 'Price', value: '2' }]);
  assert.match(r.problems.find((p) => p.field === 'Qty')!.message, /must be between 1 and 100/);
  assert.match(r.problems.find((p) => p.field === 'WithShipping')!.message, /isn't a field of the file \(renamed or deleted\)/);

  // An empty input that leaves a result empty, named once however often the formula reads it.
  const two = store.create('Orders', { Qty: '3', Code: 'B' }).recordId;
  const due = checkRecord(store, table, rec(two)).problems.find((p) => p.field === 'Due')!;
  assert.equal(due.kind, 'empty-input');
  assert.equal(due.message, 'Due is empty, and Price is empty on this record: fill it in or check the formula handles a blank.');

  // Only the fields asked for (the ones the account may see).
  assert.deepEqual(checkRecord(store, table, rec(id), { fields: ['Net', 'Fine'] }).problems.map((p) => p.field), ['Net']);
  store.close();
});

test('what the assistant sees of a record check: secret fields and values hidden', () => {
  const store = shop();
  const table = store.schema.tables.find((t) => t.name === 'Orders')!;
  const id = store.create('Orders', { Qty: '3', Price: '2', Code: 'A', 'Api Key': 'sk' + '-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }).recordId;
  store.sql.exec(`UPDATE Orders SET Signed = 'old', Code = 'Z' WHERE _fm_record_id = ${id}`);
  const raw = checkRecord(store, table, { store, table, row: store.row(store.layout('Orders'), id) });
  const signed = raw.problems.find((p) => p.field === 'Signed')!;
  assert.match(signed.now!, /sk-ant/);
  const shown = JSON.stringify(redactRecordCheck(raw));
  assert.ok(!shown.includes('abcdefghijklmnop'), shown);
  // Still says what is wrong.
  assert.match(shown, /Signed shows a value its formula no longer gives/);
  store.close();
});

function keys(): Store {
  const path = join(dir, `Keys${++n}.sqlite`);
  createStore(path);
  const store = new Store(path, 'Keys');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Api Key' }, { name: 'Qty', type: 'number' }, { name: 'Okapi Key' }] },
    { op: 'createField', table: 'Orders', name: 'KeyCopy', kind: 'calculation', type: 'text', calculation: 'Api Key' },
    { op: 'createField', table: 'Orders', name: 'Shout', kind: 'calculation', type: 'text', calculation: 'Upper ( KeyCopy ) & Qty' },
    { op: 'createField', table: 'Orders', name: 'N', type: 'number', options: { validation: { calculation: 'N < 5', calculationAlways: true, message: '"bad: " & Api Key', messageCalculation: true } } },
    { op: 'createField', table: 'Orders', name: 'Code', type: 'text', calculation: 'Qty & "-x"', options: { autoEnter: { calculation: true }, validation: { maxLength: 3 } } },
  ] as never);
  return store;
}

test('a value read from a secret through other calculations stays hidden: result, stored value, inputs and message', () => {
  const store = keys();
  const table = store.schema.tables.find((t) => t.name === 'Orders')!;
  const id = store.create('Orders', { 'Api Key': 'sk-old-key-1111111', Qty: '1', N: '1' }).recordId;
  // The key rotated behind the file's back: KeyCopy and Shout still hold the old one, and Shout reads a changed Qty.
  store.sql.exec(`UPDATE Orders SET "Api Key" = 'sk-new-key-2222222', N = 9, Qty = 2 WHERE _fm_record_id = ${id}`);
  const raw = checkRecord(store, table, { store, table, row: store.row(store.layout('Orders'), id) }, { secret: (f) => /api key/i.test(f) });
  assert.deepEqual(raw.problems.filter((p) => p.readsSecret).map((p) => p.field).sort(), ['KeyCopy', 'N', 'Shout']);
  const shown = JSON.stringify(redactRecordCheck(raw));
  assert.ok(!/1111111|2222222/i.test(shown), shown);
  assert.match(shown, /N wouldn't pass its validation now\./);
  // Root causes first: Shout reads KeyCopy, so it comes after it.
  const order = raw.problems.map((p) => p.field);
  assert.ok(order.indexOf('KeyCopy') < order.indexOf('Shout'), order.join());
  store.close();
});

test('an auto-enter calculation with validation has its validation checked too, and one failing check doesn\'t stop the rest', () => {
  const store = keys();
  const table = store.schema.tables.find((t) => t.name === 'Orders')!;
  const id = store.create('Orders', { Qty: '1' }).recordId;
  store.sql.exec(`UPDATE Orders SET Code = 'toolong' WHERE _fm_record_id = ${id}`);
  const rec = { store, table, row: store.row(store.layout('Orders'), id) };
  assert.ok(checkRecord(store, table, rec).problems.some((p) => p.field === 'Code' && p.kind === 'validation'));
  const check = store.calc.checkValidation.bind(store.calc);
  store.calc.checkValidation = (r, f, a) => {
    if (f.name === 'N') throw new Error('boom');
    return check(r, f, a);
  };
  const r = checkRecord(store, table, rec);
  assert.ok(r.problems.some((p) => p.field === 'N' && p.kind === 'error' && /boom/.test(p.message)));
  assert.ok(r.problems.some((p) => p.field === 'Code' && p.kind === 'validation'));
  store.close();
});

test('stale problems come after the stale ones they read, however the fields are ordered', () => {
  const path = join(dir, `Order${++n}.sqlite`);
  createStore(path);
  const store = new Store(path, 'Order');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'B', kind: 'calculation', type: 'number', calculation: 'A + 1' },
    { op: 'createField', table: 'T', name: 'C', kind: 'calculation', type: 'number', calculation: 'B * 2' },
    { op: 'createField', table: 'T', name: 'D', kind: 'calculation', type: 'number', calculation: 'C + B' },
  ] as never);
  const table = store.schema.tables.find((t) => t.name === 'T')!;
  const id = store.create('T', { A: '1' }).recordId;
  store.sql.exec(`UPDATE T SET A = 5, B = 999 WHERE _fm_record_id = ${id}`);
  // Field order reversed: D first, then C, then B.
  const rev = { ...table, fields: [...table.fields].reverse() };
  const r = checkRecord(store, rev, { store, table: rev, row: store.row(store.layout('T'), id) });
  assert.deepEqual(r.problems.map((p) => p.field), ['B', 'C', 'D']);
  store.close();
});

test('privilege-aware: a hidden field is skipped entirely, not reported and not checked; a visible calc that reads it withholds its value', () => {
  const store = shop();
  const table = store.schema.tables.find((t) => t.name === 'Orders')!;
  const id = store.create('Orders', { Qty: '3', Price: '2', Discount: '1', Code: 'A' }).recordId;
  // Net's stored value is stale, same as the first test — but this account can't see Net at all. Due's is stale too, and it reads only
  // fields the account can see.
  store.sql.exec(`UPDATE Orders SET Net = 999, Due = 777 WHERE _fm_record_id = ${id}`);
  store.savePrivilegeSet({
    name: 'Clerks', records: { view: true, edit: true, create: false, delete: false },
    tables: { Orders: { view: true, edit: true, create: false, delete: false, fields: { Net: 'none' } } },
    layouts: 'modifiable', valueLists: 'modifiable', scripts: 'none', extendedPrivileges: ['fmrest'],
  });
  const pv = store.privilegesForSet('Clerks');
  const rec = { store, table, row: store.row(store.layout('Orders'), id) };
  const r = checkRecord(store, table, rec, { privileges: pv });

  // Net itself isn't checked at all: no "stale" problem for it, and it doesn't count toward `checked`.
  assert.ok(!r.problems.some((p) => p.field === 'Net'), JSON.stringify(r.problems));
  const full = checkRecord(store, table, rec);
  assert.equal(r.checked, full.checked - 1);

  // Total is visible and reads Net: the value it read from Net is withheld, and so is any verdict on whether Total is current (that
  // yes or no would depend on Net, and an account that can change what else Total reads could steer it until Net's value is known).
  assert.ok(!r.problems.some((p) => p.field === 'Total'), JSON.stringify(r.problems));
  assert.ok(!JSON.stringify(r).includes('999'), 'nothing of the hidden field\'s stored value is in what it is told');
  const total = full.problems.find((p) => p.field === 'Total')!;
  assert.deepEqual(total.inputs, [{ field: 'Net', value: '999' }, { field: 'Discount', value: '1' }], 'control: with no limits the problem is there');

  // Due reads only fields the account can see, so it is checked in full, stale value and what it should be now.
  const due = r.problems.find((p) => p.field === 'Due')!;
  assert.equal(due.kind, 'stale');
  assert.equal(due.now, '6');
  store.close();
});

test('secret field names: spaced key and token names count, words that only contain them don\'t', () => {
  for (const name of ['Api Key', 'API keys', 'Access-Token', 'Private Key', 'api_key', 'Password']) assert.ok(secretName(name), name);
  for (const name of ['Okapi Key', 'Private Keyring', 'Rapid Access Tokenizer', 'Keyword']) assert.ok(!secretName(name), name);
});
