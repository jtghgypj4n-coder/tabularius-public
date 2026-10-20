import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { assertAiPolicy } from '../src/ai-policy.ts';
import type { DesignOp } from '../../store/src/index.ts';

async function fixture(t: TestContext, external = false) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-policy-related-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  const source = external ? host.create('Vault') : store;
  source.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Password' }] }]);
  source.create('Items', { Name: 'visible', Password: 'private-value' });
  source.savePrivilegeSet({ ...source.privileges('Admin').set, aiVisible: { Items: true } });
  const setup: DesignOp[] = [
    { op: 'createTable', name: 'Other', fields: [{ name: 'Name' }] },
    ...(external ? [{ op: 'createDataSource' as const, name: 'Vault', paths: ['file:Vault'] }] : []),
    external
      ? { op: 'createOccurrence', name: 'ItemsRel', file: 'Vault', externalTable: source.schema.tables[0].id }
      : { op: 'createOccurrence', name: 'ItemsRel', table: 'Items' },
    { op: 'createRelationship', left: 'Other', right: 'ItemsRel', predicates: [{ left: 'Name', right: 1 }] },
  ];
  const server = createMcpServer(host, { admin: true });
  const client = new Client({ name: 'related-policy-test', version: '1' });
  t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: { database: 'Shop', ...args } });
  return { store, source, setup, call };
}

const copies = {
  calculation: { kind: 'calculation', calculation: 'iTeMsReL::pAsSwOrD', options: { unstored: true } },
  getField: { kind: 'calculation', calculation: 'GetField ( "ItemsRel::Password" )', options: { unstored: true } },
  autoEnter: { calculation: 'ItemsRel::Password', options: { autoEnter: { calculation: true } } },
  lookup: { options: { autoEnter: { lookup: { occurrenceId: 500, fieldId: 2 } } } },
} satisfies Record<string, Partial<Extract<DesignOp, { op: 'createField' }>>>;

// Fix the occurrence id so lookup specs use the same resolved shape as imported definitions.
function relatedSetup(setup: DesignOp[]): DesignOp[] {
  return setup.map((op) => op.op === 'createOccurrence' ? { ...op, id: 500 } : op);
}

for (const external of [false, true]) for (const [kind, spec] of Object.entries(copies)) {
  test(`AI cannot create ${kind} copies through a ${external ? 'foreign' : 'local'} occurrence`, async (t) => {
    const { store, setup, call } = await fixture(t, external);
    // A blanket exception on the destination must not authorize new secret copies either.
    store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true, Other: true } });
    const before = structuredClone(store.schema);
    const result = await call('change_design', { changes: [...relatedSetup(setup),
      { op: 'createField', table: 'Other', name: 'Leak', ...spec },
    ] });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /AI policy.*secret.*human/i);
    assert.deepEqual(store.schema, before, 'refusal must include the table, occurrence and relationship in the same batch');
  });

  test(`existing ${kind} copies through a ${external ? 'foreign' : 'local'} occurrence are secret`, async (t) => {
    const { store, setup, call } = await fixture(t, external);
    store.applyDesign([...relatedSetup(setup), { op: 'createField', table: 'Other', name: 'Leak', ...spec }]);
    store.create('Other', { Name: 'visible' });
    assert.equal(store.get('Other', 1).fieldData.Leak, 'private-value', 'the relationship must actually copy the secret');
    const result = await call('find_records', { layout: 'Other' });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /Other.*Leak/);
    assert.doesNotMatch(JSON.stringify(result), /private-value/);
  });
}

test('taint crosses calculation, lookup and auto-enter chains regardless of table order', async (t) => {
  const { store, setup, call } = await fixture(t);
  store.applyDesign([...relatedSetup(setup),
    { op: 'createField', table: 'Other', name: 'Copied', ...copies.lookup },
    { op: 'createField', table: 'Items', name: 'Returned', calculation: 'Other::Copied', options: { autoEnter: { calculation: true } } },
    { op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation: 'ItemsRel::Returned', options: { unstored: true } },
  ]);
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true, Other: ['Copied'] } });
  const result = await call('find_records', { layout: 'Other' });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /Other.*Leak/);
});

