// A script step that goes to a layout, a record or a mode fires the layout's script triggers, as in FileMaker
// (Claris: "Script triggers can be activated by user actions or by scripts"): at once, before the next step, in
// FileMaker's order, and without changing the step's own Get ( LastError ) or Get ( ScriptResult ).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

const script = (name: string) => store.schema.scripts.find((s) => s.name === name)!;
const trigger = (layout: string, event: string, name: string, extra: { parameter?: string; modes?: ('browse' | 'find' | 'preview')[] } = {}) =>
  ({ event, scriptId: script(name).id, script: name, ...extra });

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-step-triggers-'));
  createStore(join(dir, 'T.sqlite'));
  store = new Store(join(dir, 'T.sqlite'), 'T');
  store.applyDesign([
    { op: 'createTable', name: 'People', fields: [{ name: 'Name' }] },
    { op: 'createTable', name: 'Places', fields: [{ name: 'City' }] },
    // Each trigger script notes what set it off, where, and on which record.
    { op: 'createScript', name: 'Note', text: 'Set Variable [ $$log ; Value: $$log & Get ( ScriptParameter ) & "@" & Get ( LayoutName ) & ":" & Get ( RecordNumber ) & ";" ]' },
    { op: 'createScript', name: 'Away', text: 'Set Variable [ $$log ; Value: $$log & "away;" ]\nGo to Layout [ "Places" ]' },
    { op: 'createScript', name: 'Fails', text: 'Set Variable [ $$log ; Value: $$log & "fails;" ]\nGo to Record/Request/Page [ Next ]\nExit Script [ Text Result: "from trigger" ]' },
    { op: 'createScript', name: 'Undo', text: 'Set Variable [ $$log ; Value: $$log & "undo;" ]\nRevert Transaction [ Condition: 1 ; Error code: 5001 ; Error message: "no" ]' },
    { op: 'createScript', name: 'Veto', text: 'Set Variable [ $$log ; Value: $$log & Get ( ScriptParameter ) & "@" & Get ( LayoutName ) & ";" ]\nExit Script [ Text Result: $$allow ]' },
    { op: 'createScript', name: 'Recommit', text: 'Set Variable [ $$log ; Value: $$log & "recommit;" ]\nSet Field [ People::Name ; People::Name & "+" ]\nCommit Records/Requests [ With dialog: Off ]' },
    { op: 'createScript', name: 'Detour', text: 'Set Variable [ $$log ; Value: $$log & "detour;" ]\nGo to Layout [ "Places" ]' },
    { op: 'createScript', name: 'Stop', text: 'Set Variable [ $$log ; Value: $$log & "stop;" ]\nHalt Script' },
  ]);
  for (const n of ['A', 'B', 'C']) store.create('People', { Name: n });
  store.create('Places', { City: 'Leeds' });
  store.applyDesign([
    { op: 'updateLayout', layout: 'Places', design: { triggers: [
      trigger('Places', 'OnRecordLoad', 'Note', { parameter: '"load"' }),
      trigger('Places', 'OnLayoutEnter', 'Note', { parameter: '"enter"' }),
    ] } },
    { op: 'updateLayout', layout: 'People', design: { triggers: [
      trigger('People', 'OnRecordLoad', 'Note', { parameter: '"load"', modes: ['browse', 'find'] }),
      trigger('People', 'OnModeEnter', 'Note', { parameter: '"mode"', modes: ['browse', 'find'] }),
    ] } },
  ]);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const run = (text: string, layout = 'People') => runScript(store, {
  id: 9999, name: 'test',
  steps: parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as Script, { layout, foundSet: store.findIds(layout) });

test('going to a layout fires OnLayoutEnter then OnRecordLoad there, before the next step', async () => {
  const r = await run(`
    Set Variable [ $$log ; Value: "" ]
    Go to Layout [ "Places" ]
    Set Variable [ $seen ; Value: $$log ]
    Exit Script [ Text Result: $seen ]`);
  assert.equal(r.result, 'enter@Places:1;load@Places:1;');
});

test('going to another record fires OnRecordLoad; staying on it or doing other steps does not', async () => {
  const r = await run(`
    Set Variable [ $$log ; Value: "" ]
    Go to Record/Request/Page [ First ]
    Set Field [ People::Name ; "A2" ]
    Go to Record/Request/Page [ Next ]
    Go to Record/Request/Page [ Last ]
    Exit Script [ Text Result: $$log ]`);
  assert.equal(r.result, 'load@People:2;load@People:3;');
});

test('entering Find mode fires OnModeEnter and OnRecordLoad where the trigger runs in Find mode', async () => {
  const r = await run(`
    Set Variable [ $$log ; Value: "" ]
    Enter Find Mode [ Pause: Off ]
    Enter Browse Mode [ ]
    Exit Script [ Text Result: $$log ]`);
  assert.equal(r.result, 'mode@People:1;load@People:1;mode@People:1;load@People:1;');
});

test("a trigger's errors and result don't become the step's", async () => {
  store.applyDesign([{ op: 'updateLayout', layout: 'Places', design: { triggers: [trigger('Places', 'OnLayoutEnter', 'Fails')] } }]);
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      Go to Layout [ "Places" ]
      Exit Script [ Text Result: $$log & Get ( LastError ) & "|" & Get ( ScriptResult ) & "|" & Get ( LayoutName ) ]`);
    assert.equal(r.result, 'fails;0||Places');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'Places', design: { triggers: [] } }]);
  }
});

test('a trigger that moves on fires the triggers of where it went, and the rest of the first wait', async () => {
  store.applyDesign([
    { op: 'updateLayout', layout: 'Places', design: { triggers: [trigger('Places', 'OnLayoutEnter', 'Note', { parameter: '"enter"' }), trigger('Places', 'OnRecordLoad', 'Note', { parameter: '"load"' })] } },
    { op: 'createLayout', name: 'Hall', occurrence: 'People' },
  ]);
  store.applyDesign([{ op: 'updateLayout', layout: 'Hall', design: { triggers: [trigger('Hall', 'OnLayoutEnter', 'Away'), trigger('Hall', 'OnRecordLoad', 'Note', { parameter: '"hall"' })] } }]);
  const r = await run(`
    Set Variable [ $$log ; Value: "" ]
    Go to Layout [ "Hall" ]
    Exit Script [ Text Result: $$log & Get ( LayoutName ) ]`);
  // Hall's OnRecordLoad doesn't run: by then the window is on Places.
  assert.equal(r.result, 'away;enter@Places:1;load@Places:1;Places');
});

test('Halt Script in a trigger halts the script that set it off', async () => {
  store.applyDesign([{ op: 'updateLayout', layout: 'Places', design: { triggers: [trigger('Places', 'OnLayoutEnter', 'Stop')] } }]);
  const r = await run(`
    Set Variable [ $$log ; Value: "" ]
    Go to Layout [ "Places" ]
    Set Variable [ $$log ; Value: $$log & "after;" ]`);
  assert.equal(r.halted ?? true, true);
  const check = await run('Exit Script [ Text Result: $$log ]');
  assert.ok(!String(check.result).includes('after;'));
});

test('the window the script starts on fires nothing just for being there', async () => {
  const r = await run(`
    Set Variable [ $$log ; Value: "start;" ]
    Exit Script [ Text Result: $$log ]`, 'Places');
  assert.equal(r.result, 'start;');
});

test('(the failing step the trigger above uses does fail)', async () => {
  const r = await run(`
    Go to Record/Request/Page [ Next ]
    Exit Script [ Text Result: Get ( LastError ) ]`, 'Places');
  assert.notEqual(r.result, '0');
});

test('a trigger that reverts the transaction unwinds the script that set it off to its Commit', async () => {
  store.applyDesign([{ op: 'updateLayout', layout: 'Places', design: { triggers: [trigger('Places', 'OnLayoutEnter', 'Undo')] } }]);
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      Open Transaction
      Go to Layout [ "Places" ]
      Set Variable [ $$log ; Value: $$log & "after;" ]
      Commit Transaction
      Exit Script [ Text Result: $$log & Get ( LastError ) ]`);
    assert.equal(r.result, 'undo;5001');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'Places', design: { triggers: [] } }]);
  }
});

