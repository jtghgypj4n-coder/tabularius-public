import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';
import type { FieldType } from '../../fmp12/src/index.ts';

function file(run: (store: Store, path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-integrity-'));
  const path = join(dir, 'Test.sqlite');
  createStore(path);
  const store = new Store(path, 'Test');
  try { run(store, path); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

const code = (wanted: number) => (e: unknown) => e instanceof StoreError && e.code === wanted;

test('write keys cannot address absent repetitions or grow an unbounded array', () => file((store) => {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'Note', options: { repetitions: 3 } }, { name: 'Name' },
  ] }]);
  const id = store.create('T', { 'Note(2)': 'ok' }).recordId;
  for (const key of ['Note(0)', 'Note(2000000000)', 'Note(4)', 'Name(2)']) {
    assert.throws(() => store.update('T', id, { [key]: 'bad' }), code(102));
  }
  assert.throws(() => store.update('T', id, { Note: '[1,2,3,4]' }), code(102));
  assert.equal(store.get('T', id).fieldData['Note(2)'], 'ok');
  assert.equal(store.get('T', id).fieldData.Name, '');
  assert.equal(store.schema.tables[0].fields.find((f) => f.name === 'Name')?.options?.repetitions ?? 1, 1);
}));

test('validation checks every repetition, including uniqueness across records', () => file((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Required', fields: [{ name: 'V', options: { repetitions: 2, validation: { notEmpty: true } } }] },
    { op: 'createTable', name: 'Range', fields: [{ name: 'V', type: 'number', options: { repetitions: 2, validation: { range: { min: '1', max: '10' } } } }] },
    { op: 'createTable', name: 'Length', fields: [{ name: 'V', options: { repetitions: 2, validation: { maxLength: 3 } } }] },
    { op: 'createTable', name: 'Unique', fields: [{ name: 'V', options: { repetitions: 2, validation: { unique: true } } }] },
  ]);
  // Not empty applies to the first repetition (FileMaker's rule for later empty repetitions is undocumented).
  assert.throws(() => store.create('Required', { 'V(2)': 'a' }), code(509));
  assert.doesNotThrow(() => store.create('Required', { V: 'a' }));
  assert.throws(() => store.create('Range', { V: '2', 'V(2)': '11' }), code(503));
  assert.throws(() => store.create('Length', { V: 'a', 'V(2)': 'long' }), code(511));
  store.create('Unique', { V: 'alpha', 'V(2)': 'Bravo' });
  assert.throws(() => store.create('Unique', { V: 'charlie', 'V(2)': 'bravo' }), code(504));
  store.create('Unique', { V: '[literal', 'V(2)': 'delta' });
  assert.throws(() => store.create('Unique', { V: 'echo', 'V(2)': '[LITERAL' }), code(504));
}));

test('repetition validation scans once per field and keeps cross-position, Unicode and existing-value checks', (t) => file((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Unique', fields: [{ name: 'V', options: { repetitions: 3, validation: { unique: true } } }] },
    { op: 'createTable', name: 'Existing', fields: [{ name: 'V', type: 'number', options: { repetitions: 3, validation: { existing: true } } }] },
  ]);
  const first = store.create('Unique', { V: 'alpha', 'V(2)': 'Éclair', 'V(3)': '[literal' }).recordId;
  // Include legacy scalar storage as well as an array, and values in different positions/records.
  store.sql.prepare('INSERT INTO "Existing" (_fm_record_id, V) VALUES (?, ?)').run(1, 5);
  store.sql.prepare('INSERT INTO "Existing" (_fm_record_id, V) VALUES (?, ?)').run(2, '[6,7]');
  const prepare = store.sql.prepare.bind(store.sql);
  let scans = 0;
  t.mock.method(store.sql, 'prepare', (sql: string) => {
    if (sql.includes('json_each') && /FROM "(?:Unique|Existing)"/.test(sql)) scans++;
    return prepare(sql);
  });
  const once = (run: () => void) => {
    scans = 0;
    run();
    assert.equal(scans, 1, 'all repetitions share one query');
  };
  once(() => { store.create('Unique', { V: 'bravo', 'V(2)': 'charlie', 'V(3)': 'delta' }); });
  once(() => store.update('Unique', first, { V: 'alpha', 'V(2)': 'Éclair', 'V(3)': '[literal' }));
  once(() => assert.throws(() => store.create('Unique', { V: 'éCLAIR' }), code(504)));
  once(() => assert.throws(() => store.create('Unique', { V: 'new', 'V(3)': 'ALPHA' }), code(504)));
  once(() => assert.throws(() => store.create('Unique', { V: '[LITERAL' }), code(504)));
  once(() => { store.create('Existing', { V: '7', 'V(2)': '5', 'V(3)': '6' }); });
  once(() => assert.throws(() => store.create('Existing', { V: '7', 'V(2)': '5', 'V(3)': '8' }), code(505)));
}));

