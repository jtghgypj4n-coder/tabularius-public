// Arrange > Rotate: an object turned clockwise by a quarter turn at a time. The kinds that can turn are the same list as
// ROTATABLE_KINDS in packages/fmp12/src/layouts.ts (a test keeps the two equal; the web client has no import from there).
// An object's bounds are taken to be the box it fills once turned, so a sideways field is drawn as a box of the other
// shape, turned about the middle of the bounds.

import type { LayoutObject } from './types.ts';

export const ROTATABLE: ReadonlySet<string> = new Set(['field', 'text', 'graphic', 'line', 'rectangle', 'rounded-rectangle', 'oval', 'button', 'popover-button']);

/** The turn that applies to an object: its rotation, if its kind can be turned. */
export const rotationOf = (o: Pick<LayoutObject, 'kind' | 'rotation'>): 90 | 180 | 270 | undefined => (o.rotation && ROTATABLE.has(o.kind) ? o.rotation : undefined);

/**
 * Where to put the element of a turned object, in the same terms as its bounds (relative to its container): the box
 * before the turn, centred on the bounds, and the CSS transform that turns it into them.
 */
export function turnedBox(bounds: { top: number; left: number; bottom: number; right: number }, turn: 90 | 180 | 270, origin: { top: number; left: number }) {
  const w = bounds.right - bounds.left;
  const h = bounds.bottom - bounds.top;
  const sideways = turn !== 180;
  const width = sideways ? h : w;
  const height = sideways ? w : h;
  return {
    left: bounds.left - origin.left + (w - width) / 2,
    top: bounds.top - origin.top + (h - height) / 2,
    width,
    height,
    transform: `rotate(${turn}deg)`,
  };
}

/** A quarter turn clockwise more, as Arrange > Rotate does: none, 90, 180, 270 and round again. */
export const nextTurn = (turn: 90 | 180 | 270 | undefined): 90 | 180 | 270 | undefined => (turn === undefined ? 90 : turn === 90 ? 180 : turn === 180 ? 270 : undefined);
