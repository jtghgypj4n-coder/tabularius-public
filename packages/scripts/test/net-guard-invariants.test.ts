// Synthetic local traffic only; DNS answers are supplied in memory. One test starts a child Node process (this checkout's own scripts, no commands) so proxy variables exist at startup.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';
import { getEventListeners } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { NAME_LOOKUP, OutboundRefused, addressRefusal, classifyAddress, guardedFetch, guardedLookup, hostRefusal, networkProblem, outboundContext, parseAllowList } from '../src/net-guard.ts';

const PRIVATE = { policy: { private: true }, timeoutMs: 5000 };
async function local(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { server, port: (server.address() as AddressInfo).port, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
async function until(predicate: () => boolean) {
  const end = performance.now() + 3000;
  while (!predicate()) { assert.ok(performance.now() < end, 'local traffic progressed'); await sleep(5); }
}
function lookup(t: TestContext, implementation: typeof NAME_LOOKUP.lookup) { t.mock.method(NAME_LOOKUP, 'lookup', implementation); }

// Exercise the socket lookup as well as URL parsing: Node's URL parser alone is not sufficient for DNS answers.
test('zones and site/link-local scoped IPv6 are refused under every policy, including DNS answers', async (t) => {
  for (const address of ['::1%lo0', 'fd12::1%eth0', '2001:db8::1%2', 'fe80::1%25eth0', 'fec0::1', 'fe80::1', 'ff02::1']) {
    assert.equal(classifyAddress(address), 'never');
    for (const policy of [{}, { private: true }, { private: ['scoped.test', '::/0'] }]) {
      assert.ok(addressRefusal(policy, 'scoped.test', address));
      assert.ok(hostRefusal(policy, address));
    }
    if (address.includes('%')) assert.throws(() => parseAllowList([address]));
  }
  let hits = 0;
  const { port } = await local(t, (_req, res) => { hits++; res.end('unexpected'); });
  lookup(t, async () => [{ address: '127.0.0.1' }, { address: '2001:db8::1%lo0', family: 6 }]);
  await assert.rejects(guardedFetch(`http://scoped.test:${port}`, {}, PRIVATE), OutboundRefused);
  for (const host of ['[::1%lo0]', '[::1%25lo0]']) await assert.rejects(guardedFetch(`http://${host}:${port}`, {}, PRIVATE), OutboundRefused);
  assert.equal(hits, 0);
});

test('refusals, resolver and connection failures do not expose internal addresses in messages or causes', async (t) => {
  for (const address of ['10.23.45.67', 'fd12:3456::7', '0.0.0.0', 'fec0::1', '::1%lo0']) {
    const message = addressRefusal({}, 'private-name.test', address)!;
    assert.ok(message);
    assert.ok(!message.includes(address));
    assert.ok(!message.includes('private-name.test'));
  }
  lookup(t, async () => { throw Object.assign(new Error('resolver at 10.23.45.67 failed for private-name.test'), { code: 'EOTHER' }); });
  const error = await guardedFetch('http://private-name.test').catch((e: unknown) => e);
  assert.ok(error instanceof TypeError);
  assert.doesNotMatch(String(error) + String(error.cause) + networkProblem(error), /10\.23\.45\.67|private-name/);
  assert.equal((error.cause as NodeJS.ErrnoException).code, 'EOTHER');
  const denied = await guardedFetch('http://127.0.0.1:0', {}, PRIVATE).catch((e: unknown) => e);
  assert.ok(denied instanceof TypeError);
  assert.doesNotMatch(String(denied) + String(denied.cause) + networkProblem(denied), /127\.0\.0\.1/);
  const raw = new TypeError('fetch failed', { cause: new Error('unrecognised failure at fd12:3456::7') });
  assert.equal(networkProblem(raw), 'the server could not be reached');
});

test('happy-eyeballs uses only the checked A/AAAA snapshot and rechecks a changed answer on the next hop', async (t) => {
  let hits = 0;
  const { port } = await local(t, (_req, res) => { hits++; res.end('checked'); });
  let calls = 0;
  lookup(t, async () => {
    calls++;
    // IPv6 loopback has no listener; Node falls back to the checked IPv4 answer.
    return calls === 1 ? [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }] : [{ address: '169.254.169.254', family: 4 }];
  });
  assert.equal(await (await guardedFetch(`http://dual.test:${port}`, {}, PRIVATE)).text(), 'checked');
  assert.equal(calls, 1);
  await assert.rejects(guardedFetch(`http://dual.test:${port}`, {}, PRIVATE), /link-local/);
  assert.equal(calls, 2);
  assert.equal(hits, 1);
});

test('mixed DNS answers are all checked before family selection or any connection', async (t) => {
  let hits = 0;
  const { port } = await local(t, (_req, res) => { hits++; res.end(); });
  for (const addresses of [['127.0.0.1', 'fe80::1'], ['::1', '169.254.169.254'], ['fd12::1', '127.0.0.1']]) {
    lookup(t, async () => addresses.map((address) => ({ address })));
    const policy = addresses[0] === 'fd12::1' ? { private: ['127.0.0.1'] } : { private: true };
    await assert.rejects(guardedFetch(`http://mixed.test:${port}`, {}, { ...PRIVATE, policy }), OutboundRefused);
    const error = await new Promise<unknown>((resolve) => guardedLookup(policy)('mixed.test', { family: 4 }, (e) => resolve(e)));
    assert.ok(error instanceof OutboundRefused);
  }
  assert.equal(hits, 0);
});

test('HTTP sockets, cookies and auth are not reused across accounts or files', async (t) => {
  const seen: { socket: Socket; auth?: string; cookie?: string }[] = [];
  const { base } = await local(t, (req, res) => {
    seen.push({ socket: req.socket, auth: req.headers.authorization, cookie: req.headers.cookie });
    res.setHeader('set-cookie', 'session=server-secret');
    res.end('ok');
  });
  const identities = [{ file: 'one', account: 'a' }, { file: 'one', account: 'b' }, { file: 'two', account: 'a' }, { file: 'one', account: 'a' }];
  for (const [i, identity] of identities.entries()) await outboundContext.run(identity, async () => {
    assert.equal(await (await guardedFetch(base, i === 0 ? { headers: { authorization: 'Bearer first', cookie: 'sent=first' } } : {}, PRIVATE)).text(), 'ok');
  });
  assert.equal(new Set(seen.map((r) => r.socket)).size, identities.length);
  assert.deepEqual(seen.map(({ auth, cookie }) => ({ auth, cookie })), [
    { auth: 'Bearer first', cookie: 'sent=first' }, ...identities.slice(1).map(() => ({ auth: undefined, cookie: undefined })),
  ]);
});

test('proxy environment variables present at startup never divert a guarded HTTP request', async (t) => {
  // Node reads NODE_USE_ENV_PROXY and HTTP_PROXY when it starts, so the child process gets them at launch. Its control
  // request, made with the stock http module, must reach the proxy; otherwise this test could pass without proving anything.
  const seen: string[] = [];
  const proxy = await local(t, (req, res) => { seen.push(req.url ?? ''); res.end('proxy'); });
  const guard = fileURLToPath(new URL('../src/net-guard.ts', import.meta.url));
  const script = `
    import { createServer, get } from 'node:http';
    import { guardedFetch } from ${JSON.stringify(guard)};
    const target = createServer((_q, r) => r.end('direct'));
    const port = await new Promise((r) => target.listen(0, '127.0.0.1', () => r(target.address().port)));
    await new Promise((r) => get('http://127.0.0.1:' + port + '/control', (res) => { res.resume(); res.on('end', r); }));
    const body = await (await guardedFetch('http://127.0.0.1:' + port + '/guarded', {}, { policy: { private: true }, timeoutMs: 5000 })).text();
    console.log(JSON.stringify({ body }));
    process.exit(0);
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH ?? '', NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxy.base, http_proxy: proxy.base, NO_PROXY: '' }, timeout: 20_000,
  });
  assert.equal(JSON.parse(stdout.trim().split('\n').pop()!).body, 'direct');
  assert.ok(seen.some((url) => url.endsWith('/control')), 'the control request used the proxy');
  assert.ok(!seen.some((url) => url.endsWith('/guarded')), 'the guarded request did not');
});

test('redirects recheck changed DNS, credentials and unusual Location values without leaking addresses', async (t) => {
  let location = '';
  let hits = 0;
  const { base, port } = await local(t, (req, res) => {
    hits++;
    if (req.url === '/final') return res.end('ok');
    res.writeHead(302, { location }); res.end();
  });
  for (const value of ['http://user:secret@127.0.0.1/', '//user:secret@127.0.0.1/', 'http://[fd12::secret', 'http://[::1%25lo0]/', '//169.254.169.254/secret', 'http:\\\\169.254.169.254\\secret', 'file:///secret']) {
    location = value;
    const before = hits;
    const error = await guardedFetch(base, {}, PRIVATE).catch((e: unknown) => e);
    assert.ok(error instanceof OutboundRefused, value);
    assert.doesNotMatch(error.message, /secret|169\.254\.169\.254|fd12|127\.0\.0\.1/);
    assert.equal(hits, before + 1, 'no redirect target reached');
  }
  for (const value of ['/final', './final', `//127.0.0.1:${port}/final`]) {
    location = value;
    assert.equal(await (await guardedFetch(base, {}, PRIVATE)).text(), 'ok');
  }
  let calls = 0;
  lookup(t, async () => [{ address: ++calls === 1 ? '127.0.0.1' : '169.254.169.254' }]);
  location = '/final';
  await assert.rejects(guardedFetch(`http://changing.test:${port}`, {}, PRIVATE), /link-local/);
  assert.equal(calls, 2, 'even same-origin redirects must resolve and check again');
});

