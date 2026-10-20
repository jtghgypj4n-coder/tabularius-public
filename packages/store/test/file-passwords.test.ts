// Signing in with the passwords a converted file's accounts already have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, PASSWORD_POLICY, Store } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('an account with the file\'s empty password signs in from this computer only, unless allowed', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try {
    assert.deepEqual(store.blankPasswordAccounts(), ['Admin']);
    assert.equal(store.verify('Admin', '', ''), true);
    assert.equal(store.verify('Admin', '', '127.0.0.1'), true);
    assert.equal(store.verify('Admin', 'guess', '127.0.0.1'), false);
    assert.equal(store.verify('Admin', '', '10.0.0.5'), false);
    PASSWORD_POLICY.blankFromNetwork = true;
    try {
      assert.equal(store.verify('Admin', '', '10.0.0.5'), true);
    } finally {
      PASSWORD_POLICY.blankFromNetwork = false;
    }
    // A password set in Tabularius replaces the file's.
    store.setPassword('Admin', 'secret');
    assert.deepEqual(store.blankPasswordAccounts(), []);
    assert.equal(store.verify('Admin', '', ''), false);
    assert.equal(store.verify('Admin', 'secret', '10.0.0.5'), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a file\'s own opt-in lets its empty-password accounts in from the LAN but not the internet', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lan-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try {
    assert.equal(store.allowBlankPasswordFromLan(), false, 'off by default');
    assert.equal(store.verify('Admin', '', '192.168.1.50'), false);
    assert.equal(store.verify('Admin', '', '8.8.8.8'), false, 'a public address, still refused');
    store.setAllowBlankPasswordFromLan(true);
    assert.equal(store.allowBlankPasswordFromLan(), true);
    assert.equal(store.verify('Admin', '', '192.168.1.50'), true, 'a private address now works');
    assert.equal(store.verify('Admin', '', '10.1.2.3'), true);
    assert.equal(store.verify('Admin', '', '::1'), true, 'loopback always works');
    assert.equal(store.verify('Admin', '', '8.8.8.8'), false, 'a public address is still refused');
    store.setAllowBlankPasswordFromLan(false);
    assert.equal(store.verify('Admin', '', '192.168.1.50'), false, 'turning it back off refuses it again');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('the LAN opt-in also recognizes a dual-stack "::ffff:" IPv4-mapped address', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lan-mapped-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try {
    store.setAllowBlankPasswordFromLan(true);
    assert.equal(store.verify('Admin', '', '::ffff:192.168.1.50'), true, 'a mapped private address works, same as the bare IPv4 form');
    assert.equal(store.verify('Admin', '', '::ffff:8.8.8.8'), false, 'a mapped public address is still refused');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('setting a password unlocks the account, even with the wrong one at the same place', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pwunlock-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try {
    store.savePrivilegeSet({ name: 'Worker', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: [] });
    store.setPassword('worker', 'first-pw-1234', 'Worker');
    for (let i = 0; i < 5; i++) store.verify('worker', 'wrong', '9.9.9.9');
    assert.ok(store.lockedOut('worker', '9.9.9.9'), 'locked out after five misses');
    store.setPassword('worker', 'second-pw-1234');
    assert.equal(store.lockedOut('worker', '9.9.9.9'), undefined, 'a password change clears the lockout');
    assert.equal(store.verify('worker', 'second-pw-1234', '9.9.9.9'), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
