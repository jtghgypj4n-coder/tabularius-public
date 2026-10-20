import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGrouping, checkUnionTypes } from '../src/sql-checks.ts';

const fields = new Set(['dept', 'last_name', 'salary', 'id', 'name', 'amount', 'region', 'year']);
const refused = (sql: string) => { try { checkGrouping(sql, fields); return undefined; } catch (e) { return (e as Error).message; } };

test('FQL0025: a column in the select list that is neither grouped nor aggregated is refused', () => {
  assert.match(refused('SELECT dept, last_name, SUM(salary) FROM emp GROUP BY dept')!, /FQL0025.*last_name/);
  assert.match(refused('select "Dept", salary from emp group by dept')!, /FQL0025.*salary/);
  assert.match(refused('SELECT dept FROM emp GROUP BY dept HAVING salary > 3')!, /FQL0025.*salary/);
  assert.match(refused('SELECT dept, SUM(salary) + salary FROM emp GROUP BY dept')!, /FQL0025.*salary/);
  assert.match(refused('SELECT e.dept, e.salary FROM emp e GROUP BY e.dept')!, /FQL0025.*salary/);
  assert.match(refused('SELECT dept FROM emp GROUP BY dept UNION SELECT dept, salary FROM emp GROUP BY dept')!, /FQL0025.*salary/);
  assert.match(refused('SELECT CASE WHEN salary > 1 THEN 1 END FROM emp GROUP BY dept')!, /FQL0025.*salary/);
});

test('FQL0025: grouped, aggregated, positional, aliased and expression groups are accepted', () => {
  for (const sql of [
    'SELECT dept, SUM(salary), COUNT(*) FROM emp GROUP BY dept',
    'SELECT e.dept, SUM(e.salary) FROM emp e GROUP BY e.dept',
    'SELECT dept, last_name FROM emp GROUP BY dept, last_name',
    'SELECT dept, SUM(salary) FROM emp GROUP BY 1',
    'SELECT dept AS d, SUM(salary) FROM emp GROUP BY d',
    'SELECT dept d, SUM(salary) FROM emp GROUP BY d',
    'SELECT UPPER(dept), COUNT(*) FROM emp GROUP BY UPPER(dept)',
    'SELECT UPPER(dept) || \'!\', COUNT(*) FROM emp GROUP BY UPPER(dept)',
    'SELECT YEAR(salary), COUNT(*) FROM emp GROUP BY YEAR(salary)',
    'SELECT dept FROM emp GROUP BY dept HAVING SUM(salary) > 3',
    'SELECT dept, SUM(salary) AS total FROM emp GROUP BY dept HAVING total > 3',
    'SELECT dept, (SELECT MAX(salary) FROM emp) FROM emp GROUP BY dept',
    'SELECT dept, (SELECT x.salary FROM emp x WHERE x.dept = 1 LIMIT 1) FROM emp GROUP BY dept',
    'SELECT dept, MAX(salary) - MIN(salary) FROM emp GROUP BY dept ORDER BY salary',
    'SELECT dept, COUNT(DISTINCT last_name) FROM emp GROUP BY dept',
    'SELECT dept, CAST(SUM(salary) AS INT) FROM emp GROUP BY dept',
    'SELECT dept, \'salary\', "salary note" FROM emp GROUP BY dept',
    'SELECT dept, SUM(salary) FROM emp GROUP BY dept FETCH FIRST 3 ROWS ONLY',
    'SELECT dept, SUM(salary) OVER (PARTITION BY region) FROM emp GROUP BY dept',
    'SELECT dept FROM emp -- salary\nGROUP BY dept',
    'SELECT salary FROM emp',
    'SELECT dept, salary FROM emp WHERE salary > 1 ORDER BY salary',
    'SELECT * FROM emp GROUP BY dept',
  ]) assert.equal(refused(sql), undefined, sql);
});

test('FQL0025: an unreadable query is left to run as written', () => {
  for (const sql of ['SELECT FROM GROUP BY', 'SELECT ( GROUP BY']) {
    assert.doesNotThrow(() => checkGrouping(sql, fields), sql);
  }
  assert.doesNotThrow(() => checkGrouping(`SELECT dept, salary FROM emp GROUP BY dept ${' '.repeat(200_000)}`, fields));
});

