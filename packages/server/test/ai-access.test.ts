// AI turned off for a file: nothing in it reaches AI apps (MCP), the assistant (a stand-in for the Messages API here)
// or digests' summaries, for any account, the local administrator included; the file's security log says when it
// was turned off and when AI was refused; the server can keep files from AI with --ai-exclude.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Store } from '../../store/src/index.ts';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore } from '../../store/src/index.ts';
import { serve, Host } from '../src/index.ts';
import { createMcpServer, type McpIdentity } from '../src/mcp.ts';
import { aiBlocker, aiStatus, excludeFromAi } from '../src/ai-access.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let model: Server;
let base: string;
let store: Store;
let host: Host;
let summarize: (account: string) => Promise<{ summary?: string; note?: string }>;
let asked = 0;

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    asked++;
    req.resume();
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })));
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-access-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  host = s.host;
  store = s.host.get('Charts')!;
  const set = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'Admin-pw-123456');
  const { Assistant } = await import('../src/assistant.ts');
  const assistant = new Assistant(s.host, undefined as never, { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` });
  summarize = (account) => assistant.summarize(store, account, store.privileges(account), 'How many members?');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const mcp = async (method: string, params: Record<string, unknown> = {}) => (await (await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
})).json()).result;
const tool = (name: string, args: Record<string, unknown>) => mcp('tools/call', { name, arguments: args });
const admin = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}/tabularius/admin/v1${path}`, { method, headers: method === 'GET' ? {} : { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
};

test('turned off: every MCP tool refuses the file, the local administrator included, and the log says so once', { skip }, async () => {
  assert.deepEqual(JSON.parse((await tool('list_databases', {})).content[0].text), ['Charts']);
  const off = await admin('POST', '/ai-access/Charts', { on: false });
  assert.equal(off.status, 200);
  assert.deepEqual(off.body, { allowed: false, turnedOff: true, byServer: false });
  assert.deepEqual(JSON.parse((await tool('list_databases', {})).content[0].text), [], 'not even listed');
  for (const [name, args] of [
    ['find_records', { database: 'Charts', layout: 'Congress', limit: 1 }],
    ['describe_database', { database: 'Charts' }],
    ['sql_query', { database: 'Charts', sql: 'SELECT 1' }],
    ['get_design', { database: 'Charts' }],
    ['explain_solution', { database: 'Charts' }],
    ['compare_solutions', { from: 'Charts', to: 'Charts' }],
  ] as const) {
    const r = await tool(name, args);
    assert.equal(r.isError, true, name);
    assert.match(r.content[0].text, /AI is turned off for Charts: its data is never sent to AI apps or the AI assistant/, name);
  }
  assert.deepEqual((await mcp('resources/list')).resources, [], 'no resources for it either');
  const read = await (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'tabularius://Charts/schema' } }),
  })).json();
  assert.match(read.error.message, /AI is turned off for Charts/);
  const refused = store.securityEvents({ kind: 'ai-access-refused' });
  assert.ok(refused.length >= 1 && refused.length <= 7, String(refused.length));
  const again = store.securityEvents({ kind: 'ai-access-refused' }).length;
  await tool('find_records', { database: 'Charts', layout: 'Congress', limit: 1 });
  assert.equal(store.securityEvents({ kind: 'ai-access-refused' }).length, again, 'the same client retrying is logged once');
  assert.equal(store.securityEvents({ kind: 'ai-turned-off' }).length, 1);
  assert.equal(store.securityEvents({ category: 'AI access' }).at(-1)?.description !== undefined, true);
});

test('turned off: the assistant isn\'t offered and sends nothing; digests get no AI summary', { skip }, async () => {
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:Admin-pw-123456') }, body: '{}',
  });
  const token = (await login.json()).response.token as string;
  const url = `${base}/tabularius/assistant/v1/databases/Charts`;
  const info = await (await fetch(url, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(info.available, false);
  assert.equal(info.aiOff, true);
  const before = asked;
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'How many members?' }] }) });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error.message, /AI is turned off for Charts/);
  const digest = await summarize('Admin');
  assert.match(digest.note!, /^No AI summary: AI is turned off for Charts/);
  assert.equal(asked, before, 'nothing went to the model');
});

test('turned on again: back for everyone, and the /admin status shows it', { skip }, async () => {
  assert.deepEqual((await admin('POST', '/ai-access/Charts', { on: true })).body, { allowed: true, turnedOff: false, byServer: false });
  assert.equal((await tool('find_records', { database: 'Charts', layout: 'Congress', limit: 1 })).isError, undefined);
  const status = await admin('GET', '/status');
  assert.deepEqual(status.body.databases.find((d: { name: string }) => d.name === 'Charts').ai, { allowed: true, turnedOff: false, byServer: false });
  assert.equal(store.securityEvents({ kind: 'ai-turned-on' }).length, 1);
  assert.equal((await admin('POST', '/ai-access/Charts', { on: 'yes' })).status, 400);
});

