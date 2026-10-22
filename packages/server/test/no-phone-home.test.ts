// Tabularius does not phone home. With nothing turned on it makes no connection to anything but this computer: not at
// start-up, not while idle, not while the web client, the admin console, the Data API and a conversion are used. A
// child process run under outbound-recorder.ts records (and refuses) every attempt to reach another address, and
// the test asserts the record is empty. The same recorder sees a call when one is asked for, so the empty record
// means something. docs/privacy.md says what leaves, when, for each thing that can be turned on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyStarter, createStore, Store } from '../../store/src/index.ts';
import { serve, MCP_LOCAL_TOKEN_FILE } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const recorder = join(import.meta.dirname, 'outbound-recorder.ts');
const fixture = join(root, 'fixtures', 'fmp12', 'Charts.fmp12');

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Attempt { kind: 'tcp' | 'dns' | 'udp'; host: string; port?: number }

interface Run {
  child: ChildProcess;
  output(): string;
  /** What the process tried to reach that is not this computer. */
  attempts(): Attempt[];
  /** True once the recorder was loaded in the process (so an empty list is not just a hook that never ran). */
  hooked(): boolean;
  stop(): Promise<void>;
}

/** Runs the command line under the recorder, with nothing from this machine's environment that could change a default. */
function run(args: string[], home: string, extraEnv: NodeJS.ProcessEnv = {}, ready: RegExp | null = /Web client: /): Promise<Run> {
  const record = join(home, 'outbound.jsonl');
  writeFileSync(record, '');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '--import', recorder, main, ...args], {
      env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, TABULARIUS_OUTBOUND_LOG: record, NODE_OPTIONS: `--import ${recorder}`, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    let settled = false;
    const lines = () => readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const handle: Run = {
      child,
      output: () => text,
      attempts: () => lines().filter((l) => l.kind).map((l) => ({ kind: l.kind as Attempt['kind'], host: String(l.host), ...(l.port !== undefined ? { port: Number(l.port) } : {}) })),
      hooked: () => lines().some((l) => l.hook === 'loaded'),
      stop: () => new Promise<void>((end) => { live.delete(handle); if (child.exitCode !== null || child.signalCode) return end(); child.once('close', () => end()); child.kill('SIGTERM'); }),
    };
    live.add(handle);
    const take = (chunk: string) => {
      text += chunk;
      if (!settled && ready?.test(text)) { settled = true; resolve(handle); }
    };
    child.stdout.setEncoding('utf8').on('data', take);
    child.stderr.setEncoding('utf8').on('data', take);
    child.once('error', reject);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (ready) reject(new Error(`stopped (${code}) before it was ready:\n${text}`)); else resolve(handle);
    });
    setTimeout(() => { if (!settled) { settled = true; child.kill('SIGKILL'); reject(new Error(`not ready after 30 s:\n${text}`)); } }, 30_000).unref();
  });
}

/** An HTTP request to the server on this computer (fetch is left for the browser tests; this one can name a Host). */
const get = (port: number, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<{ status: number; text: string }>((resolve, reject) => {
  const req = httpRequest({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
  });
  req.once('error', reject);
  req.end(init.body);
});

/** Every process `run` started, so a scratch folder is never removed while one of them can still write into it. */
const live = new Set<Run>();

function scratch(): { home: string; dir: string; done(): Promise<void> } {
  const home = mkdtempSync(join(tmpdir(), 'tabularius-phone-home-'));
  const dir = join(home, 'files');
  // `t.after` hooks run in the order they were added, and `done` is added first: stop the processes before the folder goes.
  return { home, dir, done: async () => { await Promise.all([...live].map((r) => r.stop())); rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } };
}

/** A hosted folder: one native file with the Tasks starter, sample records and an Admin account, and the Charts file to convert. */
function hostedFolder(dir: string): { password: string; converting: boolean } {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'Tasks.openhbam.sqlite');
  createStore(file);
  const store = new Store(file, 'Tasks');
  try {
    applyStarter(store, 'tasks', { sample: true });
    store.setPassword('Admin', PASSWORD, '[Full Access]');
  } finally {
    store.close();
  }
  const converting = existsSync(fixture);
  if (converting) copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  return { password: PASSWORD, converting };
}

