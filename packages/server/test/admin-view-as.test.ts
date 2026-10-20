// The admin console's "view as" preview: read a layout exactly as a chosen
// privilege set sees it — its visible records, with fields it can't see masked —
// read-only and audited.
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
let full: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-viewas-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  full = store.privilegeSets().find((p) => p.id === 1)!.name;
  // Sees only Democrats, never the ACLU field; has view-only layout access.
  store.savePrivilegeSet({
    name: 'Clerk',
    records: { view: false, edit: false, create: false, delete: false },
    tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false, fields: { ACLU: 'none' } } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [],
  });
  // No layout access at all.
  store.savePrivilegeSet({
    name: 'Blind',
    records: { view: true, edit: false, create: false, delete: false },
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
  });
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const viewAs = (q: string) => fetch(`${base}/tabularius/admin/v1/view-as?database=Charts${q}`).then((r) => r.json());

test('with no set/layout it lists the pickers', { skip }, async () => {
  const body = await viewAs('');
  assert.ok(body.privilegeSets.includes('Clerk') && body.privilegeSets.includes(full));
  assert.ok(body.layouts.includes('Congress'));
});

test('a restricted set sees only its records, with masked fields gone', { skip }, async () => {
  const all = await viewAs(`&privilegeSet=${encodeURIComponent(full)}&layout=Congress&limit=200`);
  const clerk = await viewAs('&privilegeSet=Clerk&layout=Congress&limit=200');

  assert.equal(clerk.layoutAccess, true);
  // Fewer records than full access, and every one it sees is a Democrat.
  assert.ok(clerk.foundCount < all.foundCount, 'the set sees fewer records');
  assert.ok(clerk.records.length > 0);
  assert.ok(clerk.records.every((r: { fieldData: Record<string, unknown> }) => r.fieldData.Party === 'D'));
  // The ACLU field is masked away for the Clerk, present for full access.
  assert.ok(clerk.records.every((r: { fieldData: Record<string, unknown> }) => !('ACLU' in r.fieldData)));
  assert.ok(all.records.some((r: { fieldData: Record<string, unknown> }) => 'ACLU' in r.fieldData));
});

test('a set with no layout access gets layoutAccess:false', { skip }, async () => {
  const blind = await viewAs('&privilegeSet=Blind&layout=Congress');
  assert.equal(blind.layoutAccess, false);
  assert.deepEqual(blind.records, []);
});

test('the preview is audited and leaves the data untouched', { skip }, async () => {
  const before = store.find('Congress', { limit: 1 }).totalCount;
  await viewAs('&privilegeSet=Clerk&layout=Congress');
  const after = store.find('Congress', { limit: 1 }).totalCount;
  assert.equal(after, before, 'view-as writes nothing');

  const { audit } = await fetch(`${base}/tabularius/admin/v1/audit?database=Charts&security=1`).then((r) => r.json()) as
    { audit: { kind: string; changes?: Record<string, unknown> }[] };
  const viewed = audit.some((e) => e.kind === 'viewed-as' && e.changes?.privilegeSet === 'Clerk' && e.changes?.layout === 'Congress');
  assert.ok(viewed, 'the Clerk preview is logged with its set and layout');
});

test('an unknown set or layout is reported, not a crash', { skip }, async () => {
  assert.match((await viewAs('&privilegeSet=Nope&layout=Congress')).error, /privilege set/);
  assert.match((await viewAs(`&privilegeSet=${encodeURIComponent(full)}&layout=Nope`)).error, /layout/);
});
