import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Agent, request as httpRequest } from 'node:http';
import { trustedProxyAddresses } from '../src/client-address.ts';
import { createEdgeServer, EDGE_LIMITS } from '../src/edge-limits.ts';
import { listen, normal, RawClient, request, stubCommands } from './edge-test-helpers.ts';

const ok = (_req: unknown, res: import('node:http').ServerResponse) => res.end('ok');

test('slow headers: absolute deadline beats a continuous trickle; another client works', { timeout: 5000 }, async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer(ok, { headersMs: 150, checkMs: 10 }));
  const c = await new RawClient(port).ready();
  c.send('GET / HTTP/1.1\r\nHost: localhost\r\nX-Slow: ');
  const trickle = setInterval(() => c.send('x'), 20);
  try {
    await normal(port);
    assert.match(await c.end(), /^HTTP\/1\.1 408 /);
    await normal(port);
  } finally { clearInterval(trickle); }
});

test('body idle deadline permits sustained progress beyond the budget, but refuses a stalled body', async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer((req, res) => {
    if (req.method === 'POST') { req.resume(); req.on('end', () => res.end('uploaded')); }
    else res.end('ok');
  }, { bodyMs: 300, checkMs: 10 }));
  const c = await new RawClient(port).ready();
  c.send(request('/', 'Content-Length: 10\r\nConnection: close\r\n', 'POST'));
  for (let i = 0; i < 10; i++) { c.send('x'); await sleep(60); }
  assert.match(await c.end(), /200 [\s\S]*uploaded/);
  const stalled = await new RawClient(port).ready();
  stalled.send(request('/', 'Content-Length: 10000\r\n', 'POST') + 'x');
  await normal(port);
  assert.match(await stalled.end(), /^HTTP\/1\.1 408 /);
  await normal(port);
});

test('header byte/count and request-line boundaries reject explicitly without silent truncation', async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer(ok));
  for (const [raw, status] of [
    [request('/', 'X-Large: ' + 'a'.repeat(EDGE_LIMITS.headerBytes) + '\r\n'), 431],
    [request('/', Array.from({ length: EDGE_LIMITS.headerCount }, (_, i) => `X-${i}: x\r\n`).join('')), 431],
    [request('/' + 'a'.repeat(EDGE_LIMITS.requestLineBytes)), 414],
  ] as const) {
    const c = await new RawClient(port).ready();
    c.send(raw);
    await normal(port);
    assert.match(await c.end(), new RegExp(`^HTTP/1.1 ${status} `));
  }
  // Host and Connection count toward the 100 accepted fields; duplicate names count too.
  const c = await new RawClient(port).ready();
  const exact = 'X: x\r\n'.repeat(EDGE_LIMITS.headerCount - 2);
  assert.match(await c.send(request('/', exact + 'Connection: close\r\n')).end(), /^HTTP\/1\.1 200 /);
  const line = await new RawClient(port).ready();
  assert.match(await line.send(request('/' + 'x'.repeat(EDGE_LIMITS.requestLineBytes - 16), 'Connection: close\r\n')).end(), /^HTTP\/1\.1 200 /);
});

test('malformed chunks and ambiguous framing are dropped; no pipelined request executes', async t => {
  stubCommands(t);
  let commits = 0;
  const server = createEdgeServer((req, res) => {
    if (req.method !== 'POST') { res.end('ok'); return; }
    req.on('error', () => {});
    req.resume(); req.on('end', () => { commits++; res.end('ok'); });
  });
  const port = await listen(t, server);
  for (const raw of [
    request('/', 'Transfer-Encoding: chunked\r\n', 'POST') + 'Z\r\nabc\r\n0\r\n\r\n',
    request('/', 'Transfer-Encoding: chunked\r\n', 'POST') + '1\r\nxNO\r\n0\r\n\r\n',
    request('/', 'Transfer-Encoding: chunked\r\nContent-Length: 1\r\n', 'POST') + '0\r\n\r\n',
    request('/', 'Content-Length: 1\r\nContent-Length: 2\r\n', 'POST') + 'xx',
  ]) {
    const c = await new RawClient(port).ready();
    c.send(raw + request('/forbidden', '', 'POST'));
    await normal(port);
    assert.match(await c.end(), /^HTTP\/1\.1 400 /);
    assert.equal(commits, 0);
  }
});

test('pipelined writes finish in order, including a response already sent in part', async t => {
  stubCommands(t);
  const order: string[] = [];
  const port = await listen(t, createEdgeServer((req, res) => {
    order.push(req.url!);
    res.writeHead(200, { 'content-length': '4' });
    res.write('ok');
    setTimeout(() => res.end(req.url!.slice(1)), 40);
  }));
  const c = await new RawClient(port).ready();
  c.send(request('/01') + request('/02', 'Connection: close\r\n'));
  const text = await c.end();
  assert.deepEqual(order, ['/01', '/02']);
  assert.match(text, /ok01HTTP\/1.1 200 [\s\S]*ok02$/);
});

