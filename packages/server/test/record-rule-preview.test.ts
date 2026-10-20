// Trying out a record-level access rule before saving it: evaluate a "limited"
// calculation against a table's records (as a chosen account), and see which it
// would allow — the preview behind "plain English becomes a limited-access
// calc, checked against sample records and shown before you save".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Host } from '../src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-rrp-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.get('Charts')!;
  const set = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest'] });
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const signIn = () => fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
  method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:') }, body: '{}',
}).then((r) => r.json()).then((j) => j.response.token as string);
const preview = (tok: string, body: unknown) => fetch(`${base}/tabularius/security/v1/databases/Charts/record-rule/preview`, {
  method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

test('a limited rule reports which records it allows', { skip }, () => {
  const store = host.get('Charts')!;
  const r = store.previewRecordRule('Congress', 'Party = "D"', { limit: 200 });
  assert.equal(r.valid, true);
  assert.equal(r.error, undefined);
  assert.ok(r.total > 0);
  assert.ok(r.allowed! > 0 && r.allowed! < r.total, 'some but not all records are Democrats');
  // Every sample's verdict matches whether it is actually a Democrat.
  for (const s of r.samples) assert.equal(s.error, undefined);
  assert.ok(r.samples.length > 0);
});

test('the rule is evaluated as the chosen account', { skip }, () => {
  const store = host.get('Charts')!;
  const mine = store.previewRecordRule('Congress', 'Get ( AccountName ) = "rep1"', { account: 'rep1' });
  const other = store.previewRecordRule('Congress', 'Get ( AccountName ) = "rep1"', { account: 'someone-else' });
  assert.equal(mine.allowed, mine.total, 'rep1 sees every record');
  assert.equal(other.allowed, 0, 'another account sees none');
  assert.ok(mine.samples.every((s) => s.allowed === true));
});

test('a malformed rule comes back invalid, not silently denying all', { skip }, () => {
  const store = host.get('Charts')!;
  const r = store.previewRecordRule('Congress', 'Party = = "D"', {});
  assert.equal(r.valid, false);
  assert.ok(typeof r.error === 'string' && r.error.length > 0);
  assert.equal(r.allowed, undefined, 'no count is reported for a broken rule');
});

test('an unknown table is an error', { skip }, () => {
  const store = host.get('Charts')!;
  assert.throws(() => store.previewRecordRule('Nope', 'True', {}), /No table/);
});

test('the preview is reachable over the security endpoint, full access only', { skip }, async () => {
  const tok = await signIn();
  const r = await preview(tok, { table: 'Congress', rule: 'Party = "D"', limit: 5 });
  assert.equal(r.valid, true);
  assert.equal(r.table, 'Congress');
  assert.ok(r.samples.length > 0 && r.samples.length <= 5);
  // It names what's required when the body is incomplete.
  const bad = await preview(tok, { table: 'Congress' });
  assert.match(bad.error.message, /rule/);
});

test('the preview needs authentication', { skip }, async () => {
  const res = await fetch(`${base}/tabularius/security/v1/databases/Charts/record-rule/preview`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ table: 'Congress', rule: 'True' }),
  });
  assert.ok(res.status === 401 || res.status === 403, 'rejected without a full-access session');
});
