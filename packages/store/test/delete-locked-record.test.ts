// Deleting a record someone has locked lets go of the lock, and says so: the windows that marked the record as locked
// clear the mark. (Found by the cluster model test: the delete was heard, the unlock was not.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, writer } from '../src/index.ts';

test('deleting a locked record announces the unlock before the delete, and the id can be locked again', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-delete-locked-'));
  createStore(join(dir, 'L.sqlite'));
  const store = new Store(join(dir, 'L.sqlite'), 'L');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  const { recordId } = store.create('Items', { Name: 'a' });
  assert.ok(store.locks.acquire('Items', recordId, 'session-1', 'Ann').ok);
  const heard: string[] = [];
  store.listeners.add((c) => { if (c.kind === 'lock' || c.kind === 'unlock' || c.kind === 'delete') heard.push(`${c.kind}:${c.recordId}:${c.account ?? ''}`); });
  writer.run({ account: 'Ann', owner: 'session-1' }, () => store.delete('Items', recordId, { account: 'Ann' }));
  assert.deepEqual(heard, [`unlock:${recordId}:Ann`, `delete:${recordId}:Ann`]);
  const again = store.create('Items', { Name: 'b' });
  assert.equal(again.recordId, recordId, 'the id comes back');
  assert.ok(store.locks.acquire('Items', again.recordId, 'session-2', 'Bob').ok, 'and is not held by the earlier lock');
});
