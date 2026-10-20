import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

// Claris: https://help.claris.com/en/pro-help/content/options-summary-field.html
// Aggregate functions: https://help.claris.com/en/pro-help/content/aggregate-functions.html
test('generated records: summary types follow the found set and fractions use each record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-summary-'));
  const path = join(dir, 'Summary.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Summary');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Sales', fields: [{ name: 'Region', type: 'text' }, { name: 'City', type: 'text' }, { name: 'Amount', type: 'number' }] },
      { op: 'createOccurrence', name: 'AllSales', table: 'Sales' },
      { op: 'createRelationship', left: 'Sales', right: 'AllSales', predicates: [{ left: 'Amount', operator: '×', right: 'Amount' }] },
      ...([['Total', 'total'], ['Average', 'average'], ['Count', 'count'], ['Minimum', 'minimum'], ['Maximum', 'maximum'], ['StdDev', 'stdDev'], ['StdDevP', 'stdDevP'], ['Fraction', 'fractionOfTotal']] as const)
        .map(([name, type]) => ({ op: 'createField', table: 'Sales', name, kind: 'summary', summary: { type, field: 'Amount' } })),
      { op: 'createField', table: 'Sales', name: 'GroupTotal', type: 'number', kind: 'calculation', calculation: 'GetSummary ( Total ; Region )', options: { unstored: true } },
      { op: 'createField', table: 'Sales', name: 'GrandTotal', type: 'number', kind: 'calculation', calculation: 'GetSummary ( Total ; Total )', options: { unstored: true } },
    ] as never);
    const ids = [
      { Region: 'A', City: 'X', Amount: '2' },
      { Region: 'B', City: 'Y', Amount: '6' },
      { Region: 'A', City: 'X', Amount: '4' },
      { Region: 'B', City: 'Y', Amount: '' },
      { Region: 'B', City: 'Z', Amount: '8' },
    ].map((row) => store.create('Sales', row).recordId);
    const all = store.getMany('Sales', ids, ids).map((r) => r.fieldData);
    for (const row of all) {
      assert.equal(row.Total, 20);
      assert.equal(row.Average, 5);
      assert.equal(row.Count, 4, 'blank values are excluded');
      assert.equal(row.Minimum, 2);
      assert.equal(row.Maximum, 8);
      assert.ok(Math.abs(Number(row.StdDev) - Math.sqrt(20 / 3)) < 1e-9);
      assert.ok(Math.abs(Number(row.StdDevP) - Math.sqrt(5)) < 1e-9);
    }
    assert.deepEqual(all.map((r) => r.Fraction), [0.1, 0.3, 0.2, '', 0.4]);
    const a = store.find('Sales', { query: [{ Region: '==A' }], sort: [{ fieldName: 'Amount', sortOrder: 'ascend' }] }).records.map((r) => r.fieldData);
    assert.deepEqual(a.map((r) => [r.Total, r.Average, r.Count, r.Minimum, r.Maximum, r.Fraction]), [[6, 3, 2, 2, 4, 1 / 3], [6, 3, 2, 2, 4, 2 / 3]]);
    assert.deepEqual(a.map((r) => [r.GroupTotal, r.GrandTotal]), [['', 6], ['', 6]], 'the break field is absent from this sort');
    const byRegion = store.find('Sales', { sort: [{ fieldName: 'Region', sortOrder: 'ascend' }], limit: 10 }).records.map((r) => r.fieldData);
    assert.deepEqual(byRegion.map((r) => [r.GroupTotal, r.GrandTotal]), [[6, 20], [6, 20], [14, 20], [14, 20], [14, 20]]);
    // Aggregate functions read their related field argument, not the window's found set.
    const formulas = ['Sum', 'Count', 'Average', 'Min', 'Max'].map((fn) => `${fn} ( AllSales::Amount )`);
    const related = store.evaluateRows('Sales', formulas, { ids: [ids[0], ids[2]] });
    assert.deepEqual(related.map((values) => values.map((v) => Number(v?.value))), [[20, 4, 5, 2, 8], [20, 4, 5, 2, 8]]);
    const sorted = store.findIds('Sales', { sort: [{ fieldName: 'Region', sortOrder: 'ascend' }, { fieldName: 'City', sortOrder: 'ascend' }] });
    const fromWindow = store.getMany('Sales', [ids[1], ids[4]], sorted, { sort: [{ fieldName: 'Region', sortOrder: 'ascend' }, { fieldName: 'City', sortOrder: 'ascend' }] });
    assert.deepEqual(fromWindow.map((r) => [r.fieldData.GroupTotal, r.fieldData.GrandTotal]), [[14, 20], [14, 20]]);
    const [regions, cities] = store.groupSummaries('Sales', sorted, ['Region', 'City']);
    assert.deepEqual(regions.map((r) => [r.start, r.count, r.values.Total, r.values.Count, r.values.Fraction]), [[0, 2, 6, 2, 0.3], [2, 3, 14, 2, 0.7]]);
    assert.deepEqual(cities.map((r) => [r.start, r.count, r.values.Total]), [[0, 2, 6], [2, 2, 6], [4, 1, 8]]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generated records: running totals and counts restart at a sorted group', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-running-'));
  const path = join(dir, 'Running.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Running');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Sales', fields: [{ name: 'Region', type: 'text' }, { name: 'Amount', type: 'number' }] },
      { op: 'createField', table: 'Sales', name: 'RunTotal', kind: 'summary', summary: { type: 'total', field: 'Amount', running: true, restartField: 'Region' } },
      { op: 'createField', table: 'Sales', name: 'RunCount', kind: 'summary', summary: { type: 'count', field: 'Amount', running: true, restartField: 'Region' } },
    ] as never);
    for (const [Region, Amount] of [['B', '6'], ['A', '2'], ['B', ''], ['A', '4'], ['B', '8']]) store.create('Sales', { Region, Amount });
    const unsorted = store.find('Sales', { limit: 10 }).records.map((r) => [r.fieldData.RunTotal, r.fieldData.RunCount]);
    assert.deepEqual(unsorted, [[6, 1], [8, 2], [8, 2], [12, 3], [20, 4]]);
    const sort = [{ fieldName: 'Region', sortOrder: 'ascend' }];
    const rows = store.find('Sales', { sort, limit: 10 }).records.map((r) => r.fieldData);
    assert.deepEqual(rows.map((r) => [r.Region, r.RunTotal, r.RunCount]), [
      ['A', 2, 1], ['A', 6, 2], ['B', 6, 1], ['B', 6, 1], ['B', 14, 2],
    ]);
    const page = store.find('Sales', { sort, offset: 4, limit: 2 }).records.map((r) => [r.fieldData.RunTotal, r.fieldData.RunCount]);
    assert.deepEqual(page, [[6, 1], [14, 2]], 'a later page retains the preceding records in its running total');
    const ids = store.findIds('Sales', { sort });
    const [groups] = store.groupSummaries('Sales', ids, ['Region']);
    assert.deepEqual(groups.map((g) => [g.values.RunTotal, g.values.RunCount]), [[6, 2], [14, 2]]);
    const reopened = new Store(path, 'Running');
    try {
      assert.deepEqual(reopened.find('Sales', { sort, limit: 10 }).records.map((r) => [r.fieldData.RunTotal, r.fieldData.RunCount]),
        [[2, 1], [6, 2], [6, 1], [6, 1], [14, 2]], 'the running definition survives reopening');
    } finally { reopened.close(); }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
