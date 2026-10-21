import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../../store/src/index.ts';
import { ScriptDebugger, RunProfile } from '../../../scripts/src/index.ts';
import { DebugApi } from '../../src/debug.ts';

const api = new DebugApi({} as never, { alive: () => false } as never);
const runs = (api as unknown as { runs: Map<string, unknown> }).runs;

async function running(id: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-debug-expiry-'));
  const file = join(dir, 'copy.sqlite');
  createStore(file);
  const store = new Store(file, 'Test');
  const stop = new AbortController();
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const debuggerRun = new ScriptDebugger();
  const finished = debuggerRun.start(store, {
    id: 99100, name: 'waiting', steps: [{ stepId: 62, name: 'Pause/Resume Script', enabled: true, line: 'Pause/Resume Script' }],
  } as never, {
    stop: stop.signal,
    pause: () => { entered(); return new Promise<boolean>((resolve) => stop.signal.addEventListener('abort', () => resolve(false), { once: true })); },
  });
  await waiting;
  assert.equal(debuggerRun.running, true);
  runs.set(id, { id, db: 'Test', token: 'expired', script: 'waiting', debugger: debuggerRun, touched: 0, scratch: { store, dir }, profile: new RunProfile(), stop });
  return { dir, finished };
}

const swept = await running('swept');
(api as unknown as { expire(): void }).expire();
await swept.finished;
await new Promise((resolve) => setImmediate(resolve));
assert.equal(existsSync(swept.dir), false);

const stopped = await running('stopped');
api.stop();
await stopped.finished;
await new Promise((resolve) => setImmediate(resolve));
assert.equal(existsSync(stopped.dir), false);
