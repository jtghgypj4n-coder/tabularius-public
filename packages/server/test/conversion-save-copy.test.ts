import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { conversionReport } from '../src/conversion.ts';
import { conversionGuide } from '../src/conversion-guide.ts';

function withStore(run: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-conversion-copy-'));
  createStore(join(dir, 'Data.sqlite'));
  const store = new Store(join(dir, 'Data.sqlite'), 'Data');
  try { run(store); } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('conversion report and guide count Save a Copy as steps and list the first five places', () => {
  withStore((store) => {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
      { op: 'createScript', name: 'Backups', text: Array.from({ length: 6 }, (_, i) => `Save a Copy as [ "Backup_${i}.fmp12" ]`).join('\n') },
    ]);
    const report = conversionReport(store);
    assert.deepEqual(report.steps.saveCopyAs.map((item) => [item.name, item.count]), [['Save a Copy as', 6]]);
    assert.deepEqual(report.steps.saveCopyAs[0].where, [1, 2, 3, 4, 5].map((line) => `Script "Backups", line ${line}`));
    const item = conversionGuide(store).differs.find((entry) => entry.title === 'Save a Copy as makes Tabularius stores');
    assert.ok(item);
    assert.equal(item.severity, 'medium');
    assert.equal(item.count, 6);
    assert.deepEqual(item.where, report.steps.saveCopyAs[0].where);
    assert.match(item.what, /scripts that save \.fmp12 backups.*Tabularius store instead/i);
    assert.match(item.instead!, /tabularius backup/);
    assert.match(conversionGuide(store).text, /Save a Copy as makes Tabularius stores/);
  });
});

test('a file without Save a Copy as has no conversion guide item', () => {
  withStore((store) => {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
      { op: 'createScript', name: 'No backup', text: 'Set Variable [ $x ; Value: "ok" ]' },
    ]);
    assert.deepEqual(conversionReport(store).steps.saveCopyAs, []);
    assert.ok(!conversionGuide(store).differs.some((entry) => entry.title === 'Save a Copy as makes Tabularius stores'));
  });
});
