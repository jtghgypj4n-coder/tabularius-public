// The "ask about access" MCP tools: explain_access grounds a plain-English
// answer in a set's real rules, and preview_privilege_set validates a proposed
// set and returns a diff for a human to apply — neither reads past the account's
// own reach, and neither ever changes the file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-access-mcp-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;

  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.setPassword('Admin', 'pw', full.name);

  // A restricted set that may use AI: sees only Democrats, never edits.
  store.savePrivilegeSet({
    name: 'Clerk',
    records: { view: false, edit: false, create: false, delete: false },
    tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'],
  });
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function tool(name: string, args: unknown, auth?: string): Promise<{ isError: boolean; data: any; text: string }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      ...(auth ? { authorization: 'Basic ' + btoa(auth) } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  const result = body.result ?? { isError: true, content: [{ text: JSON.stringify(body.error ?? body) }] };
  const text: string = result.content?.[0]?.text ?? '';
  let data: any;
  try { data = JSON.parse(text); } catch { data = undefined; }
  return { isError: !!result.isError, data, text };
}

test('explain_access reports a set\'s real rules, citing the exact calculation', { skip }, async () => {
  const r = await tool('explain_access', { database: 'Charts', privilegeSet: 'Clerk' }, 'Admin:pw');
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.privilegeSet, 'Clerk');
  const congress = r.data.tables.find((t: any) => t.table === 'Congress');
  assert.deepEqual(congress.view, { allowed: 'limited', rule: 'Party = "D"' }, 'the per-record rule comes back verbatim');
  assert.deepEqual(congress.edit, { allowed: false });
});

test('explain_access defaults to the caller\'s own set', { skip }, async () => {
  const r = await tool('explain_access', { database: 'Charts' }, 'Clerk:pw');
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.privilegeSet, 'Clerk');
});

test('a restricted account cannot explain another set', { skip }, async () => {
  const r = await tool('explain_access', { database: 'Charts', privilegeSet: '[Full Access]' }, 'Clerk:pw');
  assert.equal(r.isError, true, 'the clerk may only look at its own set');
  assert.match(r.text, /its own access|Insufficient privileges/i);
});

test('preview_privilege_set returns a validated diff and saves nothing', { skip }, async () => {
  const proposed = {
    name: 'Clerk',
    records: { view: true, edit: true, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'],
  };
  const r = await tool('preview_privilege_set', { database: 'Charts', proposed, base: 'Clerk' }, 'Admin:pw');
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.valid, true);
  assert.ok(r.data.changes.some((c: any) => c.area === 'records'), 'the record rule change is shown');
  // The real set is untouched: it still cannot edit.
  assert.equal(store.privilegeSet('Clerk')!.records.edit, false, 'preview never applies the change');
});

test('preview_privilege_set rejects an invalid proposal', { skip }, async () => {
  const r = await tool('preview_privilege_set', { database: 'Charts', proposed: { name: 'X', records: { view: 'maybe' } } }, 'Admin:pw');
  assert.equal(r.isError, true, 'a bad definition is refused, not saved');
});

test('a non-full account cannot propose privilege sets', { skip }, async () => {
  const proposed = { name: 'New', records: { view: true, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] };
  const r = await tool('preview_privilege_set', { database: 'Charts', proposed }, 'Clerk:pw');
  assert.equal(r.isError, true, 'proposing sets is an administrative activity');
  assert.match(r.text, /can't propose|Insufficient privileges/i);
});

test('who_can_access lists who can see a table, for full access only', { skip }, async () => {
  const r = await tool('who_can_access', { database: 'Charts', table: 'Congress' }, 'Admin:pw');
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.table, 'Congress');
  const clerk = r.data.sets.find((s: any) => s.privilegeSet === 'Clerk');
  assert.equal(clerk.view, 'some records', 'Clerk\'s record rule limits the rows');
  assert.equal(clerk.edit, 'no');
  assert.match(r.data.summary, /Clerk \(/);
  // A restricted account can't list everyone's access.
  const denied = await tool('who_can_access', { database: 'Charts', table: 'Congress' }, 'Clerk:pw');
  assert.equal(denied.isError, true);
  assert.match(denied.text, /Insufficient privileges/);
});
