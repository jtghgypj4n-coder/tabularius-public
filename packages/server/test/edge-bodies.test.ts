import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import type { IncomingMessage } from 'node:http';
import { gzipSync, deflateSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { createEdgeServer } from '../src/edge-limits.ts';
import { ApiError, eachChunk, readBody, readJson, multipartUploadStream, multipartUpload, multipartParts, stringifyJsonPreservingNumbers } from '../src/dataapi.ts';
import { MAX_JSON_DEPTH, MAX_JSON_NUMBER_CHARS, parseRequestJson } from '../src/request-json.ts';
import { MAX_MULTIPART_PARTS, MAX_PART_HEADERS, MAX_BOUNDARY_BYTES, MultipartLimits } from '../src/multipart-limits.ts';
import { listen, normal, RawClient, request, stubCommands } from './edge-test-helpers.ts';

const chunk = (body: string | Buffer) => Buffer.concat([Buffer.from(Buffer.byteLength(body).toString(16) + '\r\n'), Buffer.from(body), Buffer.from('\r\n')]);
const type = 'multipart/form-data; boundary=abc';
const part = (value: string, name = 'upload') => `--abc\r\nContent-Disposition: form-data; name="${name}"; filename="test.txt"\r\n\r\n${value}\r\n`;

test('route byte caps reject declared bodies before 100 Continue, and chunked bodies before application work', async t => {
  stubCommands(t);
  const caps: Record<string, number> = { '/json': 256, '/upload': 512, '/import': 768, '/mcp': 1024 };
  let writes = 0;
  const port = await listen(t, createEdgeServer(async (req, res) => {
    if (req.url === '/') { res.end('ok'); return; }
    try { await readBody(req, caps[req.url!]); writes++; res.end('ok'); }
    catch (e) { res.writeHead(e instanceof ApiError ? e.status : e instanceof SyntaxError ? 400 : 500).end(); }
  }));
  for (const [route, limit] of Object.entries(caps)) {
    const declared = await new RawClient(port).ready();
    declared.send(request(route, `Content-Length: ${limit + 1}\r\nExpect: 100-continue\r\n`, 'POST'));
    await normal(port);
    assert.match(await declared.end(), /^HTTP\/1\.1 413 /);
    assert.doesNotMatch(declared.text, /100 Continue/);
    const streamed = await new RawClient(port).ready();
    streamed.send(request(route, 'Transfer-Encoding: chunked\r\n', 'POST'));
    streamed.send(chunk('x'.repeat(limit))).send(chunk('x')); // no terminating chunk: refusal must precede EOF
    await normal(port);
    assert.match(await streamed.end(), /^HTTP\/1\.1 413 /);
    assert.equal(writes, 0);
  }
});

test('gzip and deflate expansion bombs are refused before decoding or inviting bytes', async t => {
  stubCommands(t);
  let dispatches = 0;
  const port = await listen(t, createEdgeServer((req, res) => { if (req.headers['content-encoding']) dispatches++; res.end('ok'); }));
  for (const [encoding, body] of [['gzip', gzipSync(Buffer.alloc(1024 * 1024))], ['deflate', deflateSync(Buffer.alloc(1024 * 1024))]] as const) {
    for (const sendBody of [false, true]) {
      const before = dispatches;
      const c = await new RawClient(port).ready();
      c.send(request('/', `Content-Encoding: ${encoding}\r\nContent-Length: ${body.length}\r\nExpect: 100-continue\r\n`, 'POST'));
      if (sendBody) c.send(body);
      await normal(port);
      assert.match(await c.end(), /^HTTP\/1\.1 415 /);
      assert.equal(dispatches, before);
    }
  }
});

test('multipart rejects thousands of parts, excessive part headers, and a huge part before committing', async t => {
  stubCommands(t);
  let commits = 0;
  const port = await listen(t, createEdgeServer(async (req, res) => {
    if (req.url === '/') { res.end('ok'); return; }
    try {
      if (req.url === '/stream') {
        const file = await multipartUploadStream(req, type, 32 * 1024);
        try { commits++; } finally { file.release(); }
      } else { multipartUpload(type, await readBody(req, 32 * 1024)); commits++; }
      res.end('ok');
    } catch (e) { res.writeHead(e instanceof ApiError ? e.status : e instanceof SyntaxError ? 400 : 500).end(); }
  }));
  for (const route of ['/memory', '/stream']) {
    for (const body of [
      part('x').repeat(2000),
      `--abc\r\nX-Large: ${'x'.repeat(MAX_PART_HEADERS + 1)}`,
      part('x'.repeat(33 * 1024)),
    ]) {
      const c = await new RawClient(port).ready();
      c.send(request(route, `Content-Type: ${type}\r\nTransfer-Encoding: chunked\r\n`, 'POST'));
      c.send(chunk(body));
      await normal(port);
      assert.match(await c.end(), /^HTTP\/1\.1 413 /);
      assert.equal(commits, 0);
    }
    // Crossing only the part count (well below the byte cap) refuses without reading the remaining form.
    const c = await new RawClient(port).ready();
    c.send(request(route, `Content-Type: ${type}\r\nTransfer-Encoding: chunked\r\n`, 'POST'));
    c.send(chunk(part('x').repeat(MAX_MULTIPART_PARTS + 1)));
    assert.match(await c.end(), /^HTTP\/1\.1 413 /);
    assert.equal(commits, 0);
    await normal(port);
  }
});

test('multipart boundary fragmentation is bounded, and whole-form validation precedes the first yielded part', () => {
  const body = Buffer.from(part('a') + part('b', 'other') + '--abc--\r\n');
  for (let width = 1; width < 20; width++) {
    const limits = new MultipartLimits(type);
    for (let at = 0; at < body.length; at += width) limits.push(body.subarray(at, at + width));
    assert.equal(limits.parts, 2);
  }
  assert.throws(() => multipartUpload(type, Buffer.from(part('a').repeat(MAX_MULTIPART_PARTS + 1) + '--abc--\r\n')), /Too many multipart parts/);
  assert.equal(multipartUpload(type, Buffer.from(part('a').repeat(MAX_MULTIPART_PARTS) + '--abc--\r\n')).data.toString(), 'a');
  const epilogue = Buffer.from(part('a') + '--abc--\r\n' + part('ignored').repeat(2000));
  assert.equal([...multipartParts(type, epilogue)].length, 1, 'parser and quota scanner both stop at the closing delimiter');
  const lookalikes = Buffer.from(part('a' + part('not a delimiter').replace(/\r\n$/, '').repeat(2000)) + '--abc--\r\n');
  assert.equal([...multipartParts(type, lookalikes)].length, 1, 'a boundary without the leading CRLF is payload, not extra parts');
  assert.throws(() => new MultipartLimits(`multipart/form-data; boundary=${'x'.repeat(MAX_BOUNDARY_BYTES + 1)}`), /Invalid multipart boundary/);
  assert.doesNotThrow(() => new MultipartLimits(`multipart/form-data; boundary=${'x'.repeat(MAX_BOUNDARY_BYTES)}`));
  const spacedType = 'multipart/form-data; boundary="abc "';
  const spaced = Buffer.from((part('a').replace('--abc', '--abc ')).repeat(MAX_MULTIPART_PARTS + 1) + '--abc --\r\n');
  assert.throws(() => multipartUpload(spacedType, spaced), /Too many multipart parts/, 'scanner and parser use exactly the same boundary bytes');
});

test('streamed single/multiple-part uploads retain only the upload data and release temporary files', async t => {
  stubCommands(t);
  const paths: string[] = [];
  const port = await listen(t, createEdgeServer(async (req, res) => {
    try {
      const file = await multipartUploadStream(req, type, 2048, req.url === '/small-buffer' ? 64 : 2048);
      try {
        const body = 'path' in file ? readFileSync(file.path).subarray(file.offset ?? 0, (file.offset ?? 0) + file.size) : file.data;
        assert.equal(Buffer.from(body!).toString(), 'hello');
        if ('path' in file) paths.push(file.path);
        res.end('ok');
      } finally { file.release(); }
    } catch (e) { res.writeHead(e instanceof ApiError ? e.status : 500).end(String(e)); }
  }));
  for (const body of [part('hello') + '--abc--\r\n', part('hello') + part('other', 'extra') + '--abc--\r\n']) {
    const c = await new RawClient(port).ready();
    assert.match(await c.send(request('/', `Connection: close\r\nContent-Type: ${type}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n`, 'POST') + body).end(), /^HTTP\/1\.1 200 /);
  }
  assert.equal(paths.length, 1);
  assert.ok(paths.every(path => !existsSync(path)));
  const body = part('hello') + part('other', 'extra') + '--abc--\r\n';
  const c = await new RawClient(port).ready();
  assert.match(await c.send(request('/small-buffer', `Connection: close\r\nContent-Type: ${type}\r\nContent-Length: ${body.length}\r\n`, 'POST') + body).end(), /^HTTP\/1\.1 413 /);
});

test('JSON depth, huge numeric tokens and overflow refuse before writes; exact native numbers survive', async t => {
  stubCommands(t);
  let commits = 0;
  const port = await listen(t, createEdgeServer(async (req, res) => {
    if (req.url === '/') { res.end('ok'); return; }
    try {
      const body = req.url === '/direct' ? parseRequestJson((await readBody(req, 10_000)).toString()) : await readJson(req, req.url === '/native');
      commits++; res.end(stringifyJsonPreservingNumbers(body));
    } catch (e) { res.writeHead(e instanceof ApiError ? e.status : e instanceof SyntaxError ? 400 : 500).end(); }
  }));
  for (const route of ['/json', '/direct']) {
    for (const body of ['{"x":' + '['.repeat(MAX_JSON_DEPTH) + '0' + ']'.repeat(MAX_JSON_DEPTH) + '}', '{"x":1e999999}', '{"x":' + '9'.repeat(MAX_JSON_NUMBER_CHARS + 1) + '}']) {
      const c = await new RawClient(port).ready();
      c.send(request(route, `Content-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n`, 'POST') + body);
      await normal(port);
      assert.match(await c.end(), /^HTTP\/1\.1 400 /);
      assert.equal(commits, 0);
    }
  }
  const body = '{"x":1e400,"integer":9007199254740993}';
  const c = await new RawClient(port).ready();
  assert.ok((await c.send(request('/native', `Content-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n`, 'POST') + body).end()).endsWith(body));
  assert.equal(commits, 1);
  assert.equal(parseRequestJson('1.7976931348623157e308'), Number.MAX_VALUE);
  assert.equal(parseRequestJson('"' + '9'.repeat(2000) + '"').length, 2000);
  assert.deepEqual(parseRequestJson('['.repeat(MAX_JSON_DEPTH) + '0' + ']'.repeat(MAX_JSON_DEPTH)), JSON.parse('['.repeat(MAX_JSON_DEPTH) + '0' + ']'.repeat(MAX_JSON_DEPTH)));
});


test('async body sinks apply backpressure, preserve byte order, and settle writes before abort cleanup', async () => {
  const stream = new PassThrough();
  const chunks: string[] = [];
  let active = 0;
  let peak = 0;
  const reading = eachChunk(stream as unknown as IncomingMessage, async c => {
    peak = Math.max(peak, ++active);
    await sleep(20);
    chunks.push(c.toString());
    active--;
  });
  for (const text of ['first', 'second', 'third']) stream.write(text);
  stream.end();
  await reading;
  assert.equal(chunks.join(''), 'firstsecondthird');
  assert.equal(peak, 1);

  const aborted = new PassThrough();
  let finishWrite!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const write = new Promise<void>(resolve => { finishWrite = resolve; });
  const pending = eachChunk(aborted as unknown as IncomingMessage, () => { entered(); return write; });
  let settled = false;
  const refusal = assert.rejects(pending, /closed before its body arrived/).then(() => { settled = true; });
  aborted.write('held');
  await started;
  aborted.destroy();
  await sleep(20);
  assert.equal(settled, false, 'cleanup waits for the outstanding write');
  finishWrite();
  await refusal;
});
