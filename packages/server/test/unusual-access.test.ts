// The admin console's unusual-access endpoint: repeated failed sign-ins through
// the Data API show up as a failed-sign-in burst (and a lockout), worst first,
// with an adjustable recent window.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-unusual-srv-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Charts')!;
  store.setPassword('Admin', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
  // Seven wrong-password attempts: enough to trip the lockout and make a burst.
  for (let i = 0; i < 7; i++) {
    await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:wrong') }, body: '{}',
    });
  }
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

interface Alert { kind: string; severity: string; account: string | null; count?: number; description: string }
const get = (q = '') => fetch(`${base}/tabularius/admin/v1/unusual-access?database=Charts${q}`).then((r) => r.json() as Promise<{ database: string; windowHours: number; alerts: Alert[] }>);

test('a run of failed sign-ins surfaces as a burst (and a lockout), worst first', { skip }, async () => {
  const body = await get();
  assert.equal(body.database, 'Charts');
  assert.equal(body.windowHours, 72);
  const burst = body.alerts.find((a) => a.kind === 'failed-burst' && a.account === 'Admin');
  assert.ok(burst, 'the failed sign-ins are a burst');
  assert.equal(burst!.severity, 'alert');
  assert.ok((burst!.count ?? 0) >= 5);
  assert.ok(body.alerts.some((a) => a.kind === 'lockout'), 'the account was locked out');
  // Every alert sorts before every notice.
  const sev = body.alerts.map((a) => a.severity);
  assert.ok(sev.lastIndexOf('alert') <= sev.indexOf('notice') || !sev.includes('notice'));
});

test('the window is adjustable and the file must be known', { skip }, async () => {
  assert.equal((await get('&windowHours=24')).windowHours, 24);
  const unknown = await fetch(`${base}/tabularius/admin/v1/unusual-access?database=Nope`).then((r) => r.json() as Promise<{ error?: string }>);
  assert.ok(unknown.error, 'an unknown file is reported as an error');
});
