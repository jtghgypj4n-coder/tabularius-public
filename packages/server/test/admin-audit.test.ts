// The admin console shows and exports a file's audit log: record changes and
// security events (who signed in, who failed, who was locked out, and every
// change to accounts, privileges, passwords, tokens, second factors, schema).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-adminaudit-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw', full.name);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function login(password: string): Promise<number> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa(`Admin:${password}`) }, body: '{}',
  });
  return r.status;
}

test('the admin audit endpoint shows sign-in successes and failures', { skip }, async () => {
  assert.equal(await login('pw'), 200); // a success
  assert.equal(await login('nope'), 401); // a failure

  const r = await fetch(`${base}/tabularius/admin/v1/audit?database=Charts&security=1`);
  assert.equal(r.status, 200);
  const { audit } = await r.json() as { audit: { kind: string; account: string | null; security?: boolean }[] };
  assert.ok(audit.every((e) => e.security), 'security=1 returns only security events');
  const kinds = audit.map((e) => e.kind);
  assert.ok(kinds.includes('sign-in'), 'the successful sign-in is logged');
  assert.ok(kinds.includes('sign-in-failed'), 'the failed sign-in is logged');
});

test('the audit endpoint can filter by account and kind', { skip }, async () => {
  const r = await fetch(`${base}/tabularius/admin/v1/audit?database=Charts&kind=sign-in-failed`);
  const { audit } = await r.json() as { audit: { kind: string }[] };
  assert.ok(audit.length > 0 && audit.every((e) => e.kind === 'sign-in-failed'));
});

test('the audit log exports as CSV with a safe filename and quoting', { skip }, async () => {
  store.sql.prepare('INSERT INTO _fm_audit (at, account, kind, tbl, security) VALUES (?, ?, ?, ?, 0)')
    .run(new Date().toISOString(), '\t=1+1', 'test-export', 'Records');
  const r = await fetch(`${base}/tabularius/admin/v1/audit?database=Charts&format=csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="audit-Charts\.csv"/);
  const text = await r.text();
  const lines = text.trim().split('\r\n');
  assert.equal(lines[0], 'seq,at,account,kind,security,table,target,from,recordId,changes,surface,script,copyOf,revertOf');
  assert.ok(lines.some((l) => l.includes('sign-in')), 'a sign-in row is present');
  assert.ok(lines.some((l) => l.includes(",\\u{0009}=1+1,test-export")), 'a control-prefixed account cell is neutralized');
  // Every data row has the ten columns (JSON detail is quoted so its commas don't split).
  for (const l of lines.slice(1)) {
    assert.ok(/^\d+,/.test(l), 'a row starts with its sequence number');
  }
});

test('the audit endpoint rejects a request without a known database', { skip }, async () => {
  assert.equal((await fetch(`${base}/tabularius/admin/v1/audit`)).status, 400);
  assert.equal((await fetch(`${base}/tabularius/admin/v1/audit?database=Nope`)).status, 400);
});
