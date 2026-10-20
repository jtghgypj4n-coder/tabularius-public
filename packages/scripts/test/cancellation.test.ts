import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, writer } from '@tabularius/store';
import { runScript, ScriptEngine, type RunOptions } from '../src/engine.ts';
import { cancellationScope } from '../src/cancellation.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

function fixture(t: import('node:test').TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cancellation-'));
  createStore(join(dir, 'Test.openhbam.sqlite'));
  const store = new Store(join(dir, 'Test.openhbam.sqlite'), 'Test');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  const id = store.create('Items', { Name: 'before' }).recordId;
  let sequence = 0;
  const script = (text: string) => {
    const name = `Run ${++sequence}`;
    store.applyDesign([{ op: 'createScript', name, text }]);
    return store.schema.scripts.find((s) => s.name === name)!;
  };
  return { dir, store, id, script };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

test('cancel reaches blocked URL and AI calls, rolls back and releases locks and temporary files', async (t) => {
  const { store, script, id, dir } = fixture(t);
  for (const kind of ['url', 'ai'] as const) {
    const entered = gate();
    const stop = new AbortController();
    let active: AbortSignal | undefined;
    const blocked = (signal?: AbortSignal | null) => new Promise<never>((_, reject) => {
      active = signal ?? undefined;
      assert.ok(active);
      active.addEventListener('abort', () => reject(active!.reason), { once: true });
      entered.resolve();
    });
    const operation = kind === 'url' ? 'Insert from URL [ $result ; "http://127.0.0.1/blocked" ]' :
      'Configure AI Account [ Account Name: "acct" ]\nGenerate Response from Model [ Account Name: "acct" ; Model: "fake" ; Prompt: "hello" ; Target: $result ]';
    const run = script('Set Variable [ $tmp ; Value: Get ( TemporaryPath ) & "scratch.txt" ]\nCreate Data File [ “$tmp” ]\nOpen Data File [ “$tmp” ; Target: $file ]\nOpen Transaction\nSet Field [ Items::Name ; "pending" ]\n' + operation + '\nCommit Transaction');
    // Use decoded AI parameters so this test adds no script-text parsing rule.
    if (kind === 'ai') {
      run.steps.splice(5, 2,
        { stepId: 212, name: 'Configure AI Account', enabled: true, params: { ai: { accountName: '"acct"' } } },
        { stepId: 220, name: 'Generate Response from Model', enabled: true, params: { ai: { accountName: '"acct"', model: '"fake"', input: '"hello"' }, variable: '$result' } });
    }
    const opts: RunOptions = { documents: dir, layout: 'Items', foundSet: [id], stop: stop.signal,
      ...(kind === 'url' ? { [TEST_ONLY_CUSTOM_FETCH]: true, network: (async (_url, init) => blocked(init?.signal)) as typeof fetch } : { ai: { refusal: () => undefined, generate: (r) => blocked(r.signal) } }) };
    const engine = new ScriptEngine(opts);
    const running = engine.run(store, run);
    await entered.promise;
    const temp = (engine as unknown as { tempDir: string }).tempDir;
    assert.ok(existsSync(temp));
    stop.abort();
    const result = await running;
    assert.ok(active!.aborted);
    assert.equal(result.halted, true);
    assert.equal(result.error, 1);
    assert.equal(existsSync(temp), false);
    assert.equal(store.get('Items', id).fieldData.Name, 'before');
    writer.run({ owner: 'next-request' }, () => store.update('Items', id, { Name: 'next' }));
    store.update('Items', id, { Name: 'before' });
    assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  }
});

test('cancel during a debugger wait prevents the following commit and pending auto-commit', async (t) => {
  const { store, script, id } = fixture(t);
  const stop = new AbortController();
  const result = await runScript(store, script('Set Field [ Items::Name ; "pending" ]\nCommit Records/Requests'), {
    layout: 'Items', foundSet: [id], stop: stop.signal,
    debug: async (point) => { if (point.index === 1) stop.abort(); },
  });
  assert.equal(result.halted, true);
  assert.equal(store.get('Items', id).fieldData.Name, 'before');
  writer.run({ owner: 'next-request' }, () => store.update('Items', id, { Name: 'next' }));
});

for (const kind of ['user', 'external', 'halt'] as const) {
  test(`${kind} stop ${kind === 'external' ? 'discards' : 'commits'} pending record edits`, async (t) => {
    const { store, script, id } = fixture(t);
    const stop = new AbortController();
    const userStop = new EventTarget();
    const source = 'Allow User Abort [ On ]\nSet Field [ Items::Name ; "edited" ]\n' +
      (kind === 'halt' ? 'Halt Script' : 'Pause/Resume Script [ Duration (seconds): 3 ]') +
      '\nSet Field [ Items::Name ; "too late" ]';
    const result = await runScript(store, script(source), {
      layout: 'Items', foundSet: [id], stop: stop.signal, userStop,
      debug: (point) => {
        // The event loop turns after the debugger resumes and the timed pause starts.
        if (point.index === 2 && kind !== 'halt') setImmediate(() => {
          if (kind === 'external') stop.abort();
          else userStop.dispatchEvent(new Event('stop'));
        });
      },
    });
    assert.equal(result.halted, true);
    assert.equal(result.error, kind === 'external' ? 1 : 0);
    assert.equal(store.get('Items', id).fieldData.Name, kind === 'external' ? 'before' : 'edited');
    assert.equal(getEventListeners(userStop, 'stop').length, 0);
    assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
    writer.run({ owner: 'next-request' }, () => store.update('Items', id, { Name: 'next' }));
  });
}

for (const kind of ['user', 'external'] as const) {
  test(`${kind} stop after the final step does not halt a completed script`, async (t) => {
    const { store, script, id } = fixture(t);
    const stop = new AbortController();
    const userStop = new EventTarget();
    const result = await runScript(store, script('Set Field [ Items::Name ; "edited" ]'), {
      layout: 'Items', foundSet: [id], stop: stop.signal, userStop,
      profile: { step() {}, run() {}, leave() {
        if (kind === 'external') stop.abort();
        else userStop.dispatchEvent(new Event('stop'));
      } },
    });
    assert.equal(result.halted, false);
    assert.equal(result.error, 0);
    assert.equal(store.get('Items', id).fieldData.Name, 'edited');
  });
}

for (const phase of ['before callbacks', 'waiting for server', 'running callback'] as const) {
  test(`external cancellation ${phase} still halts and discards pending edits`, async (t) => {
    const { store, script, id } = fixture(t);
    const worker = script('Exit Script [ Result: "done" ]');
    const callback = script('Set Field [ Items::Name ; "callback edit" ]\nPause/Resume Script [ Duration (seconds): 3 ]');
    const caller = script(`Set Field [ Items::Name ; "caller edit" ]\nPerform Script on Server with Callback [ “${worker.name}” ; Callback script: “${callback.name}” ; State: Continue ]`);
    const stop = new AbortController();
    const release = gate();
    let serverDone: Promise<unknown> | undefined;
    const running = runScript(store, caller, {
      layout: 'Items', foundSet: [id], stop: stop.signal,
      serverQueue: { run(job) {
        const done = phase === 'waiting for server' ? release.promise.then(() => job()) : job();
        serverDone = done;
        return done;
      } },
      profile: { step() {}, run() {}, leave(_file, name) {
        if (name !== caller.name) return;
        if (phase === 'before callbacks') stop.abort();
        if (phase === 'waiting for server') setImmediate(() => stop.abort());
      } },
      debug: (point) => {
        if (phase === 'running callback' && point.script === callback.name && point.index === 1) setImmediate(() => stop.abort());
      },
    });
    try {
      const result = await running;
      assert.equal(result.halted, true);
      assert.equal(result.error, 1);
      assert.equal(store.get('Items', id).fieldData.Name, 'before');
    } finally {
      release.resolve();
      await serverDone;
    }
  });
}

test('import yields to cancellation and rolls back its open transaction', async (t) => {
  const { store, script, id, dir } = fixture(t);
  writeFileSync(join(dir, 'rows.csv'), Array.from({ length: 2000 }, (_, i) => `row-${i}`).join('\n'));
  const stop = new AbortController();
  const result = await runScript(store, script('Open Transaction\nImport Records [ With dialog: Off ; “rows.csv” ; Add ]\nCommit Transaction'), {
    layout: 'Items', documents: dir, stop: stop.signal,
    debug: (point) => { if (point.index === 1) setImmediate(() => stop.abort()); },
  });
  assert.ok(result.halted);
  assert.deepEqual(store.findIds('Items'), [id]);
  writer.run({ owner: 'next-request' }, () => store.update('Items', id, { Name: 'next' }));
});

test('completed runs detach the user stop listener and preserve Allow User Abort and Halt/Exit', async (t) => {
  const { store, script } = fixture(t);
  const userStop = new EventTarget();
  for (const source of ['Exit Script [ Result: "done" ]', 'Halt Script', 'Allow User Abort [ Off ]\nExit Script [ Result: "done" ]']) {
    const r = await runScript(store, script(source), { userStop });
    assert.equal(r.halted, source === 'Halt Script');
    if (!r.halted) assert.equal(r.result, 'done');
    assert.equal(getEventListeners(userStop, 'stop').length, 0);
  }
  const r = await runScript(store, script('Allow User Abort [ Off ]\nExit Script [ Result: "done" ]'), {
    userStop, debug: (p) => { if (p.index === 1) userStop.dispatchEvent(new Event('stop')); },
  });
  assert.equal(r.result, 'done');
  assert.equal(getEventListeners(userStop, 'stop').length, 0);
});

test('deadline links use a fake clock and detach on timeout, completion and pre-abort', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const parent = new AbortController();
  const scope = cancellationScope([parent.signal], 1000);
  t.mock.timers.tick(999);
  assert.equal(scope.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(scope.signal.aborted, true);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  for (let i = 0; i < 2000; i++) cancellationScope([parent.signal], 1000).dispose();
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  parent.abort();
  const canceled = cancellationScope([parent.signal]);
  assert.equal(canceled.signal.aborted, true);
  canceled.dispose();
});


test('canceled export and document generation preserve previous output and remove staging', async (t) => {
  const { store, script, id, dir } = fixture(t);
  for (const extension of ['csv', 'xlsx', 'pdf']) {
    const target = join(dir, `output.${extension}`);
    writeFileSync(target, 'previous output');
    const stop = new AbortController();
    const text = extension === 'pdf' ? 'Save Records as PDF [ “output.pdf” ]'
      : extension === 'xlsx' ? 'Save Records as Excel [ “output.xlsx” ]' : 'Export Records [ “output.csv” ]';
    const r = await runScript(store, script(text), { documents: dir, layout: 'Items', foundSet: [id], stop: stop.signal,
      debug: () => { setImmediate(() => stop.abort()); } });
    assert.equal(r.halted, true, `${extension}: ${JSON.stringify(r.trace)}`);
    assert.equal(readFileSync(target, 'utf8'), 'previous output');
    assert.ok(!readdirSync(dir).some((name) => name.endsWith('.partial')));
    const next = await runScript(store, script(text), { documents: dir, layout: 'Items', foundSet: [id] });
    assert.equal(next.error, 0);
    assert.notEqual(readFileSync(target, 'utf8'), 'previous output');
  }
});

// The runner gives every child a stub PATH; a prohibited command makes the test fail.
after(() => {
  const marker = process.env.TABULARIUS_TEST_COMMAND_MARKER;
  if (marker) assert.equal(existsSync(marker), false, 'a prohibited child command was invoked');
});