test('Import Records shows the imported records without firing OnRecordLoad', async () => {
  const docs = join(dir, 'docs');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, 'people.xml'), '<?xml version="1.0"?><FMPXMLRESULT xmlns="http://www.filemaker.com/fmpxmlresult"><RESULTSET FOUND="1"><ROW MODID="0" RECORDID="1"><COL><DATA>Dee</DATA></COL></ROW></RESULTSET></FMPXMLRESULT>');
  const [clear, exit] = parseScriptText('Set Variable [ $$log ; Value: "" ]\nExit Script [ Text Result: $$log & Get ( FoundCount ) ]', store.schema)
    .map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: true, params: x.params }));
  const r = await runScript(store, { id: 9998, name: 'imp', steps: [
    clear,
    { stepId: 35, name: 'Import Records', enabled: true, params: { noDialog: true, tableOccurrence: { id: 0, name: 'People' }, filePaths: ['file:people.xml'] } },
    exit,
  ] } as Script, { layout: 'People', foundSet: store.findIds('People'), documents: docs });
  assert.equal(r.error, 0);
  assert.equal(r.result, '1');
});

test("one of the person's other windows, first used by a step, fires nothing for showing what it showed", async () => {
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [...people, trigger('People', 'OnLayoutEnter', 'Note', { parameter: '"enter"' })] } }]);
  after(() => store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]));
  const r = await runScript(store, {
    id: 9997, name: 'win',
    steps: parseScriptText('Set Variable [ $$log ; Value: "" ]\nSelect Window [ Name: "Other" ]\nGo to Record/Request/Page [ First ]\nExit Script [ Text Result: $$log & Get ( WindowName ) ]', store.schema)
      .map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: x.enabled !== false, params: x.params })),
  } as Script, { layout: 'People', foundSet: store.findIds('People'), openWindows: [{ id: 'w2', name: 'Other', layout: '' }] });
  assert.equal(r.result, 'Other');
});

