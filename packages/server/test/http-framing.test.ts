import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ServerResponse } from 'node:http';
import { createEdgeServer, EDGE_LIMITS } from '../src/edge-limits.ts';
import { listen, normal, RawClient, request, responseBody, stubCommands } from './edge-test-helpers.ts';

const post = (headers: string, body = '') => request('/body', headers, 'POST') + body;
const afterError = request('/must-not-run', 'Connection: close\r\n');
const malformed: [string, string][] = [
  ...['0\r\nContent-Length: 0', '1\r\nContent-Length: 2', '1, 1', '1, 2', '+1', '-1', '1x', '1.0', '0x1', ''].map(value =>
    [`Content-Length ${JSON.stringify(value)}`, post(`Content-Length: ${value}\r\n`, 'xx')] as [string, string]),
  ['TE with CL', post('Transfer-Encoding: chunked\r\nContent-Length: 0\r\n', '0\r\n\r\n')],
  ['CL with TE in reverse order', post('Content-Length: 0\r\nTransfer-Encoding: chunked\r\n', '0\r\n\r\n')],
  ...['gzip, chunked', 'gzip', 'chunked, gzip', 'chunked, chunked', 'chunked;foo=bar', ',chunked', 'chunked,', 'identity', ''].map(value =>
    [`Transfer-Encoding ${JSON.stringify(value)}`, post(`Transfer-Encoding: ${value}\r\n`, '0\r\n\r\n')] as [string, string]),
  ['duplicate TE', post('Transfer-Encoding: chunked\r\nTransfer-Encoding: chunked\r\n', '0\r\n\r\n')],
  ['HTTP/1.0 TE', post('Transfer-Encoding: chunked\r\n', '0\r\n\r\n').replace('HTTP/1.1', 'HTTP/1.0')],
  ['duplicate Host same', request('/', 'Host: localhost\r\n')],
  ['duplicate Host different', request('/', 'hOsT: other.example\r\n')],
  ['missing Host', 'GET / HTTP/1.1\r\n\r\n'],
  ...['', 'a b', 'a,b', 'user@host', 'host/path', 'host#part', 'host:abc', 'host:65536', '[invalid]', 'host?x'].map(value =>
    [`invalid Host ${JSON.stringify(value)}`, `GET / HTTP/1.1\r\nHost: ${value}\r\n\r\n`] as [string, string]),
  ['bare LF', 'GET / HTTP/1.1\nHost: localhost\n\n'],
  ['bare CR', 'GET / HTTP/1.1\rHost: localhost\r\r'],
  ['mixed LF', 'GET / HTTP/1.1\r\nHost: localhost\n\r\n'],
  ['fold SP', request('/', 'X-Note: first\r\n second\r\n')],
  ['fold HTAB', request('/', 'X-Note: first\r\n\tsecond\r\n')],
  ['space before colon', request('/', 'X-Note : value\r\n')],
  ['tab before colon', request('/', 'X-Note\t: value\r\n')],
  ...['Bad Name', 'Bad(Name)', 'Bad\0Name', 'Bad\x7fName'].map(name =>
    [`invalid field name ${JSON.stringify(name)}`, request('/', `${name}: value\r\n`)] as [string, string]),
  ...['\0', '\x01', '\x0b', '\x0c', '\x1f', '\x7f', '\r'].map(value =>
    [`invalid field value ${JSON.stringify(value)}`, request('/', `X-Note: a${value}b\r\n`)] as [string, string]),
  ...['Z\r\n', '-1\r\n', '1\r\nxNO', '1;\r\nx\r\n', '1;bad name=x\r\nx\r\n', '1;x="unterminated\r\nx\r\n', '1;x=\0\r\nx\r\n'].map(value =>
    [`malformed chunk ${JSON.stringify(value)}`, post('Transfer-Encoding: chunked\r\n', value + '0\r\n\r\n')] as [string, string]),
  ...['Bad Name: x', 'X : x', 'X: x\r\n folded', 'X: \0', 'Content-Length: 1', 'Transfer-Encoding: chunked'].map(value =>
    [`malformed/framing trailer ${JSON.stringify(value)}`, post('Transfer-Encoding: chunked\r\n', `0\r\n${value}\r\n\r\n`)] as [string, string]),
  ...['content-length', 'Transfer-Encoding', 'host', 'expect', 'trailer', 'bad token', '"close"', 'upgrade'].map(value =>
    [`Connection ${JSON.stringify(value)}`, request('/', `Connection: ${value}\r\n`)] as [string, string]),
  ['h2c', request('/', 'Connection: Upgrade\r\nUpgrade: h2c\r\nHTTP2-Settings: AAMAAABk\r\n')],
  ['unaccompanied Upgrade', request('/', 'Upgrade: websocket\r\n')],
  ['unaccompanied HTTP2-Settings', request('/', 'HTTP2-Settings: AAMAAABk\r\n')],
  ['CONNECT', request('localhost:443', '', 'CONNECT')],
  ['HTTP/2 preface', 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n'],
];

for (const [name, raw] of malformed) test(`strict framing: ${name}`, async t => {
  stubCommands(t);
  const committed: string[] = [];
  const port = await listen(t, createEdgeServer((req, res) => {
    req.on('error', () => {});
    req.resume();
    req.on('end', () => { committed.push(req.url!); res.end('accepted'); });
  }));
  const c = await new RawClient(port).ready();
  const text = await c.send(raw + afterError).end();
  assert.match(text, /^HTTP\/1\.1 400 /);
  assert.match(text, /connection: close/i);
  assert.equal((text.match(/HTTP\/1\.1 /g) ?? []).length, 1);
  assert.deepEqual(committed, [], 'neither the invalid message nor its pipeline can commit');
});

test('valid chunk extensions, separate trailers and the following message preserve boundaries', async t => {
  stubCommands(t);
  const messages: object[] = [];
  const port = await listen(t, createEdgeServer((req, res) => {
    let body = '';
    req.on('data', b => { body += b; });
    req.on('end', () => {
      messages.push({ body, host: req.headers.host, authorization: req.headers.authorization,
        trailer: req.trailers['x-check'], path: req.url });
      res.end('ok');
    });
  }));
  const payload = 'GET /fake HTTP/1.1\r\n\0\xff';
  const chunk = Buffer.from(payload, 'latin1');
  const c = await new RawClient(port).ready();
  c.send(post('Transfer-Encoding: ChUnKeD\r\nTrailer: X-Check\r\n'));
  c.send(`${chunk.length.toString(16)};flag;name="a;\\\"b"\r\n`).send(chunk);
  c.send('\r\n0;done=yes\r\nX-Check: checked\r\nHost: ignored.example\r\nAuthorization: ignored\r\n\r\n' + request('/next', 'Connection: close\r\n'));
  assert.equal(((await c.end()).match(/HTTP\/1.1 200/g) ?? []).length, 2);
  assert.deepEqual(messages, [
    { body: chunk.toString(), host: 'localhost', authorization: undefined, trailer: 'checked', path: '/body' },
    { body: '', host: 'localhost', authorization: undefined, trailer: undefined, path: '/next' },
  ]);
});

test('fragmented valid headers and chunk framing work; fragmented obs-fold is rejected', async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer((req, res) => {
    req.on('error', () => {}); req.resume(); req.on('end', () => res.end('ok'));
  }));
  for (const [raw, code] of [
    [post('Transfer-Encoding: chunked\r\nConnection: close\r\n', '1;flag\r\nx\r\n0\r\nX: y\r\n\r\n'), 200],
    [request('/', 'X: one\r\n two\r\nConnection: close\r\n'), 400],
  ] as const) {
    const c = await new RawClient(port).ready();
    for (let at = 0; at < raw.length && !c.socket.destroyed; at += 3) { c.send(raw.slice(at, at + 3)); await sleep(1); }
    assert.match(await c.end(), new RegExp(`^HTTP/1.1 ${code} `));
  }
});

