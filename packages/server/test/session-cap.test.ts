// One account can't hold sessions without end: past TABULARIUS_MAX_SESSIONS_PER_ACCOUNT, signing in ends the session
// used longest ago, so a script that signs in again and again keeps working and leaks nothing.
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
let base: string;
let host: Host;

before(async () => {
  if (skip) return;
  process.env.TABULARIUS_MAX_SESSIONS_PER_ACCOUNT = '3';
  dir = mkdtempSync(join(tmpdir(), 'tabularius-session-cap-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Ann', 'pw', full.name);
  store.setPassword('Bea', 'pw', full.name);
  store.setPassword('Cy', 'pw', full.name);
});
after(async () => {
  delete process.env.TABULARIUS_MAX_SESSIONS_PER_ACCOUNT;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const signIn = async (account: string) => {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 200);
  return (await r.json()).response.token as string;
};
const works = async (token: string) => (await fetch(`${base}/fmi/data/vLatest/validateSession`, { headers: { authorization: `Bearer ${token}` } })).status === 200;

test('past the cap the session used longest ago ends, and other accounts are not counted', { skip }, async () => {
  const bea = await signIn('Bea');
  const ann: string[] = [];
  for (let i = 0; i < 3; i++) {
    ann.push(await signIn('Ann'));
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.deepEqual(await Promise.all(ann.map(works)), [true, true, true]);
  // Using the first one makes the second the least recently used.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${ann[0]}` } })).status, 200);
  await new Promise((r) => setTimeout(r, 20));
  const fourth = await signIn('Ann');
  assert.deepEqual(await Promise.all([ann[0], ann[1], ann[2], fourth].map(works)), [true, false, true, true]);
  assert.equal(await works(bea), true);
  for (let i = 0; i < 10; i++) await signIn('Ann');
  assert.equal(await works(bea), true);
});

test('account names match whatever their case', { skip }, async () => {
  const tokens: string[] = [];
  for (const name of ['Cy', 'cy', 'CY', 'cY']) {
    tokens.push(await signIn(name));
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.deepEqual(await Promise.all(tokens.map(works)), [false, true, true, true]);
});
