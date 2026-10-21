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
let other: Store;
const ids = { people: 0, name: 0, salary: 0 };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-xfile-calc-'));
  for (const name of ['UI', 'Data', 'Other']) createStore(join(dir, `${name}.openhbam.sqlite`));
  const served = await serve({ dir, port: 0, hostname: '127.0.0.1', sqlPort: 0, watch: false, log: () => {} });
  server = served.server;
  base = served.url;
  [ui, data, other] = ['UI', 'Data', 'Other'].map((n) => served.host.get(n)!);
  for (const store of [ui, data, other]) {
    store.setAiPolicy(false);
    store.savePrivilegeSet({ ...store.privilegeSet('[Full Access]')!, extendedPrivileges: keys });
  }
  data.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Salary', type: 'number' }] }]);
  const people = data.schema.tables.find((t) => t.name === 'People')!;
  ids.people = people.id;
  ids.name = people.fields.find((f) => f.name === 'Name')!.id;
  ids.salary = people.fields.find((f) => f.name === 'Salary')!.id;
  // A third file with a table of the same shape and ids, where the designer may read everything.
  other.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Salary', type: 'number' }] }]);
  assert.equal(other.schema.tables[0].id, ids.people);
  other.create('People', { Name: 'Ann', Salary: 1 });
  other.setPassword('Des', 'pw', '[Full Access]');
  other.setPassword('Both', 'pw', '[Full Access]');
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
  ui.applyDesign([
    { op: 'createDataSource', name: 'Elsewhere', paths: ['file:Other'] },
    { op: 'createOccurrence', name: 'E', file: 'Elsewhere', externalTable: ids.people },
    { op: 'createRelationship', left: 'Mine', right: 'E', predicates: [{ left: 'Key', right: ids.name }] },
  ], { readOtherFile: () => true });
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

// --- a decision is made on the parsed formula, and on every formula a change reaches ---------------------------------

/** Writes to a Mine record and back, as a user or an import does: stored values are then worked out with full data. */
function touch(): void {
  for (const [id, key] of [[1, 'Ann'], [2, 'Bob']] as const) {
    ui.update('Mine', id, { Key: 'x' });
    ui.update('Mine', id, { Key: key });
  }
}
const mineHas = (name: string) => ui.schema.tables.find((t) => t.name === 'Mine')!.fields.some((f) => f.name === name);
const noSalary = (text: string) => assert.doesNotMatch(text, new RegExp(`${SALARY}|${BOBS}`));

test('reading by name or SQL cannot hide behind a comment, spacing, case, a built name or the other SQL spellings', async () => {
  const formulas = [
    'GetField/**/( "P::Salary" ) & Key',
    'Evaluate /* c */ ( "P::Salary" ) & Key',
    'ExecuteSQL /**/( "SELECT Salary FROM P" ; "" ; "" ) & Key',
    'ExecuteSQLe ( "SELECT Salary FROM P" ; "" ; "" )',
    'ExecuteSQLe /* c */ ( "SELECT Salary FROM P" ; "" ; "" )',
    'BE_FileMakerSQL /**/( "SELECT Salary FROM P" )',
    'getfield // a line comment\n ( "P::Salary" )',
    'GetField\t\n( "P::" & "Salary" )',
    'Let ( n = "P::Sal" & "ary" ; GetField ( n ) )',
    'Case ( 0 ; "" ; Evaluate ( "P::" & "Salary" ) )',
  ];
  for (const calculation of formulas) {
    const name = field('s');
    const r = await make('Des', { name, kind: 'calculation', type: 'text', calculation });
    assert.equal(r.status, 400, `${calculation} ${r.text}`);
    assert.equal(mineHas(name), false, calculation);
  }
  // The same through an update of a field that exists.
  const own = field('t');
  assert.equal((await make('Des', { name: own, kind: 'calculation', type: 'text', calculation: 'Key & "!"' })).status, 200);
  for (const calculation of ['GetField/**/( "P::Salary" ) & Key', 'ExecuteSQLe /**/( "SELECT Salary FROM P" ; "" ; "" )']) {
    const r = await route('Des', '', { changes: [{ op: 'updateField', table: 'Mine', field: own, calculation }] });
    assert.equal(r.status, 400, `${calculation} ${r.text}`);
  }
  assert.equal(ui.schema.tables.find((t) => t.name === 'Mine')!.fields.find((f) => f.name === own)!.calculation, 'Key & "!"');
  touch();
  assert.deepEqual(stored(own), ['Ann!', 'Bob!']);
  // The account that may read the whole file saves them, and they work.
  const both = field('u');
  assert.equal((await make('Both', { name: both, kind: 'calculation', type: 'text', calculation: 'GetField/**/( "P::Salary" )' })).status, 200);
  assert.deepEqual(stored(both), [SALARY, BOBS]);
});

