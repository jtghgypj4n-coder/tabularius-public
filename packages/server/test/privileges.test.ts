// Accounts and privilege sets, enforced in the Data API, the web client and MCP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { PrivilegeDefinition, Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

// Democrats only; edits only to Californians; can't delete; can't see ACLU scores or change names.
const clerk: PrivilegeDefinition = {
  name: 'Clerk',
  records: { view: false, edit: false, create: false, delete: false },
  tables: {
    Congress: { view: 'Party = "D"', edit: 'State = "California"', create: true, delete: false, fields: { ACLU: 'none', Name: 'viewOnly' } },
  },
  layouts: 'viewOnly',
  layoutAccess: { Grades: { layout: 'none', records: 'none' }, 'Found Set Summarized • Congress': { layout: 'viewOnly', records: 'viewOnly' } },
  valueLists: 'viewOnly',
  scripts: 'viewOnly',
  scriptAccess: { 'Show House': 'none' },
  extendedPrivileges: ['fmrest', 'fmmcp'],
};

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ mcpToken: 'test-admin-token', dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  const grant = (id: number, ...keywords: string[]) => {
    const set = store.privilegeSets().find((p) => p.id === id)!;
    store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, ...keywords] });
  };
  grant(1, 'fmrest');
  grant(2, 'fmapp');
  grant(3, 'fmrest');
  store.savePrivilegeSet(clerk);
  store.setPassword('Admin', 'pw');
  store.setPassword('Reader', 'pw', '[Read-Only Access]');
  store.setPassword('Clerk', 'pw', 'Clerk');
  store.setPassword('Entry', 'pw', '[Data Entry Only]');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/fmi/data/vLatest/databases${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

async function login(account: string, headers: Record<string, string> = {}): Promise<Record<string, string>> {
  const r = await api('/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), ...headers } });
  assert.equal(r.body.messages[0].code, '0', `${account}: ${r.body.messages[0].message}`);
  return { authorization: `Bearer ${r.body.response.token}` };
}

const code = (r: { body: { messages: { code: string }[] } }) => r.body.messages[0].code;

test('privileges: decoded sets and accounts', { skip }, () => {
  const ro = store.privilegeSets().find((p) => p.id === 3)!;
  assert.deepEqual(ro.records, { view: true, create: false, edit: false, delete: false });
  assert.equal(store.accountPrivilegeSet('reader'), '[Read-Only Access]');
  assert.equal(store.accountPrivilegeSet('Admin'), '[Full Access]');
  assert.ok(store.privileges('Admin').full);
  assert.ok(!store.privileges('Nobody').has('fmrest'), 'unknown accounts have no access');
  assert.throws(() => store.savePrivilegeSet({ ...clerk, layouts: 'everything' }), /layouts must be/);
});

test('privileges: the Data API needs fmrest; the web client fmapp or fmwebdirect', { skip }, async () => {
  const rest = await api('/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Entry:pw') } });
  assert.equal(code(rest), '9');
  assert.equal(rest.status, 401);
  await login('Entry', { 'x-tabularius-client': 'web' });
  const web = await api('/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Reader:pw'), 'x-tabularius-client': 'web' } });
  assert.equal(code(web), '9', '[Read-Only Access] has fmrest here but not fmapp');

  // Revoking fmrest ends access for sessions already logged in.
  const auth = await login('Reader');
  const ro = store.privilegeSets().find((p) => p.id === 3)!;
  store.savePrivilegeSet({ ...ro, extendedPrivileges: ro.extendedPrivileges.filter((e) => e !== 'fmrest') });
  assert.equal(code(await api('/Charts/layouts', { headers: auth })), '9');
  store.savePrivilegeSet(ro);
});

