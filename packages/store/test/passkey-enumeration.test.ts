// A passkey sign-in says the same thing whatever went wrong, offers made-up credential ids for accounts with none,
// and limits how fast an address can ask for challenges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { makeAuthenticator, forgeRegistration, forgeAssertion } from './forge-webauthn.ts';

const RP = 'host.example', ORIGIN = 'https://host.example';

test('every passkey failure reads the same, and allowCredentials does not say who has a passkey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pk-enum-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  try {
    store.setPassword('Admin', 'admin-password-1', '[Full Access]');
    store.setPassword('Other', 'other-password-1', '[Full Access]');
    const auth = makeAuthenticator(RP, ORIGIN);
    const reg = store.issueWebauthnChallenge('register', 'Admin');
    const { id } = store.registerPasskey('Admin', forgeRegistration(auth, reg, 3), { rpId: RP, origin: ORIGIN, challenge: reg });

    // A real account offers its real ids; accounts without a passkey, and names that don't exist, get stable made-up ones.
    assert.deepEqual(store.passkeyAllowList('Admin'), [id]);
    const none = store.passkeyAllowList('Other');
    const ghost = store.passkeyAllowList('nobody-here');
    assert.ok(none.length >= 1 && none.length <= 3 && ghost.length >= 1 && ghost.length <= 3, 'looks like a real answer');
    const sizeOf = (x: string) => Buffer.from(x, 'base64url').length;
    assert.ok([...none, ...ghost].every((x) => sizeOf(x) === sizeOf(id)), 'made-up ids are as long as the ones this file holds');
    store.setAccountActive('Other', false);
    store.setAccountActive('Admin', true);
    assert.deepEqual(store.passkeyAllowList('Other'), none, 'the same every time');
    assert.deepEqual(store.passkeyAllowList('OTHER'), none, 'whatever the case');
    assert.ok(!none.includes(id) && !ghost.includes(id));

    // Unknown credential, wrong account (second factor) and a bad signature all fail with one message.
    const messages = new Set<string>();
    const fail = (fn: () => unknown) => { try { fn(); assert.fail('should have thrown'); } catch (e) { messages.add((e as Error).message); } };
    const c1 = store.issueWebauthnChallenge('auth');
    fail(() => store.verifyPasskeyAssertion({ credentialId: 'nope', clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' }, { rpId: RP, origin: ORIGIN, challenge: c1 }));
    const c2 = store.issueWebauthnChallenge('auth');
    fail(() => store.verifyPasskeyAssertion({ ...forgeAssertion(auth, c2, 5), signature: 'AAAA' }, { rpId: RP, origin: ORIGIN, challenge: c2 }));
    const c3 = store.issueWebauthnChallenge('auth');
    fail(() => store.verifyPasskeyFactor('Other', forgeAssertion(auth, c3, 6), { rpId: RP, origin: ORIGIN, challenge: c3 }));
    assert.equal(messages.size, 1, [...messages].join(' | '));
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('an address gets 60 challenges a minute, then a wait; this computer gets more; others are unaffected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pk-ask-'));
  createStore(join(dir, 'New.sqlite'));
  const store = new Store(join(dir, 'New.sqlite'));
  try {
    for (let i = 0; i < 60; i++) assert.equal(store.challengeWait('198.51.100.7'), 0);
    const wait = store.challengeWait('198.51.100.7');
    assert.ok(wait >= 1 && wait <= 60, `wait ${wait}`);
    assert.equal(store.challengeWait('198.51.100.8'), 0, 'another address is unaffected');
    for (let i = 0; i < 100; i++) assert.equal(store.challengeWait('127.0.0.1'), 0, 'this computer has a larger allowance');
    for (let i = 0; i < 5100; i++) store.issueWebauthnChallenge('auth');
    const n = (store.sql.prepare('SELECT count(*) AS n FROM _fm_webauthn_challenges').get() as { n: number }).n;
    assert.ok(n <= 5001, `pending challenges stay bounded (${n})`);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
