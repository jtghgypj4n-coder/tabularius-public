// Failed sign-ins (and the lockouts they cause) may fill only part of the security audit (TABULARIUS_SIGN_IN_FAILURE_AUDIT_SHARE,
// 80% unless set), after the first 1,000 of them. Past that they are not written, so a flood of wrong passwords cannot bury
// real sign-ins and security changes; a lockout still locks, and nothing that is not a failure is held back.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, LOCKOUT, SIGN_IN_FAILURE_AUDIT_FLOOR, signInFailureAuditShare } from '../src/index.ts';
import { appendSecurityEvent } from '../src/security-chain.ts';

const NAME = 'TABULARIUS_SIGN_IN_FAILURE_AUDIT_SHARE';

function setup(t: TestContext, share?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-failure-share-'));
  const path = join(dir, 'Synthetic.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  store.failureAuditRecountMs = 0; // count again at every failure: no waiting in a test
  const saved = process.env[NAME];
  if (share === undefined) delete process.env[NAME]; else process.env[NAME] = share;
  t.after(() => {
    if (saved === undefined) delete process.env[NAME]; else process.env[NAME] = saved;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

const rows = (store: Store, kinds: string[]) => (store.sql.prepare(`SELECT COUNT(*) AS n FROM _fm_audit WHERE security = 1 AND kind IN (${kinds.map(() => '?').join(',')})`).get(...kinds) as { n: number }).n;
const failureRows = (store: Store) => rows(store, ['sign-in-failed', 'locked-out']);
const other = (store: Store, n: number) => { for (let i = 0; i < n; i++) appendSecurityEvent(store.sql, new Date().toISOString(), null, 'password-changed', null, 0); };

test('the share is 0.8 unless a number from 0 to 1 is set; anything else keeps the cap', (t) => {
  setup(t);
  assert.equal(signInFailureAuditShare(), 0.8);
  for (const [text, want] of [['0.5', 0.5], ['1', 1], ['0', 0], [' 0.25 ', 0.25], ['', 0.8], ['abc', 0.8], ['-0.1', 0.8], ['1.5', 0.8], ['NaN', 0.8], ['Infinity', 0.8]] as const) {
    process.env[NAME] = text;
    assert.equal(signInFailureAuditShare(), want, JSON.stringify(text));
  }
});

test('the first 1,000 failures are always written, then failures keep to their share of the audit', (t) => {
  const store = setup(t, '0.5');
  assert.equal(SIGN_IN_FAILURE_AUDIT_FLOOR, 1000);
  for (let i = 0; i < SIGN_IN_FAILURE_AUDIT_FLOOR; i++) store.auditSignIn(`name-${i}`, 'place', false);
  assert.equal(failureRows(store), 1000);
  // Past the floor, with failures at half the audit already, the next one is not written.
  const before = rows(store, ['sign-in-failed']);
  store.auditSignIn('one-more', 'place', false);
  assert.equal(rows(store, ['sign-in-failed']), before, 'a failure past the share is not written');
  // Everything else is still written.
  store.auditSignIn('Ann', 'place', true);
  assert.equal(rows(store, ['sign-in']), 1);
  // Real events make room again, one failure for each (share 0.5).
  other(store, 1200);
  let written = 0;
  for (let i = 0; i < 400; i++) { const b = failureRows(store); store.auditSignIn(`later-${i}`, 'place', false); written += failureRows(store) - b; }
  assert.ok(written > 0, 'failures are written again once the audit holds enough other rows');
  assert.ok(failureRows(store) <= 0.5 * (rows(store, ['sign-in', 'password-changed', 'sign-in-failed', 'locked-out']) + 1) + 1, 'and never more than the share');
  assert.equal(store.verifySecurityAudit().status, 'consistent', 'the chain has no gap');
});

test('with the default share a flood leaves at least a fifth of the audit for everything else', (t) => {
  const store = setup(t);
  other(store, 300);
  for (let i = 0; i < 3000; i++) store.auditSignIn(`flood-${i}`, 'place', false);
  const failures = failureRows(store), total = (store.sql.prepare('SELECT COUNT(*) AS n FROM _fm_audit WHERE security = 1').get() as { n: number }).n;
  assert.ok(failures < 3000, 'not every failure was written');
  assert.ok(failures >= SIGN_IN_FAILURE_AUDIT_FLOOR);
  assert.ok(failures / total <= 0.8 + 1e-9 || failures <= SIGN_IN_FAILURE_AUDIT_FLOOR, `${failures} of ${total}`);
});

test('a share of 1 writes every failure', (t) => {
  const store = setup(t, '1');
  other(store, 5);
  for (let i = 0; i < 1100; i++) store.auditSignIn(`name-${i}`, 'place', false);
  assert.equal(rows(store, ['sign-in-failed']), 1100);
});

test('a lockout still locks when its row is not written, and the cap counts lockout rows too', (t) => {
  const store = setup(t, '0');
  store.setPassword('Alice', 'correct', '[Full Access]');
  // The floor first: with a share of 0 only the first 1,000 failure rows are written, whatever kind they are.
  for (let i = 0; i < SIGN_IN_FAILURE_AUDIT_FLOOR - 1; i++) store.auditSignIn(`name-${i}`, 'place', false);
  const from = '198.51.100.8';
  for (let i = 0; i < LOCKOUT.attempts; i++) assert.equal(store.verify('Alice', 'wrong', from), false);
  assert.ok(store.lockedOut('Alice', from), 'the account is locked');
  assert.equal(store.verify('Alice', 'correct', from), false, 'and stays locked');
  assert.equal(failureRows(store), SIGN_IN_FAILURE_AUDIT_FLOOR, 'lockout rows count toward the cap');
  assert.equal(rows(store, ['locked-out']), 1, 'the one lockout row that fitted was written');
});
