import { test } from 'node:test';
import assert from 'node:assert/strict';
import { innerStretch, portalRowsShown } from '../src/layout.ts';

test('a portal anchored top and bottom shows more rows as the window grows, not taller ones', () => {
  // A 5-row portal with 20-point rows in a window 65 points taller: 3 more whole rows.
  assert.equal(portalRowsShown(5, 20, 65, false), 8);
  assert.equal(portalRowsShown(5, 20, 19, false), 5);
  assert.equal(portalRowsShown(5, 20, 0, false), 5);
  // Preview and printing don't stretch.
  assert.equal(portalRowsShown(5, 20, 65, true), 5);
});

test('only a container that stretches passes the stretch on to what is inside it', () => {
  assert.equal(innerStretch({ top: true, bottom: true }, 40), 40);
  // Anchored to the bottom only: it moves, so its contents move with it and keep their size.
  assert.equal(innerStretch({ bottom: true }, 40), 0);
  assert.equal(innerStretch({ top: true }, 40), 0);
});
