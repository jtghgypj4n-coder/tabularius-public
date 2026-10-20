// A script that opens or changes a record locks it until it commits or
// reverts, as FileMaker does: another user editing it meanwhile gets 301, and
// a record someone else is editing can't be changed (301 at the step).
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, RecordLocks, SharedRecordLocks, LOCK_TTL_MS, monotonicClock, writer, type Change } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';

type Run = (text: string, owner?: string, options?: RunOptions) => Promise<string>;

function withStore(fn: (store: Store, run: Run, id: number, t: TestContext) => Promise<void>) {
  return async (t: TestContext) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-locks-'));
    createStore(join(dir, 'L.sqlite'));
    const store = new Store(join(dir, 'L.sqlite'), 'L');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Tasks', fields: [{ name: 'Title', type: 'text' }] }]);
      const info = store.layout('Tasks');
      const { recordId } = store.create(info, { Title: 'one' });
      let n = 0;
      await fn(store, async (text, owner = 'session-1', options = {}) => {
        const name = `Script ${++n}`;
        store.applyDesign([{ op: 'createScript', name, text }]);
        const r = await writer.run({ owner, account: 'Ann' }, () => runScript(store, name, { layout: 'Tasks', account: 'Ann', ...options }));
        return String(r.result);
      }, recordId, t);
    } finally {
      store.close();
      rmSync(dir, { recursive: true });
    }
  };
}

for (const bulk of [false, true]) {
  const edits = bulk ? 'Replace Field Contents [ With dialog: Off ; Tasks::Title ; "changed" ]' : [
    'Go to Record/Request/Page [ First ]', 'Loop', 'Set Field [ Tasks::Title ; "changed" ]',
    'Go to Record/Request/Page [ Next ; Exit after last: On ]', 'End Loop',
  ].join('\n');

  test(`A1: ${bulk ? 'Replace Field Contents' : 'Set Field loop'} commits all 1100 records`, withStore(async (store, run) => {
    store.sql.exec('BEGIN');
    for (let i = 1; i < 1100; i++) store.create('Tasks', { Title: 'one' });
    store.sql.exec('COMMIT');
    assert.equal(await run(`Open Transaction\n${edits}\nCommit Transaction\nExit Script [ Result: Get ( LastError ) ]`), '0');
    assert.equal(store.query('SELECT count(*) AS n FROM Tasks WHERE Title = \'changed\'')[0].n, 1100);
    assert.equal(store.locks.all().length, 0);
  }));

  for (const capture of [false, true]) {
    test(`A1: capacity failure rolls back ${bulk ? 'bulk edits' : 'a loop'}, capture ${capture}, automatic revert off`, withStore(async (store, run, _id, t) => {
      store.create('Tasks', { Title: 'one' });
      store.create('Tasks', { Title: 'one' });
      const db = new DatabaseSync(':memory:');
      t.after(() => db.close());
      store.locks = capture ? new SharedRecordLocks(db, 'L', 2) : new RecordLocks(2);
      const result = await run(`Set Error Capture [ ${capture ? 'On' : 'Off'} ]\nSet Revert Transaction on Error [ Off ]\nOpen Transaction\n${edits}\nCommit Transaction\nExit Script [ Result: Get ( LastError ) & "/" & Get ( TransactionOpenState ) ]`);
      assert.equal(result, '812/0');
      assert.deepEqual(store.query('SELECT Title FROM Tasks').map((r) => r.Title), ['one', 'one', 'one']);
      assert.equal(store.sql.isTransaction, false);
      assert.equal(store.locks.all().length, 0);
    }));
  }
}

