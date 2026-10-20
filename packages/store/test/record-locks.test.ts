import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordLocks, SharedRecordLocks, LOCK_TTL_MS, StoreError } from '../src/index.ts';

for (const shared of [false, true]) {
  const kind = shared ? 'shared' : 'memory';
  const setup = (maxLocksPerSession = 4) => {
    const db = new DatabaseSync(':memory:');
    const locks = shared ? new SharedRecordLocks(db, 'Audit', maxLocksPerSession) : new RecordLocks(maxLocksPerSession);
    const stored = () => shared
      ? Number(db.prepare('SELECT count(*) AS n FROM locks').get()!.n)
      : (locks as unknown as { locks: Map<string, unknown> }).locks.size;
    return { db, locks, stored };
  };

  test(`${kind}: capacity belongs to a session, including across workers`, (t) => {
    const { db, locks } = setup();
    const peer = shared ? new SharedRecordLocks(db, 'AUDIT', 4) : locks;
    t.after(() => db.close());
    const now = 1_000_000;
    for (let id = 1; id <= 4; id++) assert.ok((id % 2 ? locks : peer).acquire('T', id, 'session-1', 'Ann', now).ok);
    assert.throws(() => peer.acquire('OtherTable', 5, 'session-1', 'Ann', now), (e: unknown) => e instanceof StoreError && e.code === 812);
    assert.ok(locks.acquire('T', 1, 'session-1', 'Änn', now + 1).ok, 'renewals still work at the cap');
    assert.ok(peer.acquire('T', 5, 'session-2', 'Ann', now).ok, 'a shared account has independent session allowances');
    assert.equal(peer.release('T', 2, 'session-1'), true);
    assert.ok(locks.acquire('OtherTable', 5, 'session-1', 'Ann', now).ok, 'releasing restores capacity across workers');
    assert.ok(peer.acquire('T', 6, 'session-1', 'Ann', now + LOCK_TTL_MS).ok, 'expired locks do not consume capacity');
    assert.equal(locks.releaseOwner('session-1').length, 2);
    for (let id = 1; id <= 4; id++) assert.ok(peer.acquire('T', id, 'session-1', 'Ann', now + LOCK_TTL_MS + 1).ok);
  });

  test(`${kind}: acquisition does not enumerate every live lock`, (t) => {
    const { db, locks } = setup(5000);
    t.after(() => db.close());
    const listing = t.mock.method(locks, 'all');
    for (let id = 1; id <= 500; id++) assert.ok(locks.acquire('T', id, 'session-1', 'Ann', 1000).ok);
    assert.equal(listing.mock.callCount(), 0, 'capacity checks must not materialize the lock table on each acquire');
    for (let id = 501; id <= 5000; id++) assert.ok(locks.acquire('T', id, 'session-1', 'Ann', 1000).ok);
    assert.throws(() => locks.acquire('T', 5001, 'session-1', 'Ann', 1000), (e: unknown) => e instanceof StoreError && e.code === 812);
  });

  test(`${kind}: acquiring sweeps stale entries even when nobody lists locks`, (t) => {
    const { db, locks, stored } = setup();
    t.after(() => db.close());
    locks.acquire('T', 1, 'gone', 'Ann', 1000);
    locks.acquire('T', 2, 'live', 'Bob', 1001);
    locks.acquire('T', 3, 'next', 'Cat', 1000 + LOCK_TTL_MS);
    assert.equal(stored(), 2, 'expired entries on other records must be removed');
    assert.equal(locks.holder('T', 2, 1000 + LOCK_TTL_MS)?.owner, 'live');
    assert.deepEqual(locks.all(1001 + LOCK_TTL_MS).map((l) => l.recordId), [3]);
    assert.ok(locks.acquire('T', 1, 'replacement', 'Dan', 1001 + LOCK_TTL_MS).ok);
    assert.equal(locks.release('T', 1, 'gone'), false, 'old owner cannot release its replacement');
  });
}

test('shared: existing leases and rolled-back changes keep capacity consistent across connections', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lock-counts-'));
  const db = new DatabaseSync(join(dir, 'locks.sqlite'));
  const other = new DatabaseSync(join(dir, 'locks.sqlite'));
  t.after(() => { other.close(); db.close(); rmSync(dir, { recursive: true }); });
  db.exec(`CREATE TABLE locks (file TEXT NOT NULL, tbl TEXT NOT NULL, record_id INTEGER NOT NULL,
    owner TEXT NOT NULL, account TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY (file, tbl, record_id));
    INSERT INTO locks VALUES ('audit', 'T', 1, 'session', 'Ann', 1060000)`);
  const locks = new SharedRecordLocks(db, 'Audit', 2);
  const peer = new SharedRecordLocks(other, 'AUDIT', 2);
  assert.ok(peer.acquire('T', 2, 'session', 'Ann', 1_000_000).ok);
  assert.throws(() => locks.acquire('T', 3, 'session', 'Ann', 1_000_000), (e: unknown) => e instanceof StoreError && e.code === 812);
  db.exec('BEGIN IMMEDIATE');
  assert.ok(locks.release('T', 1, 'session'));
  db.exec('ROLLBACK');
  assert.throws(() => peer.acquire('T', 3, 'session', 'Ann', 1_000_000), (e: unknown) => e instanceof StoreError && e.code === 812);
  assert.equal(peer.releaseOwner('session').length, 2);
  assert.ok(locks.acquire('T', 3, 'session', 'Ann', 1_000_000).ok);
  assert.ok(peer.acquire('T', 4, 'session', 'Ann', 1_000_000).ok);
  assert.equal(Number(db.prepare('SELECT n FROM lock_counts WHERE file = ? AND owner = ?').get('audit', 'session')!.n), 2);
});
