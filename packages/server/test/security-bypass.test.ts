// A limited account tries the obvious ways past its privilege set, on every
// surface that reads data: the Data API, the SQL endpoint, MCP, and the admin
// console. Each attempt must fail. This is the standing bypass check in CI; it
// overlaps other privilege tests on purpose, as the one place that gathers the
// adversary's moves together.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, setAdminPassword } from '../src/index.ts';
import type { PrivilegeDefinition, Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

// Democrats only, no ACLU scores, names view-only. No SQL (fmxdbc) and not
// full read, so the SQL endpoint and the raw-data MCP tools stay shut.
const snoop: PrivilegeDefinition = {
  name: 'Snoop',
  records: { view: false, edit: false, create: false, delete: false },
  tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false, fields: { ACLU: 'none', Name: 'viewOnly' } } },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
  extendedPrivileges: ['fmrest', 'fmmcp'],
};

// Sees every record, but the edit and delete rules are calculations ("limited"
// in FileMaker): editable only where Party = "D", deletable only the lone
// independent. Proves per-record view/edit/delete calcs gate writes, not just
// which records are found.
const steward: PrivilegeDefinition = {
  name: 'Steward',
  records: { view: true, edit: 'Party = "D"', create: false, delete: 'Party = "I"' },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
  extendedPrivileges: ['fmrest'],
};

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-bypass-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.savePrivilegeSet(snoop);
  store.setPassword('Snoop', 'pw', 'Snoop');
  store.savePrivilegeSet(steward);
  store.setPassword('Steward', 'pw', 'Steward');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/fmi/data/vLatest/databases${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
const code = (r: { body: { messages: { code: string }[] } }) => r.body.messages[0].code;

async function snoopToken(): Promise<string> {
  const r = await api('/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Snoop:pw') } });
  assert.equal(code(r), '0');
  return r.body.response.token;
}

async function stewardToken(): Promise<string> {
  const r = await api('/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Steward:pw') } });
  assert.equal(code(r), '0');
  return r.body.response.token;
}

const recordId = (where: string): string => String((store.query(`SELECT _fm_record_id AS id FROM Congress WHERE ${where} LIMIT 1`)[0] as { id: number }).id);

const mcp = async (auth: string, name: string, args: Record<string, unknown>) => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Basic ' + btoa(auth) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return { error: !!body.result?.isError, text: body.result?.content?.[0]?.text as string | undefined };
};

