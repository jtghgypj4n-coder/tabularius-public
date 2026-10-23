import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText } from '../src/index.ts';

const calc = (formula: string) => evaluateText(formula);

test('decimal addition avoids binary floating point residue', () => assert.equal(calc('0.1 + 0.2'), '0.3'));
test('Round rounds decimal half cases away from zero', () => {
  assert.equal(calc('Round ( 2.675 ; 2 )'), '2.68');
  assert.equal(calc('Round ( 1.005 ; 2 )'), '1.01');
  assert.equal(calc('Round ( 2.5 ; 0 )'), '3');
  assert.equal(calc('Round ( -2.5 ; 0 )'), '-3');
});
test('decimal multiplication retains the expected decimal result', () => assert.equal(calc('1.1 * 1.1 * 1.1'), '1.331'));
test('Mod returns the non-negative remainder for a negative dividend', () => assert.equal(calc('Mod ( -7 ; 3 )'), '2'));
test('numeric equality accepts equivalent numeric forms but text comparison stays textual', () => {
  assert.equal(calc('1.0 = 1'), '1');
  assert.equal(calc('"1.0" = 1'), '0');
});
test('less-than uses text ordering for text and numeric ordering for numbers', () => {
  assert.equal(calc('"10" < "9"'), '1');
  assert.equal(calc('10 < 9'), '0');
});
test('GetAsNumber reads grouped currency text', () => assert.equal(calc('GetAsNumber ( "$1,234.50" )'), '1234.5'));
test('SetPrecision formats the requested decimal precision', () => assert.equal(calc('SetPrecision ( 1/3 ; 30 )'), '0.333333333333333333333333333333'));
