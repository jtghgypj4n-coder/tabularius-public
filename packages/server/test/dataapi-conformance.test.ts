import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Store } from '../../store/src/index.ts';

// The Data API checked against Claris's FileMaker Data API Guide
// (help.claris.com/en/data-api-guide), section by section: paths, the
// {response, messages} envelope, types (codes, recordId and modId are
// strings; counts are numbers), HTTP statuses and FileMaker error codes,
// paging parameters (with and without underscores), scripts with requests,
// portals, globals and container uploads. Where the guide is silent, the
// behaviour follows FileMaker Server as client libraries (python-fmrest,
// fmdapi, FMData) record it.
const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const files = { Charts: 'Charts.fmp12', IM: 'InterMediator_TestDB.fmp12', Drawers: 'DEMO_drawers.fmp12' };
const skip = Object.values(files).every((f) => existsSync(join(fixtures, f))) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let stores: Record<string, Store>;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-conformance-'));
  for (const [name, file] of Object.entries(files)) copyFileSync(join(fixtures, file), join(dir, `${name}.fmp12`));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = s.server;
  base = s.url;
  stores = Object.fromEntries(Object.keys(files).map((n) => [n, s.host.get(n)!]));
  for (const store of Object.values(stores)) {
    store.setPassword('Admin', 'pw');
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  }
  stores.Charts.applyDesign([
    { op: 'createScript', name: 'Echo', text: 'Exit Script [ Get ( ScriptParameter ) ]' },
    { op: 'createScript', name: 'Fail', text: 'Go to Layout [ "Congress" ]\nEnter Find Mode [ Pause: Off ]\nSet Field [ Congress::Name ; "zzzzzz" ]\nPerform Find [ ]\nExit Script [ "done" ]' },
  ]);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

interface Reply { status: number; headers: Headers; body: { response: Record<string, any>; messages: { code: string; message: string }[] } }

async function call(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; version?: string } = {}): Promise<Reply> {
  const res = await fetch(`${base}/fmi/data/${init.version ?? 'vLatest'}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.body !== undefined && typeof init.body !== 'string' && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.body === undefined ? undefined : init.body instanceof FormData || typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });
  const body = await res.json() as Reply['body'];
  return { status: res.status, headers: res.headers, body };
}

/** Every answer has the envelope: messages with string codes, and a response object ({} on errors). */
function envelope(r: Reply, code = '0'): void {
  assert.deepEqual(Object.keys(r.body).sort(), ['messages', 'response']);
  assert.equal(typeof r.body.messages[0].code, 'string');
  assert.equal(r.body.messages[0].code, code, r.body.messages[0].message);
  if (code === '0') {
    assert.equal(r.status, 200);
    assert.equal(r.body.messages[0].message, 'OK');
  } else assert.deepEqual(r.body.response, {});
}

async function login(db: string): Promise<Record<string, string>> {
  const r = await call(`/databases/${db}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') }, body: {} });
  return { authorization: `Bearer ${r.body.response.token}` };
}

test('sessions: log in, validate, log out (guide: log-in, validate, log-out)', { skip }, async () => {
  const r = await call('/databases/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') }, body: {} });
  envelope(r);
  const token = r.body.response.token;
  assert.equal(typeof token, 'string');
  assert.equal(r.headers.get('x-fm-data-access-token'), token);
  // An empty body works too.
  envelope(await call('/databases/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } }));

  const bad = await call('/databases/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:wrong') }, body: {} });
  assert.equal(bad.status, 401);
  envelope(bad, '212');

  const valid = await call('/validateSession', { headers: { authorization: `Bearer ${token}` } });
  envelope(valid);
  assert.equal(typeof valid.body.response.isSessionInUse, 'boolean');

  // Log out names the token in the path, with no Authorization header.
  envelope(await call(`/databases/Charts/sessions/${token}`, { method: 'DELETE' }));
  const gone = await call('/databases/Charts/layouts', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(gone.status, 401);
  envelope(gone, '952');
  const none = await call('/databases/Charts/layouts');
  assert.equal(none.status, 401);
  envelope(none, '952');
  assert.equal((await call('/validateSession', { headers: { authorization: 'Bearer nope' } })).status, 401);

  // v1 and v2 answer the same.
  envelope(await call('/databases/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') }, body: {}, version: 'v1' }));
  envelope(await call('/databases/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') }, body: {}, version: 'v2' }));
});

