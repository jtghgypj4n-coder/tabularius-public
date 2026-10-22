import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { serve, setAdminPassword } from '../src/index.ts';
import { CertificateError, ImportedCertificates } from '../src/cert-import.ts';

// Findings of the admin route review (docs/audits/audit-admin-api-routes.md): what every admin answer carries,
// and what an anonymous caller can learn about the routes.

async function withServer(name: string, fn: (s: Awaited<ReturnType<typeof serve>>, dir: string) => Promise<void>, password?: string) {
  const dir = mkdtempSync(join(tmpdir(), name));
  createStore(join(dir, 'Test.openhbam.sqlite'));
  if (password) setAdminPassword(dir, password);
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    await fn(s, dir);
  } finally {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}

test('every console download and plain-text answer says nosniff and is not cached', async () => {
  await withServer('tabularius-route-review-headers-', async (s) => {
    const base = `${s.url}/tabularius/admin/v1`;
    for (const path of [
      '/metrics',
      '/audit?database=Test&format=csv',
      '/security-events?database=Test&format=csv',
      '/access-review?database=Test&format=csv',
      '/plugin-readiness?database=Test&format=csv',
      '/logs/Event/download',
    ]) {
      const r = await fetch(base + path);
      assert.equal(r.status, 200, path);
      await r.arrayBuffer();
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', path);
      assert.equal(r.headers.get('cache-control'), 'no-store', path);
    }
    const page = await fetch(`${s.url}/admin`, { redirect: 'manual' });
    assert.equal(page.status, 301);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  });
});

test('an anonymous caller cannot tell a console route from a missing one by its method answer', async () => {
  await withServer('tabularius-route-review-console-', async (s) => {
    const base = `${s.url}/tabularius/admin/v1`;
    const headers = { 'x-tabularius-admin': '1' };
    // A known path with a wrong method and a path that does not exist answer alike before sign-in.
    const known = await fetch(`${base}/accounts/unlock`, { method: 'PUT', headers });
    const missing = await fetch(`${base}/no-such-route`, { method: 'PUT', headers });
    assert.equal(known.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(known.headers.get('allow'), null);
    assert.deepEqual(await known.json(), await missing.json());
    // The sign-in page's own calls are open, so their method answer stays.
    const signIn = await fetch(`${base}/sign-in`, { method: 'GET', headers });
    assert.equal(signIn.status, 405);
    assert.equal(signIn.headers.get('allow'), 'POST');
    // Signed in, the answer names the methods.
    const authed = { ...headers, authorization: 'Basic ' + btoa('admin:secret') };
    const wrong = await fetch(`${base}/accounts/unlock`, { method: 'PUT', headers: authed });
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('allow'), 'POST');
  }, 'secret');
});

test('an anonymous caller cannot tell an Admin API route from a missing one by its method answer', async () => {
  await withServer('tabularius-route-review-adminapi-', async (s) => {
    const base = `${s.url}/fmi/admin/api/v2`;
    const known = await fetch(`${base}/databases`, { method: 'PUT' });
    const missing = await fetch(`${base}/no-such-route`, { method: 'PUT' });
    const oversized = await fetch(`${base}/schedules/${'9'.repeat(40)}`);
    for (const r of [known, missing, oversized]) {
      assert.equal(r.status, 401);
      assert.equal(r.headers.get('allow'), null);
      assert.equal((await r.json()).messages[0].code, '9');
    }
    // The sign-in route is public, so its method answer stays.
    const login = await fetch(`${base}/user/auth`, { method: 'GET' });
    assert.equal(login.status, 405);
    assert.equal(login.headers.get('allow'), 'POST');
  }, 'secret');
});

const openssl = spawnSync('openssl', ['version']).status === 0;

test('a settings file that cannot be read is not echoed to the Admin API caller', { skip: openssl ? false : 'openssl is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-route-review-cert-'));
  const pems = mkdtempSync(join(tmpdir(), 'tabularius-route-review-pems-'));
  try {
    const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-subj', '/CN=review.example.com', '-days', '2'], { cwd: pems });
    assert.equal(made.status, 0, String(made.stderr));
    const marker = ['PRIVATE', 'MARKER', 'TEXT'].join('-');
    // Not JSON, with a value in it that the parser's own message may quote.
    writeFileSync(join(dir, '.openhbam-settings.json'), `{"tlsKey": ${marker}}`);
    let message = '';
    try {
      new ImportedCertificates(dir).import({ certificate: readFileSync(join(pems, 'cert.pem'), 'utf8'), privateKey: readFileSync(join(pems, 'key.pem'), 'utf8') });
    } catch (e) {
      assert.ok(e instanceof CertificateError);
      message = e.message;
    }
    assert.match(message, /\.openhbam-settings\.json could not be read/);
    assert.ok(!message.includes('PRIVATE'), message);
    assert.ok(!message.includes(dir), message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(pems, { recursive: true, force: true });
  }
});
