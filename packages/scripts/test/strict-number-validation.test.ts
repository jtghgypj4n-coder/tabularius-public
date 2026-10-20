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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-strict-number-'));
  createStore(join(dir, 'test.sqlite'));
  store = new Store(join(dir, 'test.sqlite'), 'Test');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
    { name: 'Qty', type: 'number', options: { validation: { type: 'number' } } },
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

const commit = async (value: string) => {
  const result = await runScript(store, script(`
    New Record/Request
    Set Field [ Items::Qty ; "${value}" ]
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Result: Get ( LastError ) ]
  `), { layout: 'Items', foundSet: store.findIds('Items') });
  return String(result.result);
};

test('a field that must be a number refuses text with letters after the digits', async () => {
  assert.equal(await commit('12x'), '502');
  assert.equal(await commit('x12'), '502');
  assert.equal(await commit('1.2.3'), '502');
  assert.equal(await commit('-'), '502');
});

test('and takes the ways a number is written', async () => {
  for (const ok of ['12', '-12', '+1.5', '.5', '1,234.50', '1e5', ' 7 ']) assert.equal(await commit(ok), '0', ok);
});
