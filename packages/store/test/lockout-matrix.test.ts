import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { SignInFailures, LOCKOUT, addressBucket, lockoutName } from '../src/sign-in-failures.ts';
import { canonicalIP } from '../src/client-ip.ts';

/** A socket's own scope suffix is interface-local metadata, so it is not part of the spelling. */
const canonicalAddress = (from: string) => canonicalIP(from.split('%')[0]);

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-matrix-'));
  const path = join(dir, 'Synthetic.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  store.setPassword('Alice', 'correct', '[Full Access]');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, path };
}

const spellings = [
  ['2001:db8:1:2::1', '2001:0DB8:0001:0002:0:0:0:1', '2001:db8:1:2::1%en0'],
  ['198.51.100.9', '::ffff:198.51.100.9', '0:0:0:0:0:ffff:c633:6409', '::FFFF:C633:6409'],
];
for (const forms of spellings) test('equivalent IP spellings share account, address and unlock budgets', (t) => {
  const { store } = setup(t);
  for (const form of forms) {
    assert.equal(canonicalAddress(form), canonicalAddress(forms[0]));
    assert.equal(addressBucket(form), addressBucket(forms[0]));
  }
  const failures = new SignInFailures();
  for (let i = 0; i < LOCKOUT.attempts; i++) {
    const from = forms[i % forms.length];
    failures.record(failures.accountKey('Alice', from), from, false);
  }
  for (const from of forms) assert.ok(failures.lockedOut(failures.accountKey('Alice', from), from));
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(forms[i % forms.length]);
  for (const from of forms) assert.ok(store.lockedOut('unseen', from));
  assert.equal(store.unlockAddress(forms.at(-1)!), true);
  for (const from of forms) assert.equal(store.addressLockedOut(from), undefined);
});

test('IPv6 /64 rotation shares the address budget but leaves the next network usable', () => {
  const f = new SignInFailures();
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) f.countAddressFailure(`2001:0DB8:0001:0002::${i + 1}`);
  assert.ok(f.addressLockedOut('2001:db8:1:2:ffff::1'));
  assert.equal(f.addressLockedOut('2001:db8:1:3::1'), undefined);
  for (const from of ['127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:0:0:1', 'unknown']) {
    for (let i = 0; i < LOCKOUT.addressAttempts; i++) f.countAddressFailure(from);
    assert.equal(f.addressLockedOut(from), undefined, 'documented local/unknown shared-budget exemption');
  }
});

for (const names of [
  ['Alice', 'ALICE', 'alice ', ' Alice', 'Ａｌｉｃｅ', 'Al\u200bice'],
  ['Café', 'Cafe\u0301', 'CAFÉ'],
  ['Straße', 'STRASSE', 'strasse'],
]) test('case, normalization and whitespace variants share the existing name fold', () => {
  const f = new SignInFailures(), from = '198.51.100.8';
  for (const n of names) assert.equal(lockoutName(n), lockoutName(names[0]));
  for (let i = 0; i < LOCKOUT.attempts; i++) f.record(f.accountKey(names[i % names.length], from), from, false);
  for (const n of names) assert.ok(f.lockedOut(f.accountKey(n, from), from));
  assert.equal(f.lockedOut(f.accountKey(names[0], '198.51.100.7'), '198.51.100.7'), undefined);
});

test('dots, confusables and literal URL escapes are distinct names, but cannot evade address limits', (t) => {
  const { store } = setup(t);
  for (const name of ['Alice.', 'Аlice', '%41lice', 'Alice%20']) {
    assert.notEqual(lockoutName(name), lockoutName('Alice'));
    assert.equal(store.verify(name, 'correct', '198.51.100.8'), false, 'must not authenticate a lookalike');
  }
  assert.equal(store.verify('Alice', 'correct', '198.51.100.8'), true);
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure('198.51.100.8');
  for (const name of ['Alice', 'Alice.', 'Аlice', '%41lice']) assert.ok(store.lockedOut(name, '198.51.100.8'));
});

