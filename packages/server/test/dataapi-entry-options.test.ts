import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';

// options.entrymode and options.prohibitmode on Create a record and Edit a record: "script" entry skips validation
// set to "Only during data entry" (not "Always"), and "script" prohibit mode may change fields that prohibit
// modification during data entry. Both default to "user".

let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-entry-options-'));
  createStore(join(dir, 'E' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('E')!;
  store.applyDesign([{ op: 'createTable', name: 'Orders', fields: [
    { name: 'Code', options: { validation: { notEmpty: true } } }, // only during data entry
    { name: 'Qty', type: 'number', options: { validation: { always: true, range: { min: '1', max: '10' } } } },
    { name: 'Locked', options: { autoEnter: { prohibitModification: true } } },
  ] }] as DesignOp[]);
  store.setPassword('Admin', 'pw', '[Full Access]');
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function call(path: string, method: string, body?: unknown): Promise<{ status: number; body: any }> {
  token ??= 'Bearer ' + (await (await fetch(`${base}/fmi/data/vLatest/databases/E/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}' })).json()).response.token;
  const r = await fetch(`${base}/fmi/data/vLatest${path}`, { method, headers: { authorization: token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
let token: string | undefined;

const L = '/databases/E/layouts/Orders/records';
const code = (r: { body: any }) => r.body.messages[0].code;

test('entrymode "script" skips "Only during data entry" validation but not "Always"', async () => {
  assert.equal(code(await call(L, 'POST', { fieldData: { Qty: 2 } })), '509');
  const made = await call(L, 'POST', { fieldData: { Qty: 2 }, options: { entrymode: 'script' } });
  assert.equal(made.status, 200, JSON.stringify(made.body.messages));
  assert.equal(code(await call(L, 'POST', { fieldData: { Code: 'A', Qty: 50 }, options: { entrymode: 'script' } })), '503');
  const id = made.body.response.recordId;
  assert.equal(code(await call(`${L}/${id}`, 'PATCH', { fieldData: { Code: '', Qty: 3 } })), '509');
  assert.equal((await call(`${L}/${id}`, 'PATCH', { fieldData: { Code: '', Qty: 3 }, options: { entrymode: 'script' } })).status, 200);
  assert.equal(store.get('Orders', Number(id)).fieldData.Qty, 3);
  assert.equal(code(await call(`${L}/${id}`, 'PATCH', { fieldData: { Qty: 30 }, options: { entrymode: 'script' } })), '503');
});

test('prohibitmode "script" may set a field that prohibits modification', async () => {
  assert.equal(code(await call(L, 'POST', { fieldData: { Code: 'B', Locked: 'x' } })), '201');
  const made = await call(L, 'POST', { fieldData: { Code: 'B', Locked: 'x' }, options: { prohibitmode: 'script' } });
  assert.equal(made.status, 200, JSON.stringify(made.body.messages));
  const id = made.body.response.recordId;
  // entrymode alone doesn't unlock it.
  assert.equal(code(await call(`${L}/${id}`, 'PATCH', { fieldData: { Locked: 'y' }, options: { entrymode: 'script' } })), '201');
  assert.equal((await call(`${L}/${id}`, 'PATCH', { fieldData: { Locked: 'y' }, options: { prohibitmode: 'script' } })).status, 200);
  assert.equal(store.get('Orders', Number(id)).fieldData.Locked, 'y');
});

test('an unknown mode is a bad parameter, and nothing is made', async () => {
  const before = store.findIds('Orders').length;
  const r = await call(L, 'POST', { fieldData: { Code: 'C' }, options: { entrymode: 'admin' } });
  assert.equal(r.status, 400);
  assert.equal(code(r), '960');
  assert.equal(store.findIds('Orders').length, before);
});
