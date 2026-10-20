import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { aiRefusal } from '../src/ai-access.ts';
import { checkPlan } from '../src/agent.ts';
import { semanticFind } from '../src/semantic-find.ts';
import { assertAiDesignChanges } from '../src/ai-policy.ts';
import { assertNoAiVisibility } from '../src/ai-security.ts';

async function fixture(t: import('node:test').TestContext, secret = true, account?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-policy-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, ...(secret ? [{ name: 'Password' }] : [])] },
    { op: 'createScript', name: 'Dynamic', text: 'Exit Script [ Text Result: Evaluate ( "1" ) ]' }]);
  store.create('Items', { Name: 'visible', ...(secret ? { Password: 'private-value' } : {}) });
  host.scriptAi = { refusal: () => undefined, generate: async () => '', embed: async () => [[1]] };
  const server = createMcpServer(host, account ? { account, database: 'Shop' } : { admin: true });
  const client = new Client({ name: 'policy-test', version: '1' });
  t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: { database: 'Shop', ...args } });
  return { store, client, call, host };
}

const reads: [string, Record<string, unknown>][] = [
  ['get_record', { layout: 'Items', recordId: 1 }],
  ['find_records', { layout: 'Items' }],
  ['describe_layout', { layout: 'Items' }],
  ['search_records', { text: 'visible' }],
  ['summarize_records', { layout: 'Items', groupBy: ['Name'] }],
  ['sql_query', { sql: 'SELECT Name FROM Items' }],
  ['evaluate_calculation', { layout: 'Items', recordId: 1, formula: 'Upper ( Name )' }],
  ['run_script', { layout: 'Items', script: 'Dynamic' }],
  ['save_dashboard', { name: 'Preview', preview: true, widgets: [{ title: 'Items', kind: 'table', layout: 'Items' }] }],
  ['get_container', { container: 1 }],
  ['explain_record_history', { table: 'Items', recordId: 1 }],
];
for (const [name, args] of reads) test(`AI policy refuses ${name} before reading a secret-bearing table`, async (t) => {
  const { call } = await fixture(t);
  const result = await call(name, args);
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /AI policy.*refused/i);
  assert.match(JSON.stringify(result), /mark.*AI-visible.*privilege set.*Full Access/i);
  assert.doesNotMatch(JSON.stringify(result), /private-value/);
});

for (const [label, name, args] of [
  ['virtual SQL', 'sql_query', { sql: 'SELECT value FROM json_each(\'[1,2]\')' }],
  ['Evaluate', 'evaluate_calculation', { layout: 'Items', formula: 'Evaluate ( "1" )' }],
  ['dynamic field', 'evaluate_calculation', { layout: 'Items', formula: 'GetField ( "Na" & "me" )' }],
  ['dynamic SQL', 'evaluate_calculation', { layout: 'Items', formula: 'ExecuteSQL ( Name ; "" ; "" )' }],
  ['unknown function', 'evaluate_calculation', { layout: 'Items', formula: 'UnknownPlugin ( 1 )' }],
  ['dynamic script', 'run_script', { layout: 'Items', script: 'Dynamic' }],
  ['failure replay', 'explain_script_failure', { layout: 'Items', script: 'Dynamic' }],
] as const) test(`AI policy refuses uncertain read set: ${label}`, async (t) => {
  const { call } = await fixture(t, false);
  const result = await call(name, args);
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /AI policy.*refused/i);
  assert.match(JSON.stringify(result), /turn the AI policy off for this file/i);
});

test('shared assistant and connector gate refuses secret sources', async (t) => {
  const { store } = await fixture(t);
  assert.match(aiRefusal(store, { account: 'Admin', via: 'AI assistant' }) ?? '', /AI policy.*refused/i);
});
test('AI agent plans refuse secret sources', async (t) => {
  const { store } = await fixture(t);
  assert.throws(() => checkPlan(store, { layout: 'Items', steps: [{ kind: 'find' }] }, store.privileges('Admin')), /AI policy.*refused/i);
});
test('semantic find refuses before sending an embedding request', async (t) => {
  const { store } = await fixture(t);
  let calls = 0;
  await assert.rejects(() => semanticFind(store, { refusal: () => undefined, embed: async () => { calls++; return [[1]]; } },
    { layout: 'Items', field: 'Name', text: 'find', limit: 1, account: 'Admin' }), /AI policy.*refused/i);
  assert.equal(calls, 0);
});

