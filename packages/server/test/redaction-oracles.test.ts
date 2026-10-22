import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { Assistant } from '../src/assistant.ts';
import { classOf, PiiMasker } from '../src/pii.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

// Generated stores only. In-memory MCP and a stubbed model boundary: no child processes or network.
async function fixture(t: TestContext, value = 'synthetic-amber', account?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-oracles-'));
  const host = new Host(dir, () => {}, { background: false });
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const store = host.create('Sample');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Password' }, { name: 'PrivateNumber', type: 'number' }, { name: 'Name' }] },
    { op: 'createCustomFunction', name: 'Encode', parameters: ['x'], formula: 'Length ( x )' },
    { op: 'createField', table: 'Items', name: 'Encoded', type: 'number', kind: 'calculation', calculation: 'Encode ( Password )' },
    { op: 'createField', table: 'Items', name: 'Total', type: 'number', kind: 'summary', summary: { type: 'total', field: 'PrivateNumber' } },
    { op: 'createValueList', name: 'Choices', field: { occurrence: 'Items', field: 'Password' } },
    { op: 'createScript', name: 'Probe', text: 'Exit Script [ Text Result: Password ]' },
  ]);
  store.create('Items', { Password: value, PrivateNumber: value.length, Name: 'public' });
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false },
    tables: { Items: { view: true, edit: false, create: false, delete: false, fields: { PrivateNumber: 'none' } } }, layouts: 'viewOnly', scripts: 'modifiable',
    valueLists: 'viewOnly', extendedPrivileges: ['fmmcp'] });
  store.setPassword('Reader', 'synthetic-password', 'Reader');
  store.setPiiIsolation(true);
  const server = createMcpServer(host, account ? { account, database: 'Sample' } : { admin: true });
  const client = new Client({ name: 'oracle-test', version: '1' });
  t.after(async () => { await client.close(); await server.close(); });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: { database: 'Sample', ...args } });
  return { store, host, client, call };
}

test('summary dependency remains protected after a human exempts only its source', async (t) => {
  const { store, call } = await fixture(t, undefined, 'Reader');
  store.savePrivilegeSet({ ...store.privileges('Reader').set, aiVisible: { Items: ['Password', 'PrivateNumber', 'Encoded'] } });
  const result = await call('get_record', { layout: 'Items', recordId: 1 });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /AI policy.*Total/);
});

test('AI cannot create an aggregate copy under a blanket visibility exception', async (t) => {
  const { store, call } = await fixture(t);
  store.setPiiIsolation(false); // Exercise the design guard rather than the isolation tool denylist.
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  const before = structuredClone(store.schema);
  const result = await call('change_design', { changes: [
    { op: 'createField', table: 'Items', name: 'Prefix' },
    { op: 'createField', table: 'Items', name: 'AggregateCopy', kind: 'summary', type: 'text', summary: { type: 'list', field: 'Password' } },
  ] });
  assert.equal(result.isError, true);
  assert.deepEqual(store.schema, before, 'no partial design batch');
});

test('isolation treats every derived type conservatively, including dynamic reads and numeric lookups', async (t) => {
  const { store, call } = await fixture(t);
  store.setAiPolicy(false); // Isolation must work independently on existing/converted files.
  const formulas = [
    'Encode ( Password )', 'Evaluate ( "Length ( Password )" )',
    'Length ( GetField ( "Pass" & "word" ) )', 'Length ( GetNthRecord ( Password ; 1 ) )',
    'Length ( Lookup ( Password ) )', 'Length ( JSONSetElement ( "{}" ; "x" ; Password ; 1 ) )',
    'Length ( ExecuteSQL ( "SELECT Password FROM Items" ; "" ; "" ) )',
  ];
  store.applyDesign(formulas.map((calculation, i) => ({ op: 'createField' as const, table: 'Items', name: `Derived${i}`,
    kind: 'calculation' as const, type: 'number' as const, calculation, options: { unstored: true } })));
  store.applyDesign([
    { op: 'createOccurrence', name: 'Related', table: 'Items', id: 500 },
    { op: 'createRelationship', left: 'Items', right: 'Related', predicates: [{ left: 'Name', right: 'Name' }] },
    { op: 'createField', table: 'Items', name: 'Copied ID', type: 'number', options: { autoEnter: { lookup: {
      occurrenceId: 500, fieldId: store.schema.tables[0].fields[1].id,
    } } } },
    { op: 'createField', table: 'Items', name: 'Code', kind: 'calculation', type: 'text', calculation: 'Upper ( Password )' },
  ]);
  for (const name of ['Encoded', 'Total', 'Copied ID', 'Code', ...formulas.map((_, i) => `Derived${i}`)]) {
    assert.equal(classOf(store, 'Items', name).pii, true, name);
    const probe = await call('find_records', { layout: 'Items', query: [{ [name]: '>0' }] });
    assert.equal(probe.isError, true, `${name} must not become a predicate oracle`);
    assert.match(JSON.stringify(probe), /personal data/);
  }
  const result = await call('get_record', { layout: 'Items', recordId: 1 });
  assert.notEqual(result.isError, true);
  const record = JSON.parse((result.content as { text: string }[])[0].text);
  assert.match(record.fieldData.Encoded, /^<TEXT_\d+>$/);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-amber|SYNTHETIC-AMBER/);
});

