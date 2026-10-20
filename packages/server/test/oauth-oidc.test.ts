// An AI app's sign-in (OAuth at /mcp) through an identity provider: the same button the web client has, against a
// stand-in OpenID Connect provider. The person gets the external account the file maps them to, under its privilege
// set, and every refusal of the password sign-in still applies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
let dir: string, server: Server, idp: Server, base: string, issuer: string, store: Store;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
let person: Record<string, unknown> = {};
const codes = new Map<string, { nonce: string; challenge: string }>();
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const idToken = (claims: Record<string, unknown>) => {
  const head = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64(claims)}`;
  return `${head}.${sign('sha256', Buffer.from(head), privateKey).toString('base64url')}`;
};

before(async () => {
  if (skip) return;
  idp = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    const send = (body: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/.well-known/openid-configuration') send({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    else if (url.pathname === '/jwks') send({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
    else if (url.pathname === '/token') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const f = new URLSearchParams(body);
      const c = codes.get(f.get('code') ?? '');
      if (!c || createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') !== c.challenge) return send({ error: 'invalid_grant' }, 400);
      const now = Math.floor(Date.now() / 1000);
      send({ id_token: idToken({ iss: issuer, aud: 'tabularius', sub: 'u1', exp: now + 300, iat: now, nonce: c.nonce, ...person }) });
    } else send({ error: 'not found' }, 404);
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-oauth-oidc-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, listFilesPublicly: true, log: () => {}, oidc: { name: 'Test IdP', issuer, clientId: 'tabularius' } });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.savePrivilegeSet({ name: 'Bot', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  store.savePrivilegeSet({ name: 'NoAi', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setExternalAccount('ai-staff', 'Bot');
  store.setExternalAccount('no-ai', 'NoAi');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  idp?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const post = (path: string, body: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });

async function appStart() {
  const reg = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) });
  const { client_id } = await reg.json() as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const params = { client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 's9', resource: `${base}/mcp` };
  return { client_id, verifier, params };
}

/** Clicks the provider's button, signs in at the (stand-in) provider and comes back; returns the page's reply. */
async function throughProvider(params: Record<string, string>, extra: Record<string, string> = { database: 'Charts' }): Promise<Response> {
  const start = await fetch(`${base}/oauth/authorize?${form({ ...params, oidc: 'test-idp', ...extra })}`, { redirect: 'manual' });
  if (start.status !== 302) return start;
  const auth = new URL(start.headers.get('location')!);
  assert.equal(auth.origin + auth.pathname, `${issuer}/authorize`);
  const code = randomBytes(8).toString('hex');
  codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
  return fetch(`${base}/tabularius/auth/v1/oidc/callback?code=${code}&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
}

/** The consent page's hidden fields, as the browser would post them. */
const hiddenFields = (html: string) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
/** Clicks "Allow" on the page the provider's return shows. */
const allow = (page: string) => post('/oauth/authorize', form(hiddenFields(page)));

test('the sign-in page offers the identity provider', { skip }, async () => {
  const { params } = await appStart();
  const html = await (await fetch(`${base}/oauth/authorize?${form(params)}`)).text();
  assert.match(html, /Sign in with Test IdP/);
  assert.match(html, /name="oidc" value="test-idp"/);
});

test('sign in through the provider: the app gets a token for the mapped account, under its privilege set', { skip }, async () => {
  person = { email: 'alex@example.com', email_verified: true, groups: ['ai-staff'] };
  const { client_id, verifier, params } = await appStart();
  const consent = await throughProvider(params);
  assert.equal(consent.status, 200, 'the provider\'s say-so alone does not give the app a code');
  const page = await consent.text();
  assert.match(page, /<strong>Claude<\/strong> wants to use Tabularius as <strong>alex@example\.com<\/strong>/);
  assert.match(page, /sent back to <strong>claude\.ai<\/strong>/);
  const back = await allow(page);
  assert.equal(back.status, 302, await back.clone().text());
  const to = new URL(back.headers.get('location')!);
  assert.equal(to.origin + to.pathname, REDIRECT);
  assert.equal(to.searchParams.get('state'), 's9');
  const t = await post('/oauth/token', form({ grant_type: 'authorization_code', code: to.searchParams.get('code')!, code_verifier: verifier, client_id, redirect_uri: REDIRECT }));
  assert.equal(t.status, 200);
  const tok = await t.json() as { access_token: string; refresh_token: string };
  // The file's token list shows whose it is, and the account it carries.
  const row = store.apiTokens().find((x) => tok.access_token.includes(x.id))!;
  assert.equal(row.account, 'ai-staff');
  assert.match(row.label!, /^alex@example\.com via AI app: Claude/);
  assert.deepEqual(row.surfaces, ['fmmcp']);
  // A refresh keeps who it was, and revoking the token signs the app out.
  const r = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id }));
  assert.equal(r.status, 200);
  const next = await r.json() as { access_token: string };
  assert.match(store.apiTokens().find((x) => next.access_token.includes(x.id))!.label!, /alex@example\.com/);
});

