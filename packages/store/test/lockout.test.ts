import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { SignInFailures, NO_ADDRESS_BUDGET, addressBucket } from '../src/sign-in-failures.ts';
import { createStore, LOCKOUT, Store, totpCode } from '../src/index.ts';

const limits = { ...LOCKOUT };
beforeEach(() => Object.assign(LOCKOUT, limits, { attempts: 3, addressAttempts: 12, maxFailures: 64, sharedFailures: 8 }));
afterEach(() => Object.assign(LOCKOUT, limits));

for (const flood of ['unknown', 'ordinary']) for (const factor of ['', '\0totp', '\0recovery', 'address']) {
  test(`${factor.replace('\0', '') || 'account'} lock survives capacity filled by ${flood} sources`, () => {
    const failures = new SignInFailures();
    const from = '203.0.113.7';
    const key = factor === 'address' ? `\0address\0${from}` : failures.accountKey('Ann', from) + factor;
    const limit = factor === 'address' ? LOCKOUT.addressAttempts : LOCKOUT.attempts;
    for (let i = 0; i < limit; i++) failures.attempt(key, false, limit);
    const lock = failures.get(key);
    // The lock is the oldest entry. Leave exactly the anonymous pool's capacity free.
    for (let i = failures.size; i < LOCKOUT.maxFailures - LOCKOUT.sharedFailures; i++) {
      failures.set(`filler${i}`, { count: 1, first: performance.now() });
    }
    for (let i = 0; i < LOCKOUT.maxFailures * 2; i++) {
      const source = flood === 'unknown' ? 'unknown' : `198.51.100.${i}`;
      failures.record(failures.accountKey(`spray${i}`, source), source, false);
    }
    assert.equal(failures.size, LOCKOUT.maxFailures);
    assert.deepEqual(failures.get(key), lock, 'capacity preserves the issued lock and its expiry');
    assert.equal(failures.record(key, from, true), false);
    assert.equal(failures.record(failures.accountKey('fresh', '192.0.2.1'), '192.0.2.1', true), flood === 'unknown', 'ordinary sources retain their live address budgets at capacity');
  });
}

test('all-locked capacity refuses new sources before password work until a slot frees', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-protected-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  store.setPassword('Admin', 'right');
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  let now = Math.floor(performance.now()), wall = Date.now();
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Date, 'now', () => wall);
  for (let i = 0; i < LOCKOUT.maxFailures; i++) failures.set(`locked${i}`, { count: 5, first: now, until: now + LOCKOUT.lockMs });
  const before = [...failures];
  const syncHash = t.mock.method(crypto, 'scryptSync');
  const asyncHash = t.mock.method(crypto, 'scrypt');
  syncBuiltinESMExports();
  t.after(() => { syncHash.mock.restore(); asyncHash.mock.restore(); syncBuiltinESMExports(); });
  const from = '198.51.100.7';
  for (const shift of [0, 3600_000, -7200_000]) {
    wall += shift;
    assert.ok(store.lockedOut('Admin', from));
    for (let i = 0; i < LOCKOUT.addressAttempts; i++) {
      assert.equal(store.verify('Admin', 'wrong', from), false);
      assert.equal(await store.verifyAsync(`new${i}`, 'wrong', from), false);
    }
    assert.equal(store.verify('Admin', 'right', from), false, 'capacity refusal precedes credential checks');
  }
  assert.equal(syncHash.mock.callCount(), 0);
  assert.equal(asyncHash.mock.callCount(), 0);
  assert.deepEqual([...failures], before, 'refused sources neither evict locks nor silently spend guesses');
  failures.delete('locked0');
  assert.equal(store.lockedOut('Admin', from), undefined);
  assert.equal(store.verify('Admin', 'right', from), true);
  assert.equal(await store.verifyAsync('Admin', 'right', from), true);
  failures.set('locked0', before[0][1]);
  now += LOCKOUT.lockMs;
  assert.equal(await store.verifyAsync('Admin', 'right', from), true, 'expiry also releases admission');
});

test('a new name cannot displace its address budget when all other slots hold live locks', () => {
  const failures = new SignInFailures();
  const now = performance.now(), from = '198.51.100.7';
  for (let i = 0; i < LOCKOUT.maxFailures - 1; i++) failures.set(`locked${i}`, { count: 5, first: now, until: now + LOCKOUT.lockMs });
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) {
    failures.record(failures.accountKey(`name${i}`, from), from, false);
    assert.equal(failures.get(`\0address\0${from}`)?.count, i + 1);
    assert.equal(failures.has(failures.accountKey(`name${i}`, from)), false);
  }
  assert.equal(failures.size, LOCKOUT.maxFailures);
  assert.ok(failures.addressLockedOut(from));
});

for (const from of ['198.51.100.7', '2001:db8:1:2::1']) {
  test(`${from}: an open address window survives eviction pressure and clock/window edits`, (t) => {
    LOCKOUT.maxFailures = 4;
    let now = Math.floor(performance.now()), wall = Date.now();
    const start = now, window = LOCKOUT.windowMs;
    t.mock.method(performance, 'now', () => now);
    t.mock.method(Date, 'now', () => wall);
    const failures = new SignInFailures();
    const address = `\0address\0${addressBucket(from)}`;
    failures.countAddressFailure(from);
    const counter = failures.get(address);
    for (let i = 0; i < 20; i++) {
      const source = `2001:db8:2:${i.toString(16)}::1`;
      failures.record(failures.accountKey('Admin', source), source, false);
      assert.equal(failures.get(address), counter, 'the oldest address counter cannot yield its live budget');
      assert.ok(failures.size <= LOCKOUT.maxFailures);
    }
    const fresh = '192.0.2.99';
    for (const shift of [3600_000, -7200_000]) {
      wall += shift;
      assert.ok(failures.addressLockedOut(fresh), 'wall-clock edits cannot free capacity');
      assert.equal(failures.get(address), counter);
    }
    LOCKOUT.windowMs = window * 2;
    now = start + window;
    assert.ok(failures.addressLockedOut(fresh), 'a longer window retains the address budget');
    assert.equal(failures.get(address), counter);
    now = start + LOCKOUT.windowMs - 1;
    assert.ok(failures.addressLockedOut(fresh), 'capacity remains protected until the expiry boundary');
    now++;
    assert.equal(failures.addressLockedOut(fresh), undefined, 'expired windows release capacity');
    assert.equal(failures.size, 0);
    failures.countAddressFailure(fresh);
    assert.equal(failures.get(`\0address\0${fresh}`)?.count, 1);
    now++;
    LOCKOUT.windowMs = 1;
    assert.equal(failures.addressLockedOut(from), undefined, 'shortening a window releases newly expired counters');
    assert.equal(failures.size, 0);
  });
}

