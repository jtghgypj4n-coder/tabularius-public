import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Store } from '../../store/src/index.ts';
import { unzip as unzipXlsx } from '../../scripts/src/xlsx.ts';

// InterMediator_TestDB's person_layout has two portals (Contact, History);
// FMburgh's Main Menu shows a picture from the image library; Flicks' Demo
// layout hides objects; Charts' buttons run scripts that change layouts;
// DEMO_drawers' Splash merges fields and a $$variable into its text.
const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const files = { IM: 'InterMediator_TestDB.fmp12', Burgh: 'FMburgh_2012_11_07_Database.fmp12', Flicks: 'Flicks.fmp12', Charts: 'Charts.fmp12', Drawers: 'DEMO_drawers.fmp12', Std: 'Standards.fmp12' };
const skip = Object.values(files).every((f) => existsSync(join(fixtures, f))) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let hosted: Awaited<ReturnType<typeof serve>>['host'];

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-web-'));
  for (const [name, file] of Object.entries(files)) copyFileSync(join(fixtures, file), join(dir, `${name}.fmp12`));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  hosted = s.host;
  for (const name of Object.keys(files)) {
    s.host.get(name)!.setPassword('Admin', 'pw');
    grantRest(s.host.get(name)!);
  }
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function login(db: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/${db}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  return { authorization: `Bearer ${(await r.json()).response.token}` };
}

test('web client: serves the app, with TypeScript stripped', { skip }, async () => {
  const root = await fetch(`${base}/`, { headers: { accept: 'text/html' }, redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/app/');
  const html = await fetch(`${base}/app/`);
  assert.match(html.headers.get('content-type')!, /text\/html/);
  // Web viewer frames can't navigate out to the network.
  assert.match(html.headers.get('content-security-policy')!, /frame-src 'self' about: data: blob:/);
  assert.match(await html.text(), /src\/main\.ts/);
  const js = await fetch(`${base}/app/src/layout.ts`);
  assert.match(js.headers.get('content-type')!, /javascript/);
  const code = await js.text();
  assert.match(code, /class LayoutRenderer/);
  assert.doesNotMatch(code, /: HTMLElement\b/);
  assert.equal((await fetch(`${base}/app/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/app/tsconfig.json`)).status, 404);
  // Installable: the manifest and the service worker that keeps the app's own files.
  const manifest = await fetch(`${base}/app/manifest.webmanifest`);
  assert.match(manifest.headers.get('content-type')!, /application\/manifest\+json/);
  assert.equal((await manifest.json()).display, 'standalone');
  const sw = await fetch(`${base}/app/sw.js`);
  assert.match(sw.headers.get('content-type')!, /javascript/);
  assert.match(await sw.text(), /addEventListener\('fetch'/);
});

test('web client: layout menu and designs need a session', { skip }, async () => {
  assert.equal((await fetch(`${base}/tabularius/app/v1/databases/IM/layouts`)).status, 401);
  const auth = await login('IM');
  const menu = await (await fetch(`${base}/tabularius/app/v1/databases/IM/layouts`, { headers: auth })).json();
  assert.equal(menu.database, 'IM');
  const person = menu.layouts.find((l: { name: string }) => l.name === 'person_layout');
  assert.equal(person.open, true);

  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/IM/layouts/person_layout`, { headers: auth })).json();
  assert.equal(meta.stackBelowDefault, 640, 'the web client is told the width layouts without a breakpoint stack below');
  assert.equal(meta.layout.occurrence, 'person_to');
  assert.deepEqual(meta.design.parts.map((p: { kind: string }) => p.kind), ['header', 'body', 'footer']);
  const portals = meta.design.objects.filter((o: { kind: string }) => o.kind === 'portal');
  assert.equal(portals.length, 2);
  assert.ok(portals[0].children.some((c: { field?: { field: string } }) => c.field?.field === 'summary'));
  assert.deepEqual(meta.portals.map((p: { name: string }) => p.name).sort(), ['Contact', 'History']);
  assert.ok(meta.fields.person_to.some((f: { name: string }) => f.name === 'name'));
  assert.ok(meta.theme.defaults['61'], 'theme rules for edit boxes');
  // Text in a header part is styled through a contextual rule (header > text).
  assert.ok(meta.theme.contextual.some((c: { path: number[] }) => c.path.join() === '32,70'));
});

test('web client: image library pictures are signed URLs, served as images', { skip }, async () => {
  const auth = await login('Burgh');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Burgh/layouts/Main%20Menu`, { headers: auth })).json();
  const graphic = meta.design.objects.find((o: { kind: string }) => o.kind === 'graphic');
  const url: string = meta.images[graphic.imageId];
  assert.match(url, /^\/tabularius\/images\/Burgh\/\d+\?sig=/);
  const img = await fetch(new URL(url, base));
  // The picture was pasted as a PDF with a JPEG preview; browsers get the JPEG.
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(new URL(url.replace(/sig=.*/, 'sig=forged'), base))).status, 404);
});

test('Data API: portal rows, editing them and deleting them', { skip }, async () => {
  const auth = await login('IM');
  const json = { ...auth, 'content-type': 'application/json' };
  const layout = `${base}/fmi/data/vLatest/databases/IM/layouts/person_layout`;
  const first = (await (await fetch(`${layout}/records?_limit=1`, { headers: auth })).json()).response.data[0];
  assert.equal(first.fieldData.name, 'Masayuki Nii');
  assert.equal(first.portalData.Contact.length, 3);
  assert.equal(first.portalData.Contact[0]['contact_to::summary'], 'Telephone');
  assert.equal(first.portalData.History[1]['history_to::description'], 'University');

  const row = first.portalData.Contact[0];
  const patch = await fetch(`${layout}/records/${first.recordId}`, {
    method: 'PATCH', headers: json,
    body: JSON.stringify({ fieldData: {}, portalData: { Contact: [{ recordId: row.recordId, 'contact_to::summary': 'Phone call' }] } }),
  });
  assert.equal(patch.status, 200);
  const after = (await (await fetch(`${layout}/records/${first.recordId}`, { headers: auth })).json()).response.data[0];
  assert.equal(after.portalData.Contact[0]['contact_to::summary'], 'Phone call');

  // Portal paging, as FileMaker's Data API names it.
  const paged = (await (await fetch(`${layout}/records/${first.recordId}?_offset.Contact=2&_limit.Contact=1`, { headers: auth })).json()).response.data[0];
  assert.equal(paged.portalData.Contact.length, 1);
  assert.equal(paged.portalData.Contact[0]['contact_to::summary'], 'Meeting');

  // A row without a recordId makes a related record, reported as FileMaker's Data API does.
  const add = await (await fetch(`${layout}/records/${first.recordId}`, {
    method: 'PATCH', headers: json,
    body: JSON.stringify({ fieldData: {}, portalData: { Contact: [{ 'contact_to::summary': 'Letter' }] } }),
  })).json();
  const made = add.response.newPortalRecordInfo;
  assert.equal(made.length, 1);
  assert.equal(made[0].tableName, 'Contact');
  assert.match(made[0].recordId, /^\d+$/);
  const grown = (await (await fetch(`${layout}/records/${first.recordId}`, { headers: auth })).json()).response.data[0];
  assert.equal(grown.portalData.Contact.length, 4);

  const del = await fetch(`${layout}/records/${first.recordId}`, {
    method: 'PATCH', headers: json,
    body: JSON.stringify({ fieldData: { deleteRelated: [`Contact.${row.recordId}`, `Contact.${made[0].recordId}`] } }),
  });
  assert.equal(del.status, 200);
  const gone = (await (await fetch(`${layout}/records/${first.recordId}`, { headers: auth })).json()).response.data[0];
  assert.equal(gone.portalData.Contact.length, 2);
  assert.ok(!gone.portalData.Contact.some((r: { recordId: string }) => r.recordId === row.recordId));
});

async function post(db: string, layout: string, what: string, body: unknown, auth?: Record<string, string>): Promise<any> {
  auth ??= await login(db);
  const r = await fetch(`${base}/tabularius/app/v1/databases/${db}/layouts/${encodeURIComponent(layout)}/${what}`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

test('web client: hide conditions are worked out per record', { skip }, async () => {
  const layout = 'WV Framework - Demo';
  const auth = await login('Flicks');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Flicks/layouts/${encodeURIComponent(layout)}`, { headers: auth })).json();
  const hidden = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; }).filter((o: any) => o.hide);
  assert.ok(hidden.some((o: any) => o.id === 23 && o.hide.formula === 'True'));
  const first = (await (await fetch(`${base}/fmi/data/vLatest/databases/Flicks/layouts/${encodeURIComponent(layout)}/records?_limit=1`, { headers: auth })).json()).response.data[0];
  const r = await post('Flicks', layout, 'view', { mode: 'browse', view: 'form', foundCount: 1, totalCount: 1, records: [{ id: first.recordId, number: 1 }] });
  assert.ok(r.records[first.recordId].hidden.includes(23));
  assert.ok(r.records[first.recordId].hidden.includes(24));
  // "True" applies in Browse mode only unless the object says Find mode too.
  const find = await post('Flicks', layout, 'view', { mode: 'find' });
  assert.equal(find.find.hidden.includes(23), hidden.find((o: any) => o.id === 23).hide.inFind);
});

test('web client: conditional formatting applies when its formula is true', { skip }, async () => {
  const layout = 'WV Framework - Modules';
  const auth = await login('Flicks');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Flicks/layouts/${encodeURIComponent(layout)}`, { headers: auth })).json();
  const btn = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; }).find((o: any) => o.id === 217);
  // Only what was ticked in the dialog applies: here the fill color.
  assert.deepEqual(btn.conditions, [{ formula: 'Get ( WindowMode ) ≠ 4', rules: [{ part: 1, state: 1, css: { 'background-color': 'rgb(255 255 255 / 0)' } }] }]);
  const first = (await (await fetch(`${base}/fmi/data/vLatest/databases/Flicks/layouts/${encodeURIComponent(layout)}/records?_limit=1`, { headers: auth })).json()).response.data[0];
  const r = await post('Flicks', layout, 'view', { mode: 'browse', records: [{ id: first.recordId, number: 1 }] }, auth);
  // The button is in a portal: it is worked out per portal row.
  const rows = Object.values(r.records[first.recordId].rows['Assessments 2']) as { styles?: Record<string, number[]> }[];
  assert.ok(rows.length && rows.every((row) => row.styles?.[217]?.[0] === 0));
});

