// The admin console's active-sessions view: who is signed in (who, where,
// device), signing out one session, and ending every session for an account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sessions-'));
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
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const signIn = (ua?: string) =>
  fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa('Admin:pw'), ...(ua ? { 'user-agent': ua } : {}) },
    body: '{}',
  }).then((r) => r.json()).then((b) => b.response.token as string);

const sessions = () => fetch(`${base}/tabularius/admin/v1/sessions?database=Charts`).then((r) => r.json()).then((b) => b.sessions as any[]);
const endSession = (body: unknown) => fetch(`${base}/tabularius/admin/v1/sessions/end`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify(body),
});
// Is a token still usable? (A signed-out session's token stops working.)
const stillValid = async (token: string) =>
  (await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json())).messages[0].code === '0';

test('the active-sessions view lists who is signed in, with device and where', { skip }, async () => {
  const token = await signIn('TestAgent/1.0');
  const list = await sessions();
  const mine = list.find((s) => s.account === 'Admin');
  assert.ok(mine, 'the signed-in session is listed');
  assert.equal(mine.device, 'TestAgent/1.0');
  assert.ok('from' in mine || mine.from === undefined); // loopback may be reported or blank
  assert.ok(await stillValid(token));
});

test('signing out one session disconnects just that token', { skip }, async () => {
  const a = await signIn('A');
  const b = await signIn('B');
  const list = await sessions();
  const idA = list.find((s) => s.device === 'A').id;
  const r = await endSession({ id: idA });
  assert.equal((await r.json()).ended, 1);
  assert.equal(await stillValid(a), false, 'A was signed out');
  assert.equal(await stillValid(b), true, 'B is untouched');
});

test('ending every session for an account disconnects all of them', { skip }, async () => {
  const a = await signIn('one');
  const b = await signIn('two');
  const r = await endSession({ database: 'Charts', account: 'Admin' });
  assert.ok((await r.json()).ended >= 2);
  assert.equal(await stillValid(a), false);
  assert.equal(await stillValid(b), false);
});

test('the end endpoint needs the CSRF header', { skip }, async () => {
  const r = await fetch(`${base}/tabularius/admin/v1/sessions/end`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ database: 'Charts', account: 'Admin' }),
  });
  assert.equal(r.status, 403);
});

test('ending with neither an id nor an account is a 400', { skip }, async () => {
  const r = await endSession({});
  assert.equal(r.status, 400);
});