test('ignored chunk extension metadata cannot change a body or swallow the following request', async t => {
  stubCommands(t);
  const received: string[] = [];
  const port = await listen(t, createEdgeServer((req, res) => {
    let body = '';
    req.on('data', b => { body += b; });
    req.on('end', () => { received.push(body); res.end('ok'); });
  }));
  // llhttp tolerates an empty unrecognized extension value; it is never exposed to routes.
  // Record that permissiveness explicitly rather than claiming every ABNF violation is rejected.
  const c = await new RawClient(port).ready();
  const text = await c.send(post('Transfer-Encoding: chunked\r\n', '1;ignored=\r\nx\r\n0\r\n\r\n') + afterError).end();
  assert.equal((text.match(/HTTP\/1.1 200/g) ?? []).length, 2);
  assert.deepEqual(received, ['x', '']);
});

test('fixed-length binary bodies cannot inject a request; safe HTAB and obs-text field values remain valid', async t => {
  stubCommands(t);
  const received: Buffer[] = [];
  const port = await listen(t, createEdgeServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', b => chunks.push(b));
    req.on('end', () => { received.push(Buffer.concat(chunks)); res.end('ok'); });
  }));
  const body = Buffer.from('GET /fake HTTP/1.1\r\nHost: fake\r\n\r\n\0\xff', 'latin1');
  const c = await new RawClient(port).ready();
  c.send(Buffer.from(post(`Content-Length: ${body.length}\r\nX-Note: a\tb\xff\r\n`), 'latin1')).send(body).send(afterError);
  assert.equal(((await c.end()).match(/HTTP\/1.1 200/g) ?? []).length, 2);
  assert.deepEqual(received, [body, Buffer.alloc(0)]);
});

