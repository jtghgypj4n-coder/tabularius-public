// Every record change is logged with where it came from: the web client, the Data API, OData, and the script that made it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { auditSurface } from '../src/audit-surface.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-surfaces-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest', 'fmapp', 'fmodata', 'fmxdbc'])] });
  store.setPassword('Admin', 'pw', full.name);
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const basic = 'Basic ' + btoa('Admin:pw');

async function token(client?: 'web'): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { authorization: basic, ...(client ? { 'x-tabularius-client': client } : {}) }, body: '{}',
  });
  return ((await r.json()) as { response: { token: string } }).response.token;
}

async function createViaDataApi(client?: 'web'): Promise<number> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records`, {
    method: 'POST', headers: { authorization: `Bearer ${await token(client)}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Name: 'Via ' + (client ?? 'rest'), State: 'Oregon' } }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return Number(((await r.json()) as { response: { recordId: string } }).response.recordId);
}

test('routes map to the surface the audit log names', () => {
  assert.equal(auditSurface('/fmi/data/vLatest/databases/X/layouts/Y/records'), 'rest');
  assert.equal(auditSurface('/fmi/odata/v4/X/Y'), 'odata');
  assert.equal(auditSurface('/mcp'), 'mcp');
  assert.equal(auditSurface('/tabularius/admin/v1/records/restore'), 'admin');
  assert.equal(auditSurface('/tabularius/health'), undefined);
});

test('the Data API and the web client are told apart by how the session signed in', { skip }, async () => {
  const rest = await createViaDataApi();
  const web = await createViaDataApi('web');
  assert.equal(store.auditLog({ table: 'Congress', recordId: rest })[0].surface, 'rest');
  assert.equal(store.auditLog({ table: 'Congress', recordId: web })[0].surface, 'web');
});

test('an OData write is logged as odata', { skip }, async () => {
  const r = await fetch(`${base}/fmi/odata/v4/Charts/Congress`, {
    method: 'POST', headers: { authorization: basic, 'content-type': 'application/json' }, body: JSON.stringify({ Name: 'Via OData', State: 'Utah' }),
  });
  assert.ok(r.status === 201 || r.status === 200, await r.clone().text());
  const entry = store.auditLog({ table: 'Congress', surface: 'odata' }).at(-1);
  assert.equal(entry?.changes?.Name, 'Via OData');
});

test('the audit endpoints filter by surface, and the settings keep fields out of the log', { skip }, async () => {
  const rows = (await (await fetch(`${base}/tabularius/admin/v1/audit?database=Charts&surface=web`)).json() as { audit: { surface?: string }[] }).audit;
  assert.ok(rows.length >= 1 && rows.every((e) => e.surface === 'web'));
  const put = await fetch(`${base}/tabularius/admin/v1/audit/settings?database=Charts`, {
    method: 'PUT', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ excludeFields: { Congress: ['State'] } }),
  });
  assert.equal(put.status, 200);
  assert.deepEqual(((await put.json()) as { excludeFields: unknown }).excludeFields, { Congress: ['State'] });
  const id = await createViaDataApi();
  assert.equal(store.auditLog({ table: 'Congress', recordId: id })[0].changes!.State, '‹not logged›');
  const bad = await fetch(`${base}/tabularius/admin/v1/audit/settings?database=Charts`, {
    method: 'PUT', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ excludeFields: { Congress: ['Nope'] } }),
  });
  assert.equal(bad.status, 400);
  const got = await (await fetch(`${base}/tabularius/admin/v1/audit/settings?database=Charts`)).json() as { redactSensitive: boolean };
  assert.equal(got.redactSensitive, false);
});

test('the chain over record entries checks out through the admin API, and retention is a setting', { skip }, async () => {
  const v = await (await fetch(`${base}/tabularius/admin/v1/audit/verify?database=Charts`)).json() as { status: string; checked: number; head: { hash: string } };
  assert.equal(v.status, 'consistent');
  assert.ok(v.checked >= 4);
  assert.equal(v.head.hash.length, 64);
  const put = await fetch(`${base}/tabularius/admin/v1/audit/settings?database=Charts`, {
    method: 'PUT', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ retentionDays: 365 }),
  });
  assert.equal(((await put.json()) as { retentionDays: number }).retentionDays, 365);
  const bad = await fetch(`${base}/tabularius/admin/v1/audit/settings?database=Charts`, {
    method: 'PUT', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ retentionDays: 1.5 }),
  });
  assert.equal(bad.status, 400);
});

