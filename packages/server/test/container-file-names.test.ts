// A container's file name is the uploader's word and can hold anything. The download must still work, with a plain
// ASCII name in the header's filename="..." and the real one in filename*=, never a 500 from an unsendable header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ContainerFiles } from '../src/containers.ts';
import type { Store } from '../../store/src/index.ts';

const names = ['日本語.png', 'emoji 😀.png', 'a\u0000b.png', 'tab\tname.png', 'bell\u0007.png', 'quote".png', 'back\\slash.png', 'new\r\nline.png', 'del\u007f.png', 'half\ud800.png'];

test('a file name with non-ASCII or control characters still downloads, with a safe header', async () => {
  let current = '';
  let mime = 'application/octet-stream';
  const data = Buffer.from('hello');
  const store = {
    containerInfo: () => ({ filename: current, mime, size: data.length, chunked: false }),
    container: () => ({ data }),
  } as unknown as Store;
  const files = new ContainerFiles();
  const server = createServer((req, res) => {
    files.send(req, res, store, 1).catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const port = (server.address() as { port: number }).port;
    for (const name of names) {
      current = name;
      const r = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(r.status, 200, JSON.stringify(name));
      assert.equal(await r.text(), 'hello');
      const disposition = r.headers.get('content-disposition')!;
      const plain = /filename="([^"]*)"/.exec(disposition)![1];
      assert.match(plain, /^[\x20-\x7e]*$/, `plain name of ${JSON.stringify(name)}`);
      assert.ok(!plain.includes('\\'));
      assert.equal(decodeURIComponent(/filename\*=UTF-8''(.*)$/.exec(disposition)![1]), name.replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, '\ufffd'));
    }
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
  }
});

test('a type that a header cannot carry is sent as an unknown binary type', async () => {
  const data = Buffer.from('x');
  const store = { containerInfo: () => ({ filename: 'a.bin', mime: '日本/x', size: 1, chunked: false }), container: () => ({ data }) } as unknown as Store;
  const files = new ContainerFiles();
  const server = createServer((req, res) => {
    files.send(req, res, store, 1).catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const r = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/octet-stream');
    assert.match(r.headers.get('content-disposition')!, /^attachment/);
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
  }
});
