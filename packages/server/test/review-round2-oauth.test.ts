import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Host } from '../src/host.ts';
import { OAuthServer } from '../src/oauth.ts';
import { expiryClock, ExpiryClock } from '../../store/src/clock.ts';
import { signInForm } from './oauth-form.ts';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-review-oauth-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Review');
  store.setAiPolicy(false);
  store.savePrivilegeSet({ name: 'Bot', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  store.setPassword('réviewer', 'synthetic-passphrase', 'Bot');
  let workers = [new OAuthServer(host, dir), new OAuthServer(host, dir)], next = 0;
  const server = createServer((req, res) => {
    void workers[next++ % workers.length].handle(req, res, new URL(req.url!, 'http://localhost')).catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, form: Record<string, string>) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const redirect = 'https://client.example.test/callback';
  const register = async () => {
    const r = await fetch(base + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Synthetic client', redirect_uris: [redirect] }) });
    assert.equal(r.status, 201);
    return (await r.json()).client_id as string;
  };
  const authorize = async (client_id: string) => {
    const verifier = randomBytes(32).toString('base64url');
    const r = await signInForm(base, { client_id, redirect_uri: redirect, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', database: 'Review', account: 'réviewer', password: 'synthetic-passphrase', resource: base + '/mcp' });
    assert.equal(r.status, 302);
    return { client_id, grant_type: 'authorization_code', code: new URL(r.headers.get('location')!).searchParams.get('code')!, code_verifier: verifier, redirect_uri: redirect };
  };
  return { store, base, post, register, authorize, restart() { workers.forEach((w) => w.close()); workers = [new OAuthServer(host, dir), new OAuthServer(host, dir)]; },
    async close() { await new Promise<void>((resolve) => server.close(() => resolve())); workers.forEach((w) => w.close()); await host.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('round2: OAuth code and refresh replay fail across two handlers and a restart', async () => {
  const f = await fixture();
  try {
    const client = await f.register(), other = await f.register();
    const code = await f.authorize(client);
    assert.equal((await f.post('/oauth/token', { ...code, client_id: other })).status, 400);
    f.restart();
    const exchanged = await Promise.all([f.post('/oauth/token', code), f.post('/oauth/token', code)]);
    assert.deepEqual(exchanged.map((r) => r.status).sort(), [200, 400]);
    const tokens = await exchanged.find((r) => r.status === 200)!.json();
    assert.equal(f.store.apiToken(tokens.access_token)?.account, 'réviewer');
    assert.deepEqual(f.store.apiToken(tokens.access_token)?.surfaces, ['fmmcp']);
    f.restart();
    const refresh = { client_id: client, grant_type: 'refresh_token', refresh_token: tokens.refresh_token };
    const renewed = await Promise.all([f.post('/oauth/token', refresh), f.post('/oauth/token', refresh)]);
    assert.deepEqual(renewed.map((r) => r.status).sort(), [200, 400]);
    assert.equal(f.store.apiToken(tokens.access_token), undefined);
  } finally { await f.close(); }
});

test('round2: OAuth code expires at its exact boundary despite wall-clock rollback', async (t) => {
  const f = await fixture();
  try {
    let wall = Date.now(), mono = 0;
    const clock = new ExpiryClock(() => wall, () => mono, () => {});
    t.mock.method(expiryClock, 'now', () => clock.now());
    const code = await f.authorize(await f.register());
    wall -= 3600_000;
    mono += 5 * 60_000;
    const r = await f.post('/oauth/token', code);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'invalid_grant');
    assert.equal(f.store.apiTokens().length, 0);
  } finally { await f.close(); }
});

test('round2: registration rejects deep JSON, non-object JSON and oversized bodies without echoing inputs', async () => {
  const f = await fixture();
  try {
    const canary = 'synthetic-registration-material';
    for (const body of ['null', '[]', '{"x":' + '['.repeat(65) + JSON.stringify(canary) + ']'.repeat(65) + '}', JSON.stringify({ x: canary.repeat(4000) })]) {
      const response = await fetch(f.base + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      assert.equal(response.status, 400);
      assert.ok(!(await response.text()).includes(canary));
    }
    assert.ok(await f.register(), 'refusals do not poison later valid registrations');
  } finally { await f.close(); }
});
