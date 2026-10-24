// Synthetic stores only. No child processes, external HTTP, or fixture imports.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Host, serve } from '../src/index.ts';
import { expiryClock } from '../../store/src/clock.ts';
import { MCP_TOKENS_FILE, McpTokens } from '../src/mcp-tokens.ts';
import { ScimDirectory } from '../src/scim.ts';
import { createFeed, revokeFeed } from '../src/calendar.ts';
import { redactPath } from '../src/server-logs.ts';
import { makeAuthenticator, forgeRegistration, forgeAssertion } from '../../store/test/forge-webauthn.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'link-lifetimes-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Synthetic');
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.setPassword('Alice', 'pw', '[Full Access]');
  let now = Date.now();
  t.mock.method(expiryClock, 'now', () => now);
  t.after(() => { host.close(); rmSync(dir, { recursive: true, force: true }); });
  return { host, store, dir, advance: (ms: number) => { now += ms; } };
}

for (const ttl of ['0', '-1', 'NaN', 'Infinity', '999999', '2']) {
  test(`signed links enforce a finite deadline with TTL=${ttl}`, (t) => {
    const previous = process.env.TABULARIUS_CONTAINER_TTL;
    process.env.TABULARIUS_CONTAINER_TTL = ttl;
    t.after(() => { if (previous === undefined) delete process.env.TABULARIUS_CONTAINER_TTL; else process.env.TABULARIUS_CONTAINER_TTL = previous; });
    const { host, store, advance } = setup(t);
    const params = new URLSearchParams(host.signed(store.name, 1, '', store.linkPrincipal('Alice')));
    assert.ok(host.checkUrl(store.name, 1, params));
    advance(ttl === '2' ? 2000 : 3600_000);
    assert.equal(host.checkUrl(store.name, 1, params), false);
    for (const exp of [0, NaN, Infinity, -1]) {
      assert.equal(host.checkSignature(store.name, 1, host.sign(store.name, 1, '', exp), '', exp), false);
    }
  });
}

test('a shortened TTL applies to new links; existing links keep their signed deadline', (t) => {
  const { host, store, dir, advance } = setup(t);
  const old = new URLSearchParams(host.signed(store.name, 1));
  const previous = process.env.TABULARIUS_CONTAINER_TTL;
  process.env.TABULARIUS_CONTAINER_TTL = '1';
  const shorter = new Host(dir, () => {}, { background: false });
  if (previous === undefined) delete process.env.TABULARIUS_CONTAINER_TTL; else process.env.TABULARIUS_CONTAINER_TTL = previous;
  t.after(() => shorter.close());
  const fresh = new URLSearchParams(shorter.signed(store.name, 1));
  advance(1000);
  assert.equal(shorter.checkUrl(store.name, 1, fresh), false);
  assert.ok(host.checkUrl(store.name, 1, old));
});

test('a fractional TTL shortens links (to one second at least) instead of lengthening them', (t) => {
  const previous = process.env.TABULARIUS_CONTAINER_TTL;
  process.env.TABULARIUS_CONTAINER_TTL = '0.5';
  t.after(() => { if (previous === undefined) delete process.env.TABULARIUS_CONTAINER_TTL; else process.env.TABULARIUS_CONTAINER_TTL = previous; });
  const { host, store, advance } = setup(t);
  const params = new URLSearchParams(host.signed(store.name, 1));
  assert.ok(host.checkUrl(store.name, 1, params), 'valid when issued');
  advance(1000);
  assert.equal(host.checkUrl(store.name, 1, params), false, 'gone within a second or so, not an hour');
});

test('a link with no usable expiry or signature is refused before any account is looked up', (t) => {
  const { host, store } = setup(t);
  let lookups = 0;
  const original = store.linkIdentity.bind(store);
  store.linkIdentity = (name) => { lookups++; return original(name); };
  for (const query of ['as=Alice&sig=x', 'as=Alice&sig=x&exp=0', 'as=Alice&sig=x&exp=1', 'as=Alice&exp=9999999999']) {
    assert.equal(host.checkUrl(store.name, 1, new URLSearchParams(query)), false, query);
  }
  assert.equal(lookups, 0);
});

