// The outbound guard: how addresses are classified, what a policy allows, and that a request is made to the address that
// was checked. The servers are on loopback, so most tests say `private: true`; the strict ones prove the refusal.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { NAME_LOOKUP, OutboundRefused, addressRefusal, classifyAddress, guardedFetch, guardedLookup, hostRefusal, isInternalHost, parseAllowList, type AddressClass } from '../src/net-guard.ts';

async function listen(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ port: number; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { port: (server.address() as AddressInfo).port, server };
}

/** Name lookups answered from a table for this test, and counted. */
function names(t: TestContext, table: Record<string, string[] | (() => string[])>): { asked: string[] } {
  const before = NAME_LOOKUP.lookup;
  const asked: string[] = [];
  NAME_LOOKUP.lookup = async (host) => {
    asked.push(host);
    const answer = table[host];
    if (!answer) throw Object.assign(new Error(`${host} not found`), { code: 'ENOTFOUND' });
    return (typeof answer === 'function' ? answer() : answer).map((address) => ({ address }));
  };
  t.after(() => { NAME_LOOKUP.lookup = before; });
  return { asked };
}

const PRIVATE = { policy: { private: true } } as const;

test('addresses are classified: never (link-local, metadata, unspecified, multicast), own network, public; every spelling of the same address agrees', () => {
  const table: [AddressClass, string[]][] = [
    ['never', ['169.254.169.254', '169.254.0.1', '0.0.0.0', '0.1.2.3', '100.100.100.200', '168.63.129.16', '224.0.0.1', '239.255.255.250', '255.255.255.255', '240.0.0.1',
      '::', 'fe80::1', 'febf::1', '[fe80::1]', 'fe80::1%eth0', 'fec0::1', 'fd00:ec2::254', 'fd20:ce::254', 'ff02::1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::1', '::169.254.169.254', 'not an address']],
    ['own', ['127.0.0.1', '127.255.255.254', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.10', '100.64.0.1', '100.127.255.255', '192.0.0.8', '198.18.0.1',
      '::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3', '64:ff9b::7f00:1', '64:ff9b:1::1', '2002:7f00:1::', '::127.0.0.1', '0:0:0:0:0:ffff:7f00:1']],
    ['public', ['8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '192.0.2.1', '2606:4700::1111', '2001:db8::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::']],
  ];
  for (const [kind, addresses] of table) for (const a of addresses) assert.equal(classifyAddress(a), kind, `${a} is ${kind}`);
});

test('isInternalHost: link-local and metadata names and addresses, nothing on the machine\'s own network', () => {
  for (const h of ['169.254.169.254', '[fe80::1]', '0.0.0.0', '::', 'metadata.google.internal', 'METADATA.', 'instance-data', '100.100.100.200', '::ffff:a9fe:a9fe', 'fd00:ec2::254', 'fd20:ce::254']) assert.equal(isInternalHost(h), true, h);
  for (const h of ['example.com', '93.184.216.34', '127.0.0.1', 'localhost', '10.0.0.5', '192.168.1.10', '2606:4700::1111']) assert.equal(isInternalHost(h), false, h);
});

test('the URL parser reads odd spellings of an address as the address, and the guard judges that', () => {
  for (const [spelling, kind] of [
    ['http://0x7f.1/', 'own'], ['http://2130706433/', 'own'], ['http://017700000001/', 'own'], ['http://127.1/', 'own'], ['http://0/', 'never'],
    ['http://[::ffff:127.0.0.1]/', 'own'], ['http://[::ffff:7f00:1]/', 'own'], ['http://[0:0:0:0:0:ffff:7f00:1]/', 'own'], ['http://[::1]/', 'own'],
    ['http://2852039166/', 'never'], ['http://0xa9fea9fe/', 'never'], ['http://025177524776/', 'never'], ['http://[::ffff:169.254.169.254]/', 'never'], ['http://[::ffff:a9fe:a9fe]/', 'never'],
  ] as const) {
    const host = new URL(spelling).hostname;
    assert.equal(classifyAddress(host), kind, `${spelling} is ${host}`);
    const strict = hostRefusal({}, host);
    assert.ok(strict, `${spelling}: refused when strict`);
    assert.equal(hostRefusal({ private: true }, host) === undefined, kind === 'own', `${spelling}: a policy that allows the own network ${kind === 'own' ? 'allows' : 'still refuses'} it`);
  }
});

test('an allow list names hosts, wildcards, addresses and ranges; a bad entry is an error; a never address is not allowed by any list', () => {
  const list = parseAllowList(['intranet.example', '*.corp.example', '10.1.2.3', '10.8.0.0/16', 'fd00:abcd::/32', '[::1]', ' ']);
  assert.equal(list.length, 6);
  const may = (host: string, address: string) => addressRefusal({ private: ['intranet.example', '*.corp.example', '10.1.2.3', '10.8.0.0/16', 'fd00:abcd::/32', '::1'] }, host, address) === undefined;
  assert.ok(may('intranet.example', '10.99.0.1'), 'a listed name is allowed at whatever own-network address it has');
  assert.ok(may('Intranet.Example.', '192.168.0.9'), 'case and a trailing dot do not matter');
  assert.ok(may('erp.corp.example', '172.20.0.1'));
  assert.ok(!may('corp.example', '172.20.0.1'), '*.corp.example is not corp.example');
  assert.ok(!may('evilcorp.example', '172.20.0.1'));
  assert.ok(may('10.1.2.3', '10.1.2.3'));
  assert.ok(!may('10.1.2.4', '10.1.2.4'));
  assert.ok(may('10.8.200.1', '10.8.200.1'));
  assert.ok(!may('10.9.0.1', '10.9.0.1'));
  assert.ok(may('[fd00:abcd:1::5]', 'fd00:abcd:1::5'));
  assert.ok(may('::1', '::1'));
  assert.ok(!may('localhost', '127.0.0.1'), 'nothing listed names loopback');
  assert.equal(addressRefusal({ private: ['metadata.google.internal', '169.254.0.0/16', '*.internal'] }, 'metadata.google.internal', '169.254.169.254')?.includes('link-local'), true, 'a list cannot allow the metadata range');
  assert.equal(addressRefusal({ private: ['0.0.0.0/0'] }, 'x.example', '169.254.169.254')?.includes('link-local'), true);
  assert.match(addressRefusal({ private: ['10.0.0.0/8'] }, 'x.example', '127.0.0.1') ?? '', /own network/);
  for (const bad of ['10.0.0.0/33', 'http://a.example', 'a b', '10.0.0.0/8/1', '*', 'fd00::/129', '10.1', '10', '1.2.3.', '//x']) assert.throws(() => parseAllowList([bad]), /not a host name, address or range|range length/, bad);
});

test('a request to loopback is refused unless the policy allows it, and then goes through', async (t) => {
  let hits = 0;
  const { port } = await listen(t, (_req, res) => { hits++; res.end('hello'); });
  await assert.rejects(guardedFetch(`http://127.0.0.1:${port}/`), (e) => e instanceof OutboundRefused && /own network/.test(e.message));
  await assert.rejects(guardedFetch(`http://localhost:${port}/`), (e) => e instanceof OutboundRefused && /own network/.test(e.message), 'the name localhost is judged by what it resolves to');
  await assert.rejects(guardedFetch(`http://2130706433:${port}/`), OutboundRefused);
  await assert.rejects(guardedFetch(`http://[::ffff:7f00:1]:${port}/`), OutboundRefused);
  assert.equal(hits, 0, 'nothing reached the server');
  const listed = await guardedFetch(`http://127.0.0.1:${port}/`, {}, { policy: { private: ['127.0.0.0/8'] } });
  assert.equal(await listed.text(), 'hello');
  const allowed = await guardedFetch(`http://127.0.0.1:${port}/`, {}, PRIVATE);
  assert.equal(allowed.status, 200);
  assert.equal(hits, 2);
});

test('a name is resolved once and the connection goes to the address that was checked, so a changing answer cannot redirect it', async (t) => {
  let hits = 0;
  const { port } = await listen(t, (_req, res) => { hits++; res.end('ok'); });
  let asks = 0;
  const seen = names(t, { 'rebind.test': () => (asks++ === 0 ? ['127.0.0.1'] : ['169.254.169.254']) });
  const r = await guardedFetch(`http://rebind.test:${port}/`, {}, PRIVATE);
  assert.equal(await r.text(), 'ok');
  assert.deepEqual(seen.asked, ['rebind.test'], 'one lookup, used for both the check and the connection');
  assert.equal(hits, 1);
});

test('a name with any link-local answer, or with an own-network one under a strict policy, is refused without a connection', async (t) => {
  let hits = 0;
  const { port } = await listen(t, (_req, res) => { hits++; res.end('no'); });
  names(t, { 'mixed.test': ['127.0.0.1', '169.254.169.254'], 'inside.test': ['127.0.0.1'], 'v6.test': ['::ffff:a9fe:a9fe'], 'alias.test': ['169.254.169.254'], 'plain.test': ['8.8.8.8'] });
  await assert.rejects(guardedFetch(`http://mixed.test:${port}/`, {}, PRIVATE), (e) => e instanceof OutboundRefused && /link-local/.test(e.message));
  await assert.rejects(guardedFetch(`http://v6.test:${port}/`, {}, PRIVATE), /link-local/);
  await assert.rejects(guardedFetch(`http://alias.test:${port}/`, {}, { policy: { private: ['alias.test', '169.254.0.0/16'] } }), /link-local/);
  await assert.rejects(guardedFetch(`http://inside.test:${port}/`), (e) => e instanceof OutboundRefused && /own network/.test(e.message) && !/inside\.test|127\.0\.0\.1/.test(e.message));
  await assert.rejects(guardedFetch(`http://metadata.google.internal/computeMetadata/v1/`, {}, PRIVATE), /link-local/);
  await assert.rejects(guardedFetch('http://169.254.169.254/latest/meta-data/', {}, PRIVATE), /link-local/);
  await assert.rejects(guardedFetch('http://[fd00:ec2::254]/latest/meta-data/', {}, PRIVATE), /link-local/);
  assert.equal(hits, 0);
});

test('guardedLookup hands back only checked addresses, in the shape the socket asked for', async (t) => {
  names(t, { 'two.test': ['93.184.216.34', '2606:4700::1111'], 'bad.test': ['93.184.216.34', '10.0.0.1'] });
  const look = (host: string, opts: object, policy = {}) => new Promise<{ error?: Error; result?: unknown; family?: number }>((resolve) => guardedLookup(policy)(host, opts, (error, result, family) => resolve({ ...(error ? { error } : {}), result, family })));
  assert.deepEqual((await look('two.test', { all: true })).result, [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 }]);
  assert.deepEqual(await look('two.test', { family: 6 }), { result: '2606:4700::1111', family: 6 });
  assert.match((await look('bad.test', { all: true })).error?.message ?? '', /own network/);
  assert.equal((await look('bad.test', { all: true }, { private: true })).error, undefined);
  assert.equal(((await look('missing.test', {})).error as NodeJS.ErrnoException)?.code, 'ENOTFOUND');
  assert.match((await look('10.0.0.1', {})).error?.message ?? '', /own network/);
});

test('a redirect is followed by hand, each hop checked: to a link-local address it is refused, and the first hop is not repeated', async (t) => {
  const { port } = await listen(t, (req, res) => {
    if (req.url === '/to-metadata') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
    if (req.url === '/to-other-name') { res.writeHead(302, { location: `http://second.test:${port}/final` }); return res.end(); }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
    if (req.url === '/to-final') { res.writeHead(302, { location: '/final' }); return res.end(); }
    res.end('final');
  });
  const base = `http://127.0.0.1:${port}`;
  await assert.rejects(guardedFetch(`${base}/to-metadata`, {}, PRIVATE), (e) => e instanceof OutboundRefused && /link-local/.test(e.message));
  assert.equal(await (await guardedFetch(`${base}/to-final`, {}, PRIVATE)).text(), 'final');
  const hop = await guardedFetch(`${base}/to-final`, { redirect: 'manual' }, PRIVATE);
  assert.equal(hop.status, 302, 'manual returns the redirect itself');
  assert.equal(hop.headers.get('location'), '/final');
  names(t, { 'first.test': ['127.0.0.1'], 'second.test': ['127.0.0.1'] });
  const listedByName = { policy: { private: ['first.test'] } };
  await assert.rejects(guardedFetch(`http://first.test:${port}/to-other-name`, {}, listedByName), /own network/, 'a hop to a name the policy does not list is refused');
  assert.equal(await (await guardedFetch(`http://first.test:${port}/to-final`, {}, listedByName)).text(), 'final', 'the listed name is allowed on every hop');
  await assert.rejects(guardedFetch(`${base}/loop`, {}, PRIVATE), /fetch failed/);
  await assert.rejects(guardedFetch(`${base}/to-final`, { redirect: 'error' }, PRIVATE), /fetch failed/);
});

test('a redirect to another origin carries no credentials, and a POST turned into a GET sends no body', async (t) => {
  const seen: Record<string, { headers: IncomingMessage['headers']; method?: string; body: string }> = {};
  const record = (name: string) => (req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { seen[name] = { headers: req.headers, method: req.method, body }; res.end('done'); });
  };
  const target = await listen(t, record('target'));
  const first = await listen(t, (req, res) => {
    if (req.url === '/same') { res.writeHead(307, { location: '/landing' }); return res.end(); }
    if (req.url === '/landing') return record('same')(req, res);
    res.writeHead(302, { location: `http://127.0.0.1:${target.port}/landing` });
    res.end();
  });
  const headers = { authorization: 'Bearer secret', cookie: 'sid=1', 'x-api-key': 'key', 'proxy-authorization': 'Basic abc', accept: 'application/json', 'content-type': 'text/plain' };
  await (await guardedFetch(`http://127.0.0.1:${first.port}/other`, { method: 'POST', headers, body: 'payload' }, PRIVATE)).text();
  assert.equal(seen.target.method, 'GET', '302 on a POST is followed with GET');
  assert.equal(seen.target.body, '');
  for (const h of ['authorization', 'cookie', 'x-api-key', 'proxy-authorization']) assert.equal(seen.target.headers[h], undefined, `${h} is not sent to another origin`);
  assert.equal(seen.target.headers.accept, 'application/json');
  // The same origin keeps its headers, and a 307 keeps the method and the body.
  await (await guardedFetch(`http://127.0.0.1:${first.port}/same`, { method: 'POST', headers, body: 'payload' }, PRIVATE)).text();
  assert.equal(seen.same.method, 'POST');
  assert.equal(seen.same.body, 'payload');
  assert.equal(seen.same.headers.authorization, 'Bearer secret');
  assert.equal(seen.same.headers['x-api-key'], 'key');
});