const PASSWORD = 'Phone home correct password 1';

test('the recorder sees what the program is asked to reach, and refuses it', async (t) => {
  const { home, done } = scratch();
  t.after(done);
  const script = join(home, 'reach.mjs');
  writeFileSync(script, `
    import http from 'node:http';
    import dgram from 'node:dgram';
    const local = http.createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1');
    await new Promise((r) => local.once('listening', r));
    const answer = await fetch('http://127.0.0.1:' + local.address().port + '/').then((r) => r.text(), (e) => 'failed ' + e.message);
    const outside = await fetch('http://203.0.113.7:8080/').then(() => 'answered', (e) => 'refused');
    const named = await fetch('https://telemetry.example.test/ping').then(() => 'answered', () => 'refused');
    dgram.createSocket('udp4').send('x', 9, '203.0.113.9', () => {});
    console.log(JSON.stringify({ answer, outside, named }));
    local.close();
  `);
  const record = join(home, 'outbound.jsonl');
  writeFileSync(record, '');
  const child = spawn(process.execPath, ['--no-warnings', '--import', recorder, script], { env: { PATH: process.env.PATH, TABULARIUS_OUTBOUND_LOG: record }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  await new Promise((r) => child.once('close', r));
  const said = JSON.parse(out.trim().split('\n').at(-1)!) as Record<string, string>;
  assert.equal(said.answer, 'ok', 'this computer is reachable');
  assert.equal(said.outside, 'refused');
  assert.equal(said.named, 'refused');
  const seen = readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.kind);
  assert.ok(seen.some((a) => a.kind === 'tcp' && a.host === '203.0.113.7'), JSON.stringify(seen));
  assert.ok(seen.some((a) => a.host === 'telemetry.example.test'), JSON.stringify(seen));
  assert.ok(seen.some((a) => a.kind === 'udp' && a.host === '203.0.113.9'), JSON.stringify(seen));
  assert.ok(!seen.some((a) => a.host === '127.0.0.1'), 'this computer is not an attempt');
});

const basic = (account: string, password: string) => 'Basic ' + btoa(`${account}:${password}`);

/** Everything a person or a program does on an ordinary day: both web pages, the docs, the Data API, OData and the AI connector. */
async function useIt(port: number, password: string, dir: string): Promise<void> {
  for (const page of ['/app/', '/admin/', '/docs', '/docs/connect-ai', '/']) assert.ok((await get(port, page)).status < 500, page);
  const status = await get(port, '/tabularius/admin/v1/status');
  assert.equal(status.status, 200);
  const session = await get(port, '/fmi/data/vLatest/databases/Tasks/sessions', { method: 'POST', headers: { authorization: basic('Admin', password), 'content-type': 'application/json' }, body: '{}' });
  assert.equal(session.status, 200, session.text);
  const token = (JSON.parse(session.text) as { response: { token: string } }).response.token;
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const layouts = JSON.parse((await get(port, '/fmi/data/vLatest/databases/Tasks/layouts', { headers: auth })).text) as { response: { layouts: { name: string; folderLayoutNames?: unknown }[] } };
  const layout = encodeURIComponent(layouts.response.layouts.find((l) => !l.folderLayoutNames)!.name);
  assert.equal((await get(port, `/fmi/data/vLatest/databases/Tasks/layouts/${layout}/records?_limit=5`, { headers: auth })).status, 200);
  assert.ok((await get(port, '/fmi/odata/v4/Tasks/$metadata', { headers: { authorization: basic('Admin', password) } })).status < 500);
  const initialize = await get(port, '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${readFileSync(join(dir, MCP_LOCAL_TOKEN_FILE), 'utf8').trim()}` }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' });
  assert.equal(initialize.status, 200, initialize.text);
  await get(port, '/fmi/data/vLatest/databases/Tasks/sessions/' + token, { method: 'DELETE', headers: auth });
}

async function waitFor(what: string, ready: () => Promise<boolean>, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await ready()) return; await sleep(200); }
  throw new Error(`gave up waiting for ${what}`);
}

