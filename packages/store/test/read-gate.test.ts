// Synthetic read-gate regressions. Policy: see notes/audits/audit-read-gate-inventory.md.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';
import * as trace from '../src/trace.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-read-gate-'));
  const path = join(dir, 'Generated.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Owner' }, { name: 'Secret' }, { name: 'Amount', type: 'number' }] },
    { op: 'createTable', name: 'Hidden', fields: [{ name: 'Value' }] },
    { op: 'createField', table: 'Items', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
    { op: 'createField', table: 'Items', name: 'HiddenTotal', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
    { op: 'createValueList', name: 'Names', field: { occurrence: 'Items', field: 'Name' } },
  ]);
  const design = store.design('Items')!;
  const to = store.schema.tableOccurrences.find((x) => x.name === 'Items')!;
  const field = store.schema.tables.find((x) => x.name === 'Items')!.fields.find((x) => x.name === 'Name')!;
  const anchors = { left: true, top: true, right: false, bottom: false };
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: [...design.objects, {
    id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 20, left: 20, bottom: 300, right: 210 },
    portal: { tableOccurrenceId: to.id, tableOccurrence: 'Items', rows: 5, initialRow: 1 }, children: [{
      id: 901, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 22, left: 22, bottom: 40, right: 200 },
      field: { tableOccurrenceId: to.id, fieldId: field.id, tableOccurrence: 'Items', field: 'Name', display: 'edit', repetitions: 1 },
    }],
  }] } }]);
  const hidden = store.create('Items', { Name: 'HIDDEN_ROW', Owner: 'other', Secret: 'a', Amount: 900 }).recordId;
  const own = store.create('Items', { Name: 'visible', Owner: 'reader', Secret: 'z', Amount: 7 }).recordId;
  store.create('Hidden', { Value: 'HIDDEN_TABLE' });
  store.savePrivilegeSet({ name: 'Restricted', records: { view: false, edit: false, create: false, delete: false },
    tables: { Items: { view: 'Owner = Get ( AccountName )', edit: false, create: false, delete: false, fields: { Secret: 'none', HiddenTotal: 'none' } } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] });
  store.setPassword('reader', 'synthetic-password', 'Restricted');
  return { store, own, hidden, p: store.privileges('reader') };
}
const denied = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof StoreError && [102, 105, 200].includes(e.code));

test('sortIds gates hidden sort fields and stale or supplied record ids', (t) => {
  const { store, own, hidden, p } = setup(t);
  assert.deepEqual(store.sortIds('Items', [hidden, own], [{ fieldName: 'Name' }], { privileges: p }), [own]);
  denied(() => store.sortIds('Items', [own], [{ fieldName: 'Secret' }], { privileges: p }));
  denied(() => store.sortIds('Hidden', [1], [{ fieldName: 'Value' }], { privileges: p }));
});

test('groupSummaries gates grouping keys, records and summary fields', (t) => {
  const { store, own, hidden, p } = setup(t);
  assert.deepEqual(store.groupSummaries('Items', [hidden, own], ['Name'], 'us', p), [[{ start: 0, count: 1, values: { Total: 7 } }]]);
  denied(() => store.groupSummaries('Items', [own], ['Secret'], 'us', p));
  denied(() => store.groupSummaries('Hidden', [1], ['Value'], 'us', p));
});

test('GetSummary conceals hidden break fields and hidden summary fields', (t) => {
  const { store, own, p } = setup(t);
  store.applyDesign([
    { op: 'createField', table: 'Items', name: 'BySecret', type: 'number', kind: 'calculation',
      calculation: 'GetSummary ( Total ; Secret )', options: { unstored: true } },
    { op: 'createField', table: 'Items', name: 'HiddenGrandTotal', type: 'number', kind: 'calculation',
      calculation: 'GetSummary ( HiddenTotal ; HiddenTotal )', options: { unstored: true } },
  ]);
  const second = store.create('Items', { Name: 'second', Owner: 'reader', Secret: 'a', Amount: 5 }).recordId;
  const ids = [own, second];
  const sort = [{ fieldName: 'Secret' }];
  const unrestricted = store.getMany('Items', ids, ids, { sort });
  assert.deepEqual(unrestricted.map((r) => r.fieldData.BySecret), [7, 5]);
  assert.deepEqual(unrestricted.map((r) => r.fieldData.HiddenGrandTotal), [12, 12]);
  const restricted = store.getMany('Items', ids, ids, { sort, privileges: p });
  assert.deepEqual(restricted.map((r) => r.fieldData.BySecret), ['', '']);
  assert.deepEqual(restricted.map((r) => r.fieldData.HiddenGrandTotal), ['', '']);
});

test('running summaries conceal hidden restart keys in supplied sort state', (t) => {
  const { store, own, p } = setup(t);
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Running', kind: 'summary',
    summary: { type: 'total', field: 'Amount', running: true, restartField: 'Secret' } }]);
  const second = store.create('Items', { Name: 'second', Owner: 'reader', Secret: 'a', Amount: 5 }).recordId;
  const ids = [own, second];
  const sort = [{ fieldName: 'Secret' }];
  assert.deepEqual(store.getMany('Items', ids, ids, { sort }).map((r) => r.fieldData.Running), [7, 5]);
  assert.deepEqual(store.getMany('Items', ids, ids, { sort, privileges: p }).map((r) => r.fieldData.Running), ['', '']);
  assert.deepEqual(store.getMany('Items', ids, ids, { privileges: p }).map((r) => r.fieldData.Running), [7, 12]);
});

