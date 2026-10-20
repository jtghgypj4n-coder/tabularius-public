// The runaway-loop guard: a loop that goes round too often or keeps adding
// records stops with a named reason, the loop's line, and the linter's
// explanation of why it can't end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript, testScripts } from '../src/index.ts';

let dir: string;
let store: Store;

async function withAdvancingClock<T>(stepMs: number, run: (advance: (ms: number) => void) => Promise<T>): Promise<T> {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => (now += stepMs);
  try {
    return await run((ms) => { now += ms; });
  } finally {
    Date.now = realNow;
  }
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-runaway-'));
  createStore(join(dir, 'R.sqlite'));
  store = new Store(join(dir, 'R.sqlite'), 'R');
  store.applyDesign([{ op: 'createTable', name: 'Issues', fields: [{ name: 'Name', type: 'text' }] }]);
  store.applyDesign([
    // A private sample's record-creating loop shape: the only exit is $i = a count, and the count is 0.
    { op: 'createScript', name: 'Create missing', text: 'Go to Layout [ “Issues” ]\nSet Variable [ $count ; Value: ValueCount ( $list ) ]\nSet Variable [ $i ; Value: 1 ]\nLoop\nNew Record/Request\nSet Field [ Issues::Name ; $i ]\nExit Loop If [ $i = $count ]\nSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop' },
    { op: 'createScript', name: 'Count to 50', text: 'Set Variable [ $i ; Value: 0 ]\nLoop\nSet Variable [ $i ; Value: $i + 1 ]\nExit Loop If [ $i ≥ 50 ]\nEnd Loop\nExit Script [ Text Result: $i ]' },
    // Beezwax's "chart active field" shape: steps through the found set by a count, and the count is 0.
    { op: 'createScript', name: 'Walk by count', text: 'Go to Layout [ “Issues” ]\nGo to Record/Request/Page [ First ]\nSet Variable [ $n ; Value: Get ( ScriptParameter ) ]\nLoop\nSet Variable [ $rows ; Value: $rows + 1 ]\nExit Loop If [ Get ( RecordNumber ) + $n > Get ( FoundCount ) ]\nGo to Record/Request/Page [ With dialog: Off; Get ( RecordNumber ) + $n ]\nEnd Loop\nExit Script [ Text Result: $rows ]' },
    { op: 'createScript', name: 'Spin', text: 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop' },
  ]);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

test('a loop that keeps adding records stops at the record limit, saying why it never ends', async () => {
  const r = await runScript(store, 'Create missing', { loopRecordLimit: 25 });
  const halt = r.actions.find((a) => a.step === 'Halt Script') as { reason?: string } | undefined;
  assert.match(halt?.reason ?? '', /^runaway loop: the loop at line 4 added 25 records without ending \(on record 25 of 25 on layout "Issues"\)\. Why: \$count comes from ValueCount, which is 0 when there is nothing to count\..* Here \$count is 0\.$/);
  assert.equal(store.findIds('Issues').length, 25);
});

test('a loop past the pass limit stops; one that ends first is untouched', async () => {
  const spin = await runScript(store, 'Spin', { loopLimit: 100 });
  const halt = spin.actions.find((a) => a.step === 'Halt Script') as { reason?: string } | undefined;
  assert.match(halt?.reason ?? '', /^runaway loop: the loop at line 1 went round 100 times without ending( \(on record 1 of \d+ on layout "Issues"\))?\. Why: Nothing in this loop ends it/);
  const ok = await runScript(store, 'Count to 50', { loopLimit: 100 });
  assert.equal(ok.result, '50');
  assert.ok(!ok.actions.some((a) => a.step === 'Halt Script'));
});

test('the step limit names the loop it stopped in', async () => {
  const r = await runScript(store, 'Spin', { maxSteps: 50 });
  const halt = r.actions.find((a) => a.step === 'Halt Script') as { reason?: string } | undefined;
  assert.match(halt?.reason ?? '', /^step limit reached( \(on record 1 of \d+ on layout "Issues"\))? in the loop at line 1, 2\d times round\. Why: Nothing in this loop ends it/);
});

test('test-scripts counts a runaway loop as stalled', async () => {
  const [r] = await testScripts(store, { scripts: ['Create missing'], loopRecordLimit: 10 });
  assert.equal(r.outcome, 'stalled');
  assert.match(r.message ?? '', /^runaway loop: the loop at line 4 added 10 records/);
});

test('a script\'s own limits stop it cleanly, however it is run, and waits for a person don\'t count', async () => {
  store.applyDesign([
    { op: 'createScript', name: 'Own steps', text: 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop' },
    { op: 'createScript', name: 'Own passes', text: 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop' },
    { op: 'createScript', name: 'Own time', text: 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop' },
    { op: 'createScript', name: 'Calls a limited one', text: 'Set Variable [ $$before ; Value: 1 ]\nPerform Script [ “Own steps” ]\nSet Variable [ $$after ; Value: 1 ]' },
    { op: 'createScript', name: 'Asks', text: 'Show Custom Dialog [ "Wait" ; "Answer when ready" ]\nExit Script [ Text Result: "answered" ]' },
  ]);
  store.applyDesign([
    { op: 'updateScript', script: 'Own steps', limits: { steps: 50 } },
    { op: 'updateScript', script: 'Own passes', limits: { loopPasses: 30 } },
    { op: 'updateScript', script: 'Own time', limits: { seconds: 1 } },
    { op: 'updateScript', script: 'Asks', limits: { seconds: 1 } },
  ]);
  const reason = (r: { actions: { step: string }[] }) => (r.actions.find((a) => a.step === 'Halt Script') as { reason?: string } | undefined)?.reason ?? '';

  const steps = await runScript(store, 'Own steps');
  assert.equal(steps.halted, true);
  assert.match(reason(steps), /^"Own steps" reached its limit of 50 steps .*in the loop at line 1/);
  assert.ok(steps.steps <= 52, String(steps.steps));

  const passes = await runScript(store, 'Own passes');
  assert.match(reason(passes), /^runaway loop: the loop at line 1 went round 30 times without ending/);

  const began = Date.now();
  // Enough steps that time, not the step limit, is what stops it, however fast the steps run.
  const time = await withAdvancingClock(1, () => runScript(store, 'Own time', { maxSteps: 100_000_000 }));
  assert.match(reason(time), /^"Own time" reached its limit of 1 seconds/);
  assert.ok(Date.now() - began < 3000);

  // A limit on a subscript stops it wherever it is performed from.
  const caller = await runScript(store, 'Calls a limited one');
  assert.match(reason(caller), /^"Own steps" reached its limit of 50 steps/);

  // Time spent waiting for someone to answer a dialog isn't the script's.
  const asks = await withAdvancingClock(1, (advance) => runScript(store, 'Asks', {
    dialog: () => {
      advance(1500);
      return Promise.resolve({ button: 1 });
    },
  }));
  assert.equal(asks.halted, false);
  assert.equal(asks.result, 'answered');

  // Taken off, the script runs to the run's own limits again.
  store.applyDesign([{ op: 'updateScript', script: 'Own steps', limits: null }]);
  assert.equal(store.schema.scripts.find((s) => s.name === 'Own steps')!.limits, undefined);
  assert.throws(() => store.applyDesign([{ op: 'updateScript', script: 'Own steps', limits: { steps: 0 } }]), /whole number from 1 up/);
  assert.throws(() => store.applyDesign([{ op: 'updateScript', script: 'Own steps', limits: { minutes: 2 } as never }]), /no "minutes" limit/);
});

test('a timed pause ends at the script\'s own time limit, and a caller\'s tighter limit names the caller', async () => {
  store.applyDesign([
    { op: 'createScript', name: 'Nap', text: 'Pause/Resume Script [ Duration (seconds): 3 ]\nExit Script [ Text Result: "woke" ]' },
    { op: 'createScript', name: 'Loose', text: 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop' },
    { op: 'createScript', name: 'Tight caller', text: 'Perform Script [ “Loose” ]' },
  ]);
  store.applyDesign([
    { op: 'updateScript', script: 'Nap', limits: { seconds: 1 } },
    { op: 'updateScript', script: 'Loose', limits: { steps: 1_000_000_000 } },
    { op: 'updateScript', script: 'Tight caller', limits: { steps: 40 } },
  ]);
  const reason = (r: { actions: { step: string }[] }) => (r.actions.find((a) => a.step === 'Halt Script') as { reason?: string } | undefined)?.reason ?? '';
  const began = Date.now();
  const nap = await withAdvancingClock(10, () => runScript(store, 'Nap'));
  assert.ok(Date.now() - began < 2000, String(Date.now() - began));
  assert.match(reason(nap), /^"Nap" reached its limit of 1 seconds/);
  const tight = await runScript(store, 'Tight caller');
  assert.match(reason(tight), /^"Tight caller" reached its limit of 40 steps/);
  assert.ok(tight.steps <= 42, String(tight.steps));
});

test('a loop that steps through the found set but never leaves its first record stops, and one that moves on is untouched', async () => {
  for (let i = 0; i < 3; i++) store.create('Issues', { Name: `n${i}` });
  const stuck = await runScript(store, 'Walk by count', { stuckLoopPasses: 40, parameter: "0" } as never);
  const halt = stuck.actions.find((a) => a.step === 'Halt Script') as { reason?: string } | undefined;
  assert.match(halt?.reason ?? '', /^runaway loop: the loop at line 4 went round 40 times without leaving its first record, though the Go to Record\/Request\/Page at line 7 should move it on/);
  const ok = await runScript(store, 'Walk by count', { stuckLoopPasses: 40, parameter: "1" } as never);
  assert.equal(ok.result, String(store.findIds('Issues').length));
  assert.ok(!ok.actions.some((a) => a.step === 'Halt Script'));
});
