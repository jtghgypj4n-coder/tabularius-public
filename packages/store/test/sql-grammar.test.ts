// The translation of FileMaker SQL's grammar to SQLite, one rewrite at a time: OFFSET and FETCH FIRST, the star,
// joins and quantified comparisons, ^, ROUND, and + and - on strings and dates. The server's sql-grammar test runs the
// whole grammar through ExecuteSQL and the SQL connection; these pin the edges of each rewrite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { fileMakerSqlSyntax } from '../src/sql-dates.ts';
import { anyAllToIn, containerCastsToName, expandStars, fetchToLimit, refuseUnsupportedJoins } from '../src/sql-grammar.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-grammar-'));
  createStore(join(dir, 't.sqlite'));
  store = new Store(join(dir, 't.sqlite'), 'T');
  store.applyDesign([
    { op: 'createTable', name: 'P', fields: [{ name: 'First', type: 'text' }, { name: 'Last', type: 'text' }, { name: 'Born', type: 'date' }, { name: 'Pay', type: 'number' }] },
    { op: 'createTable', name: 'Q', fields: [{ name: 'Last', type: 'text' }, { name: 'Note', type: 'text' }] },
    { op: 'createTable', name: 'C', fields: [{ name: 'Code', type: 'text' }] },
    { op: 'createTable', name: 'W', fields: [{ name: 'Name', type: 'text' }, { name: 'N', type: 'number' }] },
  ] as never);
  for (const [Name, N] of [['a', 1], ['b', 2], ['c', 2], ['d', 2], ['e', 3]]) store.create('W', { Name, N: String(N) });
  store.create('C', { Code: '5' });
  store.create('C', { Code: '7' });
  store.create('P', { First: 'Ann', Last: 'Lee', Born: '3/15/2000', Pay: '10' }, { dateOrder: 'MDY' });
  store.create('P', { First: 'Bo', Last: 'Park', Born: '12/31/1999', Pay: '20' }, { dateOrder: 'MDY' });
  store.create('Q', { Last: 'Lee', Note: 'n1' });
});

after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const run = (query: string, params: (string | number)[] = []) => {
  const { sql, target } = store.calc.translateSQL(query);
  return target.select(sql, params, 100);
};
const rows = (query: string) => run(query).rows;

test('container CAST uses the file name and leaves other CASTs, quoted text, and parameters alone', () => {
  const query = "SELECT CAST(Pic AS VARCHAR), CAST(Pay AS VARCHAR), 'CAST(Pic AS VARCHAR)' FROM P WHERE First = ?";
  assert.equal(containerCastsToName(query, (name) => name === 'Pic'),
    "SELECT (SELECT filename FROM _fm_containers WHERE id = Pic), CAST(Pay AS VARCHAR), 'CAST(Pic AS VARCHAR)' FROM P WHERE First = ?");
  assert.equal(containerCastsToName('SELECT CAST("Pic" AS VARCHAR) -- CAST(Pic AS VARCHAR)', (name) => name === 'Pic'),
    'SELECT (SELECT filename FROM _fm_containers WHERE id = "Pic") -- CAST(Pic AS VARCHAR)');
});

