// An unstored calculation that aggregates a related table must not leak that
// table's data to an account that cannot view it — over the AI/MCP surface and
// the Data API alike, both of which read records through Store.get/find. The
// leak was NW Customers::Total Sales = Sum ( NW Line Items::Extended Price )
// showing 4273 to an account with no view access to NW Line Items.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-leak-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;

  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.setPassword('Admin', 'pw', full.name);

  // Can view customers and sign in (fmmcp for AI, fmrest for the Data API), but
  // has no view access at all to NW Line Items.
  store.savePrivilegeSet({
    name: 'Clerk',
    records: { view: true, edit: false, create: false, delete: false },
    tables: { 'NW Line Items': { view: false, edit: false, create: false, delete: false } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp', 'fmrest'],
  });
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function mcp(name: string, args: unknown, auth?: string): Promise<any> {
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
  try { return { isError: !!result.isError, data: JSON.parse(text), text }; } catch { return { isError: !!result.isError, data: undefined, text }; }
}

const firstCustomerId = () => Number((store.query(`SELECT _fm_record_id AS id FROM "NW Customers" ORDER BY _fm_record_id LIMIT 1`)[0] as { id: number }).id);

test('MCP get_record: a no-view account gets an empty aggregate; the admin gets the real total', { skip }, async () => {
  const id = firstCustomerId();
  const clerk = await mcp('get_record', { database: 'Charts', layout: 'NW Customers', recordId: id }, 'Clerk:pw');
  assert.equal(clerk.isError, false, clerk.text);
  assert.ok(!clerk.data.fieldData['Total Sales'], `Total Sales hidden for the clerk (got ${JSON.stringify(clerk.data.fieldData['Total Sales'])})`);

  const admin = await mcp('get_record', { database: 'Charts', layout: 'NW Customers', recordId: id }, 'Admin:pw');
  assert.equal(admin.isError, false, admin.text);
  assert.equal(Number(admin.data.fieldData['Total Sales']), 4273, 'the admin still reads the real total');
});

test('MCP find_records: the leak is closed across a found set', { skip }, async () => {
  const clerk = await mcp('find_records', { database: 'Charts', layout: 'NW Customers', limit: 5 }, 'Clerk:pw');
  assert.equal(clerk.isError, false, clerk.text);
  assert.ok(clerk.data.records.length > 0, 'the clerk still sees customer records');
  assert.ok(clerk.data.records.every((r: any) => !r.fieldData['Total Sales']), 'no customer row leaks a line-item total');
});

test('Data API: the same record read over REST does not leak the total', { skip }, async () => {
  const token = async (account: string) => {
    const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}',
    });
    return (await r.json()).response?.token as string | undefined;
  };
  const read = async (account: string, id: number) => {
    const t = await token(account);
    assert.ok(t, `signed in as ${account}`);
    const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/NW%20Customers/records/${id}`, { headers: { authorization: `Bearer ${t}` } });
    const body = await r.json();
    return body.response?.data?.[0]?.fieldData?.['Total Sales'];
  };
  const id = firstCustomerId();
  const clerkVal = await read('Clerk', id);
  assert.ok(!clerkVal, `Data API hides the total for the clerk (got ${JSON.stringify(clerkVal)})`);
  assert.equal(Number(await read('Admin', id)), 4273, 'Data API gives the admin the real total');
});
