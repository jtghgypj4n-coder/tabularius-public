// What a person reads when a request goes wrong: a wrong password, a layout that isn't there, a body that isn't JSON, a file
// that isn't a FileMaker file. Every answer a running server gives to such a request is checked for the things a sentence
// shouldn't carry (a stack frame, a file path, a system error code, a SQL fragment), over the Data API, the admin console's
// calls and the file upload. scripts/error-strings-lib.ts holds the patterns and checks the messages in the source.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp } from '../../store/src/index.ts';
import { problems } from '../../../scripts/error-strings-lib.ts';

let dir: string;
let server: Server;
let base: string;
let token: string;
const logged: unknown[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-error-requests-'));
  createStore(join(dir, 'Shop' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Shop')!;
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'Age', type: 'number' }, { name: 'Photo', type: 'container' }] },
    { op: 'createScript', name: 'Echo', text: 'Exit Script [ Get ( ScriptParameter ) ]' },
  ] as DesignOp[]);
  store.create('Customers', { Name: 'Ann', Age: 30 });
  store.setPassword('Admin', 'pw', '[Full Access]');
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}' });
  token = ((await r.json()) as { response: { token: string } }).response.token;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** The sentences in an answer, whatever shape the endpoint uses for them. */
function sentences(body: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown, key = ''): void => {
    if (typeof v === 'string' && /^(error|message|text|reason|detail|why|problem)$/i.test(key)) out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  visit(body);
  return out;
}

const seen: { what: string; status: number; text: string }[] = [];
async function ask(what: string, path: string, init: { method?: string; body?: string; type?: string; headers?: Record<string, string> } = {}): Promise<void> {
  const r = await fetch(base + path, {
    method: init.method ?? 'GET',
    headers: { 'x-tabularius-admin': '1', ...(init.type === undefined ? { 'content-type': 'application/json' } : init.type ? { 'content-type': init.type } : {}), ...init.headers },
    body: ['GET', 'HEAD'].includes(init.method ?? 'GET') ? undefined : init.body,
  });
  const raw = await r.text();
  // An answer with no body is for a program; a browser asking for a page gets words (see the test for pages below).
  if (r.status < 400 || !raw.trim()) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = { error: raw.trim() }; }
  const texts = sentences(parsed);
  if (!texts.length && raw.trim()) texts.push(raw.trim());
  for (const text of texts) seen.push({ what, status: r.status, text });
}

const data = (p: string) => `/fmi/data/vLatest/databases/Shop${p}`;
const bearer = () => ({ authorization: `Bearer ${token}` });

