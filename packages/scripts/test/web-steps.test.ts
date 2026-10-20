import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, stepLine, type Script, type LayoutObject, WEB_VIEWER_ACTIONS } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-web-steps-'));
  createStore(join(dir, 'W.sqlite'));
  store = new Store(join(dir, 'W.sqlite'), 'W');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] },
    { op: 'createScript', name: 'Tick', text: 'Exit Script [ Text Result: 1 ]' },
  ]);
  store.create('Items', { Name: 'one' });
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Repeated', options: { repetitions: 3 } }]);
  const design = store.design('Items')!;
  const field = design.objects.find((o) => o.kind === 'field' && o.field?.field === 'Name')!;
  const repeated = design.objects.find((o) => o.field?.field === 'Repeated')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: [
    { ...field, name: 'name', hide: { formula: '1' } },
    { ...repeated, name: 'repeated' },
    { ...field, id: 900, name: 'viewer', kind: 'web-viewer', field: undefined, webUrl: '"data:text/html,A"' },
    { ...field, id: 901, name: 'portal', kind: 'portal', field: undefined, portal: { tableOccurrence: 'Items', tableOccurrenceId: 1, rows: 3, initialRow: 1 }, children: [] },
  ] as LayoutObject[] } }]);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const parse = (text: string) => parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params }));
const run = (text: string, opts: RunOptions = {}) => runScript(store, { id: 9999, name: 'test', steps: parse(text) } as Script, { layout: 'Items', ...opts });

test('legacy Data API text replaces an existing variable on execution', async () => {
  const request = '"{\\"layouts\\":\\"Items\\",\\"query\\":[]}"';
  for (const [option, prefix] of [['', '{'], ['Select: Off ; ', 'old{']]) {
    const r = await run(`Set Variable [ $r ; Value: "old" ]\nExecute FileMaker Data API [ ${option}Target: $r ; ${request} ]\nExit Script [ Result: $r ]`);
    assert.equal(r.error, 0);
    assert.ok(String(r.result).startsWith(prefix), String(r.result));
  }
});

test('Perform JavaScript in Web Viewer: the window gets the function and its parameters, worked out', async () => {
  const text = 'Perform JavaScript in Web Viewer [ Object Name: "chart" ; Function Name: "show" & "Data" ; Parameters: Items::Name, "a, b", 1 + 2 ]';
  const [step] = parse(text);
  assert.deepEqual(step.params, { objectName: '"chart"', functionName: '"show" & "Data"', jsParameters: ['Items::Name', '"a, b"', '1 + 2'] });
  assert.equal(stepLine(step.name, step.params), text);
  const r = await run(text);
  assert.equal(r.error, 0);
  assert.deepEqual(r.actions, [{ step: 'Perform JavaScript in Web Viewer', script: 'test', layoutId: store.layout('Items').layoutId, recordId: 1, objectName: 'chart', functionName: 'showData', parameters: ['one', 'a, b', '3'] }]);
});

test('Install OnTimer Script: the script, interval and parameter formula for the window; no script stops it', async () => {
  const r = await run('Set Variable [ $s ; Value: 2 ]\nInstall OnTimer Script [ “Tick” ; Parameter: Get ( RecordNumber ) ; Interval: $s / 4 ]');
  const id = store.schema.scripts.find((s) => s.name === 'Tick')!.id;
  assert.deepEqual(r.actions, [{ step: 'Install OnTimer Script', script: 'test', interval: 0.5, timerScriptId: id, timerScript: 'Tick', parameter: 'Get ( RecordNumber )' }]);
  assert.deepEqual((await run('Install OnTimer Script')).actions, [{ step: 'Install OnTimer Script', script: 'test', interval: 0 }]);
  assert.deepEqual((await run('Install OnTimer Script [ “Tick” ; Interval: 0 ]')).actions, [{ step: 'Install OnTimer Script', script: 'test', interval: 0 }]);
});


test('refresh parameters and viewer actions round-trip formulas without normalizing absent repetition', () => {
  const lines = [
    'Refresh Window', 'Refresh Window [ Flush cached join results ]',
    'Refresh Window [ Flush cached external data ]', 'Refresh Window [ Flush cached join results ; Flush cached external data ]',
    'Refresh Portal', 'Refresh Portal [ Object Name: "port" & "al" ]',
    'Refresh Object [ Object Name: "name" ]', 'Refresh Object [ Object Name: "repeated" ; Repetition: 1 ]',
    'Refresh Object [ Object Name: "repeated" ; Repetition: 1 - 1 ]',
    ...WEB_VIEWER_ACTIONS.map((action) => `Set Web Viewer [ Object Name: "view" & "er" ; ${action === 'Go to URL' ? 'URL: "data:text/html," & Items::Name' : action} ]`),
  ];
  for (const line of lines) {
    const [s] = parse(line);
    assert.equal(stepLine(s.name, s.params), line);
    assert.deepEqual(parse(stepLine(s.name, s.params))[0].params, s.params);
  }
  assert.equal(parse(lines[6])[0].params!.objectRepetition, undefined);
  assert.equal(parse(lines[7])[0].params!.objectRepetition, '1');
  assert.equal(parse(lines[8])[0].params!.objectRepetition, '1 - 1');
});

