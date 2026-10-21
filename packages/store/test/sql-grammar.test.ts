// The translation of FileMaker SQL's grammar to SQLite, one rewrite at a time: OFFSET and FETCH FIRST, the star,
// joins and quantified comparisons, ^, ROUND, and + and - on strings and dates. The server's sql-grammar test runs the
// whole grammar through ExecuteSQL and the SQL connection; these pin the edges of each rewrite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
    { op: 'createTable', name: 'K', fields: ['Grp', 'First', 'Last', 'Range', 'Current', 'Match', 'Rows', 'End', 'Like', 'Glob', 'With', 'True', 'Regexp', 'User', 'UserName', 'Current_User'].map((name) => ({ name, type: 'text' })) },
    { op: 'createTable', name: 'T2', fields: [{ name: 'k', type: 'number' }, { name: 'v', type: 'number' }] },
  ] as never);
  for (const [Name, N] of [['a', 1], ['b', 2], ['c', 2], ['d', 2], ['e', 3]]) store.create('W', { Name, N: String(N) });
  for (const Grp of ['a', 'b', 'b', 'b']) store.create('K', { Grp, First: 'x', Last: 'x', Range: 'x', Current: 'x', Match: 'x', Rows: 'x', End: 'x', Like: 'x', Glob: 'x', With: 'x', True: 'x', Regexp: 'x', User: 'x', UserName: 'x', Current_User: 'x' });
  for (const [k, v] of [[1, 5], [2, 6], [3, 7]]) store.create('T2', { k: String(k), v: String(v) });
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
const tableColumns = (name: string) => store.schema.tables.find((t) => t.name.toLowerCase() === name)?.fields.map((f) => f.name);
/** What the rewrite makes of a query when it knows the tables, as the SQL engine does. */
const rewrite = (query: string) => anyAllToIn(query, tableColumns);

test('placeholders keep their numbering when an ANY or ALL comparison is rewritten', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = anyAllToIn('SELECT ? > ALL (SELECT ?) AS result');
    assert.equal((db.prepare(sql).get(2, 1) as { result: number }).result, 1);
    const mixed = anyAllToIn('SELECT ?5 > ALL (SELECT ?) AS result');
    assert.equal((db.prepare(mixed).get(null, null, null, null, 2, 1) as { result: number }).result, 1);
    const after = anyAllToIn('SELECT ? > ALL (SELECT ?) AS result, ? AS tail');
    assert.deepEqual({ ...db.prepare(after).get(2, 1, 7) }, { result: 1, tail: 7 });
  } finally { db.close(); }
});

test('ANY and ALL over an empty or NULL-bearing subquery give the standard answers', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const [sql, expected] of [
      ['SELECT NOT (2 > ALL (SELECT NULL)) AS result', null],
      ['SELECT (2 < ANY (SELECT NULL)) IS NULL AS result', 1],
      ['SELECT 2 > ALL (SELECT 1 WHERE 0) AS result', 1],
      ['SELECT 2 < ANY (SELECT 1 WHERE 0) AS result', 0],
      ['SELECT 2 > ALL (SELECT 3 UNION ALL SELECT NULL) AS result', 0],
      ['SELECT 2 < ANY (SELECT 3 UNION ALL SELECT NULL) AS result', 1],
    ] as const) assert.equal((db.prepare(anyAllToIn(sql)).get() as { result: number | null }).result, expected);
  } finally { db.close(); }
});

test('aggregate operands do not bind to the quantified subquery', () => {
  for (const operand of ['COUNT(*)', 'COUNT(1)', 'SUM(1)', 'COUNT(?)']) {
    const query = `SELECT N, ${operand} FROM W GROUP BY N HAVING ${operand} > ALL (SELECT 1) ORDER BY N`;
    assert.equal(anyAllToIn(query), query);
    assert.throws(() => run(query, operand.includes('?') ? [1] : []));
  }
  assert.deepEqual(rows('SELECT N, SUM(N) FROM W GROUP BY N HAVING SUM(N) > ALL (SELECT 1) ORDER BY N'), [[2, 6], [3, 3]]);
});

