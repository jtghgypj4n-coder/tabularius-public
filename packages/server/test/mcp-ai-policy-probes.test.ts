import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import type { DesignOp, Store } from '../../store/src/index.ts';

const SECRET = 'synthetic-secret-77';
async function fx(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-policy-probes-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Password' }] }]);
  store.create('Items', { Name: 'visible', Password: SECRET });
  store.applyDesign([
    { op: 'createTable', name: 'Other', fields: [{ name: 'Name' }] },
    { op: 'createOccurrence', name: 'ItemsRel', table: 'Items', id: 500 } as DesignOp,
    { op: 'createRelationship', left: 'Other', right: 'ItemsRel', predicates: [{ left: 'Name', right: 1 }] } as DesignOp,
  ]);
  store.create('Other', { Name: 'visible' });
  const server = createMcpServer(host, { admin: true });
  const client = new Client({ name: 'p', version: '1' });
  t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: { database: 'Shop', ...args } });
  return { store, call };
}
const grantSource = (store: Store) => store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });

const passwordList: DesignOp = { op: 'createValueList', name: 'PwVL', field: { occurrence: 'Items', field: 'Password' } };
const shadowFunction = (name: string): DesignOp =>
  ({ op: 'createCustomFunction', name, parameters: ['file', 'list'], formula: '"safe"' });
const listCalculation = (name: string) => `${name} ( "Shop" ; "PwVL" )`;
const listField = (name: string): DesignOp =>
  ({ op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation: listCalculation(name), options: { unstored: true } });

for (const name of ['ValueListItems', 'valuelistitems', 'VaLuElIsTiTeMs']) {
  test(`a human calculation uses the built-in despite custom function ${name}`, async (t) => {
    const { store, call } = await fx(t);
    store.applyDesign([shadowFunction(name), passwordList, listField('ValueListItems')]);
    grantSource(store);
    assert.equal(store.evaluate('Other', 'Leak', 1).value, SECRET, 'the engine runs the built-in');
    const result = await call('find_records', { layout: 'Other' });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /AI policy.*Other.*Leak/);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  });

  for (const rename of [false, true]) test(`AI cannot ${rename ? 'rename' : 'create'} ${name} to hide a built-in read`, async (t) => {
    const { store, call } = await fx(t);
    grantSource(store);
    if (rename) store.applyDesign([shadowFunction('Safe')]);
    const before = structuredClone(store.schema);
    const change: DesignOp = rename
      ? { op: 'updateCustomFunction', customFunction: 'Safe', name }
      : shadowFunction(name);
    for (const preview of [true, false]) {
      const result = await call('change_design', { preview, changes: [change, passwordList, listField('vAlUeLiStItEmS')] });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /AI policy.*secret.*human/i);
      assert.deepEqual(store.schema, before, 'the entire batch must remain unapplied');
      assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
    }
    const result = await call('find_records', { layout: 'Other' });
    assert.notEqual(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  });

  test(`evaluate_calculation refuses built-in ${name} before execution without a calculated field`, async (t) => {
    const { store, call } = await fx(t);
    grantSource(store);
    const design = await call('change_design', { changes: [shadowFunction(name), passwordList] });
    assert.notEqual(design.isError, true, JSON.stringify(design));
    assert.equal(store.evaluate('Other', listCalculation(name)).value, SECRET);
    const evaluate = t.mock.method(store, 'evaluate');
    for (const formula of [listCalculation(name), `Left ( ${listCalculation(name)} ; 9 )`]) {
      const result = await call('evaluate_calculation', { layout: 'Other', formula });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /AI policy.*uncertain read set/i);
      assert.doesNotMatch(JSON.stringify(result), /synthetic/);
    }
    assert.equal(evaluate.mock.callCount(), 0, 'output scrubbing is not the policy boundary');
  });
}

