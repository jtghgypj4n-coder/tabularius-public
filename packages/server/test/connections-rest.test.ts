// The REST connection type: any web API, signed in on the server. A script gives a path and gets the answer; it never
// holds the token, password, key or OAuth secret, can't override the sign-in header, and can't make a call the connection
// doesn't allow. Tested against a local stand-in service; nothing here reaches a real one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connections, ConnectionError, scriptConnections } from '../src/index.ts';

const SECRETS = { token: 'tok_live_9f8e7d6c5b4a', password: 'hunter2-pass', apiKey: 'key_5c4b3a2d1e0f', clientSecret: 'cs_secret_3a2b1c0d' };
let dir: string;
let service: Server;
let origin: string;
let connections: Connections;
let seen: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[] = [];
let tokenCalls = 0;
let tokenLife = 3600;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-connections-rest-'));
  service = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/oauth/token') {
      tokenCalls++;
      const basic = Buffer.from(String(req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
      if (basic !== `client-1:${SECRETS.clientSecret}` || !body.includes('grant_type=client_credentials')) return void res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"invalid_client","error_description":"bad secret cs_secret_3a2b1c0d"}');
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: `oauth-token-${tokenCalls}`, token_type: 'Bearer', expires_in: tokenLife }));
    }
    if (url.pathname === '/v1/redirect') return void res.writeHead(302, { location: 'https://elsewhere.example.com/steal' }).end();
    const auth = String(req.headers.authorization ?? '');
    const ok = auth === `Bearer ${SECRETS.token}` || auth === 'Basic ' + Buffer.from(`ann:${SECRETS.password}`).toString('base64')
      || req.headers['x-api-key'] === SECRETS.apiKey || /^Bearer oauth-token-\d+$/.test(auth);
    if (url.pathname.startsWith('/v1/open') || ok) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, method: req.method, path: url.pathname, query: url.search, echoed: body }));
    } else res.writeHead(401).end('no');
  });
  await new Promise<void>((r) => service.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(service.address() as { port: number }).port}`;
  connections = new Connections(dir);
  const make = (name: string, config: Record<string, string>, secrets: Record<string, string>) => {
    connections.create({ name, type: 'rest', config: { baseUrl: `${origin}/v1`, ...config } });
    for (const [k, v] of Object.entries(secrets)) connections.setSecret(name, k, v);
    connections.approve(name);
  };
  make('bearer', { auth: 'bearer' }, { token: SECRETS.token });
  make('basic', { auth: 'basic' }, { username: 'ann', password: SECRETS.password });
  make('keyed', { auth: 'header', headerName: 'X-Api-Key', access: 'write' }, { apiKey: SECRETS.apiKey });
  make('oauth', { auth: 'oauth2', tokenUrl: `${origin}/oauth/token`, scope: 'orders:read' }, { clientId: 'client-1', clientSecret: SECRETS.clientSecret });
  make('open', { auth: 'none' }, {});
});
after(async () => {
  await new Promise<void>((r) => service.close(() => r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const call = (name: string, req: Partial<{ method: string; path: string; query: string; headers: Record<string, string>; body: string }> = {}, files = ['Shop']) =>
  scriptConnections(connections).request(name, { method: 'GET', path: '/items', query: '', headers: {}, ...req, ...(req.body ? { body: new TextEncoder().encode(req.body) } : {}) } as never, files);
const answer = async (r: Response) => ({ status: r.status, json: await r.json().catch(() => undefined) as any });

test('each sign-in kind is applied by the server, and the script gets only the answer', async () => {
  for (const name of ['bearer', 'basic', 'keyed', 'oauth']) {
    seen = [];
    const r = await answer(await call(name, { path: '/items/7', query: '?page=2' }));
    assert.equal(r.status, 200, name);
    assert.equal(r.json.path, '/v1/items/7', name);
    assert.equal(r.json.query, '?page=2', name);
    // Nothing the service answered holds a secret.
    for (const s of Object.values(SECRETS)) assert.ok(!JSON.stringify(r).includes(s), `${name} answer holds a secret`);
  }
  assert.equal((await answer(await call('open', { path: '/open/x' }))).status, 200);
  seen = [];
  await call('open', { path: '/open/x' });
  assert.equal(seen[0].headers.authorization, undefined);
});

test('OAuth 2 asks for a token once, reuses it, and asks again when it has run out', async () => {
  // A new scope is a new token, whatever an earlier test left cached.
  connections.update('oauth', { config: { baseUrl: `${origin}/v1`, auth: 'oauth2', tokenUrl: `${origin}/oauth/token`, scope: 'orders:read items:read' } });
  tokenCalls = 0;
  tokenLife = 3600;
  await call('oauth');
  await call('oauth');
  assert.equal(tokenCalls, 1);
  const tokenRequest = seen.find((x) => x.url === '/oauth/token')!;
  assert.match(tokenRequest.body, /scope=orders%3Aread\+items%3Aread/);
  // Short-lived tokens are renewed before use.
  const c2 = new Connections(dir);
  c2.update('oauth', { config: { baseUrl: `${origin}/v1`, auth: 'oauth2', tokenUrl: `${origin}/oauth/token`, scope: 'orders:write' } });
  tokenLife = 1;
  tokenCalls = 0;
  const sc = scriptConnections(c2);
  await sc.request('oauth', { method: 'GET', path: '/items', query: '', headers: {} }, ['Shop']);
  await sc.request('oauth', { method: 'GET', path: '/items', query: '', headers: {} }, ['Shop']);
  assert.equal(tokenCalls, 2);
  c2.update('oauth', { config: { baseUrl: `${origin}/v1`, auth: 'oauth2', tokenUrl: `${origin}/oauth/token`, scope: 'orders:read' } });
});

test('a bad OAuth secret is explained without the service\'s description, which can echo what was sent', async () => {
  const c = new Connections(dir);
  c.create({ name: 'oauth-bad', type: 'rest', config: { baseUrl: `${origin}/v1`, auth: 'oauth2', tokenUrl: `${origin}/oauth/token` } });
  c.setSecret('oauth-bad', 'clientId', 'client-1');
  c.setSecret('oauth-bad', 'clientSecret', 'wrong');
  const t = await c.test('oauth-bad');
  assert.equal(t.ok, false);
  assert.match(t.message, /The token service answered 401 \(invalid_client\) and gave no token/);
  assert.ok(!t.message.includes('cs_secret'));
});

test('a script can\'t set the sign-in, add headers the transport owns, or leave the base address', async () => {
  seen = [];
  const bad: [Partial<Parameters<typeof call>[1]>, RegExp][] = [
    [{ headers: { Authorization: 'Bearer mine' } }, /set by the connection/],
    [{ headers: { cookie: 'a=b' } }, /set by the connection/],
    [{ headers: { host: 'evil.example.com' } }, /set by the connection/],
    [{ headers: { 'x-forwarded-for': '1.1.1.1' } }, /set by the connection/],
    [{ headers: { 'X-HTTP-Method-Override': 'DELETE' } }, /set by the connection/],
    [{ headers: { 'x-tabularius-admin': '1' } }, /set by the connection/],
    // A tab or line break inside a dot part is dropped by the URL parser, which would turn it into "..".
    [{ path: '/.\t./admin' }, /can't contain spaces or control/],
    [{ path: '/.\n./admin' }, /can't contain spaces or control/],
    [{ path: '/a b' }, /can't contain spaces or control/],
    [{ path: '/..;/admin' }, /isn't valid|can't contain/],
    [{ path: '/../admin' }, /can't contain/],
    [{ path: '/%2e%2e/admin' }, /can't contain/],
    [{ path: '/a%2Fb' }, /can't contain/],
    [{ query: '?a=1\r\nX-Evil: 1' }, /isn't valid/],
    [{ method: 'POST', body: '{}' }, /allows GET, HEAD.*not POST/],
    [{ method: 'DELETE' }, /allows GET, HEAD/],
  ];
  for (const [req, why] of bad) await assert.rejects(call('bearer', req), why, JSON.stringify(req));
  await assert.rejects(call('keyed', { headers: { 'X-Api-Key': 'mine' } }), /set by the connection/);
  assert.deepEqual(seen, []);
});

test('a path with an odd part stays below the base address or is refused', async () => {
  seen = [];
  // Allowed: encoded characters, dots inside a name.
  for (const path of ['/items/a%20b', '/items/v1.2', '/items/.hidden', '/items/caf%C3%A9']) {
    const r = await answer(await call('bearer', { path }));
    assert.equal(r.status, 200, path);
  }
  assert.ok(seen.every((x) => x.url.startsWith('/v1/items/')), JSON.stringify(seen.map((x) => x.url)));
});

test('write access allows more methods, with the body and the script\'s own headers', async () => {
  seen = [];
  const r = await answer(await call('keyed', { method: 'POST', path: '/items', body: '{"a":1}', headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'r1' } }));
  assert.equal(r.status, 200);
  assert.equal(r.json.echoed, '{"a":1}');
  assert.equal(seen[0].headers['x-request-id'], 'r1');
  assert.equal(seen[0].headers['content-type'], 'application/json');
  assert.equal(seen[0].headers['x-api-key'], SECRETS.apiKey);
});

test('a redirect is not followed, so the sign-in never goes to another host', async () => {
  seen = [];
  const r = await call('bearer', { path: '/redirect' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://elsewhere.example.com/steal');
  assert.equal(seen.length, 1);
});

test('settings are checked: a key as a setting, the wrong sign-in\'s settings, a missing secret', async () => {
  const c = new Connections(dir);
  const bad: [Record<string, string>, RegExp][] = [
    [{ baseUrl: 'https://api.example.com', auth: 'bearer', headerName: 'X-Key' }, /only for sign-in "header"/],
    [{ baseUrl: 'https://api.example.com', auth: 'oauth2' }, /needs the token address/],
    [{ baseUrl: 'https://api.example.com', auth: 'none', tokenUrl: 'https://auth.example.com/t' }, /only for sign-in "oauth2"/],
    [{ baseUrl: 'https://api.example.com', auth: 'magic' }, /Sign-in is one of/],
    [{ baseUrl: 'https://api.example.com', access: 'all' }, /read or write/],
    [{ baseUrl: 'https://user:pw@api.example.com' }, /Put no credentials|looks like/],
    [{ baseUrl: 'http://169.254.169.254/latest' }, /link-local/],
    [{ baseUrl: 'http://api.example.com' }, /Use https/],
    [{ baseUrl: 'https://api.example.com', testPath: '/a/../b' }, /path to test/],
    [{ baseUrl: 'https://api.example.com', auth: 'oauth2', tokenUrl: 'https://auth.example.com/t', scope: 'sk-ant-api03-abcdefghijklmnopqrstuvwx' }, /looks like an API key/],
  ];
  for (const [config, why] of bad) assert.throws(() => c.create({ name: 'r', type: 'rest', config }), why, JSON.stringify(config));
  const made = c.create({ name: 'tok', type: 'rest', config: { baseUrl: 'https://api.example.com/v2/', auth: 'bearer' } });
  assert.equal(made.config.baseUrl, 'https://api.example.com/v2');
  assert.equal(made.config.access, 'read');
  // Only the secrets its sign-in uses are asked for, and approval waits for them.
  assert.deepEqual(c.get('tok').secrets.map((x) => x.name), ['token']);
  assert.throws(() => c.setSecret('tok', 'password', 'x'), /doesn't use password/);
  assert.throws(() => c.approve('tok'), /Set Token first/);
  c.remove('tok');
  // No sign-in needs no secrets, so it can be approved at once.
  c.create({ name: 'public', type: 'rest', config: { baseUrl: 'https://api.example.com' } });
  assert.equal(c.get('public').ready, true);
  c.approve('public');
  c.remove('public');
});

test('Test checks the sign-in against a path that needs it, and says what it found', async () => {
  const c = new Connections(dir);
  c.create({ name: 'tested', type: 'rest', config: { baseUrl: `${origin}/v1`, auth: 'bearer', testPath: '/items' } });
  c.setSecret('tested', 'token', SECRETS.token);
  const good = await c.test('tested');
  assert.equal(good.ok, true, good.message);
  assert.match(good.message, /Reached 127\.0\.0\.1\/items: it answered 200 with the sign-in/);
  c.setSecret('tested', 'token', 'wrong');
  const refused = await c.test('tested');
  assert.equal(refused.ok, false);
  assert.match(refused.message, /answered 401: it refused the sign-in/);
  assert.ok(!refused.message.includes('wrong'));
  c.remove('tested');
});

test('a script reaches a REST connection through Insert from URL', async () => {
  const { createStore, parseScriptText, Store } = await import('../../store/src/index.ts');
  const { runScript } = await import('../../scripts/src/index.ts');
  createStore(join(dir, 'Shop.sqlite'));
  const store = new Store(join(dir, 'Shop.sqlite'), 'Shop');
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'x' }] }] as never);
  try {
    const steps = parseScriptText('Insert from URL [ $r ; "connection://bearer/items/9?x=1" ]\nExit Script [ Text Result: JSONGetElement ( $r ; "path" ) & JSONGetElement ( $r ; "query" ) ]', store.schema)
      .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
    const r = await runScript(store, { id: 1, name: 't', steps } as never, { network: true, connections: scriptConnections(connections), trace: true });
    assert.equal(r.error, 0, JSON.stringify(r.trace?.find((t) => t.message)));
    assert.equal(r.result, '/v1/items/9?x=1');
    assert.ok(!JSON.stringify(r).includes(SECRETS.token));
    assert.ok(ConnectionError);
  } finally {
    store.close();
  }
});
