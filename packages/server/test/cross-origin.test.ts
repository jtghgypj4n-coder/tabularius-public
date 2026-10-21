import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { request } from 'node:http';
import { serve, setAdminPassword } from '../src/index.ts';
import { sameOriginRequest, needsSameOriginCheck } from '../src/browser-request.ts';
import { concretePath, routes, stubPath } from './cross-origin-support.ts';
import { inventoryMarkdown } from '../../../scripts/audit-cross-origin.ts';

test('cross-origin inventory enumerates the current route table', () => {
  assert.equal(readFileSync(new URL('../../../docs/audits/r25-08-cross-origin-routes.md', import.meta.url), 'utf8'), inventoryMarkdown());
});

test('ambient origin policy rejects opaque, sibling, forged, missing-metadata and rebound origins', () => {
  const req = (headers: Record<string, string | undefined>) => ({ headers: { host: 'localhost:8080', ...headers }, socket: {} }) as IncomingMessage;
  for (const headers of [
    { origin: 'https://evil.example' }, { origin: 'null' }, { origin: 'http://localhost:8081' },
    { origin: 'http://127.0.0.1:8080' }, { origin: 'http://localhost:8080/' },
    { origin: 'http://user@localhost:8080' }, { origin: 'http://localhost:8080 http://evil.example' },
    { referer: 'https://evil.example/page' }, { referer: 'null' },
    { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'invalid' },
    { host: 'rebound.example:8080', origin: 'http://rebound.example:8080' },
    { host: 'rebound.example:8080' },
    { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
  ]) assert.equal(sameOriginRequest(req(headers)), false, JSON.stringify(headers));
  for (const headers of [{}, { origin: 'http://localhost:8080' }, { referer: 'http://localhost:8080/admin/' }, { 'sec-fetch-site': 'none' }, { 'sec-fetch-site': 'same-origin' }]) {
    assert.equal(sameOriginRequest(req(headers)), true, JSON.stringify(headers));
  }
  assert.equal(sameOriginRequest(req({ origin: 'https://files.example' }), 'https://files.example'), true);
  assert.equal(sameOriginRequest(req({ origin: 'https://sub.files.example' }), 'https://files.example'), false);
  assert.equal(sameOriginRequest(req({ origin: 'http://localhost:8080' }), 'https://files.example'), false);
  assert.equal(sameOriginRequest(req({ cookie: 'tabularius_admin=synthetic' })), false);
  assert.equal(sameOriginRequest(req({ cookie: 'openhbam_admin=synthetic' })), false);
  assert.equal(sameOriginRequest(req({ cookie: 'tabularius_admin=synthetic', 'x-tabularius-console': '1' })), true);
  assert.equal(sameOriginRequest(req({ authorization: 'Basic synthetic' }), undefined, [], true), false);
  assert.equal(sameOriginRequest(req({ authorization: 'Basic synthetic', 'x-tabularius-console': '1' }), undefined, [], true), true);
  const tls = req({ host: 'files.example', origin: 'https://files.example' });
  (tls.socket as { encrypted?: boolean }).encrypted = true;
  assert.equal(sameOriginRequest(tls, undefined, ['https://files.example']), true, 'operator-configured HTTPS domain');
  assert.equal(sameOriginRequest(tls, undefined, ['https://FILES.EXAMPLE:443']), true, 'configured origin normalization');
  assert.equal(sameOriginRequest(tls, undefined, ['https://other.example']), false);
  assert.equal(sameOriginRequest(req({ host: 'files.example', origin: 'http://files.example' }), undefined, ['https://files.example']), false, 'configured HTTPS does not authorize HTTP');
});

test('console routes never become bearer exemptions; explicit file API tokens stay non-ambient', () => {
  const req = { method: 'POST', headers: { authorization: 'Bearer invalid' } } as IncomingMessage;
  assert.equal(needsSameOriginCheck(req, '/tabularius/admin/v1/sign-out'), true);
  assert.equal(needsSameOriginCheck(req, '/fmi/data/vLatest/databases/Synthetic/layouts/Records/records'), false);
  assert.equal(needsSameOriginCheck(req, '/fmi/data/vLatest/databases/Synthetic/sessions'), true);
  assert.equal(needsSameOriginCheck(req, '/mcp'), false);
});

test('every console route denies cross-origin cookie requests before dispatch; logout requires the header', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-origin-'));
  stubPath(t, dir);
  setAdminPassword(dir, 'synthetic-secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const login = await fetch(`${s.url}/tabularius/admin/v1/sign-in`, {
      method: 'POST', headers: { 'x-tabularius-admin': '1' }, body: JSON.stringify({ password: 'synthetic-secret' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.match(login.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
    for (const route of routes.filter((r) => r.path.startsWith('/tabularius/admin/'))) {
      const response = await fetch(`${s.url}${concretePath(route.path)}`, {
        method: route.method, headers: { cookie, origin: 'https://evil.example', 'x-tabularius-admin': '1', authorization: 'Bearer invalid' },
      });
      assert.equal(response.status, 403, `${route.method} ${route.path}`);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      await response.arrayBuffer();
    }
    const sessions = () => fetch(`${s.url}/tabularius/admin/v1/sessions`, { headers: { cookie, 'x-tabularius-console': '1' } });
    assert.equal((await sessions()).status, 200);
    s.host.create('Synthetic');
    const guide = t.mock.method(s.host.guides!, 'get', async () => { throw new Error('guide generation must not run'); });
    const basic = { authorization: 'Basic ' + btoa('admin:synthetic-secret') };
    assert.equal((await fetch(`${s.url}/tabularius/admin/v1/conversion-guide/Synthetic`, { headers: basic })).status, 403);
    assert.equal(guide.mock.callCount(), 0, 'ambiguous Basic GET must not generate a persisted guide');
    assert.equal((await fetch(`${s.url}/tabularius/admin/v1/sessions`, { headers: { ...basic, 'x-tabularius-console': '1' } })).status, 200);
    assert.equal((await fetch(`${s.url}/openhbam/admin/v1/sign-out`, { method: 'POST', headers: { cookie, origin: 'https://evil.example', 'x-openhbam-admin': '1' } })).status, 403);
    for (const headers of [{ cookie }, { cookie, 'x-tabularius-admin': '1', referer: 'https://evil.example/' }, { cookie, 'x-tabularius-admin': '1', 'sec-fetch-site': 'same-site' }] as Record<string, string>[]) {
      const response = await fetch(`${s.url}/tabularius/admin/v1/sign-out`, { method: 'POST', headers });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal((await sessions()).status, 200, 'failed logout must preserve the session');
    }
    const logout = await fetch(`${s.url}/tabularius/admin/v1/sign-out`, { method: 'POST', headers: { cookie, 'x-tabularius-admin': '1', origin: s.url } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal((await sessions()).status, 401);
  } finally {
    s.server.closeAllConnections();
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    // Keep the stub marker available for the after hook.
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
});

test('Basic-auth surfaces, OAuth authorization POST, and originless MCP reject hostile browser context', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-origin-basic-'));
  stubPath(t, dir);
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    for (const [method, path] of [
      ['POST', '/fmi/data/vLatest/databases/Synthetic/sessions'], ['POST', '/fmi/admin/api/v2/user/auth'],
      ['GET', '/fmi/odata/v4/Synthetic'], ['POST', '/fmi/odata/v4/Synthetic/$batch'],
      ['GET', '/fmi/xml/fmresultset.xml?-db=Synthetic&-findall'], ['POST', '/fmi/xml/fmresultset.xml'],
      ['POST', '/tabularius/sql/v1/databases/Synthetic'], ['GET', '/tabularius/sql/v1/databases/Synthetic/tables'],
      ['POST', '/oauth/authorize'], ['GET', '/mcp'],
    ]) {
      for (const context of [{ origin: 'null' }, { referer: 'https://evil.example/' }, { 'sec-fetch-site': 'cross-site' }, { host: 'rebound.example' }]) {
        // Node fetch normalizes Host; a raw HTTP request preserves the rebinding probe.
        const status = await new Promise<number>((resolve, reject) => {
          const r = request(`${s.url}${path}`, { method, headers: { ...context, authorization: 'Basic ' + btoa('admin:synthetic-secret') } }, (res) => {
            res.resume(); res.on('end', () => resolve(res.statusCode!));
          });
          r.on('error', reject); r.end();
        });
        assert.equal(status, 403, `${method} ${path} ${JSON.stringify(context)}`);
      }
    }
  } finally {
    s.server.closeAllConnections();
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
});

test('worker browser origins survive removal of ACME options and never inherit MCP caller trust', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-worker-origin-'));
  stubPath(t, dir);
  setAdminPassword(dir, 'synthetic-secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, publicUrl: 'http://127.0.0.1', publicUrlIsDefault: true,
    browserOrigins: ['http://files.example'], mcpAllowedOrigins: ['http://external.example'] });
  try {
    for (const hostname of ['files.example', 'external.example']) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(`${s.url}/tabularius/admin/v1/sessions`, { headers: {
          host: hostname, origin: `http://${hostname}`, authorization: 'Basic ' + btoa('admin:synthetic-secret'),
        } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
        req.on('error', reject); req.end();
      });
      assert.equal(status, hostname === 'files.example' ? 200 : 403);
    }
  } finally {
    s.server.closeAllConnections();
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
});