test('evicting an unlocked account preserves its charged address budget and issued account locks', () => {
  LOCKOUT.maxFailures = 5;
  const failures = new SignInFailures(), from = '198.51.100.7';
  const locked = failures.accountKey('locked', from), evicted = failures.accountKey('evicted', from);
  for (let i = 0; i < LOCKOUT.attempts; i++) failures.record(locked, from, false);
  const lock = failures.get(locked);
  failures.record(evicted, from, false);
  const address = `\0address\0${from}`, budget = failures.get(address);
  for (let i = 0; i < 20; i++) failures.record(failures.accountKey(`local${i}`, '127.0.0.1'), '127.0.0.1', false);
  assert.equal(failures.has(evicted), false, 'below-threshold account counters can yield capacity');
  assert.equal(failures.get(address), budget, 'evicting the account cannot refund its network');
  assert.equal(failures.get(locked), lock, 'a counter at the lock threshold never yields capacity');
  assert.equal(failures.record(locked, from, true), false);
  assert.equal(failures.record(evicted, from, true), true, 'correct passwords from a known unlocked source still work');
  assert.equal(failures.get(address), budget, 'success does not refill the address budget');
  failures.record(evicted, from, false);
  assert.equal(failures.get(address)?.count, LOCKOUT.attempts + 2);
});

test('live address counters at capacity refuse new sources before hashing while known sources and local users sign in', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-address-full-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  store.setPassword('Admin', 'right');
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  // A local account keeps its own slot; every other slot is an unlocked address budget.
  failures.record(failures.accountKey('Admin', '127.0.0.1'), '127.0.0.1', false);
  for (let i = 1; i < LOCKOUT.maxFailures; i++) failures.countAddressFailure(`2001:db8:1:${i.toString(16)}::1`);
  // Replace the last evictable account with a live lock, leaving its known address usable.
  const known = '2001:db8:1:1::1';
  for (let i = 0; i < LOCKOUT.attempts; i++) failures.record(failures.accountKey('other', known), known, false);
  assert.equal(failures.size, LOCKOUT.maxFailures);
  const before = [...failures];
  const syncHash = t.mock.method(crypto, 'scryptSync'), asyncHash = t.mock.method(crypto, 'scrypt');
  syncBuiltinESMExports();
  t.after(() => { syncHash.mock.restore(); asyncHash.mock.restore(); syncBuiltinESMExports(); });
  const fresh = '192.0.2.99';
  for (const password of ['wrong', 'right']) {
    assert.equal(store.verify('Admin', password, fresh), false);
    assert.equal(await store.verifyAsync('Admin', password, fresh), false);
  }
  assert.equal(syncHash.mock.callCount(), 0, 'capacity refusal precedes sync credential checks');
  assert.equal(asyncHash.mock.callCount(), 0, 'capacity refusal precedes async credential checks');
  assert.deepEqual([...failures], before);
  assert.equal(store.verify('Admin', 'right', known), true);
  assert.equal(await store.verifyAsync('Admin', 'right', known), true);
  assert.equal(store.verify('Admin', 'right', 'unknown'), true, 'real anonymous accounts retain their reserve');
  failures.delete(failures.accountKey('other', known));
  failures.record(failures.accountKey('Admin', '127.0.0.1'), '127.0.0.1', false);
  assert.equal(store.verify('Admin', 'right', '127.0.0.1'), true, 'local users with their own counters remain available');
});

for (const asynchronous of [false, true]) {
  test(`52 free slots bound 100 wrong passwords from each of 30 rotating /64s (${asynchronous ? 'async' : 'sync'})`, async (t) => {
    Object.assign(LOCKOUT, limits);
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-rotating-'));
    createStore(join(dir, 'New.sqlite'));
    const store = new Store(join(dir, 'New.sqlite'));
    t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
    store.setPassword('Admin', 'right');
    assert.equal(store.verify('Admin', 'right'), true);
    const failures = (store as unknown as { failures: SignInFailures }).failures;
    const now = Math.floor(performance.now());
    t.mock.method(performance, 'now', () => now);
    for (let i = 0; i < LOCKOUT.maxFailures - 52; i++) failures.set(`locked${i}`, { count: LOCKOUT.attempts, first: now, until: now + LOCKOUT.lockMs });
    // Keep the production table and limits; stub only the cost of the wrong-password hashes.
    const syncHash = t.mock.method(crypto, 'scryptSync', ((_p: unknown, _s: unknown, length: number) => Buffer.alloc(length)) as typeof crypto.scryptSync);
    const asyncHash = t.mock.method(crypto, 'scrypt', ((_p: unknown, _s: unknown, length: number, cb: (error: Error | null, key: Buffer) => void) => {
      queueMicrotask(() => cb(null, Buffer.alloc(length)));
    }) as typeof crypto.scrypt);
    syncBuiltinESMExports();
    t.after(() => { syncHash.mock.restore(); asyncHash.mock.restore(); syncBuiltinESMExports(); });
    const sources = Array.from({ length: 30 }, (_, i) => `2001:db8:1:${i.toString(16)}::1`);
    for (let round = 0; round < 100; round++) for (const from of sources) {
      assert.equal(asynchronous ? await store.verifyAsync('Admin', 'wrong', from) : store.verify('Admin', 'wrong', from), false);
      assert.equal(failures.get(`\0address\0${addressBucket(from)}`)?.count, Math.min(round + 1, LOCKOUT.addressAttempts), 'rotating networks cannot reset their counters to one');
      assert.ok(failures.size <= LOCKOUT.maxFailures);
    }
    const hashes = syncHash.mock.callCount() + asyncHash.mock.callCount();
    assert.ok(hashes <= sources.length * LOCKOUT.addressAttempts, 'every network has a bounded guessing budget');
    for (const from of sources) {
      assert.ok(store.lockedOut('Admin', from), 'Admin is locked for every attacking network');
      assert.equal(store.verify('Admin', 'right', from), false);
      assert.equal(await store.verifyAsync('Admin', 'right', from), false);
    }
    assert.equal(syncHash.mock.callCount() + asyncHash.mock.callCount(), hashes, 'locked attempts skip credential checks');
  });
}

