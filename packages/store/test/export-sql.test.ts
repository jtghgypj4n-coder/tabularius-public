import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, exportSql, exportSqlSummary, Store, StoreError } from '../src/index.ts';

let dir: string;
let store: Store;

const run = (target: Store, opts: Parameters<typeof exportSql>[2] = {}) => {
  let script = '';
  const files = new Map<string, Uint8Array>();
  const report = exportSql(target, { write: (s) => { script += s; }, file: (p, d) => { files.set(p, d); } }, opts);
  return { script, files, report };
};
const load = (script: string) => {
  const db = new DatabaseSync(':memory:');
  db.exec(script);
  return db;
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-export-sql-'));
  createStore(join(dir, 'Shop.sqlite'));
  store = new Store(join(dir, 'Shop.sqlite'), 'Shop');
  store.applyDesign([
    {
      op: 'createTable', name: 'Customers', fields: [
        { name: 'Code', type: 'text', options: { validation: { unique: true, notEmpty: true } } },
        { name: 'Name', type: 'text' },
        { name: 'Credit', type: 'number' },
        { name: 'Born', type: 'date' },
        { name: 'Since', type: 'timestamp' },
        { name: 'Photo', type: 'container' },
        { name: 'Weird "name"', type: 'text' },
        { name: 'Record_Id', type: 'text' },
        { name: 'Tags', type: 'text', options: { repetitions: 3 } },
        { name: 'Id', type: 'number', options: { autoEnter: { serial: { next: '100', increment: 5 } } } },
        { name: 'Global', type: 'text', options: { global: true } },
      ],
    },
    { op: 'createField', table: 'Customers', name: 'Double', type: 'number', kind: 'calculation', calculation: 'Credit * 2' },
    {
      op: 'createTable', name: 'Orders', fields: [
        { name: 'CustomerCode', type: 'text' },
        { name: 'Total', type: 'number' },
      ],
    },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Code', op: '=', right: 'CustomerCode' }] },
    { op: 'createValueList', name: 'Colours', values: ['red', "it's green", 'blue'] },
  ] as never);
  const ann = Number(store.create('Customers', { Code: 'A1', Name: "Ann O'Neil", Credit: '-0', Born: '2/3/2024', Since: '2/3/2024 10:30:00', 'Weird "name"': 'line1\nline2 \\ back', Id: '100' }).recordId);
  store.setContainer('Customers', ann, 'Photo', 1, { filename: 'ann face.png', mime: 'image/png', data: new Uint8Array([1, 2, 3]) });
  store.create('Customers', { Code: 'B2', Name: '', Credit: '12.5', Born: '12/31/9999', 'Tags(1)': 'x', 'Tags(2)': "y'z", Id: '105' });
  store.create('Customers', { Code: 'C3', Name: '日本語 🎉', Credit: '1e21' });
  store.create('Orders', { CustomerCode: 'A1', Total: '10' });
  store.create('Orders', { CustomerCode: 'A1', Total: '20' });
  store.create('Orders', { CustomerCode: 'B2', Total: '5' });
});

