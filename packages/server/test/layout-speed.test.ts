// Make it faster: a slow layout's redesigns over HTTP, the assistant's ideas for what has no mechanical one
// (checked against the file, ones that don't fit left out), and none of it for a file with AI turned off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;
let model: Server;
let layoutId: number;
/** What the model was sent, and what it answers. */
const asked: string[] = [];
let ideas: unknown[] = [];

before(async () => {
  model = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      asked.push(body);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify({ ideas }) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
      }));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-speed-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  host = s.host;
  const store = host.get('Shop')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest', 'fmmcp'])] });
  store.setPassword('Admin', 'pw');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' }, { name: 'Open', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createField', table: 'Customers', name: 'Spent', kind: 'calculation', type: 'number', calculation: 'Sum ( Orders::Amount )', options: { unstored: true } },
  ] as never, { account: 'Admin' });
  for (let i = 1; i <= 10; i++) {
    store.create('Customers', { Id: String(i) });
    for (let j = 0; j < 100; j++) store.create('Orders', { CustomerId: String(i), Amount: '2', Open: String(j % 2) });
  }
  const sc = store.schema;
  const to = (n: string) => sc.tableOccurrences.find((t) => t.name === n)!.id;
  const fid = (t: string, n: string) => sc.tables.find((x) => x.name === t)!.fields.find((x) => x.name === n)!.id;
  const d = store.designs().layouts.find((l) => l.name === 'Customers')!;
  layoutId = d.id;
  const body = d.parts.find((p) => p.kind === 'body')!;
  const base0 = { anchors: { left: true, top: true, right: false, bottom: false }, style: {} };
  const field = (id: number, t: string, n: string, top: number): LayoutObject => ({
    ...base0, id, kind: 'field', type: 0, bounds: { top, left: 10, bottom: top + 18, right: 110 },
    field: { tableOccurrenceId: to(t), tableOccurrence: t, fieldId: fid(t, n), field: n, display: 'edit', repetitions: 1 },
  } as LayoutObject);
  const objects: LayoutObject[] = [
    field(901, 'Customers', 'Spent', body.top + 2),
    { ...base0, id: 902, kind: 'portal', type: 0, bounds: { top: body.top + 30, left: 10, bottom: body.top + 130, right: 300 },
      portal: { tableOccurrenceId: to('Orders'), rows: 5, initialRow: 1, filter: 'Orders::Open = 1' }, children: [field(903, 'Orders', 'Amount', body.top + 32)] } as LayoutObject,
  ];
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { view: 'list', objects, parts: d.parts.map((p) => (p.kind === 'body' ? { ...p, height: 200 } : p)) } }] as never, { account: 'Admin' });
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function speed(body: unknown): Promise<any> {
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}',
  });
  const tok = (await login.json()).response.token;
  const r = await fetch(`${base}/tabularius/design/v1/databases/Shop/layouts/${layoutId}/speed`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify(body),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}

test('the slow calculation gets a stored replacement; the portal filter is left for a person or the assistant', async () => {
  const plan = await speed({});
  assert.ok(plan.before > 0);
  assert.equal(plan.moves.length, 1);
  assert.match(plan.moves[0].title, /Spent stored/);
  assert.ok(plan.moves[0].after < plan.before);
  assert.deepEqual(plan.left.map((i: { kind: string }) => i.kind), ['portal filter']);
  assert.equal(plan.ai, undefined);
});

test('the assistant\'s idea for the filter becomes a move with its cost; an idea that deletes is left out', async () => {
  ideas = [
      {
        finding: 0, title: 'Match open orders in a relationship', objectIds: [902],
        add: [
          { op: 'createField', table: 'Customers', name: 'One', kind: 'calculation', type: 'number', calculation: '1' },
          { op: 'createOccurrence', name: 'Open orders', table: 'Orders' },
          { op: 'createRelationship', left: 'Customers', right: 'Open orders', predicates: [{ left: 'Id', right: 'CustomerId' }, { left: 'One', right: 'Open' }] },
        ],
        edits: [{ portal: 902, occurrence: 'Open orders', filter: null }],
      },
    { finding: 0, title: 'Throw the table away', add: [{ op: 'deleteTable', table: 'Orders' }] },
  ];
  const plan = await speed({ ai: true });
  // Design only went to the model: names and formulas, no record.
  assert.equal(asked.length, 1);
  assert.match(asked[0], /Orders::Open = 1/);
  assert.doesNotMatch(asked[0], /\\"Amount\\":\\"?2/);
  const idea = plan.moves.find((m: { ai?: boolean }) => m.ai);
  assert.ok(idea, JSON.stringify(plan));
  assert.ok(idea.after < plan.before);
  assert.equal(plan.ai.ideas, 1);
  assert.match(plan.ai.dropped[0], /Throw the table away/);
  assert.deepEqual(plan.left, []);
  // Applied as it stands: the portal shows the new occurrence and its rows' field comes with it, with no filter.
  const store = host.get('Shop')!;
  store.applyDesign(idea.changes, { account: 'Admin' });
  const portal = store.design(layoutId)!.objects.find((o) => o.id === 902)!;
  const open = store.schema.tableOccurrences.find((t) => t.name === 'Open orders')!;
  assert.equal(portal.portal!.tableOccurrenceId, open.id);
  assert.equal(portal.portal!.filter, undefined);
  assert.equal(portal.children![0].field!.tableOccurrenceId, open.id);
});

test('with AI off for the file, no idea is asked for and the plan says why', async () => {
  asked.length = 0;
  host.get('Shop')!.setAiAllowed(false, { account: 'Admin' });
  // Something slow is still left (a filter on the related calculation's portal is gone): put one back.
  const store = host.get('Shop')!;
  const d = store.design(layoutId)!;
  const objects = d.objects.map((o) => (o.id === 902 ? { ...o, portal: { ...o.portal!, filter: 'Open orders::Amount > 1' } } : o));
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { objects } }] as never, { account: 'Admin' });
  const plan = await speed({ ai: true });
  assert.equal(asked.length, 0);
  assert.match(plan.ai.note, /AI is turned off/i);
  host.get('Shop')!.setAiAllowed(true, { account: 'Admin' });
});
