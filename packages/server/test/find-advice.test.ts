// Slow finds and what would speed them up: finds are timed by table, fields and sort, and the advice names an index
// to add where a stored field has none, or says why no index can help.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import type { Profiler } from '../src/profiler.ts';
import { findAdvice } from '../src/find-advice.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-finds-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  store = s.host.get('Charts')!;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const advice = () => findAdvice((n) => host.get(n), (host.profiler as Profiler).findReport(), { all: true });

test('finds are timed by shape, and the advice names an index or says why none helps', { skip }, async () => {
  store.find('Congress', { query: [{ State: 'OH' }], sort: [{ fieldName: 'Name' }] });
  store.find('Congress', { query: [{ State: 'TX' }], sort: [{ fieldName: 'Name' }] });
  store.find('Congress', { query: [{ Name: '*son' }] });
  store.find('NW Customers', { query: [{ 'Total Sales': '>1000' }] });
  const all = advice();
  const ohio = all.find((a) => a.table === 'Congress' && a.fields.join() === 'State')!;
  assert.equal(ohio.count, 2, 'the same shape, whatever the values');
  assert.deepEqual(ohio.sort, ['Name']);
  assert.match(ohio.summary, /^Finds in Congress by State, sorted by Name took .+ over 2 finds, on 540 records\.$/);
  const state = ohio.suggestions.find((x) => x.kind === 'index' && x.field === 'State');
  assert.ok(state, JSON.stringify(ohio.suggestions));
  assert.match((state as { why: string }).why, /An index on Congress::State lets finds on it skip reading all 540 records/);
  const wild = all.find((a) => a.table === 'Congress' && a.fields.join() === 'Name')!;
  assert.ok(wild.suggestions.some((x) => x.kind === 'hint' && /started a criterion with \*/.test(x.text)));
  const sales = all.find((a) => a.table === 'NW Customers')!;
  assert.ok(sales.suggestions.some((x) => x.kind === 'hint' && /NW Customers::Total Sales is an unstored calculation/.test(x.text)), JSON.stringify(sales.suggestions));
  assert.ok(!sales.suggestions.some((x) => x.kind === 'index'));

  // One click adds the index, and the advice stops suggesting it.
  const add = await (await fetch(`${base}/tabularius/admin/v1/indexes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ database: 'Charts', table: 'Congress', field: 'State' }) })).json();
  assert.equal(add.created, true);
  assert.ok(store.indexedFields('Congress').has('State'));
  assert.ok(!advice().find((a) => a.fields.join() === 'State')!.suggestions.some((x) => x.kind === 'index' && x.field === 'State'));
  const bad = await fetch(`${base}/tabularius/admin/v1/indexes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ database: 'Charts', table: 'NW Customers', field: 'Total Sales' }) });
  assert.equal(bad.status, 400);
  // The console's list only shows finds slow enough to matter.
  const listed = await (await fetch(`${base}/tabularius/admin/v1/profile/finds`)).json();
  assert.ok(Array.isArray(listed.finds));
});
