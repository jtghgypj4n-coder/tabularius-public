import { deleteBeforeStateLock } from './state-lock-race.ts';
// Inbound hooks: a signed JSON call runs a chosen script with the payload as its parameter. Unsigned, stale,
// replayed, oversized and over-the-limit calls are refused; the admin console lists calls but never their bodies;
// the secret is shown once; a server not started with --allow-inbound-hooks answers none; a capture-only file
// never has one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { setCaptureOnlyDefaults } from '../../scripts/src/index.ts';
import { clusterRoute, serve, type Host } from '../src/index.ts';
import { hookSignature, MAX_BODY } from '../src/inbound-hooks.ts';

// No file is capture-only by default; this test names the ones it holds back.
setCaptureOnlyDefaults(['Held']);

let dir: string;
let server: Server;
let base: string;
let host: Host;

const SCRIPT = [
  'Set Variable [ $p ; Value: Get ( ScriptParameter ) ]',
  'Go to Layout [ "Orders" ]',
  'New Record/Request',
  'Set Field [ Orders::Ref ; JSONGetElement ( $p ; "order.ref" ) ]',
  'Set Field [ Orders::Amount ; JSONGetElement ( $p ; "order.amount" ) ]',
  'Commit Records/Requests [ With dialog: Off ]',
  'Exit Script [ Text Result: "saved " & Orders::Ref ]',
].join('\n');

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-inbound-hooks-'));
  const s = await serve({ dir, port: 0, log: () => {}, inboundHooks: true });
  server = s.server;
  base = s.url;
  host = s.host;
  for (const name of ['Shop', 'Held_Sample']) {
    const store = host.create(name);
    store.applyDesign([
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Ref' }, { name: 'Amount', type: 'number' }] },
      { op: 'createScript', name: 'Take order', text: SCRIPT },
    ]);
    store.setPassword('Admin', 'pw');
  }
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const admin = (path: string, method = 'GET', body?: object) => fetch(`${base}/tabularius/admin/v1/inbound-hooks${path}`, {
  method, headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const send = (path: string, secret: string, body: string, opts: { at?: number; signature?: string } = {}) => {
  const at = String(opts.at ?? Math.floor(Date.now() / 1000));
  return fetch(`${base}${path}`, {
    method: 'POST', body,
    headers: { 'content-type': 'application/json', 'x-tabularius-timestamp': at, 'x-tabularius-signature': opts.signature ?? hookSignature(secret, at, body) },
  }).then(async (r) => ({ status: r.status, body: await r.json() as Record<string, unknown> }));
};
const orders = () => (host.get('Shop')!.query('SELECT Ref, Amount FROM Orders ORDER BY _fm_record_id') as { Ref: string; Amount: number }[]).map((r) => ({ ...r }));

test('signed hook rejects deeply nested JSON before stringifying or running its script', async () => {
  const made = await admin('', 'POST', { name: 'Depth', database: 'Shop', script: 'Take order', account: 'Admin' });
  assert.equal(made.status, 201);
  const { secret, path } = made.body as { secret: string; path: string };
  const before = orders().length;
  const deep = '['.repeat(64) + '0' + ']'.repeat(64);
  const response = await send(path, secret, `{"order":${deep}}`);
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'The body is not JSON' });
  assert.equal(orders().length, before);
  assert.equal((await admin('/' + (made.body as { id: string }).id, 'DELETE')).status, 200);
});