test('an address with credentials in it, or that is not http or https, is refused, and the refusal does not print the password', async () => {
  for (const url of ['http://user:hunter2@127.0.0.1:9/', 'http://good.example@169.254.169.254/']) {
    const e = await guardedFetch(url, {}, PRIVATE).catch((x: unknown) => x);
    assert.ok(e instanceof OutboundRefused, url);
    assert.match(e.message, /credentials/);
    assert.doesNotMatch(e.message, /hunter2|good\.example/);
  }
  await assert.rejects(guardedFetch('ftp://example.com/file', {}, PRIVATE), /http and https only/);
  await assert.rejects(guardedFetch('file:///etc/passwd', {}, PRIVATE), /http and https only/);
});

test('a response too large is stopped, whether it says so first or not, and a decompressed one is counted as it grows', async (t) => {
  const { port } = await listen(t, (req, res) => {
    if (req.url === '/declared') { res.writeHead(200, { 'content-length': String(50 * 1024 * 1024) }); return res.end(Buffer.alloc(1024)); }
    if (req.url === '/endless') {
      res.writeHead(200);
      const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024, 97)), 1);
      res.on('close', () => clearInterval(timer));
      return;
    }
    if (req.url === '/bomb') { res.writeHead(200, { 'content-encoding': 'gzip' }); return res.end(gzipSync(Buffer.alloc(8 * 1024 * 1024, 48))); }
    res.end('small');
  });
  const base = `http://127.0.0.1:${port}`;
  await assert.rejects(guardedFetch(`${base}/declared`, {}, { ...PRIVATE, maxBytes: 1024 * 1024 }), (e) => e instanceof OutboundRefused && /larger than/.test(e.message));
  const endless = await guardedFetch(`${base}/endless`, {}, { ...PRIVATE, maxBytes: 512 * 1024 });
  await assert.rejects(endless.arrayBuffer(), /larger than|aborted|terminated/);
  const bomb = await guardedFetch(`${base}/bomb`, {}, { ...PRIVATE, maxBytes: 1024 * 1024 });
  await assert.rejects(bomb.arrayBuffer(), /larger than|aborted|terminated/);
  assert.equal(await (await guardedFetch(`${base}/small`, {}, { ...PRIVATE, maxBytes: 1024 })).text(), 'small');
});

