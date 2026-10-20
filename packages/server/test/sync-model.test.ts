import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataApiClient, FmsSyncError } from '../src/fms-sync.ts';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { applySync, createStore, readSyncLog, Store, type ApplyOptions, type ApplyResult, type PrivilegeDefinition, type TableSyncConfig } from '../../store/src/index.ts';
import { generate, Model, shrink, values, type Op } from './helpers/sync-model.ts';
import { Transport } from './helpers/sync-transport.ts';

// Any accidental subprocess inherits only inert command stubs. This suite launches none.
const guard = mkdtempSync(join(tmpdir(), 'openhbam-sync-path-'));
const marker = join(guard, 'called');
const originalPath = process.env.PATH;
for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
  writeFileSync(join(guard, name), '#!/bin/sh\nprintf blocked > "${0%/*}/called"\nexit 99\n', { mode: 0o755 });
  writeFileSync(join(guard, `${name}.cmd`), '@echo off\r\necho blocked > "%~dp0called"\r\nexit /b 99\r\n');
}
process.env.PATH = guard;
after(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  try { assert.equal(existsSync(marker), false, 'a forbidden subprocess ran'); }
  finally { rmSync(guard, { recursive: true, force: true }); }
});

const config: TableSyncConfig = { localTable: 'Rows', remoteLayout: 'Rows', uuidField: 'uuid', modTimestampField: 'modts' };
const snapshot = (store: Store) => store.query('SELECT uuid, A, B FROM Rows ORDER BY uuid', 1000).map((r) => ({ uuid: String(r.uuid), A: String(r.A ?? ''), B: String(r.B ?? '') })).sort((a, b) => a.uuid.localeCompare(b.uuid));
const identity = (e: unknown) => e instanceof assert.AssertionError ? e.message.split('\n')[0] : String(e);

