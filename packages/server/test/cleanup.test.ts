// Data cleanup: duplicates, values off their value list, and malformed phones and emails are found without
// changing anything; what the person picks is applied all or none, as their account, audited, and can be undone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { jaroWinkler, normalName, phoneDigits, snapshotRows } from '../src/cleanup.ts';
import type { PrivilegeDefinition, Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

const viewer: PrivilegeDefinition = {
  name: 'Viewer',
  records: { view: true, edit: false, create: false, delete: false },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'],
};

const ids: Record<string, number> = {};
before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-cleanup-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.applyDesign([
    { op: 'createValueList', name: 'Statuses', values: ['Active', 'Inactive', 'Prospect'] },
    { op: 'createTable', name: 'Customers', fields: [
      { name: 'CustomerID', type: 'text' }, { name: 'Name', type: 'text' }, { name: 'Email', type: 'text' }, { name: 'Phone', type: 'text' },
      { name: 'Address', type: 'text' }, { name: 'Status', type: 'text' }, { name: 'Notes', type: 'text' }, { name: 'State', type: 'text' }, { name: 'City', type: 'text' },
      { name: 'Api Key', type: 'text' }, { name: 'SKU', type: 'text' }, { name: 'Unit', type: 'text' },
    ] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerID', type: 'text' }, { name: 'Total', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'CustomerID', right: 'CustomerID' }], rightDelete: true },
  ] as never);
  const add = (key: string, data: Record<string, string>) => (ids[key] = store.create('Customers', data).recordId);
  add('acme', { CustomerID: 'C1', Name: 'Acme Corporation', Email: 'sales@acme.com', Phone: '(555) 201-3344', Address: '12 Main Street', Status: 'Active' });
  add('acme2', { CustomerID: 'C2', Name: 'ACME Corp.', Email: '', Phone: '555.201.3344', Address: '12 Main St', Status: 'actve', Notes: 'Prefers phone' });
  add('jo', { CustomerID: 'C3', Name: 'Jo Smith', Email: 'jo@gmial.com', Phone: '(555) 300-1000', Address: '1 Elm Rd', Status: 'active' });
  add('jo2', { CustomerID: 'C4', Name: 'Smith, Jo', Email: ' jo@gmial.com', Phone: '(555) 300-10', Address: '', Status: 'Prospect' });
  add('other', { CustomerID: 'C5', Name: 'Jo Smithers', Email: 'jsmithers@example.org', Phone: '(555) 777-1212', Address: '99 Oak Avenue', Status: 'Gone' });
  add('lee', { CustomerID: 'C6', Name: 'Lee Wong', Email: 'lee@example', Phone: '(555) 444-2020', Address: '5 Pine Ln', Status: 'Inactive' });
  // The same value written different ways: most say "OH" and "Columbus".
  // Keys, codes, notes and secrets differ in case too, and are left alone.
  const city = (key: string, State: string, City: string, more: Record<string, string> = {}) => (ids[key] = store.create('Customers', { CustomerID: key, Name: `Place ${key}`, State, City, ...more }).recordId);
  city('p1', 'OH', 'Columbus', { 'Api Key': 'sk-ABC', SKU: 'ab-1', Notes: 'Call back', Unit: 'MB' });
  city('p2', 'OH', 'Columbus', { 'Api Key': 'sk-ABC', SKU: 'AB-1', Notes: 'Call back', Unit: 'MB' });
  city('p3', 'Ohio', 'columbus', { 'Api Key': 'sk-abc', SKU: 'AB-1', Notes: 'call back', Unit: 'Mb' });
  city('p4', 'oh.', 'Columbus  ');
  city('p5', 'TX', ' Austin');
  city('P6', 'TX', 'Austin');
  for (const [c, total] of [['C1', 100], ['C2', 40], ['C2', 60], ['C4', 10]] as const) store.create('Orders', { CustomerID: c, Total: total });
  // The value list came later (as it often does), so older records have values off it.
  store.applyDesign([{ op: 'updateField', table: 'Customers', field: 'Status', options: { validation: { valueList: 'Statuses' } } }] as never);
  store.savePrivilegeSet(viewer);
  store.setPassword('Admin', 'pw');
  store.setPassword('Viewer', 'pw', 'Viewer');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('cleanup: names compare as people and companies write them', () => {
  assert.equal(normalName('ACME Corp.'), 'acme');
  assert.equal(normalName('Acme Corporation'), 'acme');
  assert.equal(normalName('Smith, Jo'), normalName('Jo Smith'));
  assert.ok(jaroWinkler('jo smith', 'jo smithers') < 0.97);
  assert.equal(phoneDigits('+1 (555) 201-3344 x12'), '5552013344');
});

async function login(account: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}',
  });
  return { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
}
const api = async (headers: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}/tabularius/cleanup/v1/databases/Charts${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
};
const value = (table: string, field: string, id: number) => store.select(`SELECT "${field}" FROM "${table}" WHERE _fm_record_id = ?`, [id], 1).rows[0]?.[0];
const orders = (customer: string) => store.select('SELECT count(*) FROM "Orders" WHERE CustomerID = ?', [customer], 1).rows[0][0];