test('OFFSET and FETCH FIRST become LIMIT and OFFSET at the top of the query only', () => {
  assert.match(fetchToLimit('SELECT a FROM t ORDER BY a OFFSET 5 ROWS'), /^SELECT a FROM t ORDER BY a\s+LIMIT -1 OFFSET 5$/);
  assert.match(fetchToLimit('SELECT a FROM t FETCH FIRST ROW ONLY'), /LIMIT 1 OFFSET 0$/);
  assert.match(fetchToLimit('SELECT a FROM t FETCH NEXT 3 ROWS ONLY;'), /LIMIT 3 OFFSET 0;?$/);
  assert.match(fetchToLimit('SELECT a FROM t OFFSET 2 ROW FETCH FIRST 4 ROWS ONLY'), /LIMIT 4 OFFSET 2$/);
  // Text that merely contains the words is left alone.
  assert.equal(fetchToLimit("SELECT a FROM t WHERE b = 'OFFSET 2 ROWS' -- FETCH FIRST 2 ROWS ONLY"), "SELECT a FROM t WHERE b = 'OFFSET 2 ROWS' -- FETCH FIRST 2 ROWS ONLY");
  assert.equal(fetchToLimit('SELECT "FETCH FIRST 1 ROWS ONLY" FROM t'), 'SELECT "FETCH FIRST 1 ROWS ONLY" FROM t');
  assert.throws(() => fetchToLimit('SELECT a FROM t FETCH FIRST 0 ROWS ONLY'), /at least 1/);
  assert.throws(() => fetchToLimit('SELECT a FROM t FETCH FIRST 2 ROWS WITH TIES'), /needs an ORDER BY/);
  assert.throws(() => fetchToLimit('SELECT DISTINCT a FROM t ORDER BY a FETCH FIRST 2 ROWS WITH TIES'), /WITH TIES with DISTINCT, UNION/);
  assert.throws(() => fetchToLimit('SELECT a FROM t UNION SELECT b FROM u ORDER BY a FETCH FIRST 2 ROWS WITH TIES'), /not supported/);
  assert.throws(() => fetchToLimit('SELECT a FROM t ORDER BY 3 FETCH FIRST 2 ROWS WITH TIES'), /ORDER BY 3 is not a column/);
  assert.throws(() => fetchToLimit('SELECT a FROM t ORDER BY a FETCH FIRST 0 ROWS WITH TIES'), /at least 1/);
  assert.throws(() => fetchToLimit('SELECT a FROM t ORDER BY a FETCH FIRST 2 PERCENT ROWS ONLY'), /PERCENT is not supported/);
  assert.throws(() => fetchToLimit('SELECT a FROM t WHERE a IN (SELECT a FROM t FETCH FIRST 2 ROWS ONLY)'), /in a subquery is not supported/);
  assert.throws(() => fetchToLimit('SELECT a FROM t WHERE a IN (SELECT a FROM t OFFSET 1 ROW)'), /in a subquery is not supported/);
  // A subquery's own text beside a top-level clause: the top-level one still works.
  assert.match(fetchToLimit("SELECT (SELECT 'FETCH FIRST 1 ROW ONLY') FROM t FETCH FIRST 2 ROWS ONLY"), /LIMIT 2 OFFSET 0$/);
});

test('FETCH FIRST returns the rows asked for', () => {
  assert.deepEqual(rows('SELECT First FROM P ORDER BY First OFFSET 1 ROW FETCH FIRST ROW ONLY'), [['Bo']]);
  assert.deepEqual(rows("SELECT First FROM P WHERE First = 'FETCH FIRST 1 ROW ONLY'"), []);
});

test('RIGHT and FULL OUTER JOIN are refused; the words in a string or a name are not', () => {
  assert.throws(() => refuseUnsupportedJoins('SELECT * FROM a RIGHT OUTER JOIN b ON a.x = b.x'), /RIGHT OUTER JOIN is not supported/);
  assert.throws(() => refuseUnsupportedJoins('select * from a full join b on a.x = b.x'), /FULL OUTER JOIN is not supported/);
  assert.throws(() => rows('SELECT * FROM P RIGHT JOIN Q ON P.Last = Q.Last'), /not supported/);
  refuseUnsupportedJoins("SELECT 'a RIGHT JOIN b' FROM t -- FULL OUTER JOIN");
  refuseUnsupportedJoins('SELECT * FROM a LEFT OUTER JOIN b ON a.x = b.x INNER JOIN c ON c.x = a.x');
  assert.equal(rows('SELECT P.Last FROM P LEFT OUTER JOIN Q ON P.Last = Q.Last ORDER BY P.First').length, 2);
});

