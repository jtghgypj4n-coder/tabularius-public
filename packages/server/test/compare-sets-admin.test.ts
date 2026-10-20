// The admin console's "Compare two sets" endpoint: GET /tabularius/admin/v1/compare
// returns the privilege-set picker with no pair, and a plain-English diff (how
// set B differs from set A) for a pair. Read-only.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-compare-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} }); // loopback: console calls are open
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.savePrivilegeSet({
    name: 'Readers', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
  });
  store.savePrivilegeSet({
    name: 'Editors', records: { view: true, edit: true, create: true, delete: false },
    layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmmcp'],
  });
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const compare = (q: string) => fetch(`${base}/tabularius/admin/v1/compare?database=Charts${q}`).then((r) => r.json());

test('with no pair it offers the privilege-set picker', { skip }, async () => {
  const r = await compare('');
  assert.equal(r.database, 'Charts');
  assert.ok(Array.isArray(r.privilegeSets) && r.privilegeSets.includes('Readers') && r.privilegeSets.includes('Editors'));
});

test('a pair comes back as a plain-English diff', { skip }, async () => {
  const r = await compare('&a=Readers&b=Editors');
  assert.equal(r.comparison.a, 'Readers');
  assert.equal(r.comparison.b, 'Editors');
  const detail = r.comparison.changes.map((c: { detail: string }) => c.detail).join('\n');
  assert.match(detail, /edit yes/); // Editors can edit where Readers can't
  assert.ok(r.comparison.changes.some((c: { area: string; detail: string }) => c.area === 'extendedPrivileges' && /grant fmmcp/.test(c.detail)));
  assert.ok(!r.comparison.changes.some((c: { area: string }) => c.area === 'name'), 'no rename line');
});

test('an unknown set or database is reported, not a crash', { skip }, async () => {
  assert.match((await compare('&a=Readers&b=Nope')).error, /No privilege set "Nope"/);
  assert.match((await fetch(`${base}/tabularius/admin/v1/compare?database=Nope&a=x&b=y`).then((r) => r.json())).error, /hosted/);
});