test('anonymous names share a bounded pool without locking every account or evicting ordinary counters', (t) => {
  const alias = 'anonymous-proxy';
  NO_ADDRESS_BUDGET.add(alias);
  t.after(() => NO_ADDRESS_BUDGET.delete(alias));
  const failures = new SignInFailures();
  for (let i = 0; i < LOCKOUT.maxFailures - LOCKOUT.sharedFailures; i++) failures.set(`ordinary${i}`, { count: 1, first: performance.now() });
  const ordinary = [...failures];
  for (let i = 0; i < LOCKOUT.maxFailures; i++) {
    const from = i % 2 ? alias : 'unknown';
    failures.record(failures.accountKey(`spray${i}`, from), from, false);
  }
  assert.equal([...failures.values()].filter((v) => v.shared).length, LOCKOUT.sharedFailures);
  assert.deepEqual([...failures].filter(([, v]) => !v.shared), ordinary);
  const before = [...failures];
  for (const from of ['unknown', alias]) {
    assert.equal(failures.addressLockedOut(from), undefined, 'the pool never becomes an address lock');
    const key = failures.accountKey('new', from);
    assert.ok(failures.lockedOut(key, from), 'new invented names are refused before checking credentials');
    assert.equal(failures.record(key, from, false), false);
    assert.equal(failures.record(key, from, true, true), true, 'provisioned accounts retain independent accounting');
  }
  assert.deepEqual([...failures], before);
  for (const from of ['', 'mcp', '127.0.0.1', '::1', '::ffff:127.0.0.1', '198.51.100.7']) {
    assert.equal(failures.record(failures.accountKey('new', from), from, true), true);
  }
});

test('anonymous per-account locks survive pool saturation, source aliases and duration edits', (t) => {
  let now = Math.floor(performance.now());
  t.mock.method(performance, 'now', () => now);
  const alias = 'anonymous-proxy';
  NO_ADDRESS_BUDGET.add(alias);
  t.after(() => NO_ADDRESS_BUDGET.delete(alias));
  const failures = new SignInFailures();
  const key = failures.accountKey('Ann', 'unknown');
  for (let i = 0; i < LOCKOUT.attempts; i++) {
    const from = i % 2 ? alias : 'unknown';
    assert.equal(failures.accountKey('Ann', from), key);
    failures.record(key, from, false, true);
  }
  const until = failures.get(key)!.until!;
  for (let i = 0; i < LOCKOUT.sharedFailures * 2; i++) failures.record(failures.accountKey(`name${i}`, alias), alias, false);
  assert.equal(failures.size, LOCKOUT.sharedFailures + 1);
  assert.ok(failures.lockedOut(key, alias, true));
  assert.equal(failures.record(key, alias, true, true), false);
  assert.equal(failures.addressLockedOut('unknown'), undefined);
  LOCKOUT.windowMs = LOCKOUT.lockMs = 1;
  now += 2;
  assert.ok(failures.lockedOut(key, alias, true), 'duration edits cannot shorten an issued account lock');
  assert.equal(failures.size, 1);
  now = until;
  assert.equal(failures.lockedOut(key, 'unknown', true), undefined);
  assert.equal(failures.size, 0);
});

test('anonymous pool admission follows elapsed time, window edits, deletion and clear', (t) => {
  const failures = new SignInFailures();
  let now = Math.floor(performance.now()), wall = Date.now();
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Date, 'now', () => wall);
  const fresh = failures.accountKey('new', 'unknown');
  const full = () => failures.lockedOut(fresh, 'unknown');
  const fill = () => {
    for (let i = 0; i < LOCKOUT.sharedFailures; i++) failures.record(failures.accountKey(`name${i}`, 'unknown'), 'unknown', false);
    assert.equal(failures.size, LOCKOUT.sharedFailures);
    assert.ok(full());
    assert.equal(failures.addressLockedOut('unknown'), undefined);
  };
  fill();
  wall += 3600_000;
  assert.ok(full());
  wall -= 7200_000;
  assert.ok(full());
  failures.delete(failures.accountKey('name0', 'unknown'));
  assert.equal(full(), undefined);
  fill();
  now += 60_000;
  LOCKOUT.windowMs = 60_000;
  assert.equal(full(), undefined);
  assert.equal(failures.size, 0);
  fill();
  failures.clear();
  assert.equal(full(), undefined);
  fill();
  now += LOCKOUT.windowMs;
  assert.equal(full(), undefined);
  assert.equal(failures.size, 0);
});

