// The privilege audit: risky setups among a file's accounts and privilege sets, in plain English, worst first, on the
// admin console's Security health page and as the review_privileges MCP tool ([Full Access] only).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { reviewPrivileges } from '../src/privilege-review.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

const NONE = { view: false, edit: false, create: false, delete: false } as const;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-privilege-review-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  // Charts ships with [Guest] switched off; switched on, it is a finding.
  store.setAccountActive('[Guest]', true);
  // Sees customers and their Total Sales (a Sum over line items), but no line items.
  store.savePrivilegeSet({
    name: 'Sales', records: NONE, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmmcp'],
    tables: { 'NW Customers': { view: true, edit: false, create: false, delete: false } },
  });
  store.setPassword('seller', 'Seller-pw-123456', 'Sales');
  // A "limit" that reads nothing, and OData for an account that never signs in.
  store.savePrivilegeSet({
    name: 'Reports', records: { view: '1 = 1', edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmodata'],
  });
  store.setPassword('reporter', 'Reporter-pw-123456', 'Reports');
  // A real limit, by party: not flagged.
  store.savePrivilegeSet({
    name: 'Democrats', records: NONE, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [],
    tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false } },
  });
  store.setPassword('Admin', 'Admin-pw-123456');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('risky setups, worst first, each said plainly with where it is', { skip }, () => {
  const r = reviewPrivileges(store);
  const kinds = r.findings.map((f) => `${f.kind}:${f.account ?? f.privilegeSet}`);
  // Admin has a password now, but no second factor.
  assert.ok(kinds.includes('full-access-no-2fa:Admin'), kinds.join('\n'));
  assert.ok(!kinds.some((k) => k.startsWith('full-access-no-password')));
  assert.ok(kinds.includes('guest:[Guest]'));
  assert.ok(kinds.includes('unused-extended:Reports'));
  const always = r.findings.find((f) => f.kind === 'always-true-rule')!;
  assert.equal(always.privilegeSet, 'Reports');
  assert.match(always.title, /"Reports" limits which .+ records it can view with "1 = 1", which is true for every record\./);
  assert.ok(!r.findings.some((f) => f.privilegeSet === 'Democrats'), 'a limit by a field is a real limit');
  const leak = r.findings.find((f) => f.kind === 'calc-reads-hidden')!;
  assert.equal(leak.privilegeSet, 'Sales');
  assert.equal(`${leak.table}::${leak.field}`, 'NW Customers::Total Sales');
  assert.match(leak.title, /worked out from NW Line Items that the set can't view/);
  // Worst first; counts add up.
  const order = r.findings.map((f) => ({ high: 0, medium: 1, low: 2 })[f.severity]);
  assert.deepEqual(order, [...order].sort());
  assert.equal(r.counts.high + r.counts.medium + r.counts.low, r.findings.length);
  // An account that signs in is using the set's surfaces.
  store.auditSignIn('reporter', '127.0.0.1', true);
  const after = reviewPrivileges(store);
  assert.ok(!after.findings.some((f) => f.kind === 'unused-extended' && f.privilegeSet === 'Reports'));
  assert.ok(after.findings.some((f) => f.kind === 'rarely-needed-extended' && f.privilegeSet === 'Reports'));
});

test('on the console\'s Security health report, and as an MCP tool for [Full Access] only', { skip }, async () => {
  const { databases } = await (await fetch(`${base}/tabularius/admin/v1/health?database=Charts`)).json();
  assert.ok(databases[0].review.some((f: { kind: string }) => f.kind === 'calc-reads-hidden'));
  const call = async (auth: string) => (await (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      authorization: 'Basic ' + btoa(auth),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'review_privileges', arguments: { database: 'Charts' } } }),
  })).json());
  const full = await call('Admin:Admin-pw-123456');
  const r = JSON.parse(full.result.content[0].text);
  assert.ok(r.findings.length > 0);
  assert.ok(r.health.fullAccessAccounts.includes('Admin'));
  assert.doesNotMatch(full.result.content[0].text, /pw-123456/);
  const seller = await call('seller:Seller-pw-123456');
  assert.ok(seller.error || seller.result?.isError, JSON.stringify(seller).slice(0, 300));
});
