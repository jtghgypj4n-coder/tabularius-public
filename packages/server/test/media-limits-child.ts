import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Worker } from 'node:worker_threads';
import { createStore, Store } from '../../store/src/index.ts';
import { ContainerFiles } from '../src/containers.ts';
import { decodeGif, encodePng } from '../src/thumbnails.ts';
import { urlTargets } from '../src/conversion-guide.ts';

class Response extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  status = 0;
  headers: Record<string, string | number> = {};
  body?: Uint8Array | string;
  writeHead(status: number, headers = {}) { assert.equal(this.destroyed, false); this.status = status; this.headers = headers; return this; }
  end(body?: Uint8Array | string) { this.body = body; this.writableEnded = true; return this; }
  disconnect() { this.destroyed = true; this.emit('close'); }
}
class WorkerStub extends EventEmitter {
  messages: { id: number }[] = [];
  unref() { return this; }
  postMessage(message: { id: number }) { this.messages.push(message); }
  async terminate() { return 0; }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const scenario = process.argv[2];
if (scenario === 'urls') {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-media-'));
  const path = join(dir, 'test.sqlite');
  createStore(path);
  const store = new Store(path);
  try {
    for (const [i, url] of ['https://@intranet/', 'https://@/', 'https://@@bad:port/', 'https://@localhost/', 'https://@example.test/'].entries()) {
      store.applyDesign([{ op: 'createScript', name: `URL ${i}`, text: `Insert from URL [ $reply ; "${url}" ]` }]);
    }
    assert.deepEqual(urlTargets(store), { hosts: ['https://example.test', 'https://localhost'], computed: true });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
} else if (scenario === 'gif') {
  const gif = (w: number, h: number, iw: number, ih: number, left = 0, top = 0, code = 2) => {
    const data = Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex');
    for (const [at, value] of [[6, w], [8, h], [20, left], [22, top], [24, iw], [26, ih]]) data.writeUInt16LE(value, at);
    data[29] = code;
    return data;
  };
  const Native = Uint8Array;
  let oversized = 0;
  globalThis.Uint8Array = new Proxy(Native, { construct(target, args) {
    if (typeof args[0] === 'number' && args[0] > 1_000_000) { oversized++; throw new Error('allocation intercepted'); }
    return Reflect.construct(target, args);
  } });
  try {
    for (const data of [gif(16, 16, 10_000, 10_000), gif(100, 100, 8000, 8000), gif(7500, 7500, 7500, 7500), gif(1, 1, 0, 1), gif(1, 1, 1, 0), gif(1, 1, 1, 1, 1), gif(1, 1, 1, 1, 0, 1), ...[0, 1, 9, 255].map((n) => gif(1, 1, 1, 1, 0, 0, n)), ...[12, 18, 27, 29, 32].map((n) => gif(1, 1, 1, 1).subarray(0, n))]) {
      assert.equal(decodeGif(data), undefined);
      assert.equal(oversized, 0);
    }
    assert.deepEqual([...decodeGif(gif(1, 1, 1, 1))!.rgba], [0, 0, 0, 255]);
    const interlaced = gif(3, 3, 1, 1, 1, 1); interlaced[28] = 0x40;
    const pic = decodeGif(interlaced)!;
    assert.deepEqual([pic.width, pic.height], [3, 3]);
    assert.deepEqual([...pic.rgba.subarray(16, 20)], [0, 0, 0, 255]);
    assert.equal(pic.rgba.filter((n) => n === 255).length, 1);
  } finally { globalThis.Uint8Array = Native; }
} else {
  let reads = 0;
  let advertisedSize = scenario === 'bytes' ? 64 * 1024 * 1024 : 8;
  let mime = 'image/png';
  let data: Uint8Array = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const workers: WorkerStub[] = [];
  const files = new ContainerFiles({ createWorker: () => { const w = new WorkerStub(); workers.push(w); return w as unknown as Worker; } });
  const store = { path: 'synthetic.sqlite', containerInfo: () => ({ size: advertisedSize, mime, version: '1' }), container: () => { reads++; return { data, mime }; } } as unknown as Store;
  const requests: Promise<void>[] = [];
  const responses: Response[] = [];
  const send = (id: number, size = 32) => {
    const res = new Response(); responses.push(res);
    const promise = files.send({ headers: {}, method: 'GET' } as IncomingMessage, res as unknown as ServerResponse, store, id, { thumb: size });
    requests.push(promise); return res;
  };
  try {
    if (scenario === 'mime') {
      data = encodePng({ width: 1, height: 1, rgba: Uint8Array.of(0, 0, 0, 255) });
      advertisedSize = data.length;
      for (const value of ['image/png;,text/html', 'image/png\r\nx-test: value', 'image/svg+xml', 'text/html']) {
        mime = value; const res = send(responses.length + 1); await requests.at(-1);
        assert.equal(res.status, 200); assert.equal(res.headers['content-type'], 'image/png');
        assert.equal(res.headers['x-content-type-options'], 'nosniff'); assert.deepEqual(res.body, data);
      }
      for (const [hex, expected] of [['47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'image/gif'], ['ffd8ffc0000b080001000101011100ffd9', 'image/jpeg']]) {
        data = Buffer.from(hex, 'hex'); advertisedSize = data.length;
        const res = send(responses.length + 1); await requests.at(-1);
        assert.equal(res.status, 200); assert.equal(res.headers['content-type'], expected); assert.deepEqual(res.body, data);
      }
    } else if (scenario === 'jobs' || scenario === 'bytes' || scenario === 'tools') {
      if (scenario === 'tools') {
        data = Uint8Array.of(37, 80, 68, 70, 45, 49, 46, 55); mime = 'application/pdf';
        files['tools'] = { pdftoppm: '/unused' };
        await files['takeToolSlot'](); await files['takeToolSlot']();
      }
      for (let id = 0; id < 40; id++) send(id);
      await tick();
      assert.ok(reads <= (scenario === 'bytes' ? 2 : 16), `reads: ${reads}`);
      assert.ok(reads >= 2);
      assert.ok(responses.some((res) => res.status === 503));
      if (scenario === 'bytes') {
        advertisedSize++;
        const before = reads; const res = send(100); await requests.at(-1);
        assert.equal(reads, before); assert.equal(res.status, 413);
      }
    } else if (scenario === 'cancel') {
      send(1); send(2);
      const a = send(3), b = send(3);
      assert.equal(reads, 3);
      a.disconnect(); await tick();
      assert.equal(files['pending'].size, 3);
      b.disconnect(); await tick();
      assert.equal(files['pending'].size, 2);
      assert.equal(files['making'].size, 2);
      files.stop(); await Promise.all(requests);
      assert.equal(a.status, 0); assert.equal(b.status, 0);
    } else if (scenario === 'active-cancel') {
      const active = send(1); send(2); const queued = send(3);
      let terminated!: (code: number) => void;
      workers[0].terminate = () => new Promise<number>((resolve) => { terminated = resolve; });
      active.disconnect(); await requests[0]; await tick();
      assert.equal(files['admittedJobs'], 3);
      terminated(0); await tick();
      assert.equal(files['admittedJobs'], 2);
      assert.equal(queued.status, 0);
      const replacement = workers.at(-1)!;
      replacement.emit('message', { id: replacement.messages[0].id, png: Uint8Array.of(4) });
      workers[1].emit('message', { id: workers[1].messages[0].id, png: Uint8Array.of(5) });
      await Promise.all(requests);
      assert.equal(queued.status, 200);
    } else if (scenario === 'lifecycle') {
      send(1); const same = send(1);
      assert.equal(reads, 1);
      workers[0].emit('message', { id: workers[0].messages[0].id, png: Uint8Array.of(1, 2, 3) });
      await Promise.all(requests);
      assert.equal(same.status, 200);
      assert.equal(files['admittedJobs'], 0); assert.equal(files['retainedBytes'], 0);
      assert.equal(files['cached'], 3);
      send(1); await requests.at(-1); assert.equal(reads, 1);
      send(2); send(3); const queued = send(4);
      files.clear(store.path); await Promise.all(requests);
      assert.equal(files['making'].size, 0); assert.equal(files['pending'].size, 0);
      assert.equal(files['admittedJobs'], 0); assert.equal(files['retainedBytes'], 0);
      assert.equal(queued.status, 404);
      const original = store.container;
      store.container = () => { throw new Error('read failed'); };
      await assert.rejects(files.send({ headers: {} } as IncomingMessage, new Response() as unknown as ServerResponse, store, 99, { thumb: 32 }), /read failed/);
      store.container = original;
      assert.equal(files['admittedJobs'], 0); assert.equal(files['retainedBytes'], 0);
      files.stop(); const before = reads; send(100); await requests.at(-1); assert.equal(reads, before);
    } else if (scenario === 'tool-cancel') {
      data = Uint8Array.of(37, 80, 68, 70, 45, 49, 46, 55); mime = 'application/pdf';
      files['tools'] = { pdftoppm: '/unused' };
      await files['takeToolSlot'](); await files['takeToolSlot']();
      const a = send(1), b = send(2);
      assert.equal(files['waitingTools'].length, 2);
      a.disconnect(); await tick();
      assert.equal(files['waitingTools'].length, 1);
      files['releaseToolSlot']();
      b.disconnect();
      await Promise.all(requests); await tick();
      assert.equal(files['waitingTools'].length, 0);
      assert.equal(files['activeTools'], 1);
      assert.equal(files['admittedJobs'], 0); assert.equal(files['retainedBytes'], 0);
      files['releaseToolSlot']();
      assert.equal(files['activeTools'], 0);
    }
  } finally {
    files.stop(); await Promise.all(requests);
    assert.equal(files['pending'].size, 0); assert.equal(files['waitingTools'].length, 0);
    assert.equal(files['admittedJobs'], 0); assert.equal(files['retainedBytes'], 0);
  }
}
