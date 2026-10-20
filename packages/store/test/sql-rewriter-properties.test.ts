import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { CalcError, ERR } from '../../calc/src/values.ts';
import { cleanSql, maskSql, sqlTokens } from '../src/sql-tokens.ts';
import { fileMakerSqlSyntax } from '../src/sql-dates.ts';
import { anyAllToIn, fetchToLimit } from '../src/sql-grammar.ts';
import { catalogProbes, identifier, literal, model, payloads, property, random, shrinkAtoms, shrinkText } from './sql-property-model.ts';

let dir: string;
let store: Store;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'openhbam-sql-properties-'));
  createStore(join(dir, 'Generated.sqlite'));
  store = new Store(join(dir, 'Generated.sqlite'), 'Generated');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'id', type: 'number' }, { name: 'Name' }, { name: 'Secret' }] },
    { op: 'createTable', name: 'OtherPrivateTable', fields: [{ name: 'OtherPrivateField' }] },
    { op: 'createTable', name: 'Odd " table; 名', fields: [{ name: 'odd " field; 名' }] },
    { op: 'createTable', name: '🐈', fields: [{ name: 'Name' }] },
  ]);
  store.create('Items', { id: '1', Name: 'visible', Secret: 'hidden-field-data' });
  store.create('Items', { id: '2', Name: 'hidden-row-data', Secret: 'other-hidden-field-data' });
  store.create('OtherPrivateTable', { OtherPrivateField: 'other-private-data' });
  store.create('Odd " table; 名', { 'odd " field; 名': 'quoted-value' });
  store.create('🐈', { Name: 'unicode-private-data' });
  store.savePrivilegeSet({
    name: 'Limited', records: { view: false, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'],
    tables: { Items: { view: 'id = 1', edit: false, create: false, delete: false, fields: { Secret: 'none' } } },
  });
  store.setPassword('reader', 'pw', 'Limited');
});
after(() => { store?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

const run = (sql: string, limited = false) => {
  const r = store.calc.translateSQL(sql, limited ? store.privileges('reader') : undefined);
  return r.target.select(r.sql).rows;
};

test('seeded token model preserves every lexical boundary and code mask', async () => {
  const next = random();
  await property(Array.from({ length: 160 }, () => model(next)), (atoms) => {
    const input = atoms.map((a) => a.text).join('');
    // Coalesce adjacent same-kind atoms after shrinking, but never cross quotes.
    assert.equal(sqlTokens(input).map((t) => t.text).join(''), input);
    const expected = atoms.map((a) => ['string', 'identifier', 'comment'].includes(a.kind) ? ' '.repeat(a.text.length) : a.text).join('');
    assert.equal(maskSql(input), expected);
    for (const a of atoms.filter((a) => ['string', 'identifier', 'comment'].includes(a.kind))) {
      assert.ok(sqlTokens(input).some((t) => t.kind === a.kind && t.text === a.text));
    }
  }, shrinkAtoms);
});

test('regression: FROM inside a literal is never rewritten as a table', () => {
  assert.deepEqual(run("SELECT 'FROM Items'"), [['FROM Items']]);
});

test('seeded literals and quoted output names survive every store rewrite', async () => {
  const next = random();
  await property(Array.from({ length: 100 }, () => payloads[next(payloads.length)] + payloads[next(payloads.length)]), (value) => {
    const sql = `SELECT ${literal(value)} AS ${identifier(value)} FROM Items FETCH FIRST 1 ROW ONLY`;
    assert.deepEqual(run(sql), [[value]]);
    for (const rewrite of [fileMakerSqlSyntax, anyAllToIn, fetchToLimit]) {
      const result = sqlTokens(rewrite(sql));
      assert.ok(result.some((t) => t.kind === 'string' && t.text === literal(value)));
      assert.ok(result.some((t) => t.kind === 'identifier' && t.text === identifier(value)));
    }
  }, shrinkText);
});

test('regression: escaped identifier quotes survive occurrence rewriting', () => {
  assert.deepEqual(run('SELECT "odd "" field; 名" FROM "Odd "" table; 名"'), [['quoted-value']]);
});

test('regression: ROWMODID inside a longer quoted identifier is not a system column', () => {
  const sql = 'SELECT 1 AS "ROWMODID inside a name"';
  assert.equal(fileMakerSqlSyntax(sql), sql);
});

test('regression: comma joins cannot bypass privileges using an escaped table identifier', () => {
  assert.deepEqual(run('SELECT x."odd "" field; 名" FROM Items c, "Odd "" table; 名" x', true), []);
  for (const name of ['🐈', '"🐈"', '[🐈]', '`🐈`']) {
    assert.deepEqual(run(`SELECT Name FROM ${name}`, true), []);
    assert.deepEqual(run(`SELECT Name FROM ${name}`), [['unicode-private-data']]);
  }
});

test('seeded quoted joins, subqueries and CTEs preserve row and field privileges after rewriting', async () => {
  const names = ['Items', '"Items"', '`Items`', '[Items]'];
  const cases = names.flatMap((name) => [
    `SELECT Name, Secret FROM ${name}`,
    `SELECT x.Name, x.Secret FROM ${name} c, ${name} x`,
    `WITH c AS (SELECT Name, Secret FROM ${name}) SELECT * FROM c`,
    `SELECT Name, Secret FROM ${name} WHERE id IN (SELECT id FROM ${name})`,
  ]);
  await property(cases, (sql) => assert.deepEqual(run(sql, true), [['visible', null]]));
  for (const sql of ['SELECT missing FROM Items', 'SELECT missing FROM Items GROUP BY id']) {
    assert.throws(() => run(sql, true), (e: Error) => {
      assert.doesNotMatch(e.message, /OtherPrivateTable|OtherPrivateField|other-private-data|hidden-row-data|hidden-field-data/);
      return true;
    });
  }
});

test('regression: a read-only store refuses trailing statements instead of silently preparing only the first', () => {
  for (const call of [store.query.bind(store), store.select.bind(store), store.describe.bind(store)]) {
    assert.throws(() => call('SELECT 1; DELETE FROM Items'), /one statement/);
  }
});

test('regression: token screening preserves readonly errors for CTE writes on every store path', () => {
  for (const sql of [
    'WITH c AS (SELECT 1) DELETE FROM Items',
    "WITH c AS (SELECT 1) UPDATE Items SET Name = 'changed'",
    "WITH c AS (SELECT 1) INSERT INTO Items(Name) VALUES('changed')",
  ]) {
    for (const call of [store.query.bind(store), store.select.bind(store), store.describe.bind(store), store.inspectQuery.bind(store)]) {
      assert.throws(() => call(sql), /readonly/, sql);
    }
  }
  assert.deepEqual(store.query('SELECT Name FROM Items ORDER BY id').map((r) => r.Name), ['visible', 'hidden-row-data']);
});

test('regression: SQL rewriting rejects malformed lexical boundaries with calculation errors', () => {
  for (const [sql, message] of [
    ["SELECT DATE 'a\0b'", 'SQL text contains a NUL byte'],
    ["SELECT DATE '2024-1-1", 'Unterminated SQL quote'],
    ['SELECT ROWMODID AS "unclosed', 'Unterminated SQL quote'],
    ['SELECT CURRENT_DATE /* unclosed', 'Unterminated SQL comment'],
  ]) {
    assert.throws(() => fileMakerSqlSyntax(sql), (e: unknown) =>
      e instanceof CalcError && e.code === ERR.calculation && e.message === message, sql);
  }
});

test('seeded forbidden code is refused wherever nested, while keyword literals remain data', async () => {
  const forbidden = ["ATTACH 'other.sqlite' AS other", "VACUUM INTO 'copy.sqlite'", 'PRAGMA user_version',
    "DELETE FROM Items", "UPDATE Items SET Name = 'changed'", "INSERT INTO Items(Name) VALUES('changed')",
    "SELECT load_extension('other')", "SELECT \"load_extension\"('other')", 'SELECT * FROM _fm_accounts',
    'SELECT * FROM "_fm_meta"', 'SELECT * FROM [_fm_totp]', 'SELECT * FROM `_fm_api_tokens`',
    "SELECT * FROM '_fm_accounts'", 'SELECT * FROM sqlite_schema', "SELECT * FROM pragma_table_info('Items')",
    'SELECT * FROM other.Items', "SELECT readfile('other.sqlite')", "SELECT writefile('other.sqlite', 'x')"];
  await property(forbidden.flatMap((sql) => [sql, `/* outer /* nested */ tail */ ${sql}`, `SELECT (${sql})`, `WITH c AS (${sql}) SELECT * FROM c`, `SELECT 1; ${sql}`]), (sql) => {
    assert.throws(() => store.query(sql));
  });
  assert.deepEqual(run("SELECT 'ATTACH PRAGMA load_extension VACUUM INTO DELETE'"), [['ATTACH PRAGMA load_extension VACUUM INTO DELETE']]);
  assert.deepEqual(store.query('SELECT Name FROM Items ORDER BY id').map((r) => r.Name), ['visible', 'hidden-row-data']);
});

test('regression: NUL SQL is refused before SQLite can truncate it', () => {
  for (const sql of ['SELECT 1\0; DELETE FROM Items', "SELECT 'a\0b'", 'SELECT 1 -- \0']) {
    assert.throws(() => run(sql), /NUL/);
    assert.throws(() => store.query(sql), /NUL/);
  }
});

test('regression: string-quoted catalog tables cannot reveal other tables through SQLite name coercion', () => {
  for (const sql of ["SELECT name FROM 'sqlite_schema'", "SELECT name FROM ('sqlite_master')", "WITH c AS (SELECT name FROM 'sqlite_schema') SELECT * FROM c", "SELECT name FROM 'sqlite_temp_schema'", "SELECT name FROM 'pragma_table_info'('OtherPrivateTable')"]) {
    assert.throws(() => store.query(sql), (e: Error) => {
      assert.match(e.message, /catalog|internal tables/);
      assert.doesNotMatch(e.message, /OtherPrivateTable|OtherPrivateField|other-private-data/);
      return true;
    });
  }
  assert.deepEqual(run("SELECT 'sqlite_schema', '_fm_accounts'"), [['sqlite_schema', '_fm_accounts']]);
});

test('file and extension functions are refused as tokens before a registered fake can run', () => {
  let calls = 0;
  for (const name of ['readfile', 'writefile', 'load_extension']) {
    store.defineQueryFunction(name, () => { calls++; return 'other-private-data'; });
    for (const quoted of [name, identifier(name), literal(name), `[${name}]`, `\`${name}\``]) {
      assert.throws(() => store.query(`SELECT ${quoted}('other.sqlite')`), /Only SELECT/);
    }
  }
  assert.equal(calls, 0);
});

test('regression: quoted pragma and dbstat comma joins and schema names are refused on every store path', () => {
  for (const sql of catalogProbes) {
    for (const call of [store.query.bind(store), store.select.bind(store), store.describe.bind(store), store.inspectQuery.bind(store)]) {
      assert.throws(() => call(sql), /catalog|internal tables/, sql);
    }
    assert.throws(() => store.calc.executeSQL(sql, [], store.privileges('reader')), /catalog|internal tables|can't use/, sql);
  }
  for (const name of ['PrAgMa_table_info', 'pragma_compile_options', 'pragma_database_list']) {
    for (const token of [name, identifier(name), literal(name), `[${name}]`, `\`${name}\``]) {
      for (const sql of [`SELECT ${token}`, `SELECT 1 AS ${token}`, `SELECT * FROM (SELECT 1) a, ${token} p`]) {
        assert.throws(() => store.query(sql), /internal tables/, sql);
      }
    }
  }
  const sql = "SELECT p.name FROM Items, 'pragma_table_info' p WHERE p.arg = ?";
  assert.throws(() => store.select(sql, ['_fm_totp']), /internal tables/);
  assert.throws(() => store.calc.executeSQL(sql, [{ type: 'text', value: '_fm_totp' }], store.privileges('reader')), /internal tables|can't use/);
  // Bound values remain data; only names present in the SQL text are reserved.
  assert.deepEqual(store.select('SELECT ?', ['pragma_table_info']).rows, [['pragma_table_info']]);
  assert.deepEqual(store.calc.executeSQL('SELECT ?', [{ type: 'text', value: 'pragma_table_info' }], store.privileges('reader')), [[{ type: 'text', value: 'pragma_table_info' }]]);
});

test('regression: compiled virtual table checks refuse catalog access hidden behind views', () => {
  for (const [i, sql] of catalogProbes.entries()) {
    const view = `CatalogProbe${i}`;
    store.sql.exec(`CREATE VIEW ${view} AS ${sql}`);
    try {
      for (const call of [store.query.bind(store), store.select.bind(store), store.describe.bind(store), store.inspectQuery.bind(store)]) {
        // SQLite itself refuses dbstat in views before the compiled guard runs.
        const refusal = sql.includes('dbstat') ? /catalog|unsafe use of virtual table/ : /catalog/;
        assert.throws(() => call(`SELECT * FROM ${view}`), refusal, view);
      }
    } finally { store.sql.exec(`DROP VIEW ${view}`); }
  }
  for (const name of ['json_each', 'json_tree']) {
    assert.equal(store.query(`SELECT value FROM ${name}('[7]') WHERE type = 'integer'`)[0].value, 7);
  }
});

test('regression: a table shadowing a pragma module cannot bypass the compiled check', () => {
  store.sql.exec('CREATE TABLE pragma_compile_options (value TEXT)');
  // Trusted setup: only a temp view can refer to the module in temp while an
  // ordinary table shadows it in main. The caller's SQL names only this view.
  store.query('SELECT 1');
  const db = (store as unknown as { readOnlySql: typeof store.sql }).readOnlySql;
  db.exec('CREATE TEMP VIEW ShadowedCatalog AS SELECT * FROM temp.pragma_compile_options');
  try {
    assert.throws(() => store.query('SELECT * FROM ShadowedCatalog'), /catalog/);
  } finally {
    db.exec('DROP VIEW ShadowedCatalog');
    store.sql.exec('DROP TABLE pragma_compile_options');
  }
});

test('long inputs, all identifier delimiters and Unicode content preserve values or fail closed', () => {
  for (const value of ['x'.repeat(250_000) + '; FROM Items', '‘x’ “y” «z» \ufffd']) {
    assert.deepEqual(run(`SELECT ${literal(value)}`), [[value]]);
  }
  for (const name of ['"a; b"', '`a; b`', '[a; b]']) {
    assert.deepEqual(store.select(`SELECT 1 AS ${name}`).names, ['a; b']);
  }
  for (const sql of ["SELECT '", 'SELECT "', 'SELECT `', 'SELECT [', 'SELECT /* nested /* */']) {
    assert.throws(() => cleanSql(sql), /Unterminated/);
  }
});