test('the account fingerprint is reused until security changes, and not after', (t) => {
  const { store } = setup(t);
  store.linkPrincipal('Alice');
  const first = store.linkIdentity('Alice')!.identity;
  assert.equal(store.linkIdentity('Alice')!.identity, first);
  store.savePrivilegeSet({ ...store.privilegeSet('[Full Access]')!, extendedPrivileges: [...store.privilegeSet('[Full Access]')!.extendedPrivileges, 'fmmcp'] });
  assert.notEqual(store.linkIdentity('Alice')!.identity, first, 'editing the assigned set changes it');
});

test('legacy MCP tokens the server will refuse are marked for reissue, and do not count as a connected AI app', (t) => {
  const { store, dir } = setup(t);
  const resolver = (_db: string, account: string) => store.identityAllowed(account) ? store.credentialIdentity(account) : undefined;
  const bound = new McpTokens(dir, undefined, resolver);
  const old = new McpTokens(dir).create({ database: store.name, account: 'Alice' });
  const good = bound.create({ database: store.name, account: 'Alice' });
  const rows = bound.list();
  assert.equal(rows.find((r) => r.id === old.id)?.needsReissue, true);
  assert.equal(rows.find((r) => r.id === good.id)?.needsReissue, undefined);
  assert.equal(new McpTokens(dir).list().some((r) => r.needsReissue), false, 'without the server\'s resolver nothing is marked');
});

test('a link signed for a deadline beyond the longest lifetime is refused, even with a valid signature', (t) => {
  const { host, store } = setup(t);
  const who = store.linkPrincipal('Alice');
  const far = Math.floor((expiryClock.now() + 30 * 86400_000) / 1000);
  const params = new URLSearchParams({ sig: host.sign(store.name, 1, '', far, who), exp: String(far), as: 'Alice' });
  assert.equal(host.checkUrl(store.name, 1, params), false, 'a signed deadline thirty days away');
  assert.equal(host.checkSignature(store.name, 1, host.sign(store.name, 1, '', far), '', far), false);
  const edge = Math.floor((expiryClock.now() + 3600_000) / 1000);
  assert.ok(host.checkSignature(store.name, 1, host.sign(store.name, 1, '', edge), '', edge), 'an hour is the most a link is made for');
});

test('a new password ends the links and AI-app tokens made before it', (t) => {
  const { host, store, dir } = setup(t);
  const tokens = new McpTokens(dir, undefined, (_db, account) => store.identityAllowed(account) ? store.credentialIdentity(account) : undefined);
  const link = new URLSearchParams(host.signed(store.name, 1, '', store.linkPrincipal('Alice')));
  const token = tokens.create({ database: store.name, account: 'Alice' });
  assert.ok(host.checkUrl(store.name, 1, link));
  assert.ok(tokens.check(token.token));
  store.setPassword('Alice', 'a-new-password', '[Full Access]');
  assert.equal(host.checkUrl(store.name, 1, link), false);
  assert.equal(tokens.check(token.token), undefined);
  assert.equal(tokens.list().find((row) => row.id === token.id)?.needsReissue, true);
  assert.ok(host.checkUrl(store.name, 1, new URLSearchParams(host.signed(store.name, 1, '', store.linkPrincipal('Alice')))), 'a link made after the change works');
  assert.ok(tokens.check(tokens.create({ database: store.name, account: 'Alice' }).token));
});

