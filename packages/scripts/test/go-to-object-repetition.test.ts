import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, stepLine, type Script, type ScriptStep } from '@tabularius/fmp12';
import { createStore, designSnippet, parseScriptText, snippetChanges, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-go-to-object-repetition-'));
  createStore(join(dir, 'test.sqlite'));
  store = new Store(join(dir, 'test.sqlite'), 'Test');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
    { name: 'Name', type: 'text' },
    { name: 'Repeating', type: 'text', options: { repetitions: 3 } },
  ] }]);
  store.create('Items', { Name: 'one', Repeating: JSON.stringify(['first', 'second', 'third']) });

  const layout = store.design('Items')!;
  const objects = layout.objects.map((object) => object.kind === 'field' && object.field?.field === 'Repeating'
    ? { ...object, name: 'repeatBox', field: { ...object.field, repetitions: 3 } }
    : object);
  objects.push({
    id: 90001, kind: 'text', type: 0,
    bounds: { top: 20, left: 20, bottom: 40, right: 120 },
    anchors: { left: true, top: true, right: false, bottom: false },
    style: {}, name: 'staticText', text: 'Static text',
  } as typeof objects[number]);
  store.applyDesign([{ op: 'updateLayout', layout: layout.id, design: { objects } }] as never);
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
const step = (params: NonNullable<ScriptStep['params']>): ScriptStep => ({ stepId: 145, name: 'Go to Object', enabled: true, params });

test('Go to Object uses valid storage-backed repetitions, calculations and the default', async () => {
  for (const [line, expected] of [
    ['Go to Object [ Object Name: "repeatBox" ; Repetition: 2 ]', 'second/2'],
    ['Set Variable [ $rep ; Value: 1 ]\nGo to Object [ Object Name: "repeatBox" ; Repetition: $rep + 2 ]', 'third/3'],
    ['Go to Object [ Object Name: "repeatBox" ]', 'first/1'],
  ] as const) {
    const result = await run(`${line}\nExit Script [ Result: Get ( ActiveFieldContents ) & "/" & Get ( ActiveRepetitionNumber ) ]`);
    assert.equal(result.error, 0);
    assert.equal(result.result, expected);
  }
});

test('Go to Object coerces low and nonnumeric values to 1; an excessive repetition errors without moving focus', async () => {
  for (const value of ['0', '-4', '"not a number"']) {
    const result = await run(`Go to Object [ Object Name: "repeatBox" ; Repetition: ${value} ]\nExit Script [ Result: Get ( ActiveRepetitionNumber ) ]`);
    assert.equal(result.error, 0, value);
    assert.equal(result.result, '1', value);
  }
  const excessive = await run('Set Error Capture [ On ]\nGo to Object [ Object Name: "repeatBox" ; Repetition: 2 ]\nGo to Object [ Object Name: "repeatBox" ; Repetition: 4 ]\nExit Script [ Result: Get ( LastError ) & "/" & Get ( ActiveFieldName ) & "/" & Get ( ActiveRepetitionNumber ) ]');
  assert.equal(excessive.result, '102/Repeating/2');
});

test('Go to Object evaluates repetition only for a field object', async () => {
  const result = await run('Set Error Capture [ On ]\nGo to Object [ Object Name: "staticText" ; Repetition: Evaluate ( "1 +" ) ]\nExit Script [ Result: Get ( LastError ) & "/" & Get ( ActiveFieldName ) ]');
  assert.equal(result.error, 0);
  assert.equal(result.result, '0/');
});

test('Go to Object handles structured repetition parameters and serializes them back to text', async () => {
  const direct: Script = { id: 9999, name: 'structured', steps: [
    { stepId: 141, name: 'Set Variable', enabled: true, params: { variable: '$rep', value: '2' } },
    step({ objectName: '"repeatBox"', repetitionCalculation: '$rep' }),
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( ActiveFieldContents ) & "/" & Get ( ActiveRepetitionNumber )' } },
  ] } as Script;
  const result = await runScript(store, direct, { layout: 'Items', foundSet: store.findIds('Items') });
  assert.equal(result.result, 'second/2');

  const line = stepLine('Go to Object', { objectName: '"repeatBox"', repetitionCalculation: '$rep + 1' });
  assert.equal(line, 'Go to Object [ Object Name: "repeatBox" ; Repetition: $rep + 1 ]');
  const [parsed] = parseScriptText(line, store.schema);
  assert.deepEqual(parsed.params, { objectName: '"repeatBox"', repetitionCalculation: '$rep + 1' });
});

test('Go to Object keeps repetition through clipboard XML and executes the copied step', async () => {
  const line = 'Go to Object [ Object Name: "repeatBox" ; Repetition: 2 ]';
  const parsed = parseScriptText(line, store.schema)[0];
  const source: Script = { id: 9998, name: 'clipboard source', steps: [
    { stepId: parsed.stepId!, name: 'Go to Object', enabled: true, params: parsed.params },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( ActiveRepetitionNumber ) & "/" & Get ( ActiveFieldContents )' } },
  ] } as Script;
  store.applyDesign([{ op: 'createScript', name: 'Clipboard', steps: source.steps.map((s) => ({ name: s.name, params: s.params })) }]);
  const copied = store.schema.scripts.find((s) => s.name === 'Clipboard')!;
  const xml = designSnippet(store.schema, { scripts: [copied.id] }).xml;
  const roundTrip = snippetChanges(xml, store.schema).changes[0] as { steps: { stepId: number; name: string; enabled?: boolean; params?: ScriptStep['params'] }[] };
  const result = await runScript(store, { id: 9997, name: 'round trip', steps: roundTrip.steps.map((s) => ({ ...s, enabled: s.enabled !== false })) } as Script, { layout: 'Items', foundSet: store.findIds('Items') });
  assert.equal(result.result, '2/second');
});

test("leaving a field for a repetition the field doesn't show runs no OnObjectExit; the repetition is worked out once", async () => {
  store.applyDesign([{ op: 'createScript', name: 'Left', text: 'Set Variable [ $$log ; Value: $$log & "exit;" ]' }]);
  const left = store.schema.scripts.find((s) => s.name === 'Left')!;
  const layout = store.design('Items')!;
  const objects = layout.objects.map((o) => o.kind === 'field' && o.field?.field === 'Name' ? { ...o, triggers: [{ event: 'OnObjectExit', scriptId: left.id, script: 'Left' }] } : o);
  store.applyDesign([{ op: 'updateLayout', layout: layout.id, design: { objects } }] as never);
  try {
    const result = await run(`
      Set Error Capture [ On ]
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$n ; Value: 0 ]
      Go to Field [ Items::Name ]
      Go to Object [ Object Name: "repeatBox" ; Repetition: 4 ]
      Set Variable [ $missed ; Value: Get ( LastError ) & "/" & Get ( ActiveFieldName ) & "/" & $$log ]
      Go to Object [ Object Name: "repeatBox" ; Repetition: Let ( $$n = $$n + 1 ; 2 ) ]
      Exit Script [ Result: $missed & "|" & $$log & $$n & "/" & Get ( ActiveRepetitionNumber ) ]`);
    assert.equal(result.result, '102/Name/|exit;1/2');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: layout.id, design: { objects: layout.objects } }] as never);
  }
});
