// Request bodies whose JSON has the wrong shape: a field value that is an object, a find with a null request,
// fieldData that is an array. Each gets a FileMaker-style error answer and stores nothing. The database is built
// here with no .fmp12.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { serializeDataApiResponse } from '../src/dataapi.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let store: Store;
let token: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-bodies-'));
  createStore(join(dir, 'Bodies' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Bodies')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [
      { name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Met', type: 'date' },
      { name: 'A', options: { global: true } }, { name: 'B', type: 'number', options: { global: true } },
    ] },
    { op: 'createTable', name: 'Calls', fields: [{ name: 'ContactId', type: 'number' }, { name: 'Note' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Calls', predicates: [{ left: 'Id', right: 'ContactId' }] },
    { op: 'createScript', name: 'Echo', text: 'Exit Script [ Get ( ScriptParameter ) ]' },
  ] as DesignOp[]);
  // The generated Contacts form, with the Calls portal added.
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
  const fieldId = (table: string, name: string) => store.schema.tables.find((t) => t.name === table)!.fields.find((f) => f.name === name)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  let top = 0;
  let id = 100;
  const field = (table: string, name: string): LayoutObject => ({
    id: ++id, kind: 'field', type: 1, anchors, style: {}, bounds: { top: top += 24, left: 20, bottom: top + 20, right: 300 },
    field: { tableOccurrenceId: occ(table).id, fieldId: fieldId(table, name), tableOccurrence: table, field: name, display: 'edit', repetitions: 1 },
  } as LayoutObject);
  const objects: LayoutObject[] = [
    field('Contacts', 'Id'), field('Contacts', 'Name'), field('Contacts', 'Met'), field('Contacts', 'A'), field('Contacts', 'B'),
    {
      id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 300, left: 20, bottom: 400, right: 300 },
      portal: { tableOccurrenceId: occ('Calls').id, tableOccurrence: 'Calls', rows: 4, initialRow: 1 },
      children: [field('Calls', 'Note')],
    } as LayoutObject,
  ];
  store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects, tableView: [] } }] as DesignOp[]);
  for (let i = 1; i <= 4; i++) store.create('Contacts', { Id: i, Name: `Contact ${i}`, Met: `01/0${i}/2026` });
  for (const note of ['First', 'Second', 'Third']) store.create('Calls', { ContactId: 1, Note: note });
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.setPassword('Colon', 'pa:ss', '[Full Access]');
  token = await login('Admin', 'pw');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const api = (path: string) => `${base}/fmi/data/vLatest/databases/Bodies${path}`;

async function login(account: string, password: string, init: RequestInit = {}): Promise<string> {
  const r = await fetch(api('/sessions'), { method: 'POST', ...init, headers: { authorization: 'Basic ' + btoa(`${account}:${password}`), ...(init.headers as Record<string, string>) } });
  const body = await r.json() as { response: { token?: string }; messages: { code: string }[] };
  assert.equal(r.status, 200, JSON.stringify(body.messages));
  return body.response.token!;
}

interface Reply { status: number; body: { response: Record<string, any>; messages: { code: string; message: string }[] } }
async function send(path: string, init: { method?: string; body?: string; type?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  const r = await fetch(api(path), {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, ...(init.type ? { 'content-type': init.type } : {}), ...init.headers },
    body: init.body,
  });
  return { status: r.status, body: await r.json() as Reply['body'] };
}
const names = (r: Reply) => (r.body.response.data as { fieldData: { Name: string } }[]).map((d) => d.fieldData.Name);
const q = (o: Record<string, string>) => '?' + new URLSearchParams(o).toString();
const JSON_TYPE = 'application/json';

test('compat Data API responses use plain JSON serialization', () => {
  const stringify = JSON.stringify;
  const calls: number[] = [];
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
    calls.push(args.length);
    return stringify(...args);
  }) as typeof JSON.stringify;
  try {
    assert.equal(serializeDataApiResponse({ response: { value: 1 } }, false), '{"response":{"value":1}}');
    assert.deepEqual(calls, [1]);
  } finally { JSON.stringify = stringify; }
});

