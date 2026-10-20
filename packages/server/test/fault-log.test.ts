// A server fault is logged with its cause, but only so many per minute; the rest are counted and the count is said
// when the next minute begins, so one caller can't fill the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faultLog } from '../src/fault-log.ts';

test('the first faults of a minute are logged whole, the rest are counted and the count is logged next minute', () => {
  const lines: unknown[] = [];
  let t = 10 * 60_000;
  const log = faultLog((x) => lines.push(x), () => t, 3);
  const causes = Array.from({ length: 10 }, (_, i) => new Error(`cause ${i}`));
  for (const e of causes) log(e);
  assert.deepEqual(lines, causes.slice(0, 3), 'only the first three, each with its own cause');
  t += 30_000;
  log(new Error('same minute'));
  assert.equal(lines.length, 3, 'still the same minute');
  t += 31_000;
  const next = new Error('next minute');
  log(next);
  assert.equal(lines.length, 5);
  assert.match(String(lines[3]), /^8 more faults in the minute before were not logged/);
  assert.equal(lines[4], next);
});

test('a quiet minute logs nothing extra', () => {
  const lines: unknown[] = [];
  let t = 0;
  const log = faultLog((x) => lines.push(x), () => t, 2);
  log('a');
  t += 60_000;
  log('b');
  assert.deepEqual(lines, ['a', 'b']);
});

test('a capped minute flushes its dropped count at the boundary without another fault', () => {
  const lines: unknown[] = [];
  let t = 5 * 60_000;
  let timer: (() => void) | undefined;
  let unref = false;
  const log = faultLog((x) => lines.push(x), () => t, 1, (fn, delay) => {
    assert.equal(delay, 60_000);
    timer = fn;
    return { unref: () => { unref = true; } };
  });
  log(new Error('first'));
  log(new Error('dropped'));
  assert.equal(unref, true);
  t += 60_000;
  timer!();
  assert.equal(lines.length, 2);
  assert.match(String(lines[1]), /^1 more faults/);
});
