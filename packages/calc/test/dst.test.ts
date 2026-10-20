import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateText, NameTable } from '../src/index.ts';

test('timestamp arithmetic counts local calendar seconds across New York DST', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const stamp = (instant: string) => evaluate('Get ( CurrentTimestamp )', { now: () => new Date(instant) });
    const secondsBetween = (before: string, after: string) => {
      const first = stamp(before);
      const last = stamp(after);
      assert.equal(first.type, 'timestamp');
      assert.equal(last.type, 'timestamp');
      return evaluateText('Later - Earlier', {
        names: new NameTable({ fields: ['Earlier', 'Later'] }),
        field: (ref) => ref.field === 'Earlier' ? first : last,
      });
    };

    // Each pair is two elapsed minutes apart. FileMaker timestamps carry local calendar seconds, not a UTC offset.
    assert.equal(secondsBetween('2026-03-08T06:59:00Z', '2026-03-08T07:01:00Z'), '3720');
    assert.equal(secondsBetween('2026-11-01T05:59:00Z', '2026-11-01T06:01:00Z'), '-3480');
    assert.equal(evaluateText('Timestamp ( Date ( 3 ; 8 ; 2026 ) ; Time ( 1 ; 59 ; 0 ) ) + 120'), '3/8/2026 2:01:00');
    assert.equal(evaluateText('Timestamp ( Date ( 11 ; 1 ; 2026 ) ; Time ( 0 ; 59 ; 0 ) ) + 120'), '11/1/2026 1:01:00');
    assert.equal(evaluateText('Get ( CurrentTimestamp )', { now: () => new Date('2026-11-01T05:01:00Z') }),
      evaluateText('Get ( CurrentTimestamp )', { now: () => new Date('2026-11-01T06:01:00Z') }));
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});
