import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Schema } from '../../fmp12/src/index.ts';
import { parse } from '../../calc/src/index.ts';
import { sqlFieldRefs } from '../src/ai-policy-sql.ts';

const schema = { tables: [
  { id: 1, name: 'Items', fields: [{ id: 1, name: 'Name' }, { id: 2, name: 'Password' }] },
  { id: 2, name: 'Order Items', fields: [{ id: 1, name: 'Label' }, { id: 2, name: 'pass"word' }] },
], tableOccurrences: [] } as unknown as Schema;
const literal = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

test('SQL origins include columns in expressions, joins, predicates, ordering and CTEs', () => {
  for (const query of [
    'SELECT Password AS safe FROM Items',
    'SELECT i.* FROM Items AS i',
    'SELECT upper(i.Password) AS safe FROM Items i',
    'SELECT Name FROM Items WHERE Password = ?',
    'SELECT Name FROM Items ORDER BY Password',
    'SELECT Name FROM Items GROUP BY Name HAVING max(Password) <> \'\'',
    'SELECT i.Name FROM Items i JOIN Items j ON i.Name = j.Password',
    'WITH x AS MATERIALIZED (SELECT Password AS p FROM Items) SELECT p FROM x',
    'SELECT Name FROM Items UNION ALL SELECT Password FROM Items',
    'SELECT Name FROM Items WHERE EXISTS (SELECT 1 FROM Items j WHERE j.Password = ?)',
  ]) assert.ok(sqlFieldRefs(schema, query)?.some((ref) => ref.table === 1 && ref.field === 2), query);
});

test('quoted identifiers and parameterized ExecuteSQL literals round-trip into the SQL analyzer', () => {
  for (const query of [
    'SELECT "pass""word" FROM "Order Items" WHERE Label = ?',
    'SELECT i."pass""word" AS "public label" FROM "Order Items" i WHERE i.Label = ?1',
    'SELECT [pass"word] FROM [Order Items] WHERE Label = :label',
    'SELECT `pass"word` FROM `Order Items` WHERE Label = $label',
  ]) for (const fn of ['ExecuteSQL', 'ExecuteSQLe']) {
    const ast = parse(`${fn} ( ${literal(query)} ; "," ; "¶" ; "synthetic-value" )`);
    assert.equal(ast.k, 'call');
    if (ast.k !== 'call' || ast.args[0]?.k !== 'str') assert.fail('literal SQL argument');
    assert.equal(ast.args[0].value, query);
    assert.ok(sqlFieldRefs(schema, ast.args[0].value)?.some((ref) => ref.table === 2 && ref.field === 2), query);
  }
});

test('safe SQL columns, counts and literals do not inherit unrelated secret columns', () => {
  for (const query of [
    'SELECT Name FROM Items',
    'SELECT upper(i.Name) FROM Items i WHERE Name = ?',
    'SELECT count(*) FROM Items',
    'SELECT \'Password\' AS label',
    'SELECT _fm_record_id FROM Items',
  ]) {
    const refs = sqlFieldRefs(schema, query);
    assert.ok(refs, query);
    assert.ok(refs.every((ref) => ref.field !== 2), query);
  }
});

test('unresolvable, virtual, internal and non-read SQL fails closed without executing it', () => {
  for (const query of [
    'SELECT "Missing" FROM Items', 'SELECT Name FROM Missing', 'SELECT hidden_reader()',
    'SELECT value FROM json_each(\'[1,2]\')', 'SELECT name FROM sqlite_master',
    'SELECT Password FROM Items; SELECT Name FROM Items', 'DELETE FROM Items RETURNING Password',
    'WITH x AS (SELECT 1) DELETE FROM Items RETURNING Password', 'PRAGMA table_info(Items)',
    'SELECT (',
  ]) assert.equal(sqlFieldRefs(schema, query), undefined, query);
});
