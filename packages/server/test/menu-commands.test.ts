// The web client's menu payload carries the account's "Available menu commands"
// level, so the client can offer fewer commands to a restricted account. Full
// access omits it (it always has them all).
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

const minimal: PrivilegeDefinition = {
  name: 'Minimal',
  records: { view: true, edit: false, create: false, delete: false },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
  menuCommands: 'minimum',
  extendedPrivileges: ['fmrest'],
};

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-menu-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server; base = s.url; host = s.host;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest'])] });
  store.setPassword('Admin', 'pw');
  store.savePrivilegeSet(minimal);
  store.setPassword('Clerk', 'pw', 'Minimal');
  store.savePrivilegeSet({ ...minimal, name: 'NoPrint', menuCommands: 'all', printing: false, exporting: false });
  store.setPassword('Viewer', 'pw', 'NoPrint');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function menu(account: string): Promise<{ menuCommands?: string; printing?: boolean; exporting?: boolean }> {
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  const token = (await login.json()).response.token;
  return (await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts`, { headers: { authorization: `Bearer ${token}` } })).json();
}

test('a restricted account is told its menu-command level', { skip }, async () => {
  assert.equal((await menu('Clerk')).menuCommands, 'minimum');
});

test('full access is not sent a level (it has every command)', { skip }, async () => {
  assert.equal((await menu('Admin')).menuCommands, undefined);
});

test('a set that forbids printing and exporting says so, so the client leaves those commands out', { skip }, async () => {
  const m = await menu('Viewer');
  assert.equal(m.printing, false);
  assert.equal(m.exporting, false);
  assert.equal(m.menuCommands, undefined);
  const clerk = await menu('Clerk');
  assert.equal(clerk.printing, undefined);
  assert.equal(clerk.exporting, undefined);
});
