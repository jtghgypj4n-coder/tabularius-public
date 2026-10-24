import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, explainField, lintFormula, Store } from '../src/index.ts';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-explain-'));
});
after(() => {
  if (dir) rmSync(dir, { recursive: true });
});

let n = 0;
function shop(): Store {
  const path = join(dir, `Shop${++n}.sqlite`);
  createStore(path);
  const store = new Store(path, 'Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }, { name: 'Note' }, { name: 'Qty', type: 'number' }, { name: 'Price', type: 'number' }, { name: 'Code' }, { name: 'Shipped', type: 'date' }, { name: 'Scan', type: 'container' }, { name: 'Rate', type: 'number', options: { global: true } }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'OrderId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createOccurrence', name: 'Order lines', table: 'Lines' },
    { op: 'createRelationship', left: 'Orders', right: 'Order lines', predicates: [{ left: 'Id', right: 'OrderId' }] },
    { op: 'createCustomFunction', name: 'Twice', parameters: ['x'], formula: 'x * 2' },
    { op: 'createField', table: 'Orders', name: 'Net', kind: 'calculation', type: 'number', calculation: 'Qty * Price' },
    { op: 'createField', table: 'Orders', name: 'Gross', kind: 'calculation', type: 'number', calculation: 'Let ( [ n = Net ; unused = 1 ] ; Twice ( n ) )' },
    { op: 'createField', table: 'Orders', name: 'Lines total', kind: 'calculation', type: 'number', calculation: 'Sum ( Order lines::Amount )', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'NoNote', kind: 'calculation', type: 'number', calculation: 'IsEmpty ( Note )' },
    { op: 'createField', table: 'Orders', name: 'NoScan', kind: 'calculation', type: 'number', calculation: 'IsEmpty ( Scan )' },
  ]);
  return store;
}

test('explain a value: formula, the values it read, each step and the calculations behind it', () => {
  const store = shop();
  const id = store.create('Orders', { Id: '7', Qty: '3', Price: '2.5' }).recordId;
  const table = store.schema.tables.find((t) => t.name === 'Orders')!;
  const field = (n: string) => table.fields.find((f) => f.name === n)!;
  const rec = { store, table, row: store.row(store.layout('Orders'), id) };

  const gross = explainField(store, table, field('Gross'), rec);
  assert.equal(gross.value, '15');
  assert.equal(gross.result, '15');
  assert.equal(gross.matchesStored, true);
  assert.deepEqual(gross.references, [{ field: 'Net', type: 'number', kind: 'calculation', value: '7.5', empty: false }]);
  // Let values are named, and a custom function's body appears under its call.
  assert.deepEqual(gross.steps!.steps!.map((s) => s.expr), ['n = Net', 'Twice ( n )']);
  assert.equal(gross.steps!.steps![1].steps!.at(-1)!.expr, 'x * 2');
  assert.deepEqual(gross.dependencies, [{ field: 'Net', kind: 'calculation', storage: 'stored', formula: 'Qty * Price' }]);
  assert.ok(gross.warnings!.some((w) => w.code === 'unused-let' && /"unused"/.test(w.message)));

  // Empty references: kept empty by "Do not evaluate if all referenced fields are empty", unless a container.
  const noNote = explainField(store, table, field('NoNote'), rec);
  assert.match(noNote.notEvaluated!, /Every field the formula reads is empty/);
  assert.ok(noNote.warnings!.some((w) => w.code === 'empty-rule' && /gives "1"/.test(w.message)));
  const noScan = explainField(store, table, field('NoScan'), rec);
  assert.equal(noScan.notEvaluated, undefined);
  assert.equal(noScan.value, '1');
  assert.ok(noScan.warnings!.some((w) => w.code === 'empty-rule-container'));

  // A data field has no formula; an unstored calculation is worked out now.
  assert.equal(explainField(store, table, field('Qty'), rec).storage, 'data');
  const lines = explainField(store, table, field('Lines total'), rec);
  assert.equal(lines.storage, 'unstored');
  assert.equal(lines.matchesStored, undefined);
  store.close();
});

