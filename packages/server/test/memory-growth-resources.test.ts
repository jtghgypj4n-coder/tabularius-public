import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { Readable } from 'node:stream';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Host } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';
import { Admin } from '../src/admin.ts';
import { Live } from '../src/live.ts';
import { ChangeFeed } from '../src/changes.ts';
import { Replication } from '../src/replication.ts';
import { LogShipper } from '../src/logs.ts';
import { InboundHooks, hookSignature } from '../src/inbound-hooks.ts';
import { Uploads } from '../src/uploads.ts';
import { ContainerFiles } from '../src/containers.ts';
import { DebugApi } from '../src/debug.ts';
import { ODataEndpoint } from '../src/odata.ts';
import { Schedules } from '../src/schedules.ts';
import { PgServer } from '../src/pgwire.ts';
import { ClusterLink } from '../src/cluster.ts';
import { WebClient } from '../src/webclient.ts';
import { backupFolder, backupRunning, BackupStopped, stopBackups } from '../src/backup.ts';
import { Standby } from '../src/standby.ts';

const inside = (value: unknown): Record<string, any> => value as Record<string, any>;
function hostFor(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-growth-resources-'));
  const host = new Host(dir);
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  return host;
}
class Reply extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  writableFinished = false;
  destroyed = false;
  writableLength = 0;
  body = '';
  headers: Record<string, unknown> = {};
  setHeader(key: string, value: unknown) { this.headers[key] = value; return this; }
  getHeader(key: string) { return this.headers[key]; }
  writeHead(status: number, headers: Record<string, unknown> = {}) { this.statusCode = status; this.headersSent = true; Object.assign(this.headers, headers); return this; }
  write(body: string | Buffer) { this.body += body.toString(); return true; }
  end(body = '') { this.write(body); this.writableEnded = this.writableFinished = true; this.emit('finish'); this.emit('close'); return this; }
  destroy() { this.destroyed = true; this.emit('close'); return this; }
}
function req(body = '', headers: Record<string, string> = {}, address = '192.0.2.1') {
  const r = Readable.from(body ? [Buffer.from(body)] : []);
  return Object.assign(r, { method: body ? 'POST' : 'GET', headers, socket: { remoteAddress: address }, url: '/' }) as unknown as IncomingMessage;
}
const response = (r: Reply) => r as unknown as ServerResponse;

test('console cookie churn evicts the oldest sign-in', async (t) => {
  const host = hostFor(t);
  const admin = new Admin(host, new DataApi(host));
  t.mock.method(inside(admin), 'passwordHash', () => 'hash');
  t.mock.method(inside(admin), 'tryPassword', () => null);
  for (let i = 0; i < 1024; i++) inside(admin).signedIn.set(String(i), performance.now() + 60_000);
  const r = new Reply();
  await admin.handle(req('{"password":"pw"}', { 'x-tabularius-admin': '1' }), response(r), new URL('http://localhost/tabularius/admin/v1/sign-in'));
  assert.equal(r.statusCode, 200);
  assert.equal(inside(admin).signedIn.size, 1024);
  assert.equal(inside(admin).signedIn.has('0'), false);
});

test('webhook replay markers fail closed at capacity and keep prior signatures', async (t) => {
  const hooks = new InboundHooks(hostFor(t), true);
  t.mock.method(inside(hooks), 'load', () => {});
  inside(hooks).hooks = [{ id: 'hook', secret: 'secret', enabled: true, perMinute: 1, database: 'Growth', account: 'Admin' }];
  inside(hooks).recent.set('hook', [performance.now()]);
  const seen = inside(hooks).seen as Map<string, number>;
  for (let i = 0; i < 10_000; i++) seen.set(String(i), performance.now());
  const stamp = String(Math.floor(Date.now() / 1000));
  const r = new Reply();
  await hooks.handle(req('{}', { 'x-tabularius-timestamp': stamp, 'x-tabularius-signature': hookSignature('secret', stamp, Buffer.from('{}')) }), response(r), new URL('http://localhost/tabularius/hooks/v1/hook'));
  assert.equal(r.statusCode, 429);
  assert.equal(seen.size, 10_000);
  assert.ok(seen.has('0'));
});