test('Data API: requests that go wrong are answered in sentences', async () => {
  await ask('wrong password', data('/sessions'), { method: 'POST', body: '{}', headers: { authorization: 'Basic ' + btoa('Admin:nope') } });
  await ask('no account', data('/sessions'), { method: 'POST', body: '{}', headers: { authorization: 'Basic ' + btoa('Nobody:nope') } });
  await ask('no credentials', data('/sessions'), { method: 'POST', body: '{}' });
  await ask('credentials not in Basic form', data('/sessions'), { method: 'POST', body: '{}', headers: { authorization: 'Basic !!!' } });
  await ask('no such file', '/fmi/data/vLatest/databases/Nope/sessions', { method: 'POST', body: '{}', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  await ask('bad token', data('/layouts'), { headers: { authorization: 'Bearer nonsense' } });
  await ask('no token', data('/layouts'));
  await ask('no such layout', data('/layouts/Nope/records'), { headers: bearer() });
  await ask('no such record', data('/layouts/Customers/records/999'), { headers: bearer() });
  await ask('record id not a number', data('/layouts/Customers/records/abc'), { headers: bearer() });
  await ask('body not JSON', data('/layouts/Customers/records'), { method: 'POST', body: '{ half', headers: bearer() });
  await ask('body not an object', data('/layouts/Customers/records'), { method: 'POST', body: '[1,2]', headers: bearer() });
  await ask('no such field', data('/layouts/Customers/records'), { method: 'POST', body: '{"fieldData":{"Nope":1}}', headers: bearer() });
  await ask('text in a number field is kept', data('/layouts/Customers/records'), { method: 'POST', body: '{"fieldData":{"Age":{"a":1}}}', headers: bearer() });
  await ask('find that matches nothing', data('/layouts/Customers/_find'), { method: 'POST', body: '{"query":[{"Name":"Zed"}]}', headers: bearer() });
  await ask('find with no query', data('/layouts/Customers/_find'), { method: 'POST', body: '{}', headers: bearer() });
  await ask('find on a field that is not there', data('/layouts/Customers/_find'), { method: 'POST', body: '{"query":[{"Nope":"x"}]}', headers: bearer() });
  await ask('find with a query that is not a list', data('/layouts/Customers/_find'), { method: 'POST', body: '{"query":"Ann"}', headers: bearer() });
  await ask('limit not a number', data('/layouts/Customers/records?_limit=abc'), { headers: bearer() });
  await ask('offset below one', data('/layouts/Customers/records?_offset=-3'), { headers: bearer() });
  await ask('sort that is not JSON', data('/layouts/Customers/records?_sort=%7Bhalf'), { headers: bearer() });
  await ask('script that is not there', data('/layouts/Customers/records?script=Nope'), { headers: bearer() });
  await ask('update a missing record', data('/layouts/Customers/records/999'), { method: 'PATCH', body: '{"fieldData":{"Name":"x"}}', headers: bearer() });
  await ask('delete a missing record', data('/layouts/Customers/records/999'), { method: 'DELETE', headers: bearer() });
  await ask('container upload to a text field', data('/layouts/Customers/records/1/containers/Name/1'), { method: 'POST', type: 'multipart/form-data; boundary=x', body: '--x--', headers: bearer() });
  await ask('container upload with no file', data('/layouts/Customers/records/1/containers/Photo/1'), { method: 'POST', type: 'application/json', body: '{}', headers: bearer() });
  await ask('script that is not there, by name', data('/script/Nope'), { headers: bearer() });
  await ask('a route that does not exist', data('/nothing-here'), { headers: bearer() });
  await ask('a method the route does not take', data('/layouts'), { method: 'DELETE', headers: bearer() });
  await ask('oversized value', data('/layouts/Customers/records'), { method: 'POST', body: JSON.stringify({ fieldData: { Name: 'x'.repeat(20 * 1024 * 1024) } }), headers: bearer() });
  assert.ok(seen.length >= 20, `the Data API gave ${seen.length} error messages`);
});

test('a method the layouts list does not take is "unavailable", not a server fault', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  for (const method of ['DELETE', 'PUT', 'PATCH']) {
    const r = await fetch(base + data('/layouts'), { method, headers: bearer() });
    assert.equal(r.status, 404, method);
    const body = (await r.json()) as { messages: { code: string; message: string }[] };
    assert.equal(body.messages[0].code, '3', method);
    assert.match(body.messages[0].message, /^Command is unavailable/, method);
  }
  assert.equal(logged.mock.callCount(), 0, 'nothing went wrong inside the server');
});

test('a value in a request that is not text is not named "[object Object]"', async () => {
  const post = async (path: string, body: unknown) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, text: ((await r.json()) as { error: string }).error };
  };
  for (const account of [{}, [], { a: 1 }, [{ b: 2 }]]) {
    for (const path of ['/tabularius/admin/v1/accounts/unlock', '/tabularius/admin/v1/accounts/set-password']) {
      const r = await post(path, { database: 'Shop', account, password: 'x' });
      assert.equal(r.status, 400, path);
      assert.equal(r.text, 'No account "" in Shop', path);
    }
  }
  const token = await post('/tabularius/admin/v1/mcp/tokens', { database: 'Shop', account: {} });
  assert.doesNotMatch(token.text, /\[object|\{\}/);
});

