import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsAt, pagesHolding } from '../src/updating.ts';

test('records still updating are fetched again a page at a time, once per page', () => {
  const cache = new Map<number, { recordId: string }>();
  for (let i = 0; i < 120; i++) cache.set(i, { recordId: String(i + 1) });
  // Fifty records of one page and one of another: two fetches, not fifty-one.
  const ids = [...Array.from({ length: 50 }, (_, i) => String(i + 1)), '101'];
  assert.deepEqual([...pagesHolding(cache, ids, 50)].sort((a, b) => a - b), [0, 100]);
  // Records no longer in the found set (another layout, a new find) fetch nothing.
  assert.equal(pagesHolding(cache, ['999'], 50).size, 0);
});

test('a page fetched again is compared by position, so records that moved meanwhile are noticed', () => {
  const cache = new Map<number, { recordId: string }>([[50, { recordId: 'a' }], [51, { recordId: 'b' }]]);
  const was = idsAt(cache, 50, 3);
  assert.deepEqual(was, ['a', 'b', undefined]);
  cache.set(50, { recordId: 'b' });
  cache.set(51, { recordId: 'c' });
  const now = idsAt(cache, 50, 3);
  assert.ok(was.some((id, i) => id !== undefined && id !== now[i]));
});
