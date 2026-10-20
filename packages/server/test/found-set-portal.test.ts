import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { createStore, Store } from '../../store/src/index.ts';

// The web client's side of a found-set portal (a portal on the layout's own occurrence): the layout says which
// portals list the found set, and /foundset gives their rows for the window's found set, in its sort.

let dir = '';
let server: Server | undefined;
let base = '';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-foundset-web-'));
  const path = join(dir, 'People.openhbam.sqlite');
  createStore(path);
  const s = new Store(path, 'People');
  s.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Team' }] }] as never);
  const design = s.design('People')!;
  const to = s.schema.tableOccurrences.find((t) => t.name === 'People')!;
  const fid = s.schema.tables.find((x) => x.name === 'People')!.fields.find((f) => f.name === 'Name')!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const cell = { id: 901, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 22, left: 22, bottom: 40, right: 200 },
    field: { tableOccurrenceId: to.id, fieldId: fid, tableOccurrence: 'People', field: 'Name', display: 'edit', repetitions: 1 } };
  const portal = { id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 20, left: 20, bottom: 300, right: 210 },
    portal: { tableOccurrenceId: to.id, tableOccurrence: 'People', rows: 10, initialRow: 1, scrolling: true }, children: [cell] };
  s.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: [...design.objects, portal] } }] as never);
  for (const [name, team] of [['Cy', 'red'], ['Ada', 'blue'], ['Bo', 'red'], ['Di', 'blue']]) s.create('People', { Name: name, Team: team });
  s.setPassword('Admin', 'pw', '[Full Access]');
  s.close();
  const started = await serve({ dir, port: 0, log: () => {} });
  server = started.server;
  base = started.url;
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test('the layout marks its found-set portal, and /foundset lists the found set in its sort', async () => {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/People/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'x-tabularius-client': 'web' }, body: '{}' });
  const headers = { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
  const app = `${base}/tabularius/app/v1/databases/People/layouts/People`;
  const meta = await (await fetch(app, { headers })).json();
  const p = meta.portals.find((x: { name: string }) => x.name === 'People');
  assert.equal(p.foundSet, true);
  assert.ok(!p.create, 'a found-set portal has no row for new records');
  const red = await (await fetch(`${app}/foundset`, { method: 'POST', headers, body: JSON.stringify({ portal: 'People', query: [{ Team: 'red' }], sort: [{ fieldName: 'Name', sortOrder: 'descend' }] }) })).json();
  assert.equal(red.count, 2);
  assert.deepEqual(red.rows.map((x: Record<string, string>) => x['People::Name']), ['Cy', 'Bo']);
  const page = await (await fetch(`${app}/foundset`, { method: 'POST', headers, body: JSON.stringify({ portal: 'People', sort: [{ fieldName: 'Name', sortOrder: 'ascend' }], offset: 2, limit: 2 }) })).json();
  assert.deepEqual(page.rows.map((x: Record<string, string>) => x['People::Name']), ['Bo', 'Cy']);
  assert.equal(page.count, 4);
  const bad = await fetch(`${app}/foundset`, { method: 'POST', headers, body: '{}' });
  assert.equal(bad.status, 400);
});

test('identity portal retries resolve sort changes and shrinking sets, and prove missing membership', async () => {
  const login = await fetch(`${base}/fmi/data/vLatest/databases/People/sessions`, { method: 'POST',
    headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'x-tabularius-client': 'web' }, body: '{}' });
  const headers = { authorization: `Bearer ${(await login.json()).response.token}`, 'content-type': 'application/json' };
  const records = `${base}/fmi/data/vLatest/databases/People/layouts/People/records`;
  const app = `${base}/tabularius/app/v1/databases/People/layouts/People/foundset`;
  const sort = [{ fieldName: 'Name', sortOrder: 'ascend' }];
  const page = async (extra: Record<string, unknown>) => {
    const response = await fetch(app, { method: 'POST', headers, body: JSON.stringify({ portal: 'People', sort, offset: 1, limit: 1, ...extra }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const saved = await fetch(`${records}/2`, { method: 'PATCH', headers, body: JSON.stringify({ fieldData: { Name: 'Zed' } }) });
  assert.equal(saved.status, 200);
  const reordered = await page({ recordId: '2' });
  assert.equal(reordered.offset, 4, 'identity lookup ignores the stale cached position');
  assert.equal(reordered.count, 4);
  assert.deepEqual(reordered.rows.map((row: Record<string, string>) => [row.recordId, row['People::Name']]), [['2', 'Zed']]);
  const deleted = await fetch(`${records}/1`, { method: 'DELETE', headers });
  assert.equal(deleted.status, 200);
  const empty = await page({ offset: 4 });
  assert.equal(empty.count, 3);
  assert.deepEqual(empty.rows, []);
  const moved = await page({ offset: 4, recordId: '2' });
  assert.equal(moved.offset, 3);
  assert.equal(moved.rows[0].recordId, '2');
  for (const extra of [{ recordId: '1' }, { recordId: '2', query: [{ Team: 'red' }] }, { recordId: '2', ids: [3, 4] }]) {
    const absent = await page(extra);
    assert.equal(absent.offset, 0, 'deleted, omitted and filtered identities cannot reappear');
    assert.deepEqual(absent.rows, []);
  }
});