test('SSE streams have a total cap and session end removes listeners immediately', (t) => {
  const host = hostFor(t);
  const store = host.create('Growth');
  const api = new DataApi(host);
  api.maxSessionsPerAccount = 0;
  const live = new Live(host, api);
  t.after(() => live.closeAll());
  const before = store.listeners.size;
  let first!: Reply;
  let firstToken = '';
  let rejected!: Reply;
  for (let i = 0; i < 257; i++) {
    const token = api.open(store, 'Admin', 'web');
    const session = api.authorize(req('', { authorization: `Bearer ${token}` }), store.name);
    const r = new Reply();
    if (!i) { first = r; firstToken = token; }
    inside(live).stream(req(), response(r), store, session);
    rejected = r;
  }
  assert.equal(inside(live).streams.size, 256);
  assert.equal(rejected.statusCode, 503);
  api.end(firstToken);
  assert.equal(live.streamsOf(firstToken), 0);
  assert.ok(first.writableEnded);
  live.closeAll();
  assert.equal(store.listeners.size, before);
});

test('change-feed long polls are bounded and a close invalidates the cursor', async (t) => {
  const host = hostFor(t);
  const store = host.create('Growth');
  const api = new DataApi(host);
  const token = api.open(store, 'Admin', 'web');
  const feed = new ChangeFeed(host, api);
  const state = inside(feed).feed(store.name);
  for (let i = 0; i < 256; i++) state.waiters.add(() => {});
  const r = new Reply();
  const request = req('', { authorization: `Bearer ${token}` });
  const start = new Reply();
  await feed.handle(req('', { authorization: `Bearer ${token}` }), response(start), new URL('http://localhost/tabularius/changes/v1/databases/Growth'));
  const cursor = JSON.parse(start.body).next;
  const pending = feed.handle(request, response(r), new URL(`http://localhost/tabularius/changes/v1/databases/Growth?since=${cursor}&wait=1`));
  request.emit('close');
  await pending;
  assert.equal(r.statusCode, 503);
  host.closeFile('Growth');
  host.openFile('Growth');
  const reopened = api.open(host.get('Growth')!, 'Admin', 'web');
  const stale = new Reply();
  await feed.handle(req('', { authorization: `Bearer ${reopened}` }), response(stale), new URL(`http://localhost/tabularius/changes/v1/databases/Growth?since=${cursor}`));
  assert.equal(stale.statusCode, 410);
});

test('replication address churn and long-poll waiters are bounded', async (t) => {
  const host = hostFor(t);
  const store = host.create('Growth');
  const shipper = new LogShipper(host);
  const replication = new Replication(host, shipper, 'secret');
  t.after(() => { replication.close(); shipper.stop(); });
  shipper.follow(store);
  const f = inside(replication).files.get(store);
  const url = new URL(`http://localhost/?run=${f.run}&after=0`);
  for (let i = 0; i < 1100; i++) await inside(replication).changes(req('', {}, `address-${i}`), response(new Reply()), url, store, f);
  assert.ok(inside(replication).clients.size <= 1024);
  for (let i = 0; i < 256; i++) f.waiting.add(() => {});
  const r = new Reply();
  url.searchParams.set('wait', '1');
  const pending = inside(replication).changes(req(), response(r), url, store, f);
  r.destroy();
  await pending;
  assert.equal(r.statusCode, 503);
});

test('unfinished uploads have an entry cap even before their first byte', (t) => {
  const uploads = new Uploads(hostFor(t), () => {}, { idleMs: 0 });
  for (let i = 0; i < 128; i++) uploads.start({ name: `file-${i}.fmp12`, size: 1 });
  assert.throws(() => uploads.start({ name: 'overflow.fmp12', size: 1 }), /many|capacity|progress/i);
  assert.equal(inside(uploads).uploads.size, 128);
  uploads.remove(uploads.list()[0].id);
  assert.ok(uploads.start({ name: 'next.fmp12', size: 1 }));
});

test('thumbnail cache bounds tiny entries as well as bytes', () => {
  const files = new ContainerFiles();
  for (let i = 0; i < 1100; i++) inside(files).remember(String(i), { mime: 'image/png', data: Buffer.alloc(0) });
  assert.ok(inside(files).cache.size <= 1024);
  assert.equal(inside(files).cache.has('0'), false);
  files.stop();
});

