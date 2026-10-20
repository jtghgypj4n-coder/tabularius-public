// "Explain and refactor": a drafted version of a script is run against the script itself, offline on a copy,
// from each saved test case's inputs and a plain run, before the editor offers it. The hosted file never changes.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-script-compare-'));
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

const SCRIPT = [
  'Go to Record/Request/Page [ First ]',
  'Loop',
  '  If [ Items::Status = "open" ]',
  '    Set Field [ Items::Status ; "done" ]',
  '    Set Variable [ $$count ; Value: $$count + 1 ]',
  '  End If',
  '  Go to Record/Request/Page [ Next ; Exit after last: On ]',
  'End Loop',
  'Exit Script [ Text Result: $$count ]',
].join('\n');

test('a refactored draft that does the same is proven equal; one that differs lists where', async () => {
  const store = host.create('Shop');
  store.setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const design = (path: string, init: RequestInit = {}) => json(`/tabularius/design/v1/databases/Shop${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });
  const made = await design('', { method: 'POST', body: JSON.stringify({ changes: [
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Status' }, { name: 'Changed', type: 'timestamp', options: { autoEnter: { value: 'modificationTimestamp' } } }] },
    { op: 'createScript', name: 'Close open', text: SCRIPT },
  ] }) });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  for (const [n, st] of [['a', 'open'], ['b', 'held'], ['c', 'open']]) store.create('Items', { Name: n, Status: st });
  const id = store.schema.scripts.find((s) => s.name === 'Close open')!.id;
  const saved = await design('/script-tests', { method: 'POST', body: JSON.stringify({ test: { script: id, name: 'closes two', expect: { result: '2', error: 0 } } }) });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  // The same work, written differently: a guard clause instead of an If block.
  const same = [
    'Go to Record/Request/Page [ First ]',
    'Loop',
    '  If [ Items::Status = "open" ]',
    '    Set Variable [ $$count ; Value: $$count + 1 ]',
    '    Set Field [ Items::Status ; "done" ]',
    '  End If',
    '  Go to Record/Request/Page [ Next ; Exit after last: On ]',
    'End Loop',
    'Exit Script [ Text Result: $$count ]',
  ].join('\n');
  const ok = await design(`/scripts/${id}/compare`, { method: 'POST', body: JSON.stringify({ text: same }) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.equal, true, JSON.stringify(ok.body));
  // The saved case's inputs first, then where the script starts from (a plain run is the same inputs as the saved case here).
  assert.deepEqual(ok.body.cases.map((c: { name: string }) => c.name), ['closes two', 'from layout "Items"']);
  assert.ok(ok.body.tests.every((t: { passed: boolean }) => t.passed));

  // A draft that also closes held items: a different set of records changed, and the saved case fails.
  const wrong = SCRIPT.replace('Items::Status = "open"', 'Items::Status ≠ "done"');
  const bad = await design(`/scripts/${id}/compare`, { method: 'POST', body: JSON.stringify({ text: wrong }) });
  assert.equal(bad.status, 200, JSON.stringify(bad.body));
  assert.equal(bad.body.equal, false);
  const diff = bad.body.cases[0].differences.map((d: { what: string }) => d.what);
  assert.ok(diff.includes('result') && diff.includes('records changed'), JSON.stringify(bad.body.cases));
  assert.equal(bad.body.tests[0].passed, false);

  // Compared against the editor's unsaved steps when it has them: the draft equals those, not the saved script.
  const unsaved = await design(`/scripts/${id}/compare`, { method: 'POST', body: JSON.stringify({ base: wrong, text: wrong }) });
  assert.equal(unsaved.body.cases.every((c: { same: boolean }) => c.same), true, JSON.stringify(unsaved.body));
  // The saved case fails with both, so nothing that passed before fails now.
  assert.equal(unsaved.body.equal, true);

  // Nothing changed on the hosted file: its records and its script.
  assert.deepEqual(store.query('SELECT Status FROM Items ORDER BY _fm_record_id').map((x) => (x as { Status: string }).Status), ['open', 'held', 'open']);
  assert.equal(store.schema.scripts.find((s) => s.id === id)!.steps.length, 9);

  assert.equal((await design(`/scripts/${id}/compare`, { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await design('/scripts/424242/compare', { method: 'POST', body: JSON.stringify({ text: same }) })).status, 404);
});

test('a draft is not proven equal when it changes other records, other global fields or other dialogs, or cannot run', async () => {
  const store = host.create('Proofs');
  store.setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Proofs/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const design = (path: string, init: RequestInit = {}) => json(`/tabularius/design/v1/databases/Proofs${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });
  const script = 'Go to Record/Request/Page [ First ]\nSet Field [ Items::Status ; "b" ]\nSet Field [ Items::gNote ; "x" ]\nShow Custom Dialog [ "Done" ; "All set" ]';
  const made = await design('', { method: 'POST', body: JSON.stringify({ changes: [
    { op: 'createTable', name: 'Items', fields: [{ name: 'Status' }, { name: 'gNote', options: { global: true } }] },
    { op: 'createScript', name: 'Mark', text: script },
  ] }) });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  store.create('Items', { Status: 'a' });
  store.create('Items', { Status: 'a' });
  const id = store.schema.scripts.find((s) => s.name === 'Mark')!.id;
  const compare = async (text: string) => {
    const r = await design(`/scripts/${id}/compare`, { method: 'POST', body: JSON.stringify({ text }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body as { equal: boolean; cases: { same: boolean; differences: { what: string }[] }[] };
  };
  const whats = (r: Awaited<ReturnType<typeof compare>>) => r.cases.flatMap((c) => c.differences.map((d) => d.what));

  assert.equal((await compare(script)).equal, true);
  // The same change to another record with the same values.
  const other = await compare(script.replace('[ First ]', '[ Last ]'));
  assert.equal(other.equal, false);
  assert.ok(whats(other).includes('records changed'), JSON.stringify(other));
  // Another value in a global field (kept per session, not in the records).
  const global = await compare(script.replace('"x"', '"y"'));
  assert.equal(global.equal, false);
  assert.ok(whats(global).some((w) => /gnote/i.test(w)), JSON.stringify(global));
  // Another dialog.
  const dialog = await compare(script.replace('"All set"', '"Nothing done"'));
  assert.equal(dialog.equal, false);
  assert.ok(whats(dialog).includes('dialogs, exports and other client steps'), JSON.stringify(dialog));
});
