import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lines, pairs } from '../src/design/script-test-input.ts';

test('script test variables round trip line endings and backslashes', () => {
  for (const ending of ['\n', '\r', '\r\n']) {
    const values = { '$$list': `red${ending}blue`, 'Invoices::Note': `a${ending}b = c`, Path: 'C:\\docs\\new' };
    assert.deepEqual(pairs(lines(values)), values);
  }
});

test('script test values without line breaks or backslashes keep their displayed form', () => {
  const values = { '$x': 'plain = value', Count: '12' };
  assert.equal(lines(values), '$x = plain = value\nCount = 12');
  assert.deepEqual(pairs(lines(values)), values);
});
