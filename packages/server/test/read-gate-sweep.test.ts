// Every documented HTTP route and every MCP tool, called by an account that may see little, must show nothing it may not see:
// not a hidden field's value, not a hidden table's rows, not a record the record-level rule hides, and not the counts of
// them. The solution is seeded with values and counts that appear nowhere else (SENTINEL-*, 1,371 hidden records, 2,113 in a
// hidden table), the routes come from docs/reference/rest.md and the tools from the server, so a route or tool added later
// is swept without anyone remembering to add it. A control run as an account with full access shows the sweep sees the
// values when it is let to. The static half of the inventory is read-gate-typed.test.ts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore } from '../../store/src/index.ts';
import { serve, setAdminPassword } from '../src/index.ts';
import { createMcpServer } from '../src/mcp.ts';

const KEYS = ['fmrest', 'fmodata', 'fmmcp', 'fmxdbc', 'fmapp', 'fmwebdirect', 'fmxml', 'fmurlscript'];
const HIDDEN_RECORDS = 1371, VISIBLE_RECORDS = 3, VAULT_RECORDS = 2113;
/** What must never reach the restricted account: values (SENTINEL-*, Boss) and the counts only a wider view could give. */
const LEAK = new RegExp(`SENTINEL-|\\bBoss\\b|\\b(${HIDDEN_RECORDS}|${HIDDEN_RECORDS + VISIBLE_RECORDS}|${VAULT_RECORDS}|${HIDDEN_RECORDS + VAULT_RECORDS})\\b`, 'g');

let dir = '';
let s: Awaited<ReturnType<typeof serve>>;
let base = '';
let clerkToken = '', adminToken = '';
let hiddenId = 0, visibleId = 0;
const clerk = 'Basic ' + btoa('Clerk:pw');
const admin = 'Basic ' + btoa('Chief:pw');

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sweep-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'), { mode: 'native' });
  createStore(join(dir, 'Other.openhbam.sqlite'), { mode: 'native' });
  setAdminPassword(dir, 'server-admin-password');
  s = await serve({ dir, port: 0, watch: false, log: () => {} });
  base = s.url.replace(/\/$/, '');
  const st = s.host.get('Shop')!;
  const other = s.host.get('Other')!;
  st.setAiPolicy(false);
  other.setAiPolicy(false);
  // A second hosted file the restricted account has no access to, reached by a relationship and by calculations.
  other.applyDesign([{ op: 'createTable', name: 'Src', fields: [{ name: 'Id' }, { name: 'Value' }] }] as never);
  other.create('Src', { Id: 'mine-1', Value: 'SENTINEL-OTHER-FILE' });
  other.savePrivilegeSet({ name: 'None', records: { view: false, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: KEYS } as never);
  other.setPassword('Clerk', 'pw', 'None');
  other.setPassword('Chief', 'pw', other.privilegeSets().find((p) => p.id === 1)!.name);
  st.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Owner' }, { name: 'Secret' }, { name: 'Echo', kind: 'calculation', calculation: 'Secret & "!"' }, { name: 'Photo', type: 'container' }] },
    { op: 'createTable', name: 'Vault', fields: [{ name: 'Code' }, { name: 'ItemName' }] },
    { op: 'createRelationship', left: 'Items', right: 'Vault', predicates: [{ left: 'Name', right: 'ItemName' }] },
    { op: 'createDataSource', name: 'Other', paths: ['file:Other'] },
    { op: 'createOccurrence', name: 'External', file: 'Other', externalTable: other.schema.tables[0].id },
    { op: 'createLayout', name: 'External', occurrence: 'External' },
    { op: 'createRelationship', left: 'Items', right: 'External', predicates: [{ left: 'Name', right: other.schema.tables[0].fields.find((f) => f.name === 'Id')!.id }] },
    { op: 'createField', table: 'Items', name: 'Ext', kind: 'calculation', calculation: 'External::Value', options: { unstored: true } },
    { op: 'createField', table: 'Items', name: 'ExtCount', kind: 'calculation', calculation: 'Count ( External::Id ) & "|" & List ( External::Value )', options: { unstored: true } },
    { op: 'createScript', name: 'Public', text: 'Exit Script [ Text Result: Items::Name ]' },
    { op: 'createScript', name: 'Hush', text: 'Exit Script [ Text Result: Items::Secret ]' },
  ] as never);
  for (let i = 1; i <= VISIBLE_RECORDS; i++) st.create('Items', { Name: i === 1 ? 'mine-1' : `mine-${i}`, Owner: 'Clerk', Secret: `SENTINEL-FIELD-MINE-${i}` });
  visibleId = 1;
  for (let i = 1; i <= HIDDEN_RECORDS; i++) {
    const r = st.create('Items', { Name: `SENTINEL-NAME-${i}`, Owner: 'Boss', Secret: `SENTINEL-FIELD-${i}` });
    if (i === 1) hiddenId = r.recordId;
  }
  for (let i = 1; i <= VAULT_RECORDS; i++) st.create('Vault', { Code: `SENTINEL-VAULT-${i}`, ItemName: `SENTINEL-NAME-${(i % HIDDEN_RECORDS) + 1}` });
  st.setContainer('Items', hiddenId, 'Photo', 1, { filename: 'SENTINEL-photo.txt', mime: 'text/plain', data: Buffer.from('SENTINEL-CONTAINER') });
  st.savePrivilegeSet({ name: 'Clerk', records: { view: 'Owner = Get ( AccountName )', edit: 'Owner = Get ( AccountName )', create: true, delete: 'Owner = Get ( AccountName )', fields: { Secret: 'none', Echo: 'none' } },
    tables: { Vault: { view: false, edit: false, create: false, delete: false } },
    layouts: 'modifiable', layoutAccess: { Vault: { layout: 'none', records: 'none' } }, valueLists: 'viewOnly', scripts: 'modifiable', scriptAccess: { Hush: 'none' }, extendedPrivileges: KEYS } as never);
  st.setPassword('Clerk', 'pw', 'Clerk');
  // The control's account may use every front end.
  for (const f of [st, other]) {
    const full = f.privilegeSets().find((p) => p.id === 1)!;
    f.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, ...KEYS])] });
  }
  st.setPassword('Chief', 'pw', st.privilegeSets().find((p) => p.id === 1)!.name);
  const session = async (who: string) => {
    const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${who}:pw`), 'content-type': 'application/json' }, body: '{}' });
    return ((await r.json()) as { response: { token: string } }).response.token;
  };
  clerkToken = await session('Clerk');
  adminToken = await session('Chief');
});
after(async () => {
  await new Promise<void>((r) => (s ? s.server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

interface Route { method: string; path: string }
function routes(): Route[] {
  const md = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'reference', 'rest.md'), 'utf8');
  const out: Route[] = [];
  for (const m of md.matchAll(/^### `([A-Z, ]+) (\/[^`]*)`/gm)) for (const method of m[1].split(',').map((x) => x.trim())) if (method !== 'HEAD') out.push({ method, path: m[2] });
  return out;
}

