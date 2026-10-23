// Connecting an AI app: the admin console makes a file's API token (AI apps only) for one account, or for a new AI
// agent, and an MCP client signs in with it over a real MCP handshake (initialize, tools/list, calls), within that
// account's privileges narrowed to the token's limits (read-only, some layouts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { McpTokens } from '../src/mcp-tokens.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-onboarding-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  // With an administrator token set, this machine is not the administrator by default, so only the tokens below get in.
  const s = await serve({ dir, port: 0, log: () => {}, mcpToken: 'admin-only-secret' });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.savePrivilegeSet({
    name: 'Clerk',
    records: { view: false, edit: false, create: false, delete: false },
    tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'],
  });
  store.setPassword('Clerk', 'pw', 'Clerk');
  store.savePrivilegeSet({
    name: 'No AI', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'],
  });
  store.setPassword('Reader', 'pw', 'No AI');
  store.savePrivilegeSet({
    name: 'Editor', records: { view: true, edit: true, create: true, delete: true },
    layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmmcp', 'fmrest'],
  });
  store.setPassword('Ed', 'pw', 'Editor');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const admin = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}/tabularius/admin/v1/mcp${path}`, {
    method, headers: method === 'GET' ? {} : { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'onboarding-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}
const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '');

test('the admin console lists accounts with and without AI access, and the page has the section', { skip }, async () => {
  const { body } = await admin('GET', '');
  const charts = body.files.find((f: { name: string }) => f.name === 'Charts');
  assert.equal(charts.accounts.find((a: { name: string }) => a.name === 'Clerk').ai, true);
  assert.equal(charts.accounts.find((a: { name: string }) => a.name === 'Reader').ai, false);
  const page = await (await fetch(`${base}/admin/`)).text();
  assert.match(page, /id="mcp-section"/);
  assert.match(page, /mcp-remote/);
  assert.ok(charts.agentSets.some((p: { name: string; ai: boolean }) => p.name === 'Editor' && p.ai));
  assert.ok(!charts.agentSets.some((p: { name: string }) => p.name === '[Full Access]'), 'an agent is never [Full Access]');
  assert.ok(charts.layouts.includes('Congress'));
  const docs = await fetch(`${base}/docs/connect-ai`);
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /<h1>Connect an AI app<\/h1>[\s\S]*claude mcp add --transport http/);
});

test('a token signs an MCP client in as its account: handshake, tools, reads, and refused writes', { skip }, async () => {
  const made = await admin('POST', '/tokens', { database: 'charts', account: 'clerk', label: 'Claude Desktop', days: 30 });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const token = made.body.token as string;
  assert.match(token, /^ohbt_[0-9a-f]{12}\.[\w-]{30,}$/);
  assert.equal(made.body.database, 'Charts');
  assert.equal(made.body.account, 'Clerk');
  assert.deepEqual(made.body.surfaces, ['fmmcp']);
  assert.equal(made.body.warning, undefined);

  // The file keeps only a hash: the secret isn't in it.
  const rows = JSON.stringify(store.sql.prepare('SELECT * FROM _fm_api_tokens').all());
  assert.ok(!rows.includes(token.split('.')[1]));

  const client = await connect(token);
  assert.equal(client.getServerVersion()?.name, 'tabularius');
  const { tools } = await client.listTools();
  for (const name of ['list_databases', 'find_records', 'change_design']) assert.ok(tools.some((t) => t.name === name), name);

  assert.deepEqual(JSON.parse(textOf(await client.callTool({ name: 'list_databases', arguments: {} }))), ['Charts']);
  const found = JSON.parse(textOf(await client.callTool({ name: 'find_records', arguments: { database: 'Charts', layout: 'Congress', limit: 500 } })));
  assert.ok(found.records.length > 0 && found.records.every((r: { fieldData: { Party: string } }) => r.fieldData.Party === 'D'), 'the account\'s record access holds');

  // A privileged call the account may not make is refused, and nothing changes.
  const denied = await client.callTool({ name: 'change_design', arguments: { database: 'Charts', changes: [{ op: 'createTable', name: 'Sneaky' }] } });
  assert.equal(denied.isError, true, textOf(denied));
  assert.ok(!store.schema.tables.some((t) => t.name === 'Sneaky'));
  await client.close();

  const listed = (await admin('GET', '')).body.tokens.find((t: { id: string }) => t.id === made.body.id);
  assert.ok(listed.lastUsed, 'last used is recorded');
  assert.equal(listed.token, undefined);
  assert.equal(listed.hash, undefined);
  assert.equal(listed.database, 'Charts');

  // Revoked: the next handshake is refused.
  assert.equal((await admin('DELETE', `/tokens/${made.body.id}`)).status, 200);
  await assert.rejects(connect(token));
});

test('tokens: an account without AI access is warned about and refused; unknown accounts and bad tokens are refused', { skip }, async () => {
  const made = await admin('POST', '/tokens', { database: 'Charts', account: 'Reader' });
  assert.equal(made.status, 201);
  assert.match(made.body.warning, /fmmcp/);
  const client = await connect(made.body.token);
  const r = await client.callTool({ name: 'find_records', arguments: { database: 'Charts', layout: 'Congress', limit: 1 } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /fmmcp/);
  await client.close();

  assert.equal((await admin('POST', '/tokens', { database: 'Charts', account: 'Nobody' })).status, 400);
  assert.equal((await admin('POST', '/tokens', { database: 'Nope', account: 'Clerk' })).status, 400);
  await assert.rejects(connect('ohm_not-a-real-token'));
  await assert.rejects(connect('ohbt_000000000000.not-a-real-token'));
  // The administrator's own token still works.
  const adminClient = await connect('admin-only-secret');
  assert.ok((await adminClient.listTools()).tools.length > 0);
  await adminClient.close();
});

test('a read-only token views but changes nothing, runs no scripts, and can\'t see the design or run SQL', { skip }, async () => {
  const made = await admin('POST', '/tokens', { database: 'Charts', account: 'Ed', readOnly: true });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.readOnly, true);
  const client = await connect(made.body.token);
  const found = JSON.parse(textOf(await client.callTool({ name: 'find_records', arguments: { database: 'Charts', layout: 'Congress', limit: 1 } })));
  const recordId = found.records[0].recordId;
  assert.ok(recordId);
  for (const [name, args] of [
    ['update_record', { database: 'Charts', layout: 'Congress', recordId, fieldData: { Party: 'X' } }],
    ['create_record', { database: 'Charts', layout: 'Congress', fieldData: {} }],
    ['sql_query', { database: 'Charts', sql: 'SELECT COUNT(*) FROM Congress' }],
    ['explain_solution', { database: 'Charts' }],
    ['evaluate_calculation', { database: 'Charts', layout: 'Congress', recordId, formula: '1+1' }],
  ] as const) {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, true, `${name}: ${textOf(r)}`);
  }
  assert.equal(JSON.parse(textOf(await client.callTool({ name: 'get_record', arguments: { database: 'Charts', layout: 'Congress', recordId } }))).fieldData.Party, found.records[0].fieldData.Party);
  await client.close();
});

test('a layout-scoped token sees only its layouts and their tables', { skip }, async () => {
  const made = await admin('POST', '/tokens', { database: 'Charts', account: 'Ed', layouts: ['Congress'] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const client = await connect(made.body.token);
  assert.ok(JSON.parse(textOf(await client.callTool({ name: 'find_records', arguments: { database: 'Charts', layout: 'Congress', limit: 1 } }))).records.length);
  const other = await client.callTool({ name: 'find_records', arguments: { database: 'Charts', layout: 'Grades', limit: 1 } });
  assert.equal(other.isError, true, textOf(other));
  const schema = JSON.parse(textOf(await client.callTool({ name: 'describe_database', arguments: { database: 'Charts' } })));
  const names = JSON.stringify(schema.layouts ?? []);
  assert.ok(names.includes('Congress') && !names.includes('Grades'), names);
  await client.close();
});

test('a file\'s Data API token isn\'t an AI app token; an older admin console token still signs in', { skip }, async () => {
  const dataApi = store.createApiToken('Ed', { label: 'Data API only', surfaces: ['fmrest'] });
  await assert.rejects(connect(dataApi));
  const older = new McpTokens(dir, undefined, (database, account) => { return store.identityAllowed(account) ? store.accountIdentityId(account) : undefined; }).create({ database: 'Charts', account: 'Clerk', label: 'older' });
  const client = await connect(older.token);
  assert.deepEqual(JSON.parse(textOf(await client.callTool({ name: 'list_databases', arguments: {} }))), ['Charts']);
  await client.close();
  const listed = (await admin('GET', '')).body.tokens.find((t: { id: string }) => t.id === older.id);
  assert.equal(listed.older, true);
});

test('a new AI agent from the page: never [Full Access], and its changes wait for a person to approve them', { skip }, async () => {
  const full = await admin('POST', '/tokens', { database: 'Charts', agent: { name: 'Claude', privilegeSet: '[Full Access]' } });
  assert.equal(full.status, 400);
  assert.match(full.body.error, /Full Access/);
  const made = await admin('POST', '/tokens', { database: 'Charts', agent: { name: 'Claude', privilegeSet: 'Editor', needsApproval: true }, label: 'Claude Desktop' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.account, 'Claude');
  const agent = (await admin('GET', '')).body.files.find((f: { name: string }) => f.name === 'Charts').accounts.find((a: { name: string }) => a.name === 'Claude');
  assert.equal(agent.agent, true);
  const client = await connect(made.body.token);
  const found = JSON.parse(textOf(await client.callTool({ name: 'find_records', arguments: { database: 'Charts', layout: 'Congress', limit: 1 } })));
  const { recordId, fieldData } = found.records[0];
  const r = JSON.parse(textOf(await client.callTool({ name: 'update_record', arguments: { database: 'Charts', layout: 'Congress', recordId, fieldData: { Party: 'Q' } } })));
  assert.equal(r.status, 'pending_approval');
  assert.equal(store.get('Congress', Number(recordId)).fieldData.Party, fieldData.Party, 'nothing changed yet');
  await client.close();
});

test('resources and prompts for common jobs', { skip }, async () => {
  const made = await admin('POST', '/tokens', { database: 'Charts', account: 'Ed' });
  const client = await connect(made.body.token);
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === 'tabularius://Charts/schema'), JSON.stringify(resources));
  const schema = await client.readResource({ uri: 'tabularius://Charts/schema' });
  assert.ok(JSON.parse((schema.contents[0] as { text: string }).text).tables.length > 0);
  const { prompts } = await client.listPrompts();
  for (const name of ['after_converting', 'clean_up_data', 'what_would_break', 'suggest_rules', 'make_dashboard', 'explain_solution']) assert.ok(prompts.some((p) => p.name === name), name);
  const prompt = await client.getPrompt({ name: 'after_converting', arguments: { database: 'Charts' } });
  assert.match((prompt.messages[0].content as { text: string }).text, /conversion_guide/);
  await client.close();

  // A limited token gets the schema, not the design.
  const limited = await connect((await admin('POST', '/tokens', { database: 'Charts', account: 'Ed', readOnly: true })).body.token);
  const listed = (await limited.listResources()).resources.map((r) => r.uri);
  assert.ok(listed.includes('tabularius://Charts/schema') && !listed.includes('tabularius://Charts/overview'), JSON.stringify(listed));
  await assert.rejects(limited.readResource({ uri: 'tabularius://Charts/conversion-guide' }));
  await limited.close();
});
