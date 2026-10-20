// Responsive layouts, which FileMaker doesn't have: below a layout's breakpoint
// the web client stacks each part's objects in one column instead of shrinking
// the whole layout, and objects can be hidden on narrow windows.
import type { LayoutDesign, LayoutObject } from './types.ts';

const GUTTER = 12;
const GAP = 6;
const SHAPES = new Set(['rectangle', 'rounded-rectangle', 'oval', 'line']);
const STRETCH = new Set(['field', 'button', 'web-viewer', 'chart']);

function shift(o: LayoutObject, dx: number, dy: number): void {
  o.bounds = { left: o.bounds.left + dx, right: o.bounds.right + dx, top: o.bounds.top + dy, bottom: o.bounds.bottom + dy };
  for (const c of o.children ?? []) shift(c, dx, dy);
}

/**
 * Reading order: rows top to bottom, each left to right. Objects whose
 * heights overlap by half of the shorter one share a row, so a label a point
 * lower than its field still comes first.
 */
function readingOrder(objs: LayoutObject[]): LayoutObject[] {
  const rows: { items: LayoutObject[] }[] = [];
  for (const o of [...objs].sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left)) {
    const row = rows[rows.length - 1];
    const first = row?.items[0].bounds;
    const overlap = first ? Math.min(first.bottom, o.bounds.bottom) - Math.max(first.top, o.bounds.top) : 0;
    if (row && overlap >= Math.min(first!.bottom - first!.top, o.bounds.bottom - o.bounds.top) / 2) row.items.push(o);
    else rows.push({ items: [o] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.bounds.left - b.bounds.left));
}

/** Objects with "hide below" set wider than the window, left out (nested ones too). */
function visible(objs: LayoutObject[], width: number): LayoutObject[] {
  return objs
    .filter((o) => !(o.responsive?.hideBelow && width < o.responsive.hideBelow))
    .map((o) => (o.children ? { ...o, children: visible(o.children, width) } : o));
}

/** The width below which a layout stacks: its own breakpoint, else the server's default (0: never). */
export function stackBreakpoint(d: LayoutDesign, fallback = 0): number {
  return d.responsive?.stackBelow ?? fallback;
}

/**
 * The design as a window `width` wide shows it. At or above the layout's
 * `responsive.stackBelow` (or the server's default when the layout has none; 0 is never) only hidden objects change. Below it,
 * each part's objects go one under another, in reading order (top to bottom,
 * then left to right), as wide as the window allows: fields, buttons and the
 * like stretch to fill it, while containers (portals, tab and slide controls,
 * groups, popovers) keep their size with what's inside them. Parts grow or
 * shrink to fit, and the parts below move with them.
 */
export function responsiveDesign(d: LayoutDesign, width: number, fallback = 0): LayoutDesign {
  const hides = (objs: LayoutObject[]): boolean => objs.some((o) => !!o.responsive?.hideBelow || hides(o.children ?? []));
  const below = stackBreakpoint(d, fallback);
  const stack = below > 0 && width < below;
  if (!stack && !hides(d.objects)) return d;
  const out: LayoutDesign = structuredClone({ ...d, objects: visible(d.objects, width) });
  if (!stack) return out;
  const room = Math.max(120, width - 2 * GUTTER);
  const parts = [...out.parts].sort((a, b) => a.top - b.top);
  const ownerOf = new Map<LayoutObject, (typeof parts)[number]>();
  for (const o of out.objects) ownerOf.set(o, parts.find((p) => o.bounds.top >= p.top && o.bounds.top < p.top + p.height) ?? parts[parts.length - 1]);
  const inside = (a: LayoutObject['bounds'], b: LayoutObject['bounds']) => b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom;
  // Shapes drawn behind other objects (panels, cards) mean nothing in one column.
  const backdrop = (o: LayoutObject) => SHAPES.has(o.kind) && out.objects.some((x) => x !== o && !SHAPES.has(x.kind) && inside(o.bounds, x.bounds));
  const dropped = new Set(out.objects.filter(backdrop));
  let top = 0;
  for (const p of parts) {
    const oldTop = p.top;
    const mine = readingOrder(out.objects.filter((o) => ownerOf.get(o) === p && o.kind !== 'popover' && !dropped.has(o)));
    let y = top + (mine.length ? GAP : 0);
    for (const o of mine) {
      const w = o.bounds.right - o.bounds.left;
      shift(o, GUTTER - o.bounds.left, y - o.bounds.top);
      // Leaf objects fill the column; containers keep their layout inside.
      o.bounds.right = o.bounds.left + (STRETCH.has(o.kind) && !o.children?.length ? room : Math.min(w, room));
      y = o.bounds.bottom + GAP;
    }
    // Popovers move with their part.
    for (const o of out.objects.filter((x) => ownerOf.get(x) === p && x.kind === 'popover')) shift(o, GUTTER - o.bounds.left, top - oldTop);
    p.height = mine.length ? Math.max(y - top, 20) : p.height;
    p.top = top;
    top += p.height;
  }
  out.objects = out.objects.filter((o) => !dropped.has(o));
  out.parts = parts;
  out.width = width;
  return out;
}
