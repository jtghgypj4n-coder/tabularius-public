// A recorded run keeps a copy of the variables at each step where they change: a script that holds a large text
// and changes a counter every step would keep hundreds of copies of the text. The recording stops at a budget of
// characters, as it does at RECORD_STEPS, and says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { recordRun, RECORD_SNAPSHOT_CHARS } from '../src/recorder.ts';

test('a run that holds a large text and changes a variable every step stops at the snapshot budget', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-recorder-'));
  createStore(join(dir, 'T.sqlite'));
  const store = new Store(join(dir, 'T.sqlite'), 'T');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  // A text of 131,072 characters, then 600 steps that each change $n: 600 snapshots of the text would be 78 million characters.
  const steps = ['Set Variable [ $s ; Value: "0123456789abcdef" ]'];
  for (let i = 0; i < 13; i++) steps.push('Set Variable [ $s ; Value: $s & $s ]');
  steps.push('Set Variable [ $n ; Value: 0 ]');
  for (let i = 0; i < 600; i++) steps.push('Set Variable [ $n ; Value: $n + 1 ]');
  store.applyDesign([{ op: 'createScript', name: 'Grow', text: steps.join('\n') }]);
  const started = Date.now();
  const recording = await recordRun(store, 'Grow');
  assert.equal(recording.stopped, true);
  const text = 2 ** 17;
  assert.ok(recording.steps.length < 14 + 1 + 600, `recorded ${recording.steps.length} steps`);
  assert.ok(recording.steps.length * text >= RECORD_SNAPSHOT_CHARS * 0.5, 'it recorded up to the budget');
  assert.ok(Date.now() - started < 20_000);
  // What it kept is clipped as before.
  for (const step of recording.steps) for (const v of Object.values(step.variables?.locals ?? {})) assert.ok(v.length <= 501);
});
