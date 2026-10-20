// Scheduled digests: a dashboard worked out on a schedule as the account that set it up, summarised by the
// assistant (a stand-in for the Messages API here), kept with the file and shown in the app; posted to a webhook
// only when the server allows webhooks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrivilegeDefinition, Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { Dashboards } from '../src/dashboards.ts';
import { DigestRunner, Digests, describeSchedule, lastSlot, nextSlot, highlights } from '../src/digests.ts';
import { Webhooks } from '../src/changes.ts';
import type { ChangeFeed } from '../src/changes.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let model: Server;
let base: string;
let host: Host;
let store: Store;
let dashboardId: string;
const asked: { system: string; question: string; tools: string[] }[] = [];

const clerk: PrivilegeDefinition = {
  name: 'Clerk', records: { view: true, edit: false, create: false, delete: false },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
};

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const sent = JSON.parse(raw);
      const system = Array.isArray(sent.system) ? sent.system.map((b: { text: string }) => b.text).join('\n') : sent.system;
      const last = sent.messages.at(-1).content;
      asked.push({ system, question: typeof last === 'string' ? last : last.map((b: { text?: string }) => b.text ?? '').join(''), tools: sent.tools.map((t: { name: string }) => t.name) });
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ content: [{ type: 'text', text: 'Nothing overdue. 52 members in Congress.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-digests-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  host = s.host;
  store = host.get('Charts')!;
  const set = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest'] });
  store.savePrivilegeSet(clerk);
  store.setPassword('Admin', 'Admin-pw-123456');
  store.setPassword('Clerk', 'Clerk-pw-123456', 'Clerk');
  dashboardId = new Dashboards(store).create({ name: 'Members', widgets: [
    { title: 'Members', kind: 'number', layout: 'Congress' },
    { title: 'By party', kind: 'table', layout: 'Congress', groupBy: ['Party'] },
  ] }, 'Admin').id;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true });
});

async function login(account: string, password: string): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:${password}`) }, body: '{}',
  });
  return (await r.json()).response.token;
}
const call = async (token: string, method: string, path = '', body?: unknown) => {
  const r = await fetch(`${base}/tabularius/digests/v1/databases/Charts${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};

test('schedules in words, and the times they fall on', () => {
  assert.equal(describeSchedule({ days: [1], at: '08:00' }), 'Mondays at 08:00');
  assert.equal(describeSchedule({ days: [1, 2, 3, 4, 5], at: '09:30' }), 'Weekdays at 09:30');
  assert.equal(describeSchedule({ days: [0, 1, 2, 3, 4, 5, 6], at: '17:00' }), 'Every day at 17:00');
  assert.equal(describeSchedule({ days: [1, 4], at: '07:00' }), 'Mondays and Thursdays at 07:00');
  const monday9 = new Date(2026, 9, 12, 9, 0); // Monday 12 October 2026, 09:00 local
  assert.equal(lastSlot({ days: [1], at: '08:00' }, monday9)?.getTime(), new Date(2026, 9, 12, 8, 0).getTime());
  assert.equal(lastSlot({ days: [5], at: '08:00' }, monday9)?.getTime(), new Date(2026, 9, 9, 8, 0).getTime());
  assert.equal(nextSlot({ days: [1], at: '08:00' }, monday9)?.getTime(), new Date(2026, 9, 19, 8, 0).getTime());
  assert.deepEqual(highlights([{ title: 'Open', kind: 'number', layout: 'X', find: [], grouping: '', value: 1234.5 }]), ['Open: 1,234.5']);
});

test('a digest runs once at its time, as its account, with the AI summary, and is posted where it should be', { skip }, async () => {
  const digests = new Digests(store);
  const monday7 = new Date(2026, 9, 12, 7, 0);
  const d = digests.create({ name: 'Weekly members', dashboard: dashboardId, days: [1], at: '08:00', prompt: 'members by party', webhook: 'abc123', enabled: true, account: 'Admin' }, monday7);
  const runner = new DigestRunner(host);
  runner.writer = { summarize: async (_s, account, _p, ask) => ({ summary: `for ${account}: ${ask.split('\n')[0]}` }) };
  const posted: unknown[] = [];
  runner.poster = { allowed: true, post: async (id, database, payload) => { posted.push({ id, database, payload }); } };

  await runner.tick(new Date(2026, 9, 12, 7, 59));
  assert.equal(digests.runs(d.id).length, 0, 'not yet');
  await runner.tick(new Date(2026, 9, 12, 8, 1));
  await runner.tick(new Date(2026, 9, 12, 8, 2));
  const runs = digests.runs(d.id);
  assert.equal(runs.length, 1, 'once per time');
  assert.equal(runs[0].outcome, 'ok');
  assert.match(runs[0].summary!, /^for Admin: Write the scheduled digest "Weekly members" .*: members by party\.$/);
  assert.match(runs[0].highlights[0], /^Members: \d+/);
  assert.equal(runs[0].scheduled, new Date(2026, 9, 12, 8, 0).toISOString());
  assert.deepEqual(runs[0].webhook, { sent: true });
  assert.equal((posted[0] as { database: string }).database, 'Charts');

  // A time missed by hours (the server was down) is skipped, not sent late; off means off.
  await runner.tick(new Date(2026, 9, 19, 15, 0));
  assert.equal(digests.runs(d.id).length, 1);
  digests.update(d.id, { enabled: false });
  await runner.tick(new Date(2026, 9, 26, 8, 1));
  assert.equal(digests.runs(d.id).length, 1);

  // Webhooks off: kept in the app, with why it wasn't posted.
  runner.poster = { allowed: false, post: async () => { throw new Error('should not be called'); } };
  const run = await runner.run(store, digests.get(d.id)!);
  assert.equal(run.webhook?.sent, false);
  assert.match(run.webhook!.error!, /--allow-webhooks/);
  digests.delete(d.id);
});

