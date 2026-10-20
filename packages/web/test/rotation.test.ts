import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROTATABLE_KINDS } from '../../fmp12/src/index.ts';
import { ROTATABLE, nextTurn, rotationOf, turnedBox } from '../src/rotation.ts';

test('the kinds that can turn are the same in the file reader and the web client', () => {
  assert.deepEqual([...ROTATABLE].sort(), [...ROTATABLE_KINDS].sort());
});

test('rotationOf only turns the kinds that can turn', () => {
  assert.equal(rotationOf({ kind: 'field', rotation: 90 }), 90);
  assert.equal(rotationOf({ kind: 'portal', rotation: 90 }), undefined);
  assert.equal(rotationOf({ kind: 'field' }), undefined);
});

test('turnedBox: sideways turns swap width and height about the middle of the bounds; 180 keeps the shape', () => {
  const bounds = { top: 100, left: 50, bottom: 140, right: 250 }; // 200 wide, 40 tall
  assert.deepEqual(turnedBox(bounds, 90, { top: 0, left: 0 }), { left: 130, top: 20, width: 40, height: 200, transform: 'rotate(90deg)' });
  assert.deepEqual(turnedBox(bounds, 270, { top: 0, left: 0 }), { left: 130, top: 20, width: 40, height: 200, transform: 'rotate(270deg)' });
  assert.deepEqual(turnedBox(bounds, 180, { top: 10, left: 10 }), { left: 40, top: 90, width: 200, height: 40, transform: 'rotate(180deg)' });
});

test('nextTurn goes round a quarter turn at a time', () => {
  assert.deepEqual([undefined, 90, 180, 270].map((t) => nextTurn(t as 90 | undefined)), [90, 180, 270, undefined]);
});
