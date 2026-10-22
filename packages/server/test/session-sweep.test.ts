// Data API clients that sign in and never sign out: their timed-out sessions
// don't stay in memory for good.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataApi, Host } from '../src/index.ts';
import { createStore, SharedRecordLocks } from '../../store/src/index.ts';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage } from 'node:http';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

for (const shared of [false, true]) for (const check of ['alive', 'authorize', 'validateSession', 'sweep'] as const) {
  test(`${shared ? 'shared' : 'memory'} session expiry via ${check} releases locks in every file`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-expired-locks-'));
    t.after(() => rmSync(dir, { recursive: true }));
    for (const file of ['A', 'B']) createStore(join(dir, `${file}.openhbam.sqlite`));
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    const host = new Host(dir, () => {}, shared ? { locks: (store) => new SharedRecordLocks(db, store.name) } : {});
    t.after(() => host.close());
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    // Sessions age on the monotonic clock, shared lock leases on the wall clock: move both.
    let mono = performance.now();
    t.mock.method(performance, 'now', () => mono);
    const tick = (ms: number) => { t.mock.timers.tick(ms); mono += ms; };
    const api = new DataApi(host);
    const token = api.open(host.get('A')!, 'Admin', 'rest');
    tick(15 * 60_000 - 1);
    for (const name of ['A', 'B']) {
      const store = host.get(name)!;
      store.locks.acquire('T', 1, token, 'Admin');
      store.locks.acquire('T', 2, 'other-session', 'Other');
      store.locks.view('T', 1, token, 'Admin');
    }
    tick(2); // session expired, but its freshly renewed lease has not
    if (check === 'alive') assert.equal(api.alive(token), false);
    else if (check === 'authorize') assert.throws(() => api.authorize({ headers: { authorization: `Bearer ${token}` } } as IncomingMessage, 'A'));
    else if (check === 'validateSession') {
      // Exercise the endpoint handler without opening a listener just to check session lifetime.
      const endpoint = api as unknown as { route(req: IncomingMessage, path: string[], url: URL, headers: Record<string, string>): Promise<unknown> };
      await assert.rejects(endpoint.route({ method: 'GET', headers: { authorization: `Bearer ${token}` } } as IncomingMessage, ['validateSession'], new URL('http://localhost/fmi/data/vLatest/validateSession'), {}));
    }
    else api.open(host.get('A')!, 'Admin', 'rest');
    for (const name of ['A', 'B']) {
      const store = host.get(name)!;
      assert.equal(store.locks.holder('T', 1), undefined);
      assert.deepEqual(store.locks.viewers(), []);
      assert.equal(store.locks.holder('T', 2)?.owner, 'other-session');
    }
    assert.equal(api.sessionCount, check === 'sweep' ? 1 : 0);
  });
}

