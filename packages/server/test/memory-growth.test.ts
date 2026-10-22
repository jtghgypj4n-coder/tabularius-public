import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { Host } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';
import { Admin } from '../src/admin.ts';
import { AdminApi } from '../src/adminapi.ts';
import { InboundHooks } from '../src/inbound-hooks.ts';
import { OAuthServer } from '../src/oauth.ts';
import { MemoryUsage } from '../src/ai-usage.ts';
import { McpTokens } from '../src/mcp-tokens.ts';
import { ChangeFeed } from '../src/changes.ts';
import { Replication } from '../src/replication.ts';
import { LogShipper } from '../src/logs.ts';
import { WebClient } from '../src/webclient.ts';
import { sessionFor } from '../src/mcp.ts';
import { ScriptQueue } from '../src/server-queue.ts';

// Inspect retained state as well as responses: a successful request alone cannot detect a leak.
const inside = (value: unknown): Record<string, any> => value as Record<string, any>;
function hostFor(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-growth-'));
  const host = new Host(dir);
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  return host;
}
const request = (address: string, authorization = '') => ({ headers: { authorization }, socket: { remoteAddress: address } }) as IncomingMessage;

test('admin Basic verification is bounded when the ignored username churns', (t) => {
  const host = hostFor(t);
  const admin = new Admin(host, new DataApi(host));
  t.mock.method(inside(admin), 'passwordHash', () => 'test-password-hash');
  t.mock.method(inside(admin), 'tryPassword', () => null); // no password hashing in a cardinality test
  for (let i = 0; i < 1100; i++) assert.equal(admin.checkBasic(request('192.0.2.1', 'Basic ' + btoa(`user-${i}:pw`))), null);
  assert.ok(inside(admin).verified.size <= 1024);
});

test('admin lockouts have a hard bound without forgetting active blocks', (t) => {
  const host = hostFor(t);
  const admin = new Admin(host, new DataApi(host));
  const now = performance.now();
  for (let i = 0; i < 5100; i++) inside(admin).noteMiss(`network-${i}`, { count: 5, first: now, until: now + 900_000 });
  assert.ok(inside(admin).failures.size <= 5000);
  t.mock.method(inside(admin), 'passwordHash', () => 'unused');
  assert.equal(admin.checkBasic(request('new-network', 'Basic ' + btoa('admin:pw')))?.status, 429, 'saturation must fail closed');
});

test('sessions have a process cap across accounts and evict through normal cleanup', (t) => {
  const host = hostFor(t);
  const store = host.create('Growth');
  const api = new DataApi(host);
  t.mock.method(store, 'accountInactive', () => false);
  t.mock.method(store, 'identityAllowed', () => true);
  t.mock.method(store, 'signInLocationAllowed', () => true);
  const privileges = store.privileges('Admin');
  t.mock.method(store, 'privileges', () => privileges);
  const first = api.open(store, 'first', 'web');
  store.locks.view('T', 1, first, 'first');
  store.locks.acquire('T', 1, first, 'first');
  for (let i = 0; i < 2100; i++) api.open(store, `account-${i}`, 'web', undefined, `address-${i}`);
  assert.ok(api.sessionCount <= 2048);
  assert.equal(api.alive(first), false);
  assert.equal(store.locks.viewers().length, 0);
  assert.equal(store.locks.all().length, 0);
});

test('ending a session clears its web timers, paused work and live session on file close', (t) => {
  const host = hostFor(t);
  const store = host.create('Growth');
  const api = new DataApi(host);
  const web = new WebClient(host, api);
  t.after(() => web.stop());
  const token = api.open(store, 'Admin', 'web');
  inside(web).clientActions({ token, db: store.name }, [{ step: 'Install OnTimer Script', timerScriptId: 1, interval: 5 }]);
  // This table normally receives a timer action after a script; seed only the suspended continuation.
  inside(web).timers.set(token, { id: 'timer', db: store.name, scriptId: 1 });
  let canceled = false;
  inside(web).paused.set('pause', { token, db: store.name, answer: () => { canceled = true; } });
  api.end(token);
  assert.equal(inside(web).timers.size, 0);
  assert.equal(inside(web).paused.size, 0);
  assert.ok(canceled);
  api.open(store, 'Admin', 'web');
  host.closeFile('Growth');
  assert.equal(api.sessionCount, 0);
});