test('OnLayoutExit runs before Go to Layout leaves, and exiting False keeps the window where it is (error 20)', async () => {
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [trigger('People', 'OnLayoutExit', 'Veto', { parameter: '"exit"' })] } }]);
  try {
    const stay = await run(`
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: False ]
      Go to Layout [ "People" ]
      Go to Layout [ "Places" ]
      Exit Script [ Text Result: $$log & Get ( LastError ) & "|" & Get ( LayoutName ) ]`);
    // Going to the layout it's on doesn't leave it.
    assert.equal(stay.result, 'exit@People;20|People');
    const go = await run(`
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: True ]
      Go to Layout [ "Places" ]
      Exit Script [ Text Result: $$log & Get ( LastError ) & "|" & Get ( LayoutName ) ]`);
    assert.equal(go.result, 'exit@People;0|Places');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

test('OnModeExit can keep the window in its mode', async () => {
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [trigger('People', 'OnModeExit', 'Veto', { parameter: '"mode"' })] } }]);
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: 0 ]
      Enter Browse Mode [ ]
      Enter Find Mode [ Pause: Off ]
      Exit Script [ Text Result: $$log & Get ( LastError ) & "|" & Get ( WindowMode ) ]`);
    assert.equal(r.result, 'mode@People;20|0');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

test('OnRecordCommit and OnRecordRevert run only for a changed record, and can stop the step', async () => {
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [
    trigger('People', 'OnRecordCommit', 'Veto', { parameter: '"commit"' }),
    trigger('People', 'OnRecordRevert', 'Veto', { parameter: '"revert"' }),
  ] } }]);
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: False ]
      Go to Record/Request/Page [ First ]
      Commit Records/Requests [ With dialog: Off ]
      Set Field [ People::Name ; "Changed" ]
      Commit Records/Requests [ With dialog: Off ]
      Set Variable [ $commit ; Value: Get ( LastError ) ]
      Revert Record/Request [ With dialog: Off ]
      Set Variable [ $revert ; Value: Get ( LastError ) ]
      Set Variable [ $$allow ; Value: True ]
      Commit Records/Requests [ With dialog: Off ]
      Exit Script [ Text Result: $$log & $commit & "," & $revert & "," & Get ( LastError ) & "|" & People::Name ]`);
    assert.equal(r.result, 'commit@People;revert@People;commit@People;20,20,0|Changed');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

test("a trigger's own script doesn't set the same trigger off again", async () => {
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [trigger('People', 'OnRecordCommit', 'Recommit'), trigger('People', 'OnLayoutExit', 'Detour')] } }]);
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      Go to Record/Request/Page [ First ]
      Set Field [ People::Name ; "Ann" ]
      Commit Records/Requests [ With dialog: Off ]
      Set Variable [ $name ; Value: People::Name ]
      Go to Layout [ "Hall" ]
      Exit Script [ Text Result: $$log & $name & "|" & Get ( LayoutName ) ]`);
    // The commit trigger commits once more without running again; the detour leaves People once (to Places), and the
    // step then goes on from there to Hall, whose OnLayoutEnter goes on to Places.
    assert.equal(r.result, 'recommit;detour;away;Ann+|Places');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

test('a layout chosen by calculation is worked out once', async () => {
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [trigger('People', 'OnLayoutExit', 'Note', { parameter: '"exit"' })] } }]);
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$n ; Value: 0 ]
      Go to Layout [ Layout Name: Let ( $$n = $$n + 1 ; "Places" ) ]
      Exit Script [ Text Result: $$n & "|" & Get ( LayoutName ) ]`);
    assert.equal(r.result, '1|Places');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

test("Go to Field sets off the field object's OnObjectEnter, and leaving it its OnObjectExit, which can keep the cursor there", async () => {
  const design = store.design('People')!;
  const withTriggers = design.objects.map((o) => (o.field?.field !== undefined ? { ...o, triggers: [
    { event: 'OnObjectEnter', scriptId: script('Note').id, script: 'Note', parameter: '"in"' },
    { event: 'OnObjectExit', scriptId: script('Veto').id, script: 'Veto', parameter: '"out"' },
  ] } : o));
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: withTriggers, triggers: [] } }]);
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: False ]
      Go to Record/Request/Page [ First ]
      Go to Field [ People::Name ]
      Go to Field [ People::Name ]
      Go to Next Field
      Set Variable [ $tab ; Value: Get ( LastError ) & "/" & Get ( ActiveFieldName ) ]
      Go to Field [ ]
      Set Variable [ $kept ; Value: Get ( LastError ) & "/" & Get ( ActiveFieldName ) ]
      Set Variable [ $$allow ; Value: True ]
      Go to Field [ ]
      Exit Script [ Text Result: $$log & $tab & "," & $kept & "|" & Get ( LastError ) & "/" & Get ( ActiveFieldName ) ]`);
    // Going into the field it's in, or tabbing on a layout whose only stop it is, doesn't leave it.
    assert.equal(r.result, 'in@People:1;out@People;out@People;0/Name,20/Name|0/');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: design.objects, triggers: design.triggers } }]);
  }
});

test("a field's own trigger started by the client: the cursor starts in it, and it doesn't set itself off again", async () => {
  const design = store.design('People')!;
  const field = design.objects.find((o) => o.field?.field !== undefined)!;
  const withTriggers = design.objects.map((o) => (o.id === field.id ? { ...o, triggers: [
    { event: 'OnObjectEnter', scriptId: script('Note').id, script: 'Note', parameter: '"in"' },
    { event: 'OnObjectExit', scriptId: script('Note').id, script: 'Note', parameter: '"out"' },
  ] } : o));
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: withTriggers, triggers: [] } }]);
  try {
    const steps = parseScriptText('Set Variable [ $$log ; Value: "" ]\nGo to Field [ People::Name ]\nGo to Field [ ]\nExit Script [ Text Result: $$log ]', store.schema)
      .map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: true, params: x.params }));
    const asEnter = await runScript(store, { id: 9996, name: 'enter', steps } as Script,
      { layout: 'People', foundSet: store.findIds('People'), activeObject: field.id, startedBy: { event: 'OnObjectEnter', objectId: field.id } });
    // Already in the field: no second OnObjectEnter; leaving it runs its OnObjectExit.
    assert.equal(asEnter.result, 'out@People:1;');
    const asExit = await runScript(store, { id: 9995, name: 'exit', steps } as Script,
      { layout: 'People', foundSet: store.findIds('People'), activeObject: field.id, startedBy: { event: 'OnObjectExit', objectId: field.id } });
    // The exit trigger's own script leaving the field doesn't run the exit trigger again.
    assert.equal(asExit.result, '');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: design.objects, triggers: design.triggers } }]);
  }
});

test('Go to Object by calculation works out the object name once, though leaving a field checks it first', async () => {
  const design = store.design('People')!;
  const withTriggers = design.objects.map((o) => (o.field?.field !== undefined ? { ...o, name: 'nameBox', triggers: [
    { event: 'OnObjectExit', scriptId: script('Note').id, script: 'Note', parameter: '"out"' },
  ] } : o));
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: withTriggers, triggers: [] } }]);
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      Go to Field [ People::Name ]
      Set Variable [ $$n ; Value: 0 ]
      Go to Object [ Object Name: Let ( $$n = $$n + 1 ; "nameBox" ) ]
      Exit Script [ Text Result: $$n & "|" & Get ( LastError ) & "|" & $$log ]`);
    assert.equal(r.result, '1|0|');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: design.objects, triggers: design.triggers } }]);
  }
});

