import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText } from '../src/index.ts';

// FileMaker computes in decimal, so money maths shows no binary noise. The engine uses doubles and drops the noise
// from the result of each + - * / ^ (values.ts tidy).
const e = (f: string) => evaluateText(f);

test('sums, differences and products of short decimals are exact', () => {
  assert.equal(e('0.7 + 0.1'), '0.8');
  assert.equal(e('1 - 0.9'), '0.1');
  assert.equal(e('4.35 * 100'), '435');
  assert.equal(e('1.1 * 1.1'), '1.21');
  assert.equal(e('100 * 1.07'), '107');
  assert.equal(e('0.3 / 0.1'), '3');
  assert.equal(e('10 ^ -2'), '0.01');
});

test('comparisons and rounding follow', () => {
  assert.equal(e('0.1 + 0.2 = 0.3'), '1');
  assert.equal(e('4.35 * 100 = 435'), '1');
  assert.equal(e('Int ( 4.35 * 100 )'), '435');
  assert.equal(e('Int ( 19.99 * 100 )'), '1999');
  assert.equal(e('Floor ( 0.29 * 100 )'), '29');
  assert.equal(e('Mod ( 4.35 * 100 ; 5 )'), '0');
  assert.equal(e('Sum ( 0.1 ; 0.2 ) = 0.1 + 0.2'), '1');
});

test('a result that needs all its digits keeps them', () => {
  assert.equal(e('1 / 3'), '0.3333333333333333');
  assert.equal(e('2 / 3 * 3'), '2');
  assert.equal(e('1 / 3 + 0.1'), '0.4333333333333333');
  assert.equal(e('2 ^ 0.5'), '1.414213562373095');
  assert.equal(e('Sqrt ( 2 ) * Sqrt ( 2 )'), '2');
});

test('whole numbers, dates and times are not touched', () => {
  assert.equal(e('3 * 7'), '21');
  assert.equal(e('1000000 * 1000000'), '1000000000000');
  assert.equal(e('GetAsDate ( "1/31/2024" ) + 1'), '2/1/2024');
});