test('metadata: product info, databases, layouts, scripts, layout metadata', { skip }, async () => {
  const info = await call('/productInfo');
  envelope(info);
  const p = info.body.response.productInfo;
  for (const k of ['name', 'buildDate', 'version', 'dateFormat', 'timeFormat', 'timeStampFormat']) assert.equal(typeof p[k], 'string', k);
  assert.match(p.version, /^\d+\.\d+\.\d+/, 'a real version, not "0"');
  assert.equal(p.dateFormat, 'MM/dd/yyyy');
  assert.equal(p.timeFormat, 'HH:mm:ss');
  assert.equal(p.timeStampFormat, 'MM/dd/yyyy HH:mm:ss');

  const dbs = await call('/databases');
  envelope(dbs);
  assert.deepEqual(dbs.body.response.databases.map((d: { name: string }) => d.name).sort(), ['Charts', 'Drawers', 'IM']);
  for (const d of dbs.body.response.databases) assert.deepEqual(Object.keys(d), ['name']);

  const auth = await login('Charts');
  const layouts = await call('/databases/Charts/layouts', { headers: auth });
  envelope(layouts);
  const walk = (list: { name: string; isFolder?: boolean; folderLayoutNames?: unknown[] }[]): void => {
    for (const l of list) {
      assert.equal(typeof l.name, 'string');
      if (l.isFolder) walk(l.folderLayoutNames as typeof list);
      else assert.equal(l.isFolder ?? false, false);
    }
  };
  walk(layouts.body.response.layouts);

  const scripts = await call('/databases/Charts/scripts', { headers: auth });
  envelope(scripts);
  const walkScripts = (list: { name: string; isFolder: boolean; folderScriptNames?: unknown[] }[]): void => {
    for (const s of list) {
      assert.equal(typeof s.isFolder, 'boolean', `isFolder on ${s.name}`);
      if (s.isFolder) walkScripts(s.folderScriptNames as typeof list);
    }
  };
  walkScripts(scripts.body.response.scripts);

  const meta = await call('/databases/Charts/layouts/Congress', { headers: auth });
  envelope(meta);
  const field = meta.body.response.fieldMetaData.find((f: { name: string }) => f.name === 'Name');
  assert.ok(field);
  for (const k of ['global', 'autoEnter', 'fourDigitYear', 'notEmpty', 'numeric', 'timeOfDay']) assert.equal(typeof field[k], 'boolean', k);
  for (const k of ['maxRepeat', 'maxCharacters', 'repetitionStart', 'repetitionEnd']) assert.equal(typeof field[k], 'number', k);
  assert.ok(['normal', 'calculation', 'summary'].includes(field.type));
  assert.ok(['text', 'number', 'date', 'time', 'timeStamp', 'container'].includes(field.result));
  assert.equal(typeof field.displayType, 'string');
  assert.equal(typeof meta.body.response.portalMetaData, 'object');
  assert.ok(!Array.isArray(meta.body.response.portalMetaData));
  // Value lists are listed when the layout uses any.
  if ('valueLists' in meta.body.response) assert.ok(Array.isArray(meta.body.response.valueLists));

  const missing = await call('/databases/Charts/layouts/Nope', { headers: auth });
  assert.equal(missing.status, 500);
  envelope(missing, '105');
});

