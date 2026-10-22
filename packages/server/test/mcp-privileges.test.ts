// The MCP (AI) tools run under the signed-in account's privilege set — there
// is no escalation. A restricted account signing in to /mcp with Basic auth
// sees only what its set allows and is refused writes it cannot make, while a
// full-access account does the same calls successfully. This locks in that
// the AI surface enforces the same record/field rules as every other.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-priv-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ mcpToken: 'test-admin-token', dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;

  // A full-access account that may use AI (fmmcp is implicit for [Full Access]).
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.setPassword('Admin', 'pw', full.name);

  // A restricted account: sees only Democrats, never the ACLU field, and may
  // not create, edit or delete. It carries fmmcp so it can reach the AI tools.
  store.savePrivilegeSet({
    name: 'Clerk',
    records: { view: false, edit: false, create: false, delete: false },
    tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false, fields: { ACLU: 'none' } } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'],
  });
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

/** Calls an MCP tool over Streamable HTTP; `auth` is "account:password" (omit for the loopback administrator). */
async function tool(name: string, args: unknown, auth?: string): Promise<{ isError: boolean; data: any; text: string }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      authorization: auth ? 'Basic ' + btoa(auth) : 'Bearer test-admin-token',
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

const idWhere = (where: string) => Number((store.query(`SELECT _fm_record_id AS id FROM Congress WHERE ${where} LIMIT 1`)[0] as { id: number }).id);

test('find_records returns only the records and fields the account may see', { skip }, async () => {
  const clerk = await tool('find_records', { database: 'Charts', layout: 'Congress', limit: 1000 }, 'Clerk:pw');
  assert.equal(clerk.isError, false, clerk.text);
  assert.ok(clerk.data.records.length > 0, 'the clerk sees some records');
  assert.ok(clerk.data.records.every((r: any) => r.fieldData.Party === 'D'), 'only Democrats are returned');
  assert.ok(clerk.data.records.every((r: any) => !('ACLU' in r.fieldData) || r.fieldData.ACLU === ''), 'the ACLU field is never shown');

  // The administrator (loopback, no account) sees every party — so the limit above is the account's, not the data's.
  const admin = await tool('find_records', { database: 'Charts', layout: 'Congress', limit: 1000 });
  assert.equal(admin.isError, false, admin.text);
  assert.ok(admin.data.records.some((r: any) => r.fieldData.Party !== 'D'), 'the admin sees non-Democrats');
});

test('get_record on a record outside the account\'s view is refused', { skip }, async () => {
  const republican = idWhere(`Party = 'R'`);
  const clerk = await tool('get_record', { database: 'Charts', layout: 'Congress', recordId: republican }, 'Clerk:pw');
  assert.equal(clerk.isError, true, 'the clerk cannot read a Republican record');
  // The same id reads fine for the administrator, proving it is a privilege check, not a missing record.
  const admin = await tool('get_record', { database: 'Charts', layout: 'Congress', recordId: republican });
  assert.equal(admin.isError, false, admin.text);
});

test('create, update and delete are refused for a read-only account but work for full access', { skip }, async () => {
  const democrat = idWhere(`Party = 'D'`);

  const created = await tool('create_record', { database: 'Charts', layout: 'Congress', fieldData: { State: 'ZZ' } }, 'Clerk:pw');
  assert.equal(created.isError, true, 'the clerk cannot create');
  const updated = await tool('update_record', { database: 'Charts', layout: 'Congress', recordId: democrat, fieldData: { State: 'ZZ' } }, 'Clerk:pw');
  assert.equal(updated.isError, true, 'the clerk cannot edit, even a record it can see');
  const deleted = await tool('delete_record', { database: 'Charts', layout: 'Congress', recordId: democrat }, 'Clerk:pw');
  assert.equal(deleted.isError, true, 'the clerk cannot delete');

  // Full access can create (and then clean up), confirming the refusals are the account's own limits.
  const ok = await tool('create_record', { database: 'Charts', layout: 'Congress', fieldData: { State: 'ZZ' } }, 'Admin:pw');
  assert.equal(ok.isError, false, ok.text);
  await tool('delete_record', { database: 'Charts', layout: 'Congress', recordId: Number(ok.data.recordId) }, 'Admin:pw');
});

test('update_records is refused for a read-only account, and a dry run changes nothing for full access', { skip }, async () => {
  const query = [{ Party: '=D' }];
  const clerk = await tool('update_records', { database: 'Charts', layout: 'Congress', query, fieldData: { State: 'ZZ' } }, 'Clerk:pw');
  assert.equal(clerk.isError, true, 'the clerk cannot edit the records it can see');
  assert.equal(Number((store.query(`SELECT COUNT(*) AS n FROM Congress WHERE State = 'ZZ'`)[0] as { n: number }).n), 0);

  const preview = await tool('update_records', { database: 'Charts', layout: 'Congress', query, fieldData: { State: 'ZZ' }, dryRun: true }, 'Admin:pw');
  assert.equal(preview.isError, false, preview.text);
  assert.equal(preview.data.dryRun, true);
  assert.ok(preview.data.matched > 1 && preview.data.total > 0, 'the preview lists the values that would change');
  assert.equal(Number((store.query(`SELECT COUNT(*) AS n FROM Congress WHERE State = 'ZZ'`)[0] as { n: number }).n), 0, 'a dry run changes nothing');

  const refused = await tool('update_records', { database: 'Charts', layout: 'Congress', query, fieldData: { State: 'ZZ' }, expectCount: 1 }, 'Admin:pw');
  assert.equal(refused.isError, true);
  assert.match(refused.text, /expected/);
});

