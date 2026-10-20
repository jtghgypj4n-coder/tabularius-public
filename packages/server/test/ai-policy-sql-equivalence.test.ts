import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asText } from '@tabularius/calc';
import { createStore, Store } from '../../store/src/index.ts';
import { assertAiPolicy } from '../src/ai-policy.ts';
import { sqlFieldRefs } from '../src/ai-policy-sql.ts';

const queries = [
  'SELECT Name FROM Items ORDER BY Id',
  'SELECT Name, Password FROM Items ORDER BY Id',
  'SELECT i.Name, o.Name FROM Items i JOIN Orders o ON i.Id = o.Id ORDER BY i.Id',
  "SELECT Name FROM Items WHERE Password = 'p' ORDER BY Id",
  "SELECT Name FROM Items WHERE Id IN (SELECT Id FROM Orders WHERE Password = 'p') ORDER BY Id",
  'SELECT Name, count(*) FROM Items GROUP BY Name HAVING count(*) > 0 ORDER BY Name',
  'SELECT Name FROM Items UNION SELECT Name FROM Orders ORDER BY Name LIMIT 4',
  'WITH x AS (SELECT Id, Name FROM Items) SELECT x.Name FROM x JOIN Orders o ON x.Id = o.Id ORDER BY x.Id',
  'SELECT Name FROM Items ORDER BY Password, Id LIMIT 2',
  'SELECT count(*) FROM Items WHERE EXISTS (SELECT 1 FROM Orders WHERE Orders.Id = Items.Id)',
  'SELECT Name FROM (SELECT Name, Id FROM Items) AS x ORDER BY Id LIMIT 2',
  'SELECT Name FROM Items UNION ALL SELECT Name FROM Orders ORDER BY Name LIMIT 4',
  'WITH Items AS (SELECT Id, Name FROM Orders) SELECT Name FROM Items ORDER BY Id',
  'WITH "Items"("Id", "Name") AS MATERIALIZED (SELECT Id, Name FROM Orders), x AS (SELECT Name FROM "Items") SELECT Name FROM x ORDER BY Name',
  'SELECT Id FROM Items WHERE Id IN (WITH Items AS (SELECT Id FROM Orders WHERE Id = 2) SELECT Id FROM Items) ORDER BY Id',
];

function rows(db: DatabaseSync, query: string): string[][] {
  const statement = db.prepare(query);
  statement.setReturnArrays(true);
  return (statement.all() as unknown as unknown[][]).map((row) =>
    row.map((value) => value == null ? '' : String(value)));
}

function verifyEquivalence(seed: number): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-sql-equivalence-'));
  const path = join(dir, 'Synthetic.sqlite');
  createStore(path);
  const store = new Store(path, 'Synthetic');
  const filtered = new DatabaseSync(':memory:');
  const full = new DatabaseSync(':memory:');
  const maskedFull = new DatabaseSync(':memory:');
  try {
    for (const table of ['Items', 'Orders']) {
      store.applyDesign([{ op: 'createTable', name: table, fields: [
        { name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Password' },
      ] }]);
      for (const db of [filtered, full, maskedFull]) db.exec(`CREATE TABLE ${table} (Id REAL, Name TEXT, Password TEXT)`);
    }
    // The seed and every row are synthetic. Vary duplicates, join matches and
    // secret predicates so a missing filter changes observable results.
    let state = seed;
    const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    for (const table of ['Items', 'Orders']) for (let id = 1; id <= 8; id++) {
      const name = ['A', 'B', 'C'][(next() >>> 16) % 3];
      const password = ['p', 'q', 'r'][(next() >>> 16) % 3];
      store.create(table, { Id: id, Name: name, Password: password });
      full.prepare(`INSERT INTO ${table} VALUES (?, ?, ?)`).run(id, name, password);
      maskedFull.prepare(`INSERT INTO ${table} VALUES (?, ?, NULL)`).run(id, name);
      if (id <= 4) filtered.prepare(`INSERT INTO ${table} VALUES (?, ?, NULL)`).run(id, name);
    }
    store.savePrivilegeSet({
      name: 'Reader', records: { view: 'Id <= 4', edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [],
      tables: Object.fromEntries(['Items', 'Orders'].map((table) => [table, {
        view: 'Id <= 4', edit: false, create: false, delete: false, fields: { Password: 'none' },
      }])),
      aiVisible: { Items: ['Password'], Orders: ['Password'] },
    });
    store.setPassword('reader', 'synthetic-password', 'Reader');
    const privileges = store.privileges('reader');
    assert.equal(store.aiPolicy, true);
    const generated = Array.from({ length: 48 }, () => {
      const table = (next() >>> 16) % 2 ? 'Items' : 'Orders';
      const column = (next() >>> 16) % 2 ? 'Name' : 'Password';
      const predicate = ['Id > 1', "Name <> 'C'", "Password = 'p'", 'Id IN (SELECT Id FROM Orders)'][(next() >>> 16) % 4];
      const order = (next() >>> 16) % 2 ? 'Id' : 'Password, Id';
      const limit = 1 + (next() >>> 16) % 5;
      return `SELECT ${column} FROM ${table} WHERE ${predicate} ORDER BY ${order} LIMIT ${limit}`;
    });
    for (const query of [...queries, ...generated]) {
      const refs = sqlFieldRefs(store.schema, query);
      assert.ok(refs, `seed ${seed}: planner refused accepted query: ${query}`);
      // If changing only a field changes the answer, the planner must name it.
      // This tests dependency discovery separately from row filtering.
      if (JSON.stringify(rows(full, query)) !== JSON.stringify(rows(maskedFull, query))) {
        assert.ok(refs.some((ref) => store.schema.tables.find((table) => table.id === ref.table)
          ?.fields.some((field) => field.id === ref.field && field.name === 'Password')),
        `seed ${seed}: planner missed a secret dependency: ${query}`);
      }
      assertAiPolicy(store, privileges, 'generated SQL', { sql: query });
      const actual = store.calc.executeSQL(query, [], privileges)
        .map((row) => row.map((value) => asText(value)));
      assert.deepEqual(actual, rows(filtered, query), `seed ${seed}: policy equivalence: ${query}`);
    }
  } finally {
    full.close();
    filtered.close();
    maskedFull.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const seed of [0x3024cafe, 0x3024caff, 0x3024cb00, 0x3024cb01]) {
  test(`AI policy SQL agrees with a filtered copy for generated seed ${seed}`, () => verifyEquivalence(seed));
}

test('a refusal does not reveal privilege-hidden object names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-sql-errors-'));
  const path = join(dir, 'Synthetic.sqlite');
  createStore(path);
  const store = new Store(path, 'Synthetic');
  try {
    store.applyDesign([{ op: 'createTable', name: 'HiddenTable', fields: [{ name: 'Password' }] }]);
    store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [],
      tables: { HiddenTable: { view: true, edit: false, create: false, delete: false,
        fields: { Password: 'none' } } } });
    store.setPassword('reader', 'synthetic-password', 'Reader');
    assert.throws(() => assertAiPolicy(store, store.privileges('reader'), 'generated SQL',
      { sql: 'SELECT Password FROM HiddenTable' }), (error: Error) => {
      assert.match(error.message, /AI policy refused/);
      assert.doesNotMatch(error.message, /HiddenTable|Password/);
      return true;
    });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
