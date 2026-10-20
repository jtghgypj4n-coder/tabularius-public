// Token hygiene: securityHealth.staleTokens flags API tokens that are dead,
// forgotten, or about to expire — the account is gone or deactivated, the token
// has expired or soon will, or it has not been used in a long time — and says
// whether to revoke or rotate each. A fresh, in-use token is left alone. And
// removing an account takes its passkeys with it, so no credential is orphaned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importFmp12, Store, type TokenHygieneFinding } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

const now = Date.now();
const D = 86_400_000;
const daysAgo = (n: number) => new Date(now - n * D).toISOString();
const daysAhead = (n: number) => new Date(now + n * D);

/** A non-full privilege set tokens can belong to. */
function botSet(store: Store): string {
  store.savePrivilegeSet({
    name: 'Bot',
    records: { view: true, edit: true, create: true, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'],
  });
  return 'Bot';
}

function fresh(): { store: Store; dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-token-hygiene-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  return { store: new Store(path), dir, path };
}

const by = (tokens: TokenHygieneFinding[], label: string) => tokens.find((t) => t.label === label);

test('flags dead, forgotten, and expiring tokens — and leaves a fresh one alone', { skip }, () => {
  const { store, dir, path } = fresh();
  try {
    const set = botSet(store);
    store.setPassword('worker', 'pw-worker-123', set);
    store.setPassword('suspended', 'pw-susp-123', set);
    store.setPassword('ghost', 'pw-ghost-123', set);

    // A fresh, actively-used token: no expiry, used just now.
    store.createApiToken('worker', { label: 'fresh-active' });
    // A token issued long ago and never used.
    store.createApiToken('worker', { label: 'never-used-old' });
    // A token last used a long time ago.
    store.createApiToken('worker', { label: 'idle-150' });
    // A token that has already expired.
    store.createApiToken('worker', { label: 'expired-5', expires: daysAhead(-5) });
    // A token that will expire within the warning window.
    store.createApiToken('worker', { label: 'expiring-7', expires: daysAhead(7) });
    // A token whose account is deactivated, and one whose account is gone.
    store.createApiToken('ghost', { label: 'orphaned' });

    // Deactivating an account deletes its tokens, so this one is made after.
    store.setAccountActive('suspended', false);
    store.createApiToken('suspended', { label: 'on-suspended' });

    // Backdate timestamps and remove the ghost account's row directly, to stand
    // in for history the public API can't set after the fact.
    const db = new DatabaseSync(path);
    const setTs = db.prepare('UPDATE _fm_api_tokens SET created = ?, last_used = ? WHERE label = ?');
    setTs.run(now_iso(), now_iso(), 'fresh-active');
    setTs.run(daysAgo(200), null, 'never-used-old');
    setTs.run(daysAgo(200), daysAgo(150), 'idle-150');
    setTs.run(now_iso(), now_iso(), 'expired-5');
    setTs.run(now_iso(), now_iso(), 'expiring-7');
    setTs.run(now_iso(), now_iso(), 'on-suspended');
    setTs.run(now_iso(), now_iso(), 'orphaned');
    db.prepare("DELETE FROM _fm_accounts WHERE name = 'ghost' COLLATE NOCASE").run();
    db.close();

    const stale = store.securityHealth().staleTokens;

    // The fresh, in-use token is not flagged.
    assert.ok(!by(stale, 'fresh-active'), 'a fresh, actively-used token is left alone');

    const neverUsed = by(stale, 'never-used-old');
    assert.ok(neverUsed && neverUsed.action === 'revoke');
    assert.match(neverUsed.reasons.join('; '), /never used/i);

    const idle = by(stale, 'idle-150');
    assert.ok(idle && idle.action === 'revoke');
    assert.match(idle.reasons.join('; '), /not used in 150 days/i);

    const expired = by(stale, 'expired-5');
    assert.ok(expired && expired.action === 'revoke');
    assert.match(expired.reasons.join('; '), /expired 5 days ago/i);

    const expiring = by(stale, 'expiring-7');
    assert.ok(expiring && expiring.action === 'rotate', 'about to expire → rotate, not revoke');
    assert.match(expiring.reasons.join('; '), /expires in 7 days/i);

    const suspended = by(stale, 'on-suspended');
    assert.ok(suspended && suspended.action === 'revoke');
    assert.match(suspended.reasons.join('; '), /deactivated/i);

    const orphaned = by(stale, 'orphaned');
    assert.ok(orphaned && orphaned.action === 'revoke');
    assert.match(orphaned.reasons.join('; '), /no longer exists/i);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the idle and expiry windows are adjustable', { skip }, () => {
  const { store, dir, path } = fresh();
  try {
    const set = botSet(store);
    store.setPassword('worker', 'pw-worker-123', set);
    store.createApiToken('worker', { label: 'idle-150' });
    store.createApiToken('worker', { label: 'expiring-30', expires: daysAhead(30) });

    const db = new DatabaseSync(path);
    db.prepare('UPDATE _fm_api_tokens SET created = ?, last_used = ? WHERE label = ?').run(daysAgo(200), daysAgo(150), 'idle-150');
    db.close();

    // A longer idle grace silences the 150-day-idle token.
    assert.ok(!by(store.securityHealth({ idleTokenDays: 365 }).staleTokens, 'idle-150'), 'a 365-day idle grace clears a 150-day-idle token');
    // A wider expiry window catches the 30-day-out token.
    const soon = by(store.securityHealth({ expiringSoonDays: 60 }).staleTokens, 'expiring-30');
    assert.ok(soon && soon.action === 'rotate');
    // ...and the default window (14 days) does not.
    assert.ok(!by(store.securityHealth().staleTokens, 'expiring-30'), 'default window ignores a token 30 days out');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('removing an account takes its passkeys with it', { skip }, () => {
  const { store, dir, path } = fresh();
  try {
    const set = botSet(store);
    store.setPassword('leaver', 'pw-leaver-123', set);

    // Insert a passkey row directly (registerPasskey needs a real WebAuthn
    // ceremony; here we only care that deleteAccount clears the row).
    const db = new DatabaseSync(path);
    db.prepare('INSERT INTO _fm_passkeys (id, account, public_key, sign_count, alg, label, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('cred-leaver', 'leaver', 'pk', 0, -7, 'laptop', now_iso());
    db.close();

    assert.ok(store.hasPasskey('leaver'), 'the passkey is there before removal');
    store.deleteAccount('leaver');
    assert.ok(!store.hasPasskey('leaver'), 'the passkey is gone after the account is removed');

    // A later account reusing the name does not inherit the old credential.
    store.setPassword('leaver', 'pw-leaver-456', set);
    assert.ok(!store.hasPasskey('leaver'), 'a new account of the same name starts with no passkey');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

function now_iso() { return new Date(now).toISOString(); }
