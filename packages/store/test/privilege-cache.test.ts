// A "limited" record-access rule is a calculation evaluated per record, so
// finding the records an account may see scans the whole table. That result is
// cached per table+account+rule and reused until a write changes the data —
// which is the only safe way to cache it: a write that could change which
// records match must drop the cached set, or the cache would show a record the
// write has hidden. These tests pin down both halves: the cache saves the scan
// when nothing changed, and never outlives a change that matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { importFmp12, Store } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const LAYOUT = 'Congress';
const TABLE = 'Congress';

/** A store with an account whose view rule allows only records named "ok". */
function withLimited(dir: string): { store: Store; path: string } {
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  store.truncate(LAYOUT); // start from a known, empty table
  store.savePrivilegeSet({
    name: 'Limited',
    records: { view: 'Name = "ok"', edit: true, create: true, delete: true },
    layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable',
    extendedPrivileges: ['fmrest'],
  });
  store.setPassword('clerk', 'pw', 'Limited');
  return { store, path };
}

test('a limited view set is scanned once, then served from cache until a write', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-privcache-'));
  const { store } = withLimited(dir);
  try {
    const pv = store.privileges('clerk');
    const ids = () => store.viewableIds(TABLE, pv)!;

    for (let i = 0; i < 3; i++) store.create(LAYOUT, { Name: 'ok' });
    for (let i = 0; i < 2; i++) store.create(LAYOUT, { Name: 'no' });

    store.allowedScans = 0;
    const first = ids();
    assert.equal(first.length, 3, 'only the three "ok" records are viewable');
    assert.equal(store.allowedScans, 1, 'the first lookup scans');

    // Repeated lookups with no write in between reuse the cached set.
    for (let i = 0; i < 5; i++) assert.deepEqual(ids(), first);
    assert.equal(store.allowedScans, 1, 'no further scans while nothing changed');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('the cached set never outlives a write that changes which records match', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-privcache-write-'));
  const { store } = withLimited(dir);
  try {
    const pv = store.privileges('clerk');
    const ids = () => new Set(store.viewableIds(TABLE, pv)!);

    const a = store.create(LAYOUT, { Name: 'ok' }).recordId;
    const b = store.create(LAYOUT, { Name: 'ok' }).recordId;
    assert.deepEqual(ids(), new Set([a, b]));

    // A new matching record appears on the next lookup.
    const c = store.create(LAYOUT, { Name: 'ok' }).recordId;
    assert.deepEqual(ids(), new Set([a, b, c]), 'a newly matching record is included');

    // Editing a record out of the rule hides it at once — the no-leak case.
    store.update(LAYOUT, b, { Name: 'no' });
    assert.deepEqual(ids(), new Set([a, c]), 'a record edited out of the rule is no longer viewable');

    // Editing one into the rule reveals it.
    const d = store.create(LAYOUT, { Name: 'no' }).recordId;
    assert.deepEqual(ids(), new Set([a, c]));
    store.update(LAYOUT, d, { Name: 'ok' });
    assert.deepEqual(ids(), new Set([a, c, d]), 'a record edited into the rule becomes viewable');

    // Deleting a matching record drops it.
    store.delete(LAYOUT, a);
    assert.deepEqual(ids(), new Set([c, d]), 'a deleted record is gone');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a write finds and counts honour the limited view through the cache', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-privcache-find-'));
  const { store } = withLimited(dir);
  try {
    const pv = store.privileges('clerk');
    for (let i = 0; i < 4; i++) store.create(LAYOUT, { Name: 'ok' });
    for (let i = 0; i < 6; i++) store.create(LAYOUT, { Name: 'no' });

    // find uses the same cached id set (viewFilter); the found count is the rule's.
    const found = store.find(LAYOUT, { limit: 0, privileges: pv });
    assert.equal(found.foundCount, 4, 'the found set is limited to matching records');

    store.create(LAYOUT, { Name: 'ok' });
    assert.equal(store.find(LAYOUT, { limit: 0, privileges: pv }).foundCount, 5, 'the new matching record is counted');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a change from another connection invalidates the cache within a second', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-privcache-conn-'));
  const { store, path } = withLimited(dir);
  const other = new Store(path);
  try {
    const pv = store.privileges('clerk');
    const ids = () => new Set(store.viewableIds(TABLE, pv)!);

    const a = store.create(LAYOUT, { Name: 'ok' }).recordId;
    assert.deepEqual(ids(), new Set([a]));

    // Another connection adds a matching record; data_version advances, so the
    // next lookup here re-scans rather than trusting the stale set.
    const b = other.create(LAYOUT, { Name: 'ok' }).recordId;
    await sleep(50);
    assert.deepEqual(ids(), new Set([a, b]), 'the other connection\'s record shows up');
  } finally {
    store.close();
    other.close();
    rmSync(dir, { recursive: true });
  }
});

