import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePrefs, recentRecords } from '../src/prefs-merge.ts';

test('AR-web-client-07 legacy and concurrent preferences', () => {
  const entry = (recordId: number) => ({ layout: 'Items', recordId: String(recordId), title: 'SYNTHETIC_PRIVATE_TEXT', extra: 'SYNTHETIC_PRIVATE_TEXT' });
  const old = Array.from({ length: 25 }, (_, i) => entry(i + 1));
  const safe = recentRecords(old);
  assert.equal(safe.length, 15);
  assert.ok(!JSON.stringify(safe).includes('SYNTHETIC_PRIVATE_TEXT'));
  assert.deepEqual(safe[0], { layout: 'Items', recordId: '1', title: 'Record 1' });
  assert.deepEqual(recentRecords([null, {}, { layout: 'Items', recordId: 'not an id' }]), []);
  const merged = mergePrefs('recent', old, [], [entry(99)]) as typeof safe;
  assert.equal(merged.length, 15);
  assert.equal(merged[0].recordId, '99');
  assert.ok(!JSON.stringify(merged).includes('SYNTHETIC_PRIVATE_TEXT'));
  assert.deepEqual(mergePrefs('recent', [entry(1), entry(2)], [entry(1)], []), [{ layout: 'Items', recordId: '2', title: 'Record 2' }]);
});