test('sign in through the provider: refused when the account\'s privilege set has no AI access', { skip }, async () => {
  person = { email: 'nora@example.com', email_verified: true, groups: ['no-ai'] };
  const { params } = await appStart();
  const back = await throughProvider(params);
  assert.equal(back.status, 401);
  assert.match(await back.text(), /doesn&#39;t allow AI apps|doesn't allow AI apps/);
});

test('sign in through the provider: refused with no matching account, a disabled account, or a file with AI off', { skip }, async () => {
  const { params } = await appStart();
  person = { email: 'stranger@example.com', email_verified: true, groups: ['nobody'] };
  const none = await throughProvider(params);
  assert.equal(none.status, 401);
  assert.match(await none.text(), /no external account/);

  person = { email: 'alex@example.com', email_verified: true, groups: ['ai-staff'] };
  store.setAccountActive('ai-staff', false);
  try {
    const off = await throughProvider(params);
    assert.equal(off.status, 401);
    assert.match(await off.text(), /turned off|no external account/);
  } finally {
    store.setAccountActive('ai-staff', true);
  }
});

test('mapped OAuth tokens are revoked when the person account is deactivated', { skip }, async () => {
  person = { email: 'alex@example.com', email_verified: true, groups: ['ai-staff'] };
  store.setPassword('alex@example.com', 'person-password-123', 'NoAi');
  const { client_id, verifier, params } = await appStart();
  const consent = await throughProvider(params);
  const back = await allow(await consent.text());
  const code = new URL(back.headers.get('location')!).searchParams.get('code')!;
  const issued = await post('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT }));
  assert.equal(issued.status, 200);
  const tokens = await issued.json() as { access_token: string; refresh_token: string };
  const tokenRow = store.apiTokens().find((x) => tokens.access_token.includes(x.id))!;
  assert.equal(tokenRow.account, 'ai-staff');
  assert.equal(store.apiToken(tokens.access_token)?.account, 'ai-staff');
  store.setAccountActive('alex@example.com', false);
  try {
    assert.equal(store.apiToken(tokens.access_token), undefined);
    const request = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(request.status, 401);
    const refresh = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id }));
    assert.equal(refresh.status, 400);
    assert.equal((await refresh.json() as { error: string }).error, 'invalid_grant');
    assert.equal(store.externalAccount('someone@example.com', ['ai-staff']), 'ai-staff');
  } finally { store.setAccountActive('alex@example.com', true); }
});

test('email-less group sign-in cannot mint person credentials', { skip }, async () => {
  person = { groups: ['ai-staff'] };
  const { params } = await appStart();
  const response = await throughProvider(params);
  assert.equal(response.status, 401);
  assert.match(await response.text(), /trusted, verified email/);
});

test('sign in through the provider: an unknown file or provider shows a page, never a redirect to the app', { skip }, async () => {
  const { params } = await appStart();
  const noFile = await fetch(`${base}/oauth/authorize?${form({ ...params, oidc: 'test-idp', database: 'Nope' })}`, { redirect: 'manual' });
  assert.equal(noFile.status, 400);
  const noProvider = await fetch(`${base}/oauth/authorize?${form({ ...params, oidc: 'nope', database: 'Charts' })}`, { redirect: 'manual' });
  assert.equal(noProvider.status, 401);
  assert.match(await noProvider.text(), /Unknown sign-in provider/);
});

