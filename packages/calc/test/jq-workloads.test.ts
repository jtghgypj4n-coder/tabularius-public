import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJq, jqCompare } from '../src/jq.ts';

const compact = { compact: true };

test('jq reduce builds a 40 KB string without charging the prefix repeatedly', () => {
  const items = Array(2000).fill('abcdefghijklmnopqrst');
  assert.equal(runJq(JSON.stringify(items), 'reduce .[] as $x (""; . + $x)', { raw: true }), items.join(''));
});

test('jq reduce appends 20,000 array entries without charging copied entries repeatedly', () => {
  const items = Array.from({ length: 20_000 }, (_, i) => i);
  assert.deepEqual(JSON.parse(runJq(JSON.stringify(items), 'reduce .[] as $x ([]; . + [$x])', compact)), items);
});

test('jq reduce builds 5,000 object entries while preserving earlier values', () => {
  const items = Array.from({ length: 5000 }, (_, i) => ({ name: `key${i}`, v: i }));
  assert.deepEqual(JSON.parse(runJq(JSON.stringify(items), 'reduce .[] as $x ({}; .[$x.name] = $x.v)', compact)),
    Object.fromEntries(items.map(x => [x.name, x.v])));
  assert.equal(runJq('{"a":1}', '. as $old | .a = 2 | [$old, .]', compact), '[{"a":1},{"a":2}]');
});

test('jq sort_by handles 50,000 shuffled objects and compares Unicode code points', () => {
  const items = Array.from({ length: 50_000 }, (_, i) => ({ name: `name${String(i * 7919 % 50_000).padStart(5, '0')}` }));
  assert.deepEqual(JSON.parse(runJq(JSON.stringify(items), 'sort_by(.name)', compact)),
    [...items].sort((a, b) => a.name.localeCompare(b.name)));
  for (const [a, b, expected] of [
    ['a', 'aa', -1], ['😀', '😀a', -1], ['\ue000', '😀', -1],
    ['😀a', '😀b', -1], ['\ud800', 'a', 1], ['😀', '😀', 0],
  ] as const) {
    assert.equal(Math.sign(jqCompare(a, b)), expected);
    assert.equal(Math.sign(jqCompare(b, a)), expected === 0 ? 0 : -expected);
  }
});

test('jq repeated builtins charge work without reallocating their 1 MB input', () => {
  const input = JSON.stringify('x'.repeat(1_000_000));
  assert.equal(runJq(input, '. as $s | [range(40) | $s | ascii_downcase] | length'), '40');
  assert.equal(runJq(input, '. as $s | [range(40) | $s | ascii_downcase | length]', compact), JSON.stringify(Array(40).fill(1_000_000)));
  // The same intermediate is allowed, but returning 40 MB still exceeds the output cap.
  assert.throws(() => runJq(input, '. as $s | [range(40) | $s | ascii_downcase]', compact), /resource limit/i);
});
