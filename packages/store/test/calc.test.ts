import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, StoreError } from '../src/index.ts';

// Flicks has auto-enter calculations, account stamps, constant data, a
// unique validation, unstored calculations reading globals of another table,
// and a cartesian self-join.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const MODULES = 'WV Framework - Modules';
let dir: string;
let store: Store;
const charts = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const chartsSkip = existsSync(charts) ? false : 'fixtures missing: run npm run fixtures';
let chartsStore: Store | undefined;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-calc-'));
  importFmp12(fixture, join(dir, 'Flicks.sqlite'));
  store = new Store(join(dir, 'Flicks.sqlite'));
  if (!chartsSkip) {
    importFmp12(charts, join(dir, 'Charts.sqlite'));
    chartsStore = new Store(join(dir, 'Charts.sqlite'));
  }
});
after(() => {
  store?.close();
  chartsStore?.close();
  if (dir) rmSync(dir, { recursive: true });
});

test('create applies auto-enter values, constants and calculations', { skip }, () => {
  const before = store.find(MODULES, { limit: 1000 }).records;
  const maxIndex = Math.max(...before.map((r) => Number(r.fieldData.index) || 0));
  const { recordId } = store.create(MODULES, { name: 'calc-test' }, { account: 'Casey' });
  const r = store.get(MODULES, recordId, 'iso').fieldData;
  assert.match(String(r.ID), /^LIBRARY_CODE-[0-9A-F-]{36}$/);
  assert.equal(r.created_by, 'Casey');
  assert.equal(r.modified_by, 'Casey');
  assert.match(String(r.created), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(r.enabled, 1); // constant data
  assert.equal(r.index, maxIndex + 1); // Max ( LIBRARY_CODE__all::index ) + 1, through a × relationship
  assert.equal(r.payload_name, 'calc-test');
});

test('update re-runs what depends on the change', { skip }, () => {
  const { recordId } = store.create(MODULES, { name: 'before-rename' }, { account: 'Casey' });
  const a = store.get(MODULES, recordId, 'iso').fieldData;
  store.update(MODULES, recordId, { name: 'after-rename' }, undefined, { account: 'Sam' });
  const b = store.get(MODULES, recordId, 'iso').fieldData;
  assert.equal(b.ID, a.ID); // its formula reads no fields, so it is not replaced
  assert.equal(b.created_by, 'Casey');
  assert.equal(b.modified_by, 'Sam');
  assert.equal(b.index, a.index);
  assert.equal(b.file_name_ct, '-after-rename'); // unstored: FOCUS::••code_file_namespace & "-" & name
});

test('unstored calculations read globals of other tables', { skip }, () => {
  // No layout shows FOCUS, so set its global through the related field, as FileMaker allows.
  const mod = store.find(MODULES, { limit: 1 }).records[0];
  store.update(MODULES, mod.recordId, { 'FOCUS::••code_file_namespace': 'wv' });
  const again = store.find(MODULES, { limit: 2 }).records;
  assert.equal(again[0].fieldData.file_name_ct, `wv-${again[0].fieldData.name}`);
  // A global has one value for the whole file.
  assert.equal(again[1].fieldData.file_name_ct, `wv-${again[1].fieldData.name}`);
});

test('validation: unique', { skip }, () => {
  const taken = store.find(MODULES, { limit: 1 }).records[0].fieldData.name as string;
  assert.throws(() => store.create(MODULES, { name: taken }), (e: StoreError) => e.code === 504);
  const { recordId } = store.create(MODULES, { name: 'unique-test' });
  assert.throws(() => store.update(MODULES, recordId, { name: taken }), (e: StoreError) => e.code === 504);
});

test('evaluate a formula on a record', { skip }, () => {
  const rec = store.find(MODULES, { limit: 1 }).records[0];
  const total = store.find(MODULES, { limit: 0 }).totalCount;
  assert.deepEqual(store.evaluate(MODULES, 'Count ( LIBRARY_CODE__all::ID )', rec.recordId), { value: String(total), type: 'number' });
  assert.equal(store.evaluate(MODULES, 'Get ( RecordID ) & ":" & Upper ( name )', rec.recordId).value,
    `${rec.recordId}:${String(rec.fieldData.name).toUpperCase()}`);
  assert.equal(store.evaluate(MODULES, 'ExecuteSQL ( "SELECT COUNT(*) FROM LIBRARY_CODE" ; "" ; "" )').value, String(total));
  // Table aliases, and FileMaker SQL's OFFSET / FETCH FIRST.
  assert.equal(store.evaluate(MODULES, 'ExecuteSQL ( "SELECT COUNT(*) FROM LIBRARY_CODE l WHERE l.name IS NOT NULL OR l.name IS NULL" ; "" ; "" )').value, String(total));
  assert.equal(store.evaluate(MODULES, 'ValueCount ( ExecuteSQL ( "SELECT name FROM LIBRARY_CODE AS c ORDER BY c.name OFFSET 1 ROWS FETCH FIRST 2 ROWS ONLY" ; "" ; "" ) )').value, '2');
  // FileMaker's system tables describe the file.
  assert.equal(store.evaluate(MODULES, 'ExecuteSQL ( "SELECT COUNT(*) FROM FileMaker_Tables" ; "" ; "" )').value, String(store.schema.tableOccurrences.length));
  assert.equal(store.evaluate(MODULES, 'ExecuteSQL ( "SELECT FieldClass FROM FileMaker_Fields WHERE TableName = ? AND FieldName = ?" ; "" ; "" ; "LIBRARY_CODE" ; "name" )').value, 'Normal');
  assert.throws(() => store.evaluate(MODULES, 'Left ( "a" )'), (e: StoreError) => e.code === 1201);
});

test('find and sort by unstored calculations', { skip }, () => {
  const { recordId } = store.create(MODULES, { name: 'zz-findable' });
  const r = store.find(MODULES, { query: [{ file_name_ct: '==wv-zz-findable' }, { file_name_ct: '==-zz-findable' }] });
  assert.deepEqual(r.records.map((x) => x.recordId), [recordId]);
  const sorted = store.find(MODULES, { sort: [{ fieldName: 'file_name_ct', sortOrder: 'descend' }], limit: 1000 });
  const names = sorted.records.map((x) => String(x.fieldData.file_name_ct).toLowerCase());
  assert.deepEqual(names, [...names].sort().reverse());
});

test('summary fields over the found set and through relationships', { skip: chartsSkip }, () => {
  const charts = chartsStore!;
  const all = charts.find('Congress', { limit: 1 });
  const rows = charts.query('SELECT count(Party) AS n, avg(Conservative_Composite) AS a FROM Congress')[0] as { n: number; a: number };
  assert.equal(all.records[0].fieldData['party count'], rows.n);
  assert.ok(Math.abs(Number(all.records[0].fieldData.Comp_C_Average) - rows.a) < 1e-9);
  // Over a found set: only the Democrats.
  const d = charts.find('Congress', { query: [{ Party: '==D' }], limit: 1 });
  assert.equal(d.records[0].fieldData['party count'], d.foundCount);
  // A script's found set, read by id: summaries over those records, missing ids skipped.
  const ids = charts.find('Congress', { query: [{ Party: '==D' }], limit: 3 }).records.map((r) => Number(r.recordId));
  const many = charts.getMany('Congress', [...ids.slice(0, 2), 999999999], ids);
  assert.deepEqual(many.map((r) => Number(r.recordId)), ids.slice(0, 2));
  assert.equal(many[0].fieldData['party count'], ids.length);
  assert.throws(() => charts.find('Congress', { query: [{ 'party count': '>1' }] }), (e: StoreError) => e.code === 102);
  // Without a sort, GetSummary by a break field is blank; by itself it is the grand total.
  const id = d.records[0].recordId;
  assert.equal(charts.evaluate('Congress', 'GetSummary ( party count ; Party )', id).value, '');
  assert.equal(charts.evaluate('Congress', 'Let ( f = GetFieldName ( Party ) ; GetSummary ( party count ; f ) )', id).value, '');
  assert.equal(charts.evaluate('Congress', 'GetSummary ( party count ; party count )', id).value, String(rows.n));
  // In a formula through a relationship: a summary of the related records.
  const sp = charts.find('NW Salespeople', { limit: 3 }).records;
  for (const r of sp) {
    const v = charts.evaluate('NW Salespeople', 'Sum ( NW Line Items::Extended Price ) & "|" & NW Line Items::Extended Price Total', r.recordId).value;
    const [sum, total] = v.split('|');
    assert.equal(total, sum);
  }
});

test('portal rows compute unstored calculations', { skip: chartsSkip }, () => {
  const charts = chartsStore!;
  const rec = charts.find('Related records • Pie', { limit: 1 }).records[0];
  const rows = rec.portalData!['NW SalespersonCustomers'];
  assert.ok(rows.length > 1);
  // Each row is the customer's sales by one salesperson, so the rows add up to the customer's total.
  const sum = rows.reduce((n, r) => n + Number(r['NW SalespersonCustomers::Total Sales']), 0);
  assert.ok(sum > 0);
  assert.equal(sum, Number(rec.fieldData['Total Sales']));
});

test('sub-summary groups: summaries over each run of a sorted found set', { skip: chartsSkip }, () => {
  const charts = chartsStore!;
  const sort = [{ fieldName: 'Party', sortOrder: 'ascend' }];
  const ids = charts.findIds('Congress', { sort });
  const [runs] = charts.groupSummaries('Congress', ids, ['Party']);
  const counts = charts.query('SELECT Party, count(Party) AS n FROM Congress GROUP BY lower(Party) ORDER BY Party IS NULL, Party') as { Party: string; n: number }[];
  assert.deepEqual(runs.map((r) => r.values['party count']).filter((n) => n), counts.map((c) => c.n).filter((n) => n));
  // Runs cover the found set in order, without gaps.
  assert.equal(runs.reduce((n, r) => (assert.equal(r.start, n), n + r.count), 0), ids.length);
});

test('ExecuteSQL: parameters, number fields holding text, read-only', { skip }, () => {
  const { recordId } = store.create(MODULES, { name: 'sql-text-number' });
  store.sql.prepare(`UPDATE LIBRARY_CODE SET "index" = '$3750' WHERE _fm_record_id = ?`).run(recordId);
  const sql = (q: string) => store.evaluate(MODULES, `ExecuteSQL ( "${q}" ; "" ; "" ; "sql-text-number" )`).value;
  assert.equal(sql('SELECT \\"index\\", name FROM LIBRARY_CODE WHERE name = ?'), '3750,sql-text-number');
  assert.throws(() => store.evaluate(MODULES, 'ExecuteSQL ( "DELETE FROM LIBRARY_CODE" ; "" ; "" )'), (e: StoreError) => e.code === 1200 && /Only SELECT/.test(e.message));
  assert.equal(sql('SELECT COUNT(*) FROM LIBRARY_CODE WHERE name = ?'), '1');
});

test('Get ( AccountPrivilegeSetName ) from the file\'s accounts', { skip }, () => {
  const set = (account: string) => store.evaluate(MODULES, 'Get ( AccountPrivilegeSetName )', undefined, { account }).value;
  assert.equal(set('Admin'), '[Full Access]');
  assert.equal(set('workgroup'), 'workgroup');
  assert.equal(set('[Guest]'), '[Read-Only Access]');
});

test('numbers past 2^53 and returns round-trip through the store', { skip }, () => {
  const { recordId } = store.create(MODULES, { name: 'big-number', index: '1234567890123456789' });
  const r = store.get(MODULES, recordId, 'iso').fieldData;
  assert.ok(Math.abs(Number(r.index) - 1234567890123456789) < 1e4);
  assert.equal(store.evaluate(MODULES, 'Length ( "a" & ¶ & "b" ) & PatternCount ( "x¶y" ; ¶ )', recordId).value, '31');
});
