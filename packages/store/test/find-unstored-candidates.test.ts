// A find on an unstored calculation computes it only for the records the find's stored criteria can match, and finds
// exactly the records, in the same order, that computing it for every record would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type FindRequest, type SortSpec } from '../src/index.ts';

const REGIONS = ['North', 'South', 'East'];
const COUNT = 300;

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-find-unstored-candidates-'));
  const path = join(dir, 'Sales.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Sales', fields: [
      { name: 'Region' }, { name: 'Status' }, { name: 'Amount', type: 'number' }, { name: 'Flag', options: { global: true } },
    ] },
    { op: 'createField', table: 'Sales', name: 'Tax', type: 'number', kind: 'calculation', calculation: 'Amount * 2', options: { unstored: true } },
  ] as never);
  const rows: { id: number; region: string; status: string; tax: number }[] = [];
  for (let i = 0; i < COUNT; i++) {
    const region = REGIONS[i % 3];
    const status = (i * 7) % 4 === 0 ? 'Open' : 'Paid';
    const amount = (i * 37) % 500;
    rows.push({ id: store.create('Sales', { Region: region, Status: status, Amount: amount }).recordId, region, status, tax: amount * 2 });
  }
  store.setGlobalField('Sales::Flag', 'on');
  return { store, rows };
}

type Row = ReturnType<typeof fixture>['rows'][number];

/** The same criteria worked out in JavaScript over every record: the reference the store's answer must equal. */
function matches(row: Row, criteria: Record<string, string>): boolean {
  return Object.entries(criteria).every(([field, c]) => {
    if (field === 'Region') return row.region === c;
    if (field === 'Status') return row.status === c;
    if (field === 'Flag') return c === 'on';
    const v = field === 'Tax' ? row.tax : row.tax / 2;
    if (c.startsWith('>')) return v > Number(c.slice(1));
    if (c.startsWith('<')) return v < Number(c.slice(1));
    const [lo, hi] = c.split('...').map(Number);
    return v >= lo && v <= hi;
  });
}

function expected(rows: Row[], query: FindRequest[], sort?: SortSpec[]): number[] {
  const found = rows.filter((row) => query.reduce((inSet, r, i) => {
    const { omit, ...criteria } = r;
    const hit = matches(row, criteria as Record<string, string>);
    const omitting = omit === true || omit === 'true';
    return i === 0 ? (omitting ? !hit : hit) : omitting ? inSet && !hit : inSet || hit;
  }, false));
  if (sort) found.sort((a, b) => b.tax - a.tax || a.id - b.id);
  return found.map((r) => r.id);
}

const CASES: { name: string; query: FindRequest[]; candidates: number }[] = [
  { name: 'only the calculation', query: [{ Tax: '>600' }], candidates: COUNT },
  { name: 'a stored field and the calculation', query: [{ Region: 'North', Tax: '>600' }], candidates: 100 },
  { name: 'two requests, each with a stored field', query: [{ Region: 'North', Tax: '>600' }, { Status: 'Open' }], candidates: 150 },
  { name: 'an omit of the calculation after a stored request', query: [{ Region: 'North' }, { Tax: '<100', omit: 'true' }], candidates: 100 },
  { name: 'an omit first', query: [{ Tax: '<100', omit: 'true' }], candidates: COUNT },
  { name: 'a later request only on the calculation', query: [{ Region: 'North', Tax: '>600' }, { Tax: '<20' }], candidates: COUNT },
  { name: 'a range and a later stored omit', query: [{ Region: 'East', Tax: '200...400' }, { Region: 'South', omit: 'true' }], candidates: 100 },
  { name: 'a stored number range and the calculation', query: [{ Amount: '100...200', Tax: '>300' }], candidates: 0 },
  { name: 'a global and a stored field', query: [{ Region: 'South', Flag: 'on' }], candidates: 0 },
];

for (const c of CASES) for (const sort of [undefined, [{ fieldName: 'Tax', sortOrder: 'descend' }] as SortSpec[]]) {
  test(`same found set and order with ${c.name}${sort ? ', sorted on the calculation' : ''}`, (t) => {
    const { store, rows } = fixture(t);
    const want = expected(rows, c.query, sort);
    assert.ok(want.length > 0 && want.length < COUNT, 'the case finds some records, not all');
    assert.deepEqual(store.findIds('Sales', { query: c.query, sort }), want);
    const found = store.find('Sales', { query: c.query, sort, limit: COUNT });
    assert.equal(found.foundCount, want.length);
    assert.deepEqual(found.records.map((r) => Number(r.recordId)), want);
    // Paging reads the same order.
    assert.deepEqual(store.find('Sales', { query: c.query, sort, offset: 3, limit: 5 }).records.map((r) => Number(r.recordId)), want.slice(2, 7));
  });
}

test('the calculation is computed only for the records the stored criteria select', (t) => {
  const { store, rows } = fixture(t);
  const calc = t.mock.method(store.calc, 'unstoredValue');
  for (const c of CASES) {
    calc.mock.resetCalls();
    store.findIds('Sales', { query: c.query });
    const stored = c.candidates || rows.filter((r) => c.query.some((q) => q.omit === undefined && matches(r, Object.fromEntries(Object.entries(q).filter(([k]) => k !== 'Tax' && k !== 'Flag')) as Record<string, string>))).length;
    // A global is not a calculation: a find naming only a global and stored fields computes no calculation at all.
    assert.equal(calc.mock.callCount(), c.query.some((q) => 'Tax' in q) ? stored : 0, c.name);
  }
  // A sort with no find still computes every record.
  calc.mock.resetCalls();
  store.findIds('Sales', { sort: [{ fieldName: 'Tax', sortOrder: 'ascend' }] });
  assert.equal(calc.mock.callCount(), COUNT);
});

test('duplicates on the calculation still compute every record', (t) => {
  const { store } = fixture(t);
  const calc = t.mock.method(store.calc, 'unstoredValue');
  // Every amount differs, so no record has a duplicate; the point is how many were computed to know that.
  assert.deepEqual(store.findIds('Sales', { query: [{ Region: 'North', Tax: '!' }] }), []);
  assert.equal(calc.mock.callCount(), COUNT);
});
