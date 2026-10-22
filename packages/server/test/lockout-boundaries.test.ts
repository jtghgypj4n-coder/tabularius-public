import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCKOUT } from '../../store/src/index.ts';
import { setup, snapshot, FROM, median, basic, REDIRECT, verifier } from './lockout-matrix-helpers.ts';
import { forwardedFor, trustedProxyAddresses, useForwardedFor } from '../src/client-address.ts';
import type { IncomingMessage } from 'node:http';
import { registerAdminPasskey } from '../src/admin-passkey.ts';
import { makeAuthenticator, forgeRegistration } from '../../store/test/forge-webauthn.ts';
import { ScimDirectory } from '../src/scim.ts';

for (const header of ['x-forwarded-for', 'forwarded', 'x-real-ip'] as const) test(`${header}: trust, missing configuration, IP forms and spoofed loopback`, async (t) => {
  const s = await setup(t, { proxyHeader: header });
  const value = (ip: string) => header === 'forwarded' ? `for="[${ip}]"` : ip;
  for (let i = 0; i < LOCKOUT.attempts; i++) {
    const ip = i % 2 ? '2001:0DB8:0001:0002:0:0:0:1' : '2001:db8:1:2::1';
    await (await fetch(s.url + '/fmi/data/vLatest/databases/Synthetic/sessions', { method: 'POST', headers: { authorization: basic('Alice'), [header]: value(ip) }, body: '{}' })).text();
  }
  assert.ok(s.store.lockedOut('Alice', '2001:db8:1:2::1'));
  const trusted = trustedProxyAddresses(['127.0.0.1', '192.0.2.0/24']);
  const req = (peer: string, ip: string) => ({ socket: { remoteAddress: peer }, headers: { [header]: value(ip) } }) as unknown as IncomingMessage;
  for (const peer of ['127.0.0.1', '192.0.2.9']) {
    assert.equal(forwardedFor(req(peer, '2001:db8::1'), header, trusted), '2001:db8::1');
    // With no proxy header configured, a loopback peer carrying forwarding headers is an unknown visitor; any other peer is itself.
    assert.equal(forwardedFor(req(peer, '2001:db8::1'), undefined, trusted), peer === '127.0.0.1' ? 'unknown' : peer);
    // A loopback address in a trusted proxy's header is refused before authentication, never treated as this computer.
    for (const ip of ['0:0:0:0:0:0:0:1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:2']) assert.equal(useForwardedFor(req(peer, ip), header, trusted), false);
  }
  assert.equal(forwardedFor(req('192.0.3.9', '2001:db8::1'), header, trusted), '192.0.3.9', 'a header from an untrusted peer is ignored');
});

test('unconfigured proxy addresses share the account budget and have equal unknown-name refusals', async (t) => {
  const s = await setup(t, { proxyHeader: undefined });
  const timings: number[][] = [[], []];
  let baseline: Awaited<ReturnType<typeof snapshot>> | undefined;
  for (let i = 0; i < 3; i++) for (const j of i % 2 ? [1, 0] : [0, 1]) {
    const name = j ? 'Ghost' : 'Alice', start = process.hrtime.bigint();
    const result = await snapshot(await s.routes['Data API'](name, 'wrong', `198.51.100.${i + 1}`), name);
    timings[j].push(Number(process.hrtime.bigint() - start) / 1e6);
    if (!baseline) baseline = result;
    assert.deepEqual(result, baseline);
  }
  assert.ok(Math.max(...timings.map(median)) <= 3 * Math.min(...timings.map(median)) + 100);
  for (let i = 3; i < LOCKOUT.attempts; i++) await (await s.routes.web('Alice', 'wrong', `198.51.100.${i + 1}`)).text();
  assert.ok(s.store.lockedOut('Alice', 'unknown'));
  assert.equal(s.store.addressLockedOut('unknown'), undefined);
});

test('OAuth form decoding counts percent-encoded case/space variants in the same bucket', async (t) => {
  const s = await setup(t);
  for (const name of ['Alice', 'ALICE', 'Alice ', ' Alice', 'Ａｌｉｃｅ']) await (await s.authorize(name, 'wrong')).text();
  assert.ok(s.store.lockedOut('Alice', FROM));
  assert.equal((await s.authorize('Alice', 'correct')).status, 401);
});