test('a signed call runs the script with its JSON; anything else is refused and runs nothing', async () => {
  // Checked against the file; a capture-only file never has one.
  assert.equal((await admin('', 'POST', { name: 'x', database: 'Shop', script: 'Nope', account: 'Admin' })).status, 400);
  assert.equal((await admin('', 'POST', { name: 'x', database: 'Shop', script: 'Take order', account: 'Nobody' })).status, 400);
  const heldFile = await admin('', 'POST', { name: 'x', database: 'Held_Sample', script: 'Take order', account: 'Admin' });
  assert.equal(heldFile.status, 400);
  assert.match(heldFile.body.error, /capture-only/);

  const made = await admin('', 'POST', { name: 'Payments', database: 'Shop', script: 'Take order', account: 'Admin', layout: 'Orders', perMinute: 5 });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const { secret, path, id } = made.body as { secret: string; path: string; id: string };
  assert.ok(secret.length >= 40);
  // The secret is never listed again.
  const listed = await admin('');
  assert.equal(listed.body.allowed, true);
  assert.ok(!JSON.stringify(listed.body).includes(secret));

  const body = JSON.stringify({ order: { ref: 'A-1', amount: 12.5 } });
  // The replay below must send the same timestamp: a second ticking over between the two would make it a new call.
  const at = Math.floor(Date.now() / 1000);
  const ok = await send(path, secret, body, { at });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { ok: true, result: 'saved A-1' });
  assert.deepEqual(orders(), [{ Ref: 'A-1', Amount: 12.5 }]);
  // The admin console's script queue names it as a hook run.
  assert.equal(host.scriptOptions().serverQueue.list().recent.find((j) => j.script === 'Take order')?.kind, 'hook');

  // The same call again (captured and replayed), a wrong secret, an old timestamp, no signature, not JSON.
  assert.equal((await send(path, secret, body, { at })).status, 409);
  assert.equal((await send(path, 'not-the-secret', JSON.stringify({ order: { ref: 'B' } }))).status, 401);
  assert.equal((await send(path, secret, JSON.stringify({ order: { ref: 'C' } }), { at: Math.floor(Date.now() / 1000) - 600 })).status, 401);
  assert.equal((await send(path, secret, JSON.stringify({ order: { ref: 'D' } }), { signature: '' })).status, 401);
  assert.equal((await send(path, secret, 'order=E')).status, 400);
  // Too big: refused before anything runs.
  assert.equal((await send(path, secret, JSON.stringify({ pad: 'x'.repeat(MAX_BODY) }))).status, 413);
  // Far too big: still answered 413 (the connection is not torn down mid-body), and the server carries on.
  assert.equal((await send(path, secret, 'x'.repeat(20 * 1024 * 1024))).status, 413);
  // An unknown hook looks the same as a turned-off one.
  assert.equal((await send('/tabularius/hooks/v1/0123456789abcdef01', secret, body)).status, 404);
  assert.equal(orders().length, 1);

  // Calls are listed with their outcome, never their bodies.
  const calls = (await admin('')).body.hooks[0].calls as { status: number; outcome: string }[];
  assert.deepEqual(calls.map((c) => c.status), [413, 413, 400, 401, 401, 401, 409, 200]);
  assert.deepEqual(calls.map((c) => c.outcome), ['refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'ok']);
  const log = readFileSync(join(dir, 'inbound-hook-calls.jsonl'), 'utf8');
  assert.ok(!log.includes('A-1') && !log.includes(secret));

  // Its own limit: 5 calls a minute (two have been answered so far).
  for (let i = 0; i < 3; i++) assert.equal((await send(path, secret, JSON.stringify({ order: { ref: `L${i}` } }))).status, 200);
  assert.equal((await send(path, secret, JSON.stringify({ order: { ref: 'over' } }))).status, 429);

  // A new secret: the old one stops working. Turned off: 404.
  const fresh = await admin(`/${id}/secret`, 'POST');
  assert.equal((await send(path, secret, JSON.stringify({ n: 1 }))).status, 401);
  await admin(`/${id}`, 'PATCH', { enabled: false });
  assert.equal((await send(path, fresh.body.secret, JSON.stringify({ n: 2 }))).status, 404);
  assert.equal((await admin(`/${id}`, 'DELETE')).status, 200);
});

test('an address sending bad calls is slowed down, but never shuts out a correctly signed call', async () => {
  const made = await admin('', 'POST', { name: 'Flood', database: 'Shop', script: 'Take order', account: 'Admin', perMinute: 100 });
  const { secret, path, id } = made.body as { secret: string; path: string; id: string };
  let last = 0;
  for (let i = 0; i < 25; i++) last = (await send('/tabularius/hooks/v1/ffffffffffffffffff', 's', '{}')).status;
  assert.equal(last, 429);
  // Junk to unknown ids from the same address (every caller behind one proxy) doesn't block a real hook.
  assert.equal((await send(path, secret, JSON.stringify({ order: { ref: 'F1' } }))).status, 200);
  // Nor does junk sent to the hook itself: wrong signatures are slowed down, the signed call still runs.
  for (let i = 0; i < 25; i++) last = (await send(path, 'wrong', JSON.stringify({ n: i }))).status;
  assert.equal(last, 429);
  assert.equal((await send(path, secret, JSON.stringify({ order: { ref: 'F2' } }))).status, 200);
  // Refusals over the limit aren't logged, so the flood doesn't push real calls out of the list.
  const calls = ((await admin('')).body.hooks as { id: string; calls: { status: number }[] }[]).find((h) => h.id === id)!.calls;
  assert.equal(calls[0].status, 200);
  assert.ok(!calls.some((c) => c.status === 429));
  await admin(`/${id}`, 'DELETE');
});

test('with several workers every hook call goes to one process, so a replay is refused and the limits hold', () => {
  const req = (url: string, headers: Record<string, string> = {}) => ({ url, method: 'POST', headers } as unknown as IncomingMessage);
  for (const workers of [2, 4, 10]) assert.equal(clusterRoute(req('/tabularius/hooks/v1/0123456789abcdef01'), workers), 0);
});

test('a hook running as a Full Access account is flagged; the add form suggests none', async () => {
  const made = await admin('', 'POST', { name: 'Full', database: 'Shop', script: 'Take order', account: 'Admin' });
  const { id } = made.body as { id: string };
  const hook = ((await admin('')).body.hooks as { id: string; fullAccess: boolean }[]).find((h) => h.id === id)!;
  assert.equal(hook.fullAccess, true);
  await admin(`/${id}`, 'DELETE');
  const html = readFileSync(join(import.meta.dirname, '..', 'admin', 'index.html'), 'utf8');
  const form = html.slice(html.indexOf('id="add-hook"'), html.indexOf('</form>', html.indexOf('id="add-hook"')));
  assert.doesNotMatch(form, /name="account"[^>]*value=/);
});

test('a server started without --allow-inbound-hooks answers no calls', async () => {
  const d = mkdtempSync(join(tmpdir(), 'tabularius-inbound-off-'));
  const s = await serve({ dir: d, port: 0, log: () => {} });
  try {
    const store = s.host.create('Shop');
    store.applyDesign([{ op: 'createTable', name: 'Orders', fields: [{ name: 'Ref' }] }, { op: 'createScript', name: 'Take order', text: 'Exit Script [ Text Result: 1 ]' }]);
    store.setPassword('Admin', 'pw');
    const made = await fetch(`${s.url}/tabularius/admin/v1/inbound-hooks`, {
      method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', database: 'Shop', script: 'Take order', account: 'Admin' }),
    }).then((r) => r.json()) as { secret: string; path: string };
    const at = String(Math.floor(Date.now() / 1000));
    const r = await fetch(`${s.url}${made.path}`, { method: 'POST', body: '{}', headers: { 'x-tabularius-timestamp': at, 'x-tabularius-signature': hookSignature(made.secret, at, '{}') } });
    assert.equal(r.status, 404);
  } finally {
    s.server.close();
    rmSync(d, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('a flood of bad calls keeps only the last few per address, not one entry per call', async () => {
  const { createServer } = await import('node:http');
  const { InboundHooks } = await import('../src/inbound-hooks.ts');
  const hooks = new InboundHooks(host, true);
  const s = createServer((req, res) => void hooks.handle(req, res, new URL(req.url!, 'http://x')).then((done) => { if (!done) res.end(); }));
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  try {
    const port = (s.address() as { port: number }).port;
    for (let i = 0; i < 120; i++) await fetch(`http://127.0.0.1:${port}/tabularius/hooks/v1/ffffffffffffffffff`, { method: 'POST', body: '{}' });
    const lists = [...(hooks as unknown as { bad: Map<string, number[]> }).bad.values()];
    assert.ok(lists.length >= 1);
    assert.ok(lists.every((l) => l.length <= 20), `kept ${Math.max(...lists.map((l) => l.length))}`);
    assert.equal((await fetch(`http://127.0.0.1:${port}/tabularius/hooks/v1/ffffffffffffffffff`, { method: 'POST', body: '{}' })).status, 429);
  } finally {
    await new Promise<void>((r) => s.close(() => r()));
  }
});

test('an edit does not resurrect an inbound hook deleted by another store', async () => {
  const { InboundHooks } = await import('../src/inbound-hooks.ts');
  const editor = new InboundHooks(host, true);
  const made = editor.create({ name: 'Delete race', database: 'Shop', script: 'Take order', account: 'Admin' });
  const remover = new InboundHooks(host, true);
  deleteBeforeStateLock(join(dir, 'inbound-hooks.json'), () => {
    assert.equal(remover.remove(made.id), true);
  }, () => { editor.update(made.id, { name: 'late edit' }); });
  assert.equal(editor.list().some((h) => h.id === made.id), false);
  assert.equal(new InboundHooks(host, true).list().some((h) => h.id === made.id), false);
});
