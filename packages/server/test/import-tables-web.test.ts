// POST /tabularius/design/v1/databases/{db}/import-tables: the web client's Import Tables dialog, on the same code as
// `tabularius import-tables`. Full Access only; a preview writes nothing; the answer is counts and a plan, never records.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, type Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const CLIENTS = 'Name,Notes\r\nAcme,"line one\nline two"\r\nBeta,short\r\nGamma,plain\r\n';
const ORDERS = 'Order,Client,Total\r\n1,Acme,$10.50\r\n2,"Acme, Beta",20\r\n3,Gamma,"1,000"\r\n';
const PATH = '/tabularius/design/v1/databases/Work/import-tables';

interface Running {
  url: string;
  store: Store;
  post: (token: string, form: FormData, query?: string) => Promise<{ status: number; text: string; json: any }>;
  boss: string;
  staff: string;
}

async function start(t: TestContext): Promise<Running> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-tables-web-'));
  createStore(join(dir, 'Work.openhbam.sqlite'));
  const running = await serve({ dir, port: 0, log: () => {} });
  t.after(async () => {
    await new Promise<void>((resolve) => running.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const store = running.host.get('Work')!;
  store.setAiPolicy(false);
  store.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmrest', 'fmapp'] });
  store.setPassword('boss', 'pw', '[Full Access]');
  store.setPassword('staff', 'pw', 'Staff');
  const signIn = async (name: string) => {
    const r = await fetch(`${running.url}/fmi/data/vLatest/databases/Work/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${name}:pw`), 'content-type': 'application/json' }, body: '{}' });
    return ((await r.json()) as any).response.token as string;
  };
  return {
    url: running.url, store, boss: await signIn('boss'), staff: await signIn('staff'),
    post: async (token, form, query = '') => {
      const r = await fetch(`${running.url}${PATH}${query}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
      const text = await r.text();
      return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() };
    },
  };
}

const file = (form: FormData, name: string, text: string | Uint8Array, part = 'file') => form.append(part, new Blob([text as BlobPart]), name);
const files = (...entries: [string, string][]) => {
  const form = new FormData();
  for (const [name, text] of entries) file(form, name, text);
  return form;
};
const tableNames = (s: Store) => s.schema.tables.map((t) => t.name);

test('a preview plans the tables with a few rows of each and writes nothing', async (t) => {
  const s = await start(t);
  const r = await s.post(s.boss, files(['Clients-Grid view.csv', CLIENTS], ['Orders-Grid view.csv', ORDERS]));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.plan.sheets.map((x: any) => [x.sheet, x.table, x.rows]), [['Clients', 'Clients', 3], ['Orders', 'Orders', 3]]);
  const orders = r.json.plan.sheets[1].columns;
  assert.deepEqual(orders.map((c: any) => [c.header, c.kind, c.target ?? null]), [['Order', 'number', null], ['Client', 'link', 'Clients'], ['Total', 'number', null]]);
  assert.deepEqual(r.json.samples.Orders[0], ['1', 'Acme', '$10.50']);
  assert.ok(r.json.samples.Clients.length <= 3);
  assert.match(r.json.plan.notes[0], /Formulas are not translated/);
  assert.deepEqual(tableNames(s.store), [], 'nothing was written');
});

test('a column kind chosen in the dialog replaces the guess, and a bad choice is refused with a reason', async (t) => {
  const s = await start(t);
  const form = files(['Clients-Grid view.csv', CLIENTS], ['Orders-Grid view.csv', ORDERS]);
  form.append('overrides', JSON.stringify({ Orders: { Total: 'text', Client: 'skip' } }));
  const r = await s.post(s.boss, form);
  assert.equal(r.status, 200, r.text);
  const cols = r.json.plan.sheets[1].columns;
  assert.deepEqual(cols.map((c: any) => [c.header, c.kind, c.inferred]), [['Order', 'number', true], ['Client', 'skip', false], ['Total', 'text', false]]);

  for (const [overrides, status, message] of [
    [JSON.stringify({ Orders: { Total: 'banana' } }), 400, /"banana" is not a column kind/],
    [JSON.stringify({ Orders: { Total: 'link:Nowhere' } }), 400, /not among the sheets/],
    ['{not json', 400, /should be JSON/],
    [JSON.stringify({ Orders: 'text' }), 400, /should be JSON/],
    [JSON.stringify([1]), 400, /should be JSON/],
  ] as const) {
    const bad = files(['Clients-Grid view.csv', CLIENTS], ['Orders-Grid view.csv', ORDERS]);
    bad.append('overrides', overrides);
    const got = await s.post(s.boss, bad);
    assert.equal(got.status, status, `${overrides}: ${got.text}`);
    assert.equal(got.json.error.code, 3);
    assert.match(got.json.error.message, message);
  }
  assert.deepEqual(tableNames(s.store), []);
});

test('the import makes the tables, links and portals, and answers in counts, not values', async (t) => {
  const s = await start(t);
  const r = await s.post(s.boss, files(['Clients-Grid view.csv', CLIENTS], ['Orders-Grid view.csv', ORDERS]), '?stage=import');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.report.tables, r.json.report.rows, r.json.report.joinTables, r.json.report.links], [2, 6, 1, 4]);
  assert.match(r.json.summary[0], /2 tables, .* 1 join table holding 4 links/);
  assert.doesNotMatch(r.text, /Acme|line one|\$10\.50/, 'no record values in the answer');
  assert.deepEqual(tableNames(s.store), ['Clients', 'Orders', 'Orders Client']);
  assert.equal(s.store.select('SELECT count(*) AS n FROM "Orders Client"', [], 10).rows[0][0], 4);
  // The same files again: the names are taken, so the plan says "Clients 2".
  const again = await s.post(s.boss, files(['Clients-Grid view.csv', CLIENTS]));
  assert.equal(again.json.plan.sheets[0].table, 'Clients 2');
});

test('links=0 keeps linked-record columns as plain columns', async (t) => {
  const s = await start(t);
  const r = await s.post(s.boss, files(['Clients-Grid view.csv', CLIENTS], ['Orders-Grid view.csv', ORDERS]), '?stage=import&links=0');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.report.joinTables, r.json.report.links], [0, 0]);
  assert.deepEqual(tableNames(s.store), ['Clients', 'Orders']);
});

test('only Full Access imports: another account, a read-only or layout token and a missing sign-in are refused, and nothing is made', async (t) => {
  const s = await start(t);
  const form = () => files(['Clients-Grid view.csv', CLIENTS]);
  const staff = await s.post(s.staff, form(), '?stage=import');
  assert.equal(staff.status, 403);
  assert.equal(staff.json.error.code, 9);
  const preview = await s.post(s.staff, form());
  assert.equal(preview.status, 403, 'a preview shows the plan of someone else\'s file to no one either');
  const signedOut = await fetch(`${s.url}${PATH}`, { method: 'POST', body: form() });
  assert.equal(signedOut.status, 401);
  assert.deepEqual(tableNames(s.store), []);
  // A read-only token of the Full Access account.
  s.store.setPassword('reader', 'pw', '[Full Access]');
  const token = s.store.createApiToken('reader', { label: 'read only', readOnly: true });
  const ro = await s.post(token, form(), '?stage=import');
  assert.equal(ro.status, 403, ro.text);
  assert.deepEqual(tableNames(s.store), []);
});

test('files that cannot be read, nothing chosen, too many files and too large a body are refused with a reason', async (t) => {
  const s = await start(t);
  const none = await s.post(s.boss, new FormData());
  assert.equal(none.status, 400);
  assert.match(none.json.error.message, /Choose the files/);
  const bad = new FormData();
  file(bad, 'Broken.xlsx', 'this is not a workbook');
  const unreadable = await s.post(s.boss, bad);
  assert.equal(unreadable.status, 400);
  assert.match(unreadable.json.error.message, /^Broken\.xlsx: /);
  const empty = new FormData();
  file(empty, 'Empty.csv', '');
  assert.match((await s.post(s.boss, empty)).json.error.message, /Empty\.csv is empty/);
  const many = new FormData();
  for (let i = 0; i < 21; i++) file(many, `T${i}.csv`, 'A,B\r\n1,2\r\n');
  assert.match((await s.post(s.boss, many)).json.error.message, /at most 20 files/);
  const twice = files(['Same.csv', 'A\r\n1\r\n'], ['Same.csv', 'A\r\n2\r\n']);
  assert.match((await s.post(s.boss, twice)).json.error.message, /two sheets are called "Same"/);
  const big = new FormData();
  file(big, 'Big.csv', new Uint8Array(51 * 1024 * 1024).fill(0x61));
  const large = await s.post(s.boss, big);
  assert.equal(large.status, 413);
  assert.deepEqual(tableNames(s.store), []);
  const got = await fetch(`${s.url}${PATH}`, { headers: { authorization: `Bearer ${s.boss}` } });
  assert.equal(got.status, 405, 'GET is not a command');
});

test('a workbook gives a table for its sheet; a folder of Notion pages gives one table', async (t) => {
  const s = await start(t);
  const { xlsx } = await import('../../scripts/src/xlsx.ts');
  const book = xlsx([['Name', 'Age'], ['Ann', 31], ['Bo', 44]], 'People');
  const form = new FormData();
  file(form, 'Book.xlsx', book);
  file(form, 'Task one.md', '# Write docs\nStatus: Done\n\nBody text', 'pages');
  file(form, 'Task two.md', '# Fix bug\nStatus: Open\n', 'pages');
  file(form, 'ignored.png', 'x', 'pages');
  form.append('folder', 'Notion Tasks');
  const r = await s.post(s.boss, form);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.plan.sheets.map((x: any) => [x.sheet, x.rows]), [['People', 2], ['Notion Tasks', 2]]);
  assert.deepEqual(r.json.plan.sheets[1].columns.map((c: any) => c.header), ['Title', 'Status', 'Body']);
});
