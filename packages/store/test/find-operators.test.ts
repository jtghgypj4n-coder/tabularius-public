import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError, type FindRequest } from '../src/index.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-find-operators-'));
  const path = join(dir, 'Find.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
    { name: 'Text' }, { name: 'Status' }, { name: 'Number', type: 'number' },
    { name: 'Day', type: 'date' }, { name: 'Time', type: 'time' }, { name: 'Stamp', type: 'timestamp' },
    { name: 'Photo', type: 'container' }, { name: 'Tags', options: { repetitions: 3 } },
  ] }]);
  const ids = (query: FindRequest[]) => {
    const found = store.find('Items', { query }).records.map((r) => r.recordId);
    assert.deepEqual(store.findIds('Items', { query }), found, 'find and Perform Find use the same criteria');
    return found;
  };
  return { store, ids };
}

test('find !: duplicates across records, suffix, other criteria and omit requests', (t) => {
  const { store, ids } = fixture(t);
  const a = store.create('Items', { Text: 'ABC Company', Status: 'active', Number: 42 }).recordId;
  const b = store.create('Items', { Text: 'abc company', Status: 'inactive', Number: 42 }).recordId;
  store.create('Items', { Text: 'Company ABC', Status: 'active', Number: 7 });
  store.create('Items', { Text: 'Solo Solo', Status: 'active' });
  store.create('Items', {});
  store.create('Items', {});
  assert.deepEqual(ids([{ Text: '!' }]), [a, b]);
  assert.deepEqual(ids([{ Text: '!ABC' }]), [a, b]);
  assert.deepEqual(ids([{ Text: '!', Status: 'active' }]), [a]);
  assert.deepEqual(ids([{ Text: '!' }, { Status: 'inactive', omit: 'true' }]), [a]);
  assert.equal(ids([{ Text: '*' }, { Text: '!', omit: 'true' }]).length, 2);
  assert.equal(ids([{ Text: '!', omit: 'true' }]).length, 4);
  assert.deepEqual(ids([{ Number: '!' }]), [a, b]);
  const prefix = 'x'.repeat(100);
  const c = store.create('Items', { Text: prefix + 'a' }).recordId;
  const d = store.create('Items', { Text: prefix + 'b' }).recordId;
  assert.deepEqual(ids([{ Text: '!x' }]), [c, d]);
});

test('find !: repetitions count distinct records and related fields share the parser', (t) => {
  const { store, ids } = fixture(t);
  const a = store.create('Items', { Text: 'A', 'Tags(1)': 'red', 'Tags(2)': 'red' }).recordId;
  assert.deepEqual(ids([{ Tags: '!' }]), []);
  const b = store.create('Items', { Text: 'B', 'Tags(2)': 'red' }).recordId;
  assert.deepEqual(ids([{ Tags: '!' }]), [a, b]);
  store.applyDesign([
    { op: 'createTable', name: 'Links', fields: [{ name: 'Item' }] },
    { op: 'createRelationship', left: 'Links', right: 'Items', predicates: [{ left: 'Item', right: 'Text' }] },
  ]);
  store.create('Links', { Item: 'B' });
  assert.equal(store.find('Links', { query: [{ 'Items::Tags': '!' }] }).foundCount, 1);
});

test('find !: computed duplicates are determined before filtering, including related calculations', (t) => {
  const { store, ids } = fixture(t);
  store.applyDesign([
    { op: 'createField', table: 'Items', name: 'Group', type: 'text', kind: 'calculation', calculation: 'Lower ( Text )', options: { unstored: true } },
    { op: 'createTable', name: 'Links', fields: [{ name: 'Item' }] },
    { op: 'createRelationship', left: 'Links', right: 'Items', predicates: [{ left: 'Item', right: 'Status' }] },
  ]);
  const a = store.create('Items', { Text: 'ABC', Status: 'active' }).recordId;
  store.create('Items', { Text: 'ABC', Status: 'inactive' });
  store.create('Items', { Text: 'solo', Status: 'active' });
  store.create('Links', { Item: 'active' });
  assert.deepEqual(ids([{ Group: '!', Status: 'active' }]), [a]);
  assert.equal(store.find('Links', { query: [{ 'Items::Group': '!', 'Items::Status': 'active' }] }).foundCount, 1);
});

