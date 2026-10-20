import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

// Deliberately small validator: the contract is data, and unknown protocol keys fail.
type Shape = { $ref?: string; type?: string | string[]; required?: string[]; properties?: Record<string, Shape>;
  extensions?: Record<string, Shape>; dynamic?: 'field' | 'relatedField' | 'portal'; values?: Shape;
  items?: Shape; minItems?: number; opaque?: boolean; scriptResults?: boolean };
type Contract = { envelope: Shape; definitions: Record<string, Shape>; endpoints: Record<string, { method: string; path: string; response: Shape }>;
  errorStatuses: Record<string, number[]>; notVerified: Record<string, unknown> };
const contract = JSON.parse(readFileSync(new URL('./dataapi-response-contract.json', import.meta.url), 'utf8')) as Contract;
const fields = new Set(['Id', 'Name', 'Photo', 'gNote']);
const relatedFields = new Set(['Calls::ContactId', 'Calls::Note']);
const portals = new Set(['Calls']);

function validate(value: unknown, shape: Shape, at = '$'): void {
  if (shape.$ref) return validate(value, contract.definitions[shape.$ref]!, at);
  const types = Array.isArray(shape.type) ? shape.type : [shape.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  assert.ok(types.includes(actual), `${at}: expected ${types.join('|')}, got ${actual}`);
  if (actual === 'array') {
    assert.ok((value as unknown[]).length >= (shape.minItems ?? 0), `${at}: too few items`);
    if (shape.items) (value as unknown[]).forEach((item, i) => validate(item, shape.items!, `${at}[${i}]`));
  }
  if (actual !== 'object' || shape.opaque) return;
  const object = value as Record<string, unknown>;
  for (const key of shape.required ?? []) assert.ok(Object.hasOwn(object, key), `${at}: missing ${key}`);
  for (const [key, item] of Object.entries(object)) {
    const declared = shape.properties?.[key] ?? shape.extensions?.[key]
      ?? (shape.scriptResults ? contract.definitions.scriptResults.properties?.[key] : undefined);
    if (declared) { validate(item, declared, `${at}.${key}`); continue; }
    const dynamic = shape.dynamic === 'field' ? fields.has(key)
      : shape.dynamic === 'relatedField' ? relatedFields.has(key)
      : shape.dynamic === 'portal' ? portals.has(key) : false;
    assert.ok(dynamic, `${at}: unlisted key ${key}`);
    validate(item, shape.values!, `${at}.${key}`);
  }
}

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-contract-'));
  createStore(join(dir, 'Contract' + STORE_EXT));
  const app = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = app.server;
  base = app.url;
  const store = app.host.get('Contract')!;
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [
      { name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Photo', type: 'container' },
      { name: 'gNote', options: { global: true } },
    ] },
    { op: 'createTable', name: 'Calls', fields: [{ name: 'ContactId', type: 'number' }, { name: 'Note' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Calls', predicates: [{ left: 'Id', right: 'ContactId' }] },
    { op: 'createScript', name: 'Echo', text: 'Exit Script [ Get ( ScriptParameter ) ]' },
  ]);
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
  const fieldId = (table: string, name: string) => store.schema.tables.find((t) => t.name === table)!.fields.find((f) => f.name === name)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  let objectId = 100;
  const field = (table: string, name: string): LayoutObject => ({
    id: ++objectId, kind: 'field', type: 1, anchors, style: {},
    bounds: { top: objectId * 20, left: 20, bottom: objectId * 20 + 18, right: 300 },
    field: { tableOccurrenceId: occ(table).id, fieldId: fieldId(table, name), tableOccurrence: table,
      field: name, display: 'edit', repetitions: 1 },
  } as LayoutObject);
  const objects: LayoutObject[] = ['Id', 'Name', 'Photo', 'gNote'].map((name) => field('Contacts', name));
  objects.push({ id: 900, kind: 'portal', type: 9, anchors, style: {},
    bounds: { top: 300, left: 20, bottom: 400, right: 300 },
    portal: { tableOccurrenceId: occ('Calls').id, tableOccurrence: 'Calls', rows: 4, initialRow: 1 },
    children: [field('Calls', 'Note')],
  } as LayoutObject);
  store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects, tableView: [] } }]);
  store.create('Contacts', { Id: 1, Name: 'Existing' });
  store.create('Calls', { ContactId: 1, Note: 'Related' });
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.savePrivilegeSet({ name: 'NoDataApi', records: { view: true, edit: true, create: true, delete: true },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] });
  store.setPassword('NoRest', 'pw', 'NoDataApi');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function call(path: string, method = 'GET', auth?: string, body?: unknown): Promise<{ status: number; body: any; headers: Headers }> {
  const multipart = body instanceof FormData;
  const response = await fetch(`${base}/fmi/data/vLatest${path}`, {
    method, headers: { ...(auth ? { authorization: auth } : {}), ...(body !== undefined && !multipart ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function check(reply: Awaited<ReturnType<typeof call>>, code: string, endpoint?: string): any {
  validate(reply.body, contract.envelope);
  assert.equal(reply.body.messages.length, 1);
  assert.equal(reply.body.messages[0].code, code, JSON.stringify(reply.body));
  if (code === '0') {
    assert.equal(reply.status, 200);
    assert.equal(reply.body.messages[0].message, 'OK');
    assert.ok(endpoint, 'success needs an endpoint schema');
    validate(reply.body.response, contract.endpoints[endpoint!].response);
  } else {
    assert.ok(contract.errorStatuses[code]?.includes(reply.status), `${code}: unexpected HTTP ${reply.status}`);
    validate(reply.body.response, contract.definitions.empty);
  }
  return reply.body.response;
}

test('every documented JSON endpoint follows its success response schema', async () => {
  const seen = new Set<string>();
  const success = async (id: string, path: string, method = 'GET', auth?: string, body?: unknown) => {
    const route = contract.endpoints[id];
    assert.ok(route, `missing schema for ${id}`);
    assert.equal(route.method, method);
    seen.add(id);
    return check(await call(path, method, auth, body), '0', id);
  };
  const login = await call('/databases/Contract/sessions', 'POST', 'Basic ' + btoa('Admin:pw'), {});
  seen.add('login');
  const token = check(login, '0', 'login').token as string;
  assert.equal(login.headers.get('x-fm-data-access-token'), token);
  const auth = `Bearer ${token}`;
  const root = '/databases/Contract';
  const layout = `${root}/layouts/Contacts`;
  const records = `${layout}/records`;
  await success('validateSession', '/validateSession', 'GET', auth);
  await success('productInfo', '/productInfo');
  await success('databases', '/databases');
  await success('layouts', `${root}/layouts`, 'GET', auth);
  await success('scripts', `${root}/scripts`, 'GET', auth);
  await success('layoutMetadata', layout, 'GET', auth);
  const range = await success('range', `${records}?script=Echo&script.param=after&script.prerequest=Echo&script.prerequest.param=before&script.presort=Echo&script.presort.param=sort`, 'GET', auth);
  assert.equal(range['scriptResult.prerequest'], 'before');
  assert.equal(range['scriptResult.presort'], 'sort');
  assert.equal(range.scriptResult, 'after');
  const id = range.data[0].recordId as string;
  assert.equal(range.data[0].portalData.Calls[0]['Calls::Note'], 'Related');
  assert.equal(range.data[0].portalDataInfo[0].portalObjectName, 'Calls');
  await success('single', `${records}/${id}`, 'GET', auth);
  const created = await success('create', records, 'POST', auth, { fieldData: { Id: 2, Name: 'Created' } });
  await success('edit', `${records}/${created.recordId}`, 'PATCH', auth, { fieldData: { Name: 'Edited' } });
  const duplicate = await success('duplicate', `${records}/${created.recordId}`, 'POST', auth, {});
  await success('delete', `${records}/${duplicate.recordId}`, 'DELETE', auth);
  await success('find', `${layout}/_find`, 'POST', auth, { query: [{ Name: 'Existing' }] });
  await success('globals', `${root}/globals`, 'PATCH', auth, { globalFields: { 'Contacts::gNote': 'hello' } });
  const form = new FormData();
  form.append('upload', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' }), 'tiny.bin');
  await success('upload', `${records}/${id}/containers/Photo/1`, 'POST', auth, form);
  await success('runScript', `${layout}/script/Echo?script.param=hello`, 'GET', auth);
  await success('logout', `${root}/sessions/${token}`, 'DELETE');
  assert.deepEqual([...seen].sort(), Object.keys(contract.endpoints).sort(), 'every verified endpoint must be exercised');
});

test('common documented errors use the empty response envelope and stated HTTP status', async () => {
  const login = check(await call('/databases/Contract/sessions', 'POST', 'Basic ' + btoa('Admin:pw'), {}), '0', 'login');
  const auth = `Bearer ${login.token}`;
  const root = '/databases/Contract';
  const layout = `${root}/layouts/Contacts`;
  const records = `${layout}/records`;
  const first = check(await call(records, 'GET', auth), '0', 'range').data[0];
  const cases: [string, string, string, string?, unknown?][] = [
    ['3', `${root}/no-such-route`, 'GET', auth],
    ['10', `${layout}/_find`, 'POST', auth, {}],
    ['101', `${records}/99999999`, 'GET', auth],
    ['102', `${records}/${first.recordId}`, 'PATCH', auth, { fieldData: { MissingField: 'x' } }],
    ['105', `${root}/layouts/NoSuchLayout`, 'GET', auth],
    ['9', `${root}/sessions`, 'POST', 'Basic ' + btoa('NoRest:pw'), {}],
    ['212', `${root}/sessions`, 'POST', 'Basic ' + btoa('Admin:wrong'), {}],
    ['306', `${records}/${first.recordId}`, 'PATCH', auth, { fieldData: { Name: 'No change' }, modId: '999999' }],
    ['401', `${layout}/_find`, 'POST', auth, { query: [{ Name: 'No such value anywhere' }] }],
    ['802', '/databases/NotHosted/sessions', 'POST', 'Basic ' + btoa('Admin:pw'), {}],
    ['952', `${root}/layouts`, 'GET', 'Bearer invalid'],
    ['958', `${root}/globals`, 'PATCH', auth, {}],
    ['960', `${records}?_limit=invalid`, 'GET', auth],
  ];
  for (const [code, path, method, authorization, body] of cases) {
    const reply = await call(path, method, authorization, body);
    check(reply, code);
    if (code === '9') assert.equal(typeof reply.body['tabularius:denial']?.explanation, 'string');
  }
});

test('contract rejects unlisted keys and wrong nested types', () => {
  assert.throws(() => validate({ token: 'x', invented: true }, contract.endpoints.login.response), /unlisted key invented/);
  assert.throws(() => validate({ token: 2 }, contract.endpoints.login.response), /expected string/);
  assert.throws(() => validate({ response: {}, messages: [{ code: 0, message: 'bad' }] }, contract.envelope), /expected string/);
  assert.throws(() => validate({ fieldData: { Name: 'A' }, portalData: {}, recordId: '1', modId: '0', invented: true }, contract.definitions.record), /unlisted key invented/);
  assert.throws(() => validate({ fieldData: { Bogus: 'A' }, portalData: {}, recordId: '1', modId: '0' }, contract.definitions.record), /unlisted key Bogus/);
});
