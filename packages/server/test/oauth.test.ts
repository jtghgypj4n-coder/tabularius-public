// Remote AI apps (claude.ai and Claude Desktop connectors) signing in at /mcp with OAuth 2.1: discovery from the 401,
// dynamic registration, the sign-in page with a file's own account, PKCE, refresh, revoking, and every refusal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Store } from '../../store/src/index.ts';
import { totpCode } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { expiryClock, ExpiryClock } from '../../store/src/clock.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;
let host: import('../src/host.ts').Host;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-oauth-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, listFilesPublicly: true });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  host = s.host;
  store.savePrivilegeSet({ name: 'Bot', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  store.savePrivilegeSet({ name: 'NoAi', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('ann', 'ann-pw', 'Bot');
  store.setPassword('nora', 'nora-pw', 'NoAi');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const post = (path: string, body: string, type = 'application/x-www-form-urlencoded', headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': type, ...headers }, body, redirect: 'manual' });
const mcp = (bearer?: string) => fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_databases', arguments: {} } }),
});

async function register(extra: Record<string, unknown> = {}): Promise<{ client_id: string; client_secret?: string }> {
  const r = await post('/oauth/register', JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], ...extra }), 'application/json');
  assert.equal(r.status, 201, await r.clone().text());
  return r.json();
}

/** Signs in on the authorize page as a browser would; returns the redirect (or the page when it stays). */
async function signIn(client: string, challenge: string, fields: Record<string, string>, state = 'xyz'): Promise<Response> {
  const query = { client_id: client, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state, resource: `${base}/mcp` };
  const page = await fetch(`${base}/oauth/authorize?${form(query)}`, { redirect: 'manual' });
  const html = await page.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
  return post('/oauth/authorize', form({ ...query, csrf, database: 'Charts', ...fields }), 'application/x-www-form-urlencoded', { cookie: page.headers.get('set-cookie')?.split(';')[0] ?? '' });
}

async function connect(account = 'ann', password = 'ann-pw') {
  const { client_id } = await register();
  const { verifier, challenge } = pkce();
  const r = await signIn(client_id, challenge, { account, password });
  assert.equal(r.status, 302, await r.text());
  const code = new URL(r.headers.get('location')!).searchParams.get('code')!;
  const t = await post('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT }));
  assert.equal(t.status, 200);
  return { client_id, ...(await t.json()) as { access_token: string; refresh_token: string; expires_in: number } };
}

test('OAuth codes, access and refresh tokens issued during rollback retain their lifetimes', { skip }, async (t) => {
  let wall = Date.now(), mono = performance.now();
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  const clock = new ExpiryClock();
  t.mock.method(expiryClock, 'now', () => clock.now());
  wall -= 3600_000;
  const tokens = await connect();
  assert.ok(store.apiToken(tokens.access_token));
  wall += 3600_000 - 1; mono += 3600_000 - 1;
  assert.ok(store.apiToken(tokens.access_token));
  wall++; mono++;
  assert.equal(store.apiToken(tokens.access_token), undefined);
  const response = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: tokens.client_id }));
  assert.equal(response.status, 200);
  assert.ok(store.apiToken((await response.json()).access_token));
  // Avoid affecting tests that inspect the first token with this app's label.
  for (const token of store.apiTokens()) store.revokeApiToken(token.id);
});

