import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { createStore, Store } from '../../store/src/index.ts';

// A solution built here: Customers with an Orders portal whose rows also show Products::Price (one hop further,
// through Orders::Item = Products::Name). Explain This Value without AI, and formatting shown in portal rows.

let dir = '';
let server: Server | undefined;
let base = '';
const ids: Record<string, number> = {};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-explain-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const s = new Store(path, 'Shop');
  s.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Item' }, { name: 'Qty', type: 'number' }] },
    { op: 'createTable', name: 'Products', fields: [{ name: 'Name' }, { name: 'Price', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Products', predicates: [{ left: 'Item', right: 'Name' }] },
    { op: 'createField', table: 'Orders', name: 'Line', type: 'text', kind: 'calculation', calculation: 'Qty & " × " & Item' },
  ] as never);
  const design = s.design('Customers')!;
  const to = (n: string) => s.schema.tableOccurrences.find((t) => t.name === n)!;
  const fid = (t: string, n: string) => s.schema.tables.find((x) => x.name === t)!.fields.find((f) => f.name === n)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const cell = (id: number, t: string, n: string, left: number) => ({ id, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 182, left, bottom: 204, right: left + 100 },
    field: { tableOccurrenceId: to(t).id, fieldId: fid(t, n), tableOccurrence: t, field: n, display: 'edit', repetitions: 1 } });
  const portal = { id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 180, left: 20, bottom: 284, right: 400 },
    portal: { tableOccurrenceId: to('Orders').id, tableOccurrence: 'Orders', rows: 4, initialRow: 1 }, children: [cell(901, 'Orders', 'Line', 22), cell(902, 'Products', 'Price', 130), cell(903, 'Orders', 'Item', 240)] };
  s.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [...design.objects, portal] } }] as never);
  ids.ada = s.create('Customers', { Id: 1, Name: 'Ada' }).recordId;
  ids.grace = s.create('Customers', { Id: 2, Name: 'Grace' }).recordId;
  ids.tea = s.create('Orders', { CustomerId: 1, Item: 'Tea', Qty: 2 }).recordId;
  ids.jam = s.create('Orders', { CustomerId: 2, Item: 'Jam', Qty: 5 }).recordId;
  s.create('Products', { Name: 'Tea', Price: 3 });
  s.create('Products', { Name: 'Jam', Price: 4 });
  s.setPassword('Admin', 'pw', '[Full Access]');
  const full = s.privilegeSets().find((p) => p.id === 1)!;
  s.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  s.close();
  const started = await serve({ dir, port: 0, log: () => {} });
  server = started.server;
  base = started.url;
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function explain(body: unknown): Promise<any> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const token = (await r.json()).response.token;
  const res = await fetch(`${base}/tabularius/app/v1/databases/Shop/layouts/Customers/explain`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

test('a portal row: the relationship, and the formula of the portal\'s own field on that row\'s record', async () => {
  const r = await explain({ recordId: String(ids.ada), field: 'Orders::Line', portal: 'Orders', row: String(ids.tea) });
  assert.equal(r.related.candidate.shown, true);
  assert.equal(r.field.field, 'Line');
  assert.equal(r.field.result, '2 × Tea');
});

test('a field from further along in a portal row is not looked up by the row\'s own record id', async () => {
  // Products record ids and Orders record ids are different numberings: the server must not read Products #row.
  const r = await explain({ recordId: String(ids.ada), field: 'Products::Price', portal: 'Orders', row: String(ids.tea) });
  assert.equal(r.field, undefined);
  assert.equal(r.related.kind, 'portal');
});

test('a row id that isn\'t related to the record gets the relationship\'s answer, not that record\'s values', async () => {
  const r = await explain({ recordId: String(ids.ada), field: 'Orders::Line', portal: 'Orders', row: String(ids.jam) });
  assert.equal(r.related.candidate.related, false);
  assert.equal(r.field, undefined);
});

test('formatting kept with a related record shows in portal rows (portalStyles) as it does on its own record', async () => {
  {
    const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
    const token = (await r.json()).response.token;
    // Made bold on the Orders layout, as Browse mode's Format menu does.
    const bold = await fetch(`${base}/fmi/data/vLatest/databases/Shop/layouts/Orders/records/${ids.tea}`, {
      method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fieldData: { Item: 'Tea' }, styles: { Item: [{ start: 0, end: 3, style: 1 }] } }),
    });
    assert.equal(bold.status, 200);
    const rec = (await (await fetch(`${base}/fmi/data/vLatest/databases/Shop/layouts/Customers/records/${ids.ada}`, { headers: { authorization: `Bearer ${token}` } })).json()).response.data[0];
    // The stored Line ( Qty & " × " & Item ) keeps Item's formatting too, at its place in the result.
    assert.deepEqual(rec.portalStyles, { Orders: { [String(ids.tea)]: { 'Orders::Item': [{ start: 0, end: 3, style: 1 }], 'Orders::Line': [{ start: 4, end: 7, style: 1 }] } } });
    const other = (await (await fetch(`${base}/fmi/data/vLatest/databases/Shop/layouts/Customers/records/${ids.grace}`, { headers: { authorization: `Bearer ${token}` } })).json()).response.data[0];
    assert.equal(other.portalStyles, undefined);
  }
});

test('the Format menu in a portal row: portalStyles beside portalData formats the related record', async () => {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const headers = { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
  const url = `${base}/fmi/data/vLatest/databases/Shop/layouts/Customers/records/${ids.grace}`;
  const runs = [{ start: 0, end: 3, style: 1 }];
  const ok = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fieldData: {}, portalData: { Orders: [{ recordId: String(ids.jam), 'Orders::Item': 'Jam' }] }, portalStyles: { Orders: { [String(ids.jam)]: { 'Orders::Item': runs } } } }) });
  assert.equal(ok.status, 200);
  const rec = (await (await fetch(url, { headers })).json()).response.data[0];
  assert.deepEqual(rec.portalStyles.Orders[String(ids.jam)]['Orders::Item'], runs);
  // Formatting needs the row's value in the same request, as "styles" does.
  const bad = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fieldData: {}, portalData: {}, portalStyles: { Orders: { [String(ids.jam)]: { 'Orders::Item': runs } } } }) });
  assert.equal(bad.status, 400);
});