test('a slow server is cut off at the time limit, whether it is slow to answer or slow to finish', async (t) => {
  const { port } = await listen(t, (req, res) => {
    if (req.url === '/silent') return; // never answers
    res.writeHead(200);
    res.write('a');
    const timer = setInterval(() => res.write('b'), 50);
    res.on('close', () => clearInterval(timer));
  });
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  await assert.rejects(guardedFetch(`${base}/silent`, {}, { ...PRIVATE, timeoutMs: 200 }), (e) => (e as Error).name === 'TimeoutError');
  const dripping = await guardedFetch(`${base}/drip`, {}, { ...PRIVATE, timeoutMs: 300 });
  await assert.rejects(dripping.text(), (e) => /timed out|aborted|terminated|TimeoutError/i.test(`${(e as Error).name} ${(e as Error).message}`));
  const controller = new AbortController();
  const pending = guardedFetch(`${base}/silent`, { signal: controller.signal }, PRIVATE);
  controller.abort();
  await assert.rejects(pending, (e) => (e as Error).name === 'AbortError');
  assert.ok(Date.now() - started < 5000);
});

test('responses read like fetch\'s: status, headers, repeated headers, compressed bodies, HEAD and 204 with no body, and the final url', async (t) => {
  const { port } = await listen(t, (req, res) => {
    if (req.url === '/gzip') { res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' }); return res.end(gzipSync('zipped')); }
    if (req.url === '/br') { res.writeHead(200, { 'content-encoding': 'br' }); return res.end(brotliCompressSync('brotli')); }
    if (req.url === '/cookies') { res.writeHead(200, { 'set-cookie': ['a=1', 'b=2'] }); return res.end(); }
    if (req.url === '/empty') { res.writeHead(204); return res.end(); }
    if (req.url === '/missing') { res.writeHead(404, 'Gone Fishing'); return res.end('nope'); }
    if (req.url === '/echo') { let b = ''; req.on('data', (c) => (b += c)); return req.on('end', () => res.end(JSON.stringify({ method: req.method, ct: req.headers['content-type'], b, ae: req.headers['accept-encoding'] }))); }
    res.writeHead(200, { 'x-thing': 'yes' });
    res.end('plain');
  });
  const base = `http://127.0.0.1:${port}`;
  const gz = await guardedFetch(`${base}/gzip`, {}, PRIVATE);
  assert.equal(await gz.text(), 'zipped');
  assert.equal(gz.headers.get('content-encoding'), null);
  assert.equal(gz.url, `${base}/gzip`);
  assert.equal(await (await guardedFetch(`${base}/br`, {}, PRIVATE)).text(), 'brotli');
  assert.deepEqual((await guardedFetch(`${base}/cookies`, {}, PRIVATE)).headers.getSetCookie(), ['a=1', 'b=2']);
  const empty = await guardedFetch(`${base}/empty`, {}, PRIVATE);
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), '');
  const missing = await guardedFetch(`${base}/missing`, {}, PRIVATE);
  assert.deepEqual([missing.status, missing.ok, missing.statusText, await missing.text()], [404, false, 'Gone Fishing', 'nope']);
  const head = await guardedFetch(`${base}/plain`, { method: 'HEAD' }, PRIVATE);
  assert.deepEqual([head.status, head.headers.get('x-thing'), await head.text()], [200, 'yes', '']);
  const form = new FormData();
  form.append('a', 'b');
  const posted = JSON.parse(await (await guardedFetch(`${base}/echo`, { method: 'POST', body: form }, PRIVATE)).text());
  assert.match(posted.ct, /^multipart\/form-data; boundary=/);
  assert.match(posted.b, /name="a"/);
  const json = JSON.parse(await (await guardedFetch(new Request(`${base}/echo`, { method: 'PUT', body: '{"x":1}', headers: { 'content-type': 'application/json' } }), {}, PRIVATE)).text());
  assert.deepEqual([json.method, json.ct, json.b], ['PUT', 'application/json', '{"x":1}']);
  assert.match(json.ae, /gzip/);
});

