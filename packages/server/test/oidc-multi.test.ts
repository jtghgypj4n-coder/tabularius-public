// More than one identity provider at once, domain-mapped external accounts,
// and a provider that replies with form_post and an Apple-style signed secret.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Store } from '../../store/src/index.ts';
import { emailTrusted, type OidcProvider } from '../src/oidc.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** A stand-in OpenID provider with its own RSA signing key and token endpoint. */
class Idp {
  readonly server: Server;
  issuer = '';
  person: Record<string, unknown> = {};
  readonly codes = new Map<string, { nonce: string; challenge: string }>();
  readonly key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  /** Set to verify the code exchange's client_secret as an ES256 JWT (Apple). */
  appleVerify?: { publicKey: ReturnType<typeof createPublicKey>; teamId: string; clientId: string };

  constructor() {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url!, this.issuer);
      const send = (body: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (url.pathname === '/.well-known/openid-configuration') {
        send({ issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks` });
      } else if (url.pathname === '/jwks') {
        send({ keys: [{ ...this.key.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
      } else if (url.pathname === '/token') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const form = new URLSearchParams(body);
        const c = this.codes.get(form.get('code') ?? '');
        if (!c || createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== c.challenge || form.get('client_id') !== 'tabularius') {
          return send({ error: 'invalid_grant' }, 400);
        }
        if (this.appleVerify && !this.checkAppleSecret(form.get('client_secret') ?? '')) return send({ error: 'invalid_client' }, 400);
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: this.issuer, aud: 'tabularius', sub: 'u1', exp: now + 300, iat: now, nonce: c.nonce, ...this.person };
        const head = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64(claims)}`;
        send({ id_token: `${head}.${sign('sha256', Buffer.from(head), this.key.privateKey).toString('base64url')}` });
      } else send({ error: 'not found' }, 404);
    });
  }
  async listen(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.issuer = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }
  private checkAppleSecret(jwt: string): boolean {
    const [h, p, sig] = jwt.split('.');
    if (!sig) return false;
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
    if (claims.iss !== this.appleVerify!.teamId || claims.sub !== this.appleVerify!.clientId || claims.aud !== this.issuer) return false;
    return verify('sha256', Buffer.from(`${h}.${p}`), { key: this.appleVerify!.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  }
}

let dir: string;
let server: Server;
let base: string;
let store: Store;
const google = new Idp();
const apple = new Idp();
const appleKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });

before(async () => {
  if (skip) return;
  await google.listen();
  await apple.listen();
  apple.appleVerify = { publicKey: appleKey.publicKey, teamId: 'TEAM123', clientId: 'tabularius' };

  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({
    dir, port: 0, log: () => {},
    oidc: [
      { name: 'Google', issuer: google.issuer, clientId: 'tabularius' },
      { name: 'Apple', issuer: apple.issuer, clientId: 'tabularius', formPost: true,
        appleSecret: { teamId: 'TEAM123', keyId: 'KEY123', privateKey: appleKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string } },
    ],
  });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  // A whole domain maps to one external account (beyond FileMaker).
  store.setExternalAccount('@example.com', store.privilegeSets().find((p) => p.id === 1)!.name);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  google.server.close();
  apple.server.close();
  if (dir) rmSync(dir, { recursive: true });
});

test('both providers are listed with distinct slugs', { skip }, async () => {
  const { providers } = await fetch(`${base}/tabularius/auth/v1/providers`).then((r) => r.json());
  assert.deepEqual(providers.map((p: { name: string; slug: string }) => [p.name, p.slug]), [['Google', 'google'], ['Apple', 'apple']]);
  assert.deepEqual(providers.map((p: { start: string }) => p.start), ['/tabularius/auth/v1/oidc/start/google', '/tabularius/auth/v1/oidc/start/apple']);
});

test('start/<slug> routes to the chosen provider and maps by email domain', { skip }, async () => {
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start/google?db=Charts`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('location')!);
  assert.equal(auth.origin, google.issuer, 'went to Google, not Apple');
  const code = 'g-' + Math.random().toString(36).slice(2);
  google.codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
  google.person = { email: 'sam@example.com', email_verified: true }; // no exact account, no group — a verified email's domain carries it
  const back = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=${code}&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
  const to = new URLSearchParams(back.headers.get('location')!.slice('/app/#'.length));
  assert.equal(to.get('db'), 'Charts', back.headers.get('location')!);
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${to.get('token')}` } }).then((x) => x.json());
  assert.equal(r.messages[0].code, '0');
});

test('an unknown provider slug is refused', { skip }, async () => {
  const r = await fetch(`${base}/tabularius/auth/v1/oidc/start/nope?db=Charts`, { redirect: 'manual' });
  assert.match(decodeURIComponent(r.headers.get('location')!), /provider/i);
});

test('a form_post provider signs in over POST with an Apple-style signed secret', { skip }, async () => {
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start/apple?db=Charts`, { redirect: 'manual' });
  const auth = new URL(start.headers.get('location')!);
  assert.equal(auth.origin, apple.issuer);
  assert.equal(auth.searchParams.get('response_mode'), 'form_post');
  const code = 'a-' + Math.random().toString(36).slice(2);
  apple.codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
  apple.person = { email: 'chris@example.com', email_verified: 'true' }; // Apple sends it as a string
  const back = await fetch(`${base}/tabularius/auth/v1/oidc/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, state: auth.searchParams.get('state')! }).toString(),
    redirect: 'manual',
  });
  const to = new URLSearchParams(back.headers.get('location')!.slice('/app/#'.length));
  assert.equal(to.get('db'), 'Charts', back.headers.get('location')!);
  assert.ok(to.get('token'));
});