test('moving off a changed record runs OnRecordCommit first, which can keep the script on it', async () => {
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [trigger('People', 'OnRecordCommit', 'Veto', { parameter: '"commit"' })] } }]);
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: False ]
      Go to Record/Request/Page [ First ]
      Set Variable [ $count ; Value: Get ( FoundCount ) ]
      Go to Record/Request/Page [ Next ]
      Set Field [ People::Name ; "B2" ]
      Go to Record/Request/Page [ Next ]
      Set Variable [ $kept ; Value: Get ( LastError ) & "/" & Get ( RecordNumber ) & "/" & Get ( RecordOpenState ) ]
      New Record/Request
      Set Variable [ $new ; Value: Get ( LastError ) & "/" & ( Get ( FoundCount ) - $count ) ]
      Set Variable [ $$allow ; Value: True ]
      Go to Record/Request/Page [ Previous ]
      Exit Script [ Text Result: $$log & $kept & "," & $new & "|" & Get ( LastError ) & "/" & Get ( RecordNumber ) & "/" & Get ( RecordOpenState ) ]`);
    // Moving with nothing changed runs nothing; vetoed, the step does nothing; allowed, the record is saved and left.
    assert.equal(r.result, 'commit@People;commit@People;commit@People;20/2/2,20/0|0/1/0');
    assert.equal(store.query("SELECT count(*) AS n FROM People WHERE Name = 'B2'")[0].n, 1);
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

test('leaving a layout from a field in a changed record: OnObjectExit, then OnRecordCommit, then OnLayoutExit', async () => {
  const design = store.design('People')!;
  const objects = design.objects.map((o) => (o.field?.field !== undefined ? { ...o, triggers: [
    { event: 'OnObjectExit', scriptId: script('Note').id, script: 'Note', parameter: '"object"' },
  ] } : o));
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects, triggers: [
    trigger('People', 'OnRecordCommit', 'Note', { parameter: '"commit"' }),
    trigger('People', 'OnLayoutExit', 'Note', { parameter: '"layout"' }),
  ] } }]);
  try {
    const r = await run(`
      Go to Record/Request/Page [ First ]
      Go to Field [ People::Name ]
      Set Field [ People::Name ; People::Name ]
      Set Variable [ $$log ; Value: "" ]
      Go to Layout [ "Places" ]
      Set Variable [ $left ; Value: $$log ]
      Go to Layout [ "People" ]
      Go to Field [ People::Name ]
      Set Variable [ $$log ; Value: "" ]
      Commit Records/Requests [ With dialog: Off ]
      Exit Script [ Text Result: $left & "|" & $$log ]`);
    // Committing with nothing changed still takes the cursor out of the field.
    assert.equal(r.result, 'object@People:1;commit@People:1;layout@People:1;|object@People:1;');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: design.objects, triggers: design.triggers } }]);
  }
});

test('inside a transaction OnRecordCommit does not run', async () => {
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [trigger('People', 'OnRecordCommit', 'Note', { parameter: '"commit"' })] } }]);
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      Go to Record/Request/Page [ First ]
      Open Transaction
      Set Field [ People::Name ; People::Name ]
      Go to Record/Request/Page [ Next ]
      Commit Transaction
      Exit Script [ Text Result: $$log & Get ( LastError ) ]`);
    assert.equal(r.result, '0');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

/** People's field object with these triggers, and the layout's, for the test's length. */
async function withTriggers(objectTriggers: ReturnType<typeof trigger>[], layoutTriggers: ReturnType<typeof trigger>[], body: () => Promise<void>) {
  const design = store.design('People')!;
  const objects = design.objects.map((o) => (o.field?.field !== undefined ? { ...o, name: 'nameBox', triggers: objectTriggers } : o));
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects, triggers: layoutTriggers } }]);
  try {
    await body();
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: design.objects, triggers: design.triggers } }]);
  }
}

test("OnRecordCommit sees the record as the field's OnObjectExit left it: committed, or changed", async () => {
  store.applyDesign([
    { op: 'createScript', name: 'Exit Commits', text: 'Set Variable [ $$log ; Value: $$log & "exit;" ]\nCommit Records/Requests [ With dialog: Off ]' },
    { op: 'createScript', name: 'Exit Changes', text: 'Set Variable [ $$log ; Value: $$log & "exit;" ]\nSet Field [ People::Name ; People::Name & "!" ]' },
  ]);
  const steps = `
    Go to Record/Request/Page [ First ]
    Go to Field [ People::Name ]
    Set Variable [ $$log ; Value: "" ]
    SET
    Go to Record/Request/Page [ Next ]
    Exit Script [ Text Result: $$log ]`;
  await withTriggers([trigger('People', 'OnObjectExit', 'Exit Commits')], [trigger('People', 'OnRecordCommit', 'Note', { parameter: '"commit"' })], async () => {
    // The exit script's own commit runs OnRecordCommit; the step then has nothing left to commit.
    assert.equal((await run(steps.replace('SET', 'Set Field [ People::Name ; People::Name ]'))).result, 'exit;commit@People:1;');
  });
  await withTriggers([trigger('People', 'OnObjectExit', 'Exit Changes')], [trigger('People', 'OnRecordCommit', 'Note', { parameter: '"commit"' })], async () => {
    assert.equal((await run(steps.replace('SET', ''))).result, 'exit;commit@People:1;');
  });
});

