// A record whose layout reaches large related tables: related fields,
// unstored calculations over relationships (one hop, two hops, ×, and a
// match on a value every record shares), and portals that filter and sort.
// Shown one record at a time, it must cost about one record's memory, not
// the related tables'. The read runs in a process with a small heap, where
// holding the related records crashes it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../src/index.ts';

const ORDERS = 40_000;
const HEAP_MB = 64;
let dir: string;
let path: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-related-memory-'));
  path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customer', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'One', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }, { name: 'CustomerId', type: 'number' }, { name: 'One', type: 'number' }, { name: 'Total', type: 'number' }, { name: 'Status' }, { name: 'Notes' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'OrderId', type: 'number' }, { name: 'Qty', type: 'number' }, { name: 'Product' }] },
    { op: 'createRelationship', left: 'Customer', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Lines', predicates: [{ left: 'Id', right: 'OrderId' }] },
    { op: 'createOccurrence', name: 'AllOrders', table: 'Orders' },
    { op: 'createRelationship', left: 'Customer', right: 'AllOrders', predicates: [{ left: 'Id', operator: '×', right: 'Id' }] },
    { op: 'createOccurrence', name: 'SameOne', table: 'Orders' },
    { op: 'createRelationship', left: 'Customer', right: 'SameOne', predicates: [{ left: 'One', right: 'One' }] },
    { op: 'createField', table: 'Orders', name: 'LineQty', kind: 'calculation', calculation: 'Sum(Lines::Qty)', options: { unstored: true } },
    { op: 'createField', table: 'Customer', name: 'OrderTotal', kind: 'calculation', calculation: 'Sum(Orders::Total)', options: { unstored: true } },
    { op: 'createField', table: 'Customer', name: 'AllCount', kind: 'calculation', calculation: 'Count(AllOrders::Id)', options: { unstored: true } },
    { op: 'createField', table: 'Customer', name: 'SameCount', kind: 'calculation', calculation: 'Count(SameOne::Id)', options: { unstored: true } },
    { op: 'createField', table: 'Customer', name: 'FirstStatus', kind: 'calculation', calculation: 'AllOrders::Status & " " & SameOne::Total', options: { unstored: true } },
    { op: 'createField', table: 'Customer', name: 'Qty', kind: 'calculation', calculation: 'Sum(Lines::Qty)', options: { unstored: true } },
  ] as never);
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
  const ref = (to: string, f: string) => {
    const table = store.schema.tables.find((t) => t.id === occ(to).baseTableId)!;
    return { tableOccurrenceId: occ(to).id, fieldId: table.fields.find((x) => x.name === f)!.id, tableOccurrence: to, field: f };
  };
  let id = 1000;
  let top = 10;
  const field = (r: ReturnType<typeof ref>) => ({ id: ++id, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: top += 20, left: 20, bottom: top + 18, right: 200 }, style: {}, field: { ...r, display: 'edit', repetitions: 1 } });
  const objects: unknown[] = [];
  for (const f of ['Name', 'OrderTotal', 'AllCount', 'SameCount', 'FirstStatus', 'Qty']) objects.push(field(ref('Customer', f)));
  for (const to of ['Orders', 'AllOrders', 'SameOne']) for (const f of ['Total', 'Status', 'LineQty']) objects.push(field(ref(to, f)));
  for (const [to, sorted, filtered] of [['Orders', false, false], ['AllOrders', true, true], ['SameOne', true, false]] as const) {
    objects.push({
      id: ++id, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: top += 30, left: 20, bottom: top + 100, right: 300 }, style: {},
      portal: { tableOccurrenceId: occ(to).id, tableOccurrence: to, rows: 5, initialRow: 1, ...(sorted ? { sort: [{ field: ref(to, 'Total'), descending: true }] } : {}), ...(filtered ? { filter: `${to}::Status ≠ "Void" and ${to}::LineQty > 0` } : {}) },
      children: ['Total', 'Status', 'LineQty'].map((f) => field(ref(to, f))),
    });
  }
  store.applyDesign([{ op: 'updateLayout', layout: 'Customer', design: { objects: [...store.design('Customer')!.objects, ...objects] } as never }]);
  store.close();
  const sql = new DatabaseSync(path);
  sql.exec('BEGIN');
  for (let i = 1; i <= 10; i++) sql.prepare('INSERT INTO Customer (Id, Name, One) VALUES (?, ?, 1)').run(i, `Customer ${i}`);
  const order = sql.prepare('INSERT INTO Orders (Id, CustomerId, One, Total, Status, Notes) VALUES (?, ?, 1, ?, ?, ?)');
  const line = sql.prepare('INSERT INTO Lines (OrderId, Qty, Product) VALUES (?, ?, ?)');
  for (let i = 1; i <= ORDERS; i++) {
    order.run(i, i % 10 === 0 ? 2 : 1, i % 97, i % 3 ? 'Open' : 'Void', 'A longer note about the order. '.repeat(8) + i);
    line.run(i, i % 5, 'A product with a long name '.repeat(4));
  }
  sql.exec('COMMIT');
  sql.close();
});
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('one record of a layout over large related tables reads in a small heap', { timeout: 120_000 }, () => {
  const store = join(import.meta.dirname, '..', 'src', 'index.ts');
  const r = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, '--no-warnings', '--input-type=module', '-e', `
    import { Store } from ${JSON.stringify(store)};
    const s = new Store(${JSON.stringify(path)}, 'Shop');
    const found = s.find('Customer', { limit: 1, portals: { AllOrders: { limit: 3 }, SameOne: { limit: 3 } } });
    const rec = found.records[0];
    console.log(JSON.stringify({ found: found.foundCount, fields: rec.fieldData, portals: Object.fromEntries(Object.entries(rec.portalData).map(([k, v]) => [k, v.map((x) => x.recordId)])), counts: s.portalCounts('Customer', rec.recordId) }));
  `], { encoding: 'utf8', timeout: 110_000 });
  assert.equal(r.status, 0, r.stderr.split('\n').filter((l) => !/^\s+\d+: 0x/.test(l)).slice(0, 12).join('\n'));
  const out = JSON.parse(r.stdout);
  assert.equal(out.found, 10);
  const f = out.fields;
  assert.equal(f.AllCount, String(ORDERS));
  assert.equal(f.SameCount, String(ORDERS));
  assert.equal(f.FirstStatus, 'Open 1');
  // Customer 1 has 9 orders in 10; Lines are two hops away.
  let total = 0;
  let qty = 0;
  for (let i = 1; i <= ORDERS; i++) if (i % 10 !== 0) {
    total += i % 97;
    qty += i % 5;
  }
  assert.equal(f.OrderTotal, String(total));
  assert.equal(f.Qty, String(qty));
  assert.equal(f['Orders::Total'], 1);
  // Portals: one-hop paging, a filter on a related calculation, and a sort.
  assert.deepEqual(out.portals.Orders.slice(0, 3), ['1', '2', '3']);
  for (const id of out.portals.AllOrders) assert.ok(Number(id) % 3 !== 0 && Number(id) % 5 !== 0, `${id} passes the filter`);
  assert.deepEqual(out.portals.SameOne.length, 3);
  assert.equal(out.counts.Orders, ORDERS * 9 / 10);
  assert.equal(out.counts.SameOne, ORDERS);
  // Not Void (1 in 3 are) and with a quantity (1 in 5 have none): 8 in 15 remain.
  let shown = 0;
  for (let i = 1; i <= ORDERS; i++) if (i % 3 !== 0 && i % 5 !== 0) shown++;
  assert.equal(out.counts.AllOrders, shown);
});