test('privileges: read-only accounts read but cannot write', { skip }, async () => {
  const auth = await login('Reader');
  const found = await api('/Charts/layouts/Congress/records?_limit=1', { headers: auth });
  assert.equal(code(found), '0');
  const id = found.body.response.data[0].recordId;
  const create = await api('/Charts/layouts/Congress/records', { method: 'POST', headers: auth, body: JSON.stringify({ fieldData: { Name: 'x' } }) });
  assert.equal(code(create), '200');
  const edit = await api(`/Charts/layouts/Congress/records/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ fieldData: { Name: 'x' } }) });
  assert.equal(code(edit), '200');
  const del = await api(`/Charts/layouts/Congress/records/${id}`, { method: 'DELETE', headers: auth });
  assert.equal(code(del), '200');
});

test('privileges: limited records, hidden and view-only fields, hidden layouts', { skip }, async () => {
  const auth = await login('Clerk');
  const all = Number(store.query(`SELECT count(*) AS n FROM Congress`)[0].n);
  const dems = Number(store.query(`SELECT count(*) AS n FROM Congress WHERE Party = 'D'`)[0].n);
  assert.ok(dems > 0 && dems < all);

  const page = await api('/Charts/layouts/Congress/records?_limit=500', { headers: auth });
  assert.equal(code(page), '0');
  assert.equal(page.body.response.dataInfo.foundCount, dems, 'only records the view rule allows');
  assert.equal(page.body.response.dataInfo.totalRecordCount, dems);
  for (const r of page.body.response.data) {
    assert.equal(r.fieldData.Party, 'D');
    assert.ok(!('ACLU' in r.fieldData), 'fields with no access are left out');
  }
  const rep = store.query(`SELECT _fm_record_id AS id FROM Congress WHERE Party = 'R' LIMIT 1`)[0].id;
  assert.equal(code(await api(`/Charts/layouts/Congress/records/${rep}`, { headers: auth })), '200');
  assert.equal(code(await api('/Charts/layouts/Congress/_find', { method: 'POST', headers: auth, body: JSON.stringify({ query: [{ ACLU: '>0' }] }) })), '102');
  const meta = await api('/Charts/layouts/Congress', { headers: auth });
  assert.ok(!meta.body.response.fieldMetaData.some((f: { name: string }) => f.name === 'ACLU'));

  const ca = store.query(`SELECT _fm_record_id AS id FROM Congress WHERE Party = 'D' AND State = 'California' LIMIT 1`)[0].id;
  const ny = store.query(`SELECT _fm_record_id AS id FROM Congress WHERE Party = 'D' AND State <> 'California' LIMIT 1`)[0].id;
  const patch = (id: unknown, fieldData: unknown, layout = 'Congress') =>
    api(`/Charts/layouts/${encodeURIComponent(layout)}/records/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ fieldData }) });
  assert.equal(code(await patch(ca, { District: 99 })), '0');
  assert.equal(code(await patch(ny, { District: 99 })), '200', 'edit rule is false for this record');
  assert.equal(code(await patch(ca, { Name: 'Renamed' })), '201', 'view-only field');
  assert.equal(code(await patch(ca, { District: 98 }, 'Found Set Summarized • Congress')), '200', 'records are view only through this layout');
  assert.equal(code(await api(`/Charts/layouts/Congress/records/${ca}`, { method: 'DELETE', headers: auth })), '200');
  const created = await api('/Charts/layouts/Congress/records', { method: 'POST', headers: auth, body: JSON.stringify({ fieldData: { Party: 'D', State: 'Ohio' } }) });
  assert.equal(code(created), '0');
  assert.equal(code(await api('/Charts/layouts/Grades/records', { method: 'POST', headers: auth, body: JSON.stringify({ fieldData: {} }) })), '105');

  const layouts = await api('/Charts/layouts', { headers: auth });
  const names = layouts.body.response.layouts.map((l: { name: string }) => l.name);
  assert.ok(names.includes('Congress') && !names.includes('Grades'));
  assert.equal(code(await api('/Charts/layouts/Grades/records', { headers: auth })), '105');
  assert.equal(code(await api('/Charts/layouts/US%20Coasters/records', { headers: auth })), '200', 'no access to other tables');

  const house = await api('/Charts/layouts/Congress/script/Show%20House', { headers: auth });
  assert.equal(house.body.response.scriptError, '9');
  const senate = await api('/Charts/layouts/Congress/script/Show%20Senate', { headers: auth });
  assert.equal(senate.body.response.scriptError, '0');
});