test('refresh resolves hidden objects, scopes actions, and evaluates repetition once without commit or focus changes', async () => {
  const name = store.design('Items')!.objects.find((o) => o.name === 'name')!;
  const states: string[] = [];
  const r = await run('Set Field [ Items::Name ; "pending" ]\nRefresh Object [ Object Name: "na" & "me" ; Repetition: 1 ]\nRevert Record/Request [ With dialog: Off ]', {
    startWindow: { id: 'window', name: 'Window' }, foundSet: [1], recordId: 1,
    checkpoint: async (request) => {
      assert.equal(store.row(store.layout('Items'), 1).Name, 'one');
      assert.equal(request.pending.Name, 'pending');
      assert.deepEqual(request.state.foundSet, [1]);
      assert.equal(request.state.active, undefined);
      assert.equal(request.state.window?.id, 'window');
      states.push(request.state.layout!);
    },
  });
  assert.equal(r.error, 0);
  assert.deepEqual(states, ['Items']);
  assert.deepEqual(r.actions, [{ step: 'Refresh Object', script: 'test', windowId: 'window', layoutId: store.layout('Items').layoutId, recordId: 1, objectId: name.id, objectName: 'name', repetition: 1 }]);
  assert.equal(store.get('Items', 1).fieldData.Name, 'one');
  assert.equal(r.active, undefined);
  assert.deepEqual(r.foundSet, [1]);
});

test('Refresh Portal uses active object identity and delegates nonportals without moving focus', async () => {
  const r = await run('Go to Object [ "portal" ]\nRefresh Portal\nGo to Object [ "name" ]\nRefresh Portal');
  assert.equal(r.error, 0);
  assert.equal(r.actions[1].step, 'Refresh Portal');
  assert.equal(r.actions[1].objectId, 901);
  assert.equal(r.actions[3].step, 'Refresh Object');
  assert.equal(r.actions[3].objectName, 'name');
  const active = await run('Refresh Portal', { activeObjectId: 901 });
  assert.equal(active.error, 0);
  assert.equal(active.actions[0].objectId, 901);
  assert.equal(active.active, undefined);
});

test('refresh validation reports missing objects, invalid repetitions, and viewers of the wrong kind', async () => {
  for (const [line, error] of [
    ['Refresh Portal', 116], ['Refresh Object [ Object Name: "missing" ]', 116],
    ['Refresh Object [ Object Name: "repeated" ; Repetition: -1 ]', 5],
    ['Refresh Object [ Object Name: "repeated" ; Repetition: 4 ]', 5],
    ['Set Web Viewer [ Object Name: "name" ; Reset ]', 116],
    ['Set Web Viewer [ Object Name: "viewer" ]', 5],
  ] as const) {
    const r = await run(line);
    assert.equal(r.error, error, line);
    assert.deepEqual(r.actions, [], line);
  }
  const absent = await run('Refresh Object [ Object Name: "repeated" ]');
  const zero = await run('Refresh Object [ Object Name: "repeated" ; Repetition: 1 - 1 ]');
  assert.equal(absent.actions[0].repetition, undefined);
  assert.equal(zero.actions[0].repetition, 0);
});

test('automatic checkpoints preserve viewer/JavaScript order and the layout at the action point', async () => {
  const checkpoints: { name: string; layout: string; actions: number }[] = [];
  const r = await run('Set Web Viewer [ Object Name: "viewer" ; URL: "data:text/html," & Items::Name ]\nPerform JavaScript in Web Viewer [ Object Name: "viewer" ; Function Name: "show" ]\nRefresh Window [ Flush cached join results ; Flush cached external data ]\nGo to Layout [ “Items” ]', {
    checkpoint: async (request) => { checkpoints.push({ name: request.actions.at(-1)!.step, layout: request.state.layout!, actions: request.actions.length }); },
  });
  assert.equal(r.error, 0);
  assert.deepEqual(checkpoints, [
    { name: 'Set Web Viewer', layout: 'Items', actions: 1 },
    { name: 'Perform JavaScript in Web Viewer', layout: 'Items', actions: 2 },
    { name: 'Refresh Window', layout: 'Items', actions: 3 },
  ]);
  assert.equal(r.actions[0].action, 'Go to URL');
  assert.equal(r.actions[0].url, 'data:text/html,one');
  assert.equal(r.actions[2].flushJoinResults, true);
  assert.equal(r.actions[2].flushExternalData, true);
});

test('imported refresh/viewer options fail explicitly before an omitted option can change the target or repetitions', async () => {
  for (const [stepId, option] of [[80, 'binary Refresh Window flush flags'], [180, 'binary Refresh Portal object name'],
    [167, 'binary Refresh Object repetition'], [146, 'binary Set Web Viewer action']] as const) {
    let acknowledged = false;
    const r = await runScript(store, { id: 9999, name: 'imported', steps: [{ stepId, name: scriptStepName(stepId), enabled: true,
      params: { objectName: '"repeated"', unsupportedOptions: [option] } }] } as Script,
    { layout: 'Items', activeObjectId: 901, checkpoint: async () => { acknowledged = true; } });
    assert.equal(r.error, 3);
    assert.match(r.warnings![0], /Unsupported imported options/);
    assert.ok(r.warnings![0].includes(option));
    assert.deepEqual(r.actions, []);
    assert.equal(acknowledged, false);
  }
});

test('unsupported imported-option warnings survive a later step clearing LastError', async () => {
  const steps = [{ stepId: 80, name: 'Refresh Window', enabled: true, params: { unsupportedOptions: ['binary Refresh Window flush flags'] } }, ...parse('Set Variable [ $done ; Value: 1 ]')];
  const r = await runScript(store, { id: 9999, name: 'imported', steps } as Script, { layout: 'Items' });
  assert.equal(r.error, 0);
  assert.deepEqual(r.warnings, ['Unsupported imported options: binary Refresh Window flush flags']);
  assert.deepEqual(r.actions, []);
});
