import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dryRunSummary } from '../src/design/dry-run-summary.ts';

const rec = (kind: 'create' | 'update' | 'delete') => ({ table: 'T', recordId: 1, kind, fields: [] });

test('a dry run is summed up in a sentence', () => {
  assert.equal(dryRunSummary({ ended: { error: 0, result: '' }, changes: { records: [], more: 0, truncated: [] } }), 'It would change no records.');
  assert.equal(dryRunSummary({ ended: { error: 0, result: 'ok' }, changes: { records: [rec('create'), rec('update'), rec('update'), rec('delete')], more: 0, truncated: [] } }),
    'It would create 1 record, change 2 and delete 1. It ends with the result “ok”.');
  assert.equal(dryRunSummary({ ended: { error: 401 }, message: 'Line 3: No records match', changes: { records: [rec('update')], more: 3, truncated: [{ table: 'Log', records: 1 }] } }),
    'It would change 1 record, and 3 more records not listed. It would empty Log (1 record). It stops with error 401 (Line 3: No records match).');
});

test('a dry run too big to read whole says so', () => {
  assert.match(dryRunSummary({ ended: { error: 0 }, changes: { records: [rec('update')], more: 9000, truncated: [], incomplete: true } }), /only its first changes were read/);
});
