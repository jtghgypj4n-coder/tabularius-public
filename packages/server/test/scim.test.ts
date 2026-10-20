// SCIM 2.0 provisioning: an identity provider adds people as external
// accounts named by their email, deactivates and removes them, and moves them
// between privilege sets through groups. The requests below are shaped the way
// Okta and Microsoft Entra ID send them.
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
let token: string;
const scim = () => `${base}/tabularius/scim/v2/databases/Charts`;
const READ_ONLY = '[Read-Only Access]';
const DATA_ENTRY = '[Data Entry Only]';
const gid = (set: string) => Buffer.from(set).toString('base64url');

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-scim-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} }); // loopback: console calls are open
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
});
after(() => {
  server?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const admin = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

async function call(method: string, path: string, body?: unknown, bearer = token) {
  const r = await fetch(`${scim()}${path}`, {
    method,
    headers: { 'content-type': 'application/scim+json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  return { status: r.status, type: r.headers.get('content-type'), location: r.headers.get('location'), body: text ? JSON.parse(text) : undefined };
}

const account = (name: string) => store.accounts().find((a) => a.name.toLowerCase() === name.toLowerCase());

test('provisioning is off until an admin issues a token, and only that token signs in', { skip }, async () => {
  const off = await admin('GET', '/tabularius/admin/v1/scim?database=Charts');
  assert.equal(off.body.on, false);
  assert.ok(!off.body.privilegeSets.includes('[Full Access]'), 'full access is never a group');
  assert.equal((await call('GET', '/Users', undefined, 'ohsc_nope')).status, 401);

  const issued = await admin('POST', '/tabularius/admin/v1/scim/token', { database: 'Charts' });
  assert.equal(issued.status, 200);
  assert.match(issued.body.token, /^ohsc_/);
  assert.equal(issued.body.on, true);
  assert.equal(issued.body.path, '/tabularius/scim/v2/databases/Charts');
  token = issued.body.token;

  const noAuth = await call('GET', '/Users', undefined, '');
  assert.equal(noAuth.status, 401);
  assert.deepEqual(noAuth.body.schemas, ['urn:ietf:params:scim:api:messages:2.0:Error']);
  assert.equal((await call('GET', '/Users', undefined, token + 'x')).status, 401);
  const ok = await call('GET', '/Users');
  assert.equal(ok.status, 200);
  assert.match(ok.type ?? '', /application\/scim\+json/);
  assert.equal(ok.body.totalResults, 0);

  // The token is never kept in clear, and issuing it is in the security log.
  const meta = store.sql.prepare(`SELECT json FROM _fm_meta WHERE key = 'scim'`).get() as { json: string };
  assert.ok(!meta.json.includes(token));
  assert.ok(store.securityEvents({ kind: 'scim-token-issued' }).length >= 1);
});

test('the discovery documents answer', { skip }, async () => {
  const spc = await call('GET', '/ServiceProviderConfig');
  assert.equal(spc.body.patch.supported, true);
  assert.equal(spc.body.bulk.supported, false);
  const types = await call('GET', '/ResourceTypes');
  assert.deepEqual(types.body.Resources.map((t: { id: string }) => t.id), ['User', 'Group']);
  const schemas = await call('GET', '/Schemas');
  assert.equal(schemas.body.totalResults, 2);
});

test('Okta: look up, create, read, deactivate, reactivate', { skip }, async () => {
  const miss = await call('GET', `/Users?filter=${encodeURIComponent('userName eq "pat@example.com"')}&startIndex=1&count=100`);
  assert.equal(miss.body.totalResults, 0);

  const made = await call('POST', '/Users', {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    userName: 'pat@example.com', name: { givenName: 'Pat', familyName: 'Lee' },
    emails: [{ primary: true, value: 'pat@example.com', type: 'work' }], displayName: 'Pat Lee', active: true, externalId: '00u1',
  });
  assert.equal(made.status, 201);
  assert.ok(made.location?.endsWith(`/Users/${made.body.id}`));
  assert.equal(made.body.userName, 'pat@example.com');
  assert.equal(made.body.active, true);
  assert.deepEqual(made.body.groups, []);
  const acct = account('pat@example.com');
  assert.ok(acct?.external && !acct.hasPassword, 'an external account, no password');
  assert.equal(acct.privilegeSet, undefined, 'no set until a group gives one');
  assert.equal(acct.createdBy, 'SCIM');
  const none = store.privileges('pat@example.com');
  assert.ok(!none.has('fmrest') && !none.has('fmwebdirect') && !none.readsEverything, 'opens nothing yet');

  const found = await call('GET', `/Users?filter=${encodeURIComponent('userName eq "PAT@example.com"')}`);
  assert.equal(found.body.totalResults, 1, 'userName is matched without case');
  assert.equal((await call('GET', `/Users?filter=${encodeURIComponent('externalId eq "00u1"')}`)).body.totalResults, 1);

  const dup = await call('POST', '/Users', { userName: 'Pat@Example.com', active: true });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.scimType, 'uniqueness');

  const off = await call('PATCH', `/Users/${made.body.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { active: false } }] });
  assert.equal(off.status, 200);
  assert.equal(off.body.active, false);
  assert.equal(account('pat@example.com')?.inactive, true);
  const disabled = store.securityEvents({ kind: 'account-disabled' }).find((e) => e.target === 'pat@example.com');
  assert.equal(disabled?.account, 'SCIM', 'the log says SCIM did it');

  // Okta's PUT on reactivation sends the whole user.
  const on = await call('PUT', `/Users/${made.body.id}`, { userName: 'pat@example.com', name: { givenName: 'Pat', familyName: 'Lee-Smith' }, active: true, externalId: '00u1' });
  assert.equal(on.body.active, true);
  assert.equal(on.body.name.familyName, 'Lee-Smith');
  assert.equal(on.body.displayName, undefined, 'PUT replaces: what it leaves out is gone');
  assert.equal(account('pat@example.com')?.inactive, undefined);
});

test('Entra: string booleans, path operations, the email filter path, and delete', { skip }, async () => {
  const made = await call('POST', '/Users', { userName: 'sam@example.com', active: 'True', externalId: 'e-sam', emails: [{ value: 'sam@example.com', type: 'work', primary: 'true' }] });
  assert.equal(made.status, 201);
  const id = made.body.id;
  const patched = await call('PATCH', `/Users/${id}`, {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
    Operations: [
      { op: 'Replace', path: 'displayName', value: 'Sam Doe' },
      { op: 'Replace', path: 'name.givenName', value: 'Sam' },
      { op: 'Replace', path: 'emails[type eq "work"].value', value: 'sam.doe@example.com' },
      { op: 'Add', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department', value: 'Sales' },
      { op: 'Replace', path: 'active', value: 'False' },
    ],
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.displayName, 'Sam Doe');
  assert.equal(patched.body.name.givenName, 'Sam');
  assert.equal(patched.body.emails[0].value, 'sam.doe@example.com');
  assert.equal(patched.body.active, false);

  const rename = await call('PATCH', `/Users/${id}`, { Operations: [{ op: 'replace', path: 'userName', value: 'samuel@example.com' }] });
  assert.equal(rename.status, 400);
  assert.equal(rename.body.scimType, 'mutability');

  // Removing someone leaves their account off (not deleted), so their domain can't sign them in again.
  store.setExternalAccount('@example.com', READ_ONLY);
  await call('PATCH', `/Users/${id}`, { Operations: [{ op: 'replace', path: 'active', value: true }] });
  // AI stand-ins kept for them (and for a scoped connection of theirs) go with them; another account's stay.
  store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_pii_vault (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL COLLATE NOCASE,
    kind TEXT NOT NULL, value TEXT NOT NULL, UNIQUE (account, value))`);
  const put = store.sql.prepare('INSERT INTO _fm_pii_vault (account, kind, value) VALUES (?, ?, ?)');
  put.run('sam@example.com', 'name', 'Sam Real');
  put.run('sam@example.com\u0001{"layouts":["A"]}', 'name', 'Sam Scoped');
  put.run('someone-else', 'name', 'Else Real');
  assert.equal((await call('DELETE', `/Users/${id}`)).status, 204);
  assert.deepEqual((store.sql.prepare('SELECT account FROM _fm_pii_vault').all() as { account: string }[]).map((r) => r.account), ['someone-else']);
  assert.equal(account('sam@example.com')?.inactive, true, 'the account is off');
  assert.equal(store.externalAccount('sam@example.com'), undefined, 'their domain can\'t let them back in');
  assert.equal((await call('GET', `/Users/${id}`)).status, 404);
  assert.equal(store.securityEvents({ kind: 'account-disabled' }).filter((e) => e.target === 'sam@example.com').at(-1)?.account, 'SCIM');
  store.deleteAccount('@example.com');
});

test('groups are privilege sets: membership gives the set, removal takes it away', { skip }, async () => {
  const list = await call('GET', '/Groups?excludedAttributes=members');
  const names = list.body.Resources.map((g: { displayName: string }) => g.displayName);
  assert.ok(names.includes(READ_ONLY) && names.includes(DATA_ENTRY));
  assert.ok(!names.includes('[Full Access]'));
  assert.equal(list.body.Resources[0].members, undefined);

  const byName = await call('GET', `/Groups?filter=${encodeURIComponent(`displayName eq "${READ_ONLY}"`)}`);
  assert.equal(byName.body.totalResults, 1);
  const group = byName.body.Resources[0];
  assert.equal(group.id, gid(READ_ONLY));

  const pat = (await call('GET', `/Users?filter=${encodeURIComponent('userName eq "pat@example.com"')}`)).body.Resources[0];
  const add = await call('PATCH', `/Groups/${group.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'add', path: 'members', value: [{ value: pat.id }] }] });
  assert.equal(add.status, 200);
  assert.deepEqual(add.body.members.map((m: { value: string }) => m.value), [pat.id]);
  assert.equal(account('pat@example.com')?.privilegeSet, READ_ONLY);
  assert.equal(store.privileges('pat@example.com').name, READ_ONLY);
  assert.deepEqual((await call('GET', `/Users/${pat.id}`)).body.groups.map((g: { display: string }) => g.display), [READ_ONLY]);

  // Added to another group: one set per account, the last one wins.
  await call('PATCH', `/Groups/${gid(DATA_ENTRY)}`, { Operations: [{ op: 'Add', path: 'members', value: [{ value: pat.id }] }] });
  assert.equal(account('pat@example.com')?.privilegeSet, DATA_ENTRY);
  assert.equal((await call('GET', `/Groups/${group.id}`)).body.members.length, 1, 'still a member of the first group');
  assert.equal((await call('GET', `/Users/${pat.id}`)).body.groups.length, 2);

  // Okta's removal names the member in the path; they fall back to the group they're still in.
  await call('PATCH', `/Groups/${gid(DATA_ENTRY)}`, { Operations: [{ op: 'remove', path: `members[value eq "${pat.id}"]` }] });
  assert.equal(account('pat@example.com')?.privilegeSet, READ_ONLY);
  await call('PATCH', `/Groups/${group.id}`, { Operations: [{ op: 'remove', path: 'members', value: [{ value: pat.id }] }] });
  assert.equal(account('pat@example.com')?.privilegeSet, undefined, 'no group and no default set: back to no access');
  assert.ok(store.securityEvents({ kind: 'privilege-set-unassigned' }).some((e) => e.target === 'pat@example.com' && e.account === 'SCIM'));
});

test('a default set catches people no group covers', { skip }, async () => {
  const set = await admin('POST', '/tabularius/admin/v1/scim/settings', { database: 'Charts', defaultPrivilegeSet: READ_ONLY });
  assert.equal(set.body.defaultPrivilegeSet, READ_ONLY);
  const made = await call('POST', '/Users', { userName: 'kim@example.com', active: true });
  assert.equal(account('kim@example.com')?.privilegeSet, READ_ONLY);
  await call('PUT', `/Groups/${gid(DATA_ENTRY)}`, { displayName: DATA_ENTRY, members: [{ value: made.body.id }] });
  assert.equal(account('kim@example.com')?.privilegeSet, DATA_ENTRY);
  // Entra removes with the member in the value.
  await call('PATCH', `/Groups/${gid(DATA_ENTRY)}`, { Operations: [{ op: 'Remove', path: 'members', value: [{ value: made.body.id }] }] });
  assert.equal(account('kim@example.com')?.privilegeSet, READ_ONLY, 'back to the default');

  const full = await admin('POST', '/tabularius/admin/v1/scim/settings', { database: 'Charts', defaultPrivilegeSet: '[Full Access]' });
  assert.match(full.body.error, /Full Access/);
  await admin('POST', '/tabularius/admin/v1/scim/settings', { database: 'Charts', defaultPrivilegeSet: null });
});

test('full access can\'t be handed out, groups can\'t be renamed, and unknown sets are explained', { skip }, async () => {
  assert.equal((await call('GET', `/Groups/${gid('[Full Access]')}`)).status, 404);
  const pushFull = await call('POST', '/Groups', { displayName: '[Full Access]', members: [] });
  assert.equal(pushFull.status, 400);
  assert.match(pushFull.body.detail, /full access/);
  const pushNew = await call('POST', '/Groups', { displayName: 'Engineering' });
  assert.equal(pushNew.status, 400);
  assert.match(pushNew.body.detail, /no privilege set named "Engineering"/);
  const link = await call('POST', '/Groups', { displayName: READ_ONLY.toLowerCase() });
  assert.equal(link.status, 201, 'pushing a group under a set\'s name links to it');
  assert.equal(link.body.displayName, READ_ONLY);
  const rename = await call('PATCH', `/Groups/${gid(READ_ONLY)}`, { Operations: [{ op: 'replace', path: 'displayName', value: 'Readers' }] });
  assert.equal(rename.body.scimType, 'mutability');
  assert.equal((await call('GET', '/Users?filter=title eq "x" or 1')).body.scimType, 'invalidFilter');
});

test('a sign-in someone already has is never taken over; an existing SSO mapping by email is', { skip }, async () => {
  store.setPassword('lee@example.com', 'secret-pw', READ_ONLY);
  const clash = await call('POST', '/Users', { userName: 'lee@example.com', active: true });
  assert.equal(clash.status, 409);
  assert.ok(account('lee@example.com')?.hasPassword, 'the password account is untouched');

  store.setExternalAccount('ana@example.com', DATA_ENTRY);
  const adopted = await call('POST', '/Users', { userName: 'ana@example.com', active: true });
  assert.equal(adopted.status, 201);
  assert.equal(account('ana@example.com')?.privilegeSet, DATA_ENTRY, 'its set is kept');
  assert.deepEqual(adopted.body.groups, [], 'though no group of the provider\'s gave it');

  for (const bad of ['@example.com', 'staff', 'a b@example.com']) {
    const r = await call('POST', '/Users', { userName: bad, active: true });
    assert.equal(r.status, 400, bad);
  }
});

test('deleting a group takes the set from the people SCIM gave it to, and the set stays', { skip }, async () => {
  const ana = (await call('GET', `/Users?filter=${encodeURIComponent('userName eq "ana@example.com"')}`)).body.Resources[0];
  await call('PATCH', `/Groups/${gid(DATA_ENTRY)}`, { Operations: [{ op: 'add', path: 'members', value: [{ value: ana.id }] }] });
  assert.equal((await call('DELETE', `/Groups/${gid(DATA_ENTRY)}`)).status, 204);
  assert.equal(account('ana@example.com')?.privilegeSet, undefined);
  assert.ok(store.privilegeSet(DATA_ENTRY), 'the privilege set is still there');
  assert.equal(account('lee@example.com')?.privilegeSet, READ_ONLY, 'accounts SCIM doesn\'t manage are untouched');
  assert.ok(ana.id);
});

test('paging, an account an admin removed, and revoking the token', { skip }, async () => {
  const all = await call('GET', '/Users');
  const page = await call('GET', '/Users?startIndex=2&count=1');
  assert.equal(page.body.totalResults, all.body.totalResults);
  assert.equal(page.body.itemsPerPage, 1);
  assert.equal(page.body.Resources[0].id, all.body.Resources[1].id);

  store.deleteAccount('kim@example.com');
  assert.ok(!(await call('GET', '/Users')).body.Resources.some((u: { userName: string }) => u.userName === 'kim@example.com'));

  const revoked = await admin('DELETE', '/tabularius/admin/v1/scim/token?database=Charts');
  assert.equal(revoked.body.revoked, true);
  assert.equal((await call('GET', '/Users')).status, 401);
  assert.ok(account('pat@example.com'), 'the accounts it made stay');
});

test('the token can\'t take full access away: no takeover, no demotion, no deactivation', { skip }, async () => {
  const issued = await admin('POST', '/tabularius/admin/v1/scim/token', { database: 'Charts' });
  token = issued.body.token;
  store.setExternalAccount('boss@example.com', '[Full Access]');
  const take = await call('POST', '/Users', { userName: 'boss@example.com', active: true });
  assert.equal(take.status, 409);
  assert.match(take.body.detail, /full access/);

  // Someone SCIM made, whom an admin then gave full access.
  const made = await call('POST', '/Users', { userName: 'chief@example.com', active: true });
  store.setAccountPrivilegeSet('chief@example.com', '[Full Access]');
  assert.equal((await call('PATCH', `/Users/${made.body.id}`, { Operations: [{ op: 'replace', value: { active: false } }] })).status, 403);
  assert.equal((await call('PATCH', `/Groups/${gid(READ_ONLY)}`, { Operations: [{ op: 'add', path: 'members', value: [{ value: made.body.id }] }] })).status, 403);
  assert.equal((await call('DELETE', `/Users/${made.body.id}`)).status, 403);
  assert.equal(account('chief@example.com')?.privilegeSet, '[Full Access]');
  assert.equal(account('chief@example.com')?.inactive, undefined);
});

test('malformed requests answer 400, not 500', { skip }, async () => {
  const raw = (method: string, path: string, body: string) => fetch(`${scim()}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' }, body });
  assert.equal((await raw('POST', '/Users', 'null')).status, 400);
  assert.equal((await raw('POST', '/Groups', '[1]')).status, 400);
  assert.equal((await raw('POST', '/Users', '{oops')).status, 400);
  const pat = (await call('GET', `/Users?filter=${encodeURIComponent('userName eq "pat@example.com"')}`)).body.Resources[0];
  assert.equal((await raw('PATCH', `/Users/${pat.id}`, 'null')).status, 400);
  assert.equal((await call('GET', '/Users/%ZZ')).status, 400);
});