after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('a SQLite script loads into SQLite with the same rows, types and values', () => {
  const { script, files, report } = run(store, { dialect: 'sqlite', filesFolder: 'Shop.files' });
  const db = load(script);
  try {
    assert.equal(report.tables, 2);
    assert.equal(report.rows, 6);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM "Customers"').get() as { n: number }).n, 3);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM "Orders"').get() as { n: number }).n, 3);
    const ann = db.prepare('SELECT * FROM "Customers" WHERE "Code" = ?').get('A1') as Record<string, unknown>;
    assert.equal(ann.Name, "Ann O'Neil");
    assert.equal(ann.Credit, 0);
    assert.equal(ann.Born, '2024-02-03');
    assert.equal(ann.Since, '2024-02-03T10:30:00');
    assert.equal(ann['Weird "name"'], 'line1\nline2 \\ back');
    assert.equal(ann.Photo, 'Shop.files/Customers/1-6-ann_face.png');
    assert.deepEqual([...(files.get('Shop.files/Customers/1-6-ann_face.png') ?? [])], [1, 2, 3]);
    const cy = db.prepare('SELECT * FROM "Customers" WHERE "Code" = ?').get('C3') as Record<string, unknown>;
    assert.equal(cy.Name, '日本語 🎉');
    assert.equal(cy.Credit, 1e21);
    assert.equal(cy.Born, null, 'never set stays NULL');
    const bee = db.prepare('SELECT * FROM "Customers" WHERE "Code" = ?').get('B2') as Record<string, unknown>;
    // Empty and NULL come out as the file stores them (it keeps an emptied field as NULL).
    assert.equal(bee.Name, store.select(`SELECT "Name" FROM "Customers" WHERE "Code" = 'B2'`).rows[0][0]);
    assert.equal(bee.Born, '9999-12-31');
    assert.deepEqual(JSON.parse(String(bee.Tags)), ['x', "y'z", null].slice(0, JSON.parse(String(bee.Tags)).length));
    // A field called Record_Id doesn't collide with the key column (SQL names ignore case).
    const columns = (db.prepare('PRAGMA table_info("Customers")').all() as { name: string }[]).map((c) => c.name);
    assert.equal(new Set(columns.map((c) => c.toLowerCase())).size, columns.length);
    assert.ok(columns.includes('record_id') && columns.includes('Record_Id_2'));
    // The relationship became a foreign key, the unique code a unique constraint.
    assert.equal((db.prepare('PRAGMA foreign_key_list("Orders")').all() as unknown[]).length, 1);
    assert.throws(() => db.exec(`INSERT INTO "Customers" ("Code") VALUES ('A1')`), /UNIQUE/);
    // The value list is a lookup table in list order.
    assert.deepEqual(db.prepare('SELECT "value" FROM "value_list_Colours" ORDER BY "position"').all().map((r) => (r as { value: string }).value), ['red', "it's green", 'blue']);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('AR-store-design-io-12', () => {
  store.applyDesign([{ op: 'createValueList', name: 'Choices', values: ['A', 'A\u0000'] }] as never);
  const { script, report } = run(store, { dialect: 'sqlite' });
  const db = load(script);
  try {
    assert.deepEqual(db.prepare('SELECT value FROM value_list_Choices').all().map((r) => r.value), ['A']);
    assert.equal(report.nulCharactersDropped, 1);
  } finally { db.close(); }
});

test('the PostgreSQL script for a small file', () => {
  const path = join(dir, 'Small.sqlite');
  createStore(path);
  const small = new Store(path, 'Small');
  try {
    small.applyDesign([
      { op: 'createTable', name: 'People', fields: [{ name: 'Name', type: 'text', options: { validation: { notEmpty: true } } }, { name: 'Age', type: 'number' }, { name: 'Born', type: 'date' }, { name: 'Seen', type: 'time' }, { name: 'Tags', type: 'text', options: { repetitions: 2 } }, { name: 'Ref', type: 'number', options: { autoEnter: { serial: { next: '7', increment: 1 } } } }] },
      { op: 'createField', table: 'People', name: 'Twice', type: 'number', kind: 'calculation', calculation: 'Age *\n2' },
    ] as never);
    small.create('People', { Name: "O'Hara", Age: '-0', Born: '2/29/2024', Seen: '23:59:59', 'Tags(1)': 'a', 'Tags(2)': 'b', Ref: '7' });
    small.create('People', { Name: 'Zoe', Age: '41.5' });
    const { script, report } = run(small, { dialect: 'postgres', filesFolder: 'Small.files' });
    assert.equal(script, `-- Written by tabularius export-sql (postgres). Records, fields, value lists, relationships and container files only:
-- scripts, layouts, privilege sets and accounts are not carried. Values are those stored in the file.
BEGIN;

CREATE SEQUENCE "People_Ref_seq" START WITH 8 INCREMENT BY 1;
CREATE TABLE "People" (
  "record_id" BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  "Name" TEXT NOT NULL,
  "Age" DOUBLE PRECISION,
  "Born" DATE,
  "Seen" TIME,
  "Tags" TEXT[],
  "Ref" DOUBLE PRECISION DEFAULT nextval('"People_Ref_seq"'),
  "Twice" DOUBLE PRECISION
);
COMMENT ON COLUMN "People"."Twice" IS 'Calculation, exported as the value stored in the file: Age * ⏎ 2';

INSERT INTO "People" ("record_id", "Name", "Age", "Born", "Seen", "Tags", "Ref", "Twice") VALUES
  (1, 'O''Hara', 0, '2024-02-29', '23:59:59', ARRAY['a', 'b']::TEXT[], 7, 0),
  (2, 'Zoe', 41.5, NULL, NULL, NULL, 7, 83);
SELECT setval(pg_get_serial_sequence('"People"', 'record_id'), 2);


COMMIT;
`);
    assert.equal(report.sequences, 1);
    assert.equal(report.notNullConstraints, 1);
  } finally {
    small.close();
  }
});

