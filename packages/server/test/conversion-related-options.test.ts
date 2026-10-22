import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeStepParams, type ScriptStep } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { conversionGuide } from '../src/conversion-guide.ts';
import { conversionReport } from '../src/conversion.ts';

const binaryStep = (): ScriptStep => ({
  stepId: 74, name: 'Go to Related Record', enabled: true,
  params: decodeStepParams(74, new Uint8Array(28), undefined, {
    formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined,
    tableOccurrenceName: () => undefined, fieldName: () => undefined, dataSourceName: () => undefined,
  })!,
});

function withScripts(check: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-options-report-'));
  const path = join(dir, 'Converted.sqlite');
  createStore(path);
  const store = new Store(path, 'Converted');
  try {
    const typed: ScriptStep = { stepId: 74, name: 'Go to Related Record', enabled: true, params: { useLayout: false, matchFoundSet: true } };
    store.schema.scripts.push(
      { id: 1, name: 'First', steps: [binaryStep(), typed, binaryStep()] },
      { id: 2, name: 'Second', steps: [binaryStep()] },
    );
    check(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
}

test('a Go to Related Record step read from a file carries the list of options it did not read', () => {
  assert.deepEqual(binaryStep().params?.unreadOptions, ['Match all records in current found set', 'Show only related records']);
});

test('conversion guide counts the Go to Related Record steps whose options were not read, and lists the first places', () => {
  withScripts((store) => {
    const item = conversionGuide(store).differs.find((i) => i.title === 'Go to Related Record options are not read');
    assert.ok(item);
    assert.equal(item.severity, 'high');
    assert.equal(item.count, 3);
    assert.deepEqual(item.where, ['Script "First", line 1', 'Script "First", line 3', 'Script "Second", line 1']);
    assert.match(item.what, /current record alone.*Show only related records.*not supported/);
    assert.match(item.instead ?? '', /script editor/);
  });
});

test('conversion report lists them and the summary mentions them', () => {
  withScripts((store) => {
    const report = conversionReport(store);
    assert.deepEqual(report.steps.relatedOptions, [{
      name: 'Go to Related Record', count: 3,
      where: ['Script "First", line 1', 'Script "First", line 3', 'Script "Second", line 1'],
    }]);
    assert.match(report.summary, /Go to Related Record options are not read\*\*: 3 steps/);
  });
});
