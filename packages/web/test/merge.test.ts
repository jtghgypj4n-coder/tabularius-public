import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDesign, mergeText } from '../src/design/merge.ts';
import type { LayoutDesign, LayoutObject } from '../src/types.ts';

const o = (id: number, left = 0, more: Partial<LayoutObject> = {}) => ({ id, kind: 'text', bounds: { left, top: 0, right: left + 10, bottom: 10 }, ...more }) as LayoutObject;
const d = (objects: LayoutObject[], more: Partial<LayoutDesign> = {}) => ({ id: 1, name: 'L', parts: [], style: {}, objects, ...more }) as LayoutDesign;

test('each side keeps what only it changed', () => {
  const base = d([o(1), o(2), o(3)], { width: 400 });
  const mine = d([o(1, 50), o(2), o(3)], { width: 400 });
  const theirs = d([o(1), o(2, 70), o(3)], { width: 600 });
  const r = mergeDesign(base, mine, theirs);
  assert.equal(r.conflicts, 0);
  assert.equal(r.design.width, 600);
  assert.deepEqual(r.design.objects.map((x) => [x.id, x.bounds.left]), [[1, 50], [2, 70], [3, 0]]);
});

test('both changing one object keeps mine and counts a conflict', () => {
  const base = d([o(1)]);
  const r = mergeDesign(base, d([o(1, 5)]), d([o(1, 9)]));
  assert.equal(r.conflicts, 1);
  assert.equal(r.design.objects[0].bounds.left, 5);
});

test('deletes: an untouched object goes, a changed one stays', () => {
  const base = d([o(1), o(2)]);
  const r = mergeDesign(base, d([o(1, 5)]), d([o(2)]));
  assert.deepEqual(r.design.objects.map((x) => x.id).sort(), [1]);
  assert.equal(r.conflicts, 2 - 1);
});

test('objects both sides added with the same id: mine are renumbered, nested ones too', () => {
  const base = d([o(1)]);
  const mine = d([o(1), o(2, 0, { kind: 'group', children: [o(3)] })]);
  const theirs = d([o(1), o(2, 99), o(3, 99)]);
  const r = mergeDesign(base, mine, theirs);
  const all = r.design.objects.flatMap((x) => [x.id, ...(x.children ?? []).map((c) => c.id)]);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(r.design.objects.map((x) => x.kind), ['text', 'text', 'text', 'group']);
});

test('script text: lines each side changed both land', () => {
  const base = ['Go to Layout [ "A" ]', 'Show All Records', 'Sort Records [ Restore ]', 'Exit Script'].join('\n');
  const mine = ['Go to Layout [ "A" ]', 'Show All Records', 'Sort Records [ Restore ; With dialog: Off ]', 'Exit Script'].join('\n');
  const theirs = ['# Opens the list', 'Go to Layout [ "A" ]', 'Show All Records', 'Sort Records [ Restore ]', 'Commit Records/Requests', 'Exit Script'].join('\n');
  const { text, conflicts } = mergeText(base, mine, theirs);
  assert.equal(conflicts, 0);
  assert.equal(text, ['# Opens the list', 'Go to Layout [ "A" ]', 'Show All Records', 'Sort Records [ Restore ; With dialog: Off ]', 'Commit Records/Requests', 'Exit Script'].join('\n'));
});

test('script text: the same line changed both ways keeps mine', () => {
  const r = mergeText('a\nb\nc', 'a\nB-mine\nc', 'a\nB-theirs\nc');
  assert.deepEqual(r, { text: 'a\nB-mine\nc', conflicts: 1 });
  assert.deepEqual(mergeText('a\nb', 'a\nb\nmine', 'a\nb\nmine'), { text: 'a\nb\nmine', conflicts: 0 });
  assert.deepEqual(mergeText('a\nb', 'a\nb', 'x\nb'), { text: 'x\nb', conflicts: 0 });
  // Both appended different lines at the end: a conflict, mine kept.
  assert.deepEqual(mergeText('a', 'a\nm', 'a\nt'), { text: 'a\nm', conflicts: 1 });
});

