// The AI tools (describe_layout, compare_solutions) and related-field finds work within an account's privilege set.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { compareSolutions } from '../src/compare.ts';
import type { PrivilegeDefinition, Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

const NONE = { view: false, edit: false, create: false, delete: false } as const;
const sets: PrivilegeDefinition[] = [
  // Democrats only, without ACLU scores.
  {
    name: 'Clerk', records: NONE,
    tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false, fields: { ACLU: 'none' } } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'],
  },
  // Every customer, but only Nancy Davolio's sales rows, without their totals.
  {
    name: 'Sales', records: NONE,
    tables: {
      'NW Customers': { view: true, edit: false, create: false, delete: false },
      'NW SalespersonCustomers': { view: 'Salesperson = "Nancy Davolio"', edit: false, create: false, delete: false, fields: { 'Total Sales': 'none' } },
    },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'],
  },
  // Can read everything and modify scripts, but is not [Full Access].
  {
    name: 'Designer', records: { view: true, edit: true, create: true, delete: true },
    layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmmcp'],
  },
];

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-privileges-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  for (const set of sets) {
    store.savePrivilegeSet(set);
    store.setPassword(set.name, 'pw', set.name);
  }
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const mcp = async (auth: string, name: string, args: Record<string, unknown>) => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      authorization: 'Basic ' + btoa(auth),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return { error: !!body.result.isError, text: body.result.content[0].text as string };
};

test('related finds: hidden related fields are missing, unviewable related records never match', { skip }, () => {
  const layout = 'Related records • Pie';
  const sales = store.privileges('Sales');
  const find = (query: Record<string, string>) => store.find(layout, { query: [query], privileges: sales, limit: 0 }).foundCount;
  // Robert King's rows exist, but Sales can only view Nancy Davolio's.
  assert.ok(store.find(layout, { query: [{ 'NW SalespersonCustomers::Salesperson': '==Robert King' }], limit: 0 }).foundCount > 0);
  assert.equal(find({ 'NW SalespersonCustomers::Salesperson': '==Robert King' }), 0);
  assert.ok(find({ 'NW SalespersonCustomers::Salesperson': '==Nancy Davolio' }) > 0);
  assert.throws(() => find({ 'NW SalespersonCustomers::Total Sales': '*' }), /Field "NW SalespersonCustomers::Total Sales" is missing/);
  assert.throws(() => store.findIds(layout, { query: [{ 'NW SalespersonCustomers::Total Sales': '*' }], privileges: sales }), /is missing/);
});

test('describe_layout: only the fields an account sees, values from records it can view', { skip }, async () => {
  const clerk = JSON.parse((await mcp('Clerk:pw', 'describe_layout', { database: 'Charts', layout: 'Congress' })).text);
  const democrats = Number(store.query(`SELECT count(*) AS n FROM Congress WHERE Party = 'D'`)[0].n);
  assert.equal(clerk.records, democrats);
  assert.deepEqual(clerk.fields.find((f: { name: string }) => f.name === 'Party').values, ['D']);
  assert.ok(!clerk.fields.some((f: { name: string }) => f.name === 'ACLU'));

  const sales = JSON.parse((await mcp('Sales:pw', 'describe_layout', { database: 'Charts', layout: 'Related records • Pie' })).text);
  assert.deepEqual(sales.fields.find((f: { name: string }) => f.name === 'NW SalespersonCustomers::Salesperson').values, ['Nancy Davolio']);
  assert.ok(!sales.fields.some((f: { name: string }) => f.name === 'NW SalespersonCustomers::Total Sales'));
  // A related find through MCP follows the same rules.
  const found = await mcp('Sales:pw', 'find_records', { database: 'Charts', layout: 'Related records • Pie', query: [{ 'NW SalespersonCustomers::Salesperson': '==Robert King' }] });
  assert.equal(JSON.parse(found.text).foundCount, 0, found.text);

  // Design tools stay closed to sets that can't see the design.
  assert.ok((await mcp('Clerk:pw', 'explain_solution', { database: 'Charts' })).error);
  assert.ok((await mcp('Clerk:pw', 'check_calculation', { database: 'Charts', layout: 'Congress', formula: 'ACLU' })).error);
});

test('compare_solutions: accounts and privilege sets only for [Full Access]', { skip }, async () => {
  assert.ok('accounts' in compareSolutions(store, store));
  const c = compareSolutions(store, store, { security: false });
  assert.ok(!('accounts' in c) && !('privilegeSets' in c));
  const r = await mcp('Designer:pw', 'compare_solutions', { from: 'Charts', to: 'Charts' });
  assert.ok(!r.error, r.text);
  assert.match(JSON.parse(r.text).summary, /No differences/);
});