test('aggregates of expressions with no column are left alone, and aggregates that name one are moved', () => {
  const free = ['COUNT(1 IS NOT NULL)', 'COUNT(CURRENT_DATE)', 'COUNT(NOT 0)', 'COUNT(1 AND 1)', 'COUNT(1 BETWEEN 0 AND 2)', 'SUM((SELECT 1))',
    'COUNT(:p)', 'COUNT($p)', 'COUNT(@p)', 'COUNT(1 COLLATE NOCASE)', "COUNT(X'00')", 'COUNT(CASE WHEN 1 THEN 2 END)', 'COUNT(ABS(-1))'];
  for (const operand of free) {
    const query = `SELECT N FROM W GROUP BY N HAVING ${operand} > ALL (SELECT 2 UNION ALL SELECT 2 UNION ALL SELECT 2)`;
    assert.equal(anyAllToIn(query), query, operand);
  }
  // Correct answer (no group has more than the count it is compared with) instead of the rows of the moved subselect.
  assert.deepEqual(rows('SELECT N FROM W GROUP BY N HAVING COUNT(N IS NOT NULL) > ALL (SELECT 3 UNION ALL SELECT 3)'), []);
  for (const operand of ['COUNT(N)', 'COUNT("N")', 'SUM(ABS(N))', 'COUNT(DISTINCT N)', 'COUNT(CASE WHEN N > 1 THEN 1 END)', 'MAX((SELECT 1) + N)']) {
    const query = `SELECT N FROM W GROUP BY N HAVING ${operand} > ALL (SELECT 0)`;
    assert.notEqual(anyAllToIn(query), query, operand);
  }
});

const ALL_OF_TWO = '> ALL (SELECT 2 UNION ALL SELECT 1)';
const havingK = (operand: string) => `SELECT Grp FROM K GROUP BY Grp HAVING COUNT(${operand}) ${ALL_OF_TWO}`;
const havingW = (operand: string) => `SELECT N FROM W GROUP BY N HAVING ${operand} ${ALL_OF_TWO}`;

test('an aggregate over a column named like a clause, window or operator word is moved', () => {
  const operands = ['First', 'Last', 'Range', 'Current', 'Match', 'Rows', 'End', 'Like', 'Glob', 'With', 'True', 'Regexp', 'COALESCE(First, 1)', 'First IS NOT NULL',
    'Last + 0', 'Current COLLATE NOCASE', 'CAST(Range AS TEXT)', 'Match IS NOT NULL', 'Like = 1', '1 + Regexp', 'End IS NOT NULL', 'CASE WHEN End IS NULL THEN 0 ELSE 1 END',
    // The account names are constants unless a table of the select has a column of that name.
    'User', 'user', 'UserName', 'Current_User', 'CURRENT_USER', "User || 'x'", 'CASE WHEN User IS NULL THEN 0 ELSE 1 END'];
  for (const operand of operands) {
    assert.notEqual(rewrite(havingK(operand)), havingK(operand), operand);
    assert.deepEqual(run(havingK(operand)).rows, [['b']], operand);
  }
});

test('LIKE, GLOB, MATCH, REGEXP, END, TRUE and FALSE are syntax or constants where they are, and the constants stay when no column has the name', () => {
  for (const operand of ["1 LIKE 'a'", "'a' GLOB 'b'", "1 NOT LIKE 2", "'a' REGEXP 'b'", "1 MATCH 2", 'CASE WHEN 1 THEN 2 END', 'CASE WHEN CASE WHEN 1 THEN 1 END THEN 2 END', 'TRUE', 'NOT FALSE', 'TRUE AND 1']) {
    assert.equal(rewrite(havingW(`COUNT(${operand})`)), havingW(`COUNT(${operand})`), operand);
  }
});

