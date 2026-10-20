// Entirely generated database and scripts. No AI, network, mail, credentials or corpus inputs.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, stopJavaScript } from '../../store/src/index.ts';
import { runScript, runScriptTests, ScriptEngine, ScriptSession, testScripts } from '../src/index.ts';
import { evaluateText } from '../../calc/src/index.ts';
import { JavaScriptContext, JS_CONTEXT_LIMIT, JS_TIME_LIMIT_MS } from '../../store/src/javascript.ts';

afterEach(async () => { await stopJavaScript(); });

test('MBS JS timeout cool-down survives three runs with private sessions for the same account', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-js-account-cooldown-'));
  const path = join(dir, 'Generated.sqlite');
  createStore(path);
  const store = new Store(path, 'Generated');
  try {
    store.applyDesign([{ op: 'createScript', name: 'Evaluate', text: [
      'Set Variable [ $h ; Value: MBS ( "JS.New" ) ]',
      'Exit Script [ Text Result: MBS ( "JS.Evaluate" ; $h ; Get ( ScriptParameter ) ) ]',
    ].join('\n') }]);
    const calls = t.mock.method(JavaScriptContext.prototype, 'call');
    const runs = [];
    for (const account of ['Admin', 'ADMIN', 'admin']) {
      const began = performance.now();
      const result = await runScript(store, 'Evaluate', { account, parameter: 'for (;;) {}' });
      runs.push({ result, elapsed: performance.now() - began });
    }
    assert.match(runs[0].result.result, /^\[MBS\] ERROR:.*took longer/);
    assert.equal(calls.mock.callCount(), 1, 'only the first private session reaches a sandbox');
    for (const { result, elapsed } of runs.slice(1)) {
      assert.equal(result.error, 0);
      assert.match(result.result, /^\[MBS\] ERROR:.*recently/);
      // Refusal normally takes milliseconds; allow a full sandbox budget for runner jitter.
      assert.ok(elapsed < JS_TIME_LIMIT_MS, `cool-down refusal took ${elapsed} ms`);
    }
    const other = await runScript(store, 'Evaluate', { account: 'Other', parameter: '6 * 7' });
    assert.equal(other.error, 0);
    assert.equal(other.result, '42', 'another account is not cooled down');
    assert.equal(calls.mock.callCount(), 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MBS JS a script loop cannot restart a runaway sandbox during its session cool-down', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-js-cooldown-'));
  const path = join(dir, 'Generated.sqlite');
  createStore(path);
  const store = new Store(path, 'Generated');
  try {
    store.applyDesign([{ op: 'createScript', name: 'Runaway', text: [
      'Set Variable [ $i ; Value: 0 ]',
      'Loop',
      'Set Variable [ $h ; Value: MBS ( "JS.New" ) ]',
      'Set Variable [ $result ; Value: MBS ( "JS.Evaluate" ; $h ; "for (;;) {}" ) ]',
      'Set Variable [ $i ; Value: $i + 1 ]',
      'Exit Loop If [ $i = 5 ]',
      'End Loop',
      'Exit Script [ Text Result: $i & ":" & $result ]',
    ].join('\n') }]);
    const calls = t.mock.method(JavaScriptContext.prototype, 'call');
    const result = await runScript(store, 'Runaway');
    assert.equal(result.error, 0);
    assert.match(result.result, /^5:\[MBS\] ERROR:.*recently/);
    assert.equal(calls.mock.callCount(), 1, 'only the first iteration reaches a sandbox');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MBS JS a closed caller-owned session cannot acquire handles after an await', async () => {
  const owner = new ScriptSession();
  const ref = evaluateText('MBS ( "JS.New" )', { pluginSession: owner });
  assert.match(ref, /^\d+$/);
  const resumed = Promise.resolve().then(() => evaluateText('MBS ( "JS.New" )', { pluginSession: owner }));
  owner.close();
  owner.close();
  assert.match(await resumed, /^\[MBS\] ERROR:.*session.*ended/);
  assert.match(evaluateText(`MBS ( "JS.Release" ; "${ref}" )`, { pluginSession: owner }), /^\[MBS\] ERROR:/);
});

