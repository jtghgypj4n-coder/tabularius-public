// SQL over HTTP: a table of another hosted file that the account may not read answers what a table that isn't there
// answers, so the answer does not name the file or say the table exists.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openIsolation, basic, type Isolation } from './cross-file-matrix.ts';

let m: Isolation;
before(async () => {
  m = await openIsolation();
  const [, b] = m.stores;
  // In the second file this account has a set that does not read every record; in the first it has full access.
  b.savePrivilegeSet({ name: 'Partial', records: { view: true, edit: false, create: false, delete: false, fieldsDefault: 'none' }, layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmxdbc'] });
  b.setPassword('Shared', 'password-1', 'Partial');
  m.stores[0].applyDesign([{ op: 'createOccurrence', name: 'ExternalOther', file: 'Destination', externalTable: b.schema.tables[0].id }]);
});
after(async () => { await m?.close(); });

const path = () => `/tabularius/sql/v1/databases/${encodeURIComponent(m.stores[0].name)}`;
const ask = (sql: string, get = false) => get
  ? m.request(`${path()}?q=${encodeURIComponent(sql)}`, basic('Shared', 'password-0'))
  : m.request(path(), basic('Shared', 'password-0'), 'POST', { sql });

test('a refused table of another file answers like a table that is not there', async () => {
  for (const get of [false, true]) {
    const missing = await ask('SELECT Value FROM NoSuchTable', get);
    assert.equal(missing.status, 400, missing.text);
    for (const sql of ['SELECT Value FROM ExternalItems', 'select * from "ExternalItems" e', 'SELECT i.Value FROM Items i JOIN ExternalItems x ON x.Key = i.Key']) {
      const refused = await ask(sql, get);
      const named = /ExternalItems/.exec(sql)![0];
      assert.equal(refused.status, missing.status, sql);
      assert.deepEqual(refused.data, JSON.parse(missing.text.replace('NoSuchTable', named)), `${sql}: the answer of a missing table`);
      assert.doesNotMatch(refused.text, /view every record|privilege|different files|SENTINEL_/i);
      assert.equal(refused.text.includes(m.stores[1].name), false, 'the other file is not named');
    }
  }
});

test('a refused table is told apart from a missing one by nothing: not by a syntax error, not by the order of the checks', async () => {
  for (const get of [false, true]) {
    for (const rest of [' WHERE (', ' WHERE 1 = ', ' ORDER BY', ' GROUP BY 1 HAVING', ' LIMIT x', " WHERE 'unterminated"]) {
      const missing = await ask(`SELECT * FROM NoSuchTable${rest}`, get);
      const refused = await ask(`SELECT * FROM ExternalItems${rest}`, get);
      assert.equal(refused.status, missing.status, rest);
      assert.deepEqual(refused.data, JSON.parse(missing.text.replace('NoSuchTable', 'ExternalItems')), `a query that ends ${JSON.stringify(rest)}`);
    }
  }
  // An account whose set in its own file cannot read every record is refused the same for either name.
  const a = m.stores[0];
  a.savePrivilegeSet({ name: 'Narrow', records: { view: true, edit: false, create: false, delete: false, fieldsDefault: 'none' }, layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmxdbc'] });
  a.setPassword('Narrow', 'password-narrow', 'Narrow');
  const as = (sql: string) => m.request(path(), basic('Narrow', 'password-narrow'), 'POST', { sql });
  const missing = await as('SELECT * FROM NoSuchTable');
  const refused = await as('SELECT * FROM ExternalItems');
  assert.equal(missing.status, 401, missing.text);
  assert.equal(refused.status, 401);
  assert.deepEqual(refused.data, JSON.parse(missing.text));
});

test('the answer names the table the query used, not another name that is in the query', async () => {
  for (const sql of ['SELECT 1 AS ExternalItems FROM ExternalOther', "SELECT 'ExternalItems' FROM ExternalOther o"]) {
    const refused = await ask(sql);
    assert.equal(refused.status, 400, refused.text);
    assert.deepEqual(refused.data, { error: { code: 8310, message: 'no such table: ExternalOther' } }, sql);
  }
});

test('a table of another file the account may read still answers', async () => {
  m.stores[1].setPassword('Shared', 'password-1', 'Reader');
  const r = await ask('SELECT Value FROM ExternalItems');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.rows, [['SENTINEL_1']]);
});
