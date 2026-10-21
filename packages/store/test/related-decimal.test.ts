import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, relatedIdList, relatedRows, Store } from '../src/index.ts';
import { firstRelatedEach } from '../src/related.ts';

test('AR-store-core-07: related helpers and calculations agree on decimal ranges', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-decimal-'));
  const path = join(dir, 'native.sqlite');
  try {
    createStore(path, { mode: 'native' });
    const store = new Store(path, 'native');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'P', fields: [{ name: 'Limit', type: 'decimal' }, { name: 'Equal', type: 'decimal' }] },
        { op: 'createTable', name: 'C', fields: [{ name: 'Amount', type: 'decimal' }] },
        { op: 'createRelationship', left: 'P', right: 'C', predicates: [{ left: 'Limit', operator: '<', right: 'Amount' }] },
        { op: 'createOccurrence', name: 'CEq', table: 'C' },
        { op: 'createRelationship', left: 'P', right: 'CEq', predicates: [{ left: 'Equal', right: 'Amount' }] },
      ]);
      const parentId = store.create('P', { Limit: '9', Equal: '10.0' }).recordId;
      const childId = store.create('C', { Amount: '10' }).recordId;
      const from = store.schema.tableOccurrences.find((o) => o.name === 'P')!.id;
      const to = store.schema.tableOccurrences.find((o) => o.name === 'C')!.id;
      const parent = store.sql.prepare('SELECT * FROM P WHERE _fm_record_id = ?').get(parentId) as Record<string, string | number | null>;
      const result = relatedRows(store, from, parent, to);
      assert.equal(result?.count, 1);
      assert.deepEqual(result?.rows.map((r) => Number(r._fm_record_id)), [childId]);
      assert.deepEqual(relatedIdList(store, from, parent, to)?.ids, [childId]);
      assert.equal(store.evaluate('P', 'Count ( C::Amount )', parentId).value, '1');
      const equalTo = store.schema.tableOccurrences.find((o) => o.name === 'CEq')!.id;
      assert.deepEqual(relatedIdList(store, from, parent, equalTo)?.ids, [childId]);
      assert.equal(store.evaluate('P', 'Count ( CEq::Amount )', parentId).value, '1');
      const secondId = store.create('P', { Limit: '20', Equal: '11' }).recordId;
      const second = store.sql.prepare('SELECT * FROM P WHERE _fm_record_id = ?').get(secondId) as Record<string, string | number | null>;
      assert.deepEqual(firstRelatedEach(store, from, [parent, second], equalTo)?.firsts.map((r) => r?._fm_record_id), [childId, undefined]);
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
