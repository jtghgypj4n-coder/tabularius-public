import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LOCK_TTL_MS, VIEW_TTL_MS, RecordLocks, SharedRecordLocks } from '../src/activity.ts';
import { monotonicClock } from '../src/monotonic.ts';

const HOUR = 3_600_000;
const EPOCH = Date.UTC(2026, 0, 1);

test('the shared clock defaults to elapsed milliseconds, independently of wall time', (t) => {
  t.mock.method(Date, 'now', () => EPOCH);
  t.mock.method(performance, 'now', () => 123.5);
  assert.equal(monotonicClock.now(), 123.5);
});

for (const jump of [HOUR, -HOUR]) {
  test(`record leases ignore a ${jump / HOUR} hour wall-clock jump`, (t) => {
    let wall = EPOCH;
    let elapsed = 0;
    t.mock.method(Date, 'now', () => wall);
    t.mock.method(monotonicClock, 'now', () => elapsed);
    const locks = new RecordLocks();
    const first = locks.acquire('Tasks', 1, 'ann', 'Ann');
    locks.acquire('Tasks', 2, 'ann', 'Ann');
    assert.equal(first.lock.expires, wall + LOCK_TTL_MS, 'the public expiry stays epoch milliseconds');
    wall += jump;
    elapsed += LOCK_TTL_MS / 2;
    assert.equal(locks.holder('Tasks', 1)?.owner, 'ann');
    assert.equal(locks.othersIn('Tasks', 'bob').length, 2);
    assert.equal(locks.acquire('Tasks', 1, 'bob', 'Bob').ok, false, 'a wall jump cannot steal a live lock');
    const renewed = locks.acquire('Tasks', 1, 'ann', 'Ann');
    assert.equal(renewed.fresh, false);
    assert.equal(renewed.lock.expires, wall + LOCK_TTL_MS);
    elapsed += LOCK_TTL_MS - 1;
    assert.deepEqual(locks.all().map((l) => l.recordId), [1], 'only the renewed lease survives');
    elapsed++;
    assert.equal(locks.holder('Tasks', 1), undefined, 'renewal expires at the elapsed deadline');
    assert.deepEqual(locks.all(), []);
    assert.equal(locks.acquire('Tasks', 1, 'bob', 'Bob').fresh, true);
  });

  test(`record presence ignores a ${jump / HOUR} hour wall-clock jump`, (t) => {
    let wall = EPOCH;
    let elapsed = 0;
    t.mock.method(Date, 'now', () => wall);
    t.mock.method(monotonicClock, 'now', () => elapsed);
    const locks = new RecordLocks();
    assert.equal(locks.view('Tasks', 1, 'ann', 'Ann'), true);
    locks.view('Tasks', 1, 'bob', 'Bob');
    assert.equal(locks.viewers()[0].expires, wall + VIEW_TTL_MS);
    wall += jump;
    elapsed += VIEW_TTL_MS / 2;
    assert.equal(locks.viewers().length, 2, 'presence survives the wall jump');
    assert.equal(locks.view('Tasks', 1, 'ann', 'Ann'), false, 'renewal does not announce a fresh viewer');
    elapsed += VIEW_TTL_MS - 1;
    assert.deepEqual(locks.viewers().map((v) => v.account), ['Ann']);
    elapsed++;
    assert.deepEqual(locks.viewers(), [], 'renewed presence expires at its elapsed deadline');
    assert.equal(locks.view('Tasks', 1, 'ann', 'Ann'), true);
    assert.equal(locks.holder('Tasks', 1), undefined, 'presence never takes a write lock');
  });
}

test('shared leases keep epoch timestamps, including inherited othersIn filtering', (t) => {
  let wall = EPOCH;
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(monotonicClock, 'now', () => 0);
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const a = new SharedRecordLocks(db, 'Tasks');
  const b = new SharedRecordLocks(db, 'tasks');
  assert.equal(a.acquire('Tasks', 1, 'ann', 'Ann').lock.expires, EPOCH + LOCK_TTL_MS);
  a.view('Tasks', 1, 'ann', 'Ann');
  assert.equal(b.othersIn('Tasks', 'bob').length, 1);
  wall += LOCK_TTL_MS;
  assert.deepEqual(b.othersIn('Tasks', 'bob'), [], 'inherited filtering uses the shared clock domain');
  assert.deepEqual(b.viewers(), []);
});