test('the web client reads a record\'s history and puts a change back, within the account\'s privileges', { skip }, async () => {
  const id = await createViaDataApi('web');
  const bearer = `Bearer ${await token('web')}`;
  const post = (what: string, body: unknown, auth = bearer) => fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress/${what}`, {
    method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const patch = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records/${id}`, {
    method: 'PATCH', headers: { authorization: bearer, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Name: 'Renamed' } }),
  });
  assert.equal(patch.status, 200);
  const h = await (await post('history', { recordId: id })).json() as { exists: boolean; events: { kind: string; surface?: string; seqs: number[]; changes: { field: string; from?: unknown; to?: unknown; seq: number }[] }[] };
  assert.equal(h.exists, true);
  assert.deepEqual(h.events.map((e) => [e.kind, e.surface]), [['changed', 'web'], ['created', 'web']]);
  const name = h.events[0].changes.find((c) => c.field === 'Name')!;
  assert.deepEqual([name.from, name.to], [`Via web`, 'Renamed']);

  // A read-only token can see the history but not put anything back.
  const readOnly = `Bearer ${store.createApiToken('Admin', { readOnly: true })}`;
  assert.equal((await post('history', { recordId: id }, readOnly)).status, 200);
  const refused = await post('revert', { recordId: id, seq: name.seq, fields: ['Name'] }, readOnly);
  assert.equal(refused.status, 400, await refused.clone().text());
  assert.equal(store.get('Congress', id, 'iso').fieldData.Name, 'Renamed');

  const ok = await post('revert', { recordId: id, seq: name.seq, fields: ['Name'] });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { action: 'updated', fields: ['Name'], skipped: [] });
  assert.equal(store.get('Congress', id, 'iso').fieldData.Name, 'Via web');
  const last = store.auditLog({ table: 'Congress', recordId: id }).at(-1)!;
  assert.deepEqual([last.surface, last.revertOf], ['web', name.seq]);
  assert.equal((await post('revert', { recordId: id, seq: 1 })).status, 400);
});

test('reads are logged only when the file asks for it, one entry per request and never the values', { skip }, async () => {
  const id = await createViaDataApi();
  const bearer = `Bearer ${await token()}`;
  const get = () => fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records/${id}`, { headers: { authorization: bearer } });
  const reads = () => store.auditLog({ kind: 'read' });
  assert.equal((await get()).status, 200);
  assert.equal(reads().length, 0, 'off by default');
  store.setAuditSettings({ logReads: true });
  assert.equal((await get()).status, 200);
  const list = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records?_limit=3`, { headers: { authorization: bearer } });
  assert.equal(list.status, 200);
  const [one, many] = reads();
  assert.deepEqual([one.account, one.surface, one.table, one.recordId, one.changes], ['Admin', 'rest', 'Congress', id, { records: 1 }]);
  assert.equal(many.recordId, undefined);
  assert.equal((many.changes as { records: number }).records, 3);
  assert.doesNotMatch(JSON.stringify(reads()), /Oregon/);
  // A read is not a change: the record's history ignores it, and the chain still checks out.
  assert.equal(store.verifyRecordAudit().status, 'consistent');
  store.setAuditSettings({ logReads: false });
});

test('with read logging on, OData and AI-tool reads are logged too, as their own surfaces', { skip }, async () => {
  const id = await createViaDataApi();
  store.setAuditSettings({ logReads: true });
  const before = store.auditLog({ kind: 'read' }).length;
  assert.equal((await fetch(`${base}/fmi/odata/v4/Charts/Congress?$top=2`, { headers: { authorization: basic } })).status, 200);
  assert.equal((await fetch(`${base}/fmi/odata/v4/Charts/Congress(${id})`, { headers: { authorization: basic } })).status, 200);
  const call = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: basic },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_record', arguments: { database: 'Charts', layout: 'Congress', recordId: id } } }),
  });
  assert.equal(call.status, 200);
  const reads = store.auditLog({ kind: 'read' }).slice(before);
  assert.deepEqual(reads.map((r) => r.surface), ['odata', 'odata', 'mcp']);
  assert.equal(reads[1].recordId, id);
  assert.equal(reads[2].recordId, id);
  store.setAuditSettings({ logReads: false });
});

test('with read logging on, SQL and the other AI read tools are logged too, and only for the tables they name', { skip }, async () => {
  const id = await createViaDataApi();
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: basic },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { database: 'Charts', ...args } } }),
    });
    assert.equal(r.status, 200);
  };
  const sql = (q: string) => fetch(`${base}/tabularius/sql/v1/databases/Charts`, { method: 'POST', headers: { authorization: basic, 'content-type': 'application/json' }, body: JSON.stringify({ sql: q }) });
  assert.equal((await sql('SELECT COUNT(*) AS n FROM Congress')).status, 200);
  assert.equal(store.auditLog({ kind: 'read' }).filter((r) => r.surface === 'sql').length, 0, 'off by default');
  store.setAuditSettings({ logReads: true });
  const before = store.auditLog({ kind: 'read' }).length;
  assert.equal((await sql(`SELECT Name FROM Congress WHERE State = 'Oregon' LIMIT 2`)).status, 200);
  assert.equal((await sql('SELECT 1 AS n')).status, 200);
  await tool('sql_query', { sql: 'SELECT COUNT(*) AS n FROM Congress' });
  await tool('describe_record', { layout: 'Congress', recordId: id });
  await tool('explain_value', { layout: 'Congress', field: 'Name', recordId: id });
  await tool('check_record', { layout: 'Congress', recordId: id });
  await tool('search_records', { text: 'Via rest', tables: ['Congress'] });
  const reads = store.auditLog({ kind: 'read' }).slice(before);
  assert.deepEqual(reads.map((r) => r.surface), ['sql', 'mcp', 'mcp', 'mcp', 'mcp', 'mcp'], 'a query that names no table logs nothing');
  assert.ok(reads.every((r) => r.table === 'Congress' && r.account === 'Admin'));
  assert.deepEqual(reads[0].changes, { query: true, rows: 2 });
  assert.equal(reads[2].recordId, id);
  assert.doesNotMatch(JSON.stringify(reads), /Oregon|SELECT/);
  assert.equal(store.verifyRecordAudit().status, 'consistent');
  store.setAuditSettings({ logReads: false });
});