test('kept from AI by the server, and a file using one that is off is off too', { skip }, async () => {
  store.aiExcludedByServer = true;
  try {
    assert.deepEqual(aiStatus(store), { allowed: false, turnedOff: false, byServer: true });
    assert.match(store.aiOffMessage(), /--ai-exclude/);
  } finally {
    store.aiExcludedByServer = false;
  }
  // Stand-ins: A uses B, B uses C, C is off.
  const fake = (name: string, uses: string[], allowed = true) => ({ name, aiAllowed: allowed, schema: { dataSources: uses.map((u, i) => ({ id: i + 1, name: u, paths: [`file:${u}`] })) }, resolveFile: (n: string) => files[n] }) as unknown as Store;
  const files: Record<string, Store> = {};
  files.A = fake('A', ['B']);
  files.B = fake('B', ['C', 'A']);
  files.C = fake('C', [], false);
  assert.equal(aiBlocker(files.A)?.name, 'C');
  files.C = fake('C', []);
  assert.equal(aiBlocker(files.A), undefined, 'and loops between files end');
});

test('serve --ai-exclude keeps the named files from AI however they are set', { skip }, async () => {
  const other = mkdtempSync(join(tmpdir(), 'tabularius-ai-exclude-'));
  copyFileSync(fixture, join(other, 'Charts.fmp12'));
  const s = await serve({ dir: other, port: 0, log: () => {}, aiExclude: ['charts.fmp12'] });
  try {
    const r = await (await fetch(`${s.url}/tabularius/admin/v1/ai-access/Charts`)).json();
    assert.deepEqual(r, { allowed: false, turnedOff: false, byServer: true });
  } finally {
    // Closed (background warming stopped, files closed) before the folder is removed: it may still be writing there.
    await new Promise<void>((r) => s.server.close(() => r()));
    // The server's close starts the files closing without waiting for the warming thread; wait for it here.
    await s.host.close();
    rmSync(other, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

/** A tool call through an in-process MCP client signed in as `who`. */
async function callAs(who: McpIdentity, name: string, args: Record<string, unknown>) {
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(host, who).connect(b);
  await client.connect(a);
  try {
    return await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] };
  } finally {
    await client.close();
  }
}

test('turned off: a wrong password is a failed sign-in, not a refusal under whatever name the caller sent', { skip }, async () => {
  store.setAiAllowed(false);
  try {
    const refusals = () => store.securityEvents({ kind: 'ai-access-refused' });
    const before = refusals().length;
    for (let i = 0; i < 3; i++) {
      for (const [name, args] of [['find_records', { database: 'Charts', layout: 'Congress', limit: 1 }], ['compare_solutions', { from: 'Charts', to: 'Charts' }]] as const) {
        const r = await callAs({ account: `made-up-${i}`, password: 'wrong', from: '10.0.0.9' }, name, args);
        assert.equal(r.isError, true);
        assert.match(r.content[0].text, /Invalid account or password/);
      }
    }
    // Each wrong password counts once toward lockout (five locks the account), however many files the tool names.
    for (let i = 0; i < 5; i++) {
      assert.ok(!store.lockedOut('Admin', '10.0.0.9'), `locked after ${i} wrong passwords`);
      const wrongAdmin = await callAs({ account: 'Admin', password: `wrong-${i}`, from: '10.0.0.9' }, 'compare_solutions', { from: 'Charts', to: 'Charts' });
      assert.match(wrongAdmin.content[0].text, /Invalid account or password/);
    }
    assert.ok(store.lockedOut('Admin', '10.0.0.9'), 'wrong passwords count toward lockout');
    store.unlock('Admin');
    assert.equal(refusals().length, before, 'nothing logged as refused for callers who never signed in');
    // An account without AI access (fmmcp) is told so, and isn't logged as refused either.
    const plain = store.privilegeSets().find((p) => p.name === '[Read-Only Access]')!;
    store.setPassword('Reader', 'Reader-pw-123456', plain.name);
    const reader = await callAs({ account: 'Reader', password: 'Reader-pw-123456' }, 'describe_database', { database: 'Charts' });
    assert.match(reader.content[0].text, /needs the fmmcp extended privilege/);
    assert.equal(refusals().length, before);
    // The right password: refused because AI is off, and logged under the account that really asked.
    const right = await callAs({ account: 'Admin', password: 'Admin-pw-123456', from: '10.0.0.8' }, 'describe_database', { database: 'Charts' });
    assert.match(right.content[0].text, /AI is turned off for Charts/);
    assert.equal(refusals().at(-1)?.account, 'Admin');
    // A session signed in to another file gets the scope error, and Charts' log hears nothing.
    const other = await callAs({ account: 'Admin', database: 'Elsewhere' }, 'find_records', { database: 'Charts', layout: 'Congress', limit: 1 });
    assert.match(other.content[0].text, /signed in to Elsewhere only/);
    assert.equal(refusals().at(-1)?.account, 'Admin');
  } finally {
    store.setAiAllowed(true);
  }
});

test("the refusal log's retry memory stays small whatever names callers use", { skip }, () => {
  for (let i = 0; i < 2000; i++) store.refuseAi({ account: `name-${i}`, via: 'test' });
  assert.ok((store as unknown as { aiRefusals: Map<string, number> }).aiRefusals.size <= 500);
});

test('turned off mid-question: the assistant stops before sending anything more', { skip }, async () => {
  const bodies: string[] = [];
  const stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      bodies.push(raw);
      // While the model is answering the first time, an administrator turns AI off.
      store.setAiAllowed(false);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(bodies.length === 1
        ? { content: [{ type: 'tool_use', id: 't1', name: 'find_records', input: { database: 'Charts', layout: 'Congress', limit: 5 } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }
        : { content: [{ type: 'text', text: 'too late' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  try {
    const { Assistant } = await import('../src/assistant.ts');
    const assistant = new Assistant(host, undefined as never, { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(stub.address() as { port: number }).port}` });
    const out = await assistant.chat(store, 'Admin', [{ role: 'user', content: 'Who are the members?' }], {} as never, store.privileges('Admin'));
    assert.equal(bodies.length, 1, 'no second call to the model');
    assert.match(out.reply, /^I stopped there: AI is turned off for Charts/);
  } finally {
    stub.close();
    store.setAiAllowed(true);
  }
});

test('a file with AI off is not named when an AI app asks for one that isn\'t hosted', { skip }, async () => {
  const unknown = async () => (await tool('find_records', { database: 'Nope', layout: 'Congress' })).content[0].text as string;
  assert.match(await unknown(), /No hosted database named "Nope"\. Hosted: Charts/);
  store.setAiAllowed(false);
  try {
    const text = await unknown();
    assert.match(text, /Hosted: \(none\)/);
    assert.doesNotMatch(text, /Charts/);
    assert.doesNotMatch((await tool('compare_solutions', { from: 'Nope', to: 'Charts' })).content[0].text, /Hosted: .*Charts/);
  } finally {
    store.setAiAllowed(true);
  }
});

test('tabularius mcp and tabularius ai status honour --ai-exclude, and a status check opens nothing else', { skip }, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-ai-cli-'));
  try {
    createStore(join(folder, 'Shop.openhbam.sqlite'));
    const h = new Host(folder);
    try {
      excludeFromAi(h, ['shop.fmp12']);
      assert.equal(h.get('Shop')!.aiAllowed, false, 'serveStdio and serve share this');
    } finally {
      h.close();
    }
    // A file nobody has converted yet sits beside it: a status check leaves it alone.
    copyFileSync(fixture, join(folder, 'Charts.fmp12'));
    const main = join(import.meta.dirname, '..', '..', 'cli', 'src', 'main.ts');
    const status = (env: Record<string, string>, ...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, 'ai', folder, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
    assert.match(status({}, 'Shop', 'status').stdout, /^AI is on for Shop/);
    assert.match(status({ TABULARIUS_AI_EXCLUDE: 'Shop' }, 'Shop', 'status').stdout, /^AI is off for Shop.*--ai-exclude/);
    assert.match(status({}, 'Shop', 'status', '--ai-exclude', 'Shop').stdout, /^AI is off for Shop/);
    assert.match(status({}, '--ai-exclude', 'Shop', 'Shop', 'status').stdout, /^AI is off for Shop/, 'the flag before the database too');
    assert.ok(!existsSync(join(folder, 'Charts.openhbam.sqlite')), 'nothing else converted');
    // tabularius mcp (stdio) keeps the file out of list_databases.
    const listed = (...extra: string[]) => {
      const lines = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_databases', arguments: {} } },
      ].map((m) => JSON.stringify(m)).join('\n') + '\n';
      const r = spawnSync(process.execPath, ['--no-warnings', main, 'mcp', folder, ...extra], { input: lines, encoding: 'utf8', timeout: 30_000 });
      const answer = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.id === 2);
      return JSON.parse(answer.result.content[0].text) as string[];
    };
    rmSync(join(folder, 'Charts.fmp12'));
    assert.deepEqual(listed(), ['Shop']);
    assert.deepEqual(listed('--ai-exclude', 'Shop'), []);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
