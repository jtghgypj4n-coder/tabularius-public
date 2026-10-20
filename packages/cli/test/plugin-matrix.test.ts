import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginMatrix } from '../../../scripts/plugin-matrix.ts';

// docs/plugin-compatibility.md is made from the code; it fails here when a plug-in function is added or removed
// without running `npm run docs:plugins`.
test('the plug-in compatibility page is up to date', () => {
  const file = join(import.meta.dirname, '..', '..', '..', 'docs', 'plugin-compatibility.md');
  assert.equal(readFileSync(file, 'utf8'), pluginMatrix(), 'run npm run docs:plugins');
});

test('the page counts match the code', () => {
  const page = pluginMatrix();
  assert.match(page, /\| BaseElements \(`GyBE`, Goya\) \|.*\| \d+ \| \d+ \|/);
  assert.match(page, /Functions that run \(\d+\):/);
  assert.doesNotMatch(page, /undefined|NaN/);
});
