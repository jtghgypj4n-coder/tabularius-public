import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createStore, Store } from '../../store/src/index.ts';
import { ContainerFiles } from '../src/containers.ts';

const image = (last: number) => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, last]);

async function read(files: ContainerFiles, store: Store, etag?: string) {
  let body: Uint8Array | undefined;
  let status = 0;
  let headers: Record<string, string | number> = {};
  const res = {
    writeHead: (code: number, values: Record<string, string | number>) => { status = code; headers = values; return res; },
    end: (value?: Uint8Array) => { body = value; return res; },
  };
  await files.send({ headers: etag ? { 'if-none-match': etag } : {}, method: 'GET' } as IncomingMessage, res as unknown as ServerResponse, store, 1, { thumb: 64 });
  return { body, status, etag: String(headers.etag) };
}

for (const shared of [false, true]) test(`restoring in place replaces thumbnail bytes and ETags with shared results ${shared ? 'enabled' : 'disabled'}`, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-thumbnail-'));
  const path = join(dir, 'A.sqlite'), backup = join(dir, 'backup.sqlite');
  const files = new ContainerFiles();
  const open = (path: string, data: Uint8Array) => {
    createStore(path);
    const store = new Store(path, 'A');
    store.addContainer({ filename: 'image.png', mime: 'image/png', data });
    if (shared) store.shareResults();
    return store;
  };
  const saved = open(backup, image(2));
  saved.close();
  let store = open(path, image(1));
  t.after(() => { store.close(); files.stop(); rmSync(dir, { recursive: true, force: true }); });
  const first = await read(files, store);
  assert.deepEqual(first.body, image(1));
  assert.equal((await read(files, store, first.etag)).status, 304);
  store.close();
  // copyFileSync overwrites the same path; restored counters can equal the old ones.
  copyFileSync(backup, path);
  store = new Store(path, 'A');
  if (shared) store.shareResults();
  // Versioned keys must be safe even before a lifecycle notification clears bytes.
  const restored = await read(files, store, first.etag);
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body, image(2));
  assert.notEqual(restored.etag, first.etag);
  assert.equal((await read(files, store, restored.etag)).status, 304);
  files.clear(path);
  assert.equal(files['cache'].size, 0);
  assert.equal(files['cached'], 0);
});

test('unrelated record writes preserve thumbnail bytes and conditional 304 responses', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-thumbnail-write-'));
  const path = join(dir, 'A.sqlite');
  createStore(path);
  const store = new Store(path);
  const files = new ContainerFiles();
  t.after(() => { store.close(); files.stop(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
  store.addContainer({ filename: 'image.png', mime: 'image/png', data: image(1) });
  const make = t.mock.method(store, 'container');
  const first = await read(files, store);
  const id = store.create('T', { Value: 'first' }).recordId;
  store.update('T', id, { Value: 'second' });
  assert.equal((await read(files, store, first.etag)).status, 304);
  assert.deepEqual((await read(files, store)).body, image(1));
  assert.equal(make.mock.callCount(), 1, 'record writes retain the cached bytes');
  assert.equal(files['cache'].size, 1);
});

test('clearing a path prevents an older pending thumbnail from repopulating the cache', async (t) => {
  const files = new ContainerFiles();
  const store = {
    path: '/host/A.sqlite', dataStamp: () => '1',
    containerInfo: () => ({ mime: 'image/png', size: image(1).length }),
  } as unknown as Store;
  let finish!: (value: { mime: string; data: Uint8Array }) => void;
  t.mock.method(files, 'make' as never, () => new Promise((resolve) => { finish = resolve; }));
  const pending = read(files, store);
  files.clear(store.path);
  finish({ mime: 'image/png', data: image(1) });
  await pending;
  assert.equal(files['cache'].size, 0);
  assert.equal(files['making'].size, 0);
  assert.equal(files['cached'], 0);
});

test('replacing one container refreshes only its thumbnail, including reused ids', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-thumbnail-identity-'));
  const path = join(dir, 'A.sqlite');
  createStore(path);
  const store = new Store(path);
  const files = new ContainerFiles();
  t.after(() => { store.close(); files.stop(); rmSync(dir, { recursive: true, force: true }); });
  store.addContainer({ filename: 'image.png', mime: 'image/png', data: image(1) });
  const first = await read(files, store);
  store.addContainer({ filename: 'other.png', mime: 'image/png', data: image(2) });
  assert.equal((await read(files, store, first.etag)).status, 304);
  store.sql.prepare('UPDATE _fm_containers SET data = ? WHERE id = 1').run(image(3));
  const changed = await read(files, store, first.etag);
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body, image(3));
  store.sql.exec('DELETE FROM _fm_containers');
  assert.equal(store.addContainer({ filename: 'reused.png', mime: 'image/png', data: image(4) }), 1);
  const reused = await read(files, store, changed.etag);
  assert.equal(reused.status, 200);
  assert.deepEqual(reused.body, image(4));
});