test('sorting, Quick Find and a new window commit the record, so they run OnObjectExit and OnRecordCommit', async () => {
  await withTriggers([trigger('People', 'OnObjectExit', 'Note', { parameter: '"exit"' })], [trigger('People', 'OnRecordCommit', 'Note', { parameter: '"commit"' })], async () => {
    for (const step of ['Sort Records by Field [ People::Name ]', 'Perform Quick Find [ "A" ]', 'New Window [ "Second" ]']) {
      const r = await run(`
        Go to Record/Request/Page [ First ]
        Go to Field [ People::Name ]
        Set Field [ People::Name ; People::Name ]
        Set Variable [ $$log ; Value: "" ]
        ${step}
        Exit Script [ Text Result: $$log ]`);
      assert.equal(r.result, 'exit@People:1;commit@People:1;', step);
    }
  });
});

test("a step that fails before it commits or moves the cursor runs no trigger for it", async () => {
  await withTriggers([trigger('People', 'OnObjectExit', 'Note', { parameter: '"exit"' })], [trigger('People', 'OnRecordCommit', 'Note', { parameter: '"commit"' })], async () => {
    const r = await run(`
      Set Error Capture [ On ]
      Go to Record/Request/Page [ First ]
      Go to Field [ People::Name ]
      Set Field [ People::Name ; People::Name ]
      Set Variable [ $$log ; Value: "" ]
      Perform Find [ ]
      Set Variable [ $find ; Value: Get ( LastError ) ]
      Go to Object [ Object Name: "nope" ]
      Set Variable [ $object ; Value: Get ( LastError ) ]
      Set Variable [ $before ; Value: $$log ]
      Commit Records/Requests [ With dialog: Off ]
      Exit Script [ Text Result: $find & "," & $object & "|" & $before & "|" & $$log ]`);
    // Error 400 (no criteria) and 116 (no such object): nothing ran until the real commit.
    assert.equal(r.result, '400,116||exit@People:1;commit@People:1;');
  });
});

test("a run starts in a field only if the person could have put the cursor there", async () => {
  store.savePrivilegeSet({ name: 'No Names', records: { view: true, edit: true, create: true, delete: true },
    tables: { People: { view: true, edit: true, create: true, delete: true, fields: { Name: 'none' } } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmwebdirect'] } as never);
  store.setPassword('nonames', 'pw', 'No Names');
  const field = store.design('People')!.objects.find((o) => o.field?.field !== undefined)!;
  const steps = parseScriptText('Exit Script [ Text Result: Get ( ActiveFieldName ) & "=" & Get ( ActiveFieldContents ) ]', store.schema)
    .map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: true, params: x.params }));
  const opts = { layout: 'People', foundSet: store.findIds('People'), activeObject: field.id };
  assert.equal((await runScript(store, { id: 9994, name: 'in', steps } as Script, opts)).result.split('=')[0], 'Name');
  // A field the account can't see: not even a script with full access starts in it.
  const limited = { ...opts, account: 'nonames', privileges: store.privileges('nonames') };
  assert.equal((await runScript(store, { id: 9993, name: 'full', steps, fullAccess: true } as Script, limited)).result, '=');
});

test("Go to Related Record onto another layout runs OnLayoutExit first, only when there are related records", async () => {
  createStore(join(dir, 'R.sqlite'));
  const r = new Store(join(dir, 'R.sqlite'), 'R');
  try {
    r.applyDesign([
      { op: 'createTable', name: 'Owners', fields: [{ name: 'Id' }] },
      { op: 'createTable', name: 'Pets', fields: [{ name: 'OwnerId' }] },
      { op: 'createRelationship', left: 'Owners', right: 'Pets', predicates: [{ left: 'Id', right: 'OwnerId', operator: '=' }] },
      { op: 'createScript', name: 'Veto', text: 'Set Variable [ $$log ; Value: $$log & Get ( LayoutName ) & ";" ]\nExit Script [ Text Result: $$allow ]' },
    ]);
    r.create('Owners', { Id: '1' });
    r.create('Owners', { Id: '2' });
    r.create('Pets', { OwnerId: '1' });
    const veto = r.schema.scripts.find((x) => x.name === 'Veto')!;
    r.applyDesign([{ op: 'updateLayout', layout: 'Owners', design: { triggers: [{ event: 'OnLayoutExit', scriptId: veto.id, script: 'Veto' }] } }]);
    const text = `
      Set Error Capture [ On ]
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: False ]
      Go to Record/Request/Page [ Last ]
      Go to Related Record [ From table: “Pets” ; Using layout: “Pets” ]
      Set Variable [ $none ; Value: Get ( LastError ) & "/" & $$log ]
      Go to Record/Request/Page [ First ]
      Go to Related Record [ From table: “Pets” ; Using layout: “Pets” ]
      Set Variable [ $kept ; Value: Get ( LastError ) & "/" & Get ( LayoutName ) ]
      Set Variable [ $$allow ; Value: True ]
      Go to Related Record [ From table: “Pets” ; Using layout: “Pets” ]
      Exit Script [ Text Result: $none & "," & $kept & "|" & $$log & Get ( LastError ) & "/" & Get ( LayoutName ) ]`;
    const res = await runScript(r, {
      id: 9999, name: 'gtrr',
      steps: parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), r.schema).map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: x.enabled !== false, params: x.params })),
    } as Script, { layout: 'Owners', foundSet: r.findIds('Owners') });
    // Owner 2 has no pets: the step fails (101) without leaving. Owner 1: vetoed (20), then allowed.
    assert.equal(res.result, '101/,20/Owners|Owners;Owners;0/Pets');
  } finally {
    r.close();
  }
});

