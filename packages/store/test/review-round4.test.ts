// Independent inputs for the post-round-3 merge review. Generated stores only.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

function setup(t: TestContext): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-review-round4-'));
  const path = join(dir, 'Generated.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Generated');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Rows', fields: [{ name: 'Amount', type: 'number' }, { name: 'Other', type: 'number' }, { name: 'Group' }] },
    { op: 'createField', table: 'Rows', name: 'Share', kind: 'summary', summary: { type: 'fractionOfTotal', field: 'Amount' } },
    { op: 'createField', table: 'Rows', name: 'fraction:Share', kind: 'summary', summary: { type: 'total', field: 'Other' } },
    { op: 'createField', table: 'Rows', name: 'fraction:fraction:Share', kind: 'summary', summary: { type: 'fractionOfTotal', field: 'Other' } },
  ]);
  return store;
}

// Claris Options for Summary Field: "ratio of the value ... to the total";
// https://help.claris.com/en/pro-help/content/options-summary-field.html
// Punctuation in names is a local accepted-input contract, not asserted Claris parity.
for (const read of ['find', 'findAll', 'getMany'] as const) {
  test(`${read}: fraction metadata cannot overwrite a named summary field`, (t) => {
    const store = setup(t);
    const ids = [
      store.create('Rows', { Amount: 4, Other: 21, Group: 'chosen' }),
      store.create('Rows', { Amount: 12, Other: 7, Group: 'chosen' }),
      store.create('Rows', { Amount: 100, Other: 300, Group: 'outside' }),
    ].map((r) => Number(r.recordId));
    const check = (chosen: number[], amounts: number[], others: number[]) => {
      const records = read === 'getMany'
        ? store.getMany('Rows', chosen, chosen)
        : store.find('Rows', { ...(read === 'find' ? { query: [{ Group: '==chosen' }] } : {}), limit: 10 }).records;
      const total = amounts.reduce((a, b) => a + b, 0);
      const otherTotal = others.reduce((a, b) => a + b, 0);
      assert.deepEqual(records.map((r) => r.fieldData['fraction:Share']), chosen.map(() => otherTotal));
      assert.deepEqual(records.map((r) => r.fieldData.Share), amounts.map((n) => n / total));
      assert.deepEqual(records.map((r) => r.fieldData['fraction:fraction:Share']), others.map((n) => n / otherTotal));
    };
    const chosen = read === 'findAll' ? ids : ids.slice(0, 2);
    const amounts = read === 'findAll' ? [4, 12, 100] : [4, 12];
    const others = read === 'findAll' ? [21, 7, 300] : [21, 7];
    check(chosen, amounts, others);
    check(chosen, amounts, others); // cached result
    store.update('Rows', ids[1], { Amount: 28, Other: 35 });
    amounts[1] = 28;
    others[1] = 35;
    check(chosen, amounts, others);
  });
}

test('fraction metadata remains distinct during projected pending-row reads', (t) => {
  const store = setup(t);
  const ids = [store.create('Rows', { Amount: 4, Other: 21 }), store.create('Rows', { Amount: 12, Other: 7 })].map((r) => Number(r.recordId));
  const pending = new Map([[ids[1], { ...store.sql.prepare('SELECT * FROM Rows WHERE _fm_record_id = ?').get(ids[1])!, Amount: 28, Other: 35 }]]);
  const records = store.getMany('Rows', ids, ids, { rows: pending, fresh: true, fields: ['Share', 'fraction:Share', 'fraction:fraction:Share'] });
  assert.deepEqual(records.map((r) => r.fieldData), [
    { Share: 4 / 32, 'fraction:Share': 56, 'fraction:fraction:Share': 21 / 56 },
    { Share: 28 / 32, 'fraction:Share': 56, 'fraction:fraction:Share': 35 / 56 },
  ]);
  assert.deepEqual(store.getMany('Rows', ids, ids).map((r) => r.fieldData['fraction:Share']), [28, 28], 'pending previews do not pollute the committed cache');
});

test('paged summaries and calculations share the entire ordered found set', (t) => {
  const store = setup(t);
  store.applyDesign([
    { op: 'createField', table: 'Rows', name: 'Labels', kind: 'summary', summary: { type: 'list', field: 'Group' } },
    { op: 'createField', table: 'Rows', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
    { op: 'createField', table: 'Rows', name: 'Computed', kind: 'calculation', type: 'number', calculation: 'Total + 1', options: { unstored: true } },
  ]);
  const ids = [
    store.create('Rows', { Group: 'C', Amount: 9 }),
    store.create('Rows', { Group: 'A', Amount: 2 }),
    store.create('Rows', { Group: 'B', Amount: 5 }),
  ].map((r) => Number(r.recordId));
  const found = [ids[1], ids[0]];
  const page = store.getMany('Rows', [ids[0]], found)[0].fieldData;
  assert.equal(page.Computed, 12);
  assert.equal(page.Labels, 'A\nC'); // List order is local policy; publicly unverified.
  for (const sortOrder of ['ascend', 'descend'] as const) {
    const page = store.find('Rows', { sort: [{ fieldName: 'Group', sortOrder }], offset: 1, limit: 1 }).records[0].fieldData;
    assert.equal(page.Computed, 17, 'the page does not become the found set');
    assert.equal(page.Labels, sortOrder === 'ascend' ? 'A\nB\nC' : 'C\nB\nA');
  }
});

test('calculated breaks are recomputed across nested Unicode groups and an edit', (t) => {
  const store = setup(t);
  store.applyDesign([
    { op: 'createField', table: 'Rows', name: 'Break', kind: 'calculation', type: 'text', calculation: 'Group', options: { unstored: true } },
    { op: 'createField', table: 'Rows', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
  ]);
  const ids = [
    store.create('Rows', { Group: '\u00c5', Amount: 4, Other: 1 }),
    store.create('Rows', { Group: 'A\u030a', Amount: 6, Other: 2 }),
    store.create('Rows', { Group: 'Z', Amount: 8, Other: 2 }),
  ].map((r) => Number(r.recordId));
  // Canonical-equivalence grouping is existing project policy, not a claimed Claris rule.
  const groups = () => store.groupSummaries('Rows', ids, ['Break', 'Other']).map((runs) => runs.map((r) => [r.count, r.values.Total]));
  assert.deepEqual(groups(), [[[2, 10], [1, 8]], [[1, 4], [1, 6], [1, 8]]]);
  store.update('Rows', ids[1], { Group: 'Z', Amount: 10 });
  assert.deepEqual(groups(), [[[1, 4], [2, 18]], [[1, 4], [2, 18]]]);
});
