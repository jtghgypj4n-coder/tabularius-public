import { test, before, after } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import type { McpIdentity } from '../src/mcp.ts';
import { saveAutomation } from '../src/automations.ts';
import { PiiMasker } from '../src/pii.ts';
import type { Store } from '../../store/src/index.ts';

const database = 'Resource Shop';
const script = 'Send / résumé #1%';
const layout = 'Invoice / details #1%';
const email = 'ada@example.com';
const customer = 'Ada Example';
const runMessage = `Called ${customer} about her private appointment`;
const base = `tabularius://${encodeURIComponent(database)}/`;
const resources = [
  { path: `scripts/${encodeURIComponent(script)}`, template: 'scripts/{script}', tool: 'get_script', args: { script }, mimeType: 'text/plain' },
  { path: `layouts/${encodeURIComponent(layout)}`, template: 'layouts/{layout}', tool: 'describe_layout', args: { layout }, mimeType: 'application/json' },
  { path: 'automations', template: 'automations', tool: 'list_automations', args: {}, mimeType: 'application/json' },
  { path: 'audit', template: 'audit', tool: 'audit_log', args: {}, mimeType: 'application/json' },
];
let dir: string;
let host: Host;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-resources-'));
  host = new Host(dir, () => {}, { background: false });
  store = host.create(database);
  // Existing-file compatibility: absent policy keeps the original redaction behavior.
  store.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  store.applyDesign([
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Email', type: 'text' }, { name: 'Customer', type: 'text' }, { name: 'Internal', type: 'text' }, { name: 'Status', type: 'text' }] },
    { op: 'updateLayout', layout: 'Invoices', name: layout },
    { op: 'createLayout', name: 'Private layout', occurrence: 'Invoices' },
    { op: 'createScript', name: script, text: `# Contact ${email}\nSet Variable [ $password ; Value: "swordfish" ]` },
    { op: 'createScript', name: 'Run only', text: 'Beep' },
    { op: 'createScript', name: 'Private script', text: 'Beep' },
  ]);
  store.setPassword('Admin', 'pw');
  store.savePrivilegeSet({
    name: 'Denied', records: { view: false, edit: false, create: false, delete: false },
    layouts: 'none', scripts: 'viewOnly', scriptAccess: { 'Private script': 'none' }, valueLists: 'none', extendedPrivileges: ['fmmcp'],
  });
  store.setPassword('Denied', 'pw', 'Denied');
  store.savePrivilegeSet({
    name: 'Reader', records: { view: false, edit: false, create: false, delete: false },
    tables: { Invoices: { view: 'Status = "Open"', edit: false, create: false, delete: false, fields: { Customer: 'masked', Internal: 'none' } } },
    layouts: 'none', layoutAccess: { [layout]: { layout: 'viewOnly', records: 'viewOnly' } },
    scripts: 'none', scriptAccess: { [script]: 'modifiable', 'Run only': 'viewOnly' }, valueLists: 'viewOnly', extendedPrivileges: ['fmmcp'],
  });
  store.setPassword('Reader', 'pw', 'Reader');
  store.savePrivilegeSet({
    name: 'No AI', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', scripts: 'modifiable', valueLists: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('No AI', 'pw', 'No AI');
  store.create(layout, { Email: email, Customer: customer, Internal: 'Private note', Status: 'Open' });
  store.create(layout, { Email: 'hidden@example.com', Customer: 'Hidden Customer', Internal: 'Hidden note', Status: 'Closed' });
  const { automation } = saveAutomation(store, { name: 'Notify', description: `Contact ${email}`, layout, on: 'update', script, enabled: false }, 'Admin', []);
  store.sql.prepare('INSERT INTO _fm_automation_runs (automation, at, record_id, outcome, message) VALUES (?, ?, ?, ?, ?)')
    .run(automation.id, new Date().toISOString(), 1, 'warning', runMessage);
  host.create('Private Shop');
});

