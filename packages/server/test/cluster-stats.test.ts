// With several worker processes, the admin console's slowest scripts and finds, and the metrics' request counts and
// durations, add up every worker's, not only those of the worker answering (the leader). Each worker passes its
// timings on every few seconds; a reset of the profile resets every worker's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { Profiler } from '../src/profiler.ts';
import { Metrics } from '../src/metrics.ts';
import { clusterRoute, serveCluster, setAdminPassword } from '../src/index.ts';
import { createStore } from '../../store/src/index.ts';

const finding = (ms: number) => ({ table: 'Orders', layout: 'Orders', fields: ['Total'], sort: [], ms, found: 1, total: 10, leadingWildcard: false });

test('a profile adds the other workers\' scripts, steps and finds to its own', () => {
  const here = new Profiler();
  const there = new Profiler();
  here.step('Shop', 'Ship', 1, 'Set Field', 10, 0);
  here.run('Shop', 'Ship', 12, 0, 1);
  there.step('Shop', 'Ship', 1, 'Set Field', 30, 0);
  there.step('Shop', 'Ship', 2, 'Commit', 5, 1);
  there.run('Shop', 'Ship', 40, 1, 2);
  there.run('Shop', 'Purge', 3, 0, 0);
  here.find('Shop', finding(4) as never);
  there.find('Shop', finding(6) as never);
  here.elsewhere = () => [there.snapshot()];

  const { scripts } = here.report();
  assert.deepEqual(scripts.map((s) => [s.script, s.runs, s.totalMs, s.maxMs, s.errors]), [['Ship', 2, 52, 40, 1], ['Purge', 1, 3, 3, 0]]);
  assert.deepEqual(scripts[0].slowestSteps.map((s) => [s.index, s.count, s.totalMs]), [[1, 2, 40], [2, 1, 5]]);
  assert.deepEqual(here.script('Shop', 'Ship')?.steps.map((s) => [s.index, s.count]), [[1, 2], [2, 1]]);
  assert.deepEqual(here.findReport().map((f) => [f.count, f.totalMs, f.maxMs]), [[2, 10, 6]]);
  // The other worker's own numbers are left as they were.
  assert.deepEqual(there.report().scripts.map((s) => [s.script, s.runs]), [['Ship', 1], ['Purge', 1]]);

  let told = 0;
  here.onReset = () => told++;
  here.reset();
  assert.equal(told, 1, 'a reset tells the other workers');
  there.reset(true);
  assert.deepEqual(here.report().scripts, []);
});

test('metrics add the other workers\' request counts and durations', () => {
  const here = new Metrics();
  const there = new Metrics();
  try {
    const answer = (m: Metrics, path: string, status: number) => {
      const res = Object.assign(new EventEmitter(), { statusCode: status, getHeader: () => 'application/json' });
      m.track({ method: 'GET' } as IncomingMessage, res as unknown as ServerResponse, path);
      res.emit('finish');
    };
    answer(here, '/fmi/data/vLatest/productInfo', 200);
    answer(there, '/fmi/data/vLatest/productInfo', 200);
    answer(there, '/fmi/data/vLatest/productInfo', 200);
    answer(there, '/fmi/odata/v4', 401);
    here.elsewhere = () => [there.snapshot()];
    const text = here.render();
    assert.match(text, /tabularius_http_requests_total\{route="dataapi",method="GET",status="2xx"\} 3\n/);
    assert.match(text, /tabularius_http_requests_total\{route="odata",method="GET",status="4xx"\} 1\n/);
    assert.match(text, /tabularius_http_request_duration_seconds_count\{route="dataapi"\} 3\n/);
  } finally {
    here.stop();
    there.stop();
  }
});

test('the leader\'s metrics count requests another worker answered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cluster-stats-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  setAdminPassword(dir, 'secret');
  const cluster = await serveCluster({ dir, port: 0, log: () => {} }, 2);
  try {
    // A credential the front sends to worker 1 (requests with credentials always go to the same worker).
    let n = 0;
    const bearer = () => `Bearer token${n}`;
    while (clusterRoute({ url: '/fmi/data/vLatest/productInfo', method: 'GET', headers: { authorization: bearer() } } as unknown as IncomingMessage, 2) !== 1) n++;
    for (let i = 0; i < 3; i++) await (await fetch(`${cluster.url}/fmi/data/vLatest/productInfo`, { headers: { authorization: bearer() } })).text();
    const admin = { authorization: 'Basic ' + btoa('admin:secret'), 'x-tabularius-admin': '1' };
    let count = 0;
    for (let i = 0; i < 40 && count < 3; i++) {
      const text = await (await fetch(`${cluster.url}/tabularius/admin/v1/metrics`, { headers: admin })).text();
      count = Number(/tabularius_http_requests_total\{route="dataapi",method="GET",status="2xx"\} (\d+)/.exec(text)?.[1] ?? 0);
      if (count < 3) await sleep(250);
    }
    assert.equal(count, 3, 'answered by worker 1, counted at the leader');
  } finally {
    await cluster.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