test('thumbnail jobs refuse excess requests before retaining another promise', async (t) => {
  const files = new ContainerFiles();
  t.after(() => files.stop());
  let finish!: (value: undefined) => void;
  const held = new Promise<undefined>((resolve) => { finish = resolve; });
  t.mock.method(inside(files), 'make', () => held);
  const store = { path: 'Growth' };
  const pending = Array.from({ length: 64 }, (_, i) => inside(files).sendThumbnail(req(), response(new Reply()), store, i, 'v', 100));
  const extra = new Reply();
  const overflow = inside(files).sendThumbnail(req(), response(extra), store, 1000, 'v', 100);
  const count = inside(files).making.size;
  finish(undefined);
  await Promise.all([...pending, overflow]);
  assert.equal(count, 64);
  assert.equal(extra.statusCode, 503);
});

test('debugger runs evict and halt the oldest continuation', (t) => {
  const host = hostFor(t);
  const api = new DataApi(host);
  const debug = new DebugApi(host, api);
  t.after(() => debug.stop());
  let halted = 0;
  const run = () => ({ debugger: { running: true, resume: async () => { halted++; } } });
  for (let i = 0; i < 130; i++) inside(debug).runs.set(String(i), run());
  assert.equal(inside(debug).runs.size, 128);
  assert.equal(halted, 2);
});

test('OData script sessions are discarded at file close', (t) => {
  const host = hostFor(t);
  host.create('Growth');
  const api = new DataApi(host);
  const odata = new ODataEndpoint(host, api);
  inside(odata).sessions.set('growth\0admin\0', {});
  host.closeFile('Growth');
  assert.equal(inside(odata).sessions.size, 0);
});

test('file watcher drops disappeared arrivals and failures', async (t) => {
  const host = hostFor(t);
  inside(host).arriving.set('removed.fmp12', 1);
  inside(host).failed.set('removed.fmp12', 1);
  host.failures.set('removed.fmp12', 'failed');
  await host.scan();
  assert.equal(inside(host).arriving.size, 0);
  assert.equal(inside(host).failed.size, 0);
  assert.equal(host.failures.size, 0);
});

test('deleted schedules release their held-warning marker', (t) => {
  const schedules = new Schedules(hostFor(t));
  t.after(() => schedules.stop());
  inside(schedules).list.push({ id: 'gone' });
  inside(schedules).warned.add('gone');
  assert.ok(schedules.remove('gone'));
  assert.equal(inside(schedules).warned.size, 0);
});

test('PostgreSQL unsigned address table has an aggregate ceiling', (t) => {
  const pg = new PgServer(hostFor(t), { port: 0 });
  t.after(() => pg.close());
  for (let i = 0; i < 1024; i++) assert.equal(pg.holdUnsigned(String(i)), true);
  assert.equal(pg.holdUnsigned('overflow'), false);
  pg.releaseUnsigned('0');
  assert.equal(pg.holdUnsigned('next'), true);
});

test('cluster unanswered file operations are capped and rejected on shutdown', async (t) => {
  const host = hostFor(t);
  const link = new ClusterLink({ id: 0, leader: true, workers: 2, socket: '', urlKey: '', locks: join(host.dir, 'locks.sqlite') }, () => {});
  const pending = Array.from({ length: 1024 }, () => inside(link).ask({ name: 'Growth', action: 'close' }).catch((e: Error) => e));
  const extra = inside(link).ask({ name: 'Growth', action: 'close' });
  const checked = assert.rejects(extra, /many|capacity|busy/i);
  // Complete old callbacks on the unfixed implementation too, so a failing test never hangs.
  const callbacks = [...inside(link).waiting.values()];
  link.close();
  for (const done of callbacks) done();
  await Promise.all(pending);
  await checked;
  assert.equal(inside(link).waiting.size, 0);
});

test('unknown bearer tokens cannot grow the Data API write gate without a bound', async (t) => {
  const api = new DataApi(hostFor(t));
  for (let i = 0; i < 4096; i++) await inside(api).acquireWrite(String(i), req(), response(new Reply()));
  await assert.rejects(inside(api).acquireWrite('overflow', req(), response(new Reply())), /many|capacity|busy/i);
  assert.equal(inside(api).inFlightWrites.size, 4096);
  for (let i = 0; i < 4096; i++) inside(api).releaseWrite(String(i));
  assert.equal(inside(api).inFlightWrites.size, 0);
});