for (const mode of ['passkey', 'recovery'] as const) test(`${mode}: failures spend the shared address budget and refuse existing/unknown names equally`, async (t) => {
  const s = await setup(t);
  const bad = (account: string) => s.json(`/fmi/data/vLatest/databases/Synthetic/sessions/${mode}`, mode === 'recovery' ? { account, code: 'invalid' } : { account, response: { credentialId: 'missing', clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA', challenge: 'missing' } });
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) await (await bad(`missing${i}`)).text();
  assert.ok(s.store.addressLockedOut(FROM));
  const mono = performance.now(), wall = Date.now();
  t.mock.method(performance, 'now', () => mono);
  t.mock.method(Date, 'now', () => wall);
  const a = await snapshot(await bad('Alice'), 'Alice');
  const b = await snapshot(await bad('Ghost'), 'Ghost');
  assert.equal(a.status, 401);
  assert.ok(Number(a.headers['retry-after']) > 0);
  assert.deepEqual(a, b);
  assert.equal((await s.routes['Data API']('Alice', 'correct')).status, 401);
});

test('console password, passkey, Admin API, backup and restore share the console lockout; sessions survive', async (t) => {
  const s = await setup(t);
  const headers = { 'x-tabularius-admin': '1' };
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) s.store.countAddressFailure(FROM);
  const signedIn = await s.json('/tabularius/admin/v1/sign-in', { password: 'console-secret' }, headers);
  assert.equal(signedIn.status, 200, 'file lockouts cannot lock the console');
  s.store.unlockAddress(FROM);
  const cookie = signedIn.headers.get('set-cookie')!.split(';')[0];
  await signedIn.text();
  const tokenResponse = await s.json('/fmi/admin/api/v2/user/auth', {}, { authorization: basic('any', 'console-secret') });
  assert.equal(tokenResponse.status, 200);
  const token = (await tokenResponse.json()).response.token;
  const origin = new URL(s.url);
  const auth = makeAuthenticator(origin.hostname, origin.origin);
  registerAdminPasskey(s.host.dir, forgeRegistration(auth, 'synthetic-registration'), { rpId: origin.hostname, origin: origin.origin, challenge: 'synthetic-registration' });
  // A valid challenge with an invalid assertion counts alongside the password paths.
  const options = await (await s.json('/tabularius/admin/v1/passkey-sign-in', {}, headers)).json();
  assert.ok(options.challenge);
  await (await s.json('/tabularius/admin/v1/passkey-sign-in', { response: { challenge: options.challenge, credentialId: 'missing', clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' } }, headers)).text();
  const routes = [
    () => s.json('/tabularius/admin/v1/sign-in', { password: 'wrong' }, headers),
    () => s.json('/fmi/admin/api/v2/user/auth', {}, { authorization: basic('any') }),
    () => s.json('/tabularius/admin/v1/backup', {}, { ...headers, authorization: basic('any') }),
    () => s.json('/tabularius/admin/v1/restore', {}, { ...headers, authorization: basic('any') }),
  ];
  for (const call of routes) await (await call()).text();
  for (const call of routes) {
    const r = await call();
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    await r.text();
  }
  assert.equal((await s.json('/tabularius/admin/v1/passkey-sign-in', { response: { challenge: 'missing' } }, headers)).status, 429);
  assert.equal((await s.call('/tabularius/admin/v1/status', { headers: { cookie, ...headers } })).status, 200);
  assert.equal((await s.call('/fmi/admin/api/v2/server/status', { headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await s.json('/tabularius/admin/v1/sign-in', { password: 'console-secret' }, headers, '198.51.100.7')).status, 200);
  assert.equal((await s.routes['Data API']('Alice', 'correct')).status, 200, 'console lockouts cannot lock file accounts');
});

test('SCIM, OAuth code/token exchange and existing bearer sessions remain authenticated through password lockouts', async (t) => {
  const s = await setup(t);
  const scimToken = new ScimDirectory(s.store).issueToken();
  const login = await s.routes['Data API']('Alice', 'correct');
  const session = (await login.json()).response.token;
  const codeResponse = await s.authorize('Alice', 'correct');
  assert.equal(codeResponse.status, 302);
  const code = new URL(codeResponse.headers.get('location')!).searchParams.get('code')!;
  const scim = (token: string, file = 'Synthetic') => s.call(`/tabularius/scim/v2/databases/${file}/Users`, { headers: { authorization: `Bearer ${token}` } });
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) {
    assert.equal((await scim(`bad-${i}`)).status, 401);
    const bad = await s.form('/oauth/token', { grant_type: 'authorization_code', client_id: s.client_id, code: `bad-${i}`, code_verifier: verifier });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'invalid_grant');
  }
  assert.equal(s.store.addressLockedOut(FROM), undefined, 'unguessable bearer credentials do not spend password budgets');
  assert.deepEqual(await snapshot(await scim('bad'), ''), await snapshot(await scim('bad', 'Missing'), ''));
  const passwordGrant = await s.form('/oauth/token', { grant_type: 'password', client_id: s.client_id, username: 'Alice', password: 'correct' });
  assert.equal((await passwordGrant.json()).error, 'unsupported_grant_type');
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) s.store.countAddressFailure(FROM);
  assert.equal((await scim(scimToken)).status, 200);
  assert.equal((await s.call('/fmi/data/vLatest/databases/Synthetic/layouts', { headers: { authorization: `Bearer ${session}` } })).status, 200);
  const exchanged = await s.form('/oauth/token', { grant_type: 'authorization_code', client_id: s.client_id, code, code_verifier: verifier, redirect_uri: REDIRECT });
  assert.equal(exchanged.status, 200);
  const tokens = await exchanged.json();
  assert.ok(tokens.access_token);
  const replay = await s.form('/oauth/token', { grant_type: 'authorization_code', client_id: s.client_id, code, code_verifier: verifier });
  assert.equal((await replay.json()).error, 'invalid_grant');
  const refresh = await s.form('/oauth/token', { grant_type: 'refresh_token', client_id: s.client_id, refresh_token: tokens.refresh_token });
  assert.equal(refresh.status, 200);
});
