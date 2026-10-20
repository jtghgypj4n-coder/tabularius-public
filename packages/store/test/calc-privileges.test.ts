// An unstored calculation computes only what the viewing account may see: an
// aggregate over a related table the account can't view excludes those records
// (FileMaker's documented behaviour — summary and multi-record calculations
// "exclude data from records for which view privileges have been prohibited").
// Before the fix these calcs were computed with full data regardless of the
// account, leaking totals over hidden tables.
//
// Fixture: fixtures/fmp12/Charts.fmp12. NW Customers::Total Sales is an unstored
// calc = Sum ( NW Line Items::Extended Price ). The first customer's total is
// 4273 under full access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, type PrivilegeDefinition } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-calcpriv-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try { fn(store); } finally { store.close(); rmSync(dir, { recursive: true }); }
}

const LAYOUT = 'NW Customers';

type TableRule = NonNullable<PrivilegeDefinition['tables']>[string];

/** A set that can view NW Customers; its access to NW Line Items is the argument. */
function clerkSet(lineItems: TableRule): PrivilegeDefinition {
  return {
    name: 'Clerk',
    records: { view: true, edit: false, create: false, delete: false },
    tables: { 'NW Line Items': lineItems },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp', 'fmrest'],
  };
}

const firstCustomerId = (s: Store) => Number((s.query(`SELECT _fm_record_id AS id FROM "NW Customers" ORDER BY _fm_record_id LIMIT 1`)[0] as { id: number }).id);
const totalSales = (s: Store, id: number, p?: ReturnType<Store['privileges']>) => (s.get(LAYOUT, id, 'iso', undefined, p) as { fieldData: Record<string, unknown> }).fieldData['Total Sales'];

test('full access reads the real total (baseline)', { skip }, () => {
  withStore((store) => {
    assert.equal(totalSales(store, firstCustomerId(store)), 4273);
  });
});

test('no view on the related table: the aggregate is empty, not the real total', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet(clerkSet({ view: false, edit: false, create: false, delete: false }));
    store.setPassword('Clerk', 'pw', 'Clerk');
    const id = firstCustomerId(store);
    assert.equal(totalSales(store, id, store.privileges('Clerk')), '', 'all line items hidden → Sum excludes them all');
    // Full access, same record, still reads the real value — so it is a privilege check, not a broken calc.
    assert.equal(totalSales(store, id), 4273);
  });
});

test('a record-level rule that allows every line item reads the real total (no over-exclusion)', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet(clerkSet({ view: 'Quantity > -1', edit: false, create: false, delete: false }));
    store.setPassword('Clerk', 'pw', 'Clerk');
    const id = firstCustomerId(store);
    assert.equal(totalSales(store, id, store.privileges('Clerk')), 4273, 'an always-true rule excludes nothing');
  });
});

test('a record-level rule that allows no line item empties the aggregate', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet(clerkSet({ view: 'Quantity < 0', edit: false, create: false, delete: false }));
    store.setPassword('Clerk', 'pw', 'Clerk');
    const id = firstCustomerId(store);
    assert.equal(totalSales(store, id, store.privileges('Clerk')), '', 'an always-false rule excludes every record');
  });
});

test('a partial record-level rule stays between zero and the full total', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet(clerkSet({ view: 'Quantity > 10', edit: false, create: false, delete: false }));
    store.setPassword('Clerk', 'pw', 'Clerk');
    const id = firstCustomerId(store);
    const v = totalSales(store, id, store.privileges('Clerk'));
    const n = v === '' ? 0 : Number(v);
    assert.ok(n >= 0 && n <= 4273, `partial total ${n} within [0, 4273]`);
  });
});

test('field-level no access on the summed field empties the aggregate', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet(clerkSet({ view: true, edit: false, create: false, delete: false, fields: { 'Extended Price': 'none' } }));
    store.setPassword('Clerk', 'pw', 'Clerk');
    const id = firstCustomerId(store);
    assert.equal(totalSales(store, id, store.privileges('Clerk')), '', 'the summed field is hidden, so it contributes nothing');
  });
});

test('leakyStoredCalcs flags a stored calc that exposes a field the set cannot see', { skip }, () => {
  withStore((store) => {
    // Congress::Conservative_StdDev is a STORED calc = StDev ( Conservative_Economic ; ... ).
    // A set that can see the calc but not Conservative_Economic still sees a value derived from it.
    store.savePrivilegeSet({
      name: 'Analyst',
      records: { view: true, edit: false, create: false, delete: false },
      tables: { Congress: { view: true, edit: false, create: false, delete: false, fields: { Conservative_Economic: 'none' } } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
    });
    const leaky = store.leakyStoredCalcs();
    const hit = leaky.find((c) => c.table === 'Congress' && c.field === 'Conservative_StdDev');
    assert.ok(hit, 'the stored StDev calc is flagged');
    assert.ok(hit!.exposes.includes('Conservative_Economic'), 'it names the hidden source field');
    assert.ok(hit!.sets.includes('Analyst'), 'it names the set that can read the calc but not the field');
    // The unstored Total Sales is not a stored-calc leak (it recomputes with privileges).
    assert.ok(!leaky.some((c) => c.field === 'Total Sales'), 'unstored calcs are not flagged here');
  });
});

test('no stored-calc leak when every set can see the source fields', { skip }, () => {
  withStore((store) => {
    // A set that hides nothing the stored calcs read raises no flag.
    store.savePrivilegeSet({
      name: 'Plain', records: { view: true, edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
    });
    assert.deepEqual(store.leakyStoredCalcs(), []);
  });
});

test('ExecuteSQL / scoped SQL cannot total past the privilege set either', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet(clerkSet({ view: false, edit: false, create: false, delete: false }));
    store.setPassword('Clerk', 'pw', 'Clerk');
    const p = store.privileges('Clerk');
    // ExecuteSQL returns tagged Values; a SUM over no visible rows is empty.
    const cell = (v: unknown): string => (v && typeof v === 'object' && 'value' in v ? String((v as { value: unknown }).value) : String(v ?? ''));
    const scoped = cell(store.calc.executeSQL(`SELECT SUM("Extended Price") FROM "NW Line Items"`, [], p)?.[0]?.[0]);
    assert.ok(scoped === '' || Number(scoped) === 0, `scoped SUM is empty for a no-view account (got ${scoped})`);
    // Full access totals the whole table, proving the scoping is the account's.
    const all = cell(store.calc.executeSQL(`SELECT SUM("Extended Price") FROM "NW Line Items"`, [])?.[0]?.[0]);
    assert.ok(Number(all) > 0, `full access still totals the table (got ${all})`);
  });
});
