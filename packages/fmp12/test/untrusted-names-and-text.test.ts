import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mimeOf } from '../src/containers.ts';
import { FmpDatabase, decodeMergeFields } from '../src/index.ts';
import { fontStack } from '../src/styles.ts';
import { parseDate, typedValue } from '../src/values.ts';

test('fmp12-18: inherited MIME keys use a string fallback that SQLite can bind', () => {
  const bytes = new Uint8Array(4);
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec('CREATE TABLE blobs (mime TEXT NOT NULL)');
    const insert = sql.prepare('INSERT INTO blobs (mime) VALUES (?)');
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      for (const mime of [mimeOf('????', `a.${key}`, bytes), mimeOf(key, undefined, bytes)]) {
        assert.equal(typeof mime, 'string', key);
        assert.equal(mime, 'application/octet-stream', key);
        insert.run(mime);
      }
    }
    assert.equal(mimeOf('????', 'a.pdf', bytes), 'application/pdf');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM blobs').get()!.n, 8);
  } finally {
    sql.close();
  }
});

test('fmp12-19: record fields preserve __proto__ and do not inherit constructor', () => {
  const db = Object.assign(Object.create(FmpDatabase.prototype), {
    schemaCache: { tables: [{ id: 1, name: 'Items', fields: [
      { id: 1, name: '__proto__', type: 'text' },
      { id: 2, name: 'Name', type: 'text' },
      { id: 3, name: 'constructor', type: 'text' },
    ] }] },
    *rawRecords() { yield { id: 1, values: new Map([[1, ['hello']], [2, ['item']]]) }; },
  }) as FmpDatabase;
  const fields = [...db.records(1)][0].fields;
  assert.equal(Object.getPrototypeOf(fields), null);
  assert.equal(Object.hasOwn(fields, '__proto__'), true);
  assert.equal(fields.__proto__, 'hello');
  assert.equal(fields.Name, 'item');
  assert.equal(Object.hasOwn(fields, 'constructor'), false);
  assert.equal(fields.constructor, undefined);
});

test('fmp12-20: two-byte path ids are not read as repetitions', () => {
  const marker = (payload: string) => `<<\x01\x02\x0e0003d00023${payload}>>`;
  const names = (to: number, field: number) => to === 163 ? new Map([
    [6, 'T::Short'], [33, 'T::Repeated'], [128, 'T::F128'], [135, 'T::F135'],
  ]).get(field) : undefined;
  assert.equal(decodeMergeFields(marker('028007'), names), '<<T::F135>>');
  assert.equal(decodeMergeFields(marker('0106'), names), '<<T::Short>>');
  assert.equal(decodeMergeFields(marker('022102'), names), '<<T::Repeated[2]>>');
});

test('fmp12-21: inherited font names get a valid generic fallback', () => {
  for (const name of ['constructor', '__proto__', 'toString']) {
    const stack = fontStack(name);
    assert.equal(typeof stack, 'string');
    assert.equal(stack, `${JSON.stringify(name)}, sans-serif`);
  }
  assert.equal(fontStack('monaco'), '"monaco", monospace');
});

test('fmp12-22: only decimal number text is converted', () => {
  for (const text of ['0x1F', '0b101', '0o17', '1_000']) assert.equal(typedValue(text, 'number'), text);
  for (const [text, value] of [['12', 12], ['-3.5', -3.5], ['1,234.5', 1234.5], ['.5', 0.5], ['1e3', 1000]] as const) {
    assert.equal(typedValue(text, 'number'), value, text);
  }
});

test('fmp12-1: impossible calendar dates stay as stored text', () => {
  for (const text of ['02/31/2026', '4/31/2025', '2/29/2025']) {
    assert.equal(parseDate(text), undefined, text);
    assert.equal(typedValue(text, 'date'), text, text);
  }
  assert.equal(parseDate('2/29/2024'), '2024-02-29');
  assert.equal(parseDate('12/31/2026'), '2026-12-31');
  assert.equal(typedValue('2/29/2024', 'date'), '2024-02-29');
  assert.equal(parseDate('2024-02-29', 'ISO'), '2024-02-29');
  assert.equal(parseDate('2025-02-29', 'ISO'), undefined);
});
