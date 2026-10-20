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

// A container field in a portal row takes a file (and is emptied) through the record's own layout: the row has
// to be one of the record's portal rows, and the account needs the related field to be modifiable.

let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-portal-container-'));
  createStore(join(dir, 'P' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('P')!;
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Docs', fields: [{ name: 'ContactId', type: 'number' }, { name: 'Title' }, { name: 'File', type: 'container' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Docs', predicates: [{ left: 'Id', right: 'ContactId' }], allowCreation: true },
  ] as DesignOp[]);
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
  const fieldId = (table: string, name: string) => store.schema.tables.find((t) => t.name === table)!.fields.find((f) => f.name === name)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  let top = 0;
  let id = 100;
  const field = (table: string, name: string) => ({
    id: ++id, kind: 'field', type: 1, anchors, style: {}, bounds: { top: top += 24, left: 20, bottom: top + 20, right: 300 },
    field: { tableOccurrenceId: occ(table).id, fieldId: fieldId(table, name), tableOccurrence: table, field: name, display: 'edit', repetitions: 1 },
  }) as unknown as LayoutObject;
  const objects = [field('Contacts', 'Id'), field('Contacts', 'Name'), {
    id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 300, left: 20, bottom: 400, right: 300 },
    portal: { tableOccurrenceId: occ('Docs').id, tableOccurrence: 'Docs', rows: 4, initialRow: 1 }, children: [field('Docs', 'Title'), field('Docs', 'File')],
  } as unknown as LayoutObject];
  store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects, tableView: [] } }] as DesignOp[]);
  store.create('Contacts', { Id: 1, Name: 'a' });
  store.create('Contacts', { Id: 2, Name: 'b' });
  store.create('Docs', { ContactId: 1, Title: 'mine' });
  store.create('Docs', { ContactId: 2, Title: 'theirs' });
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.savePrivilegeSet({
    name: 'Readonly File', records: { view: true, edit: true, create: true, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
    tables: { Docs: { view: true, edit: true, create: true, delete: false, fields: { File: 'viewOnly' } } },
  } as never);
  store.setPassword('Limited', 'pw', 'Readonly File');
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function login(account: string): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/P/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), 'content-type': 'application/json' }, body: '{}' });
  return 'Bearer ' + (await r.json()).response.token;
}

async function send(auth: string, method: 'POST' | 'DELETE', query: string, contact = 1): Promise<{ status: number; code: string }> {
  const form = new FormData();
  if (method === 'POST') form.append('upload', new Blob([new TextEncoder().encode('hello')], { type: 'text/plain' }), 'note.txt');
  const r = await fetch(`${base}/fmi/data/vLatest/databases/P/layouts/Contacts/records/${recordOf('Contacts', contact)}/containers/Docs::File/1${query}`, { method, headers: { authorization: auth }, body: method === 'POST' ? form : undefined });
  return { status: r.status, code: (await r.json()).messages[0].code };
}

const recordOf = (table: string, id: number) => store.find(table, { limit: 100 }).records.find((r) => String(r.fieldData.Id ?? r.fieldData.ContactId) === String(id))!.recordId;
const docOf = (contact: number) => Number(store.find('Docs', { limit: 100 }).records.find((r) => String(r.fieldData.ContactId) === String(contact))!.recordId);
const portal = () => store.layout('Contacts').plan!.portals[0].name;
const has = (contact: number) => store.containerId('Docs', docOf(contact), 'File') !== undefined;

test('a file goes into a portal row\'s container field and comes out again', async () => {
  const auth = await login('Admin');
  const q = (doc: number) => `?portal=${encodeURIComponent(portal())}&portalRecordId=${doc}`;
  const up = await send(auth, 'POST', q(docOf(1)));
  assert.equal(up.code, '0');
  assert.equal(has(1), true);
  assert.equal(new TextDecoder().decode(store.container(store.containerId('Docs', docOf(1), 'File')!)!.data), 'hello');
  const cleared = await send(auth, 'DELETE', q(docOf(1)));
  assert.equal(cleared.code, '0');
  assert.equal(has(1), false);
});

test('only the record\'s own portal rows can be written, and only where the account may edit the field', async () => {
  const admin = await login('Admin');
  const other = await send(admin, 'POST', `?portal=${encodeURIComponent(portal())}&portalRecordId=${docOf(2)}`);
  assert.equal(other.code, '101', 'a row of another contact\'s portal');
  assert.equal(has(2), false);
  const bad = await send(admin, 'POST', `?portal=${encodeURIComponent(portal())}`);
  assert.equal(bad.status, 400);
  for (const query of [`?portalRecordId=${docOf(1)}`, `?portal=${encodeURIComponent(portal())}&portalRecordId=5e0`, `?portl=${encodeURIComponent(portal())}&portalRecordId=${docOf(1)}`]) {
    assert.equal((await send(admin, 'POST', query)).status, 400, query);
  }
  const limited = await login('Limited');
  const denied = await send(limited, 'POST', `?portal=${encodeURIComponent(portal())}&portalRecordId=${docOf(1)}`);
  assert.equal(denied.code, '201', 'the field is view only for this account');
  assert.equal(has(1), false);
});
