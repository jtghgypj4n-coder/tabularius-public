// A timestamp read for a binary result, and a generate_series call in a catalog query, are read in time linear in the text:
// each pattern used to read a long run of `T` or of blanks once for every position it could split at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINARY_OID, binaryValue, splitTimestamp } from '../src/pgbinary.ts';
import { GENERATE_SERIES, pgSyntax } from '../src/pgcatalog.ts';

const N = 200_000;
const LIMIT_MS = 2000;

function within<T>(f: () => T): T {
  const t = performance.now();
  try {
    return f();
  } finally {
    assert.ok(performance.now() - t < LIMIT_MS, 'took too long: the pattern backtracks');
  }
}

const OLD_TIMESTAMP = /^(\S+)[ T](\S+?)( BC)?$/;

test('splitTimestamp splits every short string as the old pattern did', () => {
  const alphabet = ['T', ' ', 'a', 'B', 'C'];
  let seen = 0;
  const walk = (s: string, left: number) => {
    const old = OLD_TIMESTAMP.exec(s);
    assert.deepEqual(splitTimestamp(s), old ? [old[1], old[2], old[3]] : undefined, JSON.stringify(s));
    seen++;
    if (left) for (const c of alphabet) walk(s + c, left - 1);
  };
  walk('', 7);
  assert.ok(seen > 90_000);
  assert.deepEqual(splitTimestamp('2024-01-02 03:04:05'), ['2024-01-02', '03:04:05', undefined]);
  assert.deepEqual(splitTimestamp('2024-01-02T03:04:05'), ['2024-01-02', '03:04:05', undefined]);
  assert.deepEqual(splitTimestamp('0044-03-15 01:02:03 BC'), ['0044-03-15', '01:02:03', ' BC']);
});

test('a stored value with a long run of T is refused in linear time', () => {
  for (const text of ['T'.repeat(N) + ' a b', 'T'.repeat(N) + 'x y z', 'T'.repeat(N) + ' ' + 'T'.repeat(N) + ' b', 'T'.repeat(N)]) {
    assert.throws(() => within(() => binaryValue(text, BINARY_OID.timestamp)), /not a timestamp|date|time/i);
  }
  assert.ok(binaryValue('2024-01-02 03:04:05', BINARY_OID.timestamp));
});

test('generate_series is rewritten for the same short texts as before, and a long run of blanks takes linear time', () => {
  const OLD = /\bgenerate_series\s*\(\s*((?:[^(),]|\([^()]*\))+?)\s*,\s*((?:[^(),]|\([^()]*\))+?)\s*\)\s+(?:AS\s+)?(\w+)\s*\(\s*(\w+)\s*\)/gi;
  const run = (re: RegExp, s: string) => { re.lastIndex = 0; const m = re.exec(s); return m ? [m.index, m[0], m[1], m[2], m[3], m[4]] : null; };
  const alphabet = ['a', ' ', ',', '(', ')', '1'];
  const walk = (body: string, left: number) => {
    const s = `generate_series(${body}) AS t ( c )`;
    const old = run(OLD, s);
    // The old pattern also took a blank for an argument, and rewrote it to SQL that fails to parse.
    if (!old || (/\S/.test(String(old[2])) && /\S/.test(String(old[3])))) assert.deepEqual(run(GENERATE_SERIES, s), old, JSON.stringify(s));
    if (left) for (const c of alphabet) walk(body + c, left - 1);
  };
  walk('', 6);
  const sql = 'SELECT * FROM pg_class, generate_series(a' + ' '.repeat(N) + 'b';
  assert.equal(within(() => pgSyntax(sql)).includes('generate_series'), true);
  const ok = within(() => pgSyntax('SELECT n FROM pg_class, generate_series(1 , (2 + 3)) AS g (n)'));
  assert.match(ok, /WITH RECURSIVE s\(n\)/);
});