test('a schema change drops the cache', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-privcache-schema-'));
  const { store } = withLimited(dir);
  try {
    const pv = store.privileges('clerk');
    store.create(LAYOUT, { Name: 'ok' });
    store.allowedScans = 0;
    store.viewableIds(TABLE, pv);
    assert.equal(store.allowedScans, 1);
    store.viewableIds(TABLE, pv);
    assert.equal(store.allowedScans, 1, 'cached');

    // Any design change clears every derived cache, this one included.
    store.applyDesign([{ op: 'createField', table: TABLE, name: 'Note', type: 'text' }]);
    store.viewableIds(TABLE, pv);
    assert.equal(store.allowedScans, 2, 're-scanned after the schema changed');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('on a big table the cached lookup is far cheaper than the scan', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-privcache-bench-'));
  const { store } = withLimited(dir);
  try {
    const pv = store.privileges('clerk');
    const N = 20_000;
    for (let i = 0; i < N; i++) store.create(LAYOUT, { Name: i % 2 ? 'ok' : 'no' });

    store.allowedScans = 0;
    let t = process.hrtime.bigint();
    const cold = store.viewableIds(TABLE, pv)!;
    const coldMs = Number(process.hrtime.bigint() - t) / 1e6;
    assert.equal(store.allowedScans, 1, 'the cold lookup scans the whole table');
    assert.equal(cold.length, N / 2, 'half the records match the rule');

    t = process.hrtime.bigint();
    let warm: number[] = [];
    for (let i = 0; i < 20; i++) warm = store.viewableIds(TABLE, pv)!;
    const warmMs = Number(process.hrtime.bigint() - t) / 1e6 / 20;
    assert.equal(store.allowedScans, 1, 'warm lookups do not scan again');
    assert.deepEqual(warm, cold, 'the cached result is identical to the scanned one');

    // The cache removes the per-record calc pass; a warm lookup only copies the
    // id array. Generous assertion so CI stays stable: warm must beat cold.
    console.log(`  privilege-cache bench: ${N} records, cold ${coldMs.toFixed(1)}ms, warm ${warmMs.toFixed(3)}ms (${(coldMs / Math.max(warmMs, 1e-6)).toFixed(0)}x)`);
    assert.ok(warmMs < coldMs, `a warm lookup (${warmMs.toFixed(3)}ms) should beat the cold scan (${coldMs.toFixed(1)}ms)`);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a clock- or random-based rule is never cached, so it cannot go stale', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-privcache-volatile-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  try {
    store.truncate(LAYOUT);
    // Always-true, but written with a volatile function: the result does not
    // depend on the data, so no write would ever mark a cached set dirty.
    store.savePrivilegeSet({
      name: 'Clocked',
      records: { view: 'Get ( CurrentTimeStamp ) > 0', edit: false, create: true, delete: false },
      layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmrest'],
    });
    store.setPassword('clerk', 'pw', 'Clocked');
    const pv = store.privileges('clerk');

    store.create(LAYOUT, { Name: 'a' });
    store.allowedScans = 0;
    store.viewableIds(TABLE, pv);
    store.viewableIds(TABLE, pv);
    store.viewableIds(TABLE, pv);
    assert.equal(store.allowedScans, 3, 'a volatile rule is evaluated every time, not cached');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
