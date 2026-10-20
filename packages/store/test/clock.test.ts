import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExpiryClock } from '../src/clock.ts';

test('absolute expiry time advances during rollback, including before the first check', () => {
  let wall = 1_000_000, mono = 0;
  const warnings: string[] = [];
  const clock = new ExpiryClock(() => wall, () => mono, (message) => warnings.push(message));
  wall -= 3600_000;
  mono += 60_000;
  assert.equal(clock.now(), 1_060_000);
  mono += 60_000;
  assert.equal(clock.now(), 1_120_000, 'the clock keeps advancing while wall time is behind');
  assert.equal(warnings.length, 1, 'a rollback logs once, without flooding on every request');
  assert.match(warnings[0], /wall clock.*backwards/);
});

test('a corrected forward jump stops counting, while elapsed time still expires credentials', () => {
  let wall = 1_000_000, mono = 0;
  const warnings: string[] = [];
  const clock = new ExpiryClock(() => wall, () => mono, (message) => warnings.push(message));
  const expires = wall + 30 * 60_000;
  wall += 3600_000;
  assert.equal(clock.now(), wall);
  assert.ok(clock.now() >= expires, 'the forward jump temporarily expires the credential');
  wall -= 60_000;
  mono += 1000;
  assert.equal(clock.now(), wall, 'a partial correction is not ratcheted');
  wall = 1_001_000;
  assert.equal(clock.now(), wall);
  assert.ok(clock.now() < expires, 'correcting the jump restores the remaining lifetime');
  assert.equal(warnings.length, 0, 'correcting a forward jump is not a rollback behind the startup reference');
  wall -= 3600_000;
  mono = 30 * 60_000 - 1;
  assert.equal(clock.now(), expires - 1);
  mono++;
  assert.equal(clock.now(), expires, 'a subsequent rollback cannot extend the real deadline');
  assert.equal(warnings.length, 1);
});

test('repeated small backward corrections cannot extend an absolute lifetime', () => {
  let wall = 1_000_000, mono = 0;
  const warnings: string[] = [];
  const clock = new ExpiryClock(() => wall, () => mono, (message) => warnings.push(message));
  for (let i = 1; i <= 6; i++) {
    mono += 60_000;
    assert.equal(clock.now(), 1_000_000 + mono);
    assert.equal(warnings.length, i > 5 ? 1 : 0);
  }
  wall += mono;
  assert.equal(clock.now(), wall, 'wall time can catch up to the startup projection');
});
