// The admin console's account-access endpoints: a password for any account, lifting a sign-in lockout, and the
// per-file "allow blank password from LAN" opt-in — all for an account that can't sign in to use Manage Security
// itself, so none of it needs Terminal access to the machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStore, LOCKOUT, type Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

let dir: string;
let server: Server;
let base: string;
let store: Store;
const logs: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-acc-admin-'));
  createStore(join(dir, 'Charts.openhbam.sqlite'));
  const s = await serve({ dir, port: 0, log: (message) => { logs.push(message); } }); // loopback: console calls are open
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify(body) });

test('sets a password for an existing account, and refuses an account the file doesn\'t have', async () => {
  store.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('alice', 'old-password-1', 'Clerk');

  const r = await post('/tabularius/admin/v1/accounts/set-password', { database: 'Charts', account: 'alice', password: 'new-password-1', mustChange: true });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(store.verify('alice', 'old-password-1', ''), false);
  assert.equal(store.verify('alice', 'new-password-1', ''), true);
  assert.equal(store.mustChangePassword('alice'), true);

  const bad = await post('/tabularius/admin/v1/accounts/set-password', { database: 'Charts', account: 'nobody', password: 'whatever12' });
  assert.equal(bad.status, 400);
  const noPw = await post('/tabularius/admin/v1/accounts/set-password', { database: 'Charts', account: 'alice', password: '' });
  assert.equal(noPw.status, 400);
});

