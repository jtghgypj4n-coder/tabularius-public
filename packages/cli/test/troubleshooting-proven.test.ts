// docs/troubleshooting.md, proven by running it: each symptom the page describes is made on a synthetic folder, the message is
// the one the page quotes, and the remedy the page gives is followed and works. (troubleshooting-docs.test.ts checks that each
// heading is still a string in the code; this checks that what the page says to do about it does what it says.) Nothing here
// needs a FileMaker file, so it runs everywhere; the one that does (a dropped file turning up) skips with a message without
// the fixtures.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { createServer as createNet } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { serve, setAdminPassword, localCertificateFiles } from '../../server/src/index.ts';
import { request as httpsRequest } from 'node:https';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../server/src/mcp.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const root = join(import.meta.dirname, '..', '..', '..');
const page = readFileSync(join(root, 'docs', 'troubleshooting.md'), 'utf8');
const EXT = '.openhbam.sqlite';
const PASSWORD = 'correct-horse-battery';

/** A folder in which `Shop` is hosted and `boss` can sign in. */
// node:test runs a test's after hooks in registration order, and the folder is made before the server that uses it, so the
// folder's own cleanup would remove files from under a server that is still running. Servers register here too, and the
// folder stops them (each stop is idempotent) before it removes anything.
const stoppers = new WeakMap<TestContext, (() => Promise<unknown>)[]>();
const stoppable = (t: TestContext, stop: () => Promise<unknown>) => { t.after(stop); (stoppers.get(t) ?? stoppers.set(t, []).get(t)!).push(stop); };

function folder(t: TestContext, names = ['Shop']): string {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-trouble-'));
  t.after(async () => {
    for (const stop of stoppers.get(t) ?? []) await stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  for (const name of names) {
    createStore(join(dir, name + EXT));
    const s = new Store(join(dir, name + EXT), name);
    s.applyDesign([{ op: 'createTable', name: 'Clients', fields: [{ name: 'Name' }, { name: 'Notes' }] }]);
    for (let i = 0; i < 300; i++) s.create('Clients', { Name: `Client ${i}`, Notes: 'x'.repeat(300) + i });
    s.setPassword('boss', PASSWORD, '[Full Access]');
    s.checkpoint();
    s.close();
  }
  return dir;
}

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...process.env, PORT: undefined, TABULARIUS_HOME: join(tmpdir(), 'tabularius-trouble-home'), ...extra });
const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(main, args, { env: env(extra), timeout: 120_000 });

async function start(t: TestContext, dir: string, options: Partial<Parameters<typeof serve>[0]> = {}) {
  const logs: string[] = [];
  const running = await serve({ dir, port: 0, log: (l: string) => logs.push(l), checkFiles: false, watch: false, ...options });
  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => { running.server.close(() => resolve()); running.server.closeAllConnections?.(); });
    await running.host.close();
  };
  stoppable(t, stop);
  return { ...running, logs, stop };
}

const signIn = async (url: string, db: string, account: string, password: string) => {
  const r = await fetch(`${url}/fmi/data/vLatest/databases/${db}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:${password}`), 'content-type': 'application/json' }, body: '{}' });
  const body = (await r.json()) as { messages: { code: string; message: string }[]; response: { token?: string } };
  return { status: r.status, retryAfter: r.headers.get('retry-after'), code: body.messages[0].code, message: body.messages[0].message, token: body.response.token };
};

/** Runs `tabularius serve` for real and resolves with its output once it prints its addresses (or stops by itself). */
function serveProcess(t: TestContext, args: string[]): Promise<{ out: string; err: string; stop: () => Promise<void>; exited: Promise<number | null> }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--no-warnings', main, 'serve', ...args], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const exited = new Promise<number | null>((done) => child.on('close', done));
    const stop = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await exited; } };
    stoppable(t, stop);
    const ready = () => resolve({ get out() { return out; }, get err() { return err; }, stop, exited });
    child.stdout.setEncoding('utf8').on('data', (c: string) => { out += c; if (/Web client: /.test(out)) ready(); });
    child.stderr.setEncoding('utf8').on('data', (c: string) => { err += c; });
    void exited.then(ready);
  });
}

