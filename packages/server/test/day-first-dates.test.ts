import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';

// A file whose dates are day first (DMY). The Data API gives its dates as MM/DD/YYYY, as FileMaker's does, so
// dates sent to it are read the same way: a client that
// reads 11/10/2026 and sends it back must not turn 10 November into 11 October. The web client goes through
// the Data API, and shows dates as it gives them.

let dir: string;
let server: Server;
let base: string;
let store: Store;
let auth: Record<string, string>;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-dmy-'));
  const path = join(dir, 'Days' + STORE_EXT);
  createStore(path);
  const db = new DatabaseSync(path);
  db.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'dateOrder'").run(JSON.stringify('DMY'));
  db.close();
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Days')!;
  assert.equal(store.dateOrder, 'DMY');
  store.applyDesign([
    { op: 'createTable', name: 'Events', fields: [{ name: 'Name' }, { name: 'Day', type: 'date' }, { name: 'At', type: 'timestamp' }, { name: 'Pick', type: 'date', options: { global: true } }] },
  ] as DesignOp[]);
  store.create('Events', { Name: 'early', Day: '2026-10-11' });
  store.create('Events', { Name: 'late', Day: '2026-11-10' });
  store.setPassword('Admin', 'pw', '[Full Access]');
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Days/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  auth = { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
});
after(() => {
  server?.close();
  // The server may still be closing its files when this runs, so a first try can find the folder not yet empty.
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const api = async (method: string, path: string, body?: unknown) =>
  (await fetch(`${base}/fmi/data/vLatest/databases/Days${path}`, { method, headers: auth, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
const stored = (name: string, field = 'Day') => store.find('Events', { query: [{ Name: `==${name}` }], dateFormat: 'iso' }).records[0].fieldData[field];

test('Data API: dates written are read as MM/DD/YYYY, as they are given, not in the file\'s day-first order', async () => {
  const made = await api('POST', '/layouts/Events/records', { fieldData: { Name: 'made', Day: '11/10/2026', At: '11/10/2026 9:30:00' } });
  assert.equal(made.messages[0].code, '0', JSON.stringify(made));
  assert.equal(stored('made'), '2026-11-10');
  assert.equal(stored('made', 'At'), '2026-11-10T09:30:00');
  const read = await api('GET', `/layouts/Events/records/${made.response.recordId}`);
  assert.equal(read.response.data[0].fieldData.Day, '11/10/2026', 'given back as it was sent');

  await api('PATCH', `/layouts/Events/records/${made.response.recordId}`, { fieldData: { Day: '12/1/2026' } });
  assert.equal(stored('made'), '2026-12-01');
  // ISO dates read as ISO.
  await api('PATCH', `/layouts/Events/records/${made.response.recordId}`, { fieldData: { Day: '2026-03-04' } });
  assert.equal(stored('made'), '2026-03-04');
  // dateformats 1 (the file's order) gives dates as MM/DD/YYYY too, so it reads them that way as well.
  await api('PATCH', `/layouts/Events/records/${made.response.recordId}`, { fieldData: { Day: '11/10/2026' }, dateformats: 1 });
  assert.equal(stored('made'), '2026-11-10');
  store.delete('Events', Number(made.response.recordId));
});

test('Data API: find criteria read dates as MM/DD/YYYY too', async () => {
  const names = async (body: Record<string, unknown>) => {
    const r = await api('POST', '/layouts/Events/_find', body);
    return (r.response.data ?? []).map((x: { fieldData: { Name: string } }) => x.fieldData.Name).sort();
  };
  assert.deepEqual(await names({ query: [{ Day: '11/10/2026' }] }), ['late']);
  assert.deepEqual(await names({ query: [{ Day: '10/11/2026' }] }), ['early']);
  assert.deepEqual(await names({ query: [{ Day: '10/1/2026...10/31/2026' }] }), ['early']);
  assert.deepEqual(await names({ query: [{ Day: '>10/31/2026' }] }), ['late']);
  assert.deepEqual(await names({ query: [{ Day: '11/10/2026' }], dateformats: 1 }), ['late']);
});

test('Data API: a global date field set for the session reads MM/DD/YYYY', async () => {
  const r = await api('PATCH', '/globals', { globalFields: { 'Events::Pick': '11/10/2026' } });
  assert.equal(r.messages[0].code, '0', JSON.stringify(r));
  const got = await api('POST', '/layouts/Events/_find', { query: [{ Name: '==late' }], dateformats: 2 });
  assert.equal(got.response.data[0].fieldData.Pick, '2026-11-10');
});

test('web client: find requests typed in find mode read dates as the client shows them', async () => {
  const button = async (body: Record<string, unknown>) =>
    (await fetch(`${base}/tabularius/app/v1/databases/Days/layouts/Events/button`, { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
  const all = store.findIds('Events');
  const nameOf = (id: number) => store.get('Events', id).fieldData.Name;
  const r = await button({ command: 'Constrain Found Set', ids: all, mode: 'find', requests: [{ criteria: { Day: '11/10/2026' }, omit: false }] });
  assert.equal(r.error, 0, r.message);
  assert.deepEqual(r.foundSet.map(nameOf), ['late']);
  const range = await button({ command: 'Constrain Found Set', ids: all, mode: 'find', requests: [{ criteria: { Day: '10/1/2026...10/31/2026' }, omit: false }] });
  assert.deepEqual(range.foundSet.map(nameOf), ['early']);
  const dashes = await button({ command: 'Constrain Found Set', ids: all, mode: 'find', requests: [{ criteria: { Day: '11-10-2026' }, omit: false }] });
  assert.deepEqual(dashes.foundSet.map(nameOf), ['late']);
  // A found set the client names by its find (no ids) is made by that find, read the same way.
  const late = all.find((id) => nameOf(id) === 'late')!;
  const shown = await button({ command: 'Omit Record', query: [{ Day: '11/10/2026' }], recordId: late, mode: 'browse' });
  assert.equal(shown.error, 0, shown.message);
  assert.deepEqual(shown.foundSet, [], 'the find gave the 10 November record alone, and it was omitted');
});

test('web client: Replace Field Contents puts in the date as typed, as the client shows dates', async () => {
  const made = store.create('Events', { Name: 'replace', Day: '2026-01-02' }).recordId;
  try {
    const r = await (await fetch(`${base}/tabularius/app/v1/databases/Days/layouts/Events/button`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ command: 'Replace Field Contents', field: 'Day', value: '11/10/2026', ids: [made], recordId: made, mode: 'browse' }),
    })).json();
    assert.equal(r.error, 0, r.message);
    assert.equal(stored('replace'), '2026-11-10');
  } finally {
    store.delete('Events', made);
  }
});