test('import matching withholds arbitrary headers, including a mistaken data row', async (t) => {
  const { host, store } = await fixture(t);
  store.setAiPolicy(false);
  const assistant = new Assistant(host, undefined as never, { apiKey: 'synthetic', model: 'synthetic' });
  const sent: unknown[] = [];
  t.mock.method(assistant as unknown as { call: (...args: unknown[]) => Promise<unknown> }, 'call', async (...args: unknown[]) => {
    sent.push(args[2]);
    return { content: [{ type: 'text', text: '{"columns":[],"keys":[]}' }] };
  });
  await assistant.mapImport(store, 'Admin', { layout: 'Items', table: 'Items', fields: [{ name: 'PIN', type: 'number' }], columns: [
    { column: 0, header: 'synthetic-amber', sample: ['synthetic-amber'] },
    { column: 1, header: 'another-unseen-person', sample: ['7'] },
    { column: 2, header: 'PIN', sample: ['7319'] },
  ] });
  assert.equal(sent.length, 1);
  assert.doesNotMatch(JSON.stringify(sent), /synthetic-amber|another-unseen-person|7319/);
  assert.match(JSON.stringify(sent), /PIN/, 'an existing target field name remains schema, not spreadsheet data');
});

test('cached stand-ins are account scoped, including attempts to reuse a tool result', async (t) => {
  const { store } = await fixture(t);
  const a = new PiiMasker(store, 'first');
  const b = new PiiMasker(store, 'second');
  const first = a.token('synthetic-amber', 'TEXT');
  assert.equal(b.unmask(first), first);
  assert.throws(() => b.criteria('Items', [{ Name: `==${first}` }]), /stand-in/);
  const second = b.token('synthetic-amber', 'TEXT');
  assert.notEqual(first, second);
  assert.equal(a.unmask(second), second);
  assert.equal(new PiiMasker(store, 'first').unmask(first), 'synthetic-amber');
});

test('numeric credentials cannot be probed through finds with only isolation enabled', async (t) => {
  const { store, call } = await fixture(t);
  store.setAiPolicy(false);
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'PIN', type: 'number' }]);
  store.update('Items', 1, { PIN: 7319 });
  for (const criterion of ['7319', '7*', '>7000', '7000...8000']) {
    const r = await call('find_records', { layout: 'Items', query: [{ PIN: criterion }] });
    assert.equal(r.isError, true);
    assert.match(JSON.stringify(r), /personal data/);
  }
});

test('derived classification follows schema and human mark edits without waiting for the sample cache', async (t) => {
  const { store } = await fixture(t);
  assert.equal(classOf(store, 'Items', 'PrivateNumber').pii, false);
  store.applyDesign([{ op: 'updateField', table: 'Items', field: 'PrivateNumber', calculation: 'Length ( Password )', options: { autoEnter: { calculation: true } } }]);
  assert.equal(classOf(store, 'Items', 'PrivateNumber').pii, true);
  store.markPiiField('Items', 'PrivateNumber', false);
  assert.equal(classOf(store, 'Items', 'PrivateNumber').pii, false, 'a human override is explicit declassification');
  store.markPiiField('Items', 'PrivateNumber', null);
  assert.equal(classOf(store, 'Items', 'PrivateNumber').pii, true);
});

