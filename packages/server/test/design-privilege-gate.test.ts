// Design is [Full Access] only, as in FileMaker: a signed-in but non-full
// account must be refused at every design/DDR/clipboard route over HTTP, not
// merely by the canDesign() helper. This locks the HTTP boundary so a route
// added later can't quietly skip the gate and leak the solution's structure
// (every table, field, script, layout, relationship and calculation) to an
// account that may not see it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import type { PrivilegeDefinition } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;

// A non-full account that can still sign in (it has fmrest, so the Data API
// grants it a session), but has no design access.
const clerk: PrivilegeDefinition = {
  name: 'Clerk',
  records: { view: true, edit: false, create: false, delete: false },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
  extendedPrivileges: ['fmrest'],
};

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-design-gate-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest'])] });
  store.setPassword('Admin', 'pw');
  store.savePrivilegeSet(clerk);
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function token(account: string): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) },
  });
  return (await r.json()).response.token;
}

const d = (path: string, tok: string, init: RequestInit = {}) =>
  fetch(`${base}/tabularius/design/v1/databases/Charts${path}`, {
    ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, ...(init.headers as Record<string, string>) },
  }).then((r) => r.status);

test('every design route refuses a signed-in non-full account (403)', { skip }, async () => {
  const clerkTok = await token('Clerk');

  // A valid session (so this is the design gate at work, not an auth failure)
  // is refused on each route that reads or writes design.
  assert.equal(await d('/ddr', clerkTok), 403, 'DDR export');
  assert.equal(await d('/report', clerkTok), 403, 'conversion report');
  assert.equal(await d('/history', clerkTok), 403, 'design history');
  assert.equal(await d('/library', clerkTok), 403, 'component library');
  assert.equal(await d('/layouts/1/speed', clerkTok, { method: 'POST', body: '{}' }), 403, 'make a layout faster');
  assert.equal(await d('/library', clerkTok, { method: 'POST', body: JSON.stringify({ component: 1 }) }), 403, 'save to the component library');
  assert.equal(await d('/snippet/copy', clerkTok, { method: 'POST', body: JSON.stringify({ tables: ['Congress'] }) }), 403, 'copy to clipboard');
  assert.equal(await d('/snippet', clerkTok, { method: 'POST', body: JSON.stringify({ xml: '<fmxmlsnippet type="FMObjectList"></fmxmlsnippet>' }) }), 403, 'paste from clipboard');
  assert.equal(await d('/check', clerkTok, { method: 'POST', body: JSON.stringify({ formula: '1+1' }) }), 403, 'formula check');
  assert.equal(await d('/evaluate', clerkTok, { method: 'POST', body: JSON.stringify({ layout: 'Congress', formulas: ['1'] }) }), 403, 'evaluate');
  assert.equal(await d('', clerkTok, { method: 'POST', body: JSON.stringify({ changes: [{ op: 'deleteTable', table: 'Congress' }] }) }), 403, 'apply design changes');
});

test('a full-access account still reaches the same routes', { skip }, async () => {
  const adminTok = await token('Admin');
  // The gate isn't a blanket deny: DDR comes back as XML for [Full Access].
  const r = await fetch(`${base}/tabularius/design/v1/databases/Charts/ddr`, { headers: { authorization: `Bearer ${adminTok}` } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /application\/xml/);
});