test('file upload: a name, a size and a file that are wrong are answered in sentences', async () => {
  const up = (path: string, init: Parameters<typeof ask>[2] = {}) => ask('upload ' + path, `/tabularius/admin/v1/uploads${path}`, init);
  await up('', { method: 'POST', body: '{}' });
  await up('', { method: 'POST', body: '{ half' });
  await up('', { method: 'POST', body: JSON.stringify({ name: 'notes.pdf', size: 10 }) });
  await up('', { method: 'POST', body: JSON.stringify({ name: 'a.zip', size: 10 }) });
  await up('', { method: 'POST', body: JSON.stringify({ name: 'Empty.fmp12', size: 0 }) });
  await up('', { method: 'POST', body: JSON.stringify({ name: '../Sneaky.fmp12', size: 10 }) });
  await up('', { method: 'POST', body: JSON.stringify({ name: 'Shop.fmp12', size: 10 }) });
  await up('', { method: 'POST', body: JSON.stringify({ name: 'Huge.fmp12', size: 2 ** 50 }) });
  await up('/nonsense', { method: 'PUT', type: 'application/octet-stream', body: 'x' });
  await up('/nonsense/finish', { method: 'POST' });
  await up('/nonsense', { method: 'DELETE' });
  // A file that is not a FileMaker file, sent properly.
  const junk = 'this is not a FileMaker file, it is text.';
  const start = await fetch(`${base}/tabularius/admin/v1/uploads`, { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Junk.fmp12', size: junk.length }) });
  const { id } = (await start.json()) as { id: string };
  await fetch(`${base}/tabularius/admin/v1/uploads/${id}?offset=0`, { method: 'PUT', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/octet-stream' }, body: junk });
  await fetch(`${base}/tabularius/admin/v1/uploads/${id}/finish`, { method: 'POST', headers: { 'x-tabularius-admin': '1' } });
  let phase = '';
  for (let i = 0; i < 100 && phase !== 'failed' && phase !== 'hosted'; i++) {
    const r = await (await fetch(`${base}/tabularius/admin/v1/uploads/${id}`, { headers: { 'x-tabularius-admin': '1' } })).json() as { phase: string; error?: string };
    phase = r.phase;
    if (phase === 'failed') seen.push({ what: 'a file that is not a FileMaker file', status: 200, text: r.error ?? '' });
    else await new Promise((ok) => setTimeout(ok, 50));
  }
  assert.equal(phase, 'failed', 'a text file is not hosted');
});

test('admin console: calls with a body that is wrong are answered in sentences', async () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'admin.ts'), 'utf8');
  const routes = [...src.matchAll(/path === '(\/tabularius\/admin\/v1\/[\w/-]+)' && req\.method === '(POST|PUT)'/g)].map((m) => ({ path: m[1], method: m[2] }));
  assert.ok(routes.length > 25, `${routes.length} routes found`);
  const skip = /sign-in|sign-out|passkey|uploads|backup\/stop|reconvert-all|solutions/;
  for (const { path, method } of routes) {
    if (skip.test(path)) continue;
    for (const body of ['{ half', '[]', '"text"', '{}', '{"database":"Nope","name":"Nope","account":"Nobody","id":"nope"}', '{"database":"Shop","name":123,"account":{},"minutes":"soon","level":9,"to":"not an address"}']) {
      await ask(`${method} ${path} ${body.slice(0, 20)}`, path, { method, body });
    }
  }
});

test('web client: calls with a body that is wrong, or a layout that is not there, are answered in sentences', async () => {
  const app = (path: string) => `/tabularius/app/v1/databases/Shop${path}`;
  const kinds = ['view', 'records', 'foundset', 'groups', 'charts', 'menus', 'button', 'index', 'position', 'export', 'import', 'undo-import', 'ai-replace', 'explain', 'history', 'revert', 'refresh', 'value-list'];
  for (const layout of ['Customers', 'Nope']) {
    await ask(`layout ${layout}`, app(`/layouts/${layout}`), { headers: bearer() });
    for (const kind of kinds) {
      for (const body of ['{ half', '[]', '"text"', '{}', '{"field":{},"script":[],"id":{},"ids":"x","parameter":{},"requests":"x","sort":5,"find":7,"name":{},"value":{}}']) {
        await ask(`web ${layout} ${kind} ${body.slice(0, 12)}`, app(`/layouts/${layout}/${kind}`), { method: 'POST', body, headers: bearer() });
      }
      await ask(`web ${layout} ${kind} (GET)`, app(`/layouts/${layout}/${kind}`), { headers: bearer() });
    }
  }
  for (const part of ['prefs', 'prefs/finds', 'prefs/sorts', 'prefs/nonsense', 'runs/stop', 'runs/abc123/file']) {
    for (const method of ['GET', 'PUT', 'POST']) for (const body of ['{ half', '{"value":{}}', '[]']) await ask(`web ${method} ${part}`, app('/' + part), { method, body, headers: bearer() });
  }
});

test('a browser that opens an address that is not there, or does not take the request, is shown a page with words', async () => {
  for (const [path, method] of [['/nonsense', 'GET'], ['/app/nonsense', 'GET'], ['/admin/nonsense', 'GET'], ['/fmi/nonsense', 'GET'], ['/tabularius/app/v1/nonsense', 'GET']]) {
    const r = await fetch(base + path, { method, headers: { accept: 'text/html,application/xhtml+xml' } });
    assert.ok(r.status >= 400, `${method} ${path}`);
    const text = (await r.text()).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.ok(text.split(' ').length >= 5, `${method} ${path} gave "${text}"`);
    assert.deepEqual(problems(text), [], `${method} ${path}`);
  }
});

test('every error message these requests drew reads as a sentence', () => {
  assert.ok(seen.length > 100, `${seen.length} error messages were collected`);
  if (process.env.SHOW_ERRORS) writeFileSync(process.env.SHOW_ERRORS, seen.map((s) => `${s.status} ${s.what}: ${s.text}`).join('\n'));
  // The admin console's upload refusal names the hosted folder on purpose: the person is told where to copy the file.
  const bad = seen.map((s) => ({ ...s, why: problems(s.text.split(dir).join('the hosted folder')) })).filter((s) => s.why.length);
  assert.deepEqual(bad.map((s) => `${s.what} (${s.status}): ${s.text.slice(0, 160)} — ${s.why.join(', ')}`), []);
  const empty = seen.filter((s) => !s.text.trim());
  assert.deepEqual(empty.map((s) => s.what), [], 'a failure with no words');
});