test('type names after AS are skipped, however many words they have', () => {
  for (const type of ['INTEGER', 'UNSIGNED BIG INT', 'DOUBLE PRECISION', 'DECIMAL(10, 2)', 'VARYING CHARACTER(20)', 'NATIVE CHARACTER(70)']) {
    assert.equal(rewrite(havingW(`COUNT(CAST(1 AS ${type}))`)), havingW(`COUNT(CAST(1 AS ${type}))`), type);
    assert.notEqual(rewrite(havingW(`COUNT(CAST(N AS ${type}))`)), havingW(`COUNT(CAST(N AS ${type}))`), type);
  }
});

test('an aggregate over a subquery is left alone when the subquery supplies every column it names, and moved when it reaches outside', () => {
  const free = [
    'SUM((SELECT MAX(v) FROM T2))',
    'SUM((SELECT v FROM T2 WHERE k = 1))',
    'COUNT((SELECT MAX(x) FROM (SELECT v AS x FROM T2)))',
    'COUNT((WITH c AS (SELECT v FROM T2) SELECT MAX(v) FROM c))',
    'COUNT((WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 3) SELECT MAX(n) FROM c))',
    'COUNT(EXISTS (SELECT 1 FROM T2 WHERE v > 5))',
    'COUNT(1 IN (SELECT k FROM T2))',
    'COUNT((SELECT 1 FROM T2 a, T2 b WHERE a.k = b.k))',
    'COUNT((SELECT 1 FROM T2 AS a JOIN T2 b ON a.k = b.k WHERE a.v > 0))',
    'COUNT((SELECT 1 FROM main.T2 x WHERE x.v > 0))',
    'COUNT((SELECT v FROM T2 ORDER BY v DESC LIMIT 1 OFFSET 1))',
    'COUNT((SELECT a.v FROM T2 a LEFT JOIN T2 b ON a.k = b.k GROUP BY a.v HAVING COUNT(*) > 0 UNION ALL SELECT v FROM T2))',
    'COUNT((SELECT SUM(v) OVER (PARTITION BY k ORDER BY v ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM T2))',
    'COUNT((SELECT v x FROM T2 ORDER BY x))',
    'COUNT((SELECT CASE WHEN v > 1 THEN 1 END FROM T2))',
    'COUNT((SELECT 1))',
    "COUNT((SELECT 1 FROM T2 AS x WHERE 1 = 1))",
  ];
  for (const operand of free) assert.equal(rewrite(havingW(operand)), havingW(operand), operand);
  const reaching: [string, unknown[][]][] = [
    ['SUM((SELECT v FROM T2 WHERE k = W.N))', [[1], [2], [3]]],
    ['SUM((SELECT v FROM T2 WHERE T2.k = N))', [[1], [2], [3]]],
    ['COUNT((SELECT N))', [[2]]],
    ['COUNT((SELECT 1 FROM T2 WHERE k = W.N))', [[2]]],
    ['COUNT(EXISTS (SELECT 1 FROM T2 WHERE T2.k = W.N))', [[2]]],
    ['COUNT(1 IN (SELECT a.k FROM T2 a, T2 b WHERE a.k = W.N AND b.k = a.k))', [[2]]],
    ['COUNT((SELECT 1 FROM T2 AS a JOIN T2 b ON a.k = b.k WHERE a.k = W.N))', [[2]]],
    ['COUNT((SELECT 1 FROM T2 WHERE T2.k IN (SELECT k FROM T2 WHERE k = W.N)))', [[2]]],
  ];
  for (const [operand, expected] of reaching) {
    assert.notEqual(rewrite(havingW(operand)), havingW(operand), operand);
    assert.deepEqual(run(havingW(operand)).rows, expected, operand);
  }
  // Without the table list nothing is known of a subquery's tables, so only a qualified outside name or a subquery with no FROM counts.
  assert.equal(anyAllToIn(havingW('SUM((SELECT v FROM T2 WHERE T2.k = N))')), havingW('SUM((SELECT v FROM T2 WHERE T2.k = N))'));
  assert.notEqual(anyAllToIn(havingW('SUM((SELECT v FROM T2 WHERE k = W.N))')), havingW('SUM((SELECT v FROM T2 WHERE k = W.N))'));
});

