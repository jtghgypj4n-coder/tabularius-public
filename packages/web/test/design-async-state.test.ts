import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeLayoutSave, acknowledgeScriptDraft, canLeaveLayout, commitReplacingScriptDrafts, findLayoutObject, pushBoundedHistory, scriptEditorTabKey } from '../src/design/async-state.ts';
import type { LayoutDesign, LayoutObject } from '../src/types.ts';

const design = (objects: LayoutObject[] = [], width = 400) => ({ id: 1, name: 'L', parts: [], style: {}, objects, width }) as LayoutDesign;
const obj = (id: number) => ({ id, kind: 'web-viewer', type: 13, bounds: { left: 0, top: 0, right: 10, bottom: 10 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {} }) as LayoutObject;

test('layout save acknowledges its submitted revision while edits made pending stay dirty', () => {
  const submitted = design([obj(1)], 400);
  const current = design([obj(1)], 500);
  const accepted = design([obj(1)], 400);
  const result = acknowledgeLayoutSave(current, submitted, accepted);
  assert.equal(result.design, current);
  assert.equal(result.saved, JSON.stringify(accepted));
  assert.notEqual(JSON.stringify(result.design), result.saved);
  const unchanged = acknowledgeLayoutSave(submitted, submitted, accepted);
  assert.deepEqual(unchanged.design, accepted);
});

test('script save keeps a newer editor draft and only deletes an acknowledged draft', () => {
  const drafts = new Map([[9, { text: '# B', base: '# saved' }]]);
  assert.deepEqual(acknowledgeScriptDraft(drafts, 9, '# A', '# B', '# A'), { text: '# B', base: '# A' });
  assert.deepEqual(drafts.get(9), { text: '# B', base: '# A' });
  assert.equal(acknowledgeScriptDraft(drafts, 9, '# B', '# B', '# B'), undefined);
  assert.equal(drafts.has(9), false);
});

test('failed apply keeps other-tab drafts; successful replacement removes only the confirmed revision', async () => {
  const drafts = new Map([[9, { text: 'draft', base: 'saved' }]]);
  const before = new Map([[9, drafts.get(9)]]);
  await assert.rejects(commitReplacingScriptDrafts(drafts, [9], async () => { throw new Error('rejected'); }, () => ''), /rejected/);
  assert.equal(drafts.has(9), true);
  assert.equal(drafts.get(9), before.get(9));
  await commitReplacingScriptDrafts(drafts, [9], async () => ({ text: 'replacement' }), (r) => r.text);
  assert.equal(drafts.has(9), false);
  drafts.set(9, { text: 'draft', base: 'saved' });
  let finish!: (value: { text: string }) => void;
  const pending = commitReplacingScriptDrafts(drafts, [9], () => new Promise<{ text: string }>((resolve) => { finish = resolve; }), (r) => r.text);
  drafts.set(9, { text: 'newer edit', base: 'saved' });
  finish({ text: 'replacement' });
  await pending;
  assert.deepEqual(drafts.get(9), { text: 'newer edit', base: 'replacement' });
});

test('layout navigation requires a confirmed discard and undo history stays bounded', () => {
  assert.equal(canLeaveLayout(false, false), true);
  assert.equal(canLeaveLayout(true, false), false);
  assert.equal(canLeaveLayout(true, true), true);
  const history: string[] = [];
  for (let i = 0; i < 205; i++) pushBoundedHistory(history, String(i), 200);
  assert.equal(history.length, 200);
  assert.equal(history[0], '5');
  assert.equal(history[199], '204');
});

test('toolbar target lookup follows the current layout object after undo replaces the tree', () => {
  const before = [obj(7)];
  const afterUndo = structuredClone(before);
  const resolved = findLayoutObject(afterUndo, 7);
  assert.equal(resolved, afterUndo[0]);
  assert.notEqual(resolved, before[0]);
  assert.equal(findLayoutObject(afterUndo, 8), undefined);
});

test('script editor has a keyboard route out and preserves Tab indentation', () => {
  assert.equal(scriptEditorTabKey({ key: 'Tab', shiftKey: false, escaped: false }), 'indent');
  assert.equal(scriptEditorTabKey({ key: 'Tab', shiftKey: false, escaped: true }), 'leave');
  assert.equal(scriptEditorTabKey({ key: 'Tab', shiftKey: true, escaped: false }), 'leave');
});
