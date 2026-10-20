import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, Schedules, serve } from '../src/index.ts';
import { ScriptQueue } from '../src/server-queue.ts';
import { McpTokens } from '../src/mcp-tokens.ts';
import { hookSignature } from '../src/inbound-hooks.ts';
import { AutomationRunner, saveAutomation, automationRuns } from '../src/automations.ts';
import { runScript } from '../../scripts/src/index.ts';

async function fixture(http = false) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-inactive-work-'));
  const served = http ? await serve({ dir, port: 0, watch: false, inboundHooks: true, log: () => {} }) : undefined;
  const host = served?.host ?? new Host(dir, () => {});
  const store = host.create('Local');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'text' }] },
    { op: 'createScript', name: 'Write', text: 'New Record/Request\nSet Field [ T::Value ; "written" ]\nCommit Records/Requests [ With dialog: Off ]' },
    { op: 'createScript', name: 'Server', text: 'Perform Script on Server [ "Write" ; Wait for completion: On ]' },
  ]);
  store.setPassword('Admin', 'admin-secret', '[Full Access]');
  store.setPassword('Worker', 'worker-secret', '[Full Access]');
  const queue = new ScriptQueue(1);
  const options = host.scriptOptions();
  host.scriptOptions = () => ({ ...options, serverQueue: queue });
  const count = () => Number(store.sql.prepare('SELECT COUNT(*) AS n FROM T').get()!.n);
  return { dir, host, store, queue, count, url: served?.url ?? '', async done() {
    if (served) await new Promise<void>((r) => served.server.close(() => r()));
    else await host.close();
    rmSync(dir, { recursive: true, force: true });
  } };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('work did not reach the expected queue boundary');
}
function hold(queue: ScriptQueue) {
  let release!: () => void;
  const running = queue.run(() => new Promise<void>((r) => { release = r; }));
  return async () => { release(); await running; };
}
const basic = (password = 'worker-secret') => 'Basic ' + Buffer.from(`Worker:${password}`).toString('base64');
async function tool(url: string, authorization: string, name = 'describe_database', args: object = { database: 'Local' }) {
  const response = await fetch(url + '/mcp', {
    method: 'POST', headers: { authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await response.json();
  return body.result ? { isError: false, ...body.result } : { isError: true, content: [{ text: JSON.stringify(body) }] };
}

test('MCP legacy tokens and cached MCP SQL and OData passwords reject deactivation and security changes', async () => {
  const f = await fixture(true);
  try {
    const full = f.store.privilegeSets().find((p) => p.id === 1)!;
    f.store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata', 'fmxdbc'] });
    const token = new McpTokens(f.dir).create({ database: 'Local', account: 'Worker' }).token;
    const sql = () => fetch(f.url + '/tabularius/sql/v1/databases/Local', { method: 'POST', headers: { authorization: basic(), 'content-type': 'application/json' }, body: '{"sql":"SELECT Value FROM T"}' });
    const odata = () => fetch(f.url + '/fmi/odata/v4/Local/T', { headers: { authorization: basic() } });
    // Exercise real password-cache hits independently of security-event invalidation.
    let hashes = 0;
    const verify = f.store.verify.bind(f.store);
    const verifyAsync = f.store.verifyAsync.bind(f.store);
    f.store.verify = (...args) => { hashes++; return verify(...args); };
    f.store.verifyAsync = (...args) => { hashes++; return verifyAsync(...args); };
    for (const read of [
      async () => !(await tool(f.url, basic())).isError,
      async () => (await sql()).status === 200,
      async () => (await odata()).status === 200,
    ]) {
      const before = hashes;
      assert.equal(await read(), true);
      assert.equal(await read(), true);
      assert.equal(hashes - before, 1, 'the second request used cached password verification');
      // Simulate an out-of-band status change without an audit event: the hit must still recheck activity.
      f.store.sql.prepare('UPDATE _fm_accounts SET inactive = 1 WHERE name = ?').run('Worker');
      assert.equal(await read(), false);
      f.store.sql.prepare('UPDATE _fm_accounts SET inactive = 0 WHERE name = ?').run('Worker');
    }
    for (let i = 0; i < 2; i++) {
      assert.equal((await tool(f.url, basic())).isError, false);
      assert.equal((await tool(f.url, `Bearer ${token}`)).isError, false);
      assert.equal((await sql()).status, 200);
      assert.equal((await odata()).status, 200);
    }
    f.store.setAccountActive('Worker', false);
    assert.equal((await tool(f.url, basic())).isError, true);
    assert.equal((await tool(f.url, `Bearer ${token}`)).isError, true);
    assert.equal((await sql()).status, 401);
    assert.equal((await odata()).status, 401);
    f.store.setAccountActive('Worker', true);
    assert.equal((await tool(f.url, basic())).isError, false);
    assert.equal((await sql()).status, 200);
    assert.equal((await odata()).status, 200);
    f.store.setPassword('Worker', 'changed-secret', '[Full Access]');
    assert.equal((await tool(f.url, basic())).isError, true);
    assert.equal((await sql()).status, 401);
    assert.equal((await odata()).status, 401);
    f.store.deleteAccount('Worker');
    assert.equal((await tool(f.url, `Bearer ${token}`)).isError, true);
  } finally { await f.done(); }
});

test('schedules reject inactive or missing accounts at validation and after queueing', async () => {
  const f = await fixture();
  const schedules = new Schedules(f.host);
  try {
    const input = { name: 'Write', database: 'Local', script: 'Write', account: 'Worker', everyMinutes: 60, enabled: false };
    f.store.setAccountActive('Worker', false);
    assert.throws(() => schedules.create(input), /inactive/);
    assert.throws(() => schedules.create({ ...input, account: 'Missing' }), /missing/);
    f.store.setAccountActive('Worker', true);
    const s = schedules.create(input);
    const release = hold(f.queue);
    const running = schedules.run(s.id);
    await until(() => f.queue.queued === 1);
    f.store.setAccountActive('Worker', false);
    await release();
    assert.equal((await running).error, 212);
    assert.equal(f.count(), 0);
    assert.equal((await schedules.run(s.id)).error, 212);
    f.store.setAccountActive('Worker', true);
    f.store.deleteAccount('Worker');
    assert.equal((await schedules.run(s.id)).error, 212);
  } finally { schedules.stop(); await f.done(); }
});

test('queued Perform Script on Server retains its principal and rechecks before starting', async () => {
  const f = await fixture();
  try {
    const release = hold(f.queue);
    const running = runScript(f.store, 'Server', { account: 'Worker', privileges: f.store.privileges('Worker'), serverQueue: f.queue });
    await until(() => f.queue.queued === 1);
    f.store.setAccountActive('Worker', false);
    await release();
    await assert.rejects(running, { code: 212 });
    assert.equal(f.count(), 0);
    await assert.rejects(runScript(f.store, 'Server', { account: 'Worker', privileges: f.store.privileges('Worker'), serverQueue: f.queue }), { code: 212 });
  } finally { await f.done(); }
});

test('running server scripts stop after deactivation at the next step boundary, even with Full Access', async () => {
  const f = await fixture();
  try {
    const script = f.store.schema.scripts.find((s) => s.name === 'Write')!;
    await assert.rejects(runScript(f.store, { ...script, fullAccess: true }, {
      account: 'Worker', executionAccount: 'Worker', privileges: f.store.privileges('Worker'),
      debug: async (point) => { if (point.index === 1) f.store.setAccountActive('Worker', false); },
    }), { code: 212 });
    assert.equal(f.count(), 1, 'the record created by the completed step remains');
    assert.equal(f.store.select('SELECT Value FROM T').rows[0][0], null, 'the next step never writes its value');
  } finally { await f.done(); }
});

test('record automations reject disabled accounts for create update and delete, including queued runs', async () => {
  for (const on of ['create', 'update', 'delete']) {
    const f = await fixture();
    try {
      const a = saveAutomation(f.store, { name: 'Write', layout: 'T', on, script: 'Write', account: 'Worker' }, 'Admin', []).automation;
      const runner = new AutomationRunner(f.host);
      const record = on === 'create' ? undefined : f.store.create('T', { Value: 'before' }).recordId;
      const release = hold(f.queue);
      if (on === 'create') f.store.create('T', { Value: 'trigger' });
      else if (on === 'update') f.store.update('T', record!, { Value: 'trigger' });
      else f.store.delete('T', record!);
      await until(() => f.queue.queued === 1);
      f.store.setAccountActive('Worker', false);
      await release();
      await runner.idle(f.store);
      assert.equal(automationRuns(f.store, a.id)[0].error, 212, on);
      assert.throws(() => saveAutomation(f.store, { name: 'Disabled', layout: 'T', on, script: 'Write', account: 'Worker' }, 'Admin', []), /inactive/);
      const before = f.count();
      if (on === 'create') f.store.create('T', { Value: 'disabled' });
      else if (on === 'update') f.store.update('T', record!, { Value: 'disabled' });
      else {
        const id = f.store.create('T', { Value: 'disabled' }).recordId;
        f.store.delete('T', id);
      }
      await runner.idle(f.store);
      assert.equal(f.count(), before + (on === 'create' ? 1 : 0), on);
      assert.equal(f.store.select('SELECT Value FROM T WHERE Value = ?', ['written']).rows.length, 0, on);
    } finally { await f.done(); }
  }
});

test('signed inbound hooks reject inactive configuration and queued or later execution', async () => {
  const f = await fixture(true);
  try {
    const input = { name: 'Write', database: 'Local', script: 'Write', account: 'Worker', layout: 'T' };
    const create = () => fetch(f.url + '/tabularius/admin/v1/inbound-hooks', { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const made = await create();
    assert.equal(made.status, 201);
    const hook = await made.json();
    const call = (n: number) => {
      const at = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ n });
      return fetch(f.url + hook.path, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-tabularius-timestamp': at, 'x-tabularius-signature': hookSignature(hook.secret, at, body) } });
    };
    const release = hold(f.queue);
    const running = call(1);
    await until(() => f.queue.queued === 1);
    f.store.setAccountActive('Worker', false);
    await release();
    assert.equal((await (await running).json()).error, 212);
    assert.equal((await create()).status, 400);
    assert.equal((await (await call(2)).json()).error, 212);
    assert.equal(f.count(), 0);
  } finally { await f.done(); }
});
