import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInWithPasskey, signInWithPasskeyFactor } from '../src/webauthn.ts';

test('AR-store-security-02: browser ceremonies', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ response: { challenge: 'AQ', rpId: 'host.example', allowCredentials: ['AQ'] } })));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let policy: unknown;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: { get: async (options: { publicKey: { userVerification: string } }) => {
    policy = options.publicKey.userVerification;
    return null;
  } } } });
  try {
    await assert.rejects(signInWithPasskey('Test', 'Member'), /No passkey/);
    assert.equal(policy, 'required');
    await assert.rejects(signInWithPasskeyFactor('Test', 'Member', 'password'), /No passkey/);
    assert.equal(policy, 'preferred');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
