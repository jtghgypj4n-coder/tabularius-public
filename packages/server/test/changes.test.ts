import { deleteBeforeStateLock } from './state-lock-race.ts';
// The change feed and webhooks: other systems keeping up with a hosted file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { ChangeFeed, Webhooks } from '../src/changes.ts';
import type { Host } from '../src/host.ts';
import type { PrivilegeDefinition } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;
let receiver: Server;
let receiverUrl: string;
const received: { body: string; signature: string }[] = [];

const democrats: PrivilegeDefinition = {
  name: 'Democrats',
  records: { view: false, edit: false, create: false, delete: false },
  tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false } },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
  extendedPrivileges: ['fmrest'],
};

before(async () => {
  if (skip) return;
  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ body, signature: String(req.headers['x-tabularius-signature']) });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((ok) => receiver.listen(0, '127.0.0.1', ok));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as { port: number }).port}/hook`;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-changes-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, webhooks: true });
  server = s.server;
  base = s.url;
  host = s.host;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw');
  store.savePrivilegeSet(democrats);
  store.setPassword('Dem', 'pw', 'Democrats');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  receiver?.close();
  if (dir) rmSync(dir, { recursive: true });
});

async function token(account: string): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) } });
  return (await r.json()).response.token;
}
const feed = (tok: string, query = '') =>
  fetch(`${base}/tabularius/changes/v1/databases/Charts${query}`, { headers: { authorization: `Bearer ${tok}` } }).then(async (r) => ({ status: r.status, body: await r.json() }));
const id = (where: string) => Number((host.get('Charts')!.query(`SELECT _fm_record_id AS id FROM Congress WHERE ${where} LIMIT 1`)[0] as { id: number }).id);

test('the feed lists changes after a cursor, only what the account may see, and long-polls', { skip }, async () => {
  const admin = await token('Admin');
  const dem = await token('Dem');
  assert.equal((await feed('nope', '?since=x')).status, 401);
  const start = (await feed(admin)).body.next;
  const demStart = (await feed(dem)).body.next;
  assert.match(start, /^[0-9a-f]+-\d+$/);

  const store = host.get('Charts')!;
  const d = id(`Party = 'D'`);
  const r = id(`Party = 'R'`);
  store.update('Congress', d, { State: 'ZZ' });
  store.update('Congress', r, { State: 'YY' });

  const all = await feed(admin, `?since=${start}`);
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.changes.map((c: { recordId: number; kind: string; table: string }) => [c.kind, c.table, c.recordId]), [['update', 'Congress', d], ['update', 'Congress', r]]);
  assert.ok(!('State' in all.body.changes[0]), 'no field data');

  const mine = await feed(dem, `?since=${demStart}`);
  assert.deepEqual(mine.body.changes.map((c: { recordId: number }) => c.recordId), [d], 'only records the view rule allows');

  // Nothing new: an immediate empty answer, or a long poll that wakes on the next change.
  const empty = await feed(admin, `?since=${all.body.next}`);
  assert.deepEqual(empty.body.changes, []);
  const waiting = feed(admin, `?since=${all.body.next}&wait=10`);
  setTimeout(() => store.update('Congress', d, { State: 'WW' }), 100);
  const woke = await waiting;
  assert.equal(woke.body.changes.length, 1);
  assert.equal(woke.body.changes[0].recordId, d);

  // A cursor from another run is refused with a fresh one.
  const stale = await feed(admin, '?since=deadbeef-3');
  assert.equal(stale.status, 410);
  assert.match(stale.body.next, /^[0-9a-f]+-\d+$/);
});

test('a long poll rechecks a revoked bearer token after waking', { skip }, async () => {
  const store = host.get('Charts')!;
  const raw = store.createApiToken('Admin', { label: 'waiting probe' });
  const tokenRow = store.apiTokens().find((x) => x.label === 'waiting probe')!;
  const start = (await feed(raw)).body.next;
  const waiting = feed(raw, `?since=${start}&wait=10`);
  setTimeout(() => {
    store.revokeApiToken(tokenRow.id);
    store.update('Congress', 1, { Name: 'Wake revoked poll' });
  }, 100);
  const result = await waiting;
  assert.equal(result.status, 401);
});

test('a long poll recomputes the account\'s scoped visibility after waking', { skip }, async () => {
  const dem = await token('Dem');
  const start = (await feed(dem)).body.next;
  const waiting = feed(dem, `?since=${start}&wait=1`);
  setTimeout(() => {
    host.get('Charts')!.savePrivilegeSet({ ...democrats, tables: { Congress: { view: false, edit: false, create: false, delete: false } } });
    host.get('Charts')!.update('Congress', id(`Party = 'D'`), { State: 'NO' });
  }, 100);
  const result = await waiting;
  assert.equal(result.status, 401, 'the changed authority ended the waiting session');
  const again = await feed(await token('Dem'), `?since=${start}`);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.changes, []);
  host.get('Charts')!.savePrivilegeSet(democrats);
});

test('SSE liveness drops a queued change when its durable token is revoked', { skip }, async () => {
  const store = host.get('Charts')!;
  const raw = store.createApiToken('Admin', { label: 'stream revoke probe' });
  const row = store.apiTokens().find((x) => x.label === 'stream revoke probe')!;
  const abort = new AbortController();
  const res = await fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: `Bearer ${raw}` }, signal: abort.signal });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    await reader.read();
    // Store notifications queue the SSE flush as a microtask. Revoke before
    // yielding so the flush must expire the stream and discard the batch.
    store.update('Congress', 1, { Name: 'Queued revoked-token change' });
    store.revokeApiToken(row.id);
    let text = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      text += next.value;
    }
    assert.match(text, /event: expired/);
    assert.doesNotMatch(text, /event: change/);
  } finally { abort.abort(); }
});

test('webhooks get signed batches of changes; managed from the admin console', { skip }, async () => {
  const adminCall = (path: string, method = 'GET', body?: object) => fetch(`${base}/tabularius/admin/v1/webhooks${path}`, {
    method, headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  assert.equal((await adminCall('', 'POST', { url: 'ftp://x', database: 'Charts' })).status, 400);
  assert.equal((await adminCall('', 'POST', { url: receiverUrl, database: 'Charts', tables: ['Nope'] })).status, 400);
  const made = await adminCall('', 'POST', { url: receiverUrl, database: 'Charts', tables: ['Congress'] });
  assert.equal(made.status, 201);
  const secret = made.body.secret as string;
  assert.ok(secret);
  const listed = await adminCall('');
  assert.equal(listed.body.allowed, true);
  assert.ok(!('secret' in listed.body.webhooks[0]), 'the secret is shown only once');

  received.length = 0;
  const d = id(`Party = 'D'`);
  host.get('Charts')!.update('Congress', d, { State: 'VV' });
  for (let i = 0; i < 100 && !received.length; i++) await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(received.length, 1);
  const { body, signature } = received[0];
  assert.equal(signature, 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'));
  const payload = JSON.parse(body);
  assert.equal(payload.database, 'Charts');
  assert.equal(payload.changes[0].recordId, d);
  assert.equal((await adminCall('')).body.webhooks[0].delivered, 1);

  assert.equal((await adminCall(`/${made.body.id}`, 'DELETE')).status, 200);
  assert.deepEqual((await adminCall('')).body.webhooks, []);
});

test('without --allow-webhooks, webhooks are kept but nothing is sent', { skip }, async () => {
  const feedOnly = new ChangeFeed(host, { authorize() { throw new Error('unused'); } } as never);
  const off = new Webhooks(host, feedOnly, false);
  let sent = 0;
  off.fetch = async () => {
    sent++;
    return new Response(null, { status: 204 });
  };
  off.create({ url: 'https://example.invalid/hook', database: 'Charts' });
  host.get('Charts')!.update('Congress', id(`Party = 'D'`), { State: 'UU' });
  await off.flush();
  assert.equal(sent, 0);
  assert.equal(off.list()[0].sending, false);
  off.remove(off.list()[0].id);
});

test('a long poll returns an authorization error when its account is deactivated while waiting', { skip }, async () => {
  const dem = await token('Dem');
  const cursor = (await feed(dem)).body.next as string;
  const waiting = feed(dem, `?since=${cursor}&wait=10`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  host.get('Charts')!.setAccountActive('Dem', false);
  host.get('Charts')!.update('Congress', id(`Party = 'D'`), { State: 'DE' });
  const result = await waiting;
  assert.equal(result.status, 401);
  assert.equal(result.body.messages[0].code, '952');
  assert.match(result.body.messages[0].message, /^Invalid FileMaker Data API token/);
});

test('an edit does not resurrect a webhook deleted by another store', { skip }, () => {
  const feedOnly = new ChangeFeed(host, { authorize() { throw new Error('unused'); } } as never);
  const editor = new Webhooks(host, feedOnly, false);
  const made = editor.create({ url: 'https://example.com/hook', database: 'Charts' });
  const remover = new Webhooks(host, feedOnly, false);
  deleteBeforeStateLock(join(dir, '.openhbam-webhooks.json'), () => {
    assert.equal(remover.remove(made.id), true);
  }, () => { editor.update(made.id, { enabled: false }); });
  assert.equal(editor.list().some((h) => h.id === made.id), false);
  assert.equal(new Webhooks(host, feedOnly, false).list().some((h) => h.id === made.id), false);
});
