import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, type Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { Api } from '../../web/src/api.ts';

let dir: string, base: string, server: Server, store: Store;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'import-privilege-first-'));
  createStore(join(dir, 'Target' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server; base = s.url; store = s.host.get('Target')!;
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Code' }] }]);
  store.setPassword('Admin', 'pw', '[Full Access]');
  for (const name of ['Viewer', 'Creator', 'Editor']) {
    store.savePrivilegeSet({
      name, records: { view: true, create: true, edit: true, delete: false },
      // The target table, not the file-wide default, decides access.
      tables: { People: { view: true, create: name === 'Creator', edit: name === 'Editor', delete: false } },
      layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'],
    });
    store.setPassword(name, 'pw', name);
  }
});
after(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function login(account: string) {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Target/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) },
  });
  return 'Bearer ' + (await r.json()).response.token;
}

for (const account of ['Viewer', 'Creator']) for (const action of ['add', 'update', 'replace']) for (const addRemaining of [false, true]) {
  if (account === 'Creator' && (action === 'add' || addRemaining)) continue;
  test(`web import: ${account} ${action}, addRemaining=${addRemaining} refuses before receiving or parsing the upload`, async () => {
    const authorization = await login(account);
    // An unfinished 50 MB upload cannot reach either the multipart or file parser.
    const reply = await new Promise<{ status: number | 'waiting'; text: string }>((resolve) => {
      const req = request(`${base}/tabularius/app/v1/databases/Target/layouts/People/import?action=${action}&preview=1&addRemaining=${addRemaining ? 1 : 0}`, {
        method: 'POST', headers: { authorization, 'content-type': 'multipart/form-data; boundary=import', 'content-length': String(50 * 1024 * 1024) },
      }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode!, text }); req.destroy(); });
      });
      const timer = setTimeout(() => { resolve({ status: 'waiting', text: '' }); req.destroy(); }, 1500);
      req.on('error', () => {});
      req.write('--import\r\n');
    });
    assert.notEqual(reply.status, 'waiting', 'denial must not wait for the body');
    assert.equal(JSON.parse(reply.text).error.code, 200);
  });
}

for (const account of ['Creator', 'Admin']) test(`web import: ${account} can still add records`, async () => {
  const body = new FormData();
  body.append('upload', new Blob(['Ada\n'], { type: 'text/csv' }), 'people.csv');
  const r = await fetch(`${base}/tabularius/app/v1/databases/Target/layouts/People/import?mapping=${encodeURIComponent('["Name"]')}`, {
    method: 'POST', headers: { authorization: await login(account) }, body,
  });
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.equal(result.imported, 1);
  assert.equal(store.get('People', result.foundSet[0]).fieldData.Name, 'Ada');
});

for (const action of ['update', 'replace']) test(`web legacy mapping still requires create when the query says ${action}`, async () => {
  // The legacy mapping path always creates, regardless of the action query.
  // This invalid workbook must never reach the XLSX parser for an edit-only account.
  const body = new FormData();
  body.append('upload', new Blob(['not a workbook']), 'people.xlsx');
  const r = await fetch(`${base}/tabularius/app/v1/databases/Target/layouts/People/import?action=${action}&mapping=${encodeURIComponent('["Name"]')}`, {
    method: 'POST', headers: { authorization: await login('Editor') }, body,
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 200);
});

for (const action of ['update', 'replace'] as const) test(`web dialog: edit-only account plans without an action, then ${action}s with columns`, async (t) => {
  const api = new Api('Target', (await login('Editor')).slice('Bearer '.length));
  const send = globalThis.fetch;
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', (path: string, init?: RequestInit) => {
    const url = new URL(path, base);
    requests.push(url);
    return send(url, init);
  });
  const id = store.create('People', { Code: `dialog-${action}`, Name: 'Before' }).recordId;
  const file = new File([`Code,Name\ndialog-${action},After\n`], 'people.csv');
  // These are the same API calls the Import dialog makes before and after choosing its action.
  const plan = await api.planImport('People', file, { ai: false });
  assert.equal(requests[0].searchParams.get('plan'), '1');
  assert.equal(requests[0].searchParams.has('action'), false);
  assert.equal(plan.rows, 1);
  const choice = { headerRow: plan.headerRow, columns: plan.columns, keys: ['Code'] };
  const result = await api.applyImport('People', file, choice, {
    action, found: { ids: [id] }, skipDuplicates: false, skipIssues: false,
  });
  assert.ok(requests[1].searchParams.has('columns'));
  assert.equal(requests[1].searchParams.get('action'), action);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.foundSet, [id]);
  assert.equal(store.get('People', id).fieldData.Name, 'After');
});