test('over HTTP: set up from a dashboard, run by hand with the assistant\'s summary; runs only for its account or [Full Access]', { skip }, async () => {
  const admin = await login('Admin', 'Admin-pw-123456');
  const clerkToken = await login('Clerk', 'Clerk-pw-123456');
  const bad = await call(admin, 'POST', '', { dashboard: dashboardId, days: [9], at: '08:00' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error.message, /days of the week/);
  const notTheirs = await call(clerkToken, 'POST', '', { dashboard: dashboardId, days: [1], at: '08:00' });
  assert.equal(notTheirs.status, 403);
  const made = await call(admin, 'POST', '', { dashboard: 'Members', days: [1, 2, 3, 4, 5], at: '07:30', prompt: 'how many members' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const d = made.body.digest;
  assert.equal(d.name, 'Members');
  assert.equal(d.schedule, 'Weekdays at 07:30');
  assert.ok(d.next);

  const ran = await call(admin, 'POST', `/${d.id}/run`);
  assert.equal(ran.status, 200);
  assert.equal(ran.body.run.summary, 'Nothing overdue. 52 members in Congress.');
  const q = asked.at(-1)!;
  assert.match(q.system, /scheduled digest/);
  assert.match(q.question, /how many members/);
  assert.match(q.question, /"title":"Members"/);
  assert.ok(!q.tools.includes('show_records'), 'nothing to show in a window');

  const list = (await call(admin, 'GET')).body;
  assert.equal(list.digests[0].last.summary, 'Nothing overdue. 52 members in Congress.');
  assert.deepEqual(list.webhooks, []);
  // Another account sees that there is a digest, but not what it found as Admin.
  const theirs = (await call(clerkToken, 'GET')).body;
  assert.equal(theirs.digests[0].last, undefined);
  assert.equal(theirs.webhooks, undefined);
  assert.equal((await call(clerkToken, 'GET', `/${d.id}/runs`)).status, 403);

  const changed = await call(admin, 'PUT', `/${d.id}`, { at: '06:00', webhook: 'nope00000000' });
  assert.equal(changed.status, 400);
  assert.match(changed.body.error.message, /No webhook/);
  assert.equal((await call(admin, 'PUT', `/${d.id}`, { at: '06:00' })).body.digest.schedule, 'Weekdays at 06:00');
  assert.equal((await call(admin, 'DELETE', `/${d.id}`)).status, 200);
  assert.equal((await call(admin, 'GET', `/${d.id}/runs`)).status, 404);
});

test('a webhook post is signed like change deliveries and refused when webhooks are off', { skip }, async () => {
  const feed = { subscribe() {} } as unknown as ChangeFeed;
  const hooks = new Webhooks({ dir, get: (n: string) => host.get(n) } as unknown as Host, feed, true);
  const hook = hooks.create({ url: 'https://example.test/digest', database: 'Charts' });
  const sent: { url: string; init: RequestInit }[] = [];
  hooks.fetch = async (url, init) => {
    sent.push({ url: String(url), init: init! });
    return new Response('{}', { status: 200 });
  };
  await hooks.post(hook.id, 'Charts', { digest: { name: 'Members' } });
  assert.equal(sent.length, 1);
  assert.match(String((sent[0].init.headers as Record<string, string>)['x-tabularius-signature']), /^sha256=[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { webhook: hook.id, digest: { name: 'Members' } });
  await assert.rejects(hooks.post(hook.id, 'Other', {}), /for Charts/);
  const off = new Webhooks({ dir, get: (n: string) => host.get(n) } as unknown as Host, feed, false);
  await assert.rejects(off.post(hook.id, 'Charts', {}), /--allow-webhooks/);
  hooks.remove(hook.id);
});
