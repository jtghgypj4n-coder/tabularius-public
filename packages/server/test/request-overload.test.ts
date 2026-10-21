import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword, STORE_EXT } from '../src/index.ts';
import { createStore, type DesignOp } from '../../store/src/index.ts';
import { requestClass } from '../src/request-gate.ts';

test('three times the gate sheds requests while health, sign-in and assets answer; slots recover', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-overload-'));
  createStore(join(dir, 'Synthetic' + STORE_EXT));
  setAdminPassword(dir, 'console secret');
  const served = await serve({ dir, port: 0, hostname: '127.0.0.1', watch: false, requestLimit: 8, requestQueue: 4, proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1'], log: () => {} });
  const { host, server, url } = served;
  const store = host.get('Synthetic')!;
  const records = '/fmi/data/vLatest/databases/Synthetic/layouts/Items/records';
  const basic = 'Basic ' + btoa('Admin:pw');
  const holds: Array<{ finish: () => void; result: Promise<number> }> = [];
  try {
    assert.equal(requestClass('POST', '/fmi/data/vLatest/databases/Synthetic/layouts/Items/_find'), 'heavy');
    assert.equal(requestClass('POST', '/tabularius/app/v1/databases/Synthetic/layouts/Items/export'), 'heavy');
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }] as DesignOp[]);
    store.setPassword('Admin', 'pw', '[Full Access]');
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest'])] });
    const login = async () => fetch(`${url}/fmi/data/vLatest/databases/Synthetic/sessions`, {
      method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' }, body: '{}', signal: AbortSignal.timeout(4000),
    });
    const first = await login();
    const firstBody = await first.json() as { response: { token: string } };
    assert.equal(first.status, 200, JSON.stringify(firstBody));
    const token = firstBody.response.token;
    const hold = (address: string) => {
      const req = request(new URL(records, url), {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'transfer-encoding': 'chunked', 'x-forwarded-for': address },
      });
      const result = new Promise<number>((resolve, reject) => {
        req.on('response', (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on('error', reject);
      });
      req.write('{"fieldData":');
      let ended = false;
      return { finish: () => { if (!ended) { ended = true; req.end('{"Name":"generated"}}'); } }, result };
    };
    for (let i = 0; i < 4; i++) holds.push(hold('198.51.100.1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const otherAddress = await fetch(`${url}${records}`, {
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '198.51.100.2' }, signal: AbortSignal.timeout(4000),
    });
    assert.equal(otherAddress.status, 200, 'one address must not occupy every ordinary slot');
    for (let i = 0; i < 2; i++) holds.push(hold('198.51.100.2'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const flood = Array.from({ length: 18 }, () => fetch(`${url}${records}`, {
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '198.51.100.1' }, signal: AbortSignal.timeout(4000),
    }).then(async (r) => {
      const raw = await r.text();
      let code = raw;
      try { code = JSON.parse(raw).messages?.[0]?.code ?? raw; } catch {}
      return { status: r.status, retry: r.headers.get('retry-after'), code };
    })
      .catch((e) => ({ status: 0, retry: null, code: `failed: ${(e as Error).message}` })));
    const start = performance.now();
    const [health, signIn, asset] = await Promise.all([
      fetch(`${url}/tabularius/health`, { headers: { 'x-forwarded-for': '198.51.100.9' }, signal: AbortSignal.timeout(4000) }),
      login(),
      fetch(`${url}/app/`, { headers: { 'x-forwarded-for': '198.51.100.9' }, signal: AbortSignal.timeout(4000) }),
    ]);
    assert.ok(performance.now() - start < 2400, 'priority responses exceeded the bound');
    assert.equal(health.status, 200);
    assert.equal(signIn.status, 200);
    assert.equal(asset.status, 200);
    const metrics = await (await fetch(`${url}/tabularius/admin/v1/metrics`, { headers: { authorization: 'Basic ' + btoa(':console secret'), 'x-tabularius-admin': '1', 'x-forwarded-for': '198.51.100.9' }, signal: AbortSignal.timeout(4000) })).text();
    assert.match(metrics, /tabularius_request_gate_queue_depth \d+/);
    assert.match(metrics, /tabularius_request_gate_shed_total \d+/);
    const shed = await Promise.all(flood);
    holds.forEach((h) => h.finish());
    const statuses = [...shed.map((s) => s.status), ...await Promise.all(holds.map((h) => h.result))];
    assert.ok(statuses.filter((s) => s === 503).length >= 12, `expected shedding, got ${JSON.stringify(shed)}`);
    assert.ok(shed.filter((s) => s.status === 503).every((s) => s.retry === '1' && s.code === '301'));
    const recovered = await fetch(`${url}/tabularius/health`, { headers: { 'x-forwarded-for': '198.51.100.9' }, signal: AbortSignal.timeout(4000) });
    assert.equal(recovered.status, 200);
    const again = await login();
    assert.equal(again.status, 200);
    const after = await (await fetch(`${url}/tabularius/admin/v1/metrics`, { headers: { authorization: 'Basic ' + btoa(':console secret'), 'x-tabularius-admin': '1', 'x-forwarded-for': '198.51.100.9' }, signal: AbortSignal.timeout(4000) })).text();
    assert.match(after, /tabularius_request_gate_queue_depth 0/);
    assert.match(after, /tabularius_request_gate_active 1/);
    assert.match(after, /tabularius_request_gate_shed_total [1-9]\d*/);
  } finally {
    holds.forEach((h) => h.finish());
    await Promise.allSettled(holds.map((h) => h.result));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