test('web client: merge fields and merge variables are filled in per record', { skip }, async () => {
  const auth = await login('Drawers');
  const first = (await (await fetch(`${base}/fmi/data/vLatest/databases/Drawers/layouts/Splash/records?_limit=1`, { headers: auth })).json()).response.data[0];
  const r = await post('Drawers', 'Splash', 'view', { mode: 'browse', records: [{ id: first.recordId, number: 1 }] }, auth);
  assert.deepEqual(r.records[first.recordId].merges, { 'SOLUTION::name': 'Pullout Drawers Demo', 'SOLUTION::version': '1', $$_splash_message: '' });
});

test('web client: calculated text (<<ƒ:formula>>) is worked out per record, < and > in it too', { skip }, async () => {
  const store = hosted.get('Drawers')!;
  const splash = store.design('Splash')!;
  const text = { id: 9901, kind: 'text', type: 2, bounds: { top: 2, left: 2, bottom: 20, right: 200 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
    text: 'Shown: <<ƒ:If ( Get ( FoundCount ) > 0 ; "some" ; "none" )>> of <<ƒ:Get ( TotalRecordCount )>>' };
  store.applyDesign([{ op: 'updateLayout', layout: splash.id, design: { objects: [...splash.objects, text] } }] as never, { account: 'Admin' });
  try {
    const auth = await login('Drawers');
    const first = (await (await fetch(`${base}/fmi/data/vLatest/databases/Drawers/layouts/Splash/records?_limit=1`, { headers: auth })).json()).response.data[0];
    const r = await post('Drawers', 'Splash', 'view', { mode: 'browse', foundCount: 3, totalCount: 7, records: [{ id: first.recordId, number: 1 }] }, auth);
    const merges = r.records[first.recordId].merges;
    assert.equal(merges['ƒ:If ( Get ( FoundCount ) > 0 ; "some" ; "none" )'], 'some');
    assert.equal(merges['ƒ:Get ( TotalRecordCount )'], '7');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: splash.id, design: { objects: splash.objects } }] as never, { account: 'Admin' });
  }
});

test('web client: records by id, in the order given', { skip }, async () => {
  const auth = await login('IM');
  const all = (await (await fetch(`${base}/fmi/data/vLatest/databases/IM/layouts/person_layout/records?_limit=3`, { headers: auth })).json()).response.data;
  const ids = all.map((r: { recordId: string }) => Number(r.recordId)).reverse();
  const r = await post('IM', 'person_layout', 'records', { ids, offset: 1, limit: 2 });
  assert.equal(r.foundCount, 3);
  assert.deepEqual(r.data.map((d: { recordId: string }) => Number(d.recordId)), ids.slice(0, 2));
});

test('web client: where a record sits in a sorted found set, a find or a script\'s found set', { skip }, async () => {
  // The window asks after a sort, so it stays on the record it was on even when the sort moves it to another page.
  const store = hosted.get('Charts')!;
  const sort = [{ fieldName: 'Customer', sortOrder: 'descend' as const }];
  const sorted = store.findIds('NW Customers', { sort });
  const id = sorted[70];
  assert.deepEqual(await post('Charts', 'NW Customers', 'position', { recordId: String(id), sort }), { index: 70 });
  // Within a find: its own order.
  const query = [{ Customer: 'a' }];
  const found = store.findIds('NW Customers', { query, sort });
  assert.deepEqual(await post('Charts', 'NW Customers', 'position', { recordId: String(found.at(-1)), query, sort }), { index: found.length - 1 });
  // A script's found set, sorted.
  const ids = sorted.slice(0, 5).reverse();
  assert.deepEqual(await post('Charts', 'NW Customers', 'position', { recordId: String(sorted[4]), ids, sort }), { index: 4 });
  // Not in the found set, or no record named: -1.
  assert.deepEqual(await post('Charts', 'NW Customers', 'position', { recordId: String(sorted[10]), ids, sort }), { index: -1 });
  assert.deepEqual(await post('Charts', 'NW Customers', 'position', {}), { index: -1 });
});

test('web client: a button runs its script and reports where it left the window', { skip }, async () => {
  const auth = await login('Charts');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Home`, { headers: auth })).json();
  const btn = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; })
    .find((o: any) => o.action?.script === '[btn] Go to next layout');
  assert.ok(btn, 'Home has a "Go to next layout" button');
  // The file's startup script fills $$layoutList; run it in this session first, so the button finds it.
  const trg = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Home/script/${encodeURIComponent('[trg] set layoutlist')}`, { headers: auth });
  assert.equal((await trg.json()).response.scriptError, '0');
  const r = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
  assert.equal(r.error, 0, r.message);
  assert.equal(r.script, '[btn] Go to next layout');
  assert.ok(r.layout && r.layout !== 'Home', `went to ${r.layout}`);
  assert.ok(Array.isArray(r.foundSet));
  const bad = await post('Charts', 'Home', 'button', { objectId: -1 });
  assert.equal(bad.error.code, 3);
});

test('web client: a file opens on its File Options layout and runs its OnFirstWindowOpen script', { skip }, async () => {
  const burgh = await (await fetch(`${base}/tabularius/app/v1/databases/Burgh/layouts`, { headers: await login('Burgh') })).json();
  assert.equal(burgh.openLayout, 'Main Menu');
  assert.equal(burgh.onFirstWindowOpen, undefined);
  const auth = await login('Charts');
  const menu = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts`, { headers: auth })).json();
  assert.equal(menu.openLayout, 'Chart Types • Choosing');
  assert.equal(menu.onFirstWindowOpen, true);
  const r = await post('Charts', 'Home', 'button', { trigger: 'OnFirstWindowOpen', mode: 'browse' }, auth);
  assert.equal(r.error, 0, r.message);
  assert.equal(r.script, '[trg] set layoutlist');
  const none = await post('Charts', 'Home', 'button', { trigger: 'OnLastWindowClose', mode: 'browse' }, auth);
  assert.equal(none.error.code, 3);
});

test('web client: the custom menu set the file opens with, worked out for a record', { skip }, async () => {
  const auth = await login('Std');
  const menu = await (await fetch(`${base}/tabularius/app/v1/databases/Std/layouts`, { headers: auth })).json();
  assert.equal(menu.customMenus, true);
  assert.equal(menu.openLayout, '@Startup');
  const r = await post('Std', '@Startup', 'menus', { mode: 'browse' }, auth);
  // "Application Default": the app menu, Edit and View; "File: App" has no items and is left out.
  assert.deepEqual(r.menus.map((m: any) => m.title), ['Application Name', 'Edit: App', 'View: App']);
  const about = r.menus[0].items.find((i: any) => i.command === 'About FileMaker Pro');
  assert.equal(about.title, 'About Application...');
  const find = r.menus[2].items[0];
  assert.equal(find.command, 'Find Mode');
  assert.equal(find.title, ''); // $$MENU.VIEW.FIND, set by the file's startup script
  // Script items run only from the menu set in use: the Developer set's aren't.
  const off = await post('Std', '@Startup', 'button', { menuItem: [32, 0], mode: 'browse' }, auth);
  assert.equal(off.error.code, 3);
  const none = await post('Charts', 'Home', 'menus', { mode: 'browse' }, await login('Charts'));
  assert.equal(none.standard, true);
});

test('web client: Install Menu Set switches the menu set the client asks for', { skip }, async () => {
  const auth = await login('Std');
  // The client sends the set a script installed: the Developer set, whose script items then run.
  const dev = await post('Std', '@Startup', 'menus', { mode: 'browse', menuSet: 3 }, auth);
  assert.ok(dev.menus.length && !dev.standard);
  assert.notDeepEqual(dev.menus.map((m: any) => m.title), ['Application Name', 'Edit: App', 'View: App']);
  const on = await post('Std', '@Startup', 'button', { menuItem: [32, 0], menuSet: 3, mode: 'browse' }, auth);
  assert.notEqual(on.error?.code, 3);
  // Set 1 is FileMaker's standard menus; a set the file doesn't have falls back to the file's default.
  assert.equal((await post('Std', '@Startup', 'menus', { mode: 'browse', menuSet: 1 }, auth)).standard, true);
  assert.equal((await post('Std', '@Startup', 'menus', { mode: 'browse', menuSet: 99 }, auth)).menus[0].title, 'Application Name');
});

test('web client: a layout\'s own menu set, unless one is installed', { skip }, async () => {
  const auth = await login('Std');
  const design = (changes: unknown[]) => fetch(`${base}/tabularius/design/v1/databases/Std`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ changes }) }).then((r) => r.json());
  const titles = async (body: Record<string, unknown> = {}) => {
    const r = await post('Std', '@Startup', 'menus', { mode: 'browse', ...body }, auth);
    return r.standard ? 'standard' : r.menus.map((m: any) => m.title).join(',');
  };
  const fileDefault = await titles();
  try {
    // Layout Setup: FileMaker's standard menus, then the Developer set.
    await design([{ op: 'updateLayout', layout: '@Startup', design: { menuSetId: 1 } }]);
    assert.equal(await titles(), 'standard');
    await design([{ op: 'updateLayout', layout: '@Startup', design: { menuSetId: 3 } }]);
    const developer = await titles();
    assert.notEqual(developer, fileDefault);
    // An installed set (Install Menu Set) wins over the layout's.
    assert.equal(await titles({ menuSet: 5 }), fileDefault);
  } finally {
    await design([{ op: 'updateLayout', layout: '@Startup', design: { menuSetId: 0 } }]);
  }
  assert.equal(await titles(), fileDefault);
});

test('web client: a one-step button runs its step on the server', { skip }, async () => {
  const auth = await login('Flicks');
  const layout = 'WV Framework - Modules';
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Flicks/layouts/${encodeURIComponent(layout)}`, { headers: auth })).json();
  const btn = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; })
    .find((o: any) => o.action?.step === 'Set Field');
  assert.ok(btn, 'the layout has a Set Field button');
  const records = await (await fetch(`${base}/fmi/data/vLatest/databases/Flicks/layouts/${encodeURIComponent(layout)}/records?_limit=1`, { headers: auth })).json();
  const rec = records.response.data[0];
  await fetch(`${base}/fmi/data/vLatest/databases/Flicks/layouts/${encodeURIComponent(layout)}/records/${rec.recordId}`, {
    method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { payload_name: '' } }),
  });
  const r = await post('Flicks', layout, 'button', { objectId: btn.id, recordId: Number(rec.recordId), mode: 'browse' }, auth);
  assert.equal(r.error, 0, r.message);
  const after = hosted.get('Flicks')!.get(layout, Number(rec.recordId)).fieldData;
  // The file name of the record's container, or else its name.
  assert.notEqual(after.payload_name, '');
  assert.ok([after.name].includes(after.payload_name) || /\./.test(String(after.payload_name)), String(after.payload_name));
});

