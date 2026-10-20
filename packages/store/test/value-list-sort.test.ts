// valueListOrder (store/src/value-list-sort.ts): the order a value list gives its field's values, shared by the stored
// fields and the script engine's evaluated ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, text } from '../../calc/src/index.ts';
import { valueListOrder } from '../src/value-list-sort.ts';

test('numbers match by value: 2 and 2.0 and "1,000" are the listed values, blanks are not listed', () => {
  const o = valueListOrder({ type: 'number' }, 'MDY', ['10', '2', ' ', '2.0', '1,000']);
  assert.deepEqual([...o.ranks], [['number:10', 0], ['number:2', 1], ['number:1000', 2]]);
  assert.equal(o.rank(num(2)), 1);
  assert.equal(o.rank(text(' 10 ')), 0);
  assert.equal(o.rank(num(1000)), 2);
});

test('listed values come in list order; the rest follow, ordered by their text', () => {
  const o = valueListOrder({ type: 'number' }, 'MDY', ['10', '2']);
  assert.ok(o.compare(num(10), num(2)) < 0, 'list order, not numeric order');
  assert.equal(o.compare(num(2), num(2)), 0);
  assert.equal(o.rank(num(99)), o.ranks.size, 'unlisted values rank after every listed one');
  assert.ok(o.compare(num(2), num(99)) < 0);
  assert.equal(o.compare(num(97), num(97)), 0);
  assert.ok(o.compare(num(3), num(4)) < 0);
});

test('text matches without regard to case or accents composed differently, and an unlisted blank sorts last', () => {
  const o = valueListOrder({ type: 'text' }, 'MDY', ['Banana', 'apple', 'APPLE', 'Éclair', 'Éclair']);
  assert.equal(o.ranks.size, 3, 'apple and APPLE are one value, and so are the two spellings of Éclair');
  assert.equal(o.rank(text('Apple')), 1);
  assert.equal(o.rank(text('banana')), 0);
  assert.equal(o.rank(text('zzz')), 3);
  assert.ok(o.compare(text('zzz'), text('')) < 0, 'blank last');
  assert.ok(o.compare(text(''), text('zzz')) > 0);
  assert.equal(o.compare(text(''), text('')), 0);
});

test('dates match by day whatever the written form, in the file\'s date order', () => {
  const o = valueListOrder({ type: 'date' }, 'DMY', ['05/09/2026', '1/2/2027']);
  assert.equal(o.ranks.size, 2);
  assert.equal(o.rank(text('5/9/2026')), 0, 'padding does not matter');
  assert.equal(o.rank(text('01/02/2027')), 1);
  const us = valueListOrder({ type: 'date' }, 'MDY', ['05/09/2026']);
  assert.notEqual(us.rank(text('09/05/2026')), 0, 'the other order is another day');
});

test('the Japanese index language folds with Japanese collation, not English', () => {
  const ja = valueListOrder({ type: 'text', options: { indexLanguage: 'Japanese' } } as never, 'MDY', ['あ']);
  const en = valueListOrder({ type: 'text' }, 'MDY', ['あ']);
  assert.equal(ja.textKey(text('あ')) === en.textKey(text('あ')), false);
});
