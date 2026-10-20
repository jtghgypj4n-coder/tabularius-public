// Regressions found reviewing shared results and read-your-writes: a request
// waits for another process's claim at most half the time it has left; claims
// are short and renewed, so a dead holder blocks nobody for long; a change's
// summary update reads the record in the same transaction as the write; an
// account's own change is seen in every process; a calculation that uses a
// value standing in is shown as updating too.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, watchEventLoop } from '../../store/src/index.ts';
import { timeLeft } from '../../store/src/errors.ts';
import { ResultCache } from '../../store/src/results.ts';
import { writer } from '../../store/src/activity.ts';

let dir: string;
let path: string;
const ROWS = 2000;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-shared-review-'));
  path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }, { name: 'Total', type: 'number' }] },
    { op: 'createField', table: 'Orders', name: 'Net', type: 'number', kind: 'calculation', calculation: 'Total * 2', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'sNet', kind: 'summary', summary: { type: 'total', field: 'Net' } },
    { op: 'createCustomFunction', name: 'Twice', parameters: ['x'], formula: 'x * 2' },
    { op: 'createField', table: 'Orders', name: 'Net2', type: 'number', kind: 'calculation', calculation: 'Twice ( Total )', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'sNet2', kind: 'summary', summary: { type: 'total', field: 'Net2' } },
    { op: 'createField', table: 'Orders', name: 'Sql', type: 'number', kind: 'calculation', calculation: 'ExecuteSQL ( "SELECT SUM ( Total ) FROM Orders" ; "" ; "" )', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'Uses', type: 'number', kind: 'calculation', calculation: 'Sql + 1', options: { unstored: true } },
  ] as never);
  store.close();
  const sql = new DatabaseSync(path);
  sql.exec('BEGIN');
  for (let i = 1; i <= ROWS; i++) sql.prepare('INSERT INTO Orders (Id, Total) VALUES (?, ?)').run(i, i % 10);
  sql.exec('COMMIT');
  sql.close();
});
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function open(): Store {
  const s = new Store(path, 'Shop');
  s.shareResults();
  return s;
}

const first = (s: Store) => s.find('Orders', { limit: 1, layoutOnly: true }).records[0];
const sum = (s: Store) => {
  let t = 0;
  for (const r of s.find('Orders', { limit: ROWS }).records) t += Number(r.fieldData.Total) * 2;
  return t;
};

test('claims are short (renewed while worked on), so a holder that died blocks others only briefly', () => {
  const s = open();
  const claim = ResultCache.prototype.claim;
  const asked: number[] = [];
  ResultCache.prototype.claim = function (key: string, ms: number) {
    asked.push(ms);
    return claim.call(this, key, ms);
  };
  try {
    s.update('Orders', s.find('Orders', { limit: 1 }).records[0].recordId, { Total: '5' });
    s.evaluate('Orders', 'Orders::sNet2', s.find('Orders', { limit: 1 }).records[0].recordId);
    assert.ok(asked.length);
    assert.ok(asked.every((ms) => ms <= 15_000), String(asked));
  } finally {
    ResultCache.prototype.claim = claim;
    s.close();
  }
});

test('a change brings the shared total up to date from the record as it is when written, not as the caller last read it', () => {
  const a = open();
  const b = open();
  try {
    first(a);
    const id = a.find('Orders', { limit: 1 }).records[0].recordId;
    const stale = (a as unknown as { sql: DatabaseSync }).sql.prepare('SELECT * FROM Orders WHERE _fm_record_id = ?').get(Number(id));
    // Another process changes it between that read and the delete.
    b.update('Orders', id, { Total: '9' });
    const priv = a as unknown as { changeOne(t: unknown, id: number, old: unknown, run: () => unknown): unknown; table(n: string): unknown; sql: DatabaseSync };
    first(a);
    priv.changeOne(a.schema.tables.find((t) => t.name === 'Orders'), Number(id), stale, () => priv.sql.prepare('DELETE FROM Orders WHERE _fm_record_id = ?').run(Number(id)));
    assert.equal(Number(first(a).fieldData.sNet), sum(a));
  } finally {
    a.close();
    b.close();
  }
});

