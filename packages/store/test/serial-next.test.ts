import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialNext } from '../src/calc.ts';

const run = (start: string, by: number, n: number) => {
  const out = [start];
  while (out.length < n) out.push(serialNext(out[out.length - 1], by));
  return out;
};

test('decimal serial numbers add exactly', () => {
  assert.deepEqual(run('0.5', 0.1, 4), ['0.5', '0.6', '0.7', '0.8']);
  assert.deepEqual(run('1', 0.25, 4), ['1', '1.25', '1.5', '1.75']);
  assert.deepEqual(run('0.9', 0.1, 3), ['0.9', '1', '1.1']);
});

test('negative serial numbers count up and down through zero', () => {
  assert.deepEqual(run('-2', 1, 5), ['-2', '-1', '0', '1', '2']);
  assert.deepEqual(run('1', -1, 4), ['1', '0', '-1', '-2']);
  assert.deepEqual(run('-0.5', 0.25, 4), ['-0.5', '-0.25', '0', '0.25']);
});

test('serial numbers past 2^53 keep every digit', () => {
  assert.equal(serialNext('123456789012345678', 1), '123456789012345679');
  assert.equal(serialNext('9007199254740993', 2), '9007199254740995');
});

test('text with digits and numbers with leading zeros keep their width', () => {
  assert.equal(serialNext('INV0099', 1), 'INV0100');
  assert.equal(serialNext('007', 1), '008');
  assert.equal(serialNext('99', 1), '100');
});