test('Close Window runs the layout\'s OnLayoutExit first, which can keep it open; the window name is worked out once', async () => {
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [
    trigger('People', 'OnLayoutExit', 'Veto', { parameter: '"exit"' }),
    trigger('People', 'OnRecordCommit', 'Note', { parameter: '"commit"' }),
  ] } }]);
  try {
    const r = await run(`
      Set Error Capture [ On ]
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: False ]
      Set Variable [ $$n ; Value: 0 ]
      New Window [ "Second" ]
      Select Window [ Name: Let ( $$n = $$n + 1 ; "Nowhere" ) ]
      Set Variable [ $select ; Value: Get ( LastError ) & "/" & $$n & "/" & $$log ]
      Close Window [ Name: Let ( $$n = $$n + 1 ; "Second" ) ]
      Set Variable [ $kept ; Value: Get ( LastError ) & "/" & Get ( WindowName ) & "/" & $$n ]
      Set Variable [ $$allow ; Value: True ]
      Close Window [ Current Window ]
      Exit Script [ Text Result: $select & "," & $kept & "|" & $$log & Get ( LastError ) & "/" & ( Get ( WindowName ) <> "Second" ) ]`);
    assert.equal(r.result, '112/1/,20/Second/2|exit@People;exit@People;0/1');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

test('Close Window on another window runs that window\'s OnLayoutExit, in that window, which can keep it open', async () => {
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [trigger('People', 'OnLayoutExit', 'Veto', { parameter: '"exit"' })] } }]);
  try {
    const r = await run(`
      Set Error Capture [ On ]
      Set Variable [ $first ; Value: Get ( WindowName ) ]
      Set Variable [ $$allow ; Value: True ]
      New Window [ "Second" ]
      Go to Layout [ "Places" ]
      Set Variable [ $$allow ; Value: False ]
      Set Variable [ $$log ; Value: "" ]
      Close Window [ Name: $first ]
      Set Variable [ $kept ; Value: Get ( LastError ) & "/" & Get ( WindowName ) & "/" & ValueCount ( WindowNames ) ]
      Set Variable [ $$allow ; Value: True ]
      Close Window [ Name: $first ]
      Exit Script [ Text Result: $kept & "," & Get ( LastError ) & "/" & Get ( WindowName ) & "/" & ValueCount ( WindowNames ) & "|" & $$log ]`);
    // The trigger runs in the window being closed, on its layout (People; the script's window is on Places), and
    // the script carries on in its own window.
    assert.equal(r.result, '20/Second/2,0/Second/1|exit@People;exit@People;');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

test('a trigger set off by another window\'s script reads its own window: name, layout, found set and record', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Whose', text: 'Set Variable [ $$log ; Value: $$log & Get ( WindowName ) & "/" & Get ( LayoutName ) & "/" & Get ( FoundCount ) & "/" & Get ( RecordNumber ) & ";" ]' }]);
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [trigger('People', 'OnLayoutExit', 'Whose')] } }]);
  try {
    const r = await run(`
      Set Variable [ $first ; Value: Get ( WindowName ) ]
      Go to Record/Request/Page [ Last ]
      Set Variable [ $mine ; Value: Get ( WindowName ) & "/" & Get ( LayoutName ) & "/" & Get ( FoundCount ) & "/" & Get ( RecordNumber ) & ";" ]
      New Window [ "Second" ]
      Go to Layout [ "Places" ]
      Set Variable [ $$log ; Value: "" ]
      Close Window [ Name: $first ]
      Exit Script [ Text Result: $mine & "|" & $$log & "|" & Get ( WindowName ) & "/" & Get ( LayoutName ) ]`);
    assert.equal(r.error, 0);
    // The trigger saw the closing window's own state, and the script went on in "Second", on Places.
    const [mine, seen, after] = String(r.result).split('|');
    assert.match(mine, /^[^/]+\/People\/\d+\/\d+;$/);
    assert.equal(seen, mine);
    assert.equal(after, 'Second/Places');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

test('a trigger set off by another window\'s script that selects a third window leaves that window selected', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Hop', text: 'If [ $$hop ]\nSelect Window [ Name: "Third" ]\nEnd If' }]);
  const people = store.design('People')!.triggers!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: [trigger('People', 'OnLayoutExit', 'Hop')] } }]);
  try {
    const r = await run(`
      Set Variable [ $first ; Value: Get ( WindowName ) ]
      New Window [ "Third" ]
      New Window [ "Second" ]
      Go to Layout [ "Places" ]
      Set Variable [ $$hop ; Value: True ]
      Close Window [ Name: $first ]
      Set Variable [ $$hop ; Value: False ]
      Exit Script [ Text Result: Get ( WindowName ) ]`);
    assert.equal(r.result, 'Third');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { triggers: people } }]);
  }
});