test('= ANY and <> ALL are IN and NOT IN; the other quantified comparisons are EXISTS over the subquery', () => {
  assert.equal(anyAllToIn('SELECT 1 WHERE a = ANY (SELECT b FROM t)'), 'SELECT 1 WHERE a IN (SELECT b FROM t)');
  assert.equal(anyAllToIn('SELECT 1 WHERE a = SOME(SELECT b FROM t)'), 'SELECT 1 WHERE a IN (SELECT b FROM t)');
  assert.equal(anyAllToIn('SELECT 1 WHERE a <> ALL (SELECT b FROM t)'), 'SELECT 1 WHERE a NOT IN (SELECT b FROM t)');
  assert.equal(anyAllToIn('SELECT 1 WHERE a != ALL (SELECT b FROM t)'), 'SELECT 1 WHERE a NOT IN (SELECT b FROM t)');
  assert.equal(anyAllToIn('SELECT 1 WHERE a > ALL (SELECT b FROM t)'), 'SELECT 1 WHERE NOT EXISTS (WITH fm_q(fm_v) AS (SELECT b FROM t) SELECT 1 FROM fm_q WHERE NOT COALESCE(a > fm_v, 0))');
  assert.equal(anyAllToIn('SELECT 1 WHERE t.a <= SOME (SELECT b FROM t)'), 'SELECT 1 WHERE EXISTS (WITH fm_q(fm_v) AS (SELECT b FROM t) SELECT 1 FROM fm_q WHERE t.a <= fm_v)');
  assert.equal(anyAllToIn('SELECT 1 WHERE a != ANY (SELECT b FROM t)'), 'SELECT 1 WHERE EXISTS (WITH fm_q(fm_v) AS (SELECT b FROM t) SELECT 1 FROM fm_q WHERE a <> fm_v)');
  // Part of a longer expression on the left: not this operand alone, so left for SQLite to report.
  assert.equal(anyAllToIn('SELECT 1 WHERE a + b > ALL (SELECT b FROM t)'), 'SELECT 1 WHERE a + b > ALL (SELECT b FROM t)');
  assert.equal(anyAllToIn("SELECT 1 WHERE a || 'x' > ALL (SELECT b FROM t)"), "SELECT 1 WHERE a || 'x' > ALL (SELECT b FROM t)");
  assert.equal(anyAllToIn("SELECT '= ANY (' FROM t"), "SELECT '= ANY (' FROM t");
  assert.deepEqual(rows('SELECT First FROM P WHERE Last = ANY (SELECT Last FROM Q)'), [['Ann']]);
  assert.deepEqual(rows('SELECT First FROM P WHERE Last <> ALL (SELECT Last FROM Q)'), [['Bo']]);
  // Run: ALL over nothing is true, ANY over nothing false, a NULL keeps ALL from being true, two columns is an error,
  // and a nested pair works.
  assert.deepEqual(rows('SELECT First FROM P WHERE Pay > ALL (SELECT Pay FROM P WHERE First = \'Ann\')'), [['Bo']]);
  assert.deepEqual(rows('SELECT First FROM P WHERE Pay < ANY (SELECT Pay FROM P WHERE First = \'Bo\')'), [['Ann']]);
  assert.deepEqual(rows('SELECT First FROM P WHERE Pay > ALL (SELECT Pay FROM P WHERE First = \'Nobody\') ORDER BY First'), [['Ann'], ['Bo']]);
  assert.deepEqual(rows('SELECT First FROM P WHERE Pay > ANY (SELECT Pay FROM P WHERE First = \'Nobody\')'), []);
  assert.deepEqual(rows('SELECT First FROM P WHERE Pay >= ALL (SELECT Pay FROM P UNION ALL SELECT NULL)'), []);
  assert.throws(() => rows('SELECT First FROM P WHERE Pay > ALL (SELECT Pay, First FROM P)'));
  assert.deepEqual(rows('SELECT First FROM P WHERE Pay > ALL (SELECT Pay FROM P WHERE Pay < ANY (SELECT Pay FROM P WHERE First = \'Ann\'))'), [['Ann'], ['Bo']]);
});

