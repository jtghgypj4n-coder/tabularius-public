// The admin console's "View as" endpoint: GET /tabularius/admin/v1/access returns
// the pickers with no target, and a plain-English explanation (with a reason for
// every denial) for an account or a privilege set.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-access-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} }); // loopback: console calls are open
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.savePrivilegeSet({
    name: 'Sales',
    records: { view: true, edit: false, create: false, delete: false },
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'],
  });
  store.setPassword('seller', 'seller-pw-123', 'Sales');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const access = (q: string) => fetch(`${base}/tabularius/admin/v1/access?database=Charts${q}`).then((r) => r.json());

test('with no target it offers the account and privilege-set pickers', { skip }, async () => {
  const r = await access('');
  assert.equal(r.database, 'Charts');
  assert.ok(Array.isArray(r.accounts) && r.accounts.includes('seller'));
  assert.ok(Array.isArray(r.privilegeSets) && r.privilegeSets.includes('Sales'));
});

test('a privilege set comes back explained, with reasons', { skip }, async () => {
  const r = await access('&privilegeSet=Sales');
  const x = r.explanation;
  assert.equal(x.privilegeSet, 'Sales');
  assert.equal(x.fullAccess, false);
  assert.ok(x.tables.length >= 1 && x.tables[0].view.why, 'every table carries a reason');
  const mcp = x.surfaces.find((s: { surface: string }) => s.surface === 'fmmcp');
  assert.match(mcp.why, /needs the fmmcp extended privilege/);
});

test('an account is explained through its own set', { skip }, async () => {
  const r = await access('&account=seller');
  assert.equal(r.explanation.target, 'account "seller" (privilege set "Sales")');
});

test('an unknown database or account is reported, not a crash', { skip }, async () => {
  assert.match((await access('&account=nobody')).error, /No account "nobody"/);
  assert.match((await fetch(`${base}/tabularius/admin/v1/access?database=Nope&account=x`).then((r) => r.json())).error, /hosted/);
});
