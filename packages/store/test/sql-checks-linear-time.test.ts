// FQL0025 (grouping) is checked on queries up to 200,000 characters before any privilege check, so its work must be
// bounded: a long select list over a long GROUP BY expression is compared token by token, and a query that would need
// too many comparisons is left unchecked, like one that is too long.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGrouping } from '../src/sql-checks.ts';

const fields = new Set(['a', 'b']);
const LIMIT_MS = 5000;

test('a long select list over a long GROUP BY expression is checked in bounded time', () => {
  const same = (n: number, w: string) => Array(n).fill(w).join('+');
  for (const [select, group] of [[16_000, 4_000], [30_000, 10_000]] as const) {
    for (const [sw, gw] of [['a', 'b'], ['a', 'a']] as const) {
      const sql = `SELECT ${same(select, sw)} FROM t GROUP BY ${same(group, gw)}`;
      const t = performance.now();
      try { checkGrouping(sql, fields); } catch { /* an error is fine; the time is what is checked */ }
      assert.ok(performance.now() - t < LIMIT_MS, `${sql.length} characters took too long`);
    }
  }
});

test('grouping errors are still found, and repeated grouped expressions still count as grouped', () => {
  assert.throws(() => checkGrouping('SELECT a, COUNT(*) FROM t GROUP BY b', fields), /FQL0025/);
  assert.doesNotThrow(() => checkGrouping('SELECT a + b, COUNT(*) FROM t GROUP BY a + b', fields));
  assert.doesNotThrow(() => checkGrouping('SELECT b AS x, COUNT(*) FROM t GROUP BY x', fields));
  assert.doesNotThrow(() => checkGrouping('SELECT a, SUM(b) FROM t GROUP BY 1', fields));
  assert.throws(() => checkGrouping('SELECT a + b FROM t GROUP BY a + 1', fields), /FQL0025/);
});