test('paired protected worlds have identical indirect tool, resource and prompt outputs', async (t) => {
  const left = await fixture(t, 'synthetic-amber');
  const right = await fixture(t, 'synthetic-violet-longer');
  // A relationship whose membership actually depends on the protected source.
  for (const { store } of [left, right]) {
    store.applyDesign([
      { op: 'createTable', name: 'Related', fields: [{ name: 'Match' }, { name: 'Label' }] },
      { op: 'createRelationship', left: 'Items', right: 'Related', predicates: [{ left: 'Password', right: 'Match' }] },
      { op: 'createField', table: 'Items', name: 'File', type: 'container' },
    ]);
    store.create('Related', { Match: 'synthetic-amber', Label: 'public' });
    const occurrence = store.schema.tableOccurrences.find((o) => o.name === 'Related')!;
    const field = store.schema.tables.find((x) => x.name === 'Related')!.fields.find((f) => f.name === 'Label')!;
    const anchors = { left: true, top: true, right: false, bottom: false };
    const bounds = { top: 100, left: 20, bottom: 200, right: 300 };
    const portal: LayoutObject = { id: 900, kind: 'portal', type: 9, anchors, bounds, style: {},
      portal: { tableOccurrenceId: occurrence.id, tableOccurrence: 'Related', rows: 4, initialRow: 1 },
      children: [{ id: 901, kind: 'field', type: 1, anchors, bounds, style: {}, field: {
        tableOccurrenceId: occurrence.id, tableOccurrence: 'Related', fieldId: field.id, field: 'Label', display: 'edit', repetitions: 1,
      } }],
    };
    store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: [...store.design('Items')!.objects, portal] } }]);
    const raw = String(store.get('Items', 1).fieldData.Password);
    store.setContainer('Items', 1, 'File', 1, { filename: 'generated.txt', mime: 'text/plain', data: new TextEncoder().encode(raw) });
  }
  const channels: [string, Record<string, unknown>][] = [
    ['get_record', { layout: 'Items', recordId: 1 }],
    ['get_record', { layout: 'Items', recordId: 1, fields: ['Encoded', 'Total', 'Related::Label'] }],
    ['explain_related', { layout: 'Items', recordId: 1, portal: 'Related' }],
    ['find_records', { layout: 'Items', query: [{ Password: 's*' }] }],
    ['find_records', { layout: 'Items', query: [{ PrivateNumber: '>15' }] }],
    ['find_records', { layout: 'Items', query: [{ PrivateNumber: '1...20' }] }],
    ['find_records', { layout: 'Items', sort: [{ fieldName: 'Password', sortOrder: 'ascend' }] }],
    ['find_records', { layout: 'Items', query: [{ 'Related::Label': 'public' }] }],
    ['sql_query', { sql: 'SELECT count(*) FROM Items WHERE length(Password) > 15' }],
    ['summarize_records', { layout: 'Items', measures: [{ fn: 'max', field: 'PrivateNumber' }] }],
    ['run_script', { layout: 'Items', script: 'Probe', trace: true }],
    ['debug_script', { layout: 'Items', script: 'Probe', watch: ['Password', 'Get ( LastError )'] }],
    ['audit_log', {}],
    ['explain_record_history', { layout: 'Items', recordId: 1 }],
    ['list_automations', {}],
    ['get_container', { container: 1 }],
    ['describe_layout', { layout: 'Items', sample: true }],
    ['describe_database', { detail: ['Items', 'Encode'] }],
    ['get_script', { script: 'Probe' }],
    ['plan_import', { layout: 'Items', data: 'Name\npublic' }],
    ['change_design', { changes: [{ op: 'updateField', table: 'Items', field: 'Password', name: 'Alias' }] }],
    ...['Encode ( Password )', 'Evaluate ( "Password" )', 'GetField ( "Password" )',
      'GetNthRecord ( Password ; 1 )', 'Lookup ( Password )', 'JSONSetElement ( "{}" ; "x" ; Password ; 1 )',
      'ExecuteSQL ( "SELECT Password FROM Items" ; "" ; "" )', 'ValueListItems ( "Sample" ; "Choices" )',
      'Get ( FoundCount )', 'Get ( LastError )'].map((formula): [string, Record<string, unknown>] =>
      ['evaluate_calculation', { layout: 'Items', recordId: 1, formula }]),
  ];
  const tools = (await left.client.listTools()).tools.map((x) => x.name);
  for (const [name, args] of channels) {
    assert.ok(tools.includes(name), `the channel must exist: ${name}`);
    const a = await left.call(name, args);
    const b = await right.call(name, args);
    assert.equal(a.isError, true, `${name} must refuse before execution`);
    assert.match(JSON.stringify(a), /AI policy refused/, `${name} must reach the policy, not fail input validation`);
    assert.deepEqual(a, b, `${name} distinguished protected values`);
    assert.doesNotMatch(JSON.stringify(a), /synthetic-amber|synthetic-violet-longer/);
  }
  for (const path of ['schema', 'overview', 'layouts/Items', 'scripts/Probe', 'audit', 'automations']) {
    const read = async (client: Client) => {
      try { await client.readResource({ uri: `tabularius://Sample/${path}` }); }
      catch (e) { return String(e); }
      assert.fail(`resource ${path} must refuse`);
    };
    const a = await read(left.client);
    assert.match(a, /AI policy refused/);
    assert.equal(a, await read(right.client));
  }
  assert.deepEqual(await left.client.listResources(), await right.client.listResources());
  assert.deepEqual(await left.client.getPrompt({ name: 'draft_calculation', arguments: { database: 'Sample', layout: 'Items', goal: 'count records' } }),
    await right.client.getPrompt({ name: 'draft_calculation', arguments: { database: 'Sample', layout: 'Items', goal: 'count records' } }));
  // No backup-content/list or raw activity tool exists in this MCP catalog. File names are metadata.
  assert.ok(!tools.some((name) => /backup|activity/.test(name)));
  assert.deepEqual(await left.call('list_databases'), await right.call('list_databases'));
});