for (const status of [301, 302, 303, 307, 308]) test(`${status} strips credentials on a cross-origin redirect`, async (t) => {
  let seen: IncomingMessage['headers'] | undefined;
  const target = await local(t, (req, res) => { seen = req.headers; res.end('ok'); });
  const first = await local(t, (_req, res) => { res.writeHead(status, { location: target.base }); res.end(); });
  assert.equal(await (await guardedFetch(first.base, { headers: { authorization: 'Bearer secret', cookie: 'secret=1', 'proxy-authorization': 'secret', 'x-token': 'secret' } }, PRIVATE)).text(), 'ok');
  for (const key of ['authorization', 'cookie', 'proxy-authorization', 'x-token']) assert.equal(seen?.[key], undefined);
});

for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]] as const) test(`${encoding} size cap counts decoded bytes and leaves account capacity clean after corrupt or oversized bodies`, async (t) => {
  const compressed = compress(Buffer.alloc(64 * 1024, 65));
  assert.ok(compressed.length < 1024);
  const { base } = await local(t, (req, res) => {
    if (req.url === '/ok') return res.end('ok');
    const body = req.url === '/bad' ? Buffer.from('invalid compressed body') : compressed;
    res.writeHead(200, { 'content-encoding': encoding, 'content-length': body.length }); res.end(body);
  });
  const caller = new AbortController();
  await outboundContext.run({ file: 'compression', account: encoding }, async () => {
    for (let i = 0; i < 6; i++) for (const path of ['/large', '/bad']) {
      const response = await guardedFetch(base + path, { signal: caller.signal }, { ...PRIVATE, maxBytes: 1024 });
      await assert.rejects(response.arrayBuffer(), path === '/large' ? /larger than/ : /./);
    }
    assert.equal(await (await guardedFetch(base + '/ok', {}, PRIVATE)).text(), 'ok');
  });
  await until(() => getEventListeners(caller.signal, 'abort').length === 0);
});

