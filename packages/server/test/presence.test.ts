// Presence: who has which record open. The web client tells the server which
// record it shows; others see "Also here", and /admin lists it beside the
// records being edited.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { SharedRecordLocks } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-presence-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Ann', 'pw', full.name);
  store.setPassword('Bob', 'pw', full.name);
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
const live = (token: string, path: string, method = 'GET') =>
  fetch(`${base}/tabularius/live/v1/databases/Charts${path}`, { method, headers: { authorization: `Bearer ${token}` } });
const viewers = async (token: string) => (await (await live(token, '/viewers')).json()).viewers;

test('presence: others see who has a record open, until they move on or sign out', { skip }, async () => {
  const ann = await login('Ann');
  const bob = await login('Bob');

  // Bob listens for presence events.
  const abort = new AbortController();
  const events: { kind: string; account?: string; recordId?: number }[] = [];
  const response = await fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: `Bearer ${bob}` }, signal: abort.signal });
  assert.equal(response.status, 200, 'the event stream is listening before changes are made');
  const stream = (async () => {
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      for (const m of value.matchAll(/^data: (.*)$/gm)) events.push(JSON.parse(m[1]));
    }
  })().catch(() => {});

  assert.equal((await live(ann, '/layouts/Congress/records/1/view', 'POST')).status, 200);
  // Renewing is quiet: one "view" event, not two.
  await live(ann, '/layouts/Congress/records/1/view', 'POST');
  assert.deepEqual(await viewers(bob), [{ file: 'Charts', table: 'Congress', recordId: 1, account: 'Ann', self: false }]);
  assert.equal((await viewers(ann))[0].self, true);

  // The admin console lists it.
  const status = await (await fetch(`${base}/tabularius/admin/v1/status`, { headers: { 'x-tabularius-admin': '1' } })).json();
  assert.deepEqual(status.viewing.map((v: { account: string; recordId: number }) => [v.account, v.recordId]), [['Ann', 1]]);

  // Moving to another record.
  await live(ann, '/layouts/Congress/records/1/view', 'DELETE');
  await live(ann, '/layouts/Congress/records/2/view', 'POST');
  assert.deepEqual((await viewers(bob)).map((v: { recordId: number }) => v.recordId), [2]);

  // Signing out clears it.
  await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions/${ann}`, { method: 'DELETE' });
  assert.deepEqual(await viewers(bob), []);

  for (let i = 0; i < 100 && events.filter((e) => e.kind === 'view' || e.kind === 'leave').length < 4; i++)
    await new Promise((ok) => setTimeout(ok, 10));
  abort.abort();
  await stream;
  const presence = events.filter((e) => e.kind === 'view' || e.kind === 'leave').map((e) => `${e.kind} ${e.account} ${e.recordId}`);
  assert.deepEqual(presence, ['view Ann 1', 'leave Ann 1', 'view Ann 2', 'leave Ann 2']);
});

test('presence is shared between server processes and lapses when not renewed', () => {
  const db = new DatabaseSync(':memory:');
  const a = new SharedRecordLocks(db, 'Charts');
  const b = new SharedRecordLocks(db, 'Charts');
  const now = 1_000_000;
  assert.equal(a.view('Congress', 1, 'tok-ann', 'Ann', now), true);
  assert.equal(a.view('Congress', 1, 'tok-ann', 'Ann', now + 1000), false);
  assert.equal(b.view('Congress', 1, 'tok-bob', 'Bob', now), true);
  assert.deepEqual(b.viewers(now + 2000).map((v) => v.account).sort(), ['Ann', 'Bob']);
  // Seeing a record never locks it.
  assert.equal(b.holder('Congress', 1, now), undefined);
  assert.equal(b.leave('Congress', 1, 'tok-bob'), true);
  assert.deepEqual(a.viewers(now + 2000).map((v) => v.account), ['Ann']);
  assert.deepEqual(a.viewers(now + 120_000), []);
});
