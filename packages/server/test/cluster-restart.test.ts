// A cluster worker that stops is started again after a wait that grows while it keeps failing, and a start that
// fails is tried again rather than left for good. The waits are short here; the processes are real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveCluster } from '../src/index.ts';

const until = async (what: string, ok: () => boolean, ms = 20_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return;
  assert.fail(`timed out waiting for ${what}`);
};

test('a worker that stopped is started again, a failed start is retried with a longer wait', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cluster-restart-'));
  const lines: { at: number; text: string }[] = [];
  const starts: number[] = [];
  let failNext = 0;
  const cluster = await serveCluster({ dir, port: 0, watch: false, log: (text) => lines.push({ at: Date.now(), text }) }, 2, false, {
    firstMs: 100, maxMs: 300, stableMs: 600_000,
    beforeStart: (id) => { starts.push(Date.now()); if (id === 1 && failNext > 0) { failNext--; throw new Error('cannot start (test)'); } },
  });
  try {
    const health = async () => (await fetch(`${cluster.url}/tabularius/health`).catch(() => undefined))?.status;
    assert.equal(await health(), 200);
    const first = cluster.pids()[1];
    assert.ok(first);

    // The first restart fails, and so does the second; the third works. The waits are 100, 200 and 300 ms.
    failNext = 2;
    starts.length = 0;
    const killed = Date.now();
    process.kill(first, 'SIGKILL');
    await until('the worker to be running again', () => cluster.pids()[1] !== undefined && cluster.pids()[1] !== first && starts.length >= 3);
    assert.equal(starts.length, 3, 'three attempts, no more');
    const gaps = [starts[0] - killed, starts[1] - starts[0], starts[2] - starts[1]];
    assert.ok(gaps[0] >= 90, `first wait ${gaps[0]} ms`);
    assert.ok(gaps[1] >= 190, `second wait is longer: ${gaps[1]} ms`);
    assert.ok(gaps[2] >= 290, `third wait is longer still: ${gaps[2]} ms`);
    assert.equal(lines.filter((l) => /could not start again/.test(l.text)).length, 2, 'each failure is reported');
    for (let i = 0; i < 100 && (await health()) !== 200; i++) await sleep(50);
    assert.equal(await health(), 200);

    // Killed again soon after it came back (not yet stable): the wait is still the grown one, not the first.
    starts.length = 0;
    const second = cluster.pids()[1]!;
    const killedAgain = Date.now();
    process.kill(second, 'SIGKILL');
    await until('another restart', () => starts.length >= 1 && cluster.pids()[1] !== second);
    assert.ok(starts[0] - killedAgain >= 290, `kept the long wait: ${starts[0] - killedAgain} ms`);
  } finally {
    await cluster.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a worker that stayed up long enough starts the wait over', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cluster-restart-'));
  const starts: number[] = [];
  const cluster = await serveCluster({ dir, port: 0, watch: false, log: () => {} }, 2, false, {
    firstMs: 100, maxMs: 2000, stableMs: 0,
    beforeStart: () => { starts.push(Date.now()); },
  });
  try {
    for (let round = 0; round < 3; round++) {
      const pid = cluster.pids()[1]!;
      starts.length = 0;
      const killed = Date.now();
      process.kill(pid, 'SIGKILL');
      await until('a restart', () => starts.length >= 1 && cluster.pids()[1] !== pid);
      assert.ok(starts[0] - killed < 600, `round ${round}: waited ${starts[0] - killed} ms, the first wait again`);
      await sleep(50);
    }
  } finally {
    await cluster.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