test('privileges: the web client lists only layouts the account can use', { skip }, async () => {
  const set = store.privilegeSet('Clerk')!;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmwebdirect'] });
  const auth = await login('Clerk', { 'x-tabularius-client': 'web' });
  const menu = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts`, { headers: auth })).json();
  const items = menu.layouts.filter((l: { kind: string }) => l.kind === 'item').map((l: { name: string }) => l.name);
  assert.ok(items.includes('Congress') && !items.includes('Grades'));
  const denied = await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Grades`, { headers: auth });
  assert.equal((await denied.json()).error.code, 105);
  const layout = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress`, { headers: auth })).json();
  const fields = layout.fields.Congress as { name: string; readOnly?: boolean }[];
  assert.ok(!fields.some((f) => f.name === 'ACLU'));
  assert.equal(fields.find((f) => f.name === 'Name')?.readOnly, true);
});

const mcp = async (auth: string | undefined, name: string, args: Record<string, unknown>) => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      authorization: auth ? 'Basic ' + btoa(auth) : 'Bearer test-admin-token',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return { error: !!body.result.isError, text: body.result.content[0].text as string };
};

test('privileges: AI clients signed in with an account work within its privilege set', { skip }, async () => {
  const described = JSON.parse((await mcp('Clerk:pw', 'describe_database', { database: 'Charts' })).text);
  assert.equal(described.privilegeSet, 'Clerk');
  assert.deepEqual(described.tables.map((t: { name: string }) => t.name), ['Congress']);
  assert.ok(!described.tables[0].fields.some((f: { name: string }) => f.name === 'ACLU'));
  assert.ok(!described.layouts.some((l: { name: string }) => l.name === 'Grades'));

  const found = JSON.parse((await mcp('Clerk:pw', 'find_records', { database: 'Charts', layout: 'Congress', limit: 1000 })).text);
  assert.ok(found.records.every((r: { fieldData: Record<string, unknown> }) => r.fieldData.Party === 'D' && !('ACLU' in r.fieldData)));
  const sql = await mcp('Clerk:pw', 'sql_query', { database: 'Charts', sql: 'SELECT ACLU FROM Congress' });
  assert.ok(sql.error && /Insufficient privileges/.test(sql.text));
  const calc = await mcp('Clerk:pw', 'evaluate_calculation', { database: 'Charts', layout: 'Congress', formula: 'ExecuteSQL ( "SELECT ACLU FROM Congress" ; "" ; "" )' });
  assert.ok(calc.error);
  const script = await mcp('Clerk:pw', 'run_script', { database: 'Charts', script: 'Show House', layout: 'Congress' });
  assert.ok(script.error);

  // Without fmmcp, or with a wrong password, an account can't use the file at all.
  assert.ok((await mcp('Reader:pw', 'describe_database', { database: 'Charts' })).error);
  assert.ok((await mcp('Clerk:nope', 'describe_database', { database: 'Charts' })).error);
  assert.deepEqual(JSON.parse((await mcp('Reader:pw', 'list_databases', {})).text), []);
  // Full Access has AI access; a local client without an account is the administrator.
  assert.ok(!(await mcp('Admin:pw', 'sql_query', { database: 'Charts', sql: 'SELECT count(*) FROM Congress' })).error);
  assert.ok(!(await mcp(undefined, 'sql_query', { database: 'Charts', sql: 'SELECT count(*) FROM Congress' })).error);
});

test('privileges: record locks need edit access to the record', { skip }, async () => {
  const auth = await login('Clerk');
  const ids = (sql: string) => store.query(sql).map((r) => Number(r._fm_record_id));
  const [ca] = ids(`SELECT _fm_record_id FROM Congress WHERE Party = 'D' AND State = 'California' LIMIT 1`);
  const [other] = ids(`SELECT _fm_record_id FROM Congress WHERE Party = 'D' AND State <> 'California' LIMIT 1`);
  const [rep] = ids(`SELECT _fm_record_id FROM Congress WHERE Party <> 'D' LIMIT 1`);
  const lock = (id: number, method = 'POST') => fetch(`${base}/tabularius/live/v1/databases/Charts/layouts/Congress/records/${id}/lock`, { method, headers: auth });
  assert.equal((await lock(ca)).status, 200);
  assert.equal((await lock(ca, 'DELETE')).status, 200);
  for (const id of [other, rep]) {
    const r = await lock(id);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, 200);
  }
});

test('privileges: canView matches the record access get enforces', { skip }, () => {
  const ids = (sql: string) => store.query(sql).map((r) => Number(r._fm_record_id));
  const [dem] = ids(`SELECT _fm_record_id FROM Congress WHERE Party = 'D' LIMIT 1`);
  const [rep] = ids(`SELECT _fm_record_id FROM Congress WHERE Party <> 'D' LIMIT 1`);
  const clerk = store.privileges('Clerk');
  assert.equal(store.canView('Congress', dem, clerk), true);
  assert.equal(store.canView('Congress', rep, clerk), false);
  assert.throws(() => store.get('Congress', rep, 'us', {}, clerk));
  assert.equal(store.canView('Congress', 999999, clerk), false);
  assert.equal(store.canView('Grades', dem, clerk), false);
  assert.equal(store.canView('Congress', rep), true);
});
