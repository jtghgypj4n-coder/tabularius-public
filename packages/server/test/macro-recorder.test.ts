// The web client's macro recorder: recorded actions become a clean script whose
// every line the script editor reads back, and a Dry run of it (before it is
// saved) shows what it would change on a copy, leaving the hosted file alone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { parseScriptText } from '../../store/src/index.ts';
import { macroScript, type MacroAction } from '../../web/src/macro.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-macro-'));
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

const recorded: MacroAction[] = [
  { kind: 'layout', layout: 'People' },
  { kind: 'layout', layout: 'Items' },
  { kind: 'find', occurrence: 'Items', requests: [{ Status: 'open' }, { Name: 'b', omit: 'true' } as never] },
  { kind: 'sort', occurrence: 'Items', sort: [{ fieldName: 'Name', sortOrder: 'ascend' }] },
  { kind: 'sort', occurrence: 'Items', sort: [{ fieldName: 'Name', sortOrder: 'descend' }] },
  { kind: 'go', to: 'first' },
  { kind: 'set', occurrence: 'Items', field: 'Status', value: 'typo' },
  { kind: 'set', occurrence: 'Items', field: 'Note', value: 'Said "yes"\nthen left' },
  { kind: 'set', occurrence: 'Items', field: 'Status', value: 'done' },
  { kind: 'skipped', what: 'a field in a portal row (Lines::Qty)' },
  { kind: 'new' },
  { kind: 'set', occurrence: 'Items', field: 'Name', value: 'added' },
];

test('recorded actions become a clean script the editor reads back', () => {
  const { text, steps, notes } = macroScript(recorded, new Date('2026-10-13T01:30:00Z'));
  assert.equal(text, [
    '# Recorded in the web client 2026-10-13 01:30 UTC',
    'Go to Layout [ “Items” ]',
    'Perform Find [ Restore ; Find: Items::Status: “open” ; Omit: Items::Name: “b” ]',
    'Sort Records [ Restore ; With dialog: Off ; Items::Name ; descending ]',
    'Go to Record/Request/Page [ First ]',
    'Set Field [ Items::Note ; "Said \\"yes\\"¶then left" ]',
    'Set Field [ Items::Status ; "done" ]',
    '# Not recorded: a field in a portal row (Lines::Qty)',
    'Commit Records/Requests [ With dialog: Off ]',
    'New Record/Request',
    'Set Field [ Items::Name ; "added" ]',
    'Commit Records/Requests [ With dialog: Off ]',
  ].join('\n'));
  assert.equal(steps, 10);
  assert.deepEqual(notes, ['a field in a portal row (Lines::Qty)']);
});

test('a Dry run of the recording shows its changes on a copy, and Save makes it a script', async () => {
  const store = host.create('Shop');
  store.setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const design = (path: string, init: RequestInit = {}) => json(`/tabularius/design/v1/databases/Shop${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });
  await design('', { method: 'POST', body: JSON.stringify({ changes: [
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Status' }, { name: 'Note' }] },
    { op: 'createTable', name: 'People', fields: [{ name: 'Name' }] },
  ] }) });
  for (const [n, s] of [['a', 'open'], ['b', 'open'], ['c', 'open'], ['d', 'closed']]) store.create('Items', { Name: n, Status: s });
  const { text } = macroScript(recorded);
  // Every line reads back as a step (nothing silently lost).
  assert.equal(parseScriptText(text, store.schema).length, text.split('\n').length);

  const r = await design('/scripts/dry-run', { method: 'POST', body: JSON.stringify({ text }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const recs = r.body.changes.records as { kind: string; recordId: number; fields: { field: string; before: string; after: string }[] }[];
  // Sorted descending, the first of the open records but "b" is "c".
  const changed = recs.find((x) => x.kind === 'update')!;
  assert.equal(changed.recordId, 3);
  assert.deepEqual(changed.fields.find((f) => f.field === 'Status'), { field: 'Status', before: 'open', after: 'done' });
  assert.ok(changed.fields.some((f) => f.field === 'Note' && f.after.includes('"yes"')));
  assert.ok(recs.some((x) => x.kind === 'create' && x.fields.some((f) => f.field === 'Name' && f.after === 'added')));
  assert.equal(r.body.ended.error, 0);
  // The hosted file is as it was.
  assert.equal(store.find('Items', { limit: 10 }).records.length, 4);
  assert.equal(store.schema.scripts.length, 0);

  const saved = await design('', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'createScript', name: 'Close open items', text }] }) });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(store.schema.scripts.map((x) => x.name), ['Close open items']);

  // Criteria with AND, a ¶ and quotes in them read back as typed (the find splits on AND outside quotes only).
  const tricky = macroScript([{ kind: 'find', occurrence: 'Items', requests: [{ Name: 'Tom AND Jerry', Status: 'open' }] }, { kind: 'set', occurrence: 'Items', field: 'Note', value: 'a¶b "c"' }]).text;
  const steps = parseScriptText(tricky, store.schema);
  const criteria = steps[1].params!.requests![0].criteria;
  assert.deepEqual(criteria.map((c) => c.criteria), ['Tom AND Jerry', 'open']);
  const run = await design('/scripts/dry-run', { method: 'POST', body: JSON.stringify({ text: tricky.replace('Tom AND Jerry', 'a') }) });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.ok(run.body.changes.records.some((r: { fields: { field: string; after: string }[] }) => r.fields.some((f) => f.field === 'Note' && f.after === 'a¶b "c"')), JSON.stringify(run.body.changes));

  const bad = await design('/scripts/dry-run', { method: 'POST', body: JSON.stringify({ text: 'Go to Layout [ “Nowhere” ]' }) });
  assert.equal(bad.status, 400);
  assert.match(bad.body.messages?.[0]?.message ?? JSON.stringify(bad.body), /Nowhere/);
});
