import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, writer } from '@tabularius/store';
import { runScript, ScriptDebugger } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-tx-cancel-'));
createStore(join(dir, 'T.openhbam.sqlite'));
const store = new Store(join(dir, 'T.openhbam.sqlite'), 'T');
try {
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name', type: 'text' }] }]);
  const id = store.create('T', { Name: 'before' }).recordId;
  store.applyDesign([{ op: 'createScript', name: 'Run', text: 'Open Transaction\nSet Field [ T::Name ; "changed" ]\nCommit Records/Requests\nCommit Transaction' }]);
  const stop = new AbortController();
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => { entered = resolve; });
  const running = writer.run({ owner: 'first' }, () => runScript(store, 'Run', {
    layout: 'T', foundSet: [id], recordId: id, stop: stop.signal,
    debug: (p) => p.index === 3 ? (entered(), new Promise<never>(() => {})) : undefined,
  }));
  await paused;
  stop.abort();
  const result = await running;
  assert.equal(result.error, 1);
  assert.equal(store.get('T', id).fieldData.Name, 'before');
  writer.run({ owner: 'second' }, () => store.update('T', id, { Name: 'next' }));
  store.update('T', id, { Name: 'before' });
  const debuggerStop = new AbortController();
  const debuggerRun = new ScriptDebugger({ breakpoints: [{ script: 'Run', index: 3 }] });
  const state = await writer.run({ owner: 'debugger' }, () => debuggerRun.start(store, 'Run', {
    layout: 'T', foundSet: [id], recordId: id, stop: debuggerStop.signal,
  }));
  assert.equal(state.paused?.index, 3);
  debuggerStop.abort();
  for (let i = 0; debuggerRun.running && i < 100; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(debuggerRun.state().done?.error, 1);
  assert.equal(store.get('T', id).fieldData.Name, 'before');
  writer.run({ owner: 'third' }, () => store.update('T', id, { Name: 'next' }));
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
