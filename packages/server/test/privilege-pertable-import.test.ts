// A set on FileMaker's "Custom privileges" (per-table and per-field record access), imported
// through the reader's shape, must keep its limits on every surface: a hidden field never
// leaks through the Data API, the web client, export, MCP (including word search), or a find
// on the hidden field itself. The mapping fails closed: only a field whose byte is exactly
// 0x03 stays accessible, and a table the set doesn't list has no access.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { relaxUnverified, fromFmp12 } from '../../store/src/privileges.ts';
import type { PrivilegeSet } from '../../fmp12/src/index.ts';
import type { Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;
let secret: string; // a value that exists only in the hidden ACLU field's neighbour, searched for below

// As the fmp12 reader returns a custom set: no file-level record access, Congress listed with
// per-field bytes. Name is read/write (0x03); ACLU is 0x00; Party is 0x01 (the unverified
// "view-only" reading); every other Congress field is left out of the list.
function customSet(): PrivilegeSet {
  const congress = store.schema.tables.find((t) => t.name === 'Congress')!;
  const id = (name: string) => congress.fields.find((f) => f.name === name)!.id;
  return {
    id: 7, name: 'Mapped',
    records: { view: false, create: false, edit: false, delete: false },
    customRecordAccess: true,
    tableRecords: [{
      tableId: congress.id,
      records: { view: true, create: false, edit: true, delete: false },
      fields: [
        { fieldId: id('Name'), access: 0x03, view: true, edit: true },
        { fieldId: id('ACLU'), access: 0x00, view: false, edit: false },
        { fieldId: id('Party'), access: 0x01, view: true, edit: false },
      ],
    }],
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none',
    extendedPrivileges: ['fmrest', 'fmmcp'],
  } as unknown as PrivilegeSet;
}

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-pertable-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.setPassword('Admin', 'pw');
  store.savePrivilegeSet(fromFmp12(customSet(), store.schema));
  store.setPassword('Mapped', 'pw', 'Mapped');
  secret = 'zzhiddenwordzz';
  store.create('Congress', { Name: 'Visible Person', State: secret, Party: 'Q' });
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function dataApiToken(account: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  return { authorization: `Bearer ${(await r.json()).response.token}` };
}

async function tool(name: string, args: unknown, auth: string): Promise<{ isError: boolean; data: any; text: string }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Basic ' + btoa(auth) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  const result = body.result ?? { isError: true, content: [{ text: JSON.stringify(body.error ?? body) }] };
  const text: string = result.content?.[0]?.text ?? '';
  let data: any;
  try { data = JSON.parse(text); } catch { data = undefined; }
  return { isError: !!result.isError, data, text };
}

test('import mapping: only a field marked exactly read/write stays accessible; the rest fail closed', { skip }, () => {
  const set = store.privilegeSet('Mapped')!;
  const t = set.tables!.Congress;
  assert.deepEqual(set.records, { view: false, edit: false, create: false, delete: false }, 'a table the set does not list has no access');
  assert.equal(t.fields!.ACLU, 'none');
  assert.equal(t.fields!.Party, 'none', 'the inferred view-only byte (0x01) is no access until an admin relaxes it');
  assert.equal(t.fields!.Name, 'modifiable', 'read/write 0x03 is explicitly modifiable');
  assert.equal(t.fieldsDefault, 'none', 'a field added later starts hidden');
  assert.equal(t.fields!.State, 'none', 'a field the set does not list is no access when the table customises fields');
  assert.deepEqual(set.unverifiedReadOnly, { Congress: ['Party'] });
  const p = store.privileges('Mapped');
  assert.equal(p.field('Congress', 'Name'), 'modifiable');
  assert.equal(p.field('Congress', 'Party'), 'none');
  assert.equal(p.field('Other', 'x'), 'none');
});

