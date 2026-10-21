import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStore, type Store } from '../../store/src/index.ts';
import { sqlTokens } from '../../store/src/sql-tokens.ts';
import { catalogProbes, identifier, literal, model, payloads, property, random, shrinkText } from '../../store/test/sql-property-model.ts';
import { serve } from '../src/index.ts';
import { numberedParams, splitStatements, PgServer } from '../src/pgwire.ts';
import { pgSyntax } from '../src/pgcatalog.ts';
import { castParamTypes } from '../src/pgbinary.ts';
import { PgClient } from './pg-client.ts';

let dir: string;
let server: Server;
let store: Store;
let client: PgClient;
let pg: PgServer;
let url: string;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'openhbam-wire-properties-'));
  createStore(join(dir, 'Generated.openhbam.sqlite'));
  const s = await serve({ dir, hostname: '127.0.0.1', port: 0, watch: false, log: () => {} });
  server = s.server;
  url = s.url + '/openhbam/sql/v1/databases/Generated';
  store = s.host.get('Generated')!;
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Secret' }] },
    { op: 'createTable', name: 'OtherPrivateTable', fields: [{ name: 'OtherPrivateField' }] },
  ]);
  store.create('Items', { Name: 'visible', Secret: 'hidden-field-data' });
  store.create('OtherPrivateTable', { OtherPrivateField: 'other-private-data' });
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
  store.setPassword('Reader', 'pw', full.name);
  store.setPassword('Keeper', 'pw', full.name);
  store.savePrivilegeSet({ name: 'Limited', records: { view: true, edit: false, create: false, delete: false, fields: { Secret: 'none' } }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'] });
  store.setPassword('Limited', 'pw', 'Limited');
  pg = new PgServer(s.host, { port: 0, hostname: '127.0.0.1' });
  const port = await pg.listen();
  client = await PgClient.open({ port, database: 'Generated', user: 'Reader', password: 'pw' });
});
after(async () => {
  client?.close();
  pg?.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('regression: PostgreSQL rewrites preserve quoted identifiers and keyword literals', () => {
  const sql = `SELECT 'pg_class = ANY (x)' AS "ILIKE public.x::text"`;
  assert.equal(pgSyntax(sql), sql);
});

test('regression: session expressions inside literals and quoted names never become SQL', async () => {
  const value = 'current_user session_user current_role version() current_database() current_schema() pg_backend_pid()';
  const r = await client.simple(`SELECT ${literal(value)} AS ${identifier(value)}, current_user, current_database()`);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.rows, [[value, 'Reader', 'Generated']]);
  assert.equal(r.columns[0], value);
});

test('quoted catalog names and array expressions keep their intended code transformations', async () => {
  for (const schema of ['information_schema', '"information_schema"']) {
    const r = await client.simple(`SELECT table_name FROM ${schema}."tables" WHERE table_name = 'Items'`);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.rows, [['Items']]);
  }
  const r = await client.simple(`SELECT relname FROM "pg_class" WHERE relname = ANY (ARRAY['Items', 'missing'])`);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.rows, [['Items']]);
});

test('regression: escape-string quotes cannot expose code, including semicolons', async () => {
  const sql = String.raw`SELECT E'a\'; DELETE FROM Items; --' AS value; SELECT 7`;
  assert.deepEqual(splitStatements(sql), ["SELECT 'a''; DELETE FROM Items; --' AS value", 'SELECT 7']);
  const r = await client.simple(sql);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.rows, [["a'; DELETE FROM Items; --"], ['7']]);
  assert.deepEqual(r.tags, ['SELECT 1', 'SELECT 1']);
});

test('regression: nested comments do not contribute statements or parameters', async () => {
  const sql = 'SELECT $1 /* outer /* inner */ ; SELECT $99 */; SELECT 2';
  assert.equal(splitStatements(sql).length, 2);
  assert.deepEqual(numberedParams(sql), { sql: sql.replace('$1', '?1'), count: 1 });
  for (const invalid of ["SELECT 'unterminated", 'SELECT 1 /* unterminated']) {
    assert.equal((await client.simple(invalid)).error?.code, '42601');
    assert.equal((await client.extended(invalid)).error?.code, '42601');
  }
});

test('regression: type inference ignores casts in literals, identifiers and comments', () => {
  assert.deepEqual([...castParamTypes(`SELECT '$1::int8', "$1::date", $1::text /* $2::float8 */`)], [[1, 25]]);
});

