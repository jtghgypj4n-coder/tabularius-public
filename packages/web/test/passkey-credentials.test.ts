import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../src/api.ts';
import { signInWithPasskeyFactor } from '../src/webauthn.ts';

for (const [account, password] of [['review', 'test-漢'], ['réview', 'café'], ['帳戶🙂', '密碼🔐'], ['plain', 'ascii']]) {
  test(`AR-web-client-12 ${account}`, async (t) => {
    const headers: string[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      headers.push(new Headers(init?.headers).get('authorization')!);
      return Response.json({ messages: [{ code: '0' }], response: { token: 'synthetic', challenge: 'YQ', allowCredentials: ['Yg'] } });
    });
    const buffer = new Uint8Array([1]).buffer;
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get: async () => ({ rawId: buffer, response: { clientDataJSON: buffer, authenticatorData: buffer, signature: buffer } }) } });
    t.after(() => Reflect.deleteProperty(navigator, 'credentials'));
    await Api.login('Synthetic', account, password);
    await signInWithPasskeyFactor('Synthetic', account, password);
    assert.deepEqual(headers, Array(3).fill(`Basic ${Buffer.from(`${account}:${password}`, 'utf8').toString('base64')}`));
  });
}
