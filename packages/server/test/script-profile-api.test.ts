// The script editor's profiler over the design API: each step's own time and how many times a run it ran,
// placed on its line of the script's text (a comment over several lines included); steps changed since they
// were timed are left out; "Profile a run" times one run offline on a copy, so the hosted data never changes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { runScript } from '../../scripts/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-script-profile-'));
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

test('each step\'s time and run count, on its line; changed steps left out; a run profiled on a copy', async () => {
  const store = host.create('Shop');
  store.setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const design = (path: string, init: RequestInit = {}) => json(`/tabularius/design/v1/databases/Shop${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });

  await design('', { method: 'POST', body: JSON.stringify({ changes: [
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
    { op: 'createScript', name: 'Count', text: '# Counts to the parameter\nSet Variable [ $i ; Value: 0 ]\nLoop\n\tSet Variable [ $i ; Value: $i + 1 ]\n\tExit Loop If [ $i ≥ GetAsNumber ( Get ( ScriptParameter ) ) ]\nEnd Loop\nNew Record/Request\nExit Script [ Text Result: $i ]' },
  ] }) });
  const script = store.schema.scripts.find((s) => s.name === 'Count')!;
  // A comment over two lines, as FileMaker allows: the steps after it are a line further down.
  store.applyDesign([{ op: 'updateScript', script: script.id, steps: [{ stepId: 89, name: '#', enabled: true, text: 'Counts to\nthe parameter' }, ...script.steps.slice(1)] } as never]);
  const id = script.id;
  const text = store.schema.scripts.find((s) => s.id === id)!;
  assert.equal(text.steps.length, 8);

  const none = await design(`/scripts/${id}/profile`);
  assert.equal(none.status, 200);
  assert.equal(none.body.profile, null);
  assert.equal(none.body.recording, true);

  // Two runs on the server, as the Data API, a schedule or the web client run them.
  for (const n of ['5', '15']) await runScript(store, 'Count', { parameter: n, profile: host.scriptOptions().profile });
  const { body } = await design(`/scripts/${id}/profile`);
  assert.equal(body.profile.runs, 2);
  const step = (i: number) => body.profile.steps.find((s: { index: number }) => s.index === i);
  assert.equal(step(3).count, 20, 'the loop\'s step ran 5 + 15 times');
  assert.equal(step(3).perRun, 10);
  assert.equal(step(1).perRun, 1);
  assert.equal(step(1).at, 3, 'after the two-line comment');
  assert.equal(step(3).at, 5);
  assert.equal(body.profile.changed, 0);
  assert.equal(store.query('SELECT * FROM Items').length, 2);

  // Change a timed step: its timing no longer matches what's there, so it's left out.
  const now = store.schema.scripts.find((s) => s.id === id)!;
  store.applyDesign([{ op: 'updateScript', script: id, steps: now.steps.map((s, i) => i === 6 ? { ...s, line: undefined, name: 'Commit Records/Requests', stepId: 75, params: {} } : s) } as never]);
  const after = (await design(`/scripts/${id}/profile`)).body.profile;
  assert.equal(after.changed, 1);
  assert.ok(!after.steps.some((s: { index: number }) => s.index === 6));

  // Profile a run: offline, on a copy.
  const run = await design(`/scripts/${id}/profile`, { method: 'POST', body: JSON.stringify({ given: { parameter: '3' } }) });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.ended.result, '3');
  assert.equal(run.body.profile.runs, 1);
  assert.equal(run.body.profile.steps.find((s: { index: number }) => s.index === 3).count, 3);
  assert.equal(store.query('SELECT * FROM Items').length, 2, 'the hosted file is unchanged');

  const bad = await design(`/scripts/${id}/profile`, { method: 'POST', body: JSON.stringify({ given: { parameter: 'x'.repeat(20_001) } }) });
  assert.equal(bad.status, 400);
  assert.equal((await design('/scripts/424242/profile')).status, 404);
});
