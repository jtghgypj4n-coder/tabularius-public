import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';
import { armCrashPointForTest } from '../../store/src/crash-point.ts';
import { commandStubEnv } from '../../../scripts/test-command-stubs.ts';
import { COMPACTION_EVERY_MS, COMPACTION_START_DELAY_MS, COMPACTION_WAL_BYTES, compactStore, compactionDue, fileBytes, timedCompactionTick } from '../src/compaction.ts';

function seed(path: string, count = 40_000): void {
  createStore(path);
  const store = new Store(path, 'A');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
    store.sql.exec('CREATE INDEX compact_items_name ON Items(Name)');
    for (let n = 0; n < count; n++) store.create('Items', { Name: `row-${n}-${'x'.repeat(200)}` });
    for (let n = 1; n <= count / 2; n++) store.delete('Items', n);
  } finally { store.close(); }
}

function check(path: string, count = 20_000): void {
  const db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    assert.equal(db.prepare('SELECT count(*) AS n FROM Items').get()!.n, count);
  } finally { db.close(); }
}

if (process.argv[2] === 'compaction-child') {
  armCrashPointForTest(process.argv[4]);
  compactStore(process.argv[3], Number.MAX_SAFE_INTEGER);
  throw new Error('crash point not reached');
} else {
  test('one pass converts, shrinks, checkpoints and preserves 20000 of 40000 generated rows', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'A.openhbam.sqlite');
    seed(path);
    const first = compactStore(path, Number.MAX_SAFE_INTEGER);
    assert.equal(first.convertedToIncremental, true);
    assert.ok(first.afterBytes < first.beforeBytes, JSON.stringify(first));
    assert.equal(first.walAfterBytes, 0);
    check(path);
    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare('PRAGMA auto_vacuum').get()!.auto_vacuum, 2);
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_stat1'").get());
    } finally { db.close(); }
    assert.equal(compactStore(path, Number.MAX_SAFE_INTEGER).convertedToIncremental, false);
    check(path);
  });

  test('a file not yet in incremental vacuum mode is rewritten only when asked to convert', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-noconvert-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'A.openhbam.sqlite');
    seed(path);
    const timer = compactStore(path, Number.MAX_SAFE_INTEGER, 5000, false);
    assert.equal(timer.convertedToIncremental, false);
    assert.equal(timer.walAfterBytes, 0);
    assert.equal(timer.afterBytes, timer.beforeBytes, 'no rewrite, so no shrinking');
    const db = new DatabaseSync(path);
    try { assert.equal(db.prepare('PRAGMA auto_vacuum').get()!.auto_vacuum, 0); } finally { db.close(); }
    check(path);
    assert.equal(compactStore(path, Number.MAX_SAFE_INTEGER).convertedToIncremental, true);
    check(path);
  });

  test('space guard refuses before any write, including unreadable free space', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-space-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'A.openhbam.sqlite');
    seed(path, 20);
    const before = readFileSync(path);
    const wal = fileBytes(path + '-wal');
    const required = 2 * (statSync(path).size + wal);
    assert.throws(() => compactStore(path, required - 1), new RegExp(`needs ${required} bytes free; ${required - 1} bytes available`));
    assert.throws(() => compactStore(path, undefined), /available space could not be read/);
    assert.deepEqual(readFileSync(path), before);
    assert.equal(fileBytes(path + '-wal'), wal);
  });

  test('due on first pass, day boundary or WAL trigger, including clock edits', () => {
    assert.equal(compactionDue(0, undefined), true);
    assert.equal(compactionDue(COMPACTION_EVERY_MS - 1, 0), false);
    assert.equal(compactionDue(COMPACTION_EVERY_MS, 0), true);
    assert.equal(compactionDue(0, 1), false);
    assert.equal(compactionDue(0, 1, COMPACTION_EVERY_MS, COMPACTION_WAL_BYTES), true);
    assert.equal(compactionDue(0, 1, COMPACTION_EVERY_MS, COMPACTION_WAL_BYTES - 1), false);
    assert.equal(compactionDue(49, 0, 50), false);
    assert.equal(compactionDue(50, 0, 50), true);
  });

  test('the timer does nothing until the start delay has passed, and then ticks', () => {
    let ticks = 0;
    const tick = () => { ticks++; };
    assert.equal(timedCompactionTick(tick, 1000 + COMPACTION_START_DELAY_MS, 1000), false);
    assert.equal(timedCompactionTick(tick, 1000 + COMPACTION_START_DELAY_MS, 1000 + COMPACTION_START_DELAY_MS - 1), false);
    assert.equal(ticks, 0);
    assert.equal(timedCompactionTick(tick, 1000 + COMPACTION_START_DELAY_MS, 1000 + COMPACTION_START_DELAY_MS), true);
    assert.equal(ticks, 1);
  });

  test('each crash boundary reopens with intact generated rows', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-crashes-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const source = join(dir, 'source.openhbam.sqlite');
    seed(source, 40);
    const env = commandStubEnv(t);
    const points = ['after-space-check', 'after-writer-wait', 'before-initial-vacuum', 'after-initial-vacuum', 'after-incremental-vacuum', 'after-statistics', 'after-checkpoint'];
    for (const [n, point] of points.entries()) {
      const path = join(dir, `${n}.openhbam.sqlite`);
      copyFileSync(source, path);
      const result = spawnSync(process.execPath, ['--no-warnings', import.meta.filename, 'compaction-child', path, `compaction:${point}`], { env, encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.status, 73, `${point}: ${result.stderr || result.error}`);
      check(path, 20);
    }
  });

  test('another writer causes a short busy refusal and leaves the file intact', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-writer-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'A.openhbam.sqlite');
    seed(path, 20);
    const writer = new DatabaseSync(path);
    try {
      writer.exec('BEGIN IMMEDIATE');
      assert.throws(() => compactStore(path, Number.MAX_SAFE_INTEGER, 50), /could not get a writer within 50 ms; retry later/);
      writer.exec('ROLLBACK');
      check(path, 10);
    } finally { writer.close(); }
  });

  test('an old reader causes a clear retry-later WAL checkpoint refusal', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-reader-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'A.openhbam.sqlite');
    seed(path, 20);
    compactStore(path, Number.MAX_SAFE_INTEGER);
    const reader = new DatabaseSync(path);
    const writer = new DatabaseSync(path);
    try {
      reader.exec('BEGIN');
      reader.prepare('SELECT count(*) FROM Items').get();
      writer.exec("INSERT INTO Items (Name) VALUES ('after-reader')");
      assert.throws(() => compactStore(path, Number.MAX_SAFE_INTEGER, 50), /could not truncate the WAL because a reader is active; retry later/);
      reader.exec('ROLLBACK');
      check(path, 11);
    } finally { writer.close(); reader.close(); }
  });

  test('a hosted connection and a prepared statement keep working after a separate pass', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-live-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'A.openhbam.sqlite');
    seed(path, 40);
    const live = new Store(path, 'A');
    try {
      const count = live.sql.prepare('SELECT count(*) AS n FROM Items');
      assert.equal(count.get()!.n, 20);
      assert.equal(live.find('Items').records.length, 20);
      compactStore(path, Number.MAX_SAFE_INTEGER);
      assert.equal(count.get()!.n, 20);
      live.create('Items', { Name: 'after' });
      assert.equal(count.get()!.n, 21);
      assert.equal(live.find('Items').records.length, 21);
    } finally { live.close(); }
  });
}
