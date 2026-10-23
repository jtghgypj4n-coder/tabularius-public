import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type JsonWebKey } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Host } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';
import { Oidc, type OidcProvider } from '../src/oidc.ts';
import { ldapAuthenticate } from '../src/ldap.ts';
import { guardedFetch } from '../src/connections.ts';
import { expiryClock } from '../../store/src/clock.ts';

test('round2: JWT verification rotates JWKS and rejects wrong bindings after a clock jump', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-review-idp-'));
  const host = new Host(dir, () => {}, { background: false });
  const api = new DataApi(host);
  const pairs = [0, 1].map(() => generateKeyPairSync('ec', { namedCurve: 'P-256' }));
  let active = 0, requests = 0;
  const keys = createServer((_req, res) => { requests++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [{ ...pairs[active].publicKey.export({ format: 'jwk' }), kid: `key-${active}`, use: 'sig' }] })); });
  await new Promise<void>((resolve) => keys.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${(keys.address() as { port: number }).port}`;
  const provider: OidcProvider = { name: 'Synthetic', issuer, clientId: 'review-client' };
  const oidc = new Oidc(host, api, provider);
  // Exercise the production verifier and guarded JWKS fetch without a browser or real IdP.
  const verifier = oidc as unknown as { verify(s: { provider: OidcProvider; slug: string; keys?: { value: JsonWebKey[]; at: number } }, jwt: string, discovery: { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }, nonce: string): Promise<Record<string, unknown>> };
  const state = { provider, slug: 'synthetic' };
  const discovery = { issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks' };
  let now = Date.now();
  t.mock.method(expiryClock, 'now', () => now);
  const initial = now;
  const token = (claims: Record<string, unknown> = {}) => {
    const parts = [{ alg: 'ES256', kid: `key-${active}` }, { iss: issuer, aud: provider.clientId, sub: 'person-α', nonce: 'nonce-🦊', iat: Math.floor(initial / 1000), exp: initial / 1000 + 120, ...claims }].map((value) => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return parts + '.' + sign('sha256', Buffer.from(parts), { key: pairs[active].privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  };
  const verify = (jwt: string) => verifier.verify(state, jwt, discovery, 'nonce-🦊');
  try {
    assert.equal((await verify(token())).sub, 'person-α');
    active = 1;
    assert.equal((await verify(token())).sub, 'person-α');
    assert.equal(requests, 2, 'unknown kid refreshes the JWKS cache');
    for (const claims of [{ iss: issuer + '/other' }, { aud: 'other-client' }, { nonce: 'nonce-🦊\u200b' }]) await assert.rejects(verify(token(claims)));
    now += 181_000;
    await assert.rejects(verify(token()), /expired/);
    assert.equal(requests, 2, 'wall time does not expire the monotonic key cache');
  } finally { oidc.close(); await new Promise<void>((resolve) => keys.close(() => resolve())); await host.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('round2: alternate numeric metadata addresses are refused by connector and LDAP before I/O', async () => {
  for (const host of ['2852039166', '0xa9fea9fe', '169.254.169.254']) {
    await assert.rejects(guardedFetch(`http://${host}/`), /link.local|metadata|not allowed|refused/i);
    await assert.rejects(ldapAuthenticate({ name: 'Synthetic', url: `ldap://${host}`, bindDnTemplate: 'uid={user}' }, 'synthetic-user', 'synthetic-password'), /link.local|metadata|not allowed|refused/i);
  }
});