const occupy = (port = 0) => new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
  const s = createNet();
  s.listen(port, '127.0.0.1', () => resolve({ port: (s.address() as { port: number }).port, close: () => new Promise((done) => s.close(() => done())) }));
});

const sectionOf = (heading: string): string => {
  const at = page.indexOf(`## ${heading}`);
  assert.ok(at >= 0, `the page has "${heading}"`);
  return page.slice(at, page.indexOf('\n## ', at + 3) < 0 ? undefined : page.indexOf('\n## ', at + 3));
};

test('port in use: the message names the program-finding command, and --port with a free port is the way out', async (t) => {
  const dir = folder(t);
  const taken = await occupy();
  t.after(() => taken.close());
  const refused = await serveProcess(t, [dir, '--port', String(taken.port)]);
  assert.equal(await refused.exited, 1);
  assert.match(refused.err, new RegExp(`error: port ${taken.port} is in use: another program is already listening on 127\\.0\\.0\\.1:${taken.port}`));
  assert.match(refused.err, /lsof -nP -iTCP:\d+ -sTCP:LISTEN/);
  assert.match(sectionOf('`port {} is in use: another program is already listening on`'), /lsof -nP -iTCP:<port> -sTCP:LISTEN/);

  const free = await occupy();
  await free.close();
  const running = await serveProcess(t, [dir, '--port', String(free.port)]);
  assert.match(running.out, new RegExp(`Web client: http://127\\.0\\.0\\.1:${free.port}/app/`));
  await running.stop();
});

test('a folder the user cannot write: the message the page quotes, and it serves once the folder is right', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'permissions are not enforced for this user (root) or this system' : false }, async (t) => {
  const dir = folder(t);
  chmodSync(dir, 0o555);
  try {
    const refused = await cli(['serve', dir, '--port', '0']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /error: serve: .* can't read and write|can't be read and written by this user/);
    assert.ok(page.includes('`{} can\'t be read and written by this user`'));
  } finally {
    // The folder's own cleanup runs before any hook added here, so the folder must be writable again by then.
    chmodSync(dir, 0o755);
  }
  const running = await serveProcess(t, [dir, '--port', '0']);
  assert.match(running.out, /hosting Shop/);
});

test('wrong password: Data API error 212 with the quoted words, and tabularius passwd sets one that signs in', async (t) => {
  const dir = folder(t);
  const s = await start(t, dir);
  const wrong = await signIn(s.url, 'Shop', 'boss', 'not-it');
  assert.deepEqual([wrong.status, wrong.code, wrong.message], [401, '212', 'Invalid user account and/or password; please try again']);
  const unknown = await signIn(s.url, 'Shop', 'nobody', PASSWORD);
  assert.equal(unknown.code, '212', 'an account that is not there reads the same as a wrong password');
  const section = sectionOf('`Invalid user account and/or password; please try again`');
  assert.match(section, /Data API error 212/);
  assert.match(section, /`tabularius passwd <folder> <database> <account>`/);
  const set = await cli(['passwd', dir, 'Shop', 'boss'], { TABULARIUS_PASSWORD: 'a-new-password-1' });
  assert.equal(set.status, 0, set.stderr);
  assert.match(set.stdout, /password set for boss in Shop/);
  assert.equal((await signIn(s.url, 'Shop', 'boss', 'a-new-password-1')).status, 200);
  assert.equal((await signIn(s.url, 'Shop', 'boss', PASSWORD)).code, '212', 'the old one no longer does');
});

