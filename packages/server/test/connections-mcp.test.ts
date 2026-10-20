// The AI drafts a connection from a sentence; a person adds the keys and approves it. The AI is never given a place
// to put a key, can't approve, change or use a connection, and a setting that looks like a key is refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import type { PrivilegeDefinition } from '../../store/src/index.ts';
import { setCaptureOnlyDefaults } from '../../scripts/src/index.ts';
// The process names its capture-only files; here, every file that starts with Held.
setCaptureOnlyDefaults(['Held']);

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const KEYS = { accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
let dir: string;
let server: Server;
let base: string;
let host: Host;
const logs: string[] = [];

const NONE = { view: false, edit: false, create: false, delete: false } as const;
const clerk: PrivilegeDefinition = { name: 'Clerk', records: NONE, tables: { Congress: { view: true, edit: false, create: false, delete: false } }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'] };

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-connections-mcp-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  // A capture-only file (named so by the process) hosted beside it.
  copyFileSync(fixture, join(dir, 'Held_Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: (m: string) => logs.push(m) });
  server = s.server;
  base = s.url;
  host = s.host;
  for (const name of ['Charts', 'Held_Charts']) {
    const store = host.get(name)!;
    store.savePrivilegeSet(clerk);
    store.setPassword('Clerk', 'pw', 'Clerk');
    store.setPassword('Admin', 'pw');
  }
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

let n = 0;
async function rpc(account: string, method: string, params: Record<string, unknown>) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Basic ' + btoa(`${account}:pw`) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }),
  });
  return res.json() as Promise<any>;
}
async function mcp(account: string, name: string, args: Record<string, unknown>, database = 'Charts'): Promise<{ error: boolean; text: string; data: any }> {
  const body = await rpc(account, 'tools/call', { name, arguments: { database, ...args } });
  const result = body.result ?? { isError: true, content: [{ text: JSON.stringify(body.error) }] };
  const text = result.content[0].text as string;
  let data: any;
  try { data = JSON.parse(text); } catch { data = undefined; }
  return { error: !!result.isError, text, data };
}
const admin = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/tabularius/admin/v1${path}`, { method, headers: { 'x-tabularius-admin': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

test('the AI drafts a connection from a sentence, limited to the file, and it does nothing until a person adds the keys and approves it', { skip }, async () => {
  const drafted = await mcp('Admin', 'draft_connection', { name: 'invoices-bucket', type: 's3', config: { bucket: 'acme-invoices', region: 'us-east-1', prefix: 'tabularius' }, note: 'Scanned invoices' });
  assert.equal(drafted.error, false, drafted.text);
  assert.equal(drafted.data.drafted, true);
  assert.equal(drafted.data.status, 'draft');
  assert.match(drafted.data.next, /A person has to open the admin console/);

  const made = host.connections!.get('invoices-bucket');
  assert.equal(made.status, 'draft');
  assert.equal(made.createdBy, 'ai');
  assert.deepEqual(made.files, ['Charts']);
  assert.equal(made.ready, false);
  // Not usable: the draft needs keys and a person's approval.
  assert.throws(() => host.connections!.use('invoices-bucket', ['Charts']), /not been approved at the console/);
  assert.match(logs.join('\n'), /connection invoices-bucket \(s3\) created as a draft by the AI/);

  // The console shows it as the AI's, waiting.
  const listed = (await admin('GET', '/connections')).body.connections.find((c: { name: string }) => c.name === 'invoices-bucket');
  assert.equal(listed.createdBy, 'ai');
  assert.equal((await admin('POST', `/connections/${listed.id}/approve`)).status, 400);

  // A person puts the keys in and approves; the AI's view then says only that they are set.
  await admin('PUT', `/connections/${listed.id}/secrets/accessKey`, { value: KEYS.accessKey });
  await admin('PUT', `/connections/${listed.id}/secrets/secretKey`, { value: KEYS.secretKey });
  assert.equal((await admin('POST', `/connections/${listed.id}/approve`)).body.status, 'active');
  const seen = await mcp('Admin', 'list_connections', {});
  assert.equal(seen.error, false, seen.text);
  const c = seen.data.connections.find((x: { name: string }) => x.name === 'invoices-bucket');
  assert.equal(c.status, 'active');
  assert.deepEqual(c.secrets, [{ name: 'accessKey', set: true }, { name: 'secretKey', set: true }, { name: 'sessionToken', set: false }]);
  for (const secret of Object.values(KEYS)) assert.ok(!seen.text.includes(secret));
  assert.ok(seen.data.types.some((t: { id: string }) => t.id === 's3'));
});

test('a key offered as a setting is refused, and the AI has no tool to set a key, approve, change or use a connection', { skip }, async () => {
  for (const config of [{ bucket: 'b-bucket', prefix: KEYS.accessKey }, { bucket: 'b-bucket', region: KEYS.secretKey }, { bucket: 'b-bucket', secretKey: 'abc' }, { bucket: 'b-bucket', endpoint: 'http://169.254.169.254' }]) {
    const r = await mcp('Admin', 'draft_connection', { name: 'bad', type: 's3', config });
    assert.equal(r.error, true, JSON.stringify(config));
  }
  assert.throws(() => host.connections!.get('bad'), /no connection/);
  const tools = (await rpc('Admin', 'tools/list', {})).result.tools.map((t: { name: string }) => t.name).filter((x: string) => /connection|secret|credential/i.test(x));
  assert.deepEqual(tools.sort(), ['draft_connection', 'list_connections']);
  // The tool's own words tell the model to keep keys out of chat.
  const draft = (await rpc('Admin', 'tools/list', {})).result.tools.find((t: { name: string }) => t.name === 'draft_connection');
  assert.match(draft.description, /never see, ask for, accept or invent keys/i);
  assert.equal(JSON.stringify(draft.inputSchema).match(/secret|password|accessKey/gi)?.length ?? 0, 1, 'only the config description names them, to say never');
});

test('only [Full Access] drafts or lists connections; a capture-only file gets none; drafts waiting are capped', { skip }, async () => {
  for (const name of ['list_connections', 'draft_connection']) {
    const r = await mcp('Clerk', name, { name: 'x-bucket', type: 's3', config: { bucket: 'x-bucket' } });
    assert.equal(r.error, true, name);
    assert.match(r.text, /need \[Full Access\]/, name);
  }
  assert.throws(() => host.connections!.get('x-bucket'), /no connection/);

  const held = await mcp('Admin', 'draft_connection', { name: 'held', type: 's3', config: { bucket: 'x-bucket' } }, 'Held_Charts');
  assert.equal(held.error, true);
  assert.match(held.text, /capture-only/);
  assert.throws(() => host.connections!.get('held'), /no connection/);

  let made = 0;
  for (let i = 0; i < 12; i++) {
    const r = await mcp('Admin', 'draft_connection', { name: `d${i}`, type: 's3', config: { bucket: 'x-bucket' } });
    if (!r.error) made++;
    else assert.match(r.text, /already 10 drafts waiting/);
  }
  // invoices-bucket was approved above, so it isn't waiting: ten new drafts, then the cap.
  assert.equal(made, 10);
  assert.equal(host.connections!.list().filter((c) => c.status === 'draft' && c.createdBy === 'ai').length, 10);
});