test('search_records: words in any table, within the account\'s privileges, kept up to date', { skip }, async () => {
  const { searchRecords } = await import('../src/record-search.ts');
  const all = searchRecords(store, 'robert king');
  assert.ok(all.matchedAll && all.hits.length > 0);
  assert.equal(all.hits[0].matches[0].text, '[Robert] [King]');
  // Sales sees only Nancy Davolio's salesperson rows; Clerk sees only Democrats in Congress.
  const sales = searchRecords(store, 'robert king', { privileges: store.privileges('Sales') });
  assert.ok(sales.hits.every((h) => h.table === 'NW Customers' || h.table === 'NW SalespersonCustomers'));
  assert.ok(!sales.hits.some((h) => h.table === 'NW SalespersonCustomers' && h.matches.some((m) => /Robert/.test(m.text))));
  const clerk = JSON.parse((await mcp('Clerk:pw', 'search_records', { database: 'Charts', text: 'ohio' })).text);
  const ohio = Number(store.query(`SELECT count(*) AS n FROM Congress WHERE State = 'Ohio' AND Party = 'D'`)[0].n);
  assert.equal(clerk.hits.length, ohio);
  assert.ok(clerk.hits.every((h: { table: string; layout: string }) => h.table === 'Congress' && h.layout));
  // A changed record is searchable straight away.
  const [{ _fm_record_id: id }] = store.query(`SELECT _fm_record_id FROM Congress WHERE Party = 'D' LIMIT 1`);
  store.update('Congress', Number(id), { Name: 'Zanzibar Quokka' });
  const found = JSON.parse((await mcp('Clerk:pw', 'search_records', { database: 'Charts', text: 'quokka zanz' })).text);
  assert.deepEqual(found.hits.map((h: { recordId: number }) => h.recordId), [Number(id)]);
});

test('search_records: a read that SQLite stops with "database schema has changed" is run again', { skip }, async () => {
  // Another process building or dropping a word index can change the schema while the rows are read, not only when
  // the statement is prepared (seen as a CI failure).
  const { searchRecords } = await import('../src/record-search.ts');
  const sql = store.sql;
  const prepare = sql.prepare.bind(sql);
  let failed = 0;
  sql.prepare = ((text: string) => {
    const st = prepare(text);
    if (!failed && /bm25/.test(text)) {
      const all = st.all.bind(st);
      st.all = ((...args: unknown[]) => {
        if (!failed++) throw Object.assign(new Error('vtable constructor failed'), { errcode: 17, errstr: 'database schema has changed' });
        return all(...(args as []));
      }) as typeof st.all;
    }
    return st;
  }) as typeof sql.prepare;
  try {
    const r = searchRecords(store, 'robert king');
    assert.equal(failed, 1);
    assert.equal(r.hits[0].matches[0].text, '[Robert] [King]');
  } finally {
    delete (sql as { prepare?: unknown }).prepare;
  }
});

test('summarize_records: totals and breakdowns of a found set, within the account\'s privileges', { skip }, async () => {
  const { summarizeRecords } = await import('../src/summarize.ts');
  const expect = store.query(`SELECT Party, count(*) AS n, avg(CASE WHEN typeof(ACLU) IN ('integer', 'real') THEN ACLU END) AS a, max(CASE WHEN typeof(ACLU) IN ('integer', 'real') THEN ACLU END) AS hi FROM Congress GROUP BY Party ORDER BY n DESC, Party`);
  const all = summarizeRecords(store, { layout: 'Congress', groupBy: ['party'], measures: [{ field: 'ACLU', fn: 'average' }, { field: 'ACLU', fn: 'max' }] });
  assert.equal(all.foundCount, store.find('Congress', { limit: 0 }).foundCount);
  assert.deepEqual(all.groups!.map((g) => [g.values.Party, g.count, g.measures['max(ACLU)']]), expect.map((r) => [r.Party, r.n, r.hi]));
  assert.ok(Math.abs(Number(all.groups![0].measures['average(ACLU)']) - Number(expect[0].a)) < 1e-6);
  // With a find, and fewer groups than there are.
  const ohio = summarizeRecords(store, { layout: 'Congress', query: [{ State: 'Ohio' }], groupBy: ['Party'], limit: 1 });
  assert.equal(ohio.foundCount, Number(store.query(`SELECT count(*) AS n FROM Congress WHERE State = 'Ohio'`)[0].n));
  assert.equal(ohio.groups!.length, 1);
  assert.ok(ohio.groupCount! > 1);

  // Clerk sees only Democrats, and not their ACLU scores.
  const clerk = JSON.parse((await mcp('Clerk:pw', 'summarize_records', { database: 'Charts', layout: 'Congress', groupBy: ['Party'] })).text);
  const d = Number(store.query(`SELECT count(*) AS n FROM Congress WHERE Party = 'D'`)[0].n);
  assert.deepEqual(clerk.groups, [{ values: { Party: 'D' }, count: d, measures: {} }]);
  const hidden = await mcp('Clerk:pw', 'summarize_records', { database: 'Charts', layout: 'Congress', measures: [{ field: 'ACLU', fn: 'sum' }] });
  assert.ok(hidden.error && /ACLU" is missing/.test(JSON.parse(hidden.text).message), hidden.text);
  const grouped = await mcp('Clerk:pw', 'summarize_records', { database: 'Charts', layout: 'Congress', groupBy: ['ACLU'] });
  assert.ok(grouped.error);
});