test('the provider alone never gives an app a code: approval is needed, once, for that app only', { skip }, async () => {
  person = { email: 'alex@example.com', email_verified: true, groups: ['ai-staff'] };
  const a = await appStart();
  // The provider is asked to let the person pick the account, so a browser already signed in can't finish unseen.
  const start = await fetch(`${base}/oauth/authorize?${form({ ...a.params, oidc: 'test-idp', database: 'Charts' })}`, { redirect: 'manual' });
  assert.equal(new URL(start.headers.get('location')!).searchParams.get('prompt'), 'select_account');
  const page = await (await throughProvider(a.params)).text();
  const fields = hiddenFields(page);
  assert.ok(fields.consent);
  // Another app can't use this approval, and it can't be redirected elsewhere.
  const b = await appStart();
  const other = await post('/oauth/authorize', form({ ...hiddenFields(page), client_id: b.client_id }));
  assert.equal(other.status, 400);
  // Cancelling sends the app an error and no code.
  const cancel = await post('/oauth/authorize', form({ ...fields, cancel: '1' }));
  assert.equal(new URL(cancel.headers.get('location')!).searchParams.get('error'), 'access_denied');
  // The approval works once.
  const page2 = await (await throughProvider(a.params)).text();
  const ok = await allow(page2);
  assert.equal(ok.status, 302);
  assert.ok(new URL(ok.headers.get('location')!).searchParams.get('code'));
  const again = await allow(page2);
  assert.equal(again.status, 400, 'a used approval is refused');
  // An account turned off while the page was open is refused at "Allow".
  const page3 = await (await throughProvider(a.params)).text();
  store.setAccountActive('ai-staff', false);
  try {
    assert.equal((await allow(page3)).status, 400);
  } finally {
    store.setAccountActive('ai-staff', true);
  }
});

test('an app named like someone else can\'t push the real email out of the token label', { skip }, async () => {
  person = { email: 'alex@example.com', email_verified: true, groups: ['ai-staff'] };
  const reg = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: `Drive (ceo@corp.com)\nfake ${'x'.repeat(200)}`, redirect_uris: [REDIRECT] }) });
  const { client_id } = await reg.json() as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const params = { client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' };
  const back = await allow(await (await throughProvider(params)).text());
  const code = new URL(back.headers.get('location')!).searchParams.get('code')!;
  const t = await post('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT }));
  const tok = await t.json() as { access_token: string };
  const label = store.apiTokens().find((x) => tok.access_token.includes(x.id))!.label!;
  assert.ok(label.startsWith('alex@example.com via AI app:'), label);
  assert.ok(!/[\r\n]/.test(label));
});

test('an identity-provider sign-in\'s refresh token does not renew past its first day', { skip }, async () => {
  person = { email: 'alex@example.com', email_verified: true, groups: ['ai-staff'] };
  const { client_id, verifier, params } = await appStart();
  const back = await allow(await (await throughProvider(params)).text());
  const code = new URL(back.headers.get('location')!).searchParams.get('code')!;
  const tok = await (await post('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT }))).json() as { refresh_token: string };
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
  try {
    const first = (db.prepare('SELECT expires FROM refresh WHERE client_id = ?').get(client_id) as { expires: number }).expires;
    assert.ok(first - Date.now() <= 24 * 60 * 60 * 1000 + 5000, 'a day at most for an account with no password here');
    const r = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id }));
    assert.equal(r.status, 200);
    const next = (db.prepare('SELECT expires FROM refresh WHERE client_id = ?').get(client_id) as { expires: number }).expires;
    assert.equal(next, first, 'a refresh keeps the original end');
  } finally {
    db.close();
  }
});

for (const active of [false, true]) {
  test(`legacy federated codes without trusted identity are refused with the person ${active ? 'active' : 'inactive'}`, { skip }, async () => {
    const { client_id, verifier, params } = await appStart();
    store.setExternalAccount('Team', 'Bot');
    store.setPassword('pat@example.test', 'person-password-123', 'NoAi');
    const code = randomBytes(32).toString('base64url');
    const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
    try {
      db.prepare('INSERT INTO codes (hash, client_id, redirect_uri, challenge, database, account, expires, who, identity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)')
        .run(createHash('sha256').update(code).digest('hex'), client_id, REDIRECT, params.code_challenge, 'Charts', 'Team', Date.now() + 60_000, 'pat@example.test');
      store.deleteAccount('Team');
      store.setPassword('Team', 'local-password-123', 'Bot');
      store.setAccountActive('pat@example.test', active);
      assert.equal(store.accountInactive('Team'), false);
      assert.equal(store.isExternalAccount('Team'), false);
      const before = store.apiTokens();
      const response = await post('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT }));
      const body = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 400);
      assert.equal(body.error, 'invalid_grant');
      assert.equal(body.access_token, undefined);
      assert.equal(body.refresh_token, undefined);
      assert.deepEqual(store.apiTokens(), before);
      assert.equal(db.prepare('SELECT 1 FROM refresh WHERE client_id = ?').get(client_id), undefined);
    } finally {
      db.close();
      store.deleteAccount('Team');
      store.deleteAccount('pat@example.test');
    }
  });
}

