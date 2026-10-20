// Hosting a FileMaker file uploaded through the admin console: pieces, then
// conversion with progress, then the file is hosted and its report is kept.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { type Upload } from '../src/uploads.ts';
import type { Host } from '../src/host.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-uploads-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const admin = (path: string, method = 'GET', body?: BodyInit | object, headers: Record<string, string> = { 'x-tabularius-admin': '1' }) =>
  fetch(`${base}/tabularius/admin/v1/uploads${path}`, {
    method,
    headers: { ...headers, ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: body instanceof Uint8Array ? (body as unknown as BodyInit) : JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

async function settled(id: string): Promise<Upload> {
  for (let i = 0; i < 600; i++) {
    const r = await admin(`/${id}`);
    if (r.body.phase === 'hosted' || r.body.phase === 'failed') return r.body;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('conversion never finished');
}

test('an uploaded .fmp12 is converted and hosted, with its report', { skip }, async () => {
  const bytes = new Uint8Array(readFileSync(fixture));
  const start = await admin('', 'POST', { name: 'Charts.fmp12', size: bytes.length });
  assert.equal(start.status, 201);
  const id = start.body.id as string;

  // A piece that skips ahead is refused; pieces in order (and a retried one) are fine.
  const half = bytes.length >> 1;
  assert.equal((await admin(`/${id}?offset=10`, 'PUT', bytes.subarray(10, 20))).status, 409);
  assert.equal((await admin(`/${id}?offset=0`, 'PUT', bytes.subarray(0, half))).body.received, half);
  assert.equal((await admin(`/${id}?offset=0`, 'PUT', bytes.subarray(0, half))).body.received, half);
  // Finishing early is refused.
  assert.equal((await admin(`/${id}/finish`, 'POST')).status, 409);
  // More than the declared size is refused.
  assert.equal((await admin(`/${id}?offset=${half}`, 'PUT', new Uint8Array(bytes.length))).status, 413);
  assert.equal((await admin(`/${id}?offset=${half}`, 'PUT', bytes.subarray(half))).body.received, bytes.length);

  // Another upload under the same name, while this one is under way, is refused.
  assert.equal((await admin('', 'POST', { name: 'charts.fmp12', size: 10 })).status, 409);

  assert.equal((await admin(`/${id}/finish`, 'POST')).status, 200);
  const done = await settled(id);
  assert.equal(done.phase, 'hosted', done.error);
  assert.ok(done.tables! > 0 && done.records! > 0);
  assert.ok(done.report?.summary, 'the conversion report is kept');
  assert.ok(done.optimization && done.optimization.items > 0 && /ways to make it smaller and faster/.test(done.optimization.text), 'ways to make it smaller and faster come with it');

  // Hosted live: the store is open, the .fmp12 sits beside it, and the upload's pieces are gone.
  const store = host.get('Charts');
  assert.ok(store);
  assert.ok(Number(store.query('SELECT count(*) AS n FROM Congress')[0].n) > 0);
  assert.ok(existsSync(join(dir, 'Charts.fmp12')));
  assert.deepEqual(readdirSync(join(dir, '.openhbam-uploads')), []);

  // And it answers the Data API.
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw');
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') } });
  assert.equal(login.status, 200);

  // Now it's hosted, the name is taken.
  assert.equal((await admin('', 'POST', { name: 'Charts.fmp12', size: 10 })).status, 409);

  // A finished upload can be cleared from the list.
  assert.equal((await admin(`/${id}`, 'DELETE')).status, 200);
  assert.equal((await admin(`/${id}`)).status, 404);
});

test('a file that is not FileMaker fails and leaves nothing behind', { skip }, async () => {
  const junk = new TextEncoder().encode('this is not a FileMaker file at all'.repeat(200));
  const start = await admin('', 'POST', { name: 'Junk.fmp12', size: junk.length });
  const id = start.body.id as string;
  await admin(`/${id}?offset=0`, 'PUT', junk);
  await admin(`/${id}/finish`, 'POST');
  const done = await settled(id);
  assert.equal(done.phase, 'failed');
  assert.ok(done.error);
  assert.equal(host.get('Junk'), undefined);
  assert.ok(!existsSync(join(dir, 'Junk.fmp12')));
  assert.ok(!readdirSync(dir).some((f) => f.startsWith('Junk')), 'no half-made store');
  assert.deepEqual(readdirSync(join(dir, '.openhbam-uploads')), []);
});

test('uploads need the console, and only .fmp12 names', { skip }, async () => {
  assert.equal((await admin('', 'POST', { name: 'x.fmp12', size: 10 }, {})).status, 403);
  assert.equal((await admin('', 'POST', { name: 'x.csv', size: 10 })).status, 400);
  assert.equal((await admin('', 'POST', { name: 'x.fmp12', size: -1 })).status, 400);
  const start = await admin('', 'POST', { name: 'Gone.fmp12', size: 10 });
  assert.equal((await admin(`/${start.body.id}`, 'DELETE')).status, 200);
  assert.equal((await admin(`/${start.body.id}?offset=0`, 'PUT', new Uint8Array(10))).status, 404);
});
