import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responsiveDesign, stackBreakpoint } from '../src/responsive.ts';
import type { LayoutDesign, LayoutObject } from '../src/types.ts';

const o = (id: number, kind: string, left: number, top: number, w: number, h: number, extra: Partial<LayoutObject> = {}): LayoutObject =>
  ({ id, kind, type: 1, bounds: { left, top, right: left + w, bottom: top + h }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, ...extra }) as LayoutObject;
const layout = (objects: LayoutObject[], extra: Partial<LayoutDesign> = {}): LayoutDesign => ({
  id: 1, name: 'L', style: {}, width: 800, objects,
  parts: [{ kind: 'header', kindId: 1, top: 0, height: 40, style: {} }, { kind: 'body', kindId: 4, top: 40, height: 200, style: {} }],
  ...extra,
}) as LayoutDesign;

test('responsive: wide windows get the layout as designed', () => {
  const d = layout([o(1, 'text', 10, 10, 100, 20)], { responsive: { stackBelow: 600 } });
  assert.equal(responsiveDesign(d, 1024), d);
});

test('responsive: below the breakpoint each part stacks in one column, in reading order', () => {
  const card = o(9, 'rectangle', 10, 50, 500, 100);
  const d = layout([
    o(1, 'text', 10, 10, 200, 20), // header title
    card, // a backdrop behind the fields
    o(2, 'text', 20, 62, 80, 20), o(3, 'field', 110, 60, 300, 20), // label (a little lower), field on one row
    o(4, 'portal', 20, 100, 500, 80, { children: [o(5, 'field', 25, 105, 100, 20)] }),
  ], { responsive: { stackBelow: 600 } });
  const s = responsiveDesign(d, 400);
  assert.notEqual(s, d);
  assert.equal(d.objects.length, 5, 'the design itself is left alone');
  assert.equal(s.objects.some((x) => x.id === 9), false, 'the backdrop goes');
  const at = (id: number) => s.objects.find((x) => x.id === id)!.bounds;
  assert.deepEqual(at(1), { left: 12, top: 6, right: 212, bottom: 26 }, 'text keeps its width');
  assert.deepEqual(s.parts.map((p) => [p.kind, p.top, p.height]), [['header', 0, 32], ['body', 32, 144]]);
  // Label, then field, then the portal, one under another and as wide as the window allows.
  assert.deepEqual([at(2).top, at(3).top, at(4).top], [38, 64, 90]);
  assert.equal(at(3).right - at(3).left, 376);
  assert.equal(at(4).right - at(4).left, 376, 'a container keeps its width up to the window\'s');
  assert.deepEqual(s.objects.find((x) => x.id === 4)!.children![0].bounds, { left: 17, top: 95, right: 117, bottom: 115 }, 'what\'s inside moves with it');
});

test('responsive: objects hidden below a width, with or without stacking', () => {
  const d = layout([o(1, 'text', 10, 10, 100, 20), o(2, 'button', 10, 50, 100, 20, { responsive: { hideBelow: 700 } })]);
  assert.deepEqual(responsiveDesign(d, 500).objects.map((x) => x.id), [1]);
  assert.deepEqual(responsiveDesign(d, 900).objects.map((x) => x.id), [1, 2]);
});

test('responsive: a layout with no breakpoint of its own follows the server\'s default, its own wins, and 0 never stacks', () => {
  const objects = [o(1, 'text', 10, 10, 200, 20), o(2, 'field', 110, 60, 300, 20)];
  const plain = layout(objects);
  assert.equal(responsiveDesign(plain, 500), plain, 'with no default and no breakpoint nothing stacks');
  assert.notEqual(responsiveDesign(plain, 500, 640), plain, 'below the default it stacks');
  assert.equal(responsiveDesign(plain, 700, 640), plain, 'at a width above the default it is as designed');
  const own = layout(objects, { responsive: { stackBelow: 400 } });
  assert.equal(responsiveDesign(own, 500, 640), own, 'its own breakpoint wins over a larger default');
  assert.notEqual(responsiveDesign(own, 300, 640), own);
  const never = layout(objects, { responsive: { stackBelow: 0 } });
  assert.equal(responsiveDesign(never, 300, 640), never, '0 is never, whatever the default is');
  assert.equal(stackBreakpoint(plain, 640), 640);
  assert.equal(stackBreakpoint(never, 640), 0);
});
