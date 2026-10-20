// The Manage Security area: the overview, batch account/privilege-set changes,
// API tokens, two-factor enrolment, and the [Full Access]-only guard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { totpCode } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;
let base: string;
let full: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sec-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.get('Charts')!;
  const set = store.privilegeSets().find((p) => p.id === 1)!;
  full = set.name;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw', full);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function token(account = 'Admin', password = 'pw'): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:${password}`) }, body: '{}',
  });
  return (await r.json()).response.token;
}

const sec = (tok: string, path = '', init: RequestInit = {}) =>
  fetch(`${base}/tabularius/security/v1/databases/Charts${path}`, {
    ...init, headers: { authorization: `Bearer ${tok}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });

test('the overview lists accounts, sets and the picker lists', { skip }, async () => {
  const tok = await token();
  const body = await (await sec(tok)).json();
  assert.equal(body.database, 'Charts');
  assert.ok(body.accounts.some((a: { name: string }) => a.name === 'Admin'));
  assert.ok(body.privilegeSets.some((p: { name: string }) => p.name === full));
  assert.ok(Array.isArray(body.tables) && body.tables[0].fields);
  assert.ok(body.extendedPrivileges.includes('fmrest'));
  assert.ok(body.extendedPrivileges.includes('fmurlscript'), 'running a script from a link is offered as a choice too');
  // Charts' own Extended Privileges table carries genuinely custom entries (FileMaker's own fmiwp/fmxdbc, which
  // Tabularius doesn't hardcode) — those ARE offered as renamable/deletable in the Extended Privileges tab. (A
  // catalog row that happens to be named like one of Tabularius's own built-ins is covered in design.test.ts, since
  // this fixture has no such row.)
  assert.ok(body.customExtendedPrivileges.some((e: { name: string }) => e.name === 'fmiwp'));
});


test('extended privileges: create/rename/delete through the same batch endpoint, and the picker list follows', { skip }, async () => {
  const tok = await token();
  const created = await (await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'createExtendedPrivilege', name: 'cloud_sync' }] }) })).json();
  assert.ok(created.extendedPrivileges.includes('cloud_sync'), 'offered as a choice right away');
  const entry = created.customExtendedPrivileges.find((e: { name: string }) => e.name === 'cloud_sync');
  assert.ok(entry, 'listed in the Extended Privileges tab\'s own catalog');
  assert.deepEqual(entry.grantedBy, []);

  // Granting it to a set (an ordinary SecurityOp) and renaming the catalog entry (a design op) can ride the same batch.
  const store = host.get('Charts')!;
  store.savePrivilegeSet({ name: 'Sales', records: { view: true, edit: true, create: true, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['cloud_sync'] });
  const renamed = await (await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'updateExtendedPrivilege', extendedPrivilege: entry.id, name: 'cloud_sync_v2' }] }) })).json();
  assert.ok(!renamed.extendedPrivileges.includes('cloud_sync'));
  assert.ok(renamed.extendedPrivileges.includes('cloud_sync_v2'));
  const sales = renamed.privilegeSets.find((p: { name: string }) => p.name === 'Sales');
  assert.deepEqual(sales.extendedPrivileges, ['cloud_sync_v2'], 'the grant followed the rename');
  const renamedEntry = renamed.customExtendedPrivileges.find((e: { name: string }) => e.name === 'cloud_sync_v2');
  assert.deepEqual(renamedEntry.grantedBy, ['Sales']);

  const deleted = await (await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'deleteExtendedPrivilege', extendedPrivilege: renamedEntry.id }] }) })).json();
  assert.ok(!deleted.extendedPrivileges.includes('cloud_sync_v2'));
  assert.deepEqual(deleted.privilegeSets.find((p: { name: string }) => p.name === 'Sales').extendedPrivileges, []);
});

test('a batch adds a set and an account using it, all-or-none', { skip }, async () => {
  const tok = await token();
  const changes = [
    { op: 'savePrivilegeSet', set: { name: 'Sales', records: { view: true, edit: true, create: true, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'], tables: { Congress: { view: true, edit: 'Status = "open"', create: false, delete: false, fields: { Name: 'viewOnly' } } } } },
    { op: 'setAccount', name: 'rep', password: 'secret', privilegeSet: 'Sales' },
  ];
  const r = await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes }) });
  assert.equal(r.status, 200);
  const body = await r.json();
  const rep = body.accounts.find((a: { name: string }) => a.name === 'rep');
  assert.equal(rep.privilegeSet, 'Sales');
  const sales = body.privilegeSets.find((p: { name: string }) => p.name === 'Sales');
  assert.equal(sales.tables.Congress.edit, 'Status = "open"');

  // The new account signs in with its own password.
  assert.ok(await token('rep', 'secret'));

  // A bad change in a batch rolls the whole batch back.
  const bad = await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [
    { op: 'setAccount', name: 'rep2', password: 'x', privilegeSet: 'Sales' },
    { op: 'savePrivilegeSet', set: { name: 'Broken', records: {}, layouts: 'nonsense', valueLists: 'none', scripts: 'none', extendedPrivileges: [] } },
  ] }) });
  assert.equal(bad.status, 400);
  const after = await (await sec(tok)).json();
  assert.equal(after.accounts.some((a: { name: string }) => a.name === 'rep2'), false, 'the good op rolled back too');
});

test('resetting a password through Manage Security signs out whoever was on the old one', { skip }, async () => {
  const tok = await token();
  const repToken = await token('rep', 'secret');
  assert.ok(repToken, 'rep signed in on the old password');
  assert.equal((await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${repToken}` } })).status, 200);

  const changed = await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'setAccount', name: 'rep', password: 'new-secret' }] }) });
  assert.equal(changed.status, 200);

  assert.equal((await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${repToken}` } })).status, 401, 'the old session was ended');
  assert.equal(await token('rep', 'secret'), undefined, 'the old password no longer works');
  assert.ok(await token('rep', 'new-secret'), 'the new one does');
});

test('cannot delete a set still in use, or the last full-access account', { skip }, async () => {
  const tok = await token();
  const inUse = await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'deletePrivilegeSet', name: 'Sales' }] }) });
  assert.equal(inUse.status, 400);
  assert.match((await inUse.json()).error.message, /still used by/);

  const lastFull = await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'deleteAccount', name: 'Admin' }] }) });
  assert.equal(lastFull.status, 400);
  assert.match((await lastFull.json()).error.message, /last account with full access/);

  // Removing the account frees the set, then the set can go.
  await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'deleteAccount', name: 'rep' }, { op: 'deletePrivilegeSet', name: 'Sales' }] }) });
  const body = await (await sec(tok)).json();
  assert.equal(body.accounts.some((a: { name: string }) => a.name === 'rep'), false);
  assert.equal(body.privilegeSets.some((p: { name: string }) => p.name === 'Sales'), false);
});

test('mints an API token and enrols a second factor', { skip }, async () => {
  const tok = await token();
  const mint = await (await sec(tok, '/tokens', { method: 'POST', body: JSON.stringify({ account: 'Admin', label: 'Reporting', readOnly: true }) })).json();
  assert.match(mint.token, /^ohbt_/);
  assert.ok(mint.security.apiTokens.some((t: { label?: string; readOnly: boolean }) => t.label === 'Reporting' && t.readOnly));

  const enroll = await (await sec(tok, '/totp/Admin', { method: 'POST' })).json();
  assert.ok(enroll.secret && enroll.uri.startsWith('otpauth://'));
  // Pending until confirmed.
  assert.equal(enroll.security.accounts.find((a: { name: string }) => a.name === 'Admin').hasTotp, false);

  const wrong = await sec(tok, '/totp/Admin/confirm', { method: 'POST', body: JSON.stringify({ code: '000000' }) });
  assert.equal(wrong.status, 400);
  const ok = await (await sec(tok, '/totp/Admin/confirm', { method: 'POST', body: JSON.stringify({ code: totpCode(enroll.secret) }) })).json();
  assert.equal(ok.confirmed, true);
  assert.equal(ok.security.accounts.find((a: { name: string }) => a.name === 'Admin').hasTotp, true);
  // Turn it back off so it doesn't disturb other sign-ins in this file.
  await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'disableTotp', account: 'Admin' }] }) });
});

test('a non-full-access account is refused', { skip }, async () => {
  const store = host.get('Charts')!;
  store.savePrivilegeSet({ name: 'ReadOnly', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('viewer', 'pw', 'ReadOnly');
  const tok = await token('viewer', 'pw');
  assert.equal((await sec(tok)).status, 403);
});
