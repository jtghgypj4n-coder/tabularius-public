import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { conversionReport } from '../src/conversion.ts';

test('conversion report identifies unknown function, Get and step IDs with counts and private structural shapes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unknown-report-'));
  createStore(join(dir, 'test.sqlite'));
  const store = new Store(join(dir, 'test.sqlite'));
  try {
    store.applyDesign([{ op: 'createCustomFunction', name: 'Unknowns', parameters: [], formula: '⟨fn:39⟩ ( "private-value" ; 12345 ) & Get ( ⟨get:73⟩ ) & ⟨FMDR:2⟩ & ⟨fn:39⟩(1)' }]);
    store.schema.scripts.push({ id: 123, name: 'Unknowns', steps: [
      { stepId: 0, name: 'Unknown step 0', enabled: true },
      { stepId: 513, name: 'Unknown step 513', enabled: true },
    ] });
    const report = conversionReport(store);
    const tokens = report.unknownTokens;
    assert.deepEqual(tokens.map((t) => [t.kind, t.id, t.count, t.files]), [
      ['function', '0x39', 2, 1], ['function', 'FMDR:2', 1, 1], ['get', '0x73', 1, 1], ['step', '0', 1, 1], ['step', '513', 1, 1],
    ]);
    assert.ok(tokens.every((t) => t.shapes.length > 0));
    assert.doesNotMatch(JSON.stringify(tokens), /private-value|12345/);
    assert.deepEqual(report.unparsed, []);
    assert.match(report.summary, /0x73/);
    assert.match(report.summary, /Unknown step 513/);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
