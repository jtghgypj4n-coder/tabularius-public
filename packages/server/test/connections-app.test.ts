// The card under the web assistant's answer: the AI drafts a connection, and a person with [Full Access] finishes it
// there (keys, Test, Approve) on a server that allows it, with the console's checks. Nothing reaches the network:
// the connection's fetch is a stand-in, and the model is a stand-in for the Messages API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import type { PrivilegeDefinition } from '../../store/src/index.ts';
import { setCaptureOnlyDefaults } from '../../scripts/src/index.ts';
// The process names its capture-only files; here, every file that starts with Held.
setCaptureOnlyDefaults(['Held']);

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const KEYS = { accessKey: 'AKIA' + 'IOSFODNN7EXAMPLE', secretKey: 'wJalr' + 'XUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
let dir: string;
let server: Server;
let model: Server;
let base: string;
let host: Host;
const logs: string[] = [];
const reached: string[] = [];

type Answer = { content: Record<string, unknown>[]; stop_reason: string };
let script: ((raw: Record<string, unknown>) => Answer)[] = [];
const text = (t: string): Answer => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
const use = (name: string, input: unknown): Answer => ({ content: [{ type: 'tool_use', id: 'call1', name, input }], stop_reason: 'tool_use' });

const clerk: PrivilegeDefinition = { name: 'Clerk', records: { view: false, edit: false, create: false, delete: false }, tables: {}, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmapp', 'fmmcp'] };

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    if (req.url?.startsWith('/v1/models')) return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const sent = JSON.parse(raw);
      const system = Array.isArray(sent.system) ? sent.system.map((b: { text: string }) => b.text).join('\n') : String(sent.system);
      if (/overview at the top of a conversion guide/.test(system)) return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(text('An overview.')));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify((script.shift() ?? (() => text('(no more answers)')))(sent)));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-connections-app-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  copyFileSync(fixture, join(dir, 'Held_Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: (m: string) => logs.push(m), ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  host = s.host;
  const store = host.get('Charts')!;
  store.savePrivilegeSet(clerk);
  store.setPassword('Admin', 'pw');
  store.setPassword('Clerk', 'pw', 'Clerk');
  host.get('Held_Charts')!.setPassword('Admin', 'pw');
  // The connection reaches a stand-in, never a real service.
  host.connections!.io = { fetch: async (input) => { reached.push(String(input)); return new Response('<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>', { status: 200 }); } };
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const tokens = new Map<string, string>();
/** A sign-in as the web client does it (a person at the window), or as a Data API client does. */
async function login(account: string, client: 'web' | 'rest' = 'web', db = 'Charts'): Promise<string> {
  const key = `${account}/${client}/${db}`;
  if (tokens.has(key)) return tokens.get(key)!;
  const r = await fetch(`${base}/fmi/data/vLatest/databases/${db}/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`), ...(client === 'web' ? { 'x-tabularius-client': 'web' } : {}) }, body: '{}',
  });
  const token = (await r.json()).response.token as string;
  tokens.set(key, token);
  return token;
}
const card = async (account: string, method: string, name: string, path = '', body?: unknown, who: { client?: 'web' | 'rest'; db?: string; token?: string } = {}) => {
  const db = who.db ?? 'Charts';
  const r = await fetch(`${base}/tabularius/assistant/v1/databases/${db}/connections/${name}${path}`, {
    method, headers: { authorization: `Bearer ${who.token ?? await login(account, who.client ?? 'web', db)}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await r.text();
  return { status: r.status, raw, body: raw ? JSON.parse(raw) : {} };
};

test('an answer that drafts a connection comes with a card, and the card says only what the server holds', { skip }, async () => {
  host.appConnections = false;
  script = [
    () => use('draft_connection', { name: 'invoices', type: 's3', config: { bucket: 'acme-invoices', region: 'us-east-1' }, note: 'Scanned invoices' }),
    () => text('I made a draft. Open the card below.'),
  ];
  const r = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await login('Admin')}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Set up an S3 connection to our invoices bucket' }], context: {} }),
  });
  const answer = await r.json();
  assert.equal(r.status, 200, JSON.stringify(answer));
  assert.deepEqual(answer.connections, [{ name: 'invoices' }]);
  assert.equal(host.connections!.get('invoices').createdBy, 'ai');

  // The card's data: the settings and which secrets are set; nothing else.
  const got = await card('Admin', 'GET', 'invoices');
  assert.equal(got.status, 200, got.raw);
  assert.equal(got.body.allowed, false);
  assert.equal(got.body.connection.status, 'draft');
  assert.deepEqual(got.body.connection.reaches, ['https://s3.us-east-1.amazonaws.com']);
  assert.ok(got.body.connection.settings.some((s: { value: string }) => s.value === 'acme-invoices'));
  assert.deepEqual(got.body.connection.secrets.map((s: { name: string; set: boolean }) => [s.name, s.set]), [['accessKey', false], ['secretKey', false], ['sessionToken', false]]);

  // A server that leaves it to the console refuses every step here.
  for (const [method, path, body] of [['PUT', '/secrets/accessKey', { value: KEYS.accessKey }], ['POST', '/test'], ['POST', '/approve'], ['DELETE', '']] as const) {
    const refused = await card('Admin', method, 'invoices', path, body);
    assert.equal(refused.status, 403, `${method} ${path}`);
    assert.match(refused.raw, /admin console/);
  }
  assert.equal(host.connections!.get('invoices').status, 'draft');
  assert.equal(host.connections!.get('invoices').ready, false);
});

test('on a server that allows it, a Full Access person types the keys, tests and approves, with the console\'s checks, and the keys go nowhere else', { skip }, async () => {
  host.appConnections = true;
  assert.equal((await card('Admin', 'GET', 'invoices')).body.allowed, true);

  // The console's checks: keys first, one line, only fields the type has.
  const early = await card('Admin', 'POST', 'invoices', '/approve');
  assert.equal(early.status, 400);
  assert.match(early.raw, /Set Access key ID and Secret access key first/);
  assert.equal((await card('Admin', 'PUT', 'invoices', '/secrets/nonsense', { value: 'x' })).status, 400);
  assert.equal((await card('Admin', 'PUT', 'invoices', '/secrets/accessKey', { value: 'two\nlines' })).status, 400);
  assert.equal((await card('Admin', 'PUT', 'invoices', '/secrets/accessKey', {})).status, 400);

  for (const [field, value] of Object.entries(KEYS)) {
    const set = await card('Admin', 'PUT', 'invoices', `/secrets/${field}`, { value });
    assert.equal(set.status, 200, set.raw);
    assert.ok(!set.raw.includes(value), 'the answer never repeats a key');
  }
  const ready = await card('Admin', 'GET', 'invoices');
  assert.equal(ready.body.connection.ready, true);
  assert.deepEqual(ready.body.connection.secrets.map((s: { set: boolean }) => s.set), [true, true, false]);
  assert.ok(!ready.raw.includes(KEYS.accessKey) && !ready.raw.includes(KEYS.secretKey));

  const tested = await card('Admin', 'POST', 'invoices', '/test');
  assert.equal(tested.status, 200, tested.raw);
  assert.equal(tested.body.result.ok, true, tested.raw);
  assert.ok(reached.length > 0 && reached.every((u) => u.startsWith('https://s3.us-east-1.amazonaws.com/')), reached.join(' '));

  const approved = await card('Admin', 'POST', 'invoices', '/approve');
  assert.equal(approved.status, 200, approved.raw);
  assert.equal(approved.body.connection.status, 'active');
  assert.equal(host.connections!.get('invoices').status, 'active');
  assert.deepEqual(host.connections!.get('invoices').files, ['Charts']);
  // Done: further changes are the console's.
  assert.equal((await card('Admin', 'PUT', 'invoices', '/secrets/accessKey', { value: KEYS.accessKey })).status, 409);
  assert.equal((await card('Admin', 'DELETE', 'invoices')).status, 409);

  // The log says who and what, never a key.
  const log = logs.join('\n');
  assert.match(log, /connection invoices: secret accessKey set from the web app \(Admin\)/);
  assert.match(log, /connection invoices approved from the web app \(Admin\)/);
  for (const v of Object.values(KEYS)) assert.ok(!log.includes(v));
});

test('only a Full Access person at the web client, only this file\'s AI drafts, and a draft can be discarded', { skip }, async () => {
  host.appConnections = true;
  host.connections!.create({ name: 'live', type: 's3', config: { bucket: 'live-bucket' }, files: ['Charts'] }, 'ai');
  const steps: [string, string, unknown?][] = [['GET', ''], ['PUT', '/secrets/accessKey', { value: KEYS.accessKey }], ['POST', '/test'], ['POST', '/approve'], ['DELETE', '']];
  // Not Full Access: no card, no steps.
  for (const [method, path, body] of steps) assert.equal((await card('Clerk', method, 'live', path, body)).status, 403, `Clerk ${method} ${path}`);
  // Full Access, but not a person at the web client: a Data API sign-in or an API token (what an AI app holds) gets nothing, not even the card.
  const apiToken = host.get('Charts')!.createApiToken('Admin', { label: 'an AI app' });
  for (const [method, path, body] of steps) {
    assert.equal((await card('Admin', method, 'live', path, body, { client: 'rest' })).status, 403, `Data API ${method} ${path}`);
    assert.equal((await card('Admin', method, 'live', path, body, { token: apiToken })).status, 403, `API token ${method} ${path}`);
  }
  assert.equal(host.connections!.get('live').ready, false);
  assert.equal(host.connections!.get('live').status, 'draft');

  // A connection a person made in the console, one for other files, one for every file, one that does not exist: none is reachable here, by any step.
  const byPerson = host.connections!.create({ name: 'console-made', type: 's3', config: { bucket: 'x-bucket' }, files: ['Charts'] });
  host.connections!.create({ name: 'other-file', type: 's3', config: { bucket: 'x-bucket' }, files: ['Elsewhere'] }, 'ai');
  host.connections!.create({ name: 'everywhere', type: 's3', config: { bucket: 'x-bucket' } }, 'ai');
  for (const name of ['console-made', 'other-file', 'everywhere', 'missing']) {
    for (const [method, path, body] of steps) assert.equal((await card('Admin', method, name, path, body)).status, 404, `${name} ${method} ${path}`);
  }
  assert.equal(host.connections!.get(byPerson.id).ready, false);

  // A capture-only file gets no card for a draft that somehow exists.
  host.connections!.create({ name: 'held-draft', type: 's3', config: { bucket: 'x-bucket' }, files: ['Held_Charts'] }, 'ai');
  assert.equal((await card('Admin', 'GET', 'held-draft', '', undefined, { db: 'Held_Charts' })).status, 404);

  // Discard removes the draft.
  host.connections!.create({ name: 'scratch', type: 's3', config: { bucket: 'x-bucket' }, files: ['Charts'] }, 'ai');
  assert.equal((await card('Admin', 'DELETE', 'scratch')).status, 200);
  assert.throws(() => host.connections!.get('scratch'), /no connection/);
  // The session token is needed.
  const anon = await fetch(`${base}/tabularius/assistant/v1/databases/Charts/connections/scratch`);
  assert.ok([401, 403].includes(anon.status));
});

test('the card names every place the keys can go, and an AI draft can read but never write', { skip }, async () => {
  host.appConnections = true;
  // An OAuth 2 sign-in sends the client id and secret to the token address, which can be another host than the API.
  host.connections!.create({
    name: 'sneaky', type: 'rest', files: ['Charts'], note: 'read-only, safe, just approve',
    config: { baseUrl: 'https://api.good.example/v1', auth: 'oauth2', tokenUrl: 'https://tokens.elsewhere.example/oauth/token', access: 'write' },
  }, 'ai');
  const got = await card('Admin', 'GET', 'sneaky');
  assert.equal(got.status, 200, got.raw);
  assert.deepEqual(got.body.connection.reaches, ['https://api.good.example', 'https://tokens.elsewhere.example']);
  assert.ok(!got.body.connection.settings.some((s: { value: string }) => s.value === 'write'), 'the AI cannot ask for write access');
  assert.equal(host.connections!.get('sneaky').config.access, 'read');
  // A plain http address on a machine of your own shows its scheme and port, not just a name.
  host.connections!.create({ name: 'lan', type: 'rest', files: ['Charts'], config: { baseUrl: 'http://192.168.1.5:6379' } }, 'ai');
  assert.deepEqual((await card('Admin', 'GET', 'lan')).body.connection.reaches, ['http://192.168.1.5:6379']);
  // Mail: the server and port.
  host.connections!.create({ name: 'smtp-draft', type: 'smtp', files: ['Charts'], config: { host: 'smtp.example.com', from: 'a@example.com' } }, 'ai');
  assert.deepEqual((await card('Admin', 'GET', 'smtp-draft')).body.connection.reaches, ['smtp.example.com:587 (starttls)']);
});

test('what a failed test says never includes a key', { skip }, async () => {
  host.appConnections = true;
  host.connections!.create({ name: 'echo', type: 's3', config: { bucket: 'echo-bucket' }, files: ['Charts'] }, 'ai');
  for (const [field, value] of Object.entries(KEYS)) assert.equal((await card('Admin', 'PUT', 'echo', `/secrets/${field}`, { value })).status, 200);
  const before = host.connections!.io;
  host.connections!.io = { fetch: async () => new Response(`<Error><Code>InvalidAccessKeyId</Code><Message>The key ${KEYS.accessKey} with secret ${KEYS.secretKey} is not known</Message></Error>`, { status: 403 }) };
  try {
    const t = await card('Admin', 'POST', 'echo', '/test');
    assert.equal(t.body.result.ok, false, t.raw);
    assert.ok(!t.raw.includes(KEYS.accessKey) && !t.raw.includes(KEYS.secretKey), t.raw);
    assert.ok(!JSON.stringify(host.connections!.get('echo').lastTest).includes(KEYS.secretKey));
  } finally {
    host.connections!.io = before;
  }
});
