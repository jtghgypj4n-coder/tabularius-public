import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('a field indexed in Japanese sorts in Japanese order, others in English order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ja-'));
  try {
    const path = join(dir, 'Ja.sqlite');
    createStore(path);
    const store = new Store(path, 'Ja');
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text', options: { indexLanguage: 'Japanese' } }, { name: 'Plain', type: 'text' }] },
    ]);
    for (const n of ['処方', 'カキ', '自費', 'あいう']) store.create('Items', { Name: n, Plain: n });
    const sorted = (fieldName: string) => store.find('Items', { sort: [{ fieldName }], limit: 10 }).records.map((r) => String(r.fieldData[fieldName]));
    assert.deepEqual(sorted('Name'), ['あいう', 'カキ', '自費', '処方']);
    assert.deepEqual(sorted('Plain'), ['あいう', 'カキ', '処方', '自費']);
    store.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