test('a server started with no flags makes no outbound connection: start, a conversion, normal use and idle', async (t) => {
  const { home, dir, done } = scratch();
  const { password, converting } = hostedFolder(dir);
  const port = await freePort();
  const server = await run(['serve', dir], home, { PORT: String(port) });
  t.after(() => server.stop());
  t.after(done);
  const hosted = converting ? 2 : 1;
  await waitFor('the files to be hosted', async () => (JSON.parse((await get(port, '/tabularius/admin/v1/status')).text) as { databases: unknown[] }).databases.length >= hosted);
  await useIt(port, password, dir);
  await sleep(4000); // idle: timers, the damage check, the backup schedule, anything on a clock
  assert.ok(server.hooked(), 'the recorder was loaded in the server');
  assert.deepEqual(server.attempts(), [], 'it tried to reach something other than this computer');
  assert.doesNotMatch(server.output(), /AI assistant on|backups copied off-site|HTTPS with/);
  await server.stop();
  assert.deepEqual(server.attempts(), [], 'it tried to reach something while stopping');
});

/** Runs a command to its end under the recorder and returns what it said and what it tried to reach. */
async function command(args: string[], home: string): Promise<{ output: string; attempts: Attempt[]; hooked: boolean }> {
  const r = await run(args, home, {}, null);
  await new Promise<void>((end) => { if (r.child.exitCode !== null) end(); else r.child.once('close', () => end()); });
  return { output: r.output(), attempts: r.attempts(), hooked: r.hooked() };
}

test('a backup, its check and a restore stay on this computer', async (t) => {
  const { home, dir, done } = scratch();
  t.after(done);
  hostedFolder(dir);
  const made = await command(['backup', dir], home);
  assert.match(made.output, /backed up \d+ files/, made.output);
  const set = readdirSync(join(dir, 'Backups'))[0];
  const checked = await command(['verify-backup', dir, set], home);
  const restored = await command(['restore', dir, set, 'Tasks'], home);
  for (const [name, r] of Object.entries({ backup: made, 'verify-backup': checked, restore: restored })) {
    assert.ok(r.hooked, `${name}: the recorder was loaded`);
    assert.deepEqual(r.attempts, [], `tabularius ${name}`);
  }
});

test('the command line asks nothing of the network when it checks a folder or says its version', async (t) => {
  const { home, dir, done } = scratch();
  t.after(done);
  hostedFolder(dir);
  for (const args of [['version'], ['doctor', dir]]) {
    const r = await command(args, home);
    assert.ok(r.hooked, `${args[0]}: the recorder was loaded`);
    assert.deepEqual(r.attempts, [], `tabularius ${args.join(' ')}`);
  }
});

test('tabularius demo makes no outbound connection', { skip: existsSync(join(root, 'packages', 'cli', 'src', 'demo.ts')) ? false : 'no demo command in this version' }, async (t) => {
  const { home, done } = scratch();
  const demo = await run(['demo', '--no-open'], home, {}, /http:\/\/127\.0\.0\.1:\d+/);
  t.after(() => demo.stop());
  t.after(done);
  const port = Number(/127\.0\.0\.1:(\d+)/.exec(demo.output())![1]);
  for (const page of ['/app/', '/admin/']) assert.equal((await get(port, page)).status, 200);
  await sleep(3000);
  assert.ok(demo.hooked());
  assert.deepEqual(demo.attempts(), []);
});

test('what is asked for is what is attempted: the AI assistant reaches its provider only with --ai and a key', async (t) => {
  const { home, dir, done } = scratch();
  const { password } = hostedFolder(dir);
  const port = await freePort();
  const server = await run(['serve', dir, '--ai'], home, { PORT: String(port), ANTHROPIC_API_KEY: 'sk' + '-ant-not-a-real-key' });
  t.after(() => server.stop());
  t.after(done);
  // The banner line follows the address line that `run` waits for.
  await waitFor('the AI banner', async () => /AI assistant on/.test(server.output()), 15_000);
  await get(port, '/tabularius/admin/v1/status');
  void password;
  await waitFor('the provider check', async () => server.attempts().length > 0, 15_000);
  assert.ok(server.attempts().every((a) => /anthropic\.com$/.test(a.host)), JSON.stringify(server.attempts()));
});