test('a name in a comment or a string is not a read of the data file', async () => {
  for (const calculation of ['/* P::Salary */ Key', '"P::Salary" & Key', 'Key // P::Salary']) {
    const name = field('v');
    const r = await make('Des', { name, kind: 'calculation', type: 'text', calculation });
    assert.equal(r.status, 200, `${calculation} ${r.text}`);
    assert.deepEqual(stored(name).map((x) => String(x).replace(/P::Salary/, '·')), calculation.startsWith('"') ? ['·Ann', '·Bob'] : ['Ann', 'Bob'], calculation);
  }
});

test('a custom function that is changed after a stored calculation calls it is checked against every calculation that calls it', async () => {
  const fn = (n: string) => `${n}${++named}`;
  const calm = fn('Calm');
  const inner = fn('Inner');
  const outer = fn('Outer');
  assert.equal((await route('Des', '', { changes: [
    { op: 'createCustomFunction', name: calm, parameters: [], formula: '"x"' },
    { op: 'createCustomFunction', name: inner, parameters: [], formula: '"y"' },
    { op: 'createCustomFunction', name: outer, parameters: [], formula: `${inner} ( ) & "z"` },
  ] })).status, 200);
  const direct = field('w');
  const nested = field('x');
  const bare = field('y');
  for (const [name, calculation] of [[direct, `${calm} ( ) & Key`], [nested, `${outer} ( ) & Key`], [bare, `${calm} & Key`]]) {
    const r = await make('Des', { name, kind: 'calculation', type: 'text', calculation });
    assert.equal(r.status, 200, `${calculation} ${r.text}`);
  }
  const update = (name: string, formula: string) => route('Des', '', { changes: [{ op: 'updateCustomFunction', customFunction: name, formula }] });
  for (const [name, formula] of [[calm, 'P::Salary'], [inner, 'P::Salary'], [calm, 'GetField/**/( "P::Salary" )'], [inner, 'Evaluate ( "P::Salary" )']]) {
    const r = await update(name, formula);
    assert.equal(r.status, 400, `${name} ${formula} ${r.text}`);
    noSalary(r.text);
  }
  assert.equal(ui.schema.customFunctions.find((c) => c.name === calm)!.formula, '"x"');
  touch();
  assert.deepEqual(stored(direct), ['xAnn', 'xBob']);
  assert.deepEqual(stored(nested), ['yzAnn', 'yzBob']);
  // A change that reads nothing outside is fine, and so is one by an account that may read the data file.
  assert.equal((await update(calm, '"q" & Key')).status, 200);
  assert.equal((await route('Both', '', { changes: [{ op: 'updateCustomFunction', customFunction: inner, formula: 'P::Salary' }] })).status, 200);
  touch();
  assert.deepEqual(stored(nested), [`${SALARY}zAnn`, `${BOBS}zBob`]);
});

test('renaming or deleting a custom function is checked the same way: a calculation can come to call another body', async () => {
  const safe = `Safe${++named}`;
  const leaky = `Leaky${++named}`;
  const old = `Old${++named}`;
  assert.equal((await route('Des', '', { changes: [
    { op: 'createCustomFunction', name: safe, parameters: [], formula: '"s"' },
    { op: 'createCustomFunction', name: leaky, parameters: [], formula: 'P::Salary' },
  ] })).status, 200);
  const name = field('z');
  assert.equal((await make('Des', { name, kind: 'calculation', type: 'text', calculation: `${safe} ( ) & Key` })).status, 200);
  const swap = await route('Des', '', { changes: [
    { op: 'updateCustomFunction', customFunction: safe, name: old },
    { op: 'updateCustomFunction', customFunction: leaky, name: safe },
  ] });
  assert.equal(swap.status, 400, swap.text);
  assert.equal(ui.schema.customFunctions.some((c) => c.name === leaky), true, 'nothing was renamed');
  touch();
  assert.deepEqual(stored(name), ['sAnn', 'sBob']);
  // Deleting the leaky one, or the safe one, reads nothing new.
  assert.equal((await route('Des', '', { changes: [{ op: 'deleteCustomFunction', customFunction: leaky }] })).status, 200);
});

