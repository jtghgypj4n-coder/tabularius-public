// Refactor hints: branches that never run, steps nothing reaches, repeated runs of steps, a script written out
// again, the slow loop shapes, and where the profiler says the time goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, refactorHints, Store, type StepTime } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-refactor-'));
createStore(join(dir, 'R.sqlite'));
const store = new Store(join(dir, 'R.sqlite'));
store.applyDesign([
  { op: 'createTable', name: 'Orders', fields: [{ name: 'Status' }, { name: 'Total', type: 'number' }] },
  { op: 'createScript', name: 'Tidy', text: 'Set Field [ Orders::Status ; "open" ]\nSet Field [ Orders::Total ; 0 ]\nCommit Records/Requests [ With dialog: Off ]' },
]);
test.after(() => rmSync(dir, { recursive: true, force: true }));

const hints = (text: string, profile?: StepTime[]) => refactorHints({ name: 'Mine', steps: parseScriptText(text, store.schema) }, store.schema, profile);
const kinds = (text: string, profile?: StepTime[]) => hints(text, profile).map((h) => `${h.kind}@${h.line}-${h.endLine}`);

test('a branch that is always false, and the ones after a branch that always runs', () => {
  assert.deepEqual(kinds(`If [ 0 ]
	Beep
Else If [ $x ]
	Beep
End If
If [ 1 ]
	Beep
Else
	Beep
	Beep
End If`), ['dead-branch@1-2', 'dead-branch@8-10']);
  // Real conditions: nothing to say.
  assert.deepEqual(kinds('If [ $x ]\n\tBeep\nElse\n\tBeep\nEnd If'), []);
});

test('steps after Exit Script in the same block', () => {
  assert.deepEqual(kinds(`If [ $x ]
	Exit Script [ Text Result: 1 ]
	Beep
	Beep
End If
Beep`), ['unreachable@3-4']);
  // A comment or a disabled step after it isn't flagged.
  assert.deepEqual(kinds('Exit Script [ Text Result: 1 ]\n# done'), []);
});

test('a run of steps written twice becomes one subscript; the whole of another script becomes Perform Script', () => {
  const run = 'Go to Layout [ "Orders" ]\nSet Field [ Orders::Status ; "late" ]\nCommit Records/Requests [ With dialog: Off ]';
  const h = hints(`${run}\nBeep\n${run}`);
  assert.deepEqual(h.map((x) => `${x.kind}@${x.line}-${x.endLine}`), ['repeated@5-7']);
  assert.match(h[0].message, /lines 1–3/);
  // Runs of Set Variable alone are how scripts start; not worth a subscript.
  assert.deepEqual(kinds('Set Variable [ $a ; 1 ]\nSet Variable [ $b ; 2 ]\nSet Variable [ $c ; 3 ]\nBeep\nSet Variable [ $a ; 1 ]\nSet Variable [ $b ; 2 ]\nSet Variable [ $c ; 3 ]'), []);
  const same = hints('Beep\nSet Field [ Orders::Status ; "open" ]\nSet Field [ Orders::Total ; 0 ]\nCommit Records/Requests [ With dialog: Off ]');
  assert.deepEqual(same.map((x) => `${x.kind}@${x.line}-${x.endLine}`), ['same-as-script@2-4']);
  assert.match(same[0].fix, /Perform Script \[ “Tidy” \]/);
});

test('slow loop shapes: a field set a record at a time, a find or a commit on every pass', () => {
  const loop = hints(`Go to Record/Request/Page [ First ]
Loop
	Set Field [ Orders::Status ; "done" ]
	Commit Records/Requests [ With dialog: Off ]
	Go to Record/Request/Page [ Next ; Exit after last: On ]
End Loop`);
  assert.deepEqual(loop.map((x) => `${x.kind}@${x.line}-${x.endLine}`), ['record-loop@2-6', 'commit-in-loop@4-4']);
  assert.match(loop[0].fix, /Replace Field Contents \[ With dialog: Off ; Orders::Status ; "done" \]/);
  assert.deepEqual(kinds(`Loop
	Perform Find [ Restore ]
	Exit Loop If [ $i > 3 ]
End Loop`), ['find-in-loop@2-2']);
});

test('the profiler: a step taking a quarter of the time or more, once there is enough time to go on', () => {
  const text = 'Beep\nPerform Find [ Restore ]\nBeep';
  assert.deepEqual(kinds(text, [{ index: 0, ms: 5, runs: 1 }, { index: 1, ms: 300, runs: 4 }, { index: 2, ms: 5, runs: 1 }]), ['slow-step@2-2']);
  assert.match(hints(text, [{ index: 1, ms: 300, runs: 4 }])[0].message, /100% .*300 ms in all, run 4 times/);
  assert.deepEqual(kinds(text, [{ index: 1, ms: 20, runs: 1 }]), []);
});

test('five or more disabled steps', () => {
  assert.deepEqual(kinds('Beep\n' + Array.from({ length: 5 }, () => '// Beep').join('\n')), ['disabled@2-6']);
  assert.deepEqual(kinds('// Beep\n// Beep'), []);
});