const types: Record<string, string> = { last_name: 'text', salary: 'number', hired: 'date', dept: 'text' };
const unionRefused = (sql: string) => { try { checkUnionTypes(sql, (n) => types[n]); return undefined; } catch (e) { return (e as Error).message; } };

test('FQL0027: the columns of the two sides of a UNION must have the same type', () => {
  assert.match(unionRefused('SELECT last_name, salary FROM emp UNION SELECT salary, last_name FROM emp')!, /FQL0027.*column 1.*text and number/);
  assert.match(unionRefused('SELECT dept FROM a UNION ALL SELECT hired FROM b')!, /FQL0027.*text and date/);
  assert.match(unionRefused('SELECT dept FROM a UNION SELECT dept FROM a UNION SELECT salary FROM b')!, /FQL0027.*text and number/);
});

test('FQL0027: matching, computed, starred and unknown columns are accepted', () => {
  for (const sql of [
    'SELECT last_name, salary FROM emp UNION SELECT dept, salary FROM emp',
    'SELECT last_name AS n FROM emp UNION SELECT dept FROM emp',
    'SELECT salary + 1 FROM emp UNION SELECT last_name FROM emp',
    'SELECT * FROM emp UNION SELECT salary FROM emp',
    'SELECT mystery FROM emp UNION SELECT salary FROM emp',
    'SELECT last_name FROM emp UNION SELECT salary, hired FROM emp',
    'SELECT e.salary FROM emp e UNION SELECT salary FROM emp',
    'SELECT last_name FROM emp WHERE salary > 1 ORDER BY last_name',
  ]) assert.equal(unionRefused(sql), undefined, sql);
});

test('ExecuteSQL refuses an ungrouped column and a UNION of different types, and runs what FileMaker accepts', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createStore, Store } = await import('../src/index.ts');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-checks-'));
  try {
    createStore(join(dir, 't.sqlite'));
    const store = new Store(join(dir, 't.sqlite'), 'T');
    store.applyDesign([
      { op: 'createTable', name: 'Emp', fields: [{ name: 'Dept', type: 'text' }, { name: 'Pay', type: 'number' }, { name: 'Code', type: 'text' }] },
      { op: 'createTable', name: 'Other', fields: [{ name: 'Code', type: 'number' }, { name: 'Label', type: 'text' }] },
    ] as never);
    for (const [Dept, Pay] of [['A', '10'], ['A', '20'], ['B', '5']]) store.create('Emp', { Dept, Pay, Code: 'x' });
    const run = (sql: string) => store.calc.executeSQL(sql, []).map((r) => r.map((v) => asText(v)));
    const { asText } = await import('@tabularius/calc');
    assert.throws(() => run('SELECT Dept, Pay FROM Emp GROUP BY Dept'), /FQL0025.*pay/i);
    assert.throws(() => run('SELECT Dept FROM Emp GROUP BY Dept HAVING Pay > 3'), /FQL0025.*pay/i);
    assert.throws(() => run('SELECT Dept FROM Emp UNION SELECT Pay FROM Emp'), /FQL0027.*text and number/);
    assert.deepEqual(run('SELECT Dept, SUM(Pay) FROM Emp GROUP BY Dept ORDER BY Dept'), [['A', '30'], ['B', '5']]);
    assert.deepEqual(run('SELECT UPPER(Dept), COUNT(*) FROM Emp GROUP BY UPPER(Dept) ORDER BY 1'), [['A', '2'], ['B', '1']]);
    assert.deepEqual(run('SELECT Dept AS d, MAX(Pay) FROM Emp GROUP BY d HAVING MAX(Pay) > 7'), [['A', '20']]);
    // Code is text in one table and a number in the other: its type is unknown, so no side is refused.
    assert.equal(run('SELECT Code FROM Emp UNION SELECT Label FROM Other').length, 1);
    assert.equal(run('SELECT Code FROM Other UNION SELECT Label FROM Other').length, 0);
    // A query with no GROUP BY keeps SQLite's reading.
    assert.equal(run('SELECT Dept, COUNT(*) FROM Emp').length, 1);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