test('setting a password from the console signs out whoever was on the old one', async () => {
  store.savePrivilegeSet({ name: 'Clerk2', records: { view: true, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('dan', 'dans-old-pass1', 'Clerk2');
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('dan:dans-old-pass1') }, body: '{}' });
  const token = (await login.json()).response.token;
  assert.equal((await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${token}` } })).status, 200);

  const r = await post('/tabularius/admin/v1/accounts/set-password', { database: 'Charts', account: 'dan', password: 'dans-new-pass1' });
  assert.equal(r.status, 200);
  assert.equal((await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
});

test('typing the account name with different casing updates the real account, not a new one', async () => {
  store.savePrivilegeSet({ name: 'Clerk2', records: { view: true, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('carol', 'old-password-2', 'Clerk2');

  const r = await post('/tabularius/admin/v1/accounts/set-password', { database: 'Charts', account: 'Carol', password: 'new-password-2' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(store.accounts().filter((a) => a.name.toLowerCase() === 'carol').length, 1, 'no duplicate account was created');
  assert.equal(store.verify('carol', 'new-password-2', ''), true, 'the real account got the new password');
});

test('lifts a sign-in lockout', async () => {
  store.savePrivilegeSet({ name: 'Bob set', records: { view: true, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('bob', 'bob-pw-1234', 'Bob set');
  for (let i = 0; i < 5; i++) store.verify('bob', 'wrong', '5.5.5.5');
  assert.ok(store.lockedOut('bob', '5.5.5.5'));

  const r = await post('/tabularius/admin/v1/accounts/unlock', { database: 'Charts', account: 'bob' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { ok: true, cleared: true });
  assert.equal(store.lockedOut('bob', '5.5.5.5'), undefined);
  assert.equal(store.verify('bob', 'bob-pw-1234', '5.5.5.5'), true);

  const bad = await post('/tabularius/admin/v1/accounts/unlock', { database: 'Charts', account: 'nobody' });
  assert.equal(bad.status, 400, 'an account the file does not have is refused, same as set-password');
});

test('admin lockout clearing writes a security audit event for accounts and addresses', async () => {
  store.setPassword('audit-locked', 'right-password', '[Full Access]');
  for (let i = 0; i < 5; i++) store.verify('audit-locked', 'wrong', '5.6.7.8');
  const before = store.securityEvents({ kind: 'lockout-cleared' }).length;
  const account = await post('/tabularius/admin/v1/accounts/unlock', { database: 'Charts', account: 'audit-locked' });
  assert.equal(account.status, 200);
  assert.deepEqual(await account.json(), { ok: true, cleared: true });
  assert.equal(store.securityEvents({ kind: 'lockout-cleared' }).length, before + 1);
  assert.equal(store.securityEvents({ kind: 'lockout-cleared' }).at(-1)?.target, 'audit-locked');

  for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure('5.6.7.8');
  assert.ok(store.addressLockedOut('5.6.7.8'));
  const address = await post('/tabularius/admin/v1/accounts/unlock', { database: 'Charts', address: '5.6.7.8' });
  assert.equal(address.status, 200);
  assert.equal((await address.json() as { cleared: boolean }).cleared, true);
  assert.equal(store.securityEvents({ kind: 'lockout-cleared' }).length, before + 2);
  assert.equal(store.securityEvents({ kind: 'lockout-cleared' }).at(-1)?.target, '5.6.7.8');
});

for (const state of ['absent', 'below the threshold', 'expired']) {
  test(`admin unlock reports no cleared block or audit event when ${state}`, async (t) => {
    const account = 'no-op-unlock';
    const address = '198.51.100.44';
    store.setPassword(account, 'right-password', '[Full Access]');
    store.unlockAddress(address);
    if (state !== 'absent') {
      for (let i = 0; i < (state === 'expired' ? LOCKOUT.attempts : 1); i++) store.verify(account, 'wrong', address);
      for (let i = 0; i < (state === 'expired' ? LOCKOUT.addressAttempts : 1); i++) store.countAddressFailure(address);
    }
    if (state === 'expired') {
      const now = performance.now();
      t.mock.method(performance, 'now', () => now + LOCKOUT.lockMs);
    }
    // A lock that ran out by itself leaves its own timer-stamped event the first time anything observes the expiry; an unlock
    // must add none, because there was nothing for it to clear.
    const cleared = () => store.securityEvents({ kind: 'lockout-cleared' });
    const unlocks = () => cleared().filter((e) => e.changes?.via !== 'timer').length;
    const timers = () => cleared().filter((e) => e.changes?.via === 'timer');
    const before = unlocks(), timersBefore = timers().length;
    const logged = logs.length;
    for (const target of [{ account }, { address }]) {
      const r = await post('/tabularius/admin/v1/accounts/unlock', { database: 'Charts', ...target });
      assert.equal(r.status, 200);
      assert.equal(unlocks(), before, 'no false security event');
      assert.ok(!logs.slice(logged).some((line) => /(?:lockout|sign-in block) cleared/.test(line)), 'no false cleared message');
      assert.deepEqual(await r.json(), { ok: true, cleared: false });
    }
    const written = timers().slice(timersBefore);
    if (state === 'expired') {
      assert.deepEqual(written.map((e) => e.changes?.scope).sort(), ['account', 'address'], 'one timer event per expired lock, none claiming an unlock');
      assert.ok(written.every((e) => typeof e.changes?.expiredAt === 'string'));
    } else assert.deepEqual(written, [], 'no lock ran out, so no timer event');
  });
}

test('the blank-password-from-LAN opt-in is per file, off by default, and toggles', async () => {
  const get = () => fetch(`${base}/tabularius/admin/v1/accounts/blank-password-lan?database=Charts`).then((r) => r.json());
  assert.equal((await get()).on, false);

  const on = await post('/tabularius/admin/v1/accounts/blank-password-lan', { database: 'Charts', on: true });
  assert.equal(on.status, 200);
  assert.equal((await on.json()).on, true);
  assert.equal(store.allowBlankPasswordFromLan(), true);
  assert.equal((await get()).on, true);

  const off = await post('/tabularius/admin/v1/accounts/blank-password-lan', { database: 'Charts', on: false });
  assert.equal((await off.json()).on, false);
  assert.equal(store.allowBlankPasswordFromLan(), false);

  const unknown = await post('/tabularius/admin/v1/accounts/blank-password-lan', { database: 'Nope', on: true });
  assert.equal(unknown.status, 404);
});
