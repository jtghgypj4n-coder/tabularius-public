// A record put back as it was at a point in its audit history: changed fields
// set back, a deleted record made again, one made since deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, writer } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function charts(): { dir: string; store: Store } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-history-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  return { dir, store: new Store(join(dir, 'Charts.sqlite')) };
}
const fields = (store: Store, id: number) => store.get('Congress', id).fieldData;

test('a record is put back as it was after any change in its history', { skip }, () => {
  const { dir, store } = charts();
  try {
    const { recordId } = store.create('Congress', { Name: 'Ann Example', State: 'Oregon', Party: 'D' }, { account: 'Ann' });
    store.update('Congress', recordId, { State: 'Nevada' }, undefined, { account: 'Bob' });
    store.update('Congress', recordId, { State: 'Utah', Party: 'R' }, undefined, { account: 'Cy' });
    const log = store.auditLog({ table: 'Congress', recordId });
    const [created, first] = log;

    assert.equal(store.recordAsOf('Congress', recordId, first.seq)!.State, 'Nevada');
    assert.deepEqual(store.restoreRecord('Congress', recordId, first.seq, { account: 'admin' }), { action: 'updated', fields: ['State', 'Party'] });
    assert.equal(fields(store, recordId).State, 'Nevada');
    assert.equal(fields(store, recordId).Party, 'D');
    assert.equal(store.restoreRecord('Congress', recordId, first.seq).action, 'unchanged');

    // Putting back is a change of its own, so it can be undone the same way.
    const restore = store.auditLog({ table: 'Congress', recordId }).at(-1)!;
    assert.deepEqual([restore.kind, restore.account, restore.changes], ['update', 'admin', { State: ['Utah', 'Nevada'], Party: ['R', 'D'] }]);

    // A deleted record comes back with its id and values.
    store.delete('Congress', recordId, { account: 'Dee' });
    const deleted = store.auditLog({ table: 'Congress', recordId }).at(-1)!;
    assert.equal(store.restoreRecord('Congress', recordId, deleted.seq - 1).action, 'created');
    assert.equal(fields(store, recordId).Name, 'Ann Example');
    assert.equal(fields(store, recordId).State, 'Nevada');

    // Before it was made: deleted.
    assert.equal(store.restoreRecord('Congress', recordId, created.seq - 1).action, 'deleted');
    assert.throws(() => store.get('Congress', recordId), /missing/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test("a record someone else is editing isn't put back, and an emptied table can't be", { skip }, () => {
  const { dir, store } = charts();
  try {
    const { recordId } = store.create('Congress', { Name: 'Ann Example' });
    store.update('Congress', recordId, { State: 'Utah' });
    const seq = store.auditLog({ table: 'Congress', recordId })[0].seq;
    store.locks.acquire('Congress', recordId, 'someone else', 'Bob');
    assert.throws(() => store.restoreRecord('Congress', recordId, seq), /in use by another user/);
    store.locks.release('Congress', recordId, 'someone else');
    writer.run({ account: 'Ann' }, () => store.truncate('Congress'));
    assert.throws(() => store.recordAsOf('Congress', recordId, seq), /emptied since/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