test('records: range, one record, create, edit, duplicate, delete', { skip }, async () => {
  const auth = await login('Charts');
  const L = '/databases/Charts/layouts/Congress';

  // A range: 1-based offset, default limit 100, counts as numbers, ids as strings.
  const range = await call(`${L}/records`, { headers: auth });
  envelope(range);
  const info = range.body.response.dataInfo;
  assert.deepEqual(Object.keys(info).sort(), ['database', 'foundCount', 'layout', 'returnedCount', 'table', 'totalRecordCount']);
  assert.equal(info.database, 'Charts');
  assert.equal(info.layout, 'Congress');
  assert.equal(info.returnedCount, 100);
  assert.equal(typeof info.totalRecordCount, 'number');
  assert.equal(info.foundCount, info.totalRecordCount);
  const rec = range.body.response.data[0];
  for (const k of ['fieldData', 'portalData', 'recordId', 'modId']) assert.ok(k in rec, k);
  assert.equal(typeof rec.recordId, 'string');
  assert.equal(typeof rec.modId, 'string');
  assert.deepEqual(rec.portalData, {});
  // Numbers as JSON numbers, text as strings.
  assert.equal(typeof rec.fieldData.District, 'number');
  assert.equal(typeof rec.fieldData.Name, 'string');

  const page = await call(`${L}/records?_offset=3&_limit=2&_sort=${encodeURIComponent(JSON.stringify([{ fieldName: 'Name', sortOrder: 'descend' }]))}`, { headers: auth });
  envelope(page);
  assert.equal(page.body.response.data.length, 2);
  const all = await call(`${L}/records?_limit=1000&_sort=${encodeURIComponent(JSON.stringify([{ fieldName: 'Name', sortOrder: 'descend' }]))}`, { headers: auth });
  assert.deepEqual(page.body.response.data.map((r: { recordId: string }) => r.recordId), all.body.response.data.slice(2, 4).map((r: { recordId: string }) => r.recordId));

  const one = await call(`${L}/records/${rec.recordId}`, { headers: auth });
  envelope(one);
  assert.equal(one.body.response.data.length, 1);
  assert.equal(one.body.response.dataInfo.foundCount, 1);
  assert.equal(one.body.response.dataInfo.returnedCount, 1);

  const missing = await call(`${L}/records/999999`, { headers: auth });
  assert.equal(missing.status, 500);
  envelope(missing, '101');

  // Create: recordId and modId "0" as strings.
  const made = await call(`${L}/records`, { method: 'POST', headers: auth, body: { fieldData: { Name: 'Conformance', District: 99 } } });
  envelope(made);
  assert.deepEqual(Object.keys(made.body.response).sort(), ['modId', 'recordId']);
  assert.equal(made.body.response.modId, '0');
  const id = made.body.response.recordId;
  assert.equal(typeof id, 'string');
  envelope(await call(`${L}/records`, { method: 'POST', headers: auth, body: { fieldData: {} } }));
  const unknown = await call(`${L}/records`, { method: 'POST', headers: auth, body: { fieldData: { Nope: 1 } } });
  assert.equal(unknown.status, 500);
  envelope(unknown, '102');

  // Edit: answers the new modId; a stale modId changes nothing.
  const edited = await call(`${L}/records/${id}`, { method: 'PATCH', headers: auth, body: { fieldData: { State: 'Nowhere' }, modId: '0' } });
  envelope(edited);
  assert.deepEqual(edited.body.response, { modId: '1' });
  const stale = await call(`${L}/records/${id}`, { method: 'PATCH', headers: auth, body: { fieldData: { State: 'Elsewhere' }, modId: '0' } });
  assert.equal(stale.status, 500);
  envelope(stale, '306');
  assert.equal((await call(`${L}/records/${id}`, { headers: auth })).body.response.data[0].fieldData.State, 'Nowhere');

  // Duplicate: a new record, modId "0".
  const dup = await call(`${L}/records/${id}`, { method: 'POST', headers: auth, body: {} });
  envelope(dup);
  assert.equal(dup.body.response.modId, '0');
  assert.notEqual(dup.body.response.recordId, id);
  assert.equal((await call(`${L}/records/${dup.body.response.recordId}`, { headers: auth })).body.response.data[0].fieldData.State, 'Nowhere');

  // Delete: an empty response.
  const del = await call(`${L}/records/${id}`, { method: 'DELETE', headers: auth });
  envelope(del);
  assert.deepEqual(del.body.response, {});
  envelope(await call(`${L}/records/${id}`, { headers: auth }), '101');
});

test('find: query and omit requests, body keys without underscores, no matches', { skip }, async () => {
  const auth = await login('Charts');
  const L = '/databases/Charts/layouts/Congress';
  const texas = Number(stores.Charts.query("SELECT count(*) AS n FROM Congress WHERE State = 'Texas'")[0].n);
  const texasR = Number(stores.Charts.query("SELECT count(*) AS n FROM Congress WHERE State = 'Texas' AND Party = 'R'")[0].n);

  const found = await call(`${L}/_find`, {
    method: 'POST', headers: auth,
    body: { query: [{ State: '==Texas' }, { Party: '==D', omit: 'true' }], sort: [{ fieldName: 'District', sortOrder: 'ascend' }], limit: '5', offset: '1' },
  });
  envelope(found);
  assert.equal(found.body.response.dataInfo.foundCount, texasR);
  assert.equal(found.body.response.dataInfo.returnedCount, 5);
  assert.ok(texasR < texas);
  const districts = found.body.response.data.map((r: { fieldData: { District: number } }) => r.fieldData.District);
  assert.deepEqual(districts, [...districts].sort((a: number, b: number) => a - b));
  // Numbers work as well as strings.
  assert.equal((await call(`${L}/_find`, { method: 'POST', headers: auth, body: { query: [{ State: '==Texas' }], limit: 3, offset: 2 } })).body.response.data.length, 3);

  const none = await call(`${L}/_find`, { method: 'POST', headers: auth, body: { query: [{ Name: 'zzzzzz' }] } });
  assert.equal(none.status, 500);
  envelope(none, '401');
  const noQuery = await call(`${L}/_find`, { method: 'POST', headers: auth, body: {} });
  assert.notEqual(noQuery.body.messages[0].code, '0');
});