test('foundSetRows gates supplied ids before count and pagination', (t) => {
  const { store, own, hidden, p } = setup(t);
  const first = store.foundSetRows('Items', 'Items', [hidden, own], { offset: 1, limit: 1 }, { privileges: p });
  assert.equal(first.count, 1);
  assert.deepEqual(first.rows.map((x) => x['Items::Name']), ['visible']);
  assert.equal(store.foundSetRows('Items', 'Items', [hidden, own], { offset: 2, limit: 1 }, { privileges: p }).rows.length, 0);
  assert.deepEqual(store.foundSetRows('Items', 'Items', [hidden], {}, { privileges: p }), { rows: [], count: 0 });
});

test('portalCounts refuses a hidden parent, including cached counts', (t) => {
  const { store, own, hidden, p } = setup(t);
  denied(() => store.portalCounts('Items', hidden, p));
  const read = store.get('Items', own, 'us', undefined, p);
  assert.deepEqual(store.portalCounts('Items', own, p, read), { Items: 1 });
  store.update('Items', own, { Owner: 'other' });
  denied(() => store.portalCounts('Items', own, p, read));
});

test('portalCounts reuses account-free snapshots without SQL and rechecks account-bearing reads', (t) => {
  const previous = process.env.TABULARIUS_TRACE_SQL;
  process.env.TABULARIUS_TRACE_SQL = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.TABULARIUS_TRACE_SQL;
    else process.env.TABULARIUS_TRACE_SQL = previous;
  });
  t.mock.method(process.stderr, 'write', () => true);
  const { store, own, p } = setup(t);
  const layout = store.layout('Items');
  const read = store.get(layout, own);
  for (const input of ['Items', layout]) {
    const before = trace.statements;
    assert.deepEqual(store.portalCounts(input, own, undefined, read), { Items: 1 });
    assert.equal(trace.statements - before, 0, 'cached snapshot requires no metadata or record query');
  }
  // Supplying an unrestricted snapshot must not skip the caller's current gate.
  assert.deepEqual(store.portalCounts(layout, own, p, read), { Items: 1 });
  store.update('Items', own, { Owner: 'other' });
  denied(() => store.portalCounts('Items', own, p, read));
  store.savePrivilegeSet({ name: 'NoLayout', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] });
  store.setPassword('no-layout', 'synthetic-password', 'NoLayout');
  const noLayout = store.privileges('no-layout');
  assert.equal(noLayout.readsEverything, true);
  denied(() => store.portalCounts('Items', own, noLayout, read));
});

test('group summaries and sorting by id are refused through a layout the account may not use', (t) => {
  const { store, own } = setup(t);
  store.savePrivilegeSet({ name: 'NoLayout', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] });
  store.setPassword('no-layout', 'synthetic-password', 'NoLayout');
  const noLayout = store.privileges('no-layout');
  assert.equal(noLayout.readsEverything, true);
  denied(() => store.groupSummaries('Items', [own], ['Name'], 'us', noLayout));
  denied(() => store.sortIds('Items', [own], [{ fieldName: 'Name', sortOrder: 'ascend' }], { privileges: noLayout }));
  assert.deepEqual(store.sortIds('Items', [own], [{ fieldName: 'Name', sortOrder: 'ascend' }]), [own]);
});

test('classified account-aware store readers exclude hidden rows, fields, totals and tables', (t) => {
  const { store, own, hidden, p } = setup(t);
  const found = store.find('Items', { privileges: p });
  assert.equal(found.totalCount, 1); assert.equal(found.foundCount, 1);
  assert.deepEqual(found.records.map((r) => r.recordId), [own]);
  assert.equal(found.records[0].fieldData.Total, 7);
  assert.ok(!('Secret' in found.records[0].fieldData));
  assert.deepEqual(store.findIds('Items', { privileges: p }), [own]);
  assert.deepEqual(store.selectIds('Items', { privileges: p }), [own]);
  assert.equal(store.countIds('Items', { privileges: p }), 1);
  assert.deepEqual(store.viewableIds('Items', p), [own]);
  assert.equal(store.canViewRecord('Items', hidden, p), false);
  assert.equal(store.canView('Items', hidden, p), false);
  denied(() => store.get('Items', hidden, 'us', undefined, p));
  assert.deepEqual(store.getMany('Items', [hidden, own], [hidden, own], { privileges: p }).map((r) => r.fieldData.Total), [7]);
  assert.deepEqual(store.fieldIndex('Items', 'Name', { privileges: p }), ['visible']);
  assert.deepEqual(store.fieldIndex('Items', 'Secret', { privileges: p }), []);
  assert.deepEqual(store.valueListItems('Names', undefined, p).map((r) => r.value), ['visible']);
  assert.deepEqual([...store.computeValues('Items', [hidden, own], [{ sql: 'Amount', params: [], fields: ['Amount'] }], p)], [[own, [7]]]);
  assert.equal(store.evaluate('Items', 'Secret', own, { privileges: p }).value, '');
  assert.deepEqual(store.evaluateEach('Items', ['Secret'], own, { privileges: p }).map((v) => v?.value), ['']);
  denied(() => store.find('Hidden', { privileges: p }));
  denied(() => store.countIds('Hidden', { privileges: p }));
  assert.deepEqual(store.viewableIds('Hidden', p), []);
});
