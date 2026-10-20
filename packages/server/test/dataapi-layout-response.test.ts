import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

// layout.response (the guide's Get records, Get a record and Perform a find): the request's layout finds and
// sorts the records, and they come back with the fields of the response layout.

let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-layout-response-'));
  createStore(join(dir, 'R' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('R')!;
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Name' }, { name: 'Status' }] },
    { op: 'createTable', name: 'Calls', fields: [{ name: 'Note' }] },
    { op: 'createLayout', name: 'Contact Status', occurrence: 'Contacts' },
  ] as DesignOp[]);
  const occ = store.schema.tableOccurrences.find((t) => t.name === 'Contacts')!;
  const fieldId = (name: string) => store.schema.tables.find((t) => t.name === 'Contacts')!.fields.find((f) => f.name === name)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const field = (id: number, name: string) => ({
    id, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 20, left: 20, bottom: 40, right: 300 },
    field: { tableOccurrenceId: occ.id, fieldId: fieldId(name), tableOccurrence: 'Contacts', field: name, display: 'edit', repetitions: 1 },
  }) as unknown as LayoutObject;
  store.applyDesign([
    { op: 'updateLayout', layout: 'Contacts', design: { objects: [field(101, 'Name')], tableView: [] } },
    { op: 'updateLayout', layout: 'Contact Status', design: { objects: [field(102, 'Status')], tableView: [] } },
  ] as DesignOp[]);
  store.create('Contacts', { Name: 'Bea', Status: 'open' });
  store.create('Contacts', { Name: 'Al', Status: 'closed' });
  store.setPassword('Admin', 'pw', '[Full Access]');
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function call(path: string, auth: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}/fmi/data/vLatest${path}`, { method, headers: { authorization: auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

let token: string | undefined;
async function auth(): Promise<string> {
  token ??= 'Bearer ' + (await call('/databases/R/sessions', 'Basic ' + btoa('Admin:pw'), 'POST', {})).body.response.token;
  return token;
}

const L = '/databases/R/layouts/Contacts';
const resp = 'layout.response=' + encodeURIComponent('Contact Status');

test('Get records sorts on the request layout and answers with the response layout', async () => {
  const r = await call(`${L}/records?_sort=${encodeURIComponent(JSON.stringify([{ fieldName: 'Name', sortOrder: 'ascend' }]))}&${resp}`, await auth());
  assert.equal(r.status, 200, JSON.stringify(r.body.messages));
  assert.deepEqual(r.body.response.data.map((x: any) => x.fieldData), [{ Status: 'closed' }, { Status: 'open' }]);
  assert.equal(r.body.response.dataInfo.layout, 'Contact Status');
  assert.equal(r.body.response.dataInfo.foundCount, 2);
  // Without it, the request layout's own fields.
  const plain = await call(`${L}/records`, await auth());
  assert.deepEqual(plain.body.response.data.map((x: any) => x.fieldData), [{ Name: 'Bea' }, { Name: 'Al' }]);
  assert.equal(plain.body.response.dataInfo.layout, 'Contacts');
});

test('Get a record answers with the response layout', async () => {
  const id = store.find('Contacts', {}).records[0].recordId;
  const r = await call(`${L}/records/${id}?${resp}`, await auth());
  assert.equal(r.status, 200, JSON.stringify(r.body.messages));
  assert.deepEqual(r.body.response.data[0].fieldData, { Status: 'open' });
  assert.equal(r.body.response.dataInfo.layout, 'Contact Status');
});

test('Perform a find queries the request layout and answers with the response layout', async () => {
  const r = await call(`${L}/_find`, await auth(), 'POST', { query: [{ Name: 'Al' }], 'layout.response': 'Contact Status' });
  assert.equal(r.status, 200, JSON.stringify(r.body.messages));
  assert.deepEqual(r.body.response.data.map((x: any) => x.fieldData), [{ Status: 'closed' }]);
  assert.equal(r.body.response.dataInfo.layout, 'Contact Status');
  assert.equal(r.body.response.dataInfo.foundCount, 1);
});

test('a missing response layout is 105, and one on another table is a bad parameter', async () => {
  const missing = await call(`${L}/records?layout.response=Nope`, await auth());
  assert.equal(missing.body.messages[0].code, '105');
  const other = await call(`${L}/_find`, await auth(), 'POST', { query: [{ Name: 'Al' }], 'layout.response': 'Calls' });
  assert.equal(other.status, 400);
  assert.equal(other.body.messages[0].code, '960');
});