test('Data API: a hidden field is not returned, and the secret in an unlisted field never leaks', { skip }, async () => {
  const auth = await dataApiToken('Mapped');
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records?_limit=1000`, { headers: auth }).then((x) => x.json());
  const rows = r.response.data as { fieldData: Record<string, unknown> }[];
  assert.ok(rows.length > 0);
  for (const row of rows) {
    for (const hidden of ['ACLU', 'Party', 'State']) assert.ok(!(hidden in row.fieldData) || row.fieldData[hidden] === '', `${hidden} is hidden`);
  }
  assert.ok(!JSON.stringify(r).includes(secret), 'the value in an unlisted field is not in the response');
  assert.ok(rows.some((x) => x.fieldData.Name === 'Visible Person'), 'the read/write field is returned');
});

test('Data API: a find on a hidden field, and a write to one, are refused', { skip }, async () => {
  const auth = await dataApiToken('Mapped');
  const find = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/_find`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ query: [{ State: secret }] }),
  }).then((x) => x.json());
  assert.notEqual(find.messages[0].code, '0', 'finding on a hidden field is refused rather than answering from its contents');
  assert.ok(!JSON.stringify(find).includes('Visible Person'));
  const id = (store.query(`SELECT _fm_record_id AS id FROM Congress WHERE Name = 'Visible Person'`)[0] as { id: number }).id;
  const write = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records/${id}`, {
    method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Party: 'X' } }),
  }).then((x) => x.json());
  assert.notEqual(write.messages[0].code, '0', 'a field imported with no access cannot be written');
});

test('web client export: a hidden field cannot be exported, even by naming it', { skip }, async () => {
  const auth = await dataApiToken('Mapped');
  const ids = [(store.query(`SELECT _fm_record_id AS id FROM Congress WHERE Name = 'Visible Person'`)[0] as { id: number }).id];
  const out = await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress/export`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ fields: ['Name', 'State', 'ACLU'], format: 'csv', ids, fieldNames: true }),
  });
  const text = await out.text();
  assert.ok(!text.includes(secret), 'the hidden field value is not exported');
});

test('MCP: find_records and word search never show a hidden field or match on it', { skip }, async () => {
  const found = await tool('find_records', { database: 'Charts', layout: 'Congress', limit: 500 }, 'Mapped:pw');
  assert.equal(found.isError, false, found.text);
  assert.ok(!found.text.includes(secret), 'find_records omits the hidden field');
  const search = await tool('search_records', { database: 'Charts', text: secret }, 'Mapped:pw');
  assert.ok(!search.text.includes('Visible Person') || !search.data?.hits?.length, 'a word only present in a hidden field finds nothing');
  assert.ok(!(search.data?.hits ?? []).some((h: any) => JSON.stringify(h).includes(secret)));
  // The full-access administrator does find it, so the empty result above is the privilege check.
  const admin = await tool('search_records', { database: 'Charts', text: secret }, 'Admin:pw');
  assert.ok((admin.data?.hits ?? []).length > 0, 'full access finds the word');
});

test('admin relaxation: the unverified fields become view-only, and only those', { skip }, () => {
  const before = store.privilegeSet('Mapped')!;
  const { def, relaxed } = relaxUnverified(before);
  assert.equal(relaxed, 1);
  assert.equal(def.tables!.Congress.fields!.Party, 'viewOnly');
  assert.equal(def.tables!.Congress.fields!.ACLU, 'none', 'a byte of 0x00 is never relaxed');
  assert.equal(def.tables!.Congress.fields!.State, 'none', 'an unlisted field is never relaxed');
  assert.equal(def.unverifiedReadOnly, undefined);
  assert.equal(store.relaxUnverifiedAccess('Mapped'), 1);
  assert.equal(store.privileges('Mapped').field('Congress', 'Party'), 'viewOnly');
  assert.equal(store.relaxUnverifiedAccess('Mapped'), 0, 'nothing left to relax');
});

test('saving the set drops marker entries for fields an admin has since opened or that no longer exist', { skip }, () => {
  const d = fromFmp12(customSet(), store.schema);
  d.name = 'Mapped2';
  d.unverifiedReadOnly = { Congress: ['Party', 'ACLU', 'NoSuchField'], Gone: ['x'] };
  d.tables!.Congress.fields!.ACLU = 'modifiable'; // the admin opened it
  const saved = store.savePrivilegeSet(d);
  assert.deepEqual(saved.unverifiedReadOnly, { Congress: ['Party'] });
  assert.equal(store.relaxUnverifiedAccess('Mapped2'), 1);
  assert.equal(store.privilegeSet('Mapped2')!.tables!.Congress.fields!.ACLU, 'modifiable', 'relax never touches a field the admin opened');
});