test('pipelined surplus never loses a committed response or dispatches beyond the budget', async t => {
  stubCommands(t);
  let commits = 0;
  const port = await listen(t, createEdgeServer((_req, res) => {
    commits++;
    setTimeout(() => res.end('committed'), 30);
  }, { requestsPerSocket: 2 }));
  const c = await new RawClient(port).ready();
  c.send(request().repeat(1000));
  const text = await c.end();
  assert.equal(commits, 2);
  assert.equal((text.match(/committed/g) ?? []).length, 2);
  assert.doesNotMatch(text, /HTTP\/1.1 [45]/);
  await normal(port);
});

test('idle keep-alive closes and a socket cannot exceed its request allowance', async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer(ok, { idleMs: 100, requestsPerSocket: 2 }));
  const idle = await new RawClient(port).ready();
  idle.send(request());
  await idle.until(s => s.includes('ok'));
  await normal(port);
  await idle.end();
  const busy = await new RawClient(port).ready();
  busy.send(request().repeat(4));
  const text = await busy.end();
  assert.equal((text.match(/HTTP\/1.1 200/g) ?? []).length, 2);
  assert.doesNotMatch(text, /HTTP\/1.1 [45]/);
  await normal(port);
});

for (const cap of ['connections', 'connectionsPerAddress'] as const) {
  test(`${cap}: excess connections close, an admitted normal client works, slots return on close`, async t => {
    stubCommands(t);
    const port = await listen(t, createEdgeServer(ok, { [cap]: 3 }));
    const healthy = await new RawClient(port).ready();
    const a = await new RawClient(port).ready();
    const b = await new RawClient(port).ready();
    const overflow = await new RawClient(port).ready();
    assert.equal(await overflow.end(), '');
    healthy.send(request());
    await healthy.until(s => s.includes('ok'));
    a.socket.destroy(); b.socket.destroy();
    await Promise.all([a.closed, b.closed]);
    // A second request round trip ensures the server has processed the disconnects.
    healthy.send(request('/', 'Connection: close\r\n'));
    await healthy.end();
    await normal(port);
  });
}

test('upgrades, CONNECT, invalid Expect and HTTP/2 prefaces cannot create untracked protocols', async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer(ok));
  for (const [raw, status] of [
    [request('/', 'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: YWFhYWFhYWFhYWFhYWFhYQ==\r\n'), 400],
    [request('/', 'Connection: Upgrade\r\nUpgrade: h2c\r\n'), 400],
    [request('localhost:80', '', 'CONNECT'), 400],
    [request('/', 'Expect: surprise\r\n'), 417],
    ['PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n', 400],
  ] as const) {
    const c = await new RawClient(port).ready();
    c.send(raw);
    await normal(port);
    assert.match(await c.end(), new RegExp(`^HTTP/1.1 ${status} `));
  }
});


test('keep-alive clients reconnect without errors beyond 100 requests', async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer(ok));
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  for (let i = 0; i < 205; i++) {
    await new Promise<void>((resolve, reject) => {
      httpRequest({ hostname: '127.0.0.1', port, agent }, res => {
        assert.equal(res.statusCode, 200);
        res.resume(); res.on('end', resolve);
      }).on('error', reject).end();
    });
  }
});

test('trusted proxy clients have independent caps and release their slots on finish or disconnect', async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer((req, res) => {
    if (req.url === '/hold') { req.resume(); req.on('end', () => res.end('ok')); }
    else res.end('ok');
  }, { connectionsPerAddress: 1 }, undefined, {
    proxyHeader: 'x-forwarded-for', trustedProxies: trustedProxyAddresses(['127.0.0.1']),
  }));
  const first = await new RawClient(port).ready();
  first.send(request('/hold', 'X-Forwarded-For: 192.0.2.1\r\nContent-Length: 2\r\n', 'POST') + 'a');
  await normal(port);
  const same = await new RawClient(port).ready();
  assert.match(await same.send(request('/', 'X-Forwarded-For: 192.0.2.1\r\n')).end(), /^HTTP\/1.1 429 /);
  const other = await new RawClient(port).ready();
  assert.match(await other.send(request('/', 'X-Forwarded-For: 192.0.2.2\r\nConnection: close\r\n')).end(), /^HTTP\/1.1 200 /);
  first.send('b');
  await first.until(s => s.includes('ok'));
  // A proxy may reuse one connection for the same or a different visitor.
  first.send(request('/', 'X-Forwarded-For: 192.0.2.1\r\n'));
  await first.until(s => (s.match(/HTTP\/1.1 200/g) ?? []).length === 2);
  first.send(request('/hold', 'X-Forwarded-For: 192.0.2.2\r\nContent-Length: 2\r\n', 'POST') + 'a');
  first.socket.destroy();
  await first.closed;
  await normal(port);
  const again = await new RawClient(port).ready();
  assert.match(await again.send(request('/', 'X-Forwarded-For: 192.0.2.2\r\nConnection: close\r\n')).end(), /^HTTP\/1.1 200 /);
});

