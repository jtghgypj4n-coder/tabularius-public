// SQL text comes from a network client (pgwire, the SQL tool, the Data API's SQL). A pattern that ends in `\s*$` or
// ` +$` and may start anywhere is quadratic on a long run it cannot finish: 50,000 characters held the server's one
// thread for seconds. These cases take milliseconds with the scans, and give what the patterns gave.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGrouping } from '../src/sql-checks.ts';
import { containerCastsToName, fetchToLimit, orderKeyParts, trailingWord } from '../src/sql-grammar.ts';
import { SQL_DATE_FUNCTIONS } from '../src/sql-dates.ts';

function quick<T>(f: () => T, limitMs = 500): T {
  const t = performance.now();
  const r = f();
  assert.ok(performance.now() - t < limitMs, `took ${Math.round(performance.now() - t)} ms`);
  return r;
}

const N = 50_000;

test('a long name in a CAST operand is found in one pass', () => {
  const sql = `SELECT CAST(${'a'.repeat(N)} . b AS VARCHAR) FROM t`;
  assert.equal(quick(() => containerCastsToName(sql, () => false)), sql);
  assert.equal(containerCastsToName('SELECT CAST(t . "Pic" AS VARCHAR) FROM t', (n) => n === 'Pic'), 'SELECT (SELECT filename FROM _fm_containers WHERE id = t . "Pic") FROM t');
  assert.equal(containerCastsToName('SELECT CAST("a""b" AS VARCHAR(5)) FROM t', (n) => n === 'a"b'), 'SELECT (SELECT filename FROM _fm_containers WHERE id = "a""b") FROM t');
});

test('a select item that ends in a long word and a bracket is checked in one pass', () => {
  const fields = new Set(['dept']);
  quick(() => checkGrouping(`SELECT ${'a'.repeat(N)}) x FROM t GROUP BY dept`, fields));
  quick(() => fetchToLimit(`SELECT ${'a'.repeat(N)}) x FROM t ORDER BY x FETCH FIRST 2 ROWS WITH TIES`));
});

test('an ORDER BY key with a long run of blanks is split in one pass', () => {
  quick(() => orderKeyParts(`a${' '.repeat(N)}x`));
  quick(() => fetchToLimit(`SELECT a FROM t ORDER BY a${' '.repeat(N)}x FETCH FIRST 2 ROWS WITH TIES`));
  assert.deepEqual(orderKeyParts('a DESC'), { expression: 'a', direction: ' DESC' });
  assert.deepEqual(orderKeyParts('  a  asc  '), { expression: 'a', direction: '  asc' });
  assert.deepEqual(orderKeyParts('DESC'), { expression: 'DESC' });
  assert.deepEqual(orderKeyParts('xDESC'), { expression: 'xDESC' });
});

test('CONCAT of text with a long run of trailing spaces is quick', () => {
  const catb = SQL_DATE_FUNCTIONS.fm_catb;
  assert.equal(quick(() => catb(`a${' '.repeat(N)}x`, 'b')), `a${' '.repeat(N)}xb`);
  assert.equal(catb('a  ', 'b '), 'ab   ');
});

// The patterns the scans replace, against the scans, on every short string over an alphabet that has the cases.
const alphabet = ['a', '_', ' ', '\n', 'D', 'E', 'S', 'C', 'A', ')', '.'];
function* strings(max: number): Generator<string> {
  const walk = function* (prefix: string, left: number): Generator<string> {
    yield prefix;
    if (!left) return;
    for (const c of alphabet) yield* walk(prefix + c, left - 1);
  };
  yield* walk('', max);
}

test('the scans agree with the patterns they replaced', () => {
  let n = 0;
  for (const s of strings(6)) {
    n++;
    const word = /(\w+)\s*$/.exec(s)?.[1];
    assert.equal(trailingWord(s), word, JSON.stringify(s));
    const m = /^\s*([\s\S]*?)(\s+(?:ASC|DESC))?\s*$/i.exec(s)!;
    const parts = orderKeyParts(s);
    assert.equal(parts.expression, m[1].trim(), JSON.stringify(s));
    assert.equal(parts.direction?.trim().toUpperCase(), m[2]?.trim().toUpperCase(), JSON.stringify(s));
  }
  assert.ok(n > 100_000);
});

/** containerCastsToName as it was: the field name taken from the operand by `(name)\s*$`. */
function oldCasts(sql: string, isContainer: (name: string) => boolean): string {
  const cast = /\bCAST\s*\(\s*((?:(?:"(?:[^"]|"")+"|[A-Za-z_]\w*)\s*\.\s*)?(?:"(?:[^"]|"")+"|[A-Za-z_]\w*))\s+AS\s+VARCHAR(?:\s*\(\s*\d+\s*\))?\s*\)/gi;
  return sql.replace(cast, (whole, operand: string) => {
    const field = /(?:"((?:[^"]|"")+)"|([A-Za-z_]\w*))\s*$/.exec(operand);
    const name = field?.[1]?.replace(/""/g, '"') ?? field?.[2];
    return name && isContainer(name) ? `(SELECT filename FROM _fm_containers WHERE id = ${operand})` : whole;
  });
}

test('the CAST operand names are the same as the pattern found', () => {
  const names = ['a', '_1', 'Pic', '"Pic"', '"x""y"', '"a b"', 'AS'];
  const seen: string[] = [];
  for (const q of ['', ...names.flatMap((n) => [`${n}.`, `${n} . `, `${n} .`])]) {
    for (const f of names) {
      for (const space of ['', '  ']) {
        const sql = `SELECT CAST(${space}${q}${f} AS VARCHAR(10)) FROM t`;
        for (const is of [(n: string) => n === 'Pic', (n: string) => n === 'x"y', () => true, () => false]) {
          assert.equal(containerCastsToName(sql, is), oldCasts(sql, is), sql);
        }
        seen.push(sql);
      }
    }
  }
  assert.ok(seen.length > 300);
});
