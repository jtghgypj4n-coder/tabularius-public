import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { filterSql } from '../src/index.ts';
import { decimalKey } from '../../store/src/native-types.ts';

// $filter's canonical functions from the OData 4.01 URL conventions: cast, mindatetime, maxdatetime and totaloffsetminutes.
const props = [
  { name: 'Name', field: 'Name', type: 'text', edm: 'Edm.String', queryable: true, writable: true },
  { name: 'Age', field: 'Age', type: 'number', edm: 'Edm.Decimal', queryable: true, writable: true },
  { name: 'Seen', field: 'Seen', type: 'timestamp', edm: 'Edm.DateTimeOffset', queryable: true, writable: true },
];

function names(filter: string): string[] {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (Name TEXT, Age TEXT, Seen TEXT)');
  const add = db.prepare('INSERT INTO t VALUES (?, ?, ?)');
  add.run('a', '42', '2026-03-01T10:00:00');
  add.run('b', '42.9', '2026-03-02T10:00:00');
  add.run('c', 'n/a', '2026-03-03T10:00:00');
  add.run('d', null, null);
  add.run('9', '7', '2026-03-04T10:00:00');
  const f = filterSql(filter, props);
  return (db.prepare(`SELECT Name FROM t WHERE ${f.where} ORDER BY Name`).all(...f.params) as { Name: string }[]).map((r) => r.Name);
}

test('cast turns a value into the type asked, and into nothing when it cannot be one', () => {
  assert.deepEqual(names('cast(Age,Edm.Int32) eq 42'), ['a', 'b']);
  assert.deepEqual(names("cast(Age,'Edm.Int32') eq 42"), ['a', 'b']);
  assert.deepEqual(names('cast(Age,Edm.Double) gt 42.5'), ['b']);
  // 'a' is not a number, so its cast is null and no comparison matches it.
  assert.deepEqual(names('cast(Name,Edm.Decimal) lt 100'), ['9']);
  assert.deepEqual(names("cast(Name,Edm.Int64) eq 9"), ['9']);
  assert.deepEqual(names("cast(Age,Edm.String) eq '42.9'"), ['b']);
  assert.deepEqual(names("cast(Seen,Edm.Date) eq 2026-03-02"), ['b']);
});

test('cast to a type that is not supported says so', () => {
  assert.throws(() => filterSql('cast(Age,Edm.Guid) eq 1', props), /cast to Edm\.Guid is not supported/);
  assert.throws(() => filterSql('cast(Age) eq 1', props), /expected/);
});

test('mindatetime, maxdatetime and totaloffsetminutes', () => {
  assert.deepEqual(names('Seen gt mindatetime()'), ['9', 'a', 'b', 'c']);
  assert.deepEqual(names('Seen lt maxdatetime()'), ['9', 'a', 'b', 'c']);
  assert.deepEqual(names('Seen ge 2026-03-03T00:00:00Z and Seen lt maxdatetime()'), ['9', 'c']);
  assert.deepEqual(names('totaloffsetminutes(Seen) eq 0'), ['9', 'a', 'b', 'c']);
  assert.throws(() => filterSql('Seen gt mindatetime(1)', props), /takes 0 arguments/);
});

test('cast nested to the depth limit stays small', () => {
  const f = filterSql('cast('.repeat(30) + 'Age' + ',Edm.Double)'.repeat(30) + ' gt 1', props);
  assert.ok(f.where.length < 100_000);
});

test('invalid decimal literals do not equal empty decimal fields', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.function('fm_decimal_key', { deterministic: true }, (v) => v === '1' ? '1' : null);
    db.exec("CREATE TABLE t (D TEXT); INSERT INTO t VALUES (''), ('1')");
    const f = filterSql("D eq 'abc'", [{ name: 'D', field: 'D', type: 'decimal', edm: 'Edm.Decimal', queryable: true, writable: true }]);
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM t WHERE ${f.where}`).get(...f.params) as { n: number }).n, 0);
  } finally { db.close(); }
});

test('decimal ne includes empty values', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.function('fm_decimal_key', { deterministic: true }, (v) => decimalKey(v as string | number | null));
    db.exec("CREATE TABLE t (Name TEXT, D TEXT); INSERT INTO t VALUES ('blank', ''), ('nine', '9'), ('ten', '10')");
    const f = filterSql('D ne 9', [{ name: 'D', field: 'D', type: 'decimal', edm: 'Edm.Decimal', queryable: true, writable: true }]);
    assert.deepEqual((db.prepare(`SELECT Name FROM t WHERE ${f.where} ORDER BY Name`).all(...f.params) as { Name: string }[]).map((r) => r.Name), ['blank', 'ten']);
  } finally { db.close(); }
});

test('compat unquoted GUID reports missing property code 102', () => {
  assert.throws(() => filterSql('Name eq aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', props), (e: unknown) =>
    !!e && typeof e === 'object' && 'code' in e && e.code === '102' && 'message' in e && /there is no property/.test(String(e.message)));
});