test('an async success cannot cross an address lock issued while hashing, or clear its counter', async (t) => {
  const { store } = setup(t), from = '198.51.100.8';
  assert.equal(await store.verifyAsync('Alice', 'wrong', from), false);
  const pending = store.verifyAsync('Alice', 'correct', from);
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(from);
  assert.equal(await pending, false);
  assert.equal(store.unlockAddress(from), true);
  for (let i = 0; i < LOCKOUT.attempts - 1; i++) assert.equal(store.verify('Alice', 'wrong', from), false);
  assert.ok(store.lockedOut('Alice', from), 'the rejected success did not clear the earlier failure');
  assert.equal(await store.verifyAsync('Alice', 'correct', '198.51.100.7'), true);
});

test('a wrong password completing after an address lock neither grows the locked address nor reaches the account', async (t) => {
  const { store } = setup(t), from = '198.51.100.8';
  for (let i = 0; i < LOCKOUT.attempts - 1; i++) assert.equal(store.verify('Alice', 'wrong', from), false);
  const pending = store.verifyAsync('Alice', 'wrong', from);
  // The address locks before the queued password-hash callback can finish.
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(from);
  assert.equal(await pending, false);
  // A completed failure after the lock is not counted: a locked address must not admit more entries. Another address stays usable.
  assert.equal(store.unlockAddress(from), true);
  assert.equal(store.lockedOut('Alice', from), undefined);
  assert.equal(await store.verifyAsync('Alice', 'correct', '198.51.100.7'), true, 'another address remains usable');
  assert.equal(await store.verifyAsync('Alice', 'correct', from), true);
});

test('parallel wrong passwords and a delayed correct password cannot clear an account lock', async (t) => {
  const { store } = setup(t), from = '198.51.100.8';
  const burst = Array.from({ length: LOCKOUT.attempts + 3 }, () => store.verifyAsync('ALICE', 'wrong', from));
  assert.deepEqual(await Promise.all(burst), Array(LOCKOUT.attempts + 3).fill(false));
  assert.ok(store.lockedOut('Alice', from));
  assert.equal(await store.verifyAsync('Alice', 'correct', from), false);
  store.unlock('Alice');
  const pending = store.verifyAsync('Alice', 'correct', from);
  // Synchronous failures deterministically finish before the queued hash callback.
  for (let i = 0; i < LOCKOUT.attempts; i++) store.verify('Alice', 'wrong', from);
  assert.equal(await pending, false);
});

test('slow attempts expire, edited windows retain issued locks, and timer unlocks are audited once', (t) => {
  const { store } = setup(t), from = '198.51.100.8';
  let mono = Math.floor(performance.now()), wall = Date.now();
  t.mock.method(performance, 'now', () => mono);
  t.mock.method(Date, 'now', () => wall);
  const f = new SignInFailures(), key = f.accountKey('Alice', from);
  for (let i = 0; i < LOCKOUT.attempts * 2; i++) {
    f.record(key, from, false);
    mono += LOCKOUT.windowMs + 1;
    assert.equal(f.lockedOut(key, from), undefined);
  }
  const limits = { ...LOCKOUT };
  t.after(() => Object.assign(LOCKOUT, limits));
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(from);
  for (let i = 0; i < LOCKOUT.attempts; i++) store.verify('Alice', 'wrong', '198.51.100.7');
  LOCKOUT.windowMs = 1;
  LOCKOUT.lockMs = 1;
  wall += 86400_000;
  assert.ok(store.lockedOut('Alice', from), 'wall jumps and edited duration do not shorten an issued lock');
  wall -= 2 * 86400_000;
  mono += limits.lockMs;
  assert.equal(store.lockedOut('Alice', from), undefined);
  assert.equal(store.lockedOut('Alice', '198.51.100.7'), undefined);
  const events = store.securityEvents({ kind: 'lockout-cleared' });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => e.changes?.scope).sort(), ['account', 'address']);
  assert.ok(events.every(e => e.changes?.via === 'timer'));
  store.lockedOut('Alice', from);
  assert.equal(store.securityEvents({ kind: 'lockout-cleared' }).length, 2);
});

