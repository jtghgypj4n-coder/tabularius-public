// Regressions found reviewing shared results: a result kept for a limited
// account isn't reused after its privilege set changes; one over value lists,
// layouts or scripts isn't shared at all; nothing is kept from a read another
// process's change landed in the middle of; the results file is readable by
// the server's user only, holds no huge values, and goes when the folder is
// encrypted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';
import { ResultCache } from '../../store/src/results.ts';
import { writer } from '../../store/src/activity.ts';

function shop(fn: (path: string, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-shared-design-'));
  try {
    const path = join(dir, 'Shop.openhbam.sqlite');
    createStore(path);
    fn(path, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const open = (path: string) => {
  const s = new Store(path, 'Shop');
  s.shareResults();
  return s;
};

test('a limited account\'s totals are worked out again after its privilege set changes', () => shop((path) => {
  const s = new Store(path, 'Shop');
  s.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Total', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createField', table: 'Customers', name: 'Spent', type: 'number', kind: 'calculation', calculation: 'Sum ( Orders::Total )', options: { unstored: true } },
    { op: 'createField', table: 'Customers', name: 'sSpent', kind: 'summary', summary: { type: 'total', field: 'Spent' } },
  ] as never);
  s.create('Customers', { Id: '1' });
  for (const t of [1, 2, 500]) s.create('Orders', { CustomerId: '1', Total: String(t) });
  const set = (view: string) => ({
    name: 'Clerk', records: { view: true, edit: false, create: false, delete: false },
    tables: { Orders: { view, edit: false, create: false, delete: false } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
  });
  s.savePrivilegeSet(set('Total > 0') as never);
  s.setPassword('Clerk', 'pw', 'Clerk');
  s.close();
  const total = (st: Store) => {
    const t = st.schema.tables.find((x) => x.name === 'Customers')!;
    const f = t.fields.find((x) => x.name === 'sSpent')!;
    return st.calc.wholeTable(t, [f], st.calc.newPass('Clerk', st.privileges('Clerk'))).get(f)!.nums.reduce((a, b) => a + b, 0);
  };
  const a = open(path);
  assert.equal(total(a), 503);
  const b = open(path);
  b.savePrivilegeSet(set('Total < 100') as never);
  const c = open(path);
  try {
    assert.equal(total(c), 3, 'never the total from before the change');
    assert.equal(total(b), 3);
  } finally {
    a.close();
    b.close();
    c.close();
  }
}));

test('a calculation over a value list (or a table named at run time) is never shared', () => shop((path) => {
  const s = new Store(path, 'Shop');
  s.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createValueList', name: 'VL', values: ['a', 'b'] },
    { op: 'createField', table: 'T', name: 'C', type: 'number', kind: 'calculation', calculation: 'ValueCount ( ValueListItems ( "Shop" ; "VL" ) )', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'S', kind: 'summary', summary: { type: 'total', field: 'C' } },
    { op: 'createField', table: 'T', name: 'D', type: 'number', kind: 'calculation', calculation: 'ExecuteSQL ( "SELECT COUNT(*) FROM " & "T" ; "" ; "" )', options: { unstored: true } },
  ] as never);
  for (let i = 1; i <= 3; i++) s.create('T', { Id: String(i) });
  s.close();
  const a = open(path);
  const b = open(path);
  const sum = (st: Store) => {
    const t = st.schema.tables.find((x) => x.name === 'T')!;
    const f = t.fields.find((x) => x.name === 'S')!;
    return st.calc.wholeTable(t, [f], st.calc.newPass()).get(f)!.nums.reduce((x, y) => x + y, 0);
  };
  try {
    assert.equal(sum(a), 6);
    b.applyDesign([{ op: 'updateValueList', valueList: 'VL', values: ['a', 'b', 'c', 'd'] }] as never);
    assert.equal(sum(b), 12);
    const c = open(path);
    assert.equal(sum(c), 12);
    const t = c.schema.tables.find((x) => x.name === 'T')!;
    assert.equal(c.calc.stable(t, t.fields.find((x) => x.name === 'D')!), false, 'FROM " & name may be any table');
    c.close();
  } finally {
    a.close();
    b.close();
  }
}));

test('a total read while another process changed a record is not kept as of the version before', () => shop((path) => {
  const s = new Store(path, 'Shop');
  s.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Total', type: 'number' }] },
    { op: 'createCustomFunction', name: 'Twice', parameters: ['x'], formula: 'x * 2' },
    { op: 'createField', table: 'Orders', name: 'N', type: 'number', kind: 'calculation', calculation: 'Twice ( Total )', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'sN', kind: 'summary', summary: { type: 'total', field: 'N' } },
  ] as never);
  for (let i = 1; i <= 50; i++) s.create('Orders', { Total: '1' });
  s.close();
  const a = open(path);
  const b = open(path);
  try {
    const t = a.schema.tables.find((x) => x.name === 'Orders')!;
    const f = t.fields.find((x) => x.name === 'sN')!;
    const id = Number((b.query('SELECT _fm_record_id AS id FROM Orders ORDER BY _fm_record_id LIMIT 1')[0] as { id: number }).id);
    // B's change lands while A reads the records (after A took its version).
    let n = 0;
    const calc = a.calc as unknown as { value: (...args: unknown[]) => unknown };
    const value = calc.value.bind(a.calc);
    calc.value = (...args: unknown[]) => {
      if (++n === 10) b.update('Orders', id, { Total: '100' });
      return value(...args);
    };
    a.calc.wholeTable(t, [f], a.calc.newPass());
    calc.value = value;
    assert.equal(n > 10, true);
    // Whatever was kept is exactly as of the version it is kept at: read in one snapshot, B's change isn't in it.
    const kept = new DatabaseSync(`${path}.results`).prepare("SELECT stamp, value FROM results WHERE key LIKE '%/sum/%'").all() as { stamp: string; value: string }[];
    for (const r of kept) {
      const total = (JSON.parse(r.value) as { nums: number[] }).nums.reduce((x, y) => x + y, 0);
      assert.equal(total, r.stamp.endsWith('/v0') ? 100 : 298, r.stamp);
    }
    const fresh = open(path);
    const ft = fresh.schema.tables.find((x) => x.name === 'Orders')!;
    const ff = ft.fields.find((x) => x.name === 'sN')!;
    assert.equal(fresh.calc.wholeTable(ft, [ff], fresh.calc.newPass()).get(ff)!.nums.reduce((x, y) => x + y, 0), 49 * 2 + 200);
    fresh.close();
  } finally {
    a.close();
    b.close();
  }
}));

