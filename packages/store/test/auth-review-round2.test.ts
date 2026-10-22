import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, LOCKOUT } from '../src/index.ts';
import { addressBucket, SignInFailures, lockoutName } from '../src/sign-in-failures.ts';

function fresh(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-auth-review-'));
  const path = join(dir, 'Review.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  store.savePrivilegeSet({ name: '[Read-Only Access]', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, path };
}

test('IPv6 spelling and mapped IPv4 cannot split the address failure budget', () => {
  for (const variants of [
    ['2001:db8:1:2::1', '2001:0DB8:0001:0002:0:0:0:2', '2001:db8:1:02::3'],
    ['198.51.100.9', '::ffff:198.51.100.9', '0:0:0:0:0:ffff:c633:6409', '::ffff:c633:6409'],
    ['fe80::1%en0', 'fe80:0:0:0:0:0:0:2%en1'],
  ]) {
    const failures = new SignInFailures();
    for (let i = 0; i < LOCKOUT.addressAttempts; i++) failures.countAddressFailure(variants[i % variants.length]);
    for (const address of variants) {
      assert.equal(addressBucket(address), addressBucket(variants[0]));
      assert.ok(failures.addressLockedOut(address));
    }
    assert.equal(failures.addressLockedOut('2001:db8:1:3::1'), undefined);
  }
});

test('long distinct account names cannot clear each other’s failed guesses', (t) => {
  const { store } = fresh(t);
  const prefix = 'a'.repeat(128), victim = prefix + 'victim', other = prefix + 'other';
  store.setPassword(victim, 'victim-secret', '[Read-Only Access]');
  store.setPassword(other, 'other-secret', '[Read-Only Access]');
  for (let i = 0; i < LOCKOUT.attempts; i++) {
    assert.equal(store.verify(victim, 'wrong', '127.0.0.1'), false);
    assert.equal(store.verify(other, 'other-secret', '127.0.0.1'), true);
  }
  assert.ok(store.lockedOut(victim, '127.0.0.1'));
  assert.equal(store.unlock(other), false);
  assert.ok(store.lockedOut(victim, '127.0.0.1'));
});

for (const mutation of ['reset', 'delete', 'replace', 'same-verifier-replacement', 'disable', 'inactive'] as const) {
  test(`async password proof cannot survive a concurrent ${mutation} from another store`, async (t) => {
    const { store, path } = fresh(t);
    store.setPassword('person', 'old-secret', '[Read-Only Access]');
    const peer = new Store(path);
    try {
      const savedHash = peer.sql.prepare('SELECT password_hash FROM _fm_accounts WHERE name = ?').get('person')!.password_hash;
      // verifyAsync yields to scrypt before the mutation; no timing or sleeps needed.
      const pending = store.verifyAsync('person', 'old-secret', '127.0.0.1');
      if (mutation === 'reset') peer.setPassword('person', 'new-secret');
      if (mutation === 'delete' || mutation === 'replace' || mutation === 'same-verifier-replacement') peer.deleteAccount('person');
      if (mutation === 'replace') peer.setPassword('person', 'replacement-secret', '[Read-Only Access]');
      if (mutation === 'same-verifier-replacement') {
        peer.setPassword('person', 'old-secret', '[Read-Only Access]');
        peer.sql.prepare('UPDATE _fm_accounts SET password_hash = ? WHERE name = ?').run(savedHash, 'person');
      }
      if (mutation === 'disable') peer.sql.prepare('UPDATE _fm_accounts SET password_disabled = 1 WHERE name = ?').run('person');
      if (mutation === 'inactive') peer.setAccountActive('person', false);
      assert.equal(await pending, false);
      assert.equal(await store.verifyAsync('person', 'old-secret', '127.0.0.1'), mutation === 'same-verifier-replacement');
    } finally { peer.close(); }
  });
}

test('unusual Unicode aliases share counters, while unrelated names stay separate', () => {
  const variants = ['Straße', 'ＳＴＲＡＳＳＥ', 'stras\u00adse', '\u200bSTRASSE\ufe0f'];
  const failures = new SignInFailures();
  for (let i = 0; i < LOCKOUT.attempts; i++) {
    const account = variants[i % variants.length];
    assert.equal(lockoutName(account), 'strasse');
    failures.record(failures.accountKey(account, 'unknown'), 'unknown', false);
  }
  for (const account of variants) assert.ok(failures.lockedOut(failures.accountKey(account, 'unknown'), 'unknown'));
  assert.equal(failures.lockedOut(failures.accountKey('strasbourg', 'unknown'), 'unknown'), undefined);
});
