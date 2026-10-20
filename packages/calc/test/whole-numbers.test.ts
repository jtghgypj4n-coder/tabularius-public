import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText } from '../src/index.ts';

const t = (formula: string) => evaluateText(formula);

test('whole numbers past 2^53 keep every digit through + - *', () => {
  assert.equal(t('12345678901234567890 + 1'), '12345678901234567891');
  assert.equal(t('12345678901234567890 - 12345678901234567889'), '1');
  assert.equal(t('9007199254740993 + 0'), '9007199254740993');
  assert.equal(t('99999999999 * 99999999999'), '9999999999800000000001');
  assert.equal(t('-12345678901234567890 + 0'), '-12345678901234567890');
  assert.equal(t('- 12345678901234567890'), '-12345678901234567890');
});

test('text of digits counts as a whole number, and such numbers compare digit for digit', () => {
  assert.equal(t('"12345678901234567890" + 1'), '12345678901234567891');
  assert.equal(t('12345678901234567890 = 12345678901234567891'), '0');
  assert.equal(t('12345678901234567891 > 12345678901234567890'), '1');
});

test('numbers that fit a double are unchanged, and past 400 digits it is "?"', () => {
  assert.equal(t('0.1 + 0.2'), '0.3');
  assert.equal(t('2 + 3'), '5');
  assert.equal(t('9007199254740991 + 1'), '9007199254740992');
  assert.equal(t('10000000000 * 10000000000'), '100000000000000000000');
  const big = '9'.repeat(399);
  assert.equal(t(`${big} + ${big}`).length, 400);
  assert.equal(t(`${big} * 100`), '?');
});
