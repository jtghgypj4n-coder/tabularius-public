import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { checkSolution } from '../src/check-solution.ts';
import { reviewGraph } from '../src/graph-review.ts';
import { compareSolutions } from '../src/compare.ts';
import { computeWidget, type Widget } from '../src/dashboards.ts';
import { unusedObjects } from '../src/handover.ts';
import { unusedFindings } from '../src/optimization.ts';

function withStores(fn: (a: Store, b: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-solution-tools-'));
  const stores = ['A', 'B'].map((name) => {
    const path = join(dir, `${name}.openhbam.sqlite`);
    createStore(path, { mode: 'native' });
    return new Store(path, name);
  });
  try { fn(stores[0], stores[1]); }
  finally {
    stores.forEach((store) => store.close());
    rmSync(dir, { recursive: true, force: true });
  }
}

test('AR-server-solution-tools-07 case A', () => withStores((store) => {
  store.applyDesign([
    { op: 'createCustomFunction', name: 'Answer', parameters: [], formula: '42' },
    { op: 'createTable', name: 'Items', fields: [{ name: 'Result', kind: 'calculation', calculation: 'Answer' }] },
  ]);
  const { recordId } = store.create('Items', {});
  assert.equal(store.evaluate('Items', 'Answer', recordId).value, '42');
  assert.ok(!checkSolution(store).findings.some((f) => f.kind === 'unused-custom-function' && f.where.includes('Answer')));
}));

test('AR-server-solution-tools-07 case B', () => withStores((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Sales', fields: [{ name: 'Key' }] },
    { op: 'createTable', name: 'Catalog', fields: [{ name: 'Key' }, { name: 'Value' }] },
    { op: 'createOccurrence', name: 'LookupOnly', table: 'Catalog' },
    { op: 'createRelationship', left: 'Sales', right: 'LookupOnly', predicates: [{ left: 'Key', right: 'Key' }] },
    { op: 'createField', table: 'Sales', name: 'Copied', options: { autoEnter: { lookup: { occurrence: 'LookupOnly', field: 'Value' } as never } } },
  ]);
  assert.ok(!reviewGraph(store).issues.some((i) => i.rule === 'unused' && i.message.includes('LookupOnly')));
}));

test('AR-server-solution-tools-07 case C', () => withStores((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Result' }] },
    { op: 'createCustomFunction', name: 'Answer', parameters: [], formula: '42' },
  ]);
  store.schema.tables[0].fields[0].calculation = 'Answer + (';
  const findings = checkSolution(store).findings;
  assert.ok(findings.some((f) => f.kind === 'reference-coverage' && f.message.includes('Cannot verify')));
  assert.ok(!findings.some((f) => f.kind === 'unused-custom-function'));
  const graph = reviewGraph(store);
  assert.ok(graph.issues.some((i) => i.rule === 'unverified'));
  assert.ok(!graph.issues.some((i) => i.rule === 'unused'));
  assert.deepEqual(unusedObjects(store).functions, []);
  const optimization = unusedFindings(store, []);
  assert.ok(optimization.some((f) => f.id === 'unverified-references'));
}));

test('AR-server-solution-tools-07 case D', () => withStores((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Result', kind: 'calculation', calculation: 'Let ( [ Answer = 1 ] ; Answer )' }] },
    { op: 'createCustomFunction', name: 'Answer', parameters: [], formula: '42' },
  ]);
  assert.ok(checkSolution(store).findings.some((f) => f.kind === 'unused-custom-function' && f.where.includes('Answer')));
}));

test('AR-server-solution-tools-08 case A', () => withStores((a, b) => {
  for (const store of [a, b]) store.applyDesign([
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Key' }] },
    { op: 'createTable', name: 'Children', fields: [{ name: 'Key' }] },
    { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Key', right: 'Key' }] },
    { op: 'createCustomFunction', name: 'Message', parameters: [], formula: '"a  b"' },
  ]);
  b.schema.relationships[0].rightDelete = true;
  b.schema.customFunctions[0].formula = '"a b"';
  const result = compareSolutions(a, b);
  assert.ok(result.relationships.changed.some((change) => change.details?.some((detail) => detail.includes('delete'))), JSON.stringify(result.relationships));
  assert.ok(result.customFunctions.changed.some((change) => change.name === 'Message'), JSON.stringify(result.customFunctions));
  assert.doesNotMatch(result.summary, /^No differences/);
}));

test('AR-server-solution-tools-08 case B', () => withStores((a, b) => {
  for (const store of [a, b]) store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Category' }, { name: 'Amount', type: 'number' }] },
    { op: 'createValueList', name: 'Categories', values: ['A', 'B'] },
  ]);
  for (const store of [a, b]) store.savePrivilegeSet({
    name: 'Reader', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
  });
  b.savePrivilegeSet({
    name: 'Reader', records: { view: true, edit: true, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
  });
  b.schema.valueLists.find((v) => v.name === 'Categories')!.values!.reverse();
  const result = compareSolutions(a, b);
  assert.ok(result.privilegeSets!.changed.some((change) => change.name === 'Reader'));
  assert.ok(result.valueLists.changed.some((change) => change.name === 'Categories'));
}));

test('AR-server-solution-tools-09 case A', () => withStores((store) => {
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Category' }, { name: 'Series' }, { name: 'Amount', type: 'number' }] }]);
  const long = 'x'.repeat(80);
  for (const [category, series, amount] of [[`${long}A`, `${long}A`, 10], [`${long}B`, `${long}B`, 20], ['', '', 30], ['(empty)', '(empty)', 40], ['(empty) (1)', '(empty) (1)', 50]] as const) {
    store.create('Items', { Category: category, Series: series, Amount: amount });
  }
  const widget: Widget = { title: 'Totals', kind: 'chart', chart: 'bar', layout: 'Items', groupBy: ['Category'], measure: { field: 'Amount', fn: 'sum' } };
  const one = computeWidget(store, widget);
  assert.equal(one.error, undefined);
  assert.equal(new Set(one.categories).size, 5);
  assert.deepEqual([...one.series![0].values].sort((x, y) => x! - y!), [10, 20, 30, 40, 50]);
  const two = computeWidget(store, { ...widget, groupBy: ['Category', 'Series'] });
  assert.equal(two.error, undefined);
  assert.equal(new Set(two.categories).size, 5);
  assert.equal(new Set(two.series!.map((s) => s.name)).size, 5);
  assert.deepEqual(two.series!.flatMap((s) => s.values).filter((v) => v !== null).sort((x, y) => x! - y!), [10, 20, 30, 40, 50]);
}));
