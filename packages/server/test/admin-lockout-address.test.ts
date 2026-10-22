// The console's password lockout counts a person-sized network, not one address: someone with a whole IPv6 /64 has as
// many addresses as they like, and an IPv4-mapped address is the IPv4 one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';

test('console sessions and password lockouts ignore wall-clock jumps', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-console-clock-'));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  t.after(async () => {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  let wall = Date.now(), mono = performance.now();
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  const signIn = (password: string) => fetch(`${s.url}/tabularius/admin/v1/sign-in`, {
    method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ password }),
  });
  const signedIn = await signIn('secret');
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get('set-cookie')!.split(';')[0];
  await signedIn.arrayBuffer();
  const status = async () => {
    const r = await fetch(`${s.url}/tabularius/admin/v1/status`, { headers: { cookie, 'x-tabularius-admin': '1' } });
    await r.arrayBuffer();
    return r.status;
  };
  wall += 24 * 3600_000;
  mono += 1000;
  assert.equal(await status(), 200);
  wall -= 48 * 3600_000;
  mono += 13 * 3600_000;
  assert.equal(await status(), 401);
  for (let i = 0; i < 5; i++) await (await signIn('wrong')).arrayBuffer();
  wall += 3600_000;
  const blocked = await signIn('secret');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');
  await blocked.arrayBuffer();
  wall -= 7200_000;
  mono += 15 * 60_000 + 1;
  const released = await signIn('secret');
  assert.equal(released.status, 200);
  await released.arrayBuffer();
});

test('wrong console passwords from different addresses of one IPv6 /64 share one lockout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-lock-'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {}, proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1', '::1'] });
  const signIn = (password: string, from: string) =>
    fetch(`${s.url}/tabularius/admin/v1/sign-in`, { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json', 'x-forwarded-for': from }, body: JSON.stringify({ password }) });
  try {
    const signedIn = await signIn('admin secret', '2001:db8:1:2::1');
    assert.equal(signedIn.status, 200);
    const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]!;
    await signedIn.arrayBuffer();
    for (let i = 0; i < 5; i++) await signIn('wrong', `2001:db8:1:2:${i}::${i + 1}`);
    // The right password from yet another address of that network is refused; another network is not.
    assert.equal((await signIn('admin secret', '2001:db8:1:2:ffff::9')).status, 429);
    const active = await fetch(`${s.url}/tabularius/admin/v1/status`, { headers: { cookie, 'x-tabularius-admin': '1', 'x-forwarded-for': '2001:db8:1:2:ffff::9' } });
    assert.equal(active.status, 200, 'an existing cookie is usable from the locked /64');
    await active.arrayBuffer();
    assert.equal((await signIn('admin secret', '2001:db8:1:3::1')).status, 200);
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    await s.host.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