for (const version of ['1.0', '1.1']) test(`HTTP/${version} Connection tokens and explicit response headers cannot reopen a closing connection`, async t => {
  stubCommands(t);
  let calls = 0;
  const port = await listen(t, createEdgeServer((_req, res) => {
    calls++; res.writeHead(200, { Connection: 'keep-alive', 'Content-Length': '2' }).end('ok');
  }));
  const c = await new RawClient(port).ready();
  const first = request('/', 'Connection: keep-alive, X-Note\r\n').replace('HTTP/1.1', `HTTP/${version}`);
  c.send(first);
  await c.until(s => s.includes('ok'));
  c.send(request('/', 'Connection: keep-alive\r\nConnection: , ClOsE ,\r\n').replace('HTTP/1.1', `HTTP/${version}`) + afterError);
  const text = await c.end();
  assert.equal(calls, 2);
  assert.equal((text.match(/HTTP\/1.1 200/g) ?? []).length, 2);
  assert.match(text, /connection: close/i);
});

test('HTTP/1.0 without Host or keep-alive handles one request and closes', async t => {
  stubCommands(t);
  let calls = 0;
  const port = await listen(t, createEdgeServer((_req, res) => { calls++; res.end('ok'); }));
  const c = await new RawClient(port).ready();
  assert.match(await c.send('GET / HTTP/1.0\r\n\r\n' + afterError).end(), /^HTTP\/1.1 200 /);
  assert.equal(calls, 1);
});

test('absolute-form uses target authority and preserves encoded path/query for all downstream consumers', async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer((req, res) => res.end(JSON.stringify({
    url: req.url, host: req.headers.host, raw: req.rawHeaders,
  }))));
  for (const [target, path, host] of [
    ['http://example.test:8080/app/?q=%25', '/app/?q=%25', 'example.test:8080'],
    ['https://[::1]/app/', '/app/', '[::1]'],
    ['http://example.test?x=y', '/?x=y', 'example.test'],
  ]) {
    const c = await new RawClient(port).ready();
    const text = await c.send(request(target, 'Connection: close\r\n')).end();
    assert.match(text, /^HTTP\/1.1 200 /);
    const value = JSON.parse(responseBody(text));
    assert.equal(value.url, path); assert.equal(value.host, host); assert.equal(value.raw[1], host);
  }
});

