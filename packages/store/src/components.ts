// Layout components, which FileMaker doesn't have: a group of objects saved
// once (a header, a navigation bar, an address block) and placed on many
// layouts. A placed copy is a group object marked `component: { id }`; its
// children are the component's objects moved to where the copy sits, so
// changing the component changes every copy. Pure functions, shared by the
// design changes in design.ts.

import type { Bounds, LayoutComponent, LayoutDesign, LayoutObject } from '../../fmp12/src/index.ts';

/** Every object id in a list of objects, children included. */
export function objectIds(objects: LayoutObject[], into: number[] = []): number[] {
  for (const o of objects) {
    into.push(o.id);
    if (o.children) objectIds(o.children, into);
  }
  return into;
}

function moved(b: Bounds, dx: number, dy: number): Bounds {
  return { top: b.top + dy, left: b.left + dx, bottom: b.bottom + dy, right: b.right + dx };
}

/** Objects with their bounds moved, children too. */
export function moveObjects(objects: LayoutObject[], dx: number, dy: number): LayoutObject[] {
  return objects.map((o) => ({ ...o, bounds: moved(o.bounds, dx, dy), ...(o.children ? { children: moveObjects(o.children, dx, dy) } : {}) }));
}

/** The box around some objects. */
export function boundsOf(objects: LayoutObject[]): Bounds {
  const bs = objects.map((o) => o.bounds);
  return {
    top: Math.min(...bs.map((b) => b.top)), left: Math.min(...bs.map((b) => b.left)),
    bottom: Math.max(...bs.map((b) => b.bottom)), right: Math.max(...bs.map((b) => b.right)),
  };
}

/** A component made from objects on a layout: their bounds measured from the box around them. */
export function componentFrom(id: number, name: string, objects: LayoutObject[]): LayoutComponent {
  const box = boundsOf(objects);
  return {
    id, name, width: Math.max(1, Math.round(box.right - box.left)), height: Math.max(1, Math.round(box.bottom - box.top)),
    objects: moveObjects(structuredClone(objects), -box.left, -box.top),
  };
}

/** Gives objects ids: `reuse` in order first, then new ones above `taken`; a tab control's or popover button's target follows its object. */
function renumber(objects: LayoutObject[], reuse: number[], taken: Set<number>): LayoutObject[] {
  const was = new Map<number, number>();
  const out = renumbered(objects, reuse, taken, was);
  const retarget = (list: LayoutObject[]): LayoutObject[] => list.map((o) => ({
    ...o, ...(o.target !== undefined && was.has(o.target) ? { target: was.get(o.target) } : {}), ...(o.children ? { children: retarget(o.children) } : {}),
  }));
  return retarget(out);
}

function renumbered(objects: LayoutObject[], reuse: number[], taken: Set<number>, was: Map<number, number>): LayoutObject[] {
  const next = () => {
    const kept = reuse.shift();
    if (kept !== undefined) {
      taken.add(kept);
      return kept;
    }
    let id = Math.max(0, ...taken) + 1;
    while (taken.has(id)) id++;
    taken.add(id);
    return id;
  };
  return objects.map((o) => {
    const id = next();
    was.set(o.id, id);
    const children = o.children ? renumbered(o.children, reuse, taken, was) : undefined;
    // A button bar's active segment names one of its own segments.
    const active = o.activeSegment !== undefined && o.children ? o.children.findIndex((c) => c.id === o.activeSegment) : -1;
    return { ...o, id, ...(children ? { children } : {}), ...(active >= 0 && children ? { activeSegment: children[active].id } : {}) };
  });
}

/**
 * A placed copy's group, its children brought up to date with the component:
 * at the copy's top left corner, keeping the copy's child ids where it can so
 * versions compare object by object.
 */
export function placed(group: LayoutObject, component: LayoutComponent, taken: Set<number>): LayoutObject {
  const reuse = group.children ? objectIds(group.children) : [];
  const { top, left } = group.bounds;
  const children = renumber(moveObjects(structuredClone(component.objects), left, top), reuse, taken);
  return {
    ...group, kind: 'group', component: { id: component.id },
    bounds: { top, left, bottom: top + component.height, right: left + component.width }, children,
  };
}

/** A new placed copy of a component, its top left corner at `at`. */
export function placeComponent(component: LayoutComponent, at: { top: number; left: number }, taken: Set<number>): LayoutObject {
  const group: LayoutObject = {
    id: 0, kind: 'group', type: 8, bounds: { top: at.top, left: at.left, bottom: at.top, right: at.left },
    anchors: { left: true, top: true, right: false, bottom: false }, style: {} as LayoutObject['style'],
  };
  const id = Math.max(0, ...taken) + 1;
  taken.add(id);
  return placed({ ...group, id }, component, taken);
}

/**
 * Brings every placed copy on a layout up to date with its component; copies
 * of a component that no longer exists become plain groups. Returns whether
 * anything changed.
 */
export function syncPlaced(design: LayoutDesign, components: LayoutComponent[]): boolean {
  const before = JSON.stringify(design.objects);
  const taken = new Set(objectIds(design.objects));
  const walk = (objects: LayoutObject[]): LayoutObject[] => objects.map((o) => {
    if (o.component) {
      const c = components.find((x) => x.id === o.component!.id);
      if (!c) {
        const { component: _gone, ...plain } = o;
        return plain;
      }
      // Its old children's ids are free for the new ones.
      for (const id of objectIds(o.children ?? [])) taken.delete(id);
      return placed(o, c, taken);
    }
    return o.children ? { ...o, children: walk(o.children) } : o;
  });
  design.objects = walk(design.objects);
  return JSON.stringify(design.objects) !== before;
}

/** Whether a layout has a placed copy of the component. */
export function places(design: LayoutDesign, componentId: number): boolean {
  const walk = (objects: LayoutObject[]): boolean => objects.some((o) => o.component?.id === componentId || (!!o.children && walk(o.children)));
  return walk(design.objects ?? []);
}
