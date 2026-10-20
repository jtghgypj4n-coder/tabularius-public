// Two-factor sign-in through the Data API sessions endpoint.
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
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const login = (headers: Record<string, string>) =>
  fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), ...headers }, body: '{}',
  });

test('an account with two-factor needs a valid code to sign in', { skip }, async () => {
  // Right password, no code: asked for one, without revealing the password was right.
  const noCode = await login({});
  assert.equal((await noCode.json()).messages[0].code, '1211');

  // Right password, wrong code: refused.
  const wrong = await login({ 'x-tabularius-otp': '000000' });
  assert.equal((await wrong.json()).messages[0].code, '1211');

  // Wrong password still fails as a password error, not a code prompt.
  const badPw = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:nope'), 'x-tabularius-otp': totpCode(secret) }, body: '{}',
  });
  assert.equal((await badPw.json()).messages[0].code, '212');

  // Right password and a valid code: a session.
  const ok = await login({ 'x-tabularius-otp': totpCode(secret) });
  const body = await ok.json();
  assert.equal(body.messages[0].code, '0');
  assert.ok(body.response.token);
});
