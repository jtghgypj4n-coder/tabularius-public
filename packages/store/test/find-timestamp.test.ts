import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { findWhere, type FieldInfo, type Normalizer } from '../src/find.ts';

// A timestamp field searched with dates alone means whole days, as in FileMaker.

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (_fm_record_id INTEGER PRIMARY KEY, Created TEXT)');
for (const v of ['2026-07-01T09:00:00', '2026-07-03T00:00:00', '2026-07-03T20:00:17', '2026-07-04T08:00:00']) db.prepare('INSERT INTO t (Created) VALUES (?)').run(v);
const fields = new Map<string, FieldInfo>([['Created', { name: 'Created', type: 'timestamp' }]]);
const us = (v: string) => /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
const norm: Normalizer = (v, type) => {
  const m = us(v.trim());
  const day = m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : v.trim();
  return type === 'timestamp' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00` : day;
};
const count = (criteria: string) => {
  const { where, params } = findWhere([{ Created: criteria }], fields, norm);
  return (db.prepare(`SELECT count(*) AS n FROM t WHERE ${where}`).get(...params) as { n: number }).n;
};

test('find: a date in a timestamp field finds that whole day', () => {
  assert.equal(count('7/3/2026'), 2);
  assert.equal(count('2026-07-03'), 2);
  assert.equal(count('7/1/2026...7/3/2026'), 3);
  assert.equal(count('<=7/3/2026'), 3);
  assert.equal(count('<7/3/2026'), 1);
  assert.equal(count('>7/3/2026'), 1);
  assert.equal(count('>=7/3/2026'), 3);
  // A time still means that moment.
  assert.equal(count('2026-07-03T20:00:17'), 1);
});
