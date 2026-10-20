// Related OData and web-derived reads must identify the records they disclose.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStore, type Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { EXPAND_LIMIT } from '../src/odata.ts';

let dir: string;
let server: Server;
let base: string;
let store: Store;
let web: string;
let limitedWeb: string;
const basic = 'Basic ' + btoa('Admin:pw');
const ids: Record<string, number> = {};
const reads = () => store.auditLog({ kind: 'read', limit: 10000 });
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-related-audit-'));
  createStore(join(dir, 'Audit' + STORE_EXT));
  const started = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = started.server;
  base = started.url;
  store = started.host.get('Audit')!;
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Key' }, { name: 'Name' }, { name: 'Amount', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Key' }, { name: 'Total', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Key', right: 'Key' }] },
    { op: 'createField', table: 'Customers', name: 'Sum', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
  ] as never);
  ids.a = store.create('Customers', { Key: 'A', Name: 'Ada', Amount: 10 }).recordId;
  ids.b = store.create('Customers', { Key: 'B', Name: 'Bo', Amount: 20 }).recordId;
  ids.empty = store.create('Customers', { Key: 'C', Name: 'Cy', Amount: 30 }).recordId;
  ids.big = store.create('Orders', { Key: 'A', Total: 100 }).recordId;
  ids.small = store.create('Orders', { Key: 'A', Total: 5 }).recordId;
  ids.other = store.create('Orders', { Key: 'B', Total: 40 }).recordId;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest', 'fmapp', 'fmodata'])] });
  store.setPassword('Admin', 'pw', full.name);
  store.savePrivilegeSet({ name: 'Limited', extendedPrivileges: ['fmodata', 'fmrest', 'fmapp'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
    records: { view: true, edit: false, create: false, delete: false },
    tables: { Orders: { view: 'Total < 50', edit: false, create: false, delete: false }, Customers: { view: 'Amount < 20', edit: false, create: false, delete: false } } } as never);
  store.setPassword('Limited', 'pw', 'Limited');
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Audit/sessions`, { method: 'POST', headers: { authorization: basic, 'x-tabularius-client': 'web' }, body: '{}' });
  assert.equal(login.status, 200);
  web = 'Bearer ' + (await login.json()).response.token;
  const limited = await fetch(`${base}/fmi/data/vLatest/databases/Audit/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Limited:pw'), 'x-tabularius-client': 'web' }, body: '{}' });
  assert.equal(limited.status, 200);
  limitedWeb = 'Bearer ' + (await limited.json()).response.token;
  store.setAuditSettings({ logReads: true });
});
after(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function check(mark: number, expected: Record<string, number[]>, surface = 'odata', account = 'Admin') {
  const entries = reads().slice(mark);
  assert.equal(entries.length, Object.keys(expected).length, JSON.stringify(entries));
  for (const [table, ids] of Object.entries(expected)) {
    const entry = entries.find((e) => e.table === table)!;
    assert.ok(entry, table);
    assert.equal(entry.surface, surface);
    assert.equal(entry.account, account);
    assert.deepEqual(entry.changes, ids.length === 1 ? { records: 1 } : { records: ids.length, ids });
    assert.equal(entry.recordId, ids.length === 1 ? ids[0] : undefined);
  }
}
async function get(path: string, account = 'Admin', headers = {}) {
  const response = await fetch(`${base}/fmi/odata/v4/Audit${path}`, { headers: { authorization: 'Basic ' + btoa(`${account}:pw`), ...headers } });
  const body = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}
const cases: [string, () => string, () => Record<string, number[]>][] = [
  ['navigation collection', () => `/Customers(${ids.a})/Orders?$orderby=Total&$skip=1&$top=1&$count=true`, () => ({ Orders: [ids.big] })],
  ['keyed navigation', () => `/Customers(${ids.a})/Orders(${ids.small})`, () => ({ Orders: [ids.small] })],
  ['keyed navigation with expansion', () => `/Customers(${ids.a})/Orders(${ids.small})?$expand=Customers`, () => ({ Orders: [ids.small], Customers: [ids.a] })],
  ['collection references', () => `/Customers(${ids.a})/Orders/$ref?$orderby=Total&$skip=1&$top=1&$count=true`, () => ({ Orders: [ids.big] })],
  ['keyed reference', () => `/Customers(${ids.a})/Orders(${ids.small})/$ref`, () => ({ Orders: [ids.small] })],
  ['navigation count', () => `/Customers(${ids.a})/Orders/$count`, () => ({})],
  ['filtered navigation count', () => `/Customers(${ids.a})/Orders/$count?$filter=Total lt 50`, () => ({})],
  ['entity expansion', () => `/Customers(${ids.a})?$expand=Orders($orderby=Total;$top=1)`, () => ({ Customers: [ids.a], Orders: [ids.small] })],
  ['list expansion', () => '/Customers?$expand=Orders&$top=2', () => ({ Customers: [ids.a, ids.b], Orders: [ids.big, ids.small, ids.other] })],
  ['deduplicated expansion', () => '/Orders?$expand=Customers&$top=2', () => ({ Orders: [ids.big, ids.small], Customers: [ids.a] })],
  ['crossjoin links', () => '/$crossjoin(Customers,Orders)?$orderby=Customers/ROWID,Orders/ROWID&$top=2', () => ({ Customers: [ids.a], Orders: [ids.big, ids.small] })],
  ['crossjoin inline', () => '/$crossjoin(Customers,Orders)?$expand=*&$orderby=Customers/ROWID,Orders/ROWID&$skip=1&$top=2&$count=true', () => ({ Customers: [ids.a], Orders: [ids.small, ids.other] })],
];
for (const [name, path, expected] of cases) test(`read audit: OData ${name}`, async () => {
  const mark = reads().length;
  await get(path());
  check(mark, expected());
});

test('read audit: OData expansion logs only the page that fits the expansion budget', async () => {
  const was = EXPAND_LIMIT.records;
  EXPAND_LIMIT.records = 2;
  try {
    const mark = reads().length;
    const body = await get('/Customers?$expand=Orders');
    assert.deepEqual(body.value.map((r: { ROWID: number }) => r.ROWID), [ids.a]);
    assert.ok(body['@odata.nextLink']);
    check(mark, { Customers: [ids.a], Orders: [ids.big, ids.small] });
  } finally { EXPAND_LIMIT.records = was; }
});

test('read audit: denied, empty and disabled OData reads create no entries', async () => {
  const mark = reads().length;
  for (const suffix of ['Orders', 'Orders/$ref', 'Orders/$count']) await get(`/Customers(${ids.empty})/${suffix}`);
  await get('/$crossjoin(Customers,Orders)?$top=0');
  const denied = await fetch(`${base}/fmi/odata/v4/Audit/Customers(${ids.a})/Orders(${ids.other})`, { headers: { authorization: basic } });
  assert.equal(denied.status, 404);
  await denied.text();
  check(mark, {});
  store.setAuditSettings({ logReads: false });
  try { for (const [, path] of cases) await get(path()); } finally { store.setAuditSettings({ logReads: true }); }
  check(mark, {});
});

test('read audit: related OData paths omit records the account cannot view', async () => {
  for (const suffix of ['Orders', 'Orders/$ref']) {
    const mark = reads().length;
    await get(`/Customers(${ids.a})/${suffix}`, 'Limited');
    check(mark, { Orders: [ids.small] }, 'odata', 'Limited');
  }
  const mark = reads().length;
  assert.equal(await get(`/Customers(${ids.a})/Orders/$count`, 'Limited'), '1');
  check(mark, {}, 'odata', 'Limited');
});

async function post(action: string, body: object, authorization = web) {
  const r = await fetch(`${base}/tabularius/app/v1/databases/Audit/layouts/Customers/${action}`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  return data;
}
function chart(source: 'found-set' | 'related' | 'record', grouped = false) {
  const to = source === 'related' ? 'Orders' : 'Customers';
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [{ id: 901, kind: 'chart', type: 22,
    anchors: { left: true, top: true, right: false, bottom: false }, style: {}, bounds: { top: 10, left: 10, right: 300, bottom: 200 },
    chart: { type: 'column', source, occurrence: to, grouped, categories: grouped ? '"all"' : `${to}::Key`, series: [{ data: `${to}::${source === 'related' ? 'Total' : grouped ? 'Sum' : 'Amount'}` }] } }] } }] as never);
}
for (const source of ['found-set', 'related', 'record'] as const) test(`read audit: web ${source} chart`, async () => {
  chart(source);
  const mark = reads().length;
  const data = await post('charts', { records: [ids.a, ids.b], ids: [ids.a, ids.b] });
  assert.deepEqual(data.records[ids.a][901].series[0].values, source === 'related' ? [100, 5] : source === 'record' ? [10] : [10, 20]);
  check(mark, source === 'related' ? { Orders: [ids.big, ids.small, ids.other] } : { Customers: [ids.a, ids.b] }, 'web');
});

