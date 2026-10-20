// QUICKSTART.md, step by step, against the real command: `tabularius` on its
// own hosts a folder and opens the admin console's welcome; a file dropped
// on the page is converted and hosted; an account from the file signs in
// from this computer without a password; a file copied into the folder
// appears by itself; `tabularius passwd` gives an account a password while the
// server runs; `tabularius report` says what doesn't work yet. If one of these
// stops working, the guide is wrong, so change both together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const charts = join(fixtures, 'Charts.fmp12');
const flicks = join(fixtures, 'Flicks.fmp12');
const skip = !existsSync(charts) || !existsSync(flicks) ? 'fixtures missing: run npm run fixtures'
  // The browser is opened with open / xdg-open, which a stand-in on PATH replaces; Windows uses cmd's start.
  : process.platform === 'win32' ? 'opens the browser with cmd /c start' : false;
const main = join(import.meta.dirname, '..', 'src', 'main.ts');

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
async function until<T>(what: string, check: () => T | undefined | Promise<T | undefined>, ms = 60_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) {
    const v = await check();
    if (v !== undefined && v !== false) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
}

function cli(env: NodeJS.ProcessEnv, ...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, ['--no-warnings', main, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => ok({ code: code ?? -1, out }));
  });
}

test('the quick start works as written', { skip, timeout: 240_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-quickstart-'));
  const home = join(root, 'home');
  const folder = join(home, 'tabularius');
  const bin = join(root, 'bin');
  const opened = join(root, 'opened.txt');
  mkdirSync(home);
  mkdirSync(bin);
  // Stand-ins for the system's "open this in the browser": they write down the address instead.
  for (const name of ['open', 'xdg-open']) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${opened}'\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    // Let the OS choose the port; the opened URL contains the one it bound.
    PORT: '0',
  };
  delete env.TABULARIUS_FOLDER;
  delete env.TABULARIUS_PASSWORD;

  // 2. Start it: `tabularius`, nothing else.
  const server = spawn(process.execPath, ['--no-warnings', main], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const exited = new Promise<number | null>((ok) => server.on('exit', (code) => ok(code)));
  try {
    // It hosts ~/tabularius (made for it) and opens the admin console's welcome.
    const page = await until('the browser to be opened', () => existsSync(opened) ? readFileSync(opened, 'utf8').trim() || undefined : undefined)
      .catch((e) => { throw new Error(`${(e as Error).message}\n${log}`); });
    assert.match(log, new RegExp(`hosting ${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} on this computer`));
    assert.ok(existsSync(folder), '~/tabularius is made');
    const m = /^(http:\/\/(?:127\.0\.0\.1|localhost):\d+)\/admin\/#welcome$/.exec(page);
    assert.ok(m, `opens the welcome page, not ${page}`);
    const base = m[1];
    const admin = await fetch(`${base}/admin/`);
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /id="welcome"/, 'the page has the drop zone');

    // 3. Drop in a FileMaker file: what the drop zone does, piece by piece, then converted and hosted.
    const up = (path: string, method: string, body?: Uint8Array | object) => fetch(`${base}/tabularius/admin/v1/uploads${path}`, {
      method,
      headers: { 'x-tabularius-admin': '1', ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: body instanceof Uint8Array ? (body as unknown as BodyInit) : JSON.stringify(body) } : {}),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const bytes = new Uint8Array(readFileSync(charts));
    const start = await up('', 'POST', { name: 'Charts.fmp12', size: bytes.length });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    const id = start.body.id as string;
    assert.equal((await up(`/${id}?offset=0`, 'PUT', bytes)).body.received, bytes.length);
    assert.equal((await up(`/${id}/finish`, 'POST')).status, 200);
    const done = await until('the upload to be converted', async () => {
      const r = await up(`/${id}`, 'GET');
      return r.body.phase === 'hosted' || r.body.phase === 'failed' ? r.body : undefined;
    });
    assert.equal(done.phase, 'hosted', done.error);
    assert.ok(existsSync(join(folder, 'Charts.fmp12')), 'kept in the folder');

    // The web client is there, and an account with no password signs in from this computer.
    assert.equal((await fetch(`${base}/app/`)).status, 200);
    const signIn = (account: string, password: string) => fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(`${account}:${password}`).toString('base64'), 'content-type': 'application/json', 'x-tabularius-client': 'web' },
      body: '{}',
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const blank = await signIn('Admin', '');
    assert.equal(blank.status, 200, JSON.stringify(blank.body));
    const token = blank.body.response.token as string;
    const layouts = await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(layouts.status, 200, 'the web client can list its layouts');

    // Copied into the folder while it runs: appears within a few seconds.
    copyFileSync(flicks, join(folder, 'Flicks.fmp12'));
    await until('the copied file to be hosted', async () => {
      // The server lists no file by default, so sign in to it. A non-404
      // response alone can still be a conversion or database error.
      const r = await fetch(`${base}/fmi/data/vLatest/databases/Flicks/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('Admin:').toString('base64'), 'content-type': 'application/json' }, body: '{}' });
      return r.status === 200 || undefined;
    });

    // `tabularius passwd ~/tabularius <file> <account>`, with the server running.
    const passwd = await cli({ ...env, TABULARIUS_PASSWORD: 'quick start 1' }, 'passwd', folder, 'Charts', 'Admin');
    assert.equal(passwd.code, 0, passwd.out);
    assert.match(passwd.out, /password set for Admin in Charts/);
    assert.equal((await signIn('Admin', 'quick start 1')).status, 200, 'the new password signs in');
    assert.notEqual((await signIn('Admin', '')).status, 200, 'no password no longer does');

    // `tabularius report ~/tabularius`: what in the files doesn't work yet.
    const report = await cli(env, 'report', folder);
    assert.equal(report.code, 0, report.out);
    assert.match(report.out, /Charts/);
    assert.match(report.out, /Flicks/);

    // Ctrl-C stops it.
    server.kill('SIGINT');
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<string>((ok) => (timer = setTimeout(() => ok('still running'), 30_000)));
    assert.equal(await Promise.race([exited, late]).finally(() => clearTimeout(timer)), 0, log);
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGKILL');
      await exited;
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
