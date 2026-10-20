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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-serial-on-commit-'));
  createStore(join(dir, 'test.sqlite'));
  store = new Store(join(dir, 'test.sqlite'), 'Test');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
    { name: 'Name', type: 'text' },
    { name: 'OnCommit', type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1, onCommit: true } } } },
    { name: 'OnCreate', type: 'number', options: { autoEnter: { serial: { next: '100', increment: 1 } } } },
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

const run = (text: string) => runScript(store, script(text), { layout: 'Items', foundSet: store.findIds('Items') });

test('a serial generated on commit is empty until the new record is committed', async () => {
  const result = await run(`
    New Record/Request
    Set Variable [ $before ; Value: Items::OnCommit & "/" & Items::OnCreate ]
    Set Field [ Items::Name ; "one" ]
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Result: $before & "|" & Items::OnCommit & "/" & Items::OnCreate ]
  `);
  assert.equal(result.error, 0);
  assert.equal(result.result, '/100|1/100');
});

test('a reverted new record does not use up the on-commit serial', async () => {
  const reverted = await run(`
    New Record/Request
    Revert Record/Request [ With dialog: Off ]
  `);
  assert.equal(reverted.error, 0);
  const result = await run(`
    New Record/Request
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Result: Items::OnCommit & "/" & Items::OnCreate ]
  `);
  assert.equal(result.error, 0);
  // The on-creation serial was used by the reverted record; the on-commit one was not.
  assert.equal(result.result, '2/102');
});

test('a value the script set is kept, and records made outside a script get the serial at once', async () => {
  const result = await run(`
    New Record/Request
    Set Field [ Items::OnCommit ; 50 ]
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Result: Items::OnCommit ]
  `);
  assert.equal(result.result, '50');
  const { recordId } = store.create('Items', { Name: 'api' });
  assert.equal(store.get('Items', recordId)?.fieldData.OnCommit, 3);
});

test('deleting the new record before its commit leaves the serial for the next one, not the record shown next', async () => {
  const { recordId } = store.create('Items', { Name: 'blank', OnCommit: '' });
  const result = await run(`
    New Record/Request
    Delete Record/Request [ With dialog: Off ]
    Go to Record/Request/Page [ Last ]
    Set Field [ Items::Name ; "edited" ]
    Commit Records/Requests [ With dialog: Off ]
  `);
  assert.equal(result.error, 0);
  assert.equal(store.get('Items', recordId)?.fieldData.OnCommit, '');
});

test('a first commit that fails validation does not use up the serial', async () => {
  const before = (await run('New Record/Request\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Result: Items::OnCommit ]')).result;
  store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Name', options: { validation: { notEmpty: true } } }] as never);
  try {
    const result = await run(`
      Set Error Capture [ On ]
      New Record/Request
      Commit Records/Requests [ With dialog: Off ]
      Set Variable [ $error ; Value: Get ( LastError ) ]
      Set Field [ Items::Name ; "named" ]
      Commit Records/Requests [ With dialog: Off ]
      Exit Script [ Result: $error & "/" & Items::OnCommit ]
    `);
    assert.equal(result.result, `509/${Number(before) + 1}`);
  } finally {
    store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Name', options: {} }] as never);
  }
});
