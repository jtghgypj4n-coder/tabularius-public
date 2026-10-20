import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, StoreError } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  store = new Store(join(dir, 'Charts.sqlite'));
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const names = (r: ReturnType<Store['find']>) => r.records.map((x) => x.fieldData.Name);

test('layouts map to base tables', { skip }, () => {
  assert.ok(store.layouts().some((l) => l.name === 'Congress' && l.table === 'Congress'));
  assert.throws(() => store.layout('Nope'), (e: StoreError) => e.code === 105);
});

test('find: FileMaker operators', { skip }, () => {
  const all = store.find('Congress', { limit: 0 });
  assert.equal(all.totalCount, 540);
  const find = (query: Record<string, string>[]) => store.find('Congress', { query, limit: 1000 });
  // Default: a word starts with the text, case-insensitive.
  assert.ok(names(find([{ Name: 'pelo' }])).includes('Nancy Pelosi'));
  const count = (where: string) => store.query(`SELECT count(*) AS n FROM Congress WHERE ${where}`)[0].n;
  assert.equal(find([{ State: '==california' }]).foundCount, count(`State = 'California'`));
  assert.equal(find([{ State: '==Cal' }]).foundCount, 0);
  assert.equal(find([{ Liberal_Rank: '10...12' }]).foundCount, 3);
  assert.ok(find([{ Liberal_Composite: '>90' }]).records.every((r) => (r.fieldData.Liberal_Composite as number) > 90));
  const ca = find([{ State: '==California' }]).foundCount;
  const caD = find([{ State: '==California', Party: '==D' }]).foundCount;
  const caNotD = find([{ State: '==California' }, { Party: '==D', omit: 'true' }]).foundCount;
  assert.equal(caNotD, ca - caD);
  assert.equal(find([{ Name: 'N*cy' }]).records.length > 0, true);
  assert.throws(() => find([{ Bogus: 'x' }]), (e: StoreError) => e.code === 102);
});

test('find on related fields: a related record matching all of its criteria', { skip }, () => {
  const count = (sql: string) => Number(store.query(sql)[0].n);
  // One hop: customers Robert King sells to.
  const king = store.find('NW Customers', { query: [{ 'NW SalespersonCustomers::Salesperson': '==Robert King' }] });
  assert.equal(king.foundCount, count(`SELECT count(DISTINCT Customer) AS n FROM "NW SalespersonCustomers" WHERE Salesperson = 'Robert King'`));
  // Two hops (Customers -> SalespersonCustomers -> Line Items), with a range.
  const join = `FROM "NW Line Items" li JOIN "NW SalespersonCustomers" sc ON sc.Customer = li.Customer AND sc.Salesperson = li.Salesperson`;
  const big = store.find('NW Customers', { query: [{ 'NW Line Items::Quantity': '>100' }] });
  assert.equal(big.foundCount, count(`SELECT count(DISTINCT li.Customer) AS n ${join} WHERE CAST(li.Quantity AS REAL) > 100`));
  assert.ok(big.foundCount > 0);
  // Two criteria on one occurrence must hold for the same related record.
  const both = store.find('NW Customers', { query: [{ 'NW Line Items::Quantity': '>50', 'NW Line Items::Discount': '>0.2' }] });
  assert.equal(both.foundCount, count(`SELECT count(DISTINCT li.Customer) AS n ${join} WHERE CAST(li.Quantity AS REAL) > 50 AND CAST(li.Discount AS REAL) > 0.2`));
  // Omit requests and the layout's own fields combine with related criteria.
  const notNancy = store.find('NW Customers', { query: [{ 'NW SalespersonCustomers::Salesperson': '==Robert King' }, { 'NW SalespersonCustomers::Salesperson': '==Nancy Davolio', omit: 'true' }] });
  assert.ok(notNancy.foundCount < king.foundCount);
  const first = String(king.records[0].fieldData.Customer);
  assert.equal(store.find('NW Customers', { query: [{ Customer: `==${first}`, 'NW SalespersonCustomers::Salesperson': '==Robert King' }] }).foundCount, 1);
  assert.throws(() => store.find('NW Customers', { query: [{ 'Nope::X': '1' }] }), /Field "Nope::X" is missing/);
});

test('sort and paging', { skip }, () => {
  const r = store.find('Congress', { sort: [{ fieldName: 'Liberal_Rank', sortOrder: 'descend' }], limit: 3, offset: 2 });
  const ranks = r.records.map((x) => x.fieldData.Liberal_Rank as number);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
  assert.equal(r.records.length, 3);
});

test('text sorts in FileMaker\'s index order, not byte order', { skip }, () => {
  // Charts' own index on NW Customers::Customer lists the names this way (byte order puts 7 of them elsewhere).
  const got = store.find('NW Customers', { sort: [{ fieldName: 'Customer', sortOrder: 'ascend' }], limit: 1000 }).records.map((r) => String(r.fieldData.Customer));
  const en = new Intl.Collator('en', { sensitivity: 'base' });
  assert.deepEqual(got, [...got].sort(en.compare));
  assert.notDeepEqual(got, [...got].sort());
});

test('create, update with modId, delete', { skip }, () => {
  const { recordId } = store.create('Congress', { Name: 'Test Person', District: '7' });
  assert.ok(recordId > 540);
  let rec = store.get('Congress', recordId);
  assert.equal(rec.fieldData.District, 7);
  assert.equal(store.update('Congress', recordId, { Party: 'I' }, 0).modId, 1);
  assert.throws(() => store.update('Congress', recordId, { Party: 'X' }, 0), (e: StoreError) => e.code === 306);
  assert.throws(() => store.update('Congress', recordId, { Conservative_StdDev: 1 }), (e: StoreError) => e.code === 201);
  rec = store.get('Congress', recordId);
  assert.equal(rec.fieldData.Party, 'I');
  store.delete('Congress', recordId);
  assert.throws(() => store.get('Congress', recordId), (e: StoreError) => e.code === 101);
});

test('accounts: passwords are hashed and names are case-insensitive', { skip }, () => {
  store.setPassword('Admin', 's3cret');
  assert.ok(store.verify('admin', 's3cret'));
  assert.ok(!store.verify('Admin', 'wrong'));
  assert.ok(!store.verify('Nobody', 's3cret'));
});

test('sql queries are read-only', { skip }, () => {
  assert.equal(store.query('SELECT count(*) AS n FROM Congress')[0].n, 540);
  assert.throws(() => store.query('DELETE FROM Congress'), /Only SELECT/);
  // A read-only connection would still run these.
  assert.throws(() => store.query("VACUUM INTO 'copy.sqlite'"), /Only SELECT/);
  assert.throws(() => store.query("ATTACH 'other.sqlite' AS o"), /Only SELECT/);
  assert.throws(() => store.query('WITH x AS (SELECT 1) DELETE FROM Congress'), /readonly/);
});