test('confirmed directory identities survive counter deletion and clock edits, with bounded LRU retention', (t) => {
  LOCKOUT.directoryAccounts = 2;
  let now = Math.floor(performance.now()), wall = Date.now();
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Date, 'now', () => wall);
  const alias = 'anonymous-directory-proxy';
  NO_ADDRESS_BUDGET.add(alias);
  t.after(() => NO_ADDRESS_BUDGET.delete(alias));
  const failures = new SignInFailures();
  const key = (name: string) => failures.accountKey(name, 'unknown');
  const fill = () => {
    for (let i = 0; i < LOCKOUT.sharedFailures; i++) failures.record(key(`invented${i}`), 'unknown', false);
  };
  fill();
  failures.confirmDirectory(key('alice'));
  failures.confirmDirectory(key('bob'));
  assert.equal(failures.record(key('alice'), alias, true), true);
  failures.confirmDirectory(key('ALICE'));
  failures.confirmDirectory(key('carol'));
  assert.ok(failures.lockedOut(key('bob'), alias), 'least recently successful identity is forgotten');
  assert.equal(failures.lockedOut(key('alice'), alias), undefined, 'success clears failures, not confirmation');
  assert.equal(failures.lockedOut(key('carol'), alias), undefined);
  for (let i = 0; i < LOCKOUT.attempts; i++) failures.record(key('alice'), alias, false);
  const until = failures.get(key('alice'))!.until!;
  for (let i = 0; i < 20; i++) failures.confirmDirectory(key(`real${i}`));
  assert.ok(failures.lockedOut(key('alice'), alias), 'LRU pressure cannot evict a live lock');
  assert.ok(failures.lockedOut(key('carol'), alias));
  assert.equal(failures.lockedOut(key('real19'), alias), undefined);
  wall += 3600_000;
  assert.ok(failures.lockedOut(key('alice'), alias));
  wall -= 7200_000;
  assert.ok(failures.lockedOut(key('alice'), alias));
  LOCKOUT.windowMs = LOCKOUT.lockMs = 1;
  now += 2;
  assert.ok(failures.lockedOut(key('alice'), alias), 'duration edits preserve issued locks');
  assert.equal(failures.size, 1, 'window edits expire open counters');
  now = until;
  assert.equal(failures.lockedOut(key('alice'), alias), undefined);
  fill();
  assert.equal(failures.record(key('alice'), alias, true), true, 'expiry preserves confirmation');
  failures.clear();
  fill();
  assert.equal(failures.lockedOut(key('alice'), alias), undefined, 'clearing failure counters preserves confirmation');
  assert.ok(failures.lockedOut(key('new'), alias));
  const reopened = new SignInFailures();
  for (let i = 0; i < LOCKOUT.sharedFailures; i++) reopened.record(key(`invented${i}`), 'unknown', false);
  assert.ok(reopened.lockedOut(key('alice'), alias), 'confirmation does not persist into a new instance');
});

test('directory identity cache cannot grow when every identity has a live counter', () => {
  LOCKOUT.directoryAccounts = 2;
  const failures = new SignInFailures();
  const key = (name: string) => failures.accountKey(name, 'unknown');
  for (const name of ['alice', 'bob']) {
    failures.confirmDirectory(key(name));
    failures.record(key(name), 'unknown', false);
  }
  for (let i = 0; i < 20; i++) failures.confirmDirectory(key(`real${i}`));
  for (let i = 0; i < LOCKOUT.sharedFailures; i++) failures.record(key(`invented${i}`), 'unknown', false);
  assert.equal(failures.size, LOCKOUT.sharedFailures + 2);
  assert.ok(failures.lockedOut(key('real19'), 'unknown'), 'a full pinned cache does not remember more identities');
  assert.equal(failures.lockedOut(key('alice'), 'unknown'), undefined);
  assert.equal(failures.lockedOut(key('bob'), 'unknown'), undefined);
  failures.delete(key('alice'));
  failures.confirmDirectory(key('carol'));
  assert.ok(failures.lockedOut(key('alice'), 'unknown'));
  assert.equal(failures.lockedOut(key('carol'), 'unknown'), undefined);
});

test('unconfirmed directory names finishing concurrent checks cannot overfill the shared pool', async (t) => {
  LOCKOUT.sharedFailures = 2;
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-directory-race-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  const finish: (() => void)[] = [];
  const hashes = t.mock.method(crypto, 'scrypt', ((_p: unknown, _s: unknown, length: number, cb: (error: Error | null, key: Buffer) => void) => {
    finish.push(() => cb(null, Buffer.alloc(length)));
  }) as typeof crypto.scrypt);
  syncBuiltinESMExports();
  t.after(() => { hashes.mock.restore(); syncBuiltinESMExports(); });
  const pending = Array.from({ length: 10 }, (_, i) => store.verifyAsync(`directory${i}`, 'wrong', 'unknown'));
  assert.equal(finish.length, 10, 'all checks began before capacity was consumed');
  assert.equal(failures.size, 0, 'password checks hold no capacity lease');
  finish.forEach((done) => done());
  assert.deepEqual(await Promise.all(pending), Array(10).fill(false));
  assert.equal(failures.size, 2);
  assert.ok(store.lockedOut('new', 'unknown'));
  assert.equal(await store.verifyAsync('new', 'wrong', 'unknown'), false);
  assert.equal(hashes.mock.callCount(), 10, 'capacity refusal skips further credential work');
  assert.equal(failures.size, 2);
});

test('password, recovery and TOTP failures for unknown accounts cost the same address budget before admission', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-factor-budget-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  const paths = [
    (name: string, from: string) => store.verifyAsync(name, 'wrong', from),
    (name: string, from: string) => store.useRecoveryCode(name, 'wrong', from),
    (name: string, from: string) => store.verifyTotp(name, 'wrong', from),
  ];
  for (const from of ['198.51.100.7']) for (const attempt of paths) {
    failures.clear();
    const limit = LOCKOUT.addressAttempts;
    for (let i = 0; i < limit; i++) {
      assert.equal(await attempt(`missing${i}`, from), false);
      assert.equal(failures.get(`\0address\0${from}`)?.count, i + 1);
      assert.equal(failures.size, Math.min(i + 2, limit), 'address is charged before a new name is admitted');
    }
    assert.ok(store.addressLockedOut(from));
    const before = [...failures];
    assert.equal(await attempt('late', from), false);
    assert.deepEqual([...failures], before);
  }
});

