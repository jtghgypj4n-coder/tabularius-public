// Working on a design together: who else is in design mode and what they have
// selected, and a `design` change to everyone in design mode when a save lands,
// so their editors merge it in. Nothing is locked. Accounts that can't change
// the design neither see this nor take part.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let layoutId: number;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-together-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest'])] });
  store.setPassword('Ann', 'pw', full.name);
  store.setPassword('Bob', 'pw', full.name);
  store.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'] });
  store.setPassword('Clerk', 'pw', 'Clerk');
  layoutId = (store.sql.prepare("SELECT layout_id FROM _fm_layouts WHERE name = 'Congress'").get() as { layout_id: number }).layout_id;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function login(account: string): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  return (await r.json()).response.token;
}
const presence = (token: string, method = 'GET', body?: unknown) =>
  fetch(`${base}/tabularius/live/v1/databases/Charts/design`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const designers = async (token: string) => (await (await presence(token)).json()).designers;

function listen(token: string) {
  const abort = new AbortController();
  const events: { kind: string; table: string; recordId?: number; account?: string; ids?: number[]; self: boolean }[] = [];
  const ready = fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal }).then(async (r) => {
    assert.equal(r.status, 200, 'event stream connected');
    const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
    void (async () => {
      let pending = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        pending += value;
        for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
          const line = pending.slice(0, newline).trimEnd();
          pending = pending.slice(newline + 1);
          if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
        }
      }
    })().catch(() => { /* abort ends the stream */ });
  });
  return { events, ready, stop: () => abort.abort() };
}
async function untilEvent<T>(read: () => T | undefined): Promise<T> {
  for (const end = Date.now() + 30_000; Date.now() < end; await new Promise((ok) => setTimeout(ok, 25))) {
    const event = read();
    if (event !== undefined) return event;
  }
  throw new Error('timed out waiting for a design event');
}

test('people in design mode see each other, their selection and each save, with nothing locked', { skip }, async () => {
  const ann = await login('Ann');
  const bob = await login('Bob');
  const clerk = await login('Clerk');
  const bobHears = listen(bob);
  const clerkHears = listen(clerk);
  await Promise.all([bobHears.ready, clerkHears.ready]);

  // Ann opens the Congress layout with two objects selected.
  assert.equal((await presence(ann, 'POST', { layout: layoutId, selection: [3, 4, 'x'] })).status, 200);
  assert.deepEqual(await designers(bob), [{ account: 'Ann', layout: layoutId, self: false }]);
  const seen = await untilEvent(() => bobHears.events.find((e) => e.kind === 'designer'));
  assert.deepEqual(seen && { table: seen.table, recordId: seen.recordId, account: seen.account, ids: seen.ids }, { table: '_design', recordId: layoutId, account: 'Ann', ids: [3, 4] });

  // Back to the design lists: still in design mode, on no layout, and only once.
  await presence(ann, 'POST', { layout: 0, selection: [] });
  assert.deepEqual(await designers(ann), [{ account: 'Ann', layout: null, self: true }]);

  // Bob saves a change to the layout while Ann is there: no lock refuses it, and Ann's editor hears which layout.
  const annHears = listen(ann);
  await annHears.ready;
  const save = await fetch(`${base}/tabularius/design/v1/databases/Charts`, {
    method: 'POST', headers: { authorization: `Bearer ${bob}`, 'content-type': 'application/json' },
    body: JSON.stringify({ changes: [{ op: 'updateLayout', layout: layoutId, design: { width: 900 } }] }),
  });
  assert.equal(save.status, 200, await save.clone().text());
  const saved = await untilEvent(() => annHears.events.find((e) => e.kind === 'design'));
  assert.deepEqual(saved && { ids: saved.ids, account: saved.account, self: saved.self }, { ids: [layoutId], account: 'Bob', self: false });

  // Leaving design mode.
  await presence(ann, 'DELETE');
  assert.deepEqual(await designers(bob), []);

  // An account without design access hears none of it and can't join.
  assert.equal(clerkHears.events.filter((e) => e.table === '_design').length, 0);
  assert.equal((await presence(clerk)).status, 403);
  assert.equal((await presence(clerk, 'POST', { layout: layoutId })).status, 403);
  for (const l of [annHears, bobHears, clerkHears]) l.stop();
});

test('scripts and tables have presence too, and saves name the scripts and tables they touched', { skip }, async () => {
  const ann = await login('Ann');
  const bob = await login('Bob');
  const annHears = listen(ann);
  await annHears.ready;
  // Bob opens a script, on line 3; then a table with a field picked.
  const make = await fetch(`${base}/tabularius/design/v1/databases/Charts`, {
    method: 'POST', headers: { authorization: `Bearer ${bob}`, 'content-type': 'application/json' },
    body: JSON.stringify({ changes: [{ op: 'createScript', name: 'Tidy', text: 'Show All Records' }] }),
  });
  assert.equal(make.status, 200, await make.clone().text());
  const made = await make.json();
  const scriptId = made.design.scripts.find((x: { name: string }) => x.name === 'Tidy').id;
  const tableId = made.design.tables[0].id;
  await presence(bob, 'POST', { script: scriptId, selection: [3] });
  assert.deepEqual(await designers(ann), [{ account: 'Bob', layout: null, script: scriptId, self: false }]);
  const moved = await untilEvent(() => annHears.events.find((e) => e.kind === 'designer'));
  assert.deepEqual([moved.table, moved.recordId, moved.ids], ['_design/scripts', scriptId, [3]]);
  await presence(bob, 'POST', { table: tableId, selection: [2] });
  assert.deepEqual(await designers(ann), [{ account: 'Bob', layout: null, table: tableId, self: false }]);

  // Bob saves the script and adds a field: Ann hears which script and which table.
  annHears.events.length = 0;
  await fetch(`${base}/tabularius/design/v1/databases/Charts`, {
    method: 'POST', headers: { authorization: `Bearer ${bob}`, 'content-type': 'application/json' },
    body: JSON.stringify({ changes: [{ op: 'updateScript', script: scriptId, text: 'Show All Records\nSort Records' }, { op: 'createField', table: tableId, name: 'Note', type: 'text' }] }),
  });
  const saves = await untilEvent(() => {
    const all = annHears.events.filter((e) => e.kind === 'design');
    return all.length >= 3 ? all.map((e) => [e.table, e.ids]) : undefined;
  });
  assert.deepEqual(saves, [['_design', []], ['_design/scripts', [scriptId]], ['_design/tables', [tableId]]]);
  await presence(bob, 'DELETE');
  annHears.stop();
});
