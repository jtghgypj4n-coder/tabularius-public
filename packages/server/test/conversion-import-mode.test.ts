import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeStepParams, type ScriptStep } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { conversionGuide } from '../src/conversion-guide.ts';
import { conversionReport } from '../src/conversion.ts';

const binaryImport = () => decodeStepParams(35, new Uint8Array(28), undefined, {
  formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined,
  tableOccurrenceName: () => undefined, fieldName: () => undefined, dataSourceName: () => undefined,
})!;

function withImports(check: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-mode-report-'));
  const path = join(dir, 'Converted.sqlite');
  createStore(path);
  const store = new Store(path, 'Converted');
  try {
    const step = (params = binaryImport()): ScriptStep => ({ stepId: 35, name: 'Import Records', enabled: true, params });
    store.schema.scripts.push(
      { id: 1, name: 'First', steps: [step(), step({ ...binaryImport(), importAction: 'add' }), step()] },
      { id: 2, name: 'Second', steps: [step()] },
    );
    check(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
}

test('conversion guide counts undecoded Import Records modes and shows script locations', () => {
  withImports((store) => {
    const item = conversionGuide(store).breaks.find((i) => i.title === 'Import Records steps need their mode set');
    assert.ok(item);
    assert.equal(item.severity, 'high');
    assert.equal(item.count, 3);
    assert.deepEqual(item.where, ['Script "First", line 1', 'Script "First", line 3', 'Script "Second", line 1']);
    assert.match(item.what, /error 3.*import nothing.*Add, Update matching or Replace/);
    assert.match(item.instead ?? '', /design mode.*script-text form/);
  });
});

test('conversion report lists undecoded Import Records modes among problems', () => {
  withImports((store) => {
    const report = conversionReport(store);
    assert.deepEqual(report.steps.importMode, [{
      name: 'Import Records', count: 3,
      where: ['Script "First", line 1', 'Script "First", line 3', 'Script "Second", line 1'],
    }]);
    assert.match(report.summary, /Import Records steps need their mode set\*\*: 3 steps.*error 3.*import nothing/);
  });
});
