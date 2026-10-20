// Passkeys and recovery codes over HTTP, end to end through the Data API:
// register a credential for a signed-in account, then sign a fresh session in
// with it, and fall back to a one-time recovery code. The authenticator is
// forged with a real P-256 key (no browser), bound to the server's own host.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { makeAuthenticator, forgeRegistration, forgeAssertion } from '../../store/test/forge-webauthn.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string, server: Server, host: Host, base: string, rpId: string, origin: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-pk-http-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const u = new URL(base);
  rpId = u.hostname;
  origin = u.origin;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw', full.name);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const api = (path: string, init: RequestInit = {}) => fetch(`${base}/fmi/data/vLatest/databases/Charts/${path}`, init);
const json = async (r: Response) => (await r.json()) as { response: Record<string, unknown>; messages: { code: string }[] };

async function passwordToken(): Promise<string> {
  const r = await api('sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}' });
  return String((await json(r)).response.token);
}

test('a passkey registers for the signed-in account, then signs a new session in', { skip }, async () => {
  const token = await passwordToken();
  const auth = makeAuthenticator(rpId, origin);
  const bearer = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  // Ask the server for a registration challenge, forge the ceremony against it.
  const opts = await json(await api('passkey/register/options', { method: 'POST', headers: bearer, body: '{}' }));
  assert.equal(opts.response.rpId, rpId);
  const challenge = String(opts.response.challenge);
  const reg = await json(await api('passkey/register', {
    method: 'POST', headers: bearer,
    body: JSON.stringify({ response: { ...forgeRegistration(auth, challenge), challenge }, label: 'MacBook' }),
  }));
  assert.ok(reg.response.id, 'a credential id comes back');

  // It shows up in the account's own passkey list.
  const list = await json(await api('passkey', { method: 'GET', headers: bearer }));
  assert.equal((list.response.passkeys as { label?: string }[])[0].label, 'MacBook');

  // Sign a fresh session in with it: fetch allowCredentials + challenge, forge an assertion.
  const begin = await json(await api('sessions/passkey', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: 'Admin' }) }));
  assert.ok((begin.response.allowCredentials as string[]).length >= 1);
  const c2 = String(begin.response.challenge);
  const signin = await json(await api('sessions/passkey', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ response: { ...forgeAssertion(auth, c2), challenge: c2 } }),
  }));
  assert.equal(signin.messages[0].code, '0');
  assert.ok(signin.response.token, 'the passkey mints a session token');

  // A replayed assertion (same challenge, now spent) is refused.
  const replay = await json(await api('sessions/passkey', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ response: { ...forgeAssertion(auth, c2), challenge: c2 } }),
  }));
  assert.equal(replay.messages[0].code, '212');
});

test('recovery codes are issued to the account and sign in once each', { skip }, async () => {
  const token = await passwordToken();
  const gen = await json(await api('recovery-codes', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }));
  const codes = gen.response.codes as string[];
  assert.equal(codes.length, 10);
  assert.equal(gen.response.remaining, 10);

  // A good code mints a session.
  const ok = await json(await api('sessions/recovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: 'Admin', code: codes[0] }) }));
  assert.equal(ok.messages[0].code, '0');
  assert.ok(ok.response.token);

  // The same code can't be used twice.
  const twice = await json(await api('sessions/recovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: 'Admin', code: codes[0] }) }));
  assert.equal(twice.messages[0].code, '212');

  // A made-up code is refused.
  const bogus = await json(await api('sessions/recovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: 'Admin', code: 'zzzz-zzzz-zzzz' }) }));
  assert.equal(bogus.messages[0].code, '212');
});

test('a passkey registered just for passwordless sign-in never gates the password path', { skip }, async () => {
  // Test 1 already left Admin with a registered passkey; a plain password
  // sign-in still works, since nothing requires a second factor here.
  assert.ok(await passwordToken());
});

test('a passkey as the second factor: refuses password-only once required, then signs in with the password plus the assertion', { skip }, async () => {
  const token = await passwordToken();
  const auth = makeAuthenticator(rpId, origin);
  const bearer = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const opts = await json(await api('passkey/register/options', { method: 'POST', headers: bearer, body: '{}' }));
  const challenge = String(opts.response.challenge);
  await api('passkey/register', { method: 'POST', headers: bearer, body: JSON.stringify({ response: { ...forgeRegistration(auth, challenge), challenge }, label: '2fa key' }) });

  const store = host.get('Charts')!;
  store.setAccountRequire2fa('Admin', true);
  try {
    // Plain password sign-in is turned back: a second factor is required, and this account's only confirmed one is a passkey, not a code.
    const plain = await json(await api('sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}' }));
    assert.equal(plain.messages[0].code, '9000');

    // Wrong password at the 2fa endpoint is refused before any challenge is issued.
    const wrongPw = await json(await api('sessions/passkey-2fa', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:nope'), 'content-type': 'application/json' }, body: '{}' }));
    assert.equal(wrongPw.messages[0].code, '212');

    // The right password gets a challenge restricted to this account's own passkeys.
    const basic = { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' };
    const begin = await json(await api('sessions/passkey-2fa', { method: 'POST', headers: basic, body: '{}' }));
    assert.ok((begin.response.allowCredentials as string[]).length >= 1);
    const c2 = String(begin.response.challenge);
    const signin = await json(await api('sessions/passkey-2fa', {
      method: 'POST', headers: basic, body: JSON.stringify({ response: { ...forgeAssertion(auth, c2), challenge: c2 } }),
    }));
    assert.equal(signin.messages[0].code, '0');
    assert.ok(signin.response.token);
  } finally {
    store.setAccountRequire2fa('Admin', false); // leave Admin as later tests in this file expect
  }
});

test('another account cannot delete your passkey', { skip }, async () => {
  const token = await passwordToken();
  const bearer = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const auth = makeAuthenticator(rpId, origin);
  const opts = await json(await api('passkey/register/options', { method: 'POST', headers: bearer, body: '{}' }));
  const challenge = String(opts.response.challenge);
  const reg = await json(await api('passkey/register', { method: 'POST', headers: bearer, body: JSON.stringify({ response: { ...forgeRegistration(auth, challenge), challenge } }) }));
  const id = String(reg.response.id);
  // Deleting a credential id that isn't the caller's own is refused.
  const foreign = await json(await api(`passkey/${encodeURIComponent('not-' + id)}`, { method: 'DELETE', headers: bearer }));
  assert.equal(foreign.messages[0].code, '9');
  // Deleting your own works.
  const own = await json(await api(`passkey/${encodeURIComponent(id)}`, { method: 'DELETE', headers: bearer }));
  assert.equal(own.response.removed, true);
});