test('600 anonymous recovery failures leave real accounts available with their own five-attempt lockouts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-unknown-availability-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  LOCKOUT.attempts = 5;
  store.setPassword('Admin', 'right');
  store.setPassword('Ann', 'another-right');
  const { secret } = store.enrollTotp('Admin');
  store.confirmTotp('Admin', totpCode(secret));
  const [recovery] = store.generateRecoveryCodes('Admin', 1);
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  for (let i = 0; i < 600; i++) assert.equal(store.useRecoveryCode(`made-up-${i}`, 'wrong', 'unknown'), false);
  assert.equal(failures.size, LOCKOUT.sharedFailures, 'invented names exhaust only their bounded pool');
  for (const protectedSlots of [false, true]) {
    for (let i = failures.size; i < LOCKOUT.maxFailures; i++) failures.set(`ordinary${i}`, { count: 1, first: performance.now() });
    if (protectedSlots) for (const [key, value] of [...failures]) failures.set(key, { ...value, until: performance.now() + LOCKOUT.lockMs });
    assert.equal(store.addressLockedOut('unknown'), undefined);
    assert.equal(store.verify('Admin', 'right', 'unknown'), true);
    assert.equal(await store.verifyAsync('Ann', 'another-right', 'unknown'), true);
  }
  const checks = [
    { suffix: '', wrong: () => store.verify('Admin', 'wrong', 'unknown'), right: () => store.verify('Admin', 'right', 'unknown') },
    { suffix: '\0totp', wrong: () => store.verifyTotp('Admin', 'wrong', 'unknown'), right: () => store.verifyTotp('Admin', totpCode(secret), 'unknown') },
    { suffix: '\0recovery', wrong: () => store.useRecoveryCode('Admin', 'wrong', 'unknown'), right: () => store.useRecoveryCode('Admin', recovery, 'unknown') },
  ];
  for (const check of checks) {
    const key = failures.accountKey('Admin', 'unknown') + check.suffix;
    for (let i = 1; i <= LOCKOUT.attempts; i++) {
      assert.equal(check.wrong(), false);
      assert.equal(failures.get(key)?.count, i, 'a real account never gets uncounted guesses at capacity');
    }
    assert.ok(failures.blocked(key));
    assert.equal(check.right(), false);
    assert.equal(await store.verifyAsync('Ann', 'another-right', 'unknown'), true, 'another account stays available');
  }
  assert.equal(failures.size, LOCKOUT.maxFailures + 3, 'the reserve holds at most one counter per real account and factor');
  assert.equal(store.recoveryCodesRemaining('Admin'), 1, 'a locked factor leaves its valid code unused');
  assert.equal(store.unlock('Admin'), true);
  for (const check of checks) assert.equal(check.right(), true);
  assert.equal(failures.size, LOCKOUT.maxFailures);
});

test('IPv6 spellings share a /64 budget and mapped IPv4 spellings share an address', () => {
  const failures = new SignInFailures();
  for (const forms of [
    ['2001:db8:1:2::1', '2001:0DB8:0001:0002:0:0:0:2', '2001:db8:1:2::192.0.2.1'],
    ['192.0.2.5', '::ffff:192.0.2.5', '0:0:0:0:0:ffff:c000:0205'],
  ]) {
    for (const from of forms) assert.equal(addressBucket(from), addressBucket(forms[0]));
    for (let i = 0; i < LOCKOUT.addressAttempts; i++) failures.countAddressFailure(forms[i % forms.length]);
    for (const from of forms) assert.ok(failures.addressLockedOut(from));
  }
  assert.equal(failures.addressLockedOut('2001:db8:1:3::1'), undefined);
  assert.equal(failures.addressLockedOut('192.0.2.6'), undefined);
});

for (const ipv6 of [false, true]) test(`one ${ipv6 ? 'IPv6 /64' : 'IPv4 address'} cannot accumulate locks by losing its address counter`, (t) => {
  const failures = new SignInFailures();
  let now = Math.floor(performance.now()), wall = Date.now();
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Date, 'now', () => wall);
  const source = (i: number) => ipv6 ? `2001:db8:1:2::${i + 1}` : i % 2 ? '::ffff:192.0.2.5' : '192.0.2.5';
  const address = `\0address\0${addressBucket(source(0))}`;
  for (let i = 0; i < LOCKOUT.addressLocks; i++) {
    const from = source(i), key = failures.accountKey(`name${i}`, from);
    for (let j = 0; j < LOCKOUT.attempts; j++) failures.record(key, from, false);
    assert.ok(failures.blocked(key));
    failures.delete(address); // an explicit address unlock must not bypass the six-lock cap
  }
  const before = [...failures];
  assert.equal(before.length, LOCKOUT.addressLocks);
  for (let i = 0; i < LOCKOUT.maxFailures; i++) {
    const from = source(i + LOCKOUT.addressLocks);
    assert.ok(failures.addressLockedOut(from));
    assert.equal(failures.record(failures.accountKey(`later${i}`, from), from, false), false);
  }
  assert.deepEqual([...failures], before);
  assert.equal(failures.record(failures.accountKey('fresh', '198.51.100.7'), '198.51.100.7', true), true);
  wall += 3600_000;
  LOCKOUT.windowMs = LOCKOUT.lockMs = 1;
  now += 2;
  assert.ok(failures.addressLockedOut(source(100)), 'clock/window edits do not release live network locks');
  failures.delete(before[0][0]);
  assert.equal(failures.addressLockedOut(source(100)), undefined, 'explicit unlock releases the network slot');
  failures.set(before[0][0], before[0][1]);
  assert.ok(failures.addressLockedOut(source(100)));
  now = before[0][1].until!;
  assert.equal(failures.addressLockedOut(source(100)), undefined);
  assert.equal(failures.size, 0, 'expiry releases all indexed locks');
  now -= 1;
  for (const [key, value] of before) failures.set(key, value);
  assert.ok(failures.addressLockedOut(source(100)));
  failures.clear();
  assert.equal(failures.addressLockedOut(source(100)), undefined, 'clear releases the index too');
});