test('partial headers hit the total deadline and release sockets and account capacity', async (t) => {
  const sockets = new Set<Socket>();
  const server = createTcpServer((socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.on('data', () => socket.write('HTTP/1.1 200 OK\r\nX-Slow: '));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const caller = new AbortController();
  const started = performance.now();
  await outboundContext.run({ file: 'headers', account: 'a' }, async () => {
    for (let i = 0; i < 6; i++) await assert.rejects(guardedFetch(base, { signal: caller.signal }, { ...PRIVATE, timeoutMs: 50 }), { name: 'TimeoutError' });
  });
  await until(() => sockets.size === 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  assert.ok(performance.now() - started < 3000, 'tenfold allowance for the combined deadlines');
});

test('many distinct hosts share bounded file/account admission and cancellation leaves capacity for reuse', async (t) => {
  let active = 0;
  let maximum = 0;
  let hits = 0;
  const { port } = await local(t, (req, res) => {
    hits++; active++; maximum = Math.max(maximum, active);
    res.once('close', () => active--);
    if (req.url === '/fast') res.end('ok'); else res.write('held');
  });
  let lookups = 0;
  lookup(t, async () => { lookups++; return [{ address: '127.0.0.1' }]; });
  const stop = new AbortController();
  t.after(() => stop.abort());
  const pending = Array.from({ length: 80 }, (_, i) => outboundContext.run({ file: 'many-hosts', account: `a${i % 2}`, stop: stop.signal }, async () => {
    const response = await guardedFetch(`http://host-${i}.test:${port}/held`, {}, PRIVATE);
    return response.text();
  }));
  const completed = Promise.allSettled(pending);
  await until(() => hits === 8);
  assert.equal(lookups, 8, 'waiting hosts do not start DNS or connections');
  stop.abort(new Error('cancel all'));
  assert.ok((await completed).every((r) => r.status === 'rejected'));
  await until(() => active === 0);
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  const later = Array.from({ length: 16 }, (_, i) => outboundContext.run({ file: 'many-hosts', account: `a${i % 2}` }, async () =>
    (await guardedFetch(`http://next-${i}.test:${port}/fast`, {}, PRIVATE)).text()));
  assert.deepEqual(await Promise.all(later), Array(16).fill('ok'));
  assert.ok(maximum <= 8);
  assert.equal(hits, 24, 'cancelled waiting hosts never connect');
});

test('bodyless 205 responses close immediately instead of draining uncapped payloads', async (t) => {
  let closed = 0;
  const { base } = await local(t, (req, res) => {
    if (req.url === '/ok') return res.end('ok');
    res.writeHead(205, req.url === '/gzip' ? { 'content-encoding': 'gzip' } : {});
    res.write(req.url === '/gzip' ? gzipSync(Buffer.alloc(64 * 1024)) : Buffer.alloc(64 * 1024));
    // Never end: without closing bodyless responses, every account slot remains held until the deadline.
    res.once('close', () => closed++);
  });
  const caller = new AbortController();
  await outboundContext.run({ file: 'bodyless', account: 'a' }, async () => {
    for (let i = 0; i < 6; i++) {
      const response = await guardedFetch(base + (i % 2 ? '/gzip' : '/plain'), { signal: caller.signal }, { ...PRIVATE, timeoutMs: 10_000, maxBytes: 8 });
      assert.equal(response.status, 205);
      assert.equal(await response.text(), '');
      await until(() => closed === i + 1);
      assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
    }
    assert.equal(await (await guardedFetch(base + '/ok', {}, PRIVATE)).text(), 'ok');
  });
});

test('a stalled upload producer is cancelled by deadline, caller and run stop before admission', async (t) => {
  let hits = 0;
  const { base } = await local(t, (_req, res) => { hits++; res.end('ok'); });
  for (const mode of ['deadline', 'caller', 'stop'] as const) {
    let cancelled = false;
    const upload = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); }, // Even an uncooperative cancel cannot hold up abort.
    });
    const caller = new AbortController();
    const stop = new AbortController();
    const request = new Request(base, { method: 'POST', body: upload, duplex: 'half' } as RequestInit);
    const pending = outboundContext.run({ file: 'upload', account: 'a', stop: stop.signal }, () =>
      guardedFetch(request, { signal: caller.signal }, { ...PRIVATE, timeoutMs: mode === 'deadline' ? 50 : 10_000 }));
    const rejected = assert.rejects(pending, mode === 'deadline' ? { name: 'TimeoutError' } : /cancel upload/);
    await sleep(0); // Start reading the first chunk, then stall on the next read.
    if (mode === 'caller') caller.abort(new Error('cancel upload'));
    if (mode === 'stop') stop.abort(new Error('cancel upload'));
    // Bound the regression itself, including a producer whose cancel promise never settles.
    const watchdog = new AbortController();
    try {
      await Promise.race([rejected, sleep(1500, undefined, { signal: watchdog.signal }).then(() => assert.fail('upload ignored cancellation'))]);
    } finally { watchdog.abort(); }
    assert.equal(cancelled, true);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
    assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  }
  assert.equal(hits, 0);
  await outboundContext.run({ file: 'upload', account: 'a' }, async () => {
    assert.equal(await (await guardedFetch(base, {}, PRIVATE)).text(), 'ok');
  });
});

