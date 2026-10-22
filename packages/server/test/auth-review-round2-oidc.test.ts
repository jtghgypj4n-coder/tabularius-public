import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Host } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';
import { Oidc } from '../src/oidc.ts';
import { expiryClock } from '../../store/src/clock.ts';

async function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-auth-oidc-review-'));
  const host = new Host(dir, () => {}, { background: false });
  host.create('Review');
  const provider = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize` })));
  let issuer = '';
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  const config = { name: 'Review', issuer, clientId: 'synthetic' };
  const handlers = [new Oidc(host, new DataApi(host), config), new Oidc(host, new DataApi(host), config)];
  const servers = handlers.map((_, index) => createServer((req, res) => { void handlers[index].handle(req, res, new URL(req.url!, 'http://localhost')); }));
  for (const server of servers) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const bases = servers.map((server) => `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  const db = new DatabaseSync(join(dir, '.openhbam-oidc', 'pending.sqlite'));
  t.after(async () => {
    for (const server of [...servers, provider]) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const handler of handlers) handler.close();
    db.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  });
  return { handlers, db, bases, restart(index: number) { handlers[index].close(); handlers[index] = new Oidc(host, new DataApi(host), config); } };
}

test('OIDC pending cap is atomic across handlers and expiry frees capacity after a clock edit', async (t) => {
  const { db, bases } = await setup(t);
  let now = expiryClock.now();
  t.mock.method(expiryClock, 'now', () => now);
  db.exec('BEGIN');
  try {
    const insert = db.prepare("INSERT INTO pending(state,provider,database,verifier,nonce,redirect_uri,expires,flow,created) VALUES (?, 'review', 'Review', 'v', 'n', 'http://localhost/callback', ?, 'web', ?)");
    for (let i = 0; i < 1999; i++) insert.run(`synthetic-${i}`, now + 600_000, now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const start = (base: string) => fetch(`${base}/tabularius/auth/v1/oidc/start?db=Review`, { redirect: 'manual' });
  const responses = await Promise.all(bases.map(start));
  const locations = responses.map((r) => decodeURIComponent(r.headers.get('location')!));
  for (const response of responses) await response.arrayBuffer();
  assert.equal(locations.filter((location) => location.includes('code_challenge=')).length, 1);
  assert.equal(locations.filter((location) => location.includes('Too many sign-ins')).length, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM pending').get()!.n, 2000);
  assert.ok(db.prepare('SELECT 1 FROM pending WHERE state = ?').get('synthetic-0'), 'capacity refusal evicts no live row');
  now += 600_000;
  const freed = await start(bases[1]);
  assert.match(freed.headers.get('location')!, /code_challenge=/);
  await freed.arrayBuffer();
  assert.equal(db.prepare('SELECT count(*) AS n FROM pending').get()!.n, 1);
});

test('OIDC pending state survives handler restart and is consumed exactly once even on refusal', async (t) => {
  const s = await setup(t);
  const response = await fetch(`${s.bases[0]}/tabularius/auth/v1/oidc/start?db=Review`, { redirect: 'manual' });
  const state = new URL(response.headers.get('location')!).searchParams.get('state')!;
  await response.arrayBuffer();
  s.restart(1);
  const callback = (base: string) => fetch(`${base}/tabularius/auth/v1/oidc/callback?state=${state}&error=access_denied`, { redirect: 'manual' });
  const results = await Promise.all(s.bases.map(callback));
  const locations = results.map((r) => decodeURIComponent(r.headers.get('location') ?? ''));
  for (const result of results) await result.arrayBuffer();
  assert.equal(locations.filter((v) => /already used/.test(v)).length, 1);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM pending').get()!.n, 0);
});

test('OIDC grants survive reopen, are single-use across handlers, and reject expiry equality', async (t) => {
  const s = await setup(t);
  const now = expiryClock.now();
  t.mock.method(expiryClock, 'now', () => now);
  const insert = s.db.prepare("INSERT INTO grants(request_id,identifier,provider,email,groups,sub,expires,issuer) VALUES (?, 'identifier', 'review', 'person@example.test', '[]', 'subject', ?, 'synthetic')");
  insert.run('valid', now + 60_000);
  insert.run('boundary', now);
  insert.run('wrong-first', now + 60_000);
  s.restart(1);
  assert.ok(s.handlers[1].takeGrant('valid', 'identifier'));
  assert.equal(s.handlers[0].takeGrant('valid', 'identifier'), undefined);
  assert.equal(s.handlers[0].takeGrant('boundary', 'identifier'), undefined);
  assert.equal(s.handlers[0].takeGrant('wrong-first', 'wrong'), undefined);
  assert.equal(s.handlers[1].takeGrant('wrong-first', 'identifier'), undefined);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM grants').get()!.n, 0);
});
