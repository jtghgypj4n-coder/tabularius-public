import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';

test('SECURITY.md describes every admin cookie and OAuth CORS response', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-headers-'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  const url = (path: string) => `${s.url}${path}`;
  const doc = readFileSync(join(import.meta.dirname, '..', '..', '..', 'SECURITY.md'), 'utf8');
  try {
    const signIn = await fetch(url('/tabularius/admin/v1/sign-in'), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' },
      body: JSON.stringify({ password: 'admin secret' }),
    });
    const issued = signIn.headers.get('set-cookie');
    assert.ok(issued, 'password sign-in emits Set-Cookie');
    const sessionCookie = issued.split(';', 1)[0];
    const signOut = await fetch(url('/tabularius/admin/v1/sign-out'), {
      method: 'POST', headers: { cookie: sessionCookie, 'x-tabularius-admin': '1' },
    });
    const cleared = signOut.headers.get('set-cookie');
    assert.ok(cleared, 'sign-out emits Set-Cookie');

    const oauthCases: { path: string; method: string; headers?: Record<string, string>; body?: string }[] = [
      { path: '/.well-known/oauth-protected-resource', method: 'GET' },
      { path: '/.well-known/oauth-authorization-server', method: 'GET' },
      { path: '/oauth/register', method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } },
      { path: '/oauth/token', method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=invalid' },
      { path: '/oauth/revoke', method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=invalid' },
    ];
    const responses = await Promise.all(oauthCases.map(({ path, method, headers, body }) => fetch(url(path), { method, headers, body })));
    const cors = responses.map((response, i) => ({ route: `${oauthCases[i].method} ${oauthCases[i].path}`, response }));

    assert.match(doc, /`tabularius_admin`/);
    assert.match(doc, /`Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200`/);
    assert.match(doc, /`Secure` is\s+added when the request uses HTTPS/);
    assert.match(doc, /`Path=\/; HttpOnly;\s+SameSite=Strict; Max-Age=0`/);
    assert.match(doc, /Password sign-in \(`POST \/tabularius\/admin\/v1\/sign-in`\)/);
    assert.match(doc, /passkey sign-in \(`POST \/tabularius\/admin\/v1\/passkey-sign-in`\)/);
    assert.match(doc, /Sign-out \(`POST\s+\/tabularius\/admin\/v1\/sign-out`\)/);

    for (const { route, response } of cors) {
      assert.equal(response.headers.get('access-control-allow-origin'), '*', `${route} CORS origin`);
      assert.match(doc, /`Access-Control-Allow-Origin: \*`/);
      assert.match(doc, /`\/.well-known\/oauth-\*` and `\/oauth\/\*`/);
    }
    const preflight = cors.find(({ route }) => route === 'OPTIONS /oauth/register')!.response;
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST');
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type, authorization');
    assert.equal(preflight.headers.get('access-control-max-age'), '600');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
    assert.match(doc, /methods `GET, POST`, headers\s+`content-type, authorization`, and max age 600 seconds/);
    assert.match(doc, /`Access-Control-Allow-Credentials` is never sent/);
    assert.match(doc, /Console reads and writes reject cross-origin `Origin`/);
    assert.match(doc, /Passkey assertions additionally validate the WebAuthn origin/);
  } finally {
    await new Promise<void>((resolve, reject) => s.server.close((error) => error ? reject(error) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
