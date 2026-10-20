// A script's dependency map over the design API: what it uses (with the lines), what starts it, and how it
// reaches outside the file; fields named in text are marked, since a rename doesn't reach them.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-script-deps-'));
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

test('a script lists what it uses, line by line, what starts it and how it reaches outside', async () => {
  const store = host.create('Deps');
  store.setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Deps/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const design = (path: string, init: RequestInit = {}) => json(`/tabularius/design/v1/databases/Deps${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });
  const made = await design('', { method: 'POST', body: JSON.stringify({ changes: [
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Status' }] },
    { op: 'createScript', name: 'Notify', text: 'Send Mail [ Send via E-mail Client ; With dialog: On ; To: "a@example.com" ]' },
    { op: 'createScript', name: 'Close', text: [
      'Go to Layout [ "Items" ]',
      'Set Field [ Items::Status ; "done" ]',
      'Set Variable [ $n ; Value: Items::Status & GetField ( "Items::Name" ) ]',
      'Perform Script [ "Notify" ]',
      'Set Field [ Items::Status ; Items::Status & "!" ]',
    ].join('\n') },
    { op: 'createScript', name: 'Nightly', text: 'Perform Script [ "Close" ]' },
  ] }) });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = store.schema.scripts.find((s) => s.name === 'Close')!.id;

  const r = await design(`/scripts/${id}/dependencies`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const uses = r.body.uses as { kind: string; name: string; lines: number[]; byName?: boolean }[];
  const find = (kind: string, name: string) => uses.find((u) => u.kind === kind && u.name.toLowerCase() === name.toLowerCase());
  assert.deepEqual(find('field', 'Items::Status')?.lines, [2, 3, 5], JSON.stringify(uses));
  // Referenced directly on the same line as a GetField: a rename follows it, so it is not "by name".
  assert.equal(find('field', 'Items::Status')?.byName, undefined);
  // GetField ( "Items::Name" ) names the field in text: a rename leaves it behind.
  assert.equal(find('field', 'Items::Name')?.byName, true, JSON.stringify(uses));
  assert.deepEqual(find('layout', 'Items')?.lines, [1]);
  assert.deepEqual(find('script', 'Notify')?.lines, [4]);
  assert.deepEqual(r.body.startedBy, [{ how: 'script', name: 'Nightly' }]);

  // The script it performs reaches outside; its own map says so.
  const notify = await design(`/scripts/${store.schema.scripts.find((s) => s.name === 'Notify')!.id}/dependencies`);
  assert.deepEqual(notify.body.outbound, ['Send Mail']);
  assert.deepEqual(notify.body.startedBy, [{ how: 'script', name: 'Close' }]);

  assert.equal((await design('/scripts/424242/dependencies')).status, 404);
});