for (const shared of [false, true]) {
  test(`A3: ${shared ? 'shared' : 'memory'} bulk step renews locks when the event loop cannot run timers`, withStore(async (store, run, first, t) => {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    if (shared) store.locks = new SharedRecordLocks(db, 'L');
    const peer = shared ? new SharedRecordLocks(db, 'L') : store.locks;
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t.mock.method(monotonicClock, 'now', () => Date.now()); // memory leases run on the elapsed clock
    for (let i = 1; i < 8; i++) store.create('Tasks', { Title: 'one' });
    const acquire = store.locks.acquire.bind(store.locks);
    t.mock.method(store.locks, 'acquire', (...args: Parameters<typeof acquire>) => {
      const result = acquire(...args);
      t.mock.timers.tick(10_000);
      assert.equal(peer.holder('Tasks', first)?.owner, 'session-1');
      return result;
    });
    assert.equal(await run('Open Transaction\nReplace Field Contents [ With dialog: Off ; Tasks::Title ; "changed" ]\nCommit Transaction\nExit Script [ Result: Get ( LastError ) ]', 'session-1', { timeoutMs: 300_000 }), '0');
    assert.equal(store.query('SELECT count(*) AS n FROM Tasks WHERE Title = \'changed\'')[0].n, 8);
    assert.equal(store.locks.all().length, 0);
  }));

  test(`A3: ${shared ? 'shared' : 'memory'} lost lease fails closed and never releases its replacement`, withStore(async (store, run, first, t) => {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    if (shared) store.locks = new SharedRecordLocks(db, 'L');
    const peer = shared ? new SharedRecordLocks(db, 'L') : store.locks;
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.now() });
    t.mock.method(monotonicClock, 'now', () => Date.now()); // memory leases run on the elapsed clock
    assert.equal(await run('Open Transaction\nSet Field [ Tasks::Title ; "changed" ]\nCommit Records/Requests\nCommit Transaction\nExit Script [ Result: Get ( LastError ) ]', 'session-1', {
      debug: (point) => {
        if (point.index !== 3) return;
        peer.releaseOwner('session-1');
        // A different session acquired it after explicit session cleanup.
        writer.run({ owner: 'other' }, () => peer.acquire('Tasks', first, 'other', 'Bob'));
        t.mock.timers.tick(LOCK_TTL_MS / 2 + 1);
      },
    }), '301');
    assert.equal(store.query('SELECT Title FROM Tasks')[0].Title, 'one');
    assert.equal(peer.holder('Tasks', first)?.owner, 'other');
    assert.equal(store.sql.isTransaction, false);
  }));

  test(`A3: ${shared ? 'shared' : 'memory'} transaction renews earlier and pre-existing locks across TTLs`, withStore(async (store, run, first, t) => {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    if (shared) store.locks = new SharedRecordLocks(db, 'L');
    const peer = shared ? new SharedRecordLocks(db, 'L') : store.locks;
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.now() });
    t.mock.method(monotonicClock, 'now', () => Date.now()); // memory leases run on the elapsed clock
    store.locks.acquire('Tasks', first, 'session-1', 'Ann');
    const second = store.create('Tasks', { Title: 'second' }).recordId;
    const result = await run('Open Transaction\nSet Field [ Tasks::Title ; "changed" ]\nGo to Record/Request/Page [ Last ]\nSet Field [ Tasks::Title ; "changed second" ]\nCommit Records/Requests\nSet Variable [ $wait ; 1 ]\nCommit Transaction\nExit Script [ Result: Get ( LastError ) ]', 'session-1', {
      debug: (point) => {
        if (point.index !== 5) return;
        // Simulate a long wait while the transaction is open, including multiple renewals.
        for (let n = 0; n < 5; n++) {
          t.mock.timers.tick(LOCK_TTL_MS / 2 + 1);
          for (const id of [first, second]) assert.equal(peer.acquire('Tasks', id, 'other', 'Bob').ok, false, `transaction lease ${id} must stay held`);
        }
      },
    });
    assert.equal(result, '0');
    assert.equal(store.locks.holder('Tasks', first)?.owner, 'session-1', 'pre-existing locks remain the session\'s responsibility');
    assert.equal(store.locks.holder('Tasks', second), undefined);
    t.mock.timers.tick(LOCK_TTL_MS + 1);
    assert.ok(peer.acquire('Tasks', first, 'other', 'Bob').ok, 'renewal stops when the transaction ends');
  }));
}

/** Lock and unlock changes on the file while `fn` runs, with who held each lock as it was taken. */
async function watchLocks(store: Store, fn: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const listen = (c: Change) => {
    if (c.kind === 'lock') seen.push(`lock by ${store.locks.holder(c.table, c.recordId!)?.owner}`);
    else if (c.kind === 'unlock' || c.kind === 'update') seen.push(c.kind);
  };
  store.listeners.add(listen);
  try {
    await fn();
  } finally {
    store.listeners.delete(listen);
  }
  return seen;
}

test('Set Field locks the record until the commit, then releases it', withStore(async (store, run, id) => {
  const seen = await watchLocks(store, () => run('Set Field [ Tasks::Title ; "two" ]\nCommit Records/Requests [ With dialog: Off ]'));
  assert.deepEqual(seen, ['lock by session-1', 'update', 'unlock']);
  assert.equal(store.locks.holder('Tasks', id), undefined);
}));

test('Revert Record/Request and a run with nothing to commit release the lock too', withStore(async (store, run, id) => {
  assert.deepEqual(await watchLocks(store, () => run('Set Field [ Tasks::Title ; "two" ]\nRevert Record/Request [ With dialog: Off ]')), ['lock by session-1', 'unlock']);
  assert.deepEqual(await watchLocks(store, () => run('Open Record/Request')), ['lock by session-1', 'unlock']);
  assert.equal(store.locks.holder('Tasks', id), undefined);
}));

test('a record someone else is editing gives 301 at the step, and stays theirs', withStore(async (store, run, id) => {
  store.locks.acquire('Tasks', id, 'session-2', 'Bob');
  assert.equal(await run('Set Error Capture [ On ]\nSet Field [ Tasks::Title ; "two" ]\nSet Variable [ $e ; Value: Get ( LastError ) ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: $e & "/" & Tasks::Title ]'), '301/one');
  assert.equal(await run('Set Error Capture [ On ]\nOpen Record/Request\nExit Script [ Text Result: Get ( LastError ) ]'), '301');
  // A run with no session (the command line) checks as well.
  assert.equal(await run('Set Error Capture [ On ]\nSet Field [ Tasks::Title ; "two" ]\nExit Script [ Text Result: Get ( LastError ) ]', ''), '301');
  assert.equal(store.locks.holder('Tasks', id)?.owner, 'session-2');
}));

