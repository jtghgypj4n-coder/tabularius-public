// Times and timestamps print at most microseconds, with no binary noise from the subtraction that finds the time of day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatTimestamp } from '../src/values.ts';

test('a fractional-second timestamp prints its real decimals', () => {
  // 2026-10-15 01:29:06.072, as seconds since the start of year 1.
  const day = 739_000;
  const ts = (day - 1) * 86400 + 5346.072;
  assert.match(formatTimestamp(ts), / 1:29:06\.072$/);
  assert.equal(formatTime(5346.072), '1:29:06.072');
  assert.equal(formatTime(5346), '1:29:06');
  assert.equal(formatTime(-5346.5), '-1:29:06.5');
});
