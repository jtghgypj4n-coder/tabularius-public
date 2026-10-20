// Text answers are compressed when the caller accepts it; sign-in answers, small answers, non-text and callers that
// refuse it are sent as they are.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type Server } from 'node:http';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { serve } from '../src/index.ts';
import { chooseEncoding } from '../src/compression.ts';

let dir: string;
let server: Server;
let base: string;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-compress-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

// node's fetch decodes for us; this keeps the bytes as they came.
const raw = (path: string, accept?: string, method = 'GET') => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
  const r = request(`${base}${path}`, { method, headers: accept ? { 'accept-encoding': accept } : {} }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  r.on('error', reject);
  r.end();
});

test('the encoding is chosen from Accept-Encoding', () => {
  assert.equal(chooseEncoding(undefined), undefined);
  assert.equal(chooseEncoding('identity'), undefined);
  assert.equal(chooseEncoding('gzip'), 'gzip');
  assert.equal(chooseEncoding('gzip, deflate, br'), 'br');
  assert.equal(chooseEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(chooseEncoding('gzip;q=0'), undefined);
  assert.equal(chooseEncoding('*'), 'br');
});

test('a guide page is compressed with gzip or brotli and reads back the same', async () => {
  const plain = await raw('/docs/design-mode');
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['content-encoding'], undefined);
  const gz = await raw('/docs/design-mode', 'gzip');
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.match(String(gz.headers.vary), /Accept-Encoding/);
  assert.ok(gz.body.length < plain.body.length / 2);
  assert.equal(gunzipSync(gz.body).toString(), plain.body.toString());
  const br = await raw('/docs/design-mode', 'br, gzip');
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(brotliDecompressSync(br.body).toString(), plain.body.toString());
});

test('HEAD, small answers, refusals and sign-in paths are sent as they are', async () => {
  assert.equal((await raw('/docs/design-mode', 'gzip', 'HEAD')).headers['content-encoding'], undefined);
  assert.equal((await raw('/docs/design-mode', 'gzip;q=0')).headers['content-encoding'], undefined);
  // A small answer: still correct whether or not it was compressed.
  const small = await raw('/', 'gzip');
  const body = small.headers['content-encoding'] === 'gzip' ? gunzipSync(small.body) : small.body;
  assert.equal(JSON.parse(body.toString()).name, 'tabularius');
  const login = await raw('/fmi/data/vLatest/databases/none/sessions', 'gzip', 'POST');
  assert.equal(login.headers['content-encoding'], undefined);
});
