// The admin console's "who can do what" access-review export: GET
// /tabularius/admin/v1/access-review, as JSON or a CSV download.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-access-review-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
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

const review = (q = '') => fetch(`${base}/tabularius/admin/v1/access-review?database=Charts${q}`).then((r) => r.json());

test('one row per account per table for a limited set, one summary row for full access', { skip }, async () => {
  const r = await review();
  assert.equal(r.database, 'Charts');
  const admin = r.rows.filter((x: { account: string }) => x.account === 'Admin');
  assert.equal(admin.length, 1);
  assert.equal(admin[0].table, '*');
  assert.equal(admin[0].fullAccess, true);
  assert.equal(admin[0].view, 'yes');

  const seller = r.rows.filter((x: { account: string }) => x.account === 'seller');
  assert.ok(seller.length > 1, 'one row per table for a non-full-access account');
  assert.ok(seller.every((x: { fullAccess: boolean }) => x.fullAccess === false));
  assert.ok(seller.every((x: { view: string; edit: string }) => x.view === 'yes' && x.edit === 'no'));
  assert.ok(seller.every((x: { extendedPrivileges: string[] }) => x.extendedPrivileges.includes('fmrest')));
  assert.ok(seller.every((x: { has2fa: boolean }) => x.has2fa === false));
  assert.ok(seller.every((x: { stale: boolean }) => x.stale === true), 'never signed in yet, so stale');
});

test('an account with no privilege set assigned is reported as having no access, not full access', { skip }, async () => {
  store.setPassword('noset', 'noset-pw-123');
  const r = await review();
  const noset = r.rows.filter((x: { account: string }) => x.account === 'noset');
  assert.equal(noset.length, 1, 'one summary row, same shape as a full-access account');
  assert.equal(noset[0].table, '*');
  assert.equal(noset[0].fullAccess, false);
  assert.deepEqual([noset[0].view, noset[0].edit, noset[0].create, noset[0].delete], ['no', 'no', 'no', 'no']);
});

test('the summary calls out full access, missing 2FA, and staleness in plain words', { skip }, async () => {
  const r = await review();
  assert.ok(r.summary.some((s: string) => /full access: .*Admin/.test(s)));
  assert.ok(r.summary.some((s: string) => /no two-factor sign-in/.test(s) && s.includes('seller')));
  assert.ok(r.summary.some((s: string) => /not signed in/.test(s) && s.includes('seller')));
});

test('format=csv downloads the same rows with a header', { skip }, async () => {
  const res = await fetch(`${base}/tabularius/admin/v1/access-review?database=Charts&format=csv`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="access-review-Charts\.csv"/);
  const text = await res.text();
  const lines = text.trim().split('\r\n');
  assert.equal(lines[0], 'account,privilegeSet,fullAccess,table,view,edit,create,delete,hiddenFields,viewOnlyFields,maskedFields,extendedPrivileges,lastSignIn,daysSinceSignIn,stale,has2fa');
  assert.ok(lines.some((l) => l.startsWith('Admin,') && l.includes(',*,yes,yes,yes,yes,')));
  assert.ok(lines.some((l) => l.startsWith('seller,Sales,no,')));
});

test('an unknown database is reported, not a crash', { skip }, async () => {
  const r = await fetch(`${base}/tabularius/admin/v1/access-review?database=Nope`).then((x) => x.json());
  assert.match(r.error, /hosted/);
});

test('read-only: nothing changes in the file', { skip }, async () => {
  const before = JSON.stringify(store.privilegeSets());
  await review();
  assert.equal(JSON.stringify(store.privilegeSets()), before);
});
