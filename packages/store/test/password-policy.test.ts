// The password policy matches FileMaker's account options: a minimum length,
// an expiry age, and a per-account "must change on next sign-in" flag. The
// store enforces length when a password is set and reports when a change is
// owed; changePassword is how a person clears the requirement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';

function freshStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pw-'));
  createStore(join(dir, 'New.sqlite'));
  return { store: new Store(join(dir, 'New.sqlite')), dir };
}

test('minimum length is enforced when a password is set', () => {
  const { store, dir } = freshStore();
  try {
    store.setPasswordPolicy({ minLength: 8 });
    assert.deepEqual(store.passwordPolicy(), { minLength: 8 });
    assert.throws(() => store.setPassword('Admin', 'short'), (e) => e instanceof StoreError && e.code === 960);
    store.setPassword('Admin', 'longenough'); // meets the minimum
    assert.equal(store.verify('Admin', 'longenough'), true);
    // Turning the minimum off lets a short password through again.
    store.setPasswordPolicy({ minLength: 0 });
    assert.deepEqual(store.passwordPolicy(), { minLength: 0 }, 'no minimum is a choice the file remembers');
    store.setPassword('Admin', 'tiny');
    assert.equal(store.verify('Admin', 'tiny'), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('must-change is owed until the account changes its own password', () => {
  const { store, dir } = freshStore();
  try {
    store.setPassword('Clerk', 'first-pass', undefined, { mustChange: true });
    assert.equal(store.mustChangePassword('Clerk'), true);
    assert.ok(store.accounts().find((a) => a.name === 'Clerk')?.mustChange);

    // A wrong current password, or an unchanged one, is refused.
    assert.throws(() => store.changePassword('Clerk', 'wrong', 'second-pass'), (e) => e instanceof StoreError && e.code === 212);
    assert.throws(() => store.changePassword('Clerk', 'first-pass', 'first-pass'), (e) => e instanceof StoreError && e.code === 960);

    store.changePassword('Clerk', 'first-pass', 'second-pass');
    assert.equal(store.mustChangePassword('Clerk'), false, 'the requirement clears');
    assert.equal(store.verify('Clerk', 'second-pass'), true);

    // The flag can be set again on its own, and setting a password leaves it alone.
    assert.equal(store.setMustChangePassword('Clerk', true), true);
    assert.equal(store.mustChangePassword('Clerk'), true);
    store.setPassword('Clerk', 'third-pass'); // admin reset, no mustChange given
    assert.equal(store.mustChangePassword('Clerk'), true, 'an admin reset does not silently clear it');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a password older than the policy age owes a change', () => {
  const { store, dir } = freshStore();
  try {
    store.setPassword('Admin', 'current');
    store.setPasswordPolicy({ maxAgeDays: 30 });
    assert.equal(store.mustChangePassword('Admin'), false, 'a fresh password is fine');

    // Backdate the stored change time past the limit.
    (store as unknown as { sql: { prepare(s: string): { run(...a: unknown[]): unknown } } }).sql
      .prepare('UPDATE _fm_accounts SET password_changed = ? WHERE name = ?')
      .run(new Date(Date.now() - 31 * 86_400_000).toISOString(), 'Admin');
    assert.equal(store.mustChangePassword('Admin'), true, 'an old password owes a change');

    store.changePassword('Admin', 'current', 'renewed');
    assert.equal(store.mustChangePassword('Admin'), false, 'changing it resets the age');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('setPasswordPolicy rejects nonsense and drops zero/empty values', () => {
  const { store, dir } = freshStore();
  try {
    assert.throws(() => store.setPasswordPolicy({ minLength: -3 }), (e) => e instanceof StoreError && e.code === 960);
    assert.throws(() => store.setPasswordPolicy({ maxAgeDays: 1.5 }), (e) => e instanceof StoreError && e.code === 960);
    store.setPasswordPolicy({ minLength: 10, maxAgeDays: 0 });
    assert.deepEqual(store.passwordPolicy(), { minLength: 10 });
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a privilege set that does not exist changes nothing', () => {
  const { store, dir } = freshStore();
  try {
    const before = store.accounts().map((a) => a.name);
    // A new account: refused, and not added with no privilege set.
    assert.throws(() => store.setPassword('Ben', 'pw', '[No Such Set]'), (e) => e instanceof StoreError && e.code === 960);
    assert.deepEqual(store.accounts().map((a) => a.name), before);
    // An existing account: refused, and its password is left as it was.
    store.setPassword('Ann', 'old-pass');
    assert.throws(() => store.setPassword('Ann', 'new-pass', '[No Such Set]'), (e) => e instanceof StoreError && e.code === 960);
    assert.equal(store.verify('Ann', 'old-pass'), true);
    assert.equal(store.verify('Ann', 'new-pass'), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('with no policy of its own a file takes the server\'s default minimum; its own policy, 0 included, wins', () => {
  const was = process.env.TABULARIUS_MIN_PASSWORD_LENGTH;
  const { store, dir } = freshStore();
  try {
    // A library user with no variable set is held to nothing.
    delete process.env.TABULARIUS_MIN_PASSWORD_LENGTH;
    assert.equal(store.minPasswordLength(), 0);
    store.setPassword('Admin', 'x');

    process.env.TABULARIUS_MIN_PASSWORD_LENGTH = '12';
    assert.equal(store.minPasswordLength(), 12);
    assert.throws(() => store.setPassword('Admin', 'eleven-char'), (e) => e instanceof StoreError && e.code === 960 && /at least 12 characters/.test(e.message));
    assert.throws(() => store.createAccount('Clerk', 'short', '[Data Entry Only]'), (e) => e instanceof StoreError && e.code === 960);
    store.setPassword('Admin', 'twelve-chars');
    assert.equal(store.verify('Admin', 'twelve-chars'), true);
    // A blank password, spaces around a short one, and one made of several-unit characters are no way round the minimum:
    // a password set here works from any address.
    for (const weak of ['', ' '.repeat(12), `a${' '.repeat(11)}`, '😀'.repeat(6)]) {
      assert.throws(() => store.setPassword('Admin', weak), (e) => e instanceof StoreError && e.code === 960, JSON.stringify(weak));
    }
    store.setPassword('Admin', '😀'.repeat(12));
    assert.equal(store.verify('Admin', '😀'.repeat(12), '203.0.113.9'), true);
    store.setPassword('Admin', 'twelve-chars');
    // The existing password of an account is not touched by a stricter default; only a new one is held to it.
    assert.equal(store.passwordPolicy().minLength, undefined);
    assert.throws(() => store.setPasswordPolicy({ minLength: 5000 }), (e) => e instanceof StoreError && e.code === 960);

    // The file's own minimum wins over the default, whichever way it points.
    store.setPasswordPolicy({ minLength: 0 });
    store.setPassword('Admin', 'tiny');
    store.setPasswordPolicy({ minLength: 20 });
    assert.throws(() => store.setPassword('Admin', 'twelve-chars'), (e) => e instanceof StoreError && /at least 20 characters/.test(e.message));
    // Saying nothing about the minimum goes back to the default.
    store.setPasswordPolicy({ maxAgeDays: 90 });
    assert.equal(store.minPasswordLength(), 12);

    // A bad value fails closed to the default rather than to no minimum.
    process.env.TABULARIUS_MIN_PASSWORD_LENGTH = 'many';
    assert.equal(store.minPasswordLength(), 12);
    process.env.TABULARIUS_MIN_PASSWORD_LENGTH = '0';
    assert.equal(store.minPasswordLength(), 0, 'the operator can switch the default off');
  } finally {
    if (was === undefined) delete process.env.TABULARIUS_MIN_PASSWORD_LENGTH; else process.env.TABULARIUS_MIN_PASSWORD_LENGTH = was;
    store.close();
    rmSync(dir, { recursive: true });
  }
});