test('with read logging on, the AI tools that read the design or a container are logged too, without what they returned', { skip }, async () => {
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: basic },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { database: 'Charts', ...args } } }),
    });
    assert.equal(r.status, 200);
    return ((await r.json()) as { result: { isError?: boolean } }).result;
  };
  const file = store.addContainer({ filename: 'secret-plan.txt', mime: 'text/plain', data: new TextEncoder().encode('the plan') });
  await tool('describe_database', {});
  assert.equal(store.auditLog({ kind: 'read' }).filter((r) => r.table === '_design' || r.table === '_containers').length, 0, 'off by default');
  store.setAuditSettings({ logReads: true });
  const before = store.auditLog({ kind: 'read' }).length;
  assert.equal((await tool('describe_database', {})).isError, undefined);
  assert.equal((await tool('where_used', { name: 'Congress::Name' })).isError, undefined);
  assert.equal((await tool('describe_database', { database: 'Nowhere' })).isError, true);
  assert.equal((await tool('get_container', { container: file })).isError, undefined);
  const reads = store.auditLog({ kind: 'read' }).slice(before);
  assert.deepEqual(reads.map((r) => [r.table, r.surface, r.account]), [['_design', 'mcp', 'Admin'], ['_design', 'mcp', 'Admin'], ['_containers', 'mcp', 'Admin']]);
  assert.deepEqual(reads.map((r) => r.changes), [{ design: 'describe_database' }, { design: 'where_used' }, { container: 'secret-plan.txt', bytes: 8 }]);
  assert.equal(reads[2].recordId, file);
  assert.doesNotMatch(JSON.stringify(reads), /the plan|Congress::Name/);
  assert.equal(store.verifyRecordAudit().status, 'consistent');
  store.setAuditSettings({ logReads: false });
});

test('records an import added, and their taking-back, are logged as coming from an import', { skip }, async () => {
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: basic },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { database: 'Charts', ...args } } }),
    });
    assert.equal(r.status, 200);
    const text = ((await r.json()) as { result: { content: { text: string }[] } }).result.content[0].text;
    return JSON.parse(text) as Record<string, unknown>;
  };
  const before = store.auditLog({}).length;
  const done = await tool('import_records', {
    layout: 'Congress', data: 'Name,State\nImported One,Ohio\nImported Two,Ohio', headerRow: true,
    columns: [{ column: 0, field: 'Name' }, { column: 1, field: 'State' }],
  });
  const added = store.auditLog({}).slice(before);
  assert.equal(added.filter((e) => e.kind === 'create').length, 2, JSON.stringify(done));
  assert.ok(added.every((e) => e.surface === 'import'), 'an import is not "mcp", whichever way in it was started');
  const mark = store.auditLog({}).length;
  await tool('undo_import', { id: done.id });
  const undone = store.auditLog({}).slice(mark);
  assert.equal(undone.filter((e) => e.kind === 'delete').length, 2);
  assert.ok(undone.every((e) => e.surface === 'import'));
  // Back outside an import the request's own surface applies again.
  await tool('create_record', { layout: 'Congress', fieldData: { Name: 'After' } });
  assert.equal(store.auditLog({ kind: 'create' }).at(-1)!.surface, 'mcp');
});

test('the revert_change AI tool puts an edit back, logged as an mcp change that names the entry', { skip }, async () => {
  const id = await createViaDataApi();
  store.update('Congress', id, { Name: 'Edited by hand' }, undefined, { account: 'Admin' });
  const edit = store.auditLog({ table: 'Congress', recordId: id, kind: 'update' }).at(-1)!;
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: basic },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'revert_change', arguments: { database: 'Charts', layout: 'Congress', recordId: id, seq: edit.seq } } }),
  });
  const out = JSON.parse(((await res.json()) as { result: { content: { text: string }[] } }).result.content[0].text) as { action: string; fields: string[] };
  assert.equal(out.action, 'updated');
  assert.notEqual(store.get('Congress', id, 'iso').fieldData.Name, 'Edited by hand');
  const last = store.auditLog({ table: 'Congress', recordId: id }).at(-1)!;
  assert.deepEqual([last.surface, last.revertOf], ['mcp', edit.seq]);
});
