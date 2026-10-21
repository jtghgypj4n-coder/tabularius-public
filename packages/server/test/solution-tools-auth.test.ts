import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Host } from '../src/host.ts';
import { DigestApi, DigestRunner, Digests } from '../src/digests.ts';
import { Dashboards, computeDashboard } from '../src/dashboards.ts';
import type { DataApi, Session } from '../src/dataapi.ts';
import { AutomationRunner, automationRuns, saveAutomation } from '../src/automations.ts';
import { InboundHooks, hookSignature, MAX_REPLAY_CLAIMS } from '../src/inbound-hooks.ts';
import { ScriptQueue } from '../src/server-queue.ts';

async function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-solution-auth-'));
  const host = new Host(dir, () => {});
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const store = host.create('Public');
  store.setPassword('Admin', 'test-password', '[Full Access]');
  store.setPassword('Reviewer', 'test-password', '[Full Access]');
  const full = store.privilegeSets().find((p) => p.name === '[Full Access]')!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest', 'fmmcp'] });
  const session = { account: 'Reviewer', client: 'rest' } as Session;
  const api = { authorize: () => session } as unknown as DataApi;
  return { host, store, api, dir };
}

async function request(handler: { handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> }, path: string, method = 'GET', body?: string, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]) as IncomingMessage;
  Object.assign(req, { method, headers, socket: { remoteAddress: '127.0.0.1' } });
  let status = 0;
  let text = '';
  const res = { writeHead: (n: number) => { status = n; }, end: (s: string) => { text = s; } } as unknown as ServerResponse;
  assert.equal(await handler.handle(req, res, new URL(path, 'http://localhost')), true);
  return { status, text, body: JSON.parse(text) };
}