test('privilege-aware: a field the privileges can\'t see refuses outright, and a visible calculation withholds a hidden field it only references', () => {
  const store = shop();
  const id = store.create('Orders', { Id: '7', Qty: '3', Price: '2.5' }).recordId;
  const table = store.schema.tables.find((t) => t.name === 'Orders')!;
  const field = (n: string) => table.fields.find((f) => f.name === n)!;
  const rec = { store, table, row: store.row(store.layout('Orders'), id) };

  store.savePrivilegeSet({
    name: 'Clerks',
    records: { view: true, edit: true, create: false, delete: false },
    tables: { Orders: { view: true, edit: true, create: false, delete: false, fields: { Net: 'none' } } },
    layouts: 'modifiable', valueLists: 'modifiable', scripts: 'none', extendedPrivileges: ['fmrest'],
  });
  const pv = store.privilegesForSet('Clerks');

  // Asking to explain the hidden field itself refuses outright, rather than
  // handing back its value through the back door of "explain".
  assert.throws(() => explainField(store, table, field('Net'), rec, { privileges: pv }), /can't see Orders::Net/);

  // Gross is visible and its formula reads Net: Gross's own value and result
  // still show (Gross itself is viewable, same as a direct read of it would
  // be), but the reference to Net carries no value — explaining a visible
  // calculation must never be a way to read a field it merely references.
  const gross = explainField(store, table, field('Gross'), rec, { privileges: pv });
  assert.equal(gross.value, '15');
  assert.equal(gross.result, '15');
  assert.deepEqual(gross.references, [{ field: 'Net', type: 'number', kind: 'calculation', hidden: true }]);
  // The dependency chain withholds the same way: Net's formula ("Qty * Price") isn't shown either.
  assert.deepEqual(gross.dependencies, [{ field: 'Net', kind: 'calculation', storage: 'stored', hidden: true }]);

  // With no privileges passed (the server/admin caller), nothing is withheld.
  const full = explainField(store, table, field('Gross'), rec);
  assert.deepEqual(full.references, [{ field: 'Net', type: 'number', kind: 'calculation', value: '7.5', empty: false }]);
  assert.deepEqual(full.dependencies, [{ field: 'Net', kind: 'calculation', storage: 'stored', formula: 'Qty * Price' }]);
  store.close();
});

test('privilege-aware: a reference that crosses into another hosted file is checked against that file\'s own privileges, not the formula\'s file', () => {
  // "Picker" has a calc field that reads a field of "Data" through a cross-file
  // table occurrence — the same shape webclient.ts/mcp.ts use `.in(otherStore)`
  // for. The account is "clerk" in both files, but each file gives it a
  // different privilege set: full view in Picker, Balance hidden in Data.
  n++;
  const dataPath = join(dir, `Data${n}.sqlite`);
  const pickerPath = join(dir, `Picker${n}.sqlite`);
  createStore(dataPath);
  createStore(pickerPath);
  const data = new Store(dataPath, 'Data');
  const picker = new Store(pickerPath, 'Picker');
  try {
    data.applyDesign([{ op: 'createTable', name: 'Accounts', fields: [{ name: 'Id', type: 'number' }, { name: 'Balance', type: 'number' }] }]);
    data.create('Accounts', { Id: '1', Balance: '999' });
    data.savePrivilegeSet({
      name: 'Hidden', records: { view: true, edit: true, create: false, delete: false },
      tables: { Accounts: { view: true, edit: true, create: false, delete: false, fields: { Balance: 'none' } } },
      layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'],
    });
    data.setPassword('clerk', 'pw', 'Hidden');

    // Picker's own "Accounts" is a dummy table created in the same order as
    // Data's real one, so it gets the same table id — that id is what an
    // occurrence pointed at Data's file actually resolves (see
    // related-external.test.ts for the same trick).
    picker.applyDesign([
      { op: 'createTable', name: 'Accounts', fields: [{ name: 'Id', type: 'number' }, { name: 'Balance', type: 'number' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'AccountId', type: 'number' }] },
      { op: 'createOccurrence', name: 'Remote accounts', table: 'Accounts' },
      { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
      { op: 'createRelationship', left: 'Orders', right: 'Remote accounts', predicates: [{ left: 'AccountId', right: 'Id' }] },
      { op: 'createField', table: 'Orders', name: 'RemoteBalance', kind: 'calculation', type: 'number', calculation: 'Remote accounts::Balance' },
    ]);
    const source = picker.schema.dataSources[0].id;
    picker.schema.tableOccurrences.find((t) => t.name === 'Remote accounts')!.dataSourceId = source;
    picker.resolveFile = (name) => (name === 'Data' ? data : undefined);
    picker.savePrivilegeSet({
      name: 'Local', records: { view: true, edit: true, create: false, delete: false },
      layouts: 'modifiable', valueLists: 'modifiable', scripts: 'none', extendedPrivileges: ['fmrest'],
    });
    picker.setPassword('clerk', 'pw', 'Local');

    const id = picker.create('Orders', { AccountId: '1' }).recordId;
    const table = picker.schema.tables.find((t) => t.name === 'Orders')!;
    const field = table.fields.find((f) => f.name === 'RemoteBalance')!;
    const rec = { store: picker, table, row: picker.row(picker.layout('Orders'), id) };
    const pv = picker.privileges('clerk');

    const explained = explainField(picker, table, field, rec, { privileges: pv });
    assert.deepEqual(explained.references, [{ field: 'Remote accounts::Balance', type: 'number', kind: 'normal', hidden: true }]);
  } finally {
    picker.close();
    data.close();
  }
});

test('empty-rule lint ignores function names in comments and strings, but respects real calls', () => {
  const store = shop();
  try {
    const occurrence = store.calc.occurrence('Orders')!.id;
    const field = store.schema.tables.find((t) => t.name === 'Orders')!.fields.find((f) => f.name === 'NoNote')!;
    const codes = (formula: string) => lintFormula(store, formula, { occurrence, field }).map((w) => w.code);
    assert.ok(codes('IsEmpty ( Note ) // GetField ( "Note" )').includes('empty-rule'));
    assert.ok(codes('IsEmpty ( Note ) & "GetField ( Note )"').includes('empty-rule'));
    for (const formula of ['IsEmpty ( Note ) & GetField ( "Note" )', 'Lookup ( Note )', 'LookupNext ( Note ; 1 )']) {
      assert.ok(!codes(formula).includes('empty-rule'), formula);
    }
  } finally { store.close(); }
});

test('lint: what FileMaker accepts silently but may surprise', () => {
  const store = shop();
  const to = store.calc.occurrence('Orders')!.id;
  const codes = (f: string) => lintFormula(store, f, { occurrence: to }).map((w) => w.code);
  assert.deepEqual(codes('Code * 2'), ['type-mix']);
  assert.deepEqual(codes('Shipped > "1/2/2026"'), ['date-text']);
  assert.deepEqual(codes('Qty = "lots"'), ['type-mix']);
  assert.deepEqual(codes('Qty * Price + Twice ( 2 )'), []);
  assert.deepEqual(codes('<Field Missing> + 1'), ['reference']);
  const table = store.schema.tables.find((t) => t.name === 'Orders')!;
  const stored = { ...table.fields.find((f) => f.name === 'Net')! };
  const fieldCodes = (f: string) => lintFormula(store, f, { occurrence: to, field: stored }).map((w) => w.code);
  assert.deepEqual(fieldCodes('Qty * Rate'), ['stored-global']);
  assert.deepEqual(fieldCodes('Sum ( Order lines::Amount )'), ['stored-related']);
  // Net + 1 also gives 1 when Net is empty, which the empty rule hides.
  assert.deepEqual(fieldCodes('Net + 1'), ['self-reference', 'empty-rule']);
  assert.deepEqual(fieldCodes('Qty & " boxes"'), ['empty-rule']);
  assert.deepEqual(fieldCodes('Code & " (" & Note & ")"'), []);
  assert.deepEqual(fieldCodes('Qty * Price'), []);
  store.close();
});
