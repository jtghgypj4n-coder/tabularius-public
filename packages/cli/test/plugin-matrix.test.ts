import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginMatrix } from '../../../scripts/plugin-matrix.ts';
import { pluginCallBehaviour } from '../../calc/src/functions.ts';
import { PLUGIN_FUNCTIONS } from '../../fmp12/src/index.ts';

const sectionNames = (page: string, heading: string): string[] => {
  const lines = page.split('\n');
  const start = lines.indexOf(`${heading}:`);
  assert.notEqual(start, -1, `missing section ${heading}`);
  return (lines.slice(start + 1).find((line) => line.trim()) ?? '').split(/,\s*/).filter(Boolean);
};

// docs/plugin-compatibility.md is made from the code; it fails here when a plug-in function is added or removed
// without running `npm run docs:plugins`.
test('the plug-in compatibility page is up to date', () => {
  const file = join(import.meta.dirname, '..', '..', '..', 'docs', 'plugin-compatibility.md');
  assert.equal(readFileSync(file, 'utf8'), pluginMatrix(), 'run npm run docs:plugins');
});

test('the page counts match the code', () => {
  const page = pluginMatrix();
  assert.match(page, /\| BaseElements \(`GyBE`, Goya\) \|.*\| 102 run, 3 in part, 18 only in test mode, 8 refused \| 32 not built \|/);
  assert.match(page, /Run \(98\):/);
  assert.match(page, /Run in part \(3\):/);
  assert.match(page, /Only recorded in outbound test mode, otherwise `\?` \(error 3\) \(18\):/);
  assert.match(page, /Always `\?` \(error 3\) on a server \(8\):/);
  assert.doesNotMatch(page, /undefined|NaN/);
});

test('BaseElements functions listed as running match pluginCallBehaviour', () => {
  const page = pluginMatrix();
  const names = sectionNames(page, 'Run (98)');
  assert.ok(names.length > 0);
  for (const name of names) assert.equal(pluginCallBehaviour(name), 'runs', `${name} must not appear under Run`);
  const baseElements = PLUGIN_FUNCTIONS.filter((name) => /^be_/i.test(name));
  assert.ok(names.every((name) => baseElements.some((candidate) => candidate.toLowerCase() === name.toLowerCase())));
});
