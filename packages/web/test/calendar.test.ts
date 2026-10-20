import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, pickedDate } from '../src/layout.ts';

test('drop-down calendar reads the date the field shows', () => {
  assert.equal(isoDate('02/29/2024'), '2024-02-29');
  assert.equal(isoDate('7/4/2023'), '2023-07-04');
  assert.equal(isoDate('7/4/23'), '2023-07-04');
  assert.equal(isoDate('1/2/99'), '1999-01-02');
  assert.equal(isoDate('2026-10-12'), '2026-10-12');
  // Empty, find criteria and impossible dates open the calendar on today.
  assert.equal(isoDate(''), undefined);
  assert.equal(isoDate('1/1/2026...12/31/2026'), undefined);
  assert.equal(isoDate('13/01/2026'), undefined);
});

test('a two-digit year is within the next 30 years or the preceding 70 of the current one', () => {
  assert.equal(isoDate('1/2/46', 2019), '2046-01-02');
  assert.equal(isoDate('1/2/50', 2019), '1950-01-02');
  assert.equal(isoDate('1/2/50', 2030), '2050-01-02');
  assert.equal(isoDate('1/2/76', 2030), '1976-01-02');
  assert.equal(isoDate('1/2/60', 2026), '1960-01-02');
  assert.equal(isoDate('1/2/55', 2026), '2055-01-02');
});

test('a date picked in the drop-down calendar: US text in compat files, ISO 8601 in native ones', () => {
  assert.deepEqual(pickedDate('2026-10-16', '', 'date'), { shown: '10/16/2026', saved: '2026-10-16' });
  assert.deepEqual(pickedDate('2026-10-16', '1/2/2026 9:30:00', 'timestamp'), { shown: '10/16/2026 9:30:00', saved: '2026-10-16T9:30:00' });
  assert.deepEqual(pickedDate('2026-10-16', '', 'timestamp'), { shown: '10/16/2026 0:00:00', saved: '2026-10-16T0:00:00' });
  // Native: what the field shows is what a find or a save sends.
  assert.deepEqual(pickedDate('2026-10-16', '', 'date', true), { shown: '2026-10-16', saved: '2026-10-16' });
  assert.deepEqual(pickedDate('2026-10-16', '2026-01-02T09:30:00', 'timestamp', true), { shown: '2026-10-16T09:30:00', saved: '2026-10-16T09:30:00' });
  assert.deepEqual(pickedDate('2026-10-16', '2026-01-02 09:30:00', 'timestamp', true), { shown: '2026-10-16T09:30:00', saved: '2026-10-16T09:30:00' });
  assert.deepEqual(pickedDate('2026-10-16', '', 'timestamp', true), { shown: '2026-10-16T00:00:00', saved: '2026-10-16T00:00:00' });
  // The calendar opens on the date a native timestamp shows.
  assert.equal(isoDate('2026-01-02T09:30:00'.split(/[T\s]+/)[0]), '2026-01-02');
});
