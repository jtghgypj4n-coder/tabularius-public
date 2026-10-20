// The web client's File > Import Records takes a merge file (.mer): its first record holds the field names, so the
// columns are matched to fields by those names and the header isn't imported as a record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { importFileRows } from '../../scripts/src/index.ts';
import { planImport } from '../src/import-mapping.ts';

test('a merge file\'s header row names the columns in the web client\'s import', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-mer-'));
  createStore(join(dir, 'M.sqlite'));
  const store = new Store(join(dir, 'M.sqlite'), 'M');
  try {
    store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'City' }] }] as never);
    const rows = importFileRows('people.mer', new TextEncoder().encode('"City","Name"\r\n"Paris","Ada"\r\n"Oslo","Grace"\r\n'));
    assert.equal(rows.length, 3, 'the header comes with the rows, for matching');
    const plan = await planImport(store, 'People', rows);
    assert.equal(plan.headerRow, true);
    assert.deepEqual(plan.columns.map((c) => c.field), ['City', 'Name']);
    assert.equal(plan.rows, 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