test('MBS JS an engine-owned session ends on success or failure instead of waiting for GC', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-js-run-'));
  const path = join(dir, 'Generated.sqlite');
  createStore(path);
  const store = new Store(path, 'Generated');
  const retained: ScriptEngine[] = [];
  try {
    store.applyDesign([{ op: 'createScript', name: 'Create', text: 'Exit Script [ Text Result: MBS ( "JS.New" ) ]' }]);
    for (let i = 0; i <= JS_CONTEXT_LIMIT; i++) {
      const engine = new ScriptEngine();
      retained.push(engine);
      const result = await engine.run(store, 'Create');
      assert.match(result.result, /^\d+$/);
      assert.match(evaluateText(`MBS ( "JS.Release" ; "${result.result}" )`, { pluginSession: engine.globals }), /^\[MBS\] ERROR:/);
    }
    const failed = new ScriptEngine({ beforeFile: () => { throw new Error('stopped before running'); } });
    retained.push(failed);
    const ref = evaluateText('MBS ( "JS.New" )', { pluginSession: failed.globals });
    assert.match(ref, /^\d+$/);
    await assert.rejects(failed.run(store, 'Create'), /stopped before running/);
    assert.match(evaluateText(`MBS ( "JS.Release" ; "${ref}" )`, { pluginSession: failed.globals }), /^\[MBS\] ERROR:/);

    // Perform Script on Server owns a separate session, even when its caller is long-lived.
    store.applyDesign([{ op: 'createScript', name: 'Server', text: [
      'Perform Script on Server [ "Create" ; Wait for completion: On ]',
      'Exit Script [ Text Result: Get ( ScriptResult ) ]',
    ].join('\n') }]);
    const caller = new ScriptSession();
    for (let i = 0; i <= JS_CONTEXT_LIMIT; i++) {
      assert.match((await runScript(store, 'Server', { session: caller })).result, /^\d+$/);
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MBS JS each script-test case closes its private session', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-js-cases-'));
  const path = join(dir, 'Generated.sqlite');
  createStore(path);
  const store = new Store(path, 'Generated');
  const retained: ScriptSession[] = [];
  const run = ScriptEngine.prototype.run;
  t.mock.method(ScriptEngine.prototype, 'run', function (this: ScriptEngine, ...args: Parameters<typeof run>) {
    retained.push(this.globals);
    return run.apply(this, args);
  });
  try {
    store.applyDesign([{ op: 'createScript', name: 'Create', text: [
      'Set Variable [ $h ; Value: MBS ( "JS.New" ) ]',
      'Exit Script [ Text Result: MBS ( "IsError" ) ]',
    ].join('\n') }]);
    const script = store.schema.scripts.find(s => s.name === 'Create')!;
    const testCase = store.saveScriptTest({ name: 'Generated case', script: script.id, given: {}, expect: { result: '0' } });
    for (let i = 0; i <= JS_CONTEXT_LIMIT; i++) {
      const [result] = await runScriptTests(store, [testCase]);
      assert.equal(result.passed, true, JSON.stringify(result.failures));
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MBS JS handles and IsError persist across offline script steps and runs, with session isolation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mbs-js-'));
  let store: Store | undefined;
  try {
    const path = join(dir, 'Generated.sqlite');
    createStore(path);
    store = new Store(path, 'Generated');
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
      { op: 'createScript', name: 'Create', text: [
        'Set Variable [ $$js ; Value: MBS ( "JS.New" ) ]',
        'Set Variable [ $r ; Value: MBS ( "JS.SetGlobalPropertyValue" ; $$js ; "saved" ; 42 ) ]',
        'Exit Script [ Text Result: $$js ]',
      ].join('\n') },
      { op: 'createScript', name: 'Read', text: 'Exit Script [ Text Result: MBS ( "JS.GetGlobalPropertyValue" ; Get ( ScriptParameter ) ; "saved" ) ]' },
      { op: 'createScript', name: 'Error', text: [
        'Set Variable [ $r ; Value: MBS ( "JS.Evaluate" ; Get ( ScriptParameter ) ; "undefined" ) ]',
        'Exit Script [ Text Result: MBS ( "IsError" ) ]',
      ].join('\n') },
      { op: 'createScript', name: 'Free', text: 'Exit Script [ Text Result: MBS ( "JS.Free" ; Get ( ScriptParameter ) ) ]' },
    ]);
    const db = store;
    const run = async (name: string, session: ScriptSession, parameter?: string) => {
      const result = await runScript(db, db.schema.scripts.find(s => s.name === name)!, { session, parameter });
      assert.equal(result.error, 0);
      return result.result;
    };
    const owner = new ScriptSession(), other = new ScriptSession();
    const handle = await run('Create', owner);
    assert.match(handle, /^\d+$/);
    assert.equal(await run('Read', owner, handle), '42');
    assert.match(await run('Read', other, handle), /^\[MBS\] ERROR:/);
    assert.equal(await run('Error', owner, handle), '1');
    assert.equal(await run('Read', owner, handle), '42');
    assert.equal(await run('Free', owner, handle), 'OK');
    assert.match(await run('Read', owner, handle), /^\[MBS\] ERROR:/);
  } finally {
    await stopJavaScript();
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MBS JS test-scripts runs end their private sessions, so more than the server cap of scripts can each leave a handle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-js-testscripts-'));
  const path = join(dir, 'Generated.sqlite');
  createStore(path);
  const store = new Store(path, 'Generated');
  try {
    // A script that makes a handle and never releases it (or stops before it gets to).
    store.applyDesign(Array.from({ length: JS_CONTEXT_LIMIT + 3 }, (_, i) => (
      { op: 'createScript' as const, name: `Leaky ${i}`, text: 'Set Variable [ $h ; Value: MBS ( "JS.New" ) ]' })));
    const results = await testScripts(store);
    assert.equal(results.length, JS_CONTEXT_LIMIT + 3);
    assert.ok(results.every(r => r.outcome === 'ok'), JSON.stringify(results.filter(r => r.outcome !== 'ok')));
    // Capacity is free now, not after the 60 s idle expiry.
    assert.match(evaluateText('MBS ( "JS.New" )', { pluginSession: new ScriptSession() }), /^\d+$/);
  } finally {
    await stopJavaScript();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
