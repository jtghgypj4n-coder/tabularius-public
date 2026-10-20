// The server's logs and the admin console's log viewer: what each log
// records, filtering, rotation and download.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { ServerLogs, logTime, parseLogLimit, parseLogTime, redactPath } from '../src/server-logs.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('entries are read back newest first, filtered, across the log and its older half', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-logs-'));
  try {
    const logs = new ServerLogs(dir, { limit: 200 });
    logs.write('Event', 'Information', 'server', 'first');
    logs.write('Event', 'Error', 'server', 'second\twith a tab\nand a line break');
    await logs.flush();
    // Past the limit: the next batch starts the log again, the old one kept beside it.
    for (let i = 0; i < 3; i++) logs.write('Event', 'Information', 'server', `more ${i} ${'x'.repeat(60)}`);
    await logs.flush();
    logs.write('Event', 'Warning', 'server', 'last');
    await logs.flush();
    assert.ok(existsSync(join(dir, 'Logs', 'Event-old.log')), 'started again at the limit');

    const all = await logs.read('Event');
    assert.equal(all.entries[0].message, 'last');
    assert.equal(all.entries.at(-1)!.message, 'first');
    assert.equal(all.entries.find((e) => e.type === 'Error')!.message, 'second with a tab and a line break', 'one entry, one line');
    assert.deepEqual((await logs.read('Event', { type: 'Error' })).entries.map((e) => e.message), ['second with a tab and a line break']);
    assert.equal((await logs.read('Event', { q: 'MORE 1' })).entries.length, 1, 'any case');
    const two = await logs.read('Event', { limit: 2 });
    assert.equal(two.entries.length, 2);
    assert.equal(two.more, true);
    assert.equal((await logs.read('Event', { from: Date.now() + 60_000 })).entries.length, 0);
    assert.equal((await logs.read('Event', { to: Date.now() + 60_000 })).entries.length, all.entries.length);
    assert.deepEqual(logs.list().map((l) => l.name), ['Event', 'Access', 'ScriptEvent', 'fmdapi', 'Admin']);

    // Closing writes what's waiting at once.
    logs.write('Access', 'Information', '127.0.0.1', 'on the way out');
    logs.close();
    assert.match(readFileSync(join(dir, 'Logs', 'Access.log'), 'utf8'), /\tInformation\t127\.0\.0\.1\ton the way out\n$/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('timestamps carry the offset from UTC and read back to the same moment; tokens are cut out of paths', () => {
  const d = new Date(Date.UTC(2026, 9, 12, 5, 6, 7, 89));
  assert.equal(parseLogTime(logTime(d)), d.getTime());
  assert.match(logTime(d), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} [+-]\d{4}$/);
  assert.equal(redactPath('/fmi/data/vLatest/databases/X/sessions/abc123'), '/fmi/data/vLatest/databases/X/sessions/…');
  assert.equal(redactPath('/tabularius/auth/v1/oidc/callback?code=xyz&state=s1&x=1'), '/tabularius/auth/v1/oidc/callback?code=…&state=…&x=1');
});

let dir: string;
let server: Server;
let base: string;
before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-logviewer-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Ann', 'pw', full.name);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const admin = (path: string, init: RequestInit = {}) => fetch(`${base}/tabularius/admin/v1/${path}`, { ...init, headers: { 'x-tabularius-admin': '1', ...init.headers } });
const entries = async (log: string, query = '') => (await (await admin(`logs/${log}${query}`)).json()).entries as { type: string; source: string; message: string }[];

test('sign-ins, Data API calls, server scripts and admin changes are logged and shown in the console', { skip }, async () => {
  const data = `${base}/fmi/data/vLatest/databases/Charts`;
  const signIn = (password: string) => fetch(`${data}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`Ann:${password}`) }, body: '{}' }).then((r) => r.json());
  assert.equal((await signIn('wrong')).messages[0].code, '212');
  const token = (await signIn('pw')).response.token as string;
  await fetch(`${data}/layouts/Congress/records?_limit=2`, { headers: { authorization: `Bearer ${token}` } });
  await fetch(`${data}/layouts/Congress/script/No%20such%20script`, { headers: { authorization: `Bearer ${token}` } });
  await fetch(`${data}/sessions/${token}`, { method: 'DELETE' });
  await admin('message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello' }) });

  const access = await entries('Access');
  assert.match(access[0].message, /^Ann signed out of Charts$/);
  assert.match(access[1].message, /^Ann signed in to Charts \(Data API\)$/);
  assert.match(access[2].message, /^Ann could not sign in to Charts: wrong account or password$/);
  assert.equal(access[2].type, 'Warning');
  assert.match(access[2].source, /127\.0\.0\.1/);

  const calls = await entries('fmdapi');
  const records = calls.find((e) => e.message.startsWith('GET /fmi/data/vLatest/databases/Charts/layouts/Congress/records'))!;
  assert.match(records.message, /\?_limit=2 200 code 0 \d+ ms \d+ bytes account Ann$/);
  const signOut = calls.find((e) => e.message.startsWith('DELETE'))!;
  assert.ok(!signOut.message.includes(token), 'the token is not in the log');
  assert.ok(calls.some((e) => / 401 code 212 /.test(e.message) && e.type === 'Warning'));
  assert.ok(!readFileSync(join(dir, 'Logs', 'fmdapi.log'), 'utf8').includes(token));

  assert.ok((await entries('ScriptEvent')).some((e) => e.message.includes('No such script')), 'the script that failed');
  const changes = await entries('Admin');
  assert.match(changes[0].message, /^POST \/tabularius\/admin\/v1\/message 200$/);
  assert.ok((await entries('Event')).some((e) => /^Server started at /.test(e.message)), 'the server-started line is logged');

  // Filters, the list of logs, and the download.
  assert.equal((await entries('Access', '?type=Warning')).length, 1);
  assert.equal((await entries('Access', '?q=signed%20in')).length, 1);
  assert.equal((await entries('Access', `?from=${Date.now() + 60_000}`)).length, 0);
  const list = (await (await admin('logs')).json()).logs as { name: string; bytes: number }[];
  assert.ok(list.find((l) => l.name === 'Access')!.bytes > 0);
  const file = await admin('logs/Access/download');
  assert.match(file.headers.get('content-disposition')!, /attachment; filename="Access.log"/);
  assert.match(await file.text(), /\tWarning\t[^\t]*127\.0\.0\.1[^\t]*\tAnn could not sign in to Charts/);
  assert.equal((await admin('logs/Nope')).status, 404);
  assert.equal((await admin('logs/..%2Fsecret')).status, 404);
});

test('lines a write could not put in the file are kept and written, in order, once it works again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-logs-'));
  const errors: unknown[][] = [];
  const realError = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  try {
    const logs = new ServerLogs(dir);
    // A file where the Logs folder belongs: nothing can be written under it.
    writeFileSync(join(dir, 'Logs'), 'in the way');
    logs.write('Event', 'Error', 'server', 'while the disk was broken');
    logs.write('Access', 'Information', 'server', 'also kept');
    await logs.flush();
    logs.write('Event', 'Error', 'server', 'still broken');
    await logs.flush();
    assert.equal(errors.length, 1, 'one complaint for the whole failure, not one per attempt');
    rmSync(join(dir, 'Logs'));
    logs.write('Event', 'Information', 'server', 'after it was fixed');
    await logs.flush();
    const event = (await logs.read('Event')).entries.map((e) => e.message);
    assert.deepEqual(event.reverse(), ['while the disk was broken', 'still broken', 'after it was fixed']);
    assert.deepEqual((await logs.read('Access')).entries.map((e) => e.message), ['also kept']);
    // Fixed, so a later failure is complained about again.
    rmSync(join(dir, 'Logs'), { recursive: true });
    writeFileSync(join(dir, 'Logs'), 'in the way again');
    logs.write('Event', 'Error', 'server', 'broken again');
    await logs.flush();
    assert.equal(errors.length, 2);
    logs.close();
  } finally {
    console.error = realError;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('what is kept while a log cannot be written is bounded, keeping the newest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-logs-'));
  const realError = console.error;
  console.error = () => {};
  try {
    const logs = new ServerLogs(dir);
    writeFileSync(join(dir, 'Logs'), 'in the way');
    const big = 'x'.repeat(250_000);
    for (let i = 0; i < 60; i++) logs.write('Event', 'Error', 'server', `${i} ${big}`);
    await logs.flush();
    rmSync(join(dir, 'Logs'));
    await logs.flush();
    const entries = (await logs.read('Event', { limit: 1000 })).entries;
    assert.ok(entries.length < 60 && entries.length > 20, `kept ${entries.length}, not all and not none`);
    assert.ok(entries[0].message.startsWith('59 '), 'the newest are the ones kept');
    assert.ok(statSync(join(dir, 'Logs', 'Event.log')).size < 9 * 1024 * 1024);
  } finally {
    console.error = realError;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--log-limit takes a size, and the log is turned over at it', async () => {
  assert.equal(parseLogLimit('100MB'), 100 * 1024 * 1024);
  assert.equal(parseLogLimit('1.5gb'), 1.5 * 1024 ** 3);
  assert.equal(parseLogLimit('512 KB'), 512 * 1024);
  assert.equal(parseLogLimit('8'), 8 * 1024 * 1024, 'a bare number is megabytes');
  assert.equal(parseLogLimit(2), 2 * 1024 * 1024);
  for (const bad of ['', 'big', '10 TB', '-5MB', '1KB', '0']) assert.throws(() => parseLogLimit(bad), /--log-limit/, bad);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-logs-'));
  try {
    mkdirSync(join(dir, 'Logs'));
    const logs = new ServerLogs(dir, { limit: parseLogLimit('64KB') });
    for (let i = 0; i < 3; i++) {
      logs.write('Event', 'Information', 'server', 'y'.repeat(40_000));
      await logs.flush();
    }
    assert.ok(existsSync(join(dir, 'Logs', 'Event-old.log')), 'the third batch started it over at 64 KB');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
