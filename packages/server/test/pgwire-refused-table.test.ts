// A table of another hosted file that the account may not read answers what a table that isn't there answers, so the
// answer does not say the table, or the file, exists.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PgClient } from './pg-client.ts';
import { openIsolation, type Isolation } from './cross-file-matrix.ts';

let m: Isolation;
before(async () => {
  m = await openIsolation();
  const [a, b] = m.stores;
  // In the second file this account has a set that does not read every record; in the first it has full access.
  b.savePrivilegeSet({ name: 'Partial', records: { view: true, edit: false, create: false, delete: false, fieldsDefault: 'none' }, layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmxdbc'] });
  b.setPassword('Shared', 'password-1', 'Partial');
  assert.equal(a.schema.tableOccurrences.some((o) => o.name === 'ExternalItems'), true);
  // A second way into the same table of the other file.
  a.applyDesign([{ op: 'createOccurrence', name: 'ExternalOther', file: 'Destination', externalTable: b.schema.tables[0].id }]);
});
after(async () => { await m?.close(); });

const open2 = (database: string, user: string, password: string) => PgClient.open({ port: m.sqlPort, database, user, password });
const open = (database: string, password: string) => open2(database, 'Shared', password);

test('a refused table of another file answers like a table that is not there', async () => {
  const c = await open(m.stores[0].name, 'password-0');
  try {
    for (const extended of [false, true]) {
      const query = (sql: string) => extended ? c.extended(sql) : c.simple(sql);
      const missing = (await query('SELECT Value FROM NoSuchTable')).error;
      assert.ok(missing, 'a table that is not there is an error');
      for (const sql of ['SELECT Value FROM ExternalItems', 'select * from "ExternalItems" e', 'SELECT i.Value FROM Items i JOIN ExternalItems x ON x.Key = i.Key']) {
        const refused = (await query(sql)).error;
        assert.ok(refused, sql);
        assert.equal(refused.code, missing.code, `${sql}: same SQLSTATE as a missing table`);
        const named = /ExternalItems/.exec(sql)![0];
        assert.equal(refused.message, missing.message.replace('NoSuchTable', named), `${sql}: the words of a missing table (extended ${extended})`);
        assert.doesNotMatch(refused.message, /view every record|privilege|SENTINEL_/i);
        assert.equal(refused.message.includes(m.stores[1].name), false, 'the other file is not named');
      }
    }
  } finally { c.close(); }
});

test('the answer names the table the query used, not another name that is in the query', async () => {
  const c = await open(m.stores[0].name, 'password-0');
  try {
    for (const extended of [false, true]) {
      const query = (sql: string) => extended ? c.extended(sql) : c.simple(sql);
      for (const [sql, name] of [
        ['SELECT 1 AS ExternalItems FROM ExternalOther', 'ExternalOther'],
        ["SELECT 'ExternalItems' FROM ExternalOther o", 'ExternalOther'],
        ['SELECT i.Value FROM Items i JOIN ExternalOther o ON o.Key = i.Key WHERE i.Value <> \'ExternalItems\'', 'ExternalOther'],
      ]) {
        const refused = (await query(sql)).error;
        assert.deepEqual(refused, { code: '42P01', message: `no such table: ${name}` }, sql);
      }
    }
  } finally { c.close(); }
});

test('a refused table is told apart from a missing one by nothing: not by a syntax error, not by the order of the checks', async () => {
  const c = await open(m.stores[0].name, 'password-0');
  try {
    for (const extended of [false, true]) {
      const query = (sql: string) => extended ? c.extended(sql) : c.simple(sql);
      for (const rest of [' WHERE (', ' WHERE 1 = ', ' ORDER BY', ' GROUP BY 1 HAVING', ' LIMIT x', " WHERE 'unterminated"]) {
        const missing = (await query(`SELECT * FROM NoSuchTable${rest}`)).error;
        const refused = (await query(`SELECT * FROM ExternalItems${rest}`)).error;
        assert.ok(missing && refused, rest);
        assert.deepEqual({ ...refused, message: refused.message.replace('ExternalItems', 'NoSuchTable') }, missing, `a query that ends ${JSON.stringify(rest)}`);
      }
    }
  } finally { c.close(); }
  // An account whose set in its own file stops reading every record is refused the same for either name.
  m.stores[0].setPassword('Mid', 'password-mid', '[Full Access]');
  const mid = await open2(m.stores[0].name, 'Mid', 'password-mid');
  try {
    m.stores[0].savePrivilegeSet({ name: 'Narrow', records: { view: true, edit: false, create: false, delete: false, fieldsDefault: 'none' }, layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmxdbc'] });
    m.stores[0].setPassword('Mid', 'password-mid', 'Narrow');
    const missing = (await mid.simple('SELECT * FROM NoSuchTable')).error;
    const refused = (await mid.simple('SELECT * FROM ExternalItems')).error;
    assert.equal(missing?.code, '42501');
    assert.deepEqual({ ...refused, message: refused?.message.replace('ExternalItems', 'NoSuchTable') }, missing);
  } finally { mid.close(); }
});

test('the catalog does not list a table of another file the account may not read', async () => {
  const c = await open(m.stores[0].name, 'password-0');
  try {
    for (const sql of [
      'SELECT tablename FROM pg_catalog.pg_tables',
      'SELECT table_name FROM information_schema.tables',
      'SELECT table_name FROM information_schema.columns',
      'SELECT relname FROM pg_class',
      'SELECT c.relname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid',
    ]) {
      const listed = (await c.simple(sql)).rows.map((row) => row[0]);
      assert.ok(listed.includes('Items'), `${sql}: the file's own table is listed`);
      assert.equal(listed.some((n) => /^External/.test(String(n))), false, `${sql}: a refused table is not listed`);
    }
  } finally { c.close(); }
});

test('a table of another file the account may read still answers', async () => {
  m.stores[1].setPassword('Shared', 'password-1', 'Reader');
  const c = await open(m.stores[0].name, 'password-0');
  try {
    assert.deepEqual((await c.simple('SELECT Value FROM ExternalItems')).rows, [['SENTINEL_1']]);
    const listed = (await c.simple('SELECT tablename FROM pg_catalog.pg_tables')).rows.map((row) => row[0]);
    assert.ok(listed.includes('ExternalItems'), 'a readable table of another file is listed');
  } finally { c.close(); }
});