test('a subquery reaches outside through a derived table or a common table expression, and sees the tables around it', () => {
  for (const operand of [
    'COUNT((SELECT MAX(v) FROM (SELECT v FROM T2 WHERE k = N)))',
    'COUNT((SELECT MAX(x) FROM (SELECT v AS x FROM T2 WHERE k = N) d))',
    'COUNT((WITH c AS (SELECT v FROM T2 WHERE k = N) SELECT MAX(v) FROM c))',
    'COUNT((WITH c(x) AS (SELECT v FROM T2 WHERE k = W.N) SELECT MAX(x) FROM c))',
  ]) {
    assert.notEqual(rewrite(havingW(operand)), havingW(operand), operand);
    assert.deepEqual(run(havingW(operand)).rows, [[2]], operand);
  }
  // A select inside another takes the names of the tables of the one around it, and a common table expression hides a table of its name.
  for (const operand of [
    'COUNT((SELECT 1 FROM T2 WHERE EXISTS (SELECT 1 WHERE v > 0)))',
    'COUNT((SELECT 1 FROM T2 WHERE EXISTS (SELECT 1 FROM W WHERE W.N = T2.k)))',
    'COUNT((SELECT 1 FROM (SELECT v FROM T2) d WHERE EXISTS (SELECT 1 WHERE d.v > 0)))',
    'COUNT((WITH C(n) AS (SELECT 1) SELECT MAX(n) FROM C))',
  ]) assert.equal(rewrite(havingW(operand)), havingW(operand), operand);
});

test('TRUE and FALSE are columns only in the select that holds the aggregate, and only if its tables have or may have one of that name', () => {
  // K has a column True; W does not. The aggregate belongs to the select it is in, whatever the query around it reads.
  const inW = "SELECT Grp FROM K WHERE Grp IN (SELECT 'b' FROM W GROUP BY N HAVING COUNT(TRUE) > ALL (SELECT 2))";
  assert.equal(rewrite(inW), inW);
  const inK = 'SELECT N FROM W WHERE EXISTS (SELECT 1 FROM K GROUP BY Grp HAVING COUNT(True) > ALL (SELECT 0)) ORDER BY N';
  assert.notEqual(rewrite(inK), inK);
  assert.deepEqual(run(inK).rows, [[1], [2], [2], [2], [3]]);
  // A table the rewrite cannot read may have the column.
  const unknown = 'SELECT a FROM nosuch GROUP BY a HAVING COUNT(TRUE) > ALL (SELECT 2)';
  assert.notEqual(rewrite(unknown), unknown);
  for (const constant of ['TRUE', 'FALSE']) {
    const query = havingW(`COUNT((SELECT 1 FROM T2 WHERE ${constant}))`);
    assert.equal(rewrite(query), query, constant);
  }
});

test('operator words inside a subquery, the internal ids and the account names are not columns of the outer query', () => {
  for (const operator of ['LIKE', 'GLOB', 'MATCH', 'REGEXP']) {
    const query = havingW(`COUNT((SELECT 1 FROM T2 WHERE v NOT ${operator} 'a'))`);
    assert.equal(rewrite(query), query, operator);
  }
  for (const operand of ['COUNT((SELECT MAX(_fm_mod_id) FROM T2))', 'COUNT((SELECT MAX(_fm_record_id) FROM T2))', 'COUNT((SELECT MAX(rowid) FROM T2))', 'COUNT((SELECT MAX(oid) FROM T2))',
    'COUNT(USER)', 'COUNT(USERNAME)', 'COUNT(CURRENT_USER)', 'COUNT((SELECT USER))']) {
    assert.equal(rewrite(havingW(operand)), havingW(operand), operand);
  }
  // As written in FileMaker SQL, ROWMODID becomes _fm_mod_id before this rewrite. Such an aggregate names no column of the outer query, so SQLite reports it
  // like any other (it used to be moved, and answered with the rows of the moved subquery).
  assert.throws(() => rows(havingW('COUNT((SELECT MAX(ROWMODID) FROM T2))')), /near "ALL"/);
  assert.throws(() => rows(havingW('COUNT(USER)')), /near "ALL"/);
});