test('Data API: a limited account cannot read past its privilege set', { skip }, async () => {
  const auth = { authorization: `Bearer ${await snoopToken()}` };

  // A visible record arrives without the no-access field; the view-only field is there.
  const page = await api('/Charts/layouts/Congress/records?_limit=200', { headers: auth });
  assert.equal(code(page), '0');
  const rows = page.body.response.data as { fieldData: Record<string, unknown> }[];
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => !('ACLU' in r.fieldData)), 'the no-access field is redacted everywhere');
  assert.ok(rows.every((r) => r.fieldData.Party === 'D'), 'only records the view rule allows');

  // A find that reaches for a no-access field is refused, not answered.
  const onHidden = await api('/Charts/layouts/Congress/_find', { method: 'POST', headers: auth, body: JSON.stringify({ query: [{ ACLU: '>50' }] }) });
  assert.equal(code(onHidden), '102', 'no finding on a hidden field');

  // A find for records outside the view rule matches nothing (not "denied" in a way that confirms they exist).
  const republicans = await api('/Charts/layouts/Congress/_find', { method: 'POST', headers: auth, body: JSON.stringify({ query: [{ Party: '==R' }] }) });
  assert.equal(code(republicans), '401', 'records outside the view rule never match');

  // Writing a view-only field fails.
  const id = rows[0].fieldData.Name ? (page.body.response.data[0].recordId as string) : '1';
  const write = await api(`/Charts/layouts/Congress/records/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ fieldData: { Name: 'hacked' } }) });
  assert.equal(code(write), '201', 'a view-only field cannot be modified');
});

test('SQL endpoint: a limited account is refused entirely', { skip }, async () => {
  const basic = 'Basic ' + btoa('Snoop:pw');
  const post = await fetch(`${base}/tabularius/sql/v1/databases/Charts`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: basic }, body: JSON.stringify({ sql: 'SELECT ACLU FROM Congress' }),
  });
  assert.equal(post.status, 403, 'no raw SQL without full read access');
  const get = await fetch(`${base}/tabularius/sql/v1/databases/Charts?q=${encodeURIComponent('SELECT * FROM Congress')}`, { headers: { authorization: basic } });
  assert.equal(get.status, 403);
});

test('MCP: raw-data tools are shut, the schema hides what the account cannot see', { skip }, async () => {
  // The raw-SQL tool and free-form calculation evaluation need full read access.
  assert.ok((await mcp('Snoop:pw', 'sql_query', { database: 'Charts', sql: 'SELECT ACLU FROM Congress' })).error, 'sql_query refused');
  assert.ok((await mcp('Snoop:pw', 'evaluate_calculation', { database: 'Charts', layout: 'Congress', formula: 'ACLU' })).error, 'free-form calc refused');

  // The schema the account sees omits the no-access field.
  const described = JSON.parse((await mcp('Snoop:pw', 'describe_database', { database: 'Charts' })).text!);
  const congress = described.tables.find((t: { name: string }) => t.name === 'Congress');
  assert.ok(congress, 'the viewable table is listed');
  assert.ok(!congress.fields.some((f: { name: string }) => f.name === 'ACLU'), 'the no-access field is not in the schema');
});

test('Data API: a record-level edit calculation gates writes record by record', { skip }, async () => {
  const auth = { authorization: `Bearer ${await stewardToken()}` };
  const democrat = recordId(`Party = 'D'`);
  const republican = recordId(`Party = 'R'`);

  // The edit rule (Party = "D") lets this one through.
  const ok = await api(`/Charts/layouts/Congress/records/${democrat}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ fieldData: { State: 'ZZ' } }) });
  assert.equal(code(ok), '0', 'a record the edit rule allows can be changed');

  // The same field on a record the rule forbids is refused, and stays put.
  const denied = await api(`/Charts/layouts/Congress/records/${republican}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ fieldData: { State: 'ZZ' } }) });
  assert.equal(denied.status, 500); // a FileMaker error, as FileMaker Server answers it
  assert.equal(code(denied), '200', 'a record the edit rule forbids cannot be changed');
  const after = store.query(`SELECT State FROM Congress WHERE _fm_record_id = ${republican}`)[0] as { State: string };
  assert.notEqual(after.State, 'ZZ', 'the forbidden record was not written');
});

test('Data API: a record-level delete calculation gates deletes record by record', { skip }, async () => {
  const auth = { authorization: `Bearer ${await stewardToken()}` };
  const democrat = recordId(`Party = 'D'`);

  // The delete rule is Party = "I", so deleting a Democrat is refused.
  const denied = await api(`/Charts/layouts/Congress/records/${democrat}`, { method: 'DELETE', headers: auth });
  assert.equal(denied.status, 500);
  assert.equal(code(denied), '200', 'a record the delete rule forbids cannot be deleted');
  assert.equal(store.query(`SELECT count(*) AS n FROM Congress WHERE _fm_record_id = ${democrat}`)[0].n, 1, 'the record is still there');

  // The lone independent the rule allows can go.
  const independent = recordId(`Party = 'I'`);
  const ok = await api(`/Charts/layouts/Congress/records/${independent}`, { method: 'DELETE', headers: auth });
  assert.equal(code(ok), '0', 'a record the delete rule allows is deleted');
  assert.equal(store.query(`SELECT count(*) AS n FROM Congress WHERE _fm_record_id = ${independent}`)[0].n, 0, 'the record is gone');
});

test('Admin console: a file account is not an administrator', { skip }, async () => {
  // Once an admin password is set, the console checks it — a file account’s
  // own name and password (or its Data API token) do not open it.
  setAdminPassword(dir, 'adminsecret');
  const withAccount = await fetch(`${base}/tabularius/admin/v1/status`, { headers: { authorization: 'Basic ' + btoa('Snoop:pw') } });
  assert.equal(withAccount.status, 401, 'a file account cannot administer the server');
  const withToken = await fetch(`${base}/tabularius/admin/v1/status`, { headers: { authorization: `Bearer ${await snoopToken()}` } });
  assert.equal(withToken.status, 401, 'a Data API token is not admin access');
});
