// The admin console's SSO group mapping endpoints: list/add/remove which
// email, email domain or group gets which privilege set when someone signs
// in through an identity provider, and "test with this user" (which mapping
// an email/groups would resolve to, and what that privilege set can do).
// These are an admin-console face on Store.externalAccount/setExternalAccount,
// which otherwise only Terminal could set.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sso-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} }); // loopback: console calls are open
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const get = (path: string) => fetch(`${base}${path}`).then((r) => r.json());
const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify(body) }).then((r) => r.json());
const del = (path: string) => fetch(`${base}${path}`, { method: 'DELETE', headers: { 'x-tabularius-admin': '1' } }).then((r) => r.json());

test('with no mappings, the list is empty and the privilege-set picker is there', { skip }, async () => {
  const r = await get('/tabularius/admin/v1/sso-mapping?database=Charts');
  assert.equal(r.database, 'Charts');
  assert.deepEqual(r.mappings, []);
  assert.ok(Array.isArray(r.privilegeSets) && r.privilegeSets.includes('[Read-Only Access]'));
});

test('adding a mapping makes it show up, and removing it takes it away', { skip }, async () => {
  const added = await post('/tabularius/admin/v1/sso-mapping', { database: 'Charts', name: 'engineers', privilegeSet: '[Read-Only Access]' });
  assert.equal(added.ok, true);
  const listed = await get('/tabularius/admin/v1/sso-mapping?database=Charts');
  assert.deepEqual(listed.mappings, [{ name: 'engineers', privilegeSet: '[Read-Only Access]' }]);

  const removed = await del(`/tabularius/admin/v1/sso-mapping/engineers?database=${encodeURIComponent('Charts')}`);
  assert.equal(removed.removed, true);
  assert.deepEqual((await get('/tabularius/admin/v1/sso-mapping?database=Charts')).mappings, []);
});

test('a bad privilege set, an empty name, or an unknown database are reported, not a crash', { skip }, async () => {
  assert.match((await post('/tabularius/admin/v1/sso-mapping', { database: 'Charts', name: 'x', privilegeSet: 'Nope' })).error, /No privilege set "Nope"/);
  assert.match((await post('/tabularius/admin/v1/sso-mapping', { database: 'Charts', name: '', privilegeSet: '[Read-Only Access]' })).error, /name a group/);
  assert.match((await post('/tabularius/admin/v1/sso-mapping', { database: 'Nope', name: 'x', privilegeSet: '[Read-Only Access]' })).error, /hosted/);
});

test('removing a mapping by name never reaches a real, password-protected account of the same name', { skip }, async () => {
  // A real account, with a password — not an SSO mapping.
  store.setPassword('shared-name', 'pw', '[Read-Only Access]');
  assert.ok(store.accounts().some((a) => a.name === 'shared-name' && !a.external));

  const removed = await del(`/tabularius/admin/v1/sso-mapping/shared-name?database=${encodeURIComponent('Charts')}`);
  assert.match(removed.error, /is not an SSO mapping/);
  assert.ok(store.accounts().some((a) => a.name === 'shared-name'), 'the real account must survive');
});

test('test with this user: email beats domain beats group, and a miss says so, with the matched set\'s own access explained', { skip }, async () => {
  await post('/tabularius/admin/v1/sso-mapping', { database: 'Charts', name: 'pat@example.com', privilegeSet: '[Read-Only Access]' });
  await post('/tabularius/admin/v1/sso-mapping', { database: 'Charts', name: '@example.com', privilegeSet: '[Full Access]' });
  await post('/tabularius/admin/v1/sso-mapping', { database: 'Charts', name: 'staff', privilegeSet: '[Read-Only Access]' });

  // Exact email wins even though the domain and a group also match.
  const exact = await get('/tabularius/admin/v1/sso-mapping/test?database=Charts&email=pat%40example.com&groups=staff');
  assert.equal(exact.matched, true);
  assert.equal(exact.account, 'pat@example.com');
  assert.equal(exact.explanation.privilegeSet, '[Read-Only Access]');
  assert.ok(exact.explanation.summary);

  // No exact email, but the domain matches.
  const domain = await get('/tabularius/admin/v1/sso-mapping/test?database=Charts&email=sam%40example.com');
  assert.equal(domain.account, '@example.com');
  assert.equal(domain.explanation.fullAccess, true);

  // No email match at all, fall back to the group.
  const group = await get('/tabularius/admin/v1/sso-mapping/test?database=Charts&email=nobody%40other.org&groups=staff');
  assert.equal(group.matched, true);
  assert.equal(group.account, 'staff');

  // Nothing matches: refused, not a crash, and nothing to explain.
  const miss = await get('/tabularius/admin/v1/sso-mapping/test?database=Charts&email=nobody%40other.org&groups=nothing');
  assert.equal(miss.matched, false);
  assert.equal(miss.explanation, undefined);
});

test('group-only previews deny without an email, including whitespace-only input', { skip }, async () => {
  store.setExternalAccount('staff', '[Read-Only Access]');
  for (const email of ['', '&email=%20%20%20']) {
    const result = await get(`/tabularius/admin/v1/sso-mapping/test?database=Charts&groups=staff${email}`);
    assert.equal(result.account, undefined);
    assert.equal(result.explanation, undefined);
    assert.deepEqual(result, { database: 'Charts', matched: false });
  }
  assert.deepEqual(await get('/tabularius/admin/v1/sso-mapping/test?database=Charts'), { database: 'Charts' });
});

test('an inactive person cannot preview access through an active group', { skip }, async () => {
  store.setPassword('inactive@other.org', 'person-password-123', '[Read-Only Access]');
  store.setExternalAccount('staff', '[Read-Only Access]');
  store.setAccountActive('inactive@other.org', false);
  try {
    const result = await get('/tabularius/admin/v1/sso-mapping/test?database=Charts&email=inactive%40other.org&groups=staff');
    assert.deepEqual(result, { database: 'Charts', matched: false });
  } finally { store.setAccountActive('inactive@other.org', true); }
});