test('compat accepts duplicate JSON keys in Data API writes', async () => {
  const r = await send('/layouts/Contacts/records', { method: 'POST', type: JSON_TYPE, body: '{"fieldData":{"Name":"first","Name":"last"}}' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(store.get('Contacts', Number(r.body.response.recordId)).fieldData.Name, 'last');
});

test('compat OData keeps duplicate keys and rejects unquoted GUIDs without advertising IEEE754', async () => {
  const root = `${base}/fmi/odata/v4/Bodies/Contacts`;
  const auth = { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' };
  const made = await fetch(root, { method: 'POST', headers: auth, body: '{"Name":"first","Name":"last"}' });
  assert.equal(made.status, 201, await made.text());
  const read = await fetch(root, { headers: { ...auth, accept: 'application/json;IEEE754Compatible=true' } });
  assert.equal(read.status, 200);
  assert.doesNotMatch(read.headers.get('content-type') ?? '', /IEEE754Compatible/);
  const guid = await fetch(`${root}?$filter=${encodeURIComponent('Name eq aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')}`, { headers: auth });
  assert.equal(guid.status, 400);
});

test('compat wide record reads stay within about twice the main baseline', async (t) => {
  store.applyDesign([{ op: 'createTable', name: 'Wide', fields: Array.from({ length: 152 }, (_, i) => ({ name: `F${i}` })) }]);
  for (let i = 0; i < 1500; i++) store.create('Wide', { F0: String(i) });
  const started = performance.now();
  const r = await send('/layouts/Wide/records?_limit=1500');
  const elapsed = performance.now() - started;
  assert.equal(r.status, 200, JSON.stringify(r.body.messages));
  assert.equal(r.body.response.data.length, 1500);
  assert.ok(elapsed < 1400, `compat read took ${elapsed.toFixed(0)} ms, above the 1.4 s guard`);
  t.diagnostic(`compat 1500 x 152 read: ${elapsed.toFixed(1)} ms`);
});

async function patchGlobals(globalFields: Record<string, unknown>): Promise<Reply> {
  return send('/globals', { method: 'PATCH', type: JSON_TYPE, body: JSON.stringify({ globalFields }) });
}

async function readGlobals(): Promise<{ A: unknown; B: unknown }> {
  const id = store.findIds('Contacts')[0];
  const r = await send(`/layouts/Contacts/records/${id}`);
  assert.equal(r.body.messages[0].code, '0', JSON.stringify(r.body));
  const { A, B } = r.body.response.data[0].fieldData;
  return { A, B };
}

test('globals accepts text and number values in one PATCH', async () => {
  const r = await patchGlobals({ 'Contacts::A': 'original', 'Contacts::B': 42 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.messages[0].code, '0');
  assert.deepEqual(await readGlobals(), { A: 'original', B: 42 });
});

for (const value of [{}, [], true, null]) {
  test(`globals rejects a later value ${JSON.stringify(value)} with 960 and leaves all globals unchanged`, async () => {
    const initial = await patchGlobals({ 'Contacts::A': 'original', 'Contacts::B': 42 });
    assert.equal(initial.body.messages[0].code, '0', JSON.stringify(initial.body));
    const before = await readGlobals();
    const r = await patchGlobals({ 'Contacts::A': 'ok', 'Contacts::B': value });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.messages[0].code, '960');
    assert.deepEqual(await readGlobals(), before);
  });
}

test('a field value that is an object or an array is refused, and no record is made', async () => {
  const before = store.findIds('Contacts').length;
  const r = await send('/layouts/Contacts/records', { method: 'POST', type: JSON_TYPE, body: JSON.stringify({ fieldData: { Name: { a: 1 } } }) });
  assert.notEqual(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.messages[0].code, '960');
  assert.equal(store.findIds('Contacts').length, before);
  const arr = await send('/layouts/Contacts/records', { method: 'POST', type: JSON_TYPE, body: JSON.stringify({ fieldData: { Name: [1, 2] } }) });
  assert.equal(arr.body.messages[0].code, '960');
});

test('fieldData that is not an object is 960', async () => {
  const r = await send('/layouts/Contacts/records', { method: 'POST', type: JSON_TYPE, body: JSON.stringify({ fieldData: [1] }) });
  assert.equal(r.body.messages[0].code, '960', JSON.stringify(r.body));
  const s = await send('/layouts/Contacts/records', { method: 'POST', type: JSON_TYPE, body: JSON.stringify({ fieldData: 'x' }) });
  assert.equal(s.body.messages[0].code, '960');
});

test('a find whose query holds a null or a non-object request is an error answer, not a server error', async () => {
  const r = await send('/layouts/Contacts/_find', { method: 'POST', type: JSON_TYPE, body: JSON.stringify({ query: [null] }) });
  assert.notEqual(r.status, 500, JSON.stringify(r.body));
  assert.ok(['960', '102', '401'].includes(r.body.messages[0].code), JSON.stringify(r.body));
  const s = await send('/layouts/Contacts/_find', { method: 'POST', type: JSON_TYPE, body: JSON.stringify({ query: 'x' }) });
  assert.notEqual(s.status, 500, JSON.stringify(s.body));
});

test('an oversize body on sign-in is refused without a server error', async () => {
  const r = await fetch(api('/sessions'), { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': JSON_TYPE }, body: JSON.stringify({ pad: 'x'.repeat(3 * 1024 * 1024) }) }).catch(() => undefined);
  if (r) assert.notEqual(r.status, 500);
  assert.ok(await login('Admin', 'pw'), 'the server is still up');
});

test('fieldData.deleteRelated stays a list', async () => {
  const id = store.findIds('Contacts')[0];
  const r = await send(`/layouts/Contacts/records/${id}`, { method: 'PATCH', type: JSON_TYPE, body: JSON.stringify({ fieldData: { deleteRelated: [] } }) });
  assert.equal(r.body.messages[0].code, '0', JSON.stringify(r.body));
});

test('wrong shapes in a find criterion, portalData and deleteRelated answer 960 and change nothing', async () => {
  const id = store.findIds('Contacts')[0];
  const before = JSON.stringify(store.find('Contacts', { limit: 5 }).records);
  const cases: [string, string, string][] = [
    ['/layouts/Contacts/_find', 'POST', JSON.stringify({ query: [{ Name: { a: 1 } }] })],
    ['/layouts/Contacts/_find', 'POST', JSON.stringify({ query: [{ Name: ['x'] }] })],
    [`/layouts/Contacts/records/${id}`, 'PATCH', JSON.stringify({ portalData: 'x' })],
    [`/layouts/Contacts/records/${id}`, 'PATCH', JSON.stringify({ portalData: [1] })],
    [`/layouts/Contacts/records/${id}`, 'PATCH', JSON.stringify({ portalData: { Calls: { Note: 'x' } } })],
    [`/layouts/Contacts/records/${id}`, 'PATCH', JSON.stringify({ portalData: { Calls: ['x'] } })],
    [`/layouts/Contacts/records/${id}`, 'PATCH', JSON.stringify({ fieldData: { deleteRelated: [{ a: 1 }] } })],
    [`/layouts/Contacts/records/${id}`, 'PATCH', JSON.stringify({ fieldData: { deleteRelated: true } })],
  ];
  for (const [path, method, body] of cases) {
    const r = await send(path, { method, type: JSON_TYPE, body });
    assert.equal(r.status, 400, `${path} ${body}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.messages[0].code, '960', body);
  }
  assert.equal(JSON.stringify(store.find('Contacts', { limit: 5 }).records), before);
});

test('a text criterion, a number criterion and a portal row list are still accepted', async () => {
  const f = await send('/layouts/Contacts/_find', { method: 'POST', type: JSON_TYPE, body: JSON.stringify({ query: [{ Name: '*', Id: 1 }] }) });
  assert.notEqual(f.status, 400, JSON.stringify(f.body));
  const id = store.findIds('Contacts')[0];
  const e = await send(`/layouts/Contacts/records/${id}`, { method: 'PATCH', type: JSON_TYPE, body: JSON.stringify({ portalData: {}, fieldData: { deleteRelated: [] } }) });
  assert.equal(e.body.messages[0].code, '0', JSON.stringify(e.body));
});