test('quoted SQL user functions cannot bypass static inspection', async (t) => {
  const { store, call } = await fixture(t, false);
  let calls = 0;
  store.defineQueryFunction('hidden_reader', () => { calls++; return 'leak'; });
  const result = await call('sql_query', { sql: 'SELECT "hidden_reader"()' });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /AI policy.*refused/i);
  assert.equal(calls, 0);
});

test('MCP resources refuse secret sources, including mixed-case database names', async (t) => {
  const { client } = await fixture(t);
  await assert.rejects(() => client.readResource({ uri: 'tabularius://sHoP/layouts/Items' }), /AI policy.*refused/i);
});

test('unknown script steps refuse before side effects', async (t) => {
  const { store, call } = await fixture(t, false);
  store.schema.scripts[0].steps = [{ stepId: 99999, name: 'Unknown step', enabled: true }];
  const result = await call('run_script', { layout: 'Items', script: 'Dynamic' });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /uncertain read set/i);
});

test('a global variable has an uncertain cross-run read set', async (t) => {
  const { call } = await fixture(t, false);
  const result = await call('evaluate_calculation', { layout: 'Items', formula: '$$previousResult' });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /AI policy.*refused/i);
});

test('absent policy preserves every record/tool entry in the legacy regression matrix', async (t) => {
  const { store, call, client } = await fixture(t);
  store.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  const before = [];
  for (const [name, args] of reads) before.push(await call(name, args));
  const resource = await client.readResource({ uri: 'tabularius://Shop/layouts/Items' });
  assert.equal(aiRefusal(store, { account: 'Admin', via: 'AI assistant' }), undefined);
  assert.doesNotThrow(() => checkPlan(store, { layout: 'Items', steps: [{ kind: 'find' }] }, store.privileges('Admin')));
  // Explicit OFF must be identical to absence, not just return a successful status.
  store.sql.prepare("INSERT INTO _fm_meta VALUES ('aiPolicy', 'false')").run();
  for (const [i, [name, args]] of reads.entries()) assert.deepEqual(await call(name, args), before[i], name);
  assert.deepEqual(await client.readResource({ uri: 'tabularius://Shop/layouts/Items' }), resource);
  for (const [name, args] of [
    ['sql_query', { sql: 'SELECT value FROM json_each(\'[1,2]\')' }],
    ['evaluate_calculation', { layout: 'Items', formula: 'Evaluate ( "1" )' }],
    ['run_script', { layout: 'Items', script: 'Dynamic' }],
  ] as const) assert.notEqual((await call(name, args)).isError, true, name);
});

test('explicit field and table exceptions permit reads without changing legacy redaction', async (t) => {
  const { store, call } = await fixture(t);
  const full = store.privileges('Admin').set;
  for (const visible of [['Password'], true] as const) {
    store.savePrivilegeSet({ ...full, aiVisible: { Items: visible } });
    const result = await call('get_record', { layout: 'Items', recordId: 1 });
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result), /visible/);
    assert.doesNotMatch(JSON.stringify(result), /private-value/);
  }
  store.savePrivilegeSet(full);
  assert.equal((await call('get_record', { layout: 'Items', recordId: 1 })).isError, true);
});

