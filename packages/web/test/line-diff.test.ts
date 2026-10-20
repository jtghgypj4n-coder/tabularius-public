import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffHunks, diffSummary, lineDiff } from '../src/design/line-diff.ts';

test('a drafted script against the editor: lines added, removed and kept, in order', () => {
  const before = 'Go to Layout [ "Invoices" ]\nPerform Find [ Restore ]\nSort Records [ Restore ]\nExit Script [ Text Result: "done" ]';
  const after = 'Go to Layout [ "Invoices" ]\nSet Error Capture [ On ]\nPerform Find [ Restore ]\nExit Script [ Text Result: "done" ]';
  const d = lineDiff(before, after);
  assert.deepEqual(d.map((x) => x.kind), ['same', 'add', 'same', 'del', 'same']);
  assert.equal(d[1].text, 'Set Error Capture [ On ]');
  assert.equal(d[3].text, 'Sort Records [ Restore ]');
  assert.equal(diffSummary(d), '1 line added, 1 removed');
  assert.equal(diffSummary(lineDiff('a', 'a')), 'No changes');
  assert.equal(diffSummary(lineDiff('', 'a\nb')), '2 lines added');
  assert.equal(diffSummary(lineDiff('a\nb', 'a')), '1 line removed');
});

test('hunks keep a little context and leave out long unchanged stretches', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}`);
  const after = [...lines];
  after[2] = 'Changed 3';
  after[25] = 'Changed 26';
  const hunks = diffHunks(lineDiff(lines.join('\n'), after.join('\n')), 1);
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0].line, 2);
  assert.deepEqual(hunks[0].lines.map((l) => l.kind), ['same', 'del', 'add', 'same']);
  assert.equal(hunks[1].line, 25);
});
