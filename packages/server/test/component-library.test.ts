// The component library: a component saved from one file is placed in
// another, its fields and scripts found there by name; a newer version is
// offered with a preview of every layout it changes, and taken only on request.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { LIBRARY_FILE } from '../src/component-library.ts';
import { createStore, type PrivilegeDefinition } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;

const clerk: PrivilegeDefinition = {
  name: 'Clerk', records: { view: true, edit: false, create: false, delete: false },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'],
};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-library-'));
  for (const name of ['Sales', 'Stock']) createStore(join(dir, `${name}.openhbam.sqlite`));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  for (const name of ['Sales', 'Stock']) {
    const store = host.get(name)!;
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest'])] });
    store.setPassword('Admin', 'pw');
    store.savePrivilegeSet(clerk);
    store.setPassword('Clerk', 'pw', 'Clerk');
  }
  // Both files have a Contacts table with a Name field (at different ids) and a "Go home" script; only Sales has Phone.
  host.get('Sales')!.applyDesign([
    { op: 'createTable', name: 'Filler', fields: [{ name: 'X' }] },
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Name' }, { name: 'Phone' }] },
    { op: 'createScript', name: 'Go home', text: 'Go to Layout [ original layout ]' },
  ] as never, { account: 'Admin' });
  host.get('Stock')!.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Email' }, { name: 'Name' }] },
    { op: 'createScript', name: 'Other', text: 'Beep' },
    { op: 'createScript', name: 'Go home', text: 'Beep' },
  ] as never, { account: 'Admin' });
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function token(db: string, account = 'Admin'): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/${db}/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) },
  });
  return (await r.json()).response.token;
}

