// Passkeys and recovery codes on the Store: register a credential against an
// issued challenge, sign in with it, and fall back to one-time recovery codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, importFmp12, Store } from '../src/index.ts';
import { makeAuthenticator, forgeRegistration, forgeAssertion } from './forge-webauthn.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const RP = 'host.example', ORIGIN = 'https://host.example';

function freshStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pk-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  return { store: new Store(join(dir, 'Charts.sqlite')), dir };
}

test('a passkey registers against its challenge and then signs the account in', { skip }, () => {
  const { store, dir } = freshStore();
  try {
    const auth = makeAuthenticator(RP, ORIGIN);
    assert.equal(store.hasPasskey('Admin'), false);

    const challenge = store.issueWebauthnChallenge('register', 'Admin');
    const reg = forgeRegistration(auth, challenge, 3);
    const { id } = store.registerPasskey('Admin', reg, { rpId: RP, origin: ORIGIN, challenge }, 'MacBook');
    assert.ok(id.length > 0);
    assert.equal(store.hasPasskey('Admin'), true);
    assert.deepEqual(store.passkeyIds('Admin'), [id]);
    assert.equal(store.passkeys('Admin').find((passkey) => passkey.id === id)?.label, 'MacBook');

    // Sign in: a fresh challenge, a forged assertion, and we get the account back.
    const c2 = store.issueWebauthnChallenge('auth');
    const who = store.verifyPasskeyAssertion(forgeAssertion(auth, c2, 4), { rpId: RP, origin: ORIGIN, challenge: c2 });
    assert.equal(who, 'Admin');
  } finally { rmSync(dir, { recursive: true }); }
});

test('a challenge is one-time and expires', { skip }, () => {
  const { store, dir } = freshStore();
  try {
    const auth = makeAuthenticator(RP, ORIGIN);
    const challenge = store.issueWebauthnChallenge('register', 'Admin');
    store.registerPasskey('Admin', forgeRegistration(auth, challenge), { rpId: RP, origin: ORIGIN, challenge });
    // The same challenge can't be replayed.
    assert.throws(() => store.registerPasskey('Admin', forgeRegistration(auth, challenge), { rpId: RP, origin: ORIGIN, challenge }), /expired/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('an assertion for the wrong relying party is refused', { skip }, () => {
  const { store, dir } = freshStore();
  try {
    const auth = makeAuthenticator('evil.example', 'https://evil.example');
    const reg = store.issueWebauthnChallenge('register', 'Admin');
    // Registration itself is bound to the server's rpId, so a foreign authenticator can't register.
    assert.throws(() => store.registerPasskey('Admin', forgeRegistration(auth, reg), { rpId: RP, origin: ORIGIN, challenge: reg }), /could not be registered/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('verifyPasskeyFactor refuses another account\'s passkey, even though it verifies fine on its own', { skip }, () => {
  const { store, dir } = freshStore();
  try {
    store.setPassword('Other', 'pw2');
    const auth = makeAuthenticator(RP, ORIGIN);
    const reg = store.issueWebauthnChallenge('register', 'Other');
    store.registerPasskey('Other', forgeRegistration(auth, reg), { rpId: RP, origin: ORIGIN, challenge: reg });

    const c2 = store.issueWebauthnChallenge('auth');
    const assertion = forgeAssertion(auth, c2, 1);
    // On its own, the assertion is a perfectly good sign-in for the account it belongs to.
    assert.equal(store.verifyPasskeyAssertion(assertion, { rpId: RP, origin: ORIGIN, challenge: c2 }), 'Other');

    // But presented as Admin's second factor, where Admin's password already checked out, it's refused.
    const c3 = store.issueWebauthnChallenge('auth');
    assert.throws(
      () => store.verifyPasskeyFactor('Admin', forgeAssertion(auth, c3, 2), { rpId: RP, origin: ORIGIN, challenge: c3 }),
      /passkey was not accepted/,
    );
  } finally { rmSync(dir, { recursive: true }); }
});

test('removing a passkey takes it away', { skip }, () => {
  const { store, dir } = freshStore();
  try {
    const auth = makeAuthenticator(RP, ORIGIN);
    const challenge = store.issueWebauthnChallenge('register', 'Admin');
    const { id } = store.registerPasskey('Admin', forgeRegistration(auth, challenge), { rpId: RP, origin: ORIGIN, challenge });
    assert.equal(store.removePasskey(id), true);
    assert.equal(store.hasPasskey('Admin'), false);
    assert.equal(store.removePasskey(id), false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('recovery codes are one-time and shown only once', { skip }, () => {
  const { store, dir } = freshStore();
  try {
    const codes = store.generateRecoveryCodes('Admin', 5);
    assert.equal(codes.length, 5);
    assert.equal(store.recoveryCodesRemaining('Admin'), 5);

    assert.equal(store.useRecoveryCode('Admin', codes[0]), true);
    assert.equal(store.recoveryCodesRemaining('Admin'), 4);
    // The same code can't be used twice.
    assert.equal(store.useRecoveryCode('Admin', codes[0]), false);
    // A made-up code never works.
    assert.equal(store.useRecoveryCode('Admin', 'zzzz-zzzz-zzzz'), false);
    // Regenerating replaces the set.
    const again = store.generateRecoveryCodes('Admin', 3);
    assert.equal(store.recoveryCodesRemaining('Admin'), 3);
    assert.equal(store.useRecoveryCode('Admin', codes[1]), false, 'old codes are gone');
    assert.equal(store.useRecoveryCode('Admin', again[0]), true);
  } finally { rmSync(dir, { recursive: true }); }
});

test('passkeys and recovery codes refuse an unknown account', { skip }, () => {
  const { store, dir } = freshStore();
  try {
    assert.throws(() => store.generateRecoveryCodes('Nobody'), /No account/);
    const c = store.issueWebauthnChallenge('register', 'Nobody');
    const auth = makeAuthenticator(RP, ORIGIN);
    assert.throws(() => store.registerPasskey('Nobody', forgeRegistration(auth, c), { rpId: RP, origin: ORIGIN, challenge: c }), /No account/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('a passkey stored with base64 padding (an earlier build or an import) still signs the account in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pk-padded-'));
  const path = join(dir, 'Padded.sqlite');
  createStore(path);
  const store = new Store(path, 'Padded');
  try {
    store.setPassword('Admin', 'generated-password', '[Full Access]');
    const auth = makeAuthenticator(RP, ORIGIN);
    const challenge = store.issueWebauthnChallenge('register', 'Admin');
    const { id } = store.registerPasskey('Admin', forgeRegistration(auth, challenge), { rpId: RP, origin: ORIGIN, challenge });
    const stored = (store.sql.prepare('SELECT public_key FROM _fm_passkeys WHERE id = ?').get(id) as { public_key: string }).public_key;
    const padded = Buffer.from(stored, 'base64url').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    assert.notEqual(padded, stored, 'the generated key needs padding');
    store.sql.prepare('UPDATE _fm_passkeys SET public_key = ? WHERE id = ?').run(padded, id);
    const c2 = store.issueWebauthnChallenge('auth');
    assert.equal(store.verifyPasskeyAssertion(forgeAssertion(auth, c2, 1), { rpId: RP, origin: ORIGIN, challenge: c2 }), 'Admin');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
