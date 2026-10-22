import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG, TOLERANCE, compare, confirmedRegressions, median, medianRatios, ratios, wideElapsed, type Baseline, type BenchOutput } from './bench-check-lib.ts';

const row = (ratio: number) => [{ group: 'Find', operation: 'sample', ratio }];
const baseline: Baseline = { version: 1, config: CONFIG, tolerance: TOLERANCE, operations: row(10) };

test('normalizes timings using calibration from the same output', () => {
  const output: BenchOutput = { records: CONFIG.records, customers: CONFIG.customers, runs: CONFIG.runs, calibrationMs: 20,
    rows: [{ group: 'Find', operation: 'sample', median: 200 }] };
  assert.deepEqual(ratios(output), row(10));
  assert.deepEqual(ratios({ ...output, calibrationMs: 40, rows: [{ ...output.rows[0], median: 400 }] }), row(10));
  assert.throws(() => ratios({ ...output, calibrationMs: 0 }), /calibration/);
});

test('uses median of three normalized runs and strict 40% tolerance', () => {
  assert.equal(medianRatios([row(20), row(10), row(13)])[0].ratio, 13);
  assert.equal(compare(row(14), baseline)[0].over, false);
  assert.equal(compare(row(14.01), baseline)[0].over, true);
});

test('fails only when the same operation exceeds tolerance in consecutive batches', () => {
  const first = compare(row(15), baseline);
  assert.deepEqual(confirmedRegressions(first, compare(row(13), baseline)), []);
  assert.equal(confirmedRegressions(first, compare(row(15), baseline)).length, 1);
  const two: Baseline = { ...baseline, operations: [...row(10), { group: 'Sort', operation: 'other', ratio: 10 }] };
  const a = compare([...row(15), { group: 'Sort', operation: 'other', ratio: 10 }], two);
  const b = compare([...row(10), { group: 'Sort', operation: 'other', ratio: 15 }], two);
  assert.deepEqual(confirmedRegressions(a, b), []);
});

test('rejects missing or reordered operations and changed benchmark size', () => {
  assert.throws(() => medianRatios([row(1), [], row(1)]), /operation list/);
  assert.throws(() => compare([], baseline), /baseline operation list/);
  assert.throws(() => compare(row(10), { ...baseline, config: { ...CONFIG, records: 20 } }), /configuration/);
});

test('wide budget checks full workload and finite elapsed time; three runs suppress an isolated outlier', () => {
  const budget = { records: 270000, tables: 85, maxMs: 5000 };
  const output = { counts: { records: 270000, tables: 85 }, timings: { firstUseTotalMs: 5000 } };
  assert.equal(wideElapsed(output, budget), budget.maxMs);
  assert.equal(median([700, 800, 10000]) > budget.maxMs, false);
  assert.equal(median([5001, 6000, 700]) > budget.maxMs, true);
  assert.throws(() => wideElapsed({ ...output, counts: { records: 100, tables: 3 } }, budget), /configuration/);
  for (const firstUseTotalMs of [NaN, Infinity, -1, 0]) assert.throws(() => wideElapsed({ ...output, timings: { firstUseTotalMs } }, budget), /timing/);
  assert.throws(() => wideElapsed(output, { ...budget, maxMs: 0 }), /budget/);
});
