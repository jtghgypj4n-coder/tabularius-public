import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { findChromium } from '../../../scripts/chromium.ts';
import { serve, setAdminPassword } from '../src/index.ts';
import { concretePath, routes, stubPath } from './cross-origin-support.ts';

const executablePath = findChromium();

test('real Chromium cross-origin invariant matrix', { skip: !executablePath && 'no Chromium installed', timeout: 180_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-browser-origin-'));
  stubPath(t, dir);
  setAdminPassword(dir, 'synthetic-secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  const store = s.host.create('Synthetic');
  store.applyDesign([{ op: 'createTable', name: 'Records', fields: [{ name: 'Value', type: 'text' }] }]);
  store.setPassword('Admin', 'synthetic-data');
  const attacker = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Origin test</title>'));
  await new Promise<void>((resolve) => attacker.listen(0, '127.0.0.1', resolve));
  const attackerPort = (attacker.address() as { port: number }).port;
  const port = new URL(s.url).port;
  const observed: { method: string; path: string; status: number; cookie: boolean; site?: string; origin?: string; referer?: string }[] = [];
  s.server.prependListener('request', (req, res) => {
    res.on('finish', () => observed.push({ method: req.method!, path: req.url!, status: res.statusCode,
      cookie: !!req.headers.cookie?.includes('tabularius_admin='), site: req.headers['sec-fetch-site'] as string | undefined,
      origin: req.headers.origin, referer: req.headers.referer }));
  });
  const browser = await chromium.launch({ executablePath, timeout: 90_000, env: { ...process.env } as Record<string, string>, args: [
    '--no-proxy-server', '--host-resolver-rules=MAP *.audit.localhost 127.0.0.1, MAP *.audit.test 127.0.0.1',
  ] });
  const context = await browser.newContext();
  // Do not intercept requests: interception changes Chromium's CORS/preflight cache behavior.
  // Every test URL below resolves to one of the two loopback servers.
  const victim = await context.newPage();
  const evil = await context.newPage();
  victim.setDefaultTimeout(5000);
  evil.setDefaultTimeout(5000);
  const login = async (base: string) => {
    await victim.goto(`${base}/tabularius/health`);
    assert.equal(await victim.evaluate(async (base) => (await fetch(`${base}/tabularius/admin/v1/sign-in`, {
      method: 'POST', headers: { 'x-tabularius-admin': '1' }, body: JSON.stringify({ password: 'synthetic-secret' }),
    })).status, base), 200);
  };
  const stillSignedIn = async (base: string) => assert.equal(await victim.evaluate(async (base) =>
    (await fetch(`${base}/tabularius/admin/v1/sessions`, { headers: { 'x-tabularius-console': '1' } })).status, base), 200);
  try {
    await t.test('same-site sibling subdomain sends Strict cookie but form, no-cors, fetch and preflight are denied', async () => {
      const base = `http://a.audit.localhost:${port}`;
      s.host.publicUrl = base;
      await login(base);
      const cookies = await context.cookies(base);
      assert.ok(cookies.some((c) => c.name === 'tabularius_admin' && c.sameSite === 'Strict' && c.httpOnly && c.domain === 'a.audit.localhost'));
      await evil.goto(`http://b.audit.localhost:${attackerPort}`);
      const path = '/tabularius/admin/v1/sign-out';
      for (const mode of ['cors', 'no-cors'] as const) {
        const before = observed.length;
        await evil.evaluate(async ({ url, mode }) => {
          try { await fetch(url, { method: 'POST', mode, credentials: 'include', headers: { 'content-type': 'text/plain' }, body: '{}' }); } catch { /* CORS denies response access. */ }
        }, { url: base + path, mode });
        const request = observed.slice(before).find((r) => r.path === path && r.method === 'POST');
        assert.ok(request, 'simple request reached server');
        assert.equal(request.status, 403);
        assert.equal(request.cookie, true, 'Strict cookie is sent between same-site subdomains');
      }
      const beforeForm = observed.length;
      const formResponse = evil.waitForResponse((r) => r.url() === base + path && r.request().method() === 'POST');
      await evil.evaluate((url) => {
        const form = document.createElement('form'); form.action = url; form.method = 'POST'; document.body.append(form); form.submit();
      }, base + path);
      assert.equal((await formResponse).status(), 403);
      await evil.waitForURL(base + path);
      await evil.waitForLoadState('load');
      assert.equal(observed.slice(beforeForm).find((r) => r.method === 'POST')?.cookie, true);
      await evil.goto(`http://b.audit.localhost:${attackerPort}`);
      const beforePreflight = observed.length;
      const result = await evil.evaluate(async (url) => {
        try { await fetch(url, { method: 'POST', credentials: 'include', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: '{}' }); return 'allowed'; }
        catch { return 'denied'; }
      }, base + path);
      assert.equal(result, 'denied');
      const sent = observed.slice(beforePreflight);
      assert.ok(sent.some((r) => r.method === 'OPTIONS' && r.status === 403));
      assert.ok(!sent.some((r) => r.method === 'POST'));
      await stillSignedIn(base);
    });

    await t.test('localhost versus 127.0.0.1 is cross-site; sibling ports are same-site but cross-origin', async () => {
      s.host.publicUrl = undefined;
      const base = `http://localhost:${port}`;
      await login(base);
      for (const host of ['127.0.0.1', 'localhost']) {
        await evil.goto(`http://${host}:${attackerPort}`);
        const before = observed.length;
        await evil.evaluate(async (url) => { try { await fetch(url, { method: 'POST', credentials: 'include', mode: 'no-cors' }); } catch {} }, base + '/tabularius/admin/v1/sign-out');
        const request = observed.slice(before).find((r) => r.method === 'POST');
        assert.ok(request);
        assert.equal(request.status, 403);
        assert.equal(request.cookie, host === 'localhost');
        assert.equal(request.site, host === 'localhost' ? 'same-site' : 'cross-site');
      }
      await stillSignedIn(base);
    });

    await t.test('every console route in the route table denies a browser on a different origin', async () => {
      const base = `http://localhost:${port}`;
      await evil.goto(`http://localhost:${attackerPort}`);
      const cases = routes.filter((r) => r.path.startsWith('/tabularius/admin/')).map((r) => ({ method: r.method, path: concretePath(r.path) }));
      const before = observed.length;
      const denied = await evil.evaluate(async ({ base, cases }) => {
        let denied = 0;
        for (const c of cases) {
          try { await fetch(base + c.path, { method: c.method, credentials: 'include' }); }
          catch { denied++; }
        }
        return denied;
      }, { base, cases });
      assert.equal(denied, cases.length, 'no cross-origin response is readable');
      const requests = observed.slice(before);
      assert.ok(requests.length >= cases.length);
      assert.ok(requests.every((r) => r.status === 403), 'actual requests and preflights are rejected before dispatch');
      await stillSignedIn(base);
    });

    await t.test('all protected file routes reject a cross-origin console cookie; no records change', async () => {
      const base = `http://localhost:${port}`;
      await evil.goto(`http://localhost:${attackerPort}`);
      const fileGroups = new Set(['data-api-sessions', 'data-api-records', 'live', 'changes', 'calendar', 'sql', 'odata', 'cwp-xml',
        'design', 'design-scripts', 'debug', 'security', 'assistant', 'automations', 'cleanup', 'dashboards', 'digests', 'agent', 'inbound-hooks', 'scim', 'admin-api', 'replication']);
      const cases = routes.filter((r) => fileGroups.has(r.group) || r.group === 'data-api-metadata' || r.path.startsWith('/tabularius/app/') || r.path.startsWith('/tabularius/images/') || r.path.startsWith('/tabularius/containers/'))
        .map((r) => ({ method: r.method, path: concretePath(r.path) }));
      const before = observed.length;
      assert.equal(await evil.evaluate(async ({ base, cases }) => {
        let denied = 0;
        for (const c of cases) {
          try { await fetch(base + c.path, { method: c.method, credentials: 'include' }); }
          catch { denied++; }
        }
        return denied;
      }, { base, cases }), cases.length);
      const requests = observed.slice(before);
      assert.ok(requests.length >= cases.length);
      assert.ok(requests.every((r) => r.status >= 400), JSON.stringify(requests.filter((r) => r.status < 400)));
      assert.equal(store.find('Records').foundCount, 0);
    });

    await t.test('same-origin bearer fetch opens SSE; EventSource cannot substitute a cookie or query token', async () => {
      const base = `http://localhost:${port}`;
      const token = await victim.evaluate(async (base) => {
        const r = await fetch(base + '/fmi/data/vLatest/databases/Synthetic/sessions', {
          method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:synthetic-data') },
        });
        return (await r.json()).response.token as string;
      }, base);
      assert.ok(token);
      assert.equal(await victim.evaluate(async ({ base, token }) => {
        const abort = new AbortController();
        const r = await fetch(base + '/tabularius/live/v1/databases/Synthetic/events', { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
        const status = r.status; abort.abort(); return status;
      }, { base, token }), 200);
      assert.equal(await victim.evaluate((url) => new Promise<string>((resolve) => {
        const es = new EventSource(url, { withCredentials: true });
        es.onopen = () => { es.close(); resolve('opened'); }; es.onerror = () => { es.close(); resolve('denied'); };
      }), base + '/tabularius/live/v1/databases/Synthetic/events?token=' + token), 'denied');
      const r = await context.request.get(base + '/tabularius/live/v1/databases/Synthetic/clients', { headers: { authorization: `Bearer ${token}`, origin: 'https://external.example' } });
      assert.equal(r.status(), 200, 'explicit token is accepted by the server without cookie authority');
      assert.equal(r.headers()['access-control-allow-origin'], undefined, 'no cross-origin browser read grant');
    });

    await t.test('a DNS name mapped to loopback cannot nominate itself as the trusted origin', async () => {
      s.host.publicUrl = undefined;
      const base = `http://a.audit.test:${port}`;
      // This request is issued by Chromium; the resolver maps the attacker-owned name to loopback.
      const page = await context.newPage();
      await page.goto(base + '/tabularius/health');
      assert.equal(await page.evaluate(async (base) => (await fetch(base + '/tabularius/admin/v1/sessions', {
        headers: { 'x-tabularius-console': '1' },
      })).status, base), 403);
      await page.close();
    });

    await t.test('plain HTTP with no Origin, Referer or Fetch Metadata still cannot use a console cookie', async () => {
      const base = `http://a.audit.test:${port}`;
      s.host.publicUrl = base;
      const page = await context.newPage();
      await page.goto(base + '/tabularius/health');
      assert.equal(await page.evaluate(async (base) => (await fetch(base + '/tabularius/admin/v1/sign-in', {
        method: 'POST', headers: { 'x-tabularius-admin': '1' }, body: JSON.stringify({ password: 'synthetic-secret' }),
      })).status, base), 200);
      await page.goto(`http://a.audit.test:${attackerPort}`);
      const before = observed.length;
      await page.evaluate(async (url) => { try { await fetch(url, { mode: 'no-cors', credentials: 'include', referrerPolicy: 'no-referrer' }); } catch {} }, base + '/tabularius/admin/v1/sessions');
      const read = observed.slice(before).find((r) => r.path === '/tabularius/admin/v1/sessions');
      assert.ok(read, 'the browser must reach the server, not merely fail a local-network policy');
      assert.equal(read.cookie, true);
      assert.equal(read.origin, undefined);
      assert.equal(read.referer, undefined);
      assert.equal(read.site, undefined);
      assert.equal(read.status, 403);
      const response = await context.request.get(s.url + '/admin/');
      assert.equal(response.headers()['referrer-policy'], 'same-origin');
      await page.close();
      s.host.publicUrl = undefined;
    });

    await t.test('opaque sandbox origin, EventSource, WebSocket and framing cannot use the console cookie', async () => {
      const base = `http://localhost:${port}`;
      await evil.goto(`http://localhost:${attackerPort}`);
      const before = observed.length;
      await evil.evaluate((base) => {
        const frame = document.createElement('iframe'); frame.sandbox.add('allow-scripts');
        frame.srcdoc = `<script>fetch(${JSON.stringify(base + '/tabularius/admin/v1/sign-out')},{method:'POST',mode:'no-cors',credentials:'include'}).catch(()=>{})<\/script>`;
        document.body.append(frame);
      }, base);
      // Wait for the actual request, not a timer-based assertion.
      await assertEventually(() => observed.slice(before).some((r) => r.method === 'POST'));
      assert.ok(observed.slice(before).some((r) => r.method === 'POST' && r.status === 403));
      for (const path of ['/mcp', '/tabularius/live/v1/databases/Synthetic/events', '/tabularius/admin/v1/sessions']) {
        const result = await evil.evaluate((url) => new Promise<string>((resolve) => {
          const es = new EventSource(url, { withCredentials: true });
          es.onopen = () => { es.close(); resolve('opened'); };
          es.onerror = () => { es.close(); resolve('denied'); };
        }), base + path);
        assert.equal(result, 'denied', path);
      }
      assert.equal(await evil.evaluate((url) => new Promise<string>((resolve) => {
        const ws = new WebSocket(url); ws.onopen = () => { ws.close(); resolve('opened'); }; ws.onerror = () => resolve('denied');
      }), base.replace('http:', 'ws:') + '/mcp'), 'denied');
      for (const path of ['/admin/', '/app/', '/docs']) {
        const response = await context.request.get(base + path);
        assert.match(response.headers()['content-security-policy'], /frame-ancestors 'none'/);
        const errors: string[] = [];
        const listener = (message: import('playwright-core').ConsoleMessage) => errors.push(message.text());
        evil.on('console', listener);
        await evil.evaluate((url) => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, base + path);
        await assertEventually(() => errors.some((e) => /frame-ancestors|X-Frame-Options/i.test(e)));
        evil.off('console', listener);
      }
      await stillSignedIn(base);
    });

    await t.test('OAuth wildcard is credentialless; successful preflight caching never opens admin routes', async () => {
      const base = `http://localhost:${port}`;
      await evil.goto(`http://localhost:${attackerPort}`);
      const before = observed.length;
      for (let i = 0; i < 2; i++) {
        const result = await evil.evaluate(async (url) => {
          const r = await fetch(url, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: '{}' });
          return r.status;
        }, base + '/oauth/register');
        assert.equal(result, 400, 'CORS allows reading validation errors');
      }
      const requests = observed.slice(before).filter((r) => r.path === '/oauth/register');
      assert.equal(requests.filter((r) => r.method === 'OPTIONS').length, 1, 'browser reused the preflight');
      assert.equal(requests.filter((r) => r.method === 'POST').length, 2);
      const preflight = await context.request.fetch(base + '/oauth/register', { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'POST' } });
      assert.equal(preflight.headers()['access-control-allow-origin'], '*');
      assert.equal(preflight.headers()['access-control-allow-credentials'], undefined);
      assert.equal(preflight.headers()['access-control-max-age'], '600');
      // A constant wildcard response is origin-independent and needs no Vary: Origin.
      assert.equal(preflight.headers().vary, undefined);
      assert.equal(await evil.evaluate(async (url) => {
        try { await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' }); return 'allowed'; }
        catch { return 'denied'; }
      }, base + '/oauth/register'), 'denied');
      assert.equal(await evil.evaluate(async (url) => {
        try { await fetch(url, { method: 'POST', credentials: 'include', headers: { 'x-tabularius-admin': '1' } }); return 'allowed'; }
        catch { return 'denied'; }
      }, base + '/tabularius/admin/v1/sign-out'), 'denied');
      await stillSignedIn(base);
    });

    await t.test('successful same-origin logout revokes the session', async () => {
      const base = `http://localhost:${port}`;
      assert.equal(await victim.evaluate(async (base) => (await fetch(base + '/tabularius/admin/v1/sign-out', { method: 'POST', headers: { 'x-tabularius-admin': '1' } })).status, base), 200);
      assert.equal(await victim.evaluate(async (base) => (await fetch(base + '/tabularius/admin/v1/sessions', { headers: { 'x-tabularius-console': '1' } })).status, base), 401);
    });
  } finally {
    await browser.close();
    attacker.closeAllConnections(); s.server.closeAllConnections();
    await Promise.all([new Promise<void>((r) => attacker.close(() => r())), new Promise<void>((r) => s.server.close(() => r()))]);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
});

async function assertEventually(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000;
  while (!check()) {
    assert.ok(performance.now() < deadline, 'browser request or policy violation was observed');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
