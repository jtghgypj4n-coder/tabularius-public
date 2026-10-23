// The SCIM provisioning token expires (90 days unless 1 to 3650 is asked for). After its date, or when the setup holds
// no date at all (made before tokens expired), it is refused exactly like a wrong token and the console says to make a new one.
// Synthetic stores only.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { expiryClock } from '../../store/src/clock.ts';
import { Host, STORE_EXT } from '../src/index.ts';
import { DataApi } from '../src/dataapi.ts';
import { ScimDirectory, ScimEndpoint, scimAdmin } from '../src/scim.ts';

const DAY = 86_400_000;

async function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-scim-expiry-'));
  createStore(join(dir, 'A' + STORE_EXT));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.get('A')!;
  let now = Date.now();
  t.mock.method(expiryClock, 'now', () => now);
  const scim = new ScimDirectory(store);
  const endpoint = new ScimEndpoint(host, new DataApi(host));
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname.startsWith('/tabularius/admin/')) {
      void scimAdmin(host, req, url, (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
    } else void endpoint.handle(req, res, url);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const users = async (token: string) => {
    const r = await fetch(`${base}/tabularius/scim/v2/databases/A/Users`, { headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, text: await r.text(), challenge: r.headers.get('www-authenticate') };
  };
  const admin = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };
  return { store, scim, users, admin, advance: (ms: number) => { now += ms; }, now: () => now };
}

test('a new provisioning token expires in 90 days by default and is refused after that like a wrong token', async (t) => {
  const { scim, users, advance, now } = await setup(t);
  const start = now();
  const token = scim.issueToken();
  assert.equal(Date.parse(scim.settings().expires!), start + 90 * DAY);
  assert.equal((await users(token)).status, 200);
  advance(90 * DAY - 1000);
  assert.equal(scim.tokenValid(token), true);
  assert.equal((await users(token)).status, 200);
  advance(2000);
  assert.equal(scim.tokenValid(token), false);
  const expired = await users(token), wrong = await users(token + 'x');
  assert.equal(expired.status, 401);
  assert.deepEqual(expired, wrong, 'the same refusal, so the endpoint does not say the token was once good');
});

test('a token is made for the days asked, from 1 to 3650; anything else is refused and leaves the current token alone', async (t) => {
  const { scim, now } = await setup(t);
  const first = scim.issueToken();
  const start = now();
  const week = scim.issueToken({ days: 7 });
  assert.equal(Date.parse(scim.settings().expires!), start + 7 * DAY);
  assert.equal(scim.tokenValid(first), false);
  for (const days of [0, -1, 3651, 'soon', NaN, Infinity, {}]) {
    assert.throws(() => scim.issueToken({ days }), /Days should be/, `days ${String(days)}`);
    assert.equal(scim.tokenValid(week), true, 'a refused request does not replace the working token');
  }
  assert.equal(Date.parse(scim.settings().expires!), start + 7 * DAY);
  scim.issueToken({ days: 3650 });
  assert.equal(Date.parse(scim.settings().expires!), start + 3650 * DAY);
});

test('a setup stored without an expiry stops working and is reported as needing a new token', async (t) => {
  const { store, scim, users, admin } = await setup(t);
  const token = scim.issueToken();
  const legacy = { ...scim.settings() } as Record<string, unknown>;
  delete legacy.expires;
  store.sql.prepare(`UPDATE _fm_meta SET json = ? WHERE key = 'scim'`).run(JSON.stringify(legacy));
  assert.equal(scim.tokenValid(token), false);
  const refused = await users(token);
  assert.equal(refused.status, 401);
  assert.deepEqual(refused, await users(token + 'x'));
  const status = await admin('GET', '/tabularius/admin/v1/scim?database=A');
  assert.equal(status.body.on, true);
  assert.equal(status.body.needsReissue, true);
  assert.equal(status.body.active, false);
  assert.equal(status.body.expires, undefined);
  // A new token fixes it.
  const fresh = await admin('POST', '/tabularius/admin/v1/scim/token', { database: 'A' });
  assert.equal(fresh.body.needsReissue, undefined);
  assert.equal((await users(fresh.body.token as string)).status, 200);
});

test('the admin API takes days, shows the expiry, and says when a token has run out', async (t) => {
  const { admin, users, advance, now } = await setup(t);
  const start = now();
  const off = await admin('GET', '/tabularius/admin/v1/scim?database=A');
  assert.equal(off.body.on, false);
  assert.equal(off.body.expires, undefined);

  const issued = await admin('POST', '/tabularius/admin/v1/scim/token', { database: 'A', days: 30 });
  assert.equal(issued.status, 200);
  assert.equal(issued.body.expires, new Date(start + 30 * DAY).toISOString());
  assert.equal(issued.body.active, true);
  const status = await admin('GET', '/tabularius/admin/v1/scim?database=A');
  assert.equal(status.body.expires, new Date(start + 30 * DAY).toISOString());
  assert.equal(status.body.expired, undefined);

  const bad = await admin('POST', '/tabularius/admin/v1/scim/token', { database: 'A', days: 0 });
  assert.equal(bad.status, 400);
  assert.match(String(bad.body.error), /always expires/);
  assert.equal((await users(issued.body.token as string)).status, 200, 'the refused request left the token alone');

  const defaulted = await admin('POST', '/tabularius/admin/v1/scim/token', { database: 'A' });
  assert.equal(defaulted.body.expires, new Date(start + 90 * DAY).toISOString());

  advance(91 * DAY);
  const late = await admin('GET', '/tabularius/admin/v1/scim?database=A');
  assert.equal(late.body.on, true);
  assert.equal(late.body.expired, true);
  assert.equal(late.body.active, false);
  assert.equal((await users(defaulted.body.token as string)).status, 401);
  const renewed = await admin('POST', '/tabularius/admin/v1/scim/token', { database: 'A' });
  assert.equal(renewed.body.expired, undefined);
  assert.equal((await users(renewed.body.token as string)).status, 200);

  const revoked = await admin('DELETE', '/tabularius/admin/v1/scim/token?database=A');
  assert.equal(revoked.body.on, false);
  assert.equal(revoked.body.expires, undefined);
});
