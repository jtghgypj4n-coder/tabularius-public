// Script test cases and script history over the design API: saved, run offline on a copy (the hosted data
// never changes), recorded from a run; each save of a script listed as text for the editor's History.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-script-tests-api-'));
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

test('test cases are saved, recorded and run offline on a copy; the script\'s saves are its history', async () => {
  const store = host.create('Shop');
  store.setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const design = (path: string, init: RequestInit = {}) => json(`/tabularius/design/v1/databases/Shop${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });

  await design('', { method: 'POST', body: JSON.stringify({ changes: [
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Done', type: 'number' }] },
    { op: 'createScript', name: 'Finish', text: 'Set Field [ Items::Done ; 1 ]\nExit Script [ Text Result: "v1" ]' },
  ] }) });
  store.create('Items', { Name: 'a' });
  const id = store.schema.scripts.find((s) => s.name === 'Finish')!.id;
  await design('', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'updateScript', script: id, text: 'Set Field [ Items::Done ; 1 ]\nExit Script [ Text Result: "v2" ]' }] }) });

  const recorded = await design('/script-tests/record', { method: 'POST', body: JSON.stringify({ script: id, given: {} }) });
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.expect.result, 'v2');

  // A run that can't be set up says why.
  const unset = await design('/script-tests/record', { method: 'POST', body: JSON.stringify({ script: id, given: { layout: 'Gone' } }) });
  assert.equal(unset.status, 400);
  assert.match(unset.body.error?.message ?? JSON.stringify(unset.body), /found set/);

  const saved = await design('/script-tests', { method: 'POST', body: JSON.stringify({ test: { script: id, name: 'finishes', expect: { result: 'v2', error: 0, fields: { 'Items::Done': '1' } } } }) });
  assert.equal(saved.status, 200);
  const bad = await design('/script-tests', { method: 'POST', body: JSON.stringify({ test: { script: id, name: 'no expectations', expect: {} } }) });
  assert.equal(bad.status, 400);

  const listed = await design(`/script-tests?script=${id}`);
  assert.deepEqual(listed.body.tests.map((t: { name: string }) => t.name), ['finishes']);

  const ran = await design('/script-tests/run', { method: 'POST', body: JSON.stringify({ script: id }) });
  assert.equal(ran.status, 200);
  assert.equal(ran.body.outcomes[0].passed, true, JSON.stringify(ran.body));
  // Run on a copy: the hosted record is untouched.
  assert.equal(store.query('SELECT Done FROM Items')[0].Done, null);

  const history = await design(`/scripts/${id}/history`);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.versions.map((v: { text: string }) => /"(v\d)"/.exec(v.text)?.[1]), ['v1', 'v2']);
  assert.equal(history.body.versions[1].account, 'Admin');
  // A rename is no new version, and another script's saves aren't in it.
  await design('', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'updateScript', script: id, name: 'Finish up' }, { op: 'createScript', name: 'Other', text: 'Exit Script [ Text Result: "v9" ]' }] }) });
  assert.equal((await design(`/scripts/${id}/history`)).body.versions.length, 2);

  const gone = await design(`/script-tests/${saved.body.test.id}`, { method: 'DELETE' });
  assert.equal(gone.status, 200);
  assert.equal((await design('/script-tests')).body.tests.length, 0);
});
