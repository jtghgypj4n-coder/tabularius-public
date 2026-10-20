import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';

// The web client's New Record: the Data API makes the record empty with options.uncommitted, as FileMaker's New Record
// does, and checks the fields that must have a value when the client commits it (options.firstCommit on an edit).
// Without the option, a record made empty is refused as FileMaker's Data API refuses it.

let dir: string;
let server: Server;
let base: string;
let store: Store;
let auth: Record<string, string>;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-new-'));
  createStore(join(dir, 'Shop' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Shop')!;
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [
      { name: 'Code', options: { validation: { notEmpty: true, strict: true, message: 'Every item needs a code.' } } },
      { name: 'Note' },
      { name: 'No', type: 'number', options: { autoEnter: { serial: { next: '7', increment: 1, onCommit: true } } } },
      { name: 'Qty', type: 'number', options: { validation: { range: { min: '1', max: '99' }, strict: true, always: true } } },
    ] },
  ] as DesignOp[]);
  store.setPassword('Admin', 'pw', '[Full Access]');
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  auth = { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed: it may still be writing there.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const api = async (method: string, path: string, body?: unknown) =>
  (await fetch(`${base}/fmi/data/vLatest/databases/Shop${path}`, { method, headers: auth, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
const count = () => store.find('Items', { limit: 100 }).records.length;

test('a record made empty is refused, as FileMaker\'s Data API refuses it', async () => {
  const r = await api('POST', '/layouts/Items/records', { fieldData: {} });
  assert.equal(r.messages[0].code, '509', JSON.stringify(r));
  assert.equal(count(), 0);
});

test('options.uncommitted makes it empty; its first commit checks the required field, and passes once it is filled in', async () => {
  // The serial an item made now would get, so the one given at the first commit can be checked against it.
  const probe = store.create('Items', { Code: 'probe' });
  const serial = Number(store.find('Items', { query: [{ Code: '==probe' }] }).records[0].fieldData['No']);
  store.delete('Items', probe.recordId);
  const made = await api('POST', '/layouts/Items/records', { fieldData: {}, options: { uncommitted: true } });
  assert.equal(made.messages[0].code, '0', JSON.stringify(made));
  const id = made.response.recordId;
  assert.equal(String(store.find('Items', { limit: 10 }).records[0].fieldData['No']), '', 'no serial before the commit');
  try {
    // Other fields save on their own meanwhile, as the person leaves each.
    const note = await api('PATCH', `/layouts/Items/records/${id}`, { fieldData: { Note: 'later' } });
    assert.equal(note.messages[0].code, '0', JSON.stringify(note));

    const refused = await api('PATCH', `/layouts/Items/records/${id}`, { fieldData: {}, options: { firstCommit: true } });
    assert.equal(refused.messages[0].code, '509', JSON.stringify(refused));
    assert.match(refused.messages[0].message, /Every item needs a code/);

    await api('PATCH', `/layouts/Items/records/${id}`, { fieldData: { Code: 'a-1' } });
    const ok = await api('PATCH', `/layouts/Items/records/${id}`, { fieldData: {}, options: { firstCommit: true } });
    assert.equal(ok.messages[0].code, '0', JSON.stringify(ok));
    // A serial set to be given on commit is given now, and the refused commit didn't use one up.
    assert.equal(Number(store.find('Items', { limit: 10 }).records[0].fieldData['No']), serial + 1);
  } finally {
    store.delete('Items', Number(id));
  }
});

test('options.uncommitted doesn\'t skip the checks on values it is given', async () => {
  const r = await api('POST', '/layouts/Items/records', { fieldData: { Code: 'b-1', Qty: '500' }, options: { uncommitted: true } });
  assert.notEqual(r.messages[0].code, '0', JSON.stringify(r));
  assert.equal(count(), 0);
});
