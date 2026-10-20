import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { updateJsonStateSync, withStateLock } from '../src/durable.ts';

const moduleUrl = new URL('../src/durable.ts', import.meta.url).href;

/** Run a child that takes the state lock, marks `held`, then runs `inside` while holding it. */
function holder(dir: string, file: string, inside: string): { child: ChildProcess; exited: Promise<number | null> } {
  const source = `import { updateJsonStateSync } from ${JSON.stringify(moduleUrl)};
    import { writeFileSync } from 'node:fs';
    updateJsonStateSync(${JSON.stringify(file)}, { by: [] }, (x) => {
      writeFileSync(${JSON.stringify(join(dir, 'held'))}, '');
      ${inside}
      return { by: [...x.by, 'holder'] };
    });`;
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', source], { stdio: ['ignore', 'ignore', 'inherit'] });
  const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve(code)); });
  return { child, exited };
}

async function until(path: string): Promise<void> {
  const end = Date.now() + 10_000;
  while (!existsSync(path)) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${path}`);
    await sleep(5);
  }
}

test('a holder killed mid-lock leaves nothing that blocks the next writer', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-killed-holder-'));
  const file = join(dir, 'state.json');
  const { child, exited } = holder(dir, file, 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);');
  try {
    await until(join(dir, 'held'));
    // While it lives, the lock really is held.
    assert.throws(() => withStateLock(file, () => assert.fail('entered a held lock'), 0), /another tabularius process is writing it/);
    child.kill('SIGKILL');
    await exited;
    const started = performance.now();
    const next = updateJsonStateSync(file, { by: [] as string[] }, (x) => ({ by: [...x.by, 'next'] }), { lockWaitMs: 0 });
    const waited = performance.now() - started;
    assert.deepEqual(next, { by: ['next'] });
    assert.ok(waited < 2000, `next writer took ${waited.toFixed(1)} ms`);
    // No staging directories, owner records, or journals are left behind by the crash.
    assert.deepEqual(readdirSync(dir).sort(), ['held', 'state.json', 'state.json.lock.db']);
  } finally {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a lock db left over from another container or boot never blocks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-leftover-lock-'));
  try {
    const file = join(dir, 'state.json');
    // All a crashed process in another PID namespace leaves is the file itself (and, at worst, an empty journal).
    writeFileSync(`${file}.lock.db`, '');
    writeFileSync(`${file}.lock.db-journal`, '');
    assert.deepEqual(updateJsonStateSync(file, { count: 0 }, (x) => ({ count: x.count + 1 }), { lockWaitMs: 0 }), { count: 1 });
    assert.deepEqual(updateJsonStateSync(file, { count: 0 }, (x) => ({ count: x.count + 1 }), { lockWaitMs: 0 }), { count: 2 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a slow holder (3 s) makes a waiter wait, not fail', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-slow-holder-'));
  const file = join(dir, 'state.json');
  const { child, exited } = holder(dir, file, 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000);');
  try {
    await until(join(dir, 'held'));
    const started = performance.now();
    const after = updateJsonStateSync(file, { by: [] as string[] }, (x) => ({ by: [...x.by, 'waiter'] }));
    const waited = performance.now() - started;
    assert.equal(await exited, 0);
    assert.deepEqual(after, { by: ['holder', 'waiter'] });
    assert.ok(waited > 2_000, `waiter entered after only ${waited.toFixed(0)} ms`);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { by: ['holder', 'waiter'] });
  } finally {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
