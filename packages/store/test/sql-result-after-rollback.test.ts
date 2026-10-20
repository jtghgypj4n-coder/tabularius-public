// A query's result is kept under the file's write token. Inside a transaction the query reads the committed file, and a
// rollback puts the token back to an earlier value that a later, different write reaches again: the old result came back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('ExecuteSQL answers with the committed value after a rolled-back transaction and a later write', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-rollback-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'a.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => store.close());
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Note' }] }]);
  const id = Number(store.create('T', { Note: 'one' }).recordId);
  const formula = 'ExecuteSQL ( "SELECT Note FROM T" ; "|" ; "¶" )';
  assert.equal(store.evaluate('T', formula).value, 'one');
  store.sql.exec('BEGIN IMMEDIATE');
  try {
    store.update('T', id, { Note: 'two' });
    // The query runs on the committed file.
    assert.equal(store.evaluate('T', formula).value, 'one');
  } finally { store.sql.exec('ROLLBACK'); }
  store.update('T', id, { Note: 'three' });
  assert.equal(store.evaluate('T', formula).value, 'three');
});
