// The response shape of every Data API endpoint Tabularius supports, key by key,
// as Claris's FileMaker Data API Guide (help.claris.com/en/data-api-guide)
// describes them; docs/data-api-compatibility.md lists each endpoint and what
// is supported, partial or missing. The database is built here, with no
// .fmp12, so these run without the downloaded samples:
//   Contacts (with a global, a container and a value list) and their Calls,
//   shown in a portal; a layout in a folder; a script that echoes its parameter.
import { test, before, after, mock } from 'node:test';
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

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-shapes-'));
  createStore(join(dir, 'Shapes' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = s.server;
  base = s.url;
  store = s.host.get('Shapes')!;
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [
      { name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Status' }, { name: 'Kind' }, { name: 'Tags' },
      { name: 'Met', type: 'date' }, { name: 'Secret' }, { name: 'Photo', type: 'container' },
      { name: 'gToday', type: 'date', options: { global: true } },
    ] },
    { op: 'createTable', name: 'Calls', fields: [{ name: 'ContactId', type: 'number' }, { name: 'Note' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Calls', predicates: [{ left: 'Id', right: 'ContactId' }] },
    { op: 'createValueList', name: 'Statuses', values: ['Active', 'Inactive'] },
    { op: 'createScript', name: 'Echo', text: 'Exit Script [ Get ( ScriptParameter ) ]' },
  ] as DesignOp[]);
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
  const fieldId = (table: string, name: string) => store.schema.tables.find((t) => t.name === table)!.fields.find((f) => f.name === name)!.id;
  const statuses = store.schema.valueLists.find((v) => v.name === 'Statuses')!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  let top = 0;
  let id = 100;
  const field = (table: string, name: string, display: string, extra: Record<string, unknown> = {}): LayoutObject => ({
    id: ++id, kind: 'field', type: 1, anchors, style: {}, bounds: { top: top += 24, left: 20, bottom: top + 20, right: 300 },
    field: { tableOccurrenceId: occ(table).id, fieldId: fieldId(table, name), tableOccurrence: table, field: name, display, repetitions: 1, ...extra },
  } as LayoutObject);
  const objects: LayoutObject[] = [
    field('Contacts', 'Id', 'edit'),
    field('Contacts', 'Name', 'edit'),
    field('Contacts', 'Status', 'dropdown', { valueListId: statuses }),
    field('Contacts', 'Kind', 'radio', { valueListId: statuses }),
    field('Contacts', 'Tags', 'checkbox', { valueListId: statuses }),
    field('Contacts', 'Met', 'calendar'),
    field('Contacts', 'Secret', 'edit', { behavior: { concealed: true } }),
    field('Contacts', 'Photo', 'edit'),
    {
      id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 300, left: 20, bottom: 400, right: 300 },
      portal: { tableOccurrenceId: occ('Calls').id, tableOccurrence: 'Calls', rows: 4, initialRow: 1 },
      children: [field('Calls', 'Note', 'edit')],
    } as LayoutObject,
  ];
  store.applyDesign([
    // The generated Contacts form, replaced: its fields shown in different ways, and the Calls portal.
    { op: 'updateLayout', layout: 'Contacts', design: { objects, tableView: [] } },
    { op: 'setOrder', list: 'layouts', order: [{ folder: 'People', children: [{ item: 'Contacts' }] }, { item: 'Calls' }] },
  ] as DesignOp[]);
  for (let i = 1; i <= 3; i++) store.create('Contacts', { Id: i, Name: `Contact ${i}`, Status: 'Active', Met: '01/0' + i + '/2026' });
  store.create('Calls', { ContactId: 1, Note: 'First call' });
  store.create('Calls', { ContactId: 1, Note: 'Second call' });
  store.setPassword('Admin', 'pw', '[Full Access]');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

interface Reply { status: number; headers: Headers; body: { response: Record<string, any>; messages: { code: string; message: string }[] } }

async function call(path: string, init: { method?: string; auth?: string; body?: unknown; raw?: boolean } = {}): Promise<Reply> {
  const json = init.body !== undefined && !(init.body instanceof FormData);
  const res = await fetch(`${base}/fmi/data/vLatest${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.auth ? { authorization: init.auth } : {}), ...(json ? { 'content-type': 'application/json' } : {}) },
    body: init.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
  });
  return { status: res.status, headers: res.headers, body: await res.json() as Reply['body'] };
}

/** A successful reply: HTTP 200, code "0" and "OK", and a response with exactly these keys. */
function ok(r: Reply, keys: string[]): Record<string, any> {
  assert.equal(r.status, 200, JSON.stringify(r.body.messages));
  assert.deepEqual(r.body.messages, [{ code: '0', message: 'OK' }]);
  assert.deepEqual(Object.keys(r.body.response).sort(), [...keys].sort());
  return r.body.response;
}

/** A failed reply: this HTTP status, this FileMaker error code, an empty response. */
function failed(r: Reply, status: number, code: string): void {
  assert.equal(r.status, status, JSON.stringify(r.body.messages));
  assert.equal(r.body.messages.length, 1);
  assert.equal(r.body.messages[0].code, code);
  assert.equal(typeof r.body.messages[0].message, 'string');
  assert.deepEqual(r.body.response, {});
}

/** Exactly these keys on an object. */
function keys(o: Record<string, unknown>, expected: string[], what: string): void {
  assert.deepEqual(Object.keys(o).sort(), [...expected].sort(), what);
}

const DATA_INFO = ['database', 'layout', 'table', 'totalRecordCount', 'foundCount', 'returnedCount'];
const RECORD = ['fieldData', 'portalData', 'recordId', 'modId'];
const PORTAL_INFO = ['portalObjectName', 'database', 'table', 'foundCount', 'returnedCount'];
const FIELD_META = ['name', 'type', 'displayType', 'result', 'global', 'autoEnter', 'fourDigitYear', 'maxRepeat', 'maxCharacters',
  'notEmpty', 'numeric', 'timeOfDay', 'repetitionStart', 'repetitionEnd', 'repetitions'];

async function login(): Promise<string> {
  const r = await call('/databases/Shapes/sessions', { method: 'POST', auth: 'Basic ' + btoa('Admin:pw'), body: {} });
  return `Bearer ${ok(r, ['token']).token}`;
}

/** A found set's reply: dataInfo with its counts as numbers, and records with ids as strings. */
function foundSet(r: Reply, layout: string, found: number, returned: number): Record<string, any>[] {
  const res = ok(r, ['dataInfo', 'data']);
  keys(res.dataInfo, DATA_INFO, 'dataInfo');
  assert.equal(res.dataInfo.database, 'Shapes');
  assert.equal(res.dataInfo.layout, layout);
  assert.equal(res.dataInfo.table, 'Contacts');
  assert.equal(res.dataInfo.foundCount, found);
  assert.equal(res.dataInfo.returnedCount, returned);
  assert.equal(typeof res.dataInfo.totalRecordCount, 'number');
  assert.equal(res.data.length, returned);
  for (const rec of res.data) {
    keys(rec, [...RECORD, 'portalDataInfo'], 'record');
    assert.equal(typeof rec.recordId, 'string');
    assert.equal(typeof rec.modId, 'string');
    for (const info of rec.portalDataInfo) keys(info, PORTAL_INFO, 'portalDataInfo');
    for (const rows of Object.values(rec.portalData) as Record<string, unknown>[][]) {
      for (const row of rows) {
        assert.equal(typeof row.recordId, 'string');
        assert.equal(typeof row.modId, 'string');
      }
    }
  }
  return res.data;
}

test('sessions: log in, the token header, log out', async () => {
  const r = await call('/databases/Shapes/sessions', { method: 'POST', auth: 'Basic ' + btoa('Admin:pw'), body: {} });
  const { token } = ok(r, ['token']);
  assert.equal(r.headers.get('x-fm-data-access-token'), token);
  assert.match(r.headers.get('content-type')!, /^application\/json/);
  failed(await call('/databases/Shapes/sessions', { method: 'POST', auth: 'Basic ' + btoa('Admin:nope'), body: {} }), 401, '212');
  ok(await call(`/databases/Shapes/sessions/${token}`, { method: 'DELETE' }), []);
  failed(await call('/databases/Shapes/layouts', { auth: `Bearer ${token}` }), 401, '952');
});

test('validateSession: answers for a live token, and doesn\'t keep it alive', async () => {
  const auth = await login();
  assert.equal(typeof ok(await call('/validateSession', { auth }), ['isSessionInUse']).isSessionInUse, 'boolean');
  failed(await call('/validateSession', { auth: 'Bearer nope' }), 401, '952');
  // A token lapses after 15 minutes without a call; checking it isn't a call.
  let elapsed = performance.now();
  mock.method(performance, 'now', () => elapsed);
  try {
    elapsed += 14 * 60_000;
    ok(await call('/validateSession', { auth }), ['isSessionInUse']);
    elapsed += 2 * 60_000;
    failed(await call('/validateSession', { auth }), 401, '952');
  } finally {
    mock.restoreAll();
  }
});

test('productInfo and databases', async () => {
  const info = ok(await call('/productInfo'), ['productInfo']).productInfo;
  keys(info, ['name', 'buildDate', 'version', 'dateFormat', 'timeFormat', 'timeStampFormat'], 'productInfo');
  for (const v of Object.values(info)) assert.equal(typeof v, 'string');
  const { databases } = ok(await call('/databases'), ['databases']);
  assert.deepEqual(databases, [{ name: 'Shapes' }]);
});

test('layouts and scripts: names, in folders', async () => {
  const auth = await login();
  const { layouts } = ok(await call('/databases/Shapes/layouts', { auth }), ['layouts']);
  const folder = layouts.find((l: { name: string }) => l.name === 'People');
  keys(folder, ['name', 'isFolder', 'folderLayoutNames'], 'layout folder');
  assert.equal(folder.isFolder, true);
  assert.deepEqual(folder.folderLayoutNames, [{ name: 'Contacts', table: 'Contacts' }]);
  assert.deepEqual(layouts.find((l: { name: string }) => l.name === 'Calls'), { name: 'Calls', table: 'Calls' });

  const { scripts } = ok(await call('/databases/Shapes/scripts', { auth }), ['scripts']);
  assert.deepEqual(scripts, [{ name: 'Echo', isFolder: false }]);
});

test('layout metadata: fieldMetaData, portalMetaData and valueLists, with each field\'s display type', async () => {
  const auth = await login();
  const meta = ok(await call('/databases/Shapes/layouts/Contacts', { auth }), ['fieldMetaData', 'portalMetaData', 'valueLists']);
  for (const f of meta.fieldMetaData) keys(f, FIELD_META, `fieldMetaData ${f.name}`);
  const shown = Object.fromEntries(meta.fieldMetaData.map((f: { name: string; displayType: string }) => [f.name, f.displayType]));
  assert.deepEqual(shown, {
    Id: 'editText', Name: 'editText', Status: 'popupList', Kind: 'radioButtons', Tags: 'checkBox',
    Met: 'calendar', Secret: 'secureText', Photo: 'editText', gToday: 'editText',
  });
  const byName = (n: string) => meta.fieldMetaData.find((f: { name: string }) => f.name === n);
  assert.equal(byName('Met').result, 'date');
  assert.equal(byName('Photo').result, 'container');
  assert.equal(byName('gToday').global, true);
  keys(meta.portalMetaData, ['Calls'], 'portalMetaData');
  for (const f of meta.portalMetaData.Calls) keys(f, FIELD_META, `portal field ${f.name}`);
  assert.deepEqual(meta.portalMetaData.Calls.map((f: { name: string }) => f.name), ['Calls::Note']);
  assert.deepEqual(meta.valueLists, [{ name: 'Statuses', type: 'customList', values: [{ value: 'Active', displayValue: 'Active' }, { value: 'Inactive', displayValue: 'Inactive' }] }]);
  failed(await call('/databases/Shapes/layouts/Nope', { auth }), 500, '105');
});

test('layout metadata follows field access: a hidden portal field is left out, a masked one is text', async () => {
  const set = (fields: Record<string, 'none' | 'masked'>) => store.savePrivilegeSet({
    name: 'Callers', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
    extendedPrivileges: ['fmrest'], tables: { Calls: { view: true, edit: true, create: true, delete: true, fields } },
  });
  set({ Note: 'none' });
  store.setPassword('Caller', 'pw', 'Callers');
  const signIn = async () => `Bearer ${ok(await call('/databases/Shapes/sessions', { method: 'POST', auth: 'Basic ' + btoa('Caller:pw'), body: {} }), ['token']).token}`;
  try {
    let auth = await signIn();
    const hidden = ok(await call('/databases/Shapes/layouts/Contacts', { auth }), ['fieldMetaData', 'portalMetaData', 'valueLists']);
    assert.deepEqual(hidden.portalMetaData.Calls, [], 'the portal\'s only field is hidden');
    // Its values are left out of the records too, so the metadata matches what a read gives.
    const rows = foundSet(await call('/databases/Shapes/layouts/Contacts/records', { auth }), 'Contacts', 3, 3).find((r) => r.fieldData.Id === 1)!.portalData.Calls;
    assert.ok(rows.every((r: Record<string, unknown>) => !('Calls::Note' in r)));
    set({ Note: 'masked' });
    assert.equal((await call('/databases/Shapes/layouts/Contacts', { auth })).status, 401, 'the changed set ended the session');
    auth = await signIn();
    const masked = ok(await call('/databases/Shapes/layouts/Contacts', { auth }), ['fieldMetaData', 'portalMetaData', 'valueLists']);
    assert.deepEqual(masked.portalMetaData.Calls.map((f: { name: string; result: string }) => [f.name, f.result]), [['Calls::Note', 'text']]);
  } finally {
    store.deleteAccount('Caller');
  }
});

test('records: a range, one record, and portal rows with portalDataInfo', async () => {
  const auth = await login();
  const all = foundSet(await call('/databases/Shapes/layouts/Contacts/records', { auth }), 'Contacts', 3, 3);
  const first = all.find((r) => r.fieldData.Id === 1)!;
  assert.equal(first.portalData.Calls.length, 2);
  keys(first.portalData.Calls[0], ['recordId', 'modId', 'Calls::Note'], 'portal row');
  assert.deepEqual(first.portalDataInfo, [{ portalObjectName: 'Calls', database: 'Shapes', table: 'Calls', foundCount: 2, returnedCount: 2 }]);

  // _offset, _limit, _sort and per-portal paging.
  const sort = encodeURIComponent(JSON.stringify([{ fieldName: 'Id', sortOrder: 'descend' }]));
  const page = foundSet(await call(`/databases/Shapes/layouts/Contacts/records?_offset=2&_limit=2&_sort=${sort}&_limit.Calls=1`, { auth }), 'Contacts', 3, 2);
  assert.deepEqual(page.map((r) => r.fieldData.Id), [2, 1]);
  assert.deepEqual(page[1].portalDataInfo[0], { portalObjectName: 'Calls', database: 'Shapes', table: 'Calls', foundCount: 2, returnedCount: 1 });

  const one = foundSet(await call(`/databases/Shapes/layouts/Contacts/records/${first.recordId}`, { auth }), 'Contacts', 1, 1);
  assert.equal(one[0].recordId, first.recordId);
  // dateformats=2: ISO 8601 dates.
  const iso = foundSet(await call(`/databases/Shapes/layouts/Contacts/records/${first.recordId}?dateformats=2`, { auth }), 'Contacts', 1, 1);
  assert.equal(iso[0].fieldData.Met, '2026-01-01');
  failed(await call('/databases/Shapes/layouts/Contacts/records/99999', { auth }), 500, '101');
});

test('records: bad _sort, _offset and _limit are error 960, not an unknown error', async () => {
  const auth = await login();
  failed(await call('/databases/Shapes/layouts/Contacts/records?_sort=not-json', { auth }), 400, '960');
  failed(await call(`/databases/Shapes/layouts/Contacts/records?_sort=${encodeURIComponent('{"fieldName":"Id"}')}`, { auth }), 400, '960');
  failed(await call('/databases/Shapes/layouts/Contacts/records?_offset=0', { auth }), 400, '960');
  failed(await call('/databases/Shapes/layouts/Contacts/records?_limit=abc', { auth }), 400, '960');
  failed(await call('/databases/Shapes/layouts/Contacts/_find', { method: 'POST', auth, body: { query: [{ Name: 'Contact' }], limit: -1 } }), 400, '960');
  failed(await call('/databases/Shapes/layouts/Contacts/_find', { method: 'POST', auth, body: { query: [{ Name: 'Contact' }], sort: 'Id' } }), 400, '960');
});

test('records: create (with portal rows), edit, duplicate, delete', async () => {
  const auth = await login();
  const L = '/databases/Shapes/layouts/Contacts/records';
  // Create with portalData: the record and its related rows, as the guide's Create a record allows.
  const made = ok(await call(L, { method: 'POST', auth, body: { fieldData: { Id: 10, Name: 'New' }, portalData: { Calls: [{ 'Calls::Note': 'Welcome call' }] } } }), ['recordId', 'modId']);
  assert.equal(typeof made.recordId, 'string');
  assert.equal(typeof made.modId, 'string');
  const back = foundSet(await call(`${L}/${made.recordId}`, { auth }), 'Contacts', 1, 1)[0];
  assert.deepEqual(back.portalData.Calls.map((r: Record<string, string>) => r['Calls::Note']), ['Welcome call']);
  assert.equal(back.modId, made.modId);

  const edited = ok(await call(`${L}/${made.recordId}`, { method: 'PATCH', auth, body: { fieldData: { Name: 'Renamed' }, modId: made.modId } }), ['modId']);
  assert.equal(typeof edited.modId, 'string');
  failed(await call(`${L}/${made.recordId}`, { method: 'PATCH', auth, body: { fieldData: { Name: 'Stale' }, modId: made.modId } }), 500, '306');

  const dup = ok(await call(`${L}/${made.recordId}`, { method: 'POST', auth, body: {} }), ['recordId', 'modId']);
  assert.notEqual(dup.recordId, made.recordId);

  ok(await call(`${L}/${dup.recordId}`, { method: 'DELETE', auth }), []);
  ok(await call(`${L}/${made.recordId}`, { method: 'DELETE', auth }), []);
  failed(await call(`${L}/${made.recordId}`, { auth }), 500, '101');
});

test('records: a create whose portal rows are refused leaves no record behind', async () => {
  const auth = await login();
  const L = '/databases/Shapes/layouts/Contacts/records';
  const total = async () => (await call(`${L}?_limit=1`, { auth })).body.response.dataInfo.totalRecordCount;
  const before = await total();
  const r = await call(L, { method: 'POST', auth, body: { fieldData: { Id: 11, Name: 'Half made' }, portalData: { Calls: [{ 'Calls::NoSuchField': 'x' }] } } });
  assert.notEqual(r.status, 200, JSON.stringify(r.body.messages));
  assert.equal(await total(), before);
});

test('find: dataInfo and data, and error 401 when nothing matches', async () => {
  const auth = await login();
  const F = '/databases/Shapes/layouts/Contacts/_find';
  const found = foundSet(await call(F, { method: 'POST', auth, body: { query: [{ Name: 'Contact' }, { Id: '3', omit: 'true' }], sort: [{ fieldName: 'Id', sortOrder: 'ascend' }], offset: 1, limit: 10 } }), 'Contacts', 2, 2);
  assert.deepEqual(found.map((r) => r.fieldData.Id), [1, 2]);
  // portal names the portals to return; offset.<portal> and limit.<portal> page them.
  const narrow = foundSet(await call(F, { method: 'POST', auth, body: { query: [{ Id: '1' }], portal: ['Calls'], 'limit.Calls': 1 } }), 'Contacts', 1, 1);
  assert.equal(narrow[0].portalData.Calls.length, 1);
  failed(await call(F, { method: 'POST', auth, body: { query: [{ Name: 'Nobody' }] } }), 500, '401');
  failed(await call(F, { method: 'POST', auth, body: {} }), 400, '10');
});

test('globals, scripts and container upload', async () => {
  const auth = await login();
  ok(await call('/databases/Shapes/globals', { method: 'PATCH', auth, body: { globalFields: { 'Contacts::gToday': '10/13/2026' } } }), []);
  failed(await call('/databases/Shapes/globals', { method: 'PATCH', auth, body: {} }), 400, '958');

  const run = ok(await call('/databases/Shapes/layouts/Contacts/script/Echo?script.param=hello', { auth }), ['scriptResult', 'scriptError']);
  assert.deepEqual(run, { scriptResult: 'hello', scriptError: '0' });
  // Scripts with another request: each phase's result and error beside the request's own response.
  const withScripts = ok(await call('/databases/Shapes/layouts/Contacts/records?_limit=1&script=Echo&script.param=after&script.prerequest=Echo&script.prerequest.param=before&script.presort=Echo&script.presort.param=sort', { auth }),
    ['dataInfo', 'data', 'scriptResult', 'scriptError', 'scriptResult.prerequest', 'scriptError.prerequest', 'scriptResult.presort', 'scriptError.presort']);
  assert.equal(withScripts['scriptResult.prerequest'], 'before');
  assert.equal(withScripts['scriptResult.presort'], 'sort');
  assert.equal(withScripts.scriptResult, 'after');

  const id = (await call('/databases/Shapes/layouts/Contacts/records?_limit=1', { auth })).body.response.data[0].recordId;
  const form = new FormData();
  form.append('upload', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'dot.png');
  ok(await call(`/databases/Shapes/layouts/Contacts/records/${id}/containers/Photo/1`, { method: 'POST', auth, body: form }), []);
  const photo = (await call(`/databases/Shapes/layouts/Contacts/records/${id}`, { auth })).body.response.data[0].fieldData.Photo;
  assert.equal(typeof photo, 'string');
  assert.ok(photo.length > 0, 'a URL to the uploaded file');
});

test('errors: an unknown path or method answers in the same envelope', async () => {
  const auth = await login();
  const unknown = await call('/databases/Shapes/nothing', { auth });
  assert.equal(unknown.status, 404);
  assert.notEqual(unknown.body.messages[0].code, '0');
  assert.deepEqual(unknown.body.response, {});
  const put = await call('/databases/Shapes/layouts/Contacts/records', { method: 'PUT', auth, body: {} });
  assert.ok(put.status >= 400);
  assert.deepEqual(put.body.response, {});
});