// --- custom functions WITH parameters (call node): is the body tainted?
for (const [label, body, use] of [
  ['CF(param) static ref', 'ItemsRel::Password', 'Peek2 ( 1 )'],
  ['CF(param) GetField literal', 'GetField ( "ItemsRel::Password" )', 'Peek2 ( 1 )'],
  ['CF(param) ExecuteSQL literal', 'ExecuteSQL ( "SELECT Password FROM Items" ; "" ; "" )', 'Peek2 ( 1 )'],
  ['CF(param) GetField(param)', 'GetField ( x )', 'Peek2 ( "ItemsRel::Password" )'],
  ['CF nested CF', 'Peek3 ( x )', 'Peek2 ( 1 )'],
] as const) {
  test(`C1 ${label}: human calc on unmarked table is not read by AI`, async (t) => {
    const { store, call } = await fx(t);
    store.applyDesign([{ op: 'createCustomFunction', name: 'Peek3', parameters: ['y'], formula: 'ItemsRel::Password' } as DesignOp]);
    store.applyDesign([{ op: 'createCustomFunction', name: 'Peek2', parameters: ['x'], formula: body } as DesignOp]);
    store.applyDesign([{ op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation: use, options: { unstored: true } } as DesignOp]);
    grantSource(store);
    const r = await call('find_records', { layout: 'Other' });
    assert.equal(r.isError, true);
    assert.match(JSON.stringify(r), /Other.*Leak/);
    assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET), 'secret reached AI output');
  });
  test(`C2 ${label}: AI cannot create the derived calc`, async (t) => {
    const { store, call } = await fx(t);
    store.applyDesign([{ op: 'createCustomFunction', name: 'Peek3', parameters: ['y'], formula: 'ItemsRel::Password' } as DesignOp]);
    store.applyDesign([{ op: 'createCustomFunction', name: 'Peek2', parameters: ['x'], formula: body } as DesignOp]);
    grantSource(store);
    const before = structuredClone(store.schema);
    for (const preview of [true, false]) {
      const r = await call('change_design', { preview, changes: [{ op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation: use, options: { unstored: true } }] });
      assert.equal(r.isError, true);
      assert.match(JSON.stringify(r), /AI policy.*secret.*human/i);
      assert.deepEqual(store.schema, before);
    }
    const q = await call('find_records', { layout: 'Other' });
    assert.doesNotMatch(JSON.stringify(q), new RegExp(SECRET), 'secret reached AI output');
  });
}