test('an AI-app token always expires: no lifetime asked takes the default, and none or a longer one is refused', (t) => {
  const { store, dir, advance } = setup(t);
  const tokens = new McpTokens(dir, undefined, (_db, account) => store.credentialIdentity(account));
  const made = tokens.create({ database: store.name, account: 'Alice' });
  assert.ok(made.expires, 'the default lifetime is applied');
  assert.ok(tokens.check(made.token));
  advance(91 * 86400_000);
  assert.equal(tokens.check(made.token), undefined);
  for (const days of [0, -1, 3651, NaN]) assert.throws(() => tokens.create({ database: store.name, account: 'Alice', days }), /expires|Days/, String(days));
  // A token kept from before every one had an expiry is refused and shown as needing to be made again.
  const fresh = tokens.create({ database: store.name, account: 'Alice' });
  const kept = JSON.parse(readFileSync(join(dir, MCP_TOKENS_FILE), 'utf8')) as Record<string, unknown>[];
  for (const row of kept) if (row.id === fresh.id) delete row.expires;
  writeFileSync(join(dir, MCP_TOKENS_FILE), JSON.stringify(kept));
  assert.equal(tokens.check(fresh.token), undefined);
  assert.equal(tokens.list().find((row) => row.id === fresh.id)?.needsReissue, true);
});