for (const account of [undefined, 'Admin']) for (const visible of [undefined, ['Password'], true]) {
  test(`secret rename then read stays protected for ${account ?? 'local admin'} with visibility ${JSON.stringify(visible)}`, async (t) => {
    const { store, call } = await fixture(t, true, account);
    if (visible !== undefined) store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: visible } });
    const before = structuredClone(store.schema.tables);
    const table = store.schema.tables[0];
    const password = table.fields.find((f) => f.name === 'Password')!;
    const result = await call('change_design', { changes: [
      { op: 'updateField', table: table.id, field: password.id, name: 'Hint' },
    ] });
    const read = await call('get_record', { layout: 'Items', recordId: 1 });
    assert.doesNotMatch(JSON.stringify(read), /private-value/, 'renaming must not remove output redaction');
    assert.equal(result.isError, true, 'even AI-visible secrets cannot be renamed by AI');
    assert.match(JSON.stringify(result), /AI policy.*refused/i);
    assert.deepEqual(store.schema.tables, before);
    if (visible !== undefined) assert.notEqual(read.isError, true, 'the original visible field remains readable and redacted');
  });
}

test('secret rename checks every intermediate schema and refuses the whole batch', async (t) => {
  const { store, call } = await fixture(t);
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  const before = structuredClone(store.schema.tables);
  const result = await call('change_design', { changes: [
    { op: 'updateField', table: 'Items', field: 'Name', name: 'Label' },
    { op: 'renameTable', table: 'Items', name: 'Renamed' },
    { op: 'updateField', table: 'Renamed', field: 'Password', name: 'Hint' },
    { op: 'updateField', table: 'Renamed', field: 'Hint', name: 'Password' },
  ] });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /AI policy.*secret.*human/i);
  assert.deepEqual(store.schema.tables, before, 'no earlier operation may commit');
  assert.deepEqual(store.privileges('Admin').set.aiVisible, { Items: true });
});

test('shared design guard refuses renaming hidden secrets and secret-derived fields', async (t) => {
  const { store } = await fixture(t);
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Encoded', kind: 'calculation', calculation: 'Base64Encode ( Password )' }]);
  for (const field of ['Password', 'Encoded']) {
    assert.throws(() => assertAiDesignChanges(store, [{ op: 'updateField', table: 'Items', field, name: 'Hint' }]), /AI policy.*secret.*human/i);
  }
});

test('safe field and table renames preserve visibility and secret redaction', async (t) => {
  const { store, call } = await fixture(t);
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: ['Password', 'Name'] } });
  const result = await call('change_design', { changes: [
    { op: 'updateField', table: 'Items', field: 'Name', name: 'Label' },
    { op: 'renameTable', table: 'Items', name: 'Renamed' },
  ] });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.deepEqual(store.privileges('Admin').set.aiVisible, { Renamed: ['Password', 'Label'] });
  const read = await call('get_record', { layout: 'Items', recordId: 1 });
  assert.notEqual(read.isError, true, JSON.stringify(read));
  assert.match(JSON.stringify(read), /visible/);
  assert.doesNotMatch(JSON.stringify(read), /private-value/);
});

for (const name of ['Pass Word', 'Ｐａｓｓｗｏｒｄ', 'Pass\u200bword', 'Passw0rd', 'Şifre', 'Heslo', 'Jelszó', 'Κωδικός πρόσβασης', 'סיסמה', 'كلمة المرور',
  'раsswοrd', 'pass|word', 'pass+word', 'pa$$word', 'p@ssword', 'Pásswörd',
  'ᴘᴀssᴡᴏʀᴅ', 'раѕѕword', 'ρassword', 'passworԁ', 'аpі kеy', 'ꓑassword', 'ѕесrеt', '🅿assword']) {
  test(`normalized secret name enforces policy and exception redaction: ${name}`, async (t) => {
    const { store, call } = await fixture(t);
    store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Password', name }]);
    const refused = await call('get_record', { layout: 'Items', recordId: 1 });
    assert.equal(refused.isError, true);
    assert.match(JSON.stringify(refused), /AI policy.*refused/i);
    store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: [name] } });
    const visible = await call('get_record', { layout: 'Items', recordId: 1 });
    assert.notEqual(visible.isError, true);
    assert.doesNotMatch(JSON.stringify(visible), /private-value/);
    const renamed = await call('change_design', { changes: [{ op: 'updateField', table: 'Items', field: name, name: 'Hint' }] });
    assert.equal(renamed.isError, true);
    assert.match(JSON.stringify(renamed), /AI policy.*secret.*human/i);
  });
}