test('web client: a button script that asks for a file waits for the browser to send one', { skip }, async () => {
  const auth = await login('Charts');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Home`, { headers: auth })).json();
  const btn = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; })
    .find((o: any) => o.action?.script === '[btn] Go to next layout');
  // Swap the button's script for one that asks twice, with an action before the first ask.
  const script = hosted.get('Charts')!.schema.scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const saved = script.steps;
  const step = (stepId: number, name: string, params: Record<string, unknown>) => ({ stepId, name, enabled: true, params });
  script.steps = [
    step(111, 'Open URL', { calculation: '"https://example.com/"', noDialog: true }),
    step(131, 'Insert File', { variable: '$a', title: '"Pick a photo"' }),
    step(141, 'Set Variable', { variable: '$e', value: 'Get ( LastError )' }),
    step(131, 'Insert File', { variable: '$b' }),
    step(103, 'Exit Script', { calculation: '$a & "/" & Base64Encode ( $a ) & "/" & $e & "/" & Get ( LastError ) & "/" & $b' }),
  ] as typeof saved;
  try {
    const first = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    assert.equal(first.waiting.step, 'Insert File');
    assert.equal(first.waiting.title, 'Pick a photo');
    assert.equal(first.actions.length, 1);
    assert.equal(first.actions[0].step, 'Open URL');
    const answer = (run: string, body: unknown, headers = auth) =>
      fetch(`${base}/tabularius/app/v1/databases/Charts/runs/${run}/file`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });

    // Another session can't answer it.
    const other = await login('Charts');
    assert.equal((await answer(first.waiting.run, { cancel: true }, other)).status, 404);

    const second = await (await answer(first.waiting.run, { filename: 'hi.txt', data: Buffer.from('hi').toString('base64') })).json();
    assert.ok(second.waiting && second.waiting.run, 'asks again');
    assert.equal(second.actions.length, 0);
    assert.equal((await answer(first.waiting.run, { cancel: true })).status, 404, 'an answered run is gone');

    const done = await (await answer(second.waiting.run, { cancel: true })).json();
    assert.equal(done.waiting, undefined);
    assert.equal(done.error, 1);
    assert.equal(done.result, 'hi.txt/aGk=/0/1/');
    assert.deepEqual(done.actions, []);
  } finally {
    script.steps = saved;
  }
});

test('web client: Pause/Resume Script waits for Continue or Cancel; Preview mode and Print reach the browser', { skip }, async () => {
  const auth = await login('Charts');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Home`, { headers: auth })).json();
  const btn = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; })
    .find((o: any) => o.action?.script === '[btn] Go to next layout');
  const script = hosted.get('Charts')!.schema.scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const saved = script.steps;
  const step = (stepId: number, name: string, params: Record<string, unknown> = {}) => ({ stepId, name, enabled: true, params });
  script.steps = [
    step(6, 'Go to Layout', { layoutDestination: 'named', layout: { id: 0, name: 'Congress' } }),
    step(41, 'Enter Preview Mode'),
    step(62, 'Pause/Resume Script'),
    step(141, 'Set Variable', { variable: '$mode', value: 'Get ( WindowMode )' }),
    step(43, 'Print'),
    step(103, 'Exit Script', { calculation: '$mode' }),
  ] as typeof saved;
  const answer = async (run: string, body: unknown) =>
    (await fetch(`${base}/tabularius/app/v1/databases/Charts/runs/${run}/file`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    // Paused: the browser sees the window the script left, in Preview mode.
    const paused = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    assert.equal(paused.waiting.step, 'Pause');
    assert.equal(paused.layout, 'Congress');
    assert.equal(paused.preview, true);
    assert.ok(paused.foundSet.length > 0);
    const done = await answer(paused.waiting.run, {});
    assert.equal(done.waiting, undefined);
    assert.equal(done.result, '2'); // Get ( WindowMode ) is 2 in Preview mode
    assert.equal(done.preview, true);
    assert.deepEqual(done.actions.map((a: any) => a.step), ['Print']);
    // Cancel halts the script where it paused.
    const again = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    const canceled = await answer(again.waiting.run, { cancel: true });
    assert.equal(canceled.result, '');
    assert.deepEqual(canceled.actions, []);
  } finally {
    script.steps = saved;
  }
});

test('web client: Show Custom Dialog waits for a button and stores the inputs', { skip }, async () => {
  const auth = await login('Charts');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Home`, { headers: auth })).json();
  const btn = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; })
    .find((o: any) => o.action?.script === '[btn] Go to next layout');
  const script = hosted.get('Charts')!.schema.scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const saved = script.steps;
  const step = (stepId: number, name: string, params: Record<string, unknown> = {}) => ({ stepId, name, enabled: true, params });
  script.steps = [
    step(141, 'Set Variable', { variable: '$name', value: '"guest"' }),
    step(87, 'Show Custom Dialog', { title: '"Hello"', message: '"Your name?"', buttons: ['"OK"', '"Cancel"'], inputs: [{ variable: '$name', label: '"Name"' }] }),
    step(103, 'Exit Script', { calculation: 'Get ( LastMessageChoice ) & "/" & $name' }),
  ] as typeof saved;
  const answer = async (run: string, body: unknown) =>
    (await fetch(`${base}/tabularius/app/v1/databases/Charts/runs/${run}/file`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    const asked = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    assert.equal(asked.waiting.step, 'Dialog');
    assert.equal(asked.waiting.title, 'Hello');
    assert.equal(asked.waiting.message, 'Your name?');
    assert.deepEqual(asked.waiting.buttons, ['OK', 'Cancel']);
    assert.deepEqual(asked.waiting.inputs, [{ label: 'Name', value: 'guest', password: false }]);
    assert.equal(asked.layout, 'Home');
    const bad = await answer(asked.waiting.run, { button: 7 });
    assert.equal(bad.error.code, 960);
    const done = await answer(asked.waiting.run, { button: 1, inputs: ['Ada'] });
    assert.equal(done.result, '1/Ada');
    const again = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    const closed = await answer(again.waiting.run, { cancel: true });
    assert.equal(closed.result, '2/guest');
  } finally {
    script.steps = saved;
  }
});

test('web client: Sort Records with its dialog waits for the order a person picks', { skip }, async () => {
  const auth = await login('Charts');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Home`, { headers: auth })).json();
  const btn = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; })
    .find((o: any) => o.action?.script === '[btn] Go to next layout');
  const script = hosted.get('Charts')!.schema.scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const saved = script.steps;
  const step = (stepId: number, name: string, params: Record<string, unknown> = {}) => ({ stepId, name, enabled: true, params });
  script.steps = [
    step(6, 'Go to Layout', { layoutDestination: 'named', layout: { id: 0, name: 'Congress' } }),
    step(86, 'Set Error Capture', { on: true }),
    step(39, 'Sort Records', { noDialog: false }),
    step(103, 'Exit Script', { calculation: 'Get ( LastError ) & "/" & Get ( SortState )' }),
  ] as typeof saved;
  const answer = async (run: string, body: unknown) =>
    (await fetch(`${base}/tabularius/app/v1/databases/Charts/runs/${run}/file`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const field = hosted.get('Charts')!.layout('Congress').fields.find((f) => f.type === 'text')!.name;
  try {
    const asked = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    assert.equal(asked.waiting.step, 'Sort');
    assert.deepEqual(asked.waiting.sort, []);
    assert.equal(asked.layout, 'Congress');
    const done = await answer(asked.waiting.run, { sort: [{ fieldName: field, sortOrder: 'descend' }] });
    assert.equal(done.result, '0/1');
    assert.deepEqual(done.sort, [{ fieldName: field, sortOrder: 'descend' }]);
    const again = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    const canceled = await answer(again.waiting.run, { cancel: true });
    assert.equal(canceled.result, '1/0');
  } finally {
    script.steps = saved;
  }
});

