// The first-login flow for a converted file: give each account still on the
// file's own password a temporary one and force a change at first sign-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, generateTempPassword } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('migrateAccounts gives file accounts a temporary password and forces a change', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mig-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try {
    // Charts ships one account, Admin, on the file's empty password.
    assert.deepEqual(store.unmigratedAccounts(), ['Admin']);
    const setBefore = store.accountPrivilegeSet('Admin');

    const out = store.migrateAccounts();
    assert.equal(out.length, 1);
    assert.equal(out[0].account, 'Admin');
    assert.ok(out[0].password.length >= 1);

    // The file's empty password no longer signs in; the temporary one does.
    assert.equal(store.verify('Admin', '', ''), false);
    assert.equal(store.verify('Admin', out[0].password, ''), true);
    // ...but the account owes a change before it can work, and its set is kept.
    assert.equal(store.mustChangePassword('Admin'), true);
    assert.equal(store.accountPrivilegeSet('Admin'), setBefore);
    // Nothing is left to migrate.
    assert.deepEqual(store.unmigratedAccounts(), []);

    // Setting its own password clears the owed change.
    store.changePassword('Admin', out[0].password, 'a new strong password');
    assert.equal(store.mustChangePassword('Admin'), false);
    assert.equal(store.verify('Admin', 'a new strong password', ''), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('migrateAccounts refuses an account that is not awaiting migration', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mig-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try {
    assert.throws(() => store.migrateAccounts({ accounts: ['Nobody'] }), /not an account awaiting migration/);
    // An account that already has a Tabularius password is not a target.
    store.setPassword('Admin', 'already set');
    assert.deepEqual(store.unmigratedAccounts(), []);
    assert.deepEqual(store.migrateAccounts(), []);
    assert.throws(() => store.migrateAccounts({ accounts: ['Admin'] }), /not an account awaiting migration/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a temporary password meets the file password policy minimum length', () => {
  for (const min of [0, 8, 20, 40]) {
    assert.ok(generateTempPassword(min).length >= min, `min ${min}`);
  }
});
