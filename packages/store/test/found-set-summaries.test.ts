// Summaries over a found set are kept while the data is the same: reading the
// same found set again (another page, a refresh) doesn't add them up again, a
// change is seen, and accounts whose privileges differ never share them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, writer } from '../src/index.ts';
import * as trace from '../src/trace.ts';

test('a found set\'s summaries are added up once while the data is the same, per account', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-found-sums-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  let summing = 0;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    if (/<- recs < collect/.test(String(chunk))) summing++;
    return true;
  }) as typeof process.stderr.write;
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Region', type: 'text' }, { name: 'Total', type: 'number' }, { name: 'Owner', type: 'text' }] },
      { op: 'createField', table: 'Orders', name: 'Double', type: 'number', kind: 'calculation', calculation: 'Total * 2', options: { unstored: true } },
      { op: 'createField', table: 'Orders', name: 'sTotal', kind: 'summary', summary: { type: 'total', field: 'Total' } },
      { op: 'createField', table: 'Orders', name: 'sDouble', kind: 'summary', summary: { type: 'total', field: 'Double' } },
    ] as never);
    for (let i = 1; i <= 30; i++) store.create('Orders', { Region: i % 2 ? 'North' : 'South', Total: String(i), Owner: i <= 10 ? 'alice' : 'bob' });
    const read = (opts: object = {}) => {
      const r = store.find('Orders', { query: [{ Region: 'North' }], limit: 5, ...opts } as never).records[0].fieldData;
      return [Number(r.sTotal), Number(r.sDouble)];
    };
    const north = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29].reduce((a, b) => a + b, 0);
    assert.deepEqual(read(), [north, 2 * north]);
    const first = summing;
    assert.ok(first > 0, 'the first read adds them up');
    assert.deepEqual(read({ offset: 6 }), [north, 2 * north]);
    assert.equal(summing, first, 'another page of the same found set is not added up again');

    const id = Number(store.find('Orders', { query: [{ Region: 'North', Total: '==1' }], limit: 1 }).records[0].recordId);
    store.update('Orders', id, { Total: '101' });
    assert.deepEqual(read(), [north + 100, 2 * (north + 100)], 'a change is seen');

    store.savePrivilegeSet({
      name: 'Own', records: { view: true, edit: false, create: false, delete: false },
      tables: { Orders: { view: 'Owner = Get ( AccountName )', edit: false, create: false, delete: false } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
    } as never);
    store.setPassword('alice', 'pw', 'Own');
    store.setPassword('bob', 'pw', 'Own');
    const as = (who: string) => read({ privileges: store.privileges(who) });
    const alice = 101 + 3 + 5 + 7 + 9;
    assert.deepEqual(as('alice'), [alice, 2 * alice]);
    assert.deepEqual(as('bob'), [north + 100 - alice, 2 * (north + 100 - alice)], 'never alice\'s');
    assert.deepEqual(as('alice'), [alice, 2 * alice]);
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Each session's globals are its own, and a file-level global's change moves no data version.
function session() {
  const m = new Map<string, unknown>();
  return { readGlobal: (_s: unknown, t: { name: string }, f: { name: string }) => m.get(`${t.name}/${f.name}`), writeGlobal: (_s: unknown, t: { name: string }, f: { name: string }, v: unknown) => void m.set(`${t.name}/${f.name}`, v) };
}

for (const via of ['a global field', 'a relationship matched on a global', 'an occurrence named with brackets'] as const) test(`a found set's summaries over a calculation reading ${via} are not kept`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-found-sums-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  store.shareResults();
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Rates', fields: [{ name: 'Currency', type: 'text' }, { name: 'Factor', type: 'number' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Region', type: 'text' }, { name: 'Total', type: 'number' }, { name: 'gRate', type: 'number', options: { global: true } }, { name: 'gCur', type: 'text', options: { global: true } }] },
      { op: 'createOccurrence', name: 'Rates (Open)', table: 'Rates' },
      { op: 'createRelationship', left: 'Orders', right: via === 'an occurrence named with brackets' ? 'Rates (Open)' : 'Rates', predicates: [{ left: 'gCur', right: 'Currency' }] },
      { op: 'createField', table: 'Orders', name: 'Conv', type: 'number', kind: 'calculation', calculation: via === 'a global field' ? 'Total * gRate' : via === 'an occurrence named with brackets' ? 'Total * Rates (Open)::Factor' : 'Total * Rates::Factor', options: { unstored: true } },
      { op: 'createField', table: 'Orders', name: 'sConv', kind: 'summary', summary: { type: 'total', field: 'Conv' } },
    ] as never);
    store.create('Rates', { Currency: 'USD', Factor: '1' });
    store.create('Rates', { Currency: 'JPY', Factor: '100' });
    for (let i = 1; i <= 4; i++) store.create('Orders', { Region: 'North', Total: String(i) });
    const read = () => Number(store.find('Orders', { query: [{ Region: 'North' }], limit: 2 }).records[0].fieldData.sConv);
    const set = (v: string) => (via === 'a global field' ? store.setGlobalField('Orders::gRate', v === 'USD' ? 1 : 100) : store.setGlobalField('Orders::gCur', v));
    // Two sessions.
    assert.equal(writer.run({ globals: session() } as never, () => { set('USD'); return read(); }), 10);
    assert.equal(writer.run({ globals: session() } as never, () => { set('JPY'); return read(); }), 1000, 'another session sees its own global');
    // The file's own global.
    set('USD');
    assert.equal(read(), 10);
    set('JPY');
    assert.equal(read(), 1000, 'a changed global is seen');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a summary named only in a label\'s words is not worked out for a layout read; one in a merge field is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-found-sums-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Total', type: 'number' }] },
      { op: 'createField', table: 'Orders', name: 'Total Amount', kind: 'summary', summary: { type: 'total', field: 'Total' } },
    ] as never);
    for (let i = 1; i <= 3; i++) store.create('Orders', { Total: String(i) });
    const layout = store.design('Orders')!;
    const label = (text: string) => ({ id: 950, kind: 'text', type: 5, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 2, left: 2, bottom: 20, right: 120 }, style: {}, text });
    const keep = layout.objects.filter((o) => o.field?.field !== 'Total Amount');
    const read = (text: string) => {
      store.applyDesign([{ op: 'updateLayout', layout: 'Orders', design: { ...layout, objects: [...keep, label(text)], tableView: layout.tableView?.filter((c) => c.field.field !== 'Total Amount') } as never }]);
      return store.find('Orders', { limit: 1, layoutOnly: true }).records[0].fieldData['Total Amount'];
    };
    assert.equal(read('Total Amount'), undefined, 'a label that only says it');
    assert.equal(Number(read('Sum: <<Total Amount>>')), 6);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a whole-table summary over a calculation reached through a global match key is kept and shared while the globals are the same', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-found-sums-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const setup = new Store(path, 'Shop');
  setup.applyDesign([
    { op: 'createTable', name: 'Rates', fields: [{ name: 'Currency', type: 'text' }, { name: 'Factor', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Total', type: 'number' }, { name: 'gCur', type: 'text', options: { global: true } }] },
    { op: 'createRelationship', left: 'Orders', right: 'Rates', predicates: [{ left: 'gCur', right: 'Currency' }] },
    { op: 'createField', table: 'Orders', name: 'Conv', type: 'number', kind: 'calculation', calculation: 'Total * Rates::Factor', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'sConv', kind: 'summary', summary: { type: 'total', field: 'Conv' } },
  ] as never);
  setup.create('Rates', { Currency: 'USD', Factor: '1' });
  setup.create('Rates', { Currency: 'JPY', Factor: '100' });
  for (let i = 1; i <= 4; i++) setup.create('Orders', { Total: String(i) });
  setup.setGlobalField('Orders::gCur', 'USD');
  setup.close();
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  let summing = 0;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    if (/allRecords < (?:renewing < )?collect/.test(String(chunk))) summing++;
    return true;
  }) as typeof process.stderr.write;
  const a = new Store(path, 'Shop');
  const b = new Store(path, 'Shop');
  try {
    a.shareResults();
    b.shareResults();
    const read = (s: Store) => Number(s.find('Orders', { limit: 1 }).records[0].fieldData.sConv);
    assert.equal(read(a), 10);
    const once = summing;
    assert.ok(once > 0, 'the first read works it out');
    assert.equal(read(a), 10);
    assert.equal(read(b), 10, 'another process reads the shared result');
    assert.equal(summing, once, 'worked out once');
    assert.equal(writer.run({ globals: session() } as never, () => { b.setGlobalField('Orders::gCur', 'JPY'); return read(b); }), 1000, 'a session with another currency gets its own');
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a summary is shared when only another occurrence of its table relates through an unstable key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-found-sums-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const setup = new Store(path, 'Shop');
  setup.applyDesign([
    { op: 'createTable', name: 'Rates', fields: [{ name: 'Id', type: 'number' }, { name: 'Factor', type: 'number' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'RateId', type: 'number' }, { name: 'Total', type: 'number' }] },
    { op: 'createField', table: 'Lines', name: 'Today', type: 'number', kind: 'calculation', calculation: 'Day ( Get ( CurrentDate ) )', options: { unstored: true } },
    // The calculation's own occurrence (Lines) relates by a stored key; another occurrence of Lines by an unstable one.
    { op: 'createRelationship', left: 'Lines', right: 'Rates', predicates: [{ left: 'RateId', right: 'Id' }] },
    { op: 'createOccurrence', name: 'Lines today', table: 'Lines' },
    { op: 'createRelationship', left: 'Lines today', right: 'Rates', predicates: [{ left: 'Today', right: 'Id' }] },
    { op: 'createField', table: 'Lines', name: 'Conv', type: 'number', kind: 'calculation', calculation: 'Total * Rates::Factor', options: { unstored: true } },
    { op: 'createField', table: 'Lines', name: 'sConv', kind: 'summary', summary: { type: 'total', field: 'Conv' } },
  ] as never);
  setup.create('Rates', { Id: '1', Factor: '2' });
  for (let i = 1; i <= 4; i++) setup.create('Lines', { RateId: '1', Total: String(i) });
  setup.close();
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  const notes: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array) => {
    if (String(chunk).startsWith('[sum]')) notes.push(String(chunk).trim());
    return true;
  }) as typeof process.stderr.write;
  const a = new Store(path, 'Shop');
  const b = new Store(path, 'Shop');
  try {
    a.shareResults();
    b.shareResults();
    const read = (s: Store) => Number(s.find('Lines', { limit: 1 }).records[0].fieldData.sConv);
    assert.equal(read(a), 20);
    assert.equal(notes.length, 1, 'worked out once, saying why');
    assert.equal(read(b), 20);
    assert.deepEqual(notes.length, 1, `another connection reads the shared result: ${notes.join(' | ')}`);
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a calculation through an occurrence named with brackets is stable when its match keys are, and shares its results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-found-sums-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Rates', fields: [{ name: 'Currency', type: 'text' }, { name: 'Factor', type: 'number' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Cur', type: 'text' }, { name: 'Total', type: 'number' }, { name: 'gCur', type: 'text', options: { global: true } }] },
      { op: 'createOccurrence', name: 'Rates (Open)', table: 'Rates' },
      { op: 'createOccurrence', name: 'Rates (Picked)', table: 'Rates' },
      { op: 'createRelationship', left: 'Orders', right: 'Rates (Open)', predicates: [{ left: 'Cur', right: 'Currency' }] },
      { op: 'createRelationship', left: 'Orders', right: 'Rates (Picked)', predicates: [{ left: 'gCur', right: 'Currency' }] },
      { op: 'createField', table: 'Orders', name: 'Conv', type: 'number', kind: 'calculation', calculation: 'Total * Rates (Open)::Factor', options: { unstored: true } },
      { op: 'createField', table: 'Orders', name: 'Picked', type: 'number', kind: 'calculation', calculation: 'Total * Rates (Picked)::Factor', options: { unstored: true } },
    ] as never);
    const orders = store.schema.tables.find((t) => t.name === 'Orders')!;
    const field = (n: string) => orders.fields.find((f) => f.name === n)!;
    assert.equal(store.calc.stable(orders, field('Conv')), true, 'a stored match key: shared');
    assert.equal(store.calc.stable(orders, field('Picked')), false, 'a global match key: not shared as is');
    assert.ok(store.calc.stableGivenGlobals(orders, field('Picked')), 'but shared given the global');
    // A related field with brackets in its own name is checked too: one reading the clock is never shared.
    store.applyDesign([
      { op: 'createField', table: 'Rates', name: 'Now (live)', type: 'time', kind: 'calculation', calculation: 'Get ( CurrentTime )', options: { unstored: true } },
      { op: 'createField', table: 'Orders', name: 'Seen', type: 'text', kind: 'calculation', calculation: 'Total & Rates (Open)::Now (live)', options: { unstored: true } },
      { op: 'createField', table: 'Orders', name: 'SeenPlain', type: 'text', kind: 'calculation', calculation: 'Total & Rates::Now (live)', options: { unstored: true } },
      { op: 'createRelationship', left: 'Orders', right: 'Rates', predicates: [{ left: 'Cur', right: 'Currency' }] },
    ] as never);
    const after = store.schema.tables.find((t) => t.name === 'Orders')!;
    for (const n of ['Seen', 'SeenPlain']) assert.equal(store.calc.stable(after, after.fields.find((f) => f.name === n)!), false, n);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
