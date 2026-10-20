import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftsReplaced, ScriptTabs } from '../src/design/script-tabs.ts';

test('script tabs open beside the one shown, drop deleted scripts, and close to a neighbour', () => {
  const t = new ScriptTabs();
  const all = new Set([1, 2, 3, 4]);
  const exists = (id: number) => all.has(id);
  assert.deepEqual(t.shown(exists, 1), [1]);
  assert.deepEqual(t.shown(exists, 2, 1), [1, 2]);
  // Opened from the first tab: it goes beside it, as FileMaker does.
  assert.deepEqual(t.shown(exists, 3, 1), [1, 3, 2]);
  all.delete(3);
  assert.deepEqual(t.shown(exists, 2, 3), [1, 2]);
  assert.equal(t.close(2), 1);
  assert.equal(t.close(1), undefined);
});

test('a tab keeps its unsaved steps, and a save made meanwhile merges into them', () => {
  const t = new ScriptTabs();
  t.edit(1, 'a\nB\nc', 'a\nb\nc');
  assert.ok(t.drafts.has(1));
  assert.deepEqual(t.restore(1, 'a\nb\nc'), { text: 'a\nB\nc', conflicts: 0, merged: false });
  // Someone saved line 3 meanwhile: both changes are there.
  const r = t.restore(1, 'a\nb\nC');
  assert.equal(r?.text, 'a\nB\nC');
  assert.equal(r?.merged, true);
  assert.equal(t.drafts.get(1)?.base, 'a\nb\nC');
  // Back to the saved text: nothing unsaved.
  t.edit(1, 'x', 'x');
  assert.equal(t.restore(1, 'x'), undefined);
  // Closing a tab drops its steps.
  t.edit(2, 'y', 'z');
  t.shown(() => true, 2);
  t.close(2);
  assert.equal(t.drafts.has(2), false);
});

test('closing every tab opens none for the default script; a deleted script hands back its unsaved steps', () => {
  const t = new ScriptTabs();
  t.shown(() => true, 1);
  assert.equal(t.close(1), undefined);
  assert.equal(t.closedAll, true);
  t.edit(2, 'mine', 'saved', 'Two');
  const gone: string[] = [];
  t.shown((id) => id !== 2, undefined, undefined, (d) => gone.push(`${d.name}:${d.text}`));
  assert.deepEqual(gone, ['Two:mine']);
  assert.deepEqual(t.open, []);
});

test('a change that gives a script new steps, or deletes it, is caught when that script has unsaved steps', () => {
  const t = new ScriptTabs();
  t.edit(1, 'mine', 'saved');
  t.edit(3, 'mine', 'saved');
  assert.deepEqual(draftsReplaced([{ op: 'updateScript', script: 1, text: 'theirs' }, { op: 'updateScript', script: 2, text: 'x' }], t.drafts), [1]);
  assert.deepEqual(draftsReplaced([{ op: 'updateScript', script: 1, name: 'Renamed' }], t.drafts), []);
  assert.deepEqual(draftsReplaced([{ op: 'deleteScript', script: 3 }], t.drafts), [3]);
});
