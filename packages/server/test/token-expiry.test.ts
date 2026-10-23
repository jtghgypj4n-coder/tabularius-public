// A token made without saying how long it lives gets a lifetime: 90 days for API and AI-app tokens, a year for calendar feed
// addresses. Nobody can ask for none: 0 days is refused; TABULARIUS_TOKEN_DEFAULT_DAYS changes the default for tokens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { StoreError } from '../../store/src/index.ts';
import { DEFAULT_FEED_DAYS, DEFAULT_TOKEN_DAYS, defaultTokenDays, tokenExpiry } from '../src/token-expiry.ts';

const DAY = 86_400_000;
const near = (date: string | Date | undefined, days: number) => {
  assert.ok(date, `expected an expiry about ${days} days out`);
  const left = (new Date(date).getTime() - Date.now()) / DAY;
  assert.ok(Math.abs(left - days) < 0.01, `expires in ${left} days, not about ${days}`);
};
const withEnv = <T>(value: string | undefined, run: () => T): T => {
  const was = process.env.TABULARIUS_TOKEN_DEFAULT_DAYS;
  if (value === undefined) delete process.env.TABULARIUS_TOKEN_DEFAULT_DAYS; else process.env.TABULARIUS_TOKEN_DEFAULT_DAYS = value;
  try { return run(); } finally { if (was === undefined) delete process.env.TABULARIUS_TOKEN_DEFAULT_DAYS; else process.env.TABULARIUS_TOKEN_DEFAULT_DAYS = was; }
};

test('tokenExpiry: nothing asked takes the default, anything else is checked, and 0 is refused', () => {
  withEnv(undefined, () => {
    assert.equal(defaultTokenDays(), DEFAULT_TOKEN_DAYS);
    for (const blank of [undefined, null, '']) near(tokenExpiry(blank), DEFAULT_TOKEN_DAYS);
    near(tokenExpiry(30), 30);
    near(tokenExpiry('7'), 7);
    near(tokenExpiry(1 / 48), 1 / 48);
    near(tokenExpiry(undefined, DEFAULT_FEED_DAYS), DEFAULT_FEED_DAYS);
    for (const bad of [0, '0', -1, 3651, NaN, Infinity, 'soon', true, {}, [], ' ']) {
      assert.throws(() => tokenExpiry(bad), (e) => e instanceof StoreError && e.code === 960, String(JSON.stringify(bad)));
    }
  });
});

test('TABULARIUS_TOKEN_DEFAULT_DAYS changes the default; 0 and nonsense keep the 90 days', () => {
  withEnv('30', () => { assert.equal(defaultTokenDays(), 30); near(tokenExpiry(undefined), 30); });
  for (const nonsense of ['0', '0.0', 'soon', '-3', '99999', ' ']) withEnv(nonsense, () => assert.equal(defaultTokenDays(), DEFAULT_TOKEN_DAYS, nonsense));
});

let dir: string;
let server: Server;
let host: Host;
let base: string;
let adminToken: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-token-expiry-'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.create('Shop');
  store.setPassword('Admin', 'a long enough password', '[Full Access]');
  store.setPassword('Ann', 'another long password', '[Full Access]');
  adminToken = store.createApiToken('Admin');
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const security = (body: unknown) => post('/tabularius/security/v1/databases/Shop/tokens', body, { authorization: `Bearer ${adminToken}` });
const admin = (body: unknown) => post('/tabularius/admin/v1/mcp/tokens', { database: 'Shop', account: 'Ann', ...(body as object) }, { 'x-tabularius-admin': '1' });
const expiryOf = (token: string) => host.get('Shop')!.apiTokens().find((t) => token.startsWith(`ohbt_${t.id}.`))!.expires;

test('Manage Security: a token made with no lifetime expires in 90 days; 0 and a bad number are refused', async () => {
  const made = async (body: object) => {
    const r = await security({ account: 'Ann', ...body });
    return { status: r.status, token: ((await r.json()) as { token?: string }).token };
  };
  const plain = await made({});
  assert.equal(plain.status, 200);
  near(expiryOf(plain.token!), DEFAULT_TOKEN_DAYS);
  const nulled = await made({ expiresDays: null });
  near(expiryOf(nulled.token!), DEFAULT_TOKEN_DAYS);
  const short = await made({ expiresDays: 7 });
  near(expiryOf(short.token!), 7);
  for (const expiresDays of [0, -1, 'soon', 5000]) assert.equal((await made({ expiresDays })).status, 400, String(expiresDays));
});

test('the admin console: an AI app token made with no lifetime expires in 90 days; 0 is refused', async () => {
  const made = async (body: object) => {
    const r = await admin(body);
    assert.equal(r.status, 201, await r.clone().text());
    return ((await r.json()) as { token: string }).token;
  };
  near(expiryOf(await made({})), DEFAULT_TOKEN_DAYS);
  near(expiryOf(await made({ days: 30 })), 30);
  for (const days of [0, -1, 1.5, 'x', 4000]) assert.equal((await admin({ days })).status, 400, String(days));
});

test('the token command and calendar feeds follow the same rule', async () => {
  const { createFeed } = await import('../src/calendar.ts');
  const store = host.get('Shop')!;
  store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Day', type: 'date' }, { name: 'Title' }] }]);
  const feed = (expiresDays?: number) => {
    const made = createFeed(store, 'Ann', store.privileges('Ann'), { layout: 'Events', start: 'Day', ...(expiresDays === undefined ? {} : { expiresDays }) });
    return store.apiTokens().find((t) => t.id === made.id)?.expires;
  };
  near(feed(), DEFAULT_FEED_DAYS);
  near(feed(10), 10);
  assert.throws(() => feed(0), (e) => (e as { status?: number }).status === 400, 'a feed address cannot be made to last for ever either');
});
