// A script's dry run over the design API: it runs once offline on a copy, and shows exactly which records it
// would create, change and delete, each field before and after; the hosted file never changes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { dryRunScript, recordChanges } from '../../scripts/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-script-dry-run-'));
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

test('a dry run lists each record it would create, change or delete, field by field, and saves nothing', async () => {
  const store = host.create('Shop');
  store.setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const design = (path: string, init: RequestInit = {}) => json(`/tabularius/design/v1/databases/Shop${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });
  await design('', { method: 'POST', body: JSON.stringify({ changes: [
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Status' }] },
    { op: 'createScript', name: 'Tidy', text: [
      'Go to Record/Request/Page [ First ]',
      'Set Field [ Items::Status ; "done" ]',
      'Set Field [ Items::Status ; Get ( ScriptParameter ) ]',
      'Go to Record/Request/Page [ Last ]',
      'Delete Record/Request [ With dialog: Off ]',
      'New Record/Request',
      'Set Field [ Items::Name ; "scratch" ]',
      'Delete Record/Request [ With dialog: Off ]',
      'New Record/Request',
      'Set Field [ Items::Name ; "added" ]',
      'Exit Script [ Text Result: Get ( FoundCount ) ]',
    ].join('\n') },
  ] }) });
  for (const n of ['a', 'b', 'c']) store.create('Items', { Name: n, Status: 'open' });
  const id = store.schema.scripts.find((s) => s.name === 'Tidy')!.id;

  const r = await design(`/scripts/${id}/dry-run`, { method: 'POST', body: JSON.stringify({ given: { parameter: 'checked' } }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const recs = r.body.changes.records as { table: string; recordId: number; kind: string; fields: { field: string; before: string; after: string }[] }[];
  const by = (kind: string) => recs.filter((x) => x.kind === kind);
  assert.equal(recs.length, 3, JSON.stringify(recs));
  // Two Set Fields on one record show as one change, from what it was to what it ends as.
  assert.deepEqual(by('update')[0].fields, [{ field: 'Status', before: 'open', after: 'checked' }]);
  assert.equal(by('delete')[0].recordId, 3);
  assert.ok(by('delete')[0].fields.some((f) => f.field === 'Name' && f.before === 'c' && f.after === ''));
  assert.ok(by('create')[0].fields.some((f) => f.field === 'Name' && f.after === 'added'));
  // The record made and deleted again left nothing.
  assert.ok(!recs.some((x) => x.fields.some((f) => f.after === 'scratch' || f.before === 'scratch')));
  assert.equal(r.body.ended.error, 0);

  // Nothing changed on the hosted file.
  assert.deepEqual(store.query('SELECT Name, Status FROM Items ORDER BY _fm_record_id').map((x) => `${(x as { Name: string }).Name}:${(x as { Status: string }).Status}`), ['a:open', 'b:open', 'c:open']);

  const bad = await design(`/scripts/${id}/dry-run`, { method: 'POST', body: JSON.stringify({ given: { layout: 'Gone' } }) });
  assert.equal(bad.status, 400);
  assert.equal((await design('/scripts/424242/dry-run', { method: 'POST', body: '{}' })).status, 404);
});

test('changes are merged per record; a long run lists the first 200 and counts the rest', () => {
  const entries = Array.from({ length: 205 }, (_, i) => ({ seq: i + 1, at: '', account: null, kind: 'update' as const, table: 'T', recordId: i + 1, changes: { x: ['1', '2'] } }));
  const c = recordChanges([...entries, { seq: 999, at: '', account: null, kind: 'update', table: 'T', recordId: 1, changes: { x: ['2', '1'] } }]);
  // Record 1 went back to what it was: no change to show.
  assert.ok(!c.records.some((r) => r.recordId === 1));
  assert.equal(c.records.length, 200);
  assert.equal(c.more, 4);
  const t = recordChanges([{ seq: 1, at: '', account: null, kind: 'truncate', table: 'Log', changes: { records: 12 } }]);
  assert.deepEqual(t.truncated, [{ table: 'Log', records: 12 }]);
});

test('Truncate Table counts only records that were there, and leaves out what the run did to them first', () => {
  const t = recordChanges([
    { seq: 1, at: '', account: null, kind: 'update', table: 'Log', recordId: 1, changes: { x: ['1', '2'] } },
    { seq: 2, at: '', account: null, kind: 'create', table: 'Log', recordId: 9, changes: { x: '3' } },
    { seq: 3, at: '', account: null, kind: 'create', table: 'Other', recordId: 9, changes: { x: '4' } },
    { seq: 4, at: '', account: null, kind: 'truncate', table: 'Log', changes: { records: 6 } },
  ]);
  assert.deepEqual(t.truncated, [{ table: 'Log', records: 5 }]);
  assert.deepEqual(t.records.map((r) => `${r.table} ${r.kind}`), ['Other create']);
});

test('a long value is cut', () => {
  const c = recordChanges([{ seq: 1, at: '', account: null, kind: 'create', table: 'T', recordId: 1, changes: { x: 'y'.repeat(5000) } }]);
  assert.equal(c.records[0].fields[0].after.length, 2001);
});

test('a run that writes more than can be read keeps its earliest changes and says the list is incomplete', async () => {
  const store = host.get('Shop')!;
  store.applyDesign([{ op: 'createScript', name: 'Flood', text: [
    'Go to Record/Request/Page [ First ]',
    'Set Field [ Items::Status ; "first" ]',
    'Loop',
    '  New Record/Request',
    '  Set Variable [ $i ; Value: $i + 1 ]',
    '  Exit Loop If [ $i ≥ 10001 ]',
    'End Loop',
  ].join('\n') }]);
  const id = store.schema.scripts.find((s) => s.name === 'Flood')!.id;
  const r = await dryRunScript(store, id, {}, { maxSteps: 200_000, timeoutMs: 120_000 });
  assert.equal(r.changes.incomplete, true);
  assert.deepEqual(r.changes.records[0], { table: 'Items', recordId: 1, kind: 'update', fields: [{ field: 'Status', before: 'open', after: 'first' }] });
  assert.equal(store.query('SELECT COUNT(*) AS n FROM Items')[0].n, 3);
});

test('a draft\'s dry run lists only as many records as fit, and counts the rest', async () => {
  const { fitChanges } = await import('../src/dry-run.ts');
  const wide = (id: number) => ({ table: 'T', recordId: id, kind: 'delete' as const, fields: Array.from({ length: 100 }, (_, i) => ({ field: `f${i}`, before: 'x'.repeat(1000), after: '' })) });
  const c = fitChanges({ records: [1, 2, 3].map(wide), more: 4, truncated: [] });
  assert.deepEqual(c.records.map((r) => r.recordId), [1]);
  assert.equal(c.more, 6);
});
