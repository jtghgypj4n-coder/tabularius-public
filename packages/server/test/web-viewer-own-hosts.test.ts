import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createStore } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const admin = { 'x-tabularius-admin': '1', 'content-type': 'application/json' };

test('web viewer hosts: the names this server answers to are refused when listed and ignored when a restored list already has them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-viewer-own-hosts-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  const hosted = await serve({ dir, port: 0, log: () => {} });
  try {
    const store = hosted.host.get('Shop')!;
    store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] }]);
    store.setPassword('Ann', 'pw', '[Full Access]');
    const hostsOf = async (body?: unknown) => {
      const r = await fetch(`${hosted.url}/tabularius/admin/v1/web-viewer-hosts/Shop`, body === undefined ? {} : { method: 'POST', headers: admin, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    const policy = async () => (await fetch(`${hosted.url}/app/`)).headers.get('content-security-policy') ?? '';
    const layoutHosts = async () => {
      const login = await fetch(`${hosted.url}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Ann:pw') } });
      const auth = { authorization: `Bearer ${(await login.json()).response.token}` };
      return ((await (await fetch(`${hosted.url}/tabularius/app/v1/databases/Shop/layouts/Notes`, { headers: auth })).json()) as { webViewerHosts?: string[] }).webViewerHosts;
    };

    // Names the server is configured with: the public address, the --https domains, the --mcp-origin origins and the computer's own name.
    hosted.host.publicUrl = 'https://files.corp-example.com';
    hosted.host.acmeDomains = ['acme.corp-example.net'];
    hosted.host.mcpAllowedOrigins = ['https://assistant.corp-example.org:8443'];
    hosted.host.ownAliases = ['box.corp-example.io'];
    for (const own of ['files.corp-example.com', 'acme.corp-example.net', 'assistant.corp-example.org', 'box.corp-example.io', '*.corp-example.net', '*.corp-example.io']) {
      const refused = await hostsOf({ hosts: [own] });
      assert.equal(refused.status, 400, own);
      assert.match(refused.body.error, /address of this server itself/, own);
    }
    assert.deepEqual(store.webViewerHosts, []);

    // A list that came back with a restored backup (it never went through the route) is not trusted for these names.
    store.setWebViewerHosts(['maps.example.com', 'files.corp-example.com', 'acme.corp-example.net', 'assistant.corp-example.org', 'box.corp-example.io', '*.corp-example.org']);
    assert.deepEqual(hosted.host.webViewerHostsAll(), ['maps.example.com']);
    assert.deepEqual(await layoutHosts(), ['maps.example.com']);
    assert.match(await policy(), /frame-src 'self' about: data: blob: https:\/\/maps\.example\.com;/);
    const status = await hostsOf();
    assert.deepEqual(status.body.hosts, ['maps.example.com']);
    assert.deepEqual(status.body.ignored, ['*.corp-example.org', 'acme.corp-example.net', 'assistant.corp-example.org', 'box.corp-example.io', 'files.corp-example.com']);

    // An entry that is not trusted (a restored file's) is named too, whatever the reason.
    store.setWebViewerHosts([]);
    (store as unknown as { sql: { prepare(q: string): { run(...a: unknown[]): void } } }).sql
      .prepare(`INSERT INTO _fm_meta VALUES ('webViewerHosts', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(['maps.example.com', '*.co.uk', 'files.corp-example.com']));
    assert.deepEqual((await hostsOf()).body, { hosts: ['maps.example.com'], ignored: ['*.co.uk', 'files.corp-example.com'] });
    store.setWebViewerHosts(['maps.example.com', 'files.corp-example.com', 'acme.corp-example.net', 'assistant.corp-example.org', 'box.corp-example.io', '*.corp-example.org']);

    // The name check follows the server as it is now, not as it was when the list was saved.
    hosted.host.acmeDomains = [];
    hosted.host.mcpAllowedOrigins = [];
    hosted.host.ownAliases = [];
    hosted.host.publicUrl = undefined;
    assert.equal(hosted.host.webViewerHostsAll().length, 6);
    assert.equal((await hostsOf()).body.ignored, undefined);
  } finally {
    await new Promise<void>((r) => hosted.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('web viewer hosts: the name a request came in by is ignored for that request, as the list is read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-viewer-own-hosts-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  const hosted = await serve({ dir, port: 0, log: () => {} });
  try {
    const store = hosted.host.get('Shop')!;
    store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] }]);
    store.setPassword('Ann', 'pw', '[Full Access]');
    store.setWebViewerHosts(['maps.example.com', 'app.corp-example.dev', '*.corp-example.dev']);
    const u = new URL(hosted.url);
    // Reached by a name the server was never told (a proxy in front, no --public-url): the Host header is the only place it shows.
    const get = (host: string, path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
      const r = request({ host: u.hostname, port: u.port, path, method: path.includes('sessions') ? 'POST' : 'GET', headers: { host, ...headers } }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      r.on('error', reject);
      r.end();
    });
    const layoutHosts = async (host: string) => {
      // Basic credentials are ambient, so the server refuses them under a name it was not told; the token is not, and it is used under the proxy's name.
      const login = await get(`127.0.0.1:${u.port}`, '/fmi/data/vLatest/databases/Shop/sessions', { authorization: 'Basic ' + btoa('Ann:pw') });
      const auth = { authorization: `Bearer ${JSON.parse(login.body).response.token}` };
      return (JSON.parse((await get(host, '/tabularius/app/v1/databases/Shop/layouts/Notes', auth)).body) as { webViewerHosts: string[] }).webViewerHosts;
    };
    const policy = async (host: string) => String((await get(host, '/app/')).headers['content-security-policy']);

    for (const host of [`app.corp-example.dev:${u.port}`, 'APP.corp-example.dev.']) {
      assert.deepEqual(await layoutHosts(host), ['maps.example.com'], host);
      assert.match(await policy(host), /frame-src 'self' about: data: blob: https:\/\/maps\.example\.com;/, host);
    }
    // By another name, the wildcard that would cover that one stays, and by the address everything listed is used.
    assert.deepEqual(await layoutHosts(`127.0.0.1:${u.port}`), ['*.corp-example.dev', 'app.corp-example.dev', 'maps.example.com']);
    assert.match(await policy(`127.0.0.1:${u.port}`), /https:\/\/\*\.corp-example\.dev https:\/\/app\.corp-example\.dev https:\/\/maps\.example\.com;/);
  } finally {
    await new Promise<void>((r) => hosted.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('web viewer hosts: a --browser-origin name is one the server answers to', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-viewer-browser-origin-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  const hosted = await serve({ dir, port: 0, log: () => {} });
  try {
    hosted.host.browserOrigins = ['https://proxy.corp-example.org'];
    assert.ok(hosted.host.ownHostNames().includes('proxy.corp-example.org'));
    const r = await fetch(`${hosted.url}/tabularius/admin/v1/web-viewer-hosts/Shop`, { method: 'POST', headers: admin, body: JSON.stringify({ hosts: ['*.corp-example.org'] }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /address of this server itself/);
    assert.deepEqual(hosted.host.get('Shop')!.webViewerHosts, []);
  } finally {
    await new Promise<void>((x) => hosted.server.close(() => x()));
    rmSync(dir, { recursive: true, force: true });
  }
});
