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

// Create a record with portalData (the guide's Create a record): each row makes a related record, as data entry
// does, and the record with its rows is made together or not at all.

let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-create-portal-'));
  createStore(join(dir, 'P' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('P')!;
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Status' }] },
    { op: 'createTable', name: 'Calls', fields: [{ name: 'ContactId', type: 'number' }, { name: 'Note' }, { name: 'Locked', options: { autoEnter: { prohibitModification: true } } }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Calls', predicates: [{ left: 'Id', right: 'ContactId' }], allowCreation: true },
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
    portal: { tableOccurrenceId: occ('Calls').id, tableOccurrence: 'Calls', rows: 4, initialRow: 1 }, children: [field('Calls', 'Note'), field('Calls', 'Locked')],
  } as unknown as LayoutObject];
  store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects, tableView: [] } }] as DesignOp[]);
  store.create('Contacts', { Id: 1, Name: 'a', Status: 'ok' });
  store.create('Calls', { ContactId: 1, Note: 'x', Locked: 'kept' });
  store.setPassword('Admin', 'pw', '[Full Access]');
  // Can make records, but sees only those whose Status is "ok": a new one with no Status is hidden from it.
  store.savePrivilegeSet({ name: 'Limited', records: { view: 'Status = "ok"', edit: true, create: true, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] } as never);
  store.setPassword('Limited', 'pw', 'Limited');
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function call(path: string, auth: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}/fmi/data/vLatest${path}`, { method, headers: { authorization: auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

async function login(account: string): Promise<string> {
  const r = await call('/databases/P/sessions', 'Basic ' + btoa(`${account}:pw`), 'POST', {});
  return 'Bearer ' + r.body.response.token;
}

const L = '/databases/P/layouts/Contacts/records';
const contacts = () => store.find('Contacts', { limit: 1000 }).records.length;
const portal = () => store.layout('Contacts').plan!.portals[0].name;

test('portal rows of a new record can\'t name an existing related record, so they can\'t change one', async () => {
  const auth = await login('Admin');
  const call1 = Number(store.find('Calls', {}).records[0].recordId);
  const before = contacts();
  const r = await call(L, auth, 'POST', { fieldData: { Id: 5 }, portalData: { [portal()]: [{ recordId: String(call1), 'Calls::Locked': 'changed' }] } });
  assert.equal(r.status, 400, JSON.stringify(r.body.messages));
  assert.equal(r.body.messages[0].code, '960');
  assert.equal(store.get('Calls', call1).fieldData.Locked, 'kept');
  assert.equal(contacts(), before);
});

test('a non-object portal row is a bad parameter, and nothing is made', async () => {
  const auth = await login('Admin');
  const before = contacts();
  const r = await call(L, auth, 'POST', { fieldData: { Id: 6 }, portalData: { [portal()]: [null] } });
  assert.equal(r.status, 400);
  assert.equal(r.body.messages[0].code, '960');
  assert.equal(contacts(), before);
});

for (const portalData of [5, true, [[{}]]]) {
  test(`create rejects portalData ${JSON.stringify(portalData)} with 960 and makes no record`, async () => {
    const auth = await login('Admin');
    const before = contacts();
    const relatedBefore = store.findIds('Calls').length;
    const r = await call(L, auth, 'POST', { fieldData: { Id: 6 }, portalData });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.messages[0].code, '960');
    assert.equal(contacts(), before);
    assert.equal(store.findIds('Calls').length, relatedBefore);
  });
}

test('create accepts an empty portalData object', async () => {
  const auth = await login('Admin');
  const before = contacts();
  const r = await call(L, auth, 'POST', { fieldData: { Id: 8 }, portalData: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.messages[0].code, '0');
  assert.equal(contacts(), before + 1);
});

test('a create the account can\'t then see still answers with its recordId and modId', async () => {
  const auth = await login('Limited');
  const before = contacts();
  const r = await call(L, auth, 'POST', { fieldData: { Id: 7 }, portalData: { [portal()]: [{ 'Calls::Note': 'n' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body.messages));
  assert.equal(typeof r.body.response.recordId, 'string');
  assert.equal(typeof r.body.response.modId, 'string');
  assert.equal(contacts(), before + 1);
  assert.equal(store.get('Contacts', Number(r.body.response.recordId)).portalData![portal()][0]['Calls::Note'], 'n');
});