test('web client: Insert from Index waits for the value a person picks from the index', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Home`, { headers: auth })).json();
  const btn = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; })
    .find((o: any) => o.action?.script === '[btn] Go to next layout');
  const script = store.schema.scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const saved = script.steps;
  const step = (stepId: number, name: string, params: Record<string, unknown> = {}) => ({ stepId, name, enabled: true, params });
  const to = store.layout('Congress').occurrence;
  script.steps = [
    step(6, 'Go to Layout', { layoutDestination: 'named', layout: { id: 0, name: 'Congress' } }),
    step(86, 'Set Error Capture', { on: true }),
    step(11, 'Insert from Index', { selectEntireContents: true, field: { tableOccurrence: { id: 0, name: to }, field: { id: 0, name: 'State' } } }),
    step(141, 'Set Variable', { variable: '$e', value: 'Get ( LastError ) & "/" & Congress::State' }),
    step(51, 'Revert Record/Request', { noDialog: true }),
    step(103, 'Exit Script', { calculation: '$e' }),
  ] as typeof saved;
  const answer = async (run: string, body: unknown) =>
    (await fetch(`${base}/tabularius/app/v1/databases/Charts/runs/${run}/file`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    const asked = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    assert.equal(asked.waiting.step, 'Index');
    assert.equal(asked.waiting.field, `${to}::State`);
    assert.deepEqual(asked.waiting.values, store.fieldIndex('Congress', 'State', { limit: 2000 }));
    assert.ok(asked.waiting.values.length > 1);
    assert.equal(asked.layout, 'Congress');
    const pick = asked.waiting.values[1];
    const bad = await answer(asked.waiting.run, { value: 42 });
    assert.equal(bad.error.code, 960);
    const done = await answer(asked.waiting.run, { value: pick });
    assert.equal(done.result, `0/${pick}`);
    // A value the index doesn't hold is a cancel, as the dialog offers no way to type one.
    const again = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    assert.equal((await answer(again.waiting.run, { value: 'not in the index' })).result.split('/')[0], '1');
    const third = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    assert.equal((await answer(third.waiting.run, { cancel: true })).result.split('/')[0], '1');
  } finally {
    script.steps = saved;
  }
});

test('web client: the person can stop their own running script, but not someone else\'s', { skip }, async () => {
  const auth = await login('Charts');
  const other = await login('Charts');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Home`, { headers: auth })).json();
  const btn = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; })
    .find((o: any) => o.action?.script === '[btn] Go to next layout');
  const script = hosted.get('Charts')!.schema.scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const saved = script.steps;
  const step = (stepId: number, name: string, params: Record<string, unknown> = {}) => ({ stepId, name, enabled: true, params });
  script.steps = [
    step(62, 'Pause/Resume Script', { calculation: '5' }),
    step(103, 'Exit Script', { calculation: '"finished"' }),
  ] as typeof saved;
  const stop = async (headers: Record<string, string>) =>
    (await fetch(`${base}/tabularius/app/v1/databases/Charts/runs/stop`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' })).json();
  try {
    assert.deepEqual(await stop(auth), { stopped: 0 });
    const started = Date.now();
    const running = post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(await stop(other), { stopped: 0 }); // another session's Esc reaches only its own scripts
    assert.deepEqual(await stop(auth), { stopped: 1 });
    const r = await running;
    assert.ok(Date.now() - started < 3000);
    assert.notEqual(r.result, 'finished');
    assert.ok(r.actions.some((a: any) => a.step === 'Halt Script' && a.reason === 'canceled by the user'), JSON.stringify(r));
    assert.deepEqual(await stop(auth), { stopped: 0 });
  } finally {
    script.steps = saved;
  }
});

test('web client: Records menu commands run as their script steps', { skip }, async () => {
  const auth = await login('Charts');
  const ids = hosted.get('Charts')!.findIds('Congress').slice(0, 3);
  const omit = await post('Charts', 'Congress', 'button', { command: 'Omit Record', ids, recordId: ids[1], mode: 'browse' }, auth);
  assert.equal(omit.error, 0, omit.message);
  assert.deepEqual(omit.foundSet, [ids[0], ids[2]]);
  const omitted = await post('Charts', 'Congress', 'button', { command: 'Show Omitted Only', ids: omit.foundSet, recordId: ids[0], mode: 'browse' }, auth);
  assert.ok(omitted.foundSet.includes(ids[1]) && !omitted.foundSet.includes(ids[0]));
  const bad = await post('Charts', 'Congress', 'button', { command: 'Erase Everything', ids, mode: 'browse' }, auth);
  assert.equal(bad.error.code, 3);
});

test('web client: Omit Multiple, Replace Field Contents and Delete All Records act on the found set', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  const ids = store.findIds('Congress').slice(0, 5);
  const omit = await post('Charts', 'Congress', 'button', { command: 'Omit Multiple', count: 2, ids, recordId: ids[1], mode: 'browse' }, auth);
  assert.equal(omit.error, 0, omit.message);
  assert.deepEqual(omit.foundSet, [ids[0], ids[3], ids[4]]);
  // Two records of its own, so the sample's records stay as they are for other tests.
  const made = [store.create('Congress', { Name: 'Replace test 1' }).recordId, store.create('Congress', { Name: 'Replace test 2' }).recordId];
  const replaced = await post('Charts', 'Congress', 'button', { command: 'Replace Field Contents', field: 'State', value: 'Say "hi" \\ there', ids: made, recordId: made[0], mode: 'browse' }, auth);
  assert.equal(replaced.error, 0, replaced.message);
  for (const id of made) assert.equal(store.get('Congress', id)!.fieldData.State, 'Say "hi" \\ there');
  const noField = await post('Charts', 'Congress', 'button', { command: 'Replace Field Contents', ids: made, mode: 'browse' }, auth);
  assert.equal(noField.error.code, 3);
  const deleted = await post('Charts', 'Congress', 'button', { command: 'Delete All Records', ids: made, mode: 'browse' }, auth);
  assert.equal(deleted.error, 0, deleted.message);
  assert.deepEqual(deleted.foundSet, []);
  for (const id of made) assert.throws(() => store.get('Congress', id), /Record is missing/);
  // Unlike FileMaker, the delete can be taken back: the records come back as they were.
  assert.equal(deleted.undo.kind, 'delete');
  assert.equal(deleted.undo.summary, 'Deleted 2 records');
  const undone = await fetch(`${base}/tabularius/cleanup/v1/databases/Charts/history/${deleted.undo.id}/undo`, { method: 'POST', headers: auth }).then((x) => x.json());
  assert.equal(undone.undone, 2);
  for (const id of made) assert.equal(store.get('Congress', id)!.fieldData.State, 'Say "hi" \\ there');
  // Delete Record takes the current record only, and can be undone too.
  const one = await post('Charts', 'Congress', 'button', { command: 'Delete Record', ids: made, recordId: made[1], mode: 'browse' }, auth);
  assert.equal(one.error, 0, one.message);
  assert.deepEqual(one.foundSet, [made[0]]);
  assert.throws(() => store.get('Congress', made[1]), /Record is missing/);
  assert.equal(one.undo.summary, 'Deleted 1 record');
  await fetch(`${base}/tabularius/cleanup/v1/databases/Charts/history/${one.undo.id}/undo`, { method: 'POST', headers: auth });
  assert.equal(store.get('Congress', made[1])!.fieldData.State, 'Say "hi" \\ there');
  for (const id of made) store.delete('Congress', id);
});

test('web client: Replace Field Contents with serial numbers or a calculated result', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  const made = [store.create('Congress', { Name: 'Ann' }).recordId, store.create('Congress', { Name: 'Bob' }).recordId];
  try {
    const serial = await post('Charts', 'Congress', 'button', { command: 'Replace Field Contents', field: 'State', replaceWith: 'serial', serial: { initial: 'A1', increment: '2' }, ids: made, recordId: made[0], mode: 'browse' }, auth);
    assert.equal(serial.error, 0, serial.message);
    assert.deepEqual(made.map((id) => store.get('Congress', id)!.fieldData.State), ['A1', 'A3']);
    const calc = await post('Charts', 'Congress', 'button', { command: 'Replace Field Contents', field: 'State', replaceWith: 'calculation', calculation: 'Upper ( Name ) & "!"', ids: made, recordId: made[0], mode: 'browse' }, auth);
    assert.equal(calc.error, 0, calc.message);
    assert.deepEqual(made.map((id) => store.get('Congress', id)!.fieldData.State), ['ANN!', 'BOB!']);
    // Unlike FileMaker, the replace can be taken back: the values before it come back.
    assert.equal(calc.undo.summary, 'Replaced State in 2 records');
    const undone = await fetch(`${base}/tabularius/cleanup/v1/databases/Charts/history/${calc.undo.id}/undo`, { method: 'POST', headers: auth }).then((x) => x.json());
    assert.equal(undone.undone, 2);
    assert.deepEqual(made.map((id) => store.get('Congress', id)!.fieldData.State), ['A1', 'A3']);
    await post('Charts', 'Congress', 'button', { command: 'Replace Field Contents', field: 'State', replaceWith: 'calculation', calculation: 'Upper ( Name ) & "!"', ids: made, recordId: made[0], mode: 'browse' }, auth);
    // A typed calculation can read any field, so only full access may replace with one.
    store.setPassword('Replacer', 'pw', '[Data Entry Only]');
    const entry = store.schema.privilegeSets.find((x) => x.name === '[Data Entry Only]')!;
    if (!entry.extendedPrivileges.includes('fmrest')) entry.extendedPrivileges.push('fmrest');
    const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Replacer:pw') } });
    const clerk = { authorization: `Bearer ${(await r.json()).response.token}` };
    const denied = await post('Charts', 'Congress', 'button', { command: 'Replace Field Contents', field: 'State', replaceWith: 'calculation', calculation: '"x"', ids: made, recordId: made[0], mode: 'browse' }, clerk);
    assert.equal(denied.error.code, 9);
    assert.deepEqual(made.map((id) => store.get('Congress', id)!.fieldData.State), ['ANN!', 'BOB!']);
    const typed = await post('Charts', 'Congress', 'button', { command: 'Replace Field Contents', field: 'State', value: 'ok', ids: made, recordId: made[0], mode: 'browse' }, clerk);
    assert.equal(typed.error, 0, typed.message);
  } finally {
    for (const id of made) store.delete('Congress', id);
  }
});

