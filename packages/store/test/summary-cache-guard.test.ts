// A guard on the shared summary cache: summaries over calculations of the
// shapes real files use (a related field through a stored or a global match
// key, an occurrence or a field with brackets in its name) are worked out once
// and read by the next process from the shared results. A change that makes
// the stability rule more cautious than it needs to be fails here, instead of
// showing up as every layout read working its summaries out again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';
import { markExecutionRefusal } from '../../calc/src/index.ts';

const shapes: [string, string][] = [
  ['a related field through a stored key', 'Total * Rates::Factor'],
  ['an occurrence with brackets in its name', 'Total * Rates (Open)::Factor'],
  ['a related field with brackets in its name', 'Total * Rates::Factor (net)'],
  ['a global match key', 'Total * Rates (Picked)::Factor'],
  ['its own occurrence by name, and a stored calculation', 'Orders::Total * Rates::Factor + Double'],
];

for (const [what, formula] of shapes) test(`a summary over a calculation reading ${what} is worked out once and shared`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sum-guard-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const setup = new Store(path, 'Shop');
  setup.applyDesign([
    { op: 'createTable', name: 'Rates', fields: [{ name: 'Currency', type: 'text' }, { name: 'Factor', type: 'number' }, { name: 'Factor (net)', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Cur', type: 'text' }, { name: 'Total', type: 'number' }, { name: 'gCur', type: 'text', options: { global: true } }] },
    { op: 'createOccurrence', name: 'Rates (Open)', table: 'Rates' },
    { op: 'createOccurrence', name: 'Rates (Picked)', table: 'Rates' },
    { op: 'createRelationship', left: 'Orders', right: 'Rates', predicates: [{ left: 'Cur', right: 'Currency' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Rates (Open)', predicates: [{ left: 'Cur', right: 'Currency' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Rates (Picked)', predicates: [{ left: 'gCur', right: 'Currency' }] },
    { op: 'createField', table: 'Orders', name: 'Double', type: 'number', kind: 'calculation', calculation: 'Total * 2' },
    { op: 'createField', table: 'Orders', name: 'Conv', type: 'number', kind: 'calculation', calculation: formula, options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'sConv', kind: 'summary', summary: { type: 'total', field: 'Conv' } },
  ] as never);
  setup.create('Rates', { Currency: 'USD', Factor: '2', 'Factor (net)': '3' });
  for (let i = 1; i <= 4; i++) setup.create('Orders', { Cur: 'USD', Total: String(i) });
  setup.setGlobalField('Orders::gCur', 'USD');
  setup.close();
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  const notes: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array) => {
    if (String(chunk).startsWith('[sum]')) notes.push(String(chunk).trim());
    return true;
  }) as typeof process.stderr.write;
  const a = new Store(path, 'Shop');
  const b = new Store(path, 'Shop');
  try {
    a.shareResults();
    b.shareResults();
    const read = (s: Store) => Number(s.find('Orders', { limit: 1 }).records[0].fieldData.sConv);
    const first = read(a);
    assert.ok(first > 0);
    assert.ok(notes.length > 0, 'the first read works it out');
    notes.length = 0;
    assert.equal(read(b), first);
    assert.deepEqual(notes, [], 'another process reads it from the shared results');
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const failure of ['refusal', 'commit'] as const) test(`a ${failure} failure publishes no prepared summary and leaves no future cached result`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sum-rollback-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'Double', type: 'number', kind: 'calculation', calculation: 'Value * 2', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Value' } },
    { op: 'createField', table: 'T', name: 'Doubled', kind: 'summary', summary: { type: 'total', field: 'Double' } },
  ]);
  const { recordId } = store.create('T', { Value: '3' });
  store.shareResults();
  assert.ok(store.results);
  assert.equal(store.warmSummaries('T'), 2);
  const stamp = store.dataStamp();
  const put = t.mock.method(store.results, 'put');
  const error = new StoreError(212, 'refused during summary recomputation');
  if (failure === 'refusal') markExecutionRefusal(error);
  let reached = false;
  if (failure === 'refusal') {
    const value = store.calc.value.bind(store.calc);
    t.mock.method(store.calc, 'value', (...args: Parameters<typeof value>) => {
      if (args[1].name === 'Double') { reached = true; throw error; }
      return value(...args);
    });
  } else {
    const exec = store.sql.exec.bind(store.sql);
    t.mock.method(store.sql, 'exec', (sql: string) => {
      if (sql === 'COMMIT') { reached = true; throw error; }
      return exec(sql);
    });
  }
  assert.throws(() => store.update('T', recordId, { Value: '7' }), (e: unknown) => e === error);
  assert.equal(reached, true);
  assert.equal(store.sql.isTransaction, false);
  assert.equal(store.dataStamp(), stamp);
  assert.equal(store.sql.prepare('SELECT Value FROM T').get()?.Value, 3);
  assert.equal(put.mock.callCount(), 0, 'an earlier prepared summary must not escape a later failure');
  t.mock.restoreAll();
  // Reuse the rolled-back data version with different data: no result from the failed write may stand in.
  store.update('T', recordId, { Value: '11' });
  const observer = new Store(path, 'Shop');
  t.after(() => observer.close());
  observer.shareResults();
  for (const reader of [store, observer]) {
    const data = reader.get('T', recordId).fieldData;
    assert.equal(Number(data.Total), 11);
    assert.equal(Number(data.Doubled), 22);
  }
});

test('incremental summaries exclude SQL, dynamic/design reads and plug-ins, including indirect and zero-argument calls', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sum-eligibility-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'number' }] }]);
  const formulas = [
    ['SQL', 'ExecuteSQL ( "SELECT Value FROM T" ; "" ; "" )'],
    ['PluginSQL', 'BE_FileMakerSQL ( "SELECT Value FROM T" )'],
    ['IndirectSQL', 'PluginSQL * 2'],
    ['Dynamic', 'Evaluate ( "Value" )'],
    ['DynamicField', 'GetField ( "Value" )'],
    ['FieldName', 'GetFieldName ( Value )'],
    ['LookupValue', 'Lookup ( Value )'],
    ['LookupNearest', 'LookupNext ( Value ; Higher )'],
    ['Nth', 'GetNthRecord ( Value ; 1 )'],
    ['Summary', 'GetSummary ( Total ; Value )'],
    ['Values', 'ValueListItems ( "" ; "Items" )'],
    ['Fields', 'FieldNames ( "" ; "T" )'],
    ['LayoutFields', 'GetFieldsOnLayout ( "T" )'],
    ['DDL', 'GetTableDDL ( "T" )'],
    ['Plugin', 'Remote_SQL ( Value )'],
    ['BarePlugin', 'Remote_SQL'],
    ['Own', 'Let ( n = Value ; n * 2 )'],
    ['Literal', 'Length ( "BE_FileMakerSQL (" ) + Value'],
  ];
  for (const [name, calculation] of formulas) {
    store.applyDesign([
      { op: 'createField', table: 'T', name, type: 'number', kind: 'calculation', calculation, options: { unstored: true } },
      { op: 'createField', table: 'T', name: `s${name}`, kind: 'summary', summary: { type: 'total', field: name } },
    ]);
  }
  const table = store.schema.tables[0];
  assert.deepEqual(store.calc.deltaFields(table).map(({ of }) => of.name), ['Own', 'Literal']);
});

