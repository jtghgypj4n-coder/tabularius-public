import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueFormula, valueIs, VALUE_OPS } from '../src/design/conditions.ts';

test('conditional formatting: "Value is" conditions round-trip through their formulas on Self', () => {
  for (const [op, , arity] of VALUE_OPS) {
    const v = { op, a: arity > 0 ? '10' : '', b: arity > 1 ? 'Get ( CurrentDate )' : '' };
    assert.deepEqual(valueIs(valueFormula(v)), v, op);
  }
  assert.deepEqual(valueIs('Self   ≥  "M"'), { op: 'ge', a: '"M"', b: '' });
  // Formulas that only start like one stay formulas.
  assert.equal(valueIs('Self = 1 or Self = 2'), undefined);
  assert.equal(valueIs('Invoices::Total > 0'), undefined);
  assert.equal(valueIs('Length ( Self ) > 3'), undefined);
});
