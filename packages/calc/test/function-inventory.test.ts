import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUNCTIONS } from '../src/functions.ts';
import { ENGINE_ONLY, IMPLEMENTED, INVENTORY, NOT_IMPLEMENTED } from './function-inventory.data.ts';

test('Claris function inventory is complete and the engine support snapshot has no drift', () => {
  const names = INVENTORY.map(({ name }) => name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'catalog names must be unique');
  assert.ok(INVENTORY.every(({ pageUrl }) => pageUrl.startsWith('https://help.claris.com/en/pro-help/content/')));

  const actual = [...FUNCTIONS.keys()].sort();
  assert.deepEqual([...IMPLEMENTED].sort(), names.filter((name) => FUNCTIONS.has(name)).sort(), 'implemented catalog membership changed; update the inventory snapshots');
  assert.deepEqual([...NOT_IMPLEMENTED].sort(), names.filter((name) => !FUNCTIONS.has(name)).sort(), 'unimplemented catalog membership changed; update the inventory snapshots');
  assert.deepEqual([...new Set([...IMPLEMENTED, ...ENGINE_ONLY])].sort(), actual, 'engine function names changed; update the catalog or engine-only snapshot');
});
