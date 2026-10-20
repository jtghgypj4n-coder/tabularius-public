import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { asText, type Value } from '@tabularius/calc';
import { createStore, type Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { PgClient } from './pg-client.ts';

// The grammar of FileMaker SQL as Claris's public SQL reference describes it (data/sql-grammar.json: one example per
// construct, the page it comes from, and the result), run through ExecuteSQL, pgwire, and HTTP SQL against a small
// synthetic file. A result the page states is marked "result"; one worked out from its rule is "derived". An outcome
// the page does not specify is "unverified" and reported without an expectation. Where a path still disagrees with a
// stated result, the entry has `known` with a reason; the test insists it still disagrees until that reason is removed.
interface Entry {
  id: string; area: string; construct: string; source: string; sql: string; expected: 'result' | 'derived' | 'unverified';
  rows?: string[][]; error?: boolean; columns?: string[]; known?: string; paths?: ('executesql' | 'wire' | 'http')[]; unordered?: boolean; note?: string;
  params?: (string | number)[];
}
const grammar = JSON.parse(readFileSync(join(import.meta.dirname, 'data', 'sql-grammar.json'), 'utf8')) as Entry[];

let dir: string;
let server: Server;
let store: Store;
let port: number;
let sqlUrl: string;

const EMP: [string, string, string, string, string, number | null, string, string, number][] = [
  ['E1', 'Smith', 'John', 'D101', '', 50000, '2020-03-15', '', 1], ['E2', 'Jones', 'Alea', 'D101', 'E1', 30000, '2021-06-01', '', 0],
  ['E3', 'Marks', 'Alea', 'D102', 'E1', 45000, '2019-01-10', '', 1], ['E4', 'Allen', 'Ann', 'D102', 'E3', 45000, '2022-11-30', '', 0],
  ['E5', 'Conrad', 'Bob', 'D103', 'E1', 20000, '2018-05-05', '', 1], ['E6', 'Mattson', 'Cy', 'D103', 'E5', null, '2023-02-28', '', 0],
  ['E7', "O'Neil", 'Dee', 'D104', 'E1', 62000, '2017-09-09', '', 1],
];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-grammar-'));
  createStore(join(dir, 'Grammar.openhbam.sqlite'));
  const logs: string[] = [];
  const s = await serve({ dir, port: 0, watch: false, sqlPort: 0, log: (m) => void logs.push(m) });
  server = s.server;
  sqlUrl = `${s.url}/tabularius/sql/v1/databases/Grammar`;
  store = s.host.get('Grammar')!;
  const text = (name: string) => ({ name });
  store.applyDesign([
    { op: 'createTable', name: 'emp', fields: [text('emp_id'), text('last_name'), text('first_name'), text('dept'), text('manager_id'), { name: 'salary', type: 'number' }, { name: 'hire_date', type: 'date' }, { name: 'exempt', type: 'number' }] },
    { op: 'createTable', name: 'Salespeople', fields: [text('Salesperson_ID'), text('Salesperson'), text('Sales_Manager')] },
    { op: 'createTable', name: 'Sales_Data', fields: [{ name: 'Invoice_ID', type: 'number' }, text('Salesperson_ID'), text('Company_Name'), { name: 'Amount', type: 'number' }, { name: 'Date_Sold', type: 'date' }, { name: 'Time_Sold', type: 'time' }] },
    { op: 'createTable', name: 'Payroll', fields: [{ name: 'Salary', type: 'number' }] },
    { op: 'createTable', name: 'Order Details', fields: [text('Last Name'), text('SELECT')] },
    { op: 'createTable', name: 'GROUP', fields: [text('Label')] },
    { op: 'createTable', name: 'ContainerDocs', fields: [{ name: 'Pic', type: 'container' }] },
  ] as never);
  const add = (table: string, record: Record<string, string>) => store.create(table, record, { dateOrder: 'ISO' });
  for (const [emp_id, last_name, first_name, dept, manager_id, salary, hire_date, , exempt] of EMP) {
    add('emp', { emp_id, last_name, first_name, dept, manager_id, salary: salary === null ? '' : String(salary), hire_date, exempt: String(exempt) });
  }
  for (const [id, name, mgr] of [['SP-1', 'Ann Lee', ''], ['SP-2', 'Bo Park', 'SP-1'], ['SP-3', 'Cy Day', 'SP-1']]) add('Salespeople', { Salesperson_ID: id, Salesperson: name, Sales_Manager: mgr });
  for (const [n, sp, co, amount, date, time] of [
    [1, 'SP-1', 'State University', '4000', '2028-01-30', '09:00:00'], [2, 'SP-1', 'Exports UK', '2500', '2028-02-15', '13:30:00'],
    [3, 'SP-2', 'Home Furniture Suppliers', '800', '2028-03-01', '08:15:00'], [4, 'SP-2', 'City University', '3500', '2028-03-20', '17:45:00'],
    [5, 'SP-4', 'Acme', '', '2028-04-01', '11:00:00'],
  ] as const) add('Sales_Data', { Invoice_ID: String(n), Salesperson_ID: sp, Company_Name: co, Amount: amount, Date_Sold: date, Time_Sold: time });
  for (const salary of ['1234.56', '2000.4', '999.5']) add('Payroll', { Salary: salary });
  add('Order Details', { 'Last Name': 'Smith', SELECT: 'yes' });
  add('GROUP', { Label: 'quoted table' });
  const doc = Number(store.create('ContainerDocs', {}).recordId);
  store.setContainer('ContainerDocs', doc, 'Pic', 1, { filename: 'sample.txt', mime: 'text/plain', data: new TextEncoder().encode('sample') });
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
  store.setPassword('Admin', 'pw', full.name);
  for (let i = 0; i < 100 && !logs.some((l) => l.startsWith('PostgreSQL clients: port')); i++) await new Promise((r) => setTimeout(r, 20));
  port = Number(/port (\d+)/.exec(logs.find((l) => l.startsWith('PostgreSQL clients'))!)![1]);
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

type Outcome = { rows: string[][]; columns?: string[] } | { error: string };
const viaExecuteSQL = (e: Entry): Outcome => {
  try {
    const params: Value[] = (e.params ?? []).map((v) => typeof v === 'number' ? { type: 'number', value: v } : { type: 'text', value: v });
    return { rows: store.calc.executeSQL(e.sql, params).map((r) => r.map((v) => asText(v))) };
  } catch (error) { return { error: (error as Error).message }; }
};
const viaWire = async (c: PgClient, sql: string): Promise<Outcome> => {
  const r = await c.simple(sql);
  return r.error ? { error: `${r.error.code} ${r.error.message}` } : { rows: r.rows.map((row) => row.map((v) => v ?? '')), columns: r.columns };
};
const viaHttp = async (e: Entry): Promise<Outcome> => {
  const r = await fetch(sqlUrl, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa('Admin:pw')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql: e.sql, params: e.params ?? [] }),
  });
  const body = await r.json() as { rows?: (string | number | null)[][]; columns?: { name: string }[]; error?: { message: string } };
  return body.error ? { error: body.error.message } : {
    rows: (body.rows ?? []).map((row) => row.map((v) => v === null ? '' : String(v))),
    columns: body.columns?.map((column) => column.name),
  };
};
const same = (a: string, b: string) => {
  if (a === b) return true;
  const x = Number(a);
  const y = Number(b);
  return a.trim() !== '' && b.trim() !== '' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
};
/** Why the outcome differs from the entry, or undefined when it agrees. */
function differs(e: Entry, o: Outcome): string | undefined {
  if (e.error) return 'error' in o ? undefined : `expected an error, got ${JSON.stringify(o.rows).slice(0, 120)}`;
  if ('error' in o) return `expected rows, got the error ${o.error.slice(0, 160)}`;
  const key = (r: string[]) => JSON.stringify(r);
  const want = e.unordered ? [...e.rows!].sort((a, b) => key(a).localeCompare(key(b))) : e.rows!;
  const got = e.unordered ? [...o.rows].sort((a, b) => key(a).localeCompare(key(b))) : o.rows;
  if (want.length !== got.length) return `expected ${want.length} rows, got ${got.length}: ${JSON.stringify(got).slice(0, 160)}`;
  for (let i = 0; i < want.length; i++) {
    if (want[i].length !== got[i].length || want[i].some((c, j) => !same(c, got[i][j]))) return `row ${i}: expected ${key(want[i])}, got ${key(got[i])}`;
  }
  if (e.columns && o.columns && JSON.stringify(e.columns) !== JSON.stringify(o.columns)) {
    return `expected columns ${JSON.stringify(e.columns)}, got ${JSON.stringify(o.columns)}`;
  }
  return undefined;
}

