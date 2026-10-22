// FileMaker Server's Admin API (v2): the calls tools like fmcsadmin make.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, setAdminPassword } from '../src/index.ts';
import type { Host } from '../src/host.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-adminapi-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  setAdminPassword(dir, 'secret');
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
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

type Reply = { status: number; body: { response: Record<string, any>; messages: { code: string; text: string }[] } };
const call = (path: string, init: RequestInit = {}): Promise<Reply> =>
  fetch(`${base}/fmi/admin/api/v2${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
const code = (r: Reply) => r.body.messages[0].code;

async function login(): Promise<Record<string, string>> {
  const r = await call('/user/auth', { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') } });
  assert.equal(r.status, 200);
  assert.equal(code(r), '0');
  return { authorization: `Bearer ${r.body.response.token}` };
}

const dataApiLogin = () => fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') },
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test('sign in with the admin password; tokens open the rest, nothing else does', { skip }, async () => {
  const consoleSignIn = await fetch(`${base}/tabularius/admin/v1/sign-in`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' },
    body: JSON.stringify({ password: 'secret' }),
  });
  assert.equal(consoleSignIn.status, 200);
  const cookie = consoleSignIn.headers.get('set-cookie')!.split(';', 1)[0];
  const cookieAndBogusBasic = await call('/user/auth', {
    method: 'POST', headers: { cookie, 'x-tabularius-admin': '1', authorization: 'Basic ' + btoa('admin:wrong') },
  });
  assert.equal(cookieAndBogusBasic.status, 401, 'the console cookie cannot replace valid Admin API Basic credentials');

  const cookieAndCorrectBasic = await call('/user/auth', {
    method: 'POST', headers: { cookie, 'x-tabularius-admin': '1', authorization: 'Basic ' + btoa('admin:secret') },
  });
  assert.equal(cookieAndCorrectBasic.status, 200, 'correct Basic credentials still mint an Admin API token');
  assert.equal(code(cookieAndCorrectBasic), '0');

  const bad = await call('/user/auth', { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:nope') } });
  assert.equal(bad.status, 401);
  assert.equal(code(bad), '212');
  assert.deepEqual(bad.body.response, {});

  assert.equal(code(await call('/databases')), '9');
  // A Basic login, as a browser would replay, doesn't open the other endpoints.
  assert.equal((await call('/databases', { headers: { authorization: 'Basic ' + btoa('admin:secret') } })).status, 401);

  const auth = await login();
  const meta = await call('/server/metadata', { headers: auth });
  assert.equal(code(meta), '0');
  assert.match(meta.body.response.serverVersion, /^\d+\.\d+/);
  assert.equal(meta.body.response.ServerVersion, meta.body.response.serverVersion);
  assert.match(meta.body.response.serverHostTime, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  assert.match(meta.body.response.serverHostTimeISO, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  assert.equal(Date.parse(meta.body.response.serverHostTimeISO) - Date.parse(meta.body.response.serverHostTime + 'Z'), new Date(meta.body.response.serverHostTimeISO).getTimezoneOffset() * 60_000);
  assert.equal((await call('/server/status', { headers: auth })).body.response.status, 'RUNNING');

  const out = await call(`/user/auth/${auth.authorization.slice(7)}`, { method: 'DELETE', headers: auth });
  assert.equal(code(out), '0');
  assert.equal((await call('/databases', { headers: auth })).status, 401, 'a logged-out token is refused');
});

test('databases: list, pause, resume, close (ending sessions) and open', { skip }, async () => {
  const auth = await login();
  const list = await call('/databases', { headers: auth });
  assert.equal(list.body.response.totalDBCount, 1);
  const db = list.body.response.databases[0];
  assert.equal(typeof db.id, 'string');
  assert.equal(db.filename, 'Charts.fmp12');
  assert.equal(db.status, 'NORMAL');
  assert.ok(db.size > 0);
  assert.ok(db.enabledExtPrivileges.includes('fmrest'));

  const patch = (status: string) => call(`/databases/${db.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status }) });

  // Paused: the Data API can't reach it; resumed, it can.
  const paused = await patch('PAUSED');
  assert.equal(paused.status, 200, 'PATCH by database ID supports the per-file status command');
  assert.equal(code(paused), '0');
  assert.equal(paused.body.response.database.status, 'PAUSED');
  assert.notEqual((await dataApiLogin()).body.messages[0].code, '0');
  assert.equal((await patch('RESUMED')).body.response.database.status, 'NORMAL');
  const session = await dataApiLogin();
  assert.equal(session.body.messages[0].code, '0');
  const token = session.body.response.token;

  // Its client shows up, then closing the file ends the session.
  const clients = await call('/clients', { headers: auth });
  assert.equal(clients.body.response.clients.length, 1);
  assert.equal(clients.body.response.clients[0].userName, 'Admin');
  assert.equal(clients.body.response.clients[0].guestFiles[0].filename, 'Charts.fmp12');

  const closed = await patch('CLOSED');
  assert.equal(closed.body.response.database.status, 'CLOSED');
  assert.equal((await call('/databases', { headers: auth })).body.response.databases[0].status, 'CLOSED');
  assert.equal(host.get('Charts'), undefined);
  const after = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records`, { headers: { authorization: `Bearer ${token}` } });
  assert.notEqual(after.status, 200, 'the closed file\'s session is gone');
  assert.equal((await call('/clients', { headers: auth })).body.response.clients.length, 0);

  // Opened again, with its data.
  assert.equal((await patch('OPENED')).body.response.database.status, 'NORMAL');
  assert.ok(Number(host.get('Charts')!.query('SELECT count(*) AS n FROM Congress')[0].n) > 0);

  // Bad status and unknown id.
  assert.equal(code(await patch('SLEEPING')), '960');
  assert.equal((await call('/databases/999', { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'CLOSED' }) })).status, 404);

  // Stopping the server closes every file; running opens them again.
  assert.equal((await call('/server/status', { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'STOPPED' }) })).body.response.status, 'STOPPED');
  assert.equal(host.get('Charts'), undefined);
  await call('/server/status', { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'RUNNING' }) });
  assert.ok(host.get('Charts'));
});

test('pausing and stopping several files succeeds during an in-flight read', { skip }, async (t) => {
  const work = mkdtempSync(join(tmpdir(), 'tabularius-adminapi-checkpoint-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  for (const name of ['Charts', 'Inventory', 'Invoices']) copyFileSync(fixture, join(work, `${name}.fmp12`));
  setAdminPassword(work, 'secret');
  const running = await serve({ dir: work, port: 0, log: () => {} });
  t.after(() => new Promise<void>((resolve) => running.server.close(() => resolve())));
  const endpoint = `${running.url}/fmi/admin/api/v2`;
  const request = (path: string, init: RequestInit = {}) => fetch(endpoint + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  }).then(async (response) => ({ status: response.status, body: await response.json() as { response: Record<string, any>; messages: { code: string; text: string }[] } }));
  const loginReply = await request('/user/auth', { method: 'POST', headers: { authorization: `Basic ${btoa('admin:secret')}` } });
  const auth = { authorization: `Bearer ${loginReply.body.response.token}` };
  const setAll = (status: string) => request('/databases', { method: 'PATCH', headers: auth, body: JSON.stringify({ status }) });
  const startRead = () => {
    const store = running.host.get('Charts')!;
    store.query('SELECT * FROM Congress LIMIT 1'); // initialize the store's read connection
    const internal = store as unknown as { readOnlySql?: { prepare(sql: string): { iterate(): Iterator<unknown> } } };
    const cursor = internal.readOnlySql!.prepare('SELECT * FROM Congress').iterate();
    assert.equal(cursor.next().done, false);
    return cursor;
  };

  const pauseRead = startRead();
  const paused = await setAll('PAUSED');
  assert.equal(paused.status, 200, JSON.stringify(paused.body.messages));
  assert.equal(paused.body.messages[0].code, '0');
  assert.equal(paused.body.response.databases.length, 3);
  try { pauseRead.return?.(); } catch { /* checkpoint finalizes the test's in-flight cursor */ }

  const opened = await setAll('RESUMED');
  assert.equal(opened.status, 200);
  const stopRead = startRead();
  const stopped = await request('/server/status', { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'STOPPED' }) });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body.messages));
  assert.equal(stopped.body.response.status, 'STOPPED');
  try { stopRead.return?.(); } catch { /* closing a stopped file finalizes the test's cursor */ }
});

test('clients: disconnect and message', { skip }, async () => {
  const auth = await login();
  const session = await dataApiLogin();
  const token = session.body.response.token;
  const [client] = (await call('/clients', { headers: auth })).body.response.clients;
  assert.equal(code(await call(`/clients/${client.id}/message`, { method: 'POST', headers: auth, body: JSON.stringify({ messageText: 'Closing soon' }) })), '0');
  assert.equal(code(await call(`/clients/${client.id}/message`, { method: 'POST', headers: auth, body: JSON.stringify({}) })), '958');
  const gone = await call(`/clients/${client.id}?messageText=Bye`, { method: 'DELETE', headers: auth });
  assert.equal(gone.body.response.client.id, client.id);
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 401);
  assert.equal((await call(`/clients/${client.id}`, { method: 'DELETE', headers: auth })).status, 404);
});

test('schedules: create a script schedule, run it, change, duplicate and delete it', { skip }, async () => {
  const auth = await login();
  const made = await call('/schedules/filemakerscript', {
    method: 'POST', headers: auth, body: JSON.stringify({
      name: 'Nightly', enabled: true,
      filemakerScriptType: { resource: 'file:Charts.fmp12', fmScriptName: 'Show House', fmScriptParam: 'Rank', fmScriptAccount: 'Admin' },
      everyndaysType: { startTimeStamp: '2026-01-01T02:30:00', dailyDays: 1 },
    }),
  });
  assert.equal(code(made), '0', made.body.messages[0].text);
  const s = made.body.response.schedule;
  assert.equal(s.name, 'Nightly');
  assert.ok(Number(s.id) >= 2);
  assert.equal(s.filemakerScriptType.fmScriptName, 'Show House');
  assert.equal(s.everyndaysType.dailyDays, 1);
  assert.match(s.everyndaysType.startTimeStamp, /T02:30:00$/);
  assert.match(s.nextRun, /T02:30:00$/);
  assert.match(s.nextRunISO, /T02:30:00[+-]\d\d:\d\d$/);

  // Every 4 hours instead.
  const changed = await call(`/schedules/${s.id}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ everyndaysType: { startTimeStamp: '2026-01-01T00:00:00', dailyDays: 1, repeatTask: { repeatFrequency: 4, repeatInterval: 'HOURS' } } }),
  });
  assert.equal(changed.body.response.schedule.everyndaysType.repeatTask.repeatFrequency, 4);

  // Run now, then its last run is recorded.
  assert.equal(code(await call(`/schedules/${s.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'RUNNING' }) })), '0');
  let one;
  for (let i = 0; i < 100; i++) {
    one = (await call(`/schedules/${s.id}`, { headers: auth })).body.response.schedule;
    if (one.lastRun) break;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  assert.match(one.lastRun, /^\d{4}-/);
  assert.match(one.lastRunISO, /[+-]\d\d:\d\d$/);
  assert.equal(one.status, 'IDLE');

  // Disable.
  assert.equal((await call(`/schedules/${s.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ enabled: false }) })).body.response.schedule.enabled, false);

  // Duplicate.
  const copy = await call(`/schedules?source=${s.id}`, { method: 'POST', headers: auth });
  assert.equal(copy.body.response.schedule.name, 'Nightly Copy');
  assert.equal((await call('/schedules', { headers: auth })).body.response.schedules.length, 2);

  // Script, backup and message schedules; the other kinds are Not Supported.
  assert.equal(code(await call('/schedules/verify', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'V', verifyType: {}, everyndaysType: {} }) })), '21');

  // Delete.
  assert.equal(code(await call(`/schedules/${copy.body.response.schedule.id}`, { method: 'DELETE', headers: auth })), '0');
  assert.equal(code(await call(`/schedules/${s.id}`, { method: 'DELETE', headers: auth })), '0');
  assert.equal((await call(`/schedules/${s.id}`, { headers: auth })).status, 404);
});