// ---- What is served ------------------------------------------------------------------------------------------------

/** Absolute http(s) and protocol-relative addresses that a served file may hold, and why. Anything else fails the scan. */
const NOT_A_REQUEST: Record<string, string> = {
  'http://www.w3.org/2000/svg': 'the SVG namespace: a name, never fetched',
  'https://fms.example.com': 'placeholder text in the FileMaker Server field of the migration form',
};

/** Tags whose address is loaded without anyone clicking: a script, style, picture, frame, media file or form target. */
const LOADS = /<(script|img|iframe|frame|embed|source|video|audio|track|object|link|base|form|meta)\b[^>]*>/gi;

function externalAddresses(text: string): string[] {
  const found: string[] = [];
  for (const [tag, name] of text.matchAll(LOADS)) {
    const attr = /\b(?:src|href|action|data|poster|srcset)\s*=\s*["']\s*((?:https?:)?\/\/[^"'\s]+)/i.exec(tag);
    if (attr) found.push(`${name}: ${attr[1]}`);
    const refresh = /http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*url=\s*((?:https?:)?\/\/[^"'\s]+)/i.exec(tag);
    if (refresh) found.push(`meta refresh: ${refresh[1]}`);
  }
  for (const m of text.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^)"'\s]+)/gi)) found.push(`css url(): ${m[1]}`);
  for (const m of text.matchAll(/@import\s+(?:url\(\s*)?["']?((?:https?:)?\/\/[^)"'\s;]+)/gi)) found.push(`css @import: ${m[1]}`);
  return found;
}

test('nothing the server serves loads a font, script, style, picture or frame from another address', async (t) => {
  const { home, dir, done } = scratch();
  hostedFolder(dir);
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  t.after(() => new Promise<void>((end) => { s.server.closeAllConnections?.(); s.server.close(() => end()); }));
  t.after(done);
  const base = new URL(s.url);
  const seen = new Set<string>();
  const queue = ['/', '/app/', '/admin/', '/docs', '/tabularius/tls/'];
  const loads: string[] = [];
  const addresses: string[] = [];
  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const res = await fetch(s.url + path);
    const type = res.headers.get('content-type') ?? '';
    if (res.status !== 200 || !/text|javascript|json|svg|css|html|xml/.test(type)) { await res.arrayBuffer(); continue; }
    const text = await res.text();
    const isHtml = /html/.test(type);
    for (const found of externalAddresses(text)) loads.push(`${path}  ${found}`);
    // Pages (HTML) may name other sites in links a person clicks and in text; everything else (scripts, styles, manifests,
    // pictures) may not name another address at all unless it is listed above as not a request.
    if (!isHtml) for (const m of text.matchAll(/(?:https?:)?\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s"'`<>)\\]*/g)) if (!/^\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(m[0]) || /^https?:/.test(m[0])) addresses.push(`${path}  ${m[0]}`);
    // Same-origin files this one points at.
    const refs = [
      ...[...text.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#]+)["']/g)].map((m) => m[1]),
      ...[...text.matchAll(/\b(?:from|import)\s*\(?\s*["'](\.{0,2}\/[^"']+)["']/g)].map((m) => m[1]),
      ...[...text.matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]),
      ...[...text.matchAll(/@import\s+["']([^"']+)/g)].map((m) => m[1]),
    ];
    for (const ref of refs) {
      if (/^(data:|mailto:|javascript:|blob:|tel:)/.test(ref)) continue;
      try {
        const u = new URL(ref, new URL(s.url + path));
        if (u.origin === base.origin && !seen.has(u.pathname)) queue.push(u.pathname);
      } catch { /* not an address */ }
    }
  }
  assert.ok(seen.size > 100, `the scan reached ${seen.size} files, which should be the pages, the docs, the web client and the console`);
  assert.ok([...seen].some((p) => p.startsWith('/app/src/')), 'the web client modules were reached');
  assert.deepEqual(loads, [], 'a served page loads something from another address');
  const unexplained = addresses.filter((a) => !Object.keys(NOT_A_REQUEST).some((ok) => a.endsWith('  ' + ok)));
  assert.deepEqual(unexplained, [], 'a served script, style or data file names another address; list it in NOT_A_REQUEST with the reason, or remove it');
});

// ---- What the source can reach -------------------------------------------------------------------------------------

/** Hosts the program can connect to. Each must be in docs/privacy.md, with what is sent and when. */
const DESTINATIONS = [
  'api.anthropic.com', 'acme-v02.api.letsencrypt.org', 'acme-staging-v02.api.letsencrypt.org', 'api.voyageai.com', 'api.jina.ai',
  'www.googleapis.com', 'oauth2.googleapis.com', 'api.dropboxapi.com', 'content.dropboxapi.com', 'graph.microsoft.com', 'login.microsoftonline.com',
];

/** Hosts that appear in the source and are never connected to. */
const NAMES_ONLY: Record<string, string> = {
  'docs.oasis-open.org': 'OData XML namespace',
  'schemas.microsoft.com': 'Windows service file namespace',
  'schemas.openxmlformats.org': 'spreadsheet file namespace',
  'www.apple.com': 'property-list DTD and profile identifiers',
  'www.filemaker.com': 'FileMaker XML namespaces',
  'www.w3.org': 'XML and SVG namespaces',
  'github.com': 'a documentation link in a SCIM answer, and the vendor-url an XSLT stylesheet may ask for as text',
  'nodejs.org': 'part of a message telling a person where to download Node',
  'localhost': 'this computer',
  'api.example.com': 'example text in a connection form', 'auth.example.com': 'example text in a connection form',
  'files.example.com': 'example text in a message', 'fms.example.com': 'example text in a message', 'maps.example.com': 'example text in the layout editor',
  'your.address': 'example text in a message',
};

test('every address the source names is either a destination privacy.md explains or a name that is never connected to', () => {
  const comments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[\s;{(,])\/\/.*$/gm, '$1');
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(full);
    return /\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [full] : [];
  });
  const hosts = new Map<string, string>();
  for (const pkg of readdirSync(join(root, 'packages'))) {
    const src = join(root, 'packages', pkg, 'src');
    if (!existsSync(src)) continue;
    for (const file of files(src)) {
      for (const m of comments(readFileSync(file, 'utf8')).matchAll(/https?:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}|localhost)\b/g)) hosts.set(m[1].toLowerCase(), file.slice(root.length + 1));
    }
  }
  const privacy = readFileSync(join(root, 'docs', 'privacy.md'), 'utf8');
  const unknown = [...hosts].filter(([h]) => !DESTINATIONS.includes(h) && !(h in NAMES_ONLY)).map(([h, f]) => `${h} (${f})`);
  assert.deepEqual(unknown, [], 'a new address in the source: a place it connects to goes in DESTINATIONS and docs/privacy.md; a name that is never connected to goes in NAMES_ONLY');
  const unexplained = DESTINATIONS.filter((h) => hosts.has(h) && !privacy.includes(h));
  assert.deepEqual(unexplained, [], 'docs/privacy.md does not mention it');
  const gone = DESTINATIONS.filter((h) => !hosts.has(h));
  assert.deepEqual(gone, [], 'no longer in the source: remove it from DESTINATIONS and docs/privacy.md');
});

test('every flag and command docs/privacy.md names exists', () => {
  const mainSource = readFileSync(main, 'utf8');
  const privacy = readFileSync(join(root, 'docs', 'privacy.md'), 'utf8');
  const missing: string[] = [];
  for (const flag of new Set(privacy.match(/(?<![\w-])--[a-z][a-z0-9-]+/g))) if (!mainSource.includes(`'${flag}'`)) missing.push(flag);
  for (const command of ['migrate-fms', 'sync-plan', 'sync-apply', 'standby', 'upgrade', 'backup', 'verify-backup', 'restore', 'doctor', 'version', 'demo']) {
    if (!mainSource.includes(`case '${command}'`) && !mainSource.includes(`cmd === '${command}'`) && !mainSource.includes(`'${command}'`)) missing.push('tabularius ' + command);
  }
  assert.deepEqual(missing, [], 'named on the page but not in the program');
});
