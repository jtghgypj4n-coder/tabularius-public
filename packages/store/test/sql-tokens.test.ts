import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { cleanSql, sqlName, sqlTokens } from '../src/sql-tokens.ts';

test('bracket identifiers retain both opening brackets through SQL cleanup', () => {
  const token = sqlTokens('[a[[b]')[0];
  assert.equal(sqlName(token), 'a[[b');
  assert.equal(cleanSql('SELECT [a[[b] AS r FROM t'), 'SELECT "a[[b" AS r FROM t');
  assert.equal(sqlName(sqlTokens('"a""b"')[0]), 'a"b');
  assert.equal(sqlName(sqlTokens("'it''s'")[0]), "it's");

  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE t ("a[b" INTEGER, "a[[b" INTEGER); INSERT INTO t VALUES (1, 2)');
    assert.equal(db.prepare('SELECT [a[[b] AS r FROM t').get()?.r, 2);
    assert.equal(db.prepare(cleanSql('SELECT [a[[b] AS r FROM t')).get()?.r, 2);
  } finally {
    db.close();
  }
});
