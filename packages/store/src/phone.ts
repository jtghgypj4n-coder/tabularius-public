// Phone layouts, which FileMaker leaves to you: a layout made from a desktop
// one with each part's objects stacked in one column at phone width, fields
// and buttons stretched across it and tall enough to tap, kept in step with
// the desktop layout until someone edits the phone layout by hand.
//
// The stacking is the web client's responsive one (web/src/responsive.ts),
// done here so the server can rebuild a phone layout when its desktop layout
// changes.

import type { LayoutDesign, LayoutObject, LayoutPart } from '../../fmp12/src/index.ts';

export const PHONE_WIDTH = 390;
const GUTTER = 12;
const GAP = 8;
/** Apple's and Google's smallest comfortable touch target, in points. */
const TAP = 44;
const SHAPES = new Set(['rectangle', 'rounded-rectangle', 'oval', 'line']);
const STRETCH = new Set(['field', 'button', 'web-viewer', 'chart']);
const TAPPABLE = new Set(['field', 'button', 'popover-button', 'button-bar']);

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function shift(o: LayoutObject, dx: number, dy: number): void {
  o.bounds = { left: o.bounds.left + dx, right: o.bounds.right + dx, top: o.bounds.top + dy, bottom: o.bounds.bottom + dy };
  for (const c of o.children ?? []) shift(c, dx, dy);
}

/** Rows top to bottom, each left to right; objects overlapping by half the shorter height share a row. */
function readingOrder(objs: LayoutObject[]): LayoutObject[] {
  const rows: LayoutObject[][] = [];
  for (const o of [...objs].sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left)) {
    const row = rows[rows.length - 1];
    const first = row?.[0].bounds;
    const overlap = first ? Math.min(first.bottom, o.bounds.bottom) - Math.max(first.top, o.bounds.top) : 0;
    if (row && overlap >= Math.min(first!.bottom - first!.top, o.bounds.bottom - o.bounds.top) / 2) row.push(o);
    else rows.push([o]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.bounds.left - b.bounds.left));
}

/** Objects hidden below a width wider than the phone, left out (nested ones too). */
function visible(objs: LayoutObject[], width: number): LayoutObject[] {
  return objs
    .filter((o) => !(o.responsive?.hideBelow && width < o.responsive.hideBelow))
    .map((o) => (o.children ? { ...o, children: visible(o.children, width) } : o));
}

/** The desktop layout stacked for a phone: what a phone layout made from it shows. */
export function phoneDesign(desktop: LayoutDesign, width = PHONE_WIDTH): Pick<LayoutDesign, 'objects' | 'parts' | 'width'> {
  const objects = clone(visible(desktop.objects, width));
  const parts: LayoutPart[] = clone(desktop.parts).sort((a, b) => a.top - b.top);
  const room = Math.max(120, width - 2 * GUTTER);
  const ownerOf = new Map<LayoutObject, LayoutPart>();
  for (const o of objects) ownerOf.set(o, parts.find((p) => o.bounds.top >= p.top && o.bounds.top < p.top + p.height) ?? parts[parts.length - 1]);
  const inside = (a: LayoutObject['bounds'], b: LayoutObject['bounds']) => b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom;
  // Shapes behind other objects (panels, cards) mean nothing in one column.
  const dropped = new Set(objects.filter((o) => SHAPES.has(o.kind) && objects.some((x) => x !== o && !SHAPES.has(x.kind) && inside(o.bounds, x.bounds))));
  let top = 0;
  for (const p of parts) {
    const oldTop = p.top;
    const mine = readingOrder(objects.filter((o) => ownerOf.get(o) === p && o.kind !== 'popover' && !dropped.has(o)));
    let y = top + (mine.length ? GAP : 0);
    for (const o of mine) {
      const w = o.bounds.right - o.bounds.left;
      shift(o, GUTTER - o.bounds.left, y - o.bounds.top);
      const leaf = !o.children?.length;
      o.bounds.right = o.bounds.left + (STRETCH.has(o.kind) && leaf ? room : Math.min(w, room));
      // Tall enough to tap: fields and buttons grow (their contents stay put inside them).
      if (TAPPABLE.has(o.kind) && o.bounds.bottom - o.bounds.top < TAP) o.bounds.bottom = o.bounds.top + TAP;
      y = o.bounds.bottom + GAP;
    }
    for (const o of objects.filter((x) => ownerOf.get(x) === p && x.kind === 'popover')) shift(o, GUTTER - o.bounds.left, top - oldTop);
    if (mine.length) p.height = Math.max(y - top, 20);
    p.top = top;
    top += p.height;
  }
  return { objects: objects.filter((o) => !dropped.has(o)), parts, width };
}

/** A fingerprint of what a phone layout shows, to tell whether it was edited by hand since it was last rebuilt. */
export function phoneFingerprint(d: Pick<LayoutDesign, 'objects' | 'parts'>): string {
  const text = JSON.stringify([d.objects, d.parts]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${text.length.toString(36)}-${h.toString(36)}`;
}
