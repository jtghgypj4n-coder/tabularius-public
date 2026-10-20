// The record audit log is a hash chain: an entry changed, removed or slipped in behind its back is found, and pruning
// by retention leaves a recorded anchor rather than a silent gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, verifyRecordAudit } from '../src/index.ts';
import { pruneRecordEntries } from '../src/record-chain.ts';

function withStore(fn: (store: Store, path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  const path = join(dir, 'Charts.sqlite');
  createStore(path);
  const store = new Store(path);
  store.applyDesign([{ op: 'createTable', name: 'Congress', fields: [{ name: 'Name', type: 'text' }, { name: 'State', type: 'text' }] }]);
  try { fn(store, path); } finally { try { store.close(); } catch { /* closed by the test */ } rmSync(dir, { recursive: true }); }
}

/** Changes the file behind the store's back, as someone with the file could. */
function tamper(path: string, statement: string) {
  const sql = new DatabaseSync(path);
  sql.exec('PRAGMA busy_timeout = 5000');
  sql.exec(statement);
  sql.close();
}

function history(store: Store) {
  const a = store.create('Congress', { Name: 'Ann', State: 'Oregon' }, { account: 'Ann' }).recordId;
  store.update('Congress', a, { State: 'Utah' }, undefined, { account: 'Bob' });
  store.update('Congress', a, { State: 'Nevada' }, undefined, { account: 'Bob' });
  store.delete('Congress', a, { account: 'Cy' });
  return store.auditLog({ table: 'Congress', recordId: a });
}

test('an untouched log verifies, entry by entry', () => {
  withStore((store) => {
    const log = history(store);
    const v = store.verifyRecordAudit();
    assert.equal(v.status, 'consistent');
    assert.equal(v.checked, log.length);
    assert.equal(v.head?.auditSeq, log.at(-1)!.seq);
    assert.equal(v.head?.hash.length, 64);
  });
});

test('an edited entry, a removed middle entry, a slipped-in entry and a cut tail are all found', () => {
  withStore((store, path) => {
    const log = history(store);
    const [, b, c] = log;
    // An entry whose values were rewritten.
    tamper(path, `UPDATE _fm_audit SET account = 'Mallory' WHERE seq = ${b.seq}`);
    let v = verifyRecordAudit(path);
    assert.deepEqual([v.status, v.firstBrokenSeq, v.reason], ['broken', b.seq, 'the entry was changed']);
    tamper(path, `UPDATE _fm_audit SET account = 'Bob' WHERE seq = ${b.seq}`);
    assert.equal(verifyRecordAudit(path).status, 'consistent');
    // An entry removed from the middle.
    tamper(path, `DELETE FROM _fm_audit WHERE seq = ${b.seq}`);
    v = verifyRecordAudit(path);
    assert.deepEqual([v.status, v.firstBrokenSeq, v.reason], ['broken', c.seq, 'an entry is missing or out of order']);
  });
  withStore((store, path) => {
    const log = history(store);
    // An entry written without linking it.
    tamper(path, `INSERT INTO _fm_audit (at, account, kind, tbl, record_id, changes, security, agent) VALUES ('2026-01-01T00:00:00Z', 'Mallory', 'delete', 'Congress', 1, '{}', 0, 0)`);
    let v = verifyRecordAudit(path);
    assert.equal(v.status, 'broken');
    assert.equal(v.reason, 'a record change entry is not part of the chain');
    tamper(path, `DELETE FROM _fm_audit WHERE account = 'Mallory'`);
    assert.equal(verifyRecordAudit(path).status, 'consistent');
    // The newest entries cut off.
    tamper(path, `DELETE FROM _fm_audit WHERE seq = ${log.at(-1)!.seq}`);
    v = verifyRecordAudit(path);
    assert.deepEqual([v.status, v.reason], ['broken', 'the newest entries are missing (possible truncation)']);
  });
});

test('entries from before the chain are a baseline it does not cover; new ones are chained', () => {
  withStore((store, path) => {
    store.create('Congress', { Name: 'Old', State: 'Ohio' }, { account: 'Ann' });
    store.close();
    // As a file from an earlier version: no chain yet.
    tamper(path, `DROP TABLE _fm_record_chain_state; DROP INDEX _fm_record_audit_chain; UPDATE _fm_audit SET rchain_seq = NULL, rprev_hash = NULL, rhash = NULL`);
    assert.equal(verifyRecordAudit(path).status, 'unprotected');
    const again = new Store(path);
    try {
      again.create('Congress', { Name: 'New', State: 'Iowa' }, { account: 'Ann' });
      const v = again.verifyRecordAudit();
      assert.equal(v.status, 'consistent');
      assert.equal(v.checked, 1);
      assert.ok(v.legacyThroughSeq! >= 1);
    } finally { again.close(); }
  });
});

test('retention removes old entries, records that it did, and the rest still verifies', () => {
  withStore((store) => {
    const log = history(store);
    store.setAuditSettings({ retentionDays: 30 });
    assert.equal(store.pruneAudit(), 0, 'nothing is 30 days old yet');
    assert.equal(store.verifyRecordAudit().status, 'consistent');
    // Entries made after a prune are chained onto what is left.
    const sql = (store as unknown as { sql: DatabaseSync }).sql;
    assert.equal(pruneRecordEntries(sql, log[1].seq), 2);
    const kept = store.auditLog({ table: 'Congress' });
    assert.deepEqual(kept.map((e) => e.kind), ['update', 'delete']);
    let v = store.verifyRecordAudit();
    assert.equal(v.status, 'consistent');
    assert.equal(v.checked, 2);
    assert.equal(v.pruned?.throughSeq, log[1].seq);
    store.create('Congress', { Name: 'Later', State: 'Iowa' }, { account: 'Ann' });
    v = store.verifyRecordAudit();
    assert.deepEqual([v.status, v.checked], ['consistent', 3]);
  });
});

test('the retention job logs itself in the security events, and so does a change of settings', () => {
  withStore((store) => {
    history(store);
    store.setAuditSettings({ retentionDays: 7 });
    // Ten days on, every entry is past the retention.
    assert.equal(store.pruneAudit(undefined, Date.now() + 10 * 86_400_000), 4);
    assert.equal(store.auditLog({ table: 'Congress' }).length, 0);
    assert.equal(store.verifyRecordAudit().status, 'consistent');
    const events = store.securityEvents({ category: 'Audit log' });
    assert.deepEqual(events.map((e) => e.kind), ['audit-settings-changed', 'audit-pruned']);
    assert.match(events[0].description, /entries kept 7 days/);
    assert.match(events[1].description, /4 audit entries/);
    assert.throws(() => store.setAuditSettings({ retentionDays: -1 }), /whole number of days/);
  });
});
