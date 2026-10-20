import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { ScriptQueue } from '../src/server-queue.ts';
import { AutomationRunner, automationRuns, saveAutomation } from '../src/automations.ts';

test('automation runs queue through overlap, refresh the enabled cache after its lifetime, and retain bounded history on restart', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-01-01T12:00:00Z') });
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-automation-reliability-'));
  let host: Host | undefined;
  try {
    host = new Host(dir, () => {});
    const store = host.create('Local');
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'text' }] },
      { op: 'createScript', name: 'Read value', text: 'Set Variable [ $seen ; Value: T::Value ]' },
    ]);
    store.setPassword('Admin', 'pw', '[Full Access]');
    const first = store.create('T', { Value: 'first' }).recordId;
    const second = store.create('T', { Value: 'second' }).recordId;
    const spec = { name: 'Read changes', layout: 'T', on: 'update', fields: ['Value'], script: 'Read value', account: 'Admin' };
    const made = saveAutomation(store, spec, 'Admin', []).automation;
    const queue = new ScriptQueue(1);
    const options = host.scriptOptions();
    host.scriptOptions = () => ({ ...options, serverQueue: queue });
    const runner = new AutomationRunner(host);
    let release!: () => void;
    const blocker = queue.run(() => new Promise<void>((resolve) => { release = resolve; }));
    store.update('T', first, { Value: 'one' });
    store.update('T', second, { Value: 'two' });
    for (let i = 0; i < 20 && queue.queued === 0; i++) await Promise.resolve();
    assert.equal(queue.queued, 1, 'the first automation waited for the occupied script slot');
    assert.equal(automationRuns(store, made.id).length, 0);
    release();
    await blocker;
    await runner.idle(store);
    assert.deepEqual(automationRuns(store, made.id).map((r) => [r.recordId, r.outcome]), [[second, 'ok'], [first, 'ok']]);

    for (let i = 0; i < 55; i++) store.update('T', first, { Value: String(i) });
    await runner.idle(store);
    assert.equal(automationRuns(store, made.id, 100).length, 50);
    const count = () => Number(store.sql.prepare('SELECT COUNT(*) AS n FROM _fm_automation_runs WHERE automation = ?').get(made.id)!.n);
    assert.equal(count(), 50, 'the persisted table is also bounded');
    const maxSeq = () => Number(store.sql.prepare('SELECT MAX(seq) AS n FROM _fm_automation_runs WHERE automation = ?').get(made.id)!.n);
    const before = maxSeq();

    // Simulate an edit made by another worker while this runner has a cached enabled list. The cache runs on the
    // monotonic clock, so a wall-clock reset neither expires nor outlives it; it lapses on elapsed time alone.
    t.mock.timers.setTime(Date.parse('2026-01-01T11:00:00Z'));
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    store.sql.prepare('UPDATE _fm_automations SET json = ? WHERE id = ?').run(JSON.stringify({ ...made, enabled: false }), made.id);
    store.update('T', first, { Value: 'after clock reset' });
    await runner.idle(store);
    assert.equal(maxSeq(), before, 'the stale enabled cache lapsed after its monotonic lifetime');

    saveAutomation(store, { ...spec, enabled: true }, 'Admin', [], undefined, made.id);
    await host.close();
    host = new Host(dir, () => {});
    const reopened = host.get('Local')!;
    assert.ok(reopened);
    assert.equal(automationRuns(reopened, made.id, 100).length, 50);
    const resumed = new AutomationRunner(host);
    reopened.update('T', second, { Value: 'after restart' });
    await resumed.idle(reopened);
    assert.equal(automationRuns(reopened, made.id, 1)[0].recordId, second);
    assert.equal(automationRuns(reopened, made.id, 100).length, 50);
  } finally {
    await host?.close();
    t.mock.timers.reset();
    rmSync(dir, { recursive: true, force: true });
  }
});
