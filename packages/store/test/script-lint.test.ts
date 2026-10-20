// The script linter finds loops that never end and guards that don't catch
// what they seem to; these shapes come from real solutions' stalled scripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Schema } from '../../fmp12/src/index.ts';
import { createStore, lintScript, parseScriptText, Store } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-lint-'));
createStore(join(dir, 'L.sqlite'));
const store = new Store(join(dir, 'L.sqlite'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const lint = (text: string, schema?: Schema) => lintScript({ steps: parseScriptText(text, store.schema) }, schema);
const rules = (text: string, schema?: Schema) => lint(text, schema).map((i) => `${i.rule}@${i.line}`);

test('Go to Record [ Next ] without "Exit after last" in a loop nothing else ends', () => {
  const issues = lint(`Loop
	Set Variable [ $id ; Value: Get ( RecordNumber ) ]
	Loop
		Go to Record/Request/Page [ Next ; Exit after last: On ]
	End Loop
	Go to Record/Request/Page [ Next ]
End Loop`);
  assert.deepEqual(issues.map((i) => [i.rule, i.severity, i.line]), [['loop-no-exit', 'error', 6]]);
  assert.match(issues[0].fix, /Exit after last: On/);
  // With it on, or with any other way out, nothing to say.
  assert.deepEqual(rules('Loop\n\tGo to Record/Request/Page [ Next ; Exit after last: On ]\nEnd Loop'), []);
  assert.deepEqual(rules('Loop\n\tGo to Record/Request/Page [ Next ]\n\tExit Loop If [ Get ( RecordNumber ) = Get ( FoundCount ) ]\nEnd Loop'), []);
  assert.deepEqual(rules('Loop\n\tIf [ $done ]\n\t\tExit Script [ Text Result: 1 ]\n\tEnd If\nEnd Loop'), []);
  // A loop that pauses waits for a person, who ends it with a button.
  assert.deepEqual(rules('Loop\n\tPause/Resume Script [ Indefinitely ]\nEnd Loop'), []);
  // A timed pause carries on by itself: a keep-alive loop with nothing that ends it never stops on the server.
  const keepAlive = lint('Loop\n\tCommit Records/Requests\n\tRefresh Window\n\tPause/Resume Script [ Duration (seconds): 60 ]\nEnd Loop');
  assert.deepEqual(keepAlive.map((i) => [i.rule, i.severity, i.line]), [['loop-no-exit', 'warning', 4]]);
  assert.match(keepAlive[0].message, /Run on the server .* it never ends/);
  // With a way out, a timed pause is fine; and other rules still look at the loop.
  assert.deepEqual(rules('Loop\n\tPause/Resume Script [ Duration (seconds): 3 ]\n\tGo to Record/Request/Page [ Next ; Exit after last: On ]\nEnd Loop'), []);
  assert.deepEqual(rules('Set Variable [ $n ; Value: ValueCount ( $list ) ]\nSet Variable [ $i ; Value: 1 ]\nLoop\n\tPause/Resume Script [ Duration (seconds): 1 ]\n\tExit Loop If [ $i = $n ]\n\tSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop'), ['count-equality@5']);
  assert.deepEqual(rules('Loop\n\tSet Variable [ $n ; Value: $n + 1 ]\nEnd Loop'), ['loop-no-exit@1']);
});

test('a counter from 1 compared with = to a count that can be 0', () => {
  // As in a real "populate sponsors" looper: ValueCount of an empty list is 0, and 0 = 1, 2, 3 … never.
  const text = `Go to Record/Request/Page [ First ]
Loop
	Set Variable [ $Luna ; Value: 1 ]
	Loop
		Set Variable [ $SponsorCount ; Value: ValueCount ( $list ) ]
		Exit Loop If [ $SponsorCount = $Luna ]
		Set Variable [ $Luna ; Value: $Luna + 1 ]
	End Loop
	Go to Record/Request/Page [ Next ; Exit after last: On ]
End Loop`;
  const issues = lint(text);
  assert.deepEqual(issues.map((i) => [i.rule, i.line]), [['count-equality', 6]]);
  assert.match(issues[0].message, /\$SponsorCount comes from ValueCount, which is 0 when there is nothing to count/);
  assert.equal(issues[0].fix, "Use Exit Loop If [ $Luna > $SponsorCount ] as the loop's first step, or end the script before the loop when $SponsorCount is 0.");
  // Checked first: fine.
  assert.deepEqual(rules(`Set Variable [ $n ; Value: Count ( Lines::id ) ]
If [ $n > 0 ]
	Set Variable [ $i ; Value: 1 ]
	Loop
		Exit Loop If [ $i = $n ]
		Set Variable [ $i ; Value: $i + 1 ]
	End Loop
End If`), []);
  // A counter from 0, or a value that isn't a count: not this problem.
  assert.deepEqual(rules('Set Variable [ $n ; Value: Get ( FoundCount ) ]\nSet Variable [ $i ; Value: 0 ]\nLoop\n\tExit Loop If [ $i = $n ]\n\tSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop'), []);
  assert.deepEqual(rules('Set Variable [ $n ; Value: 10 ]\nSet Variable [ $i ; Value: 1 ]\nLoop\n\tExit Loop If [ $i = $n ]\n\tSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop'), []);
});

test('omitting records in a loop that only ends on "Exit after last" in another branch', () => {
  const text = `Loop
	If [ Invoices::Status = "Paid" ]
		Omit Record
	Else
		Go to Record/Request/Page [ Next ; Exit after last: On ]
	End If
End Loop`;
  assert.deepEqual(rules(text), ['omit-loop@3']);
  assert.deepEqual(rules(text.replace('Loop\n', 'Loop\n\tExit Loop If [ Get ( FoundCount ) = 0 ]\n')), []);
});

test('IsValid used to ask whether there is a related record', () => {
  const text = 'If [ not IsValid ( Guests::pkGuestID ) ]\n\tExit Script [ ]\nEnd If';
  const issues = lint(text);
  assert.deepEqual(issues.map((i) => [i.rule, i.line]), [['isvalid-related', 1]]);
  assert.equal(issues[0].fix, 'Use not IsEmpty ( Guests::pkGuestID ), or Count ( Guests::pkGuestID ) > 0.');
  // On a date field IsValid still catches text typed into it.
  const schema = {
    tables: [{ id: 1, name: 'Guests', fields: [{ id: 1, name: 'pkGuestID', kind: 'normal', type: 'number', hasCalculation: false, options: { autoEnter: { serial: { next: '1', increment: 1 } } } },
      { id: 2, name: 'Arrived', kind: 'normal', type: 'date', hasCalculation: false }] }],
    tableOccurrences: [{ id: 1, name: 'Guests', baseTableId: 1 }],
  } as unknown as Schema;
  assert.deepEqual(rules(text, schema), ['isvalid-related@1']);
  assert.deepEqual(rules('If [ IsValid ( Guests::Arrived ) ]\nEnd If', schema), []);
});

test('a count that can be 0 says where it comes from', () => {
  const detail = (text: string) => lint(text).find((i) => i.rule === 'count-equality')?.detail ?? '';
  const loop = 'Set Variable [ $i ; Value: 1 ]\nLoop\n\tExit Loop If [ $i = $n ]\n\tSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop';
  // A private sample's multi-record script: the list comes in as a parameter.
  assert.match(detail(`Set Variable [ $n ; Value: ValueCount ( $Associates ) ]\n${loop}`), /^\$n is 0 when \$Associates is empty: this script never sets it before here, so it comes from the script parameter/);
  // A private sample's navigation script: a global the script sets itself from a field.
  assert.match(detail(`Set Variable [ $$List ; Value: Blocks::Types ]\nSet Variable [ $n ; Value: ValueCount ( $$List ) ]\n${loop}`), /\$\$List is empty \(the step that sets it found nothing\)/);
  assert.match(detail(`Set Variable [ $n ; Value: Count ( Guests::id ) ]\n${loop}`), /the record has no related Guests records/);
  assert.match(detail(`Set Variable [ $n ; Value: Get ( FoundCount ) ]\n${loop}`), /the found set is empty/);
  // Every rule explains itself.
  assert.ok(lint('Loop\n\tSet Variable [ $x ; Value: 1 ]\nEnd Loop')[0].detail);
});

test('Exit Loop If on variables nothing in the loop changes is the same every time round', () => {
  const issues = lint(`Set Variable [ $done ; Value: 0 ]
Loop
	Go to Record/Request/Page [ Next ]
	Commit Records/Requests [ With dialog: Off ]
	Exit Loop If [ $done or $tries > 10 ]
End Loop`);
  assert.deepEqual(issues.map((i) => [i.rule, i.severity, i.line]), [['loop-no-progress', 'warning', 5]]);
  assert.match(issues[0].message, /\$done, \$tries, which nothing in this loop changes/);
  // Any way the loop changes what the condition reads: nothing to say.
  for (const inside of [
    'Set Variable [ $done ; Value: Get ( RecordNumber ) = Get ( FoundCount ) ]',
    'Set Variable [ $tries ; Value: $tries + 1 ]',
    'Set Variable [ $x ; Value: Let ( [ $done = 1 ] ; 1 ) ]',
  ]) {
    assert.deepEqual(rules(`Loop\n\t${inside}\n\tExit Loop If [ $done or $tries > 10 ]\nEnd Loop`), [], inside);
  }
  // A condition that reads a field, a record or the clock can change without the loop setting anything.
  assert.deepEqual(rules('Loop\n\tGo to Record/Request/Page [ Next ]\n\tExit Loop If [ $done or T::Flag ]\nEnd Loop'), []);
  assert.deepEqual(rules('Loop\n\tExit Loop If [ $start + 5 < Get ( CurrentTimeUTCMilliseconds ) ]\nEnd Loop'), []);
  // A global can be set by a script the loop performs.
  if (!store.schema.scripts.some((x) => x.name === 'Check')) store.applyDesign([{ op: 'createScript', name: 'Check', text: '' }]);
  assert.deepEqual(rules('Loop\n\tPerform Script [ "Check" ]\n\tExit Loop If [ $$ready ]\nEnd Loop'), []);
  assert.deepEqual(rules('Loop\n\tGo to Record/Request/Page [ Next ]\n\tExit Loop If [ $$ready ]\nEnd Loop'), ['loop-no-progress@3']);
  // A dialog's input, or a power in the condition, is no reason to warn.
  assert.deepEqual(rules('Loop\n\tShow Custom Dialog [ "Name?" ; "Type it" ; Input 1: $answer ]\n\tExit Loop If [ not IsEmpty ( $answer ) ]\nEnd Loop'), []);
  assert.deepEqual(rules('Loop\n\tSet Variable [ $i ; Value: $i + 1 ]\n\tExit Loop If [ $i^2 > 100 ]\nEnd Loop'), []);
  // Another way out (Exit after last, Exit Script) ends it anyway.
  assert.deepEqual(rules('Loop\n\tExit Loop If [ $done ]\n\tGo to Record/Request/Page [ Next ; Exit after last: On ]\nEnd Loop'), []);
});

test('enabled unresolved options produce line-specific errors; repaired and disabled steps do not', () => {
  const text = [
    'Revert Transaction [ Undecoded options: Condition, Error code ]',
    'Set Revert Transaction on Error',
    'Import Records [ Mode: Undecoded ]',
    '// Import Records [ Mode: Undecoded ]',
    'Revert Transaction [ Condition: 0 ; Error code: 5001 ]',
    'Set Revert Transaction on Error [ Off ]',
    'Import Records [ Add ]',
    'Import Records',
  ].join('\n');
  const issues = lint(text);
  assert.deepEqual(issues.map((i) => [i.rule, i.severity, i.line]), [
    ['undecoded-options', 'error', 1], ['undecoded-options', 'error', 2], ['undecoded-options', 'error', 3],
  ]);
  assert.match(issues[0].fix, /Re-enter the intended options/);
  assert.match(issues[1].fix, /Specify On or Off explicitly/);
  assert.match(issues[2].fix, /review match fields, add-remaining, and auto-enter/);
});

test('legacy slots and unmatched calculations use the runtime refusal predicate', () => {
  assert.deepEqual(lintScript({ steps: [
    { stepId: 207, params: { slots: { 128: '0' } } },
    { stepId: 207, calculations: ['0'] },
    { stepId: 207, params: { calculation: '0', errorCode: '5001' }, calculations: ['0', '5001'] },
    { stepId: 223, params: { on: false } },
    { stepId: 35, params: { importAction: 'invalid' as 'add' } },
  ] }).map((i) => i.line), [1, 2, 5]);
});
