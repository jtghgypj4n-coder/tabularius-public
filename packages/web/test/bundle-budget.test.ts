import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { measure } from '../../../scripts/web-bundle-budget.ts';

const root = resolve(import.meta.dirname, '../../..');

test('browse entry JS and CSS stay within their measured raw and gzip budgets', () => {
  const file = JSON.parse(readFileSync(resolve(root, 'scripts/web-bundle-budget.json'), 'utf8')) as {
    assets: Record<string, { raw: number; gzip: number }>;
    largest: string[];
  };
  const measured = measure();
  assert.deepEqual(measured.assets.map((a) => a.path).sort(), Object.keys(file.assets).sort(), 'budget lists every and only initial browse asset');
  for (const asset of measured.assets) {
    const limit = file.assets[asset.path]!;
    assert.ok(asset.raw <= limit.raw, `${asset.path} is ${asset.raw} raw bytes; budget ${limit.raw} bytes`);
    assert.ok(asset.gzip <= limit.gzip, `${asset.path} is ${asset.gzip} gzip bytes; budget ${limit.gzip} bytes`);
  }
  assert.deepEqual(file.largest, measured.largest, 'largest initial JavaScript contributors are named in the budget');
});
