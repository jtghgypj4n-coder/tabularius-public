// ExecuteSQL shows an account only the records and fields its privilege set lets it see. The query's FROM and JOIN
// tables were rewritten to the account's part of them, but a table named any other way (a comma join, a quoted
// name) read the whole table, hidden fields included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asText } from '@tabularius/calc';
import { createStore, Store } from '../src/index.ts';

test('ExecuteSQL can\'t read hidden records or fields however the query names the table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-scope-'));
  createStore(join(dir, 'Shop.sqlite'));
  const store = new Store(join(dir, 'Shop.sqlite'), 'Shop');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'id', type: 'number' }, { name: 'Name' }, { name: 'Secret' }, { name: 'Pic', type: 'container' }] }]);
    store.create('Customers', { id: '1', Name: 'Ada', Secret: 'private 1' });
    const hidden = Number(store.create('Customers', { id: '2', Name: 'Bo', Secret: 'private 2' }).recordId);
    store.setContainer('Customers', hidden, 'Pic', 1, { filename: 'hidden.txt', mime: 'text/plain', data: new TextEncoder().encode('private') });
    store.savePrivilegeSet({
      name: 'Limited', records: { view: 'id = 1', edit: false, create: false, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: [],
      tables: { Customers: { view: 'id = 1', edit: false, create: false, delete: false, fields: { Secret: 'none' } } },
    });
    store.setPassword('reader', 'reader-password', 'Limited');
    const pv = store.privileges('reader');
    const run = (query: string) => store.calc.executeSQL(query, [], pv).map((r) => r.map((v) => asText(v)).join(',')).join('|');
    assert.equal(run('SELECT Name, Secret FROM Customers'), 'Ada,');
    assert.equal(run('SELECT x.Name, x.Secret FROM Customers c, Customers x'), 'Ada,');
    assert.equal(run('SELECT x.Name FROM Customers AS c, "Customers" AS x WHERE x.id = 2'), '');
    assert.equal(run('SELECT (SELECT max(Secret) FROM [Customers]) FROM Customers'), '');
    assert.equal(run('WITH t AS (SELECT Secret FROM \'Customers\') SELECT count(*) FROM t WHERE Secret <> \'\''), '0');
    assert.throws(() => run('SELECT Secret FROM main.Customers'), /schema/);
    assert.throws(() => run('SELECT Secret FROM "main" . "Customers"'), /schema/);
    // However SQLite would read the schema name: commented, single-quoted.
    for (const sql of ['SELECT Secret FROM main/**/.Customers', 'SELECT Secret FROM main -- x\n.Customers', 'SELECT Secret FROM "main"/**/."Customers"', 'SELECT Secret FROM \'main\'.Customers']) {
      assert.throws(() => run(sql), /schema/, sql);
    }
    // Functions and tables that read records without naming their table.
    assert.throws(() => run('SELECT fm_computed(1, 1, 2)'), /fm_computed/);
    assert.throws(() => run('SELECT count(*) FROM dbstat'), /dbstat/);
    assert.throws(() => run('SELECT count(*) FROM _fm_containers'), /_fm_containers/);
    assert.equal(run('SELECT CAST(Pic AS VARCHAR) FROM (SELECT 1 AS Pic)'), '1', 'a derived alias cannot look up a hidden container filename');
    assert.throws(() => run('SELECT count(*) FROM \'_fm_containers\''), /_fm_containers/);
    assert.equal(run('SELECT Name FROM Customers WHERE Name <> \'dbstat\''), 'Ada');
    // A comment before the query's own WITH, and the system tables beside it.
    assert.equal(run('/* c */ WITH t AS (SELECT Name FROM Customers) SELECT count(*) FROM t'), '1');
    assert.equal(run('WITH t AS (SELECT 1 AS n) SELECT count(*) FROM t, FileMaker_Tables WHERE TableName = \'Customers\''), '1');
    // Nor can it read the names of fields it can't see.
    assert.equal(run('SELECT FieldName FROM FileMaker_Fields WHERE TableName = \'Customers\' ORDER BY FieldName'), 'Name|Pic|id');
    assert.throws(() => run('SELECT sql FROM sqlite_master'), /sqlite_master/);
    assert.throws(() => run('SELECT sql FROM "sqlite_schema"'), /sqlite_schema/);
    assert.throws(() => run('SELECT name FROM pragma_table_info(\'Customers\')'), /pragma_table_info/);
    // Full access still reads everything.
    assert.equal(store.calc.executeSQL('SELECT x.Secret FROM Customers c, Customers x WHERE c.id = 1 ORDER BY x.id', []).map((r) => asText(r[0])).join('|'), 'private 1|private 2');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
