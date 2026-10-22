import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { ScimDirectory } from '../src/scim.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-scim-review-'));
  const path = join(dir, 'Review.openhbam.sqlite');
  createStore(path);
  const store = new Store(path), scim = new ScimDirectory(store);
  const user = scim.create({ userName: 'synthetic@example.test', active: true });
  const group = 'Reader';
  store.savePrivilegeSet({ name: group, records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] });
  const peer = new Store(path);
  let closed = false;
  const close = () => { if (!closed) { store.close(); closed = true; } };
  t.after(() => { peer.close(); close(); rmSync(dir, { recursive: true, force: true }); });
  return { path, store, peer, scim, user, group, close };
}

test('SCIM group changes commit for a peer and survive reopening', (t) => {
  const { path, store, peer, scim, user, group, close } = setup(t);
  scim.setMembers(group, [user.id]);
  assert.equal(store.sql.isTransaction, false, 'a completed update must release its writer transaction');
  assert.equal(peer.accountPrivilegeSet(user.account), group);
  assert.deepEqual(new ScimDirectory(peer).members(group).map((r) => r.id), [user.id]);
  close();
  const reopened = new Store(path);
  try {
    assert.equal(reopened.accountPrivilegeSet(user.account), group);
    new ScimDirectory(reopened).setMembers(group, []);
    assert.equal(reopened.sql.isTransaction, false);
    assert.equal(peer.accountPrivilegeSet(user.account), undefined);
  } finally { reopened.close(); }
});

test('SCIM mid-update failure rolls back all changes and releases its writer transaction', (t) => {
  const { store, peer, scim, user, group } = setup(t);
  // Seed the membership independently of the batch implementation being tested.
  scim.addMember(group, user.id);
  const clear = store.clearAccountPrivilegeSet.bind(store);
  t.mock.method(store, 'clearAccountPrivilegeSet', (...args: Parameters<Store['clearAccountPrivilegeSet']>) => {
    clear(...args); throw new Error('synthetic failure after removal');
  });
  assert.throws(() => scim.setMembers(group, []), /synthetic failure/);
  assert.equal(store.sql.isTransaction, false);
  assert.deepEqual(scim.members(group).map((r) => r.id), [user.id]);
  assert.equal(peer.accountPrivilegeSet(user.account), group);
  // Another worker must be able to write immediately after the failed request.
  peer.setAccountActive(user.account, false);
  assert.equal(store.accountInactive(user.account), true);
});

test('SCIM batch savepoints preserve the caller-owned transaction on success and failure', (t) => {
  const { store, peer, scim, user, group } = setup(t);
  store.sql.exec('BEGIN IMMEDIATE');
  try {
    scim.setMembers(group, [user.id]);
    assert.equal(store.sql.isTransaction, true);
    assert.equal(peer.accountPrivilegeSet(user.account), undefined);
    const clear = store.clearAccountPrivilegeSet.bind(store);
    t.mock.method(store, 'clearAccountPrivilegeSet', (...args: Parameters<Store['clearAccountPrivilegeSet']>) => {
      clear(...args); throw new Error('synthetic nested failure');
    });
    assert.throws(() => scim.setMembers(group, []), /synthetic nested failure/);
    assert.equal(store.sql.isTransaction, true);
    assert.equal(store.accountPrivilegeSet(user.account), group);
  } finally { store.sql.exec('ROLLBACK'); }
  assert.equal(store.accountPrivilegeSet(user.account), undefined);
});
