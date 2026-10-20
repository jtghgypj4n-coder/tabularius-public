import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-view-change-'));
  createStore(join(dir, 'test.sqlite'));
  store = new Store(join(dir, 'test.sqlite'), 'Test');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] },
    { op: 'createScript', name: 'Seen', text: 'Set Variable [ $$log ; Value: $$log & Get ( ScriptParameter ) & ":" & Get ( LayoutViewState ) & ";" ]' },
  ]);
  store.create('Items', { Name: 'one' });
  const seen = store.schema.scripts.find((s) => s.name === 'Seen')!.id;
  store.applyDesign([{ op: 'createLayout', name: 'Other', occurrence: 'Items' }] as never);
  for (const layout of ['Items', 'Other']) {
    store.applyDesign([{ op: 'updateLayout', layout, design: { triggers: ['OnLayoutEnter', 'OnRecordLoad', 'OnViewChange'].map((event) => ({ event, scriptId: seen, parameter: `"${event}"` })) } }] as never);
  }
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { view: 'form' } }] as never);
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

const run = (text: string, opts: RunOptions = {}) =>
  runScript(store, script(`Set Variable [ $$log ; Value: "" ]\n${text}`), { layout: 'Items', foundSet: store.findIds('Items'), ...opts });

test('View As runs OnViewChange after it switches the view, and only when the view changes', async () => {
  const r = await run(`
    Set Variable [ $start ; Value: Get ( LayoutViewState ) ]
    View As [ View as List ]
    Set Variable [ $after ; Value: $$log ]
    View As [ View as List ]
    View As [ Cycle ]
    View As [ Cycle ]
    Exit Script [ Result: $start & "|" & $after & "|" & $$log & "|" & Get ( LayoutViewState ) ]`);
  assert.equal(r.error, 0);
  assert.equal(r.result, '0|OnViewChange:1;|OnViewChange:1;OnViewChange:2;OnViewChange:0;|0');
  // The person's window is told the view each step chose, Cycle included.
  assert.deepEqual(r.actions.filter((a) => a.step === 'View As').map((a) => a.view), ['list', 'list', 'table', 'form']);
});

test('the window starts in the view the web client shows', async () => {
  const r = await run('Set Variable [ $start ; Value: Get ( LayoutViewState ) ]\nView As [ View as Table ]\nView As [ View as Form ]\nExit Script [ Result: $start & "|" & $$log ]', { view: 'table' });
  assert.equal(r.result, '2|OnViewChange:0;');
});

test("a view the layout doesn't allow isn't switched to; Cycle skips it", async () => {
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { viewsAllowed: ['form', 'table'] } }] as never);
  try {
    const r = await run('View As [ View as List ]\nSet Variable [ $list ; Value: Get ( LayoutViewState ) & $$log ]\nView As [ Cycle ]\nExit Script [ Result: $list & "|" & $$log ]', { view: 'list' });
    assert.equal(r.result, '0|OnViewChange:2;');
    assert.deepEqual(r.actions.filter((a) => a.step === 'View As').map((a) => a.view), ['table']);
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { viewsAllowed: ['form', 'list', 'table'] } }] as never);
  }
});

test('a layout made in Tabularius with no saved view opens as the web client shows it: a short body under a header is a list', async () => {
  const r = await run('Go to Layout [ "Other" ]\nExit Script [ Result: $$log ]');
  assert.equal(r.result, 'OnLayoutEnter:1;OnRecordLoad:1;');
});

test("going to another layout shows it in its own view and runs no OnViewChange; coming back doesn't either", async () => {
  store.applyDesign([{ op: 'updateLayout', layout: 'Other', design: { view: 'table' } }] as never);
  try {
    const r = await run('View As [ View as List ]\nSet Variable [ $$log ; Value: "" ]\nGo to Layout [ "Other" ]\nGo to Layout [ "Items" ]\nExit Script [ Result: $$log ]');
    assert.equal(r.result, 'OnLayoutEnter:2;OnRecordLoad:2;OnLayoutEnter:0;OnRecordLoad:0;');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'Other', design: { view: 'form' } }] as never);
  }
});

test('Save Records as Snapshot Link records the view the window shows', async () => {
  const documents = mkdtempSync(join(dir, 'docs-'));
  const r = await runScript(store, script('Save Records as Snapshot Link [ With dialog: Off ; “form.fmpsl” ; Records being browsed ; Create folders: Off ]\nView As [ View as List ]\nSave Records as Snapshot Link [ With dialog: Off ; “list.fmpsl” ; Records being browsed ; Create folders: Off ]\nExit Script [ Text Result: Get ( LastError ) ]'), { layout: 'Items', documents });
  assert.equal(r.result, '0');
  const view = (name: string) => /<View type="(\w+)">/.exec(readFileSync(join(documents, name), 'utf8'))?.[1];
  assert.equal(view('form.fmpsl'), 'form');
  assert.equal(view('list.fmpsl'), 'list');
});
