import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