test('paused web scripts evict and cancel the oldest continuation', (t) => {
  const host = hostFor(t);
  const store = host.create('Growth');
  const api = new DataApi(host);
  const token = api.open(store, 'Admin', 'web');
  const web = new WebClient(host, api);
  t.after(() => web.stop());
  let canceled = 0;
  for (let i = 0; i < 260; i++) inside(web).outcome({ token, db: store.name, sent: 0, answer: () => { canceled++; } }, { pause: { actions: [], state: {} } });
  assert.equal(inside(web).paused.size, 256);
  assert.equal(canceled, 4);
  api.end(token);
  assert.equal(inside(web).paused.size, 0);
  assert.equal(canceled, 260);
});

test('live presence has a file-wide cap and expires the oldest view', async (t) => {
  const host = hostFor(t);
  const store = host.create('Growth');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name', type: 'text' }] }]);
  const api = new DataApi(host);
  const token = api.open(store, 'Admin', 'web');
  const live = new Live(host, api);
  for (let i = 0; i < 4096; i++) store.locks.view('People', i, token, 'Admin');
  const r = new Reply();
  const request = req('{}', { authorization: `Bearer ${token}` });
  await live.handle(request, response(r), new URL('http://localhost/tabularius/live/v1/databases/Growth/layouts/People/records/5000/view'));
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(store.locks.viewers().length, 4096);
  assert.equal(store.locks.viewers().some((v) => v.recordId === 0), false);
  api.end(token);
  assert.equal(store.locks.viewers().length, 0);
});

test('late web script results cannot recreate paused runs or timers after logout', (t) => {
  const host = hostFor(t);
  const store = host.create('Growth');
  const api = new DataApi(host);
  const token = api.open(store, 'Admin', 'web');
  const web = new WebClient(host, api);
  t.after(() => web.stop());
  api.end(token);
  let canceled = 0;
  const run = { token, db: store.name, sent: 0, answer: () => { canceled++; } };
  const actions = [{ step: 'Install OnTimer Script', timerScriptId: 1, interval: 5 }];
  inside(web).clientActions(run, actions);
  inside(web).outcome(run, { pause: { actions, state: {} } });
  assert.equal(inside(web).timers.size, 0);
  assert.equal(inside(web).paused.size, 0);
  assert.equal(canceled, 1);
});

test('one web session cannot start more than 64 concurrent button scripts', async (t) => {
  const host = hostFor(t);
  const store = host.create('Growth');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name', type: 'text' }] }, { op: 'createScript', name: 'Ping', text: 'Exit Script [ Text Result: "ok" ]' }]);
  const api = new DataApi(host);
  const token = api.open(store, 'Admin', 'web');
  const session = api.authorize(req('', { authorization: `Bearer ${token}` }), store.name);
  const web = new WebClient(host, api);
  t.after(() => web.stop());
  inside(web).running.set(`${token}\0${store.name}`, new Set(Array.from({ length: 64 }, () => new EventTarget())));
  const scriptId = store.schema.scripts.find((s) => s.name === 'Ping')!.id;
  await assert.rejects(inside(web).button(store, session, 'People', { scriptId }, store.privileges('Admin')), /many|capacity|busy/i);
});

test('backup requests cannot build an unlimited serialized backlog', async (t) => {
  const host = hostFor(t);
  const pending = Array.from({ length: 32 }, () => backupFolder(join(host.dir, 'missing'), join(host.dir, 'backups')).catch(() => {}));
  const overflow = backupFolder(join(host.dir, 'missing'), join(host.dir, 'backups'));
  await assert.rejects(overflow, /many|capacity|busy/i);
  await Promise.all(pending);
});

