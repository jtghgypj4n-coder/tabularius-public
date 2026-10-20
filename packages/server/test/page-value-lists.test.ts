// tabularius.valueList(name) in a web viewer page: the web client asks the server for a list by name, and gets its values
// (and the text to show, when it differs) as the signed-in account may use it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
const OPEN = { view: true, edit: true, create: true, delete: true };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-page-lists-'));
  createStore(join(dir, 'Shop' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Shop')!;
  store.applyDesign([
    { op: 'createTable', name: 'Things', fields: [{ name: 'Status' }, { name: 'Code' }, { name: 'Label' }] },
    { op: 'createValueList', name: 'Statuses', values: ['New', 'Active'] },
    { op: 'createValueList', name: 'Codes', field: { occurrence: 'Things', field: 'Code', second: 'Label' } },
  ] as never);
  store.create('Things', { Status: 'New', Code: 'b', Label: 'Beta' });
  store.create('Things', { Status: 'Active', Code: 'a', Label: 'Alpha' });
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.savePrivilegeSet({ name: 'Clerk', records: { ...OPEN }, layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest', 'fmapp'] });
  store.setPassword('clerk', 'pw', 'Clerk');
});
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

async function ask(account: string, name: string): Promise<{ status: number; body: any }> {
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), 'content-type': 'application/json' }, body: '{}',
  });
  const { token } = (await login.json() as { response: { token: string } }).response;
  const r = await fetch(`${base}/tabularius/app/v1/databases/Shop/layouts/Things/value-list`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  });
  return { status: r.status, body: await r.json() };
}

test('a custom list answers its values', async () => {
  const r = await ask('Admin', 'statuses');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { values: ['New', 'Active'] });
});

test('a list from a field answers its values and, with a second field, the text to show', async () => {
  const r = await ask('Admin', 'Codes');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.values, ['a', 'b']);
  assert.deepEqual(r.body.labels, ['a  Alpha', 'b  Beta']);
});

test('a list that is not there, or that the account cannot use, is refused', async () => {
  const missing = await ask('Admin', 'Nope');
  assert.equal(missing.status, 404);
  // This Tabularius endpoint follows Claris's meaning: 108 is "Value list is missing";
  // the old 105 meant a missing layout, not a value list (no FileMaker endpoint parity implied).
  // https://help.claris.com/en/pro-help/content/error-codes.html
  assert.equal(missing.body.error.code, 108);
  const denied = await ask('clerk', 'Statuses');
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 9);
  assert.doesNotMatch(JSON.stringify(denied.body), /Active/);
});
