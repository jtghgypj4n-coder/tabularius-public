import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-engine-state-'));
  createStore(join(dir, 'State.sqlite'));
  store = new Store(join(dir, 'State.sqlite'), 'State');
  store.applyDesign([
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Key', type: 'text' }, { name: 'Value', type: 'text', options: { validation: { notEmpty: true } } }] },
    { op: 'createTable', name: 'Children', fields: [{ name: 'ParentKey', type: 'text' }, { name: 'Value', type: 'text' }] },
    { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Key', right: 'ParentKey' }] },
  ]);
  store.create('Parents', { Key: 'p1', Value: 'parent-original' });
  store.create('Children', { ParentKey: 'p1', Value: 'child-original' });
});

after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  const parent = store.findIds('Parents')[0];
  const child = store.findIds('Children')[0];
  store.update('Parents', parent, { Value: 'parent-original' });
  store.update('Children', child, { Value: 'child-original' });
});

const run = (text: string, options: Parameters<typeof runScript>[2] = {}) => {
  store.applyDesign([{ op: 'createScript', name: `state-${Date.now()}-${Math.random()}`, text }]);
  const script = store.schema.scripts.at(-1)!;
  return runScript(store, script, { layout: 'Parents', foundSet: store.findIds('Parents'), ...options });
};

const read = (table: string, field: string) => store.query(`SELECT "${field}" FROM "${table}" LIMIT 1`)[0]?.[field];

test('Pause/Resume Script commits open record edits before an interactive pause', async () => {
  await run(`Set Field [ Parents::Value ; "pause-committed" ]\nPause/Resume Script`, {
    pause: async () => {
      assert.equal(read('Parents', 'Value'), 'pause-committed', 'Pause/Resume Script commits open record edits before an interactive pause');
      return true;
    },
  });
  assert.equal(read('Parents', 'Value'), 'pause-committed', 'Pause/Resume Script commits open record edits before an interactive pause');
});

test('Pause/Resume Script reverts an open record edit when its commit is refused', async () => {
  await run('Set Field [ Parents::Value ; "" ]\nPause/Resume Script\nExit Script [ Text Result: Get ( RecordOpenState ) ]', {
    pause: async () => {
      assert.equal(read('Parents', 'Value'), 'parent-original', 'Pause/Resume Script reverts an open record edit when its commit is refused');
      return true;
    },
  });
  assert.equal(read('Parents', 'Value'), 'parent-original', 'Pause/Resume Script reverts an open record edit when its commit is refused');
});

test('Pause/Resume Script without a responder or with a duration leaves record edits pending', async () => {
  const withoutResponder = await run('Set Field [ Parents::Value ; "still-pending" ]\nPause/Resume Script\nExit Script [ Text Result: Get ( RecordOpenState ) ]');
  assert.equal(withoutResponder.result, '2', 'Pause/Resume Script without a responder or with a duration leaves record edits pending');
  const timed = await run('Set Field [ Parents::Value ; "still-pending" ]\nPause/Resume Script [ Duration (seconds): 0 ]\nExit Script [ Text Result: Get ( RecordOpenState ) ]');
  assert.equal(timed.result, '2', 'Pause/Resume Script without a responder or with a duration leaves record edits pending');
});

test('Set Error Capture and Allow User Abort changes made by a subscript end when it returns', async () => {
  store.applyDesign([{ op: 'createScript', name: 'state-child-settings', text: 'Set Error Capture [ Off ]\nAllow User Abort [ Off ]' }]);
  const r = await run('Set Error Capture [ On ]\nAllow User Abort [ On ]\nPerform Script [ “state-child-settings” ]\nExit Script [ Text Result: Get ( ErrorCaptureState ) & Get ( AllowAbortState ) ]');
  assert.equal(r.result, '00', 'Set Error Capture and Allow User Abort changes made by a subscript end when it returns');
});

test('Revert Transaction drops pending field edits but keeps variables and queued client actions', async () => {
  const r = await run('Open Transaction\nSet Variable [ $kept ; Value: "yes" ]\nSet Field [ Parents::Value ; "transaction-edit" ]\nNew Record/Request\nSet Field [ Parents::Key ; "new-in-transaction" ]\nSet Field [ Parents::Value ; "new-value" ]\nFreeze Window\nRevert Transaction\nCommit Transaction\nExit Script [ Text Result: $kept & "/" & Get ( TransactionOpenState ) & "/" & Get ( RecordOpenState ) & "/" & Get ( FoundCount ) ]');
  assert.equal(r.result, 'yes/0/0/1', 'Revert Transaction drops pending field edits but keeps variables and queued client actions');
  assert.equal(read('Parents', 'Value'), 'parent-original', 'Revert Transaction drops pending field edits but keeps variables and queued client actions');
  assert.equal(store.findIds('Parents').length, 1, 'Revert Transaction drops pending field edits but keeps variables and queued client actions');
  assert.ok(r.actions.some((action) => action.step === 'Freeze Window'), 'Revert Transaction drops pending field edits but keeps variables and queued client actions');
});

test('Open Record/Request locks the current record without changing RecordOpenState', async () => {
  const r = await run('Open Record/Request\nExit Script [ Text Result: Get ( RecordOpenState ) ]');
  assert.equal(r.result, '0', 'Open Record/Request locks the current record without changing RecordOpenState');
});

test('Set Field on a related record writes immediately and Revert Record does not undo it', async () => {
  const r = await run('Set Field [ Children::Value ; "related-written" ]\nSet Variable [ $state ; Value: Get ( RecordOpenState ) ]\nRevert Record/Request [ With dialog: Off ]\nExit Script [ Text Result: $state & "/" & Get ( RecordOpenState ) ]');
  assert.equal(r.result, '0/0', 'Set Field on a related record writes immediately and Revert Record does not undo it');
  assert.equal(read('Children', 'Value'), 'related-written', 'Set Field on a related record writes immediately and Revert Record does not undo it');
});
