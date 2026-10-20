import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ms, profileMarks } from '../src/design/profile-marks.ts';

const step = (index: number, at: number, totalMs: number, count: number, runs = 2) =>
  ({ index, at, line: `step ${index}`, count, perRun: count / runs, totalMs, averageMs: totalMs / count, maxMs: totalMs / count * 2, errors: 0 });

test('each timed step is marked on its line with its time a run, and × how many times a run when it loops', () => {
  const { marks } = profileMarks({ since: '', runs: 2, totalMs: 100, averageMs: 50, maxMs: 60, errors: 0, lastRun: '', changed: 0,
    steps: [step(0, 1, 2, 2), step(2, 4, 80, 40)] });
  assert.equal(marks.get(1)!.label, '1.0 ms');
  assert.equal(marks.get(4)!.label, '40 ms ×20');
  assert.match(marks.get(4)!.title, /run 20 times a run \(2\.0 ms each\); slowest 4\.0 ms; 98% of the script's time/);
  assert.equal(marks.get(3), undefined);
});

test('the slowest few steps are picked out, only when they take a real part of the time', () => {
  const { slowest, marks } = profileMarks({ since: '', runs: 1, totalMs: 100, averageMs: 100, maxMs: 100, errors: 0, lastRun: '', changed: 0,
    steps: [step(0, 1, 50, 1, 1), step(1, 2, 30, 1, 1), step(2, 3, 12, 1, 1), step(3, 4, 8, 1, 1), step(4, 5, 0, 1, 1)] });
  assert.deepEqual(slowest.map((m) => m.line), [1, 2, 3]);
  assert.equal(marks.get(4)!.hot, false);
  const even = profileMarks({ since: '', runs: 1, totalMs: 10, averageMs: 10, maxMs: 10, errors: 0, lastRun: '', changed: 0,
    steps: Array.from({ length: 20 }, (_, i) => step(i, i + 1, 1, 1, 1)) });
  assert.deepEqual(even.slowest, [], 'no one step takes a tenth of the time');
});

test('durations read plainly', () => {
  assert.deepEqual([0.04, 2.345, 42.6, 1500, 25_000].map(ms), ['<0.1 ms', '2.3 ms', '43 ms', '1.5 s', '25 s']);
});
