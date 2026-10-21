import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

function withStore(run: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-create-'));
  const path = join(dir, 'New.sqlite');
  createStore(path);
  const store = new Store(path);
  try { store.setPassword('Admin', 'admin-password-1', '[Full Access]'); run(store); }
  finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

const set = (name: string) => ({ name, records: { view: false, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] });

test('store security changes create accounts and privilege sets, and reject duplicate names case-insensitively', () => withStore((store) => {
  store.applySecurity([{ op: 'createPrivilegeSet', set: set('Auditors') }]);
  store.applySecurity([{ op: 'createAccount', kind: 'password', name: 'Casey', password: 'secret-password', privilegeSet: 'Auditors' }]);
  assert.equal(store.accounts().find((a) => a.name === 'Casey')?.privilegeSet, 'Auditors');
  assert.ok(store.privilegeSets().some((p) => p.name === 'Auditors'));
  assert.throws(() => store.applySecurity([{ op: 'createAccount', kind: 'password', name: 'cASEY', password: 'another-secret', privilegeSet: 'Auditors' }]), /already exists/i);
  assert.throws(() => store.applySecurity([{ op: 'createPrivilegeSet', set: set('aUDITORS') }]), /already exists/i);
}));

test('creating a password account needs a password given as text; nothing is created without one', () => withStore((store) => {
  for (const password of [undefined, null, 7]) {
    assert.throws(() => store.applySecurity([{ op: 'createAccount', kind: 'password', name: 'Pat', password: password as unknown as string, privilegeSet: '[Full Access]' }]), /password/i);
    assert.equal(store.accounts().some((a) => a.name === 'Pat'), false);
  }
}));
