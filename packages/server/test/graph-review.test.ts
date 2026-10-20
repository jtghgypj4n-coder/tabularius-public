import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';
import { reviewGraph } from '../src/graph-review.ts';
import { designOf } from '../src/design.ts';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-graph-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Shop');
    try {
      fn(store);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('graph review: anchor-buoy groups, problems, and a tidy arrangement', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id' }, { name: 'Pick', options: { global: true } }] },
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Id' }, { name: 'CustomerId' }, { name: 'Key', kind: 'calculation', calculation: 'CustomerId', options: { unstored: true } }] },
    { op: 'createTable', name: 'Notes', fields: [{ name: 'Text' }] },
    { op: 'createOccurrence', name: 'Scratch', table: 'Notes' },
    { op: 'createOccurrence', name: 'inv_CUS', table: 'Customers' },
    { op: 'createOccurrence', name: 'inv_CUS 2', table: 'Customers' },
    { op: 'createOccurrence', name: 'cus_INV', table: 'Invoices' },
    { op: 'createRelationship', left: 'Invoices', right: 'inv_CUS', predicates: [{ left: 'CustomerId', right: 'Id' }] },
    { op: 'createRelationship', left: 'Invoices', right: 'inv_CUS 2', predicates: [{ left: 'CustomerId', right: 'Id' }] },
    { op: 'createRelationship', left: 'Customers', right: 'cus_INV', predicates: [{ left: 'Pick', right: 'Key' }] },
  ] as DesignOp[], { account: 'Admin' });

  const r = reviewGraph(store);
  const rules = r.issues.map((i) => `${i.rule}: ${i.message}`);
  // inv_CUS and inv_CUS 2 repeat each other in the Invoices group, and neither is used anywhere.
  assert.ok(rules.some((x) => x.startsWith('duplicate: Invoices – inv_CUS and Invoices – inv_CUS 2 both relate Invoices to Customers')), rules.join('\n'));
  assert.ok(rules.some((x) => x.startsWith('unused: Nothing uses inv_CUS 2')), rules.join('\n'));
  // Scratch has no layout, no use, no links.
  assert.ok(rules.some((x) => /^unused: Nothing uses Scratch.*isn't related to anything/.test(x)), rules.join('\n'));
  // Globals and unstored calculations as match fields, on both sides of Customers – cus_INV.
  assert.ok(rules.some((x) => /^unindexed: Customers::Pick is a global field/.test(x)), rules.join('\n'));
  assert.ok(rules.some((x) => /^unindexed: cus_INV::Key is an unstored calculation/.test(x)), rules.join('\n'));

  assert.match(r.summary[0], /7 table occurrences of 3 tables, joined by 3 relationships into 2 groups, plus 2 occurrences on their own/);
  const invoices = r.groups.find((g) => g.occurrences.length === 3)!;
  assert.equal(store.schema.tableOccurrences.find((t) => t.id === invoices.anchor)?.name, 'Invoices');
  assert.equal(invoices.anchorBuoy, true);

  // Tidying: the anchor in the first column, its buoys one column to the right, nothing overlapping.
  store.applyDesign(r.arrange, { account: 'Admin' });
  const at = new Map(store.schema.tableOccurrences.map((t) => [t.name, t.graph!]));
  assert.ok(at.get('inv_CUS')!.left > at.get('Invoices')!.left);
  assert.equal(at.get('inv_CUS')!.left, at.get('inv_CUS 2')!.left);
  const boxes = [...at.values()];
  for (const a of boxes) for (const b of boxes) {
    if (a === b) continue;
    const apart = a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top;
    assert.ok(apart, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`);
  }
  assert.equal(reviewGraph(store).arrange.length, 0, 'tidy twice moves nothing');
}));

test('graph: another hosted file\'s tables are listed for occurrences into it, only when that file can be designed too', () => withStore((store) => withStore((parts) => {
  parts.applyDesign([{ op: 'createTable', name: 'Parts', fields: [{ name: 'Sku' }, { name: 'Name' }] }] as DesignOp[], { account: 'Admin' });
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Sku' }] },
    { op: 'createDataSource', name: 'Catalog', paths: ['file:Catalog'] },
  ] as DesignOp[], { account: 'Admin' });
  const listed = designOf(store, ['Catalog'], () => parts).dataSources.find((d) => d.name === 'Catalog')!;
  assert.deepEqual(listed.tables?.map((t) => [t.name, t.fields.map((f) => f.name)]), [['Parts', ['Sku', 'Name']]]);
  assert.equal(designOf(store, ['Catalog'], () => undefined).dataSources[0].tables, undefined);
  // What the graph's New table occurrence form sends for one, and a relationship drawn to it by field id.
  const table = listed.tables![0];
  store.applyDesign([
    { op: 'createOccurrence', name: 'ord_PARTS', file: listed.id, externalTable: table.id },
    { op: 'createRelationship', left: 'Orders', right: 'ord_PARTS', predicates: [{ left: 'Sku', right: table.fields[0].id }] },
  ] as DesignOp[], { account: 'Admin' });
  const to = store.schema.tableOccurrences.find((t) => t.name === 'ord_PARTS')!;
  assert.equal(to.dataSourceId, listed.id);
  assert.equal(store.schema.relationships.at(-1)?.predicates[0].rightFieldId, table.fields[0].id);
  assert.ok(reviewGraph(store).summary[0].includes('joined by 1 relationship'));
})));
