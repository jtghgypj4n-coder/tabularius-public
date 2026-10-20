// The requests that community FileMaker Data API client libraries (the Python,
// Ruby, JavaScript and PHP ones) send, written out by hand as they are in each
// library's published documentation: JSON-text query parameters, numbers sent
// as strings, a body sent without a JSON content type, trailing slashes, a
// token sent as a Bearer header. Each is a request a FileMaker Server answers
// and a client library depends on; none of the libraries' code is used. The
// database is built here with no .fmp12 (Contacts and their Calls, in a portal).
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

let dir: string;
let server: Server;
let base: string;
let store: Store;
let token: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-clients-'));
  createStore(join(dir, 'Clients' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = s.server;
  base = s.url;
  store = s.host.get('Clients')!;
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Met', type: 'date' }] },
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
    field('Contacts', 'Id'), field('Contacts', 'Name'), field('Contacts', 'Met'),
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

const api = (path: string) => `${base}/fmi/data/vLatest/databases/Clients${path}`;

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

test('signing in: no body and no content type, an empty JSON body, a password with a colon, and signing out without a header', async () => {
  assert.ok(await login('Admin', 'pw'));
  assert.ok(await login('Admin', 'pw', { body: '{}', headers: { 'content-type': JSON_TYPE } }));
  assert.ok(await login('Admin', 'pw', { body: '{}', headers: { 'content-type': 'application/json; charset=utf-8' } }));
  assert.ok(await login('Colon', 'pa:ss'));
  const t = await login('Admin', 'pw');
  const out = await fetch(api(`/sessions/${t}`), { method: 'DELETE' });
  assert.equal(out.status, 200);
  assert.equal(((await out.json()) as Reply['body']).messages[0].code, '0');
  const again = await send('/layouts', { headers: { authorization: `Bearer ${t}` } });
  assert.equal(again.body.messages[0].code, '952');
});

test('a token in a lower-case or Bearer header, and the X-FM-Data-Access-Token header', async () => {
  assert.equal((await send('/layouts', { headers: { authorization: `bearer ${token}` } })).body.messages[0].code, '0');
  const r = await fetch(api('/layouts'), { headers: { 'X-FM-Data-Access-Token': token } });
  assert.equal(((await r.json()) as Reply['body']).messages[0].code, '0');
});

test('listing records: _offset and _limit as query text, _sort as JSON text, with and without sortOrder', async () => {
  const page = await send('/layouts/Contacts/records' + q({ _offset: '2', _limit: '2' }));
  assert.deepEqual(names(page), ['Contact 2', 'Contact 3']);
  assert.equal(page.body.response.dataInfo.returnedCount, 2);
  assert.equal(page.body.response.dataInfo.totalRecordCount, 4);
  const down = await send('/layouts/Contacts/records' + q({ _sort: JSON.stringify([{ fieldName: 'Name', sortOrder: 'descend' }]) }));
  assert.deepEqual(names(down), ['Contact 4', 'Contact 3', 'Contact 2', 'Contact 1']);
  const up = await send('/layouts/Contacts/records' + q({ _sort: JSON.stringify([{ fieldName: 'Name' }]) }));
  assert.deepEqual(names(up), ['Contact 1', 'Contact 2', 'Contact 3', 'Contact 4']);
  const dated = await send('/layouts/Contacts/records' + q({ _limit: '1', dateformats: '2' }));
  assert.match(String(dated.body.response.data[0].fieldData.Met), /^2026-01-01/);
});

test('portals: portal as JSON text, with a limit and an offset for that portal', async () => {
  const r = await send('/layouts/Contacts/records' + q({ _limit: '1', portal: '["Calls"]', '_limit.Calls': '2', '_offset.Calls': '2' }));
  assert.equal(r.body.messages[0].code, '0', JSON.stringify(r.body.messages));
  const rows = r.body.response.data[0].portalData.Calls as Record<string, string>[];
  assert.deepEqual(rows.map((x) => x['Calls::Note']), ['Second', 'Third']);
  assert.equal(r.body.response.data[0].portalDataInfo?.[0]?.foundCount ?? 3, 3);
});

test('finding: limit and offset as numbers or as text, sort, several requests, omit as text or boolean', async () => {
  const find = (body: unknown, type: string | undefined = JSON_TYPE) => send('/layouts/Contacts/_find', { method: 'POST', body: JSON.stringify(body), type });
  const two = await find({ query: [{ Name: 'Contact 1' }, { Name: 'Contact 3' }] });
  assert.deepEqual(names(two).sort(), ['Contact 1', 'Contact 3']);
  const text = await find({ query: [{ Id: '>0' }], limit: '2', offset: '2', sort: [{ fieldName: 'Name', sortOrder: 'descend' }] });
  assert.deepEqual(names(text), ['Contact 3', 'Contact 2']);
  const numbers = await find({ query: [{ Id: '>0' }], limit: 2, offset: 2, sort: [{ fieldName: 'Name', sortOrder: 'descend' }] });
  assert.deepEqual(names(numbers), ['Contact 3', 'Contact 2']);
  const omitText = await find({ query: [{ Id: '>0' }, { Name: 'Contact 2', omit: 'true' }] });
  assert.equal(names(omitText).includes('Contact 2'), false);
  const omitBool = await find({ query: [{ Id: '>0' }, { Name: 'Contact 2', omit: true }] });
  assert.equal(names(omitBool).includes('Contact 2'), false);
  // A reply that found nothing is error 401 with the HTTP status FileMaker uses.
  const none = await find({ query: [{ Name: 'Nobody' }] });
  assert.equal(none.body.messages[0].code, '401');
  assert.equal(none.status, 500);
  // A body sent as text/plain (what a plain fetch or an unconfigured HTTP library sends) is still read.
  const plain = await find({ query: [{ Name: 'Contact 4' }] }, 'text/plain;charset=UTF-8');
  assert.deepEqual(names(plain), ['Contact 4']);
  const bare = await find({ query: [{ Name: 'Contact 4' }] }, undefined);
  assert.deepEqual(names(bare), ['Contact 4']);
  // dateformats, as a number in a find body, as text.
  const iso = await find({ query: [{ Id: '1' }], dateformats: 2 });
  assert.match(String(iso.body.response.data[0].fieldData.Met), /^2026-01-01/);
  const isoText = await find({ query: [{ Id: '1' }], dateformats: '2' });
  assert.match(String(isoText.body.response.data[0].fieldData.Met), /^2026-01-01/);
});

test('creating and editing: numbers as numbers or as text, an empty fieldData, modId as text or number', async () => {
  const body = (b: unknown) => JSON.stringify(b);
  const made = await send('/layouts/Contacts/records', { method: 'POST', body: body({ fieldData: { Id: '9', Name: 'Nine' } }), type: JSON_TYPE });
  assert.equal(made.body.messages[0].code, '0', JSON.stringify(made.body.messages));
  const id = made.body.response.recordId as string;
  assert.equal(typeof id, 'string');
  const modId = made.body.response.modId as string;
  assert.equal(typeof modId, 'string');
  const typed = await send(`/layouts/Contacts/records/${id}`, { method: 'PATCH', body: body({ fieldData: { Id: 90 }, modId }), type: JSON_TYPE });
  assert.equal(typed.body.messages[0].code, '0', JSON.stringify(typed.body.messages));
  const numberModId = await send(`/layouts/Contacts/records/${id}`, { method: 'PATCH', body: body({ fieldData: { Name: 'Ninety' }, modId: Number(typed.body.response.modId) }), type: JSON_TYPE });
  assert.equal(numberModId.body.messages[0].code, '0', JSON.stringify(numberModId.body.messages));
  const one = await send(`/layouts/Contacts/records/${id}`);
  assert.equal(one.body.response.data[0].fieldData.Id, 90);
  assert.equal(one.body.response.data[0].fieldData.Name, 'Ninety');
  // An empty fieldData makes a blank record.
  const blank = await send('/layouts/Contacts/records', { method: 'POST', body: body({ fieldData: {} }), type: JSON_TYPE });
  assert.equal(blank.body.messages[0].code, '0', JSON.stringify(blank.body.messages));
  // A stale modId is 306 whether it comes as text or as a number.
  const stale = await send(`/layouts/Contacts/records/${id}`, { method: 'PATCH', body: body({ fieldData: { Name: 'X' }, modId: '0' }), type: JSON_TYPE });
  assert.equal(stale.body.messages[0].code, '306');
  for (const rid of [id, blank.body.response.recordId]) await send(`/layouts/Contacts/records/${rid}`, { method: 'DELETE' });
});

test('running a script: script.param in the query, as text, as JSON text and empty', async () => {
  const run = (param?: string) => send('/layouts/Contacts/script/Echo' + (param === undefined ? '' : q({ 'script.param': param })));
  assert.equal((await run('hello')).body.response.scriptResult, 'hello');
  assert.equal((await run('{"a":1}')).body.response.scriptResult, '{"a":1}');
  assert.equal((await run()).body.response.scriptError, '0');
  const withRecords = await send('/layouts/Contacts/records' + q({ _limit: '1', script: 'Echo', 'script.param': 'after' }));
  assert.equal(withRecords.body.response.scriptResult, 'after');
});

test('paths: a trailing slash, an unknown layout, and the databases list without signing in', async () => {
  const slash = await send('/layouts/');
  assert.equal(slash.body.messages[0].code, '0', JSON.stringify(slash.body.messages));
  const records = await send('/layouts/Contacts/records/' + q({ _limit: '1' }));
  assert.equal(records.body.messages[0].code, '0', JSON.stringify(records.body.messages));
  const unknown = await send('/layouts/Nope/records');
  assert.equal(unknown.body.messages[0].code, '105');
  const list = await fetch(`${base}/fmi/data/vLatest/databases`);
  assert.equal(list.status, 200);
});

test('dateformats other than 0, 1 and 2 is error 960, in a query and in a body; globalFields that is not an object is 960, a missing one 958', async () => {
  for (const bad of ['7', '9', 'iso', '-1']) {
    const list = await send('/layouts/Contacts/records' + q({ dateformats: bad }));
    assert.equal(list.body.messages[0].code, '960', `list dateformats=${bad}`);
  }
  for (const good of ['0', '1', '2']) assert.equal((await send('/layouts/Contacts/records' + q({ dateformats: good, _limit: '1' }))).body.messages[0].code, '0');
  const find = await send('/layouts/Contacts/_find', { method: 'POST', type: JSON_TYPE, body: JSON.stringify({ query: [{ Name: 'Contact 1' }], dateformats: 9 }) });
  assert.equal(find.body.messages[0].code, '960');
  const made = await send('/layouts/Contacts/records', { method: 'POST', type: JSON_TYPE, body: JSON.stringify({ fieldData: { Name: 'Nope' }, dateformats: 7 }) });
  assert.equal(made.body.messages[0].code, '960');
  assert.equal((await send('/layouts/Contacts/records' + q({ _limit: '1' }))).body.response.dataInfo.totalRecordCount, 4);
  const notObject = await send('/globals', { method: 'PATCH', type: JSON_TYPE, body: JSON.stringify({ globalFields: 'x' }) });
  assert.equal(notObject.body.messages[0].code, '960');
  const missing = await send('/globals', { method: 'PATCH', type: JSON_TYPE, body: '{}' });
  assert.equal(missing.body.messages[0].code, '958');
});
