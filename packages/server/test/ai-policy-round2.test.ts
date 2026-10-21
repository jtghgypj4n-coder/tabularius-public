import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer, sessionFor } from '../src/mcp.ts';
import { Assistant, withRetries } from '../src/assistant.ts';
import { HIDDEN_VALUE, recordForModel, secretName } from '../src/ai-output.ts';
import { PiiMasker } from '../src/pii.ts';
import { checkPlan, dryRunPlan } from '../src/agent.ts';
import { sqlFieldRefs } from '../src/ai-policy-sql.ts';
import { narrowPrivileges } from '../src/token-scope.ts';
import { Store, parseScriptText, emptySchema } from '../../store/src/index.ts';
import { CredentialRedactor, REDACTED, hasUrlAuth } from '../../scripts/src/redaction.ts';
import { scriptText, scriptStepName, type LayoutObject } from '../../fmp12/src/index.ts';
import { offlineScriptOptions } from '../../scripts/src/offline.ts';
import { DATA_NOT_INSTRUCTIONS } from '../src/ai-security.ts';

// All data is generated here. No child processes, external services or corpus inputs.
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-round2-'));
  const host = new Host(dir, () => {}, { background: false });
  host.scriptAi = { refusal: () => undefined, generate: async () => '', embed: async () => { throw new Error('unexpected embedding dispatch'); } };
  const store = host.create('Generated');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Password' }] }]);
  store.create('Items', { Name: 'ordinary', Password: 'generated-private-83' });
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  return { host, store };
}
async function connect(t: TestContext, host: Host, account?: string, password?: string) {
  const server = createMcpServer(host, account ? (password === undefined ? { account, database: 'Generated' } : { account, password }) : { admin: true });
  const client = new Client({ name: 'round2', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  t.after(async () => { await client.close(); await server.close(); });
  return { client, call: (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: { database: 'Generated', ...args } }) };
}

for (const selected of [false, true]) test(`R2 portal secrets cover parent and sibling copies before projection: ${selected}`, () => {
  const secret = 'generated-portal-秘密-83';
  const input = { fieldData: { Name: secret, Status: 'ordinary' }, portalData: {
    Related: [{ recordId: '1', 'Related::Password': secret }, { recordId: '2', 'Related::Name': `copy ${secret}` }],
    Other: [{ recordId: '3', 'Other::Name': secret }],
  } };
  const before = structuredClone(input);
  const out = recordForModel(input, selected ? ['Name', 'Status', 'Related::Name', 'Other::Name'] : undefined);
  assert.equal(out.fieldData.Name, HIDDEN_VALUE);
  assert.equal(out.fieldData.Status, 'ordinary');
  assert.doesNotMatch(JSON.stringify(out), /generated-portal/);
  assert.deepEqual(input, before, 'human record stays unchanged');
  assert.equal(recordForModel({ fieldData: { Name: secret } }).fieldData.Name, secret, 'no cross-record masking state');
});

for (const phase of ['provider', 'tool'] as const) test(`R2 assistant revocation at ${phase} await stops before further use`, async (t) => {
  const { host, store } = fixture(t);
  const full = store.privileges('Admin').set;
  store.savePrivilegeSet({ ...full, aiVisible: { Items: true } });
  const assistant = new Assistant(host, undefined as never, { apiKey: 'generated' });
  let calls = 0;
  const revoke = () => store.savePrivilegeSet({ ...full, aiVisible: {} });
  const original = store.find.bind(store);
  const find = t.mock.method(store, 'find', (...args: Parameters<typeof store.find>) => {
    const result = original(...args);
    if (phase === 'tool') revoke();
    return result;
  });
  t.mock.method(assistant as unknown as { call: (...args: any[]) => Promise<unknown> }, 'call', async () => {
    if (++calls === 1) {
      if (phase === 'provider') revoke();
      return { content: [{ type: 'tool_use', id: 'generated', name: 'show_records', input: { layout: 'Items', query: [], summary: 'generated' } }], stop_reason: 'tool_use' };
    }
    return { content: [{ type: 'text', text: 'unexpected dispatch' }], stop_reason: 'end_turn' };
  });
  const result = await assistant.chat(store, 'Admin', [{ role: 'user', content: 'Show items' }], { layout: 'Items' }, store.privileges('Admin'));
  assert.equal(calls, 1, 'no provider request after the human revokes visibility');
  assert.match(result.reply, /stopped/i);
  if (phase === 'provider') assert.equal(find.mock.callCount(), 0, 'no internal count tool after revocation');
});

test('R2 policy refuses count, sort, malformed SQL and resource routes before data reads', async (t) => {
  const { host, store } = fixture(t);
  const { client, call } = await connect(t, host);
  const find = t.mock.method(store, 'find');
  for (const [name, args] of [
    ['find_records', { layout: 'Items', limit: 0, query: [{ Password: 'g*' }] }],
    ['find_records', { layout: 'Items', fields: ['Name'], sort: [{ fieldName: 'Password', sortOrder: 'descend' }], offset: 2 }],
    ['sql_query', { sql: 'SELECT count(*) FROM Items WHERE Password > char(0)' }],
    ['sql_query', { sql: 'SELECT Password FROM missing WHERE (' }],
    ['semantic_find', { layout: 'Items', field: 'Name', text: 'ordinary' }],
    ['check_solution', {}],
  ] as const) {
    const result = await call(name, args);
    assert.equal(result.isError, true, name);
    assert.match(JSON.stringify(result), /AI policy.*refused/i);
    assert.doesNotMatch(JSON.stringify(result), /generated-private/);
  }
  assert.equal(find.mock.callCount(), 0);
  for (const path of ['schema', 'overview', 'layouts/Items', 'audit']) {
    await assert.rejects(client.readResource({ uri: `tabularius://Generated/${path}` }), /AI policy.*refused/i);
  }
});

test('R2 warmed concurrent account connections honor their own grants and later revocation', async (t) => {
  const { host, store } = fixture(t);
  store.savePrivilegeSet({ name: 'Allowed', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmmcp'], aiVisible: { Items: ['Password'] } });
  store.savePrivilegeSet({ ...store.privilegeSet('Allowed')!, id: undefined, name: 'Refused', aiVisible: {} });
  store.setPassword('one', 'generated', 'Allowed');
  store.setPassword('two', 'generated', 'Refused');
  const a = await connect(t, host, 'one'), b = await connect(t, host, 'two');
  for (let i = 0; i < 3; i++) {
    const [yes, no] = await Promise.all([a.call('find_records', { layout: 'Items', limit: 0 }), b.call('find_records', { layout: 'Items', limit: 0 })]);
    assert.notEqual(yes.isError, true);
    assert.equal(no.isError, true);
    assert.doesNotMatch(JSON.stringify(no), /foundCount|generated-private/);
  }
  store.savePrivilegeSet({ ...store.privilegeSet('Allowed')!, aiVisible: {} });
  assert.equal((await a.call('find_records', { layout: 'Items', limit: 0 })).isError, true);
});

test('R2 account and file vault caches do not resolve another principal’s stand-ins', (t) => {
  const { host, store } = fixture(t);
  const other = host.create('Other');
  const a = new PiiMasker(store, 'one'), b = new PiiMasker(store, 'two'), c = new PiiMasker(other, 'one');
  const token = a.token('generated-person-a', 'PERSON');
  assert.equal(b.unmask(token), token);
  assert.equal(c.unmask(token), token);
  const own = b.token('generated-person-b', 'PERSON');
  assert.equal(new PiiMasker(store, 'two').unmask(own), 'generated-person-b');
  assert.equal(a.unmask(own), own);
});

test('R2 quoted SQL predicates, sorting and windows retain secret dependencies', (t) => {
  const { store } = fixture(t);
  const table = store.schema.tables[0], field = table.fields.find((f) => f.name === 'Password')!;
  for (const sql of [
    'WITH "order by" AS (SELECT Name, Password FROM Items) SELECT count(*) FROM "order by" WHERE Password != \'\'',
    'SELECT Name FROM Items ORDER BY CASE WHEN Password = \'x\' THEN 0 ELSE 1 END LIMIT 0',
    'SELECT first_value(Name) OVER (ORDER BY Password) FROM Items',
    'SELECT Name FROM Items WHERE Password IN (SELECT Password FROM Items EXCEPT SELECT \'x\')',
  ]) {
    const refs = sqlFieldRefs(store.schema, sql);
    // LIMIT 0 can be optimized away; the policy's whole-file secret check still refuses it.
    assert.ok(refs === undefined || refs.some((r) => r.table === table.id && r.field === field.id) || sql.endsWith('LIMIT 0'), sql);
  }
  assert.equal(sqlFieldRefs(store.schema, 'SELECT 1; SELECT Password FROM Items'), undefined);
});

test('R2 Unicode secret classification survives combining marks, invisibles and repetitions', () => {
  for (const name of ['Related::Ｐａｓｓｗｏｒｄ(2)', 'p\u200da\u0301ssword', 'ＡＰＩ🔒ＫＥＹ', 'Related::contrase\u006e\u0303a']) assert.equal(secretName(name), true, name);
  for (const name of ['Épinard', 'Secretary', 'Okapi Key']) assert.equal(secretName(name), false, name);
});

test('R2 canceled agent preview stops at the backup boundary without changing live data', async (t) => {
  const { store } = fixture(t);
  store.setAiPolicy(false);
  const plan = checkPlan(store, { layout: 'Items', steps: [{ kind: 'set', field: 'Name', value: 'changed' }] }, store.privileges('Admin'));
  const stop = new AbortController();
  const backup = store.backup.bind(store);
  t.mock.method(store, 'backup', async (...args: Parameters<typeof store.backup>) => { await backup(...args); stop.abort(); });
  await assert.rejects(dryRunPlan(store, plan, { account: 'Admin', signal: stop.signal }), { name: 'AbortError' });
  assert.equal(store.get('Items', 1).fieldData.Name, 'ordinary');
});

test('R2 cancellation during retry body cleanup never starts another request', async () => {
  const stop = new AbortController();
  let calls = 0;
  await assert.rejects(withRetries(async () => {
    calls++;
    return new Response(new ReadableStream({ cancel() { stop.abort(); } }), { status: 429 });
  }, stop.signal, async () => {}), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('R2 assistant refresh retains a token ceiling on the first and subsequent calls', async (t) => {
  const { host, store } = fixture(t);
  store.setAiPolicy(false);
  store.applyDesign([{ op: 'createTable', name: 'Other', fields: [{ name: 'Name' }] }]);
  store.create('Other', { Name: 'generated-unreachable-29' });
  const assistant = new Assistant(host, undefined as never, { apiKey: 'generated' });
  let calls = 0, output = '';
  t.mock.method(assistant as unknown as { call: (...args: any[]) => Promise<unknown> }, 'call', async (_system: unknown, _tools: unknown, messages: unknown[]) => {
    assert.ok(String(_system).includes(DATA_NOT_INSTRUCTIONS));
    if (++calls === 1) return { content: [{ type: 'tool_use', id: 'scope', name: 'show_records', input: { layout: 'Other', query: [], summary: 'generated' } }], stop_reason: 'tool_use' };
    output = JSON.stringify(messages.at(-1));
    return { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' };
  });
  const scope = { readOnly: true, layouts: ['Items'] };
  const result = await assistant.chat(store, 'Admin', [{ role: 'user', content: 'Show other' }], {}, narrowPrivileges(store, store.privileges('Admin'), scope), undefined, {}, scope);
  assert.equal(calls, 2, 'unchanged scoped access remains usable');
  assert.deepEqual(result.foundSets, []);
  assert.match(output, /is_error.*true/);
  assert.doesNotMatch(output, /generated-unreachable/);
});

test('R2 denied layout counts agree between MCP tools and resources', async (t) => {
  const { host, store } = fixture(t);
  store.setAiPolicy(false);
  store.savePrivilegeSet({ name: 'NoCounts', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', layoutAccess: { Items: { layout: 'viewOnly', records: 'none' } }, valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  store.setPassword('limited', 'generated', 'NoCounts');
  const { client, call } = await connect(t, host, 'limited');
  const result = await call('describe_layout', { layout: 'Items', sample: false });
  assert.equal(result.isError, true);
  assert.doesNotMatch(JSON.stringify(result), /totalCount|foundCount|generated-private/);
  await assert.rejects(client.readResource({ uri: 'tabularius://Generated/layouts/Items' }), /denied|200/);
  const absent = await call('get_script', { script: 'absent' });
  assert.equal(JSON.parse((absent.content as { text: string }[])[0].text).code, 104);
  for (const name of ['plan_import', 'import_records']) {
    const result = await call(name, { layout: 'Items', data: '"unterminated\n', format: 'csv', headerRow: true, columns: [] });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /denied|privilege/i, 'authorization precedes malformed import parsing');
    assert.doesNotMatch(JSON.stringify(result), /unterminated|generated-private/);
  }
});

test('R2 error hints never name files a different account owns', async (t) => {
  const { host, store } = fixture(t);
  host.create('UnlistedPrivateFile');
  store.setPassword('reader', 'generated', '[Full Access]');
  const { client, call } = await connect(t, host, 'reader');
  for (const name of ['optimization_fix', 'optimization_move_containers']) {
    const result = await call(name, { database: 'missing' });
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /UnlistedPrivateFile/);
  }
  await assert.rejects(client.readResource({ uri: 'tabularius://missing/schema' }), (error: any) => error.code === -32002);
});

test('R2 authentication cache expires monotonically despite wall-clock jumps', async (t) => {
  const { host, store } = fixture(t);
  store.setAiPolicy(false);
  store.setPassword('Admin', 'generated');
  const { call } = await connect(t, host, 'Admin', 'generated');
  const verify = t.mock.method(store, 'verify');
  let monotonic = performance.now(), wall = Date.now();
  t.mock.method(performance, 'now', () => monotonic);
  t.mock.method(Date, 'now', () => wall);
  assert.notEqual((await call('find_records', { layout: 'Items', limit: 0 })).isError, true);
  assert.equal(verify.mock.callCount(), 1);
  for (const jump of [-86_400_000, 172_800_000]) {
    wall += jump;
    assert.notEqual((await call('find_records', { layout: 'Items', limit: 0 })).isError, true);
    assert.equal(verify.mock.callCount(), 1);
  }
  monotonic += 300_001;
  assert.notEqual((await call('find_records', { layout: 'Items', limit: 0 })).isError, true);
  assert.equal(verify.mock.callCount(), 2);
});

test('R2 persisted policy and account vault isolation survive reopening a generated store', async (t) => {
  const { store, host } = fixture(t);
  const path = store.path;
  const token = new PiiMasker(store, 'one').token('generated-restart-person', 'PERSON');
  store.setAiPolicy(true);
  await host.close();
  const reopened = new Store(path, 'Generated');
  try {
    assert.equal(reopened.aiPolicy, true);
    assert.equal(new PiiMasker(reopened, 'one').unmask(token), 'generated-restart-person');
    assert.equal(new PiiMasker(reopened, 'two').unmask(token), token);
    assert.throws(() => checkPlan(reopened, { layout: 'Items', steps: [{ kind: 'find' }] }, reopened.privileges('Admin')), /AI policy.*refused/i);
  } finally { reopened.close(); }
});

test('R2 MCP session eviction closes prior sessions and scopes never share a session', (t) => {
  const { host } = fixture(t);
  const first = sessionFor(host, 'Generated', { account: 'one', database: 'Generated' });
  const close = t.mock.method(first, 'close');
  assert.notEqual(first, sessionFor(host, 'Generated', { account: 'two', database: 'Generated' }));
  assert.notEqual(first, sessionFor(host, 'Other', { account: 'one', database: 'Other' }));
  assert.notEqual(first, sessionFor(host, 'Generated', { account: 'one', database: 'Generated', scope: { readOnly: true } }));
  for (let i = 4; i <= 1000; i++) sessionFor(host, 'Generated', { account: `generated-${i}`, database: 'Generated' });
  assert.equal(close.mock.callCount(), 1);
  assert.notEqual(first, sessionFor(host, 'Generated', { account: 'one', database: 'Generated' }));
});

for (const count of [32, 65]) test(`R2 redaction propagation across ${count} Unicode aliases is fail closed`, () => {
  for (const sink of [
    `"https://user:" & $entrée${count} & "@example.invalid/"`,
    `MBS ( "CURL.SetOptionPassword" ; 1 ; $entrée${count} )`,
  ]) {
    const text = [
      'Set Variable [ $entrée0 ; Value: "generated-input-92" ]',
      ...Array.from({ length: count }, (_, i) => `Set Variable [ $entrée${i + 1} ; Value: $entrée${i} ]`),
      `Set Variable [ $url ; Value: ${sink} ]`,
    ].join('\n');
    const script = { id: 1, name: 'Generated', steps: parseScriptText(text, emptySchema()).map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params })) };
    const readback = parseScriptText(scriptText(script.steps), emptySchema());
    assert.deepEqual(readback.map((s) => s.params), script.steps.map((s) => s.params));
    const redactor = new CredentialRedactor();
    redactor.inspect([script]);
    assert.equal(redactor.value('generated-input-92', '$entrée0'), REDACTED);
    assert.equal(redactor.value('generated-input-92', `$entrée${count}`), REDACTED);
    assert.equal(new CredentialRedactor().value('generated-input-92'), 'generated-input-92');
  }
});

test('R2 credential component boundaries and typed diagnostics remain isolated', () => {
  const redactor = new CredentialRedactor();
  redactor.remember('https://user:generated%2Bvalue-91@example.invalid/');
  assert.equal(redactor.value('generated+value-91'), REDACTED);
  assert.equal(redactor.value('failure generated+value-91'), REDACTED);
  assert.deepEqual(redactor.data({ Count: 0, Flag: false, Empty: null, Name: 'ordinary' }), { Count: 0, Flag: false, Empty: null, Name: 'ordinary' });
  assert.equal(redactor.value('example.invalid'), 'example.invalid');
  assert.equal(redactor.value('user'), 'user');
  assert.equal(hasUrlAuth('a://'.repeat(20_000) + 'generated@example.invalid', true), true);
  assert.equal(hasUrlAuth('a://'.repeat(20_000) + 'example.invalid:443', true), false);
});

test('R2 offline options discard every operator capability without mutating the source', () => {
  const capability = () => { throw new Error('an outbound capability ran'); };
  const source = { network: true, outbound: { fetch: capability }, mail: capability, ai: { generate: capability }, installPlugin: capability, account: 'generated' };
  const offline = offlineScriptOptions(source as never);
  assert.equal(offline.network, false);
  for (const key of ['outbound', 'mail', 'ai', 'installPlugin'] as const) assert.equal(offline[key], undefined);
  assert.equal(offline.account, 'generated');
  assert.equal(source.network, true);
  assert.equal(source.mail, capability);
});

test('R2 inherited policy follows a cyclic file graph even when the entry file is off', async (t) => {
  const { host, store } = fixture(t);
  const other = host.create('Other');
  other.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Password' }] }, { op: 'createDataSource', name: 'Back', paths: ['file:Generated'] }]);
  store.applyDesign([{ op: 'createDataSource', name: 'Forward', paths: ['file:Other'] }]);
  store.setAiPolicy(false);
  const { call } = await connect(t, host);
  assert.equal((await call('find_records', { layout: 'Items', limit: 0 })).isError, true);
  other.setAiPolicy(false);
  assert.notEqual((await call('find_records', { layout: 'Items', limit: 0 })).isError, true);
  other.setAiPolicy(true);
  assert.equal((await call('find_records', { layout: 'Items', limit: 0 })).isError, true);
});

test('R2 MCP dynamic script names cannot select undeclared hosted files', async (t) => {
  const { host, store } = fixture(t);
  store.setAiPolicy(false);
  const other = host.create('Other');
  other.setAiPolicy(false);
  other.applyDesign([{ op: 'createScript', name: 'Read', text: 'Exit Script [ Text Result: "generated-destination" ]' }]);
  store.applyDesign([{ op: 'createScript', name: 'Call', text: 'Set Error Capture [ On ]\nPerform Script [ Specified: By name ; Get ( ScriptParameter ) ]\nIf [ Get ( LastError ) <> 0 ]\nExit Script [ Text Result: Get ( LastError ) ]\nEnd If\nExit Script [ Text Result: Get ( ScriptResult ) ]' }]);
  const { call } = await connect(t, host);
  const invoke = (parameter: string) => call('run_script', { script: 'Call', parameter, layout: 'Items' });
  for (const parameter of ['Other::Read', 'oThEr::Read']) {
    const result = await invoke(parameter);
    assert.doesNotMatch(JSON.stringify(result), /generated-destination/);
    assert.equal(JSON.parse((result.content as { text: string }[])[0].text).result, '100');
  }
  store.applyDesign([{ op: 'createDataSource', name: 'Declared', paths: ['file:Other'] }]);
  const allowed = await invoke('Declared::Read');
  assert.equal(JSON.parse((allowed.content as { text: string }[])[0].text).result, 'generated-destination');
});

test('R2 MCP SQL cannot read a quoted internal vault even with a human visibility grant', async (t) => {
  const { host, store } = fixture(t);
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  new PiiMasker(store, 'another').token('generated-vault-secret', 'PERSON');
  const { call } = await connect(t, host);
  for (const quote of ['"', '`', '[']) {
    const close = quote === '[' ? ']' : quote;
    const result = await call('sql_query', { sql: `SELECT value FROM ${quote}_fm_pii_vault${close}` });
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /generated-vault-secret/);
  }
});

test('R2 an unreviewed built-in cannot borrow a mixed-case custom function body', async (t) => {
  const { host, store } = fixture(t);
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  store.applyDesign([{ op: 'createCustomFunction', name: 'gEtNtHrEcOrD', parameters: ['a', 'b'], formula: '"ordinary"' }]);
  const { call } = await connect(t, host);
  const evaluate = t.mock.method(store, 'evaluate');
  const result = await call('evaluate_calculation', { layout: 'Items', formula: 'GetNthRecord ( Password ; 1 )' });
  assert.equal(result.isError, true);
  assert.equal(evaluate.mock.callCount(), 0);
});

test('R2 personal-data criteria and error text cannot resolve another account’s token', async (t) => {
  const { host, store } = fixture(t);
  store.setAiPolicy(false);
  store.setPiiIsolation(true);
  const token = new PiiMasker(store, 'different').token('generated-person-hidden', 'PERSON');
  const { call } = await connect(t, host, 'Admin');
  for (const value of [token, `==${token}`, 'g*', '>A']) {
    const result = await call('find_records', { layout: 'Items', limit: 0, query: [{ Name: value }] });
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /foundCount|generated-person-hidden/);
  }
});

test('R2 real MCP portal reads hide copies even when the source portal is omitted', async (t) => {
  const { host, store } = fixture(t);
  store.setAiPolicy(false);
  const secret = 'generated-private-83';
  store.applyDesign([
    { op: 'createField', table: 'Items', name: 'ParentId', type: 'number' },
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }, { name: 'Copy' }] },
    { op: 'createRelationship', left: 'Parents', right: 'Items', predicates: [{ left: 'Id', right: 'ParentId' }] },
  ]);
  store.update('Items', 1, { ParentId: 1 });
  store.create('Items', { ParentId: 1, Name: secret });
  store.create('Parents', { Id: 1, Copy: secret });
  const occurrence = store.schema.tableOccurrences.find((o) => o.name === 'Items')!;
  const bounds = { top: 0, left: 0, bottom: 100, right: 200 }, anchors = { left: true, top: true, right: false, bottom: false };
  const children = ['Password', 'Name'].map((name, i) => ({ id: 901 + i, kind: 'field', type: 1, anchors, style: {}, bounds,
    field: { tableOccurrenceId: occurrence.id, tableOccurrence: 'Items', fieldId: store.schema.tables[0].fields.find((f) => f.name === name)!.id, field: name, display: 'edit', repetitions: 1 } }));
  const portal = { id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds, children,
    portal: { tableOccurrenceId: occurrence.id, tableOccurrence: 'Items', rows: 5, initialRow: 1 } } as unknown as LayoutObject;
  store.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { objects: [...store.design('Parents')!.objects, portal] } }]);
  assert.equal(store.get('Parents', 1).portalData!.Items.length, 2, 'real related rows are present');
  const { call } = await connect(t, host);
  for (const [name, args] of [
    ['get_record', { layout: 'Parents', recordId: 1 }],
    ['find_records', { layout: 'Parents', fields: ['Copy', 'Items::Name'], portalRows: 0 }],
  ] as const) {
    const result = await call(name, args);
    assert.notEqual(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /generated-private-83/);
    assert.match(JSON.stringify(result), /hidden from AI tools/);
  }
  assert.equal(store.get('Parents', 1).fieldData.Copy, secret);
});

test('R2 a signed container URL cannot cross MCP accounts', async (t) => {
  const { host, store } = fixture(t);
  host.setBaseUrl('http://127.0.0.1:1'); // URL generation only; no listener or request.
  store.setAiPolicy(false);
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Doc', type: 'container' }]);
  store.setContainer('Items', 1, 'Doc', 1, { filename: 'generated.txt', mime: 'text/plain', data: new TextEncoder().encode('generated-container-data') });
  store.savePrivilegeSet({ name: 'Limited', records: { view: true, edit: false, create: false, delete: false, fields: { Password: 'none' } }, layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  for (const account of ['one', 'two']) store.setPassword(account, 'generated', 'Limited');
  const a = await connect(t, host, 'one'), b = await connect(t, host, 'two');
  const own = await a.call('get_record', { layout: 'Items', recordId: 1 });
  const link = JSON.parse((own.content as { text: string }[])[0].text).fieldData.Doc;
  assert.match(link, /as=one/);
  const refused = await b.call('get_container', { container: link });
  assert.equal(refused.isError, true);
  assert.doesNotMatch(JSON.stringify(refused), /generated-container-data/);
  assert.match(JSON.stringify(await a.call('get_container', { container: link })), /generated-container-data/);
});
