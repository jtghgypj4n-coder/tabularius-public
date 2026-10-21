import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { anchorHead, checkAnchor, type AuditChain } from '../src/audit-anchor.ts';
import { ensureSecurityChain, appendSecurityEvent, verifySecurityAudit } from '../src/security-chain.ts';
import { ensureRecordChain, linkRecordEntry, pruneRecordEntries, verifyRecordAudit } from '../src/record-chain.ts';

const key = Buffer.alloc(32, 7);
function withLog(run: (sql: DatabaseSync, path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-anchor-')), path = join(dir, 'Test.sqlite');
  const sql = new DatabaseSync(path);
  try {
    sql.exec(`CREATE TABLE _fm_audit (seq INTEGER PRIMARY KEY, at TEXT, account TEXT, kind TEXT, tbl TEXT,
      record_id INTEGER, changes TEXT, security INTEGER, agent INTEGER, surface TEXT, script TEXT, copy_of INTEGER, revert_of INTEGER)`);
    run(sql, path);
  } finally { sql.close(); rmSync(dir, { recursive: true, force: true }); }
}
function append(sql: DatabaseSync, chain: AuditChain) {
  if (chain === 'security') appendSecurityEvent(sql, 'now', 'Member', 'sign-in', '{}', 0);
  else {
    const result = sql.prepare("INSERT INTO _fm_audit (at, kind, tbl, security) VALUES ('now', 'create', 'T', 0)").run();
    linkRecordEntry(sql, Number(result.lastInsertRowid));
  }
}

for (const chain of ['security', 'records'] as const) {
  const ensure = chain === 'security' ? ensureSecurityChain : ensureRecordChain;
  const verify = chain === 'security' ? verifySecurityAudit : verifyRecordAudit;
  test(`AR-store-security-06: ${chain}`, () => withLog((sql, path) => {
    assert.equal(anchorHead(path, chain, key), null);
    ensure(sql);
    append(sql, chain);
    const anchor = anchorHead(path, chain, key)!;
    assert.deepEqual(checkAnchor(path, anchor, key), { ok: true, status: 'matches' });
    sql.exec("UPDATE _fm_audit SET kind = 'changed'");
    assert.equal(verify(path).ok, false);
    assert.throws(() => anchorHead(path, chain, key), /verification failed/);
    assert.equal(checkAnchor(path, anchor, key).status, 'log-broken');
    sql.exec(`DELETE FROM ${chain === 'security' ? '_fm_security_chain_state' : '_fm_record_chain_state'}`);
    assert.throws(() => anchorHead(path, chain, key), /verification failed/);
  }));
  test(`AR-store-security-08: ${chain}`, () => withLog((sql, path) => {
    ensure(sql);
    assert.equal(verify(path).ok, true);
    const anchor = anchorHead(path, chain, key)!;
    assert.equal(anchor.chainSeq, '0');
    assert.deepEqual(checkAnchor(path, anchor, key), { ok: true, status: 'matches' });
    append(sql, chain);
    assert.deepEqual(checkAnchor(path, anchor, key), { ok: true, status: 'matches' });
    assert.equal(checkAnchor(path, { ...anchor, hash: '0'.repeat(64) }, key).status, 'bad-signature');
    withLog((other, otherPath) => {
      ensure(other);
      assert.equal(checkAnchor(otherPath, anchor, key).status, 'mismatch');
    });
    if (chain === 'records') {
      const head = anchorHead(path, chain, key)!;
      pruneRecordEntries(sql, 1);
      assert.equal(checkAnchor(path, anchor, key).status, 'older-than-log');
      assert.equal(checkAnchor(path, head, key).status, 'matches');
    }
  }));
}
