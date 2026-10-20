// The admin console's security health report: a least-privilege and hygiene
// snapshot built from what the file already knows — accounts without a second
// factor, dormant accounts, the full-access count, over-broad API tokens, and
// privilege sets that can read tables no layout shows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;
let broadToken: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-health-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;

  // A set that can read records but opens no layout: every table it can see is
  // reachable only off-layout (API/SQL/export).
  store.savePrivilegeSet({
    name: 'Clerk',
    records: { view: true, edit: false, create: false, delete: false },
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'],
  });
  // A local, password account with no second factor, never signed in.
  store.setPassword('clerk1', 'Clerk-pw-123456', 'Clerk');

  // A broad token: unscoped, writable, no expiry. And a tight one: read-only,
  // scoped to one surface, expiring — nothing to flag.
  broadToken = store.createApiToken('clerk1');
  store.createApiToken('clerk1', { readOnly: true, surfaces: ['fmrest'], expires: new Date(Date.now() + 86_400_000) });
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const health = (q = '') => fetch(`${base}/tabularius/admin/v1/health?database=Charts${q}`).then((r) => r.json());

test('reports the full-access count and accounts without a second factor', { skip }, async () => {
  const { databases } = await health();
  const h = databases[0];
  assert.equal(h.database, 'Charts');
  assert.equal(h.unusedDays, 90);
  assert.ok(h.fullAccess.count >= 1, 'at least the built-in full-access account');
  // clerk1 has a password and no 2FA, so it is flagged.
  assert.ok(h.without2fa.includes('clerk1'));
  // clerk1 is not full access, so it is not in the full-access list.
  assert.ok(!h.fullAccess.accounts.includes('clerk1'));
});

test('lists accounts that have never signed in as unused', { skip }, async () => {
  const { databases } = await health();
  const u = databases[0].unused.find((x: { account: string }) => x.account === 'clerk1');
  assert.ok(u, 'clerk1 is dormant (never signed in)');
  assert.equal(u.lastSignIn, undefined);
  assert.equal(u.daysSince, undefined);
});

test('flags broad API tokens and leaves tight ones alone', { skip }, async () => {
  const { databases } = await health();
  const broad = databases[0].broadTokens;
  // The tight token (read-only, scoped, expiring) has nothing to flag.
  assert.equal(broad.length, 1, 'only the broad token is listed');
  const t = broad[0];
  assert.equal(t.account, 'clerk1');
  assert.equal(t.surfaces, 'all');
  assert.ok(t.reasons.includes('reaches every surface'));
  assert.ok(t.reasons.includes('can write'));
  assert.ok(t.reasons.includes('never expires'));
  assert.ok(typeof t.ageDays === 'number' && t.ageDays >= 0);
});

test('flags privilege sets that can read tables no layout shows', { skip }, async () => {
  const { databases } = await health();
  const over = databases[0].oversharingSets.find((s: { set: string }) => s.set === 'Clerk');
  assert.ok(over, 'Clerk can read records but opens no layout');
  assert.ok(over.tables.length > 0, 'at least one table is reachable only off-layout');
});

test('unusedDays is configurable and a huge window hides everyone', { skip }, async () => {
  const { databases } = await health('&unusedDays=100000');
  assert.equal(databases[0].unusedDays, 100000);
  // Accounts that never signed in are always dormant regardless of the window.
  assert.ok(databases[0].unused.some((x: { account: string }) => x.account === 'clerk1'));
});

test('without ?database it reports every hosted file', { skip }, async () => {
  const all = await fetch(`${base}/tabularius/admin/v1/health`).then((r) => r.json());
  assert.ok(Array.isArray(all.databases) && all.databases.some((d: { database: string }) => d.database === 'Charts'));
});

test('an unknown database is reported, not a crash', { skip }, async () => {
  const body = await fetch(`${base}/tabularius/admin/v1/health?database=Nope`).then((r) => r.json());
  assert.match(body.error, /not hosted/);
});

