// A server started the way a new user starts it (`tabularius serve <folder>`, no flags) is held to every row of the
// secure-by-default table. The table also makes docs/security-defaults.md, so a changed default fails here until the
// row, and so the page, says the new thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyStarter, createStore, Store } from '../../store/src/index.ts';
import { securityDefaultsPage } from '../../../scripts/security-defaults.ts';
import { ROWS, type Ctx } from './security-defaults-table.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const mainFile = join(root, 'packages', 'cli', 'src', 'main.ts');

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
});

/** Nothing from the machine that would change a default: no key, no mail, no certificate, no settings of ours. */
// A key in the environment is on purpose: it must not switch the assistant on without --ai.
const cleanEnv = (home: string): NodeJS.ProcessEnv => ({ PATH: process.env.PATH, HOME: home, TMPDIR: home, ANTHROPIC_API_KEY: 'sk' + '-ant-not-a-real-key' });

interface Running { child: ChildProcess; output: () => string; stop(): Promise<void> }

function run(args: string[], home: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<Running> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', mainFile, ...args], { env: { ...cleanEnv(home), ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    const take = (chunk: string) => { text += chunk; if (/Web client: /.test(text)) done(); };
    const done = () => resolve({
      child, output: () => text,
      stop: () => new Promise<void>((end) => { if (child.exitCode !== null || child.signalCode) return end(); child.once('close', () => end()); child.kill('SIGTERM'); }),
    });
    child.stdout.setEncoding('utf8').on('data', take);
    child.stderr.setEncoding('utf8').on('data', take);
    child.once('error', reject);
    child.once('close', (code) => reject(new Error(`the server stopped (${code}) before it was serving:\n${text}`)));
    setTimeout(() => reject(new Error(`the server was not serving after 30 s:\n${text}`)), 30_000).unref();
  });
}

/** A server expected to refuse to start: what it printed before it stopped (the test fails if it came up). */
function runRefused(args: string[], home: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', mainFile, ...args], { env: cleanEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    const take = (chunk: string) => { text += chunk; if (/Web client: /.test(text)) { child.kill('SIGTERM'); reject(new Error(`the server started when it should have refused:\n${text}`)); } };
    child.stdout.setEncoding('utf8').on('data', take);
    child.stderr.setEncoding('utf8').on('data', take);
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? reject(new Error(`the server exited cleanly instead of refusing:\n${text}`)) : resolve(text)));
    setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`no answer after 30 s:\n${text}`)); }, 30_000).unref();
  });
}

