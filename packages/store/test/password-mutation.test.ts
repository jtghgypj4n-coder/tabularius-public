import { test } from 'node:test';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkPassword, checkPasswordAsync, hashPassword, Store, LOCKOUT } from '../src/store.ts';
import { createStore, importFmp12 } from '../src/index.ts';

test('synchronous and asynchronous verifiers accept only the correct password and a complete supported hash', async () => {
  const encoded = hashPassword('correct horse');
  const [, salt, digest] = encoded.split('$');
  for (const verify of [checkPassword, checkPasswordAsync]) {
    assert.equal(await verify('correct horse', encoded), true);
    assert.equal(await verify('wrong', encoded), false);
    for (const malformed of ['', 'scrypt', `unknown$${salt}$${digest}`, `scrypt$$${digest}`, `scrypt$${salt}$`]) {
      assert.equal(await verify('correct horse', malformed), false, malformed);
    }
  }
});

test('both sign-in paths check current account eligibility and reject unknown accounts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mutation-password-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Accounts.sqlite'); createStore(path);
  const store = new Store(path);
  t.after(() => store.close());
  store.setPassword('Admin', 'backup');
  store.setPassword('Worker', 'right');
  for (const verify of [store.verify.bind(store), store.verifyAsync.bind(store)]) {
    assert.equal(await verify('Worker', 'right', '127.0.0.1'), true);
    assert.equal(await verify('Nobody', 'right', '127.0.0.1'), false);
    store.setAccountActive('Worker', false);
    assert.equal(await verify('Worker', 'right', '127.0.0.1'), false);
    store.setAccountActive('Worker', true);
    assert.equal(await verify('Worker', 'right', '127.0.0.1'), true);
  }
});

// Reuse the established fixture contract from file-passwords.test.ts; no verifier
// bytes or undocumented Claris values are invented here.
const fixture = new URL('../../../fixtures/fmp12/Charts.fmp12', import.meta.url);
test('imported blank-password accounts have the same local-only behavior on both sign-in paths', { skip: !existsSync(fixture) }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mutation-imported-password-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Charts.sqlite'); importFmp12(fileURLToPath(fixture), path);
  const store = new Store(path);
  t.after(() => store.close());
  assert.deepEqual(store.blankPasswordAccounts(), ['Admin']);
  for (const verify of [store.verify.bind(store), store.verifyAsync.bind(store)]) {
    assert.equal(await verify('Admin', '', '127.0.0.1'), true);
    assert.equal(await verify('Admin', 'wrong', '127.0.0.1'), false);
    assert.equal(await verify('Admin', '', '203.0.113.8'), false);
    store.setAllowBlankPasswordFromLan(true);
    assert.equal(await verify('Admin', '', '10.0.0.8'), true);
    assert.equal(await verify('Admin', '', '203.0.113.8'), false);
    store.setAllowBlankPasswordFromLan(false);
    assert.equal(await verify('Admin', '', '10.0.0.8'), false);
  }
  // A stale imported verifier must not revive credentials after persisted account
  // metadata says the account uses this platform's password storage instead.
  store.sql.prepare("UPDATE _fm_accounts SET source = 'openhbam', password_hash = NULL WHERE name = 'Admin'").run();
  assert.equal(store.verify('Admin', '', '127.0.0.1'), false);
  assert.equal(await store.verifyAsync('Admin', '', '127.0.0.1'), false);
  store.setPassword('MissingVerifier', 'temporary');
  store.sql.prepare("UPDATE _fm_accounts SET source = 'fmp12', password_hash = NULL WHERE name = 'MissingVerifier'").run();
  assert.equal(store.verify('MissingVerifier', '', '127.0.0.1'), false);
  assert.equal(await store.verifyAsync('MissingVerifier', '', '127.0.0.1'), false);
});


test('unknown accounts spend the same password-hash work as wrong passwords, while lockouts stay cheap', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mutation-password-work-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Accounts.sqlite'); createStore(path);
  const store = new Store(path); t.after(() => store.close());
  store.setPassword('Admin', 'backup');
  store.setPassword('Worker', 'right');
  const sync = crypto.scryptSync, asyncHash = crypto.scrypt;
  let syncCalls = 0, asyncCalls = 0;
  const syncMock = t.mock.method(crypto, 'scryptSync', (...args: Parameters<typeof sync>) => { syncCalls++; return Reflect.apply(sync, crypto, args); });
  const asyncMock = t.mock.method(crypto, 'scrypt', (...args: Parameters<typeof asyncHash>) => { asyncCalls++; return Reflect.apply(asyncHash, crypto, args); });
  syncBuiltinESMExports();
  try {
    for (const account of ['Worker', 'Nobody']) {
      const before = syncCalls;
      assert.equal(store.verify(account, 'wrong', '203.0.113.8'), false);
      assert.equal(syncCalls - before, 1, account);
      const asyncBefore = asyncCalls;
      assert.equal(await store.verifyAsync(account, 'wrong', '203.0.113.9'), false);
      assert.equal(asyncCalls - asyncBefore, 1, account);
    }
    for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure('203.0.113.10');
    const before = [syncCalls, asyncCalls];
    assert.equal(store.verify('Worker', 'right', '203.0.113.10'), false);
    assert.equal(await store.verifyAsync('Nobody', 'wrong', '203.0.113.10'), false);
    assert.deepEqual([syncCalls, asyncCalls], before, 'an already blocked address cannot keep buying scrypt work');
  } finally { syncMock.mock.restore(); asyncMock.mock.restore(); syncBuiltinESMExports(); }
});

test('an async password success cannot bypass a lock acquired while hashing or charge a wrong-password attempt', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mutation-password-race-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Accounts.sqlite'); createStore(path);
  const store = new Store(path); t.after(() => store.close());
  store.setPassword('Admin', 'backup');
  store.setPassword('Worker', 'right');
  const original = crypto.scrypt;
  let resume: (() => void) | undefined;
  let held = false;
  const mock = t.mock.method(crypto, 'scrypt', (...args: Parameters<typeof original>) => {
    if (held) return Reflect.apply(original, crypto, args);
    held = true;
    resume = () => { Reflect.apply(original, crypto, args); };
  });
  syncBuiltinESMExports();
  try {
    const address = '203.0.113.30';
    const pending = store.verifyAsync('Worker', 'right', address);
    assert.ok(resume, 'the async hash is held at its callback boundary');
    for (let i = 0; i < LOCKOUT.addressAttempts - LOCKOUT.attempts - 1; i++) store.countAddressFailure(address);
    for (let i = 0; i < LOCKOUT.attempts; i++) assert.equal(store.verify('Worker', 'wrong', address), false);
    assert.ok(store.lockedOut('Worker', address));
    assert.equal(store.addressLockedOut(address), undefined);
    const locks = store.auditLog({ security: true, kind: 'locked-out' });
    assert.equal(locks.length, 1);
    assert.equal(locks[0].account?.toLowerCase(), 'worker');
    assert.equal(locks[0].from, address);
    assert.equal(locks[0].changes?.factor, undefined, 'a password lockout is not mislabeled as a second-factor lockout');
    resume();
    assert.equal(await pending, false, 'eligibility is checked after the hash await');
    assert.ok(store.lockedOut('Worker', address));
    assert.equal(store.addressLockedOut(address), undefined, 'the correct password did not spend the last address attempt');
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});
