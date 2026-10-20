// A two-digit year is read as the year within the next 30 years or the preceding 70 of the current one
// (Claris, "Entering dates with two-digit years", whose table the cases below follow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullYear, parseDateText, fromDayNumber } from '../src/values.ts';
import { evaluateText } from '../src/index.ts';

const year = (text: string, order: 'MDY' | 'DMY' | 'YMD', now: number) => fromDayNumber(parseDateText(text, order, now)!).year;

test('the window is 70 years back and 30 forward, as the Claris table shows', () => {
  assert.equal(fullYear(45, 2015), 2045);
  assert.equal(fullYear(46, 2015), 1946);
  assert.equal(fullYear(46, 2019), 2046);
  assert.equal(fullYear(50, 2019), 1950);
  assert.equal(fullYear(50, 2030), 2050);
  assert.equal(fullYear(76, 2030), 1976);
  assert.equal(fullYear(0, 2026), 2000);
  assert.equal(fullYear(56, 2026), 2056);
  assert.equal(fullYear(57, 2026), 1957);
  assert.equal(fullYear(99, 2026), 1999, 'not 2099');
  assert.equal(fullYear(2024, 2026), 2024, 'four digits stay');
  assert.equal(fullYear(99, 2090), 2099, 'the window moves with the year');
});

test('dates typed with a two-digit year, in every order', () => {
  assert.equal(year('7/4/99', 'MDY', 2026), 1999);
  assert.equal(year('7/4/26', 'MDY', 2026), 2026);
  assert.equal(year('4/7/99', 'DMY', 2026), 1999);
  assert.equal(year('99/7/4', 'YMD', 2026), 1999);
  assert.equal(year('26-7-4', 'YMD', 2026), 2026);
  assert.equal(year('7/4/0099', 'MDY', 2026), 99, 'four digits written with zeros are the year 99');
  assert.equal(year('7/4/2099', 'MDY', 2026), 2099);
});

test('the formulas read the same way', () => {
  const now = new Date().getFullYear();
  const expect = (y: number) => String(fullYear(y, now));
  assert.equal(evaluateText('Year ( GetAsDate ( "7/4/99" ) )'), expect(99));
});