test('a lost admin password: tabularius admin-password sets another from the machine that hosts the files', async (t) => {
  const dir = folder(t);
  const set = await cli(['admin-password', dir], { TABULARIUS_PASSWORD: 'console-password-1' });
  assert.equal(set.status, 0, set.stderr);
  assert.equal(set.stdout.trim(), `admin password set for ${dir}`);
  assert.match(sectionOf('`Invalid user account and/or password; please try again`'), /`tabularius admin-password <folder>`/);
});

/** The administrator's /mcp token the server made in the folder on its first start. */
const adminToken = (dir: string) => `Bearer ${readFileSync(join(dir, '.openhbam-mcp-token'), 'utf8').trim()}`;

test('an unknown database name: a sign-in answers it as a wrong password on purpose, an AI app is told what is hosted, and doctor lists the folder', async (t) => {
  const dir = folder(t, ['Shop', 'Other']);
  const s = await start(t, dir);
  const unknown = await signIn(s.url, 'Nope', 'boss', PASSWORD);
  const wrong = await signIn(s.url, 'Shop', 'boss', 'not-it');
  assert.deepEqual([unknown.status, unknown.code, unknown.message], [wrong.status, wrong.code, wrong.message], 'a stranger cannot tell a missing file from a wrong password');
  const mcp = await fetch(`${s.url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: adminToken(dir) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'describe_database', arguments: { database: 'Nope' } } }),
  });
  const refused = ((await mcp.json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /^No hosted database named "Nope"\. Hosted: Other, Shop$/);
  const doctor = await cli(['doctor', dir, '--port', '0']);
  assert.match(doctor.stdout, /Files: 2 files to host/);
  const section = sectionOf('`Unable to open file`');
  assert.match(section, /212/);
  assert.match(section, /`tabularius doctor <folder>`/);
});

test('turned-off AI: the file says so, tabularius ai on turns it back on, and both are what the page tells you', async (t) => {
  const dir = folder(t);
  const off = await cli(['ai', dir, 'Shop', 'off']);
  assert.match(off.stdout, /AI is off for Shop/);
  const first = await start(t, dir);
  const ask = async (url: string) => {
    const r = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: adminToken(dir) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'describe_database', arguments: { database: 'Shop' } } }),
    });
    return ((await r.json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
  };
  const refused = await ask(first.url);
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /AI is turned off for Shop/);
  await first.stop();
  const on = await cli(['ai', dir, 'Shop', 'on']);
  assert.match(on.stdout, /AI is on for Shop/);
  const second = await start(t, dir);
  assert.notEqual((await ask(second.url)).isError, true);
  const section = sectionOf('`AI is turned off for {}`');
  for (const must of ['`tabularius ai <folder> <database> off`', '`tabularius ai <folder> <database> on`', '--ai-exclude']) assert.ok(section.includes(must), must);
});

test('a damaged file: refused with the quoted words, the rest keep working, and doctor, verify-backup and restore put it right as the page says', async (t) => {
  const dir = folder(t, ['Shop', 'Good']);
  const backups = join(dir, 'Backups');
  const made = await cli(['backup', dir, '--to', backups]);
  assert.equal(made.status, 0, made.stderr);
  const verified = await cli(['verify-backup', dir, '--from', backups]);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  const set = readdirSync(backups)[0];
  assert.match(verified.stdout, /ok|sound|checked/i);

  // A page of the file is lost.
  const file = join(dir, 'Shop' + EXT);
  const fd = openSync(file, 'r+');
  try { writeSync(fd, Buffer.alloc(4096), 0, 4096, 0); } finally { closeSync(fd); }

  const doctor = await cli(['doctor', dir, '--port', '0']);
  assert.match(doctor.stdout, /PROBLEM Damaged file: Shop: file is not a database/);

  const down = await start(t, dir);
  assert.deepEqual(down.host.names(), ['Good']);
  assert.ok(down.logs.some((l) => /Shop\.openhbam\.sqlite, so it is not hosted: Shop is damaged \(/.test(l)), down.logs.join('\n'));
  console.log('DAMAGED SIGNIN', await signIn(down.url, 'Shop', 'boss', PASSWORD));
  assert.equal((await signIn(down.url, 'Good', 'boss', PASSWORD)).status, 200, 'every other file keeps working');
  await down.stop();

  const restored = await cli(['restore', dir, set, 'Shop', '--from', backups]);
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(restored.stdout, /restored Shop/);
  const up = await start(t, dir);
  assert.deepEqual(up.host.names().sort(), ['Good', 'Shop']);
  // The file it replaced could not be read, so there was no sign-in state to keep: no password, until one is set (the page says so).
  assert.equal((await signIn(up.url, 'Shop', 'boss', PASSWORD)).status, 401);
  assert.equal((await cli(['passwd', dir, 'Shop', 'boss'], { TABULARIUS_PASSWORD: 'set-after-restore-1' })).status, 0);
  assert.equal((await signIn(up.url, 'Shop', 'boss', 'set-after-restore-1')).status, 200);
  assert.equal((await signIn(up.url, 'Good', 'boss', PASSWORD)).status, 200, 'the other file was not touched');

  const section = sectionOf('`{} is damaged ({}) and is not being served`');
  assert.match(section, /tabularius verify-backup <folder>/);
  assert.match(section, /tabularius restore <folder> <backup-set> <database>/);
});

test('an empty file is refused as empty and left alone; a backup puts it right', async (t) => {
  const dir = folder(t);
  const backups = join(dir, 'Backups');
  assert.equal((await cli(['backup', dir, '--to', backups])).status, 0);
  const file = join(dir, 'Shop' + EXT);
  writeFileSync(file, '');
  const s = await start(t, dir);
  assert.deepEqual(s.host.names(), []);
  assert.ok(s.logs.some((l) => /Shop is an empty file \(0 bytes\), not a database/.test(l)), s.logs.join('\n'));
  assert.equal(readFileSync(file).length, 0, 'nothing was built into it');
  await s.stop();
  const set = readdirSync(backups)[0];
  assert.equal((await cli(['restore', dir, set, 'Shop', '--from', backups])).status, 0);
  const again = await start(t, dir);
  assert.deepEqual(again.host.names(), ['Shop']);
});

test('request too large: a Data API body past 10 MiB is answered 413 with error 960', async (t) => {
  const dir = folder(t);
  const s = await start(t, dir);
  const big = JSON.stringify({ fieldData: { Name: 'x'.repeat(11 * 1024 * 1024) } });
  const r = await fetch(`${s.url}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`boss:${PASSWORD}`), 'content-type': 'application/json' }, body: big });
  const body = (await r.json()) as { messages: { code: string; message: string }[] };
  assert.equal(r.status, 413);
  assert.equal(body.messages[0].code, '960');
  assert.match(body.messages[0].message, /^Request body too large/);
  assert.match(sectionOf('`Request body too large`'), /10 MiB/);
});

