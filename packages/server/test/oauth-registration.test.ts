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

test('registration refuses keys that would be fetched, ignores display addresses and caps persisted clients', async () => {
  const send = (metadata: Record<string, unknown>) => fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirect], ...metadata }) });
  for (const key of ['jwks_uri', 'sector_identifier_uri', 'request_uris', 'jwks']) {
    const response = await send({ [key]: key === 'jwks' ? { keys: [] } : 'http://127.0.0.1:9/private' });
    assert.equal(response.status, 400, key);
    assert.equal((await response.json()).error, 'invalid_client_metadata');
  }
  for (const key of ['logo_uri', 'client_uri', 'tos_uri', 'policy_uri']) {
    const response = await send({ [key]: 'https://client.example/about' });
    assert.equal(response.status, 201, `${key} is ignored, not refused`);
    assert.equal(JSON.stringify(await response.json()).includes('client.example/about'), false, `${key} is neither stored nor shown`);
  }
  assert.equal((await send({ grant_types: ['authorization_code'] })).status, 201, 'the code grant alone is accepted');
  assert.equal((await send({ grant_types: ['refresh_token'] })).status, 400);
  assert.equal((await send({ grant_types: ['authorization_code', 'implicit'] })).status, 400);
  assert.equal((await send({ response_types: [] })).status, 400);
  const named = await send({ client_name: '\u202eAdmin\u202c' });
  assert.equal(named.status, 201);
  assert.equal((await named.json()).client_name, 'Admin');
  const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
  try {
    // All rows are used, so registration cannot evict one to make room.
    db.exec('DELETE FROM clients');
    const insert = db.prepare('INSERT INTO clients (id, name, redirect_uris, created, used) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 500; i++) insert.run(`synthetic-${i}`, 'Synthetic', JSON.stringify([redirect]), Date.now(), Date.now());
    const response = await send({});
    assert.equal(response.status, 429);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number }).n, 500);
    insert.run('synthetic-unused', 'Synthetic', JSON.stringify([redirect]), Date.now(), null);
    const again = await send({});
    assert.equal(again.status, 429);
    assert.ok(db.prepare('SELECT 1 FROM clients WHERE id = ?').get('synthetic-unused'), 'a refused registration rolls back any proposed eviction');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number }).n, 501);
  } finally { db.exec('DELETE FROM clients'); db.close(); }
});

test('token endpoint accepts the common client spellings that are unambiguous', async () => {
  const basic = await register({ token_endpoint_auth_method: 'client_secret_basic' });
  const p = pkce();
  const credentials = Buffer.from(`${basic.client_id}:${basic.client_secret}`).toString('base64');
  const fields = (code: string) => ({ grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: redirect, resource: `${base}/mcp` });
  // Basic header plus the same client_id in the body.
  assert.equal((await post('/oauth/token', { ...fields(await grant(basic.client_id, p.challenge)), client_id: basic.client_id }, { authorization: `Basic ${credentials}` })).status, 200);
  // A different client_id in the body, or a body secret next to the header, is still refused.
  assert.equal((await post('/oauth/token', { ...fields(await grant(basic.client_id, p.challenge)), client_id: 'someone-else' }, { authorization: `Basic ${credentials}` })).status, 401);
  assert.equal((await post('/oauth/token', { ...fields(await grant(basic.client_id, p.challenge)), client_secret: basic.client_secret! }, { authorization: `Basic ${credentials}` })).status, 401);
  // A public client may send an empty client_secret.
  const open = await register();
  const code = await grant(open.client_id, p.challenge);
  assert.equal((await exchange(open.client_id, code, p.verifier, { client_secret: '' })).status, 200);
  // redirect_uri may be left out when the app registered exactly one.
  const omitted = await grant(open.client_id, p.challenge);
  assert.equal((await post('/oauth/token', { grant_type: 'authorization_code', client_id: open.client_id, code: omitted, code_verifier: p.verifier, resource: `${base}/mcp` })).status, 200);
  const two = await register({ redirect_uris: [redirect, 'https://client.example/other'] });
  const ambiguous = await grant(two.client_id, p.challenge);
  assert.equal((await post('/oauth/token', { grant_type: 'authorization_code', client_id: two.client_id, code: ambiguous, code_verifier: p.verifier, resource: `${base}/mcp` })).status, 400);
});

test('the resource may be written as the server address with or without a path slash', async () => {
  const { client_id } = await register();
  const p = pkce();
  for (const resource of [base, `${base}/`, `${base}/mcp/`]) {
    const code = await grant(client_id, p.challenge, { resource });
    const issued = await exchange(client_id, code, p.verifier, { resource });
    assert.equal(issued.status, 200, resource);
    assert.equal((await mcp(((await issued.json()) as { access_token: string }).access_token)).status, 200);
  }
  assert.equal((await authorize(client_id, p.challenge, { resource: `${base}/mcp/extra` })).page.status, 400);
});

test('registrations from one IPv6 /64 share a rate-limit bucket however the address is written', async () => {
  const { ipv6Prefix } = await import('../src/oauth.ts');
  const bucket = ipv6Prefix('2001:db8::5');
  assert.equal(bucket, '2001:db8:0:0');
  for (const same of ['2001:db8::6', '2001:0db8:0:0:0:0:0:1', '2001:DB8:0:0::ffff', '2001:db8::1%eth0']) assert.equal(ipv6Prefix(same), bucket, same);
  assert.notEqual(ipv6Prefix('2001:db8:0:1::5'), bucket);
  assert.equal(ipv6Prefix('::1'), '0:0:0:0');
});
