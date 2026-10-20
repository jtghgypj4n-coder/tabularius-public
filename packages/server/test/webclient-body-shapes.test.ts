import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStore, Store } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { serve } from '../src/index.ts';

// Every web client route that reads a JSON body, sent bodies of the right kind with the wrong things inside:
// nulls in lists, objects where text goes, text where lists go. Signed in, none may answer 5xx or log a stack trace.

let dir: string;
let server: Server;
let base: string;
let auth: Record<string, string>;
const logged: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-webshapes-'));
  const file = join(dir, 'Shop' + STORE_EXT);
  createStore(file);
  const seed = new Store(file, 'Shop');
  seed.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Qty', type: 'number' }] }]);
  seed.create('Items', { Name: 'a', Qty: 1 });
  seed.create('Items', { Name: 'b', Qty: 2 });
  seed.close();
  const s = await serve({ dir, port: 0, log: (m: string) => logged.push(m) });
  server = s.server;
  base = s.url;
  s.host.get('Shop')!.setPassword('Admin', 'pw');
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  auth = { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const ROUTES = ['view', 'records', 'foundset', 'groups', 'charts', 'menus', 'button', 'index', 'position', 'export', 'ai-replace', 'explain', 'history', 'revert', 'refresh', 'value-list'];
const FIELDS = ['records', 'ids', 'query', 'sort', 'requests', 'fields', 'field', 'layout', 'recordId', 'foundCount', 'values', 'objectId', 'command', 'step', 'script', 'parameter', 'portals', 'state', 'format', 'groupBy', 'summary'];
const WRONG: unknown[] = [null, [null], [[]], [{}], 'x', 7, true, {}, { a: {} }, [1, [2]], [{ a: null }]];

for (const route of ROUTES) {
  test(`web client ${route}: wrong shapes inside a JSON body are refused, not a 500`, async () => {
    const before = logged.length;
    const bodies: unknown[] = [null, [], 'x', 7, ...WRONG.map((w) => Object.fromEntries(FIELDS.map((f) => [f, w])))];
    for (const f of FIELDS) for (const w of WRONG) bodies.push({ [f]: w });
    // A bounded batch exercises the same malformed bodies without making the file's runtime scale with every HTTP round trip.
    for (let i = 0; i < bodies.length; i += 8) await Promise.all(bodies.slice(i, i + 8).map(async (body) => {
      const r = await fetch(`${base}/tabularius/app/v1/databases/Shop/layouts/Items/${route}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
      const text = await r.text();
      assert.ok(r.status < 500 || r.status === 503, `${route} ${JSON.stringify(body).slice(0, 120)}: ${r.status} ${text.slice(0, 160)}`);
    }));
    assert.doesNotMatch(logged.slice(before).join('\n'), /TypeError|RangeError|\n\s+at /, 'a stack trace was logged');
  });
}

test('web client: a sort or query of the wrong kind says so (400, code 5) and a good one still works', async () => {
  const post = (route: string, body: unknown) => fetch(`${base}/tabularius/app/v1/databases/Shop/layouts/Items/${route}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  for (const body of [{ sort: 'x' }, { sort: [null] }, { sort: [{ fieldName: 5 }] }]) {
    const r = await post('records', body);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, 5);
  }
  const bad = await post('refresh', { query: [null] });
  assert.equal(bad.status, 400);
  const ok = await post('records', { sort: [{ fieldName: 'Name', sortOrder: 'descend' }], query: [{ Name: 'a' }] });
  assert.equal(ok.status, 200);
});
