import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp } from '../../store/src/index.ts';

// A request may ask for at most TABULARIUS_DATA_API_MAX_LIMIT records (default 10,000) at a time, in a range or a find,
// and portal rows count the same way. More is refused with 960, not cut down.

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-limit-cap-'));
  createStore(join(dir, 'L' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('L')!;
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }] as DesignOp[]);
  for (const n of ['a', 'b', 'c']) store.create('Items', { Name: n });
  store.setPassword('Admin', 'pw', '[Full Access]');
});

after(async () => {
  delete process.env.TABULARIUS_DATA_API_MAX_LIMIT;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function call(path: string, auth: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}/fmi/data/vLatest${path}`, { method, headers: { authorization: auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test('a limit above the cap is refused with 960 and the way to page, and the cap can be changed', async () => {
  const token = (await call('/databases/L/sessions', 'Basic ' + btoa('Admin:pw'), 'POST', {})).body.response.token;
  const bearer = 'Bearer ' + token;
  const L = '/databases/L/layouts/Items';
  delete process.env.TABULARIUS_DATA_API_MAX_LIMIT;

  // The default is 10,000: that is allowed, one more is not, in a range and in a find, and for a portal's rows.
  assert.equal((await call(`${L}/records?_limit=10000`, bearer)).status, 200);
  const range = await call(`${L}/records?_limit=10001`, bearer);
  assert.equal(range.status, 400);
  assert.equal(range.body.messages[0].code, '960');
  assert.match(range.body.messages[0].message, /_limit may be at most 10,000; ask for the records in pages \(use _offset\)/);
  const find = await call(`${L}/_find`, bearer, 'POST', { query: [{ Name: '*' }], limit: 10001 });
  assert.equal(find.body.messages[0].code, '960');
  assert.equal((await call(`${L}/_find`, bearer, 'POST', { query: [{ Name: '*' }], limit: '2' })).body.response.data.length, 2);
  assert.equal((await call(`${L}/records?_limit.Rows=10001`, bearer)).body.messages[0].code, '960');

  // A lower cap from the environment applies on the next request; 0 turns the cap off; a bad value is the default.
  process.env.TABULARIUS_DATA_API_MAX_LIMIT = '2';
  assert.equal((await call(`${L}/records?_limit=2`, bearer)).body.response.data.length, 2);
  assert.match((await call(`${L}/records?_limit=3`, bearer)).body.messages[0].message, /at most 2;/);
  process.env.TABULARIUS_DATA_API_MAX_LIMIT = '0';
  assert.equal((await call(`${L}/records?_limit=1000000`, bearer)).status, 200);
  process.env.TABULARIUS_DATA_API_MAX_LIMIT = 'lots';
  assert.equal((await call(`${L}/records?_limit=10001`, bearer)).body.messages[0].code, '960');
  // The offset and a limit of zero are as before.
  delete process.env.TABULARIUS_DATA_API_MAX_LIMIT;
  assert.equal((await call(`${L}/records?_limit=0`, bearer)).body.response.data.length, 0);
});