test('read audit: web grouped chart', async () => {
  chart('found-set', true);
  const mark = reads().length;
  const data = await post('charts', { records: [ids.a], ids: [ids.a, ids.b] });
  assert.deepEqual(data.records[ids.a][901].series[0].values, [30]);
  check(mark, { Customers: [ids.a, ids.b] }, 'web');
});

test('read audit: web grouped summaries', async () => {
  const mark = reads().length;
  const data = await post('groups', { ids: [ids.a, ids.b], fields: ['Key'], sort: [{ fieldName: 'Key', sortOrder: 'ascend' }] });
  assert.deepEqual(data.groups.map((runs: { count: number }[]) => runs.map((r) => r.count)), [[1, 1]]);
  check(mark, { Customers: [ids.a, ids.b] }, 'web');
});

function foundSetPortal() {
  const to = store.schema.tableOccurrences.find((t) => t.name === 'Customers')!;
  const field = store.schema.tables.find((t) => t.name === 'Customers')!.fields.find((f) => f.name === 'Name')!;
  const common = { anchors: { left: true, top: true, right: false, bottom: false }, style: {}, bounds: { top: 10, left: 10, right: 300, bottom: 200 } };
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [{ ...common, id: 900, kind: 'portal', type: 9,
    portal: { tableOccurrenceId: to.id, tableOccurrence: 'Customers', rows: 10, initialRow: 1, scrolling: true }, children: [{ ...common, id: 901, kind: 'field', type: 1,
      field: { tableOccurrenceId: to.id, tableOccurrence: 'Customers', fieldId: field.id, field: 'Name', display: 'edit', repetitions: 1 } }] }] } }] as never);
}
test('read audit: web found-set portal paging and identity lookup', async () => {
  foundSetPortal();
  for (const extra of [{ offset: 2, limit: 1 }, { recordId: String(ids.b) }]) {
    const mark = reads().length;
    const page = await post('foundset', { portal: 'Customers', ids: [ids.a, ids.b], ...extra });
    assert.deepEqual(page.rows.map((r: { recordId: string }) => Number(r.recordId)), [ids.b]);
    check(mark, { Customers: [ids.b] }, 'web');
  }
});