test('with only isolation on, probes on values derived from a protected field answer the same in paired worlds', async (t) => {
  const left = await fixture(t, 'synthetic-amber');
  const right = await fixture(t, 'synthetic-violet-longer');
  for (const { store } of [left, right]) store.setAiPolicy(false);
  const probes: [string, Record<string, unknown>][] = [
    ['find_records', { layout: 'Items', query: [{ Encoded: '>15' }] }],
    ['find_records', { layout: 'Items', query: [{ Encoded: '1...20' }] }],
    ['find_records', { layout: 'Items', query: [{ Encoded: '==16' }] }],
    ['find_records', { layout: 'Items', query: [{ Total: '>15' }] }],
    ['summarize_records', { layout: 'Items', measures: [{ fn: 'max', field: 'Encoded' }] }],
    ['evaluate_calculation', { layout: 'Items', recordId: 1, formula: 'Length ( Password ) > 15' }],
    ['evaluate_calculation', { layout: 'Items', recordId: 1, formula: 'Encoded > 15' }],
    ['sql_query', { sql: 'SELECT count(*) FROM Items WHERE length(Password) > 15' }],
  ];
  for (const [name, args] of probes) {
    const a = await left.call(name, args), b = await right.call(name, args);
    assert.deepEqual(a, b, `${name} ${JSON.stringify(args)} distinguished protected values`);
    assert.doesNotMatch(JSON.stringify(a), /synthetic-amber|synthetic-violet-longer/);
  }
  // The values do differ between the worlds: a probe that reached them would show it.
  assert.notEqual(left.store.get('Items', 1).fieldData.Encoded, right.store.get('Items', 1).fieldData.Encoded);
});

test('a generated unique key stays usable: lookups by key work under isolation', async (t) => {
  const { store, call } = await fixture(t);
  store.setAiPolicy(false);
  store.applyDesign([
    { op: 'createField', table: 'Items', name: 'PrimaryKey', options: { autoEnter: { calculation: true } }, calculation: 'Get ( UUID )' },
    { op: 'createField', table: 'Items', name: 'kf_LinkID' },
  ]);
  const id = store.create('Items', { Name: 'second' }).recordId;
  const key = String(store.get('Items', id).fieldData.PrimaryKey);
  assert.match(key, /^[0-9A-F-]{36}$/i, 'the key is generated');
  store.update('Items', id, { kf_LinkID: key });
  assert.equal(classOf(store, 'Items', 'PrimaryKey').pii, false);
  assert.equal(classOf(store, 'Items', 'kf_LinkID').pii, false, 'a child field holding the key is judged by its values, which are codes');
  const found = await call('find_records', { layout: 'Items', query: [{ kf_LinkID: `==${key}` }] });
  assert.notEqual(found.isError, true, JSON.stringify(found));
  assert.match(JSON.stringify(found), new RegExp(key));
  // Any other calculation stays personal, and a formula that merely mentions UUID inside a larger expression is not exempt.
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Mixed', options: { autoEnter: { calculation: true } }, calculation: 'Get ( UUID ) & Password' }]);
  assert.equal(classOf(store, 'Items', 'Mixed').pii, true);
});