test('deleting a find index or relationship match column drops covering indexes first', () => file((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'A', fields: [{ name: 'FindKey' }, { name: 'MatchKey' }] },
    { op: 'createTable', name: 'B', fields: [{ name: 'MatchKey' }] },
    { op: 'createRelationship', left: 'A', right: 'B', predicates: [{ left: 'MatchKey', right: 'MatchKey' }] },
  ]);
  store.addFieldIndex('A', 'FindKey');
  store.create('A', { FindKey: 'find', MatchKey: 'match' });
  store.create('B', { MatchKey: 'match' });
  const match = store.schema.tables.find((t) => t.name === 'A')!;
  store.calc.ensureIndex(match, match.fields.find((f) => f.name === 'MatchKey')!);
  assert.ok(store.sql.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'A' AND name LIKE '_fm_match_%'").get());
  store.applyDesign([{ op: 'deleteField', table: 'A', field: 'FindKey' }]);
  store.applyDesign([{ op: 'deleteField', table: 'A', field: 'MatchKey' }]);
  assert.deepEqual(store.sql.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'A' AND name LIKE '_fm_%'").all(), []);
  assert.equal(store.schema.tables.find((t) => t.name === 'A')?.fields.length, 0);
}));

test('retype visits the text, number and temporal matrix and keeps a copy before container conversion', () => file((store) => {
  const types: FieldType[] = ['text', 'number', 'date', 'time', 'timestamp'];
  const values = ['007', '1,5', '0x10', '10/11/2026', '[literal'];
  for (const from of types) {
    const table = `From_${from}`;
    store.applyDesign([{ op: 'createTable', name: table, fields: types.map((to) => ({ name: `To_${to}`, type: from })) }]);
    for (const value of values) store.create(table, Object.fromEntries(types.map((to) => [`To_${to}`, value])));
    for (const to of types) if (to !== from) store.applyDesign([{ op: 'updateField', table, field: `To_${to}`, type: to }]);
    assert.equal(store.query(`SELECT count(*) AS n FROM "${table}"`)[0].n, values.length);
  }
  assert.equal(store.query('SELECT "To_number" AS v FROM "From_text" WHERE _fm_record_id = 1')[0].v, 7);
  assert.equal(store.query('SELECT "To_number" AS v FROM "From_text" WHERE _fm_record_id = 2')[0].v, 15);
  assert.equal(store.query('SELECT "To_number" AS v FROM "From_text" WHERE _fm_record_id = 3')[0].v, 16);
  assert.equal(store.query('SELECT "To_date" AS v FROM "From_text" WHERE _fm_record_id = 4')[0].v, '2026-10-11');
  assert.equal(store.query('SELECT "To_number" AS v FROM "From_text" WHERE _fm_record_id = 5')[0].v, '[literal');
  assert.equal(store.query('SELECT "To_text" AS v FROM "From_number" WHERE _fm_record_id = 1')[0].v, '7');
  store.applyDesign([{ op: 'updateField', table: 'From_text', field: 'To_text', type: 'container' }]);
  assert.equal(store.query('SELECT count("To_text") AS n FROM "From_text"')[0].n, 0);
  const kept = store.deletedDesigns().find((x) => x.table === 'From_text' && x.name === 'To_text');
  assert.ok(kept);
  assert.equal((store.sql.prepare(`SELECT count(*) AS n FROM "_fm_deleted_${kept.id}"`).get() as { n: number }).n, values.length);
  store.applyDesign([{ op: 'restoreDeleted', deleted: kept.id }]);
  assert.equal(store.schema.tables.find((t) => t.name === 'From_text')?.fields.find((f) => f.name === 'To_text')?.type, 'text');
  assert.deepEqual(store.query('SELECT "To_text" AS v FROM "From_text" ORDER BY _fm_record_id').map((r) => r.v), values);
}));