test('web client: Edit > Find/Replace replaces all matches in the fields named, and Undo takes it back', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  const made = [store.create('Congress', { Name: 'Ann Lee', State: 'ann' }).recordId, store.create('Congress', { Name: 'Joann', State: 'NY' }).recordId];
  const names = () => made.map((id) => `${store.get('Congress', id)!.fieldData.Name}|${store.get('Congress', id)!.fieldData.State}`);
  try {
    const body = { command: 'Replace All', find: 'ann', replace: 'Anne', ids: made, recordId: made[0], mode: 'browse' };
    // Only the fields named: State is left alone. Whole words: "Joann" doesn't match.
    const r = await post('Charts', 'Congress', 'button', { ...body, fields: ['Name'], wholeWords: true }, auth);
    assert.equal(r.error, 0, r.message);
    assert.deepEqual(names(), ['Anne Lee|ann', 'Joann|NY']);
    assert.equal(r.undo.summary, 'Replaced “ann” in 1 record');
    // Match case: "ann" in Joann and State, not "Ann" (now "Anne").
    const cased = await post('Charts', 'Congress', 'button', { ...body, fields: ['Name', 'State'], matchCase: true }, auth);
    assert.deepEqual(names(), ['Anne Lee|Anne', 'JoAnne|NY']);
    assert.equal(cased.undo.summary, 'Replaced “ann” in 2 records');
    const undone = await fetch(`${base}/tabularius/cleanup/v1/databases/Charts/history/${cased.undo.id}/undo`, { method: 'POST', headers: auth }).then((x) => x.json());
    assert.equal(undone.undone, 2);
    assert.deepEqual(names(), ['Anne Lee|ann', 'Joann|NY']);
    // The current record only; nothing to change is told as such.
    await post('Charts', 'Congress', 'button', { ...body, fields: ['Name', 'State'], currentRecord: true, recordId: made[1] }, auth);
    assert.deepEqual(names(), ['Anne Lee|ann', 'JoAnne|NY']);
    const none = await post('Charts', 'Congress', 'button', { ...body, find: 'zzz', fields: ['Name'] }, auth);
    assert.equal(none.error, 0);
    assert.equal(none.replaced, 0);
    assert.equal((await post('Charts', 'Congress', 'button', { ...body, fields: [] }, auth)).error.code, 3);
  } finally {
    for (const id of made) store.delete('Congress', id);
  }
});

test('web client: files a script saves (Save Records as PDF) download to the browser, as in WebDirect', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  const id = store.create('Congress', { Name: 'Pdf Person' }).recordId;
  try {
    const r = await post('Charts', 'Congress', 'button', { command: 'Save Records as PDF', name: 'People', records: 'current', ids: [id], recordId: id, mode: 'browse' }, auth);
    assert.equal(r.error, 0, r.message);
    const file = r.actions.find((a: { download?: string }) => a.download);
    assert.equal(file.download, 'People.pdf');
    assert.equal(Buffer.from(file.base64, 'base64').subarray(0, 5).toString(), '%PDF-');
  } finally {
    store.delete('Congress', id);
  }
});

test('web client: Relookup Field Contents copies looked-up values again for the found set', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  store.applyDesign([
    { op: 'createTable', name: 'RL Products', fields: [{ name: 'Code', type: 'text' }, { name: 'Price', type: 'number' }] },
    { op: 'createTable', name: 'RL Lines', fields: [{ name: 'Code', type: 'text' }, { name: 'Price', type: 'number' }] },
    { op: 'createRelationship', left: 'RL Lines', right: 'RL Products', predicates: [{ left: 'Code', right: 'Code' }] },
  ]);
  store.applyDesign([{ op: 'updateField', table: 'RL Lines', field: 'Price', options: { autoEnter: { lookup: { occurrence: 'RL Products', field: 'Price' } as never } } }]);
  const a = store.create('RL Products', { Code: 'A', Price: '1' }).recordId;
  const lines = [store.create('RL Lines', { Code: 'A' }).recordId, store.create('RL Lines', { Code: 'A' }).recordId];
  store.update('RL Products', a, { Price: '7' });
  const r = await post('Charts', 'RL Lines', 'button', { command: 'Relookup Field Contents', field: 'Code', ids: lines.slice(0, 1), recordId: lines[0], mode: 'browse' }, auth);
  assert.equal(r.error, 0, r.message);
  assert.deepEqual(lines.map((id) => Number(store.get('RL Lines', id)!.fieldData.Price)), [7, 1], 'only the found set');
  assert.equal((await post('Charts', 'RL Lines', 'button', { command: 'Relookup Field Contents', ids: lines, mode: 'browse' }, auth)).error.code, 3);
});

test('web client: Copy with no field active puts the record on the person\'s clipboard', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  store.applyDesign([{ op: 'createTable', name: 'CR Items', fields: [{ name: 'Name', type: 'text' }, { name: 'Note', type: 'text' }] }]);
  const id = store.create('CR Items', { Name: 'one', Note: 'a\rb' }).recordId;
  const r = await post('Charts', 'CR Items', 'button', { command: 'Copy Record', ids: [id], recordId: id, mode: 'browse' }, auth);
  assert.equal(r.error, 0, r.message);
  // Fields are separated by tabs; returns in a field become vertical tabs, as in FileMaker.
  assert.deepEqual(r.actions.map((a: { clipboard?: string }) => a.clipboard), ['one\ta\vb']);
});

