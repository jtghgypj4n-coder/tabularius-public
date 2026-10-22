// A DNS name the server was not told about (no --public-url, no --https for it) is refused on every route that takes a cookie
// or Basic credentials, whether or not the request looks like a browser's: a rebinding page can send no Origin, Referer or
// Fetch Metadata on a plain GET and set Authorization itself. Native clients on a DNS name need --public-url or --https too.
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

test('a DNS host name the server was not told is refused on ambient routes, browser-like or not, with the fix named', async (t) => {
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

  // This computer by address or by localhost works with no browser headers at all.
  for (const host of [`127.0.0.1:${u.port}`, `localhost:${u.port}`]) {
    const native = await call(host, { authorization: basic });
    assert.equal(native.status, 200, `${host}: ${native.body}`);
  }
  // A DNS name nobody configured is refused to a request with no browser header too, and the answer names the fix.
  for (const host of ['db.example.org', `db.example.org:${u.port}`]) {
    const native = await call(host, { authorization: basic });
    assert.equal(native.status, 403, `${host}: a headerless client is not exempt`);
    assert.match(native.body, /--public-url or --https/, 'the answer names the fix');
  }

  // The rebinding reproduction: a page whose name points here sends a same-origin GET with no Origin, Referer or Fetch
  // Metadata and sets Authorization itself.
  const getXml = (host: string, headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, method: 'GET', path: '/fmi/xml/fmresultset.xml?-db=P&-lay=L&-findall', headers: { host, ...headers } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(await getXml('rebound.example', { authorization: basic }), 403, 'rebound GET, Basic, no other header');
  assert.equal(await getXml(`rebound.example:${u.port}`, { authorization: basic }), 403);
  assert.notEqual(await getXml(`127.0.0.1:${u.port}`, { authorization: basic }), 403, 'the same call to this computer by address is not refused by the guard');

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
  assert.equal(entries.length, 3, JSON.stringify(entries.map((e) => e.message)));
  for (const name of ['myserver.lan', 'db.example.org', 'rebound.example']) {
    assert.equal(entries.filter((e) => e.message.includes(name)).length, 1, `${name} is logged once`);
  }
  assert.ok(entries.every((e) => /--public-url https:\/\/\S+ \(or --https \S+\)/.test(e.message)), 'the log line names the setting');
});
