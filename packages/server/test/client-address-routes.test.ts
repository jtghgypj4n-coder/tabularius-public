import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, serveCluster } from '../src/index.ts';
import { LOCKOUT } from '../../store/src/index.ts';
import { stubCommands } from './edge-test-helpers.ts';

// Tabularius policy: security-defaults.md. The wire forms follow RFC 7239/RFC 5952.
test('synthetic routes share attribution for lockout, local-only accounts and admin gating', async t => {
  stubCommands(t);
  const dir = mkdtempSync(join(tmpdir(), 'client-routes-'));
  const app = await serve({ dir, port: 0, hostname: '127.0.0.1', watch: false, log: () => {},
    proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1'],
  });
  t.after(async () => {
    app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  const store = app.host.create('Synthetic');
  const full = store.privilegeSets().find(p => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest', 'fmodata', 'fmxdbc'] });
  store.setPassword('local', 'secret', full.name); store.setAccountLocalOnly('local', true);
  store.setPassword('person', 'secret', full.name);
  const login = (who: string, password: string, ip?: string) => fetch(app.url + '/fmi/data/vLatest/databases/Synthetic/sessions', {
    method: 'POST', headers: { authorization: 'Basic ' + btoa(`${who}:${password}`), ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: '{}',
  });
  assert.equal((await login('local', 'secret')).status, 400);
  for (const ip of ['bad, 203.0.113.9', 'unknown', '127.0.0.1']) {
    assert.equal((await login('local', 'secret', ip)).status, 400);
  }
  assert.equal((await login('local', 'secret', '::ffff:cb00:7109')).status, 401);
  for (let i = 0; i < LOCKOUT.attempts; i++) await (await login('person', 'wrong', `2001:db8:1:2::${i + 1}`)).arrayBuffer();
  assert.equal((await login('person', 'secret', '2001:0DB8:0001:0002:ffff::1')).status, 401);
  assert.equal((await login('person', 'secret', '2001:db8:1:3::1')).status, 200);
  for (const path of ['/fmi/odata/v4/Synthetic', '/tabularius/sql/v1/databases/Synthetic/tables']) {
    const r = await fetch(app.url + path, { headers: { authorization: 'Basic ' + btoa('person:secret'), 'x-forwarded-for': '2001:db8:1:2::ff' } });
    assert.equal(r.status, 401); assert.ok(Number(r.headers.get('retry-after')) > 0); await r.arrayBuffer();
  }
  const wall = Date.now();
  t.mock.method(Date, 'now', () => wall);
  const preview = async (ip: string) => {
    const r = await fetch(app.url + '/tabularius/security/v1/databases/Synthetic/accounts/import/preview', {
      method: 'POST', headers: { 'x-forwarded-for': ip }, body: '{}',
    });
    await r.arrayBuffer(); return r.status;
  };
  for (let i = 0; i < 60; i++) assert.equal(await preview(`2001:db8:2:3::${i + 1}`), 401);
  assert.equal(await preview('2001:0DB8:0002:0003:ffff::1'), 429);
  assert.equal(await preview('2001:db8:2:4::1'), 401);
  for (const ip of ['203.0.113.9', 'bad', '127.0.0.1']) {
    const r = await fetch(app.url + '/tabularius/admin/v1/status', { headers: { 'x-forwarded-for': ip } });
    assert.equal(r.status, ip === '203.0.113.9' ? 403 : 400); await r.arrayBuffer();
  }
});

for (const cluster of [false, true]) test(`${cluster ? 'cluster workers' : 'single server'} preserve OAuth /64 keys and ignore forged internal headers`, { timeout: 45000 }, async t => {
  stubCommands(t);
  const dir = mkdtempSync(join(tmpdir(), 'client-oauth-'));
  const opts = { dir, port: 0, hostname: '127.0.0.1', watch: false, log: () => {}, proxyHeader: 'x-forwarded-for' as const, trustedProxies: ['127.0.0.1'] };
  const app = cluster ? await serveCluster(opts, 2) : await serve(opts);
  t.after(async () => {
    if ('close' in app) await app.close();
    else { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); }
    rmSync(dir, { recursive: true, force: true });
  });
  for (const ip of [undefined, 'bad, 203.0.113.9']) {
    for (const path of ['/tabularius/admin/v1/status', '/mcp']) {
      const r = await fetch(app.url + path, { headers: ip ? { 'x-forwarded-for': ip } : {} });
      assert.equal(r.status, 400); await r.arrayBuffer();
    }
  }
  const register = async (ip: string) => {
    const r = await fetch(app.url + '/oauth/register', { method: 'POST', headers: {
      'content-type': 'application/json', 'x-forwarded-for': ip, 'x-tabularius-peer': '198.51.100.123',
    }, body: JSON.stringify({ redirect_uris: ['https://example.invalid/callback'] }) });
    await r.arrayBuffer(); return r.status;
  };
  for (let i = 0; i < 30; i++) assert.equal(await register(i % 2 ? `2001:0db8:0000:0000::${i + 1}` : `2001:db8::${i + 1}`), 201);
  assert.equal(await register('2001:db8:0:0:ffff::1'), 429);
  assert.equal(await register('2001:db8:0:1::1'), 201);
});