test('scripts: run on a layout, and with requests (prerequest, presort, after)', { skip }, async () => {
  const auth = await login('Charts');
  const L = '/databases/Charts/layouts/Congress';
  const run = await call(`${L}/script/Echo?script.param=hello`, { headers: auth });
  envelope(run);
  assert.deepEqual(run.body.response, { scriptResult: 'hello', scriptError: '0' });

  // A script's error is not an HTTP error: 200, code "0", the error in scriptError.
  const fail = await call(`${L}/script/Fail`, { headers: auth });
  envelope(fail);
  assert.notEqual(fail.body.response.scriptError, '0');
  assert.equal(typeof fail.body.response.scriptError, 'string');

  // GET takes the script keys in the query string; POST and PATCH in the body.
  const withGet = await call(`${L}/records?_limit=1&script=Echo&script.param=a&script.prerequest=Echo&script.prerequest.param=b&script.presort=Echo&script.presort.param=c`, { headers: auth });
  envelope(withGet);
  const r = withGet.body.response;
  assert.equal(r.scriptResult, 'a');
  assert.equal(r['scriptResult.prerequest'], 'b');
  assert.equal(r['scriptResult.presort'], 'c');
  assert.equal(r.scriptError, '0');
  assert.equal(r['scriptError.prerequest'], '0');
  assert.equal(r['scriptError.presort'], '0');
  assert.equal(r.data.length, 1);

  const withFind = await call(`${L}/_find`, { method: 'POST', headers: auth, body: { query: [{ State: '==Texas' }], script: 'Echo', 'script.param': 'found' } });
  envelope(withFind);
  assert.equal(withFind.body.response.scriptResult, 'found');

  const withCreate = await call(`${L}/records`, { method: 'POST', headers: auth, body: { fieldData: { Name: 'x' }, script: 'Echo', 'script.param': 'made' } });
  envelope(withCreate);
  assert.equal(withCreate.body.response.scriptResult, 'made');
  const withDelete = await call(`${L}/records/${withCreate.body.response.recordId}?script=Echo&script.param=gone`, { method: 'DELETE', headers: auth });
  envelope(withDelete);
  assert.equal(withDelete.body.response.scriptResult, 'gone');

  // A missing script is a script error too.
  const missing = await call(`${L}/script/Nope`, { headers: auth });
  envelope(missing);
  assert.equal(missing.body.response.scriptError, '104');
});

