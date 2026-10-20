import { test } from 'node:test';
import { probe, moduleUrl } from './edge-child-probe.ts';

test('AR-server-edge-01', async () => {
  await probe(`
    import assert from 'node:assert/strict';
    import { serve } from ${moduleUrl('../src/index.ts')};
    import { RawClient, request } from ${moduleUrl('./edge-test-helpers.ts')};
    const app = await serve({ dir: process.argv[1], port: 0, watch: false, checkFiles: false, statsInterval: 0, log() {} });
    try {
      const c = await new RawClient(Number(new URL(app.url).port)).ready();
      assert.ok((await c.send(request('//[', 'Connection: close\\r\\n')).end()).startsWith('HTTP/1.1 400 '));
      assert.equal((await fetch(app.url + '/tabularius/health')).status, 200);
    } finally { await new Promise(resolve => app.server.close(resolve)); }
  `);
});

for (const mode of ['sync', 'async', 'partial']) test(`AR-server-edge-01 ${mode}`, async () => {
  await probe(`
    import assert from 'node:assert/strict';
    import { createEdgeServer } from ${moduleUrl('../src/edge-limits.ts')};
    import { RawClient, request } from ${moduleUrl('./edge-test-helpers.ts')};
    const server = createEdgeServer((req, res) => {
      if (req.url === '/') { res.end('ok'); return; }
      if (${JSON.stringify(mode)} === 'sync') throw new Error('test');
      if (${JSON.stringify(mode)} === 'partial') res.write('partial');
      return Promise.reject(new Error('test'));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = server.address().port;
      const c = await new RawClient(port).ready();
      const text = await c.send(request('/fail', 'Connection: close\\r\\n')).end();
      if (${JSON.stringify(mode)} !== 'partial') assert.ok(text.startsWith('HTTP/1.1 500 '));
      assert.equal((await fetch('http://127.0.0.1:' + port)).status, 200);
    } finally { await new Promise(resolve => server.close(resolve)); }
  `);
});

for (const mode of ['listen', 'early', 'listening']) test(`AR-server-edge-05 ${mode}`, async () => {
  await probe(`
    import assert from 'node:assert/strict';
    import { createServer } from 'node:http';
    import { serve } from ${moduleUrl('../src/index.ts')};
    import { Host } from ${moduleUrl('../src/host.ts')};
    import { claimFolder } from ${moduleUrl('../src/backup.ts')};
    const occupied = createServer();
    await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
    const active = new Map();
    const set = globalThis.setInterval, clear = globalThis.clearInterval;
    globalThis.setInterval = (...args) => { const timer = set(...args); active.set(timer, new Error().stack); return timer; };
    globalThis.clearInterval = timer => { active.delete(timer); clear(timer); };
    const original = Host.prototype.close;
    const baseUrl = Host.prototype.setBaseUrl;
    if (${JSON.stringify(mode)} === 'listening') Host.prototype.setBaseUrl = () => { throw new Error('test'); };
    let closed = false;
    Host.prototype.close = async function (...args) {
      assert.throws(() => claimFolder(process.argv[1], 'restore'), /already hosted/);
      await new Promise(resolve => setTimeout(resolve, 25));
      await original.apply(this, args);
      closed = true;
    };
    try {
      await assert.rejects(serve({ dir: process.argv[1], port: ${JSON.stringify(mode)} === 'listening' ? 0 : occupied.address().port, checkFiles: false, statsInterval: 0, log() {},
        ...(${JSON.stringify(mode)} === 'early' ? { tlsCert: process.argv[1] + '/missing-cert', tlsKey: process.argv[1] + '/missing-key' } : {})
      }));
      assert.equal(closed, true, 'host cleanup completed before rejection');
      claimFolder(process.argv[1], 'restore')();
      Host.prototype.setBaseUrl = baseUrl;
      assert.equal(active.size, 0, [...active.values()].join('\\n'));
      const retry = await serve({ dir: process.argv[1], port: 0, checkFiles: false, statsInterval: 0, log() {} });
      await new Promise(resolve => retry.server.close(resolve));
      assert.equal(active.size, 0, 'normal shutdown releases intervals too');
    } finally {
      Host.prototype.close = original;
      Host.prototype.setBaseUrl = baseUrl;
      for (const timer of active.keys()) clear(timer);
      globalThis.setInterval = set; globalThis.clearInterval = clear;
      await new Promise(resolve => occupied.close(resolve));
    }
  `);
});

test('AR-server-edge-06', async () => {
  await probe(`
    import assert from 'node:assert/strict';
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { serveCluster } from ${moduleUrl('../src/index.ts')};
    process.execArgv = ['--no-warnings'];
    const fork = cp.fork, children = [];
    cp.fork = (...args) => { const child = fork(...args); children.push(child); return child; };
    syncBuiltinESMExports();
    const cluster = await serveCluster({ dir: process.argv[1], port: 0, watch: false, checkFiles: false, statsInterval: 0, log() {} }, 2);
    const follower = children.find(c => c.pid === cluster.pids()[1]);
    const send = follower.send;
    follower.send = function (msg, ...args) { return msg.t === 'stop' ? true : send.call(this, msg, ...args); };
    await cluster.close();
    assert.equal(follower.signalCode, 'SIGKILL');
    assert.ok(children.every(c => c.exitCode !== null || c.signalCode !== null));
  `, 40_000);
});

test('AR-server-edge-07', async () => {
  await probe(`
    import assert from 'node:assert/strict';
    import { ScriptQueue } from ${moduleUrl('../src/server-queue.ts')};
    const queue = new ScriptQueue(1);
    let release;
    const active = queue.run(() => new Promise(resolve => { release = resolve; }));
    const results = [];
    for (let i = 0; i < 2000; i++) {
      try { results.push(queue.run(async () => {}, { file: 'Review', script: 'Run' }).catch(e => e)); }
      catch (e) { results.push(Promise.resolve(e)); }
    }
    try {
      assert.ok(queue.queued <= 1000, 'finite pending budget');
    } finally {
      for (const job of queue.list().queued) queue.cancel(job.id);
      release(); await active;
    }
    const errors = await Promise.all(results);
    assert.ok(errors.some(e => e?.code === 812 && /queue.*full/i.test(e.message)), 'explicit refusal');
    assert.equal(queue.queued, 0);
    assert.equal(queue.running, 0);
  `);
});

test('AR-server-edge-05 shared budget ownership', async () => {
  await probe(`
    import assert from 'node:assert/strict';
    import { watchEventLoop, timeLeft } from ${moduleUrl('../../store/src/errors.ts')};
    const first = watchEventLoop(60_000);
    const second = watchEventLoop(10_000);
    assert.ok(timeLeft() <= 10_000);
    first(); first();
    assert.ok(timeLeft() <= 10_000);
    second();
    assert.equal(timeLeft(), Infinity);
    const edited = watchEventLoop(30_000);
    assert.ok(timeLeft() > 20_000 && timeLeft() <= 30_000);
    edited();
    assert.equal(timeLeft(), Infinity);
  `);
});