test('cleanup: a scan finds duplicates, off-list values and bad phones and emails, and changes nothing', { skip }, async () => {
  const admin = await login('Admin');
  const before = store.auditLog({ table: 'Customers' }).length;
  const r = await api(admin, 'POST', '/scan', { layout: 'Customers' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const scan = r.body;
  assert.equal(scan.scanned, 12);
  const groups = scan.duplicates.map((g: { records: { recordId: number }[] }) => g.records.map((x) => x.recordId));
  assert.deepEqual(groups.sort(), [[ids.acme, ids.acme2], [ids.jo, ids.jo2]].sort());
  const acme = scan.duplicates.find((g: { keep: number; records: unknown[] }) => g.records.length === 2 && (g.keep === ids.acme || g.keep === ids.acme2));
  // Acme's first record has the most filled in, so it's kept; the other fills its empty Notes; its 2 orders move.
  assert.equal(acme.keep, ids.acme);
  assert.deepEqual(acme.fill, { Notes: 'Prefers phone' });
  assert.deepEqual(acme.related, [{ table: 'Orders', via: 'CustomerID = Customers::CustomerID', records: 2 }]);
  assert.match(acme.reason, /same phone|names nearly alike|same name/);
  const fix = (field: string, from: string) => scan.fixes.find((f: { field: string; from: string }) => f.field === field && f.from === from);
  assert.equal(fix('Status', 'actve').to, 'Active');
  assert.equal(fix('Status', 'active').to, 'Active');
  assert.equal(fix('Status', 'Gone').to, undefined);
  assert.match(fix('Status', 'Gone').reason, /not in the value list Statuses/);
  assert.equal(fix('Email', 'jo@gmial.com').to, 'jo@gmail.com');
  assert.equal(fix('Email', ' jo@gmial.com').to, 'jo@gmail.com');
  assert.equal(fix('Email', 'lee@example').to, undefined);
  // Phones: written like most of the field's numbers; too few digits can't be guessed.
  assert.equal(fix('Phone', '555.201.3344').to, '(555) 201-3344');
  assert.match(fix('Phone', '(555) 300-10').reason, /8 digits/);
  assert.equal(fix('Phone', '(555) 201-3344'), undefined);
  // Written differently: state names and abbreviations as most records write them, capitals and spaces tidied.
  assert.equal(fix('State', 'Ohio').to, 'OH');
  assert.equal(fix('State', 'oh.').to, 'OH');
  assert.equal(fix('State', 'OH'), undefined);
  assert.equal(fix('City', 'columbus').to, 'Columbus');
  assert.equal(fix('City', 'Columbus  ').to, 'Columbus');
  assert.equal(fix('City', ' Austin').to, 'Austin');
  assert.match(fix('City', ' Austin').reason, /extra spaces/);
  assert.match(fix('State', 'Ohio').reason, /^the same state as "OH", which most records use$/);
  assert.equal(fix('City', 'columbus').reason, 'written "Columbus" in most records');
  // Not for fields with a value list (checked against the list), phones and emails, keys (CustomerID: "p1" and "P6"), codes, notes,
  // secrets, nor fields that aren't names, places or states (a unit: MB isn't Mb).
  assert.deepEqual([...new Set(scan.fixes.filter((f: { check: string }) => f.check === 'consistency').map((f: { field: string }) => f.field))].sort(), ['City', 'State']);
  assert.equal(store.auditLog({ table: 'Customers' }).length, before);
});

test('cleanup: in a state field written mostly as names, abbreviations become names', { skip }, async () => {
  const admin = await login('Admin');
  store.applyDesign([{ op: 'createTable', name: 'Offices', fields: [{ name: 'State', type: 'text' }] }] as never);
  for (const v of ['Texas', 'Texas', 'California', 'TX', 'Ohio']) store.create('Offices', { State: v });
  const r = await api(admin, 'POST', '/scan', { layout: 'Offices', checks: ['consistency'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.fixes.map((f: { from: string; to: string }) => [f.from, f.to]), [['TX', 'Texas']]);
});

test('cleanup: a dry run says what applying would change, as the account, and changes nothing', { skip }, async () => {
  const admin = await login('Admin');
  const viewerSession = await login('Viewer');
  const request = { layout: 'Customers', dryRun: true, fixes: [{ field: 'State', from: 'Ohio', to: 'OH' }], merges: [{ keep: ids.p1, remove: [ids.p2] }] };
  const auditBefore = store.auditLog({ table: 'Customers' }).length;
  // Nothing is told of a dry run's writes: live clients, webhooks, automations, other workers.
  const heard: string[] = [];
  const listen = (c: { kind: string; recordId?: number }) => heard.push(`${c.kind} ${c.recordId}`);
  store.listeners.add(listen);
  const historyBefore = (await api(admin, 'GET', '/history')).body.history.length;
  const r = await api(admin, 'POST', '/apply', request);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dryRun, true);
  assert.equal(r.body.summary, '1 value to fix, 1 set of duplicates to merge');
  assert.deepEqual(r.body.changes, [
    { table: 'Customers', recordId: ids.p3, field: 'State', from: 'Ohio', to: 'OH' },
    { table: 'Customers', recordId: ids.p2, delete: true },
  ]);
  assert.equal(value('Customers', 'State', ids.p3), 'Ohio');
  assert.equal(value('Customers', 'Name', ids.p2), 'Place p2');
  assert.equal(store.auditLog({ table: 'Customers' }).length, auditBefore);
  assert.equal((await api(admin, 'GET', '/history')).body.history.length, historyBefore);
  store.listeners.delete(listen);
  assert.deepEqual(heard, []);
  // A viewer's dry run is refused as applying would be.
  assert.equal((await api(viewerSession, 'POST', '/apply', request)).status, 403);
});

test('cleanup: an apply that names no layout, or a layout that is not text, is a bad request and not a server error', { skip }, async () => {
  const admin = await login('Admin');
  for (const body of [{ fixes: [{ field: 'State', from: 'a', to: 'b' }] }, { layout: 5, fixes: [{ field: 'State', from: 'a', to: 'b' }] }, { layout: { x: 1 }, merges: [{ keep: 1, remove: [2] }] }]) {
    const r = await api(admin, 'POST', '/apply', body);
    assert.ok(r.status >= 400 && r.status < 500, `${JSON.stringify(body)}: ${r.status}`);
  }
});

test('cleanup: fixes and merges apply all or none, as the account, and undo puts everything back', { skip }, async () => {
  const admin = await login('Admin');
  const viewerSession = await login('Viewer');
  const request = {
    layout: 'Customers',
    fixes: [{ field: 'Status', from: 'actve', to: 'Active' }, { field: 'Email', from: 'jo@gmial.com', to: 'jo@gmail.com' }],
    merges: [{ keep: ids.acme, remove: [ids.acme2], fill: { Notes: 'Prefers phone' } }],
  };
  // A viewer can scan but not change: nothing at all is applied.
  const denied = await api(viewerSession, 'POST', '/apply', request);
  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  assert.equal(value('Customers', 'Status', ids.acme2), 'actve');
  // A merge that fails part way leaves the fixes before it undone too.
  const bad = await api(admin, 'POST', '/apply', { ...request, merges: [{ keep: ids.acme, remove: [99999] }] });
  assert.equal(bad.status, 400);
  assert.equal(value('Customers', 'Status', ids.acme2), 'actve');
  assert.equal(value('Customers', 'Email', ids.jo), 'jo@gmial.com');

  const done = await api(admin, 'POST', '/apply', request);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.fixed, 2);
  assert.equal(done.body.merged, 1);
  assert.equal(value('Customers', 'Email', ids.jo), 'jo@gmail.com');
  assert.equal(value('Customers', 'Notes', ids.acme), 'Prefers phone');
  assert.equal(value('Customers', 'Name', ids.acme2), undefined);
  // The duplicate's orders moved to the kept customer rather than being deleted with it.
  assert.equal(orders('C1'), 3);
  assert.equal(orders('C2'), 0);
  const audit = store.auditLog({ table: 'Customers', account: 'Admin' });
  assert.ok(audit.some((e) => e.kind === 'delete' && e.recordId === ids.acme2));
  assert.ok(store.auditLog({ table: 'Orders' }).some((e) => e.kind === 'update'));

  const history = await api(admin, 'GET', '/history');
  assert.equal(history.body.history[0].id, done.body.id);
  assert.match(history.body.history[0].summary, /2 values fixed, 1 set of duplicates merged/);
  const undone = await api(admin, 'POST', `/history/${done.body.id}/undo`);
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.deepEqual(undone.body.skipped, []);
  assert.equal(value('Customers', 'Name', ids.acme2), 'ACME Corp.');
  assert.equal(value('Customers', 'Status', ids.acme2), 'actve');
  assert.equal(value('Customers', 'Notes', ids.acme), null);
  assert.equal(value('Customers', 'Email', ids.jo), 'jo@gmial.com');
  assert.equal(orders('C1'), 1);
  assert.equal(orders('C2'), 2);
  assert.equal((await api(admin, 'POST', `/history/${done.body.id}/undo`)).status, 400);
});

test('cleanup: undo leaves a field someone changed since', { skip }, async () => {
  const admin = await login('Admin');
  const done = await api(admin, 'POST', '/apply', { layout: 'Customers', fixes: [{ field: 'Status', from: 'Gone', to: 'Inactive' }, { field: 'Status', from: 'active', to: 'Active' }] });
  assert.equal(done.body.fixed, 2);
  store.update('Customers', ids.other, { Status: 'Prospect' });
  const undone = await api(admin, 'POST', `/history/${done.body.id}/undo`);
  assert.equal(undone.body.undone, 1);
  assert.match(undone.body.skipped[0], /Customers::Status of record \d+ \(changed since\)/);
  assert.equal(value('Customers', 'Status', ids.other), 'Prospect');
  assert.equal(value('Customers', 'Status', ids.jo), 'active');
});

test('cleanup: a delete is offered for undo only when no relationship deletes related records too', { skip }, () => {
  // Customers' orders go with them (the relationship deletes them), and those couldn't come back.
  assert.equal(snapshotRows(store, 'Customers', [ids.acme]), undefined);
  const order = store.findIds('Orders')[0];
  const snap = snapshotRows(store, 'Orders', [order]);
  assert.equal(snap?.rows.size, 1);
  assert.equal(snapshotRows(store, 'Orders', []), undefined);
});
