// A bind parameter or a number field holding a long run of digits that ends in another character is read as "not a
// number" in time linear in its length: the pattern that tells a number from other text must not split the run of
// digits in more than one way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalText } from '../src/pgbinary.ts';
import { textValue } from '../src/pgwire.ts';

const N = 300_000;
const LIMIT_MS = 5000;
function quick<T>(f: () => T): T {
  const t = performance.now();
  const r = f();
  assert.ok(performance.now() - t < LIMIT_MS, 'took too long: the pattern backtracks');
  return r;
}
const NUMERIC = 1700;

test('decimalText and the numeric text format on a long run of digits before a letter', () => {
  const s = '1'.repeat(N) + 'x';
  assert.equal(quick(() => decimalText(s)), undefined);
  assert.equal(quick(() => textValue(s, NUMERIC)), null);
});

test('numbers are still told from other text', () => {
  for (const [text, want] of [['12', '12'], ['-12.5', '-12.5'], ['+7.', '+7.'], ['.5', '.5'], ['1e5', '1e5'], [' 3 ', '3']] as const) {
    assert.equal(textValue(text, NUMERIC)?.toString(), want.trim(), text);
  }
  for (const text of ['', '.', '1.2.3', 'abc', '1e', '$3750']) assert.equal(textValue(text, NUMERIC), null, text);
  assert.equal(decimalText('-12.5'), '-12.5');
  assert.equal(decimalText('1x'), undefined);
});