for (const on of [true, false]) for (const account of [undefined, 'Admin']) {
  test(`Q1v: restoreDeleted cannot patch AI visibility with policy ${on} as ${account ?? 'local admin'}`, async (t) => {
    const { store, call } = await fixture(t, true, account);
    store.setAiPolicy(on);
    store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: ['Password'] } });
    const before = structuredClone(store.privilegeSets());
    const result = await call('change_design', { changes: [{ op: 'restoreDeleted', deleted: 999999, patch: {
      leaves: [{ path: ['privileges', { id: 1 }, 'aiVisible'], before: { Items: true }, after: { Items: ['Password'] } }], removed: [],
    } }] });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /AI.*(?:visibility|patch)/i);
    assert.deepEqual(store.privilegeSets(), before);
  });
}

test('restoreDeleted cannot replace a secret field with a new id and name', async (t) => {
  const { store, call } = await fixture(t);
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  const before = structuredClone(store.schema);
  const table = store.schema.tables[0];
  const password = table.fields.find((f) => f.name === 'Password')!;
  const result = await call('change_design', { changes: [{ op: 'restoreDeleted', deleted: 999999, patch: {
    leaves: [{ path: ['schema', 'tables', { id: table.id }, 'fields', { id: password.id }],
      after: password, before: { ...password, id: 77, name: 'Hint' } }], removed: [],
  } }] });
  assert.equal(result.isError, true);
  assert.deepEqual(store.schema, before);
  assert.doesNotMatch(JSON.stringify(await call('find_records', { layout: 'Items' })), /private-value/);
});

for (const key of ['aiVisible', 'privileges', 'privilegeSets', 'security']) {
  test(`AI visibility guard inspects nested patch paths naming ${key}`, () => {
    for (const patch of [
      { leaves: [{ path: ['schema', key, 0], before: true, after: false }], removed: [] },
      { leaves: [], removed: [{ path: ['schema', key], value: { id: 77, name: 'Injected' } }] },
    ]) assert.throws(() => assertNoAiVisibility({ nested: [{ patch }] }), /AI visibility.*human/i);
    assert.doesNotThrow(() => assertNoAiVisibility({ name: key, path: ['schema', 'tables', { id: 1 }, 'name'] }));
  });
}

test('AI refuses caller patches even for a recorded deletion, with policy OFF', async (t) => {
  const { store, call } = await fixture(t, false);
  store.setAiPolicy(false);
  store.applyDesign([{ op: 'deleteField', table: 'Items', field: 'Name' }]);
  const deleted = store.deletedDesigns()[0].id;
  const before = structuredClone(store.schema);
  const result = await call('change_design', { changes: [{ op: 'restoreDeleted', deleted, patch: { leaves: [], removed: [] } }] });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /AI.*patch/i);
  assert.deepEqual(store.schema, before);
  assert.notEqual((await call('change_design', { changes: [{ op: 'restoreDeleted', deleted }] })).isError, true);
});

test('safe static SQL and scripts work with the policy on', async (t) => {
  const { store, call } = await fixture(t, false);
  store.applyDesign([{ op: 'updateScript', script: 'Dynamic', text: 'Exit Script [ Text Result: Upper ( Name ) ]' }]);
  for (const [name, args] of [
    ['sql_query', { sql: 'SELECT upper(Name) AS name FROM Items' }],
    ['evaluate_calculation', { layout: 'Items', formula: 'ExecuteSQL ( "SELECT Name FROM Items" ; "" ; "" )' }],
    ['run_script', { layout: 'Items', script: 'Dynamic', recordId: 1 }],
  ] as const) assert.notEqual((await call(name, args)).isError, true, JSON.stringify(await call(name, args)));
});

