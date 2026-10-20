// Exercise the actual read surfaces with a locally defined, same-record calc.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '../../fmp12/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';
import { createStore, type Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

let dir: string;
let running: Awaited<ReturnType<typeof serve>>;
let store: Store;
let id: number;
const tokens = new Map<string, string>();
const data = '/fmi/data/vLatest/databases/Scratch';
const app = '/tabularius/app/v1/databases/Scratch';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-calc-noaccess-http-'));
  createStore(join(dir, 'Scratch.openhbam.sqlite'));
  running = await serve({ dir, port: 0, log: () => {} });
  store = running.host.get('Scratch')!;
  store.setAiPolicy(false);
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Public' }, { name: 'Secret' }] },
    { op: 'createField', table: 'T', name: 'UCalc', type: 'text', kind: 'calculation', calculation: 'Secret & Public', options: { unstored: true } },
  ]);
  const design = store.design('T')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'T', design: { objects: design.objects.map((object, index) => index === 0
    ? { ...object, tooltip: 'UCalc', label: 'Secret & Public' } : object) } }]);
  id = Number(store.create('T', { Public: '|visible', Secret: 'TOPSECRET' }).recordId);
  for (const access of ['none', 'masked', 'viewOnly'] as const) {
    store.savePrivilegeSet({
      name: access, records: { view: true, edit: false, create: false, delete: false, fields: { Secret: access } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmapp', 'fmmcp', 'fmodata'],
    });
    store.setPassword(access, 'pw', access);
  }
  const full = store.privilegeSet('[Full Access]')!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Admin', 'pw', full.name);
  for (const account of ['none', 'masked', 'viewOnly', 'Admin']) {
    const r = await request(account, `${data}/sessions`, 'POST', {});
    assert.equal(r.messages[0].code, '0');
    assert.ok(r.response.token);
    tokens.set(account, r.response.token);
  }
});

after(async () => {
  if (running) await new Promise<void>((resolve) => running.server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true });
});

async function request(account: string, path: string, method = 'GET', body?: unknown) {
  const token = path.startsWith(data) || path.startsWith(app) ? tokens.get(account) : undefined;
  const response = await fetch(running.url + path, {
    method, headers: {
      authorization: token ? `Bearer ${token}` : 'Basic ' + btoa(`${account}:pw`),
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

for (const account of ['none', 'masked', 'viewOnly', 'Admin']) {
  const expected = account === 'none' || account === 'masked' ? '|visible' : 'TOPSECRET|visible';
  const check = (fields: Record<string, unknown>) => {
    assert.equal(fields.Public, '|visible');
    assert.equal(fields.UCalc, expected);
    if (account === 'none') assert.ok(!('Secret' in fields));
    if (account === 'none' || account === 'masked') assert.ok(!JSON.stringify(fields).includes('TOPSECRET'));
  };

  test(`${account}: script return respects same-record calculation field access`, async () => {
    const script = {
      id: 9999, name: 'Read calculation', fullAccess: false,
      steps: [{ stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'UCalc' } }],
    } as Script;
    const result = await runScript(store, script, { layout: 'T', foundSet: [id], account, privileges: store.privileges(account) });
    assert.equal(result.error, 0);
    assert.equal(result.result, expected);
  });

  test(`${account}: Data API get, list and find respect same-record calculation field access`, async () => {
    check((await request(account, `${data}/layouts/T/records/${id}`)).response.data[0].fieldData);
    check((await request(account, `${data}/layouts/T/records`)).response.data[0].fieldData);
    check((await request(account, `${data}/layouts/T/_find`, 'POST', { query: [{ Public: '==|visible' }] })).response.data[0].fieldData);
  });

  test(`${account}: OData entity and collection respect same-record calculation field access`, async () => {
    check(await request(account, `/fmi/odata/v4/Scratch/T(${id})`));
    check((await request(account, '/fmi/odata/v4/Scratch/T')).value[0]);
  });

  test(`${account}: MCP get and find respect same-record calculation field access`, async () => {
    for (const name of ['get_record', 'find_records']) {
      const body = await request(account, '/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name, arguments: { database: 'Scratch', layout: 'T', ...(name === 'get_record' ? { recordId: id } : {}) },
      } });
      assert.ok(!body.result.isError, JSON.stringify(body));
      const result = JSON.parse(body.result.content[0].text);
      const fields = name === 'get_record' ? result.fieldData : result.records[0].fieldData;
      if (account === 'viewOnly' || account === 'Admin') {
        // MCP separately redacts copies of fields named Secret, even for Full Access.
        assert.equal(fields.Public, '|visible');
        assert.equal(fields.UCalc, '‹hidden from AI tools›');
      } else check(fields);
    }
  });

  test(`${account}: web record reads respect same-record calculation field access`, async () => {
    const result = await request(account, `${app}/layouts/T/records`, 'POST', { ids: [id] });
    check(result.data[0].fieldData);
    const view = await request(account, `${app}/layouts/T/view`, 'POST', { mode: 'browse', records: [{ id, number: 1 }] });
    const objectId = store.design('T')!.objects[0].id;
    assert.equal(view.records[id].tooltips[objectId], expected);
    assert.equal(view.records[id].labels[objectId], expected);
  });
}