test('Admin API ids forget departed clients and never alias an old numeric id', (t) => {
  const host = hostFor(t);
  const api = new DataApi(host);
  const admin = new AdminApi(new Admin(host, api), host, api);
  const ids = inside(admin).clientIds;
  const first = ids.id('departed');
  for (let i = 0; i < 4200; i++) ids.id(`client-${i}`);
  assert.ok(ids.byKey.size <= 4096);
  assert.equal(ids.byId.size, ids.byKey.size);
  assert.equal(ids.key(first), undefined);
  inside(admin).clients();
  assert.equal(ids.byKey.size, 0, 'an empty live list releases the mappings');
});

test('webhook rate tables refuse new keys at capacity and expire old keys', (t) => {
  const hooks = new InboundHooks(hostFor(t), true);
  const map = inside(hooks).bad as Map<string, number[]>;
  const now = performance.now();
  t.mock.method(performance, 'now', () => now);
  for (let i = 0; i < 10_000; i++) assert.equal(inside(hooks).over(map, `address-${i}`, 1), false);
  assert.equal(inside(hooks).over(map, 'overflow', 1), true);
  assert.equal(map.size, 10_000);
  assert.equal(inside(hooks).over(map, 'address-0', 1), true, 'churn cannot reset an existing rate limit');
  t.mock.method(performance, 'now', () => now + 60_001);
  assert.equal(inside(hooks).over(map, 'overflow', 1), false);
  assert.ok(map.size <= 10_000);
});

test('OAuth address registration table is bounded even while all entries are fresh', (t) => {
  const host = hostFor(t);
  const oauth = new OAuthServer(host, host.dir);
  t.after(() => oauth.close());
  const map = inside(oauth).registered as Map<string, number[]>;
  for (let i = 0; i < 1000; i++) map.set(`address-${i}`, [performance.now()]);
  assert.throws(() => inside(oauth).register(request('192.0.2.10'), JSON.stringify({ redirect_uris: ['https://example.com/callback'] })), /too many|busy/i);
  assert.equal(map.size, 1000);
});

test('fallback AI usage is bounded without granting evicted accounts a fresh quota', (t) => {
  const usage = new MemoryUsage();
  for (let i = 0; i < 1100; i++) usage.add(`account-${i}`, 10, 0.01);
  assert.ok(inside(usage).days.size <= 1024);
  assert.equal(usage.today(), 11_000);
  assert.ok(usage.today('account-0') >= 10);
  t.mock.method(Date.prototype, 'toISOString', () => '2035-02-01T00:00:00.000Z');
  usage.add('new-day', 5, 0.01);
  assert.equal(usage.today(), 5);
  assert.ok(inside(usage).days.size <= 2);
  assert.equal(inside(usage).months.size, 1);
});

test('MCP token revoke releases its last-used throttle entry', (t) => {
  const tokens = new McpTokens(hostFor(t).dir);
  const token = tokens.create({ database: 'Growth', account: 'Admin' });
  assert.ok(tokens.check(token.token));
  assert.equal(inside(tokens).touched.size, 1);
  assert.ok(tokens.revoke(token.id));
  assert.equal(inside(tokens).touched.size, 0);
});

test('change feeds and replication release closed store incarnations', (t) => {
  const host = hostFor(t);
  const api = new DataApi(host);
  const feed = new ChangeFeed(host, api);
  const shipper = new LogShipper(host);
  const replication = new Replication(host, shipper, 'secret');
  t.after(() => { replication.close(); shipper.stop(); });
  const store = host.create('Growth');
  inside(feed).feed(store.name);
  shipper.follow(store);
  host.closeFile(store.name);
  assert.equal(inside(feed).feeds.size, 0);
  assert.equal(inside(replication).files.size, 0);
});

test('MCP script globals are discarded when their file closes', (t) => {
  const host = hostFor(t);
  host.create('Growth');
  const who = { account: 'Admin', database: 'Growth' };
  const first = sessionFor(host, 'Growth', who);
  host.closeFile('Growth');
  host.openFile('Growth');
  assert.notEqual(sessionFor(host, 'Growth', who), first);
});

test('server script queue bounds waiting jobs without abandoning admitted work', async () => {
  // Main's queue already refuses past `pendingLimit` waiting jobs (and `perProducerLimit` per file) when it is full; this checks it holds and recovers.
  const queue = new ScriptQueue(1);
  let release!: () => void;
  const first = queue.run(() => new Promise<void>((ok) => { release = ok; }));
  const waiting = Array.from({ length: queue.pendingLimit }, (_, i) => queue.run(async () => 1, { file: `File${i}` }));
  assert.throws(() => queue.run(async () => 2, { file: 'Extra' }), /queue is full/);
  release();
  await Promise.all([first, ...waiting]);
  assert.equal(queue.queued, 0);
  assert.equal(queue.running, 0);
});
