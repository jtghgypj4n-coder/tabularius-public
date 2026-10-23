// The change impact check: what a rename or delete would break, before it is done. Uses in the file (by id
// follow a rename; by name in text don't), privilege set entries and record limits (kept by name), and Data
// API clients seen in the fmdapi log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { changeImpact } from '../src/change-impact.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-change-impact-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  store = host.get('Charts')!;
  store.applyDesign([
    { op: 'createField', table: 'Congress', name: 'Party By Name', kind: 'calculation', calculation: 'GetField ( "Congress::Party" )' },
    { op: 'createField', table: 'Congress', name: 'Party Upper', kind: 'calculation', calculation: 'Upper ( Party )' },
  ]);
  store.savePrivilegeSet({
    name: 'Dem', records: { view: false, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none',
    extendedPrivileges: ['fmrest'], layoutAccess: { Congress: { layout: 'none', records: 'none' } },
    tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false, fields: { Party: 'viewOnly' } } },
  });
  store.setPassword('Admin', 'Admin-pw-123456');
  // A Data API client reading the Congress layout, so the log has it.
  const auth = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:Admin-pw-123456') }, body: '{}',
  });
  const token = (await auth.json()).response.token;
  for (let i = 0; i < 2; i++) {
    await (await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records?_limit=1`, { headers: { authorization: `Bearer ${token}` } })).json();
  }
  await host.logs!.flush();
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('renaming a field: uses by id follow, uses by name and privilege entries break, and the Data API client is named', { skip }, async () => {
  const r = await changeImpact(store, host.logs, 'field', 'Congress::Party', 'rename');
  const byName = r.uses.find((u) => u.where.includes('Party By Name'))!;
  const byId = r.uses.find((u) => u.where.includes('Party Upper'))!;
  assert.equal(byName.breaks, true, byName.why);
  assert.equal(byId.breaks, false, byId.why);
  assert.ok(r.privileges.some((p) => p.privilegeSet === 'Dem' && p.entry.startsWith('field "Congress::Party"') && p.breaks));
  assert.ok(r.privileges.some((p) => p.entry.startsWith('view limit on Congress') && p.breaks));
  const client = r.clients.find((c) => c.account === 'Admin')!;
  assert.equal(client.calls, 2);
  assert.match(client.via, /layout Congress, which shows the field/);
  // What breaks first: the outside client, then privileges, then uses by name; then what follows the rename.
  assert.match(r.summary[0], /2 Data API calls .*Admin/);
  assert.match(r.summary[1], /privilege set \(Dem\)/);
  assert.match(r.summary.join(' '), /follows the rename|follow the rename/);
});

test('deleting it breaks every use; a layout rename names its privilege entry and its callers', { skip }, async () => {
  const del = await changeImpact(store, host.logs, 'field', 'Congress::Party', 'delete');
  assert.ok(del.uses.length >= 2 && del.uses.every((u) => u.breaks));
  const layout = await changeImpact(store, host.logs, 'layout', 'Congress', 'rename');
  assert.ok(layout.privileges.some((p) => p.entry.startsWith('layout "Congress": none') && /all other layouts \(viewOnly\)/.test(p.why)));
  assert.equal(layout.clients[0]?.via, 'layout Congress');
  const quiet = await changeImpact(store, host.logs, 'layout', 'Grades', 'rename');
  assert.deepEqual(quiet.clients, []);
  // Nothing names Grades, but three scripts go to a layout by a name worked out at run time ($destinationLayout), so
  // the check cannot say that nothing uses it: it lists them as possible breaks instead of claiming it is unused.
  assert.doesNotMatch(quiet.summary[0], /Nothing uses this layout/);
  assert.equal(quiet.uses.length, 3);
  assert.ok(quiet.uses.every((u) => u.breaks && u.where.startsWith('Script "[btn] Go to') && /name is computed/.test(u.why)), JSON.stringify(quiet.uses));
  await assert.rejects(changeImpact(store, host.logs, 'layout', 'No Such Layout', 'rename'), /No layout named/);
});

test('as an MCP tool for [Full Access]', { skip }, async () => {
  const res = await (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      authorization: 'Basic ' + btoa('Admin:Admin-pw-123456'),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_change_impact', arguments: { database: 'Charts', kind: 'field', name: 'Congress::Party', change: 'delete' } } }),
  })).json();
  const r = JSON.parse(res.result.content[0].text);
  assert.equal(r.change, 'delete');
  assert.ok(r.uses.length >= 2);
});