test('a full lockout table admits correct passwords and bounds new failures by eviction', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-full-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  store.setPassword('Admin', 'right');
  let now = Math.floor(performance.now());
  t.mock.method(performance, 'now', () => now);
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  for (let i = 0; i < LOCKOUT.maxFailures; i++) failures.set(`name${i}\0place`, { count: 1, first: now });
  for (const from of ['198.51.100.7', '2001:db8:1::1', '', '127.0.0.1', '::1', 'mcp']) {
    assert.equal(store.lockedOut('Admin', from), undefined, 'capacity is not a lockout');
    assert.equal(store.verify('Admin', 'right', from), true);
    assert.equal(await store.verifyAsync('Admin', 'right', from), true);
  }
  assert.equal(failures.size, LOCKOUT.maxFailures, 'successful sign-ins need no capacity');
  assert.equal(store.unlockAddress('untracked'), false);
  const from = '198.51.100.8';
  for (let i = 0; i < LOCKOUT.attempts; i++) assert.equal(store.verify('Admin', 'wrong', from), false);
  assert.equal(failures.size, LOCKOUT.maxFailures);
  assert.equal(failures.has('name0\0place'), false, 'oldest counters yield to new failures');
  assert.ok(store.lockedOut('Admin', from), 'new accounts still acquire their own lockouts at capacity');
  assert.equal(await store.verifyAsync('Admin', 'right', from), false);
  assert.equal(await store.verifyAsync('Admin', 'right', '198.51.100.9'), true);
  for (const [key, value] of [...failures]) failures.set(key, { ...value, until: now + LOCKOUT.lockMs });
  assert.equal(store.verify('Admin', 'right', '198.51.100.9'), false, 'protected capacity refuses a new source');
  assert.equal(await store.verifyAsync('Admin', 'right', '198.51.100.9'), false);
  now += LOCKOUT.windowMs + LOCKOUT.lockMs;
  assert.equal(store.lockedOut('Admin', from), undefined);
  assert.equal(failures.size, 0, 'expired counters and locks are swept');
});

for (const asynchronous of [false, true]) {
  test(`one address cannot fill the failure table through ${asynchronous ? 'async' : 'sync'} password checks`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-spray-'));
    createStore(join(dir, 'New.sqlite'));
    const store = new Store(join(dir, 'New.sqlite'));
    t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
    store.setPassword('Admin', 'right');
    const hashes = t.mock.method(crypto, asynchronous ? 'scrypt' : 'scryptSync');
    syncBuiltinESMExports();
    t.after(() => { hashes.mock.restore(); syncBuiltinESMExports(); });
    const failures = (store as unknown as { failures: SignInFailures }).failures;
    const from = '203.0.113.5';
    for (let i = 0; i < LOCKOUT.maxFailures * 2; i++) {
      const ok = asynchronous ? await store.verifyAsync(`made-up-${i}`, 'x', from) : store.verify(`made-up-${i}`, 'x', from);
      assert.equal(ok, false);
    }
    assert.equal(hashes.mock.callCount(), LOCKOUT.addressAttempts, 'locked addresses do no more password work');
    assert.equal(failures.size, LOCKOUT.addressAttempts, 'only failures before the address locked retain names');
    assert.ok(store.addressLockedOut(from));
    assert.equal(failures.has(failures.accountKey(`made-up-${LOCKOUT.addressAttempts}`, from)), false);
    for (const fresh of ['198.51.100.7', '2001:db8:1::1', '', '127.0.0.1']) {
      assert.equal(await store.verifyAsync('Admin', 'right', fresh), true, 'a stranger cannot lock out another address');
    }
  });
}

test('an address at capacity retains its budget before admitting another name', () => {
  const failures = new SignInFailures();
  const from = '203.0.113.5', address = `\0address\0${from}`;
  failures.countAddressFailure(from); // the oldest entry would otherwise be evicted by the next name
  for (let i = 1; i < LOCKOUT.maxFailures; i++) failures.set(`old${i}`, { count: 1, first: performance.now() });
  for (let i = 1; i < LOCKOUT.addressAttempts; i++) failures.record(failures.accountKey(`new${i}`, from), from, false);
  assert.equal(failures.get(address)?.count, LOCKOUT.addressAttempts);
  assert.ok(failures.addressLockedOut(from));
  const before = [...failures];
  for (const ok of [false, true]) {
    assert.equal(failures.record(failures.accountKey('late', from), from, ok), false);
    assert.equal(failures.record(failures.accountKey('mapped', `::ffff:${from}`), `::ffff:${from}`, ok), false);
  }
  assert.deepEqual([...failures], before, 'locked attempts neither insert names nor evict other counters');
});

test('password checks already in flight cannot insert names after their address locks', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-flight-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  const pending: (() => void)[] = [];
  const hashes = t.mock.method(crypto, 'scrypt', ((_password: unknown, _salt: unknown, length: number, callback: (error: Error | null, key: Buffer) => void) => {
    pending.push(() => callback(null, Buffer.alloc(length)));
  }) as typeof crypto.scrypt);
  syncBuiltinESMExports();
  t.after(() => { hashes.mock.restore(); syncBuiltinESMExports(); });
  const attempts = Array.from({ length: LOCKOUT.addressAttempts * 2 }, (_, i) => store.verifyAsync(`pending${i}`, 'wrong', '203.0.113.9'));
  assert.equal(pending.length, attempts.length);
  for (const finish of pending) finish();
  assert.ok((await Promise.all(attempts)).every((ok) => !ok));
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  assert.equal(failures.size, LOCKOUT.addressAttempts);
});

