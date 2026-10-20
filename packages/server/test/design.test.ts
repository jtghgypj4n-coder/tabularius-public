import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, canDesign, type Host } from '../src/index.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-design-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const json = (path: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

const rpc = async (id: number, name: string, args: unknown) => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return { isError: !!body.result.isError, text: body.result.content[0].text as string };
};

test('design mode over REST: build a database from nothing and use it', async () => {
  host.create('Shop').setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };

  const changed = await json('/tabularius/design/v1/databases/Shop', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ changes: [
      { op: 'createTable', name: 'Products', fields: [{ name: 'Name' }, { name: 'Price', type: 'number' }] },
      { op: 'createField', table: 'Products', name: 'With tax', kind: 'calculation', type: 'number', calculation: 'Price * 1.2' },
    ] }),
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.applied.length, 2);
  assert.equal(changed.body.design.tables[0].fields.length, 3);

  const created = await json('/fmi/data/vLatest/databases/Shop/layouts/Products/records', {
    method: 'POST', headers: auth, body: JSON.stringify({ fieldData: { Name: 'Lamp', Price: 10 } }),
  });
  const rec = await json(`/fmi/data/vLatest/databases/Shop/layouts/Products/records/${created.body.response.recordId}`, { headers: auth });
  assert.equal(rec.body.response.data[0].fieldData['With tax'], 12);

  // The web client can draw the generated layout.
  const layout = await json('/tabularius/app/v1/databases/Shop/layouts/Products', { headers: auth });
  assert.equal(layout.status, 200);
  assert.ok(layout.body.design.objects.some((o: { field?: { field: string } }) => o.field?.field === 'Price'));

  const bad = await json('/tabularius/design/v1/databases/Shop', { method: 'POST', headers: auth, body: JSON.stringify({ changes: [{ op: 'deleteTable', table: 'Nope' }] }) });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 106);

  const history = await json('/tabularius/design/v1/databases/Shop/history', { headers: auth });
  assert.equal(history.body.history.length, 2);
  assert.equal(history.body.history[0].account, 'Admin');

  // Deletes are listed with their kept data; they can be restored, or emptied for good.
  const del = (changes: unknown[]) => json('/tabularius/design/v1/databases/Shop', { method: 'POST', headers: auth, body: JSON.stringify({ changes }) });
  let d = await del([{ op: 'deleteField', table: 'Products', field: 'Price' }]);
  assert.deepEqual(d.body.design.deleted.map((x: { kind: string; name: string; records: number }) => [x.kind, x.name, x.records]), [['field', 'Price', 1]]);
  d = await del([{ op: 'restoreDeleted', deleted: d.body.design.deleted[0].id }]);
  assert.deepEqual(d.body.design.deleted, []);
  const again = await json(`/fmi/data/vLatest/databases/Shop/layouts/Products/records/${created.body.response.recordId}`, { headers: auth });
  assert.equal(again.body.response.data[0].fieldData['With tax'], 12);
  d = await del([{ op: 'deleteField', table: 'Products', field: 'Name' }]);
  const emptied = await json(`/tabularius/design/v1/databases/Shop/deleted/${d.body.design.deleted[0].id}`, { method: 'DELETE', headers: auth });
  assert.equal(emptied.body.emptied, 1);
  assert.deepEqual(emptied.body.design.deleted, []);
  assert.equal((await json('/tabularius/design/v1/databases/Shop/deleted/999', { method: 'DELETE', headers: auth })).status, 404);

  // Themes: listed with their style names; read one in full.
  d = await del([{ op: 'createTheme', name: 'House' }, { op: 'createStyle', theme: 'House', name: 'Big', element: 70, rules: [{ part: 1, state: 1, css: { 'font-size': '18pt' } }] }]);
  const house = d.body.design.themes.find((t: { name: string }) => t.name === 'House');
  assert.deepEqual(house.styles, [{ name: 'Big', element: 70 }]);
  const full = await json(`/tabularius/design/v1/databases/Shop/themes/${house.id}`, { headers: auth });
  assert.deepEqual(full.body.theme.styles[0].rules, [{ part: 1, state: 1, css: { 'font-size': '18pt' } }]);
  assert.equal((await json('/tabularius/design/v1/databases/Shop/themes/999', { headers: auth })).status, 404);

  // FileMaker's clipboard XML comes back as changes (not applied), with notes on what didn't carry over.
  const snip = await json('/tabularius/design/v1/databases/Shop/snippet', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ table: 'Products', xml: '<fmxmlsnippet type="FMObjectList"><Field id="1" dataType="Number" fieldType="Normal" name="Stock"><Comment/></Field>' +
      '<CustomFunction id="1" functionArity="1" visible="True" parameters="x" name="Twice"><Calculation><![CDATA[x * 2]]></Calculation></CustomFunction></fmxmlsnippet>' }),
  });
  assert.equal(snip.status, 200);
  assert.deepEqual(snip.body.summary, ['1 custom function', '1 field']);
  assert.deepEqual(snip.body.changes.map((c: { op: string }) => c.op), ['createCustomFunction', 'createField']);
  d = await del(snip.body.changes);
  assert.ok(d.body.design.tables[0].fields.some((f: { name: string }) => f.name === 'Stock'));
  const copied = await json('/tabularius/design/v1/databases/Shop/snippet/copy', { method: 'POST', headers: auth, body: JSON.stringify({ customFunctions: [d.body.design.customFunctions[0].id] }) });
  assert.match(copied.body.xml, /<CustomFunction id="\d+" functionArity="1" visible="True" parameters="x" name="Twice"><Calculation><!\[CDATA\[x \* 2\]\]><\/Calculation><\/CustomFunction>/);
  assert.equal((await json('/tabularius/design/v1/databases/Shop/snippet/copy', { method: 'POST', headers: auth, body: JSON.stringify({ tables: 'all' }) })).status, 400);
  const ddr = await fetch(`${base}/tabularius/design/v1/databases/Shop/ddr`, { headers: auth });
  assert.equal(ddr.headers.get('content-type'), 'application/xml; charset=utf-8');
  const report = await ddr.text();
  assert.match(report, /<BaseTable id="\d+" records="1" comment="" name="Products">/);
  assert.match(report, /<CustomFunction id="\d+" functionArity="1" visible="True" parameters="x" name="Twice">/);
  // Layout objects come back as objects for the layout editor to place, and go out again as Layout mode's XML.
  const layoutId = d.body.design.layouts.find((l: { name: string }) => l.name === 'Products').id;
  const objs = await json('/tabularius/design/v1/databases/Shop/snippet', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ layout: layoutId, xml: '<fmxmlsnippet type="LayoutObjectList"><Layout><Object type="Field" key="1" flags="0"><Bounds top="10" left="20" bottom="30" right="220"/>' +
      '<FieldObj numOfReps="1" flags="32" displayType="0"><Name>Products::Stock</Name></FieldObj></Object></Layout></fmxmlsnippet>' }),
  });
  assert.equal(objs.status, 200);
  assert.deepEqual(objs.body.summary, ['1 layout object']);
  assert.equal(objs.body.objects[0].field.field, 'Stock');
  assert.deepEqual(objs.body.notes, []);
  const out = await json('/tabularius/design/v1/databases/Shop/snippet/copy', { method: 'POST', headers: auth, body: JSON.stringify({ layout: layoutId, objects: objs.body.objects }) });
  assert.match(out.body.xml, /^<\?xml version="1.0" encoding="UTF-8"\?><fmxmlsnippet type="LayoutObjectList">.*<Name>Products::Stock<\/Name>/);
  assert.equal((await json('/tabularius/design/v1/databases/Shop/snippet/copy', { method: 'POST', headers: auth, body: JSON.stringify({ objects: 'all' }) })).status, 400);
  const notXml = await json('/tabularius/design/v1/databases/Shop/snippet', { method: 'POST', headers: auth, body: JSON.stringify({ xml: 'hello' }) });
  assert.equal(notXml.status, 400);

  // External data sources: a file reference finds a hosted database by name; ODBC entries are only kept.
  host.create('Billing');
  const sources = await del([
    { op: 'createDataSource', name: 'Billing', paths: ['fmnet:/elsewhere/Billing'] },
    { op: 'createDataSource', name: 'Archive', paths: ['file:Archive'] },
    { op: 'createDataSource', name: 'Warehouse', paths: ['odbc:WH'] },
  ]);
  assert.deepEqual(sources.body.design.dataSources, [
    { id: 1, name: 'Billing', paths: ['fmnet:/elsewhere/Billing'], kind: 'file', hosted: 'Billing', occurrences: 0 },
    { id: 2, name: 'Archive', paths: ['file:Archive'], kind: 'file', occurrences: 0 },
    { id: 3, name: 'Warehouse', paths: ['odbc:WH'], kind: 'odbc', occurrences: 0 },
  ]);

  // Manage Containers: the default base directory is listed even before the file names one.
  assert.deepEqual(sources.body.design.containerDirectories, [{ id: 0, path: 'Files/Shop/', fields: [] }]);
  assert.equal(typeof sources.body.design.containerData.files, 'number');

  // The image library: upload an icon, list it, and load it from its signed URL.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>';
  const added = await json('/tabularius/design/v1/databases/Shop/images', { method: 'POST', headers: auth, body: JSON.stringify({ filename: 'dot.svg', mime: 'image/svg+xml', data: btoa(svg) }) });
  assert.equal(added.status, 200);
  const library = await json('/tabularius/design/v1/databases/Shop/images', { headers: auth });
  assert.deepEqual(library.body.images.map((i: { id: number; filename: string; mime: string }) => [i.id, i.filename, i.mime]), [[added.body.id, 'dot.svg', 'image/svg+xml']]);
  const img = await fetch(base + added.body.url);
  assert.equal(img.status, 200);
  assert.equal(await img.text(), svg);
  assert.match(img.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  const notImage = await json('/tabularius/design/v1/databases/Shop/images', { method: 'POST', headers: auth, body: JSON.stringify({ filename: 'x.html', mime: 'text/html', data: btoa('<p>') }) });
  assert.equal(notImage.status, 400);

  const noAuth = await json('/tabularius/design/v1/databases/Shop');
  assert.equal(noAuth.status, 401);
});

