import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, endTransaction, Store, writer, type Transaction } from '../../store/src/index.ts';
import { applySecurityChanges } from '../src/security.ts';

function withStore(run: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-create-'));
  const path = join(dir, 'New.sqlite');
  createStore(path);
  const store = new Store(path);
  try {
    store.setPassword('Admin', 'admin-password-1', '[Full Access]');
    store.savePrivilegeSet(privilegeSet('Bot'));
    store.setAgentAccount('bot', 'Bot');
    run(store);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

const privilegeSet = (name: string) => ({ name, records: { view: false, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] });

const invalidPasswords: [string, unknown, boolean][] = [
  ['missing', undefined, false], ['empty', '', true], ['whitespace-only', '  \t ', true], ['non-string', 42, true],
];

test('security-change path creates accounts and privilege sets and rejects case-insensitive duplicates', () => withStore((store) => {
  applySecurityChanges(store, [{ op: 'createPrivilegeSet', set: privilegeSet('Auditors') }], 'bot');
  applySecurityChanges(store, [{ op: 'createAccount', kind: 'password', name: 'Casey', password: 'secret-password', privilegeSet: 'Auditors' }], 'bot');
  assert.equal(store.accounts().find((a) => a.name === 'Casey')?.privilegeSet, 'Auditors');
  assert.ok(store.privilegeSets().some((p) => p.name === 'Auditors'));
  assert.throws(() => applySecurityChanges(store, [{ op: 'createAccount', kind: 'password', name: 'cASEY', password: 'another-secret', privilegeSet: 'Auditors' }], 'bot'), /already exists/i);
  assert.throws(() => applySecurityChanges(store, [{ op: 'createPrivilegeSet', set: privilegeSet('aUDITORS') }], 'bot'), /already exists/i);
}));

for (const [label, password, present] of invalidPasswords) {
  test(`AI createAccount refuses ${label} password`, () => withStore((store) => {
    const op = { op: 'createAccount', kind: 'password', name: `Create_${label}`, privilegeSet: '[Full Access]', ...(present ? { password } : {}) };
    assert.throws(() => applySecurityChanges(store, [op as never], 'bot'), /cannot create password accounts/i);
    assert.equal(store.accounts().some((a) => a.name === `Create_${label}`), false);
  }));

  test(`AI setAccount refuses ${label} password when creating an account`, () => withStore((store) => {
    const op = { op: 'setAccount', name: `Set_${label}`, ...(present ? { password } : {}) };
    assert.throws(() => applySecurityChanges(store, [op as never], 'bot'), /cannot create password accounts/i);
    assert.equal(store.accounts().some((a) => a.name === `Set_${label}`), false);
  }));
}

test('AI may change an existing password and create password accounts with a non-empty password; admin behavior is unchanged', () => withStore((store) => {
  applySecurityChanges(store, [{ op: 'createAccount', kind: 'password', name: 'AI-created', password: 'valid-password', privilegeSet: 'Bot' }], 'bot');
  applySecurityChanges(store, [{ op: 'setAccount', name: 'AI-set-created', password: 'valid-password', privilegeSet: 'Bot' }], 'bot');
  applySecurityChanges(store, [{ op: 'setAccount', name: 'AI-created', password: 'new-valid-password' }], 'bot');
  applySecurityChanges(store, [{ op: 'createAccount', kind: 'password', name: 'Admin-created', password: '  ', privilegeSet: '[Full Access]' }], 'Admin');
  applySecurityChanges(store, [{ op: 'setAccount', name: 'Admin-set-created', password: '  ', privilegeSet: '[Full Access]' }], 'Admin');
  assert.ok(store.accounts().some((a) => a.name === 'AI-created'));
  assert.ok(store.accounts().some((a) => a.name === 'AI-set-created'));
  assert.ok(store.accounts().some((a) => a.name === 'Admin-created'));
  assert.ok(store.accounts().some((a) => a.name === 'Admin-set-created'));
}));

test('literal AI callers use the same password rule for create and set, including existing accounts', () => withStore((store) => {
  store.setPassword('Existing', 'initial-password', 'Bot');
  for (const [label, password, present] of invalidPasswords) {
    const create = { op: 'createAccount', kind: 'password', name: `Literal_${label}`, privilegeSet: 'Bot', ...(present ? { password } : {}) };
    const setNew = { op: 'setAccount', name: `LiteralSet_${label}`, ...(present ? { password } : {}) };
    assert.throws(() => applySecurityChanges(store, [create as never], 'AI'), /cannot create password accounts/i);
    assert.throws(() => applySecurityChanges(store, [setNew as never], 'AI'), /cannot create password accounts/i);
    if (present) assert.throws(() => applySecurityChanges(store, [{ op: 'setAccount', name: 'Existing', password } as never], 'AI'), /cannot create password accounts/i);
    assert.equal(store.accounts().some((a) => a.name.startsWith(`Literal_${label}`) || a.name.startsWith(`LiteralSet_${label}`)), false);
  }
  assert.equal(store.verify('Existing', 'initial-password'), true, 'refused updates leave the current password in place');
}));

test('mixed security batches roll back extended privileges, schema and audit on refusal in either input order', () => withStore((store) => {
  const beforeEvents = store.securityEvents().length;
  const beforeAudit = store.auditLog({ security: true, limit: 10_000 }).length;
  const account = { op: 'createAccount', kind: 'password', name: 'Admin', password: 'another-valid-password', privilegeSet: 'Bot' } as const;
  const privilege = { op: 'createExtendedPrivilege', name: 'atomic_test_privilege' } as const;
  for (const changes of [[privilege, account], [account, privilege]]) {
    assert.throws(() => applySecurityChanges(store, changes as never, 'Admin'), /already exists/i);
    assert.equal(store.schema.extendedPrivileges.some((entry) => entry.name === privilege.name), false);
    assert.equal(store.securityEvents().length, beforeEvents);
    assert.equal(store.auditLog({ security: true, limit: 10_000 }).length, beforeAudit);
  }
}));

test('mixed security batches publish design changes only after commit', () => withStore((store) => {
  const published: string[] = [];
  store.listeners.add((change) => { published.push(change.kind); });
  store.onDesignChange = () => { published.push('refresh'); };
  const privilege = { op: 'createExtendedPrivilege', name: 'notification_batch_privilege' } as const;
  const duplicateAccount = { op: 'createAccount', kind: 'password', name: 'Admin', password: 'another-valid-password', privilegeSet: 'Bot' } as const;

  assert.throws(() => applySecurityChanges(store, [privilege, duplicateAccount] as never, 'Admin'), /already exists/i);
  assert.deepEqual(published, [], 'a refused mixed batch publishes neither refresh nor change events');

  applySecurityChanges(store, [privilege], 'Admin');
  assert.deepEqual(published, ['refresh', 'design'], 'an accepted batch publishes the refresh then its design event once');
}));

test('security batch publications follow the outer writer transaction outcome', () => withStore((store) => {
  const published: string[] = [];
  store.listeners.add((change) => { published.push(change.kind); });
  store.onDesignChange = () => { published.push('refresh'); };
  const runBatch = (name: string) => applySecurityChanges(store, [{ op: 'createExtendedPrivilege', name }], 'Admin');
  const tx = (): Transaction => ({ files: new Map() });

  const rolledBack = tx();
  writer.run({ transaction: { open: rolledBack } }, () => runBatch('rollback_notification_privilege'));
  assert.deepEqual(published, [], 'the batch waits for the outer transaction');
  endTransaction(rolledBack, false);
  assert.deepEqual(published, [], 'a rolled-back outer transaction discards its batch notifications');

  const committed = tx();
  writer.run({ transaction: { open: committed } }, () => runBatch('commit_notification_privilege'));
  assert.deepEqual(published, [], 'notifications remain buffered until outer commit');
  endTransaction(committed, true);
  assert.deepEqual(published, ['refresh', 'design'], 'the committed batch publishes each notification once, in order');

  runBatch('standalone_notification_privilege');
  assert.deepEqual(published, ['refresh', 'design', 'refresh', 'design'], 'standalone batches still publish after their commit');
}));

test('failed outer commit discards security publications before the transaction object is reused', () => withStore((store) => {
  const published: string[] = [];
  store.listeners.add((change) => { published.push(change.kind); });
  store.onDesignChange = () => { published.push('refresh'); };
  store.sql.exec(`CREATE TABLE deferred_parent (id INTEGER PRIMARY KEY);
    CREATE TABLE deferred_child (parent_id INTEGER REFERENCES deferred_parent(id) DEFERRABLE INITIALLY DEFERRED);`);
  const tx: Transaction = { files: new Map() };
  const runBatch = (name: string) => applySecurityChanges(store, [{ op: 'createExtendedPrivilege', name }], 'Admin');

  writer.run({ transaction: { open: tx } }, () => {
    runBatch('failed_commit_notification_privilege');
    store.sql.prepare('INSERT INTO deferred_child (parent_id) VALUES (?)').run(1);
  });
  assert.throws(() => endTransaction(tx, true), /FOREIGN KEY constraint failed/i);
  assert.deepEqual(published, [], 'a failed commit publishes no notifications');
  assert.equal(store.sql.prepare('SELECT COUNT(*) AS count FROM deferred_child').get()?.count, 0, 'failed commit rolled back');

  writer.run({ transaction: { open: tx } }, () => runBatch('reused_commit_notification_privilege'));
  endTransaction(tx, true);
  assert.deepEqual(published, ['refresh', 'design'], 'the reused transaction publishes only its own callbacks once, in order');
}));

test('security names use Unicode-normalized case-insensitive equality for create and set paths', () => withStore((store) => {
  const composed = 'Caf\u00e9';
  const decomposed = 'Cafe\u0301';
  applySecurityChanges(store, [{ op: 'createPrivilegeSet', set: privilegeSet(composed) }], 'Admin');
  assert.throws(() => applySecurityChanges(store, [{ op: 'createPrivilegeSet', set: privilegeSet(decomposed) }], 'Admin'), /already exists/i);
  assert.throws(() => applySecurityChanges(store, [{ op: 'createPrivilegeSet', set: privilegeSet('CAFÉ') }], 'Admin'), /already exists/i);
  store.createAccount(composed, 'first-password', 'Bot');
  assert.throws(() => store.createAccount(decomposed, 'second-password', 'Bot'), /already exists|looks the same/i);
  assert.throws(() => store.createAccount('CAFÉ', 'second-password', 'Bot'), /already exists|looks the same/i);
  assert.doesNotThrow(() => applySecurityChanges(store, [{ op: 'setAccount', name: decomposed }], 'Admin'));
  assert.throws(() => applySecurityChanges(store, [{ op: 'setAccount', name: decomposed, password: 'replacement-password' }], 'Admin'), /looks the same/i);
  assert.equal(store.accounts().filter((a) => a.name.normalize('NFC').toLowerCase() === composed.toLowerCase()).length, 1);
  assert.equal(store.verify(composed, 'first-password'), true);
}));