test('schedules: a backup schedule backs up the hosted files, keeps the newest sets and lists as a backup', { skip }, async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const auth = await login();
  const target = mkdtempSync(join(tmpdir(), 'tabularius-adminapi-backups-'));
  try {
    const body = (extra: Record<string, unknown>) => JSON.stringify({ name: 'Nightly backup', enabled: true, everyndaysType: { startTimeStamp: '2026-01-01T02:00:00', dailyDays: 1 }, ...extra });
    // Not offered: some of the files, clones; a script and a backup in one.
    for (const bad of [{ resourceType: 'SELECTED_DB' }, { clone: true }]) {
      assert.equal(code(await call('/schedules/backup', { method: 'POST', headers: auth, body: body({ backupType: { backupTarget: target, ...bad } }) })), '21');
    }
    assert.equal(code(await call('/schedules/backup', { method: 'POST', headers: auth, body: body({ backupType: { backupTarget: target, retainBackups: 0 } }) })), '960');
    assert.equal(code(await call('/schedules/backup', { method: 'POST', headers: auth, body: body({}) })), '958');
    assert.equal(code(await call('/schedules/filemakerscript', { method: 'POST', headers: auth, body: body({ backupType: { backupTarget: target } }) })), '958', 'the path and the body name the same kind');

    const made = await call('/schedules/backup', { method: 'POST', headers: auth, body: body({ backupType: { resourceType: 'ALL_DB', backupTarget: target, retainBackups: 2 } }) });
    assert.equal(code(made), '0', made.body.messages[0].text);
    const s = made.body.response.schedule;
    assert.deepEqual(s.backupType, { resourceType: 'ALL_DB', resource: '', backupTarget: target, retainBackups: 2, clone: false, verifyBackup: true });
    assert.equal(s.filemakerScriptType, undefined);
    assert.equal(s.everyndaysType.dailyDays, 1);

    // Run it three times: two sets stay.
    for (let i = 0; i < 3; i++) {
      assert.equal(code(await call(`/schedules/${s.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'RUNNING' }) })), '0');
      for (let t = 0; t < 100; t++) {
        const now = (await call(`/schedules/${s.id}`, { headers: auth })).body.response.schedule;
        if (now.status === 'IDLE' && now.lastRun && readdirSync(target).filter((n) => !n.endsWith('.partial')).length >= Math.min(i + 1, 2)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      t.mock.timers.tick(1100); // sets are named by the second
    }
    const sets = readdirSync(target).filter((n) => !n.endsWith('.partial'));
    assert.equal(sets.length, 2);
    assert.ok(existsSync(join(target, sets[0], 'Charts.fmp12')) || readdirSync(join(target, sets[0])).some((f) => f.startsWith('Charts')), 'the hosted file is in the set');
    const listed = (await call(`/schedules/${s.id}`, { headers: auth })).body.response.schedule;
    assert.equal(listed.lastError, 0);

    // Changed in place; not turned into a script schedule.
    const changed = await call(`/schedules/${s.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ backupType: { retainBackups: 5 } }) });
    assert.equal(changed.body.response.schedule.backupType.retainBackups, 5);
    assert.equal(code(await call(`/schedules/${s.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ filemakerScriptType: { resource: 'file:Charts.fmp12', fmScriptName: 'x', fmScriptAccount: 'Admin' } }) })), '960');
    const copy = await call(`/schedules?source=${s.id}`, { method: 'POST', headers: auth });
    assert.equal(copy.body.response.schedule.backupType.retainBackups, 5);
    // Reading the new set back is on unless asked off.
    const off = await call(`/schedules/${s.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ backupType: { verifyBackup: false } }) });
    assert.equal(off.body.response.schedule.backupType.verifyBackup, false);
    const on = await call(`/schedules/${s.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ backupType: { verifyBackup: true } }) });
    assert.equal(on.body.response.schedule.backupType.verifyBackup, true);
    for (const id of [s.id, copy.body.response.schedule.id]) assert.equal(code(await call(`/schedules/${id}`, { method: 'DELETE', headers: auth })), '0');
  } finally {
    rmSync(target, { recursive: true });
  }
});

test('schedules: a message schedule sends its text to the connected clients', { skip }, async () => {
  const auth = await login();
  const body = (extra: Record<string, unknown>) => JSON.stringify({ name: 'Restart notice', enabled: true, everyndaysType: { startTimeStamp: '2026-01-01T17:45:00', dailyDays: 1 }, ...extra });
  assert.equal(code(await call('/schedules/message', { method: 'POST', headers: auth, body: body({ messageType: { resourceType: 'SELECTED' , text: 'x' } }) })), '21');
  assert.equal(code(await call('/schedules/message', { method: 'POST', headers: auth, body: body({ messageType: {} }) })), '958', 'text is needed');
  assert.equal(code(await call('/schedules/message', { method: 'POST', headers: auth, body: body({ messageType: { text: 'x'.repeat(201) } }) })), '960');
  assert.equal(code(await call('/schedules/message', { method: 'POST', headers: auth, body: body({ backupType: {} , messageType: { text: 'x' } }) })), '958', 'one kind of task');

  const made = await call('/schedules/message', { method: 'POST', headers: auth, body: body({ messageType: { resourceType: 'ALL_CLIENTS', text: 'Server restarts at 6 pm' } }) });
  assert.equal(code(made), '0', made.body.messages[0].text);
  const s = made.body.response.schedule;
  assert.deepEqual(s.messageType, { resourceType: 'ALL_CLIENTS', text: 'Server restarts at 6 pm' });
  assert.equal(s.filemakerScriptType, undefined);

  assert.equal(code(await call(`/schedules/${s.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'RUNNING' }) })), '0');
  for (let t = 0; t < 100; t++) {
    const now = (await call(`/schedules/${s.id}`, { headers: auth })).body.response.schedule;
    if (now.status === 'IDLE' && now.lastRun) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const ran = (await call(`/schedules/${s.id}`, { headers: auth })).body.response.schedule;
  assert.equal(ran.lastError, 0);
  assert.ok(ran.lastRun);
  assert.equal(code(await call(`/schedules/${s.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ messageType: { text: 'Server restarts at 7 pm' } }) })), '0');
  assert.equal((await call(`/schedules/${s.id}`, { headers: auth })).body.response.schedule.messageType.text, 'Server restarts at 7 pm');
  assert.equal(code(await call(`/schedules/${s.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ backupType: { retainBackups: 2 } }) })), '960', 'not another kind');
  assert.equal(code(await call(`/schedules/${s.id}`, { method: 'DELETE', headers: auth })), '0');
});