/** The ways one route is called: a hidden target and a visible one, with a few bodies. */
function calls(r: Route): { method: string; url: string; body?: string }[] {
  const out: { method: string; url: string; body?: string }[] = [];
  const targets = [
    { layout: 'Items', table: 'Items', name: 'Items', script: 'Public', id: visibleId, field: 'Name' },
    { layout: 'Vault', table: 'Vault', name: 'Vault', script: 'Hush', id: hiddenId, field: 'Secret' },
    { layout: 'Items', table: 'Items', name: 'Items', script: 'Hush', id: hiddenId, field: 'Echo' },
  ];
  const plan = '{"plan":{"summary":"Look","layout":"Items","steps":[{"kind":"find","query":[{"Name":"SENTINEL"}]},{"kind":"delete"}]},"step":0}';
  const bodies: (string | undefined)[] = r.method === 'GET' ? [undefined] : ['{}', '{"query":[{}],"limit":500}', '{"sql":"SELECT * FROM Items","layout":"Items","fieldData":{}}', ...(r.path.startsWith('/tabularius/agent/') ? [plan] : [])];
  for (const t of targets) {
    const path = r.path.replace('{version}', 'vLatest').replace(/\{(database|db)\}/g, 'Shop')
      .replace(/\{(layout)\}/g, t.layout).replace(/\{(table|entitySet|tableName)\}/g, t.table).replace(/\{(script|scriptName)\}/g, t.script)
      .replace(/\{(id|recordId|key)\}/g, String(t.id)).replace(/\{(field|fieldName)\}/g, t.field).replace(/\{(name|valueList)\}/g, t.name)
      .replace(/\{[^}]+\}/g, '1').replace(/^\/fmi\/odata\/v4$/, '/fmi/odata/v4/Shop');
    for (const body of bodies) out.push({ method: r.method, url: path, body });
  }
  return out;
}

