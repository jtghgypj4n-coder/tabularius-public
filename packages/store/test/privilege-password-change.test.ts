// Self password change honours the set's "allow the account to change its own
// password" option — except when a change is currently owed, where refusing
// would lock the account out of a sign-in it cannot complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, StoreError } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pwchange-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try { fn(store); } finally { store.close(); rmSync(dir, { recursive: true }); }
}

test('a set that forbids self-password-change refuses it, but a set that allows it does not', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet({ name: 'NoPwChange', records: { view: true, edit: true, create: true, delete: true }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [], allowModifyPassword: false });
    store.savePrivilegeSet({ name: 'MayChange', records: { view: true, edit: true, create: true, delete: true }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [], allowModifyPassword: true });
    store.setPassword('locked', 'locked-pw-123', 'NoPwChange');
    store.setPassword('free', 'free-pw-1234', 'MayChange');

    assert.throws(() => store.changePassword('locked', 'locked-pw-123', 'locked-pw-456'), (e: unknown) => e instanceof StoreError && e.code === 9);
    // The account that may change its password still can.
    store.changePassword('free', 'free-pw-1234', 'free-pw-5678');
    assert.equal(store.verify('free', 'free-pw-5678', ''), true);
  });
});

test('a forced change is allowed even when the set forbids self-password-change, so the account is not locked out', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet({ name: 'NoPwChange', records: { view: true, edit: true, create: true, delete: true }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [], allowModifyPassword: false });
    store.setPassword('locked', 'locked-pw-123', 'NoPwChange');
    store.setMustChangePassword('locked', true);
    // The admin owes this account a change; refusing it would deadlock sign-in, so it goes through.
    store.changePassword('locked', 'locked-pw-123', 'locked-pw-789');
    assert.equal(store.verify('locked', 'locked-pw-789', ''), true);
    assert.equal(store.mustChangePassword('locked'), false); // and the owed-change flag is cleared
  });
});
