// With the "require two-factor for full-access accounts" switch on, a
// full-access account that has no second factor is refused at sign-in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { totpCode } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;
let base: string;
let secret: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-2fa-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw', full.name);
  ({ secret } = store.enrollTotp('Admin'));
  store.confirmTotp('Admin', totpCode(secret));
  // Turn the switch on while Admin (with 2FA) is the only full-access account,
  // then add a second full-access account that never sets up a second factor.
  store.setRequireTotpForFullAccess(true);
  store.setPassword('admin2', 'pw', full.name);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const signIn = (account: string, password: string, otp?: string) =>
  fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(`${account}:${password}`), ...(otp ? { 'x-tabularius-otp': otp } : {}) },
    body: '{}',
  });

test('a full-access account with no second factor is refused when the switch is on', { skip }, async () => {
  const r = await signIn('admin2', 'pw');
  assert.equal(r.status, 403);
  assert.match((await r.json()).messages?.[0]?.message ?? '', /two-factor/i);
});

test('a full-access account with a second factor still signs in', { skip }, async () => {
  const r = await signIn('Admin', 'pw', totpCode(secret));
  assert.equal(r.status, 200);
  assert.ok((await r.json()).response.token);
});
