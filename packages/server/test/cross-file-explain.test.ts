import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { createStore, Store } from '../../store/src/index.ts';

// Two hosted files built here: Lines holds the line items; Orders shows them in a portal through an external table
// occurrence. Ann has full access in Orders but only a clerk's set in Lines, which can't see the design. Explain This
// Value must not read Lines through Orders for her: another file's formulas and records follow that file's privileges.

let dir = '';
let server: Server | undefined;
let base = '';
const ids: Record<string, number> = {};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-xfile-'));
  createStore(join(dir, 'Lines.openhbam.sqlite'));
  const lines = new Store(join(dir, 'Lines.openhbam.sqlite'), 'Lines');
  lines.applyDesign([
    { op: 'createTable', name: 'Lines', fields: [{ name: 'OrderId', type: 'number' }, { name: 'Item' }, { name: 'Cost', type: 'number' }] },
    { op: 'createField', table: 'Lines', name: 'Margin', type: 'number', kind: 'calculation', calculation: 'Cost * 0.4' },
  ] as never);
  const linesTable = lines.schema.tables.find((t) => t.name === 'Lines')!;
  const lf = (n: string) => linesTable.fields.find((f) => f.name === n)!.id;
  ids.line = lines.create('Lines', { OrderId: 1, Item: 'Tea', Cost: 10 }).recordId;
  lines.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: true, create: true, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'] });
  lines.setPassword('Admin', 'pw', '[Full Access]');
  lines.setPassword('Ann', 'pw', 'Clerk');

  createStore(join(dir, 'Orders.openhbam.sqlite'));
  const orders = new Store(join(dir, 'Orders.openhbam.sqlite'), 'Orders');
  orders.resolveFile = (n) => (n.toLowerCase() === 'lines' ? lines : undefined);
  orders.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createDataSource', name: 'Lines', paths: ['file:Lines'] },
    { op: 'createOccurrence', name: 'Lines_ext', file: 'Lines', externalTable: linesTable.id },
  ] as never);
  const idField = orders.schema.tables.find((t) => t.name === 'Orders')!.fields.find((f) => f.name === 'Id')!.id;
  orders.applyDesign([{ op: 'createRelationship', left: 'Orders', right: 'Lines_ext', predicates: [{ left: idField, right: lf('OrderId') }] }] as never);
  const ext = orders.schema.tableOccurrences.find((t) => t.name === 'Lines_ext')!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const cell = (id: number, n: string, left: number) => ({ id, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 182, left, bottom: 204, right: left + 100 },
    field: { tableOccurrenceId: ext, fieldId: lf(n), tableOccurrence: 'Lines_ext', field: n, display: 'edit', repetitions: 1 } });
  const portal = { id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 180, left: 20, bottom: 284, right: 300 },
    portal: { tableOccurrenceId: ext, tableOccurrence: 'Lines_ext', rows: 4, initialRow: 1 }, children: [cell(901, 'Item', 22), cell(902, 'Margin', 130)] };
  const design = orders.design('Orders')!;
  orders.applyDesign([{ op: 'updateLayout', layout: 'Orders', design: { objects: [...design.objects, portal] } }] as never);
  ids.order = orders.create('Orders', { Id: 1 }).recordId;
  orders.setPassword('Admin', 'pw', '[Full Access]');
  orders.setPassword('Ann', 'pw', '[Full Access]');
  for (const s of [orders, lines]) {
    const full = s.privilegeSets().find((p) => p.id === 1)!;
    s.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  }
  orders.close();
  lines.close();
  const started = await serve({ dir, port: 0, log: () => {} });
  server = started.server;
  base = started.url;
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function as(account: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Orders/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  return { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
}

const explain = async (account: string, body: unknown) => {
  const r = await fetch(`${base}/tabularius/app/v1/databases/Orders/layouts/Orders/explain`, { method: 'POST', headers: await as(account), body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test('full access in both files: a portal row on the other file is explained, its formula included', async () => {
  const r = await explain('Admin', { recordId: String(ids.order), field: 'Lines_ext::Margin', portal: 'Lines_ext', row: String(ids.line) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.field.formula, 'Cost * 0.4');
});

test('full access here but not in the other file: nothing of that file is explained', async () => {
  // Ann sees the design of Orders, so the menu item is there; Lines is still Lines' to refuse.
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Orders/layouts/Orders`, { headers: await as('Ann') })).json();
  assert.equal(meta.canSeeDesign, true);
  for (const field of ['Lines_ext::Margin', 'Lines_ext::Item']) {
    const r = await explain('Ann', { recordId: String(ids.order), field, portal: 'Lines_ext', row: String(ids.line) });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 9);
    assert.doesNotMatch(JSON.stringify(r.body), /Cost|0\.4/);
  }
  // Orders' own fields are still hers to explain.
  const own = await explain('Ann', { recordId: String(ids.order), field: 'Id' });
  assert.equal(own.status, 200);
});