test('read audit: web records helper already logs its returned page', async () => {
  const mark = reads().length;
  const data = await post('records', { ids: [ids.a, ids.b], offset: 2, limit: 1 });
  assert.deepEqual(data.data.map((r: { recordId: string }) => Number(r.recordId)), [ids.b]);
  check(mark, { Customers: [ids.b] }, 'web');
});

function mergedLayout() {
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [{ id: 902, kind: 'text', type: 2,
    anchors: { left: true, top: true, right: false, bottom: false }, style: {}, bounds: { top: 10, left: 10, right: 300, bottom: 200 }, text: '<<Name>>' }] } }] as never);
}
test('read audit: web view merge values', async () => {
  mergedLayout();
  const mark = reads().length;
  const data = await post('view', { records: [{ id: ids.a }, { id: ids.b }] });
  assert.equal(data.records[ids.a].merges.Name, 'Ada');
  check(mark, { Customers: [ids.a, ids.b] }, 'web');
});

test('read audit: web refresh values and derived states share one entry', async () => {
  mergedLayout();
  const mark = reads().length;
  const data = await post('refresh', { ids: [ids.a, ids.b], recordId: ids.a, displayRecords: [ids.a] });
  assert.deepEqual(data.records.map((r: { recordId: string }) => Number(r.recordId)), [ids.a]);
  assert.equal(data.states[ids.a].merges.Name, 'Ada');
  check(mark, { Customers: [ids.a] }, 'web');
});