test('every registered file tool passes through the refusal gate, including design and semantic tools', async (t) => {
  const { client } = await fixture(t);
  const minimal = (schema: any, key = ''): unknown => {
    if (['database', 'from', 'to'].includes(key)) return 'Shop';
    if (key === 'mime') return 'image/png';
    if (schema.default !== undefined) return schema.default;
    if (schema.enum) return schema.enum[0];
    if (schema.const !== undefined) return schema.const;
    if (schema.anyOf || schema.oneOf) return minimal((schema.anyOf ?? schema.oneOf)[0], key);
    if (schema.type === 'object') return Object.fromEntries((schema.required ?? []).map((name: string) => [name, minimal(schema.properties[name], name)]));
    if (schema.type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => minimal(schema.items));
    if (schema.type === 'boolean') return false;
    if (schema.type === 'number' || schema.type === 'integer') return schema.minimum ?? 1;
    return 'Items';
  };
  let checked = 0;
  for (const tool of (await client.listTools()).tools) {
    if (['get_security', 'change_security', 'preview_privilege_set'].includes(tool.name)) continue;
    if (!['database', 'from', 'to'].some((key) => tool.inputSchema.properties?.[key])) continue;
    const args = minimal(tool.inputSchema) as Record<string, unknown>;
    for (const key of ['database', 'from', 'to']) if (tool.inputSchema.properties?.[key]) args[key] = 'Shop';
    const result = await client.callTool({ name: tool.name, arguments: args });
    assert.equal(result.isError, true, tool.name);
    assert.match(JSON.stringify(result), /AI policy.*refused/i, tool.name);
    checked++;
  }
  assert.ok(checked > 50, `Only ${checked} file tools were checked`);
});

test('referenced files enforce their own policy and privilege exceptions even when the entry file is OFF', async (t) => {
  const { store, host, call } = await fixture(t, false);
  store.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  const other = host.create('Vault');
  other.applyDesign([{ op: 'createTable', name: 'Credentials', fields: [{ name: 'Password' }] }]);
  store.applyDesign([{ op: 'createDataSource', name: 'Vault', paths: ['file:Vault'] }]);
  const blocked = await call('get_record', { layout: 'Items', recordId: 1 });
  assert.equal(blocked.isError, true);
  assert.match(JSON.stringify(blocked), /Vault.*Password/);
  other.savePrivilegeSet({ ...other.privileges('Admin').set, aiVisible: { Credentials: true } });
  const dynamic = await call('run_script', { layout: 'Items', script: 'Dynamic' });
  assert.equal(dynamic.isError, true);
  assert.match(JSON.stringify(dynamic), /AI policy.*Evaluate/);
  other.setAiPolicy(false);
  assert.notEqual((await call('get_record', { layout: 'Items', recordId: 1 })).isError, true);
});

test('SQL function names containing parentheses are still uncertain without executing them', async (t) => {
  const { store, call } = await fixture(t, false);
  let calls = 0;
  store.defineQueryFunction('reader(hidden', () => { calls++; return 'hidden'; });
  const result = await call('sql_query', { sql: 'SELECT "reader(hidden"()' });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /AI policy.*refused/i);
  assert.equal(calls, 0);
});

test('a calculation whose source was not decoded has an uncertain read set', async (t) => {
  const { store, call } = await fixture(t, false);
  const field = store.schema.tables[0].fields.find((f) => f.name === 'Name')!;
  field.kind = 'calculation'; field.hasCalculation = true; delete field.calculation;
  const result = await call('get_record', { layout: 'Items', recordId: 1 });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /read set cannot be determined statically/i);
});

for (const account of [undefined, 'Admin']) for (const on of [true, false]) for (const tool of ['change_security', 'preview_privilege_set', 'change_design']) {
  test(`F1: ${account ?? 'local admin'} ${tool} cannot grant AI visibility with policy ${on ? 'ON' : 'OFF'}`, async (t) => {
    const { store, call } = await fixture(t, true, account);
    store.setAiPolicy(on);
    const full = store.privileges('Admin').set;
    const proposed = { ...full, aiVisible: { Items: true } };
    const result = await call(tool, tool === 'preview_privilege_set' ? { proposed } : { changes: [{ op: 'savePrivilegeSet', set: proposed }] });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /AI.visibility.*(?:human|not.*AI tools)/i);
    assert.deepEqual(store.privileges('Admin').set, full);
  });
}

