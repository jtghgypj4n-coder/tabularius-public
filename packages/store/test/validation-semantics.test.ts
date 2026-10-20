import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';

// Claris: field-validation.html, automatic-data-entry.html, calculation-fields.html,
// repeating-fields.html and value-lists.html in help.claris.com/en/pro-help/content/.
function withStore(run: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-validation-semantics-'));
  const path = join(dir, 'test.sqlite');
  createStore(path);
  const store = new Store(path, 'Test');
  try { run(store); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

const code = (wanted: number) => (error: unknown) => error instanceof StoreError && error.code === wanted;

for (const { name, always, skip, fails } of [
  { name: 'only during data entry', always: false, skip: false, fails: false },
  { name: 'always', always: true, skip: false, fails: true },
  { name: 'always with Skip data entry validation', always: true, skip: true, fails: true },
  { name: 'only during data entry with Skip data entry validation', always: false, skip: true, fails: false },
]) test(`validation ${name} on an untouched field`, () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'Code', options: { validation: { notEmpty: true, always } } }, { name: 'Note' },
  ] }]);
  const id = store.create('T', { Code: 'good' }).recordId;
  // An existing value can become invalid after a field option changes or through a bulk replace.
  store.sql.prepare('UPDATE T SET Code = NULL WHERE _fm_record_id = ?').run(id);
  const write = () => store.update('T', id, { Note: 'edited' }, undefined, { skipEntryValidation: skip });
  if (fails) assert.throws(write, code(509));
  else assert.doesNotThrow(write);
  assert.equal(store.get('T', id).fieldData.Note, fails ? '' : 'edited');
}));

for (const calculationAlways of [false, true]) test(`validated calculation on an untouched Always field: calculationAlways=${calculationAlways}`, () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'Code', options: { validation: { always: true, calculation: 'Code = "ok"', calculationAlways } } }, { name: 'Note' },
  ] }]);
  const id = store.create('T', { Code: 'ok' }).recordId;
  store.sql.prepare('UPDATE T SET Code = ? WHERE _fm_record_id = ?').run('bad', id);
  const write = () => store.update('T', id, { Note: 'edited' });
  if (calculationAlways) assert.throws(write, code(507));
  else assert.doesNotThrow(write);
}));

for (const { name, strict, skip, expected } of [
  { name: 'override allowed, ordinary entry', strict: false, skip: false, expected: 502 },
  { name: 'override disabled, ordinary entry', strict: true, skip: false, expected: 502 },
  { name: 'script entry bypasses data-entry check', strict: false, skip: true, expected: 0 },
  { name: 'script entry with override disabled', strict: true, skip: true, expected: 0 },
]) test(`strict numeric validation: ${name}`, () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Code', options: { validation: { type: 'number', strict } } }] }]);
  assert.equal(store.schema.tables[0].fields[0].options?.validation?.strict, strict);
  const write = () => store.create('T', { Code: '12x' }, { skipEntryValidation: skip });
  if (expected) assert.throws(write, code(expected));
  else assert.equal(store.get('T', write().recordId).fieldData.Code, '12x');
}));

for (const { strict, dataEntry, override, expected } of [
  { strict: false, dataEntry: true, override: true, expected: 0 },
  { strict: true, dataEntry: true, override: true, expected: 502 },
  { strict: false, dataEntry: true, override: false, expected: 502 },
  { strict: false, dataEntry: false, override: true, expected: 502 },
]) test(`user validation override: strict=${strict}, dataEntry=${dataEntry}, override=${override}`, () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Code', options: { validation: { type: 'number', strict } } }] }]);
  const write = () => store.create('T', { Code: '12x' }, { dataEntry, ...(override ? { overrideValidation: ['Code'] } : {}) });
  if (expected) assert.throws(write, code(expected));
  else assert.equal(store.get('T', write().recordId).fieldData.Code, '12x');
}));

test('a user override applies only to the chosen field and leaves a failed record uncommitted', () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'Code', options: { validation: { type: 'number' } } },
    { name: 'Other', options: { validation: { type: 'number' } } },
  ] }]);
  assert.throws(() => store.create('T', { Code: 'bad', Other: 'also bad' }, { dataEntry: true, overrideValidation: ['Code'] }),
    (error: unknown) => error instanceof StoreError && error.code === 502 && /Other/.test(error.message));
  assert.equal(store.query('SELECT count(*) AS n FROM T')[0].n, 0);
}));

