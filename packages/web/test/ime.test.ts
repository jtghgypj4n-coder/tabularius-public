import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmsComposition, enterActivates } from '../src/ime.ts';

const composing = { key: 'Enter', shiftKey: false, isComposing: true };

test('composition confirmation is detected by the standard and Safari signals', () => {
  assert.equal(confirmsComposition(composing), true);
  assert.equal(confirmsComposition({ keyCode: 229 }), true);
  assert.equal(confirmsComposition({ keyCode: 13 }), false);
});

test('all Enter handlers ignore composition confirmation', () => {
  // Assistant question, find criteria, dashboard Add field and report Ask AI.
  assert.equal(enterActivates(composing), false);
  assert.equal(enterActivates(composing), false);
  assert.equal(enterActivates(composing), false);
  assert.equal(enterActivates(composing, true), false);
  assert.equal(enterActivates({ key: 'Enter', shiftKey: false }), true);
  assert.equal(enterActivates({ key: 'Enter', shiftKey: true }), false);
  assert.equal(enterActivates({ key: 'Enter', shiftKey: true }, true), true);
});
