import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { verifyAssertion, verifyRegistration } from '../src/webauthn.ts';
import { makeAuthenticator, forgeRegistration, forgeAssertion } from './forge-webauthn.ts';
import { registerAdminPasskey, verifyAdminPasskeyAssertion } from '../../server/src/admin-passkey.ts';

const rpId = 'host.example', origin = 'https://host.example';

test('AR-store-security-02: assertion policies', () => {
  const auth = makeAuthenticator(rpId, origin), challenge = 'assertion';
  const input = { ...forgeAssertion(auth, challenge, 1, false), publicKey: auth.cose.toString('base64url'),
    rpId, origin, challenge, storedSignCount: 0 };
  assert.throws(() => verifyAssertion(input), /user verification/);
  assert.deepEqual(verifyAssertion({ ...input, userVerification: 'preferred' }), { signCount: 1 });
  assert.throws(() => verifyAssertion({ ...input, userVerification: 'preferred', signature: Buffer.alloc(64).toString('base64url') }), /did not verify/);
  assert.deepEqual(verifyAssertion({ ...input, ...forgeAssertion(auth, challenge, 1) }), { signCount: 1 });
});

test('AR-store-security-02: registration policies', () => {
  const auth = makeAuthenticator(rpId, origin), challenge = 'register';
  const input = { ...forgeRegistration(auth, challenge, 0, false), rpId, origin, challenge };
  assert.throws(() => verifyRegistration(input), /user verification/);
  assert.ok(verifyRegistration({ ...input, userVerification: 'preferred' }).credentialId);
});

test('AR-store-security-02: account ceremonies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-verification-'));
  const path = join(dir, 'Test.sqlite');
  createStore(path);
  const store = new Store(path);
  try {
    store.setPassword('Member', 'test-password-123', '[Full Access]');
    const auth = makeAuthenticator(rpId, origin);
    const registration = store.issueWebauthnChallenge('register', 'Member');
    const { id } = store.registerPasskey('Member', forgeRegistration(auth, registration, 0, false), { rpId, origin, challenge: registration });
    const challenge = store.issueWebauthnChallenge('auth');
    assert.throws(() => store.verifyPasskeyAssertion(forgeAssertion(auth, challenge, 1, false), { rpId, origin, challenge }), /passkey was not accepted/);
    assert.equal(store.sql.prepare('SELECT sign_count FROM _fm_passkeys WHERE id = ?').get(id)?.sign_count, 0);
    assert.throws(() => store.verifyPasskeyAssertion(forgeAssertion(auth, challenge, 1), { rpId, origin, challenge }), /expired/);
    const foreign = store.issueWebauthnChallenge('auth');
    assert.throws(() => store.verifyPasskeyFactor('Another', forgeAssertion(auth, foreign, 1, false), { rpId, origin, challenge: foreign }), /passkey was not accepted/);
    assert.equal(store.sql.prepare('SELECT sign_count FROM _fm_passkeys WHERE id = ?').get(id)?.sign_count, 0);
    const factor = store.issueWebauthnChallenge('auth');
    store.verifyPasskeyFactor('Member', forgeAssertion(auth, factor, 1, false), { rpId, origin, challenge: factor });
    const verified = store.issueWebauthnChallenge('auth');
    assert.equal(store.verifyPasskeyAssertion(forgeAssertion(auth, verified, 2), { rpId, origin, challenge: verified }), 'Member');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('AR-store-security-02: console ceremony', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-verification-'));
  try {
    const auth = makeAuthenticator(rpId, origin), challenge = 'console';
    registerAdminPasskey(dir, forgeRegistration(auth, challenge), { rpId, origin, challenge });
    assert.throws(() => verifyAdminPasskeyAssertion(dir, forgeAssertion(auth, challenge, 1, false), { rpId, origin, challenge }), /user verification/);
    verifyAdminPasskeyAssertion(dir, forgeAssertion(auth, challenge, 1), { rpId, origin, challenge });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