/** Signs in through Google with these ID token claims; the redirect's location. */
async function viaGoogle(person: Record<string, unknown>): Promise<string> {
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start/google?db=Charts`, { redirect: 'manual' });
  const auth = new URL(start.headers.get('location')!);
  const code = 'g-' + Math.random().toString(36).slice(2);
  google.codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
  google.person = person;
  const back = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=${code}&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
  return decodeURIComponent(back.headers.get('location') ?? '');
}

test('an email signs in only when the provider verified it', { skip }, async () => {
  // Anyone who can put an address into a provider's email claim would otherwise get in.
  const unsaid = await viaGoogle({ email: 'mallory@example.com' });
  assert.ok(!unsaid.includes('token='), unsaid);
  assert.match(unsaid, /Google didn't say it verified mallory@example\.com/);
  assert.ok(!(await viaGoogle({ email: 'mallory@example.com', email_verified: false })).includes('token='));
  assert.ok(!(await viaGoogle({ email: 'mallory@example.com', email_verified: 'false' })).includes('token='));
  // Microsoft Entra's xms_edov says the domain is the tenant's own.
  assert.ok((await viaGoogle({ email: 'sam@example.com', xms_edov: true })).includes('token='));
  // An account for the exact address doesn't change that: the address is still unproven.
  store.setExternalAccount('mallory@example.com', store.privilegeSets().find((p) => p.id === 1)!.name);
  const exact = await viaGoogle({ email: 'mallory@example.com' });
  assert.ok(!exact.includes('token='), exact);
  assert.ok((await viaGoogle({ email: 'mallory@example.com', email_verified: true })).includes('token='));
  // The refusal reads the same whether or not an account is named for the address, so it can't probe for one.
  assert.match(await viaGoogle({ email: 'nobody@nowhere.test' }), /Google didn't say it verified nobody@nowhere\.test/);
  // A group named like an address or a domain doesn't stand in for an unverified email.
  assert.ok(!(await viaGoogle({ email: 'mallory@example.com', groups: ['@example.com'] })).includes('token='));
  assert.ok(!(await viaGoogle({ email: 'mallory@example.com', groups: ['mallory@example.com'] })).includes('token='));
  // A group match alone has no person identity that can be revoked later.
  store.setExternalAccount('Staff', store.privilegeSets().find((p) => p.id === 1)!.name);
  const grouped = await viaGoogle({ email: 'pat@elsewhere.test', groups: ['Staff'] });
  assert.ok(!grouped.includes('token='), grouped);
});

test('which providers are trusted for email', () => {
  const p = { name: 'X', issuer: 'https://idp.test', clientId: 'c' } as OidcProvider;
  assert.equal(emailTrusted(p, {}), false);
  assert.equal(emailTrusted(p, { email_verified: true }), true);
  assert.equal(emailTrusted(p, { email_verified: 'true' }), true);
  assert.equal(emailTrusted(p, { xms_edov: 1 }), true);
  assert.equal(emailTrusted(p, { email_verified: false, xms_edov: false }), false);
  assert.equal(emailTrusted({ ...p, trustEmail: true }, {}), true);
  // Only a real true turns it on: a config that says "false" doesn't.
  assert.equal(emailTrusted({ ...p, trustEmail: 'false' as unknown as boolean }, {}), false);
  // An organisation's own Entra tenant owns its addresses; the shared personal-account tenant doesn't.
  const tenant = (id: string) => ({ ...p, issuer: `https://login.microsoftonline.com/${id}/v2.0` });
  assert.equal(emailTrusted(tenant('0b2a7c1e-5d3f-4a8b-9c6d-1e2f3a4b5c6d'), {}), true);
  assert.equal(emailTrusted(tenant('9188040d-6c67-4c5b-b112-36a304b66dad'), {}), false);
  assert.equal(emailTrusted(tenant('common'), {}), false);
  // A guest in the tenant brings an address from elsewhere, so it needs xms_edov.
  const own = tenant('0b2a7c1e-5d3f-4a8b-9c6d-1e2f3a4b5c6d');
  assert.equal(emailTrusted(own, { iss: own.issuer, idp: own.issuer }), true);
  assert.equal(emailTrusted(own, { iss: own.issuer, idp: 'https://sts.windows.net/11111111-2222-3333-4444-555555555555/' }), false);
  assert.equal(emailTrusted(own, { iss: own.issuer, idp: 'live.com' }), false);
  assert.equal(emailTrusted(own, { iss: own.issuer, acct: 1 }), false);
  assert.equal(emailTrusted(own, { iss: own.issuer, idp: 'live.com', xms_edov: true }), true);
  assert.equal(emailTrusted({ ...p, issuer: 'https://login.microsoftonline.com.evil.test/0b2a7c1e-5d3f-4a8b-9c6d-1e2f3a4b5c6d/v2.0' }, {}), false);
});