test('clashes list each thing both changed, with both versions, and either can be put back', async () => {
  const { settleClash } = await import('../src/design/merge.ts');
  const base = d([o(1), o(2), o(3)], { width: 400 });
  const mine = d([o(1, 5), o(3, 7)], { width: 500 });
  const theirs = d([o(1, 9), o(2, 8)], { width: 600 });
  const r = mergeDesign(base, mine, theirs);
  assert.equal(r.conflicts, r.clashes.length);
  const by = (id: string | number) => r.clashes.find((c) => c.id === id)!;
  // The width: both changed it, mine kept.
  assert.deepEqual([by('width').what, by('width').mine, by('width').theirs, r.design.width], ['setting', 500, 600, 500]);
  // Object 1 both moved; 2 I deleted and they moved (theirs stays); 3 they deleted and I moved (mine stays).
  assert.equal((by(1).theirs as LayoutObject).bounds.left, 9);
  assert.deepEqual([by(2).mine, by(2).kept], [undefined, 'theirs']);
  assert.equal(by(3).theirs, undefined);
  let design = r.design;
  for (const c of r.clashes) design = settleClash(design, c, 'theirs');
  // Taking theirs everywhere gives their save.
  assert.equal(design.width, 600);
  assert.deepEqual(design.objects.map((x) => [x.id, x.bounds.left]).sort(), [[1, 9], [2, 8]]);
  // Keeping mine for the one I deleted deletes it again.
  assert.deepEqual(settleClash(r.design, by(2), 'mine').objects.map((x) => x.id).sort(), [1, 3]);
});

test('settling a clash never duplicates an id, and picking the kept side keeps later edits', async () => {
  const { settleClash } = await import('../src/design/merge.ts');
  const base = d([o(1), o(2)]);
  const r = mergeDesign(base, d([o(1, 5), o(2)]), d([o(1, 9), o(2)]));
  const clash = r.clashes[0];
  // Edited again after the merge: Keep mine changes nothing.
  const edited = d([o(1, 6), o(2)]);
  assert.equal(settleClash(edited, clash, 'mine'), edited);
  // Since grouped with 2: Take theirs leaves it rather than adding a second object 1.
  const grouped = d([o(3, 0, { kind: 'group', children: [o(1, 6), o(2)] })]);
  assert.equal(settleClash(grouped, clash, 'theirs'), grouped);
  assert.equal(settleClash(edited, clash, 'theirs').objects.find((x) => x.id === 1)!.bounds.left, 9);
});

test('merge remaps added-object references and nested collisions across the whole layout', () => {
  const base = d([]);
  const mine = d([{ ...o(1), kind: 'button', target: 2, activeSegment: 2 }, { ...o(2), kind: 'popover' } as LayoutObject], { tabOrder: [1, 2] });
  const theirs = d([o(1), o(2)], { tabOrder: [] });
  const merged = mergeDesign(base, mine, theirs).design;
  const ids = merged.objects.map((x) => x.id);
  const button = merged.objects.find((x) => x.kind === 'button')!;
  const popover = merged.objects.find((x) => x.kind === 'popover')!;
  assert.notEqual(button.id, 1);
  assert.notEqual(popover.id, 2);
  assert.equal(button.target, popover.id);
  assert.equal(button.activeSegment, popover.id);
  assert.deepEqual(merged.tabOrder, [button.id, popover.id]);
  assert.equal(new Set(ids).size, ids.length);

  const nested = mergeDesign(d([o(1, 0, { kind: 'group', children: [o(2)] })]),
    d([o(1, 0, { kind: 'group', children: [o(2), o(3)] })]),
    d([o(1, 0, { kind: 'group', children: [o(2)] }), o(3)])).design;
  const all = nested.objects.flatMap((x) => [x.id, ...(x.children ?? []).map((c) => c.id)]);
  assert.equal(new Set(all).size, all.length);
});

test('merge retains a one-sided local stacking-order change with remote layout settings', () => {
  const base = d([o(1), o(2)], { width: 400 });
  const mine = d([o(2), o(1)], { width: 400 });
  const theirs = d([o(1), o(2)], { width: 900 });
  const merged = mergeDesign(base, mine, theirs);
  assert.deepEqual(merged.design.objects.map((x) => x.id), [2, 1]);
  assert.equal(merged.design.width, 900);
  assert.equal(merged.conflicts, 0);
});
