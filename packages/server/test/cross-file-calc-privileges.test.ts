import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { createStore, type Store } from '../../store/src/index.ts';

// A calculation that reads another hosted file follows that file's privileges for whoever writes, tests or explains it.
// UI is the interface file (table Mine, an external occurrence P of Data's People); Data holds the values. Everything
// is built here. Accounts: Des has Full Access in UI and no account in Data; Hid has a set in Data that hides Salary;
// Rows sees only Ann's row there; Both has Full Access in both files.
const SALARY = '123456';
const BOBS = '654321';
const keys = ['fmrest', 'fmapp', 'fmwebdirect', 'fmmcp'];
let dir: string;
let server: Server;
let base: string;
let ui: Store;
let data: Store;
const ids = { people: 0, name: 0, salary: 0 };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-xfile-calc-'));
  for (const name of ['UI', 'Data']) createStore(join(dir, `${name}.openhbam.sqlite`));
  const served = await serve({ dir, port: 0, hostname: '127.0.0.1', sqlPort: 0, watch: false, log: () => {} });
  server = served.server;
  base = served.url;
  [ui, data] = ['UI', 'Data'].map((n) => served.host.get(n)!);
  for (const store of [ui, data]) {
    store.setAiPolicy(false);
    store.savePrivilegeSet({ ...store.privilegeSet('[Full Access]')!, extendedPrivileges: keys });
  }
  data.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Salary', type: 'number' }] }]);
  const people = data.schema.tables.find((t) => t.name === 'People')!;
  ids.people = people.id;
  ids.name = people.fields.find((f) => f.name === 'Name')!.id;
  ids.salary = people.fields.find((f) => f.name === 'Salary')!.id;
  data.create('People', { Name: 'Ann', Salary: Number(SALARY) });
  data.create('People', { Name: 'Bob', Salary: Number(BOBS) });
  const open = { view: true, edit: true, create: true, delete: true };
  const base0 = { layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'] } as const;
  data.savePrivilegeSet({ name: 'NoSalary', ...base0, records: { ...open, fields: { Salary: 'none' } } } as never);
  data.savePrivilegeSet({ name: 'OnlyAnn', ...base0, records: { ...open, view: 'Name = "Ann"', edit: false, delete: false } } as never);
  data.setPassword('Admin', 'pw', '[Full Access]');
  data.setPassword('Both', 'pw', '[Full Access]');
  data.setPassword('Hid', 'pw', 'NoSalary');
  data.setPassword('Rows', 'pw', 'OnlyAnn');
  // The interface file, built by its owner: Mine relates to People by name.
  ui.applyDesign([
    { op: 'createTable', name: 'Mine', fields: [{ name: 'Key' }] },
    { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
    { op: 'createOccurrence', name: 'P', file: 'Data', externalTable: ids.people },
  ], { readOtherFile: () => true });
  ui.applyDesign([{ op: 'createRelationship', left: 'Mine', right: 'P', predicates: [{ left: 'Key', right: ids.name }] }]);
  ui.create('Mine', { Key: 'Ann' });
  ui.create('Mine', { Key: 'Bob' });
  // A calculation its owner wrote that reads the salary, to explain.
  ui.applyDesign([{ op: 'createField', table: 'Mine', name: 'Shown', kind: 'calculation', type: 'text', calculation: 'P::Salary & "!"', options: { unstored: true } }] as never, { readOtherFile: () => true });
  for (const account of ['Des', 'Hid', 'Rows', 'Both']) ui.setPassword(account, 'pw', '[Full Access]');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** The design route of the interface file, as an account of it. */
async function route(account: string, path: string, body: unknown) {
  const r = await fetch(`${base}/tabularius/design/v1/databases/UI${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ui.createApiToken(account)}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text) as any };
}

let n = 0;
let named = 0;
const field = (suffix: string) => `F${++named}${suffix}`;
/** One new field of Mine through the design route. */
const make = (account: string, spec: Record<string, unknown>) => route(account, '', { changes: [{ op: 'createField', table: 'Mine', ...spec }] });
const stored = (name: string) => ui.sql.prepare(`SELECT Key, ${name} AS v FROM Mine ORDER BY _fm_record_id`).all().map((r: any) => r.v);
/** The words of an error with the formula's own names taken out, to compare what is said about a field that exists with one that doesn't. */
const said = (text: string, ...names: string[]) => names.reduce((s, x) => s.split(x).join('·'), text);

test('a designer with no account in the data file cannot save a stored calculation that reads it, and what is said does not tell a real field from a made-up one', async () => {
  const real = await make('Des', { name: field('a'), kind: 'calculation', type: 'text', calculation: 'P::Salary' });
  const unreal = await make('Des', { name: field('b'), kind: 'calculation', type: 'text', calculation: 'P::Wage' });
  assert.equal(real.status, 400, real.text);
  assert.equal(unreal.status, 400, unreal.text);
  assert.equal(said(real.body.error.message, 'Salary'), said(unreal.body.error.message, 'Wage'));
  assert.equal(real.body.error.code, unreal.body.error.code);
  assert.doesNotMatch(real.text + unreal.text, new RegExp(`${SALARY}|${BOBS}`));
  assert.equal(ui.schema.tables.find((t) => t.name === 'Mine')!.fields.some((f) => /^F\d+[ab]$/.test(f.name)), false, 'nothing was saved');
});

test('the same holds for an auto-enter calculation, a validation calculation, its message and a lookup', async () => {
  const salaryField = (n: string) => ({ name: n, type: 'text' });
  const tries = [
    { ...salaryField(field('c')), options: { autoEnter: { calculation: true } }, calculation: 'P::Salary' },
    { ...salaryField(field('d')), options: { validation: { calculation: 'P::Salary > 0' } } },
    { ...salaryField(field('e')), options: { validation: { message: 'P::Salary', messageCalculation: true } } },
    { ...salaryField(field('f')), options: { autoEnter: { lookup: { occurrence: 'P', field: ids.salary } } } },
  ];
  for (const spec of tries) {
    const r = await make('Des', spec);
    assert.equal(r.status, 400, `${JSON.stringify(spec)} ${r.text}`);
    assert.doesNotMatch(r.text, new RegExp(`${SALARY}|${BOBS}`));
  }
  assert.equal(ui.schema.tables.find((t) => t.name === 'Mine')!.fields.some((f) => /^F\d+[c-f]$/.test(f.name)), false);
});

test('reading by name or SQL, directly or through a custom function, is refused for an account that cannot read the whole data file', async () => {
  const made = await route('Des', '', { changes: [{ op: 'createCustomFunction', name: 'Peek', parameters: ['what'], formula: 'Evaluate ( what )' }] });
  assert.equal(made.status, 200, made.text);
  for (const calculation of ['Evaluate ( "P::Salary" )', 'GetField ( "P::Salary" )', 'ExecuteSQL ( "SELECT Salary FROM P" ; "" ; "" )', 'Peek ( "P::Salary" )']) {
    const r = await make('Des', { name: field('g'), kind: 'calculation', type: 'text', calculation });
    assert.equal(r.status, 400, `${calculation} ${r.text}`);
  }
});

test('a designer who can read the data file saves the same calculations, and the stored values are the data', async () => {
  const name = field('h');
  const r = await make('Both', { name, kind: 'calculation', type: 'text', calculation: 'P::Salary' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(stored(name), [SALARY, BOBS]);
  const dynamic = field('i');
  assert.equal((await make('Both', { name: dynamic, kind: 'calculation', type: 'text', calculation: 'Evaluate ( "P::Salary" )' })).status, 200);
  assert.deepEqual(stored(dynamic), [SALARY, BOBS]);
});

test('an account that sees some fields of the data file may store those and no others', async () => {
  const ok = field('j');
  const visible = await make('Hid', { name: ok, kind: 'calculation', type: 'text', calculation: 'P::Name' });
  assert.equal(visible.status, 200, visible.text);
  assert.deepEqual(stored(ok), ['Ann', 'Bob']);
  const hidden = await make('Hid', { name: field('k'), kind: 'calculation', type: 'text', calculation: 'P::Salary' });
  const unreal = await make('Hid', { name: field('l'), kind: 'calculation', type: 'text', calculation: 'P::Wage' });
  assert.equal(hidden.status, 400);
  assert.equal(said(hidden.body.error.message, 'Salary'), said(unreal.body.error.message, 'Wage'));
});

test('an account that sees only some rows of the data file cannot store what reads them (a stored value is every account\'s), but can still see a calculation it only shows', async () => {
  const stores = await make('Rows', { name: field('m'), kind: 'calculation', type: 'text', calculation: 'P::Name' });
  assert.equal(stores.status, 400, stores.text);
  assert.doesNotMatch(stores.text, /Ann|Bob/);
  const unstored = field('o');
  const shown = await make('Rows', { name: unstored, kind: 'calculation', type: 'text', calculation: 'P::Name', options: { unstored: true } });
  assert.equal(shown.status, 200, shown.text);
});

test('check: a formula naming a field the account cannot see is answered like one naming no field', async () => {
  const body = (formula: string) => ({ formula, table: 'Mine' });
  for (const account of ['Des', 'Hid']) {
    const real = await route(account, '/check', body('P::Salary'));
    const unreal = await route(account, '/check', body('P::Wage'));
    assert.equal(real.body.ok, false, account);
    assert.equal(said(real.text, 'Salary'), said(unreal.text, 'Wage'), account);
  }
  assert.equal((await route('Both', '/check', body('P::Salary'))).body.ok, true);
  assert.equal((await route('Both', '/check', body('P::Wage'))).body.ok, false);
  assert.equal((await route('Rows', '/check', body('P::Salary'))).body.ok, true, 'a field the account sees is still checked');
});

test('formula preview and evaluate: no value of the data file for an account without access, the rows its rules allow for one with some', async () => {
  const preview = (account: string, formula: string) => route(account, '/preview', { formula, table: 'Mine' });
  for (const account of ['Des', 'Hid']) {
    const real = await preview(account, 'P::Salary');
    const unreal = await preview(account, 'P::Wage');
    assert.doesNotMatch(real.text, new RegExp(`${SALARY}|${BOBS}`), account);
    assert.equal(said(real.text, 'Salary'), said(unreal.text, 'Wage'), account);
    const evaluated = await route(account, '/evaluate', { formula: 'P::Salary', layout: 'Mine' });
    const made = await route(account, '/evaluate', { formula: 'P::Wage', layout: 'Mine' });
    assert.doesNotMatch(evaluated.text, new RegExp(`${SALARY}|${BOBS}`), account);
    assert.equal(said(evaluated.text, 'Salary'), said(made.text, 'Wage'), `${account}: evaluate`);
  }
  const both = await preview('Both', 'P::Salary');
  assert.deepEqual(both.body.results.map((r: any) => r.value), [SALARY, BOBS]);
  const rows = await preview('Rows', 'P::Salary');
  assert.deepEqual(rows.body.results.map((r: any) => r.value), [SALARY, ''], 'only the row its rule allows');
  assert.doesNotMatch(rows.text, new RegExp(BOBS));
});

test('applying through the design route gives the same answers as the preview of the change', async () => {
  const changes = [{ op: 'createField', table: 'Mine', name: field('p'), kind: 'calculation', type: 'text', calculation: 'P::Salary' }];
  const preview = await route('Des', '?preview=1', { changes });
  assert.equal(preview.status, 200, 'a preview only describes the change');
  assert.doesNotMatch(preview.text, new RegExp(`${SALARY}|${BOBS}`));
  assert.equal((await route('Des', '', { changes })).status, 400);
});

test('a relationship on another file\'s fields is refused when the account cannot read the field there, whether the id exists or is a guess', async () => {
  const batch = (account: string, field: number, name: string) => route(account, '', { changes: [
    { op: 'createDataSource', name: `D${name}`, paths: ['file:Data'] },
    { op: 'createOccurrence', name: `Q${name}`, file: `D${name}`, externalTable: ids.people },
    { op: 'createRelationship', left: 'Mine', right: `Q${name}`, predicates: [{ left: 'Key', right: field }] },
  ] });
  for (const account of ['Des', 'Hid']) {
    const real = await batch(account, ids.salary, `${account}1`);
    const guess = await batch(account, 4242, `${account}2`);
    assert.equal(real.status, 400, `${account} ${real.text}`);
    assert.equal(guess.status, 400, `${account} ${guess.text}`);
    assert.equal(said(real.text, `${account}1`), said(guess.text, `${account}2`), account);
  }
  // A field it can see is a fine match field.
  const fine = await batch('Hid', ids.name, 'Hid3');
  assert.equal(fine.status, 200, fine.text);
  assert.equal((await batch('Both', ids.salary, 'Both1')).status, 200);
});

test('applying a staged change goes through the same check', async () => {
  const staged = await route('Des', '/pending', { changes: [{ op: 'createField', table: 'Mine', name: field('r'), kind: 'calculation', type: 'text', calculation: 'P::Salary' }] });
  assert.equal(staged.status, 200, staged.text);
  const applied = await route('Des', '/pending/apply', {});
  assert.equal(applied.status, 400, applied.text);
  assert.doesNotMatch(applied.text, new RegExp(`${SALARY}|${BOBS}`));
  assert.equal(ui.schema.tables.find((t) => t.name === 'Mine')!.fields.some((f) => /^F\d+r$/.test(f.name)), false);
  await route('Des', '/pending/discard', {});
});

async function mcp(account: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Basic ' + btoa(`${account}:pw`) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  const result = body.result ?? { isError: true, content: [{ text: JSON.stringify(body.error) }] };
  return { error: !!result.isError, text: result.content[0].text as string };
}

test('MCP: change_design, check_formula, check_calculation and evaluate_calculation follow the same rules', async () => {
  const change = (calculation: string) => ({ database: 'UI', changes: [{ op: 'createField', table: 'Mine', name: field('q'), kind: 'calculation', type: 'text', calculation }] });
  const real = await mcp('Des', 'change_design', change('P::Salary'));
  const unreal = await mcp('Des', 'change_design', change('P::Wage'));
  assert.equal(real.error, true, real.text);
  assert.equal(said(real.text, 'Salary'), said(unreal.text, 'Wage'));
  assert.equal((await mcp('Both', 'change_design', change('P::Salary'))).error, false);
  // A dry run applies the changes to a copy, as the account, before it runs the script they write there.
  const dry = (account: string) => mcp(account, 'try_design_change', { database: 'UI', changes: [...change('P::Salary').changes, { op: 'createScript', name: 'Probe', text: 'Set Variable [ $x ; Value: 1 ]' }] });
  const tried = await dry('Des');
  assert.match(tried.text, /cannot be found/, tried.text);
  assert.doesNotMatch(tried.text, new RegExp(`${SALARY}|${BOBS}`));
  assert.match((await dry('Both')).text, /"outcome":"ok"/);
  for (const tool of ['check_formula', 'check_calculation']) {
    const args = (formula: string) => ({ database: 'UI', formula, ...(tool === 'check_formula' ? { table: 'Mine' } : { layout: 'Mine', sampleRecords: 3 }) });
    const a = await mcp('Des', tool, args('P::Salary'));
    const b = await mcp('Des', tool, args('P::Wage'));
    assert.doesNotMatch(a.text, new RegExp(`${SALARY}|${BOBS}`), tool);
    assert.equal(said(a.text, 'Salary'), said(b.text, 'Wage'), tool);
    assert.doesNotMatch((await mcp('Des', tool, args('P::Sal'))).text, /Salary/, 'no "did you mean" for a field that cannot be seen');
  }
  const seen = await mcp('Both', 'check_calculation', { database: 'UI', layout: 'Mine', formula: 'P::Salary', sampleRecords: 2 });
  assert.match(seen.text, new RegExp(SALARY));
  const evaluated = await mcp('Des', 'evaluate_calculation', { database: 'UI', layout: 'Mine', formula: 'P::Salary', recordId: 1 });
  assert.doesNotMatch(evaluated.text, new RegExp(SALARY));
});

test('the Data Viewer evaluates as the account: another file\'s hidden field is missing, as a made-up one is', async () => {
  const evaluate = async (account: string, formula: string) => {
    const r = await fetch(`${base}/tabularius/debug/v1/databases/UI/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ui.createApiToken(account)}` },
      body: JSON.stringify({ layout: 'Mine', recordId: 1, formulas: [formula] }),
    });
    return { status: r.status, text: await r.text() };
  };
  for (const account of ['Des', 'Hid']) {
    const real = await evaluate(account, 'P::Salary');
    const unreal = await evaluate(account, 'P::Wage');
    assert.equal(real.status, 200, real.text);
    assert.doesNotMatch(real.text, new RegExp(SALARY), account);
    assert.equal(said(real.text, 'Salary'), said(unreal.text, 'Wage'), account);
  }
  assert.match((await evaluate('Both', 'P::Salary')).text, new RegExp(SALARY));
});

async function app(account: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/UI/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  return { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
}

test('Explain This Value: a calculation reading the data file shows no data, no steps over it and no field of it to an account without access there', async () => {
  const explain = async (account: string) => {
    const r = await fetch(`${base}/tabularius/app/v1/databases/UI/layouts/Mine/explain`, { method: 'POST', headers: await app(account), body: JSON.stringify({ recordId: '1', field: 'Shown' }) });
    return { status: r.status, text: await r.text() };
  };
  for (const account of ['Des', 'Hid']) {
    const r = await explain(account);
    assert.equal(r.status, 200, `${account} ${r.text}`);
    assert.doesNotMatch(r.text, new RegExp(SALARY), account);
    // No account in the file: not even the type of a field there. An account that has one is told the field is hidden, as for a field of its own file.
    if (account === 'Des') assert.doesNotMatch(r.text, /"type":"number"/, `${account}: the type of a field in a file it has no access to`);
    else assert.match(r.text, /"hidden":true/, account);
  }
  const both = await explain('Both');
  assert.match(both.text, new RegExp(SALARY));
});