for (const { kind, value, fieldType, expected } of [
  { kind: 'date4', value: '5/12/2026', fieldType: 'text', expected: 0 },
  { kind: 'date4', value: '5/12/26', fieldType: 'text', expected: 500 },
  { kind: 'date4', value: '5/12/26', fieldType: 'date', expected: 500 },
  { kind: 'date4', value: '13/12/2026', fieldType: 'text', expected: 500 },
  { kind: 'time', value: '23:59', fieldType: 'text', expected: 0 },
  { kind: 'time', value: '25:00', fieldType: 'text', expected: 501 },
  { kind: 'time', value: '25:00', fieldType: 'time', expected: 501 },
] as const) test(`strict ${kind} validation on ${fieldType}: ${value}`, () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Input', type: fieldType, options: { validation: { type: kind } } }] }]);
  const write = () => store.create('T', { Input: value });
  if (expected) assert.throws(write, code(expected));
  else assert.equal(store.get('T', write().recordId).fieldData.Input, value);
}));

test('auto-enter serial, creation/modification account, calculated value and lookup', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Rates', fields: [{ name: 'Code' }, { name: 'Price', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [
      { name: 'Serial', type: 'number', options: { autoEnter: { serial: { next: '40', increment: 2 } } } },
      { name: 'Created', options: { autoEnter: { value: 'creationAccountName' } } },
      { name: 'Modified', options: { autoEnter: { value: 'modificationAccountName' } } },
      { name: 'Code' },
      { name: 'Amount', type: 'number', options: { autoEnter: { calculation: true, replaceExisting: true } }, calculation: 'Price * 2' },
      { name: 'Price', type: 'number' },
    ] },
    { op: 'createRelationship', left: 'Orders', right: 'Rates', predicates: [{ left: 'Code', right: 'Code' }] },
    { op: 'createField', table: 'Orders', name: 'LookedUp', type: 'number', options: { autoEnter: { lookup: { occurrence: 'Rates', field: 'Price' } as never } } },
  ]);
  store.create('Rates', { Code: 'A', Price: '5' });
  const first = store.create('Orders', { Code: 'A', Price: '3' }, { account: 'alice' }).recordId;
  const read = (id: number) => store.get('Orders', id).fieldData;
  assert.deepEqual([read(first).Serial, read(first).Created, read(first).Modified, read(first).Amount, read(first).LookedUp], [40, 'alice', 'alice', 6, 5]);
  store.update('Orders', first, { Price: '4' }, undefined, { account: 'bob' });
  assert.deepEqual([read(first).Created, read(first).Modified, read(first).Amount, read(first).LookedUp], ['alice', 'bob', 8, 5]);
  store.update('Orders', first, { Code: 'missing' });
  assert.equal(read(first).LookedUp, 5, 'a lookup with no match does not copy a new value');
  store.update('Rates', 1, { Price: '7' });
  assert.equal(read(first).LookedUp, 5, 'changing the source does not itself trigger a lookup');
  store.update('Orders', first, { Code: 'A' });
  assert.equal(read(first).LookedUp, 7, 'changing the match field triggers a fresh lookup');
  assert.equal(read(store.create('Orders', { Code: 'A' }).recordId).Serial, 42);
}));

for (const replaceExisting of [false, true]) test(`auto-enter calculation replaceExisting=${replaceExisting}`, () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'Source' }, { name: 'Copy', calculation: 'Source', options: { autoEnter: { calculation: true, replaceExisting } } },
  ] }]);
  const id = store.create('T', { Source: 'first' }).recordId;
  assert.equal(store.get('T', id).fieldData.Copy, 'first');
  store.update('T', id, { Copy: 'manual' });
  store.update('T', id, { Source: 'second' });
  assert.equal(store.get('T', id).fieldData.Copy, replaceExisting ? 'second' : 'manual');
}));