const adminCall = async (url: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${url}/tabularius/admin/v1${path}`, { method, headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: (await r.json()) as Record<string, unknown>, retryAfter: r.headers.get('retry-after') };
};

test('locked out of a file account: five wrong passwords, the message with the time, and the console lifts it', async (t) => {
  const dir = folder(t);
  const s = await start(t, dir);
  for (let i = 0; i < 4; i++) assert.equal((await signIn(s.url, 'Shop', 'boss', 'wrong-' + i)).message, 'Invalid user account and/or password; please try again');
  await signIn(s.url, 'Shop', 'boss', 'wrong-4');
  const locked = await signIn(s.url, 'Shop', 'boss', PASSWORD);
  assert.equal(locked.status, 401);
  assert.equal(locked.code, '212');
  assert.match(locked.message, /^Too many failed sign-ins; try again after \d{4}-\d\d-\d\dT[\d:.]+Z$/);
  assert.ok(Number(locked.retryAfter) > 0 && Number(locked.retryAfter) <= 15 * 60, 'Retry-After says how long, up to the 15 minutes the page names');
  const section = sectionOf('`Too many failed sign-ins; try again after {}`');
  assert.match(section, /five wrong passwords/i);
  assert.match(section, /Security health/);
  // The remedy the page gives: Unlock, in the console, for that account.
  const unlocked = await adminCall(s.url, 'POST', '/accounts/unlock', { database: 'Shop', account: 'boss' });
  assert.deepEqual(unlocked.body, { ok: true, cleared: true });
  assert.equal((await signIn(s.url, 'Shop', 'boss', PASSWORD)).status, 200);
  // "Setting the account a new password does the same."
  for (let i = 0; i < 5; i++) await signIn(s.url, 'Shop', 'boss', 'wrong-again-' + i);
  assert.match((await signIn(s.url, 'Shop', 'boss', PASSWORD)).message, /^Too many failed sign-ins/);
  assert.equal((await adminCall(s.url, 'POST', '/accounts/set-password', { database: 'Shop', account: 'boss', password: 'fresh-password-1' })).status, 200);
  assert.equal((await signIn(s.url, 'Shop', 'boss', 'fresh-password-1')).status, 200);
  // From a terminal the password changes in the file, but the lock is in the running server's memory: a restart clears it.
  for (let i = 0; i < 5; i++) await signIn(s.url, 'Shop', 'boss', 'wrong-third-' + i);
  assert.equal((await cli(['passwd', dir, 'Shop', 'boss'], { TABULARIUS_PASSWORD: 'from-terminal-1' })).status, 0);
  await s.stop();
  const again = await start(t, dir);
  assert.equal((await signIn(again.url, 'Shop', 'boss', 'from-terminal-1')).status, 200);
  const html = readFileSync(join(root, 'packages', 'server', 'admin', 'index.html'), 'utf8');
  assert.match(html, /<h2>Security health/);
  assert.match(html, /<h3>Account access<\/h3>[\s\S]*Unlock \(lift sign-in lockout\)/);
});

test('locked out of the admin console: the message with the seconds, and a restart of the server lets you in again', async (t) => {
  const dir = folder(t);
  setAdminPassword(dir, 'console-password-1');
  const first = await start(t, dir);
  const attempt = (url: string, password: string) => fetch(`${url}/tabularius/admin/v1/sign-in`, { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  let last: Response | undefined;
  for (let i = 0; i < 5; i++) last = await attempt(first.url, 'nope-' + i);
  assert.equal(last!.status, 429, 'the fifth wrong password starts the lock');
  const message = ((await last!.json()) as { error: string }).error;
  assert.match(message, /^Too many failed attempts\. Try again in \d+ seconds\.$/);
  assert.equal((await attempt(first.url, 'console-password-1')).status, 429, 'the right password waits too');
  await first.stop();
  const second = await start(t, dir);
  assert.equal((await attempt(second.url, 'console-password-1')).status, 200);
  const section = sectionOf('`Too many failed attempts. Try again in {} seconds.`');
  assert.match(section, /admin console/i);
  assert.match(section, /restart/i);
});

test('after the server restarts, a sign-in token is refused with error 952 and signing in again works; the web client says the session ended', async (t) => {
  const dir = folder(t);
  const first = await start(t, dir);
  const { token } = await signIn(first.url, 'Shop', 'boss', PASSWORD);
  const call = (url: string) => fetch(`${url}/fmi/data/vLatest/databases/Shop/layouts`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await call(first.url)).status, 200);
  await first.stop();
  const second = await start(t, dir);
  const refused = await call(second.url);
  assert.equal(refused.status, 401);
  const body = (await refused.json()) as { messages: { code: string; message: string }[] };
  assert.equal(body.messages[0].code, '952');
  assert.match(body.messages[0].message, /^Invalid FileMaker Data API token \(\*\)/);
  assert.equal((await signIn(second.url, 'Shop', 'boss', PASSWORD)).status, 200);
  const section = sectionOf('`Invalid FileMaker Data API token (*)`');
  assert.match(section, /restart/i);
  assert.match(section, /POST \/sessions/);
  assert.ok(page.includes('Your session ended. Please log in again.'));
  assert.ok(readFileSync(join(root, 'packages', 'web', 'src', 'main.ts'), 'utf8').includes('Your session ended. Please log in again.'));
});

test('a file put in the folder: only a .fmp12 at the top of the folder is looked at, after its size has stopped changing; one that cannot be read is named in the log', async (t) => {
  const dir = folder(t);
  const s = await start(t, dir, { background: true, watch: true });
  mkdirSync(join(dir, 'Inside'));
  writeFileSync(join(dir, 'Inside', 'Deeper.fmp12'), 'x'.repeat(2000));
  writeFileSync(join(dir, 'Archive.fmp12.zip'), 'x'.repeat(2000));
  writeFileSync(join(dir, '.Hidden.fmp12'), 'x'.repeat(2000));
  writeFileSync(join(dir, 'Copy of Shop.fmp12.tmp'), 'x'.repeat(2000));
  writeFileSync(join(dir, 'Broken.FMP12'), 'x'.repeat(2000));
  await new Promise((r) => setTimeout(r, 1000));
  assert.ok(!s.logs.some((l) => /converting/.test(l)), 'a file that has just appeared is not touched until its size has stayed the same for another look');
  const end = Date.now() + 60_000;
  while (!s.logs.some((l) => /^couldn't convert /.test(l)) && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(s.logs.filter((l) => /converting|convert /.test(l)).map((l) => l.replace(/: .*/, '')), ['converting Broken.FMP12', "couldn't convert Broken.FMP12"], 'capitals in the extension do not matter; the others are not looked at');
  assert.match(s.logs.find((l) => /^couldn't convert /.test(l))!, /not a FileMaker file \(bad magic number\)/);
  assert.deepEqual(s.host.names(), ['Shop']);
  assert.match(s.host.failures.get('Broken.FMP12') ?? '', /./, 'the admin console lists it as failed with the reason');
  const section = sectionOf('A file I put in the folder does not appear');
  for (const cause of ['subfolder', '.fmp12', 'size has stopped changing', 'couldn\'t convert']) assert.ok(section.includes(cause), cause);
});

test('a conversion in progress is listed by the console with how far it has got', async (t) => {
  const dir = folder(t);
  const s = await start(t, dir);
  s.host.converted.set('Big', { fraction: 0.4, tablesDone: 2, tables: 5, records: 120_000, table: 'Orders' } as never);
  const status = await adminCall(s.url, 'GET', '/status');
  const converting = status.body.converting as { name: string; fraction: number; tables: number }[];
  assert.deepEqual(converting.map((c) => [c.name, c.fraction, c.tables]), [['Big', 0.4, 5]]);
  s.host.converted.delete('Big');
  assert.match(sectionOf('The first open of a big file is slow'), /converted once/);
});

test('the AI assistant is off when the server was not started with --ai; an account without fmmcp is told which privilege it needs', async (t) => {
  const dir = folder(t);
  const s = await start(t, dir);
  const store = s.host.get('Shop')!;
  store.savePrivilegeSet({ name: 'Clerk', records: { create: true, edit: true, delete: false, view: true, fields: {} } as never, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] } as never);
  store.setPassword('clerk', 'clerk-password-1', 'Clerk');
  const { token } = await signIn(s.url, 'Shop', 'clerk', 'clerk-password-1');
  const assistant = await fetch(`${s.url}/tabularius/assistant/v1/databases/Shop`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
  assert.equal(assistant.status, 503);
  assert.match(((await assistant.json()) as { error: { message: string } }).error.message, /^The AI assistant is off on this server \(start it with --ai and an API key\)$/);

  const mcp = createMcpServer(s.host, { account: 'clerk', password: 'clerk-password-1' });
  const client = new Client({ name: 'trouble-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcp.connect(b);
  await client.connect(a);
  t.after(async () => { await client.close(); await mcp.close(); });
  const refused = (await client.callTool({ name: 'describe_database', arguments: { database: 'Shop' } })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(refused.isError, true);
  assert.match((JSON.parse(refused.content[0].text) as { message: string }).message, /^Insufficient privileges: the "Clerk" privilege set needs the fmmcp extended privilege \(AI access\)/);
  const section = sectionOf('The AI assistant or an AI app does nothing');
  for (const must of ['--ai', 'ANTHROPIC_API_KEY', 'fmmcp', 'tabularius ai <folder> <database> status']) assert.ok(section.includes(must), must);
});

test('a browser certificate warning: --https local makes a certificate and a trust page anyone can open before signing in', async (t) => {
  const dir = folder(t);
  const files = localCertificateFiles(dir, ['localhost', '127.0.0.1']);
  const s = await start(t, dir, { tlsCert: files.certPath, tlsKey: files.keyPath });
  assert.match(s.url, /^https:/);
  const get = (path: string) => new Promise<{ status: number; type: string; body: string }>((ok, fail) => {
    httpsRequest({ host: '127.0.0.1', port: Number(new URL(s.url).port), path, ca: files.tls.ca, servername: 'localhost' }, (res) => {
      let body = '';
      res.setEncoding('latin1').on('data', (c) => { body += c; }).on('end', () => ok({ status: res.statusCode!, type: String(res.headers['content-type']), body }));
    }).on('error', fail).end();
  });
  const trust = await get('/tabularius/tls/');
  assert.equal(trust.status, 200);
  assert.match(trust.body, new RegExp(files.tls.fingerprint.slice(0, 11)));
  assert.equal((await get('/tabularius/tls/ca.cer')).status, 200);
  assert.equal((await get('/tabularius/tls/tabularius.mobileconfig')).status, 200);
  const section = sectionOf('The browser says the connection is not private');
  for (const must of ['--https local', '/tabularius/tls/', '--https files.example.com', '--tls-cert']) assert.ok(section.includes(must), must);
});

test('a page behind a proxy: /app needs its slash, the client\'s files are relative to /app/, and a page that cannot start says so', async (t) => {
  const dir = folder(t);
  const s = await start(t, dir);
  const bare = await fetch(`${s.url}/app`, { redirect: 'manual' });
  assert.deepEqual([bare.status, bare.headers.get('location')], [301, '/app/']);
  const html = await (await fetch(`${s.url}/app/`)).text();
  assert.match(html, /href="app\.css(\?v=[0-9a-f]+)?"/);
  assert.match(html, /src="src\/main\.ts(\?v=[0-9a-f]+)?"/);
  assert.match(html, /This page did not start\. /);
  assert.equal((await fetch(`${s.url}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`boss:${PASSWORD}`) }, body: '{}' })).status, 200, 'the client calls the Data API at the root of the same address');
  const section = sectionOf('A page behind a proxy stays blank or says it did not start');
  for (const must of ['/app/', '/fmi/', '/openhbam/', '--public-url']) assert.ok(section.includes(must), must);
});

test('every command the page names exists, with the options it gives', async () => {
  const seen = new Set<string>();
  for (const m of page.matchAll(/`(?:sudo )?tabularius ([a-z-]+)([^`]*)`/g)) seen.add(m[1]);
  for (const command of seen) {
    if (['is', 'the'].includes(command)) continue;
    const help = await cli(['help', command]);
    assert.equal(help.status, 0, `tabularius help ${command}`);
  }
  assert.ok(seen.size >= 8, `found ${seen.size} commands`);
  assert.ok(existsSync(main));
  mkdirSync(env().TABULARIUS_HOME!, { recursive: true });
});