test('Expect refuses invalid headers before 100; early close while reading never commits and releases admission', async t => {
  stubCommands(t);
  let commits = 0;
  let aborted!: () => void;
  const closed = new Promise<void>(resolve => { aborted = resolve; });
  const port = await listen(t, createEdgeServer((req, res) => {
    if (req.method === 'GET') { res.end('ok'); return; }
    req.on('error', () => {}); req.on('close', aborted);
    req.on('data', () => {}); req.on('end', () => { commits++; res.end('ok'); });
  }, { connectionsPerAddress: 1 }));
  const invalid = await new RawClient(port).ready();
  const text = await invalid.send(post('Expect: 100-continue\r\nHost: duplicate\r\nContent-Length: 5\r\n')).end();
  assert.match(text, /^HTTP\/1.1 400 /); assert.doesNotMatch(text, /100 Continue/);
  // The one admission slot is released when the server sees the first connection close, which can trail the client's own close.
  let early!: RawClient;
  for (let attempt = 0; ; attempt++) {
    early = await new RawClient(port).ready();
    early.send(post('Expect: 100-continue\r\nContent-Length: 5\r\n'));
    try { await early.until(s => s.includes('100 Continue')); break; } catch (error) {
      early.socket.destroy();
      if (attempt >= 40) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  early.send('x'); early.socket.destroy(); await early.closed; await closed;
  await normal(port); assert.equal(commits, 0);
});

test('parser errors cancel queued application dispatch even after a partial response', async t => {
  stubCommands(t);
  const calls: string[] = [];
  let finish!: () => void;
  const port = await listen(t, createEdgeServer((req, res) => {
    calls.push(req.url!); res.write('started');
    finish = () => res.end('finished');
  }));
  const c = await new RawClient(port).ready();
  c.send(request('/first'));
  await c.until(s => s.includes('started'));
  c.send(request('/queued') + 'BAD\0 / HTTP/1.1\r\n\r\n' + afterError);
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  finish();
  const text = await c.end();
  assert.deepEqual(calls, ['/first']);
  assert.match(text, /started[\s\S]*finished[\s\S]*0\r\n\r\n$/, 'the valid request is answered in full, then the connection closes');
  assert.equal((text.match(/HTTP\/1.1 /g) ?? []).length, 1, 'close, do not splice a 400 into a started body');
});

test('a parser error behind a complete request discards queued work and lets that request answer, then closes', async t => {
  stubCommands(t);
  const calls: string[] = [];
  let finish!: () => void;
  const port = await listen(t, createEdgeServer((req, res) => {
    calls.push(req.url!); finish = () => res.end('finished');
  }));
  const c = await new RawClient(port).ready();
  c.send(request('/first') + request('/queued') + 'BAD\0 / HTTP/1.1\r\n\r\n' + afterError);
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  finish();
  const text = await c.end();
  // The valid first request is answered (not mistaken for the error's response); nothing queued behind it runs.
  assert.match(text, /^HTTP\/1.1 200 /);
  assert.match(text, /connection: close/i);
  assert.match(text, /finished$/);
  assert.equal((text.match(/HTTP\/1.1 /g) ?? []).length, 1);
  assert.deepEqual(calls, ['/first']);
});

test('a queued semantic error follows the first response in order and stops the remaining pipeline', async t => {
  stubCommands(t);
  const calls: string[] = [];
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const port = await listen(t, createEdgeServer((req, res) => {
    calls.push(req.url!); finish = () => res.end('finished'); entered();
  }));
  const c = await new RawClient(port).ready();
  c.send(request('/first') + request('/invalid', 'Host: duplicate\r\n') + afterError);
  await started;
  finish();
  const text = await c.end();
  assert.deepEqual(text.match(/HTTP\/1.1 \d{3}/g), ['HTTP/1.1 200', 'HTTP/1.1 400']);
  assert.deepEqual(calls, ['/first']);
});

test('an unsupported expectation closes before a pipelined request can execute', async t => {
  stubCommands(t);
  let calls = 0;
  const port = await listen(t, createEdgeServer((_req, res) => { calls++; res.end('ok'); }));
  for (const expect of ['unsupported', '', '100-continue, 100-continue']) {
    const c = await new RawClient(port).ready();
    const text = await c.send(request('/', `Expect: ${expect}\r\n`) + afterError).end();
    assert.match(text, /^HTTP\/1.1 417 /);
    assert.equal(calls, 0);
    assert.equal((text.match(/HTTP\/1.1 /g) ?? []).length, 1);
  }
});

test('Upgrade during an earlier response closes without dispatching queued work or inserting another status line', async t => {
  stubCommands(t);
  const calls: string[] = [];
  let finish!: () => void;
  const port = await listen(t, createEdgeServer((req, res) => {
    calls.push(req.url!); res.write('started'); finish = () => res.end('finished');
  }));
  const c = await new RawClient(port).ready();
  c.send(request('/first'));
  await c.until(s => s.includes('started'));
  c.send(request('/queued') + request('/', 'Connection: Upgrade\r\nUpgrade: h2c\r\n') + afterError);
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  finish();
  const text = await c.end();
  assert.deepEqual(calls, ['/first']);
  assert.match(text, /started[\s\S]*finished[\s\S]*0\r\n\r\n$/, 'the valid request is answered in full, then the connection closes');
  assert.equal((text.match(/HTTP\/1.1 /g) ?? []).length, 1);
});

test('long targets retain the existing 414/431 transport limits and discard their pipeline', async t => {
  stubCommands(t);
  let calls = 0;
  const port = await listen(t, createEdgeServer((_req, res) => { calls++; res.end('ok'); }));
  for (const size of [EDGE_LIMITS.requestLineBytes, EDGE_LIMITS.requestLineBytes + EDGE_LIMITS.headerBytes + 1024]) {
    const c = await new RawClient(port).ready();
    assert.match(await c.send(request('/' + 'x'.repeat(size)) + afterError).end(), /^HTTP\/1.1 (414|431) /);
    assert.equal(calls, 0);
  }
});

test('a response that decides to close stops the pipeline even when Node still reports keep-alive', async t => {
  stubCommands(t);
  for (const [name, raw, handler] of [
    ['HTTP/1.0 keep-alive without a length', 'GET /first HTTP/1.0\r\nConnection: keep-alive\r\n\r\nGET /must-not-run HTTP/1.0\r\nConnection: keep-alive\r\n\r\n', (_req: unknown, res: ServerResponse) => { res.end('ok'); }],
    ['a route that sets Connection: close itself', 'POST /first HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\nPOST /must-not-run HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n', (_req: unknown, res: ServerResponse) => { res.statusCode = 503; res.setHeader('connection', 'close'); res.end('busy'); }],
  ] as const) {
    const calls: string[] = [];
    const port = await listen(t, createEdgeServer((req, res) => { calls.push(req.url!); handler(req, res); }));
    const c = await new RawClient(port).ready();
    const text = await c.send(raw).end();
    assert.deepEqual(calls, ['/first'], name);
    assert.equal((text.match(/HTTP\/1\.[01] /g) ?? []).length, 1, name);
  }
});

test('a valid request still running is not answered with the 400 meant for bytes after it', async t => {
  stubCommands(t);
  let finish!: () => void;
  const calls: string[] = [];
  const port = await listen(t, createEdgeServer((req, res) => { calls.push(req.url!); finish = () => res.end('slow done'); }));
  const c = await new RawClient(port).ready();
  c.send(request('/slow') + 'BAD\0 / HTTP/1.1\r\n\r\n');
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  finish();
  const text = await c.end();
  assert.match(text, /^HTTP\/1\.1 200 /);
  assert.match(text, /slow done$/);
  assert.doesNotMatch(text, /400 Bad Request/);
  assert.deepEqual(calls, ['/slow']);
});

test('HTTP/1.0 ignores Expect: 100-continue', async t => {
  stubCommands(t);
  const port = await listen(t, createEdgeServer((req, res) => { req.on('data', () => {}); req.on('end', () => res.end('ok')); }));
  const c = await new RawClient(port).ready();
  const text = await c.send('POST /b HTTP/1.0\r\nExpect: 100-continue\r\nContent-Length: 2\r\n\r\nhi').end();
  assert.doesNotMatch(text, /100 Continue/);
  assert.match(text, /^HTTP\/1\.1 200 /);
});
