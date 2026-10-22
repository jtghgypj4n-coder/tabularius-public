// A DNS name the server was not told about (no --public-url, no --https for it) is refused to a browser or to anything that
// carries a cookie, because a rebinding page reaches this server under such a name. A native client (curl, a server, a
// driver) sends no browser signal and no cookie, and keeps working under any name, as it did before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';

const basic = 'Basic ' + Buffer.from('Admin:pw').toString('base64');

test('a headerless native client works under a DNS host name; a browser, or a cookie, under that name is refused with the fix named', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-host-names-'));
  createStore(join(dir, 'P' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  t.after(async () => { await new Promise<void>((r) => s.server.close(() => r())); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); });
  s.host.get('P')!.setPassword('Admin', 'pw', '[Full Access]');
  const u = new URL(s.url);
  const call = (host: string, headers: Record<string, string>) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, method: 'POST', path: '/fmi/data/vLatest/databases/P/sessions', headers: { host, 'content-type': 'application/json', ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end('{}');
  });

  for (const host of [`127.0.0.1:${u.port}`, `localhost:${u.port}`, 'myserver.lan', `myserver.lan:${u.port}`]) {
    const native = await call(host, { authorization: basic });
    assert.equal(native.status, 200, `${host}: a client with no browser headers is not held to the host name: ${native.body}`);
  }

  const rebound = { origin: 'http://myserver.lan', 'sec-fetch-site': 'same-origin' };
  for (const headers of [rebound as Record<string, string>, { 'sec-fetch-dest': 'document' } as Record<string, string>, { referer: 'http://myserver.lan/page' } as Record<string, string>, { cookie: 'a=b' } as Record<string, string>]) {
    const refused = await call('myserver.lan', { authorization: basic, ...headers });
    assert.equal(refused.status, 403, JSON.stringify(headers));
    assert.match(refused.body, /--public-url or --https/, 'the answer names the fix');
  }
  // The same browser request to this computer's own name is fine, and an IP literal needs no configuration.
  assert.equal((await call(`127.0.0.1:${u.port}`, { authorization: basic, origin: `http://127.0.0.1:${u.port}`, 'sec-fetch-site': 'same-origin' })).status, 200);
  // Each refused name is logged once, with the setting that fixes it.
  await s.host.logs!.flush();
  const { entries } = await s.host.logs!.read('Event', { q: 'was refused: this server was not told that name' });
  assert.equal(entries.length, 1, JSON.stringify(entries.map((e) => e.message)));
  assert.match(entries[0]!.message, /myserver\.lan.*--public-url https:\/\/myserver\.lan/);
});
