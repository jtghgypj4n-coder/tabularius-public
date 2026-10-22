import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// HTTP SQL (sql.ts) and the PostgreSQL wire connection (pgwire.ts) have no per-statement time limit, because the
// SQLite binding this server runs on cannot stop a statement that is running (docs/audits/audit-admin-api-routes.md,
// "Per-statement SQL time limit"). A limit that only checked the clock after the statement returned would be no limit.
// This test fails when a Node release adds a way to interrupt a statement, as the cue to build the limit for real.
test('the SQLite binding offers no way to interrupt a running statement', () => {
  const db = new DatabaseSync(':memory:');
  const statement = db.prepare('SELECT 1');
  const names = [...Object.getOwnPropertyNames(DatabaseSync.prototype), ...Object.getOwnPropertyNames(Object.getPrototypeOf(statement))];
  const interrupting = names.filter((name) => /interrupt|progress|timeout|abort|cancel/i.test(name));
  assert.deepEqual(interrupting, [], 'node:sqlite can now interrupt a statement: add the SQL time limit described in the audit');
  db.close();
});
