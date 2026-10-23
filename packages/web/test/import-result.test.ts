import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importResultSummary, importSkippedRows } from '../src/import-result.ts';

const result = (overrides: Partial<Parameters<typeof importResultSummary>[0]> = {}) => ({ imported: 0, skipped: [], ...overrides });

test('import summary reports zero skipped rows and pending approval', () => {
  assert.equal(importResultSummary(result({ imported: 2, pendingApproval: 1 })), 'Imported 2 records; 0 rows left out; 1 record waiting for approval.');
});

test('import summary names repeated rows and their row or record category', () => {
  assert.equal(importResultSummary(result({ imported: 3, skipped: [
    { row: 4, why: 'same as row 2' }, { row: 5, why: 'same as row 2' },
  ] })), 'Imported 3 records; 2 rows left out (2 repeated rows).');
  assert.equal(importResultSummary(result({ imported: 1, skipped: [{ row: 3, why: 'same as record 12' }] })), 'Imported 1 record; 1 row left out (1 row matching an existing record).');
});

test('import summary groups mixed skip reasons and handles singular and plural counts', () => {
  assert.equal(importResultSummary(result({ imported: 1, skipped: [
    { row: 2, why: 'same as row 1' }, { row: 3, why: 'Quantity: could not be fixed' },
    { row: 4, why: 'matches no record in the found set' }, { row: 5, why: 'more rows than records in the found set' }, { row: 6, why: 'permission denied' },
  ] })), 'Imported 1 record; 5 rows left out (1 repeated row, 1 row with a value that could not be fixed, 1 row matching no record, 1 row beyond the found set, 1 other row).');
});

test('update summary reports added, updated, and left-out totals', () => {
  assert.equal(importResultSummary(result({ imported: 2, updated: 1, skipped: [] })), 'Added 2 records; 1 record updated; 0 rows left out.');
});

test('left-out row list is capped while its remaining count stays exact', () => {
  const skipped = Array.from({ length: 237 }, (_, i) => ({ row: i + 2, why: 'same as row 1' }));
  const list = importSkippedRows(skipped);
  assert.equal(list.rows.length, 200);
  assert.equal(list.rows[0].row, 2);
  assert.equal(list.rows.at(-1)?.row, 201);
  assert.equal(list.remaining, 37);
  assert.equal(list.more, 'and 37 more');
  assert.equal(importResultSummary(result({ imported: 0, skipped })), 'Imported 0 records; 237 rows left out (237 repeated rows).');
});