for (const kind of ['', 'image']) {
  test(`${kind || 'container/thumbnail'} links refuse disabled, replaced and privilege-reduced accounts`, (t) => {
    const { host, store } = setup(t);
    const make = () => new URLSearchParams(host.signed(store.name, 1, kind, store.linkPrincipal('Alice')));
    const good = (params: URLSearchParams) => host.checkUrl(store.name, 1, params, kind);
    const initial = make();
    assert.ok(good(initial));
    store.setAccountActive('Alice', false);
    assert.equal(good(initial), false);
    store.setAccountActive('Alice', true);
    store.savePrivilegeSet({ name: 'Limited', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
    store.setAccountPrivilegeSet('Alice', 'Limited');
    assert.equal(good(initial), false);
    const limited = make();
    assert.ok(good(limited));
    store.savePrivilegeSet({ ...store.privilegeSet('Limited')!, layouts: 'none' });
    assert.equal(good(limited), false);
    const deleted = make();
    store.deleteAccount('Alice');
    assert.equal(good(deleted), false);
    store.setPassword('Alice', 'pw', 'Limited');
    assert.equal(good(deleted), false);
    assert.ok(good(make()));
  });
}

test('legacy MCP tokens refuse expiry, revocation, disabled/replaced accounts and unbound legacy records', (t) => {
  const { store, dir, advance } = setup(t);
  const tokens = new McpTokens(dir, undefined, (_db, account) => store.identityAllowed(account) ? store.credentialIdentity(account) : undefined);
  const make = () => tokens.create({ database: store.name, account: 'Alice', days: 1 / 86400 });
  const expired = make();
  assert.ok(tokens.check(expired.token));
  advance(1000);
  assert.equal(tokens.check(expired.token), undefined);
  const revoked = make();
  tokens.revoke(revoked.id);
  assert.equal(tokens.check(revoked.token), undefined);
  const old = make();
  store.setAccountActive('Alice', false);
  assert.equal(tokens.check(old.token), undefined);
  store.setAccountActive('Alice', true);
  store.deleteAccount('Alice');
  store.setPassword('Alice', 'pw', '[Full Access]');
  assert.equal(tokens.check(old.token), undefined);
  const unbound = new McpTokens(dir).create({ database: store.name, account: 'Alice' });
  assert.equal(new McpTokens(dir, undefined, (_db, name) => store.credentialIdentity(name)).check(unbound.token), undefined);
});

for (const failure of ['expiry', 'disabled', 'deleted', 'unbound', 'replay']) {
  test(`passkey registration rejects ${failure}`, (t) => {
    const { store, advance } = setup(t);
    const rpId = 'example.test', origin = 'https://example.test';
    const authenticator = makeAuthenticator(rpId, origin);
    const challenge = store.issueWebauthnChallenge('register', failure === 'unbound' ? undefined : 'Alice');
    const response = forgeRegistration(authenticator, challenge);
    const register = () => store.registerPasskey('Alice', response, { rpId, origin, challenge });
    if (failure === 'expiry') advance(300_000);
    if (failure === 'disabled') store.setAccountActive('Alice', false);
    if (failure === 'deleted') { store.deleteAccount('Alice'); store.setPassword('Alice', 'pw', '[Full Access]'); }
    if (failure === 'replay') register();
    assert.throws(register);
  });
}

test('passkey assertions refuse expiry, disabled accounts, removed credentials and reuse', (t) => {
  const { store, advance } = setup(t);
  const rpId = 'example.test', origin = 'https://example.test';
  const auth = makeAuthenticator(rpId, origin);
  const reg = store.issueWebauthnChallenge('register', 'Alice');
  const { id } = store.registerPasskey('Alice', forgeRegistration(auth, reg), { rpId, origin, challenge: reg });
  const assertion = () => { const challenge = store.issueWebauthnChallenge('auth'); return () => store.verifyPasskeyAssertion(forgeAssertion(auth, challenge, 1), { rpId, origin, challenge }); };
  const expired = assertion(); advance(300_000); assert.throws(expired);
  const disabled = assertion(); store.setAccountActive('Alice', false); assert.throws(disabled);
  store.setAccountActive('Alice', true);
  const once = assertion(); assert.equal(once(), 'Alice'); assert.throws(once);
  const revoked = assertion(); store.removePasskey(id); assert.throws(revoked);
});

test('calendar and API tokens enforce expiry, revoke, disable and account deletion', (t) => {
  const { store, advance } = setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Day', type: 'date' }] }]);
  const make = () => createFeed(store, 'Alice', store.privileges('Alice'), { layout: 'Events', start: 'Day', expiresDays: 1 / 86400 });
  const secret = (feed: ReturnType<typeof make>) => new URL(feed.address, 'https://example.test').searchParams.get('token')!;
  const expired = make(); assert.ok(store.apiToken(secret(expired))); advance(1000); assert.equal(store.apiToken(secret(expired)), undefined);
  const revoked = make(); assert.ok(revokeFeed(store, revoked.id)); assert.equal(store.apiToken(secret(revoked)), undefined);
  const disabled = make(); store.setAccountActive('Alice', false); assert.equal(store.apiToken(secret(disabled)), undefined);
  store.setAccountActive('Alice', true); store.deleteAccount('Alice'); store.setPassword('Alice', 'pw', '[Full Access]');
  assert.equal(store.apiToken(secret(disabled)), undefined);
});

test('SCIM service credentials rotate, expire and revoke; account disable is not their scope', (t) => {
  const { store, advance } = setup(t);
  const scim = new ScimDirectory(store);
  const first = scim.issueToken(); assert.ok(scim.tokenValid(first));
  advance(89 * 86400_000);
  store.setAccountActive('Alice', false);
  assert.ok(scim.tokenValid(first), 'current policy: the file service token has no account binding, but it expires');
  advance(2 * 86400_000);
  assert.equal(scim.tokenValid(first), false, 'after its 90 days');
  const second = scim.issueToken(); assert.equal(scim.tokenValid(first), false);
  assert.ok(scim.tokenValid(second)); scim.revokeToken(); assert.equal(scim.tokenValid(second), false);
});

test('log paths drop the whole query string, so signed links and header-style secrets never reach a log', () => {
  const keys = ['token', 'access_token', 'refresh_token', 'id_token', 'client_secret', 'code', 'state', 'sig', 'challenge', 'identifier'];
  for (const key of keys) assert.equal(redactPath(`/path?${key}=synthetic-secret&other=1`), '/path');
});

test('HTTP image issuance binds the account; bearer responses prevent referrer and cache leakage', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'link-http-'));
  const running = await serve({ dir, port: 0, watch: false, log: () => {} });
  t.after(async () => { await new Promise<void>((resolve) => running.server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); });
  const store = running.host.create('Synthetic'); store.setPassword('Admin', 'pw', '[Full Access]'); store.setPassword('Alice', 'pw', '[Full Access]');
  // A generated one-pixel PNG stays on the in-process thumbnail path.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64');
  const imageId = store.addImage('pixel.png', 'image/png', png);
  let now = Date.now(); t.mock.method(expiryClock, 'now', () => now);
  store.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'File', type: 'container' }] }]);
  store.applyDesign([{ op: 'updateLayout', layout: 'Docs', design: { objects: [...store.design('Docs')!.objects, { id: 900, kind: 'image', type: 0, imageId, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, bounds: { top: 0, left: 0, bottom: 20, right: 20 } }], tableView: [] } }] as never);
  const record = Number(store.create('Docs', {}).recordId);
  store.setContainer('Docs', record, 'File', 1, { filename: 'pixel.png', mime: 'image/png', data: png });
  const login = await fetch(`${running.url}/fmi/data/vLatest/databases/Synthetic/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Alice:pw') }, body: '{}' });
  const headers = { authorization: `Bearer ${(await login.json()).response.token}` };
  const imageResponse = await fetch(`${running.url}/tabularius/design/v1/databases/Synthetic/images`, { headers });
  const imageUrl = (await imageResponse.json()).images[0].url;
  assert.match(imageUrl, /[?&]as=Alice/);
  const read = await fetch(`${running.url}/fmi/data/vLatest/databases/Synthetic/layouts/Docs/records/${record}`, { headers });
  const container = (await read.json()).response.data[0].fieldData.File;
  const layout = await (await fetch(`${running.url}/tabularius/app/v1/databases/Synthetic/layouts/Docs`, { headers })).json();
  const layoutImage = layout.images[imageId];
  assert.match(layoutImage, /[?&]as=Alice/);
  const links = [new URL(imageUrl, running.url).href, new URL(layoutImage, running.url).href, container, container + '&thumb=16'];
  for (const link of links) {
    const response = await fetch(link); await response.arrayBuffer();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  store.setAccountActive('Alice', false);
  for (const link of links) { const response = await fetch(link); assert.equal(response.status, 404); assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); }
  store.setAccountActive('Alice', true); now += 3600_000;
  for (const link of links) assert.equal((await fetch(link)).status, 404);
});

// No provider calls: exercise the server's local OAuth issuer with synthetic PKCE.
test('OAuth codes/access/refresh refuse exact expiry, reuse, revocation and disabled accounts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'link-oauth-'));
  const running = await serve({ dir, port: 0, watch: false, log: () => {} });
  t.after(async () => { await new Promise<void>((resolve) => running.server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); });
  const store = running.host.create('Synthetic'); store.setPassword('Admin', 'pw', '[Full Access]'); store.setPassword('Alice', 'pw', '[Full Access]'); store.setAiPolicy(false);
  let now = Date.now(); t.mock.method(expiryClock, 'now', () => now);
  const redirect = 'https://example.test/callback';
  const post = (path: string, body: Record<string, string>) => fetch(running.url + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), redirect: 'manual' });
  const registration = await fetch(running.url + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Synthetic', redirect_uris: [redirect] }) });
  assert.equal(registration.status, 201); const { client_id } = await registration.json();
  const verifier = 'a'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
  const code = async () => {
    // The sign-in page comes first: its anti-forgery cookie and hidden fields go back with the person's "Allow".
    const params = { client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', database: store.name };
    const page = await fetch(running.url + '/oauth/authorize?' + new URLSearchParams(params));
    assert.equal(page.status, 200);
    const cookie = page.headers.get('set-cookie')?.split(';')[0] ?? '';
    const fields = Object.fromEntries([...(await page.text()).matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
    const response = await fetch(running.url + '/oauth/authorize', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ ...fields, database: store.name, account: 'Alice', password: 'pw' }) });
    assert.equal(response.status, 302, await response.clone().text());
    return new URL(response.headers.get('location')!).searchParams.get('code')!;
  };
  const exchange = (code: string) => post('/oauth/token', { grant_type: 'authorization_code', client_id, redirect_uri: redirect, code, code_verifier: verifier });
  const refresh = (refresh_token: string) => post('/oauth/token', { grant_type: 'refresh_token', client_id, refresh_token });
  const expired = await code(); now += 60_000; assert.equal((await exchange(expired)).status, 400);
  const disabled = await code(); store.setAccountActive('Alice', false); assert.equal((await exchange(disabled)).status, 400); store.setAccountActive('Alice', true);
  const one = await code(); const grant = await exchange(one); assert.equal(grant.status, 200); assert.equal((await exchange(one)).status, 400);
  const access = await grant.json(); assert.ok(store.apiToken(access.access_token)); now += access.expires_in * 1000; assert.equal(store.apiToken(access.access_token), undefined);
  const rotated = await refresh(access.refresh_token); assert.equal(rotated.status, 200); assert.equal((await refresh(access.refresh_token)).status, 400);
  const next = await rotated.json(); store.revokeApiToken(store.apiTokens().find((entry) => next.access_token.startsWith(`ohbt_${entry.id}.`))!.id);
  assert.equal((await refresh(next.refresh_token)).status, 400);
  const blocked = await (await exchange(await code())).json(); store.setAccountActive('Alice', false);
  assert.equal(store.apiToken(blocked.access_token), undefined); assert.equal((await refresh(blocked.refresh_token)).status, 400); store.setAccountActive('Alice', true);
  const old = await (await exchange(await code())).json(); now += 30 * 86400_000; assert.equal((await refresh(old.refresh_token)).status, 400);
});

test('exports, reports and handover downloads require a live credential on every request', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'link-downloads-'));
  const running = await serve({ dir, port: 0, watch: false, log: () => {} });
  t.after(async () => { await new Promise<void>((resolve) => running.server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); });
  const store = running.host.create('Synthetic');
  store.setPassword('Admin', 'pw', '[Full Access]'); store.setPassword('Alice', 'pw', '[Full Access]');
  store.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'Title' }] }]);
  store.create('Docs', { Title: 'Synthetic' });
  let now = Date.now(); t.mock.method(expiryClock, 'now', () => now);
  const endpoints = [
    { path: '/tabularius/app/v1/databases/Synthetic/layouts/Docs/export', body: { fields: ['Title'] } },
    { path: '/tabularius/design/v1/databases/Synthetic/ddr' },
    { path: '/tabularius/assistant/v1/databases/Synthetic/handover', body: { memo: 'Synthetic memo' } },
  ];
  const request = (endpoint: typeof endpoints[number], token?: string) => fetch(running.url + endpoint.path, {
    method: endpoint.body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(endpoint.body ? { body: JSON.stringify(endpoint.body) } : {}),
  });
  const make = () => store.createApiToken('Alice', { expires: new Date(now + 1000) });
  const assertDenied = async (token?: string) => {
    for (const endpoint of endpoints) { const res = await request(endpoint, token); assert.ok([401, 403].includes(res.status), `${endpoint.path}: ${res.status}`); assert.ok(!(await res.text()).includes(token ?? 'no-token-sentinel')); }
  };
  const initial = make();
  for (const endpoint of endpoints) { const res = await request(endpoint, initial); assert.equal(res.status, 200, await res.clone().text()); assert.equal(res.headers.get('referrer-policy'), 'no-referrer'); await res.arrayBuffer(); }
  await assertDenied(); now += 1000; await assertDenied(initial);
  const revoked = make(); store.revokeApiToken(store.apiTokens().find((entry) => revoked.startsWith(`ohbt_${entry.id}.`))!.id); await assertDenied(revoked);
  const disabled = make(); store.setAccountActive('Alice', false); await assertDenied(disabled);
});
