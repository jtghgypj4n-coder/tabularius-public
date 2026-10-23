// What every response says about the connection and the browser's features, and the console cookie's name:
// Strict-Transport-Security only when the request really came over HTTPS, a Permissions-Policy on all
// responses, and the __Host- cookie prefix only where Secure can be set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { serve, setAdminPassword, localCertificateFiles } from '../src/index.ts';
import { PERMISSIONS_POLICY, secureConnection } from '../src/exposure-headers.ts';

const fakeRequest = (remoteAddress: string, headers: Record<string, string>, encrypted = false) =>
  ({ headers, socket: { remoteAddress, encrypted } }) as unknown as IncomingMessage;

test('a request is HTTPS when TLS ended here, or a proxy on this computer says so; a stranger\'s header is not believed', () => {
  assert.equal(secureConnection(fakeRequest('203.0.113.5', {}, true)), true);
  assert.equal(secureConnection(fakeRequest('127.0.0.1', { 'x-forwarded-proto': 'https' })), true);
  assert.equal(secureConnection(fakeRequest('::1', { 'x-forwarded-proto': 'https, http' })), true);
  assert.equal(secureConnection(fakeRequest('127.0.0.1', { 'x-forwarded-proto': 'http' })), false);
  assert.equal(secureConnection(fakeRequest('127.0.0.1', {})), false);
  assert.equal(secureConnection(fakeRequest('203.0.113.5', { 'x-forwarded-proto': 'https' })), false, 'a visitor writes this header themselves');
});

test('the Permissions-Policy denies what the product never uses and leaves the camera and location to the page itself', () => {
  for (const feature of ['microphone', 'payment', 'usb', 'serial', 'hid', 'bluetooth', 'midi', 'display-capture', 'accelerometer', 'gyroscope', 'magnetometer', 'xr-spatial-tracking', 'idle-detection']) {
    assert.match(PERMISSIONS_POLICY, new RegExp(`(^|, )${feature}=\\(\\)`), feature);
  }
  // Insert from Device and Get Current Location use these; the clipboard, passkeys and full screen are not named at all.
  assert.match(PERMISSIONS_POLICY, /(^|, )camera=\(self\)/);
  assert.match(PERMISSIONS_POLICY, /(^|, )geolocation=\(self\)/);
  for (const used of ['clipboard-read', 'clipboard-write', 'publickey-credentials-get', 'publickey-credentials-create', 'fullscreen', 'web-share']) assert.ok(!PERMISSIONS_POLICY.includes(used), used);
});

test('over plain HTTP: a Permissions-Policy on every kind of answer, no HSTS, and the console cookie keeps its plain name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-exposure-http-'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    for (const path of ['/app/', '/tabularius/health', '/admin/', '/docs', '/tabularius/admin/v1/status', '/nothing-here', '/app/favicon.svg']) {
      const res = await fetch(`${s.url}${path}`);
      assert.equal(res.headers.get('permissions-policy'), PERMISSIONS_POLICY, path);
      assert.equal(res.headers.get('strict-transport-security'), null, path);
      await res.arrayBuffer();
    }
    // A proxy on this computer that says http is not HTTPS either.
    const proxied = await fetch(`${s.url}/tabularius/health`, { headers: { 'x-forwarded-proto': 'http' } });
    assert.equal(proxied.headers.get('strict-transport-security'), null);
    const ok = await fetch(`${s.url}/tabularius/admin/v1/sign-in`, { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'admin secret' }) });
    assert.match(ok.headers.get('set-cookie') ?? '', /^tabularius_admin=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/);
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('behind a proxy on this computer that says https: HSTS and the __Host- cookie; signing out clears both names; the plain name still reads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-exposure-proxy-'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  const https = { 'x-forwarded-proto': 'https' };
  const status = (cookie: string, extra: Record<string, string> = {}) =>
    fetch(`${s.url}/tabularius/admin/v1/status`, { headers: { cookie, 'x-tabularius-admin': '1', ...extra } });
  try {
    const health = await fetch(`${s.url}/tabularius/health`, { headers: https });
    assert.equal(health.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal(health.headers.get('permissions-policy'), PERMISSIONS_POLICY);

    const ok = await fetch(`${s.url}/tabularius/admin/v1/sign-in`, { method: 'POST', headers: { ...https, 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'admin secret' }) });
    const cookies = ok.headers.getSetCookie();
    const secure = cookies.find((c) => c.startsWith('__Host-tabularius_admin='))!;
    assert.match(secure, /^__Host-tabularius_admin=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
    assert.ok(!/domain=/i.test(secure), '__Host- forbids a Domain');
    assert.ok(cookies.includes('tabularius_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'), 'a plain-name cookie from before is dropped');
    const jar = secure.split(';')[0];
    const id = jar.split('=')[1];
    assert.equal((await status(jar, https)).status, 200);
    assert.equal((await status(`tabularius_admin=${id}`)).status, 200, 'the plain name is still read');
    assert.equal((await status(`tabularius_admin=${'b'.repeat(64)}; ${jar}`)).status, 200, 'the __Host- one is the one that counts when both are sent');
    assert.equal((await status(`${'__Host-tabularius_admin'}=${'b'.repeat(64)}; tabularius_admin=${id}`)).status, 401, 'and a wrong one is not rescued by the other');

    const out = await fetch(`${s.url}/tabularius/admin/v1/sign-out`, { method: 'POST', headers: { ...https, cookie: jar, 'x-tabularius-admin': '1' } });
    const cleared = out.headers.getSetCookie();
    assert.ok(cleared.includes('__Host-tabularius_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure'), cleared.join(' | '));
    assert.ok(cleared.includes('tabularius_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'), cleared.join(' | '));
    assert.equal((await status(jar, https)).status, 401, 'signed out');

    // Over plain HTTP a Secure cookie would be refused by the browser, so only the plain name is cleared there.
    const plainOut = await fetch(`${s.url}/tabularius/admin/v1/sign-out`, { method: 'POST', headers: { 'x-tabularius-admin': '1' } });
    assert.deepEqual(plainOut.headers.getSetCookie(), ['tabularius_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0']);
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('served over TLS directly: HSTS without includeSubDomains or preload, and the __Host- cookie', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-exposure-tls-'));
  setAdminPassword(dir, 'admin secret');
  const files = localCertificateFiles(dir, ['localhost', '127.0.0.1']);
  const s = await serve({ dir, port: 0, tlsCert: files.certPath, tlsKey: files.keyPath, log: () => {} });
  const port = Number(new URL(s.url).port);
  const get = (path: string, method = 'GET', headers: Record<string, string> = {}, body?: string) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined> }>((ok, fail) => {
    const req = httpsRequest({ host: '127.0.0.1', port, path, method, headers, ca: files.tls.ca, servername: 'localhost' }, (res) => {
      res.resume();
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', fail).end(body);
  });
  try {
    const health = await get('/tabularius/health');
    assert.equal(health.headers['strict-transport-security'], 'max-age=31536000');
    assert.equal(health.headers['permissions-policy'], PERMISSIONS_POLICY);
    const bad = await get('/nothing-here');
    assert.equal(bad.status, 404);
    assert.equal(bad.headers['strict-transport-security'], 'max-age=31536000', 'on errors too');
    const ok = await get('/tabularius/admin/v1/sign-in', 'POST', { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, JSON.stringify({ password: 'admin secret' }));
    const secure = (ok.headers['set-cookie'] as string[]).find((c) => c.startsWith('__Host-tabularius_admin='));
    assert.match(secure ?? '', /; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
