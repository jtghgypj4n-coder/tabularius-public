// The audit log records security and authentication events, not only record
// changes: sign-ins, lockouts, and every change to accounts, privilege sets,
// passwords, second factors, API tokens and schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, LOCKOUT, totpCode } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function open(name: string): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `tabularius-secaudit-${name}-`));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  return { store: new Store(join(dir, 'Charts.sqlite'), 'Charts'), dir };
}

test('account, password, privilege, token and 2FA changes are each logged as security events', { skip }, () => {
  const { store, dir } = open('mut');
  try {
    // Adding an account, then changing its password.
    store.setPassword('clerk', 'first-pw');
    store.setPassword('clerk', 'second-pw');
    // A privilege set, and assigning it.
    store.savePrivilegeSet({
      name: 'Clerks', records: { view: true, edit: true, create: true, delete: false },
      layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'],
    });
    store.setAccountPrivilegeSet('clerk', 'Clerks');
    // A second, unused set, then removed.
    store.savePrivilegeSet({
      name: 'Temp', records: { view: true, edit: false, create: false, delete: false },
      layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
    });
    store.deletePrivilegeSet('Temp');
    // A policy, an owed change, enable/disable, a token, a second factor.
    store.setPasswordPolicy({ minLength: 8 });
    store.setMustChangePassword('clerk', true);
    store.setMustChangePassword('clerk', false);
    store.setAccountActive('clerk', false);
    store.setAccountActive('clerk', true);
    const id = /ohbt_([0-9a-f]+)\./.exec(store.createApiToken('clerk', { label: 'reports' }))![1];
    store.revokeApiToken(id);
    const { secret } = store.enrollTotp('clerk');
    store.confirmTotp('clerk', totpCode(secret));
    store.disableTotp('clerk');
    store.deleteAccount('clerk');

    const sec = store.auditLog({ security: true, limit: 1000 });
    const kinds: string[] = sec.map((e) => e.kind);
    for (const want of [
      'account-added', 'password-changed', 'privilege-set-saved', 'privilege-set-assigned',
      'privilege-set-deleted', 'password-policy-changed', 'must-change-set', 'must-change-cleared',
      'account-disabled', 'account-enabled', 'api-token-issued', 'api-token-revoked',
      'two-factor-enrolled', 'two-factor-confirmed', 'two-factor-disabled', 'account-removed',
    ]) {
      assert.ok(kinds.includes(want), `expected a "${want}" event, got ${kinds.join(', ')}`);
    }
    // Every security row is flagged, carries its target, and has no record id.
    const added = sec.find((e) => e.kind === 'account-added')!;
    assert.equal(added.security, true);
    assert.equal(added.target, 'clerk');
    assert.equal(added.recordId, undefined);
    const assigned = sec.find((e) => e.kind === 'privilege-set-assigned')!;
    assert.deepEqual(assigned.changes, { privilegeSet: 'Clerks' });
    const policy = sec.find((e) => e.kind === 'password-policy-changed')!;
    assert.deepEqual(policy.changes, { minLength: 8 });
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('repeated wrong passwords from a place log one lockout event', { skip }, () => {
  const { store, dir } = open('lock');
  try {
    store.setPassword('clerk', 'right-pw');
    for (let i = 0; i < LOCKOUT.attempts; i++) assert.equal(store.verify('clerk', 'wrong', '10.0.0.5'), false);
    const locks = store.auditLog({ security: true, kind: 'locked-out', limit: 100 });
    assert.equal(locks.length, 1, 'exactly one lockout, at the moment the place first blocks');
    assert.equal(locks[0].from, '10.0.0.5');
    assert.equal(locks[0].account, 'clerk');
    // A plain wrong password (below the limit) is not itself a sign-in event:
    // only the session surfaces (auditSignIn) record interactive attempts.
    assert.equal(store.auditLog({ security: true, kind: 'sign-in-failed' }).length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('auditSignIn records interactive sign-in outcomes; record changes stay separate', { skip }, () => {
  const { store, dir } = open('signin');
  try {
    store.auditSignIn('Ann', '10.0.0.9', true);
    store.auditSignIn('Mallory', '10.0.0.9', false);
    store.auditSignIn('Ann', '10.0.0.9', true, 'two-factor');
    store.create('Congress', { Name: 'Rec' }, { account: 'Ann' });

    const signins = store.auditLog({ security: true, limit: 100 }).filter((e) => e.kind === 'sign-in' || e.kind === 'sign-in-failed');
    assert.deepEqual(signins.map((e) => [e.kind, e.account]), [
      ['sign-in', 'Ann'], ['sign-in-failed', 'Mallory'], ['sign-in', 'Ann'],
    ]);
    assert.equal(signins[0].from, '10.0.0.9');
    assert.deepEqual(signins[2].changes, { factor: 'two-factor' });

    // The record change is not a security event, and security=false filters to it.
    const data = store.auditLog({ security: false, limit: 100 });
    assert.ok(data.every((e) => !e.security));
    assert.ok(data.some((e) => e.kind === 'create' && e.table === 'Congress'));
    // Filtering by a security kind never returns record changes.
    assert.ok(store.auditLog({ kind: 'create' }).every((e) => !e.security));
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('schema changes are logged once per batch, summarised by op', { skip }, () => {
  const { store, dir } = open('schema');
  try {
    store.applyDesign([
      { op: 'createScript', name: 'Hello', text: 'Beep' },
      { op: 'createValueList', name: 'Colors', values: ['red', 'green'] },
    ], { account: 'Admin' });
    const sec = store.auditLog({ security: true, kind: 'schema-changed', limit: 10 });
    assert.equal(sec.length, 1);
    assert.equal(sec[0].account, 'Admin');
    assert.equal((sec[0].changes!.count as number) >= 2, true);
    assert.equal(typeof sec[0].changes!.ops, 'object');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