for (const mode of ['plan', 'preview']) for (const account of ['Viewer', 'Editor', 'Creator']) {
  test(`web ${mode} without an action: ${account} needs either create or edit`, async () => {
    const body = new FormData();
    // A denied account must be refused before this invalid workbook reaches the parser.
    body.append('upload', new Blob([account === 'Viewer' ? 'invalid workbook' : 'Name\nAda\n']), account === 'Viewer' ? 'people.xlsx' : 'people.csv');
    const r = await fetch(`${base}/tabularius/app/v1/databases/Target/layouts/People/import?${mode}=1`, {
      method: 'POST', headers: { authorization: await login(account) }, body,
    });
    const result = await r.json();
    assert.equal(r.status, account === 'Viewer' ? 400 : 200, JSON.stringify(result));
    if (account === 'Viewer') assert.equal(result.error.code, 200);
  });
}

for (const action of ['update', 'replace']) test(`web ${action} with add remaining: create-only skips matched rows and creates unmatched rows`, async () => {
  const id = store.create('People', { Code: `create-${action}`, Name: 'Before' }).recordId;
  const body = new FormData();
  body.append('upload', new Blob([`Code,Name\ncreate-${action},Denied\nnew-${action},Added\n`]), 'people.csv');
  body.append('found', JSON.stringify({ ids: [id] }));
  const params = new URLSearchParams({ action, addRemaining: '1', match: '["Code"]', columns: JSON.stringify({
    headerRow: true, columns: [{ column: 0, field: 'Code' }, { column: 1, field: 'Name' }],
  }) });
  const r = await fetch(`${base}/tabularius/app/v1/databases/Target/layouts/People/import?${params}`, {
    method: 'POST', headers: { authorization: await login('Creator') }, body,
  });
  const result = await r.json();
  assert.equal(r.status, 200, JSON.stringify(result));
  assert.equal(result.updated, 0);
  assert.equal(result.imported, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(store.get('People', id).fieldData.Name, 'Before');
  assert.equal(store.get('People', result.foundSet[0]).fieldData.Name, 'Added');
});

for (const tool of ['plan_import', 'import_records']) for (const create of [false, true]) test(`MCP ${tool} hides inaccessible layouts before checking create=${create}`, async () => {
  const account = `Hidden-${tool}-${create}`;
  store.savePrivilegeSet({
    name: account, records: { view: true, create, edit: false, delete: false },
    layouts: 'modifiable', layoutAccess: { People: { layout: 'none', records: 'none' } },
    scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmmcp'],
  });
  store.setPassword(account, 'pw', account);
  for (const layout of ['People', 'Missing']) {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST', headers: {
        authorization: 'Basic ' + btoa(`${account}:pw`), 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: tool, arguments: { database: 'Target', layout, data: 'Name\nAda\n', headerRow: true, columns: [{ column: 0, field: 'Name' }] },
      } }),
    });
    const result = (await r.json()).result;
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), { code: 105, message: `Layout "${layout}" is missing` });
  }
});

for (const account of ['Editor', 'Admin']) for (const action of ['update', 'replace']) {
  test(`web import: ${account} can still ${action} with a column plan`, async () => {
    const id = store.create('People', { Name: 'Existing' }).recordId;
    const body = new FormData();
    body.append('upload', new Blob(['Existing\n']), 'people.csv');
    body.append('found', JSON.stringify({ ids: [id] }));
    const params = new URLSearchParams({ action, match: '["Name"]', columns: JSON.stringify({
      headerRow: false, columns: [{ column: 0, field: 'Name', transforms: [] }],
    }) });
    const r = await fetch(`${base}/tabularius/app/v1/databases/Target/layouts/People/import?${params}`, {
      method: 'POST', headers: { authorization: await login(account) }, body,
    });
    const result = await r.json();
    assert.equal(result.updated, 1, JSON.stringify(result));
    assert.deepEqual(result.foundSet, [id]);
  });
}

for (const name of ['plan_import', 'import_records']) for (const account of ['Viewer', 'Creator', 'Admin']) {
  test(`MCP ${name}: ${account} checks create before the CSV parser`, async (t) => {
    const data = 'Name\nImport parser sentinel\n';
    // parseDelimited probes the BOM with charCodeAt(0). Count only this exact CSV,
    // leaving JSON transport parsing and unrelated strings untouched.
    const original = String.prototype.charCodeAt;
    let parsed = 0;
    t.mock.method(String.prototype, 'charCodeAt', function (this: string, index: number) {
      if (String(this) === data && index === 0) parsed++;
      return original.call(this, index);
    });
    const r = await fetch(`${base}/mcp`, {
      method: 'POST', headers: {
        authorization: 'Basic ' + btoa(`${account}:pw`), 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {
        database: 'Target', layout: 'People', data, format: 'csv', headerRow: true, columns: [{ column: 0, field: 'Name' }],
      } } }),
    });
    const result = (await r.json()).result;
    assert.equal(parsed, account === 'Viewer' ? 0 : 1, 'only authorized imports reach parseDelimited');
    assert.equal(!!result.isError, account === 'Viewer', JSON.stringify(result));
    if (account === 'Viewer') assert.equal(JSON.parse(result.content[0].text).code, 200);
    else if (name === 'import_records') assert.equal(JSON.parse(result.content[0].text).imported, 1);
  });
}
