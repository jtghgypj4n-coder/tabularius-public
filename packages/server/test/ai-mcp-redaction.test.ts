import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { Assistant } from '../src/assistant.ts';
import { classOf } from '../src/pii.ts';
import { changeImpact } from '../src/change-impact.ts';

const SECRET = 'synthetic-literal-417';
const MARKER = 'synthetic-hidden-field-marker@example.test';
async function setup(t: TestContext, bound = false) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-redaction-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Review');
  const server = createMcpServer(host, bound ? { account: 'Admin', database: 'Review' } : { admin: true });
  const client = new Client({ name: 'redaction-test', version: '1' });
  t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: { database: store.name, ...args } });
  return { store, host, client, call };
}
function safe(value: unknown, forbidden = [SECRET, MARKER]) {
  const text = JSON.stringify(value);
  for (const marker of forbidden) assert.ok(!text.includes(marker), `unexpected marker: ${marker}`);
}

async function provider(t: TestContext, host: Host) {
  const requests: string[] = [];
  const model = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push(body);
      const token = body.match(/<EMAIL_\d+>/)?.[0] ?? 'unmasked';
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        content: [{ type: 'text', text: `Contact ${token}` }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => model.close(() => resolve())));
  const assistant = new Assistant(host, undefined as never, { apiKey: 'synthetic', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` });
  return { assistant, requests };
}

test('AR-server-mcp-ai-01', async (t) => {
  const { store, call } = await setup(t);
  store.applyDesign([
    { op: 'createValueList', name: 'States', values: ['Open', 'Closed'] },
    { op: 'createTable', name: 'Categories', fields: [{ name: 'Status', options: { validation: { valueList: 1 } } }] },
    { op: 'createTable', name: 'People', fields: [{ name: 'Payload' }] },
  ]);
  store.create('Categories', { Status: 'Open' });
  store.create('People', { Payload: 'Synthetic Person Only' });
  store.setPiiIsolation(true, { account: 'test' });
  assert.equal(store.schema.tables[0].fields[0].id, store.schema.tables[1].fields[0].id);
  const result = await call('get_record', { layout: 'People', recordId: 1 });
  assert.notEqual(result.isError, true);
  safe(result, ['Synthetic Person Only']);
  assert.equal(classOf(store, 'People', 'Payload').pii, true);
  assert.equal(classOf(store, 'Categories', 'Status').pii, false);
  store.markPiiField('People', 'Payload', false);
  store.markPiiField('Categories', 'Status', true);
  assert.equal(classOf(store, 'People', 'Payload').pii, false);
  assert.equal(classOf(store, 'Categories', 'Status').pii, true);
});

test('AR-server-mcp-ai-02', async (t) => {
  const { store, host } = await setup(t);
  const email = 'review-person@example.test';
  const comment = 'review-comment@example.test';
  store.applyDesign([{ op: 'createScript', name: `Contact ${email}`, text: `# ${comment}\nExit Script [ Text Result: "${email}" ]` }]);
  store.setPiiIsolation(true, { account: 'test' });
  const { assistant, requests } = await provider(t, host);
  const result = await assistant.scriptDocs(store, 'Admin');
  assert.equal(requests.length, 1);
  safe(requests, [email, comment]);
  assert.match(requests[0], /<EMAIL_\d+>/);
  assert.match(result, /review-(?:person|comment)@example.test/);
});

for (const scratch of [true, false]) test(`AR-server-mcp-ai-03 scratch=${scratch}`, async (t) => {
  const { store, call } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Password' }] }]);
  store.create('Items', { Password: SECRET });
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: ['Password'] } });
  for (const [name, formula] of [['Direct', 'Password'], ['Transformed', 'Upper ( Password )'], ['SQL', 'ExecuteSQL ( "SELECT Password FROM Items" ; "" ; "" )']] as const) {
    store.applyDesign([{ op: 'createScript', name, text: `Go to Record/Request/Page [ First ]\nSet Variable [ $copy ; Value: ${formula} ]\nExit Script [ Text Result: $copy ]` }]);
    for (const tool of ['run_script', 'debug_script']) {
      const result = await call(tool, { script: name, layout: 'Items', ...(tool === 'debug_script' ? { scratch, breakpoints: [{ step: 3 }], watch: ['Upper ( Password )'] } : { trace: true }) });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      safe(result, [SECRET, SECRET.toUpperCase()]);
      assert.match(JSON.stringify(result), /withheld/);
    }
  }
});

