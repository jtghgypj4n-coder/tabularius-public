import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboundHooks } from '../src/inbound-hooks.ts';
import { Schedules } from '../src/schedules.ts';
import { SyncConsole } from '../src/sync-console.ts';
import type { Host } from '../src/host.ts';

for (const kind of ['hooks', 'schedules', 'sync'] as const) {
  test(`${kind} best-effort history skips a busy lock and writes once available`, { timeout: 10000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'history-lock-'));
    const logs: string[] = [];
    const host = { dir, onAdd: [], names: () => [], scriptOptions: () => ({}) } as unknown as Host;
    const hooks = new InboundHooks(host, true, (s) => logs.push(s));
    const schedules = new Schedules(host, (s) => logs.push(s)); schedules.stop();
    const sync = new SyncConsole(host, (s) => logs.push(s));
    const name = { hooks: 'inbound-hook-calls.jsonl', schedules: '.openhbam-schedule-runs.json', sync: '.openhbam-sync-last.json' }[kind];
    const file = join(dir, name);
    const write = () => {
      if (kind === 'hooks') hooks['logCall']('test', { at: new Date().toISOString(), status: 200, outcome: 'ok', ms: 1 });
      else if (kind === 'schedules') schedules['saveRuns']('test');
      else sync['saveLast']('test');
    };
    const source = `import { withStateLock } from ${JSON.stringify(new URL('../../store/src/durable.ts', import.meta.url).href)};
      withStateLock(process.argv[1], () => { process.send('held'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000); });`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, file], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const exited = once(child, 'exit');
    try {
      await once(child, 'message');
      const start = performance.now(); write();
      assert.ok(performance.now() - start < 2000, 'history must not wait for the 6000 ms holder');
      assert.equal(existsSync(file), false, 'must skip the write while another process owns the lock');
      assert.match(logs.at(-1)!, /Timed out after 50 ms/);
      child.kill(); await exited;
      write();
      assert.ok(readFileSync(file, 'utf8').length);
    } finally { child.kill(); await exited; rmSync(dir, { recursive: true, force: true }); }
  });
}
