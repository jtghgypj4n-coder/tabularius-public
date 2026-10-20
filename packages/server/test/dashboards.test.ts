// Dashboards from plain English: widgets saved with the file, worked out live as the signed-in account,
// with relative dates kept relative and "top 10 customers" found from the data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { relativeDate, computeWidget } from '../src/dashboards.ts';
import type { PrivilegeDefinition, Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;
const year = new Date().getFullYear();

const clerk: PrivilegeDefinition = {
  name: 'Clerk',
  records: { view: false, edit: false, create: false, delete: false },
  tables: { Invoices: { view: 'Region = "East"', edit: false, create: false, delete: false } },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'],
};

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-dashboards-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.applyDesign([{ op: 'createTable', name: 'Invoices', fields: [
    { name: 'Customer', type: 'text' }, { name: 'Region', type: 'text' }, { name: 'Date', type: 'date' }, { name: 'Amount', type: 'number' },
  ] }] as never);
  // Twelve customers this year: C1 has the most (12 × 100 in a month), C12 the least. Big Co only bought last year.
  for (let c = 1; c <= 12; c++) {
    for (const month of [1, 2]) {
      store.create('Invoices', { Customer: `C${c}`, Region: c % 2 ? 'East' : 'West', Date: `${month}/15/${year}`, Amount: (13 - c) * 50 });
    }
  }
  store.create('Invoices', { Customer: 'Big Co', Region: 'East', Date: `6/1/${year - 1}`, Amount: 100000 });
  store.savePrivilegeSet(clerk);
  store.setPassword('Admin', 'pw');
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const REVENUE = {
  title: 'Revenue by month, top 10 customers', kind: 'chart', chart: 'line', layout: 'Invoices',
  query: [{ Date: 'this year' }], groupBy: ['Date', 'Customer'], by: 'month', measure: { field: 'Amount', fn: 'sum' }, top: { field: 'Customer', n: 10 },
};
const TABLE = { title: 'Top customers', kind: 'table', layout: 'Invoices', query: [{ Date: 'this year' }], groupBy: ['Customer'], measure: { field: 'Amount', fn: 'sum' }, top: { field: 'Customer', n: 10 } };
const TOTAL = { title: 'Revenue this year', kind: 'number', layout: 'Invoices', query: [{ Date: 'this year' }], measure: { field: 'Amount', fn: 'sum' } };

test('dashboards: relative dates become today\'s ranges', () => {
  const now = new Date(2026, 9, 12); // Monday 12 October 2026
  assert.equal(relativeDate('this year', now), '2026-01-01...2026-12-31');
  assert.equal(relativeDate('Last  Month', now), '2026-09-01...2026-09-30');
  assert.equal(relativeDate('this quarter', now), '2026-10-01...2026-12-31');
  assert.equal(relativeDate('this week', now), '2026-10-12...2026-10-18');
  assert.equal(relativeDate('last 30 days', now), '2026-09-13...2026-10-12');
  assert.equal(relativeDate('year to date', now), '2026-01-01...2026-10-12');
  assert.equal(relativeDate('today', now), '2026-10-12');
  assert.equal(relativeDate('2026', now), undefined);
});

let id = 0;
async function mcp(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; value: any }> {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: { database: 'Charts', ...args } } }),
  });
  const result = (await r.json()).result;
  const text = result.content[0].text as string;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  return { isError: !!result.isError, text, value };
}

