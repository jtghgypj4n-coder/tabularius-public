import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { applyStarter, createStore, type Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { PgClient, type PgResult } from './pg-client.ts';

// The queries BI tools and drivers send when they connect and browse a schema (data/bi-tool-queries.json, each with
// the public source it came from), run against a served file: as an account with SQL access, then as one without.
interface Entry {
  id: string; tool: string; provenance: 'captured' | 'transcribed' | 'rendered' | 'written'; sql: string; mode: 'simple' | 'extended';
  params?: { oid: number; value: string | null }[]; columns?: string[]; rowLimit?: number;
  /** error: the SQLSTATE of the documented refusal; rows: how many rows; notice: a notice (a SET that had no effect). */
  expect?: { error?: string; rows?: number; notice?: boolean };
}
const corpus = JSON.parse(readFileSync(join(import.meta.dirname, 'data', 'bi-tool-queries.json'), 'utf8')) as { queries: Entry[]; notVerified: { tool: string; what: string; why: string }[] };

let dir: string;
let server: Server;
let port: number;
let shop: Store;
const oids: Record<string, string> = {};
const SECRET = 'TOPSECRET-in-another-file';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-bi-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  createStore(join(dir, 'Vault.openhbam.sqlite'));
  const logs: string[] = [];
  const s = await serve({ dir, port: 0, watch: false, sqlPort: 0, log: (m) => void logs.push(m) });
  server = s.server;
  shop = s.host.get('Shop')!;
  applyStarter(shop, 'invoicing');
  const full = shop.privilegeSets().find((p) => p.id === 1)!;
  shop.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
  shop.setPassword('Admin', 'pw', full.name);
  // The invoicing starter's Staff set can add and change records but has no SQL access.
  shop.setPassword('sam', 'pw', 'Staff');
  // SQL access without the right to see every record.
  shop.savePrivilegeSet({ name: 'Blind', records: { view: false, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmxdbc'] });
  shop.setPassword('blind', 'pw', 'Blind');
  const readers = { records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly' as const, valueLists: 'viewOnly' as const, scripts: 'none' as const };
  shop.savePrivilegeSet({ name: 'Reader', ...readers, extendedPrivileges: ['fmxdbc'] });
  shop.setPassword('Temp', 'pw', 'Reader');
  const vault = s.host.get('Vault')!;
  vault.applyDesign([{ op: 'createTable', name: 'Secret', fields: [{ name: 'Note', type: 'text' }] }] as never);
  vault.create('Secret', { Note: SECRET });
  for (let i = 0; i < 100 && !logs.some((l) => l.startsWith('PostgreSQL clients: port')); i++) await new Promise((r) => setTimeout(r, 20));
  port = Number(/port (\d+)/.exec(logs.find((l) => l.startsWith('PostgreSQL clients'))!)![1]);
  const c = await PgClient.open({ port, user: 'Admin', password: 'pw', database: 'Shop' });
  for (const [oid, name] of (await c.simple("SELECT oid, relname FROM pg_class WHERE relkind = 'r'")).rows) oids[name!] = oid!;
  c.close();
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const sql = (e: Entry) => e.sql.replace(/\{\{oid:(\w+)\}\}/g, (_, t: string) => oids[t] ?? '0');
const run = (c: PgClient, e: Entry): Promise<PgResult> => (e.mode === 'extended' ? c.extended(sql(e), e.params ?? [], { rowLimit: e.rowLimit }) : c.simple(sql(e)));
const open = (user: string) => PgClient.open({ port, user, password: 'pw', database: 'Shop' });
const query = async (text: string) => {
  const c = await open('Admin');
  try { return await c.simple(text); } finally { c.close(); }
};
/** The classes of type a client reads a column as. */
// Whole numbers in the catalog are reported as numeric, the server's number type; a driver reads them as integers.
const CLASS: Record<string, number[]> = { bool: [16], int: [20, 21, 23, 26, 1700], text: [25, 1043, 19, 1042] };

test('the list names a public source for every query and says what was not verified', () => {
  assert.ok(corpus.queries.length >= 100);
  assert.equal(new Set(corpus.queries.map((q) => q.id)).size, corpus.queries.length, 'ids are unique');
  for (const q of corpus.queries) {
    assert.ok(['captured', 'transcribed', 'rendered', 'written'].includes(q.provenance), q.id);
    // A captured query came from a real client; the others name the page or file they follow.
    if (q.provenance !== 'captured') assert.match((q as unknown as { source: string }).source, /^https:\/\//, q.id);
  }
  for (const tool of ['psql', 'JDBC', 'DBeaver', 'Metabase', 'Npgsql', 'SQLAlchemy']) assert.ok(corpus.queries.some((q) => q.tool.startsWith(tool)), tool);
  for (const n of corpus.notVerified) assert.ok(n.tool && n.what && n.why);
  assert.ok(corpus.notVerified.some((n) => /Grafana/.test(n.tool)) && corpus.notVerified.some((n) => /Tableau/.test(n.tool)));
});

test('as an account with SQL access every query answers with its columns or a documented error, and the connection stays usable', async () => {
  const c = await open('Admin');
  try {
    for (const e of corpus.queries) {
      const began = Date.now();
      const r = await run(c, e);
      assert.ok(Date.now() - began < 10_000, `${e.id} took too long`);
      if (e.expect?.error) assert.equal(r.error?.code, e.expect.error, `${e.id}: ${r.error?.message}`);
      else assert.equal(r.error, undefined, `${e.id} (${e.tool}): ${r.error?.code} ${r.error?.message}`);
      if (e.columns) assert.deepEqual(r.columns, e.columns, e.id);
      if (e.expect?.rows !== undefined) assert.equal(r.rows.length, e.expect.rows, e.id);
      if (e.expect?.notice) assert.ok(r.notices.length > 0, `${e.id} says nothing about the setting it did not keep`);
      // Whatever a query did, the next one is answered.
      assert.deepEqual((await c.simple('SELECT 1')).rows, [['1']], `after ${e.id}`);
    }
  } finally { c.close(); }
});

test('the catalog is typed the way clients read it', async () => {
  const c = await open('Admin');
  try {
    const r = await c.simple("SELECT c.relname, c.relhasindex, c.relchecks, c.relkind, c.oid FROM pg_catalog.pg_class c WHERE c.relkind = 'r'");
    const kinds = { relname: 'text', relhasindex: 'bool', relchecks: 'int', relkind: 'text', oid: 'int' };
    r.columns.forEach((name, i) => assert.ok(CLASS[kinds[name as keyof typeof kinds]].includes(r.oids[i]), `${name} is oid ${r.oids[i]}`));
    const a = await c.simple('SELECT attname, attnotnull, attnum, atttypid FROM pg_catalog.pg_attribute WHERE attnum > 0');
    assert.ok(CLASS.bool.includes(a.oids[1]) && CLASS.int.includes(a.oids[2]) && CLASS.int.includes(a.oids[3]));
    const t = await c.simple("SELECT t.typname, t.typbyval FROM pg_catalog.pg_type t WHERE t.typname = 'int4'");
    assert.deepEqual(t.rows[0], ['int4', 't']);
    assert.ok(CLASS.bool.includes(t.oids[1]));
  } finally { c.close(); }
});

test('no query shows rows, tables or names from another hosted file', async () => {
  const c = await open('Admin');
  try {
    const seen: string[] = [];
    for (const e of corpus.queries) seen.push(JSON.stringify((await run(c, e)).rows));
    for (const q of ['SELECT * FROM pg_class', 'SELECT * FROM pg_attribute', 'SELECT * FROM pg_tables', 'SELECT * FROM information_schema.tables', 'SELECT * FROM information_schema.columns',
      'SELECT * FROM pg_database', 'SELECT * FROM pg_namespace', 'SELECT * FROM pg_type', 'SELECT * FROM pg_stat_user_tables', 'SELECT * FROM pg_description']) seen.push(JSON.stringify((await c.simple(q)).rows));
    assert.doesNotMatch(seen.join('\n'), /Secret|Vault|TOPSECRET/);
    // Asking for the other file's table by name, in the ways a tool might, is an error and not its rows.
    for (const q of ['SELECT * FROM "Secret"', 'SELECT * FROM Secret', 'SELECT * FROM "Vault"."Secret"', 'SELECT * FROM public."Secret"', 'SELECT * FROM Vault.Secret', 'SELECT "Note" FROM "Vault"."Secret"',
      'SELECT * FROM "Customers", "Secret"', 'WITH x AS (SELECT * FROM "Secret") SELECT * FROM x', 'SELECT (SELECT "Note" FROM "Secret")',
      `SELECT * FROM pg_class WHERE relname = 'Secret'`]) {
      const r = await c.simple(q);
      assert.doesNotMatch(JSON.stringify(r.rows), /TOPSECRET/, q);
      if (!/pg_class/.test(q)) assert.ok(r.error, `${q} should be refused`);
      else assert.deepEqual(r.rows, []);
    }
    assert.deepEqual((await c.simple('SELECT 1')).rows, [['1']]);
  } finally { c.close(); }
});

test('an account without SQL access, or without the right to see every record, cannot sign in', async () => {
  await assert.rejects(open('sam'), /^Error: 42501 .*fmxdbc/);
  await assert.rejects(open('blind'), /^Error: 42501 /);
  await assert.rejects(PgClient.open({ port, user: 'Admin', password: 'wrong', database: 'Shop' }), /^Error: 28/);
});

test('an account that loses SQL access mid-session gets a refusal, and no rows, from every query', async () => {
  const c = await open('Temp');
  try {
    assert.equal((await c.simple('SELECT 1')).error, undefined);
    assert.equal((await c.simple('SELECT relname FROM pg_class')).rows.length, 4);
    const reader = shop.privilegeSets().find((p) => p.name === 'Reader')!;
    shop.savePrivilegeSet({ ...reader, extendedPrivileges: [] });
    for (const e of corpus.queries) {
      const r = await run(c, e);
      // COMMIT and ROLLBACK with nothing open touch no data and are answered whoever asks.
      if (!/^\s*(COMMIT|ROLLBACK)\b/i.test(e.sql)) assert.equal(r.error?.code, '42501', `${e.id}: ${r.error?.code} ${r.error?.message}`);
      assert.deepEqual(r.rows, [], e.id);
    }
    // Rows from the file's own tables as well.
    assert.equal((await c.simple('SELECT * FROM "Customers"')).error?.code, '42501');
    // And restoring it restores it.
    shop.savePrivilegeSet({ ...reader, extendedPrivileges: ['fmxdbc'] });
    assert.equal((await c.simple('SELECT 1')).error, undefined);
  } finally { c.close(); }
});

// A regression test for each gap the list found.

test('catalog tables psql and DBeaver read exist, with their columns, and are empty', async () => {
  const lists = await query(`${[
    'pg_cast', 'pg_ts_config', 'pg_conversion', 'pg_language', 'pg_opfamily', 'pg_opclass', 'pg_subscription', 'pg_event_trigger',
  ].map((t) => `SELECT count(*) AS n FROM pg_catalog.${t}`).join('; ')}`);
  assert.equal(lists.error, undefined);
  const one = await query('SELECT castsource, casttarget, castfunc, castcontext, castmethod FROM pg_cast');
  assert.deepEqual([one.error, one.rows], [undefined, []]);
  const lan = await query('SELECT lanname, lanowner, lanispl, lanpltrusted, lanplcallfoid FROM pg_language');
  assert.deepEqual([lan.error, lan.rows], [undefined, []]);
  const sub = await query('SELECT subname, subowner, subenabled, subpublications, subbinary FROM pg_subscription');
  assert.deepEqual([sub.error, sub.rows], [undefined, []]);
  const evt = await query('SELECT evtname, evtevent, evtowner, evtenabled, evtfoid, evttags FROM pg_event_trigger');
  assert.deepEqual([evt.error, evt.rows], [undefined, []]);
});

test('functions the tools call answer', async () => {
  const r = await query(`SELECT pg_catalog.pg_database_size('Shop') AS size, pg_catalog.pg_collation_is_visible(0) AS collation, pg_catalog.pg_tablespace_location(0) AS location,
    pg_catalog.pg_get_functiondef(0) AS def, pg_catalog.pg_stat_get_numscans(0) AS scans, pg_catalog.pg_has_role('Admin', 'usage') AS role, getdatabaseencoding() AS enc, pg_catalog.pg_char_to_encoding('UTF8') AS code`);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.rows, [['0', '1', null, null, '0', '1', 'UTF8', '6']]);
});

test('array_remove removes an element and keeps the others quoted', async () => {
  const r = await query(`SELECT array_remove('{a,"b c",d}', 'a') AS x, array_remove(NULL, 'a') AS y, array_remove('{a,b}', 'z') AS z`);
  assert.deepEqual(r.rows, [['{"b c",d}', null, '{a,b}']]);
});

test('array_agg gives the text of a PostgreSQL array, quoted, ordered, and NULL for no rows', async () => {
  const names = await query(`SELECT array_agg("Name" ORDER BY "Name" DESC) AS n FROM "Customers"`);
  assert.equal(names.error, undefined);
  assert.equal(names.rows[0][0], '{' + shop.select('SELECT "Name" FROM "Customers" ORDER BY "Name" DESC', []).rows.map((r) => (/[\s,{}"\\]|^$|^null$/i.test(String(r[0])) ? `"${String(r[0]).replace(/["\\]/g, '\\$&')}"` : String(r[0]))).join(',') + '}');
  const none = await query(`SELECT array_agg("Name") AS n FROM "Customers" WHERE 1 = 0`);
  assert.deepEqual(none.rows, [[null]]);
  const quoted = await query(`SELECT array_agg(x ORDER BY x) AS n FROM (SELECT 'a b' AS x UNION ALL SELECT 'c,d' UNION ALL SELECT NULL UNION ALL SELECT 'NULL' UNION ALL SELECT '' UNION ALL SELECT 'e"f')`);
  assert.deepEqual([quoted.error, quoted.rows], [undefined, [['{NULL,"","NULL","a b","c,d","e\\"f"}']]]);
  // Round trip through array_to_string, which reads the quoting.
  const back = await query(`SELECT array_to_string(array_agg(x), '|') AS n FROM (SELECT 'a b' AS x UNION ALL SELECT 'c,d' UNION ALL SELECT 'e"f') ORDER BY 1`);
  assert.equal(back.rows[0][0], 'a b|c,d|e"f');
  // The aggregate inside a catalog query, as tools write it.
  const cols = await query(`SELECT array_to_string(array_agg(a.attname ORDER BY a.attnum), ',') FROM pg_attribute a WHERE a.attrelid = ${oids.Customers} AND a.attnum > 0`);
  assert.equal(cols.rows[0][0], shop.select('SELECT * FROM "Customers"', []).names.filter((n) => !n.startsWith('_fm_')).join(','));
  const distinct = await query(`SELECT array_agg(DISTINCT "Name") FROM "Customers"`);
  assert.equal(distinct.error?.code, '42000');
  assert.match(distinct.error!.message, /array_agg/);
  assert.deepEqual((await query('SELECT 1')).rows, [['1']]);
});

test('a query that uses array_agg is a read of the file, and is logged as one', async () => {
  shop.setAuditSettings({ logReads: true });
  try {
    const before = shop.auditLog({ kind: 'read' }).length;
    await query(`SELECT array_agg("Name") FROM "Customers"`);
    const reads = shop.auditLog({ kind: 'read' }).slice(before);
    assert.deepEqual(reads.map((r) => [r.surface, r.table, r.account]), [['sql', 'Customers', 'Admin']]);
    // The catalog is not a read of the file's data.
    const mark = shop.auditLog({ kind: 'read' }).length;
    await query('SELECT array_agg(relname) FROM pg_class');
    assert.equal(shop.auditLog({ kind: 'read' }).length, mark);
  } finally { shop.setAuditSettings({ logReads: false }); }
});

test('current_schemas() answers outside catalog queries', async () => {
  const r = await query('SELECT current_schemas(true) AS a, current_schema() AS b');
  assert.deepEqual(r.rows, [['{public}', 'public']]);
});

test('ORDER BY a bare name means the output column, as in PostgreSQL', async () => {
  const r = await query(`SELECT typ.oid, enumlabel FROM pg_enum JOIN pg_type AS typ ON typ.oid = enumtypid JOIN pg_namespace AS ns ON ns.oid = typ.typnamespace ORDER BY oid, enumsortorder`);
  assert.deepEqual([r.error, r.rows], [undefined, []]);
  // An alias that is already a name stays as it is, and so does a name that two output columns share.
  const alias = await query(`SELECT c.oid AS oid, n.oid AS other FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ORDER BY oid DESC LIMIT 1`);
  assert.equal(alias.error, undefined);
  assert.equal(alias.rows[0][0], String(16400 + 3));
});

test('any word may follow AS as a column name in a catalog query', async () => {
  const r = await query(`SELECT 1 AS table, 2 AS update, 3 AS select, 4 AS insert, 5 AS delete, 6 AS user FROM pg_namespace LIMIT 1`);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.columns, ['table', 'update', 'select', 'insert', 'delete', 'user']);
  assert.deepEqual(r.rows, [['1', '2', '3', '4', '5', '6']]);
});

test('unnest takes a column list and WITH ORDINALITY', async () => {
  const r = await query(`SELECT array_to_string(array(SELECT x FROM unnest(evttags) AS t(x)), ', ') AS tags FROM pg_event_trigger`);
  assert.deepEqual([r.error, r.rows], [undefined, []]);
  // As Metabase writes it: in a subquery that reads the index's own columns.
  const o = await query(`SELECT ARRAY(SELECT COALESCE(a.attname, 'x') FROM unnest(ix.indkey[0:ix.indnkeyatts - 1]) WITH ORDINALITY AS k(attnum, ord)
    LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum ORDER BY k.ord) AS key_columns FROM pg_index ix`);
  assert.deepEqual([o.error, o.rows, o.columns], [undefined, [], ['key_columns']]);
  // A join against unnest of an outer table's column is not translated: it is an error, not a hang.
  const lateral = await query('SELECT k.attnum FROM pg_index ix, unnest(ix.indkey) AS k(attnum)');
  assert.equal(lateral.error?.code, '42703');
});

test('the privileges the catalog reports are those of a connection that only reads', async () => {
  const r = await query(`SELECT has_table_privilege('Customers', 'select') AS s, has_table_privilege('Customers', 'insert') AS i, has_table_privilege(current_user, 'Customers', 'update') AS u,
    has_table_privilege('Customers', 'delete') AS d, has_any_column_privilege('Customers', 'select') AS cs, has_any_column_privilege('Customers', 'insert') AS ci,
    has_column_privilege('Customers', 'Name', 'update') AS cu, has_schema_privilege('public', 'usage') AS su, has_schema_privilege('public', 'create') AS sc,
    has_database_privilege('Shop', 'connect') AS dc, has_database_privilege('Shop', 'create') AS dd, has_table_privilege('Customers', 'select, insert') AS both`);
  assert.deepEqual(r.rows, [['1', '0', '0', '0', '1', '0', '0', '1', '0', '1', '0', '1']]);
});

test('cursors and SQL-level PREPARE give a clean refusal that says what to do, and the connection goes on', async () => {
  const c = await open('Admin');
  try {
    for (const text of ['DECLARE c CURSOR FOR SELECT 1', 'FETCH 10 FROM c', 'MOVE FORWARD 2 IN c', 'CLOSE c', 'PREPARE p AS SELECT 1', 'EXECUTE p']) {
      const r = await c.simple(text);
      assert.equal(r.error?.code, '0A000', text);
      assert.doesNotMatch(r.error!.message, /syntax error/, text);
      assert.deepEqual((await c.simple('SELECT 1')).rows, [['1']]);
    }
    // The extended protocol's row limit pages through a result, the way a driver's fetch size does.
    const page = await c.extended('SELECT relname FROM pg_class ORDER BY relname', [], { rowLimit: 2 });
    assert.deepEqual([page.error, page.rows.length], [undefined, 2]);
    // COPY, LISTEN and the rest are read-only refusals.
    for (const text of ['COPY (SELECT 1) TO STDOUT', 'LISTEN x', 'NOTIFY x']) assert.equal((await c.simple(text)).error?.code, '25006', text);
  } finally { c.close(); }
});

test('the tableoid column is there when asked for and not in SELECT *', async () => {
  const r = await query('SELECT c.tableoid, c.relname FROM pg_class c LIMIT 1');
  assert.deepEqual([r.error, r.rows[0][0]], [undefined, '1259']);
  const star = await query('SELECT * FROM pg_class LIMIT 1');
  assert.ok(!star.columns.includes('tableoid'));
});

// Found by the second-opinion review.

test('ORDER BY a name keeps the LIMIT after it', async () => {
  const r = await query('SELECT c.relname FROM pg_class c ORDER BY relname LIMIT 3');
  assert.deepEqual([r.error, r.rows.length], [undefined, 3]);
  const desc = await query('SELECT c.relname FROM pg_class c ORDER BY relname DESC NULLS LAST LIMIT 1 OFFSET 1');
  assert.deepEqual([desc.error, desc.rows.length], [undefined, 1]);
});

test('array_agg inside array_agg works, and a query of many calls or odd comments is not slow', async () => {
  const nested = await query(`SELECT array_agg((SELECT array_agg(relname) FROM pg_class)) AS n FROM "Customers"`);
  assert.equal(nested.error, undefined);
  assert.match(nested.rows[0][0]!, /^\{"\{/);
  let began = Date.now();
  const many = await query(`SELECT ${Array.from({ length: 3000 }, (_, i) => `array_agg("Name") AS a${i}`).join(', ')} FROM "Customers"`);
  assert.ok(Date.now() - began < 5000, 'three thousand calls took too long');
  assert.ok(many.error === undefined || many.error.code !== 'XX000');
  began = Date.now();
  const deep = await query(`SELECT ${'array_agg('.repeat(500)}1${')'.repeat(500)}`);
  assert.equal(deep.error?.code, '42000');
  assert.match(deep.error!.message, /nested too deeply/);
  const comments = await query(`SELECT 1 ${' /::a*'.repeat(20000)}`);
  assert.ok(Date.now() - began < 5000, 'unclosed comments took too long');
  assert.ok(comments.rows.length || comments.error);
  assert.deepEqual((await query('SELECT 1')).rows, [['1']]);
});

test('privilege functions answer yes when any listed privilege is held, and never claim a grant option', async () => {
  const r = await query(`SELECT has_table_privilege('Customers', 'select, insert') AS a, has_table_privilege('Customers', 'insert, update') AS b,
    has_table_privilege('Customers', 'select with grant option') AS c, pg_has_role('postgres', 'member') AS d, pg_has_role(current_user, 'usage') AS e`);
  assert.deepEqual(r.rows, [['1', '0', '0', '0', '1']]);
});

test('array_remove keeps NULL elements and removes NULLs when asked', async () => {
  const r = await query(`SELECT array_remove('{1,NULL,2}', 2) AS a, array_remove('{1,"NULL",2}', 'NULL') AS b, array_remove('{1,NULL,2}', NULL) AS c, array_to_string('{1,NULL,2}', ',') AS d`);
  assert.deepEqual(r.rows, [['{1,NULL}', '{1,2}', '{1,2}', '1,2']]);
});

test('quoted names and strings are not rewritten', async () => {
  const r = await query(`SELECT 1 AS "a AS user", 'current_schemas(true)' AS lit, 'AS user' AS lit2 FROM pg_namespace LIMIT 1`);
  assert.equal(r.error, undefined);
  assert.deepEqual([r.columns, r.rows], [['a AS user', 'lit', 'lit2'], [['1', 'current_schemas(true)', 'AS user']]]);
});

test('a data read with a catalog-looking name in it is still logged', async () => {
  shop.setAuditSettings({ logReads: true });
  try {
    for (const q of [`SELECT "Name" FROM "Customers" WHERE pg_has_role('x', 'y') = 0`, `SELECT "Name" AS pg_x FROM "Customers"`, `SELECT "Name" FROM "Customers" WHERE 'pg_x' = 'pg_x'`]) {
      const before = shop.auditLog({ kind: 'read' }).length;
      const r = await query(q);
      assert.equal(r.error, undefined, q);
      assert.equal(shop.auditLog({ kind: 'read' }).length, before + 1, q);
    }
  } finally { shop.setAuditSettings({ logReads: false }); }
});
