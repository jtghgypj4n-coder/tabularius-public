import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-serial-decimals-'));
  createStore(join(dir, 'test.sqlite'));
  store = new Store(join(dir, 'test.sqlite'), 'Test');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
    { name: 'Name', type: 'text' },
    { name: 'Decimal', type: 'number', options: { autoEnter: { serial: { next: '0.5', increment: 0.1 } } } },
    { name: 'Negative', type: 'number', options: { autoEnter: { serial: { next: '-2', increment: 1 } } } },
  ] }] as never);
});

after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function script(text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((line) => line.trim()).join('\n'), store.schema)
    .map((step) => ({ stepId: step.stepId!, name: scriptStepName(step.stepId!), enabled: step.enabled !== false, params: step.params }));
  return { id: 9999, name: 'test', steps } as Script;
}

test('serial numbers with a decimal increment or a negative start count exactly', async () => {
  const values: string[] = [];
  for (let i = 0; i < 4; i++) {
    const result = await runScript(store, script(`
      New Record/Request
      Commit Records/Requests [ With dialog: Off ]
      Exit Script [ Result: Items::Decimal & "/" & Items::Negative ]
    `), { layout: 'Items', foundSet: store.findIds('Items') });
    assert.equal(result.error, 0);
    values.push(String(result.result));
  }
  assert.deepEqual(values, ['0.5/-2', '0.6/-1', '0.7/0', '0.8/1']);
});
