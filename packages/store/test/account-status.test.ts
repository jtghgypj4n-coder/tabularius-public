// Accounts switched off in FileMaker (Manage Security's Active box) stay off
// once converted: before this, Flicks' disabled external [Full Access]
// accounts (tool_admin, tool-full-access) came across switched on, so a
// sign-in from an identity provider naming them got full access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ACCOUNT_STATUS_META, DESIGN_VERSION, importFmp12, needsDesigns, reconvert, Store, upgradeDesigns } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const OFF = ['[Guest]', 'tool-full-access', 'tool_admin'];

function converted(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-account-status-'));
  const path = join(dir, 'Flicks.openhbam.sqlite');
  importFmp12(fixture, path);
  return { dir, path };
}

const inactive = (path: string) => {
  const store = new Store(path, 'Flicks');
  try {
    return store.accounts().filter((a) => a.inactive).map((a) => a.name).sort();
  } finally {
    store.close();
  }
};

/** A store as the converter left it before account status was read: every account on, no marker, an older design version. */
function asBefore(path: string): void {
  const sql = new DatabaseSync(path);
  sql.exec('UPDATE _fm_accounts SET inactive = 0');
  sql.prepare('DELETE FROM _fm_meta WHERE key = ?').run(ACCOUNT_STATUS_META);
  sql.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'designVersion'").run(JSON.stringify(DESIGN_VERSION - 1));
  sql.close();
}

test('a fresh conversion keeps the accounts FileMaker has switched off, off', { skip }, () => {
  const { dir, path } = converted();
  try {
    assert.deepEqual(inactive(path), OFF);
    const store = new Store(path, 'Flicks');
    try {
      // The disabled external [Full Access] accounts no longer match an identity-provider sign-in; the active group still does.
      assert.equal(store.externalAccount('someone@example.com', ['tool_admin']), undefined);
      assert.equal(store.externalAccount('someone@example.com', ['tool-full-access']), undefined);
      assert.equal(store.externalAccount('someone@example.com', ['workgroup']), 'workgroup');
      // Nor are they handed temporary passwords by "migrate all".
      assert.ok(!store.unmigratedAccounts().some((n) => OFF.includes(n)));
      assert.ok(store.unmigratedAccounts().includes('lon_c'));
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a store converted before gets the status on its next refresh, once; turning one back on here sticks', { skip }, () => {
  const { dir, path } = converted();
  try {
    asBefore(path);
    assert.deepEqual(inactive(path), []);
    assert.equal(needsDesigns(path), true);
    const log: string[] = [];
    upgradeDesigns(path, fixture, (m) => log.push(m));
    assert.deepEqual(inactive(path), OFF);
    assert.match(log.join('\n'), /turned off 3 accounts that the FileMaker file has switched off: \[Guest\], tool_admin, tool-full-access/);

    // An admin turns one back on here: a later refresh leaves that alone.
    const store = new Store(path, 'Flicks');
    store.setAccountActive('workgroup', false);
    store.setAccountActive('tool_admin', true);
    store.close();
    upgradeDesigns(path, fixture);
    assert.deepEqual(inactive(path), ['[Guest]', 'tool-full-access', 'workgroup']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('converting an older store again applies the status too; a store that has it keeps its own', { skip }, async () => {
  const { dir, path } = converted();
  try {
    asBefore(path);
    await reconvert(path, fixture, { force: true, sameFile: true });
    assert.deepEqual(inactive(path), OFF);

    const store = new Store(path, 'Flicks');
    store.setAccountActive('tool_admin', true);
    store.close();
    await reconvert(path, fixture, { force: true, sameFile: true });
    assert.deepEqual(inactive(path), ['[Guest]', 'tool-full-access']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('password sign-in rechecks activity after asynchronous hashing', { skip }, async () => {
  const { dir, path } = converted();
  try {
    const store = new Store(path, 'Flicks');
    store.setPassword('race-test', 'correct horse battery', store.privilegeSets()[0]!.name);
    const pending = store.verifyAsync('race-test', 'correct horse battery');
    store.setAccountActive('race-test', false);
    assert.equal(await pending, false);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recovery login refuses inactive accounts without consuming their codes', { skip }, () => {
  const { dir, path } = converted();
  try {
    const store = new Store(path, 'Flicks');
    store.setPassword('recovery-test', 'correct horse battery', store.privilegeSets()[0]!.name);
    const [code] = store.generateRecoveryCodes('recovery-test', 1);
    store.setAccountActive('recovery-test', false);
    assert.equal(store.useRecoveryCode('recovery-test', code!), false);
    assert.equal(store.recoveryCodesRemaining('recovery-test'), 1);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const guestOnFixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'PortableCode39-2.fmp12');
const guestSkip = existsSync(guestOnFixture) ? false : 'fixtures missing: run npm run fixtures';

test('[Guest] comes across switched off even when the file has it on, and switched on it still signs nobody in', { skip: guestSkip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-guest-'));
  const path = join(dir, 'Portable.openhbam.sqlite');
  try {
    importFmp12(guestOnFixture, path);
    const store = new Store(path, 'Portable');
    try {
      const guest = store.accounts().find((a) => a.name === '[Guest]')!;
      assert.equal(guest.inactive, true, 'the file has [Guest] on, here it is off');
      assert.equal(store.fileHadGuestOn(), true);
      // An administrator who switches it on gets an account no one can sign in to without its password.
      store.setAccountActive('[Guest]', true);
      for (const from of ['127.0.0.1', '203.0.113.9']) for (const password of ['', 'guest', 'Guest']) assert.equal(store.verify('[Guest]', password, from), false, `${JSON.stringify(password)} from ${from}`);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
