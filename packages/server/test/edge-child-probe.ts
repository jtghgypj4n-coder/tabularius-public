import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const moduleUrl = (name: string) => JSON.stringify(new URL(name, import.meta.url).href);
export async function probe(source: string, timeout = 15_000): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-edge-lifecycle-'));
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', source, dir], {
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const kill = () => {
    try { if (process.platform !== 'win32') process.kill(-child.pid!, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
  };
  const timer = setTimeout(kill, timeout);
  try {
    const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(result.code, 0, `${result.signal ?? ''}\n${output}`);
  } finally {
    clearTimeout(timer);
    kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