test('raw-reading tools are closed to an account that cannot read everything', { skip }, async () => {
  // evaluate_calculation and sql_query require readsEverything; the clerk lacks it.
  const calc = await tool('evaluate_calculation', { database: 'Charts', layout: 'Congress', formula: '1 + 1' }, 'Clerk:pw');
  assert.equal(calc.isError, true, 'free-form evaluation is closed to a restricted account');
  assert.match(calc.text, /privilege|read every/i);
  // The administrator may use it.
  const admin = await tool('evaluate_calculation', { database: 'Charts', layout: 'Congress', formula: '1 + 1' });
  assert.equal(admin.isError, false, admin.text);
  assert.equal(admin.data.value, '2');
});

test('an account without fmmcp cannot reach the AI tools at all', { skip }, async () => {
  store.savePrivilegeSet({
    name: 'NoAI', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('NoAI', 'pw', 'NoAI');
  const denied = await tool('find_records', { database: 'Charts', layout: 'Congress' }, 'NoAI:pw');
  assert.equal(denied.isError, true, 'no fmmcp, no AI access');
  assert.match(denied.text, /fmmcp/);
});

test('the tools a person has in the web client stay within the account: debugger, layouts, security, containers, portals', { skip }, async () => {
  const db = { database: 'Charts' };
  for (const [name, args, why] of [
    ['debug_script', { ...db, script: 'Show Senate' }, /debugging needs \[Full Access\]/],
    ['edit_layout_objects', { ...db, layout: 'Congress', remove: [] }, /\[Full Access\]/],
    ['try_design_change', { ...db, changes: [{ op: 'createScript', name: 'x', text: 'Beep' }] }, /\[Full Access\]/],
    ['change_security', { ...db, changes: [{ op: 'setAccount', name: 'Clerk', privilegeSet: '[Full Access]' }] }, /\[Full Access\]/],
    ['paste_from_filemaker', { ...db, xml: '<fmxmlsnippet type="FMObjectList"></fmxmlsnippet>' }, /\[Full Access\]/],
  ] as const) {
    const r = await tool(name, args, 'Clerk:pw');
    assert.equal(r.isError, true, `${name}: ${r.text}`);
    assert.match(r.text, why, name);
  }
  // A record the clerk can see but not edit: no files, no portal edits.
  const id = idWhere(`Party = 'D'`);
  const up = await tool('upload_container', { ...db, layout: 'Congress', recordId: id, field: 'Name', filename: 'a.txt', mime: 'text/plain', data: 'aGk=' }, 'Clerk:pw');
  assert.equal(up.isError, true, up.text);
  const portal = await tool('update_record', { ...db, layout: 'Congress', recordId: id, fieldData: { Name: 'x' } }, 'Clerk:pw');
  assert.equal(portal.isError, true, portal.text);
  assert.ok(store.privileges('Clerk').name === 'Clerk', 'the clerk did not raise their own privileges');
});

test('an account signing in to /mcp with its password counts as using AI, so least privilege sees fmmcp in use', { skip }, async () => {
  const r = await tool('find_records', { database: 'Charts', layout: 'Congress', query: [{ Party: 'D' }], limit: 1 }, 'Clerk:pw');
  assert.equal(r.isError, false, r.text);
  assert.ok((store.accountUsage(1).accounts.find((a) => a.account.toLowerCase() === 'clerk')?.bySurface.mcp ?? 0) >= 1);
});

test('describe_database names no table or occurrence the account can\'t view', { skip }, async () => {
  const clerk = await tool('describe_database', { database: 'Charts' }, 'Clerk:pw');
  assert.equal(clerk.isError, false, clerk.text);
  const hidden = store.schema.tables.filter((t) => t.name !== 'Congress').map((t) => t.name);
  assert.ok(hidden.length > 0);
  const listed = JSON.stringify(clerk.data.tableOccurrences) + JSON.stringify(clerk.data.tables);
  for (const name of hidden) assert.ok(!listed.includes(`"${name}"`), `${name} is named`);
  assert.ok(listed.includes('Congress'));
  // The administrator still sees them all.
  const admin = await tool('describe_database', { database: 'Charts' });
  assert.ok(hidden.every((name) => JSON.stringify(admin.data.tableOccurrences).includes(`"${name}"`)));
});
