// Improve over the design API: refactor hints for the saved script (with the profiler's timings) or for the text the
// editor has open, and a dry run of drafted steps that never touches the saved script or the hosted file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-script-refactor-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const json = (path: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

const LOOP = [
  'Go to Record/Request/Page [ First ]',
  'Loop',
  '\tSet Field [ Items::Status ; "done" ]',
  '\tGo to Record/Request/Page [ Next ; Exit after last: On ]',
  'End Loop',
].join('\n');

test('hints for the saved script and for unsaved text; a drafted change dry-runs on a copy only', async () => {
  const store = host.create('Shop');
  store.setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const design = (path: string, init: RequestInit = {}) => json(`/tabularius/design/v1/databases/Shop${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });
  await design('', { method: 'POST', body: JSON.stringify({ changes: [
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Status' }] },
    { op: 'createScript', name: 'Close all', text: LOOP },
  ] }) });
  for (const n of ['a', 'b']) store.create('Items', { Name: n, Status: 'open' });
  const id = store.schema.scripts.find((s) => s.name === 'Close all')!.id;

  const saved = await design(`/scripts/${id}/refactor`);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.hints.map((x: { kind: string }) => x.kind), ['record-loop']);
  assert.equal(saved.body.timed, false);

  const draft = 'Go to Record/Request/Page [ First ]\nReplace Field Contents [ With dialog: Off ; Items::Status ; "done" ]';
  const unsaved = await design(`/scripts/${id}/refactor`, { method: 'POST', body: JSON.stringify({ text: draft }) });
  assert.deepEqual(unsaved.body.hints, []);
  assert.equal((await design(`/scripts/${id}/refactor`, { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await design('/scripts/424242/refactor')).status, 404);

  // The draft's dry run: both records change, on the copy; the saved script and the hosted records stay as they were.
  const r = await design(`/scripts/${id}/dry-run`, { method: 'POST', body: JSON.stringify({ given: {}, text: draft }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual((r.body.changes.records as { kind: string; fields: { after: string }[] }[]).map((x) => `${x.kind}:${x.fields[0].after}`), ['update:done', 'update:done']);
  assert.equal(r.body.ended.error, 0);
  assert.ok(!host.get('Shop')!.schema.scripts.find((s) => s.id === id)!.steps.some((s) => s.name === 'Replace Field Contents'));
  assert.deepEqual(store.query('SELECT Status FROM Items').map((x) => (x as { Status: string }).Status), ['open', 'open']);
  assert.equal((await design(`/scripts/${id}/dry-run`, { method: 'POST', body: JSON.stringify({ given: {}, text: 42 }) })).status, 400);
});
