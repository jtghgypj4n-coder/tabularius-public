import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited } from '../src/delimited.ts';

test('a last line of just "" is dropped like a blank line, as before streaming', () => {
  assert.deepEqual(parseDelimited('a,b\r\n""', ','), [['a', 'b']]);
  assert.deepEqual(parseDelimited('""', ','), []);
  assert.deepEqual(parseDelimited('"",5\r\n""', ','), [['', '5']]);
  assert.deepEqual(parseDelimited('"",""', ','), [['', '']]);
});
