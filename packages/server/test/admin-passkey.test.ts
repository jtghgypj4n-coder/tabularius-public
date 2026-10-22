// A passkey as an extra way into the admin console, alongside the one shared
// admin password: register one while already signed in, then sign a fresh
// session in with it, with no password at all. The authenticator is forged
// with a real P-256 key (no browser), bound to the server's own host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';
import { makeAuthenticator, forgeRegistration, forgeAssertion } from '../../store/test/forge-webauthn.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('a console passkey registers while signed in, then signs a fresh session in with no password', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-pk-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  const url = (p: string) => `${s.url}${p}`;
  const u = new URL(s.url);
  const auth = makeAuthenticator(u.hostname, u.origin);
  try {
    const admin = { authorization: 'Basic ' + btoa(':admin secret'), 'x-tabularius-admin': '1', 'content-type': 'application/json' };

    // No passkey yet: the sign-in page says so, and the console's own list is empty.
    const info0 = await (await fetch(url('/tabularius/admin/v1/sign-in-info'))).json();
    assert.equal(info0.hasPasskey, false);
    const list0 = await (await fetch(url('/tabularius/admin/v1/passkeys'), { headers: admin })).json();
    assert.deepEqual(list0.passkeys, []);

    // Register one, while signed in with the password.
    const opts = await (await fetch(url('/tabularius/admin/v1/passkeys/register/options'), { method: 'POST', headers: admin, body: '{}' })).json();
    assert.ok(opts.challenge && opts.rpId === u.hostname);
    const reg = await fetch(url('/tabularius/admin/v1/passkeys/register'), {
      method: 'POST', headers: admin,
      body: JSON.stringify({ response: { ...forgeRegistration(auth, opts.challenge), challenge: opts.challenge }, label: 'Test key' }),
    });
    assert.equal(reg.status, 200);
    const { id } = await reg.json();
    assert.ok(id);

    const info1 = await (await fetch(url('/tabularius/admin/v1/sign-in-info'))).json();
    assert.equal(info1.hasPasskey, true);
    const list1 = await (await fetch(url('/tabularius/admin/v1/passkeys'), { headers: admin })).json();
    assert.equal(list1.passkeys.length, 1);
    assert.equal(list1.passkeys[0].label, 'Test key');
    assert.equal(list1.passkeys[0].publicKey, undefined, 'never the key material');

    // Sign a fresh session in with just the passkey: no password, no existing cookie.
    const begin = await (await fetch(url('/tabularius/admin/v1/passkey-sign-in'), { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: '{}' })).json();
    assert.deepEqual(begin.allowCredentials, [id]);
    const signIn = await fetch(url('/tabularius/admin/v1/passkey-sign-in'), {
      method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ response: { ...forgeAssertion(auth, begin.challenge), challenge: begin.challenge } }),
    });
    assert.equal(signIn.status, 200);
    const cookie = signIn.headers.get('set-cookie')!.split(';')[0];
    const status = await fetch(url('/tabularius/admin/v1/status'), { headers: { cookie, 'x-tabularius-admin': '1' } });
    assert.equal(status.status, 200, 'the passkey alone opened the console');

    // A replayed assertion (same challenge, now spent) is refused.
    const replay = await fetch(url('/tabularius/admin/v1/passkey-sign-in'), {
      method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ response: { ...forgeAssertion(auth, begin.challenge), challenge: begin.challenge } }),
    });
    assert.equal(replay.status, 401);

    // Removing it takes it out of the list and off future sign-in challenges.
    const removed = await fetch(url(`/tabularius/admin/v1/passkeys/${encodeURIComponent(id)}`), { method: 'DELETE', headers: admin });
    assert.equal((await removed.json()).removed, true);
    const list2 = await (await fetch(url('/tabularius/admin/v1/passkeys'), { headers: admin })).json();
    assert.deepEqual(list2.passkeys, []);
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('passkey-sign-in is refused without a registered passkey, and open to everyone like /sign-in', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-pk2-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  const url = (p: string) => `${s.url}${p}`;
  try {
    const noHeader = await fetch(url('/tabularius/admin/v1/passkey-sign-in'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(noHeader.status, 403, 'a page on another site can\'t send the x-tabularius-admin header');
    const noPasskey = await fetch(url('/tabularius/admin/v1/passkey-sign-in'), { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(noPasskey.status, 403);
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