test('timed-out sessions are cleared as new ones open', { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sweep-'));
  t.after(() => rmSync(dir, { recursive: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir, () => {});
  t.after(() => host.close());
  let now = performance.now();
  t.mock.method(performance, 'now', () => now);
  const api = new DataApi(host);
  const store = host.get('Charts')!;
  store.savePrivilegeSet({ name: 'Workers', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('worker', 'worker-pw-123', 'Workers');

  for (let i = 0; i < 50; i++) api.open(store, 'worker', 'rest');
  assert.equal(api.sessionCount, 50);
  // Used in the last 15 minutes: kept.
  now += 10 * 60_000;
  const busy = api.open(store, 'worker', 'rest');
  assert.equal(api.sessionCount, 51);
  assert.ok(api.alive(busy));

  // 16 minutes on, the 50 have timed out and go as the next session opens.
  now += 6 * 60_000;
  api.open(store, 'worker', 'rest');
  assert.equal(api.sessionCount, 2);
  assert.equal(api.list().length, 2);
});

test('a full-access Data API token still expires at the idle limit', { skip }, (t) => {
  // The key-10 idle-disconnect option governs interactive clients, not the Data
  // API: a Data API token expires 15 minutes after its last call whatever the
  // privilege set, so even [Full Access] (which turns idle-disconnect off) does
  // not keep a Data API session alive.
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-fulltoken-'));
  t.after(() => rmSync(dir, { recursive: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir, () => {});
  t.after(() => host.close());
  let now = performance.now();
  t.mock.method(performance, 'now', () => now);
  const api = new DataApi(host);
  const store = host.get('Charts')!;
  // Admin holds Charts' [Full Access], whose key-10 idle-disconnect is off.
  const token = api.open(store, 'Admin', 'rest');
  now += 30 * 60_000;
  assert.ok(!api.alive(token), 'a full-access Data API session times out like any other');
});

test('a web-client session with idle-disconnect off keeps its session alive past the idle limit', { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-keepalive-'));
  t.after(() => rmSync(dir, { recursive: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir, () => {});
  t.after(() => host.close());
  let now = performance.now();
  t.mock.method(performance, 'now', () => now);
  const api = new DataApi(host);
  const store = host.get('Charts')!;
  // Two web-client sets: one keeps connections alive when idle (key-10 idle-disconnect off); one times out as usual.
  store.savePrivilegeSet({ name: 'StayConnected', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmapp'], idleDisconnect: false });
  store.savePrivilegeSet({ name: 'NormalIdle', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmapp'] });
  store.setPassword('stay', 'stay-pw-1234', 'StayConnected');
  store.setPassword('normal', 'normal-pw-123', 'NormalIdle');

  const kept = api.open(store, 'stay', 'web');
  const normal = api.open(store, 'normal', 'web');
  // Well past the 15-minute idle limit.
  now += 30 * 60_000;
  assert.ok(api.alive(kept), 'the idle-disconnect-off web-client session is still alive');
  assert.ok(!api.alive(normal), 'a normal web-client session has timed out');
  // A new sign-in sweeps timed-out sessions; the kept one survives it.
  api.open(store, 'normal', 'web');
  assert.ok(api.list().some((s) => s.account === 'stay'), 'the kept session survives the sweep');
  assert.ok(!api.list().some((s) => s.account === 'normal' && s.idleSeconds > 15 * 60), 'the timed-out normal session is gone');
});

test('a Data API session with idle-disconnect off still times out (the option is interactive-only)', { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restidle-'));
  t.after(() => rmSync(dir, { recursive: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir, () => {});
  t.after(() => host.close());
  let now = performance.now();
  t.mock.method(performance, 'now', () => now);
  const api = new DataApi(host);
  const store = host.get('Charts')!;
  // Idle-disconnect off, but reached over the Data API: the bit does not apply.
  store.savePrivilegeSet({ name: 'RestNoKick', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'], idleDisconnect: false });
  store.setPassword('restworker', 'rest-pw-1234', 'RestNoKick');
  const token = api.open(store, 'restworker', 'rest');
  now += 30 * 60_000;
  assert.ok(!api.alive(token), 'a Data API session times out even when its set turns idle-disconnect off');
});

test('a web-client session is not kept alive for Full Access, a disabled account, or a set that now disconnects idle sessions', { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-keepalive2-'));
  t.after(() => rmSync(dir, { recursive: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir, () => {});
  t.after(() => host.close());
  let now = performance.now();
  t.mock.method(performance, 'now', () => now);
  const api = new DataApi(host);
  const store = host.get('Charts')!;
  const set = { records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable' as const, valueLists: 'none' as const, scripts: 'none' as const, extendedPrivileges: ['fmapp'] };
  store.savePrivilegeSet({ name: 'Stay', ...set, idleDisconnect: false });
  store.setPassword('stay1', 'stay-pw-1234', 'Stay');
  store.setPassword('stay2', 'stay-pw-1234', 'Stay');
  store.setPassword('stay3', 'stay-pw-1234', 'Stay');

  // Charts' [Full Access] has idle-disconnect off, yet an administrator's web session still times out.
  const admin = api.open(store, 'Admin', 'web');
  const a = api.open(store, 'stay1', 'web');
  const b = api.open(store, 'stay2', 'web');
  const c = api.open(store, 'stay3', 'web');
  now += 30 * 60_000;
  assert.ok(!api.alive(admin), 'a Full Access web session times out');
  assert.ok(api.alive(a) && api.alive(b) && api.alive(c), 'the idle-disconnect-off sessions are kept');

  // Turning idle-disconnect back on ends the live session at once.
  store.savePrivilegeSet({ name: 'Stay', ...set, idleDisconnect: true });
  assert.ok(!api.alive(a), 'a set that now disconnects idle sessions ends them');
  store.savePrivilegeSet({ name: 'Stay', ...set, idleDisconnect: false });
  // Disabling the account ends its session too.
  store.setAccountActive('stay2', false);
  assert.ok(!api.alive(b), 'a disabled account\'s session is not kept');
  // A hard cap: nobody stays for ever.
  now += 24 * 60 * 60_000;
  assert.ok(!api.alive(c), 'a kept session still ends after a day idle');
});

test('a session cleanup that throws at shutdown is logged and every file still closes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-close-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true }));
  for (const file of ['A', 'B']) createStore(join(dir, `${file}.openhbam.sqlite`));
  const lines: string[] = [];
  const host = new Host(dir, (m) => lines.push(m));
  const stores = [host.get('A')!, host.get('B')!];
  const seen: string[] = [];
  host.onClose.push((store) => { seen.push(store.name); throw new Error('cleanup refused'); });
  host.onClose.push((store) => { seen.push(`${store.name} (second)`); });
  await host.close();
  assert.deepEqual(seen.sort(), ['A', 'A (second)', 'B', 'B (second)'], 'a failing callback does not stop the others, nor the other file');
  assert.ok(lines.some((l) => /closing A: session cleanup failed: cleanup refused/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /closing B: session cleanup failed: cleanup refused/.test(l)));
  for (const store of stores) assert.throws(() => store.select('SELECT 1'), /./, `${store.name} is closed`);
});
