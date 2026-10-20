import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabJustify } from '../src/layout.ts';

test('tab strips are justified the way the file lays out their tabs', () => {
  const tabs = (...t: [number, number][]) => t.map(([left, width]) => ({ tab: { left, width } }));
  // A private sample's detail layout: four tabs centered in a 1280-wide control.
  assert.equal(tabJustify(tabs([323, 149], [471, 162], [632, 139], [770, 187]), 1280), 'center');
  // Charts' Chart Types layouts: left-justified.
  assert.equal(tabJustify(tabs([0, 238], [236, 238], [472, 238], [708, 203]), 911), undefined);
  assert.equal(tabJustify(tabs([600, 200], [799, 201]), 1000), 'flex-end');
  assert.equal(tabJustify(tabs([20, 100], [119, 100]), 1000), undefined);
});