test('design security tools read human exceptions but refuse to add or resubmit them', async (t) => {
  const { store, call } = await fixture(t);
  assert.notEqual((await call('get_security')).isError, true);
  const full = store.privileges('Admin').set;
  const changed = await call('change_security', { changes: [{ op: 'savePrivilegeSet', set: { ...full, aiVisible: { Items: ['Password'] } } }] });
  assert.equal(changed.isError, true);
  assert.match(JSON.stringify(changed), /AI visibility.*human.*Manage Security/i);
  assert.equal(store.privileges('Admin').set.aiVisible, undefined);
  assert.equal((await call('get_record', { layout: 'Items', recordId: 1 })).isError, true, 'the AI could not mark the secret field visible to itself');
  // A person's edit grants the exception; AI tools may read it but cannot resubmit even unchanged marks.
  store.savePrivilegeSet({ ...full, aiVisible: { Items: ['Password'] } });
  const security = await call('get_security');
  assert.notEqual(security.isError, true);
  assert.match(JSON.stringify(security), /aiVisible/);
  assert.notEqual((await call('get_record', { layout: 'Items', recordId: 1 })).isError, true);
  const again = await call('change_security', { changes: [{ op: 'savePrivilegeSet', set: store.privileges('Admin').set }] });
  assert.equal(again.isError, true);
  assert.match(JSON.stringify(again), /AI visibility.*human.*Manage Security/i);
  assert.deepEqual(store.privileges('Admin').set.aiVisible, { Items: ['Password'] });
});

test('F1: MCP cannot clear existing visibility by omitting it from a replacement', async (t) => {
  const { store, call } = await fixture(t);
  const full = store.privileges('Admin').set;
  store.savePrivilegeSet({ ...full, aiVisible: { Items: true } });
  for (const tool of ['change_security', 'preview_privilege_set']) {
    const result = await call(tool, tool === 'change_security' ? { changes: [{ op: 'savePrivilegeSet', set: full }] } : { proposed: full });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /AI.visibility/i);
    assert.deepEqual(store.privileges('Admin').set.aiVisible, { Items: true });
  }
});

test('F1: security tool descriptions do not teach AI visibility grant syntax', async (t) => {
  const { client } = await fixture(t);
  for (const tool of (await client.listTools()).tools.filter((t) => ['change_security', 'preview_privilege_set'].includes(t.name))) {
    assert.doesNotMatch(tool.description ?? '', /aiVisible/);
  }
});

for (const op of ['createField', 'updateField']) for (const formula of ['Base64Encode ( Password )', 'Base64Encode ( Items::Password )']) {
  test(`F1: ${op} refuses encoded secret copies: ${formula}`, async (t) => {
    const { store, call } = await fixture(t);
    store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
    const before = structuredClone(store.schema.tables);
    const result = await call('change_design', { changes: [{ op, table: 'Items', ...(op === 'createField' ? { name: 'Encoded' } : { field: 'Name' }), kind: 'calculation', calculation: formula }] });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /AI policy.*(?:secret|taint)/i);
    assert.deepEqual(store.schema.tables, before, 'refuse before recomputation or any design write');
    assert.doesNotMatch(JSON.stringify(await call('get_record', { layout: 'Items', recordId: 1 })), /cHJpdmF0ZS12YWx1ZQ==/);
  });
}

test('F1: existing same-table calculation chains inherit secret classification', async (t) => {
  const { store, call } = await fixture(t);
  store.applyDesign([
    { op: 'createField', table: 'Items', name: 'Encoded', kind: 'calculation', calculation: 'Base64Encode ( Password )' },
    { op: 'createField', table: 'Items', name: 'Copy', kind: 'calculation', calculation: 'Lower ( Items::Encoded )' },
  ]);
  const full = store.privileges('Admin').set;
  store.savePrivilegeSet({ ...full, aiVisible: { Items: ['Password', 'Encoded'] } });
  const result = await call('get_record', { layout: 'Items', recordId: 1 });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /Items.*Copy/);
});

