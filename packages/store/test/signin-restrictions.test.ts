// Per-account, opt-in sign-in restrictions: "sign in only from this computer"
// (local-only) and "require a second factor" (require-2fa). Both are off by
// default, so an existing file behaves exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function open(): { store: Store; dir: string; full: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-signin-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  const full = store.privilegeSets().find((p) => p.id === 1)!.name;
  store.setPassword('Admin', 'pw', full);
  return { store, dir, full };
}

test('both restrictions default off and toggle per account', { skip }, () => {
  const { store, dir } = open();
  try {
    assert.equal(store.accountLocalOnly('Admin'), false);
    assert.equal(store.accountRequires2fa('Admin'), false);
    // An account with neither flag never shows them in accounts().
    const before = store.accounts().find((a) => a.name === 'Admin')!;
    assert.equal(before.localOnly, undefined);
    assert.equal(before.require2fa, undefined);

    assert.equal(store.setAccountLocalOnly('Admin', true), true);
    assert.equal(store.setAccountRequire2fa('Admin', true), true);
    assert.equal(store.accountLocalOnly('Admin'), true);
    assert.equal(store.accountRequires2fa('Admin'), true);

    const after = store.accounts().find((a) => a.name === 'Admin')!;
    assert.equal(after.localOnly, true);
    assert.equal(after.require2fa, true);

    // Clearing them removes the flags again.
    assert.equal(store.setAccountLocalOnly('Admin', false), true);
    assert.equal(store.setAccountRequire2fa('Admin', false), true);
    assert.equal(store.accountLocalOnly('Admin'), false);
    assert.equal(store.accountRequires2fa('Admin'), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('setting a restriction on an unknown account returns false', { skip }, () => {
  const { store, dir } = open();
  try {
    assert.equal(store.setAccountLocalOnly('nobody', true), false);
    assert.equal(store.setAccountRequire2fa('nobody', true), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('signInLocationAllowed gates a local-only account to loopback addresses', { skip }, () => {
  const { store, dir } = open();
  try {
    // No restriction: any address is allowed.
    assert.equal(store.signInLocationAllowed('Admin', '203.0.113.5'), true);

    store.setAccountLocalOnly('Admin', true);
    // Loopback and the internal markers are still allowed.
    for (const from of ['', 'mcp', '127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      assert.equal(store.signInLocationAllowed('Admin', from), true, `loopback ${from}`);
    }
    // A real network address is refused.
    assert.equal(store.signInLocationAllowed('Admin', '203.0.113.5'), false);
    assert.equal(store.signInLocationAllowed('Admin', '192.168.1.50'), false);

    // Clearing the flag lets it in from anywhere again.
    store.setAccountLocalOnly('Admin', false);
    assert.equal(store.signInLocationAllowed('Admin', '203.0.113.5'), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('applySecurity sets and clears the restrictions and audits them', { skip }, () => {
  const { store, dir } = open();
  try {
    store.applySecurity([{ op: 'setAccount', name: 'Admin', localOnly: true, require2fa: true }]);
    assert.equal(store.accountLocalOnly('Admin'), true);
    assert.equal(store.accountRequires2fa('Admin'), true);

    const set = store.auditLog({ security: true, limit: 100 }).map((e) => e.kind);
    assert.ok(set.includes('account-local-only-set'), 'local-only-set audited');
    assert.ok(set.includes('account-require-2fa-set'), 'require-2fa-set audited');

    store.applySecurity([{ op: 'setAccount', name: 'Admin', localOnly: false, require2fa: false }]);
    assert.equal(store.accountLocalOnly('Admin'), false);
    assert.equal(store.accountRequires2fa('Admin'), false);
    const cleared = store.auditLog({ security: true, limit: 100 }).map((e) => e.kind);
    assert.ok(cleared.includes('account-local-only-cleared'), 'local-only-cleared audited');
    assert.ok(cleared.includes('account-require-2fa-cleared'), 'require-2fa-cleared audited');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('the restrictions survive a reopen of the file', { skip }, () => {
  const { store, dir } = open();
  const path = join(dir, 'Charts.sqlite');
  try {
    store.setAccountLocalOnly('Admin', true);
    store.setAccountRequire2fa('Admin', true);
    store.close();
    const reopened = new Store(path);
    try {
      assert.equal(reopened.accountLocalOnly('Admin'), true);
      assert.equal(reopened.accountRequires2fa('Admin'), true);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});
