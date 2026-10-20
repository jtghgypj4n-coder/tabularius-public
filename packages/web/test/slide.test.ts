import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slide } from '../src/preview.ts';

const box = (id: string, top: number, left: number, bottom: number, right: number, extra = {}) => ({ id, top, left, bottom, right, ...extra });

test('sliding: fields shrink to their content and those below move up', () => {
  // An address block: three lines, the middle one empty.
  const r = slide([
    box('name', 0, 0, 20, 200, { up: true, contentHeight: 14 }),
    box('street2', 20, 0, 40, 200, { up: true, contentHeight: 0 }),
    box('city', 40, 0, 60, 200, { up: true, contentHeight: 14, resizePart: true }),
  ], 70);
  assert.deepEqual(r.bounds.get('name'), { top: 0, left: 0, bottom: 14, right: 200 });
  assert.deepEqual(r.bounds.get('street2'), { top: 14, left: 0, bottom: 14, right: 200 });
  assert.deepEqual(r.bounds.get('city'), { top: 14, left: 0, bottom: 28, right: 200 });
  // 32 points freed at the bottom.
  assert.equal(r.height, 38);
});

test('sliding: an object below a fixed one stays, and objects beside each other do not affect each other', () => {
  const r = slide([
    box('label', 0, 0, 20, 50),
    box('note', 0, 60, 40, 200, { up: true, contentHeight: 10 }),
    box('under-label', 30, 0, 50, 50, { up: true }),
    box('under-note', 50, 60, 70, 200, { up: true }),
  ], 80);
  assert.equal(r.bounds.get('under-label')!.top, 30);
  assert.equal(r.bounds.get('under-note')!.top, 20);
  // Nothing asked the part to shrink.
  assert.equal(r.height, 80);
});

test('sliding: left closes up a row of fields', () => {
  const r = slide([
    box('first', 0, 0, 20, 100, { left_: true, contentWidth: 40 }),
    box('last', 0, 100, 20, 200, { left_: true, contentWidth: 60 }),
  ], 20);
  assert.deepEqual(r.bounds.get('last'), { top: 0, left: 40, bottom: 20, right: 100 });
});