test('portals: rows, paging per portal, portalDataInfo, editing rows', { skip }, async () => {
  const auth = await login('IM');
  const L = '/databases/IM/layouts/person_layout';
  const all = await call(`${L}/records?_limit=1`, { headers: auth });
  envelope(all);
  const rec = all.body.response.data[0];
  assert.ok(Array.isArray(rec.portalData.Contact));
  const row = rec.portalData.Contact[0];
  assert.equal(typeof row.recordId, 'string');
  assert.equal(typeof row.modId, 'string');
  assert.ok(Object.keys(row).some((k) => k.includes('::')));
  const infos = rec.portalDataInfo as { database: string; table: string; foundCount: number; returnedCount: number; portalObjectName?: string }[];
  assert.ok(Array.isArray(infos));
  const contact = infos.find((i) => (i.portalObjectName ?? i.table) === 'Contact')!;
  assert.ok(contact, JSON.stringify(infos));
  assert.equal(contact.database, 'IM');
  assert.equal(typeof contact.foundCount, 'number');
  assert.equal(contact.returnedCount, rec.portalData.Contact.length);

  // Only the portals asked for; _offset.<portal> is 1-based, _limit.<portal> caps rows.
  const one = await call(`${L}/records/${rec.recordId}?portal=${encodeURIComponent('["Contact"]')}&_offset.Contact=2&_limit.Contact=1`, { headers: auth });
  envelope(one);
  assert.deepEqual(Object.keys(one.body.response.data[0].portalData), ['Contact']);
  assert.equal(one.body.response.data[0].portalData.Contact.length, 1);
  assert.equal(one.body.response.data[0].portalData.Contact[0].recordId, rec.portalData.Contact[1].recordId);

  // Find bodies name portal paging without underscores.
  const found = await call(`${L}/_find`, { method: 'POST', headers: auth, body: { query: [{ id: `==${rec.fieldData.id}` }], portal: ['Contact'], 'limit.Contact': 1, 'offset.Contact': 1 } });
  envelope(found);
  assert.equal(found.body.response.data[0].portalData.Contact.length, 1);

  // Editing a portal row by recordId.
  const field = Object.keys(row).find((k) => k.endsWith('::summary'))!;
  const edited = await call(`${L}/records/${rec.recordId}`, { method: 'PATCH', headers: auth, body: { fieldData: {}, portalData: { Contact: [{ recordId: row.recordId, [field]: 'Conformance' }] } } });
  envelope(edited);
  const after = await call(`${L}/records/${rec.recordId}`, { headers: auth });
  assert.equal(after.body.response.data[0].portalData.Contact.find((r: { recordId: string }) => r.recordId === row.recordId)[field], 'Conformance');
});

test('globals and container upload', { skip }, async () => {
  const auth = await login('Drawers');
  const g = stores.Drawers.schema.tables.flatMap((t) => t.fields.filter((f) => f.options?.global && f.type === 'text').map((f) => `${t.name}::${f.name}`))[0];
  if (g) {
    const set = await call('/databases/Drawers/globals', { method: 'PATCH', headers: auth, body: { globalFields: { [g]: 'Hello' } } });
    envelope(set);
    assert.deepEqual(set.body.response, {});
  }
  const bad = await call('/databases/Drawers/globals', { method: 'PATCH', headers: auth, body: { globalFields: { 'Nope::Nope': 'x' } } });
  assert.notEqual(bad.body.messages[0].code, '0');

  const L = '/databases/Drawers/layouts/RECORD';
  const id = (await call(`${L}/records?_limit=1`, { headers: auth })).body.response.data[0].recordId;
  const form = new FormData();
  form.append('upload', new Blob(['hi'], { type: 'text/plain' }), 'hi.txt');
  const up = await call(`${L}/records/${id}/containers/field_container_01/1`, { method: 'POST', headers: auth, body: form });
  envelope(up);
  assert.deepEqual(up.body.response, {});
  // The repetition is optional.
  const form2 = new FormData();
  form2.append('upload', new Blob(['hi'], { type: 'text/plain' }), 'hi.txt');
  envelope(await call(`${L}/records/${id}/containers/field_container_01`, { method: 'POST', headers: auth, body: form2 }));
  // A body without an "upload" part.
  const form3 = new FormData();
  form3.append('file', new Blob(['hi'], { type: 'text/plain' }), 'hi.txt');
  const wrong = await call(`${L}/records/${id}/containers/field_container_01`, { method: 'POST', headers: auth, body: form3 });
  envelope(wrong, '960');
});

test('errors: unsupported methods, bad JSON, missing records and layouts', { skip }, async () => {
  const auth = await login('Charts');
  const badJson = await call('/databases/Charts/layouts/Congress/records', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{"fieldData": ' });
  assert.ok(badJson.status >= 400);
  assert.notEqual(badJson.body.messages[0].code, '0');
  assert.deepEqual(badJson.body.response, {});
  const missingLayout = await call('/databases/Charts/layouts/Nope/records', { headers: auth });
  assert.equal(missingLayout.status, 500);
  envelope(missingLayout, '105');
  const method = await call('/databases/Charts/layouts/Congress/records', { method: 'PUT', headers: auth, body: {} });
  assert.ok(method.status === 405 || method.status === 404, String(method.status));
  assert.notEqual(method.body.messages[0].code, '0');
  const db = await call('/databases/Nope/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') }, body: {} });
  assert.notEqual(db.body.messages[0].code, '0');
});
