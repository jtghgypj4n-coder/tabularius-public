// The macro recorder's clean-up (packages/server/test/macro-recorder.test.ts runs a recording end to end).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldName, literal, macroScript, tidy } from '../src/macro.ts';

test('field keys become Table::Field, with a repetition in brackets', () => {
  assert.equal(fieldName('Items', 'Name'), 'Items::Name');
  assert.equal(fieldName('Items', 'Lines::Qty'), 'Lines::Qty');
  assert.equal(fieldName('Items', 'Phone(2)'), 'Items::Phone[2]');
  assert.equal(fieldName('Items', 'Phone(1)'), 'Items::Phone');
});

test('values become calculation text: quotes and backslashes escaped, line breaks as ¶', () => {
  assert.equal(literal('a "b" \\ c\r\nd'), '"a \\"b\\" \\\\ c¶d"');
});

test('what was undone at once is dropped: a field typed over, layouts passed through, sorts and record hops re-done', () => {
  const kept = tidy([
    { kind: 'layout', layout: 'A' }, { kind: 'layout', layout: 'B' },
    { kind: 'go', to: 'next' }, { kind: 'go', to: 3 },
    { kind: 'set', occurrence: 'B', field: 'X', value: '1' }, { kind: 'set', occurrence: 'B', field: 'Y', value: '2' }, { kind: 'set', occurrence: 'B', field: 'X', value: '3' },
    { kind: 'sort', occurrence: 'B' }, { kind: 'sort', occurrence: 'B', sort: [{ fieldName: 'X', sortOrder: 'ascend' }] },
    { kind: 'showAll' }, { kind: 'quickFind', text: 'z' },
  ]);
  assert.deepEqual(kept.map((a) => a.kind), ['layout', 'go', 'set', 'set', 'sort', 'quickFind']);
  assert.deepEqual(kept.filter((a) => a.kind === 'set').map((a) => a.kind === 'set' && `${a.field}=${a.value}`), ['Y=2', 'X=3']);
});

test('the script commits before leaving the record, skips the layout it is already on, and says what it could not record', () => {
  const { text, notes } = macroScript([
    { kind: 'layout', layout: 'Items' },
    { kind: 'set', occurrence: 'Items', field: 'Status', value: 'done' },
    { kind: 'layout', layout: 'People' }, { kind: 'layout', layout: 'Items' },
    { kind: 'script', script: 'Tidy up', parameter: 'Get ( RecordID )' },
    { kind: 'layout', layout: 'Items' },
    { kind: 'find', occurrence: 'Items', requests: [{ Name: 'say “hi”' }] },
    { kind: 'sort', occurrence: 'Items' },
  ], new Date('2026-10-13T00:00:00Z'));
  assert.equal(text, [
    '# Recorded in the web client 2026-10-13 00:00 UTC',
    'Go to Layout [ “Items” ]',
    'Set Field [ Items::Status ; "done" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Perform Script [ “Tidy up” ; Parameter: Get ( RecordID ) ]',
    'Go to Layout [ “Items” ]',
    '# Not recorded: a find (its criteria have a ” in them)',
    'Unsort Records',
  ].join('\n'));
  assert.deepEqual(notes, ['a find (its criteria have a ” in them)']);
});

test('a typed ¶ stays a ¶; an only-Omit find and a parameter over several lines are left out, saying so', () => {
  assert.equal(literal('a¶b\nc'), '"a\\¶b¶c"');
  const { text, notes } = macroScript([
    { kind: 'find', occurrence: 'Items', requests: [{ Status: 'void', omit: 'true' }] },
    { kind: 'script', script: 'Tidy', parameter: 'Let ( [\n  x = 1 // one\n] ; x )' },
  ]);
  assert.match(text, /^Perform Script \[ “Tidy” \]$/m);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /only Omit/);
  assert.match(notes[1], /parameter of Tidy/);
});
