// The design-reading MCP tools whose behaviour no other test pins: get_theme, lint_script, lint_layout, arrange_graph, restyle_layout,
// modernize_interfaces, draft_layout, check_formula, suggest_indexes, solution_map and search_solution. Each is called once as Full Access
// (a normal result, and the previews change nothing), once as a read-only account (refused with the privilege message) and, for the
// ones that read the design without changing it, once as a designer who is not Full Access. The file is built with `tabularius design-apply`
// from examples/crm, so no sample file is needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve, STORE_EXT } from '../src/index.ts';

const main = join(import.meta.dirname, '..', '..', 'cli', 'src', 'main.ts');
const example = join(import.meta.dirname, '..', '..', '..', 'examples', 'crm');
const FULL = 'Admin:a long enough password';
const VIEWER = 'viewer:pw';
const DESIGNER = 'designer:pw';

let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-tools-'));
  const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8', env: { ...process.env, TABULARIUS_PASSWORD: 'a long enough password' } });
  assert.equal(run('new', dir, 'CRM').status, 0);
  assert.equal(run('design-apply', dir, 'CRM', example, '--apply').status, 0);
  assert.equal(run('passwd', dir, 'CRM', 'Admin').status, 0);
  copyFileSync(join(dir, `CRM${STORE_EXT}`), join(dir, `Secret${STORE_EXT}`));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('CRM')!;
  store.savePrivilegeSet({ name: 'Viewer', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'] });
  store.setPassword('viewer', 'pw', 'Viewer');
  // Can read every record and change scripts, but is not [Full Access]: it may search the design, not change layouts or the graph.
  store.savePrivilegeSet({ name: 'Designer', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: ['fmmcp'] });
  store.setPassword('designer', 'pw', 'Designer');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function tool(who: string, name: string, args: unknown): Promise<{ isError: boolean; text: string; data: any }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Basic ' + btoa(who) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { isError?: boolean; content?: { text: string }[] }; error?: unknown };
  const text = body.result?.content?.[0]?.text ?? JSON.stringify(body.error ?? body);
  let data: any;
  try { data = JSON.parse(text); } catch { data = undefined; }
  return { isError: !!body.result?.isError || !body.result, text, data };
}

const db = 'CRM';
const layoutNames = () => store.schema.layouts.map((l) => l.name).sort().join();

test('the design tools answer Full Access, and the previews change nothing', async () => {
  const before = layoutNames();

  let r = await tool(FULL, 'lint_script', { database: db });
  assert.equal(r.isError, false, r.text);
  assert.ok(Array.isArray(r.data.scripts));

  r = await tool(FULL, 'check_solution', { database: db });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.database, db);
  assert.deepEqual(Object.keys(r.data.counts), ['error', 'warning', 'info']);
  assert.ok(Array.isArray(r.data.findings));
  r = await tool(FULL, 'check_solution', { database: db, account: 'nobody' });
  assert.equal(r.isError, true);
  assert.match(r.text, /no account named "nobody"/);

  r = await tool(FULL, 'lint_layout', { database: db, layout: 'Deals' });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.layout, 'Deals');
  assert.ok(Array.isArray(r.data.issues));

  r = await tool(FULL, 'arrange_graph', { database: db, preview: true });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.saved, false);
  assert.equal(typeof r.data.moved, 'number');

  r = await tool(FULL, 'restyle_layout', { database: db, layout: 'Deals', consistent: true });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.saved, false, 'preview is the default');

  r = await tool(FULL, 'modernize_interfaces', { database: db, tables: ['Deals'], styles: ['modern-list'] });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.layouts[0].table, 'Deals');
  assert.equal(r.data.layouts[0].style, 'modern-list');

  r = await tool(FULL, 'draft_layout', { database: db, name: 'Deals draft', occurrence: 'Deals' });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.layout, 'Deals draft');

  r = await tool(FULL, 'suggest_indexes', { database: db });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(r.data.finds, []);

  assert.equal(layoutNames(), before, 'no preview made or changed a layout');
});

test('a mistyped design database name lists only files this caller can open', async () => {
  const r = await tool(VIEWER, 'get_design', { database: 'Missing' });
  assert.equal(r.isError, true);
  assert.match(r.text, /No hosted database named "Missing"/);
  assert.match(r.text, /Hosted: CRM/);
  assert.doesNotMatch(r.text, /Secret/);
});

test('get_theme names a missing theme, and check_formula tells a good formula from a bad one', async () => {
  const missing = await tool(FULL, 'get_theme', { database: db, theme: 'No such theme' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /No theme "No such theme"/);

  const good = await tool(FULL, 'check_formula', { database: db, formula: 'Count ( Deals::ID )', table: 'Companies' });
  assert.deepEqual(good.data, { ok: true });
  const bad = await tool(FULL, 'check_formula', { database: db, formula: 'Sum ( Deals::Amount', table: 'Companies' });
  assert.equal(bad.data.ok, false);
  assert.equal(typeof bad.data.code, 'number');
  assert.match(bad.data.message, /expected/);
});

test('search_solution and solution_map read the whole design', async () => {
  const found = await tool(FULL, 'search_solution', { database: db, text: 'open deals' });
  assert.equal(found.isError, false, found.text);
  assert.ok(found.data.count > 0);
  assert.ok(found.data.hits.some((h: { kind: string }) => h.kind === 'script'), 'the Open deals script is found by name');

  const map = await tool(FULL, 'solution_map', {});
  assert.equal(map.isError, false, map.text);
  assert.deepEqual(map.data.files.map((f: { name: string }) => f.name), ['CRM', 'Secret']);
});

test('a read-only account is refused every one of them', async () => {
  const calls: [string, unknown][] = [
    ['get_theme', { database: db, theme: 'Any' }], ['lint_script', { database: db }], ['check_solution', { database: db }], ['lint_layout', { database: db, layout: 'Deals' }],
    ['arrange_graph', { database: db, preview: true }], ['restyle_layout', { database: db, layout: 'Deals', consistent: true }],
    ['modernize_interfaces', { database: db, tables: ['Deals'] }], ['draft_layout', { database: db, name: 'X', occurrence: 'Deals' }],
    ['check_formula', { database: db, formula: '1', table: 'Companies' }], ['suggest_indexes', { database: db }],
    ['solution_map', {}], ['search_solution', { database: db, text: 'deal' }],
  ];
  for (const [name, args] of calls) {
    const r = await tool(VIEWER, name, args);
    assert.equal(r.isError, true, `${name}: ${r.text}`);
    assert.match(r.text, /Insufficient privileges|No hosted files you can design/, name);
  }
});

test('a designer who is not Full Access may search the design but not tidy or draft it', async () => {
  const search = await tool(DESIGNER, 'search_solution', { database: db, text: 'open deals' });
  assert.equal(search.isError, false, search.text);
  assert.ok(search.data.count > 0);
  for (const [name, args] of [['arrange_graph', { database: db, preview: true }], ['draft_layout', { database: db, name: 'X', occurrence: 'Deals' }]] as const) {
    const r = await tool(DESIGNER, name, args);
    assert.equal(r.isError, true, name);
    assert.match(r.text, /Full Access/);
  }
});
