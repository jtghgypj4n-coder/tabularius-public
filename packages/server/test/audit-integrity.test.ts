import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, anchorHead, checkAnchor, verifySecurityAudit, verifyRecordAudit } from '../../store/src/index.ts';
import { restoreBackup } from '../src/backup.ts';

const key = Buffer.alloc(32, 7); // synthetic operator key

test('real restore retains revocations but rolls audit history back; an external anchor detects the loss', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-restore-'));
  const live = join(dir, 'live'); const backup = join(dir, 'backup');
  mkdirSync(live); mkdirSync(backup);
  const path = join(live, 'Test.openhbam.sqlite');
  try {
    createStore(path);
    let store = new Store(path);
    store.applyDesign([{ op: 'createTable', name: 'Records', fields: [{ name: 'Name', type: 'text' }] }]);
    store.setPassword('member', 'synthetic-password');
    store.create('Records', { Name: 'before' });
    store.close();
    copyFileSync(path, join(backup, 'Test.openhbam.sqlite'));
    store = new Store(path);
    store.setPassword('member', 'synthetic-new-password');
    store.create('Records', { Name: 'after' });
    store.close();
    const anchors = ['security', 'records'].map(chain => anchorHead(path, chain as 'security' | 'records', key)!);
    await restoreBackup(live, backup, 'Test');
    assert.equal(verifySecurityAudit(path).ok, true);
    assert.equal(verifyRecordAudit(path).ok, true);
    for (const anchor of anchors) assert.equal(checkAnchor(path, anchor, key).status, 'missing');
    store = new Store(path);
    try {
      assert.equal(store.verify('member', 'synthetic-password', 'local'), false, 'old password is not resurrected');
      assert.equal(store.verify('member', 'synthetic-new-password', 'local'), true, 'current password still works');
      assert.equal(store.auditLog({ kind: 'password-changed' }).length, 0, 'gap: the backup has no password-change event');
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('signed record anchors detect whole-file replacement and normal extension preserves both anchors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-replacement-'));
  const path = join(dir, 'Test.openhbam.sqlite');
  const other = join(dir, 'Other.openhbam.sqlite');
  try {
    for (const file of [path, other]) {
      createStore(file);
      const store = new Store(file);
      try {
        store.applyDesign([{ op: 'createTable', name: 'Records', fields: [{ name: 'Name', type: 'text' }] }]);
        store.create('Records', { Name: file === path ? 'original' : 'replacement' });
      } finally { store.close(); }
    }
    for (const chain of ['security', 'records'] as const) {
      const anchor = anchorHead(path, chain, key)!;
      const store = new Store(path);
      try { store.auditSignIn('later', 'local', true); store.create('Records', { Name: 'later' }); }
      finally { store.close(); }
      assert.equal(checkAnchor(path, anchor, key).ok, true);
      assert.equal(checkAnchor(other, anchor, key).ok, false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the exported anchor helper refuses to sign a chain that fails verification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-anchor-gap-'));
  const path = join(dir, 'Test.openhbam.sqlite');
  try {
    createStore(path); const store = new Store(path);
    store.auditSignIn('original', 'local', true);
    store.sql.exec("UPDATE _fm_audit SET account = 'edited'");
    store.close();
    assert.equal(verifySecurityAudit(path).ok, false);
    assert.throws(() => anchorHead(path, 'security', key), /audit chain verification failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