test('a script from an account that may not export is refused, and hidden fields and records are left out', () => {
  store.savePrivilegeSet({
    name: 'Staff', records: { view: true, edit: false, create: false, delete: false, fields: { Name: 'none' } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [], exporting: true,
  } as never);
  const staff = store.privilegesForSet('Staff');
  const { script, report } = run(store, { dialect: 'sqlite', privileges: staff });
  assert.ok(!script.includes('"Name"'), 'a field the account cannot read is not in the script');
  assert.ok(!script.includes('Ann'), 'nor its values');
  assert.equal(report.skipped['field the account may not read'], 1);
  store.savePrivilegeSet({
    name: 'NoExport', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
    extendedPrivileges: [], exporting: false,
  } as never);
  assert.throws(() => run(store, { privileges: store.privilegesForSet('NoExport') }), (e) => e instanceof StoreError && /may not export/.test(e.message));
});

test('the summary is counts only', () => {
  const text = exportSqlSummary(run(store, { dialect: 'sqlite' }).report).join('\n');
  assert.match(text, /2 tables/);
  assert.ok(!/Ann|Customers|Orders/.test(text));
});

test('PostgreSQL gets the key as ALTER TABLE after the data, and indexes the matching columns', () => {
  const { script, report } = run(store, { dialect: 'postgres' });
  assert.match(script, /ALTER TABLE "Orders" ADD CONSTRAINT "Orders_CustomerCode_fkey" FOREIGN KEY \("CustomerCode"\) REFERENCES "Customers" \("Code"\);/);
  assert.match(script, /"Code" TEXT NOT NULL UNIQUE/);
  assert.match(script, /CREATE SEQUENCE "Customers_Id_seq" START WITH 110 INCREMENT BY 5;/);
  assert.match(script, /"Tags" TEXT\[\]/);
  assert.equal(report.foreignKeys, 1);
  assert.equal(report.indexes, 1);
  assert.ok(script.indexOf('ALTER TABLE') > script.indexOf('INSERT INTO "Orders"'), 'keys come after the rows');
});

test('constraints the data breaks are left out so the script still loads, and a key with no match is only indexed', () => {
  const path = join(dir, 'Messy.sqlite');
  createStore(path);
  const messy = new Store(path, 'Messy');
  try {
    messy.applyDesign([
      { op: 'createTable', name: 'Parent', fields: [{ name: 'K', type: 'text' }] },
      { op: 'createTable', name: 'Child', fields: [{ name: 'K', type: 'text' }] },
      { op: 'createRelationship', left: 'Parent', right: 'Child', predicates: [{ left: 'K', op: '=', right: 'K' }] },
    ] as never);
    messy.create('Parent', { K: 'a' });
    messy.create('Parent', { K: 'a' });
    messy.create('Parent', {});
    messy.create('Child', { K: 'zzz' });
    // Rules added after the data was entered, which the data breaks.
    messy.applyDesign([{ op: 'updateField', table: 'Parent', field: 'K', options: { validation: { unique: true, notEmpty: true } } }] as never);
    const { script, report } = run(messy, { dialect: 'sqlite' });
    const db = load(script);
    try {
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM "Parent"').get() as { n: number }).n, 3);
      assert.equal(report.uniqueConstraints, 0);
      assert.equal(report.notNullConstraints, 0);
      assert.equal(report.foreignKeys, 0);
      assert.deepEqual(Object.keys(report.constraintsLeftOut).sort(), ['not empty (the data has empty values)', 'unique (the data repeats a value)']);
      assert.equal(report.indexes, 2);
    } finally {
      db.close();
    }
  } finally {
    messy.close();
  }
});

test('many rows and a very large value come through whole', () => {
  const path = join(dir, 'Big.sqlite');
  createStore(path);
  const big = new Store(path, 'Big');
  try {
    big.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Body', type: 'text' }, { name: 'N', type: 'number' }] }] as never);
    const body = 'é\n'.repeat(500_000);
    big.create('Notes', { Body: body, N: '1' });
    for (let i = 2; i <= 1300; i++) big.create('Notes', { Body: `row ${i}`, N: String(i) });
    const { script, report } = run(big, { dialect: 'sqlite', batch: 100 });
    const db = load(script);
    try {
      assert.equal(report.rows, 1300);
      assert.equal((db.prepare('SELECT COUNT(*) AS n, SUM("N") AS s FROM "Notes"').get() as { n: number; s: number }).s, (1300 * 1301) / 2);
      assert.equal((db.prepare('SELECT "Body" AS b FROM "Notes" WHERE "N" = 1').get() as { b: string }).b, body);
    } finally {
      db.close();
    }
  } finally {
    big.close();
  }
});

// Needs a PostgreSQL server: TABULARIUS_TEST_PG_URL=postgresql://user@host/emptydatabase npm test (psql on the PATH).
test('the PostgreSQL script loads into PostgreSQL', { skip: !process.env.TABULARIUS_TEST_PG_URL }, () => {
  const file = join(dir, 'Shop.pg.sql');
  writeFileSync(file, run(store, { dialect: 'postgres' }).script);
  const r = spawnSync('psql', [process.env.TABULARIUS_TEST_PG_URL!, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('a native file keeps decimals exact and its booleans, JSON and UUIDs typed', () => {
  const path = join(dir, 'Native.sqlite');
  createStore(path, { mode: 'native' });
  const native = new Store(path, 'Native');
  try {
    native.applyDesign([{ op: 'createTable', name: 'Items', fields: [
      { name: 'Price', type: 'decimal' }, { name: 'Count', type: 'integer' }, { name: 'On', type: 'boolean' }, { name: 'Doc', type: 'json' }, { name: 'Ref', type: 'uuid' },
    ] }] as never);
    native.create('Items', { Price: '12345678901234567890.123456789', Count: 9007199254740991, On: 1, Doc: '{"a":[1,2]}', Ref: '123e4567-e89b-12d3-a456-426614174000' });
    const pg = run(native, { dialect: 'postgres' }).script;
    assert.match(pg, /"Price" NUMERIC,/);
    assert.match(pg, /\(1, 12345678901234567890\.123456789, 9007199254740991, TRUE, '\{"a":\[1,2\]\}', '123e4567-e89b-12d3-a456-426614174000'\)/);
    const db = load(run(native, { dialect: 'sqlite' }).script);
    try {
      const row = db.prepare('SELECT * FROM "Items"').get() as Record<string, unknown>;
      assert.equal(row.Price, '12345678901234567890.123456789');
      assert.equal(row.On, 1);
      assert.equal(JSON.parse(String(row.Doc)).a[1], 2);
    } finally {
      db.close();
    }
  } finally {
    native.close();
  }
});