test('a lock the session already held is left for the session to release', withStore(async (store, run, id) => {
  store.locks.acquire('Tasks', id, 'session-1', 'Ann');
  const seen = await watchLocks(store, () => run('Set Field [ Tasks::Title ; "two" ]\nCommit Records/Requests [ With dialog: Off ]'));
  assert.deepEqual(seen, ['update']);
  assert.equal(store.locks.holder('Tasks', id)?.owner, 'session-1');
}));

test('a caller throwing after lockForEdit releases the run lock without saving edits', withStore(async (store, run, id) => {
  await assert.rejects(run('Set Field [ Tasks::Title ; "lost" ]\nExit Script', 'session-1', {
    debug: (point) => { if (point.index === 1) throw new Error('caller failed'); },
  }), /caller failed/);
  assert.equal(store.locks.holder('Tasks', id), undefined);
  assert.equal(store.query('SELECT Title FROM Tasks')[0].Title, 'one');
  assert.ok(store.locks.acquire('Tasks', id, 'session-2', 'Bob').ok);
}));

for (const ending of ['commit', 'record error', 'caller throws', 'profile throws'] as const) {
  test(`transaction holds earlier record locks until ${ending}, then releases and commits or rolls back`, withStore(async (store, run, id) => {
    const second = store.create('Tasks', { Title: 'second' }).recordId;
    if (ending === 'record error') store.locks.acquire('Tasks', second, 'session-2', 'Bob');
    let held = false;
    const text = 'Set Error Capture [ On ]\nOpen Transaction\nSet Field [ Tasks::Title ; "changed" ]\nGo to Record/Request/Page [ Last ]\nSet Field [ Tasks::Title ; "changed second" ]\n' +
      (ending === 'profile throws' ? 'Exit Script\n' : '') + 'Commit Transaction\nExit Script [ Text Result: Get ( LastError ) ]';
    const running = run(text, 'session-1', {
      debug: (point) => {
        if (point.index !== 4) return;
        held = store.locks.holder('Tasks', id)?.owner === 'session-1';
        if (ending === 'caller throws') throw new Error('caller failed');
      },
      ...(ending === 'profile throws' ? { profile: { run: () => {}, step: () => {}, leave: () => { throw new Error('profile failed'); } } } : {}),
    });
    if (ending.endsWith('throws')) await assert.rejects(running, /(?:caller|profile) failed/);
    else assert.equal(await running, ending === 'record error' ? '301' : '0');
    assert.equal(store.sql.isTransaction, false, 'no SQLite write lock remains');
    assert.equal(store.undoable, false);
    assert.deepEqual(store.query('SELECT Title FROM Tasks ORDER BY _fm_record_id').map((r) => r.Title), ending === 'commit' ? ['changed', 'changed second'] : ['one', 'second']);
    assert.equal(store.locks.holder('Tasks', id), undefined);
    assert.equal(store.locks.holder('Tasks', second)?.owner, ending === 'record error' ? 'session-2' : undefined);
    assert.ok(held, 'moving to the next record must not release the earlier transaction lock');
  }));
}

test('two scripts holding opposite records fail promptly with 301 instead of deadlocking', { timeout: 5000 }, withStore(async (store, run, first) => {
  const second = store.create('Tasks', { Title: 'second' }).recordId;
  store.locks.acquire('Tasks', first, 'session-a', 'Ann');
  store.locks.acquire('Tasks', second, 'session-b', 'Bob');
  let arrived = 0;
  let release!: () => void;
  const both = new Promise<void>((resolve) => { release = resolve; });
  const debug: RunOptions['debug'] = async (point) => {
    if (point.index !== 2) return;
    if (++arrived === 2) release();
    await both;
  };
  const text = 'Set Error Capture [ On ]\nOpen Transaction\nSet Field [ Tasks::Title ; "blocked" ]\nCommit Transaction\nExit Script [ Text Result: Get ( LastError ) ]';
  assert.deepEqual(await Promise.all([
    run(text, 'session-a', { foundSet: [second], debug }),
    run(text, 'session-b', { foundSet: [first], debug }),
  ]), ['301', '301']);
  assert.equal(store.sql.isTransaction, false);
  assert.deepEqual(store.query('SELECT Title FROM Tasks ORDER BY _fm_record_id').map((r) => r.Title), ['one', 'second']);
  // Pre-existing session locks remain the sessions' responsibility.
  assert.equal(store.locks.releaseOwner('session-a').length, 1);
  assert.equal(store.locks.releaseOwner('session-b').length, 1);
}));
