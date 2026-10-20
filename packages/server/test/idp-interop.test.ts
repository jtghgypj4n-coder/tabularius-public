import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createStore } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { serve } from '../src/index.ts';
import type { Store } from '../../store/src/index.ts';

type Case = { name: string; oidc: { groupClaim?: string; trustEmail?: boolean; claims: Record<string, unknown>; expect: string } };
type ScimExercise = { lookup: string; create: Record<string, unknown>; group: string; groupAdd: Record<string, unknown>; oktaPatch: Record<string, unknown>; authentikPut: Record<string, unknown>; authentikGroupPut: Record<string, unknown>; deactivate: Record<string, unknown>; reactivate: Record<string, unknown>; invalidFilter: string };
const matrix = JSON.parse(readFileSync(new URL('./idp-interop-cases.json', import.meta.url), 'utf8')) as {
  common: { discovery: string[]; jwks: { keys: { kid: string; use: string; alg: string }[] } };
  providers: Case[]; scimExercise: ScimExercise;
};
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const codes = new Map<string, { nonce: string; challenge: string; claims: Record<string, unknown>; bad?: 'signature' | 'issuer' | 'audience' | 'nonce' | 'expired' }>();
let dir: string, base: string, issuer: string, store: Store, app: Server, idp: Server, marker: string, oldPath: string | undefined;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-idp-interop-'));
  const stub = join(dir, 'stub-path');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(stub);
  marker = join(dir, 'child-command-marker');
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    const path = join(stub, name);
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${name}' >> '${marker}'\nexit 99\n`);
    chmodSync(path, 0o755);
  }
  oldPath = process.env.PATH;
  process.env.PATH = stub;
  idp = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    const send = (value: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    if (url.pathname === '/.well-known/openid-configuration') {
      const discovery = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` };
      assert.deepEqual(Object.keys(discovery), matrix.common.discovery);
      return send(discovery);
    }
    if (url.pathname === '/jwks') return send({ keys: [{ ...matrix.common.jwks.keys[0], ...publicKey.export({ format: 'jwk' }) }] });
    if (url.pathname !== '/token') return send({ error: 'not_found' }, 404);
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw), item = codes.get(form.get('code') ?? '');
    if (!item || createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== item.challenge) return send({ error: 'invalid_grant' }, 400);
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: item.bad === 'issuer' ? `${issuer}/other` : issuer, aud: item.bad === 'audience' ? 'other-client' : 'tabularius',
      sub: 'generated-subject', exp: item.bad === 'expired' ? now - 3600 : now + 300, nonce: item.bad === 'nonce' ? 'other-nonce' : item.nonce, ...item.claims };
    const head = `${b64({ alg: matrix.common.jwks.keys[0].alg, kid: matrix.common.jwks.keys[0].kid, typ: 'JWT' })}.${b64(claims)}`;
    const signature = sign('sha256', Buffer.from(head), privateKey);
    if (item.bad === 'signature') signature[0] ^= 1;
    return send({ id_token: `${head}.${signature.toString('base64url')}` });
  });
  await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;
  createStore(join(dir, 'Interop' + STORE_EXT));
  const served = await serve({ dir, port: 0, watch: false, log: () => {}, oidc: matrix.providers.map((p) => ({
    name: p.name, issuer, clientId: 'tabularius', ...(p.oidc.groupClaim ? { groupsClaim: p.oidc.groupClaim } : {}),
    ...(p.oidc.trustEmail ? { trustEmail: true } : {}),
  })) });
  app = served.server;
  base = served.url;
  store = served.host.get('Interop')!;
  store.savePrivilegeSet({ name: 'Team Set', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmapp', 'fmrest'] });
  store.setExternalAccount('Team', 'Team Set');
  store.setExternalAccount('google@example.test', 'Team Set');
});

after(async () => {
  await new Promise<void>((resolve) => app?.close(() => resolve()) ?? resolve());
  await new Promise<void>((resolve) => idp?.close(() => resolve()) ?? resolve());
  process.env.PATH = oldPath;
  if (marker && existsSync(marker)) assert.fail(`unexpected child command: ${readFileSync(marker, 'utf8')}`);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function signIn(provider: string, claims: Record<string, unknown>, bad?: 'signature' | 'issuer' | 'audience' | 'nonce' | 'expired'): Promise<string> {
  const slug = provider.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const start = await fetch(`${base}/tabularius/auth/v1/oidc/start/${slug}?db=Interop`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('location')!);
  const code = crypto.randomUUID();
  codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')!, claims, ...(bad ? { bad } : {}) });
  const callback = await fetch(`${base}/tabularius/auth/v1/oidc/callback?code=${code}&state=${auth.searchParams.get('state')}`, { redirect: 'manual' });
  assert.equal(callback.status, 302);
  return decodeURIComponent(callback.headers.get('location') ?? '');
}

function token(location: string): string | undefined {
  return new URLSearchParams(location.split('#')[1] ?? '').get('token') ?? undefined;
}

async function scim(method: string, path: string, bearer: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}/tabularius/scim/v2/databases/Interop${path}`, {
    method, headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/scim+json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  return { status: response.status, body: raw ? JSON.parse(raw) : undefined };
}

test('documented and configured provider claim shapes resolve sign-in mappings', async () => {
  assert.equal(matrix.providers.length, 7);
  for (const p of matrix.providers) {
    const email = p.name === 'Google Workspace' ? 'google@example.test' : `${p.name.toLowerCase().replace(/[^a-z]/g, '')}@example.test`;
    const location = await signIn(p.name, { email, ...p.oidc.claims });
    assert.ok(token(location), `${p.name}: ${location}`);
    const response = await fetch(`${base}/fmi/data/vLatest/databases/Interop/layouts`, { headers: { authorization: `Bearer ${token(location)}` } });
    assert.equal(response.status, 200, `${p.name}: ${await response.text()}`);
  }
});

test('group overage is refused when the configured group claim is the one left out, even when an email mapping exists', async () => {
  store.setExternalAccount('overage@example.test', 'Team Set');
  const location = await signIn('Okta', { email: 'overage@example.test', email_verified: true, sub: 'pairwise-generated', _claim_names: { groups: 'src1' }, _claim_sources: { src1: { endpoint: 'http://127.0.0.1/never-fetch' } } });
  assert.equal(token(location), undefined);
  assert.match(location, /omitted group membership/);
  for (const hasgroups of [true, 'true']) {
    const flagged = await signIn('Okta', { email: 'overage@example.test', email_verified: true, hasgroups });
    assert.equal(token(flagged), undefined, `hasgroups ${JSON.stringify(hasgroups)}`);
  }
  const roles = await signIn('PingOne', { email: 'overage@example.test', email_verified: true, roles: ['Team'], _claim_names: { roles: 'src1' } });
  assert.equal(token(roles), undefined, 'a provider that reads roles is refused when roles is what overflowed');
});

test('group overage in a claim the provider does not read does not lock people out', async () => {
  store.setExternalAccount('wids@example.test', 'Team Set');
  const entra = await signIn('Entra ID', { email: 'wids@example.test', sub: 'pairwise-generated', wids: ['Team'], hasgroups: true, _claim_names: { groups: 'src1' } });
  assert.ok(token(entra), entra);
  const ping = await signIn('PingOne', { email: 'wids@example.test', email_verified: true, roles: ['Team'], _claim_names: { groups: 'src1' } });
  assert.ok(token(ping), ping);
});

test('an absent or null group claim falls back to the email mapping; a non-string entry is refused', async () => {
  store.setExternalAccount('nullgroups@example.test', 'Team Set');
  const none = await signIn('Okta', { email: 'nullgroups@example.test', email_verified: true, groups: null });
  assert.ok(token(none), none);
  const number = await signIn('Okta', { email: 'nullgroups@example.test', email_verified: true, groups: [123] });
  assert.equal(token(number), undefined);
});

test('invalid ID tokens and non-string group claims are refused', async () => {
  for (const bad of ['signature', 'issuer', 'audience', 'nonce', 'expired'] as const) {
    const location = await signIn('Okta', { email: 'invalid@example.test', email_verified: true, groups: ['Team'] }, bad);
    assert.equal(token(location), undefined, bad);
  }
  const malformed = await signIn('Okta', { email: 'invalid@example.test', email_verified: true, groups: [{ name: 'Team' }] });
  assert.equal(token(malformed), undefined);
  assert.match(malformed, /invalid group claim/);
});

test('SCIM Users and Groups requests map privileges and revoke sessions and person tokens on deprovision', async () => {
  const exercise = matrix.scimExercise;
  const bearer = new (await import('../src/scim.ts')).ScimDirectory(store).issueToken();
  const list = await scim('GET', '/Users?filter=' + encodeURIComponent(exercise.lookup) + '&startIndex=1&count=20', bearer);
  assert.equal(list.status, 200);
  assert.equal(list.body.totalResults, 0);
  const created = await scim('POST', '/Users', bearer, exercise.create);
  assert.equal(created.status, 201);
  const gid = Buffer.from(exercise.group).toString('base64url');
  const groupAdd = JSON.parse(JSON.stringify(exercise.groupAdd).replaceAll('$USER_ID', created.body.id));
  const added = await scim('PATCH', `/Groups/${gid}`, bearer, groupAdd);
  assert.equal(added.status, 200);
  assert.equal(store.accountPrivilegeSet('deprov@example.test'), exercise.group);
  const patched = await scim('PATCH', `/Users/${created.body.id}`, bearer, exercise.oktaPatch);
  assert.equal(patched.status, 200);
  assert.equal(patched.body.displayName, 'Generated Person');
  const replaced = await scim('PUT', `/Users/${created.body.id}`, bearer, exercise.authentikPut);
  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.displayName, 'Generated Person via PUT');
  const groupReplaced = await scim('PUT', `/Groups/${gid}`, bearer, JSON.parse(JSON.stringify(exercise.authentikGroupPut).replaceAll('$USER_ID', created.body.id)));
  assert.equal(groupReplaced.status, 200);
  assert.equal(store.accountPrivilegeSet('deprov@example.test'), exercise.group);
  const session = token(await signIn('Okta', { email: 'deprov@example.test', email_verified: true, groups: ['Team'] }));
  assert.ok(session);
  const delegated = store.createApiToken('Team', { identity: { issuer, sub: 'generated-subject', person: 'deprov@example.test', mapping: 'Team' }, surfaces: ['fmrest'] });
  const owned = store.createApiToken('deprov@example.test', { surfaces: ['fmrest'] });
  assert.ok(store.apiToken(delegated));
  assert.ok(store.apiToken(owned));
  const off = await scim('PATCH', `/Users/${created.body.id}`, bearer, exercise.deactivate);
  assert.equal(off.status, 200);
  assert.equal(off.body.active, false);
  assert.equal(store.apiToken(delegated), undefined);
  assert.equal(store.apiToken(owned), undefined);
  assert.ok(!store.apiTokens().some((x) => delegated.startsWith(`ohbt_${x.id}.`)));
  assert.ok(!store.apiTokens().some((x) => owned.startsWith(`ohbt_${x.id}.`)));
  const oldSession = await fetch(`${base}/fmi/data/vLatest/databases/Interop/layouts`, { headers: { authorization: `Bearer ${session}` } });
  assert.equal(oldSession.status, 401);
  const reactivated = await scim('PATCH', `/Users/${created.body.id}`, bearer, exercise.reactivate);
  assert.equal(reactivated.status, 200);
  assert.equal(store.apiToken(delegated), undefined, 'deprovisioned token stays revoked after reactivation');
  assert.equal(store.apiToken(owned), undefined, 'the person\'s own token stays revoked after reactivation');
  const badFilter = await scim('GET', '/Users?filter=' + encodeURIComponent(exercise.invalidFilter), bearer);
  assert.equal(badFilter.status, 400);
  assert.equal(badFilter.body.scimType, 'invalidFilter');
  const unauthorized = await scim('GET', '/Users', bearer + '-wrong');
  assert.equal(unauthorized.status, 401);
  const deleted = await scim('DELETE', `/Users/${created.body.id}`, bearer);
  assert.equal(deleted.status, 204);
  assert.equal(store.accountInactive('deprov@example.test'), true);
});

test('creating an inactive SCIM user revokes a taken-over external account session and token', async () => {
  store.setExternalAccount('takeover@example.test', 'Team Set');
  const session = token(await signIn('Okta', { email: 'takeover@example.test', email_verified: true, groups: ['Team'] }));
  assert.ok(session);
  const owned = store.createApiToken('takeover@example.test', { surfaces: ['fmrest'] });
  const bearer = new (await import('../src/scim.ts')).ScimDirectory(store).issueToken();
  const created = await scim('POST', '/Users', bearer, { userName: 'takeover@example.test', active: false });
  assert.equal(created.status, 201);
  assert.equal(store.accountInactive('takeover@example.test'), true);
  assert.ok(!store.apiTokens().some((x) => owned.startsWith(`ohbt_${x.id}.`)));
  const oldSession = await fetch(`${base}/fmi/data/vLatest/databases/Interop/layouts`, { headers: { authorization: `Bearer ${session}` } });
  assert.equal(oldSession.status, 401);
});

test('an attribute-only SCIM update of an inactive full-access account revokes nothing', async () => {
  const { ScimDirectory } = await import('../src/scim.ts');
  const bearer = new ScimDirectory(store).issueToken();
  const created = await scim('POST', '/Users', bearer, { userName: 'fulladmin@example.test', active: true });
  assert.equal(created.status, 201);
  const off = await scim('PATCH', `/Users/${created.body.id}`, bearer, { Operations: [{ op: 'replace', path: 'active', value: false }] });
  assert.equal(off.status, 200);
  store.setAccountPrivilegeSet('fulladmin@example.test', '[Full Access]', { by: 'admin' });
  const owned = store.createApiToken('fulladmin@example.test', { surfaces: ['fmrest'] });
  const edited = await scim('PATCH', `/Users/${created.body.id}`, bearer, { Operations: [{ op: 'replace', path: 'displayName', value: 'Renamed' }] });
  assert.equal(edited.status, 200);
  assert.ok(store.apiTokens().some((x) => owned.startsWith(`ohbt_${x.id}.`)), 'provisioning does not touch a full-access account\'s tokens');
});
