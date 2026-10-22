import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

test('Save a Copy as retains one warning per script run, naming the first file written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-save-copy-warning-'));
  createStore(join(dir, 'Data.sqlite'));
  const store = new Store(join(dir, 'Data.sqlite'), 'Data');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
      { op: 'createScript', name: 'Backup', text: 'Save a Copy as [ "first.fmp12" ]\nSave a Copy as [ "second.fmp12" ]' },
    ]);
    const result = await runScript(store, 'Backup', { layout: 'Items', documents: dir });
    assert.deepEqual(result.warnings, [
      'Save a Copy as wrote first.openhbam.sqlite, a Tabularius store, not a .fmp12; FileMaker cannot open it.',
    ]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
