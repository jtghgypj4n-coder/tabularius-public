// Over the Data API: an account that owes a password change signs in but is
// gated until it changes the password, and the minimum-length policy is
// enforced on the change. Mirrors FileMaker's "must change on next sign-in".
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

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-pwpol-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest'])] });
  store.setPassword('Admin', 'first-pass', full.name);
  store.setMustChangePassword('Admin', true);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const sessions = () => `${base}/fmi/data/vLatest/databases/Charts/sessions`;
const layouts = () => `${base}/fmi/data/vLatest/databases/Charts/layouts`;

const login = (user: string, password: string) =>
  fetch(sessions(), { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${user}:${password}`) }, body: '{}' })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
const changePassword = (token: string, body: unknown) =>
  fetch(sessions(), { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
const getLayouts = (token: string) =>
  fetch(layouts(), { headers: { authorization: `Bearer ${token}` } }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('a must-change account signs in, is gated, then clears it by changing the password', { skip }, async () => {
  const login1 = await login('Admin', 'first-pass');
  assert.equal(login1.status, 200);
  assert.equal(login1.body.response.passwordChangeRequired, true, 'the login says a change is owed');
  const token = login1.body.response.token;
  assert.ok(token);

  // The session can do nothing else until it changes the password.
  const gated = await getLayouts(token);
  assert.equal(gated.status, 403);
  assert.equal(gated.body.messages[0].code, '212');

  // A change to the same password is refused; a real change is accepted.
  const same = await changePassword(token, { oldPassword: 'first-pass', newPassword: 'first-pass' });
  assert.equal(same.status, 400);
  const changed = await changePassword(token, { oldPassword: 'first-pass', newPassword: 'second-pass' });
  assert.equal(changed.status, 200);

  // Now the same session works, and a fresh login no longer owes a change.
  const ok = await getLayouts(token);
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.body.response.layouts));
  const login2 = await login('Admin', 'second-pass');
  assert.equal(login2.status, 200);
  assert.equal(login2.body.response.passwordChangeRequired, undefined);

  // The old password no longer works.
  const oldPw = await login('Admin', 'first-pass');
  assert.equal(oldPw.status, 401);
});

test('the minimum-length policy is enforced on a change over the API', { skip }, async () => {
  store.setPasswordPolicy({ minLength: 8 });
  try {
    const session = await login('Admin', 'second-pass');
    const token = session.body.response.token;

    const tooShort = await changePassword(token, { oldPassword: 'second-pass', newPassword: 'abc' });
    assert.equal(tooShort.status, 400);
    assert.equal(tooShort.body.messages[0].code, '960');

    const empty = await changePassword(token, { oldPassword: 'second-pass', newPassword: '' });
    assert.equal(empty.status, 400, 'an empty new password is rejected');

    const okChange = await changePassword(token, { oldPassword: 'second-pass', newPassword: 'longenough' });
    assert.equal(okChange.status, 200);
  } finally {
    store.setPasswordPolicy({});
    store.setPassword('Admin', 'second-pass'); // leave the account as the first test expects if re-run
  }
});

test('changing a password ends every other session on it, but not the one making the change', { skip }, async () => {
  const other = await login('Admin', 'second-pass');
  const mine = await login('Admin', 'second-pass');
  const otherToken = other.body.response.token, mineToken = mine.body.response.token;
  assert.equal((await getLayouts(otherToken)).status, 200);

  const changed = await changePassword(mineToken, { oldPassword: 'second-pass', newPassword: 'third-pass' });
  assert.equal(changed.status, 200);

  assert.equal((await getLayouts(otherToken)).status, 401, 'signed in on the old password: ended');
  assert.equal((await getLayouts(mineToken)).status, 200, 'the session that made the change keeps working');

  store.setPassword('Admin', 'second-pass'); // leave the account as the other tests expect if re-run
});