const checked = grammar.filter((e) => (e.rows || e.error) && e.paths?.length !== 0);

test('the grammar file names the page of every construct and says whether the page states the result', () => {
  assert.equal(new Set(grammar.map((e) => e.id)).size, grammar.length);
  for (const e of grammar) {
    assert.match(e.source, /^https:\/\/help\.claris\.com\/en\/(?:sql-reference|pro-help)\/content\/[\w-]+\.html$/, e.id);
    assert.ok(['result', 'derived', 'unverified'].includes(e.expected), e.id);
    assert.equal(e.expected === 'unverified', e.paths?.length === 0, `${e.id} must mark unknown vendor behavior unverified`);
    if (e.params) {
      assert.ok(e.sql.includes('?'), `${e.id} has parameters but no placeholder`);
      assert.deepEqual(e.paths, ['executesql', 'http'], `${e.id} uses ? on the paths that accept it`);
    }
    if (!e.error && e.paths?.length !== 0) assert.ok(e.rows, `${e.id} has no expected rows`);
  }
});

test('each construct gives the documented result through ExecuteSQL and both SQL connections', async () => {
  const c = await PgClient.open({ port, user: 'Admin', password: 'pw', database: 'Grammar' });
  const counts: Record<string, { pass: number; known: number }> = {};
  const failures: string[] = [];
  try {
    for (const e of checked) {
      const paths = e.paths ?? ['executesql', 'wire', 'http'];
      const problems: string[] = [];
      for (const path of paths) {
        const why = differs(e, path === 'executesql' ? viaExecuteSQL(e) : path === 'wire' ? await viaWire(c, e.sql) : await viaHttp(e));
        if (why) problems.push(`${path}: ${why}`);
      }
      const area = (counts[e.area] ??= { pass: 0, known: 0 });
      if (e.known) {
        if (!problems.length) failures.push(`${e.id} now agrees with the page: take "known" out of the file`);
        area.known++;
      } else {
        if (problems.length) failures.push(`${e.id} (${e.construct}) ${e.sql}\n    ${problems.join('\n    ')}`);
        area.pass++;
      }
      // Whatever the query did, the connection answers the next one.
      assert.deepEqual((await c.simple('SELECT 1')).rows, [['1']], `after ${e.id}`);
    }
  } finally { c.close(); }
  const total = Object.values(counts).reduce((n, a) => n + a.pass + a.known, 0);
  console.log(`SQL grammar: ${total} constructs checked through ExecuteSQL, pgwire and HTTP SQL; ` + Object.entries(counts).map(([k, v]) => `${k} ${v.pass}${v.known ? ` (+${v.known} known)` : ''}`).join(', '));
  assert.deepEqual(failures, []);
});

test('the constructs the pages do not pin down are listed as not verified, with no expectation', async () => {
  const open = grammar.filter((e) => e.paths?.length === 0);
  assert.ok(open.length >= 2);
  const c = await PgClient.open({ port, user: 'Admin', password: 'pw', database: 'Grammar' });
  try {
    for (const e of open) {
      assert.ok(e.note, e.id);
      console.log(`SQL grammar unverified ${e.id}: ${JSON.stringify({ executesql: viaExecuteSQL(e), wire: await viaWire(c, e.sql), http: await viaHttp(e) })}`);
    }
  } finally { c.close(); }
});

test('the conformance page lists every construct that still differs', () => {
  const page = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'sql-grammar-conformance.md'), 'utf8');
  for (const e of grammar.filter((x) => x.known)) assert.ok(page.includes(`| ${e.id} |`), `${e.id} is not in the KNOWN table of docs/sql-grammar-conformance.md`);
  for (const e of grammar.filter((x) => x.paths?.length === 0)) assert.ok(page.includes(`\`${e.id}\``), `${e.id} is not in the not-verified list`);
});
