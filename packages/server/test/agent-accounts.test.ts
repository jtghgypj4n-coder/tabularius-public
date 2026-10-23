// AI agent accounts over the wire: created through Manage Security (the server
// stamps the creator), never [Full Access], and an MCP client signing in with a
// token minted for the agent has its writes tagged as the agent in the audit log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { McpTokens } from '../src/mcp-tokens.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-agent-srv-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.setPassword('Admin', 'pw', full.name);
  // A non-full set an agent can hold: read/write Congress and use the AI tools.
  store.savePrivilegeSet({
    name: 'Bot', records: { view: true, edit: true, create: true, delete: true },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'],
  });
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function adminToken(): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}',
  });
  return (await r.json()).response.token;
}
const sec = (tok: string, path = '', init: RequestInit = {}) =>
  fetch(`${base}/tabularius/security/v1/databases/Charts${path}`, {
    ...init, headers: { authorization: `Bearer ${tok}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });

async function mcpTool(name: string, args: unknown, bearer: string): Promise<{ isError: boolean; text: string }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  const result = body.result ?? { isError: true, content: [{ text: JSON.stringify(body.error ?? body) }] };
  return { isError: !!result.isError, text: result.content?.[0]?.text ?? '' };
}

test('Manage Security creates an agent and stamps the signed-in creator', { skip }, async () => {
  const tok = await adminToken();
  const r = await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'setAgentAccount', name: 'srv-bot', privilegeSet: 'Bot', createdBy: 'not-me' }] }) });
  assert.equal(r.status, 200);
  const body = await r.json();
  const bot = body.accounts.find((a: { name: string }) => a.name === 'srv-bot');
  assert.ok(bot, 'agent listed');
  assert.equal(bot.agent, true);
  assert.equal(bot.hasPassword, false);
  // The server overrides any client-supplied createdBy with the real signed-in account.
  assert.equal(bot.createdBy, 'Admin');
  host.get('Charts')!.deleteAccount('srv-bot');
});

test('an agent cannot be created with [Full Access] over the API', { skip }, async () => {
  const tok = await adminToken();
  const full = host.get('Charts')!.privilegeSets().find((p) => p.id === 1)!.name;
  const r = await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'setAgentAccount', name: 'nope-bot', privilegeSet: full }] }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error.message, /Full Access/);
  assert.equal(host.get('Charts')!.accounts().some((a) => a.name === 'nope-bot'), false);
});

test('an MCP token for an agent works and its writes are tagged as the agent', { skip }, async () => {
  const store = host.get('Charts')!;
  store.setAgentAccount('mcp-bot', 'Bot', { createdBy: 'Admin' });
  // Mint an MCP token for the agent (same tokens file the server reads).
  const minted = new McpTokens(dir, undefined, (database, account) => { const s = host.get(database); return s?.identityAllowed(account) ? s.accountIdentityId(account) : undefined; }).create({ database: 'Charts', account: 'mcp-bot', label: 'test' });

  const before = store.auditLog({ agent: true, limit: 1000 }).length;
  const res = await mcpTool('create_record', { database: 'Charts', layout: 'Congress', fieldData: { Name: 'via agent token' } }, minted.token);
  assert.equal(res.isError, false, res.text);

  const agentEntries = store.auditLog({ agent: true, limit: 1000 });
  assert.ok(agentEntries.length > before, 'a new agent-tagged entry');
  const created = agentEntries.find((e) => e.kind === 'create' && e.account === 'mcp-bot');
  assert.ok(created, 'the agent create is tagged to the agent account');

  // A forged/absent agent (deleted) can no longer use its token.
  store.deleteAccount('mcp-bot');
  const after = await mcpTool('create_record', { database: 'Charts', layout: 'Congress', fieldData: { Name: 'should fail' } }, minted.token);
  assert.equal(after.isError, true, 'a token for a deleted agent is refused');
});