test('web client: Export Records downloads the found set as CSV, tab-separated text or Excel', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  const made = [store.create('Congress', { Name: 'Export "one"', State: 'A\rB' }).recordId, store.create('Congress', { Name: 'Export two', State: 'C\tD' }).recordId, store.create('Congress', { Name: 'Control', State: '\t=1+1' }).recordId];
  const download = (body: unknown) => fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress/export`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  // A script's found set keeps its order.
  const csv = await download({ fields: ['Name', 'State'], format: 'csv', ids: [made[1], made[2], made[0]], fieldNames: true });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition')!, /filename\*=UTF-8''Congress\.csv/);
  assert.equal(await csv.text(), '"Name","State"\r\n"Export two","C\\u0009D"\r\n"Control","\'\\u0009=1+1"\r\n"Export ""one""","A\vB"\r\n');
  const tab = await download({ fields: ['Name', 'State'], format: 'tab', ids: made, name: 'out' });
  assert.match(tab.headers.get('content-disposition')!, /''out\.tab/);
  // A value a spreadsheet would take for a formula gets an apostrophe in tab-separated text too, as in comma-separated.
  assert.equal(await tab.text(), 'Export "one"\tA\vB\r\nExport two\tC\\u0009D\r\nControl\t\'\\u0009=1+1\r\n');
  const xl = await download({ fields: ['Name'], format: 'xlsx', ids: made });
  assert.equal(xl.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(Buffer.from(await xl.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const none = await download({ fields: [], format: 'csv', ids: made });
  assert.equal((await none.json()).error.code, 3);
  for (const id of made) store.delete('Congress', id);
});

test('web client: a text export keeps a number field\'s minus sign, guards text, and starts with a byte order mark when asked', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  store.applyDesign([{ op: 'createTable', name: 'CSV Rows', fields: [{ name: 'Label', type: 'text' }, { name: 'Amount', type: 'number' }] }]);
  const id = store.create('CSV Rows', { Label: '-42', Amount: '-42' }).recordId;
  const download = (body: unknown) => fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/CSV%20Rows/export`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const csv = await download({ fields: ['Label', 'Amount'], format: 'csv', ids: [id] });
  assert.equal(await csv.text(), '"\'-42","-42"\r\n');
  const tab = await download({ fields: ['Label', 'Amount'], format: 'tab', ids: [id] });
  assert.equal(await tab.text(), "'-42\t-42\r\n");
  const plain = Buffer.from(await (await download({ fields: ['Label'], format: 'csv', ids: [id] })).arrayBuffer());
  assert.notDeepEqual([...plain.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const marked = Buffer.from(await (await download({ fields: ['Label'], format: 'csv', ids: [id], bom: true })).arrayBuffer());
  assert.deepEqual([...marked.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  store.delete('CSV Rows', id);
});

test('web client: Import Records reads semicolon and UTF-16 files, undoes the export\'s apostrophe for numbers, and says when a quote never closes', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  store.applyDesign([{ op: 'createTable', name: 'IMP Rows', fields: [{ name: 'Label', type: 'text' }, { name: 'Amount', type: 'number' }] }]);
  const send = (name: string, data: Uint8Array | string, query: string) => {
    const form = new FormData();
    form.append('upload', new Blob([typeof data === 'string' ? data : new Uint8Array(data)]), name);
    return fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/IMP%20Rows/import?${query}`, { method: 'POST', headers: auth, body: form }).then((r) => r.json());
  };
  const semi = await send('x.csv', 'Label;Amount\r\nA;1\r\n', 'preview=1');
  assert.deepEqual(semi.rows[1], ['A', '1']);
  const utf16 = await send('x.csv', new Uint8Array([0xff, 0xfe, ...Buffer.from('Label,Amount\r\nZoë,2\r\n', 'utf16le')]), 'preview=1');
  assert.deepEqual(utf16.rows[1], ['Zoë', '2']);
  const open = await send('x.csv', 'Label,Amount\r\n"A,1\r\nB,2\r\n', 'preview=1');
  assert.match(open.notices[0], /row 2 is never closed/);
  const mapping = `mapping=${encodeURIComponent(JSON.stringify(['Label', 'Amount']))}&skipFirst=1`;
  const r = await send('x.csv', 'Label,Amount\r\n"\'-42","\'-42"\r\n', mapping);
  const row = store.get('IMP Rows', r.foundSet[0])!.fieldData;
  assert.equal(row.Label, "'-42", 'text keeps what it was given');
  assert.equal(String(row.Amount), '-42', 'a number field takes the number');
  store.delete('IMP Rows', r.foundSet[0]);
});

test('web client: Excel export has typed date cells and a bold, frozen, filterable header row', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  store.applyDesign([{ op: 'createTable', name: 'XL Events', fields: [{ name: 'Title', type: 'text' }, { name: 'Day', type: 'date' }, { name: 'Start', type: 'time' }] }]);
  const id = store.create('XL Events', { Title: 'Launch', Day: '10/15/2026', Start: '13:45:00' }).recordId;
  const res = await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/XL%20Events/export`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ fields: ['Title', 'Day', 'Start'], format: 'xlsx', ids: [id], fieldNames: true }),
  });
  assert.equal(res.status, 200);
  const sheet = new TextDecoder().decode(unzipXlsx(new Uint8Array(await res.arrayBuffer())).get('xl/worksheets/sheet1.xml'));
  assert.match(sheet, /<autoFilter ref="A1:C2"\/>/);
  assert.match(sheet, /<c r="A1" s="1" t="inlineStr">/);
  assert.match(sheet, /<c r="B2" s="2"><v>46310<\/v><\/c>/);
  assert.match(sheet, /<c r="C2" s="3"><v>0\.5729166/);
  store.delete('XL Events', id);
});

test('web client: a masked field exports empty (the stand-in is not data), and shows read-only in the layout', { skip }, async () => {
  const store = hosted.get('Charts')!;
  const id = store.create('Congress', { Name: 'Mask export', State: 'ZZ-1234' }).recordId;
  const full = store.privilegeSet('[Data Entry Only]')!;
  store.savePrivilegeSet({ ...full, name: 'Maskers', id: undefined, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest', 'fmapp'])], layouts: 'modifiable', exporting: true,
    records: { view: true, edit: false, create: false, delete: false }, tables: undefined } as never);
  const set = store.privilegeSet('Maskers')!;
  store.savePrivilegeSet({ ...set, tables: { Congress: { view: true, edit: false, create: false, delete: false, fields: { State: 'masked' } } } } as never);
  store.setPassword('Masker', 'pw', 'Maskers');
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Masker:pw') } });
  const auth = { authorization: `Bearer ${(await r.json()).response.token}` };
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress`, { headers: auth })).json();
  const state = meta.fields.Congress.find((f: { name: string }) => f.name === 'State');
  assert.equal(state.masked, true);
  assert.equal(state.readOnly, true);
  const res = await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress/export`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ fields: ['Name', 'State'], format: 'csv', ids: [id], fieldNames: true }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, '"Name","State"\r\n"Mask export",""\r\n');
  assert.ok(!text.includes('1234') && !text.includes('•'));
  store.delete('Congress', id);
});