test('a connection that cannot be made fails the way fetch does, with the reason as the cause', async (t) => {
  const { port, server } = await listen(t, (_req, res) => res.end());
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await assert.rejects(guardedFetch(`http://127.0.0.1:${port}/`, {}, PRIVATE), (e) => e instanceof TypeError && /fetch failed/.test(e.message) && (e as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED');
  names(t, {});
  await assert.rejects(guardedFetch('http://nowhere.test/', {}, PRIVATE), (e) => e instanceof TypeError && /fetch failed/.test(e.message));
});

test('a reader that gives up part-way ends the connection and raises nothing later', async (t) => {
  let closed: () => void;
  const serverSawClose = new Promise<void>((resolve) => (closed = resolve));
  const { port } = await listen(t, (_req, res) => {
    res.writeHead(200);
    const timer = setInterval(() => res.write(Buffer.alloc(16 * 1024, 97)), 1);
    res.on('close', () => { clearInterval(timer); closed(); });
  });
  const r = await guardedFetch(`http://127.0.0.1:${port}/`, {}, PRIVATE);
  const reader = r.body!.getReader();
  assert.ok((await reader.read()).value!.length > 0);
  await reader.cancel();
  await serverSawClose;
  await new Promise((resolve) => setTimeout(resolve, 50)); // an error raised after the cancel would fail the run
});

test('an allow list takes a one-label wildcard, a bracketed range and an IPv4 range against an IPv6 spelling; a mistyped address is an error', () => {
  const may = (list: string[], host: string, address: string) => addressRefusal({ private: list }, host, address) === undefined;
  assert.ok(may(['*.lan'], 'printer.lan', '192.168.1.5'));
  assert.ok(!may(['*.lan'], 'lan', '192.168.1.5'));
  assert.ok(may(['[fd00::]/8'], 'x.example', 'fd12::1'));
  assert.ok(may(['10.0.0.0/8'], 'x.example', '::ffff:10.1.2.3'), 'an IPv4 range covers the IPv4 address an IPv6 answer carries');
  assert.ok(!may(['10.0.0.0/8'], 'x.example', '::ffff:192.168.1.1'));
  assert.throws(() => parseAllowList(['10.1']), /not a host name/);
});

test('a HEAD answer that declares a body larger than the cap is not refused: it has no body', async (t) => {
  const { port } = await listen(t, (req, res) => { res.writeHead(200, { 'content-length': String(3 * 1024 ** 3) }); res.end(); });
  const res = await guardedFetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' }, { ...PRIVATE, maxBytes: 1024 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), String(3 * 1024 ** 3));
  await assert.rejects(guardedFetch(`http://127.0.0.1:${port}/`, {}, { ...PRIVATE, maxBytes: 1024 }), /larger than/);
});

test('no limit: Infinity for the size and the time lets a large, slow transfer through', async (t) => {
  const { port } = await listen(t, (req, res) => { res.end(Buffer.alloc(200_000, 7)); });
  const res = await guardedFetch(`http://127.0.0.1:${port}/`, {}, { ...PRIVATE, maxBytes: Infinity, timeoutMs: Infinity });
  assert.equal((await res.arrayBuffer()).byteLength, 200_000);
});

test('a server answering with a status no Response can hold is a failed request, not an uncaught error', async (t) => {
  const { port } = await listen(t, (_req, res) => { res.writeHead(600); res.end('bad'); });
  const uncaught: Error[] = [];
  const onUncaught = (e: Error) => uncaught.push(e);
  process.on('uncaughtException', onUncaught);
  t.after(() => process.off('uncaughtException', onUncaught));
  await assert.rejects(guardedFetch(`http://127.0.0.1:${port}/`, {}, PRIVATE), /fetch failed/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(uncaught, []);
});