function relatedPortal() {
  const to = store.schema.tableOccurrences.find((t) => t.name === 'Orders')!;
  const field = store.schema.tables.find((t) => t.name === 'Orders')!.fields.find((f) => f.name === 'Total')!;
  const common = { anchors: { left: true, top: true, right: false, bottom: false }, style: {}, bounds: { top: 10, left: 10, right: 300, bottom: 200 } };
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [{ ...common, id: 904, kind: 'portal', type: 9,
    portal: { tableOccurrenceId: to.id, tableOccurrence: 'Orders', rows: 10, initialRow: 1, scrolling: true }, children: [{ ...common, id: 905, kind: 'field', type: 1, tooltip: 'Orders::Total',
      field: { tableOccurrenceId: to.id, tableOccurrence: 'Orders', fieldId: field.id, field: 'Total', display: 'edit', repetitions: 1 } }] }] } }] as never);
}
test('read audit: web view portal formulas', async () => {
  relatedPortal();
  const mark = reads().length;
  const data = await post('view', { records: [{ id: ids.a }] });
  assert.equal(data.records[ids.a].rows.Orders[ids.big].tooltips[905], '100');
  check(mark, { Orders: [ids.big, ids.small] }, 'web');
});
test('read audit: web refresh related rows and formulas share one table entry', async () => {
  relatedPortal();
  const mark = reads().length;
  const data = await post('refresh', { ids: [ids.a], recordId: ids.a });
  assert.equal(data.records[0].portalData.Orders.length, 2);
  check(mark, { Customers: [ids.a], Orders: [ids.big, ids.small] }, 'web');
});

test('read audit: crossjoin logs only the served page, not the lookahead row', async () => {
  const mark = reads().length;
  const data = await get('/$crossjoin(Customers,Orders)?$orderby=Customers/ROWID,Orders/ROWID&$count=true', 'Admin', { prefer: 'odata.maxpagesize=2' });
  assert.equal(data.value.length, 2);
  assert.ok(data['@odata.nextLink']);
  check(mark, { Customers: [ids.a], Orders: [ids.big, ids.small] });
});

test('read audit: web derived reads omit hidden and missing records', async () => {
  chart('related');
  let mark = reads().length;
  const data = await post('charts', { records: [ids.a, ids.b], ids: [ids.a, ids.b] }, limitedWeb);
  assert.deepEqual(data.records[ids.a][901].series[0].values, [5]);
  check(mark, { Orders: [ids.small] }, 'web', 'Limited');
  mark = reads().length;
  await post('groups', { ids: [ids.a, ids.b, 9999], fields: ['Key'], sort: [{ fieldName: 'Key', sortOrder: 'ascend' }] }, limitedWeb);
  check(mark, { Customers: [ids.a] }, 'web', 'Limited');
  foundSetPortal();
  mark = reads().length;
  const page = await post('foundset', { portal: 'Customers', ids: [ids.a, ids.b, 9999] }, limitedWeb);
  assert.deepEqual(page.rows.map((r: { recordId: string }) => Number(r.recordId)), [ids.a]);
  check(mark, { Customers: [ids.a] }, 'web', 'Limited');
});

test('read audit: empty and disabled web derived reads create no entries', async () => {
  const mark = reads().length;
  foundSetPortal();
  const empty = await post('foundset', { portal: 'Customers', ids: [ids.a], recordId: String(ids.b) });
  assert.deepEqual(empty.rows, []);
  await post('groups', { ids: [], fields: ['Key'], sort: [{ fieldName: 'Key', sortOrder: 'ascend' }] });
  chart('related');
  await post('charts', { records: [ids.empty] });
  check(mark, {});
  store.setAuditSettings({ logReads: false });
  try {
    await post('charts', { records: [ids.a] });
    await post('groups', { ids: [ids.a], fields: ['Key'], sort: [{ fieldName: 'Key', sortOrder: 'ascend' }] });
    foundSetPortal();
    await post('foundset', { portal: 'Customers', ids: [ids.a] });
    mergedLayout();
    await post('view', { records: [{ id: ids.a }] });
    await post('refresh', { ids: [ids.a], recordId: ids.a });
  } finally { store.setAuditSettings({ logReads: true }); }
  check(mark, {});
  assert.equal(store.verifyRecordAudit().status, 'consistent');
});