test('unsolicited 101 upgrades fail promptly and release account slots and signal listeners', async (t) => {
  const { base } = await local(t, (req, res) => {
    if (req.url === '/ok') return res.end('ok');
    res.writeHead(101, { connection: 'Upgrade', upgrade: 'websocket' }); res.end();
  });
  const caller = new AbortController();
  await outboundContext.run({ file: 'upgrade', account: 'a' }, async () => {
    for (let i = 0; i < 6; i++) {
      const pending = guardedFetch(base, { signal: caller.signal }, { ...PRIVATE, timeoutMs: 2000 });
      const rejected = assert.rejects(pending, /protocol upgrade/i);
      const watchdog = new AbortController();
      try {
        await Promise.race([rejected, sleep(1500, undefined, { signal: watchdog.signal }).then(() => assert.fail('101 stranded a request'))]);
      } finally { watchdog.abort(); }
      assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
    }
    assert.equal(await (await guardedFetch(base + '/ok', {}, PRIVATE)).text(), 'ok');
  });
});

test('bodyless responses that still name a content coding are not decoded', async (t) => {
  // HEAD, 204 and 304 carry headers only; a gzip decoder fed nothing would raise an unhandled stream error and end the process.
  const { base } = await local(t, (req, res) => {
    res.writeHead(req.url === '/304' ? 304 : req.url === '/204' ? 204 : 200, { 'content-encoding': 'gzip' });
    res.end();
  });
  for (const [path, method] of [['/304', 'GET'], ['/204', 'GET'], ['/head', 'HEAD']] as const) {
    const response = await guardedFetch(`${base}${path}`, { method }, PRIVATE);
    assert.equal(await response.text(), '', `${method} ${path}`);
  }
});

test('IPv6 forms that carry an IPv4 address are classified by that address', () => {
  for (const [address, expected] of [
    ['::ffff:0:7f00:1', 'own'], ['::ffff:0:a9fe:a9fe', 'never'], ['::ffff:0:808:808', 'public'], ['::ffff:0:a00:1', 'own'],
    ['64:ff9b:1:a9fe:a9:fe00::', 'never'], ['64:ff9b:1:808:8:800::', 'own'], ['64:ff9b::808:808', 'public'], ['64:ff9b::a9fe:a9fe', 'never'],
  ] as const) assert.equal(classifyAddress(address), expected, address);
});
