// Every place the code reads record data from a store either passes the caller's privileges or is classified, with the
// reason, in scripts/read-gate-typed-allowlist.json (see scripts/read-gate-lib.ts). A new reader fails here until someone looks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, type Allowance } from '../../../scripts/read-gate-lib.ts';

const root = join(import.meta.dirname, '..', '..', '..');

test('every read of record data passes the caller\'s privileges or is classified', { timeout: 120_000 }, () => {
  const allow = JSON.parse(readFileSync(join(root, 'scripts', 'read-gate-typed-allowlist.json'), 'utf8')) as Allowance[];
  const { readers, problems } = check(root, allow);
  assert.ok(readers.length > 300, `the scan finds the readers (${readers.length})`);
  assert.ok(readers.filter((r) => r.gated).length > 100, 'and sees the privileges passed to most of them');
  assert.deepEqual(problems, []);
});

test('the scan recognises a gated and an ungated read', { timeout: 120_000 }, () => {
  const { readers } = check(root, []);
  const find = readers.filter((r) => r.file === 'packages/server/src/dataapi.ts' && r.api === 'Store.find');
  assert.ok(find.some((r) => r.gated), 'the Data API passes privileges to find');
  assert.ok(readers.some((r) => r.api === 'sql.prepare' && r.sqlKind === 'data'), 'direct SQL on a record table is listed');
  assert.ok(readers.some((r) => r.api === 'Store.recordCount' && !r.gated), 'a count read without privileges is listed');
  assert.ok(readers.some((r) => r.api === 'sql.statement'), 'reads made through the calculation engine\'s cached statements are listed');
  assert.ok(readers.some((r) => r.api === 'sql.prepared'), 'and through the store\'s');
  assert.ok(readers.some((r) => r.api === 'sql.prepare' && (r.text.includes('(sql)') || r.text.includes('prepare(query)'))), 'a statement held in a variable counts as reading data');
});