test('locked addresses cannot add second-factor failures or consume a valid code', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-factors-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  store.setPassword('Admin', 'right');
  const { secret } = store.enrollTotp('Admin');
  store.confirmTotp('Admin', totpCode(secret));
  const [recovery] = store.generateRecoveryCodes('Admin', 1);
  const from = '203.0.113.5';
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(from);
  const failures = (store as unknown as { failures: SignInFailures }).failures;
  const before = [...failures];
  assert.equal(store.verifyTotp('Admin', 'wrong', from), false);
  assert.equal(store.verifyTotp('Admin', totpCode(secret), from), false);
  for (let i = 0; i < 100; i++) assert.equal(store.useRecoveryCode(`fake${i}`, 'wrong', from), false);
  assert.equal(store.useRecoveryCode('Admin', recovery, from), false);
  assert.equal(store.recoveryCodesRemaining('Admin'), 1, 'refusal leaves the valid code unused');
  assert.deepEqual([...failures], before);
  for (let i = 0; i < LOCKOUT.sharedFailures; i++) store.useRecoveryCode(`anonymous${i}`, 'wrong', 'unknown');
  for (let i = failures.size; i < LOCKOUT.maxFailures; i++) failures.set(`other${i}`, { count: 1, first: performance.now() });
  assert.equal(store.verifyTotp('Admin', totpCode(secret), 'unknown'), true, 'anonymous capacity cannot reject or consume a valid factor without accepting it');
  assert.equal(store.useRecoveryCode('Admin', recovery, 'unknown'), true);
  assert.equal(store.recoveryCodesRemaining('Admin'), 0);
});

test('editing the failure window expires counters without shortening existing locks', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-window-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  const limits = { ...LOCKOUT };
  t.after(() => { Object.assign(LOCKOUT, limits); store.close(); rmSync(dir, { recursive: true }); });
  // Lockouts run on elapsed time; epoch time is only what lockedOut reports.
  let now = Math.floor(performance.now()); // whole milliseconds, so expiry boundaries compare exactly
  const start = now, wall = Date.now();
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Date, 'now', () => wall + (now - start));
  const failures = (store as unknown as { failures: Map<string, { count: number; first: number; until?: number }> }).failures;
  failures.set('old\0place', { count: 1, first: now });
  failures.set('locked\0place', { count: 5, first: now, until: now + LOCKOUT.lockMs });
  now += 60_000;
  LOCKOUT.windowMs = 60_000;
  assert.equal(store.lockedOut('old', 'place'), undefined);
  assert.equal(failures.has('old\0place'), false, 'a changed window invalidates the cached sweep time');
  assert.ok(store.lockedOut('locked', 'place'), 'a lock retains its issued expiry');
});

test('lockouts and challenge rate limits follow elapsed time through wall-clock jumps', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-clock-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  let wall = Date.now(), mono = Math.floor(performance.now()); // exact millisecond boundaries
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  for (let i = 0; i < LOCKOUT.attempts; i++) store.verify('missing', 'wrong', '10.0.0.9');
  for (let i = 0; i < 60; i++) assert.equal(store.challengeWait('10.0.0.9'), 0);
  wall += 3600_000;
  assert.equal(store.lockedOut('missing', '10.0.0.9'), wall + LOCKOUT.lockMs);
  assert.equal(store.challengeWait('10.0.0.9'), 60, 'forward jump does not refill the rate limit');
  wall -= 7200_000;
  mono += 60_001;
  assert.equal(store.challengeWait('10.0.0.9'), 0, 'backward jump does not extend the rate limit');
  assert.equal(store.lockedOut('missing', '10.0.0.9'), wall + LOCKOUT.lockMs - 60_001);
  mono += LOCKOUT.lockMs;
  assert.equal(store.lockedOut('missing', '10.0.0.9'), undefined);
});