for (const { field, data, code: expected } of [
  { field: 'Required', data: { Required: '', 'Required(2)': 'x' }, code: 509 },
  { field: 'Limited', data: { Limited: 'ok', 'Limited(2)': 'long' }, code: 511 },
  { field: 'Limited', data: { Limited: 'ok', 'Limited(2)': 'yes' }, code: 0 },
]) test(`repeating field validation: ${field} ${expected}`, () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'Required', options: { repetitions: 2, validation: { notEmpty: true } } },
    { name: 'Limited', options: { repetitions: 2, validation: { maxLength: 3 } } },
    { name: 'Base', type: 'number' },
    { name: 'Double', type: 'number', kind: 'calculation', calculation: 'Base * 2' },
  ] }]);
  const write = () => store.create('T', { ...(!('Required' in data) ? { Required: 'ok' } : {}), ...data, Base: '3' });
  if (expected) assert.throws(write, code(expected));
  else {
    const id = write().recordId;
    assert.equal(store.get('T', id).fieldData.Double, 6);
    store.update('T', id, { Base: '4' });
    assert.equal(store.get('T', id).fieldData.Double, 8);
  }
}));

test('value-list membership follows custom and field-backed list changes', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Choices', fields: [{ name: 'Name' }] },
    { op: 'createTable', name: 'T', fields: [{ name: 'Custom' }, { name: 'FromField' }] },
    { op: 'createValueList', name: 'CustomValues', values: ['Red', 'Blue'] },
    { op: 'createValueList', name: 'FieldValues', field: { occurrence: 'Choices', field: 'Name' } },
  ]);
  const [custom, fromField] = store.schema.valueLists.map((list) => list.id);
  store.applyDesign([
    { op: 'updateField', table: 'T', field: 'Custom', options: { validation: { valueList: custom } } },
    { op: 'updateField', table: 'T', field: 'FromField', options: { validation: { valueList: fromField } } },
  ]);
  store.create('Choices', { Name: 'Green' });
  const id = store.create('T', { Custom: 'red', FromField: 'Green' }).recordId;
  assert.throws(() => store.update('T', id, { Custom: 'Orange' }), code(506));
  assert.throws(() => store.update('T', id, { FromField: 'Purple' }), code(506));
  store.create('Choices', { Name: 'Purple' });
  store.update('T', id, { FromField: 'Purple' });
  store.applyDesign([{ op: 'updateValueList', valueList: 'CustomValues', values: ['Orange'] }]);
  store.update('T', id, { Custom: 'Orange' });
  assert.equal(store.get('T', id).fieldData.Custom, 'Orange');
}));

for (const unstored of [false, true]) test(`repeating calculated field evaluates each repetition (unstored=${unstored})`, () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'Score', type: 'number', options: { repetitions: 3 } },
    { name: 'Weighted', type: 'number', kind: 'calculation', calculation: 'Score * Get ( CalculationRepetitionNumber )', options: { repetitions: 3, unstored } },
  ] }]);
  const id = store.create('T', { Score: '10', 'Score(2)': '20', 'Score(3)': '30' }).recordId;
  const values = () => {
    const row = store.get('T', id).fieldData;
    return [row.Weighted, row['Weighted(2)'], row['Weighted(3)']];
  };
  assert.deepEqual(values(), [10, 40, 90]);
  store.update('T', id, { 'Score(2)': '5' });
  assert.deepEqual(values(), [10, 10, 90]);
}));

for (const unstored of [false, true]) test(`Extend carries a scalar into repeating calculations (unstored=${unstored})`, () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'Base', type: 'number' },
    { name: 'Implicit', type: 'number', kind: 'calculation', calculation: 'Base * Get ( CalculationRepetitionNumber )', options: { repetitions: 3, unstored } },
    { name: 'Extended', type: 'number', kind: 'calculation', calculation: 'Extend ( Base ) * Get ( CalculationRepetitionNumber )', options: { repetitions: 3, unstored } },
  ] }]);
  const id = store.create('T', { Base: '2' }).recordId;
  const row = store.get('T', id).fieldData;
  assert.deepEqual([row.Implicit, row['Implicit(2)'], row['Implicit(3)']], [2, '', '']);
  assert.deepEqual([row.Extended, row['Extended(2)'], row['Extended(3)']], [2, 4, 6]);
}));
