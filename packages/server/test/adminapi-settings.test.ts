// FileMaker Server's Admin API server settings, as fmcsadmin's get/set serverconfig and serverprefs and list plugins
// call them, and blocking new users, which every process of the server follows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, setAdminPassword } from '../src/index.ts';
import { ServerConfig } from '../src/server-config.ts';
import { PASSWORD_POLICY } from '../../store/src/index.ts';
import type { Host } from '../src/host.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-adminapi-settings-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  setAdminPassword(dir, 'secret');
  // Settings already in the file are kept when the server writes its own.
  writeFileSync(join(dir, '.openhbam-settings.json'), JSON.stringify({ keep: 7 }));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

type Reply = { status: number; body: { response: Record<string, any>; messages: { code: string; text: string }[] } };
const call = (path: string, init: RequestInit = {}): Promise<Reply> =>
  fetch(`${base}/fmi/admin/api/v2${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
const code = (r: Reply) => r.body.messages[0].code;
const patch = (path: string, auth: Record<string, string>, body: unknown) => call(path, { method: 'PATCH', headers: auth, body: JSON.stringify(body) });

async function login(): Promise<Record<string, string>> {
  const r = await call('/user/auth', { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') } });
  assert.equal(code(r), '0');
  return { authorization: `Bearer ${r.body.response.token}` };
}

const dataApi = (path: string, init: RequestInit = {}) => fetch(`${base}/fmi/data/vLatest/databases/Charts${path}`, init)
  .then(async (r) => ({ status: r.status, body: await r.json() as { response: Record<string, any>; messages: { code: string; message: string }[] } }));
const dataApiLogin = () => dataApi('/sessions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') } });

test('settings fmcsadmin reads answer; sending them back unchanged is fine, changing them is Not Supported', { skip }, async () => {
  const auth = await login();
  assert.equal(code(await call('/server/config/general')), '9', 'a token is needed');
  const general = await call('/server/config/general', { headers: auth });
  assert.equal(code(general), '0');
  assert.deepEqual(general.body.response, { cacheSize: 512, maxFiles: 256, maxProConnections: 2000, maxPSOS: 500, onlyOpenLastOpenedDatabases: false });
  // What fmcsadmin's set serverconfig sends: every value, with the one asked for changed.
  const same = await patch('/server/config/general', auth, { cacheSize: 512, maxFiles: 256, maxProConnections: 2000, maxPSOS: 500 });
  assert.equal(code(same), '0');
  const changed = await patch('/server/config/general', auth, { cacheSize: 1024, maxFiles: 256, maxProConnections: 2000, maxPSOS: 500 });
  assert.equal(code(changed), '21');
  assert.match(changed.body.messages[0].text, /^Not Supported: Tabularius has no cache size/);
  assert.equal(code(await patch('/server/config/general', auth, { nope: 1 })), '960');
  // fmcsadmin treats an answer that has startupRestorationEnabled as FileMaker Server 19.1.1 or older and sends it back (empty); real 19.1.2+ servers leave it out.
  assert.equal('startupRestorationEnabled' in general.body.response, false);

  assert.deepEqual((await call('/server/config/security', { headers: auth })).body.response, { requireSecureDB: true });
  assert.equal(code(await patch('/server/config/security', auth, { requireSecureDB: false })), '21');
  assert.equal(code(await patch('/server/config/security', auth, { requireSecureDB: true })), '0');
  // A server started with --allow-blank-passwords, or a file set to allow empty passwords from the LAN: no longer secure files only.
  PASSWORD_POLICY.blankFromNetwork = true;
  try {
    assert.deepEqual((await call('/server/config/security', { headers: auth })).body.response, { requireSecureDB: false });
  } finally {
    PASSWORD_POLICY.blankFromNetwork = false;
  }
  host.get('Charts')!.setAllowBlankPasswordFromLan(true);
  try {
    assert.deepEqual((await call('/server/config/security', { headers: auth })).body.response, { requireSecureDB: false });
  } finally {
    host.get('Charts')!.setAllowBlankPasswordFromLan(false);
  }
  assert.equal((await call('/server/config/authenticatedstream', { headers: auth })).body.response.authenticatedStream, 1);
  assert.equal(code(await patch('/server/config/authenticatedstream', auth, { authenticatedStream: 2 })), '21');
  assert.deepEqual((await call('/server/config/parallelbackup', { headers: auth })).body.response, { parallelBackupEnabled: false });
  assert.deepEqual((await call('/server/config/persistentcache', { headers: auth })).body.response, { persistentCache: false, persistentCacheSync: false, databaseServerAutoRestart: false });
  assert.equal(code(await patch('/server/config/persistentcache', auth, { persistentCache: false, persistentCacheSync: false, databaseServerAutoRestart: false })), '0');
  // PHP and HTTPS tunneling Tabularius doesn't have: off, and can't be turned on. The XML interface is served, so it reports on.
  assert.deepEqual((await call('/php/config', { headers: auth })).body.response, { enabled: false, characterEncoding: 'UTF-8', errorMessageLanguage: 'en', dataPreValidation: false, useFileMakerPhp: false });
  assert.deepEqual((await call('/xml/config', { headers: auth })).body.response, { enabled: true });
  assert.deepEqual((await call('/fmclients/httpstunneling', { headers: auth })).body.response, { enableHTTPSTunneling: false });
  assert.equal(code(await patch('/xml/config', auth, { enabled: false })), '21');
  assert.equal(code(await patch('/xml/config', auth, { enabled: true })), '0');
  assert.equal(code(await patch('/fmclients/httpstunneling', auth, { enableHTTPSTunneling: false })), '0');
  assert.equal(code(await call('/server/config/nothing', { headers: auth })), '3');
});

test('plug-ins: none installed is an empty list', { skip }, async () => {
  const auth = await login();
  const r = await call('/plugins', { headers: auth });
  assert.equal(code(r), '0');
  assert.deepEqual(r.body.response, { plugins: [] });
});

test('block new users: sign-ins are refused, open sessions carry on, and the setting is kept in the folder', { skip }, async () => {
  const auth = await login();
  assert.deepEqual((await call('/server/config/blocknewusers', { headers: auth })).body.response, { blockNewUsers: false });
  const before = await dataApiLogin();
  assert.equal(before.status, 200);
  const token = before.body.response.token as string;

  assert.equal(code(await patch('/server/config/blocknewusers', auth, {})), '958');
  assert.equal(code(await patch('/server/config/blocknewusers', auth, { blockNewUsers: 'yes' })), '960');
  const on = await patch('/server/config/blocknewusers', auth, { blockNewUsers: true });
  assert.equal(code(on), '0');
  assert.deepEqual(on.body.response, { blockNewUsers: true });
  assert.deepEqual((await call('/server/config/blocknewusers', { headers: auth })).body.response, { blockNewUsers: true });

  // Another process of the same server (a cluster worker) reads it from the folder.
  assert.equal(new ServerConfig(dir).blockNewUsers(), true);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.openhbam-settings.json'), 'utf8')), { keep: 7, blockNewUsers: true });
  // Readable by the server's own user only, as tabularius migrate-fms writes it.
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, '.openhbam-settings.json')).mode & 0o777, 0o600);

  const refused = await dataApiLogin();
  assert.equal(refused.status, 503);
  assert.equal(refused.body.messages[0].code, '812');
  assert.match(refused.body.messages[0].message, /isn't accepting new users/);
  // A wrong password is refused the same way, without counting toward a lockout or telling whether it was right.
  const wrong = await dataApi('/sessions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:nope') } });
  assert.equal(wrong.body.messages[0].code, '812');
  // The session opened before still works.
  const layouts = await dataApi('/layouts', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(layouts.status, 200);
  // So does the Admin API: administrators still sign in.
  assert.equal(code(await call('/databases', { headers: await login() })), '0');

  // Turned off from another process: this one follows.
  new ServerConfig(dir).setBlockNewUsers(false);
  assert.equal((await dataApiLogin()).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.openhbam-settings.json'), 'utf8')), { keep: 7 });
  assert.equal(code(await patch('/server/config/blocknewusers', auth, { blockNewUsers: false })), '0');
});

test('the admin config reports invalid settings instead of treating them as empty', () => {
  const other = mkdtempSync(join(tmpdir(), 'tabularius-settings-bad-'));
  try {
    writeFileSync(join(other, '.openhbam-settings.json'), '{ half');
    const c = new ServerConfig(other);
    assert.throws(() => c.blockNewUsers(), /\.openhbam-settings\.json isn't valid JSON/);
    writeFileSync(join(other, '.openhbam-settings.json'), '{"keep":"abc"}');
    assert.throws(() => c.backupDir(), /\.openhbam-settings\.json: keep must be a number/);
    assert.equal(readFileSync(join(other, '.openhbam-settings.json'), 'utf8'), '{"keep":"abc"}');
  } finally {
    rmSync(other, { recursive: true });
  }
});
