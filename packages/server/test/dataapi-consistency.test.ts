import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';
import { PASSKEY_SECOND_FACTOR_REQUIRED, errorMeaning } from '../../store/src/error-codes.ts';
import { Api, ApiError } from '../../web/src/api.ts';
import { makeAuthenticator, forgeRegistration } from '../../store/test/forge-webauthn.ts';

test('password sign-in reports the documented passkey challenge to Data API and web clients', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'consistency-auth-'));
  createStore(join(dir, 'Auth' + STORE_EXT));
  const { server, host, url } = await serve({ dir, port: 0, watch: false, log: () => {} });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  const store = host.get('Auth')!;
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Photo', type: 'container' }] }]);
  const recordId = store.create('People', {}).recordId;
  store.setPassword('Admin', 'pw', '[Full Access]');
  const basic = { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' };
  const endpoint = `${url}/fmi/data/vLatest/databases/Auth`;
  const signedIn = await fetch(`${endpoint}/sessions`, { method: 'POST', headers: basic, body: '{}' });
  const { response: { token } } = await signedIn.json();
  assert.ok(token);
  const bearer = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const repetition = await fetch(`${endpoint}/layouts/People/records/${recordId}/containers/Photo/2`, {
    method: 'DELETE', headers: bearer,
  });
  assert.equal((await repetition.json()).messages[0].code, '111');
  const missingList = await fetch(`${url}/tabularius/app/v1/databases/Auth/layouts/People/value-list`, {
    method: 'POST', headers: bearer, body: JSON.stringify({ name: 'Absent' }),
  });
  assert.equal((await missingList.json()).error.code, 108);
  const options = await fetch(`${endpoint}/passkey/register/options`, { method: 'POST', headers: bearer, body: '{}' });
  const { response: { challenge } } = await options.json();
  const auth = makeAuthenticator(new URL(url).hostname, new URL(url).origin);
  const registered = await fetch(`${endpoint}/passkey/register`, {
    method: 'POST', headers: bearer,
    body: JSON.stringify({ response: { ...forgeRegistration(auth, challenge), challenge } }),
  });
  assert.equal((await registered.json()).messages[0].code, '0');
  store.setAccountRequire2fa('Admin', true);
  const required = await fetch(`${endpoint}/sessions`, { method: 'POST', headers: basic, body: '{}' });
  assert.equal(required.status, 401);
  const body = await required.json();
  assert.equal(body.messages[0].code, String(PASSKEY_SECOND_FACTOR_REQUIRED));
  assert.match(errorMeaning(Number(body.messages[0].code))!, /passkey.*second factor/i);
  const mcp = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { ...basic, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_record', arguments: { database: 'Auth', layout: 'People', recordId } } }),
  });
  const mcpBody = await mcp.json();
  assert.equal(mcpBody.result?.isError, true);
  assert.match(mcpBody.result.content[0].text, /passkey as its second factor/i);
  // Use the real response through the browser's adapter, without a browser or a second server.
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status: 401 }));
  await assert.rejects(Api.login('Auth', 'Admin', 'pw'), (e: unknown) =>
    e instanceof ApiError && e.code === PASSKEY_SECOND_FACTOR_REQUIRED && /passkey/i.test(e.message));
});
