// Cross-site requests against every documented route. A page on another site can make a browser send saved credentials
// (a cached Basic login, a cookie) with a form post or a no-cors fetch; the server must not act on such a request.
// The route list is the generated REST reference (docs/reference/rest.md), which a test already holds to the code, so a
// new route is covered the day it is documented.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let store: Store;
const basic = 'Basic ' + Buffer.from('Admin:pw').toString('base64');

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-cross-site-'));
  createStore(join(dir, 'P' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('P')!;
  store.applyDesign([{ op: 'createTable', name: 'Contacts', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  store.create('Contacts', { Id: 1, Name: 'a' });
  const full = store.privilegeSet('[Full Access]')!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest', 'fmodata', 'fmxdbc', 'fmmcp'])] });
  store.setPassword('Admin', 'pw', '[Full Access]');
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

interface Route { methods: string[]; path: string }
const doc = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'reference', 'rest.md'), 'utf8');
const routes: Route[] = [...doc.matchAll(/^\| ([A-Z, ]+) \| \[`([^`]+)`\]/gm)].map((m) => ({ methods: m[1].split(',').map((x) => x.trim()), path: m[2] }));
const fill = (p: string) => p.replace(/\{version\}/g, 'vLatest').replace(/\{database\}/g, 'P').replace(/\{[a-zA-Z]*[iI]d\}/g, '1').replace(/\{[^}]+\}/g, 'x');
const state = () => JSON.stringify([store.find('Contacts', {}), store.schema]);

/** What a browser attaches when a page on another site (or another port of this host) makes the request. */
const HOSTILE: Array<[string, Record<string, string>]> = [
  ['cross-site fetch metadata', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', origin: 'http://evil.example' }],
  ['same-site (another port or sub-domain)', { 'sec-fetch-site': 'same-site', origin: 'http://localhost:9999' }],
  ['an Origin header only (no fetch metadata)', { origin: 'http://evil.example' }],
  ['the null origin (a sandboxed frame, a redirect)', { origin: 'null' }],
  ['an Origin on the same host but another port', { origin: 'http://127.0.0.1:1' }],
];
const BODIES = ['text/plain', 'application/x-www-form-urlencoded'];

test('the route list read from the reference is complete enough to mean something', () => {
  assert.ok(routes.length > 300, `${routes.length} routes`);
  const changing = routes.flatMap((r) => r.methods.filter((m) => !['GET', 'HEAD', 'OPTIONS'].includes(m)).map((m) => `${m} ${r.path}`));
  assert.ok(changing.length > 250, `${changing.length} state-changing routes`);
});

test('every documented state-changing route refuses a request a browser says came from another site, with a saved Basic login', async () => {
  const before = state();
  const accepted: string[] = [];
  const differing: string[] = [];
  let sent = 0;
  let refused = 0;
  for (const r of routes) {
    for (const method of r.methods) {
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) continue;
      const path = fill(r.path);
      for (const [name, headers] of HOSTILE) {
        const res = await fetch(base + path, { method, headers: { authorization: basic, 'content-type': BODIES[sent++ % 2], ...headers }, body: '{}' });
        const text = await res.text();
        // What matters: the saved login changes nothing about the answer. The same hostile request without it gets the same status.
        const bare = await fetch(base + path, { method, headers: { 'content-type': BODIES[(sent - 1) % 2], ...headers }, body: '{}' });
        await bare.arrayBuffer();
        if (bare.status !== res.status) differing.push(`${method} ${path} (${name}): ${res.status} with the login, ${bare.status} without`);
        // Refused (403), or stopped earlier because the route does not take Basic or has no such record (401, 404): never run.
        if (![401, 403, 404].includes(res.status)) accepted.push(`${method} ${path} (${name}): ${res.status} ${text.slice(0, 80)}`);
        else if (res.status === 403) refused++;
      }
    }
  }
  assert.deepEqual(accepted, []);
  assert.deepEqual(differing, [], 'a saved login must not change the answer to a cross-site request');
  assert.ok(sent > 1000, `${sent} requests sent`);
  assert.ok(refused >= sent / 2, `${refused} of ${sent} refused with 403`);
  assert.equal(state(), before, 'no record or design change got through');
});

test('the same requests are not refused for being cross-site when no browser says so, or when it says same-origin', async () => {
  const own = new URL(base).origin;
  for (const [method, path, body] of [
    ['POST', '/fmi/odata/v4/P/Contacts', '{"Id":7,"Name":"mine"}'],
    ['POST', '/fmi/data/vLatest/databases/P/sessions', '{}'],
    ['POST', '/tabularius/admin/v1/sign-out', ''],
  ] as const) {
    for (const headers of [{}, { 'sec-fetch-site': 'same-origin', origin: own }, { 'sec-fetch-site': 'none' }, { origin: own }] as Record<string, string>[]) {
      const res = await fetch(base + path, { method, headers: { authorization: basic, 'content-type': 'application/json', ...(path.includes('admin') ? { 'x-tabularius-admin': '1' } : {}), ...headers }, body: body || undefined });
      assert.ok(res.status < 400 || res.status === 401, `${method} ${path} ${JSON.stringify(headers)}: ${res.status} ${await res.text()}`);
    }
  }
});

test('the OAuth registration route takes other sites\' requests on purpose, and still does', async () => {
  const res = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { origin: 'http://app.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: '{}' });
  assert.notEqual(res.status, 403, 'a browser app registers an OAuth client from its own origin');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('no route answers a hostile Origin with CORS permission, except the OAuth ones that are public on purpose', async () => {
  const permissive: string[] = [];
  let checked = 0;
  for (const r of routes) {
    if (!r.methods.includes('GET')) continue;
    const path = fill(r.path);
    for (const [method, extra] of [['GET', {}], ['OPTIONS', { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' }]] as const) {
      const res = await fetch(base + path, { method, headers: { authorization: basic, origin: 'http://evil.example', ...extra }, redirect: 'manual' });
      await res.arrayBuffer();
      checked++;
      const allow = res.headers.get('access-control-allow-origin');
      if ((allow !== null || res.headers.get('access-control-allow-credentials') !== null) && !path.startsWith('/oauth/') && !path.startsWith('/.well-known/')) permissive.push(`${method} ${path}: ${allow} ${res.headers.get('access-control-allow-credentials')}`);
    }
  }
  assert.deepEqual(permissive, []);
  assert.ok(checked > 300);
});

test('every HTML page the server serves refuses to be framed by another site', async () => {
  const unframed: string[] = [];
  const seen = new Set<string>();
  // The pages people open, and every documented GET that turns out to be HTML.
  const paths = ['/app/', '/docs', '/docs/', '/tabularius/admin/', '/tabularius/admin/sign-in', '/oauth/authorize?client_id=x&response_type=code', ...routes.filter((r) => r.methods.includes('GET')).map((r) => fill(r.path))];
  for (const path of paths) {
    const res = await fetch(base + path, { headers: { authorization: basic }, redirect: 'manual' });
    await res.arrayBuffer();
    if (!/text\/html/.test(res.headers.get('content-type') ?? '')) continue;
    seen.add(path);
    const csp = res.headers.get('content-security-policy') ?? '';
    if (!/frame-ancestors 'none'/.test(csp) && res.headers.get('x-frame-options')?.toUpperCase() !== 'DENY') unframed.push(`${path} (${res.status})`);
  }
  assert.deepEqual(unframed, []);
  assert.ok(seen.size >= 3, `pages seen: ${[...seen].join(', ')}`);
});

test('DNS rebinding: a page that points its own name at this computer is not this computer, for the passwordless admin console', async () => {
  const hit = (host: string) => new Promise<number>((resolve, reject) => {
    const u = new URL(base);
    const req = request({ host: u.hostname, port: u.port, path: '/tabularius/admin/v1/files', headers: { host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(await hit('evil.example:8080'), 403);
  assert.equal(await hit('evil.localhost.evil.example'), 403);
  assert.notEqual(await hit(`127.0.0.1:${new URL(base).port}`), 403);
});

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');

test('DNS rebinding: a converted file\'s empty-password account works from this computer by name, not for a page whose own name points here', { skip: existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures' }, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-rebind-'));
  copyFileSync(fixture, join(folder, 'Charts.fmp12'));
  const s = await serve({ dir: folder, port: 0, watch: false, log: () => {} });
  try {
    const blank = s.host.get('Charts')!.blankPasswordAccounts();
    assert.ok(blank.length > 0, 'the sample file has an account with the file\'s empty password');
    const u = new URL(s.url);
    const signIn = (host: string, extra: Record<string, string> = {}) => new Promise<number>((resolve, reject) => {
      const req = request({ host: u.hostname, port: u.port, method: 'POST', path: '/fmi/data/vLatest/databases/Charts/sessions', headers: { host, authorization: 'Basic ' + Buffer.from(`${blank[0]}:`).toString('base64'), 'content-type': 'application/json', ...extra } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(await signIn(`127.0.0.1:${u.port}`), 200, 'this computer, by its own address');
    assert.equal(await signIn(`localhost:${u.port}`), 200);
    // A rebound page is "same origin" to its browser: its Host and Origin are its own name, and the address is loopback.
    const rebound = { 'sec-fetch-site': 'same-origin', origin: 'http://evil.example' };
    assert.notEqual(await signIn('evil.example', rebound), 200, 'a page whose name points at 127.0.0.1');
    assert.notEqual(await signIn(`evil.example:${u.port}`, { ...rebound, origin: `http://evil.example:${u.port}` }), 200);
    // A rebound page can leave out every browser header and set Authorization itself, so a DNS name nobody configured is refused with or without them.
    assert.equal(await signIn('db.example.org'), 403, 'a headerless request for a name the server was not told');
    assert.equal(await signIn('db.example.org', { 'sec-fetch-dest': 'document' }), 403);
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});
