import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, over, parseColor, requiredRatio } from '../src/design/contrast.ts';

test('computed colours parse, with and without alpha', () => {
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3, 1]);
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), [1, 2, 3, 0.5]);
  assert.deepEqual(parseColor('rgb(1 2 3 / 50%)'), [1, 2, 3, 0.5]);
  assert.equal(parseColor('transparent'), undefined);
});

test('contrast ratios match WCAG', () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(0), '21');
  assert.equal(contrastRatio([119, 119, 119], [255, 255, 255]).toFixed(2), '4.48');
  assert.deepEqual(over([0, 0, 0, 0.5], [255, 255, 255]), [127.5, 127.5, 127.5]);
  assert.equal(requiredRatio(13, 400), 4.5);
  assert.equal(requiredRatio(24, 400), 3);
  assert.equal(requiredRatio(19, 700), 3);
});
