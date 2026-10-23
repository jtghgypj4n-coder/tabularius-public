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
});
after(async () => { await m?.close(); });

const open = (database: string, password: string) => PgClient.open({ port: m.sqlPort, database, user: 'Shared', password });

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

test('a table of another file the account may read still answers', async () => {
  m.stores[1].setPassword('Shared', 'password-1', 'Reader');
  const c = await open(m.stores[0].name, 'password-0');
  try {
    assert.deepEqual((await c.simple('SELECT Value FROM ExternalItems')).rows, [['SENTINEL_1']]);
  } finally { c.close(); }
});
