// A portal whose rows each show a field of another related occurrence asks
// for those related records once for the whole page, not once a row, and
// shows what asking row by row would: the first match by creation order,
// text keys matched ignoring case, multi-line keys, numbers as numbers, and
// nothing for a row with no match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import * as trace from '../src/trace.ts';

test('a portal\'s related fields are asked for once per page and match what row-by-row gives', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-portal-related-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Batches', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'BatchId', type: 'number' }, { name: 'Code', type: 'text' }, { name: 'CustId', type: 'number' }] },
      { op: 'createTable', name: 'Products', fields: [{ name: 'Code', type: 'text' }, { name: 'Name', type: 'text' }] },
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name', type: 'text' }] },
      { op: 'createRelationship', left: 'Batches', right: 'Orders', predicates: [{ left: 'Id', right: 'BatchId' }] },
      { op: 'createRelationship', left: 'Orders', right: 'Products', predicates: [{ left: 'Code', right: 'Code' }] },
      { op: 'createRelationship', left: 'Orders', right: 'Customers', predicates: [{ left: 'CustId', right: 'Id' }] },
    ] as never);
    store.create('Batches', { Id: '1' });
    for (const [code, name] of [['abc', 'First abc'], ['ABC', 'Second abc'], ['x', 'X'], ['y', 'Y'], ['é', 'e acute']]) store.create('Products', { Code: code, Name: name });
    for (const [id, name] of [['7', 'Seven'], ['8', 'Eight']]) store.create('Customers', { Id: id, Name: name });
    const orders: [string, string][] = [['Abc', '7'], ['nothing', '8'], ['y\rx', '07'], ['', '9'], ['É', '8.0']];
    for (let i = 0; i < 40; i++) for (const [code, cust] of orders) store.create('Orders', { BatchId: '1', Code: code, CustId: cust });

    const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
    const ref = (o: string, f: string) => ({ tableOccurrenceId: occ(o), fieldId: store.schema.tables.find((x) => x.name === o)!.fields.find((x) => x.name === f)!.id, tableOccurrence: o, field: f });
    const obj = (id: number, r: ReturnType<typeof ref>) => ({ id, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 202, left: 22, bottom: 222, right: 120 }, style: {}, field: { ...r, display: 'edit', repetitions: 1 } });
    const layout = store.design('Batches')!;
    const portal = {
      id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
      portal: { tableOccurrenceId: occ('Orders'), tableOccurrence: 'Orders', rows: 4, initialRow: 1 },
      children: [obj(901, ref('Orders', 'Code')), obj(902, ref('Products', 'Name')), obj(903, ref('Customers', 'Name'))],
    };
    store.applyDesign([{ op: 'updateLayout', layout: 'Batches', design: { objects: [...layout.objects, portal] } as never }]);

    const id = Number(store.find('Batches', { limit: 1 }).records[0].recordId);
    const before = trace.statements;
    const rows = store.get('Batches', id, 'us', { Orders: { limit: 50 } }).portalData!.Orders;
    const ran = trace.statements - before;
    assert.equal(rows.length, 50);
    const shown = rows.slice(0, 5).map((r) => [r['Products::Name'], r['Customers::Name']]);
    // SQLite's NOCASE folds ASCII only, so "É" doesn't match "é" (as row by row).
    assert.deepEqual(shown, [['First abc', 'Seven'], ['', 'Eight'], ['X', 'Seven'], ['', ''], ['', 'Eight']]);
    assert.ok(ran < 30, `${ran} statements for a page of 50 rows`);
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [op, want] of [['=', ['num12']], ['≥', ['num12', 'num5']]] as const) test(`a portal over a number match field holding text (${op}): only numbers compare`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-portal-related-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Batches', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'BatchId', type: 'number' }, { name: 'Code', type: 'text' }] },
      { op: 'createRelationship', left: 'Batches', right: 'Orders', predicates: [{ left: 'Id', right: 'BatchId', operator: op }] },
    ] as never);
    store.create('Batches', { Id: '12' });
    for (const [b, c] of [['12abc', 'text12'], ['N/A', 'na'], ['12', 'num12'], ['5', 'num5']]) store.create('Orders', { BatchId: b, Code: c });
    const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
    const field = { tableOccurrenceId: occ('Orders'), fieldId: store.schema.tables.find((x) => x.name === 'Orders')!.fields.find((x) => x.name === 'Code')!.id, tableOccurrence: 'Orders', field: 'Code', display: 'edit', repetitions: 1 };
    const layout = store.design('Batches')!;
    const portal = { id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
      portal: { tableOccurrenceId: occ('Orders'), tableOccurrence: 'Orders', rows: 4, initialRow: 1 },
      children: [{ id: 901, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 202, left: 22, bottom: 222, right: 120 }, style: {}, field }] };
    store.applyDesign([{ op: 'updateLayout', layout: 'Batches', design: { objects: [...layout.objects, portal] } as never }]);
    const id = Number(store.find('Batches', { limit: 1 }).records[0].recordId);
    assert.deepEqual(store.get('Batches', id, 'us', { Orders: { limit: 50 } }).portalData!.Orders.map((r) => r['Orders::Code']), want);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