test('an app finds the sign-in from the 401 at /mcp', { skip }, async () => {
  // A loopback client without a token is the administrator; a token is what a remote app shows.
  const r = await mcp('ohbt_ffff.nope');
  assert.equal(r.status, 401);
  const challenge = r.headers.get('www-authenticate')!;
  assert.match(challenge, /^Bearer error="invalid_token", resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp", Basic realm="tabularius"$/);
  const resource = await (await fetch(/resource_metadata="([^"]+)"/.exec(challenge)![1])).json();
  assert.equal(resource.resource, `${base}/mcp`);
  const meta = await (await fetch(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
  assert.equal(meta.issuer, base);
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  assert.equal(meta.registration_endpoint, `${base}/oauth/register`);
});

test('register, sign in with the file\'s account, and call tools under its privilege set', { skip }, async () => {
  const { client_id } = await register();
  const { verifier, challenge } = pkce();
  const page = await fetch(`${base}/oauth/authorize?${form({ client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's1' })}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  const html = await page.text();
  assert.match(html, /<strong>Claude<\/strong> wants to use Tabularius/);
  assert.match(html, /sent back to <strong>claude\.ai<\/strong>/);
  assert.match(html, /<option selected>Charts<\/option>/);

  const r = await signIn(client_id, challenge, { account: 'ANN', password: 'ann-pw' }, 's1');
  assert.equal(r.status, 302);
  const back = new URL(r.headers.get('location')!);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get('state'), 's1');
  assert.equal(back.searchParams.get('iss'), base);
  const code = back.searchParams.get('code')!;

  // The wrong verifier, then the right one; the code works once.
  const wrong = await post('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: pkce().verifier, client_id }));
  assert.equal((await wrong.json()).error, 'invalid_grant');
  const { verifier: v2, challenge: c2 } = pkce();
  const r2 = await signIn(client_id, c2, { account: 'ann', password: 'ann-pw' });
  const code2 = new URL(r2.headers.get('location')!).searchParams.get('code')!;
  const t = await post('/oauth/token', form({ grant_type: 'authorization_code', code: code2, code_verifier: v2, client_id, redirect_uri: REDIRECT }));
  const tokens = await t.json();
  assert.equal(t.headers.get('cache-control'), 'no-store');
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.expires_in, 3600);
  assert.match(tokens.access_token, /^ohbt_/);
  const again = await post('/oauth/token', form({ grant_type: 'authorization_code', code: code2, code_verifier: v2, client_id }));
  assert.equal((await again.json()).error, 'invalid_grant');
  void verifier;

  // The access token is the file's API token for ann, AI apps only, listed in Manage Security.
  const listed = store.apiTokens().find((x) => x.label === 'AI app: Claude')!;
  assert.equal(listed.account, 'ann');
  assert.deepEqual(listed.surfaces, ['fmmcp']);
  assert.ok(Date.parse(listed.expires!) - Date.now() <= 3600_000);
  const res = await mcp(tokens.access_token);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(!body.result.isError, JSON.stringify(body));
  // Not usable for the Data API.
  const rest = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  assert.notEqual(rest.status, 200);
});

test('refresh rotates both tokens; revoking in Manage Security signs the app out', { skip }, async () => {
  const first = await connect();
  const t = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: first.client_id }));
  const next = await t.json();
  assert.ok(next.access_token && next.access_token !== first.access_token);
  assert.equal((await mcp(first.access_token)).status, 401, 'the old access token stops working');
  assert.equal((await mcp(next.access_token)).status, 200);
  // Another app can't use this app's refresh token.
  const other = await register();
  const stolen = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: next.refresh_token, client_id: other.client_id }));
  assert.equal((await stolen.json()).error, 'invalid_grant');

  // A wrong client does not consume it. Then the admin revokes the sign-in.
  const fresh = { client_id: first.client_id, ...await (await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: next.refresh_token, client_id: first.client_id }))).json() };
  assert.match(fresh.access_token, /^ohbt_/);
  const id = /^ohbt_([0-9a-f]+)\./.exec(fresh.access_token)![1];
  assert.ok(store.revokeApiToken(id));
  assert.equal((await mcp(fresh.access_token)).status, 401);
  const after = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: fresh.refresh_token, client_id: fresh.client_id }));
  assert.equal((await after.json()).error, 'invalid_grant');
  const replay = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: first.client_id }));
  assert.equal((await replay.json()).error, 'invalid_grant');
});

test('the app signing out revokes its tokens', { skip }, async () => {
  const c = await connect();
  assert.equal((await post('/oauth/revoke', form({ token: c.refresh_token, client_id: c.client_id }))).status, 200);
  assert.equal((await mcp(c.access_token)).status, 401);
  const d = await connect();
  // Another app can't revoke it.
  const other = await register();
  await post('/oauth/revoke', form({ token: d.access_token, client_id: other.client_id }));
  assert.equal((await mcp(d.access_token)).status, 200);
  await post('/oauth/revoke', form({ token: d.access_token, client_id: d.client_id }));
  assert.equal((await mcp(d.access_token)).status, 401);
});

test('refused: wrong password, no AI privilege, AI off, inactive account, second factor', { skip }, async () => {
  const { client_id } = await register();
  const { challenge } = pkce();
  const wrong = await signIn(client_id, challenge, { account: 'ann', password: 'nope' });
  assert.equal(wrong.status, 401);
  assert.match(await wrong.text(), /Wrong account or password/);
  const noAi = await signIn(client_id, challenge, { account: 'nora', password: 'nora-pw' });
  assert.match(await noAi.text(), /privilege set \(NoAi\) doesn&#39;t allow AI apps|privilege set \(NoAi\) doesn't allow AI apps/);

  store.setAccountActive('ann', false);
  try {
    assert.match(await (await signIn(client_id, challenge, { account: 'ann', password: 'ann-pw' })).text(), /Wrong account or password/);
  } finally {
    store.setAccountActive('ann', true);
  }

  const { secret } = store.enrollTotp('ann');
  store.confirmTotp('ann', totpCode(secret));
  try {
    assert.match(await (await signIn(client_id, challenge, { account: 'ann', password: 'ann-pw' })).text(), /Enter the one-time code/);
    assert.match(await (await signIn(client_id, challenge, { account: 'ann', password: 'ann-pw', otp: '000000' })).text(), /not valid/);
    const ok = await signIn(client_id, challenge, { account: 'ann', password: 'ann-pw', otp: totpCode(secret) });
    assert.equal(ok.status, 302);
  } finally {
    store.disableTotp('ann');
  }

  const c = await connect();
  store.setAiAllowed(false);
  try {
    const page = await (await fetch(`${base}/oauth/authorize?${form({ client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' })}`)).text();
    assert.match(page, /AI is turned off for every one/);
    assert.doesNotMatch(page, /Charts/);
    const refresh = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.client_id }));
    assert.equal((await refresh.json()).error, 'invalid_grant');
  } finally {
    store.setAiAllowed(true);
  }
});

test('bad links and registrations are refused, and never sent to an address the app did not register', { skip }, async () => {
  const { client_id } = await register();
  const { challenge } = pkce();
  const q = (o: Record<string, string>) => fetch(`${base}/oauth/authorize?${form({ client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', ...o })}`, { redirect: 'manual' });
  for (const bad of [{ redirect_uri: 'https://evil.example/cb' } as Record<string, string>, { client_id: 'ohc_nope' }, { code_challenge_method: 'plain' }, { response_type: 'token' }, { resource: 'https://elsewhere.example/mcp' }]) {
    const r = await q(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.headers.get('location'), null);
  }
  // Cancel goes back to the app with access_denied.
  const cancel = await signIn(client_id, challenge, { cancel: '1' });
  assert.equal(new URL(cancel.headers.get('location')!).searchParams.get('error'), 'access_denied');

  for (const uris of [['http://evil.example/cb'], ['javascript:alert(1)'], ['https://x.example/cb#frag'], []]) {
    const r = await post('/oauth/register', JSON.stringify({ redirect_uris: uris }), 'application/json');
    assert.equal(r.status, 400, JSON.stringify(uris));
  }
  // A loopback app (Claude Code, Claude Desktop) may come back on any port.
  const local = await register({ redirect_uris: ['http://127.0.0.1:33418/callback'] });
  const r = await fetch(`${base}/oauth/authorize?${form({ client_id: local.client_id, redirect_uri: 'http://127.0.0.1:50000/callback', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' })}`);
  assert.equal(r.status, 200);

  // A confidential app must send its secret.
  const conf = await register({ token_endpoint_auth_method: 'client_secret_post' });
  assert.match(conf.client_secret!, /^ohcs_/);
  const noSecret = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: 'ohrt_x', client_id: conf.client_id }));
  assert.equal(noSecret.status, 401);
});

