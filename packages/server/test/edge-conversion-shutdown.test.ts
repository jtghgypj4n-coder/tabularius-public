import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const mode of ['upload', 'scan', 'unlock']) test(`AR-server-edge-03 ${mode}`, () => {
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { Host, STORE_EXT } from './packages/server/src/host.ts';
    import { createStore } from './packages/store/src/index.ts';
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-close-'));
    const host = new Host(dir, () => {}, { encryptionKey: 'generated-test-key' });
    host.create('Existing');
    const gate = Promise.withResolvers();
    const entered = Promise.withResolvers();
    let calls = 0;
    host.convert = async (_src, dest) => {
      calls++;
      entered.resolve();
      await gate.promise;
      createStore(dest);
      return { tables: 0, records: 0 };
    };
    const source = join(dir, '${mode === 'upload' ? 'input' : 'Generated.fmp12'}');
    writeFileSync(source, 'abc');
    if ('${mode}' === 'scan') await host.scan();
    if ('${mode}' === 'unlock') host.locked.set('Generated.fmp12', { size: 3 });
    const work = ('${mode}' === 'upload' ? host.hostUpload(source, 'Generated') :
      '${mode}' === 'scan' ? host.scan() : host.unlock('Generated.fmp12', 'synthetic', undefined, { checked: true }))
      .then(() => undefined, e => e);
    await entered.promise;
    const queued = host.hostUpload(source, 'Queued').then(() => undefined, e => e);
    let closed = false;
    const closing = host.close().then(() => { closed = true; });
    await new Promise(r => setImmediate(r));
    const early = closed;
    gate.resolve();
    await work;
    await queued;
    await closing;
    try {
      assert.equal(early, false, 'close must retain conversion ownership');
      assert.equal(existsSync(join(dir, 'Generated' + STORE_EXT)), false);
      assert.equal(host.get('Generated'), undefined);
      assert.equal(existsSync(join(dir, 'Existing' + STORE_EXT)), false);
      assert.equal(existsSync(join(dir, 'Existing' + STORE_EXT + '.enc')), true);
      assert.equal(readdirSync(dir).some(n => n.includes('.tmp-')), false);
      await assert.rejects(host.hostUpload(source, 'Late'), /clos/i);
      assert.throws(() => host.create('Late'), /clos/i);
      await host.scan();
      assert.equal(calls, 1);
      await host.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  `], { cwd: process.cwd(), timeout: 15_000, killSignal: 'SIGKILL', encoding: 'utf8' });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr + child.stdout);
});

test('AR-server-edge-03 worker', () => {
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { mkdtempSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { Worker } from 'node:worker_threads';
    import { Host } from './packages/server/src/host.ts';
    process.execArgv.splice(0);
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-close-worker-'));
    const host = new Host(dir, () => {}, { encryptionKey: 'generated-test-key' });
    const source = join(dir, 'source.part');
    writeFileSync(source, 'abc');
    const exited = Promise.withResolvers();
    const release = Promise.withResolvers();
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = async function () {
      const code = await terminate.call(this);
      exited.resolve();
      await release.promise;
      return code;
    };
    const running = host.hostUpload(source, 'Generated').then(() => undefined, e => e);
    let closed = false;
    const closing = host.close().then(() => { closed = true; });
    try {
      await exited.promise;
      assert.equal(closed, false);
      assert.equal(readdirSync(dir).some(n => n.includes('.tmp-')), true);
      release.resolve();
      assert.match(String(await running), /clos/i);
      await closing;
      assert.equal(readdirSync(dir).some(n => n.includes('.tmp-')), false);
      assert.equal(existsSync(source), true);
      assert.equal(host.get('Generated'), undefined);
    } finally { release.resolve(); await closing; rmSync(dir, { recursive: true, force: true }); }
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 15_000 });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr + child.stdout);
});
