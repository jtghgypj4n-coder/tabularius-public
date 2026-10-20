// Data API apps signing people in through an identity provider, the FileMaker Server way
// (oauthproviderinfo, getoauthurl, then X-FM-Data-OAuth-* on the session log in), against
// a stand-in OpenID Connect provider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let idp: Server;
let base: string;
let issuer: string;
let store: Store;
let allowedReturnUrls = ['https://app.example.com/back', 'http://127.0.0.1:5000', 'http://localhost:5000/cb'];

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
/** What the provider says about the next person to sign in. */
let person: Record<string, unknown> = {};
let signWith = privateKey;
const codes = new Map<string, { nonce: string; challenge: string }>();

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function idToken(claims: Record<string, unknown>): string {
  const head = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64(claims)}`;
  return `${head}.${sign('sha256', Buffer.from(head), signWith).toString('base64url')}`;
}

before(async () => {
  if (skip) return;
  idp = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    const send = (body: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/.well-known/openid-configuration') {
      send({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    } else if (url.pathname === '/jwks') {
      send({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
    } else if (url.pathname === '/token') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      const c = codes.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      if (!c || createHash('sha256').update(verifier).digest('base64url') !== c.challenge || form.get('client_id') !== 'tabularius') {
        send({ error: 'invalid_grant' }, 400);
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      send({ id_token: idToken({ iss: issuer, aud: 'tabularius', sub: 'u1', exp: now + 300, iat: now, nonce: c.nonce, ...person }) });
    } else send({ error: 'not found' }, 404);
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;

  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, oidc: { name: 'Test IdP', issuer, clientId: 'tabularius', dataApiReturnUrls: allowedReturnUrls } });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.setExternalAccount('Staff', store.privilegeSets().find((p) => p.id === 1)!.name);
  store.setExternalAccount('pat@example.com', '[Read-Only Access]');
  const ro = store.privilegeSet('[Read-Only Access]')!;
  store.savePrivilegeSet({ ...ro, extendedPrivileges: [...ro.extendedPrivileges, 'fmrest'] });
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  idp?.close();
  if (dir) rmSync(dir, { recursive: true });
});


const fmsHeaders = (returnUrl: string) => ({ 'x-fms-application-type': '9', 'x-fms-application-version': '15', 'x-fms-return-url': returnUrl });

async function restartWithCurrentPolicy(): Promise<void> {
  await new Promise<void>((r) => server.close(() => r()));
  const s = await serve({ dir, port: 0, log: () => {}, oidc: { name: 'Test IdP', issuer, clientId: 'tabularius', dataApiReturnUrls: allowedReturnUrls } });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
}

async function pendingAppSignIn(returnUrl: string): Promise<{ requestId: string; state: string; code: string }> {
  const r = await fetch(`${base}/oauth/getoauthurl?trackingID=t-revoked&provider=Test%20IdP`, { headers: fmsHeaders(returnUrl) });
  assert.equal(r.status, 200, await r.clone().text());
  const auth = new URL(await r.text());
  const state = auth.searchParams.get('state')!;
  const code = Math.random().toString(36).slice(2);
  codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
  return { requestId: r.headers.get('x-fms-request-id')!, state, code };
}

/** getoauthurl, then the person signing in at the provider; returns the request id and where the browser is sent back. */
async function appSignIn(returnUrl = 'http://127.0.0.1:5000/', provider = 'Test IdP'): Promise<{ requestId: string; back: URL }> {
  const r = await fetch(`${base}/oauth/getoauthurl?trackingID=t-42&provider=${encodeURIComponent(provider)}&address=127.0.0.1&X-FMS-OAuth-AuthType=2`, { headers: fmsHeaders(returnUrl) });
  assert.equal(r.status, 200, await r.clone().text());
  const requestId = r.headers.get('x-fms-request-id')!;
  assert.ok(requestId);
  const auth = new URL(await r.text());
  assert.equal(r.headers.get('x-fms-return-url'), auth.toString());
  assert.equal(auth.origin + auth.pathname, `${issuer}/authorize`);
  assert.equal(auth.searchParams.get('prompt'), 'select_account', 'the person picks the account: not finished unseen');
  const code = Math.random().toString(36).slice(2);
  codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
  const back = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=${code}&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
  assert.equal(back.status, 302);
  return { requestId, back: new URL(back.headers.get('location')!) };
}

const login = (requestId: string, identifier: string) => fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-fm-data-oauth-request-id': requestId, 'x-fm-data-oauth-identifier': identifier }, body: '{}',
});

test('Data API: the providers are listed where FileMaker Server lists them', { skip }, async () => {
  const r = await fetch(`${base}/fmws/oauthproviderinfo`).then((x) => x.json());
  assert.deepEqual(r.data.map((p: { Name: string }) => p.Name), ['Test IdP']);
});

test('Data API: an app signs someone in through the provider and logs in with the identifier, once', { skip }, async () => {
  person = { email: 'pat@example.com', email_verified: true };
  const { requestId, back } = await appSignIn();
  assert.equal(back.origin + back.pathname, 'http://127.0.0.1:5000/');
  assert.equal(back.searchParams.get('trackingID'), 't-42');
  const identifier = back.searchParams.get('identifier')!;
  assert.ok(identifier);
  const r = await login(requestId, identifier);
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  const token = r.headers.get('x-fm-data-access-token')!;
  assert.equal(body.response.token, token);
  // Signed in as the email's external account: [Read-Only Access] can read but not edit.
  const read = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records/1`, { headers: { authorization: `Bearer ${token}` } }).then((x) => x.json());
  assert.equal(read.messages[0].code, '0');
  const edit = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records/1`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Name: 'x' } }) }).then((x) => x.json());
  assert.equal(edit.messages[0].code, '200');
  // The identifier is good once.
  assert.equal((await login(requestId, identifier)).status, 401);
});

test('Data API: a wrong identifier uses the request up; no account, no session', { skip }, async () => {
  person = { email: 'pat@example.com', email_verified: true };
  const a = await appSignIn();
  const r = await login(a.requestId, 'guess');
  assert.equal(r.status, 401);
  assert.equal((await r.json()).messages[0].code, '212');
  assert.equal((await login(a.requestId, a.back.searchParams.get('identifier')!)).status, 401, 'a wrong guess used it up');

  person = { email: 'stranger@elsewhere.org', email_verified: true, groups: ['Nobody'] };
  const b = await appSignIn();
  assert.equal((await login(b.requestId, b.back.searchParams.get('identifier')!)).status, 401);

  // Not verified by the provider: the email can't stand for an account.
  person = { email: 'pat@example.com', email_verified: false };
  const c = await appSignIn();
  assert.equal((await login(c.requestId, c.back.searchParams.get('identifier')!)).status, 401);
});

test('Data API: people are sent back only to this server, this computer, or an app the provider lists', { skip }, async () => {
  person = { email: 'pat@example.com', email_verified: true };
  // This computer only as listed: on a shared machine (a terminal server) anyone could listen on another port.
  for (const bad of ['https://evil.example.org/', 'https://app.example.com/other', 'https://app.example.com/backdoor', 'https://app.example.com/back/..%2fother', 'https://app.example.com/back/%2E%2E/other', 'javascript:alert(1)', 'https://user:pw@app.example.com/back', '', 'http://127.0.0.1:5555/', 'http://localhost/']) {
    const r = await fetch(`${base}/oauth/getoauthurl?trackingID=t&provider=Test%20IdP`, { headers: fmsHeaders(bad) });
    assert.equal(r.status, 400, bad);
    assert.equal(r.headers.get('x-fms-request-id'), null);
  }
  const listed = await appSignIn('https://app.example.com/back/done?keep=1');
  assert.equal(listed.back.origin + listed.back.pathname, 'https://app.example.com/back/done');
  assert.equal(listed.back.searchParams.get('keep'), '1');
  const own = await appSignIn(`${base}/my-app/`, 'test-idp');
  assert.equal(own.back.origin, new URL(base).origin);
  assert.ok(own.back.searchParams.get('identifier'));
});

test('Data API: what went wrong at the provider goes back to the app', { skip }, async () => {
  const r = await fetch(`${base}/oauth/getoauthurl?trackingID=t-9&provider=Test%20IdP`, { headers: fmsHeaders('http://localhost:5000/cb') });
  const auth = new URL(await r.text());
  const back = await fetch(`${base}/tabularius/auth/v1/oidc/callback?error=access_denied&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
  const to = new URL(back.headers.get('location')!);
  assert.equal(to.origin, 'http://localhost:5000');
  assert.equal(to.searchParams.get('trackingID'), 't-9');
  assert.match(to.searchParams.get('error')!, /access_denied/);
  assert.equal(to.searchParams.get('identifier'), null);
});

