import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, Store, LOCKOUT } from '../src/index.ts';

// Lockouts count elapsed time (performance.now); Date.now only shows the end of a lock. The tests move both together.
function open(t: import('node:test').TestContext, prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'A.sqlite'); createStore(path);
  const store = new Store(path); t.after(() => store.close());
  let wall = Date.now(), mono = Math.floor(performance.now());
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  return { store, now: () => wall, advance: (ms: number) => { wall += ms; mono += ms; } };
}

test('lockouts expire at the boundary and a fresh failure window does not inherit old attempts', (t) => {
  const { store, now, advance } = open(t, 'mutation-lock-clock-');
  const address = '203.0.113.20';
  for (let i = 0; i < LOCKOUT.addressAttempts - 1; i++) store.countAddressFailure(address);
  assert.equal(store.addressLockedOut(address), undefined);
  advance(LOCKOUT.windowMs);
  store.countAddressFailure(address);
  assert.equal(store.addressLockedOut(address), undefined, 'the expired window starts over');
  for (let i = 1; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(address);
  assert.equal(store.addressLockedOut(address), now() + LOCKOUT.lockMs);
  const events = store.auditLog({ security: true, kind: 'locked-out' });
  assert.equal(events.length, 1);
  assert.equal(events[0].from, address);
  assert.equal(events[0].changes?.scope, 'address');
  advance(LOCKOUT.lockMs - 1);
  assert.ok(store.addressLockedOut(address));
  advance(1);
  assert.equal(store.addressLockedOut(address), undefined);
  store.countAddressFailure(address);
  assert.equal(store.addressLockedOut(address), undefined);
  for (let i = 1; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(address);
  assert.equal(store.addressLockedOut(address), now() + LOCKOUT.lockMs, 'an expired lock starts a usable fresh failure window');
});

test('a flood keeps live locks, refuses new sources at the memory bound, and takes them again once entries expire', (t) => {
  const { store, now, advance } = open(t, 'mutation-lock-cap-');
  const oldest = '203.0.113.21', newest = '192.0.2.1';
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(oldest);
  const until = store.addressLockedOut(oldest);
  assert.equal(until, now() + LOCKOUT.lockMs);
  const address = (i: number) => `10.1.${Math.floor(i / 256)}.${i % 256}`;
  for (let i = 0; i < 10_001; i++) store.countAddressFailure(address(i));
  assert.equal(store.addressLockedOut(oldest), until, 'a sweep below the 40,000-entry bound must retain live locks');
  for (let i = 10_001; i < 40_000; i++) store.countAddressFailure(address(i));
  assert.equal(store.addressLockedOut(newest) !== undefined, true, 'at the bound a new source is refused rather than an entry evicted');
  assert.equal(store.addressLockedOut(oldest), until, 'the live lock is not evicted to make room');
  advance(LOCKOUT.windowMs + 1);
  store.countAddressFailure(newest);
  assert.equal(store.addressLockedOut(newest), undefined, 'expired entries make room again');
  for (let i = 1; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(newest);
  assert.equal(store.addressLockedOut(newest), now() + LOCKOUT.lockMs, 'the new source retains its first failure');
});

test('sweep throttling and expiry reclaim idle buckets without scanning on every failure', (t) => {
  const { store, advance } = open(t, 'mutation-lock-sweep-');
  for (let i = 0; i < 10_001; i++) store.countAddressFailure(`10.2.${Math.floor(i / 256)}.${i % 256}`);
  // Inspect retained memory and count scans, rather than asserting elapsed time
  // or calling private decision helpers. Public failure calls drive all state.
  const buckets = Reflect.get(store, 'failures') as Map<string, unknown>;
  assert.ok(buckets instanceof Map);
  const iterate = buckets[Symbol.iterator]; let scans = 0;
  t.mock.method(buckets, Symbol.iterator, function (this: typeof buckets) { scans++; return iterate.call(this); });
  store.countAddressFailure('192.0.2.1');
  advance(1000); store.countAddressFailure('192.0.2.2');
  assert.equal(scans, 0, 'failures inside the window cannot trigger a sweep');
  advance(LOCKOUT.windowMs + 1); store.countAddressFailure('192.0.2.4');
  assert.equal(scans, 1, 'the first expiry sweeps once');
  assert.equal(buckets.size, 1, 'expired buckets are reclaimed before the hard memory cap is reached');
});
