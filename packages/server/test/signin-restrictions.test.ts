// The per-account sign-in restrictions enforced over the Data API: an account
// set to "require a second factor" can't sign in with a password until it has
// one, and a "local-only" account is let in from the server itself (loopback).
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-signin-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });

  // Requires a second factor, has none set up: must be refused.
  store.setPassword('needs2fa', 'pw', full.name);
  store.setAccountRequire2fa('needs2fa', true);

  // Requires a second factor and has one: must still get in (with the code).
  store.setPassword('with2fa', 'pw', full.name);
  ({ secret } = store.enrollTotp('with2fa'));
  store.confirmTotp('with2fa', totpCode(secret));
  store.setAccountRequire2fa('with2fa', true);

  // Local-only: allowed from the server itself (the test connects over loopback).
  store.setPassword('localuser', 'pw', full.name);
  store.setAccountLocalOnly('localuser', true);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const signIn = (account: string, password: string, otp?: string) =>
  fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(`${account}:${password}`), ...(otp ? { 'x-tabularius-otp': otp } : {}) },
    body: '{}',
  });

test('an account that requires 2FA but has none is refused', { skip }, async () => {
  const r = await signIn('needs2fa', 'pw');
  assert.equal(r.status, 403);
  assert.match((await r.json()).messages?.[0]?.message ?? '', /two-factor/i);
});

test('an account that requires 2FA and has it signs in with the code', { skip }, async () => {
  // Without the code it is asked for one (the account has a second factor).
  const noCode = await signIn('with2fa', 'pw');
  assert.equal(noCode.status, 401);
  const r = await signIn('with2fa', 'pw', totpCode(secret));
  assert.equal(r.status, 200);
  assert.ok((await r.json()).response.token);
});

test('a local-only account signs in from the server itself (loopback)', { skip }, async () => {
  const r = await signIn('localuser', 'pw');
  assert.equal(r.status, 200);
  assert.ok((await r.json()).response.token);
});