test('find //: local today, comparisons, date ranges and whole timestamp days', (t) => {
  const { store, ids } = fixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 6, 3, 23, 45) });
  const a = store.create('Items', { Day: '2026-07-03', Stamp: '2026-07-03T23:59:59' }).recordId;
  const b = store.create('Items', { Day: '2026-07-04', Stamp: '2026-07-04T00:00:00' }).recordId;
  store.create('Items', { Day: '2026-07-02', Stamp: '2026-07-02T23:59:59' });
  for (const field of ['Day', 'Stamp']) {
    assert.deepEqual(ids([{ [field]: '//' }]), [a]);
    assert.deepEqual(ids([{ [field]: '//...7/4/2026' }]), [a, b]);
    assert.deepEqual(ids([{ [field]: '7/3/2026…//' }]), [a]);
    assert.deepEqual(ids([{ [field]: '>=//' }]), [a, b]);
    assert.deepEqual(ids([{ [field]: '>//' }]), [b]);
    assert.deepEqual(ids([{ [field]: '//...' }]), [a, b]);
    assert.equal(ids([{ [field]: '...//' }]).length, 2);
  }
  assert.deepEqual(ids([{ Day: '//...' }]), [a, b]);
  assert.equal(ids([{ Day: '...//' }]).length, 2);
});

test('find ?: invalid nonempty dates, times and timestamps, including calendar overflow', (t) => {
  const { store, ids } = fixture(t);
  store.create('Items', { Day: '2024-02-29', Time: '23:59:59.5', Stamp: '2024-02-29T23:59:59.5' });
  store.create('Items', { Time: '-12:30:00' });
  store.create('Items', { Time: '100:00:00' });
  const a = store.create('Items', { Day: '2025-02-29', Time: '12:60:00', Stamp: '2024-02-30T12:00:00' }).recordId;
  const b = store.create('Items', { Day: 'next Tuesday', Time: 'midnight', Stamp: '2024-01-01T24:00:00' }).recordId;
  const c = store.create('Items', { Day: '0000-01-01', Time: '00:00:60', Stamp: '4001-01-01T00:00:00' }).recordId;
  store.create('Items', {});
  for (const field of ['Day', 'Time', 'Stamp']) assert.deepEqual(ids([{ [field]: '?' }]), [a, b, c]);
});

test('find #: one digit, word boundaries, @ and * together, quoted and escaped literals', (t) => {
  const { store, ids } = fixture(t);
  const values = ['3', '30', '300', '53', '43', 'A3x', 'A30x', 'Axx', 'box 3', '#', '@', '*'];
  const records = values.map((Text) => store.create('Items', { Text }).recordId);
  const matches = (criterion: string) => ids([{ Text: criterion }]).map((id) => values[records.indexOf(id)]);
  assert.deepEqual(matches('#'), ['3', 'box 3']);
  assert.deepEqual(matches('##'), ['30', '53', '43']);
  assert.deepEqual(matches('#3'), ['53', '43']);
  assert.deepEqual(matches('A#@'), ['A3x']);
  assert.deepEqual(matches('A#*'), ['A3x', 'A30x']);
  assert.deepEqual(matches('*#*'), values.slice(0, 7).concat('box 3'));
  assert.deepEqual(matches('==#'), ['3']);
  const numeric = [3, 30, 300, 53, 43].map((Number) => store.create('Items', { Number }).recordId);
  assert.deepEqual(ids([{ Number: '#' }]), [numeric[0]]);
  assert.deepEqual(ids([{ Number: '##' }]), [numeric[1], numeric[3], numeric[4]]);
  for (const char of ['#', '@', '*']) {
    assert.deepEqual(matches(`"${char}"`), [char]);
    assert.deepEqual(matches(`\\${char}`), [char]);
  }
  // Same results with the optional word index disabled.
  store.words.enabled = false;
  assert.deepEqual(matches('A#@'), ['A3x']);
});

test('find ~: accents, kana width, voice, size, iteration marks and compatibility kanji', (t) => {
  const { store, ids } = fixture(t);
  const values = ['café', 'CAFE', 'cafe\u0301', 'は', 'ば', 'ぱ', 'ハ', 'ﾊﾟ', 'ゃ', 'ヤ', 'くゝ', 'クヾ', '神', '神', 'other'];
  const records = values.map((Text) => store.create('Items', { Text }).recordId);
  const matches = (criterion: string) => ids([{ Text: criterion }]).map((id) => values[records.indexOf(id)]);
  assert.deepEqual(matches('~cafe'), values.slice(0, 3));
  assert.deepEqual(matches('~は'), values.slice(3, 8));
  assert.deepEqual(matches('~や'), values.slice(8, 10));
  assert.deepEqual(matches('~くゝ'), values.slice(10, 12));
  assert.deepEqual(matches('~神'), values.slice(12, 14));
  assert.deepEqual(matches('~==cafe'), values.slice(0, 3));
  const literal = store.create('Items', { Text: '~cafe' }).recordId;
  assert.deepEqual(ids([{ Text: '"~cafe"' }]), [literal]);
  assert.deepEqual(ids([{ Text: '\\~cafe' }]), [literal]);
  store.words.enabled = false;
  assert.deepEqual(matches('~は'), values.slice(3, 8));
});