test('restart resets volatile counters and retains lock audit evidence', (t) => {
  const { store, path } = setup(t), from = '198.51.100.8';
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(from);
  assert.ok(store.addressLockedOut(from));
  // A fresh Store models process state loss without launching any child process.
  const reopened = new Store(path);
  try {
    assert.equal(reopened.addressLockedOut(from), undefined);
    assert.equal(reopened.securityEvents({ kind: 'locked-out' }).length, 1);
    assert.equal(reopened.verify('Alice', 'correct', from), true);
  } finally { reopened.close(); }
});

for (const scope of ['account', 'address'] as const) test(`${scope}: admin unlock after expiry retains the timer audit without claiming an admin unlock`, (t) => {
  const { store } = setup(t), from = '198.51.100.8';
  let mono = Math.floor(performance.now());
  t.mock.method(performance, 'now', () => mono);
  if (scope === 'address') for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(from);
  else for (let i = 0; i < LOCKOUT.attempts; i++) store.verify('Alice', 'wrong', from);
  mono += LOCKOUT.lockMs;
  assert.equal(scope === 'address' ? store.unlockAddress(from) : store.unlock('Alice'), false);
  const events = store.securityEvents({ kind: 'lockout-cleared' });
  assert.equal(events.length, 1);
  assert.equal(events[0].changes?.via, 'timer');
  assert.equal(events[0].changes?.scope, scope);
});

test('a lock that ends while a transaction holds the file is recorded afterwards, once, with its real end time', (t) => {
  const { store } = setup(t), from = '198.51.100.8';
  let mono = Math.floor(performance.now()), wall = Date.now();
  t.mock.method(performance, 'now', () => mono);
  t.mock.method(Date, 'now', () => wall);
  for (let i = 0; i < LOCKOUT.attempts; i++) store.verify('Alice', 'wrong', from);
  assert.ok(store.lockedOut('Alice', from));
  const lockedAt = wall;
  // The sweep that notices the end runs lazily, long after it; meanwhile another session holds a transaction on the file.
  mono += LOCKOUT.lockMs + 60_000;
  wall += LOCKOUT.lockMs + 60_000;
  (store as unknown as { heldBy: object }).heldBy = {};
  try {
    assert.doesNotThrow(() => store.lockedOut('Bob', '198.51.100.9'), 'an expiry never fails a sign-in check');
    assert.doesNotThrow(() => store.addressLockedOut('198.51.100.9'));
    assert.equal(store.securityEvents({ kind: 'lockout-cleared' }).length, 0, 'nothing could be written yet');
  } finally { (store as unknown as { heldBy?: object }).heldBy = undefined; }
  assert.equal(store.lockedOut('Alice', from), undefined, 'the entry is gone, the lock has ended');
  const events = store.securityEvents({ kind: 'lockout-cleared' });
  assert.equal(events.length, 1, 'recorded once the file is free');
  assert.equal(events[0].changes?.via, 'timer');
  assert.equal(events[0].changes?.expiredAt, new Date(lockedAt + LOCKOUT.lockMs).toISOString(), 'stamped with when the lock ended, not when it was noticed');
  store.lockedOut('Alice', from);
  assert.equal(store.securityEvents({ kind: 'lockout-cleared' }).length, 1, 'and not again');
});

test('a sweep whose expiry callback throws still finishes and keeps the other entries consistent', () => {
  const f = new SignInFailures(undefined, () => { throw new Error('file is busy'); });
  const from = '198.51.100.8';
  let calls = 0;
  for (const name of ['Alice', 'Bob', 'Carol']) for (let i = 0; i < LOCKOUT.attempts; i++) f.record(f.accountKey(name, from), from, false);
  const now = performance.now();
  const real = performance.now;
  performance.now = () => now + LOCKOUT.lockMs + 1;
  try {
    assert.doesNotThrow(() => { calls++; f.blocked(f.accountKey('Alice', from)); });
    assert.equal(f.size, 0, 'every ended lock was removed, none left half-swept');
  } finally { performance.now = real; }
  assert.equal(calls, 1);
});
