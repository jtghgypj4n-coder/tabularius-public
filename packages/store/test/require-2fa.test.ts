// The "require two-factor for full-access accounts" switch: it can't be turned
// on while a full-access account would be locked out, and it lists which ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, totpCode } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function enrol(store: Store, account: string): void {
  const { secret } = store.enrollTotp(account);
  assert.equal(store.confirmTotp(account, totpCode(secret)), true);
}

test('the switch refuses to turn on until every full-access account has 2FA', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-2fa-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try {
    const full = store.privilegeSets().find((p) => p.id === 1)!.name;
    store.setPassword('Admin', 'pw', full);

    assert.equal(store.requireTotpForFullAccess(), false);
    assert.deepEqual(store.fullAccessAccountsWithoutTotp(), ['Admin']);
    // Can't turn it on yet — Admin would be locked out.
    assert.throws(() => store.setRequireTotpForFullAccess(true), /Admin/);
    assert.equal(store.requireTotpForFullAccess(), false);

    // Once Admin has a second factor, it can go on.
    enrol(store, 'Admin');
    assert.deepEqual(store.fullAccessAccountsWithoutTotp(), []);
    store.setRequireTotpForFullAccess(true);
    assert.equal(store.requireTotpForFullAccess(), true);

    // A full-access account added afterwards shows up as missing 2FA, but the
    // switch stays on (it's an existing admin's job to enrol the new account).
    store.setPassword('admin2', 'pw', full);
    assert.deepEqual(store.fullAccessAccountsWithoutTotp(), ['admin2']);
    assert.equal(store.requireTotpForFullAccess(), true);

    // Turning it off is always allowed.
    store.setRequireTotpForFullAccess(false);
    assert.equal(store.requireTotpForFullAccess(), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a non-full account without 2FA never blocks the switch', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-2fa-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try {
    const full = store.privilegeSets().find((p) => p.id === 1)!.name;
    store.setPassword('Admin', 'pw', full);
    enrol(store, 'Admin');
    store.savePrivilegeSet({ name: 'ReadOnly', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
    store.setPassword('viewer', 'pw', 'ReadOnly');
    // viewer has no 2FA but isn't full access, so it doesn't block the switch.
    assert.deepEqual(store.fullAccessAccountsWithoutTotp(), []);
    store.setRequireTotpForFullAccess(true);
    assert.equal(store.requireTotpForFullAccess(), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