test('AR-server-mcp-ai-04', async (t) => {
  const { store, call } = await setup(t);
  store.applyDesign([{ op: 'createScript', name: 'Credential', text: `Set Variable [ $password ; Value: "${SECRET}" ]` },
    { op: 'createScript', name: 'Safe', text: 'Exit Script [ Text Result: "public-value" ]' }]);
  for (const args of [{}, { detail: true }]) safe(await call('get_script', { script: 'Credential', ...args }));
  const result = await call('copy_for_filemaker', { scripts: [store.schema.scripts[0].id] });
  safe(result);
  assert.match(JSON.stringify(result), /hidden|withheld|refused/i);
  const publicCopy = await call('copy_for_filemaker', { scripts: [store.schema.scripts[1].id] });
  assert.notEqual(publicCopy.isError, true);
  assert.match(JSON.stringify(publicCopy), /public-value/);
  assert.ok(JSON.stringify(store.schema.scripts[0]).includes(SECRET));
});

test('AR-server-mcp-ai-05', async (t) => {
  const { store, host, call } = await setup(t, true);
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Label' }] }]);
  const other = host.create('PrivateOther');
  other.applyDesign([{ op: 'createDataSource', name: 'Review', paths: ['file:Review'] },
    { op: 'createOccurrence', name: 'PrivateReference', file: 'Review', externalTable: store.schema.tables[0].id }]);
  assert.equal((await call('get_design', { database: other.name })).isError, true);
  const result = await call('check_change_impact', { kind: 'table', name: 'Items' });
  assert.notEqual(result.isError, true);
  safe(result, ['PrivateOther', 'PrivateReference']);
});

const surfaces: [string, Record<string, unknown>][] = [
  ['get_record', { layout: 'Items', recordId: 1 }], ['find_records', { layout: 'Items' }],
  ['describe_record', { layout: 'Items', recordId: 1 }], ['describe_layout', { layout: 'Items' }],
  ['describe_database', {}], ['search_records', { text: 'visible' }],
  ['sql_query', { sql: 'SELECT * FROM Items' }], ['evaluate_calculation', { layout: 'Items', recordId: 1, formula: 'Password & Payload' }],
  ['summarize_records', { layout: 'Items', groupBy: ['Payload'] }],
  ['explain_value', { layout: 'Items', recordId: 1, field: 'Password' }], ['check_record', { layout: 'Items', recordId: 1 }],
  ['explain_record_history', { table: 'Items', recordId: 1 }], ['audit_log', {}],
  ['get_script', { script: 'Credential', detail: true }], ['get_design', { scripts: ['Credential'] }],
  ['get_layout_design', { layout: 'Items' }], ['copy_for_filemaker', { scripts: [1] }],
  ['run_script', { script: 'Credential', layout: 'Items', trace: true }],
  ['debug_script', { script: 'Credential', layout: 'Items' }], ['explain_script_failure', { script: 'Credential', layout: 'Items' }],
  ['save_dashboard', { name: 'Preview', preview: true, widgets: [{ title: 'Items', kind: 'table', layout: 'Items', groupBy: ['Payload'] }] }],
  ['find_data_problems', { layout: 'Items' }], ['conversion_report', {}], ['conversion_guide', {}],
  ['document_solution', {}], ['explain_solution', {}], ['solution_map', {}],
  ['search_solution', { text: 'Credential' }], ['check_change_impact', { kind: 'table', name: 'Items' }],
];
for (const granted of [false, true]) test(`model and export surface matrix granted=${granted}`, async (t) => {
  const { store, call, client, host } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Password' }, { name: 'Payload' }] },
    { op: 'createScript', name: 'Credential', text: `# ${MARKER}\nSet Variable [ $password ; Value: "${SECRET}" ]\nExit Script [ Text Result: Payload ]` }]);
  store.applyDesign([{ op: 'createScript', name: `Contact ${MARKER}`, text: 'Beep' }]);
  store.create('Items', { Password: SECRET, Payload: MARKER });
  store.markPiiField('Items', 'Payload', true);
  if (granted) store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  store.setPiiIsolation(true, { account: 'test' });
  for (const [name, args] of surfaces) await t.test(name, async () => {
    const result = await call(name, args);
    safe(result);
    assert.doesNotMatch(JSON.stringify(result), /Invalid arguments|Unknown tool|not found/i);
    if (!granted && name !== 'solution_map') assert.match(JSON.stringify(result), /AI policy.*refused/i);
    if (name === 'solution_map') assert.notEqual(result.isError, true);
    if (granted && ['get_record', 'find_records', 'describe_layout', 'describe_database'].includes(name)) assert.notEqual(result.isError, true);
  });
  for (const path of ['schema', 'overview', 'scripts/Credential', 'layouts/Items', 'audit', 'automations', 'conversion-guide']) {
    await t.test(`resource ${path}`, async () => {
      try { safe(await client.readResource({ uri: `tabularius://Review/${path}` })); }
      catch (error) { safe(String(error)); assert.match(String(error), /AI policy|isolation/i); }
    });
  }
  const { assistant, requests } = await provider(t, host);
  for (const surface of ['scriptDocs', 'handoverMemo'] as const) await t.test(`provider ${surface}`, async () => {
    const before = requests.length;
    if (!granted) {
      await assert.rejects(() => assistant[surface](store, 'Admin'), /AI policy.*refused/i);
      assert.equal(requests.length, before);
    } else {
      await assistant[surface](store, 'Admin');
      assert.ok(requests.length > before);
      safe(requests);
      assert.match(requests.at(-1)!, /<EMAIL_\d+>/);
    }
  });
});

