import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actions, matrixFile, registry, render, validate, validateRouteSources, sourceRegistryFile } from '../../../scripts/audit-matrix.ts';

test('every route method and script step has an explicit classification and the report is current', () => {
  validate();
  assert.equal(readFileSync(matrixFile, 'utf8'), render());
});

test('a new route, method, step, removed action or invalid classification fails closed', () => {
  const inventory = actions(); const classified = registry();
  for (const id of ['route POST /new-privileged-action', 'route PATCH /admin/', 'step 999 Future Security Action']) {
    assert.throws(() => validate([...inventory, { id, family: 'synthetic' }], classified), /unclassified action/);
  }
  assert.throws(() => validate(inventory.slice(1), classified), /stale audit action/);
  assert.throws(() => validate(inventory, { ...classified, [inventory[0].id]: 'guessed' } as never), /unclassified action/);
  const missing = { ...classified }; delete missing[inventory[0].id];
  assert.throws(() => validate(inventory, missing), /unclassified action/);
});

test('source review catches method changes and reused paths even when table keys are unchanged', () => {
  const sources = JSON.parse(readFileSync(sourceRegistryFile, 'utf8'));
  assert.throws(() => validateRouteSources({ ...sources, 'admin.ts': 'changed method behind the same path' }), /route implementation changed/);
  assert.throws(() => validateRouteSources({ ...sources, 'new-handler.ts': sources['admin.ts'] }), /route implementation changed/);
});