test('repeated wrong passwords lock out that place, not the account everywhere', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  try {
    store.setPassword('Admin', 'right');
    for (let i = 0; i < LOCKOUT.attempts - 1; i++) assert.equal(store.verify('Admin', 'wrong', '10.0.0.9'), false);
    assert.equal(store.lockedOut('Admin', '10.0.0.9'), undefined);
    assert.equal(store.verify('Admin', 'right', '10.0.0.9'), true, 'a success before the limit resets the count');

    for (let i = 0; i < LOCKOUT.attempts; i++) store.verify('admin', 'wrong', '10.0.0.9');
    assert.ok(store.lockedOut('Admin', '10.0.0.9')! > Date.now());
    assert.equal(store.verify('Admin', 'right', '10.0.0.9'), false, 'locked out even with the right password');
    assert.equal(store.verify('Admin', 'right', '10.0.0.7'), true, 'others can still sign in');

    assert.equal(store.unlock('ADMIN'), true);
    assert.equal(store.unlock('Admin'), false, 'a repeated unlock clears no block');
    assert.equal(store.verify('Admin', 'right', '10.0.0.9'), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

for (const scope of ['account', 'address']) {
  for (const expired of [false, true]) {
    test(`${scope} unlock returns false for ${expired ? 'expired blocks' : 'counters below the threshold'}`, (t) => {
      const dir = mkdtempSync(join(tmpdir(), 'tabularius-unlock-'));
      createStore(join(dir, 'New.sqlite'));
      const store = new Store(join(dir, 'New.sqlite'));
      try {
        const address = '198.51.100.7';
        const limit = scope === 'account' ? LOCKOUT.attempts : LOCKOUT.addressAttempts;
        const unlock = () => scope === 'account' ? store.unlock('Admin') : store.unlockAddress(address);
        assert.equal(unlock(), false, 'no counter or block exists');
        for (let i = 0; i < (expired ? limit : 1); i++) {
          if (scope === 'account') store.verify('Admin', 'wrong', address);
          else store.countAddressFailure(address);
        }
        if (expired) {
          assert.ok(store.lockedOut('Admin', address));
          const now = performance.now();
          t.mock.method(performance, 'now', () => now + LOCKOUT.lockMs);
        }
        assert.equal(store.lockedOut('Admin', address), undefined);
        assert.equal(unlock(), false, 'clearing a counter is not clearing an active block');
      } finally {
        store.close();
        rmSync(dir, { recursive: true });
      }
    });
  }
}

test('trying many different names from one address locks that address, not the others or this computer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  try {
    store.setPassword('Admin', 'right');
    const spray = (from: string, n: number) => { for (let i = 0; i < n; i++) store.verify(`guess${i}`, 'wrong', from); };
    spray('10.0.0.9', LOCKOUT.addressAttempts - 1);
    assert.equal(store.lockedOut('Admin', '10.0.0.9'), undefined, 'under the budget');
    assert.equal(store.verify('Admin', 'right', '10.0.0.9'), true, 'a real sign-in is still allowed');
    assert.equal(store.verify('Admin', 'wrong', '10.0.0.9'), false);
    assert.ok(store.lockedOut('Admin', '10.0.0.9')! > Date.now(), 'the address is blocked for every account, with a time');
    assert.ok(store.lockedOut('nobody-yet', '10.0.0.9')! > Date.now());
    assert.equal(store.verify('Admin', 'right', '10.0.0.9'), false, 'even with the right password');
    assert.equal(store.verify('Admin', 'right', '10.0.0.7'), true, 'another address is unaffected');
    spray('127.0.0.1', LOCKOUT.addressAttempts * 2);
    assert.equal(store.lockedOut('Admin', '127.0.0.1'), undefined, 'this computer is exempt');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('the address budget treats mapped and same-/64 addresses as one, without an anonymous address lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  try {
    for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.verify(`g${i}`, 'x', i % 2 ? '::ffff:10.0.0.5' : '10.0.0.5');
    assert.ok(store.lockedOut('Admin', '10.0.0.5')! > Date.now(), 'mapped and plain forms share a budget');
    for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.verify(`g${i}`, 'x', `2001:db8:1:2:${i}::${i + 1}`);
    assert.ok(store.lockedOut('Admin', '2001:db8:1:2:ffff::1')! > Date.now(), 'a /64 shares one');
    assert.equal(store.lockedOut('Admin', '2001:db8:1:3::1'), undefined, 'another /64 does not');
    for (let i = 0; i < LOCKOUT.sharedFailures * 2; i++) store.useRecoveryCode(`g${i}`, 'x', 'unknown');
    assert.equal(store.lockedOut('Admin', 'unknown'), undefined, 'invented anonymous names do not lock real accounts');
    assert.equal(store.lockedOut('Admin', '127.0.0.1'), undefined, 'anonymous failures do not block this computer');
    store.unlock('');
    assert.ok(store.lockedOut('Admin', '10.0.0.5')! > Date.now(), 'an empty name does not clear address blocks');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});


test('directory single-flight releases on failure, exception and disconnect around acquisition', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-directory-flight-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  const hashes = t.mock.method(crypto, 'scrypt', ((_p: unknown, _s: unknown, length: number, cb: (error: Error | null, key: Buffer) => void) => {
    queueMicrotask(() => cb(null, Buffer.alloc(length)));
  }) as typeof crypto.scrypt);
  syncBuiltinESMExports();
  t.after(() => { hashes.mock.restore(); syncBuiltinESMExports(); });
  const active = (store as unknown as { directoryChecks: Set<string> }).directoryChecks;
  for (const disconnectAt of [1, 2, 3]) {
    let checks = 0, calls = 0;
    const account = `disconnect${disconnectAt}`;
    await assert.rejects(store.verifyAsync(account, 'wrong', 'unknown', async () => { calls++; return true; }, () => {
      if (++checks === disconnectAt) throw new Error('disconnected');
    }), /disconnected/);
    assert.equal(calls, disconnectAt === 3 ? 1 : 0, 'disconnect before or just after acquisition cannot reach LDAP');
    assert.equal(active.size, 0, 'disconnect releases the flight');
    assert.equal(await store.verifyAsync(account, 'right', 'unknown', async () => true), true);
  }
  await assert.rejects(store.verifyAsync('error', 'wrong', 'unknown', async () => { throw new Error('directory error'); }), /directory error/);
  assert.equal(active.size, 0);
  assert.equal(await store.verifyAsync('error', 'right', 'unknown', async () => true), true);
  assert.equal(await store.verifyAsync('failure', 'wrong', 'unknown', async () => false), false);
  assert.equal(active.size, 0);
  assert.equal(await store.verifyAsync('failure', 'right', 'unknown', async () => true), true);
  assert.equal(active.size, 0);
});

test('a socket\'s scope suffix does not split an address budget', () => {
  // The kernel adds %interface to a link-local peer: one host, one /64 budget, however it is spelled.
  assert.equal(addressBucket('fe80::1%en0'), addressBucket('fe80::1'));
  assert.equal(addressBucket('fe80::1%en0'), addressBucket('fe80::2%en1'));
  assert.equal(addressBucket('fe80::1%en0'), 'fe80:0:0:0');
  const failures = new SignInFailures();
  const spellings = ['fe80::1%en0', 'fe80::2%en1', 'fe80::3', 'fe80:0:0:0:9::a%lo0'];
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) {
    const from = spellings[i % spellings.length];
    failures.record(failures.accountKey(`name${i}`, from), from, false);
  }
  assert.ok(failures.addressLockedOut('fe80::77%en2') !== undefined, 'the spellings shared one address budget');
});

test('a lockout is audited with the whole client address, not its /64 bucket', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-audit-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  store.setPassword('Admin', 'right');
  const from = '2001:db8:1:2::abcd';
  for (let i = 0; i < LOCKOUT.attempts; i++) assert.equal(store.verify('Admin', 'wrong', from), false);
  const locks = store.auditLog({ security: true, kind: 'locked-out', limit: 100 });
  assert.equal(locks.length, 1);
  assert.equal(locks[0].from, from);
});

test('a lockout from this computer is audited with its own address, not a bucket', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-audit-local-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  store.setPassword('Admin', 'right');
  for (const [name, from, shown] of [['one', '::1', '::1'], ['two', '127.0.0.1', '127.0.0.1'], ['three', '::ffff:127.0.0.1', '127.0.0.1']] as const) {
    store.setPassword(name, 'right');
    for (let i = 0; i < LOCKOUT.attempts; i++) assert.equal(store.verify(name, 'wrong', from), false);
    const lock = store.auditLog({ security: true, kind: 'locked-out', limit: 100 }).filter((e) => e.account === name);
    assert.equal(lock.length, 1, name);
    assert.equal(lock[0].from, shown, name);
  }
});
