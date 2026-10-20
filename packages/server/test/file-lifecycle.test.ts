import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';

function setup(t: { after(fn: () => Promise<void>): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'file-lifecycle-'));
  const host = new Host(dir);
  const store = host.create('A');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Value' }] }]);
  store.create('Items', { Value: 'acknowledged' });
  const api = new DataApi(host);
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, host, store, api };
}

test('checkpoint failure leaves the live file registered and a retry preserves writes', async (t) => {
  const { host, store } = setup(t);
  const checkpoint = t.mock.method(store, 'checkpoint', () => { throw new Error('injected checkpoint failure'); });
  assert.throws(() => host.closeFile('A'), /injected/);
  assert.equal(host.get('A'), store);
  store.create('Items', { Value: 'after failure' });
  checkpoint.mock.restore();
  assert.equal(host.closeFile('A'), true);
  assert.equal(host.openFile('A'), true);
  assert.deepEqual(host.get('A')!.find('Items').records.map((r) => r.fieldData.Value), ['acknowledged', 'after failure']);
});

test('failed open retains the closed entry and can be retried', (t) => {
  const { host, store } = setup(t);
  host.closeFile('A');
  const saved = store.path + '.saved';
  renameSync(store.path, saved);
  writeFileSync(store.path, 'injected damaged database');
  assert.throws(() => host.openFile('A'));
  assert.equal(host.files()[0]?.status, 'closed');
  rmSync(store.path);
  renameSync(saved, store.path);
  assert.equal(host.openFile('A'), true);
  assert.equal(host.get('A')!.find('Items').records[0].fieldData.Value, 'acknowledged');
});

test('a failed open callback releases its connection and keeps the file retryable', (t) => {
  const { host } = setup(t);
  host.closeFile('A');
  let failed: ReturnType<Host['add']> | undefined;
  host.onAdd.push((store) => { failed = store; throw new Error('injected open callback failure'); });
  assert.throws(() => host.openFile('A'), /injected/);
  assert.equal(host.get('A'), undefined);
  assert.equal(failed!.sql.isOpen, false);
  assert.equal(host.files()[0]?.status, 'closed');
  host.onAdd.pop();
  assert.equal(host.openFile('A'), true);
  assert.equal(host.get('A')!.find('Items').records[0].fieldData.Value, 'acknowledged');
});

for (const action of ['rename', 'delete'] as const) test(`${action} of a closed file cannot silently recreate an empty database`, (t) => {
  const { host, store, api } = setup(t);
  const token = api.open(store, 'Admin', 'web');
  host.closeFile('A');
  assert.equal(api.sessionCount, 0, 'all close callers end clients');
  if (action === 'rename') renameSync(store.path, store.path + '.moved');
  else rmSync(store.path);
  assert.equal(host.openFile('A'), false);
  assert.equal(existsSync(store.path), false);
  assert.equal(api.alive(token), false);
  assert.equal(host.files()[0]?.status, 'closed');
});

test('closing a paused file ends its clients and releases their locks', (t) => {
  const { host, store, api } = setup(t);
  const token = api.open(store, 'Admin', 'web');
  store.locks.acquire('Items', 1, token, 'Admin');
  host.pauseFile('A');
  host.closeFile('A');
  assert.equal(api.sessionCount, 0);
  assert.deepEqual(store.locks.releaseOwner(token), [], 'close released the paused store locks');
  host.openFile('A');
  assert.equal(api.alive(token), false);
});