test('the results file is the server user\'s alone, keeps no huge values, and goes when the folder is encrypted', { skip: process.platform === 'win32' }, () => shop((path, dir) => {
  const r = new ResultCache(`${path}.results`);
  assert.equal(statSync(`${path}.results`).mode & 0o077, 0);
  r.put('big', 'x/v1', 'x'.repeat(5 * 2 ** 20));
  assert.equal(r.get('big'), undefined);
  r.put('token', '3:7', 'v');
  assert.equal(r.get('token'), undefined, 'a per-connection token is never shared');
  r.put('ok', 'x/v1', 'v');
  assert.equal(r.get('ok')?.value, 'v');
  r.close();
  writeFileSync(`${path}.results-wal`, '');
  const cli = join(import.meta.dirname, '../../cli/src/main.ts');
  const run = spawnSync(process.execPath, ['--no-warnings', cli, 'encrypt', dir], { encoding: 'utf8', env: { ...process.env, TABULARIUS_ENCRYPTION_KEY: 'k' } });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(!existsSync(`${path}.results`));
  assert.ok(!existsSync(`${path}.results-wal`));
}));

test('an account that keeps changing records stays "its own change" on every process', () => shop((path) => {
  const s = new Store(path, 'Shop');
  s.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'N', type: 'number' }] }] as never);
  const { recordId } = s.create('T', { N: '1' });
  s.shareResults();
  const real = Date.now, realMono = performance.now;
  let now = real(), mono = realMono.call(performance);
  Date.now = () => now;
  performance.now = () => mono;
  try {
    for (let i = 0; i < 4; i++) {
      writer.run({ account: 'Clerk' }, () => s.update('T', recordId, { N: String(i) }));
      now += 4_000; mono += 4_000;
    }
    // Every 4 s for 16 s: noted again at least every 5 s, not only the first time.
    assert.ok(s.results!.lastWrite('Clerk')! >= now - 9_000);
  } finally {
    Date.now = real;
    performance.now = realMono;
    s.close();
  }
}));

test('SQL with a table named at run time is not shared; ordinary text with "from" is', () => shop((path) => {
  const s = new Store(path, 'Shop');
  s.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'N', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'Q', type: 'number', kind: 'calculation', calculation: 'ExecuteSQL ( "SELECT COUNT(*) FROM \\"" & "T" & "\\"" ; "" ; "" )', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'Text', type: 'text', kind: 'calculation', calculation: '"Shipped from Berlin " & N', options: { unstored: true } },
  ] as never);
  const t = s.schema.tables.find((x) => x.name === 'T')!;
  assert.equal(s.calc.stable(t, t.fields.find((x) => x.name === 'Q')!), false);
  assert.equal(s.calc.stable(t, t.fields.find((x) => x.name === 'Text')!), true);
  s.close();
}));

test('totals for an account whose privilege rules read the clock are never shared', () => shop((path) => {
  const s = new Store(path, 'Shop');
  s.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Day', type: 'date' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createField', table: 'Customers', name: 'Recent', type: 'number', kind: 'calculation', calculation: 'Count ( Orders::Day )', options: { unstored: true } },
    { op: 'createField', table: 'Customers', name: 'sRecent', kind: 'summary', summary: { type: 'total', field: 'Recent' } },
  ] as never);
  s.create('Customers', { Id: '1' });
  s.create('Orders', { CustomerId: '1', Day: '1/1/2020' });
  s.savePrivilegeSet({
    name: 'Clerk', records: { view: true, edit: false, create: false, delete: false },
    tables: { Orders: { view: 'Day > Get ( CurrentDate ) - 30', edit: false, create: false, delete: false } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
  } as never);
  s.setPassword('Clerk', 'pw', 'Clerk');
  s.shareResults();
  const t = s.schema.tables.find((x) => x.name === 'Customers')!;
  const f = t.fields.find((x) => x.name === 'sRecent')!;
  s.calc.wholeTable(t, [f], s.calc.newPass('Clerk', s.privileges('Clerk')));
  const shared = new DatabaseSync(`${path}.results`).prepare("SELECT key FROM results WHERE key LIKE '%/sum/%'").all();
  assert.deepEqual(shared, []);
  s.close();
}));

test('a results file made before it was kept private is made private', { skip: process.platform === 'win32' }, () => shop((path) => {
  writeFileSync(`${path}.results`, '');
  chmodSync(`${path}.results`, 0o644);
  new ResultCache(`${path}.results`).close();
  assert.equal(statSync(`${path}.results`).mode & 0o077, 0);
}));
