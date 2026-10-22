import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { serve, setAdminPassword, Host, DataApi } from '../src/index.ts';
import { route } from '../src/cluster.ts';
import { Store, LOCKOUT } from '../../store/src/index.ts';
import { McpTokens } from '../src/mcp-tokens.ts';
import { PgServer } from '../src/pgwire.ts';
import { Admin, ADMIN_LIMIT } from '../src/admin.ts';

const basic = (account: string, password: string) => `Basic ${Buffer.from(`${account}:${password}`).toString('base64')}`;
const from = ['2001:db8:1:2::1', '2001:0db8:0001:0002:0:0:0:1'];
async function setup(t: TestContext, proxied = false) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-auth-http-review-'));
  setAdminPassword(dir, 'console-secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, proxyHeader: 'x-forwarded-for', ...(proxied ? { trustedProxies: ['127.0.0.1', '::1'] } : {}), mcpToken: 'configured-admin-secret' });
  t.after(async () => {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  const store = s.host.create('Review');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }] }]);
  store.create('Items', { Title: 'synthetic' });
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest', 'fmapp', 'fmmcp', 'fmxdbc', 'fmodata'] });
  store.setPassword('person', 'person-secret', 'Reader');
  return { ...s, store, dir };
}

test('Data API, OData, SQL and MCP share password failures across IPv6 spellings', async (t) => {
  const { url, store } = await setup(t, true);
  const calls = [
    { path: '/fmi/data/vLatest/databases/Review/sessions', method: 'POST', body: '{}' },
    { path: '/fmi/odata/v4/Review', method: 'GET' },
    { path: '/tabularius/sql/v1/databases/Review/tables', method: 'GET' },
    { path: '/mcp', method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_record', arguments: { database: 'Review', layout: 'Items', recordId: 1 } } }) },
  ];
  for (let i = 0; i < LOCKOUT.attempts; i++) {
    const call = calls[i % calls.length];
    const r = await fetch(url + call.path, { ...call, headers: { authorization: basic('person', 'wrong'), 'x-forwarded-for': from[i % 2], 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' } });
    const body = await r.json();
    assert.ok(r.status === 401 || body.result?.isError);
  }
  assert.ok(store.lockedOut('person', from[0]));
  for (const call of calls) {
    const r = await fetch(url + call.path, { ...call, headers: { authorization: basic('person', 'person-secret'), 'x-forwarded-for': from[1], 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' } });
    const body = await r.json();
    assert.ok(r.status === 401 || body.result?.isError, call.path);
    assert.equal(body.response?.token, undefined);
  }
});

test('console and Admin API share IPv6 lockouts without disabling an existing cookie', async (t) => {
  const { url } = await setup(t);
  const consoleLogin = (password: string, address: string) => fetch(`${url}/tabularius/admin/v1/sign-in`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1', 'x-forwarded-for': address }, body: JSON.stringify({ password }),
  });
  const signed = await consoleLogin('console-secret', from[0]);
  assert.equal(signed.status, 200);
  const cookie = signed.headers.get('set-cookie')!.split(';')[0];
  await signed.arrayBuffer();
  for (let i = 0; i < LOCKOUT.attempts; i++) {
    const response = i % 2 ? await consoleLogin('wrong', from[0]) : await fetch(`${url}/fmi/admin/api/v2/user/auth`, {
      method: 'POST', headers: { authorization: basic('made-up', 'wrong'), cookie, 'x-forwarded-for': from[1] },
    });
    assert.ok([401, 429].includes(response.status));
    await response.arrayBuffer();
  }
  const blocked = await consoleLogin('console-secret', from[0]);
  assert.equal(blocked.status, 429);
  await blocked.arrayBuffer();
  const existing = await fetch(`${url}/tabularius/admin/v1/passkeys`, { headers: { cookie, 'x-forwarded-for': from[1] } });
  assert.equal(existing.status, 200);
  await existing.arrayBuffer();
});

test('MCP cached credentials are evicted after a peer resets the password during a wall-clock rollback', async (t) => {
  const { url, dir } = await setup(t);
  const read = async (password: string) => {
    const response = await fetch(url + '/mcp', {
      method: 'POST', headers: { authorization: basic('person', password), 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_record', arguments: { database: 'Review', layout: 'Items', recordId: 1 } } }),
    });
    return response.json();
  };
  assert.equal((await read('person-secret')).result?.isError, undefined);
  const peer = new Store(join(dir, 'Review.openhbam.sqlite'));
  try {
    peer.setPassword('person', 'replacement-secret');
    const earlier = Date.now() - 86_400_000;
    t.mock.method(Date, 'now', () => earlier);
    assert.equal((await read('person-secret')).result?.isError, true);
    assert.equal((await read('replacement-secret')).result?.isError, undefined);
  } finally { peer.close(); }
});

test('account-bound signed URLs observe peer recreation and stay revoked after host restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-link-restart-review-'));
  // A replacement cluster worker receives the same signing key from its front process.
  const urlKey = Buffer.alloc(32, 42);
  const first = new Host(dir, () => {}, { background: false, urlKey });
  t.after(async () => { await first.close(); rmSync(dir, { recursive: true, force: true }); });
  const store = first.create('Review');
  store.setPassword('Admin', 'remaining-admin-secret', '[Full Access]');
  store.setPassword('name #?& é', 'secret', '[Full Access]');
  const signed = new URLSearchParams(first.signed('Review', 1, '', store.linkPrincipal('name #?& é')));
  const untouched = new URLSearchParams(first.signed('Review', 1, '', store.linkPrincipal('Admin')));
  assert.equal(first.checkUrl('Review', 1, signed), true);
  const peer = new Store(join(dir, 'Review.openhbam.sqlite'));
  try {
    peer.deleteAccount('name #?& é'); peer.setPassword('name #?& é', 'secret', '[Full Access]');
    assert.equal(first.checkUrl('Review', 1, signed), false);
    assert.equal(first.checkUrl('Review', 1, untouched), true);
  } finally { peer.close(); }
  await first.close();
  const second = new Host(dir, () => {}, { background: false, urlKey });
  try {
    assert.equal(second.checkUrl('Review', 1, signed), false);
    assert.equal(second.checkUrl('Review', 1, untouched), true);
  } finally { await second.close(); }
});

test('Admin API route and method variants cannot mint a token from a console cookie', async (t) => {
  const { url } = await setup(t);
  const signed = await fetch(url + '/tabularius/admin/v1/sign-in', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ password: 'console-secret' }),
  });
  assert.equal(signed.status, 200);
  const cookie = signed.headers.get('set-cookie')!.split(';')[0]; await signed.arrayBuffer();
  for (const [path, method] of [['/user/auth', 'GET'], ['/user/auth/', 'POST'], ['/user/%61uth', 'POST'], ['/user/auth', 'POST']]) {
    const response = await fetch(url + '/fmi/admin/api/v2' + path, { method, headers: { cookie, authorization: basic('different', 'wrong') } });
    const body = await response.json();
    assert.ok(response.status >= 400);
    assert.equal(body.response?.token, undefined);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('cluster Basic affinity follows the folded account across routes and changing passwords', () => {
  for (const workers of [2, 3, 4, 16]) {
    const pick = (url: string, account: string, password: string) => route({ url, method: 'POST', headers: { authorization: basic(account, password) } } as unknown as IncomingMessage, workers);
    const expected = pick('/fmi/data/vLatest/databases/Review/sessions', 'Straße', 'one');
    for (const path of ['/fmi/data/vLatest/databases/Review/sessions', '/fmi/odata/v4/Review', '/mcp', '/tabularius/sql/v1/databases/Review/tables']) {
      for (const account of ['Straße', 'ＳＴＲＡＳＳＥ', 'stras\u00adse']) {
        for (const password of ['one', 'two', 'three', 'four']) assert.equal(pick(path, account, password), expected);
      }
      const headerAuth = basic('Straße', 'one');
      const tokenFirst = path.includes('/odata/') || path.includes('/sql/');
      assert.equal(route({ url: path, method: 'POST', headers: { authorization: headerAuth, 'x-fm-data-access-token': '01' + 'a'.repeat(46) } } as unknown as IncomingMessage, workers), tokenFirst ? 1 : expected);
      assert.equal(route({ url: path, method: 'POST', headers: { authorization: headerAuth.slice(0, 12) + ' ' + headerAuth.slice(12) } } as unknown as IncomingMessage, workers), expected);
      if (!path.endsWith('/sessions')) assert.equal(route({ url: path, method: 'POST', headers: { authorization: headerAuth, 'x-fm-data-oauth-request-id': 'forged' } } as unknown as IncomingMessage, workers), expected);
    }
    for (const path of ['/fmi/data/vLatest/databases/Review/sessions/', '/fmi/data/v2//databases/Review/%73essions']) {
      assert.equal(route({ url: path, method: 'POST', headers: { authorization: basic('other', 'wrong'), 'x-fm-data-oauth-request-id': 'grant' } } as unknown as IncomingMessage, workers), 0);
    }
  }
});

test('local and federated rest/web sessions cannot inherit a recreated identity from a peer', async (t) => {
  const { dir, host, store } = await setup(t);
  store.setExternalAccount('group', 'Reader');
  const api = new DataApi(host);
  const local = ['rest', 'web'].map((client) => api.open(store, 'person', client as 'rest' | 'web'));
  const external = ['rest', 'web'].map((client) => api.open(store, 'person@example.test', client as 'rest' | 'web', 'group'));
  const peer = new Store(join(dir, 'Review.openhbam.sqlite'));
  try {
    peer.deleteAccount('person');
    peer.setPassword('person', 'replacement', 'Reader');
    peer.deleteAccount('group');
    peer.setExternalAccount('group', 'Reader');
    for (const token of [...local, ...external]) assert.equal(api.alive(token), false);
    assert.equal(api.alive(api.open(store, 'person', 'web')), true);
  } finally { peer.close(); }
});

test('cluster logout follows the decoded path session rather than unrelated credential headers', () => {
  const session = '01' + 'b'.repeat(46);
  for (const path of [`/fmi/data/vLatest/databases/Review/sessions/${session}`, `/fmi/data/v2//databases/Review/%73essions/%30${session.slice(1)}/`]) {
    for (const authorization of [basic('other', 'wrong'), 'Bearer 00' + 'c'.repeat(46)]) {
      assert.equal(route({ url: path, method: 'DELETE', headers: { authorization, 'x-fm-data-access-token': '00' + 'd'.repeat(46) } } as unknown as IncomingMessage, 2), 1);
    }
  }
});

test('persisted API and MCP revocations survive reopening while sessions do not', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-auth-restart-review-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = new Host(dir, () => {}, { background: false });
  const store = first.create('Review');
  const api = new DataApi(first);
  const session = api.open(store, 'Admin', 'web');
  const token = store.createApiToken('Admin');
  const tokens = new McpTokens(dir);
  const mcp = tokens.create({ database: 'Review', account: 'Admin' });
  assert.ok(store.apiToken(token));
  assert.equal(tokens.revoke(mcp.id), true);
  store.revokeApiToken(store.apiTokens()[0].id);
  first.close();
  const second = new Host(dir, () => {}, { background: false });
  try {
    assert.equal(new DataApi(second).alive(session), false);
    assert.equal(second.get('Review')!.apiToken(token), undefined);
    assert.equal(new McpTokens(dir).check(mcp.token), undefined);
  } finally { second.close(); }
});

test('session timeout edits apply to existing rest and web sessions through clock jumps', async (t) => {
  const { host, store } = await setup(t);
  const api = new DataApi(host);
  let mono = performance.now(), wall = Date.now();
  t.mock.method(performance, 'now', () => mono);
  t.mock.method(Date, 'now', () => wall);
  host.config.setSessionIdleMinutes(10);
  host.config.setWebSessionIdleMinutes(20);
  const rest = api.open(store, 'person', 'rest'), web = api.open(store, 'person', 'web');
  mono += 6 * 60_000; wall += 86_400_000;
  assert.equal(api.alive(rest), true); assert.equal(api.alive(web), true);
  host.config.setSessionIdleMinutes(5);
  wall -= 172_800_000;
  assert.equal(api.alive(rest), false); assert.equal(api.alive(web), true);
  host.config.setWebSessionIdleMinutes(null);
  assert.equal(api.alive(web), false);
});

function pgAttempt(port: number, password: string) {
  const socket = connect(port, '127.0.0.1');
  const answer = new Promise<string>((resolve, reject) => {
    let data = Buffer.alloc(0);
    socket.on('error', reject);
    socket.setTimeout(10_000, () => socket.destroy(new Error('synthetic pgwire handshake timed out')));
    socket.on('connect', () => {
      const params = Buffer.from('user\0person\0database\0Review\0\0');
      const head = Buffer.alloc(8); head.writeInt32BE(8 + params.length); head.writeInt32BE(196608, 4);
      socket.write(Buffer.concat([head, params]));
    });
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      while (data.length >= 5 && data.length >= data.readInt32BE(1) + 1) {
        const type = String.fromCharCode(data[0]), length = data.readInt32BE(1);
        const body = data.subarray(5, length + 1); data = data.subarray(length + 1);
        if (type === 'R' && body.readInt32BE() === 3) {
          const value = Buffer.from(password + '\0'), head = Buffer.alloc(5);
          head.write('p'); head.writeInt32BE(value.length + 4, 1); socket.write(Buffer.concat([head, value]));
        }
        if (type === 'E' || type === 'Z') { resolve(type === 'Z' ? 'ready' : body.toString()); socket.destroy(); }
      }
    });
    socket.on('close', () => resolve('closed'));
  });
  return { socket, answer };
}

test('pgwire and HTTP failures share the hosted account budget', async (t) => {
  const { host, store, url } = await setup(t, true);
  const pg = new PgServer(host, { port: 0 });
  t.mock.method(pg, 'isLocal', (socket: Socket) => { Object.defineProperty(socket, 'remoteAddress', { value: from[1], configurable: true }); return true; });
  const port = await pg.listen();
  try {
    for (let i = 0; i < 2; i++) assert.match(await pgAttempt(port, 'wrong').answer, /password authentication failed/);
    for (let i = 2; i < LOCKOUT.attempts; i++) {
      const response = await fetch(`${url}/fmi/data/vLatest/databases/Review/sessions`, { method: 'POST', headers: { authorization: basic('person', 'wrong'), 'x-forwarded-for': from[0] }, body: '{}' });
      assert.equal(response.status, 401); await response.arrayBuffer();
    }
    assert.ok(store.lockedOut('person', from[0]));
    // The lock is not named on the wire; the right password is refused all the same.
    assert.match(await pgAttempt(port, 'person-secret').answer, /password authentication failed/);
  } finally { pg.close(); }
});

test('a peer enabling MFA defeats warmed HTTP password caches and pgwire password-only sign-in', async (t) => {
  const { host, dir, url } = await setup(t);
  const paths = ['/fmi/odata/v4/Review', '/tabularius/sql/v1/databases/Review/tables'];
  for (const path of paths) {
    const response = await fetch(url + path, { headers: { authorization: basic('person', 'person-secret') } });
    assert.equal(response.status, 200); await response.arrayBuffer();
  }
  const peer = new Store(join(dir, 'Review.openhbam.sqlite'));
  try { peer.setAccountRequire2fa('person', true); } finally { peer.close(); }
  for (const path of paths) {
    const response = await fetch(url + path, { headers: { authorization: basic('person', 'person-secret') } });
    assert.equal(response.status, 403); await response.arrayBuffer();
  }
  const pg = new PgServer(host, { port: 0 });
  try { assert.match(await pgAttempt(await pg.listen(), 'person-secret').answer, /requires two-factor/); } finally { pg.close(); }
});

test('pgwire disconnect during password verification cannot retain a signed-in slot', async (t) => {
  const { host, store } = await setup(t);
  const pg = new PgServer(host, { port: 0 });
  const port = await pg.listen();
  let release!: (ok: boolean) => void, entered!: () => void;
  const hashing = new Promise<void>((resolve) => { entered = resolve; });
  t.mock.method(store, 'verifyAsync', () => { entered(); return new Promise<boolean>((resolve) => { release = resolve; }); });
  const held = t.mock.method(pg, 'holdSigned');
  try {
    const attempt = pgAttempt(port, 'person-secret');
    await hashing;
    const closed = once(attempt.socket, 'close'); attempt.socket.destroy(); await closed;
    const deadline = performance.now() + 5_000;
    while (pg.connections && performance.now() < deadline) await nextTurn();
    assert.equal(pg.connections, 0, 'the server observed the disconnect before verification resolves');
    release(true);
    await attempt.answer; await nextTurn(); await nextTurn();
    assert.equal(held.mock.callCount(), 0);
  } finally { release?.(false); pg.close(); }
});

test('passkey capacity edits and wall jumps preserve a live ceremony and authenticated registration', async (t) => {
  const { host } = await setup(t);
  const admin = new Admin(host, new DataApi(host)) as unknown as {
    issuePasskeyChallenge(from?: string, direct?: boolean): string | undefined;
    takePasskeyChallenge(challenge: string): boolean;
  };
  const limits = { ...ADMIN_LIMIT };
  t.after(() => Object.assign(ADMIN_LIMIT, limits));
  let elapsed = performance.now(), wall = Date.now();
  t.mock.method(performance, 'now', () => elapsed);
  t.mock.method(Date, 'now', () => wall);
  const ceremony = admin.issuePasskeyChallenge('2001:db8:1:2::1')!;
  ADMIN_LIMIT.passkeyChallengesPerAddress = 1;
  wall += 86_400_000;
  assert.equal(admin.issuePasskeyChallenge('2001:0db8:0001:0002::2'), undefined);
  assert.ok(admin.issuePasskeyChallenge(), 'authenticated registration ignores stranger caps');
  assert.equal(admin.takePasskeyChallenge(ceremony), true);
  const replacement = admin.issuePasskeyChallenge('2001:db8:1:2::3')!;
  assert.ok(replacement);
  wall -= 172_800_000; elapsed += 300_000;
  assert.equal(admin.takePasskeyChallenge(replacement), false);
  assert.ok(admin.issuePasskeyChallenge('2001:db8:1:2::4'));
});
