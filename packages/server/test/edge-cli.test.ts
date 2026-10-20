import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawClient, request } from './edge-test-helpers.ts';

async function launch(t: TestContext, flags: string[], cap: string) {
  const dir = mkdtempSync(join(tmpdir(), 'edge-cli-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('TABULARIUS_')));
  const child = spawn(process.execPath, ['--no-warnings', join(import.meta.dirname, '../../cli/src/main.ts'),
    'serve', dir, '--port', '0', '--host', '127.0.0.1', ...flags], {
    env: { ...env, TABULARIUS_HOME: dir, TABULARIUS_CONNECTIONS_PER_ADDRESS: cap }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', c => { output += c; });
  child.stderr.on('data', c => { output += c; });
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  t.after(async () => {
    if (child.exitCode === null && !child.signalCode) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { child, exited, output: () => output };
}

for (const workers of [0, 1, 2]) test(workers ? `CLI cap flag overrides its environment default with ${workers} worker(s)` : 'CLI uses the environment connection cap without a flag', { timeout: 45000 }, async t => {
  const running = await launch(t, workers ? ['--connections-per-address', '2', '--workers', String(workers)] : [], workers ? '1' : '2');
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI did not start: ' + running.output())), 30000);
    const check = () => {
      const match = /Web client: http:\/\/127\.0\.0\.1:(\d+)/.exec(running.output());
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    };
    running.child.stdout.on('data', check);
    void running.exited.then(() => { clearTimeout(timer); reject(new Error(running.output())); });
    check();
  });
  const first = await new RawClient(port).ready();
  const second = await new RawClient(port).ready();
  t.after(() => { first.socket.destroy(); second.socket.destroy(); });
  first.send(request('/tabularius/health'));
  await first.until(s => s.includes('200 OK'));
  second.send(request('/tabularius/health'));
  await second.until(s => s.includes('200 OK'));
  const excess = await new RawClient(port).ready();
  assert.equal(await excess.end(), '');
  first.socket.destroy(); second.socket.destroy();
  await Promise.all([first.closed, second.closed]);
});

test('invalid environment connection caps fail before listening', { timeout: 45000 }, async t => {
  for (const cap of ['0', '-1', '1.5', '9007199254740992']) {
    const running = await launch(t, [], cap);
    assert.equal(await running.exited, 1);
    assert.match(running.output(), /connections-per-address.*positive whole number/);
    assert.doesNotMatch(running.output(), /Web client:/);
  }
});
