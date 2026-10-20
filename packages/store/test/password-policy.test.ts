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
    assert.deepEqual(store.passwordPolicy(), {});
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
