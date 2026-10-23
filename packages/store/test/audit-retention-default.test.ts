// Record audit entries are kept 400 days unless the file's audit settings say otherwise. 0 still keeps every entry, and a
// choice already saved (including 0) is never replaced by the default. The chain still verifies after a prune.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, AUDIT_RETENTION_DEFAULT_DAYS } from '../src/index.ts';

const DAY = 86_400_000;

function withStore(fn: (store: Store, path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-retention-'));
  const path = join(dir, 'Charts.sqlite');
  createStore(path);
  const store = new Store(path);
  store.applyDesign([{ op: 'createTable', name: 'Congress', fields: [{ name: 'Name', type: 'text' }] }]);
  try { fn(store, path); } finally { try { store.close(); } catch { /* closed by the test */ } rmSync(dir, { recursive: true, force: true }); }
}

test('a file with no retention choice keeps record audit entries 400 days', () => {
  withStore((store) => {
    assert.equal(AUDIT_RETENTION_DEFAULT_DAYS, 400);
    assert.equal(store.auditSettings().retentionDays, 400);
    store.create('Congress', { Name: 'Ann' }, { account: 'Ann' });
    assert.equal(store.pruneAudit(undefined, Date.now() + 399 * DAY), 0, '399 days on: kept');
    assert.equal(store.auditLog({ table: 'Congress' }).length, 1);
    assert.equal(store.pruneAudit(undefined, Date.now() + 401 * DAY), 1, '401 days on: removed');
    assert.equal(store.auditLog({ table: 'Congress' }).length, 0);
    assert.equal(store.verifyRecordAudit().status, 'consistent', 'the chain records where it now starts');
    assert.equal(store.verifySecurityAudit().status, 'consistent', 'security events are not touched');
    assert.ok(store.securityEvents({ category: 'Audit log' }).some((e) => e.kind === 'audit-pruned'), 'the removal is logged');
  });
});

test('0 keeps every entry, and is still there after the file is reopened', () => {
  withStore((store, path) => {
    assert.equal(store.setAuditSettings({ retentionDays: 0 }).retentionDays, 0);
    store.create('Congress', { Name: 'Ann' }, { account: 'Ann' });
    assert.equal(store.pruneAudit(undefined, Date.now() + 5000 * DAY), 0);
    store.close();
    const again = new Store(path);
    try {
      assert.equal(again.auditSettings().retentionDays, 0, 'a saved 0 is a choice, not an absence');
      assert.equal(again.pruneAudit(undefined, Date.now() + 5000 * DAY), 0);
      assert.equal(again.auditLog({ table: 'Congress' }).length, 1);
    } finally { again.close(); }
  });
});

test('changing another audit setting does not turn the default into a different choice, and an explicit number wins', () => {
  withStore((store) => {
    assert.equal(store.setAuditSettings({ logReads: true }).retentionDays, 400);
    assert.equal(store.setAuditSettings({ retentionDays: 30 }).retentionDays, 30);
    assert.equal(store.setAuditSettings({ logReads: false }).retentionDays, 30);
    assert.match(store.securityEvents({ category: 'Audit log' }).map((e) => e.description).join('\n'), /entries kept 30 days/);
  });
});
