// The /migrate endpoint: an admin gives each converted-file account a temporary
// password and a forced first-login change, in one call, over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mig-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  // Admin keeps the file's empty password (so it's a migration target) but gets
  // full access with fmrest, so it can sign in to the Data API and reach Manage Security.
  const store = host.get('Charts')!;
  const set = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest'] });
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function signIn(account: string, password: string): Promise<Response> {
  return fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:${password}`) }, body: '{}',
  });
}
const sec = (tok: string, path = '', init: RequestInit = {}) =>
  fetch(`${base}/tabularius/security/v1/databases/Charts${path}`, {
    ...init, headers: { authorization: `Bearer ${tok}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });

test('migrate replaces the file password with a temporary one and forces a change', { skip }, async () => {
  // Sign in with the file's empty password (from loopback), while it still works.
  const tok = (await (await signIn('Admin', '')).json()).response.token;

  // The overview flags Admin as still on the converted file's password.
  const before = await (await sec(tok)).json();
  assert.equal(before.accounts.find((a: { name: string }) => a.name === 'Admin').unmigrated, true);

  // Migrate: one temporary password comes back, shown this once.
  const r = await sec(tok, '/migrate', { method: 'POST', body: '{}' });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.migrated.length, 1);
  assert.equal(body.migrated[0].account, 'Admin');
  assert.ok(typeof body.migrated[0].password === 'string' && body.migrated[0].password.length >= 1);
  const temp = body.migrated[0].password;
  // No longer unmigrated, and now owes a change.
  const admin = body.security.accounts.find((a: { name: string }) => a.name === 'Admin');
  assert.equal(admin.unmigrated, false);
  assert.equal(admin.mustChange, true);

  // The empty password no longer signs in; the temporary one does, but the
  // session must change the password before it can do anything else.
  assert.equal((await signIn('Admin', '')).status >= 400, true);
  const used = await (await signIn('Admin', temp)).json();
  assert.equal(used.response.passwordChangeRequired, true);
});