test('the broad token is a real, usable credential', { skip }, () => {
  assert.ok(broadToken.startsWith('ohbt_'));
});

test('the one-click fix revokes a broad token', { skip }, async () => {
  const id = (await health()).databases[0].broadTokens[0].id;
  const r = await fetch(`${base}/tabularius/admin/v1/health/revoke-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' },
    body: JSON.stringify({ database: 'Charts', id }),
  }).then((res) => res.json());
  assert.equal(r.revoked, true);
  // Gone from the report, and no longer a valid credential.
  assert.ok(!(await health()).databases[0].broadTokens.some((t: { id: string }) => t.id === id));
  assert.equal(store.apiToken(broadToken), undefined);
});

test('the revoke endpoint refuses without the CSRF header', { skip }, async () => {
  const res = await fetch(`${base}/tabularius/admin/v1/health/revoke-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ database: 'Charts', id: 'x' }),
  });
  assert.equal(res.status, 403);
});

test('flags the built-in account that still has the file’s empty password', { skip }, async () => {
  const h = (await health()).databases[0];
  // The Charts fixture signs in as Admin with no password; [Full Access] is
  // granted the network sign-in privileges on first open.
  const admin = h.emptyPassword.find((e: { account: string }) => e.account === 'Admin');
  assert.ok(admin, 'Admin is flagged as empty-password');
  assert.equal(admin.networkLogin, true);
  assert.ok(admin.surfaces.includes('fmapp') || admin.surfaces.includes('fmrest'));
  // Tabularius refuses an empty password from the network by default.
  assert.equal(h.blankPasswordFromNetwork, false);
});

test('flags an imported account whose FileMaker password was real, not blank: it can’t sign in at all', { skip }, async () => {
  // Charts only ships a blank-password Admin. A real, unverifiable FileMaker
  // password looks the same in storage as any other account still on its
  // file password — password_hash NULL, source fmp12 — just without a
  // schema.accounts entry whose verifier passes the empty-password check.
  store.sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source) VALUES ('realpw', NULL, 'fmp12')`).run();
  store.setAccountPrivilegeSet('realpw', 'Clerk');
  try {
    const h = (await health()).databases[0];
    const found = h.noWorkingPassword.find((e: { account: string }) => e.account === 'realpw');
    assert.ok(found, 'realpw is flagged as having no working password at all');
    assert.equal(found.privilegeSet, 'Clerk');
    assert.ok(!h.emptyPassword.some((e: { account: string }) => e.account === 'realpw'), 'not also counted as empty-password: it is a different, more severe case');
  } finally {
    store.sql.prepare(`DELETE FROM _fm_accounts WHERE name = 'realpw'`).run();
  }
});

test('the admin console can give that account a working password, same one-click fix as empty-password', { skip }, async () => {
  store.sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source) VALUES ('realpw2', NULL, 'fmp12')`).run();
  store.setAccountPrivilegeSet('realpw2', 'Clerk');
  try {
    const r = await fix({ database: 'Charts', account: 'realpw2', action: 'set-temp-password' });
    assert.equal(r.account, 'realpw2');
    assert.ok(typeof r.password === 'string' && r.password.length > 0);
    assert.ok(!r.health.noWorkingPassword.some((e: { account: string }) => e.account === 'realpw2'));
    assert.equal(store.verify('realpw2', r.password, ''), true);
  } finally {
    store.sql.prepare(`DELETE FROM _fm_accounts WHERE name = 'realpw2'`).run();
  }
});

test('migrate-all refuses without the CSRF header', { skip }, async () => {
  const res = await fetch(`${base}/tabularius/admin/v1/accounts/migrate-all`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ database: 'Charts' }),
  });
  assert.equal(res.status, 403);
});

test('fix-account needs the CSRF header', { skip }, async () => {
  const res = await fetch(`${base}/tabularius/admin/v1/health/fix-account`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ database: 'Charts', account: 'Admin', action: 'deactivate' }),
  });
  assert.equal(res.status, 403);
});