test('every row of the table holds on a server started with no flags', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'tabularius-defaults-home-'));
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-defaults-'));
  const file = join(dir, 'Shop.openhbam.sqlite');
  createStore(file);
  const store = new Store(file, 'Shop');
  applyStarter(store, 'tasks', { sample: false });
  store.setPassword('Admin', 'Admin correct password 1', '[Full Access]');
  store.setPassword('Locky', 'Locky correct password 1', '[Full Access]');
  store.close();

  const port = await freePort();
  const server = await run(['serve', dir], home, { PORT: String(port) });
  const extras: Running[] = [];
  const folders: string[] = [home, dir];
  t.after(async () => {
    for (const e of extras) await e.stop();
    await server.stop();
    for (const f of folders) rmSync(f, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;

  // node:http, not fetch: a request here has to be able to name another Host.
  const request: Ctx['request'] = (path, init = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        resolve({ status: res.statusCode ?? 0, headers, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.once('error', reject);
    req.end(init.body);
  });
  const ctx: Ctx = {
    base, dir, port,
    log: () => server.output(),
    request,
    async token() {
      const r = await request('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:Admin correct password 1'), 'content-type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 200, r.text);
      return (JSON.parse(r.text) as { response: { token: string } }).response.token;
    },
    async status() {
      const r = await request('/tabularius/admin/v1/status');
      assert.equal(r.status, 200, r.text);
      return JSON.parse(r.text);
    },
    async other(args) {
      const folder = mkdtempSync(join(tmpdir(), 'tabularius-defaults-other-'));
      folders.push(folder);
      const p = await freePort();
      const e = await run(['serve', folder, '--port', String(p), ...args], home);
      extras.push(e);
      const out = e.output();
      await e.stop();
      return out;
    },
    async refused(args) {
      const folder = mkdtempSync(join(tmpdir(), 'tabularius-defaults-refused-'));
      folders.push(folder);
      return runRefused(['serve', folder, '--port', String(await freePort()), ...args], home);
    },
    source: (path) => readFileSync(join(root, path), 'utf8'),
    passwordPolicy() {
      const s = new Store(file, 'Shop');
      try { return JSON.stringify(s.passwordPolicy()); } finally { s.close(); }
    },
    apiTokenShape() {
      const s = new Store(file, 'Shop');
      try {
        s.createApiToken('Admin', { label: 'defaults test' });
        const made = s.apiTokens().find((x) => x.label === 'defaults test')!;
        return !made.expires && !made.readOnly ? 'no expiry, read-write' : `expires ${made.expires}, readOnly ${made.readOnly}`;
      } finally { s.close(); }
    },
    newStoreSetting(key) {
      const f = join(mkdtempSync(join(tmpdir(), 'tabularius-defaults-new-')), 'New.openhbam.sqlite');
      folders.push(join(f, '..'));
      createStore(f);
      const s = new Store(f, 'New');
      try { return String(s[key]); } finally { s.close(); }
    },
    scriptPluginInstall() {
      const f = join(dir, '.openhbam-settings.json');
      return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { scriptPluginInstall?: boolean }).scriptPluginInstall === true : false;
    },
    auditShape() {
      const s = new Store(file, 'Shop');
      try {
        const a = s.auditSettings();
        return !a.logReads && a.retentionDays === 0 ? 'writes logged, reads not, kept forever' : JSON.stringify(a);
      } finally { s.close(); }
    },
    fileHeader(name) {
      const fd = openSync(join(dir, name), 'r');
      try { const b = Buffer.alloc(16); readSync(fd, b, 0, 16, 0); return b.toString('latin1'); } finally { closeSync(fd); }
    },
  };

  // The lockout row spends the Locky account and must come last of those that sign in.
  const ordered = [...ROWS.filter((r) => r.id !== 'lockout'), ...ROWS.filter((r) => r.id === 'lockout')];
  const failures: string[] = [];
  for (const row of ordered) {
    let seen: string | undefined;
    try { seen = await row.observe(ctx); } catch (e) { seen = `threw: ${(e as Error).message}`; }
    // Which addresses a process listens on is read from Linux's /proc; elsewhere that one row cannot be observed.
    if (seen === undefined && row.id === 'listen' && process.platform !== 'linux') continue;
    if (seen === undefined) { failures.push(`${row.id}: could not be observed on this system`); continue; }
    if (seen !== row.expect) failures.push(`${row.id}: the page says "${row.expect}" but the server shows "${seen}"`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  assert.ok(!readdirSync(dir).some((n) => /\.pem$/.test(n)), 'no certificate was made');
});

test('the rows are well formed and each id is used once', () => {
  assert.equal(new Set(ROWS.map((r) => r.id)).size, ROWS.length);
  for (const r of ROWS) {
    for (const k of ['setting', 'default', 'changedBy', 'risk', 'expect'] as const) assert.ok(r[k].trim(), `${r.id} has no ${k}`);
  }
});

test('every flag, setting and command the table names exists', () => {
  const read = (rel: string) => readdirSync(join(root, rel)).filter((n) => n.endsWith('.ts')).map((n) => readFileSync(join(root, rel, n), 'utf8')).join('\n');
  const code = ['packages/cli/src', 'packages/server/src', 'packages/store/src'].map(read).join('\n');
  const main = readFileSync(mainFile, 'utf8');
  const text = ROWS.map((r) => `${r.setting} ${r.default} ${r.changedBy} ${r.risk}`).join('\n');
  const missing: string[] = [];
  for (const flag of new Set(text.match(/--[a-z][a-z0-9-]+/g))) if (!main.includes(`'${flag}'`)) missing.push(flag);
  for (const env of new Set(text.match(/\bTABULARIUS_[A-Z_]+/g))) if (!code.includes(env)) missing.push(env);
  for (const [, command] of text.matchAll(/`tabularius ([a-z][a-z-]+)/g)) if (!main.includes(`case '${command}'`) && !main.includes(`cmd === '${command}'`)) missing.push('tabularius ' + command);
  assert.deepEqual(missing, [], 'named in the table but not in the program');
});

test('docs/security-defaults.md is what the table says', () => {
  assert.equal(readFileSync(join(root, 'docs', 'security-defaults.md'), 'utf8'), securityDefaultsPage(), 'run npm run docs:security-defaults');
});

test('serving beyond this computer over plain HTTP is refused; the safe ways start', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'tabularius-defaults-warn-'));
  const folders = [home];
  t.after(() => { for (const f of folders) rmSync(f, { recursive: true, force: true }); });
  const attempt = async (args: string[]) => {
    const folder = mkdtempSync(join(tmpdir(), 'tabularius-defaults-warn-dir-'));
    folders.push(folder);
    const e = await run(['serve', folder, '--port', String(await freePort()), ...args], home);
    const out = e.output();
    await e.stop();
    return out;
  };
  const refusal = /would listen on [^\s]+ over plain HTTP/;
  const warning = /Warning: this server listens on [^\s]+ over plain HTTP/;
  const refused = async (args: string[]) => {
    const folder = mkdtempSync(join(tmpdir(), 'tabularius-defaults-warn-dir-'));
    folders.push(folder);
    return runRefused(['serve', folder, '--port', String(await freePort()), ...args], home);
  };
  assert.match(await refused(['--host', '0.0.0.0']), refusal);
  assert.match(await refused(['--host', '192.168.1.20']), refusal);
  assert.match(await refused(['--host', '0.0.0.0', '--public-url', 'https://files.example.com']), refusal, 'naming a proxy does not make plain HTTP on every address safe');
  assert.match(await refused(['--host', '0.0.0.0', '--public-url', 'http://files.example.com']), refusal);
  assert.doesNotMatch(await attempt([]), refusal);
  assert.doesNotMatch(await attempt(['--host', '127.0.0.1']), refusal);
  assert.doesNotMatch(await attempt(['--host', 'localhost']), refusal);
  assert.match(await attempt(['--host', '0.0.0.0', '--allow-plain-http']), warning, 'allowed on purpose, and still said in the log');
  assert.doesNotMatch(await attempt(['--host', '0.0.0.0', '--allow-plain-http', '--public-url', 'https://files.example.com']), warning, 'a proxy that does HTTPS, named');
  assert.doesNotMatch(await attempt(['--host', '0.0.0.0', '--https', 'local']), warning);
});