for (const formula of ['Upper ( Password )', 'ExecuteSQL ( "SELECT Password FROM Items" ; "" ; "" )']) test(`AR-server-mcp-ai-03 watch ${formula}`, async (t) => {
  const { store, call } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Password' }] },
    { op: 'createScript', name: 'Watch', text: 'Go to Record/Request/Page [ First ]\nExit Script [ Text Result: "public-value" ]' }]);
  store.create('Items', { Password: SECRET });
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  const result = await call('debug_script', { script: 'Watch', layout: 'Items', breakpoints: [{ step: 2 }], watch: [formula] });
  assert.notEqual(result.isError, true);
  safe(result, [SECRET, SECRET.toUpperCase()]);
  assert.match(JSON.stringify(result), /withheld/);
});

test('AR-server-mcp-ai-04 structured and multiline exports', async (t) => {
  const { store, call } = await setup(t);
  for (const text of [
    `Set Variable [ $password ; Value: \n"${SECRET}" ]`,
    `Set Variable [ $authorization ; Value: "${SECRET}" ]`,
    `Insert from URL [ $r ; "https://example.test/${SECRET}" ]`,
  ]) {
    store.applyDesign([{ op: 'createScript', name: `Export${store.schema.scripts.length}`, text }]);
    const script = store.schema.scripts.at(-1)!;
    const before = JSON.stringify(script);
    const result = await call('copy_for_filemaker', { scripts: [script.id] });
    safe(result);
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /withheld/);
    assert.equal(JSON.stringify(script), before);
  }
});

test('AR-server-mcp-ai-05 contributing file policy', async (t) => {
  const { store, host, call } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Label' }] }]);
  for (const name of ['Permitted', 'AiDisabled', 'PolicyDenied']) {
    const other = host.create(name);
    other.applyDesign([{ op: 'createDataSource', name: 'Review', paths: ['file:Review'] },
      { op: 'createOccurrence', name: `${name}Reference`, file: 'Review', externalTable: store.schema.tables[0].id }]);
    if (name === 'AiDisabled') other.setAiAllowed(false, { account: 'test' });
    if (name === 'PolicyDenied') other.applyDesign([{ op: 'createTable', name: 'Credentials', fields: [{ name: 'Password' }] }]);
  }
  const result = await call('check_change_impact', { kind: 'table', name: 'Items' });
  assert.notEqual(result.isError, true);
  safe(result, ['AiDisabled', 'PolicyDenied']);
  assert.match(JSON.stringify(result), /PermittedReference/);
});

test('AR-server-mcp-ai-05 shared authorization', async (t) => {
  const { store, host } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Label' }] }]);
  const other = host.create('PrivateOther');
  other.applyDesign([{ op: 'createDataSource', name: 'Review', paths: ['file:Review'] },
    { op: 'createOccurrence', name: 'PrivateReference', file: 'Review', externalTable: store.schema.tables[0].id }]);
  for (const canRead of [undefined, () => false, () => { throw new Error('denied'); }]) {
    const result = await changeImpact(store, undefined, 'table', 'Items', 'delete', { others: [other], hiddenOthers: [other], canRead });
    safe(result, ['PrivateOther', 'PrivateReference']);
    assert.deepEqual(result.crossFile, []);
    assert.equal(result.crossFileHidden, undefined);
  }
  const allowed = await changeImpact(store, undefined, 'table', 'Items', 'delete', { others: [other], canRead: () => true });
  assert.equal(allowed.crossFile[0].file, 'PrivateOther');
});