/** Route families the control cannot get a success from, and why (each needs something a generic call cannot supply). */
const NOT_SWEPT = new Map<string, string>([
  ['/mcp', 'the MCP tools are swept below, through the protocol'],
  ['/tabularius/containers', 'reached only through a signed link that a record read hands out; the sweep checks the links the record routes hand out (file names carry the sentinel)'],
  ['/tabularius/images', 'pictures from the file\'s image library (design assets), not record data'],
  ['/tabularius/hooks', 'an inbound hook needs a configured hook and its secret; covered by inbound-hooks.test.ts'],
  ['/tabularius/scim', 'its own bearer token, not an account session; covered by scim*.test.ts'],
  ['/tabularius/tls', 'only when the server runs its own certificate authority'],
  ['/tabularius/replication', 'only on a replication primary, with the cluster secret; covered by replication tests'],
  ['/fmi/admin', 'the Admin API signs in with server administrator credentials, not file accounts; covered by admin-api tests'],
  ['/fmi/webd', 'redirects to the web client page; no data'],
  ['/fmws', 'the XML web publishing prefix: covered by the /fmi/xml routes'],
  ['/oauth', 'sign-in handshake pages, no record data'],
  ['/.well-known', 'public discovery documents'],
  ['/app', 'static client files'],
  ['/favicon.ico', 'static file'],
]);

/** MCP tools the control cannot run with generic arguments, and why. */
const TOOLS_NOT_SWEPT = new Map<string, string>([
  ...['update_record', 'update_records', 'upload_container', 'fix_data_problems', 'import_records', 'undo_import', 'undo_data_fix', 'refresh_stale_calcs', 'undo_stale_refresh', 'optimization_fix', 'optimization_move_containers']
    .map((t) => [t, 'writes data: the control would change the seeded records; covered by the privilege matrix and the write-privilege tests'] as [string, string]),
  ...['preview_privilege_set', 'change_security', 'create_database', 'change_design', 'try_design_change', 'check_change_impact', 'save_dashboard', 'save_automation', 'try_automation', 'draft_connection', 'draft_layout', 'restyle_layout', 'restyle_file', 'get_theme', 'compare_solutions', 'paste_from_filemaker', 'copy_for_filemaker', 'add_image']
    .map((t) => [t, 'design and administration: needs a payload a generic call cannot make, and reads no record data'] as [string, string]),
  ['get_container', 'reached by an id a record read hands out; the record routes are swept for the links they return'],
  ['get_dashboard', 'needs a saved dashboard; the dashboards routes are swept (summarize) with the same field and record limits'],
]);

const skip = (r: Route) => r.method === 'DELETE' || /\/sessions(\/|$)/.test(r.path) && r.method !== 'POST' || /\/(shutdown|restart|restore|uninstall|reset)\b/.test(r.path);

/** The route family of a path: /tabularius/<surface>, /fmi/<surface>, or the first segment. */
const family = (url: string) => url.split('?')[0].split('/').slice(0, url.startsWith('/tabularius/') || url.startsWith('/fmi/') ? 3 : 2).join('/');

