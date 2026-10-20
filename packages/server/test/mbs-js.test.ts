// Generated store and direct Data API lifecycle calls: no fixtures, sockets or GC required.
import { afterEach, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { evaluateText } from '../../calc/src/index.ts';
import { runScript, ScriptSession } from '../../scripts/src/index.ts';
import { createStore, stopJavaScript } from '../../store/src/index.ts';
import { JS_CONTEXT_LIMIT } from '../../store/src/javascript.ts';
import { MBS_JS_HANDLES_PER_SESSION } from '../../calc/src/mbs-js.ts';
import { DataApi, Host } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { sessionFor } from '../src/mcp.ts';

afterEach(async () => { await stopJavaScript(); });
const mbs = (session: ScriptSession, name: string, ...args: string[]) => evaluateText(
  `MBS ( ${[name, ...args].map(v => JSON.stringify(v)).join(' ; ')} )`, { pluginSession: session });

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-js-session-'));
  createStore(join(dir, 'Generated' + STORE_EXT));
  const host = new Host(dir, () => {});
  t.after(() => { host.close(); rmSync(dir, { recursive: true, force: true }); });
  const store = host.get('Generated')!;
  const api = new DataApi(host);
  const request = (token: string) => ({ headers: { authorization: `Bearer ${token}` }, socket: {} } as IncomingMessage);
  const open = (account = 'Admin') => {
    const token = api.open(store, account, 'rest');
    return { token, session: api.authorize(request(token), store.name).scripts };
  };
  return { host, store, api, request, open };
}

test('MBS JS unstored calculations over 40 records cannot consume script handle capacity', t => {
  const { store } = setup(t);
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
    { op: 'createField', table: 'Items', name: 'Handle', type: 'text', kind: 'calculation',
      calculation: 'MBS ( "JS.New" )', options: { unstored: true } },
  ]);
  for (let i = 0; i < 40; i++) store.create('Items', { Name: String(i) });
  const records = store.find('Items', { limit: 40 }).records;
  assert.equal(records.length, 40);
  for (const record of records) {
    assert.equal(record.fieldData.Handle, '[MBS] ERROR: JavaScript handles are only available in a script');
  }
  const owner = new ScriptSession();
  const ref = mbs(owner, 'JS.New');
  assert.match(ref, /^\d+$/);
  assert.equal(mbs(owner, 'JS.Evaluate', ref, '6 * 7'), '42');
  owner.close();
});

test('MBS JS four Data API sessions of one account share eight handles, leaving other accounts capacity', async t => {
  const { store, api, request, open } = setup(t);
  store.setPassword('Other', 'generated-other-password', '[Full Access]');
  store.applyDesign([
    { op: 'createScript', name: 'Create', text: 'Exit Script [ Text Result: MBS ( "JS.New" ; Get ( ScriptParameter ) ) ]' },
  ]);
  const owners = ['Admin', 'ADMIN', 'admin', 'Admin'].map(open);
  const create = async (owner: ReturnType<typeof open>, name: string) => {
    const authorized = api.authorize(request(owner.token), store.name);
    const result = await runScript(store, 'Create', { session: authorized.scripts, account: authorized.account, parameter: name });
    assert.equal(result.error, 0);
    return result.result;
  };
  for (let i = 0; i < 8; i++) assert.equal(await create(owners[i % owners.length], `handle${i}`), `handle${i}`);
  assert.equal(mbs(owners[0].session, 'JS.Evaluate', 'handle0', 'var saved = 42; saved'), '42');
  assert.match(await create(owners[3], 'retry'), /^\[MBS\] ERROR:.*limit.*account.*8/);
  assert.equal(mbs(owners[3].session, 'IsError'), '1');
  assert.equal(mbs(owners[0].session, 'JS.Evaluate', 'handle0', 'saved'), '42');
  assert.equal(await create(open('Other'), 'independent'), 'independent');
  assert.equal(mbs(owners[1].session, 'JS.Release', 'handle1'), 'OK');
  assert.equal(await create(owners[3], 'retry'), 'retry');
  assert.match(await create(owners[3], 'stillFull'), /^\[MBS\] ERROR:.*limit.*account/);
  api.end(owners[0].token);
  assert.equal(await create(owners[3], 'afterEnd1'), 'afterEnd1');
  assert.equal(await create(owners[3], 'afterEnd2'), 'afterEnd2');
  assert.match(await create(owners[3], 'fullAgain'), /^\[MBS\] ERROR:.*limit.*account/);
});

// Session idle time runs on the monotonic clock: age one session by moving its last-used mark back.
function ageSession(api: unknown, token: string, ms: number): void {
  (api as { sessions: Map<string, { lastUsed: number }> }).sessions.get(token)!.lastUsed -= ms;
}

for (const ending of ['sign-out', 'admin disconnect', 'timeout', 'changed timeout', 'account disabled', 'session eviction'] as const) {
  test(`MBS JS ${ending} releases a retained session's handles immediately`, t => {
    const { host, store, api, request, open } = setup(t);
    const owners = Array.from({ length: JS_CONTEXT_LIMIT / MBS_JS_HANDLES_PER_SESSION }, open);
    const refs = owners.map(({ session }) => Array.from({ length: MBS_JS_HANDLES_PER_SESSION }, () => {
      const ref = mbs(session, 'JS.New');
      assert.match(ref, /^\d+$/);
      return ref;
    }));
    const { token, session } = owners[0];
    switch (ending) {
      case 'sign-out': api.end(token); api.end(token); break;
      case 'admin disconnect': assert.equal(api.endById(api.idOf(token)), true); break;
      case 'timeout':
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
        t.mock.timers.tick(16 * 60_000);
        ageSession(api, token, 16 * 60_000);
        assert.throws(() => api.authorize(request(token), store.name), /Invalid FileMaker Data API token/);
        break;
      case 'changed timeout':
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
        t.mock.timers.tick(3 * 60_000);
        ageSession(api, token, 3 * 60_000);
        assert.equal(api.alive(token), true);
        host.config.setSessionIdleMinutes(2);
        assert.equal(api.alive(token), false);
        break;
      case 'account disabled':
        store.setPassword('Backup', 'generated-backup-password', '[Full Access]');
        store.setAccountActive('Admin', false);
        assert.equal(api.alive(token), false);
        break;
      case 'session eviction': api.maxSessionsPerAccount = owners.length; open(); break;
    }
    assert.match(mbs(new ScriptSession(), 'JS.New'), /^\d+$/, 'capacity is free before GC or idle expiry');
    for (const ref of refs[0]) assert.match(mbs(session, 'JS.Release', ref), /^\[MBS\] ERROR:/);
    assert.match(mbs(session, 'JS.New'), /^\[MBS\] ERROR:.*session.*ended/);
    assert.equal(mbs(owners[1].session, 'JS.Release', refs[1][0]), 'OK', 'another session keeps its handles');
  });
}

test('MBS JS evicting cached MCP sessions closes their retained handles', t => {
  const { host } = setup(t);
  const owner = sessionFor(host, 'Generated', { admin: true });
  const ref = mbs(owner, 'JS.New');
  assert.match(ref, /^\d+$/);
  for (let i = 0; i < 1000; i++) sessionFor(host, `Generated${i}`, { admin: true });
  assert.notEqual(sessionFor(host, 'Generated', { admin: true }), owner);
  assert.match(mbs(owner, 'JS.Release', ref), /^\[MBS\] ERROR:/);
  assert.match(mbs(owner, 'JS.New'), /^\[MBS\] ERROR:.*session.*ended/);
});
