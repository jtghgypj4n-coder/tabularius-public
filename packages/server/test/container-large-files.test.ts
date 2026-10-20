// A 200 MB file goes into a container field and comes out again, and ranges of it read, without the server (or this test,
// which shares its process) ever holding the file: the process's peak memory stays under a budget far below the size.
// This file runs alone in its process (node --test runs each file separately), so the peak is the test's own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import v8 from 'node:v8';
import vm from 'node:vm';
import { containerFixture, fillPattern, pattern, type ContainerFixture } from './container-fixture.ts';

const SIZE = 200 * 1024 * 1024;
const PIECE = 4 * 1024 * 1024;
/** How much the peak resident memory may grow over the whole round trip. */
const BUDGET = 100 * 1024 * 1024;

let f: ContainerFixture;
before(async () => { f = await containerFixture(); });
after(async () => { await f?.close(); });

const peak = () => process.resourceUsage().maxRSS * 1024;
// Garbage waiting to be collected is not what is being measured: collect between pieces, so the peak is what is held.
v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc') as () => void;

test('200 MB goes in by pieces, comes out whole and in ranges, and the peak memory stays far below its size', async () => {
  const auth = await f.login('Admin');
  const call = async (method: string, path: string, body?: unknown) => {
    const raw = body instanceof Uint8Array;
    const r = await fetch(`${f.api}${path}`, { method, headers: { authorization: auth, ...(body === undefined || raw ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : raw ? (body as unknown as BodyInit) : JSON.stringify(body) });
    return (await r.json()) as { response: Record<string, any>; messages: { code: string; message: string }[] };
  };
  const started = performance.now();
  collect();
  const before = peak();

  const s = await call('POST', `/layouts/Contacts/records/${f.contact(1)}/container-uploads/Photo/1`, { filename: 'film.mov', mime: 'video/quicktime', size: SIZE });
  assert.equal(s.messages[0].code, '0');
  const id: string = s.response.uploadId;
  const sent = createHash('sha256');
  const buffer = Buffer.allocUnsafe(PIECE);
  for (let at = 0; at < SIZE; at += PIECE) {
    const piece = fillPattern(buffer.subarray(0, Math.min(PIECE, SIZE - at)), at, 11);
    sent.update(piece);
    const r = await call('PUT', `/layouts/Contacts/container-uploads/${id}?offset=${at}`, piece);
    assert.equal(r.messages[0].code, '0');
    collect();
  }
  const done = await call('POST', `/layouts/Contacts/container-uploads/${id}/finish`, {});
  assert.equal(done.messages[0].code, '0');
  const uploaded = performance.now();

  const recordId = f.store.containerId('Contacts', Number(f.contact(1)), 'Photo')!;
  const info = f.store.containerInfo(recordId)!;
  assert.equal(info.size, SIZE);
  assert.equal(info.chunked, true);
  const url = f.store.present(recordId, 'container', 'iso') as string;

  // The whole file, read as it arrives and never kept.
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), String(SIZE));
  const received = createHash('sha256');
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    received.update(chunk);
    if ((total += chunk.length) % (16 * 1024 * 1024) < chunk.length) collect();
  }
  assert.equal(total, SIZE);
  assert.equal(received.digest('hex'), sent.digest('hex'), 'the file that comes out is the file that went in');

  // Seeking: a range from deep inside, one over a piece boundary, the last bytes.
  for (const [from, length] of [[150_000_000, 1000], [3 * 1024 * 1024 - 100, 200], [SIZE - 4096, 4096], [100 * 1024 * 1024 + 17, 3 * 1024 * 1024]] as const) {
    const r = await fetch(url, { headers: { range: `bytes=${from}-${from + length - 1}` } });
    assert.equal(r.status, 206);
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(pattern(from, length, 11)), `bytes ${from}+${length}`);
  }
  const grew = peak() - before;
  console.log(`200 MB round trip: ${Math.round(uploaded - started)} ms up, ${Math.round(performance.now() - uploaded)} ms out; peak memory grew ${Math.round(grew / 1024 / 1024)} MB`);
  assert.ok(grew < BUDGET, `peak memory grew by ${Math.round(grew / 1024 / 1024)} MB for a ${SIZE / 1024 / 1024} MB file (budget ${BUDGET / 1024 / 1024} MB)`);
});
