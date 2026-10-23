import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateText } from '../src/index.ts';
import { GET_NAMES } from '../src/get-names.ts';

test('timestamp arithmetic counts local calendar seconds through DST and leap days', () => {
  for (const [day, next] of [['3 ; 8 ; 2026', '3/9/2026'], ['11 ; 1 ; 2026', '11/2/2026']]) {
    assert.equal(evaluateText(`Timestamp ( Date ( ${day} ) ; Time ( 1 ; 30 ; 0 ) ) + Time ( 24 ; 0 ; 0 )`), `${next} 1:30:00`);
  }
  assert.equal(evaluateText('Timestamp ( Date ( 3 ; 8 ; 2026 ) ; Time ( 2 ; 30 ; 0 ) )'), '3/8/2026 2:30:00');
  assert.equal(evaluateText('Timestamp ( Date ( 11 ; 1 ; 2026 ) ; Time ( 1 ; 30 ; 0 ) )'), '11/1/2026 1:30:00');
  assert.equal(evaluateText('Date ( 3 ; 1 ; 2024 ) - Date ( 2 ; 28 ; 2024 )'), '2');
  assert.equal(evaluateText('Timestamp ( Date ( 3 ; 9 ; 2026 ) ; Time ( 1 ; 30 ; 0 ) ) - Timestamp ( Date ( 3 ; 8 ; 2026 ) ; Time ( 1 ; 30 ; 0 ) )'), '86400');
});

test('Get UTC milliseconds identifies an instant independently of the host zone', () => {
  const previous = process.env.TZ;
  const at = Date.parse('2026-03-08T07:30:00.123Z');
  try {
    for (const [zone, local] of [
      ['America/New_York', '3/8/2026 3:30:00'],
      ['Europe/London', '3/8/2026 7:30:00'],
      ['Asia/Kolkata', '3/8/2026 13:00:00'],
    ]) {
      process.env.TZ = zone;
      const ctx = { now: () => new Date(at) };
      assert.equal(evaluate('Get ( CurrentTimeUTCMilliseconds )', ctx).value, 62_135_596_800_000 + at);
      assert.equal(evaluateText('Get ( CurrentTimestamp )', ctx), local);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
  assert.equal(GET_NAMES.has('currenttimeutcmilliseconds'), true);
  assert.equal([...GET_NAMES].some((name) => name.includes('timezone')), false);
});
