// Canceling server-side scripts from the admin console: a running script stops
// at its next step (or ends a Pause at once), one waiting never starts and its
// Perform Script on Server caller gets "user canceled action".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '@tabularius/scripts';
import { ScriptQueue } from '../src/server-queue.ts';
import { serve } from '../src/index.ts';

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await sleep(10);
  assert.ok(ok());
};

async function beforeDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test('a canceled script stops at its next step, and a Pause ends at once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cancel-'));
  createStore(join(dir, 'Jobs.sqlite'));
  const store = new Store(join(dir, 'Jobs.sqlite'), 'Jobs');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Things', fields: [{ name: 'Name', type: 'text' }] },
      { op: 'createScript', name: 'Forever', text: ['Loop', '  Set Variable [ $i ; Value: $i + 1 ]', 'End Loop'].join('\n') },
      { op: 'createScript', id: 20, name: 'Wait', text: 'Pause/Resume Script [ Duration (seconds): 600 ]' },
      { op: 'createScript', name: 'Ask', steps: [
        { stepId: 164, name: 'Perform Script on Server', enabled: true, params: { script: { id: 20, name: 'Wait' } } },
        { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastError )' } },
      ] },
    ] as never);
    const queue = new ScriptQueue(1);
    const forever = queue.run((stop) => runScript(store, 'Forever', { ...(stop ? { stop } : {}), maxSteps: 10_000_000, timeoutMs: 60_000 }), { file: 'Jobs', script: 'Forever', kind: 'schedule' });
    // Waiting behind it: Ask's Perform Script on Server.
    const ask = runScript(store, 'Ask', { serverQueue: queue, account: 'Ann' });
    await until(() => queue.queued === 1);
    assert.deepEqual(queue.list().queued.map((j) => [j.script, j.kind, j.account]), [['Wait', 'server', 'Ann']]);
    const started = Date.now();
    assert.ok(queue.cancel(queue.list().queued[0].id));
    assert.equal((await ask).result, '1', 'the caller hears "user canceled action"');
    assert.ok(queue.cancel(queue.list().running[0].id));
    const r = await forever;
    assert.ok(r.actions.some((a) => a.step === 'Halt Script' && /canceled/.test(String((a as { reason?: string }).reason))));
    assert.ok(Date.now() - started < 5000);

    const paused = queue.run((stop) => runScript(store, 'Wait', { ...(stop ? { stop } : {}) }), { file: 'Jobs', script: 'Wait' });
    await until(() => queue.running === 1);
    queue.cancel(queue.list().running[0].id);
    await beforeDeadline(paused, 2000, 'the 10-minute pause did not end within 2 seconds');
    assert.deepEqual(queue.list().recent.map((x) => [x.script, x.outcome]).slice(0, 3), [['Wait', 'canceled'], ['Forever', 'canceled'], ['Wait', 'canceled']]);
    assert.equal((await paused).error, 1, 'a canceled run ends with "user canceled action", not as a success');

    // A Perform Script on Server canceled while it runs: the caller hears error 1 too.
    const asking = runScript(store, 'Ask', { serverQueue: queue, account: 'Ann' });
    await until(() => queue.running === 1);
    queue.cancel(queue.list().running[0].id);
    assert.equal((await asking).result, '1');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('admin console: list server-side scripts and cancel one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cancel-admin-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const api = (method: string, path: string) => fetch(`${s.url}/tabularius/admin/v1/server-scripts${path}`, { method, headers: { 'x-tabularius-admin': '1' } })
      .then(async (r) => ({ status: r.status, body: await r.json() }));
    const run = s.host.serverScripts.run((stop) => new Promise<{ error: number }>((r) => stop!.addEventListener('abort', () => r({ error: 0 }))), { file: 'Sales', script: 'Nightly', account: 'Ann', kind: 'schedule' });
    const listed = await api('GET', '');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.running.map((j: { script: string; kind: string }) => [j.script, j.kind]), [['Nightly', 'schedule']]);
    const status = await fetch(`${s.url}/tabularius/admin/v1/status`, { headers: { 'x-tabularius-admin': '1' } }).then((r) => r.json());
    assert.equal(status.serverScripts.running.length, 1, 'the console page gets it with the rest');
    const id = listed.body.running[0].id;
    assert.equal((await api('POST', `/${id}/cancel`)).status, 200);
    await run;
    assert.equal((await api('POST', `/${id}/cancel`)).status, 404, 'already ended');
    assert.deepEqual((await api('GET', '')).body.recent.map((x: { outcome: string; canceledBy: string }) => [x.outcome, x.canceledBy]), [['canceled', 'an administrator']]);
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true });
  }
});