test('only full access can change the design', () => {
  const store = host.create('Locked');
  store.schema.privilegeSets.push({
    id: 2, name: 'Data Entry Only', records: { view: true, create: true, edit: true, delete: true },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.schema.accounts.push({ id: 2, name: 'Clerk', privilegeSetId: 2 }, { id: 3, name: 'Boss', privilegeSetId: 1 });
  assert.equal(canDesign(store, 'clerk'), false);
  assert.equal(canDesign(store, 'Boss'), true);
  assert.equal(canDesign(store, 'Admin'), true); // a new database's owner
  assert.equal(canDesign(store, 'operator'), false); // accounts without a privilege set have no access
  store.setPassword('operator', 'pw', '[Full Access]');
  assert.equal(canDesign(store, 'operator'), true);
});

test('design mode over MCP', async () => {
  const made = await rpc(1, 'create_database', { name: 'Notes' });
  assert.equal(made.isError, false);
  const change = await rpc(2, 'change_design', { database: 'Notes', changes: [{ op: 'createTable', name: 'Note', fields: [{ name: 'Body' }] }] });
  assert.equal(change.isError, false, change.text);
  const design = JSON.parse((await rpc(3, 'get_design', { database: 'Notes', sections: ['tables', 'layouts'] })).text);
  assert.equal(design.tables[0].name, 'Note');
  assert.equal(design.layouts[0].name, 'Note');
  const bad = await rpc(4, 'change_design', { database: 'Notes', changes: [{ op: 'createTable', name: 'note' }] });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /already exists/);
});

test('Check and Fix over HTTP and MCP', async () => {
  await rpc(10, 'create_database', { name: 'Tidy' });
  await rpc(11, 'change_design', { database: 'Tidy', changes: [{ op: 'createTable', name: 'Item', fields: [{ name: 'Name' }, { name: 'Code' }] }] });
  const store = host.get('Tidy')!;
  store.setPassword('Admin', 'pw');
  const id = (store.sql.prepare("SELECT layout_id FROM _fm_layouts WHERE name = 'Item'").get() as { layout_id: number }).layout_id;
  const go = { stepId: 1, step: 'Perform Script' };
  const button = (oid: number, b: number[]) => ({ id: oid, kind: 'button', type: 0, bounds: { left: b[0], top: b[1], right: b[2], bottom: b[3] }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, action: go });
  store.applyDesign([{ op: 'updateLayout', layout: id, design: { objects: [button(901, [10, 10, 110, 40]), button(902, [20, 15, 120, 45])] } } as never]);

  const login = await json('/fmi/data/vLatest/databases/Tidy/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}`, 'content-type': 'application/json' };
  const lint = await json(`/tabularius/design/v1/databases/Tidy/layouts/${id}/lint`, { headers: auth });
  const overlap = lint.body.issues.find((i: { rule: string }) => i.rule === 'overlap');
  assert.equal(overlap.fixable, true);

  // Fix over HTTP mends what is sent and saves nothing.
  const fixed = await json(`/tabularius/design/v1/databases/Tidy/layouts/${id}/fix`, { method: 'POST', headers: auth, body: JSON.stringify({ only: [overlap] }) });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  assert.deepEqual(fixed.body.fixed.map((i: { rule: string }) => i.rule), ['overlap']);
  assert.equal(fixed.body.design.objects.find((o: { id: number }) => o.id === 902).bounds.top, 44);
  assert.equal(store.design(id)!.objects.find((o) => o.id === 902)!.bounds.top, 15);

  // fix_layout over MCP: preview first, then saved.
  const preview = JSON.parse((await rpc(12, 'fix_layout', { database: 'Tidy', layout: 'Item', preview: true })).text);
  assert.equal(preview.saved, false);
  assert.equal(store.design(id)!.objects.find((o) => o.id === 902)!.bounds.top, 15);
  const saved = JSON.parse((await rpc(13, 'fix_layout', { database: 'Tidy', layout: 'Item' })).text);
  assert.equal(saved.saved, true);
  assert.equal(store.design(id)!.objects.find((o) => o.id === 902)!.bounds.top, 44);
  assert.equal(saved.remaining.filter((i: { fixable?: boolean }) => i.fixable).length, 0);

  // A preview of turning indexing back on doesn't list the slow sort as still there.
  await rpc(14, 'change_design', { database: 'Tidy', changes: [{ op: 'updateField', table: 'Item', field: 'Code', options: { noAutoIndex: true } }] });
  const to = store.schema.tableOccurrences.find((t) => t.name === 'Item')!;
  const code = store.schema.tables.find((t) => t.name === 'Item')!.fields.find((f) => f.name === 'Code')!;
  const portal = { ...button(903, [10, 100, 300, 200]), kind: 'portal', action: undefined, portal: { tableOccurrenceId: to.id, rows: 4, initialRow: 1, sort: [{ field: { tableOccurrenceId: to.id, fieldId: code.id } }] } };
  store.applyDesign([{ op: 'updateLayout', layout: id, design: { objects: [portal] } } as never]);
  const sorted = JSON.parse((await rpc(15, 'fix_layout', { database: 'Tidy', layout: 'Item', preview: true })).text);
  assert.equal(sorted.fixed.length, 1, sorted.fixed.join());
  assert.deepEqual(sorted.remaining.filter((i: { rule: string }) => i.rule === 'slow-sort'), []);
  assert.equal(store.schema.tables.find((t) => t.name === 'Item')!.fields.find((f) => f.name === 'Code')!.options?.noAutoIndex, true, 'a preview saves nothing');
});

test('phone preview: what a phone layout made from the open design shows, and the one already made', async () => {
  await rpc(20, 'create_database', { name: 'Pocket' });
  await rpc(21, 'change_design', { database: 'Pocket', changes: [{ op: 'createTable', name: 'Item', fields: [{ name: 'Name' }, { name: 'Code' }] }] });
  const store = host.get('Pocket')!;
  store.setPassword('Admin', 'pw');
  const id = store.design('Item')!.id;
  const login = await json('/fmi/data/vLatest/databases/Pocket/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}`, 'content-type': 'application/json' };
  const url = `/tabularius/design/v1/databases/Pocket/layouts/${id}/phone`;
  const first = await json(url, { method: 'POST', headers: auth, body: JSON.stringify({ design: { width: 900 } }) });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.phone.width, 390);
  assert.equal(first.body.existing, undefined);
  assert.ok(first.body.phone.objects.every((o: { bounds: { right: number } }) => o.bounds.right <= 390));
  store.applyDesign([{ op: 'createLayout', name: 'Item (phone)', phoneOf: id }] as never);
  const made = await json(url, { method: 'POST', headers: auth, body: JSON.stringify({}) });
  assert.deepEqual([made.body.existing.name, made.body.existing.following], ['Item (phone)', true]);
  assert.equal(store.design('Item (phone)')!.objects.length, made.body.phone.objects.length, 'nothing saved, and the same as the phone layout');
});

test('restyle every layout: a preview over HTTP, nothing saved; MCP saves it with an undo', async () => {
  await rpc(30, 'create_database', { name: 'Restyled' });
  await rpc(31, 'change_design', { database: 'Restyled', changes: [{ op: 'createTable', name: 'A', fields: [{ name: 'X' }] }, { op: 'createTable', name: 'B', fields: [{ name: 'Y' }] }] });
  const store = host.get('Restyled')!;
  store.setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Restyled/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}`, 'content-type': 'application/json' };
  const url = '/tabularius/design/v1/databases/Restyled/restyle';
  const r = await json(url, { method: 'POST', headers: auth, body: JSON.stringify({ tokens: { accent: '#224488' }, name: 'Blue' }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.theme, 'Blue');
  assert.equal(r.body.layouts.length, 2);
  assert.equal(r.body.themeContent.defaults[80][0].css['background-color'], '#224488');
  assert.equal(store.designs().themes.length, 0, 'nothing saved');
  const bad = await json(url, { method: 'POST', headers: auth, body: JSON.stringify({ tokens: { accent: 'blue' } }) });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error.message, /colour like/);
  const saved = await rpc(32, 'restyle_file', { database: 'Restyled', tokens: { accent: '#224488' }, preview: false });
  assert.equal(saved.isError, false, saved.text);
  const out = JSON.parse(saved.text);
  assert.equal(out.saved, true);
  assert.ok(store.designs().layouts.every((d) => d.themeId === store.designs().themes[0].id));
  await rpc(33, 'change_design', { database: 'Restyled', changes: out.undo });
  assert.equal(store.designs().themes.length, 0);
  assert.ok(store.designs().layouts.every((d) => d.themeId === undefined));
});

test('speed_up_layout: the moves with their costs, two applied in turn, and an undo that takes both back', async () => {
  await rpc(40, 'create_database', { name: 'Faster' });
  await rpc(41, 'change_design', { database: 'Faster', changes: [
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'InvoiceId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Invoices', right: 'Lines', predicates: [{ left: 'Id', right: 'InvoiceId' }] },
    { op: 'createField', table: 'Invoices', name: 'Total', kind: 'calculation', type: 'number', calculation: 'Sum ( Lines::Amount )', options: { unstored: true } },
    { op: 'createField', table: 'Invoices', name: 'All', kind: 'summary', type: 'number', summary: { type: 'total', field: 'Total' } },
  ] });
  const store = host.get('Faster')!;
  for (let i = 1; i <= 20; i++) {
    store.create('Invoices', { Id: String(i) });
    for (let j = 0; j < 50; j++) store.create('Lines', { InvoiceId: String(i), Amount: '1' });
  }
  const d = store.designs().layouts.find((l) => l.name === 'Invoices')!;
  const body = d.parts.find((p) => p.kind === 'body')!;
  const to = store.schema.tableOccurrences.find((t) => t.name === 'Invoices')!.id;
  const fid = (n: string) => store.schema.tables.find((t) => t.name === 'Invoices')!.fields.find((f) => f.name === n)!.id;
  const field = (id: number, n: string, left: number) => ({ id, kind: 'field', type: 0, bounds: { top: body.top + 2, left, bottom: body.top + 20, right: left + 90 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, field: { tableOccurrenceId: to, tableOccurrence: 'Invoices', fieldId: fid(n), field: n, display: 'edit', repetitions: 1 } });
  await rpc(42, 'change_design', { database: 'Faster', changes: [{ op: 'updateLayout', layout: d.id, design: { view: 'list', objects: [field(701, 'Total', 10), field(702, 'All', 120)], parts: d.parts.filter((p) => p.kind !== 'footer').map((p) => (p.kind === 'body' ? { ...p, height: 24 } : p)) } }] });
  const preview = JSON.parse((await rpc(43, 'speed_up_layout', { database: 'Faster', layout: d.id })).text);
  assert.equal(preview.saved, false);
  assert.equal(preview.moves.length, 2);
  assert.ok(preview.moves.every((m: { after: number }) => m.after < preview.before));
  const done = await rpc(44, 'speed_up_layout', { database: 'Faster', layout: d.id, apply: [0, 1] });
  assert.equal(done.isError, false, done.text);
  const out = JSON.parse(done.text);
  assert.equal(out.saved, true);
  assert.deepEqual(out.applied, [0, 1]);
  assert.ok(out.after < preview.before / 10, `${out.after} vs ${preview.before}`);
  // Both moves landed: the stored total on the row, and the summary in a grand summary part.
  const after = store.design(d.id)!;
  assert.ok(after.parts.some((p) => p.kind === 'trailing-grand-summary'));
  assert.equal(after.objects.find((o) => o.id === 701)!.field!.field, 'Total stored');
  await rpc(45, 'change_design', { database: 'Faster', changes: out.undo });
  assert.equal(store.design(d.id)!.objects.find((o) => o.id === 701)!.field!.field, 'Total');
  assert.ok(!store.schema.tables.find((t) => t.name === 'Invoices')!.fields.some((f) => f.name === 'Total stored'));
  // When a later move fails to save, the earlier one stays saved and comes back with its undo and the error.
  const real = store.applyDesign.bind(store);
  let calls = 0;
  store.applyDesign = ((changes: Parameters<typeof real>[0], opts: Parameters<typeof real>[1]) => {
    if (++calls === 2) throw new Error('disk full');
    return real(changes, opts);
  }) as typeof store.applyDesign;
  try {
    const half = await rpc(46, 'speed_up_layout', { database: 'Faster', layout: d.id, apply: [0, 1] });
    assert.equal(half.isError, false, half.text);
    const res = JSON.parse(half.text);
    assert.equal(res.saved, true);
    assert.deepEqual(res.applied, [0]);
    assert.match(res.error, /Move 1 wasn't saved: disk full/);
    assert.ok(Array.isArray(res.undo) && res.undo.length > 0);
    store.applyDesign = real;
    await rpc(47, 'change_design', { database: 'Faster', changes: res.undo });
    assert.equal(store.design(d.id)!.objects.find((o) => o.id === 701)!.field!.field, 'Total');
  } finally {
    store.applyDesign = real;
  }
});