test('seeded multi-statement model preserves literals, quoted identifiers, code and statement count', async () => {
  const next = random();
  const cases = Array.from({ length: 120 }, () => Array.from({ length: 1 + next(4) }, () => model(next, true)));
  await property(cases, (statements) => {
    const input = statements.map((atoms) => atoms.map((a) => a.text).join('')).join(';');
    const split = splitStatements(input);
    assert.equal(split.length, statements.length);
    const output = split.map((sql) => pgSyntax(numberedParams(sql).sql));
    assert.equal(splitStatements(output.join(';')).length, statements.length);
    for (const [i, sql] of output.entries()) {
      const tokens = sqlTokens(sql);
      const protectedAtoms = statements[i].filter((a) => a.kind === 'string' || a.kind === 'identifier')
        .map((a) => ({ kind: a.kind, text: a.normalized ?? a.text }));
      assert.deepEqual(tokens.filter((t) => t.kind === 'string' || t.kind === 'identifier').map((t) => ({ kind: t.kind, text: t.text })), protectedAtoms);
      assert.deepEqual(tokens.filter((t) => t.kind === 'word').map((t) => t.text), ['SELECT', 'AS']);
      assert.equal(tokens.filter((t) => t.kind === 'parameter').length, 1);
    }
  }, (statements) => statements.length > 1 ? [statements.slice(0, -1)] : []);
});

test('seeded extended parameters with unusual type OIDs remain bound data', async () => {
  const next = random();
  const oids = [0, 16, 17, 20, 25, 705, 114, 1700, 3802, 2950, 1009, 3904, 99999];
  const cases = Array.from({ length: 48 }, () => ({ value: payloads[next(payloads.length)], oid: oids[next(oids.length)] }));
  await property(cases, async ({ value, oid }) => {
    const r = await client.extended(`SELECT $1 AS "ILIKE", ${literal(value)} AS "literal"`, [{ oid, value }]);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.rows, [[value, value]]);
    assert.deepEqual(r.columns, ['ILIKE', 'literal']);
    assert.deepEqual(r.tags, ['SELECT 1']);
  }, (x) => shrinkText(x.value).map((value) => ({ ...x, value })));
});

test('dollar quotes, Unicode quotes inside values, quoted identifiers and long inputs round trip', async () => {
  for (const value of [...payloads, 'x'.repeat(220_000) + '; SELECT 9', '__sql_opaque_0_0 ' + '_'.repeat(220_000)]) {
    const sql = `SELECT $body$${value}$body$ AS ${identifier('a; “quote”')}`;
    const r = await client.simple(sql);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.rows, [[value]]);
    assert.deepEqual(r.columns, ['a; “quote”']);
  }
});

test('regression: invalid UTF-8, mixed encodings and NUL wire text are refused without truncation', async () => {
  for (const raw of [Buffer.from("SELECT 1\0; DELETE FROM Items"), Buffer.from([0x53, 0x45, 0x4c, 0x45, 0x43, 0x54, 0x20, 0xc0, 0xaf]), Buffer.concat([Buffer.from("SELECT 'café"), Buffer.from([0xe9]), Buffer.from("'")])]) {
    const r = await client.simple(raw);
    assert.ok(r.error);
    assert.deepEqual(r.rows, []);
    const prepared = await client.extended(raw);
    assert.ok(['08P01', '22021'].includes(prepared.error?.code ?? ''));
    assert.deepEqual(prepared.rows, []);
  }
  for (const value of [Buffer.from('a\0b'), Buffer.from([0xff, 0xfe, 0x27, 0x00])]) {
    const r = await client.extended('SELECT $1', [{ oid: 25, value }]);
    assert.equal(r.error?.code, '22021');
    assert.deepEqual(r.rows, []);
  }
  assert.deepEqual((await client.simple('SELECT 1')).rows, [['1']]);
});

test('regression: parameter indices are bounded before allocating prepared-statement types', () => {
  for (const sql of ['SELECT $0', 'SELECT $32767', 'SELECT $999999999999999999999999999']) {
    assert.throws(() => numberedParams(sql), /out of range/);
  }
});