test('pointing a data source at another file is checked against every formula that reads through it, and every relationship on it', async () => {
  // Lone is a data source of the third file, where the designer may read all of it; E3 is its table, with no
  // relationship, so nothing but the stored calculation reads through it.
  assert.equal((await route('Des', '', { changes: [
    { op: 'createDataSource', name: 'Lone', paths: ['file:Other'] },
    { op: 'createOccurrence', name: 'E3', file: 'Lone', externalTable: ids.people },
  ] })).status, 200);
  const name = field('A');
  assert.equal((await make('Des', { name, kind: 'calculation', type: 'text', calculation: 'E3::Salary & Key' })).status, 200);
  const move = (account: string, source: string, file: string) => route(account, '', { changes: [{ op: 'updateDataSource', dataSource: source, paths: [`file:${file}`] }] });
  for (const source of ['Lone']) {
    const r = await move('Des', source, 'Data');
    assert.equal(r.status, 400, `${source} ${r.text}`);
    noSalary(r.text);
    assert.deepEqual(ui.schema.dataSources.find((d) => d.name === source)!.paths, ['file:Other']);
  }
  // E, which a relationship of Mine matches through, cannot be pointed at it either.
  assert.equal((await move('Des', 'Elsewhere', 'Data')).status, 400);
  touch();
  assert.deepEqual(stored(name), ['Ann', 'Bob']);
  // The account that may read the data file can do it.
  assert.equal((await move('Both', 'Lone', 'Data')).status, 200);
  assert.equal((await move('Both', 'Lone', 'Other')).status, 200);
});

test('a stored calculation that reads an unstored calculation reads what that one reads', async () => {
  // Shown is an unstored calculation of the owner's that reads the salary: a stored value reads it with full data.
  const via = field('I');
  const r = await make('Des', { name: via, kind: 'calculation', type: 'text', calculation: 'Shown & Key' });
  assert.equal(r.status, 400, r.text);
  noSalary(r.text);
  assert.equal(mineHas(via), false);
  // An account that has the field hidden in the data file reads it through the calculation no more than directly.
  const hidden = await make('Hid', { name: field('M'), kind: 'calculation', type: 'text', calculation: 'Shown & Key' });
  assert.equal(hidden.status, 400, hidden.text);
  assert.equal((await make('Both', { name: field('J'), kind: 'calculation', type: 'text', calculation: 'Shown & Key' })).status, 200);
  // And one made to read the salary after a stored calculation reads it.
  const plain = field('K');
  const unstored = field('L');
  assert.equal((await make('Des', { name: unstored, kind: 'calculation', type: 'text', calculation: 'Key & "?"', options: { unstored: true } })).status, 200);
  assert.equal((await make('Des', { name: plain, kind: 'calculation', type: 'text', calculation: `${unstored} & Key` })).status, 200);
  const change = await route('Des', '', { changes: [{ op: 'updateField', table: 'Mine', field: unstored, calculation: 'P::Salary' }] });
  assert.equal(change.status, 400, change.text);
  touch();
  assert.deepEqual(stored(plain), ['Ann?Ann', 'Bob?Bob']);
});

test('a calculation whose context is an occurrence of the data file reads it through its plain names', async () => {
  const name = field('B');
  const r = await make('Des', { name, kind: 'calculation', type: 'text', calculation: 'Salary', calculationContext: 'P' });
  assert.equal(r.status, 400, r.text);
  assert.equal(mineHas(name), false);
  const unreal = await make('Des', { name: field('C'), kind: 'calculation', type: 'text', calculation: 'Wage', calculationContext: 'P' });
  assert.equal(said(r.text, 'Salary'), said(unreal.text, 'Wage'));
  assert.equal((await make('Both', { name: field('D'), kind: 'calculation', type: 'text', calculation: 'Salary', calculationContext: 'P' })).status, 200);
});

test('turning a field into a stored calculation is checked: the kind of the field decides whether its formula is kept', async () => {
  // An unstored calculation reading the data file is fine; made stored, it is not.
  const unstoredRead = field('G');
  assert.equal((await make('Des', { name: unstoredRead, kind: 'calculation', type: 'text', calculation: 'P::Name', options: { unstored: true } })).status, 200);
  const stores = await route('Des', '', { changes: [{ op: 'updateField', table: 'Mine', field: unstoredRead, options: { unstored: false } }] });
  assert.equal(stores.status, 400, stores.text);
  assert.equal(ui.schema.tables.find((t) => t.name === 'Mine')!.fields.find((f) => f.name === unstoredRead)!.options?.unstored, true);
});

test('a value list made by the owner from the data file is not a way round: ValueListItems in a stored calculation is read by name', async () => {
  ui.applyDesign([{ op: 'createValueList', name: 'Names', field: { occurrence: 'P', field: ids.name } }] as never, { readOtherFile: () => true });
  const r = await make('Des', { name: field('N'), kind: 'calculation', type: 'text', calculation: 'ValueListItems ( "" ; "Names" )' });
  assert.equal(r.status, 400, r.text);
  const both = field('O');
  assert.equal((await make('Both', { name: both, kind: 'calculation', type: 'text', calculation: 'ValueListItems ( "" ; "Names" )' })).status, 200);
});
