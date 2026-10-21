import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const admin = { 'x-tabularius-admin': '1', 'content-type': 'application/json' };

test('web viewer hosts: none to begin with; the console lists them, the app page and layout carry them, and the log says who', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-viewer-hosts-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  createStore(join(dir, 'Other.openhbam.sqlite'));
  const hosted = await serve({ dir, port: 0, log: () => {} });
  try {
    const store = hosted.host.get('Shop')!;
    store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] }]);
    store.setPassword('Ann', 'pw', '[Full Access]');
    const hostsOf = async (body?: unknown, file = 'Shop') => {
      const r = await fetch(`${hosted.url}/tabularius/admin/v1/web-viewer-hosts/${file}`, body === undefined ? {} : { method: 'POST', headers: admin, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    const policy = async () => (await fetch(`${hosted.url}/app/`)).headers.get('content-security-policy') ?? '';
    const layoutMeta = async () => {
      const login = await fetch(`${hosted.url}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Ann:pw') } });
      const auth = { authorization: `Bearer ${(await login.json()).response.token}` };
      return (await (await fetch(`${hosted.url}/tabularius/app/v1/databases/Shop/layouts/Notes`, { headers: auth })).json()) as { webViewerHosts?: string[] };
    };

    assert.deepEqual((await hostsOf()).body, { hosts: [] });
    assert.match(await policy(), /frame-src 'self' about: data: blob:;/);
    assert.deepEqual((await layoutMeta()).webViewerHosts, []);

    // Bad requests change nothing and say what is wrong.
    for (const bad of [{ hosts: 'maps.example.com' }, {}, null, { hosts: ['https://maps.example.com'] }, { hosts: ['127.0.0.1'] }, { hosts: [42] }]) assert.equal((await hostsOf(bad)).status, 400, JSON.stringify(bad));
    assert.match((await hostsOf({ hosts: ['maps.example.com/x'] })).body.error, /just a host name/);
    // This server's own host is refused: a page of it would run beside the app.
    hosted.host.publicUrl = 'https://files.corp-example.com/';
    for (const hosts of [['files.corp-example.com'], ['*.corp-example.com']]) {
      const refused = await hostsOf({ hosts });
      assert.equal(refused.status, 400);
      assert.match(refused.body.error, /address of this server itself/);
    }
    assert.deepEqual(store.webViewerHosts, []);
    hosted.host.publicUrl = undefined;
    assert.deepEqual(store.webViewerHosts, []);
    assert.equal((await fetch(`${hosted.url}/tabularius/admin/v1/web-viewer-hosts/Nope`)).status, 404);

    assert.deepEqual((await hostsOf({ hosts: ['Maps.example.com', '*.cdn.example.org'] })).body, { hosts: ['*.cdn.example.org', 'maps.example.com'] });
    assert.match(await policy(), /frame-src 'self' about: data: blob: https:\/\/\*\.cdn\.example\.org https:\/\/maps\.example\.com;/);
    assert.deepEqual((await layoutMeta()).webViewerHosts, ['*.cdn.example.org', 'maps.example.com']);
    assert.deepEqual(hosted.host.get('Other')!.webViewerHosts, [], 'another file keeps its own list');
    assert.deepEqual(hosted.host.webViewerHostsAll(), ['*.cdn.example.org', 'maps.example.com']);

    // Kept in the file; the security log says who changed what.
    assert.deepEqual(new Store(path, 'Shop').webViewerHosts, ['*.cdn.example.org', 'maps.example.com']);
    assert.deepEqual(store.securityEvents({ kind: 'web-viewer-hosts-changed' }).map((e) => e.account), ['admin console']);

    // The status page lists them for the console.
    const status = await (await fetch(`${hosted.url}/tabularius/admin/v1/status`, { headers: { 'x-tabularius-console': '1' } })).json();
    assert.deepEqual(status.databases.find((d: { name: string }) => d.name === 'Shop').webViewerHosts, ['*.cdn.example.org', 'maps.example.com']);

    assert.deepEqual((await hostsOf({ hosts: [] })).body, { hosts: [] });
    assert.match(await policy(), /frame-src 'self' about: data: blob:;/);
    assert.equal(store.securityEvents({ kind: 'web-viewer-hosts-changed' }).length, 2);
  } finally {
    await new Promise<void>((r) => hosted.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});
