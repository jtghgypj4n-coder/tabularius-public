import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';
import { localeElements } from '../src/locale.ts';

test('native Get locale metadata describes padded ISO dates and 24-hour time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-locale-'));
  const path = join(dir, 'native.sqlite');
  createStore(path, { mode: 'native' });
  const store = new Store(path);
  try {
    store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Name' }] }]);
    for (const name of ['FileLocaleElements', 'SystemLocaleElements']) {
      const result = await runScript(store, { id: 1, name: 'locale', steps: [
        { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: `Get ( ${name} )` } },
      ] }, { layout: 'Events' });
      assert.equal(result.error, 0);
      const locale = JSON.parse(String(result.result));
      assert.equal(locale.Date.DateOrderName, 'ISO');
      assert.equal(locale.Date.DateOrderID, 2, 'ISO has year-month-day order');
      assert.equal(locale.Date.Sep, '-');
      assert.deepEqual(locale.Date.DateNums, { '0d': true, '0m': true, YYyy: false });
      assert.deepEqual(locale.Date.DMY.ElementArray, { NameList: ['YYYY#', 'M#', 'D#'], SepList: ['-', '-', ''] });
      assert.equal(locale.Time['12h'], false);
      assert.equal(locale.Time.HMS['0h'], true);
      assert.equal(locale.Time.NightDay['12hSuffix'], false);
      assert.equal(locale.Misc.Active, name === 'FileLocaleElements');
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('ISO locale objects and strings agree', () => {
  assert.equal(localeElements({ order: 'ISO' }, true), localeElements('ISO', true));
});
