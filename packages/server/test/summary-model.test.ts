import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type Privileges } from '@tabularius/store';
import { WebClient } from '../src/webclient.ts';
import { recordJson } from '../src/dataapi.ts';

test('web report groups and Data API record JSON agree with the found-set model', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-report-surfaces-'));
  const path = join(dir, 'Report.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Report');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'R', fields: [{ name: 'Group' }, { name: 'Amount', type: 'number' }] },
    { op: 'createField', table: 'R', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
    { op: 'createField', table: 'R', name: 'Share', kind: 'summary', summary: { type: 'fractionOfTotal', field: 'Amount' } },
  ]);
  const rows = [
    { group: 'B', amount: 7 }, { group: 'A', amount: 2 }, { group: 'A', amount: 3 },
  ].map((r) => ({ ...r, id: Number(store.create('R', { Group: r.group, Amount: r.amount }).recordId) }));
  store.setPassword('Admin', 'pw');
  const privileges = store.privileges('Admin');
  const ids = store.sortIds('R', rows.map((r) => r.id), [{ fieldName: 'Group', sortOrder: 'ascend' }]);
  const client = Object.create(WebClient.prototype) as { groups(store: Store, layout: string, body: Record<string, unknown>, privileges: Privileges): { groups: { start: number; count: number; values: Record<string, string | number> }[][] } };
  const groups = client.groups(store, 'R', { ids, sort: [{ fieldName: 'Group', sortOrder: 'ascend' }], fields: ['Group'] }, privileges).groups[0];
  assert.deepEqual(groups.map((g) => [g.start, g.count, g.values.Total]), [[0, 2, 5], [2, 1, 7]]);
  const data = store.getMany('R', ids, ids, { privileges }).map(recordJson);
  assert.deepEqual(data.map((r) => r.fieldData.Total), [12, 12, 12]);
  for (const record of data) {
    const source = rows.find((r) => r.id === Number(record.recordId))!;
    assert.equal(record.fieldData.Share, source.amount / 12);
  }
  const kept = ids.filter((id) => id !== rows[1].id);
  const narrowed = store.getMany('R', kept, kept, { privileges }).map(recordJson);
  assert.deepEqual(narrowed.map((r) => r.fieldData.Total), [10, 10]);
  assert.deepEqual(narrowed.map((r) => r.fieldData.Share), [0.3, 0.7]);
});