const literal = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const execute = (query: string, args = '') => `ExecuteSQL ( ${literal(query)} ; "" ; ""${args} )`;
const indirect = [
  ['GetField', 'GetField ( "ItemsRel::Password" )'],
  ['GetField repetition', 'GetField ( "ItemsRel::Password[1]" )'],
  ['GetFieldName', 'GetFieldName ( "ItemsRel::Password" )'],
  ['Evaluate', 'Evaluate ( "ItemsRel::Password" )'],
  ['nested Evaluate', `Evaluate ( ${literal('GetField ( "ItemsRel::Password" )')} )`],
  ['GetBaseTableName', 'GetBaseTableName ( "ItemsRel::Password" )'],
  ['SQL', execute('SELECT Password FROM Items')],
  ['quoted SQL', execute('SELECT "Password" FROM "Items"')],
  ['SQL alias', execute('SELECT i."Password" AS label FROM "Items" AS i')],
  ['SQL star', execute('SELECT * FROM Items')],
  ['SQL alias star', execute('SELECT i.* FROM Items i')],
  ['SQL expression', execute('SELECT upper(i.Password) FROM Items i')],
  ['SQL predicate', execute('SELECT Name FROM Items WHERE Password = ?', ' ; "synthetic-secret-77"')],
  ['SQL CTE', execute('WITH x AS (SELECT Password AS p FROM Items) SELECT p FROM x')],
  ['SQL union', execute('SELECT Name FROM Items UNION ALL SELECT Password FROM Items')],
  ['ExecuteSQLe', execute('SELECT Password FROM Items').replace('ExecuteSQL', 'ExecuteSQLe')],
  ['unresolved field', 'GetField ( "ItemsRel::Missing" )'],
  ['unresolved SQL', execute('SELECT Missing FROM Items')],
  ['dynamic field', 'GetField ( Name )'],
  ['dynamic GetFieldName', 'GetFieldName ( $$field )'],
  ['dynamic SQL', 'ExecuteSQL ( Name ; "" ; "" )'],
  ['SQL custom function', execute('SELECT hidden_reader()')],
  ['SQL virtual source', execute('SELECT value FROM json_each(\'[1,2]\')')],
] as const;

for (const [label, calculation] of indirect) {
  test(`literal dependencies: existing ${label} is secret with only a source exception`, async (t) => {
    const { store, setup, call } = await fixture(t);
    store.applyDesign([...relatedSetup(setup), { op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation, options: { unstored: true } }]);
    store.create('Other', { Name: 'visible' });
    const result = await call('find_records', { layout: 'Other' });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /Other.*Leak/, 'classify the destination field, not just an uncertain function');
    assert.doesNotMatch(JSON.stringify(result), /private-value/);
  });

  test(`literal dependencies: AI cannot design ${label} with only a source exception`, async (t) => {
    const { store, setup, call } = await fixture(t);
    const before = structuredClone(store.schema);
    const changes = [...relatedSetup(setup), { op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation, options: { unstored: true } }];
    for (const preview of [true, false]) {
      const result = await call('change_design', { changes, preview });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /AI policy.*secret.*human/i);
      assert.deepEqual(store.schema, before, 'no part of the batch may commit');
    }
  });
}

