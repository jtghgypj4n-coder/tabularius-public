// Read-only SQL (used by the MCP sql_query tool, the SQL endpoint and the
// Postgres wire) must not reach the internal tables: password hashes, API
// token hashes and second-factor secrets live there, and no SQL caller may
// read them. FileMaker's own xDBC never exposes these catalogs either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, StoreError, totpCode } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function open(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sqlguard-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  return { store: new Store(join(dir, 'Charts.sqlite'), 'Charts'), dir };
}

const blocked = (fn: () => unknown) =>
  assert.throws(fn, (e) => e instanceof StoreError && e.code === 8310, 'should be refused as an internal table');

test('SQL cannot read the internal security tables, however it is spelled', { skip }, () => {
  const { store, dir } = open();
  try {
    // Put a real secret in place, so the test proves the query is refused
    // rather than simply returning nothing.
    store.setPassword('clerk', 'pw');
    const { secret } = store.enrollTotp('clerk');
    store.confirmTotp('clerk', totpCode(secret));

    blocked(() => store.query('SELECT secret FROM _fm_totp'));
    blocked(() => store.query('SELECT * FROM _fm_accounts'));
    blocked(() => store.query('SELECT token_hash FROM _fm_api_tokens'));
    // Quoted, bracketed and schema-qualified spellings are caught too.
    blocked(() => store.query('SELECT * FROM "_fm_totp"'));
    blocked(() => store.query('SELECT * FROM [_fm_accounts]'));
    blocked(() => store.query('SELECT * FROM main._fm_accounts'));
    // Hidden in a subquery or a join.
    blocked(() => store.query('SELECT (SELECT secret FROM _fm_totp LIMIT 1) AS s'));
    blocked(() => store.query('SELECT * FROM Congress, _fm_accounts'));
    // SQLite takes a quoted string as a table name too, which a name screen alone lets through.
    blocked(() => store.query("SELECT secret FROM '_fm_totp'"));
    blocked(() => store.query("SELECT * FROM Congress JOIN '_fm_accounts' ON 1"));
    blocked(() => store.select("SELECT token_hash FROM '_fm_api_tokens'"));
    // The other read-only entry points screen the same way.
    blocked(() => store.select('SELECT * FROM _fm_meta'));
    blocked(() => store.describe('SELECT * FROM _fm_privileges'));
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('SQL cannot list the file\'s internal tables through SQLite\'s own catalog', { skip }, () => {
  const { store, dir } = open();
  try {
    for (const sql of [
      'SELECT name, sql FROM sqlite_master', 'SELECT * FROM "sqlite_schema"', 'SELECT * FROM main.sqlite_master', 'SELECT * FROM SQLITE_TEMP_MASTER',
      "SELECT name FROM pragma_table_info('_fm_totp')", 'SELECT * FROM pragma_table_list', "SELECT * FROM Congress WHERE _fm_record_id IN (SELECT rootpage FROM sqlite_master)",
    ]) {
      assert.throws(() => store.query(sql), (e) => e instanceof StoreError && e.code === 8310, sql);
    }
    blocked(() => store.select('SELECT name FROM sqlite_master'));
    // Catalog literals remain data, but pragma names are reserved in every position.
    assert.equal(store.query("SELECT 'sqlite_master' AS x")[0].x, 'sqlite_master');
    blocked(() => store.query("SELECT 'pragma_table_info' AS x"));
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('ordinary SQL, the row-id column and container joins still work', { skip }, () => {
  const { store, dir } = open();
  try {
    assert.equal(store.query('SELECT 1 AS n')[0].n, 1);
    // _fm_record_id (the row id) and _fm_containers (container data) are allowed.
    assert.ok(store.query('SELECT _fm_record_id FROM Congress LIMIT 1').length <= 1);
    assert.doesNotThrow(() => store.query('SELECT count(*) AS n FROM _fm_containers'));
    // A string that merely contains the prefix is a value, not a table reference.
    assert.equal(store.query("SELECT '_fm_totp' AS x")[0].x, '_fm_totp');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
