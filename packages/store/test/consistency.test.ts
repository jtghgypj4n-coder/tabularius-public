// Cross-module behavior; unresolved FileMaker semantics are kept as TODO probes.
// Sources and limits: docs/consistency.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';
import { errorMeaning, PASSKEY_SECOND_FACTOR_REQUIRED } from '../src/error-codes.ts';
import { evaluate } from '../../calc/src/index.ts';
import { formatValue } from '../../web/src/format.ts';
import { ApiError as ServerApiError } from '../../server/src/dataapi.ts';

function fresh(t: { after: (fn: () => void) => void }): Store {
  const dir = mkdtempSync(join(tmpdir(), 'consistency-'));
  const path = join(dir, 'Audit.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [
    { name: 'Name', type: 'text', options: { validation: { maxLength: 1 } } },
    { name: 'Photo', type: 'container' },
  ] }]);
  return store;
}

function codeFrom(run: () => unknown): number {
  try { run(); } catch (e) {
    assert.ok(e instanceof StoreError);
    return e.code;
  }
  assert.fail('Expected a StoreError');
}

test('missing table uses the table-missing code', (t) => {
  const store = fresh(t);
  assert.equal(codeFrom(() => store.setAuditSettings({ excludeFields: { Absent: ['Name'] } })), 106);
  assert.equal(codeFrom(() => store.recordAsOf('Absent', 1, 0)), 106);
  assert.equal(codeFrom(() => store.previewRecordRule('Absent', '1')), 106);
  assert.equal(codeFrom(() => store.addFieldIndex('Absent', 'Name')), 106);
  assert.equal(codeFrom(() => store.dropFieldIndex('Absent', 'Name')), 106);
  assert.equal(codeFrom(() => store.restoreDeletedRow('Absent', { _fm_record_id: 1 })), 106);
});

test('missing value list uses the value-list-missing code', (t) => {
  const store = fresh(t);
  assert.equal(codeFrom(() => store.valueListItems('Absent')), 108);
  assert.throws(() => store.applyDesign([{ op: 'createField', table: 'People', name: 'WithList', options: { validation: { valueList: 'Absent' as never } } }]),
    { code: 108 });
  assert.throws(() => store.applyDesign([{ op: 'updateField', table: 'People', field: 'Name', options: { validation: { valueList: 'Absent' as never } } }]),
    { code: 108 });
});

test('invalid field repetition uses the repetition code', (t) => {
  const store = fresh(t);
  const id = store.create('People', {}).recordId;
  for (const repetition of [0, -1, 1.5, 2, NaN]) {
    assert.equal(codeFrom(() => store.checkContainerWrite('People', id, 'Photo', repetition)), 111);
  }
  assert.equal(codeFrom(() => store.checkContainerWrite('People', id, 'Absent', 1)), 102);
  assert.doesNotThrow(() => store.checkContainerWrite('People', id, 'Photo', 1));
});

test('audit retention rejects an invalid parameter without a date-validation code', (t) => {
  const store = fresh(t);
  for (const retentionDays of [-1, 0.5, NaN, Infinity, 36501]) {
    assert.equal(codeFrom(() => store.setAuditSettings({ retentionDays })), 960);
  }
  assert.equal(store.setAuditSettings({ retentionDays: 0 }).retentionDays, 0);
});

test('SQL refusal has a documented error meaning', (t) => {
  const store = fresh(t);
  const code = codeFrom(() => store.select('DELETE FROM People'));
  assert.ok(errorMeaning(code), `unmapped ${code}`);
});

test('passkey second-factor signal does not reuse a calculation error code', () => {
  const e = new ServerApiError(PASSKEY_SECOND_FACTOR_REQUIRED, 'This account signs in with a passkey as its second factor', 401);
  assert.equal(e.code, 9000);
  assert.match(errorMeaning(e.code)!, /passkey.*second factor/i);
  assert.match(errorMeaning(1212)!, /operator/i);
});

test('SQL Unicode lower and upper agree with calculation Lower and Upper', (t) => {
  const store = fresh(t);
  const calc = evaluate('Lower ( "É" )').value;
  const sql = store.select("SELECT lower('É')").rows[0][0];
  assert.equal(sql, calc);
  const upperCalc = evaluate('Upper ( "é" )').value;
  const upperSql = store.select("SELECT upper('é')").rows[0][0];
  assert.equal(upperSql, upperCalc);
  assert.deepEqual(store.select('SELECT lower(NULL), lower(123), upper(NULL), upper(123)').rows[0], [null, '123', null, '123']);
});

test('SQL text equality agrees with find accent folding', { todo: 'Unverified: Claris documents SQL binary sorting, not accent-folded equality.' }, (t) => {
  const store = fresh(t);
  store.create('People', { Name: 'É' });
  const find = store.find('People', { query: [{ Name: 'e' }] }).foundCount;
  const sql = store.select("SELECT count(*) FROM People WHERE Name = 'e'").rows[0][0];
  assert.equal(sql, find);
});

test('SQL DATEVAL normalizes an overflow date like GetAsDate', { todo: 'Unverified: Claris does not document overflow parsing for DATEVAL or GetAsDate.' }, (t) => {
  const store = fresh(t);
  const calc = evaluate('Day ( GetAsDate ( "02/31/2024" ) )').value;
  const sql = store.select("SELECT DAY(DATEVAL('2024-02-31'))").rows[0][0];
  assert.equal(sql, calc);
});

test('SQL time literal normalizes overflowing minutes like GetAsTime', { todo: 'Unverified: Claris does not document overflowing minutes in SQL literals or GetAsTime.' }, (t) => {
  const store = fresh(t);
  const calc = evaluate('Hour ( GetAsTime ( "01:90:00" ) )').value;
  const translated = store.calc.translateSQL("SELECT HOUR({t '01:90:00'})");
  const sql = translated.target.select(translated.sql).rows[0][0];
  assert.equal(sql, calc);
});

test('web date display agrees with calculated normalized date', { todo: 'Unverified: GetAsDate does not document normalization of invalid date text.' }, () => {
  const calc = evaluate('GetAsText ( GetAsDate ( "02/31/2024" ) )').value;
  const web = formatValue('02/31/2024', 'date', { date: { monthPad: '', dayPad: '', separator: '/', style: 2 } })?.text;
  assert.equal(web, calc);
});

test('web number display preserves an unformatted nonzero calculation', () => {
  const calc = String(evaluate('1 / 1000000000000').value);
  const web = formatValue(calc, 'number', { number: { decimalPoint: '.' } })?.text;
  assert.equal(Number(web), Number(calc));
});

test('maximum characters agrees with calculation Length for emoji', (t) => {
  const store = fresh(t);
  assert.equal(evaluate('Length ( "😀" )').value, 1);
  const id = store.create('People', { Name: '😀' }).recordId;
  assert.doesNotThrow(() => store.update('People', id, { Name: '𐐀' }));
  for (const value of ['😀a', '😀😀', 'e\u0301']) {
    assert.equal(evaluate(`Length ( "${value}" )`).value, 2);
    assert.equal(store.select('SELECT CHAR_LENGTH(?)', [value]).rows[0][0], 2);
    assert.equal(codeFrom(() => store.create('People', { Name: value })), 511);
    assert.equal(codeFrom(() => store.update('People', id, { Name: value })), 511);
  }
});