test('a quoted table and column name in the + string join, including doubled quotes', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE T (Name TEXT); INSERT INTO T VALUES (\'A\')');
    db.function('fm_cat', (a, b) => String(a) + String(b));
    const sql = fileMakerSqlSyntax('SELECT "T"."Name" + \'B\' AS result FROM T');
    assert.equal((db.prepare(sql).get() as { result: string }).result, 'AB');
    db.exec('CREATE TABLE "T""Q" ("N""ame" TEXT); INSERT INTO "T""Q" VALUES (\'A\')');
    const escaped = fileMakerSqlSyntax('SELECT "T""Q"."N""ame" + \'B\' AS result FROM "T""Q"');
    assert.equal((db.prepare(escaped).get() as { result: string }).result, 'AB');
  } finally { db.close(); }
});

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

test('= ANY and <> ALL are IN and NOT IN; other quantified comparisons aggregate the subquery', () => {
  assert.equal(anyAllToIn('SELECT 1 WHERE a = ANY (SELECT b FROM t)'), 'SELECT 1 WHERE a IN (SELECT b FROM t)');
  assert.equal(anyAllToIn('SELECT 1 WHERE a = SOME(SELECT b FROM t)'), 'SELECT 1 WHERE a IN (SELECT b FROM t)');
  assert.equal(anyAllToIn('SELECT 1 WHERE a <> ALL (SELECT b FROM t)'), 'SELECT 1 WHERE a NOT IN (SELECT b FROM t)');
  assert.equal(anyAllToIn('SELECT 1 WHERE a != ALL (SELECT b FROM t)'), 'SELECT 1 WHERE a NOT IN (SELECT b FROM t)');
  assert.equal(anyAllToIn('SELECT 1 WHERE a > ALL (SELECT b FROM t)'), 'SELECT 1 WHERE (WITH fm_q(fm_v) AS (SELECT b FROM t) SELECT CASE WHEN MIN(fm_cmp) = 0 THEN 0 WHEN COUNT(*) > COUNT(fm_cmp) THEN NULL ELSE 1 END FROM (SELECT a > fm_v AS fm_cmp FROM fm_q))');
  assert.equal(anyAllToIn('SELECT 1 WHERE t.a <= SOME (SELECT b FROM t)'), 'SELECT 1 WHERE (WITH fm_q(fm_v) AS (SELECT b FROM t) SELECT CASE WHEN MAX(fm_cmp) = 1 THEN 1 WHEN COUNT(*) > COUNT(fm_cmp) THEN NULL ELSE 0 END FROM (SELECT t.a <= fm_v AS fm_cmp FROM fm_q))');
  assert.equal(anyAllToIn('SELECT 1 WHERE a != ANY (SELECT b FROM t)'), 'SELECT 1 WHERE (WITH fm_q(fm_v) AS (SELECT b FROM t) SELECT CASE WHEN MAX(fm_cmp) = 1 THEN 1 WHEN COUNT(*) > COUNT(fm_cmp) THEN NULL ELSE 0 END FROM (SELECT a <> fm_v AS fm_cmp FROM fm_q))');
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
  assert.deepEqual(rows('SELECT BaseTableName FROM FileMaker_BaseTables ORDER BY BaseTableName'), [['C'], ['K'], ['P'], ['Q'], ['T2'], ['W']]);
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
