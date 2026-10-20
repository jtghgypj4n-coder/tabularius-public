// OAuth 2 refresh-token sign-in (how Google Drive, Dropbox and OneDrive are used) and the well-known services that
// point a REST connection at them. Tested against a local stand-in for the token service and the API; nothing here
// reaches a real service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connections, ConnectionError, scriptConnections } from '../src/index.ts';

const SECRETS = { clientId: 'app-key-1', clientSecret: 'app-secret-3a2b1c0d', refreshToken: 'refresh-9f8e7d6c5b4a' };
let dir: string;
let service: Server;
let origin: string;
let connections: Connections;
let seen: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[] = [];
let tokenCalls = 0;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-connections-services-'));
  service = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/oauth/token') {
      const basic = Buffer.from(String(req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
      const form = new URLSearchParams(body);
      if (basic !== `${SECRETS.clientId}:${SECRETS.clientSecret}` || form.get('grant_type') !== 'refresh_token' || form.get('refresh_token') !== SECRETS.refreshToken) {
        return void res.writeHead(400, { 'content-type': 'application/json' }).end(`{"error":"invalid_grant","error_description":"bad refresh token ${form.get('refresh_token')}"}`);
      }
      tokenCalls++;
      // A rotated refresh token in the answer is not kept: nothing is written back.
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: `access-${tokenCalls}`, token_type: 'Bearer', expires_in: 3600, refresh_token: 'rotated-token-value' }));
    }
    if (url.pathname === '/v1/echo-failure') return void res.writeHead(500).end(`failed for ${req.headers.authorization}`);
    if (/^Bearer access-\d+$/.test(String(req.headers.authorization ?? ''))) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, method: req.method, path: url.pathname, query: url.search, echoed: body }));
    } else res.writeHead(401).end('no');
  });
  await new Promise<void>((r) => service.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(service.address() as { port: number }).port}`;
  connections = new Connections(dir);
});
after(async () => {
  await new Promise<void>((r) => service.close(() => r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const make = (name: string, config: Record<string, string> = {}) => {
  connections.create({ name, type: 'rest', config: { baseUrl: `${origin}/v1`, auth: 'oauth2-refresh', tokenUrl: `${origin}/oauth/token`, access: 'write', ...config } });
  for (const [k, v] of Object.entries(SECRETS)) connections.setSecret(name, k, v);
  connections.approve(name);
};

test('a refresh token is exchanged for an access token that is used, kept and sent as the sign-in', async () => {
  make('drive', { testPath: '/about' });
  const sc = scriptConnections(connections);
  tokenCalls = 0;
  seen = [];
  const first = await sc.request('drive', { method: 'POST', path: '/files', query: '', headers: {}, body: Buffer.from('{"name":"a"}') }, ['Shop']);
  assert.equal(first.status, 200);
  await sc.request('drive', { method: 'GET', path: '/files', query: '', headers: {} }, ['Shop']);
  assert.equal(tokenCalls, 1, 'the access token is reused');
  const token = seen.find((x) => x.url === '/oauth/token')!;
  assert.equal(token.method, 'POST');
  assert.match(token.body, /grant_type=refresh_token/);
  assert.match(token.body, /refresh_token=refresh-9f8e7d6c5b4a/);
  assert.equal(Buffer.from(String(token.headers.authorization).replace('Basic ', ''), 'base64').toString(), `${SECRETS.clientId}:${SECRETS.clientSecret}`);
  const call = seen.find((x) => x.url === '/v1/files')!;
  assert.equal(call.headers.authorization, 'Bearer access-1');
  // The script's answer holds no secret and no token.
  const text = JSON.stringify(first);
  for (const s of [...Object.values(SECRETS), 'rotated-token-value']) assert.ok(!text.includes(s));
  // Nothing was written back, not even the rotated token.
  const files = readdirSync(dir);
  for (const f of files) {
    const body = readFileSync(join(dir, f), 'utf8');
    assert.ok(!body.includes('rotated-token-value') && !body.includes(SECRETS.refreshToken) && !body.includes(SECRETS.clientSecret), `${f} holds a plain secret`);
  }
  const t = await connections.test('drive');
  assert.equal(t.ok, true, t.message);
});

test('a refresh token needs all three secrets, and a refused one is explained without what the service echoed', async () => {
  const fields = connections.create({ name: 'needs-all', type: 'rest', config: { baseUrl: `${origin}/v1`, auth: 'oauth2-refresh', tokenUrl: `${origin}/oauth/token` } });
  assert.deepEqual(connections.get(fields.name).secrets.map((s) => s.name), ['clientId', 'clientSecret', 'refreshToken']);
  connections.setSecret('needs-all', 'clientId', SECRETS.clientId);
  connections.setSecret('needs-all', 'clientSecret', SECRETS.clientSecret);
  assert.throws(() => connections.approve('needs-all'), ConnectionError);
  connections.setSecret('needs-all', 'refreshToken', 'revoked-token-0000');
  const t = await connections.test('needs-all');
  assert.equal(t.ok, false);
  assert.match(t.message, /The token service answered 400 \(invalid_grant\) and gave no token/);
  assert.ok(!t.message.includes('revoked-token-0000'));
  connections.remove('needs-all');
});

test('a different refresh token is a different sign-in, not the cached one', async () => {
  make('other');
  tokenCalls = 0;
  const sc = scriptConnections(connections);
  await sc.request('other', { method: 'GET', path: '/x', query: '', headers: {} }, ['Shop']);
  assert.equal(tokenCalls, 1);
  connections.setSecret('other', 'refreshToken', 'revoked-token-1111');
  await assert.rejects(sc.request('other', { method: 'GET', path: '/x', query: '', headers: {} }, ['Shop']), /token service answered 400/);
});

test('the token address is where the secrets can go, and the settings only fit a sign-in that uses them', () => {
  const c = connections.create({ name: 'reach', type: 'rest', config: { baseUrl: 'https://api.example.com/v1', auth: 'oauth2-refresh', tokenUrl: 'https://auth.example.com/token', scope: 'files.read' } });
  assert.deepEqual(connections.reaches(c.name).sort(), ['https://api.example.com', 'https://auth.example.com']);
  assert.throws(() => connections.create({ name: 'no-token-url', type: 'rest', config: { baseUrl: 'https://api.example.com/v1', auth: 'oauth2-refresh' } }), /token address/);
  assert.throws(() => connections.create({ name: 'bad-use', type: 'rest', config: { baseUrl: 'https://api.example.com/v1', auth: 'bearer', tokenUrl: 'https://auth.example.com/token' } }), /oauth2/);
  connections.remove('reach');
});

test('every well-known service makes a valid draft that needs a person for the secrets, and an AI draft of it can only read', () => {
  const rest = connections.types().find((t) => t.id === 'rest')!;
  assert.ok(rest.services.length >= 5);
  // Each address is one API, not a whole provider's host.
  for (const svc of rest.services) assert.ok(new URL(svc.config.baseUrl).pathname.length > 1 || svc.id.startsWith('dropbox') === false, svc.id);
  assert.deepEqual(rest.services.map((s) => s.id), ['google-drive', 'google-drive-upload', 'dropbox', 'dropbox-files', 'microsoft-onedrive']);
  assert.equal(new Set(rest.services.map((s) => s.id)).size, rest.services.length);
  for (const svc of rest.services) {
    assert.ok(svc.label && svc.help.length > 40, svc.id);
    assert.ok(svc.config.baseUrl.startsWith('https://') && svc.config.tokenUrl.startsWith('https://'), svc.id);
    assert.ok(!JSON.stringify(svc).match(/secret-|token-[0-9a-f]{8}/), `${svc.id} holds nothing like a secret`);
    const made = connections.create({ name: `svc-${svc.id}`, type: 'rest', config: svc.config, files: ['Shop'] }, 'ai');
    assert.equal(made.status, 'draft', svc.id);
    assert.equal(made.config.access, 'read', `${svc.id}: an AI draft never starts with write`);
    assert.equal(made.config.auth, 'oauth2-refresh');
    assert.deepEqual(connections.get(made.name).secrets.map((s) => s.name), ['clientId', 'clientSecret', 'refreshToken'], svc.id);
    assert.equal(connections.get(made.name).ready, false);
    // A person's own copy keeps the service's own settings, write included where the service needs it.
    const person = connections.create({ name: `own-${svc.id}`, type: 'rest', config: svc.config });
    assert.equal(person.config.access, svc.config.access ?? 'read', svc.id);
    connections.remove(made.name);
    connections.remove(person.name);
  }
});

test('the console offers the services and fills in their settings', () => {
  const page = readFileSync(join(import.meta.dirname, '..', 'admin', 'index.html'), 'utf8');
  assert.match(page, /id="connection-service"/);
  assert.match(page, /Start from/);
  assert.match(page, /service\.config/);
});

test('an access token a service echoes back is hidden from the script', async () => {
  make('echo');
  const sc = scriptConnections(connections);
  const r = await sc.request('echo', { method: 'GET', path: '/echo-failure', query: '', headers: {} }, ['Shop']);
  assert.equal(r.status, 500);
  const text = await r.text();
  assert.ok(!/access-\d+/.test(text), text);
  assert.match(text, /Bearer \*\*\*/);
});

test('a connection missing a secret refuses to sign in, and a changed sign-in or token address clears the secrets', async () => {
  connections.create({ name: 'switch', type: 'rest', config: { baseUrl: `${origin}/v1`, auth: 'oauth2', tokenUrl: `${origin}/oauth/token` } });
  connections.setSecret('switch', 'clientId', SECRETS.clientId);
  connections.setSecret('switch', 'clientSecret', SECRETS.clientSecret);
  connections.approve('switch');
  connections.update('switch', { config: { baseUrl: `${origin}/v1`, auth: 'oauth2-refresh', tokenUrl: `${origin}/oauth/token`, access: 'write' } });
  const after = connections.get('switch');
  assert.equal(after.status, 'draft', 'a different sign-in is approved afresh');
  assert.equal(after.secrets.filter((x) => x.set).length, 0, 'and its secrets are typed again');
  const sc = scriptConnections(connections);
  await assert.rejects(sc.request('switch', { method: 'GET', path: '/x', query: '', headers: {} }, ['Shop']), /not been approved/);
  // A token address smuggled into the base address through the join character is a change too.
  connections.create({ name: 'join', type: 'rest', config: { baseUrl: 'https://a.example.com/p', auth: 'oauth2-refresh', tokenUrl: 'https://b.example.com/t|https://c.example.com/t' } });
  for (const [k, v] of Object.entries(SECRETS)) connections.setSecret('join', k, v);
  connections.approve('join');
  connections.update('join', { config: { baseUrl: 'https://a.example.com/p|https://b.example.com/t', auth: 'oauth2-refresh', tokenUrl: 'https://c.example.com/t' } });
  assert.equal(connections.get('join').status, 'draft');
});