test('AR-server-solution-tools-03', async (t) => {
  const { host, store, api } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Amounts', fields: [{ name: 'Amount', type: 'number' }] }]);
  store.create('Amounts', { Amount: 12345 });
  const board = new Dashboards(store).create({ name: 'Totals', widgets: [{ title: 'Total', kind: 'number', layout: 'Amounts', measure: { field: 'Amount', fn: 'sum' } }] }, 'Reviewer');
  const digests = new Digests(store);
  const d = digests.create({ name: 'Weekly', dashboard: board.id, account: 'Reviewer', enabled: true, days: [1], at: '08:00' });
  const runner = new DigestRunner(host);
  runner.writer = { summarize: async () => ({ summary: 'total=12345' }) };
  const run = await runner.run(store, d);
  assert.equal(run.data[0].value, 12345);
  const handler = new DigestApi(host, api, runner);
  const paths = ['', `/${d.id}`, `/${d.id}/runs`];
  for (const p of paths) assert.ok((await request(handler, '/tabularius/digests/v1/databases/Public' + p)).text.includes('12345'));
  store.savePrivilegeSet({ name: 'Restricted', records: { view: false, edit: false, create: false, delete: false }, layouts: 'viewOnly', scripts: 'none', valueLists: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('Reviewer', 'test-password', 'Restricted');
  assert.ok(computeDashboard(store, board.widgets, store.privileges('Reviewer'))[0].error);
  for (const p of paths) assert.ok(!(await request(handler, '/tabularius/digests/v1/databases/Public' + p)).text.includes('12345'), p);
});

test('AR-server-solution-tools-04', async (t) => {
  const { host } = await setup(t);
  host.get('Public')!.applyDesign([{ op: 'createScript', name: 'Ack', text: 'Exit Script [ Text Result: "ok" ]' }]);
  const hooks = new InboundHooks(host, true);
  const h = hooks.create({ name: 'Receiver', database: 'Public', script: 'Ack', account: 'Reviewer' });
  const stamp = String(Math.floor(Date.now() / 1000));
  const body = '{}';
  const headers = { 'x-tabularius-timestamp': stamp, 'x-tabularius-signature': hookSignature(h.secret, stamp, body) };
  const send = (instance: InboundHooks) => request(instance, h.path, 'POST', body, headers);
  assert.equal((await send(hooks)).status, 200);
  assert.equal((await send(hooks)).status, 409);
  assert.equal((await send(new InboundHooks(host, true))).status, 409);
});

for (const queued of [false, true]) test(`AR-server-solution-tools-05 ${queued ? 'queued' : 'new'}`, async (t) => {
  const { host, store } = await setup(t);
  store.applyDesign([
    { op: 'createTable', name: 'Work', fields: [{ name: 'Done' }] },
    { op: 'createScript', name: 'Finish', text: 'Set Field [ Work::Done ; "yes" ]\nCommit Records/Requests [ With dialog: Off ]' },
  ]);
  store.setPassword('Worker', 'test-password', '[Full Access]');
  const id = store.accountIdentityId('Worker');
  const spec = { name: 'On create', layout: 'Work', on: 'create', script: 'Finish', account: 'Worker' };
  const a = saveAutomation(store, spec, 'Reviewer', []).automation;
  const queue = new ScriptQueue(1);
  const options = host.scriptOptions();
  host.scriptOptions = () => ({ ...options, serverQueue: queue });
  const runner = new AutomationRunner(host);
  let release!: () => void;
  const blocker = queued ? queue.run(() => new Promise<void>((resolve) => { release = resolve; })) : undefined;
  t.after(() => release?.());
  const replace = () => { store.deleteAccount('Worker'); store.setPassword('Worker', 'test-password', '[Full Access]'); assert.notEqual(store.accountIdentityId('Worker'), id); };
  if (!queued) replace();
  const recordId = store.create('Work', {}).recordId;
  if (queued) {
    for (let i = 0; i < 30 && queue.queued === 0; i++) await Promise.resolve();
    assert.equal(queue.queued, 1);
    replace();
    release();
    await blocker;
  }
  await runner.idle(store);
  assert.notEqual(store.select('SELECT Done FROM Work WHERE _fm_record_id = ?', [recordId]).rows[0][0], 'yes');
  assert.ok(automationRuns(store, a.id).every((r) => r.outcome !== 'ok'));
  saveAutomation(store, spec, 'Reviewer', [], undefined, a.id);
  const rebound = store.create('Work', {}).recordId;
  await runner.idle(store);
  assert.equal(store.select('SELECT Done FROM Work WHERE _fm_record_id = ?', [rebound]).rows[0][0], 'yes');
});

for (const change of ['field', 'same-set', 'identity', 'external', 'legacy', 'dynamic'] as const) test(`AR-server-solution-tools-03 ${change}`, async (t) => {
  const { host, store, api } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Amounts', fields: [{ name: 'Amount', type: 'number' }] }]);
  store.create('Amounts', { Amount: 12345 });
  const allowed = { name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly' as const,
    scripts: 'none' as const, valueLists: 'none' as const, extendedPrivileges: ['fmrest'] };
  store.savePrivilegeSet(allowed);
  if (change !== 'identity') store.setPassword('Reviewer', 'test-password', 'Reader');
  const external = change === 'external' ? host.create('External') : undefined;
  external?.setPassword('Admin', 'test-password', '[Full Access]');
  external?.setPassword('Reviewer', 'test-password', '[Full Access]');
  const board = new Dashboards(store).create({ name: 'Totals', widgets: [{ title: 'Total', kind: 'number', layout: 'Amounts', measure: { field: 'Amount', fn: 'sum' } }] }, 'Reviewer');
  const digests = new Digests(store);
  const d = digests.create({ name: 'Weekly', dashboard: board.id, account: 'Reviewer', enabled: true, days: [1], at: '08:00' });
  const runner = new DigestRunner(host);
  const run = await runner.run(store, d);
  assert.equal(run.data[0].value, 12345);
  assert.equal(runner.runs(store, d).length, 1);
  if (change === 'field') store.savePrivilegeSet({ ...allowed, tables: { Amounts: { ...allowed.records, fields: { Amount: 'none' } } } });
  if (change === 'same-set') store.savePrivilegeSet({ ...allowed, records: { ...allowed.records, view: false } });
  if (change === 'identity') { store.deleteAccount('Reviewer'); store.setPassword('Reviewer', 'test-password', '[Full Access]'); }
  if (change === 'external') external!.deleteAccount('Reviewer');
  if (change === 'legacy') {
    const { authorization: _a, ...legacy } = run;
    store.sql.prepare('UPDATE _fm_digest_runs SET spec = ? WHERE id = ?').run(JSON.stringify(legacy), run.id);
  }
  if (change === 'dynamic') {
    store.savePrivilegeSet({ ...allowed, records: { ...allowed.records, view: 'Amount > 0' } });
    await runner.run(store, d);
  }
  const handler = new DigestApi(host, api, runner);
  for (const suffix of ['', `/${d.id}`, `/${d.id}/runs`]) {
    const response = await request(handler, '/tabularius/digests/v1/databases/Public' + suffix);
    assert.ok(!response.text.includes('12345'), suffix);
  }
  assert.ok(!JSON.stringify(runner.all()).includes('12345'));
});

test('AR-server-solution-tools-03 pending summary', async (t) => {
  const { host, store } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Amounts', fields: [{ name: 'Amount', type: 'number' }] }]);
  store.create('Amounts', { Amount: 12345 });
  const board = new Dashboards(store).create({ name: 'Totals', widgets: [{ title: 'Total', kind: 'number', layout: 'Amounts', measure: { field: 'Amount', fn: 'sum' } }] }, 'Reviewer');
  const digests = new Digests(store);
  const d = digests.create({ name: 'Weekly', dashboard: board.id, account: 'Reviewer', enabled: true, days: [1], at: '08:00', webhook: 'test' });
  const runner = new DigestRunner(host);
  let posted = '';
  runner.poster = { allowed: true, post: async (_id, _db, payload) => { posted = JSON.stringify(payload); } };
  runner.writer = { summarize: async () => {
    store.deleteAccount('Reviewer');
    return { summary: '12345' };
  } };
  const run = await runner.run(store, d);
  assert.equal(run.outcome, 'error');
  assert.ok(!JSON.stringify(run).includes('12345'));
  // The failure may be reported to the webhook, but never with the data or the summary the revoked account saw.
  assert.ok(!posted.includes('12345'));
});

test('AR-server-solution-tools-03 schedule and retention', async (t) => {
  const { host, store } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Amounts' }]);
  const board = new Dashboards(store).create({ name: 'Count', widgets: [{ title: 'Count', kind: 'number', layout: 'Amounts' }] }, 'Reviewer');
  const digests = new Digests(store);
  const d = digests.create({ name: 'Weekly', dashboard: board.id, account: 'Reviewer', enabled: true, days: [1], at: '08:00' }, new Date(2026, 9, 12, 7));
  const runner = new DigestRunner(host);
  await runner.tick(new Date(2026, 9, 12, 8));
  assert.equal(runner.runs(store, d).length, 1);
  digests.update(d.id, { days: [1, 2], at: '09:00' }, new Date(2026, 9, 12, 8, 30));
  await runner.tick(new Date(2026, 9, 12, 8, 45));
  assert.equal(runner.runs(store, d).length, 1);
  await runner.tick(new Date(2026, 9, 12, 9));
  await runner.tick(new Date(2026, 9, 12, 9));
  assert.equal(runner.runs(store, d).length, 2);
  for (let i = 0; i < 25; i++) await runner.run(store, digests.get(d.id)!);
  assert.equal(digests.runs(d.id, 100).length, 20);
  assert.equal(new DigestRunner(host).runs(store, d).length, 20);
});

test('AR-server-solution-tools-04 processes', async (t) => {
  const { host, store, dir } = await setup(t);
  store.applyDesign([{ op: 'createScript', name: 'Ack', text: 'Exit Script [ Text Result: "ok" ]' }]);
  const h = new InboundHooks(host, true).create({ name: 'Receiver', database: 'Public', script: 'Ack', account: 'Reviewer' });
  const input = { dir, path: h.path, secret: h.secret, stamp: String(Math.floor(Date.now() / 1000)), body: '{}' };
  const child = () => new Promise<number>((resolve, reject) => {
    const p = execFile(process.execPath, [fileURLToPath(new URL('./helpers/inbound-replay-child.ts', import.meta.url))],
      { timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`child failed: ${error.message}\n${stderr}`)); else resolve(Number(stdout));
      });
    p.stdin!.end(JSON.stringify(input));
  });
  assert.deepEqual((await Promise.all([child(), child()])).sort(), [200, 409]);
  assert.equal(await child(), 409);
});