test('safe literal reads retain behavior, including parameters and a proposed SQL source', async (t) => {
  const { store, setup, call } = await fixture(t);
  const safe = [
    'GetField ( "ItemsRel::Name" )',
    'GetField ( "Name" )',
    'GetFieldName ( "ItemsRel::Name" )',
    execute('SELECT "Name" AS label FROM "Items"'),
    execute('SELECT upper(i.Name) FROM Items i WHERE i.Name = ?', ' ; "visible"'),
    execute('SELECT count(*) FROM Items'),
    execute('SELECT Name FROM Proposed'),
  ];
  const changes = [...relatedSetup(setup), { op: 'createTable', name: 'Proposed', fields: [{ name: 'Name' }] },
    ...safe.map((calculation, i) => ({ op: 'createField', table: 'Other', name: `Label${i}`, kind: 'calculation', calculation, options: { unstored: true } })),
  ];
  const before = structuredClone(store.schema);
  const preview = await call('change_design', { changes, preview: true });
  assert.notEqual(preview.isError, true, JSON.stringify(preview));
  assert.deepEqual(store.schema, before);
  const result = await call('change_design', { changes });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  store.create('Other', { Name: 'visible' });
  store.create('Proposed', { Name: 'proposed-value' });
  const read = await call('find_records', { layout: 'Other' });
  assert.notEqual(read.isError, true, JSON.stringify(read));
  assert.match(JSON.stringify(read), /proposed-value/);
  assert.doesNotMatch(JSON.stringify(read), /private-value/);
});

test('SQL dependencies propagate through derived fields and prospective renames', async (t) => {
  const { store, setup, call } = await fixture(t);
  store.applyDesign([...relatedSetup(setup),
    { op: 'createField', table: 'Items', name: 'Derived', calculation: 'GetField ( "Password" )' },
  ]);
  const before = structuredClone(store.schema);
  const changes = [
    { op: 'renameTable', table: 'Items', name: 'Renamed' },
    { op: 'createField', table: 'Other', name: 'Leak', calculation: execute('SELECT Derived FROM Renamed') },
  ];
  const result = await call('change_design', { changes });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /AI policy.*secret.*human/i);
  assert.deepEqual(store.schema, before);
});

test('SQL occurrence rewrites cannot hide behind a safe base table or CTE', async (t) => {
  const { store, setup, call } = await fixture(t);
  store.applyDesign([...relatedSetup(setup),
    { op: 'createTable', name: 'Public', fields: [{ name: 'Label' }] },
    { op: 'createField', table: 'Items', name: 'Label', calculation: 'GetField ( "Password" )' },
    { op: 'updateOccurrence', occurrence: 'Public', table: 'Items' },
  ]);
  for (const query of ['SELECT Label FROM Public', 'WITH ItemsRel AS (SELECT \'safe\' AS Password) SELECT Password FROM ItemsRel']) {
    const changes = [{ op: 'createField', table: 'Other', name: 'Leak', calculation: execute(query) }];
    const result = await call('change_design', { changes, preview: true });
    assert.equal(result.isError, true, query);
    assert.match(JSON.stringify(result), /AI policy.*secret.*human/i);
  }
});

for (const kind of ['none', 'masked'] as const) test(`related copies of a ${kind} field stay hidden even with a source exception`, async (t) => {
  const { store, setup } = await fixture(t);
  store.applyDesign([...relatedSetup(setup), { op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation: 'ItemsRel::Name', options: { unstored: true } }]);
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false },
    tables: { Items: { view: true, edit: false, create: false, delete: false, fields: { Name: kind } } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'], aiVisible: { Items: true } });
  store.setPassword('Reader', 'test-password'); store.setAccountPrivilegeSet('Reader', 'Reader');
  assert.throws(() => assertAiPolicy(store, 'Reader', 'find_records'), /Other.*Leak/);
});

test('safe related copies and policy-OFF secret copies retain their behavior', async (t) => {
  const { store, setup, call } = await fixture(t);
  const result = await call('change_design', { changes: [...relatedSetup(setup),
    { op: 'createField', table: 'Other', name: 'Label', kind: 'calculation', calculation: 'ItemsRel::Name', options: { unstored: true } },
    { op: 'createField', table: 'Other', name: 'Copy', options: { autoEnter: { lookup: { occurrenceId: 500, fieldId: 1 } } } },
  ] });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  store.create('Other', { Name: 'visible' });
  assert.notEqual((await call('find_records', { layout: 'Other' })).isError, true);
  store.setAiPolicy(false);
  assert.notEqual((await call('change_design', { changes: [{ op: 'createField', table: 'Other', name: 'Leak', ...copies.calculation }] })).isError, true);
});
