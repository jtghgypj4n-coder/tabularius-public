// Layout metadata with ?recordId=: value lists of related values (only the
// values related to that record) are listed for it, as in FileMaker's Data API.
// Without it they're left out; a record that isn't there is 101, one hidden by record access 200.
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
const ids: number[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-meta-recordid-'));
  createStore(join(dir, 'Meta' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Meta')!;
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Id', type: 'number' }, { name: 'Call' }] },
    { op: 'createTable', name: 'Calls', fields: [{ name: 'ContactId', type: 'number' }, { name: 'Note' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Calls', predicates: [{ left: 'Id', right: 'ContactId' }] },
    { op: 'createValueList', name: 'My calls', field: { occurrence: 'Calls', field: 'Note', related: 'Contacts' } },
  ] as DesignOp[]);
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
  const field = store.schema.tables.find((t) => t.name === 'Contacts')!.fields.find((f) => f.name === 'Call')!;
  const list = store.schema.valueLists.find((v) => v.name === 'My calls')!.id;
  const objects = [{
    id: 101, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, bounds: { top: 20, left: 20, bottom: 40, right: 300 },
    field: { tableOccurrenceId: occ('Contacts').id, fieldId: field.id, tableOccurrence: 'Contacts', field: 'Call', display: 'dropdown', repetitions: 1, valueListId: list },
  }] as LayoutObject[];
  store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects, tableView: [] } }] as DesignOp[]);
  for (const i of [1, 2]) ids.push(store.create('Contacts', { Id: i }).recordId);
  store.create('Calls', { ContactId: 1, Note: 'First' });
  store.create('Calls', { ContactId: 1, Note: 'Second' });
  store.create('Calls', { ContactId: 2, Note: 'Other' });
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.savePrivilegeSet({
    name: 'Ones', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
    extendedPrivileges: ['fmrest'], tables: { Contacts: { view: 'Id = 1', edit: true, create: true, delete: true } },
  } as never);
  store.setPassword('One', 'pw', 'Ones');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function call(path: string, auth?: string, method = 'GET'): Promise<{ status: number; body: { response: Record<string, any>; messages: { code: string }[] } }> {
  const res = await fetch(`${base}/fmi/data/vLatest${path}`, { method, headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
  return { status: res.status, body: await res.json() as never };
}
const login = async (user: string) => `Bearer ${(await call('/databases/Meta/sessions', 'Basic ' + btoa(`${user}:pw`), 'POST')).body.response.token}`;

test('layout metadata lists related value lists for ?recordId=, and refuses records the account can\'t see', async () => {
  const auth = await login('Admin');
  const lists = async (q: string, a = auth) => (await call(`/databases/Meta/layouts/Contacts${q}`, a)).body.response.valueLists;
  assert.equal(await lists(''), undefined, 'without a record there are no related values to list');
  assert.deepEqual(await lists(`?recordId=${ids[0]}`), [{ name: 'My calls', type: 'byField', values: [{ value: 'First', displayValue: 'First' }, { value: 'Second', displayValue: 'Second' }] }]);
  assert.deepEqual((await lists(`?recordId=${ids[1]}`))[0].values, [{ value: 'Other', displayValue: 'Other' }]);
  const bad = await call('/databases/Meta/layouts/Contacts?recordId=x', auth);
  assert.equal(bad.body.messages[0].code, '960');
  const missing = await call('/databases/Meta/layouts/Contacts?recordId=999', auth);
  assert.equal(missing.body.messages[0].code, '101');
  const one = await login('One');
  assert.equal((await lists(`?recordId=${ids[0]}`, one))[0].values.length, 2);
  const hidden = await call(`/databases/Meta/layouts/Contacts?recordId=${ids[1]}`, one);
  assert.equal(hidden.body.messages[0].code, '200', 'as a read of that record answers');
  assert.deepEqual(hidden.body.response, {});
});
