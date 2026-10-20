import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, parseDateText, parseTimestampText } from '../src/values.ts';

const INVALID = [[2026, 0, 1], [2026, 13, 1], [2026, 1, 0], [2026, 1, 32], [2026, 4, 31], [2026, 2, 29], [1900, 2, 29], [2100, 2, 29]];
const VALID = [[2024, 2, 29], [2000, 2, 29], [2026, 2, 28], [2026, 4, 30], [2026, 12, 31]];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

test('ISO (native): invalid calendar dates are not dates, including timestamps', () => {
  for (const [y, m, d] of INVALID) {
    assert.equal(parseDateText(iso(y, m, d), 'ISO'), undefined, iso(y, m, d));
    assert.equal(parseTimestampText(`${iso(y, m, d)}T12:30:00`, 'ISO'), undefined);
  }
  for (const [y, m, d] of VALID) assert.equal(parseDateText(iso(y, m, d), 'ISO'), dayNumber(y, m, d));
});

// Compat orders keep rolling over until FileMaker's behaviour is verified (docs/consistency.md A4-09, A4-11).
for (const order of ['MDY', 'DMY', 'YMD'] as const) {
  const format = (y: number, m: number, d: number) => order === 'MDY' ? `${m}/${d}/${y}` : order === 'DMY' ? `${d}/${m}/${y}` : `${y}/${m}/${d}`;
  test(`${order} (compat): invalid calendar days roll over, unchanged`, () => {
    for (const [y, m, d] of INVALID.filter(([, m]) => m >= 1 && m <= 12)) {
      assert.equal(parseDateText(format(y, m, d), order), dayNumber(y, m, d), format(y, m, d));
    }
    for (const [y, m, d] of VALID) assert.equal(parseDateText(format(y, m, d), order), dayNumber(y, m, d));
  });
}
