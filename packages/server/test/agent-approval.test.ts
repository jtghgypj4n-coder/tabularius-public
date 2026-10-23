// Approval-gated agents over the wire: an MCP client's write comes back as a
// pending proposal (not an error), the security API lists it and a full-access
// human approves or rejects it; approval applies it tagged as the agent.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-agent-approval-srv-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.get('Charts')!;
  store.setPassword('Admin', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
  store.savePrivilegeSet({
    name: 'Bot', records: { view: true, edit: true, create: true, delete: true },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'],
  });
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
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

test('a gated agent MCP write is queued, listed, and approved over the API', { skip }, async () => {
  const tok = await adminToken();
  // Create the agent, set to need approval, through Manage Security.
  const made = await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'setAgentAccount', name: 'q-bot', privilegeSet: 'Bot', needsApproval: true }] }) });
  assert.equal(made.status, 200);
  assert.equal((await made.json()).accounts.find((a: { name: string }) => a.name === 'q-bot').needsApproval, true);

  const minted = new McpTokens(dir, undefined, (database, account) => { const s = host.get(database); return s?.identityAllowed(account) ? s.accountIdentityId(account) : undefined; }).create({ database: 'Charts', account: 'q-bot', label: 'test' });
  const store = host.get('Charts')!;
  const createsBefore = store.auditLog({ agent: true, limit: 1000 }).filter((e) => e.kind === 'create').length;

  // The MCP write is accepted-but-pending, not an error.
  const res = await mcpTool('create_record', { database: 'Charts', layout: 'Congress', fieldData: { Name: 'queued' } }, minted.token);
  assert.equal(res.isError, false, res.text);
  const payload = JSON.parse(res.text);
  assert.equal(payload.status, 'pending_approval');
  assert.ok(payload.pendingId);
  assert.equal(store.auditLog({ agent: true, limit: 1000 }).filter((e) => e.kind === 'create').length, createsBefore, 'nothing created yet');

  // The security view lists the proposal.
  const listed = await (await sec(tok)).json();
  const mine = listed.pendingChanges.find((c: { id: number }) => c.id === payload.pendingId);
  assert.ok(mine, 'proposal listed');
  assert.equal(mine.agent, 'q-bot');

  // Approve it; it applies, tagged as the agent, and leaves the queue.
  const approved = await sec(tok, `/pending/${payload.pendingId}/approve`, { method: 'POST' });
  assert.equal(approved.status, 200);
  const after = await approved.json();
  assert.ok(after.recordId, 'a record id came back');
  assert.equal(after.security.pendingChanges.length, 0);
  assert.ok(store.auditLog({ agent: true, limit: 1000 }).some((e) => e.kind === 'create' && e.account === 'q-bot' && e.recordId === after.recordId));
  host.get('Charts')!.deleteAccount('q-bot');
});

test('a gated agent MCP write can be rejected over the API', { skip }, async () => {
  const tok = await adminToken();
  await sec(tok, '', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'setAgentAccount', name: 'r-bot', privilegeSet: 'Bot', needsApproval: true }] }) });
  const minted = new McpTokens(dir, undefined, (database, account) => { const s = host.get(database); return s?.identityAllowed(account) ? s.accountIdentityId(account) : undefined; }).create({ database: 'Charts', account: 'r-bot', label: 'test' });

  const res = await mcpTool('delete_record', { database: 'Charts', layout: 'Congress', recordId: 1 }, minted.token);
  assert.equal(res.isError, false, res.text);
  const { pendingId } = JSON.parse(res.text);
  assert.ok(pendingId);

  const rejected = await sec(tok, `/pending/${pendingId}/reject`, { method: 'POST' });
  assert.equal(rejected.status, 200);
  const body = await rejected.json();
  assert.equal(body.rejected, true);
  assert.equal(body.security.pendingChanges.some((c: { id: number }) => c.id === pendingId), false);
  host.get('Charts')!.deleteAccount('r-bot');
});

test('rejecting an unknown pending id is a 404', { skip }, async () => {
  const tok = await adminToken();
  const r = await sec(tok, '/pending/999999/reject', { method: 'POST' });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).rejected, false);
});
