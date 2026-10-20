// The import dialog refuses a file the server would reject, and says what to do instead of "Request body too large".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_MAX_BYTES, importTooLarge } from '../src/import-dialog.ts';

test('a file that fits is not refused', () => {
  assert.equal(importTooLarge('People.csv', 1024), undefined);
  assert.equal(importTooLarge('People.csv', IMPORT_MAX_BYTES), undefined);
});

test('a file over the limit is refused with the size, the limit and what to do', () => {
  const message = importTooLarge('Big.csv', 120 * 1024 * 1024)!;
  assert.match(message, /^Big\.csv is 120 MB, more than the 50 MB one import takes\./);
  assert.match(message, /Split it into smaller files/);
  assert.match(importTooLarge('Edge.csv', IMPORT_MAX_BYTES + 1)!, /Edge\.csv is 50 MB/);
});

test('the limit leaves room for the form around the file under the server limit', () => {
  assert.ok(IMPORT_MAX_BYTES < 50 * 1024 * 1024);
});