test('canceled and failed backup batches release capacity and cancellation listeners', async (t) => {
  const host = hostFor(t);
  const dest = join(host.dir, 'backups');
  for (const cancel of ['caller', 'administrator', 'failure']) {
    const controllers = Array.from({ length: 32 }, () => new AbortController());
    const pending = controllers.map((controller) => {
      const run = backupFolder(join(host.dir, 'missing'), dest, 7, undefined, { signal: controller.signal, stoppable: true });
      return cancel === 'failure' ? assert.rejects(run, { code: 'ENOENT' }) : assert.rejects(run, BackupStopped);
    });
    const overflow = assert.rejects(backupFolder(host.dir, dest), /Too many backups/);
    if (cancel === 'caller') for (const controller of controllers) controller.abort();
    if (cancel === 'administrator') assert.equal(stopBackups(), 32);
    await Promise.all([...pending, overflow]);
    assert.equal(backupRunning(), false);
    assert.equal(existsSync(dest), false, 'canceled or failed work must not publish a partial backup');
    for (const controller of controllers) assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});

test('live locks refuse new records at capacity and preserve every active lock', async (t) => {
  const host = hostFor(t);
  const store = host.create('Growth');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name', type: 'text' }] }]);
  const api = new DataApi(host);
  const token = api.open(store, 'Admin', 'web');
  const live = new Live(host, api);
  t.mock.method(store, 'checkEditable', () => {}); // All record ids are valid for this lock-cardinality test.
  for (let i = 0; i < 4096; i++) store.locks.acquire('People', i, token, 'Admin');
  const r = new Reply();
  await live.handle(req('{}', { authorization: `Bearer ${token}` }), response(r), new URL('http://localhost/tabularius/live/v1/databases/Growth/layouts/People/records/5000/lock'));
  assert.equal(r.statusCode, 503, r.body);
  assert.equal(store.locks.all().length, 4096);
  assert.equal(store.locks.all()[0].recordId, 0);
  const renewal = new Reply();
  await live.handle(req('{}', { authorization: `Bearer ${token}` }), response(renewal), new URL('http://localhost/tabularius/live/v1/databases/Growth/layouts/People/records/0/lock'));
  assert.equal(renewal.statusCode, 200, renewal.body);
});

test('the folder watcher makes progress when arrivals exceed its cache capacity', async (t) => {
  const host = hostFor(t);
  Object.defineProperty(inside(host).arriving, 'limit', { value: 2 });
  for (const name of ['a', 'b', 'c']) writeFileSync(join(host.dir, name + '.fmp12'), '');
  let attempted = 0;
  t.mock.method(inside(host), 'convert', async () => { attempted++; throw new Error('test conversion'); });
  await host.scan();
  await host.scan();
  assert.ok(attempted > 0, 'a stable arrival must eventually be converted rather than evicted every scan');
  assert.ok(inside(host).arriving.size <= 2);
});

test('standby file churn bounds followers and cancels files removed by the primary', async (t) => {
  const host = hostFor(t);
  const standby = new Standby({ folder: host.dir, primary: 'http://localhost', token: 'test', log: () => {} });
  let round = 0;
  const snapshots: string[][] = [];
  const active = new Set<string>();
  const finish: (() => void)[] = [];
  t.after(() => { inside(standby).abort.abort(); for (const done of finish) done(); });
  t.mock.method(inside(standby), 'get', async () => new Response(JSON.stringify({ files: round === 0 ? Array.from({ length: 1100 }, (_, i) => ({ name: `old-${i}` })) : [{ name: 'new-a' }, { name: 'new-b' }] })));
  t.mock.method(inside(standby), 'follow', (name: string, signal?: AbortSignal) => new Promise<void>((resolve) => {
    active.add(name);
    const done = () => { active.delete(name); resolve(); };
    finish.push(done);
    signal?.addEventListener('abort', done, { once: true });
  }));
  t.mock.method(inside(standby), 'pause', async () => {
    snapshots.push([...inside(standby).following.keys()]);
    if (++round === 2) inside(standby).abort.abort();
  });
  await inside(standby).list();
  await Promise.resolve();
  assert.equal(snapshots[0].length, 1024);
  assert.deepEqual(snapshots[1], ['new-a', 'new-b']);
  assert.equal(active.size, 0, 'removed files and shutdown must abort their work, not just drop the Map entry');
  assert.equal(inside(standby).following.size, 0);
});

test('standby retry waits remove their abort listeners after the timer fires', async (t) => {
  const host = hostFor(t);
  const standby = new Standby({ folder: host.dir, primary: 'http://localhost', token: 'test' });
  for (let i = 0; i < 8; i++) await inside(standby).pause(0);
  assert.equal(getEventListeners(inside(standby).abort.signal, 'abort').length, 0);
});