test('review fixes: the token is for the account that signed in, never one whose name only folds to it', { skip }, async () => {
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.setPassword('kate', 'kate-pw', full.name);
  // "Kate" with a Kelvin sign: a different account to SQLite, the same name to JavaScript's toLowerCase.
  // A new account like that is refused now, so the pair is made the way a file from before the check would hold it.
  const kelvin = 'Kate';
  assert.throws(() => store.setPassword(kelvin, 'kelvin-pw', 'Bot'), /looks the same/);
  (store as unknown as { sql: DatabaseSync }).sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source) VALUES (?, NULL, 'local')`).run(kelvin);
  store.setPassword(kelvin, 'kelvin-pw', 'Bot');
  const c = await connect(kelvin, 'kelvin-pw');
  assert.equal(store.apiToken(c.access_token)?.account, kelvin);
});

test('review fixes: a password change, a second factor required, or a password to change ends the sign-in at its next refresh', { skip }, async () => {
  const refresh = (c: { refresh_token: string; client_id: string }) => post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.client_id })).then((r) => r.json());
  store.setPassword('pat', 'pat-pw', 'Bot');
  const a = await connect('pat', 'pat-pw');
  const next = await refresh(a);
  assert.match(next.access_token, /^ohbt_/, 'an unchanged account refreshes');
  store.setPassword('pat', 'pat-pw2', 'Bot');
  assert.equal((await refresh({ ...a, refresh_token: next.refresh_token })).error, 'invalid_grant');
  const b = await connect('pat', 'pat-pw2');
  store.setPassword('pat', 'pat-pw2', 'Bot', { mustChange: true });
  assert.equal((await refresh(b)).error, 'invalid_grant');
});

test('review fixes: revoking needs the whole token; bad credentials are a 401; a proxied request is not this computer', { skip }, async () => {
  const c = await connect();
  const id = /^ohbt_([0-9a-f]+)\./.exec(c.access_token)![1];
  await post('/oauth/revoke', form({ token: `ohbt_${id}.guessed`, client_id: c.client_id }));
  assert.equal((await mcp(c.access_token)).status, 200);
  const r = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: c.refresh_token }), undefined, { authorization: `Basic ${Buffer.from('%E0%A4%A:x').toString('base64')}` });
  assert.equal(r.status, 401);
  const proxied = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-forwarded-for': '203.0.113.9' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  assert.equal(proxied.status, 401);
  assert.match(proxied.headers.get('www-authenticate')!, /^Bearer resource_metadata=/);
});

test('a local authorization code with no who or identity still issues usable credentials', { skip }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
  try {
    const { client_id } = await register();
    const { verifier, challenge } = pkce();
    const back = await signIn(client_id, challenge, { account: 'ann', password: 'ann-pw' });
    assert.equal(back.status, 302);
    const code = new URL(back.headers.get('location')!).searchParams.get('code')!;
    const row = db.prepare('SELECT who, identity FROM codes WHERE hash = ?').get(createHash('sha256').update(code).digest('hex'));
    assert.deepEqual({ ...row }, { who: null, identity: null });
    const response = await post('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT }));
    assert.equal(response.status, 200);
    const tokens = await response.json();
    assert.equal(tokens.expires_in, 3600);
    assert.equal(store.apiToken(tokens.access_token)?.account, 'ann');
    // Delegated, not service: a password reset ends it (session-sequence-regressions.test.ts).
    assert.equal(store.apiToken(tokens.access_token)?.provenance, 'delegated');
    assert.equal((await mcp(tokens.access_token)).status, 200);
    assert.match(tokens.refresh_token, /^ohrt_/);
    const service = store.createApiToken('ann', { provenance: 'service' });
    assert.equal(store.apiToken(service)?.account, 'ann');
    assert.equal(store.apiToken(service)?.provenance, 'service');
  } finally { db.close(); }
});

test('a code is for the account it was given for: one replaced by another of the same name, or a code from before marks were kept, is refused', { skip }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const exchange = async (client_id: string, code: string, verifier: string) =>
    post('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT }));
  store.setPassword('rita', 'rita-pw', 'Bot');
  // The account is deleted and made again (same name, new password) between the sign-in and the exchange.
  const a = await register();
  const pa = pkce();
  const back = await signIn(a.client_id, pa.challenge, { account: 'rita', password: 'rita-pw' });
  assert.equal(back.status, 302);
  const code = new URL(back.headers.get('location')!).searchParams.get('code')!;
  store.sql.prepare('DELETE FROM _fm_accounts WHERE name = ?').run('rita');
  store.setPassword('rita', 'someone-else', 'Bot');
  const refused = await exchange(a.client_id, code, pa.verifier);
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error, 'invalid_grant');
  // A code with no mark (given before this was kept) is refused too.
  const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
  try {
    const b = await register();
    const pb = pkce();
    const r2 = await signIn(b.client_id, pb.challenge, { account: 'ann', password: 'ann-pw' });
    const old = new URL(r2.headers.get('location')!).searchParams.get('code')!;
    db.prepare('UPDATE codes SET mark = NULL WHERE hash = ?').run(createHash('sha256').update(old).digest('hex'));
    assert.equal((await exchange(b.client_id, old, pb.verifier)).status, 400);
  } finally { db.close(); }
  // An untouched account still works.
  const c = await register();
  const pc = pkce();
  const r3 = await signIn(c.client_id, pc.challenge, { account: 'ann', password: 'ann-pw' });
  const fresh = new URL(r3.headers.get('location')!).searchParams.get('code')!;
  assert.equal((await exchange(c.client_id, fresh, pc.verifier)).status, 200);
});

test('review fixes: registrations never push out an app in use; a full list refuses new ones', { skip }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
  try {
    const used = await connect();
    const now = Date.now();
    const add = db.prepare('INSERT INTO clients (id, secret_hash, name, redirect_uris, created, used) VALUES (?, NULL, ?, ?, ?, ?)');
    const n = (db.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number }).n;
    for (let i = n; i < 500; i++) add.run(`ohc_fill${i}`, 'x', '[]', now - 1000, null);
    // Full: an unused one gives way, the one in use stays.
    await register();
    assert.ok(db.prepare('SELECT 1 FROM clients WHERE id = ?').get(used.client_id));
    db.exec(`UPDATE clients SET used = ${now}`);
    const refused = await post('/oauth/register', JSON.stringify({ redirect_uris: [REDIRECT] }), 'application/json');
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: 'invalid_client_metadata' });
    assert.ok(db.prepare('SELECT 1 FROM clients WHERE id = ?').get(used.client_id));
  } finally {
    db.exec("DELETE FROM clients WHERE id LIKE 'ohc_fill%'");
    db.close();
  }
});

test('blocking new users stops AI app sign-ins; an app already signed in refreshes as before', { skip }, async () => {
  const first = await connect();
  // A code given out just before the block isn't turned into a grant after it.
  const late = await register();
  const lateKey = pkce();
  const lateSignIn = await signIn(late.client_id, lateKey.challenge, { account: 'ann', password: 'ann-pw' });
  const lateCode = new URL(lateSignIn.headers.get('location')!).searchParams.get('code')!;
  host.config.setBlockNewUsers(true);
  try {
    const exchanged = await post('/oauth/token', form({ grant_type: 'authorization_code', code: lateCode, code_verifier: lateKey.verifier, client_id: late.client_id, redirect_uri: REDIRECT }));
    assert.equal((await exchanged.json()).error, 'invalid_grant');
    // A wrong password gets the same answer as a right one.
    const wrong = await signIn(late.client_id, pkce().challenge, { account: 'ann', password: 'nope' });
    assert.match(await wrong.text(), /The server isn(?:'|&#39;|&#x27;)t accepting new users right now/);
    const { client_id } = await register();
    const r = await signIn(client_id, pkce().challenge, { account: 'ann', password: 'ann-pw' });
    assert.notEqual(r.status, 302);
    assert.match(await r.text(), /The server isn(?:'|&#39;|&#x27;)t accepting new users right now/);
    const t = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: first.client_id }));
    assert.equal(t.status, 200, await t.clone().text());
  } finally {
    host.config.setBlockNewUsers(false);
  }
  await connect();
});
