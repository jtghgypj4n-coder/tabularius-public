// Server-side scripts take turns: so many at once, first come first served.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CanceledError, ScriptQueue } from '../src/server-queue.ts';
import { ServerLogs } from '../src/server-logs.ts';

test('at most the limit run at once, and the rest start in the order they asked', async () => {
  const queue = new ScriptQueue(2);
  let now = 0;
  let most = 0;
  const started: number[] = [];
  const job = (n: number) => queue.run(async () => {
    started.push(n);
    most = Math.max(most, ++now);
    await sleep(20);
    now--;
    if (n === 3) throw new Error('a script that fails gives its turn up too');
    return n;
  });
  const runs = [1, 2, 3, 4, 5].map((n) => job(n).catch((e: Error) => e.message));
  await sleep(5);
  assert.equal(queue.running, 2);
  assert.equal(queue.queued, 3);
  assert.deepEqual(await Promise.all(runs), [1, 2, 'a script that fails gives its turn up too', 4, 5]);
  assert.equal(most, 2);
  assert.deepEqual(started, [1, 2, 3, 4, 5]);
  assert.equal(queue.running, 0);
  assert.equal(queue.queued, 0);
});

test('the default is the greater of 50 and the number of cores, as on FileMaker Server', () => {
  assert.ok(new ScriptQueue().limit >= 50);
});

test('a Perform Script on Server that ends with an error goes in the script log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-queue-logs-'));
  try {
    const queue = new ScriptQueue(2);
    queue.logs = new ServerLogs(dir);
    await queue.run(async () => ({ error: 0 }), { file: 'Sales', script: 'Fine' });
    await queue.run(async () => ({ error: 101 }), { file: 'Sales', script: 'Totals', account: 'Ann' });
    await queue.run(() => Promise.reject(new Error('gone')), { file: 'Sales', script: 'Broken' }).catch(() => {});
    const { entries } = await queue.logs.read('ScriptEvent');
    assert.deepEqual(entries.map((e) => [e.source, e.message]), [
      ['Sales', 'Perform Script on Server "Broken" failed: gone'],
      ['Sales', 'Perform Script on Server "Totals" (Ann) ended with error 101'],
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the admin list shows what runs and waits, and a canceled waiting script never starts', async () => {
  const queue = new ScriptQueue(1);
  let release!: () => void;
  const v0 = queue.version;
  const first = queue.run(() => new Promise<string>((r) => (release = () => r('first'))), { file: 'Sales', script: 'Long', account: 'Ann', kind: 'schedule' });
  let ran = false;
  const second = queue.run(async () => (ran = true), { file: 'Sales', script: 'Next', kind: 'automation' });
  const listed = queue.list();
  assert.ok(queue.version > v0, 'a change is reported to the other workers');
  assert.deepEqual(listed.running.map((j) => [j.script, j.kind, j.account, j.state]), [['Long', 'schedule', 'Ann', 'running']]);
  assert.deepEqual(listed.queued.map((j) => [j.script, j.kind, j.state]), [['Next', 'automation', 'queued']]);
  assert.equal(queue.cancel(listed.queued[0].id, 'Jordan'), true);
  await assert.rejects(second, (e: Error & { code?: number }) => e instanceof CanceledError && e.code === 1);
  assert.equal(queue.queued, 0);
  release();
  assert.equal(await first, 'first');
  assert.equal(ran, false, 'it never started');
  assert.equal(queue.running, 0, 'the canceled one took no slot');
  assert.deepEqual(queue.list().recent.map((x) => [x.script, x.outcome, x.canceledBy ?? '']), [['Long', 'ok', ''], ['Next', 'canceled', 'Jordan']]);
  assert.equal(queue.cancel(listed.queued[0].id), false, 'already ended');
});

test('a running script is told to stop, and ends as canceled', async () => {
  const queue = new ScriptQueue(2);
  const run = queue.run((stop) => new Promise<{ error: number }>((r) => stop!.addEventListener('abort', () => r({ error: 0 }))), { file: 'Sales', script: 'Loop' });
  const [job] = queue.list().running;
  assert.equal(queue.cancel(job.id), true);
  await run;
  assert.deepEqual(queue.list().recent.map((x) => [x.outcome, x.canceledBy]), [['canceled', 'an administrator']]);
});

test("with several workers, the list holds everyone's scripts and a cancel reaches the worker running it", () => {
  const queue = new ScriptQueue(2);
  const canceled: string[] = [];
  const other = { limit: 2, running: [{ id: 'abc', file: 'Sales', script: 'There', kind: 'server' as const, state: 'running' as const, queuedAt: '2026-10-13T01:00:00Z', startedAt: '2026-10-13T01:00:01Z' }], queued: [], recent: [] };
  queue.elsewhere = { lists: () => [other], cancel: (id) => canceled.push(id) };
  const all = queue.overview();
  assert.equal(all.workers, 2);
  assert.equal(all.limit, 4);
  assert.deepEqual(all.running.map((j) => j.script), ['There']);
  assert.equal(queue.cancelAnywhere('abc', 'an administrator'), true);
  assert.deepEqual(canceled, ['abc']);
  assert.equal(queue.cancelAnywhere('gone', 'an administrator'), false);
});

test('a cancel landing just as a waiting script is handed its slot passes the slot on, and drops no one else', async () => {
  const queue = new ScriptQueue(1);
  let release!: () => void;
  const a = queue.run(() => new Promise<void>((r) => (release = r)), { file: 'F', script: 'A' });
  const b = queue.run(async () => 'b', { file: 'F', script: 'B' });
  const c = queue.run(async () => 'c', { file: 'F', script: 'C' });
  // B is handed A's slot, and canceled before its run picks it up.
  const waiting = (queue as unknown as { waiting: { id: string; turn: () => void }[] }).waiting;
  const jobB = waiting[0];
  const turn = jobB.turn;
  jobB.turn = () => {
    turn();
    assert.equal(queue.cancel(jobB.id), true);
  };
  release();
  await a;
  await assert.rejects(b, CanceledError);
  assert.equal(await c, 'c', 'C still ran');
  assert.equal(queue.running, 0, 'no slot was lost');
  assert.equal(queue.queued, 0);
});

test('AR-server-edge-07 producer budgets and returned capacity', async () => {
  const queue = new ScriptQueue(1, { pending: 3, perProducer: 2 });
  let release!: () => void;
  const active = queue.run(() => new Promise<void>(resolve => { release = resolve; }));
  const runs: Promise<unknown>[] = [];
  const submit = (file: string, kind: 'server' | 'schedule' = 'server') => queue.run(async () => file, { file, script: 'Run', kind });
  try {
    runs.push(submit('A').catch(e => e), submit('a').catch(e => e));
    const version = queue.version;
    assert.throws(() => submit('A'), { code: 812, message: /queue is full/ });
    assert.equal(queue.version, version, 'refusal retains no job');
    runs.push(submit('A', 'schedule'));
    assert.throws(() => submit('B'), { code: 812 });
    queue.cancel(queue.list().queued[0].id);
    runs.push(submit('B'));
    assert.equal(queue.queued, 3);
  } finally {
    release();
    await active;
    await Promise.all(runs);
  }
  assert.equal(queue.running, 0);
  assert.equal(queue.queued, 0);
  assert.equal(await submit('A'), 'A');
});

