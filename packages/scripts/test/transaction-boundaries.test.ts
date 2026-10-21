import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createStore, Store } from '@tabularius/store';
import { runScript, ScriptDebugger, type ServerQueue } from '../src/index.ts';
import { recordRun } from '../src/recorder.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-tx-'));
  createStore(join(dir, 'T.openhbam.sqlite'));
  const store = new Store(join(dir, 'T.openhbam.sqlite'), 'T');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name', type: 'text' }] }]);
  const id = store.create('T', { Name: 'before' }).recordId;
  let next = 0;
  const script = (text: string) => {
    const name = `Run ${++next}`;
    store.applyDesign([{ op: 'createScript', name, text }]);
    return name;
  };
  const value = () => store.get('T', id).fieldData.Name;
  const opts = { layout: 'T', foundSet: [id], recordId: id };
  return { store, id, script, value, opts };
}

test('AR-script-engine-03 revert', async (t) => {
  const { store, script, value, opts } = setup(t);
  const name = script('Open Transaction\nNew Window [ "Other" ]\nSet Field [ T::Name ; "changed" ]\nRevert Transaction\nCommit Transaction\nExit Script [ Text Result: Get ( LastError ) ]');
  const result = await runScript(store, name, opts);
  assert.equal(result.result, '0');
  assert.equal(value(), 'before');
});

test('AR-script-engine-03 commit', async (t) => {
  const { store, script, value, opts } = setup(t);
  const name = script('Open Transaction\nNew Window [ "Other" ]\nSet Field [ T::Name ; "changed" ]\nCommit Transaction\nExit Script [ Text Result: Get ( LastError ) ]');
  const result = await runScript(store, name, { ...opts, debug: (point) => {
    if (point.index === 4) assert.equal(value(), 'changed');
  } });
  assert.equal(result.result, '0');
  assert.equal(value(), 'changed');
});

test('AR-script-engine-04', async (t) => {
  const { store, script, value, opts } = setup(t);
  const name = script('Open Transaction\nSet Field [ T::Name ; "changed" ]\nCommit Records/Requests\nRevert Transaction\nCommit Transaction\nExit Script [ Text Result: Get ( LastError ) ]');
  const ordinary = await runScript(store, name, opts);
  assert.equal(ordinary.result, '0');
  assert.equal(value(), 'before');
  const recording = await recordRun(store, name, opts);
  assert.equal(recording.done.result, '0');
  assert.equal(value(), 'before');
  const debug = await new ScriptDebugger().start(store, name, opts);
  assert.equal(debug.done?.result, '0');
  assert.equal(value(), 'before');
});

for (const queued of [false, true]) test(`AR-script-engine-05 ${queued ? 'queued' : 'inline'}`, async (t) => {
  const { store, script, value, opts } = setup(t);
  const server = script('Set Field [ T::Name ; "server changed" ]\nCommit Records/Requests');
  const caller = script(`Open Transaction\nPerform Script on Server [ "${server}" ; Wait for completion: On ]\nRevert Transaction\nCommit Transaction\nExit Script [ Text Result: Get ( LastError ) ]`);
  const queue: ServerQueue = { run(job) { return Promise.resolve().then(() => job()); } };
  const result = await runScript(store, caller, { ...opts, ...(queued ? { serverQueue: queue } : {}) });
  assert.equal(result.result, '0');
  assert.equal(value(), 'server changed');
});

test('AR-script-engine-05 same session', async (t) => {
  const { store, script, value, opts } = setup(t);
  const nested = script('Set Field [ T::Name ; "nested changed" ]\nCommit Records/Requests');
  const caller = script(`Open Transaction\nPerform Script [ "${nested}" ]\nRevert Transaction\nCommit Transaction`);
  await runScript(store, caller, opts);
  assert.equal(value(), 'before');
});

test('AR-script-engine-09', async (t) => {
  const { store, id, script, value, opts } = setup(t);
  store.savePrivilegeSet({ name: 'Editor', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [] });
  store.setPassword('editor', 'pw', 'Editor');
  const name = script('Set Error Capture [ On ]\nOpen Transaction\nSet Field [ T::Name ; "changed" ]\nCommit Records/Requests\nSet Error Logging [ On ]\nCommit Transaction\nExit Script [ Text Result: Get ( LastError ) ]');
  const result = await runScript(store, name, { ...opts, foundSet: [id], account: 'editor', privileges: store.privileges('editor'), trace: true });
  assert.equal(result.result, '9');
  assert.equal(value(), 'before');
});

test('AR-script-engine-09 disabled policy', async (t) => {
  const { store, script, value, opts } = setup(t);
  store.savePrivilegeSet({ name: 'Editor', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [] });
  store.setPassword('editor', 'pw', 'Editor');
  const name = script('Set Error Capture [ On ]\nSet Revert Transaction on Error [ Off ]\nOpen Transaction\nSet Field [ T::Name ; "changed" ]\nCommit Records/Requests\nSet Error Logging [ On ]\nCommit Transaction\nExit Script [ Text Result: Get ( LastError ) ]');
  const result = await runScript(store, name, { ...opts, account: 'editor', privileges: store.privileges('editor') });
  assert.equal(result.result, '0');
  assert.equal(value(), 'changed');
});

test('AR-script-engine-08', { timeout: 10_000 }, async () => {
  const child = spawn(process.execPath, [join(import.meta.dirname, 'transaction-cancel-child.ts')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (s: string) => { output += s; });
  child.stderr.setEncoding('utf8').on('data', (s: string) => { output += s; });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`watchdog: ${output}`)); }, 5000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (status) => { clearTimeout(timer); resolve(status); });
  });
  assert.equal(code, 0, output);
});
