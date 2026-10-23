import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldRefs } from '../src/script-failure.ts';

test('field references exclude preceding operators, variables and numbers', () => {
  assert.deepEqual(fieldRefs('Set Field [ Orders::Calc ; Orders::Id > 0 and Orders::Id < 9 ]'), ['Orders::Calc', 'Orders::Id']);
  assert.deepEqual(fieldRefs('If [ $a and Orders::Total > 0 ]'), ['Orders::Total']);
  assert.deepEqual(fieldRefs('If [ not Orders::Id ]'), ['Orders::Id']);
  assert.deepEqual(fieldRefs('If [ A::x > 0 or B::y ]'), ['A::x', 'B::y']);
  assert.deepEqual(fieldRefs('If [ 1 XOR Orders::Id > 0 and 2 OR Sales Orders::Total ]'), ['Orders::Id', 'Sales Orders::Total']);
});

test('spaced occurrence names stay whole and quoted references are ignored', () => {
  assert.deepEqual(fieldRefs('Set Field [ Sales Orders::Total ; 1 ]'), ['Sales Orders::Total']);
  assert.deepEqual(fieldRefs('If [ "x and Orders::Id" ]'), []);
});