after(async () => {
  if (host) await host.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function connect(t: TestContext, who: McpIdentity = { account: 'Admin', database }): Promise<Client> {
  const server = createMcpServer(host, who);
  const client = new Client({ name: 'resources-test', version: '1' });
  t.after(async () => { await client.close(); await server.close(); });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function read(client: Client, path: string, mimeType: string): Promise<string> {
  const uri = base + path;
  const result = await client.readResource({ uri });
  assert.equal(result.contents.length, 1);
  const content = result.contents[0];
  assert.equal(content.uri, uri);
  assert.equal(content.mimeType, mimeType);
  assert.ok('text' in content);
  return content.text;
}

async function toolData(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: { database, ...args } });
  assert.ok(!result.isError, JSON.stringify(result));
  const content = result.content as { text: string }[];
  return JSON.parse(content[0].text);
}

for (const r of resources) {
  test(`${r.tool} resource is listed, has a template and reads the tool's data`, async (t) => {
    for (const who of [{ account: 'Admin', database }, { admin: true }] as McpIdentity[]) {
      const client = await connect(t, who);
      const listed = (await client.listResources()).resources;
      assert.ok(listed.some((x) => x.uri === base + r.path && x.mimeType === r.mimeType));
      const templates = (await client.listResourceTemplates()).resourceTemplates;
      assert.ok(templates.some((x) => x.uriTemplate === `tabularius://{database}/${r.template}` && x.mimeType === r.mimeType));
      const body = await read(client, r.path, r.mimeType);
      const tool = await toolData(client, r.tool, r.args);
      if (r.tool === 'get_script') {
        assert.equal(body, (tool as { text: string }).text);
        assert.doesNotMatch(body, /swordfish/);
      } else {
        assert.deepEqual(JSON.parse(body), tool);
      }
    }
  });

  test(`${r.tool} resource is not listed and cannot be read by a denied account`, async (t) => {
    const client = await connect(t, { account: 'Denied', database });
    assert.ok(!(await client.listResources()).resources.some((x) => x.uri === base + r.path));
    await assert.rejects(client.readResource({ uri: base + r.path }), /privilege|missing|No script/i);
  });
}

test('script and layout resources follow individual access, row rules and masked fields', async (t) => {
  const client = await connect(t, { account: 'Reader', database });
  const listed = (await client.listResources()).resources.map((r) => r.uri);
  assert.ok(listed.includes(base + resources[0].path));
  assert.ok(listed.includes(base + resources[1].path));
  for (const path of ['scripts/Run%20only', 'scripts/Private%20script', 'layouts/Private%20layout', 'automations', 'audit']) {
    assert.ok(!listed.includes(base + path), path);
    await assert.rejects(client.readResource({ uri: base + path }));
  }
  assert.equal(await read(client, resources[0].path, 'text/plain'), (await toolData(client, 'get_script', { script }) as { text: string }).text);
  const body = await read(client, resources[1].path, 'application/json');
  assert.deepEqual(JSON.parse(body), await toolData(client, 'describe_layout', { layout }));
  const profile = JSON.parse(body) as { records: number; fields: { name: string; masked?: boolean }[] };
  assert.equal(profile.records, 1);
  assert.equal(profile.fields.find((f) => f.name === 'Customer')?.masked, true);
  assert.ok(!profile.fields.some((f) => f.name === 'Internal'));
  assert.doesNotMatch(body, /Ada Example|hidden@example.com|Hidden Customer|Private note/);
});

test('resources refuse unknown scripts and layouts', async (t) => {
  const client = await connect(t);
  for (const path of ['scripts/Missing', 'layouts/Missing']) await assert.rejects(client.readResource({ uri: base + path }), /No script|layout/i);
});

test('resources honour file access, AI access and scoped token limits', async (t) => {
  const noAi = await connect(t, { account: 'No AI', database });
  assert.deepEqual((await noAi.listResources()).resources, []);
  for (const r of resources) await assert.rejects(noAi.readResource({ uri: base + r.path }), /fmmcp/);
  const owner = await connect(t);
  assert.ok(!(await owner.listResources()).resources.some((r) => r.uri.includes('Private%20Shop')));
  for (const r of resources) await assert.rejects(owner.readResource({ uri: `tabularius://Private%20Shop/${r.path}` }), /signed in/);
  const limited = await connect(t, { account: 'Admin', database, scope: { readOnly: true, layouts: [layout] } });
  const listed = (await limited.listResources()).resources.map((r) => r.uri);
  assert.ok(listed.includes(base + resources[1].path));
  assert.ok(!listed.includes(base + 'layouts/Private%20layout'));
  for (const r of [resources[0], resources[2], resources[3]]) {
    assert.ok(!listed.includes(base + r.path));
    await assert.rejects(limited.readResource({ uri: base + r.path }));
  }
});

test('script resources preserve the tool\'s text stand-ins during isolation', async (t) => {
  const client = await connect(t);
  const r = resources[0];
  assert.ok((await read(client, r.path, r.mimeType)).includes(email));
  store.setPiiIsolation(true);
  try {
    const standIn = new PiiMasker(store, 'Admin').patterns(email);
    assert.match(standIn, /^<EMAIL_\d+>$/);
    const body = await read(client, r.path, r.mimeType);
    assert.ok(body.includes(standIn));
    assert.ok(!body.includes(email));
    assert.equal(body, (await toolData(client, r.tool, r.args) as { text: string }).text);
  } finally {
    store.setPiiIsolation(false);
  }
});

test('layout resources follow describe_layout isolation policy and omit ordinary personal values', async (t) => {
  const r = resources[1];
  const clients = await Promise.all([connect(t), connect(t, { admin: true })]);
  for (const client of clients) assert.ok((await read(client, r.path, r.mimeType)).includes(customer));
  store.setPiiIsolation(true);
  try {
    for (const client of clients) {
      assert.ok((await client.listResources()).resources.some((x) => x.uri === base + r.path));
      const body = await read(client, r.path, r.mimeType);
      // An explicit request for samples must also be overridden by the matching tool.
      assert.deepEqual(JSON.parse(body), await toolData(client, r.tool, { ...r.args, sample: true }));
      assert.doesNotMatch(body, /Ada Example|Hidden Customer|Private note|Hidden note|@example\.com/);
      const profile = JSON.parse(body) as { fields: Record<string, unknown>[] };
      assert.ok(profile.fields.some((f) => f.name === 'Customer'));
      assert.ok(profile.fields.every((f) => !('values' in f) && !('filled' in f) && !('distinct' in f)));
    }
  } finally {
    store.setPiiIsolation(false);
  }
});

for (const r of resources.slice(2)) {
  test(`${r.tool} resource is hidden and refused during isolation with ordinary personal data present`, async (t) => {
    const clients = await Promise.all([connect(t), connect(t, { admin: true })]);
    const personal = r.tool === 'list_automations' ? runMessage : customer;
    for (const client of clients) assert.ok((await read(client, r.path, r.mimeType)).includes(personal));
    store.setPiiIsolation(true);
    try {
      for (const client of clients) {
        assert.ok(!(await client.listResources()).resources.some((x) => x.uri === base + r.path));
        const tool = await client.callTool({ name: r.tool, arguments: { database } });
        assert.equal(tool.isError, true);
        const refusal = (tool.content as { text: string }[])[0].text;
        assert.match(refusal, /Personal data isolation is on/);
        await assert.rejects(client.readResource({ uri: base + r.path }), (error: Error) => {
          assert.ok(error.message.includes(refusal), error.message);
          assert.ok(!error.message.includes(personal));
          return true;
        });
      }
    } finally {
      store.setPiiIsolation(false);
    }
    for (const client of clients) {
      assert.ok((await client.listResources()).resources.some((x) => x.uri === base + r.path));
      assert.ok((await read(client, r.path, r.mimeType)).includes(personal));
    }
  });
}

test('every new resource is hidden and refused when AI is off', async (t) => {
  const client = await connect(t);
  store.setAiAllowed(false);
  try {
    assert.deepEqual((await client.listResources()).resources, []);
    for (const r of resources) await assert.rejects(client.readResource({ uri: base + r.path }), /AI.*off/);
  } finally {
    store.setAiAllowed(true);
  }
});

test('the audit summary keeps the latest 100 entries and hides secret field values', async (t) => {
  const client = await connect(t);
  store.applyDesign([{ op: 'createField', table: 'Invoices', name: 'Api Key', type: 'text' }]);
  for (let i = 0; i < 105; i++) store.create(layout, { Status: `Audit ${i}` });
  const record = store.create(layout, { 'Api Key': 'private-audit-key' });
  const raw = store.auditLog({ table: 'Invoices', recordId: record.recordId });
  assert.equal(raw[0].changes?.['Api Key'], 'private-audit-key', 'the underlying log has a value to redact');
  const body = await read(client, 'audit', 'application/json');
  const entries = JSON.parse(body) as { seq: number; recordId?: number; changes?: Record<string, unknown> }[];
  assert.equal(entries.length, 100);
  assert.deepEqual(entries.map((e) => e.seq), store.auditLog({ limit: 100 }).map((e) => e.seq));
  assert.ok(entries.every((e, i) => i === 0 || e.seq > entries[i - 1].seq));
  assert.equal(entries.find((e) => e.recordId === record.recordId)?.changes?.['Api Key'], '‹hidden from AI tools›');
  assert.doesNotMatch(body, /private-audit-key/);
  assert.deepEqual(entries, await toolData(client, 'audit_log', {}));
});
