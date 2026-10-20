// A script's transaction (or an OData change set) takes the file's write lock when it first joins. It used to start
// with a bare savepoint, a deferred transaction: when another process (the warm-up worker, a cluster peer) wrote
// between the transaction's first read and its first write, that write failed at once with "database is locked".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, endTransaction, Store, writer, type Transaction } from '../src/index.ts';

test('a transaction holds the write lock from when it joins, so another process\'s write can\'t slip in before its next', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tx-lock-'));
  const path = join(dir, 'Jobs.sqlite');
  createStore(path);
  const store = new Store(path, 'Jobs');
  const other = new DatabaseSync(path);
  try {
    store.applyDesign([{ op: 'createTable', name: 'Jobs', fields: [{ name: 'Name' }] }]);
    other.exec('PRAGMA busy_timeout = 0; CREATE TABLE elsewhere (x)');
    const tx: Transaction = { files: new Map() };
    writer.run({ transaction: { open: tx } }, () => {
      (store as unknown as { joinTransaction(): void }).joinTransaction();
      // The transaction reads, as a write does before writing (privileges, locks, the record).
      assert.equal(store.findIds('Jobs').length, 0);
      // Another process can't write now: it would leave the transaction's read out of date.
      assert.throws(() => other.exec('INSERT INTO elsewhere VALUES (1)'), /locked/);
      store.create('Jobs', { Name: 'kept' });
    });
    endTransaction(tx, true);
    assert.equal(store.findIds('Jobs').length, 1);
    // Once it ends, the lock is let go.
    other.exec('INSERT INTO elsewhere VALUES (2)');

    // Rolled back: nothing it wrote is kept, and the lock is let go too.
    const undone: Transaction = { files: new Map() };
    writer.run({ transaction: { open: undone } }, () => store.create('Jobs', { Name: 'dropped' }));
    endTransaction(undone, false);
    assert.equal(store.findIds('Jobs').length, 1);
    other.exec('INSERT INTO elsewhere VALUES (3)');
  } finally {
    other.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