async function sweep(authorization: string, token: string, stopAfter = Infinity): Promise<{ found: { call: string; leaks: string[] }[]; reached: Map<string, number> }> {
  const found: { call: string; leaks: string[] }[] = [];
  /** Calls that were answered with a 2xx, by route family: a family nothing got through is a family the sweep has not looked into. */
  const reached = new Map<string, number>();
  for (const r of routes()) {
    if (skip(r)) continue;
    for (const c of calls(r)) {
      const bearer = /^\/(fmi\/data|tabularius\/(?!sql\b))/.test(c.url);
      try {
        const res = await fetch(base + c.url, { method: c.method, headers: { authorization: bearer ? `Bearer ${token}` : authorization, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
          body: c.body, signal: AbortSignal.timeout(8000), redirect: 'manual' });
        const text = await res.text();
        if (res.status < 300) reached.set(family(c.url), (reached.get(family(c.url)) ?? 0) + 1);
        else if (!reached.has(family(c.url))) reached.set(family(c.url), 0);
        const leaks = [...new Set(text.match(LEAK) ?? [])];
        if (leaks.length) found.push({ call: `${c.method} ${c.url}${c.body ? ' ' + c.body.slice(0, 40) : ''}`, leaks });
        if (found.length >= stopAfter) return { found, reached };
      } catch { /* a call that does not answer shows nothing */ }
    }
  }
  return { found, reached };
}

test('control: the sweep sees the values when the account is let to see them', async () => {
  const { found, reached } = await sweep(admin, adminToken);
  assert.ok(found.length >= 6, `a full-access account should show the seeded values on several routes (${found.length})`);
  // Every family of routes must have been answered at least once, or the sweep proves nothing about it.
  const silent = [...reached].filter(([f, n]) => n === 0 && !NOT_SWEPT.has(f)).map(([f]) => f);
  assert.deepEqual(silent, [], 'route families the full-access control got no success from: fix the sweep\'s arguments for them, or list them in NOT_SWEPT with the reason');
});

test('no documented route shows a restricted account what its privileges hide', { timeout: 280_000 }, async () => {
  assert.deepEqual((await sweep(clerk, clerkToken)).found, []);
});

test('no MCP tool shows a restricted account what its privileges hide', { timeout: 280_000 }, async () => {
  const run = async (who: { account: string; password: string }) => {
    const server = createMcpServer(s.host, who);
    const client = new Client({ name: 'sweep', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    const found: { call: string; leaks: string[] }[] = [];
    const answered = new Set<string>();
    const all: string[] = [];
    try {
      const tools = (await client.listTools()).tools;
      for (const tool of tools) {
        all.push(tool.name);
        if (/^(delete|drop|remove|restore|revert|shutdown|restart)/.test(tool.name)) continue;
        const props = Object.keys((tool.inputSchema as { properties?: object }).properties ?? {});
        for (const t of [{ layout: 'Items', table: 'Items', script: 'Public', id: visibleId, field: 'Name' }, { layout: 'Vault', table: 'Vault', script: 'Hush', id: hiddenId, field: 'Secret' }, { layout: 'Items', table: 'Items', script: 'Hush', id: hiddenId, field: 'Echo' }]) {
          const args: Record<string, unknown> = {};
          for (const p of props) {
            if (p === 'database' || p === 'file') args[p] = 'Shop';
            else if (/layout/i.test(p)) args[p] = t.layout;
            else if (/^(table|tableName|name)$/i.test(p)) args[p] = t.table;
            else if (/script/i.test(p)) args[p] = t.script;
            else if (/recordid|^id$/i.test(p)) args[p] = t.id;
            else if (tool.name === 'explain_related' && p === 'field') args[p] = 'External::Value';
            else if (/^(field|fieldName)$/i.test(p)) args[p] = t.field;
            else if (p === 'formula') args[p] = t.field;
            else if (p === 'query') args[p] = [{}];
            else if (p === 'sql') args[p] = `SELECT * FROM ${t.table}`;
            else if (p === 'text' || p === 'q' || p === 'search') args[p] = 'SENTINEL';
            else if (p === 'limit') args[p] = 500;
            else if (p === 'fieldData') args[p] = {};
          }
          // Every argument fitted to its declared type and bounds (and each required one given), so the tool runs and does not stop at validation.
          type Def = { type?: string | string[]; enum?: unknown[]; minimum?: number; maximum?: number; pattern?: string };
          const schema = tool.inputSchema as { properties?: Record<string, Def>; required?: string[] };
          const fit = (def: Def, v: unknown): unknown => {
            const kind = Array.isArray(def.type) ? def.type[0] : def.type;
            if (def.enum && !def.enum.includes(v)) return def.enum[0];
            if (kind === 'number' || kind === 'integer') return typeof v === 'number' ? Math.min(Math.max(v, def.minimum ?? -Infinity), def.maximum ?? Infinity) : Math.max(1, def.minimum ?? 1);
            if (kind === 'boolean') return typeof v === 'boolean' ? v : false;
            if (kind === 'array') return Array.isArray(v) ? v : [];
            if (kind === 'object') return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
            if (kind === 'string') return typeof v === 'string' ? v : /^\^image/.test(def.pattern ?? '') ? 'image/png' : 'x';
            return v;
          };
          for (const [p, def] of Object.entries(schema.properties ?? {})) if (p in args || schema.required?.includes(p)) args[p] = fit(def, args[p]);
          try {
            const r = (await client.callTool({ name: tool.name, arguments: args })) as { content?: { text?: string }[]; isError?: boolean };
            if (!r.isError) answered.add(tool.name);
            const text = JSON.stringify(r);
            const leaks = [...new Set(text.match(LEAK) ?? [])];
            if (leaks.length) found.push({ call: `${tool.name} ${JSON.stringify(args)}`, leaks });
          } catch { /* a refused call shows nothing */ }
        }
      }
    } finally {
      await client.close();
      await server.close();
    }
    return { found, answered, all };
  };
  const control = await run({ account: 'Chief', password: 'pw' });
  assert.ok(control.found.length > 3, `control: full access shows the seeded values through several tools (${control.found.length})`);
  const silent = control.all.filter((t) => !control.answered.has(t) && !/^(delete|drop|remove|restore|revert|shutdown|restart)/.test(t) && !TOOLS_NOT_SWEPT.has(t));
  assert.deepEqual(silent, [], 'tools the full-access control could not run: give the sweep their arguments, or list them in TOOLS_NOT_SWEPT with the reason');
  assert.deepEqual((await run({ account: 'Clerk', password: 'pw' })).found, []);
});