test('two store connections allocate distinct serials and reject a duplicate unique value', () => file((one, path) => {
  one.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'Serial', type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 } } } },
    { name: 'Unique', options: { validation: { unique: true } } },
    { name: 'GlobalA', options: { global: true } },
    { name: 'GlobalB', options: { global: true } },
  ] }]);
  const two = new Store(path, 'Test');
  try {
    // Both instances have read the original serial metadata before either writes.
    const field = one.schema.tables[0].fields[0];
    assert.equal(one.calc.peekSerial(one.schema.tables[0], field), '1');
    assert.equal(two.calc.peekSerial(two.schema.tables[0], field), '1');
    assert.equal(one.calc.globalValue(one.schema.tables[0], one.schema.tables[0].fields[2]), null);
    assert.equal(two.calc.globalValue(two.schema.tables[0], two.schema.tables[0].fields[3]), null);
    one.setGlobalField('T::GlobalA', 'first');
    two.setGlobalField('T::GlobalB', 'second');
    assert.equal(one.calc.globalValue(one.schema.tables[0], one.schema.tables[0].fields[3]), 'second');
    assert.equal(two.calc.globalValue(two.schema.tables[0], two.schema.tables[0].fields[2]), 'first');
    const a = one.create('T', { Unique: 'same' });
    assert.throws(() => two.create('T', { Unique: 'same' }), code(504));
    const b = two.create('T', { Unique: 'other' });
    assert.notEqual(a.recordId, b.recordId);
    assert.deepEqual(one.query('SELECT "Serial" AS s FROM T ORDER BY _fm_record_id').map((r) => r.s), [1, 2]);
  } finally { two.close(); }
}));

for (const { from, to, values, expected } of [
  { from: 'text', to: 'number', values: ['5', '6'], expected: [5, 6] },
  { from: 'text', to: 'number', values: ['007', null, '1,500'], expected: [7, null, 1500] },
  { from: 'number', to: 'text', values: [5, null, 6], expected: ['5', null, '6'] },
  { from: 'text', to: 'date', values: ['10/11/2026', null, '11/12/2026'], expected: ['2026-10-11', null, '2026-11-12'] },
] satisfies { from: FieldType; to: FieldType; values: (string | number | null)[]; expected: (string | number | null)[] }[]) {
  test(`retype ${from}->${to} preserves repetitions ${JSON.stringify(values)}`, () => file((store) => {
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'V', type: from, options: { repetitions: 3 } }] }]);
    const id = store.create('T', { V: JSON.stringify(values) }).recordId;
    store.applyDesign([{ op: 'updateField', table: 'T', field: 'V', type: to }]);
    const raw = store.query('SELECT V FROM T')[0].V;
    assert.equal(typeof raw, 'string');
    assert.deepEqual(JSON.parse(String(raw)), expected);
    const shown = store.get('T', id, 'iso').fieldData;
    for (let rep = 1; rep <= expected.length; rep++) assert.equal(shown[rep === 1 ? 'V' : `V(${rep})`], expected[rep - 1] ?? '');
  }));
}

test('globals reuse decoded metadata and refresh after another connection writes, local writes and rollback', (t) => file((one, path) => {
  one.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'N', type: 'number' },
    { name: 'G', type: 'number', options: { global: true } },
    { name: 'Computed', type: 'number', kind: 'calculation', calculation: 'N + G', options: { unstored: true } },
  ] }]);
  for (let n = 1; n <= 12; n++) one.create('T', { N: n });
  one.setGlobalField('T::G', 10);
  const two = new Store(path, 'Test');
  try {
    const prepare = one.sql.prepare.bind(one.sql);
    let reads = 0;
    t.mock.method(one.sql, 'prepare', (sql: string) => {
      const statement = prepare(sql);
      if (sql === 'SELECT json FROM _fm_meta WHERE key = ?') {
        const get = statement.get.bind(statement);
        t.mock.method(statement, 'get', (key: string) => {
          if (key === 'globals') reads++;
          return get(key);
        });
      }
      return statement;
    });
    const find = (offset: number) => {
      reads = 0;
      const result = one.find('T', { query: [{ Computed: '>0' }], sort: [{ fieldName: 'Computed', sortOrder: 'descend' }], limit: 20 });
      assert.deepEqual(result.records.map((r) => r.fieldData.Computed), Array.from({ length: 12 }, (_, i) => offset + 12 - i));
      return reads;
    };
    assert.equal(find(10), 1, 'a find/sort loads globals once, regardless of its row count');
    assert.equal(find(10), 0, 'an unchanged data version reuses the decoded globals');
    two.setGlobalField('T::G', 20);
    assert.equal(find(20), 1, 'an external commit invalidates the cached globals');
    assert.equal(find(20), 0);
    one.setGlobalField('T::G', 30);
    assert.equal(find(30), 1, 'our own writes invalidate globals without a data_version change');
    const trial = one.trial();
    one.setGlobalField('T::G', 40);
    assert.equal(find(40), 1);
    assert.equal(find(40), 0, 'repeated reads within the transaction reuse metadata');
    trial.undo();
    assert.equal(find(30), 1, 'rollback must not retain the uncommitted global');
  } finally { two.close(); }
}));