async function replay(history: Op[], count: number, requireFaults = true) {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-sync-model-'));
  const stores: Store[] = [];
  const transport = new Transport();
  const model = new Model(count);
  const actual = () => [transport.snapshot(), ...stores.map(snapshot)];
  const expected = () => model.rows.map(values);
  try {
    for (let r = 1; r < count; r++) {
      const path = join(dir, `replica${r}.sqlite`);
      createStore(path);
      const store = new Store(path, `replica${r}`);
      stores.push(store);
      store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'A' }, { name: 'B' }] }]);
    }
    await transport.start();
    const run = async (replica: number, policy: TableSyncConfig['policy'], options: Partial<ApplyOptions> = {}) => {
      const table = { ...config, policy };
      const client = dataApiClient({ server: transport.url, database: 'Fake', user: 'fake', password: 'fake', tables: [table], pageSize: 2, requestTimeoutMs: 3000 });
      try { return await applySync(stores[replica - 1], `replica${replica}`, [table], client, client, { write: true, pull: true, allowDeletes: true, ...options }); }
      finally { await client.close(); }
    };
    for (const op of history) {
      if (op.kind !== 'sync') {
        if (!model.edit(op)) continue;
        if (op.replica === 0) {
          const row = [...transport.records.values()].find((r) => r.fieldData.uuid === op.key);
          if (op.kind === 'delete') transport.records.delete(row!.recordId);
          else if (row) { Object.assign(row.fieldData, { [op.field]: op.value, modts: op.stamp }); row.modId = String(Number(row.modId) + 1); }
          else transport.create({ uuid: op.key, [op.field]: op.value, modts: op.stamp });
        } else {
          const store = stores[op.replica - 1];
          const row = store.sql.prepare('SELECT _fm_record_id id FROM Rows WHERE uuid = ?').get(op.key);
          if (op.kind === 'delete') store.delete('Rows', Number(row!.id));
          else if (row) store.update('Rows', Number(row.id), { [op.field]: op.value, modts: op.stamp });
          else store.create('Rows', { uuid: op.key, [op.field]: op.value, modts: op.stamp });
        }
        assert.deepEqual(actual(), expected(), 'offline acknowledged write retained');
        continue;
      }
      const prediction = model.preview(op);
      transport.arm('none');
      const before = actual();
      const check = await run(op.replica, op.policy, { write: false, pull: false });
      assert.deepEqual(check.plans[0].conflicts.map((c) => c.uuid).sort(), prediction.conflicts, 'reference conflict set');
      assert.deepEqual(actual(), before, 'dry run preserves acknowledged writes');
      if (prediction.conflicts.length) {
        const blocked = await run(op.replica, op.policy);
        assert.ok(blocked.refused, 'unresolved conflict refuses whole run');
        assert.deepEqual(actual(), before, 'unresolved conflict preserves both versions');
      }
      const resolutions = check.plans[0].conflicts.map((c) => ({ table: 'Rows', uuid: c.uuid, keep: op.keep, reviewToken: c.reviewToken! }));
      const acceptedBefore = transport.accepted.length;
      transport.arm(op.fault, op.at);
      let result: ApplyResult | undefined;
      if (op.fault === 'truncate') {
        await assert.rejects(run(op.replica, op.policy, { resolutions }), FmsSyncError);
        assert.deepEqual(actual(), before, 'truncated JSON preserves acknowledged writes');
        assert.equal(transport.accepted.length, acceptedBefore, 'truncated JSON sends no writes');
      } else result = await run(op.replica, op.policy, { resolutions });
      assert.equal(transport.error, undefined, 'fake transport handler succeeded');
      if (requireFaults && op.fault !== 'none') assert.ok(transport.fired, `fault ${op.fault} exercised`);
      if (['duplicate', 'short-page', 'schema'].includes(op.fault)) {
        assert.ok(result!.tables[0].skipped, 'incomplete read or missing layout holds table');
        assert.deepEqual(actual(), before, 'incomplete snapshot never becomes a deletion');
        assert.equal(transport.accepted.length, acceptedBefore, 'held table sends no writes');
      }
      if (['drop', 'lost-ack'].includes(op.fault) && transport.fired) assert.ok(result!.stopped, 'interrupted batch reports stop');
      const completed: boolean = !!result && !result.refused && !result.stopped && !result.tables[0].skipped && !result.tables[0].failed.length;
      if (completed) {
        model.sync(op);
        assert.deepEqual(actual(), expected(), 'completed sync matches reference before any retry');
      }
      // Retry from a new connection and a fresh check: old review tokens are single-use.
      transport.arm('none');
      const retryCheck = completed ? undefined : await run(op.replica, op.policy, { write: false, pull: false });
      const retry: ApplyResult = completed ? result! : await run(op.replica, op.policy, { resolutions: retryCheck?.plans[0].conflicts.map((c) => ({ table: 'Rows', uuid: c.uuid, keep: op.keep, reviewToken: c.reviewToken! })) });
      assert.equal(retry.refused ?? retry.stopped ?? retry.tables[0].skipped, undefined, 'full sync completes');
      assert.deepEqual(retry.tables[0].failed, [], 'full sync has no failed records');
      if (!completed) model.sync(op);
      assert.deepEqual(actual(), expected(), 'convergence, acknowledged winner retained, no unexplained resurrection');
      assert.deepEqual(actual()[op.replica], actual()[0], 'completed pair converges');
      // A lost create acknowledgement must be adopted, not issued twice.
      const creates = transport.accepted.slice(acceptedBefore).filter((x) => x.method === 'POST').map((x) => x.key);
      assert.equal(new Set(creates).size, creates.length, 'retry never duplicates an accepted create');
      const stable = actual(), accepted = transport.accepted.length;
      const localVersions = stores.map((s) => s.query('SELECT _fm_record_id, _fm_mod_id FROM Rows ORDER BY _fm_record_id', 1000));
      await run(op.replica, op.policy);
      assert.deepEqual(actual(), stable, 'retry is value-idempotent');
      assert.equal(transport.accepted.length, accepted, 'retry sends no redundant writes');
      assert.deepEqual(stores.map((s) => s.query('SELECT _fm_record_id, _fm_mod_id FROM Rows ORDER BY _fm_record_id', 1000)), localVersions, 'retry leaves local versions unchanged');
      const logs = readSyncLog(stores[op.replica - 1], { limit: 10000 });
      assert.ok(!logs.some((l) => l.status === 'attempt'), 'no unfinished attempt after recovery');
    }
    return actual();
  } finally {
    await transport.close();
    for (const store of stores) store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('seeded offline replicas agree with the reference model through faults and retries', { timeout: 55_000 }, async (t) => {
  const seeds = process.env.SYNC_MODEL_SEED === undefined ? [1, 2, 37, 91] : [Number(process.env.SYNC_MODEL_SEED)];
  for (const seed of seeds) {
    assert.ok(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'seed must be uint32');
    const count = 2 + seed % 2, history = generate(seed, count);
    try {
      const result = await replay(history, count);
      for (const replica of result) assert.deepEqual(replica, result[0], 'quiescent full sweep converges');
    } catch (error) {
      const sweeps = history.slice(-2 * (count - 1));
      const shrunk = await shrink(history, async (candidate) => {
        // Keep the final full sweeps: an intentionally unsynced tail is not a
        // reproduction of a convergence failure after a completed full sync.
        if (!sweeps.every((op, i) => candidate[candidate.length - sweeps.length + i] === op)) return false;
        try {
          const result = await replay(candidate, count, false);
          for (const replica of result) assert.deepEqual(replica, result[0], 'quiescent full sweep converges');
          return false;
        }
        catch (e) { return identity(e) === identity(error); }
      });
      assert.fail(`seed=${seed} replicas=${count}\n${identity(error)}\nshrunk history (bounded 24 replays / 10 seconds):\n${JSON.stringify(shrunk, null, 2)}`);
    }
    t.diagnostic(`seed=${seed} replicas=${count} operations=${history.length}`);
  }
});

test('history shrinking preserves the failure and removes irrelevant operations', async () => {
  const history = generate(1, 2).slice(0, 6);
  const culprit = history[2];
  const result = await shrink(history, async (candidate) => candidate.includes(culprit));
  assert.deepEqual(result, [culprit]);
});

test('offline pushes and their retries still require current Data API record and field privileges', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-sync-privileges-'));
  const servedPath = join(dir, 'Remote' + STORE_EXT);
  createStore(servedPath);
  const app = await serve({ dir, port: 0, watch: false, log: () => {} });
  const remote = app.host.get('Remote')!;
  const localPath = join(dir, 'local.sqlite');
  createStore(localPath);
  const local = new Store(localPath, 'Local');
  const run = async (user: string) => {
    const client = dataApiClient({ server: app.url, database: 'Remote', user, password: 'pw', tables: [config] });
    try { return await applySync(local, 'Local', [config], client, client, { write: true, pull: true, allowDeletes: true }); }
    finally { await client.close(); }
  };
  try {
    assert.equal(new URL(app.url).hostname, '127.0.0.1');
    for (const store of [remote, local]) store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'A' }, { name: 'B' }] }]);
    remote.setPassword('Admin', 'pw', '[Full Access]');
    const permissions = (write: boolean, field = false) => remote.savePrivilegeSet({
      name: 'Sync', records: { view: true, edit: write, create: write, delete: write },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
      ...(field ? { tables: { Rows: { view: true, edit: true, create: true, delete: true, fields: { B: 'viewOnly' as const } } } } : {}),
    } satisfies PrivilegeDefinition);
    permissions(true);
    remote.setPassword('Sync', 'pw', 'Sync');
    for (const key of ['edit', 'delete']) remote.create('Rows', { uuid: key, A: 'initial', B: 'protected' });
    await run('Sync');
    const ids = Object.fromEntries(local.query('SELECT uuid, _fm_record_id id FROM Rows', 100).map((r) => [String(r.uuid), Number(r.id)]));
    // An account refusal stops a batch. Exercise each operation independently so
    // a denied create cannot hide an untested update or delete later in the batch.
    for (const edit of [
      () => local.create('Rows', { uuid: 'create', A: 'offline create' }),
      () => local.update('Rows', ids.edit, { A: 'offline edit' }),
      () => local.delete('Rows', ids.delete),
    ]) {
      edit();
      const before = snapshot(remote), pending = snapshot(local);
      // Privileges change while the replica is offline, before its queued write is sent.
      permissions(false);
      for (let retry = 0; retry < 2; retry++) {
        const denied = await run('Sync');
        assert.equal(denied.tables[0].failed.length, 1, 'pushed operation denied');
        assert.deepEqual(snapshot(remote), before, 'denied pushes change no remote records');
        assert.deepEqual(snapshot(local), pending, 'denied pushes preserve offline writes');
        assert.ok(!readSyncLog(local, { runId: denied.runId }).some((l) => ['create', 'update', 'delete'].includes(l.op) && l.status === 'ok'), 'denied writes are not acknowledged');
      }
      permissions(true);
      const resumed = await run('Sync');
      assert.deepEqual(resumed.tables[0].failed, []);
      assert.deepEqual(snapshot(remote), pending, 'authorized retry retains every queued write');
    }
    permissions(true, true);
    local.update('Rows', ids.edit, { B: 'forbidden offline field' });
    const protectedBefore = snapshot(remote);
    for (let retry = 0; retry < 2; retry++) {
      const denied = await run('Sync');
      assert.equal(denied.tables[0].failed.length, 1, 'field privilege enforced on every retry');
      assert.deepEqual(snapshot(remote), protectedBefore);
    }
    permissions(true);
    await run('Sync');
    assert.deepEqual(snapshot(remote), snapshot(local));
    const settled = snapshot(remote);
    const again = await run('Sync');
    assert.equal(again.tables[0].created + again.tables[0].updated + again.tables[0].deleted, 0);
    assert.deepEqual(snapshot(remote), settled);
  } finally {
    local.close();
    await new Promise<void>((done) => app.server.close(() => done()));
    await app.host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