for (const raw of [false, true]) test(`the final response overrides explicit ${raw ? 'raw' : 'object'} keep-alive headers`, async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer((_req, res) => {
    res.writeHead(200, raw ? ['Connection', 'keep-alive', 'Content-Length', '2'] : { Connection: 'keep-alive', 'Content-Length': '2' });
    res.end('ok');
  }, { requestsPerSocket: 1 }));
  const c = await new RawClient(port).ready();
  const text = await c.send(request()).end();
  assert.match(text, /Connection: close/i);
  assert.doesNotMatch(text, /keep-alive/i);
  assert.ok(text.endsWith('ok'));
});

for (const trusted of [false, true]) test(`a remote proxy's forwarded address is ${trusted ? 'accepted only in its trusted CIDR' : 'ignored without trust'}`, async t => {
  stubCommands(t);
  const server = createEdgeServer((req, res) => {
    if (req.url !== '/hold') res.end('ok');
  }, { connectionsPerAddress: 1 }, undefined, {
    proxyHeader: 'x-forwarded-for', trustedProxies: trustedProxyAddresses(trusted ? ['192.0.2.0/24'] : []),
  });
  // Emulate a non-loopback peer without opening any socket outside 127.0.0.1.
  server.prependListener('connection', socket => Object.defineProperty(socket, 'remoteAddress', { value: '192.0.2.10', configurable: true }));
  const port = await listen(t, server);
  const first = await new RawClient(port).ready();
  t.after(() => first.socket.destroy());
  first.send(request('/hold', 'X-Forwarded-For: 198.51.100.1\r\n'));
  const second = await new RawClient(port).ready();
  const response = await second.send(request('/', 'X-Forwarded-For: 198.51.100.2\r\nConnection: close\r\n')).end();
  if (trusted) assert.match(response, /^HTTP\/1.1 200 /);
  else assert.equal(response, '', 'spoofed headers cannot evade the direct peer cap');
});

for (const direction of [-1, 1]) test(`body inactivity survives a ${direction < 0 ? 'backward' : 'forward'} wall-clock adjustment`, async t => {
  stubCommands(t);
  const now = Date.now;
  let offset = 0;
  t.mock.method(Date, 'now', () => now() + offset);
  let started!: () => void;
  const received = new Promise<void>(resolve => { started = resolve; });
  const port = await listen(t, createEdgeServer((req, res) => {
    req.resume(); req.once('end', () => res.end('ok')); started();
  }, { bodyMs: 300, checkMs: 10 }));
  const c = await new RawClient(port).ready();
  c.send(request('/', 'Content-Length: 6\r\nConnection: close\r\n', 'POST') + 'a');
  await received;
  offset = direction * 3600_000;
  if (direction > 0) {
    for (let i = 0; i < 5; i++) { await sleep(60); c.send('b'); }
    assert.match(await c.end(), /^HTTP\/1.1 200 /, 'a clock jump cannot expire a progressing upload');
  } else {
    assert.match(await c.end(), /^HTTP\/1.1 408 /, 'turning the clock back cannot postpone an idle deadline');
  }
});

for (const [name, firstIP, sameIP, otherIP] of [
  ['IPv6 /64', '2001:db8::1', '2001:0DB8:0000:0000:ffff::1', '2001:db8:0:1::1'],
  ['mapped IPv4', '203.0.113.9', '::ffff:cb00:7109', '203.0.113.10'],
  ['malformed fallback', 'bad', 'unknown', '203.0.113.9'],
]) test(`edge limits share ${name} buckets and release on completion`, async t => {
  stubCommands(t);
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const port = await listen(t, createEdgeServer((req, res) => {
    if (req.url === '/hold') { release = () => res.end('ok'); started(); }
    else res.end('ok');
  }, { connectionsPerAddress: 1 }, undefined, {
    proxyHeader: 'x-forwarded-for', trustedProxies: trustedProxyAddresses(['127.0.0.1']),
  }));
  const first = await new RawClient(port).ready();
  first.send(request('/hold', `X-Forwarded-For: ${firstIP}\r\n`));
  await ready;
  const call = async (ip: string) => {
    const c = await new RawClient(port).ready();
    return c.send(request('/', `X-Forwarded-For: ${ip}\r\nConnection: close\r\n`)).end();
  };
  assert.match(await call(sameIP), /^HTTP\/1\.1 429 /);
  assert.match(await call(otherIP), /^HTTP\/1\.1 200 /);
  release(); await first.until(text => text.includes('ok'));
  assert.match(await call(sameIP), /^HTTP\/1\.1 200 /);
});

test('direct IPv6 peers use the same /64 edge bucket as trusted headers', async t => {
  stubCommands(t);
  let peer = 'fe80::1%en0';
  const server = createEdgeServer(ok, { connectionsPerAddress: 1 });
  server.prependListener('connection', socket => Object.defineProperty(socket, 'remoteAddress', { value: peer, configurable: true }));
  const port = await listen(t, server);
  const first = await new RawClient(port).ready();
  first.send(request()); await first.until(text => text.includes('ok'));
  peer = 'fe80:0000:0000:0000:ffff::1%en0';
  const second = await new RawClient(port).ready();
  assert.equal(await second.end(), '');
  peer = 'fe80:0:0:1::1%en0';
  await normal(port);
});