test('Insert Text, Insert Calculated Result, Paste, Cut and Clear set off the field object\'s OnObjectModify; Set Field does not', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Seen', text: 'Set Variable [ $$log ; Value: $$log & Get ( ScriptParameter ) & "=" & People::Name & ";" ]' }]);
  await withTriggers([trigger('People', 'OnObjectModify', 'Seen', { parameter: 'Get ( ActiveFieldName )' })], [], async () => {
    const r = await run(`
      Go to Record/Request/Page [ First ]
      Set Variable [ $$log ; Value: "" ]
      Set Field [ People::Name ; "set" ]
      Insert Text [ Select ; People::Name ; "text" ]
      Insert Calculated Result [ Select ; People::Name ; "calc" ]
      Go to Field [ People::Name ]
      Copy [ People::Name ]
      Clear [ Select ; People::Name ]
      Paste [ Select ; People::Name ]
      Go to Record/Request/Page [ Next ]
      Insert from Last Visited [ Select ; People::Name ]
      Exit Script [ Text Result: $$log ]`);
    // After the step: the script sees the new value. The parameter is worked out as the trigger runs.
    assert.equal(r.result, '=text;=calc;Name=;Name=calc;=calc;');
  });
});

test('leaving a field a step changed runs OnObjectValidate, then OnObjectSave, then OnObjectExit; each can keep the cursor there', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Gate', text: 'Set Variable [ $$log ; Value: $$log & Get ( ScriptParameter ) & ";" ]\nExit Script [ Text Result: $$allow ≠ Get ( ScriptParameter ) ]' }]);
  await withTriggers([
    trigger('People', 'OnObjectValidate', 'Gate', { parameter: '"validate"' }),
    trigger('People', 'OnObjectSave', 'Gate', { parameter: '"save"' }),
    trigger('People', 'OnObjectExit', 'Gate', { parameter: '"exit"' }),
  ], [], async () => {
    const r = await run(`
      Go to Record/Request/Page [ First ]
      Set Variable [ $$allow ; Value: "" ]
      Go to Field [ People::Name ]
      Set Variable [ $$log ; Value: "" ]
      Go to Field [ ]
      Set Variable [ $unchanged ; Value: $$log ]
      Go to Field [ People::Name ]
      Insert Text [ People::Name ; "typed" ]
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: "validate" ]
      Go to Field [ ]
      Set Variable [ $validate ; Value: Get ( LastError ) & "/" & Get ( ActiveFieldName ) & "/" & $$log ]
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: "save" ]
      Go to Field [ ]
      Set Variable [ $save ; Value: Get ( LastError ) & "/" & Get ( ActiveFieldName ) & "/" & $$log ]
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: "" ]
      Go to Field [ ]
      Exit Script [ Text Result: $unchanged & "|" & $validate & "|" & $save & "|" & $$log & Get ( ActiveFieldName ) ]`);
    // Unchanged: only OnObjectExit. Saved once, the field isn't validated or saved again.
    assert.equal(r.result, 'exit;|20/Name/validate;|20/Name/validate;save;|exit;');
  });
});

test('Revert Record takes the cursor out of its field: OnObjectExit (no validate or save), then OnRecordRevert', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Revert Gate', text: 'Set Variable [ $$log ; Value: $$log & Get ( ScriptParameter ) & ";" ]\nExit Script [ Text Result: $$allow ≠ Get ( ScriptParameter ) ]' }]);
  await withTriggers([
    trigger('People', 'OnObjectValidate', 'Revert Gate', { parameter: '"validate"' }),
    trigger('People', 'OnObjectSave', 'Revert Gate', { parameter: '"save"' }),
    trigger('People', 'OnObjectExit', 'Revert Gate', { parameter: '"exit"' }),
  ], [trigger('People', 'OnRecordRevert', 'Revert Gate', { parameter: '"revert"' })], async () => {
    const r = await run(`
      Go to Record/Request/Page [ First ]
      Set Variable [ $$allow ; Value: "exit" ]
      Set Variable [ $was ; Value: People::Name ]
      Go to Field [ People::Name ]
      Insert Text [ Select ; People::Name ; "typed" ]
      Set Variable [ $$log ; Value: "" ]
      Revert Record/Request [ With dialog: Off ]
      Set Variable [ $kept ; Value: Get ( LastError ) & "/" & Get ( ActiveFieldName ) & "/" & People::Name & "/" & $$log ]
      Set Variable [ $$allow ; Value: "" ]
      Set Variable [ $$log ; Value: "" ]
      Revert Record/Request [ With dialog: Off ]
      Set Variable [ $reverted ; Value: Get ( LastError ) & "/" & Get ( ActiveFieldName ) & "/" & ( People::Name = $was ) & "/" & $$log ]
      Go to Field [ People::Name ]
      Set Variable [ $$log ; Value: "" ]
      Revert Record/Request [ With dialog: Off ]
      Exit Script [ Text Result: $kept & "|" & $reverted & "|" & Get ( LastError ) & "/" & Get ( ActiveFieldName ) & "/" & $$log ]`);
    // An OnObjectExit exiting False keeps the cursor and the change (error 20). Unchanged, there is nothing to revert,
    // but the cursor still leaves the field.
    assert.equal(r.result, '20/Name/typed/exit;|0//1/exit;revert;|0//exit;');
  });
});

test('Set Field in the field the cursor is in does not validate or save it on leaving: only OnObjectExit (Claris does not say it does)', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Set Gate', text: 'Set Variable [ $$log ; Value: $$log & Get ( ScriptParameter ) & ";" ]' }]);
  await withTriggers([
    trigger('People', 'OnObjectValidate', 'Set Gate', { parameter: '"validate"' }),
    trigger('People', 'OnObjectSave', 'Set Gate', { parameter: '"save"' }),
    trigger('People', 'OnObjectExit', 'Set Gate', { parameter: '"exit"' }),
    trigger('People', 'OnObjectModify', 'Set Gate', { parameter: '"modify"' }),
  ], [], async () => {
    const r = await run(`
      Go to Record/Request/Page [ First ]
      Go to Field [ People::Name ]
      Set Field [ People::Name ; "set" ]
      Set Variable [ $$log ; Value: "" ]
      Go to Field [ ]
      Exit Script [ Text Result: $$log ]`);
    assert.equal(r.result, 'exit;');
  });
});

