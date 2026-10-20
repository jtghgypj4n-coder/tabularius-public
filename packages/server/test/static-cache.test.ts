import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { loadAsset, sendAsset } from '../src/static-cache.ts';

const big = 'body { color: red; }\n'.repeat(200);

test('loadAsset gives the same Asset until the file changes, and runs `make` once per version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-asset-'));
  try {
    const path = join(dir, 'a.txt');
    writeFileSync(path, 'one');
    let made = 0;
    const make = (b: Buffer) => { made++; return b.toString('utf8').toUpperCase(); };
    const first = await loadAsset(path, make);
    assert.equal(first.body.toString(), 'ONE');
    assert.equal(await loadAsset(path, make), first);
    assert.equal(made, 1);
    writeFileSync(path, 'three');
    utimesSync(path, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const next = await loadAsset(path, make);
    assert.notEqual(next, first);
    assert.equal(next.body.toString(), 'THREE');
    assert.notEqual(next.etag, first.etag);
    assert.equal(made, 2);
    await assert.rejects(loadAsset(join(dir, 'missing.txt')));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('sendAsset answers 304, a precompressed body, or the plain bytes, as the request allows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-asset-'));
  const css = join(dir, 'a.css');
  const png = join(dir, 'a.png');
  writeFileSync(css, big);
  writeFileSync(png, Buffer.alloc(4000, 1));
  const server = createServer((req, res) => {
    const file = req.url === '/png' ? png : css;
    loadAsset(file).then((asset) => sendAsset(req, res, { 'content-type': file === png ? 'image/png' : 'text/css', 'cache-control': 'no-cache' }, asset));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const plain = await fetch(`${url}/css`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(plain.status, 200);
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(await plain.text(), big);
    const etag = plain.headers.get('etag')!;

    // fetch decodes the body itself; the header it keeps says which encoding was sent.
    const br = await fetch(`${url}/css`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.equal(br.headers.get('etag'), etag);
    assert.match(br.headers.get('vary') ?? '', /accept-encoding/i);
    assert.equal(await br.text(), big);
    const gz = await fetch(`${url}/css`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.equal(await gz.text(), big);

    const again = await fetch(`${url}/css`, { headers: { 'if-none-match': etag, 'accept-encoding': 'br' } });
    assert.equal(again.status, 304);
    assert.equal(again.headers.get('content-type'), null);
    assert.equal((await again.arrayBuffer()).byteLength, 0);

    const head = await fetch(`${url}/css`, { method: 'HEAD', headers: { 'accept-encoding': 'br' } });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-encoding'), null);

    const image = await fetch(`${url}/png`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(image.headers.get('content-encoding'), null);
    assert.equal((await image.arrayBuffer()).byteLength, 4000);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true });
  }
});

test('the compressed forms decode to the body and are made once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-asset-'));
  try {
    const path = join(dir, 'a.css');
    writeFileSync(path, big);
    const asset = await loadAsset(path);
    assert.equal(brotliDecompressSync(await asset.encode('br')).toString(), big);
    assert.equal(gunzipSync(await asset.encode('gzip')).toString(), big);
    assert.equal(asset.encode('br'), asset.encode('br'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
