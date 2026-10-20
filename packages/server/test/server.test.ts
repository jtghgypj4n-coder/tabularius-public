import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let expectedCaD: number;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Charts')!;
  store.setPassword('Admin', 'pw');
  grantRest(store);
  expectedCaD = Number(store.query(`SELECT count(*) AS n FROM Congress WHERE State = 'California' AND Party = 'D'`)[0].n);
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

test('Data API: login, find, logout', { skip }, async () => {
  const bad = await api('/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:nope') } });
  assert.equal(bad.body.messages[0].code, '212');
  const login = await api('/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:pw') } });
  const token = login.body.response.token;
  assert.ok(token);
  const auth = { authorization: `Bearer ${token}` };

  const found = await api('/Charts/layouts/Congress/_find', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ query: [{ State: '==California', Party: '==D' }], limit: 2 }),
  });
  assert.equal(found.body.messages[0].code, '0');
  assert.equal(found.body.response.dataInfo.foundCount, expectedCaD);
  assert.equal(found.body.response.data.length, 2);
  assert.equal(typeof found.body.response.data[0].recordId, 'string');

  const none = await api('/Charts/layouts/Congress/_find', { method: 'POST', headers: auth, body: JSON.stringify({ query: [{ Name: 'zzzz' }] }) });
  assert.equal(none.body.messages[0].code, '401');

  await api(`/Charts/sessions/${token}`, { method: 'DELETE' });
  const after = await api('/Charts/layouts', { headers: auth });
  assert.equal(after.body.messages[0].code, '952');
});

test('MCP: tools are listed and callable', { skip }, async () => {
  const rpc = async (body: unknown) => (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify(body),
  })).json();
  const tools = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.ok(tools.result.tools.some((t: { name: string }) => t.name === 'find_records'));
  const call = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'describe_database', arguments: { database: 'Charts' } } });
  const schema = JSON.parse(call.result.content[0].text);
  assert.ok(schema.tables.some((t: { name: string }) => t.name === 'Congress'));
  const calc = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'evaluate_calculation', arguments: { database: 'Charts', layout: 'Congress', formula: 'Upper ( Name ) & " " & Get ( RecordID )', recordId: 1 } } });
  assert.match(JSON.parse(calc.result.content[0].text).value, /^[^a-z]+ 1$/);
});

test('Data API: scripts run by name and as find triggers', { skip }, async () => {
  const login = await api('/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const run = await api('/Charts/layouts/Congress/script/Show%20House?script.param=Rank', { headers: auth });
  assert.equal(run.body.messages[0].code, '0');
  assert.equal(run.body.response.scriptError, '0');

  const missing = await api('/Charts/layouts/Congress/script/Nope', { headers: auth });
  assert.equal(missing.body.response.scriptError, '104');

  const found = await api('/Charts/layouts/Congress/_find', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ query: [{ State: '==California' }], limit: 1, script: 'Show Senate', 'script.prerequest': 'Show House', 'script.prerequest.param': 'Rank' }),
  });
  assert.equal(found.body.response.scriptError, '0');
  assert.equal(found.body.response['scriptError.prerequest'], '0');
  await api(`/Charts/sessions/${login.body.response.token}`, { method: 'DELETE' });
});

test('MCP: run_script returns the result and found count', { skip }, async () => {
  const res = await (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_script', arguments: { database: 'Charts', script: 'Show Senate', layout: 'Congress' } } }),
  })).json();
  const out = JSON.parse(res.result.content[0].text);
  assert.equal(out.error, 0);
  assert.ok(out.foundCount > 0);
});

/** The Data API needs the fmrest extended privilege, which the sample files' [Full Access] lacks. */
function grantRest(store: Store): void {
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
}
