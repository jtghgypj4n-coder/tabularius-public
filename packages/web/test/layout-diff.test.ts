import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeSummary, changedIds, layoutChanges, layoutVersions } from '../src/design/layout-diff.ts';
import type { LayoutDesign, LayoutObject } from '../src/types.ts';

const obj = (id: number, left: number, extra: Partial<LayoutObject> = {}): LayoutObject =>
  ({ id, kind: 'text', type: 1, text: `T${id}`, bounds: { left, top: 10, right: left + 50, bottom: 30 }, style: {}, ...extra }) as LayoutObject;
const design = (objects: LayoutObject[], extra: Partial<LayoutDesign> = {}): LayoutDesign =>
  ({ id: 1, name: 'L', style: {}, parts: [{ kind: 'body', top: 0, height: 200 }], objects, ...extra }) as LayoutDesign;
const name = (o: LayoutObject) => o.text ?? String(o.id);

test('layout changes: added, removed, moved, resized, restyled and layout settings', () => {
  const a = design([obj(1, 0), obj(2, 100), obj(3, 200), obj(4, 300)]);
  const b = design([obj(1, 10), { ...obj(2, 100), bounds: { left: 100, top: 10, right: 180, bottom: 30 } }, obj(3, 200, { text: 'New text' }), obj(5, 400)], { width: 800, saveRecordChanges: false });
  assert.deepEqual(layoutChanges(a, b, name), [
    'Added T5',
    'Removed T4',
    'Moved T1',
    'Resized T2',
    'Changed text of New text',
    'Changed the layout\'s width, saving changes',
  ]);
  assert.deepEqual(layoutChanges(a, a, name), []);
  assert.equal(changeSummary(['A', 'B', 'C']), 'A (+2 more)');
  // Many objects changed the same way share a line.
  const moved = design(a.objects.map((o) => ({ ...o, bounds: { ...o.bounds, left: o.bounds.left + 5, right: o.bounds.right + 5 } })));
  assert.deepEqual(layoutChanges(a, moved, name), ['Moved 4 objects']);
});

test('layout changes name fixed margins and responsive settings', () => {
  const a = design([], { fixedMargins: { top: 36, left: 36, bottom: 36, right: 36 }, responsive: { stackBelow: 640 } } as Partial<LayoutDesign>);
  const b = design([], { fixedMargins: { top: 18, left: 18, bottom: 18, right: 18 }, responsive: { stackBelow: 720 } } as Partial<LayoutDesign>);
  assert.deepEqual(layoutChanges(a, b, name), ["Changed the layout's fixed margins, responsive layout"]);
});

test('layout versions: saves of one layout, partial changes merged over the version before', () => {
  const full = design([obj(1, 0)]);
  const versions = layoutVersions([
    { seq: 1, at: '2026-10-12T10:00:00Z', account: 'Admin', op: { op: 'updateLayout', layout: 1, design: { menuSetId: 3 } } },
    { seq: 2, at: '2026-10-12T10:01:00Z', account: 'Admin', op: { op: 'updateLayout', layout: 1, design: full } },
    { seq: 3, at: '2026-10-12T10:02:00Z', account: null, op: { op: 'updateLayout', layout: 2, design: full } },
    { seq: 4, at: '2026-10-12T10:03:00Z', account: 'AI', op: { op: 'updateLayout', layout: 1, design: { width: 900 } } },
    { seq: 5, at: '2026-10-12T10:04:00Z', account: 'Admin', op: { op: 'createTable', name: 'X' } },
  ], 1);
  assert.deepEqual(versions.map((v) => v.seq), [2, 4]);
  assert.equal(versions[1].design.width, 900);
  assert.equal(versions[1].design.objects.length, 1);
});

test('equal spacing: a box snaps to the gap its row neighbours already have', async () => {
  const { equalSpacing } = await import('../src/design/guides.ts');
  const b = (left: number, right: number, top = 0, bottom = 20) => ({ left, right, top, bottom });
  // Two boxes 20 apart; a third dragged to 135 snaps to 140 (20 after the second).
  const s = equalSpacing(b(135, 175), [b(0, 50), b(70, 120)], true, 8);
  assert.equal(s?.d, 5);
  assert.deepEqual(s?.gaps, [{ across: true, from: 50, to: 70, at: 10 }, { across: true, from: 120, to: 140, at: 10 }]);
  // Too far, or in another row: no snap.
  assert.equal(equalSpacing(b(160, 200), [b(0, 50), b(70, 120)], true, 8), undefined);
  assert.equal(equalSpacing(b(135, 175, 100, 120), [b(0, 50), b(70, 120)], true, 8), undefined);
  // Columns work the same way.
  assert.equal(equalSpacing(b(0, 50, 63, 83), [b(0, 50, 0, 20), b(0, 50, 30, 50)], false, 8)?.d, -3);
});

test('changedIds marks added, removed and changed objects, not parents of changed children', () => {
  const o = (id: number, left: number, children?: unknown[]) => ({ id, kind: 'field', bounds: { left, top: 0, right: left + 10, bottom: 10 }, ...(children ? { children } : {}) });
  const a = { parts: [], objects: [o(1, 0), o(2, 0), o(3, 0, [o(4, 0)])] } as never;
  const b = { parts: [], objects: [o(1, 5), o(3, 0, [o(4, 9)]), o(5, 0)] } as never;
  assert.deepEqual(changedIds(a, b), { added: [5], removed: [2], changed: [1, 4] });
});