test('find operators: unsuitable types never throw, unsupported syntax has a FileMaker code', (t) => {
  const { store, ids } = fixture(t);
  store.create('Items', { Number: 0, Text: 'literal ?' });
  for (const field of ['Number', 'Time', 'Photo']) {
    for (const value of ['//', '~abc', ...(field === 'Number' ? [] : ['#'])]) assert.deepEqual(ids([{ [field]: value }]), []);
  }
  assert.deepEqual(ids([{ Text: '?' }]), []);
  assert.deepEqual(ids([{ Number: '?' }]), []);
  assert.equal(ids([{ Number: '#' }]).length, 1);
  for (const query of [[{ Text: '~' }], [{ Photo: '!' }], [{ Text: '"#' }], [{ Text: 'abc\\' }]]) {
    assert.throws(() => ids(query), (e: unknown) => e instanceof StoreError && e.code === 400 && !!e.message);
  }
});

test('typed range endpoints are validated before compiling SQL, including related and repeating fields', (t) => {
  const { store, ids } = fixture(t);
  const id = store.create('Items', { Text: 'x', Number: 30.3, Day: '2026-07-03', Time: '12:30:00', Stamp: '2026-07-03T12:30:00' }).recordId;
  store.applyDesign([
    { op: 'createField', table: 'Items', name: 'Numbers', type: 'number', options: { repetitions: 3 } },
    { op: 'createTable', name: 'Links', fields: [{ name: 'Item' }] },
    { op: 'createRelationship', left: 'Links', right: 'Items', predicates: [{ left: 'Item', right: 'Text' }] },
  ]);
  store.create('Links', { Item: 'x' });
  for (const [field, value] of [
    ['Number', '1...2...3'], ['Numbers', '1...2...3'], ['Day', '2026-07-01...2026-02-30'],
    ['Time', '12:00...12:60'], ['Stamp', '2026-07-01...2026-07-03T24:00:00'],
    ['Stamp', '2026-07-01...2026-07-03...2026-07-04'],
  ]) {
    assert.throws(() => ids([{ [field]: value }]), (e: unknown) => e instanceof StoreError && e.code === 508);
    assert.throws(() => store.findIds('Links', { query: [{ [`Items::${field}`]: value }] }),
      (e: unknown) => e instanceof StoreError && e.code === 508);
  }
  for (const [field, value] of [
    ['Number', '30.2...30.4'], ['Day', '7/1/2026...7/3/2026'], ['Time', '12:00...13:00'],
    ['Stamp', '7/1/2026...7/3/2026'], ['Stamp', '2026-07-03T12:00:00...2026-07-03T13:00:00'],
  ]) assert.deepEqual(ids([{ [field]: value }]), [id]);
});

test('find < <= > >= and a...b on text: some word is in range in index order, ignoring case and accents', (t) => {
  const { store, ids } = fixture(t);
  const apple = store.create('Items', { Text: 'Apple' }).recordId;
  const banana = store.create('Items', { Text: 'banana' }).recordId;
  const cherry = store.create('Items', { Text: 'Cherry' }).recordId;
  const eclair = store.create('Items', { Text: 'Éclair pie' }).recordId;
  store.create('Items', {});
  assert.deepEqual(ids([{ Text: '>=b' }]), [banana, cherry, eclair]);
  assert.deepEqual(ids([{ Text: '>b' }]), [banana, cherry, eclair], 'banana is after the word "b"');
  assert.deepEqual(ids([{ Text: '<b' }]), [apple]);
  assert.deepEqual(ids([{ Text: '<=Banana' }]), [apple, banana], 'case does not matter');
  assert.deepEqual(ids([{ Text: '≥c' }]), [cherry, eclair]);
  assert.deepEqual(ids([{ Text: 'a...c' }]), [apple, banana], 'cherry is after the word "c"');
  assert.deepEqual(ids([{ Text: 'a...cz' }]), [apple, banana, cherry]);
  // Any word counts: "pie" is in p...q although the value starts with E.
  assert.deepEqual(ids([{ Text: 'p...q' }]), [eclair]);
  // Accents are ignored: É sorts as e.
  assert.deepEqual(ids([{ Text: 'e...f' }]), [eclair]);
});
