// The admin console's least-privilege endpoint: GET /tabularius/admin/v1/least-privilege
// returns the write grants a set holds but hasn't used in the window. Read-only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-lp-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} }); // loopback: console calls are open
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.savePrivilegeSet({
    name: 'Sales', records: { view: true, edit: true, create: true, delete: true },
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
  });
  store.setPassword('seller', 'seller-pw-123', 'Sales');
  store.create('Congress', { Name: 'seller wrote this' }, { account: 'seller' });
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const lp = (q: string) => fetch(`${base}/tabularius/admin/v1/least-privilege?database=Charts${q}`).then((r) => r.json());

test('returns the unused write grants, honoring unusedDays', { skip }, async () => {
  const r = await lp('&unusedDays=45');
  assert.equal(r.database, 'Charts');
  assert.equal(r.unusedDays, 45);
  const sales = r.findings.filter((f: { set: string }) => f.set === 'Sales');
  assert.ok(sales.length >= 1, 'Sales has unused write grants');
  assert.ok(!sales.some((f: { table: string }) => f.table === 'Congress'), 'the written table is spared');
  assert.ok(sales.every((f: { accounts: string[] }) => f.accounts.includes('seller')));
  // Ways in: this file's use was counted only from today, so none is judged yet.
  assert.deepEqual(r.access, []);
  assert.ok(Array.isArray(r.notYetCounted));
});

test('defaults the window to 30 days and reports an unknown database', { skip }, async () => {
  assert.equal((await lp('')).unusedDays, 30);
  assert.match((await fetch(`${base}/tabularius/admin/v1/least-privilege?database=Nope`).then((r) => r.json())).error, /hosted/);
});