for (const formula of ['GetSummary ( Total ; Total )', 'ExecuteSQL ( "SELECT Echo FROM T" ; "" ; "" )']) test(`a refused prepared ${formula.split(' ')[0]} read leaves no cached result at the rolled-back version`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sum-nested-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'Echo', type: 'number', kind: 'calculation', calculation: 'Value * 2', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'Nested', type: 'number', kind: 'calculation', calculation: formula, options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Value' } },
    { op: 'createField', table: 'T', name: 'NestedTotal', kind: 'summary', summary: { type: 'total', field: 'Nested' } },
    { op: 'createField', table: 'T', name: 'Last', kind: 'summary', summary: { type: 'total', field: 'Echo' } },
  ]);
  const { recordId } = store.create('T', { Value: '3' });
  store.shareResults();
  assert.equal(store.warmSummaries('T'), 3);
  const stamp = store.dataStamp();
  const error = new StoreError(212, 'refused after a nested summary read');
  markExecutionRefusal(error);
  let nested = false, readingNested = false;
  const value = store.calc.value.bind(store.calc);
  t.mock.method(store.calc, 'value', (...args: Parameters<typeof value>) => {
    if (args[1].name === 'Nested') {
      readingNested = true;
      try { return value(...args); } finally { readingNested = false; nested = true; }
    }
    if (args[1].name === 'Echo' && nested && !readingNested) throw error;
    return value(...args);
  });
  assert.throws(() => store.update('T', recordId, { Value: '7' }), (e: unknown) => e === error);
  assert.equal(nested, true);
  assert.equal(store.dataStamp(), stamp);
  assert.equal(store.sql.prepare('SELECT Value FROM T').get()?.Value, 3);
  t.mock.restoreAll();
  // A writer that doesn't publish deltas reuses the rolled-back version. Local reads must compute from its actual data.
  store.sql.prepare('UPDATE T SET Value = ? WHERE _fm_record_id = ?').run(11, recordId);
  const data = store.get('T', recordId).fieldData;
  assert.equal(Number(data.Total), 11);
  assert.equal(Number(data.Nested), formula.startsWith('GetSummary') ? 11 : 22);
});
