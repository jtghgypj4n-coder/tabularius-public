import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';

// Requests the way community Data API client libraries send them (from their public documentation, no code copied):
// numbers as text, lists as JSON text, empty bodies, the token in either header. Each should be answered as FileMaker Server answers it.
const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'Charts.fmp12')) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-clients-'));
  copyFileSync(join(fixtures, 'Charts.fmp12'), join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Charts')!;
  store.setPassword('Admin', 'pw');
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function call(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const res = await fetch(`${base}/fmi/data/vLatest${path}`, { method: init.method ?? 'GET', headers: init.headers, body: init.body });
  return { status: res.status, body: await res.json() as { response: any; messages: { code: string }[] } };
}
const L = '/databases/Charts/layouts/Congress';

test('a client that logs in with a JSON body, a data source list and the token in the other header', { skip }, async () => {
  const login = await call('/databases/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: JSON.stringify({ fmDataSource: [] }) });
  assert.equal(login.body.messages[0].code, '0');
  const token = login.body.response.token;
  const r = await call(`${L}/records?_limit=2`, { headers: { 'x-fm-data-access-token': token } });
  assert.equal(r.body.response.data.length, 2);
});

test('lists and numbers sent as text', { skip }, async () => {
  const login = await call('/databases/Charts/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}`, 'content-type': 'application/json' };
  // sort as JSON text in the body, as some clients build it
  const textSort = await call(`${L}/_find`, { method: 'POST', headers: auth, body: JSON.stringify({ query: [{ State: '==Texas' }], sort: JSON.stringify([{ fieldName: 'District', sortOrder: 'descend' }]), limit: '3' }) });
  assert.equal(textSort.body.messages[0].code, '0', JSON.stringify(textSort.body));
  const districts = textSort.body.response.data.map((r: any) => r.fieldData.District);
  assert.deepEqual(districts, [...districts].sort((a: number, b: number) => b - a));
  // a number as a find value, and a value that is a number in the file
  const num = await call(`${L}/_find`, { method: 'POST', headers: auth, body: JSON.stringify({ query: [{ District: 1 }], limit: 1 }) });
  assert.equal(num.body.messages[0].code, '0', JSON.stringify(num.body));
  // fieldData numbers as text
  const made = await call(`${L}/records`, { method: 'POST', headers: auth, body: JSON.stringify({ fieldData: { Name: 'Client', District: '77' } }) });
  assert.equal(made.body.messages[0].code, '0', JSON.stringify(made.body));
  const got = await call(`${L}/records/${made.body.response.recordId}`, { headers: auth });
  assert.equal(got.body.response.data[0].fieldData.District, 77);
  // modId as a number
  const edit = await call(`${L}/records/${made.body.response.recordId}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ fieldData: { State: 'X' }, modId: 0 }) });
  assert.equal(edit.body.messages[0].code, '0', JSON.stringify(edit.body));
  await call(`${L}/records/${made.body.response.recordId}`, { method: 'DELETE', headers: auth });
});
