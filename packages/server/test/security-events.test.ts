// The admin console's dedicated security event log: sign-ins, lockouts and every
// change to accounts, privileges, tokens, agents and schema, grouped and said in
// plain English, with group/account/date filters and a CSV export — separate
// from the record-change audit log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-security-events-srv-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw', full.name);
  // Make a few events to show: a success, a failure, and an agent added.
  await login('pw');
  await login('nope');
  store.savePrivilegeSet({ name: 'Bot', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  store.setAgentAccount('bot', 'Bot', { needsApproval: true });
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function login(password: string): Promise<number> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa(`Admin:${password}`) }, body: '{}',
  });
  return r.status;
}

interface Ev { kind: string; category: string; description: string; severity: string; account: string | null; from?: string; target?: string; security?: boolean }

test('the security-events endpoint returns grouped, described events and the group list', { skip }, async () => {
  const r = await fetch(`${base}/tabularius/admin/v1/security-events?database=Charts`);
  assert.equal(r.status, 200);
  const body = await r.json() as { database: string; categories: string[]; events: Ev[] };
  assert.equal(body.database, 'Charts');
  assert.ok(body.categories.includes('Sign-in') && body.categories.includes('AI agents'));
  assert.ok(body.events.length >= 3);
  assert.ok(body.events.every((e) => e.security === true), 'only security entries');
  assert.ok(body.events.every((e) => e.description && e.category && e.severity), 'each event is described, grouped and rated');
  const failed = body.events.find((e) => e.kind === 'sign-in-failed');
  assert.ok(failed && failed.severity === 'alert' && failed.description === 'Sign-in failed');
  const agent = body.events.find((e) => e.kind === 'agent-added');
  assert.ok(agent && agent.description === 'AI agent bot added (its changes need approval)');
});

test('the endpoint filters by category', { skip }, async () => {
  const r = await fetch(`${base}/tabularius/admin/v1/security-events?database=Charts&category=Sign-in`);
  const { events } = await r.json() as { events: Ev[] };
  assert.ok(events.length >= 2);
  assert.ok(events.every((e) => e.category === 'Sign-in'));
  assert.ok(!events.some((e) => e.kind === 'agent-added'), 'other groups are excluded');
});

test('the endpoint exports CSV with a description column', { skip }, async () => {
  host.get('Charts')!.setExternalAccount('\t=1+1', '[Read-Only Access]');
  const r = await fetch(`${base}/tabularius/admin/v1/security-events?database=Charts&format=csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="security-events-Charts\.csv"/);
  const lines = (await r.text()).trim().split('\r\n');
  assert.equal(lines[0], 'seq,at,category,kind,severity,account,description,target,from,detail');
  assert.ok(lines.some((l) => l.includes('Sign-in failed')), 'a described row is present');
  assert.ok(lines.some((l) => l.includes(",\\u{0009}=1+1,")), 'a tab-prefixed formula target is neutralized');
  for (const l of lines.slice(1)) assert.ok(/^\d+,/.test(l), 'each row starts with its sequence number');
});

test('the endpoint rejects a request without a known database', { skip }, async () => {
  assert.equal((await fetch(`${base}/tabularius/admin/v1/security-events`)).status, 400);
  assert.equal((await fetch(`${base}/tabularius/admin/v1/security-events?database=Nope`)).status, 400);
});