test('generated HTTP and wire read-only queries refuse dangerous tokens without unrelated names or data', async () => {
  const post = async (sql: string, user = 'Reader') => {
    const response = await fetch(url, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(user + ':pw').toString('base64'), 'content-type': 'application/json' }, body: JSON.stringify({ sql }) });
    return { status: response.status, body: await response.json() };
  };
  const dangerous = ["ATTACH 'other.sqlite' AS other", 'PRAGMA user_version', "VACUUM INTO 'copy.sqlite'", "SELECT load_extension('other')", 'SELECT * FROM _fm_accounts', 'SELECT * FROM other.Items', "SELECT readfile('other.sqlite')", "SELECT writefile('other.sqlite', 'x')", "UPDATE Items SET Name = 'changed'"];
  await property(dangerous, async (sql) => {
    const http = await post(`/* outer /* inner */ */ ${sql}`);
    assert.equal(http.status, 400);
    const wire = await client.extended(sql);
    assert.ok(wire.error);
    assert.deepEqual(wire.rows, []);
    assert.doesNotMatch(JSON.stringify([http.body, wire.error]), /OtherPrivateTable|OtherPrivateField|other-private-data|hidden-field-data/);
  });
  const denied = await post('WITH c AS (SELECT * FROM Items) SELECT * FROM c', 'Limited');
  assert.equal(denied.status, 401);
  assert.doesNotMatch(JSON.stringify(denied.body), /OtherPrivateTable|OtherPrivateField|other-private-data|hidden-field-data/);
  assert.deepEqual((await client.simple('SELECT Name FROM Items')).rows, [['visible']]);
});

test('regression: HTTP, wire Q and Parse refuse quoted pragma and dbstat probes', async () => {
  for (const sql of catalogProbes) {
    const response = await fetch(url, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('Reader:pw').toString('base64'), 'content-type': 'application/json' }, body: JSON.stringify({ sql }) });
    assert.equal(response.status, 400, sql);
    const body = await response.json();
    for (const wire of [await client.simple(sql), await client.parse(sql)]) {
      assert.ok(wire.error, sql);
      assert.deepEqual(wire.rows, [], sql);
      assert.match(wire.error.message, /catalog|internal tables|can't use (?:a schema name|dbstat|pragma_)/);
      assert.doesNotMatch(JSON.stringify([body, wire.error]), /OtherPrivateTable|OtherPrivateField|other-private-data|hidden-field-data/);
    }
  }
  const parameterized = "SELECT p.name FROM Items, 'pragma_table_info' p WHERE p.arg = $1";
  assert.ok((await client.parse(parameterized)).error);
  assert.ok((await client.extended(parameterized, [{ oid: 25, value: '_fm_totp' }])).error);
  assert.deepEqual((await client.extended('SELECT $1', [{ oid: 25, value: 'pragma_table_info' }])).rows, [['pragma_table_info']]);
  assert.deepEqual((await client.simple('SELECT 1')).rows, [['1']]);
});

test('regression: version() preserves the protocol-visible server_version name', async () => {
  const version = await client.simple('SHOW server_version');
  assert.deepEqual(version.rows, [['14.0 (Tabularius)']]);
  for (const result of [await client.simple('SELECT version()'), await client.extended('SELECT version()')]) {
    assert.equal(result.error, undefined);
    assert.deepEqual(result.rows, [[`PostgreSQL ${version.rows[0][0]}`]]);
  }
});

test('row and field restrictions still gate wire queries after CTE and occurrence rewriting', async () => {
  const account = store.accounts().find((a) => a.name === 'Reader')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  try {
    // Exercise both restrictions independently on an already authenticated connection.
    for (const records of [
      { view: true, edit: false, create: false, delete: false, fields: { Secret: 'none' as const } },
      { view: 'Name = "visible"', edit: false, create: false, delete: false },
    ]) {
      store.savePrivilegeSet({ name: 'Limited', records, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'] });
      store.setPassword(account.name, 'pw', 'Limited');
      for (const sql of ['SELECT Name FROM Items', 'WITH c AS (SELECT * FROM Items) SELECT * FROM c']) {
        const r = await client.simple(sql);
        assert.ok(r.error);
        assert.deepEqual(r.rows, []);
        assert.doesNotMatch(r.error.message, /OtherPrivateTable|OtherPrivateField|other-private-data|hidden-field-data/);
      }
    }
  } finally { store.setPassword(account.name, 'pw', full.name); }
});
