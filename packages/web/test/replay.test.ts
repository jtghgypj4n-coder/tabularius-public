// Time travel in the Script Debugger: reading a recorded run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeChange, fieldChanges, variablesAt, type Recording, type RecordedStep } from '../src/debugger/replay.ts';

const step = (index: number, extra: Partial<RecordedStep> = {}): RecordedStep =>
  ({ script: 'Tidy', index, line: `line ${index + 1}`, stack: [{ script: 'Tidy', index }], lastError: 0, mode: 'browse', foundCount: 2, foundSet: [1, 2], ...extra });

const rec: Recording = {
  script: 'Tidy',
  steps: [
    step(0, { variables: { locals: {}, globals: {} } }),
    step(1, { variables: { locals: { $n: '0' }, globals: {} }, edits: [{ table: 'Items', recordId: 1, field: 'Status', value: 'done' }] }),
    step(2),
    step(3, { changes: [{ table: 'Items', recordId: 1, kind: 'update', fields: [{ field: 'Status', before: 'open', after: 'done' }] }] }),
    step(4, { variables: { locals: { $n: '1' }, globals: {} }, changes: [{ table: 'Items', recordId: 3, kind: 'create', fields: [{ field: 'Name', before: '', after: 'new' }] }] }),
  ],
  done: { result: '', error: 0, halted: false, steps: 5, foundCount: 3, foundSet: [1, 2, 3] },
};

test('variables carry forward from the last step that recorded them', () => {
  assert.deepEqual(variablesAt(rec, 0).locals, {});
  assert.deepEqual(variablesAt(rec, 3).locals, { $n: '0' });
  assert.deepEqual(variablesAt(rec, 4).locals, { $n: '1' });
});

test('each field the run changed lists the steps that set, saved or created it, to jump to', () => {
  const changes = fieldChanges(rec);
  assert.deepEqual([...changes.keys()], ['Items::Name', 'Items::Status']);
  assert.deepEqual(changes.get('Items::Status')!.map((c) => [c.step, c.kind]), [[1, 'set'], [3, 'saved']]);
  assert.equal(describeChange(rec, changes.get('Items::Status')![1]), 'Run step 4, line 4 of Tidy: saved record 1, "open" → "done"');
  assert.equal(describeChange(rec, changes.get('Items::Name')![0]), 'Run step 5, line 5 of Tidy: created record 3 with "new"');
});