test('web client: Import Records previews a file, then adds its rows as records', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  const send = (name: string, text: string, query: string) => {
    const form = new FormData();
    form.append('upload', new Blob([text]), name);
    return fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress/import?${query}`, { method: 'POST', headers: auth, body: form }).then((r) => r.json());
  };
  const csv = 'State,Name\r\n"ZZ","Import, one"\r\nZY,Import two\r\n';
  const preview = await send('people.csv', csv, 'preview=1');
  assert.equal(preview.count, 3);
  assert.deepEqual(preview.rows[1], ['ZZ', 'Import, one']);
  assert.ok(preview.fields.includes('Name') && preview.fields.includes('State'));
  const r = await send('people.csv', csv, `mapping=${encodeURIComponent(JSON.stringify(['State', 'Name']))}&skipFirst=1`);
  assert.equal(r.imported, 2, JSON.stringify(r));
  assert.deepEqual(r.foundSet.map((id: number) => store.get('Congress', id)!.fieldData.Name), ['Import, one', 'Import two']);
  assert.deepEqual(r.foundSet.map((id: number) => store.get('Congress', id)!.fieldData.State), ['ZZ', 'ZY']);
  // Tab-separated text: vertical tabs are line breaks; an unmapped column is left out.
  const tab = await send('t.tab', 'Import\vthree\tXX\r\n', `mapping=${encodeURIComponent(JSON.stringify(['Name', null]))}`);
  assert.equal(store.get('Congress', tab.foundSet[0])!.fieldData.Name, 'Import\nthree');
  assert.equal(store.get('Congress', tab.foundSet[0])!.fieldData.State, '');
  assert.equal((await send('t.tab', 'x\r\n', 'mapping=%5B%5D')).error.code, 3);
  assert.equal((await send('t.pdf', 'x', 'preview=1')).error.code, 3);
  for (const id of [...r.foundSet, ...tab.foundSet]) store.delete('Congress', id);
});

test('web client: Constrain and Extend Found Set use the requests typed in Find mode', { skip }, async () => {
  const auth = await login('Charts');
  const store = hosted.get('Charts')!;
  const senate = store.findIds('Congress', { query: [{ Chamber: 'Senate' }] });
  const ca = store.findIds('Congress', { query: [{ State: 'CA' }] });
  assert.ok(senate.length && ca.length);
  const requests = [{ criteria: { State: 'CA' }, omit: false }];
  const constrained = await post('Charts', 'Congress', 'button', { command: 'Constrain Found Set', ids: senate, mode: 'find', requests }, auth);
  assert.equal(constrained.error, 0, constrained.message);
  assert.deepEqual(constrained.foundSet, senate.filter((id) => ca.includes(id)));
  assert.equal(constrained.mode, 'browse');
  const extended = await post('Charts', 'Congress', 'button', { command: 'Extend Found Set', ids: senate, mode: 'find', requests }, auth);
  assert.deepEqual(extended.foundSet, [...senate, ...ca.filter((id) => !senate.includes(id))]);
  const none = await post('Charts', 'Congress', 'button', { command: 'Constrain Found Set', ids: senate, mode: 'find', requests: [{ criteria: { State: 'nowhere' }, omit: false }] }, auth);
  assert.equal(none.error, 401);
});

/** The Data API needs the fmrest extended privilege, which the sample files' [Full Access] lacks. */
function grantRest(store: Store): void {
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
}

test('web client: Install OnTimer Script gives the window a timer id that runs only that script', { skip }, async () => {
  const store = hosted.get('Charts')!;
  const home = store.layout('Home');
  store.applyDesign([
    { op: 'createScript', name: 'Tick', text: 'Set Variable [ $$ticks ; Value: $$ticks + 1 ]\nExit Script [ Text Result: Get ( ScriptParameter ) & "/" & $$ticks ]' },
    { op: 'createScript', name: 'Start Timer', text: 'Install OnTimer Script [ “Tick” ; Parameter: Get ( LayoutName ) & "!" ; Interval: 0.5 ]' },
    { op: 'createScript', name: 'Stop Timer', text: 'Install OnTimer Script' },
  ]);
  const id = (name: string) => store.schema.scripts.find((s) => s.name === name)!.id;
  const design = store.design(home.layoutId!)!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Home', design: { triggers: [...(design.triggers ?? []), { event: 'OnModeEnter', scriptId: id('Start Timer') }, { event: 'OnModeExit', scriptId: id('Stop Timer') }] } }]);
  const auth = await login('Charts');
  const started = await post('Charts', 'Home', 'button', { trigger: 'OnModeEnter', mode: 'browse' }, auth);
  const install = started.actions.find((a: any) => a.step === 'Install OnTimer Script');
  assert.equal(install.interval, 0.5);
  assert.equal(install.timerScript, 'Tick');
  assert.match(install.timer, /^[0-9a-f]{16}$/);
  // The script and its parameter formula stay on the server.
  assert.equal(install.timerScriptId, undefined);
  assert.equal(install.parameter, undefined);
  // Each tick runs Tick, with the parameter worked out then.
  assert.equal((await post('Charts', 'Home', 'button', { timer: install.timer, mode: 'browse' }, auth)).result, 'Home!/1');
  assert.equal((await post('Charts', 'Home', 'button', { timer: install.timer, mode: 'browse' }, auth)).result, 'Home!/2');
  // Another session can't use it, and a made-up id runs nothing.
  assert.equal((await post('Charts', 'Home', 'button', { timer: install.timer, mode: 'browse' })).error.code, 3);
  assert.equal((await post('Charts', 'Home', 'button', { timer: 'feedfacefeedface', mode: 'browse' }, auth)).error.code, 3);
  // Install OnTimer Script with no script stops it.
  const stopped = await post('Charts', 'Home', 'button', { trigger: 'OnModeExit', mode: 'browse' }, auth);
  assert.deepEqual(stopped.actions.find((a: any) => a.step === 'Install OnTimer Script'), { step: 'Install OnTimer Script', script: 'Stop Timer', interval: 0 });
  assert.equal((await post('Charts', 'Home', 'button', { timer: install.timer, mode: 'browse' }, auth)).error.code, 3);
});

test('web client: a layout\'s OnLayoutKeystroke script sees the key typed and its modifier keys', { skip }, async () => {
  const store = hosted.get('Charts')!;
  store.applyDesign([{ op: 'createScript', name: 'Key Seen', text: 'Exit Script [ Text Result: Get ( TriggerKeystroke ) & "/" & Get ( TriggerModifierKeys ) ]' }]);
  const id = store.schema.scripts.find((s) => s.name === 'Key Seen')!.id;
  const design = store.design(store.layout('Congress').layoutId!)!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Congress', design: { triggers: [...(design.triggers ?? []), { event: 'OnLayoutKeystroke', scriptId: id }] } }]);
  const auth = await login('Charts');
  const r = await post('Charts', 'Congress', 'button', { trigger: 'OnLayoutKeystroke', keystroke: 'Q', modifierKeys: 1, mode: 'browse' }, auth);
  assert.equal(r.result, 'Q/1');
  // Put the layout's triggers back for the other tests.
  store.applyDesign([{ op: 'updateLayout', layout: 'Congress', design: { triggers: design.triggers ?? [] } }]);
});

test('web client: a script run from the Scripts menu still sets off the trigger its request names, and starts in no field', { skip }, async () => {
  // Only a trigger's own run keeps that trigger from firing again; naming a trigger on another kind of run is ignored.
  const store = hosted.get('Charts')!;
  store.applyDesign([
    { op: 'createScript', name: 'Mode Seen', text: 'Set Variable [ $$modes ; Value: $$modes & Get ( WindowMode ) & ";" ]' },
    { op: 'createScript', name: 'Mode Flip', text: 'Set Variable [ $$modes ; Value: "" ]\nEnter Find Mode [ Pause: Off ]\nEnter Browse Mode\nExit Script [ Text Result: $$modes ]' },
  ]);
  const id = (name: string) => store.schema.scripts.find((s) => s.name === name)!.id;
  const design = store.design(store.layout('Congress').layoutId!)!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Congress', design: { triggers: [...(design.triggers ?? []), { event: 'OnModeEnter', scriptId: id('Mode Seen'), modes: ['browse', 'find'] }] } }]);
  try {
    const auth = await login('Charts');
    const r = await post('Charts', 'Congress', 'button', { scriptId: id('Mode Flip'), trigger: 'OnModeEnter', mode: 'browse' }, auth);
    assert.equal(r.result, '1;0;', JSON.stringify(r));
    // Nor does it start in a field the request names: only a field's own trigger starts in that field.
    const walk = (os: typeof design.objects): typeof design.objects => os.flatMap((o) => [o, ...walk(o.children ?? [])]);
    const field = walk(design.objects).find((o) => o.kind === 'field' && o.field?.field)!;
    store.applyDesign([{ op: 'createScript', name: 'Where Am I', text: 'Exit Script [ Text Result: "[" & Get ( ActiveFieldName ) & "]" ]' }]);
    const where = await post('Charts', 'Congress', 'button', { scriptId: id('Where Am I'), activeObject: field.id, objectId: field.id, mode: 'browse' }, auth);
    assert.equal(where.result, '[]', JSON.stringify(where));
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'Congress', design: { triggers: design.triggers ?? [] } }]);
  }
});

test('web client: a script starts in the view the window shows; a view that isn\'t one is ignored', { skip }, async () => {
  const store = hosted.get('Charts')!;
  store.applyDesign([{ op: 'createScript', name: 'Which View', text: 'Exit Script [ Text Result: Get ( LayoutViewState ) ]' }]);
  const id = store.schema.scripts.find((s) => s.name === 'Which View')!.id;
  const auth = await login('Charts');
  const own = await post('Charts', 'Congress', 'button', { scriptId: id, mode: 'browse' }, auth);
  assert.notEqual(own.result, '2'); // the layout's own view isn't table, so the next run shows the client's view counts
  assert.equal((await post('Charts', 'Congress', 'button', { scriptId: id, mode: 'browse', view: 'table' }, auth)).result, '2');
  assert.equal((await post('Charts', 'Congress', 'button', { scriptId: id, mode: 'browse', view: 'sideways' }, auth)).result, own.result);
});

test('web client: Paste with nothing copied asks the browser for its clipboard; Cancel pastes nothing', { skip }, async () => {
  const store = hosted.get('Charts')!;
  store.applyDesign([{ op: 'createScript', name: 'Paste Clipboard', text: 'Set Variable [ $x ; Value: "before" ]\nPaste [ Select ; $x ]\nExit Script [ Text Result: $x ]' }]);
  const id = store.schema.scripts.find((s) => s.name === 'Paste Clipboard')!.id;
  const auth = await login('Charts');
  const answer = async (run: string, body: unknown) =>
    (await fetch(`${base}/tabularius/app/v1/databases/Charts/runs/${run}/file`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const asked = await post('Charts', 'Congress', 'button', { scriptId: id, mode: 'browse' }, auth);
  assert.equal(asked.waiting?.step, 'Clipboard', JSON.stringify(asked));
  const done = await answer(asked.waiting.run, { text: 'from the browser' });
  assert.equal(done.result, 'from the browser');
  // An answer that isn't text is refused, and the script still waits for one.
  const again = await post('Charts', 'Congress', 'button', { scriptId: id, mode: 'browse' }, auth);
  const bad = await fetch(`${base}/tabularius/app/v1/databases/Charts/runs/${again.waiting.run}/file`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ text: 5 }) });
  assert.equal(bad.status, 400);
  assert.equal((await answer(again.waiting.run, { cancel: true })).result, 'before');
});

test('web client: a card window\'s size and place reach the script; Move/Resize Window sends them back', { skip }, async () => {
  const store = hosted.get('Charts')!;
  store.applyDesign([{ op: 'createScript', name: 'Card Size', text: 'Move/Resize Window [ Current Window ; Height: Get ( WindowHeight ) + 10 ]\nExit Script [ Text Result: Get ( WindowHeight ) & "," & Get ( WindowWidth ) & "," & Get ( WindowTop ) ]' }]);
  const id = store.schema.scripts.find((s) => s.name === 'Card Size')!.id;
  const auth = await login('Charts');
  const card = { id: 'CARD-1', name: 'Card', style: 'card', height: 300, width: 400, top: 12 };
  const r = await post('Charts', 'Congress', 'button', { scriptId: id, mode: 'browse', window: card, windows: [card] }, auth);
  assert.equal(r.result, '310,400,12', JSON.stringify(r));
  assert.equal(r.window?.height, 310);
  // Sizes that aren't numbers are left out.
  const odd = { ...card, height: 'tall', width: 1e9 };
  const again = await post('Charts', 'Congress', 'button', { scriptId: id, mode: 'browse', window: odd, windows: [odd] }, auth);
  assert.equal(again.result.split(',')[2], '12');
  assert.notEqual(again.result.split(',')[1], String(1e9));
});

test('web client: a field\'s index gives auto-complete its values', { skip }, async () => {
  const auth = await login('Burgh');
  const store = hosted.get('Burgh')!;
  const layout = 'DE - Comic Books 2';
  const all = await post('Burgh', layout, 'index', { field: 'Publisher' }, auth);
  assert.ok(all.values.includes('Marvel Comics Group'), JSON.stringify(all));
  // Each line is its own entry; values differing only in case are one entry; sorted.
  const made = ['Zq Beta\rZq alpha', 'zq BETA', 'Zq Gamma'].map((Publisher, i) => store.create(layout, { Publisher, __kp_ComicId: String(990001 + i) }).recordId);
  const zq = await post('Burgh', layout, 'index', { field: 'Publisher', prefix: 'zq' }, auth);
  assert.deepEqual(zq.values, ['Zq alpha', 'Zq Beta', 'Zq Gamma']);
  assert.deepEqual((await post('Burgh', layout, 'index', { field: 'Publisher', prefix: 'Zq', limit: 1 }, auth)).values, ['Zq alpha']);
  assert.equal((await post('Burgh', layout, 'index', { field: 'No Such Field' }, auth)).error.code, 102);
  for (const id of made) store.delete(layout, id);
});

test('web client: the Scripts menu lists scripts to include, and runs only those', { skip }, async () => {
  // DEMO_drawers leaves most scripts out of the menu; Charts leaves out all of them.
  const auth = await login('Drawers');
  const menu = await (await fetch(`${base}/tabularius/app/v1/databases/Drawers/layouts`, { headers: auth })).json();
  const ids: number[] = [];
  const walk = (list: any[]) => list.forEach((e) => ('id' in e ? ids.push(e.id) : e.items && walk(e.items)));
  walk(menu.scripts);
  const store = hosted.get('Drawers')!;
  const listed = store.schema.scriptOrder.filter((o) => !o.hidden && store.schema.scripts.some((s) => s.id === o.id)).map((o) => o.id);
  assert.deepEqual(ids, listed);
  assert.ok(ids.length > 0 && ids.length < store.schema.scripts.length);
  const charts = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts`, { headers: await login('Charts') })).json();
  // Its own scripts are all left out; scripts an earlier test created there are included, as new scripts are.
  const chartsIds = charts.scripts.map((e: any) => e.id);
  const chartsHidden = hosted.get('Charts')!.schema.scriptOrder.filter((o) => o.hidden).map((o) => o.id);
  assert.ok(chartsHidden.length >= 6 && chartsIds.every((id: number) => !chartsHidden.includes(id)));
  const hidden = store.schema.scripts.find((s) => !ids.includes(s.id))!;
  const layout = store.layouts()[0].name;
  const refused = await post('Drawers', layout, 'button', { scriptId: hidden.id, mode: 'browse' }, auth);
  assert.equal(refused.error.code, 3);
});