test('AR-server-solution-tools-04 expiry and capacity', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-19T12:00:00Z') });
  const { host, store, dir } = await setup(t);
  store.applyDesign([{ op: 'createScript', name: 'Ack', text: 'Exit Script [ Text Result: "ok" ]' }]);
  const hooks = new InboundHooks(host, true);
  const h = hooks.create({ name: 'Receiver', database: 'Public', script: 'Ack', account: 'Reviewer' });
  const start = Date.now();
  const stamp = String(start / 1000 + 300);
  const send = (stamp: string, body = '{}') => request(new InboundHooks(host, true), h.path, 'POST', body,
    { 'x-tabularius-timestamp': stamp, 'x-tabularius-signature': hookSignature(h.secret, stamp, body) });
  assert.equal((await send(stamp)).status, 200);
  t.mock.timers.setTime(start + 600_000);
  assert.equal((await send(stamp)).status, 409);
  t.mock.timers.setTime(start + 600_001);
  assert.equal((await send(stamp)).status, 401);
  const nowStamp = String(Math.floor(Date.now() / 1000));
  assert.equal((await send(nowStamp)).status, 200);
  const db = new DatabaseSync(join(dir, 'inbound-hook-replays.sqlite'));
  t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get()!.n, 1);
  t.mock.timers.setTime(start);
  assert.equal((await send(stamp)).status, 401);
  t.mock.timers.setTime(start + 600_001);
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ${MAX_REPLAY_CLAIMS - 1})
    INSERT INTO claims SELECT 'seed', CAST(i AS TEXT), ${start + 900_000} FROM n`);
  assert.equal((await send(nowStamp, '{"new":1}')).status, 503);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get()!.n, MAX_REPLAY_CLAIMS);
  assert.equal((await send(nowStamp)).status, 409);
  t.mock.timers.setTime(start + 900_001);
  assert.equal((await send(String(Math.floor(Date.now() / 1000)), '{"new":1}')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get()!.n, 1);
});

for (const event of ['create', 'update', 'delete'] as const) test(`AR-server-solution-tools-05 legacy ${event}`, async (t) => {
  const { host, store } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Work', fields: [{ name: 'Done' }] },
    { op: 'createScript', name: 'Finish', text: 'Exit Script [ Text Result: "ok" ]' }]);
  const a = saveAutomation(store, { name: 'Event', layout: 'Work', on: event, script: 'Finish', account: 'Reviewer' }, 'Reviewer', []).automation;
  const { accountId: _id, ...legacy } = a;
  store.sql.prepare('UPDATE _fm_automations SET json = ? WHERE id = ?').run(JSON.stringify(legacy), a.id);
  const record = store.create('Work', {}).recordId;
  const runner = new AutomationRunner(host);
  if (event === 'create') store.create('Work', {});
  if (event === 'update') store.update('Work', record, { Done: 'changed' });
  if (event === 'delete') store.delete('Work', record);
  await runner.idle(store);
  assert.deepEqual(automationRuns(store, a.id), []);
});

test('AR-server-solution-tools-03 independent data and summary', async (t) => {
  const { host, store } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Amounts', fields: [{ name: 'Amount', type: 'number' }] }]);
  store.create('Amounts', { Amount: 12345 });
  const other = host.create('Other');
  other.savePrivilegeSet({ name: 'Conditional', records: { view: '1', edit: false, create: false, delete: false },
    layouts: 'viewOnly', scripts: 'none', valueLists: 'none', extendedPrivileges: ['fmrest'] });
  other.setPassword('Reviewer', 'test-password', 'Conditional');
  const board = new Dashboards(store).create({ name: 'Totals', widgets: [{ title: 'Total', kind: 'number', layout: 'Amounts', measure: { field: 'Amount', fn: 'sum' } }] }, 'Reviewer');
  const d = new Digests(store).create({ name: 'Weekly', dashboard: board.id, account: 'Reviewer', enabled: true, days: [1], at: '08:00' });
  const runner = new DigestRunner(host);
  runner.writer = { summarize: async () => ({ summary: 'other-file-result' }) };
  await runner.run(store, d);
  const kept = runner.runs(store, d);
  assert.equal(kept[0].data[0].value, 12345);
  assert.ok(!JSON.stringify(kept).includes('other-file-result'));
});

test('AR-server-solution-tools-04 unavailable ledger', async (t) => {
  const { host, store, dir } = await setup(t);
  store.applyDesign([{ op: 'createScript', name: 'Ack', text: 'Exit Script [ Text Result: "ok" ]' }]);
  const hooks = new InboundHooks(host, true);
  const h = hooks.create({ name: 'Receiver', database: 'Public', script: 'Ack', account: 'Reviewer' });
  writeFileSync(join(dir, 'inbound-hook-replays.sqlite'), 'not a database');
  const stamp = String(Math.floor(Date.now() / 1000));
  const response = await request(hooks, h.path, 'POST', '{}', {
    'x-tabularius-timestamp': stamp, 'x-tabularius-signature': hookSignature(h.secret, stamp, '{}'),
  });
  assert.equal(response.status, 503);
  assert.equal(host.scriptOptions().serverQueue.list().recent.length, 0);
});

for (const change of ['same-file schema', 'other-file schema', 'new hosted file'] as const) test(`AR-server-solution-tools-03 history survives ${change}`, async (t) => {
  const { host, store, api } = await setup(t);
  store.applyDesign([{ op: 'createTable', name: 'Amounts', fields: [{ name: 'Amount', type: 'number' }] }]);
  const record = store.create('Amounts', { Amount: 12345 });
  const other = host.create('Other');
  other.setPassword('Admin', 'test-password', '[Full Access]');
  other.setPassword('Reviewer', 'test-password', '[Full Access]');
  const board = new Dashboards(store).create({ name: 'Totals', widgets: [
    { title: 'Total', kind: 'number', layout: 'Amounts', measure: { field: 'Amount', fn: 'sum' } },
  ] }, 'Reviewer');
  const d = new Digests(store).create({ name: 'Weekly', dashboard: board.id, account: 'Reviewer', enabled: true, days: [1], at: '08:00' });
  const runner = new DigestRunner(host);
  runner.writer = { summarize: async () => ({ summary: 'Historical total=12345' }) };
  const run = await runner.run(store, d);
  assert.equal(run.outcome, 'ok');
  assert.equal(runner.runs(store, d)[0].id, run.id);
  store.update('Amounts', record.recordId, { Amount: 67890 });
  assert.equal(runner.runs(store, d)[0].data[0].value, 12345);

  if (change === 'same-file schema') store.applyDesign([{ op: 'createTable', name: 'Unrelated' }]);
  if (change === 'other-file schema') other.applyDesign([{ op: 'createTable', name: 'Unrelated' }]);
  if (change === 'new hosted file') {
    const added = host.create('NewFile');
    added.savePrivilegeSet({ name: 'Conditional', records: { view: '1', edit: false, create: false, delete: false },
      layouts: 'viewOnly', scripts: 'none', valueLists: 'none', extendedPrivileges: ['fmrest'] });
    added.setPassword('Reviewer', 'test-password', 'Conditional');
  }

  // A fresh runner must validate the persisted snapshot, including the summary's original file scope.
  const restarted = new DigestRunner(host);
  const kept = restarted.runs(store, d);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, run.id);
  assert.equal(kept[0].data[0].value, 12345);
  assert.equal(kept[0].summary, 'Historical total=12345');
  assert.equal(kept[0].authorization, undefined, 'internal file scope is not exposed to clients');
  const handler = new DigestApi(host, api, restarted);
  for (const suffix of ['', `/${d.id}`, `/${d.id}/runs`]) {
    const response = await request(handler, '/tabularius/digests/v1/databases/Public' + suffix);
    assert.equal(response.status, 200);
    assert.ok(response.text.includes('Historical total=12345'), suffix);
    assert.ok(!response.text.includes('"authorization"'), suffix);
  }
  assert.ok(JSON.stringify(restarted.all()).includes('Historical total=12345'));
  // Narrowing the historical scope must still notice a revoked file from the original snapshot.
  other.deleteAccount('Reviewer');
  assert.deepEqual(restarted.runs(store, d), []);
});