test('dashboards: "revenue by month for my top 10 customers this year", worked out from the data', { skip }, async () => {
  const r = await mcp('save_dashboard', { name: 'Sales', widgets: [REVENUE, TABLE, TOTAL], preview: true });
  assert.equal(r.isError, false, r.text);
  const [chart, table, total] = r.value.data;
  // The top 10 are found within this year's records: Big Co (last year only) and the two smallest are left out.
  assert.deepEqual(chart.top.values, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10']);
  assert.deepEqual(chart.categories, [`${year}-01`, `${year}-02`]);
  assert.equal(chart.series.length, 10);
  assert.deepEqual(chart.series[0], { name: 'C1', values: [600, 600] });
  assert.equal(chart.xTitle, 'Date by month');
  assert.match(chart.find[0], new RegExp(`^Find Date this year \\(${year}-01-01\\.\\.\\.${year}-12-31\\)$`));
  assert.match(chart.grouping, /Sum of Amount by Date \(per month\), then Customer, for the top 10 Customer values/);
  // The table: largest first, by revenue.
  assert.deepEqual(table.columns, ['Customer', 'sum(Amount)', 'Records']);
  assert.deepEqual(table.rows[0], ['C1', 1200, 2]);
  assert.equal(table.rows.length, 10);
  assert.deepEqual(table.rows.at(-1), ['C10', 300, 2]);
  // Everything this year: 2 × 50 × (12 + 11 + ... + 1).
  assert.equal(total.value, 7800);
  assert.equal(total.foundCount, 24);
  // A field that isn't there is an error on that widget only.
  const bad = await mcp('save_dashboard', { name: 'Bad', preview: true, widgets: [{ ...TOTAL, measure: { field: 'Nope', fn: 'sum' } }, TOTAL] });
  assert.match(bad.value.data[0].error, /Nope/);
  assert.equal(bad.value.data[1].value, 7800);
  // A relative date stays relative in what is saved.
  const saved = await mcp('save_dashboard', { name: 'Sales', widgets: [REVENUE, TABLE, TOTAL] });
  assert.equal(saved.value.saved, true);
  assert.deepEqual(saved.value.dashboard.widgets[0].query, [{ Date: 'this year' }]);
  assert.match((await mcp('save_dashboard', { name: 'sales', widgets: [TOTAL] })).text, /already a dashboard named "Sales"; pass replace: true/);
  assert.equal((await mcp('save_dashboard', { name: 'Sales', widgets: [TOTAL], replace: true })).value.dashboard.widgets.length, 1);
  const got = await mcp('get_dashboard', { dashboard: 'SALES' });
  assert.equal(got.value.data[0].value, 7800);
  assert.deepEqual((await mcp('list_dashboards', {})).value.dashboards.map((d: { name: string }) => d.name), ['Sales']);
});

async function login(account: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}',
  });
  return { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
}

const api = async (headers: Record<string, string>, method: string, path = '', body?: unknown) => {
  const r = await fetch(`${base}/tabularius/dashboards/v1/databases/Charts${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
};

test('dashboards: saved and shown over HTTP, worked out as each account', { skip }, async () => {
  const admin = await login('Admin');
  const clerkSession = await login('Clerk');
  const made = await api(admin, 'POST', '', { name: 'Regional', widgets: [TOTAL, { ...TABLE, top: undefined, groupBy: ['Region'] }] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.dashboard.id;
  assert.equal(made.body.data[0].value, 7800);
  // The clerk sees East records only, so the same dashboard adds up to less for them.
  const seen = await api(clerkSession, 'GET', `/${id}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.canChange, false);
  // East is the odd customers: 2 × 50 × (12 + 10 + 8 + 6 + 4 + 2).
  assert.equal(seen.body.data[0].value, 4200);
  assert.deepEqual(seen.body.data[1].rows.map((r: unknown[]) => r[0]), ['East']);
  // Only the account that made it (or [Full Access]) changes or deletes it.
  assert.equal((await api(clerkSession, 'PUT', `/${id}`, { name: 'Mine now' })).status, 403);
  assert.equal((await api(clerkSession, 'DELETE', `/${id}`)).status, 403);
  const own = await api(clerkSession, 'POST', '', { name: 'Clerk view', widgets: [TOTAL] });
  assert.equal(own.status, 201);
  assert.equal((await api(clerkSession, 'PUT', `/${own.body.dashboard.id}`, { name: 'My East total' })).body.dashboard.name, 'My East total');
  const list = await api(clerkSession, 'GET');
  assert.deepEqual(list.body.dashboards.map((d: { name: string; canChange: boolean }) => [d.name, d.canChange]), [['My East total', true], ['Regional', false], ['Sales', false]]);
  // Preview works it out without saving; bad input is a 400 with a reason.
  const preview = await api(admin, 'POST', '?preview=1', { name: 'Try', widgets: [{ ...TOTAL, query: [{ Date: 'last year' }] }] });
  assert.equal(preview.body.data[0].value, 100000);
  assert.equal((await api(admin, 'GET')).body.dashboards.length, 3);
  const bad = await api(admin, 'POST', '', { name: 'x', widgets: [] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error.message, /at least one widget/);
  assert.equal((await api(admin, 'DELETE', `/${own.body.dashboard.id}`)).status, 200);
  assert.equal((await api(admin, 'GET', `/${own.body.dashboard.id}`)).status, 404);
  assert.equal((await fetch(`${base}/tabularius/dashboards/v1/databases/Charts`)).status, 401);
});

test('dashboards: a widget is worked out with the date it is looked at', { skip }, () => {
  const w = { title: 'Last year', kind: 'number' as const, layout: 'Invoices', query: [{ Date: 'this year' }], measure: { field: 'Amount', fn: 'sum' as const } };
  assert.equal(computeWidget(store, w, undefined, new Date(year + 1, 0, 5)).value, 0);
  assert.equal(computeWidget(store, w, undefined, new Date(year - 1, 6, 1)).value, 100000);
});
