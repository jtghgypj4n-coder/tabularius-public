// Synthetic OAuth/MCP conformance probes: generated hosted file, no corpus or child processes.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { createStore, type Store } from '../../store/src/index.ts';
import { ExpiryClock, expiryClock } from '../../store/src/clock.ts';
import { serve } from '../src/index.ts';

let dir: string, base: string, server: Server, store: Store;
const redirect = 'https://client.example/callback';
const encode = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
  method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: encode(fields),
});
const register = async (extra: Record<string, unknown> = {}) => {
  const response = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Synthetic client', redirect_uris: [redirect], ...extra }) });
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return (await response.json()) as { client_id: string; client_secret?: string };
};
const params = (client_id: string, challenge: string, target = redirect, resource = `${base}/mcp`) => ({
  client_id, redirect_uri: target, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 's', scope: 'mcp',
});
const hidden = (html: string) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
async function authorize(client_id: string, challenge: string, overrides: Record<string, string> = {}) {
  const p = { ...params(client_id, challenge), ...overrides };
  const page = await fetch(`${base}/oauth/authorize?${encode(p)}`, { redirect: 'manual' });
  const html = await page.text();
  const cookie = page.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { page, html, cookie, fields: hidden(html), p };
}
async function grant(client_id: string, challenge: string, overrides: Record<string, string> = {}) {
  const a = await authorize(client_id, challenge, overrides);
  assert.equal(a.page.status, 200);
  const response = await post('/oauth/authorize', { ...a.fields, database: 'Synthetic', account: 'ann', password: 'ann-pw' }, { cookie: a.cookie });
  assert.equal(response.status, 302, await response.clone().text());
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const location = response.headers.get('location')!;
  assert.equal(new URL(location).searchParams.get('state'), 's');
  return new URL(location).searchParams.get('code')!;
}
const exchange = (client_id: string, code: string, verifier: string, extra: Record<string, string> = {}) => post('/oauth/token', {
  grant_type: 'authorization_code', client_id, code, code_verifier: verifier, redirect_uri: redirect, resource: `${base}/mcp`, ...extra,
});
const refresh = (client_id: string, refresh_token: string, extra: Record<string, string> = {}) => post('/oauth/token', {
  grant_type: 'refresh_token', client_id, refresh_token, resource: `${base}/mcp`, ...extra,
});
const mcp = (access_token: string) => fetch(`${base}/mcp`, {
  method: 'POST', headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-oauth-conformance-'));
  createStore(join(dir, 'Synthetic.openhbam.sqlite'));
  const running = await serve({ dir, port: 0, watch: false, listFilesPublicly: true, log: () => {} });
  server = running.server; base = running.url; store = running.host.get('Synthetic')!;
  store.savePrivilegeSet({ name: 'Bot', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  store.setPassword('ann', 'ann-pw', 'Bot');
});
after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('discovery, registration metadata and browser approval agree with the supported flow', async () => {
  const resource = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  const metadata = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.equal(resource.resource, `${base}/mcp`);
  assert.deepEqual(resource.authorization_servers, [base]);
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(metadata.response_types_supported, ['code']);
  assert.equal(metadata.resource_indicators_supported, true);
  assert.equal(metadata.introspection_endpoint, undefined);
  const { client_id } = await register();
  const p = pkce();
  const a = await authorize(client_id, p.challenge);
  assert.equal(a.page.headers.get('x-frame-options'), 'DENY');
  assert.match(a.page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.match(a.html, /Synthetic client/);
  assert.match(a.html, /client\.example/);
  assert.ok(a.cookie && a.fields.csrf);
  const forged = await post('/oauth/authorize', { ...a.fields, database: 'Synthetic', account: 'ann', password: 'ann-pw' });
  assert.equal(forged.status, 400);
  assert.equal(forged.headers.get('location'), null);
  const code = await grant(client_id, p.challenge);
  const missing = await exchange(client_id, code, '', { code_verifier: '' });
  assert.deepEqual(await missing.json(), { error: 'invalid_grant' });
});

test('redirect spelling and state stay on the registered destination; PKCE and codes are bound', async () => {
  const { client_id } = await register();
  const p = pkce();
  for (const target of ['https://client.example/call%62ack', 'https://client.example/callback%2f', 'https://evil.example/callback']) {
    const a = await authorize(client_id, p.challenge, { redirect_uri: target });
    assert.equal(a.page.status, 400);
    assert.equal(a.page.headers.get('location'), null);
  }
  const loopback = await register({ redirect_uris: ['http://127.0.0.1:33418/call%62ack'] });
  assert.equal((await authorize(loopback.client_id, p.challenge, { redirect_uri: 'http://127.0.0.1:50000/callback' })).page.status, 400);
  assert.equal((await authorize(loopback.client_id, p.challenge, { redirect_uri: 'http://127.0.0.1:50000/call%62ack' })).page.status, 200);
  const hostile = await authorize(client_id, p.challenge, { state: 'https://evil.example/\nLocation: https://evil.example/' });
  const cancelled = await post('/oauth/authorize', { ...hostile.fields, cancel: '1' }, { cookie: hostile.cookie });
  assert.equal(new URL(cancelled.headers.get('location')!).origin, 'https://client.example');
  assert.equal(new URL(cancelled.headers.get('location')!).searchParams.get('state'), hostile.p.state);
  const plain = await authorize(client_id, p.challenge, { code_challenge_method: 'plain' });
  assert.equal(plain.page.status, 400);
  const noPkce = await authorize(client_id, p.challenge, { code_challenge: '' });
  assert.equal(noPkce.page.status, 400);
  const code = await grant(client_id, p.challenge);
  const other = await register();
  assert.deepEqual(await (await exchange(other.client_id, code, p.verifier)).json(), { error: 'invalid_grant' });
  assert.deepEqual(await (await exchange(client_id, code, p.verifier, { redirect_uri: `${redirect}?x=1` })).json(), { error: 'invalid_grant' });
  const code2 = await grant(client_id, p.challenge);
  assert.deepEqual(await (await exchange(client_id, code2, pkce().verifier)).json(), { error: 'invalid_grant' });
  const code3 = await grant(client_id, p.challenge);
  assert.equal((await exchange(client_id, code3, p.verifier)).status, 200);
  assert.deepEqual(await (await exchange(client_id, code3, p.verifier)).json(), { error: 'invalid_grant' });
});

test('resource and scope stay fixed through exchange, refresh and MCP use', async () => {
  const { client_id } = await register();
  const p = pkce();
  assert.equal((await authorize(client_id, p.challenge, { resource: 'https://other.example/mcp' })).page.status, 400);
  assert.equal((await authorize(client_id, p.challenge, { scope: 'admin' })).page.status, 400);
  const duplicate = await fetch(`${base}/oauth/authorize?${encode(params(client_id, p.challenge))}&resource=${encodeURIComponent(`${base}/mcp`)}`, { redirect: 'manual' });
  assert.equal(duplicate.status, 400);
  const code = await grant(client_id, p.challenge);
  assert.deepEqual(await (await exchange(client_id, code, p.verifier, { resource: 'https://other.example/mcp' })).json(), { error: 'invalid_target' });
  const code2 = await grant(client_id, p.challenge);
  const issued = await (await exchange(client_id, code2, p.verifier)).json() as { access_token: string; refresh_token: string; scope: string };
  assert.equal(issued.scope, 'mcp');
  assert.equal((await mcp(issued.access_token)).status, 200);
  assert.deepEqual(await (await refresh(client_id, issued.refresh_token, { scope: 'admin' })).json(), { error: 'invalid_scope' });
  const other = await register();
  assert.deepEqual(await (await refresh(other.client_id, issued.refresh_token)).json(), { error: 'invalid_grant' });
  const next = await (await refresh(client_id, issued.refresh_token)).json() as { access_token: string; refresh_token: string };
  assert.equal((await mcp(next.access_token)).status, 200);
  assert.equal((await mcp(issued.access_token)).status, 401);
  const uppercaseResource = `HTTP://${base.slice('http://'.length)}/mcp`;
  const upperCode = await grant(client_id, p.challenge, { resource: uppercaseResource });
  const upper = await exchange(client_id, upperCode, p.verifier, { resource: uppercaseResource });
  assert.equal(upper.status, 200);
  assert.equal((await mcp((await upper.json()).access_token)).status, 200);
});

test('legacy OAuth rows without a recorded audience fail closed without changing ordinary file tokens', async () => {
  const { client_id } = await register();
  const p = pkce();
  const issued = await (await exchange(client_id, await grant(client_id, p.challenge), p.verifier)).json() as { access_token: string };
  const id = /^ohbt_([0-9a-f]+)\./.exec(issued.access_token)![1];
  const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
  try {
    store.sql.prepare('UPDATE _fm_api_tokens SET provenance = ? WHERE id = ?').run('service', id);
    db.prepare('UPDATE refresh SET resource = NULL WHERE access_id = ?').run(id);
    assert.equal((await mcp(issued.access_token)).status, 401);
    const ordinary = store.createApiToken('ann', { surfaces: ['fmmcp'], provenance: 'service' });
    assert.equal((await mcp(ordinary)).status, 200);
  } finally { db.close(); }
});

test('refresh replay after the grace window revokes the live family and password changes invalidate access immediately', async (t) => {
  let now = Date.now();
  t.mock.method(expiryClock, 'now', () => now);
  const { client_id } = await register();
  const p = pkce();
  const code = await grant(client_id, p.challenge);
  const first = await (await exchange(client_id, code, p.verifier)).json() as { access_token: string; refresh_token: string };
  const second = await (await refresh(client_id, first.refresh_token)).json() as { access_token: string; refresh_token: string };
  const third = await (await refresh(client_id, second.refresh_token)).json() as { access_token: string; refresh_token: string };
  assert.equal((await mcp(third.access_token)).status, 200);
  now += 11_000;
  assert.deepEqual(await (await refresh(client_id, first.refresh_token)).json(), { error: 'invalid_grant' });
  assert.equal((await mcp(third.access_token)).status, 401);
  assert.deepEqual(await (await refresh(client_id, third.refresh_token)).json(), { error: 'invalid_grant' });
  const code2 = await grant(client_id, p.challenge);
  const fresh = await (await exchange(client_id, code2, p.verifier)).json() as { access_token: string; refresh_token: string };
  store.setPassword('ann', 'ann-pw2', 'Bot');
  assert.equal((await mcp(fresh.access_token)).status, 401);
  assert.deepEqual(await (await refresh(client_id, fresh.refresh_token)).json(), { error: 'invalid_grant' });
  store.setPassword('ann', 'ann-pw', 'Bot');
});

test('a refresh token used again within seconds is refused but keeps the sign-in (two requests racing)', async (t) => {
  let now = Date.now();
  t.mock.method(expiryClock, 'now', () => now);
  const { client_id } = await register();
  const p = pkce();
  const initial = await (await exchange(client_id, await grant(client_id, p.challenge), p.verifier)).json() as { refresh_token: string };
  const results = await Promise.all([refresh(client_id, initial.refresh_token), refresh(client_id, initial.refresh_token)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  const bodies = await Promise.all(results.map((r) => r.json())) as { access_token?: string; refresh_token?: string; error?: string }[];
  const issued = bodies.find((body) => body.access_token)!;
  assert.equal((await mcp(issued.access_token!)).status, 200, 'the winner stays signed in');
  const next = await refresh(client_id, issued.refresh_token!);
  assert.equal(next.status, 200, 'and can keep refreshing');
  // The same replay after the grace window is treated as theft.
  now += 10_001;
  assert.equal((await refresh(client_id, initial.refresh_token)).status, 400);
  assert.equal((await mcp(issued.access_token!)).status, 401);
  assert.equal((await refresh(client_id, ((await next.json()) as { refresh_token: string }).refresh_token)).status, 400);
});

test('inactive accounts and RFC 7009 revocation end the grant without revealing tokens in errors', async () => {
  const { client_id } = await register();
  const p = pkce();
  const first = await (await exchange(client_id, await grant(client_id, p.challenge), p.verifier)).json() as { access_token: string; refresh_token: string };
  store.setAccountActive('ann', false);
  assert.equal((await mcp(first.access_token)).status, 401);
  const denied = await refresh(client_id, first.refresh_token);
  const deniedText = await denied.text();
  assert.ok(!deniedText.includes(first.refresh_token));
  assert.deepEqual(JSON.parse(deniedText), { error: 'invalid_grant' });
  store.setAccountActive('ann', true);
  const second = await (await exchange(client_id, await grant(client_id, p.challenge), p.verifier)).json() as { access_token: string; refresh_token: string };
  const revoked = await post('/oauth/revoke', { client_id, token: second.refresh_token });
  assert.equal(revoked.status, 200);
  assert.equal((await mcp(second.access_token)).status, 401);
  assert.equal((await refresh(client_id, second.refresh_token)).status, 400);
});

test('registered client authentication methods are enforced at token and revoke endpoints', async () => {
  const basic = await register({ token_endpoint_auth_method: 'client_secret_basic' });
  const p = pkce();
  const code = await grant(basic.client_id, p.challenge);
  const fields = { grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: redirect, resource: `${base}/mcp` };
  assert.equal((await post('/oauth/token', { ...fields, client_id: basic.client_id, client_secret: basic.client_secret! })).status, 401);
  const nextCode = await grant(basic.client_id, p.challenge);
  const credentials = Buffer.from(`${basic.client_id}:${basic.client_secret}`).toString('base64');
  const token = await post('/oauth/token', { ...fields, code: nextCode }, { authorization: `Basic ${credentials}` });
  assert.equal(token.status, 200);
  const issued = await token.json() as { refresh_token: string };
  assert.equal((await post('/oauth/revoke', { token: issued.refresh_token, client_id: basic.client_id, client_secret: basic.client_secret! })).status, 401);
  assert.equal((await post('/oauth/revoke', { token: issued.refresh_token }, { authorization: `Basic ${credentials}` })).status, 200);
});

test('code and refresh deadlines use the rollback-safe clock', async (t) => {
  let wall = 1_000_000, monotonic = 0;
  const clock = new ExpiryClock(() => wall, () => monotonic, () => {});
  wall -= 60_000; monotonic += 2_000;
  assert.equal(clock.now(), 1_002_000, 'a backward wall-clock edit cannot extend a grant');
  let now = Date.now();
  t.mock.method(expiryClock, 'now', () => now);
  const { client_id } = await register();
  const p = pkce();
  const oldCode = await grant(client_id, p.challenge);
  now += 60_001;
  assert.deepEqual(await (await exchange(client_id, oldCode, p.verifier)).json(), { error: 'invalid_grant' });
  const freshCode = await grant(client_id, p.challenge);
  const issued = await (await exchange(client_id, freshCode, p.verifier)).json() as { access_token: string; refresh_token: string };
  assert.equal((await mcp(issued.access_token)).status, 200);
  now += 30 * 24 * 60 * 60 * 1000 + 1;
  assert.deepEqual(await (await refresh(client_id, issued.refresh_token)).json(), { error: 'invalid_grant' });
  assert.equal((await mcp(issued.access_token)).status, 401);
});

test('the replay ledger is trimmed per sign-in and never makes refresh fail', async () => {
  const { client_id } = await register();
  const p = pkce();
  const issued = await (await exchange(client_id, await grant(client_id, p.challenge), p.verifier)).json() as { access_token: string; refresh_token: string };
  const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
  try {
    const existing = (db.prepare('SELECT COUNT(*) AS n FROM spent_refresh').get() as { n: number }).n;
    db.prepare(`WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < ?)
      INSERT INTO spent_refresh (hash, client_id, family, expires) SELECT printf('synthetic-cap-%06d', n), 'synthetic', 'synthetic', ? FROM sequence`).run(100_000 - existing, Date.now() + 60_000);
    // A full list evicts its oldest rows instead of refusing the user.
    let current = issued.refresh_token;
    for (let i = 0; i < 25; i++) {
      const response = await refresh(client_id, current);
      assert.equal(response.status, 200);
      current = ((await response.json()) as { refresh_token: string }).refresh_token;
    }
    assert.ok((db.prepare('SELECT COUNT(*) AS n FROM spent_refresh').get() as { n: number }).n <= 100_000);
    const family = (db.prepare('SELECT family, COUNT(*) AS n FROM spent_refresh WHERE client_id = ? GROUP BY family').get(client_id) as { family: string; n: number });
    assert.equal(family.n, 20, 'one sign-in keeps only its newest twenty spent tokens');
  } finally {
    db.exec("DELETE FROM spent_refresh WHERE hash LIKE 'synthetic-cap-%'");
    db.close();
  }
});

test('password accounts keep a sliding refresh window while federated accounts keep their fixed deadline', async (t) => {
  let now = Date.now();
  t.mock.method(expiryClock, 'now', () => now);
  const { client_id } = await register();
  const p = pkce();
  let current = ((await (await exchange(client_id, await grant(client_id, p.challenge), p.verifier)).json()) as { refresh_token: string }).refresh_token;
  for (let i = 0; i < 3; i++) {
    now += 20 * 24 * 60 * 60 * 1000;
    const response = await refresh(client_id, current);
    assert.equal(response.status, 200, `refresh ${i + 1} sixty days after the first sign-in`);
    current = ((await response.json()) as { refresh_token: string }).refresh_token;
  }
});

