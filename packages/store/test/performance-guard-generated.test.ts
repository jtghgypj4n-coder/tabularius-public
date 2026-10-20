// A guard against slowdowns that needs no files: 20,000 generated invoices (the same shape scripts/bench.ts makes, at a
// tenth of its size, from a fixed seed) are opened, found, sorted, summed and queried with ExecuteSQL. The ceilings are
// generous (roughly fifty times what a normal machine takes), so a busy runner passes and only a real slowdown, such as
// a find that stops using its index, fails. For real numbers on a big file run `npm run bench` (docs/performance.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp, type FindOptions } from '../src/index.ts';

const RECORDS = 20_000;
const CUSTOMERS = 500;
const RUNS = 3;
/** Milliseconds a slow runner is still allowed, for the best of RUNS runs. */
const LIMIT = { open: 5_000, find: 1_000, sort: 1_500, summary: 2_000, sql: 2_000 };

let dir: string;
let path: string;
let store: Store;
let edits = 0;

function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-perf-gen-'));
  path = join(dir, 'Perf.openhbam.sqlite');
  createStore(path);
  const s = new Store(path, 'Perf');
  s.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] },
    { op: 'createTable', name: 'Invoices', fields: [
      { name: 'Id', type: 'number' }, { name: 'CustomerId', type: 'number' }, { name: 'Customer' }, { name: 'Region' },
      { name: 'Date', type: 'date' }, { name: 'Amount', type: 'number' }, { name: 'Status' }, { name: 'Notes' },
    ] },
    { op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerId', right: 'Id' }] },
    { op: 'createField', table: 'Invoices', name: 'Total Amount', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
  ] as DesignOp[]);
  s.close();
  const rnd = random(20261015);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const regions = ['North', 'South', 'East', 'West', 'Midlands'];
  const statuses = ['Paid', 'Paid', 'Paid', 'Open', 'Overdue'];
  const words = ['urgent', 'repeat', 'discount', 'export', 'warranty', 'sample', 'trade', 'online'];
  const sql = new DatabaseSync(path);
  sql.exec('BEGIN');
  const cust = sql.prepare('INSERT INTO Customers (Id, Name, City) VALUES (?, ?, ?)');
  for (let i = 1; i <= CUSTOMERS; i++) cust.run(i, `Customer ${i}`, pick(['Leeds', 'York', 'Bath', 'Hull']));
  const inv = sql.prepare('INSERT INTO Invoices (Id, CustomerId, Customer, Region, Date, Amount, Status, Notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const start = Date.UTC(2022, 0, 1);
  for (let i = 1; i <= RECORDS; i++) {
    const c = 1 + Math.floor(rnd() * CUSTOMERS);
    const date = new Date(start + Math.floor(rnd() * 4 * 365) * 86_400_000).toISOString().slice(0, 10);
    inv.run(i, c, `Customer ${c}`, pick(regions), date, Math.round(rnd() * 100_000) / 100, pick(statuses), `${pick(words)} ${pick(words)} order ${i}`);
  }
  sql.exec('COMMIT');
  sql.close();
  store = new Store(path, 'Perf');
});

after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The best of RUNS runs, so one slow moment on a busy machine doesn't fail it. */
function best(run: () => unknown, before?: () => void): number {
  let min = Infinity;
  for (let i = 0; i < RUNS; i++) {
    before?.();
    const t = performance.now();
    run();
    min = Math.min(min, performance.now() - t);
  }
  return min;
}
const page = (opts: FindOptions) => store.find('Invoices', { limit: 50, layoutOnly: true, ...opts }).foundCount;
const change = () => { store.update('Invoices', 1 + (edits++ % RECORDS), { Amount: 100 + (edits % 7) }); };

test('opening the file and reading a first page', () => {
  const ms = best(() => { const s = new Store(path, 'Perf'); assert.equal(s.find('Invoices', { limit: 50, layoutOnly: true }).foundCount, RECORDS); s.close(); });
  assert.ok(ms < LIMIT.open, `open took ${ms.toFixed(0)} ms (limit ${LIMIT.open})`);
});

for (const [name, opts, check] of [
  ['one word in a text field', { query: [{ Notes: 'warranty' }] }, (n: number) => n > 0 && n < RECORDS],
  ['a number range', { query: [{ Amount: '900...1000' }] }, (n: number) => n > 0 && n < RECORDS],
  ['a date range', { query: [{ Date: '3/1/2024...3/31/2024' }] }, (n: number) => n > 0 && n < RECORDS],
  ['two fields', { query: [{ Region: 'North', Status: 'Overdue' }] }, (n: number) => n > 0 && n < RECORDS],
  ['a request and an omit', { query: [{ Status: 'Open' }, { Region: 'West', omit: 'true' }] }, (n: number) => n > 0 && n < RECORDS],
] as [string, FindOptions, (n: number) => boolean][]) {
  test(`find: ${name}`, () => {
    let n = 0;
    const ms = best(() => { n = page(opts); });
    assert.ok(check(n), `found ${n}`);
    assert.ok(ms < LIMIT.find, `find took ${ms.toFixed(0)} ms (limit ${LIMIT.find})`);
  });
}

for (const [name, sort] of [
  ['text', [{ fieldName: 'Customer', sortOrder: 'ascend' }]],
  ['number, descending', [{ fieldName: 'Amount', sortOrder: 'descend' }]],
  ['two fields', [{ fieldName: 'Region', sortOrder: 'ascend' }, { fieldName: 'Date', sortOrder: 'descend' }]],
] as [string, FindOptions['sort']][]) {
  test(`sort all records by ${name}`, () => {
    const ms = best(() => { assert.equal(page({ sort }), RECORDS); });
    assert.ok(ms < LIMIT.sort, `sort took ${ms.toFixed(0)} ms (limit ${LIMIT.sort})`);
  });
}

test('a summary field after a change', () => {
  const ms = best(() => { assert.equal(page({}), RECORDS); }, change);
  assert.ok(ms < LIMIT.summary, `summary took ${ms.toFixed(0)} ms (limit ${LIMIT.summary})`);
});

for (const [name, q] of [
  ['SUM with a WHERE', `SELECT SUM(Amount) FROM Invoices WHERE Region = 'North'`],
  ['COUNT with GROUP BY', 'SELECT Status, COUNT(*) FROM Invoices GROUP BY Status'],
  ['a JOIN to Customers', 'SELECT c.City, SUM(i.Amount) FROM Invoices i JOIN Customers c ON i.CustomerId = c.Id GROUP BY c.City'],
  ['ORDER BY with FETCH FIRST', 'SELECT Customer, Amount FROM Invoices ORDER BY Amount DESC FETCH FIRST 10 ROWS ONLY'],
]) {
  test(`ExecuteSQL: ${name}`, () => {
    const ms = best(() => {
      const r = store.evaluate('Invoices', `ExecuteSQL ( "${q}" ; "" ; "" )`);
      assert.notEqual(r.value, '?');
      assert.ok(r.value !== '');
    }, change);
    assert.ok(ms < LIMIT.sql, `ExecuteSQL took ${ms.toFixed(0)} ms (limit ${LIMIT.sql})`);
  });
}