// --- SQL edge cases
const SQLS: [string, string][] = [
  ['alias', 'SELECT i.Password FROM Items i'],
  ['AS alias', 'SELECT x.Password AS p FROM Items AS x'],
  ['scalar subquery', 'SELECT (SELECT Password FROM Items) FROM Other'],
  ['JOIN', 'SELECT i.Password FROM Other o JOIN Items i ON o.Name = i.Name'],
  ['comma join', 'SELECT Items.Password FROM Other, Items'],
  ['SELECT *', 'SELECT * FROM Items'],
  ['items.*', 'SELECT Items.* FROM Items'],
  ['comments+case', 'select /* hi */ "PASSWORD" from items -- tail'],
  ['backtick+bracket', 'SELECT `Password`, [Password] FROM [Items]'],
  ['CTE', 'WITH t AS (SELECT Password p FROM Items) SELECT p FROM t'],
  ['WHERE oracle', "SELECT Name FROM Items WHERE Password LIKE 'synth%'"],
  ['ORDER BY', 'SELECT Name FROM Items ORDER BY Password'],
  ['HAVING', "SELECT Name FROM Items GROUP BY Name HAVING max(Password) > 'r'"],
  ['UNION', 'SELECT Name FROM Other UNION SELECT Password FROM Items'],
  ['EXISTS', "SELECT Name FROM Other WHERE EXISTS (SELECT 1 FROM Items WHERE substr(Password,1,1) = 's')"],
  ['IN subquery', 'SELECT Name FROM Other WHERE Name IN (SELECT Password FROM Items)'],
  ['VALUES', 'VALUES ((SELECT Password FROM Items))'],
  ['recursive CTE', 'WITH RECURSIVE r(x) AS (SELECT Password FROM Items UNION ALL SELECT x FROM r WHERE 0) SELECT x FROM r'],
  ['window', 'SELECT first_value(Password) OVER () FROM Items'],
  ['json_group', 'SELECT json_group_array(Password) FROM Items'],
  ['main.schema', 'SELECT Password FROM main.Items'],
  ['leading comment ;', '/* x */ SELECT Password FROM Items;'],
  ['unicode case', 'SELECT PASSWORD FROM ITEMS'],
];
for (const [label, q] of SQLS) {
  test(`S ${label}`, async (t) => {
    const { store, call } = await fx(t);
    const calc = `ExecuteSQL ( "${q.replace(/"/g, '\\"')}" ; "|" ; "" )`;
    store.applyDesign([{ op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation: calc, options: { unstored: true } } as DesignOp]);
    grantSource(store);
    const r = await call('find_records', { layout: 'Other' });
    const s = JSON.stringify(r);
    assert.doesNotMatch(s, new RegExp(SECRET), 'secret reached AI output');
    assert.doesNotMatch(s, /"Leak":"visible"/);
  });
}
// dynamic / variable table names
for (const [label, calc] of [
  ['Let var table', 'Let ( t = "Items" ; ExecuteSQL ( "SELECT Password FROM " & t ; "" ; "" ) )'],
  ['Substitute', 'ExecuteSQL ( Substitute ( "SELECT Password FROM X" ; "X" ; "Items" ) ; "" ; "" )'],
  ['$var', 'Let ( $q = "SELECT Password FROM Items" ; ExecuteSQL ( $q ; "" ; "" ) )'],
  ['param arg', 'ExecuteSQL ( "SELECT ? FROM Other" ; "" ; "" ; ItemsRel::Password )'],
  ['ExecuteSQLe', 'ExecuteSQLe ( "SELECT Password FROM Items" ; "" ; "" )'],
  ['Evaluate(ExecuteSQL)', 'Evaluate ( "ExecuteSQL ( \\"SELECT Password FROM Items\\" ; \\"\\" ; \\"\\" )" )'],
  ['GetField Let', 'Let ( n = "ItemsRel::Password" ; GetField ( n ) )'],
  ['GetField rep', 'GetField ( "ItemsRel::Password[1]" )'],
  ['GetField no TO', 'GetField ( "Password" )'],
  ['TO name in SQL', 'ExecuteSQL ( "SELECT Password FROM ItemsRel" ; "" ; "" )'],
] as const) {
  test(`D ${label}`, async (t) => {
    const { store, call } = await fx(t);
    store.applyDesign([{ op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation: calc, options: { unstored: true } } as DesignOp]);
    grantSource(store);
    const r = await call('find_records', { layout: 'Other' });
    assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET));
  });
}

