import { after, before, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';
import { ScimDirectory } from '../src/scim.ts';
import { Assistant } from '../src/assistant.ts';

let app: Awaited<ReturnType<typeof serve>>;
let dir: string;
let limited: string;
let full: string;
let apiToken: string;
let oauthToken: string;
let scim: string;
let hook: string;
const basic = (name = 'Limited') => 'Basic ' + btoa(`${name}:pw`);
const records = '/fmi/data/vLatest/databases/U/layouts/Docs/records';
const bigText = 'x'.repeat(80 * 1024);
const csv = Array.from({ length: 10_000 }, (_, i) => `import row ${String(i).padStart(6, '0')}`).join('\n');

async function send(path: string, body: unknown, authorization?: string, method = 'POST') {
  return fetch(app.url + path, { method, headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) });
}
async function login(name: string) {
  const r = await send('/fmi/data/vLatest/databases/U/sessions', {}, basic(name));
  assert.equal(r.status, 200);
  return 'Bearer ' + (await r.json()).response.token;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'upload-auth-compat-'));
  setAdminPassword(dir, 'pw');
  app = await serve({ dir, port: 0, watch: false, log: () => {}, mcpToken: 'server-secret', inboundHooks: true });
  const store = app.host.create('U');
  store.setAiPolicy(false); // these cases are about request sizes, not the AI policy
  store.applyDesign([
    { op: 'createTable', name: 'Docs', fields: [{ name: 'Title' }, { name: 'File', type: 'container' }] },
    { op: 'createScript', name: 'Hook', text: 'Exit Script [ Text Result: "ok" ]' },
    // Even an unused external source used to shrink every Full Access request.
    { op: 'createDataSource', name: 'External', paths: ['file:External'] },
  ]);
  store.create('Docs', { Title: 'one' });
  store.setPassword('Admin', 'pw');
  store.savePrivilegeSet({ name: 'Limited', records: { view: true, create: true, edit: true, delete: true },
    layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmodata', 'fmmcp', 'fmxdbc'] });
  store.setPassword('Limited', 'pw', 'Limited');
  limited = await login('Limited');
  full = await login('Admin');
  apiToken = 'Bearer ' + store.createApiToken('Admin', { surfaces: ['fmmcp'] });
  const directory = new ScimDirectory(store);
  scim = 'Bearer ' + directory.issueToken({ defaultPrivilegeSet: 'Limited' });
  mock.getter(Assistant.prototype, 'available', () => true);
  mock.method(Assistant.prototype, 'chat', async () => ({ text: 'accepted' }));
  const made = await fetch(app.url + '/tabularius/admin/v1/inbound-hooks', { method: 'POST',
    headers: { authorization: basic('Admin'), 'x-tabularius-admin': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test', database: 'U', script: 'Hook', account: 'Admin' }) });
  assert.equal(made.status, 201, await made.clone().text());
  hook = (await made.json()).path;
  const redirect = 'https://claude.ai/api/mcp/auth_callback';
  const registered = await send('/oauth/register', { client_name: 'Compatibility test', redirect_uris: [redirect] });
  const { client_id } = await registered.json();
  const verifier = 'a'.repeat(43);
  const form = (path: string, fields: Record<string, string>) => fetch(app.url + path, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  const authorized = await form('/oauth/authorize', { client_id, redirect_uri: redirect, response_type: 'code',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    resource: app.url + '/mcp', database: 'U', account: 'Admin', password: 'pw', state: 'compat' });
  assert.equal(authorized.status, 302, await authorized.clone().text());
  const code = new URL(authorized.headers.get('location')!).searchParams.get('code')!;
  const token = await form('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: redirect });
  assert.equal(token.status, 200);
  oauthToken = 'Bearer ' + (await token.json()).access_token;
});
after(async () => {
  app?.server.closeAllConnections();
  if (app) await new Promise<void>(resolve => app.server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

for (const account of ['Limited', 'Full Access with external source']) test(`${account}: 80 KiB record and find succeed`, async () => {
  const auth = account === 'Limited' ? limited : full;
  const r = await send(records, { fieldData: { Title: bigText } }, auth);
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).messages[0].code, '0');
  const found = await send(records.replace('/records', '/_find'), { query: Array.from({ length: 25 }, () => ({ Title: 'one' + ' '.repeat(3300) })) }, auth);
  assert.equal(found.status, 200, await found.clone().text());
  assert.ok((await found.json()).response.data.length > 0);
});

test('limited session: Refresh Window accepts 20,000 ids', async () => {
  const r = await send('/tabularius/app/v1/databases/U/layouts/Docs/refresh', {
    ids: Array.from({ length: 20_000 }, (_, i) => i + 1), recordId: 1, displayRecords: [1],
  }, limited);
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).records[0].fieldData.Title, 'one');
});

test('limited session: import accepts a 10,000-row CSV', async () => {
  const data = new FormData();
  data.set('upload', new Blob([csv], { type: 'text/csv' }), 'rows.csv');
  const r = await fetch(app.url + '/tabularius/app/v1/databases/U/layouts/Docs/import?mapping=%5B%22Title%22%5D', {
    method: 'POST', headers: { authorization: limited }, body: data,
  });
  assert.equal(r.status, 200, await r.clone().text());
  const result = await r.json();
  assert.equal(result.imported, 10_000, JSON.stringify(result).slice(0, 500));
});

for (const readOnly of [false, true]) test(`OData batch: 900 GETs (${readOnly ? 'read-only token' : 'limited Basic'})`, async () => {
  const body = { requests: Array.from({ length: 900 }, (_, i) => ({ id: String(i), method: 'GET', url: 'Docs?$top=1&$select=Title', headers: { accept: 'application/json' } })) };
  assert.ok(JSON.stringify(body).length > 64 * 1024);
  const auth = readOnly ? 'Bearer ' + app.host.get('U')!.createApiToken('Limited', { surfaces: ['fmodata'], readOnly: true }) : basic();
  const r = await send('/fmi/odata/v4/U/$batch', body, auth);
  assert.equal(r.status, 200, await r.clone().text());
  const { responses } = await r.json();
  assert.equal(responses.length, 900);
  assert.ok(responses.every((r: { status: number }) => r.status === 200));
});

test('SQL: a limited account can send an 80 KiB parameter', async () => {
  const r = await send('/tabularius/sql/v1/databases/U', { sql: 'SELECT ? AS value', params: [bigText] }, basic());
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual((await r.json()).rows, [[bigText]]);
});

test('SCIM Group PUT accepts 1,400 members', async () => {
  const store = app.host.get('U')!;
  // Seed an existing IdP directory in one transaction. Repeated account-security mutations
  // rebuild caches and obscure this HTTP envelope regression with quadratic fixture work.
  new ScimDirectory(store).rows(); // initialise the directory table
  const members: { value: string }[] = [];
  store.sql.exec('BEGIN');
  try {
    // A SCIM user is bound to its account's identity; a row without one is a legacy binding and is dropped, so give each a real identity.
    const account = store.sql.prepare("INSERT INTO _fm_accounts (name, password_hash, source, privilege_set, identity_id) VALUES (?, NULL, 'external', 'Limited', ?)");
    const user = store.sql.prepare("INSERT INTO _fm_scim_users (id, account, attrs, groups, created, modified, account_identity) VALUES (?, ?, '{}', ?, ?, ?, ?)");
    const now = new Date().toISOString();
    for (let i = 0; i < 1400; i++) {
      const name = `member${i}@example.test`;
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const identity = randomUUID();
      account.run(name, identity);
      // Refresh 1,399 existing memberships and add one; avoid quadratic setup via 1,400 API mutations.
      user.run(id, name, i === 1399 ? '[]' : '["Limited"]', now, now, identity);
      members.push({ value: id });
    }
    store.sql.exec('COMMIT');
  } catch (e) { store.sql.exec('ROLLBACK'); throw e; }
  assert.ok(JSON.stringify({ members }).length > 64 * 1024);
  const r = await send('/tabularius/scim/v2/databases/U/Groups/TGltaXRlZA', { members }, scim, 'PUT');
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).members.length, 1400);
});

test('limited session: a long assistant chat reaches the chat provider', async () => {
  const r = await send('/tabularius/assistant/v1/databases/U', { messages: [{ role: 'user', content: bigText }] }, limited);
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { text: 'accepted' });
});

const toolCalls = [
  ['add_image', { filename: 'image.png', mime: 'image/png', data: Buffer.alloc(60 * 1024, 1).toString('base64') }],
  ['upload_container', { layout: 'Docs', recordId: 1, field: 'File', filename: 'file.bin', data: Buffer.alloc(60 * 1024, 1).toString('base64') }],
  ['paste_from_filemaker', { xml: `<fmxmlsnippet type="FMObjectList"><Step enable="True" id="7" name="New Record/Request"/><!--${bigText}--></fmxmlsnippet>` }],
  ['import_records', { layout: 'Docs', format: 'csv', data: 'Title\n' + bigText, headerRow: true, columns: [{ column: 0, field: 'Title' }] }],
] as const;
for (const token of ['API', 'OAuth']) for (const [name, args] of toolCalls) test(`verified ${token}: MCP ${name} exceeds 64 KiB`, async () => {
  const r = await fetch(app.url + '/mcp', { method: 'POST', headers: { authorization: token === 'API' ? apiToken : oauthToken,
    'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { database: 'U', ...args } } }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  const result = await r.json();
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.ok(!result.result.isError, JSON.stringify(result));
});

/** The client deliberately waits until its write completes before reading the response. */
function raw(payload: string | Buffer): Promise<string> {
  return new Promise(resolve => {
    const url = new URL(app.url);
    const socket = connect(Number(url.port), url.hostname);
    let response = '';
    const timer = setTimeout(() => socket.destroy(), 3500);
    socket.pause();
    socket.on('connect', () => socket.write(payload, () => socket.resume()));
    socket.on('data', c => { response += c.toString(); });
    socket.on('error', () => socket.resume());
    socket.on('close', () => { clearTimeout(timer); resolve(response); });
  });
}

test('a 5 MiB send-then-read client receives the 401 in at least 19/20 runs', async () => {
  const payload = Buffer.concat([Buffer.from(`POST ${records} HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${5 * 1024 * 1024}\r\n\r\n`), Buffer.alloc(5 * 1024 * 1024, 32)]);
  let received = 0;
  for (let i = 0; i < 20; i++) if (/^HTTP\/1.1 401 /.test(await raw(payload))) received++;
  assert.ok(received >= 19, `${received}/20 received the refusal`);
  console.log(`send-then-read refusal delivery: ${received}/20`);
});

for (const route of ['admin login', 'Data API logout']) for (const chunked of [false, true]) test(`${route}: a small ignored ${chunked ? 'chunked' : 'fixed-length'} body preserves the next pipelined request`, async () => {
  const path = route === 'admin login' ? '/fmi/admin/api/v2/user/auth' : '/fmi/data/vLatest/databases/U/sessions/' + (await login('Limited')).slice(7);
  const framing = chunked ? 'Transfer-Encoding: chunked' : 'Content-Length: 2';
  const body = chunked ? '2\r\n{}\r\n0\r\n\r\n' : '{}';
  const response = await raw(`${route === 'admin login' ? 'POST' : 'DELETE'} ${path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: ${basic('Admin')}\r\n${framing}\r\n\r\n${body}GET /tabularius/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
  assert.equal((response.match(/HTTP\/1.1 200 /g) ?? []).length, 2, response);
});

function expectContinue(path: string, auth?: string, size = 1024 * 1024): Promise<{ status: number; continued: boolean }> {
  return new Promise((resolve, reject) => {
    let continued = false;
    const req = request(app.url + path, { method: 'POST', headers: { expect: '100-continue', 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': size, ...(auth ? { authorization: auth } : {}) } }, res => {
      res.resume();
      res.on('end', () => { req.destroy(); resolve({ status: res.statusCode!, continued }); });
    });
    req.on('continue', () => { continued = true; req.end('{}'); });
    req.on('error', reject);
    req.setTimeout(3500, () => req.destroy(new Error('waiting for auth response')));
    req.flushHeaders();
  });
}
test('Expect: unauthenticated uploads are refused without 100 Continue', async () => {
  assert.deepEqual(await expectContinue(records), { status: 401, continued: false });
});
test('Expect: oversized body-based login is refused without 100 Continue', async () => {
  assert.deepEqual(await expectContinue('/fmi/data/vLatest/databases/U/sessions'), { status: 413, continued: false });
});
test('Expect: authenticated body readers and bounded logins can continue', async () => {
  assert.deepEqual(await expectContinue(records, limited, 2), { status: 200, continued: true });
  assert.deepEqual(await expectContinue('/fmi/data/vLatest/databases/U/sessions', basic(), 2), { status: 200, continued: true });
});
test('inbound hook: missing header-only timestamp is refused before reading', async () => {
  assert.deepEqual(await expectContinue(hook, undefined, 128 * 1024), { status: 401, continued: false });
});

test('Expect: unverified MCP Basic refuses an oversized envelope before 100 Continue', async () => {
  assert.deepEqual(await expectContinue('/mcp', basic()), { status: 413, continued: false });
});

test('a stalled refused sender is forcibly closed within the two-second drain window', async () => {
  const url = new URL(app.url);
  const socket = connect({ port: Number(url.port), host: url.hostname, allowHalfOpen: true });
  let timer: NodeJS.Timeout | undefined;
  let drip: NodeJS.Timeout | undefined;
  let response = '';
  try {
    const closed = new Promise<number>((resolve, reject) => {
      app.server.prependOnceListener('request', req => {
        const start = Date.now();
        req.socket.once('close', () => resolve(Date.now() - start));
      });
      timer = setTimeout(() => reject(new Error('refused sender outlived drain timeout')), 5000);
    });
    socket.on('data', chunk => { response += chunk.toString(); });
    socket.on('error', () => {});
    socket.on('connect', () => {
      socket.write(`POST ${records} HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${5 * 1024 * 1024}\r\n\r\n`);
      drip = setInterval(() => socket.write('x'), 50);
    });
    const elapsed = await closed;
    assert.match(response, /^HTTP\/1.1 401 /);
    assert.ok(elapsed >= 1800 && elapsed < 4000, `closed after ${elapsed} ms`);
  } finally {
    clearTimeout(timer);
    clearInterval(drip);
    socket.destroy();
  }
});

for (const [path, max, auth] of [
  [records, 10 * 1024 * 1024, 'session'],
  ['/tabularius/app/v1/databases/U/layouts/Docs/import', 50 * 1024 * 1024, 'session'],
  ['/fmi/odata/v4/U/$batch', 32 * 1024 * 1024, 'basic'],
  ['/tabularius/sql/v1/databases/U', 10 * 1024 * 1024, 'basic'],
  ['/tabularius/scim/v2/databases/U/Users', 10 * 1024 * 1024, 'scim'],
  ['/tabularius/assistant/v1/databases/U', 10 * 1024 * 1024, 'session'],
] as const) test(`authenticated route retains its previous maximum: ${path}`, async () => {
  const authorization = auth === 'basic' ? basic() : auth === 'scim' ? scim : limited;
  assert.deepEqual(await expectContinue(path, authorization, max + 1), { status: 413, continued: false });
});


test('an authenticated chunked 80 KiB record preserves keep-alive for the next request', async () => {
  const body = JSON.stringify({ fieldData: { Title: bigText } });
  const response = await raw(`POST ${records} HTTP/1.1\r\nHost: localhost\r\nAuthorization: ${limited}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n0\r\n\r\nGET /tabularius/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
  assert.equal((response.match(/HTTP\/1.1 200 /g) ?? []).length, 2, response);
});