test('F3: ON requests protect OFF references transitively; direct OFF requests keep legacy behavior', async (t) => {
  const { host, store, call } = await fixture(t, false);
  const middle = host.create('Middle'); middle.setAiPolicy(false);
  const vault = host.create('Vault'); vault.setAiPolicy(false);
  vault.applyDesign([{ op: 'createTable', name: 'Credentials', fields: [{ name: 'Password' }] }]);
  vault.create('Credentials', { Password: 'vault-secret' });
  store.applyDesign([{ op: 'createDataSource', name: 'Middle', paths: ['file:Middle'] }]);
  middle.applyDesign([{ op: 'createDataSource', name: 'Vault', paths: ['file:Vault'] }]);
  const blocked = await call('get_record', { layout: 'Items', recordId: 1 });
  assert.equal(blocked.isError, true);
  assert.match(JSON.stringify(blocked), /Vault.*Credentials.*Password/);
  assert.notEqual((await call('get_record', { database: 'Vault', layout: 'Credentials', recordId: 1 })).isError, true);
  assert.equal(vault.aiPolicy, false);
  assert.equal(middle.aiPolicy, false);
  vault.savePrivilegeSet({ ...vault.privileges('Admin').set, aiVisible: { Credentials: true } });
  assert.notEqual((await call('get_record', { layout: 'Items', recordId: 1 })).isError, true);
  vault.applyDesign([{ op: 'createDataSource', name: 'Missing', paths: ['file:Missing'] }]);
  const unknown = await call('get_record', { layout: 'Items', recordId: 1 });
  assert.equal(unknown.isError, true);
  assert.match(JSON.stringify(unknown), /external source.*Missing/);
});

test('an account cannot inherit the administrator exception or use an AI mark to grant field access', async (t) => {
  const { store, host } = await fixture(t);
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  const reader = { name: 'Reader', records: { view: true, edit: false, create: false, delete: false, fields: { Password: 'none' as const } }, layouts: 'viewOnly' as const, valueLists: 'viewOnly' as const, scripts: 'none' as const, extendedPrivileges: ['fmmcp'] };
  store.savePrivilegeSet(reader); store.setPassword('Reader', 'test-password'); store.setAccountPrivilegeSet('Reader', 'Reader');
  const server = createMcpServer(host, { account: 'Reader', database: 'Shop' });
  const client = new Client({ name: 'reader', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const read = () => client.callTool({ name: 'get_record', arguments: { database: 'Shop', layout: 'Items', recordId: 1 } });
  const refused = await read(); assert.equal(refused.isError, true); assert.match(JSON.stringify(refused), /privilege set.*Reader/);
  store.savePrivilegeSet({ ...reader, aiVisible: { Items: ['Password'] } });
  const allowed = await read(); assert.notEqual(allowed.isError, true); assert.doesNotMatch(JSON.stringify(allowed), /private-value/);
});

test('F1: AI cannot acquire a pre-marked privilege set by rebinding an account', async (t) => {
  const { store, call } = await fixture(t);
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  const result = await call('change_security', { changes: [{ op: 'setAccount', name: 'Other', privilegeSet: '[Full Access]' }] });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /AI.visibility/i);
  assert.equal(store.canonicalAccount('Other'), undefined);
});

test('F1: safe calculations and legacy OFF calculation writes still work', async (t) => {
  const { store, call } = await fixture(t);
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: ['Password'] } });
  const safe = await call('change_design', { changes: [{ op: 'createField', table: 'Items', name: 'Label', kind: 'calculation', calculation: 'Upper ( Name ) & "Password"' }] });
  assert.notEqual(safe.isError, true, JSON.stringify(safe));
  assert.notEqual((await call('get_record', { layout: 'Items', recordId: 1 })).isError, true);
  store.setAiPolicy(false);
  const legacy = await call('change_design', { changes: [{ op: 'createField', table: 'Items', name: 'Encoded', kind: 'calculation', calculation: 'Base64Encode ( Password )' }] });
  assert.notEqual(legacy.isError, true, JSON.stringify(legacy));
});