const windowFile = (options: Record<string, unknown>) => store.applyDesign([{ op: 'setFileOptions', ...options }]);
const noWindowFile = () => windowFile({ onWindowOpen: null, onWindowClose: null });

test('OnWindowOpen runs when New Window opens a window, in it, before the layout\'s OnLayoutEnter and OnRecordLoad', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Window Open', text: 'Set Variable [ $$log ; Value: $$log & "open@" & Get ( WindowName ) & ":" & Get ( LayoutName ) & ";" ]' }]);
  windowFile({ onWindowOpen: 'Window Open' });
  await withTriggers([], [
    trigger('People', 'OnLayoutEnter', 'Note', { parameter: '"enter"' }),
    trigger('People', 'OnRecordLoad', 'Note', { parameter: '"load"' }),
  ], async () => {
    try {
      const r = await run(`
        Set Variable [ $$log ; Value: "" ]
        New Window [ "Second" ]
        Exit Script [ Text Result: $$log ]`);
      assert.equal(r.result, 'open@Second:People;enter@People:1;load@People:1;');
    } finally { noWindowFile(); }
  });
});

test('OnWindowOpen does not set itself off: a script that opens a window runs once; with the trigger removed nothing runs', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Window Opens More', text: 'Set Variable [ $$log ; Value: $$log & "open;" ]\nNew Window [ "Nested" ]' }]);
  windowFile({ onWindowOpen: 'Window Opens More' });
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      New Window [ "Second" ]
      Exit Script [ Text Result: $$log & ValueCount ( WindowNames ) ]`);
    // Once for "Second"; the window it opens runs only the layout's own triggers (OnRecordLoad, twice in all).
    assert.equal(r.result, 'open;load@People:1;load@People:1;3');
  } finally { noWindowFile(); }
  const after = await run(`
    Set Variable [ $$log ; Value: "" ]
    New Window [ "Second" ]
    Exit Script [ Text Result: $$log & ValueCount ( WindowNames ) ]`);
  assert.equal(after.result, 'load@People:1;2');
});

test('Close Window runs OnLayoutExit, then OnWindowClose; a trigger that exits False keeps the window; the script\'s only window runs nothing', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Window Close', text: 'Set Variable [ $$log ; Value: $$log & "close@" & Get ( WindowName ) & ";" ]\nExit Script [ Text Result: $$allow ]' }]);
  windowFile({ onWindowClose: 'Window Close' });
  await withTriggers([], [trigger('People', 'OnLayoutExit', 'Note', { parameter: '"exit"' })], async () => {
    try {
      const r = await run(`
        Set Error Capture [ On ]
        Set Variable [ $$log ; Value: "" ]
        Set Variable [ $$allow ; Value: False ]
        Close Window [ Current Window ]
        Set Variable [ $only ; Value: $$log & ValueCount ( WindowNames ) ]
        New Window [ "Second" ]
        Set Variable [ $$log ; Value: "" ]
        Close Window [ Current Window ]
        Set Variable [ $kept ; Value: Get ( LastError ) & "/" & Get ( WindowName ) & "/" & $$log ]
        Set Variable [ $$allow ; Value: True ]
        Set Variable [ $$log ; Value: "" ]
        Close Window [ Current Window ]
        Exit Script [ Text Result: $only & "|" & $kept & "|" & $$log & Get ( LastError ) & "/" & ValueCount ( WindowNames ) ]`);
      // Exiting False from OnWindowClose cancels the close with error 20, as the other triggers that run first do.
      assert.equal(r.result, '1|20/Second/exit@People:1;close@Second;|exit@People:1;close@Second;0/1');
    } finally { noWindowFile(); }
  });
});

test('Close Window on another window runs its OnWindowClose in that window, which can keep it open', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Window Gate', text: 'Set Variable [ $$log ; Value: $$log & "close@" & Get ( WindowName ) & ";" ]\nExit Script [ Text Result: $$allow ]' }]);
  windowFile({ onWindowClose: 'Window Gate' });
  try {
    const r = await run(`
      Set Error Capture [ On ]
      Set Variable [ $first ; Value: Get ( WindowName ) ]
      New Window [ "Second" ]
      Set Variable [ $$log ; Value: "" ]
      Set Variable [ $$allow ; Value: False ]
      Close Window [ Name: $first ]
      Set Variable [ $kept ; Value: Get ( LastError ) & "/" & ValueCount ( WindowNames ) ]
      Set Variable [ $$allow ; Value: True ]
      Close Window [ Name: $first ]
      Exit Script [ Text Result: $kept & "," & Get ( LastError ) & "/" & ValueCount ( WindowNames ) & "|" & $$log ]`);
    // The first window is named for the file.
    assert.equal(r.result, '20/2,0/1|close@T;close@T;');
  } finally { noWindowFile(); }
});

test('setFileOptions keeps OnWindowOpen and OnWindowClose in the file, and null clears them', () => {
  windowFile({ onWindowOpen: 'Window Open', onWindowClose: 'Window Gate' });
  try {
    assert.equal(store.schema.fileOptions?.onWindowOpen?.script, 'Window Open');
    assert.equal(store.schema.fileOptions?.onWindowClose?.script, 'Window Gate');
    assert.throws(() => windowFile({ onWindowOpen: 'No such script' }), /Script/);
  } finally { noWindowFile(); }
  assert.equal(store.schema.fileOptions?.onWindowOpen, undefined);
  assert.equal(store.schema.fileOptions?.onWindowClose, undefined);
});
