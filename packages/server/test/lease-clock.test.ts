import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { monotonicClock } from '../../store/src/monotonic.ts';
import { Host } from '../src/host.ts';
import { Uploads } from '../src/uploads.ts';
import { AiCredentials } from '../src/ai-credentials.ts';
import { faultLog } from '../src/fault-log.ts';
import { forwardLogs } from '../src/cluster.ts';
import { Replication } from '../src/replication.ts';
import type { LogFollower, LogShipper } from '../src/logs.ts';

const HOUR = 3_600_000;
const EPOCH = Date.UTC(2026, 0, 1);

function clocks(t: TestContext) {
  const clock = { wall: EPOCH, elapsed: 0 };
  t.mock.method(Date, 'now', () => clock.wall);
  t.mock.method(monotonicClock, 'now', () => clock.elapsed);
  return clock;
}

// Drive the public replication routes and log-follower boundary without workers,
// sockets, fixtures or real waits. The log payload itself need not be SQLite WAL.
function replication(t: TestContext) {
  const store = { name: 'Tasks' } as Store;
  const host = { get: (name: string) => name === store.name ? store : undefined, names: () => [store.name], onClose: [] } as unknown as Host;
  let follower: LogFollower;
  const shipper = { add: (f: LogFollower) => { follower = f; f.started?.(store); }, follow: () => {}, remove: () => {} } as unknown as LogShipper;
  const repl = new Replication(host, shipper, 'test-token');
  t.after(() => repl.close());
  const request = async (path: string) => {
    const reply = { status: 0, body: '' as string | Buffer };
    const req = { method: 'GET', headers: { authorization: 'Bearer test-token' }, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage;
    const res = {
      writeHead(status: number) { reply.status = status; return this; },
      end(body: string | Buffer) { reply.body = body; },
    } as unknown as ServerResponse;
    assert.equal(await repl.handle(req, res, new URL(`http://localhost/tabularius/replication/v1/${path}`)), true);
    return reply;
  };
  return {
    repl,
    request,
    take: (at: number) => follower.take(store, Buffer.from('change'), at),
    run: async () => JSON.parse(String((await request('files')).body)).files[0].run as string,
  };
}

for (const jump of [HOUR, -HOUR]) {
  test(`upload idle cleanup ignores a ${jump / HOUR} hour wall-clock jump`, (t) => {
    const clock = clocks(t);
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-upload-clock-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const uploads = new Uploads(new Host(dir, () => {}), () => {}, { idleMs: 2 * HOUR });
    const u = uploads.start({ name: 'Tasks.fmp12', size: 1 });
    const part = join(dir, '.openhbam-uploads', `${u.id}.part`);
    clock.wall += jump + 1.5 * HOUR;
    clock.elapsed += 1.5 * HOUR;
    assert.equal(uploads.list().length, 1, 'a live upload is not abandoned early');
    assert.equal(existsSync(part), true);
    clock.wall += 0.5 * HOUR;
    clock.elapsed += 0.5 * HOUR;
    assert.deepEqual(uploads.list(), [], 'an abandoned upload expires at the idle boundary');
    assert.equal(existsSync(part), false);
  });

  test(`credential-file recheck TTL ignores a ${jump / HOUR} hour wall-clock jump`, (t) => {
    const clock = clocks(t);
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-credentials-clock-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'key');
    writeFileSync(file, 'sk-first', { mode: 0o600 });
    const creds = new AiCredentials({ apiKey: 'sk-first', keyFile: file });
    assert.equal(creds.apiKey, 'sk-first');
    writeFileSync(file, 'sk-second-longer');
    clock.wall += jump + 500;
    clock.elapsed += 500;
    assert.equal(creds.apiKey, 'sk-first', 'the file is still cached within one second');
    clock.wall += 500;
    clock.elapsed += 500;
    assert.equal(creds.apiKey, 'sk-second-longer', 'a rollback cannot postpone credential rotation');
    assert.equal(creds.version, 1);
  });

  test(`fault-log rate window ignores a ${jump / HOUR} hour wall-clock jump`, (t) => {
    const clock = clocks(t);
    const lines: unknown[] = [];
    const log = faultLog((line) => lines.push(line), undefined, 1);
    log('first');
    clock.wall += jump;
    log('held');
    assert.deepEqual(lines, ['first'], 'a wall jump cannot grant another logging allowance');
    clock.wall += 60_000;
    clock.elapsed += 60_000;
    log('next');
    assert.equal(lines.length, 3);
    assert.match(String(lines[1]), /^1 more faults/);
    assert.equal(lines[2], 'next');
  });

  test(`follower-log rate window ignores a ${jump / HOUR} hour wall-clock jump`, (t) => {
    const clock = clocks(t);
    const logs: Parameters<typeof forwardLogs>[0] = {};
    const lines: unknown[] = [];
    forwardLogs(logs, (line) => lines.push(line), 2);
    for (let i = 0; i < 120; i++) logs.onEntry!('Error', 'test', 'first');
    clock.wall += jump;
    logs.onEntry!('Error', 'test', 'held');
    assert.equal(lines.length, 120, 'a wall jump cannot reset the allowance');
    clock.wall += 60_001;
    clock.elapsed += 60_001;
    logs.onEntry!('Error', 'test', 'next');
    assert.equal(lines.length, 121, 'the next elapsed minute gets an allowance');
  });

  test(`standby presence ignores a ${jump / HOUR} hour wall-clock jump`, async (t) => {
    const clock = clocks(t);
    const r = replication(t);
    const run = await r.run();
    assert.equal((await r.request(`files/Tasks/changes?run=${run}&after=0`)).status, 200);
    assert.equal(r.repl.standbys()[0].at, EPOCH, 'the public last-seen timestamp stays epoch time');
    clock.wall += jump + 30_000;
    clock.elapsed += 30_000;
    assert.equal(r.repl.standbys().length, 1);
    clock.wall += 30_001;
    clock.elapsed += 30_001;
    assert.deepEqual(r.repl.standbys(), [], 'rollback does not keep an abandoned standby present');
    // New requests restore and renew the same standby entry after expiry.
    await r.request(`files/Tasks/changes?run=${run}&after=0`);
    clock.wall += 30_000;
    clock.elapsed += 30_000;
    await r.request(`files/Tasks/changes?run=${run}&after=0`);
    assert.equal(r.repl.standbys()[0].at, clock.wall);
    clock.wall += 60_000;
    clock.elapsed += 60_000;
    assert.equal(r.repl.standbys().length, 1, 'preserve the inclusive boundary');
    clock.wall++;
    clock.elapsed++;
    assert.deepEqual(r.repl.standbys(), []);
  });

  test(`replication retention ignores a ${jump / HOUR} hour wall-clock jump`, async (t) => {
    const clock = clocks(t);
    const r = replication(t);
    const run = await r.run();
    r.take(clock.wall);
    clock.wall += jump + 5 * 60_000;
    clock.elapsed += 5 * 60_000;
    r.take(clock.wall);
    const fresh = await r.request(`files/Tasks/changes?run=${run}&after=0`);
    assert.equal(fresh.status, 200, 'a wall jump cannot discard recent changes');
    assert.equal((fresh.body as Buffer).readDoubleBE(0), EPOCH, 'wire log timestamps remain epoch time');
    clock.wall += 5 * 60_000 + 1;
    clock.elapsed += 5 * 60_000 + 1;
    r.take(clock.wall);
    assert.equal((await r.request(`files/Tasks/changes?run=${run}&after=0`)).status, 410, 'old changes leave the buffer after elapsed retention');
    assert.equal((await r.request(`files/Tasks/changes?run=${run}&after=1`)).status, 200, 'the newer changes remain available');
  });
}