// --- restore / undo vs aiVisible
test('U1 AI restoreDeleted deleted:0 with aiVisible patch', async (t) => {
  const { store, call } = await fx(t);
  const ps = store.privileges('Admin').set;
  const patch = { leaves: [{ path: ['privileges', { id: ps.id }, 'aiVisible'], before: { Items: true, Other: true }, after: ps.aiVisible }], removed: [] };
  for (const ch of [{ op: 'restoreDeleted', deleted: 0, patch }, { op: 'restoreDeleted', deleted: 0, patch, recordedRestore: true }]) {
    const r = await call('change_design', { changes: [ch], recordedRestore: true });
    assert.equal(r.isError, true);
  }
  assert.equal(JSON.stringify(store.privileges('Admin').set.aiVisible), JSON.stringify(ps.aiVisible));
});
test('U2 AI restoreDeleted real id + swapped patch is ignored', async (t) => {
  const { store, call } = await fx(t);
  store.applyDesign([{ op: 'createField', table: 'Other', name: 'Note' }]);
  store.applyDesign([{ op: 'deleteField', table: 'Other', field: 'Note' }]);
  const id = store.deletedDesigns()[0].id;
  const ps = store.privileges('Admin').set;
  const items = store.schema.tables.find((x) => x.name === 'Items');
  const pw = items!.fields.find((f) => f.name === 'Password');
  const evil = { leaves: [{ path: ['privileges', { id: ps.id }, 'aiVisible'], before: { Items: true, Other: true }, after: ps.aiVisible }],
    removed: [{ path: ['tables', { id: store.schema.tables.find((x) => x.name === 'Other')!.id }, 'fields'], value: { ...pw, name: 'Note', id: pw!.id } }] };
  await call('change_design', { changes: [{ op: 'restoreDeleted', deleted: id, patch: evil }] });
  assert.equal(JSON.stringify(store.privileges('Admin').set.aiVisible ?? null), JSON.stringify(ps.aiVisible ?? null));
});
test('U3 AI optimization_fix apply/undo cannot re-grant revoked aiVisible', async (t) => {
  const { store, call } = await fx(t);
  store.applyDesign([{ op: 'createOccurrence', name: 'Unused TO', table: 'Items' } as DesignOp]);
  grantSource(store);
  const a = await call('optimization_fix', { fix: 'remove-table-occurrences', items: ['Unused TO'], confirm: true });
  assert.notEqual(a.isError, true, JSON.stringify(a));
  assert.ok(!store.schema.tableOccurrences.some((o) => o.name === 'Unused TO'));
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: {} }); // human revokes
  await call('optimization_fix', { undo: true });
  assert.deepEqual(store.privileges('Admin').set.aiVisible ?? {}, {});
});

for (const editing of [false, true]) test(`MCP analysis cap refuses the entire ${editing ? 'edit' : 'create'} batch`, async (t) => {
  const { store, call } = await fx(t);
  grantSource(store);
  if (editing) store.applyDesign([{ op: 'createCustomFunction', name: 'Large', parameters: ['x'], formula: 'x' }]);
  const before = structuredClone(store.schema);
  const formula = `"${'a'.repeat(70_000)}"`;
  const change: DesignOp = editing
    ? { op: 'updateCustomFunction', customFunction: 'Large', formula }
    : { op: 'createCustomFunction', name: 'Large', parameters: ['x'], formula };
  for (const preview of [true, false]) {
    const result = await call('change_design', { preview, changes: [
      { op: 'createField', table: 'Other', name: 'Note' }, change,
      { op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation: 'Large ( 1 )', options: { unstored: true } },
    ] });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /AI policy.*secret.*human/i);
    assert.deepEqual(store.schema, before, 'no prefix of an over-limit batch may commit');
  }
});

test('C3 AI creates both the CF and the calc (source-only exception)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-policy-function-batch-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Password' }] }, { op: 'createTable', name: 'Other', fields: [{ name: 'Name' }] }]);
  store.create('Items', { Name: 'visible', Password: SECRET }); store.create('Other', { Name: 'x' });
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  const server = createMcpServer(host, { admin: true }); const client = new Client({ name: 'p', version: '1' });
  t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: { database: 'Shop', ...args } });
  const before = structuredClone(store.schema);
  const d = await call('change_design', { changes: [
    { op: 'createCustomFunction', name: 'Copy', parameters: ['x'], formula: 'ExecuteSQL ( "SELECT Password FROM Items" ; "" ; "" )' },
    { op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation: 'Copy ( 1 )', options: { unstored: true } }] });
  assert.equal(d.isError, true);
  assert.match(JSON.stringify(d), /AI policy.*secret.*human/i);
  assert.deepEqual(store.schema, before, 'the function and calculation must both be refused');
  const r = await call('find_records', { layout: 'Other' });
  assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET));
});
