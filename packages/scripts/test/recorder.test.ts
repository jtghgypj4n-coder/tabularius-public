import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { ScriptEngine } from '../src/engine.ts';
import { recordRun } from '../src/recorder.ts';

function setup(t: TestContext, text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-recorder-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const store = new Store(path, 'Local');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Note' }] },
    { op: 'createScript', name: 'Run', text },
  ]);
  return store;
}

test('recording bounds full variable snapshots per call before redaction and clipping', async (t) => {
  const budget = 64 * 1024 * 1024;
  const value = 'a'.repeat(2 * 1024 * 1024);
  const store = setup(t, [
    'Set Revert Transaction on Error [ Off ]',
    'Open Transaction',
    'Set Field [ T::Note ; "changed" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Set Variable [ $payload ; Value: Get ( ScriptParameter ) ]',
    'Set Variable [ $$turn ; Value: 0 ]',
    'Loop',
    'Set Variable [ $payload ; Value: Substitute ( $payload ; If ( Mod ( $$turn ; 2 ) = 0 ; "a" ; "b" ) ; If ( Mod ( $$turn ; 2 ) = 0 ; "b" ; "a" ) ) ]',
    'Set Variable [ $$turn ; Value: $$turn + 1 ]',
    'Exit Loop If [ $$turn >= 100 ]',
    'End Loop',
    'Commit Transaction',
    'Exit Script [ Text Result: $$turn ]',
  ].join('\n'));
  const id = store.create('T', { Note: 'before' }).recordId;
  let retained = 0;
  const largestSnapshot = '$payload'.length + value.length + '$$turn'.length + 3;
  const original = ScriptEngine.prototype.redactDiagnosticValue;
  // Observe the full values at the deferred pass, without retaining copies in the test.
  t.mock.method(ScriptEngine.prototype, 'redactDiagnosticValue', function (this: ScriptEngine, raw: string, name: string) {
    if (name.startsWith('$')) retained += name.length + raw.length;
    return original.call(this, raw, name);
  });
  let firstSteps: number | undefined;
  for (let call = 0; call < 2; call++) {
    retained = 0;
    const recording = await recordRun(store, 'Run', { parameter: value, layout: 'T', recordId: id });
    assert.equal(recording.stopped, true);
    assert.equal(recording.done.halted, true);
    assert.equal(store.get('T', id).fieldData.Note, 'before', 'the budget halt reverts the open transaction');
    assert.ok(retained > budget, 'the budget counts full snapshots, including unchanged values in a changed snapshot');
    assert.ok(retained <= budget + largestSnapshot, `retained ${retained} characters`);
    const turns = recording.steps.flatMap((s) => s.variables?.globals.$$turn === undefined ? [] : [Number(s.variables.globals.$$turn)]);
    assert.ok(Math.max(...turns) < 100);
    assert.ok(Math.max(...turns) > 0);
    assert.ok(recording.steps.every((s) => !s.variables?.locals.$payload || s.variables.locals.$payload.length <= 501));
    if (firstSteps !== undefined) assert.equal(recording.steps.length, firstSteps, 'each call has a fresh budget');
    firstSteps = recording.steps.length;
  }
});

test('unchanged snapshots do not consume the retained character budget again', async (t) => {
  const store = setup(t, [
    'Set Variable [ $payload ; Value: Get ( ScriptParameter ) ]',
    ...Array.from({ length: 40 }, () => 'Set Variable [ $payload ; Value: $payload ]'),
    'Exit Script [ Text Result: Length ( $payload ) ]',
  ].join('\n'));
  const recording = await recordRun(store, 'Run', { parameter: 'a'.repeat(2 * 1024 * 1024) });
  assert.equal(recording.stopped, undefined);
  assert.equal(recording.done.halted, false);
  assert.equal(recording.done.result, String(2 * 1024 * 1024));
  assert.equal(recording.steps.filter((s) => s.variables).length, 2);
});

test('small variable recordings retain their state and finish normally', async (t) => {
  const store = setup(t, 'Set Variable [ $n ; Value: 1 ]\nSet Variable [ $$label ; Value: "ordinary" ]\nExit Script [ Text Result: $n ]');
  const recording = await recordRun(store, 'Run');
  assert.equal(recording.stopped, undefined);
  assert.equal(recording.done.result, '1');
  assert.equal(recording.steps.length, 3);
  assert.deepEqual(recording.steps.map((s) => s.variables), [
    { locals: {}, globals: {} },
    { locals: { $n: '1' }, globals: {} },
    { locals: { $n: '1' }, globals: { $$label: 'ordinary' } },
  ]);
});