test('FETCH FIRST n ROWS WITH TIES adds the rows that sort equal to the last one wanted', () => {
  const names = (query: string) => rows(query).map((r) => r[0]).sort();
  assert.deepEqual(names('SELECT Name FROM W ORDER BY N FETCH FIRST 2 ROWS WITH TIES'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(names('SELECT Name FROM W ORDER BY N FETCH FIRST 1 ROWS WITH TIES'), ['a']);
  assert.deepEqual(names('SELECT Name FROM W ORDER BY N DESC FETCH FIRST 1 ROW WITH TIES'), ['e']);
  assert.deepEqual(names('SELECT Name FROM W ORDER BY N OFFSET 1 ROWS FETCH FIRST 1 ROWS WITH TIES'), ['b', 'c', 'd']);
  assert.deepEqual(names('SELECT Name FROM W ORDER BY N OFFSET 4 ROWS FETCH FIRST 3 ROWS WITH TIES'), ['e']);
  assert.deepEqual(names('SELECT Name FROM W ORDER BY N OFFSET 9 ROWS FETCH FIRST 3 ROWS WITH TIES'), []);
  assert.deepEqual(names('SELECT Name FROM W WHERE N > 1 ORDER BY N FETCH FIRST 1 ROWS WITH TIES'), ['b', 'c', 'd']);
  // An alias and a position name a column of the select list; a name that is also in a string is untouched.
  assert.deepEqual(names('SELECT Name, N AS rank FROM W ORDER BY rank FETCH FIRST 2 ROWS WITH TIES'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(names('SELECT Name, N * 2 FROM W ORDER BY 2 FETCH FIRST 2 ROWS WITH TIES'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(names("SELECT 'ORDER BY x FROM y' AS label, N FROM W ORDER BY N FETCH FIRST 1 ROWS WITH TIES").length, 1);
  // Two keys: a tie is equality on both.
  assert.deepEqual(names('SELECT Name FROM W ORDER BY N, Name FETCH FIRST 2 ROWS WITH TIES'), ['a', 'b']);
  // A query that already has a subquery and a WITH of its own.
  assert.deepEqual(names('WITH w2 AS (SELECT * FROM W) SELECT Name FROM w2 WHERE N IN (SELECT N FROM W WHERE N < 3) ORDER BY N FETCH FIRST 2 ROWS WITH TIES'), ['a', 'b', 'c', 'd']);
});

test('a star lists the fields, not the record\'s internal columns', () => {
  const columns = (query: string) => run(query).names;
  assert.deepEqual(columns('SELECT * FROM P'), ['First', 'Last', 'Born', 'Pay']);
  assert.deepEqual(columns('SELECT x.* FROM P x'), ['First', 'Last', 'Born', 'Pay']);
  assert.deepEqual(columns('SELECT DISTINCT * FROM P'), ['First', 'Last', 'Born', 'Pay']);
  assert.deepEqual(columns('SELECT P.*, Q.Note FROM P, Q'), ['First', 'Last', 'Born', 'Pay', 'Note']);
  assert.deepEqual(columns('SELECT * FROM P INNER JOIN Q ON P.Last = Q.Last'), ['First', 'Last', 'Born', 'Pay', 'Last', 'Note']);
  assert.deepEqual(columns('SELECT * FROM (SELECT * FROM P) t'), ['First', 'Last', 'Born', 'Pay']);
  assert.deepEqual(columns('SELECT "First", * FROM "P"'), ['First', 'First', 'Last', 'Born', 'Pay']);
  // Unrelated stars and the internal columns asked for by name are untouched.
  assert.deepEqual(columns('SELECT COUNT(*) FROM P'), ['COUNT(*)']);
  assert.deepEqual(columns('SELECT Pay * 2 AS twice, ROWID FROM P').slice(0, 1), ['twice']);
  assert.equal(rows('SELECT ROWID, ROWMODID FROM P').length, 2);
  assert.deepEqual(columns('SELECT * FROM FileMaker_Tables').slice(0, 2), ['TableName', 'TableId']);
});

test('expandStars leaves a select list alone when it cannot name the tables', () => {
  const columnsOf = (name: string) => (name.toLowerCase() === 't' ? ['a', '_fm_record_id', 'b'] : undefined);
  assert.equal(expandStars('SELECT * FROM t', columnsOf), 'SELECT t."a", t."b" FROM t');
  assert.equal(expandStars('SELECT * FROM t, other', columnsOf), 'SELECT * FROM t, other');
  assert.equal(expandStars('SELECT * FROM t, other o', columnsOf), 'SELECT t."a", t."b", o.* FROM t, other o');
  assert.equal(expandStars("SELECT '*' FROM t", columnsOf), "SELECT '*' FROM t");
  assert.equal(expandStars('SELECT 2 * 3 FROM t', columnsOf), 'SELECT 2 * 3 FROM t');
  assert.equal(expandStars('SELECT x.* FROM t x LEFT OUTER JOIN t y ON x.a = y.a', columnsOf), 'SELECT x."a", x."b" FROM t x LEFT OUTER JOIN t y ON x.a = y.a');
});

test('^ and ** are exponents, with the minus in front belonging to the base', () => {
  const one = (q: string) => rows(q)[0][0];
  assert.equal(one('SELECT 2 ^ 3 FROM P'), 8);
  assert.equal(one('SELECT 2 ** 3 FROM P'), 8);
  assert.equal(one('SELECT -2 ^ 2 FROM P'), 4);
  assert.equal(one('SELECT 5 - 2 ^ 2 FROM P'), 1);
  assert.equal(one('SELECT 2 * 3 ^ 2 FROM P'), 18);
  assert.equal(one('SELECT 2 ^ -1 FROM P'), 0.5);
  assert.equal(one('SELECT (1 + 1) ^ 3 FROM P'), 8);
  assert.equal(one('SELECT 2 ^ (1 + 2) FROM P'), 8);
  assert.equal(one('SELECT ABS(-2) ^ 2 FROM P'), 4);
  assert.equal(one("SELECT '2 ^ 3' FROM P"), '2 ^ 3');
  assert.equal(one('SELECT COUNT(*) FROM P'), 2);
  assert.equal(fileMakerSqlSyntax('SELECT 2 ^ 3'), 'SELECT power(2, 3)');
});

test('ROUND rounds half away from zero, in decimal, and accepts negative digits', () => {
  const one = (q: string) => rows(q)[0][0];
  assert.equal(one('SELECT ROUND(123.456, 0) FROM P'), 123);
  assert.equal(one('SELECT ROUND(123.456, 2) FROM P'), 123.46);
  assert.equal(one('SELECT ROUND(123.456, -2) FROM P'), 100);
  assert.equal(one('SELECT ROUND(155, -1) FROM P'), 160);
  assert.equal(one('SELECT ROUND(-2.5, 0) FROM P'), -3);
  assert.equal(one('SELECT ROUND(1.005, 2) FROM P'), 1.01);
  assert.equal(one('SELECT ROUND(2.5) FROM P'), 3);
  assert.equal(one('SELECT ROUND(NULL, 2) FROM P'), null);
  assert.equal(one("SELECT 'ROUND(' FROM P"), 'ROUND(');
});

test('+ and - join strings (and - moves the blanks to the end)', () => {
  const one = (q: string) => rows(q)[0][0];
  assert.equal(one("SELECT 'a' + 'b' FROM P"), 'ab');
  assert.equal(one("SELECT 'ROBERT ' - 'JONES ' FROM P"), 'ROBERTJONES  ');
  assert.equal(one("SELECT First + ' ' + Last FROM P WHERE First = 'Ann'"), 'Ann Lee');
  assert.equal(one("SELECT First + Last FROM P WHERE First = 'Ann'"), 'AnnLee');
  assert.equal(one("SELECT UPPER(First) + '!' + Last FROM P WHERE First = 'Ann'"), 'ANN!Lee');
  assert.equal(one("SELECT 'n=' + STRVAL(1 + 2) FROM P"), 'n=3');
  assert.equal(one("SELECT 'a' + NULL FROM P"), null);
  // Plain numbers keep SQLite's arithmetic.
  assert.equal(one('SELECT 1 + 2 FROM P'), 3);
  assert.equal(one('SELECT Pay - 1 FROM P WHERE First = \'Ann\''), 9);
  assert.equal(one("SELECT -1 FROM P"), -1);
  // Intervals are for the interval rewrite, and a comment or a string is not an operator.
  assert.equal(fileMakerSqlSyntax("SELECT 'x' + INTERVAL 1 DAY"), "SELECT fm_date_add('x', 1, 'DAY', 1)");
  assert.equal(fileMakerSqlSyntax("SELECT 1 -- 'a' + 'b'"), "SELECT 1 -- 'a' + 'b'");
  assert.equal(fileMakerSqlSyntax("SELECT '+' , 'a-b'"), "SELECT '+' , 'a-b'");
});

test('+ and - on dates are days', () => {
  const one = (q: string) => rows(q)[0][0];
  assert.equal(one("SELECT Born + 5 FROM P WHERE First = 'Ann'"), '2000-03-20');
  assert.equal(one("SELECT Born - 15 FROM P WHERE First = 'Ann'"), '2000-02-29');
  assert.equal(one("SELECT 5 + Born FROM P WHERE First = 'Ann'"), '2000-03-20');
  assert.equal(one("SELECT Born - DATE '2000-03-01' FROM P WHERE First = 'Ann'"), 14);
  assert.equal(one("SELECT {d '2000-03-01'} + 1 FROM P"), '2000-03-02');
  assert.equal(one("SELECT DATEVAL('2000-03-01') - 1 FROM P"), '2000-02-29');
  assert.equal(one('SELECT CURRENT_DATE - CURRENT_DATE FROM P'), 0);
  assert.equal(one("SELECT Born + 1 + 1 FROM P WHERE First = 'Bo'"), '2000-01-02');
  assert.equal(one("SELECT Born - Born + Pay FROM P WHERE First = 'Bo'"), 20);
  // A date plus an interval is the interval rewrite's.
  assert.equal(one("SELECT Born + INTERVAL 1 DAY FROM P WHERE First = 'Ann'"), '2000-03-16');
  // A field of the same name in two tables with different types is not taken as a date or a string.
  assert.equal(one('SELECT Pay + 1 FROM P WHERE Pay = 10'), 11);
});

test('a date, time or timestamp constant that is not one is an error when the query runs', () => {
  assert.throws(() => rows("SELECT DATE '2020-13-45' FROM P"), /Invalid date constant '2020-13-45'/);
  assert.throws(() => rows("SELECT {d '2020-02-30'} FROM P"), /Invalid date constant/);
  assert.throws(() => rows("SELECT TIMESTAMP '2020-13-45 10:00:00' FROM P"), /Invalid timestamp constant/);
  assert.equal(rows("SELECT DATE '2020-02-29' FROM P")[0][0], '2020-02-29');
  assert.equal(rows("SELECT DATEVAL('2020-13-45') FROM P")[0][0], null);
  assert.equal(fileMakerSqlSyntax(fileMakerSqlSyntax("SELECT DATE '2020-13-45'")), fileMakerSqlSyntax("SELECT DATE '2020-13-45'"));
});

test('FileMaker_BaseTables and FileMaker_BaseTableFields describe the tables, once each', () => {
  assert.deepEqual(rows('SELECT BaseTableName FROM FileMaker_BaseTables ORDER BY BaseTableName'), [['C'], ['P'], ['Q'], ['W']]);
  assert.deepEqual(rows("SELECT FieldName FROM FileMaker_BaseTableFields WHERE BaseTableName = 'Q' ORDER BY FieldId"), [['Last'], ['Note']]);
});

test('a text field that holds numbers still adds, and * and / bind tighter than + and -', () => {
  const one = (q: string) => rows(q)[0][0];
  assert.equal(one('SELECT SUM(Code + 0) FROM C'), 12);
  assert.deepEqual(rows('SELECT Code FROM C WHERE Code + 0 > 6'), [['7']]);
  assert.equal(one('SELECT Code - 1 FROM C WHERE Code = \'5\''), 4);
  assert.equal(one('SELECT t.Last + 1 FROM (SELECT COUNT(*) AS Last FROM P) t'), 3);
  assert.equal(one("SELECT 'n=' + Pay * 2 FROM P WHERE First = 'Ann'"), 'n=20');
  assert.equal(one("SELECT Pay * 2 + 'n' FROM P WHERE First = 'Ann'"), '20n');
  assert.equal(one("SELECT Born + Pay * 2 FROM P WHERE First = 'Ann'"), '2000-04-04');
  assert.equal(one("SELECT Pay * 2 + Born FROM P WHERE First = 'Ann'"), '2000-04-04');
  assert.equal(one("SELECT Pay * 2 + Pay * 3 FROM P WHERE First = 'Ann'"), 50);
});

test('a keyword in front of an operator is not its left operand', () => {
  const one = (q: string) => rows(q)[0][0];
  // END ends a CASE; the exponent after it is not rewritten (SQLite then reports it) rather than wrapped around the keyword.
  assert.throws(() => rows("SELECT CASE WHEN Pay > 15 THEN 1 ELSE 2 END ^ 2 FROM P"), /\^/);
  assert.doesNotThrow(() => rows("SELECT CASE WHEN Pay > 15 THEN 'hi' ELSE 'lo' END + '!' FROM P"));
  assert.equal(fileMakerSqlSyntax('SELECT NOT 1 + 2'), 'SELECT NOT 1 + 2');
});

test('a star keeps the right tables with dotted names and queries\' own names', () => {
  const columns = (query: string) => run(query).names;
  assert.deepEqual(columns('WITH Q AS (SELECT First AS Last FROM P) SELECT * FROM Q'), ['Last']);
  assert.deepEqual(columns('SELECT * FROM P WHERE Pay IN (SELECT 10)'), ['First', 'Last', 'Born', 'Pay']);
  const stars = (name: string) => expandStars(`SELECT * FROM ${name}`, (n) => (n === name ? ['a', 'b'] : undefined));
  assert.equal(stars('Q.alt'), 'SELECT "Q.alt"."a", "Q.alt"."b" FROM Q.alt');
  assert.equal(stars('Q~2'), 'SELECT "Q~2"."a", "Q~2"."b" FROM Q~2');
});

test('a trailing comment or semicolon does not swallow the limit', () => {
  assert.deepEqual(rows('SELECT First FROM P ORDER BY First FETCH FIRST 1 ROWS ONLY -- all of them'), [['Ann']]);
  assert.deepEqual(rows('SELECT First FROM P ORDER BY First FETCH FIRST 1 ROWS ONLY; -- done'), [['Ann']]);
  assert.deepEqual(rows('SELECT First FROM P ORDER BY First /* x */ OFFSET 1 ROW /* y */'), [['Bo']]);
});

test('ROUND keeps SQLite\'s labels and out-of-range answers', () => {
  assert.deepEqual(run('SELECT ROUND(Pay / 3, 2) FROM P').names, ['ROUND(Pay / 3, 2)']);
  assert.equal(rows('SELECT ROUND(Pay, 400) FROM P WHERE First = \'Ann\'')[0][0], 10);
  assert.equal(rows("SELECT ROUND('abc') FROM P")[0][0], 0);
});

test('long queries are rewritten in time proportional to their length', () => {
  const timed = (query: string) => {
    const start = performance.now();
    fileMakerSqlSyntax(query);
    assert.ok(performance.now() - start < 9000, `${query.slice(0, 30)}... took ${Math.round(performance.now() - start)} ms`);
  };
  timed("SELECT " + "'a' + ".repeat(20_000) + "'b'");
  timed('SELECT ' + '1 + ('.repeat(20_000));
  timed('SELECT ' + '2 ^ ('.repeat(20_000));
  timed('SELECT ' + '1 + 1 '.repeat(20_000));
  const start = performance.now();
  expandStars('(SELECT * FROM t'.repeat(10_000), () => ['a']);
  assert.ok(performance.now() - start < 9000);
});

test('the rewrite settles however deep the nesting', () => {
  let query = "SELECT 'a' + 'b'";
  for (let i = 0; i < 8; i++) query = `SELECT 'x' + LOWER((${query}))`;
  const once = fileMakerSqlSyntax(query);
  assert.equal(fileMakerSqlSyntax(once), once);
});
