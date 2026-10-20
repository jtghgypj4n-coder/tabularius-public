import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { Host } from '../src/host.ts';
import { Uploads } from '../src/uploads.ts';

const piece = (bytes: string) => Object.assign(Readable.from([Buffer.from(bytes)]), {
  headers: { 'content-length': String(bytes.length) },
}) as IncomingMessage;

test('AR-server-edge-02', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ownership-'));
  const host = new Host(dir);
  try {
    const leader = new Uploads(host, undefined, { idleMs: 0 });
    const u = leader.start({ name: 'Generated.fmp12', size: 3 });
    await leader.write(u.id, 0, piece('abc'));
    const follower = new Uploads(host, undefined, { idleMs: 0 });
    const other = follower.start({ name: 'Other.fmp12', size: 1 });
    follower.remove(other.id);
    assert.equal(leader.get(u.id).received, 3);
    assert.equal(readFileSync(join(dir, '.openhbam-uploads', u.id + '.part'), 'utf8'), 'abc');
    await leader.write(u.id, 1, piece('bc'));
    assert.doesNotThrow(() => leader.finish(u.id));
    await leader.remove(u.id);
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('AR-server-edge-02 cluster', async () => {
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { setTimeout as sleep } from 'node:timers/promises';
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    process.execArgv.splice(0);
    const ready = new Set();
    const fork = cp.fork;
    cp.fork = (...args) => {
      const worker = fork(...args);
      worker.on('message', message => { if (message.t === 'ready') ready.add(worker.pid); });
      return worker;
    };
    syncBuiltinESMExports();
    const { serveCluster, setAdminPassword } = await import('./packages/server/src/index.ts');
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-upload-cluster-'));
    let cluster;
    const watchdog = setTimeout(() => {
      for (const pid of cluster?.pids() ?? []) if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
      process.exit(72);
    }, 20_000);
    try {
      setAdminPassword(dir, 'generated-test-password');
      cluster = await serveCluster({ dir, port: 0, watch: false, checkFiles: false, statsInterval: 0, log: () => {} }, 2, false, { firstMs: 20 });
      const headers = { 'x-tabularius-admin': '1', authorization: 'Basic ' + Buffer.from('admin:generated-test-password').toString('base64') };
      const base = cluster.url + '/tabularius/admin/v1/uploads';
      const started = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ name: 'Generated.fmp12', size: 3 }) });
      assert.equal(started.status, 201);
      const { id } = await started.json();
      assert.equal((await fetch(base + '/' + id + '?offset=0', { method: 'PUT', headers, body: 'abc' })).status, 200);
      const first = cluster.pids()[1];
      process.kill(first, 'SIGKILL');
      while (!cluster.pids()[1] || cluster.pids()[1] === first || !ready.has(cluster.pids()[1])) await sleep(20);
      assert.equal(readFileSync(join(dir, '.openhbam-uploads', id + '.part'), 'utf8'), 'abc');
      assert.equal((await fetch(base + '/' + id + '?offset=1', { method: 'PUT', headers, body: 'bc' })).status, 200);
      assert.equal((await fetch(base + '/' + id + '/finish', { method: 'POST', headers })).status, 200);
    } finally {
      await cluster?.close();
      clearTimeout(watchdog);
      rmSync(dir, { recursive: true, force: true });
    }
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 25_000, killSignal: 'SIGKILL' });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr + child.stdout);
});

test('AR-server-edge-02 cleanup', async () => {
  const { spawnSync } = await import('node:child_process');
  const { existsSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-owner-exit-'));
  const host = new Host(dir);
  try {
    const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
      import { Host } from './packages/server/src/host.ts';
      import { Uploads } from './packages/server/src/uploads.ts';
      const host = new Host(process.argv[1]);
      const uploads = new Uploads(host, undefined, { idleMs: 0 });
      console.log(uploads.start({ name: 'Generated.fmp12', size: 3 }).id);
      await host.close();
    `, dir], { cwd: process.cwd(), timeout: 10_000, killSignal: 'SIGKILL', encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const abandoned = join(dir, '.openhbam-uploads', child.stdout.trim() + '.part');
    assert.equal(existsSync(abandoned), true);
    const unknown = join(dir, '.openhbam-uploads', 'legacy.part');
    writeFileSync(unknown, 'legacy');
    new Uploads(host, undefined, { idleMs: 0 });
    assert.equal(existsSync(abandoned), false);
    assert.equal(readFileSync(unknown, 'utf8'), 'legacy');
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});