test('Data API: current return-URL policy is rechecked after restart for success and error callbacks', { skip }, async () => {
  person = { email: 'pat@example.com', email_verified: true };
  const returnUrl = 'https://app.example.com/back/revoked';
  const success = await pendingAppSignIn(returnUrl);
  const error = await pendingAppSignIn(returnUrl);
  allowedReturnUrls = ['http://127.0.0.1:5000', 'http://localhost:5000/cb'];
  await restartWithCurrentPolicy();

  for (const pending of [success, error]) {
    const outcome = pending === success ? `code=${pending.code}` : 'error=access_denied';
    const response = await fetch(`${base}/tabularius/auth/v1/oidc/callback?${outcome}&state=${pending.state}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    const destination = response.headers.get('location')!;
    assert.match(destination, /^\/app\/#error=/);
    assert.match(decodeURIComponent(destination), /no longer allowed/);
    assert.equal(destination.includes('app.example.com'), false);
    assert.equal((await login(pending.requestId, 'any')).status, 401, 'revoked pending sign-in did not create a grant');
  }

  allowedReturnUrls = ['https://app.example.com/back', 'http://127.0.0.1:5000', 'http://localhost:5000/cb'];
  await restartWithCurrentPolicy();
  const allowed = await pendingAppSignIn(returnUrl);
  const ok = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=${allowed.code}&state=${allowed.state}`, { redirect: 'manual' });
  assert.equal(ok.status, 302);
  const back = new URL(ok.headers.get('location')!);
  assert.equal(back.origin, 'https://app.example.com');
  assert.ok(back.searchParams.get('identifier'));
  assert.equal((await login(allowed.requestId, back.searchParams.get('identifier')!)).status, 200);
});

test('Data API: a callback whose Host names a revoked app is not taken as this server', { skip }, async () => {
  person = { email: 'pat@example.com', email_verified: true };
  allowedReturnUrls = ['https://app.example.com/back', 'http://127.0.0.1:5000', 'http://localhost:5000/cb'];
  await restartWithCurrentPolicy();
  const pending = await pendingAppSignIn('http://localhost:5000/cb/app');
  allowedReturnUrls = ['https://app.example.com/back', 'http://127.0.0.1:5000'];
  await restartWithCurrentPolicy();
  // fetch can't set Host; whoever sends the callback can.
  const location = await new Promise<string>((resolve, reject) => {
    const u = new URL(`${base}/tabularius/auth/v1/oidc/callback?code=${pending.code}&state=${pending.state}`);
    request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { host: 'localhost:5000' } }, (res) => {
      res.resume();
      resolve(String(res.headers.location ?? ''));
    }).on('error', reject).end();
  });
  assert.equal(location.includes('localhost:5000'), false, location);
  assert.equal((await login(pending.requestId, 'any')).status, 401, 'no grant');
});