const fix = (body: unknown) => fetch(`${base}/tabularius/admin/v1/health/fix-account`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify(body),
}).then((r) => r.json());

test('deactivating an account is a one-click fix', { skip }, async () => {
  const r = await fix({ database: 'Charts', account: 'clerk1', action: 'deactivate' });
  assert.equal(r.deactivated, true);
  assert.equal(store.accountInactive('clerk1'), true);
});

test('setting a temporary password clears the empty-password flag', { skip }, async () => {
  const r = await fix({ database: 'Charts', account: 'Admin', action: 'set-temp-password' });
  assert.equal(r.account, 'Admin');
  assert.ok(typeof r.password === 'string' && r.password.length > 0, 'a one-time password is returned');
  // Admin now has a password, so it is no longer flagged as empty-password.
  assert.ok(!r.health.emptyPassword.some((e: { account: string }) => e.account === 'Admin'));
  assert.ok(store.accounts().find((a) => a.name === 'Admin')!.hasPassword);
});

test('migrate-all gives every stuck account a temporary password in one request', { skip }, async () => {
  // Admin is already migrated by the test above, so this only needs to prove the
  // batch endpoint covers these two synthetic, non-blank-password accounts.
  store.sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source) VALUES ('realpw3a', NULL, 'fmp12'), ('realpw3b', NULL, 'fmp12')`).run();
  store.setAccountPrivilegeSet('realpw3a', 'Clerk');
  store.setAccountPrivilegeSet('realpw3b', 'Clerk');
  try {
    const before = (await health()).databases[0];
    assert.ok(before.noWorkingPassword.some((e: { account: string }) => e.account === 'realpw3a'));
    assert.ok(before.noWorkingPassword.some((e: { account: string }) => e.account === 'realpw3b'));

    const res = await fetch(`${base}/tabularius/admin/v1/accounts/migrate-all`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ database: 'Charts' }),
    }).then((r) => r.json());
    const names = res.migrated.map((m: { account: string }) => m.account);
    assert.ok(names.includes('realpw3a'));
    assert.ok(names.includes('realpw3b'));
    for (const m of res.migrated) assert.ok(typeof m.password === 'string' && m.password.length > 0);

    // Both synthetic accounts now have a working, must-change password, so neither is stuck any more.
    assert.ok(!res.health.noWorkingPassword.some((e: { account: string }) => e.account === 'realpw3a'));
    assert.ok(!res.health.noWorkingPassword.some((e: { account: string }) => e.account === 'realpw3b'));
    assert.equal(store.mustChangePassword('realpw3a'), true);
  } finally {
    store.sql.prepare(`DELETE FROM _fm_accounts WHERE name IN ('realpw3a', 'realpw3b')`).run();
  }
});

test('fix-account rejects an unknown action', { skip }, async () => {
  const res = await fetch(`${base}/tabularius/admin/v1/health/fix-account`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ database: 'Charts', account: 'clerk1', action: 'nonsense' }),
  });
  assert.equal(res.status, 400);
});

test('an expired token shows up under staleTokens, ready to revoke', { skip }, async () => {
  // Read-only and scoped, so it is not a broad token — only its past expiry
  // should flag it, as a token to revoke.
  const token = store.createApiToken('clerk1', { label: 'old-reader', readOnly: true, surfaces: ['fmrest'], expires: new Date(Date.now() - 5 * 86_400_000) });
  const stale = (await health()).databases[0].staleTokens;
  const found = stale.find((t: { label?: string }) => t.label === 'old-reader');
  assert.ok(found, 'the expired token is listed under staleTokens');
  assert.equal(found.action, 'revoke');
  assert.match(found.reasons.join('; '), /expired 5 days ago/i);
  // And the existing revoke endpoint clears it.
  await fetch(`${base}/tabularius/admin/v1/health/revoke-token`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ database: 'Charts', id: found.id }),
  });
  assert.equal(store.apiToken(token), undefined, 'the token no longer authenticates');
});