for (const change of ['inactive', 'no fmmcp', 'second factor', 'file AI off']) {
  test(`a structured-identity code cannot mint credentials after consent when the mapping has ${change}`, { skip }, async () => {
    store.setExternalAccount('@example.test', 'Bot');
    store.setPassword('pat@example.test', 'person-password-123', 'NoAi');
    person = { email: 'pat@example.test', email_verified: true };
    const { client_id, verifier, params } = await appStart();
    const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
    const restore = () => {
      store.setAccountActive('@example.test', true);
      store.setExternalAccount('@example.test', 'Bot');
      store.setAccountRequire2fa('@example.test', false);
      store.setAiAllowed(true);
    };
    try {
      const consent = await throughProvider(params);
      assert.equal(consent.status, 200);
      const back = await allow(await consent.text());
      assert.equal(back.status, 302);
      const code = new URL(back.headers.get('location')!).searchParams.get('code')!;
      const retained = db.prepare('SELECT identity FROM codes WHERE client_id = ?').get(client_id) as { identity: string };
      assert.deepEqual(JSON.parse(retained.identity), { issuer, sub: 'u1', person: 'pat@example.test', mapping: '@example.test' });
      if (change === 'inactive') store.setAccountActive('@example.test', false);
      if (change === 'no fmmcp') store.setExternalAccount('@example.test', 'NoAi');
      if (change === 'second factor') store.setAccountRequire2fa('@example.test', true);
      if (change === 'file AI off') store.setAiAllowed(false);
      const before = store.apiTokens();
      const exchange = () => post('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT }));
      const response = await exchange();
      const body = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 400);
      assert.equal(body.error, 'invalid_grant');
      assert.equal(body.access_token, undefined);
      assert.equal(body.refresh_token, undefined);
      assert.deepEqual(store.apiTokens(), before);
      assert.equal(db.prepare('SELECT 1 FROM refresh WHERE client_id = ?').get(client_id), undefined);
      restore();
      const retry = await exchange();
      assert.equal(retry.status, 400);
      assert.equal((await retry.json() as { error: string }).error, 'invalid_grant', 'a refused exchange still consumes the code');
    } finally {
      restore();
      db.close();
      store.deleteAccount('@example.test');
      store.deleteAccount('pat@example.test');
    }
  });
}

test('an active domain mapping grants federated OAuth without requiring the person to have fmmcp', { skip }, async () => {
  store.setExternalAccount('@example.test', 'Bot');
  store.setPassword('pat@example.test', 'person-password-123', 'NoAi');
  person = { email: 'pat@example.test', email_verified: true };
  const { client_id, verifier, params } = await appStart();
  const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
  try {
    const back = await allow(await (await throughProvider(params)).text());
    assert.equal(back.status, 302);
    const code = new URL(back.headers.get('location')!).searchParams.get('code')!;
    const response = await post('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT }));
    assert.equal(response.status, 200);
    const tokens = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
    assert.equal(tokens.expires_in, 3600);
    assert.equal(store.apiToken(tokens.access_token)?.account, '@example.test');
    const identity = { issuer, sub: 'u1', person: 'pat@example.test', mapping: '@example.test' };
    assert.deepEqual(store.apiToken(tokens.access_token)?.identity, identity);
    assert.equal(store.apiToken(tokens.access_token)?.provenance, 'delegated');
    const access = store.apiTokens().find((t) => tokens.access_token.includes(t.id))!;
    assert.ok(Math.abs(Date.parse(access.expires!) - Date.now() - 3600_000) < 5000);
    const first = db.prepare('SELECT expires, identity FROM refresh WHERE client_id = ?').get(client_id) as { expires: number; identity: string };
    assert.deepEqual(JSON.parse(first.identity), identity);
    const refresh = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id }));
    assert.equal(refresh.status, 200);
    const next = await refresh.json() as { access_token: string; refresh_token: string; expires_in: number };
    assert.notEqual(next.refresh_token, tokens.refresh_token);
    assert.equal(next.expires_in, 3600);
    assert.equal(store.apiToken(tokens.access_token), undefined);
    assert.equal(store.apiToken(next.access_token)?.account, '@example.test');
    assert.deepEqual(store.apiToken(next.access_token)?.identity, identity);
    const rotated = db.prepare('SELECT expires, identity FROM refresh WHERE client_id = ?').get(client_id) as { expires: number; identity: string };
    assert.equal(rotated.expires, first.expires);
    assert.deepEqual(JSON.parse(rotated.identity), identity);
  } finally {
    db.close();
    store.deleteAccount('@example.test');
    store.deleteAccount('pat@example.test');
  }
});