async function call(db: string, tok: string, path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${base}/tabularius/design/v1/databases/${db}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

function header(db: string): LayoutObject[] {
  const s = host.get(db)!.schema;
  const to = s.tableOccurrences.find((t) => t.name === 'Contacts')!;
  const fields = s.tables.find((t) => t.name === 'Contacts')!.fields;
  const field = (id: number, name: string, left: number): LayoutObject => ({
    id, kind: 'field', type: 0, bounds: { top: 0, left, bottom: 20, right: left + 100 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
    field: { tableOccurrenceId: to.id, fieldId: fields.find((f) => f.name === name)?.id ?? 0, display: 'edit', repetitions: 1 },
  } as LayoutObject);
  return [
    field(1, 'Name', 0),
    field(2, 'Phone', 110),
    { id: 3, kind: 'button', type: 10, bounds: { top: 0, left: 220, bottom: 20, right: 300 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, text: 'Home',
      action: { stepId: 1, step: 'Perform Script', scriptId: s.scripts.find((x) => x.name === 'Go home')!.id } } as LayoutObject,
  ];
}

test('save a component to the library, place it in another file, take a newer version with a preview', async () => {
  const sales = await token('Sales');
  const stock = await token('Stock');
  // Sales makes a component and saves it to the library.
  host.get('Sales')!.applyDesign([{ op: 'createComponent', name: 'Contact strip', objects: header('Sales') }] as never, { account: 'Admin' });
  const mine = host.get('Sales')!.designs().components![0];
  const saved = await call('Sales', sales, '/library', 'POST', { component: mine.id });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.entry.version, 1);
  const id = saved.json.entry.id;
  assert.deepEqual(host.get('Sales')!.designs().components![0].library, { id, version: 1 });
  // Shared through a file in the hosted folder that only the server can read.
  assert.equal(statSync(join(dir, LIBRARY_FILE)).mode & 0o077, 0);

  // Stock sees it, and what placing it would leave out.
  const list = await call('Stock', stock, '/library');
  assert.deepEqual(list.json.library.map((e: any) => [e.name, e.version, e.from, e.here]), [['Contact strip', 1, 'Sales', undefined]]);
  const preview = await call('Stock', stock, `/library/${id}`, 'POST', { preview: true });
  assert.deepEqual(preview.json.missing, ['field Contacts::Phone']);

  // Placed in Stock: Name and the script point at Stock's own; Phone shows as missing.
  const placed = await call('Stock', stock, `/library/${id}`, 'POST', {});
  assert.equal(placed.status, 200, JSON.stringify(placed.json));
  const copy = host.get('Stock')!.designs().components!.find((c) => c.library?.id === id)!;
  const s = host.get('Stock')!.schema;
  const contacts = s.tables.find((t) => t.name === 'Contacts')!;
  assert.equal(copy.objects[0].field!.fieldId, contacts.fields.find((f) => f.name === 'Name')!.id);
  assert.equal(copy.objects[1].field!.fieldId, 0);
  assert.equal(copy.objects[2].action!.scriptId, s.scripts.find((x) => x.name === 'Go home')!.id);
  assert.deepEqual((await call('Stock', stock, '/library')).json.library[0].uses, ['Sales', 'Stock']);

  // Stock places it on a layout.
  const layout = host.get('Stock')!.designs().layouts.find((l) => l.name === 'Contacts')!;
  const group = { id: 900, kind: 'group', type: 8, bounds: { top: 10, left: 10, bottom: 10, right: 10 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, component: { id: copy.id }, children: [] };
  host.get('Stock')!.applyDesign([{ op: 'updateLayout', layout: layout.id, design: { objects: [...layout.objects, group] } }] as never, { account: 'Admin' });

  // Sales changes the master and saves version 2.
  const moved = header('Sales').map((o) => (o.id === 1 ? { ...o, bounds: { ...o.bounds, right: 160 } } : o));
  host.get('Sales')!.applyDesign([{ op: 'updateComponent', component: mine.id, objects: moved }] as never, { account: 'Admin' });
  assert.equal((await call('Sales', sales, '/library', 'POST', { component: mine.id })).json.entry.version, 2);

  // Stock is offered version 2 with before and after for each layout it is on; nothing changes until it says so.
  const offered = (await call('Stock', stock, '/library')).json.library[0];
  assert.deepEqual([offered.version, offered.here.version], [2, 1]);
  const p2 = await call('Stock', stock, `/library/${id}`, 'POST', { preview: true });
  assert.deepEqual(p2.json.layouts.map((l: any) => l.id), [layout.id]);
  const width = (d: any) => d.objects.find((o: any) => o.id === 900).children[0].bounds.right - d.objects.find((o: any) => o.id === 900).children[0].bounds.left;
  assert.deepEqual([width(p2.json.layouts[0].before), width(p2.json.layouts[0].after)], [100, 160]);
  assert.equal(width(host.get('Stock')!.design(layout.id)), 100);
  await call('Stock', stock, `/library/${id}`, 'POST', {});
  assert.equal(width(host.get('Stock')!.design(layout.id)), 160);
  assert.equal(host.get('Stock')!.designs().components!.filter((c) => c.library?.id === id).length, 1);
});

test('the library is design-only, and only the file that first saved a component can take it out', async () => {
  const clerkTok = await token('Stock', 'Clerk');
  assert.equal((await call('Stock', clerkTok, '/library')).status, 403);
  const stock = await token('Stock');
  const sales = await token('Sales');
  host.get('Sales')!.applyDesign([{ op: 'createComponent', name: 'Footer', objects: header('Sales').slice(0, 1) }] as never, { account: 'Admin' });
  const footer = host.get('Sales')!.designs().components!.find((c) => c.name === 'Footer')!;
  const id = (await call('Sales', sales, '/library', 'POST', { component: footer.id })).json.entry.id;
  // Stock didn't save it: placing it doesn't let Stock take it out.
  assert.equal((await call('Stock', stock, `/library/${id}`, 'DELETE')).status, 403);
  // A second component can't take a name the library already has.
  host.get('Stock')!.applyDesign([{ op: 'createComponent', name: 'Footer', objects: header('Stock').slice(0, 1) }] as never, { account: 'Admin' });
  const theirs = host.get('Stock')!.designs().components!.find((c) => c.name === 'Footer')!;
  assert.equal((await call('Stock', stock, '/library', 'POST', { component: theirs.id })).status, 400);
  await call('Stock', stock, `/library/${id}`, 'POST', {});
  assert.equal((await call('Stock', stock, `/library/${id}`, 'DELETE')).status, 403);
  // Nor save its own objects over it, even with a link it wrote itself.
  host.get('Stock')!.applyDesign([{ op: 'createComponent', name: 'Forged', objects: header('Stock').slice(0, 1), library: { id, version: 1 } }] as never, { account: 'Admin' });
  const forged = host.get('Stock')!.designs().components!.find((c) => c.name === 'Forged')!;
  const over = await call('Stock', stock, '/library', 'POST', { component: forged.id });
  assert.equal(over.status, 403, JSON.stringify(over.json));
  assert.equal((await call('Sales', sales, '/library')).json.library.find((e: any) => e.id === id).name, 'Footer');
  assert.equal((await call('Sales', sales, `/library/${id}`, 'DELETE')).status, 200);
  assert.equal((await call('Sales', sales, '/library')).json.library.some((e: any) => e.id === id), false);
  // Sales keeps its own copy, no longer linked to anything that's there.
  assert.ok(host.get('Sales')!.designs().components!.some((c) => c.name === 'Footer'));
});

test('a new version is saved only from a copy of the latest one', async () => {
  const sales = await token('Sales');
  host.get('Sales')!.applyDesign([{ op: 'createComponent', name: 'Badge', objects: header('Sales').slice(0, 1) }] as never, { account: 'Admin' });
  const badge = host.get('Sales')!.designs().components!.find((c) => c.name === 'Badge')!;
  const { id } = (await call('Sales', sales, '/library', 'POST', { component: badge.id })).json.entry;
  // A second copy in Sales still at version 1, after the first saved version 2.
  host.get('Sales')!.applyDesign([{ op: 'createComponent', name: 'Badge old', objects: header('Sales').slice(0, 1), library: { id, version: 1 } }] as never, { account: 'Admin' });
  const old = host.get('Sales')!.designs().components!.find((c) => c.name === 'Badge old')!;
  assert.equal((await call('Sales', sales, '/library', 'POST', { component: badge.id })).json.entry.version, 2);
  const stale = await call('Sales', sales, '/library', 'POST', { component: old.id });
  assert.equal(stale.status, 409);
  assert.match(stale.json.error.message, /version 2/);
});

test('a damaged library file is set aside, not left breaking every request', async () => {
  const { ComponentLibrary, LIBRARY_MAX } = await import('../src/component-library.ts');
  const { mkdtempSync, writeFileSync, readdirSync } = await import('node:fs');
  const d = mkdtempSync(join(tmpdir(), 'tabularius-library-damaged-'));
  try {
    writeFileSync(join(d, LIBRARY_FILE), '{"not": "finished"');
    const lib = new ComponentLibrary(d);
    assert.deepEqual(lib.list(), []);
    assert.ok(readdirSync(d).some((f) => f.startsWith(`${LIBRARY_FILE}.damaged-`)));
    // And the library as a whole has a size limit.
    const was = LIBRARY_MAX.totalBytes;
    LIBRARY_MAX.totalBytes = 2000;
    try {
      const obj = header('Sales');
      lib.save({ name: 'One', width: 10, height: 10, objects: obj, images: {}, from: 'Sales' });
      assert.throws(() => lib.save({ name: 'Two', width: 10, height: 10, objects: obj, images: { 1: { filename: null, mime: 'image/png', data: 'A'.repeat(2000) } }, from: 'Sales' }), /library is full/);
    } finally {
      LIBRARY_MAX.totalBytes = was;
    }
  } finally {
    rmSync(d, { recursive: true });
  }
});