test('web client: Explain This Value without AI traces the field or the relationship, for accounts that see the design', { skip }, async () => {
  const auth = await login('IM');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/IM/layouts/person_layout`, { headers: auth })).json();
  assert.equal(meta.canSeeDesign, true);
  const first = (await (await fetch(`${base}/fmi/data/vLatest/databases/IM/layouts/person_layout/records?_limit=1`, { headers: auth })).json()).response.data[0];
  const own = await post('IM', 'person_layout', 'explain', { recordId: first.recordId, field: 'name' }, auth);
  assert.equal(own.field.field, 'name');
  assert.equal(own.field.value, first.fieldData.name);
  // A portal row: the relationship it follows, checked against that row's record.
  const row = first.portalData.Contact[0];
  const portal = await post('IM', 'person_layout', 'explain', { recordId: first.recordId, field: 'contact_to::summary', portal: 'Contact', row: row.recordId }, auth);
  assert.equal(portal.related.kind, 'portal');
  assert.equal(portal.related.candidate.recordId, Number(row.recordId));
  assert.equal(portal.related.candidate.shown, true);

  // Formulas are design: a set that can't see it gets neither the menu item nor the trace.
  const store = hosted.get('Charts')!;
  store.setPassword('Clerk', 'pw', '[Data Entry Only]');
  const entry = store.schema.privilegeSets.find((x) => x.name === '[Data Entry Only]')!;
  if (!entry.extendedPrivileges.includes('fmrest')) entry.extendedPrivileges.push('fmrest');
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Clerk:pw') } });
  const clerk = { authorization: `Bearer ${(await r.json()).response.token}` };
  const clerkMeta = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress`, { headers: clerk })).json();
  assert.equal(clerkMeta.canSeeDesign, undefined);
  const id = store.findIds('Congress')[0];
  const denied = await post('Charts', 'Congress', 'explain', { recordId: String(id), field: 'State' }, clerk);
  assert.equal(denied.error.code, 9);
  const allowed = await post('Charts', 'Congress', 'explain', { recordId: String(id), field: 'State' });
  assert.equal(allowed.field.field, 'State');
});

test("web client: Insert from Device and Location ask the person's device; Get ( Device ) is theirs", { skip }, async () => {
  const auth = await login('Charts');
  const meta = await (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Home`, { headers: auth })).json();
  const btn = meta.design.objects.flatMap(function all(o: any): any[] { return [o, ...(o.children ?? []).flatMap(all)]; })
    .find((o: any) => o.action?.script === '[btn] Go to next layout');
  const script = hosted.get('Charts')!.schema.scripts.find((s) => s.name === '[btn] Go to next layout')!;
  const saved = script.steps;
  const step = (stepId: number, name: string, params: Record<string, unknown> = {}) => ({ stepId, name, enabled: true, params });
  script.steps = [
    step(161, 'Insert from Device', { variable: '$code', device: { type: 'Bar Code' } }),
    step(141, 'Set Variable', { variable: '$where', value: 'Location ( 10 ; 5 )' }),
    step(141, 'Set Variable', { variable: '$values', value: 'GetValue ( LocationValues ( 10 ; 5 ) ; 4 )' }),
    step(103, 'Exit Script', { calculation: '$code & "|" & $where & "|" & $values & "|" & Get ( Device ) & "|" & Get ( WindowWidth )' }),
  ] as typeof saved;
  const phone = { ...auth, 'x-tabularius-window': JSON.stringify({ device: 4, width: 390, height: 664, contentWidth: 390, contentHeight: 600, screenWidth: 390, screenHeight: 844, scale: 3, orientation: 0 }) };
  const answer = async (run: string, body: unknown) =>
    (await fetch(`${base}/tabularius/app/v1/databases/Charts/runs/${run}/file`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    const scan = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, phone);
    assert.deepEqual({ step: scan.waiting.step, type: scan.waiting.type }, { step: 'Device', type: 'Bar Code' });
    const where = await answer(scan.waiting.run, { text: '4006381333931' });
    assert.equal(where.waiting.step, 'Location');
    // Out of range is refused, and the script keeps waiting.
    assert.equal((await answer(where.waiting.run, { latitude: 91, longitude: 0 })).error.code, 960);
    const done = await answer(where.waiting.run, { latitude: 51.5007, longitude: -0.1246, accuracy: 12 });
    assert.equal(done.result, '4006381333931|51.5007,-0.1246|12|4|390');

    // Canceled and refused: nothing scanned, and Location gives empty, as on FileMaker Go. The window the session
    // last told of still answers Get ( Device ).
    const again = await post('Charts', 'Home', 'button', { objectId: btn.id, mode: 'browse' }, auth);
    const asked = await answer(again.waiting.run, { cancel: true });
    assert.equal(asked.waiting.step, 'Location');
    assert.equal((await answer(asked.waiting.run, { cancel: true })).result, '|||4|390');
  } finally {
    script.steps = saved;
  }
});

test('web client: Insert from Last Visited in a script knows the record shown before the script started', { skip }, async () => {
  const store = hosted.get('Charts')!;
  const info = store.layout('NW Customers');
  const field = store.schema.tables.find((t) => t.name === info.table)!.fields.find((f) => f.type === 'text' && !f.options?.global && !f.calculation)!.name;
  const at = `${info.occurrence}::${field}`;
  store.applyDesign([{ op: 'createScript', name: 'Last Visited', text: `Set Error Capture [ On ]\nInsert from Last Visited [ Select ; ${at} ]\nSet Variable [ $e ; Value: Get ( LastError ) & "/" & ${at} ]\nRevert Record/Request [ With dialog: Off ]\nExit Script [ Text Result: $e ]` }]);
  const script = store.schema.scripts.find((s) => s.name === 'Last Visited')!.id;
  store.applyDesign([{ op: 'updateScript', script, includeInMenu: true }]);
  const auth = await login('Charts');
  const [a, b] = store.findIds(info).slice(0, 2);
  const before = String(store.get(info, b).fieldData[field] ?? '');
  const run = (lastVisited?: unknown) => post('Charts', 'NW Customers', 'button', { scriptId: script, mode: 'browse', recordId: a, ids: [a, b], ...(lastVisited ? { lastVisited } : {}) }, auth);
  assert.equal((await run({ layout: 'NW Customers', recordId: b })).result, `0/${before}`);
  // Nothing sent, or nonsense, is nothing visited.
  assert.match((await run()).result, /^101\//);
  assert.match((await run({ layout: 'NW Customers', recordId: 'x' })).result, /^101\//);
});

test('web client: a run takes the window it starts in and the windows behind it, and says which it ended in and closed', { skip }, async () => {
  const store = hosted.get('Charts')!;
  store.applyDesign([
    { op: 'createScript', name: 'Card Open', text: 'New Window [ Style: Card ; "Card" ; Using layout: “Home” ]\nExit Script [ Text Result: Get ( WindowStyle ) ]' },
    { op: 'createScript', name: 'Card Cancel', text: 'Close Window [ Current Window ]\nExit Script [ Text Result: Get ( WindowName ) ]' },
  ]);
  const id = (name: string) => store.schema.scripts.find((s) => s.name === name)!.id;
  store.applyDesign([{ op: 'updateScript', script: id('Card Open'), includeInMenu: true }, { op: 'updateScript', script: id('Card Cancel'), includeInMenu: true }]);
  const auth = await login('Charts');
  const main = { id: 'W1', name: 'Charts', style: 'document', layout: 'Home' };
  const open = await post('Charts', 'Home', 'button', { scriptId: id('Card Open'), mode: 'browse', window: main, windows: [main, { id: 7 }, { id: 'x'.repeat(101) }] }, auth);
  assert.equal(open.result, '3');
  assert.equal(open.window.style, 'card');
  assert.equal(open.window.dimParent, true);
  assert.equal(open.closed, undefined);
  const card = { id: open.window.id, name: 'Card', style: 'card', layout: 'Home' };
  const cancel = await post('Charts', 'Home', 'button', { scriptId: id('Card Cancel'), mode: 'browse', window: card, windows: [main, card] }, auth);
  assert.equal(cancel.result, 'Charts');
  assert.deepEqual(cancel.closed, [card.id]);
  assert.deepEqual(cancel.window, { id: 'W1', name: 'Charts', style: 'document', untouched: true });
  // A run that sends no window gets none back, as before.
  assert.equal((await post('Charts', 'Home', 'button', { scriptId: id('Card Cancel'), mode: 'browse' }, auth)).window, undefined);
});
