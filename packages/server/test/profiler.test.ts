// The script profiler in the admin console: slowest scripts and their steps.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-profiler-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const profile = (method = 'GET') => fetch(`${base}/tabularius/admin/v1/profile`, { method, headers: { 'x-tabularius-admin': '1' } }).then((r) => r.json());

test('scripts run through the Data API are timed, with their slowest steps', { skip }, async () => {
  assert.deepEqual((await profile()).scripts, []);
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') } }).then((r) => r.json());
  const auth = { authorization: `Bearer ${login.response.token}` };
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/script/Show%20House?script.param=Rank`, { headers: auth }).then((x) => x.json());
    assert.equal(r.messages[0].code, '0');
  }
  const p = await profile();
  const s = p.scripts.find((x: { script: string }) => x.script === 'Show House');
  assert.ok(s, JSON.stringify(p));
  assert.equal(s.file, 'Charts');
  assert.equal(s.runs, 3);
  assert.ok(s.averageMs >= 0 && s.maxMs >= s.averageMs);
  assert.ok(s.slowestSteps.length > 0);
  const step = s.slowestSteps[0];
  assert.ok(step.line);
  assert.equal(step.count % 3, 0, 'each step counted once per run');
  // Steps' own times add up to no more than the runs took.
  const stepsTotal = s.slowestSteps.reduce((n: number, x: { totalMs: number }) => n + x.totalMs, 0);
  assert.ok(stepsTotal <= s.totalMs + 1, `${stepsTotal} <= ${s.totalMs}`);

  // Start counting again.
  assert.deepEqual((await profile('DELETE')).scripts, []);
});
