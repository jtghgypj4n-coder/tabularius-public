// The admin console's "test this account" endpoint: GET
// /tabularius/admin/v1/test-account returns the account picker with no target,
// and the full layout/script walk (with blocked steps) for a chosen account.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-test-account-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  const layout = store.schema.layouts[0].name;
  store.applyDesign([{ op: 'createScript', name: 'Jump', text: `Go to Layout [${layout}]` }]);
  store.savePrivilegeSet({
    name: 'Sales',
    records: { view: true, edit: false, create: false, delete: false },
    layouts: 'none', valueLists: 'none', scripts: 'none', scriptAccess: { Jump: 'viewOnly' },
    extendedPrivileges: ['fmrest'],
  });
  store.setPassword('seller', 'seller-pw-123', 'Sales');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const testAccount = (q: string) => fetch(`${base}/tabularius/admin/v1/test-account?database=Charts${q}`).then((r) => r.json());

test('with no account it offers the account picker', { skip }, async () => {
  const r = await testAccount('');
  assert.equal(r.database, 'Charts');
  assert.ok(Array.isArray(r.accounts) && r.accounts.includes('seller'));
});

test('an account comes back with every layout, every script, and what a runnable script would hit', { skip }, async () => {
  const r = await testAccount('&account=seller');
  assert.equal(r.account, 'seller');
  assert.equal(r.privilegeSet, 'Sales');
  assert.ok(r.layouts.length >= 1);
  assert.ok(r.layouts.every((l: { access: string }) => l.access === 'none'), 'layouts: "none" was never granted');
  const jump = r.scripts.find((s: { script: string }) => s.script === 'Jump');
  assert.equal(jump.access, 'viewOnly');
  assert.equal(jump.blocked.length, 1);
  assert.equal(jump.blocked[0].target, 'layout');
});

test('an unknown database or account is reported, not a crash', { skip }, async () => {
  assert.match((await testAccount('&account=nobody')).error, /No account "nobody"/);
  assert.match((await fetch(`${base}/tabularius/admin/v1/test-account?database=Nope&account=x`).then((r) => r.json())).error, /hosted/);
});

test('read-only: nothing changes in the file', { skip }, async () => {
  const before = JSON.stringify(store.privilegeSets());
  await testAccount('&account=seller');
  assert.equal(JSON.stringify(store.privilegeSets()), before);
});