test('an account sees its own change in every process of the server, not only the one that made it', () => {
  const a = open();
  const b = open();
  try {
    a.setPassword('Clerk', 'pw', a.privilegeSets().find((p) => p.id === 1)!.name);
    const asClerk = () => b.find('Orders', { limit: 1, layoutOnly: true, privileges: b.privileges('Clerk') }).records[0];
    asClerk();
    writer.run({ account: 'Clerk' }, () => a.update('Orders', a.find('Orders', { limit: 1 }).records[0].recordId, { Total: '2' }));
    const rec = asClerk();
    assert.equal(rec.updating, undefined, 'never a value from before its own change');
    assert.equal(Number(rec.fieldData.sNet2), sum(b));
  } finally {
    a.close();
    b.close();
  }
});

test('a calculation using a value that stands in is shown as updating too', () => {
  const a = open();
  const b = open();
  const c = open();
  try {
    first(a);
    writer.run({ account: 'someone else' }, () => b.update('Orders', b.find('Orders', { limit: 1 }).records[0].recordId, { Total: '1' }));
    // Another process and account: the last result stands in while the new one is worked out.
    const rec = first(c);
    assert.ok(rec.updating?.includes('Sql'), JSON.stringify(rec));
    assert.ok(rec.updating?.includes('Uses'), 'uses the value standing in');
  } finally {
    a.close();
    b.close();
    c.close();
  }
});

test('only a change to the data counts as a write, and a change with no account stays in its own process', () => {
  const a = open();
  const b = open();
  try {
    const id = Number(a.find('Orders', { limit: 1 }).records[0].recordId);
    a.notify('view', 'Orders', id, undefined, { account: 'Viewer' });
    a.notify('lock', 'Orders', id, undefined, { account: 'Viewer' });
    assert.equal(a.wroteRecently('Viewer'), false, 'looking at or locking a record is not a change');
    assert.equal(b.wroteRecently('Viewer'), false);
    a.update('Orders', id, { Total: '6' });
    assert.equal(a.wroteRecently(''), true);
    assert.equal(b.wroteRecently(''), false, 'not every accountless read on every process');
  } finally {
    a.close();
    b.close();
  }
});

// Last in the file: the time budget it turns on stays on for the rest of this process, and later tests that
// keep the thread busy for 2 s in all (a slower machine) would be stopped by it.
test('a summary another process claimed is waited for at most half the time the request has left, then worked out here', async () => {
  const a = open();
  const b = open();
  const other = new ResultCache(`${path}.results`);
  try {
    first(a);
    const id = a.find('Orders', { limit: 1 }).records[0].recordId;
    a.update('Orders', id, { Total: '4' });
    // Someone else claims every summary at the new version and never finishes.
    const token = b.dataStamp();
    const keys = new DatabaseSync(`${path}.results`).prepare("SELECT key FROM results WHERE key LIKE '%/sum/%'").all() as { key: string }[];
    assert.ok(keys.length);
    for (const { key } of keys) assert.equal(other.claim(`${key}@${token}`, 600_000), true);
    watchEventLoop(2000);
    const deadline = Date.now() + 5000;
    // Wait for the watchdog to show a stale budget, then for its next heartbeat
    // to restore a fresh budget. This keeps setup time out of the assertion.
    while (timeLeft() >= 1900 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    while (timeLeft() <= 1900 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.ok(timeLeft() > 1900, 'the event-loop budget heartbeat arrived');
    const t0 = performance.now();
    const v = Number(b.evaluate('Orders', 'Orders::sNet2', id).value);
    const ms = performance.now() - t0;
    assert.equal(v, sum(b));
    assert.ok(ms < 1900, `waited ${ms} ms of a 2 s budget`);
  } finally {
    other.close();
    a.close();
    b.close();
  }
});
